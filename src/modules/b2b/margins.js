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

export function mountB2bMargins(app, { db, brandNames, partnerPrice, onCron = () => {} }) {
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
    const rows = await db.all(`SELECT * FROM b2b_margin_rules r WHERE r.deleted_at = '' AND COALESCE(r.promo_id, 0) = 0
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
  // exceptPromo — не порівнювати з позиціями цієї акції (вона перезаписується цілком).
  async function overlap(f, exceptId = 0, exceptPromo = 0) {
    const rows = await db.all(`SELECT * FROM b2b_margin_rules WHERE deleted_at = '' AND level = ? AND ref_id = ? AND id != ? AND COALESCE(promo_id, 0) != ?`,
      [f.level, f.ref_id, exceptId, exceptPromo || -1]);
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
    const was = await db.get(`SELECT id, promo_id FROM b2b_margin_rules WHERE id = ? AND deleted_at = ''`, [id]);
    if (!was) throw fail(404, 'Правило не знайдено.');
    if (was.promo_id) throw fail(400, 'Це позиція акції — змініть її у вікні акції.');
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

  // ================================================================ Акції
  // Акція = назва, дати й «кому» один раз + позиції (бренд / категорія / товар) зі своїми відсотками.
  // Позиції зберігаються як правила b2b_margin_rules з promo_id — тож розрахунок цін той самий (PM_COLS).
  const promoStatus = (p, t) => (p.stopped_at ? 'stopped' : p.date_to < t ? 'past' : p.date_from > t ? 'planned' : 'active');
  // 00:00 за Києвом у день d → ISO (UTC)
  const kyivStartIso = (d) => {
    const probe = new Date(`${d}T12:00:00Z`);
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', hourCycle: 'h23' }).format(probe));
    return new Date(Date.parse(`${d}T00:00:00Z`) - (h - 12) * 3600e3).toISOString();
  };
  // Товари каталогу, які охоплюють позиції (бренд / категорія / товар).
  async function covered(items) {
    if (!items.length) return [];
    const ids = (lv) => J([...new Set(items.filter((i) => i.level === lv).map((i) => Number(i.ref_id)))]);
    return db.all(`SELECT c.product_id, c.name, c.article, c.rrp, c.brand_id, COALESCE(a.cat_manual, a.category_id, 0) AS cat
      FROM b2b_catalog c LEFT JOIN an_products a ON a.product_id = c.product_id
      WHERE c.hidden = 0 AND (c.brand_id IN (SELECT value FROM json_each(?)) OR COALESCE(a.cat_manual, a.category_id, 0) IN (SELECT value FROM json_each(?))
        OR c.product_id IN (SELECT value FROM json_each(?))) ORDER BY c.name LIMIT 3000`, [ids('brand'), ids('category'), ids('product')]);
  }
  // Позиція акції, що спрацює на товар: товар → категорія → бренд.
  const itemFor = (items, r) => (r ? items.find((i) => i.level === 'product' && Number(i.ref_id) === r.product_id)
    || items.find((i) => i.level === 'category' && Number(i.ref_id) === r.cat) || items.find((i) => i.level === 'brand' && Number(i.ref_id) === r.brand_id) : null);
  // РРЦ на початок дня d: «було» з першої зміни ціни після цього моменту, інакше — поточна.
  async function rrpAt(rows, d) {
    if (!rows.length) return new Map();
    const logs = await db.all(`SELECT product_id, old_rrp FROM b2b_price_log WHERE at >= ? AND product_id IN (SELECT value FROM json_each(?)) ORDER BY at, id`,
      [kyivStartIso(d), J(rows.map((r) => r.product_id))]);
    const first = new Map();
    for (const l of logs) if (!first.has(l.product_id) && l.old_rrp > 0) first.set(l.product_id, l.old_rrp);
    return new Map(rows.map((r) => [r.product_id, first.get(r.product_id) || r.rrp]));
  }
  // Зафіксувати РРЦ на старт для товарів акції, яка вже почалась (тих, яких ще немає в b2b_promo_rrp).
  async function snapshot(p) {
    if (!p || !p.fix_rrp || p.stopped_at || p.deleted_at || p.date_from > kyivDay()) return 0;
    const items = await db.all(`SELECT level, ref_id FROM b2b_margin_rules WHERE promo_id = ? AND deleted_at = ''`, [p.id]);
    const have = new Set((await db.all(`SELECT product_id FROM b2b_promo_rrp WHERE promo_id = ?`, [p.id])).map((r) => r.product_id));
    const todo = (await covered(items)).filter((r) => r.rrp > 0 && !have.has(r.product_id));
    if (!todo.length) return 0;
    const at = await rrpAt(todo, p.date_from);
    for (let i = 0; i < todo.length; i += 80) {
      await db.batch(todo.slice(i, i + 80).map((r) => [`INSERT OR IGNORE INTO b2b_promo_rrp (promo_id, product_id, rrp) VALUES (?, ?, ?)`, [p.id, r.product_id, at.get(r.product_id)]]));
    }
    return todo.length;
  }
  onCron('b2b-promos', 'B2B «Акції»: РРЦ на початок акцій', async () => {
    const t = kyivDay();
    const list = await db.all(`SELECT * FROM b2b_promos WHERE deleted_at = '' AND stopped_at = '' AND fix_rrp = 1 AND date_from <= ? AND date_to >= ?`, [t, t]);
    let n = 0;
    for (const p of list) n += await snapshot(p);
    return { ok: true, promos: list.length, fixed: n };
  });

  // Поля акції + позиції.
  async function promoFields(b, id = 0) {
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (!name) throw fail(400, 'Вкажіть назву акції.');
    const from = day(b.date_from);
    const to = day(b.date_to);
    if (!from || !to) throw fail(400, 'Вкажіть дати акції «з» і «по».');
    if (from > to) throw fail(400, 'Дата «з» пізніша за «по».');
    let partners = '';
    if (Array.isArray(b.partners) && b.partners.length) {
      const ids = [...new Set(b.partners.map(Number).filter(Boolean))];
      const ok = await db.all(`SELECT id FROM b2b_partners WHERE id IN (SELECT value FROM json_each(?)) AND COALESCE(deleted_at, '') = ''`, [J(ids)]);
      if (ok.length !== ids.length) throw fail(400, 'Не всіх партнерів знайдено — оновіть сторінку.');
      partners = J(ids.sort((x, y) => x - y));
    }
    const raw = Array.isArray(b.items) ? b.items : [];
    if (!raw.length) throw fail(400, 'Додайте в акцію хоча б один бренд, категорію чи товар.');
    if (raw.length > 1000) throw fail(400, 'Забагато позицій (до 1000).');
    const brands = await brandNames();
    const cats = await catNames();
    const prodIds = raw.filter((i) => i.level === 'product').map((i) => Number(i.ref_id));
    const prods = new Map(prodIds.length ? (await db.all(`SELECT product_id, name FROM b2b_catalog WHERE product_id IN (SELECT value FROM json_each(?))`, [J(prodIds)])).map((r) => [r.product_id, r.name]) : []);
    const seen = new Set();
    const items = [];
    for (const i of raw) {
      const level = LEVELS[i.level] ? i.level : '';
      const ref = Number(i.ref_id) || 0;
      if (!level || !ref) throw fail(400, 'Позиція акції без бренду, категорії чи товару.');
      const nm = level === 'brand' ? brands.get(ref) : level === 'category' ? cats.get(ref) : prods.get(ref);
      if (!nm) throw fail(400, `${LEVELS[level]} #${ref} не знайдено — оновіть сторінку.`);
      const k = `${level}:${ref}`;
      if (seen.has(k)) throw fail(400, `«${nm}» додано в акцію двічі.`);
      seen.add(k);
      items.push({ level, ref_id: ref, ref_name: nm, margin: pct(i.margin, nm), margin_wh: pct(i.margin_wh, `${nm} (B2B)`, true) });
    }
    // перетин з іншими акціями на той самий бренд / категорію / товар
    for (const it of items) {
      try { await overlap({ ...it, date_from: from, date_to: to, partners }, 0, id || -1); } catch (e) { throw fail(400, `«${it.ref_name}»: ${e.message}`); }
    }
    return { name, date_from: from, date_to: to, partners, fix_rrp: b.fix_rrp === false ? 0 : 1, items };
  }
  async function savePromo(c, id, f) {
    const who = userName(c);
    const now = nowIso();
    if (id) {
      await db.run(`UPDATE b2b_promos SET name = ?, date_from = ?, date_to = ?, partners = ?, fix_rrp = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
        [f.name, f.date_from, f.date_to, f.partners, f.fix_rrp, who, now, id]);
    } else {
      id = (await db.run(`INSERT INTO b2b_promos (name, date_from, date_to, partners, fix_rrp, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [f.name, f.date_from, f.date_to, f.partners, f.fix_rrp, who, now])).lastId;
    }
    // позиції перезаписуються цілком; знімок РРЦ — заново (дати чи фіксація могли змінитись; відновлюється з журналу цін)
    const st = [[`DELETE FROM b2b_margin_rules WHERE promo_id = ?`, [id]], [`DELETE FROM b2b_promo_rrp WHERE promo_id = ?`, [id]]];
    for (const it of f.items) {
      st.push([`INSERT INTO b2b_margin_rules (name, level, ref_id, margin, margin_wh, date_from, date_to, partners, promo_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [f.name, it.level, it.ref_id, it.margin, it.margin_wh, f.date_from, f.date_to, f.partners, id, who, now]]);
    }
    for (let i = 0; i < st.length; i += 100) await db.batch(st.slice(i, i + 100));
    await snapshot(await db.get(`SELECT * FROM b2b_promos WHERE id = ?`, [id]));
    return id;
  }
  const promoOf = async (id) => {
    const p = await db.get(`SELECT * FROM b2b_promos WHERE id = ? AND deleted_at = ''`, [Number(id)]);
    if (!p) throw fail(404, 'Акцію не знайдено.');
    return p;
  };

  app.get('/api/b2b/promos', async (c) => {
    need(c, 'b2b.admin');
    const pid = Number(c.req.query('partner')) || 0;
    const t = kyivDay();
    const rows = await db.all(`SELECT p.*, (SELECT COUNT(*) FROM b2b_margin_rules r WHERE r.promo_id = p.id AND r.level = 'brand') AS nb,
        (SELECT COUNT(*) FROM b2b_margin_rules r WHERE r.promo_id = p.id AND r.level = 'category') AS nc,
        (SELECT COUNT(*) FROM b2b_margin_rules r WHERE r.promo_id = p.id AND r.level = 'product') AS np
      FROM b2b_promos p WHERE p.deleted_at = ''
      ${pid ? `AND (p.partners = '' OR EXISTS (SELECT 1 FROM json_each(p.partners) WHERE CAST(value AS INTEGER) = ?))` : ''}
      ORDER BY CASE WHEN p.stopped_at = '' AND p.date_to >= ? THEN 0 ELSE 1 END, p.date_from DESC, p.id DESC LIMIT 200`, pid ? [pid, t] : [t]);
    const pn = new Map((await db.all(`SELECT id, name FROM b2b_partners`)).map((p) => [p.id, p.name]));
    return c.json({ today: t, promos: rows.map((p) => {
      const ids = parseIds(p.partners);
      return { id: p.id, name: p.name, date_from: p.date_from, date_to: p.date_to, fix_rrp: Boolean(p.fix_rrp), status: promoStatus(p, t), stopped_at: p.stopped_at,
        all: !ids.length, partners: ids, partner_names: ids.map((x) => pn.get(x) || `#${x}`), brands: p.nb, categories: p.nc, products: p.np };
    }) });
  });
  app.get('/api/b2b/promos/:id{[0-9]+}', async (c) => {
    need(c, 'b2b.admin');
    const p = await promoOf(c.req.param('id'));
    const rules = await db.all(`SELECT level, ref_id, margin, margin_wh FROM b2b_margin_rules WHERE promo_id = ? ORDER BY id`, [p.id]);
    const [brands, cats] = await Promise.all([brandNames(), catNames()]);
    const pIds = rules.filter((r) => r.level === 'product').map((r) => r.ref_id);
    const prods = new Map(pIds.length ? (await db.all(`SELECT product_id, name, article, rrp, brand_id FROM b2b_catalog WHERE product_id IN (SELECT value FROM json_each(?))`, [J(pIds)])).map((r) => [r.product_id, r]) : []);
    const ids = parseIds(p.partners);
    return c.json({
      id: p.id, name: p.name, date_from: p.date_from, date_to: p.date_to, fix_rrp: Boolean(p.fix_rrp), partners: ids, all: !ids.length,
      status: promoStatus(p, kyivDay()), stopped_at: p.stopped_at,
      items: rules.map((r) => {
        const pr = prods.get(r.ref_id);
        return {
          level: r.level, ref_id: r.ref_id, margin: r.margin, margin_wh: r.margin_wh,
          ref_name: r.level === 'brand' ? brands.get(r.ref_id) || `Бренд ${r.ref_id}` : r.level === 'category' ? cats.get(r.ref_id) || `Категорія ${r.ref_id}` : pr?.name || `Товар ${r.ref_id}`,
          ...(r.level === 'product' ? { article: pr?.article || '', rrp: pr?.rrp || 0, brand_id: pr?.brand_id || 0, brand: brands.get(pr?.brand_id) || 'Інші' } : {}),
        };
      }),
    });
  });
  app.post('/api/b2b/promos', async (c) => {
    need(c, 'b2b.admin');
    const f = await promoFields(await c.req.json().catch(() => ({})));
    return c.json({ id: await savePromo(c, 0, f) });
  });
  app.put('/api/b2b/promos/:id{[0-9]+}', async (c) => {
    need(c, 'b2b.admin');
    const p = await promoOf(c.req.param('id'));
    if (p.stopped_at) throw fail(400, 'Акцію зупинено — створіть нову («Повторити»).');
    const f = await promoFields(await c.req.json().catch(() => ({})), p.id);
    await savePromo(c, p.id, f);
    return c.json({ ok: true, id: p.id });
  });
  // Зупинити: позиції перестають діяти з сьогодні, акція лишається в історії.
  app.post('/api/b2b/promos/:id{[0-9]+}/stop', async (c) => {
    need(c, 'b2b.admin');
    const p = await promoOf(c.req.param('id'));
    const y = new Date(Date.parse(`${kyivDay()}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    await db.batch([
      [`UPDATE b2b_margin_rules SET date_to = ?, updated_by = ?, updated_at = ? WHERE promo_id = ?`, [y < p.date_from ? '0000-00-00' : y, userName(c), nowIso(), p.id]],
      [`UPDATE b2b_promos SET stopped_at = ?, updated_by = ? WHERE id = ?`, [nowIso(), userName(c), p.id]],
    ]);
    return c.json({ ok: true });
  });
  app.delete('/api/b2b/promos/:id{[0-9]+}', async (c) => {
    need(c, 'b2b.admin');
    const p = await promoOf(c.req.param('id'));
    await db.batch([
      [`DELETE FROM b2b_margin_rules WHERE promo_id = ?`, [p.id]],
      [`DELETE FROM b2b_promo_rrp WHERE promo_id = ?`, [p.id]],
      [`UPDATE b2b_promos SET deleted_at = ?, updated_by = ? WHERE id = ?`, [nowIso(), userName(c), p.id]],
    ]);
    return c.json({ ok: true });
  });

  // Товари бренду чи категорії — для вибору галочками.
  app.get('/api/b2b/promos/products', async (c) => {
    need(c, 'b2b.admin');
    const brand = Number(c.req.query('brand')) || 0;
    const cat = Number(c.req.query('category')) || 0;
    if (!brand && !cat) throw fail(400, 'Оберіть бренд або категорію.');
    const rows = await db.all(`SELECT c.product_id AS id, c.name, c.article, c.rrp, c.brand_id FROM b2b_catalog c LEFT JOIN an_products a ON a.product_id = c.product_id
      WHERE c.hidden = 0 AND ${brand ? 'c.brand_id = ?' : 'COALESCE(a.cat_manual, a.category_id, 0) = ?'} ORDER BY c.name LIMIT 1000`, [brand || cat]);
    const brands = await brandNames();
    return c.json({ products: rows.map((r) => ({ ...r, brand: brands.get(r.brand_id) || 'Інші' })) });
  });
  // Вставлені артикули (стовпець з Excel / Google Таблиці) → товари каталогу; що не знайшлося — окремо.
  app.post('/api/b2b/promos/resolve', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json().catch(() => ({}));
    const codes = [...new Set(String(b.text || '').split(/[\n\r\t;,]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 1000);
    if (!codes.length) return c.json({ found: [], missing: [] });
    const rows = await db.all(`SELECT c.product_id AS id, c.name, c.article, c.rrp, c.brand_id FROM b2b_catalog c
      WHERE c.hidden = 0 AND (LOWER(TRIM(c.article)) IN (SELECT LOWER(value) FROM json_each(?)) OR CAST(c.product_id AS TEXT) IN (SELECT value FROM json_each(?)))`, [J(codes), J(codes)]);
    const brands = await brandNames();
    const byArt = new Map();
    const byId = new Map();
    for (const r of rows) { if (r.article) byArt.set(String(r.article).trim().toLowerCase(), r); byId.set(String(r.id), r); }
    const found = new Map();
    const missing = [];
    for (const code of codes) {
      const r = byArt.get(code.toLowerCase()) || byId.get(code);
      if (r) found.set(r.id, { ...r, brand: brands.get(r.brand_id) || 'Інші', code }); else missing.push(code);
    }
    return c.json({ found: [...found.values()], missing });
  });
  // Перевірка перед збереженням: ціни для партнера на акції, попередження (без РРЦ, звичайна маржа вища), помилки (перетини).
  app.post('/api/b2b/promos/preview', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json().catch(() => ({}));
    const id = Number(b.id) || 0;
    const errors = [];
    let f = null;
    try { f = await promoFields(b, id); } catch (e) { errors.push(e.message); }
    const items = f?.items || (Array.isArray(b.items) ? b.items.map((i) => ({ level: i.level, ref_id: Number(i.ref_id), margin: Number(i.margin) || 0 })) : []);
    const rows = await covered(items);
    const from = f?.date_from || (/^\d{4}-\d{2}-\d{2}$/.test(String(b.date_from || '')) ? b.date_from : kyivDay());
    const fix = b.fix_rrp !== false;
    const base = fix ? await rrpAt(rows.filter((r) => r.rrp > 0), from) : new Map();
    const warnings = [];
    const noRrp = rows.filter((r) => !(r.rrp > 0));
    if (noRrp.length) warnings.push(`Без РРЦ (знижка не діє): ${noRrp.length} — ${noRrp.slice(0, 5).map((r) => r.name).join(', ')}${noRrp.length > 5 ? '…' : ''}`);
    // у кого звичайна маржа на товар вища за акційну — їм лишиться звичайна
    const ids = f ? parseIds(f.partners) : [];
    const partners = await db.all(`SELECT id, name FROM b2b_partners WHERE active = 1 AND COALESCE(deleted_at, '') = '' ${ids.length ? 'AND id IN (SELECT value FROM json_each(?))' : ''} ORDER BY name`, ids.length ? [J(ids)] : []);
    const byId = new Map(rows.map((r) => [r.product_id, r]));
    const higher = [];
    if (rows.length) {
      for (const p of partners.slice(0, 30)) {
        const norm = await db.all(`SELECT c.product_id, ${PM_COLS} FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id ${PM_JOIN}
          WHERE m.partner_id = ? AND c.hidden = 0 AND c.rrp > 0 AND c.product_id IN (SELECT value FROM json_each(?))`, ['0000-00-00', p.id, J(rows.map((r) => r.product_id))]);
        const n = norm.filter((r) => { const it = itemFor(items, byId.get(r.product_id)); return it && Number(r.margin) > Number(it.margin); }).length;
        if (n) higher.push(`${p.name} — ${n} ${n === 1 ? 'товар' : 'товарів'}`);
      }
    }
    if (higher.length) warnings.push(`Звичайна маржа вища за акційну, їм лишиться звичайна: ${higher.join('; ')}`);
    return c.json({
      errors, warnings, count: rows.length, partners: partners.length,
      coverage: items.map((i) => ({ level: i.level, ref_id: i.ref_id, n: rows.filter((r) => itemFor(items, r) === i).length })),
      rows: rows.filter((r) => r.rrp > 0).slice(0, 1000).map((r) => {
        const it = itemFor(items, r);
        const rrp0 = fix ? base.get(r.product_id) || r.rrp : r.rrp;
        return {
          id: r.product_id, name: r.name, article: r.article || '', rrp: r.rrp, rrp_start: rrp0, margin: it?.margin ?? null, margin_wh: it?.margin_wh ?? null,
          price: it ? partnerPrice(rrp0, it.margin) : null, price_wh: it ? partnerPrice(rrp0, it.margin_wh ?? it.margin) : null,
        };
      }),
    });
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
