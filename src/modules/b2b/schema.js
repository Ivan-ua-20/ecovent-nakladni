// Схема модуля «B2B партнери»: партнери, бренди й маржа, каталог з цінами з LP-CRM, журнали змін цін і маржі.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'b2b',
  version: 1,
  tables: [
  `CREATE TABLE IF NOT EXISTS b2b_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    note TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  )`,
  // Увімкнений партнеру бренд і його маржа (%). Немає рядка — бренд партнер не бачить.
  `CREATE TABLE IF NOT EXISTS b2b_margins (
    partner_id INTEGER NOT NULL,
    brand_id INTEGER NOT NULL,
    margin REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (partner_id, brand_id)
  )`,
  // Каталог: товари LP-CRM з РРЦ і фото (оновлюється з CRM; бренд — як в аналітиці).
  `CREATE TABLE IF NOT EXISTS b2b_catalog (
    product_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    article TEXT DEFAULT '',
    rrp REAL NOT NULL DEFAULT 0,
    image TEXT DEFAULT '',
    brand_id INTEGER NOT NULL DEFAULT 0,
    manual INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS b2b_catalog_brand ON b2b_catalog (brand_id)`,
  `CREATE INDEX IF NOT EXISTS b2b_catalog_checked ON b2b_catalog (checked_at)`,
  // Зміни РРЦ і маржі — для сповіщень партнерам «змінилися ціни».
  `CREATE TABLE IF NOT EXISTS b2b_price_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    old_rrp REAL,
    new_rrp REAL
  )`,
  `CREATE TABLE IF NOT EXISTS b2b_margin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    partner_id INTEGER NOT NULL,
    brand_id INTEGER NOT NULL,
    old_margin REAL,
    new_margin REAL
  )`,
  `CREATE INDEX IF NOT EXISTS b2b_price_log_at ON b2b_price_log (at)`,
  `CREATE INDEX IF NOT EXISTS b2b_margin_log_p ON b2b_margin_log (partner_id, at)`,
  ],
  columns: [],
};
