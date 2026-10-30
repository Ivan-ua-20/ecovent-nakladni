// Маркетплейси: синхронізація замовлень Розетки (кабінет продавця), Prom і Епіцентру в базу, продовження
// незавершеного проходу, наступні проходи — лише змінені; список з фільтрами; перейменування магазину; права.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
await db.batch([
  [`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'Ековент', 'u', 'p', 'rztok', ?, 1, ?), (2, 'OneDay', 'u2', 'p2', 'rztok2', ?, 0, ?)`, [now, now, now, now]],
  [`INSERT INTO prom_accounts (id, name, token, active, created_at) VALUES (1, 'Prom Arca', 'promtok', 1, ?)`, [now]],
  [`INSERT INTO epc_accounts (id, name, token, active, created_at) VALUES (1, 'Епіцентр Ecovent', 'epctok', 1, ?)`, [now]],
]);

const PROM = Array.from({ length: 350 }, (_, i) => ({
  id: 5000 + i, date_created: '2026-10-29T10:00:00+00:00', status: i % 2 ? 'received' : 'pending', status_name: i % 2 ? 'Прийнято' : 'Нове',
  client_first_name: 'Іван', client_last_name: `Петренко${i}`, phone: '+380501112233', full_price: '1 289,50 грн',
  delivery_option: { name: 'Нова Пошта' }, delivery_provider_data: { declaration_number: i === 7 ? '20450000000777' : null },
  products: [{ name: 'Очищувач HOMI', quantity: 1, price: '1 289,50 грн' }],
}));
// Історія Розетки: по 3 замовлення на місяць за 50 місяців (останні 2 роки… 4+ роки тому — понад межу)
const kyivToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
const HIST = [];
for (let mth = 0; mth < 50; mth++) {
  const d = new Date(Date.parse(`${kyivToday.slice(0, 7)}-15T12:00:00Z`));
  d.setUTCMonth(d.getUTCMonth() - mth);
  for (let k = 0; k < 3; k++) {
    const day = `${d.toISOString().slice(0, 8)}${String(10 + k).padStart(2, '0')}`;
    HIST.push({ id: 600000 + mth * 10 + k, created: `${day} 10:00:00`, changed: `${day} 11:00:00`, cost: '100.00', status: 6, status_data: { name_uk: 'Виконано' }, user_phone: '380', user_title: { full_name: `Архів ${mth}` }, purchases: [] });
  }
}
const histCalls = [];
const calls = [];
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  calls.push(`${u.host}${u.pathname}${u.search}`);
  const json = (o) => new Response(JSON.stringify(o));
  if (u.host === 'my.prom.ua') {
    assert.equal(opts.headers.Authorization, 'Bearer promtok');
    const lastId = Number(u.searchParams.get('last_id')) || Infinity;
    const list = PROM.filter((o) => o.id <= lastId).sort((a, b) => b.id - a.id).slice(0, Number(u.searchParams.get('limit')));
    return json({ orders: list });
  }
  if (u.host === 'merchant-api.epicentrm.com.ua') {
    const cur = u.searchParams.get('cursor');
    const page = cur === 'p2' ? [{ id: 'e2', number: '900002', createdAt: '2026-10-29T08:00:00Z', statusCode: 'sent', subtotal: 500, address: { firstName: 'Олена', lastName: 'Коваль', phone: '380671112233', shipment: { provider: 'cvz_epicentr', number: 'EPC777' } }, items: [{ title: 'Фільтр', quantity: 2, price: 250 }] }]
      : [{ id: 'e1', number: '900001', createdAt: '2026-10-29T09:00:00Z', statusCode: 'new', subtotal: 1000, address: { firstName: 'Олег', lastName: 'Мельник', phone: '380931112233', shipment: { provider: 'nova_poshta', number: null } }, items: [{ title: 'Вентилятор', quantity: 1, price: 1000 }] }];
    return json({ current: cur || 'p1', next: cur === 'p2' ? '' : 'p2', items: page });
  }
  if (u.host === 'api-seller.rozetka.com.ua') {
    assert.equal(opts.headers.Authorization, 'Bearer rztok', 'вимкнений магазин не синхронізується');
    const page = Number(u.searchParams.get('page'));
    const cf = u.searchParams.get('created_from');
    if (cf) { // історія: за датою створення, по 2 на сторінку
      histCalls.push(`${cf}..${u.searchParams.get('created_to')}#${page}`);
      const list = HIST.filter((o) => o.created >= cf && o.created <= u.searchParams.get('created_to'));
      return json({ success: true, content: { orders: list.slice((page - 1) * 2, page * 2), _meta: { pageCount: Math.max(1, Math.ceil(list.length / 2)), totalCount: list.length, currentPage: page } } });
    }
    return json({ success: true, content: { orders: [{ id: 700000 + page, created: '2026-10-29 12:00:00', changed: '2026-10-29 12:30:00', cost: '2500.00', status: 1, status_data: { name_uk: 'Нове замовлення' }, user_phone: '380661112233', ttn: page === 2 ? 'RMP-1000000001' : '', user_title: { full_name: 'Сидоренко Ольга' }, delivery: { delivery_service_name: 'ROZETKA Delivery' }, purchases: [{ item_name: 'Зволожувач', quantity: 1, price: '2500.00' }] }], _meta: { pageCount: 2, currentPage: page } } });
  }
  throw new Error(`неочікуваний запит ${url}`);
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const { key } = (await req('POST', '/api/jobs/key')).j;
const runCron = async () => (await req('POST', '/api/cron/run/market', null, { 'X-Cron-Key': key })).j;

