// Клієнт Supplier API Розетки (кабінет постачальника, https://api-cabinet-supplier.rozetka.com.ua/docs).
// Доступ — JWT-токен із Кабінету постачальника (Налаштування → Токени) у заголовку Authorization: Bearer.
// Помилки: HTTP 4xx/5xx з { name, message, code, status }.

export const RZS_API = 'https://api-cabinet-supplier.rozetka.com.ua';

const rzsError = (status, j, fallback) => Object.assign(
  new Error(`Розетка: ${status === 401 ? 'невірний або прострочений токен (Кабінет постачальника → Налаштування → Токени)'
    : status === 429 ? 'забагато запитів поспіль — зачекайте кілька секунд і повторіть' : (j?.message || fallback || `помилка ${status}`)}`),
  { status: status === 401 ? 400 : status === 429 ? 429 : status >= 500 ? 502 : 400, rzsStatus: status, rzs: j },
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

// Вивантаження товарів з Кабінету постачальника (CSV, «;», UTF-8 з BOM): артикул, ID товару Розетки, назва, РРЦ,
// ціна закупівлі (історія «дата - UAH 5,679.20 | …» — беремо найновішу; порожньо — «Ціна в прайсі»), залишок, статус, бренд.
function csvRows(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
const numOf = (v) => {
  const s = String(v ?? '').replace(/\s| /g, '');
  if (!s) return null;
  // «5,679.20» (кома — тисячі) або «5679,2» (кома — дробова)
  const n = Number(/,\d{3}(\.|$)/.test(s) && s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const COLS = {
  code: ['артикул товару', 'артикул'], rz_code: ['id товару'], name: ['товар', 'назва товару', 'назва'], rrp: ['ррц від постачальника', 'ррц'],
  buy: ['ціна закупівлі'], list: ['ціна в прайсі'], stock: ['залишки товару', 'залишок', 'залишки'], status: ['статус на сайті'], brand: ['бренд'],
};
export function parseRzsProductsCsv(text) {
  const rows = csvRows(text);
  if (!rows.length) throw Object.assign(new Error('Файл порожній.'), { status: 400 });
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1]));
  if (idx.code < 0) throw Object.assign(new Error('У файлі немає колонки «Артикул товару» — завантажте вивантаження товарів з Кабінету постачальника Розетки (CSV).'), { status: 400 });
  const get = (r, k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
  const out = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const code = get(r, 'code').slice(0, 60);
    if (!code) { skipped++; continue; }
    const hist = /UAH\s*([\d.,\s]+)/.exec(get(r, 'buy'));
    const buy = hist ? numOf(hist[1]) : numOf(get(r, 'buy'));
    out.push({
      code, rz_code: get(r, 'rz_code').replace(/\D/g, '').slice(0, 20), name: get(r, 'name').slice(0, 200),
      rrp: numOf(get(r, 'rrp')), purchase_price: buy ?? numOf(get(r, 'list')), stock: idx.stock >= 0 && get(r, 'stock') !== '' ? Math.max(0, Math.round(numOf(get(r, 'stock')) || 0)) : null,
      status: get(r, 'status').split(' - ')[0].trim().slice(0, 30), brand: get(r, 'brand').slice(0, 60),
    });
  }
  return { rows: out, skipped };
}
