// Модуль «Рітейл» → Розетка (кабінет постачальника, дропшипінг):
//  - кабінети (JWT-токен), вебхук Розетки (подія «Дропшипінг») — замовлення з'являються одразу; плюс оновлення кнопкою;
//  - замовлення: підтвердження (групою), ТТН Нової пошти (групою; місця — з каталогу Розетки або свої габарити товару),
//    маркування PDF (групою), позначка, коли з'явились супровідні документи (посилання і № рахунку «Вчасно»);
//  - передача в LP-CRM у «Нові»: ціна товару — ціна закупівлі для Розетки (не роздрібна);
//  - товари: артикул постачальника → товар LP-CRM, ціна закупівлі, РІЦ, залишок; прайс на Розетку.
// Групові дії браузер виконує по одному замовленню за запит (ліміти Cloudflare), з прогресом.
import { MASK, fail, need, nowIso, round2, loadSettings } from '../../core/common.js';
import { randomToken } from '../../core/auth.js';
import { logAudit } from '../../core/requisites.js';
import { addNewOrder, getOrdersBatch, phpSerialize, phpUrlencode } from '../../integrations/lpcrm.js';
import { rzsOrdersPage, rzsOrder, rzsConfirm, rzsCreateTtn, rzsMarkings, rzsPriceCreate, rzsDateTime } from '../../integrations/rozetka-supplier.js';

export const RZS_STATUS = {
  new: 'Нове', updated: 'Оновлене', confirmed: 'Підтверджене', shipping: 'Відправляється', problem: 'Проблема',
  closed: 'Закрите', delivery_refused: 'Відмова від отримання', shipped_from_rozetka: 'Відправлено з Розетки', deleted: 'Видалене',
};
export const UZD_STATUS = { not_uploaded: 'ЮЗД не завантажено', verified: 'ЮЗД звірено', problem: 'ЮЗД: проблема', skipped: 'ЮЗД пропущено' };
const SYNC_DAYS = 14;
const SYNC_PAGES = 8; // по 50 замовлень; решта — наступним зверненням
const SYNC_GAP_MS = 2 * 60 * 1000;
const keyHint = (k) => (k ? `${MASK}${String(k).slice(-4)}` : '');
const newCode = () => `${Math.round(Date.now() / 100)}${String(Math.floor(10000 + Math.random() * 90000))}`;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
// Габарити з форми: «7,5» → 7.5.
const normSeat = (s) => Object.fromEntries(['lengthCm', 'widthCm', 'heightCm', 'weightKg'].map((k) => [k, num(s?.[k]) ?? 0]));
const goodSeat = (s) => ['lengthCm', 'widthCm', 'heightCm', 'weightKg'].every((k) => Number(s?.[k]) > 0);
const seatOf = (s) => ({ lengthCm: round2(Number(s.lengthCm)), widthCm: round2(Number(s.widthCm)), heightCm: round2(Number(s.heightCm)), weightKg: round2(Number(s.weightKg)) });
const userName = (u) => u?.name || u?.login || '';

