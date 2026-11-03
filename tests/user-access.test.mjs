// Доступ до розділів для менеджера й перегляду: B2B (перегляд / повний), Рітейл і Маркетплейси (перегляд / робота),
// окремі магазини маркетплейсів, сповіщення розділу в Telegram, журнал змін доступу.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
await db.batch([
  [`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'Ековент', 'u', 'p', 'rztok', ?, 1, ?), (2, 'OneDay', 'u2', 'p2', 'rztok2', ?, 1, ?)`, [now, now, now, now]],
  [`INSERT INTO prom_accounts (id, name, token, active, created_at) VALUES (1, 'Prom Arca', 'promtok', 1, ?)`, [now]],
  [`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, total, items) VALUES
    ('rozetka', 1, 'a1', 'a1', '2026-10-01 10:00:00', '2026-10-01 10:00:00', '1', 'Нове', 'Клієнт 1', 100, '[]'),
    ('rozetka', 2, 'b1', 'b1', '2026-10-01 10:00:00', '2026-10-01 10:00:00', '1', 'Нове', 'Клієнт 2', 200, '[]')`, []],
  ...[['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_hook_v', '2']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]),
]);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body || '{}')); return new Response('{"ok":true,"result":{"message_id":1}}'); }
  return new Response('{}');
};
const mk = () => createApp({ db, fetchFn });
const call = async (method, path, body, headers) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const login = async (l) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: 'pass1234' }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const perms = async (h) => (await call('GET', '/api/bootstrap', null, h)).j.user.perms;

// ---------- типовий менеджер: Рітейл і Маркетплейси (робота), B2B — ні ----------
const m1 = (await call('POST', '/api/users', { login: 'man1', name: 'Менеджер 1', password: 'pass1234', role: 'manager' }, H)).j;
const M1 = await login('man1');
let p = await perms(M1);
assert.ok(p.includes('retail.edit') && p.includes('market.edit') && !p.includes('b2b.view'), 'типово — як було');
assert.equal((await call('GET', '/api/b2b/partners', null, M1)).status, 403);
assert.equal((await call('GET', '/api/rzs/orders', null, M1)).status, 200);

// ---------- B2B перегляд, без Рітейлу, Маркетплейси — лише магазин rozetka:1, сповіщення B2B ----------
let r = await call('PUT', `/api/users/${m1.id}`, { access: { b2b: 'view', retail: 'none', market: 'work', shops: ['rozetka:1'], tg: ['b2b'] } }, H);
assert.equal(r.status, 200);
p = await perms(M1);
assert.ok(p.includes('b2b.view') && !p.includes('b2b.admin') && !p.includes('retail.view'));
assert.equal((await call('GET', '/api/b2b/partners', null, M1)).status, 200, 'B2B відкривається');
assert.equal((await call('GET', '/api/b2b/orders', null, M1)).status, 200);
assert.equal((await call('POST', '/api/b2b/partners', { name: 'X' }, M1)).status, 403, 'а змінювати — ні');
assert.equal((await call('GET', '/api/rzs/orders', null, M1)).status, 403, 'Рітейл закрито');
const shops = (await call('GET', '/api/mp/shops', null, M1)).j;
assert.deepEqual(shops.find((m) => m.key === 'rozetka').shops.map((x) => x.id), [1], 'лише свій магазин');
assert.equal(shops.find((m) => m.key === 'prom').shops.length, 0);
assert.deepEqual((await call('GET', '/api/mp/orders?mp=rozetka', null, M1)).j.rows.map((x) => x.id), ['a1'], 'усі замовлення — лише свого магазину');
assert.equal((await call('GET', '/api/mp/orders?mp=rozetka&account=2', null, M1)).status, 403);
assert.equal((await call('POST', '/api/mp/review/ask', { account: 2, id: 'b1', via: 'viber' }, M1)).status, 403, 'чужий магазин');
assert.equal((await call('POST', '/api/mp/review/ask', { account: 1, id: 'a1', via: 'viber' }, M1)).status, 200, 'свій — можна');
// власник бачить усе
assert.equal((await call('GET', '/api/mp/orders?mp=rozetka', null, H)).j.rows.length, 2);
const list = (await call('GET', '/api/users', null, H)).j.users.find((x) => x.login === 'man1');
assert.deepEqual(list.access, { b2b: 'view', retail: 'none', market: 'work', shops: ['rozetka:1'], tg: ['b2b'] });
// журнал: хто й що змінив
const aud = await db.all(`SELECT * FROM audit_log WHERE kind = 'user' AND action LIKE 'доступ man1%'`);
assert.equal(aud.length, 1);
assert.equal(aud[0].action, 'доступ man1: B2B: немає → перегляд; Рітейл: робота → немає; магазини: усі → rozetka:1; Telegram: — → B2B');

// ---------- сповіщення розділу B2B — і цьому менеджеру ----------
await db.run(`UPDATE users SET tg_chat_id = '555' WHERE login = 'man1'`);
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
const pa = (await call('POST', '/api/b2b/partners', { name: 'Партнер' }, H)).j;
await call('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' }, H);
const A = await login('pa');
tg.length = 0;
assert.equal((await call('POST', '/api/b2b/p/team', { login: 'pa2', password: 'pass1234', role: 'staff' }, A)).status, 200);
assert.ok(tg.some((m) => String(m.chat_id) === '555' && /додав користувача/.test(m.text)), 'менеджеру зі сповіщеннями B2B');
assert.ok(tg.some((m) => String(m.chat_id) === '1'), 'власнику — як і раніше');

// ---------- «Перегляд» не отримує більше за перегляд ----------
const v1 = (await call('POST', '/api/users', { login: 'view1', password: 'pass1234', role: 'viewer', access: { b2b: 'full', retail: 'work', market: 'work', shops: null, tg: [] } }, H)).j;
const V1 = await login('view1');
p = await perms(V1);
assert.ok(p.includes('b2b.view') && !p.includes('b2b.admin') && p.includes('retail.view') && !p.includes('retail.edit') && !p.includes('market.edit'));
assert.equal((await call('POST', '/api/mp/review/ask', { account: 1, id: 'a1', via: 'viber' }, V1)).status, 403);
assert.ok(v1.id);

// ---------- повний B2B ----------
await call('PUT', `/api/users/${m1.id}`, { access: { b2b: 'full', retail: 'work', market: 'none', shops: null, tg: [] } }, H);
assert.equal((await call('POST', '/api/b2b/partners', { name: 'Від менеджера' }, M1)).status, 200);
assert.equal((await call('GET', '/api/mp/shops', null, M1)).status, 403, 'Маркетплейси закрито');
// скинути — як у ролі
await call('PUT', `/api/users/${m1.id}`, { access: null }, H);
p = await perms(M1);
assert.ok(!p.includes('b2b.view') && p.includes('market.view'));
// менеджер не може змінювати доступ
assert.equal((await call('PUT', `/api/users/${v1.id}`, { access: { b2b: 'full' } }, M1)).status, 403);

console.log('user-access: ok');
