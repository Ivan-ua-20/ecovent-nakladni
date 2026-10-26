// Оголошення партнерам: довільний текст у Telegram-групу партнера та/або особисто користувачам у бот.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.batch([['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_hook_v', '2']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]));
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const errOf = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('POST', `/api/b2b/partners/${pb.id}/users`, { login: 'pb', password: 'pass1234' });
await db.run(`UPDATE users SET tg_chat_id = '21' WHERE login = 'pa'`);
await db.run(`UPDATE b2b_partners SET tg_group = '-100', tg_group_title = 'Група А' WHERE id = ?`, [pa.id]);

const t = await req('GET', '/api/b2b/announce/targets');
assert.deepEqual(t.map((r) => [r.name, r.group, r.tgUsers]), [['Партнер А', 'Група А', 1], ['Партнер Б', '', 0]]);

const text = 'З 1 листопада знижка 5% на <Evoair> & ін.';
let r = await req('POST', '/api/b2b/announce', { partner_id: pa.id, text, groups: true, users: false });
assert.deepEqual([r.group, r.users], [1, 0]);
assert.deepEqual(tg.map((m) => String(m.chat_id)), ['-100']);
assert.equal(tg[0].text, '📢 З 1 листопада знижка 5% на &lt;Evoair&gt; &amp; ін.', 'текст екранується');
tg.length = 0;
r = await req('POST', '/api/b2b/announce', { partner_id: pa.id, text, groups: true, users: true });
assert.deepEqual([r.group, r.users], [1, 1]);
assert.deepEqual(tg.map((m) => String(m.chat_id)).sort(), ['-100', '21']);
tg.length = 0;
r = await req('POST', '/api/b2b/announce', { partner_id: pb.id, text, groups: true, users: true });
assert.deepEqual([r.group, r.users, tg.length], [0, 0, 0], 'немає ні групи, ні бота');

assert.match(await errOf(() => req('POST', '/api/b2b/announce', { partner_id: pa.id, text: '  ', groups: true })), /текст/);
assert.match(await errOf(() => req('POST', '/api/b2b/announce', { partner_id: pa.id, text, groups: false, users: false })), /куди/);
assert.match(await errOf(() => req('POST', '/api/b2b/announce', { partner_id: pa.id, text: 'x'.repeat(3501), groups: true })), /задовгий/);
// партнер не може розсилати
const lr = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'pa', password: 'pass1234' }) });
const A = { 'Content-Type': 'application/json', Cookie: lr.headers.get('set-cookie').split(';')[0] };
assert.ok(await errOf(() => req('POST', '/api/b2b/announce', { partner_id: pa.id, text, groups: true }, A)));
assert.ok(await errOf(() => req('GET', '/api/b2b/announce/targets', null, A)));

console.log('b2b-announce: ok');
