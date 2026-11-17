// B2B: Excel-прайси з адмінки — каталог (бренди з кількістю товарів, товари обраних брендів) і прайс партнера
// (його бренди й маржа, особлива ціна на товар — як у кабінеті партнера). Партнер і «лише перегляд» без прав адміна — ні.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98), (902, 'Levoit', 'levoit', 99)`, []],
  [`INSERT INTO an_categories (id, name) VALUES (5, 'Осушувачі')`, []],
  [`INSERT INTO an_products (product_id, name, brand_id, category_id) VALUES (11, 'Fan', 901, 5), (12, 'Fan 2', 901, 5), (21, 'Core', 902, NULL)`, []],
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO settings (key, value) VALUES ('b2b_margin_default', '20') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
]);
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) return new Response(JSON.stringify({ ok: true, result: {} }));
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '10000.00', 12: '5000.00', 21: '8000.00' }[id] })) }));
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const call = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const req = async (...a) => { const r = await call(...a); if (r.status >= 400) throw new Error(r.j.error || r.status); return r.j; };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }, { brand_id: 902, margin: 15 }]);
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE b2b_catalog SET hidden = 1 WHERE product_id = 12`); // прихований — не в прайсі

// ---------- каталог: бренди й товари ----------
let d = await req('GET', '/api/b2b/price-list');
assert.deepEqual(d.brands.map((b) => [b.name, b.n]), [['Evoair', 1], ['Levoit', 1]]);
assert.equal(d.defaults.margin, 20, 'знижка за замовчуванням');
assert.equal(d.products.length, 0, 'без брендів — без товарів');
d = await req('GET', '/api/b2b/price-list?brands=901');
assert.deepEqual(d.products.map((p) => [p.id, p.rrp, p.brand, p.category]), [[11, 10000, 'Evoair', 'Осушувачі']]);
d = await req('GET', '/api/b2b/price-list?brands=901,902');
assert.deepEqual(d.products.map((p) => [p.id, p.category]).sort(), [[11, 'Осушувачі'], [21, 'Інше']]);

// ---------- прайс партнера: маржа бренду й особлива ціна ----------
await db.run(`INSERT INTO b2b_product_margins (partner_id, product_id, margin, created_at) VALUES (?, 21, 25, '2026-11-01T00:00:00Z')`, [pa.id]);
const pp = await req('GET', `/api/b2b/partners/${pa.id}/price-list`);
assert.equal(pp.partner.name, 'Партнер А');
assert.deepEqual(pp.brands.map((b) => [b.name, b.margin, b.n, b.special]), [['Evoair', 10, 1, 0], ['Levoit', 15, 1, 1]]);
assert.deepEqual(pp.products.map((p) => [p.id, p.price, p.special]).sort(), [[11, 9000, false], [21, 6000, true]], 'ціна партнера: 10 % від РРЦ і особлива 25 %');
// збігається з тим, що партнер бачить у кабінеті
const A = (await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'pa', password: 'pass1234' }) })).headers.get('set-cookie').split(';')[0];
const mine = await req('GET', '/api/b2b/p/catalog', null, { 'Content-Type': 'application/json', Cookie: A });
assert.deepEqual(mine.products.map((p) => [p.id, p.price]).sort(), pp.products.map((p) => [p.id, p.price]).sort());

// ---------- права ----------
assert.equal((await call('GET', '/api/b2b/price-list', null, { 'Content-Type': 'application/json', Cookie: A })).status, 403, 'партнер не бачить прайс інших');
assert.equal((await call('GET', `/api/b2b/partners/${pa.id}/price-list`, null, { 'Content-Type': 'application/json', Cookie: A })).status, 403);
assert.equal((await call('GET', '/api/b2b/partners/999/price-list')).status, 404);

console.log('OK — B2B: Excel-прайси з каталогу й прайс партнера');
