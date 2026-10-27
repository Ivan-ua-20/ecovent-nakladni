// Спільне для сторінок B2B (адмін і партнер): статуси, суми, завантаження файлів.
import { esc, money } from '../invoice.js';
import { fmtDateTime as fmtDT, $, $$, toast, modal } from '../core/ui.js';

export const uah = (n) => `${money(n)} грн`;
const ST_CLS = { invoice_wait: 'warn', pay_wait: 'warn', partial: 'info', paid: 'ok', done: 'ok', cancelled: 'bad', new: 'warn', crm: 'info' };
export const statusBadge = (o) => `<span class="badge ${ST_CLS[o.status] || ''}">${esc(o.status_name || o.status)}</span>`;
// Замовлення клієнта: оплата (за закупівлею) і «без закупівлі».
const PAY_CLS = { paid: 'ok', partial: 'info', unpaid: 'warn' };
export const payBadge = (o) => (o.pay ? `<span class="badge ${PAY_CLS[o.pay] || ''}">${esc(o.pay_name || o.pay)}</span>` : '');
export const supplyMark = (o) => (o.no_supply ? '<span class="badge bad">Без закупівлі</span>' : `<span class="small muted">із ${esc(o.supply_number)}</span>`);
export const crmCell = (o) => (o.crm_id ? `<b>№ ${esc(o.crm_id)}</b>${o.crm_status ? `<div class="small">${esc(o.crm_status)}</div>` : ''}`
  : (o.status === 'crm' ? `<span class="small">${esc(o.crm_status || 'Передано')}</span>` : '<span class="small muted">—</span>'));
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

// ---------- галочки і масові дії ----------
export const selCell = (id) => `<td style="width:34px" data-nosel><input type="checkbox" data-sel="${id}" aria-label="Обрати"></td>`;
export const selHead = () => '<th style="width:34px"><input type="checkbox" id="selAll" aria-label="Обрати всі"></th>';
// actions: [{ key, label, danger?, confirm?: (n) => текст, run: (id) => Promise }]
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
  if (all) all.onchange = () => { $$('[data-sel]').forEach((x) => { x.checked = all.checked; }); draw(); };
  async function run(key) {
    if (key === '_clear') { $$('[data-sel]').forEach((x) => { x.checked = false; }); if (all) all.checked = false; draw(); return; }
    const a = actions.find((x) => x.key === key);
    const ids = sel();
    if (a.confirm && !(await confirmDanger(a.confirm(ids.length), '', a.label))) return;
    const fails = [];
    let ok = 0;
    bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    for (const [n, id] of ids.entries()) {
      bar.querySelector('b').textContent = `${a.label}: ${n + 1} з ${ids.length}…`;
      try { await a.run(id); ok++; } catch (e) { fails.push(`B2B-${id}: ${e.message}`); }
    }
    toast(`${a.label}: виконано ${ok} з ${ids.length}`, fails.length > 0);
    if (fails.length) modal('Не вдалося для частини замовлень', `<div class="form-stack small">${fails.map((x) => `<div>${esc(x)}</div>`).join('')}</div>`, { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
    onDone();
  }
  draw();
}
export const bulkBar = () => '<div id="bulkBar" class="btn-row card" hidden style="position:sticky;top:8px;z-index:5;margin-bottom:10px;padding:8px 12px;flex-wrap:wrap;align-items:center"></div>';
