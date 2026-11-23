// Маркетплейси → «Створити ТТН» для замовлення Розетки (ROZETKA Delivery, Нова пошта, Meest). Сервер — src/modules/market/ttn.js.
// Дані одержувача й відправника приходять з кабінету Розетки; тут — перевірка, вага й габарити, оплата.
import { esc } from '../invoice.js';
import { $, $$, api, toast, modal } from '../core/ui.js';
import { rzWho, wireRzWho } from './rzme.js';

const uah = (n) => `${Number(n || 0).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`;

export async function createTtn(o, { done } = {}) {
  const q = (carrier = '') => `/api/mp/ttn/prep?${new URLSearchParams({ account: o.account_id, id: o.id, ...(carrier ? { carrier } : {}) })}`;
  const md = modal(`ТТН для № ${o.number}`, '<div id="ttF" class="form-stack"><span class="small muted"><span class="spinner"></span> Беремо дані із замовлення в Розетці…</span></div>',
    { wide: true, footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="ttGo" disabled>Створити ТТН</button>' });
  const f = $('#ttF', md.el);
  const go = $('#ttGo', md.el);
  let p = null;
  const load = async (carrier = '') => {
    go.disabled = true;
    f.innerHTML = '<span class="small muted"><span class="spinner"></span> Беремо дані із замовлення в Розетці…</span>';
    try { p = await api('GET', q(carrier)); } catch (er) { f.innerHTML = `<div class="alert bad">${esc(er.message)}</div>`; return; }
    draw();
  };
  const chips = () => `<div class="btn-row" style="flex-wrap:wrap">${Object.entries(p.carriers).map(([k, v]) => `<button type="button" class="chip ${p.carrier === k ? 'on' : ''}" data-car="${k}">${esc(v)}</button>`).join('')}</div>`;
  const draw = () => {
    if (!p.carrier) {
      f.innerHTML = `<div class="small">Доставка в замовленні: <b>${esc(p.delivery || '—')}</b>. Оберіть перевізника:</div>${chips()}`;
      $$('[data-car]', f).forEach((b) => (b.onclick = () => load(b.dataset.car)));
      return;
    }
    const x = p.parcel;
    const cod = p.paid || p.installment ? 0 : Math.round(p.amount);
    f.innerHTML = `<div class="head-row" style="margin:0"><b>${esc(p.carrier_name)}</b><span class="small muted">Доставка в замовленні: ${esc(p.delivery || '—')}</span></div>
      <div class="grid2">
        <div class="mp-box"><div class="mp-cap">Одержувач (із замовлення)</div><b>${esc(p.recipient.name || '—')}</b> · ${esc(p.recipient.phone || '')}
          <div class="small muted">${esc(p.recipient.kind)}: ${esc(p.recipient.place || '—')}</div></div>
        <div class="mp-box"><div class="mp-cap">Відправник (кабінет Розетки)</div>${p.sender ? `<b>${esc(p.sender.name)}</b><div class="small muted">${esc(p.sender.place || '')}${p.sender.phone ? ` · ${esc(p.sender.phone)}` : ''}</div>`
          : `<div class="alert bad small">Відправника не налаштовано. ${esc(p.sender_hint)}</div>`}</div>
      </div>
      <div class="mp-box"><div class="mp-cap">Оплата</div>
        ${p.paid ? `<span class="badge ok">✓ Оплачено${p.pay ? ` · ${esc(p.pay)}` : ''}</span> <span class="small muted">— накладеного платежу не буде</span>`
          : `<span class="badge warn">Не оплачено${p.pay ? ` · ${esc(p.pay)}` : ''}</span>${p.installment ? ' <span class="small muted">— оплата частинами: гроші надходять від банку, накладений платіж не потрібен</span>' : ''}`}
        <div class="grid2" style="margin-top:8px">
          <label class="f"><span>Накладений платіж, ₴ (0 — без нього)</span><input name="cod" inputmode="decimal" value="${cod}" ${p.cod_allowed ? '' : 'disabled'}></label>
          <label class="f"><span>Оголошена вартість, ₴</span><input name="declared" inputmode="decimal" value="${Math.round(p.amount)}"></label></div>
        ${p.payment_control ? `<label class="check small"><input type="checkbox" name="pc" ${p.payment_control_on ? 'checked' : ''}> Контроль оплати (гроші на розрахунковий рахунок)</label>` : ''}
        ${p.cod_allowed ? '' : '<div class="small muted">У відділенні одержувача накладений платіж недоступний.</div>'}
      </div>
      <div class="mp-box"><div class="mp-cap">Посилка${p.carrier === 'rd' ? ' (до 30 кг, сторона до 120 см)' : ''}</div>
        <div class="tt-dims">
          <label class="f"><span>Вага, кг</span><input name="weight" inputmode="decimal" value="${esc(x.weight)}"></label>
          <label class="f"><span>Довжина, см</span><input name="length" inputmode="numeric" value="${esc(x.length)}"></label>
          <label class="f"><span>Ширина, см</span><input name="width" inputmode="numeric" value="${esc(x.width)}"></label>
          <label class="f"><span>Висота, см</span><input name="height" inputmode="numeric" value="${esc(x.height)}"></label>
          <label class="f"><span>Місць</span><input name="places" inputmode="numeric" value="${esc(x.places)}"></label></div>
        <label class="f"><span>Опис (до 100 символів)</span><input name="description" maxlength="100" value="${esc(x.description || '')}"></label>
        <div data-warn></div></div>
      <div class="btn-row" style="align-items:center;flex-wrap:wrap"><span class="small">Доставку оплачує:</span>
        <label class="check small"><input type="radio" name="payer" value="sender" checked> відправник (ми)</label>
        <label class="check small"><input type="radio" name="payer" value="recipient"> одержувач</label></div>
      <details class="small muted"><summary>Інший перевізник</summary>${chips()}</details>
      <div data-who></div>`;
    rzWho(o.account_id).then((h) => { const w = $('[data-who]', f); if (w) { w.innerHTML = h; wireRzWho(f); } });
    $$('[data-car]', f).forEach((b) => (b.onclick = () => load(b.dataset.car)));
    const warn = () => {
      const v = (n) => Number(String(f.querySelector(`[name=${n}]`)?.value || '').replace(',', '.')) || 0;
      const w = [];
      if (p.limits?.weight && v('weight') > p.limits.weight) w.push(`Вага більша за ліміт відділення одержувача (${p.limits.weight} кг).`);
      if (p.limits?.cost && v('declared') > p.limits.cost) w.push(`Оголошена вартість більша за ліміт відділення (${uah(p.limits.cost)}).`);
      if (p.carrier === 'rd' && (v('weight') > 30 || Math.max(v('length'), v('width'), v('height')) > 120)) w.push('ROZETKA Delivery: до 30 кг і до 120 см на сторону.');
      if (!p.paid && !p.installment && !v('cod')) w.push('Замовлення не оплачене, а накладеного платежу немає — гроші з покупця не візьмуть.');
      if (p.installment && v('cod')) w.push('Оплата частинами: гроші надходять від банку — з накладеним платежем покупець заплатить удруге.');
      if (p.paid && v('cod')) w.push('Замовлення вже оплачене — накладений платіж візьме гроші вдруге.');
      $('[data-warn]', f).innerHTML = w.length ? `<div class="alert warn small">${w.map(esc).join('<br>')}</div>` : '';
    };
    $$('input', f).forEach((i) => (i.oninput = warn));
    warn();
    go.disabled = !p.sender;
  };
  go.onclick = async () => {
    const v = (n) => f.querySelector(`[name=${n}]`)?.value ?? '';
    go.disabled = true;
    try {
      const r = await api('POST', '/api/mp/ttn/create', {
        account: o.account_id, id: o.id, carrier: p.carrier, weight: v('weight'), length: v('length'), width: v('width'), height: v('height'), places: v('places'),
        description: v('description'), declared: v('declared'), cod: v('cod'), payer: f.querySelector('[name=payer]:checked')?.value || 'sender', payment_control: Boolean(f.querySelector('[name=pc]')?.checked),
      });
      md.close();
      toast(`ТТН ${r.ttn} створено${r.price ? ` · доставка ${uah(r.price)}` : ''}`);
      done?.(r);
    } catch (er) { toast(er.message, true); go.disabled = false; }
  };
  load();
}
