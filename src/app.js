// Серверна частина (API). Не залежить від середовища:
// локально запускається через Node.js, на хостингу — як Cloudflare Worker.
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { ROLES, can, hashPassword, verifyPassword, randomToken, publicUser, crmLogins } from './auth.js';
import { DEFAULT_WARNING } from './schema.js';
import { mountAnalytics } from './analytics.js';
import { mountOdb, ODB_BASE } from './odb.js';
import { mountTg } from './tg.js';
import { normalizeOrder, applyEdits } from './normalize.js';
import { getOrder, getProducts, diagnose, getStatuses, getOrderCodesByStatus, getOrdersBatch } from './lpcrm.js';
import { DEMO_ORDER } from './demo.js';
import { findReceiptByRef, findReceiptForOrder, hasCheckbox, testCheckbox } from './checkbox.js';

const MASK = '••••••';
const SECRET_FOP_FIELDS = ['checkbox_password', 'checkbox_pin', 'checkbox_license'];
const FOP_FIELDS = [
  'short_name', 'full_name', 'ipn', 'address', 'iban', 'bank', 'phone', 'email', 'extra',
  'template_id', 'logo', 'signature', 'stamp',
  'checkbox_login', 'checkbox_password', 'checkbox_license', 'checkbox_pin', 'active',
];

const hash = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};

const nowIso = () => new Date().toISOString();

const publicFop = (f) => {
  if (!f) return null;
  const out = { ...f };
  for (const k of SECRET_FOP_FIELDS) out[k] = f[k] ? MASK : '';
  out.has_checkbox = hasCheckbox(f);
  return out;
};

// Для документа потрібні тільки реквізити, без доступів Checkbox.
const docFop = (f) => {
  if (!f) return null;
  const { checkbox_login, checkbox_password, checkbox_license, checkbox_pin, ...rest } = f;
  return rest;
};

const parseTpl = (t) => (t ? { ...t, options: JSON.parse(t.options || '{}') } : null);

