// B2B: керівник партнера дозволяє менеджеру самому відправляти закупівлі. Без дозволу менеджер лише збирає чернетку;
// з дозволом — оформлює одразу, відправляє чернетку й підтверджує закупівлю від Ековент. Роль «Лише перегляд» — ніколи.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901)`, []],
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
]);
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: '10000.00' })) }));
};
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'boss', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
const BOSS = await login('boss', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, BOSS);
const ol = await req('POST', '/api/b2b/p/team', { login: 'olena', password: 'pass1234', partner_role: 'staff' }, BOSS);
const vw = await req('POST', '/api/b2b/p/team', { login: 'viewer1', password: 'pass1234', partner_role: 'viewer', can_send: true }, BOSS);
const OL = await login('olena', 'pass1234');
const VW = await login('viewer1', 'pass1234');
const buy = (h, extra = {}) => req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 1 }], ...extra }, h);
const statusOf = async (id) => (await db.get(`SELECT status FROM b2b_orders WHERE id = ?`, [id])).status;

// ---------- без дозволу: лише чернетка ----------
assert.equal((await req('GET', '/api/b2b/p/limits', null, OL)).can_send, false);
assert.equal((await req('GET', '/api/b2b/p/limits', null, BOSS)).can_send, true, 'керівник — завжди');
let o = await buy(OL);
assert.equal(o.draft, true, 'менеджер без дозволу — у чернетку');
assert.equal(await statusOf(o.id), 'draft');
assert.equal(await status(() => req('POST', `/api/b2b/p/orders/${o.id}/send`, {}, OL)), 403);
assert.equal((await req('GET', `/api/b2b/p/orders/${o.id}`, null, OL)).can_send, false);
let team = await req('GET', '/api/b2b/p/team', null, BOSS);
assert.deepEqual(team.users.map((u) => [u.login, u.can_send]).sort(), [['boss', true], ['olena', false], ['viewer1', false]], '«Лише перегляд» не отримує дозволу');

// ---------- керівник дає дозвіл ----------
await req('PUT', `/api/b2b/p/team/${ol.id}`, { can_send: true }, BOSS);
assert.equal(await status(() => req('PUT', `/api/b2b/p/team/${ol.id}`, { can_send: false }, OL)), 403, 'менеджер сам собі дозвіл не змінює');
assert.equal((await req('GET', '/api/b2b/p/limits', null, OL)).can_send, true);
await req('POST', `/api/b2b/p/orders/${o.id}/send`, {}, OL);
assert.notEqual(await statusOf(o.id), 'draft', 'чернетку відправлено менеджером');
const o2 = await buy(OL);
assert.ok(!o2.draft, 'оформлює одразу');
assert.equal(await statusOf(o2.id), 'invoice_wait');
assert.ok((await db.all(`SELECT action FROM audit_log WHERE kind = 'b2b'`)).some((r) => /olena: дозволено відправляти закупівлі — змінив партнер/.test(r.action)), 'у журналі змін');
// адмін бачить дозвіл у картці партнера й може його зняти
let det = await req('GET', `/api/b2b/partners/${pa.id}`);
assert.equal(det.users.find((u) => u.login === 'olena').can_send, true);
await req('PUT', `/api/b2b/partners/${pa.id}/users/${ol.id}`, { can_send: false });
assert.equal((await req('GET', '/api/b2b/p/limits', null, OL)).can_send, false);
assert.equal((await buy(OL)).draft, true);

// ---------- роль змінилася — дозвіл знімається ----------
await req('PUT', `/api/b2b/p/team/${ol.id}`, { can_send: true }, BOSS);
await req('PUT', `/api/b2b/p/team/${ol.id}`, { partner_role: 'viewer' }, BOSS);
assert.ok(!(await db.get(`SELECT 1 AS ok FROM b2b_team_send WHERE user_id = ?`, [ol.id])), 'перегляд — дозвіл знято');
await req('PUT', `/api/b2b/p/team/${ol.id}`, { partner_role: 'staff' }, BOSS);
assert.equal((await req('GET', '/api/b2b/p/limits', null, await login('olena', 'pass1234'))).can_send, false, 'повернули менеджером — без дозволу, доки не дадуть знову');
assert.equal(await status(() => buy(VW)), 403, 'перегляд нічого не оформлює');
assert.equal(vw.id > 0, true);

console.log('OK — B2B: дозвіл менеджеру партнера відправляти закупівлі');
