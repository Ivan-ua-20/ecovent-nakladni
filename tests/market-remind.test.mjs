// Маркетплейси → Розетка: «Передзвонити» і ранкове нагадування в Telegram — скасовані й неоплачені за добу, без тих, хто
// замовив знову, кому дзвонили (Binotel) або відмітили «Подзвонив»; кожному менеджеру — його магазини, адмінам — зведення;
// раз на день, у вибрані дні, не раніше години; тестове — собі; права.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const T = Date.now();
const kyiv = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const ago = (h) => kyiv(T - h * 3600e3);
await db.batch([
  [`INSERT INTO settings (key, value) VALUES ('tg_token', 'tok'), ('tg_bot', 'bot') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'Ековент', 'u', 'p', 't', ?, 1, ?), (2, 'OneDay', 'u', 'p', 't', ?, 1, ?)`, [new Date().toISOString(), '', new Date().toISOString(), '']],
]);
const ins = (acc, id, status, phone, { created = 30, changed = 5, group = 3, name = 'Покупець', item = 'Осушувач ComfoDry 12', pay = '' } = {}) => db.run(
  `INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, status_group, pay_type)
   VALUES ('rozetka', ?, ?, ?, ?, ?, ?, ?, ?, ?, 7600, ?, ?, ?)`,
  [acc, id, id, ago(created), ago(changed), status, { 45: 'Скасовано покупцем', 40: 'Клієнт передумав', 50: 'Клієнт не оплатив', 31: 'Дубль', 26: 'Обробляється менеджером' }[status] || 'x', name, phone,
    JSON.stringify([{ id: '1', name: item, qty: 1, price: 7600 }]), group, pay]);
await ins(1, 'A1', '45', '380671110001', { name: 'Аліна' }); // скасувала сама — у список
await ins(1, 'B1', '40', '380671110002'); // передумав, але потім замовив знову — ні
await ins(2, 'B2', '26', '380671110002', { created: 2, changed: 2, group: 1 });
await ins(2, 'C1', '50', '380671110003', { pay: 'Оплата частинами', name: 'Олег' }); // не оплатив — список 2
await ins(1, 'D1', '31', '380671110004'); // дубль — ні
await ins(1, 'E1', '45', '380671110005', { changed: 80, created: 90 }); // давно (понад 3 доби) — ні
await ins(2, 'F1', '40', '380671110006', { name: 'Федір' }); // OneDay, потім відмітимо «Подзвонив»

const sent = [];
const fetchFn = async (url, opts = {}) => {
  if (String(url).includes('api.telegram.org')) { const b = JSON.parse(opts.body); sent.push({ chat: String(b.chat_id), text: b.text }); return new Response(JSON.stringify({ ok: true, result: {} })); }
  throw new Error(`неочікуваний запит ${url}`);
};
const shared = {};
const mk = () => createApp({ db, fetchFn, shared });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
// менеджери: Оксана — лише Ековент, Денис — обидва магазини, без Telegram «Маркетплейси» — не отримує
for (const [login, shops, tg, chat] of [['oksana', ['rozetka:1'], ['market'], '101'], ['denys', null, ['market'], '102'], ['quiet', null, [], '103']]) {
  await req('POST', '/api/users', { login, password: 'pass1234', role: 'manager', name: login === 'oksana' ? 'Оксана Петренко' : login });
  await db.run(`UPDATE users SET tg_chat_id = ?, access = ? WHERE login = ?`, [chat, JSON.stringify({ b2b: 'none', retail: 'none', market: 'work', returns: 'none', shops, tg }), login]);
}
await db.run(`UPDATE users SET tg_chat_id = '900' WHERE login = 'owner'`);

// ---------- група «Передзвонити» в сервісі ----------
let r = await req('GET', '/api/mp/orders?mp=rozetka&grp=recall');
assert.equal(r.status, 200);
assert.deepEqual(r.j.rows.map((x) => x.id).sort(), ['A1', 'C1', 'F1']);
assert.equal(r.j.recall, 3);
assert.equal((await req('GET', '/api/mp/orders?mp=rozetka')).j.recall, 3, 'лічильник — і в інших групах');

