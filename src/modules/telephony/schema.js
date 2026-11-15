// Схема модуля «Телефонія» (Binotel): журнал дзвінків — щоб бачити, чи дзвонив покупець до замовлення і чи дзвонив менеджер.
// version — підвищуйте при зміні схеми модуля.

export const schema = {
  name: 'telephony',
  version: 1,
  tables: [
  // Дзвінок Binotel: id — generalCallID; ts — початок (unix, с); at — він же за Києвом 'YYYY-MM-DD HH:MM:SS' (як дати замовлень);
  // dir — in (вхідний) | out (вихідний); phone9 — останні 9 цифр номера клієнта; disp — ANSWER, NOANSWER, BUSY…; billsec — тривалість розмови.
  `CREATE TABLE IF NOT EXISTS tel_calls (
    id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL DEFAULT '',
    dir TEXT NOT NULL DEFAULT '',
    phone9 TEXT NOT NULL DEFAULT '',
    disp TEXT DEFAULT '',
    billsec INTEGER DEFAULT 0,
    who TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS tel_calls_phone ON tel_calls (phone9, at)`,
  `CREATE INDEX IF NOT EXISTS tel_calls_ts ON tel_calls (ts)`,
  ],
  columns: [],
};
