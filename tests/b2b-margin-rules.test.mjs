// B2B: правила маржі й акції — на бренд, категорію, товар; постійні й на період «з–по»; для одного, кількох чи всіх партнерів.
// Порядок: акція (товар → категорія → бренд) → особлива маржа товару → постійне правило (товар → категорія) → маржа бренду.
// Ціна однакова в каталозі партнера, закупівлі, прайсі й «Перевірити ціну».
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
const shift = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
await db.batch([
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98), (902, 'Levoit', 'levoit', 99)`, []],
  [`INSERT INTO an_categories (id, name) VALUES (5, 'Тепловентилятори'), (6, 'Осушувачі')`, []],
  [`INSERT INTO an_products (product_id, name, brand_id, category_id) VALUES (11, 'Warmix 1500', 901, 5), (12, 'Warmix 2000', 901, 5), (13, 'NovaDry 12', 901, 6), (21, 'Core 600', 902, NULL)`, []],
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
]);
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) return new Response(JSON.stringify({ ok: true, result: {} }));
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: '10000.00' })) }));
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const call = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const req = async (...a) => { const r = await call(...a); if (r.status >= 400) throw new Error(r.j.error || r.status); return r.j; };
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
for (const [p, l] of [[pa, 'pa'], [pb, 'pb']]) await req('POST', `/api/b2b/partners/${p.id}/users`, { login: l, password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10, margin_wh: 15 }, { brand_id: 902, margin: 12 }]);
await req('PUT', `/api/b2b/partners/${pb.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
const loginAs = async (l) => ({ 'Content-Type': 'application/json', Cookie: (await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: 'pass1234' }) })).headers.get('set-cookie').split(';')[0] });
const A = await loginAs('pa');
const B = await loginAs('pb');
const prices = async (h) => Object.fromEntries((await req('GET', '/api/b2b/p/catalog', null, h)).products.map((p) => [p.id, [p.price, p.price_wh, p.special, p.special_until]]));

// без правил — як раніше: маржа бренду
let pr = await prices(A);
assert.deepEqual(pr[11], [9000, 8500, false, '']);
assert.deepEqual(pr[21], [8800, 8800, false, '']);

// ---------- постійне правило на категорію (лише партнер А) ----------
const meta = await req('GET', '/api/b2b/margin-rules/meta');
assert.deepEqual(meta.categories.map((x) => [x.name, x.n]), [['Осушувачі', 1], ['Тепловентилятори', 2]]);
const cat = await req('POST', '/api/b2b/margin-rules', { promo: false, level: 'category', ref_id: 5, margin: 18, margin_wh: 23, partners: [pa.id] });
pr = await prices(A);
assert.deepEqual([pr[11], pr[12], pr[13]], [[8200, 7700, false, ''], [8200, 7700, false, ''], [9000, 8500, false, '']], 'категорія точніша за бренд, інша категорія — бренд');
assert.deepEqual((await prices(B))[11], [9000, 9000, false, ''], 'партнер Б — без змін');
assert.match(await errOf(() => req('POST', '/api/b2b/margin-rules', { promo: false, level: 'category', ref_id: 5, margin: 19 })), /Перетинається з постійним/);

