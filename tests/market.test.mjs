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
const addDaysT = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
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
// Відгуки на товари: до замовлень історії (поточний місяць), відповідь продавця й відгук без замовлення — не враховуються
const REVIEWS = [
  { id: 1, parent_id: 0, type: 'comment', orders_id: 600000, mark: 5, name: 'Архів', text: 'Чудово', status: 'active', created: '2026-01-01 10:00:00', changed: '2026-01-01 10:00:00', record: '{"id":"1","title":"Очищувач"}' },
  { id: 2, parent_id: 0, type: 'comment', orders_id: 600000, mark: 3, text: '', dignity: 'тихий', status: 'active', created: '2026-01-02 10:00:00', changed: '2026-01-02 10:00:00', record: { id: '2', title: 'Фільтр' } },
  { id: 3, parent_id: 0, type: 'comment', orders_id: 600001, mark: 0, text: 'Без оцінки', status: 'auto_activated', created: '2026-01-03 10:00:00', changed: '2026-01-03 10:00:00' },
  { id: 4, parent_id: 1, type: 'comment', orders_id: 600000, mark: 0, text: 'Дякуємо!', created: '2026-01-04 10:00:00', changed: '2026-01-04 10:00:00' },
  { id: 5, parent_id: 0, type: 'comment', orders_id: 0, mark: 4, text: 'Без замовлення', created: '2026-01-05 10:00:00', changed: '2026-01-05 10:00:00' },
];
const rvCalls = [];
const chatSent = [];
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
    if (u.pathname === '/item-comments/search') { // по 2 на сторінку
      const pg = Number(u.searchParams.get('page'));
      rvCalls.push(`${u.searchParams.get('sort')}|${u.searchParams.get('createdFrom') || ''}|${pg}|${u.searchParams.get('type')}`);
      const from = u.searchParams.get('createdFrom') || '';
      const list = REVIEWS.filter((x) => x.created.slice(0, 10) >= from);
      return json({ success: true, content: { itemComments: list.slice((pg - 1) * 2, pg * 2), _meta: { pageCount: Math.max(1, Math.ceil(list.length / 2)), currentPage: pg } } });
    }
    if (u.pathname === '/order-statuses/search') {
      assert.equal(u.searchParams.get('status_group'), '2');
      return json({ success: true, content: { orderStatus: [{ id: 6, name_uk: 'Виконано', status_group: 2 }], _meta: { pageCount: 1 } } });
    }
    if (/^\/messages\/\d+\/order-chat$/.test(u.pathname)) return json({ success: true, content: { id: 777, order_id: Number(u.pathname.split('/')[2]), user_id: 4242, type: 0 } });
    if (u.pathname === '/messages/create') { chatSent.push(JSON.parse(opts.body)); return json({ success: true, content: { chat_id: 777, body: 'x', status: 1 } }); }
    const page = Number(u.searchParams.get('page'));
    const cf = u.searchParams.get('created_from');
    if (cf) { // історія: за датою створення, по 2 на сторінку
      histCalls.push(`${cf}..${u.searchParams.get('created_to')}#${page}`);
      const list = HIST.filter((o) => o.created >= cf && o.created <= u.searchParams.get('created_to'));
      return json({ success: true, content: { orders: list.slice((page - 1) * 2, page * 2), _meta: { pageCount: Math.max(1, Math.ceil(list.length / 2)), totalCount: list.length, currentPage: page } } });
    }
    return json({ success: true, content: { orders: [{ id: 700000 + page, created: '2026-10-29 12:00:00', changed: '2026-10-29 12:30:00', cost: '2500.00', status: 1, status_data: { name_uk: 'Нове замовлення' }, user_phone: '380661112233', ttn: page === 2 ? 'RMP-1000000001' : '', user_title: { full_name: 'Сидоренко Ольга' }, delivery: { delivery_service_name: 'ROZETKA Delivery', ...(page === 2 ? { recipient_title: 'Петренко Іван', recipient_phone: '380501234567' } : { recipient_title: { full_name: 'Сидоренко Ольга' }, recipient_phone: '+380661112233' }) }, purchases: [{ item_id: 555, item_name: 'Зволожувач', quantity: 1, price: '2500.00' }] }], _meta: { pageCount: 2, currentPage: page } } });
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
assert.ok(calls.filter((c) => c.startsWith('api-seller.rozetka.com.ua/orders/search')).every((c) => c.includes('types=1')), 'Розетка — усі замовлення (з успішними й неуспішними)');
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
assert.deepEqual(o.rows[0].items, [{ id: '555', name: 'Зволожувач', qty: 1, price: 2500 }]);
assert.deepEqual(o.rows.map((x) => [x.id, x.recipient, x.recipient_phone]).sort(), [['700001', '', ''], ['700002', 'Петренко Іван', '380501234567']], 'отримувач — лише якщо інша людина');
o = (await req('GET', '/api/mp/orders?mp=prom&status=received')).j;
assert.equal(o.rows.length, 175);
assert.equal(o.rows[0].total, 1289.5);
assert.equal(o.rows[0].status_name, 'Прийнято');
assert.deepEqual(o.statuses.map((s) => s.n).sort(), [175, 175]);
o = (await req('GET', '/api/mp/orders?mp=rozetka&q=сидоренко')).j;
assert.equal(o.rows.length, 2, 'пошук за ім’ям без урахування регістру (кирилиця)');
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
assert.ok(histCalls.every(() => true) && calls.filter((c) => c.includes('created_from=')).every((c) => c.includes('types=1')), 'історія — теж усі замовлення');
// разовий перезапуск історії (була завантажена без успішних/неуспішних): ще раз з поточного місяця, без дублів
const before = (await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'rozetka'`)).n;
await db.run(`DELETE FROM settings WHERE key = 'mp_hist_v3'`);
const sh = (await req('GET', '/api/mp/shops')).j;
assert.ok(!sh[0].shops.find((s) => s.id === 1).history.done, 'історію перезапущено');
// денна норма: вичерпана — пауза без запитів до Розетки
await db.run(`INSERT INTO settings (key, value) VALUES ('mp_hist_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify({ day: kyivToday, n: 15000 })]);
const nCalls = calls.length;
h = (await req('POST', '/api/mp/history/step', { mp: 'rozetka', account: 1 })).j;
assert.ok(h.paused && !h.done && calls.length === nCalls, 'денну норму вичерпано — пауза');
await db.run(`DELETE FROM settings WHERE key = 'mp_hist_day'`);
steps = 0;
do { h = (await req('POST', '/api/mp/history/step', { mp: 'rozetka', account: 1 }, M)).j; steps++; } while (!h.done && steps < 100);
assert.ok(h.done, 'історію довантажено вдруге');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'rozetka'`)).n, before, 'без дублів');
const used = JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'mp_hist_day'`)).value);
assert.ok(used.day === kyivToday && used.n >= inRange, 'облік денної норми');
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

