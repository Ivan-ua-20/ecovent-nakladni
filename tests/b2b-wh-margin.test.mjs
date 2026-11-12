// Дві закупівельні ціни партнера: «відправка клієнтам» (і самовивіз) та «на склад партнера» — маржа бренду й окрема ціна товару,
// ціни в каталозі, закупівлях менеджера й партнера, зміна способу отримання з підтвердженням і перерахунком, розсилка цін.
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
import { WH_PRICE } from '../src/modules/b2b/orders.js';
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Альфа', code: '1234567890' }, A);
const get = async (id) => req('GET', `/api/b2b/orders/${id}`);
const prices = async (id) => (await get(id)).items.map((i) => [i.product_id, i.price]);
const cat = async () => new Map((await req('GET', '/api/b2b/p/catalog', null, A)).products.map((p) => [p.id, p]));
const ship = { name: 'Петренко Склад', phone: '050 111 22 33', address: 'Київ, відділення № 25' };

// ---------- 1. Маржа «на склад партнера»: порожньо — як клієнтам; задали — окрема ціна ----------
let c0 = await cat();
assert.deepEqual([c0.get(11).price, c0.get(11).price_wh], [9000, 9000], 'поки не задано — однакові');
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10, margin_wh: 15 }]);
const pd = await req('GET', `/api/b2b/partners/${pa.id}`);
assert.deepEqual(pd.brands.find((b) => b.id === 901).margin_wh, 15);
assert.deepEqual(pd.wh_price, ['warehouse']);
assert.equal((await db.get(`SELECT kind, old_margin, new_margin FROM b2b_margin_log WHERE kind = 'wh'`)).new_margin, 15, 'журнал');
c0 = await cat();
assert.deepEqual([c0.get(11).price, c0.get(11).price_wh, c0.get(13).price_wh], [9000, 8500, 1700]);
assert.match(await errOf(() => req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10, margin_wh: 120 }])), /на склад партнера/);
// без margin_wh у запиті — маржа «на склад» не скидається
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
assert.equal((await cat()).get(11).price_wh, 8500);

// ---------- 2. Окрема ціна товару: з власною «на склад» і без неї (тоді та сама на обидва способи) ----------
await req('POST', `/api/b2b/partners/${pa.id}/product-margins`, { product: '12', margin: 20, margin_wh: 25 });
await req('POST', `/api/b2b/partners/${pa.id}/product-margins`, { product: '13', margin: 30 });
c0 = await cat();
assert.deepEqual([c0.get(12).price, c0.get(12).price_wh], [4000, 3750]);
assert.deepEqual([c0.get(13).price, c0.get(13).price_wh], [1400, 1400], 'акція без окремої «на склад» — та сама');
assert.equal((await req('GET', `/api/b2b/partners/${pa.id}/product-margins`)).find((x) => x.product_id === 12).margin_wh, 25);
await req('DELETE', `/api/b2b/partners/${pa.id}/product-margins/12`);
await req('DELETE', `/api/b2b/partners/${pa.id}/product-margins/13`);

// ---------- 3. Партнер оформлює: ціна за способом; «на мій склад» — з отримувачем ----------
const sNp = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 2 }] }, A);
assert.deepEqual(await prices(sNp.id), [[11, 9000]]);
const sPk = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, delivery: 'pickup', pickup_by: { name: 'Іван Водій', phone: '0675554433' }, items: [{ product_id: 11, qty: 1 }] }, A);
assert.deepEqual(await prices(sPk.id), [[11, 9000]], 'самовивіз — як клієнтам');
assert.match(await errOf(() => req('POST', '/api/b2b/p/orders', { entity_id: ent.id, delivery: 'warehouse', ship_to: { name: 'X' }, items: [{ product_id: 11, qty: 1 }] }, A)), /Склад партнера/);
const sWh = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, delivery: 'warehouse', ship_to: ship, items: [{ product_id: 11, qty: 2 }, { product_id: 13, qty: 1 }] }, A);
let d = await get(sWh.id);
assert.deepEqual(d.items.map((i) => [i.product_id, i.price]), [[11, 8500], [13, 1700]]);
assert.equal(d.order.total, 18700);
assert.deepEqual(d.order.ship_to, { name: 'Петренко Склад', phone: '0501112233', address: 'Київ, відділення № 25' });
// партнер змінює без рахунку: спосіб → ціни одразу за новим способом
await req('PUT', `/api/b2b/p/orders/${sWh.id}`, { entity_id: ent.id, delivery: 'np', items: [{ product_id: 11, qty: 2 }, { product_id: 13, qty: 1 }] }, A);
assert.deepEqual(await prices(sWh.id), [[11, 9000], [13, 1800]]);
await req('PUT', `/api/b2b/p/orders/${sWh.id}`, { entity_id: ent.id, delivery: 'warehouse', items: [{ product_id: 11, qty: 2 }, { product_id: 13, qty: 1 }] }, A);
assert.deepEqual(await prices(sWh.id), [[11, 8500], [13, 1700]], 'склад — із запам’ятованого');
// менеджер оформлює для партнера «на склад» — ціни «на склад»
const opt = await req('GET', `/api/b2b/partners/${pa.id}/supply-options`);
assert.deepEqual([opt.products.find((x) => x.product_id === 11).price, opt.products.find((x) => x.product_id === 11).price_wh], [9000, 8500]);
const sA = await req('POST', '/api/b2b/orders', { partner_id: pa.id, delivery: 'warehouse', ship_to: ship, items: [{ product_id: 12, qty: 1 }] });
assert.deepEqual(await prices(sA.id), [[12, 4250]]);

