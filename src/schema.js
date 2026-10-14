// SQL-схема. Сумісна і з SQLite (локально), і з Cloudflare D1 (на хостингу).

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    layout TEXT NOT NULL DEFAULT 'classic',
    options TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS fops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_name TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    ipn TEXT DEFAULT '',
    address TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    bank TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    extra TEXT DEFAULT '',
    template_id INTEGER,
    logo TEXT DEFAULT '',
    signature TEXT DEFAULT '',
    stamp TEXT DEFAULT '',
    checkbox_license TEXT DEFAULT '',
    checkbox_login TEXT DEFAULT '',
    checkbox_password TEXT DEFAULT '',
    checkbox_pin TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS offices (
    office_id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    fop_id INTEGER
  )`,
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
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE,
    name TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inv_fops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_name TEXT NOT NULL,
    full_name TEXT DEFAULT '',
    ipn TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    bank TEXT DEFAULT '',
    address TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    warning_text TEXT DEFAULT '',
    signature TEXT DEFAULT '',
    stamp TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL,
    source TEXT NOT NULL,
    order_ref TEXT DEFAULT '',
    fop_id INTEGER,
    fop_name TEXT DEFAULT '',
    client_name TEXT DEFAULT '',
    total REAL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT DEFAULT '',
    updated_at TEXT,
    updated_by TEXT DEFAULT ''
  )`,
  // ---------- Аналітика ----------
  // Замовлення: id = короткий номер LP-CRM (зростає з часом), code = довгий код для API.
  // dept/src обчислюються під час завантаження і при зміні відповідностей (щоб дашборд не робив зайвих JOIN).
  `CREATE TABLE IF NOT EXISTS an_orders (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    day TEXT NOT NULL,
    status INTEGER NOT NULL,
    office TEXT DEFAULT '',
    user TEXT DEFAULT '',
    ch TEXT DEFAULT '',
    site TEXT DEFAULT '',
    utm TEXT DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    dept INTEGER NOT NULL DEFAULT 0,
    src INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS an_orders_code ON an_orders(code)`,
  // Межі id по днях — замість індексу по даті (менше записів у базу).
  `CREATE TABLE IF NOT EXISTS an_day_bounds (day TEXT PRIMARY KEY, min_id INTEGER, max_id INTEGER)`,
  // Рядки товарів: id = id замовлення * 100 + № рядка; amount — сума рядка з урахуванням знижки замовлення.
  `CREATE TABLE IF NOT EXISTS an_items (id INTEGER PRIMARY KEY, product_id INTEGER, qty REAL, amount REAL)`,
  `CREATE TABLE IF NOT EXISTS an_products (product_id INTEGER PRIMARY KEY, name TEXT, category_id INTEGER, brand_id INTEGER NOT NULL DEFAULT 0, fetched INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS an_categories (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER)`,
  `CREATE TABLE IF NOT EXISTS an_brands (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, keywords TEXT DEFAULT '', sort INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS an_depts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sort INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS an_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, dept_id INTEGER, name TEXT NOT NULL, sort INTEGER DEFAULT 0)`,
  // Значення «Поле 1» / сайт / utm_source (у нижньому регістрі) → джерело
  `CREATE TABLE IF NOT EXISTS an_source_map (value TEXT PRIMARY KEY, source_id INTEGER)`,
  `CREATE TABLE IF NOT EXISTS an_office_map (office TEXT PRIMARY KEY, dept_id INTEGER)`,
  `CREATE TABLE IF NOT EXISTS an_managers (login TEXT PRIMARY KEY, name TEXT DEFAULT '', dept_id INTEGER)`,
  // Таргет на місяць: kind = 'dept' | 'src'
  `CREATE TABLE IF NOT EXISTS an_targets (month TEXT NOT NULL, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, amount REAL NOT NULL, PRIMARY KEY (month, kind, ref_id))`,
  `CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    fop_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS order_alias (
    alias TEXT PRIMARY KEY,
    code TEXT NOT NULL
  )`,
];

// Відділи з LP-CRM (зі скріншоту) і ФОПи, які з них видно.
// Реквізити ФОПів порожні: їх заповнюють у розділі «ФОПи».
export const SEED_FOPS = [
  { key: 'agvg', short_name: 'ФОП Агафіца В.Г.' },
  { key: 'agam', short_name: 'ФОП Агафіца А.М.', full_name: 'Агафіца Аркадій Михайлович' },
  { key: 'agdm', short_name: 'ФОП Агафіца Д.М.', full_name: 'Агафіца Даніела Михайлівна' },
  { key: 'lupuvf', short_name: 'ФОП Лупу В.Ф.', full_name: 'Лупу Віра Філаретівна' },
  { key: 'lupumg', short_name: 'ФОП Лупу М.Г.', full_name: 'Лупу Михайло Георгійович' },
  { key: 'evds', short_name: 'ФОП Євпраксін Д.С.', full_name: 'Євпраксін Данило Сергійович' },
];

