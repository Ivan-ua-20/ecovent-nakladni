// Публічне API партнерів v1: ключі, вхід, каталог, замовлення (створити / дубль / змінити / скасувати), файли, синхронізація.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'TestBrand', 'testbrand', 98)`, []],
  [`INSERT INTO b2b_catalog (product_id, name, article, rrp, brand_id) VALUES (11, 'Fan', 'F-1', 1000, 901), (12, 'Fan 2', 'F-2', 500, 901)`, []],
]);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { try { tg.push(JSON.parse(opts.body)); } catch { tg.push({ file: true }); } return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Адмін' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const raw = async (method, path, { body, headers = H } = {}) => {
  const r = await mk().request(path, { method, headers, body });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const req = async (method, path, body, headers = H) => {
  const r = await raw(method, path, { body: body === undefined || body === null ? undefined : JSON.stringify(body), headers });
  if (r.status >= 400) throw Object.assign(new Error(r.j.error || r.status), { status: r.status });
  return r.j;
};
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return `${e.status} ${e.message}`; } };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pastaff', password: 'pass1234', partner_role: 'staff' });
for (const p of [pa, pb]) await req('PUT', `/api/b2b/partners/${p.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await db.run(`UPDATE users SET tg_chat_id = '200' WHERE login = 'pa'`);
const A = await login('pa', 'pass1234');
const AS = await login('pastaff', 'pass1234');

// ---------- ключі
assert.match(await errOf(() => req('POST', '/api/b2b/p/api-keys', { name: 'x' }, AS)), /^403/, 'менеджер партнера ключів не створює');
const k1 = await req('POST', '/api/b2b/p/api-keys', { name: 'Наша CRM' }, A);
assert.match(k1.key, /^ecv_[0-9a-f]{48}$/);
assert.ok(tg.some((m) => m.text?.includes('API-ключ «Наша CRM»')), 'партнеру — повідомлення про новий ключ');
const keys = await req('GET', '/api/b2b/p/api-keys', null, A);
assert.equal(keys.length, 1);
assert.equal(keys[0].key, undefined, 'повний ключ показується лише один раз');
assert.equal(keys[0].prefix, k1.key.slice(0, 10));
const kb = await req('POST', `/api/b2b/partners/${pb.id}/api-keys`, { name: 'Б' }); // адмін — для партнера Б
const K = { 'Content-Type': 'application/json', Authorization: `Bearer ${k1.key}` };
const KB = { 'Content-Type': 'application/json', 'X-Api-Key': kb.key };

// ---------- вхід
assert.equal((await raw('GET', '/api/v1/me', { headers: {} })).status, 401);
assert.equal((await raw('GET', '/api/v1/me', { headers: { Authorization: 'Bearer ecv_wrong' } })).status, 401);
assert.deepEqual((await req('GET', '/api/v1/me', null, K)).partner, { id: pa.id, name: 'Партнер А' });
assert.equal((await req('GET', '/api/v1/me', null, KB)).partner.id, pb.id, 'X-Api-Key теж працює');
assert.equal((await raw('GET', '/api/b2b/p/catalog', { headers: K })).status, 401, 'ключ не відкриває кабінет напряму');
assert.equal((await raw('GET', '/api/b2b/partners', { headers: K })).status, 401);
assert.equal((await raw('GET', '/api/v1/nope', { headers: K })).status, 404);
assert.ok((await db.get(`SELECT last_used_at FROM b2b_api_keys WHERE id = ?`, [k1.id])).last_used_at, 'остання активність ключа');

// ---------- каталог
const prods = (await req('GET', '/api/v1/products', null, K)).products;
assert.deepEqual(prods.map((p) => [p.product_id, p.article, p.price, p.rrp]), [[11, 'F-1', 900, 1000], [12, 'F-2', 450, 500]]);

// ---------- створити замовлення (артикул і product_id), дубль за external_id
const body = { external_id: 'SHOP-1001', client: { name: 'Іван Петренко', phone: '067 123 45 67' }, comment: 'з сайту', items: [{ article: 'f-1', qty: 2 }, { product_id: 12, qty: 1 }] };
const r1 = await raw('POST', '/api/v1/orders', { body: JSON.stringify(body), headers: K });
assert.equal(r1.status, 201);
const o1 = r1.j.order;
assert.equal(r1.j.duplicate, false);
assert.equal(o1.external_id, 'SHOP-1001');
assert.equal(o1.status, 'new');
assert.equal(o1.client.phone, '380671234567');
assert.equal(o1.total, 2250);
assert.deepEqual(o1.items.map((i) => [i.product_id, i.qty, i.price]), [[11, 2, 900], [12, 1, 450]]);
assert.deepEqual(o1.missing_docs, ['маркування']);
assert.match((await db.get(`SELECT created_by FROM b2b_orders WHERE id = ?`, [o1.id])).created_by, /API · Наша CRM/, 'автор — ключ');
const again = await raw('POST', '/api/v1/orders', { body: JSON.stringify(body), headers: K });
assert.equal(again.status, 200);
assert.equal(again.j.duplicate, true);
assert.equal(again.j.order.id, o1.id, 'повтор не створює дубль');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM b2b_orders WHERE kind = 'client'`)).n, 1);
// помилки введення — зрозумілим текстом
assert.match(await errOf(() => req('POST', '/api/v1/orders', { ...body, external_id: '', client: { name: 'X', phone: '123' } }, K)), /^400 Телефон/);
assert.match(await errOf(() => req('POST', '/api/v1/orders', { client: { name: 'X', phone: '0671234567' }, items: [{ article: 'NOPE', qty: 1 }] }, K)), /артикулом «NOPE»/);
assert.match(await errOf(() => req('POST', '/api/v1/orders', { client: { name: 'X', phone: '0671234567' }, items: [{ product_id: 11, qty: 0 }] }, K)), /qty/);
assert.match(await errOf(() => req('POST', '/api/v1/orders', { external_id: 'має пробіл', client: { name: 'X', phone: '0671234567' }, items: [{ product_id: 11, qty: 1 }] }, K)), /external_id/);

