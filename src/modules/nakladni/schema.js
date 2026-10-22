// Схема модуля «Накладні»: таблиці, нові колонки для старих баз.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'nakladni',
  version: 2,
  tables: [
  `CREATE TABLE IF NOT EXISTS order_prefs (
    order_id TEXT PRIMARY KEY,
    fop_id INTEGER,
    template_id INTEGER,
    receipt_ref TEXT DEFAULT '',
    edits TEXT DEFAULT '',
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    fop_id INTEGER,
    fop_name TEXT,
    template_id INTEGER,
    total REAL,
    data_hash TEXT,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_versions_order ON versions(order_id, id)`,
  `CREATE TABLE IF NOT EXISTS orders_index (
    code TEXT PRIMARY KEY,
    datetime TEXT,
    phone TEXT,
    ttn TEXT,
    bayer_name TEXT,
    data TEXT,
    fetched_at TEXT
  )`,
  // Ключі пошуку замовлення (номер, код, ТТН, телефон «p:» + 9 цифр) — пошук читає кілька рядків, а не весь індекс.
  `CREATE TABLE IF NOT EXISTS order_keys (
    k TEXT NOT NULL,
    code TEXT NOT NULL,
    day TEXT DEFAULT '',
    PRIMARY KEY (k, code)
  )`,
  `CREATE INDEX IF NOT EXISTS order_keys_day ON order_keys (day)`,
  // Для щогодинної чистки за датою — без перегляду всієї таблиці.
  `CREATE INDEX IF NOT EXISTS orders_index_dt ON orders_index (datetime)`,
  `CREATE INDEX IF NOT EXISTS versions_created ON versions (created_at)`,
  `CREATE TABLE IF NOT EXISTS order_alias (
    alias TEXT PRIMARY KEY,
    code TEXT NOT NULL
  )`,
  ],
  columns: [
    ['versions', 'user_name', "TEXT DEFAULT ''"]
  ],
  // Один раз: ключі пошуку для вже завантажених замовлень.
  async seed(db) {
    await db.batch([
      [`INSERT OR IGNORE INTO order_keys (k, code, day)
        SELECT TRIM(CAST(json_extract(data, '$.id') AS TEXT)), code, substr(datetime, 1, 10) FROM orders_index WHERE json_extract(data, '$.id') IS NOT NULL
        UNION ALL SELECT code, code, substr(datetime, 1, 10) FROM orders_index
        UNION ALL SELECT TRIM(ttn), code, substr(datetime, 1, 10) FROM orders_index WHERE TRIM(ttn) != ''
        UNION ALL SELECT 'p:' || substr(phone, -9), code, substr(datetime, 1, 10) FROM orders_index WHERE length(phone) >= 9`, []],
    ]);
  },
};
