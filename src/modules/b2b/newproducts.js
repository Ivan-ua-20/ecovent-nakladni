// Новинки каталогу: товар, що вперше отримав РРЦ (b2b_catalog.first_priced_at), чекає перевірки адміна.
// Партнерам нічого не надсилається автоматично: адмін переглядає список, обирає товари й натискає «Надіслати»
// (або «Без розсилки»). Після цього товар позначено (announced_at) і партнер 14 днів бачить його як «Новинка».
import { need, fail, nowIso, kyivDay } from '../../core/common.js';
import { PM_JOIN, PM_COLS } from './orders.js';

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nf = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = (n) => nf.format(Number(n) || 0);
const MAX_CHUNK = 3800; // ліміт повідомлення Telegram — 4096
// Ще не надіслані новинки: є РРЦ, не приховані, бренд увімкнено хоча б одному партнеру.
const PENDING = `c.first_priced_at != '' AND c.announced_at = '' AND c.hidden = 0 AND c.rrp > 0
  AND c.brand_id IN (SELECT brand_id FROM b2b_margins)`;

export function mountB2bNewProducts(app, { db, services, partnerPrice, brandNames }) {
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 300);

  // Список на перевірку + кому скільки дістанеться.
  app.get('/api/b2b/new-products', async (c) => {
    need(c, 'b2b.admin');
    const [items, names, partners] = await Promise.all([
      db.all(`SELECT c.product_id, c.name, c.article, c.rrp, c.image, c.brand_id, c.first_priced_at FROM b2b_catalog c WHERE ${PENDING} ORDER BY c.first_priced_at DESC, c.name LIMIT 300`),
      brandNames(),
      db.all(`SELECT p.id, p.name, p.tg_group, p.tg_group_title,
          (SELECT COUNT(*) FROM users u WHERE u.partner_id = p.id AND u.role = 'partner' AND u.active = 1 AND u.tg_chat_id != '') AS tg_users,
          (SELECT GROUP_CONCAT(m.brand_id) FROM b2b_margins m WHERE m.partner_id = p.id) AS brands
        FROM b2b_partners p WHERE p.active = 1 AND COALESCE(p.deleted_at, '') = '' ORDER BY p.name`),
    ]);
    return c.json({
      items: items.map((r) => ({ ...r, brand: names.get(r.brand_id) || 'Інші' })),
      partners: partners.map((p) => {
        const bs = new Set(String(p.brands || '').split(',').filter(Boolean).map(Number));
        return { id: p.id, name: p.name, group: p.tg_group ? (p.tg_group_title || 'група') : '', tgUsers: p.tg_users, brands: [...bs] };
      }).filter((p) => p.brands.length),
    });
  });

  // Надіслати обрані новинки ОДНОМУ партнеру (клієнт іде по партнерах — ліміт підзапитів Cloudflare).
  // Партнер отримує лише товари своїх брендів, зі своєю ціною (маржа бренду або особлива ціна).
  app.post('/api/b2b/new-products/send', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json().catch(() => ({}));
    const list = ids(b.product_ids);
    if (!list.length) throw fail(400, 'Оберіть товари для розсилки.');
    const p = await db.get(`SELECT id, name, tg_group FROM b2b_partners WHERE id = ? AND active = 1 AND COALESCE(deleted_at, '') = ''`, [Number(b.partner_id) || 0]);
    if (!p) throw fail(404, 'Партнера не знайдено.');
    const [rows, names] = await Promise.all([
      db.all(`SELECT c.product_id, c.name, c.article, c.rrp, c.brand_id, ${PM_COLS} FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id ${PM_JOIN}
        WHERE m.partner_id = ? AND c.product_id IN (SELECT value FROM json_each(?)) AND c.hidden = 0 AND c.rrp > 0 ORDER BY c.brand_id, c.name`,
      [kyivDay(), p.id, JSON.stringify(list)]),
      brandNames(),
    ]);
    if (!rows.length) return c.json({ id: p.id, name: p.name, products: 0, sent: 0 });
    const head = `🆕 <b>Нові товари в каталозі</b> — «${h(p.name)}»`;
    const parts = [];
    let cur = head;
    let brand = null;
    for (const r of rows) {
      const line = `${r.brand_id !== brand ? `\n\n<b>${h(names.get(r.brand_id) || 'Інші')}</b>` : ''}\n${h(r.name)}${r.article ? ` (${h(r.article)})` : ''}\n   РРЦ ${m2(r.rrp)} · ваша ціна <b>${m2(partnerPrice(r.rrp, r.margin))}</b> грн`;
      if (cur.length + line.length > MAX_CHUNK) { parts.push(cur); cur = `${head} (продовження)`; brand = null; }
      cur += line;
      brand = r.brand_id;
    }
    parts.push(`${cur}\n\nЗамовити можна в каталозі вашого кабінету.`);
    const to = p.tg_group ? { chatIds: [p.tg_group] } : { partnerId: p.id };
    let sent = 0;
    for (const text of parts) sent += (await services.notify?.sendText(to, text).catch(() => 0)) || 0;
    return c.json({ id: p.id, name: p.name, products: rows.length, sent, where: p.tg_group ? 'group' : 'users' });
  });

  // Позначити як оголошені (після розсилки — або «Без розсилки»): більше не в списку, партнер бачить «Новинка».
  app.post('/api/b2b/new-products/mark', async (c) => {
    need(c, 'b2b.admin');
    const list = ids((await c.req.json().catch(() => ({}))).product_ids);
    if (!list.length) throw fail(400, 'Оберіть товари.');
    const r = await db.run(`UPDATE b2b_catalog SET announced_at = ? WHERE announced_at = '' AND product_id IN (SELECT value FROM json_each(?))`, [nowIso(), JSON.stringify(list)]);
    return c.json({ marked: r.changes || 0 });
  });

  // Для черги «Потребує дій».
  async function attention() {
    const r = await db.get(`SELECT COUNT(*) AS n FROM b2b_catalog c WHERE ${PENDING}`);
    return r?.n ? [{ key: 'b2b_newprod', level: 'info', count: r.n, label: 'Нові товари в каталозі — перевірити й надіслати партнерам', link: '#/b2bcatalog' }] : [];
  }

  return { attention };
}
