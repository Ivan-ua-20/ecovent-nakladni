// Маркетплейси → «Реклама»: рекламні кампанії Розетки (CPC) у нашому порталі — перегляд (етап 1).
// Дані — ті самі адреси, що в кабінеті продавця (у публічній документації їх немає):
//   raising-campaigns/search            — кампанії зі статистикою за весь час (views, clicks, money, transactions, cpo, cpc);
//   raising-campaign-items/search       — товари кампанії: ставка (rate.min/current), статус, статистика, товар;
//   promo-analytics/order/search        — замовлення з реклами за період (кампанія, товар, сума);
//   balances/balance-ads, raising/common/adv-balance-credit-limit — рекламний баланс і ліміт.
// Наша колонка «Усі замовлення за період» — з mp_orders (усі замовлення товару в магазині за обрані дати, без скасованих).
// Доступ: розділ «Маркетплейси» і магазин; запити — особистим входом у Розетку (rzAct), якщо підключено, інакше службовим.
// Розетка відповідає «access_denied» — вхід без прав на рекламу (Налаштування → Менеджери в кабінеті Розетки).
import { fail, need } from '../../core/common.js';
import { shopAllowed } from '../../core/auth.js';
import { rzAdsGet, rzAdsPut } from '../../integrations/rozetka.js';
import { logAudit } from '../../core/requisites.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = { active: '1', paused: '0', finished: '2' };
const TTL = 5 * 60 * 1000;
const AD_STATUS = { paused: 0, active: 1, finished: 2 }; // як у кабінеті Розетки
const money2 = (v) => Math.round(Number(String(v ?? '').replace(',', '.')) * 100) / 100;