// ---------- акція на бренд для всіх, на період — важливіша за постійну категорію ----------
const bf = await req('POST', '/api/b2b/margin-rules', { name: 'Чорна п\'ятниця', level: 'brand', ref_id: 901, margin: 25, date_from: shift(-1), date_to: shift(5) });
pr = await prices(A);
assert.deepEqual(pr[11], [7500, 7500, true, shift(5)], 'акція важливіша за постійне правило категорії; B2B порожня — та сама');
assert.deepEqual(pr[13], [7500, 7500, true, shift(5)]);
assert.deepEqual(pr[21], [8800, 8800, false, ''], 'інший бренд — без акції');
assert.deepEqual((await prices(B))[12], [7500, 7500, true, shift(5)], 'для всіх партнерів');
// акція на товар — точніша за акцію на бренд
await req('POST', '/api/b2b/margin-rules', { name: 'Warmix 2000', level: 'product', ref_id: 12, margin: 30, margin_wh: 33, date_from: today, date_to: shift(2) });
pr = await prices(A);
assert.deepEqual([pr[11][0], pr[12][0], pr[12][1]], [7500, 7000, 6700]);
// перетин акцій на той самий об'єкт — ні; не перетинаються — так
assert.match(await errOf(() => req('POST', '/api/b2b/margin-rules', { level: 'brand', ref_id: 901, margin: 20, date_from: shift(3), date_to: shift(9) })), /Перетинається з акцією «Чорна п'ятниця»/);
await req('POST', '/api/b2b/margin-rules', { level: 'brand', ref_id: 901, margin: 20, date_from: shift(10), date_to: shift(12), partners: [pb.id] });
assert.match(await errOf(() => req('POST', '/api/b2b/margin-rules', { level: 'brand', ref_id: 901, margin: 20, date_from: shift(1), date_to: '' })), /дати «з» і «по»/);
assert.match(await errOf(() => req('POST', '/api/b2b/margin-rules', { level: 'brand', ref_id: 901, margin: 95, date_from: shift(20), date_to: shift(21) })), /від 0 до 90/);

// ---------- закупівля — за ціною акції; «Перевірити ціну» на дату ----------
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП А', code: '1234567890' }, A);
await db.run(`UPDATE b2b_partners SET open_limit = 1000000, unpaid_limit = 1000000`);
const o = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 1 }, { product_id: 12, qty: 1 }] }, A);
assert.deepEqual((await db.all(`SELECT product_id, price FROM b2b_order_items WHERE order_id = ? ORDER BY product_id`, [o.id])).map((x) => [x.product_id, x.price]), [[11, 7500], [12, 7000]]);
let ck = await req('GET', `/api/b2b/margin-rules/check?partner=${pa.id}&product=11&date=${today}`);
assert.deepEqual([ck.margin, ck.price, ck.promo, ck.promo_name], [25, 7500, true, 'Чорна п\'ятниця']);
ck = await req('GET', `/api/b2b/margin-rules/check?partner=${pa.id}&product=11&date=${shift(7)}`);
assert.deepEqual([ck.margin, ck.margin_wh, ck.price, ck.promo], [18, 23, 8200, false], 'після акції — постійне правило категорії');
ck = await req('GET', `/api/b2b/margin-rules/check?partner=${pb.id}&product=11&date=${shift(11)}`);
assert.equal(ck.margin, 20, 'партнер Б — своя акція');
assert.equal((await call('GET', `/api/b2b/margin-rules/check?partner=${pb.id}&product=21`)).status, 404, 'бренд не відкрито');
// прайс партнера — ті самі ціни
const pl = await req('GET', `/api/b2b/partners/${pa.id}/price-list`);
assert.equal(pl.products.find((p) => p.id === 12).price, 7000);

// ---------- список, зміна, видалення, права ----------
let list = (await req('GET', `/api/b2b/margin-rules?partner=${pa.id}`)).rules;
assert.equal(list.length, 3, 'партнер А: категорія (своя) + 2 акції для всіх; акція лише для Б — ні');
const bfRow = list.find((r) => r.id === bf.id);
assert.deepEqual([bfRow.level_name, bfRow.ref_name, bfRow.status, bfRow.all], ['Бренд', 'Evoair', 'active', true]);
assert.equal(list.find((r) => r.id === cat.id).status, 'permanent');
await req('PUT', `/api/b2b/margin-rules/${bf.id}`, { name: 'Чорна п\'ятниця', level: 'brand', ref_id: 901, margin: 25, date_from: shift(1), date_to: shift(5) });
assert.equal((await req('GET', `/api/b2b/margin-rules?partner=${pa.id}`)).rules.find((r) => r.id === bf.id).status, 'planned');
assert.deepEqual((await prices(A))[11], [8200, 7700, false, ''], 'запланована — ще не діє');
await req('DELETE', `/api/b2b/margin-rules/${cat.id}`);
assert.deepEqual((await prices(A))[11], [9000, 8500, false, ''], 'видалили — знову маржа бренду');
assert.equal((await call('GET', '/api/b2b/margin-rules', null, A)).status, 403, 'партнер — ні');

console.log('OK — B2B: правила маржі й акції (бренд, категорія, товар, періоди, партнери)');