// ---------- відгуки на товари Розетки ----------
const runRv = async () => (await (await mk().request('/api/cron/run/market-reviews', { method: 'POST', headers: { 'X-Cron-Key': key } })).json());
r = await runRv();
assert.ok(r.ok && r.result.shops === 1, JSON.stringify(r));
assert.deepEqual(rvCalls, ['created||1|comment', 'created||2|comment', 'created||3|comment'], 'перше завантаження — усі відгуки від найдавніших');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_reviews`)).n, 3, 'без відповідей продавця і відгуків без замовлення');
let ord = await db.get(`SELECT review_n, review_mark FROM mp_orders WHERE mp = 'rozetka' AND id = '600000'`);
assert.deepEqual([ord.review_n, ord.review_mark], [2, 3], 'два відгуки, найнижча оцінка');
ord = await db.get(`SELECT review_n, review_mark FROM mp_orders WHERE mp = 'rozetka' AND id = '600001'`);
assert.deepEqual([ord.review_n, ord.review_mark], [1, 0]);
assert.deepEqual({ ...(await db.get(`SELECT goods, goods_id FROM mp_reviews WHERE id = '1'`)) }, { goods: 'Очищувач', goods_id: '1' });
rvCalls.length = 0;
r = await runRv();
assert.ok(r.result.skipped && !rvCalls.length, 'наступні 3 год — без запитів');
// через 3 год — лише нові (з запасом у 7 днів від минулого проходу), найновіші першими
const rvAt = new Date(Date.now() - 4 * 3600e3).toISOString();
await db.run(`UPDATE mp_sync SET rv_at = ? WHERE mp = 'rozetka' AND account_id = 1`, [rvAt]);
REVIEWS.push({ id: 6, parent_id: 0, type: 'comment', orders_id: 600002, mark: 4, text: 'Новий', status: 'active', created: `${kyivToday} 09:00:00`, changed: `${kyivToday} 09:00:00` });
const writesBefore = (await db.get(`SELECT COUNT(*) AS n FROM mp_reviews`)).n;
r = await runRv();
const since = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date(Date.parse(rvAt) - 7 * 86400e3));
assert.deepEqual(rvCalls, [`-created|${since}|1|comment`], 'нові відгуки — з датою');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_reviews`)).n, writesBefore + 1);
assert.equal((await db.get(`SELECT review_n FROM mp_orders WHERE mp = 'rozetka' AND id = '600002'`)).review_n, 1);
let sh3 = (await req('GET', '/api/mp/shops')).j[0].shops.find((s) => s.id === 1).reviews;
assert.ok(sh3.full && sh3.n === 4 && !sh3.loading, JSON.stringify(sh3));

