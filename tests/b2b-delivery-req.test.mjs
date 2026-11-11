// Зміна способу отримання закупівлі: партнер просить (після рахунку сам уже не змінює), менеджер підтверджує або відхиляє;
// до підтвердження закупівля лишається як була. Коментар у LP-CRM для самовивозу: без повторів, з № видаткової накладної.
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
const ea = await req('POST', '/api/b2b/p/entities', { name: 'ФОПСоник Вікторія', code: '1234567890' }, A);
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pb.id}/users`, { login: 'pb', password: 'pass1234' });
const B = await login('pb', 'pass1234');
const get = async (id, h = H) => (await req('GET', h === H ? `/api/b2b/orders/${id}` : `/api/b2b/p/orders/${id}`, null, h));
const R = (id) => `/api/b2b/p/orders/${id}/delivery-request`;

// ---------- 1. Запит партнера: перевірки ----------
const s1 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 11, qty: 2 }] }, A);
await req('PUT', `/api/b2b/orders/${s1.id}`, { invoice_no: '191', invoice_date: '2026-11-11', waybill_no: '' });
assert.equal((await get(s1.id)).order.status, 'pay_wait');
assert.equal(await status(() => req('PUT', `/api/b2b/p/orders/${s1.id}`, { entity_id: ea.id, items: [{ product_id: 11, qty: 2 }], delivery: 'pickup' }, A)), 400, 'після рахунку «Змінити» вже недоступне');
assert.match(await errOf(() => req('POST', R(s1.id), { delivery: 'np' }, A)), /вже встановлено/);
assert.match(await errOf(() => req('POST', R(s1.id), { delivery: 'xx' }, A)), /Оберіть спосіб/);
assert.match(await errOf(() => req('POST', R(s1.id), { delivery: 'pickup' }, A)), /вкажіть, хто забирає/);
assert.match(await errOf(() => req('POST', R(s1.id), { delivery: 'warehouse', ship_to: { name: 'Склад' } }, A)), /Склад партнера/);
assert.equal(await status(() => req('POST', R(s1.id), { delivery: 'pickup', pickup_by: { name: 'Чужий Партнер', phone: '0501112233' } }, B)), 404, 'чужа закупівля');

// ---------- 2. Запит збережено: закупівля не змінилась, адмінам — сповіщення, на головній — «потребує дій» ----------
tg.length = 0;
await req('POST', R(s1.id), { delivery: 'pickup', pickup_by: { name: 'Піць Іван', phone: '096 635 79 90' } }, A);
let d = await get(s1.id, A);
assert.equal(d.order.delivery, 'np', 'до підтвердження — як було');
assert.equal(d.order.pickup_by, null);
assert.equal(d.order.delivery_req.delivery, 'pickup');
assert.equal(d.order.delivery_req.pickup_by.name, 'Піць Іван');
assert.ok(d.history.some((x) => /запит на зміну способу отримання: «Самовивіз.*забирає Піць Іван, \+380966357990» — чекає підтвердження/.test(x.action)));
assert.ok(tg.some((m) => String(m.chat_id) === '100' && /Запит на зміну способу отримання/.test(m.text) && /Просить: <b>Самовивіз/.test(m.text)), 'адмінам');
assert.ok((await req('GET', '/api/b2b/orders')).rows.find((o) => o.id === s1.id).delivery_req, 'у списку — позначка');
const att = await req('GET', '/api/home');
assert.ok(JSON.stringify(att).includes('просять змінити спосіб отримання'), 'головна: потребує дій');

// ---------- 3. Відхилення з коментарем: нічого не змінилось, партнеру — сповіщення ----------
tg.length = 0;
assert.equal(await status(() => req('POST', `/api/b2b/orders/${s1.id}/delivery-request`, { ok: true }, A)), 403, 'партнер сам не підтверджує');
await req('POST', `/api/b2b/orders/${s1.id}/delivery-request`, { ok: false, note: 'Уже зібрано <на відправку>' });
d = await get(s1.id, A);
assert.equal(d.order.delivery, 'np');
assert.equal(d.order.delivery_req, null);
assert.ok(tg.some((m) => String(m.chat_id) === '200' && /відхилено — лишається «Відправка клієнтам/.test(m.text) && m.text.includes('💬 Уже зібрано &lt;на відправку&gt;')), 'партнеру — відмова з коментарем');
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${s1.id}/delivery-request`, { ok: true })), /Запиту .* немає/);

// ---------- 4. Відкликання партнером ----------
await req('POST', R(s1.id), { delivery: 'pickup', pickup_by: { name: 'Піць Іван', phone: '0966357990' } }, A);
await req('DELETE', R(s1.id), null, A);
assert.equal((await get(s1.id, A)).order.delivery_req, null);

