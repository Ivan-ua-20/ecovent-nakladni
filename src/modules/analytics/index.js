// Аналітика продажів: завантаження замовлень з LP-CRM у базу, налаштування (відділи, джерела, менеджери,
// бренди, таргети) і запити для дашборду. Доступ — лише власник і адміністратори (право 'analytics').
//
// Обмеження безкоштовного Cloudflare враховано:
//  - завантаження йде кроками (кожне звернення — до ~8 запитів у LP-CRM), браузер повторює кроки сам;
//  - підсумки рахує база (GROUP BY), щоб воркер не витрачав процесорний час;
//  - мінімум індексів, щоб не перевищити 100 тис. записів у базу на добу.
import { call, asList, findOrders } from '../../integrations/lpcrm.js';
import { can, crmLogins } from '../../core/auth.js';
import { fail, need, nowIso, num, round2, kyivDay, loadSettings } from '../../core/common.js';

export { kyivDay };

// ---------- дати (дні у форматі YYYY-MM-DD, за київським часом) ----------
const toUtc = (day) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day, n) => fromUtc(toUtc(day) + n * 86400000);
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000) + 1; // включно
export const monthStart = (day) => `${day.slice(0, 7)}-01`;
export const daysInMonth = (day) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7), 0)).getUTCDate();
export const monthEnd = (day) => `${day.slice(0, 7)}-${String(daysInMonth(day)).padStart(2, '0')}`;
export function addMonths(day, n) {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return fromUtc(d.getTime());
}
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

const low = (v) => String(v ?? '').trim().toLowerCase();
// Дозаповнення служби доставки для старих замовлень: не більше за добу і за одне оновлення (ліміт записів D1).
const DELIV_PER_DAY = 15000;
const DELIV_PER_RUN = 3000;

export const AN_DEFAULTS = {
  compare: true,
  deptPriority: 'manager',
  targetBase: 'net',
  months: 6,
  okStatuses: [11, 14, 53, 18],
  refuseStatuses: [54, 58],
};

// ---------- відповідності: відділ, джерело, бренд ----------
async function loadMaps(db, st) {
  const [offices, managers, sources, brands, srcRows] = await Promise.all([
    db.all(`SELECT office, dept_id FROM an_office_map`),
    db.all(`SELECT login, dept_id, depts FROM an_managers`),
    db.all(`SELECT value, source_id FROM an_source_map`),
    db.all(`SELECT id, keywords FROM an_brands ORDER BY sort, id`),
    db.all(`SELECT id, dept_id FROM an_sources`),
  ]);
  return {
    prio: st.deptPriority,
    office: new Map(offices.map((r) => [String(r.office), r.dept_id])),
    mgr: new Map(managers.filter((r) => r.dept_id).map((r) => [low(r.login), r.dept_id])),
    mgrSet: new Map(managers.filter((r) => r.dept_id && String(r.depts || '').includes(',')).map((r) => [low(r.login), new Set(String(r.depts).split(',').map(Number))])),
    srcDept: new Map(srcRows.map((r) => [r.id, r.dept_id])),
    src: new Map(sources.map((r) => [r.value, r.source_id])),
    brands: brands.map((b) => ({ id: b.id, kws: String(b.keywords || '').split(',').map(low).filter(Boolean) })),
  };
}
// Менеджер у кількох відділах: відділ джерела замовлення («Поле 1»), якщо він серед його відділів,
// потім відділ LP-CRM, якщо він серед його відділів, інакше — основний відділ менеджера.
const mgrDept = (o, m, src) => {
  const set = m.mgrSet.get(o.user);
  if (set) {
    const sd = src ? m.srcDept.get(src) : null;
    if (sd && set.has(sd)) return sd;
    const od = m.office.get(o.office);
    if (od && set.has(od)) return od;
  }
  return m.mgr.get(o.user);
};
const deptOf = (o, m, src) => (m.prio === 'office'
  ? m.office.get(o.office) ?? mgrDept(o, m, src) ?? 0
  : mgrDept(o, m, src) ?? m.office.get(o.office) ?? 0);
const srcOf = (o, m) => (o.ch && m.src.get(o.ch)) || (o.site && m.src.get(o.site)) || (o.utm && m.src.get(o.utm)) || 0;
export function brandOf(name, brands) {
  const n = low(name);
  for (const b of brands) if (b.kws.some((k) => n.includes(k))) return b.id;
  return 0;
}

// Перерахунок відділу і джерела в усіх замовленнях (після зміни відповідностей). Пише лише змінені рядки.
// Перерахунок відділу і/або джерела в усіх замовленнях (після зміни відповідностей). Пише лише змінені рядки.
export async function remap(db, st, { dept = true, src = true } = {}) {
  // спершу джерело — від нього залежить відділ менеджера, що працює в кількох відділах
  if (src) {
    const one = (col) => `CASE WHEN an_orders.${col} != '' THEN (SELECT source_id FROM an_source_map s WHERE s.value = an_orders.${col}) END`;
    const x = `COALESCE(${one('ch')}, ${one('site')}, ${one('utm')}, 0)`;
    await db.run(`UPDATE an_orders SET src = ${x} WHERE src IS NOT ${x}`);
  }
  if (dept || src) {
    const deptOff = `(SELECT dept_id FROM an_office_map f WHERE f.office = an_orders.office)`;
    const deptSrc = `(SELECT dept_id FROM an_sources s WHERE s.id = an_orders.src)`;
    const inSet = (x) => `(',' || m.depts || ',') LIKE ('%,' || ${x} || ',%')`;
    const deptMgr = `(SELECT CASE
        WHEN m.depts LIKE '%,%' AND ${deptSrc} IS NOT NULL AND ${inSet(deptSrc)} THEN ${deptSrc}
        WHEN m.depts LIKE '%,%' AND ${deptOff} IS NOT NULL AND ${inSet(deptOff)} THEN ${deptOff}
        ELSE m.dept_id END
      FROM an_managers m WHERE m.login = an_orders.user AND m.dept_id IS NOT NULL)`;
    const d = st.deptPriority === 'office' ? `COALESCE(${deptOff}, ${deptMgr}, 0)` : `COALESCE(${deptMgr}, ${deptOff}, 0)`;
    // джерело змінює відділ лише менеджерам із кількома відділами
    const where = dept ? '' : ` AND user IN (SELECT login FROM an_managers WHERE depts LIKE '%,%')`;
    await db.run(`UPDATE an_orders SET dept = ${d} WHERE dept IS NOT ${d}${where}`);
  }
}

// Бренд товару: ручний вибір → бренд у назві товару → бренд у назві категорії → 0 («Інші»).
export async function rebrand(db) {
  const brands = (await db.all(`SELECT id, keywords FROM an_brands ORDER BY sort, id`))
    .map((b) => ({ id: b.id, kws: String(b.keywords || '').split(',').map(low).filter(Boolean) }));
  const prods = await db.all(`SELECT p.product_id, p.name, p.brand_id, p.brand_manual, c.name AS cat
    FROM an_products p LEFT JOIN an_categories c ON c.id = COALESCE(p.cat_manual, p.category_id)`);
  const upd = [];
  for (const p of prods) {
    const b = p.brand_manual != null ? p.brand_manual : (brandOf(p.name, brands) || brandOf(p.cat || '', brands));
    if (b !== p.brand_id) upd.push([`UPDATE an_products SET brand_id = ? WHERE product_id = ?`, [b, p.product_id]]);
  }
  await db.batch(upd);
  return upd.length;
}

// ---------- замовлення LP-CRM → рядки бази ----------
export function normalizeAnOrder(raw) {
  const id = parseInt(raw.id, 10);
  const day = String(raw.datetime || '').slice(0, 10);
  if (!id || !isDay(day)) return null;
  const lines = asList(raw.products).slice(0, 99).map((p) => ({
    product_id: parseInt(p.product_id, 10) || 0,
    name: String(p.name || p.product_name || '').trim(),
    qty: num(p.quantity ?? p.count) || 0,
    price: num(p.price),
  }));
  const sumLines = lines.reduce((s, l) => s + l.qty * l.price, 0);
  let total = num(raw.total);
  if (total <= 0 && sumLines > 0) total = sumLines;
  // Знижка замовлення розподіляється на товари пропорційно: сума рядків = фактична сума замовлення.
  const k = sumLines > 0 ? total / sumLines : 0;
  for (const l of lines) l.amount = round2(l.qty * l.price * k);
  return {
    id,
    code: String(raw.order_id || ''),
    day,
    status: parseInt(raw.status, 10) || 0,
    office: String(raw.office ?? ''),
    user: low(raw.user),
    ch: low(raw.additional_1),
    site: low(raw.site),
    utm: low(raw.utm_source),
    total: round2(total),
    deliv: delivName(raw),
    lines,
  };
}

