/*******************************************************
 *  Бот «Мои домики» — кнопки, сводки и напоминания
 *  Google Apps Script. Хранит брони в Google-таблице.
 *******************************************************/

// ===== 1. ЗАПОЛНИТЬ =====
const TOKEN = 'ВСТАВЬ_СЮДА_ТОКЕН_БОТА';                       // токен из @BotFather
const APP_URL = 'https://bakanova127-pixel.github.io/whitehouse/'; // адрес приложения
const SCRIPT_URL = '';  // ссылка веб-приложения (появится после «Развернуть»)
const RELAY_URL = '';   // адрес посредника Cloudflare, например https://tg-relay-domiki.xxx.workers.dev

// ===== 2. МОЖНО МЕНЯТЬ =====
const TZ = 'Europe/Moscow';
const REMIND_HOUR = 10;      // во сколько присылать напоминания (примерно, в течение часа)
const REMIND_DAYS = [2, 1];  // за сколько дней до заезда напоминать. Добавьте 0 — будет и в день заезда
const CHECKOUT_DAYS = [1];   // за сколько дней до выезда напоминать

// =================================================================
const API = 'https://api.telegram.org/bot' + TOKEN + '/';
const RELAY = String(RELAY_URL || '').trim().replace(/\/+$/, '');
function hex(bytes) { return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join(''); }
function sha(s) { return hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
const SECRET = sha('wh:' + TOKEN).slice(0, 48);
const P = PropertiesService.getScriptProperties();
const HEAD = ['id', 'Домик', 'Гость', 'Телефон', 'Заезд', 'Время заезда', 'Выезд', 'Время выезда',
  'Взрослых', 'Детей', 'Цена за ночь', 'Итого', 'Оплачено', 'Долг', 'Откуда', 'Заметка', 'Создано', 'data'];
const HEAD_T = ['id', 'Домик', 'Дело', 'Важно', 'Сделано', 'Создано', 'data'];
const BTN = { today: '🏡 Сегодня', week: '📅 Заезды на неделю', debts: '💰 Кто должен', tasks: '🛠 Дела' };
const MONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/* ---------- Запуск один раз ---------- */
function setup() {
  if (TOKEN.indexOf('ВСТАВЬ') === 0) throw new Error('Сначала вставьте токен бота в строку TOKEN');
  const url = SCRIPT_URL || ScriptApp.getService().getUrl();
  if (!url) throw new Error('Вставьте ссылку веб-приложения в строку SCRIPT_URL');
  P.setProperty('SCRIPT_URL', url);
  const sh = sheet();

  const hook = RELAY ? RELAY + '/tg' : url;
  Logger.log('Адрес для сообщений: ' + hook);
  Logger.log('Webhook: ' + JSON.stringify(tg('setWebhook', { url: hook, secret_token: SECRET, drop_pending_updates: true, allowed_updates: ['message'] })));
  tg('setMyCommands', { commands: [
    { command: 'start', description: 'Открыть меню' },
    { command: 'today', description: 'Что сегодня по домикам' },
    { command: 'week', description: 'Заезды на неделю' },
    { command: 'debts', description: 'Кто должен' },
    { command: 'tasks', description: 'Дела по домикам' },
    { command: 'export', description: 'Таблица со всеми бронями' }
  ] });
  tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Домики', web_app: { url: appUrl('') } } });
  tg('setMyShortDescription', { short_description: 'Брони, гости, оплаты и напоминания о заездах' });
  tg('setMyDescription', { description: 'Учёт домиков: кто когда заезжает, в какой домик, кто сколько оплатил. Бот сам напомнит о заездах за 2 дня и за день.' });

  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'dailyReminders') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReminders').timeBased().atHour(REMIND_HOUR).everyDays(1).inTimezone(TZ).create();

  Logger.log('Таблица с бронями: ' + sh.getParent().getUrl());
  if (RELAY) {
    const ping = UrlFetchApp.fetch(RELAY + '/ping', { muteHttpExceptions: true });
    Logger.log('Посредник: ' + (ping.getResponseCode() === 200 ? 'на связи ✅' : 'НЕ отвечает (' + ping.getResponseCode() + ') — проверьте RELAY_URL и код воркера'));
  }
  Logger.log('Готово! Теперь откройте бота и нажмите /start');
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
  CHECKOUT_DAYS.forEach(n => {
    const d = addDays(t, n);
    bs.filter(b => b.outDate === d).forEach(b => owners.forEach(o => sendCheckout(o, b, n, bs)));
  });
}

