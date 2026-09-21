import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchWeb, WebSearchError, checkWebSearchEnv } from "@/lib/webSearch";
import { checkAssistantLimit, consumeAssistantLimit, limitExceededResponse } from "@/lib/assistantLimits";

// POST /api/assistant/web-search
// Body: { query: string }
//
// Узкий, изолированный путь для веб-поиска — НЕ проходит через основной
// agent loop (/api/assistant) и НЕ видит схему 18 инструментов function
// calling вообще. Вызывается ТОЛЬКО когда:
// 1. search_knowledge_base уже вернул пустой результат в основном диалоге
//    (suggestWebSearch: true, см. lib/agent/executor.ts) — ассистент
//    предложил психологу веб-поиск текстом;
// 2. психолог явно нажал "Да, поискать в интернете" в UI.
//
// Обычные запросы про клиентов/расписание/базу знаний этот route не
// вызывают и не платят за него — изоляция от схемы 18 инструментов
// подтверждена (см. задачу "проверить что схема не выросла").
export async function POST(request: NextRequest) {
  const envStatus = checkWebSearchEnv();
  if (!envStatus.configured) {
    return NextResponse.json(
      {
        error: `Веб-поиск пока недоступен на этой платформе. Не хватает настройки: ${envStatus.missing.join(", ")}`,
      },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ error: "Укажите query" }, { status: 400 });
  }
  if (query.length > 400) {
    // Тот же лимит, что и у самого Yandex Search API (queryText max 400
    // символов) — обрезаем на входе с понятной ошибкой, а не отправляем
    // заведомо отклоняемый запрос во внешний платный сервис.
    return NextResponse.json({ error: "Запрос слишком длинный (максимум 400 символов)" }, { status: 400 });
  }

  // Тот же вес, что и обычный RAG-поиск (search_client_history /
  // search_knowledge_base вне агентской цепочки) — веб-поиск технически
  // не сложнее, просто источник внешний. См. assistantLimits.ts.
  const limitCheck = await checkAssistantLimit(supabase, user.id, "rag");
  if (!limitCheck.allowed) {
    return NextResponse.json(limitExceededResponse(limitCheck.limit), { status: 429 });
  }

  try {
    const results = await searchWeb(query, 3);
    await consumeAssistantLimit(supabase, user.id, "rag");
    return NextResponse.json({ results, query });
  } catch (e) {
    const message = e instanceof WebSearchError ? e.message : "Не удалось выполнить веб-поиск";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
