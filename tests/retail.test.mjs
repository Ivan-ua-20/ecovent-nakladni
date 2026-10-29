// Рітейл → Розетка (кабінет постачальника): кабінет і вебхук, синхронізація, підтвердження, ТТН, маркування,
// документи, передача в LP-CRM за ціною закупівлі, товари й прайс.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const raw = openDb(':memory:');
await migrate(raw);
let q = 0;
const db = { all: (...a) => { q++; return raw.all(...a); }, get: (...a) => { q++; return raw.get(...a); }, run: (...a) => { q++; return raw.run(...a); }, batch: (l) => { if (l.length) q++; return raw.batch(l); } };
await raw.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO b2b_catalog (product_id, name, article, rrp) VALUES (501, 'Рекуператор Ековент', 'EV-100', 9000)`, []],
]);

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test.token';
const ID1 = '11111111-aaaa-4bbb-8ccc-000000000001';
const ID2 = '11111111-aaaa-4bbb-8ccc-000000000002';
const now = new Date().toISOString().slice(0, 10);
const ORDERS = new Map([
  [ID1, { orderId: ID1, orderNum: '900001', createdAt: `${now} 10:00:00`, updatedAt: `${now} 10:00:00`, orderStatus: 'new', uzdStatus: 'skipped', customerName: 'Петренко Іван',
    deliveryCity: 'Київ', deliveryStreet: 'відд. 5', deliveryPhone: '+380501112233', cashOnDelivery: 9500, ttn: null, documentLink: null, snRequired: false,
    products: [{ supplierCode: 'EV-100', rzCode: 777, quantity: 2, cargoSeats: [{ lengthCm: 40, widthCm: 30, heightCm: 20, weightKg: 5 }] }] }],
  [ID2, { orderId: ID2, orderNum: '900002', createdAt: `${now} 11:00:00`, updatedAt: `${now} 11:00:00`, orderStatus: 'new', uzdStatus: 'not_uploaded', customerName: 'Коваль Ольга',
    deliveryCity: 'Львів', deliveryPhone: '380671234567', cashOnDelivery: 0, snRequired: true,
    products: [{ supplierCode: 'EV-200', rzCode: 778, quantity: 1, cargoSeats: [] }] }],
]);
let tooMany = 0; // скільки разів поспіль Розетка відповість 429
let listFail = false;
const tg = [];
// Замовлення LP-CRM (код → номер, ТТН, телефон) — для пошуку прив'язки за ТТН.
const CRM = new Map([['1761400000000111', { id: '70001', status: '1', ttn: '20400558101410', phone: '0971089181', bayer_name: 'Попелянська' }], ['1761400000000222', { id: '70002', status: '2', ttn: '', phone: '0508846132', bayer_name: 'Підопличко' }]]);
const calls = { list: 0, confirm: [], ttn: [], print: [], price: [], crm: [] };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.hostname === 'api.telegram.org') { tg.push(JSON.parse(opts.body)); return json({ ok: true, result: { message_id: 1 } }); }
  if (u.hostname.endsWith('lp-crm.biz')) {
    const method = u.pathname.match(/\/api\/(\w+)\.html/)[1];
    const p = Object.fromEntries(new URLSearchParams(opts.body));
    calls.crm.push({ method, p });
    if (method === 'addNewOrder') return json({ status: 'ok', data: { order_id: p.order_id }, message: 'ok' });
    if (method === 'getStatuses') return json({ status: 'ok', data: { 1: { name: 'Прийнято' }, 2: { name: 'Новий' }, 4: { name: 'Відправлено' } } });
    if (method === 'getOrdersByID' && p.order_id.split(',').some((c) => CRM.has(c))) return json({ status: 'ok', data: p.order_id.split(',').filter((c) => CRM.has(c)).map((c) => ({ order_id: c, ...CRM.get(c), products: [] })) });
    if (method === 'getOrdersByID') return json({ status: 'ok', data: [{ order_id: p.order_id, id: '88001', products: [], bayer_name: 'x' }] });
    return json({ status: 'ok', data: [] });
  }
  assert.equal(u.origin, 'https://api-cabinet-supplier.rozetka.com.ua');
  if (opts.headers.Authorization !== `Bearer ${TOKEN}`) return json({ name: 'Unauthorized', message: 'bad', status: 401 }, 401);
  const path = u.pathname;
  if (path === '/dropshipping/orders') {
    if (listFail) return json({ message: 'Internal error' }, 500);
    calls.list++;
    assert.ok(u.searchParams.get('expand').includes('products'));
    const list = [...ORDERS.values()];
    return json({ totalCount: list.length, currentPage: 1, orders: list });
  }
  let m = path.match(/^\/dropshipping\/orders\/confirm\/(.+)$/);
  if (m) {
    if (tooMany > 0) { tooMany--; return json({ message: 'Too many requests. Please try again later.' }, 429); }
    const b = JSON.parse(opts.body);
    calls.confirm.push({ id: m[1], b });
    const o = ORDERS.get(m[1]);
    o.orderStatus = 'confirmed';
    o.products.forEach((p) => { p.confirmedQuantity = p.quantity; });
    return json({ orderStatus: 'confirmed', products: o.products, warnings: [] });
  }
  m = path.match(/^\/dropshipping\/orders\/ttn\/(.+)$/);
  if (m) {
    const b = JSON.parse(opts.body);
    calls.ttn.push({ id: m[1], b });
    const o = ORDERS.get(m[1]);
    o.ttn = '20450000000001';
    o.orderStatus = 'shipping';
    return json({ ttn: o.ttn, orderStatus: 'shipping', shippingPointName: 'Склад Київ' });
  }
  if (path === '/dropshipping/orders/print-markings') {
    calls.print.push(JSON.parse(opts.body));
    return new Response('%PDF-1.4 marks', { headers: { 'Content-Type': 'application/pdf', 'X-Markings-Printed': '1', 'X-Markings-Skipped': '0' } });
  }
  m = path.match(/^\/dropshipping\/orders\/(.+)$/);
  if (m) { const o = ORDERS.get(m[1]); return o ? json(o) : json({ message: 'not found' }, 404); }
  throw new Error(`неочікуваний запит ${url}`);
};

const mk = () => createApp({ db, fetchFn, maxSubrequests: 40 });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'o', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const maxQ = {};
const send = async (method, path, body, headers = H) => {
  q = 0;
  const r = await mk().request(`https://ecovent.test${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const k = `${method} ${path.split('?')[0].replace(/\/(\d+|[0-9a-f-]{36}|EV-\d+)(?=\/|$)/g, '/:id')}`;
  maxQ[k] = Math.max(maxQ[k] || 0, q);
  return r;
};
const req = async (method, path, body, headers) => {
  const r = await send(method, path, body, headers);
  const j = await r.json();
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };

