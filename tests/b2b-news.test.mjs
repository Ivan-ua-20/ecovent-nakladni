// B2B «Новини»: адмін пише й публікує статтю (текст, фото, YouTube, файл, товар), партнер бачить у кабінеті
// (лише свої — за аудиторією, з власною ціною товару), позначка «прочитано»; сповіщення в Telegram-групу партнера
// з посиланням (немає групи — користувачам партнера); заплановані — фоном у час публікації; безпечний HTML.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { cleanHtml, videoEmbed } from '../src/modules/b2b/news.js';

const db = openDb(':memory:');
await migrate(db);
const tg = [];
const fetchFn = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.telegram.org/')) { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  return new Response(JSON.stringify({ status: 'ok', data: [] }));
};
const app = createApp({ db, fetchFn });
const setup = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const BASE = 'https://ecovent.example';
const call = async (method, path, body, headers = H) => {
  const r = await app.request(`${BASE}${path}`, { method, headers, body: body == null ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
  return { status: r.status, j: await r.clone().json().catch(() => ({})), r };
};
const req = async (...a) => { const x = await call(...a); if (x.status >= 400) throw new Error(x.j.error || x.status); return x.j; };
await db.run(`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x'), ('tg_bot', 'bot') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

// ---------- безпечний HTML і відео ----------
assert.equal(cleanHtml('<p onclick="x()">Привіт <b>світ</b><script>alert(1)</script><img src=x onerror=alert(1)></p>'), '<p>Привіт <b>світ</b></p>');
assert.equal(cleanHtml('<a href="javascript:alert(1)">x</a> <a href="https://ecovent.ua/a?b=1&amp;c=2">y</a>'), '<a>x</a> <a href="https://ecovent.ua/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">y</a>');
assert.equal(cleanHtml('5 < 7 & 8 > 3'), '5 &lt; 7 &amp; 8 &gt; 3');
assert.equal(videoEmbed('https://youtu.be/dQw4w9WgXcQ').embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
assert.equal(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10').id, 'dQw4w9WgXcQ');
assert.equal(videoEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ').kind, 'youtube');
assert.equal(videoEmbed('https://vimeo.com/123456789').embed, 'https://player.vimeo.com/video/123456789');
assert.equal(videoEmbed('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view?usp=sharing').kind, 'gdrive');
assert.equal(videoEmbed('javascript:alert(1)'), null);

// ---------- партнери ----------
const pa = await req('POST', '/api/b2b/partners', { name: 'Партнер А' });
const pb = await req('POST', '/api/b2b/partners', { name: 'Партнер Б' });
await db.run(`UPDATE b2b_partners SET tg_group = '-100500', tg_group_title = 'Ековент × А' WHERE id = ?`, [pa.id]);
await db.run(`INSERT INTO b2b_margins (partner_id, brand_id, margin) VALUES (?, 7, 10)`, [pa.id]);
await db.run(`INSERT INTO b2b_catalog (product_id, name, article, rrp, brand_id) VALUES (501, 'Осушувач DREO HDH003S', 'HDH003S', 20000, 7)`);
for (const [login, id] of [['pa', pa.id], ['pb', pb.id]]) await req('POST', `/api/b2b/partners/${id}/users`, { login, password: 'pass1234' });
await db.run(`UPDATE users SET tg_chat_id = '800' WHERE login = 'pb'`);
const loginAs = async (login) => {
  const r = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password: 'pass1234' }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const HA = await loginAs('pa');
const HB = await loginAs('pb');

// ---------- файл (фото) ----------
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const up = await call('POST', '/api/b2b/news/files?name=photo.png', png, { Cookie: H.Cookie, 'Content-Type': 'image/png', 'Content-Length': String(png.length) });
assert.equal(up.status, 200, JSON.stringify(up.j));
const fileId = up.j.id;
const big = await call('POST', '/api/b2b/news/files?name=video.mp4', new Uint8Array(10), { Cookie: H.Cookie, 'Content-Type': 'video/mp4', 'Content-Length': String(6 * 1024 * 1024) });
assert.equal(big.status, 400, 'відео понад 5 МБ без R2 — ні');
assert.match(big.j.error, /R2/);

// ---------- чернетка → публікація ----------
assert.equal((await call('POST', '/api/b2b/news', { title: 'x' }, HA)).status, 403, 'партнер не пише новин');
const { id } = await req('POST', '/api/b2b/news', { title: 'Огляд DREO HDH003S', summary: 'Тихий осушувач з Wi-Fi', category: 'products', brands: [7],
  body: [{ t: 'text', html: '<h2>Що нового</h2><p>30 л/добу<script>x</script></p>' }, { t: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Огляд' },
    { t: 'image', file: fileId, caption: 'Фото' }, { t: 'product', product_id: 501 }, { t: 'text', html: '   ' }] });
assert.equal((await call('POST', '/api/b2b/news', { body: [{ t: 'video', url: 'ftp://x' }] })).status, 400, 'невірне посилання на відео');
let n = await req('GET', `/api/b2b/news/${id}`);
assert.equal(n.status, 'draft');
assert.deepEqual(n.body.map((b) => b.t), ['text', 'video', 'image', 'product'], 'порожній текст прибрано');
assert.equal(n.body[0].html, '<h2>Що нового</h2><p>30 л/добу</p>');
assert.equal(n.body[1].kind, 'youtube');
assert.equal(n.body[2].src, `/api/b2b/news/files/${fileId}`);
assert.equal((await req('GET', '/api/b2b/p/news', null, HA)).rows.length, 0, 'чернетку партнер не бачить');

await req('POST', `/api/b2b/news/${id}/publish`, {});
let feed = await req('GET', '/api/b2b/p/news', null, HA);
assert.equal(feed.unread, 1);
assert.deepEqual(feed.rows.map((r) => [r.title, r.read, r.video, r.category_name]), [['Огляд DREO HDH003S', false, true, 'Новинки товарів']]);
assert.equal(feed.rows[0].cover_url, `/api/b2b/p/news/files/${fileId}`, 'обкладинка — перше фото');
assert.equal((await req('GET', '/api/b2b/p/news/unread', null, HB)).n, 1);

// ---------- Telegram: група партнера А, користувачі партнера Б, з посиланням ----------
tg.length = 0;
let s = await req('POST', `/api/b2b/news/${id}/notify`, {});
assert.deepEqual([s.sent, s.total, s.more], [2, 2, false]);
assert.deepEqual(tg.map((m) => m.chat_id).sort(), ['-100500', '800']);
assert.match(tg[0].text, /Огляд DREO HDH003S/);
assert.ok(tg.every((m) => m.text.includes(`${BASE}/#/pnews/${id}`)), 'посилання на новину');
tg.length = 0;
s = await req('POST', `/api/b2b/news/${id}/notify`, {});
assert.equal(tg.length, 0, 'повторно не надсилає');
assert.ok((await db.get(`SELECT notified_at FROM b2b_news WHERE id = ?`, [id])).notified_at);

// ---------- стаття в кабінеті: ціна партнера, прочитано ----------
const art = await req('GET', `/api/b2b/p/news/${id}`, null, HA);
assert.equal(art.title, 'Огляд DREO HDH003S');
assert.deepEqual(art.products.map((p) => [p.id, p.price, p.rrp]), [[501, 18000, 20000]], 'ціна партнера А');
assert.equal(art.audience, undefined, 'партнер не бачить службових полів');
assert.equal((await req('GET', `/api/b2b/p/news/${id}`, null, HB)).products.length, 0, 'партнер Б без бренду — без товару');
feed = await req('GET', '/api/b2b/p/news', null, HA);
assert.deepEqual([feed.unread, feed.rows[0].read], [0, true]);
const adm = await req('GET', `/api/b2b/news/${id}`);
assert.deepEqual(adm.reads.map((r) => [r.name, Boolean(r.at)]).sort(), [['Партнер А', true], ['Партнер Б', true]]);
assert.equal((await req('GET', '/api/b2b/news')).rows[0].reads, 2);
// файл бачить партнер; Range для відео
assert.equal(art.body.find((b) => b.t === 'image').src, `/api/b2b/p/news/files/${fileId}`);
const fr = await call('GET', `/api/b2b/p/news/files/${fileId}`, null, { Cookie: HA.Cookie, Range: 'bytes=2-5' });
assert.equal(fr.status, 206);
assert.deepEqual([...new Uint8Array(await fr.r.arrayBuffer())], [78, 71, 13, 10]);

// ---------- аудиторія: лише партнер Б, і запланована ----------
const only = await req('POST', '/api/b2b/news', { title: 'Лише для Б', summary: 'х', audience: [pb.id] });
await req('POST', `/api/b2b/news/${only.id}/publish`, {});
tg.length = 0;
assert.equal((await req('POST', `/api/b2b/news/${only.id}/notify`, {})).total, 1, 'лише партнеру Б');
assert.deepEqual(tg.map((m) => m.chat_id), ['800']);
assert.ok(!(await req('GET', '/api/b2b/p/news', null, HA)).rows.some((r) => r.id === only.id), 'А не бачить');
assert.equal((await call('GET', `/api/b2b/p/news/${only.id}`, null, HA)).status, 404);
assert.ok((await req('GET', '/api/b2b/p/news', null, HB)).rows.some((r) => r.id === only.id));
await req('GET', '/api/b2b/p/news-read-all', null, HB);
assert.equal((await req('GET', '/api/b2b/p/news/unread', null, HB)).n, 0, 'усе прочитано');

const plan = await req('POST', '/api/b2b/news', { title: 'Нові ціни з 1 грудня', summary: 'Деталі', pinned: true });
const later = new Date(Date.now() + 3600e3).toISOString();
const pr = await req('POST', `/api/b2b/news/${plan.id}/publish`, { at: later });
assert.equal(pr.planned, true);
assert.equal((await req('GET', '/api/b2b/news')).rows.find((r) => r.id === plan.id).status, 'planned');
assert.ok(!(await req('GET', '/api/b2b/p/news', null, HA)).rows.some((r) => r.id === plan.id), 'до часу публікації не видно');
const cronKey = (await req('POST', '/api/jobs/key')).key;
const runCron = async () => (await call('POST', '/api/cron/run/b2b-news', null, { 'X-Cron-Key': cronKey })).j;
tg.length = 0;
let cr = await runCron();
assert.ok(cr.ok);
assert.equal(tg.length, 0, 'ще не час');
await db.run(`UPDATE b2b_news SET publish_at = ? WHERE id = ?`, [new Date(Date.now() - 1000).toISOString(), plan.id]);
cr = await runCron();
assert.equal(tg.length, 2, JSON.stringify(cr));
assert.ok(tg[0].text.includes(`${BASE}/#/pnews/${plan.id}`), 'посилання — з адреси сайту, з якої публікували');
assert.equal((await req('GET', '/api/b2b/p/news', null, HA)).rows[0].pinned, true);

// ---------- зняти з публікації, видалити ----------
await req('POST', `/api/b2b/news/${plan.id}/unpublish`, {});
assert.ok(!(await req('GET', '/api/b2b/p/news', null, HA)).rows.some((r) => r.id === plan.id));
await req('DELETE', `/api/b2b/news/${plan.id}`);
assert.ok(!(await req('GET', '/api/b2b/news')).rows.some((r) => r.id === plan.id));
assert.equal((await call('DELETE', `/api/b2b/news/${id}`, null, HA)).status, 403);

console.log('OK — B2B «Новини»: статті, файли, аудиторія, прочитані, Telegram-групи з посиланням, заплановані');
