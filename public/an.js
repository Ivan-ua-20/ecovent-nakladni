import { plural } from './words.js';
// Розділ «Аналітика»: дашборд (періоди, порівняння, фільтри, таргети, графік, розбивки) і його налаштування.
// Дані рахує сервер (/api/an/query); тут — лише відображення.

const COLORS = { fact: '#0d9488', cmp: '#8a9592', target: '#c2410c', forecast: '#0d9488' };
const LS_KEY = 'an_ui_v1';

// ---------- дати ----------
const kyivToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
const toUtc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => fromUtc(toUtc(d) + n * 86400000);
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000) + 1;
const monthStart = (d) => `${d.slice(0, 7)}-01`;
const dim = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate();
const monthEnd = (d) => `${d.slice(0, 7)}-${String(dim(d)).padStart(2, '0')}`;
const addMonths = (d, n) => fromUtc(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + n, 1));
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const monthName = (d) => MONTHS[+d.slice(5, 7) - 1];
const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const range = (a, b) => (a === b ? dm(a) : `${dm(a)} – ${dm(b)}`);

// ---------- числа ----------
const nf0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const uah = (n) => `${nf0.format(Math.round(n || 0))} ₴`;
const int = (n) => nf0.format(Math.round(n || 0));
const pct1 = (n) => `${nf1.format(n || 0)}%`;
const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${nf1.format(n / 1e6)} млн`;
  if (a >= 1e3) return `${nf0.format(n / 1e3)} тис`;
  return nf0.format(n);
};
const change = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);

export function createAnalyticsUI(ctx) {
  const { api, $, $$, esc, toast, modal } = ctx;
  const main = () => ctx.main;
  const full = () => ctx.can('analytics'); // менеджер (без цього права) бачить лише свої замовлення

  // ---------- стан інтерфейсу (запам'ятовується в браузері) ----------
  const DEF = { period: 'cm', from: '', to: '', cmpMode: 'auto', cmpFrom: '', cmpTo: '', depts: [], sources: [], managers: [], brands: [], cats: [], products: [], metric: 'rev', cumulative: true, showTarget: true, showCmp: true, table: false, collapsed: [], sort: {} };
  let ui = { ...DEF };
  try { ui = { ...DEF, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; } catch { /* немає сховища */ }
  // Один раз: «Динаміка» за замовчуванням — сума з відмовами й поверненнями (раніше збережено «Оборот без відмов»).
  if (ui.metricV !== 2) { ui.metric = 'rev'; ui.metricV = 2; }
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(ui)); } catch { /* немає сховища */ } };
  // На телефоні фільтри за замовчуванням згорнуті (вибрані значення видно в заголовку).
  if (!ui.mobInit && window.matchMedia('(max-width: 760px)').matches) { ui.mobInit = true; ui.collapsed = [...new Set([...ui.collapsed, 'filters'])]; persist(); }

  function periods() {
    const t = kyivToday();
    const pmStart = addMonths(monthStart(t), -1);
    return {
      d7: { label: '7 днів', from: addDays(t, -6), to: t },
      cm: { label: 'Поточний місяць', from: monthStart(t), to: t },
      pm: { label: 'Попередній місяць', from: pmStart, to: monthEnd(pmStart) },
      custom: { label: 'Свій період', from: isDay(ui.from) ? ui.from : addDays(t, -29), to: isDay(ui.to) ? ui.to : t },
    };
  }
  function currentRange() {
    const p = periods()[ui.period] || periods().cm;
    let { from, to } = p;
    if (to < from) [from, to] = [to, from];
    let cmpFrom; let cmpTo;
    if (ui.cmpMode === 'custom' && isDay(ui.cmpFrom) && isDay(ui.cmpTo)) {
      cmpFrom = ui.cmpFrom; cmpTo = ui.cmpTo;
    } else if (ui.period === 'cm') {
      cmpFrom = addMonths(from, -1);
      cmpTo = addDays(cmpFrom, Math.min(daysBetween(from, to), dim(cmpFrom)) - 1);
    } else if (ui.period === 'pm') {
      cmpFrom = addMonths(from, -1); cmpTo = monthEnd(cmpFrom);
    } else {
      const n = daysBetween(from, to);
      cmpTo = addDays(from, -1); cmpFrom = addDays(cmpTo, -(n - 1));
    }
    return { from, to, cmpFrom, cmpTo, label: p.label };
  }

  // ---------- завантаження даних з LP-CRM (кроками) ----------
  let syncLoop = null;
  async function runSync(mode, onProgress) {
    if (syncLoop) return syncLoop;
    syncLoop = (async () => {
      try {
        let r = mode ? await api('POST', '/api/an/sync/start', { mode, force: mode !== 'daily' }) : await api('GET', '/api/an/sync');
        let s = r.state;
        let pauses = 0;
        while (s && !s.done && !s.error) {
          onProgress?.(s);
          r = await api('POST', '/api/an/sync/step', {});
          s = r.state;
          if (r.busy) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
          if (s?.warnings?.some((w) => w.includes('429'))) {
            if (++pauses > 20) break;
            await new Promise((ok) => setTimeout(ok, 15000));
          }
        }
        onProgress?.(s);
        return s;
      } finally { syncLoop = null; }
    })();
    return syncLoop;
  }
  const syncBar = (s) => {
    if (!s) return '';
    if (s.error) return `<div class="alert bad">Завантаження зупинено: ${esc(s.error)}</div>`;
    if (s.done) return '';
    const what = { today: 'Оновлення за сьогодні', daily: 'Оновлення за 30 днів', full: 'Повна перевірка', reset: 'Завантаження заново' }[s.mode] || 'Завантаження замовлень';
    return `<div class="an-sync"><div class="an-sync-top"><span><span class="spinner"></span> ${what} з LP-CRM · ${esc(s.text)}</span><b>${s.pct}%</b></div>
      <div class="an-progress"><span style="width:${s.pct}%"></span></div>
      <div class="small muted">Отримано ${int(s.stats?.fetched)} замовлень. Можна працювати далі — завантаження продовжиться, поки відкрита ця сторінка.</div></div>`;
  };

  // ---------- згортання блоків (стан запам'ятовується в браузері) ----------
  function collapsible(root) {
    $$('.card[data-col]', root).forEach((card) => {
      const key = card.dataset.col;
      const h = $('h3', card);
      if (!h || h.querySelector('.col-btn')) return;
      const closed = ui.collapsed.includes(key);
      card.classList.toggle('collapsed', closed);
      h.innerHTML = `<button type="button" class="col-btn" aria-expanded="${!closed}"><span class="chev" aria-hidden="true"></span>${h.innerHTML}</button>`;
      h.querySelector('.col-btn').onclick = () => {
        const now = !card.classList.contains('collapsed');
        card.classList.toggle('collapsed', now);
        h.querySelector('.col-btn').setAttribute('aria-expanded', String(!now));
        ui.collapsed = now ? [...new Set([...ui.collapsed, key])] : ui.collapsed.filter((x) => x !== key);
        persist();
        if (!now && key === 'Динаміка' && lastData) drawChart(lastData);
      };
    });
  }

  // ---------- «Потребує уваги»: лічильник у меню ----------
  function setBadge(n) {
    const a = document.querySelector('.subnav a[href="#/ansettings"]');
    if (!a) return;
    a.querySelector('.nav-count')?.remove();
    if (n > 0) a.insertAdjacentHTML('beforeend', ` <span class="nav-count" aria-label="потребує уваги: ${n}">${n}</span>`);
  }

  // =====================================================================
  // ДАШБОРД
  // =====================================================================
  let lastData = null;
  let reqSeq = 0;

  async function viewDashboard() {
    const el = main();
    el.innerHTML = `
      <div class="head-row an-head">
        <div><h2>Аналітика продажів</h2><div class="small muted" id="anFresh"></div></div>
        ${full() ? '<div class="btn-row"><button class="btn" id="anRefresh" title="Нові замовлення за сьогодні і статуси замовлень за 30 днів">Оновити сьогодні</button></div>' : ''}
      </div>
      <div id="anSync"></div>
      <div id="anAttn"></div>
      <div class="an-periods" role="group" aria-label="Період" id="anPeriods"></div>
      <div id="anRange"></div>
      <div class="card an-filters" id="anFilters" data-col="filters"><span class="spinner"></span></div>
      <div id="anBody"></div>`;
    renderPeriods();
    if ($('#anRefresh')) $('#anRefresh').onclick = () => startSync('today');

    const [sync, attn] = await Promise.all([api('GET', '/api/an/sync').catch(() => ({})), full() ? api('GET', '/api/an/attention').catch(() => null) : null]);
    showAttention(attn);
    $('#anFresh').textContent = sync.lastSync ? `Дані з LP-CRM оновлено ${ctx.fmtDateTime(sync.lastSync)}` : 'Дані ще не завантажено';
    // Менеджер: аналітика оновлюється автоматично раз на добу — коли було останнє і коли наступне.
    if (!full()) {
      const lastD = sync.lastDaily || sync.lastSync;
      const fmt = (ms) => new Date(ms).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      $('#anFresh').textContent = lastD
        ? `Аналітика оновлюється автоматично раз на добу · останнє оновлення ${fmt(Date.parse(lastD))} · наступне — після ${fmt(Date.parse(lastD) + 20 * 3600e3)}`
        : 'Аналітика оновлюється автоматично раз на добу';
    }
    // Ліміт ручних оновлень: скільки залишилось сьогодні і коли можна наступне.
    const rf = sync.refresh;
    if (rf && $('#anRefresh')) {
      const btn = $('#anRefresh');
      const t = (iso) => new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
      const out = rf.left === 0;
      btn.disabled = out || !!rf.nextAt;
      btn.title = out ? `Ліміт оновлень на сьогодні (${rf.perDay}) вичерпано` : rf.nextAt ? `Наступне оновлення — о ${t(rf.nextAt)}` : (rf.left != null ? `Сьогодні залишилось оновлень: ${rf.left} з ${rf.perDay}` : '');
      $('#anFresh').textContent += out ? ` · ліміт оновлень на сьогодні вичерпано` : rf.nextAt ? ` · наступне оновлення о ${t(rf.nextAt)}` : rf.left != null ? ` · сьогодні ще ${rf.left} з ${rf.perDay}` : '';
    }
    const running = sync.state && !sync.state.done && !sync.state.error;
    if (running || syncLoop) startSync(null);
    else if (!sync.lastSync) {
      $('#anBody').innerHTML = `<div class="card empty"><div class="big">Замовлення ще не завантажено</div>
        <p>Програма завантажить замовлення зі статусами «Принят», «Отправлен», «Очікує викупу», «Завершено», «Відмова на пошті» і «Повернуто на склад» за останні 6 місяців.
        Це займе кілька хвилин; далі дані оновлюватимуться раз на добу (за останні 30 днів) або кнопкою «Оновити сьогодні».</p>
        ${full() ? '<button class="btn primary" id="anFirst">Завантажити замовлення</button>' : '<p class="muted">Перше завантаження запускає адміністратор.</p>'}</div>`;
      $('#anFilters').hidden = true;
      if (full()) $('#anFirst').onclick = () => startSync('full');
      return;
    } else if (sync.dailyDue) {
      startSync('daily'); // автоматичне оновлення раз на добу — останні 30 днів
    }
    await load();
  }

  function showAttention(a) {
    if (!a) return;
    setBadge(a.total);
    const box = $('#anAttn');
    if (!box) return;
    const parts = [
      a.products.fresh && `нових товарів: ${a.products.fresh}`,
      a.products.nobrand && `товарів без бренду: ${a.products.nobrand}`,
      a.products.nocat && `без категорії: ${a.products.nocat}`,
      a.users.length && `нових менеджерів: ${a.users.length}`,
      a.values.length && `значень «Поле 1» без джерела: ${a.values.length}`,
      a.offices.length && `відділів CRM без прив’язки: ${a.offices.length}`,
    ].filter(Boolean);
    box.innerHTML = parts.length ? `<div class="alert warn an-attn"><span><b>Потребує уваги:</b> ${parts.join(' · ')}</span><a href="#/ansettings" class="btn sm">Переглянути</a></div>` : '';
  }

  function startSync(mode) {
    const box = $('#anSync');
    runSync(mode, (s) => { const b = $('#anSync'); if (b) b.innerHTML = syncBar(s); }).then((s) => {
      if (!$('#anSync')) return;
      if (s?.done) {
        toast('Дані з LP-CRM оновлено');
        if (full()) api('GET', '/api/an/attention').then(showAttention).catch(() => {});
        $('#anFresh').textContent = `Дані з LP-CRM оновлено щойно`;
        $('#anFilters').hidden = false;
        load();
      }
    }).catch((e) => { if (box) box.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; });
  }

  function renderPeriods() {
    const ps = periods();
    const r = currentRange();
    $('#anPeriods').innerHTML = Object.entries(ps).map(([id, p]) => `
      <button class="an-period ${ui.period === id ? 'on' : ''}" data-p="${id}" aria-pressed="${ui.period === id}">
        <b>${esc(p.label)}</b><span>${id === 'custom' ? 'вибрати дати' : range(p.from, p.to)}</span></button>`).join('');
    $$('[data-p]').forEach((b) => (b.onclick = () => { ui.period = b.dataset.p; persist(); renderPeriods(); load(); }));
    const compareOn = lastData ? lastData.compareEnabled : true;
    $('#anRange').innerHTML = `<div class="an-range">
      ${ui.period === 'custom' ? `<label>Період з <input type="date" id="anFrom" value="${esc(r.from)}"></label><label>по <input type="date" id="anTo" value="${esc(r.to)}"></label>` : `<span>Період: <b>${range(r.from, r.to)}</b></span>`}
      ${compareOn ? `<span class="an-sep"></span>
        <label>Порівняти з <select id="anCmpMode"><option value="auto" ${ui.cmpMode !== 'custom' ? 'selected' : ''}>таким самим попереднім періодом</option><option value="custom" ${ui.cmpMode === 'custom' ? 'selected' : ''}>своїми датами</option></select></label>
        ${ui.cmpMode === 'custom' ? `<label>з <input type="date" id="anCmpFrom" value="${esc(r.cmpFrom)}"></label><label>по <input type="date" id="anCmpTo" value="${esc(r.cmpTo)}"></label>` : `<span class="muted">${range(r.cmpFrom, r.cmpTo)}</span>`}` : ''}
    </div>`;
    const on = (id, fn) => { const x = $(id); if (x) x.onchange = fn; };
    on('#anFrom', (e) => { ui.from = e.target.value; persist(); load(); });
    on('#anTo', (e) => { ui.to = e.target.value; persist(); load(); });
    on('#anCmpMode', (e) => { ui.cmpMode = e.target.value; if (ui.cmpMode === 'custom') { const rr = currentRange(); ui.cmpFrom = rr.cmpFrom; ui.cmpTo = rr.cmpTo; } persist(); renderPeriods(); load(); });
    on('#anCmpFrom', (e) => { ui.cmpFrom = e.target.value; persist(); load(); });
    on('#anCmpTo', (e) => { ui.cmpTo = e.target.value; persist(); load(); });
  }

  async function load() {
    const body = $('#anBody');
    if (!body) return;
    const r = currentRange();
    const seq = ++reqSeq;
    body.classList.add('loading');
    try {
      const d = await api('POST', '/api/an/query', {
        from: r.from, to: r.to, cmpFrom: r.cmpFrom, cmpTo: r.cmpTo,
        depts: ui.depts, sources: ui.sources, managers: ui.managers, brands: ui.brands, cats: ui.cats, products: ui.products,
      });
      if (seq !== reqSeq || !$('#anBody')) return;
      const compareChanged = lastData && lastData.compareEnabled !== d.compareEnabled;
      lastData = d;
      if (compareChanged || !lastData) renderPeriods();
      renderFilters(d);
      renderBody(d);
    } catch (e) {
      if (seq === reqSeq) body.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
    } finally { body.classList.remove('loading'); }
  }

  // ---------- фільтри ----------
  // Порядок значень у фільтрах — від більшого обороту до меншого (за поточним періодом).
  // Поки в рядку щось вибрано, його порядок не змінюється — щоб кнопки не «стрибали» під курсором.
  const filterRank = {};
  function byTurnover(key, list, id, rows) {
    if (!ui[key].length || !filterRank[key]) {
      const rev = new Map((rows || []).map((r) => [String(r[key === 'managers' ? 'login' : 'id']), r.rev || 0]));
      filterRank[key] = new Map([...list].map((x, i) => [String(x[id]), { rev: rev.get(String(x[id])) || 0, i }]));
    }
    const rank = filterRank[key];
    const at = (x) => rank.get(String(x[id])) || { rev: -1, i: Infinity };
    return [...list].sort((a, b) => at(b).rev - at(a).rev || at(a).i - at(b).i);
  }

  function renderFilters(d) {
    if (d.own) ui.managers = [];
    const o = {
      ...d.options,
      depts: byTurnover('depts', d.options.depts, 'id', d.byDept),
      sources: byTurnover('sources', d.options.sources, 'id', d.bySource),
      managers: byTurnover('managers', d.options.managers, 'login', d.byManager),
      brands: byTurnover('brands', d.options.brands, 'id', d.byBrand),
      cats: byTurnover('cats', d.options.cats, 'id', d.byCategory),
    };
    const deptSel = ui.depts;
    const srcOpts = o.sources.filter((s) => !deptSel.length || deptSel.includes(s.dept_id));
    const mgrOpts = o.managers.filter((m) => !deptSel.length || deptSel.includes(m.dept_id) || ui.managers.includes(m.login));
    const chip = (key, val, label, on) => `<button class="chip ${on ? 'on' : ''}" data-f="${key}" data-v="${esc(val)}" aria-pressed="${on}">${esc(label)}</button>`;
    const row = (title, html, hint = '') => (html ? `<div class="f-row"><span class="f-title">${title}</span><div class="f-chips">${html}</div>${hint}</div>` : '');
    const active = ['depts', 'sources', 'managers', 'brands', 'cats', 'products'].reduce((a, k) => a + ui[k].length, 0);
    const names = (key, list, id, label) => ui[key].map((v) => list.find((x) => x[id] === v)?.[label] ?? v);
    const picked = [
      ...names('depts', o.depts, 'id', 'name'), ...names('sources', o.sources, 'id', 'name'), ...names('managers', o.managers, 'login', 'name'),
      ...names('brands', o.brands, 'id', 'name'), ...names('cats', o.cats, 'id', 'name'), ...names('products', o.products || [], 'id', 'name'),
    ];
    const box = $('#anFilters');
    box.innerHTML = `
      <div class="f-head"><h3>Фільтри</h3><span class="f-sum">${picked.length ? picked.map((x) => `<span class="vchip">${esc(x)}</span>`).join('') : '<span class="muted small">усі замовлення</span>'}</span>
        ${active ? `<button class="btn sm" id="anReset">Скинути (${active})</button>` : ''}</div>
      ${row('Відділ', o.depts.map((x) => chip('depts', x.id, x.name, deptSel.includes(x.id))).join(''))}
      ${row('Джерело', srcOpts.map((x) => chip('sources', x.id, x.name, ui.sources.includes(x.id))).join(''))}
      ${d.own ? '' : row('Менеджер', mgrOpts.map((x) => chip('managers', x.login, x.name, ui.managers.includes(x.login))).join(''))}
      ${row('Бренд', o.brands.map((x) => chip('brands', x.id, x.name, ui.brands.includes(x.id))).join(''))}
      ${row('Категорія', o.cats.map((x) => chip('cats', x.id, x.name, ui.cats.includes(x.id))).join(''), ui.brands.length ? '<span class="f-hint">категорії вибраних брендів</span>' : '')}
      <div class="f-row"><span class="f-title">Товари</span><div class="f-chips">
        <span id="anProdChips" class="prod-chips"></span>
        <span class="prod-pick"><label class="sr-only" for="anProdQ">Додати товари</label><input id="anProdQ" type="search" autocomplete="off" placeholder="+ Товари: назва або ID"><span id="anProdRes" class="prod-res" hidden></span></span>
        <span id="anProdAct" class="prod-act" hidden><button type="button" class="btn sm primary" id="anProdApply">Застосувати</button><button type="button" class="btn sm" id="anProdCancel">Скасувати</button></span>
      </div></div>
      <div class="f-foot"><span class="small muted">Можна вибирати кілька значень у кожному рядку. Клік по рядку в таблицях нижче теж додає фільтр.</span></div>`;
    $$('[data-f]', box).forEach((b) => (b.onclick = () => toggle(b.dataset.f, b.dataset.v)));
    wireProductPick(o.products || []);
    box.classList.remove('collapsed');
    collapsible(box.parentElement);
    const rs = $('#anReset');
    if (rs) rs.onclick = () => { ui.depts = []; ui.sources = []; ui.managers = []; ui.brands = []; ui.cats = []; ui.products = []; persist(); load(); };
  }

  // Пошук товарів для фільтра «Товари»: галочками збирається чернетка (кілька товарів, кілька пошуків),
  // дані перераховуються лише після «Застосувати» — без завантаження на кожен клік.
  function wireProductPick(applied) {
    const inp = $('#anProdQ');
    const box = $('#anProdRes');
    if (!inp) return;
    const draft = new Map(applied.map((x) => [x.id, x.name]));
    const same = () => draft.size === ui.products.length && ui.products.every((id) => draft.has(id));
    let rows = [];
    const drawChips = () => {
      $('#anProdChips').innerHTML = [...draft].map(([id, name]) => `<button type="button" class="chip ${ui.products.includes(id) ? 'on' : 'draft'}" data-rm="${id}" title="Прибрати">${esc(name)} ✕</button>`).join('');
      $$('[data-rm]', $('#anProdChips')).forEach((b) => (b.onclick = () => { draft.delete(Number(b.dataset.rm)); drawChips(); drawRes(); }));
      $('#anProdAct').hidden = same();
      $('#anProdApply').textContent = draft.size ? `Застосувати (${draft.size})` : 'Застосувати';
    };
    const drawRes = () => {
      if (box.hidden) return;
      const all = rows.length > 1 && rows.every((r) => draft.has(r.id));
      box.innerHTML = rows.length
        ? `${rows.length > 1 ? `<label class="prod-opt prod-all"><input type="checkbox" data-all${all ? ' checked' : ''}><b>${all ? 'Зняти всі знайдені' : `Вибрати всі знайдені (${rows.length})`}</b></label>` : ''}
          ${rows.map((r) => `<label class="prod-opt"><input type="checkbox" data-pid="${r.id}"${draft.has(r.id) ? ' checked' : ''}><span class="prod-txt"><b>${esc(r.name)}</b><span>${esc(r.brand)} · ID ${r.id}</span></span></label>`).join('')}`
        : '<span class="prod-none">Нічого не знайдено</span>';
      $$('[data-pid]', box).forEach((c) => (c.onchange = () => {
        const r = rows.find((x) => x.id === Number(c.dataset.pid));
        if (c.checked) draft.set(r.id, r.name); else draft.delete(r.id);
        drawChips(); drawRes();
      }));
      const ca = $('[data-all]', box);
      if (ca) ca.onchange = () => { rows.forEach((r) => (ca.checked ? draft.set(r.id, r.name) : draft.delete(r.id))); drawChips(); drawRes(); };
    };
    const apply = () => { box.hidden = true; ui.products = [...draft.keys()]; persist(); load(); };
    let t = 0;
    let seq = 0;
    inp.oninput = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = inp.value.trim();
        if (q.length < 2) { box.hidden = true; return; }
        const my = ++seq;
        let res = [];
        try { res = await api('GET', `/api/an/product-search?q=${encodeURIComponent(q)}`); } catch { res = []; }
        if (my !== seq) return;
        rows = res;
        box.hidden = false;
        drawRes();
      }, 250);
    };
    inp.onfocus = () => { if (rows.length && inp.value.trim().length >= 2) { box.hidden = false; drawRes(); } };
    inp.onkeydown = (e) => {
      if (e.key === 'Escape') { box.hidden = true; inp.blur(); }
      if (e.key === 'Enter' && !same()) { e.preventDefault(); apply(); }
    };
    // клік поза полем і списком закриває список, вибрані галочки лишаються в чернетці
    const pick = inp.parentElement;
    document.addEventListener('pointerdown', function off(e) {
      if (!pick.isConnected) { document.removeEventListener('pointerdown', off); return; }
      if (!pick.contains(e.target)) box.hidden = true;
    });
    $('#anProdApply').onclick = apply;
    $('#anProdCancel').onclick = () => { draft.clear(); applied.forEach((x) => draft.set(x.id, x.name)); box.hidden = true; inp.value = ''; drawChips(); };
    drawChips();
  }

  function toggle(key, raw) {
    const v = key === 'managers' ? String(raw) : Number(raw);
    const list = ui[key];
    const i = list.indexOf(v);
    if (i >= 0) list.splice(i, 1); else list.push(v);
    if (key === 'brands') ui.cats = [];
    if (key === 'depts' && lastData && ui.depts.length) {
      ui.sources = ui.sources.filter((id) => ui.depts.includes(lastData.options.sources.find((s) => s.id === id)?.dept_id));
    }
    persist();
    load();
  }

  // ---------- основний вміст ----------
  function delta(cur, prev, { inverse = false, pp = false } = {}) {
    if (prev == null) return '';
    const dlt = pp ? cur - prev : change(cur, prev);
    if (dlt == null) return '<span class="d muted">нове</span>';
    if (Math.abs(dlt) < 0.05) return '<span class="d muted">без змін</span>';
    const up = dlt > 0;
    const good = inverse ? !up : up;
    return `<span class="d ${good ? 'good' : 'bad'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${pp ? `${nf1.format(Math.abs(dlt))} п.п.` : pct1(Math.abs(dlt))}</span>`;
  }

  function renderBody(d) {
    const c = d.kpi.cur;
    const p = d.kpi.prev;
    const t = d.target;
    const hasCmp = Boolean(d.cmp && p);
    if (d.own && !d.own.logins.length) {
      $('#anBody').innerHTML = `<div class="card empty"><div class="big">Акаунт ще не прив’язано до логіна LP-CRM</div>
        <p>Попросіть власника або адміністратора вказати ваш логін LP-CRM у розділі «Користувачі» — тоді тут з’являться ваші замовлення.</p></div>`;
      return;
    }
    // Плитка: головне значення, під ним — друга міра (сума або кількість), далі порівняння з попереднім періодом.
    const tile = (label, value, also, sub, dl) => `<div class="kpi"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div>
      ${also ? `<div class="kpi-m">${also}</div>` : ''}
      <div class="kpi-s">${dl || ''}${sub ? `<span class="muted">${sub}</span>` : ''}</div></div>`;
    const orders = (n) => `${int(n)} ${plural(n, ['замовлення', 'замовлення', 'замовлень'])}`;
    const ncnt = (x) => x.ncnt ?? (x.cnt - x.rcnt);
    const rrev = (x) => x.rrev ?? (x.rev - x.net);
    const kpis = [
      tile('Сума замовлень', uah(c.rev), `${orders(c.cnt)} · усі статуси`, hasCmp ? `було ${uah(p.rev)} · ${int(p.cnt)}` : '', hasCmp ? delta(c.rev, p.rev) : ''),
      tile('Оборот без відмов', uah(c.net), `${orders(ncnt(c))} без відмов і повернень`, hasCmp ? `було ${uah(p.net)} · ${int(ncnt(p))}` : '', hasCmp ? delta(c.net, p.net) : ''),
      c.drev != null ? tile('Завершені замовлення', uah(c.drev), `${orders(c.dcnt)} · ${pct1(c.dpct)} від усіх`, hasCmp ? `було ${uah(p.drev)} · ${int(p.dcnt)}` : '', hasCmp ? delta(c.drev, p.drev) : '') : '',
      c.srev != null ? tile('Відправлено', uah(c.srev), `${orders(c.scnt)} · ${pct1(c.spct)} від усіх`, hasCmp ? `було ${uah(p.srev)} · ${int(p.scnt)}` : 'усі, крім «Прийнято»', hasCmp ? delta(c.srev, p.srev) : '') : '',
      tile('Середній чек', uah(c.avg), `${orders(c.cnt)} на ${uah(c.rev)}`, hasCmp ? `було ${uah(p.avg)}` : '', hasCmp ? delta(c.avg, p.avg) : ''),
      tile('Відмови і повернення', `${int(c.rcnt)} <small>· ${pct1(c.rpct)}</small>`, `на суму ${uah(rrev(c))}`, hasCmp ? `було ${int(p.rcnt)} · ${pct1(p.rpct)} на ${uah(rrev(p))}` : 'від усіх замовлень', hasCmp ? delta(c.rpct, p.rpct, { inverse: true, pp: true }) : ''),
    ].filter(Boolean);
    if (t.applicable) {
      const ahead = t.diff >= 0;
      kpis.push(`<div class="kpi kpi-target"><div class="kpi-l">Виконання плану</div><div class="kpi-v">${pct1(t.pct)}</div>
        <div class="kpi-s"><span class="d ${ahead ? 'good' : 'bad'}"><span aria-hidden="true">${ahead ? '▲' : '▼'}</span> ${ahead ? 'випереджаємо' : 'відстаємо'} на ${uah(Math.abs(t.diff))}</span>
        <span class="muted">план на період ${uah(t.plan)}</span></div></div>`);
    }

    $('#anBody').innerHTML = `
      ${d.own ? `<div class="alert info an-own">Показано лише ваші замовлення · логін LP-CRM: <b>${d.own.logins.map(esc).join(', ')}</b></div>` : ''}
      ${d.cmp ? `<div class="small muted an-cmp-note">Порівняння: ${range(d.range.from, d.range.to)} проти ${range(d.cmp.from, d.cmp.to)}</div>` : ''}
      <div class="kpis">${kpis.join('')}</div>
      ${targetCard(d)}
      <div class="card an-chart-card">
        <div class="an-chart-head">
          <h3>Динаміка</h3>
          <div class="seg" role="group" aria-label="Показник">
            ${[['rev', 'Сума замовлень'], ['net', 'Оборот без відмов'], ['cnt', 'Кількість']].map(([k, l]) => `<button data-m="${k}" class="${ui.metric === k ? 'on' : ''}" aria-pressed="${ui.metric === k}">${l}</button>`).join('')}
          </div>
          <div class="seg" role="group" aria-label="Вигляд">
            <button data-c="0" class="${!ui.cumulative ? 'on' : ''}" aria-pressed="${!ui.cumulative}">По днях</button>
            <button data-c="1" class="${ui.cumulative ? 'on' : ''}" aria-pressed="${ui.cumulative}">Наростаючим підсумком</button>
          </div>
          ${d.own ? '' : `<label class="check"><input type="checkbox" id="anTgt" ${ui.showTarget ? 'checked' : ''} ${targetAvailable(d) ? '' : 'disabled'}> Таргет</label>`}
          ${d.cmp ? `<label class="check"><input type="checkbox" id="anCmp" ${ui.showCmp ? 'checked' : ''}> Порівняння</label>` : ''}
        </div>
        <div class="legend" id="anLegend"></div>
        <div class="chart" id="anChart"></div>
        ${!d.own && !targetAvailable(d) && ui.showTarget ? `<div class="small muted">${esc(targetHint(d))}</div>` : ''}
        <button class="linkbtn small" id="anTableBtn">${ui.table ? 'Сховати таблицю' : 'Показати таблицею'}</button>
        <div id="anTable"></div>
      </div>
      <div class="an-grid">
        ${breakdown('По відділах', d.byDept, 'depts', { plan: true, hasCmp })}
        ${breakdown('Джерела продажів', d.bySource, 'sources', { plan: true, hasCmp, empty: 'Джерела визначаються за «Поле 1» — налаштуйте їх у «Налаштуваннях аналітики».' })}
        ${breakdown('Менеджери', d.byManager.map((m) => ({ ...m, id: m.login })), 'managers', { hasCmp, refusals: true })}
      </div>
      <div class="an-grid">
        ${brandTable(d.byBrand, hasCmp)}
        ${breakdown('Категорії', d.byCategory, 'cats', { hasCmp, qty: true })}
        ${d.byStatusGroup ? statusGroupsCard(d.byStatusGroup, Boolean(d.cmp)) : ''}
        ${d.byDelivery ? deliveryCard(d.byDelivery, Boolean(d.cmp)) : ''}
        ${statusCard(d.byStatus)}
      </div>
      ${topTable(d.top)}`;

    $$('[data-m]').forEach((b) => (b.onclick = () => { ui.metric = b.dataset.m; persist(); renderBody(lastData); }));
    $$('[data-c]').forEach((b) => (b.onclick = () => { ui.cumulative = b.dataset.c === '1'; persist(); renderBody(lastData); }));
    const tg = $('#anTgt'); if (tg) tg.onchange = () => { ui.showTarget = tg.checked; persist(); renderBody(lastData); };
    const cm = $('#anCmp'); if (cm) cm.onchange = () => { ui.showCmp = cm.checked; persist(); renderBody(lastData); };
    $('#anTableBtn').onclick = () => { ui.table = !ui.table; persist(); renderBody(lastData); };
    $$('[data-row]', $('#anBody')).forEach((tr) => (tr.onclick = () => toggle(tr.dataset.key, tr.dataset.row)));
    $$('[data-sort]', $('#anBody')).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); onSort(b.dataset.sort, b.dataset.k); }));
    // Пошук у таблиці товарів: показує всі збіги (навіть сховані «Показати ще»); порожній — як було.
    const topQ = $('#anTopQ');
    if (topQ) {
      topQ.oninput = () => {
        const q = topQ.value.trim().toLowerCase();
        const card = topQ.closest('.card');
        const more = card.querySelector('.pg-more');
        if (!q) { renderBody(lastData); return; }
        for (const tr of card.querySelectorAll('tbody tr[data-name]')) { tr.classList.remove('pg-hidden'); tr.hidden = !tr.dataset.name.includes(q); }
        if (more) more.hidden = true;
      };
    }
    $$('[data-row]', $('#anBody')).forEach((tr) => (tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(tr.dataset.key, tr.dataset.row); } }));
    $$('.card', $('#anBody')).forEach((card) => { const h = $('h3', card); if (h && !card.dataset.col) card.dataset.col = h.textContent.trim(); });
    collapsible($('#anBody'));
    if (!ui.collapsed.includes('Динаміка')) drawChart(d);
  }

  const targetBaseKey = (d) => (d.targetBase === 'all' ? 'rev' : 'net');
  const targetAvailable = (d) => d.target.applicable && ui.metric === targetBaseKey(d);
  const targetHint = (d) => {
    if (!d.target.applicable) return d.target.note || 'Таргет не задано.';
    return `Лінія таргету показується для показника «${targetBaseKey(d) === 'net' ? 'Оборот без відмов' : 'Сума замовлень'}».`;
  };

  function targetCard(d) {
    const t = d.target;
    if (!t.applicable) return t.note ? `<div class="alert info an-tnote">${esc(t.note)}</div>` : '';
    const ahead = t.diff >= 0;
    const w = Math.min(100, t.pct);
    let month = '';
    if (t.month) {
      const m = t.month;
      const enough = m.forecast >= m.plan;
      month = `<div class="t-month">
        <div><span class="muted">План на ${monthName(m.name + '-01')}</span><b>${uah(m.plan)}</b></div>
        <div><span class="muted">Прогноз на кінець місяця</span><b class="${enough ? 'good' : 'bad'}">${uah(m.forecast)} · ${pct1(m.forecastPct)}</b></div>
        <div><span class="muted">Зараз у середньому</span><b>${uah(m.avgPerDay)} / день</b></div>
        ${m.left && m.needPerDay <= 0
    ? `<div><span class="muted">До кінця місяця (${m.left} дн.)</span><b class="good">План місяця вже виконано</b></div>`
    : `<div><span class="muted">${m.left ? `Треба до кінця місяця (${m.left} дн.)` : 'Місяць завершено'}</span><b>${m.left ? `${uah(m.needPerDay)} / день` : '—'}</b></div>`}
      </div>`;
    }
    return `<div class="card an-target">
      <div class="t-head"><h3>Таргет</h3><span class="small muted">${t.base === 'net' ? 'оборот без відмов і повернень' : 'сума всіх замовлень'} · план на період рахується пропорційно дням місяця</span></div>
      <div class="t-bar" role="img" aria-label="Виконано ${pct1(t.pct)} плану"><span style="width:${w}%" class="${ahead ? 'good' : ''}"></span><i style="left:100%"></i></div>
      <div class="t-nums">
        <div><span class="muted">Факт</span><b>${uah(t.fact)}</b></div>
        <div><span class="muted">План на період</span><b>${uah(t.plan)}</b></div>
        <div><span class="muted">${ahead ? 'Випередження' : 'Відставання'}</span><b class="${ahead ? 'good' : 'bad'}">${ahead ? '+' : '−'}${uah(Math.abs(t.diff))} · ${pct1(Math.abs(t.pct - 100))}</b></div>
      </div>
      ${month}
    </div>`;
  }

  // ---------- сортування блоків (за кожною колонкою; запам'ятовується в браузері) ----------
  const COLS = {
    name: (r) => String(r.name || '').toLowerCase(),
    rev: (r) => r.rev || 0,
    cnt: (r) => r.cnt || 0,
    qty: (r) => r.qty || 0,
    avg: (r) => r.avg || 0,
    rqty: (r) => r.rqty || 0,
    prevQty: (r) => r.prevQty || 0,
    brand:(r) => String(r.brand || '').toLowerCase(),
    refuse: (r) => (r.cnt ? (r.rcnt || 0) / r.cnt : 0),
    dyn: (r) => { const v = change(r.rev, r.prevRev); return v == null ? (r.rev ? Infinity : -Infinity) : v; },
    plan: (r) => (r.plan ? (r.net / r.plan) : -1),
    dyncnt: (r) => { const v = change(r.cnt, r.prevCnt); return v == null ? (r.cnt ? Infinity : -Infinity) : v; },
  };
  function sortRows(block, rows) {
    const st = ui.sort?.[block];
    if (!st || !COLS[st.k]) return rows;
    const g = COLS[st.k];
    const m = st.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = g(a); const y = g(b);
      return (typeof x === 'string' ? x.localeCompare(y, 'uk') : x - y) * m;
    });
  }
  // Кнопка сортування: перший клік — від більшого до меншого (для назви — за абеткою), повторний — навпаки.
  function sortBtn(block, k, label, cls = '') {
    const st = ui.sort?.[block];
    const on = st?.k === k;
    const arrow = on ? (st.dir === 'asc' ? '↑' : '↓') : '';
    const what = on ? (st.dir === 'asc' ? 'за зростанням' : 'за спаданням') : 'не сортовано';
    return `<button type="button" class="sort-btn ${on ? 'on' : ''} ${cls}" data-sort="${block}" data-k="${k}" aria-label="Сортувати: ${esc(label)} (${what})">${esc(label)}<span class="sort-ar" aria-hidden="true">${arrow || '↕'}</span></button>`;
  }
  function onSort(block, k) {
    const st = ui.sort?.[block];
    const first = k === 'name' || k === 'brand' ? 'asc' : 'desc';
    ui.sort = { ...(ui.sort || {}) };
    if (st?.k === k) {
      if (st.dir === first) ui.sort[block] = { k, dir: first === 'asc' ? 'desc' : 'asc' };
      else delete ui.sort[block]; // третій клік — повернути звичайний порядок
    } else ui.sort[block] = { k, dir: first };
    persist();
    renderBody(lastData);
  }

  // Розбивки — сума всіх оброблених замовлень, разом із відмовами й поверненнями (як «Динаміка» за замовчуванням).
  const byMetric = (rows) => rows;
  const sumLabel = () => 'Сума';
  function breakdown(title, rows, key, { plan = false, hasCmp = false, refusals = false, qty = false, empty = '' } = {}) {
    const list = sortRows(key, byMetric(rows).filter((r) => r.rev || r.cnt || r.plan));
    if (!list.length) return `<div class="card"><h3>${title}</h3><div class="muted small">${empty || 'Немає даних за період.'}</div></div>`;
    const max = Math.max(...list.map((r) => r.rev), 1);
    const active = ui[key] || [];
    const head = `<div class="bk-row bk-head">
        <span>${sortBtn(key, 'name', 'Назва')}</span><span></span>
        <span class="bk-hv">${sortBtn(key, 'rev', sumLabel())}${sortBtn(key, qty ? 'qty' : 'cnt', qty ? 'Шт' : 'Зам.')}${refusals ? sortBtn(key, 'refuse', 'Відм.') : ''}</span>
        <span class="bk-hd">${hasCmp ? sortBtn(key, 'dyn', 'Динаміка') : ''}${plan ? sortBtn(key, 'plan', 'План') : ''}</span>
      </div>`;
    return `<div class="card"><h3>${title}</h3><div class="bk">${head}
      ${list.map((r) => {
        const on = active.includes(key === 'managers' ? r.id : Number(r.id));
        const planPct = plan && r.plan ? (r.net / r.plan) * 100 : null;
        return `<div class="bk-row ${on ? 'on' : ''}" data-row="${esc(r.id)}" data-key="${key}" tabindex="0" role="button" aria-pressed="${on}" title="Натисніть, щоб відфільтрувати">
          <span class="bk-name">${esc(r.name)}</span>
          <span class="bk-bar"><span style="width:${((r.rev / max) * 100).toFixed(1)}%"></span></span>
          <span class="bk-val">${uah(r.rev)}<small>${qty ? `${int(r.qty)} шт` : `${int(r.cnt)} зам.`}${refusals && r.cnt ? ` · відм. ${pct1((r.rcnt / r.cnt) * 100)}` : ''}</small></span>
          <span class="bk-d">${hasCmp ? delta(r.rev, r.prevRev) : ''}${planPct != null ? `<small class="${planPct >= 100 ? 'good' : ''}">план ${pct1(planPct)}</small>` : ''}</span>
        </div>`;
      }).join('')}</div></div>`;
  }

  // Підсумок за групами статусів: сума і кількість, частка від усіх, порівняння з попереднім періодом.
  function statusGroupsCard(rows, hasCmp) {
    const totalCnt = rows.reduce((a, r) => a + r.cnt, 0);
    const totalRev = rows.reduce((a, r) => a + r.rev, 0);
    const prevCnt = hasCmp ? rows.reduce((a, r) => a + (r.prevCnt || 0), 0) : null;
    const prevRev = hasCmp ? rows.reduce((a, r) => a + (r.prevRev || 0), 0) : null;
    const line = (name, rev, cnt, pRev, pCnt, cls = '') => `<div class="bk-row static ${cls}">
        <span class="bk-name">${name}</span>
        <span class="bk-bar"><span class="${cls.includes('refuse') ? 'refuse' : ''}" style="width:${totalRev ? ((rev / totalRev) * 100).toFixed(1) : 0}%"></span></span>
        <span class="bk-val">${uah(rev)}<small>${int(cnt)} зам.${totalCnt ? ` · ${pct1((cnt / totalCnt) * 100)}` : ''}</small></span>
        <span class="bk-d">${hasCmp ? `${delta(rev, pRev)}<small class="muted">було ${uah(pRev)} · ${int(pCnt)}</small>` : ''}</span>
      </div>`;
    return `<div class="card"><h3>Підсумок за статусами</h3><div class="bk">
      <div class="bk-row bk-head"><span>${sortBtn('stgroups', 'name', 'Група')}</span><span></span><span class="bk-hv">${sortBtn('stgroups', 'rev', 'Сума')}${sortBtn('stgroups', 'cnt', 'Зам.')}</span><span class="bk-hd">${hasCmp ? sortBtn('stgroups', 'dyn', 'Динаміка') : ''}</span></div>
      ${sortRows('stgroups', rows).map((r) => line(esc(r.name), r.rev, r.cnt, r.prevRev, r.prevCnt, r.id === 'refused' ? 'refuse-row' : '')).join('')}
      ${line('<b>Усього</b>', totalRev, totalCnt, prevRev, prevCnt, 'bk-total')}
    </div></div>`;
  }

  // Служби доставки: скільки замовлень і на яку суму якою службою (Нова пошта, Укрпошта, Розетка, самовивіз…).
  function deliveryCard(rows, hasCmp) {
    if (!rows.length) return `<div class="card"><h3>Служби доставки</h3><div class="muted small">Немає даних за період.</div></div>`;
    const totalCnt = rows.reduce((a, r) => a + r.cnt, 0);
    const totalRev = rows.reduce((a, r) => a + r.rev, 0);
    const pend = rows.find((r) => r.pending);
    return `<div class="card"><h3>Служби доставки</h3>
      ${pend ? `<div class="small muted" style="margin-bottom:8px">«Ще завантажується» — старі замовлення, для яких служба доставки дозаповнюється поступово під час оновлень аналітики (кілька днів).</div>` : ''}
      <div class="bk">
      <div class="bk-row bk-head"><span>${sortBtn('deliv', 'name', 'Служба')}</span><span></span><span class="bk-hv">${sortBtn('deliv', 'cnt', 'Зам.')}${sortBtn('deliv', 'rev', 'Сума')}</span><span class="bk-hd">${hasCmp ? sortBtn('deliv', 'dyncnt', 'Динаміка') : ''}</span></div>
      ${sortRows('deliv', rows).map((r) => `<div class="bk-row static ${r.pending ? 'muted' : ''}" title="${esc((r.names || []).join(', '))}">
        <span class="bk-name">${esc(r.name)}</span>
        <span class="bk-bar"><span style="width:${totalCnt ? ((r.cnt / totalCnt) * 100).toFixed(1) : 0}%"></span></span>
        <span class="bk-val">${int(r.cnt)} зам.<small>${uah(r.rev)}${totalCnt ? ` · ${pct1((r.cnt / totalCnt) * 100)}` : ''}</small></span>
        <span class="bk-d">${hasCmp ? `${delta(r.cnt, r.prevCnt)}<small class="muted">було ${int(r.prevCnt)} зам.</small>` : ''}</span>
      </div>`).join('')}
      <div class="bk-row static bk-total"><span class="bk-name"><b>Усього</b></span><span></span><span class="bk-val">${int(totalCnt)} зам.<small>${uah(totalRev)}</small></span><span class="bk-d"></span></div>
    </div></div>`;
  }

  function statusCard(rows) {
    const total = rows.reduce((a, r) => a + r.cnt, 0) || 1;
    return `<div class="card"><h3>Статуси замовлень</h3><div class="bk">
      <div class="bk-row bk-head"><span>${sortBtn('statuses', 'name', 'Статус')}</span><span></span><span class="bk-hv">${sortBtn('statuses', 'cnt', 'Зам.')}</span><span class="bk-hd">${sortBtn('statuses', 'rev', 'Сума')}</span></div>
      ${sortRows('statuses', rows).map((r) => `<div class="bk-row static">
        <span class="bk-name">${esc(r.name)}${r.refuse ? ' <span class="badge bad">відмова</span>' : ''}</span>
        <span class="bk-bar"><span class="${r.refuse ? 'refuse' : ''}" style="width:${((r.cnt / total) * 100).toFixed(1)}%"></span></span>
        <span class="bk-val">${int(r.cnt)}<small>${pct1((r.cnt / total) * 100)}</small></span>
        <span class="bk-d"><small>${uah(r.rev)}</small></span>
      </div>`).join('')}</div></div>`;
  }

  function brandTable(rows, hasCmp) {
    if (!rows.length) return '<div class="card"><h3>Бренди</h3><div class="muted small">Немає даних за період.</div></div>';
    return `<div class="card"><h3>Бренди</h3><div class="table-wrap"><table class="list an-table">
      <thead><tr><th>${sortBtn('brands', 'name', 'Бренд')}</th><th class="r">${sortBtn('brands', 'cnt', 'Зам.')}</th><th class="r">${sortBtn('brands', 'rev', sumLabel())}</th><th class="r hide-m">${sortBtn('brands', 'avg', 'Сер. чек')}</th><th class="r hide-m">${sortBtn('brands', 'refuse', 'Відмови')}</th>${hasCmp ? `<th class="r">${sortBtn('brands', 'dyn', 'Динаміка')}</th>` : ''}</tr></thead>
      <tbody>${sortRows('brands', byMetric(rows)).map((r) => `<tr class="click ${ui.brands.includes(r.id) ? 'on' : ''}" data-row="${r.id}" data-key="brands" tabindex="0">
        <td><b>${esc(r.name)}</b></td><td class="r">${int(r.cnt)}</td><td class="r">${uah(r.rev)}</td><td class="r hide-m">${uah(r.avg)}</td>
        <td class="r hide-m">${r.cnt ? pct1((r.rcnt / r.cnt) * 100) : '—'}</td>${hasCmp ? `<td class="r">${delta(r.rev, r.prevRev)}</td>` : ''}</tr>`).join('')}</tbody>
    </table></div><div class="small muted">Бренд — за назвою товару, а якщо її не вистачає — за категорією; решта — «Інші». Ручна прив’язка — у налаштуваннях аналітики.</div></div>`;
  }

  function topTable(rows) {
    if (!rows.length) return '';
    const prevCol = rows.some((r) => r.prevQty != null);
    return `<div class="card"><h3>Товари · ${rows.length}</h3>
      <div class="btn-row" style="margin-bottom:8px"><label class="sr-only" for="anTopQ">Пошук у таблиці товарів</label><input id="anTopQ" type="search" placeholder="Пошук товару в таблиці" style="max-width:320px"></div>
      <div class="table-wrap"><table class="list an-table">
      <thead><tr><th>${sortBtn('top', 'name', 'Товар')}</th><th class="hide-m">${sortBtn('top', 'brand', 'Бренд')}</th><th class="r">${sortBtn('top', 'qty', 'Шт')}</th>${prevCol ? `<th class="r">${sortBtn('top', 'prevQty', 'Шт раніше')}</th>` : ''}<th class="r">${sortBtn('top', 'rev', 'Сума')}</th><th class="r hide-m">${sortBtn('top', 'rqty', 'Відмови, шт')}</th></tr></thead>
      <tbody>${sortRows('top', rows).map((r) => `<tr class="click ${ui.products.includes(r.id) ? 'on' : ''}" data-row="${r.id}" data-key="products" data-name="${esc(String(r.name).toLowerCase())}" tabindex="0"><td>${esc(r.name)}<div class="small muted show-m">${esc(r.brand || '—')}${r.rqty ? ` · відмов ${int(r.rqty)}` : ''}</div></td><td class="muted hide-m">${esc(r.brand || '—')}</td><td class="r"><b>${int(r.qty)}</b></td>${prevCol ? `<td class="r">${int(r.prevQty || 0)} ${delta(r.qty, r.prevQty || 0)}</td>` : ''}<td class="r">${uah(r.rev)}</td><td class="r hide-m">${int(r.rqty)}</td></tr>`).join('')}</tbody>
    </table></div><div class="small muted">Усі товари, продані за період. Клік по товару — фільтр лише по ньому (можна кілька). Сума — з урахуванням знижки замовлення (розподіленої пропорційно).</div></div>`;
  }

  // ---------- графік ----------
  function series(d) {
    const key = ui.metric;
    const cur = d.daily.cur;
    let days = cur.map((x) => x.day);
    const t = d.target;
    const showT = ui.showTarget && targetAvailable(d);
    // Наростаючим підсумком з таргетом за місяць — показуємо весь місяць (план і прогноз до кінця).
    if (ui.cumulative && showT && t.month && t.month.left > 0) {
      for (let x = addDays(days[days.length - 1], 1); x <= monthEnd(days[0]); x = addDays(x, 1)) days.push(x);
    }
    const acc = (arr) => { let s = 0; return arr.map((v) => (v == null ? null : (s += v))); };
    const pick = (rows) => rows.map((x) => x[key]);
    const out = [];
    let fact = pick(cur);
    while (fact.length < days.length) fact.push(null);
    if (ui.cumulative) fact = acc(fact);
    out.push({ id: 'fact', label: `Факт · ${range(d.range.from, d.range.to)}`, color: COLORS.fact, values: fact, width: 2.5 });
    if (d.cmp && d.daily.prev && ui.showCmp) {
      let cmp = pick(d.daily.prev);
      if (ui.cumulative) cmp = acc(cmp);
      out.push({ id: 'cmp', label: `Порівняння · ${range(d.cmp.from, d.cmp.to)}`, color: COLORS.cmp, values: cmp, dash: '5 4', width: 2 });
    }
    if (showT) {
      const perDay = [...t.perDay];
      if (t.month) while (perDay.length < days.length) perDay.push(t.month.plan / t.month.days);
      out.push({ id: 'target', label: ui.cumulative ? 'План (наростаючим)' : 'План на день', color: COLORS.target, values: ui.cumulative ? acc(perDay) : perDay, dash: '7 5', width: 2 });
      if (ui.cumulative && t.month && t.month.left > 0) {
        const n = cur.length;
        const fc = days.map((_, i) => (i < n - 1 ? null : fact[n - 1] + (i - (n - 1)) * t.month.avgPerDay));
        out.push({ id: 'forecast', label: 'Прогноз за поточним темпом', color: COLORS.forecast, values: fc, dash: '2 4', width: 2, faint: true });
      }
    }
    return { days, out };
  }

  function drawChart(d) {
    const box = $('#anChart');
    if (!box) return;
    const { days, out } = series(d);
    const isCnt = ui.metric === 'cnt';
    const fmt = isCnt ? int : uah;
    $('#anLegend').innerHTML = out.map((s) => `<span class="lg"><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="${s.color}" stroke-width="2.5" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} opacity="${s.faint ? 0.7 : 1}"/></svg>${esc(s.label)}</span>`).join('');
    const narrow = box.clientWidth < 520;
    const W = Math.max(260, box.clientWidth);
    const H = narrow ? 230 : 300;
    const pad = { l: narrow ? 50 : 64, r: narrow ? 10 : 16, t: 14, b: 30 };
    const n = Math.max(days.length, ...out.map((s) => s.values.length));
    const all = out.flatMap((s) => s.values).filter((v) => v != null);
    const maxV = Math.max(1, ...all) * 1.08;
    const x = (i) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
    const y = (v) => pad.t + (1 - v / maxV) * (H - pad.t - pad.b);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => maxV * k);
    const step = Math.max(1, Math.ceil(n / Math.floor((W - pad.l) / 70)));
    const path = (vals) => {
      let dd = '';
      let pen = false;
      vals.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        dd += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return dd;
    };
    const factS = out[0];
    const lastIdx = factS.values.reduce((a, v, i) => (v != null ? i : a), -1);
    box.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Графік: ${esc(out.map((s) => s.label).join(', '))}">
      ${ticks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e7ebe9"/>
        <text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${isCnt ? int(v) : compact(v)}</text>`).join('')}
      ${days.map((dday, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${dm(dday)}</text>` : '')).join('')}
      ${factS.values.length && !ui.cumulative ? '' : ''}
      ${out.slice().reverse().map((s) => `<path d="${path(s.values)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round" opacity="${s.faint ? 0.7 : 1}"/>`).join('')}
      ${lastIdx >= 0 ? `<circle cx="${x(lastIdx)}" cy="${y(factS.values[lastIdx])}" r="4.5" fill="${COLORS.fact}" stroke="#fff" stroke-width="2"/>
        <text x="${Math.min(x(lastIdx) + 8, W - 4)}" y="${y(factS.values[lastIdx]) - 8}" text-anchor="${x(lastIdx) > W - 120 ? 'end' : 'start'}" class="lbl">${fmt(factS.values[lastIdx])}</text>` : ''}
      <line id="anCross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="#9aa6a2" stroke-dasharray="3 3" visibility="hidden"/>
      <rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent" id="anHit"/>
    </svg><div class="tip" id="anTip" hidden></div>`;
    const hit = $('#anHit');
    const tip = $('#anTip');
    const cross = $('#anCross');
    const cmpDays = d.cmp ? d.daily.prev?.map((r) => r.day) || [] : [];
    const show = (clientX) => {
      const rect = box.getBoundingClientRect();
      const px = clientX - rect.left;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      const rows = out.map((s) => {
        const v = s.values[i];
        if (v == null) return '';
        const extra = s.id === 'cmp' && cmpDays[i] ? ` <span class="muted">(${dm(cmpDays[i])})</span>` : '';
        return `<div><i style="background:${s.color}"></i>${esc(s.label.split(' · ')[0])}${extra}<b>${fmt(v)}</b></div>`;
      }).join('');
      const f = out.find((s) => s.id === 'fact')?.values[i];
      const tg = out.find((s) => s.id === 'target')?.values[i];
      const gap = f != null && tg ? `<div class="tip-gap ${f >= tg ? 'good' : 'bad'}">${f >= tg ? 'Випередження' : 'Відставання'} ${fmt(Math.abs(f - tg))} · ${pct1(Math.abs((f / tg) * 100 - 100))}</div>` : '';
      tip.innerHTML = `<div class="tip-h">${dm(days[i] || '')}${ui.cumulative ? ' · з початку періоду' : ''}</div>${rows}${gap}`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(x(i) + 12, 0), W - tw - 4) - (x(i) + 12 + tw > W ? tw + 24 : 0)}px`;
      tip.style.top = '10px';
    };
    hit.onmousemove = (e) => show(e.clientX);
    hit.ontouchstart = (e) => show(e.touches[0].clientX);
    hit.onmouseleave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    if (ui.table) {
      $('#anTable').innerHTML = `<div class="table-wrap"><table class="list an-table"><thead><tr><th>Дата</th>${out.map((s) => `<th class="r">${esc(s.label.split(' · ')[0])}</th>`).join('')}</tr></thead>
        <tbody>${days.map((dday, i) => `<tr><td>${dm(dday)}</td>${out.map((s) => `<td class="r">${s.values[i] == null ? '—' : fmt(s.values[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
  }
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if ($('#anChart') && lastData) drawChart(lastData); }, 150); });

  // =====================================================================
  // НАЛАШТУВАННЯ АНАЛІТИКИ
  // =====================================================================
  let cfg = null;
  let vals = null;
  let tMonth = kyivToday().slice(0, 7);

  async function viewSettings() {
    const el = main();
    el.innerHTML = '<div class="card empty"><span class="spinner"></span></div>';
    let attn;
    [cfg, vals, attn] = await Promise.all([api('GET', '/api/an/config'), api('GET', '/api/an/values'), api('GET', '/api/an/attention')]);
    setBadge(attn.total);
    const st = cfg.settings;
    const deptOpts = (sel, empty = '— не вибрано —') => `<option value="">${empty}</option>${cfg.depts.map((d) => `<option value="${d.id}" ${String(sel) === String(d.id) ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}`;
    const mapped = new Set(cfg.depts.flatMap((d) => d.sources.flatMap((s) => s.values)));
    const srcOpts = `<option value="">— вибрати джерело —</option>${cfg.depts.filter((d) => d.sources.length).map((d) => `<optgroup label="${esc(d.name)}">${d.sources.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}`;
    const mgrMap = new Map(cfg.managers.map((m) => [m.login, m]));
    const logins = [...new Map([...vals.users.map((u) => [u.v, u.n]), ...cfg.managers.filter((m) => !vals.users.some((u) => u.v === m.login)).map((m) => [m.login, 0])])];
    const offMap = new Map(cfg.officeMap.map((o) => [String(o.office), o.dept_id]));
    const offCount = new Map(vals.offices.map((o) => [String(o.v), o.n]));
    const offices = [...new Map([...cfg.offices.map((o) => [String(o.office_id), o.name]), ...vals.offices.filter((o) => !cfg.offices.some((x) => String(x.office_id) === String(o.v))).map((o) => [String(o.v), ''])])];

    el.innerHTML = `
      <h2>Налаштування аналітики</h2>
      <div class="an-set">
        <section class="card form-stack" id="sData">
          <h3>Дані з LP-CRM</h3>
          <div class="small">${cfg.lastSync ? `Останнє оновлення: <b>${ctx.fmtDateTime(cfg.lastSync)}</b>` : 'Дані ще не завантажено.'}
            Завантажуються замовлення зі статусами: ${[...st.okStatuses, ...st.refuseStatuses].map((id) => esc(cfg.statusNames[id] || id)).join(', ')} за останні ${st.months} міс.</div>
          <div class="small form-stack" style="gap:4px" id="sTtn">
            <div>${cfg.ttnSeen ? '✅ <b>Перевірка дублів ТТН працює</b>: ТТН приходять з LP-CRM.' : '⏳ <b>Перевірка дублів ТТН</b>: ТТН із LP-CRM ще не надходили — з’являться після оновлення замовлень.'}
              Нові замовлення (сьогодні й учора) перевіряються кожні 10 хв: їхня ТТН — проти інших замовлень за 7 днів; дубль — сповіщення в Telegram менеджерам цих замовлень
              (логін LP-CRM у профілі користувача), без прив’язаних — адмінам.</div>
            <div class="muted">${cfg.ttnLast ? `Остання перевірка: ${ctx.fmtDateTime(cfg.ttnLast.at)} · замовлень за 2 дні: ${cfg.ttnLast.listed} · перечитано: ${cfg.ttnLast.fetched}${cfg.ttnLast.dups ? ` · <b>дублів: ${cfg.ttnLast.dups}</b>` : ''}` : 'Швидка перевірка ще не запускалась.'}
              ${cfg.cronOn ? ' Запускається за розкладом (фонові задачі).' : ' Без фонових задач за розкладом перевірка запускається лише, коли хтось працює на сайті.'}</div>
            <div class="btn-row"><button type="button" class="btn sm" id="sTtnNow">Перевірити дублі ТТН зараз</button>${ctx.can('users') ? `<a class="btn sm" href="#/cron">${cfg.cronOn ? 'Фонові задачі — працюють' : 'Налаштувати фонові задачі'}</a>` : ''}</div>
          </div>
          <div id="sSync"></div>
          <div class="btn-row">
            <button class="btn primary" id="sToday">Оновити сьогодні</button>
            <button class="btn" id="sDaily">Оновити за 30 днів</button>
            <button class="btn" id="sFull">Повна перевірка за ${st.months} міс.</button>
            <button class="btn danger" id="sReset">Очистити і завантажити заново</button>
          </div>
          <ul class="small muted an-modes">
            <li><b>Сьогодні</b> — лише замовлення за сьогодні, найшвидше.</li>
            <li><b>За 30 днів</b> — запускається автоматично раз на добу, коли хтось відкриває дашборд: статуси за 30 днів, суми й товари — за 7 днів.</li>
            <li><b>Повна перевірка</b> — статуси за весь період; лише кнопкою, бо читає багато даних.</li>
          </ul>
        </section>

        <section class="card form-stack wide" id="sAttn">
          <h3>Потребує уваги <span class="badge ${attn.total ? 'warn' : 'ok'}" id="attnCount">${attn.total || 'усе гаразд'}</span></h3>
          <div id="attnLists"></div>
          <div class="at-prod">
            <div class="at-bar">
              <div class="seg" role="group" aria-label="Які товари показати">
                <button type="button" data-pf="attention" class="on" aria-pressed="true">Потребують уваги</button>
                <button type="button" data-pf="new" aria-pressed="false">Нові</button>
                <button type="button" data-pf="all" aria-pressed="false">Усі товари</button>
              </div>
              <input type="search" id="pQ" placeholder="Пошук товару" aria-label="Пошук товару">
            </div>
            <div class="small muted">Бренд визначається за назвою товару, а якщо в назві його немає — за назвою категорії. Решта — «Інші». Тут можна задати бренд і категорію вручну: «Авто» повертає автоматичне визначення.</div>
            <div id="pTable"><span class="spinner"></span></div>
            <div class="btn-row"><button type="button" class="btn" id="pSeenAll">Позначити всі нові як переглянуті</button><button type="button" class="btn" id="pOther">Товари без бренду → «Інші»</button></div>
          </div>
        </section>

        <form class="card form-stack" id="sGen">
          <h3>Загальні</h3>
          <label class="check"><input type="checkbox" name="compare" ${st.compare ? 'checked' : ''}> Порівнювати з попереднім періодом</label>
          <label class="f"><span>Відділ замовлення визначати</span><select name="deptPriority">
            <option value="manager" ${st.deptPriority === 'manager' ? 'selected' : ''}>спершу за менеджером, потім за відділом CRM</option>
            <option value="office" ${st.deptPriority === 'office' ? 'selected' : ''}>спершу за відділом CRM, потім за менеджером</option></select></label>
          <label class="f"><span>Таргет рахувати від</span><select name="targetBase">
            <option value="net" ${st.targetBase === 'net' ? 'selected' : ''}>обороту без відмов і повернень</option>
            <option value="all" ${st.targetBase === 'all' ? 'selected' : ''}>суми всіх замовлень</option></select></label>
          <label class="f" style="max-width:220px"><span>Глибина даних, місяців</span><input name="months" type="number" min="1" max="18" value="${st.months}"></label>
          ${ctx.boot.user?.role === 'owner' ? `<div class="grid2"><label class="f"><span>«Оновити сьогодні» — не більше разів на добу (0 — без ліміту)</span><input name="refreshPerDay" type="number" min="0" max="200" value="${st.refreshPerDay ?? 10}"></label>
            <label class="f"><span>…і не частіше, ніж раз на, хв</span><input name="refreshGapMin" type="number" min="0" max="720" value="${st.refreshGapMin ?? 15}"></label></div>`
            : `<div class="small">«Оновити сьогодні»: до ${st.refreshPerDay ?? 10} разів на добу, не частіше ніж раз на ${st.refreshGapMin ?? 15} хв (змінює власник).</div>`}
          <div class="small muted">Вручну оновлюють лише адміністратори (менеджери — ні). Кожне оновлення — ~20 звернень до LP-CRM і тисячі рядків бази; автоматичне щоденне оновлення ліміт не рахує.</div>
          <div class="btn-row"><button class="btn primary">Зберегти</button></div>
        </form>

        <section class="card form-stack wide" id="sTargets">
          <div class="head-row" style="margin:0"><h3 style="margin:0">Таргети по обороту</h3>
            <label class="f-inline">Місяць <input type="month" id="tMonth" value="${tMonth}"></label></div>
          <div class="small muted">Таргет на місяць. Якщо для відділу поле порожнє, його таргет дорівнює сумі таргетів його джерел. На дашборді план на будь-який період рахується пропорційно дням.</div>
          <div id="tTable"><span class="spinner"></span></div>
          <div class="btn-row"><label class="f-inline">Також скопіювати на наступні <select id="tCopy">${[0, 1, 2, 3, 6, 11].map((n) => `<option value="${n}">${n}</option>`).join('')}</select> міс.</label>
            <button class="btn primary" id="tSave">Зберегти таргети</button></div>
        </section>

        <section class="card form-stack wide" id="sStruct">
          <h3>Відділи і джерела продажів</h3>
          <div class="small muted">Джерело визначається за значенням «Поле 1» замовлення (а якщо воно порожнє — за полем «сайт» або utm_source). Одне джерело може мати кілька значень, наприклад Rozetka(oneday) і Rozetka(ecovent).</div>
          <div id="structEd"></div>
          <div class="btn-row"><button class="btn" id="dAdd">+ Відділ</button><button class="btn primary" id="structSave">Зберегти відділи і джерела</button></div>
        </section>

        <form class="card form-stack wide" id="sMgr">
          <h3>Менеджери</h3>
          <div class="small muted">Логіни з замовлень LP-CRM. Замовлення менеджера йдуть у його основний відділ. Якщо менеджер працює ще в інших відділах — відмітьте їх: тоді замовлення потрапить у відділ свого джерела («Поле 1») або відділу LP-CRM, якщо той серед відділів менеджера, а інакше — в основний.</div>
          ${logins.length ? `<div class="table-wrap"><table class="list mgr-table"><thead><tr><th>Логін</th><th class="r">Зам.</th><th>Ім’я</th><th>Основний відділ</th><th>Також працює у</th></tr></thead><tbody>
            ${logins.map(([login, n]) => `<tr data-login="${esc(login)}"><td><b>${esc(login)}</b></td><td class="r small">${int(n)}</td>
              <td><input data-k="name" value="${esc(mgrMap.get(login)?.name || '')}" placeholder="Ім’я" aria-label="Ім’я для ${esc(login)}"></td>
              <td><select data-k="dept_id" aria-label="Основний відділ для ${esc(login)}">${deptOpts(mgrMap.get(login)?.dept_id)}</select></td>
              <td><div class="crm-pick">${cfg.depts.map((d) => {
                const extra = String(mgrMap.get(login)?.depts || '').split(',').map(Number).includes(d.id) && mgrMap.get(login)?.dept_id !== d.id;
                return `<label class="chk-chip"><input type="checkbox" data-xd="${d.id}" ${extra ? 'checked' : ''}> ${esc(d.name)}</label>`;
              }).join('')}</div></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="small muted">Менеджери з’являться після завантаження замовлень.</div>'}
          <div class="btn-row"><button class="btn primary">Зберегти менеджерів</button></div>
        </form>

        <form class="card form-stack" id="sOff">
          <h3>Відділи LP-CRM → відділ аналітики</h3>
          <div class="small muted">Використовується, коли менеджер замовлення не прив’язаний до відділу.</div>
          <div class="table-wrap"><table class="list"><thead><tr><th>Відділ у CRM</th><th class="r">Зам.</th><th>Відділ аналітики</th></tr></thead><tbody>
            ${offices.map(([id, name]) => `<tr data-office="${esc(id)}"><td><b>${esc(id)}</b> <span class="small muted">${esc(name)}</span></td><td class="r small">${int(offCount.get(id) || 0)}</td>
              <td><select aria-label="Відділ аналітики для ${esc(id)}">${deptOpts(offMap.get(id))}</select></td></tr>`).join('')}
          </tbody></table></div>
          <div class="btn-row"><button class="btn primary">Зберегти відповідності</button></div>
        </form>

        <form class="card form-stack wide" id="sBrands">
          <h3>Бренди</h3>
          <div class="small muted">Бренд визначається за ключовими словами (без урахування регістру, через кому): спершу в назві товару, потім у назві категорії. Перший збіг зверху вниз; без збігу — «Інші».</div>
          <div id="brandEd"></div>
          <div class="btn-row"><button type="button" class="btn" id="bAdd">+ Бренд</button><button class="btn primary">Зберегти бренди</button></div>
        </form>
      </div>`;

    // --- дані
    const syncBox = $('#sSync');
    const go = (mode) => runSync(mode, (s) => { if ($('#sSync')) syncBox.innerHTML = syncBar(s) || (s?.done ? '<div class="alert info">Готово.</div>' : ''); })
      .then((s) => { if (s?.done) { toast('Дані оновлено'); viewSettings(); } })
      .catch((e) => toast(e.message, true));
    if (cfg.sync && cfg.sync.phase !== 'done' && !cfg.sync.error) go(null);
    $('#sTtnNow') && ($('#sTtnNow').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { const r = await api('POST', '/api/an/ttn-check'); toast(r.skipped ? (r.reason || 'Пропущено') : `Перевірено: замовлень ${r.listed}, перечитано ${r.fetched}${r.dups ? `, дублів: ${r.dups} — сповіщення надіслано` : ', дублів немає'}`); viewSettings(); }
      catch (er) { toast(er.message, true); b.disabled = false; }
    });
    $('#sToday').onclick = () => go('today');
    $('#sDaily').onclick = () => go('daily');
    $('#sFull').onclick = () => go('full');
    $('#sReset').onclick = () => {
      const m = modal('Очистити дані аналітики?', '<p>Усі завантажені замовлення буде видалено і завантажено заново з LP-CRM. Налаштування (відділи, джерела, менеджери, бренди, таргети) збережуться.</p>',
        { footer: '<button class="btn" data-close>Скасувати</button><button class="btn danger" id="rsGo">Очистити і завантажити</button>' });
      $('#rsGo', m.el).onclick = () => { m.close(); go('reset'); };
    };

    // --- потребує уваги: нові менеджери, значення «Поле 1», відділи CRM
    const hide = (kind, value) => `<button type="button" class="btn sm" data-hide="${kind}" data-v="${esc(value)}">Приховати</button>`;
    const lists = [];
    if (attn.users.length) {
      lists.push(`<div class="at-group"><h4>Нові менеджери</h4><div class="small muted">Логіни з LP-CRM, яких ще немає у списку менеджерів. Виберіть відділ — менеджера буде додано.</div>
        ${attn.users.map((u) => `<div class="at-row"><b>${esc(u.v)}</b><span class="small muted">${int(u.n)} зам.</span>
          <select data-amgr="${esc(u.v)}" aria-label="Відділ для ${esc(u.v)}">${deptOpts('', '— відділ —')}</select>${hide('users', u.v)}</div>`).join('')}</div>`);
    }
    if (attn.values.length) {
      lists.push(`<div class="at-group"><h4>Значення без джерела</h4><div class="small muted">Нові значення «Поле 1», сайту чи utm_source. Виберіть джерело продажів.</div>
        ${attn.values.map((v) => `<div class="at-row"><b>${esc(v.value)}</b><span class="small muted">${esc(v.fields.join(', '))} · ${int(v.n)} зам.</span>
          <select data-assign="${esc(v.value)}" aria-label="Джерело для ${esc(v.value)}">${srcOpts}</select>${hide('values', v.value)}</div>`).join('')}</div>`);
    }
    if (attn.offices.length) {
      lists.push(`<div class="at-group"><h4>Відділи LP-CRM без прив’язки</h4>
        ${attn.offices.map((o) => `<div class="at-row"><b>${esc(o.v)}</b><span class="small muted">${esc(cfg.offices.find((x) => String(x.office_id) === String(o.v))?.name || '')} · ${int(o.n)} зам.</span>
          <select data-aoff="${esc(o.v)}" aria-label="Відділ аналітики для ${esc(o.v)}">${deptOpts('', '— відділ —')}</select>${hide('offices', o.v)}</div>`).join('')}</div>`);
    }
    const ig = attn.ignored;
    const hidden = ig.users.length + ig.values.length + ig.offices.length;
    $('#attnLists').innerHTML = lists.join('') + (hidden ? `<div class="small muted">Приховано: ${hidden}. <button type="button" class="linkbtn" id="attnShow">Показати знову</button></div>` : '');
    $('#attnLists').onclick = async (e) => {
      const b = e.target.closest('[data-hide]');
      if (b) {
        try { await api('PUT', '/api/an/ignore', { kind: b.dataset.hide, value: b.dataset.v, on: true }); await viewSettings(); } catch (er) { toast(er.message, true); }
      }
      if (e.target.id === 'attnShow') {
        try {
          for (const kind of ['users', 'values', 'offices']) for (const value of ig[kind]) await api('PUT', '/api/an/ignore', { kind, value, on: false });
          await viewSettings();
        } catch (er) { toast(er.message, true); }
      }
    };
    $$('[data-amgr]').forEach((sel) => (sel.onchange = async () => {
      if (!sel.value) return;
      const rows = [...cfg.managers.map((m) => ({ login: m.login, name: m.name, dept_id: m.dept_id, depts: m.depts })), { login: sel.dataset.amgr, name: '', dept_id: sel.value }];
      try { await api('PUT', '/api/an/managers', rows); toast('Менеджера додано'); lastData = null; await viewSettings(); } catch (er) { toast(er.message, true); }
    }));
    $$('[data-aoff]').forEach((sel) => (sel.onchange = async () => {
      if (!sel.value) return;
      const rows = [...cfg.officeMap.map((o) => ({ office: o.office, dept_id: o.dept_id })), { office: sel.dataset.aoff, dept_id: sel.value }];
      try { await api('PUT', '/api/an/office-map', rows); toast('Збережено'); lastData = null; await viewSettings(); } catch (er) { toast(er.message, true); }
    }));

    // --- товари: ручна прив'язка бренду і категорії
    let prods = null;
    let pf = 'attention';
    const catName = new Map(cfg.categories.map((c) => [c.id, c.name]));
    const brandName = new Map([...cfg.brands.map((b) => [b.id, b.name]), [0, 'Інші']]);
    const catOpts = [...cfg.categories].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    const needs = (p) => !p.seen || (p.brand_id === 0 && p.brand_manual == null) || (!p.category_id && p.cat_manual == null);
    const drawProds = () => {
      const q = $('#pQ').value.trim().toLowerCase();
      let list = prods.products.filter((p) => (pf === 'all' ? true : pf === 'new' ? !p.seen : needs(p)));
      if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || String(p.id) === q);
      const more = list.length > 200;
      list = list.slice(0, 200);
      if (!list.length) { $('#pTable').innerHTML = `<div class="small muted">${pf === 'attention' && !q ? 'Усі товари мають бренд і категорію, нових немає.' : 'Нічого не знайдено.'}</div>`; return; }
      $('#pTable').innerHTML = `<div class="table-wrap"><table class="list at-table"><thead><tr><th>Товар</th><th class="r">Продано</th><th>Бренд</th><th>Категорія</th><th></th></tr></thead><tbody>
        ${list.map((p) => {
          const autoBrand = p.brand_manual == null ? brandName.get(p.brand_id) || 'Інші' : '';
          const autoCat = p.category_id ? catName.get(p.category_id) || `Категорія ${p.category_id}` : 'без категорії';
          return `<tr data-pid="${p.id}"><td><span class="at-name">${esc(p.name || `Товар ${p.id}`)}</span> ${!p.seen ? '<span class="badge info">нове</span>' : ''}<div class="small muted">ID ${p.id}</div></td>
          <td class="r">${int(p.sold)}</td>
          <td><select data-pb aria-label="Бренд">
            <option value="" ${p.brand_manual == null ? 'selected' : ''}>Авто${autoBrand ? `: ${esc(autoBrand)}` : ''}</option>
            ${cfg.brands.map((b) => `<option value="${b.id}" ${p.brand_manual === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            <option value="0" ${p.brand_manual === 0 ? 'selected' : ''}>Інші</option></select></td>
          <td><select data-pc aria-label="Категорія">
            <option value="" ${p.cat_manual == null ? 'selected' : ''}>Авто: ${esc(autoCat)}</option>
            ${catOpts.map((c) => `<option value="${c.id}" ${p.cat_manual === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            <option value="0" ${p.cat_manual === 0 ? 'selected' : ''}>Без категорії</option></select></td>
          <td>${!p.seen ? '<button type="button" class="btn sm" data-pseen>Переглянуто</button>' : ''}</td></tr>`;
        }).join('')}</tbody></table></div>${more ? '<div class="small muted">Показано перші 200 — уточніть пошук.</div>' : ''}`;
    };
    const loadProds = async () => { prods = await api('GET', '/api/an/products'); drawProds(); };
    const saveProds = async (rows) => {
      await api('PUT', '/api/an/products', rows);
      lastData = null;
      const a = await api('GET', '/api/an/attention');
      attn.total = a.total;
      setBadge(a.total);
      $('#attnCount').textContent = a.total || 'усе гаразд';
      $('#attnCount').className = `badge ${a.total ? 'warn' : 'ok'}`;
      await loadProds();
    };
    $$('[data-pf]').forEach((b) => (b.onclick = () => {
      pf = b.dataset.pf;
      $$('[data-pf]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      drawProds();
    }));
    $('#pQ').oninput = () => drawProds();
    $('#pTable').onchange = (e) => {
      const tr = e.target.closest('[data-pid]');
      if (!tr) return;
      saveProds([{ id: +tr.dataset.pid, brand_manual: $('[data-pb]', tr).value, cat_manual: $('[data-pc]', tr).value }])
        .then(() => toast('Збережено')).catch((er) => toast(er.message, true));
    };
    $('#pTable').onclick = (e) => {
      const b = e.target.closest('[data-pseen]');
      if (!b) return;
      const id = +b.closest('[data-pid]').dataset.pid;
      api('POST', '/api/an/products/seen', { ids: [id] }).then(() => { const p = prods.products.find((x) => x.id === id); if (p) p.seen = 1; drawProds(); return api('GET', '/api/an/attention'); })
        .then((a) => { setBadge(a.total); $('#attnCount').textContent = a.total || 'усе гаразд'; }).catch((er) => toast(er.message, true));
    };
    $('#pSeenAll').onclick = () => api('POST', '/api/an/products/seen', {}).then(() => saveProds([])).then(() => toast('Усі нові товари переглянуто')).catch((er) => toast(er.message, true));
    $('#pOther').onclick = () => {
      const rows = prods.products.filter((p) => p.brand_id === 0 && p.brand_manual == null).map((p) => ({ id: p.id, brand_manual: 0, cat_manual: p.cat_manual ?? '' }));
      if (!rows.length) { toast('Немає товарів без бренду'); return; }
      saveProds(rows).then(() => toast(`Позначено «Інші»: ${rows.length}`)).catch((er) => toast(er.message, true));
    };
    loadProds().catch((er) => { $('#pTable').innerHTML = `<div class="alert bad">${esc(er.message)}</div>`; });

    // --- загальні
    $('#sGen').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('PUT', '/api/an/settings', { compare: f.compare.checked, deptPriority: f.deptPriority.value, targetBase: f.targetBase.value, months: f.months.value, refreshPerDay: f.refreshPerDay?.value, refreshGapMin: f.refreshGapMin?.value });
        lastData = null;
        toast('Збережено');
      } catch (er) { toast(er.message, true); }
    };

    // --- таргети
    const loadTargets = async () => {
      const r = await api('GET', `/api/an/targets?month=${tMonth}`);
      const val = (kind, id) => r.rows.find((x) => x.kind === kind && x.ref_id === id)?.amount ?? '';
      $('#tTable').innerHTML = `<div class="table-wrap"><table class="list t-table"><thead><tr><th>Відділ / джерело</th><th class="r">Таргет на ${monthName(tMonth + '-01')}, ₴</th></tr></thead><tbody>
        ${cfg.depts.map((d) => `<tr class="t-dept"><td><b>${esc(d.name)}</b></td><td class="r"><input data-t="dept" data-id="${d.id}" inputmode="decimal" value="${val('dept', d.id)}" placeholder="сума джерел" aria-label="Таргет відділу ${esc(d.name)}"></td></tr>
          ${d.sources.map((s) => `<tr class="t-src"><td>${esc(s.name)}</td><td class="r"><input data-t="src" data-id="${s.id}" data-dept="${d.id}" inputmode="decimal" value="${val('src', s.id)}" aria-label="Таргет джерела ${esc(s.name)}"></td></tr>`).join('')}`).join('')}
        <tr class="t-total"><td>Разом</td><td class="r" id="tTotal"></td></tr></tbody></table></div>`;
      const recalc = () => {
        const n = (v) => parseFloat(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
        let total = 0;
        for (const d of cfg.depts) {
          const own = n($(`[data-t=dept][data-id="${d.id}"]`).value);
          const srcSum = $$(`[data-t=src][data-dept="${d.id}"]`).reduce((a, i) => a + n(i.value), 0);
          $(`[data-t=dept][data-id="${d.id}"]`).placeholder = srcSum ? `= ${nf0.format(srcSum)} (сума джерел)` : 'не задано';
          total += own || srcSum;
        }
        $('#tTotal').innerHTML = `<b>${uah(total)}</b>`;
      };
      $('#tTable').oninput = recalc;
      recalc();
    };
    $('#tMonth').onchange = (e) => { tMonth = e.target.value || tMonth; loadTargets(); };
    $('#tSave').onclick = async () => {
      const rows = $$('[data-t]').map((i) => ({ kind: i.dataset.t, ref_id: Number(i.dataset.id), amount: i.value.replace(/\s/g, '').replace(',', '.') }));
      try { await api('PUT', '/api/an/targets', { month: tMonth, rows, copyMonths: $('#tCopy').value }); toast('Таргети збережено'); lastData = null; } catch (er) { toast(er.message, true); }
    };
    loadTargets();

    // --- відділи і джерела
    let struct = cfg.depts.map((d) => ({ id: d.id, name: d.name, sources: d.sources.map((s) => ({ id: s.id, name: s.name, values: [...s.values] })) }));
    const drawStruct = () => {
      $('#structEd').innerHTML = struct.map((d, di) => `<div class="st-dept">
        <div class="st-head"><input value="${esc(d.name)}" data-dn="${di}" aria-label="Назва відділу"><button class="btn sm danger" data-ddel="${di}" aria-label="Видалити відділ ${esc(d.name)}">✕</button></div>
        <div class="st-srcs">${d.sources.map((s, si) => `<div class="st-src">
          <input value="${esc(s.name)}" data-sn="${di}.${si}" aria-label="Назва джерела">
          <div class="st-vals">${s.values.map((v, vi) => `<span class="vchip">${esc(v)}<button type="button" data-vdel="${di}.${si}.${vi}" aria-label="Прибрати ${esc(v)}">×</button></span>`).join('')}
            <input class="st-add" data-vadd="${di}.${si}" placeholder="+ значення поля 1, Enter" aria-label="Додати значення"></div>
          <button class="btn sm danger" data-sdel="${di}.${si}" aria-label="Видалити джерело ${esc(s.name)}">✕</button></div>`).join('')}
          <button class="btn sm" data-sadd="${di}">+ Джерело</button></div></div>`).join('');
    };
    drawStruct();
    const ed = $('#structEd');
    ed.oninput = (e) => {
      const t = e.target;
      if (t.dataset.dn != null) struct[+t.dataset.dn].name = t.value;
      if (t.dataset.sn) { const [a, b] = t.dataset.sn.split('.').map(Number); struct[a].sources[b].name = t.value; }
    };
    ed.onkeydown = (e) => {
      const t = e.target;
      if (t.dataset.vadd && e.key === 'Enter') {
        e.preventDefault();
        const v = t.value.trim().toLowerCase();
        const [a, b] = t.dataset.vadd.split('.').map(Number);
        if (v && !struct[a].sources[b].values.includes(v)) struct[a].sources[b].values.push(v);
        drawStruct();
        $(`[data-vadd="${a}.${b}"]`)?.focus();
      }
    };
    ed.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.ddel) struct.splice(+b.dataset.ddel, 1);
      else if (b.dataset.sadd) struct[+b.dataset.sadd].sources.push({ name: 'Нове джерело', values: [] });
      else if (b.dataset.sdel) { const [x, y] = b.dataset.sdel.split('.').map(Number); struct[x].sources.splice(y, 1); }
      else if (b.dataset.vdel) { const [x, y, z] = b.dataset.vdel.split('.').map(Number); struct[x].sources[y].values.splice(z, 1); }
      else return;
      drawStruct();
    };
    $('#dAdd').onclick = () => { struct.push({ name: 'Новий відділ', sources: [] }); drawStruct(); };
    const saveStruct = async () => {
      await api('PUT', '/api/an/structure', { depts: struct });
      toast('Відділи і джерела збережено');
      lastData = null;
      await viewSettings();
    };
    $('#structSave').onclick = () => saveStruct().catch((er) => toast(er.message, true));
    $$('[data-assign]').forEach((sel) => (sel.onchange = async () => {
      const sid = Number(sel.value);
      if (!sid) return;
      for (const d of struct) for (const s of d.sources) if (s.id === sid) s.values.push(sel.dataset.assign);
      try { await saveStruct(); } catch (er) { toast(er.message, true); }
    }));

    // --- менеджери
    $('#sMgr').onsubmit = async (e) => {
      e.preventDefault();
      const rows = $$('[data-login]').map((tr) => ({
        login: tr.dataset.login, name: $('[data-k=name]', tr).value, dept_id: $('[data-k=dept_id]', tr).value,
        depts: $$('[data-xd]', tr).filter((x) => x.checked).map((x) => Number(x.dataset.xd)),
      }))
        .filter((r) => r.name || r.dept_id);
      try { await api('PUT', '/api/an/managers', rows); toast('Менеджерів збережено'); lastData = null; } catch (er) { toast(er.message, true); }
    };

    // --- відділи CRM
    $('#sOff').onsubmit = async (e) => {
      e.preventDefault();
      const rows = $$('[data-office]').map((tr) => ({ office: tr.dataset.office, dept_id: $('select', tr).value })).filter((r) => r.dept_id);
      try { await api('PUT', '/api/an/office-map', rows); toast('Збережено'); lastData = null; } catch (er) { toast(er.message, true); }
    };

    // --- бренди
    let brands = cfg.brands.map((b) => ({ id: b.id, name: b.name, keywords: b.keywords }));
    const drawBrands = () => {
      $('#brandEd').innerHTML = brands.map((b, i) => `<div class="br-row">
        <input value="${esc(b.name)}" data-bn="${i}" placeholder="Назва бренду" aria-label="Назва бренду">
        <input value="${esc(b.keywords)}" data-bk="${i}" placeholder="ключові слова через кому" aria-label="Ключові слова">
        <button type="button" class="btn sm danger" data-bdel="${i}" aria-label="Видалити бренд ${esc(b.name)}">✕</button></div>`).join('');
    };
    drawBrands();
    $('#brandEd').oninput = (e) => {
      const t = e.target;
      if (t.dataset.bn) brands[+t.dataset.bn].name = t.value;
      if (t.dataset.bk) brands[+t.dataset.bk].keywords = t.value;
    };
    $('#brandEd').onclick = (e) => { const b = e.target.closest('[data-bdel]'); if (b) { brands.splice(+b.dataset.bdel, 1); drawBrands(); } };
    $('#bAdd').onclick = () => { brands.push({ name: '', keywords: '' }); drawBrands(); $$('[data-bn]').at(-1).focus(); };
    $('#sBrands').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('PUT', '/api/an/brands', brands.filter((b) => b.name.trim()));
        toast(`Бренди збережено${r.changed ? ` · оновлено товарів: ${r.changed}` : ''}`);
        lastData = null;
        await viewSettings();
      } catch (er) { toast(er.message, true); }
    };
  }

  return { viewDashboard, viewSettings };
}
