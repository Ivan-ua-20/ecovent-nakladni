// «Перевірка»: автоматична звірка відправлених замовлень LP-CRM — вид оплати ↔ наложка в ТТН, чек Checkbox (сума, спосіб
// оплати, ФОП), оплата на рахунок ↔ ФОП чека, можливі дублі. Окрема вкладка «Чеки за день» — замість зошита: кожен чек ФОП
// з замовленням, до якого його зіставлено. «Види оплат» — що очікувати для кожного виду оплати LP-CRM.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, fmtDateTime, todayKyiv } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { fpLayout, wireFp, fpGroup, fpBtn, fpKpi } from './b2b-shared.js';

const LEVELS = [
  ['problems', 'Усі проблеми', 'помилки й увага'], ['bad', 'Помилки', 'треба виправити'], ['warn', 'Увага', 'варто глянути'],
  ['wait', 'Очікує', 'чек чи ТТН ще не з’явились'], ['ok', 'Гаразд', ''], ['skip', 'Не перевіряємо', 'обмін, повернення тощо'], ['all', 'Усі', ''],
];
const LV = { bad: ['bad', 'Помилка'], warn: ['warn', 'Увага'], wait: ['info', 'Очікує'], ok: ['ok', 'Гаразд'], skip: ['', 'Не перевіряємо'], info: ['info', 'Примітка'] };
const ICON = { bad: '✖', warn: '!', wait: '…', ok: '✓', info: 'i', skip: '–' };
const CLS_NAME = { cod: 'післяплата', prepay: 'через сервіс', bank: 'на рахунок', skip: 'не перевіряємо' };
const phoneFmt = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-9); return d.length === 9 ? `0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}` : ''; };
const dmy = (d) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');
const hm = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' }).format(t); };
const uah = (n) => `${money(n || 0).replace(/,00$/, '')} ₴`;

