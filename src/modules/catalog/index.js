// Модуль «Каталог»: повний словник товарів LP-CRM у базі (crm_products) — для прив'язки товарів маркетплейсів
// до товарів LP-CRM і пошуку товару у формах. LP-CRM не має методу «всі товари»: лише getProduct за ID, до 50 за запит,
// тож словник наповнює фонова задача «catalog»: проходить ID з 1 до найбільшого відомого партіями по 50, по кілька
// партій за запуск (між запитами до LP-CRM пауза 1,5 с), а після найбільшого ID шукає нові, доки не трапиться
// кілька порожніх партій поспіль. Повний прохід — раз на добу; стан проходу — у settings (catalog_scan).
// Незмінені товари не перезаписуються (економія записів D1).
import { fail, need, nowIso, num, loadSettings, putSetting } from '../../core/common.js';
import { call, lpcrmBusy } from '../../integrations/lpcrm.js';

const BATCH = 50; // товарів за один запит getProduct
const BATCHES_PER_RUN = 6; // запитів до LP-CRM за один запуск задачі (≈9 с)
const EMPTY_TAIL = 3; // стільки порожніх партій поспіль після найбільшого відомого ID — кінець каталогу
const FULL_EVERY_MS = 20 * 3600e3; // повний прохід — не частіше, ніж раз на добу
const SCAN_KEY = 'catalog_scan';
const BRANDS_KEY = 'catalog_brands';
const IMG_RE = /^https?:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?$/i;
// Бренди, які прибираються з початку артикулу при порівнянні: «EvoairComfoDry12» ↔ «COMFODRY12».
export const DEFAULT_BRANDS = 'evoair,levoit,dreo,ihunt,ecovent';

// «Осушувач … (COMFODRY12) [30414]» → { code: '30414', sku: 'COMFODRY12' }: код — останнє число в квадратних дужках,
// артикул — останній код латиницею чи цифрами в круглих дужках без пробілів (кириличне уточнення в дужках — не артикул).
export function parseName(name) {
  const s = String(name || '');
  const code = [...s.matchAll(/\[\s*(\d{3,12})\s*\]/g)].pop()?.[1] || '';
  const sku = [...s.matchAll(/\(([A-Za-z0-9][A-Za-z0-9._/-]{1,40})\)/g)].map((m) => m[1])
    .filter((x) => /[A-Za-z]/.test(x) || /^\d{5,}$/.test(x)).pop() || '';
  return { code, sku };
}
// Нормалізований артикул для точного збігу: малі літери, лише латиниця й цифри, без бренду на початку.
export function normSku(s, brands = DEFAULT_BRANDS) {
  let v = String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!v) return '';
  for (const b of String(brands || '').toLowerCase().split(/[,\s]+/).filter(Boolean)) {
    if (v.length > b.length + 1 && v.startsWith(b)) { v = v.slice(b.length); break; }
  }
  return v;
}

// Товари з відповіді getProduct (масив, мапа id → товар або один товар).
function collectProducts(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return [];
  if (!Array.isArray(node) && ('id' in node || 'product_id' in node) && ('name' in node || 'price' in node)) return [node];
  return Object.values(node).flatMap((v) => collectProducts(v, depth + 1));
}
// Перше посилання на картинку в полях товару (image, img, photo, images[0]…).
function findImage(node, depth = 0) {
  if (typeof node === 'string') return IMG_RE.test(node.trim()) ? node.trim() : '';
  if (!node || typeof node !== 'object' || depth > 3) return '';
  for (const v of Object.values(node)) {
    const found = findImage(v, depth + 1);
    if (found) return found;
  }
  return '';
}
const str = (v, n) => String(v ?? '').trim().slice(0, n);
export function parseProduct(p, brands = DEFAULT_BRANDS) {
  const id = parseInt(p.id ?? p.product_id, 10);
  if (!id) return null;
  const name = str(p.name || p.title, 300);
  const { code, sku } = parseName(name);
  const vendor = p.vendor && p.vendor !== 'Артикул' ? str(p.vendor, 80) : '';
  const model = str(p.model, 80);
  const article = str(p.article, 80);
  const skuFinal = sku || model || vendor || article;
  return {
    product_id: id, name, code: code || (/^\d{3,12}$/.test(article) ? article : ''), sku: skuFinal, skun: normSku(skuFinal, brands), model, vendor,
    category_id: parseInt(p.category_id, 10) || null, price: Math.round(num(p.price) * 100) / 100, image: findImage(p).slice(0, 300),
  };
}

