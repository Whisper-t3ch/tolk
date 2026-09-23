// ============================================================
// Конфигурация подключения к Jitsi для lib-jitsi-meet.
//
// Собственной ВМ с Jitsi-инфраструктурой пока нет (см.
// CLAUDE_CONTEXT_HANDOFF.md). Пользователь явно разрешил тестировать
// логику звонка и рекордера на публичном meet.jit.si, пока своя ВМ не
// появится: "когда собственная ВМ появится, поменяется только адрес
// сервера в конфиге, остальная логика не зависит от того чей это
// Jitsi" (решение от 23.09). Поэтому домен — единственное, что здесь
// завязано на среду; connection.ts и recorder ничего не знают о том,
// публичный сервер или собственный.
//
// ВАЖНО: meet.jit.si — публичный, никем не модерируемый сервер, без
// пароля на комнату по умолчанию (защита — только непредсказуемое имя
// комнаты, см. buildJitsiRoomName в ../jitsi.ts). Это тестовый контур
// для проверки логики звонка и записи, НЕ замена собственной
// инфраструктуры для боевых консультаций с персональными данными
// клиентов. isUsingPublicTestServer() возвращает true, пока
// NEXT_PUBLIC_JITSI_DOMAIN не указывает на собственный домен —
// вызывающий UI (JitsiCallView) обязан показывать предупреждение в
// этом случае, а не только полагаться на комментарий здесь.
// ============================================================

const PUBLIC_TEST_DOMAIN = "meet.jit.si";

export function getJitsiDomain(): string {
  return process.env.NEXT_PUBLIC_JITSI_DOMAIN || PUBLIC_TEST_DOMAIN;
}

export function isUsingPublicTestServer(): boolean {
  return getJitsiDomain() === PUBLIC_TEST_DOMAIN;
}

export interface JitsiConnectionConfig {
  domain: string;
  /** Опции для конструктора JitsiConnection. */
  connectionOptions: Record<string, unknown>;
  /** Опции для connection.initJitsiConference(). */
  conferenceOptions: Record<string, unknown>;
}

/**
 * serviceUrl несёт имя комнаты в query-параметре — это требование
 * websocket-сигнализации Jitsi (в т.ч. meet.jit.si): сервер должен
 * знать комнату уже на этапе установления XMPP-соединения, до
 * JitsiConnection.connect(). Формат подтверждён по исходникам
 * jitsi/lib-jitsi-meet (JitsiMeetJS.joinConference, ветка master,
 * 22.09.2026) — проверить живым звонком на meet.jit.si из этой сессии
 * не удалось: домен не входит в разрешённый исходящий трафик среды
 * разработки (агент видит только gitHub/npm), это не ограничение
 * браузера психолога. Первый реальный созвон — лучшая проверка.
 */
export function getJitsiConnectionConfig(roomName: string): JitsiConnectionConfig {
  const domain = getJitsiDomain();

  return {
    domain,
    connectionOptions: {
      hosts: {
        domain,
        muc: `conference.${domain}`,
      },
      serviceUrl: `wss://${domain}/xmpp-websocket?room=${roomName}`,
      clientNode: "http://jitsi.org/jitsimeet",
    },
    conferenceOptions: {
      openBridgeChannel: true,
    },
  };
}