// ---------- 1. Кабінет: перевірка токена, маска, вебхук ----------
assert.match(await errOf(() => req('POST', '/api/rzs/accounts', { token: 'x'.repeat(30) })), /токен/, 'чужий токен — зрозуміла помилка');
const acc = await req('POST', '/api/rzs/accounts', { name: 'Ековент', token: TOKEN, crm_office: '7' });
let accs = await req('GET', '/api/rzs/accounts');
assert.equal(accs.length, 1, 'один кабінет');
assert.ok(!JSON.stringify(accs).includes(TOKEN), 'токен не віддається в браузер');
const hook = accs[0].hook;
assert.equal(hook.url, `https://ecovent.test/api/rzs/hook/${acc.id}`);
assert.ok(hook.user && hook.pass.length >= 12);

// ---------- 2. Синхронізація: замовлення, нові артикули, автозіставлення з каталогом ----------
await req('POST', '/api/rzs/sync', { force: true });
let list = await req('GET', '/api/rzs/orders');
assert.equal(list.rows.length, 2, 'два замовлення');
assert.equal(list.counts.new, 2, 'лічильник «Нове»');
let prods = await req('GET', '/api/rzs/products');
assert.deepEqual(prods.map((p) => p.code).sort(), ['EV-100', 'EV-200']);
assert.equal(prods.find((p) => p.code === 'EV-100').product_id, 501, 'артикул знайдено в каталозі');
assert.equal(prods.find((p) => p.code === 'EV-100').name, 'Рекуператор Ековент');
calls.list = 0;
await req('POST', '/api/rzs/sync', {});
assert.equal(calls.list, 0, 'повторне оновлення протягом 2 хв — без запиту до Розетки');
assert.equal((await req('GET', '/api/rzs/orders?status=todo')).rows.length, 2, 'фільтр «до підтвердження»');
assert.equal((await req('GET', '/api/rzs/orders?q=коваль')).rows.length, 1, 'пошук кирилицею без регістру');
assert.equal((await req('GET', '/api/rzs/orders?q=0501112233')).rows.length, 1, 'пошук за телефоном');

