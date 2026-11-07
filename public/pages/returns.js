// «Повернення»: посилки, що повертаються до нас, з усіх підключених джерел (поки — Нова пошта: кабінети ФОП/ТОВ,
// Розетка-постачальник, маркетплейси, LP-CRM). Інформаційний розділ: фільтри зліва, показники, таблиця; оновлення —
// фоном раз на 12 год або кнопкою «Оновити інформацію».
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, fmtDateTime } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { fpLayout, wireFp, fpGroup, fpBtn } from './b2b-shared.js';
import { icon, iconize } from '../core/icons.js';

const STATES = [
  ['active', 'Усі активні'], ['branch', 'Забрати з відділення'], ['overdue', 'Прострочено'], ['transit', 'В дорозі до нас'],
  ['nottn', 'ЕН повернення ще немає'], ['stuck', 'Застрягло (давно)'], ['got', 'Отримано'], ['all', 'Усі'],
];
const SRC = { rzs: 'Розетка — постачальник', rozetka: 'Розетка', prom: 'Prom', epc: 'Епіцентр', crm: 'Сайт / LP-CRM', np: 'Лише Нова пошта', other: 'Інше' };
const SRC_CLS = { rzs: 'ok', rozetka: 'ok', prom: 'info', epc: 'warn', crm: 'info' };
const REASON = { refused: 'Відмова клієнта', storage: 'Закінчився строк зберігання', customer: 'Повернення після отримання' };
const CAR = { np: 'Нова пошта', rd: 'Розетка Делівері', rzr: 'Заявки Розетки', mp: 'Епіцентр' };
const phoneFmt = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-9); return d.length === 9 ? `0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}` : esc(p || ''); };
const dShort = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
const daysWord = (n) => `${n} дн`;
const telHref = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-9); return d.length === 9 ? `tel:+380${d}` : ''; };

