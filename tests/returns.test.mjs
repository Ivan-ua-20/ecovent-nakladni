// Повернення: реєстр відправлень з усіх джерел без дублів, відмова → ЕН повернення («на основі» або від Розетки),
// стани (немає ЕН / в дорозі / у відділенні / отримано), цикл частинами, новий кабінет НП, доступ.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const raw = openDb(':memory:');
await migrate(raw);
const db = raw;
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
const dayAgo = (n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

// Кабінети НП: документи за днями; відстеження.
const DOCS = { k1: { [dayAgo(10)]: [['20450000000001', '501112233', 'Петренко Іван'], ['20450000000002', '671234567', 'Коваль Ольга'], ['20450000000003', '931112233', 'Шевчук'], ['20450000000004', '501231231', 'Шевченко Марія'], ['20450000000005', '501231299', 'Лисенко Петро']] }, k2: { [dayAgo(20)]: [['20450000000009', '661112233', 'Бондар']] } };
const TRACK = {
  20450000000001: { StatusCode: '103', Status: 'Відмова одержувача', LastCreatedOnTheBasisNumber: '20450000000101', LastCreatedOnTheBasisDocumentType: 'Return', CargoDescriptionString: 'Осушувач Dryora 10', AnnouncedPrice: '7058' },
  20450000000101: { StatusCode: '7', Status: 'Прибув у відділення', CityRecipient: 'Київ', WarehouseRecipient: 'Відділення №25', ActualDeliveryDate: `${dayAgo(6)} 12:10:00`, DatePayedKeeping: `${dayAgo(1)} 00:00:00`, DateCreated: `${dayAgo(9)} 10:00:00`, RecipientFullName: 'Нестерюк Іван', PhoneRecipient: '380971112233' },
  20450000000002: { StatusCode: '9', Status: 'Відправлення отримано' },
  20450000000003: { StatusCode: '102', Status: 'Відмова від отримання' }, // ЕН повернення ще немає
  20450000000009: { StatusCode: '105', Status: 'Припинено зберігання', LastCreatedOnTheBasisNumber: '20450000000109' },
  20450000000109: { StatusCode: '9', Status: 'Відправлення отримано', RecipientDateTime: `${dayAgo(3).split('-').reverse().join('.')} 15:20:00` },
  20400000000777: { StatusCode: '102', Status: 'Відмова від отримання' }, // Розетка-постачальник: ЕН повернення дала сама Розетка
  20450000000004: { StatusCode: '9', Status: 'Відправлення отримано', LastCreatedOnTheBasisNumber: '20450000000104', LastCreatedOnTheBasisDocumentType: 'CargoReturn' }, // клієнт повернув через НП
  20450000000104: { StatusCode: '6', Status: 'У місті одержувача', DateCreated: `${dayAgo(1).split('-').reverse().join('-')} 09:00:00` },
  20450000000005: { StatusCode: '106', Status: 'Одержано і створено ЄН зворотньої доставки', LastCreatedOnTheBasisNumber: '20450000000105', LastCreatedOnTheBasisDocumentType: 'BackwardDelivery' }, // гроші — не повернення
  20459999990002: { StatusCode: '7', Status: 'Прибув у відділення', ActualDeliveryDate: `${dayAgo(1)} 10:00:00`, WarehouseRecipient: 'Відділення №25' },
  59000000000777: { StatusCode: '5', Status: 'Прямує до відділення', DateCreated: `${dayAgo(2).split('-').reverse().join('-')} 09:00:00` }, // формат відстеження НП: «дд-мм-рррр»
};
let npCalls = 0;
let tooMany = 0;
const fetchFn = async (url, opts = {}) => {
  const b = JSON.parse(opts.body || '{}');
  if (!String(url).includes('novaposhta')) return new Response('{"ok":true,"result":{}}');
  npCalls++;
  if (tooMany > 0) { tooMany--; return new Response(JSON.stringify({ success: false, errors: ['To many requests'] })); }
  if (b.calledMethod === 'getDocumentList') {
    const day = b.methodProperties.DateTimeFrom.split('.').reverse().join('-');
    const list = (DOCS[b.apiKey]?.[day] || []).map(([n, p, r]) => ({ IntDocNumber: n, RecipientsPhone: `380${p}`, RecipientContactPerson: r }));
    return new Response(JSON.stringify({ success: true, data: b.methodProperties.Page === '1' ? list : [] }));
  }
  if (b.calledMethod === 'getStatusDocuments') {
    assert.ok(b.methodProperties.Documents.length <= 100);
    return new Response(JSON.stringify({ success: true, data: b.methodProperties.Documents.map((d) => ({ Number: d.DocumentNumber, ...(TRACK[d.DocumentNumber] || { StatusCode: '5', Status: 'Прямує' }) })) }));
  }
  if (b.calledMethod === 'getCounterparties') return new Response(JSON.stringify({ success: true, data: [{ Description: 'ФОП', Ref: `ref-${b.apiKey}`, EDRPOU: '3012345678' }] }));
  if (b.calledMethod === 'getCounterpartyContactPersons') return new Response(JSON.stringify({ success: true, data: [{ Description: 'Нестерюк Іван', Phones: '380971112233' }, { Description: 'Склад Ековент', Phones: '380441112233' }] }));
  if (b.calledMethod === 'getIncomingDocumentsByPhone') {
    // Вхідні: повернення від клієнтки (Коваль Ольга, отримала 0002), посилка постачальника, службове «плече» НП.
    const rows = b.apiKey === 'k1' && b.methodProperties.Page === '1' ? [
      { Number: '20459999990002', TrackingStatusCode: '7', TrackingStatusName: 'Прибув у відділення', SenderName: 'Коваль Ольга Петрівна', CounterpartySenderDescription: 'Приватна особа', CargoDescription: 'Зволожувач', ArrivalDateTime: `${dayAgo(1)} 10:00:00`, OwnerDocumentType: '' },
      { Number: '20459999990003', TrackingStatusCode: '5', SenderName: 'Іваненко Степан', CounterpartySenderDescription: 'ТОВ Постачальник', OwnerDocumentType: '' },
      { Number: '20450000000101', TrackingStatusCode: '7', SenderName: 'Петренко Іван', OwnerDocumentType: 'CargoReturn' },
    ] : [];
    return new Response(JSON.stringify({ success: true, data: [{ result: rows }] }));
  }
  throw new Error('NP ' + b.calledMethod);
};
const mk = () => createApp({ db, fetchFn, maxSubrequests: 40 });
const call = async (m, path, body, cookie) => {
  const r = await mk().request(path, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})), r };
};
const H = (await call('POST', '/api/auth/setup', { login: 'o', password: 'secret123' })).r.headers.get('set-cookie').split(';')[0];

