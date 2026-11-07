// Договори Meest (Міст): токен + ContractID, перевірка (договір і посилки за тиждень), токен не віддається,
// «що віддає API» — лише методи з білого списку, доступ — лише з правом «API».
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const TOKEN = 'mtok_1234567890abcdefXYZ9';
const CID = 'bce280bc-cd2f-11f1-a794-005056b00001';
const seen = [];
const fetchFn = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.meest.com/v3.0/openAPI')) return new Response('{"ok":true,"result":{}}');
  const path = decodeURIComponent(u.slice('https://api.meest.com/v3.0/openAPI'.length));
  seen.push(path);
  if (opts.headers.token !== TOKEN) return new Response(JSON.stringify({ status: 'Error', info: { message: 'Unauthorized' } }), { status: 401 });
  const ok = (result) => new Response(JSON.stringify({ status: 'OK', info: {}, result }));
  if (path.startsWith('/contractClientInfo/')) return path.endsWith(CID) ? ok({ contractNumber: 'KL-21102026' }) : new Response(JSON.stringify({ status: 'Error', info: { message: 'Contract not found' } }), { status: 404 });
  if (path.startsWith('/parcelsList/')) return ok(seen.filter((p) => p.startsWith('/parcelsList/')).length === 1 ? [{ parcelID: 'g1', parcelNumber: 'CV12345', вarCode: '2201234567', registerType: 'registerBranch' }] : []);
  if (path.startsWith('/tracking/')) return ok([{ parcelNumber: 'CV12345', eventCode: 1620, eventDescr: { descrUA: 'Відмова від отримання' } }]);
  throw new Error('Meest ' + path);
};
const call = async (m, path, body, cookie) => {
  const r = await createApp({ db, fetchFn }).request(path, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})), r };
};
const H = (await call('POST', '/api/auth/setup', { login: 'o', password: 'secret123' })).r.headers.get('set-cookie').split(';')[0];

// Перевірка формату: без ContractID / невірний токен — зрозуміла помилка, нічого не зберігається.
assert.match((await call('POST', '/api/meest/accounts', { token: TOKEN }, H)).j.error, /ContractID/);
assert.match((await call('POST', '/api/meest/accounts', { token: 'wrong_token_000000000000', contract_id: CID }, H)).j.error, /токен недійсний/);
assert.equal((await call('GET', '/api/meest/accounts', null, H)).j.length, 0);

// Додати: назва — з договору, посилки за тиждень (поле з кириличною «в» теж читаємо).
const add = await call('POST', '/api/meest/accounts', { token: TOKEN, contract_id: CID }, H);
assert.equal(add.status, 200, JSON.stringify(add.j));
assert.deepEqual(add.j.orders, [{ id: 'CV12345', date: add.j.orders[0].date, status: 'registerBranch', provider: 'Meest', ttn: '2201234567' }]);
assert.ok(seen.includes(`/contractClientInfo/${CID}`) && seen.filter((p) => p.startsWith('/parcelsList/')).length === 7);
const list = (await call('GET', '/api/meest/accounts', null, H)).j;
assert.deepEqual([list[0].name, list[0].contract_id, list[0].active], ['KL-21102026', CID, 1]);
assert.ok(!JSON.stringify(list).includes(TOKEN) && list[0].token.endsWith('XYZ9'), 'токен не віддається, лише останні 4 символи');
assert.match((await call('POST', '/api/meest/accounts', { token: TOKEN, contract_id: CID }, H)).j.error, /уже додано/);

// Що віддає API: дозволені методи — так, інші шляхи — ні.
const id = list[0].id;
const pr = await call('GET', `/api/meest/accounts/${id}/probe?m=tracking&v=CV12345`, null, H);
assert.deepEqual([pr.j.path, pr.j.result[0].eventCode], ['/tracking/CV12345', 1620]);
assert.equal((await call('GET', `/api/meest/accounts/${id}/probe?m=tracking&v=../auth`, null, H)).status, 400);
assert.equal((await call('GET', `/api/meest/accounts/${id}/probe?m=parcel&v=x`, null, H)).status, 400);

// Змінити назву, вимкнути; маска токена не перезаписує токен.
await call('PUT', `/api/meest/accounts/${id}`, { name: 'ТОВ Rozetka', active: false, token: list[0].token }, H);
const row = await db.get(`SELECT * FROM meest_accounts WHERE id = ?`, [id]);
assert.deepEqual([row.name, row.active, row.token], ['ТОВ Rozetka', 0, TOKEN]);
assert.ok((await call('PUT', `/api/meest/accounts/${id}`, { check: true }, H)).j.orders);

// Менеджер без права «API» — ні.
await call('POST', '/api/users', { login: 'm1', password: 'pass1234', role: 'manager' }, H);
const M = (await call('POST', '/api/auth/login', { login: 'm1', password: 'pass1234' })).r.headers.get('set-cookie').split(';')[0];
assert.equal((await call('GET', '/api/meest/accounts', null, M)).status, 403);
assert.equal((await call('GET', `/api/meest/accounts/${id}/probe?m=tracking&v=CV12345`, null, M)).status, 403);

await call('DELETE', `/api/meest/accounts/${id}`, null, H);
assert.equal((await call('GET', '/api/meest/accounts', null, H)).j.length, 0);
console.log('OK — Meest');
