// Аналітика: завантаження з імітованої LP-CRM, зміна статусів, підсумки, фільтри, таргети.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { kyivDay, addDays, monthStart, daysInMonth, daysBetween } from '../src/modules/analytics/index.js';

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
const DELIV = ['Нова Пошта', 'Укрпошта', 'Rozetka Delivery', 'Самовивіз', 'Нова пошта (адресна)', ''];
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
      total: (sum - discount).toFixed(2), products: lines, delivery: DELIV[id % DELIV.length], delivery_id: DELIV[id % DELIV.length] ? String(1 + (id % DELIV.length)) : '0',
    });
  }
}
let calls = 0;
const byMethod = {};
const tgSent = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tgSent.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: {} })); }
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
  await db.run(`UPDATE settings SET value = json_set(value, '$.refreshGapMin', 0) WHERE key = 'an_settings'`); // тести: без паузи між оновленнями
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
const expDone = expect.filter((o) => o.status === '18');
assert.equal(q.kpi.cur.dcnt, expDone.length, 'завершені — статус «Завершено»');
assert.ok(Math.abs(q.kpi.cur.drev - expDone.reduce((s, o) => s + Number(o.total), 0)) < 0.05, 'сума завершених');
assert.ok(Math.abs(q.kpi.cur.rrev - expRef.reduce((s, o) => s + Number(o.total), 0)) < 0.05, 'сума відмов і повернень');
assert.equal(q.kpi.cur.ncnt, expect.length - expRef.length, 'кількість без відмов');
assert.deepEqual(q.kpi.doneStatuses, [18]);
const grp = Object.fromEntries(q.byStatusGroup.map((g) => [g.id, g]));
const cntOf = (ids) => expect.filter((o) => ids.includes(o.status)).length;
const revOf = (ids) => expect.filter((o) => ids.includes(o.status)).reduce((s, o) => s + Number(o.total), 0);
assert.deepEqual([grp.accepted.cnt, grp.done.cnt, grp.shipping.cnt, grp.refused.cnt], [cntOf(['11']), cntOf(['18']), cntOf(['14', '53']), cntOf(['54', '58'])], 'групи статусів: кількість');
assert.ok(Math.abs(grp.shipping.rev - revOf(['14', '53'])) < 0.05 && Math.abs(grp.refused.rev - revOf(['54', '58'])) < 0.05, 'групи статусів: суми');
assert.deepEqual(grp.shipping.statuses, [14, 53]);
assert.equal(q.byStatusGroup.reduce((a, g) => a + g.cnt, 0), q.kpi.cur.cnt, 'групи покривають усі замовлення');
// «Відправлено» — усі, крім «Прийнято» (відправлено, очікує викупу, завершено, відмови, повернення).
assert.equal(q.kpi.cur.scnt, q.kpi.cur.cnt - grp.accepted.cnt, 'відправлено: кількість');
assert.ok(Math.abs(q.kpi.cur.srev - (q.kpi.cur.rev - grp.accepted.rev)) < 0.05, 'відправлено: сума');
assert.ok(q.kpi.prev.srev != null);
// Кожен менеджер: його рядок у «Менеджерах» = «Динаміка» з фільтром за ним (і сума, і оборот без відмов).
for (const m of q.byManager) {
  const one = await req('POST', '/api/an/query', { from, to: today, managers: [m.login || ''] });
  const daySum = (k) => one.daily.cur.reduce((a, d) => a + d[k], 0);
  assert.ok(Math.abs(daySum('rev') - m.rev) < 0.05 && Math.abs(daySum('net') - m.net) < 0.05, `менеджер ${m.login}: динаміка = рядок менеджера`);
  assert.ok(m.prevNet != null, 'є оборот без відмов для порівняння');
}
assert.equal(q.daily.cur.length, daysBetween(from, today));
assert.ok(q.kpi.prev && q.kpi.prev.cnt > 0, 'є порівняння');
assert.ok(q.byStatus.find((x) => x.id === 54).refuse);
// Служби доставки: усі статуси за період, схожі назви — в одну групу.
const dv = Object.fromEntries(q.byDelivery.map((r) => [r.name, r]));
const dcnt = (names) => expect.filter((o) => names.includes(o.delivery)).length;
assert.equal(dv['Нова пошта'].cnt, dcnt(['Нова Пошта', 'Нова пошта (адресна)']), '«Нова Пошта» і «Нова пошта (адресна)» — одна група');
assert.equal(dv['Укрпошта'].cnt, dcnt(['Укрпошта']));
assert.equal(dv['Розетка'].cnt, dcnt(['Rozetka Delivery']));
assert.equal(dv['Самовивіз'].cnt, dcnt(['Самовивіз']));
assert.equal(dv['Не вказано'].cnt, dcnt(['']));
assert.equal(q.byDelivery.reduce((a, r) => a + r.cnt, 0), q.kpi.cur.cnt, 'служби доставки покривають усі замовлення');
assert.ok(q.byDelivery.every((r) => r.prevCnt != null), 'є порівняння з попереднім періодом');

