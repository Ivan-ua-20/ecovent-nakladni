// Модуль «Маркетплейси»: замовлення магазинів Розетки (кабінет продавця), Prom і Епіцентру — для перегляду в одному місці.
// Магазини й доступи — у модулі «Маркування» (Налаштування → Доставка), звідси — через services.marking.
// Замовлення зберігаються в базі (45 днів): фонова задача раз на кілька хвилин забирає змінені з часу останньої
// синхронізації — по кілька сторінок за раз; незавершений прохід продовжується з наступної сторінки.
import { fail, need, nowIso } from '../../core/common.js';
import { rzOrdersSearch, rzItemComments, rzSuccessStatuses, rzOrderChat, rzSendMessage } from '../../integrations/rozetka.js';
import { promOrders } from '../../integrations/prom.js';
import { epcOrdersPage } from '../../integrations/epicentr.js';

const KEEP_DAYS = 45;
const HISTORY_YEARS = 4; // Розетка: історія типово за 4 роки (період можна обрати), зберігається весь цей час
const HIST_MIN_DAY = '2010-01-01';
const KEEP_DAYS_BY_MP = { rozetka: HISTORY_YEARS * 366 + 31 };
const HIST_PAGES_PER_RUN = 5;
// Скільки замовлень історії записувати за добу: ліміт записів D1 (100 тис. рядків на день, з індексами) спільний
// для всього сайту — історія розтягується на кілька днів, щоб рахунки й накладні не зупинились.
const HIST_DAY_CAP = 15000;
const COUNTS_TTL_MS = 30 * 60e3; // кількість замовлень у магазинах — з кешу (повний підрахунок дорогий за читаннями)
const FIRST_DAYS = 30; // перша синхронізація магазину — замовлення, змінені за 30 днів
const PAGES_PER_RUN = 3;
const OVERLAP_MS = 10 * 60e3; // беремо зміни із запасом, щоб нічого не пропустити на межі
// Відгуки на товари Розетки: перше завантаження — усі (по кілька сторінок за запуск), далі — раз на 3 год лише нові
// з перечитуванням останніх 7 днів (модерація, змінена оцінка). Незмінені відгуки не перезаписуються.
const RV_PAGES_PER_RUN = 8;
const RV_EVERY_MS = 3 * 3600e3;
const RV_RECHECK_DAYS = 7;
const RV_DEFAULT = {
  days: 3, // через скільки днів після отримання пропонувати нагадати
  tpl: "Добрий день, {ім'я}! Дякуємо за замовлення №{замовлення} на Розетці. Як вам {товар}? Будемо дуже вдячні за чесний відгук на сторінці товару — він допоможе іншим покупцям з вибором.",
};
const RV_VIA = { viber: 'Viber', telegram: 'Telegram', phone: 'дзвінок', copy: 'скопійовано текст', chat: 'чат Розетки', manual: 'вручну' };
// Розетка не пропускає в чаті посилання, телефони та інші контакти.
const CHAT_FORBIDDEN = /(https?:\/\/|www\.|t\.me\/|viber:|@[a-z0-9_]{3,}|\b[a-z0-9-]+\.(com|ua|net|org|me|shop|store)\b|\+?\d[\d\s()-]{8,}\d)/i;

export const MARKETS = [
  { key: 'rozetka', title: 'Розетка' },
  { key: 'prom', title: 'Prom' },
  { key: 'epc', title: 'Епіцентр' },
];
const EPC_STATUS = {
  new: 'Новий', confirmed_by_merchant: 'Підтверджено продавцем', confirmed: 'Підтверджений', sent: 'Відправлено', delivered: 'Готовий до видачі',
  completed: 'Завершено', closed: 'Закрито', canceled: 'Скасовано', returned: 'Повернено', return_requested: 'Запит на повернення',
  canceled_by_merchant: 'Скасовано продавцем', completed_merchant_rejection: 'Завершено (відмова продавця)', closed_merchant_rejection: 'Закрито (відмова продавця)',
};
const EPC_DELIVERY = {
  nova_poshta: 'Нова пошта', ukrposhta: 'Укрпошта', meest: 'Meest', pickup: 'Самовивіз', cvz_epicentr: 'Центр видачі Епіцентр',
  parcel_box_epicentr: 'Поштомат Епіцентр', courier_delivery: "Кур'єр",
};

// Дата й час за Києвом: 'YYYY-MM-DD HH:MM:SS' (так само показує кабінет Розетки).
const kyivDT = (v) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v || '').slice(0, 19).replace('T', ' ');
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
};
const money = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const fio = (...parts) => parts.map((x) => String(x || '').trim()).filter(Boolean).join(' ');