// ---------- перший прохід: Розетка 2 сторінки, Prom 3 сторінки зі 4 (незавершено), Епіцентр 2 сторінки ----------
let r = await runCron();
assert.ok(r.ok, JSON.stringify(r));
assert.deepEqual([r.result.shops, r.result.more, r.result.errors], [3, 1, 0], JSON.stringify(r.result));
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'prom'`)).n, 300);
assert.ok(calls.some((c) => c.startsWith('api-seller.rozetka.com.ua/orders/search') && c.includes('changed_from=')), 'Розетка — за датою зміни');
const promSync = await db.get(`SELECT * FROM mp_sync WHERE mp = 'prom'`);
assert.equal(promSync.cursor, '5049', 'Prom продовжить з наступної сторінки');

// ---------- другий прохід: Prom довантажує решту з курсора й завершує ----------
calls.length = 0;
r = await runCron();
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'prom'`)).n, 350);
assert.ok(calls.some((c) => c.includes('last_id=5049')));
const promDone = await db.get(`SELECT * FROM mp_sync WHERE mp = 'prom'`);
assert.equal(promDone.cursor, '');
assert.ok(promDone.since, 'наступного разу — лише змінені');
calls.length = 0;
await runCron();
const promCall = calls.find((c) => c.startsWith('my.prom.ua'));
assert.match(promCall, /last_modified_from=/);
assert.ok(!/last_id=/.test(promCall), 'новий прохід — з першої сторінки');

// ---------- сторінка: магазини, замовлення, фільтри ----------
const shops = (await req('GET', '/api/mp/shops')).j;
assert.deepEqual(shops.map((m) => m.key), ['rozetka', 'prom', 'epc']);
const rz = shops.find((m) => m.key === 'rozetka').shops;
assert.deepEqual(rz.map((s) => [s.name, s.orders, s.active]), [['OneDay', 0, false], ['Ековент', 2, true]]);
let o = (await req('GET', '/api/mp/orders?mp=rozetka')).j;
assert.equal(o.rows.length, 2);
assert.equal(o.rows.find((x) => x.ttn).ttn, 'RMP-1000000001');
assert.equal(o.rows[0].customer, 'Сидоренко Ольга');
assert.deepEqual(o.rows[0].items, [{ name: 'Зволожувач', qty: 1, price: 2500 }]);
o = (await req('GET', '/api/mp/orders?mp=prom&status=received')).j;
assert.equal(o.rows.length, 175);
assert.equal(o.rows[0].total, 1289.5);
assert.equal(o.rows[0].status_name, 'Прийнято');
assert.deepEqual(o.statuses.map((s) => s.n).sort(), [175, 175]);
o = (await req('GET', '/api/mp/orders?mp=prom&q=20450000000777')).j;
assert.equal(o.rows.length, 1, 'пошук за ТТН');
o = (await req('GET', '/api/mp/orders?mp=epc&account=1')).j;
assert.deepEqual(o.rows.map((x) => [x.number, x.status_name, x.delivery, x.ttn]), [['900001', 'Новий', 'Нова пошта', ''], ['900002', 'Відправлено', 'Центр видачі Епіцентр', 'EPC777']]);
assert.equal(o.rows[0].created_at, '2026-10-29 11:00:00', 'час — за Києвом (UTC+2 після переходу на зимовий)');
assert.equal((await req('GET', '/api/mp/orders?mp=ebay')).status, 400);