function sendCheckout(chat, b, n, bs) {
  const cfg = getCfg(), d = debt(b);
  const when = n === 0 ? 'Сегодня выезд' : n === 1 ? 'Завтра выезд' : 'Через ' + n + ' дн. выезд';
  const next = (bs || allBookings()).filter(x => x.cabin == b.cabin && x.id !== b.id && x.inDate >= b.outDate).sort((a, c) => a.inDate < c.inDate ? -1 : 1)[0];
  const lines = [
    '🚪 <b>' + when + '</b> — ' + fd(b.outDate) + (b.outTime ? ', ' + esc(b.outTime) : ''),
    '',
    '🏡 <b>' + esc(cabinName(b.cabin, cfg)) + '</b>',
    '👤 ' + esc(b.name),
    b.phone ? '📞 ' + esc(b.phone) : '📞 телефон не указан',
    d > 0 ? '❗️ Не доплатили: <b>' + money(d) + '</b> — забрать до выезда' : '✅ Всё оплачено',
    next ? '🔜 Следующие гости: ' + esc(next.name) + ', ' + fd(next.inDate) + (next.inTime ? ' в ' + esc(next.inTime) : '') + (next.inDate === b.outDate ? ' — <b>в тот же день</b>, успеть с уборкой' : '') : '🔜 Следующих гостей в этот домик пока нет'
  ];
  const tl = openTasks(b.cabin);
  if (tl.length) lines.push('', '🛠 <b>Дела по домику:</b>', tl.map(x => '• ' + esc(x.text) + (x.important ? ' ❗️' : '')).join('\n'));
  send(chat, lines.join('\n'), { inline_keyboard: [[{ text: 'Открыть бронь', web_app: { url: appUrl('&b=' + encodeURIComponent(b.id)) } }]] });
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
  const tl = openTasks(b.cabin);
  if (tl.length) lines.push('', '🛠 <b>Не забыть в домике до заезда:</b>', tl.map(x => '• ' + esc(x.text) + (x.important ? ' ❗️' : '')).join('\n'));
  send(chat, lines.join('\n'), { inline_keyboard: [[{ text: 'Открыть бронь', web_app: { url: appUrl('&b=' + encodeURIComponent(b.id)) } }]] });
}

