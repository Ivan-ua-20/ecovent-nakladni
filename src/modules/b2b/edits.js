// Правки наших адмінів у закупівлях партнерів (у будь-якому статусі, крім відкритої й скасованої) і кошик.
// Закупівля з рахунком після зміни знову «Очікує рахунок»: у «Фінансові питання» — «переробіть рахунок № …»,
// новий рахунок (файл) замінює старий і йде в групу партнера; оплата, що вже надійшла, лишається.
// Кошик: видалені закупівлі й замовлення клієнтів (знімок — можна відновити) і прибрані з закупівлі товари;
// видаляють і відновлюють лише адміни, партнер бачить свій кошик (хто й коли видалив).
import { fail, need, nowIso, round2, kyivDay } from '../../core/common.js';
import { logAudit } from '../../core/requisites.js';
import { orderNo, PM_JOIN, PM_COLS } from './orders.js';

const INVOICED = ['pay_wait', 'partial', 'paid', 'done'];
const userName = (u) => u?.name || u?.login || '';
const firstLine = (s) => String(s || '').split('\n')[0];

export function mountB2bEdits(app, { db, orders, hooks, myPartner, partnerPrice }) {
  const { orderOf, supplyLeft, itemRows, totalOf, log, tgPartner, tgGroup, link, uah, h, rebuildOpen, getOpen, entityText } = orders;

  // Товари, видимі партнеру (увімкнені бренди), — для «Додати товар».
  const partnerCatalog = (partnerId) => db.all(
    `SELECT c.product_id, c.name, c.article, c.rrp, ${PM_COLS} FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id ${PM_JOIN}
     WHERE m.partner_id = ? AND c.hidden = 0 AND c.rrp > 0 ORDER BY c.name`, [kyivDay(), partnerId],
  ).then((rows) => rows.map((r) => ({ product_id: r.product_id, name: r.name, article: r.article || '', rrp: r.rrp, price: partnerPrice(r.rrp, r.margin) })));
  hooks.partnerCatalog = partnerCatalog;

  app.get('/api/b2b/orders/:id/edit-options', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    const [catalog, entities, partner] = await Promise.all([
      partnerCatalog(o.partner_id),
      db.all(`SELECT id, name, code FROM b2b_entities WHERE partner_id = ? AND (active = 1 OR id = ?) ORDER BY name`, [o.partner_id, o.entity_id || 0]),
      db.get(`SELECT default_entity, postpay_days FROM b2b_partners WHERE id = ?`, [o.partner_id]),
    ]);
    return c.json({ catalog, entities, default_entity: partner?.default_entity || null, postpay_days: Number(partner?.postpay_days) || 0, invoiced: Boolean(o.invoice_no) && INVOICED.includes(o.status) });
  });

  // ---------------------------------------------------------------- зміна закупівлі адміном
  // items: [{ product_id, qty, price? }] — увесь новий склад (0 або відсутній — прибрати); ціну можна змінити вручну.
  app.put('/api/b2b/orders/:id/edit', async (c) => {
    need(c, 'b2b.admin');
    return c.json(await editSupply(c, await orderOf(c.req.param('id')), await c.req.json()));
  });
  // Додати товари в закупівлю (з правки замовлення клієнта: товару немає в закупівлі або бракує залишку).
  hooks.supplyAdd = async (c, supplyId, add) => {
    const o = await orderOf(supplyId);
    const cur = await db.all(`SELECT product_id, qty FROM b2b_order_items WHERE order_id = ?`, [o.id]);
    const want = new Map(cur.map((i) => [i.product_id, i.qty]));
    for (const [id, n] of add) want.set(id, (want.get(id) || 0) + n);
    return editSupply(c, o, { items: [...want].map(([product_id, qty]) => ({ product_id, qty })) });
  };
  async function editSupply(c, o, b) {
    const u = c.get('user');
    if (o.kind !== 'supply') throw fail(400, 'Це замовлення клієнта — змінюйте його на сторінці замовлення.');
    if (o.status === 'cancelled') throw fail(400, 'Закупівлю скасовано.');
    if (o.status === 'open') throw fail(400, 'Відкрита закупівля складається із замовлень клієнтів — змініть або видаліть їх, і закупівля перерахується сама.');
    const cur = await db.all(`SELECT product_id, name, article, qty, price, rrp FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    const curMap = new Map(cur.map((i) => [i.product_id, i]));
    const want = new Map();
    for (const it of Array.isArray(b.items) ? b.items : []) {
      const id = parseInt(it.product_id, 10);
      const qty = Number(it.qty);
      if (!id) continue;
      if (!Number.isInteger(qty) || qty < 0 || qty > 100000) throw fail(400, 'Кількість — ціле число від 0.');
      const raw = it.price === undefined || it.price === null ? '' : String(it.price).replace(/\s/g, '').replace(',', '.');
      const price = raw === '' ? null : round2(Number(raw));
      if (price !== null && !(price >= 0 && price < 1e8)) throw fail(400, 'Ціна — число від 0.');
      if (qty > 0) want.set(id, { qty: (want.get(id)?.qty || 0) + qty, price: price ?? want.get(id)?.price ?? null });
    }
    if (!want.size) throw fail(400, 'У закупівлі має лишитися хоча б один товар. Щоб прибрати все — видаліть закупівлю.');
    if (want.size > 300) throw fail(400, 'Не більше 300 позицій.');
    const newIds = [...want.keys()].filter((id) => !curMap.has(id));
    const cat = newIds.length ? new Map((await db.all(
      `SELECT c.product_id, c.name, c.article, c.rrp, ${PM_COLS} FROM b2b_catalog c LEFT JOIN b2b_margins m ON m.brand_id = c.brand_id AND m.partner_id = ? ${PM_JOIN}
       WHERE c.product_id IN (SELECT value FROM json_each(?))`, [o.partner_id, kyivDay(), JSON.stringify(newIds)],
    )).map((r) => [r.product_id, r])) : new Map();
    const items = [...want].map(([id, w]) => {
      const old = curMap.get(id);
      if (old) return { product_id: id, name: old.name, article: old.article || '', qty: w.qty, price: w.price ?? old.price, rrp: old.rrp };
      const r = cat.get(id);
      if (!r) throw fail(400, `Товару ID ${id} немає в каталозі.`);
      return { product_id: id, name: r.name, article: r.article || '', qty: w.qty, price: w.price ?? partnerPrice(r.rrp, r.margin || 0), rrp: r.rrp };
    });
    // Не менше, ніж уже розписано на замовлення клієнтів.
    for (const r of await supplyLeft(o.id)) {
      if (r.used > (want.get(r.product_id)?.qty || 0)) throw fail(400, `«${r.name}»: на замовлення клієнтів уже розписано ${r.used} шт. — спершу змініть або видаліть ці замовлення.`);
    }
    let ent = { id: o.entity_id, text: o.entity };
    if (b.entity_id !== undefined && b.entity_id !== null && Number(b.entity_id) !== Number(o.entity_id)) {
      const e = await db.get(`SELECT * FROM b2b_entities WHERE id = ? AND partner_id = ?`, [b.entity_id, o.partner_id]);
      if (!e) throw fail(404, 'Юрособу не знайдено.');
      ent = { id: e.id, text: entityText(e) };
    }
    const comment = b.comment === undefined ? (o.comment || '') : String(b.comment).trim().slice(0, 1000);
    const total = totalOf(items);

    const changes = [];
    for (const i of items) {
      const old = curMap.get(i.product_id);
      if (!old) { changes.push(`+ ${i.name} × ${i.qty} по ${uah(i.price)}`); continue; }
      if (old.qty !== i.qty) changes.push(`${i.name}: ${old.qty} → ${i.qty} шт`);
      if (round2(old.price) !== round2(i.price)) changes.push(`${i.name}: ціна ${uah(old.price)} → ${uah(i.price)}`);
    }
    const removed = cur.filter((i) => !want.has(i.product_id));
    for (const i of removed) changes.push(`− ${i.name} × ${i.qty} (прибрано)`);
    if (ent.id !== o.entity_id) changes.push(`юрособа: ${firstLine(ent.text)}`);
    if (comment !== (o.comment || '')) changes.push('коментар');
    if (!changes.length) return { ok: true, changed: false };

    const invoiced = Boolean(o.invoice_no) && INVOICED.includes(o.status);
    const redo = invoiced ? `${o.invoice_no}${o.waybill_no ? ` (і накладну № ${o.waybill_no})` : ''}` : '';
    const now = nowIso();
    const st = [[`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]], ...itemRows(o.id, items)];
    st.push(invoiced
      ? [`UPDATE b2b_orders SET total = ?, entity_id = ?, entity = ?, comment = ?, status = 'invoice_wait', reinvoice = ?, reinvoiced_at = ?,
          invoice_no = '', invoice_date = '', waybill_no = '', due_date = '', due_notified = '', fin_done = 0, group_done = 0, updated_at = ? WHERE id = ?`,
      [total, ent.id, ent.text, comment, redo, now, now, o.id]]
      : [`UPDATE b2b_orders SET total = ?, entity_id = ?, entity = ?, comment = ?, group_done = 0, updated_at = ? WHERE id = ?`, [total, ent.id, ent.text, comment, now, o.id]]);
    for (const i of removed) {
      st.push([`INSERT INTO b2b_trash (kind, order_id, partner_id, title, total, data, deleted_by, by_partner, deleted_at) VALUES ('item', ?, ?, ?, ?, ?, ?, 0, ?)`,
        [o.id, o.partner_id, `${i.name} × ${i.qty} — із закупівлі ${orderNo(o.id)}`, round2(i.price * i.qty), JSON.stringify(i), userName(u), now]]);
    }
    await db.batch(st);
    await log(o.id, u, `змінив менеджер: ${changes.join('; ')} — разом ${uah(total)}${invoiced ? ` · рахунок № ${redo} треба переробити` : ''}`.slice(0, 1800));

    if (o.status !== 'draft') {
      const lines = changes.slice(0, 20).map(h).join('\n');
      const text = `✏️ <b>Закупівлю ${orderNo(o.id)} змінив менеджер</b>\n${lines}\n<b>Разом: ${uah(total)}</b>`
        + `${invoiced ? `\n\n🔁 Рахунок № ${h(o.invoice_no)} буде перевиставлено — новий рахунок надійде сюди.${Number(o.paid_amount) > 0 ? ` Оплата ${uah(o.paid_amount)} зарахована.` : ''}` : ''}`;
      await tgPartner(o.partner_id, `${text}\n${link(c, `porders/${o.id}`)}`);
      if (invoiced) await tgGroup(o.partner_id, text);
      if (o.status !== 'confirm') await hooks.finRequest?.(o.id, invoiced ? 'reinvoice' : 'changed').catch(() => 0); // ще не підтверджено — рахунок не просимо
    }
    return { ok: true, changed: true, total, reinvoice: invoiced };
  }

  // ---------------------------------------------------------------- кошик
  async function toTrash(o, u, { byPartner = false } = {}) {
    const [items, history] = await Promise.all([
      db.all(`SELECT * FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]),
      db.all(`SELECT * FROM b2b_order_log WHERE order_id = ? ORDER BY id`, [o.id]),
    ]);
    const title = o.kind === 'client' ? `Замовлення клієнта ${orderNo(o.id)} · ${o.client_name || ''}`
      : `${o.status === 'draft' ? 'Чернетка закупівлі' : 'Закупівля'} ${orderNo(o.id)}${o.entity ? ` · ${firstLine(o.entity).split(',')[0]}` : ''}`;
    // Файли лишаються (до 30 днів, як усі) — повернуться при відновленні.
    await db.batch([
      [`INSERT INTO b2b_trash (kind, order_id, partner_id, title, total, data, deleted_by, by_partner, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [o.kind, o.id, o.partner_id, title, o.total || 0, JSON.stringify({ order: o, items, history }), userName(u), byPartner ? 1 : 0, nowIso()]],
      [`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]],
      [`DELETE FROM b2b_order_log WHERE order_id = ?`, [o.id]],
      [`DELETE FROM b2b_orders WHERE id = ?`, [o.id]],
    ]);
  }
  hooks.toTrash = toTrash;

  // Видалити закупівлю або замовлення клієнта (у кошик). Закупівлю з чинними замовленнями клієнтів — ні.
  app.delete('/api/b2b/orders/:id', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind === 'supply') {
      const n = (await db.get(`SELECT COUNT(*) AS n FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled'`, [o.id])).n;
      if (n) throw fail(400, `З цієї закупівлі є замовлення клієнтів (${n}) — спершу видаліть або скасуйте їх.`);
    }
    await toTrash(o, c.get('user'));
    await hooks.finClosed?.(o.id, '🗑 видалено', o).catch(() => 0);
    if (o.kind === 'client' && o.supply_id) await rebuildOpen(o.supply_id);
    if (o.status !== 'draft') {
      await tgPartner(o.partner_id, `🗑 ${o.kind === 'client' ? `Замовлення клієнта ${orderNo(o.id)} (${h(o.client_name)})` : `Закупівлю ${orderNo(o.id)}`} видалив менеджер — його видно в «Кошику».`);
    }
    await logAudit(db, { user: c.get('user'), kind: 'b2b', refId: o.partner_id, action: `видалено в кошик ${o.kind === 'client' ? 'замовлення клієнта' : 'закупівлю'} ${orderNo(o.id)} на ${uah(o.total)}${o.crm_id ? ` (у LP-CRM № ${o.crm_id} — не видалено)` : ''}` }).catch(() => 0);
    return c.json({ ok: true, inCrm: o.crm_id || '' });
  });

  const trashRow = (r, forPartner = false) => ({
    id: r.id, kind: r.kind, order_id: r.order_id, number: r.order_id ? orderNo(r.order_id) : '', title: r.title, total: r.total,
    deleted_by: forPartner && !r.by_partner ? `менеджер ${r.deleted_by}` : r.deleted_by, by_partner: !!r.by_partner, deleted_at: r.deleted_at,
    restored_at: r.restored_at || '', restored_by: r.restored_by || '', partner: r.partner || '', partner_id: r.partner_id,
    can_restore: !forPartner && !r.restored_at && ['supply', 'client'].includes(r.kind),
  });
  app.get('/api/b2b/trash', async (c) => {
    need(c, 'b2b.admin');
    const pid = parseInt(c.req.query('partner'), 10) || 0;
    const rows = await db.all(`SELECT t.id, t.kind, t.order_id, t.partner_id, t.title, t.total, t.deleted_by, t.by_partner, t.deleted_at, t.restored_at, t.restored_by, p.name AS partner
      FROM b2b_trash t LEFT JOIN b2b_partners p ON p.id = t.partner_id ${pid ? 'WHERE t.partner_id = ?' : ''} ORDER BY t.id DESC LIMIT 300`, pid ? [pid] : []);
    return c.json(rows.map((r) => trashRow(r)));
  });
  app.get('/api/b2b/p/trash', async (c) => {
    const p = await myPartner(c);
    const rows = await db.all(`SELECT id, kind, order_id, partner_id, title, total, deleted_by, by_partner, deleted_at, restored_at, restored_by
      FROM b2b_trash WHERE partner_id = ? ORDER BY id DESC LIMIT 300`, [p.id]);
    return c.json(rows.map((r) => trashRow(r, true)));
  });

  // Відновити з кошика. Замовлення клієнта: у свою закупівлю, якщо там вистачає залишку; якщо його закупівлі вже немає
  // або вона була відкритою — у відкриту закупівлю партнера.
  app.post('/api/b2b/trash/:id/restore', async (c) => {
    need(c, 'b2b.admin');
    const u = c.get('user');
    const t = await db.get(`SELECT * FROM b2b_trash WHERE id = ?`, [c.req.param('id')]);
    if (!t) throw fail(404, 'Запис не знайдено.');
    if (t.restored_at) throw fail(400, 'Уже відновлено.');
    if (!['supply', 'client'].includes(t.kind)) throw fail(400, 'Прибраний товар не відновлюється — додайте його в закупівлю знову («Змінити»).');
    const d = JSON.parse(t.data || '{}');
    const o = { ...d.order };
    if (!o.id) throw fail(400, 'Немає даних для відновлення.');
    if (await db.get(`SELECT id FROM b2b_orders WHERE id = ?`, [o.id])) throw fail(409, `${orderNo(o.id)} уже є.`);
    let openId = null;
    if (o.kind === 'client' && o.status !== 'cancelled') {
      const s = o.supply_id ? await db.get(`SELECT id, status FROM b2b_orders WHERE id = ?`, [o.supply_id]) : null;
      if (s && !['open', 'cancelled'].includes(s.status)) {
        const left = new Map((await supplyLeft(s.id)).map((r) => [r.product_id, r.left]));
        for (const i of d.items || []) {
          if ((left.get(i.product_id) ?? 0) < i.qty) throw fail(400, `У закупівлі ${orderNo(s.id)} уже немає залишку «${i.name}» (${i.qty} шт.) — звільніть товар або змініть закупівлю.`);
        }
      } else {
        openId = (await getOpen(o.partner_id))?.id || null;
        if (!openId) {
          const now = nowIso();
          openId = (await db.run(`INSERT INTO b2b_orders (partner_id, kind, status, entity, total, created_by, created_at, updated_at) VALUES (?, 'supply', 'open', '', 0, 'авто', ?, ?)`, [o.partner_id, now, now])).lastId;
          await db.run(`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, 'авто', 'відкрито закупівлю із замовлень клієнтів без закупівлі')`, [openId, now]);
        }
        o.supply_id = openId;
      }
    }
    const cols = Object.keys(o);
    const now = nowIso();
    await db.batch([
      [`INSERT INTO b2b_orders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((k) => o[k])],
      ...(d.items || []).map((i) => [`INSERT INTO b2b_order_items (order_id, product_id, name, article, qty, price, rrp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [o.id, i.product_id, i.name, i.article || '', i.qty, i.price, i.rrp ?? 0]]),
      ...(d.history || []).map((x) => [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`, [o.id, x.at, x.user_name, x.action]]),
      [`INSERT INTO b2b_order_log (order_id, at, user_name, action) VALUES (?, ?, ?, ?)`, [o.id, now, userName(u), `відновлено з кошика${openId ? ` (у відкриту закупівлю ${orderNo(openId)})` : ''}`]],
      [`UPDATE b2b_trash SET restored_at = ?, restored_by = ? WHERE id = ?`, [now, userName(u), t.id]],
    ]);
    if (openId) await rebuildOpen(openId);
    await tgPartner(o.partner_id, `↩️ ${o.kind === 'client' ? `Замовлення клієнта ${orderNo(o.id)} (${h(o.client_name)})` : `Закупівлю ${orderNo(o.id)}`} відновлено з кошика.`);
    return c.json({ ok: true, id: o.id, kind: o.kind });
  });
}
