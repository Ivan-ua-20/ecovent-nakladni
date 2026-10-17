// Довідники: ФОПи накладних і рахунків (реквізити — лише власник і адміни), відділи і «Поле 1», шаблони.
import { renderInvoice, esc, LAYOUT_NAMES, DEFAULT_OPTIONS } from '../invoice.js';
import { $, $$, main, MASK, api, setPending, toast, modal, confirmDanger, fmtDateTime, readImage, printHtml, todayKyiv } from '../core/ui.js';

export function createRefsPages(ctx) {
  const { can, loadBoot, activeFops, fopById, tplById } = ctx;

async function viewFops(id) {
  await loadBoot();
  if (id) return viewFopForm(id);
  const officeCount = (fid) => ctx.boot.offices.filter((o) => String(o.fop_id) === String(fid)).length;
  main.innerHTML = `
    <div class="head-row"><h2>ФОПи</h2>${can('requisites') ? '<a class="btn primary" href="#/fops/new">+ Додати ФОП</a>' : ''}</div>
    <div class="fop-cards">
      ${ctx.boot.fops.map((f) => {
        const filled = f.full_name && f.ipn && f.iban;
        return `<a class="card fop-card ${f.active ? '' : 'inactive'}" href="#/fops/${f.id}" style="text-decoration:none;color:inherit">
          <div class="name">${esc(f.short_name)}</div>
          <div class="muted small">${esc(f.full_name || 'ПІБ не вказано')}${f.ipn ? ' · ІПН ' + esc(f.ipn) : ''}</div>
          <div class="tags">
            ${filled ? '<span class="badge ok">реквізити є</span>' : '<span class="badge warn">заповніть реквізити</span>'}
            ${f.has_checkbox ? '<span class="badge ok">Checkbox</span>' : '<span class="badge">без Checkbox</span>'}
            <span class="badge">${officeCount(f.id)} відд.</span>
            ${f.active ? '' : '<span class="badge bad">вимкнено</span>'}
          </div>
        </a>`;
      }).join('')}
    </div>`;
}

function imgField(key, label, value, hint, locked = false) {
  return `<label class="f"><span>${label}</span>
    <div class="img-field">
      <div class="img-prev" id="prev_${key}">${value ? `<img src="${esc(value)}">` : '<span class="small muted">немає</span>'}</div>
      ${locked ? '' : `<div class="btn-row">
        <label class="btn sm">Завантажити<input type="file" accept="image/*" data-img="${key}" hidden></label>
        <button type="button" class="btn sm danger" data-clear="${key}">Прибрати</button>
      </div>`}
    </div>
    <span class="small muted" style="font-weight:400">${hint}</span></label>`;
}

// Реквізити ФОП (IBAN, ІПН, назва, адреса, підпис, печатка) змінюють лише власник і адміни — сервер перевіряє те саме.
const FOP_REQ = ['short_name', 'full_name', 'ipn', 'address', 'iban', 'bank', 'phone', 'email', 'extra', 'logo', 'signature', 'stamp'];
const INV_FOP_REQ = ['short_name', 'full_name', 'ipn', 'iban', 'bank', 'address', 'phone', 'warning_text', 'signature', 'stamp'];
const REQ_NOTE = '<div class="alert">Реквізити ФОП змінюють лише власник і адміністратори. Вам доступні шаблон і активність.</div>';
const dropLocked = (data, fields) => { if (!can('requisites')) for (const k of fields) delete data[k]; return data; };
const FIELD_NAMES = { short_name: 'Коротка назва', full_name: 'Назва / ПІБ', ipn: 'ІПН', address: 'Адреса', iban: 'IBAN', bank: 'Банк', phone: 'Телефон',
  email: 'E-mail', extra: 'Додатковий рядок', logo: 'Логотип', signature: 'Підпис', stamp: 'Печатка', warning_text: 'Попередження' };

// Журнал змін реквізитів (видно власнику й адмінам).
async function auditCard(kind, refId, el) {
  if (!can('users') || !el) return;
  try {
    const rows = await api('GET', `/api/audit?kind=${kind}&ref=${encodeURIComponent(refId)}`);
    el.innerHTML = `<h3>Зміни реквізитів</h3>${rows.length ? rows.slice(0, 20).map((r) => `<div class="small" style="margin-bottom:8px"><b>${esc(fmtDateTime(r.at))}</b> · ${esc(r.user_name || '—')} · ${esc(r.action)}
      ${r.changes.map((x) => `<div class="muted">${esc(FIELD_NAMES[x.field] || x.field)}: ${esc(x.from || '—')} → ${esc(x.to || '—')}</div>`).join('')}</div>`).join('') : '<div class="small muted">Змін ще не було</div>'}`;
    el.hidden = false;
  } catch { /* журнал необов'язковий */ }
}

function viewFopForm(id) {
  const isNew = id === 'new';
  const f = isNew ? { active: 1, template_id: ctx.boot.templates[0]?.id } : fopById(id);
  if (!f) throw new Error('ФОП не знайдено');
  const imgs = { logo: f.logo || '', signature: f.signature || '', stamp: f.stamp || '' };
  const locked = !can('requisites');
  const off = (k) => (locked && FOP_REQ.includes(k) ? 'disabled' : '');
  const inp = (k, label, ph = '', type = 'text') => `<label class="f"><span>${label}</span><input type="${type}" name="${k}" value="${esc(f[k] ?? '')}" placeholder="${esc(ph)}" ${off(k)}></label>`;
  main.innerHTML = `
    <div class="head-row"><h2>${isNew ? 'Новий ФОП' : esc(f.short_name)}</h2>
      <div class="btn-row"><a class="btn" href="#/fops">← До списку</a></div></div>
    <form id="fopForm" class="form-page">
      <div class="form-stack">
        <div class="card form-stack">
          <h3>Реквізити</h3>
          ${locked ? REQ_NOTE : ''}
          ${inp('short_name', 'Коротка назва (у списку)', 'ФОП Агафіца А.М.')}
          ${inp('full_name', 'ПІБ повністю', 'Агафіца Анна Миколаївна')}
          <div class="grid2">${inp('ipn', 'ІПН (РНОКПП)', '1234567890')}${inp('phone', 'Телефон', '+380…')}</div>
          ${inp('address', 'Адреса')}
          <div class="grid2">${inp('iban', 'IBAN', 'UA…')}${inp('bank', 'Банк', 'АТ «…»')}</div>
          ${inp('email', 'E-mail')}
          <label class="f"><span>Додатковий рядок у реквізитах</span><textarea name="extra" placeholder="Напр.: Платник єдиного податку 3 групи" ${off('extra')}>${esc(f.extra || '')}</textarea></label>
        </div>
        <div class="card form-stack">
          <h3>Накладна</h3>
          <label class="f"><span>Шаблон за замовчуванням</span><select name="template_id">
            ${ctx.boot.templates.map((t) => `<option value="${t.id}" ${String(f.template_id) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select></label>
          ${imgField('logo', 'Логотип', imgs.logo, 'Показується в брендованому шаблоні.', locked)}
          ${imgField('signature', 'Підпис', imgs.signature, 'PNG з прозорим фоном виглядає найкраще.', locked)}
          ${imgField('stamp', 'Печатка', imgs.stamp, 'Необов’язково.', locked)}
          <label class="check"><input type="checkbox" name="active" ${f.active ? 'checked' : ''}> Активний (показувати у виборі)</label>
        </div>
      </div>
      <div class="form-stack">
        ${can('api') ? `<div class="card form-stack">
          <h3>Доступ до Checkbox</h3>
          <div class="muted small">Потрібен, щоб знаходити чеки цього ФОП і визначати ФОП автоматично. Вкажіть логін і пароль касира <b>або</b> ключ ліцензії каси і PIN касира.</div>
          <div class="grid2">${inp('checkbox_login', 'Логін касира')}${inp('checkbox_password', 'Пароль касира', '', 'password')}</div>
          <div class="grid2">${inp('checkbox_license', 'Ключ ліцензії каси', '', 'password')}${inp('checkbox_pin', 'PIN касира', '', 'password')}</div>
          <div class="btn-row">${isNew ? '' : '<button type="button" class="btn sm" id="cbTest">Перевірити підключення</button>'}<span id="cbRes" class="small"></span></div>
        </div>` : ''}
        <div class="card form-stack">
          <h3>Відділи LP-CRM цього ФОП</h3>
          <div class="small">${ctx.boot.offices.filter((o) => String(o.fop_id) === String(f.id)).map((o) => `<div>${esc(o.office_id)} · ${esc(o.name)}</div>`).join('') || '<span class="muted">Немає</span>'}</div>
          <a class="small" href="#/offices">Змінити прив’язку відділів</a>
        </div>
        <div class="card form-stack" id="fopAudit" hidden></div>
        <div class="btn-row">
          <button class="btn primary">Зберегти</button>
          ${isNew ? '' : '<button type="button" class="btn danger" id="fopOff">Вимкнути ФОП</button>'}
        </div>
      </div>
    </form>`;

  const form = $('#fopForm');
  $$('[data-img]', form).forEach((input) => (input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const key = input.dataset.img;
    imgs[key] = await readImage(file, key === 'stamp' ? 500 : 700);
    $(`#prev_${key}`).innerHTML = `<img src="${esc(imgs[key])}">`;
  }));
  $$('[data-clear]', form).forEach((b) => (b.onclick = () => {
    imgs[b.dataset.clear] = '';
    $(`#prev_${b.dataset.clear}`).innerHTML = '<span class="small muted">немає</span>';
  }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.active = form.active.checked ? 1 : 0;
    Object.assign(data, imgs);
    dropLocked(data, FOP_REQ);
    try {
      if (isNew) {
        const r = await api('POST', '/api/fops', data);
        toast('ФОП додано');
        location.hash = `#/fops/${r.id}`;
      } else {
        await api('PUT', `/api/fops/${id}`, data);
        toast('Збережено');
        await viewFops(id);
      }
    } catch (err) { toast(err.message, true); }
  };
  $('#cbTest') && ($('#cbTest').onclick = async () => {
    $('#cbRes').innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api('POST', `/api/fops/${id}/checkbox-test`);
      $('#cbRes').innerHTML = `<span class="badge ok">OK</span> ${esc(r.organization)} · ${esc(r.cashier)}`;
    } catch (err) { $('#cbRes').innerHTML = `<span class="badge bad">помилка</span> ${esc(err.message)}`; }
  });
  if (!isNew) auditCard('fop', id, $('#fopAudit'));
  $('#fopOff') && ($('#fopOff').onclick = async () => {
    await api('PUT', `/api/fops/${id}`, { active: 0 });
    toast('ФОП вимкнено');
    location.hash = '#/fops';
  });
}

