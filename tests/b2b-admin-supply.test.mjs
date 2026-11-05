// Закупівля від нас: адмін створює для партнера (бренди й маржа партнера, оплата, отримання), партнер отримує сповіщення
// й підтверджує (обирає юрособу) або відхиляє; «на склад партнера» — одним замовленням у LP-CRM.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'TestBrand', 'testbrand', 98), (902, 'Other', 'other', 99)`, []],
  [`INSERT INTO b2b_catalog (product_id, name, article, rrp, brand_id) VALUES (11, 'Fan', 'F-1', 1000, 901), (12, 'Fan 2', '', 500, 901), (13, 'Чужий', '', 300, 902)`, []],
]);
const tg = [];
const crm = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  const method = url.match(/\/api\/(\w+)\.html/)[1];
  const p = Object.fromEntries(new URLSearchParams(opts.body));
  crm.push({ method, p });
  const json = (o) => new Response(JSON.stringify(o));
  if (method === 'addNewOrder') return json({ status: 'ok', data: { order_id: p.order_id }, message: 'ok' });
  if (method === 'getOrdersByID') return json({ status: 'ok', data: p.order_id.split(',').map((c) => ({ order_id: c, id: '99001', status: '1', products: [], bayer_name: 'x' })) });
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
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await db.run(`UPDATE b2b_partners SET tg_group = '-100500' WHERE id = ?`, [pa.id]);
await db.run(`UPDATE users SET tg_chat_id = '200' WHERE login = 'pa'`);
await db.run(`UPDATE users SET tg_chat_id = '100' WHERE login = 'owner'`);
const A = await login('pa', 'pass1234');

// ---------- 1. Варіанти для форми: лише бренди партнера, ціни за його маржею ----------
const opt = await req('GET', `/api/b2b/partners/${pa.id}/supply-options`);
assert.deepEqual(opt.brands.map((b) => [b.name, b.margin]), [['TestBrand', 10]]);
assert.deepEqual(opt.products.map((p) => [p.product_id, p.price]), [[11, 900], [12, 450]], 'ціна партнера = РРЦ − маржа; чужий бренд не показується');
assert.equal(opt.partner.entities, 0);

// ---------- 2. Створення: перевірки, статус, сповіщення ----------
assert.equal(await status(() => req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 13, qty: 1 }] })), 400, 'товар бренду, не відкритого партнеру, — ні');
assert.match(await errOf(() => req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 11, qty: 1 }], pay_terms: 'postpay', pay_days: 0 })), /Відстрочка/);
assert.match(await errOf(() => req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 11, qty: 1 }], delivery: 'warehouse', ship_to: { name: 'Склад' } })), /Склад партнера/);
tg.length = 0;
const o = await req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 1 }], pay_terms: 'postpay', pay_days: 14,
  delivery: 'warehouse', ship_to: { name: 'Петренко Склад', phone: '050 111 22 33', address: 'Київ, відділення № 25' }, comment: 'Акція' });
assert.equal(o.total, 2250);
let d = await req('GET', `/api/b2b/orders/${o.id}`);
assert.equal(d.order.status, 'confirm');
assert.equal(d.order.pay_terms, 'postpay');
assert.equal(d.order.pay_days, 14, 'відстрочка задана вручну, хоча партнеру її не відкрито');
assert.deepEqual(d.order.ship_to, { name: 'Петренко Склад', phone: '0501112233', address: 'Київ, відділення № 25' });
assert.ok(tg.some((m) => String(m.chat_id) === '200' && m.text.includes('Підтвердіть')), 'партнеру особисто');
assert.ok(tg.some((m) => String(m.chat_id) === '-100500' && m.text.includes('НА СКЛАД ПАРТНЕРА')), 'і в групу партнера');
assert.equal((await db.get(`SELECT wh_address FROM b2b_partners WHERE id = ?`, [pa.id])).wh_address, 'Київ, відділення № 25', 'склад запам’ятовується');
assert.equal((await req('GET', `/api/b2b/partners/${pa.id}/supply-options`)).partner.warehouse.name, 'Петренко Склад');

