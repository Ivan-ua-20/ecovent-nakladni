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
const ord = (id, user, total, ch = '') => [`INSERT INTO an_orders (id, code, day, status, user, total, dept, src, office, ch) VALUES (?, ?, ?, 11, ?, ?, 0, 0, '', ?)`, [id, `c${id}`, today, user, total, ch]];
await db.batch([ord(1, 'ivan', 1000), ord(2, 'olena', 500, 'b2b(ecovent)'), [`INSERT INTO an_day_bounds (day, min_id, max_id) VALUES (?, 1, 2)`, [today]]]);

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

// ---------- зміни налаштувань: ШІ пропонує, людина застосовує; журнал і відкат ----------
const cfg0 = (await req('GET', '/api/an/config')).j;
const depts0 = cfg0.depts.map((d) => d.name);
const month = today.slice(0, 7);
const proposeUse = (ops, summary = 'Окремий відділ B2B') => ({ stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', id: 'p1', name: 'propose_changes', input: { summary, ops } }] });
const OPS = [
  { type: 'dept_add', name: 'Опт' },
  { type: 'source_add', dept: 'Опт', name: 'Опт партнери' },
  { type: 'values_map', source: 'Опт партнери', values: ['B2B(Ecovent)'] },
  { type: 'manager_set', login: 'ivan', name: 'Іван', dept: 'Опт' },
  { type: 'office_set', office: '27', dept: 'Опт' },
  { type: 'target_set', month, kind: 'dept', ref: 'Опт', amount: 100000 },
  { type: 'settings_set', targetBase: 'all' },
];
claude.length = 0;
script = [
  { stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', id: 'g1', name: 'get_settings', input: {} }] },
  proposeUse([{ type: 'source_add', dept: 'Немає такого', name: 'X' }]), // помилка — ШІ бачить її і виправляє
  proposeUse(OPS),
  final('Запропонував окремий відділ B2B — натисніть «Застосувати».'),
];
r = await ask('B2B показується неправильно — зроби окремий відділ');
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.ok(claude[0].body.tools.some((t) => t.name === 'propose_changes'), 'адміну — інструменти змін');
assert.match(claude[0].body.system, /НІЧОГО не змінює/);
const gs = JSON.parse(claude[1].body.messages.at(-1).content[0].content);
assert.ok(gs.depts.length && gs.field1Values.some((v) => v.value === 'b2b(ecovent)' && v.orders === 1 && !v.mapped), 'get_settings: значення «Поле 1» з кількістю');
const bad = claude[2].body.messages.at(-1).content[0];
assert.ok(bad.is_error && /Відділ «Немає такого» не знайдено/.test(bad.content), 'невірна пропозиція — помилка для ШІ');
assert.equal(r.j.proposals.length, 1);
const prop = r.j.proposals[0];
assert.ok(prop.lines.some((l) => /Новий відділ «Опт»/.test(l)) && prop.lines.some((l) => /«b2b\(ecovent\)»: без джерела → «Опт партнери»/.test(l)), JSON.stringify(prop.lines));
assert.ok(prop.lines.some((l) => /Менеджер ivan \(Іван\): новий → «Опт»/.test(l)));
assert.ok(prop.lines.some((l) => /таргет рахується від: обороту без відмов → суми всіх замовлень/.test(l)));
assert.deepEqual((await req('GET', '/api/an/config')).j.depts.map((d) => d.name), depts0, 'до підтвердження нічого не змінилось');
let j = (await req('GET', '/api/an/ai/changes')).j;
assert.deepEqual([j.rows[0].id, j.rows[0].status, j.rows[0].asked_by, j.rows[0].question], [prop.id, 'pending', 'owner', 'B2B показується неправильно — зроби окремий відділ'], 'журнал: хто попросив і що написав');

// застосувати
r = await req('POST', `/api/an/ai/changes/${prop.id}/apply`);
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.deepEqual([r.j.change.status, r.j.change.done_by], ['applied', 'owner']);
const cfg1 = (await req('GET', '/api/an/config')).j;
const b2b = cfg1.depts.find((d) => d.name === 'Опт');
assert.ok(b2b && b2b.sources[0].name === 'Опт партнери' && b2b.sources[0].values.includes('b2b(ecovent)'), 'відділ, джерело, значення');
assert.equal(cfg1.managers.find((m) => m.login === 'ivan').dept_id, b2b.id);
assert.equal(cfg1.officeMap.find((o) => o.office === '27').dept_id, b2b.id);
assert.equal(cfg1.settings.targetBase, 'all');
assert.deepEqual((await req('GET', `/api/an/targets?month=${month}`)).j.rows.find((t) => t.kind === 'dept' && t.ref_id === b2b.id)?.amount, 100000);
let qB = (await req('POST', '/api/an/query', { from: today, to: today, depts: [b2b.id] })).j;
assert.deepEqual([qB.kpi.cur.cnt, qB.kpi.cur.rev], [2, 1500], 'обидва замовлення — в «Опт»: за джерелом і за менеджером');
assert.ok(await db.get(`SELECT id FROM audit_log WHERE kind = 'analytics' AND action LIKE 'застосовано зміни аналітики від ШІ%'`), 'запис у журналі змін');
assert.equal((await req('POST', `/api/an/ai/changes/${prop.id}/apply`)).status, 400, 'двічі не застосувати');

// друга пропозиція: скасувати; третя: застосувати — відкотити можна лише останню
const mk2 = async (ops, text) => { script = [proposeUse(ops), final('Ок.')]; return (await ask(text)).j.proposals[0]; };
const p2 = await mk2([{ type: 'dept_rename', dept: 'Опт', name: 'Оптові партнери' }], 'перейменуй B2B');
assert.equal((await req('POST', `/api/an/ai/changes/${p2.id}/cancel`)).j.change.status, 'cancelled');
assert.equal((await req('POST', `/api/an/ai/changes/${p2.id}/apply`)).status, 400, 'скасоване не застосувати');
const p3 = await mk2([{ type: 'brand_set', name: 'Warmix', keywords: 'warmix, вармікс' }], 'додай бренд Warmix');
assert.equal((await req('POST', `/api/an/ai/changes/${p3.id}/apply`)).status, 200);
assert.equal((await req('POST', `/api/an/ai/changes/${prop.id}/revert`)).status, 400, 'спершу відкотити пізнішу');
j = (await req('GET', '/api/an/ai/changes')).j;
assert.deepEqual(j.rows.filter((x) => x.can_revert).map((x) => x.id), [p3.id]);
assert.equal((await req('POST', `/api/an/ai/changes/${p3.id}/revert`)).j.change.status, 'reverted');
assert.ok(!(await req('GET', '/api/an/config')).j.brands.some((x) => x.name === 'Warmix'));
// тепер можна відкотити першу — усе як було
r = await req('POST', `/api/an/ai/changes/${prop.id}/revert`);
assert.deepEqual([r.status, r.j.change.status, r.j.change.reverted_by], [200, 'reverted', 'owner']);
const cfg2 = (await req('GET', '/api/an/config')).j;
assert.deepEqual(cfg2.depts.map((d) => d.name), depts0, 'відділи як були');
assert.deepEqual(cfg2.managers, cfg0.managers, 'менеджери як були');
assert.deepEqual(cfg2.officeMap.sort((a, b) => a.office.localeCompare(b.office)), cfg0.officeMap.sort((a, b) => a.office.localeCompare(b.office)), 'відділи CRM як були');
assert.deepEqual(cfg2.depts.map((d) => [d.id, d.sources.map((x) => [x.id, x.values.length])]), cfg0.depts.map((d) => [d.id, d.sources.map((x) => [x.id, x.values.length])]), 'ті самі id і значення');
assert.equal(cfg2.settings.targetBase, cfg0.settings.targetBase);
qB = (await req('POST', '/api/an/query', { from: today, to: today })).j;
assert.ok(!qB.byDept.some((d) => d.name === 'Опт'), 'замовлення знову розподілені як раніше');

// невдале застосування — налаштування лишаються як були
const p4 = await mk2([{ type: 'dept_add', name: 'Тимчасовий' }], 'додай відділ');
await db.run(`INSERT INTO an_depts (name, sort) VALUES ('Тимчасовий', 99)`); // хтось додав вручну, поки чекало
r = await req('POST', `/api/an/ai/changes/${p4.id}/apply`);
assert.equal(r.status, 400);
assert.match(r.j.error, /уже є.*лишились як були/);
assert.equal((await req('GET', '/api/an/ai/changes')).j.rows.find((x) => x.id === p4.id).status, 'failed');

// ---------- менеджер: питати може, лише по своїх замовленнях; налаштування — ні ----------
const cu = (await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' })).j;
await req('PUT', `/api/users/${cu.id}`, { crm_logins: 'ivan' });
const ml = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const MH = { 'Content-Type': 'application/json', Cookie: ml.headers.get('set-cookie').split(';')[0] };
assert.equal((await req('GET', '/api/an/ai/settings', null, MH)).status, 403, 'налаштування ШІ — лише адміни');
assert.equal((await req('PUT', '/api/an/ai/settings', { key: '' }, MH)).status, 403);
assert.deepEqual((await req('GET', '/api/an/ai/status', null, MH)).j, { enabled: true });
assert.equal((await req('GET', '/api/an/ai/changes', null, MH)).status, 403, 'журнал змін — лише адміни');
assert.equal((await req('POST', `/api/an/ai/changes/${p4.id}/apply`, null, MH)).status, 403);
claude.length = 0;
script = [toolUse({ from: today, to: today, managers: ['olena'] }), final('Ваші продажі: 1 000 ₴.')];
r = await ask('Скільки продав я і Олена?', MH);
assert.equal(r.status, 200, JSON.stringify(r.j));
assert.match(claude[0].body.system, /менеджер: йому доступні лише його замовлення \(ivan\)/);
assert.ok(!claude[0].body.tools.some((t) => t.name === 'propose_changes'), 'менеджеру — без змін налаштувань');
const mdata = JSON.parse(claude[1].body.messages.at(-1).content[0].content);
assert.deepEqual([mdata.kpi.cnt, mdata.kpi.rev], [1, 1000], 'навіть з фільтром «olena» — лише свої замовлення');
assert.match(mdata.scope, /лише замовлення менеджера/);

// відключити
await req('PUT', '/api/an/ai/settings', { key: '' });
assert.deepEqual((await req('GET', '/api/an/ai/status')).j, { enabled: false });
console.log('OK — аналітика: питання до ШІ (підключення, інструменти, права менеджера, помилки, облік) і зміни налаштувань через ШІ (пропозиція, застосування, журнал, відкат)');
