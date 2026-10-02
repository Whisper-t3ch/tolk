// ============================================================
// Этап 3.7 (02.10.2026): генерация/хеширование токенов приглашения
// клиента на сессию. См. src/lib/invites/sessionInvites.ts и
// migration_042_session_invites.sql — хранится только хеш, не токен.
//
// 32 случайных байта (crypto.randomBytes, криптографический RNG, не
// Math.random) — 256 бит энтропии, подбор исключён на практике.
// base64url — без символов, требующих URL-кодирования (+, /, =),
// токен безопасно вставляется прямо в путь /join/<token>.
// ============================================================

import { randomBytes, createHash } from "crypto";

export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
