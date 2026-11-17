// «Перевірка»: автоматична звірка відправлених замовлень LP-CRM — вид оплати ↔ наложка в ТТН, чек Checkbox (сума, спосіб
// оплати, ФОП), оплата на рахунок ↔ ФОП чека, можливі дублі. Окрема вкладка «Чеки за день» — замість зошита: кожен чек ФОП
// з замовленням, до якого його зіставлено. «Налаштування» — що очікувати для кожного виду оплати LP-CRM.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, fmtDateTime, todayKyiv, modal, confirmDanger } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { fpLayout, wireFp, fpGroup, fpBtn, fpKpi } from './b2b-shared.js';

const LEVELS = [
  ['problems', 'Усі проблеми', 'помилки й увага'], ['bad', 'Помилки', 'треба виправити'], ['warn', 'Увага', 'варто глянути'],
  ['wait', 'Очікує', 'ТТН ще не перевірено'], ['ok', 'Гаразд', ''], ['skip', 'Не перевіряємо', 'обмін, повернення тощо'], ['all', 'Усі', ''],
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
  // Етапи перевірки замовлення — по порядку, як їх проходить людина.
  const STAGES = [['mp', 'Маркетплейс'], ['pay', 'Вид оплати'], ['ttn', 'ТТН і наложка'], ['comment', 'Коментар'], ['fact', 'Оплата по факту'], ['receipt', 'Чек'], ['dup', 'Дублі']];
  const ORDER = ['bad', 'warn', 'wait', 'info', 'ok', 'skip'];
  const worst = (list) => list.reduce((lv, it) => (ORDER.indexOf(it.level) < ORDER.indexOf(lv) ? it.level : lv), 'skip');
  const stageOf = (r, g) => r.items.filter((i) => (i.group || 'pay') === g);
  // Смужка етапів у рядку: кожен етап — значок за найгіршим результатом; етапів без даних немає.
  const strip = (r) => `<div class="chk-strip">${STAGES.map(([g, label]) => { const its = stageOf(r, g); if (!its.length) return ''; const lv = worst(its);
    return `<span class="chk-st chk-st-${esc(lv)}" title="${esc(`${label}: ${its.map((i) => i.text).join(' · ')}`)}"><span class="chk-ic" aria-hidden="true">${ICON[lv] || ''}</span>${esc(label)}</span>`; }).join('')}</div>`;
  // Повна картка перевірки замовлення (розгортається кліком по рядку).
  const card = (r) => `<div class="chk-card">${STAGES.map(([g, label]) => { const its = stageOf(r, g); if (!its.length) return '';
    return `<div class="chk-stage"><div class="chk-stage-h chk-${esc(worst(its))}"><span class="chk-ic" aria-hidden="true">${ICON[worst(its)] || ''}</span>${esc(label)}</div>
      <ul class="chk-items">${its.map((i) => `<li class="chk-${esc(i.level)}"><span class="chk-ic" aria-hidden="true">${ICON[i.level] || ''}</span><span>${esc(i.text)}</span></li>`).join('')}</ul></div>`; }).join('')}
    ${r.comment ? `<div class="chk-stage"><div class="chk-stage-h">Повний коментар</div><div class="small chk-com-full">${esc(r.comment)}</div></div>` : ''}</div>`;
  // Рішення людини: ✓ «усе добре», ! «надіслати в групу «Маркетплейс»», ✕ «не зважати».
  const actions = (r) => (r.check_level === 'bad' || r.check_level === 'warn' || r.mark?.mark) ? `<span class="chk-acts">
    <button type="button" class="btn sm icon chk-act-ok" data-cmark="ok" data-code="${esc(r.code)}" title="Усе добре — підтвердити" aria-label="Усе добре — підтвердити замовлення № ${esc(r.id)}">✓</button>
    <button type="button" class="btn sm icon chk-act-send" data-csend="${esc(r.code)}" title="Надіслати в групу «Маркетплейс» у Telegram" aria-label="Надіслати замовлення № ${esc(r.id)} в групу «Маркетплейс»">!</button>
    <button type="button" class="btn sm icon chk-act-skip" data-cmark="skip" data-code="${esc(r.code)}" title="Не зважати на помилку" aria-label="Не зважати на помилки замовлення № ${esc(r.id)}">✕</button></span>` : '';
  const when = (iso) => (iso ? fmtDateTime(iso) : '');
  const markLine = (r) => {
    const m = r.mark || {};
    const parts = [];
    if (m.mark === 'ok') parts.push(`<span class="chk-ok">✓ Підтверджено: ${esc(m.who || '')} · ${esc(when(m.at))}</span>`);
    if (m.mark === 'skip') parts.push(`<span class="muted">✕ Не зважати: ${esc(m.who || '')} · ${esc(when(m.at))}</span>`);
    if (m.sent_at) parts.push(`<span class="chk-warn">! Надіслано в групу: ${esc(m.sent_by || '')} · ${esc(when(m.sent_at))}</span>`);
    if (!parts.length) return '';
    return `<div class="small chk-mark">${parts.join(' · ')}${m.mark ? ` <button type="button" class="btn sm link" data-cmark="" data-code="${esc(r.code)}">Скасувати</button>` : ''}</div>`;
  };
  const open = new Set();
  const row = (r) => `<tr class="chk-row chk-row-${esc(r.level)}" data-code="${esc(r.code)}" tabindex="0" aria-expanded="${open.has(r.code)}">
    <td class="nowrap"><b>№ ${esc(r.id || r.code)}</b><div class="small muted">${dmy(r.day)} · ${esc(r.status)}</div><div class="small muted">${esc(r.user || '')}</div></td>
    <td>${esc(r.buyer || '—')}${r.phone ? `<div class="small muted">${phoneFmt(r.phone)}</div>` : ''}<div class="small muted">${esc(r.channel || r.office || '')}</div></td>
    <td class="nowrap"><b>${uah(r.total)}</b><div class="small">${esc(r.payment)}</div>${r.ttn ? `<div class="small muted">${esc(r.carrier)} · ${esc(r.ttn)}</div>` : ''}</td>
    <td><div class="chk-head"><span class="badge ${LV[r.level]?.[0] || ''}">${LV[r.level]?.[1] || ''}</span>${actions(r)}</div>${strip(r)}
      ${markLine(r)}
      ${r.mark?.mark ? '' : r.items.filter((i) => i.level === 'bad' || i.level === 'warn').slice(0, 2).map((i) => `<div class="small chk-${esc(i.level)}">${esc(i.text)}</div>`).join('')}</td>
  </tr>${open.has(r.code) ? `<tr class="chk-detail"><td colspan="4">${card(r)}</td></tr>` : ''}`;

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
      ${(d.cb_failed || []).length ? `<div class="alert warn small" style="margin-bottom:10px">Checkbox не пускає (чеки цих ФОП не звіряємо, повторимо через кілька годин): ${d.cb_failed.map(esc).join('; ')}. Перевірте логін і пароль каси в <a href="#/chkpay">«Перевірка → Налаштування»</a>.</div>` : ''}
      ${(d.no_checkbox || []).length ? `<div class="alert warn small" style="margin-bottom:10px">Каси без пароля (чеки їхніх відділів не звіряємо): ${d.no_checkbox.map(esc).join(', ')}. Пароль касира вноситься в <a href="#/chkpay">«Перевірка → Налаштування»</a>.</div>` : ''}
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
      ${rows.length ? `<div class="table-wrap"><table class="list chk"><thead><tr><th>Замовлення</th><th>Покупець</th><th>Сума, оплата, ТТН</th><th>Перевірка (клік по рядку — усі етапи)</th></tr></thead><tbody>
        ${rows.slice(0, 500).map(row).join('')}</tbody></table></div>${rows.length > 500 ? `<div class="small muted">Показано 500 з ${rows.length} — звузьте фільтр.</div>` : ''}`
        : `<div class="card empty"><div class="big">${d.rows.length ? 'Нічого не знайдено' : 'Ще немає даних'}</div>${d.rows.length ? (f.lv === 'problems' ? 'Проблем не знайдено 🎉' : 'Змініть фільтр або пошук.') : 'Натисніть «Оновити зараз» — перший збір займає кілька хвилин.'}</div>`}`,
      { summary: LEVELS.find(([k]) => k === f.lv)?.[1] || '' })}`;
    wireFp();
    $$('[data-cmark]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      try { await api('PUT', `/api/checks/orders/${encodeURIComponent(b.dataset.code)}/mark`, { mark: b.dataset.cmark }); toast(b.dataset.cmark === 'ok' ? 'Підтверджено' : b.dataset.cmark === 'skip' ? 'Не зважаємо' : 'Рішення скасовано'); viewChecks(); } catch (err) { toast(err.message, true); }
    }));
    $$('[data-csend]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      b.disabled = true;
      try { await api('POST', `/api/checks/orders/${encodeURIComponent(b.dataset.csend)}/send`, {}); toast('Надіслано в групу «Маркетплейс»'); viewChecks(); } catch (err) { toast(err.message, true); b.disabled = false; }
    }));
    const toggle = (tr) => { const c = tr.dataset.code; if (open.has(c)) open.delete(c); else open.add(c); viewChecks(); };
    $$('tr.chk-row').forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('a,button,input,select')) toggle(tr); }; tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(tr); } }; });
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
  // Каси Checkbox — як у модулі Checkbox LP-CRM: з них програма читає чеки; «правильна каса» — за відділом замовлення.
  const cashState = (k) => k.error ? `<span class="badge bad">Не пускає</span> <span class="small">${esc(k.error)}</span>`
    : k.org_title ? `<span class="badge ok">Працює</span> <span class="small">${esc(k.org_title)}${k.org_code ? ` · ${esc(k.org_code)}` : ''}</span>`
    : k.ready ? '<span class="badge info">Не перевірено</span>' : '<span class="small muted">Внесіть пароль касира</span>';
  function cashiersHtml(list) {
    return `<div class="head-row"><h3>Каси Checkbox</h3><div class="btn-row"><button class="btn" id="cashAdd">+ Додати касу</button></div></div>
      <div class="small muted" style="margin-bottom:10px">Звідси програма читає чеки. Чек кожного замовлення має бути пробитий касою його відділу — як у модулі Checkbox LP-CRM.
        На кожен ФОП / ТОВ досить однієї каси з паролем: через неї видно чеки всіх кас цієї організації.</div>
      ${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Каса</th><th>Логін</th><th>Відділи LP-CRM</th><th>Доступ</th><th>Стан</th><th></th></tr></thead><tbody>
      ${list.map((k) => `<tr class="${k.lp_active ? '' : 'chk-done'}"><td><b>${esc(k.name)}</b>${k.lp_active ? '' : '<div class="small muted">вимкнена в LP-CRM</div>'}${k.active ? '' : '<div class="small muted">не читаємо</div>'}</td>
        <td class="small">${esc(k.login || '—')}</td><td class="small">${k.offices.length ? esc(k.offices.join(', ')) : '<span class="muted">—</span>'}</td>
        <td class="small">${k.has_password ? 'пароль ✓' : k.has_license && k.has_pin ? 'ключ і PIN ✓' : '<span class="ret-bad">немає</span>'}</td>
        <td>${cashState(k)}</td>
        <td class="nowrap"><button class="btn sm" data-cedit="${k.id}">Змінити</button>${k.ready ? ` <button class="btn sm" data-ctest="${k.id}">Перевірити вхід</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="card empty">Кас ще немає. Додайте каси, як у модулі Checkbox LP-CRM.</div>'}`;
  }
  function cashierForm(k, done) {
    const m = modal(k ? `Каса: ${k.name}` : 'Нова каса Checkbox', `
      <div class="form-grid" style="display:grid;gap:10px">
        <label>Назва (ФОП / ТОВ)<input id="ckName" value="${esc(k?.name || '')}" autocomplete="off"></label>
        <label>Логін касира<input id="ckLogin" value="${esc(k?.login || '')}" autocomplete="off"></label>
        <label>Пароль касира<input id="ckPass" type="password" autocomplete="new-password" placeholder="${k?.has_password ? 'збережено — залиште порожнім, щоб не змінювати' : ''}"></label>
        <div class="small muted">Або замість логіна й пароля — ключ ліцензії каси й PIN касира:</div>
        <label>Ключ ліцензії каси<input id="ckLic" type="password" autocomplete="off" placeholder="${k?.has_license ? 'збережено — залиште порожнім, щоб не змінювати' : ''}"></label>
        <label>PIN касира<input id="ckPin" type="password" autocomplete="off" inputmode="numeric" placeholder="${k?.has_pin ? 'збережено' : ''}"></label>
        <label>Відділи LP-CRM (номери через кому)<input id="ckOff" value="${esc((k?.offices || []).join(', '))}" placeholder="напр. 13, 22" autocomplete="off"></label>
        <label class="chk-chk ret-f"><input type="checkbox" id="ckLp" ${!k || k.lp_active ? 'checked' : ''}> <span>Увімкнена в LP-CRM</span></label>
        <label class="chk-chk ret-f"><input type="checkbox" id="ckAct" ${!k || k.active ? 'checked' : ''}> <span>Читати чеки з цієї каси</span></label>
      </div>`, { footer: `${k ? '<button class="btn danger" id="ckDel">Видалити</button>' : ''}<span style="flex:1"></span><button class="btn" data-close>Скасувати</button><button class="btn primary" id="ckSave">Зберегти</button>`, focus: '#ckName' });
    $('#ckSave', m.el).onclick = async () => {
      const body = { name: $('#ckName', m.el).value, login: $('#ckLogin', m.el).value, password: $('#ckPass', m.el).value, license: $('#ckLic', m.el).value, pin: $('#ckPin', m.el).value,
        offices: $('#ckOff', m.el).value, lp_active: $('#ckLp', m.el).checked, active: $('#ckAct', m.el).checked };
      try { await api(k ? 'PUT' : 'POST', k ? `/api/checks/cashiers/${k.id}` : '/api/checks/cashiers', body); m.close(); toast('Збережено'); done(); } catch (e) { toast(e.message, true); }
    };
    if (k) $('#ckDel', m.el).onclick = async () => {
      if (!(await confirmDanger('Видалити касу?', `Каса «${esc(k.name)}» зникне зі списку; чеки з неї більше не читатимуться.`, 'Видалити'))) return;
      try { await api('DELETE', `/api/checks/cashiers/${k.id}`); m.close(); toast('Видалено'); done(); } catch (e) { toast(e.message, true); }
    };
  }

  async function viewPay() {
    const [d, cash, tgc] = await Promise.all([api('GET', '/api/checks/pay'), api('GET', '/api/checks/cashiers'), api('GET', '/api/checks/tg')]);
    main.innerHTML = `
      <div class="head-row"><h2>Налаштування перевірки</h2></div>
      <div class="card"><div class="head-row"><h3>Група в Telegram</h3><div class="btn-row">${tgc.linked ? '<button class="btn sm" id="tgUnlink">Відв\'язати</button>' : ''}<button class="btn sm" id="tgLink">${tgc.linked ? 'Підключити іншу' : 'Підключити групу'}</button></div></div>
        <div class="small">${tgc.linked ? `Підключено: <b>${esc(tgc.title || 'група')}</b>. Кнопка «!» біля замовлення надсилає його сюди.` : 'Кнопка «!» біля замовлення надсилає його в групу «Маркетплейс». Підключіть групу, щоб це працювало.'}</div>
        <div id="tgHow" class="small" style="margin-top:6px"></div></div>
      ${cashiersHtml(cash)}
      <div class="head-row" style="margin-top:20px"><h3>Види оплат</h3><div class="btn-row"><button class="btn primary" id="payKeep">Зберегти види оплат</button></div></div>
      <div class="small muted" style="margin-bottom:10px">Що очікувати для кожного виду оплати LP-CRM: <b>післяплата</b> — у ТТН має бути наложка на суму замовлення;
        <b>через сервіс</b> (RozetkaPay, Пром-оплата) і <b>на рахунок ФОП</b> — наложки бути не повинно; для «на рахунок» ще шукаємо надходження в Opendatabot.
        «У чеку має бути» — слово зі способу оплати в чеку Checkbox (як у модулі Checkbox LP-CRM); порожньо — не перевіряти.</div>
      <div class="table-wrap"><table class="list"><thead><tr><th>ID</th><th>Вид оплати в LP-CRM</th><th>Що перевіряти</th><th>У чеку має бути</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr data-pid="${esc(r.id)}"><td class="muted">${esc(r.id)}</td><td>${esc(r.name)}${r.changed ? ' <span class="badge info">змінено</span>' : ''}</td>
        <td><select data-pcls aria-label="Що перевіряти для «${esc(r.name)}»">${Object.entries(d.classes).map(([k, v]) => `<option value="${k}" ${r.cls === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
        <td><input data-pcb value="${esc(r.cb || '')}" placeholder="напр. NovaPay" aria-label="Спосіб оплати в чеку для «${esc(r.name)}»"></td></tr>`).join('')}
      </tbody></table></div>`;
    $('#tgLink').onclick = async () => {
      try {
        const r = await api('POST', '/api/checks/tg/code', {});
        $('#tgHow').innerHTML = `1) Додайте бота <b>@${esc(r.bot)}</b> у групу «Маркетплейс».<br>2) Напишіть у групі: <code>/link ${esc(r.code)}</code> (код діє 30 хв).<br>3) Оновіть цю сторінку.`;
      } catch (e) { toast(e.message, true); }
    };
    if ($('#tgUnlink')) $('#tgUnlink').onclick = async () => {
      if (!(await confirmDanger('Відв\'язати групу?', 'Кнопка «!» перестане надсилати замовлення в цю групу.', 'Відв\'язати'))) return;
      try { await api('DELETE', '/api/checks/tg'); viewPay(); } catch (e) { toast(e.message, true); }
    };
    $('#cashAdd').onclick = () => cashierForm(null, viewPay);
    $$('[data-cedit]').forEach((b) => (b.onclick = () => cashierForm(cash.find((k) => String(k.id) === b.dataset.cedit), viewPay)));
    $$('[data-ctest]').forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Перевіряю…';
      try { const k = await api('POST', `/api/checks/cashiers/${b.dataset.ctest}/test`, {}); toast(k.error ? `Checkbox: ${k.error}` : `Працює: ${k.org_title}`, Boolean(k.error)); } catch (e) { toast(e.message, true); }
      viewPay();
    }));
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
