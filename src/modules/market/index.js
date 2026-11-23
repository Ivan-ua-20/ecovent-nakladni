// Модуль «Маркетплейси»: замовлення магазинів Розетки (кабінет продавця), Prom і Епіцентру — для перегляду в одному місці.
// Магазини й доступи — у модулі «Маркування» (Налаштування → Доставка), звідси — через services.marking.
// Замовлення зберігаються в базі (45 днів): фонова задача раз на кілька хвилин забирає змінені з часу останньої
// синхронізації — по кілька сторінок за раз; незавершений прохід продовжується з наступної сторінки.
import { fail, need, nowIso } from '../../core/common.js';
import { shopAllowed, accessOf } from '../../core/auth.js';
import { rzOrdersSearch, rzItemComments, rzSuccessStatuses, rzOrderChat, rzSendMessage, rzMessageCounts, rzUnreadChats, rzSetOrderStatus, rzGetOrder } from '../../integrations/rozetka.js';
import { promOrders } from '../../integrations/prom.js';
import { epcOrdersPage } from '../../integrations/epicentr.js';
import { mountMarketCrm } from './crm.js';
import { mountMarketTtn } from './ttn.js';
import { mountRzPersonal } from './rzme.js';
import { mountMarketItems } from './items.js';
import { mountMarketRemind, recallSql, RECALL_DAYS } from './remind.js';

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
// Розетка: групи замовлень як у кабінеті продавця. Статус — код Розетки; status_group (з Розетки): 1 — у роботі, 2 — успішні, 3 — неуспішні.
// Неуспішні ділимо на «Неуспішні» (після відправки: не забрав, відмова, повернення) і «Скасовані» (до відправки).
// Для старих рядків без status_group (0) — за кодами.
const RZ_NEW = ['1'];
const RZ_DELIVERY = ['3', '4', '5', '81', '82']; // 81 «Прийнято від продавця» — посилку вже забрали, вона в дорозі
const RZ_TTN = ['61', '80']; // «Створено ТТН»: заплановано передачу перевізникові, очікує отримання від продавця (+ будь-яке «в обробці» з ТТН)
const RZ_FAILED = ['11', '12', '19', '20', '38', '85', '88'];
const RZ_CANCEL = ['17', '18', '28', '29', '31', '33', '35', '37', '39', '40', '41', '42', '44', '45', '49', '50'];
const RZ_CANCEL_CLIENT = ['45']; // «Скасовано покупцем» — сам у кабінеті Розетки
const RZ_CANCEL_AUTO = ['49', '50']; // Розетка сама: повторне замовлення (дубль), не оплатив вчасно
export const RZ_GROUPS = ['new', 'work', 'ttn', 'call', 'dups', 'delivery', 'success', 'failed', 'cancelled'];
const inList = (a) => a.map((x) => `'${x}'`).join(', ');
const groupSql = (successSql) => `(CASE WHEN ${successSql} THEN 'success' WHEN status IN (${inList(RZ_FAILED)}) THEN 'failed'
  WHEN status_group = 3 OR (status_group = 0 AND status IN (${inList(RZ_CANCEL)})) THEN 'cancelled'
  WHEN status IN (${inList(RZ_NEW)}) THEN 'new' WHEN status IN (${inList(RZ_DELIVERY)}) THEN 'delivery'
  WHEN status IN (${inList(RZ_TTN)}) OR ttn != '' THEN 'ttn' ELSE 'work' END)`;
export const rzGroupOf = (status, group, okSet = new Set(), hasTtn = false) => {
  const st = String(status);
  if (Number(group) === 2 || (!Number(group) && okSet.has(st))) return 'success';
  if (RZ_FAILED.includes(st)) return 'failed';
  if (Number(group) === 3 || (!Number(group) && RZ_CANCEL.includes(st))) return 'cancelled';
  if (RZ_NEW.includes(st)) return 'new';
  if (RZ_DELIVERY.includes(st)) return 'delivery';
  if (RZ_TTN.includes(st) || hasTtn) return 'ttn';
  return 'work';
};
export const rzCancelBy = (status) => (RZ_CANCEL_CLIENT.includes(String(status)) ? 'client' : RZ_CANCEL_AUTO.includes(String(status)) ? 'auto' : 'manager');
// «Кілька замовлень»: активні замовлення покупців, у яких зараз більше одного активного замовлення (той самий телефон).
const DUPS_SQL = `(status_group = 1 AND phone != '' AND substr(phone, -9) IN (SELECT substr(phone, -9) FROM mp_orders WHERE mp = 'rozetka' AND status_group = 1 AND phone != '' GROUP BY substr(phone, -9) HAVING COUNT(*) > 1))`;
const DUP_DAYS = 14; // інші замовлення того самого покупця в межах 14 днів — показуємо як можливі дублі
const RECALL_SQL = recallSql(RZ_FAILED); // «Передзвонити» (remind.js)
// Причини скасування, які менеджер може обрати (коди статусів Розетки).
export const RZ_CANCEL_REASONS = { 31: 'Скасування. Створено дублююче замовлення', 50: 'Клієнт не оплатив', 40: 'Клієнт передумав',
  18: 'Не вдалося зв\'язатися', 42: 'Немає в наявності', 28: 'Неправильні контактні дані', 44: 'Скасування. Фейкове замовлення' };
// «Потрібно зателефонувати»: повторний дзвінок; не оплачено понад добу; 4+ дні в пункті видачі; нове понад 30 хв.
const CALL_SQL = `(status = '47' OR (status = '55' AND changed_at <= ?) OR (status = '5' AND changed_at <= ?) OR (status IN (${inList(RZ_NEW)}) AND created_at <= ?))`;
const callParams = (nowMs = Date.now()) => [kyivDTms(nowMs - 86400e3), kyivDTms(nowMs - 4 * 86400e3), kyivDTms(nowMs - 30 * 60e3)];

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
const kyivDTms = (ms) => kyivDT(new Date(ms));
const money = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const fio = (...parts) => parts.map((x) => String(x || '').trim()).filter(Boolean).join(' ');

