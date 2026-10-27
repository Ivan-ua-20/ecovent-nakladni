// Модуль «Вхід і користувачі»: сесії, вхід/вихід, перший власник, користувачі й ролі, зміна пароля.
// Також реєструє перевірку входу для всіх інших /api-маршрутів — тому монтується першим.
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { ROLES, can, hashPassword, verifyPassword, randomToken, publicUser, crmLogins } from '../../core/auth.js';
import { fail, need, nowIso } from '../../core/common.js';

export function mountAuth(app, { db, runCleanup, onCleanup }) {
  // Старі сесії (понад 90 днів) прибираються разом з іншою щогодинною чисткою.
  onCleanup(() => db.run(`DELETE FROM sessions WHERE created_at < ?`, [new Date(Date.now() - 90 * 86400000).toISOString()]));

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

  // Що доступно партнерам (решта /api — ні).
  const PARTNER_PATHS = ['/api/b2b/p', '/api/me/password', '/api/tg/me', '/api/tg/link', '/api/bootstrap'];

  // Усе інше в /api — лише після входу.
  app.use('/api/*', async (c, next) => {
    // /api/cron/* — для запуску за розкладом (Cloudflare Worker): без входу, але з ключем, який перевіряє сам маршрут.
    if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/odb/hook' || c.req.path === '/api/tg/hook' || c.req.path.startsWith('/api/cron/')) return next();
    const user = await sessionUser(c);
    if (!user) throw fail(401, 'Потрібно увійти.');
    c.set('user', user);
    // Партнер (B2B) бачить лише свій кабінет: усе інше на сайті для нього закрите.
    if (user.role === 'partner' && !PARTNER_PATHS.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`))) {
      throw fail(403, 'Недостатньо прав для цієї дії.');
    }
    await runCleanup(c);
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
  const ASSIGNABLE = ['admin', 'admin_lite', 'manager', 'viewer'];
  app.get('/api/users', async (c) => {
    need(c, 'people');
    // Користувачі партнерів керуються в розділі B2B.
    const rows = await db.all(`SELECT * FROM users WHERE role != 'partner' ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'admin_lite' THEN 2 WHEN 'manager' THEN 3 ELSE 4 END, login`);
    return c.json({ users: rows.map(publicUser), roles: ROLES });
  });

  app.post('/api/users', async (c) => {
    need(c, 'people');
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
    need(c, 'people');
    const me = c.get('user');
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [c.req.param('id')]);
    if (!target) throw fail(404, 'Користувача не знайдено.');
    if (target.role === 'owner' && me.role !== 'owner') throw fail(403, 'Акаунт власника може змінювати лише власник.');
    if (target.role === 'partner') throw fail(400, 'Користувачі партнерів змінюються в розділі «B2B партнери».');
    const b = await c.req.json();
    // Доступ до аналітики вмикає/вимикає лише власник (не собі: власник завжди з аналітикою).
    if (b.analytics !== undefined) {
      if (me.role !== 'owner') throw fail(403, 'Доступ до аналітики змінює лише власник.');
      if (target.role !== 'owner') {
        await db.run(`UPDATE users SET an_access = ? WHERE id = ?`, [b.analytics ? 1 : 0, target.id]);
        await db.run(`INSERT INTO audit_log (at, user_id, user_name, kind, ref_id, action, changes) VALUES (?, ?, ?, 'user', ?, ?, '[]')`,
          [nowIso(), me.id, me.name || me.login, String(target.id), `аналітика ${b.analytics ? 'увімкнена' : 'вимкнена'} для ${target.login}`]);
      }
    }
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
    need(c, 'people');
    const me = c.get('user');
    const target = await db.get(`SELECT * FROM users WHERE id = ?`, [c.req.param('id')]);
    if (!target) throw fail(404, 'Користувача не знайдено.');
    if (target.role === 'owner') throw fail(403, 'Акаунт власника видалити не можна.');
    if (String(target.id) === String(me.id)) throw fail(400, 'Не можна видалити власний акаунт.');
    await db.run(`DELETE FROM sessions WHERE user_id = ?`, [target.id]);
    await db.run(`DELETE FROM users WHERE id = ?`, [target.id]);
    return c.json({ ok: true });
  });
}
