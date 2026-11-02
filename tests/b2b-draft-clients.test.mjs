// Замовлення клієнтів без закупівлі при наявній чернетці закупівлі: за замовчуванням — у найновішу чернетку з доставкою
// клієнтам (без ліміту відкритої закупівлі), на вибір — інша чернетка або нова закупівля; зміна й скасування (лише з
// підтвердженням) коригують товари чернетки; чернетку не зменшити нижче розписаного; видалена чернетка повертає замовлення
// у відкриту закупівлю; відправлена чернетка — звичайна закупівля для цих замовлень.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901)`, []],
]);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '10000.00', 12: '5000.00' }[id] })) }));
};
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  ...[['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_hook_v', '2']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]),
]);
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]); // Fan 9000, Fan 2 4500
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);
const cl = (name, items, extra = {}) => req('POST', '/api/b2b/p/clients', { client_name: name, client_phone: '0501112233', items, ...extra }, A);
const draftItems = async (id) => (await db.all(`SELECT product_id, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY product_id`, [id])).map((i) => [i.product_id, i.qty, i.price]);
const total = async (id) => (await db.get(`SELECT total FROM b2b_orders WHERE id = ?`, [id])).total;

// ---------- чернетки: стара, нова, самовивіз (не підходить) ----------
const dOld = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, draft: true, items: [{ product_id: 12, qty: 1 }] }, A);
const dNew = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, draft: true, items: [{ product_id: 11, qty: 1 }] }, A);
const dPick = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, draft: true, delivery: 'pickup', items: [{ product_id: 12, qty: 1 }] }, A);
const lim = await req('GET', '/api/b2b/p/limits', null, A);
assert.deepEqual(lim.drafts.map((d) => d.id), [dNew.id, dOld.id], 'чернетки для замовлень клієнтів — найновіша першою, без самовивозу');

// ---------- за замовчуванням — у найновішу чернетку, без ліміту відкритої закупівлі ----------
const c1 = await cl('Клієнт 1', [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 1 }]); // 18000 + 4500
let d = await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A);
assert.equal(d.order.supply_id, dNew.id);
assert.ok(d.order.draft_supply && !d.order.no_supply, 'у чернетці — не «без закупівлі»');
assert.deepEqual(await draftItems(dNew.id), [[11, 3, 9000], [12, 1, 4500]], 'товари замовлення додано до чернетки');
assert.equal(await total(dNew.id), 31500);
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).open.id, null, 'відкрита закупівля не створюється');
assert.ok(tg.some((m) => /у чернетку закупівлі/.test(m.text)), 'адмінам — куди пішли товари');
const c2 = await cl('Клієнт 2', [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 2 }]); // 27000 > ліміту 20000 — у чернетку можна
assert.equal((await req('GET', `/api/b2b/p/clients/${c2.id}`, null, A)).order.supply_id, dNew.id);

// ---------- обрана чернетка; нова закупівля; не та чернетка ----------
const c3 = await cl('Клієнт 3', [{ product_id: 11, qty: 1 }], { into: dOld.id });
assert.equal((await req('GET', `/api/b2b/p/clients/${c3.id}`, null, A)).order.supply_id, dOld.id);
assert.deepEqual(await draftItems(dOld.id), [[11, 1, 9000], [12, 1, 4500]]);
const c4 = await cl('Клієнт 4', [{ product_id: 12, qty: 1 }], { into: 'new' });
d = await req('GET', `/api/b2b/p/clients/${c4.id}`, null, A);
assert.ok(d.order.open_supply && d.order.no_supply, 'нова закупівля — відкрита, як раніше');
assert.match(await errOf(() => cl('Клієнт 5', [{ product_id: 12, qty: 1 }], { into: dPick.id })), /не для відправки клієнтам/);

