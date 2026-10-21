// Набор случайных букв («рдлллллл», «тибиоию») не должен получать уверенный ответ про клиента из контекста диалога.
const VOWELS = "аеёиоуыэюяaeiouy";

function wordLooksRandom(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 4) return false;
  if (/(.)\1{3,}/.test(w)) return true; // «ллллл»
  let vowelRun = 0;
  let consRun = 0;
  let vowels = 0;
  for (const ch of w) {
    if (ch === "ъ" || ch === "ь") {
      consRun = 0;
      vowelRun = 0;
      continue;
    }
    if (VOWELS.includes(ch)) {
      vowels++;
      vowelRun++;
      consRun = 0;
      if (vowelRun >= 3) return true; // «ииюю»
    } else {
      consRun++;
      vowelRun = 0;
      if (consRun >= 5) return true; // «рдлцк»
    }
  }
  if (w.length >= 5 && vowels / w.length < 0.15) return true;
  return false;
}

/** true — сообщение целиком похоже на случайный набор символов. Короткие обычные слова («да», «ок», «привет») — нет. */
export function looksLikeGibberish(message: string): boolean {
  const words = message.match(/[а-яёa-z]+/gi) ?? [];
  if (words.length === 0) return message.trim().length >= 4 && !/\d/.test(message);
  if (words.length > 3) return false;
  const long = words.filter(w => w.length >= 4);
  if (long.length === 0) return false;
  return long.every(wordLooksRandom);
}
