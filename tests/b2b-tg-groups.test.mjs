// B2B: Telegram-група партнера (прив'язка кодом /link, детальні повідомлення про закупівлю, рахунок файлом у групу,
// переїзд групи в супергрупу, бота прибрали) і видалення замовлень.
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
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901)`, []],
]);
const msgs = []; // sendMessage
const docs = []; // sendDocument
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) {
    if (url.endsWith('/sendDocument')) {
      const fd = opts.body;
      const file = fd.get('document');
      docs.push({ chat_id: fd.get('chat_id'), caption: fd.get('caption'), name: file.name, size: file.size });
    } else msgs.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, price: { 11: '1000.00', 12: '500.00' }[id] })) }));
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
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };
const hook = (message) => mk().request('/api/tg/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'sec' }, body: JSON.stringify({ message }) });
const group = (id, text, extra = {}) => ({ chat: { id, type: 'group', title: 'Ековент × Партнер А' }, text, ...extra });

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
const A = await login('pa', 'pass1234');
const ea = await req('POST', '/api/b2b/p/entities', { kind: 'tov', name: 'ТОВ «Альфа»', code: '45123456', address: 'Київ, вул. Тестова 1', vat: true }, A);

// ---------- 1. Прив'язка групи ----------
const { code, bot } = await req('POST', `/api/b2b/partners/${pa.id}/tg-group`);
assert.equal(bot, 'ecobot');
assert.match(code, /^[0-9a-f]{12}$/);
await hook(group(-100, 'привіт усім')); // звичайні повідомлення — ігнор
assert.equal(msgs.length, 0);
await hook(group(-100, '/link 000000000000'));
assert.match(msgs.pop().text, /Код не підійшов/);
await hook(group(-100, `/link@ecobot ${code}`));
assert.match(msgs.pop().text, /Групу прив'язано до партнера <b>Партнер А<\/b>/);
let det = await req('GET', `/api/b2b/partners/${pa.id}`);
assert.equal(det.partner.tg_group, '-100');
assert.equal(det.partner.tg_group_title, 'Ековент × Партнер А');
await hook(group(-100, `/link ${code}`));
assert.match(msgs.pop().text, /Код не підійшов/, 'код одноразовий');
// група стала супергрупою — новий id
await hook(group(-100, '', { migrate_to_chat_id: -100777 }));
assert.equal((await req('GET', `/api/b2b/partners/${pa.id}`)).partner.tg_group, '-100777');

// ---------- 2. Нова закупівля — детально адмінам і в групу ----------
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
msgs.length = 0;
const o = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 1 }], comment: 'Терміново' }, A);
const toGroup = msgs.find((m) => m.chat_id === '-100777');
const toAdmin = msgs.find((m) => m.chat_id === '1');
assert.ok(toGroup && toAdmin);
assert.match(toGroup.text, /Нова закупівля <b>B2B-\d+<\/b> від «Партнер А»/);
assert.match(toGroup.text, /Рахунок і накладна на:<\/b>\nТОВ «Альфа», ЄДРПОУ 45123456, платник ПДВ\nКиїв, вул\. Тестова 1/);
assert.match(toGroup.text, /Товари:<\/b>\nТовар 11 — 2 шт — 900,00 грн\nТовар 12 — 1 шт — 450,00 грн/);
assert.match(toGroup.text, /Разом: 2[\s ]250,00 грн/);
assert.match(toGroup.text, /Коментар: Терміново/);
assert.doesNotMatch(toGroup.text, /#\/b2borders/, 'у групі без посилання на адмінку');
assert.match(toAdmin.text, /#\/b2borders\/\d+/);

// ---------- 3. Рахунок — номером і файлом у групу ----------
msgs.length = 0;
await req('PUT', `/api/b2b/orders/${o.id}`, { invoice_no: 'СФ-7' });
assert.ok(!msgs.some((m) => m.chat_id === '-100777'), 'номер рахунку текстом — не в групу (туди йде файл)');
const up = await mk().request(`/api/b2b/orders/${o.id}/files?kind=invoice`, { method: 'POST', headers: { Cookie: H.Cookie, 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('Рахунок СФ-7.pdf') }, body: new Uint8Array(2048) });
const uj = await up.json();
assert.equal(uj.toGroup, true);
assert.equal(docs.length, 1);
assert.deepEqual([docs[0].chat_id, docs[0].name, docs[0].size], ['-100777', 'Рахунок СФ-7.pdf', 2048]);
assert.match(docs[0].caption, /Рахунок № СФ-7 — закупівля <b>B2B-\d+<\/b>/);
// маркування / інше — у групу не дублюється
await mk().request(`/api/b2b/orders/${o.id}/files?kind=other`, { method: 'POST', headers: { Cookie: H.Cookie, 'X-File-Name': 'x.txt' }, body: new Uint8Array(5) });
assert.equal(docs.length, 1);
msgs.length = 0;
await req('POST', `/api/b2b/orders/${o.id}/status`, { status: 'paid' });
assert.ok(!msgs.some((m) => m.chat_id === '-100777'), 'оплата — не в групу (лише особисто)');

// ---------- 4. Видалення замовлень ----------
const cl = await req('POST', '/api/b2b/p/clients', { client_name: 'Клієнт', client_phone: '0501112233', supply_id: o.id, items: [{ product_id: 11, qty: 1 }] }, A);
assert.match((await mk().request(`/api/b2b/orders/${o.id}`, { method: 'DELETE', headers: H }).then((r) => r.json())).error, /спершу видаліть/);
assert.equal(await status(() => req('DELETE', `/api/b2b/orders/${cl.id}`, null, A)), 403, 'партнер не видаляє');
await req('DELETE', `/api/b2b/orders/${cl.id}`);
await req('DELETE', `/api/b2b/orders/${o.id}`);
for (const t of ['b2b_orders', 'b2b_order_items', 'b2b_order_log', 'b2b_files', 'b2b_file_parts']) {
  assert.equal((await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n, 0, `${t} порожня`);
}
assert.ok((await db.get(`SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'видалено закупівлю%'`)).n === 1, 'видалення — у журналі змін');

// ---------- 4а. Усі замовлення закупівлі в роботі (у CRM з номерами) — один підсумок у групу ----------
const o2 = await req('POST', '/api/b2b/p/orders', { entity_id: ea.id, items: [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 1 }] }, A);
msgs.length = 0;
const k1 = await req('POST', '/api/b2b/p/clients', { client_name: 'Іваненко Петро', client_phone: '0501112233', supply_id: o2.id, items: [{ product_id: 11, qty: 2 }] }, A);
const k2 = await req('POST', '/api/b2b/p/clients', { client_name: 'Сидоренко Анна', client_phone: '0501112244', supply_id: o2.id, items: [{ product_id: 12, qty: 1 }] }, A);
assert.ok(!msgs.some((m) => m.chat_id === '-100777'), 'замовлення клієнтів — не в групу');
await req('PUT', `/api/b2b/clients/${k1.id}`, { crm_id: '501' });
assert.ok(!msgs.some((m) => m.chat_id === '-100777'), 'ще не всі в роботі');
await req('PUT', `/api/b2b/clients/${k2.id}`, { crm_id: '502' });
const done = msgs.filter((m) => m.chat_id === '-100777');
assert.equal(done.length, 1);
assert.match(done[0].text, new RegExp(`Закупівля B2B-${o2.id}: усі замовлення взято в роботу складом.*CRM № <b>501</b> · Іваненко Петро — Товар 11 × 2.*CRM № <b>502</b> · Сидоренко Анна — Товар 12 × 1`, 's'));
await req('PUT', `/api/b2b/clients/${k2.id}`, { crm_id: '503' });
assert.equal(msgs.filter((m) => m.chat_id === '-100777').length, 1, 'лише раз');

// ---------- 5. Бота прибрали з групи — відв'язується ----------
await hook({ chat: { id: -100777, type: 'supergroup' }, left_chat_member: { is_bot: true, username: 'ecobot' } });
det = await req('GET', `/api/b2b/partners/${pa.id}`);
assert.equal(det.partner.tg_group, '');

console.log('OK — B2B: Telegram-група партнера (прив’язка, детальні повідомлення, файли) і видалення замовлень');