// ---------- зміна замовлення: лишається у своїй чернетці, різниця — у чернетці ----------
await req('PUT', `/api/b2b/p/clients/${c1.id}`, { client_name: 'Клієнт 1', client_phone: '0501112233', items: [{ product_id: 11, qty: 1 }] }, A);
assert.deepEqual(await draftItems(dNew.id), [[11, 4, 9000], [12, 2, 4500]], 'c1: 2+1 → 1 Fan, Fan 2 прибрано; c2: 2+2');
// перенести в нову закупівлю — товари йдуть із чернетки
await req('PUT', `/api/b2b/p/clients/${c3.id}`, { client_name: 'Клієнт 3', client_phone: '0501112233', items: [{ product_id: 11, qty: 1 }], into: 'new' }, A);
assert.deepEqual(await draftItems(dOld.id), [[12, 1, 4500]], 'чернетка — знову лише свій товар');

// ---------- чернетку не зменшити нижче розписаного ----------
assert.match(await errOf(() => req('PUT', `/api/b2b/p/orders/${dNew.id}`, { entity_id: ent.id, items: [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 2 }] }, A)), /розписано 3 шт/);
await req('PUT', `/api/b2b/p/orders/${dNew.id}`, { entity_id: ent.id, items: [{ product_id: 11, qty: 3 }, { product_id: 12, qty: 2 }] }, A); // свій 1 Fan прибрано

// ---------- скасування — лише з підтвердженням; товари прибираються з чернетки ----------
assert.match(await errOf(() => req('POST', `/api/b2b/p/clients/${c2.id}/cancel`, {}, A)), /Підтвердіть скасування/);
assert.equal((await db.get(`SELECT status FROM b2b_orders WHERE id = ?`, [c2.id])).status, 'new');
await req('POST', `/api/b2b/p/clients/${c2.id}/cancel`, { confirm: true }, A);
assert.deepEqual(await draftItems(dNew.id), [[11, 1, 9000]], 'лишились товари c1');
assert.equal(await total(dNew.id), 9000);

// ---------- видалити чернетку → її замовлення повертаються у відкриту закупівлю ----------
const c6 = await cl('Клієнт 6', [{ product_id: 12, qty: 1 }], { into: dOld.id });
const del = await req('POST', `/api/b2b/p/orders/${dOld.id}/cancel`, {}, A);
assert.ok(del.deleted && del.moved === 1);
d = await req('GET', `/api/b2b/p/clients/${c6.id}`, null, A);
assert.ok(d.order.open_supply, 'замовлення — у відкритій закупівлі');
const openId = d.order.supply_id;
assert.deepEqual(await draftItems(openId), [[11, 1, 9000], [12, 2, 4500]], 'відкрита закупівля: c3 (Fan), c4 і c6 (Fan 2)');
const trash = JSON.parse((await db.get(`SELECT data FROM b2b_trash WHERE order_id = ?`, [dOld.id])).data);
assert.deepEqual(trash.items.map((i) => [i.product_id, i.qty]), [[12, 1]], 'у кошику — лише власні товари чернетки');

// ---------- відправлена чернетка — звичайна закупівля для своїх замовлень ----------
await req('POST', `/api/b2b/p/orders/${dNew.id}/send`, {}, A);
d = await req('GET', `/api/b2b/p/clients/${c1.id}`, null, A);
assert.ok(!d.order.draft_supply && !d.order.no_supply && d.order.supply_id === dNew.id, 'тепер «із закупівлі»');
const sup = await req('GET', `/api/b2b/p/orders/${dNew.id}`, null, A);
assert.deepEqual(sup.left.map((l) => [l.product_id, l.left]), [[11, 0]], 'усе розписано на замовлення клієнта');
// нове замовлення без закупівлі (чернеток більше немає) — у відкриту
await req('PUT', `/api/b2b/partners/${pa.id}`, { name: 'Партнер А', open_limit: 100000 });
const c7 = await cl('Клієнт 7', [{ product_id: 12, qty: 1 }]);
assert.equal((await req('GET', `/api/b2b/p/clients/${c7.id}`, null, A)).order.supply_id, openId);

