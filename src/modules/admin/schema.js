// Схема модуля «Журнал змін»: таблиці, нові колонки для старих баз.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'admin',
  version: 1,
  tables: [
  // Журнал змін реквізитів ФОП та інших важливих дій: хто, коли, що змінив.
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id INTEGER,
    user_name TEXT DEFAULT '',
    kind TEXT NOT NULL,
    ref_id TEXT DEFAULT '',
    action TEXT NOT NULL,
    changes TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE INDEX IF NOT EXISTS audit_log_ref ON audit_log (kind, ref_id)`,
  ],
  columns: [

  ],
};
