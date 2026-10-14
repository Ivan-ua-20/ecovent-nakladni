// Клієнт LP-CRM. Лише читання: getOrdersByID і getProductsByID.
// Формат запиту LP-CRM: POST https://<піддомен>.lp-crm.biz/api/<метод>.html, поля key + параметри.

// LP-CRM обмежує частоту запитів (відповідає 429 Too Many Requests).
// Тому всі запити йдуть по черзі з паузою між ними, а при 429 — повтор із наростаючою затримкою.
const MIN_GAP_MS = 1500;
const RETRY_DELAYS_MS = [3000, 6000, 12000];
let queue = Promise.resolve();
let lastAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function throttled(task) {
  const run = queue.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await task(); } finally { lastAt = Date.now(); }
  });
  queue = run.catch(() => {});
  return run;
}

export async function call(fetchFn, subdomain, key, method, params, { sleepFn = sleep } = {}) {
  const body = new URLSearchParams({ key, ...params }).toString();
  const doFetch = (url) => throttled(() => fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }));

  let res;
  try {
    res = await doFetch(`https://${subdomain}.lp-crm.biz/api/${method}.html`);
  } catch {
    // http — лише якщо https узагалі не відповів (мережева помилка), а не на кожну відповідь з помилкою
    res = await doFetch(`http://${subdomain}.lp-crm.biz/api/${method}.html`);
  }
  for (let i = 0; res.status === 429 && i < RETRY_DELAYS_MS.length; i++) {
    await sleepFn(RETRY_DELAYS_MS[i]);
    res = await doFetch(`https://${subdomain}.lp-crm.biz/api/${method}.html`);
  }
  const text = await res.text();
  if (res.status === 429) {
    throw new Error('LP-CRM тимчасово обмежила кількість запитів (429). Зачекайте хвилину і натисніть «Сформувати» ще раз.');
  }
  try {
    return JSON.parse(text);
  } catch {
    const clean = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    throw new Error(`LP-CRM повернула не JSON (HTTP ${res.status}): ${clean.slice(0, 200)}`);
  }
}

// Шукає в відповіді об'єкти, схожі на замовлення, на будь-якій глибині
// (LP-CRM може повертати масив, об'єкт за ключами-номерами або одне замовлення без обгортки).
const ORDER_KEYS = ['products', 'bayer_name', 'order_id', 'phone', 'office', 'delivery_adress'];
export function findOrders(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 5) return [];
  if (!Array.isArray(node)) {
    const hits = ORDER_KEYS.filter((k) => k in node).length;
    if (hits >= 2) return [node];
  }
  return Object.values(node).flatMap((v) => findOrders(v, depth + 1));
}

export const asList = (data) => {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === 'object') return Object.values(data);
  return [];
};

const orderCache = new Map(); // orderId -> { at, value }
const productCache = new Map(); // productId -> { at, value }
const ORDER_TTL = 60 * 1000;
const PRODUCT_TTL = 60 * 60 * 1000;

export async function getOrder(fetchFn, creds, orderId, { fresh = false } = {}) {
  const ck = `${creds.subdomain}|${orderId}`;
  const hit = orderCache.get(ck);
  if (!fresh && hit && Date.now() - hit.at < ORDER_TTL) return hit.value;
  const value = await getOrderUncached(fetchFn, creds, orderId);
  orderCache.set(ck, { at: Date.now(), value });
  return value;
}

async function getOrderUncached(fetchFn, { subdomain, key }, orderId) {
  if (!subdomain || !key) {
    throw new Error('Не налаштовано LP-CRM: вкажіть піддомен і API-ключ у розділі «Налаштування».');
  }
  const json = await call(fetchFn, subdomain, key, 'getOrdersByID', { order_id: String(orderId) });
  if (json.status && json.status !== 'ok') {
    const msg = typeof json.data === 'string' ? json.data : json.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`LP-CRM: ${msg}`);
  }
  const list = findOrders(json.data ?? json);
  const order = list.find((o) => String(o.order_id ?? o.id) === String(orderId)) || list[0];
  if (!order) {
    const excerpt = JSON.stringify(json).slice(0, 600);
    throw new Error(`Замовлення №${orderId} не знайдено у відповіді LP-CRM. Відповідь: ${excerpt}`);
  }
  return { order, raw: json };
}

