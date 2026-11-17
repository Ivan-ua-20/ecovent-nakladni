// Отримувач Нової пошти: ПІБ (українською), телефон, спосіб доставки (відділення / поштомат / адреса), населений пункт,
// відділення чи поштомат, вулиця з будинком і квартирою — з довідників НП (через наш сервер), сума оплати при отриманні.
// Використовується у формі замовлення партнера («ТТН створює Ековент») і у вікні «Створити ТТН» в адмінці.
import { esc } from '../invoice.js';
import { $, $$, api } from '../core/ui.js';

export const NP_TYPES = { warehouse: 'Відділення', postomat: 'Поштомат', doors: 'Адресна доставка' };
export const npAddressText = (r) => (r?.city ? `${NP_TYPES[r.type] || ''}: ${r.city.name}, ${r.type === 'doors' ? `${r.street?.name || ''}, буд. ${r.house}${r.flat ? `, кв. ${r.flat}` : ''}` : r.warehouse?.name || ''}` : '');
export const npFullName = (r) => [r?.last, r?.first, r?.middle].filter(Boolean).join(' ');

// v — поточні дані; opts.cod — показувати поле «Оплата при отриманні»; opts.title — підпис блоку.
export function npPickerHtml(v = {}, { cod = true, codLabel = 'Клієнт платить при отриманні, грн' } = {}) {
  const t = v.type || 'warehouse';
  const nm = `npType${Math.random().toString(36).slice(2, 8)}`; // одна група перемикачів на блок
  return `<div class="np-pick" data-np>
    <div class="grid3">
      <label class="f"><span>Прізвище *</span><input data-k="last" value="${esc(v.last || '')}" autocomplete="off" placeholder="Шевченко"></label>
      <label class="f"><span>Ім’я *</span><input data-k="first" value="${esc(v.first || '')}" autocomplete="off" placeholder="Тарас"></label>
      <label class="f"><span>По батькові</span><input data-k="middle" value="${esc(v.middle || '')}" autocomplete="off"></label>
    </div>
    <label class="f"><span>Телефон отримувача *</span><input data-k="phone" value="${esc(v.phone || '')}" inputmode="tel" placeholder="0XXXXXXXXX"></label>
    <div class="np-types" role="radiogroup" aria-label="Спосіб доставки">${Object.entries(NP_TYPES).map(([k, n]) => `<label class="chip ${k === t ? 'on' : ''}"><input type="radio" name="${nm}" data-type value="${k}" ${k === t ? 'checked' : ''}> ${n}</label>`).join('')}</div>
    <div class="f np-ac"><span>Населений пункт *</span><input data-ac="city" value="${esc(v.city?.name || '')}" autocomplete="off" placeholder="Почніть вводити: Київ, Бровари…"><div class="np-res" data-res="city"></div></div>
    <div class="f np-ac" data-box="wh"><span data-whl>${t === 'postomat' ? 'Поштомат *' : 'Відділення *'}</span><input data-ac="wh" value="${esc(v.warehouse?.name || '')}" autocomplete="off" placeholder="Номер або адреса: 12, Хрещатик…"><div class="np-res" data-res="wh"></div></div>
    <div data-box="doors" class="form-stack" style="gap:8px">
      <div class="f np-ac"><span>Вулиця *</span><input data-ac="street" value="${esc(v.street?.name || '')}" autocomplete="off" placeholder="Почніть вводити назву вулиці"><div class="np-res" data-res="street"></div></div>
      <div class="grid2"><label class="f"><span>Будинок *</span><input data-k="house" value="${esc(v.house || '')}"></label><label class="f"><span>Квартира / офіс</span><input data-k="flat" value="${esc(v.flat || '')}"></label></div>
    </div>
    ${cod ? `<label class="f"><span>${esc(codLabel)}</span><input data-k="cod" inputmode="decimal" value="${esc(v.cod || '')}" placeholder="0 — якщо клієнт уже оплатив"></label>` : ''}
  </div>`;
}

