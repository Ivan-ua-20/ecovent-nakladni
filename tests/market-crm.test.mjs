// Маркетплейси → Розетка ↔ LP-CRM: налаштування магазину, пошук (ТТН — прив'язка одразу, телефон — пропозиція),
// ручна прив'язка й відв'язка, «Створити в LP-CRM» лише з «Обробляється менеджером», запам'ятовування товарів, статус у LP-CRM.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { partsToLines } from '../src/modules/market/crm.js';

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
const day = now.slice(0, 10);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'Ековент', 'u', 'p', 'rztok', ?, 1, ?), (2, 'OneDay', 'u', 'p', 'rztok', ?, 1, ?)`, [now, now, now, now]],
  // каталог товарів LP-CRM (з аналітики)
  [`INSERT INTO an_products (product_id, name) VALUES (701, 'Осушувач повітря Evoair ComfoDry 12'), (702, 'Зволожувач Evoair UMIVA 4700 Smart'), (703, 'Очищувач Levoit Core 300')`, []],
  // LP-CRM уже має замовлення: за ТТН і за телефоном
  [`INSERT INTO an_orders (id, code, day, status, ttn) VALUES (90001, 'C-TTN-1', ?, 1, '20451000000001')`, [day]],
  [`INSERT INTO order_keys (k, code, day) VALUES ('p:671112233', 'C-PH-1', ?), ('90002', 'C-PH-1', ?)`, [day, day]],
]);
const ins = (acc, id, status, extra = {}) => db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, status_group, ttn, delivery, address, pay_type, paid, comment)
  VALUES ('rozetka', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'Нова Пошта', 'Київ, № 12', 'Google Pay', 1, ?)`,
[acc, id, id, `${day} 10:00:00`, `${day} 10:00:00`, status, status === '26' ? 'Обробляється менеджером' : 'Нове замовлення', extra.customer || 'Ткач Наталія', extra.phone || '380671112233',
  extra.total || 7600, JSON.stringify(extra.items || [{ id: '564329178', name: 'Осушувач повітря EvoAir ComfoDry 12, до 35 м²', qty: 1, price: 7600 }]), extra.ttn || '', extra.comment || '']);
await ins(1, '9001', '26', { ttn: '20451000000001' }); // знайдеться за ТТН
await ins(1, '9002', '26'); // лише телефон — пропозиція
await ins(1, '9003', '1', { phone: '380500000000' }); // нове — створювати не можна
await ins(1, '9004', '26', { phone: '380509990000', comment: 'Після 18:00', items: [{ id: '564329178', name: 'Осушувач повітря EvoAir ComfoDry 12, до 35 м²', qty: 2, price: 7600 }, { id: '111', name: 'Фільтр невідомий', qty: 1, price: 500 }] });
await ins(2, '9005', '26', { phone: '380509990001' });

const CRM = new Map([
  ['C-TTN-1', { id: '90001', ttn: '20451000000001', phone: '0671112233', bayer_name: 'Ткач Н.', status: '1', products: [{ product_id: '701', name: 'Осушувач повітря Evoair ComfoDry 12' }] }],
  ['C-PH-1', { id: '90002', ttn: '', phone: '380671112233', bayer_name: 'Ткач Наталія', status: '2', products: [{ product_id: '701' }, { product_id: '703' }] }],
]);
const calls = [];
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.hostname.endsWith('lp-crm.biz')) {
    const method = u.pathname.match(/\/api\/(\w+)\.html/)[1];
    const p = Object.fromEntries(new URLSearchParams(opts.body));
    calls.push({ method, p });
    const json = (x) => new Response(JSON.stringify(x));
    if (method === 'addNewOrder') { CRM.set(p.order_id, { id: '95555', status: '2', phone: p.phone, products: [] }); return json({ status: 'ok', data: { order_id: p.order_id }, message: 'ok' }); }
    if (method === 'getStatuses') return json({ status: 'ok', data: { 1: { name: 'Прийнято' }, 2: { name: 'Нові' } } });
    if (method === 'getOrdersByID') return json({ status: 'ok', data: p.order_id.split(',').filter((c) => CRM.has(c)).map((c) => ({ order_id: c, ...CRM.get(c) })) });
    return json({ status: 'ok', data: [] });
  }
  throw new Error(`неочікуваний запит ${url}`);
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const row = (acc, id) => db.get(`SELECT * FROM mp_orders WHERE account_id = ? AND id = ?`, [acc, id]);

