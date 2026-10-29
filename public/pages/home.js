// Головні сторінки: «Потребує дій» (команда), головна кабінету партнера, виписка взаєморозрахунків.
import { esc } from '../invoice.js';
import { $, main, api, toast } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { uah, fmtDay } from './b2b-shared.js';

const LEVEL = { bad: 'bad', warn: 'warn', info: 'info' };
const kyivToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
const monthStart = () => `${kyivToday().slice(0, 8)}01`;

export function createHomePages(ctx = {}) {
  // ---------- команда: що чекає дій ----------
  async function viewHome() {
    main.innerHTML = '<div class="head-row"><h2>Потребує дій</h2></div><div class="card muted">Завантаження…</div>';
    const { items } = await api('GET', '/api/home');
    const name = ctx.boot?.user?.name || '';
    main.innerHTML = `
      <div class="head-row"><h2>Потребує дій</h2><button class="btn" id="hmRefresh">Оновити</button></div>
      ${items.length ? `<div class="todo-list">${items.map((x) => `
        <a class="todo ${LEVEL[x.level] || ''}" href="${esc(x.link)}">
          <b class="todo-n">${x.count}</b><span>${esc(x.label)}</span><span class="todo-go" aria-hidden="true">→</span>
        </a>`).join('')}</div>`
    : `<div class="card empty-ok"><b>Усе зроблено${name ? `, ${esc(name.split(' ')[0])}` : ''}</b><span class="muted">Нових замовлень, рахунків до виставлення, платежів на перевірку і збоїв немає.</span></div>`}
      <p class="muted small" style="margin-top:14px">Список оновлюється при кожному відкритті сторінки. Тут — те, що видно з вашими правами.</p>`;
    $('#hmRefresh').onclick = () => viewHome();
  }

  // ---------- партнер: головна кабінету ----------
  async function viewPartnerHome() {
    main.innerHTML = '<div class="card muted">Завантаження…</div>';
    const d = await api('GET', '/api/b2b/p/home');
    const kind = (o) => (o.kind === 'supply' ? 'Закупівля' : `Замовлення клієнта${o.client_name ? ` · ${esc(o.client_name)}` : ''}`);
    main.innerHTML = `
      <div class="head-row"><h2>${esc(d.partner.name)}</h2></div>
      ${d.partner.paused ? '<div class="alert bad" style="margin-bottom:14px">Нові закупівлі й замовлення тимчасово призупинено. Зверніться до менеджера.</div>' : ''}
      <div class="kpis">
        <div class="kpi"><span class="kpi-l">Борг</span><span class="kpi-v">${uah(d.debt.total)}</span>
          ${d.debt.overdue ? `<span class="badge bad">прострочено ${uah(d.debt.overdue)}</span>` : '<span class="muted small">прострочень немає</span>'}</div>
        <div class="kpi"><span class="kpi-l">Найближча оплата</span>${d.debt.next
    ? `<span class="kpi-v">${fmtDay(d.debt.next.due_date)}</span><a class="small" href="#/porders/${d.debt.next.id}">${esc(d.debt.next.number)} · ${uah(d.debt.next.due)}</a>`
    : '<span class="kpi-v">—</span><span class="muted small">рахунків зі строком немає</span>'}</div>
        ${d.postpay.days ? `<div class="kpi"><span class="kpi-l">Відстрочка ${d.postpay.days} дн.</span><span class="kpi-v">${uah(d.postpay.used)}</span>
          <span class="muted small">${d.postpay.limit ? `з ${uah(d.postpay.limit)}` : 'використано'}</span></div>` : ''}
      </div>
      <div class="card">
        <h3>Чекає ваших дій</h3>
        ${d.todo.length ? `<div class="todo-list">${d.todo.map((t) => `<a class="todo ${t.bad ? 'bad' : 'warn'}" href="${esc(t.link)}"><span>${esc(t.text)}</span><span class="todo-go" aria-hidden="true">→</span></a>`).join('')}</div>`
    : '<p class="muted" style="margin:0">Нічого не чекає — усе підтверджено.</p>'}
      </div>
      <div class="card">
        <div class="head-row" style="margin-bottom:8px"><h3 style="margin:0">Останні закупівлі й замовлення</h3><a href="#/pstatement">Взаєморозрахунки →</a></div>
        ${d.recent.length ? `<table class="list"><thead><tr><th>№</th><th>Що</th><th class="r">Сума</th><th>Створено</th></tr></thead><tbody>
          ${d.recent.map((o) => `<tr class="click" data-href="#/${o.kind === 'supply' ? 'porders' : 'pclients'}/${o.id}"><td><b>${esc(o.number)}</b></td><td>${kind(o)}</td><td class="r">${uah(o.total)}</td><td>${fmtDay(o.created_at)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted" style="margin:0">Ще немає закупівель.</p>'}
      </div>`;
    for (const tr of main.querySelectorAll('tr[data-href]')) tr.onclick = () => { location.hash = tr.dataset.href; };
  }

  // ---------- виписка взаєморозрахунків (партнер — свою; адмін — будь-якого партнера) ----------
  async function viewStatement(partnerId = '') {
    const admin = !ctx.can?.('b2b.partner');
    const partners = admin ? await api('GET', '/api/b2b/partners') : [];
    if (admin && !partnerId && partners.length) partnerId = String(partners[0].id);
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const from = q.get('from') || monthStart();
    const to = q.get('to') || kyivToday();
    const url = admin ? `/api/b2b/partners/${partnerId}/statement` : '/api/b2b/p/statement';
    main.innerHTML = `
      <div class="head-row"><h2>Взаєморозрахунки</h2></div>
      <div class="card stmt-form">
        ${admin ? `<label class="f">Партнер<select id="stP">${partners.map((p) => `<option value="${p.id}" ${String(p.id) === String(partnerId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
        <label class="f">З<input type="date" id="stFrom" value="${from}"></label>
        <label class="f">По<input type="date" id="stTo" value="${to}"></label>
        <button class="btn primary" id="stGo">Показати</button>
      </div>
      <div id="stBody"><div class="card muted">Завантаження…</div></div>`;
    const go = () => {
      const base = admin ? `#/b2bstatement/${$('#stP').value}` : '#/pstatement';
      location.hash = `${base}?from=${$('#stFrom').value}&to=${$('#stTo').value}`;
    };
    $('#stGo').onclick = go;
    if (admin) $('#stP').onchange = go;
    if (admin && !partnerId) { $('#stBody').innerHTML = '<div class="card muted">Партнерів ще немає.</div>'; return; }
    let d;
    try { d = await api('GET', `${url}?from=${from}&to=${to}`); } catch (e) { $('#stBody').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; return; }
    const kindName = { invoice: 'Рахунок', pay: 'Оплата', manual: 'Оплата (вручну)' };
    $('#stBody').innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="kpi-l">Сальдо на ${fmtDay(d.from)}</span><span class="kpi-v">${uah(d.opening)}</span></div>
        <div class="kpi"><span class="kpi-l">Нараховано</span><span class="kpi-v">${uah(d.debit)}</span></div>
        <div class="kpi"><span class="kpi-l">Оплачено</span><span class="kpi-v">${uah(d.credit)}</span></div>
        <div class="kpi"><span class="kpi-l">Сальдо на ${fmtDay(d.to)}</span><span class="kpi-v">${uah(d.closing)}</span>
          <span class="muted small">${d.closing > 0.004 ? 'борг партнера' : d.closing < -0.004 ? 'переплата партнера' : 'розрахунки закрито'}</span></div>
      </div>
      <div class="head-row"><span class="muted small">${d.rows.length} операцій за період</span>${d.rows.length ? '<button class="btn" id="stXlsx">Завантажити Excel</button>' : ''}</div>
      ${d.rows.length ? `<table class="list"><thead><tr><th>Дата</th><th>Документ</th><th>Платник / хто</th><th class="r">Нараховано</th><th class="r">Оплачено</th><th class="r">Сальдо</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td>${fmtDay(r.date)}</td><td><span class="badge ${r.kind === 'invoice' ? '' : 'ok'}">${kindName[r.kind]}</span> ${esc(r.doc)}</td><td class="small">${esc(r.payer)}</td>
          <td class="r">${r.debit ? uah(r.debit) : ''}</td><td class="r">${r.credit ? uah(r.credit) : ''}</td><td class="r"><b>${uah(r.balance)}</b></td></tr>`).join('')}
      </tbody></table>` : '<div class="card muted">За цей період рахунків і оплат немає.</div>'}
      <p class="muted small" style="margin-top:12px">Нараховано — рахунки на закупівлі (за датою рахунку); оплачено — платежі, зараховані в ці закупівлі, і оплати, позначені вручну.
        Довідкова виписка з даних сервісу; офіційний акт звірки формує бухгалтерія.</p>`;
    const x = $('#stXlsx');
    if (x) x.onclick = () => {
      downloadXlsx(`Взаєморозрахунки ${d.partner} ${d.from}—${d.to}.xlsx`.replace(/[\\/:*?"<>|]+/g, '_'), [{
        name: 'Взаєморозрахунки',
        cols: [{ title: 'Дата', width: 12 }, { title: 'Операція', width: 16 }, { title: 'Документ', width: 40 }, { title: 'Платник / хто', width: 36 },
          { title: 'Нараховано, грн', width: 16, fmt: 'money' }, { title: 'Оплачено, грн', width: 16, fmt: 'money' }, { title: 'Сальдо, грн', width: 16, fmt: 'money' }],
        rows: [['', 'Сальдо на початок', '', '', '', '', d.opening],
          ...d.rows.map((r) => [fmtDay(r.date), kindName[r.kind], r.doc, r.payer, r.debit || '', r.credit || '', r.balance]),
          ['', 'Разом за період', '', '', d.debit, d.credit, d.closing]],
      }]);
      toast('Excel завантажено');
    };
  }

  return { viewHome, viewPartnerHome, viewStatement };
}
