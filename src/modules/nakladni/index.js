// Модуль «Накладні»: пошук замовлення LP-CRM (за кодом, номером, телефоном або ТТН), формування накладної
// (ФОП з чека Checkbox, поля 1, відділу або вручну), версії та історія, діагностика LP-CRM.
// Для інших модулів віддає loadOrder (замовлення з CRM) — ним користуються рахунки.
import { fail, need, nowIso, userName, parseTpl, hash, kyivDay, loadSettings } from '../../core/common.js';
import { getOrder, getProducts, diagnose, getStatuses, getOrderCodesByStatus, getOrdersBatch } from '../../integrations/lpcrm.js';
import { findReceiptByRef, findReceiptForOrder, hasCheckbox } from '../../integrations/checkbox.js';
import { normalizeOrder, applyEdits } from './normalize.js';
import { DEMO_ORDER } from './demo.js';

export { normalizeOrder };

// Для документа потрібні тільки реквізити, без доступів Checkbox.
const docFop = (f) => {
  if (!f) return null;
  const { checkbox_login, checkbox_password, checkbox_license, checkbox_pin, ...rest } = f;
  return rest;
};

export function mountNakladni(app, { db, fetchFn, onCleanup, shared = {} }) {
  const settings = () => loadSettings(db);
  shared.receiptCache ||= new Map();
  const receiptCache = shared.receiptCache;
  // Строк зберігання версій накладних — «retention_days» з налаштувань.
  onCleanup((border) => db.run(`DELETE FROM versions WHERE created_at < ?`, [border]));
  // Індекс пошуку замовлень: тримаємо лише період пошуку з налаштувань (+7 днів запасу).
  onCleanup(async () => {
    const days = (Number((await settings()).lpcrm_search_days) || 30) + 7;
    const border = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    await db.batch([
      [`DELETE FROM orders_index WHERE datetime != '' AND datetime < ?`, [border]],
      [`DELETE FROM order_keys WHERE day != '' AND day < ?`, [border]],
    ]);
  });

  // ---------- Діагностика LP-CRM ----------
  app.get('/api/lpcrm/diagnose/:orderId', async (c) => {
    need(c, 'api');
    const s = await settings();
    const text = await diagnose(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, c.req.param('orderId'));
    return c.json({ text });
  });

  app.get('/api/lpcrm/raw/:orderId', async (c) => {
    need(c, 'api');
    const s = await settings();
    const { raw } = await getOrder(fetchFn, { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key }, c.req.param('orderId'), { fresh: true });
    return c.json(raw);
  });

  // ---------- Накладна ----------
  // ---------- Пошук замовлення за коротким номером, телефоном або ТТН ----------
  // API LP-CRM шукає замовлення лише за 11-значним кодом. Щоб працював звичний номер,
  // тримаємо локальний індекс замовлень за останні N днів і шукаємо в ньому.
  let syncing = null;
  const ymd = (d) => d.toISOString().slice(0, 10);
  const digits = (v) => String(v || '').replace(/\D/g, '');

  // Завантажує в індекс замовлення за останні `days` днів. Зупиняється, щойно `found()` повертає збіги.
  // Спершу найчастіші статуси, щоб звичайне замовлення знаходилось за кілька запитів.
  const STATUS_PRIORITY = ['11', '3', '56', '14', '18', '66', '60', '53'];
  // Статуси LP-CRM кешуємо на добу (один зовнішній запит менше на кожен пошук).
  async function cachedStatuses(creds) {
    const row = await db.get(`SELECT value FROM settings WHERE key = 'statuses_cache'`);
    const cache = row?.value ? JSON.parse(row.value) : null;
    if (cache && cache.sub === creds.subdomain && Date.now() - cache.at < 86400000) return cache.list;
    const list = Object.keys(await getStatuses(fetchFn, creds));
    await db.run(`INSERT INTO settings (key, value) VALUES ('statuses_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
      JSON.stringify({ at: Date.now(), sub: creds.subdomain, list }),
    ]);
    return list;
  }

  // Ключі пошуку замовлення: номер (id), код (order_id), ТТН, телефон (останні 9 цифр).
  const orderKeys = (o) => {
    const ks = [o.id, o.order_id, o.ttn].map((x) => String(x ?? '').trim()).filter(Boolean);
    const p = digits(o.phone);
    if (p.length >= 9) ks.push(`p:${p.slice(-9)}`);
    return [...new Set(ks)];
  };
  const queryKeys = (q) => {
    const ks = [String(q).trim()];
    const qd = digits(q);
    if (qd.length >= 9) ks.push(`p:${qd.slice(-9)}`);
    return ks;
  };

  // Одним пакетом: 100 замовлень = один запит до D1, а не 100.
  async function saveOrders(orders) {
    const now = nowIso();
    const keys = orders.flatMap((o) => orderKeys(o).map((k) => [
      `INSERT OR IGNORE INTO order_keys (k, code, day) VALUES (?, ?, ?)`, [k, String(o.order_id), String(o.datetime || '').slice(0, 10)],
    ]));
    await db.batch([...keys, ...orders.map((o) => [
      `INSERT INTO orders_index (code, datetime, phone, ttn, bayer_name, data, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET datetime = excluded.datetime, phone = excluded.phone, ttn = excluded.ttn,
       bayer_name = excluded.bayer_name, data = excluded.data, fetched_at = excluded.fetched_at`,
      [String(o.order_id), o.datetime || '', digits(o.phone), String(o.ttn || ''), o.bayer_name || '', JSON.stringify(o), now],
    ])]);
  }

  // Завантажує в індекс замовлення за останні `days` днів, статус за статусом, і зупиняється, щойно `found()` дає збіг.
  // Прогрес зберігається в базі: якщо ліміт запитів вичерпано, наступне звернення продовжить з того ж статусу.
  async function syncIndex(creds, days, found = async () => []) {
    if (syncing) { await syncing; return found(); }
    let result = [];
    syncing = (async () => {
      const all = await cachedStatuses(creds);
      const statuses = [...STATUS_PRIORITY.filter((x) => all.includes(x)), ...all.filter((x) => !STATUS_PRIORITY.includes(x))];
      const start = ymd(new Date(Date.now() - days * 86400000));
      const end = ymd(new Date(Date.now() + 86400000));
      const key = `${creds.subdomain}|${days}|${start}`;
      const pr = await db.get(`SELECT value FROM settings WHERE key = 'sync_progress'`);
      const prog = pr?.value ? JSON.parse(pr.value) : null;
      let i = prog && prog.key === key && Date.now() - prog.at < 30 * 60000 ? prog.i : 0;
      const saveProgress = (idx) => db.run(
        `INSERT INTO settings (key, value) VALUES ('sync_progress', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [JSON.stringify({ key, i: idx, at: Date.now() })],
      );
      for (; i < statuses.length; i++) {
        const codes = await getOrderCodesByStatus(fetchFn, creds, statuses[i], start, end);
        const known = new Set((await db.all(`SELECT code FROM orders_index WHERE code IN (SELECT value FROM json_each(?))`, [JSON.stringify(codes)])).map((r) => r.code));
        const fresh = codes.filter((c) => !known.has(c));
        for (let k = 0; k < fresh.length; k += 100) {
          await saveOrders(await getOrdersBatch(fetchFn, creds, fresh.slice(k, k + 100)));
        }
        await saveProgress(i + 1);
        result = await found();
        if (result.length) break;
      }
      await db.run(`DELETE FROM settings WHERE key = 'sync_progress'`);
    })();
    try { await syncing; } finally { syncing = null; }
    return result;
  }

  // Пошук у індексі — за ключами (номер, код, ТТН, телефон від 9 цифр): база читає лише рядки збігів,
  // а не всі замовлення за період (раніше це з'їдало денний ліміт читань D1). Найновіші — першими.
  async function matchIndex(q) {
    return db.all(
      `SELECT DISTINCT o.code, o.datetime, o.phone, o.ttn FROM order_keys k JOIN orders_index o ON o.code = k.code
       WHERE k.k IN (SELECT value FROM json_each(?)) ORDER BY o.datetime DESC`,
      [JSON.stringify(queryKeys(q))],
    );
  }


  async function resolveCode(q, s, creds) {
    if (/^\d{11,}$/.test(q) && !q.startsWith('380')) return { code: q };
    const alias = await db.get(`SELECT code FROM order_alias WHERE alias = ?`, [q]);
    if (alias) return { code: alias.code };
    let hits = await matchIndex(q);
    const maxDays = Number(s.lpcrm_search_days) || 30;
    // Спочатку останній тиждень (швидко), потім увесь період із налаштувань.
    if (!hits.length) hits = await syncIndex(creds, Math.min(7, maxDays), () => matchIndex(q));
    if (!hits.length && maxDays > 7) hits = await syncIndex(creds, maxDays, () => matchIndex(q));
    if (!hits.length) {
      throw new Error(`Замовлення «${q}» не знайдено серед замовлень за останні ${Number(s.lpcrm_search_days) || 30} днів. ` +
        'Введіть код замовлення (ID-o у шапці картки LP-CRM), телефон покупця або ТТН.');
    }
    const note = hits.length > 1 ? `Знайдено ${hits.length} замовлення(нь) за «${q}» — показано найновіше.` : '';
    if (hits.length === 1 && !/^\d{9,}$/.test(digits(q)) ) {
      await db.run(`INSERT INTO order_alias (alias, code) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET code = excluded.code`, [q, hits[0].code]);
    }
    return { code: hits[0].code, note };
  }

  async function loadOrder(orderId, s, fresh = false) {
    if (orderId === 'demo' || orderId === '0') {
      return { rawOrder: DEMO_ORDER, demo: true };
    }
    const creds = { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key };
    if (!creds.subdomain || !creds.key) throw new Error('Не налаштовано LP-CRM: вкажіть піддомен і API-ключ у розділі «Налаштування».');
    const { code, note } = await resolveCode(orderId, s, creds);
    const { order, raw } = await getOrder(fetchFn, creds, code, { fresh });
    const prods = order.products || order.goods || [];
    const list = Array.isArray(prods) ? prods : Object.values(prods);
    const missing = list.filter((p) => !(p.name || p.title || p.product_name)).map((p) => String(p.product_id ?? p.id ?? ''));
    const productNames = missing.length ? await getProducts(fetchFn, creds, missing) : {};
    return { rawOrder: order, crmRaw: raw, productNames, demo: false, code, note };
  }

  async function buildInvoice(orderId, { skipCheckbox = false, fresh = false } = {}) {
    const s = await settings();
    const { rawOrder, crmRaw, productNames, demo, code, note } = await loadOrder(orderId, s, fresh);
    const crmOrder = normalizeOrder(rawOrder, productNames);
    if (demo) crmOrder.orderId = 'demo';
    if (!crmOrder.orderId) crmOrder.orderId = String(orderId);
    // Номер накладної = звичний номер замовлення (поле id у LP-CRM), а не 16-значний код.
    if (!demo && crmOrder.shortId) crmOrder.orderId = crmOrder.shortId;
    else if (!demo && /^\d{1,8}$/.test(orderId)) crmOrder.orderId = String(orderId);
    const prefs = await db.get(`SELECT * FROM order_prefs WHERE order_id = ?`, [orderId]);
    const edits = prefs?.edits ? JSON.parse(prefs.edits) : null;
    // Дата накладної: за замовчуванням — день формування (за Києвом), а не дата створення замовлення.
    const today = kyivDay();
    const autoInvoiceDate = s.invoice_date_mode === 'order' ? String(crmOrder.date || '').slice(0, 10) || today : today;
    crmOrder.invoiceDate = autoInvoiceDate;
    const order = applyEdits(crmOrder, edits);

    const allFops = await db.all(`SELECT * FROM fops WHERE active = 1`);
    const byId = (id) => allFops.find((f) => String(f.id) === String(id)) || null;
    const warnings = [];
    if (note) warnings.push(note);
    if (!crmOrder.items.length) warnings.push('У замовленні не знайдено товарів — перевірте блок «Дані з CRM» унизу і надішліть скріншот сирої відповіді.');

    // 1) Чек Checkbox
    let receipt = null;
    let receiptCandidates = [];
    const cbFops = allFops.filter(hasCheckbox);
    const receiptRef = prefs?.receipt_ref || crmOrder.receiptHint;
    if (!skipCheckbox && cbFops.length && (receiptRef || s.checkbox_enabled === '1')) {
      try {
        const cacheKey = `${orderId}|${receiptRef}|${order.total}|${order.date}|${cbFops.map((f) => f.id).join(',')}`;
        const hit = receiptCache.get(cacheKey);
        let r;
        if (hit && Date.now() - hit.at < 10 * 60 * 1000) r = hit.r;
        else {
          r = receiptRef
            ? await findReceiptByRef(fetchFn, cbFops, receiptRef)
            : await findReceiptForOrder(fetchFn, cbFops, order, { days: Number(s.checkbox_search_days) || 7 });
          // Кешуємо лише знайдені чеки, щоб новий чек підхопився одразу після появи.
          if (r.receipt) receiptCache.set(cacheKey, { at: Date.now(), r });
        }
        receipt = r.receipt;
        receiptCandidates = r.candidates || [];
        warnings.push(...r.errors);
        if (!receipt && receiptRef) warnings.push(`Чек «${receiptRef}» не знайдено в жодному акаунті Checkbox.`);
      } catch (e) {
        warnings.push(`Checkbox: ${e.message}`);
      }
    }

    // 2) Відділ
    const office = crmOrder.office ? await db.get(`SELECT * FROM offices WHERE office_id = ?`, [crmOrder.office]) : null;
    const officeFop = office?.fop_id ? byId(office.fop_id) : null;
    if (crmOrder.office && !office) warnings.push(`Відділ ${crmOrder.office} не додано в довідник відділів.`);

    // 2б) Додаткове поле 1 (канал продажу, напр. «Rozetka(oneday)»)
    let channelFop = null;
    let ch = null;
    if (crmOrder.channel) {
      ch = (await db.all(`SELECT * FROM channels`)).find((x) => x.name.trim().toLowerCase() === crmOrder.channel.toLowerCase());
      channelFop = ch?.fop_id ? byId(ch.fop_id) : null;
      if (!ch) warnings.push(`Значення поля 1 «${crmOrder.channel}» не прив'язане до ФОП (розділ «Відділи → ФОП»).`);
    }

    // 3) Вибір: ручний > чек > поле 1 > відділ > за замовчуванням
    let fop = null;
    let fopSource = '';
    const manual = prefs?.fop_id ? byId(prefs.fop_id) : null;
    if (manual) { fop = manual; fopSource = 'manual'; }
    else if (receipt) { fop = byId(receipt.fopId); fopSource = 'receipt'; }
    else if (channelFop) { fop = channelFop; fopSource = 'channel'; }
    else if (officeFop) { fop = officeFop; fopSource = 'office'; }
    else if (s.default_fop_id && byId(s.default_fop_id)) { fop = byId(s.default_fop_id); fopSource = 'default'; }

    if (channelFop && officeFop && String(channelFop.id) !== String(officeFop.id) && !receipt) {
      warnings.push(`За полем 1 — ${channelFop.short_name}, а за відділом — ${officeFop.short_name}. Перевірте ФОП.`);
    }
    const autoFop = channelFop || officeFop;
    if (receipt && autoFop && String(receipt.fopId) !== String(autoFop.id)) {
      warnings.push(`За ${channelFop ? 'полем 1' : 'відділом'} мав би бути ${autoFop.short_name}, але чек пробито на ${receipt.fopName}.`);
    }
    if (manual && receipt && String(receipt.fopId) !== String(manual.id)) {
      warnings.push(`Обрано вручну ${manual.short_name}, а чек пробито на ${receipt.fopName}.`);
    }
    if (!fop) warnings.push('ФОП не визначено автоматично — оберіть його зі списку.');
    else {
      const missing = [];
      if (!fop.full_name) missing.push('ПІБ');
      if (!fop.ipn) missing.push('ІПН');
      if (missing.length) warnings.push(`У ${fop.short_name} не заповнено: ${missing.join(', ')}.`);
    }

    // Назва продавця в накладній: ручна правка > поле 1 > відділ (лише якщо рядок стосується обраного ФОП).
    const fits = (row) => row && row.seller_text && (!row.fop_id || String(row.fop_id) === String(fop?.id));
    let sellerText = '';
    let sellerTextSource = '';
    if (edits?.sellerText) { sellerText = edits.sellerText; sellerTextSource = 'manual'; }
    else if (fits(ch)) { sellerText = ch.seller_text; sellerTextSource = `поле 1 «${ch.name}»`; }
    else if (fits(office)) { sellerText = office.seller_text; sellerTextSource = `відділ ${office.office_id}`; }

    const tplId = prefs?.template_id || fop?.template_id;
    let template = tplId ? await db.get(`SELECT * FROM templates WHERE id = ?`, [tplId]) : null;
    if (!template) template = await db.get(`SELECT * FROM templates ORDER BY id LIMIT 1`);

    return {
      order,
      crmOrder,
      demo,
      edited: Boolean(edits),
      edits,
      office: office || (crmOrder.office ? { office_id: crmOrder.office, name: '' } : null),
      fop: docFop(fop),
      sellerText,
      sellerTextSource,
      autoInvoiceDate,
      fopSource,
      officeFopId: officeFop?.id || null,
      receipt,
      receiptCandidates,
      receiptRef: prefs?.receipt_ref || '',
      template: parseTpl(template),
      templateManual: Boolean(prefs?.template_id),
      warnings,
      sellerNote: s.seller_note || '',
      crmCode: code || '',
      crmRaw: crmRaw ? JSON.stringify(crmRaw, null, 2).slice(0, 20000) : '',
    };
  }

  // У версію не потрібна сира відповідь CRM (до 20 КБ) і службові поля — лише те, з чого малюється накладна.
  const snapshotOf = ({ crmRaw, receiptCandidates, versionsCount, requestedId, ...rest }) => rest;

  async function addVersion(orderId, inv, reason, who = '') {
    const dataHash = hash(JSON.stringify([inv.order, inv.fop?.id, inv.template?.id, inv.template?.options]));
    await db.run(
      `INSERT INTO versions (order_id, created_at, reason, fop_id, fop_name, template_id, total, data_hash, data, user_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, nowIso(), reason, inv.fop?.id || null, inv.fop?.short_name || '', inv.template?.id || null,
        inv.order.total, dataHash, JSON.stringify(snapshotOf(inv)), who],
    );
  }

  // Автоматично фіксує версію, якщо дані відрізняються від останньої збереженої.
  async function trackChanges(orderId, inv, who = '') {
    const last = await db.get(`SELECT data_hash FROM versions WHERE order_id = ? ORDER BY id DESC LIMIT 1`, [orderId]);
    const dataHash = hash(JSON.stringify([inv.order, inv.fop?.id, inv.template?.id, inv.template?.options]));
    if (!last) await addVersion(orderId, inv, 'Перше відкриття', who);
    else if (last.data_hash !== dataHash) await addVersion(orderId, inv, 'Змінилися дані (CRM, ФОП або шаблон)', who);
  }

  app.get('/api/invoice/:orderId', async (c) => {
    const orderId = c.req.param('orderId').trim().replace(/^№/, '');
    const inv = await buildInvoice(orderId, { fresh: c.req.query('fresh') === '1' });
    await trackChanges(orderId, inv, userName(c));
    const n = await db.get(`SELECT COUNT(*) AS n FROM versions WHERE order_id = ?`, [orderId]);
    return c.json({ ...inv, versionsCount: n?.n || 0 });
  });

  app.put('/api/invoice/:orderId/prefs', async (c) => {
    need(c, 'docs.edit');
    const orderId = c.req.param('orderId');
    const b = await c.req.json();
    const cur = (await db.get(`SELECT * FROM order_prefs WHERE order_id = ?`, [orderId])) || {};
    const next = {
      fop_id: b.fop_id !== undefined ? b.fop_id || null : cur.fop_id ?? null,
      template_id: b.template_id !== undefined ? b.template_id || null : cur.template_id ?? null,
      receipt_ref: b.receipt_ref !== undefined ? b.receipt_ref || '' : cur.receipt_ref || '',
      edits: b.edits !== undefined ? (b.edits ? JSON.stringify(b.edits) : '') : cur.edits || '',
    };
    await db.run(
      `INSERT INTO order_prefs (order_id, fop_id, template_id, receipt_ref, edits, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(order_id) DO UPDATE SET fop_id = excluded.fop_id, template_id = excluded.template_id,
       receipt_ref = excluded.receipt_ref, edits = excluded.edits, updated_at = excluded.updated_at`,
      [orderId, next.fop_id, next.template_id, next.receipt_ref, next.edits, nowIso()],
    );
    const inv = await buildInvoice(orderId);
    const reason = b.reason || 'Зміна вручну';
    await addVersion(orderId, inv, reason, userName(c));
    return c.json({ ok: true });
  });

  app.post('/api/invoice/:orderId/versions', async (c) => {
    const orderId = c.req.param('orderId');
    const b = await c.req.json();
    if (!b.snapshot?.order) return c.json({ error: 'Немає даних накладної' }, 400);
    await addVersion(orderId, b.snapshot, b.reason || 'Збережено', userName(c));
    return c.json({ ok: true });
  });

  app.get('/api/invoice/:orderId/versions', async (c) => {
    const rows = await db.all(
      `SELECT id, order_id, created_at, reason, fop_name, template_id, total, user_name FROM versions WHERE order_id = ? ORDER BY id DESC`,
      [c.req.param('orderId')],
    );
    return c.json(rows);
  });

  app.get('/api/versions/:id', async (c) => {
    const row = await db.get(`SELECT * FROM versions WHERE id = ?`, [c.req.param('id')]);
    if (!row) return c.json({ error: 'Версію не знайдено' }, 404);
    return c.json({ ...row, data: JSON.parse(row.data) });
  });

  app.get('/api/history', async (c) => {
    const q = (c.req.query('q') || '').trim();
    const fop = (c.req.query('fop') || '').trim();
    const where = [];
    const params = [];
    if (q) { where.push('order_id LIKE ?'); params.push(`%${q}%`); }
    if (fop) { where.push('fop_id = ?'); params.push(fop); }
    const rows = await db.all(
      `SELECT v.order_id, v.id AS last_id, v.created_at AS last_at, v.fop_name, v.total,
        (SELECT COUNT(*) FROM versions c WHERE c.order_id = v.order_id) AS versions
       FROM versions v
       WHERE v.id IN (SELECT MAX(id) FROM versions GROUP BY order_id) ${where.length ? 'AND ' + where.map((w) => 'v.' + w).join(' AND ') : ''}
       ORDER BY v.id DESC LIMIT 200`,
      params,
    );
    return c.json(rows);
  });

  return { loadOrder };
}
