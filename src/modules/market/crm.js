// Маркетплейси → Розетка ↔ LP-CRM (як у «Ритейлі»):
// • прив'язка до замовлення LP-CRM — сама за ТТН (однозначний збіг) і пропозиції за телефоном, або вручну за номером;
// • «Створити в LP-CRM» — для замовлень у статусі Розетки «Обробляється менеджером» (26): нове замовлення в LP-CRM
//   (статус «Нові») з покупцем, телефоном, товарами й цінами Розетки, доставкою та оплатою в коментарі;
// • статус замовлення в LP-CRM для прив'язаних (фоном, раз на 10 хв).
// Товар Розетки → товар LP-CRM запам'ятовується (mp_crm_items) і підставляється наступного разу.
import { fail, need, nowIso, loadSettings } from '../../core/common.js';
import { addNewOrder, getOrdersBatch, getStatuses } from '../../integrations/lpcrm.js';
import { ttnOf } from '../analytics/index.js';

const newCode = () => `${Math.round(Date.now() / 100)}${String(Math.floor(10000 + Math.random() * 90000))}`;
const normTtn = (v) => String(v ?? '').replace(/\s/g, '').toUpperCase();
const phone9 = (v) => String(v ?? '').replace(/\D/g, '').slice(-9);
const J = (a) => JSON.stringify(a);
const CHECK_MS = 10 * 60e3;
export const CRM_FROM_STATUS = '26'; // «Обробляється менеджером»

