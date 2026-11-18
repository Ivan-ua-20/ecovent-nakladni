// Правила маржі й акції B2B (b2b_margin_rules): знижка від РРЦ на бренд, категорію або товар — для дропшипінгу (margin)
// і B2B на склад партнера (margin_wh, порожньо — та сама), постійно або на період «з–по», для одного, кількох чи всіх партнерів.
// Розрахунок — у PM_COLS (orders.js): акція (з датами) завжди важливіша за постійну маржу; серед однакових — точніша
// (товар → категорія → бренд). Тут — керування правилами й «Перевірити ціну».
import { fail, need, nowIso, kyivDay } from '../../core/common.js';
import { PM_JOIN, PM_COLS } from './orders.js';

const LEVELS = { brand: 'Бренд', category: 'Категорія', product: 'Товар' };
const J = (a) => JSON.stringify(a);
const day = (v) => { const s = String(v ?? '').trim(); if (!s) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw fail(400, 'Дата — у форматі РРРР-ММ-ДД.'); return s; };
const pct = (v, label, allowEmpty = false) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '' && allowEmpty) return null;
  const n = Number(s);
  if (s === '' || !Number.isFinite(n) || n < 0 || n > 90) throw fail(400, `${label}: знижка від РРЦ — від 0 до 90 %${allowEmpty ? ' (або порожньо — та сама)' : ''}.`);
  return Math.round(n * 100) / 100;
};
const parseIds = (v) => { try { return (JSON.parse(v || '[]') || []).map(Number).filter(Boolean); } catch { return []; } };

