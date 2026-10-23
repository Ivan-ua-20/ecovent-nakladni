// Модуль «Журнал помилок»: записує збої сервера й зовнішніх сервісів і повідомляє адміністраторів у Telegram
// (не частіше одного повідомлення на тип помилки за годину). Вкладка — власник і адміністратори; зберігається 30 днів.
// Якщо недоступна сама база (напр., вичерпано денний ліміт D1), повідомлення все одно йде — з кешу в пам'яті.
import { need, loadSettings } from '../../core/common.js';

const KEEP_DAYS = 30;
const TG_EVERY_MS = 60 * 60 * 1000;

// Звідки помилка — за текстом і адресою запиту.
export function errSource(message, path = '') {
  const m = String(message || '');
  if (/D1_|SQLITE|database/i.test(m)) return 'База даних (D1)';
  if (/LP-CRM|lp-crm/i.test(m)) return 'LP-CRM';
  if (/Opendatabot/i.test(m)) return 'Opendatabot';
  if (/Нова пошта|novaposhta/i.test(m)) return 'Нова пошта';
  if (/Розетк|rozetka/i.test(m)) return 'Розетка';
  if (/Checkbox/i.test(m)) return 'Checkbox';
  if (/Telegram/i.test(m)) return 'Telegram';
  if (path.startsWith('/api/an')) return 'Аналітика';
  if (path.startsWith('/api/odb')) return 'Opendatabot';
  if (path.startsWith('/api/invoice') || path.startsWith('/api/rahunok-order')) return 'LP-CRM';
  return 'Сервер';
}
// Тип помилки для обмеження повідомлень: джерело + текст без чисел.
const kindOf = (source, message) => `${source}|${String(message || '').replace(/\d+/g, '#').slice(0, 120)}`;
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function mountErrLog(app, { db, fetchFn, onCleanup, shared = {} }) {
  shared.errTg ||= { sentAt: new Map(), token: '', chats: [], at: 0 };
  const mem = shared.errTg;
  onCleanup(() => db.run(`DELETE FROM error_log WHERE at < ?`, [new Date(Date.now() - KEEP_DAYS * 86400000).toISOString()]));

  // Кому писати: власник і адміни з підключеним Telegram (кеш на 10 хв — на випадок недоступної бази).
  async function recipients() {
    if (Date.now() - mem.at < 10 * 60000 && mem.token) return mem;
    try {
      const s = await loadSettings(db);
      const rows = await db.all(`SELECT tg_chat_id FROM users WHERE active = 1 AND role IN ('owner', 'admin', 'admin_lite') AND tg_chat_id != ''`);
      Object.assign(mem, { token: s.tg_token || '', chats: rows.map((r) => r.tg_chat_id), at: Date.now() });
    } catch { /* база недоступна — лишаємо, що було в пам'яті */ }
    return mem;
  }

  async function tgOnce(kind, text) {
    const last = mem.sentAt.get(kind) || 0;
    if (Date.now() - last < TG_EVERY_MS) return;
    // Між різними копіями сервера — позначка в базі (якщо база доступна).
    try {
      const row = await db.get(`SELECT value FROM settings WHERE key = 'err_tg'`);
      const map = row?.value ? JSON.parse(row.value) : {};
      if (Date.now() - (map[kind] || 0) < TG_EVERY_MS) { mem.sentAt.set(kind, map[kind]); return; }
      for (const k of Object.keys(map)) if (Date.now() - map[k] > 24 * 3600e3) delete map[k];
      map[kind] = Date.now();
      await db.run(`INSERT INTO settings (key, value) VALUES ('err_tg', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(map)]);
    } catch { /* база недоступна — обмежуємо лише в пам'яті */ }
    mem.sentAt.set(kind, Date.now());
    const { token, chats } = await recipients();
    if (!token) return;
    for (const chat of chats.slice(0, 10)) {
      try {
        await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        });
      } catch { /* не критично */ }
    }
  }

  // Записати помилку. Ніколи не кидає — журнал не має ламати відповідь користувачу.
  async function log(err, { path = '', user = '', source = '' } = {}) {
    try {
      const message = String(err?.message || err || '').slice(0, 1000);
      const src = source || errSource(message, path);
      try {
        await db.run(`INSERT INTO error_log (at, source, message, path, user_name) VALUES (?, ?, ?, ?, ?)`,
          [new Date().toISOString(), src, message, String(path).slice(0, 200), String(user).slice(0, 80)]);
      } catch { /* база недоступна */ }
      await tgOnce(kindOf(src, message), `⚠️ <b>Помилка: ${h(src)}</b>\n${h(message.slice(0, 500))}${path ? `\n<i>${h(path)}</i>` : ''}${user ? `\nКористувач: ${h(user)}` : ''}\n\nПовторні такі самі — не частіше разу на годину. Деталі: «Налаштування → Журнал помилок».`);
    } catch { /* журнал не має ламати основну роботу */ }
  }

  app.get('/api/errors', async (c) => {
    need(c, 'users');
    const src = String(c.req.query('source') || '');
    const rows = await db.all(
      `SELECT id, at, source, message, path, user_name FROM error_log ${src ? 'WHERE source = ?' : ''} ORDER BY id DESC LIMIT 300`,
      src ? [src] : [],
    );
    const sources = await db.all(`SELECT source, COUNT(*) AS n, MAX(at) AS last FROM error_log GROUP BY source ORDER BY last DESC`);
    return c.json({ rows, sources, keepDays: KEEP_DAYS });
  });

  app.delete('/api/errors', async (c) => {
    need(c, 'users');
    await db.run(`DELETE FROM error_log`);
    return c.json({ ok: true });
  });

  return { log };
}