// Замовлення маркетплейсу → рядок mp_orders.
const ROW = {
  rozetka: (o) => ({
    id: String(o.id), number: String(o.id), created_at: String(o.created || ''), changed_at: String(o.changed || ''),
    status: String(o.status ?? ''), status_name: String(o.status_data?.name_uk || o.status_data?.name || ''), status_group: Number(o.status_group) || 0,
    customer: o.user_title?.full_name || o.delivery?.recipient_title?.full_name || fio(o.delivery?.recipient_last_name, o.delivery?.recipient_first_name),
    phone: String(o.user_phone || o.delivery?.recipient_phone || ''), total: money(o.cost ?? o.amount),
    delivery: String(o.delivery?.delivery_service_name || o.delivery_service?.name || ''), ttn: String(o.ttn || o.delivery?.ttn || ''),
    items: (o.purchases || []).map((p) => ({ name: String(p.item_name || p.item?.name || ''), qty: Number(p.quantity) || 1, price: money(p.price) })),
  }),
  prom: (o) => ({
    id: String(o.id), number: String(o.id), created_at: kyivDT(o.date_created), changed_at: kyivDT(o.date_modified || o.date_created),
    status: String(o.status || ''), status_name: String(o.status_name || o.status || ''),
    customer: fio(o.client_last_name, o.client_first_name, o.client_second_name), phone: String(o.phone || ''), total: money(o.full_price ?? o.price),
    delivery: String(o.delivery_option?.name || ''), ttn: String(o.delivery_provider_data?.declaration_number || ''),
    items: (o.products || []).map((p) => ({ name: String(p.name || p.name_multilang?.uk || ''), qty: Number(p.quantity) || 1, price: money(p.price) })),
  }),
  epc: (o) => ({
    id: String(o.id), number: String(o.number || o.id), created_at: kyivDT(o.createdAt), changed_at: kyivDT(o.updatedAt || o.createdAt),
    status: String(o.statusCode || ''), status_name: EPC_STATUS[o.statusCode] || String(o.statusCode || ''),
    customer: fio(o.address?.lastName, o.address?.firstName, o.address?.patronymic), phone: String(o.address?.phone || ''), total: money(o.subtotal),
    delivery: EPC_DELIVERY[o.address?.shipment?.provider] || String(o.address?.shipment?.provider || ''), ttn: String(o.address?.shipment?.number || ''),
    items: (o.items || []).map((p) => ({ name: String(p.title || ''), qty: Number(p.quantity) || 1, price: money(p.price) })),
  }),
};

