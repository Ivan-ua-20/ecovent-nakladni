// Рітейл → Розетка (кабінет постачальника): замовлення дропшипінгу з груповими діями (підтвердити, ТТН, маркування,
// у LP-CRM), товари й ціни закупівлі (завантаження з Кабінету, прайс на Розетку не відправляємо), налаштування кабінетів і вебхука.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime, takeHashQuery } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { fpLayout, wireFp, fpGroup, fpBtn, fpKpi } from './b2b-shared.js';

const ST_CLS = { new: 'warn', updated: 'warn', confirmed: 'info', shipping: 'info', problem: 'bad', closed: 'ok', delivery_refused: 'bad', deleted: 'bad', shipped_from_rozetka: 'ok' };
const UZD_CLS = { verified: 'ok', skipped: 'ok', problem: 'bad', not_uploaded: '' };
const VIEWS = { '': 'Усі', todo: 'До підтвердження', noinv: 'Чекає рахунок', ready: 'Можна створити ТТН', nottn: 'Без ТТН', nocrm: 'Не в LP-CRM', crmnew: 'В LP-CRM — Нове', docs: 'З документами', ret_wait: 'Повернуто — очікуємо отримання', ret_got: 'Повернуто — отримано' };
const RET_VIEWS = ['ret_wait', 'ret_got'];
const isRet = (o) => !!(o.return_ttn || o.ret_ttn || o.status === 'delivery_refused' || [102, 103, 108].includes(Number(o.tracking_code)));
const retTtn = (o) => o.return_ttn || o.ret_ttn || '';
const GAP_MS = 2000; // пауза між замовленнями в групових діях
const RETRY_MS = [5000, 10000, 20000]; // якщо Розетка все ж відповіла «забагато запитів»
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Етапи замовлення — строго по черзі: 1 підтвердити → 2 Розетка звіряє документи (ЮЗД) → 3 ТТН → 4 маркування і LP-CRM.
// blockedWhy(o, дія) — чому дію зараз не можна (порожньо — можна).
const UZD_OK = ['verified', 'skipped'];
const isConfirmed = (o) => !['new', 'updated', 'deleted'].includes(o.status);
function blockedWhy(o, k) {
  if (o.status === 'deleted') return 'замовлення видалене';
  if (k === 'confirm') return ['new', 'updated'].includes(o.status) ? '' : 'вже підтверджене';
  if (k === 'ttn') {
    if (!isConfirmed(o)) return 'спершу підтвердіть замовлення';
    if (o.ttn) return 'ТТН уже є';
    if (!['confirmed', 'problem'].includes(o.status)) return `статус «${o.status_name}»`;
    if (!UZD_OK.includes(o.uzd_status)) return 'Розетка ще не звірила документи (ЮЗД)';
    return '';
  }
  if (k === 'mark') return o.ttn ? '' : 'ще немає ТТН';
  if (k === 'crm') return o.crm_id || o.crm_code ? 'уже в LP-CRM' : !o.ttn ? 'спершу створіть ТТН' : '';
  if (k === 'retgot') return !isRet(o) ? 'не повернення' : o.ret_got_at ? 'вже позначено отриманим' : '';
  return '';
}
const stepsHtml = (o) => {
  const st = [
    ['Підтверджено', isConfirmed(o)],
    ['Документи звірено (ЮЗД)', isConfirmed(o) && (UZD_OK.includes(o.uzd_status) || !!o.ttn)],
    ['ТТН', !!o.ttn],
    ['У LP-CRM', !!(o.crm_id || o.crm_code)],
  ];
  const cur = st.findIndex(([, done]) => !done);
  return `<div class="btn-row small" style="flex-wrap:wrap;gap:6px">${st.map(([n, done], i) => `<span class="badge ${done ? 'ok' : i === cur ? 'warn' : ''}">${done ? '✅' : i === cur ? '👉' : '🔒'} ${i + 1}. ${n}</span>`).join('<span class="muted">→</span>')}</div>`;
};
const n2 = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };

