// Маркетплейси → Розетка: групове переведення «Нових» в «Обробляється менеджером» — лише з «Нового», лише статус 26,
// до 10 за запит, помилка Розетки по одному замовленню не зупиняє інші, права market.edit.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
await db.run(`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'Ековент', 'u', 'p', 'rztok', ?, 1, ?)`, [now, now]);
for (const [id, st] of [['101', '1'], ['102', '1'], ['103', '26'], ['104', '1']]) {
  await db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, status_group)
    VALUES ('rozetka', 1, ?, ?, '2026-11-15 10:00:00', '2026-11-15 10:00:00', ?, ?, 'Клієнт', '380671112233', 100, '[]', 1)`, [id, id, st, st === '1' ? 'Нове замовлення' : 'Обробляється менеджером']);
}
const puts = [];
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.host === 'api-seller.rozetka.com.ua' && opts.method === 'PUT') {
    assert.equal(opts.headers.Authorization, 'Bearer rztok');
    const id = u.pathname.split('/')[2];
    puts.push([id, JSON.parse(opts.body)]);
    if (id === '104') return new Response(JSON.stringify({ success: false, errors: { message: 'Status change not allowed', code: 1001 } }));
    return new Response(JSON.stringify({ success: true, content: { id: Number(id), status: 26 } }));
  }
  if (u.host === 'api-seller.rozetka.com.ua' && u.pathname === '/orders/101' && (opts.method || 'GET') === 'GET') {
    return new Response(JSON.stringify({ success: true, content: { id: 101, expand: u.searchParams.get('expand'), payment_type_name: 'Оплата карткою' } }));
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

// діагностика: «сире» замовлення з Розетки (лише адміністратор)
let raw = await req('GET', '/api/mp/rz/raw/1/101?expand=payment,delivery');
assert.equal(raw.status, 200);
assert.deepEqual(raw.j, { id: 101, expand: 'payment,delivery', payment_type_name: 'Оплата карткою' });

// інший статус групою — ні
let r = await req('POST', '/api/mp/rz/status', { status: 45, orders: [{ account: 1, id: '101' }] });
assert.equal(r.status, 400);
r = await req('POST', '/api/mp/rz/status', { status: 26, orders: [] });
assert.equal(r.status, 400);

r = await req('POST', '/api/mp/rz/status', { status: 26, orders: [{ account: 1, id: '101' }, { account: 1, id: '102' }, { account: 1, id: '103' }, { account: 1, id: '104' }, { account: 1, id: '999' }] });
assert.equal(r.status, 200);
assert.deepEqual(r.j.done, ['1:101', '1:102']);
assert.deepEqual(r.j.failed.map((x) => x.key), ['1:103', '1:104', '1:999']);
assert.match(r.j.failed[0].error, /уже «Обробляється менеджером»/, 'не з «Нового» — у Розетку не йде');
assert.match(r.j.failed[1].error, /Status change not allowed/);
assert.match(r.j.failed[2].error, /не знайдено/i);
assert.deepEqual(puts, [['101', { status: 26 }], ['102', { status: 26 }], ['104', { status: 26 }]]);
const rows = await db.all(`SELECT id, status, status_name FROM mp_orders ORDER BY id`);
assert.deepEqual(rows.map((x) => `${x.id}:${x.status}`), ['101:26', '102:26', '103:26', '104:1'], 'у базі оновлено лише успішні');
assert.equal(rows[0].status_name, 'Обробляється менеджером');
// тепер у «Нових» лишилось одне
const g = (await req('GET', '/api/mp/orders?mp=rozetka&grp=new')).j;
assert.deepEqual(g.rows.map((x) => x.id), ['104']);

// понад 10 — береться перші 10
puts.length = 0;
r = await req('POST', '/api/mp/rz/status', { status: 26, orders: Array.from({ length: 15 }, (_, i) => ({ account: 1, id: String(500 + i) })) });
assert.equal(r.j.failed.length, 10);

// без права market.edit — заборонено
await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' });
await db.run(`UPDATE users SET access = ? WHERE login = 'man'`, [JSON.stringify({ b2b: 'none', retail: 'work', market: 'view', returns: 'view', shops: null, tg: [] })]);
const lm = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const M = { 'Content-Type': 'application/json', Cookie: lm.headers.get('set-cookie').split(';')[0] };
const me = (await req('GET', '/api/bootstrap', null, M)).j.user;
assert.ok(me.perms.includes('market.view') && !me.perms.includes('market.edit'));
assert.equal((await req('POST', '/api/mp/rz/status', { status: 26, orders: [{ account: 1, id: '104' }] }, M)).status, 403);
assert.equal((await req('GET', '/api/mp/rz/raw/1/101', null, M)).status, 403);

console.log('OK — маркетплейси: групове переведення «Нових» в «Обробляється менеджером»');
