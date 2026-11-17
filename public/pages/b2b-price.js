// B2B: Excel-прайси для партнерів з адмінки.
// • «Каталог і ціни» → «⬇ Excel прайс»: обрати бренди, на кожен — відсоток знижки від РРЦ, завантажити книгу (аркуш на бренд);
// • «Партнери» → колонка «Excel прайс»: прайс конкретного партнера — його бренди, маржа, особливі ціни (як у його кабінеті).
import { esc } from '../invoice.js';
import { $, $$, api, toast, modal } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const priceOf = (rrp, pct) => r2((Number(rrp) || 0) * (1 - (Number(pct) || 0) / 100));
const pctOf = (rrp, price) => (rrp ? r2(((rrp - price) / rrp) * 100) : 0);
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_');
const today = () => new Date().toLocaleDateString('uk-UA');
// 1 бренд · 2 бренди · 5 брендів
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many}`;
const sumTxt = (b, p) => `${plural(b, 'бренд', 'бренди', 'брендів')} · ${plural(p, 'товар', 'товари', 'товарів')}`;
const doneTxt = (p, s) => `Завантажено: ${plural(p, 'товар', 'товари', 'товарів')}, ${plural(s, 'аркуш', 'аркуші', 'аркушів')}`;

// Книга: аркуш на кожен бренд, усередині — за категорією й назвою.
function book(products, { priceCols, extra = () => [] }) {
  const by = new Map();
  for (const p of products) { if (!by.has(p.brand)) by.set(p.brand, []); by.get(p.brand).push(p); }
  const cols = [{ title: 'Товар', width: 60 }, { title: 'Артикул', width: 18 }, { title: 'Категорія', width: 28 }, { title: 'РРЦ, грн', width: 13, fmt: 'money' }, ...priceCols];
  return [...by].sort(([a], [b]) => a.localeCompare(b, 'uk')).map(([name, list]) => ({
    name, cols,
    rows: [...list].sort((a, b) => a.category.localeCompare(b.category, 'uk') || a.name.localeCompare(b.name, 'uk'))
      .map((p) => [p.name, p.article || '', p.category, Number(p.rrp), ...extra(p)]),
  }));
}

// ---------- прайс з каталогу: бренди й відсотки вручну ----------
// Дві знижки від РРЦ на кожен бренд — як у картці партнера: «Дропшипінг» (маржа клієнтам — відправка клієнтам партнера)
// і «B2B» (закупівля на склад партнера). Порожня — цієї ціни для бренду в прайсі немає (клітинки порожні).
const KINDS = [['ds', 'Дропшипінг', 'маржа клієнтам'], ['b2b', 'B2B', 'на склад партнера']];
export async function catalogPriceModal() {
  let d;
  try { d = await api('GET', '/api/b2b/price-list'); } catch (er) { toast(er.message, true); return; }
  if (!d.brands.length) { toast('У каталозі немає товарів з РРЦ — спершу оновіть каталог з LP-CRM.', true); return; }
  const def = { ds: d.defaults?.margin ?? '', b2b: d.defaults?.margin_wh ?? '' };
  const m = modal('Excel прайс з каталогу', `<form id="plF" class="form-stack">
      <div class="small muted">Оберіть бренди й знижку від РРЦ: <b>Дропшипінг</b> (маржа клієнтам — відправка клієнтам партнера) і <b>B2B</b> (закупівля на склад партнера).
        Можна вписати обидві або одну. У книзі — аркуш на бренд: товар, артикул, категорія, РРЦ і ціни зі знижками.</div>
      <div class="btn-row" style="align-items:end;flex-wrap:wrap">
        ${KINDS.map(([k, t]) => `<label class="f" style="width:150px"><span>${t} для всіх, %</span><input type="number" id="plAll_${k}" min="0" max="99" step="0.5" value="${esc(def[k])}" placeholder="напр. ${k === 'ds' ? 20 : 25}"></label>`).join('')}
        <button type="button" class="btn" id="plApply">Застосувати до вибраних</button>
        <label class="check" style="margin-left:auto"><input type="checkbox" id="plTog" checked> Усі бренди</label>
      </div>
      <div class="pl-list">
        <div class="pl-row pl-head"><span class="pl-name">Бренд</span>${KINDS.map(([, t, h]) => `<span class="pl-pct" title="${esc(h)}">${t}<span class="small muted">${h}, %</span></span>`).join('')}</div>
        ${d.brands.map((b) => `<div class="pl-row"><label class="check pl-name"><input type="checkbox" data-b="${b.id}" checked> <b>${esc(b.name)}</b> <span class="small muted">${b.n} тов.</span></label>
          ${KINDS.map(([k, t]) => `<label class="pl-pct"><input type="number" data-pct="${k}:${b.id}" min="0" max="99" step="0.5" value="${esc(def[k])}" aria-label="${t}: знижка ${esc(b.name)}, %"> %</label>`).join('')}</div>`).join('')}</div>
      <label class="f"><span>Для кого (у назві файлу, необов'язково)</span><input id="plFor" placeholder="напр. ТОВ «Кліматика»"></label>
      <label class="check"><input type="checkbox" id="plRrp" checked> Показувати РРЦ і знижку у %</label>
    </form>`, { wide: true, footer: '<span class="small muted" id="plSum" style="margin-right:auto"></span><button class="btn" data-close>Скасувати</button><button class="btn primary" id="plGo">⬇ Завантажити</button>' });
  const el = m.el;
  const picked = () => $$('[data-b]', el).filter((x) => x.checked).map((x) => Number(x.dataset.b));
  const sum = () => {
    const ids = picked();
    $('#plSum', el).textContent = sumTxt(ids.length, d.brands.filter((b) => ids.includes(b.id)).reduce((t, b) => t + b.n, 0));
    $('#plTog', el).checked = ids.length === d.brands.length;
  };
  $$('[data-b]', el).forEach((x) => (x.onchange = sum));
  $('#plTog', el).onchange = (e) => { $$('[data-b]', el).forEach((x) => { x.checked = e.target.checked; }); sum(); };
  $('#plApply', el).onclick = () => {
    for (const [k] of KINDS) { const v = $(`#plAll_${k}`, el).value; picked().forEach((id) => { $(`[data-pct="${k}:${id}"]`, el).value = v; }); }
  };
  sum();
  $('#plGo', el).onclick = async (e) => {
    const ids = picked();
    if (!ids.length) { toast('Оберіть хоча б один бренд', true); return; }
    // знижка: число 0–99 або null (порожньо — цієї ціни для бренду немає)
    const pct = {};
    for (const [k, t] of KINDS) {
      pct[k] = new Map();
      for (const id of ids) {
        const inp = $(`[data-pct="${k}:${id}"]`, el);
        const v = inp.value.trim() === '' ? null : Number(inp.value);
        if (v != null && !(v >= 0 && v < 100)) { toast(`${t}: знижка від 0 до 99 % для «${d.brands.find((b) => b.id === id)?.name}»`, true); inp.focus(); return; }
        pct[k].set(id, v);
      }
    }
    const empty = ids.find((id) => pct.ds.get(id) == null && pct.b2b.get(id) == null);
    if (empty != null) { toast(`«${d.brands.find((b) => b.id === empty)?.name}»: вкажіть знижку для дропшипінгу або B2B (або зніміть бренд)`, true); $(`[data-pct="ds:${empty}"]`, el).focus(); return; }
    const used = KINDS.filter(([k]) => ids.some((id) => pct[k].get(id) != null));
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const r = await api('GET', `/api/b2b/price-list?brands=${ids.join(',')}`);
      const rrp = $('#plRrp', el).checked;
      let sheets = book(r.products, {
        priceCols: used.flatMap(([, t, h]) => [{ title: `${t} (${h}), грн`, width: 16, fmt: 'money' }, ...(rrp ? [{ title: `${t}: знижка від РРЦ`, width: 14, fmt: 'pct' }] : [])]),
        extra: (p) => used.flatMap(([k]) => {
          const v = pct[k].get(p.brand_id);
          if (v == null) return rrp ? ['', ''] : [''];
          const price = priceOf(p.rrp, v);
          return [price, ...(rrp ? [pctOf(p.rrp, price)] : [])];
        }),
      });
      if (!rrp) sheets = sheets.map((sh) => ({ ...sh, cols: sh.cols.filter((c) => c.title !== 'РРЦ, грн'), rows: sh.rows.map((row) => row.filter((_, i) => i !== 3)) }));
      const who = $('#plFor', el).value.trim();
      downloadXlsx(safeName(`Прайс Ековент${who ? ` — ${who}` : ''} ${today()}.xlsx`), sheets);
      m.close();
      toast(doneTxt(r.products.length, sheets.length));
    } catch (er) { toast(er.message, true); b.disabled = false; }
  };
}

