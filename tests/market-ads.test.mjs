// Маркетплейси → «Реклама»: кампанії Розетки (статистика за весь час), замовлення з реклами за період (по кампаніях і товарах),
// наша колонка «усі замовлення за період» (mp_orders, без скасованих), «немає доступу» — зрозумілий текст, доступ до магазину.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
await db.run(`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'Ековент', 'u', 'p', 'tok', ?, 1, ?), (2, 'OneDay', 'u2', 'p', 'tok2', ?, 1, ?)`, [now, now, now, now]);
const ord = (id, day, items, group = 1) => db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, status_group)
  VALUES ('rozetka', 1, ?, ?, ?, ?, '1', 'Нове', 'К', '380', 100, ?, ?)`, [id, id, `${day} 10:00:00`, `${day} 10:00:00`, JSON.stringify(items), group]);
await ord('o1', '2026-11-25', [{ id: '111', name: 'A', qty: 2, price: 100 }]);
await ord('o2', '2026-11-26', [{ id: '111', name: 'A', qty: 1, price: 100 }, { id: '222', name: 'B', qty: 1, price: 50 }]);
await ord('o3', '2026-11-26', [{ id: '111', name: 'A', qty: 1, price: 100 }], 3); // скасоване — не рахуємо
await ord('o4', '2026-11-10', [{ id: '111', name: 'A', qty: 1, price: 100 }]); // поза періодом

const ok = (content) => new Response(JSON.stringify({ success: true, content }));
const seen = [];
const puts = [];
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  seen.push(u.pathname + u.search);
  if (opts.method === 'PUT') { puts.push([u.pathname, JSON.parse(opts.body), opts.headers.Authorization]); return ok({ id: 1 }); }
  if (u.searchParams.get('x') === 'deny' || (u.hostname === 'api-seller.rozetka.com.ua' && globalThis.DENY)) return new Response(JSON.stringify({ success: false, errors: { message: 'access_denied', code: 1010, description: 'В доступі відмовлено' } }));
  if (u.pathname === '/raising-campaigns/search') return ok({ advertisingCampaigns: [
    { id: 10, title: 'Пилососи', start_date: '2026-09-22', end_date: '2029-09-22', daily_budget: 600, current_limit_budget: '120.50', status: 'active', type: 'CPC', is_editable: true, items_count: 2, statistics: { views: 1000, clicks: 50, money: '250.00', transactions: 5, cpo: '50.00', cpc: '5.00' } },
    { id: 11, title: 'Порожня', start_date: '2026-09-22', end_date: '2029-09-22', daily_budget: 100, status: 'active', items_count: 0, statistics: {} }], _meta: { pageCount: 1 } });
  if (u.pathname === '/balances/balance-ads') return ok({ balance: -176.59 });
  if (u.pathname === '/raising/common/adv-balance-credit-limit') return ok({ limit: 30000 });
  if (u.pathname === '/promo-analytics/order/search') {
    assert.equal(u.searchParams.get('order_created_from'), '2026-11-20');
    return ok({ advertisingOrders: [
      { order_id: 9001, order_status: 1, order_cost_with_discount: '200.00', campaign_id: 10, item_id: 111, created_at: '2026-11-25 10:00:00' },
      { order_id: 9002, order_status: 1, order_cost_with_discount: '50.00', campaign_id: 10, item_id: 222, created_at: '2026-11-26 10:00:00' },
      { order_id: 9003, order_status: 1, order_cost_with_discount: '70.00', campaign_id: 99, item_id: 333, created_at: '2026-11-26 10:00:00' }], _meta: { pageCount: 1 } });
  }
  if (u.pathname === '/raising-campaign-items/search') {
    const cid = u.searchParams.get('campaign_id');
    if (cid === '11') return ok({ advertisingCampaignItems: [], _meta: { pageCount: 1 } });
    return ok({ advertisingCampaignItems: [
      { id: 1, campaign_id: 10, item_id: 111, max_day_money: '6.50', status: 'active', stat: { clicks: 30, views: 600, money: '150.00', transactions: 3, cpo: '50.00', cpc: '5.00' }, is_editable: true,
        item: { id: 111, name_ua: 'Пилосос білий', article: '71526 V200', price: '9499.00', price_old: '11100.00', photo_preview: 'https://x/1.jpg', url: 'https://rozetka.com.ua/111/p111', catalog_category: { name: 'Пилососи' }, stock_quantity: 100 }, rate: { min: '1.70', current: '6.50' } },
      { id: 2, campaign_id: 10, item_id: 222, max_day_money: '5.50', status: 'active', stat: { clicks: 20, views: 400, money: '100.00', transactions: 2, cpo: '50.00', cpc: '5.00' }, is_editable: true,
        item: { id: 222, name: 'Пилосос сірий', price: '9499.00' }, rate: { min: '1.70', current: '5.50' } }], _meta: { pageCount: 1 } });
  }
  if (u.pathname === '/raising-campaigns/10') return ok({ id: 10, title: 'Пилососи', start_date: '2026-09-22', end_date: '2029-09-22', daily_budget: 600, current_limit_budget: '120.50', status: 'active', statistics: { views: 1000, clicks: 50, money: '250.00', transactions: 5, cpo: '50.00', cpc: '5.00' } });
  return new Response('{}', { status: 404 });
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (path, headers = H) => { const r = await mk().request(path, { headers }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const P = 'from=2026-11-20&to=2026-11-27';

// ---------- кампанії ----------
let r = await req(`/api/mp/ads/campaigns?account=1&${P}`);
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.deepEqual([r.j.balance, r.j.limit, r.j.campaigns.length], [-176.59, 30000, 2]);
const k = r.j.campaigns[0];
assert.deepEqual([k.budget, k.left_today, k.stat.views, k.stat.clicks, k.stat.money, k.stat.orders, k.items], [600, 120.5, 1000, 50, 250, 5, 2]);
assert.deepEqual(k.period, { ad_orders: 2, ad_sum: 250 }, 'з реклами за період — лише цієї кампанії');
r = await req(`/api/mp/ads/campaign-orders?account=1&${P}&ids=10,11`);
assert.deepEqual(r.j.campaigns, { 10: { orders: 2, sum: 350 }, 11: { orders: 0, sum: 0 } }, 'усі замовлення товарів кампанії за період (кожне один раз), без скасованих і старих');

// ---------- товари кампанії ----------
r = await req(`/api/mp/ads/campaigns/10?account=1&${P}`);
assert.equal(r.status, 200, JSON.stringify(r.j));
const [a, b] = r.j.items;
assert.deepEqual([a.name, a.rate, a.rate_min, a.price, a.price_old, a.stat.clicks], ['Пилосос білий', 6.5, 1.7, 9499, 11100, 30]);
assert.deepEqual(a.period, { ad_orders: 1, ad_sum: 200, orders: 2, qty: 3, sum: 300 });
assert.deepEqual([b.name, b.period.orders, b.period.ad_orders], ['Пилосос сірий', 1, 1]);

// ---------- немає доступу; чужий магазин ----------
globalThis.DENY = true;
r = await req(`/api/mp/ads/campaigns?account=2&${P}`);
assert.equal(r.status, 403);
assert.match(r.j.error, /Немає доступу до реклами магазину «OneDay».*Менеджери/);
globalThis.DENY = false;
await mk().request('/api/users', { method: 'POST', headers: H, body: JSON.stringify({ login: 'man', password: 'pass1234', role: 'manager' }) });
await db.run(`UPDATE users SET access = ? WHERE login = 'man'`, [JSON.stringify({ b2b: 'none', retail: 'none', market: 'view', returns: 'none', shops: ['rozetka:1'], tg: [] })]);
const lm = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const M = { 'Content-Type': 'application/json', Cookie: lm.headers.get('set-cookie').split(';')[0] };
assert.equal((await req(`/api/mp/ads/campaigns?account=2&${P}`, M)).status, 403, 'чужий магазин');
assert.equal((await req(`/api/mp/ads/campaigns?account=1&${P}`, M)).status, 200, 'свій магазин — перегляд');
assert.ok(!seen.some((s) => /pause-|finish-|update|\/create/.test(s.split('?')[0])), 'лише читання');

// ---------- керування: пауза / запуск, бюджет, ставка, пауза оголошення ----------
const post = async (path, body, headers = H) => { const r = await mk().request(path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
assert.equal((await post('/api/mp/ads/campaigns/10/status', { account: 1, status: 'paused' }, M)).status, 403, 'перегляд — без змін');
r = await post('/api/mp/ads/campaigns/10/status', { account: 1, status: 'paused', title: 'Пилососи' });
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.deepEqual(puts.at(-1).slice(0, 2), ['/raising-campaigns/10', { id: 10, status: 0 }]);
await post('/api/mp/ads/campaigns/10/status', { account: 1, status: 'active' });
assert.deepEqual(puts.at(-1)[1], { id: 10, status: 1 });
assert.match((await post('/api/mp/ads/campaigns/10/budget', { account: 1, budget: 0 })).j.error, /від 1/);
await post('/api/mp/ads/campaigns/10/budget', { account: 1, budget: '750,5' });
assert.deepEqual(puts.at(-1), ['/raising-campaigns/10', { id: 10, title: 'Пилососи', daily_budget: 750.5, start_date: '2026-09-22', end_date: '2029-09-22' }, 'Bearer tok']);
// ставка: межі (мін. 1.70, не більше бюджету 600), оголошення — як у Розетці, змінено лише ставку
assert.match((await post('/api/mp/ads/items/1', { account: 1, campaign: 10, rate: 1 })).j.error, /мінімальну \(1\.7 грн\)/);
assert.match((await post('/api/mp/ads/items/1', { account: 1, campaign: 10, rate: 700 })).j.error, /бюджет кампанії на день \(600 грн\)/);
r = await post('/api/mp/ads/items/1', { account: 1, campaign: 10, rate: '7,25' });
assert.equal(r.status, 200, JSON.stringify(r.j));
let [path, body] = puts.at(-1);
assert.equal(path, '/raising-campaign-items/1');
assert.deepEqual([body.id, body.item_id, body.max_day_money, body.rate.current, body.rate.min, body.status], [1, 111, 7.25, 7.25, '1.70', 1]);
await post('/api/mp/ads/items/2', { account: 1, campaign: 10, status: 'paused' });
[path, body] = puts.at(-1);
assert.deepEqual([path, body.status, body.max_day_money], ['/raising-campaign-items/2', 0, '5.50'], 'пауза — ставка без змін');
assert.equal((await post('/api/mp/ads/items/999', { account: 1, campaign: 10, rate: 5 })).status, 404);
const log = await db.all(`SELECT action FROM audit_log WHERE kind = 'rz-ads' ORDER BY id`);
assert.ok(log.some((x) => /призупинено/.test(x.action)) && log.some((x) => /бюджет на день 600 → 750\.5/.test(x.action)) && log.some((x) => /ставка 6\.5 → 7\.25/.test(x.action)), 'журнал змін');

console.log('OK — маркетплейси: реклама Розетки (перегляд і керування)');
