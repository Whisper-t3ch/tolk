import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateSoapPdf } from "@/lib/pdf/soapPdf";

// GET /api/sessions/[id]/soap/pdf
// Генерирует и отдаёт настоящий PDF-файл протокола сессии — раньше
// кнопка "PDF" на странице /session/[id]/soap была фейковой заглушкой
// (setTimeout + уведомление "PDF готов" без реального файла).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await handleGet(request, params);
  } catch (e) {
    // Без этой обёртки любое исключение отдавалось как пустой 500 без тела,
    // и на фронте причина была не видна вообще.
    console.error("[soap/pdf] Необработанная ошибка:", e);
    return NextResponse.json(
      { error: e instanceof Error ? `${e.message}` : String(e) },
      { status: 500 }
    );
  }
}

async function handleGet(request: NextRequest, params: Promise<{ id: string }>) {
  const { id: sessionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, scheduled_at, duration_minutes, clients ( name )")
    .eq("id", sessionId)
    .eq("psychologist_id", user.id)
    .maybeSingle();
  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Сессия не найдена" }, { status: 404 });
  }

  const { data: soapNote, error: soapError } = await supabase
    .from("soap_notes")
    .select("s_subjective, o_objective, a_assessment, p_plan, protocol_template_id")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (soapError) {
    return NextResponse.json({ error: soapError.message }, { status: 500 });
  }
  if (!soapNote) {
    return NextResponse.json({ error: "Протокол ещё не создан — сохраните заметку перед экспортом в PDF" }, { status: 409 });
  }

  let templateTitle: string | null = null;
  if (soapNote.protocol_template_id) {
    const { data: template } = await supabase
      .from("knowledge_base")
      .select("title")
      .eq("id", soapNote.protocol_template_id)
      .maybeSingle();
    templateTitle = template?.title ?? null;
  }

  const clientRel = Array.isArray(session.clients) ? session.clients[0] : session.clients;
  const clientName = (clientRel as { name?: string } | null)?.name ?? "Клиент";

  // Сборка PDF — единственное место здесь, где может упасть что-то
  // внешнее (чтение встроенных шрифтов, embed через fontkit). Без
  // try/catch Next отдавал голый 500 с пустым телом, и на фронте
  // пользователь видел просто «Не удалось сформировать PDF» без причины.
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateSoapPdf({
      clientName,
      scheduledAt: session.scheduled_at as string,
      durationMinutes: session.duration_minutes as number,
      templateTitle,
      blocks: [
        { label: "Жалоба и запрос клиента", text: soapNote.s_subjective ?? "" },
        { label: "Контекст и наблюдения", text: soapNote.o_objective ?? "" },
        { label: "Гипотеза психолога", text: soapNote.a_assessment ?? "" },
        { label: "Договорённости и план", text: soapNote.p_plan ?? "" },
      ],
    });
  } catch (e) {
    console.error("[soap/pdf] Не удалось собрать PDF:", e);
    return NextResponse.json(
      { error: `Не удалось собрать PDF: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const dateSlug = new Date(session.scheduled_at as string).toISOString().slice(0, 10);

  // HTTP-заголовки — это ByteString (только latin1), поэтому имя файла с
  // кириллицей нельзя класть в filename= напрямую: Response падал с
  // «Cannot convert argument to a ByteString…» на первой же букве имени
  // клиента, и PDF не отдавался вообще ни для одного русского имени.
  // По RFC 5987 отдаём два варианта: ASCII-fallback и UTF-8 percent-encoded.
  const unicodeName = `protokol_${clientName.replace(/[^\p{L}\p{N}_-]+/gu, "_")}_${dateSlug}.pdf`;
  const asciiName = `protokol_${dateSlug}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        `attachment; filename="${asciiName}"; ` +
        `filename*=UTF-8''${encodeURIComponent(unicodeName)}`,
    },
  });
}
