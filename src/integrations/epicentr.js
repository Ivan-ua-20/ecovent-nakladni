// Клієнт API продавця Епіцентр Маркету (https://merchant-api.epicentrm.com.ua/swagger/). Токен — з кабінету продавця
// (Налаштування компанії → API), заголовок Authorization: Bearer. Дати й час — UTC.
// Для маркування: GET /v3/deliveries/{провайдер}/invoices/{номер} віддає PDF накладної (base64) для Укрпошти, Meest,
// центрів видачі й поштоматів Епіцентру. Нова пошта тут не друкується — її маркування береться з кабінетів НП.

export const EPC_API = 'https://merchant-api.epicentrm.com.ua';
// Провайдери, накладні яких Епіцентр віддає файлом (у порядку, в якому пробуємо, коли провайдер невідомий).
export const EPC_LABEL_PROVIDERS = ['cvz_epicentr', 'parcel_box_epicentr', 'meest', 'ukrposhta'];

const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const isPdf = (buf) => buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

async function send(fetchFn, token, path) {
  try {
    return await fetchFn(`${EPC_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Language': 'uk' } });
  } catch (e) {
    if (e.pending) throw e;
    throw Object.assign(new Error('Епіцентр не відповідає. Спробуйте ще раз за хвилину.'), { status: 502 });
  }
}
const fail = async (res) => {
  const j = await res.json().catch(() => null);
  const msg = j?.message || j?.error?.message || j?.error || j?.detail || '';
  if (res.status === 401 || res.status === 403) return Object.assign(new Error('Епіцентр: токен недійсний або не має доступу.'), { status: 400 });
  return Object.assign(new Error(`Епіцентр: ${msg || `помилка ${res.status}`}`), { status: res.status === 404 ? 404 : 502 });
};

// Останні замовлення компанії (найновіші першими).
export async function epcOrders(fetchFn, token, { limit = 10 } = {}) {
  const res = await send(fetchFn, token, `/v3/oms/orders?limit=${limit}&sort[]=-createdAt`);
  if (!res.ok) throw await fail(res);
  const j = await res.json().catch(() => ({}));
  return Array.isArray(j.items) ? j.items : [];
}

// Сторінка замовлень, змінених після updatedFrom (ISO, UTC); next — курсор наступної сторінки ('' — більше немає).
export async function epcOrdersPage(fetchFn, token, { updatedFrom = '', cursor = '', limit = 100 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  q.append('sort[]', '-updatedAt');
  if (updatedFrom) q.set('filter[updatedAt][from]', updatedFrom);
  if (cursor) q.set('cursor', cursor);
  const res = await send(fetchFn, token, `/v3/oms/orders?${q}`);
  if (!res.ok) throw await fail(res);
  const j = await res.json().catch(() => ({}));
  const items = Array.isArray(j.items) ? j.items : [];
  return { items, next: items.length && j.next && j.next !== j.current ? String(j.next) : '' };
}

// Коротко про доставку замовлення: провайдер і номер накладної.
export const epcDelivery = (o) => ({
  provider: String(o?.address?.shipment?.provider || o?.shipment?.provider || ''),
  ttn: String(o?.address?.shipment?.number || o?.shipment?.number || ''),
});

// PDF накладної. null — накладної з таким номером у цього провайдера/магазину немає (why отримує відповідь Епіцентру).
export async function epcLabelPdf(fetchFn, token, provider, number, why = () => {}) {
  const res = await send(fetchFn, token, `/v3/deliveries/${encodeURIComponent(provider)}/invoices/${encodeURIComponent(number)}`);
  if (res.status === 401 || res.status === 403) throw await fail(res);
  if (!res.ok) { why((await fail(res)).message); return null; }
  const buf = new Uint8Array(await res.clone().arrayBuffer());
  if (isPdf(buf)) return buf;
  const j = await res.json().catch(() => null);
  const file = String(j?.file || '').replace(/^data:[^,]+,/, '');
  if (!file) { why('Епіцентр не повернув файл'); return null; }
  try { const pdf = unb64(file); if (isPdf(pdf)) return pdf; } catch { /* не base64 */ }
  why('Епіцентр повернув файл не у форматі PDF');
  return null;
}
