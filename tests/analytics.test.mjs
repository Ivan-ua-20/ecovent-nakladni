// Аналітика: завантаження з імітованої LP-CRM, зміна статусів, підсумки, фільтри, таргети.
import assert from 'node:assert/strict';
import { openDb } from '../src/db-node.js';
import { migrate } from '../src/schema.js';
import { createApp } from '../src/app.js';
import { kyivDay, addDays, monthStart, daysInMonth, daysBetween } from '../src/analytics.js';

const db = openDb(':memory:');
await migrate(db);
await db.run(`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`);

// ---------- імітація LP-CRM ----------
const today = kyivDay();
const PRODUCTS = {
  965: { name: 'Смартфон iHunt Titan Night Hunter [04979]', price: 21900, cat: 17 },
  452: { name: 'Premium Гідрогелева плівка на смартфон', price: 300, cat: 20 },
  701: { name: 'Осушувач повітря Evoair NovaDry 16 Smart', price: 7119.2, cat: 31 },
  702: { name: 'Рекуператор Ecovent VS-60 Pro', price: 6450, cat: 32 },
};
const OFFICES = ['5', '4', '6', '25'];
const USERS = ['rybchuk', 'ivan', 'denys', 'vlad', 'olena'];
const CH = ['Rozetka(oneday)', 'Prom(Amsterdam)', '', 'iHunt', 'Epicentr(Ecovent)'];
const STATUSES = [11, 14, 53, 18, 54, 58, 13];
const orders = new Map();
let id = 100000;
for (let d = addDays(today, -200); d <= today; d = addDays(d, 1)) {
  const n = 3 + (id % 3);
  for (let k = 0; k < n; k++) {
    id++;
    const pid = [965, 452, 701, 702][id % 4];
    const lines = [{ product_id: String(pid), name: PRODUCTS[pid].name, price: PRODUCTS[pid].price.toFixed(2), quantity: String(1 + (id % 2)) }];
    if (id % 5 === 0) lines.push({ product_id: '452', name: PRODUCTS[452].name, price: '300.00', quantity: '1' });
    const sum = lines.reduce((s, l) => s + Number(l.price) * Number(l.quantity), 0);
    const discount = id % 7 === 0 ? 100 : 0;
    const code = String(1790000000000000 + id * 37);
    orders.set(code, {
      id: String(id), order_id: code, datetime: `${d} 12:00:00`, status: String(STATUSES[id % STATUSES.length]),
      office: OFFICES[id % 4], user: USERS[id % 5], additional_1: CH[id % 5], site: '', utm_source: '',
      total: (sum - discount).toFixed(2), products: lines,
    });
  }
}
let calls = 0;
const byMethod = {};
const fetchFn = async (url, opts = {}) => {
  calls++;
  const m = url.match(/api\/(\w+)\.html/)[1];
  byMethod[m] = (byMethod[m] || 0) + 1;
  const p = new URLSearchParams(opts.body);
  const json = (o) => new Response(JSON.stringify(o));
  if (m === 'getStatuses') return json({ status: 'ok', data: { 11: 'Принят', 14: 'Отправлен', 53: 'Ожидает выкупа', 18: 'Завершено', 54: 'Відмова на пошті', 58: 'Повернуто на склад', 13: 'Відмова' } });
  if (m === 'getOrdersIdByStatus') {
    const s = p.get('status'); const a = p.get('date_start'); const b = p.get('date_end');
    return json({ status: 'ok', data: [...orders.values()].filter((o) => o.status === s && o.datetime.slice(0, 10) >= a && o.datetime.slice(0, 10) <= b).map((o) => o.order_id) });
  }
  if (m === 'getOrdersByID') {
    const ids = p.get('order_id').split(',');
    assert.ok(ids.length <= 100, 'не більше 100 замовлень за запит');
    const data = {};
    for (const x of ids) if (orders.has(x)) data[x] = orders.get(x);
    return json({ status: 'ok', data });
  }
  if (m === 'getProduct') {
    const ids = p.get('product_id').split(',');
    const data = ids.map((x) => ({ id: x, category_id: String(PRODUCTS[x]?.cat || 0), name: PRODUCTS[x]?.name || '' }));
    return json({ status: 'ok', data: data.length === 1 ? data[0] : data });
  }
  if (m === 'getCategories') return json({ status: 'ok', data: { 17: { id: 17, name: 'Смартфони' }, 30: { id: 30, name: 'Клімат', subcategories: [{ id: 31, name: 'Осушувачі', parent_id: 30 }, { id: 32, name: 'Рекуператори', parent_id: 30 }] }, 20: { id: 20, name: 'Аксесуари' } } });
  return json({ status: 'error', message: 'unknown ' + m });
};