// =====================================================================
// ВІДДІЛИ
// =====================================================================
async function viewOffices() {
  await loadBoot();
  const opts = (sel) => `<option value="">— не визначено —</option>${activeFops().map((f) => `<option value="${f.id}" ${String(sel) === String(f.id) ? 'selected' : ''}>${esc(f.short_name)}</option>`).join('')}`;
  const row = (o = {}) => `<tr>
    <td><input data-k="office_id" value="${esc(o.office_id || '')}" style="width:70px"></td>
    <td><input data-k="name" value="${esc(o.name || '')}"></td>
    <td><select data-k="fop_id">${opts(o.fop_id)}</select></td>
    <td><textarea data-k="seller_text" rows="1" placeholder="як у ФОП" style="min-height:34px;padding:6px 8px">${esc(o.seller_text || '')}</textarea></td>
    <td><button class="btn sm danger" data-del="${esc(o.office_id || '')}">✕</button></td></tr>`;
  const chRow = (c = {}) => `<tr>
    <td><input data-k="name" value="${esc(c.name || '')}" placeholder="Напр. Rozetka(oneday)"></td>
    <td><select data-k="fop_id">${opts(c.fop_id)}</select></td>
    <td><textarea data-k="seller_text" rows="1" placeholder="як у ФОП" style="min-height:34px;padding:6px 8px">${esc(c.seller_text || '')}</textarea></td>
    <td><button class="btn sm danger" data-chdel>✕</button></td></tr>`;
  main.innerHTML = `
    <div class="head-row"><h2>Відділи і поле 1 → ФОП</h2>
      <div class="btn-row"><button class="btn primary" id="oSave">Зберегти все</button></div></div>
    <div class="alert info" style="margin-bottom:14px">Порядок визначення ФОП: вибір вручну → чек Checkbox → <b>поле 1</b> → <b>відділ</b> → ФОП за замовчуванням.<br>
      <b>Назва продавця в накладній</b> — повний текст замість «ФОП Прізвище І.П.» (можна кілька рядків), напр. «ФОП Лупу Віра Федорівна, інтернет-магазин OneDay». Реквізити (ІПН, IBAN) підставляються з картки ФОП. Порожньо — як у ФОП.</div>
    <div class="form-page" style="grid-template-columns:minmax(0,1fr)">
      <div style="min-width:0">
        <div class="head-row"><h3 style="margin:0">Додаткове поле 1 (канал)</h3><button class="btn sm" id="chAdd">+ Значення</button></div>
        <div class="muted small" style="margin-bottom:8px">Текст у полі 1 замовлення (наприклад «Rozetka(oneday)», «Prom(Amsterdam)»). Регістр не важливий.</div>
        <table class="list"><thead><tr><th>Значення поля 1</th><th>ФОП</th><th>Назва продавця в накладній</th><th></th></tr></thead>
        <tbody id="chBody">${ctx.boot.channels.map(chRow).join('')}</tbody></table>
      </div>
      <div style="min-width:0">
        <div class="head-row"><h3 style="margin:0">Відділи LP-CRM</h3><button class="btn sm" id="oAdd">+ Відділ</button></div>
        <div class="muted small" style="margin-bottom:8px">Використовується, якщо поле 1 порожнє або не прив'язане.</div>
        <table class="list"><thead><tr><th>ID</th><th>Назва відділу</th><th>ФОП</th><th>Назва продавця в накладній</th><th></th></tr></thead>
        <tbody id="oBody">${ctx.boot.offices.map(row).join('')}</tbody></table>
      </div>
    </div>`;
  $('#oAdd').onclick = () => $('#oBody').insertAdjacentHTML('beforeend', row());
  $('#chAdd').onclick = () => $('#chBody').insertAdjacentHTML('afterbegin', chRow());
  $('#chBody').addEventListener('click', (e) => { if (e.target.closest('[data-chdel]')) e.target.closest('tr').remove(); });
  $('#oBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (b.dataset.del) {
      const name = b.closest('tr').querySelector('[data-k=name]')?.value || '';
      if (!(await confirmDanger(`Видалити відділ ${b.dataset.del}${name ? ` «${name}»` : ''}?`, 'Відділ зникне з довідника. Накладні, які вже сформовано, не зміняться.', 'Видалити відділ'))) return;
      try { await api('DELETE', `/api/offices/${encodeURIComponent(b.dataset.del)}`); } catch (er) { toast(er.message, true); return; }
    }
    b.closest('tr').remove();
  });
  $('#oSave').onclick = async () => {
    const read = (sel) => $$(sel + ' tr').map((tr) => Object.fromEntries($$('[data-k]', tr).map((i) => [i.dataset.k, i.value])));
    try {
      await api('PUT', '/api/offices', read('#oBody'));
      await api('PUT', '/api/channels', read('#chBody'));
      toast('Збережено');
      await viewOffices();
    } catch (e) { toast(e.message, true); }
  };
}

