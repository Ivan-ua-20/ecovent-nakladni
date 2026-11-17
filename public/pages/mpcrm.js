// Маркетплейси → LP-CRM: вікна перед передачею замовлення й розділ «Маркетплейси → Налаштування».
// • «Підтвердіть товари для LP-CRM» — коли товар маркетплейсу передається вперше (окремо для кожного магазину):
//   який товар LP-CRM (або кілька — комплект, подарунок) підставити; далі склад підставляється сам, без вікна;
// • «Перевірте, що піде в LP-CRM» — усі дані замовлення перед створенням (вмикається в налаштуваннях);
// • налаштування: вікна, довідник товарів (прив'язки), ранкове нагадування, LP-CRM магазинів.
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, modal, fmtDateTime } from '../core/ui.js';

const uah = (n) => `${Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₴`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FROM = { confirmed: ['ok', 'підтверджено'], saved: ['ok', 'як минулого разу'], copied: ['ok', 'як у дубля в цьому магазині'], code: ['ok', 'підібрано за кодом'], sku: ['ok', 'підібрано за артикулом'] };
const intlPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); if (!d) return ''; if (d.length === 10 && d.startsWith('0')) return `+38${d}`; if (d.length === 9) return `+380${d}`; return `+${d}`; };

// Склад на 1 шт → рядки LP-CRM (як на сервері): основний отримує решту ціни.
export function partsToLines(parts, qty, price) {
  const q = Math.max(1, Number(qty) || 1);
  const [head, ...extra] = parts;
  if (!head) return [];
  const rest = extra.reduce((a, p) => a + (Number(p.price) || 0) * (Number(p.qty) || 1), 0);
  return [{ product_id: head.product_id, name: head.name, count: r2((Number(head.qty) || 1) * q), price: r2((Number(price) - rest) / (Number(head.qty) || 1)) },
    ...extra.map((p) => ({ product_id: p.product_id, name: p.name, count: r2((Number(p.qty) || 1) * q), price: r2(p.price) }))];
}
const linesOf = (goods) => goods.flatMap((g) => partsToLines(g.parts, g.qty, g.price).map((l) => ({ ...l, item_id: g.item_id })));

// Вікно, що повертає результат: resolve(null), якщо закрили (✕, Esc, «Скасувати»).
function asyncModal(title, html, opts, bind) {
  return new Promise((resolve) => {
    const md = modal(title, html, opts);
    let done = false;
    const finish = (v) => { if (done) return; done = true; obs.disconnect(); md.close(); resolve(v); };
    const obs = new MutationObserver(() => { if (!document.contains(md.el)) { obs.disconnect(); if (!done) { done = true; resolve(null); } } });
    obs.observe(document.body, { childList: true, subtree: true });
    bind(md.el, finish);
  });
}

