// Фіди й таблиці партнера — лише довідка: «ось тут XML-фід / Google-таблиця / прайс».
// Товари й ціни сайт усе одно бере з LP-CRM; посилання ні імпортуємо, ні проксюємо — партнер просто бачить і копіює.
// partner_id = 0 — посилання для всіх партнерів.
import { fail, need, nowIso } from '../../core/common.js';

export const FEED_KIND = { xml: 'XML-фід', gsheet: 'Google-таблиця', csv: 'CSV / Excel', other: 'Посилання' };
export const feedKindOf = (url) => {
  const u = String(url || '').toLowerCase();
  if (/docs\.google\.com\/spreadsheets|sheets\.google\.com/.test(u)) return 'gsheet';
  if (/\.(xml|yml)(\?|#|$)|[?&](format|type)=(xml|yml)|\/(feed|yml|xml)(\/|\?|$)/.test(u)) return 'xml';
  if (/\.(csv|xlsx?)(\?|#|$)|format=(csv|xlsx)/.test(u)) return 'csv';
  return 'other';
};
const userName = (u) => u?.name || u?.login || '';
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function mountB2bFeeds(app, { db, myPartner, tgPartner, tgGroup, link }) {
  const feedIn = (b) => {
    const url = String(b.url || '').trim();
    if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url) || url.length > 1000) throw fail(400, 'Вкажіть посилання, що починається з https://');
    const title = String(b.title || '').trim().slice(0, 120);
    const kind = FEED_KIND[b.kind] ? b.kind : feedKindOf(url);
    return { url, kind, title: title || FEED_KIND[kind], note: String(b.note || '').trim().slice(0, 500) };
  };
  const COLS = 'id, partner_id, title, kind, url, note, created_by, created_at, updated_at';
  const list = (partnerId) => db.all(`SELECT ${COLS} FROM b2b_feeds WHERE active = 1 AND partner_id IN (0, ?) ORDER BY partner_id DESC, sort, id`, [partnerId]);

  async function notify(c, partnerId, f, verb) {
    const text = `🔗 <b>${verb}: ${h(f.title)}</b> (${FEED_KIND[f.kind]})\n${h(f.url)}${f.note ? `\n${h(f.note)}` : ''}\n\nУсі посилання — у кабінеті, вкладка «Каталог».\n${link(c, 'pcatalog')}`;
    const ids = partnerId ? [partnerId] : (await db.all(`SELECT id FROM b2b_partners WHERE active = 1`)).map((r) => r.id);
    for (const id of ids) { await tgPartner(id, text); await tgGroup(id, text); }
    return ids.length;
  }

  // ---------- партнер
  app.get('/api/b2b/p/feeds', async (c) => {
    const p = await myPartner(c);
    return c.json((await list(p.id)).map(({ created_by, partner_id, ...f }) => ({ ...f, common: !partner_id })));
  });

  // ---------- адмін: посилання партнера + спільні
  app.get('/api/b2b/partners/:id/feeds', async (c) => {
    need(c, 'b2b.view');
    return c.json(await list(Number(c.req.param('id')) || 0));
  });
  app.post('/api/b2b/partners/:id/feeds', async (c) => {
    need(c, 'b2b.admin');
    const b = await c.req.json();
    const pid = b.common ? 0 : Number(c.req.param('id'));
    if (pid && !(await db.get(`SELECT id FROM b2b_partners WHERE id = ?`, [pid]))) throw fail(404, 'Партнера не знайдено.');
    if ((await db.get(`SELECT COUNT(*) AS n FROM b2b_feeds WHERE active = 1 AND partner_id = ?`, [pid])).n >= 30) throw fail(400, 'Уже 30 посилань — приберіть зайві.');
    const f = feedIn(b);
    const now = nowIso();
    const r = await db.run(`INSERT INTO b2b_feeds (partner_id, title, kind, url, note, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [pid, f.title, f.kind, f.url, f.note, userName(c.get('user')), now, now]);
    const sent = b.notify ? await notify(c, pid, f, 'Нове посилання') : 0;
    return c.json({ id: r.lastId, sent });
  });
  app.put('/api/b2b/feeds/:id', async (c) => {
    need(c, 'b2b.admin');
    const old = await db.get(`SELECT * FROM b2b_feeds WHERE id = ? AND active = 1`, [c.req.param('id')]);
    if (!old) throw fail(404, 'Посилання не знайдено.');
    const b = await c.req.json();
    const f = feedIn(b);
    await db.run(`UPDATE b2b_feeds SET title = ?, kind = ?, url = ?, note = ?, updated_at = ? WHERE id = ?`, [f.title, f.kind, f.url, f.note, nowIso(), old.id]);
    const sent = b.notify ? await notify(c, old.partner_id, f, 'Оновлено посилання') : 0;
    return c.json({ ok: true, sent });
  });
  app.delete('/api/b2b/feeds/:id', async (c) => {
    need(c, 'b2b.admin');
    const r = await db.run(`UPDATE b2b_feeds SET active = 0, updated_at = ? WHERE id = ? AND active = 1`, [nowIso(), c.req.param('id')]);
    if (!r.changes) throw fail(404, 'Посилання не знайдено.');
    return c.json({ ok: true });
  });
}
