// Маркетплейси → Розетка: оплата й адреса з кабінету (синхронізація з expand=payment, дозавантаження для активних),
// кілька замовлень одного покупця (дублі), скасування з причиною.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
await db.run(`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'Ековент', 'u', 'p', 'rztok', ?, 1, ?), (2, 'OneDay', 'u', 'p', 'rztok', ?, 1, ?)`, [now, now, now, now]);
const kyiv = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const ago = (h) => kyiv(Date.now() - h * 3600e3);

// Розетка: 3 замовлення одного покупця (два в «Ековенті», одне в OneDay), одне — оплачене Google Pay; інший покупець — одне.
const order = (id, h, extra = {}) => ({
  id, created: ago(h), changed: ago(h), status: 1, status_group: 1, status_data: { name_uk: 'Нове замовлення' }, cost: '4950.00',
  user_phone: '380671112233', user_title: { full_name: 'Ткач Наталія' }, ttn: '', comment: 'Після 18:00',
  delivery: { delivery_service_name: 'ROZETKA Delivery', city: { title: 'Київ' }, place_number: '45247 (АТБ)', recipient_phone: '380671112233' },
  purchases: [{ item_id: 7, item_name: 'Осушувач', quantity: 1, price: '4950.00' }],
  payment: { payment_type_title: 'Оплата під час отримання', payment_status: null }, ...extra,
});
const SHOP1 = [
  order(9001, 2, { payment: { payment_type_title: 'Google Pay', payment_status: { title: 'Оплачено' } } }),
  order(9002, 1),
  order(9010, 3, { user_phone: '380509998877', user_title: { full_name: 'Мельник Сергій' }, delivery: { delivery_service_name: 'Нова Пошта', city: { title: 'Львів' }, place_street: 'Городоцька', place_house: '12', place_flat: '5' } }),
];
const SHOP2 = [order(9003, 5, { duplicate_order_id: 9002 })];
const calls = [];
let noPaymentExpand = false;
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.host !== 'api-seller.rozetka.com.ua') throw new Error(`неочікуваний запит ${url}`);
  const auth = opts.headers?.Authorization;
  calls.push([opts.method || 'GET', u.pathname, u.searchParams.get('expand')]);
  if (u.pathname === '/orders/search') {
    if (noPaymentExpand && /payment/.test(u.searchParams.get('expand'))) return new Response(JSON.stringify({ success: false, errors: { message: 'invalid expand', code: 1 } }));
    const list = (calls.filter((c) => c[1] === '/orders/search').length % 2 ? SHOP1 : SHOP2);
    return new Response(JSON.stringify({ success: true, content: { orders: u.searchParams.get('page') === '1' ? list : [], _meta: { pageCount: 1 } } }));
  }
  const m = u.pathname.match(/^\/orders\/(\d+)$/);
  if (m && (opts.method || 'GET') === 'GET') {
    const o = [...SHOP1, ...SHOP2].find((x) => String(x.id) === m[1]);
    return new Response(JSON.stringify(o ? { success: true, content: o } : { success: false, errors: { message: 'entity_not_found' } }));
  }
  if (m && opts.method === 'PUT') {
    assert.equal(auth, 'Bearer rztok');
    return new Response(JSON.stringify({ success: true, content: {} }));
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

// ---------- синхронізація: оплата, адреса, коментар, позначка дубля ----------
await req('POST', '/api/mp/sync', { mp: 'rozetka', account: 1 });
await req('POST', '/api/mp/sync', { mp: 'rozetka', account: 2 });
assert.ok(calls.some((c) => c[1] === '/orders/search' && /payment/.test(c[2])), 'синхронізація просить оплату');
const row = async (id) => db.get(`SELECT * FROM mp_orders WHERE id = ?`, [String(id)]);
let r1 = await row(9001);
assert.equal(r1.pay_type, 'Google Pay');
assert.equal(r1.pay_status, 'Оплачено');
assert.equal(r1.paid, 1);
assert.equal(r1.pay_known, 1);
assert.equal(r1.address, 'Київ, № 45247 (АТБ)');
assert.equal(r1.comment, 'Після 18:00');
assert.equal((await row(9002)).paid, 0);
assert.equal((await row(9010)).address, 'Львів, Городоцька, 12, кв. 5');
assert.equal((await row(9003)).dup_of, '9002');

// ---------- список: дублі (кілька замовлень одного покупця) ----------
const list = (await req('GET', '/api/mp/orders?mp=rozetka')).j;
assert.equal(list.groups.dups, 3, 'три активні замовлення одного покупця');
const by = Object.fromEntries(list.rows.map((x) => [x.id, x]));
assert.deepEqual(by['9001'].dups.map((x) => x.id).sort(), ['9002', '9003'], 'дублі з обох магазинів');
assert.equal(by['9001'].dups.find((x) => x.id === '9002').paid, 0);
assert.equal(by['9001'].dups[0].grp, 'new');
assert.deepEqual(by['9010'].dups, []);
assert.deepEqual((await req('GET', '/api/mp/orders?mp=rozetka&grp=dups')).j.rows.map((x) => x.id).sort(), ['9001', '9002', '9003']);
// обмежений доступ до магазинів — дублі лише з дозволених
await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' });
await db.run(`UPDATE users SET access = ? WHERE login = 'man'`, [JSON.stringify({ b2b: 'none', retail: 'work', market: 'work', returns: 'view', shops: ['rozetka:1'], tg: [] })]);
const lm = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const M = { 'Content-Type': 'application/json', Cookie: lm.headers.get('set-cookie').split(';')[0] };
const ml = (await req('GET', '/api/mp/orders?mp=rozetka', null, M)).j;
assert.deepEqual(ml.rows.find((x) => x.id === '9001').dups.map((x) => x.id), ['9002'], 'чужий магазин не показується');

// ---------- скасування з причиною ----------
let r = await req('POST', '/api/mp/rz/cancel', { account: 1, id: '9002', status: 6 });
assert.equal(r.status, 400, 'не причина скасування');
r = await req('POST', '/api/mp/rz/cancel', { account: 1, id: '9002', status: 31 });
assert.equal(r.status, 200);
assert.deepEqual(calls.at(-1), ['PUT', '/orders/9002', null]);
const r2 = await row(9002);
assert.equal(r2.status, '31');
assert.equal(r2.status_group, 3);
r = await req('POST', '/api/mp/rz/cancel', { account: 1, id: '9002', status: 31 });
assert.equal(r.status, 400, 'уже скасоване');
assert.equal((await req('POST', '/api/mp/rz/cancel', { account: 2, id: '9003', status: 31 }, M)).status, 403, 'чужий магазин');
assert.equal((await req('GET', '/api/mp/orders?mp=rozetka', null, H)).j.groups.dups, 2);

// ---------- Розетка не приймає expand=payment — синхронізація все одно працює ----------
noPaymentExpand = true;
await db.run(`UPDATE mp_sync SET cursor = '', synced_at = '' WHERE mp = 'rozetka'`);
r = await req('POST', '/api/mp/sync', { mp: 'rozetka', account: 1 });
assert.equal(r.status, 200);
assert.equal((await row(9001)).pay_status, 'Оплачено', 'без оплати у відповіді — збережена не стирається');
noPaymentExpand = false;

// ---------- дозавантаження оплати для активних, збережених раніше ----------
await db.run(`UPDATE mp_orders SET pay_known = 0, pay_type = '', pay_status = '', paid = 0 WHERE id IN ('9001', '9010')`);
await db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, status_group) VALUES ('rozetka', 1, '9999', '9999', ?, ?, '1', 'Нове', 'Х', '380630000000', 1, '[]', 1)`, [ago(1), ago(1)]);
const { key: cronKey } = (await req('POST', '/api/jobs/key')).j;
const cr = (await req('POST', '/api/cron/run/market-pay', null, { 'X-Cron-Key': cronKey })).j;
assert.equal(cr.ok, true);
assert.equal((await row(9001)).pay_status, 'Оплачено');
assert.equal((await row(9010)).pay_known, 1);
assert.equal((await row(9999)).pay_known, 1, 'не знайдене в Розетці більше не питаємо');
assert.deepEqual((await req('POST', '/api/cron/run/market-pay', null, { 'X-Cron-Key': cronKey })).j.result, { done: true });

console.log('OK — маркетплейси: оплата й адреса з Розетки, дублі покупців, скасування з причиною');
