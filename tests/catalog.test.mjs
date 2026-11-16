// Каталог: словник товарів LP-CRM — розбір коду «[30414]» і артикулу «(COMFODRY12)» з назви, нормалізація артикулу без бренду,
// фоновий прохід getProduct партіями по 50 з продовженням за найбільший відомий ID, позначка видалених, пошук, права.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { parseName, normSku, parseProduct } from '../src/modules/catalog/index.js';

// ---------- чисті функції ----------
assert.deepEqual(parseName('Осушувач повітря Evoair ComfoDry 12 (COMFODRY12) [30414]'), { code: '30414', sku: 'COMFODRY12' });
assert.deepEqual(parseName('Осушувач повітря evoair NovaDry 16 Smart (коричневий ремінець) (NOVADRY16BR) [31469]'), { code: '31469', sku: 'NOVADRY16BR' });
assert.deepEqual(parseName('Очищувач повітря Levoit Vital 100S (LAP-V102S-WEU) [79922]'), { code: '79922', sku: 'LAP-V102S-WEU' });
assert.deepEqual(parseName('Очищувач повітря DREO 337S [83891]'), { code: '83891', sku: '' });
assert.deepEqual(parseName('Тепловентилятор evoair Warmix 2200 Black'), { code: '', sku: '' });
assert.equal(normSku('EvoairComfoDry12'), 'comfodry12');
assert.equal(normSku('COMFODRY12'), 'comfodry12');
assert.equal(normSku('LEVOIT_Dual_150'), 'dual150');
assert.equal(normSku('LUH-D302-WEU'), 'luhd302weu');
assert.equal(normSku('dreo', 'dreo'), 'dreo', 'бренд без решти не обрізається');
assert.equal(normSku('', 'x'), '');
const p = parseProduct({ id: '646', name: 'Осушувач повітря Evoair Dryora 10 (DRYORA10) [30360]', model: 'DRYORA10', vendor: 'DRYORA10', price: '6 500,00', category_id: '36', images: ['https://cdn/x.jpg'] });
assert.deepEqual(p, { product_id: 646, name: 'Осушувач повітря Evoair Dryora 10 (DRYORA10) [30360]', code: '30360', sku: 'DRYORA10', skun: 'dryora10', model: 'DRYORA10', vendor: 'DRYORA10', category_id: 36, price: 6500, image: 'https://cdn/x.jpg' });
assert.equal(parseProduct({ id: '7', name: 'Новий товар без коду', vendor: 'Артикул', model: 'NEW-7' }).skun, 'new7', 'без коду в назві — за model');
assert.equal(parseProduct({ product_id: 'x' }), null);

