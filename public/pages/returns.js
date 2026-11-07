// «Повернення»: посилки, що повертаються до нас, з усіх підключених джерел (поки — Нова пошта: кабінети ФОП/ТОВ,
// Розетка-постачальник, маркетплейси, LP-CRM). Інформаційний розділ: фільтри зліва, показники, таблиця; оновлення —
// фоном раз на 12 год або кнопкою «Оновити інформацію».
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, fmtDateTime } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { fpLayout, wireFp, fpGroup, fpBtn, fpKpi } from './b2b-shared.js';

const STATES = [
  ['active', 'Усі активні'], ['branch', 'Забрати з відділення'], ['overdue', 'Прострочено'], ['transit', 'В дорозі до нас'],
  ['nottn', 'ЕН повернення ще немає'], ['got', 'Отримано'], ['all', 'Усі'],
];
const SRC = { rzs: 'Розетка — постачальник', rozetka: 'Розетка', prom: 'Prom', epc: 'Епіцентр', crm: 'Сайт / LP-CRM', np: 'Лише Нова пошта', other: 'Інше' };
const SRC_CLS = { rzs: 'ok', rozetka: 'ok', prom: 'info', epc: 'warn', crm: 'info' };
const REASON = { refused: 'Відмова клієнта', storage: 'Закінчився строк зберігання', customer: 'Повернення після отримання' };
const CAR = { np: 'Нова пошта', rd: 'Розетка Делівері', mp: 'Маркетплейс' };
const phoneFmt = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-9); return d.length === 9 ? `0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}` : esc(p || ''); };
const dShort = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
const daysWord = (n) => `${n} дн`;
const telHref = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-9); return d.length === 9 ? `tel:+380${d}` : ''; };

