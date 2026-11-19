// B2B «Акції й маржа»: правила знижки від РРЦ на бренд, категорію або товар — постійні чи на період «з–по» (акції),
// для одного, кількох чи всіх партнерів. Вкладка B2B → «Акції й маржа» і блок у картці партнера. Сервер — b2b/margins.js.
// Порядок розрахунку: акція (товар → категорія → бренд) → особлива ціна товару → постійне правило (товар → категорія) → маржа бренду.
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger } from '../core/ui.js';

const dDay = (s) => String(s || '').split('-').reverse().join('.');
const uah = (n) => `${Number(n || 0).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`;
const LV = { brand: ['lv-b', 'Бренд'], category: ['lv-c', 'Категорія'], product: ['lv-p', 'Товар'] };
const ST = { active: ['ok', 'діє'], planned: ['info', 'заплановано'], past: ['', 'минуло'], permanent: ['ok', 'постійно'] };
const daysLeft = (to, today) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
const HELP = `Знижка від РРЦ: <b>Дропшипінг</b> — відправка клієнтам партнера, <b>B2B</b> — закупівля на склад партнера (порожньо — та сама).
  <b>Акція</b> (з датами) діє замість звичайної маржі, якщо вона більша (меншою акція маржу не робить); серед акцій діє точніша: товар → категорія → бренд. Коли акція закінчується — ціна сама повертається.
  Закупівля бере ціну на момент оформлення.`;

let metaCache = null;
const loadMeta = async () => (metaCache = metaCache || await api('GET', '/api/b2b/margin-rules/meta'));

function rulesTable(rules, today, { onEdit, onDel, ro }) {
  if (!rules.length) return '<div class="small muted">Правил ще немає — діє маржа брендів з картки партнера.</div>';
  return `<table class="list mr-table"><thead><tr><th>Рівень</th><th>Що</th><th class="r">Дропшипінг</th><th class="r">B2B</th><th>Період</th><th>Кому</th><th>Стан</th>${ro ? '' : '<th></th>'}</tr></thead><tbody>
    ${rules.map((r) => `<tr class="${r.status === 'past' ? 'mr-past' : r.promo ? 'mr-promo' : ''}">
      <td><span class="mr-lv ${LV[r.level][0]}">${LV[r.level][1]}</span></td>
      <td><b>${esc(r.ref_name)}</b>${r.promo ? ' <span class="badge warn">акція</span>' : ''}${r.name ? `<div class="small muted">${esc(r.name)}</div>` : ''}${r.rrp ? `<div class="small muted">РРЦ ${uah(r.rrp)}</div>` : ''}</td>
      <td class="r"><b>${r.margin} %</b></td><td class="r">${r.margin_wh != null ? `<b>${r.margin_wh} %</b>` : '<span class="small muted">та сама</span>'}</td>
      <td class="nowrap">${r.promo ? `${dDay(r.date_from)} – ${dDay(r.date_to)}` : 'постійно'}</td>
      <td class="small">${r.all ? 'усім партнерам' : esc(r.partner_names.join(', '))}</td>
      <td><span class="badge ${ST[r.status][0]}">${r.status === 'planned' ? `з ${dDay(r.date_from)}` : r.status === 'active' && r.date_to ? `діє · ще ${Math.max(0, daysLeft(r.date_to, today))} дн.` : ST[r.status][1]}</span></td>
      ${ro ? '' : `<td class="r nowrap"><button type="button" class="btn sm" data-mre="${r.id}">${r.status === 'past' ? 'Повторити' : 'Змінити'}</button> <button type="button" class="btn sm danger" data-mrd="${r.id}" aria-label="Видалити правило">✕</button></td>`}
    </tr>`).join('')}</tbody></table>`;
}

