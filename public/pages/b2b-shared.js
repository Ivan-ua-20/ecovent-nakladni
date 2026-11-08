// Спільне для сторінок B2B (адмін і партнер): статуси, суми, завантаження файлів.
import { esc, money } from '../invoice.js';
import { fmtDateTime as fmtDT, $, $$, api, toast, modal, confirmDanger } from '../core/ui.js';

export const uah = (n) => `${money(n)} грн`;
const ST_CLS = { confirm: 'warn', invoice_wait: 'warn', pay_wait: 'warn', partial: 'info', paid: 'ok', done: 'ok', cancelled: 'bad', new: 'warn', crm: 'info' };
export const statusBadge = (o) => `<span class="badge ${ST_CLS[o.status] || ''}">${esc(o.status_name || o.status)}</span>`;
// Замовлення клієнта: оплата (за закупівлею) і «без закупівлі».
const PAY_CLS = { paid: 'ok', partial: 'info', unpaid: 'warn' };
export const payBadge = (o) => (o.pay ? `<span class="badge ${PAY_CLS[o.pay] || ''}">${esc(o.pay_name || o.pay)}</span>` : '');
// «Терміново» (замовлення клієнта партнера): яскрава позначка і рядок; urgentRow — клас рядка (поверх «без закупівлі»).
export const urgentBadge = (o) => (o.urgent && o.status !== 'cancelled' ? '<span class="badge urgent">🔥 Терміново</span>' : '');
export const urgentRow = (o) => (o.urgent && o.status !== 'cancelled' ? 'row-urgent' : '');
export const supplyMark = (o) => (o.no_supply ? '<span class="badge bad">Без закупівлі</span>'
  : o.draft_supply ? `<span class="small muted">у чернетці ${esc(o.supply_number)}</span>` : `<span class="small muted">із ${esc(o.supply_number)}</span>`);
// Статус замовлення в LP-CRM кольором: зелений — доставлено/виконано, червоний — повернення/відмова, синій — в дорозі.
export const crmTone = (name) => {
  const n = String(name || '').toLowerCase();
  if (/возв|поверн|отказ|відмов|відказ|отмен|скасов|не забр|невикуп|невыкуп/.test(n)) return 'bad';
  if (/доставл|выполн|викон|получ|отрим|заверш|оплачен|оплачено|успіш|успеш|забра/.test(n)) return 'ok';
  if (/отправ|відправ|в пути|в дороз|в дорог|на відділ|на отдел|у відділ|в отдел|прибув|прибыл|ожида|очіку/.test(n)) return 'info';
  return '';
};
export const crmBadge = (name) => (name ? `<span class="badge ${crmTone(name)}">${esc(name)}</span>` : '');
export const crmCell = (o) => (o.crm_id ? `<b>№ ${esc(o.crm_id)}</b>${o.crm_status ? `<div>${crmBadge(o.crm_status)}</div>` : ''}`
  : (o.status === 'crm' ? crmBadge(o.crm_status || 'Передано') : '<span class="small muted">—</span>'));
// Фільтр за статусом LP-CRM (список статусів з кількістю приходить зі списку замовлень).
export const crmStatusSelect = (list, cur) => (list?.length ? `<select id="crmSt" aria-label="Статус у LP-CRM" style="max-width:240px"><option value="">Будь-який статус LP-CRM</option>
  ${list.map((x) => `<option value="${esc(x.name)}" ${cur === x.name ? 'selected' : ''}>${esc(x.name)} · ${x.n}</option>`).join('')}</select>` : '');