// ---------- «Підтвердіть товари для LP-CRM» ----------
// goods — [{ item_id, name, article, offer, photo, qty, price (null — невідома), confirmed, from, parts: [{ product_id, name, qty, price, list_price }] }].
// Повертає goods з новим складом (і зберігає його для магазину) або null.
export function confirmGoods({ account, number, shop, goods, first = true }) {
  const st = goods.map((g) => ({ ...g, parts: g.parts.map((p, i) => ({ ...p, price: i ? Number(p.price) || 0 : null })) }));
  const head = number ? `Замовлення Розетки № ${esc(number)}${shop ? ` · ${esc(shop)}` : ''}. ` : shop ? `${esc(shop)}. ` : '';
  const pair = (g, i) => `<div class="mpc-pair" data-i="${i}">
      <div class="mpc-side">
        <p class="mpc-cap">На Розетці</p>
        <div class="mpc-mp">${g.photo ? `<img src="${esc(g.photo)}" alt="" loading="lazy">` : '<span class="mpc-ph"></span>'}<div>
          <div class="mpc-name">${esc(g.name || '—')}</div>
          <div class="small muted">код ${esc(g.item_id)}${g.article ? ` · артикул ${esc(g.article)}` : ''}</div>
          <div class="small" style="margin-top:4px">${g.confirmed ? '' : '<span class="badge warn">уперше</span> '}${g.price != null ? `<span class="muted">${g.qty} шт × ${uah(g.price)}</span>` : ''}</div></div></div>
      </div>
      <div class="mpc-arrow" aria-hidden="true">→</div>
      <div class="mpc-side">
        <p class="mpc-cap">У LP-CRM <span data-from></span></p>
        <div data-parts></div>
        <div class="mp-crm-pick mpc-add"><input type="search" data-q placeholder="Додати товар LP-CRM: назва, код [83280] або №" autocomplete="off" aria-label="Пошук товару LP-CRM"><div class="mp-crm-res" data-res></div></div>
        <div class="small" data-sum></div>
      </div></div>`;
  const html = `<div class="small muted" style="margin-bottom:10px">${head}${first ? 'Ці товари передаються в LP-CRM уперше — перевірте, що підібрано правильно. Далі вони підставлятимуться самі, без цього вікна (для цього магазину).' : 'Склад запам\'ятається для цього магазину й підставлятиметься сам.'}</div>
    <div class="mpc-list">${st.map(pair).join('')}</div>`;
  return asyncModal('Підтвердіть товари для LP-CRM', html, { wide: true, footer: `<span class="small muted mpc-foot-note">Змінити пізніше: Маркетплейси → Налаштування → Товари</span><button class="btn" data-close>Скасувати</button><button class="btn primary" data-ok>${number ? 'Підтвердити й продовжити' : 'Зберегти'}</button>` }, (el, finish) => {
    const mainPrice = (g) => (g.price == null ? null : r2((g.price - g.parts.slice(1).reduce((a, p) => a + (Number(p.price) || 0) * (Number(p.qty) || 1), 0)) / (Number(g.parts[0]?.qty) || 1)));
    const render = (i) => {
      const g = st[i];
      const box = $(`.mpc-pair[data-i="${i}"]`, el);
      const mp = mainPrice(g);
      const f = g.parts.length ? FROM[g.from] : null;
      $('[data-from]', box).innerHTML = g.parts.length ? (f ? `<span class="badge ${f[0]}">${esc(f[1])}</span>` : '<span class="badge">обрано вручну</span>') : '<span class="badge warn">не знайдено — оберіть</span>';
      $('[data-parts]', box).innerHTML = g.parts.map((p, k) => `<div class="mpc-prod" data-k="${k}">
          <div><div class="mpc-pname">${esc(p.name || `Товар № ${p.product_id}`)}</div><div class="small muted">№ ${p.product_id}${p.list_price ? ` · ціна в LP-CRM ${uah(p.list_price)}` : ''}${k === 0 && g.parts.length > 1 ? ' · основний' : ''}</div></div>
          <label class="f"><span>К-сть на 1 шт</span><input data-qty type="number" min="0.001" step="1" value="${p.qty}"></label>
          ${k === 0 ? `<label class="f"><span>Ціна, ₴</span><input type="text" value="${mp == null ? 'решта ціни' : mp}" readonly title="Основний товар отримує решту ціни з Розетки" tabindex="-1"></label>`
    : `<label class="f"><span>Ціна, ₴</span><input data-price type="number" min="0" step="0.01" value="${p.price}"></label>`}
          <button type="button" class="btn sm icon" data-del aria-label="Прибрати товар">✕</button></div>`).join('');
      const sum = $('[data-sum]', box);
      if (!g.parts.length) sum.innerHTML = '';
      else if (mp != null && mp < 0) sum.innerHTML = '<span class="mpc-bad">Ціни додаткових товарів більші за ціну на Розетці — зменште їх.</span>';
      else if (g.price != null) sum.innerHTML = `<span class="muted">Сума в LP-CRM: <b>${uah(r2(g.price * g.qty))}</b> = ціна на Розетці ✓${g.parts.length > 1 ? ' · ціни додаткових товарів запам\'ятаються, основний отримає решту' : ''}</span>`;
      else sum.innerHTML = g.parts.length > 1 ? '<span class="muted">Основний товар отримає решту ціни з замовлення.</span>' : '';
      $$('[data-qty]', box).forEach((x, k) => (x.onchange = () => { g.parts[k].qty = Math.max(0.001, Number(x.value) || 1); render(i); }));
      $$('[data-price]', box).forEach((x) => { const k = Number(x.closest('[data-k]').dataset.k); x.onchange = () => { g.parts[k].price = Math.max(0, Number(x.value) || 0); render(i); }; });
      $$('[data-del]', box).forEach((x) => (x.onclick = () => { const k = Number(x.closest('[data-k]').dataset.k); g.parts.splice(k, 1); if (g.parts[0]) g.parts[0].price = null; g.from = ''; render(i); }));
      box.classList.toggle('need', !g.parts.length);
    };
    st.forEach((g, i) => {
      render(i);
      const box = $(`.mpc-pair[data-i="${i}"]`, el);
      const q = $('[data-q]', box);
      const res = $('[data-res]', box);
      let t = 0;
      q.oninput = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          if (q.value.trim().length < 2) { res.innerHTML = ''; return; }
          try {
            const r = await api('GET', `/api/mp/crm/products?q=${encodeURIComponent(q.value)}`);
            res.innerHTML = r.products.length ? r.products.map((p) => `<button type="button" data-p="${p.id}" data-n="${esc(p.name)}" data-pr="${p.price || 0}">№${p.id} · ${esc(p.name)}${p.price ? ` · ${uah(p.price)}` : ''}</button>`).join('') : '<div class="small muted" style="padding:6px 10px">Не знайдено</div>';
            $$('[data-p]', res).forEach((x) => (x.onclick = () => {
              const extra = g.parts.length > 0;
              let price = extra ? Number(x.dataset.pr) || 0 : null;
              if (extra && g.price != null) price = Math.min(price, Math.max(0, mainPrice(g))); // не більше, ніж лишається
              g.parts.push({ product_id: Number(x.dataset.p), name: x.dataset.n, qty: 1, price, list_price: Number(x.dataset.pr) || 0 });
              g.from = '';
              q.value = ''; res.innerHTML = '';
              render(i);
            }));
          } catch (er) { res.innerHTML = `<div class="small" style="padding:6px 10px">${esc(er.message)}</div>`; }
        }, 300);
      };
    });
    $('[data-ok]', el).onclick = async (e) => {
      const miss = st.findIndex((g) => !g.parts.length);
      if (miss >= 0) { toast(`Оберіть товар LP-CRM для «${st[miss].name}»`, true); $(`.mpc-pair[data-i="${miss}"] [data-q]`, el).focus(); return; }
      if (st.some((g) => g.price != null && mainPrice(g) < 0)) { toast('Ціни додаткових товарів більші за ціну на Розетці', true); return; }
      const b = e.currentTarget;
      b.disabled = true;
      try {
        await api('POST', '/api/mp/crm/confirm', { account, items: st.map((g) => ({ item_id: g.item_id, name: g.name, article: g.article, offer: g.offer, parts: g.parts.map((p) => ({ product_id: p.product_id, qty: p.qty, price: p.price || 0 })) })) });
        finish(st.map((g) => ({ ...g, confirmed: true, from: 'confirmed' })));
      } catch (er) { toast(er.message, true); b.disabled = false; }
    };
  });
}

