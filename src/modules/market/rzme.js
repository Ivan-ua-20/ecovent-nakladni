// Маркетплейси → особисті входи менеджерів у Розетку.
// Менеджер підключає свій менеджерський логін кабінету продавця (його створює адміністратор магазину в Розетці:
// Налаштування → Менеджери) для кожного магазину, до якого має доступ. Дії, які бачать покупець і Розетка —
// повідомлення покупцю, скасування, зміна статусу, створення ТТН — ідуть з його токена (rzAct), тобто від його імені.
// Синхронізація замовлень і решта читання лишаються на службовому вході магазину (rzCall).
// Немає особистого входу — дія йде від службового входу, якщо власник не ввімкнув «Вимагати особистий вхід»
// (правило діє на всіх, крім власника й адміністраторів, які керують користувачами).
// Паролі зберігаються на сервері так само, як у rz_accounts, і назовні не віддаються.
import { fail, need, nowIso, loadSettings, putSetting } from '../../core/common.js';
import { can, shopAllowed } from '../../core/auth.js';
import { rzLogin } from '../../integrations/rozetka.js';

const TOKEN_MS = 20 * 60 * 60 * 1000; // токен Розетки діє 24 год — оновлюємо трохи раніше
const PUB = 'user_id, account_id, username, state, error, checked_at, updated_at';

