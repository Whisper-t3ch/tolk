// ============================================================
// Семантический кэш ответов на СПРАВОЧНЫЕ вопросы о платформе
// (isReferenceOnlyQuestion=true — см. modelSelection.ts). Работает
// ТОЛЬКО для этого класса вопросов: справочный ответ про устройство
// платформы одинаков для любого психолога ("где найти шаблоны
// протоколов" не зависит от того, кто спрашивает), поэтому кэш
// общий — не per-psychologist. Для вопросов о данных конкретного
// клиента кэш НЕДОПУСТИМ и здесь не применяется вообще — у каждого
// клиента свои данные, а isReferenceOnlyQuestion уже отсекает такие
// вопросы на уровне классификации, прежде чем дело доходит до кэша.
//
// ВАЖНО про экономику (см. пересчёт биллинга от 17-19.09): попадание
// в кэш экономит не потому что "кэшированные токены дешевле" — по
// официальному прайсу YandexGPT цена одинакова для всех категорий
// токенов (вход/кэш/инструменты/исход). Экономия — от того, что при
// кэш-хите мы вообще НЕ вызываем LLM, то есть не тратим токены
// никакой категории. Разница принципиальная: это не оптимизация
// цены за токен, а устранение самого запроса.
//
// similarity считается через pgvector (embedding вопроса). В отличие
// от match_knowledge_base (там сравниваются РАЗНЫЕ тексты — вопрос и
// документ, — поэтому уместна асимметричная пара text-search-query
// (для вопроса) / text-search-doc (для документа)), здесь обе стороны
// сравнения — ВОПРОСЫ психолога, то есть сравнение симметричное.
// Поэтому и сохранение, и поиск в этом файле используют ОДИН И ТОТ ЖЕ
// тип эмбеддинга ("query") — иначе self-similarity даже идентичного
// текста не гарантированно проходит порог (баг, найденный на практике:
// кэш не давал ни одного хита даже на дословный повтор вопроса, пока
// сохранение использовало "doc", а поиск — "query").
// Порог 0.93 выбран консервативно (выше, чем 0.7 у RAG-поиска по базе
// знаний): там достаточно найти РЕЛЕВАНТНЫЙ материал, здесь нужно
// найти ПРАКТИЧЕСКИ ТОТ ЖЕ вопрос, иначе кэш вернёт психологу ответ на
// чужой вопрос под видом ответа на его.
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { yandexGptEmbed } from "@/lib/yandexgpt";
import { waitUntil } from "@vercel/functions";

const SIMILARITY_THRESHOLD = 0.93;

export interface CachedAnswer {
  id: string;
  answer: string;
}

/**
 * Ищет похожий ранее заданный справочный вопрос с непрокисшим
 * (rating != 'negative') ответом. Возвращает null, если ничего
 * достаточно похожего не нашлось — вызывающий код должен в этом
 * случае обратиться к LLM как обычно.
 */
export async function findCachedReferenceAnswer(
  supabase: SupabaseClient,
  question: string
): Promise<CachedAnswer | null> {
  console.log("CACHE_LOOKUP_START", JSON.stringify({ question }));
  let embedding: number[];
  try {
    embedding = await yandexGptEmbed(question, "query");
  } catch (e) {
    // Сбой эмбеддинга не должен ронять основной ответ — просто идём
    // мимо кэша, как будто его не было.
    console.error("CACHE_ERROR_EMBEDDING", e instanceof Error ? e.message : String(e));
    return null;
  }
  console.log("CACHE_EMBEDDING_OK", JSON.stringify({ dims: embedding.length }));

  const { data, error } = await supabase.rpc("match_reference_answer_cache", {
    query_embedding: embedding,
    match_threshold: SIMILARITY_THRESHOLD,
  });

  if (error) {
    console.error("CACHE_ERROR_RPC", JSON.stringify({ message: error.message, details: error.details, hint: error.hint, code: error.code }));
    return null;
  }
  console.log("CACHE_RPC_RESULT", JSON.stringify({ rowCount: data?.length ?? 0, data }));
  if (!data || data.length === 0) {
    console.log("CACHE_MISS", JSON.stringify({ question }));
    return null;
  }

  const hit = data[0] as { id: string; answer: string };
  console.log("CACHE_HIT", JSON.stringify({ id: hit.id }));

  // Увеличиваем счётчик попаданий и обновляем updated_at — не блокируем
  // ОТВЕТ психологу ожиданием этого запроса, но и не "void fire-and-forget":
  // route.ts возвращает NextResponse сразу после того, как эта функция
  // отдаст { id, answer }, и на серверлес-рантайме Vercel платформа
  // вправе оборвать execution context сразу после отправки ответа —
  // ровно тот же баг, что был найден и исправлен в route.ts для
  // saveReferenceAnswerToCache (см. коммит с waitUntil), но этот
  // конкретный вызов остался незамеченным при первом проходе, потому
  // что он не в route.ts, а здесь. Как следствие: кэш реально отдавал
  // сохранённый ответ (проверено вручную — второй ответ на тот же
  // вопрос пришёл byte-identical первому), но hit_count оставался 0,
  // потому что инкремент не успевал выполниться.
  waitUntil(
    Promise.resolve(
      supabase.rpc("increment_reference_answer_cache_hit", { cache_id: hit.id })
    )
      .then((res) => {
        console.log("CACHE_INCREMENT_RESULT", JSON.stringify({ error: (res as { error: unknown } | null)?.error ?? null }));
      })
      .catch((e) => {
        console.error("CACHE_INCREMENT_THROWN", e instanceof Error ? e.message : String(e));
      })
  );

  return { id: hit.id, answer: hit.answer };
}

/**
 * Сохраняет новый вопрос-ответ в кэш ПОСЛЕ успешной генерации через
 * LLM. Вызывать только для реально справочных вопросов (проверка
 * isReferenceOnlyQuestion — на вызывающей стороне) и только если
 * ответ не является отказом/ошибкой (эта проверка тоже на вызывающей
 * стороне — здесь сохраняется всё, что передано).
 */
export async function saveReferenceAnswerToCache(
  supabase: SupabaseClient,
  question: string,
  answer: string
): Promise<void> {
  let embedding: number[];
  try {
    // ВАЖНО: "query", не "doc" — здесь сравниваются ВОПРОС с ВОПРОСОМ
    // (новый вопрос психолога против ранее сохранённого), а не вопрос
    // с документом базы знаний. text-search-doc/text-search-query —
    // асимметричная пара моделей: она устроена так, чтобы СБЛИЖАТЬ
    // РАЗНЫЕ тексты (вопрос и релевантный ему документ), а не давать
    // высокую self-similarity одному и тому же тексту, пропущенному
    // через doc и через query по отдельности. Так и был найден баг —
    // кэш сохранял doc-эмбеддинг, а искал query-эмбеддингом того же
    // текста, и даже идентичный вопрос не проходил порог 0.93 (пока не
    // подтверждено SQL-замером, но это наиболее вероятная причина).
    // Обе стороны сравнения здесь должны использовать ОДИН И ТОТ ЖЕ
    // тип эмбеддинга — выбран "query", т.к. это симметричная роль
    // (вопрос против вопроса), и обе функции в этом файле теперь
    // согласованы между собой.
    embedding = await yandexGptEmbed(question, "query");
  } catch (e) {
    console.error("referenceAnswerCache: не удалось получить embedding для сохранения", e);
    return;
  }

  const { error } = await supabase.from("reference_answer_cache").insert({
    question,
    question_embedding: embedding,
    answer,
  });

  if (error) {
    console.error("referenceAnswerCache: не удалось сохранить в кэш", error.message);
  }
}
