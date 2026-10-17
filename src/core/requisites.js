// Реквізити ФОП (IBAN, ІПН, ПІБ, адреса, підпис, печатка…) змінюють лише власник і адміністратори
// (право 'requisites'). Кожна зміна записується в журнал audit_log: хто, коли, що саме.

// Поля, що потрапляють у документ як дані продавця. Решту (шаблон, «активний») можна міняти з правом refs.edit.
export const FOP_REQUISITES = ['short_name', 'full_name', 'ipn', 'address', 'iban', 'bank', 'phone', 'email', 'extra', 'logo', 'signature', 'stamp'];
export const INV_FOP_REQUISITES = ['short_name', 'full_name', 'ipn', 'iban', 'bank', 'address', 'phone', 'warning_text', 'signature', 'stamp'];
const IMAGES = new Set(['logo', 'signature', 'stamp']);

export const REQUISITES_DENIED = 'Реквізити ФОП (IBAN, ІПН, назву, адресу, підпис, печатку) змінюють лише власник і адміністратори.';

// Поля з тіла запиту, значення яких відрізняються від збережених.
export function changedFields(current, body, fields) {
  return fields.filter((k) => body[k] !== undefined && String(body[k] ?? '') !== String(current?.[k] ?? ''));
}

// Опис змін для журналу; картинки не копіюємо — лише факт зміни.
export function describeChanges(current, body, fields) {
  return fields.map((k) => (IMAGES.has(k)
    ? { field: k, from: current?.[k] ? 'є' : 'немає', to: body[k] ? 'нове зображення' : 'прибрано' }
    : { field: k, from: String(current?.[k] ?? ''), to: String(body[k] ?? '') }));
}

export async function logAudit(db, { user, kind, refId = '', action, changes = [] }) {
  await db.run(
    `INSERT INTO audit_log (at, user_id, user_name, kind, ref_id, action, changes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [new Date().toISOString(), user?.id || null, user?.name || user?.login || '', kind, String(refId), action, JSON.stringify(changes)],
  );
}
