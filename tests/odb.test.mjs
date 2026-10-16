// Opendatabot: рахунки, посилання на оплату, дублі, QR у Word-рахунку, надходження, повідомлення з підписом, статуси.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDb } from '../src/db-node.js';
import { migrate } from '../src/schema.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
// лічильник запитів до бази (ліміт D1 — 50 на одне звернення; batch = 1)
let q = 0;
for (const k of ['all', 'get', 'run', 'batch']) { const f = db[k].bind(db); db[k] = (...a) => { q++; return f(...a); }; }
const maxQ = {};

const BASE = 'https://odb.test';
const KEY = 'test-key';
const ACCS = [
  { id: 'a1', iban: 'UA063052990000026008050293936', code: '2882618253', alias: 'ФОП Лупу В.Ф.', default: true },
  { id: 'a2', iban: 'UA213223130000026007233566001', code: '3012345678', alias: 'ФОП Агафіца А.М.' },
  { id: 'a3', iban: 'UA903052992990004149123456789', code: '45123456', alias: 'ТОВ Ековент' },
];
const invoices = new Map();
let invSeq = 0;
const feed = []; // стрічка транзакцій, найновіші першими
const calls = {};
const tx = (n, { iban = ACCS[0].iban, amount = 100 + n, type = 'credit', invoice = null, possible = [], payer = 'ТОВ "РОЗЕТКА.УА"', code = '37193071', date } = {}) => ({
  transactionId: `t${n}`, autoclientConfigId: 'cfg1', matches: {}, invoiceNumber: invoice?.purpose || '',
  transaction: { date: date || `2026-0${1 + (n % 9)}-1${n % 10}T10:${String(n % 60).padStart(2, '0')}:00.000Z`, amount, currency: 'UAH', purpose: `Платіж ${n}`, iban, edrpou: '2882618253', counterpartyName: payer, counterpartyEdrpou: code, counterpartyAcc: `UA00${n}`, transactionType: type, raw: {} },
  invoice, possibleInvoices: possible,
});
for (let n = 1; n <= 260; n++) feed.unshift(tx(n, { type: n % 13 === 0 ? 'debit' : 'credit', iban: ACCS[n % 3].iban }));

const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  assert.equal(u.origin, BASE);
  assert.equal(opts.headers['x-client-key'], KEY);
  const key = `${opts.method} ${u.pathname.replace(/\/[0-9a-f]{24}\//, '/:id/')}`;
  calls[key] = (calls[key] || 0) + 1;
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
  if (u.pathname === '/api/iban-settings') return json({ ibanSettings: ACCS });
  if (u.pathname === '/api/invoice' && opts.method === 'POST') {
    const b = JSON.parse(opts.body);
    assert.match(b.amount, /^\d+\.\d{2}$/);
    if (Number(b.amount) <= 0) return json({ message: 'Validation failed', errors: [{ field: 'amount', message: 'amount must be > 0' }] }, 400);
    const id = (++invSeq).toString(16).padStart(24, '0');
    const acc = ACCS.find((a) => a.id === b.ibanSettingId);
    const inv = { id, url: `https://bank.gov.ua/qr/${id}`, qrcode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', code: acc.code, iban: acc.iban, amount: Number(b.amount), purpose: b.purpose, paymentStatus: 'pending' };
    invoices.set(id, inv);
    return json(inv, 201);
  }
  if (u.pathname === '/api/transactions') {
    const off = Number(u.searchParams.get('offset')); const lim = Number(u.searchParams.get('limit'));
    return json({ count: feed.length, items: feed.slice(off, off + lim) });
  }
  if (u.pathname === '/api/invoices') {
    const items = [...invoices.values()].filter((i) => !u.searchParams.get('status') || i.paymentStatus === u.searchParams.get('status'));
    return json({ count: items.length, items });
  }
  const m = u.pathname.match(/^\/api\/invoice\/([^/]+)\/paid$/);
  if (m) { invoices.get(m[1]).paymentStatus = 'paid'; return json({ id: m[1], status: 'paid' }); }
  return json({ message: 'not found' }, 404);
};

const app = createApp({ db, fetchFn, odbBase: BASE });
const setup = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'o', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  q = 0;
  const r = await app.request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const k = `${method} ${path.split('?')[0].replace(/\/\d+/g, '/:id')}`;
  maxQ[k] = Math.max(maxQ[k] || 0, q);
  const j = await r.json();
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e.status; } };

