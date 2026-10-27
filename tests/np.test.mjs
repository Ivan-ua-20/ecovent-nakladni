// Маркування Нової пошти: кабінети, пошук ТТН (з CRM / в кабінетах за телефоном), друк PDF з потрібного кабінету,
// продовження пошуку після ліміту запитів, кількість звернень до НП і до бази.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const raw = openDb(':memory:');
await migrate(raw);
let q = 0;
const db = { all: (...a) => { q++; return raw.all(...a); }, get: (...a) => { q++; return raw.get(...a); }, run: (...a) => { q++; return raw.run(...a); }, batch: (l) => { if (l.length) q++; return raw.batch(l); } };

const kyivDay = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(d);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const npDate = (day) => day.split('-').reverse().join('.');
const today = kyivDay();
const D = addDays(today, -10);

const K1 = 'a'.repeat(32);
const K2 = 'b'.repeat(32);
const K3 = 'c'.repeat(32);
const CAB = { [K1]: { name: 'ФОП Лупу В.Ф.', code: '2882618253' }, [K2]: { name: 'ТОВ Ековент', code: '45123456' }, [K3]: { name: 'ФОП Агафіца', code: '3012345678' } };
// ТТН кабінетів по днях: { key: { day: [docs] } }
const docs = { [K1]: {}, [K2]: {}, [K3]: {} };
let seq = 20450000000000;
const addDocs = (key, day, n, special = {}) => {
  const list = (docs[key][day] ||= []);
  for (let i = 0; i < n; i++) list.push({ IntDocNumber: String(seq++), RecipientsPhone: `38050${String(1000000 + list.length).slice(-7)}`, RecipientContactPerson: 'Тест', InfoRegClientBarcodes: '' });
  if (special.at !== undefined) Object.assign(list[special.at], special.doc);
  return list;
};
const owner = (ttn) => Object.keys(docs).find((k) => Object.values(docs[k]).some((l) => l.some((d) => d.IntDocNumber === ttn)));

const calls = { api: 0, list: 0, print: 0, track: 0 };
const TRACK = {}; // тип доставки за ТТН для відстеження (за замовчуванням — відділення → відділення)
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://my.novaposhta.ua/orders/printMarking100x100/orders[]/')) {
    calls.print++;
    const m = url.match(/orders\[\]\/(\d+)\/type\/pdf\/apiKey\/(\w+)$/);
    assert.ok(m, url);
    return owner(m[1]) === m[2] ? new Response('%PDF-1.4 test', { headers: { 'Content-Type': 'application/pdf' } }) : new Response('<html>Документ не знайдено</html>');
  }
  assert.equal(url, 'https://api.novaposhta.ua/v2.0/json/');
  const b = JSON.parse(opts.body);
  const ok = (data) => new Response(JSON.stringify({ success: true, data, errors: [], warnings: [] }));
  if (b.modelName === 'TrackingDocument' && b.calledMethod === 'getStatusDocuments') {
    calls.track++;
    const n = b.methodProperties.Documents[0].DocumentNumber;
    return ok([{ Number: n, ServiceType: TRACK[n] || 'WarehouseWarehouse' }]);
  }
  calls.api++;
  if (!CAB[b.apiKey]) return new Response(JSON.stringify({ success: false, data: [], errors: ['API key expired'], warnings: [] }));
  if (b.modelName === 'Counterparty' && b.calledMethod === 'getCounterparties') return ok([{ Description: CAB[b.apiKey].name, EDRPOU: CAB[b.apiKey].code }]);
  if (b.modelName === 'InternetDocument' && b.calledMethod === 'getDocumentList') {
    calls.list++;
    const p = b.methodProperties;
    assert.equal(p.DateTimeFrom, p.DateTimeTo);
    const day = p.DateTimeFrom.split('.').reverse().join('-');
    const list = docs[b.apiKey][day] || [];
    const page = Number(p.Page);
    return ok(list.slice((page - 1) * 100, page * 100));
  }
  throw new Error(`неочікуваний виклик ${b.modelName}.${b.calledMethod}`);
};

