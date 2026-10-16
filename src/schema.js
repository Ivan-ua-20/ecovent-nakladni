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
  // Збережені відповіді дашборду (поки дані й налаштування не змінились) — менше читань бази.
  `CREATE TABLE IF NOT EXISTS an_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL)`,
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
  ['19', 'ФОП Агафіца А.М', 'agam'],
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
      footerText: '',
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
  ['users', 'crm_logins', "TEXT DEFAULT ''"],
  ['an_managers', 'depts', "TEXT DEFAULT ''"],
  ['inv_fops', 'odb_id', "TEXT DEFAULT ''"],
  ['channels', 'seller_text', "TEXT DEFAULT ''"],
  ['versions', 'user_name', "TEXT DEFAULT ''"],
  ['users', 'failed_logins', 'INTEGER DEFAULT 0'],
  ['users', 'locked_until', "TEXT DEFAULT ''"],
  ['an_products', 'brand_manual', 'INTEGER'],
  ['an_products', 'cat_manual', 'INTEGER'],
  ['an_products', 'seen', 'INTEGER NOT NULL DEFAULT 0'],
];

// Підвищуйте при зміні схеми: тоді міграція виконається знову (на Cloudflare — один раз на запуск ізолята).
const SCHEMA_VERSION = '14';

// Початкові відділи аналітики, джерела і відповідності (усе редагується в «Налаштуваннях аналітики»).
const MP_SOURCES = [
  ['Rozetka (OneDay)', ['rozetka(oneday)']],
  ['Rozetka (Ecovent)', ['rozetka(ecovent)']],
  ['Prom (Arca)', ['prom(arca)']],
  ['Prom (Amsterdam)', ['prom(amsterdam)']],
  ['Epicentr (Ecovent)', ['epicentr(ecovent)']],
  ['Epicentr (Amsterdam)', ['epicentr(amsterdam)']],
  ['Monomarket', ['monomarket', 'mono market', 'моно маркет', 'мономаркет']],
  ['Сайт iHunt', ['ihunt']],
  ['Сайт Ecovent', ['ecovent-expert', 'ecovent']],
  ['Сайт Amsterdam', ['amsterdam']],
  ['Інші', []],
];
// Бренди: спершу шукаються в назві товару, потім у назві категорії; решта — «Інші».
export const AN_BRANDS = [
  ['iHunt', 'ihunt, robot window'],
  ['Evoair', 'evoair, humixduo'],
  ['Levoit', 'levoit'],
  ['DREO', 'dreo'],
  ['Ecovent', 'ecovent, decora'],
  ['BSK', 'bsk, zephyr, notus'],
  ['Ergovent', 'ergovent'],
  ['Dolceclima', 'dolceclima'],
];

const SOCIAL_SOURCES = [
  ['Інстаграм', ['instagram', 'інстаграм', 'инстаграм', 'insta']],
  ['Фейсбук', ['facebook', 'фейсбук', 'fb']],
  ['ТікТок', ['tiktok', 'тікток', 'тик ток', 'tik tok']],
];
const SOCIAL_NAMES = ['Інстаграм', 'Фейсбук', 'ТікТок'];