// Без кабінетів — пояснення, без запитів.
assert.match((await call('POST', '/api/returns/refresh', { start: true }, H)).j.skipped, /кабінетів/);
assert.equal(npCalls, 0);

await db.run(`INSERT INTO np_accounts (id, name, api_key, sender_name, active, created_at) VALUES (1, 'Основний', 'k1', 'ФОП Нестерюк І.', 1, '')`);
// Та сама ТТН — і в кабінеті, і в маркетплейсі (Prom), і в LP-CRM: одне повернення.
await db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, customer, phone, ttn) VALUES ('prom', 1, 'p1', '318845220', ?, 'Петренко Іван', '380501112233', '2045 0000 000001')`, [`${dayAgo(10)} 10:00`]);
await db.run(`INSERT INTO an_orders (id, code, day, status, ttn) VALUES (71204, 'c1', ?, 1, '20450000000001')`, [dayAgo(10)]);
// Розетка-постачальник (ТТН не з нашого кабінету): returnTtn від Розетки.
await db.run(`INSERT INTO rzs_accounts (id, name, token) VALUES (1, 'Розетка', 't')`);
await db.run(`INSERT INTO rzs_orders (id, account_id, order_num, status, created_at, customer, phone, ttn, return_ttn) VALUES ('r1', 1, 'РОЗ1', 'delivery_refused', ?, 'Ткаченко', '380661234567', '20400000000777', '59000000000777')`, [`${dayAgo(8)} 10:00:00`]);

// Дві Розетка-посилки з однією ЕН повернення (одна зворотна на обидві) — одне повернення, без помилки унікальності.
await db.run(`INSERT INTO rzs_orders (id, account_id, order_num, status, created_at, customer, phone, ttn, return_ttn) VALUES ('r2', 1, 'РОЗ2', 'delivery_refused', ?, 'Ткаченко', '380661234567', '20400000000778', '59000000000777')`, [`${dayAgo(8)} 11:00:00`]);
TRACK['20400000000778'] = { StatusCode: '102', Status: 'Відмова від отримання' };
// Маркетплейси: Розетка Делівері (відмова — нещодавно і давно), Розетка «Замовлення повернено» з ТТН НП, Епіцентр — запит на повернення.
await db.run(`INSERT INTO rz_accounts (id, name, username, password) VALUES (1, 'Ековент на Розетці', 'u', 'p')`);
await db.run(`INSERT INTO epc_accounts (id, name, token) VALUES (1, 'Епіцентр Ековент', 't')`).catch(() => db.run(`INSERT INTO epc_accounts (id, name) VALUES (1, 'Епіцентр Ековент')`));
for (const [mp, id, ttn, status, name, changed] of [['rozetka', 'z1', 'RMP-111111111', '12', 'Відмова при отриманні', dayAgo(3)], ['rozetka', 'z2', 'RMP-222222222', '11', 'Не прийшов за замовленням', dayAgo(30)],
  ['rozetka', 'z3', '20450000000006', '19', 'Замовлення повернено', dayAgo(2)], ['epc', 'e1', '723-0000001', 'return_requested', 'Запит на повернення', dayAgo(1)], ['rozetka', 'z4', 'RMP-333333333', '6', 'Замовлення виконано', dayAgo(2)]]) {
  await db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, ttn, items) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'Покупець', '380630001122', 2999, ?, ?)`,
    [mp, id, id, `${dayAgo(40)} 10:00:00`, `${changed} 12:00:00`, status, name, ttn, JSON.stringify([{ name: 'Осушувач HUMIX 300', qty: 1 }])]);
}
// Цикл частинами: сторінка повторює, доки не done.
let st;
let n = 0;
// «To many requests» від НП — не помилка: крок зупиняється, далі продовжуємо.
tooMany = 1;
st = (await call('POST', '/api/returns/refresh', { start: true }, H)).j;
assert.ok(st.wait && !st.error && !st.done && st.pause_until, 'НП просить зачекати — пауза 10 хв, без помилки');
await db.run(`UPDATE settings SET value = json_set(value, '$.pause_until', '') WHERE key = 'ret_cycle'`);
n = 1;
do { st = (await call('POST', '/api/returns/refresh', { start: n === 0 }, H)).j; n++; } while (!st.done && n < 20);
assert.ok(st.done && n > 1, 'цикл завершився за кілька кроків (дні кабінету читаються частинами)');

