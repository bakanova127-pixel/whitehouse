// Посредник для Telegram Bot API (Cloudflare Worker).
// Пропускает только запросы к Bot API (/bot<токен>/... и /file/bot<токен>/...).
export default {
  // Каждое утро будит бота (Settings → Triggers → Cron: 0 7 * * *), переменная CRON_URL
  async scheduled(event, env, ctx) {
    if (env.CRON_URL) ctx.waitUntil(fetch(env.CRON_URL));
  },
  async fetch(req) {
    const u = new URL(req.url);
    if (!/^\/(file\/)?bot\d+:[\w-]+\//.test(u.pathname)) return new Response('relay ok');
    const init = { method: req.method, headers: {} };
    const ct = req.headers.get('content-type');
    if (ct) init.headers['content-type'] = ct;
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.arrayBuffer();
    return fetch('https://api.telegram.org' + u.pathname + u.search, init);
  }
};
