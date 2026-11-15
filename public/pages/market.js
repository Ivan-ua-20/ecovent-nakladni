// Маркетплейси: замовлення магазинів Розетки (кабінет продавця), Prom і Епіцентру — вкладка на маркетплейс,
// підвкладки — магазини (назви як у «Налаштування → Доставка»; адміни можуть перейменувати). Лише перегляд.
// Розетка: історія за обраний період, типово 4 роки (завантажується у фоні; поки сторінка відкрита — можна швидше);
// відгуки на товари — фільтр «хто ще не залишив відгук» і нагадування (Viber, Telegram, дзвінок, чат Розетки).
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime, todayKyiv } from '../core/ui.js';

const uah = (n) => `${Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₴`;
const dt = (s) => String(s || '').slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1');
const dDay = (s) => String(s || '').slice(0, 10).split('-').reverse().join('.');
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// Телефон покупця → +380XXXXXXXXX (для Viber, Telegram і дзвінка).
const intlPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 && d.startsWith('0')) return `+38${d}`;
  if (d.length === 9) return `+380${d}`;
  return `+${d}`;
};
const firstName = (full) => { const w = String(full || '').trim().split(/\s+/); return w.length > 1 ? w[1] : w[0] || ''; }; // «Прізвище Ім'я»
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
// Дзвінок Binotel: коли, вхідний/вихідний, розмова чи без відповіді, хто з менеджерів.
const callLine = (x) => `${dt(x.at)} · ${x.dir === 'in' ? 'вхідний' : 'вихідний'} · ${x.disp === 'ANSWER' && x.billsec ? `розмова ${mmss(x.billsec)}` : 'без відповіді'}${x.who ? ` · ${x.who}` : ''}`;
// Позначка «чи був дзвінок до замовлення» і дзвінки після (якщо Binotel підключено).
const callsHtml = (o) => {
  if (!o.calls) return '';
  const { before: b, after: a } = o.calls;
  const pre = b.n ? `<span class="badge ok" title="${esc(`За 30 днів до замовлення: ${b.n} дзв.\nОстанній: ${callLine(b.last)}`)}">📞 був дзвінок до замовлення${b.n > 1 ? ` ×${b.n}` : ''}</span>`
    : '<span class="badge" title="За 30 днів до замовлення дзвінків з цього номера чи на нього не було">без дзвінка до замовлення</span>';
  const post = a.n ? `<div class="small muted" title="${esc(`Після замовлення: ${a.n} дзв., з них з розмовою ${a.answered}`)}">☎ після: ${esc(callLine(a.last))}${a.n > 1 ? ` (усього ${a.n})` : ''}</div>` : '';
  return `<div style="margin-top:3px">${pre}</div>${post}`;
};
const VIA = { viber: 'Viber', telegram: 'Telegram', phone: 'дзвінок', copy: 'текст', chat: 'чат Розетки', manual: 'вручну' };
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* немає доступу до буфера — старий спосіб */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* */ }
  ta.remove();
  return ok;
}

