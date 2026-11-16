// Товари маркетплейсів (mp_items) ↔ товари LP-CRM (crm_products модуля «Каталог»).
// Довідник mp_items наповнює синхронізація замовлень (товар кожного магазину: назва, артикул, offer_id, фото).
// Прив'язка — лише однозначний збіг, інакше поле лишається порожнім (без вгадування за назвою):
//  1) уже прив'язано: вручну, з форми «Створити в LP-CRM» або вивчено зі зв'язку з замовленням LP-CRM (і стара mp_crm_items);
//  2) той самий товар (item_id), артикул чи offer_id уже прив'язаний в іншому рядку — дубль у магазині або інший магазин: копіюємо;
//  3) число на початку артикулу Розетки («30414 EvoairComfoDry12») = код у назві товару LP-CRM «[30414]» або його артикул;
//  4) латинська частина артикулу без бренду = model/vendor товару LP-CRM («EvoairComfoDry12» → comfodry12 ↔ «COMFODRY12»).
// Кілька товарів маркетплейсу можуть вести до одного товару LP-CRM. Автопідбір не змінює ручні прив'язки.
import { nowIso } from '../../core/common.js';
import { normSku } from '../catalog/index.js';

export const leadCode = (article) => (String(article || '').trim().match(/^(\d{3,12})\b/) || [])[1] || '';
export const latinPart = (article) => String(article || '').trim().replace(/^\d{3,12}\b[\s_-]*/, '');
const AUTO_LIMIT = 40; // товарів за один запуск фонового підбору (кожен — кілька читань з бази)
const J = (a) => JSON.stringify(a);
const uniq = (ids) => { const s = [...new Set(ids.map(Number).filter(Boolean))]; return s.length === 1 ? s[0] : 0; };