// Дозаповнення історії: старі замовлення без служби доставки заповнюються під час оновлення.
await db.run(`UPDATE an_orders SET deliv = NULL WHERE day < ?`, [addDays(today, -3)]);
await db.run(`DELETE FROM settings WHERE key = 'an_deliv_fill'`);
await db.run(`UPDATE settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'an_ver'`);
const qPend = await req('POST', '/api/an/query', { from: addDays(today, -60), to: today });
assert.ok(qPend.byDelivery.some((r) => r.pending && r.cnt > 0), '«Ще завантажується» видно до дозаповнення');
await runSync('today');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM an_orders WHERE deliv IS NULL`)).n, 0, 'історію дозаповнено');
const fillState = JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'an_deliv_fill'`)).value);
assert.ok(fillState.done, 'дозаповнення завершено і більше не запускається');
const qFilled = await req('POST', '/api/an/query', { from, to: today, cmpFrom: prevFrom, cmpTo });
assert.deepEqual(qFilled.byDelivery.map((r) => [r.name, r.cnt]), q.byDelivery.map((r) => [r.name, r.cnt]), 'після дозаповнення — ті самі цифри');

// ---------- 3. Відділ за менеджером ----------
const cfg = await req('GET', '/api/an/config');
const mp = cfg.depts.find((d) => d.name === 'Маркетплейси');
await req('PUT', '/api/an/managers', [{ login: 'olena', name: 'Олена', dept_id: mp.id }]);
const q2 = await req('POST', '/api/an/query', { from, to: today, depts: [mp.id] });
const exp2 = expect.filter((o) => o.user === 'olena' || ['5', '25'].includes(o.office));
assert.equal(q2.kpi.cur.cnt, exp2.length, 'відділ: менеджер має пріоритет над відділом CRM');

// ---------- 4. Джерело за полем 1 ----------
const rozetka = mp.sources.find((s) => s.name === 'Rozetka (OneDay)');
assert.ok(!cfg.depts.some((d) => d.name === 'Сайти') && cfg.depts.some((d) => d.name === 'Riteil'), 'нова структура відділів');
assert.ok(!JSON.stringify(cfg.depts).toLowerCase().includes('techno'), 'Techno-Expert прибрано');
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
orders.get(someCode).total = '123.00'; // зі зміною статусу змінилась і сума — має підтягнутися
const quiet = expect.find((o) => o.status === '18' && o.datetime.slice(0, 10) < today && o.order_id !== someCode);
const quietTotal = (await db.get(`SELECT total FROM an_orders WHERE code = ?`, [quiet.order_id])).total;
orders.get(quiet.order_id).total = '1.00'; // статус той самий — щоденне оновлення повні дані не перечитує
const leave = expect.find((o) => o.status === '14' && o.order_id !== someCode).order_id;
orders.get(leave).status = '13'; // пішло у невідстежуваний статус
id++;
const newCode = String(1790000000000000 + id * 37);
orders.set(newCode, { id: String(id), order_id: newCode, datetime: `${today} 18:00:00`, status: '11', office: '5', user: 'ivan', additional_1: 'Rozetka(oneday)', total: '999.00', products: [{ product_id: '452', name: PRODUCTS[452].name, price: '999.00', quantity: '1' }] });
const callsBefore = calls;
await runSync('daily');
assert.equal((await db.get(`SELECT status FROM an_orders WHERE code = ?`, [someCode])).status, 54, 'статус оновлено');
assert.equal((await db.get(`SELECT total FROM an_orders WHERE code = ?`, [someCode])).total, 123, 'для зміненого статусу повні дані перечитано');
assert.equal((await db.get(`SELECT total FROM an_orders WHERE code = ?`, [quiet.order_id])).total, quietTotal, 'без зміни статусу повні дані не перечитуються');
orders.get(quiet.order_id).total = String(quietTotal);
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

