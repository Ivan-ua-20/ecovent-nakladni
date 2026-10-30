// Магазини Епіцентр Маркету: токен (перевірка запитом замовлень), «Перевірити» з доставкою останніх замовлень,
// маркування — PDF накладної з API Епіцентру (провайдер з параметра або по черзі), зрозуміла помилка, якщо накладної немає.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const GOOD = `eyJ${'a'.repeat(60)}.payload.sig`;
const LABELS = { 'cvz_epicentr/EPC0001': btoa('%PDF-1.4 epicentr'), 'meest/723-111': btoa('%PDF-1.4 meest') };
const seen = [];
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  assert.equal(u.origin, 'https://merchant-api.epicentrm.com.ua');
  seen.push(u.pathname + u.search);
  if (opts.headers?.Authorization !== `Bearer ${GOOD}`) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
  if (u.pathname === '/v3/oms/orders') {
    return new Response(JSON.stringify({ current: 'x', next: '', prev: null, last: '', limit: 10, items: [
      { id: 'u1', number: '123456', createdAt: '2026-10-30T10:00:00Z', statusCode: 'confirmed', address: { shipment: { provider: 'cvz_epicentr', number: 'EPC0001' } } },
      { id: 'u2', number: '123455', createdAt: '2026-10-30T09:00:00Z', statusCode: 'new', address: { shipment: { provider: 'nova_poshta', number: null } } },
    ] }));
  }
  const m = u.pathname.match(/^\/v3\/deliveries\/([^/]+)\/invoices\/([^/]+)$/);
  if (m) {
    const f = LABELS[`${m[1]}/${decodeURIComponent(m[2])}`];
    if (!f) return new Response(JSON.stringify({ message: 'Invoice not found' }), { status: 404 });
    return new Response(JSON.stringify({ file: f }));
  }
  return new Response('{}', { status: 404 });
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body) => {
  const r = await mk().request(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, ct, j: ct.includes('json') ? await r.json() : null, text: ct.includes('pdf') ? await r.text() : '' };
};

// без магазинів — зрозуміла помилка
assert.equal((await req('GET', '/api/epc/marking/EPC0001')).status, 400);
// неправильний токен — не зберігається
let r = await req('POST', '/api/epc/accounts', { name: 'Епіцентр Ecovent', token: `eyJ${'b'.repeat(60)}` });
assert.equal(r.status, 400);
assert.match(r.j.error, /токен/);
// правильний — зберігається, у відповіді доставка останніх замовлень
r = await req('POST', '/api/epc/accounts', { name: 'Епіцентр Ecovent', token: GOOD });
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.deepEqual(r.j.orders[0], { id: '123456', date: '2026-10-30T10:00:00Z', status: 'confirmed', provider: 'cvz_epicentr', ttn: 'EPC0001' });
assert.equal(r.j.orders[1].ttn, '');
assert.ok(seen.at(-1).startsWith('/v3/oms/orders?limit=10'));
const list = (await req('GET', '/api/epc/accounts')).j;
assert.ok(!list[0].token.includes(GOOD));

// маркування: провайдер невідомий — по черзі; знайшли — PDF
r = await req('GET', '/api/epc/marking/EPC0001');
assert.equal(r.status, 200);
assert.ok(r.text.startsWith('%PDF'));
r = await req('GET', '/api/epc/marking/723-111?provider=meest');
assert.equal(r.status, 200);
seen.length = 0;
r = await req('GET', '/api/epc/marking/NOPE123');
assert.equal(r.status, 404);
assert.match(r.j.error, /NOPE123.*Відповідь Епіцентру/s);
assert.equal(seen.length, 4, 'чотири провайдери, що друкуються');

// перевірка й видалення
r = await req('PUT', `/api/epc/accounts/${list[0].id}`, { check: true });
assert.equal(r.j.orders.length, 2);
assert.equal((await req('DELETE', `/api/epc/accounts/${list[0].id}`)).status, 200);
console.log('OK — Епіцентр: магазини за токеном, доставка останніх замовлень, маркування з API');
