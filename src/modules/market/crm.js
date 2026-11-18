// Маркетплейси → Розетка ↔ LP-CRM (як у «Ритейлі»):
// • прив'язка до замовлення LP-CRM — сама за ТТН (однозначний збіг) і пропозиції за телефоном, або вручну за номером;
// • «Створити в LP-CRM» — для замовлень у статусі Розетки «Обробляється менеджером» (26): нове замовлення в LP-CRM
//   (статус «Нові») з покупцем, телефоном, товарами й цінами Розетки, доставкою та оплатою в коментарі;
// • статус замовлення в LP-CRM для прив'язаних (фоном, раз на 10 хв).
// Товар Розетки → товар LP-CRM: довідник mp_items і правила прив'язки — в items.js (лише однозначний збіг, інакше порожньо).
import { fail, need, nowIso, loadSettings } from '../../core/common.js';
import { shopAllowed } from '../../core/auth.js';
import { addNewOrder, getOrdersBatch, getStatuses } from '../../integrations/lpcrm.js';
import { ttnOf } from '../analytics/index.js';

const newCode = () => `${Math.round(Date.now() / 100)}${String(Math.floor(10000 + Math.random() * 90000))}`;
const normTtn = (v) => String(v ?? '').replace(/\s/g, '').toUpperCase();
const phone9 = (v) => String(v ?? '').replace(/\D/g, '').slice(-9);
const J = (a) => JSON.stringify(a);
const CHECK_MS = 10 * 60e3;
export const CRM_FROM_STATUS = '26'; // «Обробляється менеджером»
export const MP_OFFICE = '5'; // відділ LP-CRM «Маркетплейси» — для всіх замовлень з вкладки «Маркетплейси»
// Вид оплати LP-CRM: 14 — RozetkaPay (оплата на Розетці будь-яким способом), 15 — післяплата RozetkaPay (оплата при отриманні),
// 16 — післяплата NovaPay (Нова пошта, оплата при отриманні), 18 — післяплата Meest (Meest, оплата при отриманні).
const COD_RE = /отриман|післяплат|наложен|готівк|cash/i;
const fmtAt = (s) => { const v = String(s || ''); return v.length >= 16 ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)} ${v.slice(11, 19)}` : v; };
const money = (n) => `${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('uk-UA').replace(/ /g, ' ')} грн`;
const PAY_NAMES = { 14: 'RozetkaPay', 15: 'Післяплата RozetkaPay', 16: 'Післяплата NovaPay', 18: 'Післяплата Meest' };
export function crmPayment(o) {
  const type = String(o.pay_type || '').trim();
  const cod = !o.paid && COD_RE.test(type);
  const deliv = String(o.delivery || '');
  if (cod) {
    const [payment, via] = /нова\s*пошт|nova\s*po/i.test(deliv) ? ['16', 'NovaPay (Нова пошта)'] : /meest|міст/i.test(deliv) ? ['18', 'Meest'] : ['15', 'RozetkaPay'];
    return { payment, cod: true, text: `Післяплата (наложка) ${money(o.total)} — оплата при отриманні, ${via}. Спосіб на Розетці: ${type || '—'}${o.pay_status ? `, ${o.pay_status}` : ''}` };
  }
  return { payment: '14', cod: false, text: `${o.paid ? 'Оплачено одразу на Розетці' : 'Оплата на Розетці, ще не оплачено'} (RozetkaPay): ${type || 'спосіб не вказано'}, ${money(o.total)}${o.pay_status && !o.paid ? ` — ${o.pay_status}` : ''}` };
}

// Коментар до замовлення LP-CRM: номер і магазин, дата й точний час, повна інформація про оплату, доставка, отримувач, коментар покупця.
export function crmComment(o, shop = '') {
  return [`Rozetka ${o.number}${shop ? ` · ${shop}` : ''}`, `Замовлення від ${fmtAt(o.created_at)}`, `Оплата: ${crmPayment(o).text}`,
    o.delivery ? `Доставка: ${o.delivery}` : '', o.recipient && o.recipient !== o.customer ? `Отримувач: ${o.recipient}${o.recipient_phone ? ` ${o.recipient_phone}` : ''}` : '',
    o.comment ? `Коментар покупця: ${o.comment}` : ''].filter(Boolean).join('\n');
}
// Вікна перед передачею в LP-CRM («Маркетплейси → Налаштування»): check — перевірка всіх даних, newItem — підтвердження нового товару.
export const FLOW_DEFAULT = { check: true, newItem: true };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// Рядки товарів LP-CRM для одного товару маркетплейсу: склад на 1 шт × кількість; основний отримує решту ціни.
export function partsToLines(parts, qty, price) {
  const q = Math.max(1, Number(qty) || 1);
  const [head, ...extra] = parts;
  if (!head) return [];
  const rest = extra.reduce((a, p) => a + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);
  const headPrice = r2((Number(price) - rest) / (Number(head.qty) || 1));
  return [{ product_id: head.product_id, count: r2((Number(head.qty) || 1) * q), price: headPrice },
    ...extra.map((p) => ({ product_id: p.product_id, count: r2((Number(p.qty) || 1) * q), price: r2(p.price) }))];
}

export function mountMarketCrm(app, { db, fetchFn, services = {}, onCron = () => {}, rzOrderOf, items, shopsOf = async () => ({}) }) {
  const flowOf = async () => {
    try { return { ...FLOW_DEFAULT, ...JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'mp_crm_flow'`))?.value || '{}') }; } catch { return { ...FLOW_DEFAULT }; }
  };
  const shopName = async (acc) => String(((await shopsOf()).rozetka || []).find((a) => String(a.id) === String(acc))?.name || '');
  const userName = (u) => String(u?.name || u?.login || '').slice(0, 80);
  const creds = async () => {
    const s = await loadSettings(db);
    return s.lpcrm_subdomain && s.lpcrm_key ? { subdomain: s.lpcrm_subdomain, key: s.lpcrm_key, inKey: s.lpcrm_in_key || s.lpcrm_key } : null;
  };
  // Налаштування LP-CRM для кожного магазину Розетки: ID відділу, сайт, служба доставки, «Додаткове поле 1» (канал продажу).
  const shopCfgAll = async () => {
    try { return JSON.parse((await db.get(`SELECT value FROM settings WHERE key = 'mp_crm_shops'`))?.value || '{}') || {}; } catch { return {}; }
  };
  const key = (o) => `${o.account_id}:${o.id}`;

  // Перевірка (лише власник): чи приймає addNewOrder недокументований параметр status. Створює ОДНЕ тестове
  // замовлення «ТЕСТ API» і читає, у якому статусі воно опинилось. Тимчасово — для рішення про вибір статусу.
  app.post('/api/mp/crm/status-test', async (c) => {
    need(c, 'users');
    if (c.get('user')?.role !== 'owner') throw fail(403, 'Лише для власника.');
    const b = await c.req.json().catch(() => ({}));
    const status = String(parseInt(b.status, 10) || '');
    const pid = String(parseInt(b.product_id, 10) || '');
    if (!status || !pid) throw fail(400, 'Вкажіть status і product_id.');
    const cr = await creds();
    if (!cr) throw fail(400, 'LP-CRM не налаштовано.');
    const code = newCode();
    const res = await addNewOrder(fetchFn, { subdomain: cr.subdomain, key: cr.inKey }, {
      code, office: MP_OFFICE, status, bayer_name: 'ТЕСТ API статусу — не обробляти', phone: '380000000000',
      comment: `Тест: чи приймає API статус ${status}. Створено сервісом накладних, можна видалити.`,
      products: [{ product_id: pid, price: 1, count: 1 }],
    });
    if (!res.ok) return c.json({ ok: false, error: res.error });
    const found = await getOrdersBatch(fetchFn, cr, [code]).catch(() => []);
    const o = found.find((x) => String(x.order_id) === code) || {};
    return c.json({ ok: true, code, crm_id: res.crmId || String(o.id || ''), sent_status: status, got_status: String(o.status ?? ''), status_name: String(o.status_name ?? o.status_orders_name ?? '') });
  });

  app.get('/api/mp/crm/settings', async (c) => {
    need(c, 'market.view');
    return c.json({ configured: Boolean(await creds()), shops: await shopCfgAll() });
  });
  app.get('/api/mp/crm/flow', async (c) => {
    need(c, 'market.view');
    return c.json(await flowOf());
  });
  app.put('/api/mp/crm/flow', async (c) => {
    need(c, 'api');
    const b = await c.req.json().catch(() => ({}));
    const cur = await flowOf();
    const next = { check: b.check === undefined ? cur.check : Boolean(b.check), newItem: b.newItem === undefined ? cur.newItem : Boolean(b.newItem) };
    await db.run(`INSERT INTO settings (key, value) VALUES ('mp_crm_flow', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [J(next)]);
    return c.json(next);
  });
  app.put('/api/mp/crm/settings/:account', async (c) => {
    need(c, 'api');
    const b = await c.req.json().catch(() => ({}));
    const acc = String(Number(c.req.param('account')) || '');
    if (!acc) throw fail(400, 'Невідомий магазин.');
    const office = String(b.office ?? '').trim();
    if (office && !/^\d{1,10}$/.test(office)) throw fail(400, 'ID відділу LP-CRM — лише цифри.');
    const all = await shopCfgAll();
    all[acc] = { office, site: String(b.site ?? '').trim().slice(0, 120), delivery: String(b.delivery ?? '').trim().slice(0, 20), field1: String(b.field1 ?? '').trim().slice(0, 120) };
    await db.run(`INSERT INTO settings (key, value) VALUES ('mp_crm_shops', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [J(all)]);
    return c.json({ ok: true, shops: all });
  });

  // ---------- товари: Розетка → LP-CRM ----------
  // Зв'язок із замовленням LP-CRM вивчає товар: однозначно лише для замовлення з одним товаром (не чіпає наявні прив'язки).
  const learn = async (mp, o, crmOrder) => {
    const list = JSON.parse(o.items || '[]');
    const prods = Array.isArray(crmOrder?.products) ? crmOrder.products : Object.values(crmOrder?.products || {});
    if (list.length !== 1 || prods.length !== 1 || !list[0].id) return;
    const pid = Number(prods[0].product_id ?? prods[0].id);
    if (!pid) return;
    await items.linkMany(mp, o.account_id, [{ ...list[0], item_id: String(list[0].id), product_id: pid, source: 'learned' }], 'за замовленням LP-CRM', { onlyEmpty: true });
  };
  // Пошук товару LP-CRM для форми: словник каталогу, а також товари з аналітики й рітейлу (поки каталог не повний).
  const searchProducts = async (q, limit = 20) => {
    const words = String(q || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).slice(0, 6);
    if (!words.length) return [];
    const like = words.map(() => `LOWER(name) LIKE ?`).join(' AND ');
    const args = words.map((w) => `%${w}%`);
    const [k, a, b] = await Promise.all([
      services.catalog?.search(q, 60) ?? [],
      db.all(`SELECT product_id AS id, name FROM an_products WHERE ${like} LIMIT 60`, args).catch(() => []),
      db.all(`SELECT product_id AS id, name FROM rzs_products WHERE product_id IS NOT NULL AND ${like} LIMIT 60`, args).catch(() => []),
    ]);
    const seen = new Set();
    return [...k, ...a, ...b].filter((p) => p.id && !seen.has(p.id) && seen.add(p.id)).map((p) => ({ id: p.id, name: p.name, price: Number(p.price) || 0 })).slice(0, limit);
  };
  const userAllowed = (c, acc) => { const u = c.get('user'); return !u || shopAllowed(u, 'rozetka', Number(acc)); };
  // Склад товарів замовлення для LP-CRM: підтверджений раніше або підказка довідника (основний товар, решта ціни).
  async function orderGoods(o) {
    const list = JSON.parse(o.items || '[]');
    const [found, rec] = await Promise.all([items.resolve('rozetka', o.account_id, list), items.recipes('rozetka', o.account_id, list.map((it) => String(it.id || '')))]);
    const out = list.map((it) => {
      const id = String(it.id || '');
      const r = rec.get(id);
      const f = found.find((x) => x.item_id === id);
      const parts = r?.parts?.length ? r.parts : f?.product_id ? [{ product_id: f.product_id, qty: 1, price: null }] : [];
      return { item_id: id, name: String(it.name || ''), article: String(it.article || ''), offer: String(it.offer || ''), photo: String(it.photo || ''),
        qty: Number(it.qty) || 1, price: Number(it.price) || 0, confirmed: Boolean(r?.confirmed && parts.length), from: r?.confirmed ? 'confirmed' : f?.from || '', parts };
    });
    const ids = out.flatMap((x) => x.parts.map((p) => p.product_id));
    const [names, cat] = await Promise.all([items.namesOf(ids), services.catalog?.byIds(ids) ?? []]);
    const priceOf = new Map(cat.map((p) => [p.id, p.price]));
    for (const x of out) for (const p of x.parts) Object.assign(p, { name: names.get(p.product_id) || '', list_price: priceOf.get(p.product_id) || 0 });
    return out;
  }
  app.get('/api/mp/crm/products', async (c) => {
    need(c, 'market.edit');
    return c.json({ products: await searchProducts(c.req.query('q')) });
  });
  // Що піде в LP-CRM: товари Розетки зі складом LP-CRM (підтверджений раніше або підказка довідника — прив'язаний,
  // дубль у цьому ж магазині, за кодом чи артикулом; інакше порожньо), покупець, доставка, оплата й коментар.
  app.get('/api/mp/crm/prefill/:account/:id', async (c) => {
    need(c, 'market.edit');
    const o = await rzOrderOf({ account: c.req.param('account'), id: c.req.param('id') }, c);
    const [goods, all, flow, configured, shop] = await Promise.all([orderGoods(o), shopCfgAll(), flowOf(), creds(), shopName(o.account_id)]);
    const cfg = all[String(o.account_id)] || {};
    const pay = crmPayment(o);
    return c.json({
      items: goods, shop: cfg, shop_name: shop, configured: Boolean(configured), flow, pay: { id: pay.payment, name: PAY_NAMES[pay.payment], cod: pay.cod },
      office: { id: MP_OFFICE, name: 'Маркетплейси' }, created_at: o.created_at, total: Number(o.total) || 0,
      send: { bayer_name: o.customer || o.recipient || '', phone: String(o.phone || o.recipient_phone || '').replace(/\D/g, ''), delivery: o.delivery || '',
        address: [o.address, o.ttn ? `ТТН ${o.ttn}` : ''].filter(Boolean).join(', '), site: cfg.site || new URL(c.req.url).host, field1: cfg.field1 || '', comment: crmComment(o, shop) },
    });
  });

  // Підтвердити товари (вікно «Підтвердіть товари для LP-CRM»): склад запам'ятовується лише для цього магазину.
  app.post('/api/mp/crm/confirm', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    const acc = Number(b.account) || 0;
    if (!acc) throw fail(400, 'Невідомий магазин.');
    if (!userAllowed(c, acc)) throw fail(403, 'Немає доступу до цього магазину.');
    const list = (Array.isArray(b.items) ? b.items : []).slice(0, 50);
    if (!list.length) throw fail(400, 'Немає товарів.');
    if (list.some((x) => !Array.isArray(x.parts) || !x.parts.length || x.parts.some((p) => !Number(p.product_id)))) throw fail(400, 'Оберіть товар LP-CRM для кожного товару маркетплейсу.');
    const n = await items.confirm('rozetka', acc, list, userName(c.get('user')));
    return c.json({ ok: true, confirmed: n });
  });

  // Довідник товарів магазинів для «Маркетплейси → Налаштування → Товари».
  app.get('/api/mp/items', async (c) => {
    need(c, 'market.view');
    const u = c.get('user');
    const shops = ((await shopsOf()).rozetka || []).filter((a) => !u || shopAllowed(u, 'rozetka', a.id));
    const acc = Number(c.req.query('account')) || 0;
    const accounts = acc ? shops.filter((a) => a.id === acc).map((a) => a.id) : shops.map((a) => a.id);
    const r = await items.list({ mp: 'rozetka', accounts, q: c.req.query('q') || '', only: c.req.query('only') || '', limit: Number(c.req.query('limit')) || 100, offset: Number(c.req.query('offset')) || 0 });
    return c.json({ ...r, shops: shops.map((a) => ({ id: a.id, name: a.name })) });
  });

  // ---------- створити в LP-CRM ----------
  app.post('/api/mp/crm/create', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    const o = await rzOrderOf(b, c);
    if (o.crm_id || o.crm_code) throw fail(400, `Уже в LP-CRM${o.crm_id ? `: № ${o.crm_id}` : ''}.`);
    if (String(o.status) !== CRM_FROM_STATUS) throw fail(400, 'Створити в LP-CRM можна лише замовлення в статусі «Обробляється менеджером».');
    const cr = await creds();
    if (!cr) throw fail(400, 'Не налаштовано LP-CRM у «Налаштуваннях».');
    const cfg = (await shopCfgAll())[String(o.account_id)] || {};
    // Рядки LP-CRM: з форми (кілька рядків на один товар Розетки — комплект) або, якщо не передано, — зі складу в довіднику.
    let lines = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map((x) => ({
      item_id: String(x.item_id || ''), product_id: Number(x.product_id) || 0, price: r2(x.price), count: Math.max(0.001, r2(x.qty) || 1),
      name: String(x.product_name || '').slice(0, 300),
    }));
    if (!lines.length && b.auto) {
      const goods = await orderGoods(o);
      if (goods.some((g) => !g.parts.length)) throw fail(400, 'Не для всіх товарів обрано товар LP-CRM — відкрийте «Створити в LP-CRM» і оберіть.');
      lines = goods.flatMap((g) => partsToLines(g.parts, g.qty, g.price).map((l) => ({ ...l, item_id: g.item_id })));
    }
    if (!lines.length) throw fail(400, 'Немає товарів.');
    if (lines.some((l) => !l.product_id || l.price < 0) || !lines.some((l) => l.price > 0)) throw fail(400, 'Оберіть товар LP-CRM і вкажіть ціну для кожного рядка (ціна основного товару не може бути менше нуля).');
    const over = (k, max) => (typeof b[k] === 'string' ? b[k].trim().slice(0, max) : null);
    const code = newCode();
    const claim = await db.run(`UPDATE mp_orders SET crm_code = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ? AND crm_code = '' AND crm_id = ''`, [code, o.account_id, o.id]);
    if (!claim.changes) throw fail(409, 'Замовлення вже передається в LP-CRM.');
    const shop = (await shopName(o.account_id)) || String(b.shop_name || '').slice(0, 80);
    const pay = crmPayment(o);
    // Покупця, телефон, адресу й коментар можна виправити у вікні перевірки перед передачею.
    const comment = over('comment', 3000) || crmComment(o, shop);
    const phone = (over('phone', 30) ?? '').replace(/\D/g, '') || String(o.phone || o.recipient_phone || '').replace(/\D/g, '');
    const host = cfg.site || new URL(c.req.url).host;
    let res;
    try {
      res = await addNewOrder(fetchFn, { subdomain: cr.subdomain, key: cr.inKey }, {
        code, office: MP_OFFICE, payment: pay.payment, bayer_name: over('bayer_name', 120) || o.customer || o.recipient || '', phone, comment,
        delivery: cfg.delivery || '', delivery_adress: over('address', 300) || [o.address, o.ttn ? `ТТН ${o.ttn}` : ''].filter(Boolean).join(', '), site: host, additional_1: cfg.field1 || '',
        products: lines.map((l) => ({ product_id: l.product_id, price: l.price, count: l.count })),
      });
    } catch (e) {
      await db.run(`UPDATE mp_orders SET crm_code = '' WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [o.account_id, o.id]);
      if (e.pending) throw e;
      throw fail(502, e.message);
    }
    if (!res.ok) {
      await db.run(`UPDATE mp_orders SET crm_code = '' WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [o.account_id, o.id]);
      throw fail(400, `LP-CRM не прийняла замовлення: ${res.error}`);
    }
    let crmId = res.crmId || '';
    if (!crmId) {
      const found = await getOrdersBatch(fetchFn, cr, [code]).catch(() => []);
      crmId = String(found.find((x) => String(x.order_id) === code)?.id || '');
    }
    const by = userName(c.get('user'));
    const st = [[`UPDATE mp_orders SET crm_id = ?, crm_at = ?, crm_by = ?, crm_status = 'Нові', crm_checked_at = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`,
      [crmId, nowIso(), `створив(ла) ${by}`, nowIso(), o.account_id, o.id]]];
    await db.batch(st);
    // товар без прив'язки, якому обрали товар LP-CRM (вікно підтвердження вимкнене) — запам'ятати як підказку для цього магазину
    const ordered = JSON.parse(o.items || '[]');
    const single = lines.filter((l) => l.item_id && lines.filter((x) => x.item_id === l.item_id).length === 1 && ordered.some((i) => String(i.id) === l.item_id));
    await items.linkMany('rozetka', o.account_id, single.map((l) => { const it = ordered.find((i) => String(i.id) === l.item_id); return { item_id: l.item_id, name: it?.name || '', article: it?.article || '', offer: it?.offer || '', product_id: l.product_id, source: 'manual' }; }), by, { onlyEmpty: true });
    return c.json({ ok: true, crm_id: crmId, code });
  });

  // ---------- знайти в LP-CRM ----------
  async function findCrm(rows) {
    rows = rows.filter((r) => !r.crm_id && !r.crm_code);
    const out = { checked: rows.length, linked: [], suggest: [], notFound: 0 };
    if (!rows.length) return out;
    const cr = await creds();
    if (!cr) throw fail(400, 'Не налаштовано LP-CRM у «Налаштуваннях».');
    if (rows.some((r) => r.ttn)) await services.analytics?.ttnQuick?.().catch(() => 0);
    const ttns = [...new Set(rows.map((r) => normTtn(r.ttn)).filter(Boolean))];
    const phones = [...new Set(rows.flatMap((r) => [phone9(r.phone), phone9(r.recipient_phone)]).filter((p) => p.length === 9))];
    const [a, b, k] = await Promise.all([
      ttns.length ? db.all(`SELECT code FROM an_ttn_recent WHERE ttn IN (SELECT value FROM json_each(?))`, [J(ttns)]).catch(() => []) : [],
      ttns.length ? db.all(`SELECT code FROM an_orders WHERE ttn IN (SELECT value FROM json_each(?))`, [J(ttns)]).catch(() => []) : [],
      db.all(`SELECT code FROM order_keys WHERE k IN (SELECT value FROM json_each(?))`, [J([...ttns, ...phones.map((p) => `p:${p}`)])]).catch(() => []),
    ]);
    let codes = [...new Set([...a, ...b, ...k].map((r) => String(r.code)))];
    const used = new Set(codes.length ? (await db.all(`SELECT crm_code FROM mp_orders WHERE crm_code IN (SELECT value FROM json_each(?))`, [J(codes)])).map((r) => r.crm_code) : []);
    codes = codes.filter((x) => !used.has(x)).slice(0, 300);
    const crm = codes.length ? await getOrdersBatch(fetchFn, cr, codes).catch((e) => { throw fail(502, `LP-CRM: ${e.message}`); }) : [];
    const list = crm.map((o) => ({ id: String(o.id ?? ''), code: String(o.order_id ?? ''), ttn: ttnOf(o), phone: phone9(o.phone), name: String(o.bayer_name ?? ''), raw: o }))
      .filter((o) => /^\d+$/.test(o.id) && o.code);
    const taken = new Set();
    const now = nowIso();
    const st = [];
    for (const r of rows) {
      const t = normTtn(r.ttn);
      const hit = t ? list.filter((o) => o.ttn === t && !taken.has(o.code)) : [];
      if (hit.length === 1) {
        taken.add(hit[0].code);
        st.push([`UPDATE mp_orders SET crm_id = ?, crm_code = ?, crm_at = ?, crm_by = ?, crm_checked_at = '' WHERE mp = 'rozetka' AND account_id = ? AND id = ? AND crm_id = '' AND crm_code = ''`,
          [hit[0].id, hit[0].code, now, `знайдено за ТТН ${t}`, r.account_id, r.id]]);
        out.linked.push({ key: key(r), number: r.number, crm_id: hit[0].id });
        await learn('rozetka', r, hit[0].raw).catch(() => {});
        continue;
      }
      const ps = [phone9(r.phone), phone9(r.recipient_phone)].filter((p) => p.length === 9);
      const maybe = [...hit, ...list.filter((o) => ps.includes(o.phone) && !hit.includes(o))].filter((o) => !taken.has(o.code)).slice(0, 5);
      if (maybe.length) out.suggest.push({ key: key(r), number: r.number, customer: r.customer, crm: maybe.map((o) => ({ id: o.id, name: o.name, ttn: o.ttn, by: o.ttn && o.ttn === t ? 'ТТН' : 'телефон' })) });
      else out.notFound++;
    }
    if (st.length) await db.batch(st);
    return out;
  }
  app.post('/api/mp/crm/find', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    const list = Array.isArray(b.orders) ? b.orders.slice(0, 300) : [];
    if (!list.length) throw fail(400, 'Оберіть замовлення.');
    const rows = [];
    for (const x of list) {
      try { rows.push(await rzOrderOf(x, c)); } catch (e) { if (e.status === 403) throw e; }
    }
    return c.json(await findCrm(rows));
  });

  // Ручна прив'язка: № замовлення LP-CRM (як у картці) або його код; порожньо — відв'язати.
  app.put('/api/mp/crm/link', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    const o = await rzOrderOf(b, c);
    const val = String(b.crm ?? '').replace(/\s/g, '');
    const by = userName(c.get('user'));
    if (!val) {
      await db.run(`UPDATE mp_orders SET crm_id = '', crm_code = '', crm_at = '', crm_status = '', crm_by = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [`відв'язав(ла) ${by}`, o.account_id, o.id]);
      return c.json({ ok: true, crm_id: '' });
    }
    if (!/^\d{1,20}$/.test(val)) throw fail(400, 'Номер замовлення LP-CRM — лише цифри.');
    let id = val.length <= 10 ? val : '';
    let code = val.length > 10 ? val : '';
    if (!code) {
      code = String((await db.get(`SELECT code FROM an_orders WHERE id = ?`, [Number(id)]).catch(() => null))?.code
        || (await db.get(`SELECT code FROM order_keys WHERE k = ? LIMIT 1`, [id]).catch(() => null))?.code || '');
    }
    const cr = await creds();
    let crmRaw = null;
    if (code && cr) {
      crmRaw = (await getOrdersBatch(fetchFn, cr, [code]).catch(() => [])).find((x) => String(x.order_id) === code) || null;
      if (crmRaw && /^\d+$/.test(String(crmRaw.id ?? ''))) id = String(crmRaw.id);
      else if (!id) throw fail(404, 'Замовлення з таким кодом у LP-CRM не знайдено.');
    }
    const other = await db.get(`SELECT number FROM mp_orders WHERE NOT (mp = 'rozetka' AND account_id = ? AND id = ?) AND ((crm_id != '' AND crm_id = ?) OR (crm_code != '' AND crm_code = ?)) LIMIT 1`,
      [o.account_id, o.id, id, code]);
    if (other) throw fail(400, `Це замовлення LP-CRM уже прив'язане до замовлення Розетки №${other.number}.`);
    await db.run(`UPDATE mp_orders SET crm_id = ?, crm_code = ?, crm_at = ?, crm_by = ?, crm_status = '', crm_checked_at = '' WHERE mp = 'rozetka' AND account_id = ? AND id = ?`,
      [id, code, nowIso(), `прив'язав(ла) ${by}`, o.account_id, o.id]);
    if (crmRaw) await learn('rozetka', o, crmRaw).catch(() => {});
    if (code) await refreshStatus({ force: true, only: [{ account_id: o.account_id, id: o.id, crm_id: id, crm_code: code }] }).catch(() => 0);
    const fresh = await db.get(`SELECT crm_id, crm_status FROM mp_orders WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [o.account_id, o.id]);
    return c.json({ ok: true, crm_id: fresh.crm_id, crm_status: fresh.crm_status, code });
  });

  // ---------- статус у LP-CRM ----------
  async function statusNames(cr) {
    const row = await db.get(`SELECT value FROM settings WHERE key = 'statuses_cache'`);
    let cache = null;
    try { cache = row?.value ? JSON.parse(row.value) : null; } catch { /* */ }
    if (cache?.map && cache.sub === cr.subdomain && Date.now() - cache.at < 86400000) return cache.map;
    const map = await getStatuses(fetchFn, cr);
    await db.run(`INSERT INTO settings (key, value) VALUES ('statuses_cache', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [J({ at: Date.now(), sub: cr.subdomain, map })]);
    return map;
  }
  async function refreshStatus({ force = false, only = null } = {}) {
    const cr = await creds();
    if (!cr) return 0;
    const border = new Date(Date.now() - (force ? 0 : CHECK_MS)).toISOString();
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const rows = only || await db.all(`SELECT account_id, id, crm_id, crm_code FROM mp_orders WHERE mp = 'rozetka' AND (crm_code != '' OR crm_id != '')
      AND created_at >= ? AND crm_checked_at < ? ORDER BY crm_checked_at LIMIT 100`, [since, border]);
    if (!rows.length) return 0;
    for (const r of rows.filter((x) => !x.crm_code && x.crm_id)) {
      r.crm_code = String((await db.get(`SELECT code FROM an_orders WHERE id = ?`, [Number(r.crm_id)]).catch(() => null))?.code
        || (await db.get(`SELECT code FROM order_keys WHERE k = ? LIMIT 1`, [r.crm_id]).catch(() => null))?.code || '');
    }
    const known = rows.filter((r) => r.crm_code);
    const [found, names] = await Promise.all([known.length ? getOrdersBatch(fetchFn, cr, known.map((r) => r.crm_code)) : [], statusNames(cr).catch(() => ({}))]);
    const now = nowIso();
    const st = rows.filter((r) => !r.crm_code).map((r) => [`UPDATE mp_orders SET crm_checked_at = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [now, r.account_id, r.id]]);
    for (const r of known) {
      const o = found.find((x) => String(x.order_id) === r.crm_code);
      const sid = o ? String(o.status ?? o.status_id ?? '') : '';
      const name = o ? String((names[sid]?.name ?? names[sid]) || sid || '').trim() : 'не знайдено в LP-CRM';
      const num = o && /^\d+$/.test(String(o.id ?? '')) ? String(o.id) : r.crm_id;
      st.push([`UPDATE mp_orders SET crm_status = ?, crm_checked_at = ?, crm_code = ?, crm_id = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`,
        [name.slice(0, 80), now, r.crm_code, num || '', r.account_id, r.id]]);
    }
    if (st.length) await db.batch(st);
    return known.length;
  }
  onCron('market-crm', 'Статус у LP-CRM для замовлень Розетки (маркетплейс), прив\'язаних до LP-CRM', () => refreshStatus());

  return { refreshStatus, findCrm };
}
