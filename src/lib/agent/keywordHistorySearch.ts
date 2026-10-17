// Поиск по транскриптам по словам (без эмбеддингов). Нужен, пока смысловой поиск работает только
// через эмбеддинги Яндекса: на стеке без них (и для транскриптов без чанков) вопросы вида
// «как менялась злость» иначе падают с ошибкой. Отдаёт реплики, где встречаются слова запроса,
// по каждой сессии в хронологическом порядке — модели этого хватает, чтобы описать динамику.

// Корни для частых тем терапии: по одному слову «злость» не найти «злюсь», «сорвалась», «кричу».
// Это только расширение поиска: если темы нет в словаре, работает обычное сравнение по основе слова.
const THEME_ROOTS: Array<[RegExp, string[]]> = [
  [/^(злост|злоб|злю|злит|злил|злая|злой|гнев|ярост)/, ["злост", "злюсь", "злит", "злил", "злая", "злой", "разозл", "гнев", "ярост", "раздраж", "сорвал", "срыв", "срыва", "крич", "наорал", "бесит"]],
  [/^(тревог|тревож|беспоко|паник|страх)/, ["тревог", "тревож", "беспоко", "волну", "паник", "страх", "страш", "боюсь"]],
  [/^(вин|виноват)/, ["вина", "вину", "вины", "виной", "винов", "виню", "стыд"]],
  [/^(сон|сна|бессонн|засып|спат|сплю)/, ["сон", "сна", "сну", "засып", "просып", "бессонн", "сплю", "спала", "спать"]],
  [/^(грус|печал|депресс|апати|тоск)/, ["грус", "печал", "тоск", "апати", "пусто", "нет сил", "плачу", "плака"]],
  [/^(границ|отказ)/, ["границ", "отказа", "сказала нет", "сказать нет"]],
  [/^(мам|мат)/, ["мама", "маме", "мамы", "мамой", "маму", "мать", "матер"]],
];

function stemsFor(query: string): string[] {
  const words = query.toLowerCase().replace(/ё/g, "е").match(/[а-яa-z]{3,}/g) ?? [];
  const stems = new Set<string>();
  for (const w of words) {
    for (const [re, roots] of THEME_ROOTS) if (re.test(w)) roots.forEach(r => stems.add(r));
    stems.add(w.length > 5 ? w.slice(0, w.length - 2) : w.length > 4 ? w.slice(0, w.length - 1) : w);
  }
  return Array.from(stems);
}

export interface TranscriptForSearch {
  session_id: string;
  scheduled_at: string;
  raw_text: string;
}

export function keywordSearchTranscripts(
  query: string,
  transcripts: TranscriptForSearch[],
  opts: { perSession?: number; maxChars?: number } = {}
): Array<{ session: string; session_id: string; scheduled_at: string; session_number: number; excerpts: string[] }> {
  const perSession = opts.perSession ?? 4;
  const maxChars = opts.maxChars ?? 500;
  const stems = stemsFor(query);
  if (stems.length === 0) return [];
  const sorted = [...transcripts].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const out: Array<{ session: string; session_id: string; scheduled_at: string; session_number: number; excerpts: string[] }> = [];
  sorted.forEach((t, idx) => {
    const paragraphs = t.raw_text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const scored = paragraphs
      .map((p, i) => {
        const low = p.toLowerCase().replace(/ё/g, "е");
        return { i, p, score: stems.reduce((acc, s) => acc + (low.includes(s) ? 1 : 0), 0) };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, perSession)
      .sort((a, b) => a.i - b.i);
    if (scored.length > 0) {
      out.push({
        // Явная подпись «Сессия N из M, дата»: без неё модель путала порядок событий между сессиями.
        session: `Сессия ${idx + 1} из ${sorted.length}, ${t.scheduled_at.slice(0, 10)}`,
        session_id: t.session_id,
        scheduled_at: t.scheduled_at,
        session_number: idx + 1,
        excerpts: scored.map(x => (x.p.length > maxChars ? x.p.slice(0, maxChars) + "…" : x.p)),
      });
    }
  });
  return out;
}
