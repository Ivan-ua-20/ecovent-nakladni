// B2B для адмінів: відповідальний менеджер, нотатки й нагадування, автопауза при простроченні оплати.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const shared = {};
const app = createApp({ db, fetchFn, shared });
const setup = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Власник' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body) => {
  const r = await app.request(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw new Error(j.error || r.status);
  return j;
};
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };
// Чистка (з автопаузою) — раз на годину; у тесті запускаємо її наступним запитом.
const runHourly = async () => { shared.lastCleanup = 0; await db.run(`DELETE FROM settings WHERE key = 'cleanup_at'`); await req('GET', '/api/b2b/partners'); };
await db.run(`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x'), ('tg_bot', 'bot') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);

const p = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
const me = (await req('GET', '/api/auth/state')).user;

// ---------- 1. Менеджер ----------
const mgrs = await req('GET', '/api/b2b/managers');
assert.ok(mgrs.some((m) => m.id === me.id));
await req('PUT', `/api/b2b/partners/${p.id}/manager`, { manager_id: me.id });
assert.equal((await req('GET', '/api/b2b/partners')).find((x) => x.id === p.id).manager_id, me.id);
assert.match(await errOf(() => req('PUT', `/api/b2b/partners/${p.id}/manager`, { manager_id: 999 })), /немає/);

// ---------- 2. Нотатки й нагадування ----------
assert.match(await errOf(() => req('POST', `/api/b2b/partners/${p.id}/notes`, { text: ' ' })), /текст/);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
const n1 = await req('POST', `/api/b2b/partners/${p.id}/notes`, { text: 'Передзвонити щодо нової закупівлі', remind_at: today });
await req('POST', `/api/b2b/partners/${p.id}/notes`, { text: 'Домовились про відстрочку 14 днів' });
let notes = await req('GET', `/api/b2b/partners/${p.id}/notes`);
assert.equal(notes.length, 2);
assert.equal(notes[0].id, n1.id, 'з нагадуванням — першою');
let home = await req('GET', '/api/home');
assert.ok(home.items.some((x) => x.key === 'b2b_notes' && x.count === 1), 'нагадування — у черзі');
await req('PUT', `/api/b2b/notes/${n1.id}`, { done: true });
home = await req('GET', '/api/home');
assert.ok(!home.items.some((x) => x.key === 'b2b_notes'), 'виконане — зникло з черги');
await req('DELETE', `/api/b2b/notes/${n1.id}`);
assert.equal((await req('GET', `/api/b2b/partners/${p.id}/notes`)).length, 1);

// ---------- 3. Автопауза ----------
const addDay = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const o = await db.run(`INSERT INTO b2b_orders (partner_id, kind, status, total, paid_amount, invoice_no, due_date, created_at) VALUES (?, 'supply', 'pay_wait', 1000, 0, '7', ?, ?)`,
  [p.id, addDay(-10), new Date().toISOString()]);
await runHourly(); // автопаузу ще не ввімкнено
assert.equal((await db.get(`SELECT paused FROM b2b_partners WHERE id = ?`, [p.id])).paused, 0);
assert.deepEqual(await req('PUT', '/api/b2b/autopause', { days: 7 }), { days: 7 });
tg.length = 0;
await runHourly();
let row = await db.get(`SELECT paused, paused_auto, pause_note FROM b2b_partners WHERE id = ?`, [p.id]);
assert.deepEqual([row.paused, row.paused_auto], [1, 1], 'прострочка 10 дн. > 7 — пауза');
assert.match(row.pause_note, /понад 7 дн/);
assert.ok(tg.some((m) => /автопаузу/.test(m.text)), 'адмінам повідомлено');
// оплатили — пауза знімається сама
await db.run(`UPDATE b2b_orders SET status = 'paid', paid_amount = total WHERE id = ?`, [o.lastId]);
await runHourly();
row = await db.get(`SELECT paused, paused_auto FROM b2b_partners WHERE id = ?`, [p.id]);
assert.deepEqual([row.paused, row.paused_auto], [0, 0], 'оплачено — пауза знята');
// знята вручну пауза: автопауза 7 днів не ставить знову
await db.run(`UPDATE b2b_orders SET status = 'pay_wait', paid_amount = 0 WHERE id = ?`, [o.lastId]);
await runHourly();
assert.equal((await db.get(`SELECT paused FROM b2b_partners WHERE id = ?`, [p.id])).paused, 1);
await req('PUT', `/api/b2b/partners/${p.id}`, { paused: false });
await runHourly();
assert.equal((await db.get(`SELECT paused FROM b2b_partners WHERE id = ?`, [p.id])).paused, 0, 'знято вручну — не ставиться знову');
// ручну паузу автопауза не знімає
await req('PUT', `/api/b2b/partners/${p.id}`, { paused: true, pause_note: 'перевірка' });
await db.run(`UPDATE b2b_orders SET status = 'paid', paid_amount = total WHERE id = ?`, [o.lastId]);
await runHourly();
assert.equal((await db.get(`SELECT paused FROM b2b_partners WHERE id = ?`, [p.id])).paused, 1, 'ручна пауза лишається');

// ---------- 4. Пошук по сайту ----------
assert.deepEqual((await req('GET', '/api/search?q=a')).items, [], 'надто короткий запит');
let found = (await req('GET', `/api/search?q=B2B-${o.lastId}`)).items;
assert.ok(found.some((x) => x.link === `#/b2borders/${o.lastId}`), 'закупівля за номером');
found = (await req('GET', '/api/search?q=партнер а')).items;
assert.ok(found.some((x) => x.link === `#/b2bpartners/${p.id}`), 'партнер за назвою, без регістру (кирилиця)');
await db.run(`INSERT INTO rzs_accounts (name, token, active) VALUES ('R', 'x', 1)`);
await db.run(`INSERT INTO rzs_orders (id, account_id, order_num, status, customer, phone, ttn, created_at) VALUES ('rz1', 1, 'РО123456789', 'new', 'Петренко Олена', '0671112233', '20450001112223', ?)`, [new Date().toISOString()]);
found = (await req('GET', '/api/search?q=0671112233')).items;
assert.ok(found.some((x) => x.group === 'Розетка' && /РО123456789/.test(x.title)), 'Розетка за телефоном');
found = (await req('GET', '/api/search?q=петренко')).items;
assert.ok(found.some((x) => x.group === 'Розетка'), 'Розетка за клієнтом');

console.log('OK — B2B: менеджер, нотатки, автопауза; пошук по сайту');
