// Правки адміна в закупівлях партнерів (чернетка, очікує рахунок, з рахунком → перевиставлення рахунку),
// повні правки замовлення клієнта, кошик (видалення, хто видалив, відновлення).
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  ...[['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_hook_v', '2'], ['b2b_fin_chat', '-900']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]),
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901), (13, 'Fan 3', 901)`, []],
]);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) {
    let body = {};
    try { body = JSON.parse(opts.body); } catch { body = { file: true, method: url.split('/').pop() }; }
    tg.push({ method: url.split('/').pop(), ...body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 100 + tg.length } }));
  }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '10000.00', 12: '5000.00', 13: '2000.00' }[id] })) }));
};
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
const upload = (id, kind, name) => mk().request(`/api/b2b/orders/${id}/files?kind=${kind}`, { method: 'POST', headers: { Cookie: H.Cookie, 'Content-Type': 'application/pdf', 'X-File-Name': name }, body: new Uint8Array([37, 80, 68, 70, 1, 2, 3]) }).then((r) => r.json());

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]); // 9000, 4500, 1800
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
await db.run(`UPDATE users SET tg_chat_id = '2' WHERE login = 'pa'`);
await db.run(`UPDATE b2b_partners SET tg_group = '-500' WHERE id = ?`, [pa.id]);
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);
const ent2 = await req('POST', '/api/b2b/p/entities', { name: 'ТОВ Бета', code: '12345678' }, A);
const items = async (id) => (await req('GET', `/api/b2b/orders/${id}`)).items.map((i) => [i.product_id, i.qty, i.price]);
const edit = (id, body) => req('PUT', `/api/b2b/orders/${id}/edit`, body);

// ---------- 1. Чернетка: адмін змінює без сповіщень ----------
const d1 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 1 }], draft: true }, A);
tg.length = 0;
let r = await edit(d1.id, { items: [{ product_id: 11, qty: 1 }, { product_id: 12, qty: 2, price: '4000' }] });
assert.equal(r.total, 17000);
assert.deepEqual(await items(d1.id), [[11, 1, 9000], [12, 2, 4000]], 'новий товар з ручною ціною');
assert.equal(tg.length, 0, 'чернетка — без сповіщень');
const opt = await req('GET', `/api/b2b/orders/${d1.id}/edit-options`);
assert.deepEqual(opt.catalog.map((p) => [p.product_id, p.price]), [[11, 9000], [12, 4500], [13, 1800]]);
assert.equal(opt.invoiced, false);

// ---------- 2. Очікує рахунок: оновлений запит рахунку, партнеру — сповіщення, прибраний товар — у кошик ----------
const s1 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 2 }, { product_id: 13, qty: 1 }] }, A);
tg.length = 0;
r = await edit(s1.id, { items: [{ product_id: 11, qty: 1 }, { product_id: 13, qty: 0 }, { product_id: 12, qty: 1 }], entity_id: ent2.id, comment: 'правка' });
assert.deepEqual([r.changed, r.total, r.reinvoice], [true, 13500, false]);
let o = (await req('GET', `/api/b2b/orders/${s1.id}`)).order;
assert.deepEqual([o.status, o.comment], ['invoice_wait', 'правка']);
assert.match(o.entity, /ТОВ Бета/);
assert.ok(tg.some((m) => String(m.chat_id) === '2' && /змінив менеджер/.test(m.text) && /Fan 3|Товар 13/.test(m.text)), 'партнеру — що змінено');
assert.ok(tg.some((m) => String(m.chat_id) === '-900'), 'фінгрупа — оновлений запит');
let trash = await req('GET', '/api/b2b/trash');
assert.deepEqual(trash.map((t) => [t.kind, t.order_id, t.deleted_by, t.can_restore]), [['item', s1.id, 'owner', false]]);
assert.equal((await edit(s1.id, { items: [{ product_id: 11, qty: 1 }, { product_id: 12, qty: 1 }] })).changed, false);
assert.match(await errOf(() => edit(s1.id, { items: [{ product_id: 11, qty: 0 }] })), /хоча б один/);

// ---------- 3. З рахунком (оплачено): перевиставлення рахунку ----------
await req('PUT', `/api/b2b/orders/${s1.id}`, { invoice_no: 'СФ-1', invoice_date: '2026-10-20' });
await upload(s1.id, 'invoice', 'old.pdf');
await db.run(`UPDATE b2b_files SET created_at = ? WHERE order_id = ?`, [new Date(Date.now() - 60000).toISOString(), s1.id]);
await req('POST', `/api/b2b/orders/${s1.id}/status`, { status: 'paid' }); // оплачено 13 500
assert.equal((await req('GET', `/api/b2b/orders/${s1.id}/edit-options`)).invoiced, true);
tg.length = 0;
r = await edit(s1.id, { items: [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 1 }] }); // 22 500
assert.deepEqual([r.total, r.reinvoice], [22500, true]);
o = (await req('GET', `/api/b2b/orders/${s1.id}`)).order;
assert.deepEqual([o.status, o.invoice_no, o.reinvoice, o.paid_amount], ['invoice_wait', '', 'СФ-1', 13500]);
const fin = tg.find((m) => String(m.chat_id) === '-900');
assert.match(fin.text, /Переробіть рахунок № СФ-1 · B2B-/);
assert.match(fin.text, /уже оплачено 13/);
assert.ok(tg.some((m) => String(m.chat_id) === '-500' && /буде перевиставлено/.test(m.text)), 'група партнера — рахунок перевиставляється');
assert.match((await req('GET', `/api/b2b/p/orders/${s1.id}`, null, A)).order.reinvoice, /СФ-1/, 'партнер бачить');
// новий рахунок: статус за оплатою (13 500 з 22 500 — частково), старий файл замінено
await req('PUT', `/api/b2b/orders/${s1.id}`, { invoice_no: 'СФ-2', invoice_date: '2026-10-27' });
o = (await req('GET', `/api/b2b/orders/${s1.id}`)).order;
assert.deepEqual([o.status, o.invoice_no, o.reinvoice], ['partial', 'СФ-2', '']);
tg.length = 0;
await upload(s1.id, 'invoice', 'new.pdf');
const files = (await req('GET', `/api/b2b/orders/${s1.id}`)).files.filter((f) => f.kind === 'invoice');
assert.deepEqual(files.map((f) => f.name), ['new.pdf'], 'старий рахунок замінено новим');
assert.ok(tg.some((m) => m.file), 'новий рахунок — файлом у групу партнера');
assert.ok((await req('GET', `/api/b2b/orders/${s1.id}`)).history.some((h) => /перевиставлено: № СФ-2 замість СФ-1/.test(h.action)));

// ---------- 4. Замовлення клієнта: повні правки адміна ----------
const c1 = await req('POST', '/api/b2b/p/clients', { client_name: 'Клієнт 1', client_phone: '0501112233', items: [{ product_id: 11, qty: 1 }], supply_id: s1.id }, A);
const co = await req('GET', `/api/b2b/clients/${c1.id}/edit-options`);
assert.deepEqual(co.supplies.find((s) => s.id === s1.id).items.find((i) => i.product_id === 11).left, 2, 'власна кількість не віднімається');
r = await req('PUT', `/api/b2b/clients/${c1.id}/edit`, { client_name: 'Клієнт Новий', client_phone: '0671112233', ttn: '20450000000001', comment: 'x', supply_id: s1.id, items: [{ product_id: 11, qty: 2 }] });
let cd = await req('GET', `/api/b2b/orders/${c1.id}`);
assert.deepEqual([cd.order.client_name, cd.order.client_phone, cd.order.ttn, cd.order.total], ['Клієнт Новий', '380671112233', '20450000000001', 18000]);
assert.match(await errOf(() => req('PUT', `/api/b2b/clients/${c1.id}/edit`, { client_name: 'К', client_phone: '0671112233', supply_id: s1.id, items: [{ product_id: 11, qty: 3 }] })), /залишилось 2/);
// без закупівлі — у відкриту, без лімітів партнера
await req('PUT', `/api/b2b/partners/${pa.id}`, { name: 'Партнер А', open_limit: 1000 });
await req('PUT', `/api/b2b/clients/${c1.id}/edit`, { client_name: 'Клієнт Новий', client_phone: '0671112233', supply_id: null, items: [{ product_id: 12, qty: 1 }] });
cd = await req('GET', `/api/b2b/orders/${c1.id}`);
assert.equal(cd.order.open_supply, true);
const openId = cd.order.supply_id;
assert.equal((await req('GET', `/api/b2b/orders/${openId}`)).order.total, 4500, 'відкрита перерахована');
assert.match(await errOf(() => edit(openId, { items: [{ product_id: 12, qty: 2 }] })), /Відкрита закупівля складається/);
await req('PUT', `/api/b2b/clients/${c1.id}`, { crm_id: '777' }); // передано в CRM
r = await req('PUT', `/api/b2b/clients/${c1.id}/edit`, { client_name: 'Клієнт Новий 2', client_phone: '0671112233', supply_id: null, items: [{ product_id: 12, qty: 1 }] });
assert.equal(r.inCrm, '777', 'уже в CRM — підказка змінити там');
// партнер не може
assert.ok(await errOf(() => req('PUT', `/api/b2b/clients/${c1.id}/edit`, { client_name: 'x', client_phone: '0671112233', items: [{ product_id: 12, qty: 1 }] }, A)));
assert.ok(await errOf(() => req('PUT', `/api/b2b/orders/${s1.id}/edit`, { items: [{ product_id: 11, qty: 2 }] }, A)));
assert.ok(await errOf(() => req('GET', '/api/b2b/trash', null, A)));

// ---------- 5. Кошик: видалення й відновлення ----------
assert.match(await errOf(() => req('DELETE', `/api/b2b/orders/${openId}`)), /є замовлення клієнтів/);
tg.length = 0;
await req('DELETE', `/api/b2b/orders/${c1.id}`);
assert.ok(!(await db.get(`SELECT id FROM b2b_orders WHERE id = ?`, [openId])), 'порожню відкриту закупівлю прибрано');
assert.ok(tg.some((m) => String(m.chat_id) === '2' && /видалив менеджер/.test(m.text)));
let pt = await req('GET', '/api/b2b/p/trash', null, A);
assert.equal(pt[0].kind, 'client');
assert.equal(pt[0].deleted_by, 'менеджер owner', 'партнер бачить, хто з нас видалив');
assert.equal(pt[0].can_restore, false);
trash = await req('GET', '/api/b2b/trash');
const tc = trash.find((t) => t.kind === 'client');
r = await req('POST', `/api/b2b/trash/${tc.id}/restore`);
assert.deepEqual([r.id, r.kind], [c1.id, 'client']);
cd = await req('GET', `/api/b2b/orders/${c1.id}`);
assert.equal(cd.order.client_name, 'Клієнт Новий 2');
assert.equal(cd.order.open_supply, true, 'у нову відкриту закупівлю');
assert.equal((await req('GET', `/api/b2b/orders/${cd.order.supply_id}`)).order.total, 4500);
assert.ok(cd.history.some((h) => /відновлено з кошика/.test(h.action)));
assert.match(await errOf(() => req('POST', `/api/b2b/trash/${tc.id}/restore`)), /Уже відновлено/);
// чернетку партнер видаляє сам — у кошику з позначкою «партнер»
await req('POST', `/api/b2b/p/orders/${d1.id}/cancel`, {}, A);
pt = await req('GET', '/api/b2b/p/trash', null, A);
assert.deepEqual([pt[0].kind, pt[0].by_partner, pt[0].deleted_by], ['supply', true, 'pa']);
// закупівлю з рахунком видаляє адмін → у кошик, відновлюється
const c1b = await req('GET', `/api/b2b/orders/${c1.id}`);
assert.ok(c1b);
const s2 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 13, qty: 1 }] }, A);
await req('DELETE', `/api/b2b/orders/${s2.id}`);
const ts = (await req('GET', '/api/b2b/trash')).find((t) => t.order_id === s2.id);
await req('POST', `/api/b2b/trash/${ts.id}/restore`);
assert.deepEqual(await items(s2.id), [[13, 1, 1800]]);

console.log('b2b-edit: ok');
