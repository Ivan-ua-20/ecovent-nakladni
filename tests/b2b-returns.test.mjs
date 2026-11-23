// B2B: статус «Повернуто» замовлення клієнта (ТТН, на кого їде, коментар) і Telegram-група «Ремонт»
// (прив'язка у гілці, повернення й усі заявки «Брак / обмін» — туди).
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  ...[['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_secret', 'sec'], ['tg_hook_v', '2']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]),
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


const hook = (message) => mk().request('/api/tg/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'sec' }, body: JSON.stringify({ message }) });
const k2 = await req('POST', '/api/b2b/p/clients', { client_name: 'Клієнт Новий', client_phone: '0502223344', ttn: '20450000000002', supply_id: sup.id, items: [{ product_id: 12, qty: 1 }] }, A);

// ---------- 1. Група «Ремонт»: прив'язка кодом у гілці форуму, номер гарантійного відділу ----------
const { code } = await req('POST', '/api/b2b/repair-group');
tg.length = 0;
await hook({ message_id: 5, chat: { id: -100777, type: 'supergroup', title: 'Ремонт', is_forum: true }, from: { id: 1 }, text: `/link ${code}`, is_topic_message: true, message_thread_id: 3 });
assert.ok(tg.some((m) => String(m.chat_id) === '-100777' && m.message_thread_id === 3 && /«Ремонт»/.test(m.text)), 'бот відповів у ту саму гілку');
let rg = await req('GET', '/api/b2b/repair-group');
assert.deepEqual([rg.chat, rg.title], ['-100777#3', 'Ремонт']);
assert.match(await errOf(() => req('PUT', '/api/b2b/warranty-phone', { phone: '123' })), /повністю/);
await req('PUT', '/api/b2b/warranty-phone', { phone: '+380 67 000 11 22' });
assert.equal((await req('GET', '/api/b2b/p/return-info', null, A)).warranty_phone, '+380 67 000 11 22', 'партнер бачить номер');
assert.equal(await errOf(() => req('PUT', '/api/b2b/warranty-phone', { phone: '' }, A)) !== '', true, 'номер змінює лише адмін');

// ---------- 2. Повернення: лише з «Передано в CRM», усі поля обов'язкові ----------
assert.match(await errOf(() => req('POST', `/api/b2b/p/clients/${k2.id}/return`, { ttn: '20451234567890', to: 'partner', note: 'Відмова клієнта' }, A)), /Передано в CRM/);
const ret = (b) => req('POST', `/api/b2b/p/clients/${k1.id}/return`, b, A);
assert.match(await errOf(() => ret({ ttn: '', to: 'partner', note: 'Відмова клієнта' })), /ТТН/);
assert.match(await errOf(() => ret({ ttn: '20451234567890', note: 'Відмова клієнта' })), /на кого/);
assert.match(await errOf(() => ret({ ttn: '20451234567890', to: 'warranty', note: '' })), /коментар/);
tg.length = 0;
await ret({ ttn: '2045 1234 5678 90', to: 'warranty', note: 'Клієнт відмовився, коробка відкрита' });
let o = (await req('GET', `/api/b2b/orders/${k1.id}`)).order;
assert.deepEqual([o.status, o.status_name, o.return_ttn, o.return_to], ['returned', 'Повернуто', '20451234567890', 'warranty']);
const msg = tg.find((m) => String(m.chat_id) === '-100777');
assert.ok(msg && msg.message_thread_id === 3, 'у гілку групи «Ремонт»');
for (const re of [/Повернення · B2B-\d+ · Партнер А/, /ТТН до нас: <b>20451234567890/, /номер гарантійного відділу \(\+380 67 000 11 22\)/, /LP-CRM: № <b>99001/, /Клієнт Брак, \+380501112233/, /Fan \(F-1\) × 2/, /Клієнт відмовився/]) assert.match(msg.text, re);
assert.ok((await req('GET', `/api/b2b/orders/${k1.id}`)).history.some((x) => /повернення: ТТН 20451234567890/.test(x.action)), 'в історії');
assert.match(await errOf(() => ret({ ttn: '20451234567890', to: 'partner', note: 'Ще раз повертаємо' })), /вже оформлено/);
assert.equal((await req('GET', '/api/b2b/clients?view=returned')).rows.length, 1, 'фільтр «Повернуто»');
assert.equal((await req('GET', '/api/b2b/clients')).counts.returned, 1);

// ---------- 3. Скасувати повернення — лише менеджер ----------
assert.ok(await errOf(() => req('POST', `/api/b2b/clients/${k1.id}/unreturn`, {}, A)), 'партнер не може');
tg.length = 0;
await req('POST', `/api/b2b/clients/${k1.id}/unreturn`);
o = (await req('GET', `/api/b2b/orders/${k1.id}`)).order;
assert.equal(o.status, 'crm');
assert.ok(tg.some((m) => String(m.chat_id) === '200' && /скасував менеджер/.test(m.text)), 'партнеру');
assert.ok(tg.some((m) => String(m.chat_id) === '-100777' && /скасовано менеджером/.test(m.text)), 'у групу «Ремонт»');

// ---------- 4. Заявки «Брак / обмін» — теж у групу «Ремонт» ----------
tg.length = 0;
const cl = await req('POST', '/api/b2b/p/claims', { order_id: k1.id, items: [{ product_id: 11, qty: 1 }], reason: 'defect', descr: 'Не вмикається після першого запуску', want: 'same', deliver_to: 'partner' }, A);
assert.ok(tg.some((m) => String(m.chat_id) === '-100777' && m.message_thread_id === 3 && /Нова заявка на обмін/.test(m.text) && new RegExp(`b2bclaims/${cl.id}`).test(m.text)), 'заявка — у групу «Ремонт»');
assert.ok(tg.some((m) => String(m.chat_id) === '-100500' && /Нова заявка/.test(m.text)), 'група партнера — як і раніше');

// ---------- 5. Група стала супергрупою / бота прибрали ----------
await hook({ message_id: 9, chat: { id: -100777, type: 'supergroup', title: 'Ремонт' }, migrate_to_chat_id: -100888 });
assert.equal((await req('GET', '/api/b2b/repair-group')).chat, '-100888#3', 'нова група — та сама гілка');
await req('DELETE', '/api/b2b/repair-group');
assert.equal((await req('GET', '/api/b2b/repair-group')).chat, '');
// без групи — повернення приходить адмінам особисто
tg.length = 0;
await ret({ ttn: '20451234567899', to: 'partner', note: 'Повернення без групи' });
assert.ok(tg.some((m) => String(m.chat_id) === '100' && /Повернення без групи/.test(m.text) && /юрособу партнера/.test(m.text)), 'адміну особисто');
assert.equal((await req('GET', `/api/b2b/orders/${k1.id}`)).order.status, 'returned');
console.log('OK — B2B: повернення замовлень клієнтів і група «Ремонт»');
