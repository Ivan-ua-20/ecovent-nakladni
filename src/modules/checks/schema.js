// Схема модуля «Перевірка»: відправлені замовлення LP-CRM за останні дні з даними ТТН і чеки Checkbox по ФОП.
// Результат перевірки не зберігаємо — рахуємо під час показу з цих даних (завжди актуальний). version — підвищуйте при зміні.

export const schema = {
  name: 'checks',
  version: 4,
  tables: [
  // Замовлення LP-CRM у статусах «відправлено / очікує викупу / завершено» за останні CHECK_DAYS днів.
  // listed_at — коли востаннє бачили в цих статусах (зникло зі списку — більше не показуємо);
  // fetched_status — статус, з яким уже прочитано повні дані (змінився — перечитати).
  // ТТН: carrier (np | rd | prm | meest | up | other), cod — сума наложки, cod_kind (ctrl — контроль оплати, redelivery — переказ),
  // ttn_at — коли перевірено, ttn_err — що завадило.
  `CREATE TABLE IF NOT EXISTS chk_orders (
    code TEXT PRIMARY KEY,
    id TEXT DEFAULT '',
    day TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL DEFAULT 0,
    fetched_status INTEGER NOT NULL DEFAULT 0,
    listed_at TEXT DEFAULT '',
    payment TEXT DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    office TEXT DEFAULT '',
    channel TEXT DEFAULT '',
    site TEXT DEFAULT '',
    delivery TEXT DEFAULT '',
    ttn TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    buyer TEXT DEFAULT '',
    user TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    carrier TEXT DEFAULT '',
    cod REAL NOT NULL DEFAULT 0,
    cod_kind TEXT DEFAULT '',
    ttn_at TEXT DEFAULT '',
    ttn_err TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS chk_orders_day ON chk_orders (day)`,
  `CREATE INDEX IF NOT EXISTS chk_orders_ttn ON chk_orders (carrier, ttn_at)`,
  // Чеки Checkbox по ФОП (усі каси організації ФОП): сума, спосіб оплати, числа з чека для пошуку № замовлення.
  `CREATE TABLE IF NOT EXISTS chk_receipts (
    id TEXT PRIMARY KEY,
    fop_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    at TEXT DEFAULT '',
    type TEXT DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    fiscal TEXT DEFAULT '',
    pays TEXT NOT NULL DEFAULT '[]',
    refs TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS chk_receipts_day ON chk_receipts (day)`,
  // Які дні чеків по кожному ФОП уже прочитано повністю (done = 1 — день минув і прочитаний до кінця).
  `CREATE TABLE IF NOT EXISTS chk_days (
    fop_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    at TEXT DEFAULT '',
    PRIMARY KEY (fop_id, day)
  )`,
  ],
  columns: [
    // Замовлення Prom з тією самою ТТН (знайдено серед замовлень маркетплейсів): спосіб оплати в Prom —
    // mp_pay: prosale_paid | prosale_unpaid | credit (частинами через Prom) | cod | other; mp_pay_name — як у кабінеті Prom; mp_at — коли перевірено.
    ['chk_orders', 'mp_pay', "TEXT DEFAULT ''"],
    ['chk_orders', 'mp_pay_name', "TEXT DEFAULT ''"],
    ['chk_orders', 'mp_at', "TEXT DEFAULT ''"],
    // Чек, прив'язаний до замовлення в LP-CRM (номер чека Checkbox, UUID); ref_state: '' — ще не шукали,
    // ok — чек є серед завантажених, nofop — жодна каса, підключена в сервісі, цього чека не бачить.
    ['chk_orders', 'receipt_ref', "TEXT DEFAULT ''"],
    ['chk_orders', 'ref_state', "TEXT DEFAULT ''"],
    // Передоплата з LP-CRM (поле prepayment): часткова оплата — наложка має бути на суму мінус передоплата.
    ['chk_orders', 'prepayment', 'REAL NOT NULL DEFAULT 0'],
  ],
};
