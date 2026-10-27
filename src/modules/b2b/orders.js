// B2B: юрособи партнера, закупівлі, файли (рахунок, накладна), історія замовлення.
// Закупівля: партнер обирає товари й юрособу → «Очікує рахунок» → бухгалтер (власник/адмін) вносить номер рахунку
// (і файл) → «Очікує оплату» → «Оплачено» (Opendatabot або вручну) → «Завершено». Доки рахунку немає, партнер може
// змінити або скасувати закупівлю. Ціни фіксуються в момент оформлення (зміна маржі не чіпає наявних замовлень).
// Відкрита закупівля (status 'open'): замовлення клієнтів «без закупівлі» автоматично складаються в одну таку закупівлю
// партнера (ліміт open_limit, типово 20 000); партнер будь-коли обирає юрособу і «Формує рахунок» — вона стає звичайною.
// Ліміт неоплачених закупівель (unpaid_limit, типово 100 000): понад нього нові закупівлі й поповнення відкритої — ні.
import { fail, need, nowIso, round2 } from '../../core/common.js';
import { listFilter, kyivDayOf } from './filters.js';
import { pdfText, parseNpLabel } from '../../integrations/pdftext.js';
import { can } from '../../core/auth.js';

export const ORDER_STATUS = {
  draft: 'Чернетка',
  open: 'Відкрита (рахунок не сформовано)',
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
  if (!o.supply_id) return o.paid_at ? 'paid' : 'unpaid'; // старі «без закупівлі»: оплату ставить адмін
  if (['paid', 'done'].includes(o.supply_status)) return 'paid';
  if (o.supply_status === 'partial') return 'partial';
  return 'unpaid';
}
export const PAY_NAME = { paid: 'Оплачено', partial: 'Частково оплачено', unpaid: 'В процесі оплати' };
export const DEFAULT_LIMITS = { open: 20000, unpaid: 100000 };
export const limitsOf = (p) => ({
  open: Number(p?.open_limit) > 0 ? Number(p.open_limit) : DEFAULT_LIMITS.open,
  unpaid: Number(p?.unpaid_limit) > 0 ? Number(p.unpaid_limit) : DEFAULT_LIMITS.unpaid,
});
const UNPAID = `('open', 'invoice_wait', 'pay_wait', 'partial')`;
// Борг партнера: рахунок виставлено, а оплати (повної) ще немає.
export const DEBT = `('pay_wait', 'partial')`;
// Закупівлі без рахунку, з яких уже могли відвантажити замовлення клієнтів.
export const SHIP_NOINV = `('open', 'invoice_wait')`;
const today = () => kyivDayOf(new Date().toISOString());
const addDaysTo = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// Скільки днів прострочено (0 — не прострочено або вже оплачено).
export const overdueDays = (o) => (o.due_date && ['pay_wait', 'partial'].includes(o.status) && o.due_date < today()
  ? Math.round((Date.parse(`${today()}T12:00:00Z`) - Date.parse(`${o.due_date}T12:00:00Z`)) / 86400000) : 0);
// «Закрито»: усі товари закупівлі розписано на замовлення клієнтів (не скасовані) — залишку немає.
export const CLOSED_SQL = `(o.kind = 'supply' AND o.status NOT IN ('open', 'cancelled', 'draft')
  AND EXISTS (SELECT 1 FROM b2b_order_items i WHERE i.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM b2b_order_items i WHERE i.order_id = o.id AND i.qty > COALESCE((SELECT SUM(ci.qty) FROM b2b_order_items ci
    JOIN b2b_orders co ON co.id = ci.order_id WHERE co.supply_id = o.id AND co.kind = 'client' AND co.status != 'cancelled' AND ci.product_id = i.product_id), 0)))`;
// Спосіб отримання закупівлі: товари розписуються на замовлення клієнтів (Нова пошта) або партнер забирає все сам.
export const DELIVERY = { np: 'Відправка клієнтам (Нова пошта)', pickup: 'Самовивіз — партнер забирає всю закупівлю зі складу' };
const deliveryOf = (v) => (DELIVERY[v] ? v : 'np');
const LIST_STATUSES = { ...ORDER_STATUS, closed: 'Закрито (усе розписано)' };
const ENTITY_KIND = { fop: 'ФОП', tov: 'ТОВ', other: 'Інша юрособа' };
const FILE_KIND = { invoice: 'Рахунок', waybill: 'Накладна', label: 'Маркування', doc: 'Документ', other: 'Файл' };
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

