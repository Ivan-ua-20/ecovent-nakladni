// B2B «Акції»: назва, дати й «кому» один раз + позиції (бренд / категорія / товари) з однаковим % для всіх партнерів.
// Партнер отримує більшу з двох — акційну чи свою звичайну маржу; РРЦ фіксується на початок акції (якщо ціну в LP-CRM знизили).
// Вставка артикулів, товари бренду галочками, перевірка перед збереженням, зупинка, видалення, перетини.
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
  [`INSERT INTO an_products (product_id, name, brand_id, category_id) VALUES (11, 'Warmix 1500', 901, 5), (12, 'Warmix 2000', 901, 5), (13, 'NovaDry 12', 901, 6), (21, 'Core 600', 902, NULL), (22, 'Core 300', 902, NULL)`, []],
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
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 20, margin_wh: 22 }, { brand_id: 902, margin: 18 }]);
await req('PUT', `/api/b2b/partners/${pb.id}/margins`, [{ brand_id: 901, margin: 20 }, { brand_id: 902, margin: 30 }]);
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE b2b_catalog SET article = CASE product_id WHEN 11 THEN 'WARMIX1500' WHEN 12 THEN 'WARMIX2000' WHEN 13 THEN 'NOVA12' WHEN 21 THEN 'CORE600' ELSE 'CORE300' END`);
const loginAs = async (l) => ({ 'Content-Type': 'application/json', Cookie: (await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: 'pass1234' }) })).headers.get('set-cookie').split(';')[0] });
const A = await loginAs('pa');
const B = await loginAs('pb');
const prices = async (h) => Object.fromEntries((await req('GET', '/api/b2b/p/catalog', null, h)).products.map((p) => [p.id, [p.price, p.price_wh, p.special]]));

// ---------- вставка артикулів і товари бренду ----------
const res = await req('POST', '/api/b2b/promos/resolve', { text: 'warmix1500\nWARMIX2000\t\nLINEO500; 13' });
assert.deepEqual(res.found.map((x) => x.id).sort(), [11, 12, 13]);
assert.deepEqual(res.missing, ['LINEO500']);
assert.equal(res.found.find((x) => x.id === 11).brand, 'Evoair');
assert.deepEqual((await req('GET', '/api/b2b/promos/products?brand=901')).products.map((x) => x.id).sort(), [11, 12, 13]);

// ---------- перевірка перед збереженням ----------
const body = {
  name: 'Чорна п\'ятниця', date_from: today, date_to: shift(7),
  items: [{ level: 'brand', ref_id: 902, margin: 23 }, { level: 'product', ref_id: 11, margin: 25 }, { level: 'product', ref_id: 12, margin: 25 }],
};
const pv = await req('POST', '/api/b2b/promos/preview', body);
assert.deepEqual(pv.errors, []);
assert.equal(pv.count, 4, 'Levoit (2) + 2 товари Evoair');
assert.deepEqual(pv.coverage.map((x) => x.n), [2, 1, 1]);
assert.match(pv.warnings.join(' | '), /Партнер Б — 2 товарів/, 'у Б звичайна маржа Levoit 30 > 23');
assert.equal(pv.rows.find((r) => r.id === 11).price, 7500);
assert.match((await req('POST', '/api/b2b/promos/preview', { ...body, items: [...body.items, { level: 'product', ref_id: 11, margin: 5 }] })).errors[0], /двічі/);

// ---------- створення: однаковий % для всіх; більша маржа лишається ----------
const bf = await req('POST', '/api/b2b/promos', body);
let a = await prices(A);
assert.deepEqual(a[11], [7500, 7500, true], 'Warmix 1500: 25% (звичайна 20/22 менша)');
assert.deepEqual(a[13], [8000, 7800, false], 'NovaDry — не в акції, звичайна маржа бренду');
assert.deepEqual(a[21], [7700, 7700, true], 'Levoit: 23% для А');
assert.deepEqual((await prices(B))[21], [7000, 7000, true], 'Levoit для Б: його звичайна 30% більша за акційні 23% — лишається 30%');
// позиції акції не видно серед окремих правил і їх не змінити окремо
assert.equal((await req('GET', '/api/b2b/margin-rules')).rules.length, 0);
const rid = (await db.get(`SELECT id FROM b2b_margin_rules WHERE promo_id = ? LIMIT 1`, [bf.id])).id;
assert.match(await errOf(() => req('PUT', `/api/b2b/margin-rules/${rid}`, { level: 'brand', ref_id: 902, margin: 1, promo: false })), /позиція акції/);

// ---------- РРЦ фіксується на початок акції ----------
// ціну в LP-CRM знизили під час акції: 10000 → 8000; партнер платить 25% від РРЦ на старт = 7500
await db.batch([
  [`INSERT INTO b2b_price_log (at, product_id, old_rrp, new_rrp) VALUES (?, 11, 10000, 8000)`, [new Date().toISOString()]],
  [`UPDATE b2b_catalog SET rrp = 8000 WHERE product_id = 11`, []],
]);
assert.equal((await db.get(`SELECT rrp FROM b2b_promo_rrp WHERE promo_id = ? AND product_id = 11`, [bf.id])).rrp, 10000, 'знімок РРЦ при збереженні');
assert.deepEqual((await prices(A))[11], [7500, 7500, true]);
// без фіксації — від поточної ціни
await req('PUT', `/api/b2b/promos/${bf.id}`, { ...body, fix_rrp: false });
assert.deepEqual((await prices(A))[11], [6000, 6000, true]);
await req('PUT', `/api/b2b/promos/${bf.id}`, body);
assert.deepEqual((await prices(A))[11], [7500, 7500, true]);
// знімок відновлюється з журналу цін, навіть якщо його зроблено пізніше (фонова задача)
await db.run(`DELETE FROM b2b_promo_rrp WHERE promo_id = ?`, [bf.id]);
assert.deepEqual((await prices(A))[11], [6000, 6000, true], 'поки знімка немає — від поточної');
const { key } = await req('POST', '/api/jobs/key');
const cr = await call('POST', '/api/cron/run/b2b-promos', null, { 'X-Cron-Key': key });
assert.equal(cr.status, 200, JSON.stringify(cr.j));
assert.deepEqual((await prices(A))[11], [7500, 7500, true]);

// ---------- список, картка, перетини ----------
let list = (await req('GET', '/api/b2b/promos')).promos;
assert.deepEqual([list[0].name, list[0].status, list[0].brands, list[0].products, list[0].all], ['Чорна п\'ятниця', 'active', 1, 2, true]);
const one = await req('GET', `/api/b2b/promos/${bf.id}`);
assert.deepEqual(one.items.map((i) => [i.level, i.ref_name, i.margin]), [['brand', 'Levoit', 23], ['product', 'Товар 11', 25], ['product', 'Товар 12', 25]]);
assert.equal(one.items[1].brand, 'Evoair');
assert.match(await errOf(() => req('POST', '/api/b2b/promos', { ...body, name: 'Друга', date_from: shift(3), date_to: shift(9), items: [{ level: 'brand', ref_id: 902, margin: 20 }] })), /«Levoit»: Перетинається з акцією «Чорна п'ятниця»/);
// для вибраних партнерів, наступного тижня — можна
const next = await req('POST', '/api/b2b/promos', { name: 'Наступна', date_from: shift(10), date_to: shift(12), partners: [pb.id], items: [{ level: 'category', ref_id: 6, margin: 35 }] });
assert.equal((await req('GET', `/api/b2b/promos?partner=${pa.id}`)).promos.length, 1, 'партнер А бачить лише свої');
assert.equal((await req('GET', `/api/b2b/promos/${next.id}`)).status, 'planned');

// ---------- зупинка й видалення ----------
await req('POST', `/api/b2b/promos/${bf.id}/stop`);
a = await prices(A);
assert.deepEqual([a[11][2], a[21]], [false, [8200, 8200, false]], 'зупинено — звичайна маржа');
list = (await req('GET', '/api/b2b/promos')).promos;
assert.equal(list.find((p) => p.id === bf.id).status, 'stopped');
assert.match(await errOf(() => req('PUT', `/api/b2b/promos/${bf.id}`, body)), /зупинено/);
await req('DELETE', `/api/b2b/promos/${next.id}`);
assert.equal((await req('GET', '/api/b2b/promos')).promos.length, 1);
assert.equal((await call('GET', '/api/b2b/promos', null, A)).status, 403, 'партнер — ні');

console.log('OK — B2B «Акції»: позиції, однаковий % для всіх, більша маржа, фіксація РРЦ, артикули, перевірка, зупинка');
