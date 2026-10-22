// Журнал помилок (власник і адміністратори): збої сервера й зовнішніх сервісів за 30 днів.
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, confirmDanger, fmtDateTime } from '../core/ui.js';

export function createErrorsPages() {
  let filter = '';
  async function viewErrors() {
    const { rows, sources, keepDays } = await api('GET', `/api/errors${filter ? `?source=${encodeURIComponent(filter)}` : ''}`);
    main.innerHTML = `
      <div class="head-row"><h2>Журнал помилок</h2>${rows.length ? '<button class="btn danger" id="errClear">Очистити журнал</button>' : ''}</div>
      <div class="alert info" style="margin-bottom:14px">Сюди записуються збої сервера і зовнішніх сервісів (LP-CRM, Opendatabot, Нова пошта, база даних…).
        Адміністратори з підключеним Telegram отримують повідомлення — не частіше одного на той самий тип помилки за годину.
        Записи зберігаються ${keepDays} днів.</div>
      ${sources.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
        <button class="chip ${filter ? '' : 'on'}" data-src="">Усі</button>
        ${sources.map((s) => `<button class="chip ${filter === s.source ? 'on' : ''}" data-src="${esc(s.source)}">${esc(s.source)} · ${s.n}</button>`).join('')}
      </div>` : ''}
      ${rows.length ? `<table class="list"><thead><tr><th>Час</th><th>Де</th><th>Що сталося</th><th class="hide-m">Користувач</th></tr></thead><tbody>
        ${rows.map((r) => `<tr>
          <td class="small" style="white-space:nowrap">${esc(fmtDateTime(r.at))}</td>
          <td><span class="badge">${esc(r.source)}</span></td>
          <td class="small">${esc(r.message)}${r.path ? `<div class="muted">${esc(r.path)}</div>` : ''}</td>
          <td class="small hide-m">${esc(r.user_name || '—')}</td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="card empty"><div class="big">Помилок немає</div>Усе працює без збоїв.</div>'}`;
    $$('[data-src]').forEach((b) => (b.onclick = () => { filter = b.dataset.src; viewErrors(); }));
    $('#errClear') && ($('#errClear').onclick = async () => {
      if (!(await confirmDanger('Очистити журнал помилок?', 'Усі записи буде видалено. Нові помилки записуватимуться далі.', 'Очистити'))) return;
      try { await api('DELETE', '/api/errors'); toast('Журнал очищено'); filter = ''; viewErrors(); } catch (e) { toast(e.message, true); }
    });
  }
  return { viewErrors };
}