export function mountB2bMargins(app, { db, brandNames, partnerPrice }) {
  const userName = (c) => { const u = c.get('user'); return String(u?.name || u?.login || '').slice(0, 80); };
  const catNames = async () => new Map((await db.all(`SELECT id, name FROM an_categories`).catch(() => [])).map((r) => [r.id, r.name]));
  const status = (r, t) => (!r.date_from && !r.date_to ? 'permanent' : r.date_to && r.date_to < t ? 'past' : r.date_from && r.date_from > t ? 'planned' : 'active');

  async function describe(rows) {
    const [brands, cats, partners] = await Promise.all([brandNames(), catNames(), db.all(`SELECT id, name FROM b2b_partners WHERE COALESCE(deleted_at, '') = ''`)]);
    const pIds = [...new Set(rows.filter((r) => r.level === 'product').map((r) => r.ref_id))];
    const prods = new Map(pIds.length ? (await db.all(`SELECT product_id, name, rrp FROM b2b_catalog WHERE product_id IN (SELECT value FROM json_each(?))`, [J(pIds)])).map((p) => [p.product_id, p]) : []);
    const pn = new Map(partners.map((p) => [p.id, p.name]));
    const t = kyivDay();
    return rows.map((r) => {
      const ids = parseIds(r.partners);
      return {
        id: r.id, name: r.name, level: r.level, level_name: LEVELS[r.level], ref_id: r.ref_id,
        ref_name: r.level === 'brand' ? brands.get(r.ref_id) || `Бренд ${r.ref_id}` : r.level === 'category' ? cats.get(r.ref_id) || `Категорія ${r.ref_id}` : prods.get(r.ref_id)?.name || `Товар ${r.ref_id}`,
        rrp: r.level === 'product' ? prods.get(r.ref_id)?.rrp || null : null,
        margin: r.margin, margin_wh: r.margin_wh, date_from: r.date_from, date_to: r.date_to, promo: Boolean(r.date_from || r.date_to),
        partners: ids, partner_names: ids.map((id) => pn.get(id) || `#${id}`), all: !ids.length,
        status: status(r, t), created_by: r.created_by, created_at: r.created_at, updated_by: r.updated_by, updated_at: r.updated_at,
      };
    });
  }

  // Список: усі правила або ті, що стосуються партнера (його власні + «для всіх»).
  app.get('/api/b2b/margin-rules', async (c) => {
    need(c, 'b2b.admin');
    const pid = Number(c.req.query('partner')) || 0;
    const rows = await db.all(`SELECT * FROM b2b_margin_rules r WHERE r.deleted_at = ''
      ${pid ? `AND (r.partners = '' OR EXISTS (SELECT 1 FROM json_each(r.partners) WHERE CAST(value AS INTEGER) = ?))` : ''}
      ORDER BY (r.date_from = '' AND r.date_to = ''), CASE WHEN r.date_to != '' AND r.date_to < ? THEN 1 ELSE 0 END, r.date_from DESC, r.id DESC LIMIT 500`, pid ? [pid, kyivDay()] : [kyivDay()]);
    return c.json({ rules: await describe(rows) });
  });
  // Довідники для вікна правила: бренди й категорії з кількістю товарів у каталозі, партнери.
  app.get('/api/b2b/margin-rules/meta', async (c) => {
    need(c, 'b2b.admin');
    const [brands, cats, bc, cc, partners] = await Promise.all([
      brandNames(), catNames(),
      db.all(`SELECT brand_id, COUNT(*) AS n FROM b2b_catalog WHERE hidden = 0 AND rrp > 0 GROUP BY brand_id`),
      db.all(`SELECT COALESCE(a.cat_manual, a.category_id) AS cat, COUNT(*) AS n FROM b2b_catalog c JOIN an_products a ON a.product_id = c.product_id
        WHERE c.hidden = 0 AND c.rrp > 0 GROUP BY COALESCE(a.cat_manual, a.category_id)`).catch(() => []),
      db.all(`SELECT id, name FROM b2b_partners WHERE active = 1 AND COALESCE(deleted_at, '') = '' ORDER BY name`),
    ]);
    return c.json({
      levels: LEVELS,
      brands: bc.map((r) => ({ id: r.brand_id, name: brands.get(r.brand_id) || 'Інші', n: r.n })).sort((a, b) => a.name.localeCompare(b.name, 'uk')),
      categories: cc.filter((r) => r.cat).map((r) => ({ id: r.cat, name: cats.get(r.cat) || `Категорія ${r.cat}`, n: r.n })).sort((a, b) => a.name.localeCompare(b.name, 'uk')),
      partners, today: kyivDay(),
    });
  });

  async function fields(b) {
    const level = LEVELS[b.level] ? b.level : '';
    if (!level) throw fail(400, 'Оберіть, для чого правило: бренд, категорія чи товар.');
    const ref = Number(b.ref_id) || 0;
    if (!ref) throw fail(400, `Оберіть ${level === 'brand' ? 'бренд' : level === 'category' ? 'категорію' : 'товар'}.`);
    if (level === 'brand' && !(await brandNames()).has(ref)) throw fail(400, 'Бренд не знайдено.');
    if (level === 'category' && !(await db.get(`SELECT id FROM an_categories WHERE id = ?`, [ref]).catch(() => null))) throw fail(400, 'Категорію не знайдено.');
    if (level === 'product' && !(await db.get(`SELECT product_id FROM b2b_catalog WHERE product_id = ?`, [ref]))) throw fail(400, 'Товар не знайдено в каталозі.');
    const margin = pct(b.margin, 'Дропшипінг');
    const marginWh = pct(b.margin_wh, 'B2B (на склад)', true);
    const promo = b.promo !== false;
    const from = promo ? day(b.date_from) : '';
    const to = promo ? day(b.date_to) : '';
    if (promo && (!from || !to)) throw fail(400, 'Акція: вкажіть дати «з» і «по».');
    if (from && to && from > to) throw fail(400, 'Дата «з» пізніша за «по».');
    let partners = '';
    if (Array.isArray(b.partners) && b.partners.length) {
      const ids = [...new Set(b.partners.map(Number).filter(Boolean))];
      const ok = await db.all(`SELECT id FROM b2b_partners WHERE id IN (SELECT value FROM json_each(?)) AND COALESCE(deleted_at, '') = ''`, [J(ids)]);
      if (ok.length !== ids.length) throw fail(400, 'Не всіх партнерів знайдено — оновіть сторінку.');
      partners = J(ids.sort((x, y) => x - y));
    }
    return { name: String(b.name ?? '').trim().slice(0, 80), level, ref_id: ref, margin, margin_wh: marginWh, date_from: from, date_to: to, partners };
  }
  // Перетин з іншим правилом того самого рівня й об'єкта (для тих самих партнерів) — заборонено, щоб не було двозначності.
  async function overlap(f, exceptId = 0) {
    const rows = await db.all(`SELECT * FROM b2b_margin_rules WHERE deleted_at = '' AND level = ? AND ref_id = ? AND id != ?`, [f.level, f.ref_id, exceptId]);
    const mine = parseIds(f.partners);
    const promo = Boolean(f.date_from || f.date_to);
    for (const r of rows) {
      const theirs = parseIds(r.partners);
      const samePartners = !mine.length || !theirs.length || mine.some((x) => theirs.includes(x));
      if (!samePartners) continue;
      const rPromo = Boolean(r.date_from || r.date_to);
      if (promo !== rPromo) continue; // акція поверх постійної — так і задумано
      const cross = !promo || ((f.date_from || '0000') <= (r.date_to || '9999') && (r.date_from || '0000') <= (f.date_to || '9999'));
      if (cross) {
        const what = promo ? `акцією${r.name ? ` «${r.name}»` : ''} ${r.date_from.split('-').reverse().join('.')}–${r.date_to.split('-').reverse().join('.')}` : 'постійним правилом';
        throw fail(400, `Перетинається з ${what} на той самий ${LEVELS[f.level].toLowerCase()} — змініть дати або відредагуйте наявне правило.`);
      }
    }
  }
  app.post('/api/b2b/margin-rules', async (c) => {
    need(c, 'b2b.admin');
    const f = await fields(await c.req.json().catch(() => ({})));
    await overlap(f);
    const r = await db.run(`INSERT INTO b2b_margin_rules (name, level, ref_id, margin, margin_wh, date_from, date_to, partners, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.name, f.level, f.ref_id, f.margin, f.margin_wh, f.date_from, f.date_to, f.partners, userName(c), nowIso()]);
    return c.json({ id: r.lastId });
  });
  app.put('/api/b2b/margin-rules/:id{[0-9]+}', async (c) => {
    need(c, 'b2b.admin');
    const id = Number(c.req.param('id'));
    if (!(await db.get(`SELECT id FROM b2b_margin_rules WHERE id = ? AND deleted_at = ''`, [id]))) throw fail(404, 'Правило не знайдено.');
    const f = await fields(await c.req.json().catch(() => ({})));
    await overlap(f, id);
    await db.run(`UPDATE b2b_margin_rules SET name = ?, level = ?, ref_id = ?, margin = ?, margin_wh = ?, date_from = ?, date_to = ?, partners = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
      [f.name, f.level, f.ref_id, f.margin, f.margin_wh, f.date_from, f.date_to, f.partners, userName(c), nowIso(), id]);
    return c.json({ ok: true });
  });
  app.delete('/api/b2b/margin-rules/:id{[0-9]+}', async (c) => {
    need(c, 'b2b.admin');
    await db.run(`UPDATE b2b_margin_rules SET deleted_at = ?, updated_by = ? WHERE id = ?`, [nowIso(), userName(c), Number(c.req.param('id'))]);
    return c.json({ ok: true });
  });

  // «Перевірити ціну»: ціна партнера на товар на дату — той самий розрахунок, що й у каталозі й закупівлях.
  app.get('/api/b2b/margin-rules/check', async (c) => {
    need(c, 'b2b.admin');
    const pid = Number(c.req.query('partner')) || 0;
    const prod = Number(c.req.query('product')) || 0;
    const at = day(c.req.query('date')) || kyivDay();
    const row = await db.get(`SELECT c.product_id, c.name, c.rrp, c.brand_id, ${PM_COLS} FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id ${PM_JOIN}
      WHERE m.partner_id = ? AND c.product_id = ?`, [at, pid, prod]);
    if (!row) throw fail(404, 'Бренд цього товару партнеру не відкрито — ціни немає.');
    return c.json({ date: at, product: { id: row.product_id, name: row.name, rrp: row.rrp }, margin: row.margin, margin_wh: row.margin_wh,
      price: partnerPrice(row.rrp, row.margin), price_wh: partnerPrice(row.rrp, row.margin_wh), promo: Boolean(row.special), promo_until: row.special_until, promo_name: row.promo_name });
  });
}
