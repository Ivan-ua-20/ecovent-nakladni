// Права доступу і рахунки.
import assert from 'node:assert/strict';
import { openDb } from '../src/db-node.js';
import { migrate } from '../src/schema.js';
import { createApp } from '../src/app.js';
import { resetOwnerPassword } from '../src/auth.js';

const db = openDb(':memory:');
await migrate(db);
const fetchFn = async (url, opts = {}) => {
  const json = (o) => new Response(JSON.stringify(o));
  if (url.includes('getOrdersByID')) {
    return json({ status: 'ok', data: { id: '106593', order_id: '1791608184877250', bayer_name: 'Тест', phone: '380750000000', datetime: '2026-10-10 07:56:24', office: '4',
      products: [{ product_id: '965', name: 'Смартфон iHunt Titan [04979]', price: '21900.00', quantity: '1' }] } });
  }
  return json({ status: 'ok', data: [] });
};
const app = createApp({ db, fetchFn });
const req = async (method, p, body, cookie) => {
  const r = await app.request(p, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } });
  return { status: r.status, json: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
};

// без входу — 401
assert.equal((await req('GET', '/api/bootstrap')).status, 401);
assert.equal((await req('GET', '/api/auth/state')).json.needsSetup, true);
const own = await req('POST', '/api/auth/setup', { login: 'Owner', password: 'secret123', name: 'Іван' });
assert.equal(own.status, 200);
assert.equal(own.json.user.role, 'owner');
assert.equal((await req('POST', '/api/auth/setup', { login: 'x', password: 'secret123' })).status, 400, 'другого власника створити не можна');
const O = own.cookie;
await req('PUT', '/api/settings', { lpcrm_key: 'k', lpcrm_subdomain: 'ihunt' }, O);

// власник створює адміністратора, менеджера, перегляд
for (const [login, role] of [['adm', 'admin'], ['man', 'manager'], ['view', 'viewer']]) {
  assert.equal((await req('POST', '/api/users', { login, password: 'pass1234', role, name: login }, O)).status, 200);
}
assert.equal((await req('POST', '/api/users', { login: 'own2', password: 'pass1234', role: 'owner' }, O)).status, 400, 'роль власника не призначається');
const login = async (l) => (await req('POST', '/api/auth/login', { login: l, password: 'pass1234' })).cookie;
const A = await login('adm'); const M = await login('man'); const V = await login('view');
assert.equal((await req('POST', '/api/auth/login', { login: 'man', password: 'wrong' })).status, 401);

// адміністратор: користувачі і API
assert.equal((await req('GET', '/api/users', null, A)).status, 200);
assert.equal((await req('POST', '/api/users', { login: 'adm2', password: 'pass1234', role: 'admin' }, A)).status, 200, 'адмін створює адміна');
const ownerId = (await req('GET', '/api/users', null, A)).json.users.find((u) => u.role === 'owner').id;
assert.equal((await req('PUT', `/api/users/${ownerId}`, { password: 'hacked123' }, A)).status, 403, 'адмін не змінює власника');
assert.equal((await req('DELETE', `/api/users/${ownerId}`, null, A)).status, 403);
assert.equal((await req('GET', '/api/bootstrap', null, A)).json.settings.lpcrm_key, '••••••');

// менеджер: без API і користувачів, але довідники можна
assert.equal((await req('GET', '/api/users', null, M)).status, 403);
assert.equal((await req('GET', '/api/lpcrm/diagnose/1', null, M)).status, 403);
const mb = (await req('GET', '/api/bootstrap', null, M)).json;
assert.equal(mb.settings.lpcrm_subdomain, 'ihunt');
assert.ok(!('lpcrm_search_days' in mb.settings), 'API-налаштування приховано');
assert.ok(!('checkbox_login' in mb.fops[0]), 'доступи Checkbox приховано');
await req('PUT', '/api/settings', { lpcrm_key: 'stolen', retention_days: '10' }, M);
assert.equal((await db.get(`SELECT value FROM settings WHERE key='lpcrm_key'`)).value, 'k', 'менеджер не змінює ключ API');
assert.equal((await db.get(`SELECT value FROM settings WHERE key='retention_days'`)).value, '10');
const invFop = await req('POST', '/api/inv-fops', { short_name: 'ФОП Лупу В.Ф.', full_name: 'ФОП Лупу Віра Філаретівна', ipn: '1234567890', iban: 'UA00', bank: 'ПриватБанк', address: 'м. Чернівці' }, O);
assert.equal(invFop.status, 200);
assert.equal((await req('POST', '/api/inv-fops', { short_name: 'y' }, M)).status, 403, 'створювати ФОП рахунків — лише адміни');

