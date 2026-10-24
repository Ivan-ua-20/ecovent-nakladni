// B2B етап 1: партнери, користувачі-партнери, бренди й маржа, каталог з LP-CRM, ізоляція кабінету партнера,
// перемикач аналітики.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { partnerPrice } from '../src/modules/b2b/index.js';

const db = openDb(':memory:');
await migrate(db);
await db.run(`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`);
await db.run(`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'TestBrand', 'testbrand', 98), (902, 'OtherBrand', 'otherbrand', 99)`);
await db.batch([
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'TestBrand Fan 1', 901)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (12, 'TestBrand Fan 2', 901)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (21, 'OtherBrand Heater', 902)`, []],
]);
const PRICES = { 11: '1234.56', 12: '999.99', 21: '500.00', 31: '77.00' };
let crmCalls = 0;
const fetchFn = async (url, opts = {}) => {
  crmCalls++;
  const p = new URLSearchParams(opts.body);
  const json = (o) => new Response(JSON.stringify(o));
  if (url.includes('getProduct')) {
    const ids = p.get('product_id').split(',');
    const data = ids.filter((id) => PRICES[id]).map((id) => ({ id, name: `Товар ${id}`, price: PRICES[id], vendor: `ART-${id}`, images: [`https://cdn.example.com/p/${id}.jpg`] }));
    return json({ status: 'ok', data });
  }
  return json({ status: 'ok', data: [] });
};
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Власник' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };

// ---------- ціна партнера ----------
assert.equal(partnerPrice(1234.56, 20), 987.65, 'РРЦ − 20%, до копійок');
assert.equal(partnerPrice(999.99, 15), 849.99);
assert.equal(partnerPrice(100, 0), 100);

// ---------- 1. Партнер і його користувач ----------
const p1 = await req('POST', '/api/b2b/partners', { name: 'ТОВ Партнер Один', phone: '+380501112233' });
const p2 = await req('POST', '/api/b2b/partners', { name: 'ФОП Партнер Два' });
assert.equal(await status(() => req('POST', '/api/b2b/partners', { name: ' ' })), 400);
await req('POST', `/api/b2b/partners/${p1.id}/users`, { login: 'partner1', name: 'Іван', password: 'pass1234' });
await req('POST', `/api/b2b/partners/${p2.id}/users`, { login: 'partner2', password: 'pass1234' });
assert.equal(await status(() => req('POST', `/api/b2b/partners/${p1.id}/users`, { login: 'partner1', password: 'pass1234' })), 400, 'логін унікальний');
const users = await req('GET', '/api/users');
assert.ok(!users.users.some((u) => u.role === 'partner'), 'користувачі партнерів не в загальному списку');

// ---------- 2. Кабінет партнера ізольований ----------
const P1 = await login('partner1', 'pass1234');
const boot = await req('GET', '/api/bootstrap', null, P1);
assert.deepEqual(boot.fops, [], 'партнерові — без ФОПів і налаштувань');
assert.deepEqual(boot.settings, {});
assert.equal(boot.user.role, 'partner');
assert.ok(boot.user.perms.includes('b2b.partner') && !boot.user.perms.includes('docs.view'));
for (const [m, path] of [['GET', '/api/invoice/demo'], ['GET', '/api/users'], ['POST', '/api/an/query'], ['GET', '/api/b2b/partners'], ['GET', '/api/odb/links'], ['GET', '/api/rahunky'], ['GET', '/api/history'], ['GET', '/api/errors'], ['GET', '/api/b2b/catalog']]) {
  assert.equal(await status(() => req(m, path, m === 'POST' ? {} : null, P1)), 403, `партнеру закрито: ${path}`);
}
let cat = await req('GET', '/api/b2b/p/catalog', null, P1);
assert.equal(cat.products.length, 0, 'за замовчуванням партнер не бачить жодного бренду');

// ---------- 3. Бренди й маржа, каталог з LP-CRM ----------
await req('PUT', `/api/b2b/partners/${p1.id}/margins`, [{ brand_id: 901, margin: 20 }]);
assert.equal(await status(() => req('PUT', `/api/b2b/partners/${p1.id}/margins`, [{ brand_id: 901, margin: 120 }])), 400, 'маржа < 100%');
let sync = await req('POST', '/api/b2b/catalog/sync');
assert.equal(sync.checked, 2, 'оновлено лише товари ввімкнених брендів');
assert.equal(sync.left, 0);
cat = await req('GET', '/api/b2b/p/catalog', null, P1);
assert.equal(cat.products.length, 2);
const fan1 = cat.products.find((p) => p.id === 11);
assert.equal(fan1.rrp, 1234.56);
assert.equal(fan1.price, 987.65);
assert.equal(fan1.image, 'https://cdn.example.com/p/11.jpg', 'фото з LP-CRM');
assert.equal(fan1.article, 'ART-11');
assert.equal(fan1.margin, 20, 'партнер бачить знижку від РРЦ на бренд');
assert.equal(cat.brands[0].margin, 20);
assert.equal(cat.categories[0].n, 2);
assert.deepEqual(cat.brands.map((b) => b.name), ['TestBrand']);
const P2 = await login('partner2', 'pass1234');
assert.equal((await req('GET', '/api/b2b/p/catalog', null, P2)).products.length, 0, 'інший партнер не бачить чужих брендів');

