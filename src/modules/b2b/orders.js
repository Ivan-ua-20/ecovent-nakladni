// B2B: юрособи партнера, закупівлі, файли (рахунок, накладна), історія замовлення.
// Закупівля: партнер обирає товари й юрособу → «Очікує рахунок» → бухгалтер (власник/адмін) вносить номер рахунку
// (і файл) → «Очікує оплату» → «Оплачено» (Opendatabot або вручну) → «Завершено». Доки рахунку немає, партнер може
// змінити або скасувати закупівлю. Ціни фіксуються в момент оформлення (зміна маржі не чіпає наявних замовлень).
import { fail, need, nowIso, round2 } from '../../core/common.js';
import { logAudit } from '../../core/requisites.js';
import { listFilter } from './filters.js';

export const ORDER_STATUS = {
  invoice_wait: 'Очікує рахунок',
  pay_wait: 'Очікує оплату',
  partial: 'Частково оплачено',
  paid: 'Оплачено',
  done: 'Завершено',
  cancelled: 'Скасовано',
};
// Замовлення для клієнта партнера (етап 3): нове → передано в CRM (або скасовано).
export const CLIENT_STATUS = {
  new: 'Нове',
  crm: 'Передано в CRM',
  cancelled: 'Скасовано',
};
const ANY_STATUS = { ...ORDER_STATUS, ...CLIENT_STATUS };
// Стан оплати замовлення клієнта: за закупівлею, з якої воно зібране; «без закупівлі» — оплачено вручну адміністратором.
export function payState(o) {
  if (o.kind !== 'client') return '';
  if (!o.supply_id) return o.paid_at ? 'paid' : 'unpaid';
  if (['paid', 'done'].includes(o.supply_status)) return 'paid';
  if (o.supply_status === 'partial') return 'partial';
  return 'unpaid';
}
export const PAY_NAME = { paid: 'Оплачено', partial: 'Частково оплачено', unpaid: 'Не оплачено' };
const ENTITY_KIND = { fop: 'ФОП', tov: 'ТОВ', other: 'Інша юрособа' };
const FILE_KIND = { invoice: 'Рахунок', waybill: 'Накладна', label: 'Маркування', other: 'Файл' };
const MAX_FILE = 5 * 1024 * 1024;
const PART = 600 * 1024; // байтів у частині (у base64 ≈ 800 КБ — менше за обмеження рядка D1)
const KEEP_FILES_DAYS = 30;

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nf = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uah = (n) => `${nf.format(Number(n) || 0)} грн`;
export const orderNo = (id) => `B2B-${id}`;

function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const userName = (u) => u?.name || u?.login || '';

