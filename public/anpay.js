// Аналітика оплат (надходження з Opendatabot): скільки, куди і від кого, за будь-який період. Лише власник і адміни.
const FACT = '#0d9488';
const CMP = '#b9c3c0';
const nf0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const uah = (n) => `${nf0.format(Math.round(n || 0))} ₴`;
const compact = (n) => (Math.abs(n) >= 1e6 ? `${nf1.format(n / 1e6)} млн` : Math.abs(n) >= 1e3 ? `${nf0.format(n / 1e3)} тис` : nf0.format(n));
const toUtc = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => fromUtc(toUtc(d) + n * 86400000);
const days = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000) + 1;
const monthStart = (d) => `${d.slice(0, 7)}-01`;
const addMonths = (d, n) => fromUtc(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + n, 1));
const monthEnd = (d) => fromUtc(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0));
const kyivToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const range = (a, b) => (a === b ? dm(a) : `${dm(a)} – ${dm(b)}`);
const rangeY = (a, b) => `${range(a, b)}.${b.slice(0, 4)}`;
const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
const pct = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);

export function createPayStatsUI(ctx) {
  const { api, $, $$, esc, toast, modal } = ctx;
  const LS = 'anpay_v1';
  const DEF = { period: 'cm', from: '', to: '', group: 'auto', accounts: [], payer: '', payerName: '', sort: {}, collapsed: [] };
  let ui = { ...DEF };
  try { ui = { ...DEF, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { /* */ }
  const persist = () => { try { localStorage.setItem(LS, JSON.stringify(ui)); } catch { /* */ } };
  let data = null;
  let minDate = '';

  function periods() {
    const t = kyivToday();
    const pm = addMonths(monthStart(t), -1);
    return {
      d7: { label: '7 днів', from: addDays(t, -6), to: t },
      cm: { label: 'Поточний місяць', from: monthStart(t), to: t },
      pm: { label: 'Попередній місяць', from: pm, to: monthEnd(pm) },
      y: { label: 'Цей рік', from: `${t.slice(0, 4)}-01-01`, to: t },
      all: { label: 'Весь час', from: minDate || `${+t.slice(0, 4) - 1}-01-01`, to: t },
      custom: { label: 'Свій період', from: ui.from || addDays(t, -29), to: ui.to || t },
    };
  }
  function current() {
    const p = periods()[ui.period] || periods().cm;
    let { from, to } = p;
    if (to < from) [from, to] = [to, from];
    const n = days(from, to);
    let cmpFrom = null; let cmpTo = null;
    if (ui.period === 'cm') { cmpFrom = addMonths(from, -1); cmpTo = addDays(cmpFrom, n - 1); if (cmpTo > monthEnd(cmpFrom)) cmpTo = monthEnd(cmpFrom); }
    else if (ui.period === 'pm') { cmpFrom = addMonths(from, -1); cmpTo = monthEnd(cmpFrom); }
    else if (ui.period === 'y') { cmpFrom = `${+from.slice(0, 4) - 1}${from.slice(4)}`; cmpTo = `${+to.slice(0, 4) - 1}${to.slice(4)}`; }
    else if (ui.period !== 'all') { cmpTo = addDays(from, -1); cmpFrom = addDays(cmpTo, -(n - 1)); }
    const group = ui.group !== 'auto' ? ui.group : n > 400 ? 'month' : n > 62 ? 'week' : 'day';
    return { from, to, cmpFrom, cmpTo, group, label: p.label };
  }

  async function view() {
    const el = ctx.main;
    el.innerHTML = `
      <div class="head-row an-head"><div><h2>Аналітика оплат</h2><div class="small muted" id="apFresh"></div></div>
        <div class="btn-row"><button class="btn" id="apRefresh">Оновити з Opendatabot</button></div></div>
      <div id="apHist"></div>
      <div class="an-periods ap-periods" role="group" aria-label="Період" id="apPeriods"></div>
      <div class="an-range" id="apRange"></div>
      <div id="apFilters"></div>
      <div id="apBody"><div class="card empty"><span class="spinner"></span></div></div>`;
    $('#apRefresh').onclick = async () => { $('#apRefresh').disabled = true; await api('POST', '/api/odb/sync', { force: true }).catch((e) => toast(e.message, true)); $('#apRefresh').disabled = false; load(); };
    renderPeriods();
    await load();
    // свіжі надходження і поступове завантаження історії
    (async () => {
      let r = await api('POST', '/api/odb/sync', {}).catch(() => null);
      if (r?.added) load();
      while (r?.hist && !r.hist.done && $('#apBody')) {
        showHist(r.hist);
        r = await api('POST', '/api/odb/sync', { force: true }).catch(() => null);
        if (r?.added) await load();
      }
      showHist(r?.hist);
    })();
  }

  function showHist(h) {
    const b = $('#apHist');
    if (!b) return;
    const p = h && h.total ? Math.min(99, Math.round(((h.offset || 0) / h.total) * 100)) : 0;
    b.innerHTML = h && !h.done && h.total ? `<div class="an-sync"><div class="an-sync-top"><span><span class="spinner"></span> Завантажую історію платежів з Opendatabot — дані ще неповні</span><b>${p}%</b></div>
      <div class="an-progress"><span style="width:${p}%"></span></div></div>` : '';
  }

  function renderPeriods() {
    const ps = periods();
    const r = current();
    $('#apPeriods').innerHTML = Object.entries(ps).map(([id, p]) => `<button class="an-period ${ui.period === id ? 'on' : ''}" data-p="${id}" aria-pressed="${ui.period === id}">
      <b>${esc(p.label)}</b><span>${id === 'custom' ? 'вибрати дати' : id === 'all' ? (minDate ? `з ${dm(minDate)}.${minDate.slice(0, 4)}` : 'усі дані') : range(p.from, p.to)}</span></button>`).join('');
    $$('[data-p]', $('#apPeriods')).forEach((b) => (b.onclick = () => { ui.period = b.dataset.p; persist(); renderPeriods(); load(); }));
    $('#apRange').innerHTML = `
      ${ui.period === 'custom' ? `<label>З <input type="date" id="apFrom" value="${esc(r.from)}"></label><label>по <input type="date" id="apTo" value="${esc(r.to)}"></label>` : `<span>Період: <b>${range(r.from, r.to)}${r.from.slice(0, 4) !== r.to.slice(0, 4) || ui.period === 'all' ? '' : `.${r.from.slice(0, 4)}`}</b></span>`}
      ${r.cmpFrom ? `<span class="an-sep"></span><span class="muted">порівняння з ${rangeY(r.cmpFrom, r.cmpTo)}</span>` : ''}
      <span class="an-sep"></span>
      <div class="seg" role="group" aria-label="Групувати">${[['auto', 'Авто'], ['day', 'Дні'], ['week', 'Тижні'], ['month', 'Місяці']].map(([k, t]) => `<button data-g="${k}" class="${ui.group === k ? 'on' : ''}" aria-pressed="${ui.group === k}">${t}</button>`).join('')}</div>`;
    const on = (id, k) => { const x = $(id); if (x) x.onchange = (e) => { ui[k] = e.target.value; persist(); load(); }; };
    on('#apFrom', 'from'); on('#apTo', 'to');
    $$('[data-g]', $('#apRange')).forEach((b) => (b.onclick = () => { ui.group = b.dataset.g; persist(); renderPeriods(); load(); }));
  }

  let seq = 0;
  async function load() {
    const body = $('#apBody');
    if (!body) return;
    const r = current();
    const n = ++seq;
    body.classList.add('loading');
    const p = new URLSearchParams({ from: r.from, to: r.to, group: r.group, accounts: ui.accounts.join(','), payer: ui.payer });
    if (r.cmpFrom) { p.set('cmpFrom', r.cmpFrom); p.set('cmpTo', r.cmpTo); }
    try {
      const d = await api('GET', `/api/odb/stats?${p}`);
      if (n !== seq || !$('#apBody')) return;
      data = { ...d, r };
      if (d.range.min && d.range.min !== minDate) { minDate = d.range.min; renderPeriods(); }
      $('#apFresh').textContent = d.lastSync ? `Дані з Opendatabot оновлено ${new Date(d.lastSync).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Дані ще не завантажено';
      showHist(d.hist);
      renderFilters();
      renderBody();
    } catch (e) { body.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; } finally { body.classList.remove('loading'); }
  }

  function renderFilters() {
    const d = data;
    const chip = (id, name, on) => `<button class="chip ${on ? 'on' : ''}" data-acc="${esc(id)}" aria-pressed="${on}">${esc(name)}</button>`;
    $('#apFilters').innerHTML = `<div class="card an-filters ap-filters">
      <div class="f-row"><span class="f-title">Рахунок</span><div class="f-chips">${d.accounts.map((a) => chip(a.id, a.name, ui.accounts.includes(a.id))).join('')}</div></div>
      ${ui.payer ? `<div class="f-row"><span class="f-title">Платник</span><div class="f-chips"><button class="chip on" id="apPayerOff" aria-pressed="true">${esc(ui.payerName || ui.payer)} ✕</button></div></div>` : ''}
      ${ui.accounts.length || ui.payer ? '<div class="f-foot"><span></span><button class="btn sm" id="apReset">Скинути фільтри</button></div>' : ''}</div>`;
    $$('[data-acc]', $('#apFilters')).forEach((b) => (b.onclick = () => toggleAcc(b.dataset.acc)));
    const po = $('#apPayerOff'); if (po) po.onclick = () => { ui.payer = ''; ui.payerName = ''; persist(); load(); };
    const rs = $('#apReset'); if (rs) rs.onclick = () => { ui.accounts = []; ui.payer = ''; ui.payerName = ''; persist(); load(); };
  }
  const toggleAcc = (id) => { if (!id) return; const i = ui.accounts.indexOf(id); if (i >= 0) ui.accounts.splice(i, 1); else ui.accounts.push(id); persist(); load(); };

  function delta(cur, prev) {
    if (prev == null) return '';
    const v = pct(cur, prev);
    if (v == null) return cur ? '<span class="d muted">нове</span>' : '';
    if (Math.abs(v) < 0.05) return '<span class="d muted">без змін</span>';
    return `<span class="d ${v > 0 ? 'good' : 'bad'}"><span aria-hidden="true">${v > 0 ? '▲' : '▼'}</span> ${nf1.format(Math.abs(v))}%</span>`;
  }

  // ---------- сортування ----------
  const G = { name: (r) => String(r.name).toLowerCase(), sum: (r) => r.sum, cnt: (r) => r.cnt, avg: (r) => (r.cnt ? r.sum / r.cnt : 0), dyn: (r) => (pct(r.sum, r.prevSum) ?? (r.sum ? Infinity : -Infinity)) };
  const sortRows = (b, rows) => {
    const s = ui.sort[b];
    if (!s) return rows;
    const m = s.dir === 'asc' ? 1 : -1;
    return [...rows].sort((x, y) => { const a = G[s.k](x); const c = G[s.k](y); return (typeof a === 'string' ? a.localeCompare(c, 'uk') : a - c) * m; });
  };
  const sortBtn = (b, k, label) => {
    const s = ui.sort[b]; const on = s?.k === k;
    return `<button type="button" class="sort-btn ${on ? 'on' : ''}" data-sort="${b}" data-k="${k}" aria-label="Сортувати: ${esc(label)}">${esc(label)}<span class="sort-ar" aria-hidden="true">${on ? (s.dir === 'asc' ? '↑' : '↓') : '↕'}</span></button>`;
  };
  const onSort = (b, k) => {
    const s = ui.sort[b]; const first = k === 'name' ? 'asc' : 'desc';
    ui.sort = { ...ui.sort };
    if (s?.k === k) { if (s.dir === first) ui.sort[b] = { k, dir: first === 'asc' ? 'desc' : 'asc' }; else delete ui.sort[b]; } else ui.sort[b] = { k, dir: first };
    persist(); renderBody();
  };

  function list(block, title, rows, { hasCmp, filterAttr, note = '', rename = false }) {
    if (!rows.length) return `<div class="card" data-col="${block}"><h3>${title}</h3><div class="muted small">Немає надходжень за період.</div></div>`;
    const max = Math.max(...rows.map((r) => r.sum), 1);
    const total = rows.reduce((t, r) => t + r.sum, 0) || 1;
    return `<div class="card" data-col="${block}"><h3>${title}</h3><div class="bk">
      <div class="bk-row bk-head"><span>${sortBtn(block, 'name', 'Назва')}</span><span></span>
        <span class="bk-hv">${sortBtn(block, 'sum', 'Сума')}${sortBtn(block, 'cnt', 'Платежів')}${sortBtn(block, 'avg', 'Сер.')}</span>
        <span class="bk-hd">${hasCmp ? sortBtn(block, 'dyn', 'Динаміка') : ''}</span></div>
      ${sortRows(block, rows).map((r) => `<div class="bk-row ${filterAttr(r).on ? 'on' : ''}" ${filterAttr(r).attr} tabindex="0" role="button" title="Натисніть, щоб відфільтрувати">
        <span class="bk-name">${esc(r.name)}${r.code ? `<small class="muted ap-code">${esc(r.code)}</small>` : ''}${rename && r.code ? ` <button type="button" class="linkbtn ap-ren" data-ren="${esc(r.key)}" data-name="${esc(r.name)}" data-auto="${esc(r.auto)}" aria-label="Перейменувати ${esc(r.name)}">✎</button>` : ''}</span>
        <span class="bk-bar"><span style="width:${((r.sum / max) * 100).toFixed(1)}%"></span></span>
        <span class="bk-val">${uah(r.sum)}<small>${nf0.format(r.cnt)} плат. · ${nf1.format((r.sum / total) * 100)}%</small></span>
        <span class="bk-d">${hasCmp ? delta(r.sum, r.prevSum) : ''}</span></div>`).join('')}</div>${note ? `<div class="small muted" style="margin-top:8px">${note}</div>` : ''}</div>`;
  }

  function renderBody() {
    const d = data;
    if (!d) return;
    const hasCmp = Boolean(d.prevTotal);
    const t = d.total; const p = d.prevTotal;
    const tile = (l, v, sub, dl) => `<div class="kpi"><div class="kpi-l">${l}</div><div class="kpi-v">${v}</div><div class="kpi-s">${dl || ''}${sub ? `<span class="muted">${sub}</span>` : ''}</div></div>`;
    $('#apBody').innerHTML = `
      <div class="kpis">
        ${tile('Надійшло', uah(t.sum), hasCmp ? `було ${uah(p.sum)}` : '', hasCmp ? delta(t.sum, p.sum) : '')}
        ${tile('Платежів', nf0.format(t.cnt), hasCmp ? `було ${nf0.format(p.cnt)}` : '', hasCmp ? delta(t.cnt, p.cnt) : '')}
        ${tile('Середній платіж', uah(t.avg), hasCmp ? `було ${uah(p.avg)}` : '', hasCmp ? delta(t.avg, p.avg) : '')}
      </div>
      <div class="card an-chart-card" data-col="ap-chart">
        <div class="an-chart-head"><h3>Надходження ${{ day: 'по днях', week: 'по тижнях', month: 'по місяцях' }[d.group]}</h3></div>
        <div class="legend"><span class="lg"><i class="ap-sw" style="background:${FACT}"></i>${esc(rangeY(d.r.from, d.r.to))}</span>${hasCmp ? `<span class="lg"><i class="ap-sw" style="background:${CMP}"></i>порівняння: ${esc(rangeY(d.r.cmpFrom, d.r.cmpTo))}</span>` : ''}</div>
        <div class="chart" id="apChart"></div>
        <button class="linkbtn small" id="apTableBtn">${ui.table ? 'Сховати таблицю' : 'Показати таблицею'}</button>
        <div id="apTable"></div>
      </div>
      <div class="an-grid ap-grid">
        ${list('ap-acc', 'Куди: по рахунках', d.byAccount, { hasCmp, filterAttr: (r) => ({ on: ui.accounts.includes(r.id), attr: `data-facc="${esc(r.id)}"` }) })}
        ${list('ap-payer', 'Звідки: платники', d.byPayer, { hasCmp, rename: true, filterAttr: (r) => ({ on: ui.payer === r.key, attr: `data-fpay="${esc(r.key)}" data-pname="${esc(r.name)}"` }), note: 'Платники групуються за кодом ЄДРПОУ; фізичні особи — однією групою. Назву групи можна змінити (✎). Виберіть рахунок угорі, щоб побачити, звідки гроші надходять саме на нього.' })}
      </div>`;
    $('#apTableBtn').onclick = () => { ui.table = !ui.table; persist(); renderBody(); };
    $$('[data-sort]', $('#apBody')).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); onSort(b.dataset.sort, b.dataset.k); }));
    const act = (el, fn) => { el.onclick = fn; el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }; };
    $$('[data-facc]', $('#apBody')).forEach((r) => act(r, () => toggleAcc(r.dataset.facc)));
    $$('[data-fpay]', $('#apBody')).forEach((r) => act(r, () => { const on = ui.payer === r.dataset.fpay; ui.payer = on ? '' : r.dataset.fpay; ui.payerName = on ? '' : r.dataset.pname; persist(); load(); }));
    $$('[data-ren]', $('#apBody')).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); renameDlg(b.dataset.ren, b.dataset.name, b.dataset.auto); }));
    drawChart();
    drawTable();
  }

  function renameDlg(code, name, auto) {
    const m = modal('Назва платника', `<form id="rnF" class="form-stack"><div class="small muted">ЄДРПОУ ${esc(code)}${auto ? ` · у виписці: ${esc(auto)}` : ''}</div>
      <label class="f"><span>Назва в аналітиці</span><input name="name" value="${esc(name)}" maxlength="120"></label>
      <div class="small muted">Залиште порожнім, щоб повернути назву з виписки.</div></form>`,
    { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="rnGo">Зберегти</button>' });
    const go = async () => { try { await api('PUT', `/api/odb/payers/${encodeURIComponent(code)}`, { name: $('#rnF', m.el).name.value }); m.close(); load(); } catch (er) { toast(er.message, true); } };
    $('#rnGo', m.el).onclick = go;
    $('#rnF', m.el).onsubmit = (e) => { e.preventDefault(); go(); };
  }

  // ---------- стовпчикова діаграма ----------
  function buckets() {
    const d = data;
    const { from, to, cmpFrom } = d.r;
    const keys = [];
    if (d.group === 'month') for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) keys.push(m.slice(0, 7));
    else if (d.group === 'week') { const dow = (new Date(toUtc(from)).getUTCDay() + 6) % 7; for (let w = addDays(from, -dow); w <= to; w = addDays(w, 7)) keys.push(w); }
    else for (let x = from; x <= to; x = addDays(x, 1)) keys.push(x);
    const cur = new Map(d.series.map((r) => [r.k, r]));
    let prevKeys = [];
    if (d.prevSeries && cmpFrom) {
      if (d.group === 'month') for (let m = monthStart(cmpFrom); prevKeys.length < keys.length; m = addMonths(m, 1)) prevKeys.push(m.slice(0, 7));
      else if (d.group === 'week') { const dow = (new Date(toUtc(cmpFrom)).getUTCDay() + 6) % 7; for (let w = addDays(cmpFrom, -dow); prevKeys.length < keys.length; w = addDays(w, 7)) prevKeys.push(w); }
      else for (let x = cmpFrom; prevKeys.length < keys.length; x = addDays(x, 1)) prevKeys.push(x);
    }
    const prev = new Map((d.prevSeries || []).map((r) => [r.k, r]));
    return keys.map((k, i) => ({ k, sum: cur.get(k)?.sum || 0, cnt: cur.get(k)?.cnt || 0, pk: prevKeys[i], psum: prevKeys[i] ? prev.get(prevKeys[i])?.sum || 0 : null, pcnt: prevKeys[i] ? prev.get(prevKeys[i])?.cnt || 0 : null }));
  }
  const keyLabel = (k, g) => (g === 'month' ? `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(2, 4)}` : dm(k));
  const keyLong = (k, g) => (g === 'month' ? `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}` : g === 'week' ? `тиждень з ${dm(k)}.${k.slice(0, 4)}` : `${dm(k)}.${k.slice(0, 4)}`);

  function drawChart() {
    const box = $('#apChart');
    if (!box) return;
    const g = data.group;
    const bs = buckets();
    const W = Math.max(280, box.clientWidth);
    const narrow = W < 520;
    const H = narrow ? 220 : 280;
    const pad = { l: narrow ? 46 : 60, r: 8, t: 12, b: 28 };
    const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
    const maxV = Math.max(1, ...bs.map((b) => Math.max(b.sum, b.psum || 0))) * 1.08;
    const step = iw / Math.max(bs.length, 1);
    const hasCmp = bs.some((b) => b.psum != null);
    const gap = Math.min(4, step * 0.2);
    const bw = Math.max(1.5, (step - gap) / (hasCmp ? 2 : 1));
    const y = (v) => pad.t + ih - (v / maxV) * ih;
    const ticks = 4;
    let svg = `<svg width="${W}" height="${H}" role="img" aria-label="Надходження ${esc(range(data.r.from, data.r.to))}">`;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxV / ticks) * i; const yy = y(v);
      svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke="#e7ecea"/><text class="ax" x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${compact(v)}</text>`;
    }
    const every = Math.ceil(bs.length / Math.max(2, Math.floor(iw / (narrow ? 52 : 64))));
    const r = Math.min(4, bw / 2);
    const bar = (x, v, color) => {
      if (!v) return '';
      const yy = y(v); const h = pad.t + ih - yy;
      const rr = Math.min(r, h);
      return `<path d="M${x},${pad.t + ih} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + bw - rr} Q${x + bw},${yy} ${x + bw},${yy + rr} V${pad.t + ih} Z" fill="${color}"/>`;
    };
    bs.forEach((b, i) => {
      const x0 = pad.l + i * step + gap / 2;
      if (hasCmp) svg += bar(x0, b.psum, CMP);
      svg += bar(hasCmp ? x0 + bw : x0, b.sum, FACT);
      if (i % every === 0) svg += `<text class="ax" x="${pad.l + i * step + step / 2}" y="${H - 8}" text-anchor="middle">${keyLabel(b.k, g)}</text>`;
    });
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}" stroke="#9aa6a2"/>`;
    svg += `<rect id="apHit" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
    svg += `<rect id="apHl" x="0" y="${pad.t}" width="${step}" height="${ih}" fill="#0d9488" opacity="0" pointer-events="none"/></svg><div class="tip" id="apTip" hidden></div>`;
    box.innerHTML = svg;
    const hit = $('#apHit'); const tip = $('#apTip'); const hl = $('#apHl');
    const show = (cx) => {
      const rect = box.getBoundingClientRect();
      const i = Math.max(0, Math.min(bs.length - 1, Math.floor((cx - rect.left - pad.l) / step)));
      const b = bs[i];
      hl.setAttribute('x', pad.l + i * step); hl.setAttribute('opacity', '0.06');
      tip.hidden = false;
      tip.innerHTML = `<div class="tip-h">${esc(keyLong(b.k, g))}</div>
        <div><i style="background:${FACT}"></i>Надійшло<b>${uah(b.sum)}</b></div><div class="small muted" style="margin-left:16px">${nf0.format(b.cnt)} платежів</div>
        ${b.psum != null ? `<div><i style="background:${CMP}"></i>${esc(keyLong(b.pk, g))}<b>${uah(b.psum)}</b></div>` : ''}`;
      const left = Math.min(Math.max(0, pad.l + i * step + step / 2 - tip.offsetWidth / 2), W - tip.offsetWidth);
      tip.style.left = `${left}px`; tip.style.top = '0px';
    };
    hit.onmousemove = (e) => show(e.clientX);
    hit.ontouchstart = (e) => show(e.touches[0].clientX);
    hit.onmouseleave = () => { tip.hidden = true; hl.setAttribute('opacity', '0'); };
  }

  function drawTable() {
    const box = $('#apTable');
    if (!box) return;
    if (!ui.table) { box.innerHTML = ''; return; }
    const g = data.group;
    const bs = buckets();
    const hasCmp = bs.some((b) => b.psum != null);
    box.innerHTML = `<div class="table-wrap"><table class="list an-table"><thead><tr><th>Період</th><th class="r">Надійшло</th><th class="r">Платежів</th>${hasCmp ? '<th class="r">Порівняння</th><th class="r">Зміна</th>' : ''}</tr></thead><tbody>
      ${bs.map((b) => `<tr><td>${esc(keyLong(b.k, g))}</td><td class="r">${uah(b.sum)}</td><td class="r">${nf0.format(b.cnt)}</td>${hasCmp ? `<td class="r">${b.psum != null ? uah(b.psum) : ''}</td><td class="r">${delta(b.sum, b.psum)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }

  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if ($('#apChart') && data) drawChart(); }, 200); });

  return { view };
}
