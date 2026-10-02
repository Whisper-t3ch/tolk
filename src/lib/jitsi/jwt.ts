import { createHmac } from "crypto";
import { getJitsiDomain } from "./config";

// ============================================================
// Задача №44 (02.10.2026): серверный выпуск короткоживущего Jitsi JWT
// для ролей psychologist/client.
//
// ВАЖНО, явное ограничение из бэклога: "Подготовить серверный выпуск
// ... секреты только через env. НЕ включать JWT и не подключаться к
// реальному Jitsi, пока нет выделенной ВМ." Это означает:
//   1. Модуль и роуты ниже — ПОДГОТОВКА, не подключение. JWT здесь
//      НИГДЕ не передаётся в src/lib/jitsi/connection.ts или
//      getJitsiConnectionConfig() — та часть кода продолжает работать
//      как раньше (анонимное подключение к meet.jit.si), без единой
//      строчки изменений.
//   2. Безопасный дефолт — ЕСЛИ секреты не заданы в env (сейчас их
//      нет ни в одном окружении, ВМ не куплена), isJitsiJwtConfigured()
//      возвращает false и обе функции issue*Jwt() возвращают
//      { configured: false } — вызывающий код (API-роуты) в этом
//      случае не делает вообще никакого отличия от уже
//      задеплоенного поведения.
//   3. Когда ВМ появится и секреты будут заданы — потребуется
//      ОТДЕЛЬНОЕ решение, чтобы реально передать токен в
//      JitsiConnection.connect({..., token}) и включить проверку
//      токена в конфиге Prosody на самой ВМ (см. пилотный тест
//      27.09 — там authentication = "anonymous", под JWT нужен
//      authentication = "token" + room_lock/token-плагин). Это
//      НЕ делается в рамках этой задачи.
//
// Формат токена — стандартный для docker-jitsi-meet / Jitsi
// token-based auth (prosody-plugins/token/token_verification.lua):
// HS256, aud/iss = JITSI_JWT_APP_ID, sub = домен (или "*"), room,
// context.user.{id,name,moderator}. Подписывается вручную через
// node:crypto (HMAC-SHA256) — библиотека jsonwebtoken не добавлена в
// зависимости специально, чтобы не тащить новый пакет под функцию в
// полтора десятка строк, которая к тому же не используется в
// production до отдельного решения.
// ============================================================

export interface JitsiJwtConfig {
  appId: string;
  appSecret: string;
}

/** true только если обе переменные окружения заданы и непусты. */
export function isJitsiJwtConfigured(): boolean {
  return Boolean(process.env.JITSI_JWT_APP_ID && process.env.JITSI_JWT_APP_SECRET);
}

function getJitsiJwtConfig(): JitsiJwtConfig | null {
  const appId = process.env.JITSI_JWT_APP_ID;
  const appSecret = process.env.JITSI_JWT_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

interface JitsiJwtUserContext {
  id: string;
  name?: string;
  email?: string;
  /**
   * Булев флаг в текущих версиях prosody-плагина Jitsi. Если на
   * конкретной ВМ окажется старая версия, ожидающая строку "true"/
   * "false" (встречается в более старых деплоях) — поправить здесь
   * при реальном подключении, не раньше (см. ограничение выше).
   */
  moderator: boolean;
}

export interface SignJitsiJwtParams {
  roomName: string;
  user: JitsiJwtUserContext;
  /** Короткий TTL — выдаётся непосредственно перед входом в звонок, не хранится. */
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 180; // 3 минуты — время дойти от выдачи токена до join()

/**
 * Возвращает null, если JWT не настроен (нет env) — вызывающий код
 * обязан это проверять и не отправлять null никуда как настоящий
 * токен.
 */
export function signJitsiJwt(params: SignJitsiJwtParams): string | null {
  const config = getJitsiJwtConfig();
  if (!config) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds && params.ttlSeconds > 0 ? params.ttlSeconds : DEFAULT_TTL_SECONDS;

  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    aud: config.appId,
    iss: config.appId,
    sub: getJitsiDomain(),
    room: params.roomName,
    iat: nowSeconds,
    exp: nowSeconds + ttl,
    context: {
      user: {
        id: params.user.id,
        name: params.user.name,
        email: params.user.email,
        moderator: params.user.moderator,
      },
    },
  };

  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = createHmac("sha256", config.appSecret).update(signingInput).digest();
  const signaturePart = base64url(signature);

  return `${signingInput}.${signaturePart}`;
}

export type JitsiTokenResult =
  | { configured: true; token: string; room: string; domain: string; expiresAt: string }
  | { configured: false };

function buildResult(roomName: string, token: string | null, ttlSeconds: number): JitsiTokenResult {
  if (!token) return { configured: false };
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return { configured: true, token, room: roomName, domain: getJitsiDomain(), expiresAt };
}

export function issuePsychologistJwt(params: {
  roomName: string;
  psychologistId: string;
  displayName?: string;
  ttlSeconds?: number;
}): JitsiTokenResult {
  const ttlSeconds = params.ttlSeconds && params.ttlSeconds > 0 ? params.ttlSeconds : DEFAULT_TTL_SECONDS;
  const token = signJitsiJwt({
    roomName: params.roomName,
    ttlSeconds,
    user: { id: params.psychologistId, name: params.displayName, moderator: true },
  });
  return buildResult(params.roomName, token, ttlSeconds);
}

export function issueClientJwt(params: {
  roomName: string;
  clientDisplayName?: string;
  ttlSeconds?: number;
}): JitsiTokenResult {
  const ttlSeconds = params.ttlSeconds && params.ttlSeconds > 0 ? params.ttlSeconds : DEFAULT_TTL_SECONDS;
  // id клиента намеренно случайный (не client.id из БД) — JWT отдаётся
  // анонимному участнику без аккаунта, привязывать к нему внутренний
  // id клиента в контексте токена, который теоретически виден на
  // клиенте (payload JWT не шифруется, только подписывается), не
  // нужно и может быть избыточной утечкой идентификатора.
  const token = signJitsiJwt({
    roomName: params.roomName,
    ttlSeconds,
    user: { id: "client", name: params.clientDisplayName, moderator: false },
  });
  return buildResult(params.roomName, token, ttlSeconds);
}
