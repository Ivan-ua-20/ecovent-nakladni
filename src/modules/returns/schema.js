// Схема модуля «Повернення»: реєстр вихідних відправлень з усіх джерел (одна ТТН — один рядок) і повернення
// (одна посилка — одне повернення). version — підвищуйте при зміні схеми модуля.

export const schema = {
  name: 'returns',
  version: 1,
  tables: [
  // Вихідні відправлення (поки Нова пошта): з кабінетів НП, Розетки-постачальника, маркетплейсів, LP-CRM — за номером ТТН без дублів.
  // final = 1 — далі не відстежуємо (отримано клієнтом, видалено або вже знайдено ЕН повернення).
  `CREATE TABLE IF NOT EXISTS ret_ships (
    ttn TEXT PRIMARY KEY,
    account_id INTEGER,
    day TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    customer TEXT DEFAULT '',
    code INTEGER DEFAULT 0,
    status TEXT DEFAULT '',
    final INTEGER DEFAULT 0,
    checked_at TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS ret_ships_todo ON ret_ships (final, day)`,
  // Повернення: початкова ТТН (ключ), ЕН повернення (унікальна), причина (refused — відмова, storage — закінчився строк зберігання),
  // стан (nottn — ЕН повернення ще немає, transit — в дорозі до нас, branch — у відділенні, got — отримано), дані відстеження НП.
  `CREATE TABLE IF NOT EXISTS ret_items (
    orig_ttn TEXT PRIMARY KEY,
    ret_ttn TEXT DEFAULT '',
    carrier TEXT DEFAULT 'np',
    reason TEXT DEFAULT '',
    state TEXT DEFAULT 'nottn',
    account_id INTEGER,
    customer TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    cargo TEXT DEFAULT '',
    cost REAL DEFAULT 0,
    cod REAL DEFAULT 0,
    refused_at TEXT DEFAULT '',
    ret_code INTEGER DEFAULT 0,
    ret_status TEXT DEFAULT '',
    to_name TEXT DEFAULT '',
    to_phone TEXT DEFAULT '',
    city TEXT DEFAULT '',
    warehouse TEXT DEFAULT '',
    arrived_at TEXT DEFAULT '',
    paid_from TEXT DEFAULT '',
    storage REAL DEFAULT 0,
    got_at TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    checked_at TEXT DEFAULT ''
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ret_items_ret ON ret_items (ret_ttn) WHERE ret_ttn != ''`,
  `CREATE INDEX IF NOT EXISTS ret_items_state ON ret_items (state, created_at)`,
  ],
  columns: [],
};
