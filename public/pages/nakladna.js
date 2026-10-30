// Накладні: формування за номером замовлення, історія версій, правка даних, історія накладних.
import { renderInvoice, esc, money, dateUa } from '../invoice.js';
import { exportDocx } from '../docx-export.js';
import { $, $$, main, MASK, api, setPending, toast, modal, confirmDanger, fmtDateTime, readImage, printHtml, todayKyiv } from '../core/ui.js';

export function createNakladnaPages(ctx) {
  const { can, loadBoot, activeFops, fopById, tplById } = ctx;

let current = null; // поточна накладна

const SOURCE_BADGE = {
  receipt: ['ok', 'з чека Checkbox'],
  channel: ['warn', 'за полем 1 (попередньо)'],
  office: ['warn', 'за відділом (попередньо)'],
  manual: ['info', 'обрано вручну'],
  default: ['', 'за замовчуванням'],
  '': ['bad', 'не визначено'],
};

async function viewInvoice(orderId) {
  main.innerHTML = `
    <div class="order-bar">
      <form id="orderForm">
        <label for="orderInput" class="sr-only">Номер замовлення</label>
        <input id="orderInput" placeholder="ID замовлення з LP-CRM, напр. 108008" inputmode="numeric" value="${esc(orderId || '')}" autocomplete="off" autofocus>
        <button class="btn primary">Сформувати</button>
      </form>
      <div class="bar-actions" id="invActions"><span class="muted small">Для перевірки без CRM введіть <a href="#/invoice/demo">demo</a></span></div>
    </div>
    <div id="invArea"></div>`;
  $('#orderForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#orderInput').value.trim().replace(/^№\s*/, '');
    if (!v) return;
    if (location.hash === `#/invoice/${encodeURIComponent(v)}`) loadInvoice(v);
    else location.hash = `#/invoice/${encodeURIComponent(v)}`;
  });
  if (orderId) { await loadInvoice(orderId); keepWarm(); } // спершу пошук, потім фонове оновлення — не навпаки
  else {
    keepWarm();
    $('#invArea').innerHTML = `<div class="card empty"><div class="big">Введіть номер замовлення з LP-CRM</div>
      Накладна сформується автоматично: товари, покупець і ФОП (з чека Checkbox або за відділом).</div>`;
  }
}

// Поки сторінка відкрита, сервер у фоні довантажує нові прийняті замовлення з LP-CRM (раз на 3 хв),
// тож номер, вставлений із CRM, відкривається за кілька секунд, без довгого першого пошуку.
let warmTimer = 0;
let searching = false;
function keepWarm() {
  clearTimeout(warmTimer);
  const run = async () => {
    const form = $('#orderForm');
    if (!form || !document.contains(form)) return; // пішли зі сторінки
    let r = {};
    if (document.visibilityState === 'visible' && !searching) {
      try { r = await api('POST', '/api/invoice/warm', {}); } catch { r = {}; }
    }
    warmTimer = setTimeout(run, r.more || r.busy ? 20e3 : 3 * 60e3);
  };
  run();
}

async function loadInvoice(orderId, fresh = false, wide = false) {
  const area = $('#invArea');
  area.innerHTML = `<div class="card empty"><span class="spinner"></span> Шукаю замовлення №${esc(orderId)} серед «Прийнято»… <div class="small" style="margin-top:6px">Зазвичай кілька секунд. Якщо замовлення прийняли щойно — програма довантажить нові з LP-CRM, це трохи довше.</div></div>`;
  searching = true;
  setPending((n) => { const el = $('#invArea .empty'); if (el) el.innerHTML = `<span class="spinner"></span> Шукаю замовлення №${esc(orderId)} у LP-CRM… (крок ${n + 1})`; });
  try {
    const qs = [fresh ? 'fresh=1' : '', wide ? 'wide=1' : ''].filter(Boolean).join('&');
    current = await api('GET', `/api/invoice/${encodeURIComponent(orderId)}${qs ? `?${qs}` : ''}`);
    current.requestedId = orderId;
    if (current.b2b) renderB2bView(); else if (current.rzs) renderRzsView(); else renderInvoiceView();
  } catch (e) {
    current = null;
    if ($('#invActions')) $('#invActions').innerHTML = '';
    const ext = e.data?.canExtend;
    area.innerHTML = `<div class="alert bad"><b>Не вдалося отримати замовлення.</b><br>${esc(e.message)}
      ${ext ? `<div class="btn-row" style="margin-top:10px"><button class="btn primary" id="invWide">Перевірити за ${esc(e.data.extendDays)} днів</button></div>` : ''}</div>`;
    if (ext) $('#invWide').onclick = () => loadInvoice(orderId, false, true);
  } finally {
    searching = false;
  }
}

