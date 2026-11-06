// Фіди й таблиці партнера: адмін додає / змінює / прибирає, партнер бачить свої й спільні, чужих — ні.
import assert from 'node:assert/strict';
import { feedKindOf } from '../src/modules/b2b/feeds.js';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

// тип за посиланням
assert.equal(feedKindOf('https://docs.google.com/spreadsheets/d/abc/edit#gid=0'), 'gsheet');
assert.equal(feedKindOf('https://shop.ua/export/prom.xml'), 'xml');
assert.equal(feedKindOf('https://shop.ua/feed?format=yml'), 'xml');
assert.equal(feedKindOf('https://shop.ua/price.xlsx'), 'csv');
assert.equal(feedKindOf('https://drive.google.com/file/d/1'), 'other');

const db = openDb(':memory:');
await migrate(db);
await db.run(`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const mk = () => createApp({ db, fetchFn });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Адмін' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
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
await db.run(`UPDATE b2b_partners SET tg_group = '-100' || id`);
await db.run(`UPDATE users SET tg_chat_id = '7' WHERE login = 'pa'`);
const A = await login('pa', 'pass1234');
const B = await login('pb', 'pass1234');

// додати партнеру А — з повідомленням у Telegram
assert.match(await errOf(() => req('POST', `/api/b2b/partners/${pa.id}/feeds`, { url: 'ftp://x' })), /https/);
const f1 = await req('POST', `/api/b2b/partners/${pa.id}/feeds`, { url: 'https://shop.ua/export/prom.xml', note: 'оновлюється щогодини', notify: true });
assert.equal(f1.sent, 1);
assert.ok(tg.some((m) => m.chat_id === `-100${pa.id}` && m.text.includes('prom.xml')), 'повідомлення в групу партнера А');
assert.ok(tg.some((m) => String(m.chat_id) === '7'), 'і користувачу партнера');
assert.ok(!tg.some((m) => m.chat_id === `-100${pb.id}`), 'партнеру Б — ні');
// спільне — для всіх, без повідомлення
tg.length = 0;
await req('POST', `/api/b2b/partners/${pa.id}/feeds`, { url: 'https://docs.google.com/spreadsheets/d/abc/edit', title: 'Залишки', common: true });
assert.equal(tg.length, 0);

const la = await req('GET', '/api/b2b/p/feeds', null, A);
assert.equal(la.length, 2);
const xml = la.find((f) => f.kind === 'xml');
assert.equal(xml.title, 'XML-фід', 'назва за типом, якщо не вказано');
assert.equal(xml.note, 'оновлюється щогодини');
assert.equal(xml.created_by, undefined, 'партнеру — без службових полів');
assert.equal(la.find((f) => f.kind === 'gsheet').common, true);
const lb = await req('GET', '/api/b2b/p/feeds', null, B);
assert.deepEqual(lb.map((f) => f.title), ['Залишки'], 'Б бачить лише спільне');

// партнер не може додавати / змінювати
assert.ok(await errOf(() => req('POST', `/api/b2b/partners/${pa.id}/feeds`, { url: 'https://x.ua/a.xml' }, A)));
assert.ok(await errOf(() => req('DELETE', `/api/b2b/feeds/${f1.id}`, null, A)));

// змінити й прибрати
await req('PUT', `/api/b2b/feeds/${f1.id}`, { url: 'https://shop.ua/export/rozetka.xml', title: 'Rozetka' });
assert.equal((await req('GET', `/api/b2b/partners/${pa.id}/feeds`)).find((f) => f.id === f1.id).title, 'Rozetka');
await req('DELETE', `/api/b2b/feeds/${f1.id}`);
assert.deepEqual((await req('GET', '/api/b2b/p/feeds', null, A)).map((f) => f.title), ['Залишки']);
assert.match(await errOf(() => req('DELETE', `/api/b2b/feeds/${f1.id}`)), /не знайдено/);

console.log('OK — B2B: фіди й таблиці партнера');