// ---------- «Перевірте, що піде в LP-CRM» ----------
function checkData({ o, pre, goods: start, canSettings }) {
  let goods = start;
  const s = pre.send;
  const html = `<div class="small muted" style="margin-bottom:10px">Замовлення Розетки № ${esc(o.number)}${pre.shop_name ? ` · ${esc(pre.shop_name)}` : ''} · ${esc(String(pre.created_at || '').slice(0, 19).replace('T', ' ').replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1'))}</div>
    <div class="mpc-check">
      <section class="mpc-box"><p class="mpc-cap">Покупець і доставка</p>
        <label class="f"><span>ПІБ</span><input data-f="bayer_name" value="${esc(s.bayer_name)}"></label>
        <label class="f"><span>Телефон</span><input data-f="phone" value="${esc(intlPhone(s.phone))}" inputmode="tel"></label>
        <div class="small muted" style="margin:4px 0">Доставка: ${esc(s.delivery || '—')}</div>
        <label class="f"><span>Адреса</span><input data-f="address" value="${esc(s.address)}"></label></section>
      <section class="mpc-box"><p class="mpc-cap">LP-CRM</p>
        <dl class="mpc-kv"><dt>Відділ</dt><dd><span class="badge info">${esc(pre.office.id)} · ${esc(pre.office.name)}</span></dd>
          <dt>Вид оплати</dt><dd><span class="badge ok">${esc(pre.pay.id)} · ${esc(pre.pay.name)}</span></dd>
          <dt>Сайт</dt><dd>${esc(s.site || '—')}</dd>${s.field1 ? `<dt>Додаткове поле 1</dt><dd>${esc(s.field1)}</dd>` : ''}
          <dt>Статус</dt><dd>Нові</dd></dl></section>
      <section class="mpc-box mpc-wide"><p class="mpc-cap" style="display:flex;justify-content:space-between;align-items:center">Товари <button type="button" class="btn sm" data-edit>Змінити товари</button></p><div data-lines></div></section>
      <section class="mpc-box mpc-wide"><p class="mpc-cap">Коментар у LP-CRM</p><textarea data-f="comment" rows="6">${esc(s.comment)}</textarea></section>
    </div>`;
  const foot = `${canSettings ? '<label class="check small mpc-foot-note"><input type="checkbox" data-hide> Більше не показувати (увімкнути знову: Маркетплейси → Налаштування)</label>' : '<span class="mpc-foot-note"></span>'}<button class="btn" data-close>Скасувати</button><button class="btn primary" data-ok>Створити в LP-CRM</button>`;
  return asyncModal('Перевірте, що піде в LP-CRM', html, { wide: true, footer: foot }, (el, finish) => {
    const draw = () => {
      const lines = linesOf(goods);
      const total = lines.reduce((a, l) => a + l.price * l.count, 0);
      $('[data-lines]', el).innerHTML = `<table class="mpc-table"><thead><tr><th>Товар LP-CRM</th><th>№</th><th class="r">К-сть</th><th class="r">Ціна</th><th class="r">Сума</th></tr></thead><tbody>
        ${lines.map((l) => `<tr><td>${esc(l.name || '—')}</td><td>${l.product_id}</td><td class="r">${l.count}</td><td class="r ${l.price < 0 ? 'mpc-bad' : ''}">${uah(l.price)}</td><td class="r">${uah(l.price * l.count)}</td></tr>`).join('')}
        <tr class="mpc-total"><td colspan="4" class="r">Разом${Math.abs(total - (pre.total || total)) > 0.01 ? ` <span class="small mpc-bad">(на Розетці ${uah(pre.total)})</span>` : ''}</td><td class="r">${uah(total)}</td></tr></tbody></table>`;
    };
    draw();
    $('[data-edit]', el).onclick = async () => {
      const r = await confirmGoods({ account: o.account_id, number: o.number, shop: pre.shop_name, goods, first: false });
      if (r) { goods = r; draw(); }
    };
    $('[data-ok]', el).onclick = (e) => {
      if (linesOf(goods).some((l) => l.price < 0)) { toast('Ціна основного товару менше нуля — змініть товари', true); return; }
      e.currentTarget.disabled = true;
      const val = (k) => $(`[data-f="${k}"]`, el).value;
      finish({ goods, hide: Boolean($('[data-hide]', el)?.checked), over: { bayer_name: val('bayer_name'), phone: val('phone'), address: val('address'), comment: val('comment') } });
    };
  });
}