export const phoneFmt = (p) => (/^380\d{9}$/.test(p || '') ? `+${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : (p || ''));
export const historyCard = (history) => `<div class="card"><h3>Історія</h3>${history.map((h) => `<div class="small"><span class="muted">${esc(fmtDT(h.at))}</span> · ${esc(h.action)}${h.user_name ? ` <span class="muted">(${esc(h.user_name)})</span>` : ''}</div>`).join('')}</div>`;
export const fmtDay = (d) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');
export const fileSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

// Завантажити файл на сервер (тіло — сам файл, назва — у заголовку).
export async function uploadFile(url, file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Файл завеликий (до 5 МБ).');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Файл не завантажено.');
  return j;
}

// Позиції замовлення таблицею.
export function itemsTable(items, { rrp = false } = {}) {
  const total = items.reduce((t, i) => t + Math.round(i.price * i.qty * 100) / 100, 0);
  return `<table class="list"><thead><tr><th>Товар</th><th class="r">К-сть</th>${rrp ? '<th class="r hide-m">РРЦ</th>' : ''}<th class="r">Ціна</th><th class="r">Сума</th></tr></thead><tbody>
    ${items.map((i) => `<tr><td>${esc(i.name)}${i.article ? `<div class="small muted">${esc(i.article)}</div>` : ''}</td>
      <td class="r">${i.qty}</td>${rrp ? `<td class="r small muted hide-m">${money(i.rrp)}</td>` : ''}<td class="r">${money(i.price)}</td><td class="r"><b>${money(Math.round(i.price * i.qty * 100) / 100)}</b></td></tr>`).join('')}
    <tr><td colspan="${rrp ? 4 : 3}" class="r"><b>Разом (з ПДВ)</b></td><td class="r"><b>${uah(total)}</b></td></tr>
  </tbody></table>`;
}

// Команда партнера: таблиця користувачів (роль, хто додав) і форма — спільні для адміна й керівника партнера.
export const ROLE_HINT = {
  head: 'усе: каталог, закупівлі, замовлення клієнтів, юрособи і команда',
  staff: 'каталог, закупівлі, замовлення клієнтів, юрособи (без команди)',
  viewer: 'лише перегляд, без змін',
};
// Хто підключив Telegram-бота і який акаунт.
export const tgCell = (t) => (t?.connected
  ? `<span class="badge ok">✓ підключено</span><div>${esc(t.name || '')}</div>${t.at ? `<div class="muted">${esc(fmtDT(t.at))}</div>` : ''}`
  : '<span class="muted">не підключено</span>');
export function teamTable(users, { me = 0, showAdded = true, editable = true } = {}) {
  return `<table class="list"><thead><tr><th>Користувач</th><th>Роль</th><th class="hide-m">Telegram-бот</th>${showAdded ? '<th class="hide-m">Хто додав</th>' : ''}<th>Стан</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr>
      <td><b>${esc(u.login)}</b>${u.id === me ? ' <span class="small muted">(ви)</span>' : ''}<div class="small muted">${esc(u.name || '')}</div></td>
      <td class="small">${esc(u.partner_role_name || '')}</td>
      <td class="small hide-m">${tgCell(u.tg)}</td>
      ${showAdded ? `<td class="small hide-m">${u.added_by_partner ? `<span class="badge info">партнер</span> ${esc(u.added_by_name)}` : esc(u.added_by_name || 'Ековент')}
        <div class="muted">${esc(fmtDT(u.created_at))}</div></td>` : ''}
      <td>${u.active ? '<span class="badge ok">активний</span>' : '<span class="badge bad">вимкнений</span>'}</td>
      <td style="text-align:right">${editable ? `<button class="btn sm" data-ue="${u.id}">Змінити</button>` : ''}</td>
    </tr>`).join('')}</tbody></table>`;
}
export function teamFormHtml(u, roles, { self = false, defaultRole = 'staff' } = {}) {
  const isNew = !u;
  const role = u?.partner_role || (isNew ? defaultRole : 'head');
  return `<form id="puF" class="form-stack">
    ${isNew ? '<label class="f"><span>Логін (латиницею) *</span><input name="login" required autocomplete="off" placeholder="напр. olena.shop"></label>' : ''}
    <label class="f"><span>Ім’я</span><input name="name" value="${esc(u?.name || '')}"></label>
    <label class="f"><span>Роль</span><select name="partner_role" ${self ? 'disabled' : ''}>${Object.entries(roles).map(([k, v]) => `<option value="${k}" ${k === role ? 'selected' : ''}>${esc(v)} — ${esc(ROLE_HINT[k] || '')}</option>`).join('')}</select></label>
    <label class="f"><span>${isNew ? 'Пароль (від 6 символів) *' : 'Новий пароль (залиште порожнім, щоб не міняти)'}</span><input name="password" type="text" autocomplete="new-password" ${isNew ? 'required' : ''}></label>
    ${isNew || self ? '' : `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Активний (може входити)</label>`}
    ${isNew ? '<div class="small muted">Передайте логін і пароль колезі — входити на цьому ж сайті.</div>' : ''}
  </form>`;
}
export function teamFormData(form) {
  const d = Object.fromEntries(new FormData(form));
  if (form.active) d.active = form.active.checked;
  if (form.partner_role?.disabled) delete d.partner_role;
  if (!d.password) delete d.password;
  return d;
}

