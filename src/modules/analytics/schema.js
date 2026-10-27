// Схема модуля «Аналітика»: таблиці an_*, початкові відділи/джерела/бренди і разові оновлення v9–v12.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

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

export const schema = {
  name: 'analytics',
  version: 5,
  tables: [
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
  // Дублі ТТН у LP-CRM, про які вже сповістили (набір № замовлень) — щоб не повторювати при кожному оновленні.
  `CREATE TABLE IF NOT EXISTS an_ttn_dups (ttn TEXT PRIMARY KEY, codes TEXT NOT NULL, at TEXT NOT NULL)`,
  // Швидка перевірка ТТН нових замовлень (кожні 10 хв): ТТН замовлень за останні дні — окремо від аналітики.
  `CREATE TABLE IF NOT EXISTS an_ttn_recent (code TEXT PRIMARY KEY, ttn TEXT NOT NULL DEFAULT '', day TEXT NOT NULL, user TEXT DEFAULT '', status INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS an_ttn_recent_ttn ON an_ttn_recent(ttn)`,
  `CREATE INDEX IF NOT EXISTS an_ttn_recent_day ON an_ttn_recent(day)`,
  ],
  columns: [
    ['an_managers', 'depts', "TEXT DEFAULT ''"],
    ['an_products', 'brand_manual', "INTEGER"],
    ['an_products', 'cat_manual', "INTEGER"],
    ['an_products', 'seen', "INTEGER NOT NULL DEFAULT 0"],
    // Служба доставки з LP-CRM (назва); NULL — ще не дозаповнено для старих замовлень.
    ['an_orders', 'deliv', "TEXT"],
    // ТТН із замовлення LP-CRM — для перевірки дублів.
    ['an_orders', 'ttn', "TEXT DEFAULT ''"],
  ],
  // Нова база: засіяти й позначити старі оновлення виконаними; стара — догнати оновлення v9–v12.
  async seed(db, { fresh }) {
    await seedAnalytics(db);
    // Звірка статусів при оновленні читає замовлення одного статусу за період — з індексом лише їх, а не всі замовлення
    // періоду для кожного статусу (у 6 разів менше прочитаних рядків; плюс один запис індексу на зміну статусу).
    await db.run(`CREATE INDEX IF NOT EXISTS an_orders_status ON an_orders(status, id)`);
    // Пошук дублів ТТН — лише серед замовлень, що мають ТТН.
    await db.run(`CREATE INDEX IF NOT EXISTS an_orders_ttn ON an_orders(ttn) WHERE ttn != ''`);
    if (fresh) {
      await db.batch(['an_v9', 'an_v10', 'an_v11', 'an_v12'].map((k) => [`INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING`, [k]]));
      return;
    }
    await upgradeV9(db); await upgradeV10(db); await upgradeV11(db); await upgradeV12(db);
  },
};
