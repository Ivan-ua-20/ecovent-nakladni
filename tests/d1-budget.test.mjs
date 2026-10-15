// Кількість звернень до бази на один запит (D1 безкоштовно: до 50). batch рахується як одне.
import assert from 'node:assert/strict';
import { openDb } from '../src/db-node.js';
import { migrate } from '../src/schema.js';
import { createApp } from '../src/app.js';
import { kyivDay, addDays, monthStart } from '../src/analytics.js';

const raw = openDb(':memory:');
let n = 0;
const db = { all: (...a) => { n++; return raw.all(...a); }, get: (...a) => { n++; return raw.get(...a); }, run: (...a) => { n++; return raw.run(...a); }, batch: (l) => { if (l.length) n++; return raw.batch(l); } };
n = 0; await migrate(db);
const results = { 'міграція (нова база)': n };
await raw.run(`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`);
const today = kyivDay();
let id = 200000;
const orders = [];
for (let d = addDays(today, -190); d <= today; d = addDays(d, 1)) for (let k = 0; k < Number(process.env.PER_DAY || 140); k++) {
  id++;
  orders.push({ id: String(id), order_id: String(1790000000000000 + id), datetime: `${d} 10:00:00`, status: String([11, 14, 53, 18, 54, 58][id % 6]), office: '5', user: 'u' + (id % 4), additional_1: 'Rozetka(oneday)', total: '1000', products: [{ product_id: String(id % 300), name: 'iHunt X', price: '500', quantity: '2' }] });
}
const byCode = new Map(orders.map((o) => [o.order_id, o]));
const fetchFn = async (url, opts) => {
  const m = url.match(/api\/(\w+)\.html/)[1];
  const p = new URLSearchParams(opts.body);
  const j = (o) => new Response(JSON.stringify(o));
  if (m === 'getStatuses') return j({ status: 'ok', data: { 11: 'a' } });
  if (m === 'getOrdersIdByStatus') return j({ status: 'ok', data: orders.filter((o) => o.status === p.get('status') && o.datetime.slice(0, 10) >= p.get('date_start') && o.datetime.slice(0, 10) <= p.get('date_end')).map((o) => o.order_id) });
  if (m === 'getOrdersByID') return j({ status: 'ok', data: Object.fromEntries(p.get('order_id').split(',').map((c) => [c, byCode.get(c)])) });
  if (m === 'getProduct') return j({ status: 'ok', data: p.get('product_id').split(',').map((x) => ({ id: x, category_id: '5' })) });
  return j({ status: 'ok', data: {} });
};
const st = globalThis.setTimeout; globalThis.setTimeout = (f, ms, ...a) => st(f, 0, ...a);
const mk = () => createApp({ db, fetchFn, maxSubrequests: 40 }); // як на Cloudflare: новий ліміт на кожне звернення
const app = mk();
const s = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'o', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: s.headers.get('set-cookie').split(';')[0] };
const measure = async (name, method, path, body) => {
  n = 0;
  const r = await mk().request(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  results[name] = Math.max(results[name] || 0, n);
  return r.json();
};
await measure('синхронізація: старт', 'POST', '/api/an/sync/start', { mode: 'full' });
let steps = 0;
for (;;) { const t = Date.now(); const r = await measure('синхронізація: крок (макс.)', 'POST', '/api/an/sync/step', {}); steps++; if (process.env.DBG) console.log(steps, Date.now() - t, r.state.text, r.state.stats); if (r.state.done || r.state.error) { assert.ok(!r.state.error, r.state.error); break; } }
const cnt = (await raw.get(`SELECT COUNT(*) AS n FROM an_orders`)).n;
await measure('дашборд: місяць + порівняння', 'POST', '/api/an/query', { from: monthStart(today), to: today, cmpFrom: addDays(monthStart(today), -31), cmpTo: addDays(monthStart(today), -1) });
await measure('дашборд: з брендом', 'POST', '/api/an/query', { from: addDays(today, -6), to: today, brands: [1], cmpFrom: addDays(today, -13), cmpTo: addDays(today, -7) });
await measure('налаштування аналітики', 'GET', '/api/an/config');
await measure('значення для розподілу', 'GET', '/api/an/values');
await measure('дашборд: з кешу', 'POST', '/api/an/query', { from: monthStart(today), to: today, cmpFrom: addDays(monthStart(today), -31), cmpTo: addDays(monthStart(today), -1) });
await measure('потребує уваги', 'GET', '/api/an/attention');
await measure('товари', 'GET', '/api/an/products');
await measure('ручна прив\'язка товарів', 'PUT', '/api/an/products', [{ id: 1, brand_manual: 1, cat_manual: '' }]);
await measure('налаштування: пріоритет', 'PUT', '/api/an/settings', { deptPriority: 'office' });
await measure('синхронізація: сьогодні', 'POST', '/api/an/sync/start', { mode: 'today', force: true });
for (;;) { const r = await measure('синхронізація сьогодні: крок', 'POST', '/api/an/sync/step', {}); if (r.state.done || r.state.error) { assert.ok(!r.state.error, r.state.error); break; } }
const cfg = await (await app.request('/api/an/config', { headers: H })).json();
await measure('збереження відділів і джерел', 'PUT', '/api/an/structure', { depts: cfg.depts });
await measure('накладна demo', 'GET', '/api/invoice/demo');
await measure('bootstrap', 'GET', '/api/bootstrap');
globalThis.setTimeout = st;
console.log(`  ${cnt} замовлень, ${steps} кроків синхронізації`);
console.table(results);
for (const [k, v] of Object.entries(results)) assert.ok(v <= 45, `${k}: ${v} запитів до бази — забагато для D1`);
console.log('OK — усі запити вкладаються в ліміт D1');