// ---------- «Подзвонив»: відмітка й зняття, права ----------
const lm = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'oksana', password: 'pass1234' }) });
const M = { 'Content-Type': 'application/json', Cookie: lm.headers.get('set-cookie').split(';')[0] };
assert.equal((await req('POST', '/api/mp/called', { account: 2, id: 'F1' }, M)).status, 403, 'чужий магазин');
r = await req('POST', '/api/mp/called', { account: 2, id: 'F1' });
assert.equal(r.status, 200);
assert.ok(r.j.called_at && r.j.called_by === 'owner');
assert.deepEqual((await req('GET', '/api/mp/orders?mp=rozetka&grp=recall')).j.rows.map((x) => x.id).sort(), ['A1', 'C1']);
assert.equal((await req('GET', '/api/mp/orders?mp=rozetka')).j.rows.find((x) => x.id === 'F1').called_by, 'owner');
r = await req('POST', '/api/mp/called', { account: 2, id: 'F1', undo: true });
assert.equal(r.j.called_at, '');
await req('POST', '/api/mp/called', { account: 2, id: 'F1' });

// ---------- налаштування ----------
r = await req('GET', '/api/mp/remind/settings');
assert.deepEqual([r.j.on, r.j.hour, r.j.days, r.j.client, r.j.unpaid, r.j.admins], [true, 9, [1, 2, 3, 4, 5, 6], true, true, true]);
assert.equal((await req('PUT', '/api/mp/remind/settings', { on: true, hour: 3, days: [1] })).status, 400);
assert.equal((await req('PUT', '/api/mp/remind/settings', { on: true, hour: 9, days: [1] }, M)).status, 403, 'налаштовують лише адміністратори');
const kyivHour = Number(kyiv(T).slice(11, 13));
const { key } = (await req('POST', '/api/jobs/key')).j;
const cron = async () => (await req('POST', '/api/cron/run/market-remind', null, { 'X-Cron-Key': key })).j;
if (kyivHour < 20) {
  await req('PUT', '/api/mp/remind/settings', { on: true, hour: kyivHour + 1, days: [1, 2, 3, 4, 5, 6, 7], client: true, unpaid: true, admins: true });
  r = await cron();
  assert.match(r.result.skipped, /ще рано/);
}
await req('PUT', '/api/mp/remind/settings', { on: false, hour: 5, days: [1, 2, 3, 4, 5, 6, 7], client: true, unpaid: true, admins: true });
assert.equal((await cron()).result.skipped, 'вимкнено');
assert.equal(sent.length, 0);

// ---------- надсилання: кожному — свої магазини, адмінам — зведення; раз на день ----------
await req('PUT', '/api/mp/remind/settings', { on: true, hour: 5, days: [1, 2, 3, 4, 5, 6, 7], client: true, unpaid: true, admins: true });
if (kyivHour >= 5) {
  r = await cron();
  assert.ok(r.ok, JSON.stringify(r));
  const to = (chat) => sent.filter((m) => m.chat === chat).map((m) => m.text);
  const ok = to('101');
  assert.equal(ok.length, 1, 'Оксана — одне повідомлення');
  assert.match(ok[0], /Оксана, ось кому варто подзвонити/);
  assert.match(ok[0], /<b>A1<\/b>/);
  assert.match(ok[0], /\+380 67 111 00 01/);
  assert.match(ok[0], /«Скасовано покупцем»/);
  assert.ok(!/C1|F1|B1|D1|E1/.test(ok[0]), 'лише її магазин і лише потрібні');
  const dn = to('102')[0];
  assert.match(dn, /Скасовані — 1/);
  assert.match(dn, /Не оплатили, скасовано — 1/);
  assert.match(dn, /<b>C1<\/b>[\s\S]*Оплата частинами не пройшла/);
  assert.match(dn, /1 покупц\. уже зробили нове замовлення/);
  assert.ok(!/F1/.test(dn), 'кому подзвонили — немає');
  assert.equal(to('103').length, 0, 'без сповіщень «Маркетплейси» — не отримує');
  assert.match(to('900')[0], /усі магазини[\s\S]*A1[\s\S]*C1/, 'власнику — зведення');
  const n = sent.length;
  assert.equal((await cron()).result.skipped, 'сьогодні вже надіслано');
  assert.equal(sent.length, n);
}

// ---------- тестове — собі ----------
sent.length = 0;
r = await req('POST', '/api/mp/remind/test', null, M);
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.deepEqual(sent.map((m) => m.chat), ['101']);
await db.run(`UPDATE users SET tg_chat_id = '' WHERE login = 'oksana'`);
r = await req('POST', '/api/mp/remind/test', null, M);
assert.equal(r.status, 400);
assert.match(r.j.error, /підключіть свій Telegram/);
console.log('OK — «Передзвонити»: відбір, «Подзвонив», ранкове нагадування менеджерам і адмінам, раз на день, тестове');
