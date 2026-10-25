// Часті товари партнера першими; маркування: без дублів (той самий файл / ТТН), видалення; заміна номера LP-CRM.
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
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Aaa', 901), (12, 'Bbb', 901), (13, 'Ccc', 901)`, []],
]);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: '1000.00' })) }));
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

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('POST', `/api/b2b/partners/${pb.id}/users`, { login: 'pb', password: 'pass1234' });
for (const p of [pa, pb]) await req('PUT', `/api/b2b/partners/${p.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '200' WHERE login = 'pa'`);
const A = await login('pa', 'pass1234');
const B = await login('pb', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);

// ---------- 1. Часті товари — першими ----------
let cat = await req('GET', '/api/b2b/p/catalog', null, A);
assert.deepEqual(cat.products.map((p) => p.id), [11, 12, 13], 'без замовлень — за назвою');
await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 13, qty: 1 }, { product_id: 12, qty: 1 }] }, A);
await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 13, qty: 2 }] }, A);
const sx = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 5 }] }, A);
await req('POST', `/api/b2b/p/orders/${sx.id}/cancel`, {}, A); // скасовані не рахуються
cat = await req('GET', '/api/b2b/p/catalog', null, A);
assert.deepEqual(cat.products.map((p) => [p.id, p.ordered]), [[13, 2], [12, 1], [11, 0]]);
assert.deepEqual((await req('GET', '/api/b2b/p/catalog', null, B)).products.map((p) => p.id), [11, 12, 13], 'в іншого партнера — своя статистика');

// ---------- 2. Маркування без дублів ----------
const cl = (name, extra = {}, h = A) => req('POST', '/api/b2b/p/clients', { client_name: name, client_phone: '0501112233', items: [{ product_id: 12, qty: 1 }], ...extra }, h);
const up = async (id, bytes, h = A, name = 'label.pdf') => {
  const r = await app.request(`/api/b2b/p/clients/${id}/files`, { method: 'POST', headers: { Cookie: h.Cookie, 'Content-Type': 'application/pdf', 'x-file-name': name }, body: bytes });
  const j = await r.json();
  if (r.status >= 400) throw Object.assign(new Error(j.error), { status: r.status });
  return j;
};
const parse = async (bytes, except = 0, h = A) => (await app.request(`/api/b2b/p/parse-label${except ? `?except=${except}` : ''}`, { method: 'POST', headers: { Cookie: h.Cookie, 'Content-Type': 'application/pdf' }, body: bytes })).json();
const lbl = miniPdf(npLabel({ ttn: '20451111222233', name: 'Петренко Іван' }));
const c1 = await cl('Петренко Іван');
const c2 = await cl('Інший клієнт');
assert.equal((await parse(lbl)).dup, null, 'ще ніде немає');
await up(c1.id, lbl);
assert.equal((await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A)).order.ttn, '20451111222233', 'ТТН з маркування');
assert.match(await errOf(() => up(c1.id, lbl)), /вже додано до цього замовлення/);
assert.match(await errOf(() => up(c2.id, lbl)), new RegExp(`вже є в замовленні B2B-${c1.id} \\(Петренко Іван\\)`));
let pr = await parse(lbl);
assert.equal(pr.dup.id, c1.id);
assert.match(pr.dup_text, /вже є в замовленні/);
assert.equal((await parse(lbl, c1.id)).dup, null, 'у своєму ж замовленні — не дубль');
// інший файл, той самий ТТН
const lbl2 = miniPdf(npLabel({ ttn: '20451111222233', name: 'Петренко Іван', phone: '067 000 00 00' }));
assert.match(await errOf(() => up(c2.id, lbl2, A, 'other.pdf')), /вже є в замовленні/);
// ТТН вписано вручну
assert.match(await errOf(() => cl('Ще один', { ttn: '20451111222233' })), new RegExp(`ТТН 20451111222233 уже є в замовленні B2B-${c1.id}`));
// інший партнер — без чужих даних
pr = await parse(lbl, 0, B);
assert.ok(pr.dup && !/Петренко/.test(pr.dup_text));
assert.match(await errOf(() => cl('Клієнт Б', { ttn: '20451111222233' }, B)), /уже використана в іншому замовленні/);
// видалити маркування на етапі «нове», скасоване замовлення звільняє маркування
const files = (await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A)).files;
await req('DELETE', `/api/b2b/p/clients/${c1.id}/files/${files[0].id}`, null, A);
assert.equal((await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A)).files.length, 0);
await req('POST', `/api/b2b/p/clients/${c1.id}/cancel`, {}, A);
await up(c2.id, lbl);
assert.equal((await req('GET', `/api/b2b/p/clients/${c2.id}`, null, A)).files.length, 1, 'після скасування — можна в інше замовлення');

// ---------- 3. Адмін: номер LP-CRM і заміна на інший ----------
tg.length = 0;
await req('PUT', `/api/b2b/clients/${c2.id}`, { crm_id: '77001' });
assert.ok(tg.some((m) => /передано в роботу/.test(m.text)));
tg.length = 0;
await req('PUT', `/api/b2b/clients/${c2.id}`, { crm_id: '77002' });
let o = (await req('GET', `/api/b2b/orders/${c2.id}`)).order;
assert.equal(o.crm_id, '77002');
assert.ok(tg.some((m) => /номер у CRM змінено/.test(m.text)), 'партнеру — що номер змінено');
assert.match((await req('GET', `/api/b2b/orders/${c2.id}`)).history.map((x) => x.action).join('\n'), /замінено замовлення LP-CRM \(було 77001\) на № 77002/);
assert.equal((await req('GET', `/api/b2b/p/clients/${c2.id}`, null, A)).order.crm_id, '77002', 'партнер бачить новий номер');

console.log('OK — B2B: часті товари, маркування без дублів, заміна номера LP-CRM');
