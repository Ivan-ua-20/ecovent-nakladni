// Схема модуля «Маркетплейси»: замовлення магазинів Розетки, Prom і Епіцентру за останні тижні (для перегляду).
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'market',
  version: 6,
  tables: [
  // mp — rozetka | prom | epc; account_id — магазин у налаштуваннях доставки; items — JSON [{ name, qty, price }].
  `CREATE TABLE IF NOT EXISTS mp_orders (
    mp TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    id TEXT NOT NULL,
    number TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    changed_at TEXT DEFAULT '',
    status TEXT DEFAULT '',
    status_name TEXT DEFAULT '',
    customer TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    total REAL DEFAULT 0,
    delivery TEXT DEFAULT '',
    ttn TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    synced_at TEXT DEFAULT '',
    PRIMARY KEY (mp, account_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS mp_orders_list ON mp_orders (mp, account_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS mp_orders_created ON mp_orders (created_at)`,
  // Стан синхронізації магазину: since — з якого часу брати зміни; незавершений прохід (кілька сторінок за раз) —
  // cursor (наступна сторінка), run_from і run_started — його межі; остання помилка.
  `CREATE TABLE IF NOT EXISTS mp_sync (
    mp TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    synced_at TEXT DEFAULT '',
    since TEXT DEFAULT '',
    cursor TEXT DEFAULT '',
    run_from TEXT DEFAULT '',
    run_started TEXT DEFAULT '',
    error TEXT DEFAULT '',
    error_at TEXT DEFAULT '',
    PRIMARY KEY (mp, account_id)
  )`,
  // Відгуки на товари Розетки, прив'язані до замовлень (orders_id у відгуку) — щоб бачити, хто з покупців ще не залишив відгук.
  `CREATE TABLE IF NOT EXISTS mp_reviews (
    mp TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    id TEXT NOT NULL,
    order_id TEXT DEFAULT '',
    goods TEXT DEFAULT '',
    mark INTEGER DEFAULT 0,
    name TEXT DEFAULT '',
    text TEXT DEFAULT '',
    status TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    changed_at TEXT DEFAULT '',
    PRIMARY KEY (mp, account_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS mp_reviews_order ON mp_reviews (mp, account_id, order_id)`,
  ],
  columns: [
    // Історія магазину (Розетка — за 4 роки): по місяцях назад від сьогодні за датою створення.
    // hist_from — найдавніша дата; hist_to — кінець наступного місяця-вікна; hist_page — сторінка у вікні; hist_done — усе.
    ['mp_sync', 'hist_from', "TEXT DEFAULT ''"],
    ['mp_sync', 'hist_to', "TEXT DEFAULT ''"],
    ['mp_sync', 'hist_page', 'INTEGER DEFAULT 1'],
    ['mp_sync', 'hist_done', 'INTEGER DEFAULT 0'],
    ['mp_sync', 'hist_saved', 'INTEGER DEFAULT 0'],
    ['mp_sync', 'hist_error', "TEXT DEFAULT ''"],
    // Для пошуку без урахування регістру (SQLite LIKE не вміє це для кирилиці): номер, клієнт, телефон, ТТН малими літерами.
    ['mp_orders', 'search', "TEXT DEFAULT ''"],
    // Період історії обирають при запуску: hist_end — його кінець (для відсотка прогресу);
    // keep_from — з якої дати зберігати замовлення магазину (найдавніша з усіх завантажених історій; '' — 4 роки).
    ['mp_sync', 'hist_end', "TEXT DEFAULT ''"],
    ['mp_sync', 'keep_from', "TEXT DEFAULT ''"],
    // Розетка: отримувач, якщо інший за замовника (тоді відгук можуть залишити обидва); товар відгуку.
    ['mp_orders', 'recipient', "TEXT DEFAULT ''"],
    ['mp_orders', 'recipient_phone', "TEXT DEFAULT ''"],
    ['mp_reviews', 'goods_id', "TEXT DEFAULT ''"],
    // Відгуки (Розетка): status_group — група статусу (2 — успішні; 0 — невідомо, для старих рядків — за кодом статусу);
    // review_n — скільки відгуків на товари з цього замовлення, review_mark — найнижча оцінка (1–5, 0 — без оцінки);
    // asked_* — менеджер нагадав про відгук: коли, хто, яким способом.
    ['mp_orders', 'status_group', 'INTEGER DEFAULT 0'],
    ['mp_orders', 'review_n', 'INTEGER DEFAULT 0'],
    ['mp_orders', 'review_mark', 'INTEGER DEFAULT 0'],
    ['mp_orders', 'asked_at', "TEXT DEFAULT ''"],
    ['mp_orders', 'asked_by', "TEXT DEFAULT ''"],
    ['mp_orders', 'asked_via', "TEXT DEFAULT ''"],
    // Завантаження відгуків магазину: rv_page — сторінка незавершеного проходу (0 — немає), rv_run — коли він почався,
    // rv_full — перше (повне) завантаження зроблено, rv_at — початок останнього завершеного проходу, rv_n — усього відгуків.
    ['mp_sync', 'rv_page', 'INTEGER DEFAULT 0'],
    ['mp_sync', 'rv_run', "TEXT DEFAULT ''"],
    ['mp_sync', 'rv_full', 'INTEGER DEFAULT 0'],
    ['mp_sync', 'rv_at', "TEXT DEFAULT ''"],
    ['mp_sync', 'rv_n', 'INTEGER DEFAULT 0'],
    ['mp_sync', 'rv_error', "TEXT DEFAULT ''"],
  ],
};