// ---------- «Оновити зараз», перейменування й права ----------
r = await req('POST', '/api/mp/sync', { mp: 'epc', account: 1 });
assert.equal(r.status, 200);
r = await req('PUT', '/api/mp/shops/rozetka/2', { name: '  Rozetka OneDay  ' });
assert.equal(r.j.name, 'Rozetka OneDay');
assert.equal((await db.get(`SELECT name FROM rz_accounts WHERE id = 2`)).name, 'Rozetka OneDay', 'та сама назва — і в налаштуваннях доставки');
await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' });
const lm = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const M = { 'Content-Type': 'application/json', Cookie: lm.headers.get('set-cookie').split(';')[0] };
assert.equal((await req('GET', '/api/mp/orders?mp=prom', null, M)).status, 200, 'менеджер бачить замовлення');
assert.equal((await req('PUT', '/api/mp/shops/prom/1', { name: 'X' }, M)).status, 403, 'перейменовують лише адміни');
// ---------- історія Розетки за 4 роки ----------
assert.equal((await req('POST', '/api/mp/history/start', { mp: 'rozetka', account: 1 }, M)).status, 403, 'почати історію — лише адміни');
assert.equal((await req('POST', '/api/mp/history/start', { mp: 'prom', account: 1 })).status, 400, 'історія — лише для Розетки');
let h = (await req('POST', '/api/mp/history/start', { mp: 'rozetka', account: 1 })).j;
assert.ok(h.started && !h.done && h.pct === 0);
// фонова задача: 5 сторінок за запуск; у кожному місяці 3 замовлення = 2 сторінки
r = await (await mk().request('/api/cron/run/market-history', { method: 'POST', headers: { 'X-Cron-Key': key } })).json();
assert.ok(r.ok && r.result.shops === 1 && r.result.saved > 0, JSON.stringify(r));
assert.match(histCalls[0], new RegExp(`^${kyivToday.slice(0, 7)}-01 00:00:00\\.\\.${kyivToday} 23:59:59#1$`), 'спершу поточний місяць');
let steps = 0;
do { h = (await req('POST', '/api/mp/history/step', { mp: 'rozetka', account: 1 }, M)).j; steps++; } while (!h.done && steps < 100);
assert.ok(h.done && h.pct === 100, JSON.stringify(h));
const inRange = HIST.filter((o) => o.created.slice(0, 10) >= h.from).length;
assert.ok(inRange >= 140 && inRange < 150, 'у межах 4 років — ~48 місяців');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'rozetka' AND account_id = 1 AND customer LIKE 'Архів%'`)).n, inRange, 'усі замовлення 4 років — у базі, старші — ні');
const shops2 = (await req('GET', '/api/mp/shops')).j;
assert.ok(shops2[0].shops.find((s) => s.id === 1).history.done, 'прогрес — у списку магазинів');
assert.ok((await mk().request('/api/cron/run/market-history', { method: 'POST', headers: { 'X-Cron-Key': key } })).ok);
// період і «Показати ще»
o = (await req('GET', `/api/mp/orders?mp=rozetka&account=1&from=${h.from}&to=${kyivToday}`)).j;
assert.equal(o.total.n, inRange + 2, 'період: історія + 2 свіжі');
assert.equal(o.total.sum, Math.round((inRange * 100 + 2 * 2500) * 100) / 100);
const lastYear = (await req('GET', `/api/mp/orders?mp=rozetka&account=1&from=${HIST[12 * 3].created.slice(0, 10)}`)).j;
assert.ok(lastYear.total.n < o.total.n && lastYear.total.n >= 36, 'вужчий період — менше');
o = (await req('GET', '/api/mp/orders?mp=prom')).j;
assert.ok(o.rows.length === 300 && o.more && o.total.n === 350, '«Показати ще» — коли понад 300');
const o2 = (await req('GET', '/api/mp/orders?mp=prom&offset=300')).j;
assert.ok(o2.rows.length === 50 && !o2.more);
// зберігання: Розетка — 4 роки, Prom — 45 днів
await db.run(`UPDATE mp_orders SET created_at = '2020-01-01 10:00:00' WHERE mp = 'prom' AND id = '5000'`);
await db.run(`UPDATE mp_orders SET created_at = ? WHERE mp = 'rozetka' AND id = '600000'`, [`${h.from} 12:00:00`]);
await db.run(`UPDATE settings SET value = '2000-01-01T00:00:00Z' WHERE key = 'cleanup_at'`);
await db.run(`INSERT INTO settings (key, value) VALUES ('cleanup_at', '2000-01-01T00:00:00Z') ON CONFLICT(key) DO NOTHING`);
await req('GET', '/api/mp/shops');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'prom' AND id = '5000'`)).n, 0, 'старе замовлення Prom прибрано');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'rozetka' AND id = '600000'`)).n, 1, 'історія Розетки лишається');
console.log('OK — маркетплейси: синхронізація Розетки, Prom і Епіцентру, продовження, фільтри, перейменування, історія Розетки');
