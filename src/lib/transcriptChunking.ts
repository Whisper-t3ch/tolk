import type { SupabaseClient } from "@supabase/supabase-js";
import { yandexGptEmbed } from "@/lib/yandexgpt";

// ------------------------------------------------------------
// Чанкинг транскриптов для RAG (search_client_history).
//
// YandexGPT Embeddings ограничен 2048 токенами на вход (см.
// https://aistudio.yandex.ru/ru/docs/ai-studio/concepts/limits).
// Реальная часовая сессия психолога — обычно 3-6 тысяч токенов
// анонимизированного текста, то есть embedding для ЦЕЛОЙ сессии
// почти всегда падает с ошибкой 400. Обнаружено 20.09 на тесте
// клиента с 10 полными сессиями — 10 из 10 embedding-вызовов
// провалились, session_transcripts.embedding оставался NULL, и
// match_session_transcripts эту сессию никогда не находил (см.
// migration_034_session_transcript_chunks.sql).
//
// CHUNK_SIZE_CHARS — эмпирический запас: ~2.5 символа на токен для
// кириллицы, лимит 2048 токенов, берём ~4000 символов, чтобы не
// упираться в границу даже на текстах с обилием пунктуации/скобок
// (ремарки в транскриптах сессий), которые токенизируются гуще
// обычного текста. CHUNK_OVERLAP_CHARS — небольшое перекрытие, чтобы
// мысль, разорванная ровно на границе чанка, не терялась целиком ни
// в одном из двух соседних эмбеддингов.
const CHUNK_SIZE_CHARS = 4000;
const CHUNK_OVERLAP_CHARS = 400;

export function splitIntoChunks(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= CHUNK_SIZE_CHARS) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, trimmed.length);
    // Разрезаем по границе реплики (перевод строки), если она есть
    // недалеко от расчётного конца чанка — иначе можно разорвать
    // реплику "Психолог: ..." пополам, что не критично для RAG, но
    // ухудшает читаемость найденного фрагмента в ответе ассистента.
    let cut = end;
    if (end < trimmed.length) {
      const lastNewline = trimmed.lastIndexOf("\n", end);
      if (lastNewline > start + CHUNK_SIZE_CHARS * 0.5) {
        cut = lastNewline;
      }
    }
    chunks.push(trimmed.slice(start, cut).trim());
    if (cut >= trimmed.length) break;
    start = Math.max(cut - CHUNK_OVERLAP_CHARS, start + 1);
  }
  return chunks.filter(c => c.length > 0);
}

/**
 * Считает embedding для каждого чанка текста и сохраняет их в
 * session_transcript_chunks. Best-effort на уровне отдельного чанка —
 * если один чанк не удалось векторизовать, остальные всё равно
 * сохраняются (частичный RAG лучше, чем никакого). Возвращает
 * количество успешно сохранённых чанков с embedding.
 *
 * Существующие чанки для этой сессии удаляются перед вставкой новых —
 * повторная загрузка транскрипта (например, ручное исправление после
 * неудачной автоматической расшифровки) не должна плодить дубликаты.
 */
export async function chunkAndEmbedTranscript(
  supabase: SupabaseClient,
  sessionId: string,
  text: string
): Promise<{ chunksTotal: number; chunksEmbedded: number }> {
  const chunks = splitIntoChunks(text);

  await supabase.from("session_transcript_chunks").delete().eq("session_id", sessionId);

  let chunksEmbedded = 0;
  for (let i = 0; i < chunks.length; i++) {
    let embedding: number[] | null = null;
    try {
      embedding = await yandexGptEmbed(chunks[i], "doc");
      chunksEmbedded++;
    } catch (e) {
      embedding = null;
      console.error(
        "chunkAndEmbedTranscript: embedding failed for chunk",
        i,
        "of session",
        sessionId,
        e instanceof Error ? e.message : String(e)
      );
    }

    const { error } = await supabase.from("session_transcript_chunks").insert({
      session_id: sessionId,
      chunk_index: i,
      chunk_text: chunks[i],
      embedding,
    });
    if (error) {
      console.error("chunkAndEmbedTranscript: insert failed for chunk", i, "of session", sessionId, error.message);
    }
  }

  return { chunksTotal: chunks.length, chunksEmbedded };
}
