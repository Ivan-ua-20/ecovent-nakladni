// Рахунки на оплату (Word): формування з CRM або вручну, список, QR-посилання.
import { esc, money } from '../invoice.js';
import { renderRahunok, rahunokDocx, rahunokMessage } from '../rahunok.js';
import { sendDialog } from '../core/share.js';
import { STATUS as PAY_STATUS } from '../pay.js';
import { $, $$, main, MASK, api, setPending, toast, modal, confirmDanger, fmtDateTime, readImage, printHtml, todayKyiv, takeHashQuery } from '../core/ui.js';

export function createRahunkyPages(ctx) {
  // Вікно «Надіслати» для рахунку: файл Word і текст із посиланням на оплату.
  const openSend = (d) => sendDialog({
    title: `Надіслати рахунок № ${d.number}`,
    text: rahunokMessage(d),
    url: d.pay?.page || '',
    makeFile: () => rahunokDocx(d, { download: false }),
    download: () => rahunokDocx(d).catch((er) => toast(er.message, true)),
  });
  const { can, loadBoot, activeFops, fopById, tplById } = ctx;

const payBadge = (st) => { const [t, c] = PAY_STATUS[st] || [st, '']; return `<span class="badge ${c}">QR · ${t}</span>`; };
const activeInvFops = () => ctx.boot.invFops.filter((f) => f.active);

async function viewRahunky(mode, arg) {
  if (mode === 'crm' || mode === 'manual') return rahunokForm({ mode });
  if (mode === 'edit' && arg) return rahunokForm({ mode: 'edit', id: arg });
  main.innerHTML = `
    <h2>Рахунок на оплату</h2>
    <div class="tiles">
      <a class="tile" href="#/rahunky/crm"><div class="tile-ico" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg></div><div><div class="tile-title">З замовлення CRM</div>
        <div class="tile-text">Номер замовлення → товари підтягнуться з LP-CRM. Номер рахунку = номер замовлення.</div></div></a>
      <a class="tile" href="#/rahunky/manual"><div class="tile-ico" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></div><div><div class="tile-title">Вручну</div>
        <div class="tile-text">Товари, кількість і ціни вписуються вручну. Номер — наступний по порядку.</div></div></a>
    </div>
    <div class="small muted" style="margin-top:14px">Збережені рахунки — у вкладці <a href="#/rlist">«Сформовані рахунки»</a>.</div>`;
}

async function viewRahunkyList() {
  main.innerHTML = `
    <div class="head-row"><h2>Сформовані рахунки</h2>
      <label class="sr-only" for="rQ">Пошук</label><input id="rQ" placeholder="Номер або клієнт" style="width:240px"></div>
    <div id="rList"><div class="card empty"><span class="spinner"></span></div></div>`;
  const hq = takeHashQuery();
  if (hq) $('#rQ').value = hq;
  const load = async () => {
    const r = await api('GET', `/api/rahunky?q=${encodeURIComponent($('#rQ').value)}`);
    $('#rList').innerHTML = (r.rows.length
      ? `<div class="table-wrap"><table class="list"><thead><tr><th>№</th><th>Клієнт</th><th>ФОП</th><th>Сума</th><th>Створено</th><th></th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr class="click ${x.pay_status ? `st-${x.pay_status}` : ''}" data-r="${x.id}"><td><b>${esc(x.number)}</b> <span class="badge">${x.source === 'crm' ? 'CRM' : 'вручну'}</span>${x.pay_status ? ` ${payBadge(x.pay_status)}` : ''}</td>
          <td>${esc(x.client_name)}</td><td>${esc(x.fop_name)}</td><td>${money(x.total)} грн</td>
          <td class="small">${esc(fmtDateTime(x.created_at))}<br><span class="muted">${esc(x.created_by || '')}</span></td>
          <td><div class="btn-row" style="justify-content:flex-end"><button class="btn sm" data-send="${x.id}">Надіслати</button><button class="btn sm" data-word="${x.id}">Word</button><button class="btn sm" data-pdf="${x.id}">PDF</button></div></td></tr>`).join('')}
        </tbody></table></div>`
      : `<div class="card empty"><div class="big">Рахунків ще немає</div>Створений рахунок можна завантажити у Word або PDF і надіслати клієнту.${can('docs.edit') ? '<div class="btn-row" style="justify-content:center;margin-top:12px"><a class="btn primary" href="#/rahunky">Створити рахунок</a></div>' : ''}</div>`) + `<div class="small muted" style="margin-top:8px">Рахунки зберігаються ${r.retentionDays} дн. Наступний номер ручного рахунку: ${esc(r.nextNumber)}.</div>`;
    $$('[data-r]').forEach((tr) => (tr.onclick = (e) => {
      if (e.target.closest('button')) return;
      location.hash = `#/rahunky/edit/${tr.dataset.r}`;
    }));
    $$('[data-send]').forEach((b) => (b.onclick = async () => {
      try { openSend((await api('GET', `/api/rahunky/${b.dataset.send}`)).data); } catch (er) { toast(er.message, true); }
    }));
    $$('[data-word]').forEach((b) => (b.onclick = async () => rahunokDocx((await api('GET', `/api/rahunky/${b.dataset.word}`)).data).catch((er) => toast(er.message, true))));
    $$('[data-pdf]').forEach((b) => (b.onclick = async () => { const d = (await api('GET', `/api/rahunky/${b.dataset.pdf}`)).data; toast('У вікні друку оберіть «Зберегти як PDF»'); printHtml(renderRahunok(d)); }));
  };
  let t;
  $('#rQ').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  await load();
}

