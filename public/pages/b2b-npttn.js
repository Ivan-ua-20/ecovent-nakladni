// Адмінка B2B: «Створити ТТН» для замовлення клієнта партнера з опцією «ТТН створює Ековент».
// Від кого (кабінет НП / ТОВ і контактна особа), звідки (місто й відділення відправки), отримувач (перевірити й виправити),
// посилка (опис, оголошена вартість, вага, місця, розміри), хто платить доставку, контроль оплати. Сервер — b2b/npttn.js.
import { esc } from '../invoice.js';
import { $, $$, api, toast, modal } from '../core/ui.js';
import { npPickerHtml, wireNpPicker, npAddressText } from './np-picker.js';

const uah = (n) => `${Number(n || 0).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} грн`;

export async function npTtnModal(o, items, onDone) {
  let d;
  try { d = await api('GET', '/api/b2b/np/senders'); } catch (er) { toast(er.message, true); return; }
  const def = d.defaults || {};
  const total = items.reduce((t, i) => t + Number(i.price) * Number(i.qty), 0);
  const r = o.np || {};
  const cod = Number(r.cod) || 0;
  const desc = def.description || 'Кліматична техніка';
  const sendCity = def.city || null;
  const sendWh = def.warehouse || null;
  const m = modal(`Створити ТТН — ${o.number}`, `<form id="ttF" class="form-stack tt-form">
      <section class="card form-stack"><h3>Відправник</h3>
        <div class="grid2">
          <label class="f"><span>Від кого (кабінет Нової пошти)</span><select id="ttAcc">${d.accounts.map((a) => `<option value="${a.id}" ${a.id === d.account ? 'selected' : ''}>${esc(a.name)}${a.sender_name ? ` · ${esc(a.sender_name)}` : ''}${a.sender_code ? ` (${esc(a.sender_code)})` : ''}</option>`).join('')}</select></label>
          <label class="f"><span>Контактна особа</span><select id="ttContact"></select></label>
        </div>
        <div class="small muted" id="ttSender"></div>
        <div class="grid2">
          <div class="f np-ac"><span>Місто відправки</span><input id="ttSCity" value="${esc(sendCity?.name || '')}" autocomplete="off" placeholder="Місто, звідки відправляємо"><div class="np-res" id="ttSCityRes"></div></div>
          <div class="f np-ac"><span>Відділення відправки</span><input id="ttSWh" value="${esc(sendWh?.name || '')}" autocomplete="off" placeholder="Номер або адреса відділення"><div class="np-res" id="ttSWhRes"></div></div>
        </div>
      </section>
      <section class="card form-stack"><h3>Отримувач — перевірте дані партнера</h3>${npPickerHtml(r, { cod: false })}</section>
      <section class="card form-stack"><h3>Відправлення й оплата</h3>
        <div class="grid2">
          <label class="f"><span>Опис вмісту</span><input id="ttDesc" value="${esc(desc)}" maxlength="100"></label>
          <label class="f"><span>Оголошена вартість, грн</span><input id="ttCost" inputmode="decimal" value="${Math.round(cod || total)}"></label>
        </div>
        <div class="grid4">
          <label class="f"><span>Вага, кг *</span><input id="ttW" inputmode="decimal" value="${esc(def.weight || '')}"></label>
          <label class="f"><span>Місць</span><input id="ttSeats" type="number" min="1" max="20" value="1"></label>
          <label class="f"><span>Довжина, см</span><input id="ttL" inputmode="numeric" value="${esc(def.length || '')}"></label>
          <label class="f"><span>Ширина × висота, см</span><span class="tt-wh"><input id="ttWi" inputmode="numeric" value="${esc(def.width || '')}" aria-label="Ширина, см"> × <input id="ttH" inputmode="numeric" value="${esc(def.height || '')}" aria-label="Висота, см"></span></label>
        </div>
        <div class="small muted" id="ttPmNote" hidden>Поштомат: одне місце, до 20 кг, розміри обов'язкові (найбільша комірка — приблизно 40 × 30 × 60 см).</div>
        <div class="grid2">
          <label class="f"><span>Доставку оплачує</span><select id="ttPayer"><option value="Recipient" ${def.payer !== 'Sender' ? 'selected' : ''}>Отримувач (готівкою при отриманні)</option><option value="Sender" ${def.payer === 'Sender' ? 'selected' : ''}>Відправник — ми (безготівково)</option></select></label>
          <div class="f"><span>Контроль оплати</span>
            <label class="check"><input type="checkbox" id="ttCtl" ${cod ? 'checked' : ''}> Клієнт платить при отриманні</label>
            <input id="ttCtlSum" inputmode="decimal" value="${cod || ''}" placeholder="сума, грн" ${cod ? '' : 'disabled'} aria-label="Сума контролю оплати, грн"></div>
        </div>
        <div class="small muted">Партнер вказав: ${cod ? `клієнт платить при отриманні <b>${uah(cod)}</b>` : 'без оплати при отриманні'} · замовлення в нас на ${uah(total)}.</div>
        <label class="check"><input type="checkbox" id="ttRem" checked> Запам’ятати відправника, вагу й розміри для наступних ТТН</label>
      </section>
    </form>`, { wide: true, footer: '<span class="small muted" id="ttNote" style="margin-right:auto"></span><button class="btn" data-close>Скасувати</button><button class="btn primary" id="ttGo">Створити ТТН</button>' });
  const el = m.el;
  let sender = d.sender;
  let account = d.account;
  const sst = { city: sendCity, warehouse: sendWh };
  const drawSender = () => {
    $('#ttContact', el).innerHTML = sender.contacts.length ? sender.contacts.map((c) => `<option value="${c.ref}" ${c.ref === def.contact ? 'selected' : ''}>${esc(c.name)}${c.phone ? ` · ${esc(c.phone)}` : ''}</option>`).join('') : '<option value="">— у кабінеті немає контактних осіб —</option>';
    $('#ttSender', el).textContent = sender.name ? `Відправник у Новій пошті: ${sender.name}${sender.code ? `, ЄДРПОУ ${sender.code}` : ''}` : 'Не вдалося отримати відправника з кабінету НП.';
  };
  drawSender();
  $('#ttAcc', el).onchange = async (e) => {
    try { const x = await api('GET', `/api/b2b/np/senders?account=${e.target.value}`); sender = x.sender; account = x.account; drawSender(); } catch (er) { toast(er.message, true); }
  };
  const q = () => `&account=${account}`;
  const pick = wireNpPicker($('[data-np]', el).parentElement, r, { base: '/api/b2b/np', query: q });
  // Місто й відділення відправки — ті самі довідники НП.
  const ac = (inp, res, url, render, onPick, minLen) => {
    let t = 0;
    const load = async () => {
      const v = inp.value.trim();
      const u = url(v);
      if (!u || v.length < minLen) { res.innerHTML = ''; return; }
      try {
        const x = await api('GET', u);
        res.innerHTML = x.rows.slice(0, 30).map((row, i) => `<button type="button" data-i="${i}">${render(row)}</button>`).join('') || '<div class="small muted np-hint">Нічого не знайдено</div>';
        $$('[data-i]', res).forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); onPick(x.rows[Number(b.dataset.i)]); res.innerHTML = ''; }));
      } catch (er) { res.innerHTML = `<div class="small np-hint">${esc(er.message)}</div>`; }
    };
    inp.oninput = () => { clearTimeout(t); t = setTimeout(load, 350); };
    inp.onfocus = () => { if (!minLen && !inp.value.trim()) load(); };
    inp.onblur = () => setTimeout(() => { res.innerHTML = ''; }, 150);
  };
  ac($('#ttSCity', el), $('#ttSCityRes', el), (v) => `/api/b2b/np/cities?q=${encodeURIComponent(v)}${q()}`, (x) => esc(x.name),
    (x) => { sst.city = { ref: x.ref, name: x.name }; $('#ttSCity', el).value = x.name; sst.warehouse = null; $('#ttSWh', el).value = ''; }, 2);
  ac($('#ttSWh', el), $('#ttSWhRes', el), (v) => (sst.city ? `/api/b2b/np/warehouses?city=${encodeURIComponent(sst.city.ref)}&kind=warehouse&q=${encodeURIComponent(v)}${q()}` : ''), (x) => esc(x.name),
    (x) => { sst.warehouse = { ref: x.ref, name: x.name }; $('#ttSWh', el).value = x.name; }, 0);
  $('#ttCtl', el).onchange = (e) => { $('#ttCtlSum', el).disabled = !e.target.checked; if (e.target.checked && !$('#ttCtlSum', el).value) $('#ttCtlSum', el).value = cod || Math.round(total); };
  const pmNote = () => { $('#ttPmNote', el).hidden = pick.get().type !== 'postomat'; };
  $$('[data-type]', el).forEach((x) => x.addEventListener('change', pmNote));
  pmNote();
  $('#ttGo', el).onclick = async (e) => {
    const bad = pick.check();
    if (bad) { toast(bad, true); return; }
    if (!sst.city || !sst.warehouse) { toast('Оберіть місто й відділення відправки', true); return; }
    const contact = sender.contacts.find((c) => c.ref === $('#ttContact', el).value);
    if (!contact) { toast('Оберіть контактну особу відправника', true); return; }
    const num = (id) => Number(String($(id, el).value).replace(',', '.')) || 0;
    const ctl = $('#ttCtl', el).checked ? num('#ttCtlSum') : 0;
    if ($('#ttCtl', el).checked && !(ctl > 0)) { toast('Вкажіть суму контролю оплати', true); return; }
    const rec = pick.get();
    const body = {
      account,
      sender: { ref: sender.ref, name: sender.name, contact: contact.ref, contactName: contact.name, phone: contact.phone, city: sst.city, warehouse: sst.warehouse },
      recipient: { ...rec, cod: ctl },
      parcel: { description: $('#ttDesc', el).value, cost: num('#ttCost'), weight: num('#ttW'), seats: num('#ttSeats') || 1, length: num('#ttL'), width: num('#ttWi'), height: num('#ttH') },
      payer: $('#ttPayer', el).value, control: ctl, remember: $('#ttRem', el).checked,
    };
    const b = e.currentTarget;
    b.disabled = true; b.innerHTML = '<span class="spinner"></span> Створюю…';
    try {
      const x = await api('POST', `/api/b2b/clients/${o.id}/ttn`, body);
      m.close();
      toast(`ТТН ${x.ttn} створено${x.cost ? ` · доставка ${uah(x.cost)}` : ''}${x.estimated ? ` · орієнтовно ${x.estimated}` : ''}`);
      onDone?.();
    } catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Створити ТТН'; }
  };
  $('#ttNote', el).textContent = `Отримувач: ${npAddressText(r)}`;
}