// ---------- 4. Менеджер змінює спосіб — пропозиція партнеру; після підтвердження — перерахунок (ручні ціни — без змін) ----------
// sNp: рахунку ще немає; одна позиція з ручною ціною
await req('PUT', `/api/b2b/orders/${sNp.id}/edit`, { items: [{ line: 0, product_id: 11, qty: 2 }, { product_id: 12, qty: 1, price: 4100 }] });
assert.deepEqual(await prices(sNp.id), [[11, 9000], [12, 4100]]);
tg.length = 0;
const pr = await req('POST', `/api/b2b/orders/${sNp.id}/delivery`, { delivery: 'warehouse', ship_to: ship });
assert.equal(pr.pending, true);
d = await get(sNp.id);
assert.equal(d.order.delivery, 'np', 'до підтвердження — як було');
assert.deepEqual([d.order.delivery_req.from, d.order.delivery_req.total_now, d.order.delivery_req.total_new, d.order.delivery_req.kept], ['admin', 22100, 21100, 1]);
assert.ok(tg.some((m) => String(m.chat_id) === '2' && /потрібне ваше підтвердження/.test(m.text) && /22[\s ]100,00 грн → <b>21[\s ]100,00 грн/.test(m.text)), 'партнеру — пропозиція з сумою');
assert.ok(!JSON.stringify(await req('GET', '/api/home')).includes('просять змінити спосіб'), 'у «Потребує дій» менеджера — лише запити партнерів');
const pl = (await req('GET', '/api/b2b/p/orders', null, A)).rows.find((x) => x.id === sNp.id);
assert.equal(pl.delivery_req.from, 'admin', 'у списку партнера видно');
tg.length = 0;
await req('POST', `/api/b2b/p/orders/${sNp.id}/delivery-request/answer`, { ok: true }, A);
d = await get(sNp.id);
assert.equal(d.order.delivery, 'warehouse');
assert.deepEqual(d.items.map((i) => [i.product_id, i.price]), [[11, 8500], [12, 4100]], 'автоціну перераховано, ручну — ні');
assert.equal(d.order.total, 21100);
assert.ok(d.history.some((x) => /запропонував менеджер, підтвердив партнер.*ціни перераховано \(1 поз\.\).*9[\s ]000,00 грн → 8[\s ]500,00 грн.*1 поз\. з окремою ціною — без змін/.test(x.action)));
assert.ok(tg.some((m) => String(m.chat_id) === '1' && /підтвердив спосіб отримання/.test(m.text)), 'менеджеру — підтвердження');

// партнер відхиляє пропозицію — нічого не змінюється
await req('POST', `/api/b2b/orders/${sNp.id}/delivery`, { delivery: 'np' });
tg.length = 0;
await req('POST', `/api/b2b/p/orders/${sNp.id}/delivery-request/answer`, { ok: false, note: 'Нам зручніше <склад>' }, A);
d = await get(sNp.id);
assert.deepEqual([d.order.delivery, d.order.delivery_req, d.order.total], ['warehouse', null, 21100]);
assert.ok(tg.some((m) => String(m.chat_id) === '1' && /відхилив/.test(m.text) && m.text.includes('💬 Нам зручніше &lt;склад&gt;')));
// менеджер відкликає свою пропозицію
await req('POST', `/api/b2b/orders/${sNp.id}/delivery`, { delivery: 'np' });
await req('DELETE', `/api/b2b/orders/${sNp.id}/delivery-request`);
assert.equal((await get(sNp.id)).order.delivery_req, null);

