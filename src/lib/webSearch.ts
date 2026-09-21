// ============================================================
// Клиент Yandex Search API (веб-поиск) — 21.09.
//
// НЕ путать с YandexGPT (lib/yandexgpt.ts) — это отдельный платный
// сервис Yandex Cloud, отдельный API-ключ (роль search-api.webSearch.user,
// скоуп yc.search-api.execute), отдельная оплата по числу запросов.
// Используется ТОЛЬКО узким изолированным путём (/api/assistant/
// web-search), когда search_knowledge_base психолога вернул пустой
// результат и психолог явно согласился на веб-поиск — см. комментарий
// в src/app/api/assistant/route.ts про решение от 21.09 не добавлять
// это как 19-й инструмент в основную схему function calling.
//
// Документация:
// - Текстовый поиск: https://aistudio.yandex.ru/docs/en/search-api/concepts/web-search
// - REST API: https://aistudio.yandex.ru/docs/en/search-api/api-ref/WebSearch/
// - Получение ключа: https://aistudio.yandex.ru/docs/en/ai-studio/operations/get-api-key
//
// Формат ответа: синхронный POST возвращает JSON с полем rawData —
// Base64-encoded XML (или HTML, не используем). XML содержит группы
// документов с title/url/passages — самый нужный минимум для показа
// психологу источника.
// ============================================================

const YANDEX_SEARCH_URL = "https://searchapi.api.cloud.yandex.net/v2/web/search";

export interface WebSearchEnvStatus {
  configured: boolean;
  missing: string[];
}

/**
 * Проверяет наличие обязательных env-переменных для веб-поиска, не
 * бросая исключение — вызывающий route сам решает, как ответить
 * клиенту (обычно 503 с понятным текстом "функция пока недоступна",
 * а НЕ падать всем /api/assistant, который её не использует вообще).
 */
export function checkWebSearchEnv(): WebSearchEnvStatus {
  const missing: string[] = [];
  if (!process.env.YANDEX_SEARCH_API_KEY) missing.push("YANDEX_SEARCH_API_KEY");
  if (!process.env.YANDEX_GPT_FOLDER_ID) missing.push("YANDEX_GPT_FOLDER_ID");
  return { configured: missing.length === 0, missing };
}

export class WebSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSearchError";
  }
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Выполняет текстовый поиск через Yandex Search API (синхронный режим,
 * русский поиск, XML-ответ) и возвращает верхние результаты в упрощённом
 * виде — title/url/snippet. Каждый результат ОБЯЗАТЕЛЬНО несёт url, чтобы
 * дальше по цепочке (route.ts, UI) можно было показать психологу источник
 * — без этого сохранять найденное в базу знаний нельзя (см. задачу про
 * подтверждение сохранения).
 */
export async function searchWeb(query: string, maxResults = 3): Promise<WebSearchResultItem[]> {
  const envStatus = checkWebSearchEnv();
  if (!envStatus.configured) {
    throw new WebSearchError(
      `Веб-поиск не настроен. Добавьте переменные окружения: ${envStatus.missing.join(", ")}`
    );
  }

  const apiKey = process.env.YANDEX_SEARCH_API_KEY;
  const folderId = process.env.YANDEX_GPT_FOLDER_ID;

  const response = await fetch(YANDEX_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Api-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: {
        searchType: "SEARCH_TYPE_RU",
        queryText: query,
        familyMode: "FAMILY_MODE_MODERATE",
      },
      groupSpec: {
        groupMode: "GROUP_MODE_FLAT",
        groupsOnPage: String(maxResults),
        docsInGroup: "1",
      },
      maxPassages: "3",
      folderId,
      responseFormat: "FORMAT_XML",
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new WebSearchError(`Yandex Search API вернул ошибку ${response.status}: ${text.slice(0, 300)}`);
  }

  const json = (await response.json()) as { rawData?: string };
  if (!json.rawData) {
    throw new WebSearchError("Yandex Search API не вернул результат (пустой rawData)");
  }

  const xml = Buffer.from(json.rawData, "base64").toString("utf-8");
  return parseSearchResultsXml(xml, maxResults);
}

/**
 * Минималистичный XML-парсер под структуру ответа Yandex Search API —
 * не тянем зависимость (xml2js/fast-xml-parser) ради трёх полей на
 * документ. Формат стабилен для группы <group><doc><title>/<url>/
 * <passages><passage>...</passage></passages></doc></group>, но при
 * любых отклонениях просто пропускаем документ, а не падаем — частичный
 * список результатов лучше, чем ошибка всего узкого пути.
 */
function parseSearchResultsXml(xml: string, maxResults: number): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = [];
  const docRegex = /<doc[^>]*>([\s\S]*?)<\/doc>/g;
  let docMatch: RegExpExecArray | null;

  while ((docMatch = docRegex.exec(xml)) !== null && results.length < maxResults) {
    const docXml = docMatch[1];

    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(docXml);
    const urlMatch = /<url>([\s\S]*?)<\/url>/.exec(docXml);
    if (!urlMatch) continue; // без ссылки на источник результат бесполезен и небезопасен показывать

    const passageMatches = [...docXml.matchAll(/<passage>([\s\S]*?)<\/passage>/g)];
    const snippet = passageMatches
      .map(m => stripXmlTags(m[1]))
      .filter(Boolean)
      .join(" … ");

    results.push({
      title: titleMatch ? stripXmlTags(titleMatch[1]) : urlMatch[1].trim(),
      url: urlMatch[1].trim(),
      snippet: snippet || "(описание недоступно)",
    });
  }

  return results;
}

function stripXmlTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
