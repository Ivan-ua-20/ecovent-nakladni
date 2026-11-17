// «Новини» для B2B партнерів: статті з текстом, фото, відео (YouTube / Vimeo / Google Диск або файлом), файлами й
// товарами з каталогу. Адмін (b2b.admin) пише й публікує (одразу або на час), партнер бачить у кабінеті «Новини».
// Після публікації — повідомлення з посиланням у Telegram-групу кожного партнера (немає групи — користувачам партнера).
// Файли: до 5 МБ — частинами в D1; більші (відео) — у сховищі Cloudflare R2 (binding FILES), якщо його підключено.
import { fail, need, nowIso, kyivDay } from '../../core/common.js';
import { PM_JOIN, PM_COLS } from './orders.js';

export const NEWS_CATS = { products: 'Новинки товарів', promo: 'Акції та ціни', guide: 'Інструкції', video: 'Відео', other: 'Інше' };
const MAX_D1 = 5 * 1024 * 1024;
const MAX_R2 = 100 * 1024 * 1024;
const PART = 600 * 1024;
const SEND_PER_CALL = 20; // партнерів за одне звернення (кожне повідомлення — зовнішній запит)
const J = (a) => JSON.stringify(a);
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const parseJson = (s, d) => { try { return JSON.parse(s || '') ?? d; } catch { return d; } };

// Текст статті — HTML з редактора, лише дозволені теги (без атрибутів, крім href у посиланнях http/https).
const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'div']);
export function cleanHtml(input) {
  const src = String(input ?? '').slice(0, 100000).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|template)[\s\S]*?<\/\1\s*>/gi, '');
  let out = '';
  let last = 0;
  const text = (t) => t.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;');
  for (const m of src.matchAll(/<(\/?)([a-z][a-z0-9]*)((?:\s[^>]*)?)\/?>/gi)) {
    out += text(src.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    const t = tag === 'div' ? 'p' : tag === 'strong' ? 'b' : tag === 'em' ? 'i' : tag;
    if (m[1]) { if (t !== 'br') out += `</${t}>`; continue; }
    if (t === 'a') {
      const href = (m[3].match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i) || [])[2] ?? (m[3].match(/href\s*=\s*'([^']*)'/i) || [])[1] ?? '';
      const url = href.replace(/&amp;/g, '&').trim();
      out += /^https?:\/\//i.test(url) ? `<a href="${h(url).replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">` : '<a>';
      continue;
    }
    out += `<${t}>`;
  }
  out += text(src.slice(last));
  return out;
}

// Посилання на відео → вбудований плеєр (YouTube без реклами-cookie, Vimeo, Google Диск); інше — просто посилання.
export function videoEmbed(url) {
  const u = String(url || '').trim();
  let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  if (m) return { kind: 'youtube', id: m[1], embed: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`, thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/i);
  if (m) return { kind: 'vimeo', id: m[1], embed: `https://player.vimeo.com/video/${m[1]}`, thumb: '' };
  m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]{20,})/i);
  if (m) return { kind: 'gdrive', id: m[1], embed: `https://drive.google.com/file/d/${m[1]}/preview`, thumb: '' };
  return /^https?:\/\//i.test(u) ? { kind: 'link', id: '', embed: '', thumb: '', url: u } : null;
}

// Блоки статті: text { html } · image { file, caption } · video { url | file, caption } · file { file } · product { product_id }.
export function cleanBlocks(list) {
  const out = [];
  for (const b of (Array.isArray(list) ? list : []).slice(0, 200)) {
    const caption = str(b?.caption, 300);
    if (b?.t === 'text') { const html = cleanHtml(b.html); if (html.replace(/<[^>]+>|&nbsp;|\s/g, '')) out.push({ t: 'text', html }); }
    else if (b?.t === 'image' && Number(b.file)) out.push({ t: 'image', file: Number(b.file), caption });
    else if (b?.t === 'video' && Number(b.file)) out.push({ t: 'video', file: Number(b.file), caption });
    else if (b?.t === 'video' && b.url) {
      const v = videoEmbed(b.url);
      if (!v) throw fail(400, 'Посилання на відео має починатися з https:// (YouTube, Vimeo, Google Диск).');
      out.push({ t: 'video', url: str(b.url, 500), caption });
    } else if (b?.t === 'file' && Number(b.file)) out.push({ t: 'file', file: Number(b.file), caption });
    else if (b?.t === 'product' && Number(b.product_id)) out.push({ t: 'product', product_id: Number(b.product_id) });
  }
  return out;
}

