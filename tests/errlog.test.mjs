// Журнал помилок: збій зовнішнього сервісу → запис у журналі й одне повідомлення адміну в Telegram за годину.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { errSource } from '../src/modules/errlog/index.js';

const db = openDb(':memory:');
await migrate(db);
await db.run(`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`);
await db.run(`INSERT INTO settings (key, value) VALUES ('tg_token', '123:abc') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
const tg = [];
let crmDown = true;
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: {} })); }
  if (crmDown) throw new Error('LP-CRM: сервер не відповідає');
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const shared = {};
const mk = () => createApp({ db, fetchFn, shared });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Власник' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
await db.run(`UPDATE users SET tg_chat_id = '777' WHERE login = 'owner'`);

const r1 = await mk().request('/api/invoice/108008', { headers: H });
assert.ok(r1.status >= 500, String(r1.status));
const rows = await db.all(`SELECT * FROM error_log`);
assert.equal(rows.length, 1, 'збій записано в журнал');
assert.equal(rows[0].source, 'LP-CRM');
assert.equal(rows[0].path, '/api/invoice/108008');
assert.equal(rows[0].user_name, 'Власник');
assert.equal(tg.length, 1, 'адміну — повідомлення в Telegram');
assert.equal(tg[0].chat_id, '777');
assert.match(tg[0].text, /LP-CRM/);

await mk().request('/api/invoice/108009', { headers: H });
assert.equal((await db.all(`SELECT * FROM error_log`)).length, 2, 'повтор теж у журналі');
assert.equal(tg.length, 1, 'той самий тип помилки — не частіше разу на годину');

// помилки введення (400) не потрапляють у журнал
assert.equal((await mk().request('/api/invoice/abc', { headers: H })).status, 400);
assert.equal((await db.all(`SELECT * FROM error_log`)).length, 2);

// вкладка — лише власник і адміни
const list = await (await mk().request('/api/errors', { headers: H })).json();
assert.equal(list.rows.length, 2);
assert.equal(list.sources[0].source, 'LP-CRM');
await mk().request('/api/users', { method: 'POST', headers: H, body: JSON.stringify({ login: 'manager', password: 'pass1234', role: 'manager' }) });
const ml = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'manager', password: 'pass1234' }) });
const MH = { Cookie: ml.headers.get('set-cookie').split(';')[0] };
assert.equal((await mk().request('/api/errors', { headers: MH })).status, 403);
assert.equal((await mk().request('/api/errors', { method: 'DELETE', headers: H })).status, 200);
assert.equal((await db.all(`SELECT * FROM error_log`)).length, 0, 'журнал очищено');

assert.equal(errSource('D1_ERROR: Your account has exceeded D1’s free tier'), 'База даних (D1)');
assert.equal(errSource('Opendatabot: невірний ключ'), 'Opendatabot');
assert.equal(errSource('щось', '/api/an/query'), 'Аналітика');
console.log('OK — журнал помилок і сповіщення адміністраторам');
