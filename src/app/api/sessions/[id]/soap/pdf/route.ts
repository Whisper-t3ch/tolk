import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateSoapPdf } from "@/lib/pdf/soapPdf";

// GET /api/sessions/[id]/soap/pdf
// Генерирует и отдаёт настоящий PDF-файл протокола сессии — раньше
// кнопка "PDF" на странице /session/[id]/soap была фейковой заглушкой
// (setTimeout + уведомление "PDF готов" без реального файла).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const pdfBytes = await generateSoapPdf({
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

  const dateSlug = new Date(session.scheduled_at as string).toISOString().slice(0, 10);
  const filenameSafeName = clientName.replace(/[^\p{L}\p{N}_-]+/gu, "_");
  const filename = `protokol_${filenameSafeName}_${dateSlug}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
