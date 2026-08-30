import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkYandexGptEnv, yandexGptComplete, YandexGptError } from "@/lib/yandexgpt";
import { buildApproachContextBlock } from "@/lib/approaches";
import { anonymizeTranscript } from "@/lib/anonymize";
import { checkAssistantLimit, consumeAssistantLimit, limitExceededResponse } from "@/lib/assistantLimits";

// POST /api/content/generate
// Body: { format: "telegram"|"vk"|"reels"|"pdf", session_id?: string, topic?: string }
//
// Генерирует пост для соцсетей на основе (опционально) содержания
// конкретной сессии — берём SOAP-протокол этой сессии (обезличенный:
// без имени клиента), либо просто тему, если сессия не выбрана.
// Использует реальный YandexGPT, учитывает подход психолога (см.
// lib/approaches.ts), расходует лимит ассистента как обычный запрос.
const FORMAT_INSTRUCTIONS: Record<string, string> = {
  telegram: "Формат: пост для Telegram-канала психолога. Длина 500-900 знаков, разговорный тон, без хэштегов, с одним хуком в начале и мягким призывом к действию в конце (например, пригласить написать в личку).",
  vk: "Формат: пост для ВКонтакте. Длина 400-700 знаков, можно 1-2 эмодзи по смыслу, структурировано (короткие абзацы), в конце — приглашение записаться на консультацию.",
  reels: "Формат: сценарий короткого видео (Reels/Shorts) на 30-45 секунд. Структура: Хук (первые 3 секунды) / Основная мысль (3-4 тезиса) / Призыв к действию. Пиши как список реплик на камеру, не как пост.",
  pdf: "Формат: короткий гайд для скачивания (PDF), 3-5 практических пунктов по теме с заголовком и коротким вступлением. Пиши структурированно, с подзаголовками для каждого пункта.",
};

export async function POST(request: NextRequest) {
  const envStatus = checkYandexGptEnv();
  if (!envStatus.configured) {
    return NextResponse.json(
      { error: `YandexGPT не настроен. Добавьте ключи в .env: ${envStatus.missing.join(", ")}` },
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

  let body: { format?: string; session_id?: string; topic?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректное тело запроса" }, { status: 400 });
  }

  const format = body.format;
  if (!format || !(format in FORMAT_INSTRUCTIONS)) {
    return NextResponse.json({ error: `format должен быть одним из: ${Object.keys(FORMAT_INSTRUCTIONS).join(", ")}` }, { status: 400 });
  }

  const limitCheck = await checkAssistantLimit(supabase, user.id, "normal");
  if (!limitCheck.allowed) {
    return NextResponse.json(limitExceededResponse(limitCheck.limit), { status: 429 });
  }

  // Источник темы: либо SOAP-протокол выбранной сессии (обезличенно —
  // без имени клиента и без прямых цитат, только тема/динамика), либо
  // произвольная тема текстом, либо просто "интересный кейс из практики".
  let sourceContext = "Тема не уточнена — предложи универсальную, но конкретную тему из практики психолога, избегая клише.";
  if (body.session_id) {
    // sessions.psychologist_id проверяем явно в select — soap_notes сама
    // по себе не хранит владельца, только через session_id, поэтому без
    // этой проверки психолог А мог бы подставить чужой session_id и
    // получить в контенте фрагменты SOAP-протокола чужого клиента.
    const { data: soapNote } = await supabase
      .from("soap_notes")
      .select("a_assessment, p_plan, sessions ( psychologist_id, clients ( name ) )")
      .eq("session_id", body.session_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sessionRelCheck = soapNote && (Array.isArray(soapNote.sessions) ? soapNote.sessions[0] : soapNote.sessions);
    const belongsToUser = (sessionRelCheck as { psychologist_id?: string } | null)?.psychologist_id === user.id;
    if (soapNote && belongsToUser) {
      // a_assessment/p_plan обычно уже не содержат имени клиента (оно и
      // так не запрашивается в SOAP-полях), но могут остаться имена
      // третьих лиц, даты, места — прогоняем через anonymizeTranscript
      // на случай остаточных упоминаний перед отправкой в LLM.
      const sessionRel = Array.isArray(soapNote.sessions) ? soapNote.sessions[0] : soapNote.sessions;
      const clientRel = sessionRel && Array.isArray((sessionRel as { clients?: unknown }).clients)
        ? (sessionRel as { clients: { name?: string }[] }).clients[0]
        : (sessionRel as { clients?: { name?: string } } | null)?.clients;
      const clientName = clientRel?.name ?? "";

      const [assessment, plan] = await Promise.all([
        anonymizeTranscript(soapNote.a_assessment ?? "", clientName),
        anonymizeTranscript(soapNote.p_plan ?? "", clientName),
      ]);
      sourceContext = `Обезличенный материал из практики (без имён и деталей, позволяющих идентифицировать клиента):\nОценка/динамика: ${assessment || "—"}\nПлан работы: ${plan || "—"}`;
    }
  } else if (body.topic?.trim()) {
    sourceContext = `Тема поста: ${body.topic.trim()}`;
  }

  const { data: psychologistProfile } = await supabase
    .from("psychologists")
    .select("approach, specialty, typical_client_request")
    .eq("id", user.id)
    .maybeSingle();
  const approachBlock = psychologistProfile ? buildApproachContextBlock(psychologistProfile) : "";

  const systemPrompt = `Ты помогаешь практикующему психологу писать контент для соцсетей на основе инсайтов из его практики.
КРИТИЧЕСКИ ВАЖНО: результат должен быть полностью обезличен — никаких имён клиентов, узнаваемых деталей, дат или подробностей, по которым можно опознать реального человека. Пиши обобщённо, как о типичной ситуации из практики.
${approachBlock}

${FORMAT_INSTRUCTIONS[format]}

Пиши на русском языке. Не используй markdown-разметку (никаких ** или #). Верни только готовый текст поста/сценария, без вступительных фраз вроде "Вот пост:".`;

  try {
    const text = await yandexGptComplete(
      [
        { role: "system", text: systemPrompt },
        { role: "user", text: sourceContext },
      ],
      { model: "pro", temperature: 0.6 }
    );

    await consumeAssistantLimit(supabase, user.id, "normal");

    return NextResponse.json({ text: text.trim() });
  } catch (e) {
    const message = e instanceof YandexGptError ? e.message : "Не удалось сгенерировать контент";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