let l = (await call('GET', '/api/returns', null, H)).j;
const by = Object.fromEntries(l.rows.map((r) => [r.orig_ttn, r]));
assert.equal(l.rows.length, 9, 'відмова з ЕН, без ЕН, Розетка-постачальник, 2 від клієнтів (вхідна і «на основі»), 2 Розетка Делівері, Розетка «повернено», Епіцентр');
// Повернення від клієнтки: вхідна посилка, збіг за прізвищем та ім'ям; постачальник і службове «плече» — ні.
const c2 = by['20450000000002'];
assert.deepEqual([c2.ret_ttn, c2.reason, c2.state, c2.carrier, c2.customer, c2.to], ['20459999990002', 'customer', 'branch', 'np', 'Коваль Ольга', 'ФОП Нестерюк І.']);
assert.ok(!l.rows.some((r) => r.ret_ttn === '20459999990003'), 'посилка постачальника — не повернення');
const c4 = by['20450000000004'];
assert.deepEqual([c4.ret_ttn, c4.reason, c4.state], ['20450000000104', 'customer', 'transit'], 'клієнт повернув через НП («на основі», CargoReturn)');
assert.ok(!by['20450000000005'], 'зворотна доставка грошей — не повернення');
// Розетка Делівері: свіжа відмова — повертається; давня (30 дн) — ймовірно повернулась; виконане — ні.
assert.deepEqual([by['RMP-111111111'].carrier, by['RMP-111111111'].state, by['RMP-111111111'].reason, by['RMP-111111111'].to, by['RMP-111111111'].orders[0].src], ['rd', 'transit', 'refused', 'Ековент на Розетці', 'rozetka']);
assert.deepEqual([by['RMP-222222222'].state, by['RMP-222222222'].reason], ['got', 'storage']);
assert.ok(!by['RMP-333333333']);
assert.deepEqual([by['20450000000006'].reason, by['20450000000006'].state, by['20450000000006'].carrier], ['customer', 'nottn', 'np'], 'Розетка: замовлення повернено (ТТН НП) — шукаємо ЕН повернення');
assert.deepEqual([by['723-0000001'].carrier, by['723-0000001'].reason, by['723-0000001'].to], ['mp', 'customer', 'Епіцентр Ековент']);
// Щоб забрати: ЄДРПОУ, на кого приходять (з ЕН), контакти кабінету, відділення.
const pk = l.pickup.find((p) => p.id === 1);
assert.equal(pk.code, '3012345678');
assert.deepEqual(pk.persons.map((x) => [x.name, x.phone, !!x.contact]), [['Нестерюк Іван', '971112233', false], ['Склад Ековент', '441112233', true]]);
assert.equal(pk.branch, 2);
assert.ok(pk.warehouses.some((w) => w.w === 'Київ, Відділення №25'));
const a = by['20450000000001'];
assert.deepEqual([a.ret_ttn, a.state, a.reason, a.warehouse, a.to, a.to_name, a.to_phone, a.branch_days, a.overdue], ['20450000000101', 'branch', 'refused', 'Відділення №25', 'ФОП Нестерюк І.', 'Нестерюк Іван', '380971112233', 6, true], 'на кого: кабінет (ФОП), людина, телефон');
assert.deepEqual(a.orders.map((o) => o.src), ['prom', 'crm'], 'звідки: Prom і LP-CRM — без дублю');
assert.equal(a.cargo, 'Осушувач Dryora 10');
assert.equal(a.paid_from.slice(0, 10), dayAgo(1));
assert.equal(by['20450000000003'].state, 'nottn');
const rz = by['20400000000777'];
assert.deepEqual([rz.ret_ttn, rz.state, rz.orders[0].src, rz.customer], ['59000000000777', 'transit', 'rzs', 'Ткаченко']);
assert.equal(rz.refused_at.slice(0, 10), dayAgo(2), 'відлік — від створення ЕН повернення');