const app = createApp({ db, fetchFn });
const setup = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'o', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body) => {
  const r = await app.request(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  assert.ok(r.status < 300, `${path}: ${r.status} ${JSON.stringify(j)}`);
  return j;
};

// Прискорюємо: без пауз між запитами до LP-CRM у тесті.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, 0, ...a);

async function runSync(mode) {
  let s = (await req('POST', '/api/an/sync/start', { mode, force: true })).state;
  let steps = 0;
  while (!s.done) {
    const r = await req('POST', '/api/an/sync/step', {});
    s = r.state;
    assert.ok(!s.error, s.error);
    if (++steps > 2000) throw new Error('sync не завершився');
  }
  return { s, steps };
}

// ---------- 1. Перше завантаження ----------
const t0 = Date.now();
const first = await runSync('full');
const windowStart = (await db.get(`SELECT value FROM settings WHERE key='an_sync'`)) && JSON.parse((await db.get(`SELECT value FROM settings WHERE key='an_sync'`)).value).start;
const inWindow = [...orders.values()].filter((o) => o.datetime.slice(0, 10) >= windowStart && ['11', '14', '53', '18', '54', '58'].includes(o.status));
const stored = (await db.get(`SELECT COUNT(*) AS n FROM an_orders WHERE status != 0`)).n;
assert.equal(stored, inWindow.length, 'усі замовлення відстежуваних статусів у вікні завантажено');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM an_orders WHERE status = 13`)).n, 0, 'статус «Відмова» не завантажується');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM an_products WHERE fetched = 0`)).n, 0, 'категорії товарів підтягнуто');
console.log(`  перше завантаження: ${stored} замовлень, ${first.steps} кроків, ${calls} запитів до LP-CRM, ${Date.now() - t0} мс`, byMethod);

// Знижка розподілена: сума рядків = сума замовлення
const chk = await db.get(`SELECT o.total AS t, (SELECT SUM(amount) FROM an_items i WHERE i.id BETWEEN o.id*100 AND o.id*100+99) AS s FROM an_orders o WHERE o.id % 7 = 0 LIMIT 1`);
assert.ok(Math.abs(chk.t - chk.s) < 0.05, 'сума рядків = сума замовлення зі знижкою');

// ---------- 2. Дашборд за поточний місяць ----------
const from = monthStart(today);
const prevFrom = addDays(from, -daysInMonth(addDays(from, -1)));
const cmpTo = addDays(prevFrom, daysBetween(from, today) - 1);
const q = await req('POST', '/api/an/query', { from, to: today, cmpFrom: prevFrom, cmpTo });
const expect = inWindow.filter((o) => o.datetime.slice(0, 10) >= from);
const expRev = expect.reduce((s, o) => s + Number(o.total), 0);
const expRef = expect.filter((o) => ['54', '58'].includes(o.status));
assert.equal(q.kpi.cur.cnt, expect.length, 'кількість замовлень');
assert.ok(Math.abs(q.kpi.cur.rev - expRev) < 0.05, 'сума замовлень');
assert.equal(q.kpi.cur.rcnt, expRef.length, 'відмови = відмова на пошті + повернуто на склад');
assert.ok(Math.abs(q.kpi.cur.net - (expRev - expRef.reduce((s, o) => s + Number(o.total), 0))) < 0.05, 'оборот без відмов');
assert.equal(q.daily.cur.length, daysBetween(from, today));
assert.ok(q.kpi.prev && q.kpi.prev.cnt > 0, 'є порівняння');
assert.ok(q.byStatus.find((x) => x.id === 54).refuse);

// ---------- 3. Відділ за менеджером ----------
const cfg = await req('GET', '/api/an/config');
const mp = cfg.depts.find((d) => d.name === 'Маркетплейси');
await req('PUT', '/api/an/managers', [{ login: 'olena', name: 'Олена', dept_id: mp.id }]);
const q2 = await req('POST', '/api/an/query', { from, to: today, depts: [mp.id] });
const exp2 = expect.filter((o) => o.user === 'olena' || o.office === '5');
assert.equal(q2.kpi.cur.cnt, exp2.length, 'відділ: менеджер має пріоритет над відділом CRM');

// ---------- 4. Джерело за полем 1 ----------
const rozetka = mp.sources.find((s) => s.name === 'Rozetka');
const q3 = await req('POST', '/api/an/query', { from, to: today, sources: [rozetka.id] });
assert.equal(q3.kpi.cur.cnt, expect.filter((o) => o.additional_1 === 'Rozetka(oneday)').length, 'джерело Rozetka');

