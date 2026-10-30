// Новинки каталогу: нічого не надсилається само — адмін переглядає, надсилає партнерам (кожному — його бренди
// з його ціною) або відмічає без розсилки; партнер бачить «Новинка» лише після цього.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { schema as b2bSchema } from '../src/modules/b2b/schema.js';

const db = openDb(':memory:');
await migrate(db);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const app = createApp({ db, fetchFn });
const setup = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await app.request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw new Error(j.error || r.status);
  return j;
};
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };
await db.run(`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x'), ('tg_bot', 'bot') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

// ---------- 1. Перший запуск: те, що вже мало РРЦ, — не новинка ----------
await db.run(`INSERT INTO b2b_catalog (product_id, name, rrp, brand_id) VALUES (500, 'Старий товар', 500, 7)`);
await db.run(`DELETE FROM settings WHERE key = 'b2b_newprod_init'`);
await b2bSchema.seed(db, { fresh: false });
assert.equal((await db.get(`SELECT first_priced_at FROM b2b_catalog WHERE product_id = 500`)).first_priced_at, 'до новинок');
await db.run(`INSERT INTO b2b_catalog (product_id, name, rrp, brand_id) VALUES (510, 'Ще без ціни', 0, 7)`);
await b2bSchema.seed(db, { fresh: false }); // повторна міграція не чіпає нові товари
assert.equal((await db.get(`SELECT first_priced_at FROM b2b_catalog WHERE product_id = 510`)).first_priced_at, '');

// ---------- 2. Новинки й партнери ----------
const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await db.run(`INSERT INTO b2b_margins (partner_id, brand_id, margin) VALUES (?, 7, 10), (?, 8, 20)`, [pa.id, pb.id]);
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await db.run(`UPDATE users SET tg_chat_id = '700' WHERE login = 'pa'`);
const now = new Date().toISOString();
await db.run(`INSERT INTO b2b_catalog (product_id, name, article, rrp, brand_id, first_priced_at) VALUES (501, 'Осушувач OptiDry 20', 'OPTIDRY20', 1000, 7, ?), (502, 'Очищувач Core 600', '', 2000, 8, ?), (503, 'Чужий бренд', '', 300, 9, ?)`, [now, now, now]);

const list = await req('GET', '/api/b2b/new-products');
assert.deepEqual(list.items.map((x) => x.product_id).sort(), [501, 502], 'лише з брендами партнерів; старий — ні');
assert.deepEqual(list.partners.map((p) => [p.name, p.brands]), [['Партнер А', [7]], ['Партнер Б', [8]]]);
const home = await req('GET', '/api/home');
assert.ok(home.items.some((x) => x.key === 'b2b_newprod' && x.count === 2), 'у «Потребує дій»');
assert.ok(!tg.some((m) => /Нові товари/.test(m.text)), 'нічого не надіслано автоматично');

// ---------- 3. Розсилка лише на запит ----------
assert.match(await errOf(() => req('POST', '/api/b2b/new-products/send', { partner_id: pa.id, product_ids: [] })), /Оберіть/);
const r = await req('POST', '/api/b2b/new-products/send', { partner_id: pa.id, product_ids: [501, 502] });
assert.deepEqual([r.products, r.sent > 0, r.where], [1, true, 'users'], 'А отримує лише свій бренд');
const msg = tg.find((m) => /Нові товари/.test(m.text));
assert.ok(msg && String(msg.chat_id) === '700');
assert.match(msg.text, /OptiDry 20 \(OPTIDRY20\)/);
assert.match(msg.text, /ваша ціна <b>900,00<\/b>/, 'ціна партнера: РРЦ − 10 %');
assert.ok(!/Core 600/.test(msg.text), 'чужий бренд не потрапив');

// ---------- 4. Позначити — зникає зі списку, у партнера «Новинка» ----------
const pl = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'pa', password: 'pass1234' }) });
const PA = { 'Content-Type': 'application/json', Cookie: pl.headers.get('set-cookie').split(';')[0] };
let cat = await req('GET', '/api/b2b/p/catalog', null, PA);
assert.equal(cat.products.find((x) => x.id === 501).is_new, false, 'до позначки — не новинка');
assert.deepEqual(await req('POST', '/api/b2b/new-products/mark', { product_ids: [501, 502] }), { marked: 2 });
assert.equal((await req('GET', '/api/b2b/new-products')).items.length, 0);
assert.ok(!(await req('GET', '/api/home')).items.some((x) => x.key === 'b2b_newprod'));
cat = await req('GET', '/api/b2b/p/catalog', null, PA);
assert.equal(cat.products.find((x) => x.id === 501).is_new, true);
assert.equal(cat.products.find((x) => x.id === 500).is_new, false, 'старий товар — без позначки');
assert.match(await errOf(() => req('GET', '/api/b2b/new-products', null, PA)), /.+/, 'партнерові — ні');

console.log('OK — B2B: новинки каталогу (лише вручну, свої бренди, позначка «Новинка»)');
