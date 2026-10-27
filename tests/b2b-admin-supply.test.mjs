// Закупівля від нас: адмін створює для партнера (бренди й маржа партнера, оплата, отримання), партнер отримує сповіщення
// й підтверджує (обирає юрособу) або відхиляє; «на склад партнера» — одним замовленням у LP-CRM.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'TestBrand', 'testbrand', 98), (902, 'Other', 'other', 99)`, []],
  [`INSERT INTO b2b_catalog (product_id, name, article, rrp, brand_id) VALUES (11, 'Fan', 'F-1', 1000, 901), (12, 'Fan 2', '', 500, 901), (13, 'Чужий', '', 300, 902)`, []],
]);
const tg = [];
const crm = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  const method = url.match(/\/api\/(\w+)\.html/)[1];
  const p = Object.fromEntries(new URLSearchParams(opts.body));
  crm.push({ method, p });
  const json = (o) => new Response(JSON.stringify(o));
  if (method === 'addNewOrder') return json({ status: 'ok', data: { order_id: p.order_id }, message: 'ok' });
  if (method === 'getOrdersByID') return json({ status: 'ok', data: p.order_id.split(',').map((c) => ({ order_id: c, id: '99001', status: '1', products: [], bayer_name: 'x' })) });
  return json({ status: 'ok', data: [] });
};
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Адмін' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await db.run(`UPDATE b2b_partners SET tg_group = '-100500' WHERE id = ?`, [pa.id]);
await db.run(`UPDATE users SET tg_chat_id = '200' WHERE login = 'pa'`);
await db.run(`UPDATE users SET tg_chat_id = '100' WHERE login = 'owner'`);
const A = await login('pa', 'pass1234');

// ---------- 1. Варіанти для форми: лише бренди партнера, ціни за його маржею ----------
const opt = await req('GET', `/api/b2b/partners/${pa.id}/supply-options`);
assert.deepEqual(opt.brands.map((b) => [b.name, b.margin]), [['TestBrand', 10]]);
assert.deepEqual(opt.products.map((p) => [p.product_id, p.price]), [[11, 900], [12, 450]], 'ціна партнера = РРЦ − маржа; чужий бренд не показується');
assert.equal(opt.partner.entities, 0);

// ---------- 2. Створення: перевірки, статус, сповіщення ----------
assert.equal(await status(() => req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 13, qty: 1 }] })), 400, 'товар бренду, не відкритого партнеру, — ні');
assert.match(await errOf(() => req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 11, qty: 1 }], pay_terms: 'postpay', pay_days: 0 })), /Відстрочка/);
assert.match(await errOf(() => req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 11, qty: 1 }], delivery: 'warehouse', ship_to: { name: 'Склад' } })), /Склад партнера/);
tg.length = 0;
const o = await req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 1 }], pay_terms: 'postpay', pay_days: 14,
  delivery: 'warehouse', ship_to: { name: 'Петренко Склад', phone: '050 111 22 33', address: 'Київ, відділення № 25' }, comment: 'Акція' });
assert.equal(o.total, 2250);
let d = await req('GET', `/api/b2b/orders/${o.id}`);
assert.equal(d.order.status, 'confirm');
assert.equal(d.order.pay_terms, 'postpay');
assert.equal(d.order.pay_days, 14, 'відстрочка задана вручну, хоча партнеру її не відкрито');
assert.deepEqual(d.order.ship_to, { name: 'Петренко Склад', phone: '0501112233', address: 'Київ, відділення № 25' });
assert.ok(tg.some((m) => String(m.chat_id) === '200' && m.text.includes('Підтвердіть')), 'партнеру особисто');
assert.ok(tg.some((m) => String(m.chat_id) === '-100500' && m.text.includes('НА СКЛАД ПАРТНЕРА')), 'і в групу партнера');
assert.equal((await db.get(`SELECT wh_address FROM b2b_partners WHERE id = ?`, [pa.id])).wh_address, 'Київ, відділення № 25', 'склад запам’ятовується');
assert.equal((await req('GET', `/api/b2b/partners/${pa.id}/supply-options`)).partner.warehouse.name, 'Петренко Склад');