// ---------- 5. Бренд і категорія ----------
const ihunt = q.options.brands.find((b) => b.name === 'iHunt');
const q4 = await req('POST', '/api/an/query', { from, to: today, brands: [ihunt.id] });
const exp4 = expect.filter((o) => o.products.some((l) => l.product_id === '965'));
assert.equal(q4.kpi.cur.cnt, exp4.length, 'бренд: кількість замовлень з товарами бренду');
assert.ok(q4.options.cats.some((c) => c.name === 'Смартфони') && !q4.options.cats.some((c) => c.name === 'Осушувачі'), 'категорії лише вибраного бренду');
assert.equal(q4.target.applicable, false, 'таргет не показується з фільтром бренду');
const q5 = await req('POST', '/api/an/query', { from, to: today, cats: [31, 32] });
assert.equal(q5.kpi.cur.cnt, expect.filter((o) => o.products.some((l) => ['701', '702'].includes(l.product_id))).length, 'кілька категорій');

// ---------- 6. Таргети ----------
const month = today.slice(0, 7);
await req('PUT', '/api/an/targets', { month, rows: [{ kind: 'src', ref_id: rozetka.id, amount: 300000 }, { kind: 'src', ref_id: mp.sources[1].id, amount: 100000 }, { kind: 'dept', ref_id: cfg.depts[1].id, amount: 50000 }], copyMonths: 2 });
const tq = await req('POST', '/api/an/query', { from, to: today });
const plan = Math.round(((300000 + 100000 + 50000) / daysInMonth(today)) * daysBetween(from, today) * 100) / 100;
assert.ok(Math.abs(tq.target.plan - plan) < 1, `план за період ${tq.target.plan} ≈ ${plan}`);
assert.ok(tq.target.month && tq.target.month.plan === 450000, 'місячний план = сума джерел + відділ');
assert.equal(tq.target.fact, tq.kpi.cur.net, 'факт для таргету — оборот без відмов');
const mpRow = tq.byDept.find((d) => d.id === mp.id);
assert.ok(mpRow.plan > 0, 'план відділу = сума його джерел');
const next = await req('GET', `/api/an/targets?month=${addDays(monthStart(today), 40).slice(0, 7)}`);
assert.equal(next.rows.length, 3, 'таргет скопійовано на наступні місяці');

// ---------- 7. Оновлення: зміна статусу і нове замовлення ----------
const someCode = expect.find((o) => o.status === '11').order_id;
orders.get(someCode).status = '54';
const leave = expect.find((o) => o.status === '14' && o.order_id !== someCode).order_id;
orders.get(leave).status = '13'; // пішло у невідстежуваний статус
id++;
const newCode = String(1790000000000000 + id * 37);
orders.set(newCode, { id: String(id), order_id: newCode, datetime: `${today} 18:00:00`, status: '11', office: '5', user: 'ivan', additional_1: 'Rozetka(oneday)', total: '999.00', products: [{ product_id: '452', name: PRODUCTS[452].name, price: '999.00', quantity: '1' }] });
const callsBefore = calls;
await runSync('refresh');
assert.equal((await db.get(`SELECT status FROM an_orders WHERE code = ?`, [someCode])).status, 54, 'статус оновлено');
assert.equal((await db.get(`SELECT status FROM an_orders WHERE code = ?`, [leave])).status, 0, 'замовлення поза статусами виключено');
assert.ok(await db.get(`SELECT id FROM an_orders WHERE code = ?`, [newCode]), 'нове замовлення додано');
console.log(`  щоденне оновлення: ${calls - callsBefore} запитів до LP-CRM`);

// ---------- 8. Налаштування: структура, бренди ----------
const cfg2 = await req('GET', '/api/an/config');
const depts = cfg2.depts.map((d) => ({ id: d.id, name: d.name, sources: d.sources.map((s) => ({ id: s.id, name: s.name, values: s.values })) }));
depts[0].sources.push({ name: 'Allo', values: ['allo'] });
depts.pop(); // видалити «Інше»
await req('PUT', '/api/an/structure', { depts });
const cfg3 = await req('GET', '/api/an/config');
assert.ok(cfg3.depts[0].sources.some((s) => s.name === 'Allo'));
assert.ok(!cfg3.depts.some((d) => d.name === 'Інше'));
const vals = await req('GET', '/api/an/values');
assert.ok(vals.values.some((v) => v.value === 'rozetka(oneday)'));
assert.ok(vals.users.some((u) => u.v === 'rybchuk'));
await req('PUT', '/api/an/brands', [...cfg3.brands, { name: 'Premium', keywords: 'плівка' }]);
const q6 = await req('POST', '/api/an/query', { from, to: today });
assert.ok(q6.byBrand.some((b) => b.name === 'Premium'), 'новий бренд застосовано до товарів');

// ---------- 9. Доступ ----------
await app.request('/api/users', { method: 'POST', headers: H, body: JSON.stringify({ login: 'man', password: 'pass1234', role: 'manager' }) });
const ml = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const mr = await app.request('/api/an/query', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ml.headers.get('set-cookie').split(';')[0] }, body: '{}' });
assert.equal(mr.status, 403, 'менеджер не бачить аналітику');

globalThis.setTimeout = realSetTimeout;
console.log('OK — аналітика працює');
