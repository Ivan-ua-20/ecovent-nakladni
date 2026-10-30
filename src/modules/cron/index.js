// Модуль «Фонові задачі»: запуск задач модулів за розкладом з Cloudflare Worker (Cron Trigger).
// Worker раз на кілька хвилин бере список задач (/api/cron/tasks) і викликає кожну окремим зверненням
// (/api/cron/run/<назва>) — так кожна має власний ліміт запитів Cloudflare. Доступ — за ключем у заголовку X-Cron-Key.
// Самі задачі реєструють модулі (onCron); кожна сама вирішує, чи вже час (броні в settings).
import { fail, need, nowIso } from '../../core/common.js';

const randomKey = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');

export function mountCron(app, { db, cronTasks, services = {}, shared = {} }) {
  const getVal = async (key) => (await db.get(`SELECT value FROM settings WHERE key = ?`, [key]))?.value || '';
  const putVal = (key, value) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  // Ключ раніше жив у налаштуваннях аналітики (an_cron_key) — підхоплюємо його, щоб уже налаштований Worker працював.
  const cronKey = async () => (await getVal('cron_key')) || (await getVal('an_cron_key'));
  const checkKey = async (c) => {
    const key = await cronKey();
    const got = c.req.header('x-cron-key') || '';
    if (!key || got.length !== key.length || got !== key) throw fail(401, 'Невірний ключ.');
  };
  // Розклад працює — «попутні» запуски на запитах користувачів вимикаються (і в цьому екземплярі — одразу).
  const markTick = async () => { await putVal('cron_at', nowIso()); shared.cronOn = true; shared.cronCheckAt = Date.now(); };
  const readLast = async () => { try { return JSON.parse(await getVal('cron_last')) || {}; } catch { return {}; } };

  async function runTask(name) {
    const t = cronTasks.get(name);
    if (!t) throw fail(404, 'Немає такої задачі.');
    const started = Date.now();
    let rec;
    try {
      rec = { ok: true, result: (await t.run()) ?? null };
    } catch (e) {
      // Вичерпано ліміт запитів на звернення — не помилка: наступний запуск продовжить.
      if (e.pending) rec = { ok: true, result: { more: true } };
      else {
        rec = { ok: false, error: String(e.message || e).slice(0, 300) };
        await services.errlog?.log(e, { path: `/api/cron/run/${name}`, source: 'Фонові задачі' }).catch(() => 0);
      }
    }
    const last = await readLast();
    last[name] = { ...rec, at: nowIso(), ms: Date.now() - started };
    await putVal('cron_last', JSON.stringify(last));
    return last[name];
  }

  // ---------- для Worker'а (без входу, з ключем) ----------
  app.get('/api/cron/tasks', async (c) => {
    await checkKey(c);
    await markTick();
    return c.json({ tasks: [...cronTasks.keys()] });
  });
  app.post('/api/cron/run/:name', async (c) => {
    await checkKey(c);
    return c.json(await runTask(c.req.param('name')));
  });
  // Старий Worker (лише перевірка дублів ТТН) — щоб не зламався до оновлення коду.
  app.post('/api/cron/ttn', async (c) => {
    await checkKey(c);
    await markTick();
    return c.json(await runTask('ttn'));
  });

  // ---------- для сторінки «Налаштування → Фонові задачі» ----------
  app.get('/api/jobs', async (c) => {
    need(c, 'users');
    const [key, at, last] = await Promise.all([cronKey(), getVal('cron_at'), readLast()]);
    return c.json({
      key,
      lastTick: at,
      active: Boolean(at) && Date.now() - Date.parse(at) < 10 * 60e3,
      tasks: [...cronTasks].map(([name, t]) => ({ name, title: t.title, last: last[name] || null })),
    });
  });
  app.post('/api/jobs/key', async (c) => {
    need(c, 'users');
    const key = randomKey();
    await putVal('cron_key', key);
    return c.json({ key });
  });
  // Запустити задачу вручну зараз (перевірити, що працює).
  app.post('/api/jobs/run/:name', async (c) => {
    need(c, 'users');
    return c.json(await runTask(c.req.param('name')));
  });
}
