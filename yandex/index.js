/*******************************************************
 *  Бот «Мои домики» — Yandex Cloud Functions (Node.js)
 *  Хранилище: Object Storage (файл data.json)
 *  Голосовые: SpeechKit
 *
 *  Переменные окружения функции:
 *    BOT_TOKEN — токен бота из @BotFather
 *    BUCKET    — имя бакета Object Storage
 *    APP_URL   — (необязательно) адрес приложения
 *******************************************************/
const crypto = require('crypto');

const TOKEN = process.env.BOT_TOKEN || '';
const BUCKET = process.env.BUCKET || '';
const APP_URL = process.env.APP_URL || 'https://bakanova127-pixel.github.io/whitehouse/';
const TZ = 'Europe/Moscow';
const REMIND_DAYS = [2, 1];   // за сколько дней до заезда напоминать (добавьте 0 — и в день заезда)
const CHECKOUT_DAYS = [1];    // за сколько дней до выезда напоминать

const TG_BASE = (process.env.TG_API || 'https://api.telegram.org').replace(/\/+$/, ''); // адрес Telegram API или посредника
const TG = TG_BASE + '/bot' + TOKEN + '/';
const SECRET = crypto.createHash('sha256').update('wh:' + TOKEN).digest('hex').slice(0, 48);
const CRON_KEY = crypto.createHash('sha256').update('cron:' + TOKEN).digest('hex').slice(0, 32);
const BTN = { today: '🏡 Сегодня', week: '📅 Заезды на неделю', debts: '💰 Кто должен', tasks: '🛠 Дела' };
const MONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

let IAM = '';       // токен сервисного аккаунта (из context)
let SELF_URL = '';  // адрес этой функции

/* ================= Точка входа ================= */
module.exports.handler = async function (event, context) {
  IAM = (context && context.token && context.token.access_token) || '';
  const fid = (context && (context.functionName || context.functionId)) || '';
  SELF_URL = process.env.SELF_URL || (fid ? 'https://functions.yandexcloud.net/' + fid : '');

  // Таймер (раз в день)
  if (event && Array.isArray(event.messages) && event.messages.length && !event.httpMethod) {
    await dailyReminders();
    return { statusCode: 200, body: 'ok' };
  }

  const method = (event && event.httpMethod) || 'GET';
  if (method === 'OPTIONS') return reply(204, '');
  const q = (event && event.queryStringParameters) || {};
  const headers = lower((event && event.headers) || {});

  if (method === 'GET') {
    if (q.setup) return reply(200, await setup(q.setup), 'text/plain; charset=utf-8');
    if (q.cron) {
      if (!TOKEN || q.cron !== CRON_KEY) return reply(403, 'forbidden');
      await dailyReminders();
      return reply(200, 'ok');
    }
    return reply(200, 'Бот «Мои домики» работает', 'text/plain; charset=utf-8');
  }

  let raw = (event && event.body) || '';
  if (event && event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  let body; try { body = JSON.parse(raw); } catch (e) { return reply(400, 'bad json'); }

  if (body.update_id !== undefined) {
    if (headers['x-telegram-bot-api-secret-token'] !== SECRET) return reply(403, 'forbidden');
    try { await handleUpdate(body); } catch (e) { console.error(e); }
    return reply(200, 'ok');
  }
  try { return reply(200, JSON.stringify(await appApi(body)), 'application/json'); }
  catch (e) { console.error(e); return reply(200, JSON.stringify({ ok: false, error: 'server' }), 'application/json'); }
};

function reply(code, body, type) {
  return { statusCode: code, headers: { 'Content-Type': type || 'text/plain', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: body };
}
function lower(h) { const o = {}; Object.keys(h).forEach(k => { o[k.toLowerCase()] = h[k]; }); return o; }

/* ================= Настройка (один раз) ================= */
async function setup(key) {
  if (!TOKEN) return 'Не задана переменная BOT_TOKEN';
  if (key !== TOKEN) return 'Неверный ключ: после ?setup= вставьте токен бота';
  if (!BUCKET) return 'Не задана переменная BUCKET';
  if (!IAM) return 'У функции нет сервисного аккаунта — назначьте его в настройках версии';
  try { await saveData(await loadData()); } catch (e) { return 'Нет доступа к бакету: ' + e.message + '\nПроверьте имя бакета и роль storage.editor у сервисного аккаунта'; }
  const log = [];
  try { await fetch(TG + 'getMe'); } catch (e) { return 'Хранилище работает ✅\nНо облако не может достучаться до Telegram (' + TG_BASE + ').\nНужен посредник: задайте переменную TG_API.'; }
  const before = await tg('getWebhookInfo', {});
  if (before && before.result && before.result.last_error_message) log.push('Прошлая ошибка Telegram: ' + before.result.last_error_message);
  const fidm = SELF_URL.match(/\/([a-z0-9]+)$/);
  const HOOK = process.env.TG_API && fidm ? TG_BASE + '/hook/' + fidm[1] : SELF_URL;
  log.push('Адрес для сообщений: ' + HOOK);
  log.push('Webhook: ' + JSON.stringify(await tg('setWebhook', { url: HOOK, secret_token: SECRET, drop_pending_updates: true, allowed_updates: ['message'] })));
  await tg('setMyCommands', { commands: [
    { command: 'start', description: 'Открыть меню' },
    { command: 'today', description: 'Что сегодня по домикам' },
    { command: 'week', description: 'Заезды на неделю' },
    { command: 'debts', description: 'Кто должен' },
    { command: 'tasks', description: 'Дела по домикам' },
    { command: 'export', description: 'Выгрузить брони в Excel' }
  ] });
  await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Домики', web_app: { url: appUrl('') } } });
  await tg('setMyShortDescription', { short_description: 'Брони, гости, оплаты, дела и напоминания' });
  await tg('setMyDescription', { description: 'Учёт домиков: кто когда заезжает, в какой домик, кто сколько оплатил. Напоминаю о заездах и выездах. Можно писать и присылать голосовые.' });
  log.push('Готово! Теперь откройте бота и нажмите /start');
  log.push('');
  log.push('Ссылка для ежедневных напоминаний (CRON_URL):');
  log.push(SELF_URL + '?cron=' + CRON_KEY);
  return log.join('\n');
}

/* ================= Хранилище (Object Storage) ================= */
const BLANK = () => ({ cfg: null, bookings: [], tasks: [], owners: [], lastRemind: '' });
async function loadData() {
  const r = await fetch('https://storage.yandexcloud.net/' + BUCKET + '/data.json', { headers: { 'X-YaCloud-SubjectToken': IAM } });
  if (r.status === 404) return BLANK();
  if (!r.ok) throw new Error('storage ' + r.status);
  return Object.assign(BLANK(), await r.json());
}
async function saveData(d, name) {
  const r = await fetch('https://storage.yandexcloud.net/' + BUCKET + '/' + (name || 'data.json'), {
    method: 'PUT', headers: { 'X-YaCloud-SubjectToken': IAM, 'Content-Type': 'application/json' }, body: JSON.stringify(d)
  });
  if (!r.ok) throw new Error('storage ' + r.status);
}
const getCfg = d => d.cfg || { cabins: [1, 2, 3, 4].map(i => ({ id: i, name: 'Домик ' + i, price: 0 })) };
function upsert(list, x) { const i = list.findIndex(y => y.id === x.id); if (i >= 0) list[i] = x; else list.push(x); }

/* ================= API для приложения ================= */
async function appApi(body) {
  const user = verify(body.initData);
  if (!user) return { ok: false, error: 'auth' };
  const d = await loadData();
  if (!d.owners.length) d.owners = [user.id];
  if (d.owners.indexOf(user.id) < 0) return { ok: false, error: 'forbidden' };
  switch (body.action) {
    case 'load': return { ok: true, cfg: d.cfg, bookings: d.bookings, tasks: d.tasks };
    case 'save': if (body.booking && body.booking.id) upsert(d.bookings, body.booking); break;
    case 'delete': d.bookings = d.bookings.filter(b => b.id !== body.id); break;
    case 'saveTask': if (body.task && body.task.id) upsert(d.tasks, body.task); break;
    case 'deleteTask': d.tasks = d.tasks.filter(t => t.id !== body.id); break;
    case 'cfg': if (body.cfg && body.cfg.cabins) d.cfg = body.cfg; break;
    case 'import':
      if (body.cfg && !d.cfg) d.cfg = body.cfg;
      (body.bookings || []).forEach(b => b && b.id && upsert(d.bookings, b));
      (body.tasks || []).forEach(t => t && t.id && upsert(d.tasks, t));
      break;
    default: return { ok: false, error: 'action' };
  }
  await saveData(d);
  return { ok: true };
}

function verify(initData) {
  if (!initData || !TOKEN) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, v]) => k + '=' + v).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const h = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (h !== hash) return null;
  if (Date.now() / 1000 - (+p.get('auth_date') || 0) > 30 * 86400) return null;
  try { return JSON.parse(p.get('user')); } catch (e) { return null; }
}

