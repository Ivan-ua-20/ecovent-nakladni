// B2B етап 3: замовлення для клієнтів партнера.
// Партнер оформлює замовлення клієнта (ПІБ, телефон, свою ТТН, файл маркування) з товарів конкретної закупівлі — у межах
// залишку. Закупівля ще не оплачена — замовлення можна оформити, але воно позначене «Не оплачено». Без закупівлі — теж
// можна (товари з каталогу за ціною партнера), таке замовлення підсвічене червоним; адмін пізніше додає рахунок/накладну.
// Адмін або власник натискає «Додати в CRM» (LP-CRM addNewOrder, відділ B2B, ціни партнера, «Поле 1» порожнє) або вписує
// номер замовлення з CRM вручну. Статус замовлення в CRM партнер бачить у кабінеті (оновлюється не частіше ніж раз на 10 хв).
// Передачу в CRM вмикає адмін у «Налаштуваннях CRM» (ID відділу + перемикач) — коли ключ LP-CRM отримає дозвіл на addNewOrder.
import { fail, need, nowIso, loadSettings, MASK } from '../../core/common.js';
import { addNewOrder, getOrdersBatch, getStatuses, phpSerialize, phpUrlencode } from '../../integrations/lpcrm.js';
import { CLIENT_STATUS, ORDER_STATUS, payState, orderNo } from './orders.js';

const CRM_REFRESH_MIN = 10;
const CRM_TRACK_DAYS = 60;
const SENDING_TTL_MS = 2 * 60 * 1000;
const ID_RE = /^[1-9]\d{0,9}$/;
const CODE_RE = /^\d{11,20}$/; // код (ідентифікатор) замовлення LP-CRM — order_id у getOrdersByID / addNewOrder
const DEFAULT_OFFICE = '27'; // відділ B2B у LP-CRM
const OPT_ID_RE = /^\d{0,10}$/;
const TTN_FIELDS = ['', 'additional_2', 'additional_3', 'additional_4', 'delivery_adress'];
// Код нового замовлення — як у прикладі LP-CRM: microtime×10 (11 цифр) + 5 випадкових.
const newCode = () => `${Math.round(Date.now() / 100)}${String(Math.floor(10000 + Math.random() * 90000))}`;

