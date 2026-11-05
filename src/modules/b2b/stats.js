// Аналітика B2B: продажі партнера (замовлення клієнтів), закупівлі, борг, залишок товару, топ товарів, категорії, бренди.
// Партнер бачить свою (/api/b2b/p/stats), адмін — будь-якого партнера або всіх разом (/api/b2b/stats).
// «Заробіток» — потенційна різниця між РРЦ і ціною партнера (якщо партнер продає за РРЦ).
// Даних мало (~10 замовлень на день), тож рахуємо в коді: 3–5 запитів до бази на звіт.
// Фільтри продажів: brands=1,2 / cats=5,0 (0 — «Інші» / «Без категорії») — лишають у замовленні тільки ці товари;
// delivered=1 — лише замовлення, доставлені за статусом LP-CRM. Закупівлі, борг і залишок фільтри не чіпають.
import { fail, need, round2 } from '../../core/common.js';
import { kyivDayStartIso, kyivDayOf, nextDay, isDay } from './filters.js';
import { crmTone } from './crm-tone.js';

const DAY = 86400000;
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const idSet = (v) => new Set(String(v || '').split(',').filter((x) => /^\d+$/.test(x)).map(Number));
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
    const byPartner = partnerId ? 'AND o.partner_id = ?' : '';
    const pp = partnerId ? [partnerId] : [];
    // all=1 — за весь час: від першого замовлення / закупівлі (без порівняння з попереднім періодом).
    const all = q.all === '1';
    const first = all ? (await db.get(`SELECT MIN(o.created_at) AS at FROM b2b_orders o WHERE o.status NOT IN ('cancelled', 'draft', 'confirm') ${byPartner}`, pp))?.at : '';
    const to = all ? today : isDay(q.to) ? q.to : today;
    const from = all ? (first ? kyivDayOf(first) : today) : isDay(q.from) && q.from <= to ? q.from : addDays(to, -29);
    const days = Math.min(daysBetween(from, to), 3000);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(days - 1));

    const orders = await db.all(
      `SELECT o.id, o.partner_id, o.kind, o.status, o.supply_id, o.total, o.paid_amount, o.paid_at, o.created_at, o.crm_status, s.status AS supply_status
       FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id
       WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ('cancelled', 'draft', 'confirm') ${byPartner}`,
      [kyivDayStartIso(prevFrom), kyivDayStartIso(nextDay(to)), ...pp],
    );
    for (const o of orders) { o.day = kyivDayOf(o.created_at); o.cur = o.day >= from; }
    const cur = orders.filter((o) => o.cur);
    const prev = orders.filter((o) => !o.cur);
    const clientIds = (list) => JSON.stringify(list.filter((o) => o.kind === 'client').map((o) => o.id));
    const [items, prevItems] = await Promise.all([
      cur.length ? db.all(`SELECT order_id, product_id, name, qty, price, rrp FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?))`, [clientIds(cur)]) : [],
      prev.length ? db.all(`SELECT order_id, product_id, qty, price, rrp FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?))`, [clientIds(prev)]) : [],
    ]);

    // ---------- бренд і категорія товарів (для фільтрів і розрізів)
    const pids = [...new Set([...items, ...prevItems].map((i) => i.product_id))];
    const meta = pids.length ? new Map((await db.all(
      `SELECT c.product_id, c.brand_id, COALESCE(p.cat_manual, p.category_id) AS cat FROM b2b_catalog c LEFT JOIN an_products p ON p.product_id = c.product_id
       WHERE c.product_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(pids)],
    ).catch(() => [])).map((r) => [r.product_id, r])) : new Map();
    const brandOf = (i) => meta.get(i.product_id)?.brand_id || 0;
    const catOf = (i) => meta.get(i.product_id)?.cat || 0;
    const nm = await names();

    // ---------- фільтри
    const fBrands = idSet(q.brands);
    const fCats = idSet(q.cats);
    const delivered = q.delivered === '1';
    const byItems = fBrands.size > 0 || fCats.size > 0;
    const okOrder = (o) => o.kind === 'client' && (!delivered || crmTone(o.crm_status) === 'ok');
    // Розклад фільтрів: скільки штук продано кожного бренду / категорії (без урахування фільтра цього ж виду).
    const facet = (keyOf, nameOf, other) => {
      const ok = new Set(cur.filter(okOrder).map((o) => o.id));
      const m = new Map();
      for (const i of items) {
        if (!ok.has(i.order_id) || (other.size && !other.has(other === fBrands ? brandOf(i) : catOf(i)))) continue;
        const k = keyOf(i);
        const r = m.get(k) || { id: k, name: nameOf(k), units: 0 };
        r.units += i.qty;
        m.set(k, r);
      }
      return [...m.values()].sort((a, b) => b.units - a.units);
    };
    const facets = {
      brands: facet(brandOf, (k) => nm.brand.get(k) || 'Інші', fCats),
      cats: facet(catOf, (k) => nm.cat.get(k) || 'Без категорії', fBrands),
    };
    const itemOk = (i) => (!fBrands.size || fBrands.has(brandOf(i))) && (!fCats.size || fCats.has(catOf(i)));
    // Замовлення клієнтів після фільтрів: сума — лише товари, що пройшли фільтр (без фільтра товарів — сума замовлення).
    const filterOrders = (list, its) => {
      const byOrder = new Map();
      for (const i of its) if (itemOk(i)) { const a = byOrder.get(i.order_id) || []; a.push(i); byOrder.set(i.order_id, a); }
      const out = [];
      for (const o of list) {
        if (!okOrder(o)) continue;
        const li = byOrder.get(o.id) || [];
        if (byItems && !li.length) continue;
        const sum = byItems ? round2(li.reduce((t, i) => t + i.price * i.qty, 0)) : o.total;
        const rrp = round2(li.reduce((t, i) => t + (i.rrp || i.price) * i.qty, 0));
        out.push({ ...o, fsum: sum, frrp: rrp, funits: li.reduce((t, i) => t + i.qty, 0), fitems: li });
      }
      return out;
    };
    const curF = filterOrders(cur, items);
    const prevF = filterOrders(prev, prevItems);

    // ---------- показники продажів (замовлення клієнтів)
    const sales = (list) => {
      const sum = round2(list.reduce((t, o) => t + o.fsum, 0));
      const rrp = round2(list.reduce((t, o) => t + o.frrp, 0));
      const cnt = list.length;
      const bad = list.filter((o) => crmTone(o.crm_status) === 'bad').length;
      return { cnt, units: list.reduce((t, o) => t + o.funits, 0), sum, rrp, earn: round2(rrp - sum), avg: cnt ? round2(sum / cnt) : 0, perDay: round2(cnt / days),
        returns: bad, returnsPct: cnt ? round2((bad / cnt) * 100) : 0 };
    };
    const supplies = (list) => {
      const s = list.filter((o) => o.kind === 'supply');
      return { cnt: s.length, sum: round2(s.reduce((t, o) => t + o.total, 0)), paid: round2(s.filter((o) => ['paid', 'done'].includes(o.status)).reduce((t, o) => t + o.total, 0)) };
    };

    // ---------- по днях
    const series = [];
    const byDay = new Map();
    for (let d = from; d <= to && series.length < 3000; d = nextDay(d)) { const r = { d, cnt: 0, sum: 0, earn: 0, supply: 0 }; series.push(r); byDay.set(d, r); }
    for (const o of curF) {
      const r = byDay.get(o.day);
      if (r) { r.cnt++; r.sum = round2(r.sum + o.fsum); r.earn = round2(r.earn + o.frrp - o.fsum); }
    }
    for (const o of cur) if (o.kind === 'supply' && byDay.get(o.day)) byDay.get(o.day).supply = round2(byDay.get(o.day).supply + o.total);
    const weekdays = [0, 0, 0, 0, 0, 0, 0]; // пн..нд
    for (const o of curF) weekdays[(new Date(`${o.day}T12:00:00Z`).getUTCDay() + 6) % 7]++;

    // ---------- товари, категорії, бренди (лише продажі, після фільтрів)
    const clientItems = curF.flatMap((o) => o.fitems);
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
    const categories = agg(catOf, (i, k) => nm.cat.get(k) || 'Без категорії');
    const brands = agg(brandOf, (i, k) => nm.brand.get(k) || 'Інші');

    // ---------- статуси в CRM
    const crm = new Map();
    const delivery = { ok: 0, info: 0, bad: 0, none: 0 };
    for (const o of curF) {
      const k = o.crm_status || (o.status === 'crm' ? 'Передано' : 'Ще не в CRM');
      crm.set(k, (crm.get(k) || 0) + 1);
      delivery[crmTone(o.crm_status) || 'none']++;
    }

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
    const noSupply = curF.filter((o) => !o.supply_id || o.supply_status === 'open').length;
    const unpaidClients = curF.filter((o) => !(o.supply_id ? ['paid', 'done'].includes(o.supply_status) : o.paid_at)).length;

    const out = {
      period: { from, to, days, all }, prev: { from: prevFrom, to: prevTo },
      sales: sales(curF), salesPrev: sales(prevF),
      filters: { brands: [...fBrands], cats: [...fCats], delivered }, facets, delivery,
      supplies: supplies(cur), suppliesPrev: supplies(prev),
      noSupply, unpaidClients,
      debt: { wait: round2(debt?.wait || 0), due: round2(debt?.due || 0), dueCnt: debt?.due_cnt || 0 },
      stock: { units: (stockIn?.units || 0) - (stockOut?.units || 0), sum: round2((stockIn?.sum || 0) - (stockOut?.sum || 0)) },
      series, weekdays, products, categories, brands,
      crm: [...crm].map(([status, n]) => ({ status, n, tone: crmTone(status) })).sort((a, b) => b.n - a.n),
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
