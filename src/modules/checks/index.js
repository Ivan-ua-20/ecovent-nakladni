// Модуль «Перевірка»: автоматична звірка оплат, наложки й чеків відправлених замовлень LP-CRM (окрема вкладка).
//
// Дані збирає фонова задача (раз на 10 хв, частинами — ліміт запитів Cloudflare):
//  1) LP-CRM: номери замовлень у статусах «Отправлен / Ожидает выкупа / Завершено» за CHECK_DAYS днів, повні дані — лише нових
//     і тих, у кого змінився статус (вид оплати, сума, відділ, поле 1, ТТН, коментар);
//  2) ТТН: Нова пошта — відстеження пакетами по 100 (контроль оплати / грошовий переказ і сума); ROZETKA Delivery — сума
//     накладеного платежу (по кожному кабінету Розетки, поки не знайдемо ТТН); Prom — замовлення Prom з тією самою ТТН
//     (з уже завантажених замовлень маркетплейсів) і його оплата через API Prom: Пром-оплата (оплачено чи ні) або при отриманні.
//     ТТН «PRM-…» (Розетка Делівері, створені в Prom) перевіряємо саме так;
//  3) Checkbox: усі чеки кожного ФОП за ці дні (день, що минув, читаємо один раз; сьогодні й учора — повторно).
// Надходження на рахунки беремо з модуля платежів (Opendatabot) — він уже збирає їх сам.
// Сповіщень у Telegram модуль не надсилає (сповіщення про дублі ТТН / телефонів, як і раніше, надсилає аналітика).
// Висновки (що не так із замовленням) не зберігаємо: рахуємо під час показу сторінки з rules.js — завжди за свіжими даними.
import { need, fail, nowIso, kyivDay, num, round2, loadSettings } from '../../core/common.js';
import { getOrderCodesByStatus, getOrdersBatch, getStatuses, lpcrmBusy } from '../../integrations/lpcrm.js';
import { npTrackMany } from '../../integrations/novaposhta.js';
import { rzDeliveryList } from '../../integrations/rozetka.js';
import { promOrder, promPayment } from '../../integrations/prom.js';
import { hasCheckbox, listReceipts, getReceipt, cashierMe } from '../../integrations/checkbox.js';
import { ttnOf } from '../analytics/index.js';
import { payRules, carrierOf, matchReceipts, findPayment, evaluate, partialOf, CLASSES, CARRIERS, PAY_DEFAULTS } from './rules.js';

export const CHECK_DAYS = 14; // замовлення, створені за останні 14 днів
const EVERY_MS = 10 * 60e3;
const RECEIPT_KEEP_DAYS = 45;
const LP_MAX = 5; // запитів до LP-CRM за крок (кожен — з паузою 1,5 с)
const CB_MAX = 12; // запитів до Checkbox за крок
const RD_MAX = 8; // запитів до Розетки за крок
const PROM_MAX = 8; // запитів до Prom за крок
const PROM_RECHECK_MS = 3600e3; // неоплачену Пром-оплату перевіряємо щогодини
const NP_RECHECK_MS = 12 * 3600e3; // наложку в ТТН НП перечитуємо раз на 12 год (ТТН могли змінити)
// Статуси, які перевіряємо (за назвою LP-CRM; запасні номери — як у LP-CRM Ековенту).
const STATUS_RE = /^(отправлен|відправлен|ожидает выкупа|очікує викупу|завершено|виконано)/i;
const STATUS_FALLBACK = [14, 53, 18];

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const kyivDayOf = (iso) => (/(Z|[+-]\d\d:\d\d)$/.test(String(iso)) ? kyivDay(new Date(iso)) : String(iso || '').slice(0, 10));
const nameOf = (v) => String(v && typeof v === 'object' ? v.name ?? '' : v ?? '').trim();
const p9 = (v) => String(v || '').replace(/\D/g, '').slice(-9);

// Номер чека Checkbox (UUID), прив'язаний до замовлення в LP-CRM: шукаємо в усіх полях замовлення (крім товарів),
// бо назва поля в API може відрізнятися.
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
export function receiptRefOf(raw, depth = 0) {
  if (!raw || typeof raw !== 'object' || depth > 2) return '';
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'products' || k === 'goods' || k === 'items') continue;
    if (typeof v === 'string') { const m = v.match(UUID_RE); if (m) return m[0].toLowerCase(); }
    else if (v && typeof v === 'object') { const r = receiptRefOf(v, depth + 1); if (r) return r; }
  }
  return '';
}

// Замовлення LP-CRM → рядок chk_orders.
export function normalizeCheckOrder(raw) {
  const code = String(raw.order_id || '').trim();
  const day = String(raw.datetime || '').slice(0, 10);
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ttn = ttnOf(raw);
  const delivery = String(raw.delivery_name || raw.delivery || '').trim().slice(0, 60);
  return {
    code, id: String(raw.id || ''), day, status: parseInt(raw.status, 10) || 0,
    payment: String(raw.payment ?? raw.payment_id ?? '').trim(),
    total: round2(num(raw.total)), office: String(raw.office ?? ''), channel: String(raw.additional_1 || '').trim().slice(0, 80),
    site: String(raw.site || '').trim().slice(0, 80), delivery, ttn, carrier: carrierOf(ttn, delivery),
    phone: p9(raw.phone), buyer: String(raw.bayer_name || '').trim().slice(0, 120), user: String(raw.user || '').trim().slice(0, 40),
    comment: String(raw.comment || '').trim().slice(0, 500),
    receipt_ref: receiptRefOf(raw),
    prepayment: round2(num(raw.prepayment)),
  };
}

