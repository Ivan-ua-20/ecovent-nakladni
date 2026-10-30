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
console.log('OK — маркетплейси: синхронізація Розетки, Prom і Епіцентру, продовження, фільтри, перейменування');