// ---------- пошук: ТТН — одразу, телефон — пропозиція ----------
let r = await req('POST', '/api/mp/crm/find', { orders: [{ account: 1, id: '9001' }, { account: 1, id: '9002' }, { account: 1, id: '9003' }] });
assert.equal(r.status, 200);
assert.deepEqual(r.j.linked.map((x) => x.crm_id), ['90001']);
assert.equal((await row(1, '9001')).crm_code, 'C-TTN-1');
assert.equal(r.j.suggest.length, 1);
assert.equal(r.j.suggest[0].key, '1:9002');
assert.deepEqual(r.j.suggest[0].crm.map((x) => [x.id, x.by]), [['90002', 'телефон']]);
assert.equal(r.j.notFound, 1);
assert.equal((await row(1, '9002')).crm_id, '', 'за телефоном не прив\'язує сам');
// товар запам'ятався з однозначного збігу (1 товар ↔ 1 товар) — у довіднику товарів магазину
assert.deepEqual((await db.all(`SELECT account_id, item_id, product_id, link_source, link_by FROM mp_items`)).map((x) => ({ ...x })), [{ account_id: 1, item_id: '564329178', product_id: 701, link_source: 'learned', link_by: 'за замовленням LP-CRM' }]);

// ---------- ручна прив'язка за номером, повторна — заборонена, відв'язка ----------
r = await req('PUT', '/api/mp/crm/link', { account: 1, id: '9002', crm: '90002' });
assert.equal(r.status, 200);
assert.equal(r.j.crm_id, '90002');
assert.equal(r.j.crm_status, 'Нові', 'статус з LP-CRM одразу');
assert.equal((await row(1, '9002')).crm_code, 'C-PH-1');
r = await req('PUT', '/api/mp/crm/link', { account: 1, id: '9003', crm: '90002' });
assert.equal(r.status, 400);
assert.match(r.j.error, /уже прив'язане до замовлення Розетки №9002/);
assert.equal((await req('PUT', '/api/mp/crm/link', { account: 1, id: '9003', crm: 'abc' })).status, 400);
r = await req('PUT', '/api/mp/crm/link', { account: 1, id: '9002', crm: '' });
assert.equal(r.j.crm_id, '');
assert.equal((await row(1, '9002')).crm_code, '');

// ---------- список: фільтр «не в LP-CRM» і поля ----------
const list = (await req('GET', '/api/mp/orders?mp=rozetka&crm=no')).j;
assert.deepEqual(list.rows.map((x) => x.id).sort(), ['9002', '9003', '9004', '9005']);
assert.equal((await req('GET', '/api/mp/orders?mp=rozetka&crm=yes')).j.rows[0].crm_id, '90001');

// ---------- «Створити в LP-CRM» ----------
// відділ — завжди 5 «Маркетплейси»; вид оплати — у формі
r = await req('GET', '/api/mp/crm/prefill/1/9004');
assert.equal(r.status, 200);
assert.deepEqual(r.j.pay, { id: '14', name: 'RozetkaPay', cod: false });
assert.deepEqual(r.j.office, { id: '5', name: 'Маркетплейси' });
assert.deepEqual(r.j.flow, { check: true, newItem: true }, 'обидва вікна типово увімкнені');
assert.match(r.j.send.comment, /^Rozetka 9004/);
assert.deepEqual(r.j.items.map((x) => [x.item_id, x.parts[0]?.product_id ?? null, x.from, x.qty, x.price, x.confirmed]), [['564329178', 701, 'saved', 2, 7600, false], ['111', null, '', 1, 500, false]]);
const items = [{ item_id: '564329178', product_id: 701, price: 7600, qty: 2, product_name: 'Осушувач' }, { item_id: '111', product_id: 703, price: 500, qty: 1, product_name: 'Очищувач Levoit Core 300' }];
assert.equal((await req('PUT', '/api/mp/crm/settings/1', { office: 'abc' })).status, 400);
r = await req('PUT', '/api/mp/crm/settings/1', { office: '7', site: 'rozetka.com.ua', delivery: '1', field1: 'Rozetka(Ecovent)' });
assert.equal(r.status, 200);
// лише з «Обробляється менеджером»
r = await req('POST', '/api/mp/crm/create', { account: 1, id: '9003', items });
assert.equal(r.status, 400);
assert.match(r.j.error, /Обробляється менеджером/);
// без товару LP-CRM — ні
r = await req('POST', '/api/mp/crm/create', { account: 1, id: '9004', items: [{ ...items[0] }, { ...items[1], product_id: null }] });
assert.equal(r.status, 400);
calls.length = 0;
r = await req('POST', '/api/mp/crm/create', { account: 1, id: '9004', items, shop_name: 'Ековент' });
assert.equal(r.status, 200);
assert.equal(r.j.crm_id, '95555');
const add = calls.find((x) => x.method === 'addNewOrder').p;
assert.equal(add.office, '5', 'відділ «Маркетплейси» для всіх замовлень');
assert.equal(add.payment, '14', 'оплачено на Розетці — RozetkaPay');
assert.equal(add.site, 'rozetka.com.ua');
assert.equal(add.additional_1, 'Rozetka(Ecovent)');
assert.equal(add.phone, '380509990000');
assert.equal(add.bayer_name, 'Ткач Наталія');
assert.match(add.comment, /^Rozetka 9004 · Ековент/);
assert.match(add.comment, /\nЗамовлення від \d{2}\.\d{2}\.\d{4} 10:00:00\n/);
assert.match(add.comment, /Оплата: Оплачено одразу на Розетці \(RozetkaPay\): Google Pay, 7.600 грн/);
assert.match(add.comment, /Коментар покупця: Після 18:00/);
assert.equal(add.delivery_adress, 'Київ, № 12');
assert.match(decodeURIComponent(add.products.replace(/\+/g, ' ')), /"701".*"7600".*"2".*"703".*"500".*"1"/s);
const o4 = await row(1, '9004');
assert.equal(o4.crm_id, '95555');
assert.equal(o4.crm_status, 'Нові');
assert.match(o4.crm_by, /створив\(ла\) owner/);
assert.deepEqual({ ...(await db.get(`SELECT product_id, link_source, link_by FROM mp_items WHERE account_id = 1 AND item_id = '111'`)) }, { product_id: 703, link_source: 'manual', link_by: 'owner' }, 'обраний у формі товар запам\'ятався');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_items_log`)).n, 2, 'журнал прив\'язок: вивчений і ручний');
r = await req('POST', '/api/mp/crm/create', { account: 1, id: '9004', items });
assert.equal(r.status, 400, 'вдруге — ні');
assert.match(r.j.error, /Уже в LP-CRM: № 95555/);

// ---------- пошук товарів LP-CRM ----------
r = await req('GET', '/api/mp/crm/products?q=evoair comfodry');
assert.deepEqual(r.j.products.map((p) => p.id), [701]);
// ---------- довідник товарів: правила прив'язки (лише однозначний збіг, без вгадування за назвою) ----------
// 2) той самий товар в іншому магазині НЕ переноситься: прив'язки — окремо для кожного магазину
r = await req('GET', '/api/mp/crm/prefill/2/9005');
assert.deepEqual([r.j.items[0].parts.length, r.j.items[0].from], [0, '']);
assert.ok(!(await db.get(`SELECT product_id FROM mp_items WHERE account_id = 2 AND item_id = '564329178'`))?.product_id);
// стара таблиця mp_crm_items ще читається (для баз до появи довідника)
await db.run(`INSERT INTO mp_crm_items (mp, item_id, product_id, name, updated_at) VALUES ('rozetka', '777', 703, 'Старий', '')`);
await ins(2, '9006', '26', { phone: '380509990002', items: [{ id: '777', name: 'Старий товар', qty: 1, price: 100 }] });
r = await req('GET', '/api/mp/crm/prefill/2/9006');
assert.deepEqual([r.j.items[0].parts[0].product_id, r.j.items[0].from], [703, 'saved']);
// 3) код на початку артикулу = «[код]» у назві товару LP-CRM; 4) артикул без бренду = model; неоднозначний код і невідомий артикул — порожньо
await db.batch([
  [`INSERT INTO crm_products (product_id, name, namel, code, sku, skun, model, active) VALUES
    (669, 'Осушувач повітря Evoair ComfoDry 12 (COMFODRY12) [30414]', 'осушувач повітря evoair comfodry 12 (comfodry12) [30414]', '30414', 'COMFODRY12', 'comfodry12', 'COMFODRY12', 1),
    (646, 'Осушувач повітря Evoair Dryora 10 (DRYORA10) [30360]', 'осушувач повітря evoair dryora 10 (dryora10) [30360]', '30360', 'DRYORA10', 'dryora10', 'DRYORA10', 1),
    (1021, 'Очищувач повітря DREO 337S (DR-HAP007S) [83891]', 'очищувач повітря dreo 337s (dr-hap007s) [83891]', '83891', 'DR-HAP007S', 'drhap007s', '', 1),
    (1024, 'Очищувач повітря DREO 337S [83891]', 'очищувач повітря dreo 337s [83891]', '83891', '', '', '', 1)`, []],
]);
await ins(2, '9007', '26', { phone: '380509990003', items: [
  { id: 'A1', name: 'Осушувач ComfoDry', qty: 1, price: 7600, article: '30414 EvoairComfoDry12' },
  { id: 'A2', name: 'Осушувач Dryora', qty: 1, price: 6500, article: '99999 EvoairDryora10' },
  { id: 'A3', name: 'Очищувач DREO', qty: 1, price: 7499, article: '83891 Dreo337S' },
  { id: 'A4', name: 'Щось нове', qty: 1, price: 1, article: '12345 SomethingNew' },
  { id: 'A5', name: 'Без артикулу', qty: 1, price: 1 }] });
r = await req('GET', '/api/mp/crm/prefill/2/9007');
assert.deepEqual(r.j.items.map((x) => [x.item_id, x.parts[0]?.product_id ?? null, x.from]), [['A1', 669, 'code'], ['A2', 646, 'sku'], ['A3', null, ''], ['A4', null, ''], ['A5', null, '']]);
assert.equal(r.j.items[1].parts[0].name, 'Осушувач повітря Evoair Dryora 10 (DRYORA10) [30360]');
assert.deepEqual((await db.all(`SELECT item_id, product_id, link_source FROM mp_items WHERE account_id = 2 AND item_id LIKE 'A%' ORDER BY item_id`)).map((x) => ({ ...x })),
  [{ item_id: 'A1', product_id: 669, link_source: 'code' }, { item_id: 'A2', product_id: 646, link_source: 'sku' }], 'автоматичні збіги записано, порожні — ні');
// рядки з форми не змінюють наявних прив'язок (змінюють лише у вікні підтвердження); порожні — запам'ятовуються
await req('PUT', '/api/mp/crm/settings/2', { office: '8' });
r = await req('POST', '/api/mp/crm/create', { account: 2, id: '9007', items: [
  { item_id: 'A1', product_id: 701, price: 7600, qty: 1 }, { item_id: 'A2', product_id: 646, price: 6500, qty: 1 }, { item_id: 'A3', product_id: 1021, price: 7499, qty: 1 },
  { item_id: 'A4', product_id: 703, price: 1, qty: 1 }, { item_id: 'A5', product_id: 703, price: 1, qty: 1 }] });
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.deepEqual((await db.all(`SELECT item_id, product_id, link_source FROM mp_items WHERE account_id = 2 AND item_id LIKE 'A%' ORDER BY item_id`)).map((x) => [x.item_id, x.product_id, x.link_source]),
  [['A1', 669, 'code'], ['A2', 646, 'sku'], ['A3', 1021, 'manual'], ['A4', 703, 'manual'], ['A5', 703, 'manual']]);
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_items WHERE product_id = 703`)).n, 4, 'кілька товарів маркетплейсу (і з різних магазинів) → один товар LP-CRM');
// фоновий підбір для товарів без прив'язки (з синхронізації): за кодом, дубль у магазині — копія
await db.batch([
  [`INSERT INTO mp_items (mp, account_id, item_id, name, article, last_seen) VALUES ('rozetka', 1, 'B1', 'Dryora дубль', '30360 EvoairDryora10', '2026-11-01'), ('rozetka', 1, 'B2', 'Без коду', 'XYZ', '2026-11-02'), ('rozetka', 1, 'B3', 'Дубль ComfoDry', '30414 EvoairComfoDry12', '2026-11-03')`, []],
]);
r = (await req('POST', '/api/cron/run/market-items', null, { 'X-Cron-Key': (await req('POST', '/api/jobs/key')).j.key })).j;
assert.ok(r.ok, JSON.stringify(r));
assert.deepEqual([r.result.checked, r.result.linked], [3, 2]);
assert.deepEqual((await db.all(`SELECT item_id, product_id, link_source FROM mp_items WHERE account_id = 1 AND item_id LIKE 'B%' ORDER BY item_id`)).map((x) => [x.item_id, x.product_id, x.link_source]),
  [['B1', 646, 'code'], ['B2', null, ''], ['B3', 669, 'code']], 'B3: прив\'язка того ж артикулу в магазині 2 не переноситься — за кодом');