export function mountChecks(app, { db, fetchFn, onCron, services = {} }) {
  const getJson = async (key, dflt = {}) => { try { return JSON.parse((await db.get(`SELECT value FROM settings WHERE key = ?`, [key]))?.value || 'null') ?? dflt; } catch { return dflt; } };
  // Те саме з уже прочитаних налаштувань (loadSettings) — без зайвого звернення до бази.
  const fromJson = (v, dflt = {}) => { try { return JSON.parse(v || 'null') ?? dflt; } catch { return dflt; } };
  const fromS = (s, key, dflt = {}) => { try { return JSON.parse(s[key] || 'null') ?? dflt; } catch { return dflt; } };
  const setJson = (key, v) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, JSON.stringify(v)]);
  const rules = async () => payRules(await getJson('chk_pay', {}));

  // Статуси LP-CRM, які перевіряємо, і їхні назви (раз на добу).
  async function statuses(cr, budget, s) {
    const st = fromS(s, 'chk_statuses');
    if (st.day === kyivDay() && st.ids?.length) return st;
    if (budget.lp >= LP_MAX) return st.ids?.length ? st : { ids: STATUS_FALLBACK, names: {} };
    budget.lp++;
    const data = await getStatuses(fetchFn, cr).catch(() => ({}));
    const names = Object.fromEntries(Object.entries(data).map(([id, v]) => [id, nameOf(v)]).filter(([, n]) => n));
    const ids = Object.entries(names).filter(([, n]) => STATUS_RE.test(n)).map(([id]) => Number(id));
    const out = { day: kyivDay(), ids: ids.length ? ids : STATUS_FALLBACK, names };
    await setJson('chk_statuses', out);
    return out;
  }

  // ---------------------------------------------------------------- 1) LP-CRM
  async function syncCrm(cr, budget, state, s) {
    const st = await statuses(cr, budget, s);
    const today = kyivDay();
    const from = addDays(today, -CHECK_DAYS);
    // Список номерів — раз на EVERY_MS (по статусу за запит); повні дані — нових і зі зміненим статусом.
    if (!state.listed || Date.now() - Date.parse(state.listed) >= EVERY_MS - 30e3) {
      const pass = state.pass && state.pass.at && Date.now() - Date.parse(state.pass.at) < EVERY_MS ? state.pass : { at: nowIso(), done: [] };
      const stmts = [];
      for (const sid of st.ids) {
        if (pass.done.includes(sid)) continue;
        if (budget.lp >= LP_MAX) { await db.batch(stmts); state.pass = pass; return { more: true }; }
        budget.lp++;
        const codes = await getOrderCodesByStatus(fetchFn, cr, sid, from, today);
        for (let i = 0; i < codes.length; i += 200) {
          stmts.push([`INSERT INTO chk_orders (code, status, listed_at) SELECT value, ?, ? FROM json_each(?) WHERE true
            ON CONFLICT(code) DO UPDATE SET status = excluded.status, listed_at = excluded.listed_at`, [sid, pass.at, JSON.stringify(codes.slice(i, i + 200))]]);
        }
        pass.done.push(sid);
      }
      await db.batch(stmts);
      state.listed = pass.at;
      state.pass = null;
    }
    const todo = (await db.all(`SELECT code FROM chk_orders WHERE listed_at >= ? AND fetched_status != status ORDER BY listed_at DESC LIMIT 300`, [state.listed])).map((r) => r.code);
    const room = Math.min(todo.length, (LP_MAX - budget.lp) * 100);
    if (room > 0) {
      budget.lp += Math.ceil(room / 100);
      const got = (await getOrdersBatch(fetchFn, cr, todo.slice(0, room))).map(normalizeCheckOrder).filter(Boolean);
      if (got.length) {
        await db.batch(got.map((o) => [`UPDATE chk_orders SET id = ?, day = ?, fetched_status = status, payment = ?, total = ?, office = ?, channel = ?, site = ?,
          delivery = ?, phone = ?, buyer = ?, user = ?, comment = ?,
          ref_state = CASE WHEN receipt_ref = ? THEN ref_state ELSE '' END, receipt_ref = ?, prepayment = ?,
          ttn_at = CASE WHEN ttn = ? THEN ttn_at ELSE '' END, cod = CASE WHEN ttn = ? THEN cod ELSE 0 END, cod_kind = CASE WHEN ttn = ? THEN cod_kind ELSE '' END,
          ttn_err = CASE WHEN ttn = ? THEN ttn_err ELSE '' END, ttn = ?, carrier = ? WHERE code = ?`,
        [o.id, o.day, o.payment, o.total, o.office, o.channel, o.site, o.delivery, o.phone, o.buyer, o.user, o.comment, o.receipt_ref, o.receipt_ref, o.prepayment, o.ttn, o.ttn, o.ttn, o.ttn, o.ttn, o.carrier, o.code]]));
      }
      // Замовлення, яких LP-CRM не віддала (видалені тощо), — щоб не просити їх щоразу.
      const seen = new Set(got.map((o) => o.code));
      const lost = todo.slice(0, room).filter((c) => !seen.has(c));
      if (lost.length) await db.run(`UPDATE chk_orders SET fetched_status = status WHERE code IN (SELECT value FROM json_each(?))`, [JSON.stringify(lost)]);
      if (todo.length > room) return { more: true };
    } else if (todo.length) return { more: true };
    return {};
  }

  // ---------------------------------------------------------------- 2) ТТН
  async function syncNp(budget) {
    const acc = await db.get(`SELECT api_key FROM np_accounts WHERE active = 1 ORDER BY id LIMIT 1`).catch(() => null);
    if (!acc?.api_key) return { skipped: 'немає кабінету Нової пошти' };
    const border = new Date(Date.now() - NP_RECHECK_MS).toISOString();
    const rows = await db.all(`SELECT code, ttn, phone FROM chk_orders WHERE carrier = 'np' AND listed_at != '' AND (ttn_at = '' OR ttn_at < ?)
      ORDER BY ttn_at, day DESC LIMIT 200`, [border]);
    for (let i = 0; i < rows.length && budget.np < 2; i += 100) {
      budget.np++;
      const part = rows.slice(i, i + 100);
      const map = await npTrackMany(fetchFn, acc.api_key, part.map((r) => ({ ttn: r.ttn, phone: r.phone })));
      const now = nowIso();
      await db.batch(part.map((r) => {
        const t = map.get(r.ttn);
        if (!t) return [`UPDATE chk_orders SET ttn_at = ?, ttn_err = 'Нова пошта не знайшла ТТН' WHERE code = ?`, [now, r.code]];
        const kind = t.ctrl > 0 ? 'ctrl' : t.redelivery > 0 ? 'redelivery' : '';
        return [`UPDATE chk_orders SET ttn_at = ?, ttn_err = '', cod = ?, cod_kind = ? WHERE code = ?`, [now, t.ctrl || t.redelivery || 0, kind, r.code]];
      }));
    }
    return {};
  }

  async function syncRd(budget, s) {
    const accs = await db.all(`SELECT * FROM rz_accounts WHERE active = 1 ORDER BY id`).catch(() => []);
    if (!accs.length || !services.marking?.rozetkaToken) return { skipped: 'немає кабінетів Розетки' };
    const rows = await db.all(`SELECT code, ttn FROM chk_orders WHERE carrier = 'rd' AND listed_at != '' AND ttn_at = '' AND ttn_err = '' ORDER BY day DESC LIMIT 10`);
    const tried = fromS(s, 'chk_rd_tried'); // ТТН → кабінети, де вже шукали
    const ups = [];
    for (const r of rows) {
      let found = null;
      for (const a of accs) {
        if ((tried[r.ttn] || []).includes(a.id)) continue;
        if (budget.rd >= RD_MAX) { await db.batch(ups); await setJson('chk_rd_tried', tried); return { more: true }; }
        budget.rd++;
        try {
          const tok = await services.marking.rozetkaToken(a);
          found = (await rzDeliveryList(fetchFn, tok, { ttn: r.ttn })).rows.find((x) => x.ttn.toUpperCase() === r.ttn.toUpperCase()) || null;
        } catch (e) { if (e.pending) throw e; }
        (tried[r.ttn] ||= []).push(a.id);
        if (found) break;
      }
      const now = nowIso();
      if (found) ups.push([`UPDATE chk_orders SET ttn_at = ?, ttn_err = '', cod = ?, cod_kind = ? WHERE code = ?`, [now, found.cod || 0, found.cod > 0 ? 'cod' : '', r.code]]);
      else ups.push([`UPDATE chk_orders SET ttn_at = ?, ttn_err = 'ТТН не знайдено в жодному кабінеті Розетки' WHERE code = ?`, [now, r.code]]);
      delete tried[r.ttn];
    }
    await db.batch(ups);
    await setJson('chk_rd_tried', tried);
    return {};
  }

  // Prom: замовлення з тією самою ТТН (серед уже завантажених замовлень маркетплейсів) → оплата через API Prom.
  async function syncProm(budget) {
    const accs = new Map((await db.all(`SELECT id, token FROM prom_accounts WHERE active = 1`).catch(() => [])).map((a) => [a.id, a.token]));
    if (!accs.size) return { skipped: 'немає магазинів Prom' };
    const from = addDays(kyivDay(), -CHECK_DAYS - 30);
    const mp = await db.all(`SELECT account_id, id, ttn FROM mp_orders WHERE mp = 'prom' AND created_at >= ? AND ttn != ''`, [from]).catch(() => []);
    const byTtn = new Map(mp.map((m) => [String(m.ttn).replace(/\s/g, '').toUpperCase(), m]));
    if (!byTtn.size) return {};
    const hourAgo = new Date(Date.now() - PROM_RECHECK_MS).toISOString();
    const rows = (await db.all(`SELECT code, ttn, carrier, total FROM chk_orders WHERE listed_at != '' AND ttn != '' AND (mp_at = '' OR (mp_pay = 'prosale_unpaid' AND mp_at < ?))
      ORDER BY day DESC LIMIT 400`, [hourAgo])).filter((r) => byTtn.has(String(r.ttn).replace(/\s/g, '').toUpperCase()));
    const ups = [];
    let more = false;
    for (const r of rows) {
      const m = byTtn.get(String(r.ttn).replace(/\s/g, '').toUpperCase());
      const token = accs.get(m.account_id);
      if (!token) continue;
      if (budget.prom >= PROM_MAX) { more = true; break; }
      budget.prom++;
      let o = null;
      try { o = await promOrder(fetchFn, token, m.id); } catch (e) { if (e.pending) { await db.batch(ups); throw e; } continue; }
      if (!o) continue;
      const p = promPayment(o);
      const pay = p.kind === 'prosale' ? (p.paid ? 'prosale_paid' : 'prosale_unpaid') : p.kind;
      const now = nowIso();
      ups.push([`UPDATE chk_orders SET mp_pay = ?, mp_pay_name = ?, mp_at = ? WHERE code = ?`, [pay, p.name.slice(0, 80), now, r.code]]);
      // ТТН «PRM-…»: наложку бачимо лише через спосіб оплати в Prom (при отриманні — наложка на суму замовлення Prom).
      if (r.carrier === 'prm') ups.push([`UPDATE chk_orders SET ttn_at = ?, ttn_err = '', cod = ?, cod_kind = ? WHERE code = ?`, [now, p.kind === 'cod' ? (p.total || r.total) : 0, p.kind === 'cod' ? 'prom' : '', r.code]]);
    }
    await db.batch(ups);
    return { more };
  }

  // ---------------------------------------------------------------- 3) Checkbox
  // Каси Checkbox для перевірки («Перевірка → Налаштування», як у модулі Checkbox LP-CRM). Для клієнта Checkbox каса —
  // об'єкт із полями доступу; токен кешується за id `k<id>` (окремо від ФОП накладних).
  const asCb = (k) => ({ id: `k${k.id}`, dbId: k.id, short_name: k.org_title || k.name, checkbox_login: k.login, checkbox_password: k.password, checkbox_license: k.license, checkbox_pin: k.pin });
  const canSign = (k) => k.active && hasCheckbox(asCb(k));
  // Ключ організації каси: код з Checkbox (ІПН / ЄДРПОУ), поки його немає — назва без пробілів і розділових знаків.
  const orgKey = (k) => String(k.org_code || '').trim() || String(k.org_title || k.name || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '');
  // Каси, до яких Checkbox не пускає (за останні 6 год): { id каси: { at, msg } }.
  const cbFails = (s) => Object.fromEntries(Object.entries(fromS(s, 'chk_cb_fail')).filter(([, v]) => Date.now() - Date.parse(v.at) < 6 * 3600e3));
  // Чеки читаємо по одному касиру на організацію: через нього видно чеки всіх кас цього ФОП / ТОВ.
  const readers = (list, fails) => {
    const reps = new Map();
    for (const k of list) if (canSign(k) && !fails[k.id] && !reps.has(orgKey(k))) reps.set(orgKey(k), k);
    return [...reps.values()].map(asCb);
  };
  async function syncReceipts(budget, s) {
    const fops = readers(await db.all(`SELECT * FROM chk_cashiers ORDER BY lp_active DESC, id`), cbFails(s));
    if (!fops.length) return { skipped: 'немає кас Checkbox з доступом' };
    const today = kyivDay();
    const from = addDays(today, -CHECK_DAYS);
    const days = (await db.all(`SELECT fop_id, day, done, at FROM chk_days WHERE day >= ?`, [from]));
    const have = new Map(days.map((d) => [`${d.fop_id}|${d.day}`, d]));
    const errors = {};
    const fails = cbFails(s);
    budget.cbFail = fails; // той самий об'єкт — щоб пошук чеків за номером у цьому ж кроці теж оминув цю касу
    const stmts = []; // усе — одним пакетом наприкінці (ліміт звернень до бази на запит)
    const keepFails = () => stmts.push([`INSERT INTO settings (key, value) VALUES ('chk_cb_fail', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(fails)]]);
    const flush = async () => { for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100)); stmts.length = 0; };
    for (const f of fops) {
      for (let d = today; d >= from; d = addDays(d, -1)) {
        const h = have.get(`${f.dbId}|${d}`);
        if (h?.done) continue;
        // сьогодні й учора — не частіше разу на EVERY_MS
        if (h && d >= addDays(today, -1) && Date.now() - Date.parse(h.at || 0) < EVERY_MS - 30e3) continue;
        // Межі дня за Києвом: шукаємо з запасом у 3 год з обох боків, а день чека визначаємо за його часом.
        const fromIso = new Date(Date.parse(`${d}T00:00:00Z`) - 3 * 3600e3).toISOString();
        const toIso = new Date(Date.parse(`${d}T00:00:00Z`) + 27 * 3600e3).toISOString();
        let offset = 0;
        let rows = [];
        try {
          for (;;) {
            if (budget.cb >= CB_MAX) { keepFails(); await flush(); return { more: true, errors }; }
            budget.cb++;
            const page = await listReceipts(fetchFn, f, fromIso, toIso, offset);
            rows.push(...page.rows);
            if (!page.more) break;
            offset += 100;
          }
        } catch (e) {
          if (e.pending) { await flush(); throw e; }
          errors[f.short_name] = e.message;
          // Checkbox не пускає (невірний логін / пароль, забагато спроб) — не стукаємо 6 год, щоб не заблокувати касу.
          if (e.status === 401 || e.status === 403) {
            fails[f.dbId] = { at: nowIso(), msg: e.message.replace(/^Checkbox \d+: /, '') };
            stmts.push([`UPDATE chk_cashiers SET error = ? WHERE id = ?`, [fails[f.dbId].msg.slice(0, 200), f.dbId]]);
          }
          break; // ця каса — наступного разу
        }
        rows = rows.filter((r) => kyivDayOf(r.at) === d);
        stmts.push(...rows.map((r) => [`INSERT INTO chk_receipts (id, fop_id, day, at, type, total, fiscal, pays, refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET type = excluded.type, total = excluded.total, pays = excluded.pays, refs = excluded.refs`,
        [r.id, f.dbId, d, r.at, r.type, r.total, r.fiscal, JSON.stringify(r.pays), r.refs]]));
        stmts.push([`INSERT INTO chk_days (fop_id, day, done, at) VALUES (?, ?, ?, ?) ON CONFLICT(fop_id, day) DO UPDATE SET done = excluded.done, at = excluded.at`,
          [f.dbId, d, d < addDays(today, -1) ? 1 : 0, nowIso()]]);
      }
    }
    keepFails();
    await flush();
    return { errors };
  }

  // Чеки, прив'язані до замовлень у LP-CRM, яких немає серед завантажених (інший день, інша каса): беремо за номером
  // з кожної каси з доступом. Жодна не бачить — каса цього ФОП не підключена в сервісі (ref_state = nofop).
  async function syncReceiptRefs(budget, s) {
    const mark = [`UPDATE chk_orders SET ref_state = 'ok' WHERE ref_state = '' AND receipt_ref != '' AND receipt_ref IN (SELECT id FROM chk_receipts)`, []];
    if (budget.cb >= CB_MAX) { await db.batch([mark]); return { more: true }; }
    const rows = await db.all(`SELECT o.code, o.receipt_ref FROM chk_orders o WHERE o.listed_at != '' AND o.receipt_ref != '' AND o.ref_state = ''
      AND NOT EXISTS (SELECT 1 FROM chk_receipts r WHERE r.id = o.receipt_ref) ORDER BY o.day DESC LIMIT 20`);
    if (!rows.length) { await db.batch([mark]); return {}; }
    const failed = { ...cbFails(s), ...(budget.cbFail || {}) };
    const fops = readers(await db.all(`SELECT * FROM chk_cashiers ORDER BY lp_active DESC, id`), failed);
    const tried = fromS(s, 'chk_ref_tried'); // чек → каси, де вже шукали
    const ups = [mark];
    let more = false;
    for (const r of rows) {
      let got = null; let fopId = null;
      for (const f of fops) {
        if ((tried[r.receipt_ref] || []).includes(f.dbId)) continue;
        if (budget.cb >= CB_MAX) { more = true; break; }
        budget.cb++;
        try { got = await getReceipt(fetchFn, f, r.receipt_ref); } catch (e) { if (e.pending) { more = true; break; } }
        (tried[r.receipt_ref] ||= []).push(f.dbId);
        if (got) { fopId = f.dbId; break; }
      }
      if (more) break;
      if (got) {
        ups.push([`INSERT INTO chk_receipts (id, fop_id, day, at, type, total, fiscal, pays, refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
          [got.id, fopId, kyivDayOf(got.at) || kyivDay(), got.at, got.type, got.total, got.fiscal, JSON.stringify(got.pays), got.refs]]);
        ups.push([`UPDATE chk_orders SET ref_state = 'ok' WHERE code = ?`, [r.code]]);
      } else ups.push([`UPDATE chk_orders SET ref_state = 'nofop' WHERE code = ?`, [r.code]]);
      delete tried[r.receipt_ref];
    }
    ups.push([`INSERT INTO settings (key, value) VALUES ('chk_ref_tried', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(tried)]]);
    await db.batch(ups);
    return { more };
  }

  // Один крок збору (фонова задача або кнопка «Оновити зараз»). Замок — щоб два звернення не робили одне й те саме.
  async function step({ force = false } = {}) {
    const s = await loadSettings(db);
    if (!s.lpcrm_subdomain || !s.lpcrm_key) return { skipped: 'LP-CRM не налаштовано' };
    const state = fromS(s, 'chk_state');
    if (!force && state.finished && Date.now() - Date.parse(state.finished) < EVERY_MS - 30e3 && !state.more) return { fresh: true };
    const lock = await db.run(`INSERT INTO settings (key, value) VALUES ('chk_lock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?`,
      [nowIso(), new Date(Date.now() - 5 * 60e3).toISOString()]);
    if (!lock.changes) return { busy: true };
    // Нові поля замовлення (версія даних) — один раз перечитати повні дані всіх замовлень.
    if (state.data_v !== 4) { await db.run(`UPDATE chk_orders SET fetched_status = 0`); state.data_v = 4; }
    // З версії 5 чеки прив'язані до кас «Перевірки» (не ФОП накладних) — кеш чеків один раз очищуємо й читаємо заново.
    if (state.cash_v !== 1) {
      await db.batch([[`DELETE FROM chk_receipts`, []], [`DELETE FROM chk_days`, []], [`UPDATE chk_orders SET ref_state = ''`, []],
        [`DELETE FROM settings WHERE key IN ('chk_cb_fail', 'chk_ref_tried')`, []]]);
      state.cash_v = 1;
      for (const k of ['chk_cb_fail', 'chk_ref_tried']) delete s[k];
    }
    if (state.prom_v !== 2) { await db.run(`UPDATE chk_orders SET mp_at = '' WHERE mp_pay = 'other'`); state.prom_v = 2; }
    const budget = { lp: 0, np: 0, rd: 0, prom: 0, cb: 0 };
    const res = {};
    try {
      const cr = { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key };
      if (!force && lpcrmBusy()) res.crm = { busy: true }; // хтось зараз формує накладну — LP-CRM наступного разу
      else res.crm = await syncCrm(cr, budget, state, s).catch((e) => { if (e.pending) throw e; return { error: e.message }; });
      res.np = await syncNp(budget).catch((e) => { if (e.pending) throw e; return { error: e.message }; });
      res.rd = await syncRd(budget, s).catch((e) => { if (e.pending) throw e; return { error: e.message }; });
      res.prom = await syncProm(budget).catch((e) => { if (e.pending) throw e; return { error: e.message }; });
      res.cb = await syncReceipts(budget, s).catch((e) => { if (e.pending) throw e; return { error: e.message }; });
      res.refs = await syncReceiptRefs(budget, s).catch((e) => { if (e.pending) throw e; return { error: e.message }; });
    } catch (e) {
      if (!e.pending) throw e;
      res.more = true;
    } finally {
      const more = Boolean(res.more || res.crm?.more || res.rd?.more || res.prom?.more || res.cb?.more || res.refs?.more);
      const errs = [res.crm?.error, res.np?.error, res.rd?.error, res.prom?.error && `Prom: ${res.prom.error}`, res.cb?.error, ...Object.entries(res.cb?.errors || {}).map(([k, v]) => `Checkbox ${k}: ${v}`)].filter(Boolean);
      Object.assign(state, { more, finished: more ? state.finished : nowIso(), at: nowIso(), errors: errs.slice(0, 5) });
      // Стан, зняття замка і (раз на добу) чистка старих даних — одним пакетом.
      const fin = [];
      if (state.pruned !== kyivDay()) {
        const border = addDays(kyivDay(), -RECEIPT_KEEP_DAYS);
        fin.push([`DELETE FROM chk_orders WHERE (day != '' AND day < ?) OR listed_at < ?`, [addDays(kyivDay(), -CHECK_DAYS - 7), border]], [`DELETE FROM chk_receipts WHERE day < ?`, [border]], [`DELETE FROM chk_days WHERE day < ?`, [border]]);
        state.pruned = kyivDay();
      }
      fin.push([`INSERT INTO settings (key, value) VALUES ('chk_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(state)]],
        [`UPDATE settings SET value = '' WHERE key = 'chk_lock'`, []]);
      await db.batch(fin);
      res.more = more;
    }
    res.budget = budget;
    return res;
  }
  onCron('checks', 'Перевірка: оплати, наложка й чеки відправлених замовлень (раз на 10 хв)', () => step());

  // ---------------------------------------------------------------- показ
  // Усе для оцінки за період: замовлення, чеки, надходження, ФОП, відділи. Відповідь рахується тут, з rules.js.
  async function build(from, to) {
    const recFrom = from; const recTo = addDays(to, 20);
    // Останній завершений прохід списків (state.listed): замовлення, яких у ньому немає, вийшли з цих статусів.
    const listed = (await getJson('chk_state', {})).listed || '';
    const cbFailRaw = (await db.get(`SELECT value FROM settings WHERE key = 'chk_cb_fail'`))?.value || '{}';
    const [rs, orders, receipts, fopsAll, offices, channels, accounts, txs, stNames, cashList] = await Promise.all([
      rules(),
      db.all(`SELECT * FROM chk_orders WHERE listed_at != '' AND listed_at >= ? AND day BETWEEN ? AND ? ORDER BY day DESC, code DESC`, [listed, from, to]),
      // чеки за період + прив'язані в LP-CRM до замовлень періоду (можуть бути з іншого дня)
      db.all(`SELECT * FROM chk_receipts WHERE day BETWEEN ? AND ? OR id IN (SELECT receipt_ref FROM chk_orders WHERE receipt_ref != '' AND day BETWEEN ? AND ?)`, [recFrom, recTo, from, to]),
      db.all(`SELECT id, short_name, ipn, iban, active, checkbox_login, checkbox_password, checkbox_license, checkbox_pin FROM fops`),
      db.all(`SELECT office_id, name, fop_id FROM offices`),
      db.all(`SELECT name, fop_id FROM channels`),
      db.all(`SELECT iban, code, name, alias FROM odb_accounts`).catch(() => []),
      db.all(`SELECT id, date, amount, purpose, iban, payer_name, our_code FROM odb_tx WHERE date >= ? AND date < ?`, [addDays(from, -7), addDays(to, 3)]).catch(() => []),
      getJson('chk_statuses', {}),
      db.all(`SELECT id, name, login, password, license, pin, offices, lp_active, active, org_title, org_code FROM chk_cashiers ORDER BY lp_active DESC, id`),
    ]);
    // Каси: назва (організація з Checkbox або як у LP-CRM), організація, відділи LP-CRM.
    const fops = Object.fromEntries(cashList.map((k) => [String(k.id), k.org_title || k.name]));
    const orgOf = new Map(cashList.map((k) => [String(k.id), orgKey(k)]));
    const sameOrg = (a, b) => a != null && b != null && orgOf.get(String(a)) === orgOf.get(String(b));
    const failed = cbFails(Object.fromEntries([['chk_cb_fail', cbFailRaw]]));
    const readable = new Set(readers(cashList, failed).map((f) => orgOf.get(String(f.dbId))));
    // Каси відділу — усі, де цей відділ вказано (і ввімкнені, і вимкнені в LP-CRM; ввімкнені — першими).
    // Чек будь-якої з цих організацій для відділу правильний.
    const cashByOffice = new Map();
    for (const k of cashList) {
      let offs = []; try { offs = JSON.parse(k.offices || '[]'); } catch { /* порожньо */ }
      for (const off of offs) { if (!cashByOffice.has(String(off))) cashByOffice.set(String(off), []); cashByOffice.get(String(off)).push(k.id); }
    }
    const cashByCode = new Map(cashList.filter((k) => k.org_code).map((k) => [String(k.org_code).trim(), k.id]));
    const fopByIpn = new Map(fopsAll.filter((f) => f.ipn).map((f) => [String(f.ipn).trim(), f.id]));
    const fopByIban = new Map(fopsAll.filter((f) => f.iban).map((f) => [String(f.iban).replace(/\s/g, '').toUpperCase(), f.id]));
    const fopName = Object.fromEntries(fopsAll.map((f) => [String(f.id), f.short_name]));
    const accByIban = new Map(accounts.map((a) => [String(a.iban).toUpperCase(), a]));
    const officeName = new Map(offices.map((o) => [String(o.office_id), o.name]));
    const names = stNames.names || {};
    // Яка каса має пробити чек — як у модулі Checkbox LP-CRM: за відділом замовлення.
    for (const o of orders) {
      o.status_name = names[o.status] || '';
      const ids = cashByOffice.get(String(o.office)) || [];
      const orgs = new Set(ids.map((id) => orgOf.get(String(id))));
      o.fopId = ids[0] ?? null; // для показу «каса відділу»
      o.fopOk = ids.length ? (id) => orgs.has(orgOf.get(String(id))) : null; // чек цієї каси підходить відділу?
      o.canRead = ids.some((id) => readable.has(orgOf.get(String(id))));
    }
    const recs = receipts.map((r) => ({ ...r, pays: (() => { try { return JSON.parse(r.pays); } catch { return []; } })() }));
    const matched = matchReceipts(orders, recs, sameOrg);
    const txRows = txs.map((t) => {
      const iban = String(t.iban || '').toUpperCase();
      const acc = accByIban.get(iban);
      const code = String(t.our_code || acc?.code || '').trim();
      const fid = fopByIban.get(iban) || fopByIpn.get(code);
      // fop_id — каса тієї ж організації (для порівняння з чеком); account — куди прийшли гроші, для людини.
      return { ...t, day: String(t.date).slice(0, 10), fop_id: cashByCode.get(code) ?? null, account: (fid && fopName[String(fid)]) || acc?.alias || acc?.name || iban.slice(-8) };
    });
    // Можливі дублі: той самий телефон у кількох відправлених замовленнях, створених у межах 3 днів.
    const byPhone = new Map();
    for (const o of orders) if (o.phone.length === 9) { if (!byPhone.has(o.phone)) byPhone.set(o.phone, []); byPhone.get(o.phone).push(o); }
    const byTtn = new Map();
    for (const o of orders) { const t = String(o.ttn || '').replace(/\s/g, '').toUpperCase(); if (t) { if (!byTtn.has(t)) byTtn.set(t, []); byTtn.get(t).push(o); } }
    const today = kyivDay();
    const rows = orders.map((o) => {
      const rule = rs[String(o.payment)];
      const part = rule?.cls === 'cod' ? (o.prepayment > 0 || partialOf(o.comment)) : null;
      const dup = (byPhone.get(o.phone) || []).filter((x) => x !== o && Math.abs(Date.parse(x.day) - Date.parse(o.day)) <= 3 * 86400e3).map((x) => x.id || x.code);
      const receipt = matched.get(o.code) || null;
      const payment = rule?.cls === 'bank' ? findPayment(o, txRows, o.total) : null;
      const dupTtn = (byTtn.get(String(o.ttn || '').replace(/\s/g, '').toUpperCase()) || []).filter((x) => x !== o).map((x) => x.id || x.code);
      // Чек можна вимагати, лише якщо касу відділу внесено й до неї є доступ.
      const canReceipt = o.fopId != null && o.canRead;
      const ev = evaluate(o, { rules: rs, receipt, fops, expectedFop: o.fopId, payment, today, dup: dup.filter((x) => !dupTtn.includes(x)), dupTtn, canReceipt, sameOrg, fopOk: o.fopOk, noCashier: o.fopId == null });
      return {
        code: o.code, id: o.id, day: o.day, status: o.status_name || String(o.status), total: o.total,
        payment: rule?.name || (o.payment ? `Оплата ${o.payment}` : '—'), cls: rule?.cls || '', partial: Boolean(part),
        office: officeName.get(String(o.office)) || o.office, channel: o.channel, site: o.site, buyer: o.buyer, phone: o.phone, user: o.user, comment: o.comment,
        ttn: o.ttn, carrier: CARRIERS[o.carrier] || '', cod: o.cod, cod_kind: o.cod_kind, mp_pay: o.mp_pay ? o.mp_pay_name || o.mp_pay : '',
        receipt: receipt ? { id: receipt.id, total: receipt.total, fop: fops[String(receipt.fop_id)] || '', at: receipt.at, pays: receipt.pays.map((p) => p.label || p.type).filter(Boolean), bySum: Boolean(receipt.bySum), url: `https://check.checkbox.ua/${receipt.id}` }
          : o.receipt_ref ? { id: o.receipt_ref, total: null, fop: '', at: '', pays: [], bySum: false, url: `https://check.checkbox.ua/${o.receipt_ref}`, crmOnly: true } : null,
        expected_fop: o.fopId ? fops[String(o.fopId)] || '' : '',
        level: ev.level, items: ev.items,
      };
    });
    return { rows, recs, matched, orders, fops, failed: Object.entries(failed).map(([id, v]) => `${fops[id] || id} — ${v.msg}`), cashList };
  }

  const period = (c) => {
    const today = kyivDay();
    const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    let from = ok(c.req.query('from')) ? c.req.query('from') : addDays(today, -CHECK_DAYS);
    let to = ok(c.req.query('to')) ? c.req.query('to') : today;
    if (from < addDays(today, -CHECK_DAYS - 7)) from = addDays(today, -CHECK_DAYS - 7);
    if (to < from) to = from;
    return { from, to };
  };

  app.get('/api/checks', async (c) => {
    need(c, 'users');
    const { from, to } = period(c);
    const { rows, failed, cashList } = await build(from, to);
    const counts = rows.reduce((a, r) => { a[r.level] = (a[r.level] || 0) + 1; return a; }, {});
    // Увімкнені в LP-CRM каси без пароля / ключа — чеки їхніх відділів не звіряємо.
    const noCb = cashList.filter((k) => k.lp_active && k.active && !canSign(k)).map((k) => k.name);
    const state = await getJson('chk_state', {});
    return c.json({ from, to, rows, counts, no_checkbox: noCb, cb_failed: failed, state: { at: state.at || '', finished: state.finished || '', more: Boolean(state.more), errors: state.errors || [] } });
  });

  // Чеки за день по ФОП (замість зошита): кожен чек — з яким замовленням зіставлено; без замовлення — окремо.
  app.get('/api/checks/receipts', async (c) => {
    need(c, 'users');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('day') || '') ? c.req.query('day') : kyivDay();
    const { recs, matched, orders, fops } = await build(addDays(day, -20), day);
    const byReceipt = new Map([...matched].map(([code, r]) => [r.id, orders.find((o) => o.code === code)]));
    const list = recs.filter((r) => r.day === day).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const groups = new Map();
    for (const r of list) {
      const k = String(r.fop_id);
      if (!groups.has(k)) groups.set(k, { fop: fops[k] || `Каса ${k}`, rows: [], sum: 0, ret: 0, free: 0 });
      const g = groups.get(k);
      const o = byReceipt.get(r.id);
      const isRet = /RETURN/i.test(r.type);
      g.rows.push({ id: r.id, at: r.at, total: r.total, fiscal: r.fiscal, ret: isRet, pays: r.pays.map((p) => p.label || p.type).filter(Boolean), order: o ? { id: o.id, code: o.code, total: o.total, buyer: o.buyer } : null, url: `https://check.checkbox.ua/${r.id}` });
      if (isRet) g.ret = round2(g.ret + r.total); else g.sum = round2(g.sum + r.total);
      if (!o && !isRet) g.free++;
    }
    const done = await db.all(`SELECT fop_id, done, at FROM chk_days WHERE day = ?`, [day]);
    return c.json({ day, groups: [...groups.values()], loaded: done.length });
  });

  // Види оплат: клас і слово для способу оплати в чеку. Зберігаємо лише відмінності від типових.
  app.get('/api/checks/pay', async (c) => {
    need(c, 'users');
    const rs = await rules();
    return c.json({ classes: CLASSES, rows: Object.entries(rs).map(([id, r]) => ({ id, ...r, changed: JSON.stringify(PAY_DEFAULTS[id] || {}) !== JSON.stringify({ name: r.name, cls: r.cls, ...(r.cb ? { cb: r.cb } : {}) }) })).sort((a, b) => Number(a.id) - Number(b.id)) });
  });
  app.put('/api/checks/pay', async (c) => {
    need(c, 'users');
    const b = await c.req.json();
    const saved = {};
    for (const x of Array.isArray(b.rows) ? b.rows.slice(0, 200) : []) {
      const id = String(x.id || '').trim();
      if (!/^\d{1,4}$/.test(id) || !CLASSES[x.cls]) continue;
      const row = { name: String(x.name || PAY_DEFAULTS[id]?.name || `Оплата ${id}`).trim().slice(0, 60), cls: x.cls, cb: String(x.cb || '').trim().slice(0, 40) };
      const d = PAY_DEFAULTS[id];
      if (d && d.name === row.name && d.cls === row.cls && (d.cb || '') === row.cb) continue;
      saved[id] = row;
    }
    await setJson('chk_pay', saved);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- каси Checkbox (налаштування)
  // Секрети (пароль, ключ ліцензії, PIN) назовні не віддаємо — лише ознаку, що їх внесено.
  const pubCashier = (k) => {
    let offices = []; try { offices = JSON.parse(k.offices || '[]'); } catch { /* порожньо */ }
    return { id: k.id, name: k.name, login: k.login, offices, lp_active: Boolean(k.lp_active), active: Boolean(k.active), org_title: k.org_title, org_code: k.org_code,
      checked_at: k.checked_at, error: k.error, has_password: Boolean(k.password), has_license: Boolean(k.license), has_pin: Boolean(k.pin), ready: canSign(k) };
  };
  const cashierBody = (b, cur = {}) => {
    const keep = (v, old) => (v === undefined || v === null || v === '' ? old || '' : String(v).trim()); // порожнє поле секрету — без змін
    const offices = (Array.isArray(b.offices) ? b.offices : String(b.offices ?? '').split(/[\s,;]+/)).map((x) => String(x).trim()).filter((x) => /^\d{1,4}$/.test(x));
    const row = {
      name: String(b.name ?? cur.name ?? '').trim().slice(0, 120),
      login: String(b.login ?? cur.login ?? '').trim().slice(0, 120),
      password: b.clear_password ? '' : keep(b.password, cur.password).slice(0, 200),
      license: b.clear_license ? '' : keep(b.license, cur.license).slice(0, 200),
      pin: b.clear_pin ? '' : keep(b.pin, cur.pin).slice(0, 40),
      offices: JSON.stringify([...new Set(b.offices === undefined && cur.offices ? JSON.parse(cur.offices) : offices)]),
      lp_active: b.lp_active === undefined ? (cur.lp_active ?? 1) : (b.lp_active ? 1 : 0),
      active: b.active === undefined ? (cur.active ?? 1) : (b.active ? 1 : 0),
    };
    if (!row.name) throw fail(400, 'Вкажіть назву каси (ФОП / ТОВ).');
    return row;
  };
  app.get('/api/checks/cashiers', async (c) => {
    need(c, 'users');
    return c.json((await db.all(`SELECT * FROM chk_cashiers ORDER BY lp_active DESC, name`)).map(pubCashier));
  });
  app.post('/api/checks/cashiers', async (c) => {
    need(c, 'users');
    const r = cashierBody(await c.req.json());
    const res = await db.run(`INSERT INTO chk_cashiers (name, login, password, license, pin, offices, lp_active, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.name, r.login, r.password, r.license, r.pin, r.offices, r.lp_active, r.active, nowIso()]);
    return c.json(pubCashier(await db.get(`SELECT * FROM chk_cashiers WHERE id = ?`, [res.lastId])));
  });
  app.put('/api/checks/cashiers/:id', async (c) => {
    need(c, 'users');
    const cur = await db.get(`SELECT * FROM chk_cashiers WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'Касу не знайдено.');
    const r = cashierBody(await c.req.json(), cur);
    const secretChanged = r.login !== cur.login || r.password !== cur.password || r.license !== cur.license || r.pin !== cur.pin;
    await db.run(`UPDATE chk_cashiers SET name = ?, login = ?, password = ?, license = ?, pin = ?, offices = ?, lp_active = ?, active = ?${secretChanged ? ", error = '', checked_at = ''" : ''} WHERE id = ?`,
      [r.name, r.login, r.password, r.license, r.pin, r.offices, r.lp_active, r.active, cur.id]);
    if (secretChanged) { // новий доступ — знову пробуємо цю касу одразу
      const f = fromJson((await db.get(`SELECT value FROM settings WHERE key = 'chk_cb_fail'`))?.value);
      delete f[cur.id];
      await db.run(`INSERT INTO settings (key, value) VALUES ('chk_cb_fail', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(f)]);
    }
    return c.json(pubCashier(await db.get(`SELECT * FROM chk_cashiers WHERE id = ?`, [cur.id])));
  });
  app.delete('/api/checks/cashiers/:id', async (c) => {
    need(c, 'users');
    await db.run(`DELETE FROM chk_cashiers WHERE id = ?`, [c.req.param('id')]);
    return c.json({ ok: true });
  });
  // Перевірити вхід: Checkbox пускає? чия каса (організація, ІПН / ЄДРПОУ)?
  app.post('/api/checks/cashiers/:id/test', async (c) => {
    need(c, 'users');
    const k = await db.get(`SELECT * FROM chk_cashiers WHERE id = ?`, [c.req.param('id')]);
    if (!k) throw fail(404, 'Касу не знайдено.');
    if (!hasCheckbox(asCb({ ...k, active: 1 }))) throw fail(400, 'Внесіть пароль касира (або ключ ліцензії й PIN), тоді можна перевірити вхід.');
    try {
      const me = await cashierMe(fetchFn, asCb(k));
      await db.run(`UPDATE chk_cashiers SET org_title = ?, org_code = ?, checked_at = ?, error = '' WHERE id = ?`, [me.org_title.slice(0, 160), me.org_code.slice(0, 20), nowIso(), k.id]);
    } catch (e) {
      if (e.pending) throw e;
      await db.run(`UPDATE chk_cashiers SET checked_at = ?, error = ? WHERE id = ?`, [nowIso(), e.message.replace(/^Checkbox \d+: /, '').slice(0, 200), k.id]);
    }
    return c.json(pubCashier(await db.get(`SELECT * FROM chk_cashiers WHERE id = ?`, [k.id])));
  });

  // «Оновити зараз»: один крок збору; сторінка повторює, доки more = true.
  app.post('/api/checks/refresh', async (c) => {
    need(c, 'users');
    const r = await step({ force: true });
    return c.json({ more: Boolean(r.more), busy: Boolean(r.busy), skipped: r.skipped || '' });
  });

  return { step };
}
