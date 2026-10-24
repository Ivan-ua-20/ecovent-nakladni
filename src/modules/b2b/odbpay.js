// Оплата закупівель B2B з Opendatabot.
// Новий платіж (не прив'язаний до наших посилань на оплату) → шукаємо закупівлю «Очікує оплату» / «Частково оплачено»
// юрособи з тим самим кодом (ЄДРПОУ / ІПН), що й у платника; номер рахунку в призначенні платежу — уточнення.
// Одна закупівля і сума не більша за залишок → зараховуємо: «Оплачено» або «Частково оплачено» (з залишком).
// Не зрозуміло, яка закупівля, або сума більша за залишок → нічого не змінюємо: «перевірити» в «Платежах» і на сторінці
// закупівлі, адмінам — повідомлення. Адмін може прив'язати платіж вручну, відв'язати помилковий або позначити «Оплачено».
import { fail, need, nowIso, round2 } from '../../core/common.js';
import { orderNo } from './orders.js';

const DUE_EPS = 1; // гривня похибки (копійки, округлення банку)
const userName = (u) => u?.name || u?.login || '';
// Номер рахунку в призначенні платежу: «СФ-000123», «№123», «рах. 123» — порівнюємо цифри як окреме число.
export function purposeHasNo(purpose, invoiceNo) {
  const digits = String(invoiceNo || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return false;
  return [...String(purpose || '').matchAll(/\d+/g)].some((m) => m[0].replace(/^0+/, '') === digits);
}

export function mountB2bPay(app, { db, services, orders, hooks }) {
  const { log, tgAdmins, tgPartner, link, uah, h } = orders;

  // Кандидати: закупівлі, що чекають оплату, юрособи з кодом платника.
  const candidatesFor = (code) => db.all(
    `SELECT o.id, o.partner_id, o.total, o.paid_amount, o.invoice_no, o.status FROM b2b_orders o JOIN b2b_entities e ON e.id = o.entity_id
     WHERE o.kind = 'supply' AND o.status IN ('pay_wait', 'partial') AND e.code = ? ORDER BY o.id`, [code],
  );
  const due = (o) => round2(o.total - o.paid_amount);

  // Перерахунок оплати закупівлі за прив'язаними платежами: статус, сума, сповіщення.
  async function recalc(orderId, base, user = null) {
    const o = await db.get(`SELECT * FROM b2b_orders WHERE id = ?`, [orderId]);
    if (!o || o.kind !== 'supply' || ['cancelled', 'done', 'open'].includes(o.status)) return;
    if (o.status === 'paid' && o.paid_by !== 'Opendatabot') return; // «Оплачено» вручну — не чіпаємо
    const s = await db.get(`SELECT COALESCE(SUM(amount), 0) AS sum, MAX(date) AS at FROM b2b_payments WHERE order_id = ?`, [o.id]);
    const sum = round2(s.sum);
    const status = sum > 0 && sum >= o.total - DUE_EPS ? 'paid' : sum > 0 ? 'partial' : o.invoice_no ? 'pay_wait' : 'invoice_wait';
    await db.run(`UPDATE b2b_orders SET paid_amount = ?, paid_at = ?, paid_by = ?, status = ?, updated_at = ? WHERE id = ?`,
      [sum, sum ? s.at : '', sum ? 'Opendatabot' : '', status, nowIso(), o.id]);
    if (status === o.status && sum === round2(o.paid_amount)) return;
    const who = user ? ` (${userName(user)})` : ' (Opendatabot)';
    const url = (hash) => (base ? `\n${link(base, hash)}` : '');
    if (status === 'paid') {
      await log(o.id, user, `оплачено: ${uah(sum)}${user ? '' : ' — Opendatabot'}`);
      await tgPartner(o.partner_id, `✅ <b>Оплату отримано</b>: закупівля ${orderNo(o.id)}${o.invoice_no ? `, рахунок № ${h(o.invoice_no)}` : ''} — ${uah(o.total)}${url(`porders/${o.id}`)}`);
      await tgAdmins(`✅ <b>Оплачено</b>${who}: закупівля ${orderNo(o.id)} — ${uah(sum)}${url(`b2borders/${o.id}`)}`);
      if (o.status !== 'paid') await hooks.finPaid?.(o.id).catch(() => 0);
    } else if (status === 'partial') {
      const left = round2(o.total - sum);
      await log(o.id, user, `частково оплачено: ${uah(sum)} з ${uah(o.total)}, залишок ${uah(left)}`);
      await tgPartner(o.partner_id, `💳 <b>Часткова оплата</b>: закупівля ${orderNo(o.id)} — отримано ${uah(sum)} з ${uah(o.total)}.\n<b>Ще до оплати: ${uah(left)}</b>${url(`porders/${o.id}`)}`);
      await tgAdmins(`💳 <b>Частково оплачено</b>${who}: закупівля ${orderNo(o.id)} — ${uah(sum)} з ${uah(o.total)}, залишок ${uah(left)}${url(`b2borders/${o.id}`)}`);
    } else {
      await log(o.id, user, `оплату знято: «${status === 'pay_wait' ? 'Очікує оплату' : 'Очікує рахунок'}»`);
    }
  }

  // Нові платежі з Opendatabot (ids — лише ті, що не прив'язані до наших посилань на оплату).
  async function onPayments(ids, base = '') {
    if (!ids?.length || !services.payments?.txs) return;
    const txs = (await services.payments.txs(ids)).filter((t) => t.currency === 'UAH' && t.amount > 0 && t.payer_code);
    if (!txs.length) return;
    const known = new Set((await db.all(`SELECT tx_id FROM b2b_payments WHERE tx_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(txs.map((t) => t.id))])).map((r) => r.tx_id));
    for (const t of txs) {
      if (known.has(t.id)) continue;
      const cands = await candidatesFor(t.payer_code);
      if (!cands.length) continue; // не платіж за закупівлю
      const byNo = cands.filter((o) => purposeHasNo(t.purpose, o.invoice_no));
      let pool = byNo.length ? byNo : cands;
      if (pool.length > 1) {
        const exact = pool.filter((o) => Math.abs(due(o) - t.amount) <= DUE_EPS);
        if (exact.length === 1) pool = exact;
      }
      const hit = pool.length === 1 && t.amount <= due(pool[0]) + DUE_EPS ? pool[0] : null;
      await db.run(
        `INSERT OR IGNORE INTO b2b_payments (tx_id, order_id, candidates, amount, date, payer_name, payer_code, purpose, auto, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [t.id, hit?.id ?? null, JSON.stringify(hit ? [] : pool.map((o) => o.id)), t.amount, t.date, t.payer_name, t.payer_code, t.purpose, nowIso()],
      );
      if (hit) await recalc(hit.id, base);
      else {
        const why = pool.length > 1 ? `підходить кілька закупівель: ${pool.map((o) => `${orderNo(o.id)} (залишок ${uah(due(o))})`).join(', ')}`
          : `сума більша за залишок ${uah(due(pool[0]))} закупівлі ${orderNo(pool[0].id)}`;
        await tgAdmins(`💳 <b>Платіж за B2B — перевірте</b>: ${uah(t.amount)} від ${h(t.payer_name || t.payer_code)}\n${why}.\nВкажіть закупівлю вручну на її сторінці або в «Платежах».`
          + `${base ? `\n${link(base, `b2borders/${pool[0].id}`)}` : ''}`);
      }
    }
  }

  // Для «Платежів»: які платежі зараховано в закупівлі, які треба перевірити.
  async function payInfo(txIds) {
    if (!txIds.length) return new Map();
    const rows = await db.all(`SELECT tx_id, order_id, candidates, dismissed FROM b2b_payments WHERE tx_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(txIds)]);
    return new Map(rows.map((r) => [r.tx_id, {
      order_id: r.order_id, number: r.order_id ? orderNo(r.order_id) : '',
      check: !r.order_id && !r.dismissed && r.candidates !== '[]', candidates: JSON.parse(r.candidates || '[]'),
    }]));
  }

  // ---------------------------------------------------------------- адмін: платежі закупівлі
  async function supplyOf(c) {
    need(c, 'b2b.admin');
    const o = await db.get(`SELECT o.*, e.code AS entity_code FROM b2b_orders o LEFT JOIN b2b_entities e ON e.id = o.entity_id WHERE o.id = ? AND o.kind = 'supply'`, [c.req.param('id')]);
    if (!o) throw fail(404, 'Закупівлю не знайдено.');
    return o;
  }
  app.get('/api/b2b/orders/:id/payments', async (c) => {
    const o = await supplyOf(c);
    const linked = await db.all(`SELECT tx_id, amount, date, payer_name, payer_code, purpose, auto FROM b2b_payments WHERE order_id = ? ORDER BY date`, [o.id]);
    // Можливі: не зараховані нікуди платежі цього платника (за кодом юрособи) і ті, де ця закупівля серед кандидатів.
    const used = new Set((await db.all(`SELECT tx_id FROM b2b_payments WHERE order_id IS NOT NULL`)).map((r) => r.tx_id));
    const fromOdb = o.entity_code && services.payments?.txByPayer ? await services.payments.txByPayer(o.entity_code, 120) : [];
    const checks = await db.all(`SELECT tx_id AS id, amount, date, payer_name, payer_code, purpose FROM b2b_payments
      WHERE order_id IS NULL AND dismissed = 0 AND EXISTS (SELECT 1 FROM json_each(candidates) j WHERE j.value = ?)`, [o.id]);
    const seen = new Set();
    const possible = [...checks, ...fromOdb].filter((t) => !used.has(t.id) && !seen.has(t.id) && seen.add(t.id))
      .map((t) => ({ tx_id: t.id, amount: t.amount, date: t.date, payer_name: t.payer_name, payer_code: t.payer_code, purpose: t.purpose, hint: purposeHasNo(t.purpose, o.invoice_no) }))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    return c.json({ linked, possible, due: round2(o.total - o.paid_amount), status: o.status });
  });

  // Зарахувати платіж у закупівлю (вручну).
  app.post('/api/b2b/orders/:id/payments', async (c) => {
    const o = await supplyOf(c);
    if (!['pay_wait', 'partial', 'paid'].includes(o.status) || (o.status === 'paid' && o.paid_by !== 'Opendatabot')) {
      throw fail(400, o.status === 'paid' ? 'Закупівлю вже позначено «Оплачено» вручну.' : 'Платіж зараховується в закупівлю з рахунком («Очікує оплату» або «Частково оплачено»).');
    }
    const txId = String((await c.req.json()).tx_id || '');
    const ex = await db.get(`SELECT tx_id, order_id FROM b2b_payments WHERE tx_id = ?`, [txId]);
    if (ex?.order_id && ex.order_id !== o.id) throw fail(400, `Цей платіж уже зараховано в ${orderNo(ex.order_id)} — спершу відв'яжіть його там.`);
    if (ex) await db.run(`UPDATE b2b_payments SET order_id = ?, dismissed = 0, auto = 0, created_by = ? WHERE tx_id = ?`, [o.id, userName(c.get('user')), txId]);
    else {
      const [t] = services.payments?.txs ? await services.payments.txs([txId]) : [];
      if (!t) throw fail(404, 'Платіж не знайдено (або він уже прив’язаний до посилання на оплату).');
      await db.run(`INSERT INTO b2b_payments (tx_id, order_id, candidates, amount, date, payer_name, payer_code, purpose, auto, created_at, created_by) VALUES (?, ?, '[]', ?, ?, ?, ?, ?, 0, ?, ?)`,
        [t.id, o.id, t.amount, t.date, t.payer_name, t.payer_code, t.purpose, nowIso(), userName(c.get('user'))]);
    }
    await log(o.id, c.get('user'), 'зараховано платіж вручну');
    await recalc(o.id, c, c.get('user'));
    return c.json({ ok: true });
  });

  // Відв'язати платіж (Opendatabot помилився): він більше не зараховується автоматично.
  app.delete('/api/b2b/orders/:id/payments/:tx', async (c) => {
    const o = await supplyOf(c);
    const r = await db.run(`UPDATE b2b_payments SET order_id = NULL, dismissed = 1 WHERE tx_id = ? AND order_id = ?`, [c.req.param('tx'), o.id]);
    if (!r.changes) throw fail(404, 'Платіж не прив’язаний до цієї закупівлі.');
    await log(o.id, c.get('user'), 'відв’язано платіж');
    await recalc(o.id, c, c.get('user'));
    return c.json({ ok: true });
  });

  // «Повернути «Очікує оплату»» / зняти часткову оплату: усі платежі закупівлі відв'язуються.
  hooks.payReset = (orderId) => db.run(`UPDATE b2b_payments SET order_id = NULL, dismissed = 1 WHERE order_id = ?`, [orderId]);

  return { onPayments, payInfo, recalc };
}
