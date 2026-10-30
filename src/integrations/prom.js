// Клієнт публічного API Prom.ua (https://public-api.docs.prom.ua). Токен — з кабінету компанії Prom,
// передається заголовком Authorization: Bearer. Дати й час у запитах — UTC, формат 2015-04-28T12:50:34.

export const PROM_API = 'https://my.prom.ua/api/v1';

async function send(fetchFn, token, path) {
  let res;
  try {
    res = await fetchFn(`${PROM_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-LANGUAGE': 'uk' } });
  } catch (e) {
    if (e.pending) throw e;
    throw Object.assign(new Error('Prom не відповідає. Спробуйте ще раз за хвилину.'), { status: 502 });
  }
  const j = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Prom: токен недійсний або не має доступу.'), { status: 400 });
  if (!res.ok || !j) throw Object.assign(new Error(`Prom: ${j?.error || j?.message || `помилка ${res.status}`}`), { status: 502 });
  if (j.error) throw Object.assign(new Error(`Prom: ${j.error}`), { status: 400 });
  return j;
}

// Останні замовлення компанії (найновіші першими).
export async function promOrders(fetchFn, token, { limit = 20, dateFrom = '', status = '' } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (dateFrom) q.set('date_from', dateFrom);
  if (status) q.set('status', status);
  return (await send(fetchFn, token, `/orders/list?${q}`)).orders || [];
}

export async function promOrder(fetchFn, token, id) {
  return (await send(fetchFn, token, `/orders/${encodeURIComponent(id)}`)).order || null;
}

export async function promDeliveryOptions(fetchFn, token) {
  return (await send(fetchFn, token, '/delivery_options/list')).delivery_options || [];
}

// Коротко про доставку замовлення: спосіб, перевізник, номер накладної (ЕН/ТТН).
export const promDelivery = (o) => ({
  option: String(o?.delivery_option?.name || ''),
  provider: String(o?.delivery_provider_data?.provider || ''),
  ttn: String(o?.delivery_provider_data?.declaration_number || ''),
  ttn_status: String(o?.delivery_provider_data?.unified_status || ''),
});
