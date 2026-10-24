// Модуль «B2B партнери».
//  Адмін (право b2b.admin): партнери, їхні користувачі, увімкнені бренди й маржа, каталог з цінами з LP-CRM.
//  Партнер (право b2b.partner): свій кабінет — каталог увімкнених брендів з РРЦ і своєю ціною, свої юрособи,
//  закупівлі (рахунок і накладну вносить бухгалтер — власник або адмін — номерами й файлами),
//  замовлення для своїх клієнтів із залишку закупівлі (адмін передає їх у LP-CRM — clients.js).
// Ціна партнера = РРЦ × (1 − маржа %), округлення до копійок (ціни з ПДВ).
// Бренди й товари — з аналітики (an_brands, an_products; лише читання), РРЦ і фото — з LP-CRM (getProduct).
import { hashPassword, can, PARTNER_ROLES, partnerRole, randomToken } from '../../core/auth.js';
import { fail, need, nowIso, kyivDay, loadSettings, round2 } from '../../core/common.js';
import { logAudit } from '../../core/requisites.js';
import { call } from '../../integrations/lpcrm.js';
import { mountB2bOrders } from './orders.js';
import { mountB2bClients } from './clients.js';

export const partnerPrice = (rrp, margin) => round2((Number(rrp) || 0) * (1 - (Number(margin) || 0) / 100));

const BATCH = 50; // товарів за один запит getProduct
const BATCHES_PER_CALL = 8; // запитів до LP-CRM за звернення (між ними пауза 1,5 с — обмеження LP-CRM)
const IMG_RE = /^https?:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?$/i;