// ---------- прайс партнера: його бренди й маржа ----------
export async function partnerPriceModal(id) {
  let d;
  try { d = await api('GET', `/api/b2b/partners/${id}/price-list`); } catch (er) { toast(er.message, true); return; }
  if (!d.brands.length) { toast(`«${d.partner.name}»: брендів не відкрито — прайсу немає. Увімкніть бренди в картці партнера.`, true); return; }
  const hasWh = d.products.some((p) => p.price_wh !== p.price);
  const m = modal(`Excel прайс — ${d.partner.name}`, `<div class="form-stack">
      <div class="small muted">Ціни — як партнер бачить у своєму каталозі (маржа бренду, особливі ціни на товари). Аркуш на кожен бренд.</div>
      <table class="list"><thead><tr><th><input type="checkbox" id="ppAll" checked aria-label="Усі бренди"></th><th>Бренд</th><th class="r">Маржа (знижка від РРЦ)</th>${hasWh ? '<th class="r">На склад партнера</th>' : ''}<th class="r">Товарів</th></tr></thead><tbody>
        ${d.brands.map((b) => `<tr><td><input type="checkbox" data-pb="${b.id}" checked aria-label="${esc(b.name)}"></td><td><b>${esc(b.name)}</b></td>
          <td class="r">${b.margin != null ? `${b.margin} %` : '—'}${b.special ? `<div class="small muted">особливі ціни: ${b.special} тов.</div>` : ''}</td>
          ${hasWh ? `<td class="r">${b.margin_wh != null ? `${b.margin_wh} %` : '<span class="muted">як для клієнтів</span>'}</td>` : ''}<td class="r">${b.n}</td></tr>`).join('')}
      </tbody></table></div>`, { wide: true, footer: '<span class="small muted" id="ppSum" style="margin-right:auto"></span><button class="btn" data-close>Скасувати</button><button class="btn primary" id="ppGo">⬇ Завантажити</button>' });
  const el = m.el;
  const picked = () => $$('[data-pb]', el).filter((x) => x.checked).map((x) => Number(x.dataset.pb));
  const sum = () => { const ids = picked(); $('#ppSum', el).textContent = sumTxt(ids.length, d.products.filter((p) => ids.includes(p.brand_id)).length); $('#ppAll', el).checked = ids.length === d.brands.length; };
  $$('[data-pb]', el).forEach((x) => (x.onchange = sum));
  $('#ppAll', el).onchange = (e) => { $$('[data-pb]', el).forEach((x) => { x.checked = e.target.checked; }); sum(); };
  sum();
  $('#ppGo', el).onclick = () => {
    const ids = picked();
    if (!ids.length) { toast('Оберіть хоча б один бренд', true); return; }
    const list = d.products.filter((p) => ids.includes(p.brand_id));
    const sheets = book(list, {
      priceCols: [{ title: hasWh ? 'Ціна з відправкою клієнтам, грн' : 'Ціна партнера, грн', width: 15, fmt: 'money' }, { title: 'Знижка від РРЦ', width: 14, fmt: 'pct' },
        ...(hasWh ? [{ title: 'Закупівля на склад, грн', width: 16, fmt: 'money' }] : [])],
      extra: (p) => [Number(p.price), pctOf(p.rrp, p.price), ...(hasWh ? [Number(p.price_wh)] : [])],
    });
    downloadXlsx(safeName(`Прайс ${d.partner.name} ${today()}.xlsx`), sheets);
    m.close();
    toast(doneTxt(list.length, sheets.length));
  };
}
