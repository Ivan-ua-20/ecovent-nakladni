// Маркетплейси → «Створити ТТН» для замовлення Розетки: ROZETKA Delivery, Нова пошта, Meest через API кабінету продавця.
// Дані одержувача — із замовлення, відправник — з налаштувань Розетки; оплачене — без накладеного платежу; ТТН записується в замовлення.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { carrierOf } from '../src/modules/market/ttn.js';

assert.equal(carrierOf('ROZETKA Delivery'), 'rd');
assert.equal(carrierOf('Нова Пошта'), 'np');
assert.equal(carrierOf('Meest ПОШТА'), 'me');
assert.equal(carrierOf('Самовивіз'), '');

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
const day = now.slice(0, 10);
await db.run(`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'OneDay', 'u', 'p', 'rztok', ?, 1, ?)`, [now, now]);
const ins = (id, delivery, paid, extra = {}) => db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, status_group, ttn, delivery, address, pay_type, pay_status, paid)
  VALUES ('rozetka', 1, ?, ?, ?, ?, '26', 'Обробляється менеджером', 'Метельський Сергій', '380674951531', 6699, ?, ?, '', ?, '', ?, ?, ?)`,
[id, id, `${day} 10:00:00`, `${day} 10:00:00`, JSON.stringify([{ id: '550244883', name: 'Осушувач повітря EvoAir Dryora 10', qty: 1, price: 6699 }]), extra.group ?? 1, delivery, paid ? 'Google Pay' : 'Оплата при отриманні', paid ? 'Оплачено' : '', paid ? 1 : 0]);
await ins('7001', 'ROZETKA Delivery', true);
await ins('7002', 'Нова Пошта', false);
await ins('7003', 'Meest ПОШТА', false);
await ins('7004', 'ROZETKA Delivery', false, { group: 3 });
await ins('7005', 'Нова Пошта', false);

const sent = [];
const hits = [];
const ok = (content) => new Response(JSON.stringify({ success: true, content }));
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.hostname !== 'api-seller.rozetka.com.ua') throw new Error(`неочікуваний запит ${url}`);
  const path = u.pathname;
  hits.push(path);
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (body) sent.push({ path, body });
  if (path.startsWith('/delivery-rozetka/get-user-info/')) return ok({ name: 'Метельський Сергій', phone: '380674951531', amount: '6699.00', city: 'Вінницькі Хутори', street: 'Немирівське шосе', houseNumber: '94Є', departmentId: 'dep-1', departmentType: 0,
    departmentRestrictions: { max_weight: 30, max_cost: 30000 }, itemDimensions: { width: 25, height: 50, length: 35, weight: 4.2 }, isReturnMoneyAllowed: true });
  if (path === '/delivery-rozetka/settings') return ok({ sender: { type: 'natural', city: 'Чернівці', address: 'Чернівці, відділення 2', department: 'snd-dep', name: 'ФОП Лупу В.Ф.', phones: ['380501112233'], info: '', carrier: 1 }, parcels: [] });
  if (path === '/delivery-rozetka/create-order-ttn') return ok({ ttn: 'RMP-459041120', delivery_price: 75 });
  if (path === '/ttns/get-user-info/7005') return new Response(JSON.stringify({ success: false, errors: { message: 'error_nova_poshta', description: 'Помилка при запиті в Нову Пошту', details: ['Занадто багато запитів'] } }));
  if (path.startsWith('/ttns/get-user-info/')) return ok({ name: 'Метельський Сергій', phone: '380674951531', is_warehouse: 1, cityRef: 'city-r', warehouseRef: 'wh-r', place_number: 'Відділення №3', amount: '6699.00' });
  if (path === '/ttn-settings/setting') return ok({ ttn_key: 'SECRET-NP-KEY', selected_sender: JSON.stringify({ Phones: '380501112233', LastName: 'Лупу', FirstName: 'Василь' }), conterparty: { Ref: 'cp-r', Description: 'ФОП Лупу' }, sender: { Ref: 'contact-r' }, address: { Ref: 'addr-r', CityRef: 'city-s', Description: 'Чернівці №2' }, is_add_payment_control: true });
  if (path === '/ttns/common-data') return ok({ CanAfterpaymentOnGoodsCost: true, recipientCounterParties: [{ Ref: 'rcp-r' }] });
  if (path === '/ttns/create-ttn') return ok({ success: true, data: [{ IntDocNumber: '20451234567890', CostOnSite: 95 }] });
  if (path.startsWith('/meests/get-user-info/')) return ok({ name: 'Метельський Сергій', phone: '380674951531', amount: '6699.00', city: 'Вінниця', branchId: 'me-br' });
  if (path === '/meests/ttn-settings') return ok({ selected_sender: { name: 'Лупу В.', phone: '380501112233', branchID: 'me-snd' } });
  if (path === '/meests/create-ttn') return ok({ ttn: '713-3737972', delivery_price: 80 });
  return new Response(JSON.stringify({ success: false, errors: { message: 'entity_not_found' } }));
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body) => {
  const r = await mk().request(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const ttnOf = async (id) => (await db.get(`SELECT ttn FROM mp_orders WHERE id = ?`, [id])).ttn;

// ---------- ROZETKA Delivery, оплачене ----------
let r = await req('GET', '/api/mp/ttn/prep?account=1&id=7001');
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.deepEqual([r.j.carrier, r.j.paid, r.j.recipient.kind, r.j.sender.name, r.j.parcel.weight, r.j.parcel.length], ['rd', true, 'відділення', 'ФОП Лупу В.Ф.', 4.2, 35]);
r = await req('POST', '/api/mp/ttn/create', { account: 1, id: '7001', weight: 4.2, length: 35, width: 25, height: 50, places: 1, declared: 6699, cod: 0, description: 'Осушувач' });
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.equal(r.j.ttn, 'RMP-459041120');
const rd = sent.find((x) => x.path === '/delivery-rozetka/create-order-ttn').body;
assert.deepEqual([rd.order_id, rd.has_paid, rd.cost, rd.payer, rd.places, rd.sender.department, rd.carrier], [7001, true, 0, 'sender', 1, 'snd-dep', 1]);
assert.equal(rd.params.volume, 10.938, 'об’ємна вага = Д×Ш×В/4000');
assert.equal(await ttnOf('7001'), 'RMP-459041120');
assert.match((await req('POST', '/api/mp/ttn/create', { account: 1, id: '7001', weight: 1, length: 1, width: 1, height: 1 })).j.error, /вже є ТТН/);

// ---------- Нова пошта, не оплачене: накладений платіж через контроль оплати; ключ НП не віддається ----------
r = await req('GET', '/api/mp/ttn/prep?account=1&id=7002');
assert.equal(r.j.carrier, 'np');
assert.ok(!JSON.stringify(r.j).includes('SECRET-NP-KEY'), 'ключ НП не йде в браузер');
assert.deepEqual([r.j.payment_control, r.j.payment_control_on, r.j.sender.place], [true, true, 'Чернівці №2']);
r = await req('POST', '/api/mp/ttn/create', { account: 1, id: '7002', weight: 4, length: 35, width: 25, height: 50, places: 1, declared: 6699, cod: 6699, payment_control: true });
assert.equal(r.j.ttn, '20451234567890', JSON.stringify(r.j));
const np = sent.find((x) => x.path === '/ttns/create-ttn').body;
assert.deepEqual([np.order_id, np.ServiceType, np.Sender, np.ContactSender, np.SenderAddress, np.CitySender, np.Recipient, np.CityRecipient, np.RecipientAddress],
  [7002, 'WarehouseWarehouse', 'cp-r', 'contact-r', 'addr-r', 'city-s', 'rcp-r', 'city-r', 'wh-r']);
assert.deepEqual([np.CanAfterpaymentOnGoodsCost, np.AfterpaymentOnGoodsCost, np.BackwardDeliveryMoney, np.PayerType], [true, '6699', undefined, 'Sender']);

assert.deepEqual(['/ttns/get-user-info/7002', '/ttn-settings/setting', '/ttns/common-data'].map((x) => hits.filter((h) => h === x).length), [1, 1, 1], 'вікно + створення — кожен запит до НП лише раз');
// НП обмежила запити — зрозуміла порада
assert.match((await req('GET', '/api/mp/ttn/prep?account=1&id=7005')).j.error, /тимчасово обмежила кількість запитів/);

// ---------- Meest ----------
r = await req('POST', '/api/mp/ttn/create', { account: 1, id: '7003', weight: 4, length: 35, width: 25, height: 50, places: 1, declared: 6699, cod: 6699, payer: 'recipient' });
assert.equal(r.j.ttn, '713-3737972', JSON.stringify(r.j));
const me = sent.find((x) => x.path === '/meests/create-ttn').body;
assert.deepEqual([me.order_id, me.COD, me.receiverPay, me.receiver.branchID, me.sender.branchID, me.placesItems[0].insurance], [7003, 6699, true, 'me-br', 'me-snd', 6699]);

// ---------- скасоване — ні; перевірка ваги ----------
assert.match((await req('POST', '/api/mp/ttn/create', { account: 1, id: '7004', weight: 1, length: 1, width: 1, height: 1 })).j.error, /скасоване/);
await db.run(`UPDATE mp_orders SET ttn = '' WHERE id = '7001'`);
assert.match((await req('POST', '/api/mp/ttn/create', { account: 1, id: '7001', weight: 31, length: 10, width: 10, height: 10 })).j.error, /30 кг/);
console.log('OK — маркетплейси: «Створити ТТН» (ROZETKA Delivery, Нова пошта, Meest)');
