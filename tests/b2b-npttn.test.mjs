// B2B «ТТН створює Ековент»: партнер з опцією оформлює замовлення без ТТН і маркування — з отримувачем НП
// (відділення / поштомат / адреса, довідники НП); адмін створює ТТН через API НП (отримувач → адреса → експрес-накладна
// з контролем оплати), без ТТН «Додати в CRM» не пускає; ТТН можна видалити до передачі. Партнер без опції — як раніше.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { npRecipientOf } from '../src/modules/b2b/npttn.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901)`, []],
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO np_accounts (name, api_key, sender_name, sender_code, active) VALUES ('Ековент ТОВ', 'NPKEY1', 'ТОВ Ековент', '12345678', 1)`, []],
]);
const np = []; // виклики API НП
const tg = [];
const NP = {
  'Address.searchSettlements': () => [{ Addresses: [{ Present: 'м. Київ, Київська обл.', MainDescription: 'Київ', Area: 'Київська', Ref: 'SET-KYIV', DeliveryCity: 'CITY-KYIV', Warehouses: '3000' }] }],
  'Address.getWarehouses': () => [
    { Ref: 'WH-1', Number: '1', Description: 'Відділення №1: вул. Пирогівський шлях, 135', CategoryOfWarehouse: 'Branch', CityDescription: 'Київ' },
    { Ref: 'PM-5', Number: '5005', Description: 'Поштомат №5005: вул. Хрещатик, 1', CategoryOfWarehouse: 'Postomat', CityDescription: 'Київ' }],
  'Address.getStreet': () => [{ Ref: 'ST-1', Description: 'Хрещатик', StreetsType: 'вул.' }],
  'Counterparty.getCounterparties': () => [{ Ref: 'SENDER-1', Description: 'ТОВ Ековент', EDRPOU: '12345678' }],
  'Counterparty.getCounterpartyContactPersons': () => [{ Ref: 'CONTACT-1', Description: 'Іванов Іван', Phones: '380671112233' }],
  'Counterparty.save': () => [{ Ref: 'REC-1', ContactPerson: { data: [{ Ref: 'REC-CONTACT-1' }] } }],
  'Address.save': () => [{ Ref: 'ADDR-1' }],
  'InternetDocument.save': () => [{ Ref: 'DOC-1', IntDocNumber: '20450000000001', CostOnSite: 85, EstimatedDeliveryDate: '20.11.2026' }],
  'InternetDocument.delete': () => [{ Ref: 'DOC-1' }],
};
const fetchFn = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  if (String(url).startsWith('https://api.novaposhta.ua/')) {
    const b = JSON.parse(opts.body);
    np.push(b);
    const fn = NP[`${b.modelName}.${b.calledMethod}`];
    return new Response(JSON.stringify(fn ? { success: true, data: fn(b) } : { success: false, errors: ['unknown'] }));
  }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: '10000.00' })) }));
};
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const call = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const req = async (...a) => { const r = await call(...a); if (r.status >= 400) throw Object.assign(new Error(r.j.error || r.status), { status: r.status }); return r.j; };
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

// ---------- перевірка отримувача ----------
const W = { last: 'Шевченко', first: 'Тарас', middle: 'Григорович', phone: '0671234567', type: 'warehouse', city: { ref: 'CITY-KYIV', name: 'м. Київ' }, warehouse: { ref: 'WH-1', name: 'Відділення №1', number: '1' }, cod: 3500 };
assert.equal(npRecipientOf(W).phone, '380671234567');
assert.throws(() => npRecipientOf({ ...W, last: 'Shevchenko' }), /українськими/);
assert.throws(() => npRecipientOf({ ...W, warehouse: null }), /відділення/);
assert.throws(() => npRecipientOf({ ...W, type: 'doors' }), /вулицю/);
assert.throws(() => npRecipientOf({ ...W, type: 'doors', street: { ref: 'ST-1', name: 'вул. Хрещатик' } }), /будинку/);
assert.throws(() => npRecipientOf({ ...W, city: null }), /населений пункт/);

// ---------- партнер з опцією ----------
const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '700' WHERE login = 'pa'`);
await db.run(`UPDATE b2b_partners SET open_limit = 1000000, unpaid_limit = 1000000 WHERE id = ?`, [pa.id]);
await db.run(`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
const A = await login('pa', 'pass1234');
assert.equal((await call('GET', '/api/b2b/p/np/cities?q=Київ', null, A)).status, 403, 'без опції довідники НП недоступні');
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).ttn_by_us, false);
await req('PUT', `/api/b2b/partners/${pa.id}`, { name: 'Партнер А', ttn_by_us: true });
assert.equal((await req('GET', '/api/b2b/partners')).find((p) => p.id === pa.id).ttn_by_us, 1, 'у списку партнерів — для підсвітки');
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).ttn_by_us, true);
assert.ok((await db.all(`SELECT action FROM audit_log WHERE kind = 'b2b'`)).some((r) => /ТТН створює Ековент/.test(r.action)));

// довідники НП для партнера
assert.deepEqual((await req('GET', '/api/b2b/p/np/cities?q=Київ', null, A)).rows.map((c) => [c.ref, c.name]), [['CITY-KYIV', 'м. Київ, Київська обл.']]);
assert.deepEqual((await req('GET', '/api/b2b/p/np/warehouses?city=CITY-KYIV&kind=warehouse', null, A)).rows.map((w) => w.ref), ['WH-1'], 'відділення без поштоматів');
assert.deepEqual((await req('GET', '/api/b2b/p/np/warehouses?city=CITY-KYIV&kind=postomat', null, A)).rows.map((w) => w.ref), ['PM-5']);
assert.deepEqual((await req('GET', '/api/b2b/p/np/streets?city=CITY-KYIV&q=Хрещ', null, A)).rows.map((s) => s.name), ['вул. Хрещатик']);
assert.equal(np.find((x) => x.calledMethod === 'getWarehouses').methodProperties.CityRef, 'CITY-KYIV');
assert.ok(np.every((x) => x.apiKey === 'NPKEY1'), 'ключ кабінету НП лише на сервері');

// замовлення без ТТН і маркування
const ord = await req('POST', '/api/b2b/p/clients', { items: [{ product_id: 11, qty: 1 }], np: W, comment: 'дзвонити після 18' }, A);
let o = await req('GET', `/api/b2b/p/clients/${ord.id}`, null, A);
assert.equal(o.order.client_name, 'Шевченко Тарас Григорович', 'ПІБ — з отримувача');
assert.equal(o.order.client_phone, '380671234567');
assert.equal(o.order.np.warehouse.ref, 'WH-1');
assert.equal(o.order.np.cod, 3500);
assert.equal(o.order.np_doc_ref, undefined, 'службове поле не віддаємо');
assert.deepEqual(o.missing, ['ТТН (створює Ековент — кнопка «Створити ТТН»)'], 'маркування не потрібне');
assert.match(await errOf(() => req('POST', '/api/b2b/p/clients', { items: [{ product_id: 11, qty: 1 }], np: { ...W, warehouse: null } }, A)), /відділення/);
// без ТТН — у CRM не пускає
await db.run(`UPDATE settings SET value = 'demo' WHERE key = 'lpcrm_subdomain'`);
await req('PUT', '/api/b2b/crm-settings', { on: true, office: '7' });
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${ord.id}/crm`)), /ТТН/);