/* ---------- Входящие запросы ---------- */
function doGet() { return ContentService.createTextOutput('Бот работает'); }

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return; }
  if (body.update_id !== undefined) {
    if (RELAY && body._s !== SECRET) return;
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
  if (cmd === '/remove') {
    const nid = +text.split(/\s+/)[1];
    if (!nid) return send(id, 'Напишите так: <code>/remove 123456789</code>\nСписок всех, у кого есть доступ: /users');
    if (nid === owners[0]) return send(id, 'Главного владельца бота убрать нельзя.');
    if (owners.indexOf(nid) < 0) return send(id, 'У этого человека и так нет доступа.');
    setOwners(owners.filter(x => x !== nid));
    send(nid, 'Доступ к боту «Мои домики» закрыт. Спасибо, что помогли проверить 🙂');
    return send(id, 'Готово, доступ убран. Напоминания этому человеку больше не придут.');
  }
  if (cmd === '/users') {
    return send(id, '👥 Доступ к боту:\n' + owners.map((x, i) => '• <code>' + x + '</code>' + (i === 0 ? ' — владелец' : '') + (x === id ? ' (вы)' : '')).join('\n') + (owners.length > 1 ? '\n\nУбрать: <code>/remove ID</code>' : ''));
  }
  if (cmd === '/export') return send(id, '📊 Все брони и дела — в Google-таблице:\n' + sheet().getParent().getUrl());
  if (cmd === '/start') {
    send(id, '👋 Привет' + (msg.from.first_name ? ', ' + esc(msg.from.first_name) : '') + '!\n\n' +
      'Здесь всё про домики: брони, гости, оплаты и дела.\n' +
      '⏰ О каждом заезде напомню за 2 дня и за день, о выезде — за день.\n\n' +
      '🎤 Можно прислать голосовое или просто написать, например:\n' +
      '• <i>С 5 по 16 ноября заезжает Александр в третий домик, предоплата 5 тысяч</i>\n' +
      '• <i>Починить кран в третьем доме</i>\n\n' +
      'Приложение открывается кнопкой ниже или кнопкой «Домики» слева от поля ввода.',
      { inline_keyboard: [[{ text: '🏡 Открыть приложение', web_app: { url: appUrl('') } }]] });
    return send(id, 'Быстрые кнопки — внизу 👇', mainKb());
  }
  if (cmd === '/today' || text === BTN.today) return send(id, todayText(), openKb());
  if (cmd === '/week' || text === BTN.week) return send(id, weekText(), openKb());
  if (cmd === '/debts' || text === BTN.debts) return send(id, debtsText(), openKb());
  if (cmd === '/tasks' || text === BTN.tasks) return send(id, tasksText(), openKb('&tab=tasks'));
  if (msg.voice || msg.audio) {
    const heard = transcribe(msg.voice || msg.audio);
    if (heard) { send(id, '🎤 Услышала: «' + esc(heard) + '»'); return handleFreeText(id, heard); }
    return send(id, '🎤 Не получилось распознать голосовое. Попробуйте ещё раз или продиктуйте через микрофон на клавиатуре — получится текст.', mainKb());
  }
  if (text && text[0] !== '/') return handleFreeText(id, text);
  send(id, 'Выберите кнопку внизу 👇', mainKb());
}

function handleFreeText(id, text) {
  const cfg = getCfg(), r = parseText(text, todayStr(), cfg.cabins);
  if (r.kind === 'task') {
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { saveTaskRow({ id: Utilities.getUuid().slice(0, 12), text: r.task.text, cabin: r.task.cabin || 0, important: !!r.task.important, done: false, created: todayStr() }); }
    finally { lock.releaseLock(); }
    return send(id, '✅ Записала в дела' + (r.task.important ? ' (важно)' : '') + ':\n<b>' + esc(r.task.text) + '</b>\n🏡 ' + esc(r.task.cabin ? cabinName(r.task.cabin, cfg) : 'Общее'), openKb('&tab=tasks'));
  }
  if (r.kind === 'booking') {
    const b = r.booking, n = b.inDate && b.outDate ? diff(b.inDate, b.outDate) : 0, d = {};
    Object.keys(b).forEach(k => { const v = b[k]; if (v !== '' && v !== null && v !== 0 && v !== false) d[k] = v; });
    if (!b.prepay && !b.prepayFull) delete d.prepayMethod;
    const miss = '<i>не понял</i>';
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
    return send(id, lines.join('\n'), { inline_keyboard: [[{ text: '✅ Проверить и сохранить', web_app: { url: appUrl('&nb=' + encodeURIComponent(JSON.stringify(d))) } }]] });
  }
  send(id, 'Не поняла 🙈 Напишите, например:\n<i>С 5 по 16 ноября заезжает Александр в третий домик</i>\nили\n<i>Купить простыни во второй домик</i>', mainKb());
}

function mainKb() {
  return { keyboard: [[{ text: BTN.today }, { text: BTN.week }], [{ text: BTN.debts }, { text: BTN.tasks }]], resize_keyboard: true, is_persistent: true };
}