// Отримувач Розетки (ПІБ приходить рядком або об'єктом).
const rzRecipient = (o) => {
  const t = o.delivery?.recipient_title;
  return String((typeof t === 'string' ? t : t?.full_name) || fio(o.delivery?.recipient_last_name, o.delivery?.recipient_first_name, o.delivery?.recipient_second_name)).trim();
};
const digits9 = (p) => String(p || '').replace(/\D/g, '').slice(-9);
// Отримувач — лише якщо це інша людина (інший телефон або інше ім'я): тоді відгук можуть залишити обидва.
const rzOther = (o) => {
  const name = rzRecipient(o);
  const phone = String(o.delivery?.recipient_phone || o.recipient_phone || '');
  const buyer = String(o.user_title?.full_name || '').trim();
  const samePhone = !phone || !o.user_phone || digits9(phone) === digits9(o.user_phone);
  const sameName = !name || !buyer || name.toLowerCase() === buyer.toLowerCase();
  return samePhone && sameName ? { recipient: '', recipient_phone: '' } : { recipient: name, recipient_phone: phone };
};

// Розетка: адреса доставки одним рядком (місто + відділення/поштомат або вулиця, будинок, квартира).
const rzAddress = (o) => {
  const d = o.delivery || {};
  const city = String(d.city?.title || d.city?.name_ua || d.city?.name || d.city?.city_name || '').trim();
  const place = d.place_number ? `№ ${d.place_number}${d.place_street ? `, ${d.place_street}` : ''}${d.place_house ? ` ${d.place_house}` : ''}`
    : [d.place_street, d.place_house, d.place_flat ? `кв. ${d.place_flat}` : ''].filter(Boolean).join(', ');
  return [city, place].filter(Boolean).join(', ').slice(0, 300);
};
const rzPay = (o) => {
  const p = o.payment || null;
  const st = String(p?.payment_status?.title || '').trim();
  return {
    pay_type: String(p?.payment_type_title || p?.payment_method_name || '').slice(0, 120),
    pay_status: st.slice(0, 80),
    paid: /^оплачен/i.test(st) ? 1 : 0,
    pay_known: o && 'payment' in o ? 1 : 0,
  };
};

// Замовлення маркетплейсу → рядок mp_orders.
const ROW = {
  rozetka: (o) => ({
    id: String(o.id), number: String(o.id), created_at: String(o.created || ''), changed_at: String(o.changed || ''),
    status: String(o.status ?? ''), status_name: String(o.status_data?.name_uk || o.status_data?.name || ''), status_group: Number(o.status_group) || 0,
    customer: o.user_title?.full_name || rzRecipient(o) || '',
    phone: String(o.user_phone || o.delivery?.recipient_phone || ''), total: money(o.cost ?? o.amount),
    delivery: String(o.delivery?.delivery_service_name || o.delivery_service?.name || ''), ttn: String(o.ttn || o.delivery?.ttn || ''),
    items: (o.purchases || []).map((p) => ({ id: String(p.item_id || p.item?.id || ''), name: String(p.item_name || p.item?.name || ''), qty: Number(p.quantity) || 1, price: money(p.price),
      ...(p.item?.article ? { article: String(p.item.article).trim().slice(0, 120) } : {}), ...(p.item?.price_offer_id ? { offer: String(p.item.price_offer_id) } : {}), ...(p.item?.photo_preview ? { photo: String(p.item.photo_preview).slice(0, 300) } : {}) })),
    goods: rzGoods(o),
    ...rzOther(o),
    ...rzPay(o),
    address: rzAddress(o), comment: String(o.comment || '').slice(0, 1000), dup_of: o.duplicate_order_id ? String(o.duplicate_order_id) : '',
  }),
  prom: (o) => ({
    id: String(o.id), number: String(o.id), created_at: kyivDT(o.date_created), changed_at: kyivDT(o.date_modified || o.date_created),
    status: String(o.status || ''), status_name: String(o.status_name || o.status || ''),
    customer: fio(o.client_last_name, o.client_first_name, o.client_second_name), phone: String(o.phone || ''), total: money(o.full_price ?? o.price),
    delivery: String(o.delivery_option?.name || ''), ttn: String(o.delivery_provider_data?.declaration_number || ''),
    items: (o.products || []).map((p) => ({ name: String(p.name || p.name_multilang?.uk || ''), qty: Number(p.quantity) || 1, price: money(p.price) })),
    goods: (o.products || []).map((p) => ({ id: String(p.id || p.external_id || p.sku || ''), name: String(p.name || p.name_multilang?.uk || ''), article: String(p.sku || p.external_id || ''), offer: String(p.id || ''), photo: String(p.image || p.main_image || ''), url: String(p.url || ''), category: '' })),
  }),
  epc: (o) => ({
    id: String(o.id), number: String(o.number || o.id), created_at: kyivDT(o.createdAt), changed_at: kyivDT(o.updatedAt || o.createdAt),
    status: String(o.statusCode || ''), status_name: EPC_STATUS[o.statusCode] || String(o.statusCode || ''),
    customer: fio(o.address?.lastName, o.address?.firstName, o.address?.patronymic), phone: String(o.address?.phone || ''), total: money(o.subtotal),
    delivery: EPC_DELIVERY[o.address?.shipment?.provider] || String(o.address?.shipment?.provider || ''), ttn: String(o.address?.shipment?.number || ''),
    items: (o.items || []).map((p) => ({ name: String(p.title || ''), qty: Number(p.quantity) || 1, price: money(p.price) })),
    goods: (o.items || []).map((p) => ({ id: String(p.id || p.offerId || p.sku || ''), name: String(p.title || ''), article: String(p.sku || p.vendorCode || p.article || ''), offer: String(p.offerId || ''), photo: '', url: '', category: '' })),
  }),
};
// Товар Розетки з замовлення (expand=purchases дає повний об'єкт item): для довідника товарів магазину (mp_items).
const rzGoods = (o) => (o.purchases || []).map((p) => {
  const it = p.item || {};
  return { id: String(p.item_id || it.id || ''), name: String(it.name_ua || it.name || p.item_name || '').slice(0, 300), article: String(it.article || '').trim().slice(0, 120),
    offer: String(it.price_offer_id || it.uploader_offer_id || ''), photo: String(it.photo_preview || it.photo || '').slice(0, 300), url: String(it.url || '').slice(0, 300),
    category: String(typeof it.catalog_category === 'string' ? it.catalog_category : it.catalog_category?.name || it.catalog_category?.title || '').slice(0, 120) };
});

