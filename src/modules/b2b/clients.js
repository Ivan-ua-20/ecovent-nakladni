// B2B етап 3: замовлення для клієнтів партнера.
// Партнер оформлює замовлення клієнта (ПІБ, телефон, свою ТТН, файл маркування) з товарів конкретної закупівлі — у межах
// залишку. Закупівля ще не оплачена — замовлення можна оформити, але воно позначене «Не оплачено». Без закупівлі — теж
// можна (товари з каталогу за ціною партнера), таке замовлення підсвічене червоним; адмін пізніше додає рахунок/накладну.
// Адмін або власник натискає «Додати в CRM» (LP-CRM addNewOrder, відділ B2B, ціни партнера, «Поле 1» порожнє) або вписує
// номер замовлення з CRM вручну. Статус замовлення в CRM партнер бачить у кабінеті (оновлюється не частіше ніж раз на 10 хв).
// Передачу в CRM вмикає адмін у «Налаштуваннях CRM» (ID відділу + перемикач) — коли ключ LP-CRM отримає дозвіл на addNewOrder.
import { fail, need, nowIso, loadSettings, MASK } from '../../core/common.js';
import { addNewOrder, getOrdersBatch, getStatuses, phpSerialize, phpUrlencode } from '../../integrations/lpcrm.js';
import { CLIENT_STATUS, ORDER_STATUS, CLOSED_SQL, payState, orderNo, overdueDays } from './orders.js';
import { listFilter } from './filters.js';

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