function tasksText() {
  const cfg = getCfg(), open = openTasks();
  if (!open.length) return '🛠 Открытых дел нет ✅\n\nЧтобы добавить, просто напишите мне, например: <i>починить кран в третьем доме</i>';
  const groups = [{ id: 0, name: 'Общее' }].concat(cfg.cabins);
  const out = ['🛠 <b>Дела</b>', ''];
  groups.forEach(g => {
    const list = open.filter(x => (+x.cabin || 0) == g.id);
    if (!list.length) return;
    out.push('<b>' + esc(g.name) + '</b>');
    list.forEach(x => out.push('• ' + esc(x.text) + (x.important ? ' ❗️' : '')));
    out.push('');
  });
  return out.join('\n');
}
function openKb(extra) { return { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: appUrl(extra || '') } }]] }; }

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

/* ---------- Голосовые (распознаёт посредник Cloudflare) ---------- */
function transcribe(v) {
  if (!RELAY || !v || (v.duration || 0) > 60) return '';
  try {
    const f = tg('getFile', { file_id: v.file_id });
    const audio = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + TOKEN + '/' + f.result.file_path).getBlob().getBytes();
    const r = UrlFetchApp.fetch(RELAY + '/stt', { method: 'post', contentType: 'application/octet-stream', payload: audio, headers: { 'x-key': sha('stt:' + (P.getProperty('SCRIPT_URL') || SCRIPT_URL)) }, muteHttpExceptions: true });
    const j = JSON.parse(r.getContentText());
    return String(j.text || '').trim();
  } catch (e) { console.error(e); return ''; }
}

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
      case 'load': return { ok: true, cfg: storedCfg(), bookings: allBookings(), tasks: allTasks() };
      case 'save': saveRow(body.booking); return { ok: true };
      case 'delete': deleteRow(body.id); return { ok: true };
      case 'saveTask': saveTaskRow(body.task); return { ok: true };
      case 'deleteTask': deleteTaskRow(body.id); return { ok: true };
      case 'cfg': setCfg(body.cfg); refreshNames(); return { ok: true };
      case 'import':
        if (body.cfg && !storedCfg()) setCfg(body.cfg);
        (body.bookings || []).forEach(saveRow);
        (body.tasks || []).forEach(saveTaskRow);
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

/* --- Дела --- */
function taskSheet() {
  const ss = sheet().getParent();
  let sh = ss.getSheetByName('Дела');
  if (!sh) {
    sh = ss.insertSheet('Дела');
    sh.getRange('A:G').setNumberFormat('@');
    sh.getRange(1, 1, 1, HEAD_T.length).setValues([HEAD_T]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideColumns(1);
    sh.hideColumns(HEAD_T.length);
  }
  return sh;
}
function allTasks() {
  const sh = taskSheet(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, HEAD_T.length, n, 1).getValues()
    .map(r => { try { return JSON.parse(r[0]); } catch (e) { return null; } })
    .filter(Boolean);
}
function openTasks(cab) {
  return allTasks().filter(x => !x.done && (cab == null || x.cabin == cab))
    .sort((a, b) => ((+!!b.important) - (+!!a.important)) || ((a.created || '') < (b.created || '') ? -1 : 1));
}
function saveTaskRow(x) {
  if (!x || !x.id) return;
  const sh = taskSheet(), r = findRow(sh, x.id), cfg = getCfg();
  const row = [x.id, +x.cabin ? cabinName(x.cabin, cfg) : 'Общее', x.text || '', x.important ? 'да' : '', x.done ? (x.doneDate || 'да') : '', x.created || '', JSON.stringify(x)];
  sh.getRange(r > 0 ? r : sh.getLastRow() + 1, 1, 1, HEAD_T.length).setValues([row]);
}
function deleteTaskRow(id) { const sh = taskSheet(), r = findRow(sh, id); if (r > 0) sh.deleteRow(r); }

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
