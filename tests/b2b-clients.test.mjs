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
// LP-CRM: addNewOrder повертає наш код; getOrdersByID шукає за кодом (order_id) і віддає номер (id).
let addReply = null; // null — успіх як у документації
let nextCrmId = 55501;
const crmOrders = new Map([['17614000000012345', 77001]]); // код → номер (замовлення, створене вручну)
let crmStatus = '4';
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: {} })); }
  const method = url.match(/\/api\/(\w+)\.html/)[1];
  const p = Object.fromEntries(new URLSearchParams(opts.body));
  crm.push({ method, p });
  const json = (o) => new Response(JSON.stringify(o));
  if (method === 'getProduct') return json({ status: 'ok', data: p.product_id.split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '1000.00', 12: '500.00' }[id] })) });
  if (method === 'addNewOrder') {
    if (addReply) return json(addReply);
    crmOrders.set(p.order_id, nextCrmId++);
    return json({ status: 'ok', data: { order_id: p.order_id, country: 'UA', site: '', ip: '' }, message: 'Замовлення успішно додане' });
  }
  if (method === 'getOrdersByID') return json({ status: 'ok', data: p.order_id.split(',').filter((c) => crmOrders.has(c)).map((c) => ({ order_id: c, id: String(crmOrders.get(c)), status: crmStatus, products: [], bayer_name: 'x' })) });
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

