// Фонові задачі за розкладом: ключ, список задач, запуск кожної окремо, журнал останніх запусків,
// старий ключ аналітики (an_cron_key) працює, «попутні» запуски вимикаються, поки працює розклад.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
let calls = 0;
const fetchFn = async () => { calls++; return new Response(JSON.stringify({ status: 'ok', data: [] })); };
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, headers = H) => {
  const r = await mk().request(path, { method, headers });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

// без ключа — ні
assert.equal((await req('GET', '/api/cron/tasks', {})).status, 401);
// старий ключ з налаштувань аналітики підхоплюється
await db.run(`INSERT INTO settings (key, value) VALUES ('an_cron_key', 'old-key-0123456789')`);
let r = await req('GET', '/api/cron/tasks', { 'X-Cron-Key': 'old-key-0123456789' });
assert.equal(r.status, 200);
assert.deepEqual(r.j.tasks.sort(), ['analytics', 'market', 'market-history', 'orders', 'rzs', 'ttn']);

// новий ключ з налаштувань; старий після цього не діє
const { key } = (await req('POST', '/api/jobs/key')).j;
assert.equal(key.length, 48);
assert.equal((await req('GET', '/api/cron/tasks', { 'X-Cron-Key': 'old-key-0123456789' })).status, 401);
const K = { 'X-Cron-Key': key };

// кожна задача — окремо; без LP-CRM і без даних — пропускають без запитів назовні
calls = 0;
for (const t of ['orders', 'ttn', 'rzs', 'analytics', 'market', 'market-history']) {
  r = await req('POST', `/api/cron/run/${t}`, K);
  assert.equal(r.status, 200, t);
  assert.ok(r.j.ok, `${t}: ${JSON.stringify(r.j)}`);
}
assert.equal(calls, 0);
assert.equal((await req('POST', '/api/cron/run/nope', K)).status, 404);

// сторінка налаштувань: розклад працює, у кожної задачі — останній запуск
const jobs = (await req('GET', '/api/jobs')).j;
assert.equal(jobs.active, true);
assert.equal(jobs.key, key);
assert.ok(jobs.tasks.every((t) => t.last?.at && t.last.ok), JSON.stringify(jobs.tasks));
assert.equal(jobs.tasks.find((t) => t.name === 'analytics').last.result.skipped, 'аналітику ще не завантажено');
// ручний запуск — лише з правом «users»
assert.equal((await req('POST', '/api/jobs/run/ttn', {})).status, 401);
assert.ok((await req('POST', '/api/jobs/run/ttn')).j.ok);

// аналітика: оновлення пропущено понад 30 год — розклад сам запускає щоденне, а далі веде його по кроку
await db.run(`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`);
await db.run(`INSERT INTO settings (key, value) VALUES ('an_last_sync', ?), ('an_last_daily', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  [new Date(Date.now() - 31 * 3600e3).toISOString(), new Date(Date.now() - 31 * 3600e3).toISOString()]);
r = await req('POST', '/api/cron/run/analytics', K);
assert.ok(r.j.ok && r.j.result.started, JSON.stringify(r.j));
r = await req('POST', '/api/cron/run/analytics', K);
assert.ok(r.j.ok && 'step' in r.j.result, JSON.stringify(r.j));
console.log('OK — фонові задачі: ключ, список, запуск, журнал, щоденна аналітика');