export function mountB2bClients(app, { db, fetchFn, myPartner, orders, hooks = {} }) {
  const { labelInfo, labelDup, dupText, getOpen, rebuildOpen, unpaidTotal, limitsOf, priceItems, totalOf, itemRows, orderOf, orderDetail, publicOrder, supplyLeft, saveFile, log, tgAdmins, tgPartner, tgGroup, link, uah, h } = orders;
  const userName = (u) => u?.name || u?.login || '';
  const SELECT = `SELECT o.*, s.status AS supply_status, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files,
    (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id AND f.kind = 'label') AS labels
    FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id`;

  // ---------------------------------------------------------------- налаштування передачі в CRM
  // Для addNewOrder LP-CRM дає окремий «Вхідний ключ API» (lpcrm_in_key); читання статусів — основним ключем (lpcrm_key).
  async function crmConfig() {
    const s = await loadSettings(db);
    const creds = { subdomain: s.lpcrm_subdomain || '', key: s.lpcrm_key || '' };
    return {
      on: s.b2b_crm_on === '1',
      office: s.b2b_crm_office ?? DEFAULT_OFFICE,
      // Типово: доставка «Нова пошта» (ID 1), оплачена закупівля — вид оплати «Оплачено» (ID 1), неоплачена — порожньо.
      delivery: s.b2b_crm_delivery ?? '1',
      payment: s.b2b_crm_payment || '',
      paymentPaid: s.b2b_crm_payment_paid ?? '1',
      notification: s.b2b_crm_notification || '',
      // ТТН іде в поле ТТН (ttn); адреса доставки — відділення з маркування, тож «адреса» як копія ТТН більше не потрібна.
      ttnField: TTN_FIELDS.includes(s.b2b_crm_ttn_field) && s.b2b_crm_ttn_field !== 'delivery_adress' ? s.b2b_crm_ttn_field : '',
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
      on: k.on, office: k.office, delivery: k.delivery, payment: k.payment, payment_paid: k.paymentPaid, notification: k.notification, ttn_field: k.ttnField, site: k.site,
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
    for (const [f, name] of [['delivery', 'виду доставки'], ['payment', 'виду оплати'], ['payment_paid', 'виду оплати «Оплачено»'], ['notification', 'позначки']]) {
      opt[f] = String(b[f] ?? '').trim();
      if (!OPT_ID_RE.test(opt[f])) throw fail(400, `ID ${name} — число з LP-CRM або порожньо.`);
    }
    const ttnField = TTN_FIELDS.includes(b.ttn_field) ? b.ttn_field : '';
    const set = (key, value) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]];
    const st = [set('b2b_crm_office', office), set('b2b_crm_on', b.on ? '1' : '0'), set('b2b_crm_delivery', opt.delivery),
      set('b2b_crm_payment', opt.payment), set('b2b_crm_notification', opt.notification), set('b2b_crm_ttn_field', ttnField)];
    if (b.payment_paid !== undefined) st.push(set('b2b_crm_payment_paid', opt.payment_paid)); // не передано — лишається як було (типово «Оплачено», ID 1)
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
    const linked = []; // замовлення, що щойно отримали номер у CRM
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
          if (num && !r.crm_id) linked.push([r.id, num]);
        }
      }
    } catch { /* CRM недоступна — покажемо останній відомий статус */ }
    if (st.length) await db.batch(st);
    for (const [id, num] of linked) await hooks.crmLinked?.(id, num).catch(() => 0);
    // номер з'явився — можливо, вся закупівля вже в роботі
    if (linked.length) {
      const sup = await db.all(`SELECT DISTINCT supply_id FROM b2b_orders WHERE id IN (SELECT value FROM json_each(?)) AND supply_id IS NOT NULL`, [JSON.stringify(linked.map(([id]) => id))]);
      for (const r of sup) await supplyInWork(r.supply_id).catch(() => 0);
    }
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
    if (s.status === 'open') throw fail(400, 'Для відкритої закупівлі оберіть «Без закупівлі».');
    if (s.status === 'draft') throw fail(400, `Закупівля ${orderNo(s.id)} ще чернетка — спершу керівник її відправляє.`);
    if (s.delivery === 'pickup') throw fail(400, `Закупівля ${orderNo(s.id)} — самовивіз: її товари партнер забирає сам, замовлення клієнтів з неї не оформлюються.`);
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
  // Позиції замовлення. Без закупівлі — товари з каталогу йдуть у відкриту закупівлю партнера (у межах лімітів).
  // own — поточний внесок цього ж замовлення у відкриту закупівлю (при зміні).
  async function buildItems(p, b, exceptId = 0, own = { openId: null, total: 0 }, { skipLimits = false } = {}) {
    const supplyId = parseInt(b.supply_id, 10) || null;
    if (supplyId) {
      const items = await supplyItems(p, supplyId, b.items, exceptId);
      return { supplyId, items, total: totalOf(items) };
    }
    const items = await priceItems(p, b.items);
    const total = totalOf(items);
    const lim = limitsOf(p);
    const open = await getOpen(p.id);
    if (skipLimits) return { supplyId: null, toOpen: true, openId: open?.id || null, items, total }; // правка нашого адміна — без лімітів
    const inOpen = open && own.openId === open.id ? own.total : 0;
    const openAfter = (open?.total || 0) - inOpen + total;
    if (openAfter > lim.open + 0.004) {
      throw fail(400, `Відкрита закупівля перевищить ліміт ${uah(lim.open)} (зараз ${uah((open?.total || 0) - inOpen)}, це замовлення ${uah(total)}). `
        + 'Сформуйте рахунок на відкриту закупівлю (оберіть юрособу) — після цього можна продовжувати.');
    }
    const unpaid = (await unpaidTotal(p.id)) - inOpen;
    if (unpaid + total > lim.unpaid + 0.004) {
      throw fail(400, `Ліміт неоплачених закупівель — ${uah(lim.unpaid)}: зараз неоплачено ${uah(unpaid)}. Спершу оплатіть закупівлі або зверніться до менеджера.`);
    }
    return { supplyId: null, toOpen: true, openId: open?.id || null, items, total };
  }
  // Обов'язкові документи замовлення: маркування завжди + види документів партнера з позначкою «обов'язковий».
  async function missingDocs(o) {
    const [types, have] = await Promise.all([
      db.all(`SELECT id, name FROM b2b_doc_types WHERE partner_id = ? AND active = 1 AND required = 1 ORDER BY sort, id`, [o.partner_id]),
      db.all(`SELECT kind, doc_type FROM b2b_files WHERE order_id = ?`, [o.id]),
    ]);
    const out = [];
    if (!have.some((f) => f.kind === 'label')) out.push('маркування');
    for (const t of types) if (!have.some((f) => f.kind === 'doc' && f.doc_type === t.id)) out.push(t.name);
    return out;
  }
  hooks.missingDocs = missingDocs;

  // ТТН уже є в іншому замовленні: своє — з номером і клієнтом, чуже — без подробиць.
  const ttnDupMsg = async (ttn, dup, partnerId) => ((await db.get(`SELECT partner_id FROM b2b_orders WHERE id = ?`, [dup.id]))?.partner_id === partnerId
    ? `ТТН ${ttn} уже є в замовленні ${dup.number} (${dup.client_name}).` : `ТТН ${ttn} уже використана в іншому замовленні.`);
  // Відкрита закупівля партнера (створюється за потреби).
  async function ensureOpen(p) {
    const open = await getOpen(p.id);
    if (open) return open.id;
    const now = nowIso();
    const r = await db.run(`INSERT INTO b2b_orders (partner_id, kind, status, entity, total, created_by, created_at, updated_at) VALUES (?, 'supply', 'open', '', 0, 'авто', ?, ?)`, [p.id, now, now]);
    await db.run(`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, 'авто', 'відкрито закупівлю із замовлень клієнтів без закупівлі')`, [r.lastId, now]);
    return r.lastId;
  }
  const supplyOf = (id) => (id ? db.get(`SELECT id, status FROM b2b_orders WHERE id = ?`, [id]) : null);
  // Відвантаження без оплати (замовлення з неоплаченої закупівлі пішло в CRM) — адмінам і власнику особисто.
  async function warnUnpaidShipped(c, o) {
    const s = o.supply_id ? await db.get(`SELECT id, status, pay_terms, due_date FROM b2b_orders WHERE id = ?`, [o.supply_id]) : null;
    const st = s?.status || '';
    if (['paid', 'done'].includes(st) || (!o.supply_id && o.paid_at)) return;
    if (s?.pay_terms === 'postpay' && !overdueDays(s)) return; // відстрочка: відвантаження до оплати — норма
    const p = await db.get(`SELECT name FROM b2b_partners WHERE id = ?`, [o.partner_id]);
    await tgAdmins(`⚠️ <b>Відвантаження без оплати</b>: ${orderNo(o.id)} (${h(o.client_name)}, ${uah(o.total)}) «${h(p?.name || '')}» передано в CRM, а `
      + `${!o.supply_id ? 'замовлення без закупівлі не оплачене' : st === 'open' ? `відкрита закупівля ${orderNo(o.supply_id)} ще без рахунку` : `закупівля ${orderNo(o.supply_id)} не оплачена (${ORDER_STATUS[st] || st})`}.\n${link(c, `b2bclients/${o.id}`)}`);
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
  // Оплата для коментаря в LP-CRM: оплачено (коли, скільки, від кого, куди — з Opendatabot) або очікуємо (рахунок, на кого, від кого).
  const dt = (iso) => (iso ? new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const ukDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d.split('-').reverse().join('.') : '');
  const num = (n) => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/\s/g, ' ');
  async function payText(o, partnerName) {
    if (!o.supply_id) return { paid: !!o.paid_at, text: o.paid_at ? `✅ ОПЛАЧЕНО (без закупівлі, позначено ${dt(o.paid_at)})` : '⏳ БЕЗ ЗАКУПІВЛІ — ОЧІКУЄМО ОПЛАТУ' };
    const s = await db.get(`SELECT * FROM b2b_orders WHERE id = ?`, [o.supply_id]);
    if (!s) return { paid: false, text: '' };
    if (s.status === 'open') return { paid: false, text: `⏳ БЕЗ ЗАКУПІВЛІ (відкрита закупівля ${orderNo(s.id)}, рахунок ще не сформовано) — ОЧІКУЄМО ОПЛАТУ` };
    const ent = String(s.entity || '').split('\n')[0];
    const inv = s.invoice_no ? `рахунок № ${s.invoice_no}${s.invoice_date ? ` від ${ukDate(s.invoice_date)}` : ''} на ${num(s.total)} грн` : `рахунок ще не виставлено (${num(s.total)} грн)`;
    const pays = await db.all(`SELECT amount, date, payer_name, payer_code, account FROM b2b_payments WHERE order_id = ? ORDER BY date`, [s.id]).catch(() => []);
    const lines = pays.map((t) => `Оплата ${dt(t.date)} — ${num(t.amount)} грн від ${t.payer_name || '—'}${t.payer_code ? ` (${t.payer_code})` : ''}${t.account ? ` на ${t.account}` : ''}`);
    if (['paid', 'done'].includes(s.status)) {
      return { paid: true, text: [`✅ ОПЛАЧЕНО: закупівля ${orderNo(s.id)}, ${inv}, платник ${ent}`,
        ...(lines.length ? lines : [`Позначено «Оплачено» вручну${s.paid_by && s.paid_by !== 'Opendatabot' ? ` (${s.paid_by})` : ''}${s.paid_at ? ` ${dt(s.paid_at)}` : ''}`])].join('\n') };
    }
    if (s.status === 'partial') {
      return { paid: false, text: [`⏳ ЧАСТКОВО ОПЛАЧЕНО: закупівля ${orderNo(s.id)}, ${inv} — отримано ${num(s.paid_amount)}, залишок ${num(s.total - s.paid_amount)} грн`, ...lines].join('\n') };
    }
    if (s.pay_terms === 'postpay') {
      return { paid: false, text: `⏳ ВІДСТРОЧКА ОПЛАТИ${s.due_date ? ` до ${ukDate(s.due_date)}` : ` ${s.pay_days} дн. від рахунку`}: закупівля ${orderNo(s.id)}, ${inv}; рахунок на ${ent}, від «${partnerName}»${overdueDays(s) ? ` — ПРОСТРОЧЕНО ${overdueDays(s)} дн.` : ''}` };
    }
    return { paid: false, text: `⏳ ОЧІКУЄМО ОПЛАТУ: закупівля ${orderNo(s.id)}, ${inv}; рахунок на ${ent}, від «${partnerName}»` };
  }
  async function crmComment(o, partnerName) {
    const pay = await payText(o, partnerName);
    const comment = [`${orderNo(o.id)} · B2B «${partnerName}»`, o.ttn ? `ТТН партнера: ${o.ttn}` : '', pay.text, o.comment || ''].filter(Boolean).join('\n');
    return { paid: pay.paid, comment };
  }
  // Закупівлю оплачено, а замовлення з неї вже в CRM без позначки оплати — LP-CRM не дає змінити замовлення через API,
  // тож адмінам: номер у CRM і готовий текст коментаря, щоб поставити «Оплачено» вручну.
  hooks.crmPaid = async (supplyId, base = '') => {
    const rows = await db.all(`SELECT o.*, p.name AS partner FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id
      WHERE o.supply_id = ? AND o.kind = 'client' AND o.status = 'crm'`, [supplyId]);
    for (const o of rows) {
      const { comment } = await crmComment(o, o.partner);
      await tgAdmins(`💰 <b>Оплату отримано</b>, а замовлення вже в LP-CRM: <b>${orderNo(o.id)}</b>${o.crm_id ? ` · CRM № <b>${h(o.crm_id)}</b>` : ''} (${h(o.client_name)})\n`
        + `Поставте в CRM вид оплати «Оплачено» і замініть коментар на:\n<pre>${h(comment)}</pre>${base ? `\n${link(base, `b2bclients/${o.id}`)}` : ''}`);
    }
  };
  const tgNew = async (c, p, id, f, it, verb = 'Нове замовлення клієнта') => {
    const lines = it.items.slice(0, 60).map((i) => `${h(i.name)} — ${i.qty} шт — ${uah(i.price)}`).join('\n');
    const text = `📦 <b>${verb} ${orderNo(id)}</b> від «${h(p.name)}»\n\n<b>Клієнт:</b> ${h(f.client_name)}, ${h(f.client_phone)}${f.ttn ? `\n<b>ТТН:</b> ${h(f.ttn)}` : ''}\n`
      + `${it.supplyId ? `Із закупівлі ${orderNo(it.supplyId)}` : `🔴 <b>Без закупівлі</b> — у відкриту закупівлю ${orderNo(it.openId)}`}\n\n<b>Товари:</b>\n${lines}\n\n<b>Разом: ${uah(it.total)}</b>`;
    await tgAdmins(`${text}\n\n${link(c, `b2bclients/${id}`)}`);
  };
  // Закупівлю розписано повністю й усі її замовлення клієнтів уже в LP-CRM з номерами — один підсумок у групу партнера.
  async function supplyInWork(supplyId, base = '') {
    if (!supplyId) return;
    const s = await db.get(`SELECT o.id, o.partner_id, o.status, o.group_done, ${CLOSED_SQL} AS closed FROM b2b_orders o WHERE o.id = ?`, [supplyId]);
    if (!s || !s.closed || s.group_done || s.status === 'open') return;
    const rows = await db.all(`SELECT id, client_name, status, crm_id FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled' ORDER BY id`, [s.id]);
    if (!rows.length || rows.some((r) => r.status !== 'crm' || !r.crm_id)) return;
    const claim = await db.run(`UPDATE b2b_orders SET group_done = 1 WHERE id = ? AND COALESCE(group_done, 0) = 0`, [s.id]);
    if (!claim.changes) return;
    const items = await db.all(`SELECT order_id, name, qty FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY id`, [JSON.stringify(rows.map((r) => r.id))]);
    const lines = rows.map((r) => `• CRM № <b>${h(r.crm_id)}</b> · ${h(r.client_name)} — ${items.filter((i) => i.order_id === r.id).map((i) => `${h(i.name)} × ${i.qty}`).join(', ')}`);
    await tgGroup(s.partner_id, `✅ <b>Закупівля ${orderNo(s.id)}: усі замовлення взято в роботу складом</b>\n\n${lines.slice(0, 60).join('\n')}${lines.length > 60 ? `\n…і ще ${lines.length - 60}` : ''}`
      + `${base ? `\n\n${link(base, `porders/${s.id}`)}` : ''}`);
  }
  hooks.supplyInWork = supplyInWork;


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
       WHERE s.partner_id = ? AND s.kind = 'supply' AND s.status NOT IN ('cancelled', 'open', 'draft') AND COALESCE(s.delivery, 'np') != 'pickup' AND s.created_at > ? ORDER BY s.id DESC, i.id`, [p.id, since],
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
    const f = listFilter(c, { client: true });
    const st = c.req.query('status');
    if (st && CLIENT_STATUS[st]) { f.where.push('o.status = ?'); f.params.push(st); }
    const rows = await db.all(`${SELECT} WHERE o.partner_id = ? AND o.kind = 'client' ${f.where.map((w) => `AND ${w}`).join(' ')} ORDER BY o.id DESC LIMIT 300`, [p.id, ...f.params]);
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
    return c.json({ ...(await orderDetail(await orderOf(o.id, p.id))), missing: await missingDocs(o) });
  });

  // ---------- види документів партнера (налаштування партнера) ----------
  const docTypes = (partnerId) => db.all(`SELECT id, name, required, print FROM b2b_doc_types WHERE partner_id = ? AND active = 1 ORDER BY sort, id`, [partnerId]);
  app.get('/api/b2b/p/doc-types', async (c) => c.json(await docTypes((await myPartner(c)).id)));
  // Список цілком (до 5): нові — додаються, прибрані — ховаються (у старих замовленнях назва лишається).
  app.put('/api/b2b/p/doc-types', async (c) => {
    const p = await myPartner(c);
    need(c, 'b2b.team');
    const list = (await c.req.json()).types;
    if (!Array.isArray(list)) throw fail(400, 'Невірні дані.');
    const rows = list.map((t) => ({ id: parseInt(t.id, 10) || 0, name: String(t.name || '').trim().replace(/\s+/g, ' ').slice(0, 60), required: t.required ? 1 : 0, print: t.print === false ? 0 : 1 }))
      .filter((t) => t.name);
    if (rows.length > 5) throw fail(400, 'Не більше 5 видів документів.');
    if (new Set(rows.map((t) => t.name.toLowerCase())).size !== rows.length) throw fail(400, 'Назви видів документів мають відрізнятися.');
    if (rows.some((t) => /^маркуван/i.test(t.name))) throw fail(400, 'Маркування вже є завжди — додайте інші документи.');
    const cur = await db.all(`SELECT id FROM b2b_doc_types WHERE partner_id = ? AND active = 1`, [p.id]);
    const keep = new Set(rows.filter((t) => t.id && cur.some((x) => x.id === t.id)).map((t) => t.id));
    const st = cur.filter((x) => !keep.has(x.id)).map((x) => [`UPDATE b2b_doc_types SET active = 0 WHERE id = ?`, [x.id]]);
    rows.forEach((t, i) => st.push(keep.has(t.id)
      ? [`UPDATE b2b_doc_types SET name = ?, required = ?, print = ?, sort = ? WHERE id = ? AND partner_id = ?`, [t.name, t.required, t.print, i, t.id, p.id]]
      : [`INSERT INTO b2b_doc_types (partner_id, name, required, print, sort, active) VALUES (?, ?, ?, ?, ?, 1)`, [p.id, t.name, t.required, t.print, i]]));
    if (st.length) await db.batch(st);
    return c.json({ ok: true, types: await docTypes(p.id) });
  });

  app.post('/api/b2b/p/clients', async (c) => {
    const p = await myPartner(c);
    const b = await c.req.json();
    const f = clientFields(b);
    if (f.ttn) { const dup = await labelDup({ ttn: f.ttn }); if (dup) throw fail(400, await ttnDupMsg(f.ttn, dup, p.id)); }
    const it = await buildItems(p, b);
    if (it.toOpen) { it.openId = await ensureOpen(p); it.supplyRef = it.openId; }
    const now = nowIso();
    const u = c.get('user');
    const r = await db.run(
      `INSERT INTO b2b_orders (partner_id, kind, status, supply_id, client_name, client_phone, ttn, total, comment, created_by, created_at, updated_at)
       VALUES (?, 'client', 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, it.supplyId || it.openId, f.client_name, f.client_phone, f.ttn, it.total, f.comment, userName(u), now, now],
    );
    await db.batch([...itemRows(r.lastId, it.items), [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`,
      [r.lastId, now, userName(u), `оформлено замовлення клієнта на ${uah(it.total)}${it.supplyId ? ` із закупівлі ${orderNo(it.supplyId)}` : ` без закупівлі (відкрита закупівля ${orderNo(it.openId)})`}`]]]);
    if (it.openId) await rebuildOpen(it.openId);
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
    if (f.ttn) { const dup = await labelDup({ ttn: f.ttn }, o.id); if (dup) throw fail(400, await ttnDupMsg(f.ttn, dup, p.id)); }
    const cur = await supplyOf(o.supply_id);
    const it = await buildItems(p, b, o.id, { openId: cur?.status === 'open' ? cur.id : null, total: o.total });
    if (it.toOpen) it.openId = await ensureOpen(p);
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      ...itemRows(o.id, it.items),
      [`UPDATE b2b_orders SET supply_id = ?, client_name = ?, client_phone = ?, ttn = ?, total = ?, comment = ?, updated_at = ? WHERE id = ?`,
        [it.supplyId || it.openId, f.client_name, f.client_phone, f.ttn, it.total, f.comment, nowIso(), o.id]],
    ]);
    if (it.openId) await rebuildOpen(it.openId);
    if (cur?.status === 'open' && cur.id !== it.openId) await rebuildOpen(cur.id);
    await log(o.id, c.get('user'), `змінено замовлення клієнта: ${it.items.length} поз., ${uah(it.total)}`);
    await tgNew(c, p, o.id, f, it, 'Змінено замовлення клієнта');
    return c.json({ ok: true, total: it.total });
  });

  // ---------- правка замовлення клієнта нашим адміном: усе (клієнт, ТТН, коментар, закупівля-джерело, товари),
  // у будь-якому статусі, крім скасованого; без лімітів партнера. Уже передане в CRM — LP-CRM змінюють вручну.
  app.get('/api/b2b/clients/:id/edit-options', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind !== 'client') throw fail(404, 'Замовлення не знайдено.');
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    const rows = await db.all(
      `SELECT s.id, s.status, i.product_id, i.name, i.article, i.price, i.qty,
         COALESCE((SELECT SUM(ci.qty) FROM b2b_order_items ci JOIN b2b_orders co ON co.id = ci.order_id
           WHERE co.supply_id = s.id AND co.kind = 'client' AND co.status != 'cancelled' AND co.id != ? AND ci.product_id = i.product_id), 0) AS used
       FROM b2b_orders s JOIN b2b_order_items i ON i.order_id = s.id
       WHERE s.partner_id = ? AND s.kind = 'supply' AND s.status NOT IN ('cancelled', 'open', 'draft') AND COALESCE(s.delivery, 'np') != 'pickup'
         AND (s.created_at > ? OR s.id = ?) ORDER BY s.id DESC, i.id`, [o.id, o.partner_id, since, o.supply_id || 0],
    );
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, number: orderNo(r.id), status_name: ORDER_STATUS[r.status] || r.status, items: [] });
      map.get(r.id).items.push({ product_id: r.product_id, name: r.name, article: r.article, price: r.price, left: r.qty - r.used });
    }
    const supplies = [...map.values()].filter((s) => s.id === o.supply_id || s.items.some((i) => i.left > 0));
    return c.json({ supplies, catalog: await hooks.partnerCatalog(o.partner_id) });
  });
  app.put('/api/b2b/clients/:id/edit', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind !== 'client') throw fail(404, 'Замовлення не знайдено.');
    if (o.status === 'cancelled') throw fail(400, 'Замовлення скасовано.');
    const p = await db.get(`SELECT * FROM b2b_partners WHERE id = ?`, [o.partner_id]);
    const b = await c.req.json();
    const f = clientFields(b);
    if (f.ttn) { const dup = await labelDup({ ttn: f.ttn }, o.id); if (dup) throw fail(400, await ttnDupMsg(f.ttn, dup, p.id)); }
    const cur = await supplyOf(o.supply_id);
    const before = await db.all(`SELECT product_id, name, qty FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    const it = await buildItems(p, b, o.id, { openId: cur?.status === 'open' ? cur.id : null, total: o.total }, { skipLimits: true });
    if (it.toOpen) it.openId = await ensureOpen(p);
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      ...itemRows(o.id, it.items),
      [`UPDATE b2b_orders SET supply_id = ?, client_name = ?, client_phone = ?, ttn = ?, total = ?, comment = ?, updated_at = ? WHERE id = ?`,
        [it.supplyId || it.openId, f.client_name, f.client_phone, f.ttn, it.total, f.comment, nowIso(), o.id]],
    ]);
    if (it.openId) await rebuildOpen(it.openId);
    if (cur?.status === 'open' && cur.id !== it.openId) await rebuildOpen(cur.id);
    const changes = [];
    if (f.client_name !== o.client_name) changes.push(`ПІБ: ${o.client_name} → ${f.client_name}`);
    if (f.client_phone !== o.client_phone) changes.push(`телефон: ${o.client_phone} → ${f.client_phone}`);
    if (f.ttn !== (o.ttn || '')) changes.push(`ТТН: ${o.ttn || '—'} → ${f.ttn || '—'}`);
    if (f.comment !== (o.comment || '')) changes.push('коментар');
    const newSupply = it.supplyId || it.openId;
    if (newSupply !== o.supply_id) changes.push(`закупівля: ${o.supply_id ? orderNo(o.supply_id) : '—'} → ${orderNo(newSupply)}`);
    const bm = new Map(before.map((i) => [i.product_id, i]));
    for (const i of it.items) { const x = bm.get(i.product_id); if (!x) changes.push(`+ ${i.name} × ${i.qty}`); else if (x.qty !== i.qty) changes.push(`${i.name}: ${x.qty} → ${i.qty} шт`); }
    for (const x of before) if (!it.items.some((i) => i.product_id === x.product_id)) changes.push(`− ${x.name} × ${x.qty}`);
    await log(o.id, c.get('user'), `змінив менеджер: ${changes.join('; ') || 'без змін'} — ${uah(it.total)}`.slice(0, 1800));
    if (changes.length) {
      await tgPartner(o.partner_id, `✏️ <b>Замовлення клієнта ${orderNo(o.id)} змінив менеджер</b> (${h(f.client_name)})\n${changes.slice(0, 15).map(h).join('\n')}\n${link(c, `pclients/${o.id}`)}`);
    }
    return c.json({ ok: true, total: it.total, inCrm: o.status === 'crm' ? (o.crm_id || 'так') : '' });
  });

  app.post('/api/b2b/p/clients/:id/cancel', async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== 'new') throw fail(400, 'Замовлення вже передане в роботу — скасувати його може лише менеджер.');
    await db.run(`UPDATE b2b_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    if (o.supply_id) await rebuildOpen(o.supply_id);
    await log(o.id, c.get('user'), 'партнер скасував замовлення клієнта');
    await tgAdmins(`❌ <b>Скасовано замовлення клієнта ${orderNo(o.id)}</b> («${h(p.name)}»)\n${link(c, `b2bclients/${o.id}`)}`);
    return c.json({ ok: true });
  });

  // Дані клієнта з маркування Нової пошти (для автозаповнення форми): ПІБ і телефон одержувача, ТТН, адреса.
  // Також перевірка: чи немає вже цього маркування (той самий файл або ТТН) в іншому замовленні (except — поточне).
  app.post('/api/b2b/p/parse-label', async (c) => {
    const p = await myPartner(c);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw fail(400, 'Файл маркування — до 5 МБ.');
    const info = await labelInfo(bytes);
    const exceptId = parseInt(c.req.query('except'), 10) || 0;
    const dup = await labelDup(info, exceptId);
    // інший партнер: лише факт, без даних чужого клієнта
    const dupOut = dup ? ((await db.get(`SELECT partner_id FROM b2b_orders WHERE id = ?`, [dup.id]))?.partner_id === p.id ? dup : { id: 0, number: 'іншого партнера', client_name: '—' }) : null;
    const np = info.np;
    if (!np) return c.json({ found: false, dup: dupOut, dup_text: dupOut ? dupText(dupOut) : '' });
    return c.json({ found: true, client_name: np.recipient, client_phone: np.phone ? `0${np.phone.slice(3)}` : '', ttn: np.ttn, address: np.address, dup: dupOut, dup_text: dupOut ? dupText(dupOut) : '' });
  });

  // Маркування (етикетка ТТН) — файл від партнера; доки замовлення не передане в CRM.
  app.post('/api/b2b/p/clients/:id/files', async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== 'new') throw fail(400, 'Замовлення вже в роботі — новий файл надішліть менеджеру.');
    if ((await db.get(`SELECT COUNT(*) AS n FROM b2b_files WHERE order_id = ?`, [o.id])).n >= 15) throw fail(400, 'Не більше 15 файлів у замовленні.');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw fail(400, 'Порожній файл.');
    // Документ партнера (чек, накладна для клієнта…): вид — з налаштувань партнера; той самий файл двічі — ні.
    const typeId = parseInt(c.req.query('type'), 10) || 0;
    if (typeId) {
      const t = await db.get(`SELECT * FROM b2b_doc_types WHERE id = ? AND partner_id = ? AND active = 1`, [typeId, p.id]);
      if (!t) throw fail(404, 'Такого виду документа немає — оновіть сторінку.');
      const { hash } = await labelInfo(bytes);
      if (await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND hash = ?`, [o.id, hash])) throw fail(409, 'Цей файл уже додано до замовлення.');
      const f = await saveFile(c, o, 'doc', bytes, { hash });
      await db.run(`UPDATE b2b_files SET doc_type = ? WHERE id = ?`, [t.id, f.id]);
      await log(o.id, c.get('user'), `документ: ${t.name}`);
      if (t.print) await hooks.afterDoc?.(o, f, t).catch(() => 0);
      return c.json({ id: f.id, warnings: [] });
    }
    const info = await labelInfo(bytes);
    const dup = await labelDup(info, o.id);
    if (dup) throw fail(409, dup.id && (await db.get(`SELECT partner_id FROM b2b_orders WHERE id = ?`, [dup.id]))?.partner_id === p.id ? dupText(dup) : 'Таке маркування вже використане в іншому замовленні.');
    if (await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = 'label' AND hash = ?`, [o.id, info.hash])) throw fail(409, 'Це маркування вже додано до цього замовлення.');
    const f = await saveFile(c, o, 'label', bytes, { hash: info.hash, ttn: info.ttn });
    const r = await hooks.afterLabel?.(o, f, c.get('user'));
    return c.json({ id: f.id, warnings: r?.warnings || [] });
  });
  app.delete('/api/b2b/p/clients/:id/files/:fid', async (c) => {
    const p = await myPartner(c);
    const o = await myClientOrder(c, p);
    if (o.status !== 'new') throw fail(400, 'Замовлення вже в роботі.');
    const f = await db.get(`SELECT * FROM b2b_files WHERE id = ? AND order_id = ? AND kind IN ('label', 'doc')`, [c.req.param('fid'), o.id]);
    if (!f) throw fail(404, 'Файл не знайдено.');
    await db.batch([[`DELETE FROM b2b_file_parts WHERE file_id = ?`, [f.id]], [`DELETE FROM b2b_files WHERE id = ?`, [f.id]]]);
    await log(o.id, c.get('user'), `видалено файл «${f.name}»`);
    return c.json({ ok: true });
  });

  // ================================================================ АДМІН / ВЛАСНИК
  const VIEWS = {
    new: `o.status = 'new'`,
    crm: `o.status = 'crm'`,
    nosupply: `(o.supply_id IS NULL OR s.status = 'open') AND o.status != 'cancelled'`,
    cancelled: `o.status = 'cancelled'`,
  };
  app.get('/api/b2b/clients', async (c) => {
    need(c, 'b2b.admin');
    await refreshCrm();
    const f = listFilter(c, { client: true });
    const where = [`o.kind = 'client'`, ...f.where];
    const params = [...f.params];
    const v = c.req.query('view');
    const pid = parseInt(c.req.query('partner'), 10);
    if (VIEWS[v]) where.push(VIEWS[v]);
    if (pid) { where.push('o.partner_id = ?'); params.push(pid); }
    const rows = await db.all(
      `SELECT o.*, s.status AS supply_status, p.name AS partner, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files
       FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id JOIN b2b_partners p ON p.id = o.partner_id
       WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, params,
    );
    const cnt = await db.get(`SELECT SUM(o.status = 'new') AS new, SUM(o.status = 'crm') AS crm, SUM((o.supply_id IS NULL OR s.status = 'open') AND o.status != 'cancelled') AS nosupply,
      SUM(o.status = 'cancelled') AS cancelled FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id WHERE o.kind = 'client'`);
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
    const missing = await missingDocs(o);
    if (missing.length) throw fail(400, `Бракує документів: ${missing.join(', ')}. Попросіть партнера додати їх у замовленні (або прив’яжіть номер CRM вручну).`);
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
    const { paid, comment } = await crmComment(o, p?.name || '');
    const address = /НП:\s*([^\n]+)/.exec(o.comment || '')?.[1]?.trim() || '';
    let res;
    try {
      res = await addNewOrder(fetchFn, k.addCreds, {
        code, office: k.office, bayer_name: o.client_name, phone: o.client_phone, comment,
        delivery: k.delivery, payment: paid ? k.paymentPaid : k.payment, notification: k.notification,
        // ТТН — у поле адреси доставки (окремого поля ТТН addNewOrder не має): менеджер переносить її в поле ТТН;
        // без ТТН — відділення з маркування.
        delivery_adress: o.ttn || address,
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
    await warnUnpaidShipped(c, o);
    await supplyInWork(o.supply_id, c).catch(() => 0);
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
    const was = o.crm_id || o.crm_ext;
    await log(o.id, c.get('user'), val ? `${was && was !== val ? `замінено замовлення LP-CRM (було ${was}) на` : 'прив\'язано замовлення LP-CRM'} ${isCode ? `код ${val}` : `№ ${val}`}` : 'відв’язано номер LP-CRM');
    if (val && val !== o.crm_id && val !== o.crm_ext) {
      await refreshCrm({ ids: [o.id] });
      const num = (await db.get(`SELECT crm_id FROM b2b_orders WHERE id = ?`, [o.id]))?.crm_id || '';
      if (!isCode && num) await hooks.crmLinked?.(o.id, num).catch(() => 0);
      if (o.status === 'new') await warnUnpaidShipped(c, o);
      const relinked = Boolean(o.crm_id || o.crm_ext); // уже був номер — менеджер прив'язав інше замовлення CRM
      await tgPartner(o.partner_id, relinked
        ? `🔁 Замовлення ${orderNo(o.id)} (${h(o.client_name)}): номер у CRM змінено${num ? ` на ${num}` : ''}.\n${link(c, `pclients/${o.id}`)}`
        : `🚚 Замовлення ${orderNo(o.id)} (${h(o.client_name)}) передано в роботу${num ? `, № у CRM ${num}` : ''}.\n${link(c, `pclients/${o.id}`)}`);
      await supplyInWork(o.supply_id, c).catch(() => 0);
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
    if (o.supply_id) throw fail(400, `Оплата — за закупівлею ${orderNo(o.supply_id)}${(await supplyOf(o.supply_id))?.status === 'open' ? ' (спершу партнер формує на неї рахунок)' : ''}.`);
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
    if (o.supply_id) await rebuildOpen(o.supply_id);
    await log(o.id, c.get('user'), 'менеджер скасував замовлення клієнта');
    await tgPartner(o.partner_id, `❌ Замовлення ${orderNo(o.id)} (${h(o.client_name)}) скасовано менеджером.`);
    return c.json({ ok: true, inCrm: !!o.crm_id });
  });

  return { refreshCrm };
}

