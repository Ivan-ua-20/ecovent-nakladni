// Обміни й повернення браку: список, картка заявки, форма подачі (з замовлення клієнта чи закупівлі).
// Партнер (кабінет) і наші менеджери (розділ B2B) — ті самі сторінки, різні дії: партнер подає, додає фото, ТТН
// повернення, коментує; менеджер розглядає, погоджує / відхиляє, перевіряє брак, оформлює заміну чи повернення коштів.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime } from '../core/ui.js';
import { fpLayout, wireFp, fpGroup, fpBtn, fpKpi } from './b2b-shared.js';

const ST_CLS = { new: 'warn', review: 'info', approved: 'info', resolved: 'ok', closed: 'ok', rejected: 'bad', cancelled: '' };
const badge = (r) => `<span class="badge ${ST_CLS[r.status] || ''}">${esc(r.status_name)}</span>`;
const itemsLine = (list) => list.map((i) => `${esc(i.name)}${i.article ? ` <span class="muted">(${esc(i.article)})</span>` : ''} × <b>${i.qty}</b>`).join('<br>');
const phoneTxt = (p) => (/^380\d{9}$/.test(p || '') ? `+${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : (p || ''));

export function createClaimPages(ctx) {
  const can = (p) => ctx.can?.(p);

  // Форма заявки: orderId — замовлення клієнта чи закупівля; admin — подає наш менеджер.
  async function openClaimForm(orderId, { admin = false } = {}) {
    const base = admin ? '/api/b2b/claims' : '/api/b2b/p/claims';
    const src = await api('GET', `${base}/source/${orderId}`);
    const cat = admin ? [] : await api('GET', '/api/b2b/p/catalog').then((r) => r.products || []).catch(() => []);
    const isClient = src.order.kind === 'client';
    const m = modal(`Брак / обмін — ${src.order.number}`, `<form id="clmF" class="form-stack">
        ${src.order.client_name ? `<div class="small muted">Клієнт: ${esc(src.order.client_name)}${src.order.ttn ? ` · ТТН ${esc(src.order.ttn)}` : ''}</div>` : ''}
        <div class="f"><span>З яким товаром проблема (кількість)</span>
          <table class="list"><tbody>${src.items.map((i) => `<tr><td>${esc(i.name)}${i.article ? `<div class="small muted">${esc(i.article)}</div>` : ''}</td>
            <td class="r nowrap small muted">у замовленні ${i.qty}</td>
            <td class="r"><input type="number" min="0" max="${i.qty}" step="1" data-cq="${i.product_id}" value="${src.items.length === 1 && i.qty === 1 ? 1 : ''}" style="width:70px" aria-label="Кількість: ${esc(i.name)}"></td></tr>`).join('')}</tbody></table></div>
        <label class="f"><span>Причина *</span><select name="reason"><option value="">— оберіть —</option>${Object.entries(src.reasons).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label class="f"><span>Опис проблеми *</span><textarea name="descr" rows="3" placeholder="Що саме не так: не вмикається, тріщина корпусу, бракує деталі…"></textarea></label>
        <label class="f"><span>Що потрібно</span><select name="want">${Object.entries(src.wants).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <div id="clmOther" hidden class="form-stack">
          ${admin ? '<div class="small muted">Товар на заміну партнер обирає у своїй заявці; для нашої заявки — опишіть у коментарі.</div>'
            : `<label class="f"><span>Товар на заміну</span><input id="clmOtherQ" list="clmCat" placeholder="Почніть вводити назву або ID"><datalist id="clmCat">${cat.map((p) => `<option value="${p.id} · ${esc(p.name)}">`).join('')}</datalist></label>`}
        </div>
        ${isClient ? `<div class="f"><span>Хто отримує заміну</span>
          <label class="check"><input type="radio" name="deliver_to" value="client" checked> Клієнт — чекає на заміну</label>
          <label class="check"><input type="radio" name="deliver_to" value="partner"> ${admin ? 'Партнер' : 'Ми (партнер)'} — уже замінили клієнту зі свого складу</label></div>` : ''}
        <div class="f"><span>Фото / відео <span class="muted">(необов’язково, до 10 файлів по 5 МБ)</span></span><input type="file" id="clmFiles" multiple accept="image/*,video/*,application/pdf"></div>
      </form>`, { wide: true, footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="clmSave">Подати заявку</button>' });
    const otherSync = () => { $('#clmOther', m.el).hidden = $('[name=want]', m.el).value !== 'other'; };
    $('[name=want]', m.el).onchange = otherSync;
    $('#clmSave', m.el).onclick = async (e) => {
      const f = Object.fromEntries(new FormData($('#clmF', m.el)));
      const items = $$('[data-cq]', m.el).map((x) => ({ product_id: Number(x.dataset.cq), qty: Number(x.value) || 0 })).filter((x) => x.qty > 0);
      const body = { order_id: src.order.id, items, reason: f.reason, descr: f.descr, want: f.want, deliver_to: f.deliver_to };
      if (f.want === 'other' && !admin) {
        const id = parseInt($('#clmOtherQ', m.el)?.value, 10);
        if (!id) { toast('Оберіть товар на заміну зі списку', true); return; }
        body.want_items = [{ product_id: id, qty: items.reduce((t, x) => t + x.qty, 0) || 1 }];
      }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await api('POST', base, body);
        const files = [...($('#clmFiles', m.el).files || [])].slice(0, 10);
        let bad = 0;
        for (const file of files) {
          const res = await fetch(`${base}/${r.id}/files`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
          if (!res.ok) bad++;
        }
        m.close();
        toast(`Заявку ${r.number} подано${bad ? ` (${bad} файл(ів) не додано — більше 5 МБ?)` : ''}`, Boolean(bad));
        location.hash = `#/${admin ? 'b2bclaims' : 'pclaims'}/${r.id}`;
      } catch (er) { toast(er.message, true); btn.disabled = false; }
    };
  }

  async function viewList(admin) {
    const st = viewList.st ?? 'open';
    const base = admin ? '/api/b2b/claims' : '/api/b2b/p/claims';
    const { rows = [], statuses = {}, counts = [] } = await api('GET', `${base}${st ? `?status=${st}` : ''}`);
    const cnt = Object.fromEntries(counts.map((x) => [x.status, x.n]));
    const open = (cnt.new || 0) + (cnt.review || 0) + (cnt.approved || 0);
    const aside = fpGroup('Статус', `${fpBtn(`<span>Відкриті</span><span class="small">${open || ''}</span>`, st === 'open', 'data-cs="open"')}
        ${fpBtn('<span>Усі</span>', st === '', 'data-cs=""')}
        ${Object.entries(statuses).map(([k, v]) => fpBtn(`<span>${esc(v)}</span><span class="small">${cnt[k] || ''}</span>`, st === k, `data-cs="${k}"`)).join('')}`);
    const table = rows.length ? `<table class="list"><thead><tr><th>№</th>${admin ? '<th>Партнер</th>' : ''}<th>Замовлення / клієнт</th><th>Товар</th><th>Причина</th><th>Статус</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="click" data-cl="${r.id}">
          <td><b>${esc(r.number)}</b><div class="small muted">${esc(fmtDateTime(r.created_at))}</div></td>
          ${admin ? `<td>${esc(r.partner)}</td>` : ''}
          <td>${esc(r.order_number)}${r.client_name ? `<div class="small">${esc(r.client_name)}</div>` : ''}</td>
          <td class="small">${itemsLine(r.items)}</td>
          <td class="small">${esc(r.reason_name)}<div class="muted">${esc(r.want_name)}</div>${r.files ? `<div class="muted">📷 ${r.files}</div>` : ''}</td>
          <td>${badge(r)}${r.defect_name ? `<div class="small muted">${esc(r.defect_name)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="card empty"><div class="big">Заявок немає</div>Тут з’являться заявки на обмін і повернення браку.</div>';
    main.innerHTML = `
      <div class="head-row"><h2>Обміни й повернення</h2></div>
      ${fpLayout(aside, `<div class="kpis">
          ${fpKpi('Відкриті', String(open))}
          ${fpKpi('Нові', String(cnt.new || 0), admin ? 'чекають розгляду' : 'чекають менеджера')}
          ${fpKpi('Погоджені', String(cnt.approved || 0), admin ? 'чекають брак / заміну' : 'внесіть ТТН повернення, якщо потрібно')}
          ${fpKpi('Вирішені', String((cnt.resolved || 0) + (cnt.closed || 0)))}
        </div>
        <div class="alert info help">${admin
    ? 'Заявки партнерів на брак: розгляньте, погодьте (куди йде брак) або відхиліть; заміна — «обмінна закупівля» на 0 грн, з якої партнер оформлює відправку. Нова заявка — кнопка «🛠 Брак / обмін» у замовленні клієнта чи закупівлі.'
    : 'Брак чи пошкодження: відкрийте замовлення клієнта або закупівлю й натисніть «🛠 Брак / обмін». Заявка й усі зміни приходять у вашу Telegram-групу.'}</div>
        ${table}`, { summary: st === 'open' ? 'відкриті' : st ? statuses[st] || '' : 'усі' })}`;
    wireFp();
    $$('[data-cs]').forEach((b) => (b.onclick = () => { viewList.st = b.dataset.cs; viewList(admin); }));
    $$('[data-cl]').forEach((tr) => (tr.onclick = () => { location.hash = `#/${admin ? 'b2bclaims' : 'pclaims'}/${tr.dataset.cl}`; }));
  }

  async function viewClaim(id, admin) {
    const base = admin ? '/api/b2b/claims' : '/api/b2b/p/claims';
    const [{ claim: r, files, history }, meta] = await Promise.all([api('GET', `${base}/${id}`), admin ? api('GET', '/api/b2b/claims/meta') : null]);
    const done = ['closed', 'rejected', 'cancelled'].includes(r.status);
    const orderLink = admin ? `#/${r.order_kind === 'client' ? 'b2bclients' : 'b2borders'}/${r.order_id}` : `#/${r.order_kind === 'client' ? 'pclients' : 'porders'}/${r.order_id}`;
    const exchLink = r.exch_supply_id ? (admin ? `#/b2borders/${r.exch_supply_id}` : `#/porders/${r.exch_supply_id}`) : '';
    const fileUrl = (f) => (admin ? `/api/b2b/files/${f.id}` : `/api/b2b/p/claims/${r.id}/files/${f.id}`);
    main.innerHTML = `
      <div class="head-row"><h2>Заявка ${esc(r.number)} ${badge(r)}</h2><button class="btn" id="clBack">← До списку</button></div>
      <div class="grid2" style="align-items:start">
        <div class="form-stack">
          <div class="card form-stack">
            <dl class="kv">
              ${admin ? `<dt>Партнер</dt><dd><b>${esc(r.partner)}</b></dd>` : ''}
              <dt>${r.order_kind === 'client' ? 'Замовлення клієнта' : 'Закупівля'}</dt><dd><a href="${orderLink}">${esc(r.order_number)}</a></dd>
              ${r.client_name ? `<dt>Клієнт</dt><dd>${esc(r.client_name)}${r.client_phone ? ` · ${esc(phoneTxt(r.client_phone))}` : ''}${r.ttn ? `<div class="small muted">ТТН ${esc(r.ttn)}</div>` : ''}</dd>` : ''}
              <dt>Товар</dt><dd>${itemsLine(r.items)}</dd>
              <dt>Причина</dt><dd>${esc(r.reason_name)}</dd>
              <dt>Що потрібно</dt><dd>${esc(r.want_name)}${r.want_items.length ? `<div class="small">${itemsLine(r.want_items)}</div>` : ''}</dd>
              ${r.order_kind === 'client' ? `<dt>Заміну отримує</dt><dd>${r.deliver_to === 'partner' ? 'партнер (уже замінив клієнту зі свого складу)' : 'клієнт'}</dd>` : ''}
              ${r.return_mode ? `<dt>Брак</dt><dd>${esc(r.return_name)}${r.return_ttn ? `<div>ТТН повернення <b>${esc(r.return_ttn)}</b></div>` : ''}</dd>` : ''}
              ${r.defect ? `<dt>Перевірка</dt><dd>${esc(r.defect_name)}${r.defect_note ? ` — ${esc(r.defect_note)}` : ''}</dd>` : ''}
              ${r.decision_note ? `<dt>Рішення</dt><dd>${esc(r.decision_note)}</dd>` : ''}
              ${r.refund_amount ? `<dt>До повернення</dt><dd><b>${esc(money(r.refund_amount))} грн</b></dd>` : ''}
              ${r.exch_supply_id ? `<dt>Обмінна закупівля</dt><dd><a href="${exchLink}">${esc(r.exch_number)}</a> · 0 грн, оплачено</dd>` : ''}
              <dt>Подав(ла)</dt><dd>${esc(r.created_by)} · ${esc(fmtDateTime(r.created_at))}</dd>
            </dl>
            <div><b>Опис</b><div style="white-space:pre-line">${esc(r.descr)}</div></div>
          </div>
          <div class="card form-stack"><h3>📷 Фото / відео</h3>
            ${files.length ? files.map((f) => `<div><a href="${fileUrl(f)}" target="_blank" rel="noopener">${esc(f.name)}</a> <span class="small muted">· ${esc(f.created_by || '')} · ${esc(fmtDateTime(f.created_at))}</span></div>`).join('') : '<div class="small muted">Не додано.</div>'}
            ${done ? '' : '<div><input type="file" id="clFiles" multiple accept="image/*,video/*,application/pdf"> <button class="btn sm" id="clUp">Додати</button></div><div class="small muted">До 10 файлів по 5 МБ; одразу йдуть у Telegram-групу партнера.</div>'}
          </div>
        </div>
        <div class="form-stack">
          ${actionsCard(r, admin, meta)}
          ${done ? '' : `<div class="card form-stack"><h3>💬 Коментар</h3><textarea id="clCom" rows="2" placeholder="${admin ? 'Напр.: надішліть, будь ласка, фото маркування на коробці' : 'Уточнення для менеджера'}"></textarea><div><button class="btn" id="clComSave">Надіслати</button></div></div>`}
          <div class="card"><h3>Історія</h3>${history.map((x) => `<div class="small"><span class="muted">${esc(fmtDateTime(x.at))}</span> · ${esc(x.action)}${x.user_name ? ` <span class="muted">(${esc(x.user_name)})</span>` : ''}</div>`).join('')}</div>
        </div>
      </div>`;
    const re = () => viewClaim(id, admin);
    $('#clBack').onclick = () => { location.hash = `#/${admin ? 'b2bclaims' : 'pclaims'}`; };
    if ($('#clUp')) $('#clUp').onclick = async (e) => {
      const fl = [...($('#clFiles').files || [])].slice(0, 10);
      if (!fl.length) { toast('Оберіть файли', true); return; }
      e.currentTarget.disabled = true;
      for (const file of fl) {
        const res = await fetch(`${base}/${r.id}/files`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
        if (!res.ok) toast(`${file.name}: ${(await res.json().catch(() => ({}))).error || 'не додано'}`, true);
      }
      re();
    };
    if ($('#clComSave')) $('#clComSave').onclick = async () => {
      try { await api('POST', `${base}/${r.id}/comment`, { text: $('#clCom').value }); toast('Надіслано'); re(); } catch (er) { toast(er.message, true); }
    };
    wireActions(r, admin, meta, re);
  }

  function actionsCard(r, admin, meta) {
    if (!admin) {
      const parts = [];
      if (r.status === 'approved' && r.return_mode === 'warehouse' && !r.return_ttn) {
        parts.push(`<div class="alert warn small">Відправте брак нам на склад і внесіть ТТН повернення.</div>
          <div class="btn-row"><input id="clTtn" placeholder="ТТН повернення" inputmode="numeric" style="max-width:220px"><button class="btn primary" id="clTtnSave">Зберегти ТТН</button></div>`);
      }
      if (['new', 'review'].includes(r.status)) parts.push('<div><button class="btn danger" id="clCancel">Скасувати заявку</button></div>');
      if (r.status === 'resolved' && r.exch_supply_id) parts.push(`<div class="alert ok small">Заміну оформлено: з обмінної закупівлі <b>${esc(r.exch_number)}</b> оформіть відправку (як звичайне замовлення клієнта) або самовивіз.</div>`);
      return parts.length ? `<div class="card form-stack"><h3>Дії</h3>${parts.join('')}</div>` : '';
    }
    const a = [];
    if (r.status === 'new') a.push('<button class="btn" data-act="review">👀 Взяти на розгляд</button>');
    if (['new', 'review'].includes(r.status)) {
      a.push(`<div class="form-stack" style="padding:10px;border:1px solid var(--line);border-radius:8px"><b>Погодити</b>
        <label class="f"><span>Що з бракованим товаром *</span><select id="clRet"><option value="">— оберіть —</option>${Object.entries(meta.returns).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        ${['refund', 'other'].includes(r.want) ? '<label class="f"><span>Сума до повернення / різниця, грн</span><input id="clSum" inputmode="decimal" placeholder="0"></label>' : ''}
        <label class="f"><span>Коментар (необов’язково)</span><input id="clNote" placeholder="напр. міняємо за гарантією"></label>
        <div class="btn-row"><button class="btn primary" data-act="approve">✅ Погодити</button><button class="btn danger" data-act="reject">❌ Відхилити…</button></div></div>`);
    }
    if (r.status === 'approved') {
      if (['same', 'other', 'repair'].includes(r.want)) {
        a.push(`<div class="form-stack" style="padding:10px;border:1px solid var(--line);border-radius:8px"><b>Оформити заміну</b>
          <div class="small muted">Створиться обмінна закупівля на 0 грн («Оплачено вручну: обмін за заявкою ${esc(r.number)}»): ${itemsLine(r.want === 'other' ? r.want_items : r.items)}</div>
          <label class="check"><input type="radio" name="clDel" value="np" checked> Відправка Новою поштою — партнер оформлює з неї замовлення (собі чи клієнту)</label>
          <label class="check"><input type="radio" name="clDel" value="pickup"> Самовивіз зі складу</label>
          <div><button class="btn primary" data-act="replace">🔁 Оформити заміну</button></div></div>`);
      } else {
        a.push(`<div class="form-stack" style="padding:10px;border:1px solid var(--line);border-radius:8px"><b>Повернення коштів</b>
          <label class="f"><span>Сума, грн</span><input id="clSum" inputmode="decimal" value="${r.refund_amount || ''}"></label>
          <label class="f"><span>Як повернули *</span><input id="clNote" placeholder="напр. зараховано в наступну закупівлю / переказ"></label>
          <div><button class="btn primary" data-act="refund">💸 Кошти повернено</button></div></div>`);
      }
      a.push('<div><button class="btn danger" data-act="reject">❌ Відхилити…</button></div>');
    }
    if (['approved', 'resolved', 'closed'].includes(r.status) && r.return_mode && r.return_mode !== 'none' && !['confirmed', 'not_confirmed'].includes(r.defect)) {
      a.push('<div class="btn-row"><button class="btn" data-act="defect" data-d="confirmed">🔎 Брак отримано — підтверджено</button><button class="btn" data-act="defect" data-d="not_confirmed">Брак не підтверджено…</button></div>');
    }
    if (['approved', 'resolved'].includes(r.status)) a.push('<div><button class="btn" data-act="close">🏁 Закрити заявку</button></div>');
    return a.length ? `<div class="card form-stack"><h3>Дії менеджера</h3>${a.join('')}</div>` : '';
  }

  function wireActions(r, admin, meta, re) {
    if (!admin) {
      if ($('#clTtnSave')) $('#clTtnSave').onclick = async () => { try { await api('PUT', `/api/b2b/p/claims/${r.id}/return-ttn`, { ttn: $('#clTtn').value }); toast('ТТН збережено'); re(); } catch (er) { toast(er.message, true); } };
      if ($('#clCancel')) $('#clCancel').onclick = async () => {
        if (!(await confirmDanger(`Скасувати заявку ${r.number}?`, '', 'Скасувати заявку'))) return;
        try { await api('POST', `/api/b2b/p/claims/${r.id}/cancel`, {}); re(); } catch (er) { toast(er.message, true); }
      };
      return;
    }
    $$('[data-act]').forEach((b) => (b.onclick = async () => {
      const act = b.dataset.act;
      const body = { action: act, note: $('#clNote')?.value || '' };
      if (act === 'approve') { body.return_mode = $('#clRet').value; body.refund_amount = $('#clSum')?.value || 0; }
      if (act === 'refund') body.refund_amount = $('#clSum')?.value || 0;
      if (act === 'replace') body.delivery = $('input[name=clDel]:checked')?.value || 'np';
      if (act === 'reject' || (act === 'defect' && b.dataset.d === 'not_confirmed')) {
        const t = await askText(act === 'reject' ? 'Причина відмови' : 'Що виявила перевірка');
        if (t === null) return;
        body.note = t;
      }
      if (act === 'defect') body.defect = b.dataset.d;
      if (act === 'replace' && !(await confirmDanger(`Оформити заміну за заявкою ${r.number}?`, 'Створиться обмінна закупівля на 0 грн, позначена «Оплачено вручну». Партнер отримає повідомлення в бот і групу.', 'Оформити заміну'))) return;
      b.disabled = true;
      try { await api('POST', `/api/b2b/claims/${r.id}/action`, body); toast('Збережено — партнер отримає повідомлення'); re(); } catch (er) { toast(er.message, true); b.disabled = false; }
    }));
  }
  const askText = (title) => new Promise((resolve) => {
    let done = false;
    const m = modal(title, '<textarea id="atT" rows="3" style="width:100%"></textarea>', { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="atOk">Зберегти</button>', focus: '#atT' });
    $('#atOk', m.el).onclick = () => { const v = $('#atT', m.el).value.trim(); if (v.length < 3) { toast('Напишіть кілька слів', true); return; } done = true; m.close(); resolve(v); };
    new MutationObserver((_, obs) => { if (!document.contains(m.el)) { obs.disconnect(); if (!done) resolve(null); } }).observe(document.body, { childList: true });
  });

  return {
    openClaimForm,
    viewPartnerClaims: (id) => (id ? viewClaim(id, false) : viewList(false)),
    viewAdminClaims: (id) => (id ? viewClaim(id, true) : viewList(true)),
    can,
  };
}
