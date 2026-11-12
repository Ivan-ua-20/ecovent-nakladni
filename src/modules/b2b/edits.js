// Правки наших адмінів у закупівлях партнерів (у будь-якому статусі, крім скасованої; відкрита — лише ціни) і кошик.
// Закупівля з рахунком (зокрема оплачена чи завершена) лишається у своєму статусі з тим самим рахунком і накладною:
// вона отримує позначку «переробити рахунок/накладну». Запит у «Фінансові питання» — лише кнопкою менеджера.
// Позначка знімається новим номером рахунку або кнопкою «Перероблено». Оплата, що вже надійшла, лишається:
// сума зросла понад оплачене — «Частково оплачено» (завершена лишається завершеною).
// Кошик: видалені закупівлі й замовлення клієнтів (знімок — можна відновити) і прибрані з закупівлі товари;
// видаляють і відновлюють лише адміни, партнер бачить свій кошик (хто й коли видалив).
import { fail, need, nowIso, round2, kyivDay } from '../../core/common.js';
import { logAudit } from '../../core/requisites.js';
import { orderNo, PM_JOIN, PM_COLS, withGrace } from './orders.js';

const INVOICED = ['pay_wait', 'partial', 'paid', 'done'];
const userName = (u) => u?.name || u?.login || '';
const firstLine = (s) => String(s || '').split('\n')[0];

