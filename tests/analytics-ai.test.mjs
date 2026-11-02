// «Питання до ШІ» в аналітиці: підключення (ключ, модель, права), цикл з інструментами (ШІ питає ту саму аналітику
// з правами користувача: менеджер — лише свої замовлення), помилки API, облік за місяць.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { kyivDay, addDays } from '../src/modules/analytics/index.js';

const db = openDb(':memory:');
await migrate(db);
const today = kyivDay();
// замовлення в базі аналітики: 2 сьогодні (менеджери ivan і olena)
const ord = (id, user, total) => [`INSERT INTO an_orders (id, code, day, status, user, total, dept, src, office) VALUES (?, ?, ?, 11, ?, ?, 0, 0, '')`, [id, `c${id}`, today, user, total]];
await db.batch([ord(1, 'ivan', 1000), ord(2, 'olena', 500), [`INSERT INTO an_day_bounds (day, min_id, max_id) VALUES (?, 1, 2)`, [today]]]);

const claude = []; // запити до Anthropic
let script = []; // наступні відповіді ШІ
const fetchFn = async (url, opts = {}) => {
  if (url === 'https://api.anthropic.com/v1/messages') {
    const body = JSON.parse(opts.body);
    claude.push({ headers: opts.headers, body });
    const next = script.shift();
    if (typeof next === 'function') return next(body);
    return new Response(JSON.stringify(next), { status: 200 });
  }
  throw new Error(`неочікуваний запит ${url}`);
};
const app = createApp({ db, fetchFn });
const setup = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await app.request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const ask = (text, headers = H, history = []) => req('POST', '/api/an/ai/ask', { messages: [...history, { role: 'user', text }] }, headers);

// ---------- не підключено ----------
assert.deepEqual((await req('GET', '/api/an/ai/status')).j, { enabled: false });
let r = await ask('Як продажі?');
assert.equal(r.status, 400);
assert.match(r.j.error, /ще не підключено/);
assert.equal((await req('PUT', '/api/an/ai/settings', { key: 'abc' })).status, 400, 'не схоже на ключ Anthropic');
assert.equal((await req('PUT', '/api/an/ai/settings', { model: 'gpt-4' })).status, 400, 'невідома модель');
r = await req('PUT', '/api/an/ai/settings', { key: 'sk-ant-api03-testtesttesttesttesttest', model: 'claude-haiku-5-5' });
assert.deepEqual([r.status, r.j.key, r.j.model], [200, '••••••', 'claude-haiku-5-5'], 'ключ не повертається');
r = await req('GET', '/api/an/ai/settings');
assert.equal(r.j.key, '••••••');
await req('PUT', '/api/an/ai/settings', { key: '••••••', model: 'claude-sonnet-5-5' }); // маска — ключ лишається
assert.equal((await db.get(`SELECT value FROM settings WHERE key = 'an_ai_key'`)).value, 'sk-ant-api03-testtesttesttesttesttest');