// base — '/api/b2b/p/np' (партнер) або '/api/b2b/np' (адмін); query — додаткові параметри (?account=…). Повертає get() → дані.
export function wireNpPicker(root, v = {}, { base, query = () => '' } = {}) {
  const st = { type: v.type || 'warehouse', city: v.city || null, warehouse: v.warehouse || null, street: v.street || null };
  const box = $('[data-np]', root);
  const show = () => {
    $('[data-box="wh"]', box).hidden = st.type === 'doors';
    $('[data-box="doors"]', box).hidden = st.type !== 'doors';
    $('[data-whl]', box).textContent = st.type === 'postomat' ? 'Поштомат *' : 'Відділення *';
    $$('[data-type]', box).forEach((r) => r.closest('.chip').classList.toggle('on', r.checked));
  };
  show();
  $$('[data-type]', box).forEach((r) => (r.onchange = () => {
    st.type = r.value;
    if (st.warehouse && (st.type === 'postomat') !== (st.warehouse.category === 'Postomat')) { st.warehouse = null; $('[data-ac="wh"]', box).value = ''; }
    show();
  }));
  const ac = (what, url, render, pick, minLen = 1) => {
    const inp = $(`[data-ac="${what}"]`, box);
    const res = $(`[data-res="${what}"]`, box);
    let t = 0;
    let seq = 0;
    const load = async () => {
      const q = inp.value.trim();
      const u = url(q);
      if (!u || q.length < minLen) { res.innerHTML = ''; return; }
      const my = ++seq;
      res.innerHTML = '<div class="small muted np-hint"><span class="spinner"></span> Шукаю…</div>';
      try {
        const r = await api('GET', u);
        if (my !== seq) return;
        res.innerHTML = r.rows.length ? r.rows.slice(0, 30).map((x, i) => `<button type="button" data-i="${i}">${render(x)}</button>`).join('') : '<div class="small muted np-hint">Нічого не знайдено</div>';
        $$('[data-i]', res).forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); pick(r.rows[Number(b.dataset.i)]); res.innerHTML = ''; }));
      } catch (er) { if (my === seq) res.innerHTML = `<div class="small np-hint" style="color:var(--bad)">${esc(er.message)}</div>`; }
    };
    inp.oninput = () => { clearTimeout(t); t = setTimeout(load, 350); };
    inp.onfocus = () => { if (what === 'wh' && st.city && !inp.value.trim()) load(); };
    inp.onblur = () => setTimeout(() => { res.innerHTML = ''; }, 150);
    return inp;
  };
  const q = () => query();
  const cityIn = ac('city', (s) => (s.length >= 2 ? `${base}/cities?q=${encodeURIComponent(s)}${q()}` : ''), (x) => `<b>${esc(x.name)}</b>${x.warehouses ? ` <span class="muted small">${x.warehouses} відд.</span>` : ''}`,
    (x) => { st.city = { ref: x.ref, name: x.name }; cityIn.value = x.name; st.warehouse = null; st.street = null; $('[data-ac="wh"]', box).value = ''; $('[data-ac="street"]', box).value = ''; }, 2);
  const whIn = ac('wh', (s) => (st.city ? `${base}/warehouses?city=${encodeURIComponent(st.city.ref)}&kind=${st.type === 'postomat' ? 'postomat' : 'warehouse'}&q=${encodeURIComponent(s)}${q()}` : ''),
    (x) => esc(x.name), (x) => { st.warehouse = { ref: x.ref, name: x.name, number: x.number, category: x.category }; whIn.value = x.name; }, 0);
  const stIn = ac('street', (s) => (st.city && s.length >= 2 ? `${base}/streets?city=${encodeURIComponent(st.city.ref)}&q=${encodeURIComponent(s)}${q()}` : ''),
    (x) => esc(x.name), (x) => { st.street = { ref: x.ref, name: x.name }; stIn.value = x.name; }, 2);
  // Ручне редагування тексту без вибору зі списку скидає вибране (щоб не відправити старе значення).
  cityIn.addEventListener('input', () => { if (st.city && cityIn.value !== st.city.name) st.city = null; });
  whIn.addEventListener('input', () => { if (st.warehouse && whIn.value !== st.warehouse.name) st.warehouse = null; });
  stIn.addEventListener('input', () => { if (st.street && stIn.value !== st.street.name) st.street = null; });
  const val = (k) => $(`[data-k="${k}"]`, box)?.value.trim() || '';
  return {
    get: () => ({ last: val('last'), first: val('first'), middle: val('middle'), phone: val('phone'), type: st.type, city: st.city, warehouse: st.type === 'doors' ? null : st.warehouse,
      street: st.type === 'doors' ? st.street : null, house: val('house'), flat: val('flat'), cod: Number(val('cod').replace(',', '.')) || 0 }),
    // Перевірка до відправки на сервер — підказка, яке поле заповнити.
    check: () => {
      const d = { last: val('last'), first: val('first'), phone: val('phone') };
      if (!d.last || !d.first) return 'Вкажіть прізвище й ім’я отримувача';
      if (!/^(\+?38)?0\d{9}$/.test(d.phone.replace(/[\s()-]/g, ''))) return 'Телефон отримувача: 0XXXXXXXXX';
      if (!st.city) return 'Оберіть населений пункт зі списку';
      if (st.type === 'doors') return !st.street ? 'Оберіть вулицю зі списку' : !val('house') ? 'Вкажіть номер будинку' : '';
      return st.warehouse ? '' : st.type === 'postomat' ? 'Оберіть поштомат зі списку' : 'Оберіть відділення зі списку';
    },
  };
}
