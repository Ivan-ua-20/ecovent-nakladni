// B2B етап 3: замовлення клієнтів партнера — залишок закупівлі, «без закупівлі», маркування, передача в LP-CRM
// (вимкнена за замовчуванням), ручне прив'язування номера, статус із CRM, оплата.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { phpSerialize, phpUrlencode, findNewOrderId } from '../src/integrations/lpcrm.js';

// ---------- формат товарів для addNewOrder ----------
assert.equal(phpSerialize([{ product_id: '12', price: '900', count: '2' }]), 'a:1:{i:0;a:3:{s:10:"product_id";s:2:"12";s:5:"price";s:3:"900";s:5:"count";s:1:"2";}}');
assert.equal(phpSerialize('Ї'), 's:2:"Ї";', 'довжина — у байтах UTF-8');
assert.equal(phpUrlencode('a:1:{ !}'), 'a%3A1%3A%7B+%21%7D');
assert.equal(findNewOrderId({ status: 'ok', data: [{ order_id: '17000', id: 555 }] }, '17000'), '555');
assert.equal(findNewOrderId({ data: { order_id: '17000' } }, '17000'), '', 'лише наш код — номера немає');

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'TestBrand', 'testbrand', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901)`, []],
]);
const tg = [];
const crm = []; // запити до LP-CRM: { method, params }
let addReply = { status: 'ok', data: [{ id: '55501' }] };
let crmStatus = '4';
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: {} })); }
  const method = url.match(/\/api\/(\w+)\.html/)[1];
  const p = Object.fromEntries(new URLSearchParams(opts.body));
  crm.push({ method, p });
  const json = (o) => new Response(JSON.stringify(o));
  if (method === 'getProduct') return json({ status: 'ok', data: p.product_id.split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '1000.00', 12: '500.00' }[id] })) });
  if (method === 'addNewOrder') return json(addReply);
  if (method === 'getOrdersByID') return json({ status: 'ok', data: p.order_id.split(',').map((id) => ({ order_id: id, status: crmStatus, products: [], bayer_name: 'x' })) });
  if (method === 'getStatuses') return json({ status: 'ok', data: { 1: { name: 'Новий' }, 4: { name: 'Відправлено' } } });
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
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('POST', `/api/b2b/partners/${pb.id}/users`, { login: 'pb', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('PUT', `/api/b2b/partners/${pb.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '100' WHERE login = 'owner'`);
await db.run(`UPDATE users SET tg_chat_id = '200' WHERE login = 'pa'`);
const A = await login('pa', 'pass1234');
const B = await login('pb', 'pass1234');
const ea = await req('POST', '/api/b2b/p/entities', { name: 'ФОП А', code: '1234567890' }, A);
const sup = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 11, qty: 5 }, { product_id: 12, qty: 2 }] }, A);

// ---------- 1. Залишок закупівлі ----------
let sups = await req('GET', '/api/b2b/p/supplies', null, A);
assert.equal(sups.length, 1);
assert.equal(sups[0].pay, 'unpaid');
assert.equal(sups[0].items.find((i) => i.product_id === 11).left, 5);
assert.equal((await req('GET', '/api/b2b/p/supplies', null, B)).length, 0, 'чужі закупівлі не видно');

const client = { client_name: '  Петренко  Олена ', client_phone: '050 111 22 33', ttn: '2045 0000 0000 01' };
assert.equal(await status(() => req('POST', '/api/b2b/p/clients', { ...client, client_phone: '123', supply_id: sup.id, items: [{ product_id: 11, qty: 1 }] }, A)), 400, 'телефон');
assert.equal(await status(() => req('POST', '/api/b2b/p/clients', { ...client, client_name: '', supply_id: sup.id, items: [{ product_id: 11, qty: 1 }] }, A)), 400, 'ПІБ');
assert.match(await errOf(() => req('POST', '/api/b2b/p/clients', { ...client, supply_id: sup.id, items: [{ product_id: 11, qty: 6 }] }, A)), /залишилось 5/);
assert.equal(await status(() => req('POST', '/api/b2b/p/clients', { ...client, supply_id: sup.id, items: [{ product_id: 11, qty: 1 }] }, B)), 404, 'чужа закупівля');

tg.length = 0;
const c1 = await req('POST', '/api/b2b/p/clients', { ...client, supply_id: sup.id, items: [{ product_id: 11, qty: 3 }], comment: 'Дзвонити після 18' }, A);
assert.equal(c1.total, 2700, 'ціна з закупівлі (900)');
assert.equal(tg.length, 1);
assert.match(tg[0].text, /Нове замовлення клієнта.*Петренко Олена.*Із закупівлі/s);
let d = await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A);
assert.equal(d.order.client_phone, '380501112233', 'телефон нормалізовано');
assert.equal(d.order.ttn, '20450000000001');
assert.equal(d.order.client_name, 'Петренко Олена');
assert.equal(d.order.pay, 'unpaid', 'закупівля не оплачена → замовлення неоплачене');
assert.equal(d.order.no_supply, false);
assert.equal(d.order.status, 'new');
sups = await req('GET', '/api/b2b/p/supplies', null, A);
assert.equal(sups[0].items.find((i) => i.product_id === 11).left, 2, 'залишок зменшився');
// зміна: власна кількість не враховується в залишку
await req('PUT', `/api/b2b/p/clients/${c1.id}`, { ...client, supply_id: sup.id, items: [{ product_id: 11, qty: 5 }] }, A);
assert.equal((await req('GET', '/api/b2b/p/supplies', null, A))[0].items.find((i) => i.product_id === 11).left, 0);
await req('PUT', `/api/b2b/p/clients/${c1.id}`, { ...client, supply_id: sup.id, items: [{ product_id: 11, qty: 3 }] }, A);
// закупівлю не можна зменшити нижче розписаного і скасувати, доки є замовлення клієнтів
assert.match(await errOf(() => req('PUT', `/api/b2b/p/orders/${sup.id}`, { entity_id: ea.id, items: [{ product_id: 11, qty: 2 }] }, A)), /розписано 3/);
assert.match(await errOf(() => req('POST', `/api/b2b/p/orders/${sup.id}/cancel`, {}, A)), /спершу скасуйте/);
const supD = await req('GET', `/api/b2b/orders/${sup.id}`);
assert.equal(supD.clients.length, 1, 'у закупівлі видно замовлення клієнтів');
assert.equal(supD.left.find((r) => r.product_id === 11).left, 2);
assert.equal(await status(() => req('GET', `/api/b2b/p/orders/${c1.id}`, null, A)), 404, 'замовлення клієнта — не в закупівлях');

// ---------- 2. Без закупівлі ----------
tg.length = 0;
const c2 = await req('POST', '/api/b2b/p/clients', { ...client, client_name: 'Без закупівлі', items: [{ product_id: 12, qty: 1 }] }, A);
assert.equal(c2.total, 450, 'ціна з каталогу');
assert.match(tg[0].text, /Без закупівлі/);
let list = await req('GET', '/api/b2b/clients?view=nosupply');
assert.deepEqual(list.rows.map((r) => r.id), [c2.id]);
assert.equal(list.rows[0].no_supply, true);
assert.equal(list.counts.nosupply, 1);
assert.equal(list.crm, false, 'передача в CRM вимкнена за замовчуванням');

// ---------- 3. Маркування від партнера ----------
const up = await mk().request(`/api/b2b/p/clients/${c1.id}/files`, { method: 'POST', headers: { Cookie: A.Cookie, 'Content-Type': 'application/pdf', 'X-File-Name': 'label.pdf' }, body: new Uint8Array([1, 2, 3]) });
assert.equal(up.status, 200);
const fid = (await up.json()).id;
assert.equal((await db.get(`SELECT kind FROM b2b_files WHERE id = ?`, [fid])).kind, 'label');
assert.equal((await mk().request(`/api/b2b/p/clients/${c1.id}/files`, { method: 'POST', headers: { Cookie: B.Cookie }, body: new Uint8Array([1]) })).status, 404, 'чуже замовлення');
assert.equal((await mk().request(`/api/b2b/files/${fid}`, { headers: H })).status, 200, 'адмін бачить маркування');

// ---------- 4. «Додати в CRM» вимкнено → ручний номер ----------
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${c2.id}/crm`)), /ще не ввімкнено/);
assert.equal(await status(() => req('POST', `/api/b2b/clients/${c2.id}/crm`, {}, A)), 403, 'партнер не додає в CRM');
assert.equal(await status(() => req('PUT', `/api/b2b/clients/${c2.id}`, { crm_id: '12a' })), 400);
tg.length = 0;
await req('PUT', `/api/b2b/clients/${c2.id}`, { crm_id: '77001' });
d = await req('GET', `/api/b2b/p/clients/${c2.id}`, null, A);
assert.equal(d.order.status, 'crm');
assert.equal(d.order.crm_id, '77001');
assert.equal(d.order.crm_status, 'Відправлено', 'статус підтягнуто з CRM');
assert.ok(tg.some((m) => m.chat_id === '200' && /77001/.test(m.text)), 'партнеру — що замовлення в роботі');
assert.equal(await status(() => req('PUT', `/api/b2b/p/clients/${c2.id}`, { ...client, items: [{ product_id: 12, qty: 2 }] }, A)), 400, 'після передачі партнер не змінює');
assert.equal(await status(() => req('POST', `/api/b2b/p/clients/${c2.id}/cancel`, {}, A)), 400);

