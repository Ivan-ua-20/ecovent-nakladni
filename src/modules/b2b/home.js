// Головна B2B: що потребує дій адміністратора (для черги на головній сайту), головна кабінету партнера
// і виписка взаєморозрахунків (рахунки закупівель і оплати з залишком на кожну дату).
import { fail, need, round2, kyivDay, likeVariants } from '../../core/common.js';
import { orderNo, DEBT } from './orders.js';

const today = () => kyivDay();
const dayOf = (v) => String(v || '').slice(0, 10);
// Закупівля з виставленим рахунком (лише такі — у виписці).
const INVOICED = `kind = 'supply' AND invoice_no != '' AND status NOT IN ('cancelled', 'draft', 'confirm', 'open')`;

export function mountB2bHome(app, { db, myPartner, orders }) {
  // ---------- адмін: що чекає дій (коротко, для головної сторінки) ----------
  async function attention() {
    const [st, checks, overdue, clientsNew] = await Promise.all([
      db.all(`SELECT status, COUNT(*) AS n FROM b2b_orders WHERE kind = 'supply' AND status IN ('invoice_wait') GROUP BY status`),
      db.get(`SELECT COUNT(*) AS n FROM b2b_payments WHERE order_id IS NULL AND dismissed = 0 AND candidates != '[]'`),
      db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(total - paid_amount), 0) AS sum FROM b2b_orders WHERE kind = 'supply' AND status IN ${DEBT} AND due_date != '' AND due_date < ?`, [today()]),
      db.get(`SELECT COUNT(*) AS n FROM b2b_orders WHERE kind = 'client' AND status = 'new'`),
    ]);
    const n = (s) => st.find((r) => r.status === s)?.n || 0;
    return [
      { key: 'b2b_invoice', level: 'warn', count: n('invoice_wait'), label: 'Закупівлі партнерів чекають рахунку', link: '#/b2borders' },
      { key: 'b2b_clients', level: 'warn', count: clientsNew?.n || 0, label: 'Замовлення клієнтів партнерів не передані в CRM', link: '#/b2bclients' },
      { key: 'b2b_paycheck', level: 'warn', count: checks?.n || 0, label: 'Платежі B2B: перевірити, в яку закупівлю зарахувати', link: '#/payments' },
      { key: 'b2b_overdue', level: 'bad', count: overdue?.n || 0, label: `Прострочена оплата закупівель${overdue?.n ? ` на ${round2(overdue.sum).toLocaleString('uk-UA')} грн` : ''}`, link: '#/b2bpartners' },
    ].filter((x) => x.count > 0);
  }

  // ---------- партнер: головна кабінету ----------
  app.get('/api/b2b/p/home', async (c) => {
    const p = await myPartner(c);
    const [confirm, drafts, pending, recent, debt, postpay] = await Promise.all([
      db.all(`SELECT id, total, created_at FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status = 'confirm' ORDER BY id DESC LIMIT 20`, [p.id]),
      db.get(`SELECT COUNT(*) AS n FROM b2b_orders WHERE partner_id = ? AND kind = 'supply' AND status = 'draft'`, [p.id]),
      db.all(`SELECT id, client_name FROM b2b_orders WHERE partner_id = ? AND kind = 'client' AND COALESCE(pending, '') != '' ORDER BY id DESC LIMIT 20`, [p.id]),
      db.all(`SELECT id, kind, status, total, client_name, created_at FROM b2b_orders WHERE partner_id = ? AND status NOT IN ('open') ORDER BY id DESC LIMIT 8`, [p.id]),
      orders.debtOf(p.id),
      orders.postpayInfo(p),
    ]);
    const todo = [
      ...confirm.map((o) => ({ text: `Підтвердіть закупівлю ${orderNo(o.id)}, яку підготував менеджер`, link: `#/porders/${o.id}` })),
      ...pending.map((o) => ({ text: `Менеджер змінив замовлення ${orderNo(o.id)} (${o.client_name || 'клієнт'}) — підтвердіть або відхиліть зміни`, link: `#/pclients/${o.id}` })),
      ...(drafts?.n ? [{ text: `Чернетки закупівель: ${drafts.n} — відправте або видаліть`, link: '#/porders' }] : []),
      ...debt.rows.filter((o) => o.overdue).map((o) => ({ text: `Прострочено оплату ${o.number}: ${o.due.toLocaleString('uk-UA')} грн (${o.overdue} дн.)`, link: `#/porders/${o.id}`, bad: true })),
    ];
    const next = debt.rows.filter((o) => o.due_date && !o.overdue).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    return c.json({
      partner: { name: p.name, paused: Boolean(p.paused) },
      todo,
      debt: { total: debt.total, overdue: debt.overdue, next: next ? { number: next.number, id: next.id, due: next.due, due_date: next.due_date } : null },
      postpay: { days: postpay.days, limit: postpay.limit, used: postpay.used },
      recent: recent.map((o) => ({ id: o.id, number: orderNo(o.id), kind: o.kind, status: o.status, total: o.total, client_name: o.client_name || '', created_at: o.created_at })),
    });
  });

  // ---------- виписка взаєморозрахунків ----------
  // Нараховано — рахунки закупівель (за датою рахунку); оплачено — платежі Opendatabot, зараховані в ці закупівлі,
  // і оплати, позначені вручну (різниця між «оплачено» і платежами). Сальдо = нараховано − оплачено.
  async function statement(partnerId, from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw fail(400, 'Вкажіть період: дати «з» і «по».');
    const [sup, pays] = await Promise.all([
      db.all(`SELECT id, invoice_no, invoice_date, created_at, total, paid_amount, paid_at, paid_by, entity FROM b2b_orders WHERE partner_id = ? AND ${INVOICED}`, [partnerId]),
      db.all(`SELECT p.order_id, p.amount, p.date, p.payer_name FROM b2b_payments p JOIN b2b_orders o ON o.id = p.order_id WHERE o.partner_id = ?`, [partnerId]),
    ]);
    const events = [];
    const linked = new Map();
    for (const t of pays) {
      linked.set(t.order_id, round2((linked.get(t.order_id) || 0) + t.amount));
      events.push({ date: dayOf(t.date), kind: 'pay', doc: `Оплата за ${orderNo(t.order_id)}`, payer: t.payer_name || '', credit: round2(t.amount), order_id: t.order_id });
    }
    for (const o of sup) {
      events.push({ date: dayOf(o.invoice_date || o.created_at), kind: 'invoice', doc: `Рахунок № ${o.invoice_no} · ${orderNo(o.id)}`, payer: String(o.entity || '').split('\n')[0], debit: round2(o.total), order_id: o.id });
      const manual = round2((o.paid_amount || 0) - (linked.get(o.id) || 0));
      if (o.paid_by && o.paid_by !== 'Opendatabot' && manual > 0.004) {
        events.push({ date: dayOf(o.paid_at || o.invoice_date), kind: 'manual', doc: `Оплату позначено вручну · ${orderNo(o.id)}`, payer: o.paid_by, credit: manual, order_id: o.id });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'invoice' ? -1 : 1));
    let opening = 0;
    for (const e of events) if (e.date < from) opening = round2(opening + (e.debit || 0) - (e.credit || 0));
    let bal = opening;
    const rows = events.filter((e) => e.date >= from && e.date <= to).map((e) => {
      bal = round2(bal + (e.debit || 0) - (e.credit || 0));
      return { ...e, number: orderNo(e.order_id), balance: bal };
    });
    const sum = (k) => round2(rows.reduce((t, r) => t + (r[k] || 0), 0));
    return { from, to, opening, debit: sum('debit'), credit: sum('credit'), closing: bal, rows };
  }
  app.get('/api/b2b/p/statement', async (c) => {
    const p = await myPartner(c);
    return c.json({ partner: p.name, ...(await statement(p.id, c.req.query('from') || '', c.req.query('to') || '')) });
  });
  app.get('/api/b2b/partners/:id/statement', async (c) => {
    need(c, 'b2b.admin');
    const p = await db.get(`SELECT id, name FROM b2b_partners WHERE id = ?`, [c.req.param('id')]);
    if (!p) throw fail(404, 'Партнера не знайдено.');
    return c.json({ partner: p.name, ...(await statement(p.id, c.req.query('from') || '', c.req.query('to') || '')) });
  });

  // ---------- борг партнерів за віком прострочки (для списку партнерів) ----------
  app.get('/api/b2b/debt-aging', async (c) => {
    need(c, 'b2b.admin');
    const t = today();
    const rows = await db.all(`SELECT o.partner_id, p.name, o.total - o.paid_amount AS due, o.due_date FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id
      WHERE o.kind = 'supply' AND o.status IN ${DEBT} AND COALESCE(p.deleted_at, '') = ''`);
    const days = (d) => (d && d < t ? Math.round((Date.parse(`${t}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / 86400000) : 0);
    const B = [['current', 'Без прострочки', 0, 0], ['d1_7', '1–7 дн.', 1, 7], ['d8_30', '8–30 дн.', 8, 30], ['d30', 'понад 30 дн.', 31, Infinity]];
    const buckets = B.map(([key, label, lo, hi]) => {
      const list = rows.filter((r) => { const n = days(r.due_date); return n >= lo && n <= hi; });
      return { key, label, sum: round2(list.reduce((s, r) => s + r.due, 0)), count: list.length };
    });
    return c.json({ buckets, total: round2(rows.reduce((s, r) => s + r.due, 0)) });
  });

  // ---------- пошук по сайту: закупівлі, замовлення клієнтів (№, клієнт, телефон, ТТН, рахунок), партнери ----------
  async function search(q) {
    const s = String(q || '').trim();
    const digits = s.replace(/\D/g, '');
    const v = likeVariants(s);
    const id = Number((/^(?:b2b-?)?(\d{1,7})$/i.exec(s) || [])[1]) || 0; // «B2B-15» або «15» (у «B2B» теж є цифра)
    const [orders, partners] = await Promise.all([
      db.all(`SELECT o.id, o.kind, o.status, o.total, o.client_name, o.ttn, o.invoice_no, p.name AS partner FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id
        WHERE o.id = ? OR o.invoice_no = ? ${digits.length >= 5 ? 'OR o.ttn LIKE ? OR o.client_phone LIKE ?' : ''} OR ${v.map(() => 'o.client_name LIKE ?').join(' OR ')}
        ORDER BY o.id DESC LIMIT 8`, [id, s, ...(digits.length >= 5 ? [`%${digits}%`, `%${digits.slice(-9)}%`] : []), ...v]),
      db.all(`SELECT id, name FROM b2b_partners WHERE COALESCE(deleted_at, '') = '' AND (${v.map(() => 'name LIKE ?').join(' OR ')}) ORDER BY name LIMIT 5`, v),
    ]);
    return [
      ...partners.map((p) => ({ group: 'B2B партнери', title: p.name, sub: 'картка партнера', link: `#/b2bpartners/${p.id}` })),
      ...orders.map((o) => ({ group: 'B2B', title: `${orderNo(o.id)} · ${o.partner}`,
        sub: [o.kind === 'supply' ? 'закупівля' : `замовлення клієнта${o.client_name ? `: ${o.client_name}` : ''}`, o.invoice_no && `рахунок № ${o.invoice_no}`, o.ttn && `ТТН ${o.ttn}`].filter(Boolean).join(' · '),
        link: `#/${o.kind === 'supply' ? 'b2borders' : 'b2bclients'}/${o.id}` })),
    ];
  }

  return { attention, search };
}