// ---------- 3. Партнер: бачить, не може змінити, не передається в CRM до підтвердження ----------
const pl = await req('GET', '/api/b2b/p/orders', null, A);
assert.equal(pl.rows[0].status, 'confirm');
assert.equal(await status(() => req('PUT', `/api/b2b/p/orders/${o.id}`, { items: [{ product_id: 11, qty: 1 }] }, A)), 400, 'партнер не змінює — лише підтверджує або відхиляє');
await req('PUT', '/api/b2b/crm-settings', { on: true, office: '7' });
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${o.id}/crm`)), /не підтвердив/);
assert.equal((await req('GET', '/api/b2b/p/limits', null, A)).unpaid.total, 0, 'непідтверджена не рахується в неоплачені');
assert.match(await errOf(() => req('POST', `/api/b2b/p/orders/${o.id}/confirm`, { entity_id: 999 }, A)), /Юрособу/);

// ---------- 4. Підтвердження: юрособа → «Очікує рахунок» ----------
const ea = await req('POST', '/api/b2b/p/entities', { name: 'ФОП А', code: '1234567890' }, A);
tg.length = 0;
await req('POST', `/api/b2b/p/orders/${o.id}/confirm`, { entity_id: ea.id }, A);
d = await req('GET', `/api/b2b/orders/${o.id}`);
assert.equal(d.order.status, 'invoice_wait');
assert.ok(d.order.entity.startsWith('ФОП А'));
assert.ok(tg.some((m) => String(m.chat_id) === '100' && m.text.includes('Партнер підтвердив')), 'адмінам — про підтвердження');
assert.equal(await status(() => req('POST', `/api/b2b/p/orders/${o.id}/confirm`, { entity_id: ea.id }, A)), 400, 'двічі — ні');
// з такої закупівлі замовлення клієнтів не оформлюються
assert.equal((await req('GET', '/api/b2b/p/supplies', null, A)).length, 0);

// ---------- 5. LP-CRM: одне замовлення на склад партнера, ціни партнера ----------
crm.length = 0;
const cr = await req('POST', `/api/b2b/orders/${o.id}/crm`);
assert.equal(cr.crm_id, '99001');
const add = crm.find((x) => x.method === 'addNewOrder').p;
assert.equal(add.bayer_name, 'Петренко Склад');
assert.equal(add.phone, '0501112233');
assert.equal(add.delivery_adress, 'Київ, відділення № 25');
assert.equal(add.office, '7');
assert.ok(add.comment.includes(`B2B-${o.id}`) && add.comment.includes('склад партнера'));
assert.ok(decodeURIComponent(add.products.replace(/\+/g, ' ')).includes('s:5:"price";s:3:"900"'), 'ціна партнера');
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${o.id}/crm`)), /Уже в LP-CRM/);
assert.equal(await status(() => req('POST', `/api/b2b/orders/${o.id}/delivery`, { delivery: 'np' })), 400, 'після передачі в CRM спосіб отримання не змінюється');

