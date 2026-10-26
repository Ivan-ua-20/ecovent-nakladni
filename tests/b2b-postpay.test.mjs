// Відстрочка оплати (постоплата) для партнера і заборгованість: за замовчуванням вимкнено, адмін задає дні й ліміт,
// строк = дата рахунку + дні, без попереджень «відвантаження без оплати», прострочення блокує нові, нагадування, борг у списку.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

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
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]); // Fan 9000, Fan 2 4500
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
await db.run(`UPDATE users SET tg_chat_id = '2' WHERE login = 'pa'`);
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);
const supply = (items, extra = {}) => req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items, ...extra }, A);
const pA = (b) => req('PUT', `/api/b2b/partners/${pa.id}`, { name: 'Партнер А', ...b });

// ---------- 1. За замовчуванням відстрочки немає ----------
let lim = await req('GET', '/api/b2b/p/limits', null, A);
assert.equal(lim.postpay.days, 0);
assert.match(await errOf(() => supply([{ product_id: 11, qty: 1 }], { pay_terms: 'postpay' })), /ще не відкрито/);

// ---------- 2. Адмін відкриває відстрочку: 14 днів, ліміт 30 000 ----------
await pA({ postpay_days: 14, postpay_limit: 30000 });
let pd = await req('GET', `/api/b2b/partners/${pa.id}`);
assert.deepEqual([pd.postpay.days, pd.postpay.limit, pd.postpay.used], [14, 30000, 0]);
assert.ok(await errOf(() => pA({ postpay_days: 500 })), 'понад 180 днів — помилка');
const s1 = await supply([{ product_id: 11, qty: 2 }], { pay_terms: 'postpay' }); // 18 000
let d = await req('GET', `/api/b2b/orders/${s1.id}`);
assert.deepEqual([d.order.pay_terms, d.order.pay_days, d.order.due_date], ['postpay', 14, ''], 'строк — після рахунку');
assert.ok(tg.some((m) => /ВІДСТРОЧКА 14 дн/.test(m.text)), 'адмінам видно умови в повідомленні про нову закупівлю');
lim = await req('GET', '/api/b2b/p/limits', null, A);
assert.equal(lim.unpaid.total, 0, 'відстрочка не займає ліміт неоплачених');
assert.equal(lim.postpay.used, 18000);
assert.match(await errOf(() => supply([{ product_id: 11, qty: 2 }], { pay_terms: 'postpay' })), /Ліміт відстрочки/, '18 000 + 18 000 > 30 000');
// передоплата — як раніше
const s2 = await supply([{ product_id: 12, qty: 1 }]); // 4500
assert.equal((await req('GET', `/api/b2b/orders/${s2.id}`)).order.pay_terms, 'prepay');

// ---------- 3. Рахунок → строк оплати = дата рахунку + 14 ----------
await req('PUT', `/api/b2b/orders/${s1.id}`, { invoice_no: 'СФ-1', invoice_date: day(0) });
d = await req('GET', `/api/b2b/orders/${s1.id}`);
assert.equal(d.order.status, 'pay_wait');
assert.equal(d.order.due_date, day(14));
await req('PUT', `/api/b2b/orders/${s2.id}`, { invoice_no: 'СФ-2', invoice_date: day(0) });
assert.equal((await req('GET', `/api/b2b/orders/${s2.id}`)).order.due_date, '', 'у передоплати строку немає');

// ---------- 4. Заборгованість: список партнерів і картка ----------
let list = await req('GET', '/api/b2b/partners');
let row = list.find((p) => p.id === pa.id);
assert.deepEqual([row.debt, row.debt_cnt, row.debt_overdue], [22500, 2, 0]);
pd = await req('GET', `/api/b2b/partners/${pa.id}`);
assert.equal(pd.debt.total, 22500);
assert.deepEqual(pd.debt.rows.map((r) => [r.id, r.due]).sort((a, b) => a[0] - b[0]), [[s1.id, 18000], [s2.id, 4500]]);
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).debt.total, 22500, 'партнер бачить, скільки до оплати');

// ---------- 5. Відвантаження без оплати — не для відстрочки ----------
const c1 = await req('POST', '/api/b2b/p/clients', { client_name: 'Клієнт 1', client_phone: '0501112233', items: [{ product_id: 11, qty: 1 }], supply_id: s1.id }, A);
tg.length = 0;
await req('PUT', `/api/b2b/clients/${c1.id}`, { crm_id: '777' });
assert.equal(tg.filter((m) => /Відвантаження без оплати/.test(m.text)).length, 0, 'відстрочка до строку — без попередження');

// ---------- 6. Нагадування і прострочення ----------
const cleanup = async () => { await db.run(`DELETE FROM settings WHERE key = 'cleanup_at'`); await req('GET', '/api/b2b/p/orders', null, A); };
await db.run(`UPDATE b2b_orders SET due_date = ? WHERE id = ?`, [day(1), s1.id]);
tg.length = 0;
await cleanup();
assert.ok(tg.some((m) => /Завтра строк оплати/.test(m.text) && String(m.chat_id) === '2'), 'партнеру — за день');
assert.ok(tg.some((m) => /Завтра строк оплати/.test(m.text) && String(m.chat_id) === '1'), 'адмінам — за день');
tg.length = 0;
await cleanup();
assert.equal(tg.filter((m) => /Завтра строк/.test(m.text)).length, 0, 'вдруге не нагадує');

await db.run(`UPDATE b2b_orders SET due_date = ? WHERE id = ?`, [day(-3), s1.id]);
tg.length = 0;
await cleanup();
assert.ok(tg.some((m) => /Прострочено оплату/.test(m.text) && /на 3 дн/.test(m.text)));
tg.length = 0;
await cleanup();
assert.equal(tg.filter((m) => /Прострочено/.test(m.text)).length, 0, 'повтор — через тиждень');
row = (await req('GET', '/api/b2b/partners')).find((p) => p.id === pa.id);
assert.equal(row.debt_overdue, 18000);
const po = (await req('GET', '/api/b2b/p/orders', null, A)).rows.find((o) => o.id === s1.id);
assert.equal(po.overdue, 3);
assert.match(po.status_name, /прострочено 3 дн/);
await pA({ postpay_limit: '' });
assert.match(await errOf(() => supply([{ product_id: 12, qty: 1 }], { pay_terms: 'postpay' })), /прострочена оплата/);
const c2 = await req('POST', '/api/b2b/p/clients', { client_name: 'Клієнт 2', client_phone: '0501112244', items: [{ product_id: 11, qty: 1 }], supply_id: s1.id }, A);
tg.length = 0;
await req('PUT', `/api/b2b/clients/${c2.id}`, { crm_id: '778' });
assert.ok(tg.some((m) => /Відвантаження без оплати/.test(m.text)), 'прострочена — знову попереджає');

// ---------- 7. Оплачено — борг зникає, відстрочка знову доступна ----------
await req('POST', `/api/b2b/orders/${s1.id}/status`, { status: 'paid' });
pd = await req('GET', `/api/b2b/partners/${pa.id}`);
assert.equal(pd.debt.total, 4500);
assert.equal(pd.postpay.overdue.length, 0);
const s3 = await supply([{ product_id: 12, qty: 1 }], { pay_terms: 'postpay' });
assert.equal((await req('GET', `/api/b2b/orders/${s3.id}`)).order.pay_terms, 'postpay');
// вимкнули відстрочку — нові лише з передоплатою
await pA({ postpay_days: 0 });
assert.match(await errOf(() => supply([{ product_id: 12, qty: 1 }], { pay_terms: 'postpay' })), /ще не відкрито/);

console.log('b2b-postpay: ok');
