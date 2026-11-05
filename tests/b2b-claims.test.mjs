// B2B: обміни й повернення браку (заявки) і статуси замовлень клієнтів з LP-CRM (фоново, фільтр, сповіщення).
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'TestBrand', 'testbrand', 98)`, []],
  [`INSERT INTO b2b_catalog (product_id, name, article, rrp, brand_id) VALUES (11, 'Fan', 'F-1', 1000, 901), (12, 'Fan 2', 'F-2', 500, 901)`, []],
]);
const tg = [];
const crm = [];
let crmStatus = '1';
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) {
    let body = {};
    try { body = JSON.parse(opts.body); } catch { body = { file: true, chat_id: opts.body?.get?.('chat_id') }; }
    tg.push(body);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  }
  const method = url.match(/\/api\/(\w+)\.html/)[1];
  const p = Object.fromEntries(new URLSearchParams(opts.body));
  crm.push({ method, p });
  const json = (o) => new Response(JSON.stringify(o));
  if (method === 'addNewOrder') return json({ status: 'ok', data: { order_id: p.order_id }, message: 'ok' });
  if (method === 'getOrdersByID') return json({ status: 'ok', data: p.order_id.split(',').map((c) => ({ order_id: c, id: '99001', status: crmStatus, products: [], bayer_name: 'x' })) });
  if (method === 'getStatuses') return json({ status: 'ok', data: { 1: 'Отправлен', 2: 'Доставлен', 3: 'Возврат' } });
  return json({ status: 'ok', data: [] });
};
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Адмін' }), headers: { 'Content-Type': 'application/json' } });
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
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await db.run(`UPDATE b2b_partners SET tg_group = '-100500' WHERE id = ?`, [pa.id]);
await db.run(`UPDATE users SET tg_chat_id = '200' WHERE login = 'pa'`);
await db.run(`UPDATE users SET tg_chat_id = '100' WHERE login = 'owner'`);
const A = await login('pa', 'pass1234');
await req('POST', '/api/b2b/p/entities', { name: 'ФОП А', code: '1234567890' }, A);
const ent = (await req('GET', '/api/b2b/p/entities', null, A))[0];

// закупівля → оплачено → замовлення клієнта → у CRM
const sup = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 3 }, { product_id: 12, qty: 1 }] }, A);
await req('PUT', `/api/b2b/orders/${sup.id}`, { invoice_no: 'СФ-1', invoice_date: '2026-11-01', waybill_no: '' });
await req('POST', `/api/b2b/orders/${sup.id}/status`, { status: 'paid', note: 'оплата готівкою' });
const k1 = await req('POST', '/api/b2b/p/clients', { client_name: 'Клієнт Брак', client_phone: '0501112233', ttn: '20450000000001', supply_id: sup.id, items: [{ product_id: 11, qty: 2 }] }, A);
await db.run(`UPDATE b2b_orders SET status = 'crm', crm_id = '99001', crm_ext = 'B2B-${k1.id}', crm_status = 'Отправлен', crm_checked_at = '' WHERE id = ?`, [k1.id]);

// ---------- 1. Статуси LP-CRM: фоново, лише зміни, сповіщення, фільтр ----------
crmStatus = '2';
tg.length = 0;
await db.run(`INSERT INTO settings (key, value) VALUES ('cron_key', 'ck1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
const cron = async () => (await mk().request('/api/cron/run/b2b-crm-status', { method: 'POST', headers: { 'X-Cron-Key': 'ck1' } })).json();
const beforeAt = (await db.get(`SELECT crm_checked_at FROM b2b_orders WHERE id = ?`, [k1.id])).crm_checked_at;
const r1 = await cron();
assert.ok(!r1.error, JSON.stringify(r1));
let o = (await req('GET', `/api/b2b/orders/${k1.id}`)).order;
assert.notEqual(o.crm_checked_at, beforeAt, 'змінився — записано');
// вдруге одразу — пропускаємо (раз на 30 хв); без змін статусу — у базу не пишемо
const r2c = await cron();
assert.ok(JSON.stringify(r2c).includes('skipped'), JSON.stringify(r2c));
await db.run(`UPDATE settings SET value = '' WHERE key = 'b2b_crm_cron_at'`);
const at1 = (await db.get(`SELECT crm_checked_at FROM b2b_orders WHERE id = ?`, [k1.id])).crm_checked_at;
await cron();
assert.equal((await db.get(`SELECT crm_checked_at FROM b2b_orders WHERE id = ?`, [k1.id])).crm_checked_at, at1, 'без змін — без запису');
assert.equal(o.crm_status, 'Доставлен');
assert.ok(tg.some((m) => String(m.chat_id) === '200' && /Доставлен/.test(m.text)), 'партнеру — доставлено');
assert.ok((await req('GET', `/api/b2b/orders/${k1.id}`)).history.some((x) => /статус у LP-CRM: «Отправлен» → «Доставлен»/.test(x.action)));
let list = await req('GET', '/api/b2b/p/clients?crm_status=Доставлен', null, A);
assert.deepEqual(list.rows.map((r) => r.id), [k1.id]);
assert.deepEqual(list.crm_statuses, [{ name: 'Доставлен', n: 1 }]);
assert.equal((await req('GET', '/api/b2b/p/clients?crm_status=Возврат', null, A)).rows.length, 0);
assert.equal((await req('GET', '/api/b2b/clients?crm_status=Доставлен')).rows.length, 1);

// ---------- 2. Заявка на обмін від партнера ----------
const src = await req('GET', `/api/b2b/p/claims/source/${k1.id}`, null, A);
assert.deepEqual(src.items.map((i) => [i.product_id, i.qty]), [[11, 2]]);
assert.match(await errOf(() => req('POST', '/api/b2b/p/claims', { order_id: k1.id, items: [], reason: 'defect', descr: 'не вмикається' }, A)), /Позначте товар/);
assert.match(await errOf(() => req('POST', '/api/b2b/p/claims', { order_id: k1.id, items: [{ product_id: 11, qty: 3 }], reason: 'defect', descr: 'не вмикається' }, A)), /лише 2 шт/);
assert.match(await errOf(() => req('POST', '/api/b2b/p/claims', { order_id: k1.id, items: [{ product_id: 11, qty: 1 }], descr: 'не вмикається' }, A)), /причину/);
tg.length = 0;
const cl = await req('POST', '/api/b2b/p/claims', { order_id: k1.id, items: [{ product_id: 11, qty: 1 }], reason: 'defect', descr: 'Не вмикається після першого запуску', want: 'same', deliver_to: 'partner' }, A);
assert.equal(cl.number, `О-${cl.id}`);
const grp = tg.filter((m) => String(m.chat_id) === '-100500');
assert.ok(grp.some((m) => /Нова заявка на обмін/.test(m.text) && /Клієнт Брак/.test(m.text) && /Fan \(F-1\) × 1/.test(m.text) && /Заводський брак/.test(m.text)
  && /Не вмикається/.test(m.text) && /уже замінив клієнту/.test(m.text)), 'у групу партнера — уся інформація');
assert.ok(tg.some((m) => String(m.chat_id) === '100' && /Нова заявка/.test(m.text)), 'нам');
assert.ok((await req('GET', `/api/b2b/orders/${k1.id}`)).history.some((x) => /заявка на обмін О-\d+: подано/.test(x.action)), 'в історії замовлення');
// фото — необов'язково; додане — у групу файлом, не серед документів замовлення
tg.length = 0;
const up = await mk().request(`/api/b2b/p/claims/${cl.id}/files`, { method: 'POST', headers: { Cookie: A.Cookie, 'Content-Type': 'image/jpeg', 'x-file-name': 'brak.jpg' }, body: new Uint8Array([255, 216, 255, 1, 2, 3]) });
assert.equal(up.status, 200);
assert.ok(tg.some((m) => m.file && String(m.chat_id) === '-100500'), 'фото — у групу');
assert.equal((await req('GET', `/api/b2b/p/clients/${k1.id}`, null, A)).files.length, 0, 'фото заявки не серед документів замовлення');
let d = await req('GET', `/api/b2b/p/claims/${cl.id}`, null, A);
assert.equal(d.files.length, 1);
assert.equal((await mk().request(`/api/b2b/p/claims/${cl.id}/files/${d.files[0].id}`, { headers: { Cookie: A.Cookie } })).status, 200);

// ---------- 3. Розгляд, погодження, ТТН повернення, перевірка браку ----------
await req('POST', `/api/b2b/claims/${cl.id}/action`, { action: 'review' });
assert.match(await errOf(() => req('POST', `/api/b2b/claims/${cl.id}/action`, { action: 'approve' })), /що робити з бракованим/);
tg.length = 0;
await req('POST', `/api/b2b/claims/${cl.id}/action`, { action: 'approve', return_mode: 'warehouse', note: 'міняємо' });
assert.ok(tg.some((m) => String(m.chat_id) === '-100500' && /погоджено/.test(m.text) && /ТТН повернення/.test(m.text)));
assert.match(await errOf(() => req('POST', `/api/b2b/p/claims/${cl.id}/cancel`, {}, A)), /вже погоджено/);
await req('PUT', `/api/b2b/p/claims/${cl.id}/return-ttn`, { ttn: '20459999999999' }, A);
await req('POST', `/api/b2b/p/claims/${cl.id}/comment`, { text: 'Відправили сьогодні' }, A);
await req('POST', `/api/b2b/claims/${cl.id}/action`, { action: 'defect', defect: 'confirmed' });

// ---------- 4. Заміна: обмінна закупівля 0 грн, оплачено вручну, з неї — замовлення клієнта ----------
const rep = await req('POST', `/api/b2b/claims/${cl.id}/action`, { action: 'replace', delivery: 'np' });
const ex = await req('GET', `/api/b2b/orders/${rep.supply_id}`);
assert.deepEqual([ex.order.status, ex.order.total, ex.order.paid_note, ex.order.claim_id], ['paid', 0, `обмін за заявкою О-${cl.id}`, cl.id]);
assert.deepEqual(ex.items.map((i) => [i.product_id, i.qty, i.price]), [[11, 1, 0]]);
assert.equal(ex.order.entity_id, ent.id);
const sups = await req('GET', '/api/b2b/p/supplies', null, A);
assert.ok(sups.some((s) => s.id === rep.supply_id), 'партнер бачить обмінну закупівлю у виборі для замовлення клієнта');
const k2 = await req('POST', '/api/b2b/p/clients', { client_name: 'Партнер собі', client_phone: '0501112233', ttn: '20450000000002', supply_id: rep.supply_id, items: [{ product_id: 11, qty: 1 }] }, A);
assert.equal((await req('GET', `/api/b2b/orders/${k2.id}`)).order.total, 0);
d = await req('GET', `/api/b2b/claims/${cl.id}`);
assert.deepEqual([d.claim.status, d.claim.return_ttn, d.claim.defect, d.claim.exch_number], ['resolved', '20459999999999', 'confirmed', `B2B-${rep.supply_id}`]);
assert.ok(d.history.some((x) => /ТТН повернення браку/.test(x.action)) && d.history.some((x) => /коментар: Відправили/.test(x.action)));
await req('POST', `/api/b2b/claims/${cl.id}/action`, { action: 'close' });
assert.equal((await req('GET', `/api/b2b/p/claims/${cl.id}`, null, A)).claim.status, 'closed');

// ---------- 5. Інший товар; повернення коштів; відхилення; скасування партнером ----------
const c2 = await req('POST', '/api/b2b/p/claims', { order_id: sup.id, items: [{ product_id: 12, qty: 1 }], reason: 'wrong', descr: 'Прийшов не той колір', want: 'other', want_items: [{ product_id: 11, qty: 1 }] }, A);
await req('POST', `/api/b2b/claims/${c2.id}/action`, { action: 'approve', return_mode: 'none', refund_amount: '0' });
const r2 = await req('POST', `/api/b2b/claims/${c2.id}/action`, { action: 'replace', delivery: 'pickup' });
const ex2 = await req('GET', `/api/b2b/orders/${r2.supply_id}`);
assert.deepEqual([ex2.order.delivery, ex2.items[0].product_id], ['pickup', 11]);
const c3 = await req('POST', '/api/b2b/p/claims', { order_id: sup.id, items: [{ product_id: 11, qty: 1 }], reason: 'damaged', descr: 'Розбитий корпус', want: 'refund' }, A);
await req('POST', `/api/b2b/claims/${c3.id}/action`, { action: 'approve', return_mode: 'supplier', refund_amount: '900' });
assert.match(await errOf(() => req('POST', `/api/b2b/claims/${c3.id}/action`, { action: 'replace' })), /повернення коштів/);
assert.match(await errOf(() => req('POST', `/api/b2b/claims/${c3.id}/action`, { action: 'refund' })), /як повернули/);
await req('POST', `/api/b2b/claims/${c3.id}/action`, { action: 'refund', note: 'зараховано в наступну закупівлю' });
assert.deepEqual([(await req('GET', `/api/b2b/claims/${c3.id}`)).claim.status, (await req('GET', `/api/b2b/claims/${c3.id}`)).claim.refund_amount], ['resolved', 900]);
const c4 = await req('POST', '/api/b2b/p/claims', { order_id: sup.id, items: [{ product_id: 11, qty: 1 }], reason: 'other', descr: 'Не подобається' }, A);
assert.match(await errOf(() => req('POST', `/api/b2b/claims/${c4.id}/action`, { action: 'reject' })), /причину відмови/);
await req('POST', `/api/b2b/claims/${c4.id}/action`, { action: 'reject', note: 'не гарантійний випадок' });
const c5 = await req('POST', '/api/b2b/p/claims', { order_id: sup.id, items: [{ product_id: 11, qty: 1 }], reason: 'other', descr: 'Помилково подали' }, A);
await req('POST', `/api/b2b/p/claims/${c5.id}/cancel`, {}, A);
const all = await req('GET', '/api/b2b/p/claims', null, A);
assert.deepEqual(all.rows.map((r) => r.status), ['cancelled', 'rejected', 'resolved', 'resolved', 'closed']);
assert.equal((await req('GET', '/api/b2b/p/claims?status=open', null, A)).rows.length, 0);
// чужий партнер не бачить
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pb.id}/users`, { login: 'pb', password: 'pass1234' });
const B = await login('pb', 'pass1234');
assert.match(await errOf(() => req('GET', `/api/b2b/p/claims/${cl.id}`, null, B)), /не знайдено/);
assert.match(await errOf(() => req('POST', '/api/b2b/p/claims', { order_id: k1.id, items: [{ product_id: 11, qty: 1 }], reason: 'defect', descr: 'чужий' }, B)), /не знайдено/);
// наш менеджер подає заявку сам
const c6 = await req('POST', '/api/b2b/claims', { order_id: k1.id, items: [{ product_id: 11, qty: 1 }], reason: 'broken', descr: 'Клієнт подзвонив нам' });
assert.equal((await req('GET', `/api/b2b/claims/${c6.id}`)).claim.partner_id, pa.id);
assert.equal((await req('GET', '/api/b2b/claims?status=open')).rows.length, 1);

console.log('OK — B2B: обміни/повернення й статуси LP-CRM');
