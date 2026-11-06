// Головні сторінки: «Потребує дій» (команда), головна кабінету партнера, виписка взаєморозрахунків.
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, fmtDateTime } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { uah, fmtDay, fpLayout, wireFp, fpGroup, fpBtn } from './b2b-shared.js';

const LEVEL = { bad: 'bad', warn: 'warn', info: 'info' };
const kyivToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
const monthStart = () => `${kyivToday().slice(0, 8)}01`;
// Швидкі періоди виписки: [з, по].
const shiftDay = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const QUICK = {
  month: ['Цей місяць', () => [monthStart(), kyivToday()]],
  last: ['Минулий місяць', () => { const end = shiftDay(monthStart(), -1); return [`${end.slice(0, 8)}01`, end]; }],
  quarter: ['Цей квартал', () => { const t = kyivToday(); const m = Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1; return [`${t.slice(0, 4)}-${String(m).padStart(2, '0')}-01`, t]; }],
  year: ['Цей рік', () => [`${kyivToday().slice(0, 4)}-01-01`, kyivToday()]],
};
const uah0 = (v) => `${Math.round(Number(v) || 0).toLocaleString('uk-UA')} грн`;
const ICON = { supply: 'З', client: 'К', claim: 'О', price: '₴' };
const FEED_KINDS = { '': 'Усе', supply: 'Закупівлі', client: 'Клієнти', claim: 'Обміни', price: 'Ціни' };

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
    const from14 = shiftDay(kyivToday(), -14);
    const [d, lim, feed, prices] = await Promise.all([
      api('GET', '/api/b2b/p/home'),
      api('GET', '/api/b2b/p/limits').catch(() => null),
      api('GET', '/api/b2b/p/feed?limit=40').catch(() => ({})),
      api('GET', `/api/b2b/p/price-log?from=${from14}`).catch(() => ({})),
    ]);
    const canEdit = !ctx.can || ctx.can('b2b.order');
    const paused = d.partner.paused;
    // Стрічка: історія закупівель / замовлень / обмінів + зміни цін за 14 днів.
    const priceRows = (prices.rows || []).slice(0, 30).map((r) => (r.kind === 'margin'
      ? { kind: 'price', at: r.at, text: `Ваша знижка на ${r.brand}: ${r.old_margin ?? '—'}% → ${r.new_margin}%`, link: '#/pprices', number: '', who: '' }
      : { kind: 'price', at: r.at, text: `${r.new_rrp > r.old_rrp ? 'Подорожчав' : 'Подешевшав'} ${r.name}: РРЦ ${uah(r.old_rrp)} → ${uah(r.new_rrp)}${r.new_price != null ? ` · ваша ціна ${uah(r.new_price)}` : ''}`, link: '#/pprices', number: '', who: '' }));
    const all = [...(feed.rows || []), ...priceRows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const st = viewPartnerHome.st || '';
    const bar = (v, max) => `<div class="limit-bar"><i class="${v >= max - 0.01 ? 'bad' : ''}" style="width:${max ? Math.min(100, Math.round((v / max) * 100)) : 0}%"></i></div>`;
    const drawFeed = () => {
      const list = all.filter((r) => !viewPartnerHome.st || r.kind === viewPartnerHome.st).slice(0, 25);
      $('#hfList').innerHTML = list.length ? list.map((r) => `<a class="feed-row" href="${esc(r.link)}">
          <span class="feed-ic ${r.kind}" aria-hidden="true">${ICON[r.kind] || '•'}</span>
          <span class="feed-b"><span class="feed-t">${r.number ? `<b>${esc(r.number)}</b>${r.client_name ? ` · ${esc(r.client_name)}` : ''} — ` : ''}${esc(r.text)}</span>
            <span class="small muted">${esc(fmtDateTime(r.at))}${r.who ? ` · ${esc(r.who)}` : ''}</span></span>
          <span class="todo-go" aria-hidden="true">→</span></a>`).join('')
        : '<p class="muted" style="margin:0">Подій поки немає.</p>';
      $$('[data-hf]').forEach((b) => b.classList.toggle('on', b.dataset.hf === (viewPartnerHome.st || '')));
    };
    main.innerHTML = `
      <div class="head-row"><h2>${esc(d.partner.name)}</h2></div>
      ${paused ? '<div class="alert bad" style="margin-bottom:14px">Нові закупівлі й замовлення тимчасово призупинено. Зверніться до менеджера.</div>' : ''}
      <div class="home2">
        <aside class="home2-side">
          <div class="card home2-act">
            <span class="an7-h">Швидкі дії</span>
            ${canEdit && !paused ? '<a class="btn primary" href="#/porders/new">+ Нова закупівля</a><a class="btn" href="#/pclients/new">+ Замовлення клієнта</a>' : ''}
            <a class="btn" href="#/pcatalog">Каталог і прайс</a>
            <a class="btn" href="#/pstatement">Взаєморозрахунки</a>
            <a class="btn" href="#/pclaims">Обміни й брак</a>
            <a class="btn" href="#/pstats">Аналітика продажів</a>
          </div>
          ${d.manager ? `<div class="card form-stack"><span class="an7-h">Ваш менеджер</span><b>${esc(d.manager.name)}</b><span class="small muted">Пишіть у вашу Telegram-групу з Ековент — менеджер там.</span></div>` : ''}
          ${lim && (lim.open?.limit || lim.unpaid?.limit) ? `<div class="card form-stack"><span class="an7-h">Ліміти</span>
            ${lim.open?.limit ? `<div class="lim-row small"><span><span>Відкрита закупівля</span><b>${uah0(lim.open.total || 0)}</b></span>${bar(lim.open.total || 0, lim.open.limit)}<span class="muted">з ліміту ${uah0(lim.open.limit)}</span></div>` : ''}
            ${lim.unpaid?.limit ? `<div class="lim-row small"><span><span>Неоплачені закупівлі</span><b>${uah0(lim.unpaid.total)}</b></span>${bar(lim.unpaid.total, lim.unpaid.limit)}<span class="muted">з ліміту ${uah0(lim.unpaid.limit)}</span></div>` : ''}
          </div>` : ''}
        </aside>
        <div class="home2-main">
          <div class="kpis" style="margin:0">
            <div class="kpi ${d.debt.overdue ? 'kpi-bad' : ''}"><span class="kpi-l">Борг</span><span class="kpi-v">${uah(d.debt.total)}</span>
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
            <div class="head-row" style="margin-bottom:6px"><h3 style="margin:0">Що відбувається</h3>
              <div class="btn-row" style="flex-wrap:wrap">${Object.entries(FEED_KINDS).map(([k, v]) => `<button type="button" class="chip ${st === k ? 'on' : ''}" data-hf="${k}">${v}</button>`).join('')}</div></div>
            <div id="hfList"></div>
          </div>
        </div>
      </div>`;
    $$('[data-hf]').forEach((b) => (b.onclick = () => { viewPartnerHome.st = b.dataset.hf; drawFeed(); }));
    drawFeed();
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
    const quickOn = Object.keys(QUICK).find((k) => { const [a, b] = QUICK[k][1](); return a === from && b === to; }) || '';
    const aside = `${admin ? fpGroup('Партнер', `<select id="stP" aria-label="Партнер">${partners.map((p) => `<option value="${p.id}" ${String(p.id) === String(partnerId) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`) : ''}
        ${fpGroup('Період', Object.entries(QUICK).map(([k, [label]]) => fpBtn(`<span>${label}</span>`, quickOn === k, `data-sq="${k}"`)).join(''))}
        ${fpGroup('Свій період', `<div class="an7-dates ${quickOn ? '' : 'on'}"><label class="small muted" for="stFrom">З</label><input type="date" id="stFrom" value="${from}"><label class="small muted" for="stTo">По</label><input type="date" id="stTo" value="${to}"></div>`)}
        <button type="button" class="btn primary" id="stGo">Показати</button>`;
    main.innerHTML = `
      <div class="head-row"><h2>Взаєморозрахунки</h2></div>
      ${fpLayout(aside, '<div id="stBody"><div class="card muted">Завантаження…</div></div>', { summary: `${fmtDay(from)} – ${fmtDay(to)}` })}`;
    wireFp();
    const go = () => {
      const base = admin ? `#/b2bstatement/${$('#stP').value}` : '#/pstatement';
      location.hash = `${base}?from=${$('#stFrom').value}&to=${$('#stTo').value}`;
    };
    $('#stGo').onclick = go;
    if (admin) $('#stP').onchange = go;
    $$('[data-sq]').forEach((b) => (b.onclick = () => { const [a, z] = QUICK[b.dataset.sq][1](); $('#stFrom').value = a; $('#stTo').value = z; go(); }));
    if (admin && !partnerId) { $('#stBody').innerHTML = '<div class="card muted">Партнерів ще немає.</div>'; return; }
    let d;
    try { d = await api('GET', `${url}?from=${from}&to=${to}`); } catch (e) { $('#stBody').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; return; }
    const kindName = { invoice: 'Рахунок', pay: 'Оплата', manual: 'Оплата (вручну)' };
    $('#stBody').innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="kpi-l">Сальдо на ${fmtDay(d.from)}</span><span class="kpi-v">${uah(d.opening)}</span></div>
        <div class="kpi"><span class="kpi-l">Нараховано</span><span class="kpi-v">${uah(d.debit)}</span></div>
        <div class="kpi"><span class="kpi-l">Оплачено</span><span class="kpi-v">${uah(d.credit)}</span></div>
        <div class="kpi ${d.closing > 0.004 ? 'kpi-bad' : ''}"><span class="kpi-l">Сальдо на ${fmtDay(d.to)}</span><span class="kpi-v">${uah(d.closing)}</span>
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
