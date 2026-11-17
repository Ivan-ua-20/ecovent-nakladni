// «Перевірка»: вид оплати LP-CRM ↔ наложка в ТТН (НП, ROZETKA Delivery), чек Checkbox (сума, спосіб оплати, ФОП),
// оплата на рахунок (Opendatabot) ↔ ФОП чека, часткова передоплата з коментаря, дублі за телефоном, чеки за день, доступ.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { partialOf, carrierOf, payRules } from '../src/modules/checks/rules.js';

// Чисті правила
assert.deepEqual(partialOf('Передоплата 300 грн, решта наложкою'), { sum: 300 });
assert.deepEqual(partialOf('аванс 1 000'), { sum: 1000 });
assert.deepEqual(partialOf('часткова оплата'), { sum: 0 });
assert.equal(partialOf('Поклеїти плівку'), null);
assert.equal(carrierOf('20451557024903'), 'np');
assert.equal(carrierOf('RMP-123456789'), 'rd');
assert.equal(carrierOf('PRM-1234567'), 'prm');
assert.equal(carrierOf('CV123456789UA', 'Meest'), 'meest');
assert.equal(payRules({ 16: { cls: 'skip' } })['16'].cls, 'skip');
assert.equal(payRules({})['16'].cb, 'NovaPay');

