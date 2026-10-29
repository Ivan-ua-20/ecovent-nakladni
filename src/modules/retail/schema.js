// Схема модуля «Рітейл»: маркетплейси (поки Розетка, кабінет постачальника — дропшипінг і прайс).
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'retail',
  version: 5,
  tables: [
  // Кабінети постачальника Розетки: токен (JWT) бачить лише сервер; прайс і параметри передачі замовлень у LP-CRM.
  `CREATE TABLE IF NOT EXISTS rzs_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL,
    price_list_id TEXT DEFAULT '',
    crm_office TEXT DEFAULT '',
    crm_delivery TEXT DEFAULT '1',
    crm_site TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    synced_at TEXT DEFAULT '',
    hook_user TEXT DEFAULT '',
    hook_pass TEXT DEFAULT '',
    hook_at TEXT DEFAULT '',
    created_at TEXT
  )`,
  // Замовлення дропшипінгу (останні тижні): усе, що потрібно для списку й дій; products — JSON позицій з місцями.
  `CREATE TABLE IF NOT EXISTS rzs_orders (
    id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    order_num TEXT DEFAULT '',
    status TEXT DEFAULT '',
    uzd_status TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT '',
    delivery_type TEXT DEFAULT '',
    delivery_company TEXT DEFAULT '',
    address_id TEXT DEFAULT '',
    customer TEXT DEFAULT '',
    city TEXT DEFAULT '',
    street TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    cod REAL DEFAULT 0,
    ttn TEXT DEFAULT '',
    tracking_code INTEGER,
    tracking_status TEXT DEFAULT '',
    return_ttn TEXT DEFAULT '',
    document_link TEXT DEFAULT '',
    invoice_no TEXT DEFAULT '',
    sn_required INTEGER DEFAULT 0,
    products TEXT DEFAULT '[]',
    docs_at TEXT DEFAULT '',
    confirmed_at TEXT DEFAULT '',
    ttn_at TEXT DEFAULT '',
    crm_id TEXT DEFAULT '',
    crm_code TEXT DEFAULT '',
    crm_at TEXT DEFAULT '',
    note TEXT DEFAULT '',
    synced_at TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS rzs_orders_created ON rzs_orders (created_at)`,
  `CREATE INDEX IF NOT EXISTS rzs_orders_status ON rzs_orders (status, created_at)`,
  // Товари Розетки (артикул постачальника): товар LP-CRM, ціна закупівлі для Розетки (вона ж — ціна в LP-CRM), РІЦ, залишок,
  // свої габарити місць (якщо в каталозі Розетки їх немає) — для ТТН.
  `CREATE TABLE IF NOT EXISTS rzs_products (
    code TEXT PRIMARY KEY,
    rz_code TEXT DEFAULT '',
    product_id INTEGER,
    name TEXT DEFAULT '',
    purchase_price REAL,
    rrp REAL,
    stock INTEGER,
    seats TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`,
  ],
  columns: [
    // З вивантаження товарів Кабінету постачальника: статус на сайті Розетки, бренд, коли востаннє оновлено з файлу.
    ['rzs_products', 'rz_status', "TEXT DEFAULT ''"],
    ['rzs_products', 'brand', "TEXT DEFAULT ''"],
    ['rzs_products', 'imported_at', "TEXT DEFAULT ''"],
    // «Додаткове поле 1» замовлення в LP-CRM (канал продажу; за ним аналітика визначає джерело).
    ['rzs_accounts', 'crm_field1', "TEXT DEFAULT 'Riteil(Rozetka)'"],
    // Сповіщення в Telegram: з'явився вхідний рахунок (Вчасно); можна створювати ТТН (ЮЗД звірено). Кому — id користувачів (JSON),
    // порожньо — власник і адміністратори. У замовленні — коли сповіщення вже надіслано (щоб не повторювати).
    ['rzs_accounts', 'notify_inv', 'INTEGER DEFAULT 0'],
    ['rzs_accounts', 'notify_ttn', 'INTEGER DEFAULT 0'],
    ['rzs_accounts', 'notify_users', "TEXT DEFAULT ''"],
    ['rzs_orders', 'inv_notified', "TEXT DEFAULT ''"],
    ['rzs_orders', 'ttn_notified', "TEXT DEFAULT ''"],
    // Остання помилка оновлення з Розетки (порожньо — останнє оновлення вдалося): показуємо на сторінці.
    ['rzs_accounts', 'sync_error', "TEXT DEFAULT ''"],
    ['rzs_accounts', 'sync_error_at', "TEXT DEFAULT ''"],
  ],
};