export function mountMarketCrm(app, { db, fetchFn, services = {}, onCron = () => {}, rzOrderOf }) {
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

  app.get('/api/mp/crm/settings', async (c) => {
    need(c, 'market.view');
    return c.json({ configured: Boolean(await creds()), shops: await shopCfgAll() });
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
  const learn = async (mp, o, crmOrder) => {
    // однозначно лише для замовлення з одним товаром
    const items = JSON.parse(o.items || '[]');
    const prods = Array.isArray(crmOrder?.products) ? crmOrder.products : Object.values(crmOrder?.products || {});
    if (items.length !== 1 || prods.length !== 1 || !items[0].id) return;
    const pid = Number(prods[0].product_id ?? prods[0].id);
    if (!pid) return;
    await db.run(`INSERT INTO mp_crm_items (mp, item_id, product_id, name, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(mp, item_id) DO NOTHING`, [mp, String(items[0].id), pid, String(prods[0].name || items[0].name || '').slice(0, 300), nowIso()]);
  };
  const searchProducts = async (q, limit = 20) => {
    const words = String(q || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).slice(0, 6);
    if (!words.length) return [];
    const like = words.map(() => `LOWER(name) LIKE ?`).join(' AND ');
    const args = words.map((w) => `%${w}%`);
    const [a, b] = await Promise.all([
      db.all(`SELECT product_id AS id, name FROM an_products WHERE ${like} LIMIT 60`, args).catch(() => []),
      db.all(`SELECT product_id AS id, name FROM rzs_products WHERE product_id IS NOT NULL AND ${like} LIMIT 60`, args).catch(() => []),
    ]);
    const seen = new Set();
    return [...a, ...b].filter((p) => p.id && !seen.has(p.id) && seen.add(p.id)).slice(0, limit);
  };
  // Найкращий збіг за назвою: найбільше спільних слів (бренд, модель, цифри).
  const guess = async (name) => {
    const words = String(name || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !/^(для|та|до|від|with|and)$/.test(w));
    const strong = words.filter((w) => /\d/.test(w) || /^[a-z]/.test(w)).slice(0, 4); // модель/бренд латиницею, цифри
    if (!strong.length) return null;
    const list = await searchProducts(strong.slice(0, 2).join(' '), 40);
    let best = null;
    for (const p of list) {
      const n = String(p.name).toLowerCase();
      const score = words.filter((w) => n.includes(w)).length;
      if (!best || score > best.score) best = { ...p, score };
    }
    return best && best.score >= Math.min(3, words.length) ? { id: best.id, name: best.name } : null;
  };
  app.get('/api/mp/crm/products', async (c) => {
    need(c, 'market.edit');
    return c.json({ products: await searchProducts(c.req.query('q')) });
  });
  // Що підставити у форму «Створити в LP-CRM»: товари з ціною й кількістю Розетки і товаром LP-CRM (запам'ятаний або схожий за назвою).
  app.get('/api/mp/crm/prefill/:account/:id', async (c) => {
    need(c, 'market.edit');
    const o = await rzOrderOf({ account: c.req.param('account'), id: c.req.param('id') }, c);
    const items = JSON.parse(o.items || '[]');
    const known = items.length ? await db.all(`SELECT item_id, product_id, name FROM mp_crm_items WHERE mp = 'rozetka' AND item_id IN (SELECT value FROM json_each(?))`, [J(items.map((i) => String(i.id || '')))]) : [];
    const out = [];
    for (const it of items) {
      const k = known.find((x) => x.item_id === String(it.id || ''));
      const g = k ? null : await guess(it.name);
      out.push({ item_id: String(it.id || ''), name: it.name, qty: Number(it.qty) || 1, price: Number(it.price) || 0,
        product_id: k?.product_id || g?.id || null, product_name: k?.name || g?.name || '', from: k ? 'saved' : g ? 'guess' : '' });
    }
    const cfg = (await shopCfgAll())[String(o.account_id)] || {};
    return c.json({ items: out, shop: cfg, configured: Boolean(await creds()) });
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
    if (!cfg.office) throw fail(400, 'Вкажіть ID відділу LP-CRM для цього магазину («Налаштування LP-CRM» на сторінці магазину).');
    const items = JSON.parse(o.items || '[]');
    const lines = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map((x) => ({
      item_id: String(x.item_id || ''), product_id: Number(x.product_id) || 0, price: Math.round((Number(x.price) || 0) * 100) / 100, count: Math.max(1, Math.round(Number(x.qty) || 1)),
      name: String(x.product_name || '').slice(0, 300),
    }));
    if (!lines.length) throw fail(400, 'Немає товарів.');
    const bad = lines.filter((l) => !l.product_id || !(l.price > 0));
    if (bad.length) throw fail(400, 'Оберіть товар LP-CRM і вкажіть ціну для кожного рядка.');
    const code = newCode();
    const claim = await db.run(`UPDATE mp_orders SET crm_code = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ? AND crm_code = '' AND crm_id = ''`, [code, o.account_id, o.id]);
    if (!claim.changes) throw fail(409, 'Замовлення вже передається в LP-CRM.');
    const shop = String(b.shop_name || '').slice(0, 80);
    const comment = [`Rozetka ${o.number}${shop ? ` · ${shop}` : ''}`, o.pay_type ? `Оплата: ${o.pay_type}${o.paid ? ' (оплачено)' : o.pay_status ? ` (${o.pay_status})` : ''}` : '',
      o.delivery ? `Доставка: ${o.delivery}` : '', o.recipient && o.recipient !== o.customer ? `Отримувач: ${o.recipient}${o.recipient_phone ? ` ${o.recipient_phone}` : ''}` : '',
      o.comment ? `Коментар покупця: ${o.comment}` : ''].filter(Boolean).join('\n');
    const host = cfg.site || new URL(c.req.url).host;
    let res;
    try {
      res = await addNewOrder(fetchFn, { subdomain: cr.subdomain, key: cr.inKey }, {
        code, office: cfg.office, bayer_name: o.customer || o.recipient || '', phone: String(o.phone || o.recipient_phone || '').replace(/\D/g, ''), comment,
        delivery: cfg.delivery || '', delivery_adress: [o.address, o.ttn ? `ТТН ${o.ttn}` : ''].filter(Boolean).join(', '), site: host, additional_1: cfg.field1 || '',
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
    // запам'ятати товари (лише ті, що є в замовленні Розетки)
    for (const l of lines) {
      if (!l.item_id || !items.some((i) => String(i.id) === l.item_id)) continue;
      st.push([`INSERT INTO mp_crm_items (mp, item_id, product_id, name, updated_at) VALUES ('rozetka', ?, ?, ?, ?)
        ON CONFLICT(mp, item_id) DO UPDATE SET product_id = excluded.product_id, name = excluded.name, updated_at = excluded.updated_at`, [l.item_id, l.product_id, l.name, nowIso()]]);
    }
    await db.batch(st);
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