export function createRetailPages(ctx) {
  const can = (p) => (ctx.can ? ctx.can(p) : true);
  let filter = { view: '', q: '' };
  let lastSyncTry = 0;
  let busy = false; // йде групова дія — список не перемальовуємо

  // ---------------------------------------------------------------- замовлення
  // Відкриття сторінки: оновлення з Розетки у фоні (не частіше разу на 2 хв); прийшли нові дані — перемальовуємо.
  function bgSync() {
    if (Date.now() - lastSyncTry < 120e3) return;
    lastSyncTry = Date.now();
    api('POST', '/api/rzs/sync', {}).then((r) => {
      const err = r?.results?.find((x) => x.error);
      if (err) toast(`Оновлення з Розетки: ${err.error}`, true);
      // Перемальовуємо лише якщо щось справді змінилось і людина зараз нічого не вибирає (інакше зник би вибір).
      if (!(r?.results || []).some((x) => x.changed || x.crm || x.crmNums) || !location.hash.startsWith('#/rzorders')) return;
      if (!document.querySelector('.modal-bg') && !$$('[data-sel]').some((x) => x.checked) && !busy) viewOrders();
      else if (!$('#rzFresh') && $('#rzBulk')) {
        $('#rzBulk').insertAdjacentHTML('beforebegin', '<div class="alert info small" id="rzFresh" style="margin-bottom:8px">З Розетки прийшли зміни — <a href="#" id="rzFreshGo">оновити список</a>.</div>');
        $('#rzFreshGo').onclick = (ev) => { ev.preventDefault(); viewOrders(); };
      }
    }).catch(() => 0);
  }
  async function viewOrders() {
    const hq = takeHashQuery();
    if (hq != null) filter = { view: '', q: hq };
    bgSync();
    const qs = new URLSearchParams(Object.entries({ status: filter.view, q: filter.q }).filter(([, v]) => v)).toString();
    const d = await api('GET', `/api/rzs/orders${qs ? `?${qs}` : ''}`);
    const { rows, counts, statuses, accounts } = d;
    const lastSync = accounts.map((a) => a.synced_at).filter(Boolean).sort().pop();
    const lastHook = accounts.map((a) => a.hook_at).filter(Boolean).sort().pop();
    const pr = d.prices || {};
    main.innerHTML = `
      <div class="head-row"><h2>Розетка — замовлення</h2><div class="btn-row">${can('retail.edit') ? '<button class="btn" id="rzFind" title="Знайти за ТТН замовлення, які вже є в LP-CRM, і прив’язати">🔗 Знайти в LP-CRM</button>' : ''}<button class="btn primary" id="rzSync">Оновити з Розетки</button></div></div>
      ${accounts.length ? `<div class="small muted" style="margin-bottom:10px">${lastSync ? `Оновлено: ${esc(fmtDateTime(lastSync))}` : 'Ще не оновлювалось'}${lastHook ? ` · вебхук Розетки: ${esc(fmtDateTime(lastHook))}` : ' · вебхук ще не надходив'}
        · ціни товарів: ${pr.imported_at ? `файл завантажено ${esc(fmtDateTime(pr.imported_at))}` : 'файл ще не завантажували'}${pr.changed_at ? `, остання зміна ціни ${esc(fmtDateTime(pr.changed_at))}` : ''}${can('refs.edit') ? ' (<a href="#/rzpricelog">журнал</a>)' : ''}</div>
        ${accounts.filter((a) => a.sync_error).map((a) => `<div class="alert warn small" style="margin-bottom:10px">⚠️ Останнє оновлення з Розетки${accounts.length > 1 ? ` («${esc(a.name)}»)` : ''} не вдалося${a.sync_error_at ? ` (${esc(fmtDateTime(a.sync_error_at))})` : ''}: ${esc(a.sync_error)}. Натисніть «Оновити з Розетки» ще раз.</div>`).join('')}`
        : `<div class="alert warn" style="margin-bottom:12px">Кабінет постачальника Розетки ще не підключено${can('api') ? ' — «Налаштування Розетки»' : ' — зверніться до адміністратора'}.</div>`}
      ${fpLayout(`${fpGroup('Пошук', `<input id="rzQ" type="search" placeholder="№ Розетки, клієнт, телефон, ТТН, рахунок" value="${esc(filter.q)}" aria-label="Пошук замовлення">`)}
        ${fpGroup('Етапи', Object.entries(VIEWS).filter(([k]) => !RET_VIEWS.includes(k)).map(([k, v]) => fpBtn(`<span>${esc(v)}</span><span class="small">${k === 'crmnew' && counts.crmnew ? counts.crmnew : ''}</span>`, filter.view === k, `data-v="${k}"`)).join(''))}
        ${fpGroup('Повернення', RET_VIEWS.map((k) => fpBtn(`<span>${esc(VIEWS[k])}</span><span class="small">${counts[k] || ''}</span>`, filter.view === k, `data-v="${k}"`)).join(''))}
        ${fpGroup('Статус Розетки', Object.entries(statuses).filter(([k]) => counts[k]).map(([k, v]) => fpBtn(`<span>${esc(v)}</span><span class="small">${counts[k]}</span>`, filter.view === k, `data-v="${k}"`)).join(''))}`,
      `<div class="kpis">
        ${fpKpi('До підтвердження', String((counts.new || 0) + (counts.updated || 0)), 'нові й змінені')}
        ${fpKpi('Відправляються', String(counts.shipping || 0))}
        ${fpKpi('Повернення — чекаємо', String(counts.ret_wait || 0), 'за 120 днів', counts.ret_wait ? 'kpi-bad' : '')}
        ${fpKpi('Повернення — отримано', String(counts.ret_got || 0), 'за 120 днів')}
      </div>
      ${RET_VIEWS.includes(filter.view) ? `<div class="card btn-row" style="flex-wrap:wrap;align-items:center;padding:10px 12px"><b style="margin-right:auto">${esc(VIEWS[filter.view])} · ${rows.length}</b><button class="btn" id="rzRetXls" title="Обидва статуси повернень — окремими аркушами">⬇ ТТН повернень (Excel)</button><button class="btn" id="rzRetCopy">📋 Копіювати ТТН (${rows.length})</button><button class="btn" id="rzRetCheck" title="Статус ЕН повернення в Новій пошті">🔄 Перевірити в НП</button>
        <div class="small muted" style="flex-basis:100%">Повернення — замовлення з ТТН повернення від Розетки, статусом «Відмова від отримання» або відмовою в трекінгу НП (за 120 днів). «Отримано» — за статусом ЕН повернення в Новій пошті (перевірка щогодини) або позначено вручну.</div></div>` : ''}
      <div id="rzBulk" class="btn-row card" hidden style="position:sticky;top:8px;z-index:5;margin-bottom:10px;padding:8px 12px;flex-wrap:wrap;align-items:center"></div>
      ${rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th style="width:34px"><input type="checkbox" id="rzAll" aria-label="Обрати всі"></th>
        <th>№ / дата</th><th>Клієнт</th><th class="hide-m">Товари</th><th class="r">Післяплата</th><th>Статус</th><th>ТТН</th><th>Рахунок (Вчасно)</th><th>Документи</th><th class="hide-m">LP-CRM</th></tr></thead><tbody>
        ${rows.map((o) => `<tr class="click" data-o="${esc(o.id)}">
          <td data-nosel><input type="checkbox" data-sel="${esc(o.id)}" aria-label="Обрати"></td>
          <td><b>${esc(o.order_num || o.id.slice(0, 8))}</b><div class="small muted">${esc(fmtDateTime(o.created_at.replace(' ', 'T')))}</div>${accounts.length > 1 ? `<div class="small muted">${esc(o.account || '')}</div>` : ''}</td>
          <td>${esc(o.customer)}<div class="small muted">${esc([o.city, o.phone].filter(Boolean).join(' · '))}</div></td>
          <td class="small hide-m">${o.products.map((p) => `${esc(p.name || p.supplierCode)} × ${p.quantity}`).join('<br>')}</td>
          <td class="r nowrap">${o.cod ? money(o.cod) : '—'}</td>
          <td><span class="badge ${ST_CLS[o.status] || ''}">${esc(o.status_name)}</span>${o.uzd_name ? `<div><span class="badge ${UZD_CLS[o.uzd_status] || ''}">${esc(o.uzd_name)}</span></div>` : ''}</td>
          <td class="small" style="min-width:170px;max-width:250px">${o.ttn ? `<b class="nowrap">${esc(o.ttn)}</b>${o.tracking_status ? `<div class="muted">${esc(o.tracking_status)}</div>` : ''}` : '—'}${retTtn(o) || isRet(o) ? `<div class="badge ${o.ret_got_at ? 'ok' : 'bad'}">${o.ret_got_at ? '✅ повернення отримано' : '↩ повернення'}${retTtn(o) ? ` ${esc(retTtn(o))}` : ''}</div>${o.ret_status ? `<div class="muted">${esc(o.ret_status)}</div>` : ''}` : ''}</td>
          <td class="small nowrap">${o.invoice_no ? `<b>${esc(o.invoice_no)}</b>` : '<span class="muted">—</span>'}</td>
          <td class="small" data-nosel>${o.document_link ? `<a class="badge ok" href="${esc(o.document_link)}" target="_blank" rel="noopener">📄 є</a>` : '<span class="muted">ще немає</span>'}
            ${o.docs_at ? `<div class="muted">${esc(fmtDateTime(o.docs_at))}</div>` : ''}</td>
          <td class="small hide-m">${o.crm_id ? `№ <b>${esc(o.crm_id)}</b>` : o.crm_code ? 'передано' : '—'}${o.crm_status ? `<div><span class="badge ${o.crm_new ? 'warn' : 'info'}">${esc(o.crm_status)}</span></div>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>`
        : `<div class="card empty"><div class="big">Замовлень немає</div>${filter.view || filter.q ? 'Змініть фільтр або пошук.' : 'Нові замовлення Розетки з’являються тут автоматично (вебхук) або кнопкою «Оновити з Розетки».'}</div>`}`, { summary: [VIEWS[filter.view] || statuses[filter.view] || 'Усі', filter.q].filter(Boolean).join(' · ') })}`;
    wireFp();
    $('#rzSync').onclick = async (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.innerHTML = '<span class="spinner"></span> Оновлюю…';
      try { const r = await api('POST', '/api/rzs/sync', { force: true }); const err = r.results?.find((x) => x.error); const lk = r.results?.reduce((t, x) => t + (x.crm || 0), 0) || 0; toast(err ? err.error : `Оновлено: ${r.results?.reduce((t, x) => t + (x.saved || 0), 0) || 0} замовлень${lk ? ` · знайдено в LP-CRM за ТТН: ${lk}` : ''}`, !!err); } catch (er) { toast(er.message, true); }
      viewOrders();
    };
    $$('[data-v]').forEach((b) => (b.onclick = async () => {
      filter.view = b.dataset.v;
      if (filter.view === 'crmnew') { b.innerHTML = '<span class="spinner"></span> Перевіряю статуси в LP-CRM…'; await api('POST', '/api/rzs/crm-status', {}).catch((e) => toast(e.message, true)); }
      await viewOrders();
      if (RET_VIEWS.includes(filter.view)) retCheck(true);
    }));
    $('#rzFind') && ($('#rzFind').onclick = () => findCrm(null));
    $('#rzRetXls') && ($('#rzRetXls').onclick = () => retExport());
    $('#rzRetCopy') && ($('#rzRetCopy').onclick = async () => {
      const list = [...new Set(rows.flatMap((o) => [retTtn(o) || o.ttn]).filter(Boolean))];
      try { await navigator.clipboard.writeText(list.join('\n')); toast(`Скопійовано ТТН: ${list.length}`); } catch { toast('Не вдалося скопіювати — скористайтесь вивантаженням в Excel', true); }
    });
    $('#rzRetCheck') && ($('#rzRetCheck').onclick = () => retCheck(false));
    let qt;
    $('#rzQ').oninput = (e) => { clearTimeout(qt); qt = setTimeout(async () => { filter.q = e.target.value; await viewOrders(); const el = $('#rzQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 350); };
    $$('[data-nosel]').forEach((td) => (td.onclick = (e) => e.stopPropagation()));
    $$('[data-o]').forEach((tr) => (tr.onclick = () => orderModal(tr.dataset.o)));
    wireBulk(rows);
  }

  // Групові дії: по одному замовленню за запит, з прогресом; що не вдалося — списком.
  function wireBulk(rows) {
    const bar = $('#rzBulk');
    const sel = () => $$('[data-sel]').filter((x) => x.checked).map((x) => x.dataset.sel);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const draw = () => {
      const ids = sel();
      bar.hidden = !ids.length;
      bar.innerHTML = ids.length ? `<b>Обрано: ${ids.length}</b>
        ${can('retail.edit') ? '<button class="btn sm" data-b="confirm">✅ Підтвердити</button><button class="btn sm" data-b="ttn">🚚 Створити ТТН</button>' : ''}
        <button class="btn sm" data-b="mark">🏷 Маркування (PDF)</button>
        ${can('retail.edit') ? '<button class="btn sm" data-b="crm">➕ У LP-CRM</button><button class="btn sm" data-b="find">🔗 Знайти в LP-CRM</button>' : ''}
        ${can('retail.edit') && filter.view === 'ret_wait' ? '<button class="btn sm" data-b="retgot">📦 Повернення отримано</button>' : ''}
        <button class="btn sm" data-b="_clear">Зняти вибір</button>` : '';
      $$('[data-b]', bar).forEach((b) => (b.onclick = () => run(b.dataset.b)));
      const all = $('#rzAll');
      if (all) all.checked = ids.length > 0 && ids.length === $$('[data-sel]').filter((x) => x.offsetParent).length;
    };
    $$('[data-sel]').forEach((x) => (x.onchange = draw));
    $('#rzAll') && ($('#rzAll').onchange = (e) => { $$('[data-sel]').filter((x) => x.offsetParent).forEach((x) => { x.checked = e.target.checked; }); draw(); });
    const ACT = {
      confirm: { label: 'Підтвердити', run: (id) => api('POST', `/api/rzs/orders/${id}/confirm`, {}) },
      ttn: { label: 'Створити ТТН', run: (id) => api('POST', `/api/rzs/orders/${id}/ttn`, {}) },
      crm: { label: 'У LP-CRM', run: (id) => api('POST', `/api/rzs/orders/${id}/crm`, {}) },
      retgot: { label: 'Повернення отримано', run: (id) => api('POST', `/api/rzs/orders/${id}/return-got`, { got: true }) },
    };
    async function run(k) {
      const ids = sel();
      if (k === '_clear') { $$('[data-sel]').forEach((x) => { x.checked = false; }); draw(); return; }
      if (k === 'find') return findCrm(ids);
      if (k === 'mark') {
        const withTtn = ids.filter((id) => !blockedWhy(byId.get(id), 'mark'));
        if (!withTtn.length) { toast('У вибраних замовленнях ще немає ТТН — спершу створіть ТТН', true); return; }
        if (withTtn.length < ids.length) toast(`Без ТТН пропущено: ${ids.length - withTtn.length}`, true);
        return markings(withTtn);
      }
      const a = ACT[k];
      const todo = ids.filter((id) => !blockedWhy(byId.get(id), k));
      const skipped = ids.filter((id) => blockedWhy(byId.get(id), k)).map((id) => `${byId.get(id).order_num}: ${blockedWhy(byId.get(id), k)}`);
      if (!todo.length) {
        modal(`«${a.label}» — зараз не можна`, `<div class="form-stack small"><div>Етапи йдуть по черзі: підтвердження → Розетка звіряє документи (ЮЗД) → ТТН → маркування і LP-CRM.</div>${skipped.map((x) => `<div>${esc(x)}</div>`).join('')}</div>`, { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
        return;
      }
      if (!(await confirmDanger(`${a.label}: ${todo.length} замовлень?`, skipped.length ? `Пропущено ${skipped.length} — попередній етап ще не завершено (деталі — після виконання).` : '', a.label))) return;
      const fails = [];
      let ok = 0;
      busy = true;
      bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      const label = (t) => { bar.querySelector('b').textContent = t; };
      for (const [i, id] of todo.entries()) {
        if (i) await sleep(k === 'crm' ? 400 : k === 'retgot' ? 50 : GAP_MS); // Розетка блокує часті запити — пауза між замовленнями
        label(`${a.label}: ${i + 1} з ${todo.length}…`);
        for (let attempt = 0; ; attempt++) {
          try { const r = await a.run(id); ok++; if (r?.warnings?.length) fails.push(`${byId.get(id).order_num}: ⚠️ ${r.warnings.join('; ')}`); break; }
          catch (e) {
            if (e.status === 429 && attempt < RETRY_MS.length) {
              for (let s = RETRY_MS[attempt] / 1000; s > 0; s--) { label(`${a.label}: ${i + 1} з ${todo.length} — Розетка просить зачекати, ще ${s} с…`); await sleep(1000); }
              continue;
            }
            fails.push(`${byId.get(id).order_num}: ${e.message}`);
            break;
          }
        }
      }
      busy = false;
      toast(`${a.label}: виконано ${ok} з ${todo.length}`, ok < todo.length);
      if (fails.length || skipped.length) modal('Результат', `<div class="form-stack small">${[...fails, ...skipped].map((x) => `<div>${esc(x)}</div>`).join('')}</div>`, { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
      viewOrders();
    }
    draw();
  }

  // Повернення: перевірка ЕН повернення в НП (quiet — у фоні після відкриття вкладки, без повідомлень, якщо нічого нового).
  let retBusy = false;
  async function retCheck(quiet) {
    if (retBusy) return;
    retBusy = true;
    const btn = $('#rzRetCheck');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Перевіряю в НП…'; }
    try {
      const r = await api('POST', '/api/rzs/returns/check', {});
      if (r.skipped) { if (!quiet) toast(r.skipped, true); }
      else if (!quiet || r.got || r.found) toast(`Перевірено в НП: ${r.checked}${r.got ? ` · отримано: ${r.got}` : ''}${r.found ? ` · знайдено ЕН повернення: ${r.found}` : ''}${r.left ? ` · ще ${r.left} — натисніть ще раз` : ''}${r.failed ? ` · помилок: ${r.failed}` : ''}`, !!r.failed);
      if ((!quiet || r.got || r.found) && RET_VIEWS.includes(filter.view) && !busy && !$$('[data-sel]').some((x) => x.checked)) await viewOrders();
    } catch (e) { if (!quiet) toast(e.message, true); }
    retBusy = false;
    const b2 = $('#rzRetCheck');
    if (b2) { b2.disabled = false; b2.textContent = '🔄 Перевірити в НП'; }
  }
  // Excel: усі ТТН з обох статусів повернень — аркуш на статус (без урахування пошуку).
  async function retExport() {
    const d = await api('GET', '/api/rzs/orders?status=ret_all').catch((e) => { toast(e.message, true); return null; });
    if (!d) return;
    const cols = [
      { title: '№ Розетки', width: 14 }, { title: 'Дата замовлення', width: 17 }, { title: 'Клієнт', width: 26 }, { title: 'Телефон', width: 15 }, { title: 'ТТН відправлення', width: 18 },
      { title: 'ТТН повернення', width: 18 }, { title: 'Статус Розетки', width: 20 }, { title: 'Статус повернення (НП)', width: 34 }, { title: 'Отримано', width: 17 }, { title: 'Післяплата', width: 12, fmt: 'money' },
    ];
    const row = (o) => [o.order_num, fmtDateTime(o.created_at.replace(' ', 'T')), o.customer, o.phone, o.ttn, retTtn(o), o.status_name, o.ret_status,
      o.ret_got_at ? `${fmtDateTime(o.ret_got_at)}${o.ret_manual ? ' (вручну)' : ''}` : '', o.cod || ''];
    const wait = d.rows.filter((o) => !o.ret_got_at), got = d.rows.filter((o) => o.ret_got_at);
    downloadXlsx(`rozetka-povernennya-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: 'Очікуємо отримання', cols, rows: wait.map(row) },
      { name: 'Отримано', cols, rows: got.map(row) },
    ]);
    toast(`Вивантажено: очікуємо ${wait.length} · отримано ${got.length}`);
  }

  async function markings(ids) {
    const win = window.open('', '_blank');
    if (win) win.document.write('<p style="font:16px sans-serif;padding:24px">Отримую маркування з Розетки…</p>');
    try {
      const res = await fetch('/api/rzs/markings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Маркування не отримано.');
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.open(url, '_blank');
      const skipped = Number(res.headers.get('X-Markings-Skipped')) || 0;
      toast(`Маркувань: ${res.headers.get('X-Markings-Printed') || '?'}${skipped ? ` · пропущено ${skipped} (без ТТН тощо)` : ''}`);
    } catch (e) { win?.close(); toast(e.message, true); }
  }

  // ---------------------------------------------------------------- картка замовлення
  const seatsTable = (seats, editable = false) => `<table class="list"><thead><tr><th>Місце</th><th class="r">Д, см</th><th class="r">Ш, см</th><th class="r">В, см</th><th class="r">Вага, кг</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
    ${seats.map((s, i) => `<tr><td>${i + 1}</td>${['lengthCm', 'widthCm', 'heightCm', 'weightKg'].map((k) => `<td class="r">${editable ? `<input data-seat="${i}" data-k="${k}" value="${esc(s[k] ?? '')}" inputmode="decimal" style="width:70px">` : esc(s[k] ?? '—')}</td>`).join('')}
      ${editable ? `<td class="r"><button type="button" class="btn sm danger" data-sdel="${i}">✕</button></td>` : ''}</tr>`).join('')}</tbody></table>`;
  async function orderModal(id) {
    let o;
    try { o = await api('GET', `/api/rzs/orders/${id}`); } catch (e) { toast(e.message, true); return; }
    const edit = can('retail.edit');
    const unitSeats = (p) => (p.own_seats?.length ? p.own_seats : p.cargoSeats);
    let seats = o.products.flatMap((p) => Array.from({ length: p.quantity }, () => unitSeats(p).map((s) => ({ ...s })))).flat();
    const m = modal(`Розетка ${o.order_num || ''}`, `<div class="form-stack">
        ${stepsHtml(o)}
        <div class="grid2"><div><b>${esc(o.customer)}</b><div class="small">${esc(o.phone)}</div><div class="small">${esc([o.city, o.street].filter(Boolean).join(', '))}${o.address_id ? ` · відд. ${esc(o.address_id)}` : ''}</div>
            <div class="small muted">${esc([o.delivery_type, o.delivery_company].filter(Boolean).join(' · '))}${o.cod ? ` · післяплата <b>${money(o.cod)} грн</b>` : ''}</div></div>
          <div><span class="badge ${ST_CLS[o.status] || ''}">${esc(o.status_name)}</span> ${o.uzd_name ? `<span class="badge ${UZD_CLS[o.uzd_status] || ''}">${esc(o.uzd_name)}</span>` : ''}
            <div class="small">ТТН: ${o.ttn ? `<b>${esc(o.ttn)}</b>${o.tracking_status ? ` · ${esc(o.tracking_status)}` : ''}` : '—'}</div>
            <div class="small">Документи: ${o.document_link ? `<a href="${esc(o.document_link)}" target="_blank" rel="noopener">📄 відкрити</a>` : 'ще немає'}${o.docs_at ? ` · з ${esc(fmtDateTime(o.docs_at))}` : ''}${o.invoice_no ? ` · рахунок Вчасно № ${esc(o.invoice_no)}` : ''}</div>
            <div class="small">LP-CRM: ${o.crm_id ? `№ <b>${esc(o.crm_id)}</b>` : o.crm_code ? 'передано' : '—'}${o.crm_status ? ` · ${esc(o.crm_status)}` : ''}</div>
            ${edit ? `<div class="btn-row" style="margin-top:4px"><input id="omCrmNo" value="${esc(o.crm_id || '')}" placeholder="№ замовлення в LP-CRM" inputmode="numeric" style="max-width:170px" aria-label="Номер замовлення в LP-CRM">
              <button type="button" class="btn sm" id="omLink">${o.crm_id || o.crm_code ? 'Змінити' : '🔗 Прив’язати'}</button>${o.crm_id || o.crm_code ? '<button type="button" class="btn sm danger" id="omUnlink">Відв’язати</button>' : ''}</div>` : ''}
            ${o.note ? `<div class="small muted">${esc(o.note)}</div>` : ''}</div></div>
        <table class="list"><thead><tr><th>Товар</th><th class="r">К-сть</th><th class="r">Ціна закупівлі</th><th>Товар LP-CRM</th>${o.sn_required ? '<th>Серійні номери</th>' : ''}</tr></thead><tbody>
          ${o.products.map((p) => `<tr><td>${esc(p.name || '—')}<div class="small muted">арт. ${esc(p.supplierCode)}${p.rzCode ? ` · код Розетки ${esc(p.rzCode)}` : ''}</div></td>
            <td class="r">${p.quantity}${p.confirmedQuantity != null && p.confirmedQuantity !== p.quantity ? `<div class="small muted">підтв. ${p.confirmedQuantity}</div>` : ''}</td>
            <td class="r">${p.purchase_price ? money(p.purchase_price) : '<span class="badge bad">немає</span>'}</td>
            <td class="small">${p.product_id ? `ID ${p.product_id}` : '<span class="badge bad">не зіставлено</span>'}</td>
            ${o.sn_required ? `<td><input data-sn="${esc(p.supplierCode)}" placeholder="${p.quantity} шт. через кому" value="${esc((p.serialNumbers || []).join(', '))}" ${edit ? '' : 'disabled'}></td>` : ''}</tr>`).join('')}</tbody></table>
        <div><b>Місця для ТТН</b> <span class="small muted">— з каталогу Розетки або свої габарити товару («Товари»); можна змінити тут</span></div>
        <div id="omSeats"></div>
        ${edit ? '<div class="btn-row"><button type="button" class="btn sm" id="omSeatAdd">+ Місце</button></div>' : ''}
      </div>`, { wide: true, footer: (() => {
        // Кнопка наступного етапу активна лише після попереднього; недоступна — сіра, з причиною в підказці.
        const btn = (id, k, label, primary) => { const why = blockedWhy(o, k); return `<button class="btn ${primary && !why ? 'primary' : ''}" id="${id}" ${why ? `disabled title="${esc(why)}"` : ''}>${label}</button>`; };
        const reTtn = o.ttn && ['confirmed', 'problem', 'shipping'].includes(o.status);
        return `<button class="btn" data-close>Закрити</button>
          ${edit && ['new', 'updated'].includes(o.status) ? btn('omConfirm', 'confirm', '✅ 1. Підтвердити', true) : ''}
          ${edit ? (reTtn ? '<button class="btn" id="omTtn">🚚 Перевипустити ТТН</button>' : btn('omTtn', 'ttn', '🚚 3. Створити ТТН', true)) : ''}
          ${btn('omMark', 'mark', '🏷 4. Маркування', false)}
          ${edit && !o.crm_id && !o.crm_code ? btn('omCrm', 'crm', '➕ 4. У LP-CRM', !!o.ttn) : ''}`;
      })() });
    const drawSeats = () => {
      $('#omSeats', m.el).innerHTML = seats.length ? seatsTable(seats, edit) : '<div class="small muted">Габаритів немає — додайте місце або вкажіть габарити товару в «Товари».</div>';
      $$('[data-seat]', m.el).forEach((i) => (i.onchange = () => { seats[Number(i.dataset.seat)][i.dataset.k] = n2(i.value); }));
      $$('[data-sdel]', m.el).forEach((b) => (b.onclick = () => { seats.splice(Number(b.dataset.sdel), 1); drawSeats(); }));
    };
    drawSeats();
    $('#omSeatAdd', m.el) && ($('#omSeatAdd', m.el).onclick = () => { seats.push({ lengthCm: '', widthCm: '', heightCm: '', weightKg: '' }); drawSeats(); });
    const act = (sel, fn) => $(sel, m.el) && ($(sel, m.el).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { if ((await fn()) === false) { b.disabled = false; return; } m.close(); viewOrders(); } catch (er) { toast(er.message, true); b.disabled = false; }
    });
    act('#omConfirm', async () => {
      const serials = Object.fromEntries($$('[data-sn]', m.el).map((i) => [i.dataset.sn, i.value]));
      const r = await api('POST', `/api/rzs/orders/${o.id}/confirm`, { serials });
      toast(r.warnings?.length ? `Підтверджено з попередженнями: ${r.warnings.join('; ')}` : 'Підтверджено', !!r.warnings?.length);
    });
    act('#omTtn', async () => {
      if (o.ttn && !(await confirmDanger('Перевипустити ТТН?', `Нова ТТН замінить ${esc(o.ttn)}; стара в Новій пошті автоматично не скасовується.`, 'Перевипустити'))) return false;
      const r = await api('POST', `/api/rzs/orders/${o.id}/ttn`, { seats, replace: !!o.ttn });
      toast(`ТТН ${r.ttn || 'створено'}${r.point ? ` · ${r.point}` : ''}`);
    });
    act('#omCrm', async () => {
      const r = await api('POST', `/api/rzs/orders/${o.id}/crm`, {});
      toast(r.crm_id ? `Додано в LP-CRM: № ${r.crm_id}` : 'Додано в LP-CRM');
    });
    $('#omMark', m.el) && ($('#omMark', m.el).onclick = () => markings([o.id]));
    act('#omLink', async () => {
      const v = $('#omCrmNo', m.el).value.trim();
      if (!v) { toast('Впишіть номер замовлення з LP-CRM', true); return false; }
      const r = await api('PUT', `/api/rzs/orders/${o.id}/crm-link`, { crm: v });
      toast(`Прив’язано до LP-CRM № ${r.crm_id || v}`);
    });
    act('#omUnlink', async () => {
      if (!(await confirmDanger('Відв’язати від LP-CRM?', 'Замовлення в LP-CRM не зміниться — лише зникне прив’язка тут.', 'Відв’язати'))) return false;
      await api('PUT', `/api/rzs/orders/${o.id}/crm-link`, { crm: '' });
      toast('Відв’язано');
    });
  }

  // Пошук у LP-CRM за ТТН (і підказки за телефоном): точний збіг ТТН прив’язується одразу, решту — вибираєте самі.
  async function findCrm(ids) {
    toast('Шукаю в LP-CRM…');
    let r;
    try { r = await api('POST', '/api/rzs/crm-find', ids ? { ids } : {}); } catch (e) { toast(e.message, true); return; }
    const m = modal('Пошук у LP-CRM', `<div class="form-stack">
        <div>Перевірено замовлень без LP-CRM: <b>${r.checked}</b> · прив’язано за ТТН: <b>${r.linked.length}</b>${r.notFound ? ` · не знайдено: ${r.notFound}` : ''}</div>
        ${r.linked.length ? `<div class="small">${r.linked.map((x) => `${esc(x.order_num)} → LP-CRM № <b>${esc(x.crm_id)}</b>`).join('<br>')}</div>` : ''}
        ${r.suggest.length ? `<div><b>Можливі збіги — перевірте й прив’яжіть:</b></div>
          <table class="list"><thead><tr><th>Розетка</th><th>LP-CRM</th><th></th></tr></thead><tbody>
          ${r.suggest.flatMap((x) => x.crm.map((y) => `<tr><td><b>${esc(x.order_num)}</b><div class="small muted">${esc([x.customer, x.phone, x.ttn].filter(Boolean).join(' · '))}</div></td>
            <td>№ <b>${esc(y.id)}</b> <span class="badge info">за ${esc(y.by)}</span><div class="small muted">${esc([y.name, y.ttn ? `ТТН ${y.ttn}` : 'без ТТН'].filter(Boolean).join(' · '))}</div></td>
            <td class="r"><button class="btn sm" data-lk="${esc(x.id)}" data-crm="${esc(y.id)}">🔗 Прив’язати</button></td></tr>`)).join('')}</tbody></table>` : ''}
        ${r.notFound ? '<div class="small muted">Не знайдені — ще не внесені в LP-CRM, без ТТН у LP-CRM, або ТТН інша. Їх можна прив’язати вручну в картці замовлення (№ з LP-CRM) або передати кнопкою «➕ У LP-CRM».</div>' : ''}
      </div>`, { wide: true, footer: '<button class="btn primary" data-close>Готово</button>' });
    $$('[data-lk]', m.el).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await api('PUT', `/api/rzs/orders/${b.dataset.lk}/crm-link`, { crm: b.dataset.crm }); b.textContent = '✅ Прив’язано'; $$(`[data-lk="${b.dataset.lk}"]`, m.el).forEach((x) => { x.disabled = true; }); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    }));
    new MutationObserver((_, obs) => { if (!document.contains(m.el)) { obs.disconnect(); viewOrders(); } }).observe(document.body, { childList: true });
  }

  // ---------------------------------------------------------------- товари й ціни
  const RZ_ST = { available: ['є на сайті', 'ok'], unavailable: ['немає в наявності', 'warn'], archive: ['архів', 'bad'] };
  const PV = { '': 'Усі', nomap: 'Не прив’язані до LP-CRM', warn: 'Перевірити прив’язку', available: 'Є на сайті', noprice: 'Без ціни закупівлі' };
  const pf = { v: '', q: '', brand: '' };
  async function viewProducts() {
    const all = await api('GET', '/api/rzs/products');
    const edit = can('refs.edit');
    const q = pf.q.trim().toLowerCase();
    const brands = [...new Set(all.map((p) => p.brand).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'uk'));
    if (pf.brand && !brands.includes(pf.brand)) pf.brand = '';
    const rows = all.filter((p) => (!pf.brand || p.brand === pf.brand) && (!pf.v || (pf.v === 'nomap' && !p.product_id) || (pf.v === 'available' && p.rz_status === 'available') || (pf.v === 'noprice' && !(p.purchase_price > 0)) || (pf.v === 'warn' && p.map_warn))
      && (!q || [p.code, p.rz_code, p.name, p.brand, p.product_id].some((x) => String(x ?? '').toLowerCase().includes(q))));
    const pvCount = (k) => (!k ? all.length : all.filter((p) => (k === 'nomap' && !p.product_id) || (k === 'available' && p.rz_status === 'available') || (k === 'noprice' && !(p.purchase_price > 0)) || (k === 'warn' && p.map_warn)).length);
    const lastImport = all.map((p) => p.imported_at).filter(Boolean).sort().pop();
    main.innerHTML = `
      <div class="head-row"><h2>Розетка — товари й ціни закупівлі</h2><div class="btn-row">
        ${edit ? '<label class="btn primary">📥 Завантажити товари з Розетки (CSV)<input type="file" id="rpImp" accept=".csv,text/csv" hidden></label><button class="btn" id="rpAdd">+ Товар</button>' : ''}<a class="btn" href="#/rzpricelog">🕘 Журнал змін</a>
</div></div>
      <div class="alert info help" style="margin-bottom:12px"><b>Як оновити:</b> Кабінет постачальника Розетки → вивантажте товари в CSV → «📥 Завантажити товари з Розетки». Нові артикули додадуться,
        у наявних оновляться назва, код Розетки, РРЦ, ціна закупівлі, залишок і статус; прив’язка до LP-CRM і габарити лишаються.
        <b>Ціна закупівлі</b> йде в LP-CRM у замовлення Розетки (не роздрібна). <b>Товар LP-CRM (ID)</b> підставляється сам, якщо артикул збігається з артикулом у каталозі, інакше — впишіть ID товару з LP-CRM.
        ${lastImport ? `<div class="small" style="margin-top:4px">Останнє завантаження: ${esc(fmtDateTime(lastImport))}</div>` : ''}</div>
      ${fpLayout(`${fpGroup('Пошук', `<input id="rpQ" type="search" placeholder="Артикул, код Розетки, назва, бренд" value="${esc(pf.q)}" aria-label="Пошук товару">`)}
        ${fpGroup('Показати', Object.entries(PV).map(([k, v]) => fpBtn(`<span>${esc(v)}</span><span class="small">${pvCount(k) || ''}</span>`, pf.v === k, `data-pv="${k}"`)).join(''))}
        ${brands.length > 1 ? fpGroup('Бренд', [['', 'Усі бренди'], ...brands.map((b) => [b, b])].map(([k, v]) => fpBtn(`<span>${esc(v)}</span><span class="small">${k ? all.filter((p) => p.brand === k).length : ''}</span>`, pf.brand === k, `data-pb="${esc(k)}"`)).join('')) : ''}`,
      `<div class="kpis">
        ${fpKpi('Товарів', String(all.length), rows.length !== all.length ? `у списку ${rows.length}` : '')}
        ${fpKpi('Не прив’язані до LP-CRM', String(pvCount('nomap')), pvCount('nomap') ? 'такі замовлення не підуть у LP-CRM' : '', pvCount('nomap') ? 'kpi-bad' : '')}
        ${fpKpi('Без ціни закупівлі', String(pvCount('noprice')))}
        ${fpKpi('Перевірити прив’язку', String(pvCount('warn')), pvCount('warn') ? 'товар LP-CRM схожий на інший' : '', pvCount('warn') ? 'kpi-bad' : '')}
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Артикул</th><th>Товар LP-CRM (ID)</th><th>Назва</th><th class="r">Ціна закупівлі</th><th class="r">РРЦ</th><th class="r">Залишок</th><th>Габарити (на 1 шт.)</th></tr></thead><tbody>
        ${rows.map((p) => `<tr data-code="${esc(p.code)}">
          <td><b>${esc(p.code)}</b>${p.rz_code ? `<div class="small muted">Розетка ${esc(p.rz_code)}</div>` : ''}${RZ_ST[p.rz_status] ? `<div><span class="badge ${RZ_ST[p.rz_status][1]}">${RZ_ST[p.rz_status][0]}</span></div>` : ''}</td>
          <td><input data-f="product_id" value="${esc(p.product_id ?? '')}" inputmode="numeric" style="width:90px" ${edit ? '' : 'disabled'} class="${p.product_id ? '' : 'bad-input'}" aria-label="ID товару LP-CRM">${p.crm_name ? `<div class="small muted" style="max-width:220px">${esc(p.crm_name)}</div>` : ''}${p.map_warn ? `<div><span class="badge bad" title="${esc(p.map_warn)}">⚠ ${esc(p.map_warn)}</span></div>` : ''}</td>
          <td><input data-f="name" value="${esc(p.name || '')}" style="min-width:220px" ${edit ? '' : 'disabled'} aria-label="Назва">${p.brand ? `<div class="small muted">${esc(p.brand)}</div>` : ''}</td>
          <td class="r"><input data-f="purchase_price" value="${esc(p.purchase_price ?? '')}" inputmode="decimal" style="width:100px" ${edit ? '' : 'disabled'} aria-label="Ціна закупівлі"></td>
          <td class="r"><input data-f="rrp" value="${esc(p.rrp ?? '')}" inputmode="decimal" style="width:100px" ${edit ? '' : 'disabled'} aria-label="РРЦ"></td>
          <td class="r"><input data-f="stock" value="${esc(p.stock ?? '')}" inputmode="numeric" style="width:70px" ${edit ? '' : 'disabled'} aria-label="Залишок"></td>
          <td class="small">${p.seats.length ? p.seats.map((x) => `${x.lengthCm}×${x.widthCm}×${x.heightCm} см, ${x.weightKg} кг`).join('<br>') : '<span class="muted">з каталогу Розетки</span>'}
            ${edit ? `<button class="btn sm" data-seats="${esc(p.code)}" aria-label="Габарити">✎</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>`
        : all.length ? '<div class="card empty"><div class="big">Нічого не знайдено</div>Змініть фільтр або пошук.</div>'
          : '<div class="card empty"><div class="big">Товарів ще немає</div>Завантажте вивантаження товарів з Кабінету постачальника (CSV) — або вони з’являться з першими замовленнями.</div>'}`, { summary: [PV[pf.v] || 'Усі', pf.brand, pf.q].filter(Boolean).join(' · ') })}`;
    wireFp();
    $$('[data-pb]').forEach((b) => (b.onclick = () => { pf.brand = b.dataset.pb; viewProducts(); }));
    $$('[data-pv]').forEach((b) => (b.onclick = () => { pf.v = b.dataset.pv; viewProducts(); }));
    let qt;
    $('#rpQ').oninput = (e) => { clearTimeout(qt); qt = setTimeout(async () => { pf.q = e.target.value; await viewProducts(); const el = $('#rpQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 300); };
    $('#rpImp') && ($('#rpImp').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1251').decode(buf); }
        const res = await fetch('/api/rzs/products/import', { method: 'POST', headers: { 'Content-Type': 'text/csv; charset=utf-8' }, body: text });
        const r = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(r.error || 'Не вдалося завантажити файл.');
        modal('Товари завантажено', `<div class="form-stack"><div>✅ У файлі: <b>${r.total}</b> товарів — нових <b>${r.added}</b>, оновлено <b>${r.updated}</b>${r.skipped ? `, пропущено без артикула: ${r.skipped}` : ''}.</div>
          ${r.updated ? `<div>${r.changed ? `Змінилось у <b>${r.changed}</b> товарах` : 'У наявних товарах змін порівняно з попереднім завантаженням немає'}${r.prices ? ` · цін закупівлі: <b>${r.prices}</b>` : ''}.</div>` : ''}
          ${r.price_list?.length ? `<div class="table-wrap" style="max-height:260px;overflow:auto"><table class="list"><thead><tr><th>Товар</th><th class="r">Було</th><th class="r">Стало</th></tr></thead><tbody>${r.price_list.map((x) => `<tr><td class="small">${esc(x.name || x.code)}<div class="muted">${esc(x.code)}</div></td><td class="r nowrap">${x.old ? money(Number(x.old)) : '—'}</td><td class="r nowrap"><b>${x.new ? money(Number(x.new)) : '—'}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
          ${r.batch ? '<div class="small"><a href="#/rzpricelog" data-close>Усі зміни — у журналі змін цін →</a></div>' : ''}
          ${r.unmapped ? `<div class="alert warn small">Не прив’язано до товару LP-CRM: <b>${r.unmapped}</b> — впишіть ID у другій колонці (фільтр «Не прив’язані до LP-CRM»). Без цього такі замовлення не передадуться в LP-CRM.</div>` : '<div class="small">Усі товари прив’язані до LP-CRM.</div>'}</div>`,
        { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
        if (r.unmapped) pf.v = 'nomap';
        viewProducts();
      } catch (er) { toast(er.message, true); e.target.value = ''; }
    });
    $$('[data-f]').forEach((i) => (i.onchange = async () => {
      const code = i.closest('tr').dataset.code;
      try { await api('PUT', `/api/rzs/products/${encodeURIComponent(code)}`, { [i.dataset.f]: i.value }); toast('Збережено'); if (i.dataset.f === 'product_id') viewProducts(); }
      catch (e) { toast(e.message, true); }
    }));
    $$('[data-seats]').forEach((b) => (b.onclick = () => {
      const p = rows.find((x) => x.code === b.dataset.seats);
      let seats = p.seats.length ? p.seats.map((s) => ({ ...s })) : [{ lengthCm: '', widthCm: '', heightCm: '', weightKg: '' }];
      const m = modal(`Габарити ${p.code} (на 1 шт.)`, '<div class="form-stack"><div class="small muted">Кілька місць — якщо товар іде кількома коробками. Порожньо — брати з каталогу Розетки.</div><div id="psT"></div><button class="btn sm" id="psAdd">+ Місце</button></div>',
        { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="psSave">Зберегти</button>' });
      const draw = () => {
        $('#psT', m.el).innerHTML = seatsTable(seats, true);
        $$('[data-seat]', m.el).forEach((i) => (i.onchange = () => { seats[Number(i.dataset.seat)][i.dataset.k] = i.value; }));
        $$('[data-sdel]', m.el).forEach((x) => (x.onclick = () => { seats.splice(Number(x.dataset.sdel), 1); draw(); }));
      };
      draw();
      $('#psAdd', m.el).onclick = () => { seats.push({ lengthCm: '', widthCm: '', heightCm: '', weightKg: '' }); draw(); };
      $('#psSave', m.el).onclick = async () => {
        try { await api('PUT', `/api/rzs/products/${encodeURIComponent(p.code)}`, { seats: seats.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === '' ? '' : n2(v)]))) }); m.close(); toast('Збережено'); viewProducts(); }
        catch (e) { toast(e.message, true); }
      };
    }));
    $('#rpAdd') && ($('#rpAdd').onclick = async () => {
      const m = modal('Додати товар Розетки', '<form id="rpF" class="form-stack"><label class="f"><span>Артикул постачальника (як заведено на Розетці)</span><input name="code" required autocomplete="off"></label></form>',
        { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="rpSave">Додати товар</button>' });
      $('#rpSave', m.el).onclick = async () => {
        const code = $('#rpF', m.el).code.value.trim();
        if (!code) { toast('Вкажіть артикул', true); return; }
        try { await api('POST', '/api/rzs/products', { code }); m.close(); viewProducts(); } catch (e) { toast(e.message, true); }
      };
    });
  }

  // ---------------------------------------------------------------- налаштування кабінетів
  let accSel = null; // обраний кабінет у налаштуваннях
  async function viewSettings() {
    const rows = await api('GET', '/api/rzs/accounts');
    const cur = rows.find((a) => a.id === accSel) || rows[0];
    main.innerHTML = `
      <div class="head-row"><h2>Розетка — кабінети постачальника</h2><button class="btn primary" id="raNew">+ Підключити кабінет</button></div>
      <div class="alert info help" style="margin-bottom:14px">Токен: Кабінет постачальника Розетки → <b>Налаштування → Токени</b> → «Згенерувати токен».
        Після підключення вставте адресу, логін і пароль вебхука в Кабінеті Розетки (<b>Налаштування → Вебхуки</b>), позначте «Дропшипінг» (додавання, зміна, видалення) — замовлення з’являтимуться тут одразу.</div>
      ${rows.length ? `<div class="fp"><div class="card an7-f" style="padding:8px;gap:4px">${fpGroup('Кабінети', rows.map((a) => fpBtn(`<span>${esc(a.name)}</span><span class="small">${a.active ? (a.sync_error ? '⚠️' : '') : 'вимк.'}</span>`, a.id === cur.id, `data-acc="${a.id}"`)).join(''))}</div>
        <div class="fp-main">${[cur].map((a) => `<div class="card form-stack" style="margin:0">
          <div class="head-row" style="margin:0"><h3 style="margin:0">${esc(a.name)} ${a.active ? '' : '<span class="badge bad">вимкнено</span>'}</h3><button class="btn sm" data-ae="${a.id}">Змінити</button></div>
          <div class="form-stack" style="gap:6px;max-width:640px">${[
            ['Токен', esc(a.token)],
            ['Відділ LP-CRM', esc(a.crm_office || '<не вказано>')],
            ['Доставка LP-CRM', esc(a.crm_delivery || '—')],
            ['Оновлено з Розетки', a.synced_at ? esc(fmtDateTime(a.synced_at)) : '—'],
            ['Вебхук', a.hook_at ? esc(fmtDateTime(a.hook_at)) : 'ще не надходив'],
            ['🔔 Telegram', `${[a.notify_inv ? 'з’явився рахунок' : '', a.notify_ttn ? 'можна створити ТТН' : ''].filter(Boolean).join(', ') || 'вимкнено'}${(a.notify_inv || a.notify_ttn) ? ` → ${a.notify_users.length ? `${a.notify_users.length} корист.` : 'власник і адміністратори'}` : ''}`],
          ].map(([k, v]) => `<div class="an7-kv small"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
          <div class="f"><span>Вебхук для Кабінету Розетки (Налаштування → Вебхуки)</span>
            <div class="grid2"><div class="pl-url"><input readonly value="${esc(a.hook.url)}" aria-label="URL вебхука"><button type="button" class="btn sm" data-cp="${esc(a.hook.url)}">Копіювати</button></div>
              <div class="pl-url"><input readonly value="${esc(a.hook.user)}" aria-label="Логін"><button type="button" class="btn sm" data-cp="${esc(a.hook.user)}">Логін</button><input readonly value="${esc(a.hook.pass)}" aria-label="Пароль"><button type="button" class="btn sm" data-cp="${esc(a.hook.pass)}">Пароль</button></div></div></div>
        </div>`).join('')}</div></div>`
        : '<div class="card empty"><div class="big">Кабінет ще не підключено</div>Натисніть «Підключити кабінет» і вставте токен.</div>'}`;
    $$('[data-acc]').forEach((b) => (b.onclick = () => { accSel = Number(b.dataset.acc); viewSettings(); }));
    $$('[data-cp]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.cp); toast('Скопійовано'); } catch { toast('Не вдалося скопіювати', true); } }));
    const form = async (a) => {
      const users = await api('GET', '/api/rzs/notify-users').catch(() => []);
      const sel = new Set((a?.notify_users || []).map(Number));
      const m = modal(a ? `Кабінет «${a.name}»` : 'Підключити кабінет постачальника Розетки', `<form id="raF" class="form-stack">
          <label class="f"><span>Назва</span><input name="name" value="${esc(a?.name || '')}" placeholder="Напр. Ековент на Розетці"></label>
          <label class="f"><span>Токен (JWT)</span><input name="token" value="${esc(a?.token || '')}" autocomplete="off" placeholder="Кабінет постачальника → Налаштування → Токени"></label>
          <label class="f"><span>ID відділу LP-CRM для замовлень</span><input name="crm_office" value="${esc(a?.crm_office || '')}" inputmode="numeric"></label>
          <div class="grid2"><label class="f"><span>ID доставки в LP-CRM (Нова пошта — 1)</span><input name="crm_delivery" value="${esc(a?.crm_delivery ?? '1')}" inputmode="numeric"></label>
            <label class="f"><span>Сайт-джерело в LP-CRM</span><input name="crm_site" value="${esc(a?.crm_site || '')}" placeholder="rozetka.com.ua"></label></div>
          <label class="f"><span>«Додаткове поле 1» в LP-CRM</span><input name="crm_field1" value="${esc(a ? a.crm_field1 ?? '' : 'Riteil(Rozetka)')}" placeholder="Riteil(Rozetka)"><span class="small muted">Заповнюється в кожному замовленні Розетки, переданому в LP-CRM (порожньо — не заповнювати).</span></label>
          <fieldset class="card form-stack" style="margin:0"><legend class="small"><b>🔔 Сповіщення в Telegram-бот</b></legend>
            <label class="check"><input type="checkbox" name="notify_inv" ${a?.notify_inv ? 'checked' : ''}> З’явився вхідний рахунок (Вчасно) — після підтвердження замовлення</label>
            <label class="check"><input type="checkbox" name="notify_ttn" ${a?.notify_ttn ? 'checked' : ''}> Можна створювати ТТН — документи звірено (ЮЗД)</label>
            <div class="small muted">Кому (нікого не вибрано — власник і адміністратори з підключеним ботом):</div>
            <div class="form-stack" style="gap:2px;max-height:180px;overflow:auto">${users.map((u) => `<label class="check"><input type="checkbox" name="nu" value="${u.id}" ${sel.has(u.id) ? 'checked' : ''}> ${esc(u.name)}${u.admin ? ' <span class="small muted">· адмін</span>' : ''}${u.tg ? '' : ' <span class="badge warn">бот не підключено</span>'}</label>`).join('')}</div>
          </fieldset>
          ${a ? `<label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Увімкнено</label><label class="check"><input type="checkbox" name="new_hook_pass"> Новий пароль вебхука</label>` : ''}
        </form>`, { footer: `${a ? '<button class="btn danger" id="raDel" style="margin-right:auto">Видалити</button>' : ''}<button class="btn" data-close>Скасувати</button><button class="btn primary" id="raSave">Зберегти</button>` });
      $('#raSave', m.el).onclick = async (e) => {
        const f = $('#raF', m.el);
        const d = Object.fromEntries(new FormData(f));
        if (a) { d.active = f.active.checked; d.new_hook_pass = f.new_hook_pass.checked; }
        d.notify_inv = f.notify_inv.checked;
        d.notify_ttn = f.notify_ttn.checked;
        d.notify_users = $$('[name=nu]', m.el).filter((x) => x.checked).map((x) => Number(x.value));
        delete d.nu;
        e.currentTarget.disabled = true;
        try { await api(a ? 'PUT' : 'POST', a ? `/api/rzs/accounts/${a.id}` : '/api/rzs/accounts', d); m.close(); toast('Збережено'); viewSettings(); }
        catch (er) { toast(er.message, true); e.target.closest('button').disabled = false; }
      };
      $('#raDel', m.el) && ($('#raDel', m.el).onclick = async () => {
        if (!(await confirmDanger(`Видалити кабінет «${a.name}»?`, 'Його замовлення зникнуть зі списку (на Розетці нічого не зміниться).', 'Видалити'))) return;
        try { await api('DELETE', `/api/rzs/accounts/${a.id}`); m.close(); viewSettings(); } catch (er) { toast(er.message, true); }
      });
    };
    $('#raNew').onclick = () => form(null);
    $$('[data-ae]').forEach((b) => (b.onclick = () => form(rows.find((x) => String(x.id) === b.dataset.ae))));
  }

  // ---------------------------------------------------------------- журнал змін цін і товарів
  const LOG_F = { purchase_price: 'Ціна закупівлі', rrp: 'РРЦ', stock: 'Залишок', rz_status: 'Статус на Розетці', product_id: 'Товар LP-CRM (ID)', seats: 'Габарити', added: 'Новий товар' };
  const LOG_SRC = { import: ['Файл Розетки', 'info'], manual: ['Вручну', 'warn'], auto: ['Автоприв’язка', ''] };
  const lf = { q: '', field: '', batch: '' };
  const logVal = (f, v) => (v === '' ? '—' : ['purchase_price', 'rrp'].includes(f) ? money(Number(v)) : f === 'rz_status' ? (RZ_ST[v]?.[0] || v) : f === 'seats' ? (v ? 'задано' : '—') : esc(v));
  async function viewPriceLog() {
    const qs = new URLSearchParams(Object.entries({ code: lf.q, field: lf.field, batch: lf.batch }).filter(([, v]) => v)).toString();
    const d = await api('GET', `/api/rzs/products/log${qs ? `?${qs}` : ''}`);
    const lastBatch = d.batches[0];
    main.innerHTML = `
      <div class="head-row"><h2>Розетка — журнал змін цін і товарів</h2><div class="btn-row"><a class="btn" href="#/rzproducts">← Товари й ціни</a></div></div>
      ${fpLayout(`${fpGroup('Пошук', `<input id="lgQ" type="search" placeholder="Артикул або назва" value="${esc(lf.q)}" aria-label="Пошук у журналі">`)}
        ${fpGroup('Що змінилось', [['', 'Усі зміни'], ...Object.entries(LOG_F)].map(([k, v]) => fpBtn(`<span>${esc(v)}</span>`, lf.field === k, `data-lf="${k}"`)).join(''))}
        ${fpGroup('Завантаження файлів', [fpBtn('<span>Усі</span>', !lf.batch, 'data-lb=""'), ...d.batches.map((b) => fpBtn(`<span>${esc(fmtDateTime(b.at))}${b.user_name ? `<div class="small muted">${esc(b.user_name)}</div>` : ''}</span><span class="small">${b.prices ? `${b.prices} цін` : `${b.products} тов.`}</span>`, lf.batch === b.batch, `data-lb="${esc(b.batch)}"`))].join(''))}`,
      `<div class="kpis">
        ${fpKpi('Остання зміна ціни', d.price_changed_at ? esc(fmtDateTime(d.price_changed_at)) : '—')}
        ${fpKpi('Останнє завантаження файлу', d.imported_at ? esc(fmtDateTime(d.imported_at)) : '—', lastBatch && lastBatch.at.slice(0, 16) === String(d.imported_at).slice(0, 16) ? `змін у товарах: ${lastBatch.products}${lastBatch.prices ? `, цін: ${lastBatch.prices}` : ''}` : d.imported_at ? 'без змін' : '')}
        ${fpKpi('Записів у списку', String(d.rows.length), d.rows.length >= 1000 ? 'показано останні 1000' : '')}
      </div>
      ${d.rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Коли</th><th>Звідки</th><th>Товар</th><th>Що</th><th class="r">Було</th><th class="r">Стало</th></tr></thead><tbody>
        ${d.rows.map((x) => {
          const delta = ['purchase_price', 'rrp'].includes(x.field) && x.old_value && x.new_value ? (Number(x.new_value) - Number(x.old_value)) / Number(x.old_value) * 100 : null;
          return `<tr><td class="small nowrap">${esc(fmtDateTime(x.at))}</td>
          <td class="small"><span class="badge ${LOG_SRC[x.source]?.[1] || ''}">${esc(LOG_SRC[x.source]?.[0] || x.source)}</span>${x.user_name ? `<div class="muted">${esc(x.user_name)}</div>` : ''}</td>
          <td class="small">${esc(x.name || '')}<div class="muted">${esc(x.code)}</div></td>
          <td class="small">${esc(LOG_F[x.field] || x.field)}</td>
          <td class="r small nowrap">${x.field === 'added' ? '' : logVal(x.field, x.old_value)}</td>
          <td class="r small nowrap"><b>${x.field === 'added' ? x.new_value.split(' / ').map((v, i) => (v ? `${i ? 'РРЦ' : 'закупівля'} ${money(v)}` : '')).filter(Boolean).join('<br>') : logVal(x.field, x.new_value)}</b>${delta !== null && Number.isFinite(delta) ? `<div class="${delta > 0 ? 'bad-t' : 'ok-t'}" style="color:${delta > 0 ? 'var(--bad, #b42318)' : 'var(--ok, #157f3b)'}">${delta > 0 ? '+' : ''}${delta.toFixed(1).replace('.', ',')}%</div>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>`
        : `<div class="card empty"><div class="big">Змін ще немає</div>${lf.q || lf.field || lf.batch ? 'Змініть фільтр або пошук.' : 'Журнал ведеться з цього оновлення: після наступного завантаження файлу з Розетки тут з’явиться, що змінилось.'}</div>`}`,
      { summary: [LOG_F[lf.field] || 'Усі зміни', lf.q].filter(Boolean).join(' · ') })}`;
    wireFp();
    $$('[data-lf]').forEach((b) => (b.onclick = () => { lf.field = b.dataset.lf; viewPriceLog(); }));
    $$('[data-lb]').forEach((b) => (b.onclick = () => { lf.batch = b.dataset.lb; viewPriceLog(); }));
    let qt;
    $('#lgQ').oninput = (e) => { clearTimeout(qt); qt = setTimeout(async () => { lf.q = e.target.value.trim(); await viewPriceLog(); const el = $('#lgQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 350); };
  }

  return { viewOrders, viewProducts, viewSettings, viewPriceLog };
}