/* ================= Бот ================= */
async function handleUpdate(u) {
  const msg = u.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private' || !msg.from) return;
  const id = msg.from.id, text = (msg.text || '').trim();
  const d = await loadData();
  if (!d.owners.length) { d.owners = [id]; await saveData(d); }
  if (d.owners.indexOf(id) < 0) {
    return send(id, 'Это личный бот для учёта домиков.\n\nВаш ID: <code>' + id + '</code>\nЧтобы получить доступ, попросите владельца отправить боту:\n<code>/add ' + id + '</code>');
  }
  const cmd = text.split(/\s+/)[0].split('@')[0];
  if (cmd === '/add') {
    const nid = +text.split(/\s+/)[1];
    if (!nid) return send(id, 'Напишите так: <code>/add 123456789</code>');
    if (d.owners.indexOf(nid) < 0) { d.owners.push(nid); await saveData(d); }
    await send(nid, 'Вам открыли доступ к боту «Мои домики». Нажмите /start');
    return send(id, 'Доступ открыт. Этот человек тоже будет получать напоминания.');
  }
  if (cmd === '/remove') {
    const nid = +text.split(/\s+/)[1];
    if (!nid) return send(id, 'Напишите так: <code>/remove 123456789</code>\nСписок всех, у кого есть доступ: /users');
    if (nid === d.owners[0]) return send(id, 'Главного владельца бота убрать нельзя.');
    if (d.owners.indexOf(nid) < 0) return send(id, 'У этого человека и так нет доступа.');
    d.owners = d.owners.filter(x => x !== nid); await saveData(d);
    await send(nid, 'Доступ к боту «Мои домики» закрыт. Спасибо, что помогли проверить 🙂');
    return send(id, 'Готово, доступ убран. Напоминания этому человеку больше не придут.');
  }
  if (cmd === '/users') {
    return send(id, '👥 Доступ к боту:\n' + d.owners.map((x, i) => '• <code>' + x + '</code>' + (i === 0 ? ' — владелец' : '') + (x === id ? ' (вы)' : '')).join('\n') + (d.owners.length > 1 ? '\n\nУбрать: <code>/remove ID</code>' : ''));
  }
  if (cmd === '/start') {
    await send(id, '👋 Привет' + (msg.from.first_name ? ', ' + esc(msg.from.first_name) : '') + '!\n\n' +
      'Здесь всё про домики: брони, гости, оплаты и дела.\n' +
      '⏰ О каждом заезде напомню за 2 дня и за день, о выезде — за день.\n\n' +
      '🎤 Можно прислать голосовое или написать, например:\n' +
      '• <i>С 5 по 16 ноября заезжает Александр в третий домик, предоплата 5 тысяч</i>\n' +
      '• <i>Починить кран в третьем доме</i>\n\n' +
      'Приложение открывается кнопкой ниже или кнопкой «Домики» слева от поля ввода.',
      { inline_keyboard: [[{ text: '🏡 Открыть приложение', web_app: { url: appUrl('') } }]] });
    return send(id, 'Быстрые кнопки — внизу 👇', mainKb());
  }
  if (cmd === '/today' || text === BTN.today) return send(id, todayText(d), openKb());
  if (cmd === '/week' || text === BTN.week) return send(id, weekText(d), openKb());
  if (cmd === '/debts' || text === BTN.debts) return send(id, debtsText(d), openKb());
  if (cmd === '/tasks' || text === BTN.tasks) return send(id, tasksText(d), openKb('&tab=tasks'));
  if (cmd === '/export') return sendExport(id, d);
  if (msg.voice || msg.audio) return handleVoice(id, msg.voice || msg.audio, d);
  if (text && text[0] !== '/') return handleFreeText(id, text, d);
  return send(id, 'Выберите кнопку внизу 👇', mainKb());
}

