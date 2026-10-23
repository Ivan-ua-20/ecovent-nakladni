// Димовий тест інтерфейсу: модулі public/ зв'язуються, і кожна сторінка відкривається без помилок JS (DOM — заглушка, без браузера).
const el = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === 'classList' ? { add() {}, remove() {}, toggle() {}, contains: () => false }
    : k === 'querySelectorAll' ? () => [] : k === 'querySelector' || k === 'closest' ? () => el() : k === 'style' || k === 'dataset' ? {} : k === 'value' || k === 'textContent' || k === 'innerHTML' ? '' : k === 'checked' ? false : k === 'files' ? [] : el()),
  set: () => true, apply: () => el(),
});
const handlers = {};
let mainHtml = '';
const mainEl = new Proxy(el(), { set: (t, k, v) => { if (k === 'innerHTML') mainHtml = String(v); return true; }, get: (t, k) => (k === 'innerHTML' ? mainHtml : k === 'insertAdjacentHTML' ? () => {} : t[k]) });
globalThis.document = { querySelector: (s) => (s === '#main' ? mainEl : el()), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, createElement: () => el(), body: el(), contains: () => false, activeElement: null };
globalThis.window = { addEventListener: (n, f) => { handlers[n] = f; }, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), open() {}, print() {} };
globalThis.location = { hash: '' };
globalThis.FormData = class { constructor() {} entries() { return [][Symbol.iterator](); } [Symbol.iterator]() { return [][Symbol.iterator](); } get() { return null; } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
const CL = { id: 2, kind: 'client', number: 'B2B-2', status: 'new', status_name: 'Нове', supply_id: 1, supply_number: 'B2B-1', no_supply: false, pay: 'unpaid', pay_name: 'Не оплачено', client_name: 'Іван', client_phone: '380501112233', ttn: '20450000000000', crm_id: '', crm_status: '', total: 100, comment: '', invoice_no: '', invoice_date: '', waybill_no: '', paid_at: '', created_at: '2026-10-22T10:00:00Z', partner: 'P', files: 1 };
const perms = ['docs.view', 'docs.edit', 'refs.edit', 'requisites', 'api', 'users', 'analytics', 'an.view', 'b2b.admin', 'b2b.partner', 'b2b.order', 'b2b.team', 'people'];
const user = { id: 1, login: 'o', name: 'O', role: 'owner', role_name: 'Власник', perms, crm_logins: [] };
const BOOT = { fops: [{ id: 1, short_name: 'ФОП', active: 1, template_id: 1 }], templates: [{ id: 1, name: 'T', layout: 'classic', options: {} }], offices: [], channels: [], invFops: [{ id: 1, short_name: 'ФОП Р', active: 1 }], settings: {}, user, defaultWarning: '' };
const errors = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  const body = u.startsWith('/api/auth/state') ? { needsSetup: false, user } : u.startsWith('/api/bootstrap') ? BOOT
    : u.startsWith('/api/users') ? { users: [user], roles: {} } : u.startsWith('/api/rahunky') ? { rows: [], nextNumber: '1', retentionDays: 7 }
      : u.startsWith('/api/errors') ? { rows: [], sources: [], keepDays: 30 } : u === '/api/b2b/partners' ? [] : u === '/api/b2b/p/team' ? { users: [{ id: 1, login: 'a', name: 'A', active: 1, partner_role: 'head', partner_role_name: 'Керівник', added_by_partner: false, added_by_name: '', created_at: '2026-10-22T10:00:00Z' }], roles: { head: 'Керівник', staff: 'Менеджер', viewer: 'Лише перегляд' }, max: 30, me: 1 } : u.startsWith('/api/b2b/crm-settings') ? { on: false, office: '27', delivery: '', payment: '', notification: '', ttn_field: '', in_key: '', ready: true } : u === '/api/b2b/p/supplies' ? [{ id: 1, number: 'B2B-1', pay: 'unpaid', items: [{ product_id: 1, name: 'T', article: '', price: 100, qty: 3, left: 2 }] }] : u.startsWith('/api/b2b/clients') || u.startsWith('/api/b2b/p/clients?') || u === '/api/b2b/p/clients' ? { rows: [CL, { ...CL, id: 3, supply_id: null, no_supply: true }], counts: { new: 1 }, crm: false, statuses: { new: 'Нове' } } : u.startsWith('/api/b2b/p/clients/') || u === '/api/b2b/orders/2' ? { order: CL, items: [{ product_id: 1, name: 'T', article: '', qty: 1, price: 100, rrp: 120 }], files: [{ id: 5, kind: 'label', kind_name: 'Маркування', name: 'a.pdf', size: 1000, created_at: '2026-10-22T10:00:00Z' }], history: [], partner: { id: 1, name: 'P' } } : u.startsWith('/api/b2b/orders/') || u.startsWith('/api/b2b/p/orders/') ? { order: { id: 1, number: 'B2B-1', status: 'invoice_wait', status_name: 'Очікує рахунок', entity: 'ФОП Т, ІПН 1234567890', entity_id: 1, total: 100, comment: '', invoice_no: '', invoice_date: '', waybill_no: '', created_at: '2026-10-22T10:00:00Z', partner: 'P', files: 0 }, items: [{ product_id: 1, name: 'T', article: '', qty: 1, price: 100, rrp: 120 }], files: [], history: [], partner: { id: 1, name: 'P' } } : u.startsWith('/api/b2b/orders') || u.startsWith('/api/b2b/p/orders') ? { rows: [{ id: 1, number: 'B2B-1', status: 'invoice_wait', status_name: 'Очікує рахунок', entity: 'ФОП Т, ІПН 1234567890', entity_id: 1, total: 100, comment: '', invoice_no: '', invoice_date: '', waybill_no: '', created_at: '2026-10-22T10:00:00Z', partner: 'P', files: 0 }], statuses: { invoice_wait: 'Очікує рахунок' }, counts: {} } : u.startsWith('/api/b2b/p/entities') ? [{ id: 1, kind: 'fop', name: 'ФОП Т', code: '1234567890', vat: 0, iban: '', address: '' }] : u.startsWith('/api/b2b/partners/') ? { partner: { id: 1, name: 'P', active: 1 }, users: [{ id: 2, login: 'b', name: '', active: 1, partner_role: 'staff', partner_role_name: 'Менеджер', added_by_partner: true, added_by_name: 'A', created_at: '2026-10-22T10:00:00Z' }], roles: { head: 'Керівник', staff: 'Менеджер', viewer: 'Лише перегляд' }, brands: [{ id: 1, name: 'B', enabled: true, margin: 20, products: 2, priced: 1 }] } : u.startsWith('/api/b2b/catalog') ? { rows: [], state: { lastSync: '', stale: 0 } } : u.startsWith('/api/b2b/brands') ? [] : u.startsWith('/api/b2b/p/catalog') ? { partner: { id: 1, name: 'P' }, brands: [{ id: 1, name: 'B' }], products: [{ id: 1, name: 'T', article: '', image: '', brand_id: 1, brand: 'B', rrp: 100, price: 80 }] } : u.startsWith('/api/history') || u.includes('/versions') || u.startsWith('/api/audit') ? [] : {};
  return { status: 200, ok: true, json: async () => body };
};
process.on('unhandledRejection', (e) => errors.push(e));
await import(new URL('../public/app.js', import.meta.url));
await new Promise((r) => setTimeout(r, 30));
const routes = ['invoice', 'history', 'fops', 'fops/1', 'fops/new', 'offices', 'templates', 'templates/1', 'nsettings', 'rahunky', 'rlist', 'invfops', 'invfops/1', 'invfops/new', 'rsettings', 'settings', 'errors', 'users', 'b2bpartners', 'b2bpartners/1', 'b2bcatalog', 'pcatalog', 'phelp', 'b2borders', 'b2borders/1', 'porders', 'porders/new', 'porders/1', 'porders/1/edit', 'pentities', 'pclients', 'pclients/new', 'pclients/new/1', 'pclients/2', 'pclients/2/edit', 'b2bclients', 'b2bclients/2', 'pteam'];
for (const r of routes) {
  location.hash = `#/${r}`;
  mainHtml = '';
  try { await handlers.hashchange?.(); } catch (e) { errors.push(new Error(`${r}: ${e.message}`)); }
  const m = /<div class="alert bad">([^<]*)/.exec(mainHtml);
  if (m) errors.push(new Error(`${r}: сторінка показала помилку «${m[1]}»`));
  await new Promise((res) => setTimeout(res, 5));
}
// Вікно «Надіслати»: тексти й посилання месенджерів; саме вікно відкривається без помилок
{
  const { messengerLinks, sendDialog } = await import(new URL('../public/core/share.js', import.meta.url));
  const { rahunokMessage } = await import(new URL('../public/rahunok.js', import.meta.url));
  const r = { number: '107568', total: 8950, fop: { full_name: 'ФОП Ватрич Любов Дмитрівна' }, pay: { page: 'https://iban.opendatabot.ua/invoice/abc' } };
  const text = rahunokMessage(r);
  if (!/№ 107568 від ФОП Ватрич Любов Дмитрівна на суму 8\s950,00 грн\.\nОплатити онлайн: https:\/\/iban\.opendatabot\.ua\/invoice\/abc$/.test(text)) errors.push(new Error(`текст рахунку: ${text}`));
  if (/Оплатити/.test(rahunokMessage({ ...r, pay: null }))) errors.push(new Error('без QR у тексті не має бути посилання'));
  const l = messengerLinks(text, r.pay.page);
  const tg = new URL(l.telegram);
  if (tg.searchParams.get('url') !== r.pay.page || tg.searchParams.get('text').includes(r.pay.page) || !tg.searchParams.get('text').startsWith('Рахунок на оплату № 107568')) errors.push(new Error(`Telegram: ${l.telegram}`));
  if (!l.whatsapp.startsWith('https://wa.me/?text=') || !l.viber.startsWith('viber://forward?text=')) errors.push(new Error('WhatsApp / Viber'));
  try { sendDialog({ title: 'Надіслати', text, url: r.pay.page, makeFile: async () => ({ blob: new Blob(['x']), name: 'a.docx' }), download() {} }); sendDialog({ title: 'Надіслати', text }); }
  catch (e) { errors.push(new Error(`вікно «Надіслати»: ${e.message}`)); }
}

if (errors.length) { console.log('ПОМИЛКИ:\n' + errors.map((e) => e.stack?.split('\n').slice(0, 2).join(' | ') || e).join('\n')); process.exit(1); }
console.log(`OK — модулі завантажено, відкрито ${routes.length} сторінок, вікно «Надіслати» працює`);
