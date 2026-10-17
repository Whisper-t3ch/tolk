// Сбор материалов для подготовки к следующей сессии — детерминированно, на сервере.
// Модели не нужно угадывать, какие сессии читать: она получает последнюю сессию целиком,
// по каждой предыдущей — конспект (SOAP: оценка и план) или, если протокола нет, концовку сессии
// (там обычно договорённости и домашнее задание), плюс отметки риска по всей истории.

const RISK_RE =
  /(суицид|покончить с собой|не хочу жить|лучше бы меня не было|легче без меня|без меня всем|обуза|самоповрежд|порез|причинить себе вред|убить себя)/i;

export interface PrepSessionInput {
  id: string;
  scheduled_at: string;
  transcript: string | null;
  soap: { a_assessment?: string | null; p_plan?: string | null } | null;
}

function tail(text: string, maxChars: number): string {
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const out: string[] = [];
  let len = 0;
  for (let i = paras.length - 1; i >= 0 && len < maxChars; i--) {
    out.unshift(paras[i]);
    len += paras[i].length;
  }
  const joined = out.join("\n");
  return joined.length > maxChars ? "…" + joined.slice(joined.length - maxChars) : joined;
}

export function buildSessionPrep(sessions: PrepSessionInput[], opts: { briefChars?: number } = {}) {
  const briefChars = opts.briefChars ?? 600;
  const withData = [...sessions]
    .filter(s => s.transcript || s.soap)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  if (withData.length === 0) return null;
  const total = withData.length;
  const last = withData[total - 1];

  const previous = withData.slice(0, -1).map((s, i) => {
    const soapText = [s.soap?.a_assessment, s.soap?.p_plan].filter(Boolean).join("\n");
    return {
      session: `Сессия ${i + 1} из ${total}, ${s.scheduled_at.slice(0, 10)}`,
      ...(soapText ? { protocol: soapText.slice(0, briefChars * 2) } : { ending: tail(s.transcript ?? "", briefChars) }),
    };
  });

  const riskMentions: Array<{ session: string; quote: string }> = [];
  withData.forEach((s, i) => {
    if (!s.transcript) return;
    for (const para of s.transcript.split(/\n\s*\n/)) {
      if (RISK_RE.test(para) && /^\s*Клиент/i.test(para)) {
        riskMentions.push({ session: `Сессия ${i + 1} из ${total}`, quote: para.trim().slice(0, 300) });
      }
    }
  });

  return {
    note:
      "Материалы для подготовки. Отвечай только по ним. Дай: о чём была последняя встреча (коротко), " +
      "договорённости и домашние задания, к чему вернуться из прошлых сессий, 2–3 вопроса для начала сессии, " +
      "на что обратить внимание. Если есть отметки риска — вынеси их первым пунктом и напомни про оценку риска.",
    last_session: {
      session: `Сессия ${total} из ${total} (последняя), ${last.scheduled_at.slice(0, 10)}`,
      text: last.transcript ?? [last.soap?.a_assessment, last.soap?.p_plan].filter(Boolean).join("\n"),
    },
    previous_sessions: previous,
    risk_mentions: riskMentions,
  };
}