// ---------- адмін: відправник і створення ТТН ----------
const snd = await req('GET', '/api/b2b/np/senders');
assert.equal(snd.accounts[0].name, 'Ековент ТОВ');
assert.equal(snd.accounts[0].api_key, undefined, 'ключ НП не віддаємо в браузер');
assert.deepEqual([snd.sender.ref, snd.sender.contacts[0].ref, snd.sender.contacts[0].phone], ['SENDER-1', 'CONTACT-1', '380671112233']);
const body = {
  account: snd.account,
  sender: { ref: 'SENDER-1', name: 'ТОВ Ековент', contact: 'CONTACT-1', contactName: 'Іванов Іван', phone: '380671112233', city: { ref: 'CITY-KYIV', name: 'Київ' }, warehouse: { ref: 'WH-1', name: 'Відділення №1' } },
  recipient: o.order.np, parcel: { description: 'Осушувач', cost: 3500, weight: 12, seats: 1, length: 40, width: 30, height: 50 }, payer: 'Recipient', control: 3500,
};
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${ord.id}/ttn`, { ...body, parcel: { ...body.parcel, weight: 0 } })), /вагу/);
np.length = 0;
tg.length = 0;
const t = await req('POST', `/api/b2b/clients/${ord.id}/ttn`, body);
assert.equal(t.ttn, '20450000000001');
assert.deepEqual(np.map((x) => `${x.modelName}.${x.calledMethod}`), ['Counterparty.save', 'InternetDocument.save'], 'відділення — без Address.save');
const rec = np[0].methodProperties;
assert.deepEqual([rec.LastName, rec.FirstName, rec.MiddleName, rec.Phone, rec.CounterpartyType, rec.CounterpartyProperty], ['Шевченко', 'Тарас', 'Григорович', '380671234567', 'PrivatePerson', 'Recipient']);
const d = np[1].methodProperties;
assert.deepEqual([d.ServiceType, d.PayerType, d.PaymentMethod, d.CargoType, d.Weight, d.SeatsAmount, d.Cost, d.Description], ['WarehouseWarehouse', 'Recipient', 'Cash', 'Parcel', '12', '1', '3500', 'Осушувач']);
assert.deepEqual([d.Sender, d.ContactSender, d.SendersPhone, d.CitySender, d.SenderAddress], ['SENDER-1', 'CONTACT-1', '380671112233', 'CITY-KYIV', 'WH-1']);
assert.deepEqual([d.Recipient, d.ContactRecipient, d.RecipientsPhone, d.CityRecipient, d.RecipientAddress], ['REC-1', 'REC-CONTACT-1', '380671234567', 'CITY-KYIV', 'WH-1']);
assert.equal(d.AfterpaymentOnGoodsCost, '3500', 'контроль оплати');
assert.equal(d.InfoRegClientBarcodes, `B2B-${ord.id}`);
assert.match(d.DateTime, /^\d{2}\.\d{2}\.\d{4}$/);
assert.deepEqual(d.OptionsSeat, [{ volumetricVolume: '15', volumetricWidth: '30', volumetricLength: '40', volumetricHeight: '50', weight: '12' }]);
assert.ok(tg.some((m) => m.chat_id === '700' && /20450000000001/.test(m.text)), 'партнеру — ТТН у Telegram');
o = await req('GET', `/api/b2b/orders/${ord.id}`);
assert.equal(o.order.ttn, '20450000000001');
assert.equal(o.order.np_meta.cost, 85);
assert.deepEqual(o.missing, []);
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${ord.id}/ttn`, body)), /вже є ТТН/);
// партнер не змінює отримувача, коли ТТН уже є
assert.match(await errOf(() => req('PUT', `/api/b2b/p/clients/${ord.id}`, { items: [{ product_id: 11, qty: 1 }], np: { ...W, last: 'Франко' } }, A)), /видалити ТТН/);
await req('PUT', `/api/b2b/p/clients/${ord.id}`, { items: [{ product_id: 11, qty: 1 }], np: { ...W, cod: 3600 } }, A);
assert.equal((await db.get(`SELECT ttn FROM b2b_orders WHERE id = ?`, [ord.id])).ttn, '20450000000001', 'ТТН лишилась');
// налаштування відправника запам'ятовано
assert.equal(JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'b2b_np_sender'`)).value).warehouse.ref, 'WH-1');

// видалити ТТН
await req('DELETE', `/api/b2b/clients/${ord.id}/ttn`);
assert.equal((await db.get(`SELECT ttn, np_doc_ref FROM b2b_orders WHERE id = ?`, [ord.id])).ttn, '');
assert.equal(np.at(-1).calledMethod, 'delete');

// ---------- адресна доставка ----------
const doors = { ...W, type: 'doors', warehouse: null, street: { ref: 'ST-1', name: 'вул. Хрещатик' }, house: '10', flat: '5' };
const ord2 = await req('POST', '/api/b2b/p/clients', { items: [{ product_id: 11, qty: 1 }], np: doors }, A);
np.length = 0;
await req('POST', `/api/b2b/clients/${ord2.id}/ttn`, { ...body, recipient: doors, control: 0, payer: 'Sender' });
assert.deepEqual(np.map((x) => x.calledMethod), ['save', 'save', 'save']);
assert.deepEqual([np[1].modelName, np[1].methodProperties.StreetRef, np[1].methodProperties.BuildingNumber, np[1].methodProperties.Flat, np[1].methodProperties.CounterpartyRef], ['Address', 'ST-1', '10', '5', 'REC-1']);
const d2 = np[2].methodProperties;
assert.deepEqual([d2.ServiceType, d2.RecipientAddress, d2.PayerType, d2.PaymentMethod, d2.AfterpaymentOnGoodsCost], ['WarehouseDoors', 'ADDR-1', 'Sender', 'NonCash', undefined]);

// ---------- поштомат: розміри обов'язкові, до 20 кг ----------
const pm = { ...W, type: 'postomat', warehouse: { ref: 'PM-5', name: 'Поштомат №5005', number: '5005' } };
const ord3 = await req('POST', '/api/b2b/p/clients', { items: [{ product_id: 11, qty: 1 }], np: pm }, A);
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${ord3.id}/ttn`, { ...body, recipient: pm, parcel: { ...body.parcel, length: 0 } })), /розміри/);
assert.match(await errOf(() => req('POST', `/api/b2b/clients/${ord3.id}/ttn`, { ...body, recipient: pm, parcel: { ...body.parcel, weight: 25 } })), /20 кг/);

// ---------- права й партнер без опції ----------
assert.equal((await call('POST', `/api/b2b/clients/${ord3.id}/ttn`, body, A)).status, 403);
assert.equal((await call('GET', '/api/b2b/np/senders', null, A)).status, 403);
await req('PUT', `/api/b2b/partners/${pa.id}`, { name: 'Партнер А', ttn_by_us: false });
const plain = await req('POST', '/api/b2b/p/clients', { items: [{ product_id: 11, qty: 1 }], client_name: 'Іван Петренко', client_phone: '0501112233', np: W }, A);
assert.deepEqual((await req('GET', `/api/b2b/p/clients/${plain.id}`, null, A)).missing, ['маркування'], 'без опції — як раніше (маркування)');

console.log('OK — B2B: «ТТН створює Ековент» (отримувач НП, створення й видалення ТТН, контроль оплати)');