// =====================================================================
// ШАБЛОНИ
// =====================================================================
const DEMO_INV = (fop, template) => ({
  order: {
    orderId: '12345', date: new Date().toISOString(),
    buyer: { name: 'Коваленко Олена Петрівна', phone: '380671234567' },
    delivery: { method: 'Нова Пошта', address: 'м. Київ, Відділення №12', ttn: '20450912345678' },
    payment: 'Післяплата NovaPay',
    items: [
      { name: 'Рекуператор Ecovent VS-60 Pro', article: 'EV-VS60', unit: 'шт', qty: 1, price: 6450, sum: 6450 },
      { name: 'Зовнішня решітка, біла', article: 'EV-GR100', unit: 'шт', qty: 2, price: 390, sum: 780 },
    ],
    itemsTotal: 7230, discount: 0, deliveryCost: 0, total: 7230,
  },
  fop,
  template,
});

async function viewTemplates(id) {
  await loadBoot();
  if (id) return viewTemplateForm(id);
  main.innerHTML = `
    <div class="head-row"><h2>Шаблони накладних</h2><button class="btn primary" id="tNew">+ Новий шаблон</button></div>
    <table class="list"><thead><tr><th>Назва</th><th>Макет</th><th>Заголовок</th><th>ФОПів</th></tr></thead><tbody>
      ${ctx.boot.templates.map((t) => `<tr class="click" data-t="${t.id}"><td><b>${esc(t.name)}</b></td><td>${esc(LAYOUT_NAMES[t.layout] || t.layout)}</td><td>${esc(t.options.title || '')}</td><td>${ctx.boot.fops.filter((f) => f.active && String(f.template_id) === String(t.id)).length}</td></tr>`).join('')}
    </tbody></table>`;
  $$('[data-t]').forEach((tr) => (tr.onclick = () => (location.hash = `#/templates/${tr.dataset.t}`)));
  $('#tNew').onclick = async () => {
    const r = await api('POST', '/api/templates', { name: 'Новий шаблон', layout: 'classic', options: { ...DEFAULT_OPTIONS } });
    location.hash = `#/templates/${r.id}`;
  };
}