export function mountRzPersonal(app, { db, fetchFn, rzCall, accOf }) {
  const requireOn = async () => (await loadSettings(db)).rz_require_personal === '1';
  const exempt = (u) => can(u, 'users'); // власник і адміністратори, що керують користувачами
  const rowOf = (userId, accountId) => db.get(`SELECT * FROM rz_user_logins WHERE user_id = ? AND account_id = ?`, [userId, accountId]);

  // Вхід під логіном менеджера: магазин має збігатися (інакше це вхід в інший кабінет).
  async function login(acc, username, password) {
    const r = await rzLogin(fetchFn, username, password);
    if (acc.market_id && r.marketId && String(r.marketId) !== String(acc.market_id)) {
      throw fail(400, `Цей логін входить у магазин «${r.marketTitle || r.marketId}», а не в «${acc.name}». Перевірте, для якого магазину Розетки його створено.`);
    }
    return r;
  }
  async function tokenOf(row, acc, force = false) {
    if (!force && row.token && Date.now() - Date.parse(row.token_at || 0) < TOKEN_MS) return row.token;
    try {
      const r = await login(acc, row.username, row.password);
      await db.run(`UPDATE rz_user_logins SET token = ?, token_at = ?, state = 'ok', error = '', checked_at = ? WHERE user_id = ? AND account_id = ?`,
        [r.token, nowIso(), nowIso(), row.user_id, row.account_id]);
      row.token = r.token;
      return r.token;
    } catch (e) {
      if (e.pending || !(e.rzCode || e.status === 400)) throw e; // збій мережі чи Розетки — це не «поганий пароль»
      // Розетка не прийняла логін/пароль — позначаємо, менеджер побачить «Пароль змінено» і оновить
      await db.run(`UPDATE rz_user_logins SET state = 'bad', error = ?, token = '', checked_at = ? WHERE user_id = ? AND account_id = ?`,
        [String(e.message || e).slice(0, 300), nowIso(), row.user_id, row.account_id]);
      throw Object.assign(new Error('personal-login'), { personalBad: true, cause: e });
    }
  }

  // Дія від імені користувача c в магазині acc. fn(token) — сам запит до Розетки.
  async function rzAct(c, acc, fn) {
    const u = c.get('user');
    const row = await rowOf(u.id, acc.id);
    if (row && row.state === 'ok') {
      try {
        try { return await fn(await tokenOf(row, acc)); } catch (e) { if (!e.rzAuth) throw e; return await fn(await tokenOf(row, acc, true)); }
      } catch (e) {
        if (!e.personalBad) throw e; // помилка самої дії — не повторюємо від службового входу (щоб не задвоїти)
      }
    }
    if (!exempt(u) && await requireOn()) {
      throw fail(403, row?.state === 'bad'
        ? `Розетка не прийняла ваш вхід у «${acc.name}» (можливо, змінено пароль). Оновіть його: «Розетка» вгорі сторінки.`
        : `Підключіть свій вхід у Розетку для «${acc.name}»: «Розетка» вгорі сторінки. Без нього дії в Розетці вимкнено.`);
    }
    return rzCall(acc, fn);
  }

  // ---------------------------------------------------------------- мої входи
  // Магазини Розетки, до яких є доступ, і стан мого входу в кожен.
  app.get('/api/mp/rz/me', async (c) => {
    need(c, 'market.view');
    const u = c.get('user');
    const [accs, mine] = await Promise.all([
      db.all(`SELECT id, name FROM rz_accounts WHERE active = 1 ORDER BY name`),
      db.all(`SELECT ${PUB} FROM rz_user_logins WHERE user_id = ?`, [u.id]),
    ]);
    const by = new Map(mine.map((r) => [r.account_id, r]));
    return c.json({
      require: await requireOn(), exempt: exempt(u), canAct: can(u, 'market.edit'),
      accounts: accs.filter((a) => shopAllowed(u, 'rozetka', a.id)).map((a) => {
        const r = by.get(a.id);
        return { id: a.id, name: a.name, state: r ? r.state : 'none', username: r?.username || '', error: r?.state === 'bad' ? r.error : '', checked_at: r?.checked_at || '' };
      }),
    });
  });
  // Підключити / змінити свій вхід: одразу перевіряємо в Розетці (і що це той самий магазин).
  app.put('/api/mp/rz/me/:account', async (c) => {
    need(c, 'market.edit');
    const u = c.get('user');
    const acc = await accOf('rozetka', c.req.param('account'));
    if (!shopAllowed(u, 'rozetka', acc.id)) throw fail(403, 'У вас немає доступу до цього магазину.');
    const b = await c.req.json().catch(() => ({}));
    const username = String(b.username || '').trim().slice(0, 120);
    const password = String(b.password || '');
    if (!username || !password) throw fail(400, 'Вкажіть логін і пароль свого менеджерського входу в кабінет продавця Розетки.');
    if (acc.username && username.toLowerCase() === String(acc.username).toLowerCase()) {
      throw fail(400, 'Це службовий вхід сервісу. Потрібен ваш особистий менеджерський логін — його створює адміністратор магазину в Розетці (Налаштування → Менеджери).');
    }
    const r = await login(acc, username, password);
    const now = nowIso();
    await db.run(`INSERT INTO rz_user_logins (user_id, account_id, username, password, token, token_at, state, error, checked_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ok', '', ?, ?)
      ON CONFLICT(user_id, account_id) DO UPDATE SET username = excluded.username, password = excluded.password, token = excluded.token,
        token_at = excluded.token_at, state = 'ok', error = '', checked_at = excluded.checked_at, updated_at = excluded.updated_at`,
    [u.id, acc.id, username, password, r.token, now, now, now]);
    return c.json({ ok: true, market: r.marketTitle || acc.name });
  });
  app.delete('/api/mp/rz/me/:account', async (c) => {
    need(c, 'market.view');
    await db.run(`DELETE FROM rz_user_logins WHERE user_id = ? AND account_id = ?`, [c.get('user').id, Number(c.req.param('account')) || 0]);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- огляд для власника
  app.get('/api/mp/rz/logins', async (c) => {
    need(c, 'users');
    const [accs, rows] = await Promise.all([
      db.all(`SELECT id, name FROM rz_accounts WHERE active = 1 ORDER BY name`),
      db.all(`SELECT ${PUB} FROM rz_user_logins`),
    ]);
    return c.json({ require: await requireOn(), accounts: accs, logins: rows });
  });
  app.put('/api/mp/rz/require', async (c) => {
    need(c, 'users');
    const on = Boolean((await c.req.json().catch(() => ({}))).on);
    await putSetting(db, 'rz_require_personal', on ? '1' : '0');
    return c.json({ ok: true, require: on });
  });

  return { rzAct };
}
