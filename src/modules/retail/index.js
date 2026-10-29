// Модуль «Рітейл» → Розетка (кабінет постачальника, дропшипінг):
//  - кабінети (JWT-токен), вебхук Розетки (подія «Дропшипінг») — замовлення з'являються одразу; плюс оновлення кнопкою;
//  - замовлення: підтвердження (групою), ТТН Нової пошти (групою; місця — з каталогу Розетки або свої габарити товару),
//    маркування PDF (групою), позначка, коли з'явились супровідні документи (посилання і № рахунку «Вчасно»);
//  - передача в LP-CRM у «Нові»: ціна товару — ціна закупівлі для Розетки (не роздрібна);
//  - товари: артикул постачальника → товар LP-CRM, ціна закупівлі, РРЦ, залишок — з вивантаження Кабінету (CSV); прайс на Розетку не відправляємо.
// Групові дії браузер виконує по одному замовленню за запит (ліміти Cloudflare), з прогресом.
import { MASK, fail, need, nowIso, round2, loadSettings } from '../../core/common.js';
import { randomToken } from '../../core/auth.js';
import { logAudit } from '../../core/requisites.js';
import { addNewOrder, getOrdersBatch, getStatuses, phpSerialize, phpUrlencode } from '../../integrations/lpcrm.js';
import { ttnOf } from '../analytics/index.js';
import { rzsOrdersPage, rzsOrder, rzsConfirm, rzsCreateTtn, rzsMarkings, rzsDateTime, parseRzsProductsCsv } from '../../integrations/rozetka-supplier.js';

