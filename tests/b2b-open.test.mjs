// Відкрита закупівля (замовлення клієнтів без закупівлі), ліміти партнера (20 000 / 100 000 типово), «Сформувати рахунок»,
// «в процесі оплати», сповіщення адмінам про відвантаження без оплати, дані клієнта з маркування НП.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { miniPdf, npLabel } from './helpers/mini-pdf.mjs';

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

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]); // Fan 9000, Fan 2 4500
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);
const cl = (name, items, extra = {}) => req('POST', '/api/b2b/p/clients', { client_name: name, client_phone: '0501112233', items, ...extra }, A);

// ---------- 1. Без закупівлі → відкрита закупівля, ліміт 20 000 ----------
let lim = await req('GET', '/api/b2b/p/limits', null, A);
assert.deepEqual([lim.open.id, lim.open.limit, lim.unpaid.limit], [null, 20000, 100000], 'типові ліміти');
const c1 = await cl('Клієнт 1', [{ product_id: 11, qty: 1 }]); // 9000
lim = await req('GET', '/api/b2b/p/limits', null, A);
const open1 = lim.open.id;
assert.ok(open1, 'відкрита закупівля створилась сама');
assert.deepEqual([lim.open.total, lim.open.orders, lim.unpaid.total], [9000, 1, 9000]);
let d = await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A);
assert.equal(d.order.supply_id, open1);
assert.equal(d.order.no_supply, true, 'підсвічується як «без закупівлі»');
assert.equal(d.order.pay_name, 'В процесі оплати');
assert.ok(tg.some((m) => /у відкриту закупівлю/.test(m.text)), 'адмінам — нове замовлення з позначкою');
assert.match(await errOf(() => cl('Клієнт 2', [{ product_id: 11, qty: 1 }, { product_id: 12, qty: 1 }])), /перевищить ліміт/, '9000 + 13 500 > 20 000');
assert.ok(!(await req('GET', '/api/b2b/p/supplies', null, A)).some((s) => s.id === open1), 'відкрита закупівля не пропонується як джерело');
assert.match(await errOf(() => cl('Клієнт 2', [{ product_id: 11, qty: 1 }], { supply_id: open1 })), /Без закупівлі/);

// ---------- 2. Ліміти партнера задає адмін ----------
const pA = (b) => req('PUT', `/api/b2b/partners/${pa.id}`, { name: 'Партнер А', ...b });
await pA({ open_limit: 30000 });
assert.equal((await req('GET', `/api/b2b/partners/${pa.id}`)).limits.open, 30000);
assert.equal(await errOf(() => pA({ open_limit: 'abc' })) !== '', true, 'не сума — помилка');
assert.equal((await req('GET', `/api/b2b/partners/${pa.id}`)).limits.open, 30000);
const c2 = await cl('Клієнт 2', [{ product_id: 11, qty: 1 }, { product_id: 12, qty: 1 }]);
d = await req('GET', `/api/b2b/orders/${open1}`);
assert.equal(d.order.total, 22500);
assert.deepEqual(d.items.map((i) => [i.product_id, i.qty]), [[11, 2], [12, 1]], 'позиції зібрано з замовлень клієнтів');
assert.equal(d.order.status, 'open');
// зміна замовлення перераховує відкриту закупівлю (власна частка не рахується двічі)
await req('PUT', `/api/b2b/p/clients/${c2.id}`, { client_name: 'Клієнт 2', client_phone: '0501112233', items: [{ product_id: 11, qty: 2 }] }, A);
assert.equal((await req('GET', `/api/b2b/p/limits`, null, A)).open.total, 27000);
// адмін не змінює статус відкритої закупівлі вручну
assert.ok(await errOf(() => req('POST', `/api/b2b/orders/${open1}/status`, { status: 'paid' })));

// ---------- 3. Ліміт усіх неоплачених закупівель ----------
await pA({ unpaid_limit: 40000 });
assert.match(await errOf(() => req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 2 }] }, A)), /Ліміт неоплачених/, '27 000 + 18 000 > 40 000');
const s1 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 12, qty: 2 }] }, A); // 9000 → 36 000
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).unpaid.total, 36000);
await req('PUT', `/api/b2b/orders/${s1.id}`, { invoice_no: 'СФ-1' });
await req('POST', `/api/b2b/orders/${s1.id}/status`, { status: 'paid' });
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).unpaid.total, 27000, 'оплачена не рахується');
await pA({ open_limit: '', unpaid_limit: '' });
assert.deepEqual([(await req('GET', '/api/b2b/p/limits', null, A)).open.limit, (await req('GET', '/api/b2b/p/limits', null, A)).unpaid.limit], [20000, 100000], 'порожньо — типові');

// ---------- 4. Відвантаження без оплати — адмінам особисто ----------
tg.length = 0;
await req('PUT', `/api/b2b/clients/${c1.id}`, { crm_id: '777' });
const warn = tg.filter((m) => /Відвантаження без оплати/.test(m.text));
assert.equal(warn.length, 1);
assert.equal(String(warn[0].chat_id), '1', 'власнику');
assert.match(warn[0].text, /ще без рахунку/);

// ---------- 5. «Сформувати рахунок на закупівлю» ----------
await req('POST', '/api/b2b/p/open/form', { entity_id: ent.id }, A);
d = await req('GET', `/api/b2b/orders/${open1}`);
assert.equal(d.order.status, 'invoice_wait');
assert.match(d.order.entity, /ФОП Альфа/);
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).open.id, null, 'відкритої більше немає');
assert.equal((await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A)).order.no_supply, false, 'позначка 🔴 знімається');
assert.match(await errOf(() => req('POST', '/api/b2b/p/open/form', { entity_id: ent.id }, A)), /немає/);
// нова — з нуля, і порожня зникає після скасування
const c3 = await cl('Клієнт 3', [{ product_id: 12, qty: 1 }]);
const open2 = (await req('GET', '/api/b2b/p/limits', null, A)).open.id;
assert.ok(open2 && open2 !== open1);
await req('POST', `/api/b2b/p/clients/${c3.id}/cancel`, {}, A);
assert.ok(!(await db.get(`SELECT id FROM b2b_orders WHERE id = ?`, [open2])), 'порожню відкриту закупівлю видалено');
assert.equal((await req('GET', `/api/b2b/p/clients/${c3.id}`, null, A)).order.supply_id, null);

// ---------- 6. Дані клієнта з маркування НП ----------
const parse = async (bytes) => (await mk().request('/api/b2b/p/parse-label', { method: 'POST', headers: { Cookie: A.Cookie, 'Content-Type': 'application/pdf' }, body: bytes })).json();
const r = await parse(miniPdf(npLabel({ ttn: '20451234567890', name: 'Коваленко Ірина Олегівна', phone: '067 123 45 67' })));
assert.equal(r.found, true);
assert.equal(r.ttn, '20451234567890');
assert.equal(r.client_phone, '0671234567');
assert.match(r.client_name, /Коваленко Ірина/);
assert.match(r.address, /Гадяч/);
assert.equal((await parse(miniPdf(['Просто документ']))).found, false);

console.log('b2b-open: ok');