export function createChecksPages() {
  const f = { lv: 'problems', office: '', pay: '', q: '', from: '', to: '' };
  let refreshing = false;
  let rDay = '';
  let rFree = false;

  const lvMatch = (r, lv) => (lv === 'all' ? true : lv === 'problems' ? r.level === 'bad' || r.level === 'warn' : r.level === lv);
  const hay = (r) => [r.id, r.code, r.ttn, r.buyer, r.phone, r.channel, r.office, r.payment, r.comment].join(' ').toLowerCase();
  const items = (r) => `<ul class="chk-items">${r.items.map((i) => `<li class="chk-${esc(i.level)}"><span class="chk-ic" aria-hidden="true">${ICON[i.level] || ''}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>`;
  const row = (r) => `<tr class="chk-row-${esc(r.level)}">
    <td class="nowrap"><b>№ ${esc(r.id || r.code)}</b><div class="small muted">${dmy(r.day)} · ${esc(r.status)}</div><div class="small muted">${esc(r.user || '')}</div></td>
    <td>${esc(r.buyer || '—')}${r.phone ? `<div class="small muted">${phoneFmt(r.phone)}</div>` : ''}<div class="small muted">${esc(r.channel || r.office || '')}</div></td>
    <td class="nowrap"><b>${uah(r.total)}</b><div class="small">${esc(r.payment)}</div><div class="small muted">${esc(CLS_NAME[r.cls] || '')}${r.partial ? ' · часткова' : ''}</div></td>
    <td class="nowrap">${r.ttn ? `<b>${esc(r.ttn)}</b>` : '<span class="muted">—</span>'}<div class="small muted">${esc(r.carrier)}</div>${r.cod ? `<div class="small">наложка ${uah(r.cod)}${r.cod_kind === 'ctrl' ? ' · контроль оплати' : ''}</div>` : ''}</td>
    <td>${r.receipt ? `<a href="${esc(r.receipt.url)}" target="_blank" rel="noopener">${uah(r.receipt.total)}</a><div class="small">${esc(r.receipt.fop)}</div><div class="small muted">${esc(r.receipt.pays.join(', '))}${r.receipt.bySum ? ' · за сумою' : ''}</div>`
    : '<span class="muted">—</span>'}${r.expected_fop && (!r.receipt || r.receipt.fop !== r.expected_fop) ? `<div class="small muted">за відділом: ${esc(r.expected_fop)}</div>` : ''}</td>
    <td style="min-width:260px"><span class="badge ${LV[r.level]?.[0] || ''}">${LV[r.level]?.[1] || ''}</span>${items(r)}${r.comment ? `<div class="small muted chk-com">Коментар: ${esc(r.comment)}</div>` : ''}</td>
  </tr>`;

  async function viewChecks() {
    const q = new URLSearchParams();
    if (f.from) q.set('from', f.from);
    if (f.to) q.set('to', f.to);
    const d = await api('GET', `/api/checks?${q}`);
    const base = d.rows.filter((r) => !f.q || hay(r).includes(f.q.toLowerCase()));
    const ok = (r, skip) => (skip === 'lv' || lvMatch(r, f.lv)) && (skip === 'office' || !f.office || (r.channel || r.office) === f.office) && (skip === 'pay' || !f.pay || r.payment === f.pay);
    const rows = base.filter((r) => ok(r, ''));
    const lvN = Object.fromEntries(LEVELS.map(([k]) => [k, base.filter((r) => ok(r, 'lv') && lvMatch(r, k)).length]));
    const cnt = (key, skip) => base.filter((r) => ok(r, skip)).reduce((m, r) => { const k = key(r); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
    const offN = cnt((r) => r.channel || r.office, 'office');
    const payN = cnt((r) => r.payment, 'pay');
    const opt = (map, val) => Object.keys(map).sort((a, b) => a.localeCompare(b, 'uk')).map((k) => `<option value="${esc(k)}" ${val === k ? 'selected' : ''}>${esc(k)} (${map[k]})</option>`).join('');
    const st = d.state || {};
    main.innerHTML = `
      <div class="head-row"><h2>Перевірка замовлень</h2><div class="btn-row">
        <button class="btn" id="chkRefresh">🔄 Оновити зараз</button><button class="btn" id="chkXls">⬇ Excel</button></div></div>
      <div class="small muted" style="margin-bottom:10px">Відправлені замовлення LP-CRM за ${dmy(d.from)}–${dmy(d.to)}: вид оплати ↔ наложка в ТТН, чек Checkbox, оплата на рахунок.
        ${st.finished ? `Дані оновлено ${esc(fmtDateTime(st.finished))}` : 'Дані ще збираються'}${st.more ? ' · збір триває…' : ''} · оновлюється само раз на 10 хв.</div>
      ${(st.errors || []).length ? `<div class="alert warn small" style="margin-bottom:10px">Не все вдалося зібрати: ${st.errors.map(esc).join('; ')}</div>` : ''}
      ${fpLayout(fpGroup('Результат', LEVELS.map(([k, v, hint]) => fpBtn(`<span class="ret-st"><span>${esc(v)}</span>${hint ? `<span class="small muted">${esc(hint)}</span>` : ''}</span><b class="small ${k === 'bad' && lvN[k] ? 'ret-bad' : ''}">${lvN[k] || ''}</b>`, f.lv === k, `data-clv="${k}"`)).join(''))
        + fpGroup('Період', `<div class="an7-dates ${f.from || f.to ? 'on' : ''}"><input id="chkFrom" type="date" value="${esc(f.from)}" aria-label="З дати"><input id="chkTo" type="date" value="${esc(f.to)}" aria-label="По дату"></div>`),
      `<div class="kpis">${fpKpi('Помилки', d.counts.bad || 0, 'треба виправити', d.counts.bad ? 'bad' : '')}${fpKpi('Увага', d.counts.warn || 0)}${fpKpi('Очікує', d.counts.wait || 0)}${fpKpi('Гаразд', d.counts.ok || 0)}</div>
      <div class="card ret-bar">
        <label class="ret-f ret-q"><span>Пошук</span><input id="chkQ" type="search" placeholder="№, ТТН, покупець, телефон" value="${esc(f.q)}"></label>
        <label class="ret-f"><span>Відділ / джерело</span><select id="chkOff"><option value="">Усі</option>${opt(offN, f.office)}</select></label>
        <label class="ret-f"><span>Вид оплати</span><select id="chkPay"><option value="">Усі</option>${opt(payN, f.pay)}</select></label>
        ${f.q || f.office || f.pay || f.from || f.to ? '<button type="button" class="btn sm" id="chkReset">Скинути</button>' : ''}
      </div>
      <div class="small muted">${rows.length} замовлень</div>
      ${rows.length ? `<div class="table-wrap"><table class="list chk"><thead><tr><th>Замовлення</th><th>Покупець</th><th>Сума й оплата</th><th>ТТН</th><th>Чек</th><th>Що перевірено</th></tr></thead><tbody>
        ${rows.slice(0, 500).map(row).join('')}</tbody></table></div>${rows.length > 500 ? `<div class="small muted">Показано 500 з ${rows.length} — звузьте фільтр.</div>` : ''}`
        : `<div class="card empty"><div class="big">${d.rows.length ? 'Нічого не знайдено' : 'Ще немає даних'}</div>${d.rows.length ? (f.lv === 'problems' ? 'Проблем не знайдено 🎉' : 'Змініть фільтр або пошук.') : 'Натисніть «Оновити зараз» — перший збір займає кілька хвилин.'}</div>`}`,
      { summary: LEVELS.find(([k]) => k === f.lv)?.[1] || '' })}`;
    wireFp();
    $$('[data-clv]').forEach((b) => (b.onclick = () => { f.lv = b.dataset.clv; viewChecks(); }));
    $('#chkOff').onchange = (e) => { f.office = e.target.value; viewChecks(); };
    $('#chkPay').onchange = (e) => { f.pay = e.target.value; viewChecks(); };
    $('#chkFrom').onchange = (e) => { f.from = e.target.value; viewChecks(); };
    $('#chkTo').onchange = (e) => { f.to = e.target.value; viewChecks(); };
    $('#chkReset') && ($('#chkReset').onclick = () => { Object.assign(f, { q: '', office: '', pay: '', from: '', to: '' }); viewChecks(); });
    let qt;
    $('#chkQ').oninput = (e) => { clearTimeout(qt); qt = setTimeout(async () => { f.q = e.target.value.trim(); await viewChecks(); const el = $('#chkQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 300); };
    $('#chkRefresh').onclick = () => refresh(viewChecks, '#/checks');
    if (refreshing) { const b = $('#chkRefresh'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Оновлюю…'; }
    $('#chkXls').onclick = () => {
      const cols = [{ title: '№', width: 10 }, { title: 'Дата', width: 11 }, { title: 'Статус', width: 16 }, { title: 'Покупець', width: 24 }, { title: 'Телефон', width: 14 }, { title: 'Відділ / джерело', width: 28 },
        { title: 'Сума', width: 11, fmt: 'money' }, { title: 'Вид оплати', width: 20 }, { title: 'ТТН', width: 17 }, { title: 'Наложка', width: 11, fmt: 'money' }, { title: 'Чек: ФОП', width: 22 }, { title: 'Чек: сума', width: 11, fmt: 'money' },
        { title: 'Результат', width: 12 }, { title: 'Що не так', width: 60 }];
      downloadXlsx(`perevirka-${todayKyiv()}.xlsx`, [{ name: 'Перевірка', cols, rows: rows.map((r) => [r.id || r.code, dmy(r.day), r.status, r.buyer, r.phone ? `0${r.phone}` : '', r.channel || r.office, r.total, r.payment, r.ttn, r.cod || '',
        r.receipt?.fop || '', r.receipt?.total ?? '', LV[r.level]?.[1] || '', r.items.filter((i) => i.level !== 'ok').map((i) => i.text).join('; ')]) }]);
    };
  }

  // Чеки за день по ФОП — замість зошита: зіставлені із замовленнями «закреслено», без замовлення — підсвічено.
  async function viewReceipts() {
    if (!rDay) rDay = todayKyiv();
    const d = await api('GET', `/api/checks/receipts?day=${encodeURIComponent(rDay)}`);
    const total = d.groups.reduce((s, g) => s + g.sum, 0);
    const free = d.groups.reduce((s, g) => s + g.free, 0);
    main.innerHTML = `
      <div class="head-row"><h2>Чеки за день</h2><div class="btn-row"><button class="btn" id="rcRefresh">🔄 Оновити зараз</button></div></div>
      <div class="card ret-bar">
        <label class="ret-f"><span>День</span><input id="rcDay" type="date" value="${esc(rDay)}" max="${todayKyiv()}"></label>
        <label class="ret-f chk-chk"><input id="rcFree" type="checkbox" ${rFree ? 'checked' : ''}> <span>Лише без замовлення</span></label>
      </div>
      <div class="kpis">${fpKpi('Чеків продажу', d.groups.reduce((s, g) => s + g.rows.filter((r) => !r.ret).length, 0), uah(total))}${fpKpi('Без замовлення', free, free ? 'перевірте вручну' : 'усі зіставлено', free ? 'warn' : '')}</div>
      ${!d.loaded ? '<div class="alert warn small">Чеки за цей день ще не завантажено (зберігаємо останні 14 днів). Натисніть «Оновити зараз».</div>' : ''}
      ${d.groups.map((g) => {
        const list = g.rows.filter((r) => !rFree || (!r.order && !r.ret));
        return `<div class="card"><div class="head-row"><h3>${esc(g.fop)}</h3><div class="small"><b>${uah(g.sum)}</b> · ${g.rows.length} чеків${g.ret ? ` · повернення ${uah(g.ret)}` : ''}${g.free ? ` · <span class="ret-bad">без замовлення: ${g.free}</span>` : ''}</div></div>
          ${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Час</th><th>Сума</th><th>Спосіб оплати</th><th>Замовлення</th><th>Чек</th></tr></thead><tbody>
          ${list.map((r) => `<tr class="${r.order ? 'chk-done' : r.ret ? '' : 'chk-row-warn'}"><td>${hm(r.at)}</td><td class="nowrap"><b>${r.ret ? '−' : ''}${uah(r.total)}</b></td><td class="small">${esc(r.pays.join(', ') || '—')}</td>
            <td>${r.order ? `✓ № ${esc(r.order.id || r.order.code)} <span class="small muted">${esc(r.order.buyer || '')}</span>` : r.ret ? '<span class="small muted">повернення</span>' : '<b>без замовлення</b>'}</td>
            <td class="small"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.fiscal || 'відкрити')}</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="small muted">Немає чеків за фільтром.</div>'}</div>`;
      }).join('') || '<div class="card empty"><div class="big">Чеків немає</div>За цей день у Checkbox чеків не знайдено.</div>'}`;
    $('#rcDay').onchange = (e) => { rDay = e.target.value || todayKyiv(); viewReceipts(); };
    $('#rcFree').onchange = (e) => { rFree = e.target.checked; viewReceipts(); };
    $('#rcRefresh').onclick = () => refresh(viewReceipts, '#/chkreceipts', '#rcRefresh');
  }

  // Види оплат LP-CRM: клас перевірки і слово, яке має бути в способі оплати чека.
  async function viewPay() {
    const d = await api('GET', '/api/checks/pay');
    main.innerHTML = `
      <div class="head-row"><h2>Види оплат</h2><div class="btn-row"><button class="btn primary" id="payKeep">Зберегти</button></div></div>
      <div class="small muted" style="margin-bottom:10px">Що очікувати для кожного виду оплати LP-CRM: <b>післяплата</b> — у ТТН має бути наложка на суму замовлення;
        <b>через сервіс</b> (RozetkaPay, Пром-оплата) і <b>на рахунок ФОП</b> — наложки бути не повинно; для «на рахунок» ще шукаємо надходження в Opendatabot.
        «У чеку має бути» — слово зі способу оплати в чеку Checkbox (як у модулі Checkbox LP-CRM); порожньо — не перевіряти.</div>
      <div class="table-wrap"><table class="list"><thead><tr><th>ID</th><th>Вид оплати в LP-CRM</th><th>Що перевіряти</th><th>У чеку має бути</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr data-pid="${esc(r.id)}"><td class="muted">${esc(r.id)}</td><td>${esc(r.name)}${r.changed ? ' <span class="badge info">змінено</span>' : ''}</td>
        <td><select data-pcls aria-label="Що перевіряти для «${esc(r.name)}»">${Object.entries(d.classes).map(([k, v]) => `<option value="${k}" ${r.cls === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
        <td><input data-pcb value="${esc(r.cb || '')}" placeholder="напр. NovaPay" aria-label="Спосіб оплати в чеку для «${esc(r.name)}»"></td></tr>`).join('')}
      </tbody></table></div>`;
    $('#payKeep').onclick = async () => {
      const rows = $$('[data-pid]').map((tr) => ({ id: tr.dataset.pid, name: d.rows.find((x) => x.id === tr.dataset.pid)?.name, cls: $('[data-pcls]', tr).value, cb: $('[data-pcb]', tr).value }));
      try { await api('PUT', '/api/checks/pay', { rows }); toast('Збережено'); viewPay(); } catch (e) { toast(e.message, true); }
    };
  }

  // «Оновити зараз»: збір іде частинами — повторюємо, доки не завершиться.
  async function refresh(view, hash, btnSel = '#chkRefresh') {
    if (refreshing) return;
    refreshing = true;
    const label = (t) => { const b = $(btnSel); if (b) { b.disabled = true; b.innerHTML = `<span class="spinner"></span> ${t}`; } };
    try {
      const t0 = Date.now();
      let r;
      for (let i = 0; Date.now() - t0 < 5 * 60e3; i++) {
        label(i ? `Оновлюю… крок ${i + 1}` : 'Оновлюю…');
        r = await api('POST', '/api/checks/refresh', {});
        if (r.skipped) { toast(r.skipped, true); break; }
        if (r.busy) { label('Оновлення вже йде…'); await new Promise((ok) => setTimeout(ok, 4000)); continue; }
        if (!r.more) break;
      }
      if (r && !r.more && !r.skipped) toast('Дані оновлено');
      else if (r?.more) toast('Збір ще триває у фоні — дані з’являться трохи згодом');
    } catch (e) { toast(e.message, true); }
    refreshing = false;
    if (location.hash.startsWith(hash)) view();
  }

  return { viewChecks, viewReceipts, viewPay };
}