async function handleVoice(id, v, d) {
  if ((v.duration || 0) > 30) return send(id, '🎤 Голосовое длиннее 30 секунд — запишите, пожалуйста, покороче.');
  let text = '';
  try {
    const f = await tg('getFile', { file_id: v.file_id });
    const audio = Buffer.from(await (await fetch(TG_BASE + '/file/bot' + TOKEN + '/' + f.result.file_path)).arrayBuffer());
    const r = await fetch('https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?lang=ru-RU&format=oggopus', {
      method: 'POST', headers: { Authorization: 'Bearer ' + IAM }, body: audio
    });
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j));
    text = (j.result || '').trim();
  } catch (e) {
    console.error('voice', e);
    return send(id, '🎤 Не получилось распознать голосовое. Попробуйте ещё раз или напишите текстом.');
  }
  if (!text) return send(id, '🎤 Ничего не расслышала. Попробуйте ещё раз, чуть громче.');
  await send(id, '🎤 Услышала: «' + esc(text) + '»');
  return handleFreeText(id, text, d);
}

async function handleFreeText(id, text, d) {
  const cfg = getCfg(d), r = parseText(text, todayStr(), cfg.cabins);
  if (r.kind === 'task') {
    const fresh = await loadData();
    fresh.tasks.push({ id: crypto.randomUUID().slice(0, 12), text: r.task.text, cabin: r.task.cabin || 0, important: !!r.task.important, done: false, created: todayStr() });
    await saveData(fresh);
    return send(id, '✅ Записала в дела' + (r.task.important ? ' (важно)' : '') + ':\n<b>' + esc(r.task.text) + '</b>\n🏡 ' + esc(r.task.cabin ? cabinName(r.task.cabin, cfg) : 'Общее'), openKb('&tab=tasks'));
  }
  if (r.kind === 'booking') {
    const b = r.booking, n = b.inDate && b.outDate ? diff(b.inDate, b.outDate) : 0, dr = {};
    Object.keys(b).forEach(k => { const v = b[k]; if (v !== '' && v !== null && v !== 0 && v !== false) dr[k] = v; });
    if (!b.prepay && !b.prepayFull) delete dr.prepayMethod;
    const miss = '<i>не поняла</i>';
    const lines = ['📝 <b>Похоже на бронь — проверьте:</b>', '',
      '👤 ' + (b.name ? esc(b.name) : miss),
      '🏡 ' + (b.cabin ? esc(cabinName(b.cabin, cfg)) : miss),
      '📅 ' + (b.inDate ? fd(b.inDate) + (b.inTime ? ' ' + b.inTime : '') + ' → ' + (b.outDate ? fd(b.outDate) + ' (' + n + ' ' + nightsWord(n) + ')' : miss) : miss)];
    if (b.phone) lines.push('📞 ' + esc(b.phone));
    if (b.adults != null || b.kids) lines.push('👥 ' + (b.adults || 0) + ' взр.' + (b.kids ? ' + ' + b.kids + ' реб.' : ''));
    if (b.total) lines.push('💰 Итого ' + money(b.total)); else if (b.perNight) lines.push('💰 ' + money(b.perNight) + ' за ночь');
    if (b.prepay || b.prepayFull) lines.push('💳 Предоплата: ' + (b.prepayFull ? 'вся сумма' : money(b.prepay)) + ', ' + b.prepayMethod);
    if (b.note) lines.push('📝 ' + esc(b.note));
    lines.push('', 'Нажмите кнопку — откроется заполненная форма, останется проверить и сохранить.');
    return send(id, lines.join('\n'), { inline_keyboard: [[{ text: '✅ Проверить и сохранить', web_app: { url: appUrl('&nb=' + encodeURIComponent(JSON.stringify(dr))) } }]] });
  }
  return send(id, 'Не поняла 🙈 Напишите или скажите, например:\n<i>С 5 по 16 ноября заезжает Александр в третий домик</i>\nили\n<i>Купить простыни во второй домик</i>', mainKb());
}

