// Схема модуля «Довідники»: шаблони, ФОПи накладних, відділи, «Поле 1» (канали) і початкові дані.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

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

// Нова база: шаблони, ФОПи, відділи і стартові налаштування — одним пакетом з явними id (на D1 — один запит).
async function seedNew(db) {
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
}

export const schema = {
  name: 'refs',
  version: 1,
  tables: [
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
  `CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    fop_id INTEGER
  )`,
  ],
  columns: [
    ['offices', 'seller_text', "TEXT DEFAULT ''"],
    ['channels', 'seller_text', "TEXT DEFAULT ''"]
  ],
  // fresh — нова база (ще не засіяна): шаблони, ФОПи, відділи і стартові налаштування одним пакетом.
  async seed(db, { fresh }) {
    if (fresh) await seedNew(db);
    await seedChannels(db);
    await fillFopNames(db);
  },
};
