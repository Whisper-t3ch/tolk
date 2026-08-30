// ------------------------------------------------------------
// Транслитерация кириллицы + генерация URL-slug — используется при
// автосоздании public_slug для страницы бронирования (booking_settings)
// из имени психолога ("Марина Иванова" → "marina-ivanova").
// ------------------------------------------------------------
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function transliterate(text: string): string {
  return text
    .toLowerCase()
    .split("")
    .map(ch => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join("");
}

/** "Марина Иванова" → "marina-ivanova". Пустой/нечитаемый ввод → "psychologist". */
export function slugify(text: string): string {
  const transliterated = transliterate(text.trim());
  const slug = transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "psychologist";
}
