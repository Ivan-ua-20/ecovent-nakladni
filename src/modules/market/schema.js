// Схема модуля «Маркетплейси»: замовлення магазинів Розетки, Prom і Епіцентру за останні тижні (для перегляду).
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'market',
  version: 1,
  tables: [
  // mp — rozetka | prom | epc; account_id — магазин у налаштуваннях доставки; items — JSON [{ name, qty, price }].
  `CREATE TABLE IF NOT EXISTS mp_orders (
    mp TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    id TEXT NOT NULL,
    number TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    changed_at TEXT DEFAULT '',
    status TEXT DEFAULT '',
    status_name TEXT DEFAULT '',
    customer TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    total REAL DEFAULT 0,
    delivery TEXT DEFAULT '',
    ttn TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    synced_at TEXT DEFAULT '',
    PRIMARY KEY (mp, account_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS mp_orders_list ON mp_orders (mp, account_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS mp_orders_created ON mp_orders (created_at)`,
  // Стан синхронізації магазину: since — з якого часу брати зміни; незавершений прохід (кілька сторінок за раз) —
  // cursor (наступна сторінка), run_from і run_started — його межі; остання помилка.
  `CREATE TABLE IF NOT EXISTS mp_sync (
    mp TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    synced_at TEXT DEFAULT '',
    since TEXT DEFAULT '',
    cursor TEXT DEFAULT '',
    run_from TEXT DEFAULT '',
    run_started TEXT DEFAULT '',
    error TEXT DEFAULT '',
    error_at TEXT DEFAULT '',
    PRIMARY KEY (mp, account_id)
  )`,
  ],
  columns: [],
};