export function mountB2bNews(app, { db, fetchFn = fetch, services = {}, myPartner, partnerPrice, brandNames, onCron = () => {} }) {
  const userName = (c) => { const u = c.get('user'); return str(u?.name || u?.login, 80); };
  const origin = async (c) => {
    if (c) {
      const o = new URL(c.req.url).origin;
      if (!/localhost|127\.0\.0\.1/.test(o)) await db.run(`INSERT INTO settings (key, value) VALUES ('b2b_site_origin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [o]).catch(() => 0);
      return o;
    }
    return (await db.get(`SELECT value FROM settings WHERE key = 'b2b_site_origin'`).catch(() => null))?.value || '';
  };
  const audienceOf = (n) => parseJson(n.audience, []).map(Number).filter(Boolean);
  const VISIBLE = `n.status = 'published' AND n.publish_at <= ? AND n.deleted_at = ''
    AND (n.audience = '' OR n.audience = '[]' OR EXISTS (SELECT 1 FROM json_each(n.audience) WHERE CAST(value AS INTEGER) = ?))`;
  const get = async (id) => {
    const n = await db.get(`SELECT * FROM b2b_news WHERE id = ? AND deleted_at = ''`, [Number(id) || 0]);
    if (!n) throw fail(404, 'Новину не знайдено (можливо, її видалено).');
    return n;
  };
  // Партнерам доступні лише шляхи /api/b2b/p/… — їм файли віддаються звідти.
  const fileUrl = (id, partner = false) => `/api/b2b/${partner ? 'p/' : ''}news/files/${id}`;
  const out = (n, files = new Map(), partner = false) => ({
    id: n.id, title: n.title, summary: n.summary, category: n.category, category_name: NEWS_CATS[n.category] || NEWS_CATS.other,
    brands: parseJson(n.brands, []), cover: n.cover || null, cover_url: n.cover ? fileUrl(n.cover, partner) : n.cover_url || '',
    pinned: Boolean(n.pinned), tg: Boolean(n.tg), status: n.status, publish_at: n.publish_at, notified_at: n.notified_at,
    audience: audienceOf(n), created_by: n.created_by, created_at: n.created_at, updated_by: n.updated_by, updated_at: n.updated_at,
    body: parseJson(n.body, []).map((b) => {
      const f = b.file ? files.get(b.file) : null;
      const v = b.t === 'video' && b.url ? videoEmbed(b.url) : null;
      return { ...b, ...(f ? { name: f.name, mime: f.mime, size: f.size, src: fileUrl(f.id, partner) } : {}), ...(v ? { embed: v.embed, kind: v.kind, thumb: v.thumb } : {}) };
    }),
  });
  const filesOf = async (n) => {
    const ids = parseJson(n.body, []).map((b) => b.file).filter(Boolean);
    if (!ids.length) return new Map();
    return new Map((await db.all(`SELECT id, name, mime, size FROM b2b_news_files WHERE id IN (SELECT value FROM json_each(?))`, [J(ids)])).map((f) => [f.id, f]));
  };
  // Обкладинка картки: своя → фото з тексту → кадр YouTube.
  const coverOf = (n, partner = false) => {
    if (n.cover) return fileUrl(n.cover, partner);
    if (n.cover_url) return n.cover_url;
    const body = parseJson(n.body, []);
    const img = body.find((b) => b.t === 'image');
    if (img) return fileUrl(img.file, partner);
    const v = body.map((b) => (b.t === 'video' && b.url ? videoEmbed(b.url) : null)).find((x) => x?.thumb);
    return v?.thumb || '';
  };
  const hasVideo = (n) => parseJson(n.body, []).some((b) => b.t === 'video');
  const readMinutes = (n) => Math.max(1, Math.round(parseJson(n.body, []).filter((b) => b.t === 'text').map((b) => b.html.replace(/<[^>]+>/g, ' ')).join(' ').split(/\s+/).filter(Boolean).length / 180));
  const partnersOf = async (n) => {
    const aud = audienceOf(n);
    return db.all(`SELECT id, name, tg_group, tg_group_title FROM b2b_partners WHERE active = 1 AND COALESCE(deleted_at, '') = ''
      ${aud.length ? 'AND id IN (SELECT value FROM json_each(?))' : ''} ORDER BY name`, aud.length ? [J(aud)] : []);
  };

  // ---------- адмін ----------
  app.get('/api/b2b/news', async (c) => {
    need(c, 'b2b.view');
    const [rows, reads, partners] = await Promise.all([
      db.all(`SELECT id, title, summary, category, brands, cover, cover_url, body, audience, pinned, tg, status, publish_at, notified_at, created_by, created_at, updated_by, updated_at
        FROM b2b_news WHERE deleted_at = '' ORDER BY CASE status WHEN 'draft' THEN 0 ELSE 1 END, publish_at DESC, id DESC LIMIT 300`),
      db.all(`SELECT news_id, COUNT(*) AS n FROM b2b_news_reads GROUP BY news_id`),
      db.get(`SELECT COUNT(*) AS n FROM b2b_partners WHERE active = 1 AND COALESCE(deleted_at, '') = ''`),
    ]);
    const rd = new Map(reads.map((r) => [r.news_id, r.n]));
    const now = nowIso();
    return c.json({
      partners: partners?.n || 0, cats: NEWS_CATS,
      rows: rows.map((n) => ({ id: n.id, title: n.title, category: n.category, status: n.status === 'published' && n.publish_at > now ? 'planned' : n.status,
        publish_at: n.publish_at, pinned: Boolean(n.pinned), audience: audienceOf(n).length, reads: rd.get(n.id) || 0, cover_url: coverOf(n), updated_at: n.updated_at, created_by: n.created_by, notified_at: n.notified_at, tg: Boolean(n.tg) })),
    });
  });
  app.get('/api/b2b/news/meta', async (c) => {
    need(c, 'b2b.view');
    const [names, partners] = await Promise.all([brandNames(), db.all(`SELECT id, name, tg_group_title FROM b2b_partners WHERE active = 1 AND COALESCE(deleted_at, '') = '' ORDER BY name`)]);
    return c.json({ cats: NEWS_CATS, brands: [...names].filter(([id]) => id).map(([id, name]) => ({ id, name })), partners: partners.map((p) => ({ id: p.id, name: p.name, group: Boolean(p.tg_group_title) })),
      maxFile: c.env?.FILES ? MAX_R2 : MAX_D1, r2: Boolean(c.env?.FILES) });
  });
  app.get('/api/b2b/news/:id{[0-9]+}', async (c) => {
    need(c, 'b2b.view');
    const n = await get(c.req.param('id'));
    const [files, reads, partners, sent] = await Promise.all([filesOf(n), db.all(`SELECT r.partner_id, r.at, u.name AS user FROM b2b_news_reads r LEFT JOIN users u ON u.id = r.user_id WHERE r.news_id = ?`, [n.id]),
      partnersOf(n), db.all(`SELECT partner_id, sent FROM b2b_news_sent WHERE news_id = ?`, [n.id])]);
    const rd = new Map(reads.map((r) => [r.partner_id, r]));
    const sd = new Map(sent.map((r) => [r.partner_id, r.sent]));
    return c.json({ ...out(n, files), products: await productsFor(n, null), sent: { ok: sent.filter((r) => r.sent).length, total: sent.length },
      reads: partners.map((p) => ({ id: p.id, name: p.name, at: rd.get(p.id)?.at || '', user: rd.get(p.id)?.user || '', tg: sd.has(p.id) ? (sd.get(p.id) ? 'ok' : 'none') : '' })) });
  });
  const fields = (b) => {
    const cat = NEWS_CATS[b.category] ? b.category : 'other';
    return {
      title: str(b.title, 200), summary: str(b.summary, 600), category: cat,
      brands: J([...new Set((Array.isArray(b.brands) ? b.brands : []).map(Number).filter((x) => x > 0))].slice(0, 20)),
      cover: Number(b.cover) || null, cover_url: /^https:\/\//.test(String(b.cover_url || '')) ? str(b.cover_url, 500) : '',
      body: J(cleanBlocks(b.body)), audience: (Array.isArray(b.audience) && b.audience.length) ? J([...new Set(b.audience.map(Number).filter(Boolean))]) : '',
      pinned: b.pinned ? 1 : 0, tg: b.tg === false ? 0 : 1,
    };
  };
  app.post('/api/b2b/news', async (c) => {
    need(c, 'b2b.admin');
    const f = fields(await c.req.json().catch(() => ({})));
    const at = nowIso();
    const r = await db.run(`INSERT INTO b2b_news (title, summary, category, brands, cover, cover_url, body, audience, pinned, tg, status, created_by, created_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [f.title, f.summary, f.category, f.brands, f.cover, f.cover_url, f.body, f.audience, f.pinned, f.tg, userName(c), at, userName(c), at]);
    return c.json({ id: r.lastId });
  });
  app.put('/api/b2b/news/:id{[0-9]+}', async (c) => {
    need(c, 'b2b.admin');
    const n = await get(c.req.param('id'));
    const f = fields(await c.req.json().catch(() => ({})));
    await db.run(`UPDATE b2b_news SET title = ?, summary = ?, category = ?, brands = ?, cover = ?, cover_url = ?, body = ?, audience = ?, pinned = ?, tg = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
      [f.title, f.summary, f.category, f.brands, f.cover, f.cover_url, f.body, f.audience, f.pinned, f.tg, userName(c), nowIso(), n.id]);
    return c.json({ ok: true, updated_at: nowIso() });
  });
  // Опублікувати одразу або на час (at — ISO у майбутньому). Сповіщення в Telegram — notify (одразу) або фоном у час публікації.
  app.post('/api/b2b/news/:id{[0-9]+}/publish', async (c) => {
    need(c, 'b2b.admin');
    const n = await get(c.req.param('id'));
    const b = await c.req.json().catch(() => ({}));
    if (!n.title.trim()) throw fail(400, 'Додайте заголовок новини.');
    if (!parseJson(n.body, []).length && !n.summary.trim()) throw fail(400, 'Новина порожня — додайте текст, фото чи відео.');
    const now = nowIso();
    let at = now;
    if (b.at) {
      const t = Date.parse(b.at);
      if (!Number.isFinite(t)) throw fail(400, 'Невірна дата публікації.');
      at = new Date(Math.max(t, Date.now())).toISOString();
    }
    await origin(c);
    await db.run(`UPDATE b2b_news SET status = 'published', publish_at = ?, notified_at = CASE WHEN status = 'published' THEN notified_at ELSE '' END, updated_by = ?, updated_at = ? WHERE id = ?`,
      [n.status === 'published' && !b.at ? n.publish_at || at : at, userName(c), now, n.id]);
    return c.json({ ok: true, publish_at: at, planned: at > now });
  });
  app.post('/api/b2b/news/:id{[0-9]+}/unpublish', async (c) => {
    need(c, 'b2b.admin');
    const n = await get(c.req.param('id'));
    await db.run(`UPDATE b2b_news SET status = 'draft', updated_by = ?, updated_at = ? WHERE id = ?`, [userName(c), nowIso(), n.id]);
    return c.json({ ok: true });
  });
  app.delete('/api/b2b/news/:id{[0-9]+}', async (c) => {
    need(c, 'b2b.admin');
    const n = await get(c.req.param('id'));
    await db.run(`UPDATE b2b_news SET deleted_at = ?, updated_by = ? WHERE id = ?`, [nowIso(), userName(c), n.id]);
    return c.json({ ok: true });
  });

  // ---------- Telegram: група кожного партнера, порціями ----------
  async function notifyStep(n, base) {
    if (!services.notify?.sendText) return { sent: 0, done: 0, total: 0, more: false, error: 'Telegram не підключено' };
    const partners = await partnersOf(n);
    const done = new Set((await db.all(`SELECT partner_id FROM b2b_news_sent WHERE news_id = ?`, [n.id])).map((r) => r.partner_id));
    const todo = partners.filter((p) => !done.has(p.id)).slice(0, SEND_PER_CALL);
    const link = base ? `${base}/#/pnews/${n.id}` : '';
    const text = [`📰 <b>Новина від Ековент</b>${n.category && NEWS_CATS[n.category] ? ` · ${h(NEWS_CATS[n.category])}` : ''}`, '', `<b>${h(n.title)}</b>`,
      n.summary ? h(n.summary) : '', link ? `\n<a href="${h(link)}">Читати в кабінеті партнера →</a>` : ''].filter((x) => x !== '').join('\n');
    let sent = 0;
    for (const p of todo) {
      const claim = await db.run(`INSERT OR IGNORE INTO b2b_news_sent (news_id, partner_id, sent, at) VALUES (?, ?, 0, ?)`, [n.id, p.id, nowIso()]);
      if (!claim.changes) continue; // уже надсилає інше звернення (фонова задача)
      const k = (await services.notify.sendText(p.tg_group ? { chatIds: [p.tg_group] } : { partnerId: p.id }, text).catch((e) => { if (e.pending) throw e; return 0; })) || 0;
      if (k) { sent++; await db.run(`UPDATE b2b_news_sent SET sent = ? WHERE news_id = ? AND partner_id = ?`, [k, n.id, p.id]); }
    }
    const left = partners.length - done.size - todo.length;
    if (left <= 0) await db.run(`UPDATE b2b_news SET notified_at = ? WHERE id = ? AND notified_at = ''`, [nowIso(), n.id]);
    return { sent, done: done.size + todo.length, total: partners.length, more: left > 0 };
  }
  app.post('/api/b2b/news/:id{[0-9]+}/notify', async (c) => {
    need(c, 'b2b.admin');
    const n = await get(c.req.param('id'));
    if (n.status !== 'published' || n.publish_at > nowIso()) throw fail(400, 'Сповістити можна після публікації.');
    return c.json(await notifyStep(n, await origin(c)));
  });
  app.get('/api/b2b/news/:id{[0-9]+}/sent', async (c) => {
    need(c, 'b2b.view');
    const n = await get(c.req.param('id'));
    const rows = await db.all(`SELECT partner_id, sent, at FROM b2b_news_sent WHERE news_id = ?`, [n.id]);
    return c.json({ rows });
  });
  // Заплановані новини: сповістити, коли настав час публікації.
  onCron('b2b-news', 'B2B «Новини»: сповіщення партнерів у Telegram про заплановані новини', async () => {
    const n = await db.get(`SELECT * FROM b2b_news WHERE status = 'published' AND deleted_at = '' AND tg = 1 AND notified_at = '' AND publish_at <= ? ORDER BY publish_at LIMIT 1`, [nowIso()]);
    if (!n) return { skipped: 'немає новин для розсилки' };
    return { id: n.id, ...await notifyStep(n, await origin(null)) };
  });

  // ---------- файли ----------
  app.post('/api/b2b/news/files', async (c) => {
    need(c, 'b2b.admin');
    const name = str(c.req.query('name') || 'file', 150).replace(/[\\/:*?"<>|\r\n]+/g, '_') || 'file';
    const mime = str(c.req.header('Content-Type') || 'application/octet-stream', 100);
    const len = Number(c.req.header('Content-Length')) || 0;
    const bucket = c.env?.FILES;
    if (len > MAX_D1 && !bucket) throw fail(400, 'Файли понад 5 МБ (відео) можна завантажити, коли підключено сховище R2. Поки що додайте відео посиланням на YouTube, Vimeo чи Google Диск.');
    if (len > MAX_R2) throw fail(400, 'Файл завеликий — до 100 МБ. Велике відео краще завантажити на YouTube і додати посиланням.');
    const at = nowIso();
    if (bucket && len > MAX_D1) {
      const r = await db.run(`INSERT INTO b2b_news_files (name, mime, size, store, parts, created_by, created_at) VALUES (?, ?, ?, 'r2', 0, ?, ?)`, [name, mime, len, userName(c), at]);
      try { await bucket.put(`news/${r.lastId}`, c.req.raw.body, { httpMetadata: { contentType: mime } }); }
      catch (e) { await db.run(`DELETE FROM b2b_news_files WHERE id = ?`, [r.lastId]); throw fail(502, `Не вдалося зберегти файл: ${e.message}`); }
      return c.json({ id: r.lastId, name, mime, size: len, src: fileUrl(r.lastId) });
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes.length) throw fail(400, 'Порожній файл.');
    if (bytes.length > MAX_D1 && !bucket) throw fail(400, 'Файл більший за 5 МБ.');
    const parts = Math.ceil(bytes.length / PART);
    const r = await db.run(`INSERT INTO b2b_news_files (name, mime, size, store, parts, created_by, created_at) VALUES (?, ?, ?, 'd1', ?, ?, ?)`, [name, mime, bytes.length, parts, userName(c), at]);
    const st = [];
    for (let i = 0; i < parts; i++) st.push([`INSERT INTO b2b_news_file_parts (file_id, n, data) VALUES (?, ?, ?)`, [r.lastId, i, toB64(bytes.subarray(i * PART, (i + 1) * PART))]]);
    await db.batch(st);
    return c.json({ id: r.lastId, name, mime, size: bytes.length, src: fileUrl(r.lastId) });
  });
  // Фото за посиланням: сервер завантажує картинку (https, лише зображення до 5 МБ) і зберігає як файл новини.
  app.post('/api/b2b/news/files/url', async (c) => {
    need(c, 'b2b.admin');
    const url = str((await c.req.json().catch(() => ({}))).url, 1000);
    let u;
    try { u = new URL(url); } catch { throw fail(400, 'Вставте посилання на фото (https://…).'); }
    if (u.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) throw fail(400, 'Посилання на фото має починатися з https://.');
    let res;
    try { res = await fetchFn(u.href, { headers: { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0 (EcoventNews)' } }); }
    catch (e) { if (e.pending) throw e; throw fail(502, 'Не вдалося завантажити фото за посиланням — перевірте адресу.'); }
    const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok) throw fail(400, `Сайт не віддав фото (помилка ${res.status}).`);
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/.test(mime)) throw fail(400, 'За посиланням не фото (потрібно JPG, PNG, WEBP або GIF).');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_D1) throw fail(400, 'Фото більше за 5 МБ — оберіть менше (наприклад, версію 800×800).');
    const ext = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg' }[mime] || mime.split('/')[1];
    const name = (decodeURIComponent(u.pathname.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120) || 'photo') + `.${ext}`;
    const parts = Math.ceil(bytes.length / PART);
    const r = await db.run(`INSERT INTO b2b_news_files (name, mime, size, store, parts, created_by, created_at) VALUES (?, ?, ?, 'd1', ?, ?, ?)`, [name, mime, bytes.length, parts, userName(c), nowIso()]);
    const st = [];
    for (let i = 0; i < parts; i++) st.push([`INSERT INTO b2b_news_file_parts (file_id, n, data) VALUES (?, ?, ?)`, [r.lastId, i, toB64(bytes.subarray(i * PART, (i + 1) * PART))]]);
    await db.batch(st);
    return c.json({ id: r.lastId, name, mime, size: bytes.length, src: fileUrl(r.lastId) });
  });
  // Віддати файл (з підтримкою Range — щоб відео можна було перемотувати).
  app.get('/api/b2b/news/files/:id{[0-9]+}', async (c) => { need(c, 'b2b.view'); return serveFile(c); });
  app.get('/api/b2b/p/news/files/:id{[0-9]+}', async (c) => { await myPartner(c); return serveFile(c); });
  async function serveFile(c) {
    const f = await db.get(`SELECT * FROM b2b_news_files WHERE id = ?`, [Number(c.req.param('id'))]);
    if (!f) throw fail(404, 'Файл не знайдено.');
    // У браузері відкриваються лише фото, відео, аудіо й PDF; решта (HTML, SVG тощо) — тільки завантаженням, щоб файл не виконався як сторінка сайту.
    const safe = /^(image\/(png|jpe?g|gif|webp|avif)|video\/|audio\/|application\/pdf$)/i.test(f.mime || '');
    const head = { 'Content-Type': safe ? f.mime : 'application/octet-stream', 'Content-Disposition': `${c.req.query('dl') || !safe ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'Cache-Control': 'private, max-age=86400', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
    const range = String(c.req.header('Range') || '').match(/bytes=(\d*)-(\d*)/);
    if (f.store === 'r2') {
      const bucket = c.env?.FILES;
      if (!bucket) throw fail(410, 'Сховище файлів R2 не підключено.');
      const obj = await bucket.get(`news/${f.id}`, range ? { range: c.req.raw.headers } : undefined);
      if (!obj) throw fail(404, 'Файл не знайдено у сховищі.');
      if (range && obj.range) {
        const off = obj.range.offset ?? 0;
        const len = obj.range.length ?? (f.size - off);
        return new Response(obj.body, { status: 206, headers: { ...head, 'Content-Range': `bytes ${off}-${off + len - 1}/${f.size}`, 'Content-Length': String(len) } });
      }
      return new Response(obj.body, { headers: { ...head, 'Content-Length': String(f.size) } });
    }
    const parts = await db.all(`SELECT data FROM b2b_news_file_parts WHERE file_id = ? ORDER BY n`, [f.id]);
    const chunks = parts.map((p) => fromB64(p.data));
    const all = new Uint8Array(chunks.reduce((t, x) => t + x.length, 0));
    let off = 0;
    for (const ch of chunks) { all.set(ch, off); off += ch.length; }
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, all.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), all.length - 1) : all.length - 1;
      if (start >= all.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${all.length}` } });
      return new Response(all.subarray(start, end + 1), { status: 206, headers: { ...head, 'Content-Range': `bytes ${start}-${end}/${all.length}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(all, { headers: { ...head, 'Content-Length': String(all.length) } });
  }

  // ---------- товари в новині ----------
  // partner — ціни цього партнера (маржа бренду / особлива ціна); null — для адміна (РРЦ).
  async function productsFor(n, partner) {
    const ids = [...new Set(parseJson(n.body, []).filter((b) => b.t === 'product').map((b) => b.product_id))];
    if (!ids.length) return [];
    if (!partner) {
      return (await db.all(`SELECT product_id, name, article, rrp, image FROM b2b_catalog WHERE product_id IN (SELECT value FROM json_each(?))`, [J(ids)]))
        .map((r) => ({ id: r.product_id, name: r.name, article: r.article, rrp: r.rrp, image: r.image }));
    }
    const rows = await db.all(`SELECT c.product_id, c.name, c.article, c.rrp, c.image, ${PM_COLS} FROM b2b_margins m JOIN b2b_catalog c ON c.brand_id = m.brand_id ${PM_JOIN}
      WHERE m.partner_id = ? AND c.product_id IN (SELECT value FROM json_each(?)) AND c.hidden = 0`, [kyivDay(), partner.id, J(ids)]);
    return rows.map((r) => ({ id: r.product_id, name: r.name, article: r.article, rrp: r.rrp, image: r.image, price: r.rrp > 0 ? partnerPrice(r.rrp, r.margin) : null }));
  }
  app.get('/api/b2b/news/products', async (c) => {
    need(c, 'b2b.admin');
    const words = String(c.req.query('q') || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
    if (!words.length) return c.json({ products: [] });
    const rows = await db.all(`SELECT product_id, name, article, rrp, image FROM b2b_catalog WHERE hidden = 0 AND ${words.map(() => '(LOWER(name) LIKE ? OR LOWER(article) LIKE ?)').join(' AND ')} ORDER BY name LIMIT 20`,
      words.flatMap((w) => [`%${w}%`, `%${w}%`]));
    return c.json({ products: rows.map((r) => ({ id: r.product_id, name: r.name, article: r.article, rrp: r.rrp, image: r.image })) });
  });

  // ---------- кабінет партнера ----------
  app.get('/api/b2b/p/news', async (c) => {
    const p = await myPartner(c);
    const now = nowIso();
    const [rows, names] = await Promise.all([
      db.all(`SELECT n.id, n.title, n.summary, n.category, n.brands, n.cover, n.cover_url, n.body, n.pinned, n.publish_at, r.at AS read_at
        FROM b2b_news n LEFT JOIN b2b_news_reads r ON r.news_id = n.id AND r.partner_id = ? WHERE ${VISIBLE} ORDER BY n.pinned DESC, n.publish_at DESC LIMIT 200`, [p.id, now, p.id]),
      brandNames(),
    ]);
    return c.json({
      cats: NEWS_CATS, unread: rows.filter((r) => !r.read_at).length,
      rows: rows.map((n) => ({ id: n.id, title: n.title, summary: n.summary, category: n.category, category_name: NEWS_CATS[n.category] || NEWS_CATS.other,
        brands: parseJson(n.brands, []).map((id) => ({ id, name: names.get(id) || '' })), cover_url: coverOf(n, true), video: hasVideo(n), minutes: readMinutes(n),
        files: parseJson(n.body, []).filter((b) => b.t === 'file').length, pinned: Boolean(n.pinned), publish_at: n.publish_at, read: Boolean(n.read_at) })),
    });
  });
  app.get('/api/b2b/p/news/unread', async (c) => {
    const p = await myPartner(c);
    const r = await db.get(`SELECT COUNT(*) AS n FROM b2b_news n WHERE ${VISIBLE} AND NOT EXISTS (SELECT 1 FROM b2b_news_reads r WHERE r.news_id = n.id AND r.partner_id = ?)`, [nowIso(), p.id, p.id]);
    return c.json({ n: r?.n || 0 });
  });
  app.get('/api/b2b/p/news/:id{[0-9]+}', async (c) => {
    const p = await myPartner(c);
    const n = await db.get(`SELECT n.* FROM b2b_news n WHERE n.id = ? AND ${VISIBLE}`, [Number(c.req.param('id')), nowIso(), p.id]);
    if (!n) throw fail(404, 'Новину не знайдено або її знято з публікації.');
    await db.run(`INSERT OR IGNORE INTO b2b_news_reads (news_id, partner_id, user_id, at) VALUES (?, ?, ?, ?)`, [n.id, p.id, c.get('user')?.id || null, nowIso()]);
    const [files, names, products] = await Promise.all([filesOf(n), brandNames(), productsFor(n, p)]);
    const o = out(n, files, true);
    return c.json({ ...o, audience: undefined, tg: undefined, notified_at: undefined, minutes: readMinutes(n),
      brands: o.brands.map((id) => ({ id, name: names.get(id) || '' })), products });
  });
  app.get('/api/b2b/p/news-read-all', async (c) => {
    const p = await myPartner(c);
    const rows = await db.all(`SELECT n.id FROM b2b_news n WHERE ${VISIBLE} AND NOT EXISTS (SELECT 1 FROM b2b_news_reads r WHERE r.news_id = n.id AND r.partner_id = ?) LIMIT 200`, [nowIso(), p.id, p.id]);
    const at = nowIso();
    if (rows.length) await db.batch(rows.map((r) => [`INSERT OR IGNORE INTO b2b_news_reads (news_id, partner_id, user_id, at) VALUES (?, ?, ?, ?)`, [r.id, p.id, c.get('user')?.id || null, at]]));
    return c.json({ ok: true, n: rows.length });
  });

  return { notifyStep };
}
