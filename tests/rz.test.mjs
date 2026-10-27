// Маркування Розетки (ROZETKA Delivery, ТТН RMP-…): магазини, вхід і токен, друк з потрібного магазину, повторний вхід.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const raw = openDb(':memory:');
await migrate(raw);
let q = 0;
const db = { all: (...a) => { q++; return raw.all(...a); }, get: (...a) => { q++; return raw.get(...a); }, run: (...a) => { q++; return raw.run(...a); }, batch: (l) => { if (l.length) q++; return raw.batch(l); } };

// Два магазини: логін → пароль, назва, їхні ТТН.
const SHOPS = {
  shop1: { password: 'Пароль-1', title: 'Ековент Магазин', ttns: ['RMP-1000000001', 'RMP-1000000002'] },
  shop2: { password: 'secret2', title: 'Ековент Дистрибуція', ttns: ['RMP-2000000001'] },
};
let tokSeq = 0;
const tokens = new Map(); // token → shop
const calls = { login: 0, print: 0 };
let fileAsJson = false;
const fetchFn = async (url, opts = {}) => {
  const json = (o) => new Response(JSON.stringify(o));
  const u = new URL(url);
  assert.equal(u.origin, 'https://api-seller.rozetka.com.ua');
  if (u.pathname === '/sites') {
    calls.login++;
    const b = JSON.parse(opts.body);
    const pass = new TextDecoder().decode(Uint8Array.from(atob(b.password), (c) => c.charCodeAt(0)));
    const shop = SHOPS[b.username];
    if (!shop || shop.password !== pass) return json({ success: false, errors: { message: 'incorrect_username_pasword', code: 1020 } });
    const t = `tok${++tokSeq}`;
    tokens.set(t, b.username);
    return json({ success: true, content: { id: 1, access_token: t, market: { id: 77, title: shop.title } } });
  }
  if (u.pathname === '/delivery-rozetka/ttn-print-batch') {
    calls.print++;
    const shop = tokens.get(String(opts.headers.Authorization).replace('Bearer ', ''));
    if (!shop) return json({ success: false, errors: { message: 'session_expired', code: 6001 } });
    const ttn = JSON.parse(opts.body).track_numbers[0];
    if (!SHOPS[shop].ttns.includes(ttn)) return json({ success: false, errors: { message: 'entity_not_found', code: 1019 } });
    if (fileAsJson) return json({ success: true, content: { file: btoa('%PDF-1.4 json') } });
    return new Response('%PDF-1.4 rz', { headers: { 'Content-Type': 'application/pdf' } });
  }
  throw new Error(`неочікуваний запит ${url}`);
};

const mk = () => createApp({ db, fetchFn, maxSubrequests: 40 });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'o', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const maxQ = {};
const send = async (method, path, body, headers = H) => {
  q = 0;
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const k = `${method} ${path.split('?')[0].replace(/\/(\d+|RMP-[\w-]+)/g, '/:id')}`;
  maxQ[k] = Math.max(maxQ[k] || 0, q);
  return r;
};
const req = async (method, path, body, headers) => {
  const r = await send(method, path, body, headers);
  const j = await r.json();
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };
const pdf = async (ttn) => {
  const r = await send('GET', `/api/rz/marking/${encodeURIComponent(ttn)}`);
  return { status: r.status, text: await r.text(), shop: decodeURIComponent(r.headers.get('x-np-account') || '') };
};

// ---------- 1. Магазини ----------
assert.equal((await pdf('RMP-1000000001')).status, 400, 'без магазинів — зрозуміла помилка');
assert.equal(await status(() => req('POST', '/api/rz/accounts', { username: 'shop1', password: 'wrong' })), 400, 'неправильний пароль — помилка');
const s1 = await req('POST', '/api/rz/accounts', { username: 'shop1', password: 'Пароль-1' });
assert.equal(s1.market, 'Ековент Магазин', 'пароль з кирилицею — base64 з UTF-8');
const s2 = await req('POST', '/api/rz/accounts', { name: 'Дистрибуція', username: 'shop2', password: 'secret2' });
assert.equal(await status(() => req('POST', '/api/rz/accounts', { username: 'shop2', password: 'secret2' })), 400, 'той самий логін двічі — ні');
const list = await req('GET', '/api/rz/accounts');
assert.equal(list.length, 2);
assert.ok(!JSON.stringify(list).includes('secret2') && !JSON.stringify(list).includes('Пароль-1'), 'паролі не віддаються у браузер');
assert.ok(!JSON.stringify(list).includes('tok'), 'токени не віддаються у браузер');