// ---------- адмін: видалення замовлення з чернетки і чернетки з замовленнями ----------
const dA = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, draft: true, items: [{ product_id: 12, qty: 1 }] }, A);
const c8 = await cl('Клієнт 8', [{ product_id: 11, qty: 1 }]);
assert.equal((await req('GET', `/api/b2b/p/clients/${c8.id}`, null, A)).order.supply_id, dA.id);
await req('POST', `/api/b2b/clients/${c8.id}/cancel`, {});
assert.deepEqual(await draftItems(dA.id), [[12, 1, 4500]], 'скасував менеджер — товари прибрано з чернетки');
const c9 = await cl('Клієнт 9', [{ product_id: 11, qty: 1 }]);
await req('DELETE', `/api/b2b/orders/${dA.id}`);
assert.equal((await req('GET', `/api/b2b/p/clients/${c9.id}`, null, A)).order.supply_id, openId, 'адмін видалив чернетку — замовлення у відкритій закупівлі');
// ---------- адмін змінює замовлення в чернетці; партнер відхиляє — повертається як було ----------
const dB = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, draft: true, items: [{ product_id: 12, qty: 1 }] }, A);
const c10 = await cl('Клієнт 10', [{ product_id: 11, qty: 1 }]);
await req('PUT', `/api/b2b/clients/${c10.id}/edit`, { client_name: 'Клієнт 10', client_phone: '0501112233', items: [{ product_id: 11, qty: 2 }] });
assert.deepEqual(await draftItems(dB.id), [[11, 2, 9000], [12, 1, 4500]], 'правка менеджера — у чернетці');
await req('POST', `/api/b2b/p/clients/${c10.id}/reject`, {}, A);
assert.deepEqual(await draftItems(dB.id), [[11, 1, 9000], [12, 1, 4500]], 'відхилено — як було');
// видалене менеджером замовлення відновлюється з кошика — товари знову в чернетці
await req('DELETE', `/api/b2b/orders/${c10.id}`);
assert.deepEqual(await draftItems(dB.id), [[12, 1, 4500]]);
const tr = await db.get(`SELECT id FROM b2b_trash WHERE order_id = ? AND kind = 'client'`, [c10.id]);
await req('POST', `/api/b2b/trash/${tr.id}/restore`, {});
assert.deepEqual(await draftItems(dB.id), [[11, 1, 9000], [12, 1, 4500]], 'відновлено — товари в чернетці');
// ---------- менеджер партнера: без закупівлі — ні (ні у відкриту, ні в чернетку), лише керівник ----------
await req('POST', '/api/b2b/p/team', { login: 'olena', name: 'Олена', password: 'pass1234', partner_role: 'staff' }, A);
const S = await login('olena', 'pass1234');
const st = (extra) => req('POST', '/api/b2b/p/clients', { client_name: 'Від менеджера', client_phone: '0501112233', items: [{ product_id: 12, qty: 1 }], ...extra }, S);
assert.match(await errOf(() => st({})), /лише керівник/, 'менеджер — без закупівлі не можна');
assert.match(await errOf(() => st({ into: 'new' })), /лише керівник/);
assert.match(await errOf(() => st({ into: dB.id })), /лише керівник/, 'і в чернетку — теж ні');
assert.match(await errOf(() => req('PUT', `/api/b2b/p/clients/${c10.id}`, { client_name: 'Клієнт 10', client_phone: '0501112233', items: [{ product_id: 11, qty: 1 }] }, S)), /лише керівник/, 'змінити замовлення без закупівлі менеджер теж не може');
console.log('OK — B2B: замовлення клієнтів без закупівлі йдуть у чернетку закупівлі (вибір, зміна, скасування з підтвердженням, видалення чернетки, відправка)');