// пошук у формі бачить і словник каталогу
r = await req('GET', '/api/mp/crm/products?q=dryora');
assert.deepEqual(r.j.products.map((p) => p.id), [646]);

// ---------- перше підтвердження товару: склад окремо для кожного магазину, комплект ----------
await ins(1, '9010', '26', { phone: '380509990010', items: [{ id: 'K1', name: 'Набір DREO + фільтр', qty: 2, price: 10000, article: 'DREO-SET' }, { id: 'B1', name: 'Dryora дубль', qty: 1, price: 6500, article: '30360 EvoairDryora10' }] });
await ins(2, '9011', '26', { phone: '380509990011', items: [{ id: 'K1', name: 'Набір DREO + фільтр', qty: 1, price: 10000, article: 'DREO-SET' }] });
r = await req('GET', '/api/mp/crm/prefill/1/9010');
assert.deepEqual(r.j.items.map((x) => [x.item_id, x.confirmed, x.parts.map((p) => p.product_id)]), [['K1', false, []], ['B1', false, [646]]], 'нові товари — непідтверджені');
assert.equal((await req('POST', '/api/mp/crm/confirm', { account: 1, items: [{ item_id: 'K1', parts: [] }] })).status, 400, 'без товару LP-CRM — ні');
r = await req('POST', '/api/mp/crm/confirm', { account: 1, items: [
  { item_id: 'K1', name: 'Набір DREO + фільтр', article: 'DREO-SET', parts: [{ product_id: 1021, qty: 1 }, { product_id: 703, qty: 1, price: 2600 }] },
  { item_id: 'B1', parts: [{ product_id: 646, qty: 1 }] }] });
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.equal(r.j.confirmed, 2);
r = await req('GET', '/api/mp/crm/prefill/1/9010');
assert.deepEqual(r.j.items.map((x) => [x.item_id, x.confirmed, x.from, x.parts.map((p) => [p.product_id, p.qty, p.price])]),
  [['K1', true, 'confirmed', [[1021, 1, null], [703, 1, 2600]]], ['B1', true, 'confirmed', [[646, 1, null]]]], 'далі — без вікна, склад запам\'ятався');