// ---------- «Створити в LP-CRM»: перше підтвердження товарів → перевірка даних → створення ----------
export async function crmCreateFlow(o, { can, done }) {
  let pre;
  try { pre = await api('GET', `/api/mp/crm/prefill/${o.account_id}/${encodeURIComponent(o.id)}`); } catch (er) { toast(er.message, true); return; }
  if (!pre.configured) { toast('Не налаштовано LP-CRM у «Налаштуваннях»', true); return; }
  let goods = pre.items;
  // товар без складу — завжди у вікно; непідтверджений — якщо вікно нового товару увімкнене
  const need = goods.filter((g) => !g.parts.length || (!g.confirmed && pre.flow.newItem));
  if (need.length) {
    const r = await confirmGoods({ account: o.account_id, number: o.number, shop: pre.shop_name, goods: need });
    if (!r) return;
    goods = goods.map((g) => r.find((x) => x.item_id === g.item_id) || g);
  }
  let over = {};
  if (pre.flow.check || linesOf(goods).some((l) => l.price < 0)) {
    const r = await checkData({ o, pre, goods, canSettings: can('api') });
    if (!r) return;
    goods = r.goods;
    over = r.over;
    if (r.hide) api('PUT', '/api/mp/crm/flow', { check: false }).then(() => toast('Вікно перевірки вимкнено — увімкнути: Маркетплейси → Налаштування')).catch(() => {});
  }
  const items = linesOf(goods).map((l) => ({ item_id: l.item_id, product_id: l.product_id, product_name: l.name, qty: l.count, price: l.price }));
  try {
    const r = await api('POST', '/api/mp/crm/create', { account: o.account_id, id: o.id, items, shop_name: pre.shop_name, ...over });
    toast(`Створено в LP-CRM${r.crm_id ? `: №${r.crm_id}` : ''}`);
    done?.();
  } catch (er) { toast(er.message, true); }
}