// ---------- 8b. Кеш дашборду, режим «сьогодні», «Потребує уваги» ----------
const qa = await req('POST', '/api/an/query', { from, to: today });
assert.ok(await db.get(`SELECT key FROM an_cache LIMIT 1`), 'відповідь дашборду збережено в кеші');
const qb = await req('POST', '/api/an/query', { from, to: today });
assert.deepEqual(qa.kpi, qb.kpi, 'кеш повертає ті самі дані');
id++;
const todayCode = String(1790000000000000 + id * 37);
orders.set(todayCode, { id: String(id), order_id: todayCode, datetime: `${today} 19:00:00`, status: '11', office: '99', user: 'newbie', additional_1: 'NewShop', total: '500.00', products: [{ product_id: '777', name: 'Зволожувач DREO HM311', price: '500.00', quantity: '1' }] });
PRODUCTS[777] = { name: 'Зволожувач DREO HM311', price: 500, cat: 31 };
// старіше замовлення змінило статус «Принят» → «Повернуто на склад»: «Оновити сьогодні» має це підхопити
const older = [...orders.values()].find((o) => o.status === '11' && o.datetime.slice(0, 10) < today && o.datetime.slice(0, 10) >= addDays(today, -20));
older.status = '58';
const callsToday = calls;
const st7 = (await runSync('today')).s;
assert.equal(st7.mode, 'today');
assert.equal((await db.get(`SELECT status FROM an_orders WHERE code = ?`, [older.order_id])).status, 58, '«Оновити сьогодні» оновлює статуси старіших замовлень');
console.log(`  оновлення за сьогодні: ${calls - callsToday} запитів до LP-CRM`);
assert.ok(await db.get(`SELECT id FROM an_orders WHERE code = ?`, [todayCode]), 'сьогоднішнє замовлення додано');
assert.ok(!(await db.get(`SELECT key FROM an_cache LIMIT 1`)), 'кеш очищено після оновлення');
const qc = await req('POST', '/api/an/query', { from, to: today });
assert.equal(qc.kpi.cur.cnt, qa.kpi.cur.cnt + 1, 'дашборд бачить нове замовлення');
const att = await req('GET', '/api/an/attention');
assert.ok(att.users.some((u) => u.v === 'newbie'), 'новий менеджер');
assert.ok(att.values.some((v) => v.value === 'newshop'), 'нове значення Поле 1');
assert.ok(att.offices.some((o) => String(o.v) === '99'), 'новий відділ CRM');
assert.equal(att.products.fresh, 1, 'новий товар');
const pr = await req('GET', '/api/an/products');
const p777 = pr.products.find((x) => x.id === 777);
assert.equal(p777.seen, 0);
assert.equal(qc.options.brands.find((b) => b.id === p777.brand_id)?.name, 'DREO', 'бренд з назви');
// бренд з категорії: товар без бренду в назві, категорія «Ecovent …»
await db.run(`INSERT OR REPLACE INTO an_categories (id, name, parent_id) VALUES (88, 'Вентиляція Ecovent', NULL)`);
await db.run(`INSERT INTO an_products (product_id, name, brand_id, category_id, fetched) VALUES (888, 'Фільтр G4', 0, 88, 1)`);
await req('PUT', '/api/an/products', [{ id: 452, brand_manual: ihunt.id, cat_manual: '' }]);
const pr2 = await req('GET', '/api/an/products');
assert.equal(pr2.products.find((x) => x.id === 888).brand_id, qc.options.brands.find((b) => b.name === 'Ecovent').id, 'бренд з категорії');
assert.equal(pr2.products.find((x) => x.id === 452).brand_id, ihunt.id, 'ручна прив\'язка бренду');
await req('PUT', '/api/an/ignore', { kind: 'users', value: 'newbie', on: true });
await req('POST', '/api/an/products/seen', {});
const att2 = await req('GET', '/api/an/attention');
assert.ok(!att2.users.some((u) => u.v === 'newbie') && att2.products.fresh === 0, 'приховано і переглянуто');
const sy = await req('GET', '/api/an/sync');
assert.equal(sy.dailyDue, false, 'щоденне оновлення вже виконано');