export function mountMarket(app, { db, fetchFn, services = {}, onCron = () => {}, onCleanup = () => {}, shared = {} }) {
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
      `INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, delivery, ttn, items, synced_at, search, status_group, recipient, recipient_phone,
         pay_type, pay_status, paid, pay_known, address, comment, dup_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mp, account_id, id) DO UPDATE SET number = excluded.number, created_at = excluded.created_at, changed_at = excluded.changed_at,
         status = excluded.status, status_name = excluded.status_name, customer = excluded.customer, phone = excluded.phone, total = excluded.total,
         delivery = excluded.delivery, ttn = excluded.ttn, items = excluded.items, synced_at = excluded.synced_at, search = excluded.search,
         status_group = excluded.status_group, recipient = excluded.recipient, recipient_phone = excluded.recipient_phone,
         pay_type = CASE WHEN excluded.pay_known = 1 THEN excluded.pay_type ELSE mp_orders.pay_type END,
         pay_status = CASE WHEN excluded.pay_known = 1 THEN excluded.pay_status ELSE mp_orders.pay_status END,
         paid = CASE WHEN excluded.pay_known = 1 THEN excluded.paid ELSE mp_orders.paid END,
         pay_known = MAX(mp_orders.pay_known, excluded.pay_known),
         address = CASE WHEN excluded.address != '' THEN excluded.address ELSE mp_orders.address END,
         comment = excluded.comment, dup_of = excluded.dup_of
       WHERE mp_orders.changed_at IS NOT excluded.changed_at OR mp_orders.status IS NOT excluded.status OR mp_orders.ttn IS NOT excluded.ttn
         OR mp_orders.total IS NOT excluded.total OR mp_orders.search IS NOT excluded.search OR mp_orders.status_group IS NOT excluded.status_group
         OR mp_orders.recipient IS NOT excluded.recipient OR mp_orders.recipient_phone IS NOT excluded.recipient_phone OR mp_orders.items IS NOT excluded.items
         OR (excluded.pay_known = 1 AND (mp_orders.pay_known = 0 OR mp_orders.pay_status IS NOT excluded.pay_status OR mp_orders.pay_type IS NOT excluded.pay_type))
         OR (excluded.address != '' AND mp_orders.address IS NOT excluded.address) OR mp_orders.comment IS NOT excluded.comment OR mp_orders.dup_of IS NOT excluded.dup_of`,
      [mp, accountId, r.id, r.number, r.created_at, r.changed_at, r.status, r.status_name, r.customer, r.phone, r.total, r.delivery, r.ttn, JSON.stringify(r.items), now, searchOf(r), r.status_group || 0, r.recipient || '', r.recipient_phone || '',
        r.pay_type || '', r.pay_status || '', r.paid || 0, r.pay_known || 0, r.address || '', r.comment || '', r.dup_of || ''],
    ]));
    await saveGoods(mp, accountId, rows);
  }
  // Довідник товарів магазину (mp_items): назва, артикул, offer_id, фото; перший і останній продаж.
  // Незмінені рядки не перезаписуються; прив'язку до LP-CRM (product_id) синхронізація не чіпає.
  async function saveGoods(mp, accountId, rows) {
    const goods = new Map();
    for (const r of rows) {
      const day = String(r.created_at || '').slice(0, 10);
      for (const g of r.goods || []) {
        if (!g.id) continue;
        const cur = goods.get(g.id);
        if (!cur) { goods.set(g.id, { ...g, first: day, last: day }); continue; }
        if (day && (!cur.first || day < cur.first)) cur.first = day;
        if (day > cur.last) cur.last = day;
        for (const k of ['name', 'article', 'offer', 'photo', 'url', 'category']) if (!cur[k] && g[k]) cur[k] = g[k];
      }
    }
    if (!goods.size) return;
    await db.batch([...goods.values()].map((g) => [
      `INSERT INTO mp_items (mp, account_id, item_id, name, article, offer_id, photo, url, category, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mp, account_id, item_id) DO UPDATE SET
         name = CASE WHEN excluded.name != '' THEN excluded.name ELSE mp_items.name END,
         article = CASE WHEN excluded.article != '' THEN excluded.article ELSE mp_items.article END,
         offer_id = CASE WHEN excluded.offer_id != '' THEN excluded.offer_id ELSE mp_items.offer_id END,
         photo = CASE WHEN excluded.photo != '' THEN excluded.photo ELSE mp_items.photo END,
         url = CASE WHEN excluded.url != '' THEN excluded.url ELSE mp_items.url END,
         category = CASE WHEN excluded.category != '' THEN excluded.category ELSE mp_items.category END,
         first_seen = CASE WHEN excluded.first_seen != '' AND (mp_items.first_seen = '' OR excluded.first_seen < mp_items.first_seen) THEN excluded.first_seen ELSE mp_items.first_seen END,
         last_seen = MAX(mp_items.last_seen, excluded.last_seen)
       WHERE (excluded.name != '' AND mp_items.name IS NOT excluded.name) OR (excluded.article != '' AND mp_items.article IS NOT excluded.article)
         OR (excluded.offer_id != '' AND mp_items.offer_id IS NOT excluded.offer_id) OR (excluded.photo != '' AND mp_items.photo IS NOT excluded.photo)
         OR (excluded.url != '' AND mp_items.url IS NOT excluded.url) OR (excluded.category != '' AND mp_items.category IS NOT excluded.category)
         OR excluded.last_seen > mp_items.last_seen OR (excluded.first_seen != '' AND (mp_items.first_seen = '' OR excluded.first_seen < mp_items.first_seen))`,
      [mp, accountId, g.id, g.name || '', g.article || '', g.offer || '', g.photo || '', g.url || '', g.category || '', g.first || '', g.last || ''],
    ]));
  }

  // Разово: історію Розетки перезавантажити з кінця її періоду (v2 — без «Успішних» і «Неуспішних» до types=1;
  // v3 — без отримувача, коду товару й групи статусу, потрібних для відгуків; v4 — без оплати, адреси й коментаря). Незмінені рядки не перезаписуються.
  async function rehistOnce() {
    if ((await db.get(`SELECT value FROM settings WHERE key = 'mp_hist_v4'`))?.value) return;
    await db.batch([
      [`UPDATE mp_sync SET hist_to = CASE WHEN hist_end != '' THEN hist_end ELSE ? END, hist_page = 1, hist_done = 0, hist_saved = 0, hist_error = ''
        WHERE mp = 'rozetka' AND hist_from != ''`, [kyivDT(new Date()).slice(0, 10)]],
      [`INSERT INTO settings (key, value) VALUES ('mp_hist_v4', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`, []],
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

  const recordOf = (c) => {
    let r = c.record;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = null; } }
    return r || {};
  };
  const recordId = (c) => String(recordOf(c).id || c.item?.id || c.record_id || '');
  const recordTitle = (c) => {
    let r = c.record;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = null; } }
    return String(r?.title || c.item?.name_ua || c.item?.name || '');
  };
  // Відгуки сторінки → mp_reviews (лише відгуки до замовлень, без відповідей), потім позначки у замовленнях.
  async function saveReviews(accountId, comments) {
    const rows = comments.filter((c) => !Number(c.parent_id) && Number(c.orders_id) > 0 && (!c.type || c.type === 'comment')).map((c) => ({
      id: String(c.id), order_id: String(c.orders_id), goods: recordTitle(c).slice(0, 300), goods_id: recordId(c), mark: Math.max(0, Math.min(5, Number(c.mark) || 0)),
      name: String(c.name || '').slice(0, 120), text: [c.text, c.dignity && `Переваги: ${c.dignity}`, c.shortcomings && `Недоліки: ${c.shortcomings}`].filter(Boolean).join('\n').slice(0, 600),
      status: String(c.status || ''), created_at: String(c.created || ''), changed_at: String(c.changed || c.created || ''),
    }));
    if (!rows.length) return 0;
    const sub = (what) => `(SELECT ${what} FROM mp_reviews r WHERE r.mp = mp_orders.mp AND r.account_id = mp_orders.account_id AND r.order_id = mp_orders.id)`;
    const n = sub('COUNT(*)');
    const mk = `COALESCE(${sub('MIN(NULLIF(mark, 0))')}, 0)`;
    await db.batch([
      ...rows.map((r) => [
        `INSERT INTO mp_reviews (mp, account_id, id, order_id, goods, mark, name, text, status, created_at, changed_at, goods_id) VALUES ('rozetka', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mp, account_id, id) DO UPDATE SET order_id = excluded.order_id, goods = excluded.goods, goods_id = excluded.goods_id, mark = excluded.mark, name = excluded.name,
           text = excluded.text, status = excluded.status, created_at = excluded.created_at, changed_at = excluded.changed_at
         WHERE mp_reviews.changed_at IS NOT excluded.changed_at OR mp_reviews.status IS NOT excluded.status OR mp_reviews.mark IS NOT excluded.mark
           OR mp_reviews.order_id IS NOT excluded.order_id OR mp_reviews.goods_id IS NOT excluded.goods_id`,
        [accountId, r.id, r.order_id, r.goods, r.mark, r.name, r.text, r.status, r.created_at, r.changed_at, r.goods_id],
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
  // shared.clock — лише для тестів (робочий час).
  onCron('market-msgs', 'Повідомлення покупців Розетки → Telegram менеджерам (Пн–Пт 9–18, Сб 10–17)', () => rzMsgNotify({ now: shared.clock ? shared.clock() : Date.now() }));

  // ---------- нові повідомлення покупців Розетки → Telegram менеджерам магазину ----------
  // Кому: менеджери (і «перегляд») з увімкненим у «Користувачах» сповіщенням розділу «Маркетплейси» (tg: 'market'),
  // яким доступний цей магазин; нікого — нікому. Лише в робочий час (за Києвом): Пн–Пт 9:00–18:00, Сб 10:00–17:00,
  // у неділю — ні; що прийшло поза ним, надсилається на початку робочого часу (якщо ще не прочитано).
  // Запити: лічильник непрочитаного (1 на магазин), і лише коли є непрочитане — список таких чатів. Прочитаними не позначаємо.
  // Одне повідомлення — одне сповіщення (rzmsg_seen: останнє сповіщене повідомлення кожного непрочитаного чату).
  const RZ_CABINET = 'https://seller.rozetka.com.ua/main/messages';
  const MSG_FRESH_DAYS = 7; // давніші непрочитані чати не надсилаємо
  const MSG_SEND_MAX = 15; // повідомлень у Telegram за один запуск
  function workTime(ms = Date.now()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const m = Number(p.hour) * 60 + Number(p.minute);
    if (p.weekday === 'Sun') return false;
    if (p.weekday === 'Sat') return m >= 10 * 60 && m < 17 * 60;
    return m >= 9 * 60 && m < 18 * 60;
  }
  async function rzMsgNotify({ now = Date.now() } = {}) {
    if (!workTime(now)) return { skipped: 'неробочий час' };
    if (!services.notify?.sendText) return { skipped: 'Telegram не підключено' };
    const shops = ((await shopsOf()).rozetka || []).filter((a) => a.active);
    if (!shops.length) return { skipped: 'магазини Розетки не підключено' };
    const users = (await db.all(`SELECT * FROM users WHERE active = 1 AND tg_chat_id != '' AND role IN ('manager', 'viewer')`))
      .filter((u) => accessOf(u)?.tg.includes('market'));
    const seen = await getSetting('rzmsg_seen', {});
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const hm = (v) => String(v || '').slice(11, 16);
    const fresh = kyivDT(now - MSG_FRESH_DAYS * 86400e3);
    const out = { shops: 0, chats: 0, sent: 0, errors: 0 };
    for (const acc of shops) {
      const to = users.filter((u) => shopAllowed(u, 'rozetka', acc.id)).map((u) => u.tg_chat_id);
      if (!to.length) { delete seen[acc.id]; continue; } // нікому не надсилаємо — і не питаємо Розетку
      try {
        const cnt = await rzCall(acc, (t) => rzMessageCounts(fetchFn, t));
        out.shops++;
        const types = [['orders', Number(cnt.ordersChatUnread) || 0], ['items', Number(cnt.itemsChatUnread) || 0]].filter(([, n]) => n > 0);
        const prev = seen[acc.id] || {};
        const next = {};
        const items = [];
        for (const [type] of types) {
          for (let page = 1, pages = 1; page <= pages && page <= 3; page++) {
            const r = await rzCall(acc, (t) => rzUnreadChats(fetchFn, t, type, page));
            pages = r.pageCount;
            for (const ch of r.chats) {
              const msgs = (Array.isArray(ch.messages) ? ch.messages : []).filter((m) => Number(m.sender) !== 2);
              const unread = msgs.slice(-Math.max(1, Number(ch.unread_messages_count) || 1));
              const last = Math.max(0, ...unread.map((m) => Number(m.id) || 0));
              next[ch.id] = Math.max(last, prev[ch.id] || 0);
              const neu = unread.filter((m) => (Number(m.id) || 0) > (prev[ch.id] || 0));
              if (!neu.length || String(ch.updated || '') < fresh) continue;
              items.push({ type, ch, neu });
            }
          }
        }
        if (!items.length) { seen[acc.id] = next; continue; }
        out.chats += items.length;
        const head = `💬 <b>Розетка${acc.name ? ` · ${esc(acc.name)}` : ''}</b>`;
        const link = (it) => (it.type === 'orders' && it.ch.order_id
          ? `${RZ_CABINET}/orders?msgType=orders&search=${encodeURIComponent(it.ch.order_id)}`
          : it.ch.item_id || it.ch.item?.id ? `${RZ_CABINET}/items?msgType=items&search=${encodeURIComponent(it.ch.item_id || it.ch.item.id)}` // пошук за кодом товару
            : `${RZ_CABINET}/items?msgType=items`);
        const what = (it) => (it.type === 'orders' ? `Замовлення №${esc(it.ch.order_id || '')}`
          : it.ch.item?.name ? `Питання про товар: ${esc(String(it.ch.item.name).slice(0, 90))}` : 'Питання від покупця');
        const texts = items.length > 3
          ? [`${head} · нові повідомлення: ${items.length}\n${items.slice(0, 25).map((it) => `• ${what(it)} · ${esc(it.ch.user_fio || '')} · ${hm(it.neu[it.neu.length - 1].created)}`).join('\n')}${items.length > 25 ? `\n…і ще ${items.length - 25}` : ''}\n\n<a href="${RZ_CABINET}/orders">Відкрити повідомлення в кабінеті Розетки</a>`]
          : items.map((it) => `${head} · нове повідомлення\n<b>${what(it)}</b> · чат ${esc(it.ch.id)}\nВід: ${esc(it.ch.user_fio || '—')}\n`
            + it.neu.slice(-3).map((m) => `«${esc(String(m.body || (m.files?.length ? '[файл]' : '')).slice(0, 300))}» <i>${hm(m.created)}</i>`).join('\n')
            + `\n<a href="${link(it)}">Відкрити в кабінеті Розетки</a>`);
        // Ліміт звернень Cloudflare на один запуск: не вміщається — надішлемо наступного разу (через 3 хв), не позначаючи сповіщеним.
        if (out.sent + texts.length * to.length > MSG_SEND_MAX) break;
        for (const t of texts) out.sent += (await services.notify.sendText({ chatIds: to }, t).catch(() => 0)) || 0;
        seen[acc.id] = next;
      } catch (e) {
        if (e.pending) break;
        out.errors++;
      }
    }
    await putSetting('rzmsg_seen', seen);
    return out;
  }

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

  // Магазини, доступні користувачу (менеджеру можна дати лише частину — «Користувачі» → доступ).
  const myShop = (c, mp, id) => { if (!shopAllowed(c.get('user'), mp, id)) throw fail(403, 'Немає доступу до цього магазину.'); };
  app.get('/api/mp/shops', async (c) => {
    need(c, 'market.view');
    await rehistOnce();
    const u = c.get('user');
    const [shops, counts, syncs] = await Promise.all([shopsOf(), cachedCounts(), db.all(`SELECT * FROM mp_sync`)]);
    const cnt = new Map(counts.map((r) => [`${r.mp}:${r.account_id}`, r.n]));
    const sy = new Map(syncs.map((r) => [`${r.mp}:${r.account_id}`, r]));
    return c.json(MARKETS.map((m) => ({
      ...m,
      shops: (shops[m.key] || []).filter((a) => shopAllowed(u, m.key, a.id)).map((a) => {
        const s = sy.get(`${m.key}:${a.id}`);
        return { id: a.id, name: a.name, active: Boolean(a.active), orders: cnt.get(`${m.key}:${a.id}`) || 0, synced_at: s?.synced_at || '', loading: Boolean(s?.cursor), error: s?.error || '', error_at: s?.error_at || '',
          history: m.key === 'rozetka' ? histState(s) : null,
          reviews: m.key === 'rozetka' ? { full: Boolean(s?.rv_full), n: s?.rv_n || 0, at: s?.rv_at || '', loading: Boolean(s?.rv_page), error: s?.rv_error || '' } : null };
      }),
    })));
  });

  app.get('/api/mp/orders', async (c) => {
    need(c, 'market.view');
    const mp = c.req.query('mp');
    if (!MARKETS.some((m) => m.key === mp)) throw fail(400, 'Невідомий маркетплейс.');
    const where = ['mp = ?'];
    const params = [mp];
    const acc = Number(c.req.query('account')) || 0;
    if (acc) { myShop(c, mp, acc); where.push('account_id = ?'); params.push(acc); }
    else {
      const a = accessOf(c.get('user'));
      if (a?.shops) { where.push('account_id IN (SELECT value FROM json_each(?))'); params.push(JSON.stringify(a.shops.filter((x) => x.startsWith(`${mp}:`)).map((x) => Number(x.split(':')[1])))); }
    }
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
    // групи Розетки (Нові, В обробці, Потрібно зателефонувати…) і хто скасував
    const grp = rz && RZ_GROUPS.includes(c.req.query('grp')) ? c.req.query('grp') : '';
    if (grp === 'call') { where.push(CALL_SQL); params.push(...callParams()); }
    else if (grp === 'dups') where.push(DUPS_SQL);
    else if (grp) { where.push(`${groupSql(SUCCESS_SQL)} = ?`); params.push(okIds, grp); }
    // «Передзвонити»: скасовані за останні дні, кому ще не дзвонили і хто не замовив знову (remind.js)
    const recallSince = kyivDT(Date.now() - RECALL_DAYS * 86400e3);
    if (rz && c.req.query('grp') === 'recall') { where.push(RECALL_SQL); params.push(recallSince); }
    // LP-CRM: no — ще не внесені/не прив'язані, yes — прив'язані
    const crmF = rz ? String(c.req.query('crm') || '') : '';
    if (crmF === 'no') where.push(`crm_id = '' AND crm_code = ''`);
    if (crmF === 'yes') where.push(`(crm_id != '' OR crm_code != '')`);
    const cancel = grp === 'cancelled' ? String(c.req.query('cancel') || '') : '';
    if (cancel === 'client') where.push(`status IN (${inList(RZ_CANCEL_CLIENT)})`);
    if (cancel === 'auto') where.push(`status IN (${inList(RZ_CANCEL_AUTO)})`);
    if (cancel === 'manager') where.push(`status NOT IN (${inList([...RZ_CANCEL_CLIENT, ...RZ_CANCEL_AUTO])})`);
    const q = String(c.req.query('q') || '').trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      // search — малими літерами (кирилиця без урахування регістру); старі рядки без search — за колонками
      where.push(`(search LIKE ? OR number LIKE ? OR customer LIKE ? OR ttn LIKE ?${digits.length >= 5 ? ' OR phone LIKE ? OR search LIKE ?' : ''})`);
      params.push(`%${q.toLowerCase()}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...(digits.length >= 5 ? [`%${digits.slice(-9)}%`, `%${digits.slice(-9)}%`] : []));
    }
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    let callN = 0;
    let dupsN = 0;
    let recallN = 0;
    const [rows, statusRows, total, rvStats, rvBy] = await Promise.all([
      db.all(`SELECT *, ${rz ? SUCCESS_SQL : '0'} AS ok FROM mp_orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 301 OFFSET ?`, [...(rz ? [okIds] : []), ...params, offset]),
      db.all(`SELECT status, status_group, ttn != '' AS has_ttn, MAX(status_name) AS status_name, COUNT(*) AS n FROM mp_orders WHERE ${base.join(' AND ')} GROUP BY status, status_group, ttn != '' ORDER BY n DESC`, baseParams),
      db.get(`SELECT COUNT(*) AS n, SUM(total) AS sum FROM mp_orders WHERE ${where.join(' AND ')}`, params),
      // відгуки за період і магазин (без фільтрів статусу й пошуку): виконані, з відгуком, кому вже можна нагадати, кому нагадали
      rz ? db.get(`SELECT SUM(ok) AS done, SUM(ok AND review_n > 0) AS reviewed, SUM(ok AND review_n = 0 AND asked_at = '' AND changed_at <= ?) AS toask,
          SUM(asked_at != '') AS asked, SUM(asked_at != '' AND review_n > 0) AS asked_reviewed
        FROM (SELECT ${SUCCESS_SQL} AS ok, review_n, asked_at, changed_at FROM mp_orders WHERE ${base.join(' AND ')})`, [border, okIds, ...baseParams]) : null,
      rz ? db.all(`SELECT asked_by AS who, COUNT(*) AS n, SUM(review_n > 0) AS reviewed FROM mp_orders WHERE ${base.join(' AND ')} AND asked_at != '' GROUP BY asked_by ORDER BY n DESC`, baseParams) : [],
      rz ? db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE ${base.join(' AND ')} AND ${CALL_SQL}`, [...baseParams, ...callParams()]) : null,
      rz ? db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE ${base.join(' AND ')} AND ${DUPS_SQL}`, baseParams) : null,
      rz ? db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE ${base.join(' AND ')} AND ${RECALL_SQL}`, [...baseParams, recallSince]) : null,
    ]).then((x) => { callN = x[5]?.n || 0; dupsN = x[6]?.n || 0; recallN = x[7]?.n || 0; return x; });
    // статуси (для фільтра) — по коду; групи й «хто скасував» — з кодів і status_group
    const okSet = new Set(JSON.parse(okIds));
    const groups = Object.fromEntries(RZ_GROUPS.map((g) => [g, 0]));
    const cancels = { client: 0, manager: 0, auto: 0 };
    const stMap = new Map();
    for (const x of statusRows) {
      const g = rz ? rzGroupOf(x.status, x.status_group, okSet, Boolean(x.has_ttn)) : '';
      if (rz) { groups[g] += x.n; if (g === 'cancelled') cancels[rzCancelBy(x.status)] += x.n; }
      // фільтр статусів — окремо в кожній групі (той самий статус може бути і «в обробці», і «створено ТТН»)
      const k = `${x.status}|${g}`;
      const cur = stMap.get(k);
      if (!cur) stMap.set(k, { status: x.status, status_name: x.status_name, n: x.n, grp: g });
      else cur.n += x.n;
    }
    const statuses = [...stMap.values()].sort((a, b) => b.n - a.n);
    if (rz) { groups.call = callN; groups.dups = dupsN; }
    // відгуки замовлень на екрані — щоб показати, на які саме товари і хто вже залишив
    const shown = rows.slice(0, 300);
    const revs = rz && shown.some((r) => r.review_n > 0) ? await db.all(
      `SELECT account_id, order_id, goods_id, goods, mark, name, created_at FROM mp_reviews WHERE mp = 'rozetka' AND order_id IN (SELECT value FROM json_each(?)) ORDER BY created_at`,
      [JSON.stringify(shown.filter((r) => r.review_n > 0).map((r) => r.id))]) : [];
    // інші замовлення тих самих покупців (не скасовані, ±14 днів) — можливі дублі; лише для замовлень за останні 60 днів
    const dupsOf = new Map();
    if (rz && shown.length) {
      const recent = kyivDT(Date.now() - 60 * 86400e3);
      const want = shown.filter((r) => r.created_at >= recent && String(r.phone || '').replace(/\D/g, '').length >= 9);
      const p9s = [...new Set(want.map((r) => String(r.phone).slice(-9)))];
      if (p9s.length) {
        const a = accessOf(c.get('user'));
        const accs = a?.shops ? a.shops.filter((x) => x.startsWith('rozetka:')).map((x) => Number(x.split(':')[1])) : null;
        const others = await db.all(`SELECT account_id, id, number, created_at, status, status_name, status_group, total, pay_type, pay_status, paid, substr(phone, -9) AS p9
          FROM mp_orders WHERE mp = 'rozetka' AND substr(phone, -9) IN (SELECT value FROM json_each(?)) AND status_group != 3
          ${accs ? 'AND account_id IN (SELECT value FROM json_each(?))' : ''} ORDER BY created_at DESC LIMIT 2000`, accs ? [JSON.stringify(p9s), JSON.stringify(accs)] : [JSON.stringify(p9s)]);
        const day = (x) => Date.parse(`${String(x).slice(0, 10)}T00:00:00Z`);
        for (const r of want) {
          const p9 = String(r.phone).slice(-9);
          const list = others.filter((x) => x.p9 === p9 && !(x.account_id === r.account_id && x.id === r.id) && Math.abs(day(x.created_at) - day(r.created_at)) <= DUP_DAYS * 864e5)
            .map(({ p9: _p, ...x }) => ({ ...x, grp: rzGroupOf(x.status, x.status_group, okSet) }));
          if (list.length) dupsOf.set(`${r.account_id}:${r.id}`, list);
        }
      }
    }
    // дзвінки Binotel (якщо підключено): чи дзвонив покупець до замовлення, чи дзвонив менеджер після
    const tel = rz && shown.length ? await services.telephony?.marks(shown.map((r) => ({ key: `${r.account_id}:${r.id}`, phones: [r.phone, r.recipient_phone], at: r.created_at }))) : null;
    return c.json({
      rows: shown.map((r) => ({
        ...r,
        ...(tel ? { calls: tel.get(`${r.account_id}:${r.id}`) || null } : {}),
        ...(rz ? { dups: dupsOf.get(`${r.account_id}:${r.id}`) || [] } : {}),
        items: (() => { try { return JSON.parse(r.items || '[]'); } catch { return []; } })(),
        ...(rz ? { reviews: revs.filter((v) => v.account_id === r.account_id && v.order_id === r.id).map(({ account_id: _a, order_id: _o, ...v }) => v) } : {}),
      })),
      more: rows.length > 300,
      total: { n: total?.n || 0, sum: Math.round((total?.sum || 0) * 100) / 100 },
      statuses,
      ...(rz ? { groups, cancels, recall: recallN } : {}),
      ...(rz ? { reviews: { days: rvs.days, stats: Object.fromEntries(Object.entries(rvStats || {}).map(([k, v]) => [k, v || 0])), by: rvBy } } : {}),
    });
  });

  // ---------- відгуки: налаштування, позначка «нагадав», повідомлення в чат Розетки ----------
  app.get('/api/mp/review/settings', async (c) => {
    need(c, 'market.view');
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
  const rzOrderOf = async (b, c) => {
    if (c) myShop(c, 'rozetka', Number(b.account) || 0);
    const o = await db.get(`SELECT * FROM mp_orders WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [Number(b.account) || 0, String(b.id || '')]);
    if (!o) throw fail(404, 'Замовлення не знайдено.');
    return o;
  };
  const items = mountMarketItems({ db, services, onCron });
  mountMarketCrm(app, { db, fetchFn, services, onCron, rzOrderOf, items, shopsOf });
  mountMarketRemind(app, { db, services, onCron, shopsOf, kyivDT, failed: RZ_FAILED, rzOrderOf, shared, clock: shared.clock });
  const markAsked = async (o, user, via) => {
    const at = nowIso();
    const by = String(user?.name || user?.login || '').slice(0, 80);
    await db.run(`UPDATE mp_orders SET asked_at = ?, asked_by = ?, asked_via = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [at, by, via, o.account_id, o.id]);
    return { asked_at: at, asked_by: by, asked_via: via };
  };
  // Менеджер нагадав (Viber, Telegram, дзвінок, скопіював текст, вручну) або скасував позначку (undo).
  app.post('/api/mp/review/ask', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    const o = await rzOrderOf(b, c);
    if (b.undo) {
      await db.run(`UPDATE mp_orders SET asked_at = '', asked_by = '', asked_via = '' WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [o.account_id, o.id]);
      return c.json({ asked_at: '', asked_by: '', asked_via: '' });
    }
    if (!RV_VIA[b.via] || b.via === 'chat') throw fail(400, 'Невідомий спосіб.');
    return c.json(await markAsked(o, c.get('user'), b.via));
  });
  // Повідомлення покупцю в чат замовлення на Розетці (без посилань і контактів — інакше модерація заблокує).
  app.post('/api/mp/review/chat', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    const text = String(b.text || '').trim();
    if (!text || text.length > 1000) throw fail(400, 'Напишіть повідомлення (до 1000 символів).');
    if (CHAT_FORBIDDEN.test(text)) throw fail(400, 'У чаті Розетки не можна надсилати посилання, телефони й інші контакти — приберіть їх з тексту.');
    const o = await rzOrderOf(b, c);
    const acc = await accOf('rozetka', o.account_id);
    const chat = await rzCall(acc, (t) => rzOrderChat(fetchFn, t, o.id)).catch((e) => { if (e.pending) throw e; return null; });
    if (!chat?.id || !chat.userId) throw fail(400, 'Розетка не дала чат цього замовлення — напишіть покупцю у Viber або Telegram.');
    await rzAct(c, acc, (t) => rzSendMessage(fetchFn, t, { chatId: chat.id, receiverId: chat.userId, body: text }));
    return c.json(await markAsked(o, c.get('user'), 'chat'));
  });

  // Діагностика (адміністратор): «сире» замовлення з кабінету Розетки — подивитись, які поля віддає API (оплата тощо).
  app.get('/api/mp/rz/raw/:account/:id', async (c) => {
    need(c, 'api');
    const acc = await accOf('rozetka', c.req.param('account'));
    const expand = String(c.req.query('expand') || 'delivery,status_data,purchases,payment').replace(/[^a-z_,]/gi, '').slice(0, 200);
    const id = String(c.req.param('id')).replace(/\D/g, '').slice(0, 20);
    const raw = await rzCall(acc, (t) => rzGetOrder(fetchFn, t, id, expand));
    return c.json(raw);
  });

  // Скасувати замовлення в Розетці з причиною (дубль, не оплатив, передумав…). Лише активні (група «у роботі»).
  app.post('/api/mp/rz/cancel', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    const reason = RZ_CANCEL_REASONS[Number(b.status)];
    if (!reason) throw fail(400, 'Оберіть причину скасування.');
    const o = await rzOrderOf(b, c);
    // зі сторінки замовлення одного магазину не можна змінювати замовлення іншого (дублі між магазинами — лише перегляд)
    if (b.in_account != null && Number(b.in_account) !== Number(o.account_id)) throw fail(400, 'Це замовлення іншого магазину — змінювати його можна лише в тому магазині.');
    if (Number(o.status_group) !== 1) throw fail(400, `Замовлення вже «${o.status_name || o.status}» — скасувати не можна.`);
    const acc = await accOf('rozetka', o.account_id);
    await rzAct(c, acc, (t) => rzSetOrderStatus(fetchFn, t, o.id, b.status));
    await db.run(`UPDATE mp_orders SET status = ?, status_name = ?, status_group = 3, changed_at = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`,
      [String(Number(b.status)), reason, kyivDT(new Date()), o.account_id, o.id]);
    return c.json({ ok: true, status: String(Number(b.status)), status_name: reason });
  });

  // Оплата для активних замовлень, збережених до того, як ми почали її забирати: по 15 за запуск (окремий запит на замовлення).
  async function payBackfill() {
    const rows = await db.all(`SELECT account_id, id FROM mp_orders WHERE mp = 'rozetka' AND status_group = 1 AND pay_known = 0 ORDER BY created_at DESC LIMIT 15`);
    if (!rows.length) return { done: true };
    const shops = (await shopsOf()).rozetka || [];
    let saved = 0;
    for (const r of rows) {
      const acc = shops.find((a) => a.id === r.account_id);
      if (!acc?.active) { await db.run(`UPDATE mp_orders SET pay_known = 1 WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [r.account_id, r.id]); continue; }
      try {
        const raw = await rzCall(acc, (t) => rzGetOrder(fetchFn, t, r.id, 'delivery,status_data,purchases,payment'));
        const row = ROW.rozetka(raw);
        row.pay_known = 1;
        await saveRows('rozetka', acc.id, [row]);
        saved++;
      } catch (e) {
        if (e.pending) break;
        // замовлення не знайдено — більше не питаємо
        if (/не знайдено/.test(String(e.message))) await db.run(`UPDATE mp_orders SET pay_known = 1 WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [r.account_id, r.id]);
      }
    }
    return { saved, left: rows.length - saved };
  }
  onCron('market-pay', 'Оплата активних замовлень Розетки (дозавантаження, по 15 за раз)', payBackfill);

  // Групова зміна статусу в Розетці: з «Нових» — в «Обробляється менеджером». До 10 замовлень за запит
  // (браузер шле частинами: ліміт зовнішніх запитів Cloudflare). Успішно змінені — одразу оновлюються в базі.
  const BULK_TO = { 26: { name: 'Обробляється менеджером', from: RZ_NEW } };
  app.post('/api/mp/rz/status', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    const to = BULK_TO[Number(b.status)];
    if (!to) throw fail(400, 'Цей статус не можна ставити групою.');
    const list = Array.isArray(b.orders) ? b.orders.slice(0, 10) : [];
    if (!list.length) throw fail(400, 'Оберіть замовлення.');
    const done = [];
    const failed = [];
    for (const x of list) {
      const key = `${Number(x.account) || 0}:${String(x.id || '')}`;
      try {
        const o = await rzOrderOf(x, c);
        if (!to.from.includes(String(o.status))) { failed.push({ key, error: `уже «${o.status_name || o.status}»` }); continue; }
        const acc = await accOf('rozetka', o.account_id);
        await rzAct(c, acc, (t) => rzSetOrderStatus(fetchFn, t, o.id, b.status));
        await db.run(`UPDATE mp_orders SET status = ?, status_name = ?, status_group = 1, changed_at = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`,
          [String(b.status), to.name, kyivDT(new Date()), o.account_id, o.id]);
        done.push(key);
      } catch (e) {
        if (e.pending) { failed.push({ key, error: 'не встигли — спробуйте ще раз', retry: true }); break; }
        failed.push({ key, error: String(e.message || e).slice(0, 200) });
      }
    }
    return c.json({ done, failed });
  });

  // Оновити магазин зараз (кнопка на сторінці).
  app.post('/api/mp/sync', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    myShop(c, b.mp, Number(b.account));
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
  // «Створити ТТН» (ROZETKA Delivery, Нова пошта, Meest) із картки замовлення — ttn.js.
  // дії від імені менеджера (його вхід у Розетку), якщо підключено; маршрути вище звертаються до rzAct лише під час запиту
  const { rzAct } = mountRzPersonal(app, { db, fetchFn, rzCall, accOf });
  mountMarketTtn(app, { db, fetchFn, rzCall, rzAct, accOf, rzOrderOf });
  app.post('/api/mp/history/start', async (c) => {
    need(c, 'api');
    const b = await c.req.json().catch(() => ({}));
    return c.json(await histStart(b.mp, await accOf(b.mp, b.account), { from: b.from, to: b.to }));
  });
  app.post('/api/mp/history/step', async (c) => {
    need(c, 'market.view');
    const b = await c.req.json().catch(() => ({}));
    myShop(c, b.mp, Number(b.account));
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
