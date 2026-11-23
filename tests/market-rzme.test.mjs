// Маркетплейси → особисті входи менеджерів у Розетку: підключення (перевірка входу й магазину), дії від імені
// менеджера (статус, скасування — з його токена), без входу — службовий вхід, правило «Вимагати особистий вхід»,
// пароль змінено → «bad» і службовий вхід, огляд для власника. Паролі назовні не віддаються.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
await db.run(`INSERT INTO rz_accounts (id, name, username, password, market_id, token, token_at, active, created_at) VALUES (1, 'Ековент', 'service@eco', 'p', '77', 'svc-tok', ?, 1, ?), (2, 'OneDay', 'svc2', 'p', '88', 'svc2-tok', ?, 1, ?)`, [now, now, now, now]);
for (const id of ['101', '102', '103', '104', '105']) {
  await db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, status_group)
    VALUES ('rozetka', 1, ?, ?, '2026-11-15 10:00:00', '2026-11-15 10:00:00', '1', 'Нове замовлення', 'Клієнт', '380671112233', 100, '[]', 1)`, [id, id]);
}
const LOGINS = { 'ivan@eco': ['ivpass', 77], 'oneday@eco': ['x', 88] };
const puts = []; // [order, token]
let logins = 0;
const ok = (content) => new Response(JSON.stringify({ success: true, content }));
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.host !== 'api-seller.rozetka.com.ua') throw new Error(`неочікуваний запит ${url}`);
  if (u.pathname === '/sites') {
    logins++;
    const b = JSON.parse(opts.body);
    const l = LOGINS[b.username];
    if (!l || atob(b.password) !== l[0]) return new Response(JSON.stringify({ success: false, errors: { message: 'incorrect_username_pasword', code: 1 } }));
    return ok({ access_token: `tok-${b.username}`, market: { id: l[1], title: l[1] === 77 ? 'Ековент' : 'OneDay' } });
  }
  if (opts.method === 'PUT' && /^\/orders\/\d+$/.test(u.pathname)) {
    puts.push([u.pathname.split('/')[2], opts.headers.Authorization.replace('Bearer ', '')]);
    return ok({ id: 1 });
  }
  throw new Error(`неочікуваний запит ${opts.method || 'GET'} ${url}`);
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' });
await db.run(`UPDATE users SET access = ? WHERE login = 'man'`, [JSON.stringify({ b2b: 'none', retail: 'none', market: 'work', returns: 'none', shops: ['rozetka:1'], tg: [] })]);
const lm = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const M = { 'Content-Type': 'application/json', Cookie: lm.headers.get('set-cookie').split(';')[0] };
const cancel = (id, h = M) => req('POST', '/api/mp/rz/cancel', { account: 1, id, status: 40 }, h);

// ---------- 1. Без особистого входу — службовий ----------
let me = (await req('GET', '/api/mp/rz/me', null, M)).j;
assert.deepEqual(me.accounts.map((a) => [a.id, a.state]), [[1, 'none']], 'лише свої магазини');
assert.equal((await cancel('101')).status, 200);
assert.deepEqual(puts.at(-1), ['101', 'svc-tok'], 'від службового входу');

// ---------- 2. Підключення: перевірка пароля, магазину, не службовий логін ----------
assert.match((await req('PUT', '/api/mp/rz/me/1', { username: 'ivan@eco', password: 'wrong' }, M)).j.error, /неправильний логін або пароль/);
assert.match((await req('PUT', '/api/mp/rz/me/1', { username: 'oneday@eco', password: 'x' }, M)).j.error, /входить у магазин «OneDay»/);
assert.match((await req('PUT', '/api/mp/rz/me/1', { username: 'service@eco', password: 'p' }, M)).j.error, /службовий вхід/);
assert.equal((await req('PUT', '/api/mp/rz/me/2', { username: 'oneday@eco', password: 'x' }, M)).status, 403, 'чужий магазин');
assert.equal((await req('PUT', '/api/mp/rz/me/1', { username: 'ivan@eco', password: 'ivpass' }, M)).status, 200);
me = (await req('GET', '/api/mp/rz/me', null, M)).j;
assert.deepEqual([me.accounts[0].state, me.accounts[0].username], ['ok', 'ivan@eco']);
assert.ok(!JSON.stringify(me).includes('ivpass') && !JSON.stringify(me).includes('tok-'), 'пароль і токен не віддаються');

// ---------- 3. Дії від імені менеджера ----------
const before = logins;
assert.equal((await cancel('102')).status, 200);
assert.deepEqual(puts.at(-1), ['102', 'tok-ivan@eco'], 'скасування — з його токена');
assert.equal((await req('POST', '/api/mp/rz/status', { status: 26, orders: [{ account: 1, id: '103' }] }, M)).j.done.length, 1);
assert.deepEqual(puts.at(-1), ['103', 'tok-ivan@eco'], 'груповий статус — з його токена');
assert.equal(logins, before, 'токен збережено — без повторного входу');
// власник без свого входу — від службового
assert.equal((await cancel('104', H)).status, 200);
assert.deepEqual(puts.at(-1), ['104', 'svc-tok']);

// ---------- 4. Пароль змінено: «bad», дія — від службового; правило «вимагати» ----------
LOGINS['ivan@eco'][0] = 'newpass';
await db.run(`UPDATE rz_user_logins SET token_at = '2020-01-01T00:00:00Z'`);
assert.equal((await req('POST', '/api/mp/rz/status', { status: 26, orders: [{ account: 1, id: '105' }] }, M)).j.done.length, 1);
assert.deepEqual(puts.at(-1), ['105', 'svc-tok'], 'вхід не прийнято — службовий');
me = (await req('GET', '/api/mp/rz/me', null, M)).j;
assert.equal(me.accounts[0].state, 'bad');
assert.equal((await req('PUT', '/api/mp/rz/require', { on: true }, M)).status, 403, 'правило вмикає лише власник/адмін');
await req('PUT', '/api/mp/rz/require', { on: true });
await db.run(`UPDATE mp_orders SET status = '1', status_group = 1 WHERE id = '101'`);
const blocked = await cancel('101');
assert.equal(blocked.status, 403);
assert.match(blocked.j.error, /не прийняла ваш вхід/);
assert.equal((await cancel('101', H)).status, 200, 'власника правило не стосується');
await req('PUT', '/api/mp/rz/me/1', { username: 'ivan@eco', password: 'newpass' }, M);
await db.run(`UPDATE mp_orders SET status = '1', status_group = 1 WHERE id = '101'`);
assert.equal((await cancel('101')).status, 200);
assert.deepEqual(puts.at(-1), ['101', 'tok-ivan@eco'], 'оновлений вхід — знову від менеджера');

// ---------- 5. Огляд для власника; відключення ----------
assert.equal((await req('GET', '/api/mp/rz/logins', null, M)).status, 403);
const all = (await req('GET', '/api/mp/rz/logins')).j;
assert.equal(all.require, true);
assert.deepEqual(all.logins.map((r) => [r.account_id, r.username, r.state]), [[1, 'ivan@eco', 'ok']]);
assert.ok(!JSON.stringify(all).includes('newpass'), 'паролі не віддаються');
await req('DELETE', '/api/mp/rz/me/1', null, M);
assert.equal((await req('GET', '/api/mp/rz/me', null, M)).j.accounts[0].state, 'none');
console.log('OK — маркетплейси: особисті входи менеджерів у Розетку');