const st0 = globalThis.setTimeout; globalThis.setTimeout = (f, ms, ...a) => st0(f, 0, ...a); // паузи LP-CRM — без очікування
const raw = openDb(':memory:');
await migrate(raw);
// Лічильник звернень до бази (D1 безкоштовно: до 50 на запит; batch — одне).
let dbn = 0;
const db = { all: (...a) => { dbn++; return raw.all(...a); }, get: (...a) => { dbn++; return raw.get(...a); }, run: (...a) => { dbn++; return raw.run(...a); }, batch: (l) => { if (l.length) dbn++; return raw.batch(l); } };
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
const dayAgo = (n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const D = dayAgo(2);

await db.run(`UPDATE settings SET value = 'ihunt' WHERE key = 'lpcrm_subdomain'`);
await db.run(`INSERT INTO settings (key, value) VALUES ('lpcrm_subdomain', 'ihunt') ON CONFLICT(key) DO UPDATE SET value = 'ihunt'`);
await db.run(`INSERT INTO settings (key, value) VALUES ('lpcrm_key', 'k') ON CONFLICT(key) DO UPDATE SET value = 'k'`);
await db.run(`DELETE FROM fops`);
await db.run(`INSERT INTO fops (id, short_name, full_name, ipn, iban, active) VALUES (1, 'ФОП Агафіца Д.М.', 'А Д М', '1111111111', 'UA111', 1)`);
await db.run(`INSERT INTO fops (id, short_name, full_name, ipn, iban, active) VALUES (2, 'ФОП Лупу В.Ф.', 'Л В Ф', '2222222222', 'UA222', 1)`);
await db.run(`DELETE FROM offices`);
await db.run(`INSERT INTO offices (office_id, name, fop_id) VALUES ('22', 'Ecovent-Expert / ФОП Агафіца Д.М.', 1), ('12', 'Маркетплейси / ФОП ЛУПУ В.Ф.', 2), ('28', 'ТОВ «ЕКОВЕНТ-ДИСТРИБ’ЮШН»', 3), ('30', 'ФОП Ватрич', 4)`);
await db.run(`INSERT INTO np_accounts (id, name, api_key, active, created_at) VALUES (1, 'НП', 'npk', 1, '')`);
await db.run(`INSERT INTO rz_accounts (id, name, username, password) VALUES (1, 'Ековент', 'u', 'p')`);
await raw.run(`INSERT INTO crm_products (product_id, name, code) VALUES (697, 'Тепловентилятор DREO [80173]', '80173'), (698, 'Осушувач [30499]', '30499'), (699, 'Осушувач HUMIX DUO [31599]', '31599')`);
await db.run(`INSERT INTO prom_accounts (id, name, token, active) VALUES (1, 'Prom Amsterdam', 'ptok', 1)`);
for (const [id, ttn] of [['p11', '2045 0000 0000 11'], ['p12', 'PRM-0000012'], ['p13', 'PRM-0000013'], ['p14', '20450000000014'], ['p21', '20450000000021']]) {
  await db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, total, ttn) VALUES ('prom', 1, ?, ?, ?, 0, ?)`, [id, id, `${D} 09:00:00`, ttn]);
}
await db.run(`INSERT INTO odb_accounts (id, iban, code, alias, kind, enabled) VALUES ('a2', 'UA222', '2222222222', 'Лупу', 'fop', 1)`);
await db.run(`INSERT INTO odb_tx (id, date, amount, purpose, iban, payer_name, payer_code, our_code) VALUES ('t1', ?, 700, 'Оплата за товар, Коваль', 'UA222', 'Коваль Ольга', '', '2222222222')`, [`${D}T09:00:00`]);

// Замовлення LP-CRM
const O = (id, payment, total, ttn, extra = {}) => ({ id: String(id), order_id: `17900000000${id}`, datetime: `${D} 10:00:00`, status: '14', office: '22', payment: String(payment), total: String(total), ttn, phone: `38050${id}`, bayer_name: `Покупець ${id}`, comment: '', products: [{ name: 'T', price: String(total), quantity: '1' }], ...extra });
const ORDERS = [
  O(10001, 16, 1000, '20450000000001', { status: '18' }), // післяплата NovaPay, наложка 1000, чек з № замовлення — усе гаразд
  O(10002, 14, 500, '20450000000002', { office: '12' }), // RozetkaPay, а в ТТН контроль оплати
  O(10003, 16, 800, '20450000000003', { check_uuid: 'aaaaaaaa-0000-4000-8000-000000000003' }), // післяплата без наложки; чек у LP-CRM прив'язано, але каса не підключена
  O(10015, 14, 1500, '20450000000015', { office: '12', fiscal: { id: 'bbbbbbbb-0000-4000-8000-000000000015' } }), // чек з LP-CRM — давній, береться за номером
  O(10004, 2, 700, '20450000000004', { bayer_name: 'Коваль Ольга' }), // на рахунок: гроші на ФОП 2, а чек ФОП 1 (за сумою)
  O(10005, 4, 1000, '20450000000005', { comment: 'Передоплата 300 грн на картку' }), // часткова: наложка 700
  O(10006, 15, 1200, 'RMP-100000006', { office: '12' }), // післяплата Розетки, а в ROZETKA Delivery наложки немає
  O(10007, 6, 450, '20450000000007', { office: '12' }), // на картку, у чеку «Готівка», чек на ФОП 1 замість 2
  O(10008, 14, 999, '20450000000008', { phone: '380509999999', office: '12' }), // дубль за телефоном з 10009
  O(10009, 14, 999, '20450000000009', { phone: '380509999999', office: '12' }),
  O(10010, 14, 300, '2045 0000 000002', { office: '12' }), // та сама ТТН, що в 10002
  // Prom: замовлення з тією самою ТТН — оплата через API Prom
  O(10016, 16, 2989, '20450000000016', { office: '28' }), // каса ТОВ не підключена — чек не вимагаємо
  O(10017, 4, 1000, '20450000000017', { prepayment: '200.00' }), // передоплата з поля LP-CRM: наложка 800
  O(10018, 14, 990, '20450000000018', { office: '30' }), // каса Ватрич не пускає — чек не вимагаємо
  O(10019, 1, 800, '20450000000019', { office: '12', additional_1: 'Riteil(Rozetka)' }), // рітейл Розетки: наложку ставить Розетка
  O(10020, 0, 500, '20450000000020', { office: '12', comment: 'Замовлення 58947987\r\nна суму 500 грн\r\nоплата через моно банк' }), // вид оплати не вказано; звичайний автокоментар
  O(10022, 14, 710, '20450000000022', { office: '11' }), // відділ 11 — лише у вимкненій касі: чек від неї
  O(10023, 14, 720, '20450000000023', { office: '22' }), // відділ 22: чек від вимкненої каси того ж відділу — теж правильно
  // Однакові замовлення (той самий товар і сума): чеки без № замовлення — зіставлення за товаром і часом, по черзі
  O(10024, 14, 3174, '20450000000024', { office: '12', datetime: `${D} 09:00:00`, products: [{ product_id: '697', name: 'Тепловентилятор', price: '3174', quantity: '1' }] }),
  O(10025, 14, 3174, '20450000000025', { office: '12', datetime: `${D} 11:00:00`, products: [{ product_id: '697', name: 'Тепловентилятор', price: '3174', quantity: '1' }] }),
  // Однакові товар і сума, різні види оплати: чек підбирається з правильним способом оплати, навіть якщо інший чек раніший
  O(10026, 16, 4100, '20450000000026', { office: '12', datetime: `${D} 08:00:00`, products: [{ product_id: '698', name: 'Осушувач', price: '4100', quantity: '1' }] }),
  O(10027, 15, 4100, 'RMP-100000027', { office: '12', datetime: `${D} 08:30:00`, products: [{ product_id: '698', name: 'Осушувач', price: '4100', quantity: '1' }] }),
  // Сума 3799 ≈ 3800 (допуск 1 грн) не повинна «забрати» чек, що точно належить іншому замовленню
  O(10028, 15, 3799, 'RMP-100000028', { office: '12', datetime: `${D} 08:00:00`, products: [{ product_id: '699', name: 'Осушувач HUMIX', price: '3799', quantity: '1' }] }),
  O(10029, 11, 3800, '20450000000029', { office: '22', datetime: `${D} 09:00:00`, products: [{ product_id: '699', name: 'Осушувач HUMIX', price: '3800', quantity: '1' }] }),
  O(10011, 10, 610, '20450000000011', { office: '12' }), // Пром-оплата, у Prom оплачено — гаразд
  O(10012, 10, 620, 'PRM-0000012', { office: '12' }), // Пром-оплата, а в Prom «Оплата при отриманні» (Розетка Делівері з Prom)
  O(10013, 4, 630, 'PRM-0000013', { office: '12' }), // післяплата, у Prom оплата при отриманні — наложка є
  O(10014, 10, 640, '20450000000014', { office: '12' }), // Пром-оплата, у Prom ще не оплачено
  O(10021, 10, 650, '20450000000021', { office: '12' }), // Пром-оплата, у Prom «Оплатить частями» — гроші теж через Prom
];
const byCode = new Map(ORDERS.map((o) => [o.order_id, o]));
const PROM = {
  p11: { id: 11, full_price: '610', payment_option: { name: 'Пром-оплата' }, payment_data: { type: 'prosale', status: 'paid' } },
  p12: { id: 12, full_price: '620', payment_option: { name: 'Оплата при отриманні' } },
  p13: { id: 13, full_price: '630', payment_option: { name: 'Оплата при отриманні' } },
  p21: { id: 21, full_price: '650', payment_option: { name: 'Оплатить частями' } },
  p14: { id: 14, full_price: '640', payment_option: { name: 'Пром-оплата' }, payment_data: { type: 'prosale', status: 'unpaid' } },
};
const TRACK = { 20450000000029: {}, 20450000000026: { AfterpaymentOnGoodsCost: '4100' }, 20450000000024: {}, 20450000000025: {}, 20450000000023: {}, 20450000000022: {}, 20450000000021: {}, 20450000000018: {}, 20450000000019: { AfterpaymentOnGoodsCost: '1000' }, 20450000000020: {}, 20450000000016: { AfterpaymentOnGoodsCost: '2989' }, 20450000000017: { AfterpaymentOnGoodsCost: '800' }, 20450000000015: {}, 20450000000011: {}, 20450000000014: {}, 20450000000001: { AfterpaymentOnGoodsCost: '1000' }, 20450000000002: { AfterpaymentOnGoodsCost: '500' }, 20450000000003: {}, 20450000000004: {},
  20450000000005: { RedeliverySum: '700' }, 20450000000007: {}, 20450000000008: {}, 20450000000009: {} };
const RC = {
  old: [
    { id: 'o22', type: 'SELL', fiscal_date: `${D}T14:00:00+02:00`, total_sum: 71000, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора RozetkaPay', value: 71000 }], header: '1790000000010022' },
    { id: 'o23', type: 'SELL', fiscal_date: `${D}T14:05:00+02:00`, total_sum: 72000, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора RozetkaPay', value: 72000 }], header: '1790000000010023' },
  ],
  c1: [
    { id: 'h29', type: 'SELL', fiscal_date: `${D}T10:00:00+02:00`, total_sum: 380000, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора mono', value: 380000 }], goods: [{ good: { name: 'Осушувач повітря evoair HUMIX DUO (HUMIXDUO) [31599]' } }] },
    { id: 'r1', type: 'SELL', fiscal_date: `${D}T12:00:00+02:00`, total_sum: 100000, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора NovaPay', value: 100000 }], header: 'Замовлення 1790000000010001' },
    { id: 'r4', type: 'SELL', fiscal_date: `${D}T12:05:00+02:00`, total_sum: 70000, payments: [{ type: 'CASHLESS', label: 'Картка', value: 70000 }] },
    { id: 'r7', type: 'SELL', fiscal_date: `${D}T12:10:00+02:00`, total_sum: 45000, payments: [{ type: 'CASH', label: 'Готівка', value: 45000 }], footer: '10007' },
    { id: 'rx', type: 'SELL', fiscal_date: `${D}T13:00:00+02:00`, total_sum: 12345, payments: [{ type: 'CASH', label: 'Готівка', value: 12345 }] }, // без замовлення
  ],
  c2: [
    { id: 'p27', type: 'SELL', fiscal_date: `${D}T09:00:00+02:00`, total_sum: 410000, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора RozetkaPay', value: 410000 }], goods: [{ good: { name: 'Осушувач [30499]' } }] },
    { id: 'p26', type: 'SELL', fiscal_date: `${D}T09:10:00+02:00`, total_sum: 410000, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора NovaPay', value: 410000 }], goods: [{ good: { name: 'Осушувач [30499]' } }] },
    { id: 'g2', type: 'SELL', fiscal_date: `${D}T12:00:00+02:00`, total_sum: 317400, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора RozetkaPay', value: 317400 }], goods: [{ good: { code: '80173', name: 'Тепловентилятор DREO (DR-HSH-030) [80173]' } }] },
    { id: 'g1', type: 'SELL', fiscal_date: `${D}T10:00:00+02:00`, total_sum: 317400, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора RozetkaPay', value: 317400 }], goods: [{ good: { code: '', name: 'Тепловентилятор DREO (DR-HSH-030) [80173]' } }] },
    { id: 'r2', type: 'SELL', fiscal_date: `${D}T12:20:00+02:00`, total_sum: 50000, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора RozetkaPay', value: 50000 }], header: '1790000000010002' },
    { id: 'r8', type: 'SELL', fiscal_date: `${D}T12:30:00+02:00`, total_sum: 99900, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора RozetkaPay', value: 99900 }], header: '1790000000010008' },
    { id: 'r9', type: 'SELL', fiscal_date: `${D}T12:31:00+02:00`, total_sum: 99900, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора RozetkaPay', value: 99900 }], header: '1790000000010009' },
  ],
};
const calls = { lp: 0, np: 0, rz: 0, cb: 0 };
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  const j = (o) => new Response(JSON.stringify(o));
  if (u.hostname === 'ihunt.lp-crm.biz') {
    calls.lp++;
    const m = u.pathname.match(/api\/(\w+)\.html/)[1];
    const p = new URLSearchParams(opts.body);
    assert.equal(p.get('key'), 'k');
    if (m === 'getStatuses') return j({ status: 'ok', data: { 11: 'Принят', 14: 'Отправлен', 53: 'Ожидает выкупа', 18: 'Завершено', 13: 'Відмова' } });
    if (m === 'getOrdersIdByStatus') return j({ status: 'ok', data: ORDERS.filter((o) => o.status === p.get('status')).map((o) => o.order_id) });
    if (m === 'getOrdersByID') return j({ status: 'ok', data: Object.fromEntries(p.get('order_id').split(',').map((c) => [c, byCode.get(c)])) });
    return j({ status: 'ok', data: {} });
  }
  if (u.hostname === 'api.novaposhta.ua') {
    calls.np++;
    const b = JSON.parse(opts.body);
    assert.equal(b.calledMethod, 'getStatusDocuments');
    return j({ success: true, data: b.methodProperties.Documents.filter((d) => TRACK[d.DocumentNumber]).map((d) => ({ Number: d.DocumentNumber, StatusCode: '1', ...TRACK[d.DocumentNumber] })) });
  }
  if (u.hostname === 'api-seller.rozetka.com.ua') {
    calls.rz++;
    if (u.pathname === '/sites') return j({ success: true, content: { access_token: 'tok', market: { id: 1, title: 'Ековент' } } });
    if (u.pathname === '/delivery-rozetka/ttn-list') return j({ success: true, content: { models: u.searchParams.get('ttn') === 'RMP-100000006' ? [{ ttn: 'RMP-100000006', cod_amount: 0, declared_price: 1200 }] : [], _meta: { pageCount: 1 } } });
  }
  if (u.hostname === 'api.telegram.org') {
    const b = JSON.parse(opts.body || '{}');
    (calls.tg ||= []).push(b);
    return j({ ok: true, result: { message_id: 1 } });
  }
  if (u.hostname === 'my.prom.ua') {
    calls.prom = (calls.prom || 0) + 1;
    assert.equal(opts.headers.Authorization, 'Bearer ptok');
    const id = decodeURIComponent(u.pathname.split('/').pop());
    return PROM[id] ? j({ order: PROM[id] }) : new Response('{}', { status: 404 });
  }
  if (u.hostname === 'api.checkbox.ua') {
    calls.cb++;
    if (u.pathname.endsWith('/cashier/me')) {
      const who = String(opts.headers.Authorization).replace('Bearer t-', '');
      const org = { c1: { title: 'ФОП Агафіца Д.М.', edrpou: '1111111111' }, c2: { title: 'ФОП Лупу В.Ф.', edrpou: '2222222222' } }[who];
      return j({ full_name: 'Касир', organization: org });
    }
    if (u.pathname.endsWith('/cashier/signin')) {
      const login = JSON.parse(opts.body).login;
      if (login === 'bad') { calls.bad = (calls.bad || 0) + 1; return new Response(JSON.stringify({ message: 'Невірний логін або пароль' }), { status: 403 }); }
      return j({ access_token: `t-${login}` });
    }
    const one = u.pathname.match(/\/receipts\/([0-9a-f-]{36})$/);
    if (one) {
      const who = String(opts.headers.Authorization).replace('Bearer t-', '');
      if (who === 'c2' && one[1] === 'bbbbbbbb-0000-4000-8000-000000000015') return j({ id: one[1], type: 'SELL', fiscal_date: `${dayAgo(30)}T10:00:00+02:00`, total_sum: 150000, payments: [{ type: 'CASHLESS', label: 'Платіж через інтегратора RozetkaPay', value: 150000 }] });
      return new Response(JSON.stringify({ message: 'Not found' }), { status: 404 });
    }
    if (u.pathname.endsWith('/receipts/search')) {
      const who = String(opts.headers.Authorization).replace('Bearer t-', '');
      const from = u.searchParams.get('from_date'); const to = u.searchParams.get('to_date');
      const list = (RC[who] || []).filter((r) => new Date(r.fiscal_date).toISOString() >= from && new Date(r.fiscal_date).toISOString() < to);
      return j({ results: Number(u.searchParams.get('offset')) ? [] : list });
    }
  }
  return new Response('{}', { status: 404 });
};
const mk = () => createApp({ db, fetchFn, maxSubrequests: 40 });
const call = async (m, path, body, cookie) => {
  const r = await mk().request(path, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { r, j: await r.json().catch(() => null) };
};
const H = (await call('POST', '/api/auth/setup', { login: 'o', password: 'secret123' })).r.headers.get('set-cookie').split(';')[0];

// Каси Checkbox («Перевірка → Налаштування»): як у модулі LP-CRM — назва, логін, відділи; пароль вносить людина.
const K = async (b) => (await call('POST', '/api/checks/cashiers', b, H)).j;
const k1 = await K({ name: 'ФОП АГАФІЦА Д.М.', login: 'c1', password: 'p', offices: ['22'] });
const k2 = await K({ name: 'ФОП ЛУПУ В.Ф.', login: 'c2', password: 'p', offices: '12' });
const k2b = await K({ name: 'ФОП ЛУПУ В.Ф. (друга каса)', login: 'c2b', offices: ['12'], lp_active: false }); // без пароля, вимкнена в LP-CRM
await K({ name: 'ФОП Стара каса', login: 'old', password: 'p', offices: ['11', '22'], lp_active: false }); // вимкнена в LP-CRM — теж каса відділів 11 і 22
await K({ name: 'ТОВ Ековент-Дистрибюшн', login: 'tov', offices: ['28'] }); // без пароля
await K({ name: 'ФОП Ватрич Л.Д.', login: 'bad', password: 'x', offices: ['30'] }); // невірний пароль
assert.equal(k1.has_password, true); assert.equal(k1.password, undefined, 'пароль назовні не віддаємо');
assert.deepEqual(k2.offices, ['12']); assert.equal(k2b.ready, false);
// Перевірити вхід — Checkbox каже, чия каса (організація, ІПН)
const t1 = (await call('POST', `/api/checks/cashiers/${k1.id}/test`, {}, H)).j;
assert.equal(t1.org_title, 'ФОП Агафіца Д.М.'); assert.equal(t1.org_code, '1111111111');
await call('POST', `/api/checks/cashiers/${k2.id}/test`, {}, H);
// Порожній пароль під час редагування — пароль не змінюється
await call('PUT', `/api/checks/cashiers/${k1.id}`, { name: 'ФОП АГАФІЦА Д.М.', login: 'c1', password: '' }, H);
assert.equal((await db.get(`SELECT password FROM chk_cashiers WHERE id = ?`, [k1.id])).password, 'p');
assert.equal((await call('GET', '/api/checks/cashiers', null, H)).j.length, 6);

// Збір: кнопка «Оновити зараз» — кроками, доки more = false.
let steps = 0;
let maxDb = 0;
for (let more = true; more && steps < 30; steps++) {
  dbn = 0;
  const r = await call('POST', '/api/checks/refresh', {}, H);
  maxDb = Math.max(maxDb, dbn);
  assert.equal(r.r.status, 200, JSON.stringify(r.j));
  more = r.j.more;
}
assert.ok(maxDb <= 50, `звернень до бази за крок: ${maxDb}`); // разом із погодинною чисткою інших модулів на першому запиті
assert.ok(steps < 30, 'збір завершився');
assert.ok(calls.np >= 1 && calls.rz >= 1 && calls.cb >= 2, JSON.stringify(calls));

dbn = 0;
const { j } = await call('GET', '/api/checks', null, H);
assert.ok(dbn <= 25, `звернень до бази для сторінки: ${dbn}`);
const row = (id) => j.rows.find((r) => r.id === String(id));
const texts = (id) => row(id).items.map((i) => `${i.level}: ${i.text}`).join(' | ');
assert.equal(j.rows.length, ORDERS.length);
assert.ok(calls.prom >= 4, 'замовлення Prom прочитано');
assert.equal(row(10001).level, 'ok', texts(10001));
assert.ok(row(10001).receipt && !row(10001).receipt.bySum);
assert.equal(row(10002).level, 'bad'); assert.match(texts(10002), /RozetkaPay.*контроль оплати/);
assert.equal(row(10003).level, 'bad'); assert.match(texts(10003), /наложки немає/); assert.match(texts(10003), /warn: У LP-CRM чек прив’язано, але жодна каса з доступом його не бачить/);
assert.equal(row(10003).receipt.crmOnly, true);
assert.equal(row(10015).level, 'ok', texts(10015)); assert.match(texts(10015), /ok: Чек 1500 грн · ФОП Лупу В\.Ф\.$|ok: Чек 1500 грн · ФОП Лупу В\.Ф\. \|/);
assert.equal(row(10004).level, 'bad'); assert.match(texts(10004), /Оплата прийшла на «ФОП Лупу В\.Ф\.», а чек пробито на «ФОП Агафіца Д\.М\.»/);
assert.ok(row(10004).receipt.bySum, 'чек знайдено за сумою');
assert.match(texts(10005), /ok: Наложка 700 грн \(часткова оплата\)/);
assert.match(texts(10005), /bad: Відправлено, а чек у Checkbox не знайдено/);
assert.equal(row(10006).level, 'bad'); assert.match(texts(10006), /Післяплата Rozetka.*наложки немає/);
assert.match(texts(10007), /bad: У чеку спосіб оплати «Готівка», а для «Оплата на картку» має бути «Картка»/);
assert.match(texts(10007), /bad: Чек пробито на «ФОП Агафіца Д\.М\.», а для цього відділу каса — «ФОП Лупу В\.Ф\.»/);
assert.match(texts(10008), /Можливий дубль.*10009/);
assert.match(texts(10009), /Можливий дубль.*10008/);
assert.match(texts(10010), /bad: Та сама ТТН у замовленні № 10002/);
assert.match(texts(10002), /Та сама ТТН у замовленні № 10010/);
assert.ok(j.counts.bad >= 5);
assert.equal(row(10016).level, 'ok', texts(10016)); assert.match(texts(10016), /Чек не звіряємо: до каси «ТОВ Ековент-Дистрибюшн» немає доступу/);
assert.match(texts(10017), /ok: Наложка 800 грн \(часткова оплата\)/);
assert.deepEqual(j.no_checkbox, ['ТОВ Ековент-Дистрибюшн']);
assert.equal(row(10018).level, 'ok', texts(10018)); assert.match(texts(10018), /Чек не звіряємо: до каси «ФОП Ватрич Л\.Д\.» немає доступу/);
assert.deepEqual(j.cb_failed, ['ФОП Ватрич Л.Д. — Невірний логін або пароль']);
assert.equal(calls.bad, 1, 'з невірним паролем до Checkbox не стукаємо повторно');
assert.match(texts(10019), /info: Рітейл Розетки/); assert.doesNotMatch(texts(10019), /контроль оплати/);
assert.match(texts(10020), /warn: У замовленні не вказано вид оплати/);
assert.equal(row(10024).receipt?.id, 'g1', 'раніше замовлення — раніший чек'); assert.equal(row(10025).receipt?.id, 'g2');
assert.equal(row(10024).level, 'ok', texts(10024)); assert.equal(row(10024).receipt.bySum, false);
assert.equal(row(10026).receipt?.id, 'p26', 'NovaPay-замовлення — чек NovaPay, хоч RozetkaPay-чек раніший'); assert.equal(row(10027).receipt?.id, 'p27');
assert.doesNotMatch(texts(10026) + texts(10027), /спосіб оплати/);
assert.equal(row(10029).receipt?.id, 'h29', 'чек на 3800 — замовленню на 3800, а не раніше створеному на 3799');
assert.ok(!row(10028).receipt || row(10028).receipt.id !== 'h29');
// Результат не залежить від обраного періоду
const one = (await call('GET', `/api/checks?from=${D}&to=${D}`, null, H)).j.rows.find((r) => r.id === '10029');
assert.equal(one.receipt?.id, 'h29');
assert.equal(row(10022).level, 'ok', texts(10022)); assert.match(texts(10022), /ok: Чек 710 грн · ФОП Стара каса/);
assert.equal(row(10023).level, 'ok', texts(10023)); assert.doesNotMatch(texts(10023), /для цього відділу каса/, 'чек від вимкненої каси відділу — правильний');
assert.doesNotMatch(texts(10020), /Коментар/, 'звичайний «оплата через …» — без попередження');
assert.match(texts(10005), /warn: Коментар про особливу оплату — звірте вручну: «Передоплата 300 грн на картку»/);
// Prom
assert.match(texts(10011), /ok: Prom: Пром-оплата · оплачено/);
assert.match(texts(10011), /ok: Наложки немає/);
assert.match(texts(10012), /bad: Оплата «Пром-оплата», а в Prom — «Оплата при отриманні» \(наложка 620 грн\)/);
assert.match(texts(10012), /bad: У CRM «Пром-оплата», а в Prom спосіб оплати «Оплата при отриманні»/);
assert.match(texts(10013), /ok: Наложка 630 грн · оплата при отриманні \(Prom\)/);
assert.match(texts(10014), /bad: Пром-оплата в Prom ще не надійшла/);
assert.match(texts(10021), /ok: Prom: Оплатить частями · через Prom/); assert.doesNotMatch(texts(10021), /спосіб оплати/);
assert.equal(row(10011).mp_pay, 'Пром-оплата');

// Чеки за день по ФОП: чек без замовлення видно окремо.
const rc = (await call('GET', `/api/checks/receipts?day=${D}`, null, H)).j;
const g1 = rc.groups.find((g) => g.fop === 'ФОП Агафіца Д.М.');
assert.equal(g1.rows.length, 5); // r1, r4, r7, rx + h29
assert.equal(g1.free, 1);
assert.equal(g1.rows.find((r) => r.id === 'rx').order, null);
assert.equal(g1.rows.find((r) => r.id === 'r1').order.id, '10001');

// Рішення людини: ✓ «усе добре» — помилка більше не рахується; ✕ «не зважати»; «Скасувати» — повертає як було.
const code2 = row(10002).code;
assert.equal(row(10002).level, 'bad');
await call('PUT', `/api/checks/orders/${code2}/mark`, { mark: 'ok' }, H);
let r2 = (await call('GET', '/api/checks', null, H)).j.rows.find((r) => r.id === '10002');
assert.equal(r2.level, 'ok'); assert.equal(r2.check_level, 'bad'); assert.equal(r2.mark.mark, 'ok'); assert.equal(r2.mark.who, 'o');
await call('PUT', `/api/checks/orders/${code2}/mark`, { mark: 'skip' }, H);
assert.equal((await call('GET', '/api/checks', null, H)).j.rows.find((r) => r.id === '10002').level, 'skip');
await call('PUT', `/api/checks/orders/${code2}/mark`, { mark: '' }, H);
assert.equal((await call('GET', '/api/checks', null, H)).j.rows.find((r) => r.id === '10002').level, 'bad');
// ! — у групу «Маркетплейс»: спершу треба підключити групу
await raw.batch([['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_secret', 'sec'], ['tg_hook_v', '2']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]));
assert.equal((await call('POST', `/api/checks/orders/${code2}/send`, {}, H)).r.status, 400, 'група ще не підключена');
const tgCode = (await call('POST', '/api/checks/tg/code', {}, H)).j.code;
const hook = (message) => mk().request('/api/tg/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'sec' }, body: JSON.stringify({ message }) });
await hook({ chat: { id: -100777, type: 'supergroup', title: 'Маркетплейс' }, from: { id: 5 }, text: `/link ${tgCode}` });
assert.ok(calls.tg.some((m) => /Перевірки/.test(m.text || '')), 'бот підтвердив підключення групи');
const tgs = (await call('GET', '/api/checks/tg', null, H)).j;
assert.equal(tgs.linked, true); assert.equal(tgs.title, 'Маркетплейс');
calls.tg = [];
assert.equal((await call('POST', `/api/checks/orders/${code2}/send`, {}, H)).r.status, 200);
assert.equal(calls.tg.length, 1); assert.equal(String(calls.tg[0].chat_id), '-100777');
assert.match(calls.tg[0].text, /№ 10002/); assert.match(calls.tg[0].text, /❌ Оплата «RozetkaPay», а в ТТН стоїть контроль оплати/);
r2 = (await call('GET', '/api/checks', null, H)).j.rows.find((r) => r.id === '10002');
assert.equal(r2.level, 'bad', 'надіслано — проблема лишається видимою'); assert.ok(r2.mark.sent_at); assert.equal(r2.mark.sent_by, 'o');
assert.equal((await call('PUT', `/api/checks/orders/${code2}/mark`, { mark: 'bad' }, H)).r.status, 400);

// Види оплат: «Післяплата NovaPay» → не перевіряти — замовлення 10003 більше не помилка.
const pay = (await call('GET', '/api/checks/pay', null, H)).j;
assert.equal(pay.rows.find((r) => r.id === '16').cls, 'cod');
const rows = pay.rows.map((r) => (r.id === '16' ? { ...r, cls: 'skip' } : r));
assert.equal((await call('PUT', '/api/checks/pay', { rows }, H)).r.status, 200);
assert.deepEqual(Object.keys(JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'chk_pay'`)).value)), ['16'], 'зберігаємо лише відмінності');
assert.equal((await call('GET', '/api/checks', null, H)).j.rows.find((r) => r.id === '10003').level, 'skip');