// ---------- 1. Підключення і рахунки ----------
assert.equal(await status(() => req('GET', '/api/odb/accounts?refresh=1')), 400, 'без ключа — зрозуміла помилка');
await req('PUT', '/api/settings', { odb_key: KEY, odb_name: 'ecovent' });
const boot = await req('GET', '/api/bootstrap');
assert.ok(/^•+$/.test(boot.settings.odb_key), 'ключ не віддається у браузер');
let accs = (await req('GET', '/api/odb/accounts?refresh=1')).accounts;
assert.deepEqual(accs.map((a) => a.kind), ['fop', 'fop', 'company'], 'ФОП/юрособа за кодом');
assert.ok(accs.every((a) => !a.enabled), 'за замовчуванням вимкнені');
assert.equal(await status(() => req('POST', '/api/odb/links', { account_id: 'a1', amount: 100 })), 400, 'вимкнений рахунок — не можна');
await req('PUT', '/api/odb/accounts/a1', { enabled: true });
await req('PUT', '/api/odb/accounts/a3', { enabled: true });
const fops = await db.all(`SELECT short_name, ipn, iban, odb_id, active FROM inv_fops WHERE odb_id != ''`);
assert.deepEqual(fops.map((x) => ({ ...x })), [{ short_name: 'ФОП Лупу В.Ф.', ipn: '2882618253', iban: ACCS[0].iban, odb_id: 'a1', active: 1 }], 'увімкнений ФОП з’явився у ФОПах рахунків, ТОВ — ні');

// ---------- 2. Посилання ----------
const n0 = Number((await req('GET', '/api/odb/links')).nextNumber);
const l1 = (await req('POST', '/api/odb/links', { account_id: 'a1', amount: '1 250,50', client: 'Іван' })).link;
assert.equal(l1.number, String(n0), 'ручний — наступний спільний номер');
assert.equal(l1.purpose, `Оплата за рахунком № ${n0}`);
assert.equal(l1.amount, 1250.5);
assert.ok(l1.page.endsWith(`/invoice/${l1.odb_id}`) && l1.qr.startsWith('data:image/png'));
assert.equal(Number((await req('GET', '/api/odb/links')).nextNumber), n0 + 1);
const l2 = (await req('POST', '/api/odb/links', { account_id: 'a3', amount: 500, order_ref: '123456', client: 'ТОВ Клієнт' })).link;
assert.equal(l2.number, '123456', 'із замовлення — номер замовлення');
const dup = await req('POST', '/api/odb/links', { account_id: 'a3', amount: 500, order_ref: '123456' });
assert.ok(dup.duplicate && dup.duplicate.id === l2.id && !dup.link, 'дубль — пропонується існуюче посилання');
assert.equal(invSeq, 2, 'дубль не створює платний рахунок');
const l3 = (await req('POST', '/api/odb/links', { account_id: 'a3', amount: 500, order_ref: '123456', force: true })).link;
assert.ok(l3.id !== l2.id, 'можна створити нове попри дубль');
assert.equal(await status(() => req('POST', '/api/odb/links', { account_id: 'a1', amount: 0 })), 400);

// ---------- 3. Word-рахунок з QR ----------
const fopId = (await db.get(`SELECT id FROM inv_fops WHERE odb_id = 'a1'`)).id;
const rb = { fop_id: fopId, client: { name: 'Петро' }, items: [{ name: 'Товар', qty: 2, price: 300 }], qr: true };
const r1 = await req('POST', '/api/rahunky', rb);
assert.ok(r1.data.pay?.qr && r1.data.pay.page, 'у рахунку є QR і посилання');
const rl = await db.get(`SELECT * FROM pay_links WHERE id = ?`, [r1.data.pay.link_id]);
assert.equal(rl.number, r1.data.number); assert.equal(rl.amount, 600);
const before = invSeq;
const r1b = await req('PUT', `/api/rahunky/${r1.id}`, rb);
assert.equal(invSeq, before, 'та сама сума — те саме посилання');
assert.equal(r1b.data.pay.link_id, r1.data.pay.link_id);
const r1c = await req('PUT', `/api/rahunky/${r1.id}`, { ...rb, items: [{ name: 'Товар', qty: 3, price: 300 }] });
assert.equal(invSeq, before + 1, 'нова сума — нове посилання');
assert.equal((await db.get(`SELECT status FROM pay_links WHERE id = ?`, [r1.data.pay.link_id])).status, 'closed', 'старе закрито');
const r2 = await req('POST', '/api/rahunky', { ...rb, qr: false });
assert.ok(!r2.data.pay, 'без галочки — без QR');
const tovFop = (await db.run(`INSERT INTO inv_fops (short_name, iban, active) VALUES ('ТОВ', ?, 1)`, [ACCS[2].iban])).lastId;
assert.equal(await status(() => req('POST', '/api/rahunky', { ...rb, fop_id: tovFop })), 400, 'ТОВ — без Word-рахунку з QR');

// ---------- 4. Звірка надходжень ----------
const s1 = await req('POST', '/api/odb/sync', { force: true });
const credits = feed.filter((x) => x.transaction.transactionType === 'credit').length;
let stored = (await db.get(`SELECT COUNT(*) AS n FROM odb_tx`)).n;
assert.ok(stored > 0 && stored <= credits);
for (let k = 0; k < 5 && !(await req('GET', '/api/odb/payments')).hist.done; k++) await req('POST', '/api/odb/sync', { force: true });
stored = (await db.get(`SELECT COUNT(*) AS n FROM odb_tx`)).n;
assert.equal(stored, credits, 'уся історія завантажена, лише надходження');
const skip = await req('POST', '/api/odb/sync', {});
assert.ok(skip.skipped, 'не частіше разу на хвилину');

