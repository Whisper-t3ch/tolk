// ============================================================
// Этап 3.7 (02.10.2026): модель приглашения клиента на сессию —
// создание, одноразовое потребление, отзыв. См. заголовок
// migration_042_session_invites.sql для обоснования схемы.
//
// Server-only (как attemptAssembly.ts/jobQueue.ts): принимает готовый
// SupabaseClient (service-role — таблица без RLS-политик для
// authenticated, см. заголовок миграции), сам его не создаёт.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateRawToken, hashToken } from "./inviteTokens";

export const DEFAULT_INVITE_TTL_MINUTES = 180;

export interface SessionInviteRow {
  id: string;
  session_id: string;
  status: "active" | "revoked" | "used";
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export type InviteResolution =
  | { ok: true; invite: SessionInviteRow }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "used" };

/**
 * Создаёт приглашение. Сырой токен возвращается ОДИН РАЗ в ответе —
 * вызывающий роут немедленно отдаёт его психологу (ссылка /join/<token>)
 * и больше никогда не хранит и не логирует его.
 */
export async function createSessionInvite(
  supabase: SupabaseClient,
  params: { sessionId: string; createdBy: string; ttlMinutes?: number }
): Promise<{ ok: true; rawToken: string; invite: SessionInviteRow } | { ok: false; error: string }> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + (params.ttlMinutes ?? DEFAULT_INVITE_TTL_MINUTES) * 60_000).toISOString();

  const { data, error } = await supabase
    .from("session_invites")
    .insert({ session_id: params.sessionId, created_by: params.createdBy, token_hash: tokenHash, expires_at: expiresAt })
    .select("id, session_id, status, expires_at, used_at, created_at")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "unknown error" };
  }
  return { ok: true, rawToken, invite: data as SessionInviteRow };
}

async function fetchByHash(supabase: SupabaseClient, tokenHash: string): Promise<SessionInviteRow | null> {
  const { data } = await supabase
    .from("session_invites")
    .select("id, session_id, status, expires_at, used_at, created_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  return (data as SessionInviteRow | null) ?? null;
}

function classify(invite: SessionInviteRow | null): InviteResolution {
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.status === "revoked") return { ok: false, reason: "revoked" };
  if (invite.status === "used") return { ok: false, reason: "used" };
  if (Date.parse(invite.expires_at) <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, invite };
}

/**
 * Read-only проверка — для экрана согласия (GET перед показом формы).
 * НЕ потребляет токен: просматривать ссылку можно сколько угодно раз,
 * расходуется она только явным согласием (consumeInviteToken).
 */
export async function peekInviteToken(supabase: SupabaseClient, rawToken: string): Promise<InviteResolution> {
  return classify(await fetchByHash(supabase, hashToken(rawToken)));
}

/**
 * Атомарно потребляет токен ровно один раз. Условная запись (WHERE
 * status='active' AND expires_at > now()) — если два параллельных
 * запроса "Подключиться" ударят одновременно, UPDATE реально заденет
 * строку только у ОДНОГО из них (Postgres сериализует конкурентные
 * UPDATE на одну строку); проигравший получит 0 обновлённых строк и
 * вернётся сюда же для классификации причины, уже увидев status='used'.
 */
export async function consumeInviteToken(supabase: SupabaseClient, rawToken: string): Promise<InviteResolution> {
  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("session_invites")
    .update({ status: "used", used_at: nowIso })
    .eq("token_hash", tokenHash)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .select("id, session_id, status, expires_at, used_at, created_at")
    .maybeSingle();

  if (error) return { ok: false, reason: "not_found" };
  if (data) return { ok: true, invite: data as SessionInviteRow };

  // UPDATE не задел ни одной строки — сам по себе этот факт не говорит
  // ПОЧЕМУ (не найден? уже использован кем-то только что? истёк именно
  // между eq и gt проверкой?) — перечитываем текущее состояние и
  // классифицируем точно, а не отвечаем общим "не вышло".
  return classify(await fetchByHash(supabase, tokenHash));
}

/** Отзывает ВСЕ активные приглашения сессии (психолог решил, что разосланная ссылка больше не должна работать). */
export async function revokeSessionInvites(
  supabase: SupabaseClient,
  sessionId: string
): Promise<{ ok: true; revoked: number } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("session_invites")
    .update({ status: "revoked" })
    .eq("session_id", sessionId)
    .eq("status", "active")
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, revoked: data?.length ?? 0 };
}