export const RZS_STATUS = {
  new: 'Нове', updated: 'Оновлене', confirmed: 'Підтверджене', shipping: 'Відправляється', problem: 'Проблема',
  closed: 'Закрите', delivery_refused: 'Відмова від отримання', shipped_from_rozetka: 'Відправлено з Розетки', deleted: 'Видалене',
};
export const UZD_STATUS = { not_uploaded: 'ЮЗД не завантажено', verified: 'ЮЗД звірено', problem: 'ЮЗД: проблема', skipped: 'ЮЗД пропущено' };
const SYNC_DAYS = 14;
const SYNC_PAGES = 8; // по 50 замовлень; решта — наступним зверненням
const SYNC_GAP_MS = 2 * 60 * 1000;
const PAGE_PAUSE_MS = 700;
const keyHint = (k) => (k ? `${MASK}${String(k).slice(-4)}` : '');
const newCode = () => `${Math.round(Date.now() / 100)}${String(Math.floor(10000 + Math.random() * 90000))}`;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
// Габарити з форми: «7,5» → 7.5.
const normSeat = (s) => Object.fromEntries(['lengthCm', 'widthCm', 'heightCm', 'weightKg'].map((k) => [k, num(s?.[k]) ?? 0]));
const goodSeat = (s) => ['lengthCm', 'widthCm', 'heightCm', 'weightKg'].every((k) => Number(s?.[k]) > 0);
const seatOf = (s) => ({ lengthCm: round2(Number(s.lengthCm)), widthCm: round2(Number(s.widthCm)), heightCm: round2(Number(s.heightCm)), weightKg: round2(Number(s.weightKg)) });
const userName = (u) => u?.name || u?.login || '';
let lastTickTry = 0;
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function mountRetail(app, { db, fetchFn, services = {}, onTick = () => {} }) {
  // ================================================================ кабінети
  const publicAcc = (a, origin = '') => ({
    id: a.id, name: a.name, token: keyHint(a.token), price_list_id: a.price_list_id, crm_office: a.crm_office, crm_delivery: a.crm_delivery,
    crm_site: a.crm_site, crm_field1: a.crm_field1 ?? '', sync_error: a.sync_error || '', sync_error_at: a.sync_error_at || '', notify_inv: !!a.notify_inv, notify_ttn: !!a.notify_ttn, notify_users: (() => { try { return JSON.parse(a.notify_users || '[]'); } catch { return []; } })(), active: a.active, synced_at: a.synced_at, hook_at: a.hook_at,
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
  // Кого можна вибрати для сповіщень (і чи підключено в нього Telegram-бота).
  app.get('/api/rzs/notify-users', async (c) => {
    need(c, 'api');
    const users = await db.all(`SELECT id, login, name, role, tg_chat_id FROM users WHERE active = 1 AND role != 'partner' ORDER BY name, login`);
    return c.json(users.map((u) => ({ id: u.id, name: u.name || u.login, tg: !!u.tg_chat_id, admin: ['owner', 'admin', 'admin_lite'].includes(u.role) })));
  });
  const accFields = (b, cur = {}) => ({
    name: String(b.name ?? cur.name ?? '').trim().slice(0, 100),
    price_list_id: String(b.price_list_id ?? cur.price_list_id ?? '').replace(/\D/g, '').slice(0, 20),
    crm_office: String(b.crm_office ?? cur.crm_office ?? '').replace(/\D/g, '').slice(0, 10),
    crm_delivery: String(b.crm_delivery ?? cur.crm_delivery ?? '1').replace(/\D/g, '').slice(0, 10),
    crm_site: String(b.crm_site ?? cur.crm_site ?? '').trim().slice(0, 100),
    crm_field1: String(b.crm_field1 ?? cur.crm_field1 ?? 'Riteil(Rozetka)').trim().slice(0, 100),
    notify_inv: b.notify_inv === undefined ? (cur.notify_inv ? 1 : 0) : (b.notify_inv ? 1 : 0),
    notify_ttn: b.notify_ttn === undefined ? (cur.notify_ttn ? 1 : 0) : (b.notify_ttn ? 1 : 0),
    notify_users: b.notify_users === undefined ? (cur.notify_users || '') : JSON.stringify((Array.isArray(b.notify_users) ? b.notify_users : []).map(Number).filter((x) => x > 0).slice(0, 50)),
    active: b.active === undefined ? (cur.active ?? 1) : (b.active ? 1 : 0),
  });
  app.post('/api/rzs/accounts', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const token = String(b.token || '').trim();
    if (token.length < 20) throw fail(400, 'Вставте токен з Кабінету постачальника Розетки: Налаштування → Токени → «Згенерувати токен».');
    await rzsOrdersPage(fetchFn, token, { dateFrom: rzsDateTime(new Date(Date.now() - 86400000)) }); // перевірка токена
    const f = accFields(b);
    const r = await db.run(`INSERT INTO rzs_accounts (name, token, price_list_id, crm_office, crm_delivery, crm_site, crm_field1, active, hook_user, hook_pass, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, [f.name || 'Розетка', token, f.price_list_id, f.crm_office, f.crm_delivery, f.crm_site, f.crm_field1, `rzs${randomToken(4)}`, randomToken(12), nowIso()]);
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
    await db.run(`UPDATE rzs_accounts SET name = ?, token = ?, price_list_id = ?, crm_office = ?, crm_delivery = ?, crm_site = ?, crm_field1 = ?, notify_inv = ?, notify_ttn = ?, notify_users = ?, active = ?, hook_pass = ? WHERE id = ?`,
      [f.name || cur.name, token, f.price_list_id, f.crm_office, f.crm_delivery, f.crm_site, f.crm_field1, f.notify_inv, f.notify_ttn, f.notify_users, f.active, pass, cur.id]);
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
    const old = new Map((await db.all(`SELECT id, docs_at, confirmed_at, ttn_at, document_link, products, status, uzd_status, ttn, invoice_no, inv_notified, ttn_notified FROM rzs_orders WHERE id IN (SELECT value FROM json_each(?))`,
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
    const codes = [...new Set(rows.flatMap((r) => (r.products || []).map((p) => String(p.supplierCode || '').trim()).filter(Boolean)))];
    for (const code of codes) {
      const p = rows.flatMap((r) => r.products || []).find((x) => String(x.supplierCode).trim() === code);
      st.push([`INSERT INTO rzs_products (code, rz_code, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET rz_code = CASE WHEN rzs_products.rz_code = '' THEN excluded.rz_code ELSE rzs_products.rz_code END`,
        [code, String(p?.rzCode ?? ''), now]]);
    }
    // Події для сповіщень: з'явився вхідний рахунок; замовлення стало готовим до ТТН (підтверджене, ЮЗД звірено, ТТН ще немає).
    const ready = (x) => ['confirmed', 'problem'].includes(x.status) && !x.ttn && ['verified', 'skipped'].includes(x.uzd_status);
    const events = { inv: [], ttn: [] };
    const KEYS = ['status', 'uzd_status', 'ttn', 'invoice_no', 'document_link'];
    saveOrders.changed = rows.filter((r) => { const o = old.get(r.id); return !o || KEYS.some((k) => String(r[k] ?? '') !== String(o[k] ?? '') && !(k === 'uzd_status' && !r[k])); }).length;
    for (const r of rows) {
      const o = old.get(r.id);
      if (!o) continue; // нове для нас замовлення (перше завантаження) — без сповіщень
      if (r.invoice_no && !o.invoice_no && !o.inv_notified) {
        events.inv.push(r);
        st.push([`UPDATE rzs_orders SET inv_notified = ? WHERE id = ?`, [now, r.id]]);
      }
      const uzd = r.uzd_status || o.uzd_status;
      if (ready({ ...r, uzd_status: uzd }) && !ready(o) && !o.ttn_notified) {
        events.ttn.push(r);
        st.push([`UPDATE rzs_orders SET ttn_notified = ? WHERE id = ?`, [now, r.id]]);
      }
    }
    await db.batch(st);
    if (codes.length) await autoMap(codes);
    if (events.inv.length || events.ttn.length) await notifyEvents(accountId, events).catch(() => 0);
    return rows.length;
  }
  // Сповіщення в Telegram (вмикає адмін у налаштуваннях кабінету): кому — вибрані користувачі або власник і адміни.
  async function notifyEvents(accountId, ev) {
    const a = await db.get(`SELECT * FROM rzs_accounts WHERE id = ?`, [accountId]);
    if (!a || !services.notify?.sendText) return;
    let ids = [];
    try { ids = JSON.parse(a.notify_users || '[]').map(Number).filter(Boolean); } catch { /* */ }
    const to = ids.length ? { userIds: ids } : { admins: true };
    const names = await prodNames(ev.inv.concat(ev.ttn));
    const line = (r) => `• <b>${esc(r.order_num)}</b> — ${esc(r.customer)}${names(r) ? ` · ${esc(names(r))}` : ''}`;
    const more = (l) => (l.length > 30 ? `\n…і ще ${l.length - 30}` : '');
    if (a.notify_inv && ev.inv.length) {
      await services.notify.sendText(to, `🧾 <b>Розетка${a.name && a.name !== 'Розетка' ? ` · ${esc(a.name)}` : ''}: з'явився вхідний рахунок (Вчасно)</b> — ${ev.inv.length}\n`
        + ev.inv.slice(0, 30).map((r) => `${line(r)} · рах. <b>${esc(r.invoice_no)}</b>`).join('\n') + more(ev.inv)
        + '\n\nЗавантажте документи для Розетки у «Вчасно», щоб можна було створити ТТН.');
    }
    if (a.notify_ttn && ev.ttn.length) {
      await services.notify.sendText(to, `🚚 <b>Розетка${a.name && a.name !== 'Розетка' ? ` · ${esc(a.name)}` : ''}: можна створювати ТТН</b> — ${ev.ttn.length}\n`
        + ev.ttn.slice(0, 30).map(line).join('\n') + more(ev.ttn)
        + '\n\nДокументи звірено (ЮЗД). ТТН — «Рітейл → Розетка» → фільтр «Без ТТН» → «🚚 Створити ТТН».');
    }
  }
  async function prodNames(rows) {
    const pm = await prodMap(rows.map((r) => ({ products: JSON.stringify(r.products || []) })));
    return (r) => (r.products || []).map((p) => `${pm.get(String(p.supplierCode).trim())?.name || p.supplierCode} × ${p.quantity}`).join(', ').slice(0, 200);
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
    let changed = 0;
    let more = false;
    try {
      for (let page = 1; page <= SYNC_PAGES; page++) {
        if (page > 1) await new Promise((r) => setTimeout(r, PAGE_PAUSE_MS)); // Розетка обмежує частоту запитів
        const r = await rzsOrdersPage(fetchFn, a.token, { dateFrom, page });
        saved += await saveOrders(r.orders, a.id);
        changed += saveOrders.changed || 0;
        if (!r.orders.length || page * 50 >= r.total) break;
        if (page === SYNC_PAGES) more = true;
      }
    } catch (e) {
      if (!e.pending) await db.run(`UPDATE rzs_accounts SET sync_error = ?, sync_error_at = ? WHERE id = ?`, [String(e.message || e).slice(0, 300), nowIso(), a.id]).catch(() => 0);
      throw e;
    }
    await db.run(`UPDATE rzs_accounts SET synced_at = ?, sync_error = '', sync_error_at = '' WHERE id = ?`, [nowIso(), a.id]);
    return { saved, changed, more };
  }
  // Сповіщення потребують свіжих даних: у фоні (на запитах до сайту) раз на 10 хв оновлюємо замовлення за 7 днів —
  // лише якщо в якомусь кабінеті ввімкнено сповіщення. Вебхук Розетки й так приносить зміни одразу.
  const TICK_MS = 10 * 60e3;
  onTick((c) => {
    if (Date.now() - (lastTickTry || 0) < 60e3) return;
    lastTickTry = Date.now();
    const p = (async () => {
      const accs = await db.all(`SELECT * FROM rzs_accounts WHERE active = 1 AND (notify_inv = 1 OR notify_ttn = 1)`);
      if (!accs.length) return;
      const now = Date.now();
      const claim = await db.run(`INSERT INTO settings (key, value) VALUES ('rzs_tick_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?`,
        [new Date(now).toISOString(), new Date(now - TICK_MS).toISOString()]);
      if (!claim.changes) return;
      for (const a of accs) await syncAccount(a, { days: 7 }).catch(() => 0);
    })().catch(() => 0);
    try { c?.executionCtx?.waitUntil(p); } catch { /* не Cloudflare */ }
  });
  app.post('/api/rzs/sync', async (c) => {
    need(c, 'docs.view');
    const b = await c.req.json().catch(() => ({}));
    const accs = await db.all(`SELECT * FROM rzs_accounts WHERE active = 1 ORDER BY id`);
    if (!accs.length) return c.json({ ok: false, accounts: 0 });
    const out = [];
    for (const a of accs) {
      if (!b.force && a.synced_at && Date.now() - Date.parse(a.synced_at) < SYNC_GAP_MS) { out.push({ id: a.id, skipped: true }); continue; }
      try { out.push({ id: a.id, ...(await syncAccount(a)) }); } catch (e) { if (e.pending) throw e; out.push({ id: a.id, error: e.message }); }
    }
    // Передані в LP-CRM, але номер ще не відомий (LP-CRM не встигла віддати) — дізнаємося за кодом.
    const noNum = await db.all(`SELECT id, crm_code FROM rzs_orders WHERE crm_code != '' AND crm_id = '' AND created_at >= ? LIMIT 100`, [new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)]);
    if (noNum.length) out.push({ crmNums: await fillCrmIds(noNum).catch(() => 0) });
    out.push({ crmStatus: await refreshCrmStatus().catch(() => 0) });
    // Нові ТТН — одразу шукаємо їх у LP-CRM (лише точний збіг ТТН).
    if (out.some((x) => x.saved)) {
      const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
      const todo = await db.all(`SELECT * FROM rzs_orders WHERE created_at >= ? AND ttn != '' AND crm_id = '' AND crm_code = '' AND status != 'deleted' LIMIT 200`, [since]);
      if (todo.length) out.push({ crm: (await findCrm(todo, { suggest: false }).catch(() => null))?.linked?.length || 0 });
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
    } else saved = (await syncAccount(a, { days: 2 }).catch((e) => { if (e.pending) throw e; return { saved: 0 }; })).saved; // помилку видно на сторінці
    return c.json({ ok: true, saved });
  });

  // ================================================================ список і картка
  const publicOrder = (r, prods = new Map()) => {
    let products = [];
    try { products = JSON.parse(r.products || '[]'); } catch { /* */ }
    return {
      ...r, products: products.map((p) => {
        const m = prods.get(String(p.supplierCode).trim());
        return { supplierCode: String(p.supplierCode || ''), rzCode: p.rzCode ?? '', quantity: Number(p.quantity) || 0, confirmedQuantity: p.confirmedQuantity ?? null,
          serialNumbers: p.serialNumbers || [], cargoSeats: Array.isArray(p.cargoSeats) ? p.cargoSeats : [],
          name: m?.name || '', product_id: m?.product_id ?? null, purchase_price: m?.purchase_price ?? null, own_seats: m?.seats ? JSON.parse(m.seats) : [] };
      }),
      status_name: RZS_STATUS[r.status] || r.status, uzd_name: UZD_STATUS[r.uzd_status] || r.uzd_status || '',
    };
  };
  const prodMap = async (rows) => {
    const codes = [...new Set(rows.flatMap((r) => { try { return JSON.parse(r.products || '[]').map((p) => String(p.supplierCode).trim()); } catch { return []; } }))];
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
    else if (st === 'noinv') where.push(`o.status IN ('confirmed', 'problem') AND o.invoice_no = '' AND o.ttn = ''`);
    else if (st === 'crmnew') where.push(`o.crm_new = 1`);
    else if (st === 'ready') where.push(`o.status IN ('confirmed', 'problem') AND o.ttn = '' AND o.uzd_status IN ('verified', 'skipped')`);
    else if (st && RZS_STATUS[st]) { where.push('o.status = ?'); params.push(st); }
    // LIKE у SQLite не зважає на регістр лише для латиниці — для кирилиці пробуємо «як є», малими і з великої.
    if (q) {
      const raw = String(c.req.query('q') || '').trim();
      const cap = q.replace(/(^|[\s'-])(\S)/g, (m, a, b) => a + b.toUpperCase());
      const vars = [...new Set([raw, q, cap])].map((v) => `%${v}%`);
      where.push(`(o.order_num LIKE ? OR o.phone LIKE ? OR o.ttn LIKE ? OR o.invoice_no LIKE ? OR ${vars.map(() => 'o.customer LIKE ?').join(' OR ')})`);
      params.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`, `%${q}%`, `%${raw}%`, ...vars);
    }
    const [rows, counts, accs] = await Promise.all([
      db.all(`SELECT o.*, a.name AS account FROM rzs_orders o LEFT JOIN rzs_accounts a ON a.id = o.account_id WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 300`, params),
      db.all(`SELECT status, COUNT(*) AS n FROM rzs_orders WHERE created_at >= ? GROUP BY status UNION ALL SELECT 'crmnew', COUNT(*) FROM rzs_orders WHERE created_at >= ? AND crm_new = 1`, [since, since]),
      db.all(`SELECT id, name, synced_at, hook_at, sync_error, sync_error_at FROM rzs_accounts WHERE active = 1`),
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
    // Без повторного читання замовлення: Розетка обмежує частоту запитів, а групове підтвердження й так іде одне за одним.
    const sent = new Map(products.map((p) => [p.supplierCode, p]));
    const confirmed = JSON.parse(r.products || '[]').map((x) => ({ ...x, ...sent.get(String(x.supplierCode)) }));
    await db.run(`UPDATE rzs_orders SET status = ?, products = ?, confirmed_at = COALESCE(NULLIF(confirmed_at, ''), ?), note = ? WHERE id = ?`,
      [res.status || 'confirmed', JSON.stringify(confirmed), nowIso(), `підтвердив(ла) ${userName(c.get('user'))}`, r.id]);
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
    if (!['verified', 'skipped'].includes(r.uzd_status)) throw fail(400, `${UZD_STATUS[r.uzd_status] || 'ЮЗД ще не звірено'} — ТТН можна створити, коли Розетка звірить документи (ЮЗД).`);
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
    // Етапи по черзі: у LP-CRM — лише з ТТН (вона йде в поле адреси доставки, менеджер переносить у поле ТТН).
    if (!r.ttn) throw fail(400, 'Ще немає ТТН — спершу створіть ТТН (її передамо в поле адреси доставки).');
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
        delivery_adress: r.ttn || [r.city, r.street].filter(Boolean).join(', '), sender: senderOf(c, a.crm_site), site: a.crm_site || new URL(c.req.url).host, additional_1: a.crm_field1 || '',
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

  // ================================================================ прив'язка до замовлень LP-CRM
  // Замовлення Розетки, які вже внесли в LP-CRM вручну: шукаємо за ТТН у даних LP-CRM, що сервіс уже має (аналітика,
  // перевірка дублів ТТН, індекс пошуку накладних), і перевіряємо одним запитом до LP-CRM. Збіг ТТН — прив'язуємо одразу;
  // збіг лише телефону — пропонуємо (прив'язує людина).
  const normTtn = (v) => String(v ?? '').replace(/\s/g, '').toUpperCase();
  const phone9 = (v) => String(v ?? '').replace(/\D/g, '').slice(-9);
  async function findCrm(rows, { suggest = true } = {}) {
    rows = rows.filter((r) => !r.crm_id && !r.crm_code && r.status !== 'deleted');
    const out = { checked: rows.length, linked: [], suggest: [], notFound: 0 };
    if (!rows.length) return out;
    const s = await loadSettings(db);
    if (!s.lpcrm_subdomain || !s.lpcrm_key) throw fail(400, 'Не налаштовано LP-CRM у «Налаштуваннях».');
    if (rows.some((r) => r.ttn)) await services.analytics?.ttnQuick?.().catch(() => 0); // нові ТТН з LP-CRM (раз на 10 хв)
    const ttns = [...new Set(rows.map((r) => normTtn(r.ttn)).filter(Boolean))];
    const phones = suggest ? [...new Set(rows.map((r) => phone9(r.phone)).filter((p) => p.length === 9))] : [];
    const J = (a) => JSON.stringify(a);
    const [a, b, k] = await Promise.all([
      ttns.length ? db.all(`SELECT code FROM an_ttn_recent WHERE ttn IN (SELECT value FROM json_each(?))`, [J(ttns)]).catch(() => []) : [],
      ttns.length ? db.all(`SELECT code FROM an_orders WHERE ttn IN (SELECT value FROM json_each(?))`, [J(ttns)]).catch(() => []) : [],
      db.all(`SELECT code FROM order_keys WHERE k IN (SELECT value FROM json_each(?))`, [J([...ttns, ...phones.map((p) => `p:${p}`)])]).catch(() => []),
    ]);
    let codes = [...new Set([...a, ...b, ...k].map((r) => String(r.code)))];
    const used = new Set(codes.length ? (await db.all(`SELECT crm_code FROM rzs_orders WHERE crm_code IN (SELECT value FROM json_each(?))`, [J(codes)])).map((r) => r.crm_code) : []);
    codes = codes.filter((c) => !used.has(c)).slice(0, 300);
    const crm = codes.length ? await getOrdersBatch(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, codes).catch((e) => { throw fail(502, `LP-CRM: ${e.message}`); }) : [];
    const list = crm.map((o) => ({ id: String(o.id ?? ''), code: String(o.order_id ?? ''), ttn: ttnOf(o), phone: phone9(o.phone), name: String(o.bayer_name ?? ''), status: String(o.status ?? '') }))
      .filter((o) => /^\d+$/.test(o.id) && o.code);
    const taken = new Set();
    const now = nowIso();
    const st = [];
    for (const r of rows) {
      const t = normTtn(r.ttn);
      const hit = t ? list.filter((o) => o.ttn === t && !taken.has(o.code)) : [];
      if (hit.length === 1) {
        taken.add(hit[0].code);
        st.push([`UPDATE rzs_orders SET crm_id = ?, crm_code = ?, crm_at = ?, note = ? WHERE id = ? AND crm_id = '' AND crm_code = ''`, [hit[0].id, hit[0].code, now, `знайдено в LP-CRM за ТТН ${t}`, r.id]]);
        out.linked.push({ id: r.id, order_num: r.order_num, crm_id: hit[0].id });
        continue;
      }
      const p = phone9(r.phone);
      const maybe = [...hit, ...(suggest && p.length === 9 ? list.filter((o) => o.phone === p && !hit.includes(o)) : [])].filter((o) => !taken.has(o.code)).slice(0, 3);
      if (maybe.length) out.suggest.push({ id: r.id, order_num: r.order_num, customer: r.customer, phone: r.phone, ttn: r.ttn, crm: maybe.map((o) => ({ id: o.id, name: o.name, ttn: o.ttn, phone: o.phone, by: o.ttn && o.ttn === t ? 'ТТН' : 'телефон' })) });
      else out.notFound++;
    }
    if (st.length) await db.batch(st);
    return out;
  }
  // Статуси замовлень у LP-CRM для прив'язаних замовлень Розетки (один запит на 100; назви статусів — кеш на добу).
  async function crmStatusNames(creds) {
    const row = await db.get(`SELECT value FROM settings WHERE key = 'statuses_cache'`);
    let cache = null;
    try { cache = row?.value ? JSON.parse(row.value) : null; } catch { /* */ }
    if (cache?.map && cache.sub === creds.subdomain && Date.now() - cache.at < 86400000) return cache.map;
    const map = await getStatuses(fetchFn, creds);
    await db.run(`INSERT INTO settings (key, value) VALUES ('statuses_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify({ at: Date.now(), sub: creds.subdomain, map })]);
    return map;
  }
  const CRM_CHECK_MS = 10 * 60e3;
  async function refreshCrmStatus({ force = false } = {}) {
    const s = await loadSettings(db);
    if (!s.lpcrm_subdomain || !s.lpcrm_key) return 0;
    const creds = { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key };
    const border = new Date(Date.now() - (force ? 60e3 : CRM_CHECK_MS)).toISOString();
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const rows = await db.all(`SELECT id, crm_id, crm_code FROM rzs_orders WHERE (crm_code != '' OR crm_id != '') AND created_at >= ? AND crm_checked_at < ?
      ORDER BY crm_checked_at LIMIT 100`, [since, border]);
    if (!rows.length) return 0;
    // Прив'язані вручну за номером — код дізнаємося з даних LP-CRM, що вже є в сервісі.
    for (const r of rows.filter((x) => !x.crm_code)) {
      r.crm_code = String((await db.get(`SELECT code FROM an_orders WHERE id = ?`, [Number(r.crm_id)]).catch(() => null))?.code
        || (await db.get(`SELECT code FROM order_keys WHERE k = ? LIMIT 1`, [r.crm_id]).catch(() => null))?.code || '');
    }
    const known = rows.filter((r) => r.crm_code);
    const [found, names] = await Promise.all([
      known.length ? getOrdersBatch(fetchFn, creds, known.map((r) => r.crm_code)) : [],
      crmStatusNames(creds).catch(() => ({})),
    ]);
    const now = nowIso();
    const st = rows.filter((r) => !r.crm_code).map((r) => [`UPDATE rzs_orders SET crm_checked_at = ? WHERE id = ?`, [now, r.id]]);
    for (const r of known) {
      const o = found.find((x) => String(x.order_id) === r.crm_code);
      const sid = o ? String(o.status ?? o.status_id ?? '') : '';
      const name = o ? String((names[sid]?.name ?? names[sid]) || sid || '').trim() : 'не знайдено в LP-CRM';
      const num = o && /^\d+$/.test(String(o.id ?? '')) ? String(o.id) : r.crm_id;
      st.push([`UPDATE rzs_orders SET crm_status = ?, crm_new = ?, crm_checked_at = ?, crm_code = ?, crm_id = ? WHERE id = ?`, [name, /^нов/i.test(name) ? 1 : 0, now, r.crm_code, num || '', r.id]]);
    }
    if (st.length) await db.batch(st);
    return known.length;
  }
  app.post('/api/rzs/crm-status', async (c) => {
    need(c, 'docs.view');
    return c.json({ checked: await refreshCrmStatus({ force: true }) });
  });
  async function fillCrmIds(rows) {
    const s = await loadSettings(db);
    if (!s.lpcrm_subdomain || !s.lpcrm_key) return 0;
    const got = await getOrdersBatch(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, rows.map((r) => r.crm_code));
    const st = [];
    for (const r of rows) {
      const o = got.find((x) => String(x.order_id) === r.crm_code);
      if (o && /^\d+$/.test(String(o.id ?? ''))) st.push([`UPDATE rzs_orders SET crm_id = ? WHERE id = ? AND crm_id = ''`, [String(o.id), r.id]]);
    }
    if (st.length) await db.batch(st);
    return st.length;
  }
  app.post('/api/rzs/crm-find', async (c) => {
    need(c, 'docs.edit');
    const b = await c.req.json().catch(() => ({}));
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, 300) : null;
    const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const rows = ids ? await db.all(`SELECT * FROM rzs_orders WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)])
      : await db.all(`SELECT * FROM rzs_orders WHERE created_at >= ? AND crm_id = '' AND crm_code = '' AND status != 'deleted' ORDER BY created_at DESC LIMIT 300`, [since]);
    return c.json(await findCrm(rows));
  });
  // Ручна прив'язка: № замовлення LP-CRM (як у картці) або його код; порожньо — відв'язати.
  app.put('/api/rzs/orders/:id/crm-link', async (c) => {
    need(c, 'docs.edit');
    const r = await orderRow(c.req.param('id'));
    const val = String((await c.req.json().catch(() => ({}))).crm ?? '').replace(/\s/g, '');
    if (!val) {
      await db.run(`UPDATE rzs_orders SET crm_id = '', crm_code = '', crm_at = '', note = ? WHERE id = ?`, [`відв'язав(ла) від LP-CRM ${userName(c.get('user'))}`, r.id]);
      return c.json({ ok: true, crm_id: '' });
    }
    if (!/^\d{1,20}$/.test(val)) throw fail(400, 'Номер замовлення LP-CRM — лише цифри.');
    let id = val.length <= 10 ? val : '';
    let code = val.length > 10 ? val : '';
    if (!code) code = String((await db.get(`SELECT code FROM an_orders WHERE id = ?`, [Number(id)]).catch(() => null))?.code
      || (await db.get(`SELECT code FROM order_keys WHERE k = ? LIMIT 1`, [id]).catch(() => null))?.code || '');
    const s = await loadSettings(db);
    if (code && s.lpcrm_subdomain && s.lpcrm_key) {
      const o = (await getOrdersBatch(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, [code]).catch(() => [])).find((x) => String(x.order_id) === code);
      if (o && /^\d+$/.test(String(o.id ?? ''))) id = String(o.id);
      else if (!id) throw fail(404, 'Замовлення з таким кодом у LP-CRM не знайдено.');
    }
    const other = await db.get(`SELECT order_num FROM rzs_orders WHERE id != ? AND ((crm_id != '' AND crm_id = ?) OR (crm_code != '' AND crm_code = ?)) LIMIT 1`, [r.id, id, code]);
    if (other) throw fail(400, `Це замовлення LP-CRM уже прив'язане до ${other.order_num}.`);
    await db.run(`UPDATE rzs_orders SET crm_id = ?, crm_code = ?, crm_at = ?, note = ? WHERE id = ?`, [id, code, nowIso(), `прив'язав(ла) до LP-CRM ${userName(c.get('user'))}`, r.id]);
    return c.json({ ok: true, crm_id: id, code });
  });

  // ================================================================ товари
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
  // Імпорт вивантаження товарів з Кабінету постачальника (CSV): нові артикули додаються, наявні — оновлюються назва, код Розетки,
  // РРЦ, ціна закупівлі, залишок, статус; прив'язку до товару LP-CRM і габарити не чіпаємо. Тіло запиту — текст файлу.
  app.post('/api/rzs/products/import', async (c) => {
    need(c, 'refs.edit');
    const text = await c.req.text();
    if (text.length > 5 * 1024 * 1024) throw fail(400, 'Файл завеликий (понад 5 МБ).');
    const { rows, skipped } = parseRzsProductsCsv(text);
    if (!rows.length) throw fail(400, 'У файлі немає жодного товару з артикулом.');
    if (rows.length > 5000) throw fail(400, 'Не більше 5000 товарів за раз.');
    const uniq = [...new Map(rows.map((r) => [r.code, r])).values()];
    const have = new Set((await db.all(`SELECT code FROM rzs_products WHERE code IN (SELECT value FROM json_each(?))`, [JSON.stringify(uniq.map((r) => r.code))])).map((r) => r.code));
    const now = nowIso();
    const st = uniq.map((r) => [`INSERT INTO rzs_products (code, rz_code, name, purchase_price, rrp, stock, rz_status, brand, imported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET rz_code = CASE WHEN excluded.rz_code != '' THEN excluded.rz_code ELSE rzs_products.rz_code END,
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE rzs_products.name END,
        purchase_price = COALESCE(excluded.purchase_price, rzs_products.purchase_price), rrp = COALESCE(excluded.rrp, rzs_products.rrp),
        stock = COALESCE(excluded.stock, rzs_products.stock), rz_status = excluded.rz_status, brand = excluded.brand, imported_at = excluded.imported_at, updated_at = excluded.updated_at`,
    [r.code, r.rz_code, r.name, r.purchase_price, r.rrp, r.stock, r.status, r.brand, now, now]]);
    for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100));
    await autoMap(uniq.map((r) => r.code));
    const unmapped = (await db.get(`SELECT COUNT(*) AS n FROM rzs_products WHERE product_id IS NULL`))?.n || 0;
    await logAudit(db, { user: c.get('user'), kind: 'rzs', refId: 0, action: `імпорт товарів з Кабінету Розетки: ${uniq.length} (нових ${uniq.filter((r) => !have.has(r.code)).length})` }).catch(() => 0);
    return c.json({ ok: true, total: uniq.length, added: uniq.filter((r) => !have.has(r.code)).length, updated: uniq.filter((r) => have.has(r.code)).length, skipped, unmapped });
  });

  // Для вкладки «Накладні»: чи замовлення LP-CRM — це замовлення Розетки (за прив'язкою № / кодом, «Rozetka …» у коментарі
  // або за ТТН). Тоді накладну ФОП не формуємо — маркування й супровідні документи беремо з Розетки.
  async function orderInfo({ ids = [], comment = '', ttn = '' } = {}) {
    const list = [...new Set(ids.map((x) => String(x ?? '').trim()).filter((x) => /^\d+$/.test(x)))];
    let r = null;
    if (list.length) {
      r = await db.get(`SELECT * FROM rzs_orders WHERE (crm_id != '' AND crm_id IN (SELECT value FROM json_each(?))) OR (crm_code != '' AND crm_code IN (SELECT value FROM json_each(?)))
        ORDER BY created_at DESC LIMIT 1`, [JSON.stringify(list), JSON.stringify(list)]);
    }
    const m = /Rozetka\s+([A-Za-zА-Яа-я]*\d{5,})/.exec(String(comment || ''));
    if (!r && m) r = await db.get(`SELECT * FROM rzs_orders WHERE order_num = ? LIMIT 1`, [m[1]]);
    const t = normTtn(ttn);
    if (!r && t.length >= 10) r = await db.get(`SELECT * FROM rzs_orders WHERE REPLACE(ttn, ' ', '') = ? ORDER BY created_at DESC LIMIT 1`, [t]);
    if (!r) return null;
    const a = await db.get(`SELECT name FROM rzs_accounts WHERE id = ?`, [r.account_id]);
    return {
      id: r.id, order_num: r.order_num, account: a?.name || '', status: r.status, status_name: RZS_STATUS[r.status] || r.status, customer: r.customer,
      ttn: r.ttn, tracking_status: r.tracking_status, document_link: r.document_link, invoice_no: r.invoice_no, docs_at: r.docs_at, crm_id: r.crm_id,
    };
  }
  // Для головної сторінки: що в Розетці чекає дій.
  async function attention() {
    const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const r = await db.get(`SELECT SUM(status IN ('new', 'updated')) AS todo, SUM(status IN ('confirmed', 'problem') AND ttn = '' AND uzd_status IN ('verified', 'skipped')) AS ready
      FROM rzs_orders WHERE created_at >= ?`, [since]);
    return [
      { key: 'rz_todo', level: 'warn', count: r?.todo || 0, label: 'Нові замовлення Розетки — підтвердити', link: '#/rzorders' },
      { key: 'rz_ready', level: 'info', count: r?.ready || 0, label: 'Розетка: можна створити ТТН', link: '#/rzorders' },
    ].filter((x) => x.count > 0);
  }
  return { orderInfo, attention };
}
