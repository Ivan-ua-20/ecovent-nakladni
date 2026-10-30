// Маркетплейси: замовлення магазинів Розетки (кабінет продавця), Prom і Епіцентру — вкладка на маркетплейс,
// підвкладки — магазини (назви як у «Налаштування → Доставка»; адміни можуть перейменувати). Лише перегляд.
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, modal, fmtDateTime } from '../core/ui.js';

const uah = (n) => `${Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₴`;
const dt = (s) => String(s || '').slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1');

export function createMarketPages({ can }) {
  const state = { status: '', q: '' };
  let lastMp = '';

  async function viewMarket(mp, account = '') {
    if (mp !== lastMp) { state.status = ''; state.q = ''; lastMp = mp; }
    const all = await api('GET', '/api/mp/shops');
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
    main.innerHTML = `
      <div class="head-row"><h2>${esc(m.title)}${acc ? ` · ${esc(acc.name)}` : ''}</h2>
        <div class="btn-row">${acc && can('api') ? '<button class="btn sm" id="mpRename">Перейменувати</button>' : ''}${acc ? `<button class="btn sm" id="mpSync" ${acc.active ? '' : 'disabled'}>Оновити зараз</button>` : ''}</div></div>
      <div class="f-chips" style="margin-bottom:10px">
        <a class="chip ${acc ? '' : 'on'}" href="#/${route}">Усі магазини · ${total}</a>
        ${shops.map((s) => `<a class="chip ${acc?.id === s.id ? 'on' : ''}" href="#/${route}/${s.id}" title="${esc(syncInfo(s))}">${esc(s.name)} · ${s.orders}${s.error ? ' ⚠️' : ''}</a>`).join('')}
      </div>
      ${(acc ? [acc] : shops).filter((s) => s.error).map((s) => `<div class="alert warn small" style="margin-bottom:10px">⚠️ «${esc(s.name)}»: не вдалося оновити${s.error_at ? ` (${esc(fmtDateTime(s.error_at))})` : ''} — ${esc(s.error)}</div>`).join('')}
      <div class="small muted" style="margin-bottom:10px">${acc ? syncInfo(acc) : 'Замовлення за останні 45 днів оновлюються самі кожні кілька хвилин.'}</div>
      <div id="mpStatuses" class="f-chips" style="margin-bottom:10px"></div>
      <div class="btn-row" style="margin-bottom:10px"><label class="sr-only" for="mpQ">Пошук</label><input id="mpQ" type="search" placeholder="№ замовлення, клієнт, телефон або ТТН" value="${esc(state.q)}" style="max-width:360px"></div>
      <div id="mpList"><div class="card empty"><span class="spinner"></span> Завантажую…</div></div>`;

    const name = new Map(shops.map((s) => [s.id, s.name]));
    const load = async () => {
      const qs = new URLSearchParams({ mp, ...(acc ? { account: acc.id } : {}), ...(state.status ? { status: state.status } : {}), ...(state.q ? { q: state.q } : {}) });
      const d = await api('GET', `/api/mp/orders?${qs}`);
      const sum = d.statuses.reduce((a, s) => a + s.n, 0);
      $('#mpStatuses').innerHTML = `<button class="chip ${state.status ? '' : 'on'}" data-st="">Усі · ${sum}</button>${d.statuses.map((s) => `<button class="chip ${state.status === s.status ? 'on' : ''}" data-st="${esc(s.status)}">${esc(s.status_name || s.status || '—')} · ${s.n}</button>`).join('')}`;
      $$('[data-st]').forEach((b) => (b.onclick = () => { state.status = b.dataset.st; load(); }));
      $('#mpList').innerHTML = d.rows.length ? `<table class="list"><thead><tr><th>Замовлення</th>${acc ? '' : '<th>Магазин</th>'}<th>Клієнт</th><th>Товари</th><th class="r">Сума</th><th>Доставка</th><th>Статус</th></tr></thead><tbody>
        ${d.rows.map((o) => `<tr>
          <td><b>${esc(o.number)}</b><div class="small muted">${esc(dt(o.created_at))}</div></td>
          ${acc ? '' : `<td class="small">${esc(name.get(o.account_id) || '')}</td>`}
          <td>${esc(o.customer || '—')}<div class="small muted">${esc(o.phone || '')}</div></td>
          <td class="small">${o.items.length ? `${esc(o.items[0].name)}${o.items[0].qty > 1 ? ` × ${o.items[0].qty}` : ''}${o.items.length > 1 ? ` <span class="muted">+${o.items.length - 1}</span>` : ''}` : '—'}</td>
          <td class="r"><b>${uah(o.total)}</b></td>
          <td class="small">${esc(o.delivery || '—')}${o.ttn ? `<div class="muted">ТТН ${esc(o.ttn)}</div>` : ''}</td>
          <td><span class="badge">${esc(o.status_name || o.status || '—')}</span></td>
        </tr>`).join('')}</tbody></table>${d.rows.length >= 300 ? '<div class="small muted" style="margin-top:6px">Показано 300 найновіших — уточніть пошук або статус.</div>' : ''}`
        : `<div class="card empty">${state.q || state.status ? 'Нічого не знайдено.' : 'Замовлень ще немає — вони з\'являться після першого оновлення (кілька хвилин).'}</div>`;
    };
    let t = 0;
    $('#mpQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 300); };
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
    await load();
  }
  return { viewMarket };
}