// номер → код для ручного прив'язування — з аналітики
await db.run(`INSERT INTO an_orders (id, code, day, status) VALUES (77001, '17614000000012345', '2026-10-22', 4)`);
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
const c2 = await req('POST', '/api/b2b/p/clients', { ...client, ttn: '', client_name: 'Без закупівлі', items: [{ product_id: 12, qty: 1 }] }, A);
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
assert.equal(d.order.crm_status, 'Відправлено', 'статус підтягнуто з CRM (номер → код через аналітику)');
assert.equal(d.order.crm_ext, '17614000000012345');
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
// без закупівлі → відкрита закупівля: оплата — лише після того, як партнер сформує на неї рахунок
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${c2.id}/paid`, { paid: true })), /спершу партнер формує/);
const openId = (await req('GET', `/api/b2b/p/clients/${c2.id}`, null, A)).order.supply_id;
assert.equal((await req('GET', `/api/b2b/p/clients/${c2.id}`, null, A)).order.pay_name, 'В процесі оплати');
await req('POST', '/api/b2b/p/open/form', { entity_id: ea.id }, A);
await req('PUT', `/api/b2b/orders/${openId}`, { invoice_no: 'СФ-9' });
await req('POST', `/api/b2b/orders/${openId}/status`, { status: 'paid' });
assert.equal((await req('GET', `/api/b2b/p/clients/${c2.id}`, null, A)).order.pay, 'paid');
assert.equal(await status(() => req('POST', `/api/b2b/clients/${c1.id}/paid`, { paid: true })), 400, 'оплата — за закупівлею');
assert.equal(await status(() => req('POST', `/api/b2b/orders/${c1.id}/status`, { status: 'paid' })), 400);
await req('PUT', `/api/b2b/orders/${sup.id}`, { invoice_no: 'СФ-1' });
await req('POST', `/api/b2b/orders/${sup.id}/status`, { status: 'paid' });
assert.equal((await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A)).order.pay, 'paid', 'закупівлю оплачено → і замовлення');

// ---------- 6. Передача в LP-CRM (коли буде дозвіл) ----------
assert.equal(await status(() => req('PUT', '/api/b2b/crm-settings', { on: true, office: '' })), 400, 'без ID відділу не вмикається');
assert.equal((await req('GET', '/api/b2b/crm-settings')).office, '27', 'відділ B2B за замовчуванням');
await req('PUT', '/api/b2b/crm-settings', { on: true, office: '7', in_key: 'abcdef0123456789abcdef0123456789', delivery: '3', ttn_field: 'additional_2' });
const cfg = await req('GET', '/api/b2b/crm-settings');
assert.equal(cfg.in_key, '••••••', 'вхідний ключ не показується');
assert.equal((await req('GET', '/api/bootstrap')).settings.lpcrm_in_key, '••••••', 'і в загальних налаштуваннях — маска');
await req('PUT', '/api/b2b/crm-settings', { ...cfg, on: true, office: '7' }); // маска не перезаписує ключ
assert.equal((await db.get(`SELECT value FROM settings WHERE key = 'lpcrm_in_key'`)).value, 'abcdef0123456789abcdef0123456789');
// відмова CRM (немає дозволу) → замовлення лишається «Нове», можна повторити
addReply = { status: 'error', message: 'Access denied for method addNewOrder' };
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${c1.id}/crm`)), /Access denied/);
d = await req('GET', `/api/b2b/orders/${c1.id}`);
assert.equal(d.order.status, 'new');
assert.equal(d.order.crm_sent_at, '');
addReply = null;
crmStatus = '4';
crm.length = 0;
tg.length = 0;
const sent = await req('POST', `/api/b2b/clients/${c1.id}/crm`);
assert.equal(sent.crm_id, '55501');
const add = crm.find((x) => x.method === 'addNewOrder').p;
assert.equal(add.office, '7', 'відділ B2B');
assert.equal(add.key, 'abcdef0123456789abcdef0123456789', 'вхідний ключ для addNewOrder');
assert.equal(crm.find((x) => x.method === 'getOrdersByID').p.key, 'k', 'статуси — основним ключем');
assert.equal(add.delivery, '3');
assert.match(decodeURIComponent(add.sender.replace(/\+/g, ' ')), /s:9:"HTTP_HOST";s:\d+:"[^"]+"/, 'сайт-джерело (sender) для LP-CRM');
assert.equal(add.additional_2, '20450000000001', 'ТТН у вибране поле');
assert.equal(add.country, 'UA');
assert.equal(add.bayer_name, 'Петренко Олена');
assert.equal(add.phone, '380501112233');
assert.ok(/^\d{16}$/.test(add.order_id), 'код замовлення — як у прикладі LP-CRM');
assert.equal(decodeURIComponent(add.products.replace(/\+/g, ' ')), 'a:1:{i:0;a:3:{s:10:"product_id";s:2:"11";s:5:"price";s:3:"900";s:5:"count";s:1:"3";}}', 'ціни партнера');
assert.match(add.comment, new RegExp(`B2B-${c1.id}.*Партнер А.*ТТН партнера: 20450000000001.*✅ ОПЛАЧЕНО: закупівля B2B-${sup.id}, .*Позначено «Оплачено» вручну`, 's'));
assert.doesNotMatch(add.comment, /ОЧІКУЄМО ОПЛАТУ/, 'закупівля вже оплачена');
assert.equal(add.payment, '1', 'вид оплати «Оплачено»');
assert.equal(add.delivery_adress, '20450000000001', 'ТТН — у поле адреси доставки');
assert.ok(!('ttn' in add));
assert.ok(!('additional_1' in add), '«Поле 1» не заповнюємо');
d = await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A);
assert.equal(d.order.status, 'crm');
assert.equal(d.order.crm_id, '55501');
assert.equal(d.order.crm_status, 'Відправлено');
assert.ok(tg.some((m) => m.chat_id === '200' && /передано в роботу/.test(m.text)));
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${c1.id}/crm`)), /Уже в CRM/, 'повторно не надсилається');

// неоплачена закупівля → позначка в коментарі CRM; CRM не повернула номер → вписують вручну
const sup2 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 12, qty: 4 }] }, A);
const c3 = await req('POST', '/api/b2b/p/clients', { ...client, ttn: '20450000000003', supply_id: sup2.id, items: [{ product_id: 12, qty: 1 }] }, A);
// CRM прийняла, але замовлення ще не знаходиться за кодом → номер підтягнеться пізніше
addReply = { status: 'ok', data: { order_id: 'x' } };
crm.length = 0;
const s3 = await req('POST', `/api/b2b/clients/${c3.id}/crm`);
assert.equal(s3.crm_id, '');
const add3 = crm.find((x) => x.method === 'addNewOrder').p;
assert.match(add3.comment, new RegExp(`⏳ ОЧІКУЄМО ОПЛАТУ: закупівля B2B-${sup2.id}, рахунок ще не виставлено.*рахунок на ФОП А, ІПН 1234567890, від «Партнер А»`, 's'));
assert.ok(!('payment' in add3), 'неоплачена — без виду оплати');
d = await req('GET', `/api/b2b/orders/${c3.id}`);
assert.equal(d.order.status, 'crm');
assert.equal(d.order.crm_ext, s3.code);
crmOrders.set(s3.code, 55600);
await db.run(`UPDATE b2b_orders SET crm_checked_at = '' WHERE id = ?`, [c3.id]);
assert.equal((await req('GET', `/api/b2b/p/clients`, null, A)).rows.find((r) => r.id === c3.id).crm_id, '55600', 'номер з’явився при оновленні статусу');
// ручне прив'язування кодом
await req('PUT', `/api/b2b/clients/${c3.id}`, { crm_id: '17614000000012345' });
assert.equal((await req('GET', `/api/b2b/orders/${c3.id}`)).order.crm_id, '77001', 'код → номер');
// оплата прийшла вже після передачі в CRM → адмінам номер у CRM і готовий коментар
tg.length = 0;
await req('PUT', `/api/b2b/orders/${sup2.id}`, { invoice_no: 'СФ-77', invoice_date: '2026-10-25' });
await req('POST', `/api/b2b/orders/${sup2.id}/status`, { status: 'paid' });
const late = tg.find((m) => /Оплату отримано<\/b>, а замовлення вже в LP-CRM/.test(m.text));
assert.ok(late && String(late.chat_id) === '100', 'адмінам особисто');
assert.match(late.text, new RegExp(`B2B-${c3.id}.*CRM № <b>77001.*✅ ОПЛАЧЕНО: закупівля B2B-${sup2.id}, рахунок № СФ-77 від 25.10.2026`, 's'));

// ---------- 7. Скасування повертає залишок ----------
await req('POST', `/api/b2b/clients/${c1.id}/cancel`);
assert.equal((await req('GET', '/api/b2b/p/supplies', null, A)).find((s) => s.id === sup.id).items.find((i) => i.product_id === 11).left, 5);
const c4 = await req('POST', '/api/b2b/p/clients', { ...client, supply_id: sup.id, items: [{ product_id: 12, qty: 1 }] }, A);
await req('POST', `/api/b2b/p/clients/${c4.id}/cancel`, {}, A);
assert.equal((await req('GET', `/api/b2b/p/clients/${c4.id}`, null, A)).order.status, 'cancelled');
assert.equal(await status(() => req('GET', '/api/b2b/clients', null, A)), 403, 'список адміна — не для партнера');

console.log('OK — B2B: замовлення клієнтів, залишок закупівлі, маркування, LP-CRM (вимкнено / вручну / addNewOrder), оплата');