// фільтри на сторінці: виконані (статус 6 — група «Успішні», з Розетки) без відгуку
const per = `mp=rozetka&account=1&from=${h.from}`;
o = (await req('GET', `/api/mp/orders?${per}`)).j;
assert.deepEqual(o.reviews.stats, { done: inRange, reviewed: 3, toask: inRange - 3, asked: 0, asked_reviewed: 0 }, JSON.stringify(o.reviews));
assert.equal(o.reviews.days, 3);
assert.ok(o.rows.find((x) => x.id === '600000').ok && !o.rows.find((x) => x.id === '700001').ok, 'нове замовлення — не виконане');
assert.deepEqual(o.rows.find((x) => x.id === '600000').reviews.map((v) => [v.goods_id, v.goods, v.mark]), [['1', 'Очищувач', 5], ['2', 'Фільтр', 3]], 'відгуки замовлення — по товарах');
assert.deepEqual(o.rows.find((x) => x.id === '600010').reviews, [], 'без відгуку — порожньо');
assert.equal((await req('GET', `/api/mp/orders?${per}&rv=has`)).j.total.n, 3);
assert.equal((await req('GET', `/api/mp/orders?${per}&rv=ask`)).j.total.n, inRange - 3);
assert.equal((await req('GET', `/api/mp/orders?${per}&rv=none`)).j.total.n, inRange - 3);
// нагадав (менеджер, Viber) → «нагадали, чекаємо»; статистика по менеджерах
assert.equal((await req('POST', '/api/mp/review/ask', { account: 1, id: '600010', via: 'sms' }, M)).status, 400);
r = await req('POST', '/api/mp/review/ask', { account: 1, id: '600010', via: 'viber' }, M);
assert.equal(r.status, 200);
assert.deepEqual([r.j.asked_by, r.j.asked_via], ['man', 'viber']);
assert.equal((await req('GET', `/api/mp/orders?${per}&rv=asked`)).j.rows[0].id, '600010');
o = (await req('GET', `/api/mp/orders?${per}&rv=ask`)).j;
assert.equal(o.total.n, inRange - 4, 'кому нагадали — більше не в «Можна нагадати»');
assert.deepEqual(o.reviews.by, [{ who: 'man', n: 1, reviewed: 0 }]);
r = await req('POST', '/api/mp/review/ask', { account: 1, id: '600010', undo: true }, M);
assert.equal((await db.get(`SELECT asked_at FROM mp_orders WHERE mp = 'rozetka' AND id = '600010'`)).asked_at, '', 'позначку знято');
// свіже виконане (2 дні тому) — ще рано нагадувати
await db.run(`UPDATE mp_orders SET changed_at = ? WHERE mp = 'rozetka' AND id = '600011'`, [new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(Date.now() - 2 * 86400e3))]);
assert.equal((await req('GET', `/api/mp/orders?${per}&rv=ask`)).j.total.n, inRange - 4, 'отримано менше 3 днів тому — ще рано');
// чат Розетки: без посилань і телефонів
assert.equal((await req('POST', '/api/mp/review/chat', { account: 1, id: '600012', text: 'Залиште відгук https://rozetka.com.ua/x' }, M)).status, 400);
assert.equal((await req('POST', '/api/mp/review/chat', { account: 1, id: '600012', text: 'Пишіть +380 66 111 22 33' }, M)).status, 400);
assert.equal(chatSent.length, 0);
r = await req('POST', '/api/mp/review/chat', { account: 1, id: '600012', text: 'Добрий день! Будемо вдячні за відгук про товар.' }, M);
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.deepEqual([chatSent[0].chat_id, chatSent[0].receiver_id, chatSent[0].body], [777, 4242, 'Добрий день! Будемо вдячні за відгук про товар.']);
assert.equal((await db.get(`SELECT asked_via FROM mp_orders WHERE mp = 'rozetka' AND id = '600012'`)).asked_via, 'chat');
// налаштування: текст і дні — адміни
assert.equal((await req('PUT', '/api/mp/review/settings', { days: 5, tpl: 'x' }, M)).status, 403);
assert.equal((await req('PUT', '/api/mp/review/settings', { days: 99, tpl: 'x' })).status, 400);
assert.deepEqual((await req('PUT', '/api/mp/review/settings', { days: 5, tpl: "Вітаю, {ім'я}!" })).j, { days: 5, tpl: "Вітаю, {ім'я}!" });
assert.equal((await req('GET', '/api/mp/review/settings', null, M)).j.days, 5);
assert.ok(!(await req('GET', '/api/mp/orders?mp=prom')).j.reviews, 'відгуки — лише для Розетки');

