/** Разбирает «контакт для связи»: Telegram-тег (@name, t.me/name) или телефон. Иначе null. */
export function parseClientContact(raw: string | undefined): { kind: "telegram" | "phone"; value: string } | null {
  const s = (raw ?? "").trim().slice(0, 100);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (/^\+?[\d\s().-]{7,25}$/.test(s) && digits.length >= 7 && digits.length <= 15) {
    return { kind: "phone", value: (s.startsWith("+") ? "+" : "") + digits };
  }
  const tag = s.replace(/^(https?:\/\/)?(www\.)?t\.me\//i, "").replace(/^@/, "").replace(/\/$/, "");
  if (/^[A-Za-z0-9_]{3,32}$/.test(tag)) return { kind: "telegram", value: tag };
  return null;
}
