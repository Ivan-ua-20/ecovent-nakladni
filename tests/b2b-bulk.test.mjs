// Групові дії над партнерами: пауза, ліміти, маржа.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  ...[['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_hook_v', '2']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]),
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901)`, []],
]);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '10000.00', 12: '5000.00' }[id] })) }));
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
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]); // Fan 9000, Fan 2 4500
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
await db.run(`UPDATE users SET tg_chat_id = '2' WHERE login = 'pa'`);
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);
const supply = (items, extra = {}) => req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items, ...extra }, A);

const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
const pc = await req('POST', '/api/b2b/partners', { name: 'Партнер В' });
await req('PUT', `/api/b2b/partners/${pb.id}/margins`, [{ brand_id: 901, margin: 20 }, { brand_id: 0, margin: 5 }]);
const bulk = (ids, body) => req('POST', '/api/b2b/partners/bulk', { ids, ...body });
const margins = async (id) => Object.fromEntries((await db.all(`SELECT brand_id, margin FROM b2b_margins WHERE partner_id = ? ORDER BY brand_id`, [id])).map((r) => [r.brand_id, r.margin]));

// ---------- 1. Пауза: кабінет видно, нові закупівлі й замовлення — ні ----------
let r = await bulk([pa.id, pb.id], { action: 'pause', note: 'до оплати рахунків' });
assert.deepEqual(r.results.map((x) => [x.ok, x.changed]), [[true, 1], [true, 1]]);
let lim = await req('GET', '/api/b2b/p/limits', null, A);
assert.deepEqual(lim.paused, { note: 'до оплати рахунків' });
assert.match(await errOf(() => supply([{ product_id: 11, qty: 1 }])), /призупинено: до оплати рахунків/);
assert.match(await errOf(() => req('POST', '/api/b2b/p/clients', { client_name: 'К', client_phone: '0501112233', items: [{ product_id: 11, qty: 1 }] }, A)), /призупинено/);
assert.ok((await req('GET', '/api/b2b/p/orders', null, A)).rows, 'перегляд працює');
assert.equal((await req('GET', '/api/b2b/partners')).find((p) => p.id === pa.id).paused, 1);
r = await bulk([pa.id], { action: 'resume' });
assert.equal(r.results[0].changed, 1);
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).paused, null);
const s1 = await supply([{ product_id: 11, qty: 1 }]);
assert.ok(s1.id, 'після паузи — можна');
// пауза з картки партнера (PUT)
await req('PUT', `/api/b2b/partners/${pa.id}`, { name: 'Партнер А', paused: 1, pause_note: '' });
assert.match(await errOf(() => supply([{ product_id: 11, qty: 1 }])), /призупинено\. Зверніться/);
await req('PUT', `/api/b2b/partners/${pa.id}`, { name: 'Партнер А', paused: 0 });

// ---------- 2. Ліміти групою: лише передані поля ----------
await req('PUT', `/api/b2b/partners/${pc.id}`, { name: 'Партнер В', unpaid_limit: 70000 });
r = await bulk([pa.id, pb.id, pc.id], { action: 'limits', open_limit: '25000', postpay_days: 10 });
assert.ok(r.results.every((x) => x.ok && x.changed));
let rows = await db.all(`SELECT id, open_limit, unpaid_limit, postpay_days FROM b2b_partners ORDER BY id`);
assert.deepEqual(rows.map((x) => [x.open_limit, x.unpaid_limit, x.postpay_days]), [[25000, null, 10], [25000, null, 10], [25000, 70000, 10]], 'неопл. ліміт В не зачеплено');
r = await bulk([pc.id], { action: 'limits', unpaid_limit: '', postpay_days: 0 });
assert.deepEqual(Object.values(await db.get(`SELECT unpaid_limit, postpay_days FROM b2b_partners WHERE id = ?`, [pc.id])), [null, 0], 'скинуто до типових');
r = await bulk([pa.id, pb.id], { action: 'limits', open_limit: 'abc' });
assert.ok(r.results.every((x) => !x.ok && /сума/.test(x.error)));

// ---------- 3. Маржа групою ----------
// А: 901 → 10; Б: 901 → 20, 0 → 5; В: нічого
r = await bulk([pa.id, pb.id, pc.id], { action: 'margin', brand: 'all', mode: 'add', value: '2' });
assert.deepEqual([await margins(pa.id), await margins(pb.id), await margins(pc.id)], [{ 901: 12 }, { 0: 7, 901: 22 }, {}]);
r = await bulk([pa.id, pb.id, pc.id], { action: 'margin', brand: '901', mode: 'set', value: '15' });
assert.deepEqual([await margins(pa.id), await margins(pc.id)], [{ 901: 15 }, {}], 'без «увімкнути» — лише де бренд увімкнено');
r = await bulk([pc.id], { action: 'margin', brand: '901', mode: 'set', value: '15', enable: true });
assert.deepEqual(await margins(pc.id), { 901: 15 });
r = await bulk([pb.id], { action: 'margin', brand: '0', mode: 'disable' });
assert.deepEqual(await margins(pb.id), { 901: 15 });
r = await bulk([pa.id], { action: 'margin', brand: 'all', mode: 'add', value: '-20' });
assert.deepEqual(await margins(pa.id), { 901: 0 }, 'не нижче 0');
const log = await db.all(`SELECT old_margin, new_margin FROM b2b_margin_log WHERE partner_id = ? ORDER BY id`, [pb.id]);
assert.deepEqual(log.slice(-4).map((x) => [x.old_margin, x.new_margin]), [[5, 7], [20, 22], [22, 15], [7, null]], 'журнал для розсилки змін цін');
const pc1 = (await req('GET', '/api/b2b/price-changes')).find((x) => x.id === pc.id);
assert.equal(pc1.brands, 1, 'новий бренд потрапляє в «зміни цін»');
assert.match(await errOf(() => bulk([pa.id], { action: 'margin', brand: 'all', mode: 'disable' })), /конкретний бренд/);
assert.match(await errOf(() => bulk([pa.id], { action: 'margin', brand: 'all', mode: 'set', value: '120' })), /99,99/);
assert.match(await errOf(() => bulk([pa.id], { action: 'zzz' })), /Невідома/);
assert.match(await errOf(() => bulk([], { action: 'pause' })), /Оберіть/);
// партнер не може
assert.ok(await errOf(() => req('POST', '/api/b2b/partners/bulk', { ids: [pa.id], action: 'resume' }, A)));

console.log('b2b-bulk: ok');