export function mountRetail(app, { db, fetchFn }) {
  // ================================================================ кабінети
  const publicAcc = (a, origin = '') => ({
    id: a.id, name: a.name, token: keyHint(a.token), price_list_id: a.price_list_id, crm_office: a.crm_office, crm_delivery: a.crm_delivery,
    crm_site: a.crm_site, active: a.active, synced_at: a.synced_at, hook_at: a.hook_at,
    hook: { url: origin ? `${origin}/api/rzs/hook/${a.id}` : '', user: a.hook_user, pass: a.hook_pass },
  });
  const accOf = async (id) => {
    const a = await db.get(`SELECT * FROM rzs_accounts WHERE id = ?`, [id]);
    if (!a) throw fail(404, 'Кабінет Розетки не знайдено.');
    return a;
  };
  app.get('/api/rzs/accounts', async (c) => {
    need(c, 'api');
    const origin = new URL(c.req.url).origin;
    return c.json((await db.all(`SELECT * FROM rzs_accounts ORDER BY active DESC, name`)).map((a) => publicAcc(a, origin)));
  });
  const accFields = (b, cur = {}) => ({
    name: String(b.name ?? cur.name ?? '').trim().slice(0, 100),
    price_list_id: String(b.price_list_id ?? cur.price_list_id ?? '').replace(/\D/g, '').slice(0, 20),
    crm_office: String(b.crm_office ?? cur.crm_office ?? '').replace(/\D/g, '').slice(0, 10),
    crm_delivery: String(b.crm_delivery ?? cur.crm_delivery ?? '1').replace(/\D/g, '').slice(0, 10),
    crm_site: String(b.crm_site ?? cur.crm_site ?? '').trim().slice(0, 100),
    active: b.active === undefined ? (cur.active ?? 1) : (b.active ? 1 : 0),
  });
  app.post('/api/rzs/accounts', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const token = String(b.token || '').trim();
    if (token.length < 20) throw fail(400, 'Вставте токен з Кабінету постачальника Розетки: Налаштування → Токени → «Згенерувати токен».');
    await rzsOrdersPage(fetchFn, token, { dateFrom: rzsDateTime(new Date(Date.now() - 86400000)) }); // перевірка токена
    const f = accFields(b);
    const r = await db.run(`INSERT INTO rzs_accounts (name, token, price_list_id, crm_office, crm_delivery, crm_site, active, hook_user, hook_pass, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, [f.name || 'Розетка', token, f.price_list_id, f.crm_office, f.crm_delivery, f.crm_site, `rzs${randomToken(4)}`, randomToken(12), nowIso()]);
    await logAudit(db, { user: c.get('user'), kind: 'rzs', refId: r.lastId, action: 'додано кабінет постачальника Розетки', changes: [{ field: 'name', from: '', to: f.name }] });
    return c.json({ id: r.lastId });
  });
  app.put('/api/rzs/accounts/:id', async (c) => {
    need(c, 'api');
    const cur = await accOf(c.req.param('id'));
    const b = await c.req.json();
    const f = accFields(b, cur);
    let token = cur.token;
    const t = String(b.token ?? '').trim();
    if (t && !t.startsWith(MASK) && t !== cur.token) {
      await rzsOrdersPage(fetchFn, t, { dateFrom: rzsDateTime(new Date(Date.now() - 86400000)) });
      token = t;
    }
    const pass = b.new_hook_pass ? randomToken(12) : cur.hook_pass;
    await db.run(`UPDATE rzs_accounts SET name = ?, token = ?, price_list_id = ?, crm_office = ?, crm_delivery = ?, crm_site = ?, active = ?, hook_pass = ? WHERE id = ?`,
      [f.name || cur.name, token, f.price_list_id, f.crm_office, f.crm_delivery, f.crm_site, f.active, pass, cur.id]);
    if (token !== cur.token) await logAudit(db, { user: c.get('user'), kind: 'rzs', refId: cur.id, action: 'змінено токен Розетки', changes: [{ field: 'token', from: keyHint(cur.token), to: keyHint(token) }] });
    return c.json({ ok: true });
  });
  app.delete('/api/rzs/accounts/:id', async (c) => {
    need(c, 'api');
    const cur = await accOf(c.req.param('id'));
    await db.batch([[`DELETE FROM rzs_accounts WHERE id = ?`, [cur.id]], [`DELETE FROM rzs_orders WHERE account_id = ?`, [cur.id]]]);
    await logAudit(db, { user: c.get('user'), kind: 'rzs', refId: cur.id, action: 'видалено кабінет постачальника Розетки', changes: [{ field: 'name', from: cur.name, to: '' }] });
    return c.json({ ok: true });
  });

  // ================================================================ замовлення: збереження
  const rowOf = (o, accountId) => ({
    id: String(o.orderId || o.id || ''), account_id: accountId, order_num: String(o.orderNum ?? ''), status: String(o.orderStatus || o.status || ''),
    uzd_status: String(o.uzdStatus ?? ''), created_at: String(o.createdAt || ''), updated_at: String(o.updatedAt || ''),
    delivery_type: String(o.deliveryAddressType ?? ''), delivery_company: String(o.deliveryCompanyName ?? ''), address_id: String(o.deliveryAddressId ?? ''),
    customer: String(o.customerName ?? ''), city: String(o.deliveryCity ?? ''), street: String(o.deliveryStreet ?? ''), phone: String(o.deliveryPhone ?? ''),
    cod: Number(o.cashOnDelivery) || 0, ttn: String(o.ttn ?? ''), tracking_code: o.trackingStatusCode ?? null, tracking_status: String(o.trackingStatus ?? ''),
    return_ttn: String(o.returnTtn ?? ''), document_link: String(o.documentLink ?? ''), invoice_no: String(o.incomingInvoiceNumber ?? ''),
    sn_required: o.snRequired ? 1 : 0, products: Array.isArray(o.products) ? o.products : null,
  });
  // Зберегти замовлення; позначки: коли з'явились документи, підтверджено, ТТН. Нові артикули — у «Товари».
  async function saveOrders(list, accountId) {
    const rows = list.map((o) => rowOf(o, accountId)).filter((r) => r.id);
    if (!rows.length) return 0;
    const old = new Map((await db.all(`SELECT id, docs_at, confirmed_at, ttn_at, document_link, products FROM rzs_orders WHERE id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(rows.map((r) => r.id))])).map((r) => [r.id, r]));
    const now = nowIso();
    const st = rows.map((r) => {
      const o = old.get(r.id);
      const docsAt = o?.docs_at || (r.document_link || r.invoice_no ? now : '');
      const confAt = o?.confirmed_at || (['confirmed', 'shipping', 'closed'].includes(r.status) ? now : '');
      const ttnAt = o?.ttn_at || (r.ttn ? now : '');
      const products = r.products ? JSON.stringify(r.products) : (o?.products || '[]');
      return [`INSERT INTO rzs_orders (id, account_id, order_num, status, uzd_status, created_at, updated_at, delivery_type, delivery_company, address_id, customer, city, street, phone, cod,
          ttn, tracking_code, tracking_status, return_ttn, document_link, invoice_no, sn_required, products, docs_at, confirmed_at, ttn_at, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET order_num = excluded.order_num, status = excluded.status, uzd_status = CASE WHEN excluded.uzd_status != '' THEN excluded.uzd_status ELSE rzs_orders.uzd_status END,
          updated_at = excluded.updated_at, delivery_type = excluded.delivery_type, delivery_company = excluded.delivery_company, address_id = excluded.address_id,
          customer = excluded.customer, city = excluded.city, street = excluded.street, phone = excluded.phone, cod = excluded.cod, ttn = excluded.ttn,
          tracking_code = excluded.tracking_code, tracking_status = excluded.tracking_status, return_ttn = excluded.return_ttn, document_link = excluded.document_link,
          invoice_no = excluded.invoice_no, sn_required = excluded.sn_required, products = excluded.products, docs_at = excluded.docs_at,
          confirmed_at = excluded.confirmed_at, ttn_at = excluded.ttn_at, synced_at = excluded.synced_at`,
      [r.id, accountId, r.order_num, r.status, r.uzd_status, r.created_at, r.updated_at, r.delivery_type, r.delivery_company, r.address_id, r.customer, r.city, r.street,
        r.phone, r.cod, r.ttn, r.tracking_code, r.tracking_status, r.return_ttn, r.document_link, r.invoice_no, r.sn_required, products, docsAt, confAt, ttnAt, now]];
    });
    const codes = [...new Set(rows.flatMap((r) => (r.products || []).map((p) => String(p.supplierCode || '')).filter(Boolean)))];
    for (const code of codes) {
      const p = rows.flatMap((r) => r.products || []).find((x) => String(x.supplierCode) === code);
      st.push([`INSERT INTO rzs_products (code, rz_code, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET rz_code = CASE WHEN rzs_products.rz_code = '' THEN excluded.rz_code ELSE rzs_products.rz_code END`,
        [code, String(p?.rzCode ?? ''), now]]);
    }
    await db.batch(st);
    if (codes.length) await autoMap(codes);
    return rows.length;
  }
  // Артикул постачальника → товар LP-CRM: за артикулом у каталозі B2B або за ID товару.
  async function autoMap(codes) {
    const todo = await db.all(`SELECT code FROM rzs_products WHERE product_id IS NULL AND code IN (SELECT value FROM json_each(?))`, [JSON.stringify(codes)]);
    if (!todo.length) return;
    const list = JSON.stringify(todo.map((r) => r.code));
    const found = await db.all(`SELECT product_id, name, article, rrp FROM b2b_catalog WHERE article IN (SELECT value FROM json_each(?)) OR CAST(product_id AS TEXT) IN (SELECT value FROM json_each(?))`, [list, list]).catch(() => []);
    const st = [];
    for (const r of todo) {
      const m = found.find((x) => String(x.article) === r.code) || found.find((x) => String(x.product_id) === r.code);
      if (m) st.push([`UPDATE rzs_products SET product_id = ?, name = CASE WHEN name = '' THEN ? ELSE name END, rrp = COALESCE(rrp, ?) WHERE code = ?`, [m.product_id, m.name || '', m.rrp || null, r.code]]);
    }
    if (st.length) await db.batch(st);
  }

  // ================================================================ синхронізація
  async function syncAccount(a, { days = SYNC_DAYS } = {}) {
    const dateFrom = rzsDateTime(new Date(Date.now() - days * 86400000));
    let saved = 0;
    let more = false;
    for (let page = 1; page <= SYNC_PAGES; page++) {
      const r = await rzsOrdersPage(fetchFn, a.token, { dateFrom, page });
      saved += await saveOrders(r.orders, a.id);
      if (!r.orders.length || page * 50 >= r.total) break;
      if (page === SYNC_PAGES) more = true;
    }
    await db.run(`UPDATE rzs_accounts SET synced_at = ? WHERE id = ?`, [nowIso(), a.id]);
    return { saved, more };
  }
  app.post('/api/rzs/sync', async (c) => {
    need(c, 'docs.view');
    const b = await c.req.json().catch(() => ({}));
    const accs = await db.all(`SELECT * FROM rzs_accounts WHERE active = 1 ORDER BY id`);
    if (!accs.length) return c.json({ ok: false, accounts: 0 });
    const out = [];
    for (const a of accs) {
      if (!b.force && a.synced_at && Date.now() - Date.parse(a.synced_at) < SYNC_GAP_MS) { out.push({ id: a.id, skipped: true }); continue; }
      try { out.push({ id: a.id, ...(await syncAccount(a)) }); } catch (e) { out.push({ id: a.id, error: e.message }); }
    }
    return c.json({ ok: true, accounts: accs.length, results: out });
  });

  // Вебхук Розетки («Дропшипінг»: створення / зміна / видалення): Basic-логін і пароль кабінету в нашому сервісі.
  // У тілі шукаємо id замовлення (UUID) і перечитуємо його; не знайшли — коротка синхронізація за 2 дні.
  app.post('/api/rzs/hook/:id', async (c) => {
    const a = await db.get(`SELECT * FROM rzs_accounts WHERE id = ? AND active = 1`, [c.req.param('id')]);
    const auth = c.req.header('authorization') || '';
    let user = '';
    let pass = '';
    try { [user, pass] = atob(auth.replace(/^Basic\s+/i, '')).split(':'); } catch { /* */ }
    if (!a || !a.hook_pass || user !== a.hook_user || pass !== a.hook_pass) throw fail(401, 'Невірний логін або пароль вебхука.');
    const raw = await c.req.text();
    const ids = [...new Set((raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []))].slice(0, 5);
    await db.run(`UPDATE rzs_accounts SET hook_at = ? WHERE id = ?`, [nowIso(), a.id]);
    let saved = 0;
    if (ids.length) {
      for (const id of ids) {
        const o = await rzsOrder(fetchFn, a.token, id).catch(() => null);
        if (o && (o.orderId || o.id)) saved += await saveOrders([o], a.id);
        else if (/delete/i.test(raw)) await db.run(`UPDATE rzs_orders SET status = 'deleted' WHERE id = ?`, [id]);
      }
    } else saved = (await syncAccount(a, { days: 2 })).saved;
    return c.json({ ok: true, saved });
  });

  // ================================================================ список і картка
  const publicOrder = (r, prods = new Map()) => {
    let products = [];
    try { products = JSON.parse(r.products || '[]'); } catch { /* */ }
    return {
      ...r, products: products.map((p) => {
        const m = prods.get(String(p.supplierCode));
        return { supplierCode: String(p.supplierCode || ''), rzCode: p.rzCode ?? '', quantity: Number(p.quantity) || 0, confirmedQuantity: p.confirmedQuantity ?? null,
          serialNumbers: p.serialNumbers || [], cargoSeats: Array.isArray(p.cargoSeats) ? p.cargoSeats : [],
          name: m?.name || '', product_id: m?.product_id ?? null, purchase_price: m?.purchase_price ?? null, own_seats: m?.seats ? JSON.parse(m.seats) : [] };
      }),
      status_name: RZS_STATUS[r.status] || r.status, uzd_name: UZD_STATUS[r.uzd_status] || r.uzd_status || '',
    };
  };
  const prodMap = async (rows) => {
    const codes = [...new Set(rows.flatMap((r) => { try { return JSON.parse(r.products || '[]').map((p) => String(p.supplierCode)); } catch { return []; } }))];
    if (!codes.length) return new Map();
    return new Map((await db.all(`SELECT * FROM rzs_products WHERE code IN (SELECT value FROM json_each(?))`, [JSON.stringify(codes)])).map((p) => [p.code, p]));
  };
  app.get('/api/rzs/orders', async (c) => {
    need(c, 'docs.view');
    const st = c.req.query('status') || '';
    const q = String(c.req.query('q') || '').trim().toLowerCase();
    const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const where = ['o.created_at >= ?'];
    const params = [since];
    if (st === 'todo') where.push(`o.status IN ('new', 'updated')`);
    else if (st === 'nottn') where.push(`o.status IN ('confirmed', 'problem') AND o.ttn = ''`);
    else if (st === 'nocrm') where.push(`o.crm_id = '' AND o.crm_code = '' AND o.status NOT IN ('deleted', 'closed', 'delivery_refused')`);
    else if (st === 'docs') where.push(`o.document_link != ''`);
    else if (st && RZS_STATUS[st]) { where.push('o.status = ?'); params.push(st); }
    // LIKE у SQLite не зважає на регістр лише для латиниці — для кирилиці пробуємо «як є», малими і з великої.
    if (q) {
      const raw = String(c.req.query('q') || '').trim();
      const cap = q.replace(/(^|[\s'-])(\S)/g, (m, a, b) => a + b.toUpperCase());
      const vars = [...new Set([raw, q, cap])].map((v) => `%${v}%`);
      where.push(`(o.order_num LIKE ? OR o.phone LIKE ? OR o.ttn LIKE ? OR ${vars.map(() => 'o.customer LIKE ?').join(' OR ')})`);
      params.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`, `%${q}%`, ...vars);
    }
    const [rows, counts, accs] = await Promise.all([
      db.all(`SELECT o.*, a.name AS account FROM rzs_orders o LEFT JOIN rzs_accounts a ON a.id = o.account_id WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 300`, params),
      db.all(`SELECT status, COUNT(*) AS n FROM rzs_orders WHERE created_at >= ? GROUP BY status`, [since]),
      db.all(`SELECT id, name, synced_at, hook_at FROM rzs_accounts WHERE active = 1`),
    ]);
    const pm = await prodMap(rows);
    return c.json({ rows: rows.map((r) => publicOrder(r, pm)), counts: Object.fromEntries(counts.map((r) => [r.status, r.n])), statuses: RZS_STATUS, accounts: accs });
  });
  const orderRow = async (id) => {
    const r = await db.get(`SELECT o.*, a.name AS account FROM rzs_orders o LEFT JOIN rzs_accounts a ON a.id = o.account_id WHERE o.id = ?`, [id]);
    if (!r) throw fail(404, 'Замовлення не знайдено — оновіть список.');
    return r;
  };
  app.get('/api/rzs/orders/:id', async (c) => {
    need(c, 'docs.view');
    const r = await orderRow(c.req.param('id'));
    return c.json(publicOrder(r, await prodMap([r])));
  });

  // ================================================================ дії над замовленням
  // Підтвердити повністю (кількість = замовлена); серійні номери — якщо Розетка їх вимагає.
  app.post('/api/rzs/orders/:id/confirm', async (c) => {
    need(c, 'docs.edit');
    const r = await orderRow(c.req.param('id'));
    const a = await accOf(r.account_id);
    const b = await c.req.json().catch(() => ({}));
    if (!['new', 'updated', 'confirmed'].includes(r.status)) throw fail(400, `Замовлення «${RZS_STATUS[r.status] || r.status}» — підтвердити не можна.`);
    const o = publicOrder(r);
    const serials = b.serials || {};
    const products = o.products.map((p) => {
      const sn = (Array.isArray(serials[p.supplierCode]) ? serials[p.supplierCode] : String(serials[p.supplierCode] || '').split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
      if (r.sn_required && sn.length !== p.quantity) throw fail(400, `Розетка вимагає серійні номери: «${p.name || p.supplierCode}» — ${p.quantity} шт.`);
      return { supplierCode: p.supplierCode, confirmedQuantity: p.quantity, ...(sn.length ? { serialNumbers: sn } : {}) };
    });
    const res = await rzsConfirm(fetchFn, a.token, r.id, products);
    const fresh = await rzsOrder(fetchFn, a.token, r.id).catch(() => null);
    if (fresh && (fresh.orderId || fresh.id)) await saveOrders([fresh], a.id);
    else await db.run(`UPDATE rzs_orders SET status = ?, confirmed_at = COALESCE(NULLIF(confirmed_at, ''), ?) WHERE id = ?`, [res.status, nowIso(), r.id]);
    await db.run(`UPDATE rzs_orders SET note = ? WHERE id = ?`, [`підтвердив(ла) ${userName(c.get('user'))}`, r.id]);
    return c.json({ ok: true, status: res.status, warnings: res.warnings.map((w) => w.message || String(w)) });
  });

  // Місця для ТТН: на одиницю товару — свої габарити товару (якщо задані) або з каталогу Розетки; × кількість.
  function seatsFor(o) {
    const seats = [];
    const missing = [];
    for (const p of o.products) {
      const unit = (p.own_seats?.length ? p.own_seats : p.cargoSeats).filter(Boolean);
      if (!unit.length || !unit.every(goodSeat)) { missing.push(p.name || p.supplierCode); continue; }
      const n = Number(p.confirmedQuantity ?? p.quantity) || p.quantity;
      for (let i = 0; i < n; i++) seats.push(...unit.map(seatOf));
    }
    return { seats, missing };
  }
  app.post('/api/rzs/orders/:id/ttn', async (c) => {
    need(c, 'docs.edit');
    const r = await orderRow(c.req.param('id'));
    const a = await accOf(r.account_id);
    const b = await c.req.json().catch(() => ({}));
    const replace = Boolean(b.replace);
    if (r.ttn && !replace) throw fail(400, `ТТН уже є: ${r.ttn}.`);
    if (!['confirmed', 'problem', 'shipping'].includes(r.status)) throw fail(400, r.status === 'new' || r.status === 'updated' ? 'Спершу підтвердіть замовлення.' : `Замовлення «${RZS_STATUS[r.status] || r.status}» — ТТН створити не можна.`);
    if (r.uzd_status && !['verified', 'skipped'].includes(r.uzd_status)) throw fail(400, `${UZD_STATUS[r.uzd_status] || 'ЮЗД не звірено'} — ТТН можна створити після звірки документів у «Вчасно».`);
    const o = publicOrder(r, await prodMap([r]));
    let seats;
    if (Array.isArray(b.seats) && b.seats.length) {
      b.seats = b.seats.map(normSeat);
      if (!b.seats.every(goodSeat)) throw fail(400, 'Кожне місце: довжина, ширина, висота (см) і вага (кг) — більше 0.');
      seats = b.seats.map(seatOf);
    } else {
      const s = seatsFor(o);
      if (s.missing.length) throw fail(400, `Немає габаритів: ${s.missing.join(', ')} — вкажіть їх у «Товари» або в замовленні.`);
      seats = s.seats;
    }
    if (!seats.length || seats.length > 50) throw fail(400, 'Немає місць для ТТН.');
    const res = await rzsCreateTtn(fetchFn, a.token, r.id, seats, { replaceExisting: replace });
    await db.run(`UPDATE rzs_orders SET ttn = ?, status = ?, ttn_at = ?, note = ? WHERE id = ?`, [res.ttn || r.ttn, res.status || 'shipping', nowIso(), `ТТН створив(ла) ${userName(c.get('user'))}${res.point ? ` · ${res.point}` : ''}`, r.id]);
    return c.json({ ok: true, ttn: res.ttn, point: res.point, seats: seats.length });
  });

  // PDF маркувань групою (до 100) — по кабінетах.
  app.post('/api/rzs/markings', async (c) => {
    need(c, 'docs.view');
    const b = await c.req.json().catch(() => ({}));
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String))].slice(0, 100);
    const rows = await db.all(`SELECT id, account_id, ttn FROM rzs_orders WHERE id IN (SELECT value FROM json_each(?)) AND ttn != ''`, [JSON.stringify(ids)]);
    if (!rows.length) throw fail(400, 'У вибраних замовленнях ще немає ТТН.');
    const acc = rows[0].account_id;
    if (rows.some((r) => r.account_id !== acc)) throw fail(400, 'Оберіть замовлення одного кабінету Розетки.');
    const a = await accOf(acc);
    const m = await rzsMarkings(fetchFn, a.token, rows.map((r) => r.id), b.size === '85x85' ? '85x85' : '100x100');
    return new Response(m.bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="markings.pdf"',
      'X-Markings-Printed': String(m.printed), 'X-Markings-Skipped': String(m.skipped + (ids.length - rows.length)), 'Cache-Control': 'private, no-store' } });
  });

  // В LP-CRM у «Нові»: ціна — ціна закупівлі для Розетки (з «Товари»), не роздрібна.
  function senderOf(c, site) {
    const host = site || new URL(c.req.url).host;
    return phpUrlencode(phpSerialize({ HTTP_HOST: host, SERVER_NAME: host, REQUEST_URI: '/rozetka', HTTP_REFERER: `https://${host}/rozetka`,
      REMOTE_ADDR: c.req.header('cf-connecting-ip') || '127.0.0.1', HTTP_USER_AGENT: 'Ecovent Retail', REQUEST_SCHEME: 'https', HTTPS: 'on' }));
  }
  app.post('/api/rzs/orders/:id/crm', async (c) => {
    need(c, 'docs.edit');
    const r = await orderRow(c.req.param('id'));
    if (r.crm_id || r.crm_code) throw fail(400, `Уже в LP-CRM${r.crm_id ? `: № ${r.crm_id}` : ''}.`);
    if (['deleted'].includes(r.status)) throw fail(400, 'Замовлення видалене на Розетці.');
    const a = await accOf(r.account_id);
    if (!a.crm_office) throw fail(400, 'Вкажіть ID відділу LP-CRM у налаштуваннях кабінету Розетки.');
    const s = await loadSettings(db);
    if (!s.lpcrm_subdomain || !s.lpcrm_key) throw fail(400, 'Не налаштовано LP-CRM у «Налаштуваннях».');
    const o = publicOrder(r, await prodMap([r]));
    const bad = o.products.filter((p) => !p.product_id || !(Number(p.purchase_price) > 0));
    if (!o.products.length) throw fail(400, 'У замовленні немає товарів — оновіть замовлення з Розетки.');
    if (bad.length) throw fail(400, `Вкажіть у «Товари» товар LP-CRM і ціну закупівлі: ${bad.map((p) => p.supplierCode).join(', ')}.`);
    const code = newCode();
    const claim = await db.run(`UPDATE rzs_orders SET crm_code = ? WHERE id = ? AND crm_code = '' AND crm_id = ''`, [code, r.id]);
    if (!claim.changes) throw fail(409, 'Замовлення вже передається в LP-CRM.');
    const comment = [`Rozetka ${r.order_num || ''} · ${a.name}`, r.ttn ? `ТТН: ${r.ttn}` : '', r.cod ? `Післяплата: ${r.cod} грн` : '',
      r.invoice_no ? `Рахунок Вчасно: ${r.invoice_no}` : ''].filter(Boolean).join('\n');
    let res;
    try {
      res = await addNewOrder(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_in_key || s.lpcrm_key }, {
        code, office: a.crm_office, bayer_name: r.customer, phone: String(r.phone).replace(/\D/g, ''), comment, delivery: a.crm_delivery || '',
        delivery_adress: r.ttn || [r.city, r.street].filter(Boolean).join(', '), sender: senderOf(c, a.crm_site), site: a.crm_site || new URL(c.req.url).host,
        products: o.products.map((p) => ({ product_id: p.product_id, price: p.purchase_price, count: p.quantity })),
      });
    } catch (e) {
      await db.run(`UPDATE rzs_orders SET crm_code = '' WHERE id = ?`, [r.id]);
      if (e.pending) throw e;
      throw fail(502, e.message);
    }
    if (!res.ok) {
      await db.run(`UPDATE rzs_orders SET crm_code = '' WHERE id = ?`, [r.id]);
      throw fail(400, `LP-CRM не прийняла замовлення: ${res.error}`);
    }
    let crmId = res.crmId || '';
    if (!crmId) {
      const found = await getOrdersBatch(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, [code]).catch(() => []);
      crmId = String(found.find((x) => String(x.order_id) === code)?.id || '');
    }
    await db.run(`UPDATE rzs_orders SET crm_id = ?, crm_at = ?, note = ? WHERE id = ?`, [crmId, nowIso(), `у LP-CRM передав(ла) ${userName(c.get('user'))}`, r.id]);
    return c.json({ ok: true, crm_id: crmId, code });
  });

  // ================================================================ товари й прайс
  app.get('/api/rzs/products', async (c) => {
    need(c, 'docs.view');
    const rows = await db.all(`SELECT * FROM rzs_products ORDER BY (product_id IS NULL) DESC, (purchase_price IS NULL) DESC, name, code LIMIT 2000`);
    return c.json(rows.map((p) => ({ ...p, seats: p.seats ? JSON.parse(p.seats) : [] })));
  });
  app.post('/api/rzs/products', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    const code = String(b.code || '').trim().slice(0, 60);
    if (!code) throw fail(400, 'Вкажіть артикул постачальника (як на Розетці).');
    await db.run(`INSERT INTO rzs_products (code, updated_at) VALUES (?, ?) ON CONFLICT(code) DO NOTHING`, [code, nowIso()]);
    await autoMap([code]);
    return c.json({ ok: true });
  });
  app.put('/api/rzs/products/:code', async (c) => {
    need(c, 'refs.edit');
    const code = decodeURIComponent(c.req.param('code'));
    const cur = await db.get(`SELECT * FROM rzs_products WHERE code = ?`, [code]);
    if (!cur) throw fail(404, 'Товар не знайдено.');
    const b = await c.req.json();
    const pid = b.product_id === undefined ? cur.product_id : (parseInt(b.product_id, 10) || null);
    let name = b.name === undefined ? cur.name : String(b.name).trim().slice(0, 200);
    if (pid && pid !== cur.product_id && !name) {
      name = (await db.get(`SELECT name FROM b2b_catalog WHERE product_id = ?`, [pid]).catch(() => null))?.name || name;
    }
    const price = b.purchase_price === undefined ? cur.purchase_price : num(b.purchase_price);
    const rrp = b.rrp === undefined ? cur.rrp : num(b.rrp);
    const stock = b.stock === undefined ? cur.stock : (b.stock === '' || b.stock === null ? null : Math.max(0, parseInt(b.stock, 10) || 0));
    if (price !== null && price !== undefined && !(price >= 0)) throw fail(400, 'Ціна закупівлі — число від 0.');
    let seats = cur.seats || '';
    if (b.seats !== undefined) {
      const list = (Array.isArray(b.seats) ? b.seats : []).filter((s) => s && Object.values(s).some((v) => String(v).trim() !== '')).map(normSeat);
      if (!list.every(goodSeat)) throw fail(400, 'Габарити місця: довжина, ширина, висота (см) і вага (кг) — більше 0.');
      seats = list.length ? JSON.stringify(list.map(seatOf)) : '';
    }
    await db.run(`UPDATE rzs_products SET product_id = ?, name = ?, purchase_price = ?, rrp = ?, stock = ?, seats = ?, updated_at = ? WHERE code = ?`,
      [pid, name || '', price ?? null, rrp ?? null, stock, seats, nowIso(), code]);
    return c.json({ ok: true });
  });
  // Прайс на Розетку: товари з ціною закупівлі й залишком (часткове оновлення — лише ці позиції), до 1000.
  app.post('/api/rzs/price', async (c) => {
    need(c, 'api');
    const b = await c.req.json().catch(() => ({}));
    const a = await accOf(b.account_id || (await db.get(`SELECT id FROM rzs_accounts WHERE active = 1 ORDER BY id LIMIT 1`))?.id || 0);
    if (!a.price_list_id) throw fail(400, 'Вкажіть ID прайсу в налаштуваннях кабінету (Кабінет Розетки → Товарні позиції → Прайси).');
    const rows = await db.all(`SELECT * FROM rzs_products WHERE purchase_price > 0 AND stock IS NOT NULL ORDER BY code LIMIT 1000`);
    if (!rows.length) throw fail(400, 'Немає товарів із ціною закупівлі й залишком.');
    const r = await rzsPriceCreate(fetchFn, a.token, a.price_list_id, rows.map((p) => ({
      article: p.code, product_id: p.rz_code || undefined, purchase_price: p.purchase_price, recommended_inet_price: p.rrp || undefined, stock: p.stock,
    })), { test: Boolean(b.test) });
    await logAudit(db, { user: c.get('user'), kind: 'rzs', refId: a.id, action: `прайс на Розетку${b.test ? ' (тест)' : ''}: ${rows.length} поз.${r.errors.length ? `, помилок: ${r.errors.length}` : ''}` }).catch(() => 0);
    return c.json({ ok: r.ok, sent: rows.length, count: r.count, errors: r.errors.slice(0, 50), test: Boolean(b.test) });
  });
}