assert.equal(r.j.items[0].parts[0].name, 'Очищувач повітря DREO 337S (DR-HAP007S) [83891]');
r = await req('GET', '/api/mp/crm/prefill/2/9011');
assert.deepEqual([r.j.items[0].confirmed, r.j.items[0].parts.length], [false, 0], 'в іншому магазині той самий товар підтверджують окремо');
// сума рядків = ціна Розетки: основний отримує решту
assert.deepEqual(partsToLines([{ product_id: 1021, qty: 1, price: null }, { product_id: 703, qty: 1, price: 2600 }], 2, 10000),
  [{ product_id: 1021, count: 2, price: 7400 }, { product_id: 703, count: 2, price: 2600 }]);
assert.deepEqual(partsToLines([{ product_id: 5, qty: 2, price: null }], 1, 1000), [{ product_id: 5, count: 2, price: 500 }], 'упаковка з 2 шт');
// створення зі складу довідника (без вікон)
calls.length = 0;
r = await req('POST', '/api/mp/crm/create', { account: 1, id: '9010', auto: true });
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.match(decodeURIComponent(calls.find((x) => x.method === 'addNewOrder').p.products.replace(/\+/g, ' ')), /"1021".*"7400".*"2".*"703".*"2600".*"2".*"646".*"6500".*"1"/s);
// виправлені у вікні перевірки покупець, телефон, адреса й коментар
await ins(1, '9012', '26', { phone: '380509990012', items: [{ id: 'B1', name: 'Dryora дубль', qty: 1, price: 6500 }] });
calls.length = 0;
r = await req('POST', '/api/mp/crm/create', { account: 1, id: '9012', auto: true, bayer_name: 'Інше Ім\'я', phone: '+38 (050) 111-22-33', address: 'Львів, № 5', comment: 'Мій коментар' });
assert.equal(r.status, 200, JSON.stringify(r.j));
const add2 = calls.find((x) => x.method === 'addNewOrder').p;
assert.deepEqual([add2.bayer_name, add2.phone, add2.delivery_adress, add2.comment], ['Інше Ім\'я', '380501112233', 'Львів, № 5', 'Мій коментар']);
r = await req('POST', '/api/mp/crm/create', { account: 2, id: '9011', auto: true });
assert.equal(r.status, 400, 'без складу — не створює');
// налаштування вікон
assert.deepEqual((await req('PUT', '/api/mp/crm/flow', { check: false })).j, { check: false, newItem: true });
assert.deepEqual((await req('GET', '/api/mp/crm/flow')).j, { check: false, newItem: true });
// довідник товарів для «Налаштування → Товари»
r = await req('GET', '/api/mp/items?only=todo');
assert.equal(r.status, 200);
assert.ok(r.j.items.every((x) => !x.confirmed));
r = await req('GET', '/api/mp/items?account=1&q=dreo');
assert.deepEqual(r.j.items.map((x) => [x.item_id, x.confirmed, x.parts.length]), [['K1', true, 2]]);

