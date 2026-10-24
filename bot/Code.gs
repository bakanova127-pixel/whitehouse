/*******************************************************
 *  Бот «Мои домики» — кнопки, сводки и напоминания
 *  Google Apps Script. Хранит брони в Google-таблице.
 *******************************************************/

// ===== 1. ЗАПОЛНИТЬ =====
const TOKEN = 'ВСТАВЬ_СЮДА_ТОКЕН_БОТА';                       // токен из @BotFather
const APP_URL = 'https://bakanova127-pixel.github.io/whitehouse/'; // адрес приложения
const SCRIPT_URL = '';  // ссылка веб-приложения (появится после «Развернуть»)

// ===== 2. МОЖНО МЕНЯТЬ =====
const TZ = 'Europe/Moscow';
const REMIND_HOUR = 10;      // во сколько присылать напоминания (примерно, в течение часа)
const REMIND_DAYS = [2, 1];  // за сколько дней до заезда напоминать. Добавьте 0 — будет и в день заезда

// =================================================================
const API = 'https://api.telegram.org/bot' + TOKEN + '/';
const P = PropertiesService.getScriptProperties();
const HEAD = ['id', 'Домик', 'Гость', 'Телефон', 'Заезд', 'Время заезда', 'Выезд', 'Время выезда',
  'Взрослых', 'Детей', 'Цена за ночь', 'Итого', 'Оплачено', 'Долг', 'Откуда', 'Заметка', 'Создано', 'data'];
const BTN = { today: '🏡 Сегодня', week: '📅 Заезды на неделю', debts: '💰 Кто должен' };
const MONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/* ---------- Запуск один раз ---------- */
function setup() {
  if (TOKEN.indexOf('ВСТАВЬ') === 0) throw new Error('Сначала вставьте токен бота в строку TOKEN');
  const url = SCRIPT_URL || ScriptApp.getService().getUrl();
  if (!url) throw new Error('Вставьте ссылку веб-приложения в строку SCRIPT_URL');
  P.setProperty('SCRIPT_URL', url);
  const sh = sheet();

  Logger.log('Webhook: ' + JSON.stringify(tg('setWebhook', { url: url, drop_pending_updates: true, allowed_updates: ['message'] })));
  tg('setMyCommands', { commands: [
    { command: 'start', description: 'Открыть меню' },
    { command: 'today', description: 'Что сегодня по домикам' },
    { command: 'week', description: 'Заезды на неделю' },
    { command: 'debts', description: 'Кто должен' }
  ] });
  tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Домики', web_app: { url: appUrl('') } } });
  tg('setMyShortDescription', { short_description: 'Брони, гости, оплаты и напоминания о заездах' });
  tg('setMyDescription', { description: 'Учёт домиков: кто когда заезжает, в какой домик, кто сколько оплатил. Бот сам напомнит о заездах за 2 дня и за день.' });

  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'dailyReminders') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReminders').timeBased().atHour(REMIND_HOUR).everyDays(1).inTimezone(TZ).create();

  Logger.log('Готово! Таблица с бронями: ' + sh.getParent().getUrl());
}

/* Пришлёт напоминание о ближайшем будущем заезде прямо сейчас — для проверки */
function testReminder() {
  const t = todayStr();
  const b = allBookings().filter(x => x.inDate >= t).sort((a, c) => a.inDate < c.inDate ? -1 : 1)[0];
  if (!b) { Logger.log('Нет будущих броней — добавьте бронь в приложении'); return; }
  getOwners().forEach(o => sendReminder(o, b, diff(t, b.inDate)));
  Logger.log('Отправлено: ' + b.name);
}

/* ---------- Каждый день ---------- */
function dailyReminders() {
  const owners = getOwners();
  if (!owners.length) return;
  const t = todayStr();
  if (P.getProperty('LAST_REMIND') === t) return;
  P.setProperty('LAST_REMIND', t);
  const bs = allBookings();
  REMIND_DAYS.forEach(n => {
    const d = addDays(t, n);
    bs.filter(b => b.inDate === d).forEach(b => owners.forEach(o => sendReminder(o, b, n)));
  });
}

