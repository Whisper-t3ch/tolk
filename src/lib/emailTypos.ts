// Частые опечатки в доменах почты (gmail.ru не существует, из-за этого люди регистрируются на несуществующий адрес
// и потом не могут ни войти, ни восстановить пароль). Возвращает исправленный адрес или null.
const DOMAIN_FIXES: Record<string, string> = {
  "gmail.ru": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.comm": "gmail.com",
  "gmai.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmail.coom": "gmail.com",
  "gnail.com": "gmail.com",
  "mail.ry": "mail.ru",
  "mail.ri": "mail.ru",
  "mail.r": "mail.ru",
  "mial.ru": "mail.ru",
  "yandex.ry": "yandex.ru",
  "yandex.r": "yandex.ru",
  "yandx.ru": "yandex.ru",
  "yadex.ru": "yandex.ru",
  "yande.ru": "yandex.ru",
  "ya.ry": "ya.ru",
  "bk.ry": "bk.ru",
  "inbox.ry": "inbox.ru",
  "list.ry": "list.ru",
  "rambler.ry": "rambler.ru",
  "icloud.con": "icloud.com",
  "outlook.con": "outlook.com",
};

export function suggestEmailFix(email: string): string | null {
  const at = email.trim().lastIndexOf("@");
  if (at < 1) return null;
  const local = email.trim().slice(0, at);
  const domain = email.trim().slice(at + 1).toLowerCase();
  const fix = DOMAIN_FIXES[domain];
  return fix ? `${local}@${fix}` : null;
}