// Вікно правила: нове (rule = null), зміна, або «Повторити» минулу акцію (repeat — нові дати).
async function ruleModal(rule, { partnerId = null, repeat = false } = {}) {
  const m = await loadMeta();
  const r = rule || { level: 'brand', margin: '', margin_wh: '', promo: false, partners: partnerId ? [partnerId] : [], all: !partnerId };
  const who = r.all ? 'all' : r.partners.length === 1 && r.partners[0] === partnerId ? 'one' : 'some';
  const opt = (list, sel) => list.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}${x.n ? ` (${x.n})` : ''}</option>`).join('');
  return new Promise((resolve) => {
    const md = modal(rule && !repeat ? 'Змінити правило маржі' : 'Нове правило маржі', `<form id="mrF" class="form-stack">
        <div class="f"><span>Тип</span><div class="nw-seg mr-seg"><label><input type="radio" name="promo" value="1" ${r.promo ? 'checked' : ''}> 🔥 Акція (з датами)</label><label><input type="radio" name="promo" value="0" ${r.promo ? '' : 'checked'}> Постійне правило</label></div></div>
        <div class="f"><span>Для чого</span><div class="nw-seg mr-seg mr-seg3">${Object.entries(LV).map(([k, [, t]]) => `<label><input type="radio" name="level" value="${k}" ${r.level === k ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
        <label class="f" data-for="brand"><span>Бренд</span><select name="brand">${opt(m.brands, r.level === 'brand' ? r.ref_id : 0)}</select></label>
        <label class="f" data-for="category"><span>Категорія</span><select name="category">${opt(m.categories, r.level === 'category' ? r.ref_id : 0)}</select></label>
        <div class="f mr-prod" data-for="product"><span>Товар</span><input name="pq" placeholder="Назва або артикул товару" autocomplete="off" value="${r.level === 'product' ? esc(r.ref_name || '') : ''}"><input type="hidden" name="product" value="${r.level === 'product' ? r.ref_id : ''}"><div class="np-res" data-pres></div></div>
        <div class="grid2"><label class="f"><span>Дропшипінг (маржа клієнтам), %</span><input name="margin" inputmode="decimal" value="${esc(r.margin ?? '')}" required></label>
          <label class="f"><span>B2B (на склад партнера), %</span><input name="margin_wh" inputmode="decimal" value="${esc(r.margin_wh ?? '')}" placeholder="та сама"></label></div>
        <div class="grid2" data-dates><label class="f"><span>З</span><input type="date" name="date_from" value="${repeat ? '' : esc(r.date_from || m.today)}"></label><label class="f"><span>По (включно)</span><input type="date" name="date_to" value="${repeat ? '' : esc(r.date_to || '')}"></label></div>
        <label class="f"><span>Назва (необов'язково)</span><input name="name" value="${esc(r.name || '')}" placeholder="напр. Чорна п'ятниця" maxlength="80"></label>
        <div class="f"><span>Кому</span><div class="nw-seg mr-seg mr-seg3">
          ${partnerId ? `<label><input type="radio" name="who" value="one" ${who === 'one' ? 'checked' : ''}> Цьому партнеру</label>` : ''}
          <label><input type="radio" name="who" value="some" ${who === 'some' && !(partnerId && who === 'one') ? 'checked' : ''}> Вибраним</label>
          <label><input type="radio" name="who" value="all" ${who === 'all' ? 'checked' : ''}> Усім</label></div></div>
        <div class="nw-chk" data-plist ${who === 'some' ? '' : 'hidden'}>${m.partners.map((p) => `<label class="chk-chip"><input type="checkbox" data-pid="${p.id}" ${r.partners.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
        <div class="small muted">${HELP}</div>
      </form>`, { wide: true, footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="mrSave">Зберегти</button>' });
    const f = $('#mrF', md.el);
    const sync = () => {
      const lv = f.querySelector('[name=level]:checked').value;
      $$('[data-for]', f).forEach((x) => { x.hidden = x.dataset.for !== lv; });
      f.querySelector('[data-dates]').hidden = f.querySelector('[name=promo]:checked').value !== '1';
      f.querySelector('[data-plist]').hidden = f.querySelector('[name=who]:checked')?.value !== 'some';
      $$('.mr-seg label', f).forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    };
    $$('input[type=radio]', f).forEach((x) => (x.onchange = sync));
    sync();
    // пошук товару в каталозі
    let t = 0;
    f.pq.oninput = () => {
      f.product.value = '';
      clearTimeout(t);
      t = setTimeout(async () => {
        const box = $('[data-pres]', f);
        if (f.pq.value.trim().length < 2) { box.innerHTML = ''; return; }
        const r2 = await api('GET', `/api/b2b/news/products?q=${encodeURIComponent(f.pq.value)}`).catch(() => ({ products: [] }));
        box.innerHTML = r2.products.map((p, i) => `<button type="button" data-i="${i}">${esc(p.name)} <span class="muted small">РРЦ ${uah(p.rrp)}</span></button>`).join('') || '<div class="small muted np-hint">Не знайдено</div>';
        $$('[data-i]', box).forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); const p = r2.products[Number(b.dataset.i)]; f.product.value = p.id; f.pq.value = p.name; box.innerHTML = ''; }));
      }, 300);
    };
    let done = false;
    new MutationObserver((_, o) => { if (!document.contains(md.el)) { o.disconnect(); if (!done) resolve(false); } }).observe(document.body, { childList: true });
    $('#mrSave', md.el).onclick = async (e) => {
      const lv = f.querySelector('[name=level]:checked').value;
      const whoV = f.querySelector('[name=who]:checked')?.value || 'all';
      const body = {
        name: f.name.value, level: lv, ref_id: Number(lv === 'brand' ? f.brand.value : lv === 'category' ? f.category.value : f.product.value) || 0,
        margin: f.margin.value, margin_wh: f.margin_wh.value, promo: f.querySelector('[name=promo]:checked').value === '1',
        date_from: f.date_from.value, date_to: f.date_to.value,
        partners: whoV === 'all' ? [] : whoV === 'one' ? [partnerId] : $$('[data-pid]', f).filter((x) => x.checked).map((x) => Number(x.dataset.pid)),
      };
      if (whoV === 'some' && !body.partners.length) { toast('Оберіть хоча б одного партнера або «Усім»', true); return; }
      e.currentTarget.disabled = true;
      try {
        if (rule && !repeat) await api('PUT', `/api/b2b/margin-rules/${rule.id}`, body); else await api('POST', '/api/b2b/margin-rules', body);
        done = true; md.close(); toast('Правило збережено — ціни партнерів оновлено'); resolve(true);
      } catch (er) { toast(er.message, true); e.currentTarget.disabled = false; }
    };
  });
}

// Блок правил: на вкладці (усі) або в картці партнера (його власні + «для всіх»). Повертає функцію перемальовування.
export async function marginRulesBlock(box, { partner = null, ro = false } = {}) {
  const st = { f: '' };
  const draw = async () => {
    const [{ rules }, m] = await Promise.all([api('GET', `/api/b2b/margin-rules${partner ? `?partner=${partner.id}` : ''}`), loadMeta()]);
    const cnt = (s) => rules.filter((r) => (s === 'promo' ? r.promo && r.status !== 'past' : r.status === s)).length;
    const list = rules.filter((r) => !st.f || (st.f === 'promo' ? r.promo && r.status !== 'past' : r.status === st.f));
    box.innerHTML = `<div class="head-row" style="margin:0"><h3 style="margin:0">${partner ? 'Маржа й акції' : 'Постійні правила маржі'}</h3>${ro ? '' : '<button type="button" class="btn primary sm" data-mrnew>+ Правило</button>'}</div>
      ${partner ? '<div class="small"><b>Акції для партнера</b></div><div data-prs class="form-stack"></div><div class="small"><b>Окремі правила</b></div>' : ''}
      <div class="small muted">${HELP}</div>
      <div class="f-chips">${[['', `Усі · ${rules.length}`], ['promo', `Акції · ${cnt('promo')}`], ['active', `Діють · ${cnt('active')}`], ['planned', `Заплановані · ${cnt('planned')}`], ['permanent', `Постійні · ${cnt('permanent')}`], ['past', `Минули · ${cnt('past')}`]]
        .map(([k, t]) => `<button type="button" class="chip ${st.f === k ? 'on' : ''}" data-mrf="${k}">${t}</button>`).join('')}</div>
      ${rulesTable(list, m.today, { ro })}
      <div class="mr-check"><b>Перевірити ціну</b> <span class="small muted">— яка маржа спрацює на товар у вибраний день</span>
        <div class="btn-row" style="flex-wrap:wrap;align-items:flex-end;margin-top:6px">
          ${partner ? '' : `<label class="f" style="min-width:180px"><span>Партнер</span><select data-ckp>${m.partners.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>`}
          <div class="f mr-prod" style="flex:1;min-width:220px"><span>Товар</span><input data-ckq placeholder="Назва або артикул" autocomplete="off"><div class="np-res" data-ckres></div></div>
          <label class="f"><span>Дата</span><input type="date" data-ckd value="${m.today}"></label></div>
        <div data-ckout class="small" style="margin-top:6px"></div></div>`;
    if (partner) promosBlock($('[data-prs]', box), { partner }).catch(() => {});
    $$('[data-mrf]', box).forEach((b) => (b.onclick = () => { st.f = b.dataset.mrf; draw(); }));
    if ($('[data-mrnew]', box)) $('[data-mrnew]', box).onclick = async () => { if (await ruleModal(null, { partnerId: partner?.id || null })) draw(); };
    $$('[data-mre]', box).forEach((b) => (b.onclick = async () => {
      const r = rules.find((x) => String(x.id) === b.dataset.mre);
      if (await ruleModal(r, { partnerId: partner?.id || null, repeat: r.status === 'past' })) draw();
    }));
    $$('[data-mrd]', box).forEach((b) => (b.onclick = async () => {
      const r = rules.find((x) => String(x.id) === b.dataset.mrd);
      if (!(await confirmDanger(`Видалити правило «${r.ref_name}»?`, `${r.promo ? `Акція ${dDay(r.date_from)}–${dDay(r.date_to)}` : 'Постійне правило'}, ${r.margin} %. Ціни партнерів повернуться до наступного правила або маржі бренду.`, 'Видалити'))) return;
      try { await api('DELETE', `/api/b2b/margin-rules/${r.id}`); toast('Правило видалено'); draw(); } catch (er) { toast(er.message, true); }
    }));
    // перевірка ціни
    const out = $('[data-ckout]', box);
    let pid = 0;
    let t = 0;
    const check = async () => {
      const partnerId = partner?.id || Number($('[data-ckp]', box)?.value);
      if (!pid || !partnerId) return;
      try {
        const c = await api('GET', `/api/b2b/margin-rules/check?partner=${partnerId}&product=${pid}&date=${$('[data-ckd]', box).value}`);
        out.innerHTML = `РРЦ ${uah(c.product.rrp)} → дропшипінг <b>${uah(c.price)}</b> (−${c.margin} %), B2B <b>${uah(c.price_wh)}</b> (−${c.margin_wh} %)
          ${c.promo ? ` · <span class="badge warn">${c.promo_name ? esc(c.promo_name) : 'акція'}${c.promo_until ? ` до ${dDay(c.promo_until)}` : ''}</span>` : ' · <span class="muted">без акції</span>'}`;
      } catch (er) { out.innerHTML = `<span class="muted">${esc(er.message)}</span>`; }
    };
    $('[data-ckq]', box).oninput = (e) => {
      pid = 0;
      clearTimeout(t);
      t = setTimeout(async () => {
        const res = $('[data-ckres]', box);
        if (e.target.value.trim().length < 2) { res.innerHTML = ''; return; }
        const r2 = await api('GET', `/api/b2b/news/products?q=${encodeURIComponent(e.target.value)}`).catch(() => ({ products: [] }));
        res.innerHTML = r2.products.map((p, i) => `<button type="button" data-i="${i}">${esc(p.name)}</button>`).join('') || '<div class="small muted np-hint">Не знайдено</div>';
        $$('[data-i]', res).forEach((b) => (b.onmousedown = (ev) => { ev.preventDefault(); const p = r2.products[Number(b.dataset.i)]; pid = p.id; $('[data-ckq]', box).value = p.name; res.innerHTML = ''; check(); }));
      }, 300);
    };
    $('[data-ckd]', box).onchange = check;
    if ($('[data-ckp]', box)) $('[data-ckp]', box).onchange = check;
  };
  await draw();
  return draw;
}

// ================================================================ Акції
// Акція: назва, дати й «кому» — один раз; позиції — бренд / категорія цілком або група товарів, з однаковим % для всіх партнерів.
const PST = { active: ['ok', 'діє'], planned: ['info', 'заплановано'], past: ['', 'минула'], stopped: ['bad', 'зупинено'] };
const nWord = (n, one, few, many) => { const a = n % 10; const b = n % 100; return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many}`; };
const promoWhat = (p) => [p.brands ? nWord(p.brands, 'бренд', 'бренди', 'брендів') : '', p.categories ? nWord(p.categories, 'категорія', 'категорії', 'категорій') : '',
  p.products ? nWord(p.products, 'товар', 'товари', 'товарів') : ''].filter(Boolean).join(', ') || 'без позицій';
const promoBadge = (p, today) => (p.status === 'planned' ? `<span class="badge info">заплановано · за ${nWord(Math.max(0, daysLeft(p.date_from, today)), 'день', 'дні', 'днів')}</span>`
  : p.status === 'active' ? `<span class="badge ok">діє · ще ${nWord(Math.max(0, daysLeft(p.date_to, today)) + 1, 'день', 'дні', 'днів')}</span>`
    : `<span class="badge ${PST[p.status][0]}">${PST[p.status][1]}</span>`);

// Позиції акції ↔ групи у вікні: бренд / категорія — окремо; товари — групами за брендом і однаковими %.
function toGroups(items) {
  const groups = [];
  for (const i of items) {
    if (i.level !== 'product') { groups.push({ level: i.level, ref_id: i.ref_id, name: i.ref_name, margin: i.margin, margin_wh: i.margin_wh ?? '' }); continue; }
    const g = groups.find((x) => x.level === 'products' && x.brand === i.brand && x.margin === i.margin && (x.margin_wh ?? '') === (i.margin_wh ?? ''));
    const p = { id: i.ref_id, name: i.ref_name, article: i.article || '' };
    if (g) g.products.push(p); else groups.push({ level: 'products', brand: i.brand || 'Інші', products: [p], margin: i.margin, margin_wh: i.margin_wh ?? '' });
  }
  return groups;
}
const toItems = (groups) => groups.flatMap((g) => (g.level === 'products'
  ? g.products.map((p) => ({ level: 'product', ref_id: p.id, margin: g.margin, margin_wh: g.margin_wh }))
  : [{ level: g.level, ref_id: g.ref_id, margin: g.margin, margin_wh: g.margin_wh }]));
// Додати товари: у наявну групу того самого бренду без %, або нову; дублікати — пропускаються.
function addProducts(groups, list) {
  const have = new Set(groups.filter((g) => g.level === 'products').flatMap((g) => g.products.map((p) => p.id)));
  let n = 0;
  for (const p of list) {
    if (have.has(p.id)) continue;
    have.add(p.id);
    n++;
    const brand = p.brand || 'Інші';
    let g = groups.find((x) => x.level === 'products' && x.brand === brand && x.margin === '');
    if (!g) { g = { level: 'products', brand, products: [], margin: '', margin_wh: '' }; groups.push(g); }
    g.products.push({ id: p.id, name: p.name, article: p.article || '' });
  }
  return n;
}

// Вибір товарів бренду чи категорії галочками (з пошуком і «вибрати всі»).
async function pickProducts(m) {
  return new Promise((resolve) => {
    const md = modal('Товари галочками', `<div class="form-stack">
        <div class="grid2"><label class="f"><span>Бренд</span><select data-pb><option value="">—</option>${m.brands.map((b) => `<option value="${b.id}">${esc(b.name)} (${b.n})</option>`).join('')}</select></label>
          <label class="f"><span>або категорія</span><select data-pc><option value="">—</option>${m.categories.map((x) => `<option value="${x.id}">${esc(x.name)} (${x.n})</option>`).join('')}</select></label></div>
        <div class="btn-row"><input data-pq placeholder="Пошук у списку: назва або артикул" style="flex:1"><button type="button" class="btn sm" data-pall>Вибрати всі</button><button type="button" class="btn sm" data-pnone>Зняти всі</button></div>
        <div data-plist class="pr-pick"><div class="small muted">Оберіть бренд або категорію.</div></div></div>`,
    { wide: true, footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" data-pok>Додати вибрані</button>' });
    let list = [];
    const sel = new Set();
    const box = $('[data-plist]', md.el);
    const draw = () => {
      const q = $('[data-pq]', md.el).value.trim().toLowerCase();
      const vis = list.filter((p) => !q || `${p.name} ${p.article}`.toLowerCase().includes(q));
      box.innerHTML = vis.length ? vis.map((p) => `<label class="pr-pi"><input type="checkbox" data-id="${p.id}" ${sel.has(p.id) ? 'checked' : ''}> <span>${esc(p.name)}</span>
        <span class="small muted">${esc(p.article || '')}${p.rrp ? ` · РРЦ ${uah(p.rrp)}` : ' · без РРЦ'}</span></label>`).join('') : '<div class="small muted">Нічого не знайдено.</div>';
      $$('[data-id]', box).forEach((x) => (x.onchange = () => { const id = Number(x.dataset.id); if (x.checked) sel.add(id); else sel.delete(id); upd(); }));
      return vis;
    };
    const upd = () => { $('[data-pok]', md.el).textContent = sel.size ? `Додати ${nWord(sel.size, 'товар', 'товари', 'товарів')}` : 'Додати вибрані'; };
    const load = async (q) => { box.innerHTML = '<div class="small muted">Завантаження…</div>'; list = (await api('GET', `/api/b2b/promos/products?${q}`)).products; draw(); };
    $('[data-pb]', md.el).onchange = (e) => { if (e.target.value) { $('[data-pc]', md.el).value = ''; load(`brand=${e.target.value}`); } };
    $('[data-pc]', md.el).onchange = (e) => { if (e.target.value) { $('[data-pb]', md.el).value = ''; load(`category=${e.target.value}`); } };
    $('[data-pq]', md.el).oninput = draw;
    $('[data-pall]', md.el).onclick = () => { draw().forEach((p) => sel.add(p.id)); draw(); upd(); };
    $('[data-pnone]', md.el).onclick = () => { sel.clear(); draw(); upd(); };
    let done = false;
    $('[data-pok]', md.el).onclick = () => { if (!sel.size) { toast('Позначте хоча б один товар', true); return; } done = true; md.close(); resolve(list.filter((p) => sel.has(p.id))); };
    new MutationObserver((_, o) => { if (!document.contains(md.el)) { o.disconnect(); if (!done) resolve([]); } }).observe(document.body, { childList: true });
  });
}

// Вікно акції: нова (promo = null), зміна, перегляд минулої/зупиненої (ro) або «Повторити» (copy — позиції без дат).
async function promoModal(promo, { copy = false } = {}) {
  const m = await loadMeta();
  const ro = Boolean(promo && !copy && ['past', 'stopped'].includes(promo.status));
  const st = {
    name: promo?.name || '', date_from: copy ? '' : promo?.date_from || '', date_to: copy ? '' : promo?.date_to || '',
    all: promo ? promo.all : true, partners: new Set(promo?.partners || []), fix: promo ? promo.fix_rrp : true,
    groups: promo ? toGroups(promo.items) : [], prev: null, showPrices: false, open: -1,
  };
  return new Promise((resolve) => {
    const title = !promo ? 'Нова акція' : copy ? `Повторити: ${promo.name}` : ro ? promo.name : `Акція: ${promo.name}`;
    const md = modal(title, '<div id="prF" class="form-stack"></div>', {
      wide: true,
      footer: ro ? '<button class="btn" data-close>Закрити</button><button class="btn primary" data-repeat>Повторити з новими датами</button>'
        : '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="prSave">Зберегти акцію</button>',
    });
    const f = $('#prF', md.el);
    const dis = ro ? 'disabled' : '';
    let t = 0;
    const preview = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        if (!st.groups.length) { st.prev = null; drawCheck(); return; }
        try { st.prev = await api('POST', '/api/b2b/promos/preview', { ...payload(), id: copy ? 0 : promo?.id || 0 }); } catch (er) { st.prev = { errors: [er.message], warnings: [], rows: [], coverage: [] }; }
        drawCheck();
        // лише числа «Охоплює» — без перемальовування полів (щоб не збивати введення)
        $$('[data-cov]', f).forEach((x) => { const g = st.groups[Number(x.dataset.cov)]; if (g) x.textContent = cov(g); });
      }, 400);
    };
    const payload = () => ({ name: st.name, date_from: st.date_from, date_to: st.date_to, fix_rrp: st.fix, partners: st.all ? [] : [...st.partners], items: toItems(st.groups) });
    // охоплення групи (скільки товарів отримає її %) — з перевірки
    const cov = (g) => {
      if (!st.prev?.coverage) return g.level === 'products' ? nWord(g.products.length, 'товар', 'товари', 'товарів') : '';
      if (g.level === 'products') return nWord(g.products.length, 'товар', 'товари', 'товарів');
      const c = st.prev.coverage.find((x) => x.level === g.level && Number(x.ref_id) === Number(g.ref_id));
      return c ? nWord(c.n, 'товар', 'товари', 'товарів') : '';
    };
    const drawHead = () => {
      $('[data-head]', f).innerHTML = `<div class="pr-top">
          <label class="f"><span>Назва</span><input data-k="name" value="${esc(st.name)}" placeholder="Чорна п'ятниця" maxlength="80" ${dis}></label>
          <label class="f"><span>З</span><input type="date" data-k="date_from" value="${esc(st.date_from)}" ${dis}></label>
          <label class="f"><span>По (включно)</span><input type="date" data-k="date_to" value="${esc(st.date_to)}" ${dis}></label></div>
        <div class="btn-row" style="flex-wrap:wrap;align-items:center"><span class="small">Кому:</span>
          <button type="button" class="chip ${st.all ? 'on' : ''}" data-who="all" ${dis}>Усім партнерам</button>
          <button type="button" class="chip ${st.all ? '' : 'on'}" data-who="some" ${dis}>Вибраним</button>
          <label class="check small" style="margin-left:auto" title="Відсоток рахується від РРЦ на початок акції, навіть якщо в LP-CRM на час акції поставлять нижчу ціну">
            <input type="checkbox" data-fix ${st.fix ? 'checked' : ''} ${dis}> РРЦ фіксується на день старту${st.date_from ? ` (${dDay(st.date_from)})` : ''}</label></div>
        <div class="nw-chk" ${st.all ? 'hidden' : ''}>${m.partners.map((p) => `<label class="chk-chip"><input type="checkbox" data-pid="${p.id}" ${st.partners.has(p.id) ? 'checked' : ''} ${dis}> ${esc(p.name)}</label>`).join('')}</div>`;
      $$('[data-k]', f).forEach((x) => (x.oninput = () => { st[x.dataset.k] = x.value; if (x.dataset.k !== 'name') { drawHeadFix(); preview(); } }));
      $$('[data-who]', f).forEach((b) => (b.onclick = () => { st.all = b.dataset.who === 'all'; drawHead(); preview(); }));
      $$('[data-pid]', f).forEach((x) => (x.onchange = () => { if (x.checked) st.partners.add(Number(x.dataset.pid)); else st.partners.delete(Number(x.dataset.pid)); preview(); }));
      $('[data-fix]', f).onchange = (e) => { st.fix = e.target.checked; preview(); };
    };
    const drawHeadFix = () => { const l = $('[data-fix]', f)?.parentElement; if (l) l.lastChild.textContent = ` РРЦ фіксується на день старту${st.date_from ? ` (${dDay(st.date_from)})` : ''}`; };
    const drawItems = () => {
      const box = $('[data-items]', f);
      box.innerHTML = `${st.groups.length ? `<table class="list pr-items"><thead><tr><th>Позиція</th><th>Охоплює</th><th class="r">Дропшипінг, %</th><th class="r">B2B, %</th>${ro ? '' : '<th></th>'}</tr></thead><tbody>
          ${st.groups.map((g, i) => `<tr>
            <td>${g.level === 'products' ? `<span class="mr-lv lv-p">товари</span> ${esc(g.brand)}` : `<span class="mr-lv ${g.level === 'brand' ? 'lv-b' : 'lv-c'}">${g.level === 'brand' ? 'бренд' : 'категорія'}</span> ${esc(g.name)}`}</td>
            <td class="small muted"><span data-cov="${i}">${cov(g)}</span>${g.level === 'products' ? ` · <button type="button" class="linkbtn" data-open="${i}">${st.open === i ? 'сховати' : 'список'}</button>` : ''}</td>
            <td class="r"><input class="pr-pct" inputmode="decimal" data-g="${i}" data-f="margin" value="${esc(g.margin)}" placeholder="%" ${dis}></td>
            <td class="r"><input class="pr-pct" inputmode="decimal" data-g="${i}" data-f="margin_wh" value="${esc(g.margin_wh ?? '')}" placeholder="та сама" ${dis}></td>
            ${ro ? '' : `<td class="r"><button type="button" class="btn sm danger" data-del="${i}" aria-label="Прибрати позицію">✕</button></td>`}</tr>
            ${st.open === i ? `<tr><td colspan="5"><div class="pr-plist">${g.products.map((p, j) => `<span class="chk-chip">${esc(p.name)}${p.article ? ` <span class="muted small">${esc(p.article)}</span>` : ''}${ro ? '' : ` <button type="button" class="linkbtn" data-rm="${i}:${j}" aria-label="Прибрати товар">✕</button>`}</span>`).join('')}</div></td></tr>` : ''}`).join('')}
          </tbody></table>` : '<div class="small muted">Додайте бренди, категорії чи товари — кнопками вище.</div>'}`;
      $$('[data-f]', box).forEach((x) => (x.oninput = () => { st.groups[Number(x.dataset.g)][x.dataset.f] = x.value.trim(); preview(); }));
      $$('[data-del]', box).forEach((b) => (b.onclick = () => { st.groups.splice(Number(b.dataset.del), 1); st.open = -1; drawItems(); preview(); }));
      $$('[data-open]', box).forEach((b) => (b.onclick = () => { st.open = st.open === Number(b.dataset.open) ? -1 : Number(b.dataset.open); drawItems(); }));
      $$('[data-rm]', box).forEach((b) => (b.onclick = () => {
        const [gi, pi] = b.dataset.rm.split(':').map(Number);
        st.groups[gi].products.splice(pi, 1);
        if (!st.groups[gi].products.length) { st.groups.splice(gi, 1); st.open = -1; }
        drawItems(); preview();
      }));
    };
    const addUi = async (kind) => {
      const ab = $('[data-addbox]', f);
      if (kind === 'pick') {
        const got = await pickProducts(m);
        if (got.length) { const n = addProducts(st.groups, got); toast(n ? `Додано ${nWord(n, 'товар', 'товари', 'товарів')} — вкажіть %` : 'Ці товари вже в акції'); drawItems(); preview(); }
        return;
      }
      if (kind === 'ref') {
        ab.innerHTML = `<div class="pr-add btn-row" style="flex-wrap:wrap;align-items:flex-end">
          <label class="f"><span>Бренд</span><select data-ab><option value="">—</option>${m.brands.map((b) => `<option value="${b.id}">${esc(b.name)} (${b.n})</option>`).join('')}</select></label>
          <label class="f"><span>або категорія</span><select data-ac><option value="">—</option>${m.categories.map((x) => `<option value="${x.id}">${esc(x.name)} (${x.n})</option>`).join('')}</select></label>
          <button type="button" class="btn sm primary" data-aok>Додати</button><button type="button" class="btn sm" data-ax>Закрити</button></div>`;
        $('[data-ab]', ab).onchange = () => { $('[data-ac]', ab).value = ''; };
        $('[data-ac]', ab).onchange = () => { $('[data-ab]', ab).value = ''; };
        $('[data-ax]', ab).onclick = () => { ab.innerHTML = ''; };
        $('[data-aok]', ab).onclick = () => {
          const b = Number($('[data-ab]', ab).value);
          const cId = Number($('[data-ac]', ab).value);
          const level = b ? 'brand' : cId ? 'category' : '';
          if (!level) { toast('Оберіть бренд або категорію', true); return; }
          const ref = b || cId;
          if (st.groups.some((g) => g.level === level && Number(g.ref_id) === ref)) { toast('Вже в акції', true); return; }
          const src = level === 'brand' ? m.brands : m.categories;
          st.groups.push({ level, ref_id: ref, name: src.find((x) => x.id === ref)?.name || '', margin: '', margin_wh: '' });
          $('[data-ab]', ab).value = ''; $('[data-ac]', ab).value = '';
          drawItems(); preview();
        };
        return;
      }
      ab.innerHTML = `<div class="pr-add"><div class="head-row" style="margin:0"><span class="small"><b>Вставити артикули</b> — стовпець з Excel чи Google Таблиці (або ID товарів LP-CRM)</span>
          <button type="button" class="btn sm" data-ax>Закрити</button></div>
        <textarea data-at rows="5" class="mono" placeholder="WARMIX1500&#10;WARMIX2000&#10;…"></textarea>
        <div class="btn-row" style="flex-wrap:wrap;align-items:center"><button type="button" class="btn sm" data-af>Знайти</button><span data-ares class="small"></span><button type="button" class="btn sm primary" data-aok hidden></button></div></div>`;
      let found = [];
      $('[data-ax]', ab).onclick = () => { ab.innerHTML = ''; };
      $('[data-af]', ab).onclick = async () => {
        const r = await api('POST', '/api/b2b/promos/resolve', { text: $('[data-at]', ab).value });
        found = r.found;
        $('[data-ares]', ab).innerHTML = `<span class="badge ok">знайдено ${r.found.length}</span>${r.missing.length ? ` <span class="badge bad">не знайдено ${r.missing.length}: ${esc(r.missing.slice(0, 12).join(', '))}${r.missing.length > 12 ? '…' : ''}</span>` : ''}`;
        const ok = $('[data-aok]', ab);
        ok.hidden = !found.length;
        ok.textContent = `Додати ${nWord(found.length, 'товар', 'товари', 'товарів')}`;
      };
      $('[data-aok]', ab).onclick = () => {
        const n = addProducts(st.groups, found);
        toast(n ? `Додано ${nWord(n, 'товар', 'товари', 'товарів')} — вкажіть %` : 'Ці товари вже в акції');
        ab.innerHTML = ''; drawItems(); preview();
      };
      $('[data-at]', ab).focus();
    };
    const drawCheck = () => {
      const box = $('[data-check]', f);
      const p = st.prev;
      if (!p) { box.innerHTML = ''; return; }
      box.innerHTML = `${p.errors.length ? `<div class="alert bad">${p.errors.map(esc).join('<br>')}</div>` : ''}
        ${p.warnings.length ? `<div class="alert warn"><b>Перевірка перед збереженням</b><br>${p.warnings.map(esc).join('<br>')}</div>` : !p.errors.length ? `<div class="small muted">✓ Перевірено: ${nWord(p.count, 'товар', 'товари', 'товарів')} в акції, ${nWord(p.partners ?? 0, 'партнер', 'партнери', 'партнерів')}.</div>` : ''}
        ${p.rows.length ? `<button type="button" class="btn sm" data-prices>${st.showPrices ? 'Сховати ціни' : 'Ціни для партнера під час акції'}</button>` : ''}
        ${st.showPrices && p.rows.length ? `<div class="pr-prices"><table class="list"><thead><tr><th>Товар</th><th class="r">РРЦ зараз</th>${st.fix ? '<th class="r">РРЦ на старт</th>' : ''}<th class="r">%</th><th class="r">Дропшипінг</th><th class="r">B2B</th></tr></thead><tbody>
          ${p.rows.map((r) => `<tr><td>${esc(r.name)}${r.article ? ` <span class="muted small">${esc(r.article)}</span>` : ''}</td><td class="r">${uah(r.rrp)}</td>${st.fix ? `<td class="r">${uah(r.rrp_start)}</td>` : ''}
            <td class="r">${r.margin ?? '—'}</td><td class="r"><b>${r.price != null ? uah(r.price) : '—'}</b></td><td class="r">${r.price_wh != null ? uah(r.price_wh) : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
      const pb = $('[data-prices]', box);
      if (pb) pb.onclick = () => { st.showPrices = !st.showPrices; drawCheck(); };
    };
    f.innerHTML = `<div data-head class="form-stack"></div>
      <div class="head-row" style="margin:0"><b>Що входить в акцію</b>${ro ? '' : `<div class="btn-row" style="flex-wrap:wrap">
          <button type="button" class="btn sm" data-add="ref">+ Бренд / категорія</button><button type="button" class="btn sm" data-add="pick">Товари галочками</button>
          <button type="button" class="btn sm" data-add="paste">Вставити артикули</button></div>`}</div>
      <div data-addbox></div><div data-items class="form-stack"></div><div data-check class="form-stack"></div>
      <div class="small muted">Однаковий відсоток від РРЦ для всіх вибраних партнерів. Якщо звичайна маржа партнера на товар вища — на час акції лишається його звичайна.
      Серед позицій діє точніша: товар → категорія → бренд. Коли акція закінчується, ціни повертаються самі.</div>`;
    drawHead();
    drawItems();
    $$('[data-add]', f).forEach((b) => (b.onclick = () => addUi(b.dataset.add)));
    preview();
    let done = false;
    new MutationObserver((_, o) => { if (!document.contains(md.el)) { o.disconnect(); if (!done) resolve(false); } }).observe(document.body, { childList: true });
    const rep = $('[data-repeat]', md.el);
    if (rep) rep.onclick = async () => { done = true; md.close(); resolve(await promoModal(promo, { copy: true })); };
    const save = $('#prSave', md.el);
    if (save) save.onclick = async (e) => {
      if (!st.name.trim()) { toast('Вкажіть назву акції', true); return; }
      if (!st.date_from || !st.date_to) { toast('Вкажіть дати «з» і «по»', true); return; }
      if (!st.all && !st.partners.size) { toast('Оберіть хоча б одного партнера або «Усім»', true); return; }
      if (!st.groups.length) { toast('Додайте в акцію бренд, категорію чи товари', true); return; }
      const empty = st.groups.find((g) => g.margin === '');
      if (empty) { toast(`Вкажіть % для «${empty.level === 'products' ? `товари ${empty.brand}` : empty.name}»`, true); return; }
      e.currentTarget.disabled = true;
      try {
        if (promo && !copy) await api('PUT', `/api/b2b/promos/${promo.id}`, payload()); else await api('POST', '/api/b2b/promos', payload());
        done = true; md.close(); toast('Акцію збережено — ціни партнерів оновлено'); resolve(true);
      } catch (er) { toast(er.message, true); e.currentTarget.disabled = false; }
    };
  });
}

// Картки акцій. partner — лише акції цього партнера (у картці партнера), без кнопок керування.
async function promosBlock(box, { partner = null, ro = false } = {}) {
  const { promos, today } = await api('GET', `/api/b2b/promos${partner ? `?partner=${partner.id}` : ''}`);
  const open = async (id, copy = false) => { const p = await api('GET', `/api/b2b/promos/${id}`); return promoModal(p, { copy }); };
  box.innerHTML = promos.length ? promos.map((p) => `<div class="pr-card ${['past', 'stopped'].includes(p.status) ? 'pr-old' : ''}">
      <div><div class="btn-row" style="align-items:center;flex-wrap:wrap"><b>${esc(p.name)}</b> ${promoBadge(p, today)}</div>
        <div class="small muted">${dDay(p.date_from)} – ${dDay(p.date_to)} · ${p.all ? 'усім партнерам' : esc(p.partner_names.join(', '))} · ${promoWhat(p)}${p.fix_rrp ? '' : ' · від поточної РРЦ'}</div></div>
      ${partner ? '' : `<div class="btn-row">${['past', 'stopped'].includes(p.status) ? `<button type="button" class="btn sm" data-pv="${p.id}">Переглянути</button>` : `<button type="button" class="btn sm" data-po="${p.id}" ${ro ? 'disabled' : ''}>Відкрити</button>`}
        <button type="button" class="btn sm" data-pc="${p.id}" title="Повторити з новими датами" ${ro ? 'disabled' : ''}>Повторити</button>
        ${p.status === 'active' ? `<button type="button" class="btn sm" data-ps="${p.id}" ${ro ? 'disabled' : ''}>Зупинити</button>` : ''}
        ${p.status !== 'active' ? `<button type="button" class="btn sm danger" data-pd="${p.id}" aria-label="Видалити акцію" ${ro ? 'disabled' : ''}>✕</button>` : ''}</div>`}
    </div>`).join('') : `<div class="small muted">${partner ? 'Акцій для цього партнера немає.' : 'Акцій ще немає. «+ Нова акція» — назва, дати й товари з однаковою маржею для всіх партнерів.'}</div>`;
  if (partner) return;
  const redraw = () => promosBlock(box, { partner, ro });
  $$('[data-po]', box).forEach((b) => (b.onclick = async () => { if (await open(b.dataset.po)) redraw(); }));
  $$('[data-pv]', box).forEach((b) => (b.onclick = async () => { if (await open(b.dataset.pv)) redraw(); }));
  $$('[data-pc]', box).forEach((b) => (b.onclick = async () => { if (await open(b.dataset.pc, true)) redraw(); }));
  $$('[data-ps]', box).forEach((b) => (b.onclick = async () => {
    const p = promos.find((x) => String(x.id) === b.dataset.ps);
    if (!(await confirmDanger(`Зупинити акцію «${p.name}»?`, 'З сьогодні партнери знову купуватимуть за звичайною маржею. Акція лишиться в історії — її можна повторити.', 'Зупинити'))) return;
    try { await api('POST', `/api/b2b/promos/${p.id}/stop`); toast('Акцію зупинено'); redraw(); } catch (er) { toast(er.message, true); }
  }));
  $$('[data-pd]', box).forEach((b) => (b.onclick = async () => {
    const p = promos.find((x) => String(x.id) === b.dataset.pd);
    if (!(await confirmDanger(`Видалити акцію «${p.name}»?`, `${dDay(p.date_from)} – ${dDay(p.date_to)}, ${promoWhat(p)}. Її не буде в історії.`, 'Видалити'))) return;
    try { await api('DELETE', `/api/b2b/promos/${p.id}`); toast('Акцію видалено'); redraw(); } catch (er) { toast(er.message, true); }
  }));
}

// Вкладка B2B → «Акції й маржа»: акції (картки) або постійні правила маржі.
export async function viewMarginRules({ ro = false } = {}) {
  let tab = 'promos';
  try { tab = sessionStorage.getItem('mrTab') || 'promos'; } catch { /* немає сховища */ }
  main.innerHTML = '<div class="card form-stack" id="mrBox"><span class="small muted">Завантаження…</span></div>';
  const box = $('#mrBox');
  const draw = async () => {
    try { sessionStorage.setItem('mrTab', tab); } catch { /* немає сховища */ }
    box.innerHTML = `<div class="head-row" style="margin:0"><div class="f-chips" style="flex:0 1 auto"><button type="button" class="chip ${tab === 'promos' ? 'on' : ''}" data-tab="promos">Акції</button>
        <button type="button" class="chip ${tab === 'rules' ? 'on' : ''}" data-tab="rules">Постійні правила маржі</button></div>
        ${tab === 'promos' && !ro ? '<button type="button" class="btn primary" data-new>+ Нова акція</button>' : ''}</div><div data-body class="form-stack"></div>`;
    $$('[data-tab]', box).forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(); }));
    const body = $('[data-body]', box);
    try {
      if (tab === 'promos') {
        await promosBlock(body, { ro });
        const nb = $('[data-new]', box);
        if (nb) nb.onclick = async () => { if (await promoModal(null)) promosBlock(body, { ro }); };
      } else await marginRulesBlock(body, { ro });
    } catch (er) { body.innerHTML = `<div class="alert bad">${esc(er.message)}</div>`; }
  };
  await draw();
}