function mainKb() {
  return { keyboard: [[{ text: BTN.today }, { text: BTN.week }], [{ text: BTN.debts }, { text: BTN.tasks }]], resize_keyboard: true, is_persistent: true };
}
function openKb(extra) { return { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: appUrl(extra || '') } }]] }; }

/* ================= Сводки ================= */
function todayText(d) {
  const cfg = getCfg(d), bs = d.bookings, t = todayStr(), dt = parseD(t);
  const lines = cfg.cabins.map(c => {
    const my = bs.filter(b => b.cabin == c.id);
    const inB = my.find(b => b.inDate === t), outB = my.find(b => b.outDate === t), stay = my.find(b => b.inDate < t && b.outDate > t);
    let s;
    if (inB && outB) s = '🔄 смена: ' + esc(short(outB.name)) + ' выезжает' + (outB.outTime ? ' в ' + outB.outTime : '') + ', ' + esc(short(inB.name)) + ' заезжает' + (inB.inTime ? ' в ' + inB.inTime : '') + debtMark(inB);
    else if (inB) s = '🔑 заезд' + (inB.inTime ? ' в ' + inB.inTime : '') + ': ' + esc(inB.name) + debtMark(inB);
    else if (outB) s = '🚪 выезд' + (outB.outTime ? ' в ' + outB.outTime : '') + ': ' + esc(outB.name) + debtMark(outB);
    else if (stay) s = '🟠 занят: ' + esc(stay.name) + ', до ' + fd(stay.outDate) + debtMark(stay);
    else s = '🟢 свободен';
    const nt = openTasks(d, c.id).length;
    return '<b>' + esc(c.name) + '</b> — ' + s + (nt ? ' · 🛠 ' + nt : '');
  });
  return '🏡 <b>Сегодня, ' + dt.getUTCDate() + ' ' + MONG[dt.getUTCMonth()] + '</b>\n\n' + lines.join('\n');
}
function weekText(d) {
  const cfg = getCfg(d), t = todayStr(), out = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(t, i), list = d.bookings.filter(b => b.inDate === day);
    if (!list.length) continue;
    out.push('<b>' + (i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : WD[parseD(day).getUTCDay()] + ', ' + fd(day)) + '</b>');
    list.forEach(b => out.push('• ' + esc(cabinName(b.cabin, cfg)) + ' — ' + esc(b.name) + (b.inTime ? ', ' + b.inTime : '') + (b.phone ? '\n   📞 ' + esc(b.phone) : '') + debtMark(b)));
    out.push('');
  }
  return '📅 <b>Заезды на неделю</b>\n\n' + (out.length ? out.join('\n') : 'На ближайшую неделю заездов нет');
}
function debtsText(d) {
  const cfg = getCfg(d), list = d.bookings.filter(b => debt(b) > 0).sort(byIn);
  if (!list.length) return '💰 Никто ничего не должен ✅';
  return '💰 <b>Должны всего: ' + money(list.reduce((s, b) => s + debt(b), 0)) + '</b>\n\n' + list.map(b =>
    '• ' + esc(b.name) + ' — <b>' + money(debt(b)) + '</b>\n   ' + esc(cabinName(b.cabin, cfg)) + ', ' + fd(b.inDate) + ' – ' + fd(b.outDate) + (b.phone ? '\n   📞 ' + esc(b.phone) : '')
  ).join('\n');
}
function tasksText(d) {
  const cfg = getCfg(d), open = openTasks(d);
  if (!open.length) return '🛠 Открытых дел нет ✅\n\nЧтобы добавить, напишите или скажите мне, например: <i>починить кран в третьем доме</i>';
  const out = ['🛠 <b>Дела</b>', ''];
  [{ id: 0, name: 'Общее' }].concat(cfg.cabins).forEach(g => {
    const list = open.filter(x => (+x.cabin || 0) == g.id);
    if (!list.length) return;
    out.push('<b>' + esc(g.name) + '</b>');
    list.forEach(x => out.push('• ' + esc(x.text) + (x.important ? ' ❗️' : '')));
    out.push('');
  });
  return out.join('\n');
}
function debtMark(b) { const x = debt(b); return x > 0 ? ' · ❗️долг ' + money(x) : ''; }
function openTasks(d, cab) {
  return (d.tasks || []).filter(x => !x.done && (cab == null || x.cabin == cab))
    .sort((a, b) => ((+!!b.important) - (+!!a.important)) || ((a.created || '') < (b.created || '') ? -1 : 1));
}

