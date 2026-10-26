// B2B: «Надіслати зміни цін» (вручну) — у Telegram-групу партнера або його користувачам; каталог партнера з категоріями
// і знижкою від РРЦ.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, []],
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98), (902, 'Levoit', 'levoit', 99)`, []],
  [`INSERT INTO an_categories (id, name) VALUES (5, 'Зволожувачі'), (6, 'Очищувачі')`, []],
  [`INSERT INTO an_products (product_id, name, brand_id, category_id) VALUES (11, 'Umiva', 901, 5), (12, 'Luno', 901, 5), (13, 'Briis', 901, 6), (21, 'Core', 902, 6)`, []],
]);
const PRICES = { 11: '1000.00', 12: '2000.00', 13: '3000.00', 21: '500.00' };
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: {} })); }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: `Товар ${id}`, vendor: `ART${id}`, price: PRICES[id] })) }));
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
const resync = async () => { await db.run(`UPDATE b2b_catalog SET checked_at = ''`); await req('POST', '/api/b2b/catalog/sync'); };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('POST', `/api/b2b/partners/${pb.id}/users`, { login: 'pb', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 20 }, { brand_id: 902, margin: 10 }]);
await req('PUT', `/api/b2b/partners/${pb.id}/margins`, [{ brand_id: 902, margin: 15 }]);
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE b2b_partners SET tg_group = '-500', tg_group_title = 'Група А' WHERE id = ?`, [pa.id]);
await db.run(`UPDATE users SET tg_chat_id = '700' WHERE login = 'pb'`);
const A = await login('pa', 'pass1234');

// ---------- 1. Каталог партнера: категорії, знижка ----------
const cat = await req('GET', '/api/b2b/p/catalog', null, A);
assert.deepEqual(cat.brands.map((b) => [b.name, b.margin]), [['Evoair', 20], ['Levoit', 10]]);
assert.deepEqual(cat.categories.map((c) => [c.name, c.n]), [['Зволожувачі', 2], ['Очищувачі', 2]]);
const umiva = cat.products.find((p) => p.id === 11);
assert.deepEqual([umiva.cat, umiva.margin, umiva.price], [5, 20, 800]);

// ---------- 2. Перша розсилка: «нові бренди» ----------
let pv = await req('GET', '/api/b2b/price-changes');
const pA = pv.find((r) => r.id === pa.id);
assert.equal(pA.empty, false);
assert.equal(pA.group, 'Група А');
assert.match(pA.preview[0], /Нові бренди для вас:.*Evoair — знижка 20% від РРЦ/s);
assert.equal(await status(() => req('GET', '/api/b2b/price-changes', null, A)), 403, 'партнер не надсилає');
let r = await req('POST', '/api/b2b/price-changes/send', {});
assert.equal(r.results.length, 2);
assert.ok(tg.some((m) => m.chat_id === '-500' && /Зміна цін.*Партнер А/s.test(m.text)), 'у групу партнера А');
assert.ok(tg.some((m) => m.chat_id === '700' && /Партнер Б/.test(m.text)), 'Б без групи — особисто');
pv = await req('GET', '/api/b2b/price-changes');
assert.ok(pv.every((x) => x.empty), 'після розсилки — змін немає');
tg.length = 0;
r = await req('POST', '/api/b2b/price-changes/send', {});
assert.equal(r.results.length, 0, 'без змін нічого не надсилається');
assert.equal(tg.length, 0);

// ---------- 3. Зміна РРЦ і знижки ----------
await new Promise((ok) => setTimeout(ok, 5));
PRICES[11] = '1100.00'; // Evoair: А бачить
PRICES[21] = '450.00'; // Levoit: і А, і Б
await resync();
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 25 }, { brand_id: 902, margin: 10 }]);
pv = await req('GET', '/api/b2b/price-changes');
const a2 = pv.find((x) => x.id === pa.id);
const b2 = pv.find((x) => x.id === pb.id);
// А: Evoair знижка 20→25 — усі 3 товари Evoair + Levoit Core (РРЦ)
assert.equal(a2.products, 4);
assert.equal(b2.products, 1);
const text = a2.preview.join('\n');
assert.match(text, /Ваша знижка від РРЦ:.*Evoair: 20% → <b>25%<\/b>/s);
assert.match(text, /Товар 11 \(ART11\)\n {3}РРЦ 1[\s ]000,00 → <b>1[\s ]100,00<\/b> ▲ · ваша ціна 800,00 → <b>825,00<\/b> грн ▲/);
assert.match(text, /Товар 12 \(ART12\)\n {3}РРЦ 2[\s ]000,00 → <b>2[\s ]000,00<\/b>  · ваша ціна 1[\s ]600,00 → <b>1[\s ]500,00<\/b> грн ▼/);
assert.match(text, /Товар 21.*РРЦ 500,00 → <b>450,00<\/b> ▼ · ваша ціна 450,00 → <b>405,00<\/b>/s);
assert.match(b2.preview[0], /Товар 21.*ваша ціна 425,00 → <b>382,50<\/b>/s);
// лише обраному партнеру
tg.length = 0;
r = await req('POST', '/api/b2b/price-changes/send', { partner_ids: [pb.id] });
assert.deepEqual(r.results.map((x) => x.id), [pb.id]);
assert.ok(tg.every((m) => m.chat_id === '700'));
pv = await req('GET', '/api/b2b/price-changes');
assert.equal(pv.find((x) => x.id === pa.id).products, 4, 'А ще не надіслано — зміни лишились');
assert.equal(pv.find((x) => x.id === pb.id).empty, true);

// ---------- 4. Нікому надсилати — не позначається як надіслане ----------
await db.run(`UPDATE b2b_partners SET tg_group = '' WHERE id = ?`, [pa.id]);
r = await req('POST', '/api/b2b/price-changes/send', { partner_ids: [pa.id] });
assert.equal(r.results[0].sent, false);
assert.equal((await req('GET', '/api/b2b/price-changes')).find((x) => x.id === pa.id).empty, false);

// ---------- Повторне «Оновити з LP-CRM» того ж дня підтягує нові РРЦ ----------
const before = (await req('GET', '/api/b2b/p/catalog', null, A)).products.find((p) => p.id === 11).rrp;
PRICES[11] = '1111.00';
await req('POST', '/api/b2b/catalog/sync');
assert.equal((await req('GET', '/api/b2b/p/catalog', null, A)).products.find((p) => p.id === 11).rrp, before, 'без run — товар уже перевірено сьогодні');
const sr = await req('POST', '/api/b2b/catalog/sync', { run: new Date().toISOString() });
assert.ok(sr.changed >= 1, 'зміну РРЦ записано для розсилки');
assert.equal(sr.left, 0);
const u2 = (await req('GET', '/api/b2b/p/catalog', null, A)).products.find((p) => p.id === 11);
assert.equal(u2.rrp, 1111);
assert.ok(u2.price > 0 && u2.price < 1111, 'ціна партнера перерахована від нової РРЦ');
assert.equal((await req('POST', '/api/b2b/catalog/sync', { run: new Date(Date.now() - 1000).toISOString() })).checked, 0, 'той самий запуск — без повторів');

console.log('OK — B2B: розсилка змін цін і каталог партнера з категоріями та знижкою');
