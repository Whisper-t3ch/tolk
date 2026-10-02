// ============================================================
// Человеко-понятные сообщения об ошибках звонка вместо сырых
// внутренних кодов lib-jitsi-meet/XMPP, которые раньше показывались
// пользователю (психологу/клиенту) как есть через `error.message`
// (см. JitsiCallView.tsx, callError). Найдено 28.09: например
// `conference.connectionError.membersOnly` или строка вида
// `Jitsi connection failed: connection.passwordRequired ...` реально
// могли попасть на экран пользователя.
//
// Маппинг строится на документированной таксономии ошибок
// lib-jitsi-meet (JitsiConnectionErrors/JitsiConferenceErrors,
// https://github.com/jitsi/lib-jitsi-meet) — сравнение по подстроке,
// не по точному значению constant, потому что: (а) официальных типов
// для установленной версии пакета нет (см. комментарий в
// lib-jitsi-meet.d.ts), (б) это устойчивее к небольшим отличиям в
// точном написании кода между версиями сервера/библиотеки. Это НЕ
// проверено живым тестом на каждый код (агент не может — getUserMedia
// заблокирован в его браузере, см. CLAUDE_CONTEXT_HANDOFF.md) — сырой
// код/сообщение всегда дополнительно уходит в console.error для
// отладки, чтобы новый непойманный случай не потерялся молча.
// ============================================================

/** Ошибка звонка с необязательным исходным кодом lib-jitsi-meet (errType/errorCode). */
export interface JitsiCallError extends Error {
  code?: string;
}

export function makeJitsiCallError(message: string, code?: string): JitsiCallError {
  const error = new Error(message) as JitsiCallError;
  if (code) error.code = code;
  return error;
}

interface ErrorPattern {
  /** Регистронезависимая подстрока, которую ищем в code или message. */
  match: string;
  friendly: string;
}

// Порядок важен — проверяются по очереди, первое совпадение побеждает.
const ERROR_PATTERNS: ErrorPattern[] = [
  {
    match: "memberson",
    friendly:
      "Комната ожидает подтверждения входа (лобби). Попробуйте зайти ещё раз через минуту или обратитесь в поддержку.",
  },
  {
    match: "lobby",
    friendly:
      "Комната ожидает подтверждения входа (лобби). Попробуйте зайти ещё раз через минуту или обратитесь в поддержку.",
  },
  {
    match: "maxusers",
    friendly: "В комнате уже максимальное число участников.",
  },
  {
    match: "passwordrequired",
    friendly: "Не удалось авторизоваться на сервере видеосвязи. Обратитесь в поддержку.",
  },
  {
    match: "notallowed",
    friendly: "Недостаточно прав для входа в эту комнату. Обратитесь в поддержку.",
  },
  {
    match: "videobridgenotavailable",
    friendly: "Сервер видеосвязи временно недоступен. Попробуйте ещё раз через несколько минут.",
  },
  {
    match: "icefailed",
    friendly: "Не удалось установить соединение для видеосвязи. Проверьте интернет-соединение и попробуйте ещё раз.",
  },
  {
    match: "offeranswerfailed",
    friendly: "Не удалось установить соединение для видеосвязи. Проверьте интернет-соединение и попробуйте ещё раз.",
  },
  {
    match: "focusdisconnected",
    friendly: "Соединение с сервером видеосвязи прервалось. Попробуйте обновить страницу.",
  },
  {
    match: "focusleft",
    friendly: "Соединение с сервером видеосвязи прервалось. Попробуйте обновить страницу.",
  },
  {
    match: "connectiondropped",
    friendly: "Соединение прервалось. Проверьте интернет-соединение и попробуйте обновить страницу.",
  },
  {
    match: "servererror",
    friendly: "Сервер видеосвязи временно недоступен. Попробуйте ещё раз через несколько минут.",
  },
  {
    match: "othererror",
    friendly: "Не удалось подключиться к серверу видеосвязи. Попробуйте ещё раз.",
  },
  {
    match: "destroyed",
    friendly: "Звонок был завершён.",
  },
];

const GENERIC_FALLBACK = "Не удалось подключиться к звонку. Попробуйте обновить страницу или обратитесь в поддержку.";

/**
 * Человеко-понятное сообщение для показа пользователю вместо сырого
 * `error.message`/`error.code` из lib-jitsi-meet. Всегда логирует
 * исходную ошибку в консоль (не пользователю) — чтобы новый,
 * непойманный этим маппингом код было видно при отладке, а не только
 * общую фразу.
 */
export function getFriendlyCallErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const haystack = `${typeof code === "string" ? code : ""} ${rawMessage}`.toLowerCase();

  // eslint-disable-next-line no-console
  console.error("[JitsiCallView] звонок завершился ошибкой (сырые данные для отладки):", { code, rawMessage });

  for (const pattern of ERROR_PATTERNS) {
    if (haystack.includes(pattern.match)) {
      return pattern.friendly;
    }
  }

  return GENERIC_FALLBACK;
}
