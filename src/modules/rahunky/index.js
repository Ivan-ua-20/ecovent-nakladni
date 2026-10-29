// Модуль «Рахунки на оплату (Word)»: ФОПи рахунків, замовлення з CRM для рахунку, рахунки з номером
// зі спільного лічильника, QR-посилання на оплату (через модуль payments).
import { can } from '../../core/auth.js';
import { fail, need, nowIso, userName, round2, num as toNum, kyivDay, loadSettings, likeVariants } from '../../core/common.js';
import { DEFAULT_WARNING } from '../../core/schema.js';
import { checkImages } from '../../core/validate.js';
import { takeRahunokNumber, peekRahunokNumber } from '../../core/counters.js';
import { INV_FOP_REQUISITES, REQUISITES_DENIED, changedFields, describeChanges, logAudit } from '../../core/requisites.js';
import { normalizeOrder } from '../nakladni/index.js';

// services: { nakladni: { loadOrder }, payments: { linkForRahunok } } — заповнюються в app.js.
export function mountRahunky(app, { db, services, onCleanup }) {
  const settings = () => loadSettings(db);
  const loadOrder = (...a) => services.nakladni.loadOrder(...a);
  // Строк зберігання рахунків — «retention_days» з налаштувань.
  onCleanup((border) => db.run(`DELETE FROM invoices WHERE COALESCE(updated_at, created_at) < ?`, [border]));

  // =====================================================================
  // РАХУНКИ НА ОПЛАТУ
  // =====================================================================
  const INV_FOP_FIELDS = ['short_name', 'full_name', 'ipn', 'iban', 'bank', 'address', 'phone', 'warning_text', 'signature', 'stamp', 'active'];

  app.post('/api/inv-fops', async (c) => {
    need(c, 'users'); // створювати ФОП рахунків вручну — лише власник і адміни
    const b = await c.req.json();
    if (!String(b.short_name || '').trim()) throw fail(400, 'Вкажіть коротку назву ФОП.');
    checkImages(b, fail);
    const cols = INV_FOP_FIELDS.filter((k) => b[k] !== undefined);
    const r = await db.run(`INSERT INTO inv_fops (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((k) => b[k]));
    await logAudit(db, { user: c.get('user'), kind: 'inv_fop', refId: r.lastId, action: 'створено', changes: describeChanges({}, b, changedFields({}, b, INV_FOP_REQUISITES)) });
    return c.json({ id: r.lastId });
  });

  app.put('/api/inv-fops/:id', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    checkImages(b, fail);
    const cur = await db.get(`SELECT * FROM inv_fops WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'ФОП не знайдено.');
    const req = changedFields(cur, b, INV_FOP_REQUISITES);
    if (req.length && !can(c.get('user'), 'requisites')) throw fail(403, REQUISITES_DENIED);
    const cols = INV_FOP_FIELDS.filter((k) => b[k] !== undefined);
    if (cols.length) {
      await db.run(`UPDATE inv_fops SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => b[k]), cur.id]);
    }
    if (req.length) await logAudit(db, { user: c.get('user'), kind: 'inv_fop', refId: cur.id, action: 'змінено реквізити', changes: describeChanges(cur, b, req) });
    return c.json({ ok: true });
  });

  // Видалити ФОП рахунків, доданий вручну (з Opendatabot — вимикається в налаштуваннях рахунків)
  app.delete('/api/inv-fops/:id', async (c) => {
    need(c, 'users');
    const f = await db.get(`SELECT id, odb_id FROM inv_fops WHERE id = ?`, [c.req.param('id')]);
    if (!f) throw fail(404, 'ФОП не знайдено.');
    if (f.odb_id) throw fail(400, 'Цей ФОП додано з Opendatabot — вимкніть його рахунок у «Налаштуваннях рахунків».');
    await db.run(`DELETE FROM inv_fops WHERE id = ?`, [f.id]);
    return c.json({ ok: true });
  });

  // Замовлення з CRM для рахунку: номер, товари, покупець.
  app.get('/api/rahunok-order/:q', async (c) => {
    need(c, 'docs.edit');
    const q = c.req.param('q').trim().replace(/^№\s*/, '');
    const s = await settings();
    const { rawOrder, productNames, demo, code, note } = await loadOrder(q, s);
    const o = normalizeOrder(rawOrder, productNames);
    const number = demo ? 'demo' : o.shortId || (/^\d{1,8}$/.test(q) ? q : o.orderId);
    return c.json({
      number,
      crmCode: code || '',
      note: note || '',
      buyer: o.buyer,
      items: o.items.map((i) => ({ name: i.article ? `${i.name} [${i.article}]` : i.name, qty: i.qty, price: i.price })),
    });
  });


  async function buildRahunok(b, number) {
    const fop = await db.get(`SELECT * FROM inv_fops WHERE id = ?`, [b.fop_id]);
    if (!fop) throw fail(400, 'Оберіть ФОП, від якого виставляється рахунок.');
    const clientName = String(b.client?.name || '').trim();
    if (!clientName) throw fail(400, 'Вкажіть назву клієнта.');
    const items = (b.items || [])
      .map((i) => ({ name: String(i.name || '').trim(), qty: toNum(i.qty), price: round2(toNum(i.price)) }))
      .filter((i) => i.name);
    if (!items.length) throw fail(400, 'Додайте хоча б один товар.');
    for (const i of items) {
      if (!(i.qty > 0)) throw fail(400, `Кількість для «${i.name}» має бути більшою за 0.`);
      i.unit = 'шт';
      i.sum = round2(i.qty * i.price);
    }
    const today = kyivDay();
    const { signature, stamp, ...fopRest } = fop;
    return {
      number: String(number),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : today,
      source: b.source === 'crm' ? 'crm' : 'manual',
      orderRef: String(b.order_ref || ''),
      fop: { ...fopRest, signature, stamp, warning_text: fop.warning_text || DEFAULT_WARNING },
      client: { name: clientName, edrpou: String(b.client?.edrpou || '').trim(), contract: String(b.client?.contract || '').trim() },
      items,
      total: round2(items.reduce((t, i) => t + i.sum, 0)),
    };
  }

  app.get('/api/rahunky', async (c) => {
    const q = (c.req.query('q') || '').trim();
    const rows = await db.all(
      `SELECT id, number, source, order_ref, fop_name, client_name, total, created_at, created_by, updated_at, updated_by,
         (SELECT p.status FROM pay_links p WHERE p.id = json_extract(invoices.data, '$.pay.link_id')) AS pay_status FROM invoices
       ${q ? 'WHERE number LIKE ? OR client_name LIKE ? OR order_ref LIKE ?' : ''} ORDER BY id DESC LIMIT 300`,
      q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [],
    );
    const s = await settings();
    return c.json({ rows, nextNumber: peekRahunokNumber(s), retentionDays: Number(s.retention_days) || 7 });
  });

  app.get('/api/rahunky/:id', async (c) => {
    const row = await db.get(`SELECT * FROM invoices WHERE id = ?`, [c.req.param('id')]);
    if (!row) throw fail(404, 'Рахунок не знайдено (можливо, минув строк зберігання).');
    return c.json({ ...row, data: JSON.parse(row.data) });
  });

  app.post('/api/rahunky', async (c) => {
    need(c, 'docs.edit');
    const b = await c.req.json();
    let number = '';
    if (b.source === 'crm') {
      number = String(b.number || '').trim();
      if (!number) throw fail(400, 'Немає номера замовлення CRM.');
    }
    const data = await buildRahunok(b, number);
    // Номер беремо зі спільного лічильника лише після перевірки даних — атомарно, без дублів.
    if (b.source !== 'crm') data.number = await takeRahunokNumber(db);
    if (b.qr) data.pay = await services.payments.linkForRahunok(c, data);
    const r = await db.run(
      `INSERT INTO invoices (number, source, order_ref, fop_id, fop_name, client_name, total, data, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.number, data.source, data.orderRef, data.fop.id, data.fop.short_name, data.client.name, data.total, JSON.stringify(data), nowIso(), userName(c)],
    );
    return c.json({ id: r.lastId, data });
  });

  app.put('/api/rahunky/:id', async (c) => {
    need(c, 'docs.edit');
    const row = await db.get(`SELECT * FROM invoices WHERE id = ?`, [c.req.param('id')]);
    if (!row) throw fail(404, 'Рахунок не знайдено.');
    const b = await c.req.json();
    const prev = JSON.parse(row.data);
    const data = await buildRahunok({ ...b, source: prev.source, order_ref: prev.orderRef }, row.number);
    if (b.qr) data.pay = await services.payments.linkForRahunok(c, data);
    await db.run(
      `UPDATE invoices SET fop_id = ?, fop_name = ?, client_name = ?, total = ?, data = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      [data.fop.id, data.fop.short_name, data.client.name, data.total, JSON.stringify(data), nowIso(), userName(c), row.id],
    );
    return c.json({ id: row.id, data });
  });

  app.delete('/api/rahunky/:id', async (c) => {
    need(c, 'docs.edit');
    await db.run(`DELETE FROM invoices WHERE id = ?`, [c.req.param('id')]);
    return c.json({ ok: true });
  });

  // Пошук по сайту: рахунки за номером, замовленням або клієнтом.
  async function search(q) {
    const s = String(q || '').trim();
    const v = likeVariants(s);
    const rows = await db.all(`SELECT id, number, client_name, fop_name, total, created_at FROM invoices
      WHERE number LIKE ? OR order_ref LIKE ? OR ${v.map(() => 'client_name LIKE ?').join(' OR ')} ORDER BY id DESC LIMIT 6`, [`%${s}%`, `%${s}%`, ...v]);
    return rows.map((r) => ({ group: 'Рахунки', title: `Рахунок № ${r.number}${r.client_name ? ` · ${r.client_name}` : ''}`,
      sub: [r.fop_name, String(r.created_at).slice(0, 10).split('-').reverse().join('.')].filter(Boolean).join(' · '),
      link: `#/rlist?q=${encodeURIComponent(r.number)}` }));
  }
  return { search };
}
