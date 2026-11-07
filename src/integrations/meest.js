// Клієнт API «Meest Пошта» (https://wiki.meest-group.com/api/ua/v3.0/openAPI). Токен — з кабінету Meest
// (Налаштування → API інтеграції; окремий на кожен договір), передається заголовком token. Відповідь: { status: OK|Error, info, result }.
// Ліміт — 100 запитів на хвилину від одного користувача.

export const MEEST_API = 'https://api.meest.com/v3.0/openAPI';

const err = (msg, status = 502) => Object.assign(new Error(`Міст: ${msg}`), { status });

// GET до API: result (об'єкт або масив). Помилка з текстом від Міст.
export async function meestGet(fetchFn, token, path) {
  let res;
  try {
    res = await fetchFn(`${MEEST_API}${path}`, { headers: { token, 'Content-Type': 'application/json', Accept: 'application/json' } });
  } catch (e) {
    if (e.pending) throw e;
    throw err('сервер не відповідає. Спробуйте ще раз за хвилину.');
  }
  const j = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw err('токен недійсний або закінчився (кабінет Meest → Налаштування → API інтеграції).', 400);
  if (res.status === 429) throw Object.assign(err('забагато запитів, зачекайте хвилину.'), { rate: true });
  if (!j || String(j.status).toLowerCase() !== 'ok') {
    const i = j?.info || {};
    throw err([i.message, i.messageDetails].filter(Boolean).join(' — ') || `помилка ${res.status}`, res.status === 404 ? 404 : 400);
  }
  return j.result ?? null;
}

const dmy = (iso) => iso.split('-').reverse().join('.');
// Посилки договору, створені в день (YYYY-MM-DD): parcelID, parcelNumber, barCode, registerID.
export const meestParcelsList = (fetchFn, token, day) => meestGet(fetchFn, token, `/parcelsList/${dmy(day)}`).then((r) => (Array.isArray(r) ? r : []));
// Усі зміни статусів посилок за день (YYYY-MM-DD).
export const meestTrackingByDate = (fetchFn, token, day) => meestGet(fetchFn, token, `/trackingByDate/${day}`).then((r) => (Array.isArray(r) ? r : []));
// Історія статусів однієї посилки (номер або штрихкод).
export const meestTracking = (fetchFn, token, num) => meestGet(fetchFn, token, `/tracking/${encodeURIComponent(num)}`).then((r) => (Array.isArray(r) ? r : []));
// Дані договору (перевірка токена і ContractID).
export const meestContract = (fetchFn, token, contractId) => meestGet(fetchFn, token, `/contractClientInfo/${encodeURIComponent(contractId)}`);

// Методи, які можна викликати для перевірки «що віддає API» (лише читання; параметри — з білого списку форматів).
export const MEEST_PROBES = {
  parcelsList: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && `/parcelsList/${dmy(v)}`,
  trackingByDate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && `/trackingByDate/${v}`,
  trackingByPeriod: (v) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) && `/trackingByPeriod/${v.split('|').map(encodeURIComponent).join('/')}`,
  tracking: (v) => /^[\w-]{4,40}$/.test(v) && `/tracking/${encodeURIComponent(v)}`,
  parcelStatus: (v) => /^[\w-]{4,40}$/.test(v) && `/parcelStatus/${encodeURIComponent(v)}`,
  parcelStatusDetails: (v) => /^[\w-]{4,40}$/.test(v) && `/parcelStatusDetails/${encodeURIComponent(v)}`,
  parcelInfoTracking: (v) => /^[\w-]{4,40}$/.test(v) && `/parcelInfoTracking/${encodeURIComponent(v)}`,
  getParcel: (v) => /^[\w-]{4,40}\/(parcelID|barCode|parcelNumber)$/.test(v) && `/getParcel/${v}/objectData`,
  contractClientInfo: (v) => /^[\w-]{8,40}$/.test(v) && `/contractClientInfo/${encodeURIComponent(v)}`,
  trackingDelivered: (v) => /^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}\|\d{1,3}$/.test(v) && `/trackingDelivered/${encodeURIComponent(`${v.split('|')[0]} 00:00:00`)}/${encodeURIComponent(`${v.split('|')[1]} 23:59:59`)}/${v.split('|')[2]}`,
  parcelReturnReasons: () => '/parcelReturnReasons',
};
