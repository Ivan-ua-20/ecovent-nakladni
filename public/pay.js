// Оплати через Opendatabot: посилання на оплату з QR, надходження з усіх «Автоклієнтів», налаштування рахунків.
const nf = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uah = (n) => `${nf.format(Number(n) || 0)} ₴`;
const dt = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)} ${s.slice(11, 16)}` : '');
const kyivToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const daysSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

export const STATUS = {
  pending: ['Очікує', ''],
  check: ['Перевірити', 'warn'],
  partial: ['Частково', 'warn'],
  paid: ['Оплачено', 'ok'],
  over: ['Переплата', 'ok'],
  manual: ['Оплачено (вручну)', 'ok'],
  closed: ['Закрито', 'muted'],
};
const KIND = { fop: 'ФОП', company: 'ТОВ / ПП' };

import { sendDialog } from './core/share.js';

export function createPayUI(ctx) {
  const { api, $, $$, esc, toast, modal, can } = ctx;
  const main = () => ctx.main;
  const badge = (st) => { const [t, c] = STATUS[st] || [st, '']; return `<span class="badge ${c}">${esc(t)}</span>`; };
  const copy = async (text, msg = 'Скопійовано') => {
    try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt('Скопіюйте:', text); }
  };
  const message = (l) => `Рахунок на оплату № ${l.number} на суму ${nf.format(l.amount)} грн.\nОплатити онлайн: ${l.page}`;

  // ---------- звірка з Opendatabot (не частіше разу на хвилину) ----------
  let syncing = null;
  async function sync(force = false) {
    if (syncing) return syncing;
    syncing = api('POST', '/api/odb/sync', { force }).then((r) => {
      for (const l of r.minePaid || []) toast(`Оплачено рахунок № ${l.number} — ${uah(l.amount)}`);
      return r;
    }).catch(() => null).finally(() => { syncing = null; });
    return syncing;
  }
  let timer = null;
  const poll = (fn) => {
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden && document.body.contains(fn.anchor())) fn.run(); else if (!document.body.contains(fn.anchor())) clearInterval(timer); }, 300000); // раз на 5 хв; оплати миттєво приносить вебхук
  };

  // =====================================================================
  // ПОСИЛАННЯ НА ОПЛАТУ
  // =====================================================================
  let lf = { filter: 'unpaid', mine: false, q: '' };
  try { lf = { ...lf, ...JSON.parse(localStorage.getItem('pl_f') || '{}') }; } catch { /* */ }
  const saveLf = () => { try { localStorage.setItem('pl_f', JSON.stringify(lf)); } catch { /* */ } };

  async function viewLinks() {
    const el = main();
    el.innerHTML = '<div class="card empty"><span class="spinner"></span></div>';
    const { accounts, connected } = await api('GET', '/api/odb/accounts');
    const enabled = accounts.filter((a) => a.enabled);
    el.innerHTML = `
      <div class="head-row"><h2>Посилання на оплату</h2><span class="small muted" id="plSync"></span></div>
      ${!connected ? `<div class="alert">Opendatabot не підключено. ${can('api') ? 'Вкажіть ключ у <a href="#/rsettings">«Налаштуваннях рахунків»</a>.' : 'Зверніться до адміністратора.'}</div>`
        : !enabled.length ? `<div class="alert">Немає жодного увімкненого рахунку. ${can('api') ? 'Увімкніть потрібні в <a href="#/rsettings">«Налаштуваннях рахунків»</a>.' : 'Зверніться до адміністратора.'}</div>` : ''}
      <div class="pl-layout">
        <form class="card form-stack" id="plForm" ${enabled.length ? '' : 'hidden'}>
          <h3>Нове посилання</h3>
          <label class="f"><span>На який рахунок</span><select name="account_id" required>${enabled.map((a) => `<option value="${esc(a.id)}">${esc(a.alias || a.iban)} · ${KIND[a.kind]}</option>`).join('')}</select></label>
          <div class="f"><span>Замовлення CRM <span class="muted">— необов’язково, номер рахунку = номер замовлення</span></span>
            <div class="pl-order"><input name="order" placeholder="Номер, код, телефон або ТТН" autocomplete="off"><button type="button" class="btn" id="plPull">Підтягнути</button></div>
            <div class="small muted" id="plOrderInfo"></div></div>
          <div class="grid2">
            <label class="f"><span>Сума, ₴ *</span><input name="amount" inputmode="decimal" required placeholder="0,00"></label>
            <label class="f"><span>Клієнт</span><input name="client" placeholder="Ім’я або назва"></label>
          </div>
          <label class="f"><span>Призначення платежу</span><input name="purpose" placeholder="Оплата за рахунком № {номер}"></label>
          <div class="btn-row"><button class="btn primary">Створити посилання</button></div>
          <div class="small muted">Без замовлення номер буде наступним по порядку, спільним з Word-рахунками. Кожне нове посилання в Opendatabot коштує 0,42 ₴.</div>
        </form>
        <div id="plResult"></div>
      </div>
      <div class="head-row pl-list-head">
        <div class="seg" role="group" aria-label="Які посилання показати">
          ${[['unpaid', 'Неоплачені'], ['paid', 'Оплачені'], ['all', 'Усі']].map(([k, t]) => `<button type="button" data-lf="${k}" class="${lf.filter === k ? 'on' : ''}" aria-pressed="${lf.filter === k}">${t}</button>`).join('')}
        </div>
        <label class="check"><input type="checkbox" id="plMine" ${lf.mine ? 'checked' : ''}> Лише мої</label>
        <input id="plQ" placeholder="Номер або клієнт" value="${esc(lf.q)}" style="width:220px" aria-label="Пошук">
      </div>
      <div id="plList"><div class="card empty"><span class="spinner"></span></div></div>`;

    const f = $('#plForm');
    let orderRef = '';
    $('#plPull').onclick = async () => {
      const q = f.order.value.trim();
      if (!q) return;
      $('#plOrderInfo').innerHTML = '<span class="spinner"></span> Шукаю замовлення…';
      try {
        const o = await api('GET', `/api/rahunok-order/${encodeURIComponent(q)}`);
        orderRef = String(o.number);
        const total = o.items.reduce((t, i) => t + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
        f.amount.value = total ? String(Math.round(total * 100) / 100).replace('.', ',') : f.amount.value;
        if (o.buyer?.name && !f.client.value) f.client.value = o.buyer.name;
        $('#plOrderInfo').innerHTML = `Замовлення <b>№ ${esc(o.number)}</b>${o.buyer?.name ? ` · ${esc(o.buyer.name)}` : ''} · ${o.items.length} поз. Номер рахунку: <b>${esc(o.number)}</b>.`;
      } catch (er) { orderRef = ''; $('#plOrderInfo').innerHTML = `<span style="color:var(--bad)">${esc(er.message)}</span>`; }
    };
    f.order.oninput = () => { orderRef = ''; $('#plOrderInfo').textContent = f.order.value.trim() ? 'Натисніть «Підтягнути», щоб узяти номер і суму із замовлення.' : ''; };
    const create = async (force) => {
      const body = { account_id: f.account_id.value, amount: f.amount.value, client: f.client.value, purpose: f.purpose.value, order_ref: orderRef || (/^\d{1,9}$/.test(f.order.value.trim()) ? f.order.value.trim() : ''), force };
      const r = await api('POST', '/api/odb/links', body);
      if (r.duplicate) {
        const d = r.duplicate;
        const m = modal('Таке посилання вже є', `<p>Для рахунку № <b>${esc(d.number)}</b> уже є неоплачене посилання на <b>${uah(d.amount)}</b>, створене ${esc(dt(d.created_at.replace('Z', '')))}${d.created_by ? ` (${esc(d.created_by)})` : ''}.</p>
          <p class="small muted">Повторне використання не коштує нічого. Нове посилання — ще 0,42 ₴, а старе залишиться активним.</p>`,
        { footer: '<button class="btn" id="dNew">Створити нове</button><button class="btn primary" id="dUse">Використати існуюче</button>' });
        $('#dUse', m.el).onclick = async () => { m.close(); showResult((await api('GET', `/api/odb/links/${d.id}`)).link); };
        $('#dNew', m.el).onclick = async () => { m.close(); try { await create(true); } catch (er) { toast(er.message, true); } };
        return;
      }
      showResult(r.link);
      f.reset();
      orderRef = '';
      $('#plOrderInfo').textContent = '';
      loadList();
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const b = f.querySelector('button.primary');
      b.disabled = true;
      try { await create(false); } catch (er) { toast(er.message, true); } finally { b.disabled = false; }
    };

    $$('[data-lf]').forEach((b) => (b.onclick = () => { lf.filter = b.dataset.lf; saveLf(); $$('[data-lf]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); loadList(); }));
    $('#plMine').onchange = (e) => { lf.mine = e.target.checked; saveLf(); loadList(); };
    let qt;
    $('#plQ').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { lf.q = e.target.value.trim(); saveLf(); loadList(); }, 300); };
    await loadList();
    const doSync = async () => { const r = await sync(); if (r && (r.added || r.paid)) loadList(); if ($('#plSync') && r?.lastSync) $('#plSync').textContent = `Оплати перевірено ${new Date(r.lastSync).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`; };
    doSync();
    poll({ anchor: () => $('#plList'), run: doSync });
  }

  function showResult(l) {
    $('#plResult').innerHTML = `<div class="card pl-result">
      <h3>Посилання на оплату № ${esc(l.number)} ${badge(l.status)}</h3>
      <div class="pl-res-body">
        <a href="${esc(l.page)}" target="_blank" rel="noopener" class="pl-qr">${l.qr ? `<img src="${esc(l.qr)}" alt="QR-код для оплати">` : ''}</a>
        <div class="form-stack" style="flex:1;min-width:0">
          <div><b>${uah(l.amount)}</b> · ${esc(l.account_alias || '')}${l.client ? ` · ${esc(l.client)}` : ''}</div>
          <div class="small muted">${esc(l.purpose)}</div>
          <div class="pl-url"><input readonly value="${esc(l.page)}" aria-label="Посилання"><button class="btn" data-copy="url">Копіювати</button></div>
          <div class="btn-row"><button class="btn primary" data-copy="send">Надіслати</button><button class="btn" data-copy="msg">Скопіювати повідомлення клієнту</button><a class="btn" href="${esc(l.page)}" target="_blank" rel="noopener">Відкрити</a></div>
        </div>
      </div></div>`;
    $('[data-copy=url]').onclick = () => copy(l.page, 'Посилання скопійовано');
    $('[data-copy=msg]').onclick = () => copy(message(l), 'Повідомлення скопійовано — вставте його клієнту в месенджер');
    $('[data-copy=send]').onclick = () => sendDialog({ title: `Надіслати посилання № ${l.number}`, text: message(l), url: l.page });
    $('#plResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadList() {
    const box = $('#plList');
    if (!box) return;
    const p = new URLSearchParams({ filter: lf.filter, q: lf.q });
    if (lf.mine) p.set('mine', '1');
    try {
      const { links } = await api('GET', `/api/odb/links?${p}`);
      if (!links.length) { box.innerHTML = `<div class="card empty">${lf.filter === 'unpaid' ? 'Неоплачених посилань немає.' : 'Посилань ще немає.'}</div>`; return; }
      const sum = links.reduce((t, l) => t + (l.amount - (l.paid_amount || 0) > 0 && ['pending', 'partial', 'check'].includes(l.status) ? l.amount - (l.paid_amount || 0) : 0), 0);
      box.innerHTML = `${lf.filter === 'unpaid' ? `<div class="small muted" style="margin:0 0 8px">Очікується: <b>${uah(sum)}</b> за ${links.length} посиланнями</div>` : ''}
        <div class="table-wrap"><table class="list pl-table"><thead><tr><th>№</th><th>Створено</th><th>Рахунок</th><th>Клієнт</th><th class="r">Сума</th><th>Статус</th><th class="r">Оплачено</th><th class="r">Днів</th><th>Хто створив</th></tr></thead><tbody>
        ${links.map((l) => {
          const open = ['pending', 'partial', 'check'].includes(l.status);
          const days = open ? daysSince(l.created_at) : null;
          return `<tr class="click st-${l.status}" data-l="${l.id}" tabindex="0">
            <td><b>${esc(l.number)}</b></td><td class="small">${esc(new Date(l.created_at).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</td>
            <td class="small">${esc(l.account_alias || '')}</td><td>${esc(l.client || '')}</td>
            <td class="r">${uah(l.amount)}</td><td>${badge(l.status)}</td>
            <td class="r">${l.paid_amount ? uah(l.paid_amount) : ''}${l.paid_at ? `<div class="small muted">${esc(dt(l.paid_at))}</div>` : ''}</td>
            <td class="r">${days == null ? '' : `<span class="${days >= 3 ? 'd-late' : ''}">${days}</span>`}</td>
            <td class="small">${esc(l.created_by || '')}</td></tr>`;
        }).join('')}</tbody></table></div>`;
      $$('[data-l]', box).forEach((tr) => {
        tr.onclick = () => openLink(tr.dataset.l);
        tr.onkeydown = (e) => { if (e.key === 'Enter') openLink(tr.dataset.l); };
      });
    } catch (er) { box.innerHTML = `<div class="alert bad">${esc(er.message)}</div>`; }
  }

  async function openLink(id) {
    const { link: l, payments, possible } = await api('GET', `/api/odb/links/${id}`);
    const open = ['pending', 'partial', 'check'].includes(l.status);
    const m = modal(`Посилання № ${l.number}`, `
      <div class="pl-res-body">
        <a href="${esc(l.page)}" target="_blank" rel="noopener" class="pl-qr">${l.qr ? `<img src="${esc(l.qr)}" alt="QR-код для оплати">` : ''}</a>
        <div class="form-stack" style="flex:1;min-width:0">
          <div>${badge(l.status)} <b>${uah(l.amount)}</b>${l.paid_amount ? ` · оплачено ${uah(l.paid_amount)}` : ''}</div>
          <div class="small">${esc(l.account_alias || '')}${l.client ? ` · ${esc(l.client)}` : ''}</div>
          <div class="small muted">${esc(l.purpose)}</div>
          <div class="small muted">Створено ${esc(new Date(l.created_at).toLocaleString('uk-UA'))}${l.created_by ? ` · ${esc(l.created_by)}` : ''}${open ? ` · очікує ${daysSince(l.created_at)} дн.` : ''}</div>
          <div class="pl-url"><input readonly value="${esc(l.page)}" aria-label="Посилання"><button class="btn" data-c="url">Копіювати</button></div>
          <div class="btn-row">${open ? '<button class="btn primary" data-c="send">Надіслати</button>' : ''}<button class="btn" data-c="msg">${open ? 'Скопіювати нагадування клієнту' : 'Скопіювати повідомлення'}</button><a class="btn" href="${esc(l.page)}" target="_blank" rel="noopener">Відкрити</a></div>
        </div>
      </div>
      <h4 style="margin:16px 0 6px">Платежі</h4>
      ${payments.length ? `<table class="list"><tbody>${payments.map((p) => `<tr><td>${esc(dt(p.date))}</td><td class="r"><b>${uah(p.amount)}</b></td><td class="small">${esc(p.payer_name)}${p.manual ? ' <span class="badge">вручну</span>' : ''}<div class="muted">${esc(p.purpose)}</div></td></tr>`).join('')}</tbody></table>` : '<div class="small muted">Платежів ще немає.</div>'}
      ${possible.length ? `<h4 style="margin:16px 0 6px">Можливо, це оплата за цим рахунком</h4>
        <table class="list"><tbody>${possible.map((p) => `<tr><td>${esc(dt(p.date))}</td><td class="r"><b>${uah(p.amount)}</b></td><td class="small">${esc(p.payer_name)}<div class="muted">${esc(p.purpose)}</div></td>
          <td><button class="btn sm" data-attach="${esc(p.id)}">Прив’язати</button></td></tr>`).join('')}</tbody></table>` : ''}`,
    {
      wide: true,
      footer: `${open ? '<button class="btn" id="lClose" style="margin-right:auto">Закрити посилання</button>' : ''}${open && can('users') ? '<button class="btn" id="lPaid">Позначити оплаченим</button>' : ''}<button class="btn primary" data-close>Готово</button>`,
    });
    $('[data-c=url]', m.el).onclick = () => copy(l.page, 'Посилання скопійовано');
    $('[data-c=msg]', m.el).onclick = () => copy(open && l.paid_amount ? `${message(l)}\nУже оплачено: ${nf.format(l.paid_amount)} грн, залишок: ${nf.format(l.amount - l.paid_amount)} грн.` : message(l), 'Повідомлення скопійовано');
    $('[data-c=send]', m.el) && ($('[data-c=send]', m.el).onclick = () => sendDialog({ title: `Надіслати посилання № ${l.number}`, text: open && l.paid_amount ? `${message(l)}\nУже оплачено: ${nf.format(l.paid_amount)} грн, залишок: ${nf.format(l.amount - l.paid_amount)} грн.` : message(l), url: l.page }));
    $$('[data-attach]', m.el).forEach((b) => (b.onclick = async () => {
      try { await api('PUT', `/api/odb/payments/${b.dataset.attach}`, { link_id: l.id }); m.close(); toast('Платіж прив’язано'); loadList(); } catch (er) { toast(er.message, true); }
    }));
    const lc = $('#lClose', m.el);
    if (lc) lc.onclick = async () => { try { await api('POST', `/api/odb/links/${l.id}/close`); m.close(); toast('Посилання закрито'); loadList(); } catch (er) { toast(er.message, true); } };
    const lp = $('#lPaid', m.el);
    if (lp) lp.onclick = async () => { try { await api('POST', `/api/odb/links/${l.id}/paid`); m.close(); toast('Позначено оплаченим'); loadList(); } catch (er) { toast(er.message, true); } };
  }

  // =====================================================================
  // ПЛАТЕЖІ
  // =====================================================================
  let pf = { tab: 'all', from: addDays(kyivToday(), -29), to: kyivToday(), account: '', only: '' };
  try { pf = { ...pf, ...JSON.parse(localStorage.getItem('pay_f') || '{}') }; } catch { /* */ }
  const savePf = () => { try { localStorage.setItem('pay_f', JSON.stringify(pf)); } catch { /* */ } };

  async function viewPayments() {
    const el = main();
    el.innerHTML = `
      <div class="head-row"><h2>Платежі</h2><div class="btn-row"><span class="small muted" id="paySync"></span><button class="btn" id="payRefresh">Оновити</button></div></div>
      <div class="seg pay-tabs" role="tablist">
        <button type="button" role="tab" data-tab="all" class="${pf.tab === 'all' ? 'on' : ''}" aria-selected="${pf.tab === 'all'}">Усі платежі</button>
        <button type="button" role="tab" data-tab="mine" class="${pf.tab === 'mine' ? 'on' : ''}" aria-selected="${pf.tab === 'mine'}">Мої платежі</button>
      </div>
      <div class="card pay-filters">
        <label>З <input type="date" id="pFrom" value="${esc(pf.from)}"></label>
        <label>по <input type="date" id="pTo" value="${esc(pf.to)}"></label>
        <label>Рахунок <select id="pAcc"><option value="">усі</option></select></label>
        <label>Показати <select id="pOnly">
          <option value="" ${pf.only === '' ? 'selected' : ''}>усі надходження</option>
          <option value="ours" ${pf.only === 'ours' ? 'selected' : ''}>лише за нашими посиланнями</option>
          <option value="check" ${pf.only === 'check' ? 'selected' : ''}>потребують перевірки</option></select></label>
      </div>
      <div id="payHist"></div>
      <div id="payBody"><div class="card empty"><span class="spinner"></span></div></div>`;
    $$('[data-tab]').forEach((b) => (b.onclick = () => { pf.tab = b.dataset.tab; savePf(); $$('[data-tab]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); }); loadPayments(); }));
    const on = (id, k) => { $(id).onchange = (e) => { pf[k] = e.target.value; savePf(); loadPayments(); }; };
    on('#pFrom', 'from'); on('#pTo', 'to'); on('#pAcc', 'account'); on('#pOnly', 'only');
    $('#payRefresh').onclick = async () => { $('#payRefresh').disabled = true; await sync(true); $('#payRefresh').disabled = false; loadPayments(); };
    await loadPayments();
    const doSync = async () => {
      let r = await sync();
      if (r && (r.added || r.paid)) await loadPayments();
      // поступове завантаження історії платежів
      while (r && r.hist && !r.hist.done && $('#payBody')) {
        showHist(r.hist);
        r = await sync(true);
        if (r?.added) await loadPayments();
      }
      if (r?.hist) showHist(r.hist);
    };
    doSync();
    poll({ anchor: () => $('#payBody'), run: doSync });
  }

  function showHist(h) {
    const b = $('#payHist');
    if (!b) return;
    b.innerHTML = h && !h.done && h.total ? `<div class="an-sync"><div class="an-sync-top"><span><span class="spinner"></span> Завантажую історію платежів з Opendatabot</span><b>${Math.min(99, Math.round(((h.offset || 0) / h.total) * 100))}%</b></div>
      <div class="an-progress"><span style="width:${Math.min(99, Math.round(((h.offset || 0) / h.total) * 100))}%"></span></div></div>` : '';
  }

  async function loadPayments() {
    const box = $('#payBody');
    if (!box) return;
    const p = new URLSearchParams({ tab: pf.tab, from: pf.from, to: pf.to, account: pf.account, only: pf.only });
    try {
      const d = await api('GET', `/api/odb/payments?${p}`);
      const sel = $('#pAcc');
      if (sel && sel.options.length <= 1) sel.insertAdjacentHTML('beforeend', d.accounts.map((a) => `<option value="${esc(a.id)}" ${pf.account === a.id ? 'selected' : ''}>${esc(a.alias)} · ${KIND[a.kind]}</option>`).join(''));
      const dt = (v) => new Date(v).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      // Останнє повідомлення від Opendatabot (вебхук) — якщо давно не було, оплати приходять лише звіркою раз на 5 хв.
      if (d.lastSync && $('#paySync')) $('#paySync').textContent = `Перевірено ${dt(d.lastSync)} · вебхук Opendatabot: ${d.hookAt ? dt(d.hookAt) : 'ще не надходив'}`;
      if (!d.connected) { box.innerHTML = `<div class="alert">Opendatabot не підключено. ${can('api') ? 'Вкажіть ключ у <a href="#/rsettings">«Налаштуваннях рахунків»</a>.' : 'Зверніться до адміністратора.'}</div>`; return; }
      showHist(d.hist);
      box.innerHTML = `<div class="pay-total"><span>Надходжень: <b>${d.count}</b></span><span>Сума: <b>${uah(d.sum)}</b></span>${d.count > d.rows.length ? `<span class="small muted">показано останні ${d.rows.length}</span>` : ''}</div>
        ${d.rows.length ? `<div class="table-wrap"><table class="list pay-table"><thead><tr><th>Дата</th><th class="r">Сума</th><th>На рахунок</th><th>Платник</th><th>Призначення</th><th>Наше посилання</th></tr></thead><tbody>
        ${d.rows.map((r) => {
          const check = !r.link_id && r.possible && r.possible !== '[]';
          return `<tr class="${r.link_id ? `st-${r.link_status}` : ''}">
            <td class="small nowrap">${esc(dt(r.date))}</td>
            <td class="r nowrap"><b>${uah(r.amount)}</b>${r.currency !== 'UAH' ? ` <span class="badge">${esc(r.currency)}</span>` : ''}</td>
            <td class="small">${esc(r.account_alias || r.iban)}</td>
            <td class="small">${esc(r.payer_name)}${r.payer_code ? `<div class="muted">${esc(r.payer_code)}</div>` : ''}</td>
            <td class="small pay-purpose">${esc(r.purpose)}</td>
            <td>${r.link_id ? `<button class="linkbtn" data-open="${r.link_id}">№ ${esc(r.link_number)}</button> ${badge(r.link_status)}${r.link_author ? `<div class="small muted">${esc(r.link_author)}</div>` : ''}`
              : r.b2b?.order_id ? `<a class="linkbtn" href="#/b2borders/${r.b2b.order_id}">Закупівля ${esc(r.b2b.number)}</a> <span class="badge ok">B2B</span>`
              : r.b2b?.check ? `<div class="small"><span class="badge warn">B2B: перевірити</span> ${r.b2b.candidates.map((id) => `<a href="#/b2borders/${id}">B2B-${id}</a>`).join(', ')}</div>`
              : check ? `<button class="btn sm" data-check="${esc(r.id)}" data-amount="${r.amount}">Перевірити</button>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="card empty">За цей період надходжень немає.</div>'}`;
      $$('[data-open]', box).forEach((b) => (b.onclick = () => openLink(b.dataset.open)));
      $$('[data-check]', box).forEach((b) => (b.onclick = () => attachDialog(b.dataset.check, Number(b.dataset.amount))));
    } catch (er) { box.innerHTML = `<div class="alert bad">${esc(er.message)}</div>`; }
  }

  async function attachDialog(txId, amount) {
    const { links } = await api('GET', '/api/odb/links?filter=unpaid');
    const sorted = links.sort((a, b) => Math.abs(a.amount - a.paid_amount - amount) - Math.abs(b.amount - b.paid_amount - amount));
    const m = modal('До якого посилання цей платіж?', `<p class="small muted">Opendatabot не зміг точно визначити рахунок. Виберіть посилання — зверху найближчі за сумою (${uah(amount)}).</p>
      ${sorted.length ? `<table class="list"><tbody>${sorted.slice(0, 15).map((l) => `<tr><td><b>№ ${esc(l.number)}</b></td><td>${esc(l.client || '')}</td><td class="r">${uah(l.amount)}</td><td>${badge(l.status)}</td>
        <td><button class="btn sm" data-pick="${l.id}">Прив’язати</button></td></tr>`).join('')}</tbody></table>` : '<div class="small muted">Неоплачених посилань немає.</div>'}`, { wide: true });
    $$('[data-pick]', m.el).forEach((b) => (b.onclick = async () => {
      try { await api('PUT', `/api/odb/payments/${txId}`, { link_id: b.dataset.pick }); m.close(); toast('Платіж прив’язано'); loadPayments(); } catch (er) { toast(er.message, true); }
    }));
  }

  // =====================================================================
  // НАЛАШТУВАННЯ (власник і адміни): ключ, адреса для повідомлень, які рахунки увімкнені
  // =====================================================================
  async function settingsCard(container, settings) {
    container.insertAdjacentHTML('beforeend', `
      <section class="card form-stack odb-card" id="odbCard" style="max-width:900px;margin-top:14px">
        <h3>Opendatabot — оплати за посиланням і QR</h3>
        <form id="odbKeyF" class="grid2">
          <label class="f"><span>Ключ клієнта (x-client-key)</span><input name="odb_key" value="${esc(settings.odb_key || '')}" autocomplete="off" placeholder="з профілю Opendatabot, розділ IBAN"></label>
          <label class="f"><span>Назва клієнта (x-client-name)</span><input name="odb_name" value="${esc(settings.odb_name || '')}" autocomplete="off"></label>
          <div class="btn-row"><button class="btn primary">Зберегти ключ</button></div>
        </form>
        <div class="f"><span>Адреса для повідомлень про оплату — вставте її в налаштуваннях «Автоклієнтів» в Opendatabot</span>
          <div class="pl-url"><input readonly value="${esc(`${location.origin}/api/odb/hook`)}" aria-label="Адреса для повідомлень"><button type="button" class="btn" id="odbHookCopy">Копіювати</button></div></div>
        <div class="head-row" style="margin:6px 0 0"><h4 style="margin:0">Рахунки з Opendatabot</h4><button type="button" class="btn" id="odbRefresh">Оновити список</button></div>
        <div class="small muted">Увімкніть рахунки, на які можна створювати посилання на оплату. Платежі приходять по всіх рахунках, навіть вимкнених.
          Увімкнений ФОП також з’являється у «ФОПах рахунків» для Word-рахунків з QR-кодом. ТОВ і ПП — лише посилання.</div>
        <div id="odbAccs"><span class="spinner"></span></div>
      </section>`);
    container.insertAdjacentHTML('beforeend', `
      <section class="card form-stack" id="tgCard" style="max-width:900px;margin-top:14px">
        <h3>Telegram-бот для сповіщень про оплати</h3>
        <div class="small">${settings.tg_bot ? `Підключено бота <b>@${esc(settings.tg_bot)}</b>. Кожен користувач підключає себе сам: «Telegram» угорі сторінки → «Підключити Telegram».` : 'Бота ще не підключено.'}</div>
        <details ${settings.tg_bot ? '' : 'open'}><summary class="small">Як створити бота (2 хвилини)</summary>
          <ol class="small" style="margin:8px 0;padding-left:18px;line-height:1.6">
            <li>У Telegram відкрийте <b>@BotFather</b> і надішліть команду <code>/newbot</code>.</li>
            <li>Введіть назву (наприклад, «Ековент оплати») і ім’я бота латиницею, що закінчується на <code>bot</code>.</li>
            <li>BotFather надішле токен виду <code>1234567890:AAH…</code> — вставте його нижче й збережіть.</li>
          </ol></details>
        <form id="tgF" class="pl-url"><input name="token" value="${esc(settings.tg_token || '')}" placeholder="Токен бота від @BotFather" autocomplete="off" aria-label="Токен бота">
          <button class="btn primary">Зберегти</button>${settings.tg_bot ? '<button type="button" class="btn danger" id="tgDel">Відключити</button>' : ''}</form>
      </section>`);
    $('#tgF').onsubmit = async (e) => {
      e.preventDefault();
      const token = e.target.token.value.trim();
      if (/^•+$/.test(token)) { toast('Токен уже збережено'); return; }
      try { const r = await api('PUT', '/api/tg/settings', { token }); toast(`Бота @${r.bot} підключено`); await ctx.reloadBoot?.(); location.reload(); } catch (er) { toast(er.message, true); }
    };
    const tgDel = $('#tgDel');
    if (tgDel) tgDel.onclick = async () => { try { await api('PUT', '/api/tg/settings', { token: '' }); toast('Бота відключено'); location.reload(); } catch (er) { toast(er.message, true); } };
    $('#odbHookCopy').onclick = () => copy(`${location.origin}/api/odb/hook`, 'Адресу скопійовано');
    $('#odbKeyF').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('PUT', '/api/settings', Object.fromEntries(new FormData(e.target))); toast('Ключ збережено'); await drawAccs(true); } catch (er) { toast(er.message, true); }
    };
    $('#odbRefresh').onclick = () => drawAccs(true);
    async function drawAccs(refresh) {
      const box = $('#odbAccs');
      box.innerHTML = '<span class="spinner"></span>';
      try {
        if (refresh) await api('POST', '/api/odb/sync', { force: true }).catch(() => null); // підтягнути рахунки з платежів «Автоклієнтів»
        const { accounts, connected } = await api('GET', `/api/odb/accounts${refresh ? '?refresh=1' : ''}`);
        if (!connected) { box.innerHTML = '<div class="small muted">Вкажіть ключ і назву клієнта — список рахунків підтягнеться автоматично.</div>'; return; }
        const main = accounts.filter((x) => !x.seen);
        const others = accounts.filter((x) => x.seen);
        const row = (a) => `<tr><td>${a.seen ? `<button type="button" class="btn sm" data-reg="${esc(a.id)}" data-code="${esc(a.code)}" data-name="${esc(a.name || '')}" data-iban="${esc(a.iban)}">➕ Для рахунків</button>` : `<label class="switch"><input type="checkbox" data-acc="${esc(a.id)}" ${a.enabled ? 'checked' : ''} aria-label="Формувати рахунки на ${esc(a.alias)}"><span></span></label>`}</td>
            <td><b>${esc(a.name || a.odb_alias || '')}</b>${!a.name && !a.odb_alias ? '<span class="muted small">без назви</span>' : ''}
              <button type="button" class="linkbtn ap-ren" data-ren="${esc(a.id)}" data-name="${esc(a.name || a.odb_alias || '')}" aria-label="Перейменувати">✎</button></td>
            <td class="small">${esc(a.bank || '')}</td><td>${KIND[a.kind] || ''}</td><td class="small mono">${esc(a.iban)}</td><td class="small">${esc(a.code)}</td></tr>`;
        const head = (first) => `<thead><tr><th>${first}</th><th>Назва</th><th>Банк</th><th>Тип</th><th>IBAN</th><th>Код</th></tr></thead>`;
        box.innerHTML = `${main.length ? `<div class="table-wrap"><table class="list odb-accs">${head('Формувати')}<tbody>${main.map(row).join('')}</tbody></table></div>`
          : '<div class="small muted">У розділі «Рахунки QR IBAN» на головній Opendatabot ще немає рахунків.</div>'}
          <div class="small muted">Тут — рахунки з розділу «Рахунки QR IBAN» в Opendatabot: увімкніть перемикач «Формувати». Новий рахунок, підключений в Opendatabot як «Автоклієнт», з’являється нижче після «Оновити список» — натисніть «➕ Для рахунків».</div>
          ${others.length ? `<details class="odb-others" open><summary class="small">Рахунки, з яких лише приходять платежі «Автоклієнтів» (${others.length}). Щоб формувати на них рахунки й посилання — «➕ Для рахунків»</summary>
            <div class="table-wrap"><table class="list odb-accs">${head('')}<tbody>${others.map(row).join('')}</tbody></table></div></details>` : ''}`;
        $$('[data-acc]', box).forEach((i) => (i.onchange = async () => {
          try { await api('PUT', `/api/odb/accounts/${encodeURIComponent(i.dataset.acc)}`, { enabled: i.checked }); toast(i.checked ? 'Рахунок увімкнено' : 'Рахунок вимкнено'); await ctx.reloadBoot?.(); } catch (er) { i.checked = !i.checked; toast(er.message, true); }
        }));
        // Рахунок «лише платежі» → налаштування IBAN в Opendatabot (запит через API) і одразу «Формувати».
        $$('[data-reg]', box).forEach((b) => (b.onclick = () => {
          const m = modal('Формувати рахунки на цей рахунок', `<form id="rgF" class="form-stack">
            <div class="small">IBAN <b class="mono">${esc(b.dataset.iban)}</b> буде додано в Opendatabot у «Рахунки QR IBAN» — після цього на нього можна формувати посилання на оплату
              і (для ФОП) Word-рахунки з QR. Платежі по ньому вже відстежуються.</div>
            <label class="f"><span>Код власника: РНОКПП ФОП (10 цифр) або ЄДРПОУ ТОВ/ПП (8 цифр)</span><input name="code" value="${esc(b.dataset.code)}" inputmode="numeric" maxlength="10" required></label>
            <label class="f"><span>Назва (видно в посиланнях і рахунках)</span><input name="name" value="${esc(b.dataset.name)}" maxlength="120" placeholder="Напр. ФОП Іваненко (Приват)"></label></form>`,
          { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="rgGo">Додати й увімкнути</button>' });
          $('#rgGo', m.el).onclick = async (e) => {
            const f = $('#rgF', m.el);
            e.currentTarget.disabled = true;
            try {
              if (f.name.value.trim() && f.name.value.trim() !== b.dataset.name) await api('PUT', `/api/odb/accounts/${encodeURIComponent(b.dataset.reg)}`, { name: f.name.value.trim() });
              const r = await api('POST', `/api/odb/accounts/${encodeURIComponent(b.dataset.reg)}/register`, { code: f.code.value.trim() });
              await api('PUT', `/api/odb/accounts/${encodeURIComponent(r.id)}`, { enabled: true });
              m.close();
              toast('Рахунок додано в Opendatabot і увімкнено для формування');
              await ctx.reloadBoot?.();
              drawAccs(true);
            } catch (er) { toast(er.message, true); e.currentTarget.disabled = false; }
          };
        }));
        $$('[data-ren]', box).forEach((b) => (b.onclick = () => {
          const m = modal('Назва рахунку', `<form id="anF" class="form-stack"><label class="f"><span>Назва (видно в посиланнях, платежах і аналітиці)</span>
            <input name="name" value="${esc(b.dataset.name)}" maxlength="120" placeholder="Напр. ФОП Агафіца Вероніка (Приват)"></label>
            <div class="small muted">Залиште порожнім, щоб назва підставилась автоматично.</div></form>`,
          { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="anGo">Зберегти</button>' });
          const go = async () => { try { await api('PUT', `/api/odb/accounts/${encodeURIComponent(b.dataset.ren)}`, { name: $('#anF', m.el).name.value }); m.close(); toast('Назву збережено'); drawAccs(false); } catch (er) { toast(er.message, true); } };
          $('#anGo', m.el).onclick = go;
          $('#anF', m.el).onsubmit = (e) => { e.preventDefault(); go(); };
        }));
      } catch (er) { box.innerHTML = `<div class="alert bad">${esc(er.message)}</div>`; }
    }
    await drawAccs(false);
  }

  return { viewLinks, viewPayments, settingsCard };
}
