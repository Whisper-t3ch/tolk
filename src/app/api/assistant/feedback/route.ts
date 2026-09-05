import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/assistant/feedback
// Body: { message_id: string, rating?: "positive" | "negative", was_used?: true, was_reformulated?: true }
//
// Единая точка для явного и неявного фидбека по конкретному ответу
// ассистента:
//   - rating — клик по 👍/👎 в чате.
//   - was_used — психолог скопировал ответ (кнопка "Скопировать").
//   - was_reformulated — эвристика на фронте определила, что следующее
//     сообщение психолога, отправленное < 15 сек спустя, похоже по
//     ключевым словам на переформулировку того же вопроса.
//
// message_id — id, который сервер сгенерировал и вернул вместе с
// ответом ассистента (см. POST /api/assistant, поле message_id) —
// это НЕ id самой записи assistant_feedback, а совпадающее с ней
// значение message_id, по которому мы находим нужную строку.
//
// Обновляет уже существующую запись (insert делается сразу при
// генерации ответа, см. lib/promptEvolution.ts:recordAssistantFeedback),
// а не создаёт новую — на каждый ответ ассистента ровно одна строка
// в assistant_feedback. Хотя бы одно из полей должно быть передано.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { message_id?: string; rating?: string; was_used?: boolean; was_reformulated?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const messageId = body.message_id;
  if (!messageId) {
    return NextResponse.json({ error: "Укажите message_id" }, { status: 400 });
  }
  if (body.rating !== undefined && body.rating !== "positive" && body.rating !== "negative") {
    return NextResponse.json({ error: "rating должен быть 'positive' или 'negative'" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.rating === "positive" || body.rating === "negative") patch.rating = body.rating;
  if (body.was_used === true) patch.was_used = true;
  if (body.was_reformulated === true) patch.was_reformulated = true;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Не указано ни одно поле для обновления" }, { status: 400 });
  }

  // .eq("psychologist_id", user.id) дублирует RLS-policy намеренно —
  // психолог может обновлять только свою запись фидбека, а не любую
  // по message_id, если он его как-то подберёт.
  const { data, error } = await supabase
    .from("assistant_feedback")
    .update(patch)
    .eq("message_id", messageId)
    .eq("psychologist_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    // Запись могла не успеть сохраниться (гонка) или message_id не
    // существует — не критично для UI, психолог просто увидит, что
    // оценка не сохранилась, не блокируем работу чата.
    return NextResponse.json({ error: "Запись фидбека не найдена" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
