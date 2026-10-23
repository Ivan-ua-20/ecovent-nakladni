// B2B етап 2: юрособи партнера, закупівля (ціни, зміна до рахунку, скасування), рахунок і накладна від бухгалтера,
// файли (частинами, лише свої, 30 днів), ручне «Оплачено», сповіщення в Telegram.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'TestBrand', 'testbrand', 98), (902, 'Closed', 'closed', 99)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901), (21, 'Closed thing', 902)`, []],
]);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: {} })); }
  const p = new URLSearchParams(opts.body);
  const prices = { 11: '1000.00', 12: '333.33', 21: '50.00' };
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: prices[id] })) }));
};
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Бухгалтер' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const send = async (method, path, body, headers = H) => mk().request(path, { method, headers, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined });
const req = async (method, path, body, headers = H) => {
  const r = await send(method, path, body, headers);
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('POST', `/api/b2b/partners/${pb.id}/users`, { login: 'pb', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('PUT', `/api/b2b/partners/${pb.id}/margins`, [{ brand_id: 901, margin: 30 }]);
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '100' WHERE login = 'owner'`);
await db.run(`UPDATE users SET tg_chat_id = '200' WHERE login = 'pa'`);
const A = await login('pa', 'pass1234');
const B = await login('pb', 'pass1234');

// ---------- 1. Юрособи ----------
assert.equal(await status(() => req('POST', '/api/b2b/p/entities', { name: 'ФОП', code: '123' }, A)), 400, 'код — 8 або 10 цифр');
assert.equal(await status(() => req('POST', '/api/b2b/p/entities', { name: 'ФОП', code: '1234567890', iban: 'UA12' }, A)), 400, 'IBAN');
const ea = await req('POST', '/api/b2b/p/entities', { kind: 'fop', name: 'ФОП Петренко П.П.', code: '1234567890', iban: 'UA213223130000026007233566001', vat: false }, A);
const ea2 = await req('POST', '/api/b2b/p/entities', { kind: 'tov', name: 'ТОВ «Альфа»', code: '45123456', vat: true }, A);
const eb = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Б', code: '0987654321' }, B);
assert.equal((await req('GET', '/api/b2b/p/entities', null, A)).length, 2);
assert.equal(await status(() => req('PUT', `/api/b2b/p/entities/${eb.id}`, { name: 'x', code: '12345678' }, A)), 404, 'чужа юрособа');

// ---------- 2. Закупівля ----------
assert.equal(await status(() => req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 21, qty: 1 }] }, A)), 400, 'товар закритого бренду');
assert.equal(await status(() => req('POST', '/api/b2b/p/orders', { entity_id: eb.id, items: [{ product_id: 11, qty: 1 }] }, A)), 404, 'чужа юрособа');
assert.equal(await status(() => req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 11, qty: 1.5 }] }, A)), 400, 'кількість — ціле число');
tg.length = 0;
const o1 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 3 }], comment: 'Терміново' }, A);
assert.equal(o1.number, `B2B-${o1.id}`);
assert.equal(o1.total, 2 * 900 + 3 * 300, 'ціни партнера: 1000 − 10% = 900; 333,33 − 10% = 300,00');
assert.equal(tg.length, 1, 'адміну — сповіщення про нову закупівлю');
assert.equal(tg[0].chat_id, '100');
assert.match(tg[0].text, /Нова закупівля B2B-\d+.*Партнер А/s);
let d = await req('GET', `/api/b2b/p/orders/${o1.id}`, null, A);
assert.equal(d.order.status, 'invoice_wait');
assert.match(d.order.entity, /ФОП Петренко П\.П\., ІПН 1234567890/);
assert.equal(await status(() => req('GET', `/api/b2b/p/orders/${o1.id}`, null, B)), 404, 'чуже замовлення');
assert.equal((await req('GET', '/api/b2b/p/orders', null, B)).rows.length, 0);
// зміна до рахунку (нова юрособа, нові ціни — зміна маржі не чіпає наявні, але при зміні замовлення ціни поточні)
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 20 }]);
assert.equal((await req('GET', `/api/b2b/p/orders/${o1.id}`, null, A)).items[0].price, 900, 'ціни в замовленні зафіксовані');
const upd = await req('PUT', `/api/b2b/p/orders/${o1.id}`, { entity_id: ea2.id, items: [{ product_id: 11, qty: 1 }] }, A);
assert.equal(upd.total, 800);
assert.match((await req('GET', `/api/b2b/p/orders/${o1.id}`, null, A)).order.entity, /ТОВ «Альфа», ЄДРПОУ 45123456, платник ПДВ/);

// ---------- 3. Бухгалтер: рахунок і накладна ----------
const list = await req('GET', '/api/b2b/orders?status=invoice_wait');
assert.equal(list.rows.length, 1);
assert.equal(list.rows[0].partner, 'Партнер А');
tg.length = 0;
await req('PUT', `/api/b2b/orders/${o1.id}`, { invoice_no: 'СФ-125', invoice_date: '2026-10-22', waybill_no: 'РН-77' });
d = await req('GET', `/api/b2b/orders/${o1.id}`);
assert.equal(d.order.status, 'pay_wait', 'номер рахунку → «Очікує оплату»');
assert.equal(tg.length, 1);
assert.equal(tg[0].chat_id, '200', 'партнеру — сповіщення про рахунок');
assert.match(tg[0].text, /Рахунок № СФ-125/);
assert.equal(await status(() => req('PUT', `/api/b2b/p/orders/${o1.id}`, { entity_id: ea.id, items: [{ product_id: 11, qty: 5 }] }, A)), 400, 'після рахунку партнер не змінює');
assert.equal(await status(() => req('POST', `/api/b2b/p/orders/${o1.id}/cancel`, {}, A)), 400);
assert.equal(await status(() => req('GET', '/api/b2b/orders', null, A)), 403, 'список усіх замовлень — не для партнера');

// ---------- 4. Файли ----------
const big = new Uint8Array(1_500_000).map((_, i) => (i * 7) % 256); // кілька частин
const up = await mk().request(`/api/b2b/orders/${o1.id}/files?kind=invoice`, { method: 'POST', headers: { Cookie: H.Cookie, 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('Рахунок СФ-125.pdf') }, body: big });
assert.equal(up.status, 200);
const fid = (await up.json()).id;
assert.ok((await db.get(`SELECT parts FROM b2b_files WHERE id = ?`, [fid])).parts >= 2, 'великий файл — кількома частинами');
let dl = await send('GET', `/api/b2b/p/files/${fid}`, null, A);
assert.equal(dl.status, 200);
assert.equal(dl.headers.get('content-type'), 'application/pdf');
assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), big, 'файл віддається байт у байт');
assert.equal((await send('GET', `/api/b2b/p/files/${fid}`, null, B)).status, 404, 'чужий файл');
const tooBig = await mk().request(`/api/b2b/orders/${o1.id}/files?kind=waybill`, { method: 'POST', headers: { Cookie: H.Cookie, 'X-File-Name': 'x.pdf' }, body: new Uint8Array(5 * 1024 * 1024 + 1) });
assert.equal(tooBig.status, 400);
assert.equal((await mk().request(`/api/b2b/orders/${o1.id}/files`, { method: 'POST', headers: A, body: new Uint8Array(10) })).status, 403, 'партнер не завантажує файли бухгалтерії');
assert.equal((await req('GET', `/api/b2b/p/orders/${o1.id}`, null, A)).files[0].kind_name, 'Рахунок');

// ---------- 5. Оплата вручну, завершення ----------
tg.length = 0;
await req('POST', `/api/b2b/orders/${o1.id}/status`, { status: 'paid' });
d = await req('GET', `/api/b2b/orders/${o1.id}`);
assert.equal(d.order.status, 'paid');
assert.equal(d.order.paid_amount, 800);
assert.equal(d.order.paid_by, 'Бухгалтер');
assert.ok(tg.some((m) => m.chat_id === '200' && /Оплату отримано/.test(m.text)));
await req('POST', `/api/b2b/orders/${o1.id}/status`, { status: 'done' });
assert.ok(d.history.length >= 4, 'історія замовлення');

// скасування партнером до рахунку
const o2 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 12, qty: 1 }] }, A);
await req('POST', `/api/b2b/p/orders/${o2.id}/cancel`, {}, A);
assert.equal((await req('GET', `/api/b2b/p/orders/${o2.id}`, null, A)).order.status, 'cancelled');
assert.equal(await status(() => req('POST', `/api/b2b/orders/${o2.id}/status`, { status: 'paid' })), 400, 'без рахунку — не «Оплачено»');

// юрособа з замовленнями — лише приховується
await req('DELETE', `/api/b2b/p/entities/${ea.id}`, null, A);
assert.equal((await db.get(`SELECT active FROM b2b_entities WHERE id = ?`, [ea.id])).active, 0);
assert.equal((await req('GET', '/api/b2b/p/entities', null, A)).length, 1);

// ---------- 6. Файли старші за 30 днів видаляються ----------
await db.run(`UPDATE b2b_files SET created_at = '2020-01-01T00:00:00Z'`);
await db.run(`DELETE FROM settings WHERE key = 'cleanup_at'`); // чистка — раз на годину на всі екземпляри
await req('GET', '/api/b2b/p/orders', null, A); // щогодинна чистка спрацьовує на запиті
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM b2b_file_parts`)).n, 0);
assert.equal((await send('GET', `/api/b2b/files/${fid}`)).status, 404);

console.log('OK — B2B: юрособи, закупівлі, рахунок і накладна, файли, оплата вручну');