export function mountMarketAds(app, { db, fetchFn, rzAct, accOf, shared = {} }) {
  shared.adsCache ||= new Map();
  const cache = shared.adsCache;
  const cached = async (key, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value;
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return value;
  };

  async function accFor(c) {
    need(c, 'market.view');
    const acc = await accOf('rozetka', c.req.query('account'));
    if (!shopAllowed(c.get('user'), 'rozetka', acc.id)) throw fail(403, 'У вас немає доступу до цього магазину.');
    return acc;
  }
  // GET до рекламних адрес Розетки → content; помилки — зрозумілим текстом.
  async function get(c, acc, path) {
    const r = await rzAct(c, acc, (t) => rzAdsGet(fetchFn, t, path));
    const j = r?.json;
    if (j?.success) return j.content;
    const e = j?.errors || {};
    if (e.message === 'access_denied') {
      throw fail(403, `Немає доступу до реклами магазину «${acc.name}». Вхід, через який працює сервіс (або ваш особистий — «Розетка» вгорі), має бути з правами на рекламу: у кабінеті Розетки — Налаштування → Менеджери.`);
    }
    throw fail(502, `Розетка (реклама): ${e.description || e.message || `помилка ${r?.status || ''}`}`.trim());
  }
  const range = (c) => {
    const to = DAY_RE.test(c.req.query('to') || '') ? c.req.query('to') : new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    const from = DAY_RE.test(c.req.query('from') || '') ? c.req.query('from') : new Date(Date.parse(`${to}T12:00:00Z`) - 6 * 86400e3).toISOString().slice(0, 10);
    if (from > to) throw fail(400, 'Дата «з» пізніша за «по».');
    return { from, to };
  };

  // Замовлення з реклами за період (усі сторінки, до 1000): по кампаніях і по товарах кампанії.
  async function adOrders(c, acc, { from, to }) {
    return cached(`ao|${acc.id}|${from}|${to}`, async () => {
      const rows = [];
      for (let page = 1; page <= 10; page++) {
        const r = await get(c, acc, `promo-analytics/order/search?order_created_from=${from}&order_created_to=${to}&page=${page}&pageSize=100&sort=-id`);
        rows.push(...(r?.advertisingOrders || []));
        if (page >= (r?._meta?.pageCount || 1)) break;
      }
      return rows.map((o) => ({ order: String(o.order_id), status: Number(o.order_status) || 0, sum: Number(o.order_cost_with_discount) || 0,
        campaign: Number(o.campaign_id) || 0, item: String(o.item_id || ''), at: String(o.created_at || '') }));
    });
  }
  // Наші замовлення товарів магазину за період (з mp_orders): item_id → { orders, qty, sum }, без скасованих.
  async function ourOrders(acc, { from, to }, itemIds = null) {
    const rows = await db.all(
      `SELECT json_extract(j.value, '$.id') AS item, COUNT(DISTINCT o.id) AS orders, SUM(COALESCE(json_extract(j.value, '$.qty'), 1)) AS qty,
         SUM(COALESCE(json_extract(j.value, '$.qty'), 1) * COALESCE(json_extract(j.value, '$.price'), 0)) AS sum
       FROM mp_orders o, json_each(o.items) j
       WHERE o.mp = 'rozetka' AND o.account_id = ? AND o.created_at >= ? AND o.created_at <= ? AND o.status_group != 3
         ${itemIds ? `AND json_extract(j.value, '$.id') IN (SELECT value FROM json_each(?))` : ''}
       GROUP BY item`,
      itemIds ? [acc.id, `${from} 00:00:00`, `${to} 23:59:59`, JSON.stringify(itemIds)] : [acc.id, `${from} 00:00:00`, `${to} 23:59:59`],
    );
    return new Map(rows.map((r) => [String(r.item), { orders: r.orders, qty: r.qty, sum: Math.round(r.sum * 100) / 100 }]));
  }
  // Для кампанії: замовлення, де є хоч один її товар (кожне замовлення — один раз), і сума саме цих товарів.
  async function ourOrdersTotal(acc, { from, to }, itemIds) {
    if (!itemIds.length) return { orders: 0, sum: 0 };
    const r = await db.get(
      `SELECT COUNT(DISTINCT o.id) AS orders, SUM(COALESCE(json_extract(j.value, '$.qty'), 1) * COALESCE(json_extract(j.value, '$.price'), 0)) AS sum
       FROM mp_orders o, json_each(o.items) j
       WHERE o.mp = 'rozetka' AND o.account_id = ? AND o.created_at >= ? AND o.created_at <= ? AND o.status_group != 3
         AND json_extract(j.value, '$.id') IN (SELECT value FROM json_each(?))`,
      [acc.id, `${from} 00:00:00`, `${to} 23:59:59`, JSON.stringify(itemIds)],
    );
    return { orders: r?.orders || 0, sum: Math.round((r?.sum || 0) * 100) / 100 };
  }
  const num = (v) => Number(v) || 0;
  const statOf = (s = {}) => ({ views: num(s.views), clicks: num(s.clicks), money: num(s.money), orders: num(s.transactions), cpo: num(s.cpo), cpc: num(s.cpc) });

  // Товари кампанії (усі сторінки) — кеш 5 хв.
  const campaignItems = (c, acc, id, status) => cached(`ci|${acc.id}|${id}|${status}`, async () => {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const r = await get(c, acc, `raising-campaign-items/search?expand=item,rate,advertising_state&page=${page}&pageSize=100&sort=-id&campaign_id=${id}${status ? `&campaign_status=${status}` : ''}`);
      out.push(...(r?.advertisingCampaignItems || []));
      if (page >= (r?._meta?.pageCount || 1)) break;
    }
    return out;
  });

  // ---------------------------------------------------------------- керування (етап 2)
  // Зміни йдуть від імені того, хто натиснув (особистий вхід у Розетку, якщо підключено); кожна — в журнал змін.
  async function accEdit(c, b) {
    need(c, 'market.edit');
    const acc = await accOf('rozetka', b.account);
    if (!shopAllowed(c.get('user'), 'rozetka', acc.id)) throw fail(403, 'У вас немає доступу до цього магазину.');
    return acc;
  }
  async function put(c, acc, path, body) {
    const r = await rzAct(c, acc, (t) => rzAdsPut(fetchFn, t, path, body));
    const j = r?.json;
    if (j?.success) return j.content;
    const e = j?.errors || {};
    if (e.message === 'access_denied') throw fail(403, `Немає прав змінювати рекламу магазину «${acc.name}» — потрібен вхід з правами на рекламу (кабінет Розетки → Налаштування → Менеджери).`);
    const det = e.details && typeof e.details === 'object' ? Object.values(e.details).flat().filter((x) => typeof x === 'string').join('; ') : '';
    throw fail(400, `Розетка не прийняла зміну: ${[e.description || e.message || `помилка ${r?.status || ''}`, det].filter(Boolean).join(' — ')}`);
  }
  const forget = (acc, campaignId = null) => { for (const k of [...cache.keys()]) if (k.startsWith(campaignId == null ? `ci|${acc.id}|` : `ci|${acc.id}|${campaignId}|`)) cache.delete(k); };
  const audit = (c, acc, refId, action) => logAudit(db, { user: c.get('user'), kind: 'rz-ads', refId: `${acc.id}:${refId}`, action, changes: [] }).catch(() => 0);

  // Кампанія: пауза / запуск.
  app.post('/api/mp/ads/campaigns/:id{[0-9]+}/status', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const acc = await accEdit(c, b);
    const id = Number(c.req.param('id'));
    if (!['active', 'paused'].includes(b.status)) throw fail(400, 'Невідомий статус.');
    await put(c, acc, `raising-campaigns/${id}`, { id, status: AD_STATUS[b.status] });
    await audit(c, acc, id, `реклама: кампанію ${b.title ? `«${String(b.title).slice(0, 80)}» ` : ''}${b.status === 'paused' ? 'призупинено' : 'запущено'}`);
    return c.json({ ok: true });
  });
  // Кампанія: бюджет на день (інші поля — як зараз у Розетці).
  app.post('/api/mp/ads/campaigns/:id{[0-9]+}/budget', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const acc = await accEdit(c, b);
    const id = Number(c.req.param('id'));
    const budget = money2(b.budget);
    if (!(budget >= 1 && budget <= 99999)) throw fail(400, 'Бюджет на день — від 1 до 99 999 грн.');
    const cur = await get(c, acc, `raising-campaigns/${id}`);
    const body = { id, title: cur.title, daily_budget: budget, start_date: cur.start_date, end_date: cur.end_date };
    for (const k of ['auto_activate', 'accept_minbid', 'auto_renewal', 'is_external']) if (cur[k] != null) body[k] = cur[k];
    await put(c, acc, `raising-campaigns/${id}`, body);
    await audit(c, acc, id, `реклама: «${String(cur.title || id).slice(0, 80)}» — бюджет на день ${Number(cur.daily_budget) || 0} → ${budget} грн`);
    return c.json({ ok: true, budget });
  });
  // Оголошення (товар у кампанії): ставка і/або пауза / запуск. Беремо оголошення з Розетки як є і змінюємо лише потрібне.
  app.post('/api/mp/ads/items/:id{[0-9]+}', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const acc = await accEdit(c, b);
    const id = Number(c.req.param('id'));
    const campaign = Number(b.campaign) || 0;
    if (!campaign) throw fail(400, 'Не вказано кампанію.');
    forget(acc, campaign);
    const [camp, items] = await Promise.all([get(c, acc, `raising-campaigns/${campaign}`), campaignItems(c, acc, campaign, '')]);
    const ad = items.find((x) => Number(x.id) === id);
    if (!ad) throw fail(404, 'Оголошення не знайдено в кампанії — оновіть сторінку.');
    if (ad.is_editable === false) throw fail(400, 'Розетка не дозволяє змінювати це оголошення.');
    const next = JSON.parse(JSON.stringify(ad));
    const was = [];
    if (b.rate != null && b.rate !== '') {
      const rate = money2(b.rate);
      const min = Number(ad.rate?.min) || 0;
      const max = Number(camp.daily_budget) || 0;
      if (!(rate > 0)) throw fail(400, 'Вкажіть ставку числом, напр. 6.50.');
      if (min && rate < min) throw fail(400, `Ставка не може бути меншою за мінімальну (${min} грн).`);
      if (max && rate > max) throw fail(400, `Ставка не може бути більшою за бюджет кампанії на день (${max} грн).`);
      next.max_day_money = rate;
      next.rate = { ...(ad.rate || {}), current: rate };
      was.push(`ставка ${Number(ad.rate?.current ?? ad.max_day_money) || 0} → ${rate}`);
    }
    if (b.status) {
      if (!['active', 'paused'].includes(b.status)) throw fail(400, 'Невідомий статус.');
      next.status = AD_STATUS[b.status];
      was.push(b.status === 'paused' ? 'призупинено' : 'запущено');
    } else if (typeof next.status === 'string') next.status = AD_STATUS[next.status] ?? next.status;
    if (!was.length) throw fail(400, 'Нічого не змінено.');
    await put(c, acc, `raising-campaign-items/${id}`, next);
    forget(acc, campaign);
    await audit(c, acc, `${campaign}/${id}`, `реклама: «${String(camp.title || campaign).slice(0, 60)}» → ${String(ad.item?.name_ua || ad.item?.name || ad.item_id).slice(0, 80)}: ${was.join(', ')}`);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- кампанії
  app.get('/api/mp/ads/campaigns', async (c) => {
    const acc = await accFor(c);
    const st = STATUS[c.req.query('status')] ?? '1';
    const per = range(c);
    const list = async () => {
      const out = [];
      for (let page = 1; page <= 3; page++) {
        const r = await get(c, acc, `raising-campaigns/search?expand=items_count,statistics&page=${page}&pageSize=100&status=${st}`);
        out.push(...(r?.advertisingCampaigns || []));
        if (page >= (r?._meta?.pageCount || 1)) break;
      }
      return out;
    };
    const [camps, bal, limit, ao] = await Promise.all([
      list(),
      get(c, acc, 'balances/balance-ads').catch(() => null),
      get(c, acc, 'raising/common/adv-balance-credit-limit').catch(() => null),
      adOrders(c, acc, per).catch((e) => ({ error: e.message })),
    ]);
    const byCamp = new Map();
    for (const o of Array.isArray(ao) ? ao : []) {
      const x = byCamp.get(o.campaign) || { orders: 0, sum: 0 };
      x.orders++; x.sum += o.sum;
      byCamp.set(o.campaign, x);
    }
    return c.json({
      account: { id: acc.id, name: acc.name }, period: per, status: c.req.query('status') || 'active',
      balance: bal?.balance ?? null, limit: limit?.limit ?? null, adOrdersError: Array.isArray(ao) ? '' : ao.error,
      campaigns: camps.map((x) => ({
        id: x.id, title: x.title, start: x.start_date, end: x.end_date, budget: num(x.daily_budget), left_today: x.current_limit_budget != null ? num(x.current_limit_budget) : null,
        status: x.status, pause_reason: x.pause_reason || 0, type: x.type || 'CPC', items: num(x.items_count), editable: Boolean(x.is_editable),
        stat: statOf(x.statistics), period: { ad_orders: byCamp.get(x.id)?.orders || 0, ad_sum: Math.round((byCamp.get(x.id)?.sum || 0) * 100) / 100 },
      })),
    });
  });

  // Усі замовлення за період для кількох кампаній (колонка в списку): товари кампаній → наші замовлення. До 6 кампаній за запит.
  app.get('/api/mp/ads/campaign-orders', async (c) => {
    const acc = await accFor(c);
    const per = range(c);
    const st = STATUS[c.req.query('status')] ?? '1';
    const ids = String(c.req.query('ids') || '').split(',').map(Number).filter((x) => x > 0).slice(0, 6);
    const items = await Promise.all(ids.map((id) => campaignItems(c, acc, id, st).catch(() => null)));
    const out = {};
    for (let i = 0; i < ids.length; i++) {
      out[ids[i]] = items[i] ? await ourOrdersTotal(acc, per, [...new Set(items[i].map((x) => String(x.item_id)))]) : null;
    }
    return c.json({ period: per, campaigns: out });
  });

  // ---------------------------------------------------------------- товари кампанії
  app.get('/api/mp/ads/campaigns/:id{[0-9]+}', async (c) => {
    const acc = await accFor(c);
    const per = range(c);
    const id = Number(c.req.param('id'));
    const st = STATUS[c.req.query('status')] ?? '';
    const [camp, items, ao] = await Promise.all([
      get(c, acc, `raising-campaigns/${id}?expand=statistics`),
      campaignItems(c, acc, id, st),
      adOrders(c, acc, per).catch((e) => ({ error: e.message })),
    ]);
    const ours = await ourOrders(acc, per, items.map((x) => String(x.item_id)));
    const adBy = new Map();
    for (const o of Array.isArray(ao) ? ao : []) {
      if (o.campaign !== id) continue;
      const x = adBy.get(o.item) || { orders: 0, sum: 0 };
      x.orders++; x.sum += o.sum;
      adBy.set(o.item, x);
    }
    return c.json({
      account: { id: acc.id, name: acc.name }, period: per, adOrdersError: Array.isArray(ao) ? '' : ao.error,
      campaign: { id: camp.id, title: camp.title, start: camp.start_date, end: camp.end_date, budget: num(camp.daily_budget), left_today: camp.current_limit_budget != null ? num(camp.current_limit_budget) : null,
        status: camp.status, type: camp.type || 'CPC', stat: statOf(camp.statistics) },
      items: items.map((x) => {
        const it = x.item || {};
        const item = String(x.item_id);
        return {
          id: x.id, item_id: item, name: it.name_ua || it.name || `Товар ${item}`, article: it.article || '', price: num(it.price), price_old: num(it.price_old), photo: it.photo_preview || '',
          url: it.url || '', category: it.catalog_category?.name || '', stock: it.stock_quantity ?? null, sold: it.sold ?? null,
          rate: num(x.rate?.current ?? x.max_day_money), rate_min: num(x.rate?.min), status: x.status, start: x.start_date, end: x.end_date, editable: Boolean(x.is_editable),
          stat: statOf(x.stat),
          period: { ad_orders: adBy.get(item)?.orders || 0, ad_sum: Math.round((adBy.get(item)?.sum || 0) * 100) / 100, orders: ours.get(item)?.orders || 0, qty: ours.get(item)?.qty || 0, sum: ours.get(item)?.sum || 0 },
        };
      }),
    });
  });
}
