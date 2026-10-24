// B2B: фільтри списків (пошук, період, оплата, статус) і аналітика продажів партнера.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'TestBrand', 'testbrand', 98), (902, 'Other', 'other', 99)`, []],
  [`INSERT INTO an_categories (id, name) VALUES (5, 'Вентилятори'), (6, 'Обігрівачі')`, []],
  [`INSERT INTO an_products (product_id, name, brand_id, category_id) VALUES (11, 'Fan', 901, 5), (12, 'Fan 2', 901, 5), (21, 'Heater', 902, 6)`, []],
]);
const fetchFn = async (url, opts = {}) => {
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '1000.00', 12: '500.00', 21: '2000.00' }[id] })) }));
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
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('POST', `/api/b2b/partners/${pb.id}/users`, { login: 'pb', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }, { brand_id: 902, margin: 20 }]);
await req('PUT', `/api/b2b/partners/${pb.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
const A = await login('pa', 'pass1234');
const B = await login('pb', 'pass1234');
const ea = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);
const eb = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Бета', code: '1234567891' }, B);

// закупівля А: 5×Fan (900), 2×Heater (1600) = 7700; оплачена
const s1 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 11, qty: 5 }, { product_id: 21, qty: 2 }] }, A);
await req('PUT', `/api/b2b/orders/${s1.id}`, { invoice_no: 'СФ-1' });
await req('POST', `/api/b2b/orders/${s1.id}/status`, { status: 'paid' });
// закупівля А №2 — не оплачена, рахунок є: 1×Fan 2 (450)
const s2 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 12, qty: 1 }] }, A);
await req('PUT', `/api/b2b/orders/${s2.id}`, { invoice_no: 'СФ-2' });
// закупівля Б
await req('POST', '/api/b2b/p/orders', { entity_id: eb.id, items: [{ product_id: 11, qty: 1 }] }, B);
const cl = { client_phone: '0501112233' };
const c1 = await req('POST', '/api/b2b/p/clients', { ...cl, client_name: 'Олена Петренко', ttn: '20450000000001', supply_id: s1.id, items: [{ product_id: 11, qty: 3 }] }, A);
const c2 = await req('POST', '/api/b2b/p/clients', { ...cl, client_name: 'Іван Сидоренко', client_phone: '0679998877', supply_id: s1.id, items: [{ product_id: 21, qty: 1 }, { product_id: 11, qty: 1 }] }, A);
const c3 = await req('POST', '/api/b2b/p/clients', { ...cl, client_name: 'Без закупівлі', items: [{ product_id: 12, qty: 2 }] }, A);
await req('POST', `/api/b2b/p/clients/${c3.id}/cancel`, {}, A).catch(() => 0);
const c4 = await req('POST', '/api/b2b/p/clients', { ...cl, client_name: 'Марія', supply_id: s2.id, items: [{ product_id: 12, qty: 1 }] }, A);

// ---------- 1. Фільтри ----------
const ids = (r) => r.rows.map((x) => x.id).sort((a, b) => a - b);
assert.deepEqual(ids(await req('GET', `/api/b2b/clients?q=${encodeURIComponent('олена')}`)), [c1.id], 'пошук за ПІБ');
assert.deepEqual(ids(await req('GET', '/api/b2b/clients?q=0679998877')), [c2.id], 'пошук за телефоном');
assert.deepEqual(ids(await req('GET', '/api/b2b/clients?q=20450000000001')), [c1.id], 'пошук за ТТН');
assert.deepEqual(ids(await req('GET', `/api/b2b/clients?q=B2B-${c2.id}`)), [c2.id], 'пошук за №');
assert.deepEqual(ids(await req('GET', '/api/b2b/clients?pay=unpaid&view=new')), [c4.id], 'не оплачені (закупівля не оплачена)');
assert.deepEqual(ids(await req('GET', '/api/b2b/clients?pay=paid')), [c1.id, c2.id]);
assert.deepEqual(ids(await req('GET', '/api/b2b/orders?q=СФ-2')), [s2.id], 'закупівлі: за № рахунку');
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
assert.equal((await req('GET', `/api/b2b/orders?from=${today}&to=${today}`)).rows.length, 3, 'період — сьогодні');
assert.equal((await req('GET', '/api/b2b/orders?from=2020-01-01&to=2020-01-31')).rows.length, 0);
assert.deepEqual(ids(await req('GET', '/api/b2b/p/orders?status=paid', null, A)), [s1.id], 'партнер: фільтр статусу');
assert.deepEqual(ids(await req('GET', '/api/b2b/p/clients?q=0679998877', null, A)), [c2.id]);
assert.equal((await req('GET', '/api/b2b/p/clients?q=0679998877', null, B)).rows.length, 0, 'чужих не знаходить');
assert.equal((await req('GET', `/api/b2b/clients?q=${encodeURIComponent("' OR 1=1 --")}`)).rows.length, 0, 'пошук — параметром, без ін’єкцій');

// ---------- 2. Аналітика партнера ----------
const st = await req('GET', '/api/b2b/p/stats', null, A);
assert.equal(st.period.days, 30);
const cancelled = (await req('GET', `/api/b2b/p/clients/${c3.id}`, null, A)).order.status === 'cancelled';
const expCnt = cancelled ? 3 : 4;
assert.equal(st.sales.cnt, expCnt, 'замовлення клієнтів без скасованих');
// c1: 3×900=2700 (РРЦ 3000); c2: 1600+900=2500 (РРЦ 3000); c4: 450 (РРЦ 500)
const sum = 2700 + 2500 + 450 + (cancelled ? 0 : 900);
assert.equal(st.sales.sum, sum);
assert.equal(st.sales.earn, (3000 - 2700) + (3000 - 2500) + (500 - 450) + (cancelled ? 0 : 100), 'заробіток = РРЦ − ціна партнера');
assert.equal(st.supplies.cnt, 2);
assert.equal(st.supplies.sum, 7700 + 450);
assert.equal(st.supplies.paid, 7700);
assert.equal(st.debt.due, 450, 'до оплати — рахунок без оплати');
assert.equal(st.stock.units, (5 + 2 + 1) - (3 + 2 + 1), 'залишок із закупівель');
const fan = st.products.find((p) => p.key === 11);
assert.equal(fan.units, 4);
assert.equal(fan.orders, 2);
assert.equal(fan.marginPct, 10);
const cats = Object.fromEntries(st.categories.map((x) => [x.name, x.units]));
assert.equal(cats['Вентилятори'], 4 + 1 + (cancelled ? 0 : 2));
assert.equal(cats['Обігрівачі'], 1);
assert.ok(st.brands.find((x) => x.name === 'TestBrand'));
assert.equal(st.series.length, 30);
assert.equal(st.series.at(-1).cnt, expCnt, 'сьогоднішні замовлення — в останньому дні');
assert.equal(st.weekdays.reduce((t, n) => t + n, 0), expCnt);
assert.equal(st.partners, undefined, 'партнер не бачить рейтингу інших');
assert.equal(st.salesPrev.cnt, 0);
// період без даних
assert.equal((await req('GET', '/api/b2b/p/stats?from=2020-01-01&to=2020-01-31', null, A)).sales.cnt, 0);
// ізоляція
const stB = await req('GET', '/api/b2b/p/stats', null, B);
assert.equal(stB.sales.cnt, 0);
assert.equal(stB.supplies.cnt, 1);
// адмін: усі партнери і один
const all = await req('GET', '/api/b2b/stats');
assert.equal(all.supplies.cnt, 3);
assert.deepEqual(all.partners.map((p) => p.name), ['Партнер А', 'Партнер Б']);
assert.equal((await req('GET', `/api/b2b/stats?partner=${pb.id}`)).supplies.cnt, 1);
assert.equal(await status(() => req('GET', '/api/b2b/stats', null, A)), 403);

console.log('OK — B2B: фільтри списків і аналітика продажів партнера');