export function createApp({ db, fetchFn: rawFetch = fetch, maxSubrequests = Infinity, odbBase = ODB_BASE }) {
  let odbApi = null;
  const app = new Hono();
  // Ліміт зовнішніх запитів на одне звернення (Cloudflare: 50). Коли вичерпано — відповідаємо «триває»,
  // і браузер сам повторює запит; пошук продовжується з того місця, де зупинився.
  let usedSubrequests = 0;
  const fetchFn = async (...args) => {
    if (++usedSubrequests > maxSubrequests) {
      throw Object.assign(new Error('Обробка триває…'), { pending: true });
    }
    return rawFetch(...args);
  };
  const receiptCache = new Map();

  const settings = async () => {
    const rows = await db.all(`SELECT key, value FROM settings`);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  };

  app.onError((err, c) => {
    if (err.pending) return c.json({ pending: true, message: err.message }, 202);
    if (!err.status) console.error(err);
    return c.json({ error: err.message || String(err) }, err.status || 500);
  });

  const fail = (status, message) => Object.assign(new Error(message), { status });
  const need = (c, perm) => {
    if (!can(c.get('user'), perm)) throw fail(403, 'Недостатньо прав для цієї дії.');
  };
  const userName = (c) => c.get('user')?.name || c.get('user')?.login || '';

  // ---------- Строк зберігання: чистимо старі версії накладних і рахунки (не частіше разу на годину) ----------
  let lastCleanup = 0;
  async function cleanup() {
    if (Date.now() - lastCleanup < 60 * 60 * 1000) return;
    lastCleanup = Date.now();
    const s = await settings();
    const days = Math.max(1, Number(s.retention_days) || 7);
    const border = new Date(Date.now() - days * 86400000).toISOString();
    await db.run(`DELETE FROM versions WHERE created_at < ?`, [border]);
    await db.run(`DELETE FROM invoices WHERE COALESCE(updated_at, created_at) < ?`, [border]);
    await db.run(`DELETE FROM sessions WHERE created_at < ?`, [new Date(Date.now() - 90 * 86400000).toISOString()]);
  }

  // ---------- Вхід ----------
  const COOKIE = 'nk_sid';
  async function sessionUser(c) {
    const token = getCookie(c, COOKIE);
    if (!token) return null;
    const u = await db.get(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1`, [token],
    );
    return u || null;
  }
  async function startSession(c, user) {
    const token = randomToken();
    await db.run(`INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)`, [token, user.id, nowIso()]);
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 90 * 86400, secure: new URL(c.req.url).protocol === 'https:' });
  }

  app.get('/api/auth/state', async (c) => {
    const n = await db.get(`SELECT COUNT(*) AS n FROM users`);
    if (!n?.n) return c.json({ needsSetup: true, user: null });
    return c.json({ needsSetup: false, user: publicUser(await sessionUser(c)) });
  });

  app.post('/api/auth/setup', async (c) => {
    const n = await db.get(`SELECT COUNT(*) AS n FROM users`);
    if (n?.n) throw fail(400, 'Власника вже створено.');
    const b = await c.req.json();
    const login = String(b.login || '').trim().toLowerCase();
    if (!login || String(b.password || '').length < 6) throw fail(400, 'Вкажіть логін і пароль (не менше 6 символів).');
    const r = await db.run(`INSERT INTO users (login, name, password_hash, role, active, created_at) VALUES (?, ?, ?, 'owner', 1, ?)`, [
      login, String(b.name || '').trim(), await hashPassword(b.password), nowIso(),
    ]);
    const user = await db.get(`SELECT * FROM users WHERE id = ?`, [r.lastId]);
    await startSession(c, user);
    return c.json({ user: publicUser(user) });
  });

  app.post('/api/auth/login', async (c) => {
    const b = await c.req.json();
    const user = await db.get(`SELECT * FROM users WHERE login = ?`, [String(b.login || '').trim().toLowerCase()]);
    if (user?.locked_until && user.locked_until > nowIso()) {
      const mins = Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 60000));
      throw fail(429, `Забагато невдалих спроб. Спробуйте через ${mins} хв.`);
    }
    if (!user || !user.active || !(await verifyPassword(String(b.password || ''), user.password_hash))) {
      if (user) {
        const n = (Number(user.failed_logins) || 0) + 1;
        const lock = n >= 5 ? new Date(Date.now() + 5 * 60000).toISOString() : '';
        await db.run(`UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?`, [lock ? 0 : n, lock, user.id]);
      }
      throw fail(401, 'Невірний логін або пароль.');
    }
    if (user.failed_logins || user.locked_until) await db.run(`UPDATE users SET failed_logins = 0, locked_until = '' WHERE id = ?`, [user.id]);
    await startSession(c, user);
    return c.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, COOKIE);
    if (token) await db.run(`DELETE FROM sessions WHERE token = ?`, [token]);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // Усе інше в /api — лише після входу.
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/odb/hook' || c.req.path === '/api/tg/hook') return next();
    const user = await sessionUser(c);
    if (!user) throw fail(401, 'Потрібно увійти.');
    c.set('user', user);
    await cleanup();
    return next();
  });

  app.put('/api/me/password', async (c) => {
    const b = await c.req.json();
    const me = c.get('user');
    if (!(await verifyPassword(String(b.old || ''), me.password_hash))) throw fail(400, 'Поточний пароль невірний.');
    if (String(b.password || '').length < 6) throw fail(400, 'Новий пароль — не менше 6 символів.');
    await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [await hashPassword(b.password), me.id]);
    return c.json({ ok: true });
  });

  // ---------- Користувачі (власник і адміністратори) ----------
  const ASSIGNABLE = ['admin', 'manager', 'viewer'];
  app.get('/api/users', async (c) => {
    need(c, 'users');
    const rows = await db.all(`SELECT * FROM users ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, login`);
    return c.json({ users: rows.map(publicUser), roles: ROLES });
  });

  app.post('/api/users', async (c) => {
    need(c, 'users');
    const b = await c.req.json();
    const login = String(b.login || '').trim().toLowerCase();
    if (!/^[a-z0-9._@-]{2,40}$/.test(login)) throw fail(400, 'Логін: латинські літери, цифри, крапка, дефіс (2–40 символів).');
    if (!ASSIGNABLE.includes(b.role)) throw fail(400, 'Невідома роль.');
    if (String(b.password || '').length < 6) throw fail(400, 'Пароль — не менше 6 символів.');
    if (await db.get(`SELECT id FROM users WHERE login = ?`, [login])) throw fail(400, 'Такий логін уже є.');
    const r = await db.run(`INSERT INTO users (login, name, password_hash, role, active, created_at, crm_logins) VALUES (?, ?, ?, ?, 1, ?, ?)`, [
      login, String(b.name || '').trim(), await hashPassword(b.password), b.role, nowIso(), crmLogins(b.crm_logins).join(','),
    ]);
    return c.json({ id: r.lastId });
  });

  app.put('/api/users/:id', async (c) => {
    need(c, 'users');
    const me = c.get('user');
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [c.req.param('id')]);
    if (!target) throw fail(404, 'Користувача не знайдено.');
    if (target.role === 'owner' && me.role !== 'owner') throw fail(403, 'Акаунт власника може змінювати лише власник.');
    const b = await c.req.json();
    const sets = [];
    const vals = [];
    if (b.name !== undefined) { sets.push('name = ?'); vals.push(String(b.name).trim()); }
    if (b.crm_logins !== undefined) { sets.push('crm_logins = ?'); vals.push(crmLogins(b.crm_logins).join(',')); }
    if (b.role !== undefined && target.role !== 'owner') {
      if (!ASSIGNABLE.includes(b.role)) throw fail(400, 'Невідома роль.');
      sets.push('role = ?'); vals.push(b.role);
    }
    if (b.active !== undefined && target.role !== 'owner') {
      if (String(target.id) === String(me.id)) throw fail(400, 'Не можна вимкнути власний акаунт.');
      sets.push('active = ?'); vals.push(b.active ? 1 : 0);
    }
    if (b.password) {
      if (String(b.password).length < 6) throw fail(400, 'Пароль — не менше 6 символів.');
      sets.push('password_hash = ?'); vals.push(await hashPassword(b.password));
    }
    if (sets.length) await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, target.id]);
    if (b.password || b.active === false || b.active === 0 || b.role !== undefined) {
      await db.run(`DELETE FROM sessions WHERE user_id = ? AND user_id != ?`, [target.id, me.id]);
    }
    return c.json({ ok: true });
  });

  // Передача прав власника: лише власник, з підтвердженням паролем. Собі він вибирає нову роль.
  app.post('/api/users/transfer-owner', async (c) => {
    const me = c.get('user');
    if (me.role !== 'owner') throw fail(403, 'Передати права може лише власник.');
    const b = await c.req.json();
    if (!(await verifyPassword(String(b.password || ''), me.password_hash))) throw fail(400, 'Невірний пароль.');
    if (!ASSIGNABLE.includes(b.myRole)) throw fail(400, 'Виберіть свою нову роль.');
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [b.userId]);
    if (!target || String(target.id) === String(me.id)) throw fail(400, 'Виберіть іншого користувача.');
    if (!target.active) throw fail(400, 'Цей акаунт вимкнено — спершу увімкніть його.');
    await db.batch([
      [`UPDATE users SET role = 'owner' WHERE id = ?`, [target.id]],
      [`UPDATE users SET role = ? WHERE id = ?`, [b.myRole, me.id]],
    ]);
    return c.json({ ok: true });
  });

  app.delete('/api/users/:id', async (c) => {
    need(c, 'users');
    const me = c.get('user');
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [c.req.param('id')]);
    if (!target) throw fail(404, 'Користувача не знайдено.');
    if (target.role === 'owner') throw fail(403, 'Акаунт власника видалити не можна.');
    if (String(target.id) === String(me.id)) throw fail(400, 'Не можна видалити власний акаунт.');
    await db.run(`DELETE FROM sessions WHERE user_id = ?`, [target.id]);
    await db.run(`DELETE FROM users WHERE id = ?`, [target.id]);
    return c.json({ ok: true });
  });

  // ---------- Довідники ----------
  app.get('/api/bootstrap', async (c) => {
    const s = await settings();
    const user = c.get('user');
    const apiOk = can(user, 'api');
    const fops = (await db.all(`SELECT * FROM fops ORDER BY active DESC, short_name`)).map(publicFop).map((f) => {
      if (apiOk) return f;
      const { checkbox_login, checkbox_password, checkbox_license, checkbox_pin, ...rest } = f;
      return rest;
    });
    const invFops = await db.all(`SELECT * FROM inv_fops ORDER BY active DESC, short_name`);
    const templates = (await db.all(`SELECT * FROM templates ORDER BY id`)).map(parseTpl);
    const offices = await db.all(`SELECT * FROM offices ORDER BY CAST(office_id AS INTEGER)`);
    const channels = await db.all(`SELECT * FROM channels ORDER BY name`);
    return c.json({
      fops,
      templates,
      offices,
      channels,
      invFops,
      defaultWarning: DEFAULT_WARNING,
      user: publicUser(user),
      settings: apiOk
        ? { ...s, lpcrm_key: s.lpcrm_key ? MASK : '', odb_key: s.odb_key ? MASK : '', tg_token: s.tg_token ? MASK : '', tg_secret: '' }
        : Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith('lpcrm_') && !k.startsWith('checkbox_') && !k.startsWith('odb_') && !k.startsWith('tg_')).concat([['lpcrm_key', s.lpcrm_key ? MASK : ''], ['lpcrm_subdomain', s.lpcrm_subdomain || '']])),
    });
  });

  app.put('/api/settings', async (c) => {
    need(c, 'refs.edit');
    const body = await c.req.json();
    const apiKeys = ['lpcrm_subdomain', 'lpcrm_key', 'lpcrm_search_days', 'checkbox_enabled', 'checkbox_search_days', 'odb_key', 'odb_name'];
    const general = ['invoice_date_mode', 'default_fop_id', 'seller_note', 'retention_days', 'rahunok_next_number'];
    const allowed = can(c.get('user'), 'api') ? [...apiKeys, ...general] : general;
    if (body.rahunok_next_number !== undefined && !/^\d{1,12}$/.test(String(body.rahunok_next_number).trim())) throw fail(400, 'Номер рахунку — лише цифри.');
    if (body.retention_days !== undefined && !(Number(body.retention_days) >= 1)) throw fail(400, 'Строк зберігання — щонайменше 1 день.');
    for (const k of allowed) {
      if (body[k] === undefined || body[k] === MASK) continue;
      await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
        k, String(body[k]).trim(),
      ]);
    }
    return c.json({ ok: true });
  });

  // ---------- ФОПи ----------
  const fopCols = (c, b) => FOP_FIELDS.filter((k) => b[k] !== undefined && b[k] !== MASK && (can(c.get('user'), 'api') || !k.startsWith('checkbox_')));
  app.post('/api/fops', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    if (!b.short_name) return c.json({ error: 'Вкажіть коротку назву ФОП' }, 400);
    const cols = fopCols(c, b);
    const r = await db.run(
      `INSERT INTO fops (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((k) => b[k]),
    );
    return c.json({ id: r.lastId });
  });

  app.put('/api/fops/:id', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    const cols = fopCols(c, b);
    if (!cols.length) return c.json({ ok: true });
    await db.run(`UPDATE fops SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
      ...cols.map((k) => b[k]), c.req.param('id'),
    ]);
    return c.json({ ok: true });
  });

  app.delete('/api/fops/:id', async (c) => {
    need(c, 'refs.edit');
    await db.run(`UPDATE fops SET active = 0 WHERE id = ?`, [c.req.param('id')]);
    return c.json({ ok: true });
  });

  app.post('/api/fops/:id/checkbox-test', async (c) => {
    need(c, 'api');
    const fop = await db.get(`SELECT * FROM fops WHERE id = ?`, [c.req.param('id')]);
    if (!fop) return c.json({ error: 'ФОП не знайдено' }, 404);
    if (!hasCheckbox(fop)) return c.json({ error: 'Не вказано доступ до Checkbox' }, 400);
    return c.json(await testCheckbox(fetchFn, fop));
  });

  // ---------- Відділи ----------
  app.put('/api/offices', async (c) => {
    need(c, 'refs.edit');
    const list = await c.req.json();
    for (const o of list) {
      if (!o.office_id) continue;
      await db.run(
        `INSERT INTO offices (office_id, name, fop_id, seller_text) VALUES (?, ?, ?, ?)
         ON CONFLICT(office_id) DO UPDATE SET name = excluded.name, fop_id = excluded.fop_id, seller_text = excluded.seller_text`,
        [String(o.office_id).trim(), o.name || '', o.fop_id || null, String(o.seller_text || '').trim()],
      );
    }
    return c.json({ ok: true });
  });

  app.put('/api/channels', async (c) => {
    need(c, 'refs.edit');
    const list = await c.req.json();
    await db.run(`DELETE FROM channels`);
    for (const ch of list) {
      const name = String(ch.name || '').trim();
      if (!name) continue;
      await db.run(`INSERT INTO channels (name, fop_id, seller_text) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET fop_id = excluded.fop_id, seller_text = excluded.seller_text`, [name, ch.fop_id || null, String(ch.seller_text || '').trim()]);
    }
    return c.json({ ok: true });
  });

  app.delete('/api/offices/:id', async (c) => {
    need(c, 'refs.edit');
    await db.run(`DELETE FROM offices WHERE office_id = ?`, [c.req.param('id')]);
    return c.json({ ok: true });
  });

  // ---------- Шаблони ----------
  app.post('/api/templates', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    const r = await db.run(`INSERT INTO templates (name, layout, options) VALUES (?, ?, ?)`, [
      b.name || 'Новий шаблон', b.layout || 'classic', JSON.stringify(b.options || {}),
    ]);
    return c.json({ id: r.lastId });
  });

  app.put('/api/templates/:id', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    await db.run(`UPDATE templates SET name = ?, layout = ?, options = ? WHERE id = ?`, [
      b.name, b.layout, JSON.stringify(b.options || {}), c.req.param('id'),
    ]);
    return c.json({ ok: true });
  });

  app.delete('/api/templates/:id', async (c) => {
    need(c, 'refs.edit');
    const id = c.req.param('id');
    const used = await db.get(`SELECT COUNT(*) AS n FROM fops WHERE template_id = ? AND active = 1`, [id]);
    if (used?.n) return c.json({ error: 'Шаблон використовується ФОПами — спершу змініть їм шаблон' }, 400);
    await db.run(`DELETE FROM templates WHERE id = ?`, [id]);
    return c.json({ ok: true });
  });

  // ---------- Діагностика LP-CRM ----------
  app.get('/api/lpcrm/diagnose/:orderId', async (c) => {
    need(c, 'api');
    const s = await settings();
    const text = await diagnose(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, c.req.param('orderId'));
    return c.json({ text });
  });

  app.get('/api/lpcrm/raw/:orderId', async (c) => {
    need(c, 'api');
    const s = await settings();
    const { raw } = await getOrder(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, c.req.param('orderId'), { fresh: true });
    return c.json(raw);
  });

  // ---------- Накладна ----------
  // ---------- Пошук замовлення за коротким номером, телефоном або ТТН ----------
  // API LP-CRM шукає замовлення лише за 11-значним кодом. Щоб працював звичний номер,
  // тримаємо локальний індекс замовлень за останні N днів і шукаємо в ньому.
  let syncing = null;
  let lastSync = 0;
  const ymd = (d) => d.toISOString().slice(0, 10);
  const digits = (v) => String(v || '').replace(/\D/g, '');

  // Завантажує в індекс замовлення за останні `days` днів. Зупиняється, щойно `found()` повертає збіги.
  // Спершу найчастіші статуси, щоб звичайне замовлення знаходилось за кілька запитів.
  const STATUS_PRIORITY = ['11', '3', '56', '14', '18', '66', '60', '53'];
  // Статуси LP-CRM кешуємо на добу (один зовнішній запит менше на кожен пошук).
  async function cachedStatuses(creds) {
    const row = await db.get(`SELECT value FROM settings WHERE key = 'statuses_cache'`);
    const cache = row?.value ? JSON.parse(row.value) : null;
    if (cache && cache.sub === creds.subdomain && Date.now() - cache.at < 86400000) return cache.list;
    const list = Object.keys(await getStatuses(fetchFn, creds));
    await db.run(`INSERT INTO settings (key, value) VALUES ('statuses_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
      JSON.stringify({ at: Date.now(), sub: creds.subdomain, list }),
    ]);
    return list;
  }

  async function saveOrders(orders) {
    for (const o of orders) {
      await db.run(
        `INSERT INTO orders_index (code, datetime, phone, ttn, bayer_name, data, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET datetime = excluded.datetime, phone = excluded.phone, ttn = excluded.ttn,
         bayer_name = excluded.bayer_name, data = excluded.data, fetched_at = excluded.fetched_at`,
        [String(o.order_id), o.datetime || '', digits(o.phone), String(o.ttn || ''), o.bayer_name || '', JSON.stringify(o), nowIso()],
      );
    }
  }

  // Завантажує в індекс замовлення за останні `days` днів, статус за статусом, і зупиняється, щойно `found()` дає збіг.
  // Прогрес зберігається в базі: якщо ліміт запитів вичерпано, наступне звернення продовжить з того ж статусу.
  async function syncIndex(creds, days, found = async () => []) {
    if (syncing) { await syncing; return found(); }
    let result = [];
    syncing = (async () => {
      const all = await cachedStatuses(creds);
      const statuses = [...STATUS_PRIORITY.filter((x) => all.includes(x)), ...all.filter((x) => !STATUS_PRIORITY.includes(x))];
      const start = ymd(new Date(Date.now() - days * 86400000));
      const end = ymd(new Date(Date.now() + 86400000));
      const key = `${creds.subdomain}|${days}|${start}`;
      const pr = await db.get(`SELECT value FROM settings WHERE key = 'sync_progress'`);
      const prog = pr?.value ? JSON.parse(pr.value) : null;
      let i = prog && prog.key === key && Date.now() - prog.at < 30 * 60000 ? prog.i : 0;
      const saveProgress = (idx) => db.run(
        `INSERT INTO settings (key, value) VALUES ('sync_progress', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [JSON.stringify({ key, i: idx, at: Date.now() })],
      );
      for (; i < statuses.length; i++) {
        const codes = await getOrderCodesByStatus(fetchFn, creds, statuses[i], start, end);
        const known = new Set((await db.all(`SELECT code FROM orders_index`)).map((r) => r.code));
        const fresh = codes.filter((c) => !known.has(c));
        for (let k = 0; k < fresh.length; k += 100) {
          await saveOrders(await getOrdersBatch(fetchFn, creds, fresh.slice(k, k + 100)));
        }
        await saveProgress(i + 1);
        result = await found();
        if (result.length) break;
      }
      await db.run(`DELETE FROM settings WHERE key = 'sync_progress'`);
      lastSync = Date.now();
    })();
    try { await syncing; } finally { syncing = null; }
    return result;
  }

  const SKIP_KEYS = new Set(['total', 'status', 'office', 'payment', 'delivery_id', 'attribute_status_id', 'localization']);
  async function matchIndex(q) {
    const rows = await db.all(`SELECT code, datetime, phone, ttn, data FROM orders_index ORDER BY datetime DESC`);
    const qd = digits(q);
    const strong = [];
    const weak = [];
    for (const r of rows) {
      const data = JSON.parse(r.data || '{}');
      const exact = Object.entries(data).some(([k, v]) => v !== null && typeof v !== 'object' && !SKIP_KEYS.has(k) && String(v).trim() === q);
      if (exact || r.ttn === q) strong.push(r);
      else if (qd.length >= 9 && r.phone && r.phone.endsWith(qd)) weak.push(r);
    }
    return strong.length ? strong : weak;
  }

  async function resolveCode(q, s, creds) {
    if (/^\d{11,}$/.test(q) && !q.startsWith('380')) return { code: q };
    const alias = await db.get(`SELECT code FROM order_alias WHERE alias = ?`, [q]);
    if (alias) return { code: alias.code };
    let hits = await matchIndex(q);
    const maxDays = Number(s.lpcrm_search_days) || 30;
    // Спочатку останній тиждень (швидко), потім увесь період із налаштувань.
    if (!hits.length) hits = await syncIndex(creds, Math.min(7, maxDays), () => matchIndex(q));
    if (!hits.length && maxDays > 7) hits = await syncIndex(creds, maxDays, () => matchIndex(q));
    if (!hits.length) {
      throw new Error(`Замовлення «${q}» не знайдено серед замовлень за останні ${Number(s.lpcrm_search_days) || 30} днів. ` +
        'Введіть код замовлення (ID-o у шапці картки LP-CRM), телефон покупця або ТТН.');
    }
    const note = hits.length > 1 ? `Знайдено ${hits.length} замовлення(нь) за «${q}» — показано найновіше.` : '';
    if (hits.length === 1 && !/^\d{9,}$/.test(digits(q)) ) {
      await db.run(`INSERT INTO order_alias (alias, code) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET code = excluded.code`, [q, hits[0].code]);
    }
    return { code: hits[0].code, note };
  }

  async function loadOrder(orderId, s, fresh = false) {
    if (orderId === 'demo' || orderId === '0') {
      return { rawOrder: DEMO_ORDER, demo: true };
    }
    const creds = { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key };
    if (!creds.subdomain || !creds.key) throw new Error('Не налаштовано LP-CRM: вкажіть піддомен і API-ключ у розділі «Налаштування».');
    const { code, note } = await resolveCode(orderId, s, creds);
    const { order, raw } = await getOrder(fetchFn, creds, code, { fresh });
    const prods = order.products || order.goods || [];
    const list = Array.isArray(prods) ? prods : Object.values(prods);
    const missing = list.filter((p) => !(p.name || p.title || p.product_name)).map((p) => String(p.product_id ?? p.id ?? ''));
    const productNames = missing.length ? await getProducts(fetchFn, creds, missing) : {};
    return { rawOrder: order, crmRaw: raw, productNames, demo: false, code, note };
  }

  async function buildInvoice(orderId, { skipCheckbox = false, fresh = false } = {}) {
    const s = await settings();
    const { rawOrder, crmRaw, productNames, demo, code, note } = await loadOrder(orderId, s, fresh);
    const crmOrder = normalizeOrder(rawOrder, productNames);
    if (demo) crmOrder.orderId = 'demo';
    if (!crmOrder.orderId) crmOrder.orderId = String(orderId);
    // Номер накладної = звичний номер замовлення (поле id у LP-CRM), а не 16-значний код.
    if (!demo && crmOrder.shortId) crmOrder.orderId = crmOrder.shortId;
    else if (!demo && /^\d{1,8}$/.test(orderId)) crmOrder.orderId = String(orderId);
    const prefs = await db.get(`SELECT * FROM order_prefs WHERE order_id = ?`, [orderId]);
    const edits = prefs?.edits ? JSON.parse(prefs.edits) : null;
    // Дата накладної: за замовчуванням — день формування (за Києвом), а не дата створення замовлення.
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
    const autoInvoiceDate = s.invoice_date_mode === 'order' ? String(crmOrder.date || '').slice(0, 10) || today : today;
    crmOrder.invoiceDate = autoInvoiceDate;
    const order = applyEdits(crmOrder, edits);

    const allFops = await db.all(`SELECT * FROM fops WHERE active = 1`);
    const byId = (id) => allFops.find((f) => String(f.id) === String(id)) || null;
    const warnings = [];
    if (note) warnings.push(note);
    if (!crmOrder.items.length) warnings.push('У замовленні не знайдено товарів — перевірте блок «Дані з CRM» унизу і надішліть скріншот сирої відповіді.');

    // 1) Чек Checkbox
    let receipt = null;
    let receiptCandidates = [];
    const cbFops = allFops.filter(hasCheckbox);
    const receiptRef = prefs?.receipt_ref || crmOrder.receiptHint;
    if (!skipCheckbox && cbFops.length && (receiptRef || s.checkbox_enabled === '1')) {
      try {
        const cacheKey = `${orderId}|${receiptRef}|${order.total}|${order.date}|${cbFops.map((f) => f.id).join(',')}`;
        const hit = receiptCache.get(cacheKey);
        let r;
        if (hit && Date.now() - hit.at < 10 * 60 * 1000) r = hit.r;
        else {
          r = receiptRef
            ? await findReceiptByRef(fetchFn, cbFops, receiptRef)
            : await findReceiptForOrder(fetchFn, cbFops, order, { days: Number(s.checkbox_search_days) || 7 });
          // Кешуємо лише знайдені чеки, щоб новий чек підхопився одразу після появи.
          if (r.receipt) receiptCache.set(cacheKey, { at: Date.now(), r });
        }
        receipt = r.receipt;
        receiptCandidates = r.candidates || [];
        warnings.push(...r.errors);
        if (!receipt && receiptRef) warnings.push(`Чек «${receiptRef}» не знайдено в жодному акаунті Checkbox.`);
      } catch (e) {
        warnings.push(`Checkbox: ${e.message}`);
      }
    }

    // 2) Відділ
    const office = crmOrder.office ? await db.get(`SELECT * FROM offices WHERE office_id = ?`, [crmOrder.office]) : null;
    const officeFop = office?.fop_id ? byId(office.fop_id) : null;
    if (crmOrder.office && !office) warnings.push(`Відділ ${crmOrder.office} не додано в довідник відділів.`);

    // 2б) Додаткове поле 1 (канал продажу, напр. «Rozetka(oneday)»)
    let channelFop = null;
    let ch = null;
    if (crmOrder.channel) {
      ch = (await db.all(`SELECT * FROM channels`)).find((x) => x.name.trim().toLowerCase() === crmOrder.channel.toLowerCase());
      channelFop = ch?.fop_id ? byId(ch.fop_id) : null;
      if (!ch) warnings.push(`Значення поля 1 «${crmOrder.channel}» не прив'язане до ФОП (розділ «Відділи → ФОП»).`);
    }

    // 3) Вибір: ручний > чек > поле 1 > відділ > за замовчуванням
    let fop = null;
    let fopSource = '';
    const manual = prefs?.fop_id ? byId(prefs.fop_id) : null;
    if (manual) { fop = manual; fopSource = 'manual'; }
    else if (receipt) { fop = byId(receipt.fopId); fopSource = 'receipt'; }
    else if (channelFop) { fop = channelFop; fopSource = 'channel'; }
    else if (officeFop) { fop = officeFop; fopSource = 'office'; }
    else if (s.default_fop_id && byId(s.default_fop_id)) { fop = byId(s.default_fop_id); fopSource = 'default'; }

    if (channelFop && officeFop && String(channelFop.id) !== String(officeFop.id) && !receipt) {
      warnings.push(`За полем 1 — ${channelFop.short_name}, а за відділом — ${officeFop.short_name}. Перевірте ФОП.`);
    }
    const autoFop = channelFop || officeFop;
    if (receipt && autoFop && String(receipt.fopId) !== String(autoFop.id)) {
      warnings.push(`За ${channelFop ? 'полем 1' : 'відділом'} мав би бути ${autoFop.short_name}, але чек пробито на ${receipt.fopName}.`);
    }
    if (manual && receipt && String(receipt.fopId) !== String(manual.id)) {
      warnings.push(`Обрано вручну ${manual.short_name}, а чек пробито на ${receipt.fopName}.`);
    }
    if (!fop) warnings.push('ФОП не визначено автоматично — оберіть його зі списку.');
    else {
      const missing = [];
      if (!fop.full_name) missing.push('ПІБ');
      if (!fop.ipn) missing.push('ІПН');
      if (missing.length) warnings.push(`У ${fop.short_name} не заповнено: ${missing.join(', ')}.`);
    }

    // Назва продавця в накладній: ручна правка > поле 1 > відділ (лише якщо рядок стосується обраного ФОП).
    const fits = (row) => row && row.seller_text && (!row.fop_id || String(row.fop_id) === String(fop?.id));
    let sellerText = '';
    let sellerTextSource = '';
    if (edits?.sellerText) { sellerText = edits.sellerText; sellerTextSource = 'manual'; }
    else if (fits(ch)) { sellerText = ch.seller_text; sellerTextSource = `поле 1 «${ch.name}»`; }
    else if (fits(office)) { sellerText = office.seller_text; sellerTextSource = `відділ ${office.office_id}`; }

    const tplId = prefs?.template_id || fop?.template_id;
    let template = tplId ? await db.get(`SELECT * FROM templates WHERE id = ?`, [tplId]) : null;
    if (!template) template = await db.get(`SELECT * FROM templates ORDER BY id LIMIT 1`);

    return {
      order,
      crmOrder,
      demo,
      edited: Boolean(edits),
      edits,
      office: office || (crmOrder.office ? { office_id: crmOrder.office, name: '' } : null),
      fop: docFop(fop),
      sellerText,
      sellerTextSource,
      autoInvoiceDate,
      fopSource,
      officeFopId: officeFop?.id || null,
      receipt,
      receiptCandidates,
      receiptRef: prefs?.receipt_ref || '',
      template: parseTpl(template),
      templateManual: Boolean(prefs?.template_id),
      warnings,
      sellerNote: s.seller_note || '',
      crmCode: code || '',
      crmRaw: crmRaw ? JSON.stringify(crmRaw, null, 2).slice(0, 20000) : '',
    };
  }

  async function addVersion(orderId, inv, reason, who = '') {
    const dataHash = hash(JSON.stringify([inv.order, inv.fop?.id, inv.template?.id, inv.template?.options]));
    await db.run(
      `INSERT INTO versions (order_id, created_at, reason, fop_id, fop_name, template_id, total, data_hash, data, user_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, nowIso(), reason, inv.fop?.id || null, inv.fop?.short_name || '', inv.template?.id || null,
        inv.order.total, dataHash, JSON.stringify(inv), who],
    );
  }

  // Автоматично фіксує версію, якщо дані відрізняються від останньої збереженої.
  async function trackChanges(orderId, inv, who = '') {
    const last = await db.get(`SELECT data_hash FROM versions WHERE order_id = ? ORDER BY id DESC LIMIT 1`, [orderId]);
    const dataHash = hash(JSON.stringify([inv.order, inv.fop?.id, inv.template?.id, inv.template?.options]));
    if (!last) await addVersion(orderId, inv, 'Перше відкриття', who);
    else if (last.data_hash !== dataHash) await addVersion(orderId, inv, 'Змінилися дані (CRM, ФОП або шаблон)', who);
  }

  app.get('/api/invoice/:orderId', async (c) => {
    const orderId = c.req.param('orderId').trim().replace(/^№/, '');
    const inv = await buildInvoice(orderId, { fresh: c.req.query('fresh') === '1' });
    await trackChanges(orderId, inv, userName(c));
    const n = await db.get(`SELECT COUNT(*) AS n FROM versions WHERE order_id = ?`, [orderId]);
    return c.json({ ...inv, versionsCount: n?.n || 0 });
  });

  app.put('/api/invoice/:orderId/prefs', async (c) => {
    need(c, 'docs.edit');
    const orderId = c.req.param('orderId');
    const b = await c.req.json();
    const cur = (await db.get(`SELECT * FROM order_prefs WHERE order_id = ?`, [orderId])) || {};
    const next = {
      fop_id: b.fop_id !== undefined ? b.fop_id || null : cur.fop_id ?? null,
      template_id: b.template_id !== undefined ? b.template_id || null : cur.template_id ?? null,
      receipt_ref: b.receipt_ref !== undefined ? b.receipt_ref || '' : cur.receipt_ref || '',
      edits: b.edits !== undefined ? (b.edits ? JSON.stringify(b.edits) : '') : cur.edits || '',
    };
    await db.run(
      `INSERT INTO order_prefs (order_id, fop_id, template_id, receipt_ref, edits, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(order_id) DO UPDATE SET fop_id = excluded.fop_id, template_id = excluded.template_id,
       receipt_ref = excluded.receipt_ref, edits = excluded.edits, updated_at = excluded.updated_at`,
      [orderId, next.fop_id, next.template_id, next.receipt_ref, next.edits, nowIso()],
    );
    const inv = await buildInvoice(orderId);
    const reason = b.reason || 'Зміна вручну';
    await addVersion(orderId, inv, reason, userName(c));
    return c.json({ ok: true });
  });

  app.post('/api/invoice/:orderId/versions', async (c) => {
    const orderId = c.req.param('orderId');
    const b = await c.req.json();
    if (!b.snapshot?.order) return c.json({ error: 'Немає даних накладної' }, 400);
    await addVersion(orderId, b.snapshot, b.reason || 'Збережено', userName(c));
    return c.json({ ok: true });
  });

  app.get('/api/invoice/:orderId/versions', async (c) => {
    const rows = await db.all(
      `SELECT id, order_id, created_at, reason, fop_name, template_id, total, user_name FROM versions WHERE order_id = ? ORDER BY id DESC`,
      [c.req.param('orderId')],
    );
    return c.json(rows);
  });

  app.get('/api/versions/:id', async (c) => {
    const row = await db.get(`SELECT * FROM versions WHERE id = ?`, [c.req.param('id')]);
    if (!row) return c.json({ error: 'Версію не знайдено' }, 404);
    return c.json({ ...row, data: JSON.parse(row.data) });
  });

  app.get('/api/history', async (c) => {
    const q = (c.req.query('q') || '').trim();
    const fop = (c.req.query('fop') || '').trim();
    const where = [];
    const params = [];
    if (q) { where.push('order_id LIKE ?'); params.push(`%${q}%`); }
    if (fop) { where.push('fop_id = ?'); params.push(fop); }
    const rows = await db.all(
      `SELECT v.order_id, v.id AS last_id, v.created_at AS last_at, v.fop_name, v.total,
        (SELECT COUNT(*) FROM versions c WHERE c.order_id = v.order_id) AS versions
       FROM versions v
       WHERE v.id IN (SELECT MAX(id) FROM versions GROUP BY order_id) ${where.length ? 'AND ' + where.map((w) => 'v.' + w).join(' AND ') : ''}
       ORDER BY v.id DESC LIMIT 200`,
      params,
    );
    return c.json(rows);
  });

  // ---------- Перенесення налаштувань між копіями (локально ⇄ Cloudflare) ----------
  const EXPORT_TABLES = ['templates', 'fops', 'offices', 'channels', 'inv_fops'];
  const EXPORT_SETTINGS = ['lpcrm_subdomain', 'lpcrm_search_days', 'default_fop_id', 'checkbox_enabled', 'checkbox_search_days',
    'invoice_date_mode', 'rahunok_next_number', 'retention_days', 'seller_note'];
  const SECRET_COLS = new Set(['checkbox_password', 'checkbox_pin', 'checkbox_license', 'checkbox_login']);

  app.get('/api/admin/export', async (c) => {
    need(c, 'users');
    const out = { version: 1, exported_at: nowIso(), tables: {}, settings: {} };
    for (const t of EXPORT_TABLES) {
      out.tables[t] = (await db.all(`SELECT * FROM ${t}`)).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLS.has(k))));
    }
    const s = await settings();
    for (const k of EXPORT_SETTINGS) if (s[k] !== undefined) out.settings[k] = s[k];
    return c.json(out);
  });

  app.post('/api/admin/import', async (c) => {
    need(c, 'users');
    const b = await c.req.json();
    if (!b?.tables) throw fail(400, 'Це не файл експорту налаштувань.');
    const counts = {};
    for (const t of EXPORT_TABLES) {
      const rows = b.tables[t];
      if (!Array.isArray(rows)) continue;
      const cols = new Set((await db.all(`PRAGMA table_info(${t})`)).map((x) => x.name));
      await db.run(`DELETE FROM ${t}`);
      for (const r of rows) {
        const keys = Object.keys(r).filter((k) => cols.has(k) && !SECRET_COLS.has(k));
        await db.run(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => r[k]));
      }
      counts[t] = rows.length;
    }
    for (const [k, v] of Object.entries(b.settings || {})) {
      if (!EXPORT_SETTINGS.includes(k)) continue;
      await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, String(v)]);
    }
    return c.json({ ok: true, counts });
  });

  // =====================================================================
  // РАХУНКИ НА ОПЛАТУ
  // =====================================================================
  const INV_FOP_FIELDS = ['short_name', 'full_name', 'ipn', 'iban', 'bank', 'address', 'phone', 'warning_text', 'signature', 'stamp', 'active'];

  app.post('/api/inv-fops', async (c) => {
    need(c, 'users'); // створювати ФОП рахунків вручну — лише власник і адміни
    const b = await c.req.json();
    if (!String(b.short_name || '').trim()) throw fail(400, 'Вкажіть коротку назву ФОП.');
    const cols = INV_FOP_FIELDS.filter((k) => b[k] !== undefined);
    const r = await db.run(`INSERT INTO inv_fops (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((k) => b[k]));
    return c.json({ id: r.lastId });
  });

  app.put('/api/inv-fops/:id', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    const cols = INV_FOP_FIELDS.filter((k) => b[k] !== undefined);
    if (cols.length) {
      await db.run(`UPDATE inv_fops SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => b[k]), c.req.param('id')]);
    }
    return c.json({ ok: true });
  });

  // Замовлення з CRM для рахунку: номер, товари, покупець.
  app.get('/api/rahunok-order/:q', async (c) => {
    need(c, 'docs.edit');
    const q = c.req.param('q').trim().replace(/^№\s*/, '');
    const s = await settings();
    const { rawOrder, productNames, demo, code, note } = await loadOrder(q, s);
    const o = normalizeOrder(rawOrder, productNames);
    const number = demo ? 'demo' : o.shortId || (/^\d{1,8}$/.test(q) ? q : o.orderId);
    return c.json({
      number,
      crmCode: code || '',
      note: note || '',
      buyer: o.buyer,
      items: o.items.map((i) => ({ name: i.article ? `${i.name} [${i.article}]` : i.name, qty: i.qty, price: i.price })),
    });
  });

  const round2 = (n) => Math.round(n * 100) / 100;
  const toNum = (v) => {
    const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  async function buildRahunok(b, number) {
    const fop = await db.get(`SELECT * FROM inv_fops WHERE id = ?`, [b.fop_id]);
    if (!fop) throw fail(400, 'Оберіть ФОП, від якого виставляється рахунок.');
    const clientName = String(b.client?.name || '').trim();
    if (!clientName) throw fail(400, 'Вкажіть назву клієнта.');
    const items = (b.items || [])
      .map((i) => ({ name: String(i.name || '').trim(), qty: toNum(i.qty), price: round2(toNum(i.price)) }))
      .filter((i) => i.name);
    if (!items.length) throw fail(400, 'Додайте хоча б один товар.');
    for (const i of items) {
      if (!(i.qty > 0)) throw fail(400, `Кількість для «${i.name}» має бути більшою за 0.`);
      i.unit = 'шт';
      i.sum = round2(i.qty * i.price);
    }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
    const { signature, stamp, ...fopRest } = fop;
    return {
      number: String(number),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : today,
      source: b.source === 'crm' ? 'crm' : 'manual',
      orderRef: String(b.order_ref || ''),
      fop: { ...fopRest, signature, stamp, warning_text: fop.warning_text || DEFAULT_WARNING },
      client: { name: clientName, edrpou: String(b.client?.edrpou || '').trim(), contract: String(b.client?.contract || '').trim() },
      items,
      total: round2(items.reduce((t, i) => t + i.sum, 0)),
    };
  }

  app.get('/api/rahunky', async (c) => {
    const q = (c.req.query('q') || '').trim();
    const rows = await db.all(
      `SELECT id, number, source, order_ref, fop_name, client_name, total, created_at, created_by, updated_at, updated_by,
         (SELECT p.status FROM pay_links p WHERE p.id = json_extract(invoices.data, '$.pay.link_id')) AS pay_status FROM invoices
       ${q ? 'WHERE number LIKE ? OR client_name LIKE ? OR order_ref LIKE ?' : ''} ORDER BY id DESC LIMIT 300`,
      q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [],
    );
    const s = await settings();
    return c.json({ rows, nextNumber: s.rahunok_next_number || '10516', retentionDays: Number(s.retention_days) || 7 });
  });

  app.get('/api/rahunky/:id', async (c) => {
    const row = await db.get(`SELECT * FROM invoices WHERE id = ?`, [c.req.param('id')]);
    if (!row) throw fail(404, 'Рахунок не знайдено (можливо, минув строк зберігання).');
    return c.json({ ...row, data: JSON.parse(row.data) });
  });

  app.post('/api/rahunky', async (c) => {
    need(c, 'docs.edit');
    const b = await c.req.json();
    let number;
    if (b.source === 'crm') {
      number = String(b.number || '').trim();
      if (!number) throw fail(400, 'Немає номера замовлення CRM.');
    } else {
      // Наступний номер із спільного лічильника (для всіх ФОПів рахунків).
      const s = await settings();
      number = String(Number(s.rahunok_next_number) || 10516);
    }
    const data = await buildRahunok(b, number);
    if (b.source !== 'crm') {
      await db.run(`UPDATE settings SET value = ? WHERE key = 'rahunok_next_number'`, [String(Number(number) + 1)]);
    }
    if (b.qr) data.pay = await odbApi.linkForRahunok(c, data);
    const r = await db.run(
      `INSERT INTO invoices (number, source, order_ref, fop_id, fop_name, client_name, total, data, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.number, data.source, data.orderRef, data.fop.id, data.fop.short_name, data.client.name, data.total, JSON.stringify(data), nowIso(), userName(c)],
    );
    return c.json({ id: r.lastId, data });
  });

  app.put('/api/rahunky/:id', async (c) => {
    need(c, 'docs.edit');
    const row = await db.get(`SELECT * FROM invoices WHERE id = ?`, [c.req.param('id')]);
    if (!row) throw fail(404, 'Рахунок не знайдено.');
    const b = await c.req.json();
    const prev = JSON.parse(row.data);
    const data = await buildRahunok({ ...b, source: prev.source, order_ref: prev.orderRef }, row.number);
    if (b.qr) data.pay = await odbApi.linkForRahunok(c, data);
    await db.run(
      `UPDATE invoices SET fop_id = ?, fop_name = ?, client_name = ?, total = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      [data.fop.id, data.fop.short_name, data.client.name, data.total, JSON.stringify(data), nowIso(), userName(c), row.id],
    );
    return c.json({ id: row.id, data });
  });

  app.delete('/api/rahunky/:id', async (c) => {
    need(c, 'docs.edit');
    await db.run(`DELETE FROM invoices WHERE id = ?`, [c.req.param('id')]);
    return c.json({ ok: true });
  });

  mountAnalytics(app, { db, fetchFn, settings, need, fail, nowIso });
  const tgApi = mountTg(app, { db, fetchFn, settings, need, fail });
  odbApi = mountOdb(app, { db, fetchFn, settings, need, fail, nowIso, can, userName, base: odbBase, notify: tgApi.notify });

  return app;
}
