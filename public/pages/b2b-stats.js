// Аналітика B2B: однаковий звіт для партнера (свої продажі) і для адміна (будь-який партнер або всі разом).
import { esc, money } from '../invoice.js';
import { $, $$, main, api } from '../core/ui.js';
import { uah } from './b2b-shared.js';

const nf0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });
const kday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
const shift = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fmtD = (d) => d.slice(5).split('-').reverse().join('.');
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

const PERIODS = {
  7: () => [shift(kday(), -6), kday()],
  30: () => [shift(kday(), -29), kday()],
  90: () => [shift(kday(), -89), kday()],
  month: () => [`${kday().slice(0, 8)}01`, kday()],
  lastmonth: () => {
    const first = `${kday().slice(0, 8)}01`;
    const end = shift(first, -1);
    return [`${end.slice(0, 8)}01`, end];
  },
};
const PERIOD_NAMES = { 7: '7 днів', 30: '30 днів', 90: '90 днів', month: 'Цей місяць', lastmonth: 'Минулий місяць' };

function delta(cur, prev) {
  if (!prev) return cur ? '<span class="small muted">нове</span>' : '';
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  const cls = p > 0.5 ? 'ok' : p < -0.5 ? 'bad' : '';
  return `<span class="small" style="color:var(--${cls || 'muted'})">${p > 0 ? '▲' : p < 0 ? '▼' : '•'} ${nf1.format(Math.abs(p))}%</span>`;
}
const kpi = (label, value, sub = '') => `<div class="kpi"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;

// Стовпчики по днях: сума продажів (стовпчик) і кількість замовлень (підпис).
function dayChart(series, metric) {
  const vals = series.map((r) => (metric === 'cnt' ? r.cnt : metric === 'supply' ? r.supply : r.sum));
  const max = Math.max(1, ...vals);
  const W = Math.max(320, series.length * 18);
  const H = 160;
  const bw = W / series.length;
  const step = Math.ceil(series.length / 12);
  const bars = series.map((r, i) => {
    const v = vals[i];
    const h = Math.round((v / max) * (H - 30));
    return `<g><rect x="${i * bw + 2}" y="${H - 18 - h}" width="${Math.max(2, bw - 4)}" height="${h}" rx="2" fill="var(--accent)" opacity="${v ? 0.85 : 0.15}">
      <title>${fmtD(r.d)}: ${metric === 'cnt' ? `${v} замовл.` : uah(v)}${metric !== 'cnt' ? ` · ${r.cnt} замовл.` : ''}</title></rect>
      ${i % step === 0 ? `<text x="${i * bw + bw / 2}" y="${H - 4}" font-size="10" text-anchor="middle" fill="var(--muted)">${fmtD(r.d)}</text>` : ''}</g>`;
  }).join('');
  return `<div style="overflow-x:auto"><svg width="${W}" height="${H}" role="img" aria-label="Графік по днях">${bars}</svg></div>`;
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

// mount: { url — '/api/b2b/p/stats' або '/api/b2b/stats', admin — показати вибір партнера, partners — список партнерів }
export function createB2bStats() {
  const state = { period: '30', from: '', to: '', partner: '', metric: 'sum', sort: 'units' };

  async function view({ url, admin = false, title = 'Аналітика продажів', partner = '' } = {}) {
    if (partner !== undefined && partner !== '') state.partner = String(partner);
    const [from, to] = state.period === 'custom' ? [state.from, state.to] : PERIODS[state.period]();
    const qs = new URLSearchParams({ from, to, ...(admin && state.partner ? { partner: state.partner } : {}) });
    const [d, partners] = await Promise.all([api('GET', `${url}?${qs}`), admin ? api('GET', '/api/b2b/partners') : null]);
    const s = d.sales;
    const sp = d.salesPrev;
    main.innerHTML = `
      <div class="head-row"><h2>${esc(title)}</h2></div>
      <div class="btn-row" style="margin-bottom:12px;flex-wrap:wrap">
        ${Object.entries(PERIOD_NAMES).map(([k, v]) => `<button class="chip ${state.period === k ? 'on' : ''}" data-per="${k}">${v}</button>`).join('')}
        <input type="date" id="stFrom" value="${esc(d.period.from)}" aria-label="З дати" style="max-width:150px">
        <input type="date" id="stTo" value="${esc(d.period.to)}" aria-label="По дату" style="max-width:150px">
        ${admin ? `<select id="stPartner" aria-label="Партнер" style="max-width:240px"><option value="">Усі партнери</option>${partners.map((p) => `<option value="${p.id}" ${String(state.partner) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="small muted" style="margin-bottom:10px">Період ${fmtD(d.period.from)}–${fmtD(d.period.to)} (${d.period.days} дн.) · порівняння з ${fmtD(d.prev.from)}–${fmtD(d.prev.to)}.
        «Заробіток» — різниця між РРЦ і ціною партнера, якщо продавати за РРЦ.</div>
      <div class="kpis">
        ${kpi('Замовлення клієнтів', nf0.format(s.cnt), `${delta(s.cnt, sp.cnt)} <span class="muted">${nf1.format(s.perDay)} на день</span>`)}
        ${kpi('Продано товарів', `${nf0.format(s.units)} <small>шт</small>`, delta(s.units, sp.units))}
        ${kpi('Сума за цінами партнера', uah(s.sum), `${delta(s.sum, sp.sum)} <span class="muted">середнє ${uah(s.avg)}</span>`)}
        ${kpi('Заробіток (за РРЦ)', uah(s.earn), `${delta(s.earn, sp.earn)} <span class="muted">роздріб ${uah(s.rrp)}</span>`)}
        ${kpi('Закупівлі', uah(d.supplies.sum), `${delta(d.supplies.sum, d.suppliesPrev.sum)} <span class="muted">${d.supplies.cnt} шт · оплачено ${uah(d.supplies.paid)}</span>`)}
        ${kpi('До оплати', uah(d.debt.due), `<span class="muted">${d.debt.dueCnt} рах.${d.debt.wait ? ` · ще без рахунку ${uah(d.debt.wait)}` : ''}</span>`)}
        ${kpi('Залишок із закупівель', `${nf0.format(d.stock.units)} <small>шт</small>`, `<span class="muted">на ${uah(d.stock.sum)} (ще не розписано на клієнтів)</span>`)}
        ${kpi('Без закупівлі / не оплачено', `${d.noSupply} <small>/ ${d.unpaidClients}</small>`, '<span class="muted">замовлень клієнтів за період</span>')}
      </div>
      <div class="card form-stack">
        <div class="head-row" style="margin:0"><h3 style="margin:0">По днях</h3><div class="btn-row">
          ${[['sum', 'Сума продажів'], ['cnt', 'Кількість замовлень'], ['supply', 'Закупівлі']].map(([k, v]) => `<button class="chip ${state.metric === k ? 'on' : ''}" data-met="${k}">${v}</button>`).join('')}</div></div>
        <div id="stChart">${dayChart(d.series, state.metric)}</div>
      </div>
      <div class="form-page" style="margin-top:12px">
        <div class="form-stack">
          <div class="card form-stack">
            <div class="head-row" style="margin:0"><h3 style="margin:0">Товари</h3><div class="btn-row">
              ${[['units', 'Кількість'], ['sum', 'Сума'], ['earn', 'Заробіток'], ['marginPct', 'Націнка %']].map(([k, v]) => `<button class="chip ${state.sort === k ? 'on' : ''}" data-sort="${k}">${v}</button>`).join('')}</div></div>
            <div id="stProducts">${shareTable(d.products, { title: 'Товар', sortKey: state.sort, limit: 20 })}</div>
          </div>
          <div class="card form-stack"><h3>Категорії</h3>${shareTable(d.categories, { title: 'Категорія', sortKey: 'sum' })}</div>
        </div>
        <div class="form-stack">
          <div class="card form-stack"><h3>Бренди</h3>${shareTable(d.brands, { title: 'Бренд', sortKey: 'sum', extra: false })}</div>
          <div class="card form-stack"><h3>Дні тижня</h3>
            ${(() => { const m = Math.max(1, ...d.weekdays); return d.weekdays.map((n, i) => `<div style="display:flex;align-items:center;gap:8px" class="small"><span style="width:22px">${WD[i]}</span>
              <div style="flex:1;height:10px;background:var(--accent-soft);border-radius:3px"><div style="height:10px;width:${Math.round((n / m) * 100)}%;background:var(--accent);border-radius:3px"></div></div><b style="width:28px;text-align:right">${n}</b></div>`).join(''); })()}
          </div>
          <div class="card form-stack"><h3>Статуси в CRM</h3>
            ${d.crm.length ? d.crm.map((r) => `<div class="small" style="display:flex;justify-content:space-between"><span>${esc(r.status)}</span><b>${r.n}</b></div>`).join('') : '<div class="small muted">Немає замовлень за період.</div>'}
          </div>
          ${d.partners ? `<div class="card form-stack"><h3>Партнери</h3>${d.partners.length ? `<table class="list"><thead><tr><th>Партнер</th><th class="r">Замовл.</th><th class="r">Продажі</th><th class="r">Закупівлі</th></tr></thead><tbody>
            ${d.partners.map((p) => `<tr class="click" data-sp="${p.id}"><td>${esc(p.name)}</td><td class="r">${p.cnt}</td><td class="r">${money(p.sum)}</td><td class="r">${money(p.supply)}</td></tr>`).join('')}</tbody></table>` : '<div class="small muted">Немає даних за період.</div>'}</div>` : ''}
        </div>
      </div>`;
    const again = () => view({ url, admin, title });
    $$('[data-per]').forEach((b) => (b.onclick = () => { state.period = b.dataset.per; again(); }));
    const custom = () => { if ($('#stFrom').value && $('#stTo').value) { state.period = 'custom'; state.from = $('#stFrom').value; state.to = $('#stTo').value; again(); } };
    $('#stFrom').onchange = custom;
    $('#stTo').onchange = custom;
    $('#stPartner') && ($('#stPartner').onchange = (e) => { state.partner = e.target.value; again(); });
    $$('[data-sp]').forEach((tr) => (tr.onclick = () => { state.partner = tr.dataset.sp; again(); }));
    $$('[data-met]').forEach((b) => (b.onclick = () => { state.metric = b.dataset.met; $$('[data-met]').forEach((x) => x.classList.toggle('on', x === b)); $('#stChart').innerHTML = dayChart(d.series, state.metric); }));
    $$('[data-sort]').forEach((b) => (b.onclick = () => { state.sort = b.dataset.sort; $$('[data-sort]').forEach((x) => x.classList.toggle('on', x === b)); $('#stProducts').innerHTML = shareTable(d.products, { title: 'Товар', sortKey: state.sort, limit: 20 }); }));
  }
  return { view, state };
}