export function mountMarketItems({ db, services = {}, onCron = () => {} }) {
  const cat = () => services.catalog;

  // Назви товарів LP-CRM: з каталогу, інакше — з аналітики (товари, що вже продавались).
  async function namesOf(ids) {
    const list = [...new Set(ids.map(Number).filter(Boolean))];
    const out = new Map();
    if (!list.length) return out;
    for (const p of await (cat()?.byIds(list) ?? [])) out.set(p.id, p.name);
    const missing = list.filter((id) => !out.has(id));
    if (missing.length) {
      for (const r of await db.all(`SELECT product_id, name FROM an_products WHERE product_id IN (SELECT value FROM json_each(?))`, [J(missing)]).catch(() => [])) out.set(r.product_id, r.name || '');
    }
    return out;
  }

  // items: [{ id, name, article, offer }] одного магазину → [{ item_id, product_id, product_name, from }].
  // persist — записати автоматичні збіги в mp_items (лише туди, де прив'язки ще немає).
  async function resolve(mp, account, items, { persist = true } = {}) {
    const list = items.filter((it) => it && String(it.id || '')).map((it) => ({ id: String(it.id), name: String(it.name || ''), article: String(it.article || ''), offer: String(it.offer || '') }));
    if (!list.length) return [];
    const ids = list.map((it) => it.id);
    const result = new Map(); // id → { product_id, from }
    // 1) уже прив'язано
    for (const r of await db.all(`SELECT item_id, product_id, link_source FROM mp_items WHERE mp = ? AND account_id = ? AND product_id IS NOT NULL AND item_id IN (SELECT value FROM json_each(?))`, [mp, account, J(ids)])) {
      result.set(r.item_id, { product_id: r.product_id, from: 'saved' });
    }
    let rest = list.filter((it) => !result.has(it.id));
    if (rest.length) { // 1б) стара таблиця mp_crm_items (без магазину)
      for (const r of await db.all(`SELECT item_id, product_id FROM mp_crm_items WHERE mp = ? AND item_id IN (SELECT value FROM json_each(?))`, [mp, J(rest.map((it) => it.id))]).catch(() => [])) {
        if (!result.has(r.item_id)) result.set(r.item_id, { product_id: r.product_id, from: 'saved', write: 'manual' });
      }
      rest = rest.filter((it) => !result.has(it.id));
    }
    if (rest.length) { // 2) той самий товар / артикул / offer_id уже прив'язаний деінде
      const arts = rest.map((it) => it.article).filter(Boolean);
      const offers = rest.map((it) => it.offer).filter(Boolean);
      const rows = await db.all(`SELECT account_id, item_id, article, offer_id, product_id FROM mp_items WHERE mp = ? AND product_id IS NOT NULL
        AND (item_id IN (SELECT value FROM json_each(?)) OR (article != '' AND article IN (SELECT value FROM json_each(?))) OR (offer_id != '' AND offer_id IN (SELECT value FROM json_each(?))))`,
      [mp, J(rest.map((it) => it.id)), J(arts), J(offers)]);
      for (const it of rest) {
        const hits = rows.filter((r) => !(String(r.account_id) === String(account) && r.item_id === it.id)
          && (r.item_id === it.id || (it.article && r.article === it.article) || (it.offer && r.offer_id === it.offer)));
        const pid = uniq(hits.map((r) => r.product_id));
        if (pid) result.set(it.id, { product_id: pid, from: 'copied', write: 'copied' });
      }
      rest = rest.filter((it) => !result.has(it.id));
    }
    if (rest.length && cat()) { // 3) код на початку артикулу = код товару LP-CRM
      const codes = rest.map((it) => leadCode(it.article)).filter(Boolean);
      const found = codes.length ? await cat().byCode(codes) : [];
      for (const it of rest) {
        const code = leadCode(it.article);
        const pid = code ? uniq(found.filter((p) => p.code === code).map((p) => p.id)) : 0;
        if (pid) result.set(it.id, { product_id: pid, from: 'code', write: 'code' });
      }
      rest = rest.filter((it) => !result.has(it.id));
    }
    if (rest.length && cat()) { // 4) артикул без бренду = model/vendor LP-CRM
      const brands = await cat().brands();
      const skunOf = (it) => { const v = normSku(latinPart(it.article), brands); return v.length >= 4 ? v : ''; };
      const skuns = rest.map(skunOf).filter(Boolean);
      const found = skuns.length ? await cat().bySkun(skuns) : [];
      for (const it of rest) {
        const sk = skunOf(it);
        const pid = sk ? uniq(found.filter((p) => p.skun === sk).map((p) => p.id)) : 0;
        if (pid) result.set(it.id, { product_id: pid, from: 'sku', write: 'sku' });
      }
    }
    const names = await namesOf([...result.values()].map((r) => r.product_id));
    if (persist) {
      const todo = list.filter((it) => result.get(it.id)?.write).map((it) => ({ ...it, product_id: result.get(it.id).product_id, source: result.get(it.id).write }));
      if (todo.length) await linkMany(mp, account, todo, 'авто', { onlyEmpty: true });
    }
    return list.map((it) => {
      const r = result.get(it.id);
      return { item_id: it.id, name: it.name, product_id: r?.product_id || null, product_name: r ? names.get(r.product_id) || '' : '', from: r?.from || '' };
    });
  }

  // Прив'язати (product_id) або відв'язати (null) кілька товарів одного магазину; onlyEmpty — лише ті, що без прив'язки.
  async function linkMany(mp, account, list, by = '', { onlyEmpty = false } = {}) {
    const items = list.filter((x) => x && String(x.item_id || x.id || ''));
    if (!items.length) return 0;
    const cur = new Map((await db.all(`SELECT item_id, product_id FROM mp_items WHERE mp = ? AND account_id = ? AND item_id IN (SELECT value FROM json_each(?))`,
      [mp, account, J(items.map((x) => String(x.item_id || x.id)))])).map((r) => [r.item_id, r.product_id]));
    const at = nowIso();
    const st = [];
    let n = 0;
    for (const x of items) {
      const id = String(x.item_id || x.id);
      const pid = x.product_id ? Number(x.product_id) : null;
      const was = cur.has(id) ? cur.get(id) : undefined;
      if (onlyEmpty && was) continue;
      if (was !== undefined && Number(was || 0) === Number(pid || 0)) continue;
      const src = String(x.source || (pid ? 'manual' : 'unlink')).slice(0, 20);
      st.push([`INSERT INTO mp_items (mp, account_id, item_id, name, article, offer_id, product_id, link_source, link_by, link_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mp, account_id, item_id) DO UPDATE SET product_id = excluded.product_id, link_source = excluded.link_source, link_by = excluded.link_by, link_at = excluded.link_at,
          name = CASE WHEN mp_items.name = '' THEN excluded.name ELSE mp_items.name END,
          article = CASE WHEN mp_items.article = '' THEN excluded.article ELSE mp_items.article END,
          offer_id = CASE WHEN mp_items.offer_id = '' THEN excluded.offer_id ELSE mp_items.offer_id END`,
      [mp, account, id, String(x.name || '').slice(0, 300), String(x.article || '').slice(0, 120), String(x.offer || '').slice(0, 40), pid, src, String(by).slice(0, 80), at]]);
      st.push([`INSERT INTO mp_items_log (mp, account_id, item_id, old_product_id, new_product_id, source, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [mp, account, id, was ?? null, pid, src, String(by).slice(0, 80), at]]);
      n++;
    }
    if (st.length) await db.batch(st);
    return n;
  }

  // Фоновий підбір для товарів без прив'язки (правила 2–4), по кілька десятків за запуск; свіжопродані — першими.
  async function autoLink(limit = AUTO_LIMIT) {
    const rows = await db.all(`SELECT mp, account_id, item_id AS id, name, article, offer_id AS offer FROM mp_items WHERE product_id IS NULL AND article != '' ORDER BY last_seen DESC, item_id LIMIT ?`, [limit]);
    if (!rows.length) return { checked: 0, linked: 0 };
    let linked = 0;
    const groups = new Map();
    for (const r of rows) { const k = `${r.mp}|${r.account_id}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    for (const [k, list] of groups) {
      const [mp, account] = k.split('|');
      const res = await resolve(mp, Number(account), list, { persist: true });
      linked += res.filter((x) => x.product_id).length;
    }
    return { checked: rows.length, linked };
  }
  onCron('market-items', 'Товари маркетплейсів → товари LP-CRM: автопідбір за кодом і артикулом (без вгадування за назвою)', () => autoLink());

  return { resolve, linkMany, autoLink };
}
