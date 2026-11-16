// Маркетплейси → Розетка ↔ LP-CRM: налаштування магазину, пошук (ТТН — прив'язка одразу, телефон — пропозиція),
// ручна прив'язка й відв'язка, «Створити в LP-CRM» лише з «Обробляється менеджером», запам'ятовування товарів, статус у LP-CRM.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

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
// товар запам'ятався з однозначного збігу (1 товар ↔ 1 товар)
assert.deepEqual({ ...(await db.get(`SELECT item_id, product_id FROM mp_crm_items`)) }, { item_id: '564329178', product_id: 701 });

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
// без налаштувань магазину — ні
r = await req('GET', '/api/mp/crm/prefill/1/9004');
assert.equal(r.status, 200);
assert.deepEqual(r.j.items.map((x) => [x.item_id, x.product_id, x.from, x.qty, x.price]), [['564329178', 701, 'saved', 2, 7600], ['111', null, '', 1, 500]]);
const items = [{ item_id: '564329178', product_id: 701, price: 7600, qty: 2, product_name: 'Осушувач' }, { item_id: '111', product_id: 703, price: 500, qty: 1, product_name: 'Очищувач Levoit Core 300' }];
r = await req('POST', '/api/mp/crm/create', { account: 1, id: '9004', items });
assert.equal(r.status, 400);
assert.match(r.j.error, /ID відділу/);
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
assert.equal(add.office, '7');
assert.equal(add.site, 'rozetka.com.ua');
assert.equal(add.additional_1, 'Rozetka(Ecovent)');
assert.equal(add.phone, '380509990000');
assert.equal(add.bayer_name, 'Ткач Наталія');
assert.match(add.comment, /^Rozetka 9004 · Ековент/);
assert.match(add.comment, /Оплата: Google Pay \(оплачено\)/);
assert.match(add.comment, /Коментар покупця: Після 18:00/);
assert.equal(add.delivery_adress, 'Київ, № 12');
assert.match(decodeURIComponent(add.products.replace(/\+/g, ' ')), /"701".*"7600".*"2".*"703".*"500".*"1"/s);
const o4 = await row(1, '9004');
assert.equal(o4.crm_id, '95555');
assert.equal(o4.crm_status, 'Нові');
assert.match(o4.crm_by, /створив\(ла\) owner/);
assert.equal((await db.get(`SELECT product_id FROM mp_crm_items WHERE item_id = '111'`)).product_id, 703, 'новий товар запам\'ятався');
r = await req('POST', '/api/mp/crm/create', { account: 1, id: '9004', items });
assert.equal(r.status, 400, 'вдруге — ні');
assert.match(r.j.error, /Уже в LP-CRM: № 95555/);

// ---------- пошук товарів LP-CRM ----------
r = await req('GET', '/api/mp/crm/products?q=evoair comfodry');
assert.deepEqual(r.j.products.map((p) => p.id), [701]);
// схожий за назвою товар підставляється сам
await db.run(`DELETE FROM mp_crm_items`);
r = await req('GET', '/api/mp/crm/prefill/2/9005');
assert.equal(r.j.items[0].product_id, 701);
assert.equal(r.j.items[0].from, 'guess');

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