function sendReminder(chat, b, n) {
  const cfg = getCfg();
  const when = n === 0 ? 'Сегодня заезд' : n === 1 ? 'Завтра заезд' : n === 2 ? 'Послезавтра заезд' : 'Через ' + n + ' дн. заезд';
  const nights = diff(b.inDate, b.outDate), p = paid(b), d = debt(b);
  const lines = [
    '⏰ <b>' + when + '</b> — ' + fd(b.inDate) + (b.inTime ? ', ' + esc(b.inTime) : ''),
    '',
    '🏡 <b>' + esc(cabinName(b.cabin, cfg)) + '</b>',
    '👤 ' + esc(b.name),
    b.phone ? '📞 ' + esc(b.phone) : '📞 телефон не указан',
    '🌙 ' + nights + ' ' + nightsWord(nights) + ', выезд ' + fd(b.outDate) + (b.outTime ? ' в ' + esc(b.outTime) : ''),
    '👥 ' + (+b.adults || 0) + ' взр.' + (+b.kids ? ' + ' + b.kids + ' реб.' : ''),
    d > 0
      ? '❗️ Оплачено ' + money(p) + ' из ' + money(b.total) + ' — <b>осталось ' + money(d) + '</b>'
      : '✅ Оплачено полностью: ' + money(p)
  ];
  if (b.source) lines.push('📍 Откуда: ' + esc(b.source));
  if (b.note) lines.push('📝 ' + esc(b.note));
  send(chat, lines.join('\n'), { inline_keyboard: [[{ text: 'Открыть бронь', web_app: { url: appUrl('&b=' + encodeURIComponent(b.id)) } }]] });
}

/* ---------- Входящие запросы ---------- */
function doGet() { return ContentService.createTextOutput('Бот работает'); }

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return; }
  if (body.update_id !== undefined) {
    const cache = CacheService.getScriptCache(), key = 'u' + body.update_id;
    if (cache.get(key)) return;
    cache.put(key, '1', 21600);
    try { handleUpdate(body); } catch (err) { console.error(err); }
    return;
  }
  return json(appApi(body));
}

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- Бот ---------- */
function handleUpdate(u) {
  const msg = u.message;
  if (!msg || !msg.chat || msg.chat.type !== 'private' || !msg.from) return;
  const id = msg.from.id, text = (msg.text || '').trim();
  let owners = getOwners();
  if (!owners.length) { owners = [id]; setOwners(owners); }
  if (owners.indexOf(id) < 0) {
    send(id, 'Это личный бот для учёта домиков.\n\nВаш ID: <code>' + id + '</code>\nЧтобы получить доступ, попросите владельца отправить боту:\n<code>/add ' + id + '</code>');
    return;
  }
  const cmd = text.split(/\s+/)[0].split('@')[0];
  if (cmd === '/add') {
    const nid = +text.split(/\s+/)[1];
    if (!nid) return send(id, 'Напишите так: <code>/add 123456789</code>');
    if (owners.indexOf(nid) < 0) { owners.push(nid); setOwners(owners); }
    send(nid, 'Вам открыли доступ к боту «Мои домики». Нажмите /start');
    return send(id, 'Доступ открыт. Этот человек тоже будет получать напоминания.');
  }
  if (cmd === '/start') {
    send(id, '👋 Привет' + (msg.from.first_name ? ', ' + esc(msg.from.first_name) : '') + '!\n\n' +
      'Здесь всё про домики: брони, гости и оплаты.\n' +
      '⏰ О каждом заезде я напомню за 2 дня и за день.\n\n' +
      'Приложение открывается кнопкой ниже или кнопкой «Домики» слева от поля ввода.',
      { inline_keyboard: [[{ text: '🏡 Открыть приложение', web_app: { url: appUrl('') } }]] });
    return send(id, 'Быстрые кнопки — внизу 👇', mainKb());
  }
  if (cmd === '/today' || text === BTN.today) return send(id, todayText(), openKb());
  if (cmd === '/week' || text === BTN.week) return send(id, weekText(), openKb());
  if (cmd === '/debts' || text === BTN.debts) return send(id, debtsText(), openKb());
  send(id, 'Выберите кнопку внизу 👇', mainKb());
}

function mainKb() {
  return { keyboard: [[{ text: BTN.today }, { text: BTN.week }], [{ text: BTN.debts }]], resize_keyboard: true, is_persistent: true };
}
function openKb() { return { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: appUrl('') } }]] }; }

