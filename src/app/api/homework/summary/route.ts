import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/homework/summary
// Сводка по домашним заданиям для дашборда.
//
// Раньше дашборд считал «Выполнение ДЗ» из колонок clients.hw_total /
// hw_completed, которые в коде нигде не заполняются — поэтому блок
// всегда показывал «Пока нет назначенных домашних заданий», даже когда
// психолог только что отправил задание.
//
// Отметки о выполнении в системе пока нет вообще: клиент не может
// сказать «сделал», бот такого не присылает. Поэтому считаем только то,
// что реально известно — сколько заданий отправлено и скольким клиентам,
// без процента выполнения, который взять неоткуда.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("messages")
    .select("client_id, status, created_at")
    .eq("psychologist_id", user.id)
    .eq("kind", "homework");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = rows.filter(r => new Date(r.created_at as string).getTime() >= thirtyDaysAgo);

  return NextResponse.json({
    totalSent: rows.length,
    sentLast30Days: recent.length,
    clientsWithHomework: new Set(rows.map(r => r.client_id)).size,
    // Сколько реально ушло в мессенджер, а сколько лежит недоставленным
    // (у клиента не привязан Telegram/VK) — это психологу важно видеть.
    delivered: rows.filter(r => r.status === "sent").length,
    undelivered: rows.filter(r => r.status !== "sent").length,
  });
}