export const SEED_OFFICES = [
  ['4', 'Фейсбук', 'agvg'],
  ['5', 'Маркетплейси', null],
  ['6', 'Інстаграм', 'agvg'],
  ['7', 'Дропшипінг', null],
  ['8', 'ТікТок', null],
  ['9', 'Відділ Маркетингу', null],
  ['11', 'Інстаграм / ФОП ЛУПУ ВІРА', 'lupuvf'],
  ['12', 'Маркетплейси / ФОП ЛУПУ В.Ф.', 'lupuvf'],
  ['13', 'Rozetka(ecovent) / ФОП ЛУПУ М.Г.', 'lupumg'],
  ['14', 'Rozetka(oneday) / ФОП ЛУПУ В.Ф.', 'lupuvf'],
  ['17', 'Фейсбук / ФОП ЛУПУ ВІРА', 'lupuvf'],
  ['18', 'Amsterdam / ФОП Агафіца А.М', 'agam'],
  ['19', 'Techno-Expert / ФОП Агафіца А.М', 'agam'],
  ['20', 'Prom(Arca) / ФОП Агафіца А.М.', 'agam'],
  ['21', 'Epicentr(Ecovent) / ФОП Агафіца А.М.', 'agam'],
  ['22', 'Ecovent-Expert / ФОП Агафіца Д.М.', 'agdm'],
  ['23', 'Epicentr(Amsterdam) / ФОП Агафіца Д.М.', 'agdm'],
  ['24', 'Prom(Amsterdam) / ФОП Агафіца Д.М.', 'agdm'],
  ['25', 'iHunt / ФОП Агафіца Д.М.', 'agdm'],
  ['26', 'Сервісний відділ', null],
  ['27', 'B2B', null],
  ['28', 'ТОВ «ЕКОВЕНТ-ДИСТРИБ\'ЮШН»', null],
  ['29', 'ФОП Євпраксін Данило Сергійович', 'evds'],
];

export const SEED_TEMPLATES = [
  {
    name: 'Видаткова накладна (класична)',
    layout: 'classic',
    options: {
      title: 'Видаткова накладна',
      accent: '#1f2937',
      showArticle: true,
      showUnit: true,
      showDelivery: true,
      showPayment: true,
      showSignatures: true,
      footerText: 'Товар отримав, претензій щодо кількості, комплектності та зовнішнього вигляду не маю.',
    },
  },
  {
    name: 'Товарний чек (компактний)',
    layout: 'compact',
    options: {
      title: 'Товарний чек',
      accent: '#111827',
      showArticle: false,
      showUnit: false,
      showDelivery: true,
      showPayment: true,
      showSignatures: true,
      footerText: 'Дякуємо за покупку!',
    },
  },
  {
    name: 'Брендована (з логотипом і кольором)',
    layout: 'branded',
    options: {
      title: 'Накладна',
      accent: '#0f766e',
      showArticle: true,
      showUnit: true,
      showDelivery: true,
      showPayment: true,
      showSignatures: true,
      footerText: 'Гарантія та повернення — відповідно до Закону України «Про захист прав споживачів». Повернення товару належної якості протягом 14 днів.',
    },
  },
];

