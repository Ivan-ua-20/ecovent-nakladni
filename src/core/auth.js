// Акаунти і ролі. Паролі — PBKDF2-SHA256 (WebCrypto), працює і в Node.js, і в Cloudflare Workers.

export const ROLES = {
  owner: 'Власник',
  admin: 'Адміністратор',
  admin_lite: 'Адміністратор (без керування людьми)',
  manager: 'Менеджер',
  viewer: 'Перегляд',
  partner: 'Партнер (B2B)',
};

// Права:
//  docs.view  — відкривати накладні й рахунки, історію, друкувати, завантажувати
//  docs.edit  — формувати й змінювати накладні та рахунки
//  refs.edit  — довідники (ФОПи, відділи, шаблони, ФОПи рахунків) і загальні налаштування
//  api        — ключі LP-CRM / Checkbox, діагностика API
//  users      — адміністративні дії (журнал змін, журнал помилок, ФОПи рахунків, експорт/імпорт…)
//  people     — керування людьми: користувачі сайту й користувачі партнерів (додати, змінити, видалити), видалення партнерів
//  requisites — реквізити ФОП (IBAN, ІПН, ПІБ, адреса, підпис, печатка); зміни пишуться в журнал
//  analytics  — розділ «Аналітика» повністю (усі дані, таргети, налаштування)
//  an.view    — дашборд аналітики (менеджер бачить лише свої замовлення, без таргетів)
//  b2b.admin  — B2B: партнери, бренди й маржа, замовлення партнерів, рахунки й накладні до них
//  b2b.partner — кабінет партнера (лише свої дані; решта сайту недоступна)
//  b2b.order  — партнер може оформлювати й змінювати (керівник і менеджер партнера; «перегляд» — ні)
//  b2b.team   — партнер керує своєю командою (лише керівник партнера)
//  b2b.view   — B2B лише перегляд (без змін)
//  retail.view / retail.edit — «Рітейл»: перегляд / робота із замовленнями (підтвердити, ТТН, LP-CRM)
//  market.view / market.edit — «Маркетплейси»: перегляд / робота (нагадування про відгуки, чат, оновити)
//  returns.view — «Повернення»: перегляд (і кнопка «Оновити інформацію»)
const SECTION_ALL = ['b2b.admin', 'b2b.view', 'retail.view', 'retail.edit', 'market.view', 'market.edit', 'returns.view'];
const PERMS = {
  owner: ['docs.view', 'docs.edit', 'refs.edit', 'requisites', 'api', 'users', 'people', 'analytics', 'an.view', ...SECTION_ALL],
  admin: ['docs.view', 'docs.edit', 'refs.edit', 'requisites', 'api', 'users', 'people', 'analytics', 'an.view', ...SECTION_ALL],
  // Як адміністратор, але без керування людьми (аналітику вмикає/вимикає лише власник).
  admin_lite: ['docs.view', 'docs.edit', 'refs.edit', 'requisites', 'api', 'users', 'analytics', 'an.view', ...SECTION_ALL],
  manager: ['docs.view', 'docs.edit', 'refs.edit', 'an.view'],
  viewer: ['docs.view'],
  partner: ['b2b.partner'],
};
// Доступ до розділів для менеджера й перегляду (users.access, JSON; порожньо — як у ролі).
//  b2b: none | view | full;  retail, market: none | view | work;  shops: null (усі магазини маркетплейсів, і нові) або ['rozetka:1', …];
//  tg: розділи, сповіщення яких іде цьому користувачу в Telegram (як адмінам): ['b2b', 'retail'];
//      'market' — нові повідомлення покупців Розетки в його магазинах (shops), у робочий час.
// Роль «Перегляд» не отримує більше за «перегляд».
export const SECTION_LEVELS = { b2b: ['none', 'view', 'full'], retail: ['none', 'view', 'work'], market: ['none', 'view', 'work'], returns: ['none', 'view'] };
export const ACCESS_ROLES = ['manager', 'viewer'];
const TG_SECTIONS = ['b2b', 'retail', 'market'];
const ROLE_ACCESS = {
  manager: { b2b: 'none', retail: 'work', market: 'work', returns: 'view', shops: null, tg: [] },
  viewer: { b2b: 'none', retail: 'view', market: 'view', returns: 'view', shops: null, tg: [] },
};
export function accessOf(u) {
  const def = ROLE_ACCESS[u?.role];
  if (!def) return null; // власник, адміністратори, партнер — повний доступ або свій кабінет
  let a = {};
  try { a = JSON.parse(u.access || '{}') || {}; } catch { a = {}; }
  const out = { ...def };
  for (const [k, lv] of Object.entries(SECTION_LEVELS)) if (lv.includes(a[k])) out[k] = a[k];
  if (Array.isArray(a.shops)) out.shops = [...new Set(a.shops.map(String).filter((x) => /^[a-z]+:\d+$/.test(x)))];
  if (Array.isArray(a.tg)) out.tg = a.tg.filter((x) => TG_SECTIONS.includes(x));
  if (u.role === 'viewer') for (const k of Object.keys(SECTION_LEVELS)) if (out[k] !== 'none') out[k] = 'view';
  out.tg = out.tg.filter((x) => out[x] && out[x] !== 'none');
  return out;
}
// Збережене значення доступу: лише відомі ключі (для users.access).
export function cleanAccess(b) {
  if (!b || typeof b !== 'object') return null;
  const a = {};
  for (const [k, lv] of Object.entries(SECTION_LEVELS)) a[k] = lv.includes(b[k]) ? b[k] : 'none';
  a.shops = Array.isArray(b.shops) ? [...new Set(b.shops.map(String).filter((x) => /^[a-z]+:\d+$/.test(x)))].slice(0, 100) : null;
  a.tg = Array.isArray(b.tg) ? b.tg.filter((x) => TG_SECTIONS.includes(x)) : [];
  return a;
}
const sectionPerms = (a) => [
  ...(a.b2b === 'full' ? ['b2b.admin', 'b2b.view'] : a.b2b === 'view' ? ['b2b.view'] : []),
  ...(a.retail !== 'none' ? ['retail.view'] : []), ...(a.retail === 'work' ? ['retail.edit'] : []),
  ...(a.market !== 'none' ? ['market.view'] : []), ...(a.market === 'work' ? ['market.edit'] : []),
  ...(a.returns !== 'none' ? ['returns.view'] : []),
];
// Магазин маркетплейсу (mp — rozetka/prom/epicentr, id — акаунт) доступний користувачу?
export const shopAllowed = (u, mp, id) => { const a = accessOf(u); return !a || !a.shops || a.shops.includes(`${mp}:${id}`); };
const AN_PERMS = ['analytics', 'an.view'];

