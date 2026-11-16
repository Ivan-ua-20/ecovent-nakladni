// Телефонія (Binotel): підключення з перевіркою ключа, ключі не видно в браузері, журнал дзвінків добами (не довше 24 год),
// продовження з місця зупинки й перечитування останніх 15 хв, позначки «дзвінок до замовлення» / «після» в замовленнях Розетки.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { binotelCallRow, phone9 } from '../src/integrations/binotel.js';

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
await db.run(`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'Ековент', 'u', 'p', 'rztok', ?, 1, ?)`, [now, now]);

const kyiv = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const H0 = Date.now() - 2 * 3600e3; // замовлення 2 год тому
const T = (minFromOrder) => Math.floor((H0 + minFromOrder * 60e3) / 1000);
// Журнал: покупець 0671112233 дзвонив за день до замовлення; менеджер дзвонив йому через 30 хв (розмова 83 с);
// інший покупець — лише вихідний без відповіді давно (40 днів тому — поза вікном 30 днів).
const CALLS = [
  { generalCallID: '1001', startTime: T(-24 * 60), callType: '0', externalNumber: '0671112233', disposition: 'ANSWER', billsec: '40', employeeData: { name: 'Оля' } },
  { generalCallID: '1002', startTime: T(30), callType: '1', externalNumber: '0671112233', disposition: 'ANSWER', billsec: '83', employeeData: { name: 'Оля' } },
  { generalCallID: '1003', startTime: T(-40 * 24 * 60), callType: '1', externalNumber: '0509998877', disposition: 'NOANSWER', billsec: '0' },
  { generalCallID: '1004', startTime: T(10), callType: '0', externalNumber: '', disposition: 'ANSWER', billsec: '5' }, // без номера — не зберігаємо
];
const binCalls = [];
let badKey = false;
let tooFrequent = 0; // скільки наступних запитів Binotel відповість «занадто часто»
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.host === 'api.binotel.com') {
    const b = JSON.parse(opts.body);
    assert.equal(u.pathname, '/api/4.0/stats/list-of-calls-for-period.json');
    if (badKey || b.key !== 'k123' || b.secret !== 's456') return new Response(JSON.stringify({ status: 'error', code: 120, message: 'Wrong key or secret' }));
    if (tooFrequent > 0) { tooFrequent--; return new Response(JSON.stringify({ status: 'error', code: 105, message: 'Requests are too frequent. You can do this request after 5 sec.' })); }
    assert.ok(b.stopTime - b.startTime <= 86399, 'період не довший за 24 год');
    binCalls.push([b.startTime, b.stopTime]);
    const list = CALLS.filter((c) => c.startTime >= b.startTime && c.startTime <= b.stopTime);
    return new Response(JSON.stringify({ status: 'success', callDetails: Object.fromEntries(list.map((c) => [c.generalCallID, c])) }));
  }
  throw new Error(`неочікуваний запит ${url}`);
};
const sleeps = [];
const mk = () => createApp({ db, fetchFn, sleepFn: async (ms) => { sleeps.push(ms); } });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

// ---------- розбір дзвінка і номера ----------
assert.equal(phone9('+38 (067) 111-22-33'), '671112233');
assert.equal(phone9('380671112233'), '671112233');
assert.equal(phone9('123'), '');
assert.deepEqual(binotelCallRow(CALLS[1]), { id: '1002', ts: T(30), dir: 'out', phone9: '671112233', disp: 'ANSWER', billsec: 83, who: 'Оля' });