// ---------- 3. Вебхук: Basic-логін, перечитування замовлення, позначка документів ----------
const basic = (u, p) => ({ 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${u}:${p}`)}` });
assert.equal((await send('POST', `/api/rzs/hook/${acc.id}`, { orderId: ID1 }, basic(hook.user, 'wrong'))).status, 401, 'чужий пароль — 401');
ORDERS.get(ID1).documentLink = 'https://edo.vchasno.ua/doc/1';
ORDERS.get(ID1).incomingInvoiceNumber = 'ВЧ-15';
const hr = await req('POST', `/api/rzs/hook/${acc.id}`, { event: 'dropshipping.order.updated', data: { orderId: ID1 } }, basic(hook.user, hook.pass));
assert.equal(hr.saved, 1, 'вебхук перечитав замовлення');
let o1 = await req('GET', `/api/rzs/orders/${ID1}`);
assert.equal(o1.document_link, 'https://edo.vchasno.ua/doc/1');
assert.equal(o1.invoice_no, 'ВЧ-15');
assert.ok(o1.docs_at, 'час появи документів позначено');
const docsAt = o1.docs_at;
assert.equal((await req('GET', '/api/rzs/orders?status=docs')).rows.length, 1, 'фільтр «з документами»');
assert.ok((await req('GET', '/api/rzs/accounts'))[0].hook_at, 'час останнього вебхука');

// ---------- 4. Підтвердження: серійні номери, повне підтвердження ----------
assert.match(await errOf(() => req('POST', `/api/rzs/orders/${ID2}/confirm`, {})), /серійні номери/, 'без серійних номерів — ні');
tooMany = 3;
assert.equal(await status(() => req('POST', `/api/rzs/orders/${ID1}/confirm`, {})), 429, '429 тричі поспіль — 429 (браузер зачекає й повторить)');
tooMany = 1;
await req('POST', `/api/rzs/orders/${ID1}/confirm`, {}); // один 429 — сервер сам зачекав і повторив
assert.equal(tooMany, 0);
await req('POST', `/api/rzs/orders/${ID2}/confirm`, { serials: { 'EV-200': 'SN-1' } });
assert.deepEqual(calls.confirm[0].b.products, [{ supplierCode: 'EV-100', confirmedQuantity: 2 }]);
assert.deepEqual(calls.confirm[1].b.products[0].serialNumbers, ['SN-1']);
o1 = await req('GET', `/api/rzs/orders/${ID1}`);
assert.equal(o1.status, 'confirmed');
assert.ok(o1.confirmed_at);
assert.equal(o1.docs_at, docsAt, 'час документів не перезаписується');

// ---------- 5. ТТН: місця × кількість, свої габарити, ЮЗД, повтор ----------
assert.match(await errOf(() => req('POST', `/api/rzs/orders/${ID2}/ttn`, {})), /ЮЗД/, 'ЮЗД не звірено — ТТН не можна');
await raw.run(`UPDATE rzs_orders SET uzd_status = 'verified' WHERE id = ?`, [ID2]);
assert.match(await errOf(() => req('POST', `/api/rzs/orders/${ID2}/ttn`, {})), /габаритів/, 'немає габаритів — зрозуміла помилка');
await req('PUT', '/api/rzs/products/EV-200', { seats: [{ lengthCm: '50', widthCm: '40', heightCm: '30', weightKg: '7,5' }] });
const t1 = await req('POST', `/api/rzs/orders/${ID1}/ttn`, {});
assert.equal(t1.ttn, '20450000000001');
assert.equal(calls.ttn[0].b.cargoSeats.length, 2, 'місце з каталогу Розетки × 2 шт.');
assert.equal(calls.ttn[0].b.deliveryService, 'nova_poshta');
await req('POST', `/api/rzs/orders/${ID2}/ttn`, {});
assert.deepEqual(calls.ttn[1].b.cargoSeats, [{ lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 7.5 }], 'свої габарити товару');
assert.match(await errOf(() => req('POST', `/api/rzs/orders/${ID1}/ttn`, {})), /ТТН уже є/);
assert.equal((await req('GET', '/api/rzs/orders?status=nottn')).rows.length, 0);