export const permsOf = (role) => PERMS[role] || [];
// Права конкретного користувача: роль + перемикач аналітики (an_access: 0 — вимкнено, 1 — увімкнено,
// порожньо — як у ролі). Власник завжди з аналітикою; партнерам аналітика не вмикається.
// Ролі всередині команди партнера (users.partner_role; порожньо — керівник, як у старих акаунтах).
export const PARTNER_ROLES = { head: 'Керівник', staff: 'Менеджер', viewer: 'Лише перегляд' };
export const partnerRole = (u) => (PARTNER_ROLES[u?.partner_role] ? u.partner_role : 'head');
export function permsOfUser(u) {
  if (!u) return [];
  if (u.role === 'partner') {
    const r = partnerRole(u);
    return ['b2b.partner', ...(r !== 'viewer' ? ['b2b.order'] : []), ...(r === 'head' ? ['b2b.team'] : [])];
  }
  const acc = accessOf(u);
  const base = acc ? [...permsOf(u.role), ...sectionPerms(acc)] : permsOf(u.role);
  if (u.role === 'owner' || u.role === 'partner' || u.an_access == null || u.an_access === '') return base;
  if (Number(u.an_access) === 0) return base.filter((p) => !AN_PERMS.includes(p));
  return base.includes('an.view') ? base : [...base, 'an.view'];
}
export const hasAnalytics = (u) => permsOfUser(u).includes('an.view');
export const can = (user, perm) => Boolean(user && permsOfUser(user).includes(perm));

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}

let ITER = 100000;
// На Cloudflare (ліміт процесорного часу) — менше ітерацій; збережені хеші містять свою кількість ітерацій.
export function setIterations(n) { if (n >= 1000) ITER = Math.min(n, 100000); }

async function derive(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
  return toHex(bits);
}

// Формат: pbkdf2$<ітерації>$<сіль hex>$<хеш hex>
export async function hashPassword(password) {
  const salt = fromHex(randomToken(16));
  const h = await derive(password, salt, ITER);
  return `pbkdf2$${ITER}$${toHex(salt)}$${h}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iter, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !saltHex || !hashHex) return false;
  const h = await derive(password, fromHex(saltHex), Number(iter));
  // порівняння без раннього виходу
  let diff = h.length ^ hashHex.length;
  for (let i = 0; i < Math.min(h.length, hashHex.length); i++) diff |= h.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

export const publicUser = (u) => (u ? {
  id: u.id, login: u.login, name: u.name || u.login, role: u.role, role_name: ROLES[u.role] || u.role,
  active: u.active, created_at: u.created_at, perms: permsOfUser(u), crm_logins: crmLogins(u.crm_logins),
  analytics: hasAnalytics(u), partner_id: u.partner_id || null, access: accessOf(u), access_custom: Boolean(u.access),
  ...(u.role === 'partner' ? { partner_role: partnerRole(u), partner_role_name: PARTNER_ROLES[partnerRole(u)] } : {}),
} : null);

// Логіни LP-CRM, прив'язані до акаунта (через кому).
export const crmLogins = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(','))
  .map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 20);

// Скидання пароля власника (локально — через файл RESET-OWNER.txt, на хостингу — через змінну середовища).
export async function resetOwnerPassword(db, newPassword) {
  const owner = await db.get(`SELECT id, login FROM users WHERE role = 'owner' LIMIT 1`);
  if (!owner) return null;
  await db.run(`UPDATE users SET password_hash = ?, active = 1 WHERE id = ?`, [await hashPassword(newPassword), owner.id]);
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, [owner.id]);
  return owner.login;
}
