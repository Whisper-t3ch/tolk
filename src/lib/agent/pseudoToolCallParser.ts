// ============================================================
// Парсер псевдо-tool-call: распознаёт случаи, когда YandexGPT (в
// первую очередь Pro 5.1, но код не завязан на конкретную модель)
// вместо заполнения структурированного поля toolCallList.toolCalls
// пишет текстовое подобие вызова инструмента прямо в финальный текст
// ответа.
//
// НЕ дублирует responseGuard.ts: тот — барьер безопасности (прячет
// небезопасный текст от психолога), этот — попытка РАСПОЗНАТЬ и
// ПРАВИЛЬНО ОБРАБОТАТЬ такой текст как настоящий tool call, чтобы
// психолог вообще не увидел разницы (см. интеграцию в route.ts,
// задача #28). responseGuard остаётся последним барьером на случай,
// если ни один формат здесь не подошёл.
//
// Собрано и подтверждено вживую на проде 19-20.09 (задача #26,
// 44+ прогонов, воспроизведено на теме "клиент пропустил/опоздал/не
// оплатил сессию", ни разу — на других темах):
//
// Формат A — самый частый (3+ случая, разные формулировки вопроса):
// код-блок с именем функции, переводом строки, затем JSON аргументов.
//   ```
//   search_knowledge_base
//   {"query":"..."}
//   ```
//
// Формат B — вложенный (2 случая, byte-идентичны на одном и том же
// вопросе в разные дни): два код-блока, второй — объект с полями
// role/message, где message — сам вызов в виде {name, arguments}.
//   ```
//   {"role": "assistant", "message": "Поиск в базе знаний..."}
//   ```
//   ```
//   {"role": "assistant", "message": {"name": "search_knowledge_base",
//   "arguments": {"query": "..."}}}
//   ```
//
// Оба формата всегда используют РЕАЛЬНОЕ имя инструмента из tools.ts —
// это не случайный текст, а именно попытка модели вызвать функцию,
// просто не в том канале API. Поэтому парсер ищет по списку известных
// имён, а не пытается угадать по структуре текста в общем виде (это
// сильно снижает риск ложного срабатывания на легитимном тексте
// ответа, который случайно похож на JSON).
// ============================================================
import { AGENT_TOOLS } from "./tools";
import type { AgentToolName } from "./tools";

const KNOWN_TOOL_NAMES: string[] = AGENT_TOOLS.map(t => t.function.name);

export interface ParsedPseudoToolCall {
  name: AgentToolName;
  arguments: Record<string, unknown>;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Формат A: `имя_инструмента` (возможно в код-блоке ``` ```), затем на
// следующей строке (или сразу после, с двоеточием/без) JSON-объект
// аргументов. Пример реальных прод-случаев:
//   ```\nsearch_knowledge_base\n{"query":"..."}\n```
function tryParseFormatA(text: string, toolName: string): ParsedPseudoToolCall | null {
  const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Имя инструмента как отдельное "слово", затем (не жадно) любые
  // символы до первой `{`, и сам JSON-объект — считаем его как всё от
  // `{` до соответствующей `}` на том же логическом блоке, беря самый
  // короткий валидный JSON через постепенное расширение это избыточно
  // сложно регэкспом, поэтому берём с этой позиции текст до конца
  // ближайшего тройного апострофа/конца строки и пытаемся распарсить,
  // с уменьшением по одному символу с конца при неудаче.
  const match = text.match(new RegExp(`\\b${escaped}\\b\\s*:?\\s*\\n?\\s*(\\{[\\s\\S]*)`, "i"));
  if (!match) return null;

  const rest = match[1];
  const jsonCandidate = extractFirstJsonObject(rest);
  if (!jsonCandidate) return null;

  const parsed = tryParseJson(jsonCandidate);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { name: toolName as AgentToolName, arguments: parsed as Record<string, unknown> };
  }
  return null;
}