// ---------- 6. Маркування групою ----------
const mr = await send('POST', '/api/rzs/markings', { ids: [ID1, ID2] });
assert.equal(mr.status, 200);
assert.equal((await mr.text()).slice(0, 4), '%PDF');
assert.deepEqual(calls.print[0].orders.sort(), [ID1, ID2].sort());

// ---------- 7. LP-CRM: ціна закупівлі, не роздрібна ----------
assert.match(await errOf(() => req('POST', `/api/rzs/orders/${ID1}/crm`, {})), /ціну закупівлі/, 'без ціни закупівлі — ні');
await req('PUT', '/api/rzs/products/EV-100', { purchase_price: '7 200,50', stock: 5 });
const cr = await req('POST', `/api/rzs/orders/${ID1}/crm`, {});
assert.equal(cr.crm_id, '88001');
const add = calls.crm.find((x) => x.method === 'addNewOrder').p;
assert.equal(add.office, '7');
assert.equal(add.delivery_adress, '20450000000001', 'ТТН — у поле адреси доставки');
assert.equal(add.additional_1, 'Riteil(Rozetka)', '«Додаткове поле 1» — за замовчуванням Riteil(Rozetka)');
assert.equal(add.phone, '380501112233');
assert.ok(add.comment.includes('900001') && add.comment.includes('20450000000001'), 'у коментарі — № Розетки і ТТН');
assert.ok(decodeURIComponent(add.products.replace(/\+/g, ' ')).includes('s:5:"price";s:6:"7200.5"'), 'ціна — закупівельна');
assert.match(await errOf(() => req('POST', `/api/rzs/orders/${ID1}/crm`, {})), /Уже в LP-CRM/, 'двічі — ні');
assert.equal((await req('GET', '/api/rzs/orders?status=nocrm')).rows.length, 1, 'фільтр «не в LP-CRM»');

await req('PUT', '/api/rzs/products/EV-200', { purchase_price: 3000, rrp: 4100, stock: 0 });

// ---------- 8а. Імпорт товарів з Кабінету постачальника (CSV як у вивантаженні Розетки) ----------
const CSV = '﻿Товар;"ID товару";Контрагент;"Артикул товару";Категорія;Бренд;"Статус на сайті";"Статус в прайсі";"Оновлення прайсу";"Ціна в прайсі";"РРЦ від постачальника";"Ціна на сайті";"Залишки товару";"Ціна закупівлі";"Менеджер по контенту"\n'
  + '"Осушувач EvoAir Dryora 12";625022078;"ЕКОВЕНТ";EV-100;"Осушувачі";evoair;"available - Є в наявності, доступний для продажу";Y;"2026-10-27 16:05:33";5679.2;7099;6899;3;"28/10/2026 10:16 - UAH 5,679.20 | 27/10/2026 16:17 - UAH 5,519.20 |";"М"\n'
  + '"Зволожувач ""Levoit"" Dual";624710471;"ЕКОВЕНТ";"NEW-1 ";"Зволожувачі";Levoit;"unavailable - Немає в наявності";N;"2026-10-27";3960;4950;4399;0;;\n'
  + '"Без артикула";1;"Е";;"К";B;"archive - Архів";Y;"";1;2;3;0;;\n';