// «Додаткове поле 1» LP-CRM (канал продажу) → ФОП. Заповнюється з назв відділів виду «Канал / ФОП …».
// Загальні назви, що збігаються з окремими відділами (Інстаграм, Фейсбук, Маркетплейси), пропускаємо.
async function seedChannels(db) {
  const done = await db.get(`SELECT value FROM settings WHERE key = 'channels_seeded'`);
  if (done) return;
  const offices = await db.all(`SELECT name, fop_id FROM offices WHERE fop_id IS NOT NULL`);
  const plainNames = new Set((await db.all(`SELECT name FROM offices`)).map((o) => o.name.trim().toLowerCase()));
  const st = [];
  for (const o of offices) {
    const parts = String(o.name).split(' / ');
    if (parts.length < 2) continue;
    const ch = parts[0].trim();
    if (!ch || plainNames.has(ch.toLowerCase())) continue;
    st.push([`INSERT INTO channels (name, fop_id) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`, [ch, o.fop_id]]);
  }
  st.push([`INSERT INTO settings (key, value) VALUES ('channels_seeded', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}

// Нові колонки для вже створених баз (ALTER TABLE без помилки, якщо колонка вже є).
const ADD_COLUMNS = [
  ['offices', 'seller_text', "TEXT DEFAULT ''"],
  ['channels', 'seller_text', "TEXT DEFAULT ''"],
  ['versions', 'user_name', "TEXT DEFAULT ''"],
  ['users', 'failed_logins', 'INTEGER DEFAULT 0'],
  ['users', 'locked_until', "TEXT DEFAULT ''"],
];

// Підвищуйте при зміні схеми: тоді міграція виконається знову (на Cloudflare — один раз на запуск ізолята).
const SCHEMA_VERSION = '8';

// Початкові відділи аналітики, джерела і відповідності (усе редагується в «Налаштуваннях аналітики»).
const AN_SEED = {
  depts: [
    { name: 'Маркетплейси', sources: [
      { name: 'Rozetka', values: ['rozetka(oneday)', 'rozetka(ecovent)', 'rozetka'] },
      { name: 'Prom', values: ['prom(arca)', 'prom(amsterdam)', 'prom'] },
      { name: 'Epicentr', values: ['epicentr(ecovent)', 'epicentr(amsterdam)', 'epicentr'] },
    ] },
    { name: 'Сайти', sources: [
      { name: 'Сайт iHunt', values: ['ihunt'] },
      { name: 'Сайт Ecovent', values: ['ecovent-expert', 'ecovent'] },
      { name: 'Сайт Amsterdam', values: ['amsterdam'] },
      { name: 'Сайт Techno-Expert', values: ['techno-expert'] },
    ] },
    { name: 'Інстаграм', sources: [] },
    { name: 'Фейсбук', sources: [] },
    { name: 'ТікТок', sources: [] },
    { name: 'Дропшипінг', sources: [] },
    { name: 'B2B', sources: [] },
    { name: 'Інше', sources: [] },
  ],
  offices: {
    'Маркетплейси': ['5', '12', '13', '14', '20', '21', '23', '24'],
    'Сайти': ['18', '19', '22', '25'],
    'Фейсбук': ['4', '17'],
    'Інстаграм': ['6', '11'],
    'ТікТок': ['8'],
    'Дропшипінг': ['7'],
    'B2B': ['27', '28'],
    'Інше': ['9', '26', '29'],
  },
  brands: [['iHunt', 'ihunt'], ['Evoair', 'evoair'], ['Ecovent', 'ecovent']],
};

// Усе засівання — одним пакетом (атомарно; на D1 це один запит замість десятків).
async function seedAnalytics(db) {
  const done = await db.get(`SELECT value FROM settings WHERE key = 'an_seeded'`);
  if (done) return;
  const st = [];
  const deptId = {};
  let sid = 0;
  AN_SEED.depts.forEach((d, i) => {
    const id = i + 1;
    deptId[d.name] = id;
    st.push([`INSERT OR IGNORE INTO an_depts (id, name, sort) VALUES (?, ?, ?)`, [id, d.name, i]]);
    d.sources.forEach((src, j) => {
      sid += 1;
      st.push([`INSERT OR IGNORE INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, ?, ?)`, [sid, id, src.name, j]]);
      for (const v of src.values) st.push([`INSERT OR IGNORE INTO an_source_map (value, source_id) VALUES (?, ?)`, [v, sid]]);
    });
  });
  for (const [name, list] of Object.entries(AN_SEED.offices)) {
    for (const office of list) st.push([`INSERT OR IGNORE INTO an_office_map (office, dept_id) VALUES (?, ?)`, [office, deptId[name]]]);
  }
  AN_SEED.brands.forEach(([name, kw], i) => st.push([`INSERT OR IGNORE INTO an_brands (id, name, keywords, sort) VALUES (?, ?, ?, ?)`, [i + 1, name, kw, i]]));
  const settings = {
    compare: true, // порівняння з попереднім періодом
    deptPriority: 'manager', // відділ: спершу за менеджером, потім за відділом CRM
    targetBase: 'net', // таргет від обороту без відмов і повернень
    months: 6,
    okStatuses: [11, 14, 53, 18],
    refuseStatuses: [54, 58],
  };
  st.push([`INSERT INTO settings (key, value) VALUES ('an_settings', ?) ON CONFLICT(key) DO NOTHING`, [JSON.stringify(settings)]]);
  st.push([`INSERT INTO settings (key, value) VALUES ('an_seeded', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}

// Налаштування, які з'явилися пізніше, — додаємо, якщо їх ще немає.
const LATER_SETTINGS = {
  rahunok_next_number: '10516',
  retention_days: '7',
};

export const DEFAULT_WARNING = "Увага! Оплата цього рахунку означає погодження з умовами поставки товарів. Повідомлення про оплату є обов'язковим, в іншому випадку не гарантується наявність товарів на складі. Товар відпускається за фактом надходження коштів на п/р Постачальника, самовивозом, за наявності довіреності та паспорта.";

// Повні ПІБ ФОПів (надані 13.10.2026). Для вже створених баз — заповнює, лише якщо ПІБ порожнє
// або записане з префіксом «ФОП».
const FOP_FULL_NAMES = [
  ['ФОП Євпраксін Д.С.', 'Євпраксін Данило Сергійович'],
  ['ФОП Агафіца А.М.', 'Агафіца Аркадій Михайлович'],
  ['ФОП Агафіца Д.М.', 'Агафіца Даніела Михайлівна'],
  ['ФОП Лупу В.Ф.', 'Лупу Віра Філаретівна'],
  ['ФОП Лупу М.Г.', 'Лупу Михайло Георгійович'],
];
async function fillFopNames(db) {
  const done = await db.get(`SELECT value FROM settings WHERE key = 'fop_names_v1'`);
  if (done) return;
  await db.batch([
    ...FOP_FULL_NAMES.map(([short, full]) => [`UPDATE fops SET full_name = ? WHERE short_name = ? AND (full_name = '' OR full_name IS NULL OR full_name LIKE 'ФОП %')`, [full, short]]),
    [`INSERT INTO settings (key, value) VALUES ('fop_names_v1', '1') ON CONFLICT(key) DO NOTHING`, []],
  ]);
}

export async function migrate(db) {
  try {
    const v = await db.get(`SELECT value FROM settings WHERE key = 'schema_version'`);
    if (v?.value === SCHEMA_VERSION) return;
  } catch { /* таблиць ще немає */ }
  await migrateFull(db);
  await db.run(`INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [SCHEMA_VERSION]);
}

async function migrateFull(db) {
  // Пакетами: на Cloudflare D1 (безкоштовний план) — до 50 запитів до бази на одне звернення.
  await db.batch(SCHEMA.map((sql) => [sql, []]));
  const alters = [];
  for (const table of [...new Set(ADD_COLUMNS.map((x) => x[0]))]) {
    const have = new Set((await db.all(`PRAGMA table_info(${table})`)).map((r) => r.name));
    for (const [t, col, type] of ADD_COLUMNS) if (t === table && !have.has(col)) alters.push([`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`, []]);
  }
  await db.batch(alters);
  await db.batch(Object.entries(LATER_SETTINGS).map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`, [k, v]]));
  const seeded = await db.get(`SELECT value FROM settings WHERE key = 'seeded'`);
  if (seeded) { await seedChannels(db); await fillFopNames(db); await seedAnalytics(db); return; }

  // Нова база: усе одним пакетом з явними id (атомарно, і на D1 — один запит).
  const st = [];
  SEED_TEMPLATES.forEach((t, i) => st.push([`INSERT INTO templates (id, name, layout, options) VALUES (?, ?, ?, ?)`, [i + 1, t.name, t.layout, JSON.stringify(t.options)]]));
  const idByKey = {};
  SEED_FOPS.forEach((f, i) => {
    idByKey[f.key] = i + 1;
    st.push([`INSERT INTO fops (id, short_name, full_name, template_id) VALUES (?, ?, ?, 1)`, [i + 1, f.short_name, f.full_name || '']]);
  });
  for (const [id, name, key] of SEED_OFFICES) {
    st.push([`INSERT INTO offices (office_id, name, fop_id) VALUES (?, ?, ?)`, [id, name, key ? idByKey[key] : null]]);
  }
  const defaults = {
    lpcrm_subdomain: 'ihunt',
    lpcrm_key: '',
    default_fop_id: '',
    checkbox_enabled: '0',
    checkbox_search_days: '7',
    lpcrm_search_days: '30',
    seller_note: '',
  };
  for (const [k, v] of Object.entries(defaults)) st.push([`INSERT INTO settings (key, value) VALUES (?, ?)`, [k, v]]);
  st.push([`INSERT INTO settings (key, value) VALUES ('seeded', '1')`, []]);
  await db.batch(st);
  await seedChannels(db);
  await fillFopNames(db);
  await seedAnalytics(db);
}