export function createReturnsPages() {
  const f = { st: 'active', src: '', to: '', reason: '', car: '', q: '', from: '', till: '' };
  let refreshing = false;

  const stateOf = (r) => (r.state === 'branch' && r.overdue ? 'overdue' : r.state);
  const match = (r, st) => (st === 'all' ? true : st === 'active' ? r.state !== 'got' : st === 'branch' ? r.state === 'branch' : st === 'overdue' ? r.state === 'branch' && r.overdue : r.state === st);
  const inPeriod = (r) => (!f.from || (r.refused_at || r.created_at).slice(0, 10) >= f.from) && (!f.till || (r.refused_at || r.created_at).slice(0, 10) <= f.till);
  const hay = (r) => [r.orig_ttn, r.ret_ttn, r.customer, r.phone, r.to, r.cargo, ...r.orders.map((o) => o.no)].join(' ').toLowerCase();

  // Стан і скільки чекає: у відділенні — від прибуття (5+ дн — червоним), в дорозі — від створення ЕН повернення.
  function waitCell(r) {
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
  const row = (r) => `<tr class="${r.reason === 'customer' ? 'ret-cust' : ''}">
    <td class="nowrap">${r.reason === 'customer' ? '<div><span class="badge ret-cust-b">↩ Від клієнта</span></div>' : ''}${r.carrier === 'np'
      ? `${r.ret_ttn ? `<b class="ret-ttn">${esc(r.ret_ttn)}</b>` : '<span class="muted">—</span>'}<div class="small muted">Нова пошта</div><div class="small muted">з ${esc(r.orig_ttn)}</div>`
      : `<b class="ret-ttn">${esc(r.orig_ttn.includes(':') ? '—' : r.orig_ttn)}</b><div class="small muted">${esc(CAR[r.carrier])}</div><div class="small muted">ТТН відправлення</div>`}</td>
    <td>${r.orders.length ? r.orders.map((o) => `<div><span class="badge ${SRC_CLS[o.src] || ''}">${esc(o.label)}</span> <span class="small">${esc(o.no)}</span></div>`).join('') : `<span class="small muted">${r.account ? `кабінет НП «${esc(r.account)}»` : '—'}</span>`}</td>
    <td>${esc(r.customer || '—')}${r.phone ? `<div class="small muted">${phoneFmt(r.phone)}</div>` : ''}</td>
    <td>${r.to ? `<b>${esc(r.to)}</b>` : '<span class="muted">—</span>'}${r.to_name && r.to_name !== r.to ? `<div class="small">${esc(r.to_name)}</div>` : ''}${r.to_phone ? `<div class="small muted">${phoneFmt(r.to_phone)}</div>` : ''}${r.warehouse ? `<div class="small muted">${esc([r.city, r.warehouse].filter(Boolean).join(', '))}</div>` : ''}</td>
    <td class="small">${esc(r.cargo || '—')}${r.cost ? `<div class="muted">${money(r.cost)} ₴${r.cod ? ` · післяплата ${money(r.cod)} ₴` : ''}</div>` : ''}</td>
    <td class="small">${esc(REASON[r.reason] || r.reason || '—')}</td>
    <td style="min-width:170px">${waitCell(r)}</td>
  </tr>`;

  async function viewReturns() {
    const d = await api('GET', '/api/returns');
    const all = d.rows;
    const base = all.filter(inPeriod).filter((r) => !f.q || hay(r).includes(f.q.toLowerCase()));
    const byFacet = (k) => base.filter((r) => match(r, f.st) && (k === 'src' || !f.src || r.src === f.src) && (k === 'to' || !f.to || r.to === f.to)
      && (k === 'reason' || !f.reason || r.reason === f.reason) && (k === 'car' || !f.car || r.carrier === f.car));
    // Спершу те, що треба забрати (найдовше у відділенні — вгорі), далі в дорозі, без ЕН, отримані — найновіші.
    const PRI = { branch: 0, transit: 1, nottn: 2, got: 3 };
    const rows = byFacet('').sort((a, b) => PRI[a.state] - PRI[b.state] || (a.state === 'got' ? String(b.got_at).localeCompare(String(a.got_at)) : (b.branch_days ?? b.wait_days ?? 0) - (a.branch_days ?? a.wait_days ?? 0)));
    const cnt = (list, key) => list.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m; }, {});
    const facetSt = base.filter((r) => (!f.src || r.src === f.src) && (!f.to || r.to === f.to) && (!f.reason || r.reason === f.reason) && (!f.car || r.carrier === f.car));
    const stN = Object.fromEntries(STATES.map(([k]) => [k, facetSt.filter((r) => match(r, k)).length]));
    const srcN = cnt(byFacet('src'), 'src');
    const toN = cnt(byFacet('to'), 'to');
    const reN = cnt(byFacet('reason'), 'reason');
    const carN = cnt(byFacet('car'), 'carrier');
    all.forEach((r) => { r.mp_close_days = d.mp_close_days; });
    // Щоб забрати: кабінети НП з тим, що чекає (обраний отримувач — лише він).
    const pick = (d.pickup || []).filter((p) => (f.to ? p.name === f.to : p.branch || p.transit));
    const pickHtml = pick.length ? fpGroup('Щоб забрати (Нова пошта)', pick.map((p) => `<div class="ret-pick">
        <b>${esc(p.name)}</b>${p.code ? `<div class="small muted">ЄДРПОУ / ІПН: <b>${esc(p.code)}</b></div>` : ''}
        ${p.persons.map((x) => `<div class="small">${esc(x.name || '')}${x.phone ? ` · <a href="${telHref(x.phone)}">${phoneFmt(x.phone)}</a>` : ''}${x.contact ? ' <span class="muted">(контакт кабінету)</span>' : ''}</div>`).join('') || '<div class="small muted">Номер з’явиться після першого повернення або оновлення контактів</div>'}
        ${p.branch ? `<div class="small" style="margin-top:4px"><b>Чекає у відділенні: ${p.branch}</b></div>${p.warehouses.map((w) => `<div class="small muted">${esc(w.w)}${w.n > 1 ? ` — ${w.n}` : ''}</div>`).join('')}` : ''}
        ${p.transit ? `<div class="small muted">В дорозі: ${p.transit}</div>` : ''}</div>`).join('')) : '';
    const act = all.filter((r) => r.state !== 'got');
    const branch = act.filter((r) => r.state === 'branch');
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const got7 = all.filter((r) => r.state === 'got' && r.got_at >= weekAgo);
    const avg = got7.filter((r) => r.wait_days !== null);
    const cy = d.cycle || {};
    const next = cy.finished ? new Date(Date.parse(cy.started) + d.cycle_hours * 3600e3).toISOString() : '';
    main.innerHTML = `
      <div class="head-row"><h2>Повернення</h2><div class="btn-row">
        <button class="btn" id="retRefresh">🔄 Оновити інформацію</button>
        <button class="btn" id="retCopy">📋 Копіювати ТТН (${rows.filter((r) => r.ret_ttn || (r.carrier !== 'np' && !r.orig_ttn.includes(':'))).length})</button>
        <button class="btn" id="retXls">⬇ Excel</button></div></div>
      <div class="small muted" style="margin-bottom:10px">Нова пошта: ${!cy.started ? 'ще не перевіряли' : !cy.done ? `перевірка триває${cy.pause_until && Date.parse(cy.pause_until) > Date.now() ? ` (Нова пошта просить зачекати до ${esc(fmtDateTime(cy.pause_until).slice(-5))})` : '…'}` : `перевірено ${esc(fmtDateTime(cy.finished))}${next ? ` · наступна перевірка ≈ ${esc(fmtDateTime(next))}` : ''}`}
        · кабінетів НП: ${d.accounts.length} · Розетка Делівері й маркетплейси — зі статусів замовлень · Міст Експрес — підключимо згодом</div>
      ${cy.error ? `<div class="alert warn small" style="margin-bottom:10px">Остання перевірка не вдалася: ${esc(cy.error)}. Натисніть «Оновити інформацію».</div>` : ''}
      ${!d.accounts.length ? '<div class="alert warn" style="margin-bottom:10px">Кабінети Нової пошти ще не додано: «Налаштування → Доставка: НП, Розетка, Prom, Епіцентр».</div>' : ''}
      ${fpLayout(`${pickHtml}${fpGroup('Пошук', `<input id="retQ" type="search" placeholder="ТТН, клієнт, телефон, № замовлення" value="${esc(f.q)}" aria-label="Пошук повернення">`)}
        ${fpGroup('Стан', STATES.map(([k, v]) => fpBtn(`<span>${esc(v)}</span><span class="small">${stN[k] || ''}</span>`, f.st === k, `data-rst="${k}"`)).join(''))}
        ${fpGroup('Джерело', [fpBtn('<span>Усі</span>', !f.src, 'data-rsrc=""'), ...Object.keys(SRC).filter((k) => srcN[k] || f.src === k).map((k) => fpBtn(`<span>${esc(SRC[k])}</span><span class="small">${srcN[k] || ''}</span>`, f.src === k, `data-rsrc="${k}"`))].join(''))}
        ${fpGroup('Перевізник', [fpBtn('<span>Усі</span>', !f.car, 'data-rcar=""'), ...Object.keys(CAR).filter((k) => carN[k] || f.car === k).map((k) => fpBtn(`<span>${esc(CAR[k])}</span><span class="small">${carN[k] || ''}</span>`, f.car === k, `data-rcar="${k}"`))].join(''))}
        ${Object.keys(toN).filter(Boolean).length ? fpGroup('Отримувач', [fpBtn('<span>Усі</span>', !f.to, 'data-rto=""'), ...Object.keys(toN).filter(Boolean).sort().map((k) => fpBtn(`<span>${esc(k)}</span><span class="small">${toN[k]}</span>`, f.to === k, `data-rto="${esc(k)}"`))].join('')) : ''}
        ${fpGroup('Причина', [fpBtn('<span>Усі</span>', !f.reason, 'data-rre=""'), ...Object.keys(REASON).map((k) => fpBtn(`<span>${esc(REASON[k])}</span><span class="small">${reN[k] || ''}</span>`, f.reason === k, `data-rre="${k}"`))].join(''))}
        ${fpGroup('Період (відмова)', `<div class="an7-dates ${f.from || f.till ? 'on' : ''}"><input id="retFrom" type="date" value="${esc(f.from)}" aria-label="З дати"><input id="retTill" type="date" value="${esc(f.till)}" aria-label="По дату"></div>`)}`,
      `<div class="kpis">
        ${fpKpi('Забрати з відділення', String(branch.length), branch.filter((r) => r.overdue).length ? `з них ${branch.filter((r) => r.overdue).length} — ${d.overdue_days}+ днів` : 'нічого не прострочено', branch.some((r) => r.overdue) ? 'kpi-bad' : '')}
        ${fpKpi('В дорозі до нас', String(act.filter((r) => r.state === 'transit').length), act.filter((r) => r.state === 'transit').length ? `найдовше — ${Math.max(...act.filter((r) => r.state === 'transit').map((r) => r.wait_days || 0))} дн` : '')}
        ${fpKpi('Від клієнтів після отримання', String(act.filter((r) => r.reason === 'customer').length), 'в дорозі або чекають', act.some((r) => r.reason === 'customer') ? 'kpi-cust' : '')}
        ${fpKpi('Сума товару в поверненнях', `${money(act.reduce((s, r) => s + (r.cost || 0), 0)).replace(/,00$/, '')} ₴`, `${act.length} посилок`)}
        ${fpKpi('Отримано за 7 днів', String(got7.length), avg.length ? `у середньому за ${(avg.reduce((s, r) => s + r.wait_days, 0) / avg.length).toFixed(1).replace('.', ',')} дн` : '')}
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Повернення</th><th>Звідки</th><th>Клієнт</th><th>На кого</th><th>Товар</th><th>Причина</th><th>Стан і очікування</th></tr></thead><tbody>
        ${rows.slice(0, 500).map(row).join('')}</tbody></table></div>${rows.length > 500 ? `<div class="small muted">Показано 500 з ${rows.length} — звузьте фільтр.</div>` : ''}`
        : `<div class="card empty"><div class="big">Повернень немає</div>${all.length ? 'Змініть фільтр або пошук.' : 'Щойно Нова пошта зафіксує відмову чи повернення в підключених кабінетах, вони з’являться тут.'}</div>`}`,
      { summary: [STATES.find(([k]) => k === f.st)?.[1], SRC[f.src], f.to, REASON[f.reason], f.q].filter(Boolean).join(' · ') })}`;
    wireFp();
    $$('[data-rst]').forEach((b) => (b.onclick = () => { f.st = b.dataset.rst; viewReturns(); }));
    $$('[data-rsrc]').forEach((b) => (b.onclick = () => { f.src = b.dataset.rsrc; viewReturns(); }));
    $$('[data-rto]').forEach((b) => (b.onclick = () => { f.to = b.dataset.rto; viewReturns(); }));
    $$('[data-rre]').forEach((b) => (b.onclick = () => { f.reason = b.dataset.rre; viewReturns(); }));
    $$('[data-rcar]').forEach((b) => (b.onclick = () => { f.car = b.dataset.rcar; viewReturns(); }));
    $('#retFrom').onchange = (e) => { f.from = e.target.value; viewReturns(); };
    $('#retTill').onchange = (e) => { f.till = e.target.value; viewReturns(); };
    let qt;
    $('#retQ').oninput = (e) => { clearTimeout(qt); qt = setTimeout(async () => { f.q = e.target.value.trim(); await viewReturns(); const el = $('#retQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 300); };
    $('#retCopy').onclick = async () => {
      const list = rows.map((r) => r.ret_ttn || (r.carrier !== 'np' && !r.orig_ttn.includes(':') ? r.orig_ttn : '')).filter(Boolean);
      try { await navigator.clipboard.writeText(list.join('\n')); toast(`Скопійовано ТТН: ${list.length}`); } catch { toast('Не вдалося скопіювати — скористайтесь Excel', true); }
    };
    $('#retXls').onclick = () => {
      const cols = [{ title: 'ТТН повернення', width: 17 }, { title: 'Початкова ТТН', width: 17 }, { title: 'Звідки', width: 30 }, { title: 'Клієнт', width: 24 }, { title: 'Телефон клієнта', width: 15 },
        { title: 'На кого', width: 22 }, { title: 'Куди', width: 34 }, { title: 'Товар', width: 30 }, { title: 'Вартість', width: 11, fmt: 'money' }, { title: 'Причина', width: 22 },
        { title: 'Стан', width: 20 }, { title: 'Днів у відділенні', width: 10 }, { title: 'Платне зберігання з', width: 14 }, { title: 'Отримано', width: 16 }];
      const stName = { branch: 'У відділенні', transit: 'В дорозі', nottn: 'ЕН ще немає', got: 'Отримано' };
      downloadXlsx(`povernennya-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Повернення', cols, rows: rows.map((r) => [r.ret_ttn || (r.carrier !== 'np' ? `${CAR[r.carrier]}: ${r.orig_ttn}` : ''), r.orig_ttn, r.orders.map((o) => `${o.label} ${o.no}`).join('; '), r.customer, r.phone ? `0${r.phone.slice(-9)}` : '',
        r.to, [r.city, r.warehouse].filter(Boolean).join(', '), r.cargo, r.cost || '', REASON[r.reason] || r.reason, stName[r.state] || r.state, r.state === 'branch' ? r.branch_days : '', r.paid_from ? dShort(r.paid_from) : '', r.got_at ? fmtDateTime(r.got_at) : '']) }]);
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