/* --- Выгрузка в Excel (CSV) --- */
async function sendExport(id, d) {
  const cfg = getCfg(d), ru = s => s ? s.split('-').reverse().join('.') : '';
  const cell = v => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Домик', 'Гость', 'Телефон', 'Заезд', 'Время', 'Выезд', 'Время', 'Взрослых', 'Детей', 'Цена за ночь', 'Итого', 'Оплачено', 'Долг', 'Откуда', 'Заметка']];
  d.bookings.slice().sort(byIn).forEach(b => rows.push([cabinName(b.cabin, cfg), b.name, b.phone, ru(b.inDate), b.inTime, ru(b.outDate), b.outTime, b.adults, b.kids, b.perNight, b.total, paid(b), debt(b), b.source, b.note]));
  const csv = '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  const fd2 = new FormData();
  fd2.append('chat_id', String(id));
  fd2.append('caption', '📊 Все брони (' + d.bookings.length + '). Откроется в Excel или Google Таблицах.');
  fd2.append('document', new Blob([csv], { type: 'text/csv' }), 'domiki-' + todayStr() + '.csv');
  await fetch(TG + 'sendDocument', { method: 'POST', body: fd2 });
}

/* ================= Напоминания (таймер) ================= */
async function dailyReminders() {
  const d = await loadData(), t = todayStr();
  if (!d.owners.length || d.lastRemind === t) return;
  d.lastRemind = t;
  await saveData(d);
  try { await saveData(d, 'backup/' + t + '.json'); } catch (e) {}
  for (const n of REMIND_DAYS) {
    const day = addDays(t, n);
    for (const b of d.bookings.filter(x => x.inDate === day)) for (const o of d.owners) await sendReminder(o, b, n, d);
  }
  for (const n of CHECKOUT_DAYS) {
    const day = addDays(t, n);
    for (const b of d.bookings.filter(x => x.outDate === day)) for (const o of d.owners) await sendCheckout(o, b, n, d);
  }
}

function tasksBlock(d, cab, title) {
  const tl = openTasks(d, cab);
  return tl.length ? ['', '🛠 <b>' + title + '</b>', tl.map(x => '• ' + esc(x.text) + (x.important ? ' ❗️' : '')).join('\n')] : [];
}
function sendReminder(chat, b, n, d) {
  const cfg = getCfg(d), nights = diff(b.inDate, b.outDate), p = paid(b), dbt = debt(b);
  const when = n === 0 ? 'Сегодня заезд' : n === 1 ? 'Завтра заезд' : n === 2 ? 'Послезавтра заезд' : 'Через ' + n + ' дн. заезд';
  const lines = [
    '⏰ <b>' + when + '</b> — ' + fd(b.inDate) + (b.inTime ? ', ' + esc(b.inTime) : ''), '',
    '🏡 <b>' + esc(cabinName(b.cabin, cfg)) + '</b>',
    '👤 ' + esc(b.name),
    b.phone ? '📞 ' + esc(b.phone) : '📞 телефон не указан',
    '🌙 ' + nights + ' ' + nightsWord(nights) + ', выезд ' + fd(b.outDate) + (b.outTime ? ' в ' + esc(b.outTime) : ''),
    '👥 ' + (+b.adults || 0) + ' взр.' + (+b.kids ? ' + ' + b.kids + ' реб.' : ''),
    dbt > 0 ? '❗️ Оплачено ' + money(p) + ' из ' + money(b.total) + ' — <b>осталось ' + money(dbt) + '</b>' : '✅ Оплачено полностью: ' + money(p)
  ];
  if (b.source) lines.push('📍 Откуда: ' + esc(b.source));
  if (b.note) lines.push('📝 ' + esc(b.note));
  return send(chat, lines.concat(tasksBlock(d, b.cabin, 'Не забыть в домике до заезда:')).join('\n'),
    { inline_keyboard: [[{ text: 'Открыть бронь', web_app: { url: appUrl('&b=' + encodeURIComponent(b.id)) } }]] });
}
function sendCheckout(chat, b, n, d) {
  const cfg = getCfg(d), dbt = debt(b);
  const when = n === 0 ? 'Сегодня выезд' : n === 1 ? 'Завтра выезд' : 'Через ' + n + ' дн. выезд';
  const next = d.bookings.filter(x => x.cabin == b.cabin && x.id !== b.id && x.inDate >= b.outDate).sort(byIn)[0];
  const lines = [
    '🚪 <b>' + when + '</b> — ' + fd(b.outDate) + (b.outTime ? ', ' + esc(b.outTime) : ''), '',
    '🏡 <b>' + esc(cabinName(b.cabin, cfg)) + '</b>',
    '👤 ' + esc(b.name),
    b.phone ? '📞 ' + esc(b.phone) : '📞 телефон не указан',
    dbt > 0 ? '❗️ Не доплатили: <b>' + money(dbt) + '</b> — забрать до выезда' : '✅ Всё оплачено',
    next ? '🔜 Следующие гости: ' + esc(next.name) + ', ' + fd(next.inDate) + (next.inTime ? ' в ' + esc(next.inTime) : '') + (next.inDate === b.outDate ? ' — <b>в тот же день</b>, успеть с уборкой' : '') : '🔜 Следующих гостей в этот домик пока нет'
  ];
  return send(chat, lines.concat(tasksBlock(d, b.cabin, 'Дела по домику:')).join('\n'),
    { inline_keyboard: [[{ text: 'Открыть бронь', web_app: { url: appUrl('&b=' + encodeURIComponent(b.id)) } }]] });
}

