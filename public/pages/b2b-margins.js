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
  <b>Акція</b> (з датами) завжди важливіша за постійну маржу; серед акцій діє точніша: товар → категорія → бренд. Коли акція закінчується — ціна сама повертається.
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
  const r = rule || { level: 'brand', margin: '', margin_wh: '', promo: true, partners: partnerId ? [partnerId] : [], all: !partnerId };
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
    box.innerHTML = `<div class="head-row" style="margin:0"><h3 style="margin:0">${partner ? 'Маржа й акції' : 'Правила маржі й акції'}</h3>${ro ? '' : '<button type="button" class="btn primary sm" data-mrnew>+ Правило / акція</button>'}</div>
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

// Вкладка B2B → «Акції й маржа».
export async function viewMarginRules({ ro = false } = {}) {
  main.innerHTML = '<div class="card form-stack" id="mrBox"><span class="small muted">Завантаження…</span></div>';
  try { await marginRulesBlock($('#mrBox'), { ro }); } catch (er) { $('#mrBox').innerHTML = `<div class="alert bad">${esc(er.message)}</div>`; }
}