export function createMarketPages({ can }) {
  const state = { status: '', q: '', from: '', to: '', rv: '', grp: '', cancel: '', sel: '' };
  const picked = new Set(); // вибрані «Нові» для групового переведення в обробку
  // Бічна панель: згорнуті групи і вузький режим — пам'ятаємо в цьому браузері.
  const pref = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(`mp.${k}`)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`mp.${k}`, JSON.stringify(v)); } catch { /* приватний режим */ } },
  };
  let lastMp = '';
  let pump = 0; // id «швидшого» завантаження історії (зупиняється, коли пішли зі сторінки)

  async function viewMarket(mp, account = '') {
    // за замовчуванням — останні 30 днів (історія Розетки — десятки тисяч замовлень, «Увесь час» — кнопкою)
    if (mp !== lastMp) { Object.assign(state, { status: '', q: '', from: addDays(todayKyiv(), -30), to: '', rv: '', grp: '', cancel: '', sel: '' }); lastMp = mp; }
    pump++;
    const rz = mp === 'rozetka';
    const [all, rvSet] = await Promise.all([api('GET', '/api/mp/shops'), rz ? api('GET', '/api/mp/review/settings') : null]);
    const m = all.find((x) => x.key === mp);
    const shops = m.shops;
    const acc = shops.find((s) => String(s.id) === String(account)) || null;
    const route = { rozetka: 'mprz', prom: 'mpprom', epc: 'mpepc' }[mp];
    if (!shops.length) {
      main.innerHTML = `<div class="head-row"><h2>${esc(m.title)}</h2></div>
        <div class="card empty"><div class="big">Магазинів ${esc(m.title)} ще не підключено</div>
          Додайте магазин у ${can('api') ? '<a href="#/np">Налаштування → Доставка</a>' : '«Налаштування → Доставка» (адміністратор)'} — і його замовлення з'являться тут за кілька хвилин.</div>`;
      return;
    }
    const total = shops.reduce((a, s) => a + s.orders, 0);
    const syncInfo = (s) => [s.synced_at ? `оновлено ${esc(fmtDateTime(s.synced_at))}` : 'ще не оновлювався', s.loading ? 'довантажує…' : '', !s.active ? 'вимкнено' : '']
      .filter(Boolean).join(' · ');
    const hist = (s) => {
      const h = s.history;
      if (!h) return '';
      if (!h.started) {
        return can('api') ? `<div class="small muted mp-note">Історія «${esc(s.name)}»: зараз лише останні 30 днів.
          <button class="btn sm" data-hstart="${s.id}">Завантажити історію…</button></div>` : '';
      }
      const other = can('api') ? ` <button class="btn sm" data-hstart="${s.id}">${h.done ? 'Завантажити інший період' : 'Змінити період'}</button>` : '';
      if (h.done && !acc) return ''; // завантажену історію показуємо лише на сторінці магазину
      if (h.done) return `<div class="small muted mp-note">✅ Історія «${esc(s.name)}» завантажена за ${esc(dDay(h.from))} – ${esc(dDay(h.end))} · ${h.saved} замовлень${other}</div>`;
      const pausedNote = h.paused ? '<div class="small muted" style="margin:4px 0">На сьогодні денну норму завантажено — продовжиться завтра автоматично (щоб не перевищити ліміт бази для решти сайту).</div>' : '';
      return `<div class="card small" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>⏳ Історія «${esc(s.name)}» за ${esc(dDay(h.from))} – ${esc(dDay(h.end))}: завантажено до ${esc(dDay(h.to))} · ${h.saved} замовлень${other}</span><b>${h.pct}%</b></div>
        <div style="height:6px;background:var(--line);border-radius:4px;margin:6px 0"><div style="height:6px;width:${h.pct}%;background:var(--accent);border-radius:4px"></div></div>
        ${h.error ? `<div class="alert warn small" style="margin:6px 0">Остання спроба: ${esc(h.error)}</div>` : ''}${pausedNote}
        ${h.paused ? '' : `<span class="muted">Вантажиться у фоні (кожні 3 хв). </span><button class="btn sm" data-hfast="${s.id}">Вантажити швидше, поки сторінка відкрита</button>`}</div>`;
    };
    const many = !acc && shops.length > 1;
    main.innerHTML = `
      <div class="mp-top">
        <nav class="f-chips mp-shops" aria-label="Магазини">
          <a class="chip ${acc ? '' : 'on'}" href="#/${route}">Усі магазини · ${total}</a>
          ${shops.map((s) => `<a class="chip ${acc?.id === s.id ? 'on' : ''}" href="#/${route}/${s.id}" title="${esc(syncInfo(s))}">${esc(s.name)} · ${s.orders}${s.error ? ' ⚠️' : ''}</a>`).join('')}
        </nav>
        <span class="small muted">${acc ? syncInfo(acc) : 'оновлюється само кожні кілька хвилин'}</span>
        ${acc && can('api') ? '<button class="btn sm" id="mpRename">Перейменувати</button>' : ''}${acc && can('market.edit') ? `<button class="btn sm" id="mpSync" ${acc.active ? '' : 'disabled'}>Оновити зараз</button>` : ''}
      </div>
      ${(acc ? [acc] : shops).filter((s) => s.error).map((s) => `<div class="alert warn small" style="margin-bottom:10px">⚠️ «${esc(s.name)}»: не вдалося оновити${s.error_at ? ` (${esc(fmtDateTime(s.error_at))})` : ''} — ${esc(s.error)}</div>`).join('')}
      ${(acc ? [acc] : shops).filter((s) => s.active).map(hist).join('')}
      ${(acc ? [acc] : shops).filter((s) => s.active && s.reviews).map((s) => (s.reviews.error ? `<div class="alert warn small" style="margin-bottom:6px">Відгуки «${esc(s.name)}»: ${esc(s.reviews.error)}</div>`
    : !s.reviews.full ? `<div class="small muted" style="margin-bottom:6px">⏳ Відгуки «${esc(s.name)}» завантажуються у фоні${s.reviews.n ? '' : ' — перші з\'являться за кілька хвилин'}.</div>` : '')).join('')}
      <div class="mp-shell${pref.get('rail', false) ? ' rail' : ''}" id="mpShell">
      <aside class="mp-nav" id="mpNav" aria-label="Розділи замовлень"></aside>
      <section class="mp-col" aria-label="Замовлення">
        <div class="mp-col-head">
          <div class="mp-col-title"><h2 id="mpTitle">${esc(m.title)}</h2><span id="mpTotal" class="small muted"></span></div>
          <label class="mp-search"><span class="sr-only">Пошук</span><input id="mpQ" type="search" placeholder="№ замовлення, клієнт, телефон або ТТН" value="${esc(state.q)}"></label>
          <div class="mp-period">
            <button class="btn sm" data-per="30">30 днів</button>${mp === 'rozetka' ? '<button class="btn sm" data-per="365">Рік</button>' : ''}<button class="btn sm" data-per="">Увесь час</button>
            <label class="small muted">з <input type="date" id="mpFrom" value="${esc(state.from)}"></label>
            <label class="small muted">по <input type="date" id="mpTo" value="${esc(state.to)}"></label>
          </div>
          <div id="mpGrpHead"></div>
          <div id="mpStatuses" class="f-chips"></div>
          ${rz ? `<div id="mpRvBox"><div class="f-chips" style="align-items:center"><span class="small muted">Відгуки:</span><span id="mpRv" class="f-chips"></span>
            ${can('api') ? '<button class="btn sm" id="mpRvSet">Текст нагадування</button>' : ''}</div><div id="mpRvStats" class="small muted"></div></div>` : ''}
        </div>
        <div id="mpBulk"></div>
        <div id="mpList" class="mp-list"><div class="mp-empty"><span class="spinner"></span> Завантажую…</div></div>
      </section>
      <aside class="mp-detail" id="mpDetail" aria-label="Замовлення"><div class="mp-empty">Оберіть замовлення зі списку</div></aside>
      </div>`;

    const name = new Map(shops.map((s) => [s.id, s.name]));
    const byKey = new Map(); // замовлення на екрані — для вікна нагадування
    // Відгуки замовлення по товарах: на які товари вже є відгук (за кодом товару, для старих рядків — за назвою).
    const revInfo = (o) => {
      const seen = new Set();
      const items = o.items.filter((it) => { const k = it.id || it.name; if (seen.has(k)) return false; seen.add(k); return true; });
      const revs = o.reviews || [];
      const norm = (x) => String(x || '').trim().toLowerCase();
      const done = items.map((it) => revs.some((v) => (it.id && v.goods_id && v.goods_id === it.id) || (it.name && norm(v.goods) === norm(it.name))));
      let doneN = done.filter(Boolean).length;
      if (!doneN && o.review_n > 0) doneN = Math.min(items.length || 1, new Set(revs.map((v) => v.goods_id || v.goods)).size || 1); // не зіставилось — хоча б кількість
      return { items, done, doneN, total: Math.max(items.length, 1), two: Boolean(o.recipient) };
    };
    const rvCell = (o) => {
      byKey.set(`${o.account_id}:${o.id}`, o);
      const ri = revInfo(o);
      const twoNote = ri.two && o.review_n < 2 ? '<div class="muted" title="Замовник і отримувач — різні люди: відгук може залишити кожен">👥 можна 2 відгуки</div>' : '';
      const asked = o.asked_at ? `<div class="muted">нагадав ${esc(dDay(o.asked_at.slice(0, 10)))}${o.asked_by ? ` · ${esc(o.asked_by)}` : ''}${o.asked_via ? ` · ${esc(VIA[o.asked_via] || o.asked_via)}` : ''}</div>` : '';
      if (o.review_n > 0) {
        const tip = (o.reviews || []).map((v) => `★${v.mark || '—'} ${v.goods}${v.name ? ` — ${v.name}` : ''}`).join('\n');
        const part = ri.total > 1 ? `<div class="${ri.doneN < ri.total ? '' : 'muted'}">товарів з відгуком: ${ri.doneN} з ${ri.total}</div>` : '';
        const more = o.ok && (ri.doneN < ri.total || (ri.two && o.review_n < 2));
        return `<span class="badge ok" title="${esc(tip)}">✓ відгук${o.review_mark ? ` ★${o.review_mark}` : ''}</span>${o.review_n > 1 ? ` <span class="muted">×${o.review_n}</span>` : ''}${part}${twoNote}${more && can('market.edit') ? `${asked}<button class="btn sm" data-rvask="${esc(o.account_id)}:${esc(o.id)}">Нагадати ще</button>` : ''}`;
      }
      if (!o.ok) return asked || '<span class="muted">—</span>';
      if (!can('market.edit')) return `${twoNote}${asked}`;
      return `${twoNote}${asked}<button class="btn sm ${o.asked_at ? '' : 'primary'}" data-rvask="${esc(o.account_id)}:${esc(o.id)}">${o.asked_at ? 'Ще раз' : 'Нагадати'}</button>`;
    };
    const keyOf = (o) => `${o.account_id}:${o.id}`;
    const canPick = (o) => rz && state.grp === 'new' && can('market.edit') && String(o.status) === '1';
    // скільки чекає нове замовлення (дати Розетки — за Києвом)
    const kyivNow = () => Date.parse(`${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T')}Z`);
    const waitOf = (o) => {
      const min = Math.max(0, Math.round((kyivNow() - Date.parse(`${String(o.created_at).slice(0, 19).replace(' ', 'T')}Z`)) / 60e3));
      if (!Number.isFinite(min)) return '';
      const t = min < 60 ? `${min} хв` : min < 1440 ? `${Math.floor(min / 60)} год ${min % 60} хв` : `${Math.floor(min / 1440)} дн`;
      return `<span class="${min >= 30 ? 'mp-late' : 'muted'}">чекає ${t}</span>`;
    };
    const callMini = (o) => {
      if (!o.calls) return '';
      const b = o.calls.before;
      const a = o.calls.after;
      return `<div class="mp-l4">${b.n ? '<span class="mp-tag ok">📞 був дзвінок до замовлення</span>' : '<span class="mp-tag">без дзвінка до замовлення</span>'}${a.n ? ` <span class="muted">☎ менеджер: ${esc(dt(a.last.at))}${a.answered ? '' : ' · без відповіді'}</span>` : ''}</div>`;
    };
    const showRv = () => rz && (state.grp === 'success' || state.rv);
    const rowHtml = (o) => (byKey.set(keyOf(o), o), `<div class="mp-row${state.sel === keyOf(o) ? ' on' : ''}" data-ok="${esc(keyOf(o))}" tabindex="0">
          ${canPick(o) ? `<label class="mp-pick"><input type="checkbox" data-pick="${esc(keyOf(o))}" ${picked.has(keyOf(o)) ? 'checked' : ''} aria-label="Вибрати ${esc(o.number)}"></label>` : ''}
          <div class="mp-row-b">
            <div class="mp-l1"><span><b>${esc(o.number)}</b> <span class="small muted">${esc(dt(o.created_at))}</span></span><b>${uah(o.total)}</b></div>
            <div class="mp-l2">${o.items.length ? `${esc(o.items[0].name)}${o.items[0].qty > 1 ? ` × ${o.items[0].qty}` : ''}${o.items.length > 1 ? ` <span class="muted">+${o.items.length - 1}</span>` : ''}` : '—'}</div>
            <div class="mp-l3"><span>${esc(o.customer || '—')}${o.delivery ? ` · ${esc(o.delivery)}` : ''}${many ? ` · ${esc(name.get(o.account_id) || '')}` : ''}</span>
              ${rz && String(o.status) === '1' && state.grp === 'new' ? waitOf(o) : `<span class="badge">${esc(o.status_name || o.status || '—')}</span>`}</div>
            ${callMini(o)}
            ${showRv() ? `<div class="mp-l4" data-rvcell="${esc(keyOf(o))}">${rvCell(o)}</div>` : ''}
          </div>
        </div>`);
    let offset = 0;
    const load = async (more = false) => {
      offset = more ? offset + 300 : 0;
      const qs = new URLSearchParams({ mp, offset: String(offset), ...(acc ? { account: acc.id } : {}), ...(state.status ? { status: state.status } : {}),
        ...(state.q ? { q: state.q } : {}), ...(state.from ? { from: state.from } : {}), ...(state.to ? { to: state.to } : {}), ...(state.rv ? { rv: state.rv } : {}),
        ...(state.grp ? { grp: state.grp } : {}), ...(state.cancel ? { cancel: state.cancel } : {}) });
      const d = await api('GET', `/api/mp/orders?${qs}`);
      renderNav(d);
      // підстатуси: у групі Розетки — лише її статуси; Prom і Епіцентр — статуси в бічній панелі
      const inGrp = rz ? d.statuses.filter((x) => !state.grp || state.grp === 'call' || x.grp === state.grp) : [];
      const grpSum = inGrp.reduce((a, x) => a + x.n, 0);
      $('#mpStatuses').innerHTML = rz && state.grp !== 'call' && inGrp.length > 1 ? `<button class="chip ${state.status ? '' : 'on'}" data-st="">Усі · ${grpSum}</button>${inGrp.map((x) => `<button class="chip ${state.status === x.status ? 'on' : ''}" data-st="${esc(x.status)}">${esc(x.status_name || x.status || '—')} · ${x.n}</button>`).join('')}` : '';
      $$('#mpStatuses [data-st]').forEach((b) => (b.onclick = () => { state.status = b.dataset.st; load(); }));
      $('#mpGrpHead').innerHTML = grpHead(d);
      $$('#mpGrpHead [data-cancel]').forEach((b) => (b.onclick = () => { state.cancel = b.dataset.cancel; state.status = ''; load(); }));
      if ($('#mpRvBox')) $('#mpRvBox').hidden = Boolean(state.grp && state.grp !== 'success');
      if (rz && d.reviews) {
        const s = d.reviews.stats;
        const pct = s.done ? Math.round((s.reviewed / s.done) * 100) : 0;
        const chips = [['', 'Усі'], ['ask', `Можна нагадати · ${s.toask}`], ['none', `Без відгуку · ${s.done - s.reviewed}`], ['asked', `Нагадали, чекаємо · ${s.asked - s.asked_reviewed}`], ['has', `З відгуком · ${s.reviewed}`]];
        $('#mpRv').innerHTML = chips.map(([k, t]) => `<button class="chip ${state.rv === k ? 'on' : ''}" data-rv="${k}" ${k === 'ask' ? `title="Виконані замовлення без відгуку, отримані щонайменше ${d.reviews.days} дн. тому, яким ще не нагадували"` : ''}>${esc(t)}</button>`).join('');
        $$('[data-rv]').forEach((b) => (b.onclick = () => { state.rv = b.dataset.rv; load(); }));
        $('#mpRvStats').innerHTML = s.done ? `Виконано ${s.done} замовлень · з відгуком на товар <b>${s.reviewed}</b> (${pct}%) · нагадали ${s.asked}, з них залишили відгук <b>${s.asked_reviewed}</b>${
          d.reviews.by.length ? ` · ${d.reviews.by.map((m) => `${esc(m.who || 'без імені')}: ${m.n} (відгуків ${m.reviewed})`).join(', ')}` : ''}` : '';
      }
      const tot = d.total || { n: 0, sum: 0 };
      $('#mpTotal').innerHTML = tot.n ? `${tot.n} замовл. · ${uah(tot.sum)}` : '';
      $('#mpTitle').textContent = rz ? (GROUPS.find(([k]) => k === state.grp)?.[1] || 'Усі замовлення') : (d.statuses.find((x) => x.status === state.status)?.status_name || 'Усі замовлення');
      const moreBtn = d.more ? '<div class="mp-more"><button class="btn sm" id="mpMore">Показати ще</button></div>' : '';
      if (more) {
        $('#mpMore')?.parentElement.insertAdjacentHTML('beforebegin', d.rows.map(rowHtml).join(''));
        bindAsk();
        $('#mpMore')?.parentElement.remove();
        $('#mpList').insertAdjacentHTML('beforeend', moreBtn);
      } else {
        $('#mpList').innerHTML = d.rows.length ? `${d.rows.map(rowHtml).join('')}${moreBtn}`
          : `<div class="mp-empty">${state.q || state.status || state.from || state.to || state.rv ? 'Нічого не знайдено.' : 'Замовлень ще немає — вони з\'являться після першого оновлення (кілька хвилин).'}</div>`;
      }
      if ($('#mpMore')) $('#mpMore').onclick = () => load(true);
      if (!more) bindAsk();
      bindRows();
      bindPick();
      if (!more) {
        // картка: обране раніше, а на широкому екрані — перше замовлення списку
        const first = d.rows[0] ? keyOf(d.rows[0]) : '';
        const k = byKey.has(state.sel) ? state.sel : wide() ? first : '';
        if (k) showDetail(byKey.get(k)); else closeDetail();
      }
    };

    // ---------- бічна панель: групи замовлень Розетки (або статуси Prom і Епіцентру), згортання ----------
    const GROUPS = [
      ['', 'Усі замовлення'], ['new', 'Нові', 'red'], ['work', 'В обробці'], ['call', 'Потрібно зателефонувати', 'amber'], ['delivery', 'Доставляється'],
      ['success', 'Успішні'], ['failed', 'Неуспішні'], ['cancelled', 'Скасовані'],
    ];
    const SHORT = { '': 'Усі', new: 'Нові', work: 'Обр.', call: 'Дзв.', delivery: 'Дост.', success: 'Усп.', failed: 'Неусп.', cancelled: 'Скас.', 'rv-ask': 'Відг.' };
    const fmtN = (n) => Number(n || 0).toLocaleString('uk-UA');
    function renderNav(d) {
      const nav = $('#mpNav');
      const closed = pref.get('closed', []);
      const rail = $('#mpShell').classList.contains('rail');
      const total = d.statuses.reduce((a, x) => a + x.n, 0);
      const items = rz ? GROUPS.map(([k, t, kind]) => ({ k, t, kind, n: k ? d.groups?.[k] || 0 : total, on: state.grp === k && !(k === 'success' && state.rv === 'ask') }))
        : [{ k: '', t: 'Усі', n: total, on: !state.status }, ...d.statuses.map((x) => ({ k: x.status, t: x.status_name || x.status || '—', n: x.n, on: state.status === x.status }))];
      const sections = [{ id: 'orders', title: rz ? 'Замовлення' : 'Статуси', items }];
      if (rz && d.reviews) sections.push({ id: 'talk', title: 'Спілкування', items: [{ k: 'rv-ask', t: 'Відгуки: можна нагадати', kind: 'amber', n: d.reviews.stats.toask || 0, on: state.grp === 'success' && state.rv === 'ask' }] });
      const pill = (it) => (it.n && it.kind && !it.on ? `<span class="mp-pill ${it.kind}">${fmtN(it.n)}</span>` : `<span class="mp-n">${fmtN(it.n)}</span>`);
      nav.innerHTML = `<div class="mp-nav-top">${rail ? '' : `<span>${esc(acc ? acc.name : m.title)}</span>`}
          <button type="button" class="mp-nav-btn" id="mpRail" aria-label="${rail ? 'Розгорнути панель' : 'Згорнути панель'}" title="${rail ? 'Розгорнути панель' : 'Згорнути панель'}">${rail ? '›' : '‹'}</button></div>
        ${sections.map((sec) => {
    const shut = !rail && closed.includes(sec.id) && window.innerWidth > 760; // на телефоні заголовків груп немає — завжди розгорнуто
    const hot = sec.items.filter((it) => it.kind).reduce((a, it) => a + it.n, 0);
    return `${rail ? '' : `<button type="button" class="mp-sec" data-sec="${sec.id}" aria-expanded="${!shut}"><span class="mp-chev${shut ? ' shut' : ''}" aria-hidden="true">▾</span><span style="flex:1">${esc(sec.title)}</span>${shut && hot ? `<span class="mp-pill red">${fmtN(hot)}</span>` : ''}</button>`}
          ${shut ? '' : sec.items.map((it) => `<button type="button" class="mp-item${it.on ? ' on' : ''}" data-nav="${esc(it.k)}" title="${esc(it.t)}">${rail ? `<span>${esc(SHORT[it.k] ?? it.t.slice(0, 5))}</span>` : `<span class="mp-t">${esc(it.t)}</span>`}${pill(it)}</button>`).join('')}`;
  }).join('')}`;
      $('#mpRail').onclick = () => { const on = !$('#mpShell').classList.contains('rail'); $('#mpShell').classList.toggle('rail', on); pref.set('rail', on); renderNav(d); };
      $$('[data-sec]', nav).forEach((b) => (b.onclick = () => {
        const c = pref.get('closed', []);
        pref.set('closed', c.includes(b.dataset.sec) ? c.filter((x) => x !== b.dataset.sec) : [...c, b.dataset.sec]);
        renderNav(d);
      }));
      $$('[data-nav]', nav).forEach((b) => (b.onclick = () => {
        const k = b.dataset.nav;
        if (!rz) state.status = k;
        else if (k === 'rv-ask') Object.assign(state, { grp: 'success', rv: 'ask', status: '', cancel: '' });
        else Object.assign(state, { grp: k, status: '', cancel: '', rv: '' });
        load();
      }));
    }
    function grpHead(d) {
      if (!rz) return '';
      if (state.grp === 'call') {
        return '<div class="card small" style="margin-bottom:10px">Потрібно зателефонувати: планується повторний дзвінок; очікує оплату понад добу; посилка 4+ дні в пункті видачі; нове замовлення понад 30 хв без обробки.</div>';
      }
      if (state.grp !== 'cancelled') return '';
      const c = d.cancels || {};
      const all = (c.client || 0) + (c.manager || 0) + (c.auto || 0);
      return `<div class="f-chips" style="margin-bottom:8px"><span class="small muted" style="align-self:center">Хто скасував:</span>
        ${[['', `Усі · ${all}`, 'Усі скасовані'], ['client', `Покупцем · ${c.client || 0}`, 'Покупець скасував сам у Розетці'], ['manager', `Менеджером · ${c.manager || 0}`, 'Менеджер скасував з причиною (передумав, немає в наявності, не вдалося зв\'язатися…)'], ['auto', `Автоматично · ${c.auto || 0}`, 'Розетка сама: не оплатив вчасно, повторне замовлення (дубль)']]
    .map(([k, t, tip]) => `<button class="chip ${state.cancel === k ? 'on' : ''}" data-cancel="${k}" title="${esc(tip)}">${esc(t)}</button>`).join('')}</div>`;
    }

    // ---------- групове переведення «Нових» в «Обробляється менеджером» ----------
    function bindPick() {
      const boxes = $$('#mpList [data-pick]');
      const keys = boxes.map((x) => x.dataset.pick);
      for (const k of [...picked]) if (!keys.includes(k)) picked.delete(k); // лише ті, що на екрані
      const bar = $('#mpBulk');
      if (!boxes.length) { bar.innerHTML = ''; return; }
      const n = picked.size;
      bar.innerHTML = `<div class="mp-bulk${n ? ' on' : ''}"><label class="check"><input type="checkbox" id="mpPickAll" ${n && n === keys.length ? 'checked' : ''}> ${n ? `Вибрано ${n}` : 'Вибрати всі'}</label>
        ${n ? `<button type="button" class="btn sm" id="mpPickNone">Зняти</button><button type="button" class="btn sm primary" id="mpPickGo">Перевести в «Обробляється менеджером»</button>` : '<span class="small muted">Позначте замовлення, щоб перевести їх в обробку одним кліком</span>'}</div>`;
      $('#mpPickAll').indeterminate = n > 0 && n < keys.length;
      $('#mpPickAll').onchange = (e) => { picked.clear(); if (e.target.checked) keys.forEach((k) => picked.add(k)); boxes.forEach((x) => { x.checked = picked.has(x.dataset.pick); }); bindPick(); };
      boxes.forEach((x) => (x.onchange = () => { if (x.checked) picked.add(x.dataset.pick); else picked.delete(x.dataset.pick); bindPick(); }));
      if ($('#mpPickNone')) $('#mpPickNone').onclick = () => { picked.clear(); boxes.forEach((x) => { x.checked = false; }); bindPick(); };
      if ($('#mpPickGo')) $('#mpPickGo').onclick = () => moveToWork([...picked]);
    }
    async function moveToWork(keys) {
      if (!(await confirmDanger(`Перевести ${keys.length} замовл. в «Обробляється менеджером»?`, 'Статус зміниться в кабінеті Розетки — покупець побачить, що замовлення обробляється. Повернути «Нове» не можна.', 'Перевести'))) return;
      const b = $('#mpPickGo');
      if (b) { b.disabled = true; b.innerHTML = '<span class="spinner"></span> Переводжу…'; }
      let todo = keys.map((k) => { const [account, ...id] = k.split(':'); return { account: Number(account), id: id.join(':'), key: k }; });
      const done = [];
      const failed = [];
      let guard = 0;
      while (todo.length && guard++ < 200) {
        const part = todo.slice(0, 10);
        try {
          const r = await api('POST', '/api/mp/rz/status', { status: 26, orders: part.map(({ account, id }) => ({ account, id })) });
          done.push(...r.done);
          const retry = new Set(r.failed.filter((x) => x.retry).map((x) => x.key));
          failed.push(...r.failed.filter((x) => !x.retry));
          const handled = new Set([...r.done, ...r.failed.filter((x) => !x.retry).map((x) => x.key)]);
          todo = [...part.filter((x) => !handled.has(x.key) || retry.has(x.key)), ...todo.slice(10)];
          if (b) b.innerHTML = `<span class="spinner"></span> Переведено ${done.length} з ${keys.length}…`;
        } catch (er) { failed.push(...part.map((x) => ({ key: x.key, error: er.message }))); todo = todo.slice(10); }
      }
      picked.clear();
      if (done.length) toast(`Переведено в «Обробляється менеджером»: ${done.length}`);
      if (failed.length) {
        const num = (k) => byKey.get(k)?.number || k.split(':')[1];
        modal('Не всі замовлення переведено', `<div class="small">${failed.map((x) => `<div>№${esc(num(x.key))}: ${esc(x.error)}</div>`).join('')}</div>`, { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
      }
      load();
    }

    // ---------- картка замовлення праворуч ----------
    function bindRows() {
      $$('#mpList [data-ok]').forEach((el) => {
        el.onclick = (e) => {
          if (e.target.closest('button, a, input, select, label')) return;
          const o = byKey.get(el.dataset.ok);
          if (o) showDetail(o);
        };
        el.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); el.click(); } };
      });
    }
    const wide = () => window.innerWidth > 1150;
    function closeDetail() {
      state.sel = '';
      $('#mpDetail').innerHTML = '<div class="mp-empty">Оберіть замовлення зі списку</div>';
      $('#mpShell').classList.remove('detail');
      $$('#mpList .mp-row.on').forEach((x) => x.classList.remove('on'));
    }
    async function showDetail(o) {
      state.sel = keyOf(o);
      $$('#mpList [data-ok]').forEach((x) => x.classList.toggle('on', x.dataset.ok === state.sel));
      const box = $('#mpDetail');
      $('#mpShell').classList.add('detail');
      const ph = intlPhone(o.phone);
      const items = o.items.map((it) => `<div class="mp-goods"><span>${esc(it.name)}${it.qty > 1 ? ` <span class="muted">× ${it.qty}</span>` : ''}</span><b>${it.price ? uah(it.price * (it.qty || 1)) : ''}</b></div>`).join('') || '<div class="muted">—</div>';
      box.innerHTML = `<div class="mp-d-head"><div style="flex:1"><b style="font-size:16px">Замовлення ${esc(o.number)}</b><div class="small muted">${esc(dt(o.created_at))} · ${esc(name.get(o.account_id) || '')}${o.changed_at ? ` · змінено ${esc(dt(o.changed_at))}` : ''}</div></div>
          <span class="badge info">${esc(o.status_name || o.status || '—')}</span>
          <button type="button" class="btn sm" id="mpDClose" aria-label="Закрити картку">✕</button></div>
        <div class="mp-d-body">
          ${canPick(o) ? '<div class="mp-wide-box"><button type="button" class="btn primary" id="mpDTake">Взяти в обробку</button> <span class="small muted">→ «Обробляється менеджером» у Розетці</span></div>' : ''}
          <div class="mp-box"><div class="mp-cap">Покупець</div><b>${esc(o.customer || '—')}</b>
            ${ph ? `<div class="btn-row" style="margin-top:4px;flex-wrap:wrap;align-items:center"><span>${esc(ph)}</span><a class="btn sm" href="tel:${esc(ph)}">Подзвонити</a><button type="button" class="btn sm" id="mpDCopy">Копіювати</button></div>` : ''}
            ${o.recipient ? `<div class="small muted" style="margin-top:4px">Отримувач: ${esc(o.recipient)}${o.recipient_phone ? ` · ${esc(o.recipient_phone)}` : ''}</div>` : ''}
            ${callsHtml(o)}</div>
          <div class="mp-box"><div class="mp-cap">Доставка</div>${esc(o.delivery || '—')}${o.ttn ? `<div class="small">ТТН <b>${esc(o.ttn)}</b></div>` : ''}</div>
          <div class="mp-box mp-wide-box"><div class="mp-cap">Товари</div>${items}<div class="mp-goods" style="border-top:1px solid var(--line);padding-top:6px;margin-top:4px"><span>Разом</span><b>${uah(o.total)}</b></div></div>
          ${rz ? `<div class="mp-box mp-wide-box"><div class="mp-cap">Відгук</div><div class="small">${rvCell(o)}</div></div>` : ''}
          ${rz && o.calls ? '<div class="mp-box mp-wide-box"><div class="mp-cap">Дзвінки Binotel з цим номером</div><div id="mpDCalls" class="small muted"><span class="spinner"></span></div></div>' : ''}
        </div>`;
      $('#mpDClose').onclick = closeDetail;
      if ($('#mpDTake')) $('#mpDTake').onclick = () => moveToWork([keyOf(o)]);
      if ($('#mpDCopy')) $('#mpDCopy').onclick = async () => { if (await copyText(ph)) toast('Телефон скопійовано'); };
      $$('[data-rvask]', box).forEach((b) => (b.onclick = () => askModal(byKey.get(b.dataset.rvask))));
      if ($('#mpDCalls')) {
        const key = state.sel;
        try {
          const r = await api('GET', `/api/tel/calls?${new URLSearchParams({ phones: [o.phone, o.recipient_phone].filter(Boolean).join(',') })}`);
          if (state.sel !== key || !$('#mpDCalls')) return;
          $('#mpDCalls').classList.remove('muted');
          $('#mpDCalls').innerHTML = r.calls.length ? r.calls.map((x) => `<div class="mp-call${x.at > o.created_at ? '' : ' pre'}">${esc(callLine(x))}${x.at <= o.created_at ? ' <span class="muted">· до замовлення</span>' : ''}</div>`).join('')
            : '<span class="muted">Дзвінків з цим номером не було</span>';
        } catch (er) { if ($('#mpDCalls')) $('#mpDCalls').textContent = er.message; }
      }
    }

    // ---------- нагадування про відгук ----------
    function bindAsk() {
      $$('[data-rvask]').forEach((b) => (b.onclick = () => askModal(byKey.get(b.dataset.rvask))));
    }
    const fillTpl = (o) => String(rvSet?.tpl || '')
      .replaceAll("{ім'я}", firstName(o.customer)).replaceAll('{імʼя}', firstName(o.customer))
      .replaceAll('{товар}', String((revInfo(o).items.find((_, i) => !revInfo(o).done[i]) || o.items[0])?.name || 'товар').slice(0, 90)).replaceAll('{замовлення}', o.number).replaceAll('{магазин}', name.get(o.account_id) || '')
      .replace(/ ,/g, ',').replace(/\s{2,}/g, ' ');
    function askModal(o) {
      if (!o) return;
      const ri = revInfo(o);
      // замовник і (якщо інша людина) отримувач — кожному свої кнопки
      const people = [{ role: 'Замовник', name: o.customer, phone: o.phone }, ...(o.recipient ? [{ role: 'Отримувач', name: o.recipient, phone: o.recipient_phone }] : [])];
      const personHtml = (p, i) => {
        const ph = intlPhone(p.phone);
        const d = ph.replace(/\D/g, '');
        return `<div style="margin:6px 0"><span class="small muted">${p.role}:</span> <b>${esc(p.name || '—')}</b>${ph ? ` · ${esc(ph)}` : ''}
          <div class="btn-row" style="flex-wrap:wrap;margin-top:4px">${ph ? `<a class="btn sm" data-via="viber" data-p="${i}" href="viber://chat?number=%2B${d}">Viber</a>
          <a class="btn sm" data-via="telegram" data-p="${i}" href="https://t.me/+${d}" target="_blank" rel="noopener">Telegram</a>
          <a class="btn sm" data-via="phone" data-p="${i}" href="tel:${esc(ph)}">Подзвонити</a>` : '<span class="small muted">телефону немає</span>'}</div></div>`;
      };
      const md = modal(`Нагадати про відгук · №${o.number}`, `
        <div class="small" style="margin-bottom:8px">
          <div class="muted">${esc(o.status_name || '')} · ${esc(dt(o.changed_at))}</div>
          <div style="margin:4px 0">${ri.items.map((it, i) => `${ri.done[i] ? '✅' : '▫️'} ${esc(it.name)}`).join('<br>') || '—'}</div>
          ${ri.items.length > 1 ? '<div class="muted">✅ — на цей товар відгук уже є; відгук можна залишити на кожен товар.</div>' : ''}
          ${o.recipient ? '<div class="muted">👥 Замовник і отримувач — різні люди: відгук може залишити кожен.</div>' : ''}
          ${people.map(personHtml).join('')}</div>
        <label class="f"><span>Повідомлення (можна змінити)</span><textarea id="rvText" rows="6" style="width:100%">${esc(fillTpl(o))}</textarea></label>
        <div class="small muted" style="margin:4px 0 10px">Viber і Telegram відкриють чат — текст уже буде скопійовано (з ім'ям того, кому пишете), лишиться вставити. У чат Розетки (його бачить замовник) — без посилань і телефонів.</div>
        <div class="btn-row" style="flex-wrap:wrap">
          <button class="btn" data-via="copy">Скопіювати текст</button>
          <button class="btn" id="rvChat">Надіслати в чат Розетки</button>
        </div>`,
      { footer: `${o.asked_at ? '<button class="btn" id="rvUndo">Зняти позначку</button>' : ''}<button class="btn" id="rvManual">Нагадав іншим способом</button><button class="btn primary" data-close>Готово</button>` });
      const text = () => $('#rvText', md.el).value.trim();
      const mark = async (via) => {
        try { Object.assign(o, await api('POST', '/api/mp/review/ask', { account: o.account_id, id: o.id, via })); toast(`Позначено: нагадав (${VIA[via]})`); load(); }
        catch (er) { toast(er.message, true); }
      };
      // текст для отримувача — з його ім'ям замість імені замовника
      const textFor = (i) => {
        const t = text();
        const was = firstName(o.customer);
        const now = firstName(people[Number(i) || 0]?.name);
        return was && now && was !== now ? t.split(was).join(now) : t;
      };
      $$('[data-via]', md.el).forEach((b) => (b.onclick = async () => {
        if (b.dataset.via !== 'phone') await copyText(textFor(b.dataset.p));
        mark(b.dataset.via); // посилання відкривається саме (href)
      }));
      $('#rvManual', md.el).onclick = async () => { await mark('manual'); md.close(); };
      if ($('#rvUndo', md.el)) $('#rvUndo', md.el).onclick = async () => {
        try { await api('POST', '/api/mp/review/ask', { account: o.account_id, id: o.id, undo: true }); md.close(); load(); } catch (er) { toast(er.message, true); }
      };
      $('#rvChat', md.el).onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true; b.innerHTML = '<span class="spinner"></span> Надсилаю…';
        try { await api('POST', '/api/mp/review/chat', { account: o.account_id, id: o.id, text: text() }); toast('Надіслано в чат Розетки'); md.close(); load(); }
        catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Надіслати в чат Розетки'; }
      };
    }
    if ($('#mpRvSet')) $('#mpRvSet').onclick = () => {
      const md = modal('Нагадування про відгук', `<form id="rvSetF" class="form-stack">
        <label class="f"><span>Пропонувати нагадати через (днів після отримання)</span><input name="days" type="number" min="0" max="60" value="${esc(rvSet.days)}" required></label>
        <label class="f"><span>Текст повідомлення. Підставляються: {ім'я}, {товар}, {замовлення}, {магазин}</span><textarea name="tpl" rows="6" required>${esc(rvSet.tpl)}</textarea></label>
        <div class="small muted">Для чату Розетки — без посилань, телефонів і реклами. Просимо саме чесний відгук: за накручені відгуки Розетка накладає санкції.</div></form>`,
      { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="rvSetSave">Зберегти</button>' });
      $('#rvSetSave', md.el).onclick = async () => {
        const f = $('#rvSetF', md.el);
        try { Object.assign(rvSet, await api('PUT', '/api/mp/review/settings', { days: Number(f.days.value), tpl: f.tpl.value })); md.close(); toast('Збережено'); load(); }
        catch (er) { toast(er.message, true); }
      };
    };
    let t = 0;
    $('#mpQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 300); };
    $('#mpFrom').onchange = (e) => { state.from = e.target.value; load(); };
    $('#mpTo').onchange = (e) => { state.to = e.target.value; load(); };
    $$('[data-per]').forEach((b) => (b.onclick = () => {
      state.to = '';
      state.from = b.dataset.per ? addDays(todayKyiv(), -Number(b.dataset.per)) : '';
      $('#mpFrom').value = state.from; $('#mpTo').value = '';
      load();
    }));
    if ($('#mpSync')) $('#mpSync').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Оновлюю…';
      try { const r = await api('POST', '/api/mp/sync', { mp, account: acc.id }); toast(`Оновлено: ${r.saved} замовлень${r.more ? ' — решту довантажить автоматично' : ''}`); viewMarket(mp, acc.id); }
      catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Оновити зараз'; }
    };
    if ($('#mpRename')) $('#mpRename').onclick = () => {
      const md = modal(`Перейменувати «${acc.name}»`, `<form id="mpRn" class="form-stack"><label class="f"><span>Назва магазину (так само зміниться в налаштуваннях доставки)</span><input name="name" value="${esc(acc.name)}" required autocomplete="off"></label></form>`,
        { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="mpRnSave">Зберегти</button>' });
      $('#mpRnSave', md.el).onclick = async () => {
        try { await api('PUT', `/api/mp/shops/${mp}/${acc.id}`, { name: $('#mpRn', md.el).name.value }); md.close(); toast('Перейменовано'); viewMarket(mp, acc.id); }
        catch (er) { toast(er.message, true); }
      };
    };
    // Період історії: типово 4 роки до сьогодні; можна давніший (старий кабінет) або інший відрізок.
    $$('[data-hstart]').forEach((b) => (b.onclick = () => {
      const s = shops.find((x) => x.id === Number(b.dataset.hstart));
      const h = s?.history || {};
      const today = todayKyiv();
      const md = modal(`Історія «${s?.name || ''}»`, `<form id="hsF" class="form-stack">
        <div class="btn-row" style="flex-wrap:wrap">
          <label class="f"><span>З</span><input type="date" name="from" min="2010-01-01" max="${today}" value="${addDays(today, -4 * 365)}" required></label>
          <label class="f"><span>По</span><input type="date" name="to" min="2010-01-01" max="${today}" value="${today}" required></label>
        </div>
        <div class="btn-row" style="flex-wrap:wrap"><span class="small muted">Швидко:</span>
          ${[[1, 'рік'], [2, '2 роки'], [4, '4 роки'], [8, '8 років']].map(([y, t]) => `<button type="button" class="btn sm" data-hy="${y}">${t}</button>`).join('')}
          <button type="button" class="btn sm" data-hy="all">з 2010 року</button></div>
        <div class="small muted">Завантажене раніше лишається в базі. За добу — до 15 000 замовлень (щоб не перевищити ліміт бази для решти сайту), більші періоди довантажаться наступними днями.
          ${h.started && !h.done ? '<br><b>Поточне завантаження зупиниться</b> — почнеться новий період.' : ''}</div></form>`,
      { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="hsGo">Завантажити</button>' });
      const f = $('#hsF', md.el);
      $$('[data-hy]', md.el).forEach((x) => (x.onclick = () => { f.from.value = x.dataset.hy === 'all' ? '2010-01-01' : addDays(today, -Number(x.dataset.hy) * 365); f.to.value = today; }));
      $('#hsGo', md.el).onclick = async (e) => {
        const go = e.currentTarget;
        go.disabled = true;
        try {
          await api('POST', '/api/mp/history/start', { mp, account: s.id, from: f.from.value, to: f.to.value });
          md.close(); toast('Історію почато — вантажиться у фоні'); viewMarket(mp, account);
        } catch (er) { toast(er.message, true); go.disabled = false; }
      };
    }));
    $$('[data-hfast]').forEach((b) => (b.onclick = async () => {
      const my = ++pump;
      const id = Number(b.dataset.hfast);
      b.disabled = true;
      for (;;) {
        if (my !== pump || !document.contains(b)) return; // пішли зі сторінки або перемальовано
        let h;
        try { h = await api('POST', '/api/mp/history/step', { mp, account: id }); } catch (er) { toast(er.message, true); b.disabled = false; return; }
        b.textContent = `Вантажу… ${h.pct}% · до ${dDay(h.to)} · ${h.saved} замовлень`;
        if (h.done) { toast('Історію завантажено'); viewMarket(mp, account); return; }
        if (h.paused) { toast('Денну норму завантажено — історія продовжиться завтра'); viewMarket(mp, account); return; }
        if (h.error) { toast(h.error, true); b.disabled = false; return; }
      }
    }));
    await load();
  }
  return { viewMarket };
}