// ---------- прохід по товарах ----------
const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO settings (key, value) VALUES ('lpcrm_subdomain', 'test') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO an_products (product_id, name) VALUES (120, 'Відомий з аналітики')`, []], // найбільший відомий ID — щоб прохід пройшов повз прогалину 8…119
]);
const PRODUCTS = new Map();
for (let i = 1; i <= 7; i++) PRODUCTS.set(i, { id: String(i), name: `Товар ${i} (SKU${i}) [3000${i}]`, model: `SKU${i}`, price: String(100 * i) });
PRODUCTS.set(120, { id: '120', name: 'Осушувач повітря Evoair ComfoDry 12 (COMFODRY12) [30414]', model: 'COMFODRY12', vendor: 'COMFODRY12', price: '7600' });
PRODUCTS.set(121, { id: '121', name: 'Очищувач повітря DREO 337S [83891]', vendor: 'Артикул' });
PRODUCTS.set(122, { id: '122', name: 'Тепловентилятор evoair Warmix 2200 Black', model: 'WARMIX2200B' });
const calls = [];
const fetchFn = async (url, opts = {}) => {
  const m = String(url).match(/api\/(\w+)\.html/)?.[1];
  const p = Object.fromEntries(new URLSearchParams(opts.body));
  calls.push({ m, ids: p.product_id });
  if (m === 'getProduct') {
    const ids = p.product_id.split(',').map(Number);
    assert.equal(ids.length, 50);
    assert.equal(p.status_ignore, '1');
    return new Response(JSON.stringify({ status: 'ok', data: Object.fromEntries(ids.filter((id) => PRODUCTS.has(id)).map((id) => [id, PRODUCTS.get(id)])) }));
  }
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const st = globalThis.setTimeout; globalThis.setTimeout = (f, ms, ...a) => st(f, 0, ...a); // без пауз між запитами до LP-CRM
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

let r = await req('GET', '/api/catalog/status');
assert.equal(r.status, 200);
assert.deepEqual([r.j.total, r.j.configured, r.j.brands], [0, true, 'evoair,levoit,dreo,ihunt,ecovent']);

// один запуск — 6 партій: 1–50 (7 товарів), 51–100 (0), 101–150 (3; найбільший ID стає 122), далі 3 порожні — кінець
r = await req('POST', '/api/catalog/scan');
assert.equal(r.status, 200);
assert.deepEqual([r.j.saved, r.j.batches, r.j.done, r.j.total], [10, 6, true, 10], JSON.stringify(r.j));
assert.deepEqual(calls.filter((c) => c.m === 'getProduct').map((c) => c.ids.split(',')[0]), ['1', '51', '101', '151', '201', '251']);
const rows = (await db.all(`SELECT product_id, name, code, sku, skun, active FROM crm_products ORDER BY product_id`)).map((x) => ({ ...x }));
assert.equal(rows.length, 10);
assert.deepEqual(rows.find((x) => x.product_id === 120), { product_id: 120, name: 'Осушувач повітря Evoair ComfoDry 12 (COMFODRY12) [30414]', code: '30414', sku: 'COMFODRY12', skun: 'comfodry12', active: 1 });
assert.deepEqual(rows.find((x) => x.product_id === 121), { product_id: 121, name: 'Очищувач повітря DREO 337S [83891]', code: '83891', sku: '', skun: '', active: 1 });
assert.deepEqual(rows.find((x) => x.product_id === 122), { product_id: 122, name: 'Тепловентилятор evoair Warmix 2200 Black', code: '', sku: 'WARMIX2200B', skun: 'warmix2200b', active: 1 });
r = await req('GET', '/api/catalog/status');
assert.deepEqual([r.j.total, r.j.active, r.j.coded, r.j.scan.cursor, Boolean(r.j.scan.done_at), r.j.scan.max], [10, 10, 10, 0, true, 122]);

// повторний прохід того ж дня фоном — пропускається; вручну — йде знову, видалений товар стає неактивним, незмінені не чіпає
const { key } = (await req('POST', '/api/jobs/key')).j;
r = (await req('POST', '/api/cron/run/catalog', null, { 'X-Cron-Key': key })).j;
assert.ok(r.ok && r.result.skipped, JSON.stringify(r));
PRODUCTS.delete(3);
PRODUCTS.set(5, { ...PRODUCTS.get(5), name: 'Товар 5 перейменовано (SKU5) [30005]' });
const upd5 = (await db.get(`SELECT updated_at FROM crm_products WHERE product_id = 5`)).updated_at;
const upd1 = (await db.get(`SELECT updated_at FROM crm_products WHERE product_id = 1`)).updated_at;
await new Promise((res) => st(res, 5));
calls.length = 0;
r = await req('POST', '/api/catalog/scan');
assert.ok(r.j.done && r.j.saved === 9, JSON.stringify(r.j));
assert.equal((await db.get(`SELECT active FROM crm_products WHERE product_id = 3`)).active, 0, 'видалений у LP-CRM — неактивний, рядок лишається');
assert.equal((await db.get(`SELECT name FROM crm_products WHERE product_id = 5`)).name, 'Товар 5 перейменовано (SKU5) [30005]');
assert.notEqual((await db.get(`SELECT updated_at FROM crm_products WHERE product_id = 5`)).updated_at, upd5, 'змінений — оновлено');
assert.equal((await db.get(`SELECT updated_at FROM crm_products WHERE product_id = 1`)).updated_at, upd1, 'незмінений — не перезаписано');

// ---------- пошук: слова назви, код у дужках, ID, артикул без бренду ----------
const ids = async (q) => (await req('GET', `/api/catalog/search?q=${encodeURIComponent(q)}`)).j.products.map((x) => x.id);
assert.deepEqual(await ids('comfodry evoair'), [120]);
assert.deepEqual(await ids('30414'), [120], 'за кодом');
assert.deepEqual(await ids('122'), [122], 'за ID');
assert.deepEqual(await ids('EvoairWarmix2200B'), [122], 'артикул без бренду');
assert.deepEqual(await ids('Товар SKU3'), [3], 'неактивні теж знаходяться (після активних)');
assert.equal((await ids('Товар')).at(-1), 3, 'неактивний — останнім');
assert.deepEqual(await ids(''), []);

// ---------- бренди для нормалізації ----------
r = await req('PUT', '/api/catalog/settings', { brands: 'Evoair, DREO; levoit' });
assert.equal(r.j.brands, 'evoair,dreo,levoit');
assert.equal((await req('GET', '/api/catalog/status')).j.brands, 'evoair,dreo,levoit');

// ---------- права ----------
await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' });
const lm = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const M = { 'Content-Type': 'application/json', Cookie: lm.headers.get('set-cookie').split(';')[0] };
assert.equal((await req('GET', '/api/catalog/search?q=comfodry', null, M)).status, 200, 'менеджер шукає');
assert.equal((await req('POST', '/api/catalog/scan', null, M)).status, 403, 'прохід запускають лише адміністратори');
assert.equal((await req('PUT', '/api/catalog/settings', { brands: 'x' }, M)).status, 403);
assert.equal((await req('GET', '/api/catalog/status', null, {})).status, 401);
globalThis.setTimeout = st;
console.log('OK — каталог: розбір назв, прохід по товарах LP-CRM, неактивні, пошук, бренди, права');
