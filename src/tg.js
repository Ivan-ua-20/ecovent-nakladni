// Telegram-бот для сповіщень про оплати: власник вставляє токен бота, кожен користувач підключає себе кнопкою.
import { randomToken } from './auth.js';

const TG = 'https://api.telegram.org';
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nf = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uah = (n) => `${nf.format(Number(n) || 0)} ₴`;
const kyivAt = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms)).replace(' ', 'T');

export function mountTg(app, { db, fetchFn, settings, need, fail }) {
  const putSetting = (key, value) => db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)],
  );
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
    await tg(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message'] });
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
    await db.run(`UPDATE users SET tg_chat_id = '', tg_code = '' WHERE id = ?`, [c.get('user').id]);
    return c.json({ ok: true });
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
    const msg = upd.message;
    const chat = msg?.chat?.id;
    if (!chat) return c.json({ ok: true });
    const m = /^\/start(?:@\w+)?\s+([0-9a-f]{24})\b/.exec(String(msg.text || ''));
    let reply = 'Щоб отримувати сповіщення про оплати, відкрийте сайт, натисніть «Telegram» угорі і потім «Підключити Telegram».';
    if (m) {
      const u = await db.get(`SELECT id, name, login, tg_code FROM users WHERE tg_code LIKE ? AND active = 1`, [`${m[1]}|%`]);
      const exp = Number(String(u?.tg_code || '').split('|')[1]) || 0;
      if (u && exp > Date.now()) {
        await db.run(`UPDATE users SET tg_chat_id = ?, tg_code = '' WHERE id = ?`, [String(chat), u.id]);
        reply = `✅ Готово, ${h(u.name || u.login)}! Сюди надходитимуть сповіщення про оплату ваших рахунків.`;
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
    const admins = await db.all(`SELECT id, tg_chat_id, tg_all_links, tg_all_tx FROM users WHERE active = 1 AND tg_chat_id != '' AND role IN ('owner', 'admin') AND (tg_all_links = 1 OR tg_all_tx = 1)`);
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
        : recent.map((r) => `<b>💰 ${uah(r.amount)}</b> → ${h(accs.get(r.iban) || r.iban)}\nВід: ${h(r.payer_name || '—')}\n<i>${h(r.purpose).slice(0, 200)}</i>`);
      for (const a of txAdmins) for (const t of texts) out.push([a.tg_chat_id, t]);
    }
    let sent = 0;
    for (const [chat, text] of out.slice(0, 15)) {
      try { await tg(s.tg_token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }); sent++; } catch { /* користувач міг заблокувати бота */ }
    }
    return sent;
  }

  return { notify };
}
