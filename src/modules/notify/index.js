// Telegram-бот для сповіщень про оплати: власник вставляє токен бота, кожен користувач підключає себе кнопкою.
import { randomToken } from '../../core/auth.js';
import { fail, need, nowIso, loadSettings, putSetting as putSettingDb } from '../../core/common.js';

// Назва акаунта Telegram: ім'я та @username.
const tgName = (x) => `${[x?.first_name, x?.last_name].filter(Boolean).join(' ')}${x?.username ? ` (@${x.username})` : ''}`.trim().slice(0, 120) || `id ${x?.id ?? ''}`;

const TG = 'https://api.telegram.org';
// Які оновлення приймає бот: повідомлення і натискання кнопок (документи до закупівель). Зміна — новий HOOK_V.
const ALLOWED_UPDATES = ['message', 'callback_query'];
const HOOK_V = '2';
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nf = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uah = (n) => `${nf.format(Number(n) || 0)} ₴`;
const kyivAt = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms)).replace(' ', 'T');

export function mountTg(app, { db, fetchFn, services = {} }) {
  const settings = () => loadSettings(db);
  const putSetting = (key, value) => putSettingDb(db, key, value);
  async function tg(token, method, body) {
    const r = await fetchFn(`${TG}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    let j = null;
    try { j = await r.json(); } catch { /* */ }
    if (!j?.ok) throw fail(400, `Telegram: ${j?.description || `помилка ${r.status}`}`);
    return j.result;
  }

  // ---------- налаштування бота (власник і адміни) ----------
  app.put('/api/tg/settings', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const token = String(b.token || '').trim();
    if (!token) {
      const s = await settings();
      if (s.tg_token) await tg(s.tg_token, 'deleteWebhook', {}).catch(() => {});
      await db.batch([[`DELETE FROM settings WHERE key IN ('tg_token', 'tg_bot', 'tg_secret')`, []]]);
      return c.json({ ok: true, bot: '' });
    }
    if (!/^\d+:[\w-]{20,}$/.test(token)) throw fail(400, 'Схоже, це не токен бота. Він виглядає так: 1234567890:AAH…');
    const me = await tg(token, 'getMe');
    const secret = randomToken(16);
    const url = `${new URL(c.req.url).origin}/api/tg/hook`;
    await tg(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ALLOWED_UPDATES });
    await putSetting('tg_hook_v', HOOK_V);
    await putSetting('tg_token', token);
    await putSetting('tg_bot', me.username || '');
    await putSetting('tg_secret', secret);
    return c.json({ ok: true, bot: me.username || '' });
  });

  // ---------- мій Telegram ----------
  app.get('/api/tg/me', async (c) => {
    const s = await settings();
    const u = await db.get(`SELECT tg_chat_id, tg_all_links, tg_all_tx FROM users WHERE id = ?`, [c.get('user').id]);
    return c.json({ bot: s.tg_bot || '', connected: Boolean(u?.tg_chat_id), allLinks: Boolean(u?.tg_all_links), allTx: Boolean(u?.tg_all_tx) });
  });

  app.post('/api/tg/link', async (c) => {
    const s = await settings();
    if (!s.tg_token || !s.tg_bot) throw fail(400, 'Telegram-бота ще не підключено — зверніться до власника або адміністратора.');
    const code = randomToken(12);
    await db.run(`UPDATE users SET tg_code = ? WHERE id = ?`, [`${code}|${Date.now() + 15 * 60000}`, c.get('user').id]);
    return c.json({ url: `https://t.me/${s.tg_bot}?start=${code}` });
  });

  app.delete('/api/tg/me', async (c) => {
    await db.run(`UPDATE users SET tg_chat_id = '', tg_code = '', tg_name = '', tg_linked_at = '' WHERE id = ?`, [c.get('user').id]);
    return c.json({ ok: true });
  });

  // ---------- хто підключив бота (для сторінки «Користувачі» і команди партнера) ----------
  // Підключені раніше (без збереженої назви) — назву акаунта бере getChat, по кілька за раз.
  async function fillTgNames(limit = 15) {
    const s = await settings();
    if (!s.tg_token) return 0;
    const rows = await db.all(`SELECT id, tg_chat_id FROM users WHERE tg_chat_id != '' AND COALESCE(tg_name, '') = '' LIMIT ?`, [limit]);
    let n = 0;
    for (const r of rows) {
      const ch = await tg(s.tg_token, 'getChat', { chat_id: r.tg_chat_id }).catch(() => null);
      await db.run(`UPDATE users SET tg_name = ? WHERE id = ?`, [ch ? tgName(ch) : '(недоступний — бота заблоковано?)', r.id]);
      n++;
    }
    return n;
  }
  app.get('/api/users/tg', async (c) => {
    need(c, 'people');
    await fillTgNames().catch(() => 0);
    const s = await settings();
    const rows = await db.all(`SELECT id, tg_chat_id, tg_name, tg_linked_at FROM users WHERE role != 'partner'`);
    return c.json({ bot: s.tg_bot || '', users: rows.map((r) => ({ id: r.id, connected: Boolean(r.tg_chat_id), name: r.tg_name || '', at: r.tg_linked_at || '' })) });
  });

  app.put('/api/tg/me', async (c) => {
    need(c, 'users');
    const b = await c.req.json();
    await db.run(`UPDATE users SET tg_all_links = ?, tg_all_tx = ? WHERE id = ?`, [b.allLinks ? 1 : 0, b.allTx ? 1 : 0, c.get('user').id]);
    return c.json({ ok: true });
  });

  // ---------- повідомлення від Telegram (без входу; перевірка секрету) ----------
  app.post('/api/tg/hook', async (c) => {
    const s = await settings();
    if (!s.tg_token || !s.tg_secret || c.req.header('x-telegram-bot-api-secret-token') !== s.tg_secret) return c.json({ ok: false }, 401);
    const upd = await c.req.json().catch(() => ({}));
    const base = new URL(c.req.url).origin;
    // Вебхук, налаштований до появи кнопок, — оновлюємо один раз (тепер ще й натискання кнопок).
    if (s.tg_hook_v !== HOOK_V) {
      await tg(s.tg_token, 'setWebhook', { url: `${base}/api/tg/hook`, secret_token: s.tg_secret, allowed_updates: ALLOWED_UPDATES }).catch(() => {});
      await putSetting('tg_hook_v', HOOK_V);
    }
    // Натискання кнопки під повідомленням бота (документи до закупівель).
    if (upd.callback_query) {
      const cq = upd.callback_query;
      const u = await db.get(`SELECT * FROM users WHERE tg_chat_id = ? AND active = 1`, [String(cq.from?.id || '')]);
      let note = '';
      try { note = (await services.b2b?.tgCallback?.(cq, u || null, base)) || ''; } catch (e) { note = String(e.message || e).slice(0, 150); }
      await tg(s.tg_token, 'answerCallbackQuery', { callback_query_id: cq.id, text: typeof note === 'string' ? note : '' }).catch(() => {});
      return c.json({ ok: true });
    }
    const msg = upd.message;
    const chat = msg?.chat?.id;
    if (!chat) return c.json({ ok: true });
    // Групи (B2B: група партнера). Бота додають у групу і пишуть /link КОД із картки партнера.
    if (['group', 'supergroup'].includes(msg.chat.type)) {
      const b2b = services.b2b;
      if (msg.migrate_to_chat_id) { await b2b?.tgGroupMoved?.(String(chat), String(msg.migrate_to_chat_id)); return c.json({ ok: true }); }
      if (msg.left_chat_member?.is_bot && msg.left_chat_member.username === s.tg_bot) { await b2b?.tgGroupLeft?.(String(chat)); return c.json({ ok: true }); }
      // Файл у групі: маркування (відповідь боту в групі партнера) або рахунок / накладна («Фінансові питання»).
      if (msg.document || msg.photo) {
        try { await services.b2b?.tgGroupMessage?.(msg, base); } catch (e) { console.error('tg group file', e); }
        return c.json({ ok: true });
      }
      const g = /^\/(?:link|start)(?:@\w+)?\s+([0-9a-f]{12,24})\b/i.exec(String(msg.text || ''));
      if (!g) return c.json({ ok: true }); // звичайні повідомлення в групі бот ігнорує
      const reply = (await b2b?.tgGroupLink?.(g[1].toLowerCase(), String(chat), msg.chat.title || '')) || 'Код не підійшов. Візьміть новий код у картці партнера на сайті.';
      await tg(s.tg_token, 'sendMessage', { chat_id: chat, text: reply, parse_mode: 'HTML' }).catch(() => {});
      return c.json({ ok: true });
    }
    const m = /^\/start(?:@\w+)?\s+([0-9a-f]{24})\b/.exec(String(msg.text || ''));
    // Особисто боту: файл (рахунок, накладна) або відповідь на питання бота — від підключеного користувача.
    if (!m && msg.chat.type === 'private') {
      const u = await db.get(`SELECT * FROM users WHERE tg_chat_id = ? AND active = 1`, [String(chat)]);
      if (u && await services.b2b?.tgPrivate?.(msg, u, base)) return c.json({ ok: true });
    }
    let reply = 'Щоб отримувати сповіщення, відкрийте сайт, натисніть «Telegram» угорі і потім «Підключити Telegram».';
    if (m) {
      const u = await db.get(`SELECT id, name, login, tg_code FROM users WHERE tg_code LIKE ? AND active = 1`, [`${m[1]}|%`]);
      const exp = Number(String(u?.tg_code || '').split('|')[1]) || 0;
      if (u && exp > Date.now()) {
        await db.run(`UPDATE users SET tg_chat_id = ?, tg_code = '', tg_name = ?, tg_linked_at = ? WHERE id = ?`, [String(chat), tgName(msg.from || msg.chat), nowIso(), u.id]);
        reply = `✅ Готово, ${h(u.name || u.login)}! Сюди надходитимуть ваші сповіщення.`;
      } else {
        reply = 'Посилання для підключення застаріло. Натисніть «Підключити Telegram» на сайті ще раз.';
      }
    }
    await tg(s.tg_token, 'sendMessage', { chat_id: chat, text: reply, parse_mode: 'HTML' }).catch(() => {});
    return c.json({ ok: true });
  });

  // ---------- розсилка: оплачені посилання і нові надходження ----------
  const LABEL = { paid: '✅ Оплачено', over: '✅ Оплачено (переплата)', partial: '🟡 Часткова оплата' };
  async function notify({ linkIds = [], freshRows = [] }) {
    const s = await settings();
    if (!s.tg_token) return 0;
    const out = []; // [chatId, text]
    const admins = await db.all(`SELECT id, tg_chat_id, tg_all_links, tg_all_tx FROM users WHERE active = 1 AND tg_chat_id != '' AND role IN ('owner', 'admin', 'admin_lite') AND (tg_all_links = 1 OR tg_all_tx = 1)`);
    if (linkIds.length) {
      const links = await db.all(
        `SELECT l.id, l.number, l.amount, l.paid_amount, l.status, l.client, l.created_by_id, l.created_by, COALESCE(NULLIF(a.name, ''), NULLIF(a.alias, ''), a.iban) AS alias, u.tg_chat_id AS chat
         FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id LEFT JOIN users u ON u.id = l.created_by_id AND u.active = 1
         WHERE l.id IN (SELECT value FROM json_each(?))`, [JSON.stringify(linkIds)],
      );
      for (const l of links) {
        const text = `<b>${LABEL[l.status] || 'Оплата'}: рахунок № ${h(l.number)}</b>\n${uah(l.paid_amount)} з ${uah(l.amount)}${l.client ? ` · ${h(l.client)}` : ''}\n${h(l.alias || '')}${l.created_by ? `\nСтворив(ла): ${h(l.created_by)}` : ''}`;
        const chats = new Set();
        if (l.chat) chats.add(l.chat);
        for (const a of admins) if (a.tg_all_links) chats.add(a.tg_chat_id);
        for (const ch of chats) out.push([ch, text]);
      }
    }
    // нові надходження (не старіші за добу — щоб не розсилати історію)
    const since = kyivAt(Date.now() - 86400000);
    const recent = freshRows.filter((r) => r.date >= since);
    const txAdmins = admins.filter((a) => a.tg_all_tx);
    if (recent.length && txAdmins.length) {
      const accs = new Map((await db.all(`SELECT iban, COALESCE(NULLIF(name, ''), NULLIF(alias, ''), iban) AS alias FROM odb_accounts`)).map((a) => [a.iban, a.alias]));
      const texts = recent.length > 5
        ? [`<b>💰 Нові надходження: ${recent.length}</b> на суму ${uah(recent.reduce((t, r) => t + r.amount, 0))}`]
        : recent.map((r) => `<b>💰 ${uah(r.amount)}</b> → ${h(accs.get(r.iban) || r.iban)}\nВід: ${h(r.payer_name || '—')}\n<i>${h(String(r.purpose || '').slice(0, 200))}</i>`);
      for (const a of txAdmins) for (const t of texts) out.push([a.tg_chat_id, t]);
    }
    let sent = 0;
    for (const [chat, text] of out.slice(0, 15)) {
      try { await tg(s.tg_token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }); sent++; } catch { /* користувач міг заблокувати бота */ }
    }
    return sent;
  }

  // Довільне повідомлення: адміністраторам (власник і адміни з підключеним Telegram) або вказаним користувачам.
  async function sendText({ admins = false, userIds = [], partnerId = null, chatIds = [] }, text) {
    const s = await settings();
    if (!s.tg_token) return 0;
    const chats = new Set(chatIds.filter(Boolean).map(String));
    if (admins) for (const r of await db.all(`SELECT tg_chat_id FROM users WHERE active = 1 AND tg_chat_id != '' AND role IN ('owner', 'admin', 'admin_lite')`)) chats.add(r.tg_chat_id);
    if (userIds.length) for (const r of await db.all(`SELECT tg_chat_id FROM users WHERE active = 1 AND tg_chat_id != '' AND id IN (SELECT value FROM json_each(?))`, [JSON.stringify(userIds)])) chats.add(r.tg_chat_id);
    if (partnerId) for (const r of await db.all(`SELECT tg_chat_id FROM users WHERE active = 1 AND tg_chat_id != '' AND role = 'partner' AND partner_id = ?`, [partnerId])) chats.add(r.tg_chat_id);
    let sent = 0;
    for (const chat of [...chats].slice(0, 30)) {
      try { await tg(s.tg_token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }); sent++; } catch { /* заблокував бота */ }
    }
    return sent;
  }

  // Файл (рахунок, накладна) у чати/групи — sendDocument; підпис — HTML.
  let lastMessage = null; // останнє надіслане повідомлення з файлом (щоб можна було видалити при «Скасувати»)
  async function sendFile({ chatIds = [] }, { bytes, name, mime, fileId }, caption = '') {
    const s = await settings();
    lastMessage = null;
    if (!s.tg_token || !chatIds.length) return 0;
    let sent = 0;
    for (const chat of chatIds.slice(0, 5)) {
      if (fileId) {
        // файл уже в Telegram — пересилаємо за file_id, без повторного завантаження
        const r = await tg(s.tg_token, 'sendDocument', { chat_id: chat, document: fileId, ...(caption ? { caption: caption.slice(0, 1000), parse_mode: 'HTML' } : {}) }).catch(() => null);
        if (r) { sent++; lastMessage = { chat: String(chat), id: r.message_id }; }
        continue;
      }
      const fd = new FormData();
      fd.append('chat_id', String(chat));
      if (caption) { fd.append('caption', caption.slice(0, 1000)); fd.append('parse_mode', 'HTML'); }
      fd.append('document', new Blob([bytes], { type: mime || 'application/octet-stream' }), name || 'file');
      try {
        const r = await fetchFn(`${TG}/bot${s.tg_token}/sendDocument`, { method: 'POST', body: fd });
        const j = await r.json().catch(() => null);
        if (j?.ok) { sent++; lastMessage = { chat: String(chat), id: j.result?.message_id }; }
      } catch { /* бота прибрали з групи */ }
    }
    return sent;
  }

  // Прямий виклик Bot API (кнопки, редагування повідомлень) і завантаження файлу з Telegram.
  async function api(method, body) {
    const s = await settings();
    if (!s.tg_token) throw fail(400, 'Telegram-бота не підключено.');
    return tg(s.tg_token, method, body);
  }
  async function download(fileId) {
    const s = await settings();
    const f = await tg(s.tg_token, 'getFile', { file_id: fileId });
    const r = await fetchFn(`${TG}/file/bot${s.tg_token}/${f.file_path}`);
    if (!r.ok) throw fail(502, 'Telegram: не вдалося завантажити файл.');
    return new Uint8Array(await r.arrayBuffer());
  }

  return { fillTgNames, notify, sendText, sendFile, api, download, lastFileMessage: () => lastMessage };
}
