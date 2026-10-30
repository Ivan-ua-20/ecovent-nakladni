// Схема модуля «Маркування»: кабінети Нової пошти (і короткий індекс їхніх ТТН) та магазини Розетки.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'marking',
  version: 4,
  tables: [
  // Кабінети НП (ФОП або ТОВ): ключ API бачить лише сервер.
  `CREATE TABLE IF NOT EXISTS np_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL,
    sender_name TEXT DEFAULT '',
    sender_code TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    hits INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
  )`,
  // ТТН кабінетів: з якого кабінету ТТН, телефон отримувача (останні 9 цифр), номер замовлення клієнта.
  `CREATE TABLE IF NOT EXISTS np_docs (
    ttn TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    day TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    order_ref TEXT DEFAULT '',
    recipient TEXT DEFAULT '',
    service TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS np_docs_phone ON np_docs (phone, day)`,
  `CREATE INDEX IF NOT EXISTS np_docs_ref ON np_docs (order_ref, day)`,
  // Які дні кабінету вже переглянуто: наступна сторінка, чи все, коли.
  `CREATE TABLE IF NOT EXISTS np_days (
    account_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    next_page INTEGER NOT NULL DEFAULT 1,
    done INTEGER NOT NULL DEFAULT 0,
    at TEXT,
    PRIMARY KEY (account_id, day)
  )`,
  // Магазини Розетки (кабінет продавця): логін і пароль — лише на сервері; токен діє 24 год.
  `CREATE TABLE IF NOT EXISTS rz_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    market_id TEXT DEFAULT '',
    market_title TEXT DEFAULT '',
    token TEXT DEFAULT '',
    token_at TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    hits INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
  )`,
  // З якого магазину ТТН Розетки (щоб друкувати з першої спроби).
  `CREATE TABLE IF NOT EXISTS rz_docs (
    ttn TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    day TEXT DEFAULT ''
  )`,
  // Магазини Prom.ua (кабінет компанії): токен API — лише на сервері.
  `CREATE TABLE IF NOT EXISTS prom_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    checked_at TEXT DEFAULT '',
    created_at TEXT
  )`,
  // Для щогодинної чистки за датою — без перегляду всієї таблиці.
  `CREATE INDEX IF NOT EXISTS np_docs_day ON np_docs (day)`,
  `CREATE INDEX IF NOT EXISTS np_days_day ON np_days (day)`,
  `CREATE INDEX IF NOT EXISTS rz_docs_day ON rz_docs (day)`,
  ],
  columns: [
    // Тип доставки ТТН (DoorsWarehouse — адресний забір кур'єром тощо).
    ['np_docs', 'service', "TEXT DEFAULT ''"],
  ],
};
