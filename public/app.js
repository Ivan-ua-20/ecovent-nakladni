import { renderInvoice, esc, money, dateUa, LAYOUT_NAMES, DEFAULT_OPTIONS } from './invoice.js';
import { exportDocx } from './docx-export.js';
import { renderRahunok, rahunokDocx } from './rahunok.js';
import { createAnalyticsUI } from './an.js';
import { createPayUI, STATUS as PAY_STATUS } from './pay.js';
import { createPayStatsUI } from './anpay.js';
const payBadge = (st) => { const [t, c] = PAY_STATUS[st] || [st, '']; return `<span class="badge ${c}">QR · ${t}</span>`; };

// ---------- утиліти ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const main = $('#main');
const MASK = '••••••';

// Сервер на Cloudflare може відповісти «обробка триває» (202), якщо пошук у LP-CRM довгий, — тоді повторюємо запит.
let onPending = null;
async function api(method, url, body, attempt = 0) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 202 && json.pending) {
    if (attempt >= 60) throw new Error('Пошук триває надто довго. Спробуйте ще раз або введіть код замовлення.');
    onPending?.(attempt + 1);
    await new Promise((r) => setTimeout(r, 400));
    return api(method, url, body, attempt + 1);
  }
  if (res.status === 401 && !url.startsWith('/api/auth/')) { showAuth(); throw new Error(json.error || 'Потрібно увійти'); }
  if (!res.ok) throw new Error(json.error || `Помилка ${res.status}`);
  return json;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), bad ? 5000 : 2600);
}

function modal(title, bodyHtml, { footer = '', wide = false } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" style="${wide ? 'width:min(1000px,100%)' : ''}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="btn sm" data-close>✕</button></div>
    <div class="modal-body">${bodyHtml}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(bg);
  return { el: bg, close };
}

const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Стиснення зображень (логотип, підпис, печатка) перед збереженням.
function readImage(file, max = 700) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- стан ----------
let boot = { fops: [], templates: [], offices: [], channels: [], invFops: [], settings: {}, user: null };
const can = (perm) => Boolean(boot.user?.perms?.includes(perm));

// Розділи (вкладки зверху) і підвкладки кожного розділу.
const SECTIONS = [
  { id: 'nakladni', label: 'Накладні ФОП', home: 'invoice', tabs: [
    { id: 'invoice', label: 'Формування' },
    { id: 'history', label: 'Історія' },
    { id: 'fops', label: 'ФОПи накладних', perm: 'refs.edit' },
    { id: 'offices', label: 'Відділи, поле 1 → ФОП', perm: 'refs.edit' },
    { id: 'templates', label: 'Шаблони', perm: 'refs.edit' },
    { id: 'nsettings', label: 'Налаштування накладних', perm: 'refs.edit' },
  ] },
  { id: 'rahunky', label: 'Рахунки Word', home: 'rahunky', tabs: [
    { id: 'rahunky', label: 'Формування', perm: 'docs.edit' },
    { id: 'rlist', label: 'Сформовані рахунки' },
    { id: 'paylinks', label: 'Посилання на оплату', perm: 'docs.edit' },
    { id: 'payments', label: 'Платежі', perm: 'docs.edit' },
    { id: 'invfops', label: 'ФОПи рахунків', perm: 'refs.edit' },
    { id: 'rsettings', label: 'Налаштування рахунків', perm: 'refs.edit' },
  ] },
  { id: 'an', label: 'Аналітика', perm: 'an.view', home: 'an', tabs: [
    { id: 'an', label: 'Дашборд' },
    { id: 'anpay', label: 'Оплати', perm: 'analytics' },
    { id: 'ansettings', label: 'Налаштування аналітики', perm: 'analytics' },
  ] },
  { id: 'settings', label: 'Налаштування', perm: 'refs.edit', home: 'settings', tabs: [{ id: 'settings', label: 'Загальні налаштування' }] },
  { id: 'users', label: 'Користувачі', perm: 'users', home: 'users', tabs: [{ id: 'users', label: 'Користувачі' }] },
];
const visibleTabs = (sec) => sec.tabs.filter((t) => !t.perm || can(t.perm));
const sectionOf = (routeId) => SECTIONS.find((sec) => sec.tabs.some((t) => t.id === routeId)) || SECTIONS[0];

function renderNav(active = 'invoice') {
  const u = boot.user;
  const s = boot.settings;
  const cur = sectionOf(active);
  const secs = SECTIONS.filter((sec) => (!sec.perm || can(sec.perm)) && visibleTabs(sec).length);
  const homeOf = (sec) => (visibleTabs(sec).some((t) => t.id === sec.home) ? sec.home : visibleTabs(sec)[0].id);
  $('.topbar').innerHTML = `
    <div class="brand"><span class="brand-mark"></span>Накладні</div>
    <nav class="main-tabs" aria-label="Розділи">
      ${secs.map((sec) => `<a href="#/${homeOf(sec)}" class="${sec.id === cur.id ? 'active' : ''}">${esc(sec.label)}</a>`).join('')}
    </nav>
    <div class="top-user">
      ${can('api') && !s.lpcrm_key ? '<a href="#/settings" class="top-warn">LP-CRM не підключено</a>' : ''}
      <span><b>${esc(u?.name || '')}</b> · ${esc(u?.role_name || '')}</span>
      <a href="#" id="navTg">Telegram</a><a href="#" id="navPwd">Пароль</a><a href="#" id="navOut">Вийти</a>
    </div>`;
  const tabs = visibleTabs(cur);
  $('.subnav').innerHTML = tabs.length > 1
    ? tabs.map((t) => `<a href="#/${t.id}" class="${t.id === active ? 'active' : ''}">${esc(t.label)}</a>`).join('')
    : '';
  $('.subnav').hidden = tabs.length <= 1;
  $('#navOut').onclick = async (e) => {
    e.preventDefault();
    await api('POST', '/api/auth/logout');
    showAuth();
  };
  $('#navPwd').onclick = (e) => { e.preventDefault(); changeOwnPassword(); };
  $('#navTg').onclick = (e) => { e.preventDefault(); tgDialog(); };
}

