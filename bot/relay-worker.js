// Посредник Cloudflare для бота «Мои домики» (Google Apps Script).
//  • /tg   — сюда Telegram присылает сообщения, посредник сразу отвечает «ок» и передаёт их в Google
//  • /stt  — распознаёт голосовые (Workers AI, привязка с именем AI)
//  • /ping — проверка связи
// Переменная: GAS_URL — ссылка веб-приложения Google Apps Script (…/exec)
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function b64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    if (u.pathname === '/ping') return new Response(env.GAS_URL ? 'ok' : 'нет переменной GAS_URL', { status: env.GAS_URL ? 200 : 500 });

    if (u.pathname === '/tg' && req.method === 'POST') {
      if (!env.GAS_URL) return new Response('no GAS_URL', { status: 500 });
      let update; try { update = await req.json(); } catch (e) { return new Response('ok'); }
      update._s = req.headers.get('x-telegram-bot-api-secret-token') || '';
      ctx.waitUntil(fetch(env.GAS_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update), redirect: 'follow' }));
      return new Response('ok');
    }

    if (u.pathname === '/stt' && req.method === 'POST') {
      if (!env.GAS_URL || req.headers.get('x-key') !== await sha('stt:' + env.GAS_URL)) return new Response('forbidden', { status: 403 });
      if (!env.AI) return Response.json({ error: 'нет привязки Workers AI с именем AI' }, { status: 500 });
      const audio = await req.arrayBuffer();
      try {
        const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: b64(audio), language: 'ru' });
        return Response.json({ text: r.text || '' });
      } catch (e) {
        try {
          const r = await env.AI.run('@cf/openai/whisper', { audio: [...new Uint8Array(audio)] });
          return Response.json({ text: r.text || '' });
        } catch (e2) { return Response.json({ error: String(e2) }, { status: 500 }); }
      }
    }
    return new Response('relay ok');
  }
};
