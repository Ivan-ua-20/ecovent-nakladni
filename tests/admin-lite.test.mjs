// Роль «Адміністратор (без керування людьми)»: усе як в адміністратора, але не додає, не змінює й не видаляє людей
// (користувачів сайту й партнерів, самих партнерів не видаляє) і не вмикає собі аналітику.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const mk = () => createApp({ db, fetchFn: async () => new Response(JSON.stringify({ status: 'ok', data: [] })) });
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

const { id } = await req('POST', '/api/users', { login: 'lite', password: 'pass1234', role: 'admin_lite', name: 'Лайт' });
await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' });
const L = await login('lite', 'pass1234');
const me = (await req('GET', '/api/bootstrap', null, L)).user;
assert.equal(me.role_name, 'Адміністратор (без керування людьми)');
for (const p of ['docs.edit', 'refs.edit', 'requisites', 'api', 'users', 'b2b.admin', 'an.view']) assert.ok(me.perms.includes(p), p);
assert.ok(!me.perms.includes('people'));

// люди — ні
const man = await db.get(`SELECT id FROM users WHERE login = 'man'`);
assert.equal(await status(() => req('GET', '/api/users', null, L)), 403);
assert.equal(await status(() => req('POST', '/api/users', { login: 'x1', password: 'pass1234', role: 'manager' }, L)), 403);
assert.equal(await status(() => req('PUT', `/api/users/${man.id}`, { role: 'admin' }, L)), 403);
assert.equal(await status(() => req('DELETE', `/api/users/${man.id}`, null, L)), 403);
assert.equal(await status(() => req('PUT', `/api/users/${id}`, { analytics: true }, L)), 403, 'аналітику собі не вмикає');
// B2B: партнери, бренди — так; користувачі партнерів і видалення партнера — ні
const p = await req('POST', '/api/b2b/partners', { name: 'Партнер' }, L);
await req('PUT', `/api/b2b/partners/${p.id}/margins`, [], L);
assert.equal(await status(() => req('POST', `/api/b2b/partners/${p.id}/users`, { login: 'pp', password: 'pass1234' }, L)), 403);
await req('POST', `/api/b2b/partners/${p.id}/users`, { login: 'pp', password: 'pass1234' });
const pu = await db.get(`SELECT id FROM users WHERE login = 'pp'`);
assert.equal(await status(() => req('PUT', `/api/b2b/partners/${p.id}/users/${pu.id}`, { active: false }, L)), 403);
assert.equal(await status(() => req('DELETE', `/api/b2b/partners/${p.id}`, null, L)), 403);
// інші адмінські розділи — так
await req('GET', '/api/audit', null, L);
await req('GET', '/api/errors', null, L);

// власник вимикає йому аналітику — діє одразу, сам увімкнути не може
await req('PUT', `/api/users/${id}`, { analytics: false });
const me2 = (await req('GET', '/api/bootstrap', null, L)).user;
assert.equal(me2.analytics, false);
assert.equal(await status(() => req('POST', '/api/an/query', {}, L)), 403);
assert.equal(await status(() => req('PUT', `/api/users/${id}`, { analytics: true }, L)), 403);
// звичайний адмін теж не вмикає (лише власник)
await req('POST', '/api/users', { login: 'adm', password: 'pass1234', role: 'admin' });
const A = await login('adm', 'pass1234');
assert.equal(await status(() => req('PUT', `/api/users/${id}`, { analytics: true }, A)), 403);
assert.ok((await req('GET', '/api/users', null, A)).users.some((u) => u.role === 'admin_lite'), 'адмін бачить і може призначати роль');

console.log('OK — роль «Адміністратор (без керування людьми)»');
