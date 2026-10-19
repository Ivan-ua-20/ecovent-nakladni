// Схема модуля «Оплати (Opendatabot)»: таблиці, нові колонки для старих баз.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'payments',
  version: 2,
  tables: [
  `CREATE TABLE IF NOT EXISTS odb_accounts (
    id TEXT PRIMARY KEY,
    iban TEXT DEFAULT '',
    code TEXT DEFAULT '',
    alias TEXT DEFAULT '',
    kind TEXT DEFAULT 'fop',
    enabled INTEGER NOT NULL DEFAULT 0,
    sort INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pay_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    odb_id TEXT UNIQUE,
    number TEXT DEFAULT '',
    order_ref TEXT DEFAULT '',
    account_id TEXT,
    amount REAL NOT NULL,
    purpose TEXT DEFAULT '',
    client TEXT DEFAULT '',
    url TEXT DEFAULT '',
    page TEXT DEFAULT '',
    qr TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    paid_amount REAL NOT NULL DEFAULT 0,
    paid_at TEXT,
    odb_paid INTEGER NOT NULL DEFAULT 0,
    rahunok_id INTEGER,
    created_at TEXT,
    created_by_id INTEGER,
    created_by TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS pay_links_status ON pay_links (status)`,
  `CREATE TABLE IF NOT EXISTS odb_tx (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'UAH',
    purpose TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    payer_name TEXT DEFAULT '',
    payer_code TEXT DEFAULT '',
    payer_acc TEXT DEFAULT '',
    invoice_id TEXT,
    possible TEXT NOT NULL DEFAULT '[]',
    link_id INTEGER,
    manual INTEGER NOT NULL DEFAULT 0,
    config_id TEXT DEFAULT '',
    created_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS odb_tx_date ON odb_tx (date)`,
  `CREATE INDEX IF NOT EXISTS odb_tx_link ON odb_tx (link_id)`,
  `CREATE TABLE IF NOT EXISTS odb_payers (code TEXT PRIMARY KEY, name TEXT NOT NULL)`,
  // Можливі рахунки платежу окремою таблицею з індексом: статус «перевірити» рахується без перегляду всіх платежів.
  `CREATE TABLE IF NOT EXISTS odb_tx_possible (
    tx_id TEXT NOT NULL,
    odb_id TEXT NOT NULL,
    PRIMARY KEY (tx_id, odb_id)
  )`,
  `CREATE INDEX IF NOT EXISTS odb_tx_possible_odb ON odb_tx_possible (odb_id)`,
  `CREATE INDEX IF NOT EXISTS odb_accounts_iban ON odb_accounts (iban)`,
  ],
  columns: [
    ['inv_fops', 'odb_id', "TEXT DEFAULT ''"],
    ['odb_accounts', 'name', "TEXT DEFAULT ''"],
    ['odb_accounts', 'seen', "INTEGER DEFAULT 0"],
    ['odb_accounts', 'name_manual', "INTEGER DEFAULT 0"],
    ['odb_tx', 'our_code', "TEXT DEFAULT ''"]
  ],
  // Один раз: зіпсовані «[object Object]» прибрати, можливі рахунки перенести в odb_tx_possible.
  async seed(db) {
    await db.batch([
      [`UPDATE odb_tx SET possible = '[]' WHERE possible LIKE '%object Object%'`, []],
      [`INSERT OR IGNORE INTO odb_tx_possible (tx_id, odb_id)
        SELECT t.id, j.value FROM odb_tx t, json_each(t.possible) j WHERE t.possible != '[]' AND typeof(j.value) = 'text' AND j.value != ''`, []],
    ]);
  },
};
