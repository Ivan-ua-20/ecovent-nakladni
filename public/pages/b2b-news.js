// B2B «Новини»: адмінка (B2B партнери → Новини — список, редактор статті з блоками) і кабінет партнера
// (Новини — стрічка з рубриками й статтею). Сервер — src/modules/b2b/news.js.
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime, setTabBadge } from '../core/ui.js';

const uah = (n) => `${Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₴`;
const dDay = (s) => String(s || '').slice(0, 10).split('-').reverse().join('.');
const mb = (n) => `${(Number(n || 0) / 1048576).toLocaleString('uk-UA', { maximumFractionDigits: 1 })} МБ`;
const ICO = { play: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>' };
const STATUS = { draft: ['', 'Чернетка'], planned: ['info', 'Заплановано'], published: ['ok', 'Опубліковано'] };
const kyivLocal = (iso) => { // ISO → значення для <input type="datetime-local"> за Києвом
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const fromKyivLocal = (v) => { // «2026-12-01T09:00» (Київ) → ISO
  if (!v) return '';
  const guess = Date.parse(`${v}:00Z`);
  const shown = Date.parse(`${kyivLocal(new Date(guess).toISOString())}:00Z`);
  return new Date(guess - (shown - guess)).toISOString();
};

// ---------- спільне: стаття ----------
function blockHtml(b) {
  const cap = b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : '';
  if (b.t === 'text') return `<div class="nw-text">${b.html}</div>`;
  if (b.t === 'image') return `<figure class="nw-fig"><img src="${esc(b.src)}" alt="${esc(b.caption || '')}" loading="lazy">${cap}</figure>`;
  if (b.t === 'video' && b.src) return `<figure class="nw-fig"><video src="${esc(b.src)}" controls preload="metadata" playsinline></video>${cap}</figure>`;
  if (b.t === 'video' && b.embed) return `<figure class="nw-fig"><div class="nw-embed"><iframe src="${esc(b.embed)}" title="${esc(b.caption || 'Відео')}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${cap}</figure>`;
  if (b.t === 'video' && b.url) return `<p><a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">▶ ${esc(b.caption || 'Дивитися відео')}</a></p>`;
  return '';
}
const filesHtml = (body) => {
  const fs = body.filter((b) => b.t === 'file' && b.src);
  return fs.length ? `<section class="card nw-side"><b>Файли</b>${fs.map((f) => `<a class="nw-file" href="${esc(f.src)}?dl=1" download="${esc(f.name)}"><span aria-hidden="true">📄</span><span><b>${esc(f.caption || f.name)}</b><span class="small muted">${esc(f.name)} · ${mb(f.size)}</span></span><span aria-hidden="true">⬇</span></a>`).join('')}</section>` : '';
};
const productsHtml = (products, partner) => (products?.length ? `<section class="card nw-side"><b>Товари з цієї новини</b>
  ${products.map((p) => `<div class="nw-prod">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : '<span class="nw-ph"></span>'}<div><b>${esc(p.name)}</b>
    <div class="small muted">${partner && p.price != null ? `ваша ціна <b>${uah(p.price)}</b> · ` : ''}РРЦ ${uah(p.rrp)}</div></div></div>`).join('')}
  ${partner ? (products.some((p) => p.price != null) ? '<a class="btn primary" href="#/porders/new">+ Нова закупівля</a>' : '<div class="small muted">Цих товарів немає у ваших брендах — запитайте менеджера.</div>') : ''}</section>` : '');
function articleHtml(n, { partner = false, back = '' } = {}) {
  const brands = (n.brands || []).map((b) => (typeof b === 'object' ? b.name : '')).filter(Boolean);
  return `<div class="nw-art">
    <article>
      ${back ? `<a class="btn" href="${back}">← Усі новини</a>` : ''}
      <div class="nw-badges">${n.pinned ? '<span class="badge bad">📌 Важливо</span>' : ''}<span class="badge info">${esc(n.category_name || '')}</span>${n.body.some((b) => b.t === 'video') ? '<span class="badge">▶ Відео</span>' : ''}</div>
      <h1>${esc(n.title || 'Без заголовка')}</h1>
      <div class="small muted">${esc(dDay(n.publish_at) || 'ще не опубліковано')}${brands.length ? ` · ${esc(brands.join(', '))}` : ''}${n.minutes ? ` · ${n.minutes} хв читання` : ''}</div>
      ${n.summary ? `<p class="nw-lead">${esc(n.summary)}</p>` : ''}
      ${n.body.map(blockHtml).join('')}
    </article>
    <aside class="nw-aside">${productsHtml(n.products, partner)}${filesHtml(n.body)}
      ${partner ? '<section class="card nw-side"><b>Є питання?</b><span class="small muted">Пишіть у вашу Telegram-групу з Ековент — менеджер відповість.</span></section>' : ''}</aside>
  </div>`;
}
const cardHtml = (r, big = false) => `<a class="card nw-card ${big ? 'big' : ''} ${r.read ? '' : 'unread'}" href="#/pnews/${r.id}">
  <span class="nw-cover">${r.cover_url ? `<img src="${esc(r.cover_url)}" alt="" loading="lazy">` : ''}${r.video ? `<span class="nw-play">${ICO.play}</span>` : ''}</span>
  <span class="nw-cb">
    <span class="nw-badges">${r.pinned ? '<span class="badge bad">📌 Важливо</span>' : ''}${r.read ? '' : '<span class="badge warn">Нове</span>'}<span class="badge info">${esc(r.category_name)}</span>${r.video ? '<span class="badge">▶ Відео</span>' : ''}</span>
    <b class="nw-title">${esc(r.title)}</b>
    ${r.summary ? `<span class="muted nw-sum">${esc(r.summary)}</span>` : ''}
    <span class="small muted nw-meta">${esc(dDay(r.publish_at))}${r.brands.length ? ` · ${esc(r.brands.map((b) => b.name).filter(Boolean).join(', '))}` : ''}${r.files ? ` · 📎 ${r.files}` : ''}${r.read ? ' · прочитано ✓' : ''}</span>
  </span></a>`;

export function createB2bNewsPages({ can }) {
  // ================= кабінет партнера =================
  const pf = { cat: '', brand: '', q: '' };
  async function viewPartnerNews(id) {
    if (id) return viewPartnerArticle(id);
    main.innerHTML = '<div class="card muted">Завантаження…</div>';
    const d = await api('GET', '/api/b2b/p/news');
    setTabBadge('pnews', d.unread);
    const brands = [...new Map(d.rows.flatMap((r) => r.brands).filter((b) => b.name).map((b) => [b.id, b.name]))];
    const draw = () => {
      const q = pf.q.toLowerCase();
      const list = d.rows.filter((r) => (!pf.cat || r.category === pf.cat) && (!pf.brand || r.brands.some((b) => String(b.id) === pf.brand))
        && (!q || `${r.title} ${r.summary}`.toLowerCase().includes(q)));
      const pinned = list.filter((r) => r.pinned && !r.read);
      const rest = list.filter((r) => !pinned.includes(r));
      $('#nwList').innerHTML = list.length ? `${pinned.map((r) => cardHtml(r, true)).join('')}<div class="nw-grid">${rest.map((r) => cardHtml(r)).join('')}</div>`
        : `<div class="card empty"><div class="big">${d.rows.length ? 'Нічого не знайдено' : 'Новин поки немає'}</div>${d.rows.length ? 'Змініть рубрику або пошук.' : 'Тут з\'являтимуться новинки товарів, акції та інструкції від Ековент.'}</div>`;
      $$('[data-cat]').forEach((b) => b.classList.toggle('on', b.dataset.cat === pf.cat));
    };
    const cnt = (k) => d.rows.filter((r) => r.category === k).length;
    main.innerHTML = `<div class="head-row"><h2>Новини Ековент</h2><span class="muted">${d.unread ? `${d.unread} непрочитан${d.unread === 1 ? 'а' : 'і'}` : 'усе прочитано'}</span>
        ${d.unread ? '<button class="btn" id="nwAll" style="margin-left:auto">✓ Позначити все прочитаним</button>' : ''}</div>
      <div class="nw-filters"><div class="f-chips"><button type="button" class="chip" data-cat="">Усі · ${d.rows.length}</button>
        ${Object.entries(d.cats).filter(([k]) => cnt(k)).map(([k, t]) => `<button type="button" class="chip" data-cat="${k}">${esc(t)} · ${cnt(k)}</button>`).join('')}</div>
        ${brands.length > 1 ? `<select id="nwBrand" aria-label="Бренд"><option value="">Усі бренди</option>${brands.map(([bid, name]) => `<option value="${bid}" ${String(bid) === pf.brand ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>` : ''}
        <input type="search" id="nwQ" placeholder="Пошук у новинах" value="${esc(pf.q)}" aria-label="Пошук у новинах"></div>
      <div id="nwList"></div>`;
    draw();
    $$('[data-cat]').forEach((b) => (b.onclick = () => { pf.cat = b.dataset.cat; draw(); }));
    if ($('#nwBrand')) $('#nwBrand').onchange = (e) => { pf.brand = e.target.value; draw(); };
    $('#nwQ').oninput = (e) => { pf.q = e.target.value.trim(); draw(); };
    if ($('#nwAll')) $('#nwAll').onclick = async () => { try { await api('GET', '/api/b2b/p/news-read-all'); viewPartnerNews(); } catch (er) { toast(er.message, true); } };
  }
  async function viewPartnerArticle(id) {
    main.innerHTML = '<div class="card muted">Завантаження…</div>';
    let n;
    try { n = await api('GET', `/api/b2b/p/news/${encodeURIComponent(id)}`); } catch (er) {
      main.innerHTML = `<div class="card empty"><div class="big">${esc(er.message)}</div><a class="btn" href="#/pnews">← Усі новини</a></div>`;
      return;
    }
    main.innerHTML = articleHtml(n, { partner: true, back: '#/pnews' });
    api('GET', '/api/b2b/p/news/unread').then((r) => setTabBadge('pnews', r.n)).catch(() => {});
  }
  // Блок на головній кабінету: 3 останні непрочитані.
  async function partnerHomeBlock() {
    const d = await api('GET', '/api/b2b/p/news').catch(() => null);
    if (!d) return '';
    setTabBadge('pnews', d.unread);
    const list = d.rows.filter((r) => !r.read).slice(0, 3);
    if (!list.length) return '';
    return `<div class="card form-stack"><span class="an7-h">Нове від Ековент</span>
      ${list.map((r) => `<a class="nw-mini" href="#/pnews/${r.id}">${r.pinned ? '📌 ' : ''}<b>${esc(r.title)}</b><span class="small muted">${esc(r.category_name)} · ${esc(dDay(r.publish_at))}</span></a>`).join('')}
      <a class="small" href="#/pnews">Усі новини →</a></div>`;
  }

  // ================= адмінка =================
  let meta = null;
  let cur = null; // відкрита стаття: { id, ...поля }
  let saveT = 0;
  let dirty = false;
  async function viewNewsAdmin(id) {
    main.innerHTML = '<div class="card muted">Завантаження…</div>';
    const [list, m] = await Promise.all([api('GET', '/api/b2b/news'), meta ? meta : api('GET', '/api/b2b/news/meta')]);
    meta = m;
    const edit = can('b2b.admin');
    const sel = Number(id) || 0;
    const cnt = (s) => list.rows.filter((r) => r.status === s).length;
    main.innerHTML = `<div class="nw-admin">
      <section class="card nw-list">
        <div class="nw-list-h"><h2>Новини</h2>${edit ? '<button class="btn primary sm" id="nwNew">+ Нова стаття</button>' : ''}</div>
        <div class="small" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><span class="badge ok">Опубліковані ${cnt('published')}</span><span class="badge info">Заплановані ${cnt('planned')}</span><span class="badge">Чернетки ${cnt('draft')}</span></div>
        ${list.rows.length ? list.rows.map((r) => `<a class="nw-li ${r.id === sel ? 'on' : ''}" href="#/b2bnews/${r.id}">
          <span class="nw-li-h"><span class="badge ${STATUS[r.status][0]}">${r.status === 'planned' ? `${esc(dDay(r.publish_at))} о ${esc(kyivLocal(r.publish_at).slice(11))}` : STATUS[r.status][1]}</span>${r.pinned ? '<span class="badge bad">📌</span>' : ''}
            <span class="small muted" style="margin-left:auto">${esc(r.status === 'published' ? dDay(r.publish_at) : r.updated_at ? fmtDateTime(r.updated_at) : '')}</span></span>
          <b>${esc(r.title || 'Без заголовка')}</b>
          <span class="small muted">${esc(meta.cats[r.category] || '')}${r.status === 'published' ? ` · 👁 прочитали ${r.reads} з ${r.audience || list.partners}` : ''}${r.audience ? ` · ${r.audience} партн.` : ''}</span></a>`).join('')
    : '<div class="muted small">Новин ще немає. Натисніть «+ Нова стаття».</div>'}
      </section>
      <div id="nwEd" class="nw-ed-wrap">${sel ? '<div class="card muted">Завантаження…</div>' : `<div class="card empty"><div class="big">Оберіть новину або створіть нову</div>Статті бачать партнери в кабінеті у вкладці «Новини»; про нові приходить повідомлення в їхні Telegram-групи з посиланням.</div>`}</div>
    </div>`;
    if ($('#nwNew')) $('#nwNew').onclick = async () => {
      try { const r = await api('POST', '/api/b2b/news', { title: '', category: 'products' }); location.hash = `#/b2bnews/${r.id}`; } catch (er) { toast(er.message, true); }
    };
    if (sel) await openEditor(sel, edit);
  }

  async function openEditor(id, edit) {
    const n = await api('GET', `/api/b2b/news/${id}`);
    cur = n;
    dirty = false;
    const box = $('#nwEd');
    const ro = edit ? '' : 'disabled';
    box.innerHTML = `<section class="card nw-ed">
        <div class="nw-ed-top"><span class="small muted" id="nwSaved">${n.updated_at ? `збережено ${esc(fmtDateTime(n.updated_at))}` : ''}</span>
          <button type="button" class="btn sm" id="nwPrev" style="margin-left:auto">👁 Переглянути як партнер</button></div>
        <input class="nw-h" id="nwTitle" placeholder="Заголовок новини" value="${esc(n.title)}" ${ro} aria-label="Заголовок">
        <textarea id="nwSum" rows="2" placeholder="Короткий опис для картки й повідомлення в Telegram (1–2 речення)" ${ro} aria-label="Короткий опис">${esc(n.summary)}</textarea>
        <div class="nw-editor">
          ${edit ? `<div class="nw-tool" role="toolbar" aria-label="Оформлення й блоки">
            <button type="button" data-cmd="bold" title="Жирний"><b>B</b></button><button type="button" data-cmd="italic" title="Курсив"><i>I</i></button>
            <button type="button" data-cmd="h2" title="Підзаголовок">H2</button><button type="button" data-cmd="p" title="Звичайний текст">¶</button>
            <button type="button" data-cmd="insertUnorderedList">• Список</button><button type="button" data-cmd="insertOrderedList">1. Список</button><button type="button" data-cmd="link">🔗 Посилання</button>
            <span class="sep"></span>
            <button type="button" class="add" data-add="text">✎ Текст</button><button type="button" class="add" data-add="image">🖼 Фото</button><button type="button" class="add" data-add="url">▶ YouTube / посилання</button>
            <button type="button" class="add" data-add="video">🎬 Відео-файл</button><button type="button" class="add" data-add="file">📎 Файл</button><button type="button" class="add" data-add="product">🛒 Товар з каталогу</button>
          </div>` : ''}
          <div id="nwBlocks" class="nw-blocks"></div>
          ${edit ? '<div class="nw-drop small muted" id="nwDrop">Перетягніть сюди фото, відео чи файл — або додайте блок кнопками вгорі</div>' : ''}
        </div>
      </section>
      <aside class="card nw-opts">
        <b>Публікація</b>
        <label class="f"><span>Рубрика</span><select id="nwCat" ${ro}>${Object.entries(meta.cats).map(([k, t]) => `<option value="${k}" ${k === n.category ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <div class="f"><span>Бренди</span><div class="nw-chk">${meta.brands.map((b) => `<label class="chk-chip"><input type="checkbox" data-brand="${b.id}" ${n.brands.includes(b.id) ? 'checked' : ''} ${ro}> ${esc(b.name)}</label>`).join('') || '<span class="small muted">—</span>'}</div></div>
        <div class="f"><span>Обкладинка</span><div class="nw-coverbox" id="nwCover"></div></div>
        <label class="f"><span>Кому показувати</span><select id="nwAud" ${ro}><option value="all">Усім партнерам (${meta.partners.length})</option><option value="some" ${n.audience.length ? 'selected' : ''}>Вибраним партнерам</option></select></label>
        <div class="nw-chk" id="nwAudList" ${n.audience.length ? '' : 'hidden'}>${meta.partners.map((p) => `<label class="chk-chip"><input type="checkbox" data-aud="${p.id}" ${n.audience.includes(p.id) ? 'checked' : ''} ${ro}> ${esc(p.name)}</label>`).join('')}</div>
        <label class="check"><input type="checkbox" id="nwPin" ${n.pinned ? 'checked' : ''} ${ro}> 📌 Закріпити як «Важливо»</label>
        <label class="check"><input type="checkbox" id="nwTg" ${n.tg ? 'checked' : ''} ${ro}> Надіслати в Telegram-групи партнерів (з посиланням)</label>
        ${n.status === 'draft' || n.publish_at > new Date().toISOString() ? `<label class="f"><span>Коли опублікувати</span><select id="nwWhen" ${ro}><option value="now">Одразу</option><option value="at" ${n.status === 'published' ? 'selected' : ''}>Дата й час (Київ)</option></select></label>
          <input type="datetime-local" id="nwAt" value="${esc(kyivLocal(n.status === 'published' ? n.publish_at : ''))}" ${n.status === 'published' ? '' : 'hidden'} ${ro}>` : ''}
        ${edit ? `<div class="btn-row nw-actions">
          ${n.status === 'draft' ? '<button type="button" class="btn" id="nwSave">Зберегти чернетку</button><button type="button" class="btn primary" id="nwPub">Опублікувати</button>'
    : `<button type="button" class="btn primary" id="nwSave">Зберегти зміни</button><button type="button" class="btn" id="nwUnpub">Зняти з публікації</button>${n.publish_at > new Date().toISOString() ? '<button type="button" class="btn" id="nwPub">Змінити час</button>' : ''}`}
          <button type="button" class="btn danger" id="nwDel">Видалити</button></div>` : ''}
        ${n.status === 'published' ? `<div class="nw-reads"><b>Прочитали ${n.reads.filter((r) => r.at).length} з ${n.reads.length}</b>
          ${n.notified_at ? `<div class="small muted">Telegram: надіслано ${n.sent?.ok ?? 0} з ${n.sent?.total ?? 0}${(n.sent?.total ?? 0) > (n.sent?.ok ?? 0) ? ' (без групи й без Telegram — не отримали)' : ''} · ${esc(fmtDateTime(n.notified_at))}</div>` : n.tg && n.publish_at <= new Date().toISOString() && edit ? '<button type="button" class="btn sm" id="nwSend">Надіслати в Telegram</button>' : ''}
          <div class="small nw-reads-list">${n.reads.map((r) => `<span class="${r.at ? '' : 'muted'}">${r.at ? '✓' : '○'} ${esc(r.name)}${r.at ? ` · ${esc(fmtDateTime(r.at))}` : ''}${r.tg === 'none' ? ' · <span title="Немає Telegram-групи й користувачів з Telegram">без Telegram</span>' : ''}</span>`).join('')}</div></div>` : ''}
      </aside>`;
    drawBlocks(edit);
    drawCover(edit);
    if (!edit) return;
    // Автозбереження за 2 с після зміни; якщо за цей час пішли зі сторінки — зберігається останній стан форми.
    const touch = () => { dirty = true; cur.last = payload(); $('#nwSaved').textContent = 'є незбережені зміни…'; clearTimeout(saveT); saveT = setTimeout(() => save(true), 2000); };
    ['#nwTitle', '#nwSum'].forEach((s) => ($(s).oninput = touch));
    ['#nwCat', '#nwPin', '#nwTg'].forEach((s) => ($(s).onchange = touch));
    $$('[data-brand], [data-aud]').forEach((x) => (x.onchange = touch));
    $('#nwAud').onchange = (e) => { $('#nwAudList').hidden = e.target.value !== 'some'; touch(); };
    if ($('#nwWhen')) $('#nwWhen').onchange = (e) => { $('#nwAt').hidden = e.target.value !== 'at'; };
    $('#nwPrev').onclick = () => preview();
    $('#nwSave').onclick = () => save(false);
    if ($('#nwPub')) $('#nwPub').onclick = () => publish();
    if ($('#nwUnpub')) $('#nwUnpub').onclick = async () => { await save(true); await api('POST', `/api/b2b/news/${cur.id}/unpublish`).catch((er) => toast(er.message, true)); toast('Знято з публікації — партнери більше не бачать'); viewNewsAdmin(cur.id); };
    if ($('#nwSend')) $('#nwSend').onclick = (e) => notifyAll(e.currentTarget);
    $('#nwDel').onclick = async () => {
      if (!await confirmDanger(`Видалити «${cur.title || 'Без заголовка'}»?`, 'Партнери більше не бачитимуть цю новину.', 'Видалити')) return;
      try { await api('DELETE', `/api/b2b/news/${cur.id}`); dirty = false; toast('Видалено'); location.hash = '#/b2bnews'; } catch (er) { toast(er.message, true); }
    };
    // панель інструментів
    $$('[data-cmd]').forEach((b) => (b.onmousedown = (e) => {
      e.preventDefault();
      const c = b.dataset.cmd;
      if (c === 'h2' || c === 'p') document.execCommand('formatBlock', false, c === 'h2' ? 'H2' : 'P');
      else if (c === 'link') { const u = prompt('Посилання (https://…)'); if (u && /^https?:\/\//i.test(u.trim())) document.execCommand('createLink', false, u.trim()); else if (u) toast('Посилання має починатися з https://', true); }
      else document.execCommand(c);
      const ed = document.activeElement?.closest?.('[data-html]');
      if (ed) { cur.body[Number(ed.dataset.html)].html = ed.innerHTML; touch(); }
    }));
    $$('[data-add]').forEach((b) => (b.onclick = () => addBlock(b.dataset.add, touch)));
    const drop = $('.nw-editor');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); for (const f of e.dataTransfer.files) uploadBlock(f, /^image\//.test(f.type) ? 'image' : /^video\//.test(f.type) ? 'video' : 'file', touch); };
    window.onbeforeunload = () => (dirty ? true : undefined);
    cur.touch = touch;
  }

  function drawCover(edit) {
    const box = $('#nwCover');
    const src = cur.cover ? `/api/b2b/news/files/${cur.cover}` : '';
    box.innerHTML = `${src ? `<img src="${esc(src)}" alt="Обкладинка">` : '<span class="small muted">Автоматично: перше фото або кадр з YouTube</span>'}
      ${edit ? `<span class="btn-row"><label class="btn sm">${src ? 'Змінити' : 'Завантажити'}<input type="file" accept="image/*" hidden id="nwCoverF"></label>${src ? '<button type="button" class="btn sm" id="nwCoverX">Прибрати</button>' : ''}</span>` : ''}`;
    if (!edit) return;
    $('#nwCoverF').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const r = await upload(f).catch((er) => { toast(er.message, true); return null; }); if (r) { cur.cover = r.id; drawCover(true); cur.touch(); } };
    if ($('#nwCoverX')) $('#nwCoverX').onclick = () => { cur.cover = null; drawCover(true); cur.touch(); };
  }

  function drawBlocks(edit) {
    const box = $('#nwBlocks');
    const ctl = (i) => (edit ? `<span class="nw-ctl"><button type="button" class="btn sm icon" data-up="${i}" aria-label="Вище">↑</button><button type="button" class="btn sm icon" data-down="${i}" aria-label="Нижче">↓</button><button type="button" class="btn sm icon" data-del="${i}" aria-label="Прибрати блок">✕</button></span>` : '');
    const capIn = (i, b) => `<input class="nw-cap" data-cap="${i}" value="${esc(b.caption || '')}" placeholder="Підпис (необов'язково)" ${edit ? '' : 'disabled'}>`;
    box.innerHTML = cur.body.length ? cur.body.map((b, i) => {
      let inner = '';
      if (b.t === 'text') inner = `<div class="nw-text nw-ce" data-html="${i}" contenteditable="${edit}" role="textbox" aria-multiline="true" aria-label="Текст">${b.html}</div>`;
      else if (b.t === 'image') inner = `<img src="${esc(b.src || `/api/b2b/news/files/${b.file}`)}" alt="">${capIn(i, b)}`;
      else if (b.t === 'video' && b.file) inner = `<video src="${esc(b.src || `/api/b2b/news/files/${b.file}`)}" controls preload="metadata"></video><div class="small muted">${esc(b.name || '')}${b.size ? ` · ${mb(b.size)}` : ''}</div>${capIn(i, b)}`;
      else if (b.t === 'video') inner = `${b.embed ? `<div class="nw-embed"><iframe src="${esc(b.embed)}" title="Відео" loading="lazy" allowfullscreen></iframe></div>` : ''}
        <div class="nw-urlrow"><input data-url="${i}" value="${esc(b.url || '')}" placeholder="https://youtu.be/… · Vimeo · Google Диск" ${edit ? '' : 'disabled'}><span class="small muted">${b.kind === 'youtube' ? 'YouTube ✓' : b.kind === 'vimeo' ? 'Vimeo ✓' : b.kind === 'gdrive' ? 'Google Диск ✓' : b.url ? 'посилання' : ''}</span></div>${capIn(i, b)}`;
      else if (b.t === 'file') inner = `<div class="nw-file"><span aria-hidden="true">📄</span><span><b>${esc(b.name || 'Файл')}</b><span class="small muted">${b.size ? mb(b.size) : ''}</span></span></div>${capIn(i, b)}`;
      else if (b.t === 'product') { const p = (cur.products || []).find((x) => x.id === b.product_id) || b.p || {}; inner = `<div class="nw-file"><span aria-hidden="true">🛒</span><span><b>${esc(p.name || `Товар №${b.product_id}`)}</b><span class="small muted">РРЦ ${uah(p.rrp)} · партнер бачить свою ціну</span></span></div>`; }
      else if (b.t === 'uploading') inner = `<div class="nw-file"><span class="spinner"></span><span><b>${esc(b.name)}</b><span class="small muted">завантажується… <span data-pct="${i}">${b.pct || 0}</span>%</span></span></div>`;
      return `<div class="nw-blk" data-i="${i}">${inner}${ctl(i)}</div>`;
    }).join('') : `<div class="small muted" style="padding:10px">${edit ? 'Почніть з блоку «✎ Текст» або перетягніть фото чи відео.' : 'Порожньо.'}</div>`;
    if (!edit) return;
    const touch = () => cur.touch?.();
    $$('[data-html]', box).forEach((x) => (x.oninput = () => { cur.body[Number(x.dataset.html)].html = x.innerHTML; touch(); }));
    $$('[data-cap]', box).forEach((x) => (x.oninput = () => { cur.body[Number(x.dataset.cap)].caption = x.value; touch(); }));
    $$('[data-url]', box).forEach((x) => (x.onchange = () => { cur.body[Number(x.dataset.url)].url = x.value.trim(); touch(); save(true).then(() => reloadBody()); }));
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= cur.body.length) return; [cur.body[i], cur.body[j]] = [cur.body[j], cur.body[i]]; drawBlocks(true); touch(); };
    $$('[data-up]', box).forEach((x) => (x.onclick = () => move(Number(x.dataset.up), -1)));
    $$('[data-down]', box).forEach((x) => (x.onclick = () => move(Number(x.dataset.down), 1)));
    $$('[data-del]', box).forEach((x) => (x.onclick = () => { cur.body.splice(Number(x.dataset.del), 1); drawBlocks(true); touch(); }));
  }
  async function reloadBody() { const n = await api('GET', `/api/b2b/news/${cur.id}`); Object.assign(cur, { body: n.body, products: n.products }); drawBlocks(true); }

  function upload(file, onPct = () => {}) {
    if (file.size > meta.maxFile) {
      return Promise.reject(new Error(meta.r2 ? `Файл «${file.name}» більший за 100 МБ — завантажте відео на YouTube і додайте посиланням.`
        : `Файл «${file.name}» більший за 5 МБ. Відео додайте посиланням на YouTube / Google Диск (великі файли — після підключення сховища R2).`));
    }
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api/b2b/news/files?name=${encodeURIComponent(file.name)}`);
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      x.upload.onprogress = (e) => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)); };
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* */ } if (x.status >= 200 && x.status < 300) resolve(j); else reject(new Error(j.error || `Помилка ${x.status}`)); };
      x.onerror = () => reject(new Error('Немає зв\'язку — спробуйте ще раз.'));
      x.send(file);
    });
  }
  async function uploadBlock(file, t, touch) {
    const tmp = { t: 'uploading', name: file.name, pct: 0 };
    cur.body.push(tmp);
    drawBlocks(true);
    try {
      const r = await upload(file, (p) => { tmp.pct = p; const el = $(`[data-pct="${cur.body.indexOf(tmp)}"]`); if (el) el.textContent = p; });
      Object.assign(tmp, { t, file: r.id, name: r.name, size: r.size, src: r.src, caption: '' });
      delete tmp.pct;
      touch();
    } catch (er) { cur.body.splice(cur.body.indexOf(tmp), 1); toast(er.message, true); }
    drawBlocks(true);
  }
  function addBlock(kind, touch) {
    if (kind === 'text') { cur.body.push({ t: 'text', html: '' }); drawBlocks(true); const els = $$('[data-html]'); els[els.length - 1]?.focus(); return; }
    if (kind === 'url') {
      const md = modal('Відео або посилання', `<form id="nwUf" class="form-stack"><label class="f"><span>Посилання на YouTube, Vimeo чи Google Диск</span><input name="url" placeholder="https://youtu.be/…" required autocomplete="off"></label>
        <label class="f"><span>Підпис (необов'язково)</span><input name="cap"></label><div class="small muted">Відео показується прямо в статті. Для Google Диску відкрийте доступ «Усі, хто має посилання».</div></form>`,
      { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="nwUok">Додати</button>', focus: '[name=url]' });
      $('#nwUok', md.el).onclick = async () => {
        const f = $('#nwUf', md.el);
        const url = f.url.value.trim();
        if (!/^https?:\/\//i.test(url)) { toast('Посилання має починатися з https://', true); return; }
        cur.body.push({ t: 'video', url, caption: f.cap.value.trim() });
        md.close(); touch(); await save(true); reloadBody();
      };
      return;
    }
    if (kind === 'product') {
      const md = modal('Товар з каталогу', `<div class="form-stack"><input type="search" id="nwPq" placeholder="Назва або артикул" autocomplete="off" aria-label="Пошук товару"><div id="nwPres" class="nw-pres"></div>
        <div class="small muted">Партнер побачить товар зі своєю ціною (якщо бренд йому доступний).</div></div>`, { footer: '<button class="btn" data-close>Закрити</button>', focus: '#nwPq' });
      let t = 0;
      $('#nwPq', md.el).oninput = (e) => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const r = await api('GET', `/api/b2b/news/products?q=${encodeURIComponent(e.target.value)}`).catch(() => ({ products: [] }));
          $('#nwPres', md.el).innerHTML = r.products.map((p) => `<button type="button" data-pp="${p.id}">${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}<span><b>${esc(p.name)}</b><span class="small muted">${esc(p.article || '')} · РРЦ ${uah(p.rrp)}</span></span></button>`).join('') || '<div class="small muted">Не знайдено</div>';
          $$('[data-pp]', md.el).forEach((b) => (b.onclick = () => {
            const p = r.products.find((x) => x.id === Number(b.dataset.pp));
            cur.body.push({ t: 'product', product_id: p.id, p });
            cur.products = [...(cur.products || []), p];
            md.close(); drawBlocks(true); touch();
          }));
        }, 300);
      };
      return;
    }
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = kind !== 'video';
    inp.accept = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : '';
    inp.onchange = () => { for (const f of inp.files) uploadBlock(f, kind, touch); };
    inp.click();
  }

  const payload = () => ({
    title: $('#nwTitle').value, summary: $('#nwSum').value, category: $('#nwCat').value,
    brands: $$('[data-brand]').filter((x) => x.checked).map((x) => Number(x.dataset.brand)),
    audience: $('#nwAud').value === 'some' ? $$('[data-aud]').filter((x) => x.checked).map((x) => Number(x.dataset.aud)) : [],
    pinned: $('#nwPin').checked, tg: $('#nwTg').checked, cover: cur.cover || null,
    body: cur.body.filter((b) => b.t !== 'uploading').map(({ t, html, file, url, caption, product_id }) => ({ t, html, file, url, caption, product_id })),
  });
  async function save(quiet) {
    clearTimeout(saveT);
    if (!cur) return false;
    const onPage = Boolean($('#nwTitle'));
    if (!onPage && !(dirty && cur.last)) return false;
    if (onPage && cur.body.some((b) => b.t === 'uploading')) { if (!quiet) toast('Зачекайте — файл ще завантажується', true); return false; }
    try {
      const p = onPage ? payload() : cur.last;
      if (onPage && $('#nwAud').value === 'some' && !p.audience.length) { if (!quiet) toast('Оберіть хоча б одного партнера або «Усім партнерам»', true); return false; }
      await api('PUT', `/api/b2b/news/${cur.id}`, p);
      dirty = false;
      if ($('#nwSaved')) $('#nwSaved').textContent = `збережено ${fmtDateTime(new Date().toISOString())}`;
      const li = $(`.nw-li[href="#/b2bnews/${cur.id}"] b`);
      if (li) li.textContent = p.title || 'Без заголовка';
      if (!quiet) toast('Збережено');
      return true;
    } catch (er) { toast(er.message, true); return false; }
  }
  async function publish() {
    if (!await save(true)) return;
    const at = $('#nwWhen')?.value === 'at' ? fromKyivLocal($('#nwAt').value) : '';
    if ($('#nwWhen')?.value === 'at' && !at) { toast('Вкажіть дату й час публікації', true); return; }
    const p = payload();
    const who = p.audience.length ? `вибрані партнери (${p.audience.length})` : 'усі партнери';
    const ok = await new Promise((res) => {
      const md = modal(at ? 'Запланувати публікацію?' : 'Опублікувати новину?', `<p style="margin:0">«${esc(p.title || 'Без заголовка')}» побачать ${who} у вкладці «Новини»${at ? ` з ${esc(dDay(at))} ${esc(kyivLocal(at).slice(11))}` : ' одразу'}.</p>
        ${p.tg ? `<p class="small muted">${at ? 'У цей час' : 'Одразу'} в Telegram-групу кожного партнера прийде повідомлення з посиланням на новину (немає групи — користувачам партнера з Telegram).</p>` : '<p class="small muted">Без повідомлення в Telegram.</p>'}`,
      { footer: `<button class="btn" data-close>Скасувати</button><button class="btn primary" id="nwPok">${at ? 'Запланувати' : 'Опублікувати'}</button>` });
      $('#nwPok', md.el).onclick = () => { md.close(); res(true); };
      new MutationObserver((_, o) => { if (!document.contains(md.el)) { o.disconnect(); res(false); } }).observe(document.body, { childList: true });
    });
    if (!ok) return;
    try {
      const r = await api('POST', `/api/b2b/news/${cur.id}/publish`, { at });
      if (r.planned) toast('Заплановано');
      else if (p.tg) await notifyAll();
      else toast('Опубліковано');
      viewNewsAdmin(cur.id);
    } catch (er) { toast(er.message, true); }
  }
  async function notifyAll(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Надсилаю…'; }
    let sent = 0;
    let r = { more: true };
    try {
      for (let k = 0; r.more && k < 20; k++) { r = await api('POST', `/api/b2b/news/${cur.id}/notify`); sent += r.sent || 0; }
      toast(`Опубліковано · повідомлення в Telegram: ${sent} з ${r.total}${r.total > sent ? ' (у кого немає групи чи Telegram — не надіслано)' : ''}`);
    } catch (er) { toast(`Опубліковано, але Telegram: ${er.message}`, true); }
    if (btn) viewNewsAdmin(cur.id);
  }
  function preview() {
    const p = payload();
    const n = { ...cur, ...p, category_name: meta.cats[p.category], publish_at: cur.publish_at || new Date().toISOString(),
      brands: p.brands.map((id) => meta.brands.find((b) => b.id === id)).filter(Boolean),
      body: cur.body.filter((b) => b.t !== 'uploading' && b.t !== 'product').map((b) => ({ ...b, src: b.src || (b.file ? `/api/b2b/news/files/${b.file}` : '') })),
      products: cur.body.filter((b) => b.t === 'product').map((b) => (cur.products || []).find((x) => x.id === b.product_id) || b.p).filter(Boolean) };
    const md = modal('Так побачить партнер', articleHtml(n, { partner: false }), { wide: true, footer: '<button class="btn" data-close>Закрити</button>' });
    md.el.querySelector('.modal').classList.add('nw-preview');
  }

  return { viewNewsAdmin, viewPartnerNews, partnerHomeBlock, leaveCheck: () => (dirty ? save(true) : null) };
}
