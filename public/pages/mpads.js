// Маркетплейси → «Реклама»: рекламні кампанії Розетки (етап 1 — перегляд). Сервер — src/modules/market/ads.js.
// Колонки Розетки (покази, кліки, витрати, замовлення з реклами, CPO, CPC) — за весь час кампанії, як у кабінеті;
// наші колонки — за обраний період: «З реклами» (замовлення з реклами за датами) і «Усі замовлення» товару в магазині.
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger } from '../core/ui.js';
import { rzWho, wireRzWho } from './rzme.js';

const STATUSES = [['active', 'Активні'], ['paused', 'Призупинені'], ['finished', 'Завершені']];
const ST_NAME = { active: ['ok', 'Активна'], paused: ['warn', 'Призупинена'], finished: ['', 'Завершена'], not_active: ['', 'Неактивна'] };
const nf = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });
const n0 = (v) => nf.format(Math.round(Number(v) || 0));
const n2 = (v) => nf.format(Number(v) || 0);
const uah = (v) => `${n2(v)} ₴`;
const ctr = (s) => (s.views ? `${nf.format(Math.round((s.clicks / s.views) * 10000) / 100)}%` : '—');
const kyivDay = (d = new Date()) => new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10);
const addDays = (day, k) => new Date(Date.parse(`${day}T12:00:00Z`) + k * 86400e3).toISOString().slice(0, 10);
const dd = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');