// ---------- 5. Повідомлення про оплату ----------
const inv1 = invoices.get(l1.odb_id);
const hook = async (payload, key = KEY) => {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', key).update(body).digest('hex');
  return app.request('/api/odb/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', Signature: sig }, body });
};
const p1 = tx(900, { amount: 600, invoice: { id: inv1.id, amount: inv1.amount, purpose: inv1.purpose }, date: '2026-10-16T09:00:00.000Z' });
assert.equal((await hook(p1, 'wrong')).status, 401, 'підпис перевіряється');
assert.equal((await app.request('/api/odb/hook', { method: 'POST', body: '{}' })).status, 401, 'без підпису — ні');
assert.equal((await hook(p1)).status, 200);
let L1 = (await req('GET', `/api/odb/links/${l1.id}`));
assert.equal(L1.link.status, 'partial', 'частина суми — «частково»');
assert.equal(L1.payments.length, 1);
await hook(p1); // повтор того самого повідомлення
assert.equal((await req('GET', `/api/odb/links/${l1.id}`)).payments.length, 1, 'повтор не дублює платіж');
feed.unshift(tx(901, { amount: 650.5, invoice: { id: inv1.id }, date: '2026-10-16T10:00:00.000Z' }));
const s2 = await req('POST', '/api/odb/sync', { force: true });
assert.equal(s2.added, 1);
assert.deepEqual(s2.minePaid.map((x) => x.id), [l1.id], 'звірка повідомляє, що мій рахунок оплачено');
L1 = await req('GET', `/api/odb/links/${l1.id}`);
assert.equal(L1.link.status, 'paid'); assert.equal(L1.link.paid_amount, 1250.5);
assert.equal(L1.link.paid_at, '2026-10-16T13:00:00', 'час платежу — київський');

// неточний збіг → «перевірити», потім ручна прив'язка
const inv2 = invoices.get(l2.odb_id);
await hook(tx(902, { iban: ACCS[2].iban, amount: 499.5, possible: [{ id: inv2.id }], payer: 'ROZETKA PAY' }));
assert.equal((await req('GET', `/api/odb/links/${l2.id}`)).link.status, 'check');
const chk = await req('GET', '/api/odb/payments?only=check');
assert.equal(chk.rows.length, 1);
await req('PUT', `/api/odb/payments/${chk.rows[0].id}`, { link_id: l2.id });
assert.equal((await req('GET', `/api/odb/links/${l2.id}`)).link.status, 'paid', 'прив’язано вручну, ±1 грн — оплачено');

// Opendatabot сам відмітив оплату (без платежу в стрічці)
await req('POST', `/api/odb/links/${l3.id}/paid`);
assert.equal((await req('GET', `/api/odb/links/${l3.id}`)).link.status, 'manual');

// ---------- 6. Списки і вкладки ----------
const unpaid = (await req('GET', '/api/odb/links?filter=unpaid')).links;
assert.ok(unpaid.every((x) => ['pending', 'partial', 'check'].includes(x.status)) && unpaid.length >= 1);
const all = await req('GET', '/api/odb/payments');
assert.equal(all.count, credits + 3);
const ours = await req('GET', '/api/odb/payments?only=ours');
assert.equal(ours.count, 3);
const per = await req('GET', '/api/odb/payments?from=2026-10-16&to=2026-10-16');
assert.ok(per.rows.every((r) => r.date.startsWith('2026-10-16')) && per.count >= 2);

// менеджер: свої / усі
await req('POST', '/api/users', { login: 'man', password: 'pass1234', role: 'manager' });
const ml = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'man', password: 'pass1234' }) });
const MH = { 'Content-Type': 'application/json', Cookie: ml.headers.get('set-cookie').split(';')[0] };
assert.equal((await req('GET', '/api/odb/payments?tab=mine', null, MH)).count, 0, 'у менеджера ще немає своїх');
assert.equal((await req('GET', '/api/odb/payments', null, MH)).count, all.count, 'менеджер бачить усі платежі');
const ml1 = (await req('POST', '/api/odb/links', { account_id: 'a1', amount: 77 }, MH)).link;
await hook(tx(903, { amount: 77, invoice: { id: ml1.odb_id } }));
assert.equal((await req('GET', '/api/odb/payments?tab=mine', null, MH)).count, 1, 'свої платежі — за посиланнями менеджера');
assert.equal(await status(() => req('PUT', '/api/odb/accounts/a2', { enabled: true }, MH)), 403, 'вмикати рахунки — лише адміни');
assert.equal(await status(() => req('GET', '/api/odb/accounts?refresh=1', null, MH)), 403);

console.log('  виклики Opendatabot:', calls);
console.log('  запитів до бази (макс.):', maxQ);
for (const [k, n] of Object.entries(maxQ)) assert.ok(n <= 45, `${k}: ${n} запитів до бази`);
console.log('OK — Opendatabot: посилання, QR, платежі, статуси');