// ---------- 2. Друк: перебір магазинів один раз, далі — з першої спроби, без нового входу ----------
calls.login = 0; calls.print = 0;
let r = await pdf('RMP-2000000001');
assert.equal(r.status, 200);
assert.equal(r.text.slice(0, 4), '%PDF');
assert.equal(r.shop, 'Дистрибуція');
assert.equal(calls.login, 0, 'токен з додавання магазину використано повторно');
assert.equal(calls.print, 2, 'перший раз — перебір магазинів');
calls.print = 0;
await pdf('RMP-2000000001');
assert.equal(calls.print, 1, 'вдруге — з першої спроби');
r = await pdf(' rmp-1000000002 ');
assert.equal(r.status, 200, 'регістр і пробіли не заважають');
assert.equal(r.shop, 'Ековент Магазин');
assert.equal((await pdf('RMP-9999999999')).status, 404, 'чужа ТТН — 404');
assert.equal((await pdf('20450000000000')).status, 400, 'не RMP — 400');

// ---------- 3. Прострочений токен → новий вхід і повтор ----------
tokens.clear();
calls.login = 0;
r = await pdf('RMP-1000000001');
assert.equal(r.status, 200);
assert.equal(calls.login, 2, 'після «сесія закінчилася» — кожен магазин входить заново лише раз');
// старий токен (понад 20 год) оновлюється заздалегідь
await raw.run(`UPDATE rz_accounts SET token_at = '2000-01-01T00:00:00Z'`);
calls.login = 0;
await pdf('RMP-1000000001');
assert.equal(calls.login, 1);

// ---------- 4. Файл у JSON (base64) теж приймається ----------
fileAsJson = true;
r = await pdf('RMP-1000000002');
assert.equal(r.status, 200);
assert.equal(r.text.slice(0, 4), '%PDF');
fileAsJson = false;

// ---------- 5. Права, зміна і видалення ----------
await req('POST', '/api/users', { login: 'viewer', password: 'pass1234', role: 'viewer' });
const vl = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'viewer', password: 'pass1234' }) });
const VH = { 'Content-Type': 'application/json', Cookie: vl.headers.get('set-cookie').split(';')[0] };
assert.equal(await status(() => req('GET', '/api/rz/accounts', null, VH)), 403, 'магазини бачать лише власник і адміни');
assert.equal((await send('GET', '/api/rz/marking/RMP-1000000001', null, VH)).status, 200, 'друкувати маркування може і перегляд');
assert.equal(await status(() => req('PUT', `/api/rz/accounts/${s1.id}`, { password: 'bad' })), 400, 'новий пароль перевіряється');
await req('PUT', `/api/rz/accounts/${s2.id}`, { active: false });
assert.equal((await pdf('RMP-2000000001')).status, 404, 'вимкнений магазин не використовується');
await req('PUT', `/api/rz/accounts/${s1.id}`, { check: true });
await req('DELETE', `/api/rz/accounts/${s2.id}`);
assert.equal((await raw.get(`SELECT COUNT(*) AS n FROM rz_docs WHERE account_id = ?`, [s2.id])).n, 0);
assert.ok((await raw.all(`SELECT * FROM audit_log WHERE kind = 'rz'`)).length >= 3, 'зміни магазинів — у журналі');

console.log('  запитів до бази (макс.):', maxQ);
for (const [k, n] of Object.entries(maxQ)) assert.ok(n <= 45, `${k}: ${n} запитів до бази`);
console.log('OK — Розетка: магазини, токен, маркування RMP');