// Формат B: где-то в тексте встречается объект с полем "name",
// значение которого — известное имя инструмента, и полем "arguments"
// рядом (в том же объекте, что типично для {"name":...,"arguments":...}
// либо вложенным на один уровень внутри "message": {...}).
function tryParseFormatB(text: string): ParsedPseudoToolCall | null {
  // Ищем все JSON-подобные объекты в тексте (может быть несколько
  // код-блоков, как в реальных случаях) и проверяем каждый.
  const candidates = extractAllJsonObjects(text);
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (!parsed || typeof parsed !== "object") continue;

    const found = findNameArgumentsPair(parsed as Record<string, unknown>);
    if (found) return found;
  }

  // Модель иногда обрывает JSON раньше времени (не хватает закрывающей
  // скобки — реальный прод-случай 19.09, воспроизведённый byte-в-byte),
  // из-за чего extractFirstJsonObject/JSON.parse не находят валидный
  // объект вообще. Резервная эвристика без требования валидности всего
  // внешнего объекта: находим "name": "<известное имя>" и, если рядом
  // (в пределах разумного окна текста) есть "arguments", пытаемся
  // распарсить сам объект arguments отдельно — тот обычно короче и
  // успевает закрыться до обрыва текста.
  return tryParseFormatBLenient(text);
}

function tryParseFormatBLenient(text: string): ParsedPseudoToolCall | null {
  for (const toolName of KNOWN_TOOL_NAMES) {
    const escapedName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameMatch = text.match(new RegExp(`"name"\\s*:\\s*"${escapedName}"`, "i"));
    if (!nameMatch || nameMatch.index === undefined) continue;

    // Ищем "arguments" в пределах ~200 символов после найденного "name" —
    // достаточно, чтобы покрыть реальные случаи, но не настолько много,
    // чтобы случайно подхватить несвязанный кусок текста дальше по ответу.
    const windowStart = nameMatch.index + nameMatch[0].length;
    const window = text.slice(windowStart, windowStart + 200);
    const argsKeyMatch = window.match(/"arguments"\s*:\s*(\{[\s\S]*)/);
    if (!argsKeyMatch) continue;

    const argsJson = extractFirstJsonObject(argsKeyMatch[1]);
    if (!argsJson) continue;

    const parsedArgs = tryParseJson(argsJson);
    if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
      return { name: toolName as AgentToolName, arguments: parsedArgs as Record<string, unknown> };
    }
  }
  return null;
}

// Рекурсивно ищет в объекте пару полей { name: <известное имя>,
// arguments: <объект> } — покрывает и плоский {"name":...,"arguments":
// ...}, и вложенный {"message": {"name":...,"arguments":...}}, без
// необходимости перечислять все возможные обёртки явно.
function findNameArgumentsPair(obj: Record<string, unknown>, depth = 0): ParsedPseudoToolCall | null {
  if (depth > 4) return null; // защита от аномально глубокой вложенности

  if (
    typeof obj.name === "string" &&
    KNOWN_TOOL_NAMES.includes(obj.name) &&
    obj.arguments &&
    typeof obj.arguments === "object" &&
    !Array.isArray(obj.arguments)
  ) {
    return { name: obj.name as AgentToolName, arguments: obj.arguments as Record<string, unknown> };
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = findNameArgumentsPair(value as Record<string, unknown>, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

// Достаёт первый сбалансированный JSON-объект (по фигурным скобкам,
// учитывая строки и экранирование) начиная с первого символа `{`.
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Достаёт ВСЕ непересекающиеся сбалансированные JSON-объекты верхнего
// уровня из текста (может быть несколько код-блоков подряд).
function extractAllJsonObjects(text: string): string[] {
  const results: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = text.indexOf("{", cursor);
    if (idx === -1) break;
    const obj = extractFirstJsonObject(text.slice(idx));
    if (!obj) break;
    results.push(obj);
    cursor = idx + obj.length;
  }
  return results;
}

/**
 * Пытается распознать в тексте финального ответа модели псевдо-vызов
 * инструмента (см. форматы A/B выше). Возвращает null, если текст не
 * похож ни на один известный паттерн — вызывающий код должен в этом
 * случае обращаться с текстом как с обычным финальным ответом (и,
 * как обычно, прогонять его через responseGuard).
 */
export function parsePseudoToolCall(text: string): ParsedPseudoToolCall | null {
  for (const toolName of KNOWN_TOOL_NAMES) {
    const a = tryParseFormatA(text, toolName);
    if (a) return a;
  }
  return tryParseFormatB(text);
}
