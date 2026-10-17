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
const perms = ['docs.view', 'docs.edit', 'refs.edit', 'requisites', 'api', 'users', 'analytics', 'an.view'];
const user = { id: 1, login: 'o', name: 'O', role: 'owner', role_name: 'Власник', perms, crm_logins: [] };
const BOOT = { fops: [{ id: 1, short_name: 'ФОП', active: 1, template_id: 1 }], templates: [{ id: 1, name: 'T', layout: 'classic', options: {} }], offices: [], channels: [], invFops: [{ id: 1, short_name: 'ФОП Р', active: 1 }], settings: {}, user, defaultWarning: '' };
const errors = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  const body = u.startsWith('/api/auth/state') ? { needsSetup: false, user } : u.startsWith('/api/bootstrap') ? BOOT
    : u.startsWith('/api/users') ? { users: [user], roles: {} } : u.startsWith('/api/rahunky') ? { rows: [], nextNumber: '1', retentionDays: 7 }
      : u.startsWith('/api/history') || u.includes('/versions') || u.startsWith('/api/audit') ? [] : {};
  return { status: 200, ok: true, json: async () => body };
};
process.on('unhandledRejection', (e) => errors.push(e));
await import(new URL('../public/app.js', import.meta.url));
await new Promise((r) => setTimeout(r, 30));
const routes = ['invoice', 'history', 'fops', 'fops/1', 'fops/new', 'offices', 'templates', 'templates/1', 'nsettings', 'rahunky', 'rlist', 'invfops', 'invfops/1', 'invfops/new', 'rsettings', 'settings', 'users'];
for (const r of routes) {
  location.hash = `#/${r}`;
  mainHtml = '';
  try { await handlers.hashchange?.(); } catch (e) { errors.push(new Error(`${r}: ${e.message}`)); }
  const m = /<div class="alert bad">([^<]*)/.exec(mainHtml);
  if (m) errors.push(new Error(`${r}: сторінка показала помилку «${m[1]}»`));
  await new Promise((res) => setTimeout(res, 5));
}
if (errors.length) { console.log('ПОМИЛКИ:\n' + errors.map((e) => e.stack?.split('\n').slice(0, 2).join(' | ') || e).join('\n')); process.exit(1); }
console.log(`OK — модулі завантажено, відкрито ${routes.length} сторінок`);