// ---------- 5б. Самовивіз: після рахунку — одне замовлення в LP-CRM, склад готує товар до приїзду партнера ----------
// самовивіз без «хто забирає» не оформлюється; вписаний вручну з «зберегти» — у «Кур'єри»
assert.match(await errOf(() => req('POST', '/api/b2b/p/orders', { entity_id: ea.id, delivery: 'pickup', items: [{ product_id: 12, qty: 2 }] }, A)), /вкажіть, хто забирає/);
const pk = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, delivery: 'pickup', items: [{ product_id: 12, qty: 2 }], pickup_by: { name: 'Марія Менеджер', phone: '0991112233', save: true } }, A);
const kur = await req('GET', '/api/b2b/p/couriers', null, A);
assert.deepEqual(kur.map((k) => [k.name, k.phone]), [['Марія Менеджер', '380991112233']], 'збережено в «Кур’єри»');
assert.equal((await req('GET', `/api/b2b/orders/${pk.id}`)).order.pickup_by.courier_id, kur[0].id);
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${pk.id}/crm`)), /Спершу внесіть номер рахунку/);
await req('PUT', `/api/b2b/orders/${pk.id}`, { invoice_no: 'СФ-77', invoice_date: '2026-11-04', waybill_no: '' });
await db.run(`UPDATE b2b_partners SET phone = '', wh_phone = '' WHERE id = ?`, [pa.id]);
// партнер змінює, хто забирає (ПІБ і телефон обов'язкові) — адмінам сповіщення, в історії
assert.match(await errOf(() => req('PUT', `/api/b2b/p/orders/${pk.id}/pickup`, { name: 'Іван', phone: '123' }, A)), /телефон/);
tg.length = 0;
await req('PUT', `/api/b2b/p/orders/${pk.id}/pickup`, { name: 'Іван Водій', phone: '067 555 44 33', note: 'Caddy АА1234ВВ' }, A);
assert.ok(tg.some((m) => String(m.chat_id) === '100' && /змінено, хто забирає — <b>Іван Водій, \+380675554433, Caddy АА1234ВВ<\/b>/.test(m.text)), 'адмінам — хто приїде');
d = await req('GET', `/api/b2b/p/orders/${pk.id}`, null, A);
assert.deepEqual(d.order.pickup_by, { name: 'Іван Водій', phone: '380675554433', note: 'Caddy АА1234ВВ' });
assert.ok(d.history.some((x) => /було: Марія Менеджер/.test(x.action)));
assert.ok(d.history.some((x) => /хто забирає зі складу: Іван Водій/.test(x.action)));
assert.deepEqual((await req('GET', '/api/b2b/p/limits', null, A)).pickup_last.name, 'Іван Водій', 'наступного разу — підказка');
await db.run(`UPDATE b2b_partners SET phone = '+38 (067) 111-22-33' WHERE id = ?`, [pa.id]);
await db.run(`INSERT INTO settings (key, value) VALUES ('b2b_crm_pickup_delivery', '5') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
crm.length = 0;
tg.length = 0;
await req('POST', `/api/b2b/orders/${pk.id}/crm`);
const pAdd = crm.find((x) => x.method === 'addNewOrder').p;
assert.equal(pAdd.delivery, '5', 'вид доставки «Самовивіз»');
assert.equal(pAdd.delivery_adress, 'Самовивіз зі складу');
assert.equal(pAdd.phone, '380675554433', 'телефон того, хто забирає');
assert.equal(pAdd.bayer_name, 'Іван Водій');
assert.ok(pAdd.comment.includes('Забирає: Іван Водій, +380675554433, Caddy АА1234ВВ'), pAdd.comment);
assert.ok(pAdd.comment.includes('САМОВИВІЗ') && pAdd.comment.includes('СФ-77') && pAdd.comment.includes('ОЧІКУЄМО ОПЛАТУ'), pAdd.comment);
d = await req('GET', `/api/b2b/orders/${pk.id}`);
assert.ok(d.order.crm_id || d.order.crm_ext);
assert.ok(d.history.some((x) => /склад готує самовивіз/.test(x.action)));
assert.ok(tg.some((m) => /готуємо до самовивозу/.test(m.text)), 'партнеру — що склад готує');
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${pk.id}/crm`)), /Уже в LP-CRM/);
// сторінка «Накладні»: рахунок і накладна закупівлі (склад друкує й видає кур'єру) — за правом docs.view
const up = await mk().request(`/api/b2b/orders/${pk.id}/files?kind=invoice`, { method: 'POST', headers: { Cookie: H.Cookie, 'Content-Type': 'application/pdf', 'X-File-Name': 'rahunok.pdf' }, body: new Uint8Array([37, 80, 68, 70, 1]) }).then((r) => r.json());
const fid = (await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = 'invoice' ORDER BY id DESC`, [pk.id])).id;
assert.ok(up && fid);
const dl = await mk().request(`/api/b2b/supply-doc/${fid}`, { headers: { Cookie: H.Cookie } });
assert.equal(dl.status, 200);
assert.equal((await mk().request(`/api/b2b/supply-doc/${fid}`, { headers: { Cookie: A.Cookie } })).status, 403, 'партнер — ні');
const np0 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 12, qty: 1 }] }, A);
await mk().request(`/api/b2b/orders/${np0.id}/files?kind=invoice`, { method: 'POST', headers: { Cookie: H.Cookie, 'Content-Type': 'application/pdf', 'X-File-Name': 'r2.pdf' }, body: new Uint8Array([37, 80, 68, 70, 2]) });
const fid2 = (await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = 'invoice'`, [np0.id])).id;
assert.equal((await mk().request(`/api/b2b/supply-doc/${fid2}`, { headers: { Cookie: H.Cookie } })).status, 404, 'лише закупівлі, передані на склад');

// змінили, хто забирає, після передачі на склад — адмінам: оновіть у LP-CRM
tg.length = 0;
await req('PUT', `/api/b2b/p/orders/${pk.id}/pickup`, { name: 'Петро Кур’єр', phone: '0501234567' }, A);
assert.ok(tg.some((m) => /змінено, хто забирає/.test(m.text) && /оновіть отримувача/.test(m.text)));
// одразу при оформленні; не самовивіз — не можна
const pk2 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, delivery: 'pickup', items: [{ product_id: 12, qty: 1 }], pickup_by: { name: 'Олег Менеджер', phone: '0931112233' } }, A);
assert.equal((await req('GET', `/api/b2b/orders/${pk2.id}`)).order.pickup_by.name, 'Олег Менеджер');
// кур'єр зі списку: CRUD і вибір у закупівлі
const k2 = await req('POST', '/api/b2b/p/couriers', { name: 'Сергій Водій', phone: '+380 50 777 66 55', note: 'Sprinter' }, A);
assert.match(await errOf(() => req('POST', '/api/b2b/p/couriers', { name: 'Дубль', phone: '0507776655' }, A)), /уже є/);
const pk3 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, delivery: 'pickup', items: [{ product_id: 12, qty: 1 }], pickup_by: { courier_id: k2.id } }, A);
assert.deepEqual((await req('GET', `/api/b2b/orders/${pk3.id}`)).order.pickup_by, { name: 'Сергій Водій', phone: '380507776655', note: 'Sprinter', courier_id: k2.id });
assert.deepEqual((await req('GET', `/api/b2b/partners/${pa.id}/couriers`)).map((k) => k.name).sort(), ['Марія Менеджер', 'Сергій Водій'], 'наш менеджер бачить список');
await req('DELETE', `/api/b2b/p/couriers/${k2.id}`, null, A);
assert.match(await errOf(() => req('POST', '/api/b2b/p/orders', { entity_id: ea.id, delivery: 'pickup', items: [{ product_id: 12, qty: 1 }], pickup_by: { courier_id: k2.id } }, A)), /вже немає/);
// чернетка-самовивіз без «хто забирає» не відправляється
const dr = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, draft: true, delivery: 'pickup', items: [{ product_id: 12, qty: 1 }], pickup_by: { courier_id: kur[0].id } }, A);
await db.run(`UPDATE b2b_orders SET pickup_by = '' WHERE id = ?`, [dr.id]);
assert.match(await errOf(() => req('POST', `/api/b2b/p/orders/${dr.id}/send`, {}, A)), /вкажіть, хто забирає/);
const np1 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 12, qty: 1 }] }, A);
assert.match(await errOf(() => req('PUT', `/api/b2b/p/orders/${np1.id}/pickup`, { name: 'Олег', phone: '0931112233' }, A)), /не самовивіз/);

// ---------- 6. Відхилення партнером ----------
const o2 = await req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 12, qty: 3 }], delivery: 'np' });
assert.equal(await status(() => req('POST', `/api/b2b/orders/${o2.id}/crm`)), 400, 'звичайна закупівля одним замовленням у CRM не йде');
tg.length = 0;
await req('POST', `/api/b2b/p/orders/${o2.id}/cancel`, { reason: 'Не зараз' }, A);
assert.equal((await req('GET', `/api/b2b/orders/${o2.id}`)).order.status, 'cancelled');
assert.ok(tg.some((m) => m.text.includes('відхилив') && m.text.includes('Не зараз')));

// ---------- 7. Права ----------
assert.equal(await status(() => req('POST', '/api/b2b/orders', { partner_id: pa.id, items: [{ product_id: 11, qty: 1 }] }, A)), 403, 'партнер не створює «від нас»');
assert.equal(await status(() => req('GET', `/api/b2b/partners/${pa.id}/supply-options`, null, A)), 403);

// ---------- 8. Відкрита закупівля (замовлення клієнтів без закупівлі) — формуємо ми ----------
const cl = await req('POST', '/api/b2b/p/clients', { client_name: 'Без закупівлі', client_phone: '0501112233', items: [{ product_id: 12, qty: 2 }] }, A);
const openId = (await db.get(`SELECT supply_id FROM b2b_orders WHERE id = ?`, [cl.id])).supply_id;
assert.ok(openId, 'замовлення без закупівлі — у відкритій закупівлі');
assert.equal((await req('GET', `/api/b2b/orders/${openId}`)).order.status, 'open');
assert.match(await errOf(() => req('POST', `/api/b2b/orders/${openId}/form`, { entity_id: 999 })), /юрособу/);
const eo = await req('GET', `/api/b2b/orders/${openId}/edit-options`);
assert.equal(eo.entities.length, 1);
tg.length = 0;
await req('POST', `/api/b2b/orders/${openId}/form`, { entity_id: ea.id, pay_terms: 'postpay', pay_days: '10' });
d = await req('GET', `/api/b2b/orders/${openId}`);
assert.equal(d.order.status, 'invoice_wait');
assert.equal(d.order.pay_days, 10);
assert.ok(d.order.entity.startsWith('ФОП А'));
assert.ok(tg.some((m) => String(m.chat_id) === '200' && m.text.includes('сформував наш менеджер')), 'партнеру — сповіщення');
assert.equal(await status(() => req('POST', `/api/b2b/orders/${openId}/form`, { entity_id: ea.id })), 400, 'двічі — ні');
assert.equal(await status(() => req('POST', `/api/b2b/orders/${openId}/form`, { entity_id: ea.id }, A)), 403, 'партнер — своєю кнопкою в кабінеті');
// наступне замовлення без закупівлі — у нову відкриту
const cl2 = await req('POST', '/api/b2b/p/clients', { client_name: 'Ще один', client_phone: '0501112234', items: [{ product_id: 12, qty: 1 }] }, A);
const open2 = (await db.get(`SELECT supply_id FROM b2b_orders WHERE id = ?`, [cl2.id])).supply_id;
assert.ok(open2 && open2 !== openId);

console.log('OK — закупівля від нас: створення, підтвердження партнером, на склад партнера в LP-CRM');