export function createMpAdsPage({ can = () => true } = {}) {
  const canEdit = () => can('market.edit');
  // Вікно з одним числом (бюджет / ставка) + хто змінює в Розетці. submit(value) — запит; помилка лишає вікно відкритим.
  async function askNumber(title, label, value, hint, submit) {
    const m = modal(title, `<form class="form-stack" id="adNumF"><label class="f"><span>${label}</span><input name="v" inputmode="decimal" value="${esc(String(value ?? ''))}" required></label>
        ${hint ? `<div class="small muted">${hint}</div>` : ''}<div id="adWho"></div></form>`,
    { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="adNumGo">Зберегти в Розетці</button>', focus: '[name=v]' });
    rzWho(st.account).then((h) => { const w = $('#adWho', m.el); if (w) { w.innerHTML = h; wireRzWho(m.el); } });
    const go = $('#adNumGo', m.el);
    const run = async (e) => {
      e?.preventDefault();
      const v = $('#adNumF', m.el).v.value.trim().replace(',', '.');
      if (!(Number(v) > 0)) return toast('Вкажіть число більше за 0.', true);
      go.disabled = true;
      try { await submit(Number(v)); m.close(); } catch (er) { toast(er.message, true); go.disabled = false; }
    };
    go.onclick = run;
    $('#adNumF', m.el).onsubmit = run;
  }
  const campStatus = async (k, status, after) => {
    const pause = status === 'paused';
    if (!(await confirmDanger(pause ? `Призупинити кампанію «${k.title}»?` : `Запустити кампанію «${k.title}»?`,
      pause ? 'Реклама всіх товарів кампанії зупиниться в Розетці, доки ви її не запустите.' : 'Реклама товарів кампанії знову показуватиметься в Розетці (у межах бюджету на день).', pause ? 'Призупинити' : 'Запустити'))) return;
    try { await api('POST', `/api/mp/ads/campaigns/${k.id}/status`, { account: st.account, status, title: k.title }); toast(pause ? 'Кампанію призупинено' : 'Кампанію запущено'); after(); }
    catch (er) { toast(er.message, true); }
  };
  const campBudget = (k, after) => askNumber(`Бюджет на день — «${k.title}»`, 'Бюджет на день, грн', k.budget,
    'Ставка жодного товару не може бути більшою за бюджет на день.', async (v) => {
      await api('POST', `/api/mp/ads/campaigns/${k.id}/budget`, { account: st.account, budget: v });
      toast(`Бюджет змінено: ${uah(v)} на день`); after();
    });
  const st = { account: '', status: 'active', from: addDays(kyivDay(), -6), to: kyivDay(), sort: '' };
  try { Object.assign(st, JSON.parse(localStorage.getItem('mpAds') || '{}')); } catch { /* */ }
  const save = () => { try { localStorage.setItem('mpAds', JSON.stringify({ account: st.account, status: st.status })); } catch { /* */ } };

  const presets = [['7', 'Тиждень'], ['30', '30 днів'], ['month', 'Цей місяць'], ['prev', 'Минулий місяць']];
  const setPreset = (k) => {
    const t = kyivDay();
    if (k === 'month') { st.from = `${t.slice(0, 7)}-01`; st.to = t; return; }
    if (k === 'prev') { const first = `${t.slice(0, 7)}-01`; st.to = addDays(first, -1); st.from = `${st.to.slice(0, 7)}-01`; return; }
    st.from = addDays(t, -(Number(k) - 1)); st.to = t;
  };

  async function shops() {
    const all = await api('GET', '/api/mp/shops').catch(() => []);
    return (all.find((m) => m.key === 'rozetka')?.shops || []).filter((s) => s.active !== 0 && s.active !== false);
  }

  const head = (list) => `<div class="head-row"><h2>Реклама Розетки</h2>
      <div class="btn-row" style="flex-wrap:wrap;align-items:center">
        <select id="adAcc" aria-label="Магазин">${list.map((s) => `<option value="${s.id}" ${String(s.id) === String(st.account) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <label class="small">з <input type="date" id="adFrom" value="${esc(st.from)}"></label>
        <label class="small">по <input type="date" id="adTo" value="${esc(st.to)}"></label>
        ${presets.map(([k, t]) => `<button class="chip" data-pr="${k}">${t}</button>`).join('')}
      </div></div>`;
  const wireHead = (reload) => {
    $('#adAcc').onchange = (e) => { st.account = e.target.value; save(); reload(); };
    $('#adFrom').onchange = (e) => { st.from = e.target.value; reload(); };
    $('#adTo').onchange = (e) => { st.to = e.target.value; reload(); };
    $$('[data-pr]').forEach((b) => (b.onclick = () => { setPreset(b.dataset.pr); reload(); }));
  };
  const qs = (extra = {}) => new URLSearchParams({ account: st.account, from: st.from, to: st.to, status: st.status, ...extra });
  const note = '<div class="small muted ad-note">Покази, кліки, витрати, «Замовлення» (з реклами), CPO і CPC — від Розетки <b>за весь час</b> кампанії, як у кабінеті. Колонки <b>«за період»</b> — за обрані дати: «з реклами» — замовлення, які Розетка зарахувала рекламі; «усі» — усі замовлення цих товарів у магазині (без скасованих).</div>';

  // ---------------------------------------------------------------- список кампаній
  async function viewList() {
    const list = await shops();
    if (!list.length) { main.innerHTML = '<div class="card empty">Немає доступних магазинів Розетки.</div>'; return; }
    if (!list.some((s) => String(s.id) === String(st.account))) st.account = String(list[0].id);
    main.innerHTML = `${head(list)}
      <nav class="f-chips" style="margin:6px 0 10px">${STATUSES.map(([k, t]) => `<button class="chip ${st.status === k ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</nav>
      <div id="adBody"><div class="card"><span class="spinner"></span> Завантажую кампанії з Розетки… (зазвичай 5–15 секунд)</div></div>`;
    wireHead(viewList);
    $$('[data-st]').forEach((b) => (b.onclick = () => { st.status = b.dataset.st; save(); viewList(); }));
    let d;
    try { d = await api('GET', `/api/mp/ads/campaigns?${qs()}`); } catch (e) { $('#adBody').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; return; }
    const rows = d.campaigns;
    const tot = rows.reduce((t, x) => ({ budget: t.budget + x.budget, money: t.money + x.stat.money, ad: t.ad + x.period.ad_orders }), { budget: 0, money: 0, ad: 0 });
    $('#adBody').innerHTML = `
      <div class="ad-kpi">
        <div class="mp-box"><div class="mp-cap">Рекламний баланс</div><b class="${d.balance < 0 ? 'bad-t' : ''}">${d.balance == null ? '—' : uah(d.balance)}</b></div>
        <div class="mp-box"><div class="mp-cap">Ліміт (реклама)</div><b>${d.limit == null ? '—' : uah(d.limit)}</b></div>
        <div class="mp-box"><div class="mp-cap">Кампаній · бюджет на день</div><b>${rows.length} · ${uah(tot.budget)}</b></div>
        <div class="mp-box"><div class="mp-cap">З реклами за ${dd(d.period.from)}–${dd(d.period.to)}</div><b>${n0(tot.ad)} замовл.</b></div>
      </div>
      ${d.adOrdersError ? `<div class="alert warn small">Замовлення з реклами за період не завантажились: ${esc(d.adOrdersError)}</div>` : ''}
      ${note}
      ${rows.length ? `<div class="table-wrap"><table class="list ad-table"><thead><tr>
          <th>Кампанія</th><th class="r">Товарів</th><th class="r">Бюджет / день</th><th class="r">Покази</th><th class="r">Кліки</th><th class="r">CTR</th>
          <th class="r">CPC</th><th class="r">Витрати</th><th class="r">Замовл.</th><th class="r">CPO</th>
          <th class="r ad-per">З реклами<br><span class="small">за період</span></th><th class="r ad-per">Усі замовл.<br><span class="small">за період</span></th><th>Статус</th>${canEdit() ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows.map((x) => `<tr class="click" data-c="${x.id}">
          <td><b>${esc(x.title)}</b><div class="small muted">${dd(x.start)} – ${dd(x.end)}</div></td>
          <td class="r">${x.items}</td>
          <td class="r nowrap">${uah(x.budget)}${x.left_today != null ? `<div class="small ${x.left_today <= 0 ? 'bad-t' : 'muted'}">залишок ${uah(x.left_today)}</div>` : ''}</td>
          <td class="r">${n0(x.stat.views)}</td><td class="r">${n0(x.stat.clicks)}</td><td class="r">${ctr(x.stat)}</td>
          <td class="r">${n2(x.stat.cpc)}</td><td class="r nowrap">${uah(x.stat.money)}</td><td class="r">${x.stat.orders}</td><td class="r">${x.stat.orders ? n2(x.stat.cpo) : '—'}</td>
          <td class="r ad-per"><b>${x.period.ad_orders}</b>${x.period.ad_sum ? `<div class="small muted">${uah(x.period.ad_sum)}</div>` : ''}</td>
          <td class="r ad-per" data-all="${x.id}"><span class="spinner"></span></td>
          <td>${(([cls, t]) => `<span class="badge ${cls}">${t}</span>`)(ST_NAME[x.status] || ['', x.status])}</td>
          ${canEdit() ? `<td class="nowrap">${x.editable && x.status !== 'finished' ? `<button class="btn sm" data-bud="${x.id}" title="Змінити бюджет на день">✎ Бюджет</button>
            <button class="btn sm" data-cst="${x.id}" data-to="${x.status === 'active' ? 'paused' : 'active'}">${x.status === 'active' ? '⏸ Пауза' : '▶ Запустити'}</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
        : '<div class="card empty">Кампаній у цьому статусі немає.</div>'}`;
    const byId = new Map(rows.map((x) => [String(x.id), x]));
    $$('[data-bud]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); campBudget(byId.get(b.dataset.bud), viewList); }));
    $$('[data-cst]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); campStatus(byId.get(b.dataset.cst), b.dataset.to, viewList); }));
    $$('[data-c]').forEach((tr) => (tr.onclick = () => { location.hash = `#/mpads/${tr.dataset.c}`; }));
    // «Усі замовлення за період» — частинами (товари кампаній із Розетки + наші замовлення)
    const ids = rows.map((x) => x.id);
    for (let i = 0; i < ids.length; i += 6) {
      const part = ids.slice(i, i + 6);
      try {
        const r = await api('GET', `/api/mp/ads/campaign-orders?${qs({ ids: part.join(',') })}`);
        for (const id of part) {
          const el = $(`[data-all="${id}"]`);
          if (!el) return; // сторінку вже змінили
          const v = r.campaigns[id];
          el.innerHTML = v ? `<b>${v.orders}</b>${v.sum ? `<div class="small muted">${uah(v.sum)}</div>` : ''}` : '<span class="muted">—</span>';
        }
      } catch (e) { part.forEach((id) => { const el = $(`[data-all="${id}"]`); if (el) el.innerHTML = '<span class="muted" title="' + esc(e.message) + '">—</span>'; }); }
    }
  }

  // ---------------------------------------------------------------- кампанія: товари
  async function viewCampaign(id) {
    const list = await shops();
    if (!list.some((s) => String(s.id) === String(st.account)) && list[0]) st.account = String(list[0].id);
    main.innerHTML = `${head(list)}<div id="adBody"><div class="card"><span class="spinner"></span> Завантажую товари кампанії…</div></div>`;
    wireHead(() => viewCampaign(id));
    let d;
    try { d = await api('GET', `/api/mp/ads/campaigns/${id}?${qs()}`); } catch (e) { $('#adBody').innerHTML = `<div class="alert bad">${esc(e.message)}</div><a class="btn" href="#/mpads">← До кампаній</a>`; return; }
    const k = d.campaign;
    const sorters = { orders: (x) => x.period.orders, ad: (x) => x.period.ad_orders, money: (x) => x.stat.money, clicks: (x) => x.stat.clicks, rate: (x) => x.rate };
    const items = st.sort && sorters[st.sort] ? [...d.items].sort((a, b) => sorters[st.sort](b) - sorters[st.sort](a)) : d.items;
    const th = (key, label, cls = 'r') => `<th class="${cls}"><button class="linkbtn" data-sort="${key}">${label}${st.sort === key ? ' ↓' : ''}</button></th>`;
    $('#adBody').innerHTML = `
      <div class="head-row" style="margin-top:4px"><h3 style="margin:0">${esc(k.title)} ${(([cls, t]) => `<span class="badge ${cls}">${t}</span>`)(ST_NAME[k.status] || ['', k.status])}</h3>
        <div class="btn-row">${canEdit() && k.status !== 'finished' ? `<button class="btn" id="adBud">✎ Бюджет</button><button class="btn" id="adCst">${k.status === 'active' ? '⏸ Призупинити' : '▶ Запустити'}</button>` : ''}<a class="btn" href="#/mpads">← До кампаній</a></div></div>
      <div class="ad-kpi">
        <div class="mp-box"><div class="mp-cap">Бюджет на день</div><b>${uah(k.budget)}</b>${k.left_today != null ? `<div class="small muted">залишок сьогодні ${uah(k.left_today)}</div>` : ''}</div>
        <div class="mp-box"><div class="mp-cap">Покази · кліки · CTR</div><b>${n0(k.stat.views)} · ${n0(k.stat.clicks)} · ${ctr(k.stat)}</b></div>
        <div class="mp-box"><div class="mp-cap">Витрати · CPC</div><b>${uah(k.stat.money)} · ${n2(k.stat.cpc)}</b></div>
        <div class="mp-box"><div class="mp-cap">Замовлення · CPO</div><b>${k.stat.orders} · ${k.stat.orders ? n2(k.stat.cpo) : '—'}</b></div>
      </div>
      ${d.adOrdersError ? `<div class="alert warn small">Замовлення з реклами за період не завантажились: ${esc(d.adOrdersError)}</div>` : ''}
      ${note}
      <div class="table-wrap"><table class="list ad-table"><thead><tr>
        <th>Товар</th><th class="r">Ціна</th>${th('rate', 'Ставка')}<th>Статус</th><th class="r">Покази</th>${th('clicks', 'Кліки')}<th class="r">CTR</th><th class="r">CPC</th>
        ${th('money', 'Витрати')}<th class="r">Замовл.</th><th class="r">CPO</th>${th('ad', 'З реклами<br><span class="small">за період</span>', 'r ad-per')}${th('orders', 'Усі замовл.<br><span class="small">за період</span>', 'r ad-per')}</tr></thead>
      <tbody>${items.map((x) => `<tr>
        <td><div class="ad-item">${x.photo ? `<img src="${esc(x.photo)}" alt="" loading="lazy">` : ''}<div><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>
          <div class="small muted">${esc(x.article)}${x.category ? ` · ${esc(x.category)}` : ''}${x.stock != null ? ` · залишок ${x.stock}` : ''}</div></div></div></td>
        <td class="r nowrap">${uah(x.price)}${x.price_old > x.price ? `<div class="small muted"><s>${uah(x.price_old)}</s></div>` : ''}</td>
        <td class="r nowrap"><b>${n2(x.rate)}</b><div class="small muted">мін. ${n2(x.rate_min)}</div>${canEdit() && x.editable && x.status !== 'finished' ? `<button class="btn sm" data-rate="${x.id}">✎ Ставка</button>` : ''}</td>
        <td>${(([cls, t]) => `<span class="badge ${cls}">${t}</span>`)(ST_NAME[x.status] || ['', x.status])}${canEdit() && x.editable && ['active', 'paused'].includes(x.status) ? `<div><button class="btn sm" data-ist="${x.id}" data-to="${x.status === 'active' ? 'paused' : 'active'}">${x.status === 'active' ? '⏸ Пауза' : '▶ Запустити'}</button></div>` : ''}</td>
        <td class="r">${n0(x.stat.views)}</td><td class="r">${n0(x.stat.clicks)}</td><td class="r">${ctr(x.stat)}</td><td class="r">${n2(x.stat.cpc)}</td>
        <td class="r nowrap">${uah(x.stat.money)}</td><td class="r">${x.stat.orders}</td><td class="r">${x.stat.orders ? n2(x.stat.cpo) : '—'}</td>
        <td class="r ad-per"><b>${x.period.ad_orders}</b>${x.period.ad_sum ? `<div class="small muted">${uah(x.period.ad_sum)}</div>` : ''}</td>
        <td class="r ad-per"><b>${x.period.orders}</b>${x.period.qty > x.period.orders ? `<div class="small muted">${n0(x.period.qty)} шт</div>` : ''}${x.period.sum ? `<div class="small muted">${uah(x.period.sum)}</div>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;
    $$('[data-sort]').forEach((b) => (b.onclick = () => { st.sort = st.sort === b.dataset.sort ? '' : b.dataset.sort; viewCampaign(id); }));
    const again = () => viewCampaign(id);
    if ($('#adBud')) $('#adBud').onclick = () => campBudget(k, again);
    if ($('#adCst')) $('#adCst').onclick = () => campStatus(k, k.status === 'active' ? 'paused' : 'active', again);
    const byAd = new Map(d.items.map((x) => [String(x.id), x]));
    $$('[data-rate]').forEach((b) => (b.onclick = () => {
      const x = byAd.get(b.dataset.rate);
      askNumber('Ставка за клік', `Ставка, грн (від ${n2(x.rate_min)} до ${n2(k.budget)})`, x.rate, esc(x.name), async (v) => {
        await api('POST', `/api/mp/ads/items/${x.id}`, { account: st.account, campaign: k.id, rate: v });
        toast(`Ставку змінено: ${n2(v)} грн`); again();
      });
    }));
    $$('[data-ist]').forEach((b) => (b.onclick = async () => {
      const x = byAd.get(b.dataset.ist);
      const pause = b.dataset.to === 'paused';
      if (!(await confirmDanger(pause ? 'Призупинити рекламу товару?' : 'Запустити рекламу товару?', esc(x.name), pause ? 'Призупинити' : 'Запустити'))) return;
      try { await api('POST', `/api/mp/ads/items/${x.id}`, { account: st.account, campaign: k.id, status: b.dataset.to }); toast(pause ? 'Рекламу товару призупинено' : 'Рекламу товару запущено'); again(); }
      catch (er) { toast(er.message, true); }
    }));
  }

  return { viewMpAds: (id) => (id ? viewCampaign(id) : viewList()).catch((e) => toast(e.message, true)) };
}