function findProducts(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return [];
  if (!Array.isArray(node) && 'name' in node && ('id' in node || 'product_id' in node) && !('product_id' in node && 'sub_id' in node)) return [node];
  return Object.values(node).flatMap((v) => findProducts(v, depth + 1));
}

// Назви та артикули товарів (метод getProduct, кілька ID через кому).
export async function getProducts(fetchFn, { subdomain, key }, ids) {
  const all = [...new Set(ids.filter(Boolean))];
  const cached = {};
  const unique = [];
  for (const id of all) {
    const h = productCache.get(`${subdomain}|${id}`);
    if (h && Date.now() - h.at < PRODUCT_TTL) cached[id] = h.value;
    else unique.push(id);
  }
  if (!unique.length) return cached;
  try {
    const json = await call(fetchFn, subdomain, key, 'getProduct', { product_id: unique.join(','), status_ignore: '1' });
    const out = {};
    for (const p of findProducts(json.data)) {
      const id = String(p.id ?? p.product_id ?? '');
      if (!id) continue;
      const vendor = p.vendor && p.vendor !== 'Артикул' ? p.vendor : '';
      out[id] = { name: p.name || p.title || '', article: p.article || vendor || p.model || '' };
      productCache.set(`${subdomain}|${id}`, { at: Date.now(), value: out[id] });
    }
    return { ...cached, ...out };
  } catch {
    return cached;
  }
}

export async function getStatuses(fetchFn, { subdomain, key }) {
  const json = await call(fetchFn, subdomain, key, 'getStatuses', {});
  if (json.status !== 'ok') throw new Error(`LP-CRM: ${json.message || 'не вдалося отримати статуси'}`);
  return json.data || {};
}

export async function getOrderCodesByStatus(fetchFn, { subdomain, key }, status, dateStart, dateEnd) {
  const json = await call(fetchFn, subdomain, key, 'getOrdersIdByStatus', { status: String(status), date_start: dateStart, date_end: dateEnd });
  if (json.status !== 'ok') return [];
  return asList(json.data).map(String);
}

// Повні дані кількох замовлень за кодами (до 100 за запит).
export async function getOrdersBatch(fetchFn, { subdomain, key }, codes) {
  const out = [];
  for (let i = 0; i < codes.length; i += 100) {
    const part = codes.slice(i, i + 100);
    const json = await call(fetchFn, subdomain, key, 'getOrdersByID', { order_id: part.join(',') });
    if (json.status === 'ok') out.push(...findOrders(json.data));
  }
  return out;
}

const ymd = (d) => d.toISOString().slice(0, 10);

// Діагностика: показує повну структуру одного реального замовлення.
export async function diagnose(fetchFn, creds, orderId) {
  const lines = [];
  const log = (title, v) => lines.push(`▶ ${title}\n${(typeof v === 'string' ? v : JSON.stringify(v, null, 1)).slice(0, 3000)}`);
  try {
    log(`getOrdersByID ${orderId}`, await call(fetchFn, creds.subdomain, creds.key, 'getOrdersByID', { order_id: String(orderId) }));
    const end = new Date();
    const start = new Date(Date.now() - 3 * 86400000);
    const codes = await getOrderCodesByStatus(fetchFn, creds, 11, ymd(start), ymd(end));
    log('getOrdersIdByStatus 11 (останні 3 дні)', codes.slice(0, 10));
    if (codes.length) {
      const one = await call(fetchFn, creds.subdomain, creds.key, 'getOrdersByID', { order_id: codes[0] });
      log(`getOrdersByID ${codes[0]} (приклад)`, one);
      const order = findOrders(one.data)[0];
      const pid = order?.products && asList(order.products)[0]?.product_id;
      if (pid) log(`getProduct ${pid}`, await call(fetchFn, creds.subdomain, creds.key, 'getProduct', { product_id: String(pid), status_ignore: '1' }));
    }
  } catch (e) {
    log('ПОМИЛКА', e.message);
  }
  return lines.join('\n\n');
}