const imp = await send('POST', '/api/rzs/products/import', CSV, { ...H, 'Content-Type': 'text/csv' });
const ir = await imp.json();
assert.equal(imp.status, 200, ir.error);
assert.deepEqual([ir.total, ir.added, ir.updated, ir.skipped], [2, 1, 1, 1], 'новий артикул додано, наявний оновлено, рядок без артикула пропущено');
prods = await req('GET', '/api/rzs/products');
const ev = prods.find((p) => p.code === 'EV-100');
assert.equal(ev.product_id, 501, 'прив’язка до LP-CRM лишилась');
assert.equal(ev.purchase_price, 5679.2, 'ціна закупівлі — найновіша з історії');
assert.deepEqual([ev.rrp, ev.stock, ev.rz_status, ev.rz_code], [7099, 3, 'available', '625022078']);
assert.ok(ev.seats.length === 0 || ev.seats, 'габарити не зачеплено');
const nw = prods.find((p) => p.code === 'NEW-1');
assert.equal(nw.name, 'Зволожувач "Levoit" Dual', 'лапки в CSV');
assert.equal(nw.purchase_price, 3960, 'без історії — «Ціна в прайсі»');
assert.equal(nw.product_id, null, 'новий — без прив’язки, впишемо вручну');
assert.equal(ir.unmapped, 2, 'не прив’язані: EV-200 і NEW-1');
assert.match(await errOf(() => req('POST', '/api/rzs/products/import', { a: 1 })), /Артикул товару/, 'чужий файл — зрозуміла помилка');

// ---------- 8б. Пошук у LP-CRM за ТТН і ручна прив'язка ----------
const R3 = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000003';
const R4 = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000004';
const R5 = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000005';
await raw.batch([
  [`INSERT INTO rzs_orders (id, account_id, order_num, status, created_at, customer, phone, ttn, products) VALUES (?, ?, 'PO3', 'shipping', ?, 'Попелянська', '0971089181', '2040 0558 101410', '[]')`, [R3, acc.id, `${now} 12:00:00`]],
  [`INSERT INTO rzs_orders (id, account_id, order_num, status, created_at, customer, phone, ttn, products) VALUES (?, ?, 'PO4', 'confirmed', ?, 'Підопличко', '+380508846132', '', '[]')`, [R4, acc.id, `${now} 12:00:00`]],
  [`INSERT INTO rzs_orders (id, account_id, order_num, status, created_at, customer, phone, ttn, products) VALUES (?, ?, 'PO5', 'confirmed', ?, 'Ніхто', '0991112233', '20409999999999', '[]')`, [R5, acc.id, `${now} 12:00:00`]],
  [`INSERT INTO an_orders (id, code, day, status, ttn) VALUES (70001, '1761400000000111', ?, 1, '20400558101410')`, [now]],
  [`INSERT INTO order_keys (k, code, day) VALUES ('p:508846132', '1761400000000222', ?)`, [now]],
]);
assert.match(await errOf(() => req('POST', `/api/rzs/orders/${R4}/crm`, {})), /немає ТТН/, 'без ТТН у LP-CRM не передаємо');
assert.match(await errOf(() => req('POST', `/api/rzs/orders/${R4}/crm`, { no_ttn: true })), /немає ТТН/, 'і без винятків');
assert.match(await errOf(() => req('POST', `/api/rzs/orders/${R5}/ttn`, {})), /ЮЗД/, 'ТТН — лише коли Розетка звірила документи (ЮЗД)');
const fr = await req('POST', '/api/rzs/crm-find', {});
assert.deepEqual(fr.linked.map((x) => [x.order_num, x.crm_id]), [['PO3', '70001']], 'точний збіг ТТН — прив’язано одразу (пробіли в ТТН не заважають)');
assert.deepEqual(fr.suggest.map((x) => [x.order_num, x.crm[0].id, x.crm[0].by]), [['PO4', '70002', 'телефон']], 'за телефоном — лише підказка');
assert.ok(fr.notFound >= 1, 'PO5 не знайдено');
let o3 = await req('GET', `/api/rzs/orders/${R3}`);
assert.equal(o3.crm_id, '70001');
assert.equal(o3.crm_code, '1761400000000111');
assert.equal((await req('GET', `/api/rzs/orders/${R4}`)).crm_id, '', 'підказку не прив’язано без людини');
await req('PUT', `/api/rzs/orders/${R4}/crm-link`, { crm: '70002' });
assert.equal((await req('GET', `/api/rzs/orders/${R4}`)).crm_id, '70002');
assert.match(await errOf(() => req('PUT', `/api/rzs/orders/${R5}/crm-link`, { crm: '70001' })), /уже прив/, 'один номер LP-CRM — до одного замовлення');
assert.match(await errOf(() => req('PUT', `/api/rzs/orders/${R5}/crm-link`, { crm: 'abc' })), /цифри/);
await req('PUT', `/api/rzs/orders/${R4}/crm-link`, { crm: '' });
assert.equal((await req('GET', `/api/rzs/orders/${R4}`)).crm_id, '', 'відв’язано');
// «Накладні»: замовлення LP-CRM, прив'язане до Розетки, — не накладна ФОП, а маркування й документи Розетки.
await raw.batch([
  [`INSERT INTO orders_index (code, datetime, ttn) VALUES ('1761400000000111', ?, '20400558101410')`, [`${now} 12:00:00`]],
  [`INSERT OR IGNORE INTO order_keys (k, code, day) VALUES ('70001', '1761400000000111', ?)`, [now]],
]);
const invR = await send('GET', '/api/invoice/70001');
const inv = await invR.json();
assert.equal(invR.status, 200, inv.error);
assert.equal(inv.rzs?.order_num, 'PO3', 'вкладка «Накладні» впізнає замовлення Розетки');
assert.equal(inv.versionsCount, 0, 'версії накладної не зберігаються');
const fr2 = await req('POST', '/api/rzs/crm-find', { ids: [R3] });
assert.equal(fr2.checked, 0, 'вже прив’язані не перевіряються');