export function mountB2bEdits(app, { db, orders, hooks, myPartner, partnerPrice }) {
  const { orderOf, supplyLeft, itemRows, totalOf, log, tgPartner, tgGroup, link, uah, h, rebuildOpen, getOpen, entityText } = orders;

  // Товари, видимі партнеру (увімкнені бренди), — для «Додати товар».
  // Ціни — з відстрочкою підвищення партнера (як у його каталозі).
  const partnerCatalog = async (partnerId) => {
    const p = await db.get(`SELECT * FROM b2b_partners WHERE id = ?`, [partnerId]);
    const rows = await withGrace(db, p, await db.all(
      `SELECT c.product_id, c.name, c.article, c.rrp, ${PM_COLS} FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id ${PM_JOIN}
       WHERE m.partner_id = ? AND c.hidden = 0 AND c.rrp > 0 ORDER BY c.name`, [kyivDay(), partnerId],
    ));
    return rows.map((r) => ({ product_id: r.product_id, name: r.name, article: r.article || '', rrp: r.rrp, price: partnerPrice(r.rrp, r.margin) }));
  };
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
  // items: [{ product_id, qty, price?, rrp? }] — увесь новий склад (0 або відсутній — прибрати); ціну й РРЦ можна змінити вручну
  // (РРЦ без ціни — ціна перераховується з тією ж знижкою, що була в цій закупівлі). Будь-яка закупівля: чернетка, відкрита
  // (лише ціни й РРЦ — склад відкритої іде із замовлень клієнтів), очікує рахунок, з рахунком (рахунок перевиставляється).
  // Хто й що змінив — в історію, партнеру в бот і в його Telegram-групу.
  app.put('/api/b2b/orders/:id/edit', async (c) => {
    need(c, 'b2b.admin');
    return c.json(await editSupply(c, await orderOf(c.req.param('id')), await c.req.json()));
  });
  // Нові ціни/РРЦ товарів закупівлі (з замовлення клієнта в чернетці: одна ціна товару на всю чернетку).
  // changes: Map(product_id → { price?, rrp? }).
  hooks.supplyPrices = async (c, supplyId, changes) => {
    const o = await orderOf(supplyId);
    const cur = await db.all(`SELECT product_id, qty, price, rrp FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    return editSupply(c, o, { items: cur.map((i, line) => ({ line, product_id: i.product_id, qty: i.qty, price: changes.get(i.product_id)?.price ?? i.price, rrp: changes.get(i.product_id)?.rrp ?? i.rrp })) });
  };
  // Додати товари в закупівлю (з правки замовлення клієнта: товару немає в закупівлі або бракує залишку).
  hooks.supplyAdd = async (c, supplyId, add) => {
    const o = await orderOf(supplyId);
    const cur = await db.all(`SELECT product_id, qty FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    const items = cur.map((i, line) => ({ line, product_id: i.product_id, qty: i.qty })); // рядки з окремими цінами не зливаються
    for (const [id, n] of add) { const it = items.find((x) => x.product_id === id); if (it) it.qty += n; else items.push({ product_id: id, qty: n }); }
    return editSupply(c, o, { items });
  };
  async function editSupply(c, o, b) {
    const u = c.get('user');
    if (o.kind !== 'supply') throw fail(400, 'Це замовлення клієнта — змінюйте його на сторінці замовлення.');
    if (o.status === 'cancelled') throw fail(400, 'Закупівлю скасовано.');
    const cur = await db.all(`SELECT product_id, name, article, qty, price, rrp FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    // Рядок закупівлі: line — номер наявного рядка (як у списку товарів закупівлі); extra — новий окремий рядок товару,
    // що вже є, з іншою ціною (лише у відправленій закупівлі: чернетка й відкрита мають одну ціну на товар).
    // Без line й extra — як раніше: перший рядок цього товару, а повтори того ж товару сумуються.
    const extraOk = !['draft', 'open'].includes(o.status);
    const money = (v, what) => {
      const raw = v === undefined || v === null ? '' : String(v).replace(/\s/g, '').replace(',', '.');
      const x = raw === '' ? null : round2(Number(raw));
      if (x !== null && !(x >= 0 && x < 1e8)) throw fail(400, `${what} — число від 0.`);
      return x;
    };
    const claimed = new Set();
    const asked = [];
    for (const it of Array.isArray(b.items) ? b.items : []) {
      const id = parseInt(it.product_id, 10);
      const qty = Number(it.qty);
      if (!id) continue;
      if (!Number.isInteger(qty) || qty < 0 || qty > 100000) throw fail(400, 'Кількість — ціле число від 0.');
      const price = money(it.price, 'Ціна');
      const rrp = money(it.rrp, 'РРЦ');
      let idx = null;
      if (it.line !== undefined && it.line !== null && it.line !== '' && !it.extra) {
        idx = Number(it.line);
        if (!Number.isInteger(idx) || !cur[idx] || cur[idx].product_id !== id || claimed.has(idx)) throw fail(409, 'Склад закупівлі щойно змінився — закрийте вікно, оновіть сторінку й внесіть зміни ще раз.');
      } else if (!it.extra) {
        const same = asked.find((l) => l.product_id === id && !l.extra && l.plain);
        if (same) { same.qty += qty; if (price !== null) same.price = price; if (rrp !== null) same.rrp = rrp; continue; }
        const k = cur.findIndex((r, n) => r.product_id === id && !claimed.has(n));
        if (k >= 0) idx = k;
      }
      if (idx !== null) claimed.add(idx);
      asked.push({ idx, product_id: id, qty, price, rrp, extra: Boolean(it.extra), plain: !it.extra && (it.line === undefined || it.line === null || it.line === '') });
    }
    const live = asked.filter((l) => l.qty > 0);
    if (!live.length) throw fail(400, 'У закупівлі має лишитися хоча б один товар. Щоб прибрати все — видаліть закупівлю.');
    if (live.length > 300) throw fail(400, 'Не більше 300 позицій.');
    const curOf = (id) => cur.find((r) => r.product_id === id);
    const newIds = [...new Set(live.filter((l) => l.idx === null && !curOf(l.product_id)).map((l) => l.product_id))];
    const cat = newIds.length ? new Map((await withGrace(db, await db.get(`SELECT * FROM b2b_partners WHERE id = ?`, [o.partner_id]), await db.all(
      `SELECT c.product_id, c.name, c.article, c.rrp, ${PM_COLS} FROM b2b_catalog c LEFT JOIN b2b_margins m ON m.brand_id = c.brand_id AND m.partner_id = ? ${PM_JOIN}
       WHERE c.product_id IN (SELECT value FROM json_each(?))`, [o.partner_id, kyivDay(), JSON.stringify(newIds)],
    ))).map((r) => [r.product_id, r])) : new Map();
    let items = live.map((l) => {
      const old = l.idx !== null ? cur[l.idx] : null;
      if (old) {
        const rrp = l.rrp ?? old.rrp;
        // нова РРЦ без нової ціни — ціна з тією ж знижкою від РРЦ, що була в закупівлі
        const price = l.price ?? (l.rrp != null && round2(l.rrp) !== round2(old.rrp) && old.rrp > 0 ? round2((old.price / old.rrp) * l.rrp) : old.price);
        return { product_id: l.product_id, name: old.name, article: old.article || '', qty: l.qty, price, rrp, _idx: l.idx };
      }
      const same = curOf(l.product_id);
      if (same) return { product_id: l.product_id, name: same.name, article: same.article || '', qty: l.qty, price: l.price ?? same.price, rrp: l.rrp ?? same.rrp, _idx: null, _extra: true };
      const r = cat.get(l.product_id);
      if (!r) throw fail(400, `Товару ID ${l.product_id} немає в каталозі.`);
      const rrp = l.rrp ?? r.rrp;
      return { product_id: l.product_id, name: r.name, article: r.article || '', qty: l.qty, price: l.price ?? partnerPrice(rrp, r.margin || 0), rrp, _idx: null, _extra: l.extra };
    });
    // Рядки одного товару з однаковою ціною й РРЦ — один рядок (кількості сумуються).
    const merged = [];
    const mergedIdx = new Set();
    for (const i of items) {
      const into = merged.find((x) => x.product_id === i.product_id && round2(x.price) === round2(i.price) && round2(x.rrp) === round2(i.rrp));
      if (into) { into.qty += i.qty; if (i._idx !== null) mergedIdx.add(i._idx); } else merged.push({ ...i });
    }
    items = merged;
    const multi = new Set(items.filter((i, n) => items.findIndex((x) => x.product_id === i.product_id) !== n).map((i) => i.product_id));
    if (multi.size && !extraOk) throw fail(400, 'Окремий рядок товару з іншою ціною можна додати лише у відправлену закупівлю — не в чернетку й не у відкриту.');
    // Відкрита закупівля = сума замовлень клієнтів: тут змінюються лише ціни й РРЦ (склад — через замовлення клієнтів).
    if (o.status === 'open' && (items.length !== cur.length || items.some((i) => i._idx === null || cur[i._idx].qty !== i.qty))) {
      throw fail(400, 'У відкритій закупівлі можна змінити лише ціни й РРЦ: товари й кількість ідуть із замовлень клієнтів — змініть їх там.');
    }
    // Не менше, ніж уже розписано на замовлення клієнтів (по товару — всі його рядки разом).
    const wantQty = new Map();
    for (const i of items) wantQty.set(i.product_id, (wantQty.get(i.product_id) || 0) + i.qty);
    for (const r of await supplyLeft(o.id)) {
      if (r.used > (wantQty.get(r.product_id) || 0)) throw fail(400, `«${r.name}»: на замовлення клієнтів уже розписано ${r.used} шт. — спершу змініть або видаліть ці замовлення.`);
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
    // товар у кількох рядках (до чи після) — у записі видно, про який рядок мова
    const several = new Set([...multi, ...cur.filter((i, n) => cur.findIndex((x) => x.product_id === i.product_id) !== n).map((i) => i.product_id)]);
    const nm = (i, price) => (several.has(i.product_id) ? `${i.name} (рядок по ${uah(price)})` : i.name);
    for (const i of items) {
      const old = i._idx !== null ? cur[i._idx] : null;
      if (!old) { changes.push(`+ ${i.name} × ${i.qty} по ${uah(i.price)}${curOf(i.product_id) ? ' (окремий рядок — товар уже є в закупівлі за іншою ціною)' : ''}`); continue; }
      if (old.qty !== i.qty) changes.push(`${nm(i, old.price)}: ${old.qty} → ${i.qty} шт`);
      if (round2(old.rrp) !== round2(i.rrp)) changes.push(`${nm(i, old.price)}: РРЦ ${uah(old.rrp)} → ${uah(i.rrp)}`);
      if (round2(old.price) !== round2(i.price)) changes.push(`${nm(i, old.price)}: ціна ${uah(old.price)} → ${uah(i.price)}`);
    }
    const kept = new Set([...items.map((i) => i._idx).filter((x) => x !== null), ...mergedIdx]);
    const removed = cur.filter((i, n) => !kept.has(n));
    if (mergedIdx.size) changes.push('рядки товару з однаковою ціною об’єднано');
    for (const i of removed) changes.push(`− ${i.name} × ${i.qty} (прибрано)`);
    if (ent.id !== o.entity_id) changes.push(`юрособа: ${firstLine(ent.text)}`);
    if (comment !== (o.comment || '')) changes.push('коментар');
    if (!changes.length) return { ok: true, changed: false };

    const invoiced = Boolean(o.invoice_no) && INVOICED.includes(o.status);
    const redo = invoiced ? (o.reinvoice || `${o.invoice_no}${o.waybill_no ? ` (і накладну № ${o.waybill_no})` : ''}`) : '';
    // Оплата лишається: сума більша за оплачене — частково, покрита — оплачено (завершена й без оплати — статус той самий).
    const paid = Number(o.paid_amount) || 0;
    const status = invoiced && paid > 0 && ['pay_wait', 'partial', 'paid'].includes(o.status) ? (paid >= total - 0.004 ? 'paid' : 'partial') : o.status;
    const now = nowIso();
    items = items.map(({ _idx, _extra, ...i }) => i);
    const st = [[`DELETE FROM b2b_order_items WHERE order_id = ?`, [o.id]], ...itemRows(o.id, items)];
    st.push(invoiced
      ? [`UPDATE b2b_orders SET total = ?, entity_id = ?, entity = ?, comment = ?, status = ?, reinvoice = ?, reinvoiced_at = ?, reinvoice_sent = '', group_done = 0, updated_at = ? WHERE id = ?`,
      [total, ent.id, ent.text, comment, status, redo, now, now, o.id]]
      : [`UPDATE b2b_orders SET total = ?, entity_id = ?, entity = ?, comment = ?, group_done = 0, updated_at = ? WHERE id = ?`, [total, ent.id, ent.text, comment, now, o.id]]);
    for (const i of removed) {
      st.push([`INSERT INTO b2b_trash (kind, order_id, partner_id, title, total, data, deleted_by, by_partner, deleted_at) VALUES ('item', ?, ?, ?, ?, ?, ?, 0, ?)`,
        [o.id, o.partner_id, `${i.name} × ${i.qty} — із закупівлі ${orderNo(o.id)}`, round2(i.price * i.qty), JSON.stringify(i), userName(u), now]]);
    }
    await db.batch(st);
    const who = userName(u) || 'менеджер';
    await log(o.id, u, `змінив ${who}: ${changes.join('; ')} — разом ${uah(total)}${invoiced ? ` · рахунок № ${redo} треба переробити` : ''}${status !== o.status ? ` · статус: ${status === 'partial' ? '«Частково оплачено»' : '«Оплачено»'}` : ''}`.slice(0, 1800));
    // Чернетка й відкрита закупівля: замовлення клієнтів у них мають ті самі ціни — оновлюємо й їх.
    if (['draft', 'open'].includes(o.status)) await priceToClients(o, u, cur, items);
    if (o.status === 'open') await rebuildOpen(o.id);

    // Хто й що змінив — партнеру в бот і в його групу (і для чернетки, і для відкритої).
    const lines = changes.slice(0, 20).map(h).join('\n');
    const what = o.status === 'draft' ? 'Чернетку закупівлі' : o.status === 'open' ? 'Відкриту закупівлю' : 'Закупівлю';
    const text = `✏️ <b>${what} ${orderNo(o.id)} змінив ${h(who)}</b>\n${lines}\n<b>Разом: ${uah(total)}</b>`
      + `${invoiced ? `\n\n🔁 Рахунок № ${h(o.invoice_no)}${o.waybill_no ? ` і накладну № ${h(o.waybill_no)}` : ''} буде перероблено — нові документи надійдуть сюди.${paid > 0 ? ` Оплата ${uah(paid)} зарахована${status === 'partial' ? `, до доплати ${uah(total - paid)}` : ''}.` : ''}` : ''}`;
    await tgPartner(o.partner_id, `${text}\n${link(c, `porders/${o.id}`)}`);
    await tgGroup(o.partner_id, text);
    // Рахунку ще немає («Очікує рахунок») — оновлюємо вже надісланий запит рахунку, щоб бухгалтер виставив його на новий склад.
    // Рахунок уже є — у «Фінансові питання» нічого не йде: менеджер надсилає запит кнопкою, коли треба.
    if (!invoiced && o.status === 'invoice_wait') await hooks.finRequest?.(o.id, 'changed').catch(() => 0);
    return { ok: true, changed: true, total, reinvoice: invoiced };
  }

  // Нові ціни/РРЦ товарів чернетки чи відкритої закупівлі — у її замовлення клієнтів (суми перераховуються).
  async function priceToClients(o, u, before, after) {
    const old = new Map(before.map((i) => [i.product_id, i]));
    const changed = after.filter((i) => old.has(i.product_id) && (round2(old.get(i.product_id).price) !== round2(i.price) || round2(old.get(i.product_id).rrp) !== round2(i.rrp)));
    if (!changed.length) return;
    const ids = (await db.all(`SELECT id FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled'`, [o.id])).map((r) => r.id);
    if (!ids.length) return;
    const J = JSON.stringify(ids);
    const hit = await db.all(`SELECT DISTINCT order_id FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?)) AND product_id IN (SELECT value FROM json_each(?))`,
      [J, JSON.stringify(changed.map((i) => i.product_id))]);
    if (!hit.length) return;
    await db.batch([
      ...changed.map((i) => [`UPDATE b2b_order_items SET price = ?, rrp = ? WHERE product_id = ? AND order_id IN (SELECT value FROM json_each(?))`, [i.price, i.rrp, i.product_id, J]]),
      [`UPDATE b2b_orders SET total = (SELECT ROUND(COALESCE(SUM(ROUND(qty * price, 2)), 0), 2) FROM b2b_order_items WHERE order_id = b2b_orders.id), updated_at = ?
        WHERE id IN (SELECT value FROM json_each(?))`, [nowIso(), JSON.stringify(hit.map((r) => r.order_id))]],
    ]);
    const note = changed.map((i) => `${i.name}: ціна ${uah(i.price)}, РРЦ ${uah(i.rrp)}`).join('; ');
    for (const r of hit) await log(r.order_id, u, `ціни змінено в закупівлі ${orderNo(o.id)} (${userName(u) || 'менеджер'}): ${note}`.slice(0, 1800));
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
    let o2 = o;
    // замовлення клієнта в чернетці закупівлі — його товари прибираються з чернетки
    const inDraft = o.kind === 'client' && o.supply_id && o.status !== 'cancelled'
      && (await db.get(`SELECT status FROM b2b_orders WHERE id = ?`, [o.supply_id]))?.status === 'draft';
    const draftItems = inDraft ? await db.all(`SELECT product_id, name, article, qty, price, rrp FROM b2b_order_items WHERE order_id = ?`, [o.id]) : [];
    if (o.kind === 'supply' && o.status === 'draft') {
      // чернетка: її замовлення клієнтів повертаються «без закупівлі» — у відкриту закупівлю
      await hooks.detachDraft?.(o, c.get('user'));
      o2 = await orderOf(o.id);
    } else if (o.kind === 'supply') {
      const n = (await db.get(`SELECT COUNT(*) AS n FROM b2b_orders WHERE supply_id = ? AND kind = 'client' AND status != 'cancelled'`, [o.id])).n;
      if (n) throw fail(400, `З цієї закупівлі є замовлення клієнтів (${n}) — спершу видаліть або скасуйте їх.`);
    }
    await toTrash(o2, c.get('user'));
    await hooks.finClosed?.(o.id, '🗑 видалено', o).catch(() => 0);
    if (inDraft) await hooks.draftAdjust?.(o.supply_id, draftItems.map((i) => ({ ...i, qty: -i.qty })));
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
    let restoreToDraft = null;
    if (o.kind === 'client' && o.status !== 'cancelled') {
      const s = o.supply_id ? await db.get(`SELECT id, status FROM b2b_orders WHERE id = ?`, [o.supply_id]) : null;
      if (s?.status === 'draft') {
        restoreToDraft = s.id; // товари повертаються в чернетку
      } else if (s && !['open', 'cancelled'].includes(s.status)) {
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
    if (restoreToDraft) await hooks.draftAdjust?.(restoreToDraft, (d.items || []).map((i) => ({ ...i, article: i.article || '' })));
    await tgPartner(o.partner_id, `↩️ ${o.kind === 'client' ? `Замовлення клієнта ${orderNo(o.id)} (${h(o.client_name)})` : `Закупівлю ${orderNo(o.id)}`} відновлено з кошика.`);
    return c.json({ ok: true, id: o.id, kind: o.kind });
  });
}