export function createReturnsPages() {
  const f = { st: 'active', src: '', to: '', reason: '', car: '', q: '', from: '', till: '' };
  let refreshing = false;
  let pickOpen = null; // «Де забрати»: розгорнуто для «Забрати» / «Прострочено», далі — як залишив користувач

  const stateOf = (r) => (r.state === 'branch' && r.overdue ? 'overdue' : r.state);
  const match = (r, st) => (st === 'all' ? true : st === 'active' ? r.state !== 'got' && r.state !== 'stuck' : st === 'branch' ? r.state === 'branch' : st === 'overdue' ? r.state === 'branch' && r.overdue : r.state === st);
  const inPeriod = (r) => (!f.from || (r.refused_at || r.created_at).slice(0, 10) >= f.from) && (!f.till || (r.refused_at || r.created_at).slice(0, 10) <= f.till);
  const hay = (r) => [r.orig_ttn, r.ret_ttn, r.ext_id, r.customer, r.phone, r.to, r.cargo, ...r.orders.map((o) => o.no)].join(' ').toLowerCase();

  // Стан і скільки чекає: у відділенні — від прибуття (5+ дн — червоним), в дорозі — від створення ЕН повернення.
  function waitCell(r) {
    const stuck = (what) => `<span class="badge bad">Застрягло</span><div><b>${esc(what)} з ${dShort(r.refused_at)}.${(r.refused_at || '').slice(0, 4)}</b></div>
      <div class="small muted">${esc(r.ret_status || '')} · понад 60 дн без руху — уточніть у підтримці Розетки</div>`;
    if (r.carrier === 'rd') {
      // ROZETKA Delivery: стан посилки з модуля доставки Розетки.
      if (r.state === 'got') return `<span class="badge ok">Повернено продавцю</span><div style="color:var(--ok)"><b>отримано${r.wait_days !== null ? ` за ${daysWord(r.wait_days)}` : ''}</b></div><div class="small muted">${esc(fmtDateTime(r.got_at))}</div>`;
      if (r.state === 'stuck') return stuck(r.ret_code === 50020 ? 'у точці видачі' : 'без руху');
      if (r.state === 'branch') {
        const res = /резерв/.test(r.note || '');
        return `<span class="badge ${r.overdue ? 'bad' : 'warn'}">${res ? 'Закінчується резерв' : r.overdue ? 'Прострочено' : 'Забрати з точки видачі'}</span>
          <div style="font-weight:700;color:var(${r.overdue ? '--bad' : '--warn'})">${daysWord(r.branch_days ?? 0)} у точці видачі</div><div class="small muted">${esc(r.ret_status || '')}</div>`;
      }
      if (r.state === 'transit') return `<span class="badge info">В дорозі до нас</span><div><b>${daysWord(r.wait_days ?? 0)} в дорозі</b></div><div class="small muted">${esc(r.ret_status || '')}</div>`;
      return `<span class="badge">Повернення ще не оформлене</span><div><b>${daysWord(r.wait_days ?? 0)} з відмови</b></div><div class="small muted">${esc(r.ret_status || '')}</div>`;
    }
    if (r.carrier === 'rzr') {
      // Заявка покупця на повернення (посилка не Новою поштою або ТТН ще не вказана).
      if (r.state === 'got') return `<span class="badge ok">Отримано від клієнта</span><div class="small muted">${esc(r.ret_status || '')}${r.got_at ? ` · ${esc(fmtDateTime(r.got_at))}` : ''}</div>`;
      if (r.state === 'stuck') return stuck('заявка');
      if (r.state === 'transit') return `<span class="badge info">В дорозі до нас</span><div><b>${daysWord(r.wait_days ?? 0)} з заявки</b></div><div class="small muted">${esc(r.ret_status || '')}</div>`;
      return `<span class="badge">Клієнт ще не відправив</span><div><b>${daysWord(r.wait_days ?? 0)} з заявки</b></div><div class="small muted">${esc(r.ret_status || '')}</div>`;
    }
    if (r.carrier !== 'np') {
      // Розетка Делівері / маркетплейс: про прибуття посилки назад не повідомляють — показуємо статус замовлення й скільки минуло.
      if (r.state === 'got') return `<span class="badge ok">Ймовірно повернулось</span><div class="small muted">минуло понад ${r.mp_close_days || 21} дн після «${esc(r.ret_status)}»</div>`;
      return `<span class="badge info">${r.reason === 'customer' ? 'Клієнт повертає' : 'Повертається до нас'}</span><div><b>${daysWord(r.wait_days ?? 0)} з ${r.reason === 'customer' ? 'запиту' : 'відмови'}</b></div>
        <div class="small muted">${esc(r.ret_status)} · ${esc(CAR[r.carrier])} не повідомляє про прибуття — перевірте в кабінеті</div>`;
    }
    if (r.state === 'got') return `<span class="badge ok">Отримано</span><div style="color:var(--ok)"><b>отримано${r.wait_days !== null ? ` за ${daysWord(r.wait_days)}` : ''}</b></div><div class="small muted">${esc(fmtDateTime(r.got_at))}</div>`;
    if (r.state === 'branch') {
      const paid = r.paid_from && r.paid_from.slice(0, 10) <= new Date().toISOString().slice(0, 10);
      return `<span class="badge ${r.overdue || paid ? 'bad' : 'warn'}">${paid ? 'Платне зберігання' : r.overdue ? 'Прострочено' : 'Забрати з відділення'}</span>
        <div style="font-weight:700;color:var(${r.overdue ? '--bad' : '--warn'})">${daysWord(r.branch_days ?? 0)} у відділенні</div>
        <div class="small muted">${r.paid_from ? `${paid ? 'платно' : 'платно з'} ${paid ? `з ${dShort(r.paid_from)}` : dShort(r.paid_from)}${r.storage ? ` · ${money(r.storage)} ₴` : ''}` : ''}</div>`;
    }
    if (r.state === 'transit') return `<span class="badge info">В дорозі до нас</span><div><b>${daysWord(r.wait_days ?? 0)} в дорозі</b></div><div class="small muted">${esc(r.ret_status || '')}</div>`;
    if (r.reason === 'customer') return `<span class="badge">ЕН повернення ще немає</span><div><b>${daysWord(r.wait_days ?? 0)} з запиту</b></div><div class="small muted">${esc(r.ret_status || 'клієнт повертає')} · шукаємо посилку серед вхідних</div>`;
    return `<span class="badge">ЕН повернення ще немає</span><div><b>${daysWord(r.wait_days ?? 0)} з відмови</b></div><div class="small muted">НП ще не створила зворотну</div>`;
  }
  // Кнопка «копіювати» біля значення (ТТН, № замовлення, прізвище, телефон) — одним кліком.
  const cp = (v, what) => (v ? `<button type="button" class="ret-cp" data-cp="${esc(v)}" data-cpw="${esc(what)}" title="Копіювати ${esc(what)}" aria-label="Копіювати ${esc(what)}">${icon('copy')}</button>` : '');
  const phone0 = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-9); return d.length === 9 ? `0${d}` : ''; };
  const surname = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const ttnCell = (main, sub1, sub2) => `${main ? `<span class="ret-v"><b class="ret-ttn">${esc(main)}</b>${cp(main, 'ТТН')}</span>` : '<span class="muted">—</span>'}<div class="small muted">${sub1}</div>${sub2 ? `<div class="small muted ret-v">${sub2}</div>` : ''}`;
  const row = (r) => `<tr class="${r.reason === 'customer' ? 'ret-cust' : ''}">
    <td class="nowrap">${r.reason === 'customer' ? '<div><span class="badge ret-cust-b">↩ Від клієнта</span></div>' : ''}${r.carrier === 'np'
      ? ttnCell(r.ret_ttn, 'Нова пошта', `з ${esc(r.orig_ttn)}${cp(r.orig_ttn, 'ТТН відправлення')}`)
      : r.carrier === 'rd' && r.ret_ttn ? ttnCell(r.ret_ttn, 'Розетка Делівері · Міст', `з ${esc(r.orig_ttn)}${cp(r.orig_ttn, 'ТТН відправлення')}`)
      : r.carrier === 'rzr' ? ttnCell(r.ret_ttn, 'Заявка Розетки', esc(r.ext_id || ''))
      : ttnCell(r.orig_ttn.includes(':') ? '' : r.orig_ttn, esc(CAR[r.carrier]), 'ТТН відправлення')}</td>
    <td>${r.orders.length ? r.orders.map((o) => `<div class="ret-v"><span class="badge ${SRC_CLS[o.src] || ''}">${esc(o.label)}</span> <span class="small">${esc(o.no)}</span>${cp(o.no, `№ замовлення ${o.label}`)}</div>`).join('') : `<span class="small muted">${r.account ? `кабінет НП «${esc(r.account)}»` : '—'}</span>`}</td>
    <td>${r.customer ? `<div class="ret-v"><span class="ret-t">${esc(r.customer)}</span>${cp(surname(r.customer), 'прізвище')}</div>` : '—'}${r.phone ? `<div class="small muted ret-v"><span class="ret-nw">${phoneFmt(r.phone)}</span>${cp(phone0(r.phone), 'телефон')}</div>` : ''}</td>
    <td>${r.to ? `<b>${esc(r.to)}</b>` : '<span class="muted">—</span>'}${r.to_name && r.to_name !== r.to ? `<div class="small">${esc(r.to_name)}</div>` : ''}${r.to_phone ? `<div class="small muted">${phoneFmt(r.to_phone)}</div>` : ''}${r.warehouse ? `<div class="small muted">${esc([r.city, r.warehouse].filter(Boolean).join(', '))}</div>` : ''}</td>
    <td class="small">${esc(r.cargo || '—')}${r.cost ? `<div class="muted">${money(r.cost)} ₴${r.cod ? ` · післяплата ${money(r.cod)} ₴` : ''}</div>` : ''}</td>
    <td class="small">${esc(REASON[r.reason] || r.reason || '—')}${(() => { const t = r.carrier === 'rzr' ? r.note.split(' · ')[0] : (r.note || '').split(' · ').filter((x) => !x.startsWith('графік')).join(' · '); return t ? `<div class="muted">${esc(t)}</div>` : ''; })()}</td>
    <td style="min-width:170px">${waitCell(r)}</td>
  </tr>`;

  // Стани зліва (з підписом-підказкою), служби доставки — вкладками зверху.
  const ST_HINT = { active: 'усе, що ще не у нас', branch: 'у відділенні / точці видачі', overdue: '5+ днів або закінчується резерв', transit: 'їде назад', nottn: 'відмова є, зворотну ще не створили', stuck: 'понад 60 дн без руху', got: 'вже у нас', all: '' };
  async function viewReturns() {
    const d = await api('GET', '/api/returns');
    const all = d.rows;
    all.forEach((r) => { r.mp_close_days = d.mp_close_days; });
    const base = all.filter(inPeriod).filter((r) => !f.q || hay(r).includes(f.q.toLowerCase()));
    const ok = (r, skip) => (skip === 'st' || match(r, f.st)) && (skip === 'car' || !f.car || r.carrier === f.car) && (skip === 'src' || !f.src || r.src === f.src)
      && (skip === 'to' || !f.to || r.to === f.to) && (skip === 'reason' || !f.reason || r.reason === f.reason);
    const PRI = { branch: 0, transit: 1, nottn: 2, stuck: 3, got: 4 };
    const rows = base.filter((r) => ok(r, '')).sort((a, b) => PRI[a.state] - PRI[b.state] || (a.state === 'got' ? String(b.got_at).localeCompare(String(a.got_at)) : (b.branch_days ?? b.wait_days ?? 0) - (a.branch_days ?? a.wait_days ?? 0)));
    const cnt = (list, key) => list.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m; }, {});
    const forSt = base.filter((r) => ok(r, 'st'));
    const stN = Object.fromEntries(STATES.map(([k]) => [k, forSt.filter((r) => match(r, k)).length]));
    // Вкладки служб доставки — верхній рівень: їх не змінюють ні стани зліва, ні фільтри над таблицею (кількість — активні повернення служби).
    const carN = cnt(all.filter((r) => r.state !== 'got' && r.state !== 'stuck'), 'carrier');
    const carHas = new Set(all.map((r) => r.carrier));
    const srcN = cnt(base.filter((r) => ok(r, 'src')), 'src');
    const toN = cnt(base.filter((r) => ok(r, 'to')), 'to');
    const reN = cnt(base.filter((r) => ok(r, 'reason')), 'reason');
    const carAll = Object.values(carN).reduce((s, n) => s + n, 0);
    const tabTitle = 'активних повернень (без отриманих і застряглих)';
    const opt = (map, val, names) => Object.keys(map).filter(Boolean).sort((a, b) => String(names?.[a] || a).localeCompare(String(names?.[b] || b), 'uk'))
      .map((k) => `<option value="${esc(k)}" ${val === k ? 'selected' : ''}>${esc(names?.[k] || k)} (${map[k]})</option>`).join('');
    // Щоб забрати — компактно, лише для обраної служби (НП — кабінети, Розетка Делівері — точки видачі).
    const showPick = ['active', 'branch', 'overdue'].includes(f.st);
    const pickNp = showPick && (!f.car || f.car === 'np') ? (d.pickup || []).filter((p) => (f.to ? p.name === f.to : p.branch)) : [];
    const pickRd = showPick && (!f.car || f.car === 'rd') ? (d.pickup_rd || []).filter((p) => !f.to || p.shop === f.to) : [];
    const pickHtml = pickNp.length || pickRd.length ? `<details class="card ret-picks" ${(pickOpen ?? ['branch', 'overdue'].includes(f.st)) ? 'open' : ''}><summary><b>Де забрати</b> <span class="small muted">${[...pickNp.map((p) => p.branch), ...pickRd.map((p) => p.n)].reduce((s, n) => s + n, 0)} посилок · ${pickNp.length + pickRd.length} ${pickNp.length + pickRd.length === 1 ? 'місце' : 'місць'}</span></summary><div class="ret-picks-grid">
        ${pickNp.map((p) => `<div class="ret-pick"><div><span class="badge">Нова пошта</span> <b>${esc(p.name)}</b></div>${p.code ? `<div class="small muted">ЄДРПОУ / ІПН: <b>${esc(p.code)}</b></div>` : ''}
          ${p.persons.slice(0, 2).map((x) => `<div class="small">${esc(x.name || '')}${x.phone ? ` · <a href="${telHref(x.phone)}">${phoneFmt(x.phone)}</a>` : ''}</div>`).join('')}
          <div class="small"><b>Чекає: ${p.branch}</b>${p.warehouses[0] ? ` · ${esc(p.warehouses.map((w) => `${w.w}${w.n > 1 ? ` — ${w.n}` : ''}`).join('; '))}` : ''}</div></div>`).join('')}
        ${pickRd.map((p) => `<div class="ret-pick"><div><span class="badge">Розетка Делівері</span> <b>${esc(p.address || '—')}</b></div><div class="small">${esc(p.shop)} · на ${esc(p.name || '—')}${p.phone ? ` · <a href="${telHref(p.phone)}">${phoneFmt(p.phone)}</a>` : ''}</div>
          <div class="small"><b>Чекає: ${p.n}</b>${p.oldest ? ` · найдовше ${p.oldest} дн` : ''}${p.schedule ? ` · графік ${esc(p.schedule)}` : ''}${p.reserve ? ` · <span style="color:var(--bad)">резерв закінчується: ${p.reserve}</span>` : ''}</div></div>`).join('')}
      </div></details>` : '';
    const cy = d.cycle || {};
    const next = cy.finished ? new Date(Date.parse(cy.started) + d.cycle_hours * 3600e3).toISOString() : '';
    const sum = rows.filter((r) => r.state !== 'got' && r.state !== 'stuck').reduce((s, r) => s + (r.cost || 0), 0);
    const tab = (k, label, n) => `<button type="button" class="ret-tab ${f.car === k ? 'on' : ''}" data-rcar="${k}" title="${n || 0} ${tabTitle}">${esc(label)} <span class="ret-tab-n">${n || 0}</span></button>`;
    main.innerHTML = `
      <div class="head-row"><h2>Повернення</h2><div class="btn-row">
        <button class="btn" id="retRefresh">🔄 Оновити інформацію</button>
        <button class="btn" id="retCopy">Копіювати всі ТТН (${rows.filter((r) => r.ret_ttn || (r.carrier !== 'np' && !r.orig_ttn.includes(':'))).length})</button>
        <button class="btn" id="retXls">⬇ Excel</button></div></div>
      <div class="small muted" style="margin-bottom:10px">Нова пошта: ${!cy.started ? 'ще не перевіряли' : !cy.done ? `перевірка триває${cy.pause_until && Date.parse(cy.pause_until) > Date.now() ? ` (Нова пошта просить зачекати до ${esc(fmtDateTime(cy.pause_until).slice(-5))})` : '…'}` : `перевірено ${esc(fmtDateTime(cy.finished))}${next ? ` · наступна перевірка ≈ ${esc(fmtDateTime(next))}` : ''}`}
        · кабінетів НП: ${d.accounts.length} · Розетка — модуль ROZETKA Delivery і заявки на повернення · Епіцентр — зі статусів замовлень</div>
      ${(d.rz_errors || []).length ? `<div class="alert warn small" style="margin-bottom:10px">Розетка: ${d.rz_errors.map((e) => `${esc(e.shop)} — ${esc(e.error)}`).join('; ')}. Дані цих магазинів можуть бути неповні.</div>` : ''}
      ${cy.error ? `<div class="alert warn small" style="margin-bottom:10px">Остання перевірка не вдалася: ${esc(cy.error)}. Натисніть «Оновити інформацію».</div>` : ''}
      ${!d.accounts.length ? '<div class="alert warn" style="margin-bottom:10px">Кабінети Нової пошти ще не додано: «Налаштування → Доставка: НП, Розетка, Prom, Епіцентр».</div>' : ''}
      <div class="ret-tabs" role="tablist" aria-label="Служба доставки">${tab('', 'Усі', carAll)}${Object.keys(CAR).filter((k) => carHas.has(k) || f.car === k).map((k) => tab(k, CAR[k], carN[k])).join('')}</div>
      ${fpLayout(fpGroup('Стан', STATES.map(([k, v]) => fpBtn(`<span class="ret-st"><span>${esc(v)}</span>${ST_HINT[k] ? `<span class="small muted">${esc(ST_HINT[k])}</span>` : ''}</span><b class="small ${k === 'overdue' && stN[k] ? 'ret-bad' : ''}">${stN[k] || ''}</b>`, f.st === k, `data-rst="${k}"`)).join('')),
      `<div class="card ret-bar">
        <label class="ret-f ret-q"><span>Пошук</span><input id="retQ" type="search" placeholder="ТТН, № замовлення, прізвище, телефон" value="${esc(f.q)}"></label>
        <label class="ret-f"><span>Звідки замовлення</span><select id="retSrc"><option value="">Усі</option>${opt(srcN, f.src, SRC)}</select></label>
        <label class="ret-f"><span>На кого / магазин</span><select id="retTo"><option value="">Усі</option>${opt(toN, f.to)}</select></label>
        <label class="ret-f"><span>Причина</span><select id="retRe"><option value="">Усі</option>${opt(reN, f.reason, REASON)}</select></label>
        <label class="ret-f"><span>Відмова з</span><input id="retFrom" type="date" value="${esc(f.from)}"></label>
        <label class="ret-f"><span>по</span><input id="retTill" type="date" value="${esc(f.till)}"></label>
        ${f.q || f.src || f.to || f.reason || f.from || f.till ? '<button type="button" class="btn sm" id="retReset">Скинути</button>' : ''}
      </div>
      ${pickHtml}
      <div class="small muted">${rows.length} посилок${sum ? ` · товару в поверненнях на ${money(sum).replace(/,00$/, '')} ₴` : ''} · <span class="ret-cp-hint">${icon('copy')}</span> — копіювати значення одним кліком</div>
      ${rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Повернення</th><th>Звідки</th><th>Клієнт</th><th>На кого</th><th>Товар</th><th>Причина</th><th>Стан і очікування</th></tr></thead><tbody>
        ${rows.slice(0, 500).map(row).join('')}</tbody></table></div>${rows.length > 500 ? `<div class="small muted">Показано 500 з ${rows.length} — звузьте фільтр.</div>` : ''}`
        : `<div class="card empty"><div class="big">Повернень немає</div>${all.length ? 'Змініть фільтр або пошук.' : 'Щойно Нова пошта зафіксує відмову чи повернення в підключених кабінетах, вони з’являться тут.'}</div>`}`,
      { summary: [STATES.find(([k]) => k === f.st)?.[1], CAR[f.car]].filter(Boolean).join(' · ') })}`;
    wireFp();
    iconize(main);
    $$('[data-rst]').forEach((b) => (b.onclick = () => { f.st = b.dataset.rst; pickOpen = null; viewReturns(); }));
    // Інша служба — отримувач/магазин з попередньої не підходить, скидаємо його.
    $$('[data-rcar]').forEach((b) => (b.onclick = () => { if (f.car !== b.dataset.rcar) f.to = ''; f.car = b.dataset.rcar; viewReturns(); }));
    $('#retSrc').onchange = (e) => { f.src = e.target.value; viewReturns(); };
    $('#retTo').onchange = (e) => { f.to = e.target.value; viewReturns(); };
    $('#retRe').onchange = (e) => { f.reason = e.target.value; viewReturns(); };
    $('#retFrom').onchange = (e) => { f.from = e.target.value; viewReturns(); };
    $('#retTill').onchange = (e) => { f.till = e.target.value; viewReturns(); };
    $('#retReset') && ($('#retReset').onclick = () => { Object.assign(f, { q: '', src: '', to: '', reason: '', from: '', till: '' }); viewReturns(); });
    $('.ret-picks') && ($('.ret-picks').ontoggle = (e) => { pickOpen = e.target.open; });
    $$('[data-cp]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      try { await navigator.clipboard.writeText(b.dataset.cp); toast(`Скопійовано ${b.dataset.cpw}: ${b.dataset.cp}`); b.classList.add('done'); setTimeout(() => b.classList.remove('done'), 1200); }
      catch { toast('Не вдалося скопіювати', true); }
    }));
    let qt;
    $('#retQ').oninput = (e) => { clearTimeout(qt); qt = setTimeout(async () => { f.q = e.target.value.trim(); await viewReturns(); const el = $('#retQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 300); };
    $('#retCopy').onclick = async () => {
      const list = rows.map((r) => r.ret_ttn || (r.carrier !== 'np' && !r.orig_ttn.includes(':') ? r.orig_ttn : '')).filter(Boolean);
      try { await navigator.clipboard.writeText(list.join('\n')); toast(`Скопійовано ТТН: ${list.length}`); } catch { toast('Не вдалося скопіювати — скористайтесь Excel', true); }
    };
    $('#retXls').onclick = () => {
      const cols = [{ title: 'ТТН повернення', width: 17 }, { title: 'Початкова ТТН', width: 17 }, { title: 'Звідки', width: 30 }, { title: 'Клієнт', width: 24 }, { title: 'Телефон клієнта', width: 15 },
        { title: 'На кого', width: 22 }, { title: 'Куди', width: 34 }, { title: 'Товар', width: 30 }, { title: 'Вартість', width: 11, fmt: 'money' }, { title: 'Причина', width: 22 },
        { title: 'Стан', width: 20 }, { title: 'Днів у відділенні', width: 10 }, { title: 'Платне зберігання з', width: 14 }, { title: 'Отримано', width: 16 }, { title: 'Примітка', width: 34 }];
      const stName = { branch: 'У відділенні', transit: 'В дорозі', nottn: 'ЕН ще немає', stuck: 'Застрягло', got: 'Отримано' };
      downloadXlsx(`povernennya-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Повернення', cols, rows: rows.map((r) => [r.ret_ttn || (r.carrier !== 'np' && !r.orig_ttn.includes(':') ? `${CAR[r.carrier]}: ${r.orig_ttn}` : ''), r.orig_ttn, r.orders.map((o) => `${o.label} ${o.no}`).join('; '), r.customer, r.phone ? `0${r.phone.slice(-9)}` : '',
        r.to, [r.city, r.warehouse].filter(Boolean).join(', '), r.cargo, r.cost || '', REASON[r.reason] || r.reason, stName[r.state] || r.state, r.state === 'branch' ? r.branch_days : '', r.paid_from ? dShort(r.paid_from) : '', r.got_at ? fmtDateTime(r.got_at) : '', [r.ret_status, r.note].filter(Boolean).join(' · ')]) }]);
    };
    $('#retRefresh').onclick = () => refresh();
    if (refreshing) { const b = $('#retRefresh'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Оновлюю…'; }
  }

  // Ручне оновлення: перевірка йде частинами — повторюємо, доки не завершиться (зазвичай кілька секунд; перший раз для нового кабінету — довше).
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    const label = (t) => { const b = $('#retRefresh'); if (b) { b.disabled = true; b.innerHTML = `<span class="spinner"></span> ${t}`; } };
    try {
      let st;
      const t0 = Date.now();
      for (let i = 0; Date.now() - t0 < 6 * 60e3; i++) {
        label(i ? `Оновлюю… крок ${i + 1}` : 'Оновлюю…');
        st = await api('POST', '/api/returns/refresh', { start: i === 0 });
        if (st.skipped) { toast(st.skipped, true); break; }
        if (st.done) break;
        // Нова пошта просить зачекати або крок уже йде у фоні — трохи чекаємо і продовжуємо.
        if (st.wait) { toast(`Нова пошта просить зачекати — перевірка продовжиться у фоні${st.pause_until ? ` після ${fmtDateTime(st.pause_until).slice(-5)}` : ''}`); break; }
        if (st.busy) { label('Перевірка вже йде…'); await new Promise((r) => setTimeout(r, 4000)); }
      }
      if (st && !st.done && !st.skipped && !st.wait) toast('Перевірка ще триває у фоні — дані з’являться трохи згодом');
      else if (st?.done) toast('Інформацію оновлено');
    } catch (e) { toast(e.message, true); }
    refreshing = false;
    if (location.hash.startsWith('#/returns')) viewReturns();
  }

  return { viewReturns };
}