export function mountB2bOrders(app, { db, services, myPartner, partnerPrice, onCleanup, hooks = {} }) {
  // Нагадування про відстрочку: за день до строку і при простроченні (потім — раз на тиждень). Партнеру й адмінам.
  onCleanup(async () => {
    const t = today();
    const rows = await db.all(`SELECT o.*, p.name AS partner FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id
      WHERE o.kind = 'supply' AND o.status IN ${DEBT} AND o.due_date != '' AND o.due_date <= ? LIMIT 50`, [addDaysTo(t, 1)]);
    for (const o of rows) {
      const left = round2(o.total - o.paid_amount);
      const late = overdueDays(o);
      const last = String(o.due_notified || '');
      let text = '';
      if (!late && o.due_date > t && last !== 'pre') text = `⏰ <b>Завтра строк оплати</b> закупівлі ${orderNo(o.id)}${o.invoice_no ? ` (рахунок № ${h(o.invoice_no)})` : ''}: ${uah(left)}`;
      else if (late && (!last.startsWith('over:') || addDaysTo(last.slice(5), 7) <= t)) text = `🔴 <b>Прострочено оплату</b> закупівлі ${orderNo(o.id)}${o.invoice_no ? ` (рахунок № ${h(o.invoice_no)})` : ''} на ${late} дн.: ${uah(left)}`;
      if (!text) continue;
      await db.run(`UPDATE b2b_orders SET due_notified = ? WHERE id = ?`, [late ? `over:${t}` : 'pre', o.id]);
      await tgPartner(o.partner_id, text);
      await tgAdmins(`${text} — «${h(o.partner)}»`);
    }
  });

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
  // Партнеру — лише особисто його користувачам. У Telegram-групу партнера (tgGroup) — тільки головне: нова закупівля,
  // рахунок і накладна (файлами) і «усі замовлення закупівлі взято в роботу складом».
  const groupOf = async (partnerId) => (await db.get(`SELECT tg_group FROM b2b_partners WHERE id = ?`, [partnerId]))?.tg_group || '';
  const tgPartner = async (partnerId, text) => services.notify?.sendText({ partnerId }, text).catch(() => 0);
  const tgGroup = async (partnerId, text) => {
    const g = await groupOf(partnerId);
    return g ? services.notify?.sendText({ chatIds: [g] }, text).catch(() => 0) : 0;
  };
  // Детально про закупівлю: на кого рахунок і накладна, товари «назва — кількість — ціна партнера».
  const orderText = (title, o, p, items) => {
    const lines = items.slice(0, 60).map((i) => `${h(i.name)}${i.article ? ` (${h(i.article)})` : ''} — ${i.qty} шт — ${uah(i.price)}`);
    if (items.length > 60) lines.push(`…і ще ${items.length - 60} поз.`);
    return `${title} <b>${orderNo(o.id)}</b> від «${h(p.name)}»\n\n`
      + `<b>Рахунок і накладна на:</b>\n${h(o.entity || '—')}\n`
      + `<b>Доставка:</b> ${o.delivery === 'pickup' ? '🚗 <b>САМОВИВІЗ</b> — партнер забирає всю закупівлю зі складу' : 'відправка клієнтам (Нова пошта)'}\n`
      + `${o.pay_terms === 'postpay' ? `<b>Оплата:</b> ⏳ <b>ВІДСТРОЧКА ${o.pay_days} дн.</b> від дати рахунку\n` : ''}\n`
      + `<b>Товари:</b>\n${lines.join('\n')}\n\n<b>Разом: ${uah(o.total)}</b> (з ПДВ)`
      + `${o.comment ? `\n\n<i>Коментар: ${h(String(o.comment).slice(0, 300))}</i>` : ''}`;
  };
  const link = (c, hash) => `${typeof c === 'string' ? c : new URL(c.req.url).origin}/#/${hash}`;

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

  // Юрособа за замовчуванням (b2b_partners.default_entity) — першою в списку й вибрана в нових закупівлях.
  app.get('/api/b2b/p/entities', async (c) => {
    const p = await myPartner(c);
    const rows = await db.all(`SELECT * FROM b2b_entities WHERE partner_id = ? AND active = 1 ORDER BY name`, [p.id]);
    const def = Number(p.default_entity) || 0;
    return c.json(rows.map((e) => ({ ...e, is_default: e.id === def })).sort((a, b) => Number(b.is_default) - Number(a.is_default)));
  });
  app.post('/api/b2b/p/entities/:id/default', async (c) => {
    const p = await myPartner(c);
    const e = await myEntity(p, c.req.param('id'));
    const on = (await c.req.json().catch(() => ({}))).on !== false;
    await db.run(`UPDATE b2b_partners SET default_entity = ? WHERE id = ?`, [on ? e.id : null, p.id]);
    return c.json({ ok: true });
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

  // Чернетка закупівлі: менеджери партнера збирають товари (можна в одну спільну — товари додаються),
  // керівник партнера відправляє її нам («Відправити закупівлю»). Чернетки бачить лише команда партнера.
  const isHead = (c) => can(c.get('user'), 'b2b.team');
  app.post('/api/b2b/p/orders', async (c) => {
    const p = await myPartner(c);
    const b = await c.req.json();
    const toDraft = parseInt(b.to_draft, 10) || 0;
    if (toDraft) {
      // Додати товари до наявної чернетки (кількості сумуються).
      const d = await orderOf(toDraft, p.id);
      if (d.kind !== 'supply' || d.status !== 'draft') throw fail(400, 'Чернетку вже відправлено або видалено — оновіть сторінку.');
      const have = await db.all(`SELECT product_id, qty FROM b2b_order_items WHERE order_id = ?`, [d.id]);
      const sum = new Map(have.map((i) => [i.product_id, i.qty]));
      const add = (Array.isArray(b.items) ? b.items : []).filter((i) => Number(i.qty) > 0);
      if (!add.length) throw fail(400, 'Вкажіть кількість хоча б одного товару.');
      for (const i of add) sum.set(Number(i.product_id), (sum.get(Number(i.product_id)) || 0) + Math.floor(Number(i.qty)));
      const items = await priceItems(p, [...sum].map(([product_id, qty]) => ({ product_id, qty })));
      const total = totalOf(items);
      await db.batch([[`DELETE FROM b2b_order_items WHERE order_id = ?`, [d.id]], ...itemRows(d.id, items),
        [`UPDATE b2b_orders SET total = ?, updated_at = ? WHERE id = ?`, [total, nowIso(), d.id]]]);
      await log(d.id, c.get('user'), `додано до чернетки: ${add.length} поз. (разом ${uah(total)})`);
      return c.json({ id: d.id, number: orderNo(d.id), total, draft: true });
    }
    const draft = Boolean(b.draft) || !isHead(c); // менеджер партнера — лише чернетка
    const e = await myEntity(p, b.entity_id);
    const items = await priceItems(p, b.items);
    const total = totalOf(items);
    const terms = termsOf(b);
    if (terms === 'postpay' && !(Number(p.postpay_days) > 0)) throw fail(403, 'Відстрочку оплати вам ще не відкрито — зверніться до менеджера.');
    if (!draft) await checkTerms(p, terms, total);
    const payDays = terms === 'postpay' ? Number(p.postpay_days) : 0;
    const now = nowIso();
    if (draft) {
      const r = await db.run(
        `INSERT INTO b2b_orders (partner_id, kind, status, entity_id, entity, total, comment, created_by, created_at, updated_at, delivery, pay_terms, pay_days) VALUES (?, 'supply', 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, e.id, entityText(e), total, String(b.comment || '').trim().slice(0, 1000), userName(c.get('user')), now, now, deliveryOf(b.delivery), terms, payDays],
      );
      await db.batch([...itemRows(r.lastId, items), [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`, [r.lastId, now, userName(c.get('user')), `створено чернетку на ${uah(total)}`]]]);
      return c.json({ id: r.lastId, number: orderNo(r.lastId), total, draft: true });
    }
    const r = await db.run(
      `INSERT INTO b2b_orders (partner_id, kind, status, entity_id, entity, total, comment, created_by, created_at, updated_at, delivery, pay_terms, pay_days) VALUES (?, 'supply', 'invoice_wait', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, e.id, entityText(e), total, String(b.comment || '').trim().slice(0, 1000), userName(c.get('user')), now, now, deliveryOf(b.delivery), terms, payDays],
    );
    await db.batch([...itemRows(r.lastId, items), [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`,
      [r.lastId, now, userName(c.get('user')), `оформлено закупівлю на ${uah(total)}${deliveryOf(b.delivery) === 'pickup' ? ' (самовивіз)' : ''}`]]]);
    const full = orderText('🆕 Нова закупівля', { id: r.lastId, entity: entityText(e), total, comment: b.comment, delivery: deliveryOf(b.delivery), pay_terms: terms, pay_days: payDays }, p, items);
    await tgAdmins(`${full}\n\n${link(c, `b2borders/${r.lastId}`)}`);
    await tgGroup(p.id, full);
    await hooks.finRequest?.(r.lastId).catch(() => 0); // запит рахунку в групу «Фінансові питання»
    return c.json({ id: r.lastId, number: orderNo(r.lastId), total });
  });

  // ---------------------------------------------------------------- ліміти й відкрита закупівля
  // Неоплачені закупівлі з передоплатою (з відстрочкою — окремий ліміт відстрочки).
  async function unpaidTotal(partnerId, exceptId = 0) {
    const r = await db.get(`SELECT COALESCE(SUM(total - paid_amount), 0) AS t FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status IN ${UNPAID}
      AND COALESCE(pay_terms, 'prepay') != 'postpay' AND id != ?`, [partnerId, exceptId]);
    return round2(r?.t || 0);
  }
  // Відстрочка оплати: дозволена, якщо адмін задав партнеру кількість днів; ліміт (порожньо — без окремого ліміту);
  // з простроченою оплатою — нових закупівель з відстрочкою не можна.
  async function postpayInfo(p, exceptId = 0) {
    const days = Number(p.postpay_days) || 0;
    const [used, overdue] = await Promise.all([
      db.get(`SELECT COALESCE(SUM(total - paid_amount), 0) AS t FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status IN ${UNPAID}
        AND pay_terms = 'postpay' AND id != ?`, [p.id, exceptId]),
      db.all(`SELECT id, total, paid_amount, due_date, status FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status IN ${DEBT}
        AND due_date != '' AND due_date < ?`, [p.id, today()]),
    ]);
    return { days, limit: Number(p.postpay_limit) > 0 ? Number(p.postpay_limit) : null, used: round2(used?.t || 0),
      overdue: overdue.map((o) => ({ id: o.id, number: orderNo(o.id), due: round2(o.total - o.paid_amount), due_date: o.due_date, days: overdueDays(o) })) };
  }
  async function checkTerms(p, terms, total, exceptId = 0) {
    if (terms !== 'postpay') return checkUnpaid(p, total, exceptId);
    const pi = await postpayInfo(p, exceptId);
    if (!pi.days) throw fail(403, 'Відстрочку оплати вам ще не відкрито — зверніться до менеджера.');
    if (pi.overdue.length) throw fail(400, `Є прострочена оплата (${pi.overdue.map((x) => x.number).join(', ')}) — нові закупівлі з відстрочкою після її оплати.`);
    if (pi.limit != null && pi.used + total > pi.limit + 0.004) {
      throw fail(400, `Ліміт відстрочки — ${uah(pi.limit)}: зараз за відстрочкою ${uah(pi.used)}, нова сума ${uah(total)}.`);
    }
    return null;
  }
  const termsOf = (b, o = null) => (b.pay_terms === undefined ? (o?.pay_terms === 'postpay' ? 'postpay' : 'prepay') : (b.pay_terms === 'postpay' ? 'postpay' : 'prepay'));
  // Нова сума неоплачених закупівель (exceptId — закупівля, що змінюється) не має перевищити ліміт партнера.
  async function checkUnpaid(p, addTotal, exceptId = 0) {
    const lim = limitsOf(p).unpaid;
    const cur = await unpaidTotal(p.id, exceptId);
    if (cur + addTotal > lim + 0.004) {
      throw fail(400, `Ліміт неоплачених закупівель — ${uah(lim)}: зараз неоплачено ${uah(cur)}, нова сума ${uah(addTotal)}. Спершу оплатіть закупівлі або зверніться до менеджера.`);
    }
  }
  // Заборгованість партнера: закупівлі з рахунком без повної оплати — сума, оплачено, залишок, строк, прострочення.
  // + «відвантажено без рахунку»: замовлення клієнтів, уже передані в CRM, із закупівель без рахунку (відкрита / очікує рахунок).
  async function debtOf(partnerId) {
    const [rows, ship] = await Promise.all([
      db.all(`SELECT id, status, total, paid_amount, invoice_no, invoice_date, due_date, pay_terms, created_at FROM b2b_orders
        WHERE partner_id = ? AND kind = 'supply' AND status IN ${DEBT} ORDER BY COALESCE(NULLIF(due_date, ''), invoice_date, created_at), id`, [partnerId]),
      db.all(`SELECT s.id, s.status, COUNT(co.id) AS n, SUM(co.total) AS sum FROM b2b_orders s
        JOIN b2b_orders co ON co.supply_id = s.id AND co.kind = 'client' AND co.status = 'crm'
        WHERE s.partner_id = ? AND s.kind = 'supply' AND s.status IN ${SHIP_NOINV} GROUP BY s.id ORDER BY s.id`, [partnerId]),
    ]);
    const list = rows.map((o) => ({ ...o, number: orderNo(o.id), due: round2(o.total - o.paid_amount), overdue: overdueDays(o) }));
    const shipped = ship.map((s) => ({ id: s.id, number: orderNo(s.id), status: s.status, open: s.status === 'open', orders: s.n, sum: round2(s.sum || 0) }));
    const invoiced = round2(list.reduce((t, o) => t + o.due, 0));
    const shippedTotal = round2(shipped.reduce((t, s) => t + s.sum, 0));
    return { total: round2(invoiced + shippedTotal), invoiced, shippedTotal, overdue: round2(list.filter((o) => o.overdue).reduce((t, o) => t + o.due, 0)), rows: list, shipped };
  }
  const getOpen = (partnerId) => db.get(`SELECT * FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status = 'open' ORDER BY id LIMIT 1`, [partnerId]);
  // Товари відкритої закупівлі = товари її замовлень клієнтів (без скасованих). Порожня — видаляється.
  async function rebuildOpen(supplyId) {
    const s = await db.get(`SELECT id, status FROM b2b_orders WHERE id = ?`, [supplyId]);
    if (!s || s.status !== 'open') return;
    const rows = await db.all(
      `SELECT i.product_id, MAX(i.name) AS name, MAX(i.article) AS article, i.price, MAX(i.rrp) AS rrp, SUM(i.qty) AS qty
       FROM b2b_order_items i JOIN b2b_orders co ON co.id = i.order_id
       WHERE co.supply_id = ? AND co.kind = 'client' AND co.status != 'cancelled' GROUP BY i.product_id, i.price ORDER BY MIN(i.id)`, [s.id],
    );
    if (!rows.length) {
      await db.batch([
        [`DELETE FROM b2b_order_items WHERE order_id = ?`, [s.id]], [`DELETE FROM b2b_order_log WHERE order_id = ?`, [s.id]],
        [`UPDATE b2b_orders SET supply_id = NULL WHERE supply_id = ?`, [s.id]], [`DELETE FROM b2b_orders WHERE id = ?`, [s.id]],
      ]);
      return;
    }
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [s.id]],
      ...itemRows(s.id, rows),
      [`UPDATE b2b_orders SET total = ?, updated_at = ? WHERE id = ?`, [totalOf(rows), nowIso(), s.id]],
    ]);
  }

  app.get('/api/b2b/p/limits', async (c) => {
    const p = await myPartner(c);
    const lim = limitsOf(p);
    const open = await getOpen(p.id);
    const cnt = open ? (await db.get(`SELECT COUNT(*) AS n FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled'`, [open.id])).n : 0;
    return c.json({
      open: { id: open?.id || null, number: open ? orderNo(open.id) : '', total: open?.total || 0, limit: lim.open, orders: cnt },
      unpaid: { total: await unpaidTotal(p.id), limit: lim.unpaid },
      postpay: await postpayInfo(p),
      debt: await debtOf(p.id),
      paused: p.paused ? { note: p.pause_note || '' } : null,
    });
  });

  // «Сформувати рахунок»: відкрита закупівля → звичайна («Очікує рахунок») на обрану юрособу.
  app.post('/api/b2b/p/open/form', async (c) => {
    const p = await myPartner(c);
    const open = await getOpen(p.id);
    if (!open) throw fail(400, 'Відкритої закупівлі немає.');
    const b = await c.req.json();
    const e = await myEntity(p, b.entity_id);
    const now = nowIso();
    await db.run(`UPDATE b2b_orders SET status = 'invoice_wait', entity_id = ?, entity = ?, comment = ?, updated_at = ? WHERE id = ?`,
      [e.id, entityText(e), String(b.comment || '').trim().slice(0, 1000), now, open.id]);
    await log(open.id, c.get('user'), `сформовано рахунок на відкриту закупівлю: ${uah(open.total)}, юрособа ${e.name}`);
    const items = await db.all(`SELECT product_id, name, article, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [open.id]);
    const full = orderText('🆕 Сформовано закупівлю (з замовлень клієнтів)', { id: open.id, entity: entityText(e), total: open.total, comment: b.comment }, p, items);
    await tgAdmins(`${full}\n\n${link(c, `b2borders/${open.id}`)}`);
    await tgGroup(p.id, full);
    await hooks.finRequest?.(open.id).catch(() => 0);
    return c.json({ ok: true, id: open.id, number: orderNo(open.id) });
  });

  async function orderOf(id, partnerId = null) {
    const o = await db.get(`SELECT * FROM b2b_orders WHERE id = ? ${partnerId ? 'AND partner_id = ?' : ''}`, partnerId ? [id, partnerId] : [id]);
    if (!o) throw fail(404, 'Замовлення не знайдено.');
    return o;
  }
  const publicOrder = (o) => {
    const out = { ...o, number: orderNo(o.id), status_name: ANY_STATUS[o.status] || o.status };
    if (o.kind === 'supply') { out.delivery = deliveryOf(o.delivery); out.delivery_name = DELIVERY[out.delivery]; }
    if (o.kind === 'supply' && ['partial', 'pay_wait'].includes(o.status)) out.due = round2(o.total - (o.paid_amount || 0));
    if (o.kind === 'supply' && o.status === 'partial') out.status_name = `Частково оплачено · ще ${uah(out.due)}`;
    if (o.kind === 'supply' && o.closed) { out.closed = true; out.status_name = `${out.status_name} · Закрито`; }
    if (o.kind === 'supply') {
      out.pay_terms = o.pay_terms === 'postpay' ? 'postpay' : 'prepay';
      out.overdue = overdueDays(o);
      if (out.overdue) out.status_name = `${out.status_name} · прострочено ${out.overdue} дн.`;
    }
    if (o.kind === 'client') {
      let pend = null;
      if (o.pending) { try { const x = JSON.parse(o.pending); pend = { changes: x.changes || [], by: x.by || '', at: x.at || '', crm_old: x.crm_old || '' }; } catch { pend = { changes: [] }; } }
      out.pending = pend;
    }
    if (o.kind === 'client') Object.assign(out, { no_supply: !o.supply_id || o.supply_status === 'open', open_supply: o.supply_status === 'open', pay: payState(o), pay_name: PAY_NAME[payState(o)], supply_number: o.supply_id ? orderNo(o.supply_id) : '' });
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
      db.all(`SELECT f.id, f.kind, f.name, f.mime, f.size, f.created_by, f.created_at, f.doc_type, t.name AS doc_name
        FROM b2b_files f LEFT JOIN b2b_doc_types t ON t.id = f.doc_type WHERE f.order_id = ? ORDER BY f.id`, [o.id]),
      db.all(`SELECT at, user_name, action FROM b2b_order_log WHERE order_id = ? ORDER BY id DESC LIMIT 100`, [o.id]),
      o.kind === 'supply' ? db.all(`SELECT id, status, client_name, total, created_at FROM b2b_orders WHERE supply_id = ? AND kind = 'client' ORDER BY id DESC`, [o.id]) : [],
    ]);
    const out = { order: publicOrder(o), items, files: files.map((f) => ({ ...f, kind_name: f.doc_name || FILE_KIND[f.kind] || f.kind })), history };
    if (o.kind === 'supply') {
      out.clients = clients.map((x) => ({ ...x, number: orderNo(x.id), status_name: CLIENT_STATUS[x.status] || x.status }));
      out.left = clients.length ? await supplyLeft(o.id) : items.map((i) => ({ ...i, used: 0, left: i.qty }));
      if (!['open', 'cancelled'].includes(o.status) && out.left.length && out.left.every((l) => l.left <= 0)) out.order = publicOrder({ ...o, closed: 1 });
    }
    return out;
  }

  app.get('/api/b2b/p/orders', async (c) => {
    const p = await myPartner(c);
    const f = listFilter(c);
    const st = c.req.query('status');
    if (st === 'closed') f.where.push(CLOSED_SQL);
    else if (st && ORDER_STATUS[st]) { f.where.push('o.status = ?'); f.params.push(st); }
    const rows = await db.all(
      `SELECT o.*, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files, ${CLOSED_SQL} AS closed FROM b2b_orders o
       WHERE o.partner_id = ? AND o.kind = 'supply' ${f.where.map((w) => `AND ${w}`).join(' ')} ORDER BY o.id DESC LIMIT 300`, [p.id, ...f.params],
    );
    return c.json({ rows: rows.map(publicOrder), statuses: LIST_STATUSES });
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
    if (!['invoice_wait', 'draft'].includes(o.status)) throw fail(400, 'Рахунок уже виставлено — змінити замовлення може лише менеджер.');
    const isDraft = o.status === 'draft';
    const b = await c.req.json();
    const e = await myEntity(p, b.entity_id ?? o.entity_id);
    const items = await priceItems(p, b.items);
    const total = totalOf(items);
    const terms = termsOf(b, o);
    if (terms === 'postpay' && !(Number(p.postpay_days) > 0)) throw fail(403, 'Відстрочку оплати вам ще не відкрито — зверніться до менеджера.');
    if (!isDraft) await checkTerms(p, terms, total, o.id);
    const payDays = terms === 'postpay' ? (o.pay_terms === 'postpay' && o.pay_days ? o.pay_days : Number(p.postpay_days)) : 0;
    // Не менше, ніж уже розписано на замовлення клієнтів.
    const want = new Map(items.map((i) => [i.product_id, i.qty]));
    const left = await supplyLeft(o.id);
    for (const r of left) {
      if (r.used > (want.get(r.product_id) || 0)) throw fail(400, `«${r.name}»: на замовлення клієнтів уже розписано ${r.used} шт. — менше зменшити не можна.`);
    }
    const delivery = b.delivery === undefined ? deliveryOf(o.delivery) : deliveryOf(b.delivery);
    if (delivery === 'pickup' && left.some((r) => r.used > 0)) throw fail(400, 'З цієї закупівлі вже є замовлення клієнтів — самовивіз неможливий.');
    await db.batch([
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      ...itemRows(o.id, items),
      [`UPDATE b2b_orders SET entity_id = ?, entity = ?, total = ?, comment = ?, delivery = ?, pay_terms = ?, pay_days = ?, updated_at = ? WHERE id = ?`,
        [e.id, entityText(e), total, String(b.comment ?? o.comment ?? '').trim().slice(0, 1000), delivery, terms, payDays, nowIso(), o.id]],
    ]);
    await log(o.id, c.get('user'), `змінено ${isDraft ? 'чернетку' : 'замовлення'}: ${items.length} поз., ${uah(total)}`);
    if (isDraft) return c.json({ ok: true, total });
    const full = orderText('✏️ Змінено закупівлю', { id: o.id, entity: entityText(e), total, comment: b.comment ?? o.comment, delivery, pay_terms: terms, pay_days: payDays }, p, items);
    await tgAdmins(`${full}\n\n${link(c, `b2borders/${o.id}`)}`);
    await hooks.finRequest?.(o.id, 'changed').catch(() => 0);
    return c.json({ ok: true, total });
  });

  // Чернетку відправляє керівник партнера або наш адмін: тепер це звичайна закупівля («Очікує рахунок»), з усіма сповіщеннями.
  app.post('/api/b2b/p/orders/:id/send', async (c) => {
    const p = await myPartner(c);
    if (!isHead(c)) throw fail(403, 'Відправити закупівлю може лише керівник вашої команди.');
    return c.json(await sendDraft(c, p, await orderOf(c.req.param('id'), p.id)));
  });
  app.post('/api/b2b/orders/:id/send', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    const p = await db.get(`SELECT * FROM b2b_partners WHERE id = ?`, [o.partner_id]);
    return c.json(await sendDraft(c, p, o));
  });
  async function sendDraft(c, p, o) {
    if (o.kind !== 'supply' || o.status !== 'draft') throw fail(400, 'Це не чернетка — її вже відправлено.');
    const items = await db.all(`SELECT product_id, name, article, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    if (!items.length) throw fail(400, 'Чернетка порожня — додайте товари.');
    const e = await myEntity(p, o.entity_id).catch(() => { throw fail(400, 'Юрособу чернетки видалено — оберіть іншу («Змінити»).'); });
    await checkTerms(p, o.pay_terms === 'postpay' ? 'postpay' : 'prepay', o.total, o.id);
    const claim = await db.run(`UPDATE b2b_orders SET status = 'invoice_wait', entity = ?, created_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`, [entityText(e), nowIso(), nowIso(), o.id]);
    if (!claim.changes) throw fail(409, 'Чернетку вже відправлено.');
    await log(o.id, c.get('user'), `відправлено закупівлю: ${uah(o.total)}`);
    const full = orderText('🆕 Нова закупівля', { id: o.id, entity: entityText(e), total: o.total, comment: o.comment, delivery: o.delivery, pay_terms: o.pay_terms, pay_days: o.pay_days }, p, items);
    await tgAdmins(`${full}\n\n${link(c, `b2borders/${o.id}`)}`);
    await tgGroup(p.id, full);
    await hooks.finRequest?.(o.id).catch(() => 0);
    return { ok: true, id: o.id, number: orderNo(o.id) };
  }

  app.post('/api/b2b/p/orders/:id/cancel', async (c) => {
    const p = await myPartner(c);
    const o = await orderOf(c.req.param('id'), p.id);
    if (o.kind !== 'supply') throw fail(404, 'Замовлення не знайдено.');
    if (o.status === 'draft') { // чернетку — видаляємо (у кошик: видно, хто видалив)
      await hooks.toTrash(o, c.get('user'), { byPartner: true });
      return c.json({ ok: true, deleted: true });
    }
    if (o.status !== 'invoice_wait') throw fail(400, 'Рахунок уже виставлено — скасувати замовлення може лише менеджер.');
    if (Number(o.paid_amount) > 0) throw fail(400, 'За закупівлею вже є оплата — скасувати її може лише менеджер.');
    if (await db.get(`SELECT id FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled' LIMIT 1`, [o.id])) {
      throw fail(400, 'З цієї закупівлі вже є замовлення клієнтів — спершу скасуйте їх.');
    }
    await db.run(`UPDATE b2b_orders SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    await log(o.id, c.get('user'), 'партнер скасував замовлення');
    await tgAdmins(`❌ <b>Скасовано закупівлю ${orderNo(o.id)}</b> («${h(p.name)}»)\n${link(c, `b2borders/${o.id}`)}`);
    await hooks.finClosed?.(o.id, '❌ скасовано партнером').catch(() => 0);
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
    if (st === 'closed') where.push(CLOSED_SQL);
    else if (st && ORDER_STATUS[st]) { where.push('o.status = ?'); params.push(st); }
    if (st !== 'draft') where.push(`o.status != 'draft'`); // чернетки партнерів — лише у фільтрі «Чернетка»
    if (pid) { where.push('o.partner_id = ?'); params.push(pid); }
    const rows = await db.all(
      `SELECT o.*, p.name AS partner, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = o.id) AS files, ${CLOSED_SQL} AS closed
       FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 300`, params,
    );
    const [counts, closed] = await Promise.all([
      db.all(`SELECT status, COUNT(*) AS n FROM b2b_orders WHERE kind = 'supply' GROUP BY status`),
      // «Закрито» — лише серед закупівель за пів року (щоб лічильник не переглядав усю історію при кожному відкритті списку).
      db.get(`SELECT COUNT(*) AS n FROM b2b_orders o WHERE o.kind = 'supply' AND o.created_at > ? AND ${CLOSED_SQL}`, [new Date(Date.now() - 183 * 86400000).toISOString()]),
    ]);
    return c.json({ rows: rows.map(publicOrder), statuses: LIST_STATUSES, counts: { ...Object.fromEntries(counts.map((r) => [r.status, r.n])), closed: closed?.n || 0 } });
  });

  app.get('/api/b2b/orders/:id', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    const p = await db.get(`SELECT id, name, phone, email FROM b2b_partners WHERE id = ?`, [o.partner_id]);
    const missing = o.kind === 'client' && o.status === 'new' ? await hooks.missingDocs?.(o) || [] : [];
    return c.json({ ...(await orderDetail(o)), partner: p, missing });
  });

  // Бухгалтер вносить номер рахунку (і накладної): «Очікує рахунок» → «Очікує оплату».
  app.put('/api/b2b/orders/:id', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.status === 'cancelled') throw fail(400, 'Замовлення скасовано.');
    const b = await c.req.json();
    const status = await applyNumbers(o, b, c.get('user'), c);
    return c.json({ ok: true, status });
  });

  // № і дата рахунку, № накладної (з сайту або з Telegram-бота): статус закупівлі, історія, сповіщення партнеру.
  async function applyNumbers(o, b, user, c, how = '') {
    const next = {
      invoice_no: b.invoice_no !== undefined ? String(b.invoice_no).trim().slice(0, 40) : o.invoice_no,
      invoice_date: b.invoice_date !== undefined ? String(b.invoice_date).trim().slice(0, 10) : o.invoice_date,
      waybill_no: b.waybill_no !== undefined ? String(b.waybill_no).trim().slice(0, 40) : o.waybill_no,
    };
    if (next.invoice_date && !/^\d{4}-\d{2}-\d{2}$/.test(next.invoice_date)) throw fail(400, 'Дата рахунку — у форматі РРРР-ММ-ДД.');
    let status = o.status;
    // Новий рахунок: статус за вже отриманою оплатою (після зміни закупівлі оплата лишається).
    const paid = Number(o.paid_amount) || 0;
    if (o.kind === 'supply' && next.invoice_no && status === 'invoice_wait') status = paid > 0 && paid >= o.total - 0.004 ? 'paid' : paid > 0 ? 'partial' : 'pay_wait';
    if (o.kind === 'supply' && !next.invoice_no && status === 'pay_wait') status = 'invoice_wait';
    // Відстрочка: строк оплати — від дати рахунку (або від сьогодні) + днів, зафіксованих у закупівлі.
    const dueDate = o.pay_terms === 'postpay' && next.invoice_no ? addDaysTo(next.invoice_date || today(), Number(o.pay_days) || 0) : (o.due_date || '');
    const reinvoice = next.invoice_no && next.invoice_no !== o.invoice_no ? '' : (o.reinvoice || '');
    await db.run(`UPDATE b2b_orders SET invoice_no = ?, invoice_date = ?, waybill_no = ?, status = ?, due_date = ?, reinvoice = ?, updated_at = ? WHERE id = ?`,
      [next.invoice_no, next.invoice_date, next.waybill_no, status, dueDate, reinvoice, nowIso(), o.id]);
    if (o.reinvoice && !reinvoice) await log(o.id, user, `рахунок перевиставлено: № ${next.invoice_no} замість ${o.reinvoice}`);
    if (o.reinvoice && !reinvoice && status === 'paid') await hooks.finPaid?.(o.id).catch(() => 0);
    if (dueDate && dueDate !== o.due_date) await log(o.id, user, `строк оплати (відстрочка): до ${dueDate.split('-').reverse().join('.')}`);
    const changes = [];
    if (next.invoice_no !== o.invoice_no) changes.push(`рахунок № ${next.invoice_no || '—'}${next.invoice_date ? ` від ${next.invoice_date}` : ''}`);
    if (next.waybill_no !== o.waybill_no) changes.push(`накладна № ${next.waybill_no || '—'}`);
    if (changes.length) await log(o.id, user, `${changes.join('; ')}${how}`);
    if (next.invoice_no !== o.invoice_no || next.waybill_no !== o.waybill_no) await hooks.finNumbers?.(o.id, how).catch(() => 0);
    if (next.invoice_no && next.invoice_no !== o.invoice_no) {
      await tgPartner(o.partner_id, `🧾 <b>Рахунок № ${h(next.invoice_no)}</b> на ${o.kind === 'client' ? 'замовлення' : 'закупівлю'} ${orderNo(o.id)} — <b>${uah(o.total)}</b>\nОчікує оплату. Файл рахунку — у кабінеті партнера.\n${link(c, `${o.kind === 'client' ? 'pclients' : 'porders'}/${o.id}`)}`);
    }
    return status;
  }

  // Адмін змінює спосіб отримання (партнер помилився): самовивіз — лише якщо з закупівлі ще немає замовлень клієнтів.
  app.post('/api/b2b/orders/:id/delivery', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind !== 'supply' || o.status === 'open') throw fail(400, 'Спосіб отримання — лише для звичайної закупівлі.');
    const { delivery } = await c.req.json();
    if (!DELIVERY[delivery]) throw fail(400, 'Невідомий спосіб отримання.');
    if (delivery === deliveryOf(o.delivery)) return c.json({ ok: true });
    if (delivery === 'pickup' && await db.get(`SELECT id FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled' LIMIT 1`, [o.id])) {
      throw fail(400, 'З цієї закупівлі вже є замовлення клієнтів — спершу скасуйте їх, потім ставте самовивіз.');
    }
    await db.run(`UPDATE b2b_orders SET delivery = ?, updated_at = ? WHERE id = ?`, [delivery, nowIso(), o.id]);
    await log(o.id, c.get('user'), `спосіб отримання: «${DELIVERY[delivery]}» (змінив менеджер)`);
    await tgPartner(o.partner_id, `🔁 Закупівля ${orderNo(o.id)}: спосіб отримання змінено на «${DELIVERY[delivery]}».\n${link(c, `porders/${o.id}`)}`);
    return c.json({ ok: true });
  });

  // Ручна зміна статусу: «Оплачено» (якщо Opendatabot не побачив оплату), «Завершено», «Скасовано», повернути «Очікує оплату».
  app.post('/api/b2b/orders/:id/status', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind !== 'supply') throw fail(400, 'Статус замовлення клієнта змінюється на його сторінці.');
    const { status } = await c.req.json();
    if (!['paid', 'done', 'cancelled', 'pay_wait'].includes(status)) throw fail(400, 'Невідомий статус.');
    if (o.status === 'open') throw fail(400, 'Це відкрита закупівля: вона складається із замовлень клієнтів. Спершу партнер формує на неї рахунок.');
    if (status === 'pay_wait' && !o.invoice_no) throw fail(400, 'Спершу внесіть номер рахунку.');
    if (status === 'paid' && !o.invoice_no) throw fail(400, 'Спершу внесіть номер рахунку.');
    const u = c.get('user');
    const now = nowIso();
    if (status === 'paid') {
      await db.run(`UPDATE b2b_orders SET status = 'paid', paid_amount = total, paid_at = ?, paid_by = ?, updated_at = ? WHERE id = ?`, [now, userName(u), now, o.id]);
      await log(o.id, u, 'позначено «Оплачено» вручну');
      await tgPartner(o.partner_id, `✅ <b>Оплату отримано</b>: закупівля ${orderNo(o.id)}${o.invoice_no ? `, рахунок № ${h(o.invoice_no)}` : ''} — ${uah(o.total)}`);
      await hooks.finPaid?.(o.id).catch(() => 0); // запит накладної в «Фінансові питання»
      await hooks.crmPaid?.(o.id, new URL(c.req.url).origin).catch(() => 0); // замовлення вже в CRM — підказка адмінам
    } else if (status === 'pay_wait') {
      // Повернути «Очікує оплату» (або зняти часткову оплату): платежі Opendatabot відв'язуються.
      if (!['paid', 'partial'].includes(o.status)) throw fail(400, 'Закупівля й так очікує оплату.');
      await hooks.payReset?.(o.id);
      await db.run(`UPDATE b2b_orders SET status = 'pay_wait', paid_amount = 0, paid_at = '', paid_by = '', updated_at = ? WHERE id = ?`, [now, o.id]);
      await log(o.id, u, o.status === 'partial' ? 'знято часткову оплату — «Очікує оплату»' : 'статус: «Очікує оплату» (оплату знято)');
    } else {
      await db.run(`UPDATE b2b_orders SET status = ?, updated_at = ? WHERE id = ?`, [status, now, o.id]);
      await log(o.id, u, `статус: «${ORDER_STATUS[status]}»`);
      if (status === 'cancelled') {
        await tgPartner(o.partner_id, `❌ Закупівлю ${orderNo(o.id)} скасовано менеджером.`);
        await hooks.finClosed?.(o.id, '❌ скасовано').catch(() => 0);
      }
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
    if (kind === 'label') { const r = await hooks.afterLabel?.(o, f, c.get('user')); return c.json({ id: f.id, warnings: r?.warnings || [] }); }
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

  async function saveFile(c, o, kind, bytes = null, extra = {}) {
    bytes = bytes || new Uint8Array(await c.req.arrayBuffer());
    let name = 'file';
    try { name = decodeURIComponent(c.req.header('x-file-name') || 'file'); } catch { /* */ }
    return storeFile(o, kind, { bytes, name, mime: c.req.header('content-type'), ...extra }, c.get('user'));
  }

  // Маркування: відбиток файлу (SHA-256) і ТТН з етикетки Нової пошти — щоб те саме маркування не потрапило у два замовлення.
  async function labelInfo(bytes) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
    let np = null;
    if (bytes[0] === 0x25 && bytes[1] === 0x50) np = parseNpLabel(await pdfText(bytes).catch(() => '')); // %P — PDF
    return { hash, ttn: np?.ttn || '', np };
  }
  // Інше (не скасоване) замовлення клієнта з цим маркуванням: той самий файл, ТТН у файлі маркування або ТТН замовлення.
  // Лише за індексами (відбиток файлу, ТТН у файлі, ТТН замовлення) — без перегляду всіх замовлень.
  async function labelDup({ hash, ttn }, exceptId = 0) {
    if (!hash && !ttn) return null;
    const row = await db.get(
      `SELECT o.id, o.client_name FROM b2b_orders o WHERE o.id IN (
         SELECT f.order_id FROM b2b_files f WHERE ? != '' AND f.hash = ? AND f.kind = 'label'
         UNION SELECT f.order_id FROM b2b_files f WHERE ? != '' AND f.ttn = ? AND f.kind = 'label'
         UNION SELECT x.id FROM b2b_orders x WHERE ? != '' AND x.ttn = ?)
       AND +o.kind = 'client' AND o.status != 'cancelled' AND o.id != ? ORDER BY o.id LIMIT 1`,
      [hash || '', hash || '', ttn || '', ttn || '', ttn || '', ttn || '', exceptId],
    );
    return row ? { id: row.id, number: orderNo(row.id), client_name: row.client_name } : null;
  }
  const dupText = (d) => `Таке маркування вже є в замовленні ${d.number} (${d.client_name}) — те саме маркування двічі додати не можна.`;

  // Зберегти файл у замовленні (частинами в D1). user — користувач сайту або { name } для Telegram.
  async function storeFile(o, kind, { bytes, name, mime, hash = '', ttn = '' }, u, how = '') {
    if (!bytes?.length) throw fail(400, 'Порожній файл.');
    if (bytes.length > MAX_FILE) throw fail(400, 'Файл завеликий (до 5 МБ).');
    name = String(name || 'file').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 150) || 'file';
    mime = String(mime || 'application/octet-stream').slice(0, 100);
    const parts = Math.ceil(bytes.length / PART);
    const r = await db.run(`INSERT INTO b2b_files (order_id, kind, name, mime, size, parts, created_by, created_at, hash, ttn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o.id, kind, name, mime, bytes.length, parts, userName(u), nowIso(), hash, ttn]);
    const st = [];
    for (let n = 0; n < parts; n++) st.push([`INSERT INTO b2b_file_parts (file_id, n, data) VALUES (?, ?, ?)`, [r.lastId, n, toB64(bytes.subarray(n * PART, (n + 1) * PART))]]);
    await db.batch(st);
    await log(o.id, u, `додано файл: ${FILE_KIND[kind]} «${name}»${how}`);
    // Після зміни закупівлі новий рахунок (накладна) замінює старі файли того ж виду.
    if (['invoice', 'waybill'].includes(kind) && o.reinvoiced_at) {
      const old = await db.all(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = ? AND created_at < ? AND id != ?`, [o.id, kind, o.reinvoiced_at, r.lastId]);
      for (const f of old) await deleteFile(f.id);
      if (old.length) await log(o.id, u, `старий файл (${FILE_KIND[kind].toLowerCase()}) замінено новим`);
    }
    return { id: r.lastId, bytes, name, mime };
  }
  async function deleteFile(fileId) {
    await db.batch([[`DELETE FROM b2b_file_parts WHERE file_id = ?`, [fileId]], [`DELETE FROM b2b_files WHERE id = ?`, [fileId]]]);
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

  // Маркування партнера для сторінки накладної (менеджери, що друкують): останній файл маркування замовлення клієнта.
  app.get('/api/b2b/label/:id', async (c) => {
    need(c, 'docs.view');
    const f = await db.get(`SELECT f.* FROM b2b_files f JOIN b2b_orders o ON o.id = f.order_id WHERE f.order_id = ? AND f.kind = 'label' AND o.kind = 'client' ORDER BY f.id DESC LIMIT 1`, [c.req.param('id')]);
    if (!f) throw fail(404, 'Партнер ще не додав маркування (або файл старший за 30 днів).');
    return sendFile(f);
  });
  // Чи замовлення LP-CRM — від B2B-партнера: за «B2B-…» у коментарі (так ми передаємо в CRM), інакше за № / кодом у CRM.
  async function crmOrderInfo({ ids = [], comment = '' } = {}) {
    const m = /B2B-(\d+)\s*·\s*B2B «/.exec(String(comment || ''));
    let o = m ? await db.get(`SELECT * FROM b2b_orders WHERE id = ? AND kind = 'client'`, [Number(m[1])]) : null;
    const list = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))];
    if (!o && list.length) {
      o = await db.get(`SELECT * FROM b2b_orders WHERE kind = 'client' AND id IN (
          SELECT id FROM b2b_orders WHERE crm_id != '' AND crm_id IN (SELECT value FROM json_each(?))
          UNION SELECT id FROM b2b_orders WHERE crm_ext != '' AND crm_ext IN (SELECT value FROM json_each(?))) ORDER BY id DESC LIMIT 1`,
      [JSON.stringify(list), JSON.stringify(list)]);
    }
    if (!o) return null;
    const [p, label] = await Promise.all([
      db.get(`SELECT name FROM b2b_partners WHERE id = ?`, [o.partner_id]),
      db.get(`SELECT id, name, mime, created_at FROM b2b_files WHERE order_id = ? AND kind = 'label' ORDER BY id DESC LIMIT 1`, [o.id]),
    ]);
    return { id: o.id, number: orderNo(o.id), partner: p?.name || '', client_name: o.client_name, ttn: o.ttn || '', status: o.status, label: label || null };
  }

  // Партнер — лише файли своїх замовлень.
  app.get('/api/b2b/p/files/:id', async (c) => {
    const p = await myPartner(c);
    const f = await db.get(`SELECT f.* FROM b2b_files f JOIN b2b_orders o ON o.id = f.order_id WHERE f.id = ? AND o.partner_id = ?`, [c.req.param('id'), p.id]);
    if (!f) throw fail(404, 'Файл не знайдено (зберігаються 30 днів).');
    return sendFile(f);
  });

  // Видалення замовлень і кошик — у edits.js.

  return { crmOrderInfo, entityText, myEntity, orderText, deliveryOf, DELIVERY, debtOf, postpayInfo, overdueDays, labelInfo, labelDup, dupText, getOpen, rebuildOpen, unpaidTotal, limitsOf, applyNumbers, storeFile, deleteFile, groupOf, FILE_KIND, ORDER_STATUS, priceItems, totalOf, itemRows, orderOf, orderDetail, publicOrder, supplyLeft, saveFile, log, tgAdmins, tgPartner, tgGroup, link, uah, h };
}