// ---------- історія за обраний період (старий кабінет — давніше за 4 роки) ----------
assert.equal((await req('POST', '/api/mp/history/start', { mp: 'rozetka', account: 1, from: '2026-05-01', to: '2026-01-01' })).status, 400, 'початок пізніше за кінець');
assert.equal((await req('POST', '/api/mp/history/start', { mp: 'rozetka', account: 1, from: '2009-12-31', to: '2026-01-01' })).status, 400, 'не давніше 2010');
assert.equal((await req('POST', '/api/mp/history/start', { mp: 'rozetka', account: 1, from: 'вчора' })).status, 400);
const oldest = HIST.map((x) => x.created.slice(0, 10)).sort()[0];
const oldTo = addDaysT(h.from, -1);
let hp = (await req('POST', '/api/mp/history/start', { mp: 'rozetka', account: 1, from: oldest, to: oldTo })).j;
assert.ok(hp.started && !hp.done && hp.from === oldest && hp.end === oldTo && hp.pct === 0, JSON.stringify(hp));
histCalls.length = 0;
steps = 0;
do { hp = (await req('POST', '/api/mp/history/step', { mp: 'rozetka', account: 1 })).j; steps++; } while (!hp.done && steps < 100);
assert.ok(hp.done && hp.pct === 100, JSON.stringify(hp));
assert.ok(histCalls[0].startsWith(`${oldTo.slice(0, 7)}-01 00:00:00..${oldTo} 23:59:59`), `з кінця обраного періоду: ${histCalls[0]}`);
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'rozetka' AND account_id = 1 AND customer LIKE 'Архів%'`)).n, HIST.length, 'давніші за 4 роки — теж у базі');
assert.equal((await db.get(`SELECT keep_from FROM mp_sync WHERE mp = 'rozetka' AND account_id = 1`)).keep_from, oldest);
// новий, коротший період не скорочує зберігання; прибирання не чіпає завантажене
await req('POST', '/api/mp/history/start', { mp: 'rozetka', account: 1, from: addDaysT(kyivToday, -30) });
assert.equal((await db.get(`SELECT keep_from FROM mp_sync WHERE mp = 'rozetka' AND account_id = 1`)).keep_from, oldest);
await db.run(`UPDATE settings SET value = '2000-01-01T00:00:00Z' WHERE key = 'cleanup_at'`);
await req('GET', '/api/mp/shops');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'rozetka' AND account_id = 1 AND customer LIKE 'Архів%'`)).n, HIST.length, 'прибирання зберігає обраний період');
console.log('OK — маркетплейси: синхронізація Розетки, Prom і Епіцентру, продовження, фільтри, перейменування, історія Розетки (й за обраний період), відгуки й нагадування');
