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
// lastModifiedFrom — змінені після (UTC, 2015-04-28T12:50:34); lastId — сторінка: лише з id не вище за цей.
export async function promOrders(fetchFn, token, { limit = 20, dateFrom = '', status = '', lastModifiedFrom = '', lastId = 0 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (dateFrom) q.set('date_from', dateFrom);
  if (status) q.set('status', status);
  if (lastModifiedFrom) q.set('last_modified_from', lastModifiedFrom);
  if (lastId) q.set('last_id', String(lastId));
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

// Оплата замовлення Prom для звірки: kind — prosale (Пром-оплата), credit (оплата частинами через Prom),
// cod (оплата при отриманні / накладений платіж), other;
// paid — Пром-оплату вже отримано; name — назва способу оплати, як у кабінеті Prom; total — сума замовлення.
export function promPayment(o) {
  const name = String(o?.payment_option?.name || '').trim();
  const type = String(o?.payment_data?.type || '').toLowerCase();
  const status = String(o?.payment_data?.status || '').toLowerCase();
  const prosale = type.includes('prosale') || /пром[\s-]*оплат|prom[\s-]*оплат|prom[\s-]*pay/i.test(name);
  const credit = !prosale && /(частин|частям|розстроч|рассроч|кредит)/i.test(name); // «Оплатить частями» — гроші теж через Prom
  const cod = !prosale && !credit && /(при отриманн|при получени|наложен|накладен|післяплат|послеоплат|оплата при|cash on delivery)/i.test(name);
  const num = (v) => { const x = Number(String(v ?? '').replace(/[^\d.,]/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
  return { kind: prosale ? 'prosale' : credit ? 'credit' : cod ? 'cod' : 'other', paid: prosale && /^(paid|оплач)/.test(status), name: name || (prosale ? 'Пром-оплата' : ''), status, total: num(o?.full_price ?? o?.price) };
}