const AN_SEED = {
  depts: [
    { name: 'Маркетплейси', sources: MP_SOURCES.map(([name, values]) => ({ name, values })) },
    { name: 'Riteil', sources: [{ name: 'Riteil(Rozetka)', values: ['riteil(rozetka)'] }] },
    { name: 'Соцмережі', sources: SOCIAL_SOURCES.map(([name, values]) => ({ name, values })) },
    { name: 'Дропшипінг', sources: [] },
    { name: 'B2B', sources: [] },
    { name: 'Інше', sources: [] },
  ],
  offices: {
    'Маркетплейси': ['5', '12', '13', '14', '18', '19', '20', '21', '22', '23', '24', '25'],
    'Соцмережі': ['4', '17', '6', '11', '8'],
    'Дропшипінг': ['7'],
    'B2B': ['27', '28'],
    'Інше': ['9', '26', '29'],
  },
  brands: AN_BRANDS,
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

// Оновлення 15.10.2026: Сайти → у Маркетплейси, окремі Rozetka/Prom/Epicentr, відділ Riteil, без Techno-Expert,
// нові бренди, без рядка «Товар отримав…» у шаблонах. Виконується один раз; відповідності шукаються за назвами.
async function upgradeV9(db) {
  if (await db.get(`SELECT value FROM settings WHERE key = 'an_v9'`)) return;
  const st = [];
  // шаблони накладних
  for (const t of await db.all(`SELECT id, options FROM templates`)) {
    let o = {};
    try { o = JSON.parse(t.options || '{}'); } catch { /* */ }
    if (/Товар отримав/i.test(o.footerText || '')) { o.footerText = ''; st.push([`UPDATE templates SET options = ? WHERE id = ?`, [JSON.stringify(o), t.id]]); }
  }
  st.push([`DELETE FROM channels WHERE LOWER(name) LIKE 'techno-expert%'`, []]);
  st.push([`UPDATE offices SET name = TRIM(SUBSTR(name, 17)) WHERE name LIKE 'Techno-Expert / %'`, []]);
  const depts = await db.all(`SELECT id, name FROM an_depts`);
  const sources = await db.all(`SELECT id, dept_id, name FROM an_sources`);
  const byName = (list, n) => list.find((x) => x.name.trim().toLowerCase() === n.toLowerCase());
  let nextDept = Math.max(0, ...depts.map((d) => d.id)) + 1;
  let nextSrc = Math.max(0, ...sources.map((x) => x.id)) + 1;
  let mp = byName(depts, 'Маркетплейси');
  if (!mp) { mp = { id: nextDept++, name: 'Маркетплейси' }; st.push([`INSERT INTO an_depts (id, name, sort) VALUES (?, ?, 0)`, [mp.id, mp.name]]); }
  const sites = byName(depts, 'Сайти');
  // старі спільні джерела і Techno-Expert — прибрати (таргети лишаються в історії)
  for (const x of sources) {
    const n = x.name.trim().toLowerCase();
    if (['rozetka', 'prom', 'epicentr'].includes(n) || n.includes('techno')) {
      st.push([`DELETE FROM an_source_map WHERE source_id = ?`, [x.id]]);
      st.push([`DELETE FROM an_sources WHERE id = ?`, [x.id]]);
    }
  }
  st.push([`DELETE FROM an_source_map WHERE value LIKE 'techno-expert%'`, []]);
  MP_SOURCES.forEach(([name, values], i) => {
    let src = byName(sources, name);
    if (!src) { src = { id: nextSrc++ }; st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, ?, ?)`, [src.id, mp.id, name, i]]); }
    else st.push([`UPDATE an_sources SET dept_id = ?, sort = ? WHERE id = ?`, [mp.id, i, src.id]]);
    for (const v of values) st.push([`INSERT OR REPLACE INTO an_source_map (value, source_id) VALUES (?, ?)`, [v, src.id]]);
  });
  if (sites) {
    st.push([`UPDATE an_sources SET dept_id = ? WHERE dept_id = ?`, [mp.id, sites.id]]);
    st.push([`UPDATE an_office_map SET dept_id = ? WHERE dept_id = ?`, [mp.id, sites.id]]);
    st.push([`UPDATE an_managers SET dept_id = ? WHERE dept_id = ?`, [mp.id, sites.id]]);
    st.push([`DELETE FROM an_depts WHERE id = ?`, [sites.id]]);
  }
  if (!byName(depts, 'Riteil')) {
    const rid = nextDept++;
    const sid = nextSrc++;
    st.push([`INSERT INTO an_depts (id, name, sort) VALUES (?, 'Riteil', 1)`, [rid]]);
    st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, 'Riteil(Rozetka)', 0)`, [sid, rid]]);
    st.push([`INSERT OR REPLACE INTO an_source_map (value, source_id) VALUES ('riteil(rozetka)', ?)`, [sid]]);
  }
  // бренди: оновити ключові слова наявних, додати відсутні
  const brands = await db.all(`SELECT id, name FROM an_brands`);
  let nextBrand = Math.max(0, ...brands.map((b) => b.id)) + 1;
  AN_BRANDS.forEach(([name, kw], i) => {
    const b = byName(brands, name);
    if (b) st.push([`UPDATE an_brands SET name = ?, keywords = ?, sort = ? WHERE id = ?`, [name, kw, i, b.id]]);
    else st.push([`INSERT INTO an_brands (id, name, keywords, sort) VALUES (?, ?, ?, ?)`, [nextBrand++, name, kw, i]]);
  });
  st.push([`UPDATE an_products SET seen = 1`, []]); // наявні товари не позначаємо як «нові»
  st.push([`INSERT INTO settings (key, value) VALUES ('an_v9', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
  await db.run(`INSERT INTO settings (key, value) VALUES ('an_need_remap', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`);
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
  if (seeded) { await seedChannels(db); await fillFopNames(db); await seedAnalytics(db); await upgradeV9(db); await upgradeV10(db); await upgradeV11(db); await upgradeV12(db); return; }

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
  await db.run(`INSERT INTO settings (key, value) VALUES ('an_v9', '1') ON CONFLICT(key) DO NOTHING`);
  await db.run(`INSERT INTO settings (key, value) VALUES ('an_v10', '1') ON CONFLICT(key) DO NOTHING`);
  await db.run(`INSERT INTO settings (key, value) VALUES ('an_v11', '1') ON CONFLICT(key) DO NOTHING`);
  await db.run(`INSERT INTO settings (key, value) VALUES ('an_v12', '1') ON CONFLICT(key) DO NOTHING`);
}

// Оновлення: джерело «Інші» в Маркетплейсах — для рідкісних значень «Поле 1».
async function upgradeV12(db) {
  if (await db.get(`SELECT value FROM settings WHERE key = 'an_v12'`)) return;
  const mp = await db.get(`SELECT id FROM an_depts WHERE name = 'Маркетплейси'`);
  const st = [];
  if (mp && !(await db.get(`SELECT id FROM an_sources WHERE dept_id = ? AND name = 'Інші'`, [mp.id]))) {
    const next = ((await db.get(`SELECT MAX(id) AS m FROM an_sources`))?.m || 0) + 1;
    const sort = ((await db.get(`SELECT MAX(sort) AS m FROM an_sources WHERE dept_id = ?`, [mp.id]))?.m ?? 0) + 1;
    st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, 'Інші', ?)`, [next, mp.id, sort]]);
  }
  st.push([`INSERT INTO settings (key, value) VALUES ('an_v12', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}

// Оновлення: відділи Інстаграм, Фейсбук і ТікТок → один відділ «Соцмережі» з трьома джерелами.
// Відділи CRM, менеджери і джерела переносяться; таргети трьох старих відділів видаляються.
async function upgradeV11(db) {
  if (await db.get(`SELECT value FROM settings WHERE key = 'an_v11'`)) return;
  const depts = await db.all(`SELECT id, name FROM an_depts`);
  const old = depts.filter((d) => SOCIAL_NAMES.map((x) => x.toLowerCase()).includes(d.name.trim().toLowerCase()));
  const st = [];
  if (old.length && !depts.some((d) => d.name === 'Соцмережі')) {
    const keep = old.find((d) => d.name === 'Інстаграм') || old[0];
    st.push([`UPDATE an_depts SET name = 'Соцмережі' WHERE id = ?`, [keep.id]]);
    for (const d of old) {
      st.push([`DELETE FROM an_targets WHERE kind = 'dept' AND ref_id = ?`, [d.id]]);
      if (d.id === keep.id) continue;
      st.push([`UPDATE an_sources SET dept_id = ? WHERE dept_id = ?`, [keep.id, d.id]]);
      st.push([`UPDATE an_office_map SET dept_id = ? WHERE dept_id = ?`, [keep.id, d.id]]);
      st.push([`UPDATE an_managers SET dept_id = ? WHERE dept_id = ?`, [keep.id, d.id]]);
      st.push([`DELETE FROM an_depts WHERE id = ?`, [d.id]]);
    }
    const srcs = await db.all(`SELECT id, name FROM an_sources`);
    let next = ((await db.get(`SELECT MAX(id) AS m FROM an_sources`))?.m || 0) + 1;
    SOCIAL_SOURCES.forEach(([name, values], i) => {
      let id = srcs.find((x) => x.name.trim().toLowerCase() === name.toLowerCase())?.id;
      if (id) st.push([`UPDATE an_sources SET dept_id = ? WHERE id = ?`, [keep.id, id]]);
      else { id = next++; st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, ?, ?)`, [id, keep.id, name, i]]); }
      for (const v of values) st.push([`INSERT OR IGNORE INTO an_source_map (value, source_id) VALUES (?, ?)`, [v, id]]);
    });
    st.push([`INSERT INTO settings (key, value) VALUES ('an_need_remap', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`, []]);
  }
  st.push([`INSERT INTO settings (key, value) VALUES ('an_v11', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}

// Оновлення: джерело Monomarket у Маркетплейсах (значення «Поле 1», які вже кудись прив'язані, не чіпаємо).
async function upgradeV10(db) {
  if (await db.get(`SELECT value FROM settings WHERE key = 'an_v10'`)) return;
  const mp = await db.get(`SELECT id FROM an_depts WHERE name = 'Маркетплейси'`);
  const st = [];
  if (mp && !(await db.get(`SELECT id FROM an_sources WHERE LOWER(name) = 'monomarket'`))) {
    const next = ((await db.get(`SELECT MAX(id) AS m FROM an_sources`))?.m || 0) + 1;
    const sort = ((await db.get(`SELECT MAX(sort) AS m FROM an_sources WHERE dept_id = ?`, [mp.id]))?.m ?? 0) + 1;
    st.push([`INSERT INTO an_sources (id, dept_id, name, sort) VALUES (?, ?, 'Monomarket', ?)`, [next, mp.id, sort]]);
    for (const v of ['monomarket', 'mono market', 'моно маркет', 'мономаркет']) st.push([`INSERT OR IGNORE INTO an_source_map (value, source_id) VALUES (?, ?)`, [v, next]]);
    st.push([`INSERT INTO settings (key, value) VALUES ('an_need_remap', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`, []]);
  }
  st.push([`INSERT INTO settings (key, value) VALUES ('an_v10', '1') ON CONFLICT(key) DO NOTHING`, []]);
  await db.batch(st);
}
