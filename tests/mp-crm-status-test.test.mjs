// Маркетплейси → LP-CRM: тимчасова перевірка параметра status в addNewOrder (лише власник, одне тестове замовлення).
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`INSERT INTO settings (key, value) VALUES ('lpcrm_subdomain', 'demo') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO settings (key, value) VALUES ('lpcrm_key', 'k') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
]);
const sent = [];
const fetchFn = async (url, opts = {}) => {
  const p = new URLSearchParams(opts.body);
  if (url.includes('addNewOrder')) { sent.push(Object.fromEntries(p)); return new Response(JSON.stringify({ status: 'ok', data: [{ order_id: p.get('order_id'), status: 'ok' }] })); }
  if (url.includes('getOrdersByID')) return new Response(JSON.stringify({ status: 'ok', data: [{ id: 777, order_id: sent.at(-1).order_id, bayer_name: 'ТЕСТ', phone: '380000000000', status: '11' }] }));
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const r = await mk().request('/api/mp/crm/status-test', { method: 'POST', headers: H, body: JSON.stringify({ status: 11, product_id: 5 }) });
const j = await r.json();
assert.equal(r.status, 200, JSON.stringify(j));
assert.equal(sent.length, 1);
assert.equal(sent[0].status, '11', 'status передано в addNewOrder');
assert.equal(sent[0].office, '5');
assert.ok(sent[0].site, 'сайт обовʼязковий для LP-CRM');
assert.deepEqual([j.ok, j.crm_id, j.got_status], [true, '777', '11']);
assert.equal((await mk().request('/api/mp/crm/status-test', { method: 'POST', headers: H, body: '{}' })).status, 400);
console.log('OK — LP-CRM: перевірка параметра status');
