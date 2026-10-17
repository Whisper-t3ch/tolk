// Синтетические кейсы для сравнения моделей. Реальных данных пациентов нет.
// Инструменты повторяют имена и смысл боевых из src/lib/agent/tools.ts (сокращённо).

const obj = (properties, required = []) => ({ type: "object", properties, required });
const str = d => ({ type: "string", description: d });

export const TOOLS = [
  { name: "get_clients", description: "Список клиентов психолога (имя, статус).", parameters: obj({}) },
  { name: "find_client_by_name", description: "Найти клиента по имени или фамилии (частичное совпадение). Вызывай перед любыми действиями с конкретным клиентом.", parameters: obj({ name: str("Имя или фамилия") }, ["name"]) },
  { name: "get_client_info", description: "Карточка клиента по id.", parameters: obj({ client_id: str("id клиента") }, ["client_id"]) },
  { name: "search_client_history", description: "Поиск по истории сессий клиента (транскрипты, заметки).", parameters: obj({ client_id: str("id клиента"), query: str("Что искать") }, ["client_id", "query"]) },
  { name: "get_schedule", description: "Расписание психолога за период.", parameters: obj({ date_from: str("YYYY-MM-DD"), date_to: str("YYYY-MM-DD") }, ["date_from"]) },
  { name: "find_available_slots", description: "Свободные окна для записи на дату.", parameters: obj({ date: str("YYYY-MM-DD") }, ["date"]) },
  { name: "cancel_session", description: "Отменить сессию по id (требует подтверждения психолога).", parameters: obj({ session_id: str("id сессии") }, ["session_id"]) },
];

const SYSTEM_LINES = [
  "Ты — ассистент психолога в платформе ТОЛК. Отвечай по-русски, кратко и по делу.",
  "Данные клиентов бери только через инструменты, ничего не выдумывай.",
  "Если вопрос про саму платформу или общий — отвечай сразу текстом, без инструментов.",
  "Никогда не пиши вызовы инструментов текстом (JSON, tool_call, functionCall) — только через механизм вызова функций.",
  "Сегодня 2026-10-14 (среда).",
];

// Вариант промпта v2 (LLM_AB_PROMPT=v2): календарь на неделю, правило про пустой результат, глоссарий платформы.
const V2 = [
  "Календарь: ср 2026-10-14, чт 2026-10-15, пт 2026-10-16, сб 2026-10-17, вс 2026-10-18, пн 2026-10-19.",
  "Если инструмент вернул пустой результат ([]), прямо скажи, что ничего не найдено. Не предполагай, что данные есть.",
  "Про функции интерфейса платформы не выдумывай: если не уверен, что такой раздел есть, так и скажи.",
  "Идентификаторы (client_id, session_id) бери только из результатов инструментов, никогда не подставляй имя вместо id: сначала find_client_by_name.",
  "Глоссарий: SOAP — формат клинической записи сессии психолога: Subjective, Objective, Assessment, Plan.",
];

export const PROMPT_VARIANT = process.env.LLM_AB_PROMPT === "v2" ? "v2" : "v1";
export const SYSTEM = (PROMPT_VARIANT === "v2" ? [...SYSTEM_LINES, ...V2] : SYSTEM_LINES).join("\n");

const PSEUDO = /tool_call|functionCall|"name"\s*:\s*"(get_|find_|search_|cancel_)|<function|\bget_clients\(|toolCallList/i;

export const CASES = [
  // --- выбор инструмента ---
  { id: "t-list", kind: "tool", user: "Покажи моих клиентов", expect: ["get_clients"] },
  { id: "t-find", kind: "tool", user: "Найди клиента Иванову", expect: ["find_client_by_name"], args: a => /иванов/i.test(String(a.name ?? "")) },
  { id: "t-history", kind: "tool", user: "Что Марина рассказывала про отношения с мамой на прошлых сессиях?", expect: ["find_client_by_name", "search_client_history"] },
  { id: "t-schedule", kind: "tool", user: "Какое у меня расписание на завтра?", expect: ["get_schedule"], args: a => String(a.date_from ?? "").startsWith("2026-10-15") },
  { id: "t-slots", kind: "tool", user: "Найди свободные окна на пятницу", expect: ["find_available_slots"], args: a => String(a.date ?? "") === "2026-10-16" },
  { id: "t-cancel", kind: "tool", user: "Отмени сессию с Петровым на завтра", expect: ["find_client_by_name", "get_schedule"] },
  // --- не вызывать инструмент ---
  { id: "n-tz", kind: "no_tool", user: "Как поменять часовой пояс, чтобы напоминания клиентам приходили вовремя?" },
  { id: "n-noshow", kind: "no_tool", user: "Что делать, если клиент не пришёл на сессию?", mustMatch: /клиент|сесси|связ|напомин|правил/i },
  { id: "n-explain", kind: "no_tool", user: "Объясни своими словами, что такое SOAP-протокол сессии", mustMatch: /субъектив|subjective/i, mustMatch2: /оценк|assessment|анализ/i },
  // --- финальный ответ по данным инструмента ---
  {
    id: "f-list", kind: "final", user: "Покажи моих клиентов",
    toolName: "get_clients", toolArgs: {},
    toolResult: JSON.stringify([{ id: "c1", name: "Анна Тестова", status: "active" }, { id: "c2", name: "Игорь Образцов", status: "paused" }]),
    mustMatch: /Анн.{0,3} Тестов/i, mustMatch2: /Игор.{0,3} Образцов/i,
  },
  {
    id: "f-schedule", kind: "final", user: "Какое у меня расписание на завтра?",
    toolName: "get_schedule", toolArgs: { date_from: "2026-10-15" },
    toolResult: JSON.stringify([{ time: "11:00", client: "Анна Тестова" }, { time: "15:30", client: "Игорь Образцов" }]),
    mustMatch: /11[:.]00/, mustMatch2: /15[:.]30/,
  },
  {
    id: "f-empty", kind: "final", user: "Найди клиента Сидорова",
    toolName: "find_client_by_name", toolArgs: { name: "Сидоров" }, toolResult: "[]",
    mustMatch: /не найден|нет|не нашл|не удалось/i,
  },
  // --- строгий JSON (как анонимизация/сводки) ---
  {
    id: "j-anon", kind: "json",
    user: 'Замени все имена людей в тексте на [ИМЯ] и верни ТОЛЬКО JSON вида {"text": "..."}. Текст: «Анна Тестова пришла с мужем Сергеем, они обсуждали ссору с тёщей Ольгой Петровной.»',
    keys: ["text"], mustNotContain: ["Анна", "Сергей", "Ольг", "Тестов", "Петровн"],
  },
  {
    id: "j-anon2", kind: "json",
    user: 'Замени все имена людей в тексте на «ИМЯ» и верни ТОЛЬКО JSON вида {"text": "..."}. Текст: «Анна Тестова пришла с мужем Сергеем, они обсуждали ссору с тёщей Ольгой Петровной.»',
    keys: ["text"], mustNotContain: ["Анна", "Сергей", "Ольг", "Тестов", "Петровн"],
  },
  {
    id: "j-summary", kind: "json",
    user: 'Верни ТОЛЬКО JSON {"themes": [строки], "mood": "строка"} по заметке: «Клиент говорит о тревоге перед работой, плохо спит, но отмечает, что дыхательные упражнения помогают.»',
    keys: ["themes", "mood"],
  },
];

export { PSEUDO };