// ---------- отримати: за id, за B2B-№, за external_id; чуже — 404
assert.equal((await req('GET', `/api/v1/orders/${o1.id}`, null, K)).number, o1.number);
assert.equal((await req('GET', `/api/v1/orders/${o1.number}`, null, K)).id, o1.id);
assert.equal((await req('GET', '/api/v1/orders?external_id=SHOP-1001', null, K)).orders[0].id, o1.id);
assert.match(await errOf(() => req('GET', `/api/v1/orders/${o1.id}`, null, KB)), /^404/, 'партнер Б не бачить замовлення А');
assert.match(await errOf(() => req('POST', `/api/v1/orders/${o1.id}/cancel`, {}, KB)), /^404/);
assert.equal((await req('GET', '/api/v1/orders', null, KB)).orders.length, 0);

// ---------- змінити
const up = await req('PUT', `/api/v1/orders/${o1.number}`, { ...body, comment: 'передзвонити', items: [{ product_id: 11, qty: 1 }] }, K);
assert.equal(up.order.total, 900);
assert.equal(up.order.comment, 'передзвонити');

// ---------- файли: документ без виду — помилка; маркування — base64 і «сирим» тілом
assert.match(await errOf(() => req('POST', `/api/v1/orders/${o1.id}/files`, { kind: 'doc', filename: 'a.pdf', content_base64: 'JVBERi0x' }, K)), /doc_type_id/);
const pdf = Buffer.from('%PDF-1.4\n% test label\n%%EOF');
const f1 = await req('POST', `/api/v1/orders/${o1.id}/files`, { kind: 'label', filename: 'label.pdf', content_base64: pdf.toString('base64') }, K);
assert.equal(f1.order.files.length, 1);
assert.deepEqual(f1.order.missing_docs, []);
await req('DELETE', `/api/v1/orders/${o1.id}/files/${f1.file_id}`, null, K);
const rf = await raw('POST', `/api/v1/orders/${o1.id}/files?kind=label&filename=l2.pdf`, { body: pdf, headers: { Authorization: `Bearer ${k1.key}`, 'Content-Type': 'application/pdf' } });
assert.equal(rf.status, 201);
assert.equal(rf.j.order.files[0].name, 'l2.pdf');

// ---------- синхронізація за updated_since
const t0 = new Date(Date.now() - 1000).toISOString();
const sync = await req('GET', `/api/v1/orders?updated_since=${encodeURIComponent(t0)}`, null, K);
assert.equal(sync.orders.length, 1);
assert.ok(sync.next_updated_since);
assert.equal((await req('GET', `/api/v1/orders?updated_since=${encodeURIComponent(sync.next_updated_since)}`, null, K)).orders.length, 0);
assert.match(await errOf(() => req('GET', '/api/v1/orders?updated_since=вчора', null, K)), /ISO/);
// статус у LP-CRM змінився → замовлення знову в синхронізації
await db.run(`UPDATE b2b_orders SET status = 'crm', crm_status = 'Доставлено', crm_id = '777', updated_at = ? WHERE id = ?`, [new Date(Date.now() + 1000).toISOString(), o1.id]);
const s2 = (await req('GET', `/api/v1/orders?updated_since=${encodeURIComponent(sync.next_updated_since)}`, null, K)).orders[0];
assert.deepEqual(s2.crm, { order_id: '777', status: 'Доставлено' });
assert.deepEqual((await req('GET', '/api/v1/statuses', null, K)).crm_statuses, [{ name: 'Доставлено', orders: 1 }]);
assert.match(await errOf(() => req('PUT', `/api/v1/orders/${o1.id}`, body, K)), /^400 Замовлення вже передане/, 'у роботі — не змінюється');

// ---------- скасувати
const o2 = (await req('POST', '/api/v1/orders', { external_id: 'SHOP-1002', client: { name: 'Олена', phone: '0501112233' }, items: [{ product_id: 12, qty: 1 }] }, K)).order;
assert.equal((await req('POST', `/api/v1/orders/${o2.id}/cancel`, {}, K)).order.status, 'cancelled');
assert.equal((await req('GET', '/api/v1/orders?status=cancelled', null, K)).orders.length, 1);

// ---------- відкликати ключ
await req('DELETE', `/api/b2b/p/api-keys/${k1.id}`, null, A);
assert.equal((await raw('GET', '/api/v1/me', { headers: K })).status, 401, 'відкликаний ключ не діє');
assert.match(await errOf(() => req('DELETE', `/api/b2b/p/api-keys/${kb.id}`, null, A)), /^404/, 'чужий ключ не відкликати');
assert.equal((await req('GET', `/api/b2b/partners/${pa.id}/api-keys`)).find((k) => k.id === k1.id).revoked_at !== '', true);
// не більше 5 активних
for (let i = 0; i < 5; i++) await req('POST', '/api/b2b/p/api-keys', { name: `k${i}` }, A);
assert.match(await errOf(() => req('POST', '/api/b2b/p/api-keys', { name: 'k6' }, A)), /5 активних/);

console.log('OK — B2B: API партнерів v1');