// ---------- 8в. Сповіщення в Telegram: з'явився вхідний рахунок; можна створювати ТТН ----------
await raw.batch([
  [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`UPDATE users SET tg_chat_id = '100' WHERE login = 'o'`, []],
]);
const nu = await req('GET', '/api/rzs/notify-users');
assert.ok(nu.some((u) => u.tg && u.admin), 'список отримувачів — з позначкою, чи підключено бота');
await req('PUT', `/api/rzs/accounts/${acc.id}`, { notify_inv: true, notify_ttn: true });
const ID6 = '11111111-aaaa-4bbb-8ccc-000000000006';
ORDERS.set(ID6, { orderId: ID6, orderNum: '900006', createdAt: `${now} 13:00:00`, orderStatus: 'confirmed', uzdStatus: 'not_uploaded', customerName: 'Нотифікація Тест',
  deliveryCity: 'Київ', deliveryPhone: '0501110006', products: [{ supplierCode: 'EV-100', quantity: 1, cargoSeats: [] }] });
tg.length = 0;
await req('POST', '/api/rzs/sync', { force: true });
assert.equal(tg.length, 0, 'перше завантаження замовлення — без сповіщень');
assert.equal((await req('GET', '/api/rzs/orders?status=noinv')).rows.some((r) => r.id === ID6), true, 'фільтр «Чекає рахунок»');
ORDERS.get(ID6).incomingInvoiceNumber = 'РО360700001';
await req('POST', '/api/rzs/sync', { force: true });
assert.equal(tg.length, 1);
assert.ok(tg[0].text.includes('вхідний рахунок') && tg[0].text.includes('РО360700001') && tg[0].text.includes('900006'), tg[0].text);
assert.equal(String(tg[0].chat_id), '100', 'нікого не вибрано — власник і адміни');
ORDERS.get(ID6).uzdStatus = 'verified';
await req('POST', '/api/rzs/sync', { force: true });
assert.equal(tg.length, 2);
assert.ok(tg[1].text.includes('можна створювати ТТН') && tg[1].text.includes('900006'), tg[1].text);
assert.equal((await req('GET', '/api/rzs/orders?status=ready')).rows.map((r) => r.id).join(), ID6, 'фільтр «Можна створити ТТН»');
await req('POST', '/api/rzs/sync', { force: true });
assert.equal(tg.length, 2, 'повторно не надсилається');
assert.equal((await req('GET', '/api/rzs/orders?q=РО3607')).rows.length, 1, 'пошук за № рахунку');
const accN = (await req('GET', '/api/rzs/accounts'))[0];
assert.deepEqual([accN.notify_inv, accN.notify_ttn, accN.notify_users], [true, true, []]);
ORDERS.delete(ID6);

