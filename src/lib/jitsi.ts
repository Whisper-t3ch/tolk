// ============================================================
// Генерация имени/ссылки Jitsi-комнаты для сессии. Комната создаётся
// "лениво" — Jitsi Meet не требует явного создания комнаты через API,
// достаточно, чтобы оба участника открыли один и тot же URL (первый
// вошедший становится модератором, если включена авторизация — см.
// заметки по деплою в outputs/backend/deploy_jitsi_gigaam.md).
//
// Имя комнаты = tolk-{session.id} (UUID, уже непредсказуем и уникален —
// отдельный секрет не нужен), сохраняется в sessions.jitsi_room_name
// один раз при создании сессии. Полный URL сознательно НЕ хранится в
// БД как отдельная колонка данных — строится на лету из roomName +
// текущего домена (NEXT_PUBLIC_JITSI_DOMAIN), чтобы не было рассинхрона,
// если домен сменится. NEXT_PUBLIC_-префикс — чтобы buildJitsiUrl можно
// было вызвать и на клиенте (в ConferenceModal), и на сервере (executor.ts).
//
// JITSI_DOMAIN задаётся после того, как ВМ развёрнута и домен подключён;
// до этого момента roomName уже существует, но buildJitsiUrl вернёт
// пустую строку — вызывающий код обязан это проверять перед тем, как
// показать/отправить ссылку психологу или клиенту.
// ============================================================

export interface JitsiEnvStatus {
  configured: boolean;
}

export function checkJitsiEnv(): JitsiEnvStatus {
  return { configured: Boolean(process.env.NEXT_PUBLIC_JITSI_DOMAIN) };
}

export function buildJitsiRoomName(sessionId: string): string {
  return `tolk-${sessionId}`;
}

/** Пустая строка, если NEXT_PUBLIC_JITSI_DOMAIN ещё не настроен. */
export function buildJitsiUrl(roomName: string): string {
  const domain = process.env.NEXT_PUBLIC_JITSI_DOMAIN;
  if (!domain) return "";
  return `https://${domain}/${roomName}`;
}

export interface JitsiRoom {
  roomName: string;
  url: string;
}

export function buildJitsiRoom(sessionId: string): JitsiRoom {
  const roomName = buildJitsiRoomName(sessionId);
  return { roomName, url: buildJitsiUrl(roomName) };
}
