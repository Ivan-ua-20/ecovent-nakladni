// Журнал змін цін: коли й на що змінилася РРЦ (з оновлень LP-CRM). Адмін — усі товари або обраний партнер
// (тоді ще й ціна партнера до/після і зміни його знижок); партнер — свої бренди і свої ціни.
import { esc, money } from '../invoice.js';
import { $, main, api } from '../core/ui.js';

const at = (iso) => new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pctTxt = (v) => `${String(Math.round(v * 100) / 100).replace('.', ',')}%`;
const arrow = (a, b) => (b > a ? '<span class="badge bad">▲</span>' : b < a ? '<span class="badge ok">▼</span>' : '');

export function createPriceLogPages() {
  const f = { from: '', to: '', partner: '', brand: '', q: '' };
  const pf = { from: '', to: '', brand: '', q: '' };

  function table(d, withPrice) {
    if (!d.rows.length) return '<div class="card empty"><div class="big">Змін цін за цей період немає</div>Змініть період чи фільтри.</div>';
    return `<div class="table-wrap"><table class="list"><thead><tr><th>Коли</th><th>Товар</th><th class="hide-m">Бренд</th><th class="r">РРЦ</th>${withPrice ? '<th class="r">Ціна партнера</th>' : ''}<th class="r">Зміна</th></tr></thead><tbody>
      ${d.rows.map((r) => (r.kind === 'margin'
    ? `<tr class="row-info"><td class="small nowrap">${esc(at(r.at))}</td><td colspan="${withPrice ? 3 : 2}"><b>Знижка на бренд «${esc(r.brand)}»</b>: ${r.old_margin == null ? 'бренд відкрито' : pctTxt(r.old_margin)} → ${r.new_margin == null ? 'бренд закрито' : `<b>${pctTxt(r.new_margin)}</b>`}</td><td class="hide-m"></td><td></td></tr>`
    : `<tr><td class="small nowrap">${esc(at(r.at))}</td>
          <td>${esc(r.name)}${r.article ? `<div class="small muted">${esc(r.article)}</div>` : ''}</td>
          <td class="small hide-m">${esc(r.brand)}</td>
          <td class="r nowrap">${money(r.old_rrp)} → <b>${money(r.new_rrp)}</b></td>
          ${withPrice ? `<td class="r nowrap">${r.new_price != null ? `${money(r.old_price)} → <b>${money(r.new_price)}</b>` : '<span class="muted">—</span>'}</td>` : ''}
          <td class="r nowrap">${r.pct != null ? `${arrow(r.old_rrp, r.new_rrp)} ${r.pct > 0 ? '+' : ''}${pctTxt(r.pct)}` : ''}</td></tr>`)).join('')}
      </tbody></table></div>${d.more ? '<div class="small muted" style="margin-top:6px">Показано перші 1000 змін — звузьте період або фільтри.</div>' : ''}`;
  }
  const filters = (st, d, partners) => `<div class="btn-row" style="margin-bottom:10px;flex-wrap:wrap;align-items:flex-end">
      ${partners ? `<select id="plP" aria-label="Партнер" style="max-width:240px"><option value="">Усі партнери (лише РРЦ)</option>${partners.map((p) => `<option value="${p.id}" ${String(st.partner) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
      <select id="plB" aria-label="Бренд" style="max-width:200px"><option value="">Усі бренди</option>${d.brands.map((b) => `<option value="${b.id}" ${String(st.brand) === String(b.id) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
      <label class="small muted">з <input type="date" id="plFrom" value="${esc(d.from)}"></label>
      <label class="small muted">по <input type="date" id="plTo" value="${esc(d.to)}"></label>
      <input id="plQ" type="search" placeholder="Товар або артикул" value="${esc(st.q)}" style="max-width:220px">
    </div>`;
  function wire(st, re) {
    const set = (k) => (e) => { st[k] = e.target.value; re(); };
    if ($('#plP')) $('#plP').onchange = set('partner');
    $('#plB').onchange = set('brand');
    $('#plFrom').onchange = set('from');
    $('#plTo').onchange = set('to');
    let t;
    $('#plQ').oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { st.q = e.target.value; await re(); const el = $('#plQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 350); };
  }
  const qs = (st) => new URLSearchParams(Object.entries(st).filter(([, v]) => v !== '')).toString();

  async function viewAdmin() {
    const [d, partners] = await Promise.all([api('GET', `/api/b2b/price-log?${qs(f)}`), api('GET', '/api/b2b/partners')]);
    main.innerHTML = `
      <div class="head-row"><h2>Журнал змін цін</h2></div>
      <div class="small muted" style="margin-bottom:10px">Зміни РРЦ з оновлень каталогу LP-CRM. Оберіть партнера — побачите його ціну до й після (за його знижкою на той момент) і зміни його знижок на бренди.</div>
      ${filters(f, d, partners.filter((p) => !p.deleted_at))}
      ${table(d, Boolean(f.partner))}`;
    wire(f, viewAdmin);
  }
  async function viewPartner() {
    const d = await api('GET', `/api/b2b/p/price-log?${qs(pf)}`);
    main.innerHTML = `
      <div class="head-row"><h2>Зміни цін</h2></div>
      <div class="small muted" style="margin-bottom:10px">Коли й на скільки змінилися ціни на товари ваших брендів: РРЦ і ваша ціна. Зміни вашої знижки на бренд — окремими рядками.</div>
      ${filters(pf, d, null)}
      ${table(d, true)}`;
    wire(pf, viewPartner);
  }
  return { viewAdmin, viewPartner };
}