export function mountMarket(app, { db, fetchFn, services = {}, onCron = () => {}, onCleanup = () => {} }) {
  const borderOf = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  onCleanup(async () => {
    const own = Object.keys(KEEP_DAYS_BY_MP);
    await db.batch([
      [`DELETE FROM mp_orders WHERE mp NOT IN (SELECT value FROM json_each(?)) AND created_at != '' AND created_at < ?`, [JSON.stringify(own), borderOf(KEEP_DAYS)]],
      // магазин з історією за обраний період, давнішу за 4 роки, — зберігається з початку того періоду (keep_from)
      ...own.map((mp) => [`DELETE FROM mp_orders WHERE mp = ? AND created_at != '' AND created_at < ?
        AND created_at < COALESCE((SELECT NULLIF(s.keep_from, '') FROM mp_sync s WHERE s.mp = mp_orders.mp AND s.account_id = mp_orders.account_id), ?)`,
      [mp, borderOf(KEEP_DAYS_BY_MP[mp]), borderOf(KEEP_DAYS_BY_MP[mp])]]),
      [`DELETE FROM mp_reviews WHERE created_at != '' AND created_at < ?
        AND created_at < COALESCE((SELECT NULLIF(s.keep_from, '') FROM mp_sync s WHERE s.mp = mp_reviews.mp AND s.account_id = mp_reviews.account_id), ?)`,
      [borderOf(KEEP_DAYS_BY_MP.rozetka), borderOf(KEEP_DAYS_BY_MP.rozetka)]],
    ]);
  });

  const shopsOf = async () => (await services.marking?.marketShops?.()) || {};

  const searchOf = (r) => [r.number, r.customer, String(r.phone || '').replace(/\D/g, ''), r.ttn].filter(Boolean).join(' ').toLowerCase();
  // Незмінене замовлення не перезаписується (економія записів D1 при повторних проходах і перезапуску історії).
  async function saveRows(mp, accountId, rows) {
    if (!rows.length) return;
    const now = nowIso();
    await db.batch(rows.map((r) => [
      `INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, delivery, ttn, items, synced_at, search, status_group)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mp, account_id, id) DO UPDATE SET number = excluded.number, created_at = excluded.created_at, changed_at = excluded.changed_at,
         status = excluded.status, status_name = excluded.status_name, customer = excluded.customer, phone = excluded.phone, total = excluded.total,
         delivery = excluded.delivery, ttn = excluded.ttn, items = excluded.items, synced_at = excluded.synced_at, search = excluded.search,
         status_group = excluded.status_group
       WHERE mp_orders.changed_at IS NOT excluded.changed_at OR mp_orders.status IS NOT excluded.status OR mp_orders.ttn IS NOT excluded.ttn
         OR mp_orders.total IS NOT excluded.total OR mp_orders.search IS NOT excluded.search OR mp_orders.status_group IS NOT excluded.status_group`,
      [mp, accountId, r.id, r.number, r.created_at, r.changed_at, r.status, r.status_name, r.customer, r.phone, r.total, r.delivery, r.ttn, JSON.stringify(r.items), now, searchOf(r), r.status_group || 0],
    ]));
  }

  // Разово: історію Розетки, завантажену без «Успішних» і «Неуспішних» (до types=1), — перезавантажити.
  async function rehistOnce() {
    if ((await db.get(`SELECT value FROM settings WHERE key = 'mp_hist_v2'`))?.value) return;
    await db.batch([
      [`UPDATE mp_sync SET hist_to = ?, hist_page = 1, hist_done = 0, hist_saved = 0, hist_error = '' WHERE mp = 'rozetka' AND hist_from != ''`, [kyivDT(new Date()).slice(0, 10)]],
      [`INSERT INTO settings (key, value) VALUES ('mp_hist_v2', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`, []],
    ]);
  }
  // Денний ліміт записів історії (спільний для всіх магазинів).
  async function histBudget() {
    const day = kyivDT(new Date()).slice(0, 10);
    let v = {};
    try { v = JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'mp_hist_day'`))?.value || '{}'); } catch { /* */ }
    return { day, used: v.day === day ? Number(v.n) || 0 : 0 };
  }
  const histSpend = (day, n) => db.run(`INSERT INTO settings (key, value) VALUES ('mp_hist_day', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify({ day, n })]);

  // Одна сторінка змін магазину: рядки й курсор наступної ('' — сторінок більше немає).
  async function fetchPage(mp, acc, from, cursor) {
    if (mp === 'prom') {
      const list = await promOrders(fetchFn, acc.token, { limit: 100, lastModifiedFrom: new Date(from).toISOString().slice(0, 19), lastId: Number(cursor) || 0 });
      const next = list.length >= 100 ? String(Math.min(...list.map((o) => Number(o.id))) - 1) : '';
      return { rows: list.map(ROW.prom), next };
    }
    if (mp === 'epc') {
      const { items, next } = await epcOrdersPage(fetchFn, acc.token, { updatedFrom: new Date(from).toISOString(), cursor });
      return { rows: items.map(ROW.epc), next };
    }
    const page = Number(cursor) || 1;
    const r = await rzSearch(acc, { changedFrom: kyivDT(from), page });
    return { rows: r.orders.map(ROW.rozetka), next: page < r.pageCount ? String(page + 1) : '' };
  }
  // Запит до Розетки з токеном магазину; токен прострочено — вхід заново і ще раз.
  async function rzCall(acc, fn) {
    try {
      return await fn(await services.marking.rozetkaToken(acc));
    } catch (e) {
      if (!e.rzAuth) throw e;
      return fn(await services.marking.rozetkaToken(acc, true));
    }
  }
  const rzSearch = (acc, opts) => rzCall(acc, (t) => rzOrdersSearch(fetchFn, t, opts));

  // ---------- історія Розетки за 4 роки: по місяцях назад за датою створення ----------
  const kyivDay = (d = new Date()) => kyivDT(d).slice(0, 10);
  const addDaysStr = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const histState = (st) => {
    if (!st?.hist_from) return { started: false };
    const end = st.hist_end || kyivDay();
    const span = Math.max(1, Date.parse(end) - Date.parse(st.hist_from));
    const left = st.hist_done ? 0 : Math.max(0, Math.min(Date.parse(st.hist_to), Date.parse(end)) - Date.parse(st.hist_from));
    return { started: true, done: Boolean(st.hist_done), from: st.hist_from, end, to: st.hist_done ? st.hist_from : st.hist_to, saved: st.hist_saved || 0,
      pct: Math.round(((span - left) / span) * 100), error: st.hist_error || '', paused: Boolean(st.paused) };
  };
  // Почати завантаження історії за період (типово — 4 роки до сьогодні). Інший період можна завантажити пізніше:
  // уже завантажені замовлення лишаються, зберігання — з найдавнішої дати з усіх періодів.
  async function histStart(mp, acc, period = {}) {
    if (mp !== 'rozetka') throw fail(400, 'Історію завантажуємо лише для Розетки.');
    const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
    const today = kyivDay();
    const from = period.from ? String(period.from) : addDaysStr(today, -HISTORY_YEARS * 365);
    const to = period.to ? String(period.to) : today;
    if (!isDay(from) || !isDay(to)) throw fail(400, 'Вкажіть дати періоду.');
    if (from > to) throw fail(400, 'Початок періоду — пізніше за кінець.');
    if (from < HIST_MIN_DAY) throw fail(400, 'Найдавніша дата — 01.01.2010.');
    const end = to > today ? today : to;
    const st = await db.get(`SELECT keep_from FROM mp_sync WHERE mp = ? AND account_id = ?`, [mp, acc.id]);
    const defKeep = addDaysStr(today, -(KEEP_DAYS_BY_MP[mp] || KEEP_DAYS));
    const oldest = [from, st?.keep_from || defKeep].sort()[0];
    const keep = oldest < defKeep ? oldest : ''; // '' — звичайні 4 роки
    await db.run(`INSERT INTO mp_sync (mp, account_id, hist_from, hist_to, hist_end, keep_from, hist_page, hist_done, hist_saved, hist_error) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, '')
      ON CONFLICT(mp, account_id) DO UPDATE SET hist_from = excluded.hist_from, hist_to = excluded.hist_to, hist_end = excluded.hist_end, keep_from = excluded.keep_from,
        hist_page = 1, hist_done = 0, hist_saved = 0, hist_error = ''`,
    [mp, acc.id, from, end, end, keep]);
    return histState(await db.get(`SELECT * FROM mp_sync WHERE mp = ? AND account_id = ?`, [mp, acc.id]));
  }
  // Кілька сторінок історії; прогрес — у mp_sync (наступний виклик продовжить з того ж місця).
  async function histStep(mp, acc, pages = HIST_PAGES_PER_RUN) {
    await rehistOnce();
    const st = await db.get(`SELECT * FROM mp_sync WHERE mp = ? AND account_id = ?`, [mp, acc.id]);
    if (!st?.hist_from || st.hist_done) return histState(st);
    const budget = await histBudget();
    if (budget.used >= HIST_DAY_CAP) return histState({ ...st, paused: true });
    let spent = 0;
    let to = st.hist_to;
    let page = st.hist_page || 1;
    let saved = st.hist_saved || 0;
    let done = 0;
    let error = '';
    try {
      for (let p = 0; p < pages && !done && budget.used + spent < HIST_DAY_CAP; p++) {
        const monthStart = `${to.slice(0, 7)}-01`;
        const from = monthStart < st.hist_from ? st.hist_from : monthStart;
        const r = await rzSearch(acc, { createdFrom: `${from} 00:00:00`, createdTo: `${to} 23:59:59`, page });
        await saveRows(mp, acc.id, r.orders.map(ROW.rozetka));
        saved += r.orders.length;
        spent += r.orders.length;
        if (page < r.pageCount && r.orders.length) page++;
        else {
          page = 1;
          to = addDaysStr(from, -1);
          if (to < st.hist_from) done = 1;
        }
      }
    } catch (e) {
      if (!e.pending) error = String(e.message || e).slice(0, 300);
      else { await saveHist(); throw e; }
    }
    async function saveHist() {
      await db.run(`UPDATE mp_sync SET hist_to = ?, hist_page = ?, hist_done = ?, hist_saved = ?, hist_error = ? WHERE mp = ? AND account_id = ?`,
        [to, page, done, saved, error, mp, acc.id]);
      if (spent) await histSpend(budget.day, budget.used + spent);
    }
    await saveHist();
    return histState({ ...st, hist_to: to, hist_page: page, hist_done: done, hist_saved: saved, hist_error: error, paused: !done && budget.used + spent >= HIST_DAY_CAP });
  }
  async function histAll() {
    await rehistOnce();
    const shops = ((await shopsOf()).rozetka || []).filter((a) => a.active);
    const states = await db.all(`SELECT * FROM mp_sync WHERE mp = 'rozetka' AND hist_from != '' AND hist_done = 0`);
    const out = { shops: 0, saved: 0, done: 0 };
    for (const s of states) {
      const acc = shops.find((a) => a.id === s.account_id);
      if (!acc) continue;
      try {
        const r = await histStep('rozetka', acc);
        out.shops++; out.saved += r.saved - (s.hist_saved || 0); if (r.done) out.done++;
      } catch (e) {
        if (e.pending) break;
      }
    }
    return out.shops ? out : { skipped: 'історія не завантажується' };
  }

  // ---------- відгуки на товари Розетки ----------
  const getSetting = async (key, def) => {
    try { return JSON.parse((await db.get(`SELECT value FROM settings WHERE key = ?`, [key]))?.value || 'null') ?? def; } catch { return def; }
  };
  const putSetting = (key, v) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, JSON.stringify(v)]);
  const rvSettings = async () => ({ ...RV_DEFAULT, ...(await getSetting('mp_review', {})) });

  // Коди статусів «Успішні» (з Розетки, раз на тиждень): для рядків, збережених до появи status_group.
  async function successIds(acc = null) {
    let v = await getSetting('mp_rz_success', null);
    if (acc && (!v || Date.now() - v.at > 7 * 86400e3)) {
      try {
        const ids = await rzCall(acc, (t) => rzSuccessStatuses(fetchFn, t));
        if (ids.length) { v = { at: Date.now(), ids }; await putSetting('mp_rz_success', v); }
      } catch (e) { if (e.pending) throw e; }
    }
    return v?.ids || [];
  }
  const SUCCESS_SQL = `(status_group = 2 OR (status_group = 0 AND status IN (SELECT value FROM json_each(?))))`;

  const recordTitle = (c) => {
    let r = c.record;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = null; } }
    return String(r?.title || c.item?.name_ua || c.item?.name || '');
  };
  // Відгуки сторінки → mp_reviews (лише відгуки до замовлень, без відповідей), потім позначки у замовленнях.
  async function saveReviews(accountId, comments) {
    const rows = comments.filter((c) => !Number(c.parent_id) && Number(c.orders_id) > 0 && (!c.type || c.type === 'comment')).map((c) => ({
      id: String(c.id), order_id: String(c.orders_id), goods: recordTitle(c).slice(0, 300), mark: Math.max(0, Math.min(5, Number(c.mark) || 0)),
      name: String(c.name || '').slice(0, 120), text: [c.text, c.dignity && `Переваги: ${c.dignity}`, c.shortcomings && `Недоліки: ${c.shortcomings}`].filter(Boolean).join('\n').slice(0, 600),
      status: String(c.status || ''), created_at: String(c.created || ''), changed_at: String(c.changed || c.created || ''),
    }));
    if (!rows.length) return 0;
    const sub = (what) => `(SELECT ${what} FROM mp_reviews r WHERE r.mp = mp_orders.mp AND r.account_id = mp_orders.account_id AND r.order_id = mp_orders.id)`;
    const n = sub('COUNT(*)');
    const mk = `COALESCE(${sub('MIN(NULLIF(mark, 0))')}, 0)`;
    await db.batch([
      ...rows.map((r) => [
        `INSERT INTO mp_reviews (mp, account_id, id, order_id, goods, mark, name, text, status, created_at, changed_at) VALUES ('rozetka', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mp, account_id, id) DO UPDATE SET order_id = excluded.order_id, goods = excluded.goods, mark = excluded.mark, name = excluded.name,
           text = excluded.text, status = excluded.status, created_at = excluded.created_at, changed_at = excluded.changed_at
         WHERE mp_reviews.changed_at IS NOT excluded.changed_at OR mp_reviews.status IS NOT excluded.status OR mp_reviews.mark IS NOT excluded.mark
           OR mp_reviews.order_id IS NOT excluded.order_id`,
        [accountId, r.id, r.order_id, r.goods, r.mark, r.name, r.text, r.status, r.created_at, r.changed_at],
      ]),
      [`UPDATE mp_orders SET review_n = ${n}, review_mark = ${mk}
        WHERE mp = 'rozetka' AND account_id = ? AND id IN (SELECT value FROM json_each(?)) AND (review_n IS NOT ${n} OR review_mark IS NOT ${mk})`,
      [accountId, JSON.stringify([...new Set(rows.map((r) => r.order_id))])]],
    ]);
    return rows.length;
  }

  // Кілька сторінок відгуків магазину. Перше завантаження — усі від найдавніших; далі — раз на 3 год
  // нові з запасом у 7 днів. force — не чекати 3 год (кнопка «Оновити зараз»).
  async function reviewsStep(acc, { pages = RV_PAGES_PER_RUN, force = false } = {}) {
    const st = await db.get(`SELECT * FROM mp_sync WHERE mp = 'rozetka' AND account_id = ?`, [acc.id]);
    const full = !st?.rv_full;
    let page = st?.rv_page || 0;
    let run = st?.rv_run || '';
    if (!page) {
      if (!force && !full && st?.rv_at && Date.now() - Date.parse(st.rv_at) < RV_EVERY_MS) return { skipped: true };
      page = 1;
      run = nowIso();
    }
    const from = full ? '' : kyivDay(new Date(Date.parse(st.rv_at || run) - RV_RECHECK_DAYS * 86400e3));
    let saved = 0;
    let done = false;
    let error = '';
    const save = async () => {
      const total = done ? (await db.get(`SELECT COUNT(*) AS n FROM mp_reviews WHERE mp = 'rozetka' AND account_id = ?`, [acc.id])).n : st?.rv_n || 0;
      await db.run(`INSERT INTO mp_sync (mp, account_id, rv_page, rv_run, rv_full, rv_at, rv_n, rv_error) VALUES ('rozetka', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mp, account_id) DO UPDATE SET rv_page = excluded.rv_page, rv_run = excluded.rv_run, rv_full = excluded.rv_full,
          rv_at = excluded.rv_at, rv_n = excluded.rv_n, rv_error = excluded.rv_error`,
      [acc.id, done ? 0 : page, done ? '' : run, full ? (done ? 1 : 0) : 1, done ? run : st?.rv_at || '', total, error]);
    };
    try {
      await successIds(acc);
      for (let p = 0; p < pages && !done; p++) {
        const r = await rzCall(acc, (t) => rzItemComments(fetchFn, t, { page, createdFrom: from, sort: full ? 'created' : '-created' }));
        saved += await saveReviews(acc.id, r.comments);
        if (page >= r.pageCount || !r.comments.length) done = true;
        else page++;
      }
    } catch (e) {
      if (e.pending) { await save(); throw e; }
      error = String(e.message || e).slice(0, 300);
    }
    await save();
    return { saved, done, full, error };
  }
  async function reviewsAll() {
    const shops = ((await shopsOf()).rozetka || []).filter((a) => a.active);
    const out = { shops: 0, saved: 0, errors: 0 };
    for (const acc of shops) {
      try {
        const r = await reviewsStep(acc);
        if (r.skipped) continue;
        out.shops++; out.saved += r.saved; if (r.error) out.errors++;
      } catch (e) {
        if (e.pending) break;
        out.errors++;
      }
    }
    return out.shops || out.errors ? out : { skipped: shops.length ? 'відгуки вже оновлено' : 'магазинів Розетки немає' };
  }

  async function syncShop(mp, acc, { pages = PAGES_PER_RUN } = {}) {
    const st = await db.get(`SELECT * FROM mp_sync WHERE mp = ? AND account_id = ?`, [mp, acc.id]);
    const resume = Boolean(st?.cursor);
    const started = resume ? st.run_started : nowIso();
    const from = resume ? st.run_from : new Date((st?.since ? Date.parse(st.since) : Date.now() - FIRST_DAYS * 86400000) - OVERLAP_MS).toISOString();
    let cursor = resume ? st.cursor : '';
    let saved = 0;
    const put = (fields) => db.run(
      `INSERT INTO mp_sync (mp, account_id, synced_at, since, cursor, run_from, run_started, error, error_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mp, account_id) DO UPDATE SET synced_at = excluded.synced_at, since = excluded.since, cursor = excluded.cursor,
         run_from = excluded.run_from, run_started = excluded.run_started, error = excluded.error, error_at = excluded.error_at`,
      [mp, acc.id, fields.synced_at ?? st?.synced_at ?? '', fields.since ?? st?.since ?? '', fields.cursor ?? '', fields.run_from ?? '', fields.run_started ?? '',
        fields.error ?? '', fields.error_at ?? ''],
    );
    try {
      for (let p = 0; p < pages; p++) {
        const page = await fetchPage(mp, acc, from, cursor);
        await saveRows(mp, acc.id, page.rows);
        saved += page.rows.length;
        cursor = page.next;
        if (!cursor) break;
      }
    } catch (e) {
      if (e.pending) { await put({ cursor, run_from: from, run_started: started }); throw e; }
      await put({ cursor, run_from: cursor ? from : '', run_started: cursor ? started : '', error: String(e.message || e).slice(0, 300), error_at: nowIso() });
      throw e;
    }
    if (cursor) await put({ cursor, run_from: from, run_started: started, synced_at: nowIso() });
    else await put({ since: started, synced_at: nowIso() });
    return { saved, more: Boolean(cursor) };
  }

  // Фонова задача: усі ввімкнені магазини, кожен — кілька сторінок; помилка одного не зупиняє інших.
  async function syncAll() {
    const shops = await shopsOf();
    const out = { shops: 0, saved: 0, more: 0, errors: 0 };
    for (const { key } of MARKETS) {
      for (const acc of (shops[key] || []).filter((a) => a.active)) {
        try {
          const r = await syncShop(key, acc);
          out.shops++; out.saved += r.saved; if (r.more) out.more++;
        } catch (e) {
          if (e.pending) return { ...out, more: out.more + 1 };
          out.errors++;
        }
      }
    }
    return out.shops || out.errors ? out : { skipped: 'магазини маркетплейсів не підключено' };
  }
  onCron('market', 'Замовлення маркетплейсів (Розетка, Prom, Епіцентр)', syncAll);
  onCron('market-history', 'Історія замовлень Розетки за обраний період (поки не завантажено)', histAll);
  onCron('market-reviews', 'Відгуки на товари Розетки (раз на 3 год)', reviewsAll);

  // ---------- для сторінки «Маркетплейси» ----------
  // Кількість замовлень у магазинах — з кешу на 30 хв (повний підрахунок читає всі рядки, а з історією їх десятки тисяч).
  async function cachedCounts() {
    let c = null;
    try { c = JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'mp_counts'`))?.value || 'null'); } catch { /* */ }
    if (c && Date.now() - c.at < COUNTS_TTL_MS) return c.rows;
    const rows = await db.all(`SELECT mp, account_id, COUNT(*) AS n FROM mp_orders GROUP BY mp, account_id`);
    await db.run(`INSERT INTO settings (key, value) VALUES ('mp_counts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify({ at: Date.now(), rows })]);
    return rows;
  }

  app.get('/api/mp/shops', async (c) => {
    need(c, 'docs.view');
    await rehistOnce();
    const [shops, counts, syncs] = await Promise.all([shopsOf(), cachedCounts(), db.all(`SELECT * FROM mp_sync`)]);
    const cnt = new Map(counts.map((r) => [`${r.mp}:${r.account_id}`, r.n]));
    const sy = new Map(syncs.map((r) => [`${r.mp}:${r.account_id}`, r]));
    return c.json(MARKETS.map((m) => ({
      ...m,
      shops: (shops[m.key] || []).map((a) => {
        const s = sy.get(`${m.key}:${a.id}`);
        return { id: a.id, name: a.name, active: Boolean(a.active), orders: cnt.get(`${m.key}:${a.id}`) || 0, synced_at: s?.synced_at || '', loading: Boolean(s?.cursor), error: s?.error || '', error_at: s?.error_at || '',
          history: m.key === 'rozetka' ? histState(s) : null,
          reviews: m.key === 'rozetka' ? { full: Boolean(s?.rv_full), n: s?.rv_n || 0, at: s?.rv_at || '', loading: Boolean(s?.rv_page), error: s?.rv_error || '' } : null };
      }),
    })));
  });

  app.get('/api/mp/orders', async (c) => {
    need(c, 'docs.view');
    const mp = c.req.query('mp');
    if (!MARKETS.some((m) => m.key === mp)) throw fail(400, 'Невідомий маркетплейс.');
    const where = ['mp = ?'];
    const params = [mp];
    const acc = Number(c.req.query('account')) || 0;
    if (acc) { where.push('account_id = ?'); params.push(acc); }
    // період за датою створення (YYYY-MM-DD)
    const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const dFrom = c.req.query('from');
    const dTo = c.req.query('to');
    if (isDay(dFrom)) { where.push('created_at >= ?'); params.push(dFrom); }
    if (isDay(dTo)) { where.push('created_at < ?'); params.push(addDaysStr(dTo, 1)); }
    const base = [...where];
    const baseParams = [...params];
    const rz = mp === 'rozetka';
    const okIds = rz ? JSON.stringify(await successIds()) : '[]';
    const rvs = rz ? await rvSettings() : RV_DEFAULT;
    const border = kyivDT(Date.now() - rvs.days * 86400e3); // отримано щонайменше days днів тому
    const rv = rz ? String(c.req.query('rv') || '') : '';
    if (rv === 'ask') { where.push(`${SUCCESS_SQL} AND review_n = 0 AND asked_at = '' AND changed_at <= ?`); params.push(okIds, border); }
    if (rv === 'none') { where.push(`${SUCCESS_SQL} AND review_n = 0`); params.push(okIds); }
    if (rv === 'asked') where.push(`asked_at != '' AND review_n = 0`);
    if (rv === 'has') where.push('review_n > 0');
    const status = c.req.query('status') || '';
    if (status) { where.push('status = ?'); params.push(status); }
    const q = String(c.req.query('q') || '').trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      // search — малими літерами (кирилиця без урахування регістру); старі рядки без search — за колонками
      where.push(`(search LIKE ? OR number LIKE ? OR customer LIKE ? OR ttn LIKE ?${digits.length >= 5 ? ' OR phone LIKE ? OR search LIKE ?' : ''})`);
      params.push(`%${q.toLowerCase()}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...(digits.length >= 5 ? [`%${digits.slice(-9)}%`, `%${digits.slice(-9)}%`] : []));
    }
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const [rows, statuses, total, rvStats, rvBy] = await Promise.all([
      db.all(`SELECT *, ${rz ? SUCCESS_SQL : '0'} AS ok FROM mp_orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 301 OFFSET ?`, [...(rz ? [okIds] : []), ...params, offset]),
      db.all(`SELECT status, MAX(status_name) AS status_name, COUNT(*) AS n FROM mp_orders WHERE ${base.join(' AND ')} GROUP BY status ORDER BY n DESC`, baseParams),
      db.get(`SELECT COUNT(*) AS n, SUM(total) AS sum FROM mp_orders WHERE ${where.join(' AND ')}`, params),
      // відгуки за період і магазин (без фільтрів статусу й пошуку): виконані, з відгуком, кому вже можна нагадати, кому нагадали
      rz ? db.get(`SELECT SUM(ok) AS done, SUM(ok AND review_n > 0) AS reviewed, SUM(ok AND review_n = 0 AND asked_at = '' AND changed_at <= ?) AS toask,
          SUM(asked_at != '') AS asked, SUM(asked_at != '' AND review_n > 0) AS asked_reviewed
        FROM (SELECT ${SUCCESS_SQL} AS ok, review_n, asked_at, changed_at FROM mp_orders WHERE ${base.join(' AND ')})`, [border, okIds, ...baseParams]) : null,
      rz ? db.all(`SELECT asked_by AS who, COUNT(*) AS n, SUM(review_n > 0) AS reviewed FROM mp_orders WHERE ${base.join(' AND ')} AND asked_at != '' GROUP BY asked_by ORDER BY n DESC`, baseParams) : [],
    ]);
    return c.json({
      rows: rows.slice(0, 300).map((r) => ({ ...r, items: (() => { try { return JSON.parse(r.items || '[]'); } catch { return []; } })() })),
      more: rows.length > 300,
      total: { n: total?.n || 0, sum: Math.round((total?.sum || 0) * 100) / 100 },
      statuses,
      ...(rz ? { reviews: { days: rvs.days, stats: Object.fromEntries(Object.entries(rvStats || {}).map(([k, v]) => [k, v || 0])), by: rvBy } } : {}),
    });
  });

  // ---------- відгуки: налаштування, позначка «нагадав», повідомлення в чат Розетки ----------
  app.get('/api/mp/review/settings', async (c) => {
    need(c, 'docs.view');
    return c.json(await rvSettings());
  });
  app.put('/api/mp/review/settings', async (c) => {
    need(c, 'api');
    const b = await c.req.json().catch(() => ({}));
    const days = Number(b.days);
    if (!Number.isInteger(days) || days < 0 || days > 60) throw fail(400, 'Кількість днів — від 0 до 60.');
    const tpl = String(b.tpl || '').trim();
    if (!tpl || tpl.length > 1000) throw fail(400, 'Текст повідомлення — від 1 до 1000 символів.');
    await putSetting('mp_review', { days, tpl });
    return c.json({ days, tpl });
  });
  const rzOrderOf = async (b) => {
    const o = await db.get(`SELECT * FROM mp_orders WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [Number(b.account) || 0, String(b.id || '')]);
    if (!o) throw fail(404, 'Замовлення не знайдено.');
    return o;
  };
  const markAsked = async (o, user, via) => {
    const at = nowIso();
    const by = String(user?.name || user?.login || '').slice(0, 80);
    await db.run(`UPDATE mp_orders SET asked_at = ?, asked_by = ?, asked_via = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [at, by, via, o.account_id, o.id]);
    return { asked_at: at, asked_by: by, asked_via: via };
  };
  // Менеджер нагадав (Viber, Telegram, дзвінок, скопіював текст, вручну) або скасував позначку (undo).
  app.post('/api/mp/review/ask', async (c) => {
    need(c, 'docs.view');
    const b = await c.req.json().catch(() => ({}));
    const o = await rzOrderOf(b);
    if (b.undo) {
      await db.run(`UPDATE mp_orders SET asked_at = '', asked_by = '', asked_via = '' WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [o.account_id, o.id]);
      return c.json({ asked_at: '', asked_by: '', asked_via: '' });
    }
    if (!RV_VIA[b.via] || b.via === 'chat') throw fail(400, 'Невідомий спосіб.');
    return c.json(await markAsked(o, c.get('user'), b.via));
  });
  // Повідомлення покупцю в чат замовлення на Розетці (без посилань і контактів — інакше модерація заблокує).
  app.post('/api/mp/review/chat', async (c) => {
    need(c, 'docs.view');
    const b = await c.req.json().catch(() => ({}));
    const text = String(b.text || '').trim();
    if (!text || text.length > 1000) throw fail(400, 'Напишіть повідомлення (до 1000 символів).');
    if (CHAT_FORBIDDEN.test(text)) throw fail(400, 'У чаті Розетки не можна надсилати посилання, телефони й інші контакти — приберіть їх з тексту.');
    const o = await rzOrderOf(b);
    const acc = await accOf('rozetka', o.account_id);
    const chat = await rzCall(acc, (t) => rzOrderChat(fetchFn, t, o.id)).catch((e) => { if (e.pending) throw e; return null; });
    if (!chat?.id || !chat.userId) throw fail(400, 'Розетка не дала чат цього замовлення — напишіть покупцю у Viber або Telegram.');
    await rzCall(acc, (t) => rzSendMessage(fetchFn, t, { chatId: chat.id, receiverId: chat.userId, body: text }));
    return c.json(await markAsked(o, c.get('user'), 'chat'));
  });

  // Оновити магазин зараз (кнопка на сторінці).
  app.post('/api/mp/sync', async (c) => {
    need(c, 'docs.view');
    const b = await c.req.json().catch(() => ({}));
    const acc = ((await shopsOf())[b.mp] || []).find((a) => a.id === Number(b.account));
    if (!acc) throw fail(404, 'Магазин не знайдено.');
    const r = await syncShop(b.mp, acc);
    if (b.mp === 'rozetka') await reviewsStep(acc, { pages: 2, force: true }).catch((e) => { if (e.pending) throw e; });
    return c.json(r);
  });

  // Історія Розетки за 4 роки: почати (адміни) і довантажити кілька сторінок зараз (поки відкрита сторінка).
  const accOf = async (mp, id) => {
    const acc = ((await shopsOf())[mp] || []).find((a) => a.id === Number(id));
    if (!acc) throw fail(404, 'Магазин не знайдено.');
    return acc;
  };
  app.post('/api/mp/history/start', async (c) => {
    need(c, 'api');
    const b = await c.req.json().catch(() => ({}));
    return c.json(await histStart(b.mp, await accOf(b.mp, b.account), { from: b.from, to: b.to }));
  });
  app.post('/api/mp/history/step', async (c) => {
    need(c, 'docs.view');
    const b = await c.req.json().catch(() => ({}));
    return c.json(await histStep(b.mp, await accOf(b.mp, b.account)));
  });

  // Перейменувати магазин (як у налаштуваннях доставки) — адміни.
  app.put('/api/mp/shops/:mp/:id', async (c) => {
    need(c, 'api');
    const b = await c.req.json().catch(() => ({}));
    return c.json(await services.marking.renameShop(c.req.param('mp'), Number(c.req.param('id')), b.name, c.get('user')));
  });

  return { syncAll };
}