// ---------- фільтри списків: пошук, період, оплата ----------
export function filterBar(f, { pay = false, placeholder = '№, клієнт, телефон, ТТН…' } = {}) {
  return `<div class="btn-row" style="margin-bottom:12px;flex-wrap:wrap">
    <input id="fQ" type="search" value="${esc(f.q || '')}" placeholder="${esc(placeholder)}" aria-label="Пошук" style="max-width:260px">
    <input id="fFrom" type="date" value="${esc(f.from || '')}" aria-label="З дати" style="max-width:150px">
    <input id="fTo" type="date" value="${esc(f.to || '')}" aria-label="По дату" style="max-width:150px">
    ${pay ? `<select id="fPay" aria-label="Оплата" style="max-width:170px"><option value="">Будь-яка оплата</option><option value="paid" ${f.pay === 'paid' ? 'selected' : ''}>Оплачені</option><option value="unpaid" ${f.pay === 'unpaid' ? 'selected' : ''}>Не оплачені</option></select>` : ''}
    ${f.q || f.from || f.to || f.pay ? '<button class="btn sm" id="fReset">Скинути</button>' : ''}
  </div>`;
}
export function wireFilterBar(f, reload) {
  let t;
  const q = $('#fQ');
  if (f._focusQ) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => { f.q = q.value.trim(); f._focusQ = true; reload(); }, 450); };
  q.onblur = () => { f._focusQ = false; };
  $('#fFrom').onchange = (e) => { f.from = e.target.value; reload(); };
  $('#fTo').onchange = (e) => { f.to = e.target.value; reload(); };
  if ($('#fPay')) $('#fPay').onchange = (e) => { f.pay = e.target.value; reload(); };
  if ($('#fReset')) $('#fReset').onclick = () => { Object.assign(f, { q: '', from: '', to: '', pay: '' }); reload(); };
}
export const filterQs = (f) => new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !k.startsWith('_'))).toString();

// Обов'язковий коментар (напр., до «Оплачено» вручну): Promise<string|null> — null, якщо закрили.
export function askNote(title, text, { verb = 'Зберегти', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(title, `<div class="form-stack"><p style="margin:0">${text}</p>
        <label class="f"><span>Коментар (обов'язково)</span><textarea id="anTxt" rows="3" maxlength="500" placeholder="${esc(placeholder)}"></textarea></label></div>`, {
      footer: `<button class="btn" data-close>Скасувати</button><button class="btn primary" id="anOk">${esc(verb)}</button>`,
      focus: '#anTxt',
    });
    $('#anOk', m.el).onclick = () => {
      const v = $('#anTxt', m.el).value.trim();
      if (v.length < 3) { toast('Напишіть коментар — хоча б кілька слів', true); $('#anTxt', m.el).focus(); return; }
      done = true; m.close(); resolve(v);
    };
    new MutationObserver((_, obs) => { if (!document.contains(m.el)) { obs.disconnect(); if (!done) resolve(null); } }).observe(document.body, { childList: true });
  });
}
export const PAID_NOTE_HINT = 'Напр.: гарантійна заміна — товар повернуто, відправка з нашого складу; взаємозалік; оплата готівкою.';