// статус оновлюється не частіше ніж раз на 10 хв
crmStatus = '1';
crm.length = 0;
await req('GET', '/api/b2b/p/clients', null, A);
assert.equal(crm.filter((x) => x.method === 'getOrdersByID').length, 0, 'щойно перевіряли — без запиту до CRM');
await db.run(`UPDATE b2b_orders SET crm_checked_at = '2020-01-01T00:00:00Z' WHERE id = ?`, [c2.id]);
const rows = (await req('GET', '/api/b2b/p/clients', null, A)).rows;
assert.equal(rows.find((r) => r.id === c2.id).crm_status, 'Новий');
assert.equal(crm.filter((x) => x.method === 'getOrdersByID').length, 1, 'одним запитом');

// ---------- 5. Оплата: без закупівлі — вручну, із закупівлі — за закупівлею ----------
await req('PUT', `/api/b2b/orders/${c2.id}`, { invoice_no: 'СФ-9', waybill_no: 'РН-9' });
assert.equal((await req('GET', `/api/b2b/orders/${c2.id}`)).order.status, 'crm', 'рахунок не змінює статус замовлення клієнта');
await req('POST', `/api/b2b/clients/${c2.id}/paid`, { paid: true });
assert.equal((await req('GET', `/api/b2b/p/clients/${c2.id}`, null, A)).order.pay, 'paid');
assert.equal(await status(() => req('POST', `/api/b2b/clients/${c1.id}/paid`, { paid: true })), 400, 'оплата — за закупівлею');
assert.equal(await status(() => req('POST', `/api/b2b/orders/${c1.id}/status`, { status: 'paid' })), 400);
await req('PUT', `/api/b2b/orders/${sup.id}`, { invoice_no: 'СФ-1' });
await req('POST', `/api/b2b/orders/${sup.id}/status`, { status: 'paid' });
assert.equal((await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A)).order.pay, 'paid', 'закупівлю оплачено → і замовлення');