// ---------- 8c. Соцмережі одним відділом; менеджер у кількох відділах ----------
const cfgS = await req('GET', '/api/an/config');
const soc = cfgS.depts.find((d) => d.name === 'Соцмережі');
assert.ok(soc && soc.sources.map((x) => x.name).join() === 'Інстаграм,Фейсбук,ТікТок', 'відділ Соцмережі з трьома джерелами');
assert.ok(!cfgS.depts.some((d) => ['Інстаграм', 'Фейсбук', 'ТікТок'].includes(d.name)));
const mpS = cfgS.depts.find((d) => d.name === 'Маркетплейси');
// denys: основний — Соцмережі, також Маркетплейси → замовлення з джерел/відділів CRM Маркетплейсів ідуть туди
await req('PUT', '/api/an/managers', [{ login: 'denys', name: 'Денис', dept_id: soc.id, depts: [mpS.id] }]);
const mpSrcValues = new Set(mpS.sources.flatMap((x) => x.values));
const ivanAll = await db.all(`SELECT ch, office, dept FROM an_orders WHERE user = 'denys'`);
const off = new Map((await db.all(`SELECT office, dept_id FROM an_office_map`)).map((r) => [r.office, r.dept_id]));
for (const o of ivanAll) {
  const exp = mpSrcValues.has(o.ch) || off.get(o.office) === mpS.id ? mpS.id : soc.id;
  assert.equal(o.dept, exp, `відділ замовлення denys (${o.ch}, офіс ${o.office})`);
}
assert.ok(ivanAll.some((o) => o.dept === mpS.id) && ivanAll.some((o) => o.dept === soc.id), 'замовлення менеджера в обох відділах');
const cfgM = await req('GET', '/api/an/config');
assert.equal(cfgM.managers.find((m) => m.login === 'denys').depts, `${soc.id},${mpS.id}`);

// ---------- 9. Доступ: менеджер бачить лише свої замовлення ----------
const cu = await (await app.request('/api/users', { method: 'POST', headers: H, body: JSON.stringify({ login: 'man', password: 'pass1234', role: 'manager' }) })).json();
const ml = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const MH = { 'Content-Type': 'application/json', Cookie: ml.headers.get('set-cookie').split(';')[0] };
const mreq = async (method, path, body) => app.request(path, { method, headers: MH, body: body ? JSON.stringify(body) : undefined });
let mq = await (await mreq('POST', '/api/an/query', { from, to: today })).json();
assert.deepEqual(mq.own, { logins: [] }, 'без прив’язки — порожньо');
assert.equal(mq.kpi.cur.cnt, 0);
await app.request(`/api/users/${cu.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ crm_logins: 'Olena, ivan' }) });
mq = await (await mreq('POST', '/api/an/query', { from, to: today, managers: ['denys'] })).json();
const mine = (await req('POST', '/api/an/query', { from, to: today, managers: ['olena', 'ivan'] })).kpi.cur.cnt;
assert.ok(mine > 0 && mq.kpi.cur.cnt === mine, 'менеджер бачить лише замовлення своїх логінів');
assert.equal(mq.target.applicable, false, 'без таргету');
assert.ok(mq.byManager.every((m) => ['olena', 'ivan'].includes(m.login)));
assert.ok(mq.byDept.every((d) => !d.plan) && mq.bySource.every((x) => !x.plan), 'без планів');
for (const [m, pth, body] of [['GET', '/api/an/config'], ['GET', '/api/an/targets?month=2026-10'], ['GET', '/api/an/attention'], ['PUT', '/api/an/settings', {}], ['POST', '/api/an/sync/start', { mode: 'full' }], ['GET', '/api/users']]) {
  assert.equal((await mreq(m, pth, body)).status, 403, `менеджеру заборонено ${m} ${pth}`);
}
assert.equal((await mreq('GET', '/api/an/sync')).status, 200);
assert.equal((await mreq('POST', '/api/an/sync/start', { mode: 'today', force: true })).status, 403, 'менеджер вручну не оновлює');
// Ліміт ручних оновлень задає власник: пауза між оновленнями і кількість на добу.
await req('PUT', '/api/an/settings', { refreshPerDay: 3, refreshGapMin: 30 });
let stt = (await req('GET', '/api/an/config')).settings || (await req('GET', '/api/an/config')).st;
await db.run(`UPDATE settings SET value = ? WHERE key = 'an_last_sync'`, [new Date().toISOString()]);
let lim = await app.request('/api/an/sync/start', { method: 'POST', headers: H, body: JSON.stringify({ mode: 'today', force: true }) });
assert.equal(lim.status, 429);
assert.match((await lim.json()).error, /наступне оновлення можна о/);
await db.run(`UPDATE settings SET value = ? WHERE key = 'an_last_sync'`, [new Date(Date.now() - 3600e3).toISOString()]);
await db.run(`INSERT INTO settings (key, value) VALUES ('an_today_cnt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify({ day: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' }), n: 3 })]);
lim = await app.request('/api/an/sync/start', { method: 'POST', headers: H, body: JSON.stringify({ mode: 'today', force: true }) });
assert.equal(lim.status, 429);
assert.match((await lim.json()).error, /Ліміт оновлень на сьогодні вичерпано \(3\)/);
const rs = (await req('GET', '/api/an/sync')).refresh;
assert.deepEqual([rs.perDay, rs.used, rs.left], [3, 3, 0]);
void stt;