// ---------- статус у LP-CRM фоном ----------
CRM.set('C-TTN-1', { ...CRM.get('C-TTN-1'), status: '2' });
await db.run(`UPDATE mp_orders SET crm_checked_at = '' WHERE id = '9001'`);
const { key: cronKey } = (await req('POST', '/api/jobs/key')).j;
const cr = (await req('POST', '/api/cron/run/market-crm', null, { 'X-Cron-Key': cronKey })).j;
assert.equal(cr.ok, true);
assert.equal((await row(1, '9001')).crm_status, 'Нові');

// ---------- права й магазини ----------
await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' });
await db.run(`UPDATE users SET access = ? WHERE login = 'man'`, [JSON.stringify({ b2b: 'none', retail: 'work', market: 'work', returns: 'view', shops: ['rozetka:1'], tg: [] })]);
const lm = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const M = { 'Content-Type': 'application/json', Cookie: lm.headers.get('set-cookie').split(';')[0] };
assert.equal((await req('PUT', '/api/mp/crm/link', { account: 2, id: '9005', crm: '1' }, M)).status, 403, 'чужий магазин');
assert.equal((await req('PUT', '/api/mp/crm/settings/1', { office: '1' }, M)).status, 403, 'налаштування — лише адміністратор');
await db.run(`UPDATE users SET access = ? WHERE login = 'man'`, [JSON.stringify({ b2b: 'none', retail: 'work', market: 'view', returns: 'view', shops: null, tg: [] })]);
assert.equal((await req('POST', '/api/mp/crm/create', { account: 1, id: '9002', items }, M)).status, 403, 'лише перегляд');