// Товари з відповіді getProduct (масив, мапа id → товар або один товар).
function collectProducts(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return [];
  if (!Array.isArray(node) && ('id' in node || 'product_id' in node) && ('name' in node || 'price' in node)) return [node];
  return Object.values(node).flatMap((v) => collectProducts(v, depth + 1));
}
// Перше посилання на картинку в полях товару (image, img, photo, images[0]…).
function findImage(node, depth = 0) {
  if (typeof node === 'string') return IMG_RE.test(node.trim()) ? node.trim() : '';
  if (!node || typeof node !== 'object' || depth > 3) return '';
  for (const v of Object.values(node)) {
    const found = findImage(v, depth + 1);
    if (found) return found;
  }
  return '';
}
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function mountB2b(app, { db, fetchFn, services = {}, onCleanup = () => {} }) {
  const audit = (c, refId, action, changes = []) => logAudit(db, { user: c.get('user'), kind: 'b2b', refId, action, changes });
  async function brandNames() {
    const rows = await db.all(`SELECT id, name FROM an_brands ORDER BY sort, id`).catch(() => []);
    return new Map([...rows.map((r) => [r.id, r.name]), [0, 'Інші']]);
  }

  // Кабінет партнера: роль «Лише перегляд» нічого не змінює (усе, крім читання, — 403).
  app.use('/api/b2b/p/*', async (c, next) => {
    const u = c.get('user');
    if (u?.role === 'partner' && c.req.method !== 'GET' && !can(u, 'b2b.order')) throw fail(403, 'У вас доступ лише на перегляд. Зверніться до керівника вашої команди.');
    await next();
  });

  // ================================================================ АДМІН: партнери
  app.get('/api/b2b/partners', async (c) => {
    need(c, 'b2b.admin');
    const rows = await db.all(`SELECT p.*,
        (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id AND u.role = 'partner') AS users,
        (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id AND u.role = 'partner' AND u.added_by LIKE 'partner:%') AS users_by_partner,
        (SELECT COUNT(*) FROM b2b_margins m WHERE m.partner_id = p.id) AS brands
      FROM b2b_partners p WHERE COALESCE(p.deleted_at, '') = '' ORDER BY p.active DESC, p.name`);
    return c.json(rows);
  });

  const partnerFields = (b) => ({
    name: String(b.name ?? '').trim().slice(0, 120),
    phone: String(b.phone ?? '').trim().slice(0, 40),
    email: String(b.email ?? '').trim().slice(0, 120),
    note: String(b.note ?? '').trim().slice(0, 1000),
  });

  app.post('/api/b2b/partners', async (c) => {
    need(c, 'b2b.admin');
    const f = partnerFields(await c.req.json());
    if (!f.name) throw fail(400, 'Вкажіть назву партнера.');
    const r = await db.run(`INSERT INTO b2b_partners (name, phone, email, note, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
      [f.name, f.phone, f.email, f.note, nowIso()]);
    await audit(c, r.lastId, `створено партнера «${f.name}»`);
    return c.json({ id: r.lastId });
  });

  async function getPartner(id) {
    const p = await db.get(`SELECT * FROM b2b_partners WHERE id = ? AND COALESCE(deleted_at, '') = ''`, [id]);
    if (!p) throw fail(404, 'Партнера не знайдено.');
    return p;
  }

  app.get('/api/b2b/partners/:id', async (c) => {
    need(c, 'b2b.admin');
    const p = await getPartner(c.req.param('id'));
    const [users, margins, counts, names, entities] = await Promise.all([
      db.all(`SELECT id, login, name, active, created_at, partner_role, added_by FROM users WHERE partner_id = ? AND role = 'partner' ORDER BY active DESC, login`, [p.id]),
      db.all(`SELECT brand_id, margin FROM b2b_margins WHERE partner_id = ?`, [p.id]),
      db.all(`SELECT brand_id, COUNT(*) AS n, SUM(CASE WHEN rrp > 0 THEN 1 ELSE 0 END) AS priced FROM b2b_catalog WHERE hidden = 0 GROUP BY brand_id`),
      brandNames(),
      db.all(`SELECT * FROM b2b_entities WHERE partner_id = ? ORDER BY active DESC, name`, [p.id]),
    ]);
    const m = new Map(margins.map((x) => [x.brand_id, x.margin]));
    const cnt = new Map(counts.map((x) => [x.brand_id, x]));
    const brands = [...names].map(([id, name]) => ({
      id, name, enabled: m.has(id), margin: m.get(id) ?? null, products: cnt.get(id)?.n || 0, priced: cnt.get(id)?.priced || 0,
    }));
    return c.json({ partner: p, users: users.map(teamRow), brands, entities, roles: PARTNER_ROLES });
  });

  // Видалення партнера. Без замовлень — повністю; із замовленнями — в архів (замовлення й документи лишаються,
  // партнер зникає зі списку). Користувачі партнера видаляються в обох випадках (логіни звільняються).
  app.delete('/api/b2b/partners/:id', async (c) => {
    need(c, 'b2b.admin');
    need(c, 'people');
    const p = await getPartner(c.req.param('id'));
    const hasOrders = await db.get(`SELECT id FROM b2b_orders WHERE partner_id = ? LIMIT 1`, [p.id]);
    const st = [
      [`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE partner_id = ? AND role = 'partner')`, [p.id]],
      [`DELETE FROM users WHERE partner_id = ? AND role = 'partner'`, [p.id]],
      [`DELETE FROM b2b_margins WHERE partner_id = ?`, [p.id]],
    ];
    if (hasOrders) st.push([`UPDATE b2b_partners SET active = 0, deleted_at = ? WHERE id = ?`, [nowIso(), p.id]]);
    else {
      st.push([`DELETE FROM b2b_margin_log WHERE partner_id = ?`, [p.id]]);
      st.push([`DELETE FROM b2b_entities WHERE partner_id = ?`, [p.id]]);
      st.push([`DELETE FROM b2b_partners WHERE id = ?`, [p.id]]);
    }
    await db.batch(st);
    await audit(c, p.id, `${hasOrders ? 'партнера видалено (замовлення збережено в архіві)' : 'партнера видалено'}: «${p.name}»`);
    return c.json({ ok: true, archived: !!hasOrders });
  });

  app.put('/api/b2b/partners/:id', async (c) => {
    need(c, 'b2b.admin');
    const p = await getPartner(c.req.param('id'));
    const b = await c.req.json();
    const f = { ...partnerFields({ ...p, ...b }) };
    if (!f.name) throw fail(400, 'Вкажіть назву партнера.');
    const active = b.active === undefined ? p.active : (b.active ? 1 : 0);
    await db.run(`UPDATE b2b_partners SET name = ?, phone = ?, email = ?, note = ?, active = ? WHERE id = ?`, [f.name, f.phone, f.email, f.note, active, p.id]);
    // Вимкнений партнер не може входити (усі його користувачі вимикаються разом із ним; вмикаються окремо).
    if (!active && p.active) {
      await db.batch([
        [`UPDATE users SET active = 0 WHERE partner_id = ? AND role = 'partner'`, [p.id]],
        [`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE partner_id = ? AND role = 'partner')`, [p.id]],
      ]);
    }
    if (active !== p.active) await audit(c, p.id, active ? 'партнера увімкнено' : 'партнера вимкнено');
    return c.json({ ok: true });
  });

  // Бренди й маржа: тіло — [{ brand_id, margin }] для всіх увімкнених брендів (решта вимикаються).
  app.put('/api/b2b/partners/:id/margins', async (c) => {
    need(c, 'b2b.admin');
    const p = await getPartner(c.req.param('id'));
    const list = await c.req.json();
    if (!Array.isArray(list)) throw fail(400, 'Невірні дані.');
    const next = new Map();
    for (const r of list) {
      const brand = parseInt(r.brand_id, 10);
      const margin = round2(num(r.margin));
      if (!Number.isFinite(brand) || brand < 0) continue;
      if (margin < 0 || margin >= 100) throw fail(400, 'Маржа — від 0 до 99,99 %.');
      next.set(brand, margin);
    }
    const cur = new Map((await db.all(`SELECT brand_id, margin FROM b2b_margins WHERE partner_id = ?`, [p.id])).map((x) => [x.brand_id, x.margin]));
    const names = await brandNames();
    const at = nowIso();
    const st = [];
    const changes = [];
    for (const [brand, margin] of next) {
      if (cur.get(brand) === margin) continue;
      st.push([`INSERT INTO b2b_margins (partner_id, brand_id, margin) VALUES (?, ?, ?) ON CONFLICT(partner_id, brand_id) DO UPDATE SET margin = excluded.margin`, [p.id, brand, margin]]);
      st.push([`INSERT INTO b2b_margin_log (at, partner_id, brand_id, old_margin, new_margin) VALUES (?, ?, ?, ?, ?)`, [at, p.id, brand, cur.has(brand) ? cur.get(brand) : null, margin]]);
      changes.push({ field: names.get(brand) || `бренд ${brand}`, from: cur.has(brand) ? `${cur.get(brand)}%` : 'вимкнено', to: `${margin}%` });
    }
    for (const [brand, margin] of cur) {
      if (next.has(brand)) continue;
      st.push([`DELETE FROM b2b_margins WHERE partner_id = ? AND brand_id = ?`, [p.id, brand]]);
      st.push([`INSERT INTO b2b_margin_log (at, partner_id, brand_id, old_margin, new_margin) VALUES (?, ?, ?, ?, NULL)`, [at, p.id, brand, margin]]);
      changes.push({ field: names.get(brand) || `бренд ${brand}`, from: `${margin}%`, to: 'вимкнено' });
    }
    await db.batch(st);
    if (changes.length) await audit(c, p.id, `бренди й маржа партнера «${p.name}»`, changes);
    return c.json({ ok: true, changed: changes.length });
  });

  // ---------- користувачі партнера (команда) ----------
  // Додає адмін (у картці партнера) або керівник партнера (вкладка «Команда» в кабінеті).
  // added_by: «staff:Ім'я» — додав наш співробітник; «partner:Ім'я» — додав сам партнер.
  const MAX_TEAM = 30;
  const teamRow = (u) => {
    const [by, ...who] = String(u.added_by || '').split(':');
    return { id: u.id, login: u.login, name: u.name || '', active: u.active, created_at: u.created_at, partner_role: partnerRole(u),
      partner_role_name: PARTNER_ROLES[partnerRole(u)], added_by_partner: by === 'partner', added_by_name: who.join(':') };
  };
  const roleOf = (v, fallback = 'head') => (PARTNER_ROLES[v] ? v : fallback);
  const actorName = (c) => c.get('user')?.name || c.get('user')?.login || '';

  async function addTeamUser(c, p, b, addedBy) {
    const login = String(b.login || '').trim().toLowerCase();
    if (!/^[a-z0-9._@-]{2,40}$/.test(login)) throw fail(400, 'Логін: латинські літери, цифри, крапка, дефіс (2–40 символів).');
    if (String(b.password || '').length < 6) throw fail(400, 'Пароль — не менше 6 символів.');
    if (await db.get(`SELECT id FROM users WHERE login = ?`, [login])) throw fail(400, 'Такий логін уже зайнятий — оберіть інший.');
    if ((await db.get(`SELECT COUNT(*) AS n FROM users WHERE partner_id = ? AND role = 'partner'`, [p.id])).n >= MAX_TEAM) throw fail(400, `У команді не більше ${MAX_TEAM} користувачів.`);
    const role = roleOf(b.partner_role, addedBy.startsWith('partner:') ? 'staff' : 'head');
    const r = await db.run(`INSERT INTO users (login, name, password_hash, role, active, created_at, partner_id, partner_role, added_by) VALUES (?, ?, ?, 'partner', 1, ?, ?, ?, ?)`,
      [login, String(b.name || '').trim().slice(0, 100), await hashPassword(b.password), nowIso(), p.id, role, addedBy]);
    await audit(c, p.id, `додано користувача партнера «${p.name}»: ${login} (${PARTNER_ROLES[role]})${addedBy.startsWith('partner:') ? ' — додав партнер' : ''}`);
    return { id: r.lastId, login, role };
  }

  // Зміна користувача; guard — перевірки керівника партнера (не себе, лишається хоча б один активний керівник).
  async function updateTeamUser(c, p, u, b, { byPartner = false } = {}) {
    const sets = [];
    const vals = [];
    const changes = [];
    const me = c.get('user');
    if (byPartner && u.id === me.id && ((b.partner_role !== undefined && roleOf(b.partner_role) !== partnerRole(u)) || b.active === false)) {
      throw fail(400, 'Свою роль чи доступ змінити не можна — попросіть іншого керівника.');
    }
    if (b.name !== undefined) { sets.push('name = ?'); vals.push(String(b.name).trim().slice(0, 100)); }
    if (b.partner_role !== undefined && roleOf(b.partner_role) !== partnerRole(u)) {
      sets.push('partner_role = ?'); vals.push(roleOf(b.partner_role)); changes.push(`роль: ${PARTNER_ROLES[roleOf(b.partner_role)]}`);
    }
    if (b.active !== undefined && (b.active ? 1 : 0) !== u.active) { sets.push('active = ?'); vals.push(b.active ? 1 : 0); changes.push(b.active ? 'увімкнено' : 'вимкнено'); }
    if (b.password) {
      if (String(b.password).length < 6) throw fail(400, 'Пароль — не менше 6 символів.');
      sets.push('password_hash = ?'); vals.push(await hashPassword(b.password)); changes.push('новий пароль');
    }
    // Хоча б один активний керівник має лишитися (інакше командою нікому керувати).
    const willBeHead = (b.partner_role !== undefined ? roleOf(b.partner_role) : partnerRole(u)) === 'head' && (b.active !== undefined ? !!b.active : !!u.active);
    if (!willBeHead && partnerRole(u) === 'head' && u.active) {
      const heads = (await db.all(`SELECT id, partner_role FROM users WHERE partner_id = ? AND role = 'partner' AND active = 1 AND id != ?`, [p.id, u.id]))
        .filter((x) => partnerRole(x) === 'head').length;
      if (!heads) throw fail(400, 'У команді має лишитися хоча б один активний керівник.');
    }
    if (sets.length) await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, u.id]);
    if (b.password || b.active === false) await db.run(`DELETE FROM sessions WHERE user_id = ? AND user_id != ?`, [u.id, me.id]);
    if (changes.length) await audit(c, p.id, `користувач партнера «${p.name}» ${u.login}: ${changes.join(', ')}${byPartner ? ' — змінив партнер' : ''}`);
  }

  app.post('/api/b2b/partners/:id/users', async (c) => {
    need(c, 'b2b.admin');
    need(c, 'people');
    const p = await getPartner(c.req.param('id'));
    const r = await addTeamUser(c, p, await c.req.json(), `staff:${actorName(c)}`);
    return c.json({ id: r.id });
  });

  app.put('/api/b2b/partners/:id/users/:uid', async (c) => {
    need(c, 'b2b.admin');
    need(c, 'people');
    const p = await getPartner(c.req.param('id'));
    const u = await db.get(`SELECT * FROM users WHERE id = ? AND partner_id = ? AND role = 'partner'`, [c.req.param('uid'), p.id]);
    if (!u) throw fail(404, 'Користувача не знайдено.');
    await updateTeamUser(c, p, u, await c.req.json());
    return c.json({ ok: true });
  });

  // ================================================================ АДМІН: каталог
  app.get('/api/b2b/catalog', async (c) => {
    need(c, 'b2b.admin');
    const brand = c.req.query('brand');
    const q = String(c.req.query('q') || '').trim().toLowerCase();
    const where = [];
    const params = [];
    if (brand !== undefined && brand !== '') { where.push('brand_id = ?'); params.push(parseInt(brand, 10) || 0); }
    if (q) { where.push('(LOWER(name) LIKE ? OR CAST(product_id AS TEXT) = ?)'); params.push(`%${q}%`, q); }
    const [rows, names, state] = await Promise.all([
      db.all(`SELECT * FROM b2b_catalog ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY brand_id, name LIMIT 500`, params),
      brandNames(),
      catalogState(),
    ]);
    return c.json({ rows: rows.map((r) => ({ ...r, brand: names.get(r.brand_id) || 'Інші' })), state });
  });

  async function catalogState() {
    const today = kyivDay();
    const [last, left] = await Promise.all([
      db.get(`SELECT value FROM settings WHERE key = 'b2b_catalog_sync'`),
      db.get(`SELECT COUNT(*) AS n FROM b2b_catalog WHERE hidden = 0 AND checked_at < ? AND (manual = 1 OR brand_id IN (SELECT brand_id FROM b2b_margins))`, [today]),
    ]);
    return { lastSync: last?.value || '', stale: left?.n || 0 };
  }

  app.put('/api/b2b/catalog/:pid', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json();
    await db.run(`UPDATE b2b_catalog SET hidden = ? WHERE product_id = ?`, [b.hidden ? 1 : 0, parseInt(c.req.param('pid'), 10) || 0]);
    return c.json({ ok: true });
  });

  // Додати товари вручну за ID з LP-CRM (якщо їх ще не було в замовленнях, з яких складається каталог).
  app.post('/api/b2b/catalog/add', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json();
    const ids = [...new Set(String(b.ids || '').split(/[\s,;]+/).map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 200);
    if (!ids.length) throw fail(400, 'Вкажіть ID товарів з LP-CRM через кому.');
    await db.batch(ids.map((id) => [
      `INSERT INTO b2b_catalog (product_id, manual, checked_at) VALUES (?, 1, '') ON CONFLICT(product_id) DO UPDATE SET manual = 1, hidden = 0, checked_at = ''`, [id],
    ]));
    return c.json({ ok: true, added: ids.length });
  });

  // Оновлення каталогу з LP-CRM: назва, РРЦ, фото — для товарів увімкнених брендів і доданих вручну.
  // Частинами (≤ 12 запитів за звернення); браузер повторює, доки left > 0. Кожен товар — раз на добу.
  app.post('/api/b2b/catalog/sync', async (c) => {
    need(c, 'b2b.admin');
    const s = await loadSettings(db);
    if (!s.lpcrm_subdomain || !s.lpcrm_key) throw fail(400, 'Не налаштовано LP-CRM: вкажіть піддомен і API-ключ у «Налаштуваннях».');
    const today = kyivDay();
    // Нові товари з аналітики й актуальні бренди (бренд визначає аналітика за ключовими словами).
    await db.batch([
      [`INSERT OR IGNORE INTO b2b_catalog (product_id, name, brand_id) SELECT product_id, COALESCE(name, ''), brand_id FROM an_products WHERE product_id > 0`, []],
      [`UPDATE b2b_catalog SET brand_id = (SELECT a.brand_id FROM an_products a WHERE a.product_id = b2b_catalog.product_id)
        WHERE EXISTS (SELECT 1 FROM an_products a WHERE a.product_id = b2b_catalog.product_id AND a.brand_id IS NOT b2b_catalog.brand_id)`, []],
    ]);
    const todo = await db.all(
      `SELECT product_id, rrp FROM b2b_catalog WHERE hidden = 0 AND checked_at < ? AND (manual = 1 OR brand_id IN (SELECT brand_id FROM b2b_margins))
       ORDER BY checked_at LIMIT ?`, [today, BATCH * BATCHES_PER_CALL],
    );
    const at = nowIso();
    let changed = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      const j = await call(fetchFn, s.lpcrm_subdomain, s.lpcrm_key, 'getProduct', { product_id: part.map((x) => x.product_id).join(','), status_ignore: '1' });
      if (j.status !== 'ok' && !j.data) throw fail(502, `LP-CRM (каталог): ${j.message || 'не вдалося отримати товари'}`);
      const got = new Map(collectProducts(j.data).map((p) => [parseInt(p.id ?? p.product_id, 10), p]));
      const st = [];
      for (const r of part) {
        const p = got.get(r.product_id);
        if (!p) { st.push([`UPDATE b2b_catalog SET checked_at = ? WHERE product_id = ?`, [today, r.product_id]]); continue; }
        const rrp = round2(num(p.price));
        const vendor = p.vendor && p.vendor !== 'Артикул' ? p.vendor : '';
        st.push([`UPDATE b2b_catalog SET name = ?, article = ?, rrp = ?, image = ?, checked_at = ? WHERE product_id = ?`,
          [String(p.name || p.title || '').trim().slice(0, 300), String(p.article || vendor || p.model || '').slice(0, 60), rrp, findImage(p), today, r.product_id]]);
        if (r.rrp > 0 && rrp > 0 && Math.abs(rrp - r.rrp) >= 0.005) {
          st.push([`INSERT INTO b2b_price_log (at, product_id, old_rrp, new_rrp) VALUES (?, ?, ?, ?)`, [at, r.product_id, r.rrp, rrp]]);
          changed++;
        }
      }
      await db.batch(st);
    }
    await db.run(`INSERT INTO settings (key, value) VALUES ('b2b_catalog_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [at]);
    const state = await catalogState();
    return c.json({ ok: true, checked: todo.length, changed, left: state.stale, lastSync: at });
  });

  app.get('/api/b2b/brands', async (c) => {
    need(c, 'b2b.admin');
    return c.json([...(await brandNames())].map(([id, name]) => ({ id, name })));
  });

  // ================================================================ КАБІНЕТ ПАРТНЕРА
  async function myPartner(c) {
    need(c, 'b2b.partner');
    const u = c.get('user');
    const p = u.partner_id ? await db.get(`SELECT * FROM b2b_partners WHERE id = ? AND active = 1`, [u.partner_id]) : null;
    if (!p) throw fail(403, 'Кабінет партнера вимкнено. Зверніться до вашого менеджера.');
    return p;
  }

  // ---------- команда партнера (керівник партнера) ----------
  app.get('/api/b2b/p/team', async (c) => {
    const p = await myPartner(c);
    need(c, 'b2b.team');
    const rows = await db.all(`SELECT * FROM users WHERE partner_id = ? AND role = 'partner' ORDER BY active DESC, login`, [p.id]);
    return c.json({ users: rows.map(teamRow), roles: PARTNER_ROLES, max: MAX_TEAM, me: c.get('user').id });
  });
  app.post('/api/b2b/p/team', async (c) => {
    const p = await myPartner(c);
    need(c, 'b2b.team');
    const r = await addTeamUser(c, p, await c.req.json(), `partner:${actorName(c)}`);
    await services.notify?.sendText({ admins: true }, `👥 Партнер «${p.name}» додав користувача <b>${r.login}</b> (${PARTNER_ROLES[r.role]}) — додав ${actorName(c)}.`).catch(() => 0);
    return c.json({ id: r.id });
  });
  app.put('/api/b2b/p/team/:uid', async (c) => {
    const p = await myPartner(c);
    need(c, 'b2b.team');
    const u = await db.get(`SELECT * FROM users WHERE id = ? AND partner_id = ? AND role = 'partner'`, [c.req.param('uid'), p.id]);
    if (!u) throw fail(404, 'Користувача не знайдено.');
    await updateTeamUser(c, p, u, await c.req.json(), { byPartner: true });
    return c.json({ ok: true });
  });

  app.get('/api/b2b/p/me', async (c) => {
    const p = await myPartner(c);
    return c.json({ partner: { id: p.id, name: p.name } });
  });

  // Каталог партнера: лише увімкнені бренди; РРЦ і ціна партнера (маржу не показуємо — лише ціну).
  app.get('/api/b2b/p/catalog', async (c) => {
    const p = await myPartner(c);
    const [rows, names] = await Promise.all([
      db.all(`SELECT c.product_id, c.name, c.article, c.rrp, c.image, c.brand_id, m.margin
        FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id
        WHERE m.partner_id = ? AND c.hidden = 0 AND c.rrp > 0 ORDER BY c.name`, [p.id]),
      brandNames(),
    ]);
    const brands = [...new Set(rows.map((r) => r.brand_id))].map((id) => ({ id, name: names.get(id) || 'Інші' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    return c.json({
      partner: { id: p.id, name: p.name },
      brands,
      products: rows.map((r) => ({
        id: r.product_id, name: r.name, article: r.article, image: r.image, brand_id: r.brand_id,
        brand: names.get(r.brand_id) || 'Інші', rrp: r.rrp, price: partnerPrice(r.rrp, r.margin),
      })),
    });
  });

  const orders = mountB2bOrders(app, { db, services, myPartner, partnerPrice, onCleanup });
  mountB2bClients(app, { db, fetchFn, myPartner, orders });

  // ---------- Telegram-група партнера ----------
  // Адмін бере код у картці партнера, додає бота в групу і пишe там «/link КОД» (код діє 30 хв).
  app.post('/api/b2b/partners/:id/tg-group', async (c) => {
    need(c, 'b2b.admin');
    const p = await getPartner(c.req.param('id'));
    const s = await loadSettings(db);
    if (!s.tg_token || !s.tg_bot) throw fail(400, 'Telegram-бота ще не підключено (Налаштування → Telegram).');
    const code = randomToken(6);
    await db.run(`UPDATE b2b_partners SET tg_group_code = ? WHERE id = ?`, [`${code}|${Date.now() + 30 * 60000}`, p.id]);
    return c.json({ code, bot: s.tg_bot });
  });
  app.delete('/api/b2b/partners/:id/tg-group', async (c) => {
    need(c, 'b2b.admin');
    const p = await getPartner(c.req.param('id'));
    await db.run(`UPDATE b2b_partners SET tg_group = '', tg_group_title = '', tg_group_code = '' WHERE id = ?`, [p.id]);
    await audit(c, p.id, `відв'язано Telegram-групу «${p.tg_group_title || p.tg_group}»`);
    return c.json({ ok: true });
  });
  const tgGroupLink = async (code, chat, title) => {
    const p = await db.get(`SELECT id, name, tg_group_code FROM b2b_partners WHERE tg_group_code LIKE ? AND COALESCE(deleted_at, '') = ''`, [`${code}|%`]);
    if (!p || (Number(p.tg_group_code.split('|')[1]) || 0) < Date.now()) return '';
    await db.run(`UPDATE b2b_partners SET tg_group = ?, tg_group_title = ?, tg_group_code = '' WHERE id = ?`, [chat, String(title).slice(0, 120), p.id]);
    await logAudit(db, { user: null, kind: 'b2b', refId: p.id, action: `прив'язано Telegram-групу «${title}»`, changes: [] }).catch(() => 0);
    return `✅ Групу прив'язано до партнера <b>${String(p.name).replace(/[<>&]/g, '')}</b>. Сюди надходитимуть закупівлі, рахунки й накладні (файлами) та оплати.`;
  };
  const tgGroupMoved = (from, to) => db.run(`UPDATE b2b_partners SET tg_group = ? WHERE tg_group = ?`, [to, from]);
  const tgGroupLeft = (chat) => db.run(`UPDATE b2b_partners SET tg_group = '', tg_group_title = '' WHERE tg_group = ?`, [chat]);

  return { partnerPrice, tgGroupLink, tgGroupMoved, tgGroupLeft };
}
