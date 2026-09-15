"use client";
import { createClient } from "@/lib/supabase/client";
import { buildJitsiRoomName, buildJitsiUrl } from "@/lib/jitsi";
import { formatDateInTimeZone, formatTimeInTimeZone, zonedDateTimeToUtc } from "@/lib/timezone";

// ------------------------------------------------------------
// Сессия (встреча психолога с клиентом) — реальная запись из Supabase
// (таблица sessions). UI-слой (SessionContext, календарь, список сессий)
// продолжает работать с плоской формой { date, time }, поэтому здесь же
// живёт конвертация в/из scheduled_at (timestamptz).
// ------------------------------------------------------------
export interface DbSession {
  id: string;
  clientId: string;
  clientName: string; // подтягивается join'ом к clients.name
  date: string; // YYYY-MM-DD, локальное представление scheduled_at
  time: string; // HH:MM
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "pending_payment";
  bookedVia: "psychologist" | "public_link";
  /** Пустая строка, если NEXT_PUBLIC_JITSI_DOMAIN ещё не настроен (ВМ не подключена). */
  videoRoomUrl: string;
}

interface SessionRow {
  id: string;
  client_id: string;
  scheduled_at: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "pending_payment";
  booked_via: "psychologist" | "public_link" | null;
  jitsi_room_name: string | null;
  clients: { name: string } | { name: string }[] | null;
}

// БЫЛО: getFullYear()/getHours() и т.п. — разбирали scheduled_at (UTC) в
// часовом поясе БРАУЗЕРА, а не психолога. Психолог из Омска (UTC+3 к
// Москве) видел все свои сессии сдвинутыми на 3 часа — забронированный
// клиентом слот 16:00 показывался как 19:00 и на экране подтверждения
// клиенту, и в кабинете самого психолога (см. задачи по часовым поясам).
// zonedDateTimeToUtc в booking.ts чинил только ЗАПИСЬ времени в БД, но
// не чтение/отображение — отсюда и бралось ощущение, что баг «уже
// исправлен», хотя ломался именно этот слой.
function splitScheduledAt(scheduledAt: string, timeZone: string): { date: string; time: string } {
  const d = new Date(scheduledAt);
  return {
    date: formatDateInTimeZone(d, timeZone),
    time: formatTimeInTimeZone(d, timeZone),
  };
}

function mapRow(row: SessionRow, timeZone: string): DbSession {
  const { date, time } = splitScheduledAt(row.scheduled_at, timeZone);
  const clientRel = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  const roomName = row.jitsi_room_name || buildJitsiRoomName(row.id);
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: clientRel?.name ?? "",
    date,
    time,
    status: row.status,
    bookedVia: row.booked_via ?? "psychologist",
    videoRoomUrl: buildJitsiUrl(roomName),
  };
}

const SESSION_COLUMNS = "id, client_id, scheduled_at, status, booked_via, jitsi_room_name, clients ( name )";

// timeZone — IANA-идентификатор психолога (Profile.timezone /
// psychologists.timezone). Параметр обязателен: без него легко случайно
// вернуться к чтению в поясе браузера. Вызывающий код (SessionContext)
// не должен грузить сессии, пока не известен пояс психолога.
export async function fetchSessions(timeZone: string): Promise<DbSession[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_COLUMNS)
    .order("scheduled_at", { ascending: true });

  if (error) throw error;
  return (data as unknown as SessionRow[]).map(row => mapRow(row, timeZone));
}

export interface NewSessionInput {
  clientId: string;
  clientName: string; // не пишется в БД (подтягивается join'ом), нужен только для оптимистичного UI
  date: string;
  time: string;
}

export async function createSessionRecord(input: NewSessionInput, timeZone: string): Promise<DbSession> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const psychologistId = userData.user?.id;
  if (!psychologistId) throw new Error("Не авторизован");

  // БЫЛО: new Date(`${date}T${time}:00`) — интерпретирует введённое время
  // как локальное для БРАУЗЕРА психолога, а не для его настроенного пояса.
  // Психолог, ставящий сессию с устройства в другом регионе (в поездке),
  // записал бы её не на то время. zonedDateTimeToUtc всегда переводит из
  // пояса психолога, независимо от того, где физически открыт браузер.
  const scheduledAt = zonedDateTimeToUtc(input.date, input.time, timeZone).toISOString();
  // id генерируется заранее, чтобы имя Jitsi-комнаты было известно до
  // insert (тот же паттерн, что и в agent/executor.ts::createSession).
  const sessionId = crypto.randomUUID();

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      id: sessionId,
      client_id: input.clientId,
      psychologist_id: psychologistId,
      scheduled_at: scheduledAt,
      status: "scheduled",
      jitsi_room_name: buildJitsiRoomName(sessionId),
    })
    .select(SESSION_COLUMNS)
    .single();

  if (error) throw error;
  return mapRow(data as unknown as SessionRow, timeZone);
}

/**
 * Ручное подтверждение оплаты сессии, забронированной клиентом через
 * публичную ссылку (status pending_payment → scheduled). Пока нет
 * автоматического СБП — психолог сам нажимает эту кнопку в UI сессии
 * после того, как клиент оплатил вне платформы.
 */
export async function confirmSessionPayment(id: string, timeZone: string): Promise<DbSession> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sessions")
    .update({ status: "scheduled" })
    .eq("id", id)
    .select(SESSION_COLUMNS)
    .single();

  if (error) throw error;
  return mapRow(data as unknown as SessionRow, timeZone);
}