// ---------- 5. Оплачена закупівля з рахунком: запит партнера → менеджер підтверджує → перерахунок, позначка «переробити рахунок» ----------
const sP = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 2 }] }, A);
await req('PUT', `/api/b2b/orders/${sP.id}`, { invoice_no: 'СФ-7', invoice_date: '2026-11-10', waybill_no: 'ВН-7' });
await req('POST', `/api/b2b/orders/${sP.id}/status`, { status: 'paid', note: 'готівка' });
const rq = await req('POST', `/api/b2b/p/orders/${sP.id}/delivery-request`, { delivery: 'warehouse', ship_to: ship }, A);
assert.equal(rq.total_new, 17000);
d = await get(sP.id);
assert.deepEqual([d.order.delivery_req.from, d.order.delivery_req.total_new], ['partner', 17000]);
await req('POST', `/api/b2b/orders/${sP.id}/delivery-request`, { ok: true });
d = await get(sP.id);
assert.deepEqual([d.order.delivery, d.order.total, d.order.status, d.order.reinvoice, d.order.invoice_no], ['warehouse', 17000, 'paid', 'СФ-7 (і накладну № ВН-7)', 'СФ-7'], 'дешевше — оплачено, рахунок переробити');
// назад «клієнтам» — дорожче, ніж оплачено → частково оплачено
await req('POST', `/api/b2b/p/orders/${sP.id}/delivery-request`, { delivery: 'np' }, A);
await req('POST', `/api/b2b/orders/${sP.id}/delivery-request`, { ok: true });
d = await get(sP.id);
assert.deepEqual([d.order.delivery, d.order.total, d.order.status], ['np', 18000, 'paid'], 'оплачено 18 000 — знову повністю');
// спосіб без різниці в ціні (самовивіз) — сума не змінюється, рахунок не чіпаємо
await req('POST', `/api/b2b/orders/${sP.id}/reinvoice-done`);
await req('POST', `/api/b2b/p/orders/${sP.id}/delivery-request`, { delivery: 'pickup', pickup_by: { name: 'Іван Водій', phone: '0675554433' } }, A);
await req('POST', `/api/b2b/orders/${sP.id}/delivery-request`, { ok: true });
d = await get(sP.id);
assert.deepEqual([d.order.delivery, d.order.total, d.order.reinvoice], ['pickup', 18000, ''], 'ціни ті самі — рахунок не переробляти');

// оплачено за ціною «на склад», перейшли на «клієнтам» (дорожче) — частково оплачено, видно доплату
const sQ = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, delivery: 'warehouse', ship_to: ship, items: [{ product_id: 11, qty: 1 }] }, A);
await req('PUT', `/api/b2b/orders/${sQ.id}`, { invoice_no: 'СФ-8', invoice_date: '2026-11-10', waybill_no: '' });
await req('POST', `/api/b2b/orders/${sQ.id}/status`, { status: 'paid', note: 'готівка' });
await req('POST', `/api/b2b/p/orders/${sQ.id}/delivery-request`, { delivery: 'np' }, A);
await req('POST', `/api/b2b/orders/${sQ.id}/delivery-request`, { ok: true });
d = await get(sQ.id);
assert.deepEqual([d.order.total, d.order.paid_amount, d.order.status, d.order.reinvoice], [9000, 8500, 'partial', 'СФ-8']);

// ---------- 6. Самовивіз «як на склад» — один рядок у WH_PRICE ----------
WH_PRICE.add('pickup');
const sPk2 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, delivery: 'pickup', pickup_by: { name: 'Іван Водій', phone: '0675554433' }, items: [{ product_id: 11, qty: 1 }] }, A);
assert.deepEqual(await prices(sPk2.id), [[11, 8500]], 'самовивіз за ціною «на склад»');
WH_PRICE.delete('pickup');

// ---------- 7. Розсилка змін цін: окремо знижка «на склад» і ціна «на ваш склад» ----------
await new Promise((r) => setTimeout(r, 5));
await db.run(`UPDATE b2b_partners SET prices_sent_at = ? WHERE id = ?`, [new Date().toISOString(), pa.id]);
await new Promise((r) => setTimeout(r, 5));
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10, margin_wh: 20 }]);
const pc = (await req('GET', '/api/b2b/price-changes')).find((x) => x.id === pa.id);
const txt = pc.preview.join('\n');
assert.match(txt, /Знижка від РРЦ на закупівлю на ваш склад:[\s\S]*Evoair: 15% → <b>20%<\/b>/);
assert.match(txt, /на ваш склад 8[\s ]500,00 → <b>8[\s ]000,00<\/b> грн/);
const plog = await req('GET', '/api/b2b/p/price-log', null, A);
assert.ok(plog.rows.some((r) => r.kind === 'margin' && r.wh && /на склад партнера/.test(r.brand)), 'журнал цін партнера');

// ---------- 8. Маржа за замовчуванням ----------
assert.deepEqual(await req('GET', '/api/b2b/margin-defaults'), { margin: null, margin_wh: null });
assert.deepEqual(await req('PUT', '/api/b2b/margin-defaults', { margin: '20', margin_wh: '25,5'.replace(',', '.') }), { margin: 20, margin_wh: 25.5 });
assert.deepEqual((await req('GET', `/api/b2b/partners/${pa.id}`)).margin_defaults, { margin: 20, margin_wh: 25.5 });
assert.match(await errOf(() => req('PUT', '/api/b2b/margin-defaults', { margin: 150 })), /від 0 до 99/);
assert.match(await errOf(() => req('PUT', '/api/b2b/margin-defaults', { margin: 10 }, A)), /прав|доступ/i);

console.log('OK — B2B: дві закупівельні ціни (клієнтам / на склад партнера)');
