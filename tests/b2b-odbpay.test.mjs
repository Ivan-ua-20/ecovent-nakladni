// Оплата закупівель B2B з Opendatabot: автоматично (код платника = код юрособи, № рахунку в призначенні — уточнення),
// часткова оплата із залишком, «перевірити», ручне зарахування / відв'язування, зняття оплати адміном.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { purposeHasNo } from '../src/modules/b2b/odbpay.js';

assert.ok(purposeHasNo('Оплата за рах. № СФ-000102 від 24.10', 'СФ-102'));
assert.ok(!purposeHasNo('Оплата за рах. 1020', 'СФ-102'));
assert.ok(!purposeHasNo('Оплата', ''));

const KEY = 'odb-secret';
const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  ...[['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_hook_v', '2']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]),
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901)`, []],
]);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '10000.00', 12: '5000.00' }[id] })) }));
};
const app = createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await app.request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

await req('PUT', '/api/settings', { odb_key: KEY, odb_name: 'ecovent' });
const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]); // Fan 9000, Fan 2 4500
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);
const supply = async (items, no) => {
  const s = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items }, A);
  await req('PUT', `/api/b2b/orders/${s.id}`, { invoice_no: no });
  return s.id;
};
const s1 = await supply([{ product_id: 11, qty: 2 }], 'СФ-101'); // 18 000
const s2 = await supply([{ product_id: 12, qty: 1 }], 'СФ-102'); // 4 500
const order = async (id) => (await req('GET', `/api/b2b/orders/${id}`)).order;
assert.equal((await order(s1)).status, 'pay_wait');

let n = 0;
const hook = async ({ amount, purpose = 'Оплата за товар', code = '1234567890', payer = 'ФОП АЛЬФА' }) => {
  n++;
  const body = JSON.stringify({
    transactionId: `t${n}`, autoclientConfigId: 'cfg1', possibleInvoices: [],
    transaction: { date: `2026-10-24T1${n % 10}:00:00.000Z`, amount, currency: 'UAH', purpose, iban: 'UA213223130000026007233566001', edrpou: '2882618253', counterpartyName: payer, counterpartyEdrpou: code, counterpartyAcc: `UA00${n}`, transactionType: 'credit' },
  });
  const r = await app.request('/api/odb/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', Signature: createHmac('sha256', KEY).update(body).digest('hex') }, body });
  assert.equal(r.status, 200);
  return body;
};

// ---------- 1. Точний збіг за № рахунку → «Оплачено» ----------
tg.length = 0;
await hook({ amount: 4500, purpose: 'Оплата за рах. № СФ-102 від 24.10.2026, у т.ч. ПДВ' });
let o = await order(s2);
assert.deepEqual([o.status, o.paid_amount, o.paid_by], ['paid', 4500, 'Opendatabot']);
assert.ok(tg.some((m) => /Оплату отримано/.test(m.text)), 'партнеру');
assert.ok(tg.some((m) => String(m.chat_id) === '1' && /Оплачено/.test(m.text)), 'адмінам');
assert.equal((await order(s1)).status, 'pay_wait', 'інша закупівля не зачеплена');

// ---------- 2. Часткова оплата: залишок у статусі ----------
tg.length = 0;
const bodyB = await hook({ amount: 10000 });
o = await order(s1);
assert.deepEqual([o.status, o.paid_amount, o.due], ['partial', 10000, 8000]);
assert.match(o.status_name, /Частково оплачено · ще 8.000,00 грн/);
assert.ok(tg.some((m) => /Ще до оплати: 8.000,00/.test(m.text)), 'партнеру — скільки ще оплатити');
const pOrder = (await req('GET', `/api/b2b/p/orders/${s1}`, null, A)).order;
assert.match(pOrder.status_name, /ще 8.000,00/, 'партнер теж бачить залишок');
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).unpaid.total, 8000, 'у ліміт неоплачених — лише залишок');
// той самий платіж ще раз — не рахується двічі
await app.request('/api/odb/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', Signature: createHmac('sha256', KEY).update(bodyB).digest('hex') }, body: bodyB });
assert.equal((await order(s1)).paid_amount, 10000);

// ---------- 3. Сума більша за залишок → «перевірити», нічого не змінюється ----------
tg.length = 0;
await hook({ amount: 9000 });
assert.equal((await order(s1)).paid_amount, 10000);
assert.ok(tg.some((m) => /Платіж за B2B — перевірте/.test(m.text)));
let pays = await req('GET', '/api/odb/payments');
const checkRow = pays.rows.find((r) => r.amount === 9000);
assert.equal(checkRow.b2b.check, true);
assert.deepEqual(checkRow.b2b.candidates, [s1]);
assert.equal(pays.rows.find((r) => r.amount === 10000).b2b.number, `B2B-${s1}`, '«Платежі»: у яку закупівлю зараховано');
// чужий платник — не B2B
await hook({ amount: 500, code: '37193071', payer: 'ТОВ ІНША' });
assert.equal((await req('GET', '/api/odb/payments')).rows.find((r) => r.amount === 500).b2b, undefined);

// ---------- 4. Адмін: зарахувати / відв'язати / зняти оплату ----------
let p = await req('GET', `/api/b2b/orders/${s1}/payments`);
assert.equal(p.linked.length, 1);
assert.equal(p.due, 8000);
assert.ok(p.possible.some((t) => t.amount === 9000), 'платіж «перевірити» — серед можливих');
assert.ok(!p.possible.some((t) => t.amount === 500), 'чужий платник — ні');
assert.equal((await errOf(() => req('GET', `/api/b2b/orders/${s1}/payments`, null, A))) !== '', true, 'партнер — ні');
await req('POST', `/api/b2b/orders/${s1}/payments`, { tx_id: p.possible.find((t) => t.amount === 9000).tx_id });
o = await order(s1);
assert.deepEqual([o.status, o.paid_amount], ['paid', 19000], 'зараховано вручну → «Оплачено»');
const txD = (await req('GET', `/api/b2b/orders/${s1}/payments`)).linked.find((t) => t.amount === 9000).tx_id;
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${s2}/payments`, { tx_id: txD })), /уже зараховано/);
await req('DELETE', `/api/b2b/orders/${s1}/payments/${encodeURIComponent(txD)}`);
o = await order(s1);
assert.deepEqual([o.status, o.paid_amount], ['partial', 10000], 'відв’язано — знову частково');
// «Зняти часткову оплату»
await req('POST', `/api/b2b/orders/${s1}/status`, { status: 'pay_wait' });
o = await order(s1);
assert.deepEqual([o.status, o.paid_amount, o.paid_by], ['pay_wait', 0, '']);
assert.equal((await req('GET', `/api/b2b/orders/${s1}/payments`)).linked.length, 0);
// Opendatabot помилився, але закупівля оплачена — «Оплачено (вручну)», нові платежі вже не чіпають її
await req('POST', `/api/b2b/orders/${s1}/status`, { status: 'paid' });
await hook({ amount: 100, purpose: 'СФ-101' });
o = await order(s1);
assert.deepEqual([o.status, o.paid_amount], ['paid', 18000]);
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${s1}/payments`, { tx_id: txD })), /вручну/);

// ---------- 5. Кілька закупівель з однаковим залишком без № → «перевірити» з кандидатами ----------
const s3 = await supply([{ product_id: 12, qty: 1 }], 'СФ-103');
const s4 = await supply([{ product_id: 12, qty: 1 }], 'СФ-104');
await hook({ amount: 4500 });
assert.deepEqual([(await order(s3)).status, (await order(s4)).status], ['pay_wait', 'pay_wait']);
const amb = (await req('GET', '/api/odb/payments')).rows.find((r) => r.b2b?.check && r.amount === 4500);
assert.deepEqual(amb.b2b.candidates, [s3, s4]);
// з № рахунку — однозначно
await hook({ amount: 4500, purpose: 'рах 104' });
assert.equal((await order(s4)).status, 'paid');

console.log('OK — B2B: оплата закупівель з Opendatabot (авто, частково, перевірити, вручну)');