// Назва служби доставки з замовлення LP-CRM (якщо замість назви число — «служба №…»).
export function delivName(raw) {
  const name = String(raw.delivery_name ?? raw.delivery ?? '').trim();
  if (name && !/^\d+$/.test(name)) return name.slice(0, 80);
  const id = String(raw.delivery_id ?? (name || '')).trim();
  return id && id !== '0' ? `служба №${id}` : '';
}

// Група служби доставки для аналітики: схожі назви — в одну.
const DELIV_GROUPS = [
  [/нов[аі]\s*(пошт|почт)|nova\s*po(st|sh)|^(нп|np)(?![a-zа-яіїєґ])/i, 'Нова пошта'],
  [/укр\s*(пошт|почт)|ukr\s*posh/i, 'Укрпошта'],
  [/розетк|rozetka/i, 'Розетка'],
  [/meest|міст\s*експрес|мист\s*экспресс|^міст(?![a-zа-яіїєґ])/i, 'Meest'],
  [/самовив|самовыв|pickup|самостійн/i, 'Самовивіз'],
  [/justin|джастін/i, 'Justin'],
  [/кур.?єр|курьер|courier|адресн/i, 'Кур’єр'],
];
export function delivGroup(name) {
  if (name == null) return 'Ще завантажується';
  if (!String(name).trim()) return 'Не вказано';
  for (const [re, g] of DELIV_GROUPS) if (re.test(name)) return g;
  return String(name).trim();
}

async function saveOrders(db, orders, maps) {
  const st = [];
  const bounds = new Map();
  for (const o of orders) {
    st.push([
      `INSERT INTO an_orders (id, code, day, status, office, user, ch, site, utm, total, dept, src, deliv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code = excluded.code, day = excluded.day, status = excluded.status, office = excluded.office,
       user = excluded.user, ch = excluded.ch, site = excluded.site, utm = excluded.utm, total = excluded.total, dept = excluded.dept, src = excluded.src,
       deliv = excluded.deliv`,
      [o.id, o.code, o.day, o.status, o.office, o.user, o.ch, o.site, o.utm, o.total, deptOf(o, maps, srcOf(o, maps)), srcOf(o, maps), o.deliv ?? ''],
    ]);
    st.push([`DELETE FROM an_items WHERE id BETWEEN ? AND ?`, [o.id * 100, o.id * 100 + 99]]);
    o.lines.forEach((l, n) => {
      st.push([`INSERT INTO an_items (id, product_id, qty, amount) VALUES (?, ?, ?, ?)`, [o.id * 100 + n, l.product_id, l.qty, l.amount]]);
      if (l.product_id) {
        st.push([`INSERT OR IGNORE INTO an_products (product_id, name, brand_id) VALUES (?, ?, ?)`, [l.product_id, l.name, brandOf(l.name, maps.brands)]]);
      }
    });
    const b = bounds.get(o.day) || [o.id, o.id];
    bounds.set(o.day, [Math.min(b[0], o.id), Math.max(b[1], o.id)]);
  }
  for (const [day, [lo, hi]] of bounds) {
    st.push([
      `INSERT INTO an_day_bounds (day, min_id, max_id) VALUES (?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET min_id = MIN(min_id, excluded.min_id), max_id = MAX(max_id, excluded.max_id)
       WHERE excluded.min_id < an_day_bounds.min_id OR excluded.max_id > an_day_bounds.max_id`,
      [day, lo, hi],
    ]);
  }
  await db.batch(st);
}

async function idRange(db, from, to) {
  const r = await db.get(`SELECT MIN(min_id) AS lo, MAX(max_id) AS hi FROM an_day_bounds WHERE day BETWEEN ? AND ?`, [from, to]);
  return r && r.lo != null ? [r.lo, r.hi] : null;
}

function findProducts(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return [];
  if (!Array.isArray(node) && ('category_id' in node) && ('id' in node || 'product_id' in node)) return [node];
  return Object.values(node).flatMap((v) => findProducts(v, depth + 1));
}
function flattenCategories(node, parent = null, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 10) return out;
  for (const c of Array.isArray(node) ? node : Object.values(node)) {
    if (!c || typeof c !== 'object') continue;
    const id = parseInt(c.id, 10);
    if (id) out.push({ id, name: String(c.name || ''), parent_id: c.parent_id != null ? parseInt(c.parent_id, 10) || null : parent });
    if (c.subcategories) flattenCategories(c.subcategories, id || parent, out, depth + 1);
  }
  return out;
}

