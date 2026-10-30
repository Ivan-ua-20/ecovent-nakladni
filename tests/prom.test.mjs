// Магазини Prom.ua: додавання за токеном (перевірка запитом замовлень), «Перевірити» з доставкою останніх замовлень,
// токен не віддається в браузер, неправильний токен не зберігається.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const GOOD = 'a'.repeat(40);
const seen = [];
const fetchFn = async (url, opts = {}) => {
  seen.push({ url, auth: opts.headers?.Authorization });
  if (opts.headers?.Authorization !== `Bearer ${GOOD}`) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (url.includes('/orders/list')) {
    return new Response(JSON.stringify({ orders: [
      { id: 301, date_created: '2026-10-30T09:00:00+00:00', status: 'pending', status_name: 'Нове', delivery_option: { id: 1, name: 'Магазини Rozetka' }, delivery_provider_data: { provider: 'rozetka_delivery', declaration_number: '123456789', unified_status: 'created' } },
      { id: 300, date_created: '2026-10-29T09:00:00+00:00', status: 'received', status_name: 'Прийнято', delivery_option: { id: 2, name: 'Нова Пошта' }, delivery_provider_data: null },
    ] }));
  }
  return new Response(JSON.stringify({}));
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body) => {
  const r = await mk().request(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

// неправильний токен — не зберігається
let r = await req('POST', '/api/prom/accounts', { name: 'Prom Arca', token: 'b'.repeat(40) });
assert.equal(r.status, 400, JSON.stringify(r.j));
assert.match(r.j.error, /токен/);
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM prom_accounts`)).n, 0);

// правильний — зберігається, у відповіді доставка останніх замовлень
r = await req('POST', '/api/prom/accounts', { name: 'Prom Arca', token: GOOD });
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.deepEqual(r.j.orders[0], { id: 301, date: '2026-10-30T09:00:00+00:00', status: 'Нове', option: 'Магазини Rozetka', provider: 'rozetka_delivery', ttn: '123456789', ttn_status: 'created' });
assert.equal(r.j.orders[1].ttn, '');
assert.ok(seen.at(-1).url.startsWith('https://my.prom.ua/api/v1/orders/list?limit=10'));
assert.equal((await req('POST', '/api/prom/accounts', { name: 'Дубль', token: GOOD })).status, 400, 'той самий токен двічі — ні');

// список — без токена
const list = (await req('GET', '/api/prom/accounts')).j;
assert.equal(list.length, 1);
assert.ok(!list[0].token.includes(GOOD) && list[0].token.endsWith('aaaa'));

// «Перевірити» і вимкнення
r = await req('PUT', `/api/prom/accounts/${list[0].id}`, { check: true });
assert.equal(r.j.orders.length, 2);
r = await req('PUT', `/api/prom/accounts/${list[0].id}`, { active: false, token: list[0].token });
assert.equal(r.j.active, 0);
assert.equal((await db.get(`SELECT token FROM prom_accounts`)).token, GOOD, 'маска замість токена не перезаписує його');
assert.equal((await req('DELETE', `/api/prom/accounts/${list[0].id}`)).status, 200);
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM prom_accounts`)).n, 0);
console.log('OK — магазини Prom: токен, перевірка, доставка останніх замовлень');
