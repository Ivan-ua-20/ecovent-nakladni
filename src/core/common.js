// Спільне для всіх модулів: помилки, права, налаштування, гроші, дати.
import { can } from './auth.js';

export const MASK = '••••••';
export const nowIso = () => new Date().toISOString();

// Помилка з HTTP-статусом (обробник у app.js віддає її клієнту як { error }).
export const fail = (status, message) => Object.assign(new Error(message), { status });
export const need = (c, perm) => {
  if (!can(c.get('user'), perm)) throw fail(403, 'Недостатньо прав для цієї дії.');
};
export const userName = (c) => c.get('user')?.name || c.get('user')?.login || '';

// ---------- налаштування (таблиця settings) ----------
export const loadSettings = async (db) => Object.fromEntries((await db.all(`SELECT key, value FROM settings`)).map((r) => [r.key, r.value]));
export const putSetting = (db, key, value) => db.run(
  `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, String(value)],
);

// ---------- гроші ----------
export const round2 = (n) => Math.round(n * 100) / 100;
// «1 234,50» → 1234.5; порожньо або не число → 0
export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

// ---------- дати (за київським часом) ----------
export const kyivDay = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(d);

// Шаблон накладної з бази: options зберігаються як JSON-рядок.
export const parseTpl = (t) => (t ? { ...t, options: JSON.parse(t.options || '{}') } : null);

// Короткий хеш рядка (FNV-1a) — для порівняння версій накладних.
export const hash = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};

// Варіанти рядка для LIKE: SQLite не зважає на регістр лише для латиниці — для кирилиці шукаємо «як є», малими й з великої.
export function likeVariants(q) {
  const raw = String(q || '').trim();
  const low = raw.toLowerCase();
  const cap = low.replace(/(^|[\s'-])(\S)/g, (m, a, b) => a + b.toUpperCase()); // «Петренко Олена»
  const first = low.charAt(0).toUpperCase() + low.slice(1); // «Тестовий партнер»
  return [...new Set([raw, low, cap, first, raw.toUpperCase()])].map((v) => `%${v}%`);
}
