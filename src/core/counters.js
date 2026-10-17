// Спільний лічильник номерів рахунків (Word-рахунки і посилання на оплату).
// Один атомарний запит: два одночасні рахунки не отримають однаковий номер.

const FIRST = 10516;

// Повертає поточний номер і одразу збільшує лічильник.
export async function takeRahunokNumber(db) {
  const r = await db.get(
    `UPDATE settings SET value = CAST(COALESCE(NULLIF(CAST(value AS INTEGER), 0), ${FIRST}) + 1 AS TEXT)
     WHERE key = 'rahunok_next_number' RETURNING CAST(value AS INTEGER) - 1 AS n`,
  );
  if (r?.n) return String(r.n);
  // Лічильника ще немає (стара база): створюємо його і віддаємо перший номер.
  await db.run(`INSERT INTO settings (key, value) VALUES ('rahunok_next_number', ?) ON CONFLICT(key) DO NOTHING`, [String(FIRST + 1)]);
  return String(FIRST);
}

// Номер, який отримає наступний рахунок (лише для показу).
export const peekRahunokNumber = (s) => String(Number(s.rahunok_next_number) || FIRST);