console.log('OK — маркетплейси ↔ LP-CRM: пошук, прив\'язка, створення з «Обробляється менеджером», товари, статус');

// ---------- вид оплати LP-CRM ----------
{
  const { crmPayment } = await import('../src/modules/market/crm.js');
  const t = (o) => crmPayment({ total: 3499, ...o }).payment;
  assert.equal(t({ paid: 1, pay_type: 'Google Pay', delivery: 'Нова Пошта' }), '14', 'оплачено на Розетці');
  assert.equal(t({ paid: 0, pay_type: 'Оплата частинами', delivery: 'Нова Пошта' }), '14', 'онлайн на Розетці, ще не оплачено');
  assert.equal(t({ paid: 0, pay_type: 'Оплата під час отримання товару', delivery: 'ROZETKA Delivery' }), '15', 'післяплата RozetkaPay');
  assert.equal(t({ paid: 0, pay_type: 'Готівкова', delivery: 'Нова Пошта (поштомати)' }), '16', 'післяплата NovaPay');
  assert.equal(t({ paid: 0, pay_type: 'Оплата під час отримання товару', delivery: 'Meest ПОШТА' }), '18', 'післяплата Meest');
  assert.match(crmPayment({ total: 3499, paid: 0, pay_type: 'Готівкова', delivery: 'Нова Пошта' }).text, /^Післяплата \(наложка\) 3.499 грн — оплата при отриманні, NovaPay/);
  console.log('OK — вид оплати LP-CRM: RozetkaPay, післяплата RozetkaPay / NovaPay / Meest');
}
