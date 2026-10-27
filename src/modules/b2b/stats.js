// Аналітика B2B: продажі партнера (замовлення клієнтів), закупівлі, борг, залишок товару, топ товарів, категорії, бренди.
// Партнер бачить свою (/api/b2b/p/stats), адмін — будь-якого партнера або всіх разом (/api/b2b/stats).
// «Заробіток» — потенційна різниця між РРЦ і ціною партнера (якщо партнер продає за РРЦ).
// Даних мало (~10 замовлень на день), тож рахуємо в коді: 3–5 запитів до бази на звіт.
import { fail, need, round2 } from '../../core/common.js';
import { kyivDayStartIso, kyivDayOf, nextDay, isDay } from './filters.js';

const DAY = 86400000;
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY) + 1;

export function mountB2bStats(app, { db, myPartner }) {
  async function names() {
    const [cats, brands] = await Promise.all([
      db.all(`SELECT id, name FROM an_categories`).catch(() => []),
      db.all(`SELECT id, name FROM an_brands`).catch(() => []),
    ]);
    return { cat: new Map(cats.map((r) => [r.id, r.name])), brand: new Map([...brands.map((r) => [r.id, r.name]), [0, 'Інші']]) };
  }

  async function report(partnerId, q) {
    const today = kyivDayOf(new Date().toISOString());
    const to = isDay(q.to) ? q.to : today;
    const from = isDay(q.from) && q.from <= to ? q.from : addDays(to, -29);
    const days = Math.min(daysBetween(from, to), 400);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));
    const byPartner = partnerId ? 'AND o.partner_id = ?' : '';
    const pp = partnerId ? [partnerId] : [];

    const orders = await db.all(
      `SELECT o.id, o.partner_id, o.kind, o.status, o.supply_id, o.total, o.paid_amount, o.paid_at, o.created_at, o.crm_status, s.status AS supply_status
       FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id
       WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ('cancelled', 'draft', 'confirm') ${byPartner}`,
      [kyivDayStartIso(prevFrom), kyivDayStartIso(nextDay(to)), ...pp],
    );
    for (const o of orders) { o.day = kyivDayOf(o.created_at); o.cur = o.day >= from; }
    const cur = orders.filter((o) => o.cur);
    const prev = orders.filter((o) => !o.cur);
    const items = cur.length ? await db.all(
      `SELECT order_id, product_id, name, qty, price, rrp FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(cur.map((o) => o.id))],
    ) : [];
    const prevItems = prev.length ? await db.all(
      `SELECT order_id, qty, price, rrp FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(prev.filter((o) => o.kind === 'client').map((o) => o.id))],
    ) : [];
    const kindOf = new Map(orders.map((o) => [o.id, o.kind]));

    // ---------- показники продажів (замовлення клієнтів)
    const sales = (list, its) => {
      const ids = new Set(list.filter((o) => o.kind === 'client').map((o) => o.id));
      const li = its.filter((i) => ids.has(i.order_id));
      const sum = round2(list.filter((o) => o.kind === 'client').reduce((t, o) => t + o.total, 0));
      const rrp = round2(li.reduce((t, i) => t + (i.rrp || i.price) * i.qty, 0));
      const cnt = ids.size;
      return { cnt, units: li.reduce((t, i) => t + i.qty, 0), sum, rrp, earn: round2(rrp - sum), avg: cnt ? round2(sum / cnt) : 0, perDay: round2(cnt / days) };
    };
    const supplies = (list) => {
      const s = list.filter((o) => o.kind === 'supply');
      return { cnt: s.length, sum: round2(s.reduce((t, o) => t + o.total, 0)), paid: round2(s.filter((o) => ['paid', 'done'].includes(o.status)).reduce((t, o) => t + o.total, 0)) };
    };

    // ---------- по днях
    const series = [];
    const byDay = new Map();
    for (let d = from; d <= to && series.length < 400; d = nextDay(d)) { const r = { d, cnt: 0, sum: 0, supply: 0 }; series.push(r); byDay.set(d, r); }
    for (const o of cur) {
      const r = byDay.get(o.day);
      if (!r) continue;
      if (o.kind === 'client') { r.cnt++; r.sum = round2(r.sum + o.total); } else r.supply = round2(r.supply + o.total);
    }
    const weekdays = [0, 0, 0, 0, 0, 0, 0]; // пн..нд
    for (const o of cur) if (o.kind === 'client') weekdays[(new Date(`${o.day}T12:00:00Z`).getUTCDay() + 6) % 7]++;

    // ---------- товари, категорії, бренди (лише продажі)
    const clientItems = items.filter((i) => kindOf.get(i.order_id) === 'client');
    const pids = [...new Set(clientItems.map((i) => i.product_id))];
    const meta = pids.length ? new Map((await db.all(
      `SELECT c.product_id, c.brand_id, COALESCE(p.cat_manual, p.category_id) AS cat FROM b2b_catalog c LEFT JOIN an_products p ON p.product_id = c.product_id
       WHERE c.product_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(pids)],
    ).catch(() => [])).map((r) => [r.product_id, r])) : new Map();
    const nm = await names();
    const agg = (keyOf, nameOf) => {
      const m = new Map();
      for (const i of clientItems) {
        const k = keyOf(i);
        const r = m.get(k) || { key: k, name: nameOf(i, k), units: 0, sum: 0, rrp: 0, orders: new Set() };
        r.units += i.qty; r.sum += i.price * i.qty; r.rrp += (i.rrp || i.price) * i.qty; r.orders.add(i.order_id);
        m.set(k, r);
      }
      return [...m.values()].map((r) => ({
        key: r.key, name: r.name, units: r.units, sum: round2(r.sum), earn: round2(r.rrp - r.sum), orders: r.orders.size,
        marginPct: r.rrp ? round2(((r.rrp - r.sum) / r.rrp) * 100) : 0,
      })).sort((a, b) => b.sum - a.sum);
    };
    const products = agg((i) => i.product_id, (i) => i.name).slice(0, 100);
    const categories = agg((i) => meta.get(i.product_id)?.cat || 0, (i, k) => nm.cat.get(k) || 'Без категорії');
    const brands = agg((i) => meta.get(i.product_id)?.brand_id ?? 0, (i, k) => nm.brand.get(k) || 'Інші');

    // ---------- статуси в CRM
    const crm = new Map();
    for (const o of cur) if (o.kind === 'client') { const k = o.crm_status || (o.status === 'crm' ? 'Передано' : 'Ще не в CRM'); crm.set(k, (crm.get(k) || 0) + 1); }

    // ---------- борг і залишок (за весь час, не за період)
    const [debt, stockIn, stockOut] = await Promise.all([
      db.get(`SELECT SUM(CASE WHEN o.status = 'invoice_wait' THEN o.total ELSE 0 END) AS wait,
          SUM(CASE WHEN o.status IN ('pay_wait', 'partial') THEN o.total - o.paid_amount ELSE 0 END) AS due,
          SUM(CASE WHEN o.status IN ('pay_wait', 'partial') THEN 1 ELSE 0 END) AS due_cnt
        FROM b2b_orders o WHERE o.kind = 'supply' AND o.status IN ('invoice_wait', 'pay_wait', 'partial') ${byPartner}`, pp),
      db.get(`SELECT SUM(i.qty) AS units, SUM(i.qty * i.price) AS sum FROM b2b_order_items i JOIN b2b_orders o ON o.id = i.order_id
        WHERE o.kind = 'supply' AND o.status NOT IN ('cancelled', 'draft', 'confirm') ${byPartner}`, pp),
      db.get(`SELECT SUM(i.qty) AS units, SUM(i.qty * i.price) AS sum FROM b2b_order_items i JOIN b2b_orders o ON o.id = i.order_id
        WHERE o.kind = 'client' AND o.status != 'cancelled' AND o.supply_id IS NOT NULL ${byPartner}`, pp),
    ]);
    const noSupply = cur.filter((o) => o.kind === 'client' && (!o.supply_id || o.supply_status === 'open')).length;
    const unpaidClients = cur.filter((o) => o.kind === 'client' && !(o.supply_id ? ['paid', 'done'].includes(o.supply_status) : o.paid_at)).length;

    const out = {
      period: { from, to, days }, prev: { from: prevFrom, to: prevTo },
      sales: sales(cur, items), salesPrev: sales(prev, prevItems),
      supplies: supplies(cur), suppliesPrev: supplies(prev),
      noSupply, unpaidClients,
      debt: { wait: round2(debt?.wait || 0), due: round2(debt?.due || 0), dueCnt: debt?.due_cnt || 0 },
      stock: { units: (stockIn?.units || 0) - (stockOut?.units || 0), sum: round2((stockIn?.sum || 0) - (stockOut?.sum || 0)) },
      series, weekdays, products, categories, brands,
      crm: [...crm].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n),
    };
    // Адмін, усі партнери: рейтинг партнерів за період.
    if (!partnerId) {
      const ps = new Map((await db.all(`SELECT id, name FROM b2b_partners`)).map((p) => [p.id, { id: p.id, name: p.name, cnt: 0, sum: 0, supply: 0 }]));
      for (const o of cur) {
        const r = ps.get(o.partner_id);
        if (!r) continue;
        if (o.kind === 'client') { r.cnt++; r.sum = round2(r.sum + o.total); } else r.supply = round2(r.supply + o.total);
      }
      out.partners = [...ps.values()].filter((r) => r.cnt || r.supply).sort((a, b) => (b.sum + b.supply) - (a.sum + a.supply));
    }
    return out;
  }

  app.get('/api/b2b/p/stats', async (c) => {
    const p = await myPartner(c);
    return c.json(await report(p.id, c.req.query()));
  });
  app.get('/api/b2b/stats', async (c) => {
    need(c, 'b2b.admin');
    const pid = parseInt(c.req.query('partner'), 10) || null;
    if (pid && !(await db.get(`SELECT id FROM b2b_partners WHERE id = ?`, [pid]))) throw fail(404, 'Партнера не знайдено.');
    return c.json(await report(pid, c.req.query()));
  });
}
