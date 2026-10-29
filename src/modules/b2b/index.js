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
import { mountB2bStats } from './stats.js';
import { mountB2bPrices } from './prices.js';
import { mountB2bTgDocs } from './tgdocs.js';
import { mountB2bPay } from './odbpay.js';
import { mountB2bEdits } from './edits.js';
import { mountB2bHome } from './home.js';

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
    // Пауза: нові закупівлі, замовлення клієнтів і відправлення чернеток заблоковані.
    if (u?.role === 'partner' && c.req.method === 'POST' && /^\/api\/b2b\/p\/(orders|clients|orders\/\d+\/send)\/?$/.test(c.req.path)) {
      const p = await db.get(`SELECT paused, pause_note FROM b2b_partners WHERE id = ?`, [u.partner_id]);
      if (p?.paused) throw fail(403, `Нові закупівлі й замовлення тимчасово призупинено${p.pause_note ? `: ${p.pause_note}` : ''}. Зверніться до менеджера.`);
    }
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
    // Борг: закупівлі з рахунком без повної оплати (одним запитом на всіх партнерів).
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
    const debt = new Map((await db.all(`SELECT partner_id, SUM(total - paid_amount) AS due, SUM(CASE WHEN due_date != '' AND due_date < ? THEN total - paid_amount ELSE 0 END) AS overdue,
      COUNT(*) AS n FROM b2b_orders WHERE kind = 'supply' AND status IN ('pay_wait', 'partial') GROUP BY partner_id`, [today])).map((r) => [r.partner_id, r]));
    // + відвантажено без рахунку: замовлення клієнтів у CRM із відкритої закупівлі або такої, що чекає рахунок.
    const ship = new Map((await db.all(`SELECT s.partner_id, SUM(co.total) AS sum, COUNT(co.id) AS n FROM b2b_orders s
      JOIN b2b_orders co ON co.supply_id = s.id AND co.kind = 'client' AND co.status = 'crm'
      WHERE s.kind = 'supply' AND s.status IN ('open', 'invoice_wait') GROUP BY s.partner_id`)).map((r) => [r.partner_id, r]));
    const r2 = (n) => Math.round((n || 0) * 100) / 100;
    return c.json(rows.map((r) => ({ ...r, debt: r2((debt.get(r.id)?.due || 0) + (ship.get(r.id)?.sum || 0)), debt_invoiced: r2(debt.get(r.id)?.due), debt_shipped: r2(ship.get(r.id)?.sum),
      debt_shipped_cnt: ship.get(r.id)?.n || 0, debt_overdue: r2(debt.get(r.id)?.overdue), debt_cnt: debt.get(r.id)?.n || 0 })));
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
      services.notify?.fillTgNames?.(5).catch(() => 0).then(() => db.all(`SELECT id, login, name, active, created_at, partner_role, added_by, tg_chat_id, tg_name, tg_linked_at FROM users WHERE partner_id = ? AND role = 'partner' ORDER BY active DESC, login`, [p.id])),
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
    const lim = orders.limitsOf(p);
    const open = await orders.getOpen(p.id);
    return c.json({ partner: p, users: users.map(teamRow), brands, entities, roles: PARTNER_ROLES,
      limits: { open: lim.open, unpaid: lim.unpaid, openTotal: open?.total || 0, openId: open?.id || null, unpaidTotal: await orders.unpaidTotal(p.id) },
      postpay: await orders.postpayInfo(p), debt: await orders.debtOf(p.id) });
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

  // Ліміти: відкрита закупівля (замовлення без закупівлі) і всі неоплачені закупівлі; порожньо — типові 20 000 / 100 000.
  // Відстрочка оплати: днів (0 — лише передоплата) і ліміт (порожньо — без окремого ліміту). undefined — не змінювати.
  async function applyLimits(c, p, b) {
    const st = [];
    const log = [];
    if (b.postpay_days !== undefined) {
      const v = parseInt(b.postpay_days, 10) || 0;
      if (v < 0 || v > 180) throw fail(400, 'Відстрочка — від 0 до 180 днів.');
      if (v !== (Number(p.postpay_days) || 0)) {
        st.push([`UPDATE b2b_partners SET postpay_days = ? WHERE id = ?`, [v, p.id]]);
        log.push(v ? `відстрочка оплати: ${v} дн.` : 'відстрочку оплати вимкнено');
      }
    }
    for (const [k, label] of [['open_limit', 'відкритої закупівлі'], ['unpaid_limit', 'неоплачених закупівель'], ['postpay_limit', 'відстрочки']]) {
      if (b[k] === undefined) continue;
      const raw = String(b[k] ?? '').replace(/\s/g, '');
      if (raw && !/^\d+([.,]\d+)?$/.test(raw)) throw fail(400, `Ліміт ${label} — сума в гривнях.`);
      const v = raw ? round2(num(raw)) : null;
      if (v !== null && !(v >= 0 && v <= 100000000)) throw fail(400, `Ліміт ${label} — сума в гривнях.`);
      if (v !== (p[k] ?? null)) {
        st.push([`UPDATE b2b_partners SET ${k} = ? WHERE id = ?`, [v, p.id]]);
        log.push(`ліміт ${label}: ${p[k] ?? 'типовий'} → ${v ?? 'типовий'}`);
      }
    }
    if (st.length) await db.batch(st);
    for (const x of log) await audit(c, p.id, x);
    return log.length;
  }
  // Пауза: партнер бачить кабінет, але не створює нових закупівель і замовлень клієнтів (причину бачить у кабінеті).
  async function applyPause(c, p, b) {
    if (b.paused === undefined) return 0;
    const v = b.paused ? 1 : 0;
    const note = v ? String(b.pause_note ?? p.pause_note ?? '').trim().slice(0, 300) : '';
    if (v === (Number(p.paused) || 0) && note === (p.pause_note || '')) return 0;
    await db.run(`UPDATE b2b_partners SET paused = ?, pause_note = ? WHERE id = ?`, [v, note, p.id]);
    await audit(c, p.id, v ? `партнера поставлено на паузу${note ? `: ${note}` : ''}` : 'паузу знято');
    return 1;
  }

  app.put('/api/b2b/partners/:id', async (c) => {
    need(c, 'b2b.admin');
    const p = await getPartner(c.req.param('id'));
    const b = await c.req.json();
    const f = { ...partnerFields({ ...p, ...b }) };
    if (!f.name) throw fail(400, 'Вкажіть назву партнера.');
    const active = b.active === undefined ? p.active : (b.active ? 1 : 0);
    await applyLimits(c, p, b);
    await applyPause(c, p, b);
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

  // Записати бренди й маржу: build(cur) повертає нову Map brand → margin (відсутні — вимикаються). Журнал — для розсилки змін цін.
  async function applyMargins(c, p, build, names = null) {
    const cur = new Map((await db.all(`SELECT brand_id, margin FROM b2b_margins WHERE partner_id = ?`, [p.id])).map((x) => [x.brand_id, x.margin]));
    const next = build(cur);
    names = names || await brandNames();
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
    if (st.length) await db.batch(st);
    if (changes.length) await audit(c, p.id, `бренди й маржа партнера «${p.name}»`, changes);
    return changes;
  }

  // ---------- групові дії над партнерами ----------
  // action: pause | resume | limits | margin. Для margin: brand — 'all' (усі увімкнені бренди партнера) або id;
  // mode: set (задати %), add (додати/відняти п.п.), disable (вимкнути бренд). enable — увімкнути бренд, де він вимкнений (для set з конкретним брендом).
  app.post('/api/b2b/partners/bulk', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json().catch(() => ({}));
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter((x) => x > 0))];
    if (!ids.length) throw fail(400, 'Оберіть партнерів.');
    if (ids.length > 200) throw fail(400, 'Не більше 200 партнерів за раз.');
    const list = await db.all(`SELECT * FROM b2b_partners WHERE COALESCE(deleted_at, '') = '' AND id IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]);
    let margin = null;
    if (b.action === 'margin') {
      const mode = ['set', 'add', 'disable'].includes(b.mode) ? b.mode : '';
      if (!mode) throw fail(400, 'Оберіть дію з маржею.');
      const brand = b.brand === 'all' ? 'all' : parseInt(b.brand, 10);
      if (brand !== 'all' && !(brand >= 0)) throw fail(400, 'Оберіть бренд.');
      const v = round2(num(b.value));
      if (mode === 'set' && (v < 0 || v >= 100)) throw fail(400, 'Маржа — від 0 до 99,99 %.');
      if (mode === 'add' && (!v || Math.abs(v) >= 100)) throw fail(400, 'Вкажіть, на скільки змінити маржу (напр. 2 або -1,5).');
      if (mode === 'disable' && brand === 'all') throw fail(400, 'Вимикати можна конкретний бренд.');
      margin = { mode, brand, v, enable: !!b.enable && brand !== 'all' && mode === 'set' };
    } else if (!['pause', 'resume', 'limits'].includes(b.action)) throw fail(400, 'Невідома дія.');
    const names = await brandNames();
    const results = [];
    for (const p of list) {
      try {
        let changed = 0;
        if (b.action === 'pause') changed = await applyPause(c, p, { paused: 1, pause_note: b.note ?? '' });
        else if (b.action === 'resume') changed = await applyPause(c, p, { paused: 0 });
        else if (b.action === 'limits') {
          const f = {};
          for (const k of ['open_limit', 'unpaid_limit', 'postpay_days', 'postpay_limit']) if (b[k] !== undefined && b[k] !== null) f[k] = b[k];
          changed = await applyLimits(c, p, f);
        } else {
          const { mode, brand, v, enable } = margin;
          changed = (await applyMargins(c, p, (cur) => {
            const next = new Map(cur);
            const targets = brand === 'all' ? [...cur.keys()] : (cur.has(brand) || enable ? [brand] : []);
            for (const id of targets) {
              if (mode === 'disable') next.delete(id);
              else if (mode === 'set') next.set(id, v);
              else next.set(id, Math.min(99.99, Math.max(0, round2((cur.get(id) || 0) + v))));
            }
            return next;
          }, names)).length;
        }
        results.push({ id: p.id, name: p.name, ok: true, changed });
      } catch (e) { results.push({ id: p.id, name: p.name, ok: false, error: e.message }); }
    }
    return c.json({ results });
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
    const changes = await applyMargins(c, p, () => next);
    return c.json({ ok: true, changed: changes.length });
  });

  // ---------- користувачі партнера (команда) ----------
  // Додає адмін (у картці партнера) або керівник партнера (вкладка «Команда» в кабінеті).
  // added_by: «staff:Ім'я» — додав наш співробітник; «partner:Ім'я» — додав сам партнер.
  const MAX_TEAM = 30;
  const teamRow = (u) => {
    const [by, ...who] = String(u.added_by || '').split(':');
    return { id: u.id, login: u.login, name: u.name || '', active: u.active, created_at: u.created_at, partner_role: partnerRole(u),
      partner_role_name: PARTNER_ROLES[partnerRole(u)], added_by_partner: by === 'partner', added_by_name: who.join(':'),
      tg: { connected: Boolean(u.tg_chat_id), name: u.tg_name || '', at: u.tg_linked_at || '' } };
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

  async function catalogState(today = kyivDay()) {
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
  // Частинами (≤ 12 запитів за звернення); браузер повторює, доки left > 0. run — час натискання «Оновити»:
  // перечитуються всі товари, не перевірені після нього (раніше — раз на добу, і зміни РРЦ того ж дня не підтягувались).
  app.post('/api/b2b/catalog/sync', async (c) => {
    need(c, 'b2b.admin');
    const s = await loadSettings(db);
    if (!s.lpcrm_subdomain || !s.lpcrm_key) throw fail(400, 'Не налаштовано LP-CRM: вкажіть піддомен і API-ключ у «Налаштуваннях».');
    const b = await c.req.json().catch(() => ({}));
    const run = String(b.run || '');
    const fresh = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(run) && Math.abs(Date.now() - Date.parse(run)) < 3 * 3600 * 1000;
    const today = fresh ? run : kyivDay();
    const stamp = nowIso();
    // Нові товари з аналітики й актуальні бренди (бренд визначає аналітика за ключовими словами).
    await db.batch([
      [`INSERT OR IGNORE INTO b2b_catalog (product_id, name, brand_id) SELECT product_id, COALESCE(name, ''), brand_id FROM an_products WHERE product_id > 0`, []],
      [`UPDATE b2b_catalog SET brand_id = (SELECT a.brand_id FROM an_products a WHERE a.product_id = b2b_catalog.product_id)
        WHERE EXISTS (SELECT 1 FROM an_products a WHERE a.product_id = b2b_catalog.product_id AND a.brand_id IS NOT b2b_catalog.brand_id)`, []],
    ]);
    const todo = await db.all(
      `SELECT product_id, rrp, brand_id FROM b2b_catalog WHERE hidden = 0 AND checked_at < ? AND (manual = 1 OR brand_id IN (SELECT brand_id FROM b2b_margins))
       ORDER BY checked_at LIMIT ?`, [today, BATCH * BATCHES_PER_CALL],
    );
    const at = nowIso();
    let changed = 0;
    const items = []; // які РРЦ змінилися — для вікна після оновлення
    const names = todo.length ? await brandNames() : new Map();
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      const j = await call(fetchFn, s.lpcrm_subdomain, s.lpcrm_key, 'getProduct', { product_id: part.map((x) => x.product_id).join(','), status_ignore: '1' });
      if (j.status !== 'ok' && !j.data) throw fail(502, `LP-CRM (каталог): ${j.message || 'не вдалося отримати товари'}`);
      const got = new Map(collectProducts(j.data).map((p) => [parseInt(p.id ?? p.product_id, 10), p]));
      const st = [];
      for (const r of part) {
        const p = got.get(r.product_id);
        if (!p) { st.push([`UPDATE b2b_catalog SET checked_at = ? WHERE product_id = ?`, [stamp, r.product_id]]); continue; }
        const rrp = round2(num(p.price));
        const vendor = p.vendor && p.vendor !== 'Артикул' ? p.vendor : '';
        st.push([`UPDATE b2b_catalog SET name = ?, article = ?, rrp = ?, image = ?, checked_at = ? WHERE product_id = ?`,
          [String(p.name || p.title || '').trim().slice(0, 300), String(p.article || vendor || p.model || '').slice(0, 60), rrp, findImage(p), stamp, r.product_id]]);
        if (r.rrp > 0 && rrp > 0 && Math.abs(rrp - r.rrp) >= 0.005) {
          st.push([`INSERT INTO b2b_price_log (at, product_id, old_rrp, new_rrp) VALUES (?, ?, ?, ?)`, [at, r.product_id, r.rrp, rrp]]);
          changed++;
          items.push({ id: r.product_id, name: String(p.name || p.title || '').trim().slice(0, 300), brand: names.get(r.brand_id) || 'Інші', old: r.rrp, now: rrp });
        }
      }
      await db.batch(st);
    }
    await db.run(`INSERT INTO settings (key, value) VALUES ('b2b_catalog_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [at]);
    const state = await catalogState(today);
    return c.json({ ok: true, checked: todo.length, changed, items, left: state.stale, lastSync: at });
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
    await services.notify?.fillTgNames?.(5).catch(() => 0);
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
    const [rows, names, cats] = await Promise.all([
      db.all(`SELECT c.product_id, c.name, c.article, c.rrp, c.image, c.brand_id, m.margin, COALESCE(a.cat_manual, a.category_id, 0) AS cat
        FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id LEFT JOIN an_products a ON a.product_id = c.product_id
        WHERE m.partner_id = ? AND c.hidden = 0 AND c.rrp > 0 ORDER BY c.name`, [p.id]),
      brandNames(),
      db.all(`SELECT id, name FROM an_categories`).catch(() => []),
    ]);
    // Як часто партнер замовляв товар: у скількох закупівлях і замовленнях клієнтів (без скасованих і відкритої).
    const freq = new Map((await db.all(
      `SELECT i.product_id, COUNT(DISTINCT o.id) AS n, SUM(i.qty) AS q FROM b2b_orders o JOIN b2b_order_items i ON i.order_id = o.id
       WHERE o.partner_id = ? AND o.kind IN ('supply', 'client') AND o.status NOT IN ('cancelled', 'open', 'draft', 'confirm') GROUP BY i.product_id`, [p.id],
    )).map((r) => [r.product_id, r]));
    const catName = new Map(cats.map((x) => [x.id, x.name]));
    // Бренди з відсотком знижки від РРЦ (маржа партнера на бренд) і категорії з кількістю товарів.
    const brands = [...new Map(rows.map((r) => [r.brand_id, { id: r.brand_id, name: names.get(r.brand_id) || 'Інші', margin: r.margin }])).values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    const categories = [...rows.reduce((m, r) => m.set(r.cat, (m.get(r.cat) || 0) + 1), new Map())]
      .map(([id, n]) => ({ id, name: catName.get(id) || 'Інше', n })).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    return c.json({
      partner: { id: p.id, name: p.name },
      brands,
      categories,
      // Спершу те, що партнер замовляє найчастіше (далі — за назвою).
      products: rows.map((r) => ({
        id: r.product_id, name: r.name, article: r.article, image: r.image, brand_id: r.brand_id, cat: r.cat,
        brand: names.get(r.brand_id) || 'Інші', rrp: r.rrp, price: partnerPrice(r.rrp, r.margin), margin: r.margin,
        ordered: freq.get(r.product_id)?.n || 0, ordered_qty: freq.get(r.product_id)?.q || 0,
      })).sort((a, b) => b.ordered - a.ordered || b.ordered_qty - a.ordered_qty),
    });
  });

  // hooks — зв'язки між частинами модуля, що підключаються пізніше (маркування → Telegram, № у CRM → група маркувань).
  const hooks = {};
  const orders = mountB2bOrders(app, { db, services, myPartner, partnerPrice, onCleanup, hooks });
  mountB2bClients(app, { db, fetchFn, myPartner, orders, hooks });
  mountB2bEdits(app, { db, orders, hooks, myPartner, partnerPrice });
  const tgdocs = mountB2bTgDocs(app, { db, services, orders, hooks });
  const pay = mountB2bPay(app, { db, services, orders, hooks });
  onCleanup(() => hooks.cleanup?.());
  mountB2bStats(app, { db, myPartner });
  const home = mountB2bHome(app, { db, myPartner, orders });
  mountB2bPrices(app, { db, services, partnerPrice });

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
    if (!p || (Number(p.tg_group_code.split('|')[1]) || 0) < Date.now()) return tgdocs.linkSpecialGroup(code, chat, title);
    await db.run(`UPDATE b2b_partners SET tg_group = ?, tg_group_title = ?, tg_group_code = '' WHERE id = ?`, [chat, String(title).slice(0, 120), p.id]);
    await logAudit(db, { user: null, kind: 'b2b', refId: p.id, action: `прив'язано Telegram-групу «${title}»`, changes: [] }).catch(() => 0);
    return `✅ Групу прив'язано до партнера <b>${String(p.name).replace(/[<>&]/g, '')}</b>. Сюди надходитимуть закупівлі, рахунки й накладні (файлами) та оплати.`;
  };
  const tgGroupMoved = (from, to) => db.run(`UPDATE b2b_partners SET tg_group = ? WHERE tg_group = ?`, [to, from]);
  const tgGroupLeft = (chat) => db.run(`UPDATE b2b_partners SET tg_group = '', tg_group_title = '' WHERE tg_group = ?`, [chat]);

  return { attention: home.attention, crmOrderInfo: orders.crmOrderInfo, partnerPrice, tgGroupLink, tgGroupMoved, tgGroupLeft, tgPrivate: tgdocs.tgPrivate, tgCallback: tgdocs.tgCallback, tgGroupMessage: tgdocs.tgGroupMessage, onPayments: pay.onPayments, payInfo: pay.payInfo };
}
