// Схема модуля «Журнал помилок»: збої сервера й зовнішніх сервісів (LP-CRM, Opendatabot, база…), 30 днів.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'errlog',
  version: 1,
  tables: [
  `CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    path TEXT DEFAULT '',
    user_name TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS error_log_at ON error_log (at)`,
  ],
  columns: [],
};
