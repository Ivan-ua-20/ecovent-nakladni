// Схема модуля «Вхід і користувачі»: таблиці, нові колонки для старих баз.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'auth',
  version: 2,
  tables: [
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
  ],
  columns: [
    ['users', 'crm_logins', "TEXT DEFAULT ''"],
    ['users', 'failed_logins', "INTEGER DEFAULT 0"],
    ['users', 'locked_until', "TEXT DEFAULT ''"],
    // Перемикач аналітики (керує власник): NULL — як у ролі, 0 — вимкнено, 1 — увімкнено.
    ['users', 'an_access', "INTEGER"],
    // Користувач-партнер (роль partner) — до якої компанії-партнера належить.
    ['users', 'partner_id', "INTEGER"]
  ],
};
