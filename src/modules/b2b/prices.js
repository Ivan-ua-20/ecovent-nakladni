// «Надіслати зміни цін»: адмін натискає кнопку — кожному партнеру, у кого щось змінилося з минулої розсилки,
// бот надсилає зведення в Telegram-групу партнера (якщо не прив'язана — його користувачам особисто):
// нові РРЦ і нові ціни партнера по товарах, зміни знижки на бренди, відкриті й закриті бренди.
// Лише вручну (без розкладу). Після успішного надсилання запам'ятовується час (b2b_partners.prices_sent_at).
import { need, nowIso, round2 } from '../../core/common.js';

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nf = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = (n) => nf.format(Number(n) || 0);
const pct = (v) => `${String(round2(v)).replace('.', ',')}%`;
const arrow = (a, b) => (b > a ? '▲' : b < a ? '▼' : '');
const MAX_CHUNK = 3800; // ліміт повідомлення Telegram — 4096
const MAX_CHUNKS = 6;

export function mountB2bPrices(app, { db, services, partnerPrice }) {
  async function brandNames() {
    const rows = await db.all(`SELECT id, name FROM an_brands`).catch(() => []);
    return new Map([...rows.map((r) => [r.id, r.name]), [0, 'Інші']]);
  }

  // Що змінилося для партнера з минулої розсилки.
  async function changesOf(p, names) {
    const since = p.prices_sent_at || p.created_at || '';
    const [margins, mlog] = await Promise.all([
      db.all(`SELECT brand_id, margin FROM b2b_margins WHERE partner_id = ?`, [p.id]),
      db.all(`SELECT brand_id, old_margin, new_margin FROM b2b_margin_log WHERE partner_id = ? AND at > ? ORDER BY id`, [p.id, since]),
    ]);
    const cur = new Map(margins.map((m) => [m.brand_id, m.margin]));
    // знижки: перше «було» і поточне «стало» за брендом
    const firstOld = new Map();
    for (const r of mlog) if (!firstOld.has(r.brand_id)) firstOld.set(r.brand_id, r.old_margin);
    const opened = [];
    const closed = [];
    const marginChanged = [];
    for (const [brand, old] of firstOld) {
      const now = cur.has(brand) ? cur.get(brand) : null;
      if (old == null && now != null) opened.push({ brand, name: names.get(brand) || 'Інші', margin: now });
      else if (old != null && now == null) closed.push({ brand, name: names.get(brand) || 'Інші' });
      else if (old != null && now != null && round2(old) !== round2(now)) marginChanged.push({ brand, name: names.get(brand) || 'Інші', old, now });
    }
    const oldMargin = (brand) => {
      const mc = marginChanged.find((x) => x.brand === brand);
      return mc ? mc.old : cur.get(brand);
    };
    // товари: зміна РРЦ (журнал) і всі товари брендів зі зміненою знижкою (крім щойно відкритих)
    const brands = [...cur.keys()].filter((b) => !opened.some((o) => o.brand === b));
    if (!brands.length) return { since, opened, closed, marginChanged, products: [] };
    const plog = await db.all(
      `SELECT l.product_id, l.old_rrp FROM b2b_price_log l JOIN b2b_catalog c ON c.product_id = l.product_id
       WHERE l.at > ? AND c.hidden = 0 AND c.brand_id IN (SELECT value FROM json_each(?)) ORDER BY l.id`, [since, JSON.stringify(brands)],
    );
    const oldRrp = new Map();
    for (const r of plog) if (!oldRrp.has(r.product_id)) oldRrp.set(r.product_id, r.old_rrp);
    const mcBrands = marginChanged.map((x) => x.brand);
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
      if (round2(o) === round2(r.rrp) && oldPrice === newPrice) continue;
      products.push({ id: r.product_id, name: r.name, article: r.article, brand: names.get(r.brand_id) || 'Інші', oldRrp: o, newRrp: r.rrp, oldPrice, newPrice });
    }
    return { since, opened, closed, marginChanged, products };
  }

  const empty = (ch) => !ch.products.length && !ch.opened.length && !ch.closed.length && !ch.marginChanged.length;

  // Повідомлення (частинами до ~3800 символів).
  function messages(p, ch) {
    const head = `💲 <b>Зміна цін</b> — «${h(p.name)}»`;
    const blocks = [];
    if (ch.marginChanged.length) blocks.push(`<b>Ваша знижка від РРЦ:</b>\n${ch.marginChanged.map((x) => `${h(x.name)}: ${pct(x.old)} → <b>${pct(x.now)}</b>`).join('\n')}`);
    if (ch.opened.length) blocks.push(`<b>Нові бренди для вас:</b>\n${ch.opened.map((x) => `${h(x.name)} — знижка ${pct(x.margin)} від РРЦ (товари — у каталозі)`).join('\n')}`);
    if (ch.closed.length) blocks.push(`<b>Більше недоступні:</b> ${ch.closed.map((x) => h(x.name)).join(', ')}`);
    const lines = ch.products.map((x) => `${h(x.name)}${x.article ? ` (${h(x.article)})` : ''}\n`
      + `   РРЦ ${m2(x.oldRrp)} → <b>${m2(x.newRrp)}</b> ${arrow(x.oldRrp, x.newRrp)} · ваша ціна ${m2(x.oldPrice)} → <b>${m2(x.newPrice)}</b> грн ${arrow(x.oldPrice, x.newPrice)}`);
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
      id: p.id, name: p.name, since: ch.since, products: ch.products.length, brands: ch.marginChanged.length + ch.opened.length + ch.closed.length,
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
}