// повторне оновлення того ж дня — без запитів до CRM
crmCalls = 0;
sync = await req('POST', '/api/b2b/catalog/sync');
assert.equal(sync.checked, 0);
assert.equal(crmCalls, 0);

// зміна РРЦ у CRM → журнал змін цін
PRICES[11] = '1300.00';
await db.run(`UPDATE b2b_catalog SET checked_at = '' WHERE product_id = 11`);
sync = await req('POST', '/api/b2b/catalog/sync');
assert.equal(sync.changed, 1);
const plog = await db.all(`SELECT * FROM b2b_price_log`);
assert.deepEqual([plog[0].product_id, plog[0].old_rrp, plog[0].new_rrp], [11, 1234.56, 1300]);
assert.equal((await req('GET', '/api/b2b/p/catalog', null, P1)).products.find((p) => p.id === 11).price, 1040);

// зміна маржі → журнал; вимкнення бренду ховає товари
await req('PUT', `/api/b2b/partners/${p1.id}/margins`, [{ brand_id: 901, margin: 25 }, { brand_id: 902, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
cat = await req('GET', '/api/b2b/p/catalog', null, P1);
assert.equal(cat.products.find((p) => p.id === 11).price, 975);
assert.equal(cat.products.find((p) => p.id === 21).price, 450);
const mlog = await db.all(`SELECT * FROM b2b_margin_log WHERE partner_id = ? ORDER BY id`, [p1.id]);
assert.equal(mlog.length, 3, 'увімкнення 901, зміна 901, увімкнення 902');
await req('PUT', `/api/b2b/partners/${p1.id}/margins`, [{ brand_id: 902, margin: 10 }]);
assert.ok(!(await req('GET', '/api/b2b/p/catalog', null, P1)).products.some((p) => p.brand_id === 901), 'вимкнений бренд зник');
// прихований товар
await req('PUT', '/api/b2b/catalog/21', { hidden: true });
assert.equal((await req('GET', '/api/b2b/p/catalog', null, P1)).products.length, 0);
await req('PUT', '/api/b2b/catalog/21', { hidden: false });
// товар вручну за ID
await req('POST', '/api/b2b/catalog/add', { ids: '31, 31, abc' });
await req('POST', '/api/b2b/catalog/sync');
assert.equal((await db.get(`SELECT rrp FROM b2b_catalog WHERE product_id = 31`)).rrp, 77);
const detail = await req('GET', `/api/b2b/partners/${p1.id}`);
assert.equal(detail.users.length, 1);
assert.ok(detail.brands.find((b) => b.id === 902).enabled);
assert.ok(!detail.brands.find((b) => b.id === 901).enabled);

// ---------- 4. Вимкнений партнер не входить ----------
await req('PUT', `/api/b2b/partners/${p2.id}`, { active: false });
assert.equal(await status(() => req('GET', '/api/b2b/p/catalog', null, P2)), 401, 'сесії вимкненого партнера закрито');
assert.equal((await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'partner2', password: 'pass1234' }) })).status >= 400, true);
// змінювати користувача-партнера через загальний розділ «Користувачі» не можна
const pu = await db.get(`SELECT id FROM users WHERE login = 'partner1'`);
assert.equal(await status(() => req('PUT', `/api/users/${pu.id}`, { role: 'admin' })), 400);

// ---------- 5. Перемикач аналітики (лише власник) ----------
await req('POST', '/api/users', { login: 'manager', password: 'pass1234', role: 'manager' });
await req('POST', '/api/users', { login: 'admin2', password: 'pass1234', role: 'admin' });
const man = await db.get(`SELECT id FROM users WHERE login = 'manager'`);
const adm = await db.get(`SELECT id FROM users WHERE login = 'admin2'`);
const AH = await login('admin2', 'pass1234');
assert.equal(await status(() => req('PUT', `/api/users/${man.id}`, { analytics: false }, AH)), 403, 'адмін не змінює доступ до аналітики');
await req('PUT', `/api/users/${man.id}`, { analytics: false });
const MH = await login('manager', 'pass1234');
assert.equal((await req('GET', '/api/bootstrap', null, MH)).user.analytics, false);
assert.equal(await status(() => req('POST', '/api/an/query', {}, MH)), 403, 'менеджер без аналітики');
await req('PUT', `/api/users/${adm.id}`, { analytics: false });
assert.equal(await status(() => req('POST', '/api/an/query', {}, AH)), 403, 'адмін без аналітики');
await req('PUT', `/api/users/${adm.id}`, { analytics: true });
assert.equal(await status(() => req('POST', '/api/an/query', {}, AH)), 200);
assert.ok((await req('GET', '/api/users')).users.find((u) => u.login === 'owner').analytics, 'власник завжди з аналітикою');
assert.ok((await db.all(`SELECT * FROM audit_log WHERE kind = 'b2b'`)).length >= 4, 'дії з партнерами — у журналі змін');

console.log('OK — B2B: партнери, бренди й маржа, каталог, ізоляція кабінету, перемикач аналітики');
