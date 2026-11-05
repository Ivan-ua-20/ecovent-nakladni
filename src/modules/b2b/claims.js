// B2B: обміни й повернення браку. Заявка від партнера (або нашого менеджера) до замовлення клієнта чи закупівлі:
// товари й кількість, причина, опис, фото/відео (необов'язково), чого хоче партнер.
// Ми розглядаємо, погоджуємо (куди йде брак: до нас на склад, без повернення, постачальнику) або відхиляємо;
// заміна — окрема «обмінна» закупівля на 0 грн, позначена «Оплачено вручну» (з неї партнер оформлює відправку клієнту
// або забирає сам), повернення коштів — сума й коментар у заявці. Кожен крок — в історію заявки й замовлення,
// партнеру в бот і в Telegram-групу партнера (з фото), нам — у Telegram (розділ B2B).
import { can } from '../../core/auth.js';
import { fail, need, nowIso, round2 } from '../../core/common.js';
import { orderNo } from './orders.js';

export const CLAIM_STATUS = {
  new: 'Нова',
  review: 'На розгляді',
  approved: 'Погоджено',
  resolved: 'Заміну відправлено',
  closed: 'Закрито',
  rejected: 'Відхилено',
  cancelled: 'Скасовано партнером',
};
export const CLAIM_REASON = {
  defect: 'Заводський брак',
  damaged: 'Пошкоджено при доставці',
  incomplete: 'Некомплект',
  wrong: 'Пересорт (не той товар)',
  broken: 'Не працює / зламався',
  other: 'Інше',
};
export const CLAIM_WANT = {
  same: 'Обмін на такий самий товар',
  other: 'Заміна на інший товар',
  repair: 'Ремонт',
  refund: 'Повернення коштів',
};
export const RETURN_MODE = {
  warehouse: 'Брак повертають нам на склад (ТТН повернення)',
  none: 'Без повернення (достатньо фото)',
  supplier: 'Брак іде напряму постачальнику',
};
export const DEFECT_STATE = {
  awaiting: 'Чекаємо брак на склад',
  confirmed: 'Брак отримано — підтверджено',
  not_confirmed: 'Брак отримано — не підтверджено',
};
const claimNo = (id) => `О-${id}`;
const OPEN = ['new', 'review', 'approved'];

