/**
 * Базовый URL Telegram Bot API. С прод-ВМ (VK Cloud) api.telegram.org недоступен,
 * поэтому можно задать прокси-ретранслятор: TELEGRAM_API_BASE=https://<worker>.workers.dev
 * (без завершающего слэша). По умолчанию — официальный адрес.
 */
export const TELEGRAM_API_BASE = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");

export function telegramBotUrl(botToken: string, method: string): string {
  return `${TELEGRAM_API_BASE}/bot${botToken}/${method}`;
}