// ---------- 5. Підтвердження: самовивіз набирає чинності разом із «хто забирає» ----------
await req('POST', R(s1.id), { delivery: 'pickup', pickup_by: { name: 'Піць Іван', phone: '0966357990' } }, A);
tg.length = 0;
await req('POST', `/api/b2b/orders/${s1.id}/delivery-request`, { ok: true });
d = await get(s1.id, A);
assert.equal(d.order.delivery, 'pickup');
assert.equal(d.order.pickup_by.phone, '380966357990');
assert.equal(d.order.delivery_req, null);
assert.ok(d.history.some((x) => /запит партнера підтверджено/.test(x.action)));
assert.ok(tg.some((m) => String(m.chat_id) === '200' && /зміну способу отримання підтверджено — тепер «Самовивіз/.test(m.text)), 'партнеру — підтвердження');

// ---------- 6. Із самовивозу на склад партнера; після оплати теж можна ----------
await req('POST', `/api/b2b/orders/${s1.id}/status`, { status: 'paid', note: 'оплата готівкою' });
await req('POST', R(s1.id), { delivery: 'warehouse', ship_to: { name: 'Петренко Склад', phone: '050 111 22 33', address: 'Київ, відділення № 25' } }, A);
await req('POST', `/api/b2b/orders/${s1.id}/delivery-request`, { ok: true });
d = await get(s1.id, A);
assert.equal(d.order.delivery, 'warehouse');
assert.deepEqual(d.order.ship_to, { name: 'Петренко Склад', phone: '0501112233', address: 'Київ, відділення № 25' });
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).warehouse.name, 'Петренко Склад', 'склад запам’ятався');
// менеджер змінив сам — запит партнера знімається
await req('POST', R(s1.id), { delivery: 'np' }, A);
await req('POST', `/api/b2b/orders/${s1.id}/delivery`, { delivery: 'pickup' });
d = await get(s1.id);
assert.equal(d.order.delivery, 'pickup');
assert.equal(d.order.delivery_req, null);

// ---------- 7. Є замовлення клієнтів → самовивіз і «на склад» не запросити; запит застарів — підтвердити не можна ----------
const s2 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 11, qty: 3 }] }, A);
await req('PUT', `/api/b2b/orders/${s2.id}`, { invoice_no: '192', invoice_date: '2026-11-11', waybill_no: '' });
await req('POST', R(s2.id), { delivery: 'pickup', pickup_by: { name: 'Піць Іван', phone: '0966357990' } }, A);
await db.run(`INSERT INTO b2b_orders (partner_id, kind, status, supply_id, total, created_at, updated_at) VALUES (?, 'client', 'new', ?, 0, '', '')`, [pa.id, s2.id]);
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${s2.id}/delivery-request`, { ok: true })), /вже є замовлення клієнтів/);
assert.equal((await get(s2.id)).order.delivery, 'np');
await req('POST', `/api/b2b/orders/${s2.id}/delivery-request`, { ok: false });
assert.match(await errOf(() => req('POST', R(s2.id), { delivery: 'warehouse', ship_to: { name: 'С', phone: '0501112233', address: 'Київ' } }, A)), /вже є замовлення клієнтів/);

// ---------- 8. Передано в LP-CRM → запит уже не подати; коментар для складу: без повторів, з № ВН ----------
await req('PUT', `/api/b2b/orders/${s1.id}`, { invoice_no: '191', invoice_date: '2026-11-11', waybill_no: '4965' });
await req('PUT', '/api/b2b/crm-settings', { on: true, office: '7' });
crm.length = 0;
await req('POST', `/api/b2b/orders/${s1.id}/crm`);
const cm = crm.find((x) => x.method === 'addNewOrder').p.comment;
assert.equal(cm.split('\n')[0], `B2B-${s1.id} · САМОВИВІЗ · партнер «Партнер А»`);
assert.equal(cm.split('\n')[1], 'Забирає: Піць Іван, +380966357990');
assert.match(cm.split('\n')[2], /^✅ ОПЛАЧЕНО — рахунок № 191 від 11\.11\.2026 на 1[\s ]800,00 грн · ВН № 4965$/);
assert.equal(cm.split('\n')[3], 'Платник: ФОП Соник Вікторія, ІПН 1234567890');
assert.equal(cm.split(`B2B-${s1.id}`).length, 2, 'номер закупівлі — один раз');
assert.equal(cm.split('191').length, 2, 'номер рахунку — один раз');
assert.match(await errOf(() => req('POST', R(s1.id), { delivery: 'np' }, A)), /вже передано в LP-CRM/);

console.log('OK — B2B: запит партнера на зміну способу отримання (підтвердження менеджера), коментар LP-CRM з № ВН');