// ---------- самовивіз: хто забирає зі складу ----------
export const pickupPhone = (ph) => { const d = String(ph || '').replace(/\D/g, ''); return d.length === 12 ? `+${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}` : d; };
export const pickupLine = (x) => (x ? `<b>${esc(x.name)}</b> · ${esc(pickupPhone(x.phone))}${x.note ? ` · ${esc(x.note)}` : ''}` : '');
// Вибір, хто забирає: кур'єр зі списку партнера або «інша людина» (вручну, з галочкою «зберегти в Кур'єри»).
// v — поточне значення (у закупівлі) або підказка; prefix — щоб на сторінці могло бути кілька форм.
export function pickupFields(v, prefix = 'pk', couriers = []) {
  const sel = v?.courier_id && couriers.some((k) => k.id === v.courier_id) ? String(v.courier_id) : v?.name ? '' : couriers[0] ? String(couriers[0].id) : '';
  const manual = sel ? null : v;
  return `<div class="form-stack" style="gap:8px" id="${prefix}Box">
    ${couriers.length ? `<label class="f"><span>Хто забирає</span><select id="${prefix}Sel">${couriers.map((k) => `<option value="${k.id}" ${String(k.id) === sel ? 'selected' : ''}>${esc(k.name)} · ${esc(pickupPhone(k.phone))}</option>`).join('')}
      <option value="" ${sel ? '' : 'selected'}>✍️ Інша людина — вписати</option></select></label>` : ''}
    <div id="${prefix}Man" class="form-stack" style="gap:8px" ${sel ? 'hidden' : ''}>
      <div class="grid2">
        <label class="f"><span>ПІБ (хто забирає)</span><input id="${prefix}Name" value="${esc(manual?.name || '')}" placeholder="Прізвище Ім’я" autocomplete="off"></label>
        <label class="f"><span>Телефон</span><input id="${prefix}Phone" value="${esc(manual?.phone ? pickupPhone(manual.phone) : '')}" inputmode="tel" placeholder="067 123 45 67" autocomplete="off"></label></div>
      <label class="check small"><input type="checkbox" id="${prefix}Save" checked> Зберегти в «Кур’єри» — наступного разу просто обрати зі списку</label>
    </div>
    <label class="f"><span>Примітка (необов’язково): авто, номер, коли приїде</span><input id="${prefix}Note" value="${esc(v?.note || '')}" placeholder="напр. VW Caddy АА1234ВВ, у четвер після 14:00"></label>
  </div>`;
}
export function wirePickupFields(root = document, prefix = 'pk') {
  const s = $(`#${prefix}Sel`, root);
  if (s) s.onchange = () => { $(`#${prefix}Man`, root).hidden = Boolean(s.value); };
}
export function pickupRead(root = document, prefix = 'pk') {
  const sel = $(`#${prefix}Sel`, root)?.value;
  const note = $(`#${prefix}Note`, root)?.value.trim() || '';
  if (sel) return { courier_id: Number(sel), note };
  return { name: $(`#${prefix}Name`, root)?.value.trim() || '', phone: $(`#${prefix}Phone`, root)?.value.trim() || '', note, save: Boolean($(`#${prefix}Save`, root)?.checked) };
}
// Картка «Хто забирає» в закупівлі (і в нас, і в партнера): показ + «Змінити» (вікно) або одразу форма, якщо ще не вказано.
export function pickupCard(o, { editable = true, partner = false, couriers = [] } = {}) {
  const x = o.pickup_by;
  return `<div class="card form-stack" id="pkCard"><h3>🚗 Хто забирає зі складу</h3>
    ${x ? `<div>${pickupLine(x)}</div>${editable ? '<div class="btn-row"><button class="btn sm" id="pkEdit">Змінити</button></div>' : ''}`
      : editable ? `<div class="small ${partner ? '' : 'muted'}">${partner ? 'Вкажіть, хто приїде забирати товар (ваш менеджер, кур’єр, водій) — склад підготує закупівлю на цю людину.' : 'Партнер ще не вказав, хто забирає. Можна вписати самим.'}</div>
        ${pickupFields(o.pickup_last || null, 'pkF', couriers)}<div class="btn-row"><button class="btn primary" id="pkSave">Зберегти</button></div>`
        : '<div class="small muted">Ще не вказано.</div>'}
  </div>`;
}
export function wirePickupCard(o, url, onDone, couriers = []) {
  const save = async (v, btn) => {
    if (btn) btn.disabled = true;
    try { await api('PUT', url, v); toast('Збережено — склад знатиме, хто приїде'); onDone(); return true; } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; return false; }
  };
  const sv = $('#pkSave');
  if (sv) { wirePickupFields(document, 'pkF'); sv.onclick = () => save(pickupRead(document, 'pkF'), sv); }
  const ed = $('#pkEdit');
  if (ed) ed.onclick = () => {
    const m = modal('Хто забирає зі складу', `<div class="form-stack">${pickupFields(o.pickup_by, 'pkM', couriers)}${o.crm_id || o.crm_ext ? '<div class="small muted">Закупівля вже на складі — менеджер отримає сповіщення й оновить дані.</div>' : ''}</div>`,
      { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="pkMSave">Зберегти</button>' });
    wirePickupFields(m.el, 'pkM');
    $('#pkMSave', m.el).onclick = async (e) => { if (await save(pickupRead(m.el, 'pkM'), e.currentTarget)) m.close(); };
  };
}

// ---------- галочки і масові дії ----------
export const selCell = (id) => `<td style="width:34px" data-nosel><input type="checkbox" data-sel="${id}" aria-label="Обрати"></td>`;
export const selHead = () => '<th style="width:34px"><input type="checkbox" id="selAll" aria-label="Обрати всі"></th>';
// actions: [{ key, label, danger?, confirm?: (n) => текст, ask?: (n) => { title, text } — спершу спитати коментар, run: (id, note) => Promise }]
export function wireBulk(actions, { onDone, confirmDanger }) {
  const bar = $('#bulkBar');
  const sel = () => $$('[data-sel]').filter((x) => x.checked).map((x) => Number(x.dataset.sel));
  const draw = () => {
    const ids = sel();
    bar.hidden = !ids.length;
    bar.innerHTML = ids.length ? `<b>Обрано: ${ids.length}</b>${actions.map((a) => `<button class="btn sm ${a.danger ? 'danger' : ''}" data-bulk="${a.key}">${esc(a.label)}</button>`).join('')}
      <button class="btn sm" data-bulk="_clear">Зняти вибір</button>` : '';
    $$('[data-bulk]', bar).forEach((b) => (b.onclick = () => run(b.dataset.bulk)));
  };
  $$('[data-nosel]').forEach((td) => (td.onclick = (e) => e.stopPropagation()));
  $$('[data-sel]').forEach((cb) => (cb.onchange = draw));
  const all = $('#selAll');
  // «Обрати всі» — лише видимі рядки (довгі таблиці показують частину, див. «Показати ще»)
  if (all) all.onchange = () => { $$('[data-sel]').filter((x) => x.offsetParent).forEach((x) => { x.checked = all.checked; }); draw(); };
  async function run(key) {
    if (key === '_clear') { $$('[data-sel]').forEach((x) => { x.checked = false; }); if (all) all.checked = false; draw(); return; }
    const a = actions.find((x) => x.key === key);
    const ids = sel();
    if (a.confirm && !(await confirmDanger(a.confirm(ids.length), '', a.label))) return;
    let note;
    if (a.ask) { const q = a.ask(ids.length); note = await askNote(q.title, q.text, { verb: a.label, placeholder: q.placeholder || '' }); if (note === null) return; }
    const fails = [];
    let ok = 0;
    bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    for (const [n, id] of ids.entries()) {
      bar.querySelector('b').textContent = `${a.label}: ${n + 1} з ${ids.length}…`;
      try { await a.run(id, note); ok++; } catch (e) { fails.push(`B2B-${id}: ${e.message}`); }
    }
    toast(`${a.label}: виконано ${ok} з ${ids.length}`, fails.length > 0);
    if (fails.length) modal('Не вдалося для частини замовлень', `<div class="form-stack small">${fails.map((x) => `<div>${esc(x)}</div>`).join('')}</div>`, { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
    onDone();
  }
  draw();
}
export const bulkBar = () => '<div id="bulkBar" class="btn-row card" hidden style="position:sticky;top:8px;z-index:5;margin-bottom:10px;padding:8px 12px;flex-wrap:wrap;align-items:center"></div>';

// Статус доставки за ТТН (Нова пошта): кнопка в картці замовлення клієнта; url — /api/b2b/p/clients/:id/tracking або адмінський.
export const trackBtn = () => '<div class="trk"><button class="btn sm" type="button" data-track>Статус доставки</button><span class="small muted" data-track-out></span></div>';
export function wireTracking(url) {
  const b = $('[data-track]');
  if (!b) return;
  b.onclick = async () => {
    const out = $('[data-track-out]');
    b.disabled = true;
    out.textContent = 'Перевіряю в Новій пошті…';
    try {
      const t = await api('GET', url);
      out.innerHTML = t.status
        ? `<b>${esc(t.status)}</b>${t.warehouse ? ` · ${esc(t.city ? `${t.city}, ` : '')}${esc(t.warehouse)}` : ''}${t.received ? ` · отримано ${esc(t.received)}` : t.scheduled ? ` · очікувана доставка ${esc(t.scheduled)}` : ''}`
        : 'Нова пошта не знайшла цю ТТН.';
    } catch (e) { out.textContent = e.message; }
    b.disabled = false;
  };
}

// ---------- Фіди й таблиці партнера (довідкові посилання: XML-фід, Google-таблиця, прайс) ----------
export const FEED_KIND = { xml: 'XML-фід', gsheet: 'Google-таблиця', csv: 'CSV / Excel', other: 'Посилання' };
const FEED_ICON = { xml: '🧾', gsheet: '📊', csv: '📄', other: '🔗' };
const copyTo = async (text) => {
  try { await navigator.clipboard.writeText(text); toast('Посилання скопійовано'); } catch { toast('Не вдалося скопіювати — виділіть посилання вручну', true); }
};
// Список посилань. admin — з кнопками «Змінити» / «Прибрати» і позначкою «для всіх».
export function feedsList(list, { admin = false } = {}) {
  if (!list.length) return '<div class="small muted">Посилань ще немає.</div>';
  return `<div class="feed-list">${list.map((f) => `<div class="feed">
    <span class="feed-i" aria-hidden="true">${FEED_ICON[f.kind] || '🔗'}</span>
    <div class="feed-b"><div><b>${esc(f.title)}</b> <span class="small muted">· ${FEED_KIND[f.kind] || 'Посилання'}</span>${admin && !f.partner_id ? ' <span class="badge info">для всіх партнерів</span>' : ''}</div>
      <a class="feed-u small" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.url)}</a>
      ${f.note ? `<div class="small muted">${esc(f.note)}</div>` : ''}</div>
    <div class="btn-row feed-a"><button class="btn sm" data-fcopy="${f.id}">Копіювати</button><a class="btn sm" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Відкрити</a>
      ${admin ? `<button class="btn sm" data-fedit="${f.id}">Змінити</button><button class="btn sm danger" data-fdel="${f.id}" aria-label="Прибрати ${esc(f.title)}">✕</button>` : ''}</div>
  </div>`).join('')}</div>`;
}
export function wireFeedsList(root, list, { onEdit, onDel } = {}) {
  const byId = new Map(list.map((f) => [String(f.id), f]));
  $$('[data-fcopy]', root).forEach((b) => (b.onclick = () => copyTo(byId.get(b.dataset.fcopy).url)));
  $$('[data-fedit]', root).forEach((b) => (b.onclick = () => onEdit?.(byId.get(b.dataset.fedit))));
  $$('[data-fdel]', root).forEach((b) => (b.onclick = () => onDel?.(byId.get(b.dataset.fdel))));
}

// ---------- API-ключі партнера (публічне API v1) ----------
// box — контейнер картки; base — '/api/b2b/p/api-keys' (кабінет) або '/api/b2b/partners/:id/api-keys' (адмінка).
export async function apiKeysCard(box, base, { canEdit = true, admin = false } = {}) {
  const keys = await api('GET', base);
  const active = keys.filter((k) => !k.revoked_at);
  const when = (s) => (s ? fmtDT(s) : '—');
  box.innerHTML = `
    <div class="head-row" style="margin:0"><h3 style="margin:0">API для замовлень</h3>
      <div class="btn-row"><a class="btn sm" href="/api-docs.html" target="_blank" rel="noopener">📘 Документація</a>${canEdit && active.length < 5 ? '<button class="btn sm primary" id="akNew">+ Ключ</button>' : ''}</div></div>
    <div class="small muted">${admin ? 'Ключ дає програмісту партнера доступ до API: каталог із цінами партнера, створення й зміна замовлень клієнтів, маркування, статуси (зокрема з LP-CRM). Діє від імені керівника команди партнера.'
      : 'Підключіть свою CRM чи сайт: замовлення клієнтів надходитимуть сюди автоматично, з тими самими перевірками, що й у кабінеті. Передайте ключ і посилання на документацію вашому програмісту.'}
      Ключ показується лише один раз — збережіть його; якщо загубили чи він потрапив не туди — відкличте й створіть новий.</div>
    ${keys.length ? `<table class="list"><thead><tr><th>Назва</th><th>Ключ</th><th class="hide-m">Створено</th><th>Востаннє використано</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>
      ${keys.map((k) => `<tr${k.revoked_at ? ' style="opacity:.55"' : ''}><td><b>${esc(k.name)}</b>${k.revoked_at ? ` <span class="badge bad">відкликано</span>` : ''}</td>
        <td><code>${esc(k.prefix)}…</code></td><td class="small hide-m">${esc(when(k.created_at))}<div class="muted">${esc(k.created_by || '')}</div></td>
        <td class="small">${k.revoked_at ? `відкликано ${esc(when(k.revoked_at))}` : esc(when(k.last_used_at))}</td>
        ${canEdit ? `<td class="r">${k.revoked_at ? '' : `<button class="btn sm danger" data-akdel="${k.id}">Відкликати</button>`}</td>` : ''}</tr>`).join('')}</tbody></table>`
      : '<div class="small muted">Ключів ще немає.</div>'}`;
  const again = () => apiKeysCard(box, base, { canEdit, admin });
  $('#akNew', box) && ($('#akNew', box).onclick = () => {
    const m = modal('Новий API-ключ', `<form id="akF" class="form-stack"><label class="f"><span>Назва (для кого / для чого)</span>
      <input name="name" maxlength="60" placeholder="напр. Сайт KeyCRM" required></label></form>`,
    { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="akGo">Створити</button>' });
    $('#akGo', m.el).onclick = async () => {
      const f = $('#akF', m.el);
      if (!f.reportValidity()) return;
      try {
        const k = await api('POST', base, { name: f.name.value });
        m.close();
        const s = modal('Ключ створено', `<div class="form-stack">
          <div class="alert warn">Скопіюйте ключ зараз — більше його не буде видно ні вам, ні нам.</div>
          <label class="f"><span>API-ключ «${esc(k.name)}»</span><input id="akVal" readonly value="${esc(k.key)}" style="font-family:ui-monospace,monospace"></label>
          <div class="small muted">Як підключити — у <a href="/api-docs.html" target="_blank" rel="noopener">документації</a>. Заголовок запиту: <code>Authorization: Bearer ${esc(k.prefix)}…</code></div></div>`,
        { footer: '<button class="btn" id="akCopy">Копіювати</button><button class="btn primary" data-close>Готово</button>' });
        $('#akVal', s.el).onclick = (e) => e.target.select();
        $('#akCopy', s.el).onclick = async () => { try { await navigator.clipboard.writeText(k.key); toast('Ключ скопійовано'); } catch { $('#akVal', s.el).select(); toast('Виділено — натисніть Ctrl+C', true); } };
        again();
      } catch (e) { toast(e.message, true); }
    };
  });
  $$('[data-akdel]', box).forEach((b) => (b.onclick = async () => {
    const k = keys.find((x) => String(x.id) === b.dataset.akdel);
    const ok = await confirmDanger(`Відкликати ключ «${esc(k.name)}»?`, `Ключ <code>${esc(k.prefix)}…</code> одразу перестане працювати — інтеграція, що ним користується, зупиниться.`, 'Відкликати');
    if (!ok) return;
    try { await api('DELETE', `${base}/${k.id}`); toast('Ключ відкликано'); again(); } catch (e) { toast(e.message, true); }
  }));
}

// ---------- Сторінка «панель фільтрів + вміст» (як «Аналітика») ----------
// Ті самі id полів, що й у горизонтального filterBar (fQ, fFrom, fTo, fPay, fReset), тож wireFilterBar працює без змін.
let fpOpen = null;
export function fpLayout(aside, body, { summary = '' } = {}) {
  if (fpOpen === null) fpOpen = window.matchMedia?.('(min-width: 901px)').matches ?? true;
  return `<div class="fp"><details class="card an7-f fp-f" ${fpOpen ? 'open' : ''}><summary><b>Фільтри</b><span class="small muted">${esc(summary)}</span></summary>${aside}</details>
    <div class="fp-main">${body}</div></div>`;
}
export function wireFp() {
  const d = $('.fp-f');
  if (d) d.ontoggle = () => { fpOpen = d.open; };
}
export const fpGroup = (title, inner) => (inner ? `<div class="an7-g"><div class="an7-h">${title}</div>${inner}</div>` : '');
export const fpBtn = (label, on, attrs) => `<button type="button" class="an7-per ${on ? 'on' : ''}" ${attrs}>${label}</button>`;
export function filterSide(f, { pay = false, placeholder = '№, клієнт, телефон, ТТН…', dates = true } = {}) {
  return `${fpGroup('Пошук', `<input id="fQ" type="search" value="${esc(f.q || '')}" placeholder="${esc(placeholder)}" aria-label="Пошук">`)}
    ${dates ? fpGroup('Період', `<div class="an7-dates ${f.from || f.to ? 'on' : ''}"><input id="fFrom" type="date" value="${esc(f.from || '')}" aria-label="З дати"><input id="fTo" type="date" value="${esc(f.to || '')}" aria-label="По дату"></div>`) : ''}
    ${pay ? fpGroup('Оплата закупівлі', `<select id="fPay" aria-label="Оплата"><option value="">Будь-яка</option><option value="paid" ${f.pay === 'paid' ? 'selected' : ''}>Оплачені</option><option value="unpaid" ${f.pay === 'unpaid' ? 'selected' : ''}>Не оплачені</option></select>`) : ''}
    ${f.q || f.from || f.to || f.pay ? '<button type="button" class="btn sm" id="fReset">Скинути пошук і дати</button>' : ''}`;
}
// Картка-показник у ряду над таблицею.
export const fpKpi = (label, value, sub = '', cls = '') => `<div class="kpi ${cls}"><span class="kpi-l">${label}</span><span class="kpi-v">${value}</span>${sub ? `<span class="small muted">${sub}</span>` : ''}</div>`;

// ---------------------------------------------------------------- пошук товару у формах (закупівля, замовлення клієнта)
// Рядок пошуку над списком товарів: назва або артикул (усі слова), лічильник «показано N з M», «Лише вибрані»,
// ✕ і Esc — очистити. Збіг підсвічується (psHl). Стан — у ps: { q, sel }.
const psNorm = (v) => String(v || '').toLowerCase().replace(/[’ʼ`']/g, "'").replace(/\s+/g, ' ').trim();
export const psMatch = (p, q) => { const w = psNorm(q).split(' ').filter(Boolean); if (!w.length) return true; const hay = psNorm(`${p.name} ${p.article || ''}`); return w.every((x) => hay.includes(x)); };
export function psHl(text, q) {
  const s = String(text ?? '');
  const words = psNorm(q).split(' ').filter((x) => x.length > 1).sort((a, b) => b.length - a.length);
  if (!words.length) return esc(s);
  const re = new RegExp(`(${words.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return s.split(re).map((part, i) => (i % 2 ? `<mark class="ps-hl">${esc(part)}</mark>` : esc(part))).join('');
}
export const psBar = (id, ps, placeholder = 'Пошук товару: назва або артикул') => `<div class="ps-bar" id="${id}">
  <label class="ps-field"><span class="sr-only">Пошук товару</span>
    <svg class="ps-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input type="search" class="ps-q" placeholder="${esc(placeholder)}" value="${esc(ps.q)}" autocomplete="off" spellcheck="false" enterkeyhint="search">
    <button type="button" class="ps-x" aria-label="Очистити пошук" ${ps.q ? '' : 'hidden'}>✕</button></label>
  <button type="button" class="chip ps-sel ${ps.sel ? 'on' : ''}" aria-pressed="${ps.sel ? 'true' : 'false'}">Лише вибрані <b class="ps-sel-n">0</b></button>
  <span class="small muted ps-count" aria-live="polite"></span></div>`;
// onChange — перемалювати список; count(shown, total, selected) — оновити лічильники.
export function wirePsBar(root, ps, onChange) {
  const q = $('.ps-q', root); const x = $('.ps-x', root); const sel = $('.ps-sel', root);
  let t;
  q.oninput = () => { x.hidden = !q.value; clearTimeout(t); t = setTimeout(() => { ps.q = q.value; onChange(); }, 120); };
  q.onkeydown = (e) => { if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; x.hidden = true; ps.q = ''; onChange(); } };
  x.onclick = () => { q.value = ''; x.hidden = true; ps.q = ''; onChange(); q.focus(); };
  sel.onclick = () => { ps.sel = !ps.sel; sel.classList.toggle('on', ps.sel); sel.setAttribute('aria-pressed', String(ps.sel)); onChange(); };
  return (shown, total, selected) => {
    $('.ps-sel-n', root).textContent = selected;
    $('.ps-count', root).textContent = shown === total ? `${total} ${total === 1 ? 'товар' : total % 10 >= 2 && total % 10 <= 4 && (total % 100 < 12 || total % 100 > 14) ? 'товари' : 'товарів'}` : `Показано ${shown} з ${total}`;
  };
}
export const psEmpty = (ps) => `<div class="ps-empty"><div><b>${ps.sel && !ps.q ? 'Ще нічого не вибрано' : `Нічого не знайдено${ps.q ? ` за «${esc(ps.q)}»` : ''}`}</b></div>
  <div class="small muted">${ps.sel && !ps.q ? 'Вкажіть кількість біля потрібних товарів.' : 'Перевірте написання або шукайте за артикулом.'}</div>
  <button type="button" class="btn sm ps-reset">Показати всі товари</button></div>`;
