// Клієнт Supplier API Розетки (кабінет постачальника, https://api-cabinet-supplier.rozetka.com.ua/docs).
// Доступ — JWT-токен із Кабінету постачальника (Налаштування → Токени) у заголовку Authorization: Bearer.
// Помилки: HTTP 4xx/5xx з { name, message, code, status }.

export const RZS_API = 'https://api-cabinet-supplier.rozetka.com.ua';

const rzsError = (status, j, fallback) => Object.assign(
  new Error(`Розетка: ${status === 401 ? 'невірний або прострочений токен (Кабінет постачальника → Налаштування → Токени)' : (j?.message || fallback || `помилка ${status}`)}`),
  { status: status === 401 ? 400 : status >= 500 ? 502 : 400, rzsStatus: status, rzs: j },
);

async function rq(fetchFn, token, method, path, { json, xml, raw = false } = {}) {
  let res;
  try {
    res = await fetchFn(`${RZS_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/pdf, */*' : 'application/json',
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...(xml ? { 'Content-Type': 'application/xml' } : {}),
      },
      body: json ? JSON.stringify(json) : xml || undefined,
    });
  } catch (e) {
    if (e.pending) throw e;
    throw Object.assign(new Error('Розетка не відповідає. Спробуйте ще раз за хвилину.'), { status: 502 });
  }
  if (raw && res.ok) return res;
  const j = await res.json().catch(() => null);
  if (!res.ok) throw rzsError(res.status, j);
  return j || {};
}

// «Y-m-d H:i:s» за Києвом.
export const rzsDateTime = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
};

// Сторінка замовлень (50 на сторінку), з деталями і товарами.
export async function rzsOrdersPage(fetchFn, token, { dateFrom, page = 1, status = '' }) {
  const q = new URLSearchParams({ page: String(page), expand: 'details,products' });
  if (dateFrom) q.set('dateFrom', dateFrom);
  if (status) q.set('status', status);
  const j = await rq(fetchFn, token, 'GET', `/dropshipping/orders?${q}`);
  const box = j.data && !Array.isArray(j.data) ? j.data : j;
  const orders = Array.isArray(box.orders) ? box.orders : Array.isArray(box.items) ? box.items : Array.isArray(j.data) ? j.data : [];
  return { orders, total: Number(box.totalCount ?? box.total ?? orders.length) || 0, page: Number(box.currentPage ?? page) || page };
}

export async function rzsOrder(fetchFn, token, id) {
  const j = await rq(fetchFn, token, 'GET', `/dropshipping/orders/${encodeURIComponent(id)}`);
  return j.data && !Array.isArray(j.data) ? j.data : j;
}

// Підтвердити замовлення: products — усі позиції [{ supplierCode, confirmedQuantity, serialNumbers? }].
export async function rzsConfirm(fetchFn, token, id, products) {
  const j = await rq(fetchFn, token, 'POST', `/dropshipping/orders/confirm/${encodeURIComponent(id)}`, { json: { products } });
  const r = j.data && !Array.isArray(j.data) ? j.data : j;
  return { status: r.orderStatus || r.status || 'confirmed', products: r.products || [], warnings: Array.isArray(r.warnings) ? r.warnings : [] };
}

// Створити ТТН Нової пошти з точки відвантаження за замовчуванням. cargoSeats — місця (см, кг), кожне > 0.
export async function rzsCreateTtn(fetchFn, token, id, cargoSeats, { replaceExisting = false } = {}) {
  const j = await rq(fetchFn, token, 'POST', `/dropshipping/orders/ttn/${encodeURIComponent(id)}`, {
    json: { deliveryService: 'nova_poshta', cargoSeats, ...(replaceExisting ? { replaceExisting: true } : {}) },
  });
  const r = j.data && !Array.isArray(j.data) ? j.data : j;
  return { ttn: String(r.ttn || r.ttnNumber || ''), status: r.orderStatus || r.status || 'shipping', point: r.shippingPointName || r.shippingPoint || r.senderPoint || '' };
}

// PDF маркувань Нової пошти (до 100 замовлень): байти, скільки надруковано і пропущено.
export async function rzsMarkings(fetchFn, token, orders, size = '100x100') {
  const res = await rq(fetchFn, token, 'POST', '/dropshipping/orders/print-markings', { json: { deliveryService: 'nova_poshta', format: 'pdf', size, orders }, raw: true });
  return { bytes: new Uint8Array(await res.arrayBuffer()), printed: Number(res.headers.get('X-Markings-Printed')) || 0, skipped: Number(res.headers.get('X-Markings-Skipped')) || 0 };
}

// Прайс (до 1000 позицій, синхронно). items: [{ article, product_id?, purchase_price, recommended_inet_price?, stock }].
const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function priceXml({ priceListId, partial = true, items }) {
  const tag = (k, v) => (v === undefined || v === null || v === '' ? '' : `<${k}>${x(v)}</${k}>`);
  return `<?xml version="1.0" encoding="UTF-8"?><price_list>${tag('price_list_id', priceListId)}<currency>UAH</currency><partial>${partial ? 1 : 0}</partial><skip_row_errors>1</skip_row_errors><items>`
    + items.map((i) => `<item>${tag('product_id', i.product_id)}${tag('article', i.article)}${tag('title', i.title)}${tag('purchase_price', i.purchase_price)}`
      + `${tag('recommended_inet_price', i.recommended_inet_price)}${tag('stock', i.stock)}</item>`).join('')
    + '</items></price_list>';
}
export async function rzsPriceCreate(fetchFn, token, priceListId, items, { test = false } = {}) {
  let res;
  try {
    res = await fetchFn(`${RZS_API}/prices/price-lists/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/xml', ...(test ? { 'X-Test-Request': '1' } : {}) },
      body: priceXml({ priceListId, items }),
    });
  } catch (e) {
    if (e.pending) throw e;
    throw Object.assign(new Error('Розетка не відповідає. Спробуйте ще раз за хвилину.'), { status: 502 });
  }
  const j = await res.json().catch(() => null);
  if (!res.ok && res.status !== 400) throw rzsError(res.status, j);
  const r = j?.data && !Array.isArray(j.data) ? j.data : (j || {});
  const errors = (Array.isArray(r.errors) ? r.errors : Array.isArray(j?.errors) ? j.errors : []).map((e) => (typeof e === 'string' ? e : e?.message || JSON.stringify(e)));
  return { ok: res.ok && r.success !== false, count: Number(r.count ?? r.total ?? r.items ?? 0) || 0, errors };
}