// ---------- цикл: ШІ питає аналітику, потім відповідає ----------
const toolUse = (input) => ({ stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 50 }, content: [{ type: 'text', text: 'Дивлюся.' }, { type: 'tool_use', id: 'tu1', name: 'query_analytics', input }] });
const final = (text) => ({ stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 120 }, content: [{ type: 'text', text }] });
script = [toolUse({ from: today, to: today }), final('Сьогодні **2 замовлення** на 1 500 ₴.')];
r = await ask('Скільки замовлень сьогодні?');
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.equal(r.j.answer, 'Сьогодні **2 замовлення** на 1 500 ₴.');
assert.deepEqual(r.j.steps, [`аналітика ${today} – ${today}`]);
assert.equal(claude[0].headers['x-api-key'], 'sk-ant-api03-testtesttesttesttesttest');
assert.equal(claude[0].headers['anthropic-version'], '2023-06-01');
assert.equal(claude[0].body.model, 'claude-sonnet-5-5');
assert.ok(claude[0].body.tools.some((t) => t.name === 'query_analytics'), 'інструменти передано');
assert.match(claude[0].body.system, new RegExp(`Сьогодні ${today}`));
assert.match(claude[0].body.system, /Користувачу доступні всі замовлення/);
const res = claude[1].body.messages.at(-1).content[0];
assert.equal(res.type, 'tool_result');
const data = JSON.parse(res.content);
assert.deepEqual([data.kpi.cnt, data.kpi.rev], [2, 1500], 'ШІ отримав підсумки аналітики');
assert.deepEqual(data.byManager.map((m) => m.login).sort(), ['ivan', 'olena']);
assert.ok(!/phone|client_name/.test(res.content), 'без персональних даних');
let use = JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'an_ai_usage'`)).value);
assert.deepEqual([use.month, use.asks, use.input, use.output], [today.slice(0, 7), 1, 2500, 170], 'облік за місяць');

// розмова: попередні репліки йдуть разом із питанням
claude.length = 0;
script = [final('Так, на 50 % більше.')];
r = await ask('А вчора?', H, [{ role: 'user', text: 'Скільки сьогодні?' }, { role: 'assistant', text: '2 замовлення.' }]);
assert.equal(claude[0].body.messages.length, 3);
assert.equal(claude[0].body.messages[2].content, 'А вчора?');

// помилка інструмента — ШІ отримує її текст і відповідає далі
claude.length = 0;
script = [toolUse({ from: addDays(today, -500), to: today }), final('Такий довгий період не підтримується.')];
r = await ask('Продажі за 500 днів?');
assert.equal(r.status, 200);
const err = claude[1].body.messages.at(-1).content[0];
assert.ok(err.is_error && /завеликий/.test(err.content), 'помилка аналітики — у tool_result');

// не більше 6 запитів до аналітики: останній крок — без інструментів
claude.length = 0;
script = [...Array(6).fill(0).map(() => toolUse({ from: today, to: today })), final('Ось що встиг.')];
r = await ask('Зациклись');
assert.equal(r.j.answer, 'Ось що встиг.');
assert.equal(claude.length, 7);
assert.ok(!claude[6].body.tools, 'останній крок — без інструментів');

// помилки API
script = [() => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })];
r = await ask('?');
assert.equal(r.status, 400);
assert.match(r.j.error, /невірний ключ/);
script = [() => new Response(JSON.stringify({ error: { message: 'Your credit balance is too low' } }), { status: 400 })];
assert.match((await ask('?')).j.error, /закінчились кошти/);

// ---------- менеджер: питати може, лише по своїх замовленнях; налаштування — ні ----------
const cu = (await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' })).j;
await req('PUT', `/api/users/${cu.id}`, { crm_logins: 'ivan' });
const ml = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const MH = { 'Content-Type': 'application/json', Cookie: ml.headers.get('set-cookie').split(';')[0] };
assert.equal((await req('GET', '/api/an/ai/settings', null, MH)).status, 403, 'налаштування ШІ — лише адміни');
assert.equal((await req('PUT', '/api/an/ai/settings', { key: '' }, MH)).status, 403);
assert.deepEqual((await req('GET', '/api/an/ai/status', null, MH)).j, { enabled: true });
claude.length = 0;
script = [toolUse({ from: today, to: today, managers: ['olena'] }), final('Ваші продажі: 1 000 ₴.')];
r = await ask('Скільки продав я і Олена?', MH);
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.match(claude[0].body.system, /менеджер: йому доступні лише його замовлення \(ivan\)/);
const mdata = JSON.parse(claude[1].body.messages.at(-1).content[0].content);
assert.deepEqual([mdata.kpi.cnt, mdata.kpi.rev], [1, 1000], 'навіть з фільтром «olena» — лише свої замовлення');
assert.match(mdata.scope, /лише замовлення менеджера/);

// відключити
await req('PUT', '/api/an/ai/settings', { key: '' });
assert.deepEqual((await req('GET', '/api/an/ai/status')).j, { enabled: false });
console.log('OK — аналітика: питання до ШІ (підключення, інструменти, права менеджера, помилки, облік)');
