// Cloudflare Worker «tolk-tg»: прокси к Telegram Bot API для прод-ВМ (api.telegram.org с неё недоступен).
// Прод использует его через TELEGRAM_API_BASE=https://<worker>.workers.dev
//   /bot<token>/<method>        -> https://api.telegram.org/bot<token>/<method>
//   /file/bot<token>/<path>     -> https://api.telegram.org/file/bot<token>/<path>   (скачивание файлов: аватарки клиентов)
// Входящие обновления идут не вебхуком, а long polling'ом (/api/jobs/telegram-poll).
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!/^\/(file\/)?bot[0-9]+:[A-Za-z0-9_-]+\//.test(url.pathname)) {
      return new Response("not found", { status: 404 });
    }
    const target = "https://api.telegram.org" + url.pathname + url.search;
    return fetch(target, {
      method: request.method,
      headers: { "content-type": request.headers.get("content-type") || "application/json" },
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    });
  },
};
