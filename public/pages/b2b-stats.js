// Аналітика B2B: однаковий звіт для партнера (свої продажі) і для адміна (будь-який партнер або всі разом).
// Вигляд: зліва панель фільтрів (період, бренди, категорії, «лише доставлені», Excel), справа — сітка графіків.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { uah } from './b2b-shared.js';

const nf0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const kday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
const shift = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fmtD = (d) => d.slice(5).split('-').reverse().join('.');
const wdOf = (d) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 — пн
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const SHADES = ['#eef0ef', '#cfe9e4', '#a7d3cc', '#5fb3a7', '#0f766e'];
const EARN = '#5fb3a7';
const SUP = '#c2410c'; // закупівлі партнера (наші продажі йому)

const PERIODS = {
  today: () => [kday(), kday()],
  week: () => [shift(kday(), -wdOf(kday())), kday()],
  month: () => [`${kday().slice(0, 8)}01`, kday()],
  lastmonth: () => {
    const end = shift(`${kday().slice(0, 8)}01`, -1);
    return [`${end.slice(0, 8)}01`, end];
  },
  30: () => [shift(kday(), -29), kday()],
  90: () => [shift(kday(), -89), kday()],
  all: () => ['', kday()],
};
// Масив, а не об'єкт: числові ключі ('30', '90') в об'єкті завжди йдуть першими.
const PERIOD_LIST = [['today', 'Сьогодні'], ['week', 'Цей тиждень'], ['month', 'Цей місяць'], ['lastmonth', 'Минулий місяць'], ['30', 'Останні 30 днів'], ['90', 'Останні 90 днів'], ['all', 'За весь час']];
const PERIOD_NAMES = Object.fromEntries(PERIOD_LIST);
const uah0 = (v) => `${nf0.format(Math.round(v || 0))} грн`;

// Зміна до попереднього періоду; lowerBetter — для повернень (зростання — погано). points — різниця в пунктах, не у %.
function delta(cur, prev, { lowerBetter = false, points = false } = {}) {
  if (!prev && !points) return cur ? '<span class="small muted">нове</span>' : '';
  const p = points ? cur - prev : ((cur - prev) / Math.abs(prev)) * 100;
  const good = lowerBetter ? p < -0.05 : p > 0.05;
  const bad = lowerBetter ? p > 0.05 : p < -0.05;
  const color = good ? 'var(--ok)' : bad ? 'var(--bad)' : 'var(--muted)';
  return `<span class="small" style="color:${color};font-weight:600">${p > 0 ? '▲' : p < 0 ? '▼' : '•'} ${nf1.format(Math.abs(p))}${points ? ' п.' : '%'}</span>`;
}
const kpi = (label, value, sub = '') => `<div class="kpi"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;

// Лінії «Продажі» і «Заробіток» по днях. Наведення на день — підказка з цифрами.
function lineChart(series) {
  if (!series.length) return '';
  const W = 800, H = 220, L = 46, B = 22, T = 10;
  const withSup = series.some((r) => r.supply > 0);
  const max = Math.max(1, ...series.map((r) => Math.max(r.sum, withSup ? r.supply || 0 : 0)));
  const x = (i) => L + (series.length === 1 ? (W - L) / 2 : (i / (series.length - 1)) * (W - L - 6));
  const y = (v) => Math.round(T + (H - B - T) * (1 - v / max));
  const pts = (k) => series.map((r, i) => `${x(i).toFixed(1)},${y(r[k] || 0)}`).join(' ');
  const step = Math.max(1, Math.ceil(series.length / 10));
  const bw = (W - L) / series.length;
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" y1="${y(max * f)}" x2="${W}" y2="${y(max * f)}" stroke="#eef0ef"></line>
    <text x="${L - 6}" y="${y(max * f) + 4}" font-size="11" text-anchor="end" fill="var(--muted)">${nf0.format(Math.round((max * f) / 1000))}к</text>`).join('');
  const anchor = (i) => (series.length > 1 && i === series.length - 1 ? 'end' : series.length > 1 && i === 0 ? 'start' : 'middle');
  const long = series.length > 366;
  const lbl = (d) => (long ? `${fmtD(d)}.${d.slice(2, 4)}` : fmtD(d));
  const labels = series.map((r, i) => (i % step === 0 || i === series.length - 1 ? `<text x="${x(i)}" y="${H - 4}" font-size="11" text-anchor="${anchor(i)}" fill="var(--muted)">${lbl(r.d)}</text>` : '')).join('');
  // Підказка: вертикальна лінія, точка і віконце з цифрами за день — wireChart() рухає їх за курсором / пальцем.
  const hover = `<line class="an7-gl" x1="0" y1="${T}" x2="0" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"></line>
    <circle class="an7-gd" r="5" fill="var(--accent)" stroke="#fff" stroke-width="2" visibility="hidden"></circle>
    <rect class="an7-hit" x="${L}" y="0" width="${W - L}" height="${H - B}" fill="transparent"></rect>`;
  lineChart.geo = { W, L, x, y, n: series.length, bw };
  const dots = series.length <= 45 ? series.map((r, i) => (r.sum ? `<circle cx="${x(i)}" cy="${y(r.sum)}" r="3" fill="var(--accent)"></circle>` : '')
    + (withSup && r.supply ? `<rect x="${x(i) - 3.5}" y="${y(r.supply) - 3.5}" width="7" height="7" fill="${SUP}"></rect>` : '')).join('') : '';
  return `<div class="an7-chart"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Продажі й заробіток по днях">
    ${grid}
    <polygon points="${x(0)},${y(0)} ${pts('sum')} ${x(series.length - 1)},${y(0)}" fill="var(--accent)" opacity=".1"></polygon>
    <polyline points="${pts('sum')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"></polyline>
    <polyline points="${pts('earn')}" fill="none" stroke="${EARN}" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round"></polyline>
    ${withSup ? `<polyline points="${pts('supply')}" fill="none" stroke="${SUP}" stroke-width="2" stroke-linejoin="round"></polyline>` : ''}
    ${dots}${labels}${hover}</svg><div class="an7-tip" hidden></div></div>`;
}

