import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Notif = { id: string; text: string; at: string; upcoming?: boolean };

function clientName(rel: unknown): string {
  const r = Array.isArray(rel) ? rel[0] : rel;
  const name = (r as { name?: string } | null | undefined)?.name;
  return name?.trim() || "Клиент";
}

// GET /api/notifications — уведомления психолога, собранные из реальных данных
// (раньше в шапке был захардкоженный мок, одинаковый у всех аккаунтов):
//  • клиент прошёл тест (последние 14 дней);
//  • транскрипт сессии готов (последние 7 дней);
//  • ближайшие сессии (в течение 24 часов).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  const now = Date.now();
  const items: Notif[] = [];

  const [tests, transcripts, upcoming] = await Promise.all([
    supabase
      .from("test_results")
      .select("id, completed_at, clients ( name ), test_questionnaires ( title )")
      .eq("psychologist_id", user.id)
      .eq("status", "completed")
      .gte("completed_at", new Date(now - 14 * 86400_000).toISOString())
      .order("completed_at", { ascending: false })
      .limit(10),
    supabase
      .from("session_transcripts")
      .select("id, created_at, sessions!inner ( psychologist_id, clients ( name ) )")
      .eq("sessions.psychologist_id", user.id)
      .gte("created_at", new Date(now - 7 * 86400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("sessions")
      .select("id, scheduled_at, status, clients ( name )")
      .eq("psychologist_id", user.id)
      .neq("status", "cancelled")
      .gte("scheduled_at", new Date(now).toISOString())
      .lte("scheduled_at", new Date(now + 24 * 3600_000).toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(10),
  ]);

  for (const t of tests.data ?? []) {
    const q = Array.isArray(t.test_questionnaires) ? t.test_questionnaires[0] : t.test_questionnaires;
    items.push({
      id: `test-${t.id}`,
      text: `${clientName(t.clients)} прошёл(а) тест${q?.title ? ` «${q.title}»` : ""}`,
      at: t.completed_at as string,
    });
  }
  for (const tr of transcripts.data ?? []) {
    const s = Array.isArray(tr.sessions) ? tr.sessions[0] : tr.sessions;
    items.push({
      id: `tr-${tr.id}`,
      text: `Транскрипт сессии с ${clientName((s as { clients?: unknown } | undefined)?.clients)} готов`,
      at: tr.created_at as string,
    });
  }
  for (const s of upcoming.data ?? []) {
    const mins = Math.max(0, Math.round((new Date(s.scheduled_at as string).getTime() - now) / 60000));
    const when = mins < 60 ? `через ${mins} мин` : `через ${Math.round(mins / 60)} ч`;
    items.push({
      id: `up-${s.id}`,
      text: `Сессия с ${clientName(s.clients)} ${when}`,
      // «at» — момент попадания в 24-часовое окно (стабилен между запросами)
      at: new Date(new Date(s.scheduled_at as string).getTime() - 24 * 3600_000).toISOString(),
      upcoming: true,
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return NextResponse.json({ items: items.slice(0, 20) });
}
