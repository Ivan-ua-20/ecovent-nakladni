// Налаштування: загальні (LP-CRM, Checkbox, перенесення), накладних і рахунків.
import { esc } from '../invoice.js';
import { $, $$, main, MASK, api, setPending, toast, modal, confirmDanger, fmtDateTime, readImage, printHtml, todayKyiv } from '../core/ui.js';

export function createSettingsPages(ctx) {
  const { can, loadBoot, activeFops, fopById, tplById } = ctx;

async function viewSettings() {
  await loadBoot();
  const s = ctx.boot.settings;
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
    <form class="card form-stack" id="secForm" style="max-width:640px">${fields(ctx.boot.settings)}
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
  if (can('api')) await ctx.PAY.settingsCard(main, ctx.boot.settings);
}


  return { viewSettings, viewNakladniSettings, viewRahunkySettings };
}
