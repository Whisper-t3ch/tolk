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
// 23.09, живой тест в браузере подтвердил и исправил две проблемы,
// которых не было видно по исходникам:
//
// 1. hosts.anonymousdomain — БЕЗ него meet.jit.si отвечает
//    "connection.passwordRequired: token required" на самом
//    JitsiConnection.connect(), ещё до входа в комнату. Публичный
//    сервер развёл анонимных (без токена) и обычных пользователей по
//    разным XMPP-виртуал-хостам: обычные — {domain}, анонимные —
//    guest.{domain} (подтверждено по /config.js самого meet.jit.si —
//    официальный веб-клиент именно так и подключается). hosts.focus
//    добавлен туда же по той же сверке, хотя без него в тесте
//    отдельной ошибки не поймано.
//
// 2. ВАЖНО, ограничение самого meet.jit.si, не наше: даже с
//    исправлением (1) вход в СОВЕРШЕННО новую комнату анонимным
//    участником падает с "conference.connectionError.membersOnly" —
//    публичный сервер теперь по умолчанию включает Lobby (комнату
//    ожидания) для анонимных гостей, кого-то нужно, чтобы пустить
//    участника внутрь. Старый комментарий здесь ("публичный, никем не
//    модерируемый сервер, без пароля на комнату по умолчанию") больше
//    НЕ верен — это изменилось на стороне Jitsi между заведением
//    Stage 1 и этим тестом. Практическое следствие: два анонимных
//    участника (психолог и клиент, оба без аккаунта Jitsi) СЕЙЧАС не
//    могут довести звонок на публичном meet.jit.si до конца — только
//    до установления соединения. Работать с lobby (conference.
//    joinLobby, admitting оттуда) требует, чтобы кто-то модерировал —
//    то есть был залогинен в аккаунт Jitsi, а заводить сервисный
//    аккаунт Jitsi/проверять это здесь не входит в задачу этой сессии
//    (создание аккаунтов — запрещённое действие для агента). Это
//    главный аргумент ЗА собственную ВМ раньше, чем предполагалось —
//    см. открытые вопросы в статус-документе проекта.
//
// ВАЖНО: meet.jit.si остаётся тестовым контуром для проверки логики
// звонка и записи, НЕ заменой собственной инфраструктуры для боевых
// консультаций с персональными данными клиентов — и, как выяснилось,
// с 23.09 даже для тестирования двух анонимных участников он
// ограниченно пригоден (см. п.2 выше). isUsingPublicTestServer()
// возвращает true, пока NEXT_PUBLIC_JITSI_DOMAIN не указывает на
// собственный домен — вызывающий UI (JitsiCallView) обязан показывать
// предупреждение в этом случае, а не только полагаться на комментарий
// здесь.
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
 * JitsiConnection.connect(). Формат подтверждён живым тестом в
 * браузере 23.09 (см. комментарий в начале файла) — CONNECTION_
 * ESTABLISHED реально происходит с этим serviceUrl и hosts.
 * anonymousdomain, ошибка "token required" была именно из-за
 * отсутствия anonymousdomain, не из-за формата serviceUrl.
 */
export function getJitsiConnectionConfig(roomName: string): JitsiConnectionConfig {
  const domain = getJitsiDomain();

  return {
    domain,
    connectionOptions: {
      hosts: {
        domain,
        // Без anonymousdomain соединение без токена отклоняется
        // сервером (см. комментарий в начале файла, п.1) — не
        // опциональная деталь, а обязательное поле для анонимного
        // (без JWT) подключения на meet.jit.si и Jitsi-совместимых
        // серверах вообще.
        anonymousdomain: `guest.${domain}`,
        muc: `conference.${domain}`,
        focus: `focus.${domain}`,
      },
      serviceUrl: `wss://${domain}/xmpp-websocket?room=${roomName}`,
      clientNode: "http://jitsi.org/jitsimeet",
    },
    conferenceOptions: {
      openBridgeChannel: true,
    },
  };
}
