// Один товар у закупівлі кількома рядками з різною ціною: менеджер додає ще одиниці за іншою ціною (з попередженням у вікні),
// залишок рахується по товару, замовлення клієнтів беруть ціну рядків по черзі; чернетка й відкрита — одна ціна на товар.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  ...[['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_hook_v', '2'], ['b2b_fin_chat', '-900']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]),
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901), (13, 'Fan 3', 901)`, []],
]);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) {
    let body = {};
    try { body = JSON.parse(opts.body); } catch { body = { file: true, method: url.split('/').pop() }; }
    tg.push({ method: url.split('/').pop(), ...body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 100 + tg.length } }));
  }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '10000.00', 12: '5000.00', 13: '2000.00' }[id] })) }));
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
const upload = (id, kind, name) => mk().request(`/api/b2b/orders/${id}/files?kind=${kind}`, { method: 'POST', headers: { Cookie: H.Cookie, 'Content-Type': 'application/pdf', 'X-File-Name': name }, body: new Uint8Array([37, 80, 68, 70, 1, 2, 3]) }).then((r) => r.json());

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]); // 9000, 4500, 1800
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
await db.run(`UPDATE users SET tg_chat_id = '2' WHERE login = 'pa'`);
await db.run(`UPDATE b2b_partners SET tg_group = '-500' WHERE id = ?`, [pa.id]);
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);
const edit = (id, body) => req('PUT', `/api/b2b/orders/${id}/edit`, body);
const get = async (id) => req('GET', `/api/b2b/orders/${id}`);
const lines = async (id) => (await get(id)).items.map((i) => [i.product_id, i.qty, i.price]);
const client = { client_name: 'Петренко Олена', client_phone: '050 111 22 33', ttn: '' };

// ---------- 1. Закупівля з рахунком: + ще 2 шт того ж товару окремим рядком за іншою ціною ----------
const s1 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 3 }, { product_id: 12, qty: 1 }] }, A);
await req('PUT', `/api/b2b/orders/${s1.id}`, { invoice_no: 'СФ-1', invoice_date: '2026-11-10', waybill_no: '' });
await req('POST', `/api/b2b/orders/${s1.id}/status`, { status: 'paid', note: 'готівка' });
assert.deepEqual(await lines(s1.id), [[11, 3, 9000], [12, 1, 4500]]);
tg.length = 0;
await edit(s1.id, { items: [{ line: 0, product_id: 11, qty: 3, price: 9000, rrp: 10000 }, { line: 1, product_id: 12, qty: 1, price: 4500, rrp: 5000 }, { extra: true, product_id: 11, qty: 2, price: 8500 }] });
let d = await get(s1.id);
assert.deepEqual(d.items.map((i) => [i.product_id, i.qty, i.price, i.rrp]), [[11, 3, 9000, 10000], [12, 1, 4500, 5000], [11, 2, 8500, 10000]], 'окремий рядок, РРЦ — як у наявного');
assert.equal(d.order.total, 3 * 9000 + 4500 + 2 * 8500);
assert.equal(d.order.status, 'partial', 'сума зросла — частково оплачено');
assert.ok(d.history.some((x) => /\+ Товар 11 × 2 по 8[\s ]500,00 грн \(окремий рядок — товар уже є в закупівлі за іншою ціною\)/.test(x.action)), 'історія');
assert.deepEqual(d.left.map((r) => [r.product_id, r.qty, r.used, r.left]), [[11, 5, 0, 5], [12, 1, 0, 1]], 'залишок — по товару разом');
assert.ok(tg.some((m) => String(m.chat_id) === '-500' && /окремий рядок/.test(m.text)), 'група партнера');

// ---------- 2. Зміна саме другого рядка; той самий товар із тією ж ціною — один рядок ----------
await edit(s1.id, { items: [{ line: 0, product_id: 11, qty: 3 }, { line: 1, product_id: 12, qty: 1 }, { line: 2, product_id: 11, qty: 4, price: 8400 }] });
assert.deepEqual(await lines(s1.id), [[11, 3, 9000], [12, 1, 4500], [11, 4, 8400]], 'другий рядок змінився, перший — ні');
assert.ok((await get(s1.id)).history.some((x) => /Товар 11 \(рядок по 8[\s ]500,00 грн\): 2 → 4 шт/.test(x.action) && /ціна 8[\s ]500,00 грн → 8[\s ]400,00 грн/.test(x.action)));
await edit(s1.id, { items: [{ line: 0, product_id: 11, qty: 3 }, { line: 1, product_id: 12, qty: 1 }, { line: 2, product_id: 11, qty: 4 }, { extra: true, product_id: 11, qty: 1, price: 9000 }] });
assert.deepEqual(await lines(s1.id), [[11, 4, 9000], [12, 1, 4500], [11, 4, 8400]], 'рядок з тією ж ціною — злито');
// застарілий номер рядка — не перезаписуємо мовчки
assert.match(await errOf(() => edit(s1.id, { items: [{ line: 7, product_id: 11, qty: 1 }] })), /Склад закупівлі щойно змінився/);
assert.match(await errOf(() => edit(s1.id, { items: [{ line: 1, product_id: 11, qty: 1 }] })), /Склад закупівлі щойно змінився/);

// ---------- 3. Замовлення клієнтів: ціна рядків по черзі, залишок по товару ----------
const c1 = await req('POST', '/api/b2b/p/clients', { ...client, supply_id: s1.id, items: [{ product_id: 11, qty: 3 }] }, A);
assert.equal((await get(c1.id)).items[0].price, 9000, 'перші одиниці — з першого рядка');
const c2 = await req('POST', '/api/b2b/p/clients', { ...client, client_phone: '050 111 22 34', supply_id: s1.id, items: [{ product_id: 11, qty: 2 }] }, A);
assert.equal((await get(c2.id)).items[0].price, 8700, 'одиниця з першого рядка + одиниця з другого — середня');
const c3 = await req('POST', '/api/b2b/p/clients', { ...client, client_phone: '050 111 22 35', supply_id: s1.id, items: [{ product_id: 11, qty: 1 }] }, A);
assert.equal((await get(c3.id)).items[0].price, 8400, 'далі — другий рядок');
const sup = (await req('GET', '/api/b2b/p/supplies', null, A)).find((x) => x.id === s1.id);
assert.deepEqual(sup.items.filter((i) => i.product_id === 11).map((i) => [i.qty, i.left, i.price]), [[8, 2, 8400]], 'у формі замовлення — один рядок товару');
assert.deepEqual((await get(s1.id)).left.find((r) => r.product_id === 11).left, 2);
// менше, ніж розписано (6 шт) по товару разом — не можна
assert.match(await errOf(() => edit(s1.id, { items: [{ line: 0, product_id: 11, qty: 4 }, { line: 1, product_id: 12, qty: 1 }, { line: 2, product_id: 11, qty: 1 }] })), /розписано 6 шт/);
await edit(s1.id, { items: [{ line: 0, product_id: 11, qty: 4 }, { line: 1, product_id: 12, qty: 1 }, { line: 2, product_id: 11, qty: 2 }] });
// прибрали другий рядок — у кошик саме він (з його ціною), перший лишився
await req('POST', `/api/b2b/clients/${c3.id}/cancel`, {});
await edit(s1.id, { items: [{ line: 0, product_id: 11, qty: 5 }, { line: 1, product_id: 12, qty: 1 }, { line: 2, product_id: 11, qty: 0 }] });
assert.deepEqual(await lines(s1.id), [[11, 5, 9000], [12, 1, 4500]]);
const tr = JSON.parse((await db.get(`SELECT data FROM b2b_trash WHERE kind = 'item' AND order_id = ? ORDER BY id DESC`, [s1.id])).data);
assert.deepEqual([tr.product_id, tr.qty, tr.price], [11, 2, 8400]);

// ---------- 4. Партнер не змінює закупівлю з кількома цінами товару; чернетка — без окремих рядків ----------
const s2 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 13, qty: 2 }] }, A);
assert.equal((await get(s2.id)).order.status, 'invoice_wait');
await edit(s2.id, { items: [{ line: 0, product_id: 13, qty: 2 }, { extra: true, product_id: 13, qty: 1, price: 1500 }] });
assert.deepEqual(await lines(s2.id), [[13, 2, 1800], [13, 1, 1500]]);
assert.match(await errOf(() => req('PUT', `/api/b2b/p/orders/${s2.id}`, { entity_id: ent.id, items: [{ product_id: 13, qty: 4 }] }, A)), /кількох рядках з різною ціною/);
const dr = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, draft: true, items: [{ product_id: 13, qty: 1 }] }, A);
assert.equal((await get(dr.id)).order.status, 'draft');
assert.match(await errOf(() => edit(dr.id, { items: [{ line: 0, product_id: 13, qty: 1 }, { extra: true, product_id: 13, qty: 1, price: 1500 }] })), /лише у відправлену закупівлю/);
// старий формат (без line) — як раніше: товар один рядок, повтори сумуються
await edit(dr.id, { items: [{ product_id: 13, qty: 1 }, { product_id: 13, qty: 2 }, { product_id: 12, qty: 1 }] });
assert.deepEqual(await lines(dr.id), [[13, 3, 1800], [12, 1, 4500]]);

console.log('OK — B2B: товар кількома рядками з різною ціною');