/* ================= Помощники ================= */
async function tg(method, payload) {
  const r = await fetch(TG + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  try { return await r.json(); } catch (e) { return { ok: false }; }
}
function send(chat, text, markup) {
  const p = { chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) p.reply_markup = markup;
  return tg('sendMessage', p);
}
function appUrl(extra) { return APP_URL + '?api=' + encodeURIComponent(SELF_URL) + (extra || ''); }
function todayStr() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function parseD(s) { const a = String(s).split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); }
function addDays(s, n) { const x = parseD(s); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function diff(a, b) { return Math.round((parseD(b) - parseD(a)) / 864e5); }
function fd(s) { const x = parseD(s); return x.getUTCDate() + ' ' + MONG[x.getUTCMonth()]; }
function money(n) { return String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function paid(b) { return (b.payments || []).reduce((s, p) => s + (+p.amount || 0), 0); }
function debt(b) { return Math.max(0, (+b.total || 0) - paid(b)); }
function short(n) { return String(n || '').trim().split(/\s+/)[0] || 'Гость'; }
function byIn(a, b) { return a.inDate < b.inDate ? -1 : a.inDate > b.inDate ? 1 : 0; }
function cabinName(id, cfg) { const c = cfg.cabins.find(x => x.id == id); return c ? c.name : 'Домик'; }
function nightsWord(n) { return n % 10 === 1 && n % 100 !== 11 ? 'ночь' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'ночи' : 'ночей'); }

/* ===== Разбор фразы: бронь или дело ===== */
function parseText(raw, t, cabins) {
  cabins = cabins || [];
  const src = String(raw || '').replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim();
  const P2 = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + P2(d.getMonth() + 1) + '-' + P2(d.getDate());
  const tp = t.split('-').map(Number), ty = tp[0], tm = tp[1] - 1, td = tp[2];
  const T0 = new Date(ty, tm, td);
  const plus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const UNITS = { один: 1, одна: 1, одну: 1, одного: 1, одной: 1, два: 2, две: 2, двух: 2, двое: 2, три: 3, трех: 3, трое: 3, четыре: 4, четырех: 4, четверо: 4, пять: 5, пяти: 5, пятеро: 5, шесть: 6, шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9, десять: 10, десяти: 10 };
  const ORD = [[/^перв(ый|ая|ое|ого|ом|ому|ую|ой)$/, 1], [/^втор(ой|ая|ое|ого|ом|ому|ую)$/, 2], [/^трет(ий|ья|ье|ьего|ьем|ьему|ью|ьей)$/, 3], [/^четверт(ый|ая|ое|ого|ом|ому|ую|ой)$/, 4], [/^пят(ый|ая|ое|ого|ом|ому|ую|ой)$/, 5], [/^шест(ой|ая|ое|ого|ом|ому|ую)$/, 6], [/^седьм(ой|ая|ое|ого|ом|ому|ую)$/, 7], [/^восьм(ой|ая|ое|ого|ом|ому|ую)$/, 8], [/^девят(ый|ая|ое|ого|ом|ому|ую|ой)$/, 9], [/^десят(ый|ая|ое|ого|ом|ому|ую|ой)$/, 10], [/^одиннадцат/, 11], [/^двенадцат/, 12], [/^тринадцат/, 13], [/^четырнадцат/, 14], [/^пятнадцат/, 15], [/^шестнадцат/, 16], [/^семнадцат/, 17], [/^восемнадцат/, 18], [/^девятнадцат/, 19], [/^двадцат/, 20], [/^тридцат/, 30]];
  const wn = w => { if (UNITS[w] != null) return UNITS[w]; const o = ORD.find(x => x[0].test(w)); return o ? o[1] : null; };
  const toks = src.toLowerCase().replace(/[,;!?«»"()]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].replace(/\.$/, '');
    let n = wn(w);
    if (n == null) { out.push(toks[i]); continue; }
    if ((n === 20 || n === 30) && i + 1 < toks.length) { const u = wn(toks[i + 1].replace(/\.$/, '')); if (u && u < 10) { n += u; i++; } }
    out.push(String(n));
  }
  const s = ' ' + out.join(' ') + ' ';

  /* --- даты --- */
  const MONS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  const M = '(январ[а-я]*|феврал[а-я]*|март[а-я]*|апрел[а-я]*|ма[йя]|июн[а-я]*|июл[а-я]*|август[а-я]*|сентябр[а-я]*|октябр[а-я]*|ноябр[а-я]*|декабр[а-я]*)';
  const mi = w => { if (!w) return null; if (/^ма[йя]/.test(w)) return 4; const i = MONS.findIndex(p => p !== 'ма' && w.indexOf(p) === 0); return i < 0 ? null : i; };
  const mn = x => (x && +x >= 1 && +x <= 12) ? +x - 1 : null;
  const DT = '(\\d{1,2})(?:[./](\\d{1,2}))?(?:-?(?:го|е|ое))?(?:\\s+числа)?(?:\\s+' + M + ')?';
  let d1 = null, m1 = null, d2 = null, m2 = null, r, inD = null, outD = null;
  if ((r = s.match(new RegExp('\\s(?:(?:с|со)\\s+)?' + DT + '\\s+(?:по|до)\\s+' + DT + '[\\s.]')))) {
    d1 = +r[1]; m1 = mn(r[2]) ?? mi(r[3]); d2 = +r[4]; m2 = mn(r[5]) ?? mi(r[6]);
  } else if ((r = s.match(new RegExp('\\s(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+' + M)))) {
    d1 = +r[1]; d2 = +r[2]; m2 = mi(r[3]);
  }
  const startOf = (d, m) => {
    if (m == null) { m = tm; if (d < td) m++; }
    let x = new Date(ty, m, d);
    if (x < plus(T0, -7)) x = new Date(ty + 1, m, d);
    return x;
  };
  if (d1 && d2) {
    const st = startOf(d1, m1 ?? m2);
    const em = m2 ?? st.getMonth();
    let en = new Date(st.getFullYear(), em, d2);
    if (en <= st) en = m2 == null ? new Date(st.getFullYear(), st.getMonth() + 1, d2) : new Date(st.getFullYear() + 1, em, d2);
    inD = st; outD = en;
  } else {
    if (/\sпослезавтра\s/.test(s)) inD = plus(T0, 2);
    else if (/\sзавтра\s/.test(s)) inD = plus(T0, 1);
    else if (/\sсегодня\s/.test(s)) inD = T0;
    else if ((r = s.match(new RegExp('\\s(\\d{1,2})(?:-?(?:го|е|ое))?\\s+' + M)))) inD = startOf(+r[1], mi(r[2]));
    else if ((r = s.match(/\s(\d{1,2})[./](\d{1,2})(?:[./]\d{2,4})?[\s.]/)) && mn(r[2]) != null) inD = startOf(+r[1], mn(r[2]));
    else if ((r = s.match(/\s(?:с|со)\s+(\d{1,2})(?:-?(?:го|е|ое))?(?:\s+числа)?\s/))) inD = startOf(+r[1], null);
    if (inD) {
      let n = null;
      if ((r = s.match(/\sна\s+(\d{1,2})\s*(?:ноч|сут|дн|ден)/)) || (r = s.match(/\s(\d{1,2})\s+(?:ноч|сут)/))) n = +r[1];
      else if (/\sна\s+неделю/.test(s)) n = 7;
      else if (/\sна\s+(?:ночь|сутки)/.test(s)) n = 1;
      else if (/\sна\s+выходные/.test(s)) n = 2;
      if (n) outD = plus(inD, n);
      else if ((r = s.match(new RegExp('\\s(?:по|до)\\s+(\\d{1,2})(?:-?(?:го|е|ое))?(?:\\s+числа)?(?:\\s+' + M + ')?[\\s.]')))) {
        const em = mi(r[2]) ?? inD.getMonth();
        let en = new Date(inD.getFullYear(), em, +r[1]);
        if (en <= inD) en = new Date(inD.getFullYear(), em + 1, +r[1]);
        outD = en;
      }
    }
  }

  /* --- домик --- */
  let cabin = null;
  cabins.forEach(c => { const nm = String(c.name || '').toLowerCase().replace(/ё/g, 'е').trim(); if (nm.length > 2 && !/^домик\s*\d+$/.test(nm) && s.indexOf(' ' + nm) >= 0) cabin = c.id; });
  if (cabin == null) {
    const cands = []; let m;
    const re1 = /\s(\d{1,2})(?:-?(?:й|ый|ой|ий|ом|ем))?\s+(?:домик|дом)/g; while ((m = re1.exec(s))) cands.push(+m[1]);
    const re2 = /\s(?:домик|дом)[а-я]*\s+(?:номер\s+|№\s*)?(\d{1,2})(?!\d)/g; while ((m = re2.exec(s))) cands.push(+m[1]);
    const ok = cands.find(n => n >= 1 && n <= cabins.length);
    if (ok) cabin = cabins[ok - 1].id;
  }

  /* --- телефон --- */
  let phone = '';
  (src.match(/\+?\d[\d\s\-()]{8,17}\d/g) || []).some(p => {
    let d = p.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
    if (d.length === 10) d = '7' + d;
    if (d.length !== 11) return false;
    phone = '+' + d[0] + ' ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9);
    return true;
  });

  /* --- гости --- */
  let adults = null, kids = null;
  if ((r = s.match(/\s(\d{1,2})\s+взросл/))) adults = +r[1];
  if ((r = s.match(/\s(\d{1,2})\s+(?:реб|дет|малыш)/))) kids = +r[1]; else if (/\sс\s+(?:ребенком|малышом|дочкой|сыном)/.test(s)) kids = 1;
  if (adults == null && (r = s.match(/\s(\d{1,2})\s+(?:человек|чел|гост|персон)/))) adults = +r[1];
  if (adults == null) { const g = { вдвоем: 2, втроем: 3, вчетвером: 4, впятером: 5, вшестером: 6 }; Object.keys(g).forEach(k => { if (s.indexOf(' ' + k) >= 0) adults = g[k]; }); }

  /* --- деньги --- */
  const AMT = '(\\d{1,3}(?:\\s\\d{3})+|\\d+)\\s*(тыс[а-я]*\\.?|к(?![а-я]))?';
  const amt = m => m ? Math.round(+m[1].replace(/\s/g, '') * (m[2] ? 1000 : 1)) : 0;
  const perNight = amt(s.match(new RegExp('\\s' + AMT + '\\s*(?:р[а-я]*\\.?|₽)?\\s*(?:за|в)\\s+(?:ночь|сутки)')));
  const total = amt(s.match(new RegExp('(?:за все|итого|всего|стоимость|сумма)\\s*[:\\-]?\\s*' + AMT))) || amt(s.match(new RegExp('\\s' + AMT + '\\s*(?:р[а-я]*\\.?|₽)?\\s*(?:за все|итого|всего)')));
  const prepay = amt(s.match(new RegExp('(?:предоплат[а-я]*|аванс[а-я]*|задат[а-я]*|внес[а-я]*|заплатил[а-я]*|оплатил[а-я]*|перевел[а-я]*|скинул[а-я]*)\\s+(?:уже\\s+)?(?:в размере\\s+)?' + AMT)));
  const prepayFull = /оплатил[а-я]*\s+(?:все|полностью)|полностью\s+оплат/.test(s);
  const prepayMethod = /налич/.test(s) ? 'наличные' : /карт/.test(s) ? 'карта' : 'перевод';

  /* --- время --- */
  const findTime = str => {
    const re = /(?:в|к|около)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(час[а-я]*|ч(?=[\s.])|утра|дня|вечера)?/g; let m;
    while ((m = re.exec(str))) {
      if (!m[2] && !m[3]) continue;
      let h = +m[1]; if ((m[3] === 'дня' || m[3] === 'вечера') && h < 12) h += 12;
      if (h <= 23) return P2(h) + ':' + (m[2] || '00');
    }
    return '';
  };
  const cut = s.search(/\s(?:выезд|выезжа|уезжа|уед)/);
  const outTime = cut >= 0 ? findTime(s.slice(cut)) : '';
  const inTime = findTime(cut >= 0 ? s.slice(0, cut) : s);

  /* --- имя --- */
  const STOP = ['домик', 'дом', 'доме', 'завтра', 'сегодня', 'послезавтра', 'семья', 'гости', 'гость', 'человек', 'с', 'со', 'по', 'в', 'во', 'на', 'до', 'и', 'к', 'нам', 'они', 'он', 'она', 'еще', 'уже', 'тоже', 'будет', 'будут', 'наверное', 'бронь', 'числа', 'взрослых', 'двое', 'трое', 'надо', 'нужно', 'дело', 'заезд', 'выезд', 'потом', 'вечером', 'утром', 'днем', 'ночью', 'там', 'тут', 'у', 'за', 'от', 'авито', 'суточно', 'домика', 'домики'];
  const okWord = w => { const l = w.toLowerCase(); return STOP.indexOf(l) < 0 && mi(l) == null && !/\d/.test(l) && l.length > 1; };
  const clean = x => x ? x.split(' ').filter(okWord).slice(0, 2).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '';
  const srcL = src ? src[0].toLowerCase() + src.slice(1) : '';
  const V = '(?:заезд|заезжа|заед|приезжа|приед|въезжа|въед|засел|бронир|забронир)';
  let name = '';
  const tries = [
    () => (srcL.match(new RegExp(V + '[а-я]*\\s+(?:к нам\\s+|семья\\s+|гост[а-я]*\\s+)?([А-Я][а-я]+(?:\\s+[А-Я][а-я]+)?)')) || [])[1],
    () => (src.match(new RegExp('(?:^|[\\s.])([А-Я][а-я]+(?:\\s+[А-Я][а-я]+)?)\\s+(?:' + V.slice(3, -1) + '|будет|будут|хочет)')) || [])[1],
    () => (srcL.match(/(?:на имя|для|клиент[а-я]*|гост[ья]|гостя)\s+([А-Я][а-я]+(?:\s+[А-Я][а-я]+)?)/) || [])[1],
    () => (s.match(new RegExp(V + '[а-я]*\\s+([а-я]{3,}(?:\\s+[а-я]{3,})?)')) || [])[1],
    () => { const m = src.match(/(?:^|\s)[А-Я][а-я]+(?:\s+[А-Я][а-я]+)?/g) || []; return m.map(x => clean(x.trim())).find(Boolean); }
  ];
  for (const f of tries) { name = clean(f()); if (name) break; }

  /* --- откуда, заметка --- */
  const source = /авито/.test(s) ? 'Авито' : /суточно/.test(s) ? 'Суточно' : /знаком|друз/.test(s) ? 'Знакомые' : /повторн|снова|опять|в прошлый раз/.test(s) ? 'Повторно' : /инст|вк\s|вконтакт|телеграм|соцсет/.test(s) ? 'Соцсети' : '';
  let note = '';
  if ((r = src.match(/(заметка|примечание|пожелани[а-я]*|просил[аи]?|просят|хотят)\s*[:\-–]?\s*(.+)$/i))) note = /^(заметка|примечание)/i.test(r[1]) ? r[2] : r[0];
  if (note) note = note[0].toUpperCase() + note.slice(1);

  /* --- дело --- */
  const low = s.trim();
  const isTask = /^(?:дело|задача|задание|надо|нужно|не забыть|напомни[а-я]*|важно|срочно|купить|починить|поменять|заменить|убрать|помыть|почистить|вызвать|проверить|отремонтировать|покрасить|заказать|привезти|отвезти|позвонить|вымыть|постирать|разобраться|прибрать|скосить|подкачать|докупить|отнести|забрать|сделать|повесить|прикрутить)/.test(low);
  const bookingWords = /заезж|заед|приезж|приед|въезж|въед|засел|бронь|бронир|гост|ноч|сутк/.test(s);
  let taskText = src.replace(/^(?:дело|задача|задание|не забыть|напомни(?:ть)?(?:\s+мне)?)\s*[:\-–,]?\s*/i, '').trim();
  if (taskText) taskText = taskText[0].toUpperCase() + taskText.slice(1);
  const important = /(?:^|\s)(?:важно|срочно)/.test(s);

  const kind = (isTask && !bookingWords) ? 'task' : inD ? 'booking' : (isTask || src.length > 3) ? 'task' : null;
  return {
    kind,
    booking: { name, phone, cabin, inDate: inD ? iso(inD) : '', outDate: outD ? iso(outD) : '', inTime, outTime, adults, kids, perNight, total, prepay, prepayFull, prepayMethod, source, note },
    task: { text: taskText, cabin: cabin == null ? 0 : cabin, important }
  };
}