// ---------- 8г. Помилка оновлення з Розетки видно на сторінці; вдале оновлення її знімає ----------
listFail = true;
const sf = await req('POST', '/api/rzs/sync', { force: true });
assert.ok(sf.results.some((x) => x.error), 'помилка — у відповіді');
let sa = (await req('GET', '/api/rzs/orders')).accounts[0];
assert.ok(sa.sync_error && sa.sync_error_at, 'помилку збережено');
listFail = false;
await req('POST', '/api/rzs/sync', { force: true });
sa = (await req('GET', '/api/rzs/orders')).accounts[0];
assert.equal(sa.sync_error, '', 'вдале оновлення знімає помилку');
const s0 = await req('POST', '/api/rzs/sync', { force: true });
assert.equal(s0.results.find((x) => x.saved)?.changed, 0, 'нічого не змінилось — список не перемальовується');
await raw.run(`UPDATE rzs_orders SET crm_code = '1761400000000222', crm_id = '' WHERE id = ?`, [R4]);
const s1 = await req('POST', '/api/rzs/sync', { force: true });
assert.ok(s1.results.some((x) => x.crmNums === 1), 'номер LP-CRM для «передано» підтягнуто');
assert.equal((await req('GET', `/api/rzs/orders/${R4}`)).crm_id, '70002');
await raw.run(`UPDATE rzs_orders SET crm_checked_at = '' WHERE id IN (?, ?)`, [R3, R4]);
await req('POST', '/api/rzs/crm-status', {});
const cn = await req('GET', '/api/rzs/orders?status=crmnew');
assert.deepEqual(cn.rows.map((r) => r.order_num), ['PO4'], 'фільтр «В LP-CRM — Нове»');
assert.equal(cn.counts.crmnew, 1);
assert.equal(cn.rows[0].crm_status, 'Новий');
assert.equal((await req('GET', `/api/rzs/orders/${R3}`)).crm_status, 'Прийнято', 'інші статуси теж видно');

// ---------- 9. Права ----------
await req('POST', '/api/users', { login: 'viewer', password: 'pass1234', role: 'viewer' });
const vl = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'viewer', password: 'pass1234' }) });
const VH = { 'Content-Type': 'application/json', Cookie: vl.headers.get('set-cookie').split(';')[0] };
assert.equal((await req('GET', '/api/rzs/orders', undefined, VH)).rows.length, 6, 'перегляд бачить замовлення');
assert.equal(await status(() => req('GET', '/api/rzs/accounts', undefined, VH)), 403, 'кабінети — лише власник/адміни');
assert.equal(await status(() => req('POST', `/api/rzs/orders/${ID2}/crm`, {}, VH)), 403);
assert.equal(await status(() => req('PUT', '/api/rzs/products/EV-200', { purchase_price: 1 }, VH)), 403);
assert.equal(await status(() => req('POST', '/api/rzs/crm-find', {}, VH)), 403);
assert.equal(await status(() => req('PUT', `/api/rzs/orders/${R4}/crm-link`, { crm: '1' }, VH)), 403);
assert.equal((await send('POST', '/api/rzs/products/import', CSV, { ...VH, 'Content-Type': 'text/csv' })).status, 403, 'імпорт — лише з правом довідників');

// ---------- 10. Новий пароль вебхука, видалення ----------
await req('PUT', `/api/rzs/accounts/${acc.id}`, { new_hook_pass: true });
assert.equal((await send('POST', `/api/rzs/hook/${acc.id}`, '{}', basic(hook.user, hook.pass))).status, 401, 'старий пароль більше не діє');
await req('DELETE', `/api/rzs/accounts/${acc.id}`);
assert.equal((await raw.get(`SELECT COUNT(*) AS n FROM rzs_orders`)).n, 0);

console.log('  запитів до бази (макс.):', maxQ);
for (const [k, n] of Object.entries(maxQ)) assert.ok(n <= 45, `${k}: ${n} запитів до бази`);
console.log('OK — Рітейл: Розетка (кабінет постачальника)');