const mk = () => createApp({ db, fetchFn, maxSubrequests: 40 }); // як на Cloudflare: новий ліміт на кожне звернення
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'o', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const maxQ = {};
const send = async (method, path, body, headers = H) => {
  q = 0;
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const k = `${method} ${path.split('?')[0].replace(/\/\d+/g, '/:id')}`;
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
// Як браузер: 202 «триває» → повторити.
const find = async (body, headers) => {
  for (let i = 0; i < 20; i++) {
    const r = await send('POST', '/api/np/find', body, headers);
    const j = await r.json();
    if (r.status === 202 && j.pending) { find.retries++; continue; }
    if (r.status >= 400) throw Object.assign(new Error(j.error), { status: r.status });
    return j;
  }
  throw new Error('забагато повторів');
};
find.retries = 0;

// ---------- 1. Кабінети ----------
assert.equal(await status(() => find({ ttn: '20450000000001' })), 400, 'без кабінетів — зрозуміла помилка');
assert.equal(await status(() => req('POST', '/api/np/accounts', { api_key: '123' })), 400, 'формат ключа');
assert.equal(await status(() => req('POST', '/api/np/accounts', { api_key: 'f'.repeat(32) })), 400, 'недійсний ключ НП — помилка');
const a1 = await req('POST', '/api/np/accounts', { api_key: K1 });
assert.equal(a1.sender.name, 'ФОП Лупу В.Ф.');
const a2 = await req('POST', '/api/np/accounts', { name: 'Ековент ТОВ', api_key: K2 });
const a3 = await req('POST', '/api/np/accounts', { api_key: K3 });
assert.equal(await status(() => req('POST', '/api/np/accounts', { api_key: K2 })), 400, 'той самий ключ двічі — ні');
let list = await req('GET', '/api/np/accounts');
assert.equal(list.length, 3);
assert.ok(list.every((a) => !JSON.stringify(a).includes(K1) && !JSON.stringify(a).includes(K2) && a.key.endsWith(a.key.slice(-4))), 'ключі не віддаються у браузер');
assert.equal(list.find((a) => a.id === a1.id).name, 'ФОП Лупу В.Ф.', 'назва — з відправника НП');
assert.equal(list.find((a) => a.id === a2.id).sender_code, '45123456');

// ---------- 2. ТТН є в CRM → друк з потрібного кабінету ----------
const l2 = addDocs(K2, D, 50);
const crmTtn = l2[10].IntDocNumber;
let f = await find({ ttn: crmTtn, phone: '0671112233', date: `${D} 10:00:00` });
assert.deepEqual([f.ttn, f.accountId, f.source], [crmTtn, null, 'crm'], 'ТТН з CRM, кабінет ще невідомий');
assert.equal(calls.api, 4, 'ТТН з CRM — до НП не звертались (лише перевірка ключів при додаванні)');
let pdf = await send('GET', `/api/np/marking/${crmTtn}`);
assert.equal(pdf.status, 200);
assert.equal(pdf.headers.get('content-type'), 'application/pdf');
assert.equal((await pdf.text()).slice(0, 4), '%PDF');
assert.equal(decodeURIComponent(pdf.headers.get('x-np-account')), 'Ековент ТОВ');
assert.equal(calls.print, 2, 'перебрали кабінети до потрібного');
assert.deepEqual([pdf.headers.get('x-np-pickup'), pdf.headers.get('x-np-service'), calls.track], ['0', 'WarehouseWarehouse', 1], 'тип доставки — з відстеження');
f = await find({ ttn: crmTtn });
assert.equal(f.accountId, a2.id, 'кабінет запам’ятовано');
calls.print = 0;
await send('GET', `/api/np/marking/${crmTtn}?account=${f.accountId}`);
assert.equal(calls.print, 1, 'вдруге — один запит до НП');
assert.equal(calls.track, 1, 'тип доставки запам’ятовано — відстеження вдруге не питаємо');
assert.equal((await send('GET', '/api/np/marking/20459999999999')).status, 404, 'чужа ТТН — 404');
assert.equal((await send('GET', '/api/np/marking/abc')).status, 400);

// ---------- 3. ТТН у CRM немає → пошук у кабінетах за телефоном ----------
addDocs(K2, D, 200, { at: 180, doc: { RecipientsPhone: '380671234567' } }); // 250 ТТН за день, потрібна — на 3-й сторінці
addDocs(K1, D, 120);
const wantTtn = docs[K2][D][180].IntDocNumber;
calls.list = 0;
f = await find({ ttn: '', phone: '+38 (067) 123-45-67', date: `${D} 09:15:00`, refs: ['107568'] });
assert.equal(f.ttn, wantTtn);
assert.equal(f.accountId, a2.id);
assert.equal(f.source, 'np');
assert.ok(calls.list <= 6, `сторінок прочитано: ${calls.list} (кабінет, з якого друкують найчастіше, — першим; дні без ТТН — по 1 запиту)`);
calls.list = 0;
f = await find({ phone: '0671234567', date: `${D} 09:15:00` });
assert.equal(f.ttn, wantTtn);
assert.equal(f.source, 'index');
assert.equal(calls.list, 0, 'повторний пошук — з бази, без запитів до НП');

// за номером замовлення в «InfoRegClientBarcodes»
const D2 = addDays(today, -20);
addDocs(K3, D2, 40, { at: 7, doc: { InfoRegClientBarcodes: '107999', RecipientsPhone: '380990000000' } });
f = await find({ phone: '', date: D2, refs: ['107999'] });
assert.equal(f.ttn, docs[K3][D2][7].IntDocNumber);
assert.equal(f.accountId, a3.id);

// ---------- 4. Великий кабінет: пошук продовжується після ліміту за одне звернення ----------
const D3 = addDays(today, -30);
addDocs(K2, D3, 1500); // 15 сторінок у кабінеті, з якого друкують найчастіше
addDocs(K1, D3, 30, { at: 29, doc: { RecipientsPhone: '380931112233' } });
calls.list = 0; find.retries = 0;
f = await find({ phone: '0931112233', date: D3 });
assert.equal(f.ttn, docs[K1][D3][29].IntDocNumber);
assert.ok(find.retries >= 1, 'перше звернення відповіло «триває»');
assert.ok(calls.list < 30, `сторінки не перечитуються після повтору: ${calls.list}`);
const fullDays = (await raw.all(`SELECT * FROM np_days WHERE day = ? AND done = 1`, [D3])).length;
assert.ok(fullDays >= 1, 'прочитані дні запам’ятовано');

// ---------- 5. Не знайдено; сьогоднішній день — не частіше разу на 5 хв ----------
calls.list = 0;
assert.equal(await status(() => find({ phone: '0500000001', date: today })), 404);
const first = calls.list;
assert.ok(first === 3, `сьогодні: по одній сторінці з кожного кабінету (${first})`);
assert.equal(await status(() => find({ phone: '0500000001', date: today })), 404);
assert.equal(calls.list, first, 'повторний пошук за сьогодні в межах 5 хв — без запитів до НП');
assert.equal(await status(() => find({ phone: '', refs: [], date: today })), 400, 'нема ні ТТН, ні телефону');

// ---------- 5а. Адресний забір (кур'єр НП забирає з адреси): попередження при друку маркування ----------
const D4 = addDays(today, -5);
addDocs(K1, D4, 5, { at: 2, doc: { RecipientsPhone: '380661112233', ServiceType: 'DoorsWarehouse' } });
f = await find({ phone: '0661112233', date: D4 });
const trackBefore = calls.track;
pdf = await send('GET', `/api/np/marking/${f.ttn}?account=${f.accountId}`);
assert.deepEqual([pdf.status, pdf.headers.get('x-np-pickup'), pdf.headers.get('x-np-service')], [200, '1', 'DoorsWarehouse'], 'ТТН з кабінету: тип доставки — зі списку ТТН');
assert.equal(calls.track, trackBefore, 'без зайвого відстеження');
// ТТН з CRM, якої немає в індексі, з адресним забором — тип з відстеження
const crmPickup = docs[K2][D][11].IntDocNumber;
TRACK[crmPickup] = 'DoorsDoors';
await raw.run(`UPDATE np_docs SET service = '' WHERE ttn = ?`, [crmPickup]);
pdf = await send('GET', `/api/np/marking/${crmPickup}`);
assert.deepEqual([pdf.headers.get('x-np-pickup'), pdf.headers.get('x-np-service')], ['1', 'DoorsDoors']);

// ---------- 6. Права, зміна і видалення кабінету ----------
await req('POST', '/api/users', { login: 'viewer', password: 'pass1234', role: 'viewer' });
const vl = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'viewer', password: 'pass1234' }) });
const VH = { 'Content-Type': 'application/json', Cookie: vl.headers.get('set-cookie').split(';')[0] };
assert.equal(await status(() => req('GET', '/api/np/accounts', null, VH)), 403, 'кабінети бачать лише власник і адміни');
assert.equal((await find({ ttn: crmTtn }, VH)).accountId, a2.id, 'друкувати маркування може і перегляд');
await req('PUT', `/api/np/accounts/${a3.id}`, { active: false });
assert.equal((await req('GET', '/api/np/accounts')).find((a) => a.id === a3.id).active, 0);
assert.equal((await send('GET', `/api/np/marking/${docs[K3][D2][7].IntDocNumber}`)).status, 404, 'вимкнений кабінет не використовується');
await req('PUT', `/api/np/accounts/${a2.id}`, { check: true });
await req('DELETE', `/api/np/accounts/${a3.id}`);
assert.equal((await raw.get(`SELECT COUNT(*) AS n FROM np_docs WHERE account_id = ?`, [a3.id])).n, 0, 'індекс видаленого кабінету прибрано');
assert.ok((await raw.all(`SELECT * FROM audit_log WHERE kind = 'np'`)).length >= 4, 'зміни кабінетів — у журналі');

console.log('  запитів до бази (макс.):', maxQ);
for (const [k, n] of Object.entries(maxQ)) assert.ok(n <= 45, `${k}: ${n} запитів до бази`);
console.log('OK — Нова пошта: кабінети, пошук ТТН, маркування, ліміти');
