// B2B: розсилка змін цін партнеру, якому ще не надсилали (бренд відкрито давно — не «новий», зміни цін не губляться),
// і відстрочка підвищення цін: N годин після підвищення РРЦ партнер замовляє за старою ціною (загальна й власна).
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'FlexyDry 16', 901), (12, 'NovaDry 16', 901)`, []],
]);
const PRICES = { 11: '9000.00', 12: '9000.00' };
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) return new Response(JSON.stringify({ ok: true, result: {} }));
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `EVOAIR ${id}`, price: PRICES[id] })) }));
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
const resync = async () => { await db.run(`UPDATE b2b_catalog SET checked_at = ''`); await req('POST', '/api/b2b/catalog/sync'); };
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

// Партнер «МТА»: підключений 10 днів тому з брендом Evoair (15%), розсилок цін ще не було.
const mta = await req('POST', '/api/b2b/partners', { name: 'МТА' });
await req('POST', `/api/b2b/partners/${mta.id}/users`, { login: 'mta', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${mta.id}/margins`, [{ brand_id: 901, margin: 15 }]);
await req('POST', '/api/b2b/catalog/sync');
await db.batch([
  [`UPDATE b2b_partners SET created_at = ? WHERE id = ?`, [ago(240), mta.id]],
  [`UPDATE b2b_margin_log SET at = ? WHERE partner_id = ?`, [ago(240), mta.id]],
]);
const M = await login('mta', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП МТА', code: '1234567890' }, M);

// ---------- 1. Ціни зросли в LP-CRM — розсилка про товари, а не «нові бренди» ----------
PRICES[11] = '9400.00';
PRICES[12] = '9400.00';
await resync();
let pv = (await req('GET', '/api/b2b/price-changes')).find((x) => x.id === mta.id);
let text = pv.preview.join('\n');
assert.ok(!/Нові бренди/.test(text), `бренд давно відкритий — не «новий»: ${text}`);
assert.equal(pv.products, 2);
assert.match(text, /EVOAIR 11\n {3}РРЦ 9[\s ]000,00 → <b>9[\s ]400,00<\/b> ▲ · ваша ціна 7[\s ]650,00 → <b>7[\s ]990,00<\/b> грн ▲/);
assert.ok(!/⏳/.test(text), 'без відстрочки — без примітки');
// щойно підключений партнер — бренд справді новий
const nw = await req('POST', '/api/b2b/partners', { name: 'Новий' });
await req('PUT', `/api/b2b/partners/${nw.id}/margins`, [{ brand_id: 901, margin: 10 }]);
assert.match((await req('GET', '/api/b2b/price-changes')).find((x) => x.id === nw.id).preview[0], /Нові бренди для вас:.*Evoair — знижка 10%/s);

// ---------- 2. Відстрочка підвищення: загальна 24 год ----------
assert.equal(await status(() => req('PUT', '/api/b2b/price-grace', { hours: 1000 })), 400);
assert.equal(await status(() => req('PUT', '/api/b2b/price-grace', { hours: 24 }, M)), 403, 'партнер не змінює');
await req('PUT', '/api/b2b/price-grace', { hours: 24 });
let cat = (await req('GET', '/api/b2b/p/catalog', null, M)).products;
let p11 = cat.find((x) => x.id === 11);
assert.deepEqual([p11.rrp, p11.price, p11.rrp_new, p11.price_new], [9000, 7650, 9400, 7990], 'поки діє відстрочка — стара ціна, видно нову');
assert.ok(Date.parse(p11.grace_until) > Date.now() + 23 * 3600e3);
let d = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, draft: true, items: [{ product_id: 11, qty: 2 }] }, M);
assert.equal((await db.get(`SELECT price FROM b2b_order_items WHERE order_id = ?`, [d.id])).price, 7650, 'закупівля — за старою ціною');
pv = (await req('GET', '/api/b2b/price-changes')).find((x) => x.id === mta.id);
text = pv.preview.join('\n');
assert.match(text, /⏳ за старою ціною — до /);
assert.match(text, /через 24 год після зміни/);
// зниження діє одразу
PRICES[12] = '8000.00';
await resync();
assert.equal((await req('GET', '/api/b2b/p/catalog', null, M)).products.find((x) => x.id === 12).price, 6800, 'знижена ціна — одразу');

// ---------- 3. Власна відстрочка партнера важливіша за загальну ----------
assert.equal(await status(() => req('PUT', `/api/b2b/partners/${mta.id}`, { name: 'МТА', price_grace_hours: 'abc' })), 400);
await req('PUT', `/api/b2b/partners/${mta.id}`, { name: 'МТА', price_grace_hours: '0' });
assert.equal((await req('GET', '/api/b2b/p/catalog', null, M)).products.find((x) => x.id === 11).price, 7990, '0 — без відстрочки, нова ціна');
assert.deepEqual((await req('GET', '/api/b2b/price-grace')).partners.map((x) => [x.name, x.price_grace_hours]), [['МТА', 0]]);
await req('PUT', `/api/b2b/partners/${mta.id}`, { name: 'МТА', price_grace_hours: '48' });
await db.run(`UPDATE b2b_price_log SET at = ? WHERE product_id = 11`, [ago(30)]); // підвищення було 30 год тому
p11 = (await req('GET', '/api/b2b/p/catalog', null, M)).products.find((x) => x.id === 11);
assert.equal(p11.price, 7650, '48 год — ще стара');
await req('PUT', `/api/b2b/partners/${mta.id}`, { name: 'МТА', price_grace_hours: '' }); // знову загальна (24 год)
p11 = (await req('GET', '/api/b2b/p/catalog', null, M)).products.find((x) => x.id === 11);
assert.ok(p11.price === 7990 && !p11.grace_until, 'загальні 24 год минули — нова ціна');
d = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, draft: true, items: [{ product_id: 11, qty: 1 }] }, M);
assert.equal((await db.get(`SELECT price FROM b2b_order_items WHERE order_id = ?`, [d.id])).price, 7990);
const hist = await db.all(`SELECT action FROM audit_log WHERE kind = 'b2b' AND action LIKE 'відстрочка підвищення цін%'`);
assert.ok(hist.length >= 3, 'зміни відстрочки — в історії партнера');
console.log('OK — B2B: розсилка змін цін (без хибних «нових брендів») і відстрочка підвищення цін');