function viewTemplateForm(id) {
  const t = tplById(id);
  if (!t) throw new Error('Шаблон не знайдено');
  const o = { ...DEFAULT_OPTIONS, ...t.options };
  const chk = (k, label) => `<label class="check"><input type="checkbox" name="${k}" ${o[k] ? 'checked' : ''}> ${label}</label>`;
  main.innerHTML = `
    <div class="head-row"><h2>${esc(t.name)}</h2>
      <div class="btn-row"><a class="btn" href="#/templates">← До списку</a><button class="btn" id="tCopy">Копіювати</button><button class="btn danger" id="tDel">Видалити</button></div></div>
    <div class="form-page">
      <form id="tplForm" class="card form-stack">
        <label class="f"><span>Назва шаблону</span><input name="name" value="${esc(t.name)}"></label>
        <div class="grid2">
          <label class="f"><span>Макет</span><select name="layout">${Object.entries(LAYOUT_NAMES).map(([k, v]) => `<option value="${k}" ${t.layout === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="f"><span>Колір акценту</span><input type="color" name="accent" value="${esc(o.accent)}" style="height:38px;padding:3px"></label>
        </div>
        <div class="grid2">
          <label class="f"><span>Назва документа</span><input name="title" value="${esc(o.title)}"></label>
          <label class="f"><span>Примітка про ПДВ</span><input name="vatNote" value="${esc(o.vatNote)}" placeholder="Без ПДВ"></label>
        </div>
        <label class="f"><span>Текст над документом</span><input name="headerText" value="${esc(o.headerText)}" placeholder="Необов’язково"></label>
        <label class="f"><span>Текст унизу (гарантія, повернення тощо)</span><textarea name="footerText" rows="3">${esc(o.footerText)}</textarea></label>
        <div class="grid2">
          ${chk('showArticle', 'Колонка «Артикул»')}
          ${chk('showUnit', 'Колонка «Од.»')}
          ${chk('showDelivery', 'Доставка і ТТН')}
          ${chk('showPayment', 'Спосіб оплати')}
          ${chk('showSignatures', 'Блок підписів')}
          ${chk('showStamp', 'Печатка ФОП')}
        </div>
        <label class="f" style="max-width:200px"><span>Копій на друк</span><select name="copies">${[1, 2, 3].map((n) => `<option ${Number(o.copies) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="f"><span>Перегляд з реквізитами ФОП</span><select id="tFop">${activeFops().map((f) => `<option value="${f.id}" ${String(f.template_id) === String(t.id) ? 'selected' : ''}>${esc(f.short_name)}</option>`).join('')}</select></label>
        <div class="btn-row"><button class="btn primary">Зберегти шаблон</button></div>
      </form>
      <div class="tpl-preview-wrap card" style="padding:12px;background:#eef0ef"><div class="tpl-preview" id="tPrev"></div></div>
    </div>`;

  const form = $('#tplForm');
  const read = () => {
    const d = Object.fromEntries(new FormData(form));
    const options = {
      title: d.title, accent: d.accent, vatNote: d.vatNote, headerText: d.headerText, footerText: d.footerText,
      copies: Number(d.copies) || 1,
    };
    for (const k of ['showArticle', 'showUnit', 'showDelivery', 'showPayment', 'showSignatures', 'showStamp']) options[k] = form[k].checked;
    return { name: d.name, layout: d.layout, options };
  };
  const preview = async () => {
    const tpl = read();
    const fid = $('#tFop').value;
    let fop = fid ? fopById(fid) : null;
    const prev = $('#tPrev');
    prev.innerHTML = renderInvoice(DEMO_INV(fop || { short_name: 'ФОП Приклад' }, { ...tpl, options: { ...tpl.options, copies: 1 } }));
    const wrap = prev.parentElement;
    const k = Math.min(1, (wrap.clientWidth - 24) / prev.firstElementChild.offsetWidth);
    prev.style.transform = `scale(${k})`;
    wrap.style.height = `${prev.firstElementChild.offsetHeight * k + 24}px`;
  };
  form.addEventListener('input', preview);
  $('#tFop').addEventListener('change', preview);
  window.addEventListener('resize', preview, { once: true });
  preview();
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PUT', `/api/templates/${id}`, read()); toast('Шаблон збережено'); await loadBoot(); } catch (err) { toast(err.message, true); }
  };
  $('#tCopy').onclick = async () => {
    const d = read();
    const r = await api('POST', '/api/templates', { ...d, name: `${d.name} (копія)` });
    location.hash = `#/templates/${r.id}`;
  };
  $('#tDel').onclick = async () => {
    if (!(await confirmDanger(`Видалити шаблон «${t.name}»?`, 'Шаблон зникне зі списку. Уже збережені версії накладних не зміняться.', 'Видалити шаблон'))) return;
    try { await api('DELETE', `/api/templates/${id}`); toast('Видалено'); location.hash = '#/templates'; } catch (err) { toast(err.message, true); }
  };
}


async function viewInvFops(id) {
  await loadBoot();
  if (id) return invFopForm(id);
  main.innerHTML = `
    <div class="head-row"><h2>ФОПи для рахунків</h2>${can('users') ? '<a class="btn primary" href="#/invfops/new">+ Додати ФОП</a>' : ''}</div>
    <div class="muted small" style="margin-bottom:12px">Окремий список від ФОПів накладних. Від цих ФОПів виставляються рахунки на оплату. ФОП, увімкнені в Opendatabot (у «Налаштуваннях рахунків»), додаються сюди автоматично — доповніть їхні реквізити для Word.</div>
    ${ctx.boot.invFops.length ? `<div class="fop-cards">${ctx.boot.invFops.map((f) => {
      const ok = f.full_name && f.ipn && f.iban && f.bank && f.address;
      return `<a class="card fop-card ${f.active ? '' : 'inactive'}" href="#/invfops/${f.id}" style="text-decoration:none;color:inherit">
        <div class="name">${esc(f.short_name)}</div>
        <div class="muted small">${esc(f.full_name || 'Повну назву не вказано')}</div>
        <div class="tags">${ok ? '<span class="badge ok">реквізити є</span>' : '<span class="badge warn">заповніть реквізити</span>'}
          ${f.signature ? '<span class="badge">підпис</span>' : ''}${f.stamp ? '<span class="badge">печатка</span>' : ''}
          ${f.odb_id ? '<span class="badge info">Opendatabot · QR</span>' : ''}${f.active ? '' : '<span class="badge bad">вимкнено</span>'}</div></a>`;
    }).join('')}</div>` : `<div class="card empty"><div class="big">Ще немає ФОПів для рахунків</div>Від цих ФОПів виставляються рахунки на оплату.${can('users') ? '<div class="btn-row" style="justify-content:center;margin-top:12px"><a class="btn primary" href="#/invfops/new">Додати ФОП</a></div>' : ''}</div>`}`;
}

function invFopForm(id) {
  const isNew = id === 'new';
  const f = isNew ? { active: 1, warning_text: ctx.boot.defaultWarning } : ctx.boot.invFops.find((x) => String(x.id) === String(id));
  if (!f) throw new Error('ФОП не знайдено');
  const imgs = { signature: f.signature || '', stamp: f.stamp || '' };
  const locked = !can('requisites');
  const off = (k) => (locked && INV_FOP_REQ.includes(k) ? 'disabled' : '');
  const inp = (k, label, ph = '') => `<label class="f"><span>${label}</span><input name="${k}" value="${esc(f[k] ?? '')}" placeholder="${esc(ph)}" ${off(k)}></label>`;
  main.innerHTML = `
    <div class="head-row"><h2>${isNew ? 'Новий ФОП для рахунків' : esc(f.short_name)}</h2><a class="btn" href="#/invfops">← До списку</a></div>
    <form id="ifForm" class="form-page">
      <div class="card form-stack">
        <h3>Реквізити</h3>
        ${locked ? REQ_NOTE : ''}
        ${inp('short_name', 'Коротка назва (у списку)', 'ФОП Лупу В.Ф.')}
        ${inp('full_name', 'Повна назва в рахунку', 'ФОП Лупу Віра Філаретівна')}
        <div class="grid2">${inp('ipn', 'ІПН (РНОКПП)', '1234567890')}${inp('phone', 'Телефон (необов’язково)', '+380…')}</div>
        ${inp('iban', 'IBAN', 'UA…')}
        ${inp('bank', 'Банк', 'АТ КБ «ПриватБанк»')}
        <label class="f"><span>Адреса реєстрації</span><textarea name="address" rows="2" ${off('address')} placeholder="Україна, 58018, Чернівецька обл., м. Чернівці, вул. …">${esc(f.address || '')}</textarea></label>
      </div>
      <div class="form-stack">
        <div class="card form-stack">
          <h3>Рахунок</h3>
          <label class="f"><span>Текст попередження над рахунком</span><textarea name="warning_text" rows="4" ${off('warning_text')}>${esc(f.warning_text || '')}</textarea></label>
          ${imgField('signature', 'Підпис', imgs.signature, 'PNG з прозорим фоном виглядає найкраще.', locked)}
          ${imgField('stamp', 'Печатка', imgs.stamp, 'Необов’язково.', locked)}
          <label class="check"><input type="checkbox" name="active" ${f.active ? 'checked' : ''}> Активний (показувати у виборі)</label>
        </div>
        <div class="card form-stack" id="ifAudit" hidden></div>
        <div class="btn-row"><button class="btn primary">Зберегти</button>${!isNew && !f.odb_id && can('users') ? '<button type="button" class="btn danger" id="ifDel" style="margin-left:auto">Видалити ФОП</button>' : ''}</div>
        ${f.odb_id ? '<div class="small muted">Цей ФОП додано з Opendatabot. Назву можна змінити тут; щоб прибрати його зі списку — вимкніть рахунок у «Налаштуваннях рахунків».</div>' : ''}
      </div>
    </form>`;
  const form = $('#ifForm');
  $$('[data-img]', form).forEach((input) => (input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    imgs[input.dataset.img] = await readImage(file, input.dataset.img === 'stamp' ? 500 : 700);
    $(`#prev_${input.dataset.img}`).innerHTML = `<img src="${esc(imgs[input.dataset.img])}">`;
  }));
  $$('[data-clear]', form).forEach((b) => (b.onclick = () => { imgs[b.dataset.clear] = ''; $(`#prev_${b.dataset.clear}`).innerHTML = '<span class="small muted">немає</span>'; }));
  if (!isNew) auditCard('inv_fop', id, $('#ifAudit'));
  const del = $('#ifDel');
  if (del) del.onclick = () => {
    const m = modal(`Видалити ФОП «${f.short_name}»?`, `<p>ФОП «${esc(f.short_name)}» зникне зі списку. Уже сформовані рахунки збережуться без змін.</p>`,
      { footer: '<button class="btn" data-close id="ifDelNo">Скасувати</button><button class="btn danger solid" id="ifDelGo">Видалити ФОП</button>', focus: '#ifDelNo' });
    $('#ifDelGo', m.el).onclick = async () => {
      try { await api('DELETE', `/api/inv-fops/${id}`); m.close(); toast('ФОП видалено'); await loadBoot(); location.hash = '#/invfops'; } catch (er) { toast(er.message, true); }
    };
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = dropLocked({ ...Object.fromEntries(new FormData(form)), ...imgs, active: form.active.checked ? 1 : 0 }, INV_FOP_REQ);
    try {
      if (isNew) { const r = await api('POST', '/api/inv-fops', d); toast('ФОП додано'); location.hash = `#/invfops/${r.id}`; }
      else { await api('PUT', `/api/inv-fops/${id}`, d); toast('Збережено'); await viewInvFops(id); }
    } catch (er) { toast(er.message, true); }
  };
}


  return { viewFops, viewOffices, viewTemplates, viewInvFops };
}
