// Схема модуля «Каталог»: повний словник товарів LP-CRM (getProduct за ID) — для прив'язки товарів маркетплейсів,
// пошуку товару у формах і, згодом, накладних та B2B замість часткових копій назв у кожному модулі.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'catalog',
  version: 1,
  tables: [
  // namel — назва малими літерами (SQLite LIKE не зважає на регістр лише для латиниці);
  // code — число в квадратних дужках у назві («… [30414]»); sku — код у дужках («(COMFODRY12)») або model/vendor;
  // skun — sku малими літерами без бренду й розділювачів (точний збіг з артикулом маркетплейсу);
  // active — товар ще є в LP-CRM (0 — у відповіді getProduct його вже немає); checked_at — коли востаннє бачили.
  `CREATE TABLE IF NOT EXISTS crm_products (
    product_id INTEGER PRIMARY KEY,
    name TEXT DEFAULT '',
    namel TEXT DEFAULT '',
    code TEXT DEFAULT '',
    sku TEXT DEFAULT '',
    skun TEXT DEFAULT '',
    model TEXT DEFAULT '',
    vendor TEXT DEFAULT '',
    category_id INTEGER,
    price REAL,
    image TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    checked_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS crm_products_code ON crm_products (code)`,
  `CREATE INDEX IF NOT EXISTS crm_products_skun ON crm_products (skun)`,
  ],
  columns: [],
};
