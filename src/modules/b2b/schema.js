// Схема модуля «B2B партнери»: партнери, бренди й маржа, каталог з цінами з LP-CRM, журнали змін цін і маржі.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'b2b',
  version: 14,
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
  // ---------- етап 2: юрособи партнера, закупівлі, файли ----------
  // Юрособи партнера (на кого виставляти рахунок). Використана в замовленнях — лише приховується.
  `CREATE TABLE IF NOT EXISTS b2b_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'fop',
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    address TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    vat INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS b2b_entities_p ON b2b_entities (partner_id)`,
  `CREATE INDEX IF NOT EXISTS b2b_entities_code ON b2b_entities (code)`,
  // Замовлення партнерів. kind: supply — закупівля в нас; client — замовлення для клієнта партнера (етап 3).
  `CREATE TABLE IF NOT EXISTS b2b_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'supply',
    status TEXT NOT NULL,
    entity_id INTEGER,
    entity TEXT DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    comment TEXT DEFAULT '',
    invoice_no TEXT DEFAULT '',
    invoice_date TEXT DEFAULT '',
    waybill_no TEXT DEFAULT '',
    paid_amount REAL NOT NULL DEFAULT 0,
    paid_at TEXT DEFAULT '',
    paid_by TEXT DEFAULT '',
    created_by TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS b2b_orders_p ON b2b_orders (partner_id, id)`,
  `CREATE INDEX IF NOT EXISTS b2b_orders_status ON b2b_orders (status)`,
  `CREATE TABLE IF NOT EXISTS b2b_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    article TEXT DEFAULT '',
    qty REAL NOT NULL,
    price REAL NOT NULL,
    rrp REAL NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS b2b_order_items_o ON b2b_order_items (order_id)`,
  // Історія замовлення: хто, коли, що змінив.
  `CREATE TABLE IF NOT EXISTS b2b_order_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    at TEXT NOT NULL,
    user_name TEXT DEFAULT '',
    action TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS b2b_order_log_o ON b2b_order_log (order_id)`,
  // Файли (рахунок, накладна, маркування): зберігаються 30 днів; вміст — base64 частинами до 900 КБ (обмеження рядка D1).
  `CREATE TABLE IF NOT EXISTS b2b_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    parts INTEGER NOT NULL DEFAULT 0,
    created_by TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS b2b_files_o ON b2b_files (order_id)`,
  `CREATE INDEX IF NOT EXISTS b2b_files_at ON b2b_files (created_at)`,
  // Документи, надіслані боту особисто (рахунок / накладна): стан підтвердження, що збережено, як скасувати.
  `CREATE TABLE IF NOT EXISTS b2b_tg_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    user_id INTEGER,
    msg_id INTEGER DEFAULT 0,
    file_id TEXT NOT NULL,
    file_uid TEXT DEFAULT '',
    name TEXT DEFAULT '',
    mime TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    parsed TEXT DEFAULT '',
    order_id INTEGER,
    kind TEXT DEFAULT '',
    number TEXT DEFAULT '',
    doc_date TEXT DEFAULT '',
    state TEXT NOT NULL DEFAULT 'pending',
    file_row INTEGER,
    prev TEXT DEFAULT '',
    group_msg TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    saved_at TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS b2b_tg_docs_chat ON b2b_tg_docs (chat_id, state)`,
  `CREATE INDEX IF NOT EXISTS b2b_tg_docs_at ON b2b_tg_docs (created_at)`,
  `CREATE TABLE IF NOT EXISTS b2b_file_parts (
    file_id INTEGER NOT NULL,
    n INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (file_id, n)
  )`,
  // Платежі Opendatabot за закупівлі: order_id — куди зараховано (порожньо — треба перевірити, candidates — можливі
  // закупівлі); dismissed — адмін відв'язав (Opendatabot помилився), більше не пропонується автоматично.
  `CREATE TABLE IF NOT EXISTS b2b_payments (
    tx_id TEXT PRIMARY KEY,
    order_id INTEGER,
    candidates TEXT NOT NULL DEFAULT '[]',
    dismissed INTEGER NOT NULL DEFAULT 0,
    amount REAL NOT NULL,
    date TEXT DEFAULT '',
    payer_name TEXT DEFAULT '',
    payer_code TEXT DEFAULT '',
    purpose TEXT DEFAULT '',
    auto INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS b2b_payments_order ON b2b_payments (order_id)`,
  ],
  // ---------- етап 3: замовлення для клієнтів партнера ----------
  // supply_id — закупівля, з якої взято товари (порожньо — «без закупівлі»); дані клієнта й ТТН партнера;
  // crm_* — передача в LP-CRM: номер замовлення в CRM (автоматично або вручну), його статус, код, з яким відправили.
  columns: [
    ['b2b_orders', 'supply_id', 'INTEGER'],
    ['b2b_orders', 'client_name', "TEXT DEFAULT ''"],
    ['b2b_orders', 'client_phone', "TEXT DEFAULT ''"],
    ['b2b_orders', 'ttn', "TEXT DEFAULT ''"],
    ['b2b_orders', 'crm_id', "TEXT DEFAULT ''"],
    ['b2b_orders', 'crm_status', "TEXT DEFAULT ''"],
    ['b2b_orders', 'crm_checked_at', "TEXT DEFAULT ''"],
    ['b2b_orders', 'crm_sent_at', "TEXT DEFAULT ''"],
    ['b2b_orders', 'crm_ext', "TEXT DEFAULT ''"],
    // етап 3а: команда партнера (роль у команді, хто додав) і видалені партнери (з замовленнями — в архіві)
    ['users', 'partner_role', "TEXT DEFAULT ''"],
    ['users', 'added_by', "TEXT DEFAULT ''"],
    ['b2b_partners', 'deleted_at', "TEXT DEFAULT ''"],
    // Telegram-група партнера: туди бот дублює закупівлі, рахунки й накладні (файлами), оплату.
    ['b2b_partners', 'tg_group', "TEXT DEFAULT ''"],
    ['b2b_partners', 'tg_group_title', "TEXT DEFAULT ''"],
    ['b2b_partners', 'tg_group_code', "TEXT DEFAULT ''"],
    // Коли партнеру востаннє надіслали зміни цін (кнопка «Надіслати зміни цін»).
    ['b2b_partners', 'prices_sent_at', "TEXT DEFAULT ''"],
    // «Фінансові питання»: повідомлення бота із запитом рахунку, повідомлення з рахунком (відповідь на нього — запит
    // накладної), повідомлення із запитом накладної.
    ['b2b_orders', 'fin_req_msg', 'INTEGER'],
    ['b2b_orders', 'fin_inv_msg', 'INTEGER'],
    ['b2b_orders', 'fin_pay_msg', 'INTEGER'],
    ['b2b_orders', 'fin_done', 'INTEGER DEFAULT 0'], // підсумок «закупівлю закрито» вже надіслано
    // Маркування: відбиток файлу й ТТН з етикетки — те саме маркування не можна додати у два замовлення.
    ['b2b_files', 'hash', "TEXT DEFAULT ''"],
    ['b2b_files', 'ttn', "TEXT DEFAULT ''"],
    // На який наш рахунок прийшла оплата (для коментаря в LP-CRM).
    ['b2b_payments', 'account', "TEXT DEFAULT ''"],
    // документи з групи: звідки (private | fin), на яке повідомлення відповісти, хто надіслав, з чого вибирати
    ['b2b_tg_docs', 'source', "TEXT DEFAULT 'private'"],
    ['b2b_tg_docs', 'reply_to', 'INTEGER'],
    ['b2b_tg_docs', 'tg_name', "TEXT DEFAULT ''"],
    ['b2b_tg_docs', 'choices', "TEXT DEFAULT ''"],
    // Ліміти партнера (порожньо — типові): відкрита закупівля і всі неоплачені закупівлі.
    ['b2b_partners', 'open_limit', 'REAL'],
    ['b2b_partners', 'unpaid_limit', 'REAL'],
  ],
  // Індекси на нові колонки — після ALTER TABLE (у старих базах колонок ще немає, коли створюються таблиці).
  async seed(db) {
    await db.batch([
      [`CREATE INDEX IF NOT EXISTS b2b_orders_supply ON b2b_orders (supply_id)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_orders_kind ON b2b_orders (kind, partner_id, id)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_orders_created ON b2b_orders (created_at)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_files_hash ON b2b_files (hash)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_files_ttn ON b2b_files (ttn)`, []],
      [`CREATE INDEX IF NOT EXISTS b2b_orders_ttn ON b2b_orders (ttn)`, []],
    ]);
  },
};