// Повторний цикл одразу — не запускається (12 год), кнопка після щойно завершеного — теж не дублює.
const before = npCalls;
await call('POST', '/api/returns/refresh', {}, H);
assert.equal(npCalls, before);

// Новий кабінет НП → цикл одразу, його повернення (у т.ч. вже отримане) підтягуються.
await db.run(`INSERT INTO np_accounts (id, name, api_key, active, created_at) VALUES (2, 'Другий', 'k2', 1, '')`);
n = 0;
do { st = (await call('POST', '/api/returns/refresh', {}, H)).j; n++; } while (!st.done && n < 20);
l = (await call('GET', '/api/returns', null, H)).j;
const b2 = l.rows.find((r) => r.orig_ttn === '20450000000009');
assert.deepEqual([b2.state, b2.reason, b2.ret_ttn, b2.got_at.slice(0, 10)], ['got', 'storage', '20450000000109', dayAgo(3)]);
assert.equal(l.rows.length, 10);

// Отримане більше не відстежуємо; ЕН повернення унікальні.
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM ret_items`)).n, 10);
// Розетка: замовлення вийшло зі статусу повернення — зникає зі списку.
await db.run(`UPDATE mp_orders SET status = '6' WHERE id = 'z1'`);
await db.run(`UPDATE settings SET value = json_set(value, '$.started', '2000-01-01T00:00:00Z') WHERE key = 'ret_cycle'`);
n = 0;
do { st = (await call('POST', '/api/returns/refresh', {}, H)).j; n++; } while (!st.done && n < 20);
assert.ok(!(await call('GET', '/api/returns', null, H)).j.rows.some((r) => r.orig_ttn === 'RMP-111111111'));
assert.equal((await db.get(`SELECT final FROM ret_ships WHERE ttn = '20450000000005'`)).final, 0, 'отримане клієнтом ще 30 днів стежимо — раптом поверне');

// Доступ: менеджер за замовчуванням бачить; з «Повернення: немає» — ні; партнер — ні.
await call('POST', '/api/users', { login: 'm1', password: 'pass1234', role: 'manager' }, H);
const M = (await call('POST', '/api/auth/login', { login: 'm1', password: 'pass1234' })).r.headers.get('set-cookie').split(';')[0];
assert.equal((await call('GET', '/api/returns', null, M)).status, 200);
assert.equal((await call('POST', '/api/returns/refresh', {}, M)).status, 200, 'оновити може кожен, хто бачить');
const m1 = (await call('GET', '/api/users', null, H)).j.users.find((u) => u.login === 'm1');
await call('PUT', `/api/users/${m1.id}`, { access: { b2b: 'none', retail: 'none', market: 'none', returns: 'view', shops: null, tg: [] } }, H);
const M2 = (await call('POST', '/api/auth/login', { login: 'm1', password: 'pass1234' })).r.headers.get('set-cookie').split(';')[0];
assert.equal((await call('GET', '/api/returns', null, M2)).status, 200, 'менеджер лише з «Поверненнями»');
assert.equal((await call('GET', '/api/rzs/orders', null, M2)).status, 403);
await call('PUT', `/api/users/${m1.id}`, { access: { b2b: 'none', retail: 'none', market: 'none', returns: 'none', shops: null, tg: [] } }, H);
const M3 = (await call('POST', '/api/auth/login', { login: 'm1', password: 'pass1234' })).r.headers.get('set-cookie').split(';')[0];
assert.equal((await call('GET', '/api/returns', null, M3)).status, 403);

console.log('OK — Повернення');
