// Схема модуля «Telegram: колонки сповіщень у таблиці users»: таблиці, нові колонки для старих баз.
// version — підвищуйте при зміні схеми модуля: тоді міграція цього модуля виконається знову.

export const schema = {
  name: 'notify',
  version: 1,
  tables: [

  ],
  columns: [
    ['users', 'tg_chat_id', "TEXT DEFAULT ''"],
    ['users', 'tg_code', "TEXT DEFAULT ''"],
    ['users', 'tg_all_links', "INTEGER DEFAULT 0"],
    ['users', 'tg_all_tx', "INTEGER DEFAULT 0"]
  ],
};