// Повторний збір одразу — нічого не перечитує (дані свіжі), а замовлення без змін LP-CRM повторно не віддає повністю.
const before = { ...calls };
await call('POST', '/api/checks/refresh', {}, H);
assert.equal(calls.np, before.np, 'наложку НП не перечитуємо частіше ніж раз на 12 год');

// Замовлення вийшло зі статусів перевірки (напр. «Відмова») — після наступного проходу не показуємо.
await db.run(`UPDATE settings SET value = '{}' WHERE key = 'chk_state'`);
ORDERS.find((o) => o.id === '10009').status = '13';
for (let more = true, n = 0; more && n < 10; n++) more = (await call('POST', '/api/checks/refresh', {}, H)).j.more;
assert.equal((await call('GET', '/api/checks', null, H)).j.rows.find((r) => r.id === '10009'), undefined);

// Фонова задача зареєстрована
const jobs = (await call('GET', '/api/jobs', null, H)).j;
assert.ok(jobs.tasks.some((t) => t.name === 'checks'));

// Доступ: менеджер не бачить
await call('POST', '/api/users', { login: 'm1', password: 'pass1234', role: 'manager' }, H);
const M = (await call('POST', '/api/auth/login', { login: 'm1', password: 'pass1234' })).r.headers.get('set-cookie').split(';')[0];
assert.equal((await call('GET', '/api/checks', null, M)).r.status, 403);

globalThis.setTimeout = st0;
console.log('OK — перевірка оплат, наложки й чеків');
