// Модуль «Маркетплейси»: замовлення магазинів Розетки (кабінет продавця), Prom і Епіцентру — для перегляду в одному місці.
// Магазини й доступи — у модулі «Маркування» (Налаштування → Доставка), звідси — через services.marking.
// Замовлення зберігаються в базі (45 днів): фонова задача раз на кілька хвилин забирає змінені з часу останньої
// синхронізації — по кілька сторінок за раз; незавершений прохід продовжується з наступної сторінки.
import { fail, need, nowIso } from '../../core/common.js';
import { rzOrdersSearch } from '../../integrations/rozetka.js';
import { promOrders } from '../../integrations/prom.js';
import { epcOrdersPage } from '../../integrations/epicentr.js';

const KEEP_DAYS = 45;
const FIRST_DAYS = 30; // перша синхронізація магазину — замовлення, змінені за 30 днів
const PAGES_PER_RUN = 3;
const OVERLAP_MS = 10 * 60e3; // беремо зміни із запасом, щоб нічого не пропустити на межі

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
    status: String(o.status ?? ''), status_name: String(o.status_data?.name_uk || o.status_data?.name || ''),
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
  onCleanup(async () => {
    const border = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
    await db.run(`DELETE FROM mp_orders WHERE created_at != '' AND created_at < ?`, [border]);
  });

  const shopsOf = async () => (await services.marking?.marketShops?.()) || {};

  async function saveRows(mp, accountId, rows) {
    if (!rows.length) return;
    const now = nowIso();
    await db.batch(rows.map((r) => [
      `INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, delivery, ttn, items, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mp, account_id, id) DO UPDATE SET number = excluded.number, created_at = excluded.created_at, changed_at = excluded.changed_at,
         status = excluded.status, status_name = excluded.status_name, customer = excluded.customer, phone = excluded.phone, total = excluded.total,
         delivery = excluded.delivery, ttn = excluded.ttn, items = excluded.items, synced_at = excluded.synced_at`,
      [mp, accountId, r.id, r.number, r.created_at, r.changed_at, r.status, r.status_name, r.customer, r.phone, r.total, r.delivery, r.ttn, JSON.stringify(r.items), now],
    ]));
  }

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
    const opts = { changedFrom: kyivDT(from), page };
    let r;
    try {
      r = await rzOrdersSearch(fetchFn, await services.marking.rozetkaToken(acc), opts);
    } catch (e) {
      if (!e.rzAuth) throw e;
      r = await rzOrdersSearch(fetchFn, await services.marking.rozetkaToken(acc, true), opts); // токен прострочено — вхід заново
    }
    return { rows: r.orders.map(ROW.rozetka), next: page < r.pageCount ? String(page + 1) : '' };
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

  // ---------- для сторінки «Маркетплейси» ----------
  app.get('/api/mp/shops', async (c) => {
    need(c, 'docs.view');
    const [shops, counts, syncs] = await Promise.all([
      shopsOf(),
      db.all(`SELECT mp, account_id, COUNT(*) AS n FROM mp_orders GROUP BY mp, account_id`),
      db.all(`SELECT * FROM mp_sync`),
    ]);
    const cnt = new Map(counts.map((r) => [`${r.mp}:${r.account_id}`, r.n]));
    const sy = new Map(syncs.map((r) => [`${r.mp}:${r.account_id}`, r]));
    return c.json(MARKETS.map((m) => ({
      ...m,
      shops: (shops[m.key] || []).map((a) => {
        const s = sy.get(`${m.key}:${a.id}`);
        return { id: a.id, name: a.name, active: Boolean(a.active), orders: cnt.get(`${m.key}:${a.id}`) || 0, synced_at: s?.synced_at || '', loading: Boolean(s?.cursor), error: s?.error || '', error_at: s?.error_at || '' };
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
    const base = [...where];
    const baseParams = [...params];
    const status = c.req.query('status') || '';
    if (status) { where.push('status = ?'); params.push(status); }
    const q = String(c.req.query('q') || '').trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      where.push(`(number LIKE ? OR customer LIKE ? OR ttn LIKE ?${digits.length >= 5 ? ' OR phone LIKE ?' : ''})`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, ...(digits.length >= 5 ? [`%${digits.slice(-9)}%`] : []));
    }
    const [rows, statuses] = await Promise.all([
      db.all(`SELECT * FROM mp_orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 300`, params),
      db.all(`SELECT status, MAX(status_name) AS status_name, COUNT(*) AS n FROM mp_orders WHERE ${base.join(' AND ')} GROUP BY status ORDER BY n DESC`, baseParams),
    ]);
    return c.json({
      rows: rows.map((r) => ({ ...r, items: (() => { try { return JSON.parse(r.items || '[]'); } catch { return []; } })() })),
      statuses,
    });
  });

  // Оновити магазин зараз (кнопка на сторінці).
  app.post('/api/mp/sync', async (c) => {
    need(c, 'docs.view');
    const b = await c.req.json().catch(() => ({}));
    const acc = ((await shopsOf())[b.mp] || []).find((a) => a.id === Number(b.account));
    if (!acc) throw fail(404, 'Магазин не знайдено.');
    return c.json(await syncShop(b.mp, acc));
  });

  // Перейменувати магазин (як у налаштуваннях доставки) — адміни.
  app.put('/api/mp/shops/:mp/:id', async (c) => {
    need(c, 'api');
    const b = await c.req.json().catch(() => ({}));
    return c.json(await services.marking.renameShop(c.req.param('mp'), Number(c.req.param('id')), b.name, c.get('user')));
  });

  return { syncAll };
}