// ---------- 6. Передача в LP-CRM (коли буде дозвіл) ----------
assert.equal(await status(() => req('PUT', '/api/b2b/crm-settings', { on: true, office: '' })), 400, 'без ID відділу не вмикається');
await req('PUT', '/api/b2b/crm-settings', { on: true, office: '7' });
assert.deepEqual(await req('GET', '/api/b2b/crm-settings'), { on: true, office: '7', ready: true });
// відмова CRM (немає дозволу) → замовлення лишається «Нове», можна повторити
addReply = { status: 'error', message: 'Access denied for method addNewOrder' };
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${c1.id}/crm`)), /Access denied/);
d = await req('GET', `/api/b2b/orders/${c1.id}`);
assert.equal(d.order.status, 'new');
assert.equal(d.order.crm_sent_at, '');
addReply = { status: 'ok', data: [{ id: '55501' }] };
crmStatus = '4';
crm.length = 0;
tg.length = 0;
const sent = await req('POST', `/api/b2b/clients/${c1.id}/crm`);
assert.equal(sent.crm_id, '55501');
const add = crm.find((x) => x.method === 'addNewOrder').p;
assert.equal(add.office, '7', 'відділ B2B');
assert.equal(add.country, 'UA');
assert.equal(add.bayer_name, 'Петренко Олена');
assert.equal(add.phone, '380501112233');
assert.ok(/^\d{14}$/.test(add.order_id), 'код замовлення — число');
assert.equal(decodeURIComponent(add.products.replace(/\+/g, ' ')), 'a:1:{i:0;a:3:{s:10:"product_id";s:2:"11";s:5:"price";s:3:"900";s:5:"count";s:1:"3";}}', 'ціни партнера');
assert.match(add.comment, new RegExp(`B2B-${c1.id}.*Партнер А.*ТТН партнера: 20450000000001.*Закупівля B2B-${sup.id}`, 's'));
assert.doesNotMatch(add.comment, /НЕ ОПЛАЧЕНА/, 'закупівля вже оплачена');
assert.ok(!('additional_1' in add), '«Поле 1» не заповнюємо');
d = await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A);
assert.equal(d.order.status, 'crm');
assert.equal(d.order.crm_id, '55501');
assert.equal(d.order.crm_status, 'Відправлено');
assert.ok(tg.some((m) => m.chat_id === '200' && /передано в роботу/.test(m.text)));
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${c1.id}/crm`)), /Уже в CRM/, 'повторно не надсилається');

