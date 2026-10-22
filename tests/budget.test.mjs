// Пошук за ID серед «Прийнято» при ліміті зовнішніх запитів (як на Cloudflare): відповідь 202 і продовження.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.run(`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`);
let calls = 0;
const statuses = { ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(100 + i), 'S' + i])), 117: 'Прийнято' };
// 450 прийнятих замовлень; потрібне — серед останніх (кілька пачок по 100)
const orders = new Map();
for (let i = 0; i < 450; i++) {
  const code = String(5550000 + i);
  orders.set(code, { id: String(106500 + i), order_id: code, status: '117', bayer_name: `Покупець ${i}`, phone: '380937971450', datetime: '2026-10-12 18:50:12', products: [{ product_id: '1', name: 'Очисник HOMI P300', price: '6599', quantity: '1' }] });
}
orders.get('5550397').bayer_name = 'Мельник Ольга';
const fetchFn = async (url, opts = {}) => {
  calls++;
  const p = new URLSearchParams(opts.body);
  const json = (o) => new Response(JSON.stringify(o));
  if (url.includes('getStatuses')) return json({ status: 'ok', data: statuses });
  if (url.includes('getOrdersIdByStatus')) return json({ status: 'ok', data: p.get('status') === '117' ? [...orders.keys()] : [] });
  if (url.includes('getOrdersByID')) {
    const ids = p.get('order_id').split(',');
    if (ids.length === 1) return json({ status: 'ok', data: orders.get(ids[0]) || { [ids[0]]: [] } });
    return json({ status: 'ok', data: Object.fromEntries(ids.map((x) => [x, orders.get(x)])) });
  }
  return json({ status: 'ok', data: [] });
};
const app0 = createApp({ db, fetchFn });
const cookie = (await app0.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'o', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } })).headers.get('set-cookie').split(';')[0];

let rounds = 0;
let res;
do {
  const app = createApp({ db, fetchFn, maxSubrequests: 3 }); // кожне звернення — новий ліміт
  res = await app.request('/api/invoice/106897', { headers: { Cookie: cookie } });
  rounds++;
} while (res.status === 202 && rounds < 30);
const inv = await res.json();
assert.equal(res.status, 200, JSON.stringify(inv));
assert.equal(inv.order.orderId, '106897');
assert.equal(inv.order.buyer.name, 'Мельник Ольга');
assert.ok(rounds > 1, 'пошук розбито на кілька звернень');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM orders_index`)).n, 450, 'кожна пачка збережена один раз');
// Повторне відкриття — з індексу, без списку з CRM
calls = 0;
const again = await createApp({ db, fetchFn, maxSubrequests: 6 }).request('/api/invoice/106897', { headers: { Cookie: cookie } });
assert.equal(again.status, 200);
assert.ok(calls <= 3, `повторне відкриття — кілька запитів (${calls})`);
console.log(`OK — знайдено за ${rounds} звернень`);