// реквізити ФОП (IBAN, ІПН…) — лише власник і адміни; кожна зміна — у журналі
const ifId = invFop.json.id;
assert.equal((await req('PUT', `/api/inv-fops/${ifId}`, { iban: 'UA99' }, M)).status, 403, 'менеджер не змінює IBAN ФОП рахунків');
assert.equal((await req('PUT', `/api/inv-fops/${ifId}`, { iban: 'UA00', ipn: '1234567890', active: 1 }, M)).status, 200, 'незмінені реквізити + активність — можна');
assert.equal((await req('PUT', `/api/inv-fops/${ifId}`, { iban: 'UA11' }, A)).status, 200, 'адмін змінює IBAN');
const fop1 = (await req('GET', '/api/bootstrap', null, O)).json.fops[0];
assert.equal((await req('PUT', `/api/fops/${fop1.id}`, { iban: 'UA77' }, M)).status, 403, 'менеджер не змінює IBAN ФОП накладних');
assert.equal((await req('PUT', `/api/fops/${fop1.id}`, { template_id: 2 }, M)).status, 200, 'шаблон менеджер змінює');
assert.equal((await req('POST', '/api/fops', { short_name: 'Новий', iban: 'UA55' }, M)).status, 403, 'нового ФОП додає лише адмін');
assert.equal((await req('PUT', `/api/fops/${fop1.id}`, { iban: 'UA12' }, O)).status, 200);
const audit = (await req('GET', '/api/audit', null, A)).json;
assert.deepEqual(audit.filter((x) => x.action === 'змінено реквізити').map((x) => [x.kind, x.user_name, x.changes[0].field, x.changes[0].to]),
  [['fop', 'Іван', 'iban', 'UA12'], ['inv_fop', 'adm', 'iban', 'UA11']], 'журнал змін реквізитів');
assert.equal((await req('GET', '/api/audit', null, M)).status, 403, 'журнал — лише адмінам');

// перегляд: лише читання
assert.equal((await req('GET', '/api/bootstrap', null, V)).status, 200);
assert.equal((await req('POST', '/api/inv-fops', { short_name: 'x' }, V)).status, 403);
assert.equal((await req('PUT', '/api/invoice/demo/prefs', { fop_id: 1 }, V)).status, 403);
assert.equal((await req('POST', '/api/rahunky', { source: 'manual' }, V)).status, 403);
assert.equal((await req('GET', '/api/invoice/demo', null, V)).status, 200, 'перегляд відкриває накладну');

// рахунки: ручні — 10516, 10517; з CRM — номер замовлення
const base = { fop_id: invFop.json.id, client: { name: '"РОЗЕТКА. УА" ТОВ', edrpou: '37193071' }, items: [{ name: 'Осушувач', qty: '1', price: '7119,20' }] };
const r1 = await req('POST', '/api/rahunky', { ...base, source: 'manual' }, M);
assert.equal(r1.json.data.number, '10516');
assert.equal(r1.json.data.total, 7119.2);
assert.equal(r1.json.data.items[0].unit, 'шт');
const r2 = await req('POST', '/api/rahunky', { ...base, source: 'manual' }, M);
assert.equal(r2.json.data.number, '10517', 'спільний лічильник');
assert.equal((await req('POST', '/api/rahunky', { ...base, source: 'manual', client: { name: ' ' } }, M)).status, 400, 'назва клієнта обовʼязкова');
const ord = await req('GET', '/api/rahunok-order/1791608184877250', null, M);
assert.equal(ord.json.number, '106593');
assert.equal(ord.json.items[0].name, 'Смартфон iHunt Titan [04979]');
const r3 = await req('POST', '/api/rahunky', { ...base, source: 'crm', number: ord.json.number, items: [...ord.json.items, { name: 'Доставка', qty: 1, price: 150 }] }, M);
assert.equal(r3.json.data.number, '106593');
assert.equal(r3.json.data.total, 22050);
const upd = await req('PUT', `/api/rahunky/${r1.json.id}`, { ...base, client: { name: 'Інший клієнт', contract: '№ 5 від 01.10.2026' } }, M);
assert.equal(upd.json.data.number, '10516', 'номер не змінюється при редагуванні');
assert.equal(upd.json.data.client.contract, '№ 5 від 01.10.2026');
assert.equal((await req('GET', '/api/rahunky', null, V)).json.rows.length, 3, 'перегляд бачить рахунки');

// строк зберігання
await db.run(`UPDATE invoices SET created_at = '2020-01-01T00:00:00Z', updated_at = NULL WHERE id = ?`, [r2.json.id]);
await db.run(`UPDATE versions SET created_at = '2020-01-01T00:00:00Z'`);
const app2 = createApp({ db, fetchFn });
await app2.request('/api/rahunky', { headers: { Cookie: M } });
assert.equal((await db.all(`SELECT id FROM invoices`)).length, 2, 'старий рахунок видалено');
assert.equal((await db.all(`SELECT id FROM versions`)).length, 0, 'старі версії видалено');

// скидання пароля власника
assert.equal(await resetOwnerPassword(db, 'newpass99'), 'owner');
assert.equal((await req('GET', '/api/bootstrap', null, O)).status, 401, 'старі сесії власника закрито');
assert.equal((await req('POST', '/api/auth/login', { login: 'owner', password: 'newpass99' })).status, 200);
console.log('OK — права і рахунки працюють');
