// «Надіслати зміни цін»: адмін натискає кнопку — кожному партнеру, у кого щось змінилося з минулої розсилки,
// бот надсилає зведення в Telegram-групу партнера (якщо не прив'язана — його користувачам особисто):
// нові РРЦ і нові ціни партнера по товарах, зміни знижки на бренди, відкриті й закриті бренди.
// Лише вручну (без розкладу). Після успішного надсилання запам'ятовується час (b2b_partners.prices_sent_at).
import { need, fail, nowIso, round2 } from '../../core/common.js';
import { graceHoursOf } from './orders.js';

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nf = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = (n) => nf.format(Number(n) || 0);
const pct = (v) => `${String(round2(v)).replace('.', ',')}%`;
const arrow = (a, b) => (b > a ? '▲' : b < a ? '▼' : '');
const MAX_CHUNK = 3800; // ліміт повідомлення Telegram — 4096
const MAX_CHUNKS = 6;
// Бренд, відкритий партнеру раніше за цей строк до першої розсилки, — не «новий» (партнер його вже має; розсилок просто ще не було).
const NEW_BRAND_DAYS = 7;
const dt = (iso) => new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function mountB2bPrices(app, { db, services, partnerPrice, myPartner }) {
  async function brandNames() {
    const rows = await db.all(`SELECT id, name FROM an_brands`).catch(() => []);
    return new Map([...rows.map((r) => [r.id, r.name]), [0, 'Інші']]);
  }

  // Що змінилося для партнера з минулої розсилки.
  async function changesOf(p, names) {
    const since = p.prices_sent_at || p.created_at || '';
    const [margins, mlogAll] = await Promise.all([
      db.all(`SELECT brand_id, margin, margin_wh FROM b2b_margins WHERE partner_id = ?`, [p.id]),
      db.all(`SELECT at, brand_id, old_margin, new_margin, COALESCE(kind, '') AS kind FROM b2b_margin_log WHERE partner_id = ? AND at > ? ORDER BY id`, [p.id, since]),
    ]);
    const mlog = mlogAll.filter((r) => r.kind !== 'wh');
    const cur = new Map(margins.map((m) => [m.brand_id, m.margin]));
    const curWh = new Map(margins.map((m) => [m.brand_id, m.margin_wh])); // null — як для відправки клієнтам
    // знижки: перше «було» і поточне «стало» за брендом
    const firstOld = new Map();
    const firstAt = new Map();
    for (const r of mlog) if (!firstOld.has(r.brand_id)) { firstOld.set(r.brand_id, r.old_margin); firstAt.set(r.brand_id, r.at); }
    const opened = [];
    const closed = [];
    const marginChanged = [];
    for (const [brand, old] of firstOld) {
      const now = cur.has(brand) ? cur.get(brand) : null;
      // Перша розсилка партнеру: бренди, відкриті давно (ще при підключенні), — не новинка; інакше зміни цін на них губилися.
      const longAgo = !p.prices_sent_at && Date.now() - Date.parse(firstAt.get(brand) || '') > NEW_BRAND_DAYS * 86400e3;
      if (old == null && now != null && !longAgo) opened.push({ brand, name: names.get(brand) || 'Інші', margin: now });
      else if (old != null && now == null) closed.push({ brand, name: names.get(brand) || 'Інші' });
      else if (old != null && now != null && round2(old) !== round2(now)) marginChanged.push({ brand, name: names.get(brand) || 'Інші', old, now });
    }
    const oldMargin = (brand) => {
      const mc = marginChanged.find((x) => x.brand === brand);
      return mc ? mc.old : cur.get(brand);
    };
    // Маржа «на склад партнера»: що змінилося (null — «як для відправки клієнтам») і яка діяла раніше.
    const whFirst = new Map();
    for (const r of mlogAll) if (r.kind === 'wh' && !whFirst.has(r.brand_id)) whFirst.set(r.brand_id, r.old_margin);
    const whChanged = [...whFirst].filter(([brand, old]) => cur.has(brand) && (old ?? null) !== (curWh.get(brand) ?? null)
      && !opened.some((o) => o.brand === brand)).map(([brand, old]) => ({ brand, name: names.get(brand) || 'Інші', old: old ?? null, now: curWh.get(brand) ?? null }));
    const whOld = (brand) => { const w = whChanged.find((x) => x.brand === brand); const raw = w ? w.old : curWh.get(brand); return raw ?? oldMargin(brand); };
    const whNow = (brand) => curWh.get(brand) ?? cur.get(brand);
    const showWh = (brand) => curWh.get(brand) != null || whChanged.some((x) => x.brand === brand);
    // товари: зміна РРЦ (журнал) — для всіх відкритих брендів, і всі товари брендів зі зміненою знижкою
    const brands = [...cur.keys()];
    if (!brands.length) return { since, opened, closed, marginChanged, whChanged, products: [] };
    const plog = await db.all(
      `SELECT l.product_id, l.old_rrp FROM b2b_price_log l JOIN b2b_catalog c ON c.product_id = l.product_id
       WHERE l.at > ? AND c.hidden = 0 AND c.brand_id IN (SELECT value FROM json_each(?)) ORDER BY l.id`, [since, JSON.stringify(brands)],
    );
    const oldRrp = new Map();
    for (const r of plog) if (!oldRrp.has(r.product_id)) oldRrp.set(r.product_id, r.old_rrp);
    const mcBrands = [...new Set([...marginChanged.map((x) => x.brand), ...whChanged.map((x) => x.brand)])].filter((b) => !opened.some((o) => o.brand === b));
    const rows = (oldRrp.size || mcBrands.length) ? await db.all(
      `SELECT product_id, name, article, rrp, brand_id FROM b2b_catalog WHERE hidden = 0 AND rrp > 0
         AND (product_id IN (SELECT value FROM json_each(?)) OR brand_id IN (SELECT value FROM json_each(?)))
         AND brand_id IN (SELECT value FROM json_each(?)) ORDER BY brand_id, name`,
      [JSON.stringify([...oldRrp.keys()]), JSON.stringify(mcBrands), JSON.stringify(brands)],
    ) : [];
    const products = [];
    for (const r of rows) {
      const o = oldRrp.has(r.product_id) ? oldRrp.get(r.product_id) : r.rrp;
      const oldPrice = partnerPrice(o, oldMargin(r.brand_id));
      const newPrice = partnerPrice(r.rrp, cur.get(r.brand_id));
      const wh = showWh(r.brand_id) ? { oldWh: partnerPrice(o, whOld(r.brand_id)), newWh: partnerPrice(r.rrp, whNow(r.brand_id)) } : {};
      if (round2(o) === round2(r.rrp) && oldPrice === newPrice && wh.oldWh === wh.newWh) continue;
      products.push({ id: r.product_id, name: r.name, article: r.article, brand: names.get(r.brand_id) || 'Інші', oldRrp: o, newRrp: r.rrp, oldPrice, newPrice, ...wh });
    }
    // відстрочка підвищення: до якого часу партнер ще замовляє за старою ціною (від останньої зміни РРЦ товару)
    const grace = await graceHoursOf(db, p);
    if (grace && products.some((x) => x.newPrice > x.oldPrice)) {
      const lastAt = new Map((await db.all(`SELECT product_id, MAX(at) AS at FROM b2b_price_log WHERE at > ? AND product_id IN (SELECT value FROM json_each(?)) GROUP BY product_id`,
        [since, JSON.stringify(products.map((x) => x.id))])).map((r) => [r.product_id, r.at]));
      for (const x of products) {
        const at = lastAt.get(x.id);
        if (x.newPrice > x.oldPrice && at && Date.parse(at) + grace * 3600e3 > Date.now()) x.graceUntil = new Date(Date.parse(at) + grace * 3600e3).toISOString();
      }
    }
    return { since, opened, closed, marginChanged, whChanged, products, grace };
  }

  const empty = (ch) => !ch.products.length && !ch.opened.length && !ch.closed.length && !ch.marginChanged.length && !ch.whChanged?.length;

  // Повідомлення (частинами до ~3800 символів).
  function messages(p, ch) {
    const head = `💲 <b>Зміна цін</b> — «${h(p.name)}»`;
    const blocks = [];
    if (ch.marginChanged.length) blocks.push(`<b>Ваша знижка від РРЦ:</b>\n${ch.marginChanged.map((x) => `${h(x.name)}: ${pct(x.old)} → <b>${pct(x.now)}</b>`).join('\n')}`);
    if (ch.whChanged?.length) blocks.push(`<b>Знижка від РРЦ на закупівлю на ваш склад:</b>\n${ch.whChanged.map((x) => `${h(x.name)}: ${x.old == null ? 'як для відправки клієнтам' : pct(x.old)} → <b>${x.now == null ? 'як для відправки клієнтам' : pct(x.now)}</b>`).join('\n')}`);
    if (ch.opened.length) blocks.push(`<b>Нові бренди для вас:</b>\n${ch.opened.map((x) => `${h(x.name)} — знижка ${pct(x.margin)} від РРЦ (товари — у каталозі)`).join('\n')}`);
    if (ch.closed.length) blocks.push(`<b>Більше недоступні:</b> ${ch.closed.map((x) => h(x.name)).join(', ')}`);
    const lines = ch.products.map((x) => `${h(x.name)}${x.article ? ` (${h(x.article)})` : ''}\n`
      + `   РРЦ ${m2(x.oldRrp)} → <b>${m2(x.newRrp)}</b> ${arrow(x.oldRrp, x.newRrp)} · ваша ціна ${m2(x.oldPrice)} → <b>${m2(x.newPrice)}</b> грн ${arrow(x.oldPrice, x.newPrice)}`
      + `${x.newWh !== undefined ? `\n   на ваш склад ${m2(x.oldWh)} → <b>${m2(x.newWh)}</b> грн ${arrow(x.oldWh, x.newWh)}` : ''}`
      + `${x.graceUntil ? `\n   ⏳ за старою ціною — до ${dt(x.graceUntil)}` : ''}`);
    if (ch.products.some((x) => x.graceUntil)) blocks.push(`⏳ Підвищені ціни починають діяти через ${ch.grace} год після зміни — до того замовлення приймаються за старими цінами.`);
    const out = [];
    let cur = [head, ...blocks].join('\n\n');
    if (lines.length) cur += `\n\n<b>Ціни (${lines.length}):</b>`;
    for (const [i, l] of lines.entries()) {
      if (cur.length + l.length + 1 > MAX_CHUNK) {
        if (out.length === MAX_CHUNKS - 1) { cur += `\n\n…і ще ${lines.length - i} — актуальні ціни в каталозі кабінету партнера.`; break; }
        out.push(cur);
        cur = `${head} (продовження)`;
      }
      cur += `\n${l}`;
    }
    out.push(cur);
    return out;
  }

  async function partnersWithChanges(ids = null) {
    const names = await brandNames();
    const list = await db.all(`SELECT p.*, (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id AND u.role = 'partner' AND u.active = 1 AND u.tg_chat_id != '') AS tg_users
      FROM b2b_partners p WHERE p.active = 1 AND COALESCE(p.deleted_at, '') = '' ORDER BY p.name`);
    const out = [];
    for (const p of list) {
      if (ids && !ids.includes(p.id)) continue;
      const ch = await changesOf(p, names);
      out.push({ p, ch });
    }
    return out;
  }

  // Перегляд: хто що отримає і куди.
  app.get('/api/b2b/price-changes', async (c) => {
    need(c, 'b2b.admin');
    const rows = await partnersWithChanges();
    return c.json(rows.map(({ p, ch }) => ({
      id: p.id, name: p.name, since: ch.since, products: ch.products.length, brands: ch.marginChanged.length + (ch.whChanged?.length || 0) + ch.opened.length + ch.closed.length,
      empty: empty(ch), group: p.tg_group_title || (p.tg_group ? 'група' : ''), tgUsers: p.tg_users,
      preview: empty(ch) ? [] : messages(p, ch),
    })));
  });

  // Надіслати (усім із змінами або обраним партнерам).
  app.post('/api/b2b/price-changes/send', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json().catch(() => ({}));
    const ids = Array.isArray(b.partner_ids) ? b.partner_ids.map(Number).filter(Boolean) : null;
    const results = [];
    for (const { p, ch } of await partnersWithChanges(ids)) {
      if (empty(ch)) continue;
      const to = p.tg_group ? { chatIds: [p.tg_group] } : { partnerId: p.id };
      let sent = 0;
      for (const text of messages(p, ch)) sent += (await services.notify?.sendText(to, text).catch(() => 0)) || 0;
      if (sent) await db.run(`UPDATE b2b_partners SET prices_sent_at = ? WHERE id = ?`, [nowIso(), p.id]);
      results.push({ id: p.id, name: p.name, sent: sent > 0, where: p.tg_group ? 'group' : 'users', products: ch.products.length });
    }
    return c.json({ results });
  });

  // ---------------------------------------------------------------- журнал змін цін
  // Зміни РРЦ товарів (з оновлень LP-CRM) і — для партнера — його ціна до й після (за знижкою на бренд на той момент)
  // та зміни його знижок на бренди. Адмін: усі товари або обраний партнер; партнер: лише свої бренди.
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const dayStartIso = (day) => new Date(`${day}T00:00:00+02:00`).toISOString(); // межа доби за Києвом (з запасом на літній час — нижче)
  async function priceLog(q, partner = null) {
    const to = isDay(q.to) ? q.to : new Date().toISOString().slice(0, 10);
    const from = isDay(q.from) ? q.from : new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);
    const lo = new Date(Date.parse(dayStartIso(from)) - 3600e3).toISOString();
    const hi = new Date(Date.parse(dayStartIso(to)) + 25 * 3600e3).toISOString();
    const names = await brandNames();
    const brand = q.brand !== undefined && q.brand !== '' && Number.isFinite(Number(q.brand)) ? Number(q.brand) : null;
    const search = String(q.q || '').trim().toLowerCase();
    let margins = null;
    let mlog = [];
    if (partner) {
      margins = new Map((await db.all(`SELECT brand_id, margin FROM b2b_margins WHERE partner_id = ?`, [partner.id])).map((m) => [m.brand_id, m.margin]));
      mlog = await db.all(`SELECT at, brand_id, old_margin, new_margin, COALESCE(kind, '') AS kind FROM b2b_margin_log WHERE partner_id = ? ORDER BY id`, [partner.id]);
    }
    // знижка партнера на бренд на момент at: остання зміна до at — її «стало»; інакше перша після — її «було»; інакше поточна
    const marginAt = (brandId, at) => {
      let before = null; let after = null;
      for (const r of mlog) {
        if (r.brand_id !== brandId || r.kind === 'wh') continue;
        if (r.at <= at) before = r; else if (!after) after = r;
      }
      if (before) return before.new_margin;
      if (after) return after.old_margin;
      return margins.has(brandId) ? margins.get(brandId) : null;
    };
    const where = ['l.at >= ?', 'l.at < ?'];
    const params = [lo, hi];
    if (partner) { where.push(`c.brand_id IN (SELECT value FROM json_each(?))`); params.push(JSON.stringify([...margins.keys()])); }
    if (brand !== null) { where.push('c.brand_id = ?'); params.push(brand); }
    if (search) { where.push(`(LOWER(c.name) LIKE ? OR LOWER(c.article) LIKE ? OR CAST(c.product_id AS TEXT) = ?)`); params.push(`%${search}%`, `%${search}%`, search); }
    const rows = await db.all(`SELECT l.id, l.at, l.product_id, l.old_rrp, l.new_rrp, c.name, c.article, c.brand_id, c.hidden
      FROM b2b_price_log l JOIN b2b_catalog c ON c.product_id = l.product_id WHERE ${where.join(' AND ')} ${partner ? 'AND c.hidden = 0' : ''}
      ORDER BY l.at DESC, l.id DESC LIMIT 1001`, params);
    const out = rows.slice(0, 1000).map((r) => {
      const x = { kind: 'rrp', at: r.at, product_id: r.product_id, name: r.name, article: r.article || '', brand: names.get(r.brand_id) || 'Інші', brand_id: r.brand_id,
        old_rrp: r.old_rrp, new_rrp: r.new_rrp, pct: r.old_rrp ? round2(((r.new_rrp - r.old_rrp) / r.old_rrp) * 100) : null };
      if (partner) {
        const m = marginAt(r.brand_id, r.at);
        if (m != null) { x.old_price = partnerPrice(r.old_rrp, m); x.new_price = partnerPrice(r.new_rrp, m); }
      }
      return x;
    });
    // зміни знижки партнера на бренди за період
    const disc = partner ? mlog.filter((r) => r.at >= lo && r.at < hi && (brand === null || r.brand_id === brand) && (!search || low(names.get(r.brand_id)).includes(search)))
      .map((r) => ({ kind: 'margin', at: r.at, brand: `${names.get(r.brand_id) || 'Інші'}${r.kind === 'wh' ? ' — на склад партнера' : ''}`, brand_id: r.brand_id, old_margin: r.old_margin, new_margin: r.new_margin, wh: r.kind === 'wh' })) : [];
    const all = [...out, ...disc].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const brandsList = partner
      ? [...margins.keys()].map((id) => ({ id, name: names.get(id) || 'Інші' }))
      : (await db.all(`SELECT DISTINCT brand_id FROM b2b_catalog WHERE hidden = 0`)).map((r) => ({ id: r.brand_id, name: names.get(r.brand_id) || 'Інші' }));
    return { from, to, rows: all, more: rows.length > 1000, brands: brandsList.sort((a, b) => a.name.localeCompare(b.name, 'uk')) };
  }
  const low = (v) => String(v || '').toLowerCase();
  app.get('/api/b2b/price-log', async (c) => {
    need(c, 'b2b.admin');
    const pid = parseInt(c.req.query('partner'), 10) || 0;
    const partner = pid ? await db.get(`SELECT * FROM b2b_partners WHERE id = ?`, [pid]) : null;
    if (pid && !partner) throw fail(404, 'Партнера не знайдено.');
    return c.json(await priceLog(c.req.query(), partner));
  });
  app.get('/api/b2b/p/price-log', async (c) => {
    const p = await myPartner(c);
    return c.json(await priceLog(c.req.query(), p));
  });

  // Загальна відстрочка підвищення цін, годин (для партнерів без власної; 0 — без відстрочки).
  app.get('/api/b2b/price-grace', async (c) => {
    need(c, 'b2b.admin');
    const g = await db.get(`SELECT value FROM settings WHERE key = 'b2b_price_grace_hours'`);
    const own = await db.all(`SELECT id, name, price_grace_hours FROM b2b_partners WHERE price_grace_hours IS NOT NULL AND COALESCE(deleted_at, '') = '' ORDER BY name`);
    return c.json({ hours: Number(g?.value) || 0, partners: own });
  });
  app.put('/api/b2b/price-grace', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json().catch(() => ({}));
    const hours = Number(b.hours);
    if (!Number.isInteger(hours) || hours < 0 || hours > 720) throw fail(400, 'Відстрочка — ціле число годин від 0 до 720.');
    await db.run(`INSERT INTO settings (key, value) VALUES ('b2b_price_grace_hours', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(hours)]);
    return c.json({ hours });
  });

  // ---------------------------------------------------------------- оголошення партнерам
  // Довільний текст (знижка з такого-то числа тощо): адмін обирає партнерів і куди — у Telegram-групу партнера
  // та/або особисто його користувачам у бот. Клієнт шле по одному партнеру за запит (ліміт підзапитів Cloudflare).
  const ANN_MAX = 3500;
  const annText = (raw) => `📢 ${h(String(raw || '').trim()).slice(0, ANN_MAX)}`;
  app.get('/api/b2b/announce/targets', async (c) => {
    need(c, 'b2b.admin');
    const rows = await db.all(`SELECT p.id, p.name, p.tg_group, p.tg_group_title,
        (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id AND u.role = 'partner' AND u.active = 1 AND u.tg_chat_id != '') AS tg_users
      FROM b2b_partners p WHERE p.active = 1 AND COALESCE(p.deleted_at, '') = '' ORDER BY p.name`);
    return c.json(rows.map((p) => ({ id: p.id, name: p.name, group: p.tg_group ? (p.tg_group_title || 'група') : '', tgUsers: p.tg_users })));
  });
  app.post('/api/b2b/announce', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json().catch(() => ({}));
    const raw = String(b.text || '').trim();
    if (!raw) throw fail(400, 'Напишіть текст оголошення.');
    if (raw.length > ANN_MAX) throw fail(400, `Текст задовгий — до ${ANN_MAX} символів.`);
    if (!b.groups && !b.users) throw fail(400, 'Оберіть, куди надсилати: у групи та/або в бот.');
    const p = await db.get(`SELECT id, name, tg_group FROM b2b_partners WHERE id = ? AND active = 1 AND COALESCE(deleted_at, '') = ''`, [Number(b.partner_id) || 0]);
    if (!p) throw fail(404, 'Партнера не знайдено.');
    const text = annText(raw);
    const group = b.groups && p.tg_group ? (await services.notify?.sendText({ chatIds: [p.tg_group] }, text).catch(() => 0)) || 0 : 0;
    const users = b.users ? (await services.notify?.sendText({ partnerId: p.id }, text).catch(() => 0)) || 0 : 0;
    return c.json({ id: p.id, group, users });
  });
}