export function mountB2bOrders(app, { db, services, myPartner, partnerPrice, onCleanup }) {
  // Файли старші за 30 днів видаляються (номери рахунків і накладних у замовленні лишаються).
  onCleanup(async () => {
    const border = new Date(Date.now() - KEEP_FILES_DAYS * 86400000).toISOString();
    await db.batch([
      [`DELETE FROM b2b_file_parts WHERE file_id IN (SELECT id FROM b2b_files WHERE created_at < ?)`, [border]],
      [`DELETE FROM b2b_files WHERE created_at < ?`, [border]],
    ]);
  });

  const log = (orderId, user, action) => db.run(`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`,
    [orderId, nowIso(), userName(user), action]);
  const tgAdmins = (text) => services.notify?.sendText({ admins: true }, text).catch(() => 0);
  // Партнеру: особисто його користувачам і в Telegram-групу партнера (якщо прив'язана).
  const groupOf = async (partnerId) => (await db.get(`SELECT tg_group FROM b2b_partners WHERE id = ?`, [partnerId]))?.tg_group || '';
  const tgPartner = async (partnerId, text) => services.notify?.sendText({ partnerId, chatIds: [await groupOf(partnerId)] }, text).catch(() => 0);
  const tgGroup = async (partnerId, text) => {
    const g = await groupOf(partnerId);
    return g ? services.notify?.sendText({ chatIds: [g] }, text).catch(() => 0) : 0;
  };
  // Детально про закупівлю: на кого рахунок і накладна, товари «назва — кількість — ціна партнера».
  const orderText = (title, o, p, items) => {
    const lines = items.slice(0, 60).map((i) => `${h(i.name)}${i.article ? ` (${h(i.article)})` : ''} — ${i.qty} шт — ${uah(i.price)}`);
    if (items.length > 60) lines.push(`…і ще ${items.length - 60} поз.`);
    return `${title} <b>${orderNo(o.id)}</b> від «${h(p.name)}»\n\n`
      + `<b>Рахунок і накладна на:</b>\n${h(o.entity || '—')}\n\n`
      + `<b>Товари:</b>\n${lines.join('\n')}\n\n<b>Разом: ${uah(o.total)}</b> (з ПДВ)`
      + `${o.comment ? `\n\n<i>Коментар: ${h(String(o.comment).slice(0, 300))}</i>` : ''}`;
  };
  const link = (c, hash) => `${new URL(c.req.url).origin}/#/${hash}`;

  // ================================================================ ЮРОСОБИ ПАРТНЕРА
  function entityFields(b) {
    const kind = ENTITY_KIND[b.kind] ? b.kind : 'fop';
    const code = String(b.code ?? '').replace(/\s/g, '');
    const iban = String(b.iban ?? '').replace(/\s/g, '').toUpperCase();
    const f = {
      kind, code, iban,
      name: String(b.name ?? '').trim().slice(0, 200),
      address: String(b.address ?? '').trim().slice(0, 300),
      phone: String(b.phone ?? '').trim().slice(0, 40),
      email: String(b.email ?? '').trim().slice(0, 120),
      vat: b.vat ? 1 : 0,
    };
    if (!f.name) throw fail(400, 'Вкажіть назву юрособи (як у документах).');
    if (!/^(\d{8}|\d{10})$/.test(code)) throw fail(400, 'Код: ЄДРПОУ — 8 цифр, ІПН (РНОКПП) ФОП — 10 цифр.');
    if (iban && !/^UA\d{27}$/.test(iban)) throw fail(400, 'IBAN: UA і 27 цифр (можна залишити порожнім).');
    return f;
  }

  app.get('/api/b2b/p/entities', async (c) => {
    const p = await myPartner(c);
    return c.json(await db.all(`SELECT * FROM b2b_entities WHERE partner_id = ? AND active = 1 ORDER BY name`, [p.id]));
  });

  app.post('/api/b2b/p/entities', async (c) => {
    const p = await myPartner(c);
    const f = entityFields(await c.req.json());
    if ((await db.get(`SELECT COUNT(*) AS n FROM b2b_entities WHERE partner_id = ? AND active = 1`, [p.id])).n >= 50) throw fail(400, 'Не більше 50 юросіб.');
    const r = await db.run(`INSERT INTO b2b_entities (partner_id, kind, name, code, address, iban, phone, email, vat, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [p.id, f.kind, f.name, f.code, f.address, f.iban, f.phone, f.email, f.vat, nowIso()]);
    return c.json({ id: r.lastId });
  });

  async function myEntity(p, id) {
    const e = await db.get(`SELECT * FROM b2b_entities WHERE id = ? AND partner_id = ? AND active = 1`, [id, p.id]);
    if (!e) throw fail(404, 'Юрособу не знайдено.');
    return e;
  }

  app.put('/api/b2b/p/entities/:id', async (c) => {
    const p = await myPartner(c);
    const e = await myEntity(p, c.req.param('id'));
    const f = entityFields(await c.req.json());
    await db.run(`UPDATE b2b_entities SET kind = ?, name = ?, code = ?, address = ?, iban = ?, phone = ?, email = ?, vat = ? WHERE id = ?`,
      [f.kind, f.name, f.code, f.address, f.iban, f.phone, f.email, f.vat, e.id]);
    return c.json({ ok: true });
  });

  // Видалення: якщо юрособа вже є в замовленнях — лише приховується (документи лишаються як були).
  app.delete('/api/b2b/p/entities/:id', async (c) => {
    const p = await myPartner(c);
    const e = await myEntity(p, c.req.param('id'));
    const used = await db.get(`SELECT id FROM b2b_orders WHERE entity_id = ? LIMIT 1`, [e.id]);
    if (used) await db.run(`UPDATE b2b_entities SET active = 0 WHERE id = ?`, [e.id]);
    else await db.run(`DELETE FROM b2b_entities WHERE id = ?`, [e.id]);
    return c.json({ ok: true });
  });

  // Підпис юрособи для замовлення (знімок — щоб зміна реквізитів не міняла старі замовлення).
  const entityText = (e) => `${e.name}, ${e.code.length === 8 ? 'ЄДРПОУ' : 'ІПН'} ${e.code}${e.vat ? ', платник ПДВ' : ''}`
    + `${e.address ? `\n${e.address}` : ''}${e.iban ? `\nIBAN ${e.iban}` : ''}${e.phone ? `\nТел. ${e.phone}` : ''}${e.email ? `\n${e.email}` : ''}`;

  // ================================================================ ЗАКУПІВЛІ (партнер)
  // Позиції за поточними цінами партнера: лише видимі йому товари (увімкнений бренд, не прихований, є РРЦ).
  async function priceItems(p, items) {
    const want = new Map();
    for (const it of Array.isArray(items) ? items : []) {
      const id = parseInt(it.product_id, 10);
      const qty = Number(it.qty);
      if (!id || !Number.isInteger(qty) || qty <= 0) continue;
      if (qty > 100000) throw fail(400, 'Кількість завелика.');
      want.set(id, (want.get(id) || 0) + qty);
    }
    if (!want.size) throw fail(400, 'Додайте хоча б один товар із кількістю.');
    if (want.size > 300) throw fail(400, 'Не більше 300 позицій в одному замовленні.');
    const rows = await db.all(
      `SELECT c.product_id, c.name, c.article, c.rrp, m.margin FROM b2b_catalog c JOIN b2b_margins m ON m.brand_id = c.brand_id AND m.partner_id = ?
       WHERE c.product_id IN (SELECT value FROM json_each(?)) AND c.hidden = 0 AND c.rrp > 0`,
      [p.id, JSON.stringify([...want.keys()])],
    );
    if (rows.length !== want.size) throw fail(400, 'Деякі товари більше недоступні — оновіть сторінку каталогу.');
    return rows.map((r) => ({ product_id: r.product_id, name: r.name, article: r.article || '', qty: want.get(r.product_id), price: partnerPrice(r.rrp, r.margin), rrp: r.rrp }));
  }
  const totalOf = (items) => round2(items.reduce((t, i) => t + round2(i.price * i.qty), 0));
  const itemRows = (orderId, items) => items.map((i) => [
    `INSERT INTO b2b_order_items (order_id, product_id, name, article, qty, price, rrp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orderId, i.product_id, i.name, i.article, i.qty, i.price, i.rrp],
  ]);

  app.post('/api/b2b/p/orders', async (c) => {
    const p = await myPartner(c);
    const b = await c.req.json();
    const e = await myEntity(p, b.entity_id);
    const items = await priceItems(p, b.items);
    const total = totalOf(items);
    const now = nowIso();
    const r = await db.run(
      `INSERT INTO b2b_orders (partner_id, kind, status, entity_id, entity, total, comment, created_by, created_at, updated_at) VALUES (?, 'supply', 'invoice_wait', ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, e.id, entityText(e), total, String(b.comment || '').trim().slice(0, 1000), userName(c.get('user')), now, now],
    );
    await db.batch([...itemRows(r.lastId, items), [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`, [r.lastId, now, userName(c.get('user')), `оформлено закупівлю на ${uah(total)}`]]]);
    const full = orderText('🆕 Нова закупівля', { id: r.lastId, entity: entityText(e), total, comment: b.comment }, p, items);
    await tgAdmins(`${full}\n\n${link(c, `b2borders/${r.lastId}`)}`);
    await tgGroup(p.id, full);
    return c.json({ id: r.lastId, number: orderNo(r.lastId), total });
  });

  async function orderOf(id, partnerId = null) {
    const o = await db.get(`SELECT * FROM b2b_orders WHERE id = ? ${partnerId ? 'AND partner_id = ?' : ''}`, partnerId ? [id, partnerId] : [id]);
    if (!o) throw fail(404, 'Замовлення не знайдено.');
    return o;
  }
  const publicOrder = (o) => {
    const out = { ...o, number: orderNo(o.id), status_name: ANY_STATUS[o.status] || o.status };
    if (o.kind === 'client') Object.assign(out, { no_supply: !o.supply_id, pay: payState(o), pay_name: PAY_NAME[payState(o)], supply_number: o.supply_id ? orderNo(o.supply_id) : '' });
    return out;
  };
  // Залишок товарів закупівлі для замовлень клієнтів (без скасованих; exceptId — замовлення, що зараз змінюється).
  async function supplyLeft(supplyId, exceptId = 0) {
    return db.all(
      `SELECT i.product_id, i.name, i.article, i.price, i.rrp, i.qty,
        COALESCE((SELECT SUM(ci.qty) FROM b2b_order_items ci JOIN b2b_orders co ON co.id = ci.order_id
          WHERE co.supply_id = i.order_id AND co.kind = 'client' AND co.status != 'cancelled' AND co.id != ? AND ci.product_id = i.product_id), 0) AS used
       FROM b2b_order_items i WHERE i.order_id = ? ORDER BY i.id`, [exceptId, supplyId],
    ).then((rows) => rows.map((r) => ({ ...r, left: r.qty - r.used })));
  }
  async function orderDetail(o) {
    if (o.kind === 'client' && o.supply_id && o.supply_status === undefined) {
      o = { ...o, supply_status: (await db.get(`SELECT status FROM b2b_orders WHERE id = ?`, [o.supply_id]))?.status || '' };
    }
    const [items, files, history, clients] = await Promise.all([
      db.all(`SELECT product_id, name, article, qty, price, rrp FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]),
      db.all(`SELECT id, kind, name, mime, size, created_by, created_at FROM b2b_files WHERE order_id = ? ORDER BY id`, [o.id]),
      db.all(`SELECT at, user_name, action FROM b2b_order_log WHERE order_id = ? ORDER BY id DESC LIMIT 100`, [o.id]),
      o.kind === 'supply' ? db.all(`SELECT id, status, client_name, total, created_at FROM b2b_orders WHERE supply_id = ? AND kind = 'client' ORDER BY id DESC`, [o.id]) : [],
    ]);
    const out = { order: publicOrder(o), items, files: files.map((f) => ({ ...f, kind_name: FILE_KIND[f.kind] || f.kind })), history };
    if (o.kind === 'supply') {
      out.clients = clients.map((x) => ({ ...x, number: orderNo(x.id), status_name: CLIENT_STATUS[x.status] || x.status }));
      out.left = clients.length ? await supplyLeft(o.id) : items.map((i) => ({ ...i, used: 0, left: i.qty }));
    }
    return out;
  }

  app.get('/api/b2b/p/orders', async (c) => {
    const p = await myPartner(c);
    const f = listFilter(c);
    const st = c.req.query('status');
    if (st && ORDER_STATUS[st]) { f.where.push('o.status = ?'); f.params.push(st); }
    const rows = await db.all(
      `SELECT o.*, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files FROM b2b_orders o
       WHERE o.partner_id = ? AND o.kind = 'supply' ${f.where.map((w) => `AND ${w}`).join(' ')} ORDER BY o.id DESC LIMIT 300`, [p.id, ...f.params],
    );
    return c.json({ rows: rows.map(publicOrder), statuses: ORDER_STATUS });
  });

  app.get('/api/b2b/p/orders/:id', async (c) => {
    const p = await myPartner(c);
    const o = await orderOf(c.req.param('id'), p.id);
    if (o.kind !== 'supply') throw fail(404, 'Замовлення не знайдено.');
    return c.json(await orderDetail(o));
  });

  // Зміна закупівлі партнером — доки бухгалтер не вніс рахунок. Ціни перераховуються за поточними.
  app.put('/api/b2b/p/orders/:id', async (c) => {
    const p = await myPartner(c);
    const o = await orderOf(c.req.param('id'), p.id);
    if (o.kind !== 'supply') throw fail(404, 'Замовлення не знайдено.');
    if (o.status !== 'invoice_wait') throw fail(400, 'Рахунок уже виставлено — змінити замовлення може лише менеджер.');
    const b = await c.req.json();
    const e = await myEntity(p, b.entity_id ?? o.entity_id);
    const items = await priceItems(p, b.items);
    const total = totalOf(items);
    // Не менше, ніж уже розписано на замовлення клієнтів.
    const want = new Map(items.map((i) => [i.product_id, i.qty]));
    for (const r of await supplyLeft(o.id)) {
      if (r.used > (want.get(r.product_id) || 0)) throw fail(400, `«${r.name}»: на замовлення клієнтів уже розписано ${r.used} шт. — менше зменшити не можна.`);
    }
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      ...itemRows(o.id, items),
      [`UPDATE b2b_orders SET entity_id = ?, entity = ?, total = ?, comment = ?, updated_at = ? WHERE id = ?`,
        [e.id, entityText(e), total, String(b.comment ?? o.comment ?? '').trim().slice(0, 1000), nowIso(), o.id]],
    ]);
    await log(o.id, c.get('user'), `змінено замовлення: ${items.length} поз., ${uah(total)}`);
    const full = orderText('✏️ Змінено закупівлю', { id: o.id, entity: entityText(e), total, comment: b.comment ?? o.comment }, p, items);
    await tgAdmins(`${full}\n\n${link(c, `b2borders/${o.id}`)}`);
    await tgGroup(p.id, full);
    return c.json({ ok: true, total });
  });

  app.post('/api/b2b/p/orders/:id/cancel', async (c) => {
    const p = await myPartner(c);
    const o = await orderOf(c.req.param('id'), p.id);
    if (o.kind !== 'supply') throw fail(404, 'Замовлення не знайдено.');
    if (o.status !== 'invoice_wait') throw fail(400, 'Рахунок уже виставлено — скасувати замовлення може лише менеджер.');
    if (await db.get(`SELECT id FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled' LIMIT 1`, [o.id])) {
      throw fail(400, 'З цієї закупівлі вже є замовлення клієнтів — спершу скасуйте їх.');
    }
    await db.run(`UPDATE b2b_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    await log(o.id, c.get('user'), 'партнер скасував замовлення');
    await tgAdmins(`❌ <b>Скасовано закупівлю ${orderNo(o.id)}</b> («${h(p.name)}»)\n${link(c, `b2borders/${o.id}`)}`);
    await tgGroup(p.id, `❌ Закупівлю <b>${orderNo(o.id)}</b> скасовано.`);
    return c.json({ ok: true });
  });

  // ================================================================ ЗАМОВЛЕННЯ ПАРТНЕРІВ (адмін / бухгалтер)
  app.get('/api/b2b/orders', async (c) => {
    need(c, 'b2b.admin');
    const f = listFilter(c);
    const where = [`o.kind = 'supply'`, ...f.where];
    const params = [...f.params];
    const st = c.req.query('status');
    const pid = parseInt(c.req.query('partner'), 10);
    if (st && ORDER_STATUS[st]) { where.push('o.status = ?'); params.push(st); }
    if (pid) { where.push('o.partner_id = ?'); params.push(pid); }
    const rows = await db.all(
      `SELECT o.*, p.name AS partner, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files
       FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, params,
    );
    const counts = await db.all(`SELECT status, COUNT(*) AS n FROM b2b_orders WHERE kind = 'supply' GROUP BY status`);
    return c.json({ rows: rows.map(publicOrder), statuses: ORDER_STATUS, counts: Object.fromEntries(counts.map((r) => [r.status, r.n])) });
  });

  app.get('/api/b2b/orders/:id', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    const p = await db.get(`SELECT id, name, phone, email FROM b2b_partners WHERE id = ?`, [o.partner_id]);
    return c.json({ ...(await orderDetail(o)), partner: p });
  });

  // Бухгалтер вносить номер рахунку (і накладної): «Очікує рахунок» → «Очікує оплату».
  app.put('/api/b2b/orders/:id', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.status === 'cancelled') throw fail(400, 'Замовлення скасовано.');
    const b = await c.req.json();
    const next = {
      invoice_no: b.invoice_no !== undefined ? String(b.invoice_no).trim().slice(0, 40) : o.invoice_no,
      invoice_date: b.invoice_date !== undefined ? String(b.invoice_date).trim().slice(0, 10) : o.invoice_date,
      waybill_no: b.waybill_no !== undefined ? String(b.waybill_no).trim().slice(0, 40) : o.waybill_no,
    };
    if (next.invoice_date && !/^\d{4}-\d{2}-\d{2}$/.test(next.invoice_date)) throw fail(400, 'Дата рахунку — у форматі РРРР-ММ-ДД.');
    let status = o.status;
    if (o.kind === 'supply' && next.invoice_no && status === 'invoice_wait') status = 'pay_wait';
    if (o.kind === 'supply' && !next.invoice_no && status === 'pay_wait') status = 'invoice_wait';
    await db.run(`UPDATE b2b_orders SET invoice_no = ?, invoice_date = ?, waybill_no = ?, status = ?, updated_at = ? WHERE id = ?`,
      [next.invoice_no, next.invoice_date, next.waybill_no, status, nowIso(), o.id]);
    const changes = [];
    if (next.invoice_no !== o.invoice_no) changes.push(`рахунок № ${next.invoice_no || '—'}${next.invoice_date ? ` від ${next.invoice_date}` : ''}`);
    if (next.waybill_no !== o.waybill_no) changes.push(`накладна № ${next.waybill_no || '—'}`);
    if (changes.length) await log(o.id, c.get('user'), changes.join('; '));
    if (next.invoice_no && next.invoice_no !== o.invoice_no) {
      await tgPartner(o.partner_id, `🧾 <b>Рахунок № ${h(next.invoice_no)}</b> на ${o.kind === 'client' ? 'замовлення' : 'закупівлю'} ${orderNo(o.id)} — <b>${uah(o.total)}</b>\nОчікує оплату. Файл рахунку — у кабінеті партнера.\n${link(c, `${o.kind === 'client' ? 'pclients' : 'porders'}/${o.id}`)}`);
    }
    return c.json({ ok: true, status });
  });

  // Ручна зміна статусу: «Оплачено» (якщо Opendatabot не побачив оплату), «Завершено», «Скасовано», повернути «Очікує оплату».
  app.post('/api/b2b/orders/:id/status', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind !== 'supply') throw fail(400, 'Статус замовлення клієнта змінюється на його сторінці.');
    const { status } = await c.req.json();
    if (!['paid', 'done', 'cancelled', 'pay_wait'].includes(status)) throw fail(400, 'Невідомий статус.');
    if (status === 'pay_wait' && !o.invoice_no) throw fail(400, 'Спершу внесіть номер рахунку.');
    if (status === 'paid' && !o.invoice_no) throw fail(400, 'Спершу внесіть номер рахунку.');
    const u = c.get('user');
    const now = nowIso();
    if (status === 'paid') {
      await db.run(`UPDATE b2b_orders SET status = 'paid', paid_amount = total, paid_at = ?, paid_by = ?, updated_at = ? WHERE id = ?`, [now, userName(u), now, o.id]);
      await log(o.id, u, 'позначено «Оплачено» вручну');
      await tgPartner(o.partner_id, `✅ <b>Оплату отримано</b>: закупівля ${orderNo(o.id)}${o.invoice_no ? `, рахунок № ${h(o.invoice_no)}` : ''} — ${uah(o.total)}`);
    } else {
      await db.run(`UPDATE b2b_orders SET status = ?, updated_at = ? WHERE id = ?`, [status, now, o.id]);
      await log(o.id, u, `статус: «${ORDER_STATUS[status]}»`);
      if (status === 'cancelled') await tgPartner(o.partner_id, `❌ Закупівлю ${orderNo(o.id)} скасовано менеджером.`);
    }
    return c.json({ ok: true });
  });

  // ================================================================ ФАЙЛИ
  // Завантаження: тіло запиту — сам файл; назва — у заголовку X-File-Name (encodeURIComponent).
  app.post('/api/b2b/orders/:id/files', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    const kind = FILE_KIND[c.req.query('kind')] ? c.req.query('kind') : 'other';
    const f = await saveFile(c, o, kind);
    // Рахунок і накладну бот дублює файлом у Telegram-групу партнера.
    const g = ['invoice', 'waybill'].includes(kind) ? await groupOf(o.partner_id) : '';
    let toGroup = 0;
    if (g) {
      const caption = `${kind === 'invoice' ? '🧾 Рахунок' : '📦 Накладна'}${kind === 'invoice' && o.invoice_no ? ` № ${h(o.invoice_no)}` : ''}${kind === 'waybill' && o.waybill_no ? ` № ${h(o.waybill_no)}` : ''} — ${o.kind === 'client' ? 'замовлення' : 'закупівля'} <b>${orderNo(o.id)}</b> на ${uah(o.total)}`;
      toGroup = await services.notify?.sendFile?.({ chatIds: [g] }, f, caption).catch(() => 0) || 0;
      if (toGroup) await log(o.id, c.get('user'), `файл «${f.name}» надіслано в Telegram-групу партнера`);
    }
    return c.json({ id: f.id, toGroup: !!toGroup });
  });

  async function saveFile(c, o, kind) {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw fail(400, 'Порожній файл.');
    if (bytes.length > MAX_FILE) throw fail(400, 'Файл завеликий (до 5 МБ).');
    let name = 'file';
    try { name = decodeURIComponent(c.req.header('x-file-name') || 'file'); } catch { /* */ }
    name = name.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 150) || 'file';
    const mime = String(c.req.header('content-type') || 'application/octet-stream').slice(0, 100);
    const parts = Math.ceil(bytes.length / PART);
    const u = c.get('user');
    const r = await db.run(`INSERT INTO b2b_files (order_id, kind, name, mime, size, parts, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [o.id, kind, name, mime, bytes.length, parts, userName(u), nowIso()]);
    const st = [];
    for (let n = 0; n < parts; n++) st.push([`INSERT INTO b2b_file_parts (file_id, n, data) VALUES (?, ?, ?)`, [r.lastId, n, toB64(bytes.subarray(n * PART, (n + 1) * PART))]]);
    await db.batch(st);
    await log(o.id, u, `додано файл: ${FILE_KIND[kind]} «${name}»`);
    return { id: r.lastId, bytes, name, mime };
  }

  async function sendFile(f) {
    const parts = await db.all(`SELECT data FROM b2b_file_parts WHERE file_id = ? ORDER BY n`, [f.id]);
    if (parts.length !== f.parts) throw fail(410, 'Файл видалено (зберігаються 30 днів).');
    const chunks = parts.map((p) => fromB64(p.data));
    const out = new Uint8Array(chunks.reduce((t, x) => t + x.length, 0));
    let off = 0;
    for (const ch of chunks) { out.set(ch, off); off += ch.length; }
    return new Response(out, {
      headers: {
        'Content-Type': f.mime || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  }

  app.get('/api/b2b/files/:id', async (c) => {
    need(c, 'b2b.admin');
    const f = await db.get(`SELECT * FROM b2b_files WHERE id = ?`, [c.req.param('id')]);
    if (!f) throw fail(404, 'Файл не знайдено (зберігаються 30 днів).');
    return sendFile(f);
  });

  app.delete('/api/b2b/files/:id', async (c) => {
    need(c, 'b2b.admin');
    const f = await db.get(`SELECT * FROM b2b_files WHERE id = ?`, [c.req.param('id')]);
    if (!f) throw fail(404, 'Файл не знайдено.');
    await db.batch([[`DELETE FROM b2b_file_parts WHERE file_id = ?`, [f.id]], [`DELETE FROM b2b_files WHERE id = ?`, [f.id]]]);
    await log(f.order_id, c.get('user'), `видалено файл «${f.name}»`);
    return c.json({ ok: true });
  });

  // Партнер — лише файли своїх замовлень.
  app.get('/api/b2b/p/files/:id', async (c) => {
    const p = await myPartner(c);
    const f = await db.get(`SELECT f.* FROM b2b_files f JOIN b2b_orders o ON o.id = f.order_id WHERE f.id = ? AND o.partner_id = ?`, [c.req.param('id'), p.id]);
    if (!f) throw fail(404, 'Файл не знайдено (зберігаються 30 днів).');
    return sendFile(f);
  });

  // Видалення замовлення (тестові тощо): разом із позиціями, історією і файлами. Закупівлю з замовленнями клієнтів — ні.
  app.delete('/api/b2b/orders/:id', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind === 'supply') {
      const n = (await db.get(`SELECT COUNT(*) AS n FROM b2b_orders WHERE supply_id = ? AND kind = 'client'`, [o.id])).n;
      if (n) throw fail(400, `З цієї закупівлі є замовлення клієнтів (${n}) — спершу видаліть їх.`);
    }
    await db.batch([
      [`DELETE FROM b2b_file_parts WHERE file_id IN (SELECT id FROM b2b_files WHERE order_id = ?)`, [o.id]],
      [`DELETE FROM b2b_files WHERE order_id = ?`, [o.id]],
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      [`DELETE FROM b2b_order_log WHERE order_id = ?`, [o.id]],
      [`DELETE FROM b2b_orders WHERE id = ?`, [o.id]],
    ]);
    await logAudit(db, { user: c.get('user'), kind: 'b2b', refId: o.partner_id, action: `видалено ${o.kind === 'client' ? 'замовлення клієнта' : 'закупівлю'} ${orderNo(o.id)} на ${uah(o.total)}${o.crm_id ? ` (у LP-CRM № ${o.crm_id} — не видалено)` : ''}` }).catch(() => 0);
    return c.json({ ok: true, inCrm: o.crm_id || '' });
  });

  return { ORDER_STATUS, priceItems, totalOf, itemRows, orderOf, orderDetail, publicOrder, supplyLeft, saveFile, log, tgAdmins, tgPartner, tgGroup, link, uah, h };
}
