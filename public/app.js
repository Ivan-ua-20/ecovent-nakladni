// Оболонка інтерфейсу: вхід, меню розділів, роутер. Сторінки — у pages/, спільні функції — у core/ui.js.
import { esc } from './invoice.js';
import { createAnalyticsUI } from './an.js';
import { createPayUI } from './pay.js';
import { createPayStatsUI } from './anpay.js';
import { $, $$, main, api, setPending, setUnauthorized, toast, modal, fmtDateTime } from './core/ui.js';
import { createNakladnaPages } from './pages/nakladna.js';
import { createRefsPages } from './pages/refs.js';
import { createSettingsPages } from './pages/settings.js';
import { createRahunkyPages } from './pages/rahunky.js';
import { createUsersPages } from './pages/users.js';
import { createErrorsPages } from './pages/errors.js';
import { createB2bPages } from './pages/b2b.js';
import { createPartnerPages } from './pages/partner.js';

// ---------- стан ----------
let boot = { fops: [], templates: [], offices: [], channels: [], invFops: [], settings: {}, user: null };
const can = (perm) => Boolean(boot.user?.perms?.includes(perm));

// Розділи (вкладки зверху) і підвкладки кожного розділу.
const SECTIONS = [
  { id: 'nakladni', label: 'Накладні ФОП', perm: 'docs.view', home: 'invoice', tabs: [
    { id: 'invoice', label: 'Формування' },
    { id: 'history', label: 'Історія' },
    { id: 'fops', label: 'ФОПи накладних', perm: 'refs.edit' },
    { id: 'offices', label: 'Відділи, поле 1 → ФОП', perm: 'refs.edit' },
    { id: 'templates', label: 'Шаблони', perm: 'refs.edit' },
    { id: 'nsettings', label: 'Налаштування накладних', perm: 'refs.edit' },
  ] },
  { id: 'rahunky', label: 'Рахунки Word', perm: 'docs.view', home: 'rahunky', tabs: [
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
  { id: 'b2b', label: 'B2B партнери', perm: 'b2b.admin', home: 'b2borders', tabs: [
    { id: 'b2borders', label: 'Закупівлі' },
    { id: 'b2bclients', label: 'Замовлення клієнтів' },
    { id: 'b2bpartners', label: 'Партнери' },
    { id: 'b2bcatalog', label: 'Каталог і ціни' },
  ] },
  // Кабінет партнера — єдиний розділ, який бачить партнер.
  { id: 'partner', label: 'Кабінет партнера', perm: 'b2b.partner', home: 'pcatalog', tabs: [
    { id: 'pcatalog', label: 'Каталог' },
    { id: 'porders', label: 'Закупівлі' },
    { id: 'pclients', label: 'Замовлення клієнтів' },
    { id: 'pentities', label: 'Мої юрособи' },
    { id: 'pteam', label: 'Команда', perm: 'b2b.team' },
    { id: 'phelp', label: 'Інструкція' },
  ] },
  { id: 'settings', label: 'Налаштування', perm: 'refs.edit', home: 'settings', tabs: [{ id: 'settings', label: 'Загальні налаштування' }, { id: 'errors', label: 'Журнал помилок', perm: 'users' }] },
  { id: 'users', label: 'Користувачі', perm: 'people', home: 'users', tabs: [{ id: 'users', label: 'Користувачі' }] },
];
const visibleTabs = (sec) => sec.tabs.filter((t) => !t.perm || can(t.perm));
const sectionOf = (routeId) => SECTIONS.find((sec) => sec.tabs.some((t) => t.id === routeId)) || SECTIONS[0];
// Перша доступна вкладка (партнер — «Каталог», решта — «Формування»).
const homeRoute = () => {
  const sec = SECTIONS.find((s) => (!s.perm || can(s.perm)) && visibleTabs(s).length);
  if (!sec) return 'invoice';
  return visibleTabs(sec).some((t) => t.id === sec.home) ? sec.home : visibleTabs(sec)[0].id;
};

function renderNav(active = 'invoice') {
  const u = boot.user;
  const s = boot.settings;
  const cur = sectionOf(active);
  const secs = SECTIONS.filter((sec) => (!sec.perm || can(sec.perm)) && visibleTabs(sec).length);
  const homeOf = (sec) => (visibleTabs(sec).some((t) => t.id === sec.home) ? sec.home : visibleTabs(sec)[0].id);
  $('.topbar').innerHTML = `
    <div class="brand"><span class="brand-mark"></span>${u?.role === 'partner' ? 'Ековент B2B' : 'Накладні'}</div>
    <nav class="main-tabs" aria-label="Розділи">
      ${secs.map((sec) => `<a href="#/${homeOf(sec)}" class="${sec.id === cur.id ? 'active' : ''}">${esc(sec.label)}</a>`).join('')}
    </nav>
    <div class="top-user">
      ${can('api') && !s.lpcrm_key ? '<a href="#/settings" class="top-warn">LP-CRM не підключено</a>' : ''}
      <span><b>${esc(u?.name || '')}</b> · ${esc(u?.partner_role_name ? `Партнер · ${u.partner_role_name}` : (u?.role_name || ''))}</span>
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
// Сторінки отримують спільний стан через ctx (boot оновлюється після кожного loadBoot()).
const ctx = { get boot() { return boot; }, get PAY() { return PAY; }, can, loadBoot, activeFops, fopById, tplById };
const { viewInvoice, viewHistory } = createNakladnaPages(ctx);
const { viewFops, viewOffices, viewTemplates, viewInvFops } = createRefsPages(ctx);
const { viewSettings, viewNakladniSettings, viewRahunkySettings } = createSettingsPages(ctx);
const { viewRahunky, viewRahunkyList } = createRahunkyPages(ctx);
const { viewUsers } = createUsersPages(ctx);
const { viewErrors } = createErrorsPages(ctx);
const { viewPartners, viewCatalog, viewOrders: viewB2bOrders, viewClients: viewB2bClients } = createB2bPages(ctx);
const { viewPartnerCatalog, viewPartnerHelp, viewEntities, viewOrders: viewPartnerOrders, viewClients: viewPartnerClients, viewTeam: viewPartnerTeam } = createPartnerPages(ctx);
setUnauthorized(() => showAuth());

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
  errors: viewErrors,
  b2bpartners: viewPartners,
  b2borders: viewB2bOrders,
  porders: viewPartnerOrders,
  pclients: viewPartnerClients,
  pteam: viewPartnerTeam,
  b2bclients: viewB2bClients,
  pentities: viewEntities,
  b2bcatalog: viewCatalog,
  pcatalog: viewPartnerCatalog,
  phelp: viewPartnerHelp,
};

async function route() {
  if (!boot.user) return;
  let [, name = homeRoute(), ...args] = location.hash.replace(/^#/, '').split('/');
  if (!routes[name]) name = homeRoute();
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
const PAY = createPayUI({ api, $, $$, esc, toast, modal, can, get main() { return main; }, reloadBoot: () => loadBoot() });
const PAYSTATS = createPayStatsUI({ api, $, $$, esc, toast, modal, get main() { return main; } });
const AN = createAnalyticsUI({ api, $, $$, esc, toast, modal, can, get main() { return main; }, fmtDateTime, setPending });

// ---------- старт ----------
async function start() {
  try { await loadBoot(); } catch (e) { if (!/увійти/i.test(e.message)) main.innerHTML = `<div class="alert bad">Сервер недоступний: ${esc(e.message)}</div>`; return; }
  if (!location.hash || location.hash === '#/') location.hash = `#/${homeRoute()}`;
  else route();
}
showAuth();

