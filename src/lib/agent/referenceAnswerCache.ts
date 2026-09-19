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
// similarity считается через pgvector (embedding вопроса, та же
// модель text-search-query/doc, что и в match_knowledge_base) —
// порог 0.93 выбран консервативно (выше, чем 0.7 у RAG-поиска по
// базе знаний): там достаточно найти РЕЛЕВANTНЫЙ материал, здесь
// нужно найти ПРАКТИЧЕСКИ ТОТ ЖЕ вопрос, иначе кэш вернёт психологу
// ответ на чужой вопрос под видом ответа на его.
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { yandexGptEmbed } from "@/lib/yandexgpt";

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
  let embedding: number[];
  try {
    embedding = await yandexGptEmbed(question, "query");
  } catch (e) {
    // Сбой эмбеддинга не должен ронять основной ответ — просто идём
    // мимо кэша, как будто его не было.
    console.error("referenceAnswerCache: не удалось получить embedding вопроса", e);
    return null;
  }

  const { data, error } = await supabase.rpc("match_reference_answer_cache", {
    query_embedding: embedding,
    match_threshold: SIMILARITY_THRESHOLD,
  });

  if (error) {
    console.error("referenceAnswerCache: match_reference_answer_cache вернул ошибку", error.message);
    return null;
  }
  if (!data || data.length === 0) return null;

  const hit = data[0] as { id: string; answer: string };

  // Увеличиваем счётчик попаданий и обновляем updated_at — не блокируем
  // ответ психологу ожиданием этого запроса.
  void supabase.rpc("increment_reference_answer_cache_hit", { cache_id: hit.id });

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
    embedding = await yandexGptEmbed(question, "doc");
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