// ---------- 3. Партнер: бачить, не може змінити, не передається в CRM до підтвердження ----------
const pl = await req('GET', '/api/b2b/p/orders', null, A);
assert.equal(pl.rows[0].status, 'confirm');
assert.equal(await status(() => req('PUT', `/api/b2b/p/orders/${o.id}`, { items: [{ product_id: 11, qty: 1 }] }, A)), 400, 'партнер не змінює — лише підтверджує або відхиляє');
await req('PUT', '/api/b2b/crm-settings', { on: true, office: '7' });
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${o.id}/crm`)), /не підтвердив/);
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).unpaid.total, 0, 'непідтверджена не рахується в неоплачені');
assert.match(await errOf(() => req('POST', `/api/b2b/p/orders/${o.id}/confirm`, { entity_id: 999 }, A)), /Юрособу/);

// ---------- 4. Підтвердження: юрособа → «Очікує рахунок» ----------
const ea = await req('POST', '/api/b2b/p/entities', { name: 'ФОП А', code: '1234567890' }, A);
tg.length = 0;
await req('POST', `/api/b2b/p/orders/${o.id}/confirm`, { entity_id: ea.id }, A);
d = await req('GET', `/api/b2b/orders/${o.id}`);
assert.equal(d.order.status, 'invoice_wait');
assert.ok(d.order.entity.startsWith('ФОП А'));
assert.ok(tg.some((m) => String(m.chat_id) === '100' && m.text.includes('Партнер підтвердив')), 'адмінам — про підтвердження');
assert.equal(await status(() => req('POST', `/api/b2b/p/orders/${o.id}/confirm`, { entity_id: ea.id }, A)), 400, 'двічі — ні');
// з такої закупівлі замовлення клієнтів не оформлюються
assert.equal((await req('GET', '/api/b2b/p/supplies', null, A)).length, 0);

// ---------- 5. LP-CRM: одне замовлення на склад партнера, ціни партнера ----------
crm.length = 0;
const cr = await req('POST', `/api/b2b/orders/${o.id}/crm`);
assert.equal(cr.crm_id, '99001');
const add = crm.find((x) => x.method === 'addNewOrder').p;
assert.equal(add.bayer_name, 'Петренко Склад');
assert.equal(add.phone, '0501112233');
assert.equal(add.delivery_adress, 'Київ, відділення № 25');
assert.equal(add.office, '7');
assert.ok(add.comment.includes(`B2B-${o.id}`) && add.comment.includes('склад партнера'));
assert.ok(decodeURIComponent(add.products.replace(/\+/g, ' ')).includes('s:5:"price";s:3:"900"'), 'ціна партнера');
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${o.id}/crm`)), /Уже в LP-CRM/);
assert.equal(await status(() => req('POST', `/api/b2b/orders/${o.id}/delivery`, { delivery: 'np' })), 400, 'після передачі в CRM спосіб отримання не змінюється');

// ---------- 6. Відхилення партнером ----------
const o2 = await req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 12, qty: 3 }], delivery: 'np' });
assert.equal(await status(() => req('POST', `/api/b2b/orders/${o2.id}/crm`)), 400, 'звичайна закупівля одним замовленням у CRM не йде');
tg.length = 0;
await req('POST', `/api/b2b/p/orders/${o2.id}/cancel`, { reason: 'Не зараз' }, A);
assert.equal((await req('GET', `/api/b2b/orders/${o2.id}`)).order.status, 'cancelled');
assert.ok(tg.some((m) => m.text.includes('відхилив') && m.text.includes('Не зараз')));

// ---------- 7. Права ----------
assert.equal(await status(() => req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 11, qty: 1 }] }, A)), 403, 'партнер не створює «від нас»');
assert.equal(await status(() => req('GET', `/api/b2b/partners/${pa.id}/supply-options`, null, A)), 403);

console.log('OK — закупівля від нас: створення, підтвердження партнером, на склад партнера в LP-CRM');
