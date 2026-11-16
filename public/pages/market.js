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
  const state = { status: '', q: '', from: '', to: '', rv: '', grp: '', cancel: '', sel: '', crm: '' };
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
    if (mp !== lastMp) { Object.assign(state, { status: '', q: '', from: addDays(todayKyiv(), -30), to: '', rv: '', grp: '', cancel: '', sel: '', crm: '' }); lastMp = mp; }
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
        ${acc && can('api') ? '<button class="btn sm" id="mpRename">Перейменувати</button>' : ''}${acc && rz && can('api') ? '<button class="btn sm" id="mpCrmSet">Налаштування LP-CRM</button>' : ''}${acc && can('market.edit') ? `<button class="btn sm" id="mpSync" ${acc.active ? '' : 'disabled'}>Оновити зараз</button>` : ''}
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
          ${rz ? `<div class="f-chips" id="mpCrmF" style="align-items:center"><span class="small muted">LP-CRM:</span>
            ${[['', 'Усі'], ['no', 'Не в LP-CRM'], ['yes', 'У LP-CRM']].map(([k, t]) => `<button class="chip ${state.crm === k ? 'on' : ''}" data-crmf="${k}">${t}</button>`).join('')}
            ${can('market.edit') ? '<button class="btn sm" id="mpCrmFind" title="Знайти в LP-CRM замовлення зі списку, які ще не прив\'язані: за ТТН — прив\'язуються одразу, за телефоном — пропозиції">Знайти в LP-CRM</button>' : ''}</div>` : ''}
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
    // кнопка «скопіювати» біля поля (обробник — один на картку)
    const cp = (v, what = 'Скопійовано') => (v ? `<button type="button" class="mp-cp" data-copy="${esc(v)}" data-what="${esc(what)}" title="Скопіювати" aria-label="Скопіювати: ${esc(what)}">⧉</button>` : '');
    const payTag = (o) => {
      if (!o.pay_type && !o.pay_status) return '';
      return o.paid ? `<span class="mp-tag ok" title="${esc(o.pay_type)}">✓ Оплачено${o.pay_type ? ` · ${esc(o.pay_type)}` : ''}</span>`
        : `<span class="mp-tag${/карт|google|apple|pay|онлайн|кредит|частин/i.test(o.pay_type) ? ' warn' : ''}">${esc(o.pay_type || '')}${o.pay_status ? ` · ${esc(o.pay_status)}` : ''}</span>`;
    };
    const dupLine = (x) => `№${x.number} · ${dt(x.created_at)} · ${x.status_name || x.status} · ${uah(x.total)}${x.paid ? ' · оплачено' : x.pay_type ? ` · ${x.pay_type}` : ''}${many || x.account_id !== undefined ? ` · ${name.get(x.account_id) || ''}` : ''}`;
    const dupTag = (o) => (o.dups?.length ? `<span class="mp-tag warn" title="${esc(`Інші замовлення цього покупця (±14 днів):\n${o.dups.map(dupLine).join('\n')}`)}">+${o.dups.length} замовл. покупця${(() => { const sh = [...new Set(o.dups.filter((x) => x.account_id !== o.account_id).map((x) => name.get(x.account_id) || x.account_id))]; return sh.length ? ` · є в «${esc(sh.join('», «'))}»` : ''; })()}</span>` : '')
      + (o.dup_of ? ` <span class="mp-tag warn" title="Розетка позначила це замовлення дублем">дубль №${esc(o.dup_of)}</span>` : '');
    const showRv = () => rz && (state.grp === 'success' || state.rv);
    const rowHtml = (o) => (byKey.set(keyOf(o), o), `<div class="mp-row${state.sel === keyOf(o) ? ' on' : ''}" data-ok="${esc(keyOf(o))}" tabindex="0">
          ${canPick(o) ? `<label class="mp-pick"><input type="checkbox" data-pick="${esc(keyOf(o))}" ${picked.has(keyOf(o)) ? 'checked' : ''} aria-label="Вибрати ${esc(o.number)}"></label>` : ''}
          <div class="mp-row-b">
            <div class="mp-l1"><span><b>${esc(o.number)}</b> <span class="small muted">${esc(dt(o.created_at))}</span> ${dupTag(o)}</span><b>${uah(o.total)}</b></div>
            <div class="mp-l2">${o.items.length ? `${esc(o.items[0].name)}${o.items[0].qty > 1 ? ` × ${o.items[0].qty}` : ''}${o.items.length > 1 ? ` <span class="muted">+${o.items.length - 1}</span>` : ''}` : '—'}</div>
            <div class="mp-l3"><span>${esc(o.customer || '—')}${o.delivery ? ` · ${esc(o.delivery)}` : ''}${o.ttn ? ` · ТТН ${esc(o.ttn)}` : ''}${many ? ` · ${esc(name.get(o.account_id) || '')}` : ''}</span>
              ${rz && String(o.status) === '1' && state.grp === 'new' ? waitOf(o) : `<span class="badge">${esc(o.status_name || o.status || '—')}</span>`}</div>
            ${payTag(o) || o.crm_id ? `<div class="mp-l4">${payTag(o)}${o.crm_id ? ` <span class="mp-tag info" title="${esc(o.crm_by || '')}">LP-CRM №${esc(o.crm_id)}${o.crm_status ? ` · ${esc(o.crm_status)}` : ''}</span>` : ''}</div>` : ''}
            ${callMini(o)}
            ${showRv() ? `<div class="mp-l4" data-rvcell="${esc(keyOf(o))}">${rvCell(o)}</div>` : ''}
          </div>
        </div>`);
    let offset = 0;
    const load = async (more = false) => {
      offset = more ? offset + 300 : 0;
      const qs = new URLSearchParams({ mp, offset: String(offset), ...(acc ? { account: acc.id } : {}), ...(state.status ? { status: state.status } : {}),
        ...(state.q ? { q: state.q } : {}), ...(state.from ? { from: state.from } : {}), ...(state.to ? { to: state.to } : {}), ...(state.rv ? { rv: state.rv } : {}),
        ...(state.grp ? { grp: state.grp } : {}), ...(state.cancel ? { cancel: state.cancel } : {}), ...(state.crm ? { crm: state.crm } : {}) });
      const d = await api('GET', `/api/mp/orders?${qs}`);
      renderNav(d);
      // підстатуси: у групі Розетки — лише її статуси; Prom і Епіцентр — статуси в бічній панелі
      const inGrp = rz ? d.statuses.filter((x) => !state.grp || state.grp === 'call' || x.grp === state.grp) : [];
      const grpSum = inGrp.reduce((a, x) => a + x.n, 0);
      $('#mpStatuses').innerHTML = rz && state.grp && state.grp !== 'call' && inGrp.length > 1 ? `<button class="chip ${state.status ? '' : 'on'}" data-st="">Усі · ${grpSum}</button>${inGrp.map((x) => `<button class="chip ${state.status === x.status ? 'on' : ''}" data-st="${esc(x.status)}">${esc(x.status_name || x.status || '—')} · ${x.n}</button>`).join('')}` : '';
      $$('#mpStatuses [data-st]').forEach((b) => (b.onclick = () => { state.status = b.dataset.st; load(); }));
      $('#mpGrpHead').innerHTML = grpHead(d);
      $$('#mpGrpHead [data-cancel]').forEach((b) => (b.onclick = () => { state.cancel = b.dataset.cancel; state.status = ''; load(); }));
      if ($('#mpRvBox')) $('#mpRvBox').hidden = state.grp !== 'success'; // відгуки — у «Успішних» (і «Відгуки: можна нагадати»)
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
      ['', 'Усі замовлення'], ['new', 'Нові', 'red'], ['work', 'В обробці'], ['ttn', 'Створено ТТН'], ['call', 'Потрібно зателефонувати', 'amber'], ['dups', 'Кілька замовлень', 'amber'], ['delivery', 'Доставляється'],
      ['success', 'Успішні'], ['failed', 'Неуспішні'], ['cancelled', 'Скасовані'],
    ];
    const SHORT = { '': 'Усі', new: 'Нові', work: 'Обр.', ttn: 'ТТН', dups: 'Дублі', call: 'Дзв.', delivery: 'Дост.', success: 'Усп.', failed: 'Неусп.', cancelled: 'Скас.', 'rv-ask': 'Відг.' };
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
      if (state.grp === 'dups') {
        return '<div class="card small" style="margin-bottom:10px">Покупці, у яких зараз кілька активних замовлень (той самий телефон, усі магазини). Відкрийте замовлення — у картці видно інші замовлення покупця, їх оплату, і можна скасувати зайві.</div>';
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
    // скасування з причиною (лише активні замовлення — група «у роботі» Розетки)
    const canCancel = (x) => rz && can('market.edit') && Number(x.status_group) === 1 && !['delivery'].includes(x.grp || '');
    const REASONS = [[31, 'Створено дублююче замовлення (дубль)'], [50, 'Клієнт не оплатив'], [40, 'Клієнт передумав'], [18, 'Не вдалося зв\'язатися'],
      [42, 'Немає в наявності'], [28, 'Неправильні контактні дані'], [44, 'Фейкове замовлення']];
    // ---------- LP-CRM: прив'язка, пошук, створення ----------
    const canCrm = () => rz && can('market.edit');
    function crmBox(o) {
      if (o.crm_id || o.crm_code) {
        return `<div class="btn-row" style="align-items:center;flex-wrap:wrap"><span>Замовлення LP-CRM <b>№${esc(o.crm_id || '…')}</b>${cp(o.crm_id, 'Номер LP-CRM')}</span>
          ${o.crm_status ? `<span class="badge info">${esc(o.crm_status)}</span>` : ''}<span class="small muted">${esc(o.crm_by || '')}</span>
          ${canCrm() ? '<button type="button" class="btn sm" id="mpCrmUnlink" style="margin-left:auto">Відв\'язати</button>' : ''}</div>`;
      }
      if (!canCrm()) return '<span class="muted">Не прив\'язано до LP-CRM</span>';
      return `<div class="btn-row" style="align-items:center;flex-wrap:wrap">
          ${String(o.status) === '26' ? '<button type="button" class="btn primary sm" id="mpCrmNew">Створити в LP-CRM…</button>' : '<span class="small muted" title="Створити в LP-CRM можна, коли замовлення в статусі «Обробляється менеджером»">Створити — з «Обробляється менеджером»</span>'}
          <button type="button" class="btn sm" id="mpCrmSearch">Знайти в LP-CRM</button>
          <span style="display:inline-flex;gap:6px;align-items:center;margin-left:auto"><input id="mpCrmNum" inputmode="numeric" placeholder="№ замовлення LP-CRM" style="width:170px"><button type="button" class="btn sm" id="mpCrmLink">Прив'язати</button></span>
        </div><div id="mpCrmHits"></div>`;
    }
    const linkCrm = async (o, crm) => {
      const r = await api('PUT', '/api/mp/crm/link', { account: o.account_id, id: o.id, crm });
      toast(crm ? `Прив'язано до LP-CRM №${r.crm_id}` : 'Відв\'язано від LP-CRM');
      load();
    };
    function bindCrmBox(o) {
      if ($('#mpCrmUnlink')) $('#mpCrmUnlink').onclick = async () => { if (await confirmDanger(`Відв'язати від LP-CRM №${o.crm_id}?`, 'Замовлення в LP-CRM залишиться, зникне лише зв\'язок.', 'Відв\'язати')) linkCrm(o, '').catch((er) => toast(er.message, true)); };
      if ($('#mpCrmLink')) $('#mpCrmLink').onclick = () => { const v = $('#mpCrmNum').value.trim(); if (!v) { toast('Вкажіть № замовлення LP-CRM', true); return; } linkCrm(o, v).catch((er) => toast(er.message, true)); };
      if ($('#mpCrmNum')) $('#mpCrmNum').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#mpCrmLink').click(); } };
      if ($('#mpCrmNew')) $('#mpCrmNew').onclick = () => crmCreate(o);
      if ($('#mpCrmSearch')) $('#mpCrmSearch').onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true; b.innerHTML = '<span class="spinner"></span> Шукаю…';
        try {
          const r = await api('POST', '/api/mp/crm/find', { orders: [{ account: o.account_id, id: o.id }] });
          if (r.linked.length) { toast(`Знайдено за ТТН і прив'язано: LP-CRM №${r.linked[0].crm_id}`); load(); return; }
          const s = r.suggest[0];
          $('#mpCrmHits').innerHTML = s ? `<div class="small" style="margin-top:8px">Схожі замовлення в LP-CRM:</div>${s.crm.map((x) => `<div class="mp-dup"><span><b>№${esc(x.id)}</b> ${esc(x.name || '')}${x.ttn ? ` · ТТН ${esc(x.ttn)}` : ''}</span><span class="mp-tag">збіг: ${esc(x.by)}</span><button type="button" class="btn sm" style="margin-left:auto" data-crmpick="${esc(x.id)}">Прив'язати</button></div>`).join('')}`
            : '<div class="small muted" style="margin-top:8px">У LP-CRM не знайдено замовлень з цим телефоном чи ТТН.</div>';
          $$('[data-crmpick]', $('#mpCrmHits')).forEach((x) => (x.onclick = () => linkCrm(o, x.dataset.crmpick).catch((er) => toast(er.message, true))));
        } catch (er) { toast(er.message, true); }
        b.disabled = false; b.textContent = 'Знайти в LP-CRM';
      };
    }
    async function crmCreate(o) {
      let pre;
      try { pre = await api('GET', `/api/mp/crm/prefill/${o.account_id}/${encodeURIComponent(o.id)}`); } catch (er) { toast(er.message, true); return; }
      if (!pre.configured) { toast('Не налаштовано LP-CRM у «Налаштуваннях»', true); return; }
      if (!pre.shop.office) { toast(`Спершу вкажіть ID відділу LP-CRM для магазину «${name.get(o.account_id) || ''}» (кнопка «Налаштування LP-CRM» на сторінці магазину)`, true); return; }
      const rows = pre.items.map((it, i) => `<div class="mp-crm-line" data-i="${i}">
          <div class="small"><b>${esc(it.name)}</b> <span class="muted">код ${esc(it.item_id)}</span></div>
          <div class="mp-crm-pick"><input type="search" data-q placeholder="Товар LP-CRM: почніть вводити назву" value="${esc(it.product_name)}" autocomplete="off">
            <input type="hidden" data-pid value="${esc(it.product_id || '')}"><div class="mp-crm-res" data-res></div>
            <div class="small ${it.product_id ? '' : 'muted'}" data-sel>${it.product_id ? `№${esc(it.product_id)}${it.from === 'guess' ? ' · підібрано за назвою, перевірте' : it.from === 'saved' ? ' · як минулого разу' : ''}` : 'товар не обрано'}</div></div>
          <label class="f"><span>К-сть</span><input data-qty type="number" min="1" step="1" value="${it.qty}"></label>
          <label class="f"><span>Ціна, ₴</span><input data-price type="number" min="0" step="0.01" value="${it.price}"></label>
        </div>`).join('');
      const md = modal(`Створити в LP-CRM: Розетка №${o.number}`, `<div class="form-stack">
          <div class="small">Нове замовлення в LP-CRM (статус «Нові»), відділ <b>${esc(pre.shop.office)}</b>. Покупець <b>${esc(o.customer || '')}</b>, ${esc(intlPhone(o.phone) || '')}. Доставка, оплата й коментар покупця підуть у коментар.</div>
          ${rows}</div>`, { wide: true, footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="mpCrmGo">Створити в LP-CRM</button>' });
      const el = md.el;
      $$('.mp-crm-line', el).forEach((line) => {
        const q = $('[data-q]', line);
        const res = $('[data-res]', line);
        let t = 0;
        q.oninput = () => {
          clearTimeout(t);
          t = setTimeout(async () => {
            if (q.value.trim().length < 2) { res.innerHTML = ''; return; }
            try {
              const r = await api('GET', `/api/mp/crm/products?q=${encodeURIComponent(q.value)}`);
              res.innerHTML = r.products.length ? r.products.map((p) => `<button type="button" data-p="${p.id}" data-n="${esc(p.name)}">№${p.id} · ${esc(p.name)}</button>`).join('') : '<div class="small muted">Не знайдено</div>';
              $$('[data-p]', res).forEach((x) => (x.onclick = () => { $('[data-pid]', line).value = x.dataset.p; q.value = x.dataset.n; $('[data-sel]', line).textContent = `№${x.dataset.p}`; $('[data-sel]', line).classList.remove('muted'); res.innerHTML = ''; }));
            } catch (er) { res.innerHTML = `<div class="small">${esc(er.message)}</div>`; }
          }, 300);
        };
      });
      $('#mpCrmGo', el).onclick = async (e) => {
        const items = $$('.mp-crm-line', el).map((line, i) => ({ item_id: pre.items[i].item_id, product_id: Number($('[data-pid]', line).value) || null, product_name: $('[data-q]', line).value,
          qty: Number($('[data-qty]', line).value) || 1, price: Number($('[data-price]', line).value) || 0 }));
        if (items.some((x) => !x.product_id)) { toast('Оберіть товар LP-CRM для кожного рядка', true); return; }
        const b = e.currentTarget;
        b.disabled = true; b.innerHTML = '<span class="spinner"></span> Створюю…';
        try {
          const r = await api('POST', '/api/mp/crm/create', { account: o.account_id, id: o.id, items, shop_name: name.get(o.account_id) || '' });
          md.close();
          toast(`Створено в LP-CRM${r.crm_id ? `: №${r.crm_id}` : ''}`);
          load();
        } catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Створити в LP-CRM'; }
      };
    }
    // дубль можна скасувати лише в межах магазину відкритого замовлення
    const cancelIn = (x, o) => canCancel(x) && x.account_id === o.account_id;
    // перейти до замовлення (і в іншому магазині): сторінка магазину, пошук за номером за весь час, картка відкрита
    function goToOrder(key, number) {
      if (byKey.has(key)) { showDetail(byKey.get(key)); return; }
      const account = key.split(':')[0];
      Object.assign(state, { q: String(number), from: '', to: '', grp: '', status: '', cancel: '', rv: '', sel: key });
      const target = `#/${route}/${account}`;
      if (location.hash === target) load(); else location.hash = target;
    }
    function cancelModal(list, def = 40, inAccount = null) {
      const m = modal(list.length > 1 ? `Скасувати ${list.length} замовл.` : `Скасувати замовлення №${list[0].number}`, `
        <div class="form-stack">
          ${list.length > 1 ? `<div class="small">${list.map((x) => `№${esc(x.number)}`).join(', ')}</div>` : ''}
          <label class="f"><span>Причина (так побачить Розетка)</span><select id="mpCR">${REASONS.map(([k, t]) => `<option value="${k}" ${k === def ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <div class="small muted">Статус зміниться в кабінеті Розетки. Відновити скасоване замовлення звідси не можна.</div>
        </div>`, { footer: '<button class="btn" data-close>Не скасовувати</button><button class="btn danger" id="mpCGo">Скасувати в Розетці</button>' });
      $('#mpCGo', m.el).onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true; b.innerHTML = '<span class="spinner"></span> Скасовую…';
        const bad = [];
        let ok = 0;
        for (const x of list) {
          const [account, ...id] = x.key.split(':');
          try { await api('POST', '/api/mp/rz/cancel', { account: Number(account), id: id.join(':'), status: Number($('#mpCR', m.el).value), ...(inAccount ? { in_account: Number(inAccount) } : {}) }); ok++; }
          catch (er) { bad.push(`№${x.number}: ${er.message}`); }
        }
        m.close();
        if (ok) toast(`Скасовано: ${ok}`);
        if (bad.length) modal('Не всі замовлення скасовано', `<div class="small">${bad.map(esc).join('<br>')}</div>`, { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
        load();
      };
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
      const items = o.items.map((it) => `<div class="mp-goods"><span>${esc(it.name)}${cp(it.name, 'Назва товару')}${it.id ? ` <span class="small muted">код ${esc(it.id)}</span>${cp(it.id, 'Код товару')}` : ''}${it.qty > 1 ? ` <span class="muted">× ${it.qty}</span>` : ''}</span><b>${it.price ? uah(it.price * (it.qty || 1)) : ''}</b></div>`).join('') || '<div class="muted">—</div>';
      box.innerHTML = `<div class="mp-d-head"><div style="flex:1"><b style="font-size:16px">Замовлення ${esc(o.number)}</b>${cp(o.number, 'Номер замовлення')}<div class="small muted">${esc(dt(o.created_at))} · ${esc(name.get(o.account_id) || '')}${o.changed_at ? ` · змінено ${esc(dt(o.changed_at))}` : ''}</div></div>
          <span class="badge info">${esc(o.status_name || o.status || '—')}</span>
          <button type="button" class="btn sm" id="mpDClose" aria-label="Закрити картку">✕</button></div>
        <div class="mp-d-body">
          ${canPick(o) || canCancel(o) ? `<div class="mp-wide-box btn-row" style="align-items:center">${canPick(o) ? '<button type="button" class="btn primary" id="mpDTake">Взяти в обробку</button> <span class="small muted">→ «Обробляється менеджером» у Розетці</span>' : ''}
            ${canCancel(o) ? '<button type="button" class="btn danger" id="mpDCancel" style="margin-left:auto">Скасувати замовлення…</button>' : ''}</div>` : ''}
          <div class="mp-box"><div class="mp-cap">Покупець</div><b>${esc(o.customer || '—')}</b>${cp(o.customer, 'ПІБ')}
            ${ph ? `<div class="btn-row" style="margin-top:4px;flex-wrap:wrap;align-items:center"><span>${esc(ph)}</span>${cp(ph, 'Телефон')}<a class="btn sm" href="tel:${esc(ph)}">Подзвонити</a></div>` : ''}
            ${o.recipient ? `<div class="small" style="margin-top:4px"><span class="muted">Отримувач:</span> ${esc(o.recipient)}${cp(o.recipient, 'ПІБ отримувача')}${o.recipient_phone ? ` · ${esc(o.recipient_phone)}${cp(intlPhone(o.recipient_phone), 'Телефон отримувача')}` : ''}</div>` : ''}
            ${callsHtml(o)}</div>
          <div class="mp-box"><div class="mp-cap">Доставка</div>${esc(o.delivery || '—')}${o.address ? `<div>${esc(o.address)}${cp(o.address, 'Адресу')}</div>` : ''}${o.ttn ? `<div>ТТН <b>${esc(o.ttn)}</b>${cp(o.ttn, 'ТТН')}</div>` : ''}</div>
          ${rz ? `<div class="mp-box"><div class="mp-cap">Оплата</div>${o.pay_type || o.pay_status ? `${esc(o.pay_type || '—')}<div>${o.paid ? '<b style="color:var(--ok)">✓ Оплачено</b>' : esc(o.pay_status || 'не оплачено')}</div>` : '<span class="muted">ще не отримано з Розетки</span>'}</div>` : ''}
          ${o.comment ? `<div class="mp-box"><div class="mp-cap">Коментар покупця</div>${esc(o.comment)}${cp(o.comment, 'Коментар')}</div>` : ''}
          ${rz ? `<div class="mp-box mp-wide-box" id="mpDCrm"><div class="mp-cap">LP-CRM</div>${crmBox(o)}</div>` : ''}
          ${o.dups?.length || o.dup_of ? `<div class="mp-box mp-wide-box"><div class="mp-cap">Інші замовлення цього покупця</div>
            ${o.dup_of ? `<div class="small" style="margin-bottom:6px">Розетка позначила це замовлення дублем №${esc(o.dup_of)}${cp(o.dup_of, 'Номер')}</div>` : ''}
            ${(o.dups || []).map((x) => { const other = x.account_id !== o.account_id; return `<div class="mp-dup${other ? ' other' : ''}">
              <span><button type="button" class="mp-link" data-dgo="${esc(`${x.account_id}:${x.id}`)}" data-dnum="${esc(x.number)}" title="Перейти до замовлення${other ? ' в іншому магазині' : ''}"><b>№${esc(x.number)}</b></button>${cp(x.number, 'Номер замовлення')}
                <span class="small muted">${esc(dt(x.created_at))}</span> ${other ? `<span class="mp-tag warn">інший магазин: «${esc(name.get(x.account_id) || x.account_id)}»</span>` : `<span class="small muted">«${esc(name.get(x.account_id) || '')}»</span>`}</span>
              <span class="badge">${esc(x.status_name || x.status)}</span><b>${uah(x.total)}</b>${payTag(x) || '<span class="mp-tag">оплата —</span>'}
              <span class="btn-row" style="margin-left:auto"><button type="button" class="btn sm" data-dgo="${esc(`${x.account_id}:${x.id}`)}" data-dnum="${esc(x.number)}">${other ? 'Перейти в магазин' : 'Відкрити'}</button>${cancelIn(x, o) ? `<button type="button" class="btn sm danger" data-dcancel="${esc(`${x.account_id}:${x.id}`)}" data-dnum="${esc(x.number)}">Скасувати…</button>` : ''}</span></div>`; }).join('')}
            ${(o.dups || []).some((x) => x.account_id !== o.account_id) ? '<div class="small muted" style="margin-top:6px">Замовлення іншого магазину звідси змінювати не можна — відкрийте його в тому магазині.</div>' : ''}
            ${(o.dups || []).filter((x) => cancelIn(x, o) && !x.paid).length > 1 ? `<div style="margin-top:8px"><button type="button" class="btn sm danger" id="mpDCancelUnpaid">Скасувати неоплачені в цьому магазині (${(o.dups || []).filter((x) => cancelIn(x, o) && !x.paid).length})…</button></div>` : ''}</div>` : ''}
          <div class="mp-box mp-wide-box"><div class="mp-cap">Товари</div>${items}<div class="mp-goods" style="border-top:1px solid var(--line);padding-top:6px;margin-top:4px"><span>Разом</span><b>${uah(o.total)}${cp(String(o.total), 'Сума')}</b></div></div>
          ${rz ? `<div class="mp-box mp-wide-box"><div class="mp-cap">Відгук</div><div class="small">${rvCell(o)}</div></div>` : ''}
          ${rz && o.calls ? '<div class="mp-box mp-wide-box"><div class="mp-cap">Дзвінки Binotel з цим номером</div><div id="mpDCalls" class="small muted"><span class="spinner"></span></div></div>' : ''}
        </div>`;
      $('#mpDClose').onclick = closeDetail;
      if ($('#mpDTake')) $('#mpDTake').onclick = () => moveToWork([keyOf(o)]);
      bindCrmBox(o);
      if ($('#mpDCancel')) $('#mpDCancel').onclick = () => cancelModal([{ key: keyOf(o), number: o.number }], o.dups?.length || o.dup_of ? 31 : 40, o.account_id);
      $$('[data-dcancel]', box).forEach((b) => (b.onclick = () => cancelModal([{ key: b.dataset.dcancel, number: b.dataset.dnum }], 31, o.account_id)));
      $$('[data-dgo]', box).forEach((b) => (b.onclick = () => goToOrder(b.dataset.dgo, b.dataset.dnum)));
      if ($('#mpDCancelUnpaid')) $('#mpDCancelUnpaid').onclick = () => cancelModal(o.dups.filter((x) => cancelIn(x, o) && !x.paid).map((x) => ({ key: `${x.account_id}:${x.id}`, number: x.number })), 31, o.account_id);
      $$('[data-copy]', box).forEach((b) => (b.onclick = async () => { if (await copyText(b.dataset.copy)) toast(`${b.dataset.what} скопійовано`); }));
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
    $$('[data-crmf]').forEach((b) => (b.onclick = () => { state.crm = b.dataset.crmf; $$('[data-crmf]').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
    if ($('#mpCrmFind')) $('#mpCrmFind').onclick = async (e) => {
      const list = [...byKey.values()].filter((o) => !o.crm_id && !o.crm_code).slice(0, 300).map((o) => ({ account: o.account_id, id: o.id }));
      if (!list.length) { toast('У списку немає замовлень без LP-CRM'); return; }
      const b = e.currentTarget;
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Шукаю…';
      try {
        const r = await api('POST', '/api/mp/crm/find', { orders: list });
        modal('Пошук у LP-CRM', `<div class="small">Перевірено ${r.checked}. За ТТН прив'язано одразу: <b>${r.linked.length}</b>${r.linked.length ? ` (${r.linked.map((x) => `№${esc(x.number)} → ${esc(x.crm_id)}`).join(', ')})` : ''}.<br>
          Схожі за телефоном (прив'язати вручну в картці): <b>${r.suggest.length}</b>${r.suggest.length ? `<div style="margin-top:6px">${r.suggest.map((x) => `№${esc(x.number)} — LP-CRM ${x.crm.map((y) => `№${esc(y.id)}`).join(', ')}`).join('<br>')}</div>` : ''}<br>Не знайдено: ${r.notFound}.</div>`,
        { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
        if (r.linked.length) load();
      } catch (er) { toast(er.message, true); }
      b.disabled = false; b.textContent = 'Знайти в LP-CRM';
    };
    if ($('#mpCrmSet')) $('#mpCrmSet').onclick = async () => {
      let cfg = {};
      try { cfg = (await api('GET', '/api/mp/crm/settings')).shops?.[acc.id] || {}; } catch { /* */ }
      const md = modal(`LP-CRM для «${acc.name}»`, `<form id="mpCs" class="form-stack">
          <div class="small muted">З цими даними кнопка «Створити в LP-CRM» створює замовлення в LP-CRM (статус «Нові»).</div>
          <label class="f"><span>ID відділу LP-CRM (обов'язково)</span><input name="office" inputmode="numeric" value="${esc(cfg.office || '')}" required></label>
          <label class="f"><span>Сайт (поле «Сайт» у LP-CRM)</span><input name="site" value="${esc(cfg.site || '')}" placeholder="напр. rozetka.com.ua"></label>
          <label class="f"><span>ID служби доставки в LP-CRM</span><input name="delivery" inputmode="numeric" value="${esc(cfg.delivery || '')}"></label>
          <label class="f"><span>«Додаткове поле 1» — канал продажу (за ним аналітика визначає джерело)</span><input name="field1" value="${esc(cfg.field1 || '')}" placeholder="напр. Rozetka(Ecovent)"></label>
        </form>`, { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="mpCsSave">Зберегти</button>' });
      $('#mpCsSave', md.el).onclick = async () => {
        const f = $('#mpCs', md.el);
        try { await api('PUT', `/api/mp/crm/settings/${acc.id}`, { office: f.office.value, site: f.site.value, delivery: f.delivery.value, field1: f.field1.value }); md.close(); toast('Збережено'); }
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