// =====================================================================
export function mountAnalytics(app, { db, fetchFn, services = {}, shared = {} }) {
  const settings = () => loadSettings(db);
  const getSt = async () => {
    const r = await db.get(`SELECT value FROM settings WHERE key = 'an_settings'`);
    let v = {};
    try { v = r?.value ? JSON.parse(r.value) : {}; } catch { /* пошкоджено */ }
    return { ...AN_DEFAULTS, ...v };
  };
  const putSetting = (key, value) => db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value],
  );
  const getJson = async (key) => {
    const r = await db.get(`SELECT value FROM settings WHERE key = ?`, [key]);
    try { return r?.value ? JSON.parse(r.value) : null; } catch { return null; }
  };
  const creds = async () => {
    const s = await settings();
    if (!s.lpcrm_subdomain || !s.lpcrm_key) throw fail(400, 'Не налаштовано LP-CRM: вкажіть API-ключ у загальних налаштуваннях.');
    return { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key };
  };
  const lp = (c, method, params) => call(fetchFn, c.subdomain, c.key, method, params);

  // Версія даних: змінюється після оновлення з CRM і зміни налаштувань — збережені відповіді дашборду стають недійсними.
  const bump = () => db.batch([
    [`INSERT INTO settings (key, value) VALUES ('an_ver', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(Date.now())]],
    [`DELETE FROM an_cache`, []],
  ]);

  // Довідник значень із замовлень (Поле 1 / сайт / utm, менеджери, відділи CRM, продажі товарів) — рахується
  // під час щоденного/повного оновлення і зберігається, щоб налаштування не перечитували всі замовлення.
  async function computeValues() {
    const [ch, site, utm, users, offices, sold] = await Promise.all([
      db.all(`SELECT ch AS v, COUNT(*) AS n FROM an_orders WHERE ch != '' GROUP BY ch`),
      db.all(`SELECT site AS v, COUNT(*) AS n FROM an_orders WHERE site != '' GROUP BY site`),
      db.all(`SELECT utm AS v, COUNT(*) AS n FROM an_orders WHERE utm != '' GROUP BY utm`),
      db.all(`SELECT user AS v, COUNT(*) AS n FROM an_orders WHERE user != '' GROUP BY user ORDER BY n DESC`),
      db.all(`SELECT office AS v, COUNT(*) AS n FROM an_orders GROUP BY office ORDER BY n DESC`),
      db.all(`SELECT product_id AS id, SUM(qty) AS q FROM an_items GROUP BY product_id`),
    ]);
    const values = new Map();
    for (const [field, rows] of [['Поле 1', ch], ['Сайт', site], ['utm_source', utm]]) {
      for (const r of rows) {
        const cur = values.get(r.v) || { value: r.v, n: 0, fields: [] };
        cur.n += r.n;
        cur.fields.push(field);
        values.set(r.v, cur);
      }
    }
    const data = {
      at: nowIso(),
      values: [...values.values()].sort((a, b) => b.n - a.n),
      users,
      offices,
      sold: Object.fromEntries(sold.map((r) => [r.id, r.q])),
    };
    await putSetting('an_values', JSON.stringify(data));
    return data;
  }
  // Після оновлення «за сьогодні»: лише додаємо нові значення з сьогоднішніх замовлень.
  async function mergeTodayValues(day) {
    const cur = await getJson('an_values');
    if (!cur) return computeValues();
    const r = await idRange(db, day, day);
    if (!r) return cur;
    const rows = await db.all(`SELECT ch, site, utm, user, office FROM an_orders WHERE id BETWEEN ? AND ? AND day = ?`, [r[0], r[1], day]);
    const has = (list, v, key = 'v') => list.some((x) => x[key] === v);
    for (const o of rows) {
      for (const [field, v] of [['Поле 1', o.ch], ['Сайт', o.site], ['utm_source', o.utm]]) {
        if (v && !has(cur.values, v, 'value')) cur.values.push({ value: v, n: 1, fields: [field] });
      }
      if (o.user && !has(cur.users, o.user)) cur.users.push({ v: o.user, n: 1 });
      if (o.office && !has(cur.offices, o.office)) cur.offices.push({ v: o.office, n: 1 });
    }
    await putSetting('an_values', JSON.stringify(cur));
    return cur;
  }

  // Доступ: власник і адміністратори — усе; менеджер — лише дашборд зі своїми замовленнями
  // (за логінами LP-CRM, прив'язаними в «Користувачах») і оновлення даних.
  const OWN_ALLOWED = new Set(['POST /api/an/query', 'GET /api/an/sync', 'POST /api/an/sync/start', 'POST /api/an/sync/step']);
  app.use('/api/an/*', async (c, next) => {
    const user = c.get('user');
    if (!can(user, 'analytics')) {
      need(c, 'an.view');
      if (!OWN_ALLOWED.has(`${c.req.method} ${c.req.path}`)) throw fail(403, 'Недостатньо прав для цієї дії.');
      c.set('anOwn', crmLogins(user.crm_logins));
    }
    if (!shared.anRemapChecked) {
      shared.anRemapChecked = true;
      const f = await db.get(`SELECT value FROM settings WHERE key = 'an_need_remap'`);
      if (f?.value === '1') {
        await remap(db, await getSt());
        await rebrand(db);
        await db.run(`UPDATE settings SET value = '0' WHERE key = 'an_need_remap'`);
        await bump();
      }
    }
    return next();
  });

  // ---------------------------------------------------------------- налаштування
  app.get('/api/an/config', async (c) => {
    const [st, depts, sources, smap, officeMap, managers, brands, offices, statusNames, lastSync, sync, categories] = await Promise.all([
      getSt(),
      db.all(`SELECT id, name, sort FROM an_depts ORDER BY sort, id`),
      db.all(`SELECT id, dept_id, name, sort FROM an_sources ORDER BY sort, id`),
      db.all(`SELECT value, source_id FROM an_source_map ORDER BY value`),
      db.all(`SELECT office, dept_id FROM an_office_map`),
      db.all(`SELECT login, name, dept_id, depts FROM an_managers ORDER BY name, login`),
      db.all(`SELECT id, name, keywords, sort FROM an_brands ORDER BY sort, id`),
      db.all(`SELECT office_id, name FROM offices ORDER BY CAST(office_id AS INTEGER)`),
      getJson('an_status_names'),
      db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`),
      getJson('an_sync'),
      db.all(`SELECT id, name, parent_id FROM an_categories ORDER BY name`),
    ]);
    return c.json({
      categories,
      settings: st,
      depts: depts.map((d) => ({
        ...d,
        sources: sources.filter((s) => s.dept_id === d.id).map((s) => ({ ...s, values: smap.filter((m) => m.source_id === s.id).map((m) => m.value) })),
      })),
      officeMap,
      managers,
      brands,
      offices,
      statusNames: statusNames || {},
      lastSync: lastSync?.value || '',
      sync: sync ? { phase: sync.phase, startedAt: sync.startedAt, mode: sync.mode, error: sync.error || '' } : null,
    });
  });

  // Значення з замовлень, які ще треба розподілити (з довідника, без перечитування замовлень).
  app.get('/api/an/values', async (c) => {
    const v = (await getJson('an_values')) || (await computeValues());
    return c.json({ values: v.values, users: v.users, offices: v.offices, at: v.at });
  });

  // ---------------------------------------------------------------- «Потребує уваги»
  const ignored = async () => ({ users: [], values: [], offices: [], ...((await getJson('an_ignored')) || {}) });
  app.get('/api/an/attention', async (c) => {
    const [v0, ig, smap, mgrs, omap, prod] = await Promise.all([
      getJson('an_values'), ignored(),
      db.all(`SELECT value FROM an_source_map`),
      db.all(`SELECT login FROM an_managers`),
      db.all(`SELECT office FROM an_office_map`),
      db.get(`SELECT SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END) AS fresh,
        SUM(CASE WHEN brand_id = 0 AND brand_manual IS NULL THEN 1 ELSE 0 END) AS nobrand,
        SUM(CASE WHEN COALESCE(cat_manual, category_id, 0) = 0 AND cat_manual IS NULL THEN 1 ELSE 0 END) AS nocat
        FROM an_products`),
    ]);
    const vals = v0 || (await computeValues());
    const mapped = new Set(smap.map((r) => r.value));
    const known = new Set(mgrs.map((r) => r.login));
    const offs = new Set(omap.map((r) => String(r.office)));
    const out = {
      values: vals.values.filter((x) => !mapped.has(x.value) && !ig.values.includes(x.value)),
      users: vals.users.filter((x) => !known.has(x.v) && !ig.users.includes(x.v)),
      offices: vals.offices.filter((x) => x.v !== '' && !offs.has(String(x.v)) && !ig.offices.includes(String(x.v))),
      products: { fresh: prod?.fresh || 0, nobrand: prod?.nobrand || 0, nocat: prod?.nocat || 0 },
      ignored: ig,
    };
    out.total = out.values.length + out.users.length + out.offices.length + out.products.fresh + out.products.nobrand + out.products.nocat;
    return c.json(out);
  });

  app.put('/api/an/ignore', async (c) => {
    const b = await c.req.json();
    if (!['users', 'values', 'offices'].includes(b.kind)) throw fail(400, 'Невідомий тип.');
    const ig = await ignored();
    const v = String(b.value ?? '');
    ig[b.kind] = b.on ? [...new Set([...ig[b.kind], v])] : ig[b.kind].filter((x) => x !== v);
    await putSetting('an_ignored', JSON.stringify(ig));
    return c.json({ ok: true, ignored: ig });
  });

  // Товари: список для ручної прив'язки бренду і категорії
  app.get('/api/an/products', async (c) => {
    const [rows, cats, v] = await Promise.all([
      db.all(`SELECT product_id AS id, name, category_id, cat_manual, brand_id, brand_manual, seen FROM an_products ORDER BY seen, name`),
      db.all(`SELECT id, name, parent_id FROM an_categories ORDER BY name`),
      getJson('an_values'),
    ]);
    const sold = v?.sold || {};
    return c.json({ products: rows.map((r) => ({ ...r, sold: sold[r.id] || 0 })), categories: cats });
  });

  app.put('/api/an/products', async (c) => {
    const list = await c.req.json();
    const norm = (x) => (x === '' || x == null ? null : parseInt(x, 10));
    const st = (Array.isArray(list) ? list : []).filter((r) => parseInt(r.id, 10)).map((r) => [
      `UPDATE an_products SET brand_manual = ?, cat_manual = ?, seen = 1 WHERE product_id = ?`,
      [norm(r.brand_manual), norm(r.cat_manual), parseInt(r.id, 10)],
    ]);
    await db.batch(st);
    const changed = await rebrand(db);
    await bump();
    return c.json({ ok: true, changed });
  });

  app.post('/api/an/products/seen', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((x) => parseInt(x, 10)).filter(Boolean);
    if (ids.length) await db.run(`UPDATE an_products SET seen = 1 WHERE product_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]);
    else await db.run(`UPDATE an_products SET seen = 1 WHERE seen = 0`);
    return c.json({ ok: true });
  });

  app.put('/api/an/settings', async (c) => {
    const b = await c.req.json();
    const cur = await getSt();
    const next = { ...cur };
    if (b.compare !== undefined) next.compare = Boolean(b.compare);
    if (['manager', 'office'].includes(b.deptPriority)) next.deptPriority = b.deptPriority;
    if (['net', 'all'].includes(b.targetBase)) next.targetBase = b.targetBase;
    if (b.months !== undefined) next.months = Math.min(18, Math.max(1, parseInt(b.months, 10) || 6));
    await putSetting('an_settings', JSON.stringify(next));
    if (next.deptPriority !== cur.deptPriority) await remap(db, next, { src: false });
    await bump();
    return c.json({ ok: true, settings: next });
  });

  // Відділи з джерелами і значеннями — зберігаються цілком.
  app.put('/api/an/structure', async (c) => {
    const b = await c.req.json();
    const list = Array.isArray(b.depts) ? b.depts : [];
    const oldDepts = await db.all(`SELECT id FROM an_depts`);
    const oldSources = await db.all(`SELECT id FROM an_sources`);
    const keepD = new Set();
    const keepS = new Set();
    const st = [];
    const seenValues = new Set();
    let di = 0;
    for (const d of list) {
      const name = String(d.name || '').trim();
      if (!name) continue;
      let id = parseInt(d.id, 10) || 0;
      if (id && oldDepts.some((x) => x.id === id)) {
        await db.run(`UPDATE an_depts SET name = ?, sort = ? WHERE id = ?`, [name, di, id]);
      } else {
        id = (await db.run(`INSERT INTO an_depts (name, sort) VALUES (?, ?)`, [name, di])).lastId;
      }
      di++;
      keepD.add(id);
      let si = 0;
      for (const s of d.sources || []) {
        const sname = String(s.name || '').trim();
        if (!sname) continue;
        let sid = parseInt(s.id, 10) || 0;
        if (sid && oldSources.some((x) => x.id === sid)) {
          await db.run(`UPDATE an_sources SET name = ?, dept_id = ?, sort = ? WHERE id = ?`, [sname, id, si, sid]);
        } else {
          sid = (await db.run(`INSERT INTO an_sources (dept_id, name, sort) VALUES (?, ?, ?)`, [id, sname, si])).lastId;
        }
        si++;
        keepS.add(sid);
        for (const v of s.values || []) {
          const val = low(v);
          if (!val || seenValues.has(val)) continue;
          seenValues.add(val);
          st.push([`INSERT INTO an_source_map (value, source_id) VALUES (?, ?)`, [val, sid]]);
        }
      }
    }
    const goneD = oldDepts.map((x) => x.id).filter((id) => !keepD.has(id));
    const goneS = oldSources.map((x) => x.id).filter((id) => !keepS.has(id));
    const del = [[`DELETE FROM an_source_map`, []]];
    for (const id of goneD) {
      del.push([`DELETE FROM an_depts WHERE id = ?`, [id]]);
      del.push([`DELETE FROM an_targets WHERE kind = 'dept' AND ref_id = ?`, [id]]);
      del.push([`UPDATE an_office_map SET dept_id = NULL WHERE dept_id = ?`, [id]]);
      del.push([`UPDATE an_managers SET dept_id = NULL, depts = '' WHERE dept_id = ?`, [id]]);
      del.push([`UPDATE an_managers SET depts = TRIM(REPLACE(',' || depts || ',', ',' || ? || ',', ','), ',') WHERE depts LIKE '%,%'`, [id]]);
    }
    for (const id of goneS) {
      del.push([`DELETE FROM an_sources WHERE id = ?`, [id]]);
      del.push([`DELETE FROM an_targets WHERE kind = 'src' AND ref_id = ?`, [id]]);
    }
    await db.batch([...del, ...st]);
    await remap(db, await getSt());
    await bump();
    return c.json({ ok: true });
  });

  app.put('/api/an/office-map', async (c) => {
    const list = await c.req.json();
    const st = [[`DELETE FROM an_office_map`, []]];
    for (const r of Array.isArray(list) ? list : []) {
      if (!String(r.office ?? '').trim() || !r.dept_id) continue;
      st.push([`INSERT OR REPLACE INTO an_office_map (office, dept_id) VALUES (?, ?)`, [String(r.office).trim(), parseInt(r.dept_id, 10)]]);
    }
    await db.batch(st);
    await remap(db, await getSt(), { src: false });
    await bump();
    return c.json({ ok: true });
  });

  app.put('/api/an/managers', async (c) => {
    const list = await c.req.json();
    const st = [[`DELETE FROM an_managers`, []]];
    for (const r of Array.isArray(list) ? list : []) {
      const login = low(r.login);
      if (!login) continue;
      // dept_id — основний відділ; depts — усі відділи менеджера (основний перший), через кому
      const main = parseInt(r.dept_id, 10) || null;
      const all = main ? [...new Set([main, ...(Array.isArray(r.depts) ? r.depts : String(r.depts || '').split(',')).map((x) => parseInt(x, 10)).filter(Boolean)])] : [];
      st.push([`INSERT OR REPLACE INTO an_managers (login, name, dept_id, depts) VALUES (?, ?, ?, ?)`, [login, String(r.name || '').trim(), main, all.join(',')]]);
    }
    await db.batch(st);
    await remap(db, await getSt(), { src: false });
    await bump();
    return c.json({ ok: true });
  });

  app.put('/api/an/brands', async (c) => {
    const list = await c.req.json();
    const old = await db.all(`SELECT id FROM an_brands`);
    const keep = new Set();
    let i = 0;
    for (const r of Array.isArray(list) ? list : []) {
      const name = String(r.name || '').trim();
      if (!name) continue;
      const kws = String(r.keywords || name).split(',').map(low).filter(Boolean).join(', ');
      let id = parseInt(r.id, 10) || 0;
      if (id && old.some((x) => x.id === id)) await db.run(`UPDATE an_brands SET name = ?, keywords = ?, sort = ? WHERE id = ?`, [name, kws, i, id]);
      else id = (await db.run(`INSERT INTO an_brands (name, keywords, sort) VALUES (?, ?, ?)`, [name, kws, i])).lastId;
      keep.add(id);
      i++;
    }
    await db.batch(old.filter((x) => !keep.has(x.id)).map((x) => [`DELETE FROM an_brands WHERE id = ?`, [x.id]]));
    const changed = await rebrand(db);
    await bump();
    return c.json({ ok: true, changed });
  });

  app.get('/api/an/targets', async (c) => {
    const month = String(c.req.query('month') || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw fail(400, 'Невірний місяць.');
    return c.json({ month, rows: await db.all(`SELECT kind, ref_id, amount FROM an_targets WHERE month = ?`, [month]) });
  });

  app.put('/api/an/targets', async (c) => {
    const b = await c.req.json();
    const month = String(b.month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw fail(400, 'Невірний місяць.');
    const rows = (Array.isArray(b.rows) ? b.rows : [])
      .filter((r) => ['dept', 'src'].includes(r.kind) && parseInt(r.ref_id, 10) && num(r.amount) > 0)
      .map((r) => [r.kind, parseInt(r.ref_id, 10), round2(num(r.amount))]);
    const copy = Math.min(12, Math.max(0, parseInt(b.copyMonths, 10) || 0));
    const st = [];
    for (let k = 0; k <= copy; k++) {
      const m = addMonths(`${month}-01`, k).slice(0, 7);
      st.push([`DELETE FROM an_targets WHERE month = ?`, [m]]);
      for (const [kind, ref, amount] of rows) st.push([`INSERT INTO an_targets (month, kind, ref_id, amount) VALUES (?, ?, ?, ?)`, [m, kind, ref, amount]]);
    }
    await db.batch(st);
    await bump();
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- завантаження з LP-CRM
  app.get('/api/an/sync', async (c) => {
    const [state, last, daily] = await Promise.all([
      getJson('an_sync'),
      db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`),
      db.get(`SELECT value FROM settings WHERE key = 'an_last_daily'`),
    ]);
    const lastDaily = daily?.value || '';
    const running = state && state.phase !== 'done' && !state.error;
    // Щодобове оновлення за 30 днів: запускається автоматично, якщо минуло понад 20 годин.
    const dailyDue = !running && !!last?.value && (!lastDaily || Date.now() - Date.parse(lastDaily) > 20 * 3600e3);
    return c.json({ state: state ? summary(state) : null, lastSync: last?.value || '', lastDaily, dailyDue });
  });

  function summary(s) {
    const left = s.units?.length || 0;
    const total = s.unitsTotal || 1;
    let pct = s.phase === 'units' ? Math.round(((total - left) / total) * 90) : s.phase === 'done' ? 100 : 95;
    if (pct < 1) pct = 1;
    const u = s.units?.[0];
    const status = u ? (s.statusNames?.[u.s] || `статус ${u.s}`) : '';
    const text = s.phase === 'units' && u
      ? `${u.from.slice(0, 7)} · ${status}`
      : s.phase === 'units' && s.pending?.length ? `Дозавантаження ${s.pending.length} замовлень`
      : s.phase === 'deliv' ? 'Служби доставки (дозаповнення історії)'
      : s.phase === 'products' ? 'Категорії товарів'
        : s.phase === 'categories' ? 'Довідник категорій'
          : s.phase === 'cleanup' ? 'Завершення' : 'Готово';
    return {
      mode: s.mode, phase: s.phase, done: s.phase === 'done', pct, text,
      stats: s.stats, warnings: s.warnings || [], error: s.error || '', startedAt: s.startedAt,
    };
  }

  app.post('/api/an/sync/start', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const mode = ['today', 'full', 'reset'].includes(b.mode) ? b.mode : 'daily';
    if (c.get('anOwn') && !['today', 'daily'].includes(mode)) throw fail(403, 'Недостатньо прав для цієї дії.');
    const cur = await getJson('an_sync');
    if (cur && cur.phase !== 'done' && !cur.error && !b.force) return c.json({ state: summary(cur), already: true });
    const st = await getSt();
    const cr = await creds();
    const statusNames = await lp(cr, 'getStatuses', {}).then((j) => (j.status === 'ok' ? j.data || {} : {})).catch(() => ({}));
    if (Object.keys(statusNames).length) await putSetting('an_status_names', JSON.stringify(statusNames));
    if (mode === 'reset') {
      await db.batch([[`DELETE FROM an_items`, []], [`DELETE FROM an_orders`, []], [`DELETE FROM an_day_bounds`, []], [`UPDATE an_products SET fetched = 0`, []]]);
    }
    const firstRun = !(await db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`))?.value;
    const today = kyivDay();
    const keepFrom = addMonths(monthStart(today), -st.months);
    // today — нові замовлення за сьогодні + звірка статусів за 30 днів (лише списки номерів, без повних даних);
    // daily — останні 30 днів повністю; full/reset — усе вікно (6 міс).
    // Без звірки замовлення, що за ці дні перейшли з «Принят» в інший статус, лишалися б «Принят» до щоденного оновлення.
    const start = mode === 'today' || mode === 'daily' ? addDays(today, -29) : keepFrom;
    const statuses = [...st.okStatuses, ...st.refuseStatuses];
    const units = [];
    // Від найновіших місяців до старіших — поточні дані з'являються першими.
    for (let m = monthStart(today); m >= monthStart(start); m = addMonths(m, -1)) {
      const to = monthEnd(m) > today ? today : monthEnd(m);
      const from = m < start ? start : m;
      for (const s of statuses) units.push({ s, from, to });
    }
    const state = {
      mode,
      startedAt: nowIso(),
      start,
      keepFrom,
      firstRun,
      today,
      // Повні дані (сума, товари, менеджер) наново — лише для сьогоднішніх замовлень; решта — лише нові
      // і ті, у яких змінився статус (щоденне оновлення більше не перечитує весь тиждень).
      refetchFrom: mode === 'today' || mode === 'daily' ? today : '9999-12-31',
      phase: 'units',
      units,
      unitsTotal: units.length,
      pending: [],
      statusNames,
      stats: { listed: 0, fetched: 0, changed: 0, products: 0 },
      warnings: [],
    };
    await putSetting('an_sync', JSON.stringify(state));
    return c.json({ state: summary(state) });
  });

  app.post('/api/an/sync/step', async (c) => {
    const state = await getJson('an_sync');
    if (!state) return c.json({ state: null });
    if (state.phase === 'done' || state.error) return c.json({ state: summary(state) });
    if (state.lockUntil && state.lockUntil > Date.now()) return c.json({ state: summary(state), busy: true });
    state.lockUntil = Date.now() + 120000;
    await putSetting('an_sync', JSON.stringify(state));

    const st = await getSt();
    const cr = await creds();
    const maps = await loadMaps(db, st);
    const MAX_CALLS = 5; // D1 на безкоштовному плані: до 50 запитів до бази на одне звернення
    const started = Date.now();
    let calls = 0;
    const warn = (w) => { if (!state.warnings.includes(w) && state.warnings.length < 10) state.warnings.push(w); };
    const save = () => putSetting('an_sync', JSON.stringify(state));

    try {
      while (calls < MAX_CALLS && Date.now() - started < 25000 && state.phase !== 'done') {
        if (state.phase === 'units' && state.units.length && state.pending.length < 100) {
          const u = state.units[0];
          {
            const j = await lp(cr, 'getOrdersIdByStatus', { status: String(u.s), date_start: u.from, date_end: u.to });
            calls++;
            const codes = j.status === 'ok' ? asList(j.data).map(String).filter(Boolean) : [];
            if (j.status !== 'ok' && j.message && !/не знайден|нет|not found|відсутн/i.test(String(j.message))) warn(`LP-CRM: ${j.message}`);
            // Можливий ліміт відповіді — ділимо період навпіл.
            if (codes.length >= 300 && u.from < u.to) {
              const mid = addDays(u.from, Math.floor(daysBetween(u.from, u.to) / 2) - 1);
              state.units.splice(0, 1, { s: u.s, from: u.from, to: mid }, { s: u.s, from: addDays(mid, 1), to: u.to });
              state.unitsTotal += 1;
              continue;
            }
            state.stats.listed += codes.length;
            const listed = new Set(codes);
            const known = new Map();
            const range = await idRange(db, u.from, u.to);
            const upd = [];
            if (range) {
              const rows = await db.all(
                `SELECT id, code, day FROM an_orders WHERE id BETWEEN ? AND ? AND day BETWEEN ? AND ? AND status = ?`,
                [range[0], range[1], u.from, u.to, u.s],
              );
              for (const r of rows) {
                if (listed.has(r.code)) known.set(r.code, r);
                else upd.push([`UPDATE an_orders SET status = 0 WHERE id = ?`, [r.id]]); // статус змінився — уточниться в іншому кроці
              }
            }
            const rest = codes.filter((x) => !known.has(x));
            const changedStatus = new Set();
            if (rest.length) {
              const rows = await db.all(`SELECT id, code, day, status FROM an_orders WHERE code IN (SELECT value FROM json_each(?))`, [JSON.stringify(rest)]);
              for (const r of rows) {
                known.set(r.code, r);
                if (r.status !== u.s) { upd.push([`UPDATE an_orders SET status = ? WHERE id = ?`, [u.s, r.id]]); changedStatus.add(r.code); }
              }
            }
            state.stats.changed += upd.length;
            await db.batch(upd);
            // Нові, сьогоднішні і ті, що змінили статус (у них могла змінитися й сума — напр., повернення).
            const queued = new Set(state.pending);
            state.pending.push(...codes.filter((x) => !queued.has(x) && (!known.has(x) || changedStatus.has(x) || known.get(x).day >= state.refetchFrom)));
            state.units.shift();
            continue;
          }
        }
        if (state.phase === 'units' || state.phase === 'fetch') {
          // Дозавантаження повних даних пачками по 100 (з кількох місяців/статусів разом).
          if (state.pending.length >= 100 || (state.pending.length && !state.units.length)) {
            const part = state.pending.slice(0, 100);
            const j = await lp(cr, 'getOrdersByID', { order_id: part.join(',') });
            calls++;
            const orders = j.status === 'ok' ? findOrders(j.data).map(normalizeAnOrder).filter(Boolean) : [];
            if (j.status !== 'ok') warn(`LP-CRM (замовлення): ${j.message || 'помилка'}`);
            await saveOrders(db, orders, maps);
            state.stats.fetched += orders.length;
            state.pending = state.pending.slice(part.length);
            continue;
          }
          if (!state.units.length) state.phase = 'deliv';
          continue;
        }

        // Дозаповнення служби доставки для замовлень, завантажених до її появи в аналітиці:
        // від найновіших до старіших, по 100 за запит, не більше DELIV_PER_DAY на добу (ліміт записів D1).
        if (state.phase === 'deliv') {
          const fill = (await getJson('an_deliv_fill')) || {};
          const today = kyivDay();
          if (fill.day !== today) { fill.day = today; fill.n = 0; }
          if (fill.done || fill.n >= DELIV_PER_DAY || (state.stats.deliv || 0) >= DELIV_PER_RUN) { state.phase = 'products'; continue; }
          const rows = await db.all(
            `SELECT id, code FROM an_orders WHERE id < ? AND deliv IS NULL ORDER BY id DESC LIMIT 100`,
            [fill.cursor ?? Number.MAX_SAFE_INTEGER],
          );
          if (!rows.length) {
            fill.done = true;
            await putSetting('an_deliv_fill', JSON.stringify(fill));
            state.phase = 'products';
            continue;
          }
          const j = await lp(cr, 'getOrdersByID', { order_id: rows.map((r) => r.code).join(',') });
          calls++;
          if (j.status !== 'ok') { warn(`LP-CRM (служби доставки): ${j.message || 'помилка'}`); state.phase = 'products'; continue; }
          const byCode = new Map(findOrders(j.data).map((o) => [String(o.order_id || ''), delivName(o)]));
          await db.batch(rows.map((r) => [`UPDATE an_orders SET deliv = ? WHERE id = ?`, [byCode.get(r.code) ?? '', r.id]]));
          fill.cursor = rows[rows.length - 1].id;
          fill.n = (fill.n || 0) + rows.length;
          await putSetting('an_deliv_fill', JSON.stringify(fill));
          state.stats.deliv = (state.stats.deliv || 0) + rows.length;
          continue;
        }

        if (state.phase === 'products') {
          const rows = await db.all(`SELECT product_id FROM an_products WHERE fetched = 0 LIMIT 50`);
          if (!rows.length) {
            // Довідник категорій — під час щоденного/повного оновлення або коли з'явились нові товари.
            state.phase = state.mode !== 'today' || state.stats.products > 0 ? 'categories' : 'cleanup';
            continue;
          }
          const ids = rows.map((r) => r.product_id);
          const j = await lp(cr, 'getProduct', { product_id: ids.join(','), status_ignore: '1' });
          calls++;
          const cat = new Map();
          if (j.status === 'ok') for (const p of findProducts(j.data)) cat.set(parseInt(p.id ?? p.product_id, 10), parseInt(p.category_id, 10) || null);
          await db.batch(ids.map((id) => [`UPDATE an_products SET category_id = ?, fetched = 1 WHERE product_id = ?`, [cat.get(id) ?? null, id]]));
          state.stats.products += ids.length;
          continue;
        }

        if (state.phase === 'categories') {
          const j = await lp(cr, 'getCategories', {});
          calls++;
          if (j.status === 'ok') {
            const cats = flattenCategories(j.data);
            await db.batch(cats.map((x) => [
              `INSERT INTO an_categories (id, name, parent_id) VALUES (?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id
               WHERE an_categories.name IS NOT excluded.name OR an_categories.parent_id IS NOT excluded.parent_id`,
              [x.id, x.name, x.parent_id],
            ]));
          }
          state.phase = 'cleanup';
          continue;
        }

        if (state.phase === 'cleanup') {
          if (calls > 0) break; // завершення — окремим кроком, щоб не перевищити ліміт запитів до бази
          const keepFrom = state.keepFrom || state.start;
          const old = await db.get(`SELECT MAX(max_id) AS hi FROM an_day_bounds WHERE day < ?`, [keepFrom]);
          if (old?.hi != null) {
            await db.batch([
              [`DELETE FROM an_items WHERE id < ?`, [(old.hi + 1) * 100]],
              [`DELETE FROM an_orders WHERE id <= ? AND day < ?`, [old.hi, keepFrom]],
              [`DELETE FROM an_day_bounds WHERE day < ?`, [keepFrom]],
            ]);
          }
          if (state.mode !== 'today' || state.stats.products > 0) await rebrand(db);
          // Перше завантаження: усі товари вже відомі, «новими» будуть лише ті, що з'являться далі.
          if (state.firstRun) await db.run(`UPDATE an_products SET seen = 1 WHERE seen = 0`);
          if (state.mode === 'today') await mergeTodayValues(state.today);
          else await computeValues();
          state.phase = 'done';
          state.finishedAt = nowIso();
          await putSetting('an_last_sync', state.finishedAt);
          if (state.mode !== 'today') await putSetting('an_last_daily', state.finishedAt);
          await bump();
        }
      }
    } catch (e) {
      if (!e.pending) {
        // 429 від LP-CRM — не помилка процесу, просто пауза; інше — зупиняємо з повідомленням.
        if (!/429/.test(e.message)) {
          state.error = e.message;
          await services.errlog?.log(e, { path: '/api/an/sync', source: /D1_/.test(e.message) ? '' : 'LP-CRM (аналітика)' });
        }
        else warn('LP-CRM попросила зачекати (429) — продовжу автоматично.');
      }
    }
    state.lockUntil = 0;
    await save();
    return c.json({ state: summary(state) });
  });

  app.post('/api/an/sync/cancel', async (c) => {
    const s = await getJson('an_sync');
    if (s && s.phase !== 'done') { s.error = 'Скасовано'; s.lockUntil = 0; await putSetting('an_sync', JSON.stringify(s)); }
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- дашборд
  app.post('/api/an/query', async (c) => {
    const b = await c.req.json();
    const st = await getSt();
    const today = kyivDay();
    const from = isDay(b.from) ? b.from : addDays(today, -6);
    const to = isDay(b.to) && b.to >= from ? b.to : today;
    if (daysBetween(from, to) > 400) throw fail(400, 'Період завеликий (максимум 400 днів).');
    const cmp = st.compare && isDay(b.cmpFrom) && isDay(b.cmpTo) && b.cmpTo >= b.cmpFrom ? { from: b.cmpFrom, to: b.cmpTo } : null;
    const ints = (a) => (Array.isArray(a) ? a.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x)).slice(0, 40) : []);
    const f = {
      depts: ints(b.depts),
      sources: ints(b.sources),
      managers: (Array.isArray(b.managers) ? b.managers : []).map(low).filter(Boolean).slice(0, 40),
      brands: ints(b.brands),
      cats: ints(b.cats),
    };
    // Менеджер бачить лише свої замовлення; без прив'язаних логінів — порожньо.
    const own = c.get('anOwn');
    if (own) f.managers = own.length ? own : ['\u0001'];
    const itemLevel = f.brands.length > 0 || f.cats.length > 0;
    const ok = st.okStatuses.map(Number);
    const rf = st.refuseStatuses.map(Number);
    const tracked = [...ok, ...rf];
    const ph = (a) => a.map(() => '?').join(',');
    const rfExpr = `(CASE WHEN o.status IN (${rf.join(',') || '-1'}) THEN 1 ELSE 0 END)`;

    // Готова відповідь з кешу: дані змінюються лише після оновлення або зміни налаштувань.
    const ver = (await db.get(`SELECT value FROM settings WHERE key = 'an_ver'`))?.value || '0';
    // kpi: 2 — у відповіді з'явилися завершені замовлення і сума відмов (старі збережені відповіді не підходять).
    // kpi: 3 — додано розбивку за службами доставки.
    // kpi: 4 — «Відправлено» (усі статуси, крім «Прийнято») і оборот без відмов у розбивках для порівняння.
    const cacheKey = await hashKey(JSON.stringify({ ver, from, to, cmp, f, today, kpi: 4 }));
    const hit = await db.get(`SELECT value FROM an_cache WHERE key = ?`, [cacheKey]);
    if (hit) return c.body(hit.value, 200, { 'content-type': 'application/json; charset=UTF-8' });

    function base(range, { items = itemLevel, skipCats = false } = {}) {
      const where = [`o.id BETWEEN ? AND ?`, `o.day BETWEEN ? AND ?`, `+o.status IN (${tracked.join(',')})`];
      const params = [range.lo, range.hi, range.from, range.to];
      if (f.depts.length) { where.push(`o.dept IN (${ph(f.depts)})`); params.push(...f.depts); }
      if (f.sources.length) { where.push(`o.src IN (${ph(f.sources)})`); params.push(...f.sources); }
      if (f.managers.length) { where.push(`o.user IN (${ph(f.managers)})`); params.push(...f.managers); }
      let join = '';
      if (items) {
        join = `CROSS JOIN an_items i ON i.id BETWEEN o.id * 100 AND o.id * 100 + 99 LEFT JOIN an_products p ON p.product_id = i.product_id`; // CROSS JOIN: SQLite не переставляє таблиці (спершу замовлення за діапазоном id)
        if (f.brands.length) { where.push(`COALESCE(p.brand_id, 0) IN (${ph(f.brands)})`); params.push(...f.brands); }
        if (f.cats.length && !skipCats) { where.push(`COALESCE(p.cat_manual, p.category_id, 0) IN (${ph(f.cats)})`); params.push(...f.cats); }
      }
      return { from: `FROM an_orders o ${join} WHERE ${where.join(' AND ')}`, params };
    }
    const orderMeasures = (items) => (items
      ? `SUM(i.amount) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN i.amount ELSE 0 END) AS net, COUNT(DISTINCT o.id) AS cnt,
         COUNT(DISTINCT CASE WHEN ${rfExpr} = 1 THEN o.id END) AS rcnt`
      : `SUM(o.total) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN o.total ELSE 0 END) AS net, COUNT(*) AS cnt, SUM(${rfExpr}) AS rcnt`);

    async function period(p, full) {
      const r = await idRange(db, p.from, p.to);
      const empty = { daily: [], groups: [], brands: [], cats: [], top: [] };
      if (!r) return empty;
      const range = { lo: r[0], hi: r[1], from: p.from, to: p.to };
      const q = base(range);
      const qi = base(range, { items: true });
      const topJob = full ? db.all(`SELECT i.product_id AS id, MAX(p.name) AS name, MAX(p.brand_id) AS brand, SUM(i.amount) AS rev,
                SUM(i.qty) AS qty, SUM(CASE WHEN ${rfExpr} = 1 THEN i.qty ELSE 0 END) AS rqty
                ${qi.from} GROUP BY i.product_id ORDER BY rev DESC LIMIT 20`, qi.params) : Promise.resolve([]);
      // До ~3 місяців: замовлення читаються ОДИН раз (по днях і розрізах разом), товари — один раз (по замовленню, бренду
      // й категорії), підсумки — у коді. Ліміт D1 рахує прочитані рядки, тож це вдвічі менше читань. Довші періоди —
      // окремими запитами (інакше забагато рядків у відповіді для ліміту процесорного часу).
      if (daysBetween(p.from, p.to) <= 92) {
        const [rows, oi, top] = await Promise.all([
          db.all(`SELECT o.day AS day, o.dept AS dept, o.src AS src, o.user AS user, o.status AS status, o.deliv AS deliv, ${orderMeasures(itemLevel)} ${q.from}
                  GROUP BY o.day, o.dept, o.src, o.user, o.status, o.deliv`, q.params),
          db.all(`SELECT o.id AS oid, COALESCE(p.brand_id, 0) AS b, COALESCE(p.cat_manual, p.category_id, 0) AS c, MAX(${rfExpr}) AS rf,
                  SUM(i.amount) AS rev, SUM(i.qty) AS qty ${qi.from} GROUP BY o.id, COALESCE(p.brand_id, 0), COALESCE(p.cat_manual, p.category_id, 0)`, qi.params),
          topJob,
        ]);
        const add = (m, k, init) => { let x = m.get(k); if (!x) { x = init(); m.set(k, x); } return x; };
        const dm = new Map();
        const gm = new Map();
        for (const r of rows) {
          const d = add(dm, r.day, () => ({ day: r.day, rev: 0, net: 0, cnt: 0, rcnt: 0 }));
          const g = add(gm, `${r.dept}|${r.src}|${r.user}|${r.status}|${r.deliv}`, () => ({ dept: r.dept, src: r.src, user: r.user, status: r.status, deliv: r.deliv, rev: 0, net: 0, cnt: 0, rcnt: 0 }));
          for (const x of [d, g]) { x.rev += r.rev || 0; x.net += r.net || 0; x.cnt += r.cnt || 0; x.rcnt += r.rcnt || 0; }
        }
        const bm = new Map();
        const cm = new Map();
        for (const r of oi) {
          for (const [m, k] of [[bm, r.b], [cm, r.c]]) {
            const x = add(m, k, () => ({ id: k, rev: 0, net: 0, qty: 0, orders: new Set(), rorders: new Set() }));
            x.rev += r.rev || 0; x.qty += r.qty || 0; if (!r.rf) x.net += r.rev || 0;
            x.orders.add(r.oid); if (r.rf) x.rorders.add(r.oid);
          }
        }
        const fin = (m) => [...m.values()].map(({ orders, rorders, ...x }) => ({ ...x, cnt: orders.size, rcnt: rorders.size }));
        return { daily: [...dm.values()], groups: [...gm.values()], brands: fin(bm), cats: fin(cm), top };
      }
      const [daily, groups, brands, cats, top] = await Promise.all([
        db.all(`SELECT o.day AS day, ${orderMeasures(itemLevel)} ${q.from} GROUP BY o.day`, q.params),
        db.all(`SELECT o.dept AS dept, o.src AS src, o.user AS user, o.status AS status, o.deliv AS deliv, ${orderMeasures(itemLevel)} ${q.from} GROUP BY o.dept, o.src, o.user, o.status, o.deliv`, q.params),
        db.all(`SELECT COALESCE(p.brand_id, 0) AS id, SUM(i.amount) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN i.amount ELSE 0 END) AS net,
                SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS cnt, COUNT(DISTINCT CASE WHEN ${rfExpr} = 1 THEN o.id END) AS rcnt
                ${qi.from} GROUP BY COALESCE(p.brand_id, 0)`, qi.params),
        db.all(`SELECT COALESCE(p.cat_manual, p.category_id, 0) AS id, SUM(i.amount) AS rev, SUM(CASE WHEN ${rfExpr} = 0 THEN i.amount ELSE 0 END) AS net,
                SUM(i.qty) AS qty, COUNT(DISTINCT o.id) AS cnt
                ${qi.from} GROUP BY COALESCE(p.cat_manual, p.category_id, 0)`, qi.params),
        topJob,
      ]);
      return { daily, groups, brands, cats, top };
    }

    const [cur, prev, depts, sources, managers, brands, categories, targets, catOptions] = await Promise.all([
      period({ from, to }, true),
      cmp ? period(cmp, false) : null,
      db.all(`SELECT id, name, sort FROM an_depts ORDER BY sort, id`),
      db.all(`SELECT id, dept_id, name, sort FROM an_sources ORDER BY sort, id`),
      db.all(`SELECT login, name, dept_id FROM an_managers`),
      db.all(`SELECT id, name FROM an_brands ORDER BY sort, id`),
      db.all(`SELECT id, name, parent_id FROM an_categories`),
      db.all(`SELECT month, kind, ref_id, amount FROM an_targets WHERE month BETWEEN ? AND ?`, [from.slice(0, 7), to.slice(0, 7)]),
      f.brands.length
        ? db.all(`SELECT DISTINCT COALESCE(cat_manual, category_id, 0) AS id FROM an_products WHERE brand_id IN (${ph(f.brands)})`, f.brands)
        : db.all(`SELECT DISTINCT COALESCE(cat_manual, category_id, 0) AS id FROM an_products`),
    ]);

    // ---- підсумки
    const sumRows = (rows) => rows.reduce((a, r) => ({ rev: a.rev + (r.rev || 0), net: a.net + (r.net || 0), cnt: a.cnt + (r.cnt || 0), rcnt: a.rcnt + (r.rcnt || 0) }), { rev: 0, net: 0, cnt: 0, rcnt: 0 });
    // Завершені: статус «Завершено» (за назвою статусу LP-CRM) або st.doneStatuses з налаштувань.
    const statusNames0 = (await getJson('an_status_names')) || {};
    const done = (Array.isArray(st.doneStatuses) && st.doneStatuses.length ? st.doneStatuses.map(Number)
      : ok.filter((id) => /заверш|выполн|викон/i.test(statusNames0[id] || ''))).filter((id) => ok.includes(id));
    const doneIds = done.length ? done : ok.filter((id) => id === 18);
    // Групи статусів за назвами LP-CRM (з запасними номерами): «Прийнято» — ще не відправлені.
    const statusNamesG = statusNames0;
    const byName = (re, fallback) => {
      const ids = ok.filter((id) => re.test(statusNamesG[id] || ''));
      return ids.length ? ids : ok.filter((id) => fallback.includes(id));
    };
    const shipping = byName(/отправ|відправ|ожида|очіку/i, [14, 53]).filter((id) => !doneIds.includes(id));
    const acceptedOnly = byName(/принят|прийн/i, [11]).filter((id) => !doneIds.includes(id) && !shipping.includes(id));
    const kpi = (p) => {
      const t = sumRows(p.groups);
      const d = sumRows(p.groups.filter((r) => doneIds.includes(Number(r.status))));
      const sh = sumRows(p.groups.filter((r) => !acceptedOnly.includes(Number(r.status))));
      return {
        ...t, rev: round2(t.rev), net: round2(t.net), avg: t.cnt ? round2(t.rev / t.cnt) : 0, rpct: t.cnt ? round2((t.rcnt / t.cnt) * 100) : 0,
        ncnt: t.cnt - t.rcnt, // замовлень без відмов
        rrev: round2(t.rev - t.net), // сума відмов і повернень
        drev: round2(d.rev), dcnt: d.cnt, dpct: t.cnt ? round2((d.cnt / t.cnt) * 100) : 0, // завершені
        // відправлені: усі, крім «Прийнято» (відправлено, очікує викупу, завершено, відмови, повернення)
        srev: round2(sh.rev), snet: round2(sh.net), scnt: sh.cnt, srcnt: sh.rcnt, spct: t.cnt ? round2((sh.cnt / t.cnt) * 100) : 0,
      };
    };
    const fillDays = (p, a, z) => {
      const map = new Map((p?.daily || []).map((r) => [r.day, r]));
      const out = [];
      for (let d = a; d <= z; d = addDays(d, 1)) {
        const r = map.get(d) || {};
        out.push({ day: d, rev: round2(r.rev || 0), net: round2(r.net || 0), cnt: r.cnt || 0 });
      }
      return out;
    };
    const group = (p, key) => {
      const m = new Map();
      for (const r of p?.groups || []) {
        const k = r[key];
        const cur = m.get(k) || { rev: 0, net: 0, cnt: 0, rcnt: 0 };
        cur.rev += r.rev || 0; cur.net += r.net || 0; cur.cnt += r.cnt || 0; cur.rcnt += r.rcnt || 0;
        m.set(k, cur);
      }
      return m;
    };

    // ---- таргети (місячні; на період — пропорційно дням)
    const tmap = new Map(targets.map((t) => [`${t.month}|${t.kind}|${t.ref_id}`, t.amount]));
    const srcTarget = (month, id) => tmap.get(`${month}|src|${id}`) || 0;
    const deptTarget = (month, id) => {
      const own = tmap.get(`${month}|dept|${id}`);
      if (own) return own;
      return sources.filter((s) => s.dept_id === id).reduce((a, s) => a + srcTarget(month, s.id), 0);
    };
    const planFor = (fn, a, z) => {
      let sum = 0;
      for (let d = a; d <= z; d = addDays(d, 1)) sum += fn(d.slice(0, 7)) / daysInMonth(d);
      return round2(sum);
    };
    let scopeFn = null;
    let targetNote = '';
    if (f.managers.length || itemLevel) targetNote = 'Таргет задається на відділи і джерела — з фільтром за менеджером, брендом або категорією він не показується.';
    else if (f.sources.length) scopeFn = (m) => f.sources.reduce((a, id) => a + srcTarget(m, id), 0);
    else if (f.depts.length) scopeFn = (m) => f.depts.reduce((a, id) => a + (id ? deptTarget(m, id) : 0), 0);
    else scopeFn = (m) => depts.reduce((a, d) => a + deptTarget(m, d.id), 0);

    const factKey = st.targetBase === 'all' ? 'rev' : 'net';
    const curDaily = fillDays(cur, from, to);
    let target = { applicable: false, note: own ? '' : targetNote, base: factKey };
    if (scopeFn) {
      const perDay = curDaily.map((d) => round2(scopeFn(d.day.slice(0, 7)) / daysInMonth(d.day)));
      const plan = round2(perDay.reduce((a, x) => a + x, 0));
      if (plan > 0) {
        const fact = round2(curDaily.reduce((a, d) => a + d[factKey], 0));
        target = { applicable: true, base: factKey, perDay, plan, fact, diff: round2(fact - plan), pct: round2((fact / plan) * 100) };
        // Прогноз на місяць — коли період починається з 1-го числа і закінчується в цьому ж місяці.
        if (from === monthStart(to)) {
          const dim = daysInMonth(to);
          const elapsed = daysBetween(from, to);
          const monthPlan = round2(scopeFn(to.slice(0, 7)));
          const forecast = round2((fact / elapsed) * dim);
          const left = dim - elapsed;
          target.month = {
            name: to.slice(0, 7), plan: monthPlan, fact, elapsed, days: dim,
            forecast, forecastPct: monthPlan ? round2((forecast / monthPlan) * 100) : 0,
            needPerDay: left > 0 ? round2(Math.max(0, monthPlan - fact) / left) : 0,
            avgPerDay: round2(fact / elapsed), left,
          };
        }
      } else {
        target = { applicable: false, base: factKey, note: 'Таргет на цей період не задано — встановіть його в «Налаштуваннях аналітики → Таргети».' };
      }
    }

    // ---- розбивки
    const dCur = group(cur, 'dept'); const dPrev = group(prev, 'dept');
    const sCur = group(cur, 'src'); const sPrev = group(prev, 'src');
    const mCur = group(cur, 'user'); const mPrev = group(prev, 'user');
    const stCur = group(cur, 'status');
    const pick = (m, k) => m.get(k) || { rev: 0, net: 0, cnt: 0, rcnt: 0 };
    const row = (m, pm, k) => {
      const a = pick(m, k);
      const p = pm ? pick(pm, k) : null;
      return { rev: round2(a.rev), net: round2(a.net), cnt: a.cnt, rcnt: a.rcnt, prevRev: p ? round2(p.rev) : null, prevNet: p ? round2(p.net) : null, prevCnt: p ? p.cnt : null };
    };
    const planPeriod = (fn) => (f.managers.length || itemLevel ? 0 : planFor(fn, from, to));
    const byDept = [...depts.map((d) => ({ id: d.id, name: d.name })), { id: 0, name: 'Без відділу' }]
      .map((d) => ({ ...d, ...row(dCur, prev && dPrev, d.id), plan: d.id ? planPeriod((m) => deptTarget(m, d.id)) : 0 }))
      .filter((d) => d.cnt || d.prevCnt || d.plan);
    const bySource = [...sources.map((s) => ({ id: s.id, name: s.name, dept_id: s.dept_id })), { id: 0, name: 'Без джерела', dept_id: null }]
      .map((s) => ({ ...s, ...row(sCur, prev && sPrev, s.id), plan: s.id ? planPeriod((m) => srcTarget(m, s.id)) : 0 }))
      .filter((s) => s.cnt || s.prevCnt || s.plan);
    const mgrNames = new Map(managers.map((m) => [m.login, m]));
    const byManager = [...new Set([...mCur.keys(), ...(prev ? mPrev.keys() : [])])].map((login) => ({
      login, name: mgrNames.get(login)?.name || login || '—', dept_id: mgrNames.get(login)?.dept_id || null, ...row(mCur, prev && mPrev, login),
    })).sort((a, b) => b.rev - a.rev);
    const statusNames = (await getJson('an_status_names')) || {};
    const byStatus = tracked.map((id) => ({ id, name: statusNames[id] || `Статус ${id}`, refuse: rf.includes(id), ...row(stCur, null, id) }));
    // Підсумок за групами статусів: прийнято / завершено / відправлено й очікує викупу / відмови й повернення.
    // Групи — за назвами статусів LP-CRM (з запасними номерами статусів).
    const stPrev = prev ? group(prev, 'status') : null;
    const groupRow = (id, name, ids) => {
      const sum = (m) => ids.reduce((a, s) => { const r = m?.get(s); return r ? { rev: a.rev + r.rev, cnt: a.cnt + r.cnt } : a; }, { rev: 0, cnt: 0 });
      const a = sum(stCur);
      const p = stPrev ? sum(stPrev) : null;
      return { id, name, statuses: ids, rev: round2(a.rev), cnt: a.cnt, prevRev: p ? round2(p.rev) : null, prevCnt: p ? p.cnt : null };
    };
    const byStatusGroup = [
      groupRow('accepted', 'Прийнято', acceptedOnly),
      groupRow('done', 'Завершено', doneIds),
      groupRow('shipping', 'Відправлено і очікує викупу', shipping),
      groupRow('refused', 'Повернуто на склад і відмови', rf),
    ];

    // Служби доставки: усі статуси за період (з фільтрами), схожі назви — в одну групу.
    const delivMap = (p) => {
      const m = new Map();
      for (const r of p?.groups || []) {
        const k = delivGroup(r.deliv);
        const cur = m.get(k) || { rev: 0, cnt: 0, rcnt: 0, names: new Set() };
        cur.rev += r.rev || 0; cur.cnt += r.cnt || 0; cur.rcnt += r.rcnt || 0;
        if (r.deliv) cur.names.add(r.deliv);
        m.set(k, cur);
      }
      return m;
    };
    const dvCur = delivMap(cur);
    const dvPrev = prev ? delivMap(prev) : null;
    const byDelivery = [...new Set([...dvCur.keys(), ...(dvPrev ? dvPrev.keys() : [])])].map((name) => {
      const a = dvCur.get(name) || { rev: 0, cnt: 0, rcnt: 0, names: new Set() };
      const p = dvPrev?.get(name);
      return {
        id: name, name, rev: round2(a.rev), cnt: a.cnt, rcnt: a.rcnt, names: [...a.names].slice(0, 5),
        pending: name === 'Ще завантажується', prevRev: dvPrev ? round2(p?.rev || 0) : null, prevCnt: dvPrev ? p?.cnt || 0 : null,
      };
    }).filter((r) => r.cnt || r.prevCnt).sort((a, b) => b.cnt - a.cnt);

    const bName = new Map(brands.map((x) => [x.id, x.name]));
    const prevBrands = new Map((prev?.brands || []).map((r) => [r.id, r]));
    const byBrand = cur.brands.map((r) => ({
      id: r.id, name: r.id ? bName.get(r.id) || `Бренд ${r.id}` : 'Інші', rev: round2(r.rev), net: round2(r.net), qty: r.qty, cnt: r.cnt, rcnt: r.rcnt,
      avg: r.cnt ? round2(r.rev / r.cnt) : 0, prevRev: prev ? round2(prevBrands.get(r.id)?.rev || 0) : null, prevNet: prev ? round2(prevBrands.get(r.id)?.net || 0) : null,
    })).sort((a, b) => b.rev - a.rev);
    const cName = new Map(categories.map((x) => [x.id, x.name]));
    const prevCats = new Map((prev?.cats || []).map((r) => [r.id, r]));
    const byCategory = cur.cats.map((r) => ({
      id: r.id, name: r.id ? cName.get(r.id) || `Категорія ${r.id}` : 'Без категорії', rev: round2(r.rev), net: round2(r.net), qty: r.qty, cnt: r.cnt,
      prevRev: prev ? round2(prevCats.get(r.id)?.rev || 0) : null, prevNet: prev ? round2(prevCats.get(r.id)?.net || 0) : null,
    })).sort((a, b) => b.rev - a.rev);
    const top = cur.top.map((r) => ({ id: r.id, name: r.name || `Товар ${r.id}`, brand: r.brand ? bName.get(r.brand) || 'Інші' : 'Інші', rev: round2(r.rev), qty: r.qty, rqty: r.rqty }));

    const last = await db.get(`SELECT value FROM settings WHERE key = 'an_last_sync'`);
    const out = JSON.stringify({
      own: own ? { logins: own } : null,
      range: { from, to, days: daysBetween(from, to) },
      cmp,
      compareEnabled: st.compare,
      targetBase: st.targetBase,
      kpi: { cur: kpi(cur), prev: prev ? kpi(prev) : null, doneStatuses: doneIds },
      daily: { cur: curDaily, prev: cmp ? fillDays(prev, cmp.from, cmp.to) : null },
      target,
      byDept, bySource, byManager, byStatus, byStatusGroup, byDelivery, byBrand, byCategory, top,
      options: {
        depts: [...depts.map((d) => ({ id: d.id, name: d.name })), { id: 0, name: 'Без відділу' }],
        sources: sources.map((s) => ({ id: s.id, name: s.name, dept_id: s.dept_id })),
        managers: own ? own.map((l) => ({ login: l, name: managers.find((m) => m.login === l)?.name || l, dept_id: null, own: true })) : [...new Map([...managers.map((m) => [m.login, { login: m.login, name: m.name || m.login, dept_id: m.dept_id }]),
          ...byManager.filter((m) => !mgrNames.has(m.login)).map((m) => [m.login, { login: m.login, name: m.login, dept_id: null }])]).values()],
        brands: [...brands.map((x) => ({ id: x.id, name: x.name })), { id: 0, name: 'Інші' }],
        cats: catOptions.map((r) => ({ id: r.id, name: r.id ? cName.get(r.id) || `Категорія ${r.id}` : 'Без категорії' }))
          .sort((a, b) => (a.id === 0) - (b.id === 0) || a.name.localeCompare(b.name, 'uk')),
      },
      lastSync: last?.value || '',
    });
    await db.batch([
      [`DELETE FROM an_cache WHERE at < ?`, [Date.now() - 2 * 86400e3]],
      [`INSERT OR REPLACE INTO an_cache (key, value, at) VALUES (?, ?, ?)`, [cacheKey, out, Date.now()]],
    ]);
    return c.body(out, 200, { 'content-type': 'application/json; charset=UTF-8' });
  });
}

async function hashKey(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