// неоплачена закупівля → позначка в коментарі CRM; CRM не повернула номер → вписують вручну
const sup2 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 12, qty: 4 }] }, A);
const c3 = await req('POST', '/api/b2b/p/clients', { ...client, supply_id: sup2.id, items: [{ product_id: 12, qty: 1 }] }, A);
addReply = { status: 'ok', data: [{ status: 'ok' }] };
crm.length = 0;
assert.equal((await req('POST', `/api/b2b/clients/${c3.id}/crm`)).crm_id, '');
assert.match(crm.find((x) => x.method === 'addNewOrder').p.comment, /НЕ ОПЛАЧЕНА/);
d = await req('GET', `/api/b2b/orders/${c3.id}`);
assert.equal(d.order.status, 'crm');
assert.equal(d.order.crm_id, '');
await req('PUT', `/api/b2b/clients/${c3.id}`, { crm_id: '55600' });
assert.equal((await req('GET', `/api/b2b/orders/${c3.id}`)).order.crm_id, '55600');

// ---------- 7. Скасування повертає залишок ----------
await req('POST', `/api/b2b/clients/${c1.id}/cancel`);
assert.equal((await req('GET', '/api/b2b/p/supplies', null, A)).find((s) => s.id === sup.id).items.find((i) => i.product_id === 11).left, 5);
const c4 = await req('POST', '/api/b2b/p/clients', { ...client, supply_id: sup.id, items: [{ product_id: 12, qty: 1 }] }, A);
await req('POST', `/api/b2b/p/clients/${c4.id}/cancel`, {}, A);
assert.equal((await req('GET', `/api/b2b/p/clients/${c4.id}`, null, A)).order.status, 'cancelled');
assert.equal(await status(() => req('GET', '/api/b2b/clients', null, A)), 403, 'список адміна — не для партнера');

console.log('OK — B2B: замовлення клієнтів, залишок закупівлі, маркування, LP-CRM (вимкнено / вручну / addNewOrder), оплата');