function wireChart(series) {
  const box = $('.an7-chart');
  const svg = box?.querySelector('svg');
  const g = lineChart.geo;
  if (!svg || !g) return;
  const tip = box.querySelector('.an7-tip');
  const gl = svg.querySelector('.an7-gl');
  const gd = svg.querySelector('.an7-gd');
  const hide = () => { tip.hidden = true; gl.setAttribute('visibility', 'hidden'); gd.setAttribute('visibility', 'hidden'); };
  const show = (e) => {
    const rc = svg.getBoundingClientRect();
    const vx = ((e.clientX - rc.left) / rc.width) * g.W;
    let i = g.n === 1 ? 0 : Math.round(((vx - g.L) / (g.W - g.L - 6)) * (g.n - 1));
    i = Math.max(0, Math.min(g.n - 1, i));
    const r = series[i];
    const cx = g.x(i);
    gl.setAttribute('x1', cx); gl.setAttribute('x2', cx); gl.setAttribute('visibility', 'visible');
    gd.setAttribute('cx', cx); gd.setAttribute('cy', g.y(r.sum)); gd.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${fmtD(r.d)}.${r.d.slice(0, 4)} · ${WD[wdOf(r.d)]}</b>
      <div class="an7-tr"><span><span class="an7-ln" style="background:var(--accent)"></span>Продажі</span><b>${uah(r.sum)}</b></div>
      <div class="an7-tr"><span>Замовлень</span><b>${r.cnt}</b></div>
      <div class="an7-tr"><span><span class="an7-ln" style="background:${EARN}"></span>Заробіток</span><b>${uah(r.earn)}</b></div>
      ${r.supply ? `<div class="an7-tr"><span><span class="an7-ln" style="background:${SUP}"></span>Закупівлі</span><b>${uah(r.supply)}</b></div>` : ''}`;
    tip.hidden = false;
    const px = (cx / g.W) * rc.width + (svg.offsetLeft || 0);
    const left = px + 14 + tip.offsetWidth > box.scrollLeft + box.clientWidth ? px - 14 - tip.offsetWidth : px + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, (g.y(r.sum) / 220) * rc.height - tip.offsetHeight / 2)}px`;
  };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

// Кільце статусів відправлення (тони LP-CRM).
function donut(dl, total) {
  const parts = [['ok', 'Доставлено', 'var(--ok)'], ['info', 'В дорозі / на відділенні', 'var(--info)'], ['bad', 'Повернення / відмова', 'var(--bad)'], ['none', 'Ще без статусу', '#c9d1ce']];
  const R = 54, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = parts.map(([k, , color]) => {
    const len = total ? (dl[k] / total) * C : 0;
    const a = len ? `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${color}" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"></circle>` : '';
    off += len;
    return a;
  }).join('');
  const pct = (n) => (total ? ` <span class="muted">${nf0.format((n / total) * 100)}%</span>` : '');
  return `<div class="an7-donut">
    <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Статуси відправлень"><circle cx="70" cy="70" r="${R}" fill="none" stroke="#eef0ef" stroke-width="18"></circle>${arcs}
      <text x="70" y="76" text-anchor="middle" font-size="22" font-weight="700" fill="var(--ink)">${nf0.format(total)}</text></svg>
    <div class="form-stack" style="gap:8px">${parts.map(([k, name, color]) => `<div class="small"><span class="an7-sw" style="background:${color}"></span>${name} · <b>${dl[k]}</b>${pct(dl[k])}</div>`).join('')}</div>
  </div>`;
}

// Теплова карта «тиждень × день тижня» — кількість замовлень клієнтів. Для довгих періодів — просто дні тижня.
function heatmap(series, weekdays) {
  const weeks = new Map();
  for (const r of series) {
    const mon = shift(r.d, -wdOf(r.d));
    if (!weeks.has(mon)) weeks.set(mon, Array(7).fill(null));
    weeks.get(mon)[wdOf(r.d)] = r;
  }
  if (weeks.size > 16 || weeks.size < 2) {
    const m = Math.max(1, ...weekdays);
    return `<div class="form-stack" style="gap:6px">${weekdays.map((n, i) => `<div style="display:flex;align-items:center;gap:8px" class="small"><span style="width:22px">${WD[i]}</span>
      <div style="flex:1;height:12px;background:var(--accent-soft);border-radius:3px"><div style="height:12px;width:${Math.round((n / m) * 100)}%;background:var(--accent);border-radius:3px"></div></div><b style="width:32px;text-align:right">${n}</b></div>`).join('')}</div>`;
  }
  const max = Math.max(1, ...series.map((r) => r.cnt));
  const cell = (r) => {
    if (!r) return '<span></span>';
    const k = r.cnt ? Math.min(4, 1 + Math.floor((r.cnt / max) * 3.99)) : 0;
    return `<span class="an7-hc" style="background:${SHADES[k]};color:${k >= 3 ? '#fff' : 'var(--ink)'}" title="${fmtD(r.d)}: ${r.cnt} замовл. · ${uah(r.sum)}">${r.cnt || ''}</span>`;
  };
  return `<div class="an7-heat"><span></span>${WD.map((w) => `<span class="small muted">${w}</span>`).join('')}
    ${[...weeks].map(([mon, days]) => `<span class="small muted">з ${fmtD(mon)}</span>${days.map(cell).join('')}`).join('')}</div>
    <div class="small muted" style="display:flex;gap:8px;align-items:center;margin-top:8px">менше ${SHADES.map((c) => `<span class="an7-sw" style="background:${c};margin:0"></span>`).join('')} більше
      · найактивніший день — <b style="color:var(--ink)">${WD[weekdays.indexOf(Math.max(...weekdays))]}</b></div>`;
}

// Таблиця з горизонтальними смугами частки.
function shareTable(rows, { title, sortKey, limit = 15, extra = true }) {
  const list = [...rows].sort((a, b) => b[sortKey] - a[sortKey]).slice(0, limit);
  const max = Math.max(1, ...list.map((r) => r[sortKey]));
  if (!list.length) return `<div class="small muted">Немає продажів за період.</div>`;
  return `<table class="list"><thead><tr><th>${title}</th><th class="r">Шт</th><th class="r">Сума закупки</th>${extra ? '<th class="r hide-m">Заробіток (РРЦ)</th><th class="r hide-m">Націнка</th>' : ''}</tr></thead><tbody>
    ${list.map((r) => `<tr><td>${esc(r.name)}<div style="height:4px;background:var(--accent-soft);border-radius:2px;margin-top:4px"><div style="height:4px;width:${Math.round((r[sortKey] / max) * 100)}%;background:var(--accent);border-radius:2px"></div></div></td>
      <td class="r">${nf0.format(r.units)}</td><td class="r">${money(r.sum)}</td>${extra ? `<td class="r hide-m"><b>${money(r.earn)}</b></td><td class="r hide-m small">${nf1.format(r.marginPct)}%</td>` : ''}</tr>`).join('')}</tbody></table>`;
}

// Топ товарів смугами (5 найкращих за сумою).
function topBars(products) {
  const list = products.slice(0, 5);
  if (!list.length) return '<div class="small muted">Немає продажів за період.</div>';
  const max = Math.max(1, ...list.map((p) => p.sum));
  return list.map((p) => `<div class="form-stack" style="gap:4px">
    <div style="display:flex;justify-content:space-between;gap:10px" class="small"><span class="an7-ell" title="${esc(p.name)}">${esc(p.name)}</span><span style="white-space:nowrap"><b>${uah(p.sum)}</b> <span class="muted">· ${nf0.format(p.units)} шт</span></span></div>
    <div style="height:10px;border-radius:4px;background:#eef0ef"><div style="height:10px;border-radius:4px;background:var(--accent);width:${Math.max(2, Math.round((p.sum / max) * 100))}%"></div></div></div>`).join('');
}

function exportXlsx(d, title) {
  const s = d.sales;
  const prodCols = [{ title: 'Назва', width: 44 }, { title: 'Шт', width: 8 }, { title: 'Замовлень', width: 11 }, { title: 'Сума закупки', width: 15, fmt: 'money' }, { title: 'Заробіток (РРЦ)', width: 16, fmt: 'money' }, { title: 'Націнка, %', width: 11 }];
  const prodRows = (list) => list.map((r) => [r.name, r.units, r.orders, r.sum, r.earn, r.marginPct]);
  downloadXlsx(`${title} ${d.period.from}_${d.period.to}.xlsx`.replace(/[\\/:*?"<>|]+/g, '_'), [
    { name: 'Підсумок', cols: [{ title: 'Показник', width: 32 }, { title: 'Значення', width: 16 }, { title: 'Попередній період', width: 18 }], rows: [
      ['Період', `${d.period.from} – ${d.period.to}`, `${d.prev.from} – ${d.prev.to}`],
      ['Продажі, грн', s.sum, d.salesPrev.sum], ['Замовлень клієнтів', s.cnt, d.salesPrev.cnt], ['Продано, шт', s.units, d.salesPrev.units],
      ['Середній чек, грн', s.avg, d.salesPrev.avg], ['Заробіток (за РРЦ), грн', s.earn, d.salesPrev.earn], ['Повернення, %', s.returnsPct, d.salesPrev.returnsPct],
      ['Закупівлі, грн', d.supplies.sum, d.suppliesPrev.sum], ['До оплати, грн', d.debt.due, ''], ['Залишок із закупівель, шт', d.stock.units, ''],
    ] },
    { name: 'По днях', cols: [{ title: 'Дата', width: 12 }, { title: 'Замовлень', width: 11 }, { title: 'Продажі', width: 14, fmt: 'money' }, { title: 'Заробіток', width: 14, fmt: 'money' }, { title: 'Закупівлі', width: 14, fmt: 'money' }],
      rows: d.series.map((r) => [r.d, r.cnt, r.sum, r.earn, r.supply]) },
    { name: 'Товари', cols: prodCols, rows: prodRows(d.products) },
    { name: 'Бренди', cols: prodCols, rows: prodRows(d.brands) },
    { name: 'Категорії', cols: prodCols, rows: prodRows(d.categories) },
    { name: 'Статуси LP-CRM', cols: [{ title: 'Статус', width: 30 }, { title: 'Замовлень', width: 11 }], rows: d.crm.map((r) => [r.status, r.n]) },
  ]);
  toast('Звіт завантажено');
}

// mount: { url — '/api/b2b/p/stats' або '/api/b2b/stats', admin — показати вибір партнера }
export function createB2bStats() {
  const state = { period: 'month', from: '', to: '', partner: '', brands: [], cats: [], delivered: false, allProducts: false, open: null };

  async function view({ url, admin = false, title = 'Аналітика продажів', partner = '' } = {}) {
    if (partner !== undefined && partner !== '') state.partner = String(partner);
    const [from, to] = state.period === 'custom' ? [state.from, state.to] : PERIODS[state.period]();
    const qs = new URLSearchParams(state.period === 'all' ? { all: '1' } : { from, to });
    if (admin && state.partner) qs.set('partner', state.partner);
    if (state.brands.length) qs.set('brands', state.brands.join(','));
    if (state.cats.length) qs.set('cats', state.cats.join(','));
    if (state.delivered) qs.set('delivered', '1');
    const [d, partners] = await Promise.all([api('GET', `${url}?${qs}`), admin ? api('GET', '/api/b2b/partners') : null]);
    const s = d.sales;
    const sp = d.salesPrev;
    const fc = d.facets || { brands: [], cats: [] };
    const dl = d.delivery || { ok: 0, info: 0, bad: 0, none: 0 };
    const filtered = state.brands.length || state.cats.length || state.delivered;
    if (state.open === null) state.open = window.matchMedia?.('(min-width: 901px)').matches ?? true;
    const checks = (list, sel, attr) => (list.length ? list.map((r) => `<label class="an7-c"><input type="checkbox" data-${attr}="${r.id}" ${!sel.length || sel.includes(r.id) ? 'checked' : ''}>
      <span class="an7-ell">${esc(r.name)}</span><span class="small muted">${nf0.format(r.units)}</span></label>`).join('') : '<div class="small muted">Немає продажів за період.</div>');
    const cmp = d.period.all ? () => '' : delta;
    // Закупівлі — що партнер купив у нас (окремо від «Продажів» — замовлень його клієнтів через сервіс).
    const supKpi = kpi('Закупівлі', uah0(d.supplies.sum), `${cmp(d.supplies.sum, d.suppliesPrev.sum)} <span class="muted">${d.supplies.cnt} шт · оплачено ${uah0(d.supplies.paid)}</span>`);
    const perLabel = state.period === 'custom' ? `${fmtD(d.period.from)}–${fmtD(d.period.to)}` : PERIOD_NAMES[state.period];

    main.innerHTML = `
      <div class="head-row"><h2>${esc(title)}</h2>
        ${admin ? `<select id="stPartner" aria-label="Партнер" style="max-width:260px"><option value="">Усі партнери</option>${partners.map((p) => `<option value="${p.id}" ${String(state.partner) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}</div>
      <div class="an7">
        <details class="card an7-f" ${state.open ? 'open' : ''}>
          <summary><b>Фільтри</b><span class="small muted">${esc(perLabel)}${filtered ? ' · є фільтри' : ''}</span></summary>
          <div class="an7-g"><div class="an7-h">Період</div>
            ${PERIOD_LIST.map(([k, v]) => `<button class="an7-per ${state.period === k ? 'on' : ''}" data-per="${k}">${v}</button>`).join('')}
            <div class="an7-dates ${state.period === 'custom' ? 'on' : ''}"><span class="small muted">Свій період</span>
              <input type="date" id="stFrom" value="${esc(d.period.from)}" aria-label="З дати"><input type="date" id="stTo" value="${esc(d.period.to)}" aria-label="По дату"></div>
          </div>
          <div class="an7-g"><div class="an7-h">Бренди <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">· шт</span></div>${checks(fc.brands, state.brands, 'fb')}</div>
          <div class="an7-g"><div class="an7-h">Категорії</div>${checks(fc.cats, state.cats, 'fcat')}</div>
          <div class="an7-g"><div class="an7-h">Рахувати</div>
            <label class="an7-c"><input type="radio" name="stDl" value="0" ${state.delivered ? '' : 'checked'}> Усі замовлення</label>
            <label class="an7-c"><input type="radio" name="stDl" value="1" ${state.delivered ? 'checked' : ''}> Лише доставлені <span class="small muted">(LP-CRM)</span></label>
          </div>
          <div class="btn-row" style="flex-wrap:wrap">
            <button class="btn" id="stXlsx">⬇ Excel</button>
            ${filtered ? '<button class="btn" id="stReset">Скинути фільтри</button>' : ''}
          </div>
        </details>

        <div class="an7-main">
          <div class="small muted">Період ${fmtD(d.period.from)}${d.period.all ? `.${d.period.from.slice(0, 4)}` : ''}–${fmtD(d.period.to)} (${d.period.days} дн.)${d.period.all ? '' : ` · порівняння з ${fmtD(d.prev.from)}–${fmtD(d.prev.to)}`}.
            «Продажі» — замовлення клієнтів партнера через сервіс, «Закупівлі» — що партнер купив у нас. «Заробіток» — різниця між РРЦ і ціною партнера, якщо продавати за РРЦ.</div>
          ${admin && state.partner && !s.cnt && d.supplies.cnt ? `<div class="alert info small">${esc(partners.find((p) => String(p.id) === String(state.partner))?.name || 'Партнер')} не оформлює через сервіс замовлень клієнтів (самовивіз або власна доставка), тож «Продажі» клієнтам — 0. Його закупівлі за період — <b>${uah(d.supplies.sum)}</b> (${d.supplies.cnt} шт), вони на графіку і в «Гроші й закупівлі».</div>` : ''}
          <div class="kpis an7-k">
            ${admin ? supKpi : ''}
            ${kpi('Продажі', uah0(s.sum), cmp(s.sum, sp.sum))}
            ${kpi('Замовлень', nf0.format(s.cnt), `${cmp(s.cnt, sp.cnt)} <span class="muted">${nf1.format(s.perDay)} на день</span>`)}
            ${kpi('Середній чек', uah0(s.avg), cmp(s.avg, sp.avg))}
            ${kpi('Заробіток', uah0(s.earn), cmp(s.earn, sp.earn))}
            ${kpi('Повернення', `${nf1.format(s.returnsPct || 0)}<small>%</small>`, `${cmp(s.returnsPct || 0, sp.returnsPct || 0, { lowerBetter: true, points: true })} <span class="muted">${s.returns || 0} замовл.</span>`)}
            ${admin ? '' : supKpi}
          </div>
          <div class="card form-stack">
            <h3 style="margin:0">${d.series.some((r) => r.supply > 0) ? 'Продажі, заробіток і закупівлі' : 'Продажі й заробіток'}</h3>
            ${lineChart(d.series)}
            <div class="small muted" style="display:flex;gap:16px;flex-wrap:wrap">
              <span><span class="an7-ln" style="background:var(--accent)"></span>Продажі</span>
              <span><span class="an7-ln" style="background:repeating-linear-gradient(90deg,${EARN} 0 6px,transparent 6px 10px)"></span>Заробіток</span>
              ${d.series.some((r) => r.supply > 0) ? `<span><span class="an7-ln" style="background:${SUP}"></span>Закупівлі</span>` : ''}
              <span>Наведіть на день — побачите цифри</span></div>
          </div>
          <div class="an7-2">
            <div class="card form-stack">
              <div class="head-row" style="margin:0"><h3 style="margin:0">${state.allProducts ? 'Усі товари' : 'Топ-5 товарів'}</h3>
                ${d.products.length > 5 ? `<button class="chip" id="stAll">${state.allProducts ? 'Згорнути' : `Усі ${d.products.length}`}</button>` : ''}</div>
              ${state.allProducts ? shareTable(d.products, { title: 'Товар', sortKey: 'sum', limit: 100 }) : topBars(d.products)}
            </div>
            <div class="card form-stack"><h3 style="margin:0">Статус відправлення</h3>${donut(dl, s.cnt)}</div>
          </div>
          <div class="card form-stack"><h3 style="margin:0">Коли замовляють клієнти</h3>${heatmap(d.series, d.weekdays)}</div>
          <div class="an7-2">
            <div class="card form-stack"><h3 style="margin:0">Бренди</h3>${shareTable(d.brands, { title: 'Бренд', sortKey: 'sum', extra: false })}</div>
            <div class="card form-stack"><h3 style="margin:0">Гроші й закупівлі</h3>
              <div class="an7-kv"><span>Закупівлі за період</span><b>${uah(d.supplies.sum)} <span class="small muted">· ${d.supplies.cnt} шт</span></b></div>
              <div class="an7-kv"><span>З них оплачено</span><b>${uah(d.supplies.paid)}</b></div>
              <div class="an7-kv"><span>До оплати зараз</span><b style="color:${d.debt.due ? 'var(--bad)' : 'inherit'}">${uah(d.debt.due)}${d.debt.dueCnt ? ` <span class="small muted">· ${d.debt.dueCnt} рах.</span>` : ''}</b></div>
              ${d.debt.wait ? `<div class="an7-kv"><span>Ще без рахунку</span><b>${uah(d.debt.wait)}</b></div>` : ''}
              <div class="an7-kv"><span>Залишок у закупівлях</span><b>${nf0.format(d.stock.units)} шт <span class="small muted">· ${uah(d.stock.sum)}</span></b></div>
              <div class="an7-kv"><span>Без закупівлі / не оплачено</span><b>${d.noSupply} / ${d.unpaidClients}</b></div>
            </div>
          </div>
          ${d.partners ? `<div class="card form-stack"><h3 style="margin:0">Партнери</h3>${d.partners.length ? `<table class="list"><thead><tr><th>Партнер</th><th class="r">Замовл.</th><th class="r">Продажі</th><th class="r">Закупівлі</th></tr></thead><tbody>
            ${d.partners.map((p) => `<tr class="click" data-sp="${p.id}"><td>${esc(p.name)}</td><td class="r">${p.cnt}</td><td class="r">${money(p.sum)}</td><td class="r">${money(p.supply)}</td></tr>`).join('')}</tbody></table>` : '<div class="small muted">Немає даних за період.</div>'}</div>` : ''}
        </div>
      </div>`;

    const again = () => view({ url, admin, title });
    wireChart(d.series);
    $('.an7-f').ontoggle = (e) => { state.open = e.target.open; };
    $$('[data-per]').forEach((b) => (b.onclick = () => { state.period = b.dataset.per; again(); }));
    const custom = () => { if ($('#stFrom').value && $('#stTo').value) { state.period = 'custom'; state.from = $('#stFrom').value; state.to = $('#stTo').value; again(); } };
    $('#stFrom').onchange = custom;
    $('#stTo').onchange = custom;
    // Галочки: усі відмічені = без фільтра; якщо зняти всі — фільтр скидається.
    const wireChecks = (attr, key) => $$(`[data-${attr}]`).forEach((cb) => (cb.onchange = () => {
      const all = $$(`[data-${attr}]`);
      const on = all.filter((x) => x.checked).map((x) => Number(x.dataset[attr]));
      state[key] = on.length === all.length || !on.length ? [] : on;
      again();
    }));
    wireChecks('fb', 'brands');
    wireChecks('fcat', 'cats');
    $$('[name=stDl]').forEach((r) => (r.onchange = () => { state.delivered = r.value === '1'; again(); }));
    $('#stReset') && ($('#stReset').onclick = () => { state.brands = []; state.cats = []; state.delivered = false; again(); });
    $('#stXlsx').onclick = () => exportXlsx(d, title);
    $('#stAll') && ($('#stAll').onclick = () => { state.allProducts = !state.allProducts; again(); });
    $('#stPartner') && ($('#stPartner').onchange = (e) => { state.partner = e.target.value; state.brands = []; state.cats = []; again(); });
    $$('[data-sp]').forEach((tr) => (tr.onclick = () => { state.partner = tr.dataset.sp; state.brands = []; state.cats = []; again(); }));
  }
  return { view, state };
}