export function mountB2bClients(app, { db, fetchFn, myPartner, orders }) {
  const { priceItems, totalOf, itemRows, orderOf, orderDetail, publicOrder, supplyLeft, saveFile, log, tgAdmins, tgPartner, tgGroup, link, uah, h } = orders;
  const userName = (u) => u?.name || u?.login || '';
  const SELECT = `SELECT o.*, s.status AS supply_status, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files
    FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id`;

  // ---------------------------------------------------------------- налаштування передачі в CRM
  // Для addNewOrder LP-CRM дає окремий «Вхідний ключ API» (lpcrm_in_key); читання статусів — основним ключем (lpcrm_key).
  async function crmConfig() {
    const s = await loadSettings(db);
    const creds = { subdomain: s.lpcrm_subdomain || '', key: s.lpcrm_key || '' };
    return {
      on: s.b2b_crm_on === '1',
      office: s.b2b_crm_office ?? DEFAULT_OFFICE,
      delivery: s.b2b_crm_delivery || '',
      payment: s.b2b_crm_payment || '',
      notification: s.b2b_crm_notification || '',
      ttnField: TTN_FIELDS.includes(s.b2b_crm_ttn_field) ? s.b2b_crm_ttn_field : '',
      site: s.b2b_crm_site || '',
      hasInKey: !!s.lpcrm_in_key,
      creds,
      addCreds: { subdomain: creds.subdomain, key: s.lpcrm_in_key || creds.key },
    };
  }
  app.get('/api/b2b/crm-settings', async (c) => {
    need(c, 'b2b.admin');
    const k = await crmConfig();
    return c.json({
      on: k.on, office: k.office, delivery: k.delivery, payment: k.payment, notification: k.notification, ttn_field: k.ttnField, site: k.site,
      in_key: k.hasInKey ? MASK : '', ready: !!(k.creds.subdomain && k.creds.key),
    });
  });
  app.put('/api/b2b/crm-settings', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json();
    const office = String(b.office ?? '').trim();
    if (office && !ID_RE.test(office)) throw fail(400, 'ID відділу — число з LP-CRM (Налаштування → Відділи).');
    if (b.on && !office) throw fail(400, 'Спершу вкажіть ID відділу B2B.');
    const opt = {};
    for (const [f, name] of [['delivery', 'виду доставки'], ['payment', 'виду оплати'], ['notification', 'позначки']]) {
      opt[f] = String(b[f] ?? '').trim();
      if (!OPT_ID_RE.test(opt[f])) throw fail(400, `ID ${name} — число з LP-CRM або порожньо.`);
    }
    const ttnField = TTN_FIELDS.includes(b.ttn_field) ? b.ttn_field : '';
    const set = (key, value) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]];
    const st = [set('b2b_crm_office', office), set('b2b_crm_on', b.on ? '1' : '0'), set('b2b_crm_delivery', opt.delivery),
      set('b2b_crm_payment', opt.payment), set('b2b_crm_notification', opt.notification), set('b2b_crm_ttn_field', ttnField)];
    if (b.site !== undefined) {
      const site = String(b.site).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
      if (site && !/^[a-z0-9.-]{3,100}$/.test(site)) throw fail(400, 'Сайт — домен без https://, напр. b2b.ecovent.ua');
      st.push(set('b2b_crm_site', site));
    }
    if (b.in_key !== undefined && b.in_key !== MASK) {
      const key = String(b.in_key).trim();
      if (key && !/^[A-Za-z0-9]{16,64}$/.test(key)) throw fail(400, 'Вхідний ключ API — латинські літери й цифри (як у LP-CRM → Інтеграції → Landing page).');
      st.push(set('lpcrm_in_key', key));
    }
    await db.batch(st);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- статуси з CRM
  async function statusNames(creds) {
    const row = await db.get(`SELECT value FROM settings WHERE key = 'statuses_cache'`);
    const cache = row?.value ? JSON.parse(row.value) : null;
    if (cache?.map && cache.sub === creds.subdomain && Date.now() - cache.at < 86400000) return cache.map;
    const map = await getStatuses(fetchFn, creds);
    await db.run(`INSERT INTO settings (key, value) VALUES ('statuses_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify({ at: Date.now(), sub: creds.subdomain, map })]);
    return map;
  }
  // Оновлює статуси прив'язаних замовлень, які давно не перевіряли (до 100 — один запит getOrdersByID). Збій CRM — не помилка.
  // Кодом замовлення (order_id) LP-CRM шукає замовлення; номер (id) — для людей. Номер, вписаний вручну,
  // переводимо в код через індекси пошуку накладних і аналітики (там є пари номер → код).
  async function codeOfId(id) {
    const r = await db.get(`SELECT code FROM an_orders WHERE id = ?`, [parseInt(id, 10) || 0]).catch(() => null)
      || await db.get(`SELECT code FROM order_keys WHERE k = ? LIMIT 1`, [String(id)]).catch(() => null);
    return r?.code ? String(r.code) : '';
  }
  async function refreshCrm({ partnerId = null, ids = null } = {}) {
    const border = new Date(Date.now() - CRM_REFRESH_MIN * 60000).toISOString();
    const since = new Date(Date.now() - CRM_TRACK_DAYS * 86400000).toISOString();
    const where = [`kind = 'client'`, `status = 'crm'`, `(crm_id != '' OR crm_ext != '')`];
    const params = [];
    if (ids) { where.push(`id IN (SELECT value FROM json_each(?))`); params.push(JSON.stringify(ids)); }
    else { where.push('crm_checked_at < ?', 'created_at > ?'); params.push(border, since); }
    if (partnerId) { where.push('partner_id = ?'); params.push(partnerId); }
    const rows = await db.all(`SELECT id, crm_id, crm_ext FROM b2b_orders WHERE ${where.join(' AND ')} ORDER BY crm_checked_at LIMIT 100`, params);
    if (!rows.length) return;
    const { creds } = await crmConfig();
    if (!creds.subdomain || !creds.key) return;
    const now = nowIso();
    for (const r of rows) if (!r.crm_ext && r.crm_id) r.crm_ext = await codeOfId(r.crm_id);
    const known = rows.filter((r) => r.crm_ext);
    const unknown = rows.filter((r) => !r.crm_ext);
    const st = unknown.map((r) => [`UPDATE b2b_orders SET crm_status = ?, crm_checked_at = ? WHERE id = ?`,
      ['Статус з’явиться після оновлення аналітики', now, r.id]]);
    try {
      if (known.length) {
        const found = await getOrdersBatch(fetchFn, creds, [...new Set(known.map((r) => r.crm_ext))]);
        const names = await statusNames(creds).catch(() => ({}));
        const byCode = new Map(found.map((o) => [String(o.order_id ?? ''), o]));
        for (const r of known) {
          const o = byCode.get(r.crm_ext);
          const s = o ? String(o.status ?? o.status_id ?? '') : '';
          const name = o ? String((names[s]?.name ?? names[s]) || s || '—').trim() : 'Не знайдено в CRM';
          const num = o && /^\d+$/.test(String(o.id ?? '')) ? String(o.id) : r.crm_id;
          st.push([`UPDATE b2b_orders SET crm_status = ?, crm_checked_at = ?, crm_ext = ?, crm_id = ? WHERE id = ?`, [name, now, r.crm_ext, num || '', r.id]]);
        }
      }
    } catch { /* CRM недоступна — покажемо останній відомий статус */ }
    if (st.length) await db.batch(st);
  }

  // ---------------------------------------------------------------- дані клієнта й позиції
  function clientFields(b) {
    const name = String(b.client_name ?? '').trim().replace(/\s+/g, ' ').slice(0, 150);
    let phone = String(b.client_phone ?? '').replace(/\D/g, '');
    if (/^0\d{9}$/.test(phone)) phone = `38${phone}`;
    const ttn = String(b.ttn ?? '').replace(/\s/g, '').toUpperCase().slice(0, 40);
    if (!name) throw fail(400, 'Вкажіть ПІБ клієнта.');
    if (!/^380\d{9}$/.test(phone)) throw fail(400, 'Телефон клієнта: 0XXXXXXXXX або 380XXXXXXXXX.');
    if (ttn && !/^[0-9A-Z-]{6,40}$/.test(ttn)) throw fail(400, 'ТТН — лише цифри й латинські літери (6–40 символів).');
    return { client_name: name, client_phone: phone, ttn, comment: String(b.comment ?? '').trim().slice(0, 500) };
  }

  // Позиції з закупівлі: ціна — та, за якою закупили; кількість — не більше залишку.
  async function supplyItems(p, supplyId, items, exceptId = 0) {
    const s = await db.get(`SELECT * FROM b2b_orders WHERE id = ? AND partner_id = ? AND kind = 'supply'`, [supplyId, p.id]);
    if (!s) throw fail(404, 'Закупівлю не знайдено.');
    if (s.status === 'cancelled') throw fail(400, `Закупівлю ${orderNo(s.id)} скасовано — оберіть іншу.`);
    const left = new Map((await supplyLeft(s.id, exceptId)).map((r) => [r.product_id, r]));
    const want = new Map();
    for (const it of Array.isArray(items) ? items : []) {
      const id = parseInt(it.product_id, 10);
      const qty = Number(it.qty);
      if (!id || !Number.isInteger(qty) || qty <= 0) continue;
      want.set(id, (want.get(id) || 0) + qty);
    }
    if (!want.size) throw fail(400, 'Додайте хоча б один товар із кількістю.');
    return [...want].map(([id, qty]) => {
      const r = left.get(id);
      if (!r) throw fail(400, `Товару ID ${id} немає в закупівлі ${orderNo(s.id)}.`);
      if (qty > r.left) throw fail(400, `«${r.name}»: у закупівлі ${orderNo(s.id)} залишилось ${Math.max(0, r.left)} шт.`);
      return { product_id: id, name: r.name, article: r.article || '', qty, price: r.price, rrp: r.rrp };
    });
  }
  async function buildItems(p, b, exceptId = 0) {
    const supplyId = parseInt(b.supply_id, 10) || null;
    const items = supplyId ? await supplyItems(p, supplyId, b.items, exceptId) : await priceItems(p, b.items);
    return { supplyId, items, total: totalOf(items) };
  }
  function senderOf(c, siteSetting) {
    const url = new URL(c.req.url);
    const host = siteSetting || url.host;
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
    return phpUrlencode(phpSerialize({
      HTTP_HOST: host, SERVER_NAME: host, REQUEST_URI: '/b2b', HTTP_REFERER: `https://${host}/b2b`,
      REMOTE_ADDR: ip, HTTP_USER_AGENT: 'Ecovent B2B', REQUEST_SCHEME: 'https', HTTPS: 'on',
    }));
  }
  const tgNew = async (c, p, id, f, it, verb = 'Нове замовлення клієнта') => {
    const lines = it.items.slice(0, 60).map((i) => `${h(i.name)} — ${i.qty} шт — ${uah(i.price)}`).join('\n');
    const text = `📦 <b>${verb} ${orderNo(id)}</b> від «${h(p.name)}»\n\n<b>Клієнт:</b> ${h(f.client_name)}, ${h(f.client_phone)}${f.ttn ? `\n<b>ТТН:</b> ${h(f.ttn)}` : ''}\n`
      + `${it.supplyId ? `Із закупівлі ${orderNo(it.supplyId)}` : '🔴 <b>Без закупівлі</b>'}\n\n<b>Товари:</b>\n${lines}\n\n<b>Разом: ${uah(it.total)}</b>`;
    await tgAdmins(`${text}\n\n${link(c, `b2bclients/${id}`)}`);
    await tgGroup(p.id, text);
  };


  // ================================================================ ПАРТНЕР
  // Закупівлі, з яких можна оформити замовлення клієнта: не скасовані, із залишком (за останні 180 днів).
  app.get('/api/b2b/p/supplies', async (c) => {
    const p = await myPartner(c);
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const rows = await db.all(
      `SELECT s.id, s.status, s.created_at, s.total, s.invoice_no, i.product_id, i.name, i.article, i.price, i.qty,
         COALESCE((SELECT SUM(ci.qty) FROM b2b_order_items ci JOIN b2b_orders co ON co.id = ci.order_id
           WHERE co.supply_id = s.id AND co.kind = 'client' AND co.status != 'cancelled' AND ci.product_id = i.product_id), 0) AS used
       FROM b2b_orders s JOIN b2b_order_items i ON i.order_id = s.id
       WHERE s.partner_id = ? AND s.kind = 'supply' AND s.status != 'cancelled' AND s.created_at > ? ORDER BY s.id DESC, i.id`, [p.id, since],
    );
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, number: orderNo(r.id), status: r.status, status_name: ORDER_STATUS[r.status] || r.status, created_at: r.created_at, total: r.total, invoice_no: r.invoice_no, pay: payState({ kind: 'client', supply_id: r.id, supply_status: r.status }), items: [] });
      map.get(r.id).items.push({ product_id: r.product_id, name: r.name, article: r.article, price: r.price, qty: r.qty, left: r.qty - r.used });
    }
    return c.json([...map.values()].filter((s) => s.items.some((i) => i.left > 0)));
  });

  app.get('/api/b2b/p/clients', async (c) => {
    const p = await myPartner(c);
    await refreshCrm({ partnerId: p.id });
    const rows = await db.all(`${SELECT} WHERE o.partner_id = ? AND o.kind = 'client' ORDER BY o.id DESC LIMIT 300`, [p.id]);
    return c.json({ rows: rows.map(publicOrder), statuses: CLIENT_STATUS });
  });

  async function myClientOrder(c, p) {
    const o = await orderOf(c.req.param('id'), p.id);
    if (o.kind !== 'client') throw fail(404, 'Замовлення не знайдено.');
    return o;
  }

  app.get('/api/b2b/p/clients/:id', async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.crm_id) await refreshCrm({ partnerId: p.id });
    return c.json(await orderDetail(await orderOf(o.id, p.id)));
  });

  app.post('/api/b2b/p/clients', async (c) => {
    const p = await myPartner(c);
    const b = await c.req.json();
    const f = clientFields(b);
    const it = await buildItems(p, b);
    const now = nowIso();
    const u = c.get('user');
    const r = await db.run(
      `INSERT INTO b2b_orders (partner_id, kind, status, supply_id, client_name, client_phone, ttn, total, comment, created_by, created_at, updated_at)
       VALUES (?, 'client', 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, it.supplyId, f.client_name, f.client_phone, f.ttn, it.total, f.comment, userName(u), now, now],
    );
    await db.batch([...itemRows(r.lastId, it.items), [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`,
      [r.lastId, now, userName(u), `оформлено замовлення клієнта на ${uah(it.total)}${it.supplyId ? ` із закупівлі ${orderNo(it.supplyId)}` : ' без закупівлі'}`]]]);
    await tgNew(c, p, r.lastId, f, it);
    return c.json({ id: r.lastId, number: orderNo(r.lastId), total: it.total });
  });

  // Змінити чи скасувати можна, доки замовлення не передане в CRM.
  app.put('/api/b2b/p/clients/:id', async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== 'new') throw fail(400, 'Замовлення вже передане в роботу — змінити його може лише менеджер.');
    const b = await c.req.json();
    const f = clientFields(b);
    const it = await buildItems(p, b, o.id);
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      ...itemRows(o.id, it.items),
      [`UPDATE b2b_orders SET supply_id = ?, client_name = ?, client_phone = ?, ttn = ?, total = ?, comment = ?, updated_at = ? WHERE id = ?`,
        [it.supplyId, f.client_name, f.client_phone, f.ttn, it.total, f.comment, nowIso(), o.id]],
    ]);
    await log(o.id, c.get('user'), `змінено замовлення клієнта: ${it.items.length} поз., ${uah(it.total)}`);
    await tgNew(c, p, o.id, f, it, 'Змінено замовлення клієнта');
    return c.json({ ok: true, total: it.total });
  });

  app.post('/api/b2b/p/clients/:id/cancel', async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== 'new') throw fail(400, 'Замовлення вже передане в роботу — скасувати його може лише менеджер.');
    await db.run(`UPDATE b2b_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    await log(o.id, c.get('user'), 'партнер скасував замовлення клієнта');
    await tgAdmins(`❌ <b>Скасовано замовлення клієнта ${orderNo(o.id)}</b> («${h(p.name)}»)\n${link(c, `b2bclients/${o.id}`)}`);
    return c.json({ ok: true });
  });

  // Маркування (етикетка ТТН) — файл від партнера; доки замовлення не передане в CRM.
  app.post('/api/b2b/p/clients/:id/files', async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== 'new') throw fail(400, 'Замовлення вже в роботі — новий файл маркування надішліть менеджеру.');
    if ((await db.get(`SELECT COUNT(*) AS n FROM b2b_files WHERE order_id = ?`, [o.id])).n >= 10) throw fail(400, 'Не більше 10 файлів у замовленні.');
    return c.json({ id: (await saveFile(c, o, 'label')).id });
  });
  app.delete('/api/b2b/p/clients/:id/files/:fid', async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== 'new') throw fail(400, 'Замовлення вже в роботі.');
    const f = await db.get(`SELECT * FROM b2b_files WHERE id = ? AND order_id = ? AND kind = 'label'`, [c.req.param('fid'), o.id]);
    if (!f) throw fail(404, 'Файл не знайдено.');
    await db.batch([[`DELETE FROM b2b_file_parts WHERE file_id = ?`, [f.id]], [`DELETE FROM b2b_files WHERE id = ?`, [f.id]]]);
    await log(o.id, c.get('user'), `видалено файл «${f.name}»`);
    return c.json({ ok: true });
  });

  // ================================================================ АДМІН / ВЛАСНИК
  const VIEWS = {
    new: `o.status = 'new'`,
    crm: `o.status = 'crm'`,
    nosupply: `o.supply_id IS NULL AND o.status != 'cancelled'`,
    cancelled: `o.status = 'cancelled'`,
  };
  app.get('/api/b2b/clients', async (c) => {
    need(c, 'b2b.admin');
    await refreshCrm();
    const where = [`o.kind = 'client'`];
    const params = [];
    const v = c.req.query('view');
    const pid = parseInt(c.req.query('partner'), 10);
    if (VIEWS[v]) where.push(VIEWS[v]);
    if (pid) { where.push('o.partner_id = ?'); params.push(pid); }
    const rows = await db.all(
      `SELECT o.*, s.status AS supply_status, p.name AS partner, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files
       FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id JOIN b2b_partners p ON p.id = o.partner_id
       WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, params,
    );
    const cnt = await db.get(`SELECT SUM(status = 'new') AS new, SUM(status = 'crm') AS crm, SUM(supply_id IS NULL AND status != 'cancelled') AS nosupply,
      SUM(status = 'cancelled') AS cancelled FROM b2b_orders WHERE kind = 'client'`);
    return c.json({ rows: rows.map(publicOrder), counts: cnt || {}, crm: (await crmConfig()).on });
  });

  async function clientOrder(c) {
    const o = await orderOf(c.req.param('id'));
    if (o.kind !== 'client') throw fail(404, 'Замовлення не знайдено.');
    return o;
  }

  // «Додати в CRM»: замовлення в LP-CRM (вкладка «Нові» — статус за замовчуванням), відділ B2B, ціни партнера.
  app.post('/api/b2b/clients/:id/crm', async (c) => {
    need(c, 'b2b.admin');
    const o = await clientOrder(c);
    if (o.status !== 'new' || o.crm_id) throw fail(400, o.status === 'crm' || o.crm_id ? `Уже в CRM${o.crm_id ? `: № ${o.crm_id}` : ''}.` : 'Замовлення скасовано.');
    const k = await crmConfig();
    if (!k.on) throw fail(400, 'Передачу в LP-CRM ще не ввімкнено. Коли ключ LP-CRM отримає дозвіл на addNewOrder — увімкніть її в «Налаштуваннях CRM» (вкладка «Замовлення клієнтів»). Поки що створіть замовлення в CRM вручну і впишіть його номер.');
    if (!k.office) throw fail(400, 'Не вказано ID відділу B2B у «Налаштуваннях CRM».');
    if (!k.creds.subdomain || !k.creds.key) throw fail(400, 'Не налаштовано LP-CRM: піддомен і API-ключ у «Налаштуваннях».');
    // Захист від подвійного натискання: «бронюємо» відправку.
    const code = newCode();
    const now = nowIso();
    const stale = new Date(Date.now() - SENDING_TTL_MS).toISOString();
    const claim = await db.run(
      `UPDATE b2b_orders SET crm_ext = ?, crm_sent_at = ? WHERE id = ? AND status = 'new' AND crm_id = '' AND (crm_sent_at = '' OR crm_sent_at IS NULL OR crm_sent_at < ?)`,
      [code, `sending:${now}`, o.id, `sending:${stale}`],
    );
    if (!claim.changes) throw fail(409, 'Замовлення вже надсилається в CRM — оновіть сторінку за хвилину.');
    const [items, p] = await Promise.all([
      db.all(`SELECT product_id, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]),
      db.get(`SELECT name FROM b2b_partners WHERE id = ?`, [o.partner_id]),
    ]);
    const supply = o.supply_id ? await db.get(`SELECT status FROM b2b_orders WHERE id = ?`, [o.supply_id]) : null;
    const pay = payState({ ...o, supply_status: supply?.status });
    const comment = [
      `${orderNo(o.id)} · B2B «${p?.name || ''}»`,
      o.ttn ? `ТТН партнера: ${o.ttn}` : '',
      o.supply_id ? `Закупівля ${orderNo(o.supply_id)}${pay === 'paid' ? '' : ' — НЕ ОПЛАЧЕНА'}` : 'БЕЗ ЗАКУПІВЛІ',
      o.comment || '',
    ].filter(Boolean).join('\n');
    let res;
    try {
      res = await addNewOrder(fetchFn, k.addCreds, {
        code, office: k.office, bayer_name: o.client_name, phone: o.client_phone, comment,
        delivery: k.delivery, payment: k.payment, notification: k.notification,
        ...(k.ttnField && o.ttn ? { [k.ttnField]: o.ttn } : {}),
        // Сайт-джерело: LP-CRM бере його з sender (serialize($_SERVER) у прикладі) — без нього «Не указан сайт-лендинг».
        sender: senderOf(c, k.site),
        site: k.site || new URL(c.req.url).host,
        products: items.map((i) => ({ product_id: i.product_id, price: i.price, count: i.qty })),
      });
    } catch (e) {
      await db.run(`UPDATE b2b_orders SET crm_sent_at = '' WHERE id = ?`, [o.id]);
      if (e.pending) throw e;
      throw fail(502, e.message);
    }
    if (!res.ok) {
      await db.run(`UPDATE b2b_orders SET crm_sent_at = '' WHERE id = ?`, [o.id]);
      await log(o.id, c.get('user'), `LP-CRM не прийняла замовлення: ${res.error.slice(0, 200)}`);
      throw fail(400, `LP-CRM не прийняла замовлення: ${res.error}`);
    }
    // LP-CRM повертає наш код; номер замовлення (id) і статус дізнаємося одразу запитом getOrdersByID за кодом.
    await db.run(`UPDATE b2b_orders SET status = 'crm', crm_id = '', crm_sent_at = ?, crm_status = 'Передано', crm_checked_at = '', updated_at = ? WHERE id = ?`,
      [nowIso(), nowIso(), o.id]);
    await refreshCrm({ ids: [o.id] });
    const crmId = (await db.get(`SELECT crm_id FROM b2b_orders WHERE id = ?`, [o.id]))?.crm_id || '';
    await log(o.id, c.get('user'), `додано в LP-CRM${crmId ? `: № ${crmId}` : ` (код ${code}; номер з’явиться після оновлення статусу)`}`);
    await tgPartner(o.partner_id, `🚚 Замовлення ${orderNo(o.id)} (${h(o.client_name)}) передано в роботу${crmId ? `, № у CRM ${crmId}` : ''}.\n${link(c, `pclients/${o.id}`)}`);
    return c.json({ ok: true, crm_id: crmId, code });
  });

  // Ручне прив'язування номера замовлення з LP-CRM (якщо створили в CRM самі або номер не повернувся).
  app.put('/api/b2b/clients/:id', async (c) => {
    need(c, 'b2b.admin');
    const o = await clientOrder(c);
    if (o.status === 'cancelled') throw fail(400, 'Замовлення скасовано.');
    const b = await c.req.json();
    // Вписати можна номер замовлення (до 10 цифр) або його код (ідентифікатор, 11+ цифр).
    const val = String(b.crm_id ?? '').replace(/\s/g, '');
    const isCode = CODE_RE.test(val);
    if (val && !isCode && !ID_RE.test(val)) throw fail(400, 'Номер замовлення LP-CRM — лише цифри.');
    const crmId = isCode ? '' : val;
    const crmExt = isCode ? val : '';
    const status = val ? 'crm' : 'new';
    await db.run(`UPDATE b2b_orders SET crm_id = ?, crm_ext = ?, crm_sent_at = CASE WHEN ? = '' THEN '' ELSE crm_sent_at END, status = ?, crm_status = '', crm_checked_at = '', updated_at = ? WHERE id = ?`,
      [crmId, crmExt, val, status, nowIso(), o.id]);
    await log(o.id, c.get('user'), val ? `прив'язано замовлення LP-CRM ${isCode ? `код ${val}` : `№ ${val}`}` : 'відв’язано номер LP-CRM');
    if (val && val !== o.crm_id && val !== o.crm_ext) {
      await refreshCrm({ ids: [o.id] });
      const num = (await db.get(`SELECT crm_id FROM b2b_orders WHERE id = ?`, [o.id]))?.crm_id || '';
      await tgPartner(o.partner_id, `🚚 Замовлення ${orderNo(o.id)} (${h(o.client_name)}) передано в роботу${num ? `, № у CRM ${num}` : ''}.\n${link(c, `pclients/${o.id}`)}`);
    }
    return c.json({ ok: true });
  });

  app.post('/api/b2b/clients/:id/refresh', async (c) => {
    need(c, 'b2b.admin');
    const o = await clientOrder(c);
    if (!o.crm_id && !o.crm_ext) throw fail(400, 'Замовлення ще не прив’язане до LP-CRM.');
    await refreshCrm({ ids: [o.id] });
    return c.json({ ok: true });
  });

  // «Без закупівлі»: адмін позначає оплату вручну (рахунок і накладну — у загальному блоці рахунку й файлах).
  app.post('/api/b2b/clients/:id/paid', async (c) => {
    need(c, 'b2b.admin');
    const o = await clientOrder(c);
    if (o.supply_id) throw fail(400, `Оплата — за закупівлею ${orderNo(o.supply_id)}.`);
    const { paid } = await c.req.json();
    const u = c.get('user');
    const now = nowIso();
    if (paid) await db.run(`UPDATE b2b_orders SET paid_amount = total, paid_at = ?, paid_by = ?, updated_at = ? WHERE id = ?`, [now, userName(u), now, o.id]);
    else await db.run(`UPDATE b2b_orders SET paid_amount = 0, paid_at = '', paid_by = '', updated_at = ? WHERE id = ?`, [now, o.id]);
    await log(o.id, u, paid ? 'позначено «Оплачено» вручну' : 'знято позначку «Оплачено»');
    if (paid) await tgPartner(o.partner_id, `✅ <b>Оплату отримано</b>: замовлення ${orderNo(o.id)} (${h(o.client_name)}) — ${uah(o.total)}`);
    return c.json({ ok: true });
  });

  app.post('/api/b2b/clients/:id/cancel', async (c) => {
    need(c, 'b2b.admin');
    const o = await clientOrder(c);
    if (o.status === 'cancelled') throw fail(400, 'Уже скасовано.');
    await db.run(`UPDATE b2b_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    await log(o.id, c.get('user'), 'менеджер скасував замовлення клієнта');
    await tgPartner(o.partner_id, `❌ Замовлення ${orderNo(o.id)} (${h(o.client_name)}) скасовано менеджером.`);
    return c.json({ ok: true, inCrm: !!o.crm_id });
  });

  return { refreshCrm };
}