export function mountCatalog(app, { db, fetchFn, onCron = () => {} }) {
  const readState = (raw) => { try { return JSON.parse(raw || '{}') || {}; } catch { return {}; } };
  const brandsOf = (s) => String(s?.[BRANDS_KEY] ?? '').trim() || DEFAULT_BRANDS;
  const brands = async () => brandsOf(await loadSettings(db));
  const maxKnownId = async () => {
    const own = (await db.get(`SELECT MAX(product_id) AS m FROM crm_products`))?.m || 0;
    const an = (await db.get(`SELECT MAX(product_id) AS m FROM an_products`).catch(() => null))?.m || 0;
    return Math.max(own, an, 0);
  };

  async function upsert(found, requested) {
    const now = nowIso();
    const st = found.map((p) => [
      `INSERT INTO crm_products (product_id, name, namel, code, sku, skun, model, vendor, category_id, price, image, active, checked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET name = excluded.name, namel = excluded.namel, code = excluded.code, sku = excluded.sku, skun = excluded.skun, model = excluded.model,
         vendor = excluded.vendor, category_id = excluded.category_id, price = excluded.price, image = excluded.image, active = 1,
         checked_at = excluded.checked_at, updated_at = excluded.updated_at
       WHERE crm_products.name IS NOT excluded.name OR crm_products.code IS NOT excluded.code OR crm_products.sku IS NOT excluded.sku
         OR crm_products.skun IS NOT excluded.skun OR crm_products.model IS NOT excluded.model OR crm_products.vendor IS NOT excluded.vendor
         OR crm_products.category_id IS NOT excluded.category_id OR crm_products.price IS NOT excluded.price OR crm_products.image IS NOT excluded.image
         OR crm_products.active != 1`,
      [p.product_id, p.name, p.name.toLowerCase(), p.code, p.sku, p.skun, p.model, p.vendor, p.category_id, p.price, p.image, now, now],
    ]);
    // Запитані ID, яких у відповіді немає, — товар видалено в LP-CRM: позначаємо неактивним (прив'язки лишаються).
    const gone = requested.filter((id) => !found.some((p) => p.product_id === id));
    if (gone.length) st.push([`UPDATE crm_products SET active = 0, checked_at = ? WHERE product_id IN (SELECT value FROM json_each(?)) AND active = 1`, [now, JSON.stringify(gone)]]);
    if (st.length) await db.batch(st);
  }

  // Прохід по товарах: force — запуск вручну (не чекає доби й черги до LP-CRM).
  async function scan({ force = false } = {}) {
    const s = await loadSettings(db);
    if (!s.lpcrm_subdomain || !s.lpcrm_key) return { skipped: 'LP-CRM не налаштовано' };
    if (!force && lpcrmBusy()) return { skipped: 'LP-CRM зараз зайнята іншими запитами' };
    let st = readState(s[SCAN_KEY]);
    if (!st.cursor) {
      if (!force && st.done_at && Date.now() - Date.parse(st.done_at) < FULL_EVERY_MS) return { skipped: 'словник оновлено менш як добу тому', total: st.total || 0 };
      st = { cursor: 1, started: nowIso(), done_at: st.done_at || '', max: await maxKnownId(), empty: 0, total: 0 };
    }
    const brandList = brandsOf(s);
    let saved = 0;
    let batches = 0;
    while (batches < BATCHES_PER_RUN) {
      const ids = Array.from({ length: BATCH }, (_, i) => st.cursor + i);
      const j = await call(fetchFn, s.lpcrm_subdomain, s.lpcrm_key, 'getProduct', { product_id: ids.join(','), status_ignore: '1' });
      if (j.status && j.status !== 'ok' && !j.data) throw new Error(`LP-CRM (каталог): ${j.message || 'не вдалося отримати товари'}`);
      const found = collectProducts(j.data).map((p) => parseProduct(p, brandList)).filter((p) => p && p.product_id >= st.cursor && p.product_id < st.cursor + BATCH);
      await upsert(found, ids);
      batches++;
      saved += found.length;
      st.total += found.length;
      st.cursor += BATCH;
      if (found.length) st.max = Math.max(st.max, ...found.map((p) => p.product_id));
      if (st.cursor > st.max) st.empty = found.length ? 0 : st.empty + 1;
      const done = st.cursor > st.max && st.empty >= EMPTY_TAIL;
      if (done) st = { cursor: 0, started: '', done_at: nowIso(), max: st.max, empty: 0, total: st.total };
      await putSetting(db, SCAN_KEY, JSON.stringify(st)); // після кожної партії — щоб продовжити з місця зупинки
      if (done) break;
    }
    return { saved, batches, done: !st.cursor, cursor: st.cursor || 0, total: st.total };
  }
  onCron('catalog', 'Товари LP-CRM: словник для прив\'язки товарів маркетплейсів (по 50 за запит, кілька партій за запуск, повний прохід раз на добу)', () => scan());

  // ---------- читання для інших модулів ----------
  const J = (a) => JSON.stringify(a);
  const pick = (r) => ({ id: r.product_id, name: r.name, code: r.code, sku: r.sku, active: Boolean(r.active) });
  const byIds = async (ids) => {
    const list = [...new Set(ids.map((x) => Number(x)).filter(Boolean))];
    return list.length ? (await db.all(`SELECT * FROM crm_products WHERE product_id IN (SELECT value FROM json_each(?))`, [J(list)])).map(pick) : [];
  };
  const byCode = async (codes) => {
    const list = [...new Set(codes.map(String).filter(Boolean))];
    return list.length ? (await db.all(`SELECT * FROM crm_products WHERE code IN (SELECT value FROM json_each(?)) ORDER BY active DESC, product_id`, [J(list)])).map(pick) : [];
  };
  const bySkun = async (skuns) => {
    const list = [...new Set(skuns.map(String).filter(Boolean))];
    return list.length ? (await db.all(`SELECT * FROM crm_products WHERE skun != '' AND skun IN (SELECT value FROM json_each(?)) ORDER BY active DESC, product_id`, [J(list)])).map((r) => ({ ...pick(r), skun: r.skun })) : [];
  };
  // Пошук для форм: слова назви (усі мають зустрітись), код «[30414]», ID або артикул.
  async function search(q, limit = 20) {
    const text = String(q || '').trim();
    if (!text) return [];
    const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).slice(0, 6);
    const where = [];
    const args = [];
    if (/^\d{3,12}$/.test(text)) { where.push('code = ?', 'product_id = ?'); args.push(text, Number(text)); }
    const skun = normSku(text, await brands());
    if (skun.length >= 3) { where.push('skun = ?'); args.push(skun); }
    if (words.length) { where.push(`(${words.map(() => 'namel LIKE ?').join(' AND ')})`); args.push(...words.map((w) => `%${w}%`)); }
    if (!where.length) return [];
    return (await db.all(`SELECT * FROM crm_products WHERE ${where.join(' OR ')} ORDER BY active DESC, name LIMIT ?`, [...args, limit])).map(pick);
  }

  app.get('/api/catalog/status', async (c) => {
    need(c, 'market.view');
    const s = await loadSettings(db);
    const cnt = await db.get(`SELECT COUNT(*) AS n, SUM(active) AS active, SUM(CASE WHEN code != '' OR skun != '' THEN 1 ELSE 0 END) AS coded FROM crm_products`);
    return c.json({ total: cnt?.n || 0, active: cnt?.active || 0, coded: cnt?.coded || 0, scan: readState(s[SCAN_KEY]), brands: brandsOf(s), configured: Boolean(s.lpcrm_subdomain && s.lpcrm_key) });
  });
  app.get('/api/catalog/search', async (c) => {
    need(c, 'market.view');
    return c.json({ products: await search(c.req.query('q'), Math.min(50, Number(c.req.query('limit')) || 20)) });
  });
  // Запуск проходу вручну (кілька партій за раз; повторюйте, поки done = false).
  app.post('/api/catalog/scan', async (c) => {
    need(c, 'api');
    return c.json(await scan({ force: true }));
  });
  app.put('/api/catalog/settings', async (c) => {
    need(c, 'api');
    const b = await c.req.json().catch(() => ({}));
    const list = String(b.brands ?? '').toLowerCase().split(/[,\s]+/).map((x) => x.replace(/[^a-z0-9]/g, '')).filter(Boolean);
    if (list.length > 50) throw fail(400, 'Забагато брендів — до 50.');
    await putSetting(db, BRANDS_KEY, list.join(','));
    return c.json({ ok: true, brands: list.join(',') || DEFAULT_BRANDS });
  });

  return { search, byIds, byCode, bySkun, brands, scan, parseName, normSku };
}