// Мій Telegram: підключення одним натисканням (бот сам отримує ID), для адмінів — що надсилати.
async function tgDialog() {
  let me;
  try { me = await api('GET', '/api/tg/me'); } catch (e) { toast(e.message, true); return; }
  const admin = can('users');
  const body = () => `
    ${!me.bot ? `<div class="alert">Telegram-бота ще не підключено. ${can('api') ? 'Вставте токен бота в <a href="#/rsettings" data-close>«Рахунки Word → Налаштування рахунків»</a>.' : 'Зверніться до власника або адміністратора.'}</div>`
      : me.connected ? `<div class="alert info">✅ Telegram підключено до бота <b>@${esc(me.bot)}</b>. Сюди надходитимуть сповіщення про оплату рахунків, які ви створили.</div>`
        : `<p>Натисніть кнопку — відкриється бот <b>@${esc(me.bot)}</b>. Натисніть у ньому <b>«Start»</b> (або «Почати»), і ваш Telegram прив’яжеться до цього акаунта автоматично.</p>
          <div class="btn-row"><button class="btn primary" id="tgGo">Підключити Telegram</button></div><div class="small muted" id="tgWait"></div>`}
    ${me.bot && admin ? `<div class="form-stack" style="margin-top:14px"><h4 style="margin:0">Що ще надсилати мені (для адміністраторів)</h4>
      <label class="check"><input type="checkbox" id="tgAllLinks" ${me.allLinks ? 'checked' : ''}> Оплати за посиланнями всіх менеджерів</label>
      <label class="check"><input type="checkbox" id="tgAllTx" ${me.allTx ? 'checked' : ''}> Усі надходження на рахунки Opendatabot</label></div>` : ''}`;
  const m = modal('Сповіщення в Telegram', body(), { footer: `${me.connected ? '<button class="btn danger" id="tgOff" style="margin-right:auto">Відключити</button>' : ''}<button class="btn primary" data-close>Готово</button>` });
  const wire = () => {
    const go = $('#tgGo', m.el);
    if (go) go.onclick = async () => {
      try {
        const r = await api('POST', '/api/tg/link');
        window.open(r.url, '_blank', 'noopener');
        $('#tgWait', m.el).innerHTML = '<span class="spinner"></span> Чекаю, поки ви натиснете «Start» у боті…';
        for (let i = 0; i < 60 && document.body.contains(m.el); i++) {
          await new Promise((ok) => setTimeout(ok, 3000));
          me = await api('GET', '/api/tg/me');
          if (me.connected) { $('.modal-body', m.el).innerHTML = body(); wire(); toast('Telegram підключено'); return; }
        }
      } catch (er) { toast(er.message, true); }
    };
    const save = async () => {
      try { await api('PUT', '/api/tg/me', { allLinks: $('#tgAllLinks', m.el).checked, allTx: $('#tgAllTx', m.el).checked }); toast('Збережено'); } catch (er) { toast(er.message, true); }
    };
    $('#tgAllLinks', m.el) && ($('#tgAllLinks', m.el).onchange = save);
    $('#tgAllTx', m.el) && ($('#tgAllTx', m.el).onchange = save);
  };
  wire();
  const off = $('#tgOff', m.el);
  if (off) off.onclick = async () => { try { await api('DELETE', '/api/tg/me'); m.close(); toast('Telegram відключено'); } catch (er) { toast(er.message, true); } };
}

let activeRoute = 'invoice';
async function loadBoot() {
  boot = await api('GET', '/api/bootstrap');
  renderNav(activeRoute);
}
const activeFops = () => boot.fops.filter((f) => f.active);
const fopById = (id) => boot.fops.find((f) => String(f.id) === String(id));
const tplById = (id) => boot.templates.find((t) => String(t.id) === String(id));