// ---------- 10. Передача прав власника ----------
assert.equal((await app.request('/api/users/transfer-owner', { method: 'POST', headers: MH, body: JSON.stringify({ userId: 1, myRole: 'viewer', password: 'pass1234' }) })).status, 403, 'лише власник');
assert.equal((await app.request('/api/users/transfer-owner', { method: 'POST', headers: H, body: JSON.stringify({ userId: cu.id, myRole: 'admin', password: 'wrong' }) })).status, 400, 'потрібен пароль');
assert.equal((await app.request('/api/users/transfer-owner', { method: 'POST', headers: H, body: JSON.stringify({ userId: cu.id, myRole: 'admin', password: 'secret123' }) })).status, 200);
const roles = Object.fromEntries((await db.all(`SELECT login, role FROM users`)).map((r) => [r.login, r.role]));
assert.deepEqual(roles, { o: 'admin', man: 'owner' }, 'новий власник і нова роль колишнього');

// ---------- Дублі ТТН у LP-CRM → менеджеру в Telegram ----------
{
  // замовлення відстежуваних статусів за останні дні; зміна статусу — щоб «Оновити сьогодні» перечитало їх повністю
  const trackedRows = await db.all(`SELECT code, status FROM an_orders WHERE day >= ? AND status != 0 ORDER BY id DESC LIMIT 40`, [addDays(today, -10)]);
  const trackedSt = [...new Set(trackedRows.map((r) => r.status))];
  assert.ok(trackedRows.length >= 4 && trackedSt.length >= 2, 'є свіжі замовлення');
  const [a, b, c2, d] = trackedRows.slice(0, 4).map((r) => orders.get(r.code));
  const flip = (o) => { o.status = String(trackedSt.find((x) => String(x) !== o.status)); };
  await db.batch([
    [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
    [`UPDATE users SET tg_chat_id = '42', crm_logins = ? WHERE login = 'o'`, [c2.user]],
  ]);
  a.ttn = '20450000001111'; b.ttn = '20 4500 0000 1111'; flip(a); flip(b);
  await db.run(`DELETE FROM settings WHERE key = 'an_today_cnt'`);
  await runSync('today');
  assert.equal(tgSent.length, 0, 'перше надходження ТТН — без сповіщень про наявні дублі');
  assert.ok((await req('GET', '/api/an/config')).ttnSeen, 'видно, що ТТН приходять');
  c2.ttn = '59000000002222'; d.ttn = '59000000002222'; flip(c2); flip(d);
  await db.run(`DELETE FROM settings WHERE key = 'an_today_cnt'`);
  await runSync('today');
  const msg = tgSent.filter((m) => /Дубль ТТН 59000000002222/.test(m.text));
  assert.equal(msg.length, 1, 'одне сповіщення');
  assert.equal(String(msg[0].chat_id), '42', 'менеджеру замовлення (за логіном LP-CRM)');
  assert.ok(msg[0].text.includes(c2.order_id) && msg[0].text.includes(d.order_id));
  await db.run(`DELETE FROM settings WHERE key = 'an_today_cnt'`);
  await runSync('today');
  assert.equal(tgSent.filter((m) => /59000000002222/.test(m.text)).length, 1, 'не повторюється');
  await db.run(`UPDATE users SET tg_chat_id = '', crm_logins = '' WHERE login = 'o'`);
}

globalThis.setTimeout = realSetTimeout;
console.log('OK — аналітика працює');
