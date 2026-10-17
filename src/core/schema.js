// Спільна частина схеми: таблиця settings (нею користуються всі модулі) і спільні тексти.
// Таблиці модулів описані в src/modules/<модуль>/schema.js, а запускає міграції src/migrate.js.

export const schema = {
  name: 'core',
  version: 1,
  tables: [
    `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  ],
  columns: [],
  // Строк зберігання — спільний для чистки всіх модулів.
  async seed(db) {
    await db.run(`INSERT INTO settings (key, value) VALUES ('retention_days', '7') ON CONFLICT(key) DO NOTHING`);
  },
};

export const DEFAULT_WARNING = "Увага! Оплата цього рахунку означає погодження з умовами поставки товарів. Повідомлення про оплату є обов'язковим, в іншому випадку не гарантується наявність товарів на складі. Товар відпускається за фактом надходження коштів на п/р Постачальника, самовивозом, за наявності довіреності та паспорта.";
