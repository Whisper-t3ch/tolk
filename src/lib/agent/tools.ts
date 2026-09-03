// ============================================================
// Определения 14 инструментов AI-агента: схемы для YandexGPT
// function calling + типы аргументов на TypeScript-стороне.
// Реализация вызовов — в src/lib/agent/executor.ts.
//
// Действия, помеченные needsConfirmation: true, никогда не
// выполняются executor'ом напрямую из основного цикла — route.ts
// (/api/assistant) должен вернуть { type: "confirmation_required" }
// и выполнить их только через /api/assistant/confirm после
// явного подтверждения психолога.
// ============================================================
import type { YandexGptTool } from "@/lib/yandexgpt";

export type AgentToolName =
  | "get_clients"
  | "find_client_by_name"
  | "get_client_info"
  | "create_client"
  | "update_client"
  | "search_client_history"
  | "get_period_summary"
  | "search_knowledge_base"
  | "get_schedule"
  | "get_preferences"
  | "find_available_slots"
  | "create_session"
  | "cancel_session"
  | "send_message_to_client"
  | "send_homework"
  | "send_session_invite";

/** Инструменты, необратимые по своей природе — требуют подтверждения психолога. */
export const CONFIRMATION_REQUIRED_TOOLS: ReadonlySet<AgentToolName> = new Set([
  "create_client",
  "update_client",
  "create_session",
  "cancel_session",
  "send_message_to_client",
  "send_homework",
  "send_session_invite",
]);

export function toolNeedsConfirmation(name: string): boolean {
  return CONFIRMATION_REQUIRED_TOOLS.has(name as AgentToolName);
}