async function rahunokForm({ mode, id }) {
  await loadBoot();
  const editOk = can('docs.edit');
  let saved = null; // { id, data }
  let state = { source: mode === 'crm' ? 'crm' : 'manual', number: '', order_ref: '', fop_id: activeInvFops()[0]?.id || '', client: { name: '', edrpou: '', contract: '' }, date: todayKyiv(), items: mode === 'manual' ? [{ name: '', qty: 1, price: '' }] : [] };
  let nextNumber = '';
  if (mode === 'edit') {
    const r = await api('GET', `/api/rahunky/${id}`);
    saved = { id: r.id, data: r.data, created_at: r.created_at, created_by: r.created_by };
    state = { source: r.data.source, number: r.data.number, order_ref: r.data.orderRef, fop_id: r.data.fop.id, client: { ...r.data.client }, date: r.data.date, items: r.data.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })), qr: Boolean(r.data.pay) };
  } else if (mode === 'manual') {
    nextNumber = (await api('GET', '/api/rahunky?q=__none__')).nextNumber;
  }
  if (state.qr === undefined) { try { state.qr = localStorage.getItem('rh_qr') === '1'; } catch { state.qr = false; } }
  const isCrm = state.source === 'crm';
  if (!activeInvFops().length) {
    main.innerHTML = `<div class="alert">Спершу додайте ФОП для рахунків у розділі <a href="#/invfops">«ФОПи рахунків»</a>.</div>`;
    return;
  }
  main.innerHTML = `
    <div class="order-bar">
      <a class="btn" href="${saved ? '#/rlist' : '#/rahunky'}">← Назад</a>
      ${isCrm && !saved ? `<form id="rOrderF"><label for="rOrder" class="sr-only">Замовлення CRM</label><input id="rOrder" placeholder="ID замовлення з LP-CRM (статус «Прийнято»)" inputmode="numeric" autofocus><button class="btn primary">Підтягнути</button></form>`
        : `<h2 class="bar-title">${saved ? `Рахунок № ${esc(state.number)}` : 'Рахунок вручну'}</h2>`}
      <div class="bar-actions">
        <button class="btn primary" id="rSend">Надіслати</button>
        <button class="btn" id="rWord">Завантажити Word</button>
        <button class="btn" id="rPdf">PDF / друк</button>
        ${editOk ? '<button class="btn" id="rSave">Зберегти</button>' : ''}
        ${editOk && saved ? '<button class="btn danger" id="rDel">Видалити</button>' : ''}
      </div>
    </div>
    ${isCrm && !saved ? '<div id="rOrderInfo" class="small muted" style="margin:-6px 0 12px">Товари з замовлення можна буде змінити, видалити чи додати.</div>' : ''}
    <div class="inv-layout">
      <div class="preview" id="rPrev"></div>
      <aside class="panel">
        <div class="card form-stack">
          <h3>Рахунок ${state.number || nextNumber ? `<span class="badge info">№ ${esc(state.number || nextNumber)}</span>` : ''}</h3>
          <label class="f"><span>Від якого ФОП</span><select id="rFop" ${editOk ? '' : 'disabled'}>${activeInvFops().map((f) => `<option value="${f.id}" ${String(f.id) === String(state.fop_id) ? 'selected' : ''}>${esc(f.short_name)}</option>`).join('')}</select></label>
          <label class="f"><span>Клієнт (назва організації) *</span><input id="rCName" value="${esc(state.client.name)}" placeholder="Напр. «РОЗЕТКА. УА» ТОВ"></label>
          <div class="grid2">
            <label class="f"><span>ЄДРПОУ</span><input id="rCCode" value="${esc(state.client.edrpou)}" inputmode="numeric"></label>
            <label class="f"><span>Дата рахунку</span><input id="rDate" type="date" value="${esc(state.date)}"></label>
          </div>
          <label class="f"><span>Договір</span><input id="rCContract" value="${esc(state.client.contract)}" placeholder="Необов’язково"></label>
          <label class="check" id="rQrWrap"><input type="checkbox" id="rQr" ${state.qr ? 'checked' : ''} ${editOk ? '' : 'disabled'}> Додати QR-код на оплату</label>
          <div class="small muted" id="rQrHint"></div>
        </div>
        <div class="card">
          <h3>Товари <span class="small muted" id="rTotal"></span></h3>
          <div id="rItems"></div>
          ${editOk ? '<button class="btn sm" id="rAdd" style="margin-top:8px">+ Додати товар</button>' : ''}
        </div>
        <div class="card"><div class="small muted">${saved ? `Створено: ${esc(fmtDateTime(saved.created_at))}${saved.created_by ? ` · ${esc(saved.created_by)}` : ''}. Word і PDF також зберігають зміни.` : 'Word і PDF спершу зберігають рахунок і присвоюють номер.'}</div></div>
      </aside>
    </div>`;

  const fopObj = () => ctx.boot.invFops.find((f) => String(f.id) === String($('#rFop').value)) || {};
  const qrOk = () => Boolean(fopObj().odb_id);
  const qrOn = () => state.qr && qrOk();
  const qrUi = () => {
    const ok = qrOk();
    $('#rQr').disabled = !editOk || !ok;
    $('#rQrHint').textContent = ok
      ? 'Посилання на оплату створюється в Opendatabot (0,42 ₴). Той самий номер і сума — те саме посилання.'
      : 'Для цього ФОП немає рахунку Opendatabot — увімкніть його в «Налаштуваннях рахунків».';
  };
  const read = () => {
    state.qr = $('#rQr').checked;
    state.fop_id = $('#rFop').value;
    state.client = { name: $('#rCName').value, edrpou: $('#rCCode').value, contract: $('#rCContract').value };
    state.date = $('#rDate').value || todayKyiv();
    state.items = $$('#rItems .ri:not(.ri-head)').map((row) => ({ name: $('[data-k=name]', row).value, qty: $('[data-k=qty]', row).value, price: $('[data-k=price]', row).value }));
  };
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const previewData = () => {
    const items = state.items.filter((i) => String(i.name).trim()).map((i) => ({ name: i.name, qty: num(i.qty), price: num(i.price), unit: 'шт', sum: Math.round(num(i.qty) * num(i.price) * 100) / 100 }));
    const f = fopObj();
    const total = Math.round(items.reduce((t, i) => t + i.sum, 0) * 100) / 100;
    const sp = saved?.data?.pay;
    const pay = !qrOn() ? null : sp && Math.abs((saved.data.total || 0) - total) < 0.005 && String(saved.data.fop?.id) === String(f.id) ? sp : { placeholder: true };
    return { number: state.number || nextNumber || '—', date: state.date, fop: { ...f, warning_text: f.warning_text || ctx.boot.defaultWarning }, client: state.client, items, total, pay };
  };
  const preview = () => {
    const d = previewData();
    $('#rPrev').innerHTML = renderRahunok(d);
    $('#rTotal').textContent = `${d.items.length} поз. · ${money(d.total)} грн`;
  };
  const itemRow = (i, n) => `<div class="ri">
      <span class="ri-n">${n + 1}</span>
      <input data-k="name" value="${esc(i.name)}" placeholder="Назва товару" title="Назва товару" ${editOk ? '' : 'disabled'}>
      <input data-k="qty" value="${esc(i.qty)}" inputmode="decimal" placeholder="К-сть" title="Кількість, шт" ${editOk ? '' : 'disabled'}>
      <input data-k="price" value="${esc(i.price)}" inputmode="decimal" placeholder="Ціна" title="Ціна за шт, грн" ${editOk ? '' : 'disabled'}>
      ${editOk ? '<button class="btn sm danger" data-rdel title="Прибрати">✕</button>' : ''}
    </div>`;
  const drawItems = () => {
    $('#rItems').innerHTML = state.items.length
      ? `<div class="ri ri-head"><span></span><span>Кількість, шт</span><span>Ціна за шт, грн</span><span></span></div>${state.items.map(itemRow).join('')}`
      : `<div class="muted small">${isCrm ? 'Підтягніть замовлення або додайте товар.' : 'Додайте товар.'}</div>`;
    preview();
  };
  drawItems();

  $('.panel').addEventListener('input', () => { read(); preview(); });
  $('#rFop').onchange = () => { read(); qrUi(); preview(); };
  $('#rQr').onchange = () => { read(); try { localStorage.setItem('rh_qr', state.qr ? '1' : '0'); } catch { /* */ } preview(); };
  qrUi();
  $('#rItems').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rdel]');
    if (!b) return;
    read();
    state.items.splice($$('#rItems .ri:not(.ri-head)').indexOf(b.closest('.ri')), 1);
    drawItems();
  });
  $('#rAdd') && ($('#rAdd').onclick = () => { read(); state.items.push({ name: '', qty: 1, price: '' }); drawItems(); $$('#rItems [data-k=name]').at(-1).focus(); });

  $('#rOrderF') && ($('#rOrderF').onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#rOrder').value.trim();
    if (!q) return;
    $('#rOrderInfo').innerHTML = '<span class="spinner"></span> Шукаю замовлення…';
    try {
      const o = await api('GET', `/api/rahunok-order/${encodeURIComponent(q)}`);
      read();
      state.number = o.number;
      state.order_ref = o.crmCode || q;
      state.items = o.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price }));
      $('#rOrderInfo').innerHTML = `Замовлення <b>№ ${esc(o.number)}</b>${o.buyer?.name ? ` · ${esc(o.buyer.name)}` : ''}. Номер рахунку: <b>${esc(o.number)}</b>.${o.note ? `<br>${esc(o.note)}` : ''}`;
      $('.panel h3 .badge')?.remove();
      $$('.panel h3')[0].insertAdjacentHTML('beforeend', ` <span class="badge info">№ ${esc(o.number)}</span>`);
      drawItems();
    } catch (er) { $('#rOrderInfo').innerHTML = `<span style="color:var(--bad)">${esc(er.message)}</span>`; }
  });

  const persist = async () => {
    read();
    if (isCrm && !state.number) throw new Error('Спершу підтягніть замовлення з CRM.');
    const body = { source: state.source, number: state.number, order_ref: state.order_ref, fop_id: state.fop_id, client: state.client, date: state.date, items: state.items, qr: qrOn() };
    const r = saved ? await api('PUT', `/api/rahunky/${saved.id}`, body) : await api('POST', '/api/rahunky', body);
    const first = !saved;
    saved = { id: r.id, data: r.data };
    state.number = r.data.number;
    preview();
    if (first) history.replaceState(null, '', `#/rahunky/edit/${r.id}`);
    return r.data;
  };
  const getData = async () => (editOk ? persist() : saved.data);
  // Спершу зберігаємо (номер, QR-посилання), потім — вікно «Надіслати».
  $('#rSend').onclick = async () => {
    try { openSend(await getData()); } catch (er) { toast(er.message, true); }
  };
  $('#rWord').onclick = async () => {
    try { const d = await getData(); await rahunokDocx(d); toast(`Рахунок № ${d.number} збережено і завантажено`); }
    catch (er) { toast(er.message, true); }
  };
  $('#rPdf').onclick = async () => {
    try { const d = await getData(); toast('У вікні друку оберіть «Зберегти як PDF»'); printHtml(renderRahunok(d)); }
    catch (er) { toast(er.message, true); }
  };
  $('#rSave') && ($('#rSave').onclick = async () => {
    try { const d = await persist(); toast(`Рахунок № ${d.number} збережено`); } catch (er) { toast(er.message, true); }
  });
  $('#rDel') && ($('#rDel').onclick = async () => {
    if (!(await confirmDanger(`Видалити рахунок № ${saved.number || saved.data?.number || ''}?`, 'Рахунок зникне зі списку назавжди. QR-посилання на оплату, якщо воно є, залишиться в розділі оплат.', 'Видалити рахунок'))) return;
    try { await api('DELETE', `/api/rahunky/${saved.id}`); toast('Рахунок видалено'); location.hash = '#/rlist'; } catch (er) { toast(er.message, true); }
  });
}


  return { viewRahunky, viewRahunkyList };
}