// ---------- «Маркетплейси → Налаштування» ----------
const TABS = [['crm', 'Передача в LP-CRM'], ['items', 'Товари'], ['remind', 'Ранкове нагадування'], ['shops', 'LP-CRM магазинів']];
export function createMpSettingsPage({ can }) {
  const st = { only: 'todo', q: '', account: '' };
  async function view(tab = 'crm') {
    if (!TABS.some(([k]) => k === tab)) tab = 'crm';
    main.innerHTML = `<div class="head-row"><h2>Налаштування маркетплейсів</h2></div>
      ${can('api') ? '' : '<div class="small muted" style="margin-bottom:8px">Змінювати налаштування може власник або адміністратор. Товари підтверджувати можуть менеджери.</div>'}
      <nav class="f-chips mpc-tabs" aria-label="Розділи налаштувань">${TABS.map(([k, t]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/mpset/${k}">${t}</a>`).join('')}</nav>
      <div id="mpcBody"><div class="card"><span class="spinner"></span> Завантажую…</div></div>`;
    const body = $('#mpcBody');
    try {
      if (tab === 'crm') await tabCrm(body);
      else if (tab === 'items') await tabItems(body);
      else if (tab === 'remind') await tabRemind(body);
      else await tabShops(body);
    } catch (er) { body.innerHTML = `<div class="alert warn">${esc(er.message)}</div>`; }
  }

  async function tabCrm(body) {
    const f = await api('GET', '/api/mp/crm/flow');
    const dis = can('api') ? '' : 'disabled';
    const row = (k, title, text) => `<div class="mpc-set"><label class="switch"><input type="checkbox" data-k="${k}" ${f[k] ? 'checked' : ''} ${dis} aria-label="${esc(title)}"><span></span></label><div><b>${title}</b><div class="small muted">${text}</div></div></div>`;
    body.innerHTML = `<section class="card mpc-card">
        ${row('check', 'Вікно «Перевірте, що піде в LP-CRM»', 'Перед кожним створенням показувати всі дані: покупця, телефон, доставку, відділ, вид оплати, товари з цінами й коментар. Їх можна виправити.')}
        ${row('newItem', 'Підтвердження нового товару', 'Коли товар з маркетплейсу передається в LP-CRM уперше — спитати, який товар LP-CRM (або кілька) підставити. Окремо для кожного магазину. Вимикати не радимо: товар без прив\'язки однаково доведеться обрати.')}
        <div class="mpc-set"><span class="badge">завжди</span><div class="small muted">Відділ <b>5 · Маркетплейси</b>. Вид оплати: 14 RozetkaPay (оплачено на Розетці), 15 післяплата RozetkaPay, 16 післяплата NovaPay (Нова пошта), 18 післяплата Meest. У коментар — номер, дата й час замовлення, повна інформація про оплату.</div></div>
      </section>`;
    $$('[data-k]', body).forEach((x) => (x.onchange = async () => {
      try { await api('PUT', '/api/mp/crm/flow', { [x.dataset.k]: x.checked }); toast(x.checked ? 'Увімкнено' : 'Вимкнено'); }
      catch (er) { toast(er.message, true); x.checked = !x.checked; }
    }));
  }

  async function tabItems(body) {
    const qs = new URLSearchParams({ only: st.only, q: st.q, account: st.account, limit: 100 });
    const d = await api('GET', `/api/mp/items?${qs}`);
    const edit = can('market.edit');
    const shopName = new Map(d.shops.map((s) => [s.id, s.name]));
    body.innerHTML = `<section class="card mpc-card">
      <div class="mpc-items-head">
        <div class="f-chips">${[['todo', `Не підтверджені · ${d.total - d.done}`], ['none', `Без товару LP-CRM · ${d.none}`], ['', `Усі · ${d.total}`]].map(([k, t]) => `<button type="button" class="chip ${st.only === k ? 'on' : ''}" data-only="${k}">${t}</button>`).join('')}</div>
        ${d.shops.length > 1 ? `<select data-acc aria-label="Магазин"><option value="">Усі магазини</option>${d.shops.map((s) => `<option value="${s.id}" ${String(s.id) === String(st.account) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
        <input type="search" data-q placeholder="Назва, артикул або код товару" value="${esc(st.q)}" aria-label="Пошук товару">
      </div>
      <div class="small muted" style="margin:6px 0 10px">Прив'язки окремі для кожного магазину. Товари потрапляють сюди із замовлень. «Підтвердити» — те саме вікно, що й при першій передачі в LP-CRM.</div>
      ${d.items.length ? `<div class="mpc-tbl-wrap"><table class="mpc-table mpc-items"><thead><tr><th></th><th>Товар на маркетплейсі</th><th>Товар(и) LP-CRM</th><th>Стан</th><th></th></tr></thead><tbody>
        ${d.items.map((x, i) => `<tr>
          <td>${x.photo ? `<img src="${esc(x.photo)}" alt="" loading="lazy">` : '<span class="mpc-ph sm"></span>'}</td>
          <td><b>${esc(x.name || x.item_id)}</b><div class="small muted">${esc(shopName.get(x.account_id) || '')} · код ${esc(x.item_id)}${x.article ? ` · ${esc(x.article)}` : ''}</div></td>
          <td>${x.parts.length ? x.parts.map((p) => `${esc(p.name || `№ ${p.product_id}`)} <span class="muted">№ ${p.product_id} × ${p.qty}</span>`).join('<br>') : '<span class="muted">— не прив\'язано</span>'}</td>
          <td>${x.confirmed ? `<span class="badge ok">підтвердив(ла) ${esc(x.confirmed_by || '')}${x.confirmed_at ? `, ${esc(fmtDateTime(x.confirmed_at).slice(0, 5))}` : ''}</span>`
    : x.parts.length ? `<span class="badge warn">${esc({ code: 'автоматично, за кодом', sku: 'автоматично, за артикулом', copied: 'як у дубля', learned: 'з замовлення LP-CRM', manual: 'обрано у формі' }[x.link_source] || 'не підтверджено')}</span>` : '<span class="badge warn">не підтверджено</span>'}</td>
          <td>${edit ? `<button type="button" class="btn sm" data-ed="${i}">${x.confirmed ? 'Змінити' : x.parts.length ? 'Підтвердити' : 'Обрати'}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>${d.items.length >= 100 ? '<div class="small muted" style="margin-top:6px">Показано перші 100 — уточніть пошук.</div>' : ''}` : '<div class="muted">Товарів немає.</div>'}</section>`;
    $$('[data-only]', body).forEach((b) => (b.onclick = () => { st.only = b.dataset.only; tabItems(body); }));
    if ($('[data-acc]', body)) $('[data-acc]', body).onchange = (e) => { st.account = e.target.value; tabItems(body); };
    let t = 0;
    $('[data-q]', body).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); tabItems(body).then(() => { const q = $('[data-q]', body); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 350); };
    $$('[data-ed]', body).forEach((b) => (b.onclick = async () => {
      const x = d.items[Number(b.dataset.ed)];
      const g = { item_id: x.item_id, name: x.name, article: x.article, offer: x.offer_id, photo: x.photo, qty: 1, price: null, confirmed: x.confirmed,
        from: x.confirmed ? 'confirmed' : { code: 'code', sku: 'sku', copied: 'copied' }[x.link_source] || (x.parts.length ? 'saved' : ''), parts: x.parts };
      const r = await confirmGoods({ account: x.account_id, shop: shopName.get(x.account_id), goods: [g], first: false });
      if (r) { toast('Збережено'); tabItems(body); }
    }));
  }

  async function tabRemind(body) {
    const s = await api('GET', '/api/mp/remind/settings');
    const DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [7, 'Нд']];
    const dis = can('api') ? '' : 'disabled';
    const ck = (n, t, on) => `<label class="check"><input type="checkbox" name="${n}" ${on ? 'checked' : ''} ${dis}> ${t}</label>`;
    body.innerHTML = `<section class="card mpc-card"><form id="rmF" class="form-stack">
        <div class="small muted">Щоранку менеджерам із сповіщеннями «Маркетплейси» (кожному — лише його магазини) приходить список «Передзвонити»: скасовані за добу й неоплачені, кому ще не дзвонили. Не потрапляють покупці, які вже зробили нове замовлення, і ті, кому дзвонили (Binotel) або відмітили «Подзвонив».</div>
        ${ck('on', '<b>Надсилати нагадування</b>', s.on)}
        <div class="btn-row" style="align-items:center;flex-wrap:wrap"><label class="f" style="width:120px"><span>Час (Київ)</span><select name="hour" ${dis}>${Array.from({ length: 16 }, (_, i) => i + 5).map((h) => `<option value="${h}" ${h === s.hour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
          <span class="small muted">Дні:</span>${DAYS.map(([d, t]) => `<label class="chk-chip"><input type="checkbox" data-day="${d}" ${s.days.includes(d) ? 'checked' : ''} ${dis}> ${t}</label>`).join('')}</div>
        <div class="small muted">Що включати</div>
        ${ck('client', 'Скасовані (запропонувати інший варіант, знижку)', s.client)}
        ${ck('unpaid', '«Клієнт не оплатив» — оплата не пройшла', s.unpaid)}
        ${ck('admins', 'Власнику й адміністраторам — зведення по всіх магазинах', s.admins)}
        ${ck('empty', 'Надсилати й тоді, коли передзвонювати нікому', s.empty)}
        ${s.last?.at ? `<div class="small muted">Востаннє: ${esc(fmtDateTime(s.last.at))} · менеджерів ${s.last.users || 0}, замовлень ${s.last.orders || 0}</div>` : ''}
        ${can('api') ? '<div class="btn-row"><button type="button" class="btn" id="rmTest">Надіслати тестове собі</button><button type="button" class="btn primary" id="rmSave">Зберегти</button></div>' : ''}
      </form></section>`;
    if (!can('api')) return;
    const f = $('#rmF', body);
    $('#rmSave', body).onclick = async () => {
      try {
        await api('PUT', '/api/mp/remind/settings', { on: f.on.checked, hour: Number(f.hour.value), days: $$('[data-day]', f).filter((x) => x.checked).map((x) => Number(x.dataset.day)),
          client: f.client.checked, unpaid: f.unpaid.checked, admins: f.admins.checked, empty: f.empty.checked });
        toast('Збережено');
      } catch (er) { toast(er.message, true); }
    };
    $('#rmTest', body).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { const r = await api('POST', '/api/mp/remind/test'); toast(`Надіслано вам у Telegram · замовлень: ${r.orders}`); } catch (er) { toast(er.message, true); }
      b.disabled = false;
    };
  }

  async function tabShops(body) {
    const [all, cfg] = await Promise.all([api('GET', '/api/mp/shops'), api('GET', '/api/mp/crm/settings')]);
    const shops = all.find((m) => m.key === 'rozetka')?.shops || [];
    const dis = can('api') ? '' : 'disabled';
    body.innerHTML = `<section class="card mpc-card">
      <div class="small muted" style="margin-bottom:10px">З цими даними «Створити в LP-CRM» створює замовлення в LP-CRM (статус «Нові»). Відділ для всіх замовлень з «Маркетплейсів» — <b>5 · Маркетплейси</b>; вид оплати визначається сам.${cfg.configured ? '' : ' <b>LP-CRM не підключено</b> — ключ вводиться в «Налаштуваннях».'}</div>
      ${shops.length ? shops.map((s) => { const c = cfg.shops?.[s.id] || {}; return `<form class="mpc-shop" data-acc="${s.id}"><b>${esc(s.name)}</b>
        <label class="f"><span>Сайт (поле «Сайт» у LP-CRM)</span><input name="site" value="${esc(c.site || '')}" placeholder="напр. rozetka.com.ua" ${dis}></label>
        <label class="f"><span>ID служби доставки в LP-CRM</span><input name="delivery" inputmode="numeric" value="${esc(c.delivery || '')}" ${dis}></label>
        <label class="f"><span>«Додаткове поле 1» — канал продажу</span><input name="field1" value="${esc(c.field1 || '')}" placeholder="напр. Rozetka(Ecovent)" ${dis}></label>
        <input type="hidden" name="office" value="${esc(c.office || '')}">
        ${can('api') ? '<button type="submit" class="btn primary sm">Зберегти</button>' : ''}</form>`; }).join('') : '<div class="muted">Магазинів Розетки ще не підключено.</div>'}
    </section>`;
    $$('form[data-acc]', body).forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('PUT', `/api/mp/crm/settings/${f.dataset.acc}`, { office: f.office.value, site: f.site.value, delivery: f.delivery.value, field1: f.field1.value }); toast('Збережено'); }
      catch (er) { toast(er.message, true); }
    }));
  }

  return { viewMpSettings: view };
}
