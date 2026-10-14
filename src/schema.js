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
  for (const o of offices) {
    const parts = String(o.name).split(' / ');
    if (parts.length < 2) continue;
    const ch = parts[0].trim();
    if (!ch || plainNames.has(ch.toLowerCase())) continue;
    await db.run(`INSERT INTO channels (name, fop_id) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`, [ch, o.fop_id]);
  }
  await db.run(`INSERT INTO settings (key, value) VALUES ('channels_seeded', '1') ON CONFLICT(key) DO NOTHING`);
}

// Нові колонки для вже створених баз (ALTER TABLE без помилки, якщо колонка вже є).
const ADD_COLUMNS = [
  ['offices', 'seller_text', "TEXT DEFAULT ''"],
  ['channels', 'seller_text', "TEXT DEFAULT ''"],
  ['versions', 'user_name', "TEXT DEFAULT ''"],
];

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
  for (const [short, full] of FOP_FULL_NAMES) {
    await db.run(`UPDATE fops SET full_name = ? WHERE short_name = ? AND (full_name = '' OR full_name IS NULL OR full_name LIKE 'ФОП %')`, [full, short]);
  }
  await db.run(`INSERT INTO settings (key, value) VALUES ('fop_names_v1', '1') ON CONFLICT(key) DO NOTHING`);
}

export async function migrate(db) {
  for (const sql of SCHEMA) await db.run(sql);
  for (const [table, col, type] of ADD_COLUMNS) {
    try { await db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch { /* вже є */ }
  }
  for (const [k, v] of Object.entries(LATER_SETTINGS)) {
    await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`, [k, v]);
  }
  const seeded = await db.get(`SELECT value FROM settings WHERE key = 'seeded'`);
  if (seeded) { await seedChannels(db); await fillFopNames(db); return; }

  for (const t of SEED_TEMPLATES) {
    await db.run(`INSERT INTO templates (name, layout, options) VALUES (?, ?, ?)`, [
      t.name, t.layout, JSON.stringify(t.options),
    ]);
  }
  const firstTpl = await db.get(`SELECT id FROM templates ORDER BY id LIMIT 1`);
  const idByKey = {};
  for (const f of SEED_FOPS) {
    const r = await db.run(
      `INSERT INTO fops (short_name, full_name, template_id) VALUES (?, ?, ?)`,
      [f.short_name, f.full_name || '', firstTpl.id],
    );
    idByKey[f.key] = r.lastId;
  }
  for (const [id, name, key] of SEED_OFFICES) {
    await db.run(`INSERT INTO offices (office_id, name, fop_id) VALUES (?, ?, ?)`, [
      id, name, key ? idByKey[key] : null,
    ]);
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
  for (const [k, v] of Object.entries(defaults)) {
    await db.run(`INSERT INTO settings (key, value) VALUES (?, ?)`, [k, v]);
  }
  await db.run(`INSERT INTO settings (key, value) VALUES ('seeded', '1')`);
  await seedChannels(db);
  await fillFopNames(db);
}