// ---------- вхід ----------
async function showAuth() {
  document.body.classList.add('auth-mode');
  const st = await fetch('/api/auth/state').then((r) => r.json()).catch(() => ({}));
  if (st.user) { document.body.classList.remove('auth-mode'); return start(); }
  const setup = st.needsSetup;
  let box = $('#auth');
  if (!box) { box = document.createElement('div'); box.id = 'auth'; document.body.appendChild(box); }
  box.innerHTML = `<form class="auth-card" id="authForm">
      <div class="brand dark"><span class="brand-mark"></span>Накладні</div>
      <h2>${setup ? 'Створення акаунта власника' : 'Вхід'}</h2>
      ${setup ? '<p class="muted small">Перший запуск. Власник має повний доступ і створює акаунти для інших. Власник лише один.</p>' : ''}
      ${setup ? '<label class="f"><span>Ім’я (показується в історії)</span><input name="name" autocomplete="name"></label>' : ''}
      <label class="f"><span>Логін</span><input name="login" autocomplete="username" required autofocus></label>
      <label class="f"><span>Пароль${setup ? ' (від 6 символів)' : ''}</span><input name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
      ${setup ? '<label class="f"><span>Пароль ще раз</span><input name="password2" type="password" autocomplete="new-password" required></label>' : ''}
      <div class="alert bad" id="authErr" hidden></div>
      <button class="btn primary">${setup ? 'Створити і увійти' : 'Увійти'}</button>
      ${setup ? '' : '<p class="muted small">Забули пароль? Зверніться до адміністратора. Пароль власника скидається на комп’ютері з програмою (див. README).</p>'}
    </form>`;
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const err = $('#authErr');
    err.hidden = true;
    if (setup && d.password !== d.password2) { err.textContent = 'Паролі не збігаються.'; err.hidden = false; return; }
    try {
      await api('POST', setup ? '/api/auth/setup' : '/api/auth/login', d);
      box.remove();
      document.body.classList.remove('auth-mode');
      start();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
}

function changeOwnPassword() {
  const m = modal('Змінити пароль', `<form id="pwF" class="form-stack">
      <label class="f"><span>Поточний пароль</span><input name="old" type="password" required></label>
      <label class="f"><span>Новий пароль (від 6 символів)</span><input name="password" type="password" required></label>
    </form>`, { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="pwSave">Зберегти</button>' });
  $('#pwSave', m.el).onclick = async () => {
    try { await api('PUT', '/api/me/password', Object.fromEntries(new FormData($('#pwF', m.el)))); m.close(); toast('Пароль змінено'); }
    catch (e) { toast(e.message, true); }
  };
}

// ---------- роутер ----------
const routes = {
  invoice: viewInvoice,
  history: viewHistory,
  fops: viewFops,
  offices: viewOffices,
  templates: viewTemplates,
  nsettings: viewNakladniSettings,
  rahunky: viewRahunky,
  rlist: viewRahunkyList,
  paylinks: () => PAY.viewLinks(),
  anpay: () => PAYSTATS.view(),
  payments: () => PAY.viewPayments(),
  invfops: viewInvFops,
  rsettings: viewRahunkySettings,
  an: (...a) => AN.viewDashboard(...a),
  ansettings: (...a) => AN.viewSettings(...a),
  settings: viewSettings,
  users: viewUsers,
};

async function route() {
  if (!boot.user) return;
  let [, name = 'invoice', ...args] = location.hash.replace(/^#/, '').split('/');
  if (!routes[name]) name = 'invoice';
  const sec = sectionOf(name);
  const tab = sec.tabs.find((t) => t.id === name);
  // Розділ «Рахунки» для перегляду відкриває список, а не формування
  if (name === 'rahunky' && !can('docs.edit')) { location.hash = '#/rlist'; return; }
  activeRoute = name;
  document.body.classList.toggle('an-mode', sec.id === 'an');
  renderNav(name);
  try {
    if ((sec.perm && !can(sec.perm)) || (tab?.perm && !can(tab.perm))) throw new Error('Немає доступу до цього розділу.');
    await routes[name](...args.map((x) => decodeURIComponent(x)));
  } catch (e) {
    main.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// =====================================================================
// НАКЛАДНА
// =====================================================================
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
        <input id="orderInput" placeholder="Номер, код, телефон або ТТН" value="${esc(orderId || '')}" autocomplete="off" autofocus>
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
  if (orderId) await loadInvoice(orderId);
  else {
    $('#invArea').innerHTML = `<div class="card empty"><div class="big">Введіть номер замовлення з LP-CRM</div>
      Накладна сформується автоматично: товари, покупець і ФОП (з чека Checkbox або за відділом).</div>`;
  }
}

async function loadInvoice(orderId, fresh = false) {
  const area = $('#invArea');
  area.innerHTML = `<div class="card empty"><span class="spinner"></span> Завантажую замовлення №${esc(orderId)}… <div class="small" style="margin-top:6px">Перший пошук за номером може тривати до хвилини: програма завантажує список замовлень із LP-CRM. Далі — кілька секунд.</div></div>`;
  onPending = (n) => { const el = $('#invArea .empty'); if (el) el.innerHTML = `<span class="spinner"></span> Шукаю замовлення №${esc(orderId)} у LP-CRM… (крок ${n + 1})`; };
  try {
    current = await api('GET', `/api/invoice/${encodeURIComponent(orderId)}${fresh ? '?fresh=1' : ''}`);
    current.requestedId = orderId;
    renderInvoiceView();
  } catch (e) {
    current = null;
    if ($('#invActions')) $('#invActions').innerHTML = '';
    area.innerHTML = `<div class="alert bad"><b>Не вдалося отримати замовлення.</b><br>${esc(e.message)}</div>`;
  }
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
        : `<div class="muted small">${boot.fops.some((f) => f.has_checkbox) ? (boot.settings.checkbox_enabled === '1' ? 'Чек не знайдено автоматично.' : 'Автопошук чеків вимкнено в налаштуваннях.') : 'Доступ до Checkbox ще не додано в жодного ФОП.'} Можна вказати чек вручну.</div>`}
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
          ${boot.templates.map((t) => `<option value="${t.id}" ${String(inv.template?.id) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
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

function printHtml(html) {
  $('#print-root').innerHTML = html;
  const imgs = $$('#print-root img');
  Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => {
    window.print();
  });
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
        <input id="hQ" placeholder="Номер, код, телефон або ТТН" style="width:200px">
        <select id="hFop" style="width:220px"><option value="">Усі ФОПи</option>${boot.fops.map((f) => `<option value="${f.id}">${esc(f.short_name)}</option>`).join('')}</select>
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
      : '<div class="card empty">Ще немає сформованих накладних</div>';
    $$('[data-o]').forEach((tr) => (tr.onclick = () => (location.hash = `#/invoice/${encodeURIComponent(tr.dataset.o)}`)));
  };
  let t;
  $('#hQ').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  $('#hFop').onchange = load;
  await load();
}

// =====================================================================
// ФОПи
// =====================================================================
async function viewFops(id) {
  await loadBoot();
  if (id) return viewFopForm(id);
  const officeCount = (fid) => boot.offices.filter((o) => String(o.fop_id) === String(fid)).length;
  main.innerHTML = `
    <div class="head-row"><h2>ФОПи</h2><a class="btn primary" href="#/fops/new">+ Додати ФОП</a></div>
    <div class="fop-cards">
      ${boot.fops.map((f) => {
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

function imgField(key, label, value, hint) {
  return `<label class="f"><span>${label}</span>
    <div class="img-field">
      <div class="img-prev" id="prev_${key}">${value ? `<img src="${value}">` : '<span class="small muted">немає</span>'}</div>
      <div class="btn-row">
        <label class="btn sm">Завантажити<input type="file" accept="image/*" data-img="${key}" hidden></label>
        <button type="button" class="btn sm danger" data-clear="${key}">Прибрати</button>
      </div>
    </div>
    <span class="small muted" style="font-weight:400">${hint}</span></label>`;
}

function viewFopForm(id) {
  const isNew = id === 'new';
  const f = isNew ? { active: 1, template_id: boot.templates[0]?.id } : fopById(id);
  if (!f) throw new Error('ФОП не знайдено');
  const imgs = { logo: f.logo || '', signature: f.signature || '', stamp: f.stamp || '' };
  const inp = (k, label, ph = '', type = 'text') => `<label class="f"><span>${label}</span><input type="${type}" name="${k}" value="${esc(f[k] ?? '')}" placeholder="${esc(ph)}"></label>`;
  main.innerHTML = `
    <div class="head-row"><h2>${isNew ? 'Новий ФОП' : esc(f.short_name)}</h2>
      <div class="btn-row"><a class="btn" href="#/fops">← До списку</a></div></div>
    <form id="fopForm" class="form-page">
      <div class="form-stack">
        <div class="card form-stack">
          <h3>Реквізити</h3>
          ${inp('short_name', 'Коротка назва (у списку)', 'ФОП Агафіца А.М.')}
          ${inp('full_name', 'ПІБ повністю', 'Агафіца Анна Миколаївна')}
          <div class="grid2">${inp('ipn', 'ІПН (РНОКПП)', '1234567890')}${inp('phone', 'Телефон', '+380…')}</div>
          ${inp('address', 'Адреса')}
          <div class="grid2">${inp('iban', 'IBAN', 'UA…')}${inp('bank', 'Банк', 'АТ «…»')}</div>
          ${inp('email', 'E-mail')}
          <label class="f"><span>Додатковий рядок у реквізитах</span><textarea name="extra" placeholder="Напр.: Платник єдиного податку 3 групи">${esc(f.extra || '')}</textarea></label>
        </div>
        <div class="card form-stack">
          <h3>Накладна</h3>
          <label class="f"><span>Шаблон за замовчуванням</span><select name="template_id">
            ${boot.templates.map((t) => `<option value="${t.id}" ${String(f.template_id) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select></label>
          ${imgField('logo', 'Логотип', imgs.logo, 'Показується в брендованому шаблоні.')}
          ${imgField('signature', 'Підпис', imgs.signature, 'PNG з прозорим фоном виглядає найкраще.')}
          ${imgField('stamp', 'Печатка', imgs.stamp, 'Необов’язково.')}
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
          <div class="small">${boot.offices.filter((o) => String(o.fop_id) === String(f.id)).map((o) => `<div>${esc(o.office_id)} · ${esc(o.name)}</div>`).join('') || '<span class="muted">Немає</span>'}</div>
          <a class="small" href="#/offices">Змінити прив’язку відділів</a>
        </div>
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
    $(`#prev_${key}`).innerHTML = `<img src="${imgs[key]}">`;
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
        <tbody id="chBody">${boot.channels.map(chRow).join('')}</tbody></table>
      </div>
      <div style="min-width:0">
        <div class="head-row"><h3 style="margin:0">Відділи LP-CRM</h3><button class="btn sm" id="oAdd">+ Відділ</button></div>
        <div class="muted small" style="margin-bottom:8px">Використовується, якщо поле 1 порожнє або не прив'язане.</div>
        <table class="list"><thead><tr><th>ID</th><th>Назва відділу</th><th>ФОП</th><th>Назва продавця в накладній</th><th></th></tr></thead>
        <tbody id="oBody">${boot.offices.map(row).join('')}</tbody></table>
      </div>
    </div>`;
  $('#oAdd').onclick = () => $('#oBody').insertAdjacentHTML('beforeend', row());
  $('#chAdd').onclick = () => $('#chBody').insertAdjacentHTML('afterbegin', chRow());
  $('#chBody').addEventListener('click', (e) => { if (e.target.closest('[data-chdel]')) e.target.closest('tr').remove(); });
  $('#oBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (b.dataset.del) await api('DELETE', `/api/offices/${encodeURIComponent(b.dataset.del)}`);
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
      ${boot.templates.map((t) => `<tr class="click" data-t="${t.id}"><td><b>${esc(t.name)}</b></td><td>${esc(LAYOUT_NAMES[t.layout] || t.layout)}</td><td>${esc(t.options.title || '')}</td><td>${boot.fops.filter((f) => f.active && String(f.template_id) === String(t.id)).length}</td></tr>`).join('')}
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
    try { await api('DELETE', `/api/templates/${id}`); toast('Видалено'); location.hash = '#/templates'; } catch (err) { toast(err.message, true); }
  };
}

// =====================================================================
// НАЛАШТУВАННЯ
// =====================================================================
async function viewSettings() {
  await loadBoot();
  const s = boot.settings;
  const apiOk = can('api');
  main.innerHTML = `
    <h2>Загальні налаштування</h2>
    <div class="form-page">
      <div class="form-stack">
        ${!apiOk ? '<div class="card muted small">Налаштування LP-CRM і Checkbox доступні власнику та адміністраторам. Налаштування накладних і рахунків — у відповідних розділах.</div>' : ''}
        ${apiOk ? `<form class="card form-stack" id="sApi">
          <h3>LP-CRM і Checkbox (API)</h3>
          <label class="f"><span>Піддомен</span><div style="display:flex;align-items:center;gap:6px"><input name="lpcrm_subdomain" value="${esc(s.lpcrm_subdomain || '')}" style="max-width:200px"><span class="muted">.lp-crm.biz</span></div></label>
          <label class="f"><span>API-ключ</span><input name="lpcrm_key" type="password" value="${esc(s.lpcrm_key || '')}" placeholder="Вставте ключ з розділу API в LP-CRM"></label>
          <label class="f" style="max-width:300px"><span>Шукати замовлення за номером серед останніх (днів)</span><input name="lpcrm_search_days" type="number" min="1" max="365" value="${esc(s.lpcrm_search_days || '30')}"></label>
          <label class="check"><input type="checkbox" name="checkbox_enabled" ${s.checkbox_enabled === '1' ? 'checked' : ''}> Автоматично шукати чек у Checkbox</label>
          <label class="f" style="max-width:260px"><span>Шукати чеки протягом (днів від дати замовлення)</span><input name="checkbox_search_days" type="number" min="1" max="60" value="${esc(s.checkbox_search_days || '7')}"></label>
          <div class="btn-row"><button class="btn primary">Зберегти</button></div>
          <hr style="border:0;border-top:1px solid var(--line);width:100%">
          <label class="f"><span>Перевірка: номер замовлення</span><div style="display:flex;gap:6px;flex-wrap:wrap"><input id="sTestId" placeholder="Напр. 106897" style="max-width:180px"><button type="button" class="btn" id="sTest">Перевірити</button><button type="button" class="btn" id="sDiag">Діагностика API</button></div></label>
          <div class="small muted">«Діагностика» робить кілька запитів на читання (~15 с) і показує, що саме віддає LP-CRM.</div>
          <pre class="raw" id="sTestOut" hidden></pre>
        </form>` : ''}
      </div>
      <div class="form-stack">
        <form class="card form-stack" id="sGen">
          <h3>Зберігання</h3>
          <label class="f" style="max-width:260px"><span>Скільки днів зберігати історію накладних і рахунки</span><input name="retention_days" type="number" min="1" max="3650" value="${esc(s.retention_days || '7')}"></label>
          <div class="muted small">Старші версії накладних і рахунки видаляються автоматично.</div>
          <div class="btn-row"><button class="btn primary">Зберегти</button></div>
        </form>
        ${can('users') ? `<div class="card form-stack">
          <h3>Перенесення налаштувань</h3>
          <div class="muted small">ФОПи накладних і рахунків (з підписами й печатками), відділи, поле 1, шаблони і загальні налаштування — одним файлом.
            Ключ LP-CRM, доступи Checkbox, користувачі й історія не переносяться. Імпорт <b>замінює</b> поточні довідники.</div>
          <div class="btn-row"><button type="button" class="btn" id="sExport">Завантажити файл налаштувань</button>
            <label class="btn">Імпортувати файл<input type="file" accept=".json,application/json" id="sImport" hidden></label></div>
        </div>` : ''}
      </div>
    </div>`;
  if (can('users')) {
    $('#sExport').onclick = async () => {
      const data = await api('GET', '/api/admin/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      a.download = `nakladni-nalashtuvannya-${todayKyiv()}.json`;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    $('#sImport').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const r = await api('POST', '/api/admin/import', JSON.parse(await file.text()));
        toast(`Імпортовано: ФОПів ${r.counts.fops ?? 0}, ФОПів рахунків ${r.counts.inv_fops ?? 0}, відділів ${r.counts.offices ?? 0}`);
        await viewSettings();
      } catch (er) { toast('Імпорт: ' + er.message, true); }
    };
  }
  const save = async (form, extra = {}) => {
    const d = { ...Object.fromEntries(new FormData(form)), ...extra };
    try { await api('PUT', '/api/settings', d); toast('Збережено'); await viewSettings(); } catch (err) { toast(err.message, true); }
  };
  $('#sGen').onsubmit = (e) => { e.preventDefault(); save(e.target); };
  if (!apiOk) return;
  $('#sApi').onsubmit = (e) => { e.preventDefault(); save(e.target, { checkbox_enabled: e.target.checkbox_enabled.checked ? '1' : '0' }); };
  $('#sTest').onclick = async () => {
    const id = $('#sTestId').value.trim();
    if (!id) return;
    const out = $('#sTestOut');
    out.hidden = false;
    out.textContent = 'Запит до LP-CRM…';
    try { out.textContent = JSON.stringify(await api('GET', `/api/lpcrm/raw/${encodeURIComponent(id)}`), null, 2); }
    catch (err) { out.textContent = err.message; }
  };
  $('#sDiag').onclick = async () => {
    const id = $('#sTestId').value.trim();
    if (!id) { toast('Вкажіть номер замовлення', true); return; }
    const out = $('#sTestOut');
    out.hidden = false;
    out.textContent = 'Діагностика… (близько 15 секунд)';
    try {
      const r = await api('GET', `/api/lpcrm/diagnose/${encodeURIComponent(id)}`);
      out.textContent = r.text;
      try { await navigator.clipboard.writeText(r.text); toast('Результат скопійовано в буфер обміну'); } catch { /* немає доступу */ }
    } catch (err) { out.textContent = err.message; }
  };
}

// Налаштування окремих розділів — та сама таблиця settings, інші поля.
async function sectionSettings(title, fields, note = '') {
  await loadBoot();
  main.innerHTML = `<h2>${esc(title)}</h2>
    <form class="card form-stack" id="secForm" style="max-width:640px">${fields(boot.settings)}
      ${note ? `<div class="muted small">${note}</div>` : ''}
      <div class="btn-row"><button class="btn primary">Зберегти</button></div></form>`;
  $('#secForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/settings', Object.fromEntries(new FormData(e.target))); toast('Збережено'); await loadBoot(); } catch (err) { toast(err.message, true); }
  };
}

function viewNakladniSettings() {
  return sectionSettings('Налаштування накладних', (s) => `
    <label class="f"><span>ФОП, якщо не визначено ні чеком, ні полем 1, ні відділом</span><select name="default_fop_id"><option value="">— не підставляти —</option>
      ${activeFops().map((f) => `<option value="${f.id}" ${String(s.default_fop_id) === String(f.id) ? 'selected' : ''}>${esc(f.short_name)}</option>`).join('')}</select></label>
    <label class="f"><span>Дата накладної</span><select name="invoice_date_mode">
      <option value="today" ${s.invoice_date_mode !== 'order' ? 'selected' : ''}>День формування накладної</option>
      <option value="order" ${s.invoice_date_mode === 'order' ? 'selected' : ''}>Дата створення замовлення в CRM</option></select></label>`,
  'Порядок визначення ФОП: вибір вручну → чек Checkbox → поле 1 → відділ → ФОП за замовчуванням. Відповідності — у вкладці «Відділи, поле 1 → ФОП».');
}

async function viewRahunkySettings() {
  await sectionSettings('Налаштування рахунків', (s) => `
    <label class="f" style="max-width:260px"><span>Наступний номер ручного рахунку</span><input name="rahunok_next_number" inputmode="numeric" value="${esc(s.rahunok_next_number || '10516')}"></label>`,
  'Рахунок із замовлення CRM отримує номер замовлення. Ручні рахунки і посилання на оплату без замовлення нумеруються по порядку, спільно для всіх ФОПів. Реквізити, підпис і печатку — у вкладці «ФОПи рахунків».');
  if (can('api')) await PAY.settingsCard(main, boot.settings);
}

// =====================================================================
// РАХУНКИ (WORD)
// =====================================================================
const activeInvFops = () => boot.invFops.filter((f) => f.active);
const todayKyiv = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());

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
  const load = async () => {
    const r = await api('GET', `/api/rahunky?q=${encodeURIComponent($('#rQ').value)}`);
    $('#rList').innerHTML = (r.rows.length
      ? `<div class="table-wrap"><table class="list"><thead><tr><th>№</th><th>Клієнт</th><th>ФОП</th><th>Сума</th><th>Створено</th><th></th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr class="click ${x.pay_status ? `st-${x.pay_status}` : ''}" data-r="${x.id}"><td><b>${esc(x.number)}</b> <span class="badge">${x.source === 'crm' ? 'CRM' : 'вручну'}</span>${x.pay_status ? ` ${payBadge(x.pay_status)}` : ''}</td>
          <td>${esc(x.client_name)}</td><td>${esc(x.fop_name)}</td><td>${money(x.total)} грн</td>
          <td class="small">${esc(fmtDateTime(x.created_at))}<br><span class="muted">${esc(x.created_by || '')}</span></td>
          <td><div class="btn-row" style="justify-content:flex-end"><button class="btn sm" data-word="${x.id}">Word</button><button class="btn sm" data-pdf="${x.id}">PDF</button></div></td></tr>`).join('')}
        </tbody></table></div>`
      : '<div class="card empty">Рахунків ще немає</div>') + `<div class="small muted" style="margin-top:8px">Рахунки зберігаються ${r.retentionDays} дн. Наступний номер ручного рахунку: ${esc(r.nextNumber)}.</div>`;
    $$('[data-r]').forEach((tr) => (tr.onclick = (e) => {
      if (e.target.closest('button')) return;
      location.hash = `#/rahunky/edit/${tr.dataset.r}`;
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
      ${isCrm && !saved ? `<form id="rOrderF"><label for="rOrder" class="sr-only">Замовлення CRM</label><input id="rOrder" placeholder="Номер, код, телефон або ТТН" autofocus><button class="btn primary">Підтягнути</button></form>`
        : `<h2 class="bar-title">${saved ? `Рахунок № ${esc(state.number)}` : 'Рахунок вручну'}</h2>`}
      <div class="bar-actions">
        <button class="btn primary" id="rWord">Завантажити Word</button>
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

  const fopObj = () => boot.invFops.find((f) => String(f.id) === String($('#rFop').value)) || {};
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
    return { number: state.number || nextNumber || '—', date: state.date, fop: { ...f, warning_text: f.warning_text || boot.defaultWarning }, client: state.client, items, total, pay };
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
    try { await api('DELETE', `/api/rahunky/${saved.id}`); toast('Рахунок видалено'); location.hash = '#/rlist'; } catch (er) { toast(er.message, true); }
  });
}

// =====================================================================
// ФОПи РАХУНКІВ
// =====================================================================
async function viewInvFops(id) {
  await loadBoot();
  if (id) return invFopForm(id);
  main.innerHTML = `
    <div class="head-row"><h2>ФОПи для рахунків</h2>${can('users') ? '<a class="btn primary" href="#/invfops/new">+ Додати ФОП</a>' : ''}</div>
    <div class="muted small" style="margin-bottom:12px">Окремий список від ФОПів накладних. Від цих ФОПів виставляються рахунки на оплату. ФОП, увімкнені в Opendatabot (у «Налаштуваннях рахунків»), додаються сюди автоматично — доповніть їхні реквізити для Word.</div>
    ${boot.invFops.length ? `<div class="fop-cards">${boot.invFops.map((f) => {
      const ok = f.full_name && f.ipn && f.iban && f.bank && f.address;
      return `<a class="card fop-card ${f.active ? '' : 'inactive'}" href="#/invfops/${f.id}" style="text-decoration:none;color:inherit">
        <div class="name">${esc(f.short_name)}</div>
        <div class="muted small">${esc(f.full_name || 'Повну назву не вказано')}</div>
        <div class="tags">${ok ? '<span class="badge ok">реквізити є</span>' : '<span class="badge warn">заповніть реквізити</span>'}
          ${f.signature ? '<span class="badge">підпис</span>' : ''}${f.stamp ? '<span class="badge">печатка</span>' : ''}
          ${f.odb_id ? '<span class="badge info">Opendatabot · QR</span>' : ''}${f.active ? '' : '<span class="badge bad">вимкнено</span>'}</div></a>`;
    }).join('')}</div>` : '<div class="card empty">Ще немає ФОПів для рахунків</div>'}`;
}

function invFopForm(id) {
  const isNew = id === 'new';
  const f = isNew ? { active: 1, warning_text: boot.defaultWarning } : boot.invFops.find((x) => String(x.id) === String(id));
  if (!f) throw new Error('ФОП не знайдено');
  const imgs = { signature: f.signature || '', stamp: f.stamp || '' };
  const inp = (k, label, ph = '') => `<label class="f"><span>${label}</span><input name="${k}" value="${esc(f[k] ?? '')}" placeholder="${esc(ph)}"></label>`;
  main.innerHTML = `
    <div class="head-row"><h2>${isNew ? 'Новий ФОП для рахунків' : esc(f.short_name)}</h2><a class="btn" href="#/invfops">← До списку</a></div>
    <form id="ifForm" class="form-page">
      <div class="card form-stack">
        <h3>Реквізити</h3>
        ${inp('short_name', 'Коротка назва (у списку)', 'ФОП Лупу В.Ф.')}
        ${inp('full_name', 'Повна назва в рахунку', 'ФОП Лупу Віра Філаретівна')}
        <div class="grid2">${inp('ipn', 'ІПН (РНОКПП)', '1234567890')}${inp('phone', 'Телефон (необов’язково)', '+380…')}</div>
        ${inp('iban', 'IBAN', 'UA…')}
        ${inp('bank', 'Банк', 'АТ КБ «ПриватБанк»')}
        <label class="f"><span>Адреса реєстрації</span><textarea name="address" rows="2" placeholder="Україна, 58018, Чернівецька обл., м. Чернівці, вул. …">${esc(f.address || '')}</textarea></label>
      </div>
      <div class="form-stack">
        <div class="card form-stack">
          <h3>Рахунок</h3>
          <label class="f"><span>Текст попередження над рахунком</span><textarea name="warning_text" rows="4">${esc(f.warning_text || '')}</textarea></label>
          ${imgField('signature', 'Підпис', imgs.signature, 'PNG з прозорим фоном виглядає найкраще.')}
          ${imgField('stamp', 'Печатка', imgs.stamp, 'Необов’язково.')}
          <label class="check"><input type="checkbox" name="active" ${f.active ? 'checked' : ''}> Активний (показувати у виборі)</label>
        </div>
        <div class="btn-row"><button class="btn primary">Зберегти</button></div>
      </div>
    </form>`;
  const form = $('#ifForm');
  $$('[data-img]', form).forEach((input) => (input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    imgs[input.dataset.img] = await readImage(file, input.dataset.img === 'stamp' ? 500 : 700);
    $(`#prev_${input.dataset.img}`).innerHTML = `<img src="${imgs[input.dataset.img]}">`;
  }));
  $$('[data-clear]', form).forEach((b) => (b.onclick = () => { imgs[b.dataset.clear] = ''; $(`#prev_${b.dataset.clear}`).innerHTML = '<span class="small muted">немає</span>'; }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = { ...Object.fromEntries(new FormData(form)), ...imgs, active: form.active.checked ? 1 : 0 };
    try {
      if (isNew) { const r = await api('POST', '/api/inv-fops', d); toast('ФОП додано'); location.hash = `#/invfops/${r.id}`; }
      else { await api('PUT', `/api/inv-fops/${id}`, d); toast('Збережено'); await viewInvFops(id); }
    } catch (er) { toast(er.message, true); }
  };
}

// =====================================================================
// КОРИСТУВАЧІ
// =====================================================================
async function viewUsers() {
  const [{ users, roles }, vals] = await Promise.all([api('GET', '/api/users'), can('analytics') ? api('GET', '/api/an/values').catch(() => null) : null]);
  const crmUsers = (vals?.users || []).map((x) => x.v);
  const me = boot.user;
  const assignable = ['admin', 'manager', 'viewer'];
  const roleOpts = (sel) => assignable.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${esc(roles[r])}</option>`).join('');
  main.innerHTML = `
    <div class="head-row"><h2>Користувачі</h2><div class="btn-row">${me.role === 'owner' && users.length > 1 ? '<button class="btn" id="uOwner">Передати права власника</button>' : ''}<button class="btn primary" id="uNew">+ Новий користувач</button></div></div>
    <div class="alert info" style="margin-bottom:14px">
      <b>Адміністратор</b> — усе, включно з API, користувачами й аналітикою. <b>Менеджер</b> — накладні, рахунки, довідники і власна аналітика (лише замовлення його логінів LP-CRM, без таргетів).
      <b>Перегляд</b> — лише дивитися, друкувати й завантажувати.</div>
    <table class="list"><thead><tr><th>Логін</th><th>Ім’я</th><th>Роль</th><th>Логіни LP-CRM</th><th>Стан</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr>
        <td><b>${esc(u.login)}</b>${String(u.id) === String(me.id) ? ' <span class="badge info">це ви</span>' : ''}</td>
        <td>${esc(u.name)}</td>
        <td>${u.role === 'owner' ? `<span class="badge ok">${esc(u.role_name)}</span>` : esc(u.role_name)}</td>
        <td class="small">${u.crm_logins.length ? u.crm_logins.map(esc).join(', ') : (u.role === 'manager' ? '<span class="muted">не прив’язано</span>' : '')}</td>
        <td>${u.active ? '<span class="badge ok">активний</span>' : '<span class="badge bad">вимкнений</span>'}</td>
        <td style="text-align:right">${u.role === 'owner' && me.role !== 'owner' ? '' : `<button class="btn sm" data-uedit="${u.id}">Змінити</button>`}</td>
      </tr>`).join('')}
    </tbody></table>`;
  const form = (u) => {
    const isNew = !u;
    const owner = u?.role === 'owner';
    const m = modal(isNew ? 'Новий користувач' : `Користувач ${u.login}`, `<form id="uF" class="form-stack">
        ${isNew ? '<label class="f"><span>Логін (латиницею)</span><input name="login" required autocomplete="off"></label>' : ''}
        <label class="f"><span>Ім’я</span><input name="name" value="${esc(u?.name || '')}"></label>
        ${owner ? '' : `<label class="f"><span>Роль</span><select name="role">${roleOpts(u?.role || 'manager')}</select></label>`}
        <div class="f" id="uCrm"><span>Логіни LP-CRM <span class="muted small">— менеджер бачить в аналітиці лише замовлення цих логінів</span></span>
          <div class="crm-pick">${[...new Set([...crmUsers, ...(u?.crm_logins || [])])].sort().map((l) => `<label class="chk-chip"><input type="checkbox" name="crm" value="${esc(l)}" ${u?.crm_logins?.includes(l) ? 'checked' : ''}> ${esc(l)}</label>`).join('') || '<span class="small muted">Логіни з’являться після завантаження аналітики.</span>'}</div>
          <input name="crm_extra" placeholder="інший логін, через кому" autocomplete="off"></div>
        <label class="f"><span>${isNew ? 'Пароль (від 6 символів)' : 'Новий пароль (залиште порожнім, щоб не міняти)'}</span><input name="password" type="text" autocomplete="new-password" ${isNew ? 'required' : ''}></label>
        ${!isNew && !owner && String(u.id) !== String(me.id) ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Активний (може входити)</label>` : ''}
      </form>`, { footer: `${!isNew && !owner && String(u.id) !== String(me.id) ? '<button class="btn danger" id="uDel" style="margin-right:auto">Видалити</button>' : ''}<button class="btn" data-close>Скасувати</button><button class="btn primary" id="uSave">Зберегти</button>` });
    const uf = $('#uF', m.el);
    const showCrm = () => { $('#uCrm', m.el).hidden = !uf.role || uf.role.value !== 'manager'; };
    if (uf.role) uf.role.onchange = showCrm;
    showCrm();
    $('#uSave', m.el).onclick = async () => {
      const f = $('#uF', m.el);
      const fd = new FormData(f);
      const d = Object.fromEntries(fd);
      d.crm_logins = [...fd.getAll('crm'), ...String(d.crm_extra || '').split(',')].map((x) => x.trim()).filter(Boolean);
      delete d.crm; delete d.crm_extra;
      if (f.active) d.active = f.active.checked;
      if (!d.password) delete d.password;
      try {
        if (isNew) await api('POST', '/api/users', d); else await api('PUT', `/api/users/${u.id}`, d);
        m.close(); toast('Збережено'); viewUsers();
      } catch (e) { toast(e.message, true); }
    };
    $('#uDel', m.el) && ($('#uDel', m.el).onclick = async () => {
      try { await api('DELETE', `/api/users/${u.id}`); m.close(); toast('Видалено'); viewUsers(); } catch (e) { toast(e.message, true); }
    });
  };
  $('#uNew').onclick = () => form(null);
  const tr = $('#uOwner');
  if (tr) tr.onclick = () => {
    const others = users.filter((x) => String(x.id) !== String(me.id) && x.active);
    const m = modal('Передати права власника', `<form id="oF" class="form-stack">
        <div class="alert">Власник може бути лише один. Після передачі новий власник отримає повний доступ, а ви — вибрану роль. Повернути права зможе лише новий власник.</div>
        <label class="f"><span>Новий власник</span><select name="userId" required><option value="">— вибрати —</option>${others.map((x) => `<option value="${x.id}">${esc(x.name ? `${x.name} (${x.login})` : x.login)} · ${esc(x.role_name)}</option>`).join('')}</select></label>
        <label class="f"><span>Ваша нова роль</span><select name="myRole">${roleOpts('admin')}</select></label>
        <label class="f"><span>Ваш пароль для підтвердження</span><input name="password" type="password" autocomplete="current-password" required></label>
      </form>`, { footer: '<button class="btn" data-close>Скасувати</button><button class="btn danger" id="oGo">Передати права</button>' });
    $('#oGo', m.el).onclick = async () => {
      const d = Object.fromEntries(new FormData($('#oF', m.el)));
      if (!d.userId) { toast('Виберіть нового власника', true); return; }
      try { await api('POST', '/api/users/transfer-owner', d); m.close(); toast('Права власника передано'); location.reload(); } catch (e) { toast(e.message, true); }
    };
  };
  $$('[data-uedit]').forEach((b) => (b.onclick = () => form(users.find((x) => String(x.id) === b.dataset.uedit))));
}

const PAY = createPayUI({ api, $, $$, esc, toast, modal, can, get main() { return main; }, reloadBoot: () => loadBoot() });
const PAYSTATS = createPayStatsUI({ api, $, $$, esc, toast, modal, get main() { return main; } });
const AN = createAnalyticsUI({ api, $, $$, esc, toast, modal, can, get main() { return main; }, fmtDateTime, setPending: (fn) => { onPending = fn; } });

// ---------- старт ----------
async function start() {
  try { await loadBoot(); } catch (e) { if (!/увійти/i.test(e.message)) main.innerHTML = `<div class="alert bad">Сервер недоступний: ${esc(e.message)}</div>`; return; }
  if (!location.hash) location.hash = '#/invoice';
  else route();
}
showAuth();
