// Фільтри списків B2B (пошук, період за київським часом, оплата) і київські дати для аналітики.

// Зсув Києва від UTC у хвилинах на момент ms (+120 узимку, +180 улітку).
export function kyivOffsetMin(ms) {
  const s = new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Kyiv' }).replace(' ', 'T');
  return Math.round((Date.parse(`${s}Z`) - ms) / 60000);
}
// Початок київського дня (YYYY-MM-DD) як ISO UTC.
export function kyivDayStartIso(day) {
  const noon = Date.parse(`${day}T12:00:00Z`);
  return new Date(Date.parse(`${day}T00:00:00Z`) - kyivOffsetMin(noon) * 60000).toISOString();
}
export const nextDay = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
export const kyivDayOf = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
export const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// Стан оплати замовлення клієнта в SQL (o — замовлення, s — його закупівля).
export const PAID_SQL = `((o.supply_id IS NULL AND COALESCE(o.paid_at, '') != '') OR s.status IN ('paid', 'done'))`;

// where/params для списку: q — № (B2B-12 або 12), назва/реквізити, № рахунку чи накладної; для клієнтів — ПІБ,
// телефон, ТТН, № у CRM. from/to — дні за Києвом. pay — paid | unpaid (лише клієнти).
export function listFilter(c, { client = false } = {}) {
  const where = [];
  const params = [];
  const q = String(c.req.query('q') || '').trim().slice(0, 60);
  if (q) {
    const or = [];
    const num = /^(?:b2b\s*-?\s*)?(\d{1,9})$/i.exec(q);
    if (num) { or.push('o.id = ?'); params.push(Number(num[1])); }
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    if (client) {
      or.push('o.client_name LIKE ?'); params.push(like);
      if (digits.length >= 4) { or.push('o.client_phone LIKE ?', 'o.ttn LIKE ?', 'o.crm_id = ?'); params.push(`%${digits}%`, `%${digits}%`, digits); }
    } else {
      or.push('o.entity LIKE ?', 'o.invoice_no LIKE ?', 'o.waybill_no LIKE ?'); params.push(like, like, like);
    }
    where.push(`(${or.join(' OR ')})`);
  }
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (isDay(from)) { where.push('o.created_at >= ?'); params.push(kyivDayStartIso(from)); }
  if (isDay(to)) { where.push('o.created_at < ?'); params.push(kyivDayStartIso(nextDay(to))); }
  const pay = c.req.query('pay');
  if (client && pay === 'paid') where.push(PAID_SQL);
  if (client && pay === 'unpaid') where.push(`NOT ${PAID_SQL}`);
  return { where, params };
}
