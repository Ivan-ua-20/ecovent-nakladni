// Акаунти і ролі. Паролі — PBKDF2-SHA256 (WebCrypto), працює і в Node.js, і в Cloudflare Workers.

export const ROLES = {
  owner: 'Власник',
  admin: 'Адміністратор',
  manager: 'Менеджер',
  viewer: 'Перегляд',
};

// Права:
//  docs.view  — відкривати накладні й рахунки, історію, друкувати, завантажувати
//  docs.edit  — формувати й змінювати накладні та рахунки
//  refs.edit  — довідники (ФОПи, відділи, шаблони, ФОПи рахунків) і загальні налаштування
//  api        — ключі LP-CRM / Checkbox, діагностика API
//  users      — керування користувачами
//  analytics  — розділ «Аналітика»
const PERMS = {
  owner: ['docs.view', 'docs.edit', 'refs.edit', 'api', 'users', 'analytics'],
  admin: ['docs.view', 'docs.edit', 'refs.edit', 'api', 'users', 'analytics'],
  manager: ['docs.view', 'docs.edit', 'refs.edit'],
  viewer: ['docs.view'],
};

export const permsOf = (role) => PERMS[role] || [];
export const can = (user, perm) => Boolean(user && permsOf(user.role).includes(perm));

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
  active: u.active, created_at: u.created_at, perms: permsOf(u.role),
} : null);

// Скидання пароля власника (локально — через файл RESET-OWNER.txt, на хостингу — через змінну середовища).
export async function resetOwnerPassword(db, newPassword) {
  const owner = await db.get(`SELECT id, login FROM users WHERE role = 'owner' LIMIT 1`);
  if (!owner) return null;
  await db.run(`UPDATE users SET password_hash = ?, active = 1 WHERE id = ?`, [await hashPassword(newPassword), owner.id]);
  await db.run(`DELETE FROM sessions WHERE user_id = ?`, [owner.id]);
  return owner.login;
}