function todayText() {
  const cfg = getCfg(), bs = allBookings(), t = todayStr(), d = parseD(t);
  const lines = cfg.cabins.map(c => {
    const my = bs.filter(b => b.cabin == c.id);
    const inB = my.find(b => b.inDate === t), outB = my.find(b => b.outDate === t), stay = my.find(b => b.inDate < t && b.outDate > t);
    let s;
    if (inB && outB) s = '🔄 смена: ' + esc(short(outB.name)) + ' выезжает' + (outB.outTime ? ' в ' + outB.outTime : '') + ', ' + esc(short(inB.name)) + ' заезжает' + (inB.inTime ? ' в ' + inB.inTime : '') + debtMark(inB);
    else if (inB) s = '🔑 заезд' + (inB.inTime ? ' в ' + inB.inTime : '') + ': ' + esc(inB.name) + debtMark(inB);
    else if (outB) s = '🚪 выезд' + (outB.outTime ? ' в ' + outB.outTime : '') + ': ' + esc(outB.name) + debtMark(outB);
    else if (stay) s = '🟠 занят: ' + esc(stay.name) + ', до ' + fd(stay.outDate) + debtMark(stay);
    else s = '🟢 свободен';
    return '<b>' + esc(c.name) + '</b> — ' + s;
  });
  return '🏡 <b>Сегодня, ' + d.getUTCDate() + ' ' + MONG[d.getUTCMonth()] + '</b>\n\n' + lines.join('\n');
}

function weekText() {
  const cfg = getCfg(), bs = allBookings(), t = todayStr();
  const out = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(t, i), list = bs.filter(b => b.inDate === day);
    if (!list.length) continue;
    const label = i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : WD[parseD(day).getUTCDay()] + ', ' + fd(day);
    out.push('<b>' + label + '</b>');
    list.forEach(b => out.push('• ' + esc(cabinName(b.cabin, cfg)) + ' — ' + esc(b.name) + (b.inTime ? ', ' + b.inTime : '') + (b.phone ? '\n   📞 ' + esc(b.phone) : '') + debtMark(b)));
    out.push('');
  }
  return '📅 <b>Заезды на неделю</b>\n\n' + (out.length ? out.join('\n') : 'На ближайшую неделю заездов нет');
}

function debtsText() {
  const cfg = getCfg(), list = allBookings().filter(b => debt(b) > 0).sort((a, c) => a.inDate < c.inDate ? -1 : 1);
  if (!list.length) return '💰 Никто ничего не должен ✅';
  const sum = list.reduce((s, b) => s + debt(b), 0);
  return '💰 <b>Должны всего: ' + money(sum) + '</b>\n\n' + list.map(b =>
    '• ' + esc(b.name) + ' — <b>' + money(debt(b)) + '</b>\n   ' + esc(cabinName(b.cabin, cfg)) + ', ' + fd(b.inDate) + ' – ' + fd(b.outDate) + (b.phone ? '\n   📞 ' + esc(b.phone) : '')
  ).join('\n');
}
function debtMark(b) { const d = debt(b); return d > 0 ? ' · ❗️долг ' + money(d) : ''; }

/* ---------- API для приложения ---------- */
function appApi(body) {
  const user = verify(body.initData);
  if (!user) return { ok: false, error: 'auth' };
  let owners = getOwners();
  if (!owners.length) { owners = [user.id]; setOwners(owners); }
  if (owners.indexOf(user.id) < 0) return { ok: false, error: 'forbidden' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    switch (body.action) {
      case 'load': return { ok: true, cfg: storedCfg(), bookings: allBookings() };
      case 'save': saveRow(body.booking); return { ok: true };
      case 'delete': deleteRow(body.id); return { ok: true };
      case 'cfg': setCfg(body.cfg); refreshNames(); return { ok: true };
      case 'import':
        if (body.cfg && !storedCfg()) setCfg(body.cfg);
        (body.bookings || []).forEach(saveRow);
        return { ok: true };
    }
    return { ok: false, error: 'action' };
  } finally { lock.releaseLock(); }
}

function verify(initData) {
  if (!initData) return null;
  const m = {};
  String(initData).split('&').forEach(s => {
    const i = s.indexOf('=');
    if (i > 0) m[decodeURIComponent(s.slice(0, i))] = decodeURIComponent(s.slice(i + 1).replace(/\+/g, '%20'));
  });
  const hash = m.hash;
  if (!hash) return null;
  delete m.hash;
  const dcs = Object.keys(m).sort().map(k => k + '=' + m[k]).join('\n');
  const secret = Utilities.computeHmacSha256Signature(TOKEN, 'WebAppData');
  const sig = Utilities.computeHmacSha256Signature(Utilities.newBlob(dcs).getBytes(), secret);
  const hex = sig.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
  if (hex !== hash) return null;
  if (Date.now() / 1000 - (+m.auth_date || 0) > 30 * 86400) return null;
  try { return JSON.parse(m.user); } catch (e) { return null; }
}

