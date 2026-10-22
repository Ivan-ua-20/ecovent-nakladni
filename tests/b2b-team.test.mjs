// B2B: команда партнера (ролі керівник / менеджер / перегляд, керівник сам додає колег, адмін бачить хто кого додав)
// і видалення партнера (без замовлень — повністю, із замовленнями — в архів).
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.run(`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: {} })); }
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  if (r.status !== 200) return null;
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Власник' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };
await db.run(`UPDATE users SET tg_chat_id = '100' WHERE login = 'owner'`);

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'boss', name: 'Бос', password: 'pass1234' });
const BOSS = await login('boss', 'pass1234');
let me = (await req('GET', '/api/bootstrap', null, BOSS)).user;
assert.equal(me.partner_role, 'head', 'перший користувач від адміна — керівник');
assert.ok(me.perms.includes('b2b.team') && me.perms.includes('b2b.order'));

// ---------- 1. Керівник додає колег ----------
tg.length = 0;
const st = await req('POST', '/api/b2b/p/team', { login: 'olena', name: 'Олена', password: 'pass1234', partner_role: 'staff' }, BOSS);
await req('POST', '/api/b2b/p/team', { login: 'viewer1', password: 'pass1234', partner_role: 'viewer' }, BOSS);
assert.equal(await status(() => req('POST', '/api/b2b/p/team', { login: 'owner', password: 'pass1234' }, BOSS)), 400, 'зайнятий логін');
assert.ok(tg.some((m) => m.chat_id === '100' && /Партнер А.*додав користувача.*olena/s.test(m.text)), 'адмінам — сповіщення');
let team = await req('GET', '/api/b2b/p/team', null, BOSS);
assert.equal(team.users.length, 3);
assert.equal(team.users.find((u) => u.login === 'olena').partner_role, 'staff');

// адмін бачить, скільки й кого додав партнер
const list = await req('GET', '/api/b2b/partners');
assert.equal(list[0].users, 3);
assert.equal(list[0].users_by_partner, 2);
const det = await req('GET', `/api/b2b/partners/${pa.id}`);
const ol = det.users.find((u) => u.login === 'olena');
assert.equal(ol.added_by_partner, true);
assert.equal(ol.added_by_name, 'Бос');
assert.equal(det.users.find((u) => u.login === 'boss').added_by_partner, false);
assert.ok((await db.all(`SELECT * FROM audit_log WHERE kind = 'b2b' AND action LIKE '%додав партнер%'`)).length >= 2, 'у журналі змін');

// ---------- 2. Ролі ----------
const OL = await login('olena', 'pass1234');
const VW = await login('viewer1', 'pass1234');
assert.equal(await status(() => req('GET', '/api/b2b/p/team', null, OL)), 403, 'менеджер не керує командою');
assert.equal(await status(() => req('POST', '/api/b2b/p/team', { login: 'x1', password: 'pass1234' }, OL)), 403);
await req('POST', '/api/b2b/p/entities', { name: 'ФОП О', code: '1234567890' }, OL);
assert.equal((await req('GET', '/api/b2b/p/entities', null, VW)).length, 1, 'перегляд — бачить');
assert.equal(await status(() => req('POST', '/api/b2b/p/entities', { name: 'ФОП В', code: '1234567891' }, VW)), 403, 'перегляд — не змінює');
assert.equal(await status(() => req('POST', '/api/b2b/p/orders', { items: [] }, VW)), 403);
assert.equal(await status(() => req('POST', '/api/b2b/p/clients', { items: [] }, VW)), 403);
assert.ok(!(await req('GET', '/api/bootstrap', null, VW)).user.perms.includes('b2b.order'));
// партнер не бачить чужих і не має доступу до адмінки
assert.equal(await status(() => req('GET', `/api/b2b/partners/${pa.id}`, null, BOSS)), 403);

// ---------- 3. Обмеження керівника ----------
const bossId = team.users.find((u) => u.login === 'boss').id;
assert.equal(await status(() => req('PUT', `/api/b2b/p/team/${bossId}`, { partner_role: 'staff' }, BOSS)), 400, 'себе не понижує');
assert.equal(await status(() => req('PUT', `/api/b2b/p/team/${bossId}`, { active: false }, BOSS)), 400, 'себе не вимикає');
await req('PUT', `/api/b2b/p/team/${bossId}`, { name: 'Бос Новий' }, BOSS);
// останнього керівника не можна понизити навіть адміну
assert.equal(await status(() => req('PUT', `/api/b2b/partners/${pa.id}/users/${bossId}`, { partner_role: 'staff' })), 400, 'має лишитися керівник');
// підвищити Олену, тоді можна
await req('PUT', `/api/b2b/p/team/${st.id}`, { partner_role: 'head' }, BOSS);
assert.ok((await req('GET', '/api/bootstrap', null, OL)).user.perms.includes('b2b.team'), 'нова роль діє одразу');
await req('PUT', `/api/b2b/p/team/${bossId}`, { active: false }, OL);
assert.equal(await status(() => req('GET', '/api/b2b/p/team', null, BOSS)), 401, 'вимкнений — сесію закрито');
assert.equal(await login('boss', 'pass1234'), null);
// чужий партнер не змінює чужу команду
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pb.id}/users`, { login: 'bboss', password: 'pass1234' });
const BB = await login('bboss', 'pass1234');
assert.equal(await status(() => req('PUT', `/api/b2b/p/team/${st.id}`, { active: false }, BB)), 404);

// ---------- 4. Видалення партнера ----------
// без замовлень — повністю
await req('DELETE', `/api/b2b/partners/${pb.id}`);
assert.equal(await db.get(`SELECT id FROM b2b_partners WHERE id = ?`, [pb.id]), undefined);
assert.equal(await db.get(`SELECT id FROM users WHERE login = 'bboss'`), undefined, 'користувачі видалені, логін вільний');
assert.equal(await status(() => req('GET', '/api/b2b/p/team', null, BB)), 401);
// із замовленнями — в архів
await db.run(`INSERT INTO b2b_orders (partner_id, kind, status, total, created_at) VALUES (?, 'supply', 'invoice_wait', 100, '2026-10-22T10:00:00Z')`, [pa.id]);
const r = await req('DELETE', `/api/b2b/partners/${pa.id}`);
assert.equal(r.archived, true);
assert.equal((await req('GET', '/api/b2b/partners')).length, 0, 'зник зі списку');
assert.equal(await status(() => req('GET', `/api/b2b/partners/${pa.id}`)), 404);
assert.equal((await req('GET', '/api/b2b/orders')).rows[0].partner, 'Партнер А', 'замовлення лишилися з назвою партнера');
assert.equal((await db.get(`SELECT COUNT(*) AS n FROM users WHERE partner_id = ?`, [pa.id])).n, 0);
assert.equal(await status(() => req('GET', '/api/b2b/p/catalog', null, OL)), 401);
assert.equal(await status(() => req('DELETE', `/api/b2b/partners/${pa.id}`, null, VW)), 401);

console.log('OK — B2B: команда партнера (ролі, хто кого додав) і видалення партнера');