// Замовлення від B2B-партнера: накладну не формуємо — лише маркування, яке партнер додав у своє замовлення.
function renderB2bView() {
  const b = current.b2b;
  const o = current.order;
  $('#invArea').innerHTML = `<div class="card form-stack" style="max-width:760px">
      <h3 style="margin:0">📦 Замовлення від B2B партнера</h3>
      <div class="alert info">Накладна для замовлень від B2B-партнерів не формується. Маркування додав партнер — кнопка «Маркування» відкриє його файл.</div>
      <dl class="kv">
        <dt>Замовлення LP-CRM</dt><dd>№${esc(o.orderId)}${o.shortId ? ` · ${esc(o.shortId)}` : ''}</dd>
        <dt>Партнер</dt><dd><b>${esc(b.partner)}</b> · ${esc(b.number)}</dd>
        <dt>Клієнт</dt><dd>${esc(b.client_name || o.buyer?.name || '')}</dd>
        ${b.ttn ? `<dt>ТТН партнера</dt><dd>${esc(b.ttn)}</dd>` : ''}
        <dt>Маркування</dt><dd>${b.label ? `📎 ${esc(b.label.name)} <span class="small muted">· ${esc(fmtDateTime(b.label.created_at))}</span>` : '<span class="badge bad">партнер ще не додав (або файл старший за 30 днів)</span>'}</dd>
      </dl>
      ${can('b2b.admin') ? `<div><a class="btn sm" href="#/b2bclients/${b.id}">Відкрити ${esc(b.number)} у B2B</a></div>` : ''}
    </div>`;
  $('#invActions').innerHTML = `<button class="btn primary" id="actNp" ${b.label ? '' : 'disabled'}>Маркування</button><button class="btn" id="actRefresh">Оновити з CRM</button>`;
  $('#actNp').onclick = () => npMarking($('#actNp'));
  $('#actRefresh').onclick = () => loadInvoice(current.requestedId, true);
}

// Замовлення Розетки (дропшипінг): накладну ФОП не формуємо — маркування (PDF з Розетки) і супровідні документи від Розетки.
function renderRzsView() {
  const r = current.rzs;
  const o = current.order;
  $('#invArea').innerHTML = `<div class="card form-stack" style="max-width:760px">
      <h3 style="margin:0">🛒 Замовлення Розетки</h3>
      <div class="alert info">Накладна ФОП для замовлень Розетки не формується: маркування — з Розетки, супровідні документи — від Розетки (видаткова з «Вчасно»).</div>
      <dl class="kv">
        <dt>Замовлення LP-CRM</dt><dd>№${esc(o.orderId)}${o.shortId ? ` · ${esc(o.shortId)}` : ''}</dd>
        <dt>Розетка</dt><dd><b>${esc(r.order_num)}</b>${r.account ? ` · ${esc(r.account)}` : ''} · ${esc(r.status_name)}</dd>
        <dt>Клієнт</dt><dd>${esc(r.customer || o.buyer?.name || '')}</dd>
        <dt>ТТН</dt><dd>${r.ttn ? `<b>${esc(r.ttn)}</b>${r.tracking_status ? ` <span class="small muted">· ${esc(r.tracking_status)}</span>` : ''}` : '<span class="badge bad">ще не створено — «Рітейл → Розетка»</span>'}</dd>
        <dt>Документи</dt><dd>${r.document_link ? `📄 є${r.docs_at ? ` <span class="small muted">· з ${esc(fmtDateTime(r.docs_at))}</span>` : ''}` : '<span class="badge warn">Розетка ще не сформувала</span>'}${r.invoice_no ? ` · рахунок ${esc(r.invoice_no)}` : ''}</dd>
      </dl>
      ${can('docs.view') ? `<div><a class="btn sm" href="#/rzorders">Відкрити «Рітейл → Розетка»</a></div>` : ''}
    </div>`;
  $('#invActions').innerHTML = `<button class="btn primary" id="actNp" ${r.ttn ? '' : 'disabled'}>Маркування</button>
    ${r.document_link ? `<a class="btn" href="${esc(r.document_link)}" target="_blank" rel="noopener">📄 Документи</a>` : '<button class="btn" disabled>📄 Документи</button>'}
    <button class="btn" id="actRefresh">Оновити з CRM</button>`;
  $('#actNp').onclick = () => npMarking($('#actNp'));
  $('#actRefresh').onclick = () => loadInvoice(current.requestedId, true);
}