export function mountB2bClaims(app, { db, services = {}, myPartner, orders }) {
  const { orderOf, itemRows, storeFile, sendFile, groupOf, log, tgAdmins, tgPartner, tgGroup, link, uah, h, entityText } = orders;
  const userName = (u) => u?.name || u?.login || '';
  const J = (v, d) => { try { return JSON.parse(v || '') ?? d; } catch { return d; } };

  const claimOf = async (id, partnerId = null) => {
    const r = await db.get(`SELECT * FROM b2b_claims WHERE id = ?${partnerId ? ' AND partner_id = ?' : ''}`, partnerId ? [id, partnerId] : [id]);
    if (!r) throw fail(404, 'Заявку не знайдено.');
    return r;
  };
  const pub = (r) => ({
    ...r, number: claimNo(r.id), status_name: CLAIM_STATUS[r.status] || r.status, reason_name: CLAIM_REASON[r.reason] || r.reason,
    want_name: CLAIM_WANT[r.want] || r.want, return_name: RETURN_MODE[r.return_mode] || '', defect_name: DEFECT_STATE[r.defect] || '',
    items: J(r.items, []), want_items: J(r.want_items, []), order_number: r.order_id ? orderNo(r.order_id) : '',
    exch_number: r.exch_supply_id ? orderNo(r.exch_supply_id) : '',
  });
  const clog = (id, u, action) => db.run(`INSERT INTO b2b_claim_log (claim_id, at, user_name, action) VALUES (?, ?, ?, ?)`, [id, nowIso(), userName(u), String(action).slice(0, 2000)]);

  // Повний текст заявки для Telegram (у групу партнера й нам).
  const itemsLine = (list) => list.map((i) => `• ${h(i.name)}${i.article ? ` (${h(i.article)})` : ''} × ${i.qty}`).join('\n');
  async function claimText(r, title) {
    const c = pub(r);
    const p = await db.get(`SELECT name FROM b2b_partners WHERE id = ?`, [r.partner_id]);
    return `${title}\n<b>Заявка ${claimNo(r.id)}</b> · ${h(p?.name || '')} · <b>${h(c.status_name)}</b>`
      + `\n${r.order_kind === 'client' ? 'Замовлення клієнта' : 'Закупівля'} ${c.order_number}${r.client_name ? ` · ${h(r.client_name)}${r.client_phone ? `, +${h(r.client_phone)}` : ''}` : ''}${r.ttn ? ` · ТТН ${h(r.ttn)}` : ''}`
      + `\n<b>Товар:</b>\n${itemsLine(c.items)}`
      + `\n<b>Причина:</b> ${h(c.reason_name)}${r.descr ? `\n<b>Опис:</b> ${h(r.descr)}` : ''}`
      + `\n<b>Партнер хоче:</b> ${h(c.want_name)}${c.want_items.length ? `\n${itemsLine(c.want_items)}` : ''}`
      + `${r.deliver_to ? `\n<b>Заміну отримує:</b> ${r.deliver_to === 'partner' ? 'партнер (уже замінив клієнту зі свого складу)' : 'клієнт'}` : ''}`
      + `${r.return_mode ? `\n<b>Брак:</b> ${h(c.return_name)}${r.return_ttn ? ` · ТТН повернення ${h(r.return_ttn)}` : ''}` : ''}`
      + `${r.defect ? `\n<b>Перевірка:</b> ${h(c.defect_name)}${r.defect_note ? ` — ${h(r.defect_note)}` : ''}` : ''}`
      + `${r.decision_note ? `\n<b>Рішення менеджера:</b> ${h(r.decision_note)}` : ''}`
      + `${r.refund_amount ? `\n<b>До повернення:</b> ${uah(r.refund_amount)}` : ''}`
      + `${r.exch_supply_id ? `\n<b>Обмінна закупівля:</b> ${orderNo(r.exch_supply_id)} (0 грн)` : ''}`
      + `${r.files ? `\n📷 Фото/відео: ${r.files}` : ''}`;
  }
  // Подія заявки: в історію (заявки й замовлення), партнеру в бот і в групу, нам — у Telegram.
  async function notify(c, r, title, { history = '' } = {}) {
    const fresh = await db.get(`SELECT cl.*, (SELECT COUNT(*) FROM b2b_files f WHERE f.claim_id = cl.id) AS files FROM b2b_claims cl WHERE cl.id = ?`, [r.id]);
    if (history) {
      await clog(r.id, c.get('user'), history);
      if (fresh.order_id) await log(fresh.order_id, c.get('user'), `заявка на обмін ${claimNo(r.id)}: ${history}`).catch(() => 0);
    }
    const text = await claimText(fresh, title);
    await tgGroup(fresh.partner_id, text);
    await tgPartner(fresh.partner_id, `${text}\n${link(c, `pclaims/${r.id}`)}`);
    await tgAdmins(`${text}\n${link(c, `b2bclaims/${r.id}`)}`);
  }

  // Товари джерела (замовлення клієнта чи закупівля) для форми заявки.
  async function sourceOf(orderId, partnerId) {
    const o = await orderOf(orderId, partnerId || undefined);
    if (!['client', 'supply'].includes(o.kind) || ['draft', 'open'].includes(o.status)) throw fail(400, 'Заявку можна подати до замовлення клієнта або оформленої закупівлі.');
    const items = await db.all(`SELECT product_id, name, article, qty, price, rrp FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    return { o, items };
  }

  async function create(c, partnerId, b) {
    const { o, items } = await sourceOf(parseInt(b.order_id, 10), partnerId);
    const have = new Map(items.map((i) => [i.product_id, i]));
    const list = [];
    for (const it of Array.isArray(b.items) ? b.items : []) {
      const id = parseInt(it.product_id, 10);
      const qty = Math.floor(Number(it.qty) || 0);
      if (!id || qty <= 0) continue;
      const x = have.get(id);
      if (!x) throw fail(400, 'Товару немає в цьому замовленні.');
      if (qty > x.qty) throw fail(400, `${x.name}: у замовленні лише ${x.qty} шт.`);
      list.push({ product_id: id, name: x.name, article: x.article || '', qty, price: x.price, rrp: x.rrp });
    }
    if (!list.length) throw fail(400, 'Позначте товар і кількість, з якими проблема.');
    const reason = CLAIM_REASON[b.reason] ? b.reason : '';
    if (!reason) throw fail(400, 'Оберіть причину.');
    const want = CLAIM_WANT[b.want] ? b.want : 'same';
    const descr = String(b.descr || '').trim().slice(0, 2000);
    if (descr.length < 5) throw fail(400, 'Опишіть проблему кількома словами.');
    let wantItems = [];
    if (want === 'other') {
      const cat = new Map((await db.all(`SELECT product_id, name, article FROM b2b_catalog WHERE product_id IN (SELECT value FROM json_each(?))`,
        [JSON.stringify((b.want_items || []).map((x) => parseInt(x.product_id, 10)).filter(Boolean))])).map((x) => [x.product_id, x]));
      wantItems = (b.want_items || []).map((x) => ({ p: cat.get(parseInt(x.product_id, 10)), qty: Math.floor(Number(x.qty) || 0) }))
        .filter((x) => x.p && x.qty > 0).map((x) => ({ product_id: x.p.product_id, name: x.p.name, article: x.p.article || '', qty: x.qty }));
      if (!wantItems.length) throw fail(400, 'Оберіть товар на заміну.');
    }
    const deliverTo = o.kind === 'client' ? (b.deliver_to === 'partner' ? 'partner' : 'client') : 'partner';
    const now = nowIso();
    const r = await db.run(`INSERT INTO b2b_claims (partner_id, order_id, order_kind, client_name, client_phone, ttn, status, reason, descr, want, items, want_items,
        deliver_to, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [o.partner_id, o.id, o.kind, o.client_name || '', o.client_phone || '', o.ttn || '', reason, descr, want, JSON.stringify(list), JSON.stringify(wantItems),
      deliverTo, userName(c.get('user')), now, now]);
    const cl = await claimOf(r.lastId);
    await notify(c, cl, '🛠 <b>Нова заявка на обмін / повернення</b>', {
      history: `подано: ${list.map((i) => `${i.name} × ${i.qty}`).join('; ')} — ${CLAIM_REASON[reason]}; хоче: ${CLAIM_WANT[want]}`,
    });
    return { id: cl.id, number: claimNo(cl.id) };
  }

  // Фото / відео до заявки (необов'язково): до 10 файлів по 5 МБ; одразу в групу партнера й нам.
  async function addFile(c, cl) {
    if (['closed', 'rejected', 'cancelled'].includes(cl.status)) throw fail(400, 'Заявку закрито.');
    if ((await db.get(`SELECT COUNT(*) AS n FROM b2b_files WHERE claim_id = ?`, [cl.id])).n >= 10) throw fail(400, 'Не більше 10 файлів у заявці.');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    let name = 'file';
    try { name = decodeURIComponent(c.req.header('x-file-name') || 'file'); } catch { /* */ }
    // order_id = 0: фото заявки не змішуються з документами замовлення (маркування, чеки, сторінка накладних).
    const f = await storeFile({ id: 0 }, 'claim', { bytes, name, mime: c.req.header('content-type') }, c.get('user'));
    await db.run(`UPDATE b2b_files SET claim_id = ? WHERE id = ?`, [cl.id, f.id]);
    await clog(cl.id, c.get('user'), `додано фото/відео «${f.name}»`);
    const caption = `📷 Заявка ${claimNo(cl.id)} (${cl.order_kind === 'client' ? 'замовлення клієнта' : 'закупівля'} ${orderNo(cl.order_id)})`;
    const g = await groupOf(cl.partner_id);
    if (g) await services.notify?.sendFile?.({ chatIds: [g] }, f, caption).catch(() => 0);
    await services.notify?.sendFile?.({ chatIds: await adminChats() }, f, caption).catch(() => 0);
    return { id: f.id };
  }
  const adminChats = async () => (await db.all(`SELECT tg_chat_id FROM users WHERE active = 1 AND tg_chat_id != '' AND role IN ('owner', 'admin', 'admin_lite') LIMIT 5`)).map((r) => r.tg_chat_id);

  async function detail(cl) {
    const [files, history] = await Promise.all([
      db.all(`SELECT id, name, mime, size, created_by, created_at FROM b2b_files WHERE claim_id = ? ORDER BY id`, [cl.id]),
      db.all(`SELECT at, user_name, action FROM b2b_claim_log WHERE claim_id = ? ORDER BY id DESC`, [cl.id]),
    ]);
    const p = await db.get(`SELECT name FROM b2b_partners WHERE id = ?`, [cl.partner_id]);
    return { claim: { ...pub(cl), partner: p?.name || '' }, files, history };
  }
  async function listOf(where, params) {
    const rows = await db.all(`SELECT cl.*, p.name AS partner, (SELECT COUNT(*) FROM b2b_files f WHERE f.claim_id = cl.id) AS files
      FROM b2b_claims cl JOIN b2b_partners p ON p.id = cl.partner_id WHERE ${where.join(' AND ')} ORDER BY cl.id DESC LIMIT 300`, params);
    return rows.map(pub);
  }
  const countsOf = (partnerId) => db.all(`SELECT status, COUNT(*) AS n FROM b2b_claims ${partnerId ? 'WHERE partner_id = ?' : ''} GROUP BY status`, partnerId ? [partnerId] : []);

  // Коментар у заявці (попросити ще фото, уточнення) — обидві сторони.
  async function comment(c, cl, text, who) {
    const t = String(text || '').trim().slice(0, 1000);
    if (t.length < 2) throw fail(400, 'Напишіть коментар.');
    await notify(c, cl, `💬 <b>Коментар ${who}</b>: ${h(t)}`, { history: `коментар: ${t}` });
    return { ok: true };
  }

  // ---------------------------------------------------------------- кабінет партнера
  app.get('/api/b2b/p/claims', async (c) => {
    const p = await myPartner(c);
    const st = c.req.query('status');
    const where = ['cl.partner_id = ?'];
    const params = [p.id];
    if (st === 'open') where.push(`cl.status IN ('new', 'review', 'approved')`);
    else if (CLAIM_STATUS[st]) { where.push('cl.status = ?'); params.push(st); }
    return c.json({ rows: await listOf(where, params), statuses: CLAIM_STATUS, counts: await countsOf(p.id) });
  });
  app.get('/api/b2b/p/claims/meta', async (c) => {
    await myPartner(c);
    return c.json({ reasons: CLAIM_REASON, wants: CLAIM_WANT });
  });
  app.get('/api/b2b/p/claims/source/:orderId', async (c) => {
    const p = await myPartner(c);
    const { o, items } = await sourceOf(c.req.param('orderId'), p.id);
    return c.json({ order: { id: o.id, number: orderNo(o.id), kind: o.kind, client_name: o.client_name || '', ttn: o.ttn || '' }, items, reasons: CLAIM_REASON, wants: CLAIM_WANT });
  });
  app.get('/api/b2b/p/claims/:id', async (c) => {
    const p = await myPartner(c);
    return c.json(await detail(await claimOf(c.req.param('id'), p.id)));
  });
  app.post('/api/b2b/p/claims', async (c) => {
    const p = await myPartner(c);
    if (!can(c.get('user'), 'b2b.order')) throw fail(403, 'Недостатньо прав.');
    return c.json(await create(c, p.id, await c.req.json()));
  });
  app.post('/api/b2b/p/claims/:id/files', async (c) => {
    const p = await myPartner(c);
    return c.json(await addFile(c, await claimOf(c.req.param('id'), p.id)));
  });
  app.get('/api/b2b/p/claims/:id/files/:fid', async (c) => {
    const p = await myPartner(c);
    const cl = await claimOf(c.req.param('id'), p.id);
    const f = await db.get(`SELECT * FROM b2b_files WHERE id = ? AND claim_id = ?`, [c.req.param('fid'), cl.id]);
    if (!f) throw fail(404, 'Файл не знайдено (зберігаються 30 днів).');
    return sendFile(f);
  });
  app.post('/api/b2b/p/claims/:id/comment', async (c) => {
    const p = await myPartner(c);
    return c.json(await comment(c, await claimOf(c.req.param('id'), p.id), (await c.req.json()).text, 'партнера'));
  });
  // ТТН, якою брак повертається нам (коли погоджено «на наш склад»).
  app.put('/api/b2b/p/claims/:id/return-ttn', async (c) => {
    const p = await myPartner(c);
    const cl = await claimOf(c.req.param('id'), p.id);
    if (!['approved', 'resolved'].includes(cl.status) || cl.return_mode !== 'warehouse') throw fail(400, 'ТТН повернення вносять, коли заявку погоджено з поверненням браку на склад.');
    const ttn = String((await c.req.json()).ttn || '').replace(/\s/g, '').slice(0, 30);
    if (!/^[0-9A-Za-z-]{6,30}$/.test(ttn)) throw fail(400, 'Вкажіть номер ТТН.');
    await db.run(`UPDATE b2b_claims SET return_ttn = ?, updated_at = ? WHERE id = ?`, [ttn, nowIso(), cl.id]);
    await notify(c, { ...cl }, `📦 <b>Брак відправлено на склад</b>, ТТН ${h(ttn)}`, { history: `ТТН повернення браку: ${ttn}` });
    return c.json({ ok: true });
  });
  app.post('/api/b2b/p/claims/:id/cancel', async (c) => {
    const p = await myPartner(c);
    const cl = await claimOf(c.req.param('id'), p.id);
    if (!['new', 'review'].includes(cl.status)) throw fail(400, 'Заявку вже погоджено — скасувати може менеджер.');
    await db.run(`UPDATE b2b_claims SET status = 'cancelled', updated_at = ?, closed_at = ? WHERE id = ?`, [nowIso(), nowIso(), cl.id]);
    await notify(c, cl, '🚫 <b>Партнер скасував заявку</b>', { history: 'скасовано партнером' });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- наші менеджери
  app.get('/api/b2b/claims', async (c) => {
    need(c, 'b2b.admin');
    const st = c.req.query('status');
    const pid = parseInt(c.req.query('partner'), 10);
    const where = ['1 = 1'];
    const params = [];
    if (st === 'open') where.push(`cl.status IN ('new', 'review', 'approved')`);
    else if (CLAIM_STATUS[st]) { where.push('cl.status = ?'); params.push(st); }
    if (pid) { where.push('cl.partner_id = ?'); params.push(pid); }
    return c.json({ rows: await listOf(where, params), statuses: CLAIM_STATUS, counts: await countsOf(null) });
  });
  app.get('/api/b2b/claims/meta', async (c) => {
    need(c, 'b2b.admin');
    return c.json({ reasons: CLAIM_REASON, wants: CLAIM_WANT, returns: RETURN_MODE, defects: DEFECT_STATE });
  });
  app.get('/api/b2b/claims/source/:orderId', async (c) => {
    need(c, 'b2b.admin');
    const { o, items } = await sourceOf(c.req.param('orderId'));
    return c.json({ order: { id: o.id, number: orderNo(o.id), kind: o.kind, client_name: o.client_name || '', ttn: o.ttn || '' }, items, reasons: CLAIM_REASON, wants: CLAIM_WANT });
  });
  app.get('/api/b2b/claims/:id', async (c) => {
    need(c, 'b2b.admin');
    return c.json(await detail(await claimOf(c.req.param('id'))));
  });
  app.post('/api/b2b/claims', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json();
    const o = await orderOf(parseInt(b.order_id, 10));
    return c.json(await create(c, o.partner_id, b));
  });
  app.post('/api/b2b/claims/:id/files', async (c) => {
    need(c, 'b2b.admin');
    return c.json(await addFile(c, await claimOf(c.req.param('id'))));
  });
  app.post('/api/b2b/claims/:id/comment', async (c) => {
    need(c, 'b2b.admin');
    return c.json(await comment(c, await claimOf(c.req.param('id')), (await c.req.json()).text, 'менеджера'));
  });

  // Обмінна закупівля: товари на заміну за 0 грн, одразу «Оплачено вручну» з коментарем — з неї партнер оформлює
  // відправку клієнту (НП) або забирає сам (самовивіз).
  async function exchangeSupply(c, cl, delivery) {
    const src = await orderOf(cl.order_id);
    const supId = src.kind === 'supply' ? src.id : src.supply_id;
    const sup = supId ? await db.get(`SELECT entity_id, entity FROM b2b_orders WHERE id = ?`, [supId]) : null;
    let entityId = sup?.entity_id || null;
    let entity = sup?.entity || '';
    if (!entityId) {
      const e = await db.get(`SELECT * FROM b2b_entities WHERE partner_id = ? ORDER BY id LIMIT 1`, [cl.partner_id]);
      if (e) { entityId = e.id; entity = entityText(e); }
    }
    const base = cl.want === 'other' ? J(cl.want_items, []) : J(cl.items, []);
    const rrp = new Map((await db.all(`SELECT product_id, rrp FROM b2b_catalog WHERE product_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(base.map((i) => i.product_id))])).map((x) => [x.product_id, x.rrp]));
    const items = base.map((i) => ({ product_id: i.product_id, name: i.name, article: i.article || '', qty: i.qty, price: 0, rrp: i.rrp ?? rrp.get(i.product_id) ?? 0 }));
    const now = nowIso();
    const note = `обмін за заявкою ${claimNo(cl.id)}`;
    const r = await db.run(`INSERT INTO b2b_orders (partner_id, kind, status, entity_id, entity, total, comment, created_by, created_at, updated_at, delivery,
        paid_amount, paid_at, paid_by, paid_note, claim_id) VALUES (?, 'supply', 'paid', ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [cl.partner_id, entityId, entity, `ОБМІН за заявкою ${claimNo(cl.id)} (${orderNo(cl.order_id)})`, userName(c.get('user')), now, now, delivery, now, userName(c.get('user')), note, cl.id]);
    await db.batch(itemRows(r.lastId, items));
    await log(r.lastId, c.get('user'), `створено обмінну закупівлю (0 грн, «Оплачено вручну»: ${note}): ${items.map((i) => `${i.name} × ${i.qty}`).join('; ')}`);
    return r.lastId;
  }

  // Дії менеджера: розгляд, погодження, відхилення, перевірка браку, заміна / повернення коштів, закриття.
  app.post('/api/b2b/claims/:id/action', async (c) => {
    need(c, 'b2b.admin');
    const cl = await claimOf(c.req.param('id'));
    const b = await c.req.json();
    const note = String(b.note || '').trim().slice(0, 1000);
    const now = nowIso();
    const set = async (fields) => {
      const keys = Object.keys(fields);
      await db.run(`UPDATE b2b_claims SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => fields[k]), now, cl.id]);
      return { ...cl, ...fields };
    };
    switch (b.action) {
      case 'review': {
        if (cl.status !== 'new') throw fail(400, 'Заявку вже розглядають.');
        await notify(c, await set({ status: 'review' }), '👀 <b>Заявку взято на розгляд</b>', { history: 'взято на розгляд' });
        break;
      }
      case 'approve': {
        if (!['new', 'review'].includes(cl.status)) throw fail(400, 'Заявку вже вирішено.');
        const mode = RETURN_MODE[b.return_mode] ? b.return_mode : '';
        if (!mode) throw fail(400, 'Оберіть, що робити з бракованим товаром.');
        const refund = cl.want === 'refund' || cl.want === 'other' ? Math.max(0, round2(Number(String(b.refund_amount ?? '').replace(',', '.')) || 0)) : 0;
        const r2 = await set({ status: 'approved', return_mode: mode, decision_note: note, refund_amount: refund, defect: mode === 'warehouse' ? 'awaiting' : '' });
        await notify(c, r2, `✅ <b>Заявку погоджено</b>${mode === 'warehouse' ? '\n📦 Відправте брак нам на склад і внесіть ТТН повернення в заявці.' : ''}`,
          { history: `погоджено: ${RETURN_MODE[mode]}${note ? ` — ${note}` : ''}${refund ? `; до повернення ${uah(refund)}` : ''}` });
        break;
      }
      case 'reject': {
        if (!OPEN.includes(cl.status)) throw fail(400, 'Заявку вже закрито.');
        if (note.length < 3) throw fail(400, 'Вкажіть причину відмови.');
        await notify(c, await set({ status: 'rejected', decision_note: note, closed_at: now }), '❌ <b>Заявку відхилено</b>', { history: `відхилено: ${note}` });
        break;
      }
      case 'defect': {
        if (!['approved', 'resolved', 'closed'].includes(cl.status)) throw fail(400, 'Спершу погодьте заявку.');
        const d = ['confirmed', 'not_confirmed'].includes(b.defect) ? b.defect : '';
        if (!d) throw fail(400, 'Оберіть результат перевірки.');
        if (d === 'not_confirmed' && note.length < 3) throw fail(400, 'Опишіть, що виявила перевірка.');
        await notify(c, await set({ defect: d, defect_note: note }), `🔎 <b>${DEFECT_STATE[d]}</b>`, { history: `${DEFECT_STATE[d].toLowerCase()}${note ? `: ${note}` : ''}` });
        break;
      }
      case 'replace': {
        if (cl.status !== 'approved') throw fail(400, 'Заміну відправляють після погодження.');
        if (!['same', 'other', 'repair'].includes(cl.want)) throw fail(400, 'Партнер просить повернення коштів — позначте «Кошти повернено».');
        const delivery = b.delivery === 'pickup' ? 'pickup' : 'np';
        const sid = await exchangeSupply(c, cl, delivery);
        const r2 = await set({ status: 'resolved', exch_supply_id: sid });
        await notify(c, r2, `🔁 <b>Заміну оформлено</b> — обмінна закупівля ${orderNo(sid)} (0 грн, оплачено)`
          + `\n${delivery === 'pickup' ? '🚗 Самовивіз: вкажіть у закупівлі, хто забирає.' : cl.deliver_to === 'client' ? '📮 Оформіть із неї замовлення клієнта (ТТН і маркування) — як звичайно.' : '📮 Оформіть із неї відправку собі або клієнту — як звичайно.'}`,
        { history: `заміну оформлено: обмінна закупівля ${orderNo(sid)}${note ? ` — ${note}` : ''}` });
        return c.json({ ok: true, supply_id: sid });
      }
      case 'refund': {
        if (cl.status !== 'approved') throw fail(400, 'Спершу погодьте заявку.');
        const amt = Math.max(0, round2(Number(String(b.refund_amount ?? cl.refund_amount ?? '').replace(',', '.')) || 0));
        if (!amt) throw fail(400, 'Вкажіть суму повернення.');
        if (note.length < 3) throw fail(400, 'Вкажіть, як повернули кошти (зарахування, переказ тощо).');
        await notify(c, await set({ status: 'resolved', refund_amount: amt, decision_note: note }), `💸 <b>Кошти повернено</b>: ${uah(amt)}`, { history: `кошти повернено: ${uah(amt)} — ${note}` });
        break;
      }
      case 'close': {
        if (!['approved', 'resolved'].includes(cl.status)) throw fail(400, 'Закрити можна погоджену заявку.');
        await notify(c, await set({ status: 'closed', closed_at: now }), '🏁 <b>Заявку закрито</b>', { history: `закрито${note ? `: ${note}` : ''}` });
        break;
      }
      default: throw fail(400, 'Невідома дія.');
    }
    return c.json({ ok: true });
  });

  return { CLAIM_STATUS };
}
