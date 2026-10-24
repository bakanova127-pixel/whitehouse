// Посредник для Telegram Bot API (Cloudflare Worker).
// Пропускает только запросы к Bot API (/bot<токен>/... и /file/bot<токен>/...).
export default {
  // Будит бота по расписанию: Cron 0 7 * * * (10:00 МСК) и 0 14 * * * (17:00 МСК), переменная CRON_URL
  async scheduled(event, env, ctx) {
    if (env.CRON_URL) ctx.waitUntil(fetch(env.CRON_URL));
  },
  async fetch(req) {
    const u = new URL(req.url);
    // Входящие сообщения от Telegram → функция в Яндексе (/hook/<id функции>)
    const h = u.pathname.match(/^\/hook\/([a-z0-9]{10,40})$/);
    if (h && req.method === 'POST') {
      const headers = { 'content-type': 'application/json' };
      const sec = req.headers.get('x-telegram-bot-api-secret-token');
      if (sec) headers['x-telegram-bot-api-secret-token'] = sec;
      const r = await fetch('https://functions.yandexcloud.net/' + h[1], { method: 'POST', headers, body: await req.text() });
      return new Response(r.ok ? 'ok' : 'error ' + r.status, { status: r.ok ? 200 : 502 });
    }
    if (!/^\/(file\/)?bot\d+:[\w-]+\//.test(u.pathname)) return new Response('relay ok');
    const init = { method: req.method, headers: {} };
    const ct = req.headers.get('content-type');
    if (ct) init.headers['content-type'] = ct;
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.arrayBuffer();
    return fetch('https://api.telegram.org' + u.pathname + u.search, init);
  }
};