function renderInvoiceView() {
  const inv = current;
  const area = $('#invArea');
  const [cls, label] = SOURCE_BADGE[inv.fopSource] || SOURCE_BADGE[''];
  const o = inv.order;
  const officeName = inv.office ? `${inv.office.office_id}${inv.office.name ? ' · ' + inv.office.name : ''}` : '—';
  const r = inv.receipt;
  const totalMismatch = inv.crmOrder.crmTotal != null && Math.abs(inv.crmOrder.crmTotal - inv.crmOrder.total) > 0.01;

  area.innerHTML = `
  <div class="inv-layout">
    <div class="preview" id="preview">${renderInvoice(inv)}</div>
    <aside class="panel">
      <div class="card">
        <h3>Замовлення №${esc(o.orderId)} ${inv.demo ? '<span class="badge info">демо</span>' : ''}</h3>
        <dl class="kv">
          ${inv.crmCode && inv.crmCode !== o.orderId ? `<dt>Код у CRM</dt><dd>${esc(inv.crmCode)}</dd>` : ''}
          <dt>Дата накладної</dt><dd>${esc(dateUa(o.invoiceDate || o.date))}</dd>
          <dt>Замовлення від</dt><dd>${esc(dateUa(inv.crmOrder.date))}</dd>
          <dt>Відділ</dt><dd>${esc(officeName)}</dd>
          ${o.channel ? `<dt>Поле 1</dt><dd>${esc(o.channel)}</dd>` : ''}
          <dt>Покупець</dt><dd>${esc(o.buyer.name || '—')}</dd>
          <dt>Сума</dt><dd><b>${money(o.total)} грн</b></dd>
        </dl>
        ${inv.edited ? '<div class="alert info" style="margin-top:10px">Дані змінено вручну. <a href="#" id="resetEdits">Повернути дані з CRM</a></div>' : ''}
        ${totalMismatch ? `<div class="alert" style="margin-top:10px">Сума в CRM: ${money(inv.crmOrder.crmTotal)} грн, за товарами: ${money(inv.crmOrder.total)} грн.</div>` : ''}
      </div>

      <div class="card">
        <h3>ФОП <span class="badge ${cls}">${label}</span></h3>
        <select id="fopSelect">
          <option value="">— оберіть ФОП —</option>
          ${activeFops().map((f) => `<option value="${f.id}" ${String(inv.fop?.id) === String(f.id) ? 'selected' : ''}>${esc(f.short_name)}</option>`).join('')}
        </select>
        ${inv.fopSource === 'manual' ? '<div class="small" style="margin-top:8px"><a href="#" id="fopAuto">Визначати автоматично</a></div>' : ''}
        ${inv.sellerText ? `<div class="small muted" style="margin-top:8px">Назва в накладній: ${inv.sellerTextSource === 'manual' ? 'змінено вручну' : 'з налаштувань (' + esc(inv.sellerTextSource) + ')'}</div>` : ''}
      </div>

      <div class="card">
        <h3>Чек Checkbox ${r ? `<span class="badge ${r.match === 'sum' ? 'warn' : 'ok'}">${r.match === 'order' ? 'знайдено за номером' : r.match === 'sum' ? 'збіг за сумою' : 'вказано вручну'}</span>` : ''}</h3>
        ${r ? `<dl class="kv">
            <dt>ФОП</dt><dd>${esc(r.fopName)}</dd>
            <dt>Фіскальний №</dt><dd>${esc(r.fiscalCode || '—')}</dd>
            <dt>Сума</dt><dd>${r.total != null ? money(r.total) + ' грн' : '—'}</dd>
            <dt>Дата</dt><dd>${r.date ? esc(fmtDateTime(r.date)) : '—'}</dd>
          </dl>
          ${r.url ? `<div class="small" style="margin-top:6px"><a href="${esc(r.url)}" target="_blank" rel="noopener">Відкрити чек</a></div>` : ''}`
        : `<div class="muted small">${ctx.boot.fops.some((f) => f.has_checkbox) ? (ctx.boot.settings.checkbox_enabled === '1' ? 'Чек не знайдено автоматично.' : 'Автопошук чеків вимкнено в налаштуваннях.') : 'Доступ до Checkbox ще не додано в жодного ФОП.'} Можна вказати чек вручну.</div>`}
        ${inv.receiptCandidates?.length ? `<div class="small" style="margin-top:8px">Чеки на цю суму:</div>
          ${inv.receiptCandidates.map((c) => `<button class="btn sm" data-cand="${esc(c.receiptId)}" style="margin:4px 4px 0 0">${esc(c.fopName)} · ${esc(c.fiscalCode)}</button>`).join('')}` : ''}
        <div class="receipt-input">
          <input id="receiptRef" placeholder="ID чека або фіскальний №" value="${esc(inv.receiptRef)}">
          <button class="btn sm" id="receiptSet">${inv.receiptRef ? 'Змінити' : 'Знайти'}</button>
        </div>
      </div>

      <div class="card">
        <h3>Шаблон ${inv.templateManual ? '<span class="badge info">вручну</span>' : '<span class="badge">шаблон ФОП</span>'}</h3>
        <select id="tplSelect">
          ${ctx.boot.templates.map((t) => `<option value="${t.id}" ${String(inv.template?.id) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
        ${inv.templateManual ? '<div class="small" style="margin-top:8px"><a href="#" id="tplAuto">Використовувати шаблон ФОП</a></div>' : ''}
      </div>

      ${inv.warnings.length ? `<div>${inv.warnings.map((w) => `<div class="alert">${esc(w)}</div>`).join('')}</div>` : ''}

      <div class="card">
        <h3>Історія версій <span class="badge">${inv.versionsCount}</span></h3>
        <div class="vlist" id="vlist"><span class="muted small">Завантаження…</span></div>
      </div>

      <details class="card" ${inv.order.items.length ? '' : 'open'}><summary>Дані з CRM (для перевірки полів)</summary>
        <div class="small muted" style="margin:8px 0">Так система «бачить» замовлення після обробки. Повна відповідь LP-CRM — кнопкою нижче.</div>
        <pre class="raw">${esc(JSON.stringify(inv.crmOrder, null, 2))}</pre>
        ${inv.crmRaw ? `<div class="small muted" style="margin:10px 0 6px">Сира відповідь LP-CRM:</div><pre class="raw">${esc(inv.crmRaw)}</pre>` : ''}
      </details>
    </aside>
  </div>`;

  $('#invActions').innerHTML = `
    <button class="btn primary" id="actPrint">Друк</button>
    <button class="btn" id="actNp" title="Маркування Нової пошти (100×100) або Розетки (ТТН RMP-…)">Маркування</button>
    <button class="btn" id="actWord">Word</button>
    <button class="btn" id="actPdf">PDF</button>
    <button class="btn" id="actEdit">Редагувати</button>
    <button class="btn" id="actRefresh">Оновити з CRM</button>`;
  const id = inv.requestedId;
  if (!can('docs.edit')) {
    $$('#fopSelect, #tplSelect, #receiptRef, #receiptSet, #actEdit').forEach((el) => { el.disabled = true; });
    $$('#fopAuto, #tplAuto, #resetEdits').forEach((el) => el.remove());
  }
  const savePrefs = async (patch, reason) => {
    try {
      await api('PUT', `/api/invoice/${encodeURIComponent(id)}/prefs`, { ...patch, reason });
      await loadInvoice(id);
    } catch (e) { toast(e.message, true); }
  };

  $('#fopSelect').onchange = (e) => savePrefs({ fop_id: e.target.value || null }, `ФОП змінено на «${e.target.selectedOptions[0].text}»`);
  $('#fopAuto') && ($('#fopAuto').onclick = (e) => { e.preventDefault(); savePrefs({ fop_id: null }, 'ФОП: автоматичне визначення'); });
  $('#tplSelect').onchange = (e) => savePrefs({ template_id: e.target.value }, `Шаблон змінено на «${e.target.selectedOptions[0].text}»`);
  $('#tplAuto') && ($('#tplAuto').onclick = (e) => { e.preventDefault(); savePrefs({ template_id: null }, 'Шаблон: як у ФОП'); });
  $('#resetEdits') && ($('#resetEdits').onclick = (e) => { e.preventDefault(); savePrefs({ edits: null }, 'Повернуто дані з CRM'); });
  $('#receiptSet').onclick = () => savePrefs({ receipt_ref: $('#receiptRef').value.trim() }, 'Вказано чек');
  $$('[data-cand]').forEach((b) => (b.onclick = () => savePrefs({ receipt_ref: b.dataset.cand }, 'Обрано чек')));
  $('#actPrint').onclick = () => doPrint('Друк');
  $('#actPdf').onclick = () => { toast('У вікні друку оберіть «Зберегти як PDF»'); setTimeout(() => doPrint('PDF'), 400); };
  $('#actWord').onclick = async () => {
    try {
      await exportDocx(current);
      await snapshot('Завантажено Word');
    } catch (e) { toast('Word: ' + e.message, true); }
  };
  $('#actNp').onclick = () => npMarking($('#actNp'));
  $('#actEdit').onclick = openEditor;
  $('#actRefresh').onclick = () => loadInvoice(id, true);
  $('#rawBtn') && ($('#rawBtn').onclick = async () => {
    const out = $('#rawOut');
    out.hidden = false;
    out.textContent = 'Завантаження…';
    try { out.textContent = JSON.stringify(await api('GET', `/api/lpcrm/raw/${encodeURIComponent(id)}`), null, 2); }
    catch (e) { out.textContent = e.message; }
  });
  loadVersions(id);
}

async function snapshot(reason) {
  const { versionsCount, requestedId, ...snap } = current;
  try { await api('POST', `/api/invoice/${encodeURIComponent(requestedId)}/versions`, { reason, snapshot: snap }); } catch { /* не критично */ }
  loadVersions(requestedId);
}


// Маркування: ТТН Розетки (RMP-…, а також PRM-… з кабінету Prom) — з магазину Розетки; інакше Нова пошта: ТТН з замовлення (з правками)
// або пошук у кабінетах НП. PDF відкривається в новій вкладці. ТТН з адресним забором (кур'єр НП забирає з адреси) —
// попередження менеджеру, щоб передав складу.
async function npMarking(btn) {
  const o = current.order;
  // Вкладку відкриваємо одразу (у відповідь на натискання), інакше браузер заблокує її як спливаюче вікно.
  const win = window.open('', '_blank');
  if (win) win.document.write('<p style="font:16px sans-serif;padding:24px">Шукаю маркування…</p>');
  btn.disabled = true;
  setPending((n) => { btn.innerHTML = `<span class="spinner"></span> Шукаю ТТН… (${n + 1})`; });
  try {
    if (current.b2b) { // маркування, яке додав партнер
      const res = await fetch(`/api/b2b/label/${current.b2b.id}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Маркування партнера не отримано.');
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.open(url, '_blank');
      toast(`Маркування партнера «${current.b2b.partner}» · ${current.b2b.number}`);
      return;
    }
    if (current.rzs) { // замовлення Розетки — маркування з кабінету постачальника
      const res = await fetch('/api/rzs/markings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [current.rzs.id] }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Маркування Розетки не отримано.');
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.open(url, '_blank');
      toast(`Маркування Розетки · ${current.rzs.order_num}`);
      return;
    }
    const rzTtn = String(o.delivery?.ttn || '').toUpperCase().replace(/\s/g, '');
    if (/^(RMP|PRM)/.test(rzTtn)) { // RMP — Розетка; PRM — ЕН доставки Rozetka з кабінету Prom (теж пробуємо через Розетку)
      const res = await fetch(`/api/rz/marking/${encodeURIComponent(rzTtn)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Маркування Розетки не отримано.');
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.open(url, '_blank');
      toast(`ТТН ${rzTtn} · ${decodeURIComponent(res.headers.get('X-NP-Account') || '') || 'Розетка'}`);
      return;
    }
    const f = await api('POST', '/api/np/find', {
      ttn: o.delivery?.ttn || '', phone: o.buyer?.phone || '', date: current.crmOrder?.date || o.date || '',
      refs: [o.orderId, o.shortId, current.requestedId].filter(Boolean),
    });
    const res = await fetch(`/api/np/marking/${encodeURIComponent(f.ttn)}${f.accountId ? `?account=${f.accountId}` : ''}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Маркування не отримано.');
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url; else window.open(url, '_blank');
    const acc = decodeURIComponent(res.headers.get('X-NP-Account') || '') || f.accountName;
    toast(`ТТН ${f.ttn}${acc ? ` · ${acc}` : ''}${f.source === 'crm' ? '' : ' (знайдено в кабінеті НП)'}`);
    if (res.headers.get('X-NP-Pickup') === '1') pickupWarning(f.ttn, acc, res.headers.get('X-NP-Service'));
  } catch (e) {
    win?.close();
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Маркування';
  }
}
const SERVICE_NAME = { DoorsWarehouse: 'адреса → відділення', DoorsDoors: 'адреса → адреса', DoorsPostomat: 'адреса → поштомат' };
function pickupWarning(ttn, acc, service) {
  modal('🚚 Адресний забір', `<div class="form-stack">
      <div class="alert warn" style="font-size:16px"><b>ТТН ${esc(ttn)} оформлена з адресним забором</b> — посилку забере кур’єр Нової пошти з адреси відправника
        ${SERVICE_NAME[service] ? `(${esc(SERVICE_NAME[service])})` : ''}. На відділення її <b>не відвозити</b>.</div>
      <div>Передайте цю інформацію складу разом із маркуванням.${acc ? ` Кабінет НП: ${esc(acc)}.` : ''}</div></div>`,
  { footer: '<button class="btn primary" data-close>Зрозуміло, передам складу</button>' });
}

function doPrint(reason) {
  printHtml(renderInvoice(current));
  snapshot(reason);
}

async function loadVersions(id) {
  const box = $('#vlist');
  if (!box) return;
  const rows = await api('GET', `/api/invoice/${encodeURIComponent(id)}/versions`).catch(() => []);
  box.innerHTML = rows.length
    ? rows.map((v) => `<button data-ver="${v.id}"><span class="v-r">${esc(v.reason)}</span><span class="v-d">${esc(fmtDateTime(v.created_at))}</span><span class="v-f">${esc(v.fop_name || '—')}${v.user_name ? ' · ' + esc(v.user_name) : ''}</span><span class="v-d">${money(v.total)} грн</span></button>`).join('')
    : '<span class="muted small">Версій ще немає</span>';
  $$('[data-ver]', box).forEach((b) => (b.onclick = () => openVersion(b.dataset.ver)));
}

async function openVersion(vid) {
  const v = await api('GET', `/api/versions/${vid}`);
  const m = modal(`Версія від ${fmtDateTime(v.created_at)} — ${v.reason}`,
    `<div class="small muted" style="margin-bottom:10px">ФОП: ${esc(v.fop_name || '—')} · Сума: ${money(v.total)} грн</div>
     <div style="overflow:auto;background:#eef0ef;padding:16px;border-radius:8px">${renderInvoice(v.data)}</div>`,
    { wide: true, footer: '<button class="btn" data-close>Закрити</button><button class="btn" id="vWord">Word</button><button class="btn primary" id="vPrint">Друкувати цю версію</button>' });
  $('#vPrint', m.el).onclick = () => printHtml(renderInvoice(v.data));
  $('#vWord', m.el).onclick = () => exportDocx(v.data).catch((e) => toast(e.message, true));
}

function openEditor() {
  const o = current.order;
  const row = (i = {}) => `<tr>
    <td><input data-k="article" value="${esc(i.article || '')}" style="width:110px"></td>
    <td><input data-k="name" value="${esc(i.name || '')}"></td>
    <td><input data-k="unit" value="${esc(i.unit || 'шт')}" style="width:56px"></td>
    <td><input data-k="qty" type="number" step="any" value="${esc(i.qty ?? 1)}" style="width:80px"></td>
    <td><input data-k="price" type="number" step="0.01" value="${esc(i.price ?? 0)}" style="width:110px"></td>
    <td><button class="btn sm danger" data-del title="Видалити">✕</button></td>
  </tr>`;
  const m = modal(`Редагування накладної №${o.orderId}`, `
    <div class="alert info" style="margin-bottom:14px">Правки стосуються лише цієї накладної і зберігаються в історії. У LP-CRM нічого не змінюється.</div>
    <div class="grid2">
      <label class="f"><span>Покупець (ПІБ)</span><input id="eName" value="${esc(o.buyer.name)}"></label>
      <label class="f"><span>Телефон</span><input id="ePhone" value="${esc(o.buyer.phone)}"></label>
      <label class="f"><span>Адреса доставки</span><input id="eAddr" value="${esc(o.delivery.address)}"></label>
      <label class="f"><span>Спосіб доставки</span><input id="eDel" value="${esc(o.delivery.method)}"></label>
      <label class="f"><span>ТТН</span><input id="eTtn" value="${esc(o.delivery.ttn)}"></label>
      <label class="f"><span>Оплата</span><input id="ePay" value="${esc(o.payment)}"></label>
      <label class="f" style="grid-column:span 2"><span>Продавець (назва в накладній, можна кілька рядків)</span><textarea id="eSeller" rows="2" placeholder="${esc((current.sellerText || '') || 'як у ФОП')}">${esc(current.edits?.sellerText || '')}</textarea></label>
      <label class="f"><span>Дата накладної</span><input id="eDate" type="date" value="${esc((o.invoiceDate || o.date || '').slice(0, 10))}"></label>
      <div class="grid2">
        <label class="f"><span>Знижка, грн</span><input id="eDisc" type="number" step="0.01" value="${esc(o.discount)}"></label>
        <label class="f"><span>Доставка, грн</span><input id="eDcost" type="number" step="0.01" value="${esc(o.deliveryCost)}"></label>
      </div>
    </div>
    <h3 style="margin-top:18px">Товари</h3>
    <table class="items-edit"><thead><tr><th>Артикул</th><th>Найменування</th><th>Од.</th><th>К-сть</th><th>Ціна</th><th></th></tr></thead>
      <tbody id="eItems">${o.items.map(row).join('')}</tbody></table>
    <button class="btn sm" id="eAdd" style="margin-top:8px">+ Додати рядок</button>`,
  { wide: true, footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="eSave">Зберегти</button>' });

  const tbody = $('#eItems', m.el);
  tbody.addEventListener('click', (e) => { if (e.target.closest('[data-del]')) e.target.closest('tr').remove(); });
  $('#eAdd', m.el).onclick = () => tbody.insertAdjacentHTML('beforeend', row());
  $('#eSave', m.el).onclick = async () => {
    const items = $$('tr', tbody).map((tr) => Object.fromEntries($$('input', tr).map((i) => [i.dataset.k, i.value])))
      .filter((i) => i.name.trim());
    const date = $('#eDate', m.el).value;
    const edits = {
      buyer: { name: $('#eName', m.el).value, phone: $('#ePhone', m.el).value },
      delivery: { address: $('#eAddr', m.el).value, method: $('#eDel', m.el).value, ttn: $('#eTtn', m.el).value },
      payment: $('#ePay', m.el).value,
      sellerText: $('#eSeller', m.el).value.trim(),
      date: date && date !== current.autoInvoiceDate ? date : '',
      discount: $('#eDisc', m.el).value,
      deliveryCost: $('#eDcost', m.el).value,
      items: items.map((i) => {
        const orig = o.items.find((x) => x.name === i.name);
        return { ...i, productId: orig?.productId || '' };
      }),
    };
    try {
      await api('PUT', `/api/invoice/${encodeURIComponent(current.requestedId)}/prefs`, { edits, reason: 'Відредаговано дані накладної' });
      m.close();
      toast('Збережено');
      await loadInvoice(current.requestedId);
    } catch (e) { toast(e.message, true); }
  };
}

// =====================================================================
// ІСТОРІЯ
// =====================================================================
async function viewHistory() {
  main.innerHTML = `
    <div class="head-row"><h2>Історія накладних</h2>
      <div class="btn-row">
        <input id="hQ" placeholder="Номер замовлення" style="width:200px">
        <select id="hFop" style="width:220px"><option value="">Усі ФОПи</option>${ctx.boot.fops.map((f) => `<option value="${f.id}">${esc(f.short_name)}</option>`).join('')}</select>
      </div>
    </div>
    <div id="hList"></div>`;
  const load = async () => {
    const qs = new URLSearchParams({ q: $('#hQ').value, fop: $('#hFop').value });
    const rows = await api('GET', `/api/history?${qs}`);
    $('#hList').innerHTML = rows.length
      ? `<table class="list"><thead><tr><th>Замовлення</th><th>ФОП (остання версія)</th><th>Сума</th><th>Версій</th><th>Остання зміна</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="click" data-o="${esc(r.order_id)}"><td><b>№${esc(r.order_id)}</b></td><td>${esc(r.fop_name || '—')}</td><td>${money(r.total)} грн</td><td>${r.versions}</td><td>${esc(fmtDateTime(r.last_at))}</td></tr>`).join('')}
        </tbody></table>`
      : ($('#hQ').value || $('#hFop').value
        ? '<div class="card empty"><div class="big">Нічого не знайдено</div>Спробуйте інший номер або інший ФОП.<div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn" id="hClear">Скинути фільтри</button></div></div>'
        : '<div class="card empty"><div class="big">Ще немає сформованих накладних</div>Тут з’являться накладні, які ви відкриєте за номером замовлення.<div class="btn-row" style="justify-content:center;margin-top:12px"><a class="btn primary" href="#/invoice">Сформувати накладну</a></div></div>');
    $('#hClear') && ($('#hClear').onclick = () => { $('#hQ').value = ''; $('#hFop').value = ''; $('#hQ').dispatchEvent(new Event('input', { bubbles: true })); $('#hFop').dispatchEvent(new Event('change', { bubbles: true })); });
    $$('[data-o]').forEach((tr) => (tr.onclick = () => (location.hash = `#/invoice/${encodeURIComponent(tr.dataset.o)}`)));
  };
  let t;
  $('#hQ').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  $('#hFop').onchange = load;
  await load();
}


  return { viewInvoice, viewHistory };
}
