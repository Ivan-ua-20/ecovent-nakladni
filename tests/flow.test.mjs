// Перевірка ланцюжка: LP-CRM → нормалізація → чек Checkbox → вибір ФОП → історія (з підробленими відповідями API).
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/core/schema.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
await db.run(`UPDATE settings SET value = 'testkey' WHERE key = 'lpcrm_key'`);

const calls = [];
let receiptOwner = 'lupu'; // який акаунт Checkbox «має» чек
const fetchFn = async (url, opts = {}) => {
  calls.push(url);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
  const ORDER = (code) => ({ id: '777', order_id: code, office: '25', datetime: '2026-10-10 12:00:00', bayer_name: 'Іван Тест', phone: '380501112233',
    payment: '0', delivery_id: '3', additional_1: globalThis.CH || '', total: '2000.00', products: [{ product_id: '7', price: '1000.00', quantity: '2' }] });
  if (url.includes('getOrdersByID')) {
    const ids = new URLSearchParams(opts.body).get('order_id').split(',');
    if (ids[0] === '404') return json({ status: 'error', message: 'Order not found' });
    const data = {};
    for (const id of ids) data[id] = id === '14491491451' ? ORDER(id) : [];
    if (ids.length === 1 && data[ids[0]].order_id) return json({ status: 'ok', data: data[ids[0]] });
    return json({ status: 'ok', data });
  }
  if (url.includes('getStatuses')) return json({ status: 'ok', data: { 3: 'Новий', 11: 'Прийнято' } });
  if (url.includes('getOrdersIdByStatus')) {
    const st = new URLSearchParams(opts.body).get('status');
    return json({ status: 'ok', data: st === '11' ? ['14491491451', '14491491452'] : [] });
  }
  if (url.includes('getProduct')) return json({ status: 'ok', data: { id: 7, name: 'Вентилятор X', vendor: 'VX-1', price: '1000.00' } });
  if (url.includes('/cashier/signin')) {
    const b = JSON.parse(opts.body);
    return json({ access_token: 'tok-' + b.login });
  }
  if (url.includes('/receipts/search')) {
    const token = opts.headers.Authorization;
    const mine = token === 'Bearer tok-' + receiptOwner;
    return json({ results: mine ? [{ id: '11111111-2222-3333-4444-555555555555', fiscal_code: 'FC-1', total_sum: 200000, header: 'Замовлення 777', goods: [] }] : [] });
  }
  return json({ message: 'unexpected ' + url }, 500);
};

const app = createApp({ db, fetchFn });
const setup = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Власник' }), headers: { 'Content-Type': 'application/json' } });
const cookie = setup.headers.get('set-cookie').split(';')[0];
const H = { 'Content-Type': 'application/json', Cookie: cookie };
const get = async (p) => (await app.request(p, { headers: H })).json();
const put = async (p, b) => (await app.request(p, { method: 'PUT', body: JSON.stringify(b), headers: H })).json();

// 1. Без Checkbox: ФОП за відділом 25 → Агафіца Д.М.
let inv = await get('/api/invoice/14491491451');
assert.equal(inv.order.items[0].qty, 2);
assert.equal(inv.order.payment, '', 'числовий код оплати не показується');
inv = await get('/api/invoice/777');
assert.equal(inv.order.orderId, '777', 'номер накладної = короткий номер');
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
assert.equal(inv.order.invoiceDate, today, 'дата накладної = сьогодні');
assert.equal(inv.crmOrder.date, '2026-10-10 12:00:00', 'дата замовлення збережена окремо');
assert.equal((await get('/api/bootstrap')).fops.find((f) => f.short_name === 'ФОП Лупу В.Ф.').full_name, 'Лупу Віра Філаретівна');
assert.equal(inv.crmCode, '14491491451');
assert.equal(inv.order.items[0].name, 'Вентилятор X', 'назва товару підтягнута через getProduct');
assert.equal(inv.order.items[0].article, 'VX-1');
assert.equal(inv.order.total, 2000);
assert.equal(inv.fopSource, 'office');
assert.equal(inv.fop.short_name, 'ФОП Агафіца Д.М.');
assert.equal(inv.versionsCount, 1);
const byPhone = await get('/api/invoice/0501112233');
assert.equal(byPhone.crmCode, '14491491451', 'пошук за телефоном');

