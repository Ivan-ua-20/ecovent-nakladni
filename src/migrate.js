// Міграції бази: кожен модуль описує свої таблиці (src/modules/<модуль>/schema.js) і має власну версію схеми
// (ключ settings «schema:<модуль>»). Міграція модуля виконується, лише якщо його версія змінилась.
//
// Дані не переносяться і не перейменовуються: CREATE IF NOT EXISTS, ALTER TABLE ADD COLUMN для нових колонок,
// початкові дані — лише в новій базі або за власними прапорцями модулів (seeded, an_seeded, an_v9…).
import { schema as core } from './core/schema.js';
import { schema as auth } from './modules/auth/schema.js';
import { schema as notify } from './modules/notify/schema.js';
import { schema as refs } from './modules/refs/schema.js';
import { schema as nakladni } from './modules/nakladni/schema.js';
import { schema as rahunky } from './modules/rahunky/schema.js';
import { schema as payments } from './modules/payments/schema.js';
import { schema as analytics } from './modules/analytics/schema.js';
import { schema as admin } from './modules/admin/schema.js';
import { schema as errlog } from './modules/errlog/schema.js';
import { schema as b2b } from './modules/b2b/schema.js';
import { schema as marking } from './modules/marking/schema.js';
import { schema as retail } from './modules/retail/schema.js';
import { schema as market } from './modules/market/schema.js';

// Порядок важливий: колонки notify додаються в users (auth), payments — в inv_fops (rahunky).
export const MODULE_SCHEMAS = [core, auth, notify, refs, nakladni, rahunky, payments, analytics, admin, errlog, b2b, marking, retail, market];

const versionKey = (m) => `schema:${m.name}`;

export async function migrate(db, modules = MODULE_SCHEMAS) {
  // Швидкий шлях — один запит: усі версії збігаються.
  let have = {};
  try {
    have = Object.fromEntries((await db.all(`SELECT key, value FROM settings WHERE key LIKE 'schema:%' OR key = 'seeded'`)).map((r) => [r.key, r.value]));
  } catch { /* таблиці settings ще немає — нова база */ }
  const todo = modules.filter((m) => have[versionKey(m)] !== String(m.version));
  if (!todo.length) return;

  // Нова база = ще не засіяна (прапорець seeded ставить модуль refs).
  const fresh = !have.seeded;
  // Таблиці всіх модулів, що мігрують, — одним пакетом (на D1 це один запит).
  await db.batch(todo.flatMap((m) => m.tables.map((sql) => [sql, []])));
  // Нові колонки для старих баз.
  const cols = todo.flatMap((m) => m.columns);
  const alters = [];
  const tables = [...new Set(cols.map((x) => x[0]))];
  // Наявні колонки всіх таблиць — одним запитом (ліміт D1 — 50 запитів на звернення); якщо не вийде — по таблиці.
  let haveCols = null;
  if (tables.length) {
    try {
      haveCols = new Set((await db.all(
        `SELECT m.name AS t, p.name AS c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(tables)],
      )).map((r) => `${r.t}.${r.c}`));
    } catch { haveCols = null; }
  }
  for (const table of tables) {
    const existing = haveCols ? new Set([...haveCols].filter((k) => k.startsWith(`${table}.`)).map((k) => k.slice(table.length + 1)))
      : new Set((await db.all(`PRAGMA table_info(${table})`)).map((r) => r.name));
    for (const [t, col, type] of cols) if (t === table && !existing.has(col)) alters.push([`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`, []]);
  }
  await db.batch(alters);
  for (const m of todo) if (m.seed) await m.seed(db, { fresh });
  await db.batch(todo.map((m) => [
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [versionKey(m), String(m.version)],
  ]));
}