/* ---------- Таблица ---------- */
function sheet() {
  let ss = null;
  const id = P.getProperty('SHEET_ID');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.create('Домики — брони'); P.setProperty('SHEET_ID', ss.getId()); }
  let sh = ss.getSheetByName('Брони');
  if (!sh) { sh = ss.getSheets()[0]; sh.setName('Брони'); }
  if (sh.getLastRow() === 0) {
    sh.getRange('A:H').setNumberFormat('@');
    sh.getRange('O:R').setNumberFormat('@');
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideColumns(1);
    sh.hideColumns(HEAD.length);
  }
  return sh;
}

function allBookings() {
  const sh = sheet(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, HEAD.length, n, 1).getValues()
    .map(r => { try { return JSON.parse(r[0]); } catch (e) { return null; } })
    .filter(Boolean);
}

function rowFor(b, cfg) {
  const ru = s => s ? s.split('-').reverse().join('.') : '';
  return [b.id, cabinName(b.cabin, cfg), b.name || '', b.phone || '', ru(b.inDate), b.inTime || '', ru(b.outDate), b.outTime || '',
    +b.adults || 0, +b.kids || 0, +b.perNight || 0, +b.total || 0, paid(b), debt(b), b.source || '', b.note || '', b.created || '', JSON.stringify(b)];
}

function findRow(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function saveRow(b) {
  if (!b || !b.id) return;
  const sh = sheet(), r = findRow(sh, b.id), row = rowFor(b, getCfg());
  sh.getRange(r > 0 ? r : sh.getLastRow() + 1, 1, 1, HEAD.length).setValues([row]);
}

function deleteRow(id) { const sh = sheet(), r = findRow(sh, id); if (r > 0) sh.deleteRow(r); }

function refreshNames() {
  const sh = sheet(), n = sh.getLastRow() - 1, cfg = getCfg();
  if (n < 1) return;
  const rows = allBookings().map(b => rowFor(b, cfg));
  if (rows.length === n) sh.getRange(2, 1, n, HEAD.length).setValues(rows);
}

/* ---------- Хранилище ---------- */
function storedCfg() { try { return JSON.parse(P.getProperty('CFG') || 'null'); } catch (e) { return null; } }
function getCfg() { return storedCfg() || { cabins: [1, 2, 3, 4].map(i => ({ id: i, name: 'Домик ' + i, price: 0 })) }; }
function setCfg(c) { if (c && c.cabins) P.setProperty('CFG', JSON.stringify(c)); }
function getOwners() { try { return JSON.parse(P.getProperty('OWNERS') || '[]'); } catch (e) { return []; } }
function setOwners(a) { P.setProperty('OWNERS', JSON.stringify(a)); }

/* ---------- Помощники ---------- */
function tg(method, payload) {
  const r = UrlFetchApp.fetch(API + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  try { return JSON.parse(r.getContentText()); } catch (e) { return r.getContentText(); }
}
function send(chat, text, markup) {
  const p = { chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (markup) p.reply_markup = markup;
  return tg('sendMessage', p);
}
function appUrl(extra) { return APP_URL + '?api=' + encodeURIComponent(P.getProperty('SCRIPT_URL') || SCRIPT_URL) + (extra || ''); }
function todayStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function parseD(s) { const a = String(s).split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); }
function addDays(s, n) { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function diff(a, b) { return Math.round((parseD(b) - parseD(a)) / 864e5); }
function fd(s) { const d = parseD(s); return d.getUTCDate() + ' ' + MONG[d.getUTCMonth()]; }
function money(n) { return String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function paid(b) { return (b.payments || []).reduce((s, p) => s + (+p.amount || 0), 0); }
function debt(b) { return Math.max(0, (+b.total || 0) - paid(b)); }
function short(n) { return String(n || '').trim().split(/\s+/)[0] || 'Гость'; }
function cabinName(id, cfg) { const c = (cfg || getCfg()).cabins.find(x => x.id == id); return c ? c.name : 'Домик'; }
function nightsWord(n) { return n % 10 === 1 && n % 100 !== 11 ? 'ночь' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'ночи' : 'ночей'); }