// 2. Додаємо доступи Checkbox двом ФОПам, вмикаємо автопошук; чек належить Лупу В.Ф.
const fops = (await get('/api/bootstrap')).fops;
const lupu = fops.find((f) => f.short_name === 'ФОП Лупу В.Ф.');
const agdm = fops.find((f) => f.short_name === 'ФОП Агафіца Д.М.');
await put(`/api/fops/${lupu.id}`, { checkbox_login: 'lupu', checkbox_password: 'x' });
await put(`/api/fops/${agdm.id}`, { checkbox_login: 'agdm', checkbox_password: 'x' });
await put('/api/settings', { checkbox_enabled: '1' });
inv = await get('/api/invoice/777');
assert.equal(inv.fopSource, 'receipt');
assert.equal(inv.fop.short_name, 'ФОП Лупу В.Ф.');
assert.equal(inv.receipt.match, 'order');
assert.ok(inv.warnings.some((w) => w.includes('За відділом мав би бути')), 'попередження про розбіжність');
assert.equal(inv.fop.checkbox_password, undefined, 'доступи не потрапляють у накладну');
assert.equal(inv.versionsCount, 2, 'зміна ФОП зафіксована в історії');

// 3. Ручний вибір має пріоритет, повернення до автоматичного
await put('/api/invoice/777/prefs', { fop_id: agdm.id, reason: 'тест' });
inv = await get('/api/invoice/777');
assert.equal(inv.fopSource, 'manual');
assert.equal(inv.fop.id, agdm.id);
await put('/api/invoice/777/prefs', { fop_id: null });
inv = await get('/api/invoice/777');
assert.equal(inv.fopSource, 'receipt');

// 4. Правки даних
await put('/api/invoice/777/prefs', { edits: { items: [{ name: 'Інший товар', qty: 3, price: 10 }] } });
inv = await get('/api/invoice/777');
assert.equal(inv.order.total, 30);
assert.equal(inv.crmOrder.total, 2000);

// 5. Помилка LP-CRM повертається зрозуміло
const r = await app.request('/api/invoice/99999', { headers: H });
assert.equal(r.status, 500);
assert.match((await r.json()).error, /не знайдено серед замовлень/);

// 6. Історія
const hist = await get('/api/history');
assert.equal(hist[0].order_id, '777');
assert.ok(hist[0].versions >= 4);
const pub = (await get('/api/bootstrap')).fops.find((f) => f.id === lupu.id);
assert.equal(pub.checkbox_password, '••••••', 'пароль замасковано');
// 7. Поле 1: Rozetka(oneday) → ФОП Лупу В.Ф. (вищий пріоритет за відділ)
await put('/api/settings', { checkbox_enabled: '0' });
globalThis.CH = 'rozetka(ONEDAY)';
await put('/api/invoice/777/prefs', { edits: null });
inv = await get('/api/invoice/777?fresh=1');
assert.equal(inv.order.channel, 'rozetka(ONEDAY)');
assert.equal(inv.fopSource, 'channel');
assert.equal(inv.fop.short_name, 'ФОП Лупу В.Ф.');
const chs = (await get('/api/bootstrap')).channels.map((c) => c.name);
assert.ok(chs.includes('Prom(Amsterdam)') && !chs.includes('Інстаграм'), 'канали засіяно з відділів');
// 8. Своя назва продавця для поля 1
const lupuId = (await get('/api/bootstrap')).fops.find((f) => f.short_name === 'ФОП Лупу В.Ф.').id;
await put('/api/channels', [{ name: 'Rozetka(oneday)', fop_id: lupuId, seller_text: 'ФОП Лупу Віра Федорівна\nІнтернет-магазин OneDay' }]);
inv = await get('/api/invoice/777');
assert.equal(inv.sellerText, 'ФОП Лупу Віра Федорівна\nІнтернет-магазин OneDay');
// Якщо ФОП змінено вручну на іншого — назва з поля 1 не підставляється
await put('/api/invoice/777/prefs', { fop_id: agdm.id });
inv = await get('/api/invoice/777');
assert.equal(inv.sellerText, '');
console.log('OK — усі перевірки пройдено');
