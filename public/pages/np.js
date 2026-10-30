// Доставка: кабінети Нової пошти (ключі API), магазини Розетки (логін/пароль кабінету продавця), Prom і Епіцентру (токени API) — для друку маркування.
// Ключі й паролі бачить лише сервер.
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime } from '../core/ui.js';

// Маркетплейси, що підключаються токеном API (Prom, Епіцентр): однаковий блок — таблиця, форма, «Перевірити»
// з доставкою останніх замовлень (спосіб, перевізник, накладна) — видно, що саме віддає маркетплейс.
const TOKEN_SHOPS = [
  { key: 'prom', api: '/api/prom/accounts', title: 'Магазини Prom', label: 'Prom', namePh: 'напр. Prom Arca',
    help: `Підключення кабінету компанії Prom.ua за токеном API — для замовлень Prom (зокрема з доставкою до магазинів Rozetka).
      Токен: кабінет Prom → <b>Налаштування → Управління API-токенами</b> → створіть токен з доступом до замовлень. Кожен магазин — свій токен.` },
  { key: 'epc', api: '/api/epc/accounts', title: 'Магазини Епіцентру', label: 'Епіцентр', namePh: 'напр. Епіцентр Ecovent',
    help: `Підключення кабінету продавця Епіцентр Маркету за токеном API. «Маркування» друкує накладні Укрпошти, Meest, центрів видачі й поштоматів Епіцентру
      (Нова пошта — з кабінетів НП вище). Токен: кабінет продавця → <b>Налаштування компанії → API</b> → згенеруйте токен. Кожен магазин — свій токен.` },
];
const shopsHtml = (s, rows) => `
  <div class="head-row" style="margin-top:28px"><h2>${s.title}</h2><button class="btn primary" id="${s.key}New">+ Додати магазин</button></div>
  <div class="alert info help" style="margin-bottom:14px">${s.help}</div>
  ${rows.length ? `<table class="list"><thead><tr><th>Назва</th><th>Токен</th><th>Перевірено</th><th>Стан</th><th></th></tr></thead><tbody>
    ${rows.map((a) => `<tr>
      <td><b>${esc(a.name)}</b></td>
      <td class="small muted">${esc(a.token)}</td>
      <td class="small muted">${a.checked_at ? esc(fmtDateTime(a.checked_at)) : '—'}</td>
      <td>${a.active ? '<span class="badge ok">увімкнено</span>' : '<span class="badge bad">вимкнено</span>'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-${s.key}check="${a.id}">Перевірити</button> <button class="btn sm" data-${s.key}edit="${a.id}">Змінити</button></td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="card empty"><div class="big">Магазинів ${s.label} ще немає</div>Додайте токен API кабінету.</div>`}`;
function wireShops(s, rows, reload) {
  const ordersModal = (name, orders) => modal(`${s.label} · ${name}: останні замовлення`, orders.length
    ? `<table class="list"><thead><tr><th>Замовлення</th><th>Статус</th><th>Доставка</th><th>Накладна / ТТН</th></tr></thead><tbody>
      ${orders.map((o) => `<tr><td><b>${esc(o.id)}</b><div class="small muted">${esc(fmtDateTime(o.date))}</div></td><td class="small">${esc(o.status)}</td>
        <td class="small">${esc(o.option || o.provider || '—')}${o.option && o.provider ? `<div class="muted">${esc(o.provider)}</div>` : ''}</td><td class="small">${esc(o.ttn || '—')}${o.ttn_status ? `<div class="muted">${esc(o.ttn_status)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="card empty">Токен працює, але замовлень ще немає.</div>', { footer: '<button class="btn primary" data-close>Готово</button>' });
  const form = (a) => {
    const isNew = !a;
    const m = modal(isNew ? `Новий магазин: ${s.label}` : `Магазин «${a.name}»`, `<form id="shopF" class="form-stack">
        <label class="f"><span>Назва (${s.namePh})</span><input name="name" value="${esc(a?.name || '')}" autocomplete="off" ${isNew ? 'required' : ''}></label>
        <label class="f"><span>${isNew ? 'Токен API' : 'Новий токен API (залиште порожнім, щоб не міняти)'}</span><input name="token" autocomplete="off" spellcheck="false" placeholder="${isNew ? '' : esc(a.token)}" ${isNew ? 'required' : ''}></label>
        ${isNew ? '' : `<label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Увімкнено</label>`}
      </form>`, { footer: `${isNew ? '' : '<button class="btn danger" id="shopDel" style="margin-right:auto">Видалити</button>'}<button class="btn" data-close>Скасувати</button><button class="btn primary" id="shopSave">${isNew ? 'Додати і перевірити' : 'Зберегти'}</button>` });
    $('#shopSave', m.el).onclick = async () => {
      const f = $('#shopF', m.el);
      const d = { name: f.name.value.trim(), token: f.token.value.trim() };
      if (f.active) d.active = f.active.checked;
      if (!isNew && !d.token) delete d.token;
      $('#shopSave', m.el).disabled = true;
      try {
        const r = isNew ? await api('POST', s.api, d) : await api('PUT', `${s.api}/${a.id}`, d);
        m.close(); toast(isNew ? `Магазин ${s.label} підключено` : 'Збережено'); await reload();
        if (r.orders) ordersModal(d.name || a?.name || s.label, r.orders);
      } catch (e) { toast(e.message, true); $('#shopSave', m.el).disabled = false; }
    };
    $('#shopDel', m.el) && ($('#shopDel', m.el).onclick = async () => {
      if (!(await confirmDanger(`Видалити магазин «${a.name}»?`, `Замовлення цього магазину ${s.label} більше не читатимуться, доки не додасте токен знову.`, 'Видалити магазин'))) return;
      try { await api('DELETE', `${s.api}/${a.id}`); m.close(); toast('Видалено'); reload(); } catch (e) { toast(e.message, true); }
    });
  };
  $(`#${s.key}New`).onclick = () => form(null);
  $$(`[data-${s.key}edit]`).forEach((b) => (b.onclick = () => form(rows.find((x) => String(x.id) === b.getAttribute(`data-${s.key}edit`)))));
  $$(`[data-${s.key}check]`).forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await api('PUT', `${s.api}/${b.getAttribute(`data-${s.key}check`)}`, { check: true });
      toast(`Токен ${s.label} працює`); await reload(); ordersModal(r.name, r.orders || []);
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

export function createNpPages() {
  async function viewNp() {
    const [rows, rzRows, ...shopLists] = await Promise.all([api('GET', '/api/np/accounts'), api('GET', '/api/rz/accounts'), ...TOKEN_SHOPS.map((s) => api('GET', s.api))]);
    const shopRows = Object.fromEntries(TOKEN_SHOPS.map((s, i) => [s.key, shopLists[i]]));
    main.innerHTML = `
      <div class="head-row"><h2>Кабінети Нової пошти</h2><button class="btn primary" id="npNew">+ Додати кабінет</button></div>
      <div class="alert info help" style="margin-bottom:14px">Додайте ключі API всіх кабінетів НП (ФОП і ТОВ). На сторінці накладної кнопка
        <b>«Маркування»</b> сама знайде ТТН замовлення — з CRM або в цих кабінетах за телефоном отримувача — і відкриє маркування 100×100.
        Ключ: кабінет <a href="https://new.novaposhta.ua/dashboard/settings/developers" target="_blank" rel="noopener">new.novaposhta.ua → Налаштування → Безпека</a> → «Створити ключ».</div>
      ${rows.length ? `<table class="list"><thead><tr><th>Назва</th><th>Відправник у НП</th><th>Ключ</th><th>Стан</th><th></th></tr></thead><tbody>
        ${rows.map((a) => `<tr>
          <td><b>${esc(a.name)}</b></td>
          <td class="small">${esc(a.sender_name || '—')}${a.sender_code ? ` · ${esc(a.sender_code)}` : ''}</td>
          <td class="small muted">${esc(a.key)}</td>
          <td>${a.active ? '<span class="badge ok">увімкнено</span>' : '<span class="badge bad">вимкнено</span>'}</td>
          <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-check="${a.id}">Перевірити</button> <button class="btn sm" data-edit="${a.id}">Змінити</button></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="card empty"><div class="big">Кабінетів ще немає</div>Додайте ключ API першого кабінету Нової пошти.</div>'}
      <div class="head-row" style="margin-top:28px"><h2>Магазини Розетки</h2><button class="btn primary" id="rzNew">+ Додати магазин</button></div>
      <div class="alert info help" style="margin-bottom:14px">Для замовлень на точки видачі Розетки (ТТН <b>RMP-…</b>) «Маркування» друкує ТТН з кабінету продавця.
        API Розетки працює лише з логіном і паролем кабінету — радимо створити в кабінеті Розетки окремого менеджера для цього сайту.</div>
      ${Array.isArray(rzRows) && rzRows.length ? `<table class="list"><thead><tr><th>Назва</th><th>Магазин на Розетці</th><th>Логін</th><th>Стан</th><th></th></tr></thead><tbody>
        ${rzRows.map((a) => `<tr>
          <td><b>${esc(a.name)}</b></td>
          <td class="small">${esc(a.market_title || '—')}</td>
          <td class="small muted">${esc(a.username)}</td>
          <td>${a.active ? '<span class="badge ok">увімкнено</span>' : '<span class="badge bad">вимкнено</span>'}</td>
          <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-rzcheck="${a.id}">Перевірити</button> <button class="btn sm" data-rzedit="${a.id}">Змінити</button></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="card empty"><div class="big">Магазинів ще немає</div>Додайте логін і пароль кабінету продавця Розетки.</div>'}
      ${TOKEN_SHOPS.map((s) => shopsHtml(s, shopRows[s.key])).join('')}`;
    const form = (a) => {
      const isNew = !a;
      const m = modal(isNew ? 'Новий кабінет Нової пошти' : `Кабінет «${a.name}»`, `<form id="npF" class="form-stack">
          <label class="f"><span>Назва (як показувати; можна залишити порожньою — підставиться відправник з НП)</span><input name="name" value="${esc(a?.name || '')}" autocomplete="off"></label>
          <label class="f"><span>${isNew ? 'Ключ API' : 'Новий ключ API (залиште порожнім, щоб не міняти)'}</span><input name="api_key" autocomplete="off" spellcheck="false" placeholder="${isNew ? '32 символи' : esc(a.key)}" ${isNew ? 'required' : ''}></label>
          ${isNew ? '' : `<label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Увімкнено (шукати ТТН і друкувати з цього кабінету)</label>`}
        </form>`, { footer: `${isNew ? '' : '<button class="btn danger" id="npDel" style="margin-right:auto">Видалити</button>'}<button class="btn" data-close>Скасувати</button><button class="btn primary" id="npSave">${isNew ? 'Додати і перевірити' : 'Зберегти'}</button>` });
      $('#npSave', m.el).onclick = async () => {
        const f = $('#npF', m.el);
        const d = { name: f.name.value.trim(), api_key: f.api_key.value.trim() };
        if (f.active) d.active = f.active.checked;
        $('#npSave', m.el).disabled = true;
        try {
          if (isNew) {
            const r = await api('POST', '/api/np/accounts', d);
            toast(`Кабінет підключено${r.sender?.name ? `: ${r.sender.name}` : ''}`);
          } else {
            if (!d.api_key) delete d.api_key;
            await api('PUT', `/api/np/accounts/${a.id}`, d);
            toast('Збережено');
          }
          m.close(); viewNp();
        } catch (e) { toast(e.message, true); $('#npSave', m.el).disabled = false; }
      };
      $('#npDel', m.el) && ($('#npDel', m.el).onclick = async () => {
        if (!(await confirmDanger(`Видалити кабінет «${a.name}»?`, 'Маркування його ТТН більше не друкуватиметься, доки не додасте ключ знову.', 'Видалити кабінет'))) return;
        try { await api('DELETE', `/api/np/accounts/${a.id}`); m.close(); toast('Видалено'); viewNp(); } catch (e) { toast(e.message, true); }
      });
    };
    const rzForm = (a) => {
      const isNew = !a;
      const m = modal(isNew ? 'Новий магазин Розетки' : `Магазин «${a.name}»`, `<form id="rzF" class="form-stack">
          <label class="f"><span>Назва (можна залишити порожньою — підставиться назва магазину)</span><input name="name" value="${esc(a?.name || '')}" autocomplete="off"></label>
          <label class="f"><span>Логін кабінету продавця</span><input name="username" value="${esc(a?.username || '')}" autocomplete="off" ${isNew ? 'required' : ''}></label>
          <label class="f"><span>${isNew ? 'Пароль' : 'Новий пароль (залиште порожнім, щоб не міняти)'}</span><input name="password" type="password" autocomplete="new-password" ${isNew ? 'required' : ''}></label>
          ${isNew ? '' : `<label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Увімкнено</label>`}
        </form>`, { footer: `${isNew ? '' : '<button class="btn danger" id="rzDel" style="margin-right:auto">Видалити</button>'}<button class="btn" data-close>Скасувати</button><button class="btn primary" id="rzSave">${isNew ? 'Додати і перевірити' : 'Зберегти'}</button>` });
      $('#rzSave', m.el).onclick = async () => {
        const f = $('#rzF', m.el);
        const d = { name: f.name.value.trim(), username: f.username.value.trim(), password: f.password.value };
        if (f.active) d.active = f.active.checked;
        if (!isNew && !d.password) delete d.password;
        $('#rzSave', m.el).disabled = true;
        try {
          if (isNew) { const r = await api('POST', '/api/rz/accounts', d); toast(`Магазин підключено${r.market ? `: ${r.market}` : ''}`); }
          else { await api('PUT', `/api/rz/accounts/${a.id}`, d); toast('Збережено'); }
          m.close(); viewNp();
        } catch (e) { toast(e.message, true); $('#rzSave', m.el).disabled = false; }
      };
      $('#rzDel', m.el) && ($('#rzDel', m.el).onclick = async () => {
        if (!(await confirmDanger(`Видалити магазин «${a.name}»?`, 'Маркування його ТТН (RMP) більше не друкуватиметься, доки не додасте магазин знову.', 'Видалити магазин'))) return;
        try { await api('DELETE', `/api/rz/accounts/${a.id}`); m.close(); toast('Видалено'); viewNp(); } catch (e) { toast(e.message, true); }
      });
    };
    for (const s of TOKEN_SHOPS) wireShops(s, shopRows[s.key], viewNp);
    $('#rzNew').onclick = () => rzForm(null);
    $$('[data-rzedit]').forEach((b) => (b.onclick = () => rzForm(rzRows.find((x) => String(x.id) === b.dataset.rzedit))));
    $$('[data-rzcheck]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await api('PUT', `/api/rz/accounts/${b.dataset.rzcheck}`, { check: true }); toast('Вхід у Розетку працює'); viewNp(); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    $('#npNew').onclick = () => form(null);
    $$('[data-edit]').forEach((b) => (b.onclick = () => form(rows.find((x) => String(x.id) === b.dataset.edit))));
    $$('[data-check]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { const r = await api('PUT', `/api/np/accounts/${b.dataset.check}`, { check: true }); toast(`Ключ працює: ${r.sender_name || r.name}`); viewNp(); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    }));
  }
  return { viewNp };
}