// ------------------------------------------------------------
// Схемы function calling (JSON Schema под YandexGPT tools[].function.parameters)
// ------------------------------------------------------------
export const AGENT_TOOLS: YandexGptTool[] = [
  // --- Клиенты ---
  {
    function: {
      name: "get_clients",
      description: "Возвращает список всех клиентов психолога (id, имя, статус, запрос, подход).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    function: {
      name: "find_client_by_name",
      description:
        "Ищет клиента(ов) по имени или фамилии (частичное совпадение, регистр не важен). Используй ЭТОТ инструмент первым, когда психолог упоминает клиента по имени, а не по UUID — например «что там у Марины» или «покажи историю Иванова». Возвращает список подходящих клиентов с их id; если найден ровно один — сразу используй его id в следующем вызове (get_client_info и т.д.), если несколько — уточни у психолога, кого из них он имел в виду.",
      parameters: {
        type: "object",
        properties: {
          name_query: { type: "string", description: "Имя, фамилия или их часть, как упомянул психолог" },
        },
        required: ["name_query"],
      },
    },
  },
  {
    function: {
      name: "get_client_info",
      description: "Возвращает подробную информацию о клиенте: профиль, историю сессий, контакты. Требует client_id — если известно только имя, сначала вызови find_client_by_name.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID клиента (если известно только имя — сначала вызови find_client_by_name)" },
        },
        required: ["client_id"],
      },
    },
  },
  {
    function: {
      name: "create_client",
      description: "Создаёт нового клиента. Необратимое действие — требует подтверждения психолога.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Имя клиента" },
          request: { type: "string", description: "Запрос клиента (с чем пришёл)" },
          approach: { type: "string", description: "Терапевтический подход" },
          telegram: { type: "string", description: "Username в Telegram, если известен" },
          phone: { type: "string", description: "Телефон клиента, если известен" },
        },
        required: ["name"],
      },
    },
  },
  {
    function: {
      name: "update_client",
      description: "Обновляет данные существующего клиента. Необратимое действие — требует подтверждения психолога.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID клиента (если известно только имя — сначала вызови find_client_by_name)" },
          fields: {
            type: "object",
            description: "Поля для обновления: name, request, approach, status (active|pause|completed)",
          },
        },
        required: ["client_id", "fields"],
      },
    },
  },

  // --- История и RAG ---
  {
    function: {
      name: "search_client_history",
      description:
        "Ищет релевантные фрагменты в истории сессий конкретного клиента по смысловому запросу (similarity search по транскриптам).",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID клиента (если известно только имя — сначала вызови find_client_by_name)" },
          query: { type: "string", description: "Поисковый запрос (например, «делегирование задач»)" },
        },
        required: ["client_id", "query"],
      },
    },
  },
  {
    function: {
      name: "get_period_summary",
      description: "Строит суммаризацию работы с клиентом за период: темы, динамика, паттерны.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID клиента (если известно только имя — сначала вызови find_client_by_name)" },
          date_from: { type: "string", description: "Начало периода, YYYY-MM-DD" },
          date_to: { type: "string", description: "Конец периода, YYYY-MM-DD" },
        },
        required: ["client_id", "date_from", "date_to"],
      },
    },
  },
  {
    function: {
      name: "search_knowledge_base",
      description: "Ищет релевантные материалы (техники, статьи, протоколы) в личной базе знаний психолога.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Поисковый запрос" },
          approach: { type: "string", description: "Опционально: фильтр по терапевтическому подходу" },
        },
        required: ["query"],
      },
    },
  },

  // --- Расписание ---
  {
    function: {
      name: "get_schedule",
      description: "Возвращает сессии психолога за указанный период.",
      parameters: {
        type: "object",
        properties: {
          date_from: { type: "string", description: "Начало периода, YYYY-MM-DD" },
          date_to: { type: "string", description: "Конец периода, YYYY-MM-DD" },
        },
        required: ["date_from", "date_to"],
      },
    },
  },
  {
    function: {
      name: "get_preferences",
      description: "Возвращает сохранённые предпочтения психолога по расписанию (буфер между сессиями, рабочие часы и т.д.).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    function: {
      name: "find_available_slots",
      description:
        "Находит свободные слоты для сессии с учётом занятости, буфера между сессиями, времени на дорогу и предпочтительных часов/дней.",
      parameters: {
        type: "object",
        properties: {
          duration_minutes: { type: "integer", description: "Длительность сессии в минутах" },
          date_from: { type: "string", description: "Начало диапазона поиска, YYYY-MM-DD" },
          date_to: { type: "string", description: "Конец диапазона поиска, YYYY-MM-DD" },
        },
        required: ["duration_minutes"],
      },
    },
  },

  // --- Сессии ---
  {
    function: {
      name: "create_session",
      description:
        "Создаёт новую сессию с клиентом на конкретное время. Необратимое действие — требует подтверждения психолога.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID клиента (если известно только имя — сначала вызови find_client_by_name)" },
          datetime: { type: "string", description: "Дата и время сессии, ISO 8601" },
          duration_minutes: { type: "integer", description: "Длительность в минутах (по умолчанию 50)" },
        },
        required: ["client_id", "datetime"],
      },
    },
  },
  {
    function: {
      name: "cancel_session",
      description: "Отменяет запланированную сессию. Необратимое действие — требует подтверждения психолога.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "UUID сессии" },
          reason: { type: "string", description: "Причина отмены (опционально)" },
        },
        required: ["session_id"],
      },
    },
  },

  // --- Коммуникация ---
  {
    function: {
      name: "send_message_to_client",
      description:
        "Готовит сообщение клиенту к отправке в мессенджер. Необратимое действие — требует подтверждения психолога.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID клиента (если известно только имя — сначала вызови find_client_by_name)" },
          text: { type: "string", description: "Текст сообщения" },
          channel: { type: "string", enum: ["telegram", "vk"], description: "Канал отправки" },
        },
        required: ["client_id", "text", "channel"],
      },
    },
  },
  {
    function: {
      name: "send_homework",
      description: "Готовит домашнее задание клиенту к отправке. Необратимое действие — требует подтверждения психолога.",
      parameters: {
        type: "object",
        properties: {
          client_id: { type: "string", description: "UUID клиента (если известно только имя — сначала вызови find_client_by_name)" },
          homework_text: { type: "string", description: "Текст домашнего задания" },
        },
        required: ["client_id", "homework_text"],
      },
    },
  },
  {
    function: {
      name: "send_session_invite",
      description: "Готовит отправку ссылки на видеокомнату сессии клиенту. Необратимое действие — требует подтверждения психолога.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "UUID сессии" },
        },
        required: ["session_id"],
      },
    },
  },
];

export const MAX_AGENT_ITERATIONS = 5;

export const AGENT_SYSTEM_PROMPT = `Ты профессиональный ассистент практикующего психолога.
Ты знаешь всех его клиентов, их историю и расписание.
Используй только данные из инструментов — не придумывай.
Перед созданием, изменением или отправкой чего-либо — запроси подтверждение у психолога.
Отвечай кратко и по делу на русском языке.
Учитывай предпочтения психолога при планировании.

Психолог почти никогда не знает и не называет UUID клиентов — он говорит именами
("что там у Марины", "покажи историю Иванова", или просто называет имя и фамилию
одним сообщением, например «Дмитрий Волков»). ЗАПРЕЩЕНО спрашивать у психолога
UUID или "предоставить эту информацию" — это внутренний технический идентификатор,
психологу он не известен и не должен упоминаться в диалоге с ним.

Если в сообщении психолога (или в предыдущих репликах диалога) упомянуто имя
клиента, а у тебя ещё нет его client_id — НЕ отвечай текстом с просьбой уточнить
или предоставить ID. Вместо этого сразу вызови инструмент find_client_by_name с
этим именем. Это относится и к случаю, когда психолог отвечает на твой же вопрос
"уточните имя" одним именем без глагола — такое сообщение всегда означает
"используй это имя для поиска", а не просто реплику для чтения.
Если find_client_by_name вернул ровно одного клиента — сразу используй его id
в следующем вызове (get_client_info, get_period_summary и т.д.), не переспрашивая
психолога повторно. Если найдено несколько — кратко перечисли их и уточни, кого
из них психолог имел в виду.`;