// ---------- до підключення: замовлення без позначок, задача пропускає ----------
await db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, status_group) VALUES
  ('rozetka', 1, '901', '901', ?, ?, '1', 'Нове замовлення', 'Ткач Наталія', '380671112233', 100, '[]', 1),
  ('rozetka', 1, '902', '902', ?, ?, '1', 'Нове замовлення', 'Мельник Сергій', '380509998877', 200, '[]', 1)`, [kyiv(H0), kyiv(H0), kyiv(H0), kyiv(H0)]);
let o = (await req('GET', '/api/mp/orders?mp=rozetka')).j;
assert.equal(o.rows.length, 2);
assert.ok(o.rows.every((r) => !('calls' in r)), 'Binotel не підключено — позначок немає');
const { key: cronKey } = (await req('POST', '/api/jobs/key')).j;
let cr = (await req('POST', '/api/cron/run/binotel', null, { 'X-Cron-Key': cronKey })).j;
assert.equal(cr.result.skipped, 'Binotel не налаштовано');

// ---------- підключення: невірний ключ не зберігається; вірний — так, у браузер лише маска ----------
let r = await req('PUT', '/api/tel/settings', { key: 'bad', secret: 's456' });
assert.equal(r.status, 400);
assert.match(r.j.error, /Binotel: Wrong key/);
r = await req('PUT', '/api/tel/settings', { key: 'k123' });
assert.equal(r.status, 400, 'без секрету не можна');
r = await req('PUT', '/api/tel/settings', { key: ' k123 ', secret: 's456' });
assert.equal(r.status, 200);
assert.equal(r.j.configured, true);
assert.equal(r.j.key, '••••••k123');
assert.equal(r.j.secret, '••••••');
assert.equal((await db.get(`SELECT value FROM settings WHERE key = 'binotel_key'`)).value, 'k123');
const boot = (await req('GET', '/api/bootstrap')).j;
assert.ok(boot.settings && !Object.keys(boot.settings).some((k) => k.startsWith('binotel_')), 'ключі Binotel не потрапляють у налаштування браузера');
// маска назад — ключ не змінюється
r = await req('PUT', '/api/tel/settings', { key: '••••••k123', secret: '••••••' });
assert.equal(r.status, 200);
assert.equal((await db.get(`SELECT value FROM settings WHERE key = 'binotel_secret'`)).value, 's456');

// ---------- журнал: перший запуск — 8 діб з 90 днів тому, далі продовжує ----------
binCalls.length = 0;
cr = (await req('POST', '/api/cron/run/binotel', null, { 'X-Cron-Key': cronKey })).j;
assert.equal(cr.ok, true);
assert.equal(cr.result.chunks, 5);
assert.equal(binCalls.length, 5);
assert.deepEqual(sleeps, [5500, 5500, 5500, 5500], 'між запитами до Binotel — пауза');
const st1 = JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'binotel_sync'`)).value);
assert.ok(Math.abs(binCalls[0][0] - (Math.floor(Date.now() / 1000) - 60 - 90 * 86400)) < 5, 'початок — 90 днів тому');
assert.equal(st1.to, binCalls[4][1] + 1, 'наступного разу — з місця зупинки');
cr = (await req('POST', '/api/cron/run/binotel', null, { 'X-Cron-Key': cronKey })).j;
assert.equal(cr.result.skipped, 'ще рано', 'не частіше разу на 4 хв');
// Binotel: «занадто часто» — чекаємо й повторюємо; двічі поспіль — зупиняємось без помилки, продовжимо наступного разу
binCalls.length = 0; sleeps.length = 0; tooFrequent = 1;
r = await req('POST', '/api/tel/sync');
assert.equal(r.status, 200);
assert.equal(r.j.chunks, 5);
assert.ok(sleeps.includes(5500), 'паузи між запитами');
assert.ok(sleeps.includes(5 * 1000 + 500), 'чекали, скільки просив Binotel (5 с + запас)');
tooFrequent = 2;
r = await req('POST', '/api/tel/sync');
assert.equal(r.status, 200, '«занадто часто» — не помилка');
assert.equal(r.j.chunks, 0);
assert.equal(r.j.sync.error, '');
// «Оновити зараз» доводить до кінця
let guard = 0;
for (;;) {
  r = await req('POST', '/api/tel/sync');
  assert.equal(r.status, 200);
  if (r.j.caught || ++guard > 20) break;
}
assert.equal(r.j.sync.done, true);
assert.equal(r.j.sync.calls, 3, 'дзвінок без номера не зберігається');
const st2 = JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'binotel_sync'`)).value);
assert.ok(Math.floor(Date.now() / 1000) - st2.to >= 15 * 60 && Math.floor(Date.now() / 1000) - st2.to < 17 * 60, 'перечитує останні 15 хв');
binCalls.length = 0;
r = await req('POST', '/api/tel/sync');
assert.equal(binCalls.length, 1, 'наздогнали — одна доба за раз');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM tel_calls`)).n, 3, 'повторне читання не дублює');

// ---------- позначки в замовленнях ----------
o = (await req('GET', '/api/mp/orders?mp=rozetka')).j;
const a = o.rows.find((x) => x.id === '901');
const b = o.rows.find((x) => x.id === '902');
assert.equal(a.calls.before.n, 1, 'дзвонив за день до замовлення');
assert.equal(a.calls.before.last.dir, 'in');
assert.equal(a.calls.after.n, 1);
assert.equal(a.calls.after.answered, 1);
assert.deepEqual(a.calls.after.last, { at: kyiv(T(30) * 1000), dir: 'out', disp: 'ANSWER', billsec: 83, who: 'Оля' });
assert.equal(b.calls.before.n, 0, 'дзвінок 40 днів тому — не «до замовлення»');
assert.equal(b.calls.after.n, 0);
// Prom — без позначок
assert.ok(!('calls' in ((await req('GET', '/api/mp/orders?mp=prom')).j.rows[0] || {})));

// ---------- помилка Binotel: записується, показується в налаштуваннях ----------
badKey = true;
r = await req('POST', '/api/tel/sync');
assert.equal(r.status, 400);
const t = (await req('GET', '/api/tel/settings')).j;
assert.match(t.sync.error, /Wrong key/);
badKey = false;

// ---------- права: менеджер не бачить і не змінює налаштувань Binotel ----------
await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' });
const lm = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const M = { 'Content-Type': 'application/json', Cookie: lm.headers.get('set-cookie').split(';')[0] };
assert.equal((await req('GET', '/api/tel/settings', null, M)).status, 403);
assert.equal((await req('PUT', '/api/tel/settings', { clear: true }, M)).status, 403);
assert.ok(!Object.keys((await req('GET', '/api/bootstrap', null, M)).j.settings || {}).some((k) => k.startsWith('binotel_')));

// ---------- відключення: ключі видаляються, дзвінки лишаються, позначок немає ----------
r = await req('PUT', '/api/tel/settings', { clear: true });
assert.equal(r.j.configured, false);
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM tel_calls`)).n, 3);
o = (await req('GET', '/api/mp/orders?mp=rozetka')).j;
assert.ok(o.rows.every((x) => !('calls' in x)));

console.log('OK — Binotel: підключення, журнал дзвінків, позначки в замовленнях');
