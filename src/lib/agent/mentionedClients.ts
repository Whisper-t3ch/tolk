// Находит клиентов психолога, упомянутых в тексте вопроса по имени или фамилии (с учётом падежей).
// Нужно, чтобы сервер сам подставлял id клиента в контекст: слабые модели (GigaChat) вместо
// find_client_by_name выдумывают id или уходят в посторонние инструменты.

export interface ClientRef {
  id: string;
  name: string;
}

function stem(token: string): string {
  const t = token.toLowerCase().replace(/ё/g, "е");
  return t.length > 4 ? t.slice(0, t.length - 2) : t.length > 3 ? t.slice(0, t.length - 1) : t;
}

function words(text: string): string[] {
  return (text.toLowerCase().replace(/ё/g, "е").match(/[а-яa-z]{3,}/g) ?? []);
}

export function findMentionedClients(message: string, clients: ClientRef[], max = 3): ClientRef[] {
  const msgWords = words(message);
  if (msgWords.length === 0) return [];
  const hits: Array<{ client: ClientRef; matched: Set<string>; tokens: number }> = [];
  for (const c of clients) {
    const tokens = c.name.split(/\s+/).filter(t => t.length >= 3);
    const matched = new Set<string>();
    for (const t of tokens) {
      const s = stem(t);
      for (const w of msgWords) if (w.startsWith(s) && w.length <= s.length + 3) matched.add(w);
    }
    if (matched.size > 0) hits.push({ client: c, matched, tokens: tokens.length });
  }
  // Омонимия имён («Анна» и «Анна Петрова»): если слова, по которым нашёлся один клиент, целиком покрываются
  // другим, выбираем более точного: с большим числом совпавших слов, а при равенстве — того, чьё имя названо
  // полностью («Анна» против «Анна Петрова» при вопросе про «Анну»). Разных людей в одном вопросе это не затрагивает.
  const better = (a: (typeof hits)[number], b: (typeof hits)[number]) =>
    a.matched.size > b.matched.size ||
    (a.matched.size === b.matched.size && a.matched.size === a.tokens && b.matched.size < b.tokens);
  const found = hits
    .filter(h => !hits.some(o => o !== h && [...h.matched].every(w => o.matched.has(w)) && better(o, h)))
    .map(h => h.client);
  return found.length <= max ? found : [];
}

const SESSION_CONTENT_RE = /(последн|прошл|предыдущ|перв|недавн)\S*\s+(сесси|встреч)|содержани\S*\s+сесси|о\s+ч[её]м\s+говорил|что\s+(говорил|рассказыва|обсужда|упомина)|как\s+узнать,?\s+что/i;

// GigaChat упорно начинает вопросы о сессиях клиента с search_knowledge_base (а там только справка).
// Если в вопросе упомянут клиент и запрос к базе знаний явно про него или про содержание его сессий —
// не ищем в базе, а возвращаем модели подсказку, какой инструмент нужен.
export function knowledgeBaseRedirect(query: string, mentioned: ClientRef[]): { redirect: true; message: string } | null {
  if (mentioned.length === 0 || !query) return null;
  const aboutClient =
    mentioned.some(c => query.includes(c.id)) ||
    findMentionedClients(query, mentioned).length > 0 ||
    SESSION_CONTENT_RE.test(query);
  if (!aboutClient) return null;
  const who = mentioned.map(c => `${c.name} (client_id "${c.id}")`).join("; ");
  return {
    redirect: true,
    message:
      `В базе знаний нет данных о клиентах — только справка по платформе и терапевтическим методам. ` +
      `Для содержания сессий клиента ${who} вызови search_client_history с этим client_id: ` +
      `session_position "last" для последней сессии, "first" для первой, "last_n"/"first_n" для нескольких, либо query с темой.`,
  };
}

/**
 * Имена/фамилии в вопросе, которых нет среди клиентов («что было с Петровым?», когда Петрова нет).
 * Нужно, чтобы не подставлять клиента из контекста диалога: иначе психолог получит данные не того человека.
 * Берём слова с заглавной буквы не в начале предложения; аббревиатуры (ГТР, КПТ) пропускаем.
 */
export function unknownNamesInMessage(message: string, clients: ClientRef[]): string[] {
  const out: string[] = [];
  const sentences = message.split(/(?<=[.!?…])\s+/);
  for (const sentence of sentences) {
    const tokens = sentence.match(/[А-ЯЁA-Za-zа-яё-]+/g) ?? [];
    tokens.slice(1).forEach(t => {
      if (!/^[А-ЯЁ][а-яё]{2,}$/.test(t)) return;
      if (findMentionedClients(t, clients).length > 0) return;
      out.push(t);
    });
  }
  return Array.from(new Set(out));
}
