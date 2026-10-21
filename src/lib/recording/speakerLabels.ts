// ------------------------------------------------------------
// Разметка реплик «Психолог / Клиент» для аудио, загруженного одним файлом (голоса в нём не разделены).
// ВАЖНО: работает только с ОБЕЗЛИЧЕННЫМ текстом (после anonymizeTranscript). Модель не переписывает текст,
// а только возвращает метку на каждый номер фрагмента — выдумать или исказить слова она не может.
// При любом сбое возвращаем null, и текст сохраняется без разметки.
// ------------------------------------------------------------

import { yandexGptCompleteJson } from "@/lib/yandexgpt";

export type Speaker = "Психолог" | "Клиент";

export const SPEAKER_NOTE = "[Разделение на реплики психолога и клиента выполнено автоматически по смыслу и может содержать ошибки.]";

const BATCH = 40;
const CONTEXT = 4;

const SYSTEM = `Это обезличенная запись психотерапевтической сессии, разбитая на пронумерованные фрагменты речи в порядке следования. Участников двое: психолог и клиент.
Для КАЖДОГО фрагмента определи, кто его произнёс. Психолог обычно задаёт вопросы, уточняет, отражает слова клиента, предлагает упражнения и подводит итоги; клиент рассказывает о себе, своих чувствах и событиях. Короткие реплики («угу», «да», «понятно») относи к тому, кто отвечает на предыдущий фрагмент. Не меняй и не пересказывай текст.
Верни только JSON: {"speakers": ["П", "К", ...]} — ровно столько элементов, сколько фрагментов в разделе «Размечай»; «П» — психолог, «К» — клиент.`;

function parse(value: unknown, expected: number): Speaker[] | null {
  const arr = (value as { speakers?: unknown })?.speakers;
  if (!Array.isArray(arr) || arr.length !== expected) return null;
  const out: Speaker[] = [];
  for (const x of arr) {
    const s = String(x).trim().toUpperCase();
    if (s.startsWith("П") || s === "P" || s.startsWith("ПСИХ")) out.push("Психолог");
    else if (s.startsWith("К") || s === "C" || s.startsWith("КЛИ")) out.push("Клиент");
    else return null;
  }
  return out;
}

/** Метки для каждого фрагмента или null, если разметить не удалось. */
export async function labelSpeakers(units: string[]): Promise<Speaker[] | null> {
  if (units.length < 2) return null;
  const labels: Speaker[] = [];
  try {
    for (let start = 0; start < units.length; start += BATCH) {
      const batch = units.slice(start, start + BATCH);
      const ctxFrom = Math.max(0, start - CONTEXT);
      const context = units
        .slice(ctxFrom, start)
        .map((t, i) => `${labels[ctxFrom + i] === "Психолог" ? "П" : "К"}: ${t.slice(0, 300)}`)
        .join("\n");
      const user =
        (context ? `Уже размечено (для контекста):\n${context}\n\n` : "") +
        `Размечай:\n` +
        batch.map((t, i) => `${i + 1}. ${t.slice(0, 600)}`).join("\n");
      let result: Speaker[] | null = null;
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        const raw = await yandexGptCompleteJson<unknown>(
          [
            { role: "system", text: SYSTEM },
            { role: "user", text: user },
          ],
          { model: "lite", temperature: 0, maxTokens: 800, throwOnContentFilter: true }
        );
        result = parse(raw, batch.length);
      }
      if (!result) return null;
      labels.push(...result);
    }
    return labels;
  } catch (e) {
    console.error("SPEAKER_LABELS_FAILED", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

/** Склеивает подряд идущие фрагменты одного говорящего в реплики: «Психолог: …\n\nКлиент: …». */
export function buildTurns(units: string[], labels: Speaker[]): string {
  const turns: Array<{ who: Speaker; text: string }> = [];
  units.forEach((t, i) => {
    const who = labels[i];
    const last = turns[turns.length - 1];
    if (last && last.who === who) last.text += ` ${t}`;
    else turns.push({ who, text: t });
  });
  return turns.map(t => `${t.who}: ${t.text}`).join("\n\n");
}
