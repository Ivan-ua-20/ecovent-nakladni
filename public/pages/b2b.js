// B2B (власник і адміністратори): партнери, їхні користувачі, бренди й маржа, каталог з цінами з LP-CRM,
// закупівлі (рахунок, накладна, файли), замовлення клієнтів партнерів (передача в LP-CRM).
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { viewAdminSupplyForm } from './b2b-supply.js';
import { uah, statusBadge, fmtDay, fileSize, itemsTable, uploadFile, payBadge, supplyMark, crmCell, phoneFmt, historyCard, teamTable, teamFormHtml, teamFormData, filterBar, wireFilterBar, filterQs, selCell, selHead, wireBulk, bulkBar } from './b2b-shared.js';

const pct = (v) => `${String(Number(v) || 0).replace('.', ',')}%`;

export function createB2bPages(ctx = {}) {
  // Додавати, змінювати й видаляти людей (користувачів партнерів) і партнерів — лише з правом «people».
  const people = () => !ctx.can || ctx.can('people');
  // ---------------------------------------------------------------- партнери
  // Список партнерів: фільтри, пошук, галочки і групові дії (зміни цін, оголошення, пауза, ліміти, маржа, Excel, видалення).
  const pFilter = { st: '', q: '' };
  const P_ST = { '': 'Усі', active: 'Активні', paused: 'На паузі', debt: 'З боргом', overdue: 'Прострочено', postpay: 'З відстрочкою', off: 'Вимкнені' };
  const pMatch = (p) => {
    const st = pFilter.st;
    if (st === 'active' && !(p.active && !p.paused)) return false;
    if (st === 'paused' && !p.paused) return false;
    if (st === 'debt' && !p.debt) return false;
    if (st === 'overdue' && !p.debt_overdue) return false;
    if (st === 'postpay' && !p.postpay_days) return false;
    if (st === 'off' && p.active) return false;
    const q = pFilter.q.trim().toLowerCase();
    return !q || [p.name, p.phone, p.email, p.note].some((x) => String(x || '').toLowerCase().includes(q));
  };
  const pState = (p) => (!p.active ? '<span class="badge bad">вимкнений</span>' : p.paused ? `<span class="badge warn" title="${esc(p.pause_note || '')}">⏸ пауза</span>` : '<span class="badge ok">активний</span>');
  const limTxt = (p) => [p.open_limit != null ? `відкр. ${money(p.open_limit)}` : '', p.unpaid_limit != null ? `неопл. ${money(p.unpaid_limit)}` : ''].filter(Boolean).join(' · ');

  async function viewPartners(id) {
    if (id) return viewPartner(id);
    const all = await api('GET', '/api/b2b/partners');
    const rows = all.filter(pMatch);
    const cnt = (k) => { const f = pFilter.st; pFilter.st = k; const n = all.filter(pMatch).length; pFilter.st = f; return n; };
    main.innerHTML = `
      <div class="head-row"><h2>B2B партнери</h2><div class="btn-row"><button class="btn" id="pAnn">📢 Оголошення партнерам</button><button class="btn primary" id="pNew">+ Новий партнер</button></div></div>
      <div class="alert info help" style="margin-bottom:14px">Партнер бачить лише свій кабінет: каталог увімкнених йому брендів з РРЦ і своєю ціною (РРЦ − маржа).
        За замовчуванням партнер не бачить жодного бренду — увімкніть бренди й задайте маржу в картці партнера. Позначте кількох партнерів галочками — з'являться групові дії.</div>
      ${all.length ? `<div class="btn-row" style="margin-bottom:8px;flex-wrap:wrap">${Object.entries(P_ST).map(([k, v]) => {
        const n = cnt(k);
        return k && !n ? '' : `<button class="chip ${pFilter.st === k ? 'on' : ''}" data-pst="${k}">${esc(v)} <span class="muted">${n}</span></button>`;
      }).join('')}</div>
      <div class="btn-row" style="margin-bottom:10px"><input id="pQ" placeholder="Пошук: назва, телефон, email, примітка" value="${esc(pFilter.q)}" style="max-width:340px"></div>
      <div id="pBulk" class="btn-row card" hidden style="position:sticky;top:8px;z-index:5;margin-bottom:10px;padding:8px 12px;flex-wrap:wrap;align-items:center"></div>` : ''}
      ${rows.length ? `<table class="list"><thead><tr><th style="width:34px"><input type="checkbox" id="pSelAll" aria-label="Обрати всіх"></th><th>Партнер</th><th class="hide-m">Контакти</th><th class="r">Борг</th><th class="r hide-m">Користувачі</th><th class="r hide-m">Бренди</th><th>Стан</th></tr></thead><tbody>
        ${rows.map((p) => `<tr class="click" data-p="${p.id}">
          <td data-nosel style="width:34px"><input type="checkbox" data-psel="${p.id}" aria-label="Обрати"></td>
          <td><b>${esc(p.name)}</b>${limTxt(p) ? `<div class="small muted">ліміти: ${limTxt(p)}</div>` : ''}</td>
          <td class="small hide-m">${esc([p.phone, p.email].filter(Boolean).join(' · ') || '—')}</td>
          <td class="r nowrap">${p.debt ? `<b>${money(p.debt)} грн</b><div class="small muted">${[p.debt_cnt ? `за рахунками: ${p.debt_cnt}` : '', p.debt_shipped ? `без рахунку: ${money(p.debt_shipped)}` : '', p.postpay_days ? `відстрочка ${p.postpay_days} дн.` : ''].filter(Boolean).join(' · ')}</div>` : `<span class="muted">—</span>${p.postpay_days ? `<div class="small muted">відстрочка ${p.postpay_days} дн.</div>` : ''}`}
            ${p.debt_overdue ? `<div><span class="badge bad">прострочено ${money(p.debt_overdue)}</span></div>` : ''}</td>
          <td class="r hide-m">${p.users}${p.users_by_partner ? `<div class="small muted">з них додав партнер: ${p.users_by_partner}</div>` : ''}</td><td class="r hide-m">${p.brands}</td>
          <td>${pState(p)}</td>
        </tr>`).join('')}
        <tr class="bk-total"><td></td><td><b>Усього борг</b></td><td class="hide-m"></td><td class="r nowrap"><b>${money(rows.reduce((t, p) => t + (p.debt || 0), 0))} грн</b>
          ${rows.some((p) => p.debt_overdue) ? `<div><span class="badge bad">прострочено ${money(rows.reduce((t, p) => t + (p.debt_overdue || 0), 0))}</span></div>` : ''}</td><td class="hide-m"></td><td class="hide-m"></td><td></td></tr></tbody></table>`
        : all.length ? '<div class="card empty"><div class="big">Нікого не знайдено</div>Змініть фільтр або пошук.</div>'
        : '<div class="card empty"><div class="big">Партнерів ще немає</div>Створіть першого партнера, додайте йому користувача і ввімкніть бренди.</div>'}`;
    $$('[data-p]').forEach((tr) => (tr.onclick = () => { location.hash = `#/b2bpartners/${tr.dataset.p}`; }));
    $$('[data-nosel]').forEach((td) => (td.onclick = (e) => e.stopPropagation()));
    $('#pNew').onclick = () => partnerForm(null);
    $('#pAnn').onclick = () => announce();
    $$('[data-pst]').forEach((b) => (b.onclick = () => { pFilter.st = b.dataset.pst; viewPartners(); }));
    let qt;
    $('#pQ') && ($('#pQ').oninput = (e) => { clearTimeout(qt); qt = setTimeout(async () => { pFilter.q = e.target.value; await viewPartners(); const el = $('#pQ'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 300); });
    wirePartnerBulk(rows);
  }

  function wirePartnerBulk(rows) {
    const bar = $('#pBulk');
    if (!bar) return;
    const sel = () => $$('[data-psel]').filter((x) => x.checked).map((x) => Number(x.dataset.psel));
    const chosen = () => rows.filter((r) => sel().includes(r.id));
    const actions = [
      ['prices', '💲 Зміни цін'], ['ann', '📢 Оголошення'], ['margin', '％ Маржа'], ['limits', 'Ліміти й відстрочка'],
      ['pause', '⏸ Пауза'], ['resume', '▶ Зняти паузу'], ['xlsx', '⬇ Excel'], ...(people() ? [['del', 'Видалити']] : []),
    ];
    const draw = () => {
      const ids = sel();
      bar.hidden = !ids.length;
      bar.innerHTML = ids.length ? `<b>Обрано: ${ids.length}</b>${actions.map(([k, l]) => `<button class="btn sm ${k === 'del' ? 'danger' : ''}" data-pb="${k}">${esc(l)}</button>`).join('')}<button class="btn sm" data-pb="_clear">Зняти вибір</button>` : '';
      $$('[data-pb]', bar).forEach((b) => (b.onclick = () => run(b.dataset.pb)));
      const allBox = $('#pSelAll');
      if (allBox) allBox.checked = ids.length && ids.length === $$('[data-psel]').filter((x) => x.offsetParent).length;
    };
    $$('[data-psel]').forEach((cb) => (cb.onchange = draw));
    $('#pSelAll') && ($('#pSelAll').onchange = (e) => { $$('[data-psel]').filter((x) => x.offsetParent).forEach((x) => { x.checked = e.target.checked; }); draw(); });
    const bulk = async (body, label) => {
      const { results } = await api('POST', '/api/b2b/partners/bulk', { ids: sel(), ...body });
      const bad = results.filter((r) => !r.ok);
      const changed = results.filter((r) => r.ok && r.changed).length;
      toast(`${label}: змінено ${changed} з ${results.length}${bad.length ? ` · помилки: ${bad.length}` : ''}`, bad.length > 0);
      if (bad.length) modal('Не вдалося для частини партнерів', `<div class="form-stack small">${bad.map((r) => `<div><b>${esc(r.name)}</b>: ${esc(r.error)}</div>`).join('')}</div>`, { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
      viewPartners();
    };
    async function run(k) {
      const ids = sel();
      if (k === '_clear') { $$('[data-psel]').forEach((x) => { x.checked = false; }); draw(); return; }
      if (k === 'prices') return sendPrices(ids);
      if (k === 'ann') return announce(ids);
      if (k === 'xlsx') return partnersXlsx(chosen());
      if (k === 'resume') return bulk({ action: 'resume' }, 'Паузу знято');
      if (k === 'pause') return pauseForm(ids.length, (note) => bulk({ action: 'pause', note }, 'Пауза'));
      if (k === 'limits') return bulkLimitsForm(ids.length, (body) => bulk({ action: 'limits', ...body }, 'Ліміти'));
      if (k === 'margin') return bulkMarginForm(ids.length, (body) => bulk({ action: 'margin', ...body }, 'Маржа'));
      if (k === 'del') {
        const list = chosen();
        if (!(await confirmDanger(`Видалити партнерів: ${list.length}?`, `${list.map((r) => r.name).join(', ')}. Їхні користувачі втратять доступ, бренди й маржа видаляться; замовлення лишаться в архіві.`, `Видалити ${list.length}`))) return;
        const fails = [];
        for (const r of list) { try { await api('DELETE', `/api/b2b/partners/${r.id}`); } catch (e) { fails.push(`${r.name}: ${e.message}`); } }
        toast(`Видалено: ${list.length - fails.length} з ${list.length}`, fails.length > 0);
        viewPartners();
      }
    }
    draw();
  }

  function pauseForm(n, done, note = '') {
    const m = modal(n === 1 ? 'Поставити партнера на паузу' : `Пауза для партнерів: ${n}`, `<div class="form-stack">
        <div class="small muted">На паузі партнер бачить кабінет, свої закупівлі й замовлення, може завантажувати документи, але не може створювати нові закупівлі й замовлення клієнтів і відправляти чернетки.</div>
        <label class="f"><span>Причина (бачить партнер, необов'язково)</span><input id="pzNote" maxlength="300" value="${esc(note)}" placeholder="Напр.: до оплати прострочених рахунків"></label></div>`,
    { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="pzOk">Поставити на паузу</button>' });
    $('#pzOk', m.el).onclick = async () => { m.close(); await done($('#pzNote', m.el).value.trim()); };
  }

  // Ліміти групою: порожнє поле — не змінювати; «типовий» — скинути до типового.
  function bulkLimitsForm(n, done) {
    const fld = (k, label, hint) => `<div class="f"><span>${label}</span><div class="btn-row" style="flex-wrap:nowrap">
        <select data-lm="${k}" style="max-width:170px"><option value="keep">не змінювати</option><option value="set">задати</option><option value="default">${k === 'postpay_limit' ? 'без ліміту' : k === 'postpay_days' ? 'вимкнути' : 'типовий'}</option></select>
        <input data-lv="${k}" inputmode="decimal" placeholder="${hint}" disabled></div></div>`;
    const m = modal(`Ліміти й відстрочка — партнерів: ${n}`, `<div class="form-stack">
        ${fld('open_limit', 'Ліміт відкритої закупівлі, грн', 'типово 20 000')}
        ${fld('unpaid_limit', 'Ліміт неоплачених закупівель, грн', 'типово 100 000')}
        ${fld('postpay_days', 'Відстрочка оплати, днів', '0–180')}
        ${fld('postpay_limit', 'Ліміт відстрочки, грн', 'напр. 50 000')}
        <div class="small muted">Змінюються лише поля з «задати» / «${'типовий'}». Кожна зміна записується в історію партнера.</div></div>`,
    { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="lmOk">Застосувати</button>' });
    $$('[data-lm]', m.el).forEach((s) => (s.onchange = () => { const i = $(`[data-lv="${s.dataset.lm}"]`, m.el); i.disabled = s.value !== 'set'; if (!i.disabled) i.focus(); }));
    $('#lmOk', m.el).onclick = async () => {
      const body = {};
      for (const s of $$('[data-lm]', m.el)) {
        const k = s.dataset.lm;
        if (s.value === 'keep') continue;
        const v = $(`[data-lv="${k}"]`, m.el).value.trim();
        if (s.value === 'set' && !v) { toast('Вкажіть значення або оберіть «не змінювати»', true); return; }
        body[k] = s.value === 'default' ? (k === 'postpay_days' ? 0 : '') : v;
      }
      if (!Object.keys(body).length) { toast('Нічого не обрано', true); return; }
      m.close();
      await done(body);
    };
  }

  // Маржа групою: бренд (усі увімкнені або конкретний) і дія — задати %, додати/відняти п.п., вимкнути бренд.
  async function bulkMarginForm(n, done) {
    const brands = await api('GET', '/api/b2b/brands');
    const m = modal(`Маржа — партнерів: ${n}`, `<div class="form-stack">
        <label class="f"><span>Бренд</span><select id="mgBrand"><option value="all">Усі бренди, увімкнені партнеру</option>${brands.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
        <div class="f"><span>Дія</span>
          <label class="check"><input type="radio" name="mgMode" value="set" checked> Задати маржу, %</label>
          <label class="check"><input type="radio" name="mgMode" value="add"> Змінити на ± п.п. (напр. 2 або -1,5)</label>
          <label class="check"><input type="radio" name="mgMode" value="disable"> Вимкнути бренд</label></div>
        <label class="f" id="mgValWrap"><span>Значення</span><input id="mgVal" inputmode="decimal" placeholder="напр. 20"></label>
        <label class="check" id="mgEnWrap" hidden><input type="checkbox" id="mgEnable"> Увімкнути бренд тим, у кого він вимкнений</label>
        <div class="small muted">Партнер отримає нові ціни, коли ви натиснете «Зміни цін» (усі зміни потрапляють у розсилку змін цін).</div></div>`,
    { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="mgOk">Застосувати</button>' });
    const sync = () => {
      const mode = $('input[name="mgMode"]:checked', m.el).value;
      const brand = $('#mgBrand', m.el).value;
      $('#mgValWrap', m.el).hidden = mode === 'disable';
      $('#mgEnWrap', m.el).hidden = !(mode === 'set' && brand !== 'all');
      const dis = $('input[name="mgMode"][value="disable"]', m.el);
      dis.disabled = brand === 'all';
      if (dis.disabled && dis.checked) { $('input[name="mgMode"][value="set"]', m.el).checked = true; sync(); }
    };
    $('#mgBrand', m.el).onchange = sync;
    $$('input[name="mgMode"]', m.el).forEach((r) => (r.onchange = sync));
    sync();
    $('#mgOk', m.el).onclick = async () => {
      const mode = $('input[name="mgMode"]:checked', m.el).value;
      const value = $('#mgVal', m.el).value.trim();
      if (mode !== 'disable' && !value) { toast('Вкажіть значення', true); return; }
      const brand = $('#mgBrand', m.el).value;
      const bname = $('#mgBrand', m.el).selectedOptions[0].textContent;
      const what = mode === 'disable' ? `вимкнути «${bname}»` : mode === 'set' ? `маржа ${value}% — ${brand === 'all' ? 'усі увімкнені бренди' : `«${bname}»`}` : `маржа ${Number(value.replace(',', '.')) > 0 ? '+' : ''}${value} п.п. — ${brand === 'all' ? 'усі увімкнені бренди' : `«${bname}»`}`;
      if (!(await confirmDanger(`Застосувати для ${n} партнерів?`, what, 'Застосувати'))) return;
      m.close();
      await done({ brand, mode, value, enable: $('#mgEnable', m.el).checked });
    };
  }

  function partnersXlsx(list) {
    downloadXlsx(`partnery-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Партнери', cols: [
      { title: 'Партнер', width: 28 }, { title: 'Телефон', width: 16 }, { title: 'Email', width: 24 }, { title: 'Стан', width: 12 },
      { title: 'Борг, грн', width: 14, fmt: 'money' }, { title: 'Прострочено, грн', width: 16, fmt: 'money' }, { title: 'Закупівель у боргу', width: 12 },
      { title: 'Відстрочка, дн.', width: 12 }, { title: 'Ліміт відстрочки', width: 14, fmt: 'money' }, { title: 'Ліміт відкритої', width: 14, fmt: 'money' },
      { title: 'Ліміт неоплачених', width: 14, fmt: 'money' }, { title: 'Користувачі', width: 10 }, { title: 'Бренди', width: 10 }, { title: 'Примітка', width: 30 },
    ], rows: list.map((p) => [p.name, p.phone || '', p.email || '', !p.active ? 'вимкнений' : p.paused ? 'пауза' : 'активний',
      p.debt || 0, p.debt_overdue || 0, p.debt_cnt || 0, p.postpay_days || 0, p.postpay_limit ?? '', p.open_limit ?? '', p.unpaid_limit ?? '', p.users, p.brands, p.note || '']) }]);
  }


  function partnerForm(p) {
    const isNew = !p;
    const m = modal(isNew ? 'Новий партнер' : `Партнер «${p.name}»`, `<form id="pF" class="form-stack">
        <label class="f"><span>Назва партнера *</span><input name="name" value="${esc(p?.name || '')}" required autocomplete="off"></label>
        <div class="grid2"><label class="f"><span>Телефон</span><input name="phone" value="${esc(p?.phone || '')}"></label>
          <label class="f"><span>E-mail</span><input name="email" value="${esc(p?.email || '')}"></label></div>
        <label class="f"><span>Примітка (бачать лише адміністратори)</span><textarea name="note" rows="2">${esc(p?.note || '')}</textarea></label>
        ${isNew ? '' : `<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Активний (вимкнений партнер не може входити)</label>`}
        <div class="grid2">
          <label class="f"><span>Ліміт відкритої закупівлі, грн</span><input name="open_limit" inputmode="decimal" value="${esc(p?.open_limit ?? '')}" placeholder="20000 (типово)"></label>
          <label class="f"><span>Ліміт неоплачених закупівель, грн</span><input name="unpaid_limit" inputmode="decimal" value="${esc(p?.unpaid_limit ?? '')}" placeholder="100000 (типово)"></label>
        </div>
        <div class="small muted">Відкрита закупівля — замовлення клієнтів без закупівлі; понад ліміт нові такі замовлення не приймаються, доки партнер не сформує рахунок.
          Неоплачені закупівлі — сума всіх неоплачених з передоплатою (разом із відкритою); понад ліміт нові закупівлі не приймаються.</div>
        <div class="grid2">
          <label class="f"><span>Відстрочка оплати, днів (0 — лише передоплата)</span><input name="postpay_days" type="number" min="0" max="180" value="${esc(p?.postpay_days || 0)}"></label>
          <label class="f"><span>Ліміт відстрочки, грн</span><input name="postpay_limit" inputmode="decimal" value="${esc(p?.postpay_limit ?? '')}" placeholder="без окремого ліміту"></label>
        </div>
        <div class="small muted">Відстрочка: партнер може обрати в закупівлі «оплата з відстрочкою» — товар відвантажується до оплати, строк — N днів від дати рахунку.
          Ліміт — скільки максимум може бути неоплачено за такими закупівлями. З простроченою оплатою нових закупівель з відстрочкою не буде; про строк нагадує бот.</div>
      </form>`, { footer: `<button class="btn" data-close>Скасувати</button><button class="btn primary" id="pSave">${isNew ? 'Створити' : 'Зберегти'}</button>` });
    $('#pSave', m.el).onclick = async () => {
      const f = $('#pF', m.el);
      const d = Object.fromEntries(new FormData(f));
      if (f.active) d.active = f.active.checked;
      try {
        if (isNew) {
          const r = await api('POST', '/api/b2b/partners', d);
          if (d.open_limit || d.unpaid_limit || Number(d.postpay_days) || d.postpay_limit) await api('PUT', `/api/b2b/partners/${r.id}`, { name: d.name, open_limit: d.open_limit, unpaid_limit: d.unpaid_limit, postpay_days: d.postpay_days, postpay_limit: d.postpay_limit });
          m.close(); location.hash = `#/b2bpartners/${r.id}`;
        }
        else { await api('PUT', `/api/b2b/partners/${p.id}`, d); m.close(); toast('Збережено'); viewPartner(p.id); }
      } catch (e) { toast(e.message, true); }
    };
  }

  async function viewPartner(id) {
    const { partner: p, users, brands, entities = [], roles = {}, limits, postpay, debt } = await api('GET', `/api/b2b/partners/${id}`);
    const byPartner = users.filter((u) => u.added_by_partner).length;
    main.innerHTML = `
      <div class="head-row"><h2>${esc(p.name)} ${p.active ? '' : '<span class="badge bad">вимкнений</span>'}${p.paused ? ' <span class="badge warn">⏸ пауза</span>' : ''}</h2>
        <div class="btn-row"><a class="btn" href="#/b2bpartners">← До списку</a><button class="btn" id="pEdit">Змінити</button><button class="btn" id="pPause">${p.paused ? '▶ Зняти паузу' : '⏸ Пауза'}</button>${people() ? '<button class="btn danger" id="pDel">Видалити</button>' : ''}</div></div>
      <div class="form-page">
        <div class="form-stack">
          <div class="card form-stack">
            <h3>Бренди й маржа</h3>
            <div class="muted small">Увімкніть бренди, які бачить партнер, і задайте маржу. Ціна партнера = РРЦ − маржа (з ПДВ, до копійок).
              Нова маржа діє на нові замовлення; партнер отримає повідомлення про зміну цін, коли ви натиснете «Надіслати зміни цін».</div>
            <table class="list"><thead><tr><th>Бренд</th><th class="r">Товарів з ціною</th><th>Бачить</th><th class="r">Маржа, %</th></tr></thead><tbody>
              ${brands.map((b) => `<tr>
                <td><b>${esc(b.name)}</b></td>
                <td class="r small">${b.priced}${b.products !== b.priced ? ` <span class="muted">з ${b.products}</span>` : ''}</td>
                <td><input type="checkbox" data-be="${b.id}" ${b.enabled ? 'checked' : ''} aria-label="Показувати бренд ${esc(b.name)}"></td>
                <td class="r"><input data-bm="${b.id}" inputmode="decimal" value="${b.margin != null ? String(b.margin).replace('.', ',') : ''}" placeholder="напр. 20" style="width:90px;text-align:right" ${b.enabled ? '' : 'disabled'} aria-label="Маржа для ${esc(b.name)}"></td>
              </tr>`).join('')}
            </tbody></table>
            ${brands.some((b) => b.enabled && !b.priced) ? `<div class="alert warn small">Для ввімкнених брендів ще немає цін — партнер бачить порожній каталог.
              Натисніть «Оновити ціни з LP-CRM». Якщо й після цього 0 — товарів бренду немає в аналітиці: додайте їх у «Каталог і ціни» → «+ Товари за ID».</div>` : ''}
            <div class="btn-row"><button class="btn primary" id="mSave">Зберегти бренди й маржу</button><button class="btn" id="mSync">Оновити ціни з LP-CRM</button></div>
          </div>
        </div>
        <div class="form-stack">
          ${debt ? `<div class="card form-stack">
            <h3>Заборгованість: ${money(debt.total)} грн${debt.overdue ? ` <span class="badge bad">прострочено ${money(debt.overdue)}</span>` : ''}</h3>
            ${debt.rows.length ? `<table class="list"><thead><tr><th>Закупівля</th><th class="r">Сума</th><th class="r">Оплачено</th><th class="r">Залишок</th><th>Строк</th></tr></thead><tbody>
              ${debt.rows.map((o) => `<tr class="click" data-dord="${o.id}"><td><b>${esc(o.number)}</b><div class="small muted">${o.invoice_no ? `рах. № ${esc(o.invoice_no)}` : ''}${o.invoice_date ? ` від ${esc(fmtDay(o.invoice_date))}` : ''}${o.pay_terms === 'postpay' ? ' · відстрочка' : ''}</div></td>
                <td class="r">${money(o.total)}</td><td class="r">${o.paid_amount ? money(o.paid_amount) : '—'}</td><td class="r"><b>${money(o.due)}</b></td>
                <td class="small nowrap">${o.due_date ? esc(fmtDay(o.due_date)) : 'передоплата'}${o.overdue ? `<div><span class="badge bad">прострочено ${o.overdue} дн.</span></div>` : ''}</td></tr>`).join('')}</tbody></table>`
              : '<div class="small muted">Неоплачених закупівель з рахунком немає.</div>'}
            ${debt.shipped?.length ? `<div><b>Відвантажено без рахунку: ${money(debt.shippedTotal)} грн</b></div>
              <table class="list"><thead><tr><th>Закупівля</th><th class="r">Замовлень у CRM</th><th class="r">Сума</th></tr></thead><tbody>
              ${debt.shipped.map((s) => `<tr class="click" data-dord="${s.id}"><td><b>${esc(s.number)}</b><div class="small muted">${s.open ? 'відкрита — рахунок ще не сформовано' : 'очікує рахунок'}</div></td>
                <td class="r">${s.orders}</td><td class="r"><b>${money(s.sum)}</b></td></tr>`).join('')}</tbody></table>` : ''}
            <div class="small muted">Борг = закупівлі з рахунком без повної оплати + замовлення клієнтів, уже передані в CRM, із закупівель, на які ще немає рахунку.</div>
          </div>` : ''}
          ${limits ? `<div class="card form-stack">
            <h3>Ліміти</h3>
            <div class="small">Відкрита закупівля${limits.openId ? ` <a href="#/b2borders/${limits.openId}">B2B-${limits.openId}</a>` : ''}: <b>${money(limits.openTotal)}</b> з ${money(limits.open)} грн</div>
            <div class="small">Неоплачені закупівлі: <b>${money(limits.unpaidTotal)}</b> з ${money(limits.unpaid)} грн</div>
            <div class="small">Відстрочка оплати: ${postpay?.days ? `<b>${postpay.days} дн.</b> · зараз за відстрочкою <b>${money(postpay.used)}</b>${postpay.limit != null ? ` з ${money(postpay.limit)} грн` : ' (без окремого ліміту)'}` : '<span class="muted">вимкнена (лише передоплата)</span>'}</div>
            <div class="small muted">Змінити — кнопка «Змінити» вгорі картки.</div>
          </div>` : ''}
          <div class="card form-stack">
            <h3>Контакти</h3>
            <div class="small">${esc([p.phone, p.email].filter(Boolean).join(' · ') || 'Не вказано')}</div>
            ${p.note ? `<div class="small muted">${esc(p.note)}</div>` : ''}
          </div>
          <div class="card form-stack">
            <div class="head-row" style="margin:0"><h3 style="margin:0">Користувачі партнера</h3>${people() ? '<button class="btn sm primary" id="uNew">+ Користувач</button>' : ''}</div>
            <div class="small muted">Усього: ${users.length}${byPartner ? ` · додав сам партнер: <b>${byPartner}</b>` : ''}. Керівник партнера може сам додавати колег у вкладці «Команда» свого кабінету.</div>
            ${users.length ? teamTable(users, { editable: people() })
              : '<div class="small muted">Ще немає. Додайте логін і пароль — передайте їх партнеру; увійти він зможе на цьому ж сайті.</div>'}
          </div>
          <div class="card form-stack">
            <h3>Telegram-група</h3>
            ${p.tg_group ? `<div>✅ Прив'язано: <b>${esc(p.tg_group_title || p.tg_group)}</b></div>
              <div class="small muted">Сюди бот надсилає закупівлі й замовлення клієнтів (на кого рахунок і накладна, товари, ціни), рахунки й накладні файлами, оплату.</div>
              <div class="btn-row"><button class="btn sm" id="tgGrp">Прив'язати іншу групу</button><button class="btn sm danger" id="tgUnlink">Відв'язати</button></div>`
              : `<div class="small muted">Прив'яжіть групу з партнером — бот дублюватиме туди закупівлі, рахунки й накладні (файлами) та оплату.</div>
              <div class="btn-row"><button class="btn sm primary" id="tgGrp">Прив'язати групу</button></div>`}
          </div>
          <div class="card form-stack">
            <h3>Юрособи партнера</h3>
            ${entities.length ? entities.map((e) => `<div class="small"><b>${esc(e.name)}</b> · ${e.code.length === 8 ? 'ЄДРПОУ' : 'ІПН'} ${esc(e.code)}${e.vat ? ' · ПДВ' : ''}${e.active ? '' : ' <span class="badge">прихована</span>'}</div>`).join('')
              : '<div class="small muted">Партнер ще не додав юросіб (додає сам у своєму кабінеті).</div>'}
            <a class="small" href="#/b2borders" data-pord="${p.id}">Замовлення партнера →</a>
            <a class="small" href="#/b2bstats/${p.id}">Аналітика партнера →</a>
          </div>
        </div>
      </div>`;
    $('#pEdit').onclick = () => partnerForm(p);
    $('#tgGrp').onclick = async () => {
      try {
        const { code, bot } = await api('POST', `/api/b2b/partners/${p.id}/tg-group`);
        const m = modal('Прив’язати Telegram-групу', `<ol class="form-stack" style="padding-left:18px;margin:0">
            <li>Відкрийте групу з партнером у Telegram → «Додати учасників» → знайдіть <b>@${esc(bot)}</b> і додайте.</li>
            <li>Надішліть у групі повідомлення (натисніть, щоб скопіювати):<br><code id="tgCmd" style="font-size:16px;cursor:pointer">/link ${esc(code)}</code></li>
            <li>Бот відповість «Групу прив’язано» — натисніть «Перевірити».</li></ol>
          <div class="small muted" style="margin-top:8px">Код діє 30 хвилин. Інші повідомлення в групі бот не читає.</div>`,
        { footer: '<button class="btn" data-close>Закрити</button><button class="btn primary" id="tgCheck">Перевірити</button>' });
        $('#tgCheck', m.el).onclick = () => { m.close(); viewPartner(p.id); };
        $('#tgCmd').onclick = async () => { try { await navigator.clipboard.writeText(`/link ${code}`); toast('Скопійовано'); } catch { /* */ } };
      } catch (e) { toast(e.message, true); }
    };
    $('#tgUnlink') && ($('#tgUnlink').onclick = async () => {
      if (!(await confirmDanger('Відв’язати Telegram-групу?', 'Бот перестане надсилати туди повідомлення й файли.', 'Відв’язати'))) return;
      try { await api('DELETE', `/api/b2b/partners/${p.id}/tg-group`); toast('Відв’язано'); viewPartner(p.id); } catch (e) { toast(e.message, true); }
    });
    $('[data-pord]').onclick = () => { ordFilter = { status: '', partner: String(p.id) }; };
    $$('[data-be]').forEach((cb) => (cb.onchange = () => {
      const inp = $(`[data-bm="${cb.dataset.be}"]`);
      inp.disabled = !cb.checked;
      if (cb.checked && !inp.value) inp.focus();
    }));
    $$('[data-dord]').forEach((tr) => (tr.onclick = () => { location.hash = `#/b2borders/${tr.dataset.dord}`; }));
    $('#mSave').onclick = async () => {
      const list = [];
      for (const cb of $$('[data-be]')) {
        if (!cb.checked) continue;
        const v = $(`[data-bm="${cb.dataset.be}"]`).value.trim().replace(',', '.');
        if (v === '' || !Number.isFinite(Number(v))) { toast('Вкажіть маржу для кожного ввімкненого бренду', true); return; }
        list.push({ brand_id: Number(cb.dataset.be), margin: Number(v) });
      }
      try {
        const r = await api('PUT', `/api/b2b/partners/${p.id}/margins`, list);
        toast(r.changed ? 'Бренди й маржу збережено' : 'Змін немає');
        // Нові бренди без цін — одразу підтягуємо товари й РРЦ з LP-CRM, щоб партнер побачив каталог.
        const enabled = new Set(list.map((x) => x.brand_id));
        if (brands.some((b) => enabled.has(b.id) && !b.priced)) await syncCatalog($('#mSync'), () => viewPartner(p.id));
        else viewPartner(p.id);
      } catch (e) { toast(e.message, true); }
    };
    $('#mSync').onclick = (e) => syncCatalog(e.currentTarget, () => viewPartner(p.id));
    const userForm = (u) => {
      const isNew = !u;
      const m = modal(isNew ? `Новий користувач — ${p.name}` : `Користувач ${u.login}`, teamFormHtml(u, roles, { defaultRole: users.length ? 'staff' : 'head' }),
        { footer: `<button class="btn" data-close>Скасувати</button><button class="btn primary" id="puSave">Зберегти</button>` });
      $('#puSave', m.el).onclick = async () => {
        const d = teamFormData($('#puF', m.el));
        try {
          if (isNew) await api('POST', `/api/b2b/partners/${p.id}/users`, d);
          else await api('PUT', `/api/b2b/partners/${p.id}/users/${u.id}`, d);
          m.close(); toast('Збережено'); viewPartner(p.id);
        } catch (e) { toast(e.message, true); }
      };
    };
    $('#uNew') && ($('#uNew').onclick = () => userForm(null));
    $('#pPause').onclick = () => {
      const save = async (body) => { try { await api('PUT', `/api/b2b/partners/${p.id}`, { name: p.name, ...body }); toast(body.paused ? 'Партнера поставлено на паузу' : 'Паузу знято'); viewPartner(p.id); } catch (e) { toast(e.message, true); } };
      if (p.paused) save({ paused: 0 });
      else pauseForm(1, (note) => save({ paused: 1, pause_note: note }));
    };
    $('#pDel') && ($('#pDel').onclick = async () => {
      if (!(await confirmDanger(`Видалити партнера «${p.name}»?`,
        `Усі його користувачі (${users.length}) втратять доступ, бренди й маржа видаляться. Якщо в партнера є замовлення — вони залишаться в списках закупівель і замовлень клієнтів (архів).`,
        'Видалити партнера'))) return;
      try { const r = await api('DELETE', `/api/b2b/partners/${p.id}`); toast(r.archived ? 'Партнера видалено, замовлення збережено' : 'Партнера видалено'); location.hash = '#/b2bpartners'; }
      catch (e) { toast(e.message, true); }
    });
    $$('[data-ue]').forEach((b) => (b.onclick = () => userForm(users.find((x) => String(x.id) === b.dataset.ue))));
  }

  // ---------------------------------------------------------------- розсилка змін цін
  // Перегляд: хто що отримає і куди (група партнера або його користувачі), потім «Надіслати».
  // Спершу — свіжі РРЦ з LP-CRM: у Telegram іде рівно те, що одразу бачить партнер у кабінеті (ціни з одного каталогу).
  async function sendPrices(only = null) {
    const wait = modal('Надіслати зміни цін партнерам', '<div class="form-stack"><div><span class="spinner"></span> <span id="spProg">Підтягую актуальні РРЦ з LP-CRM…</span></div></div>', { footer: '' });
    let items;
    try { items = await crmRefresh((n, left) => { const el = $('#spProg', wait.el); if (el) el.textContent = `Підтягую актуальні РРЦ з LP-CRM… ${n}${left ? ` / ${n + left}` : ''}`; }); }
    catch (e) { wait.close(); toast(`Не вдалося оновити ціни з LP-CRM — розсилку не відкрито: ${e.message}`, true); return; }
    wait.close();
    await priceModal({ items, only });
  }

  // Вікно: які РРЦ щойно змінилися + розсилка партнерам (за замовчуванням — усі, кому є що надіслати; можна зняти).
  // quiet — нічого не показувати, якщо немає ні змін РРЦ, ні неразісланих змін. Повертає true, якщо вікно відкрито.
  async function priceModal({ items = [], only = null, quiet = false }) {
    const rows = await api('GET', '/api/b2b/price-changes');
    const withCh = rows.filter((r) => !r.empty);
    if (quiet && !items.length && !withCh.length) return false;
    const reach = (r) => r.group || r.tgUsers;
    const dest = (r) => (r.group ? `група «${esc(r.group)}»` : r.tgUsers ? `особисто: ${r.tgUsers} корист.` : '<span class="badge bad">нікому — немає Telegram</span>');
    const pct = (o, n) => (o > 0 ? `${n > o ? '+' : ''}${String(Math.round(((n - o) / o) * 1000) / 10).replace('.', ',')}%` : '');
    const list = [...items].sort((a, b) => a.brand.localeCompare(b.brand, 'uk') || a.name.localeCompare(b.name, 'uk'));
    const m = modal('Зміни цін', `<div class="form-stack">
        ${list.length ? `<div><h3 style="margin:0 0 6px">Змінились РРЦ у LP-CRM: ${list.length}</h3>
          <div class="table-wrap" style="max-height:280px;overflow:auto"><table class="list"><thead><tr><th>Товар</th><th class="hide-m">Бренд</th><th class="r">Було</th><th class="r">Стало</th><th class="r"></th></tr></thead><tbody>
          ${list.map((x) => `<tr><td>${esc(x.name)}<div class="small muted">ID ${x.id}</div></td><td class="hide-m small">${esc(x.brand)}</td><td class="r nowrap">${money(x.old)}</td>
            <td class="r nowrap"><b>${money(x.now)}</b></td><td class="r nowrap small" style="color:var(${x.now > x.old ? '--bad' : '--ok'})">${x.now > x.old ? '▲' : '▼'} ${pct(x.old, x.now)}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="small muted">Нові РРЦ уже в каталозі — партнери бачать нові ціни в кабінеті.</div></div>`
        : '<div class="small muted">РРЦ у LP-CRM не змінились. Нижче — неразіслані зміни знижок і брендів.</div>'}
        <h3 style="margin:6px 0 0">Розсилка партнерам</h3>
        ${withCh.length ? `<div class="small muted">Кожен отримає лише свої бренди й ціни: зміни з його минулої розсилки.</div>
          <label class="check"><input type="checkbox" id="ppAll"> <b>Усі</b></label>
          ${withCh.map((r) => `<div class="card form-stack" style="padding:8px 12px">
            <label class="check"><input type="checkbox" data-pp="${r.id}" ${!reach(r) ? 'disabled' : !only || only.includes(r.id) ? 'checked' : ''}> <b>${esc(r.name)}</b> — товарів: ${r.products}${r.brands ? `, брендів: ${r.brands}` : ''} → ${dest(r)}</label>
            <details><summary class="small">Переглянути повідомлення</summary>${r.preview.map((t) => `<pre class="small" style="white-space:pre-wrap;margin:6px 0">${t}</pre>`).join('')}</details>
          </div>`).join('')}
          ${rows.length > withCh.length ? `<div class="small muted">Не стосується (немає змін у їхніх брендах): ${rows.filter((r) => r.empty).map((r) => esc(r.name)).join(', ')}</div>` : ''}`
        : '<div class="small">Розсилати нічого: змінені товари не входять у бренди партнерів або все вже розіслано.</div>'}
      </div>`,
    { wide: true, footer: `<button class="btn" data-close>${withCh.length ? 'Не надсилати' : 'Закрити'}</button>${withCh.length ? '<button class="btn primary" id="ppSend">Надіслати</button>' : ''}` });
    const boxes = () => $$('[data-pp]', m.el).filter((x) => !x.disabled);
    const syncAll = () => { const all = $('#ppAll', m.el); if (all) all.checked = boxes().length > 0 && boxes().every((x) => x.checked); };
    $('#ppAll', m.el) && ($('#ppAll', m.el).onchange = (e) => boxes().forEach((x) => { x.checked = e.target.checked; }));
    boxes().forEach((x) => (x.onchange = syncAll));
    syncAll();
    $('#ppSend', m.el) && ($('#ppSend', m.el).onclick = async (e) => {
      const ids = boxes().filter((x) => x.checked).map((x) => Number(x.dataset.pp));
      if (!ids.length) { toast('Оберіть партнерів', true); return; }
      e.currentTarget.disabled = true;
      try {
        const { results } = await api('POST', '/api/b2b/price-changes/send', { partner_ids: ids });
        const ok = results.filter((r) => r.sent).length;
        toast(`Надіслано: ${ok} з ${results.length}`, ok < results.length);
        m.close();
      } catch (er) { toast(er.message, true); e.target.closest('button').disabled = false; }
    });
    return true;
  }

  // ---------------------------------------------------------------- оголошення партнерам
  // Довільний текст обраним партнерам: у їхні Telegram-групи та/або особисто в бот.
  async function announce(only = null) {
    const rows = await api('GET', '/api/b2b/announce/targets');
    const on = (id) => !only || only.includes(id);
    if (!rows.length) { toast('Немає активних партнерів', true); return; }
    const m = modal('Оголошення партнерам', `<div class="form-stack">
        <label class="f"><span>Текст</span><textarea id="anText" rows="6" maxlength="3500" placeholder="Напр.: з 1 листопада знижка 5% на бренд …"></textarea></label>
        <div class="small muted"><span id="anLen">0</span> / 3500 · надійде з позначкою 📢</div>
        <div class="f"><span>Куди надсилати</span>
          <label class="check"><input type="checkbox" id="anGroups" checked> У Telegram-групи партнерів</label>
          <label class="check"><input type="checkbox" id="anUsers"> Особисто в бот (користувачам партнера)</label></div>
        <div class="f"><span>Партнери</span>
          <label class="check"><input type="checkbox" id="anAll" ${rows.every((r) => on(r.id)) ? 'checked' : ''}> <b>Усі</b></label>
          ${rows.map((r) => `<label class="check"><input type="checkbox" data-an="${r.id}" ${on(r.id) ? 'checked' : ''}> ${esc(r.name)} <span class="small muted">— ${r.group ? `група «${esc(r.group)}»` : 'групу не прив’язано'} · у боті: ${r.tgUsers}</span></label>`).join('')}</div>
        <div class="small" id="anInfo"></div>
      </div>`,
    { wide: true, footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="anSend">Надіслати</button>' });
    const boxes = () => $$('[data-an]', m.el);
    const chosen = () => rows.filter((r) => boxes().some((x) => x.checked && Number(x.dataset.an) === r.id));
    const info = () => {
      const g = $('#anGroups', m.el).checked;
      const u = $('#anUsers', m.el).checked;
      const list = chosen();
      const none = list.filter((r) => !(g && r.group) && !(u && r.tgUsers));
      $('#anInfo', m.el).innerHTML = `Обрано: ${list.length} · груп: ${g ? list.filter((r) => r.group).length : 0} · людей у боті: ${u ? list.reduce((t, r) => t + r.tgUsers, 0) : 0}`
        + (none.length ? `<div class="muted">Не отримають (немає куди): ${none.map((r) => esc(r.name)).join(', ')}</div>` : '');
      $('#anLen', m.el).textContent = $('#anText', m.el).value.length;
    };
    $('#anAll', m.el).onchange = (e) => { boxes().forEach((x) => (x.checked = e.target.checked)); info(); };
    boxes().forEach((x) => (x.onchange = () => { $('#anAll', m.el).checked = boxes().every((y) => y.checked); info(); }));
    ['#anGroups', '#anUsers'].forEach((sel) => ($(sel, m.el).onchange = info));
    $('#anText', m.el).oninput = info;
    info();
    $('#anSend', m.el).onclick = async (e) => {
      const text = $('#anText', m.el).value.trim();
      const groups = $('#anGroups', m.el).checked;
      const users = $('#anUsers', m.el).checked;
      const list = chosen().filter((r) => (groups && r.group) || (users && r.tgUsers));
      if (!text) { toast('Напишіть текст оголошення', true); return; }
      if (!groups && !users) { toast('Оберіть, куди надсилати', true); return; }
      if (!list.length) { toast('Нікому надсилати — у обраних партнерів немає ні групи, ні бота', true); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      let ok = 0;
      const failed = [];
      for (const [i, r] of list.entries()) {
        btn.innerHTML = `<span class="spinner"></span> ${i + 1} / ${list.length}`;
        try { const x = await api('POST', '/api/b2b/announce', { partner_id: r.id, text, groups, users }); if (x.group || x.users) ok++; else failed.push(r.name); }
        catch { failed.push(r.name); }
      }
      toast(`Надіслано партнерам: ${ok} з ${list.length}${failed.length ? ` · не вдалося: ${failed.join(', ')}` : ''}`, failed.length > 0);
      m.close();
    };
  }

  // ---------------------------------------------------------------- каталог
  let catFilter = { brand: '', q: '' };
  // Перечитати з LP-CRM усі товари каталогу (навіть якщо сьогодні вже оновлювали); повертає кількість змінених РРЦ.
  async function crmRefresh(progress = () => {}) {
    const run = new Date().toISOString();
    const items = [];
    let done = 0;
    for (let i = 0; i < 100; i++) {
      const r = await api('POST', '/api/b2b/catalog/sync', { run });
      items.push(...(r.items || []));
      done += r.checked || 0;
      progress(done, r.left || 0);
      if (!r.left || !r.checked) break;
    }
    items.checked = done;
    return items;
  }
  // «Оновити з LP-CRM»: якщо РРЦ змінилися (або є неразіслані зміни знижок) — одразу вікно зі списком і розсилкою.
  async function syncCatalog(btn, done = viewCatalog) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Оновлюю з LP-CRM…';
    try {
      const items = await crmRefresh((n, left) => { btn.innerHTML = `<span class="spinner"></span> Оновлюю з LP-CRM… ${n}${left ? ` / ${n + left}` : ''}`; });
      btn.disabled = false;
      done();
      if (!(await priceModal({ items, quiet: true }))) {
        modal('Оновлення з LP-CRM', `<div class="form-stack"><div style="font-size:16px"><b>✅ Змін цін не було</b></div>
          <div class="small muted">Перевірено товарів: ${items.checked || 0}. РРЦ у LP-CRM ті самі, що й у каталозі; розсилати партнерам нічого.</div></div>`,
        { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
      }
      return;
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
    done();
  }

  async function viewCatalog() {
    const qs = new URLSearchParams(Object.entries(catFilter).filter(([, v]) => v !== '')).toString();
    const [{ rows, state }, brands] = await Promise.all([api('GET', `/api/b2b/catalog${qs ? `?${qs}` : ''}`), api('GET', '/api/b2b/brands')]);
    main.innerHTML = `
      <div class="head-row"><h2>Каталог і ціни</h2><div class="btn-row"><button class="btn" id="cAdd">+ Товари за ID</button><button class="btn" id="cSend">Надіслати зміни цін</button><button class="btn" id="cAnn">📢 Оголошення</button><button class="btn primary" id="cSync">Оновити з LP-CRM</button></div></div>
      <div class="alert info help" style="margin-bottom:14px">Товари — з аналітики (усе, що продавалося) і додані вручну за ID з LP-CRM. Назва, РРЦ і фото оновлюються з LP-CRM
        для брендів, увімкнених хоча б одному партнеру. ${state.lastSync ? `Останнє оновлення: ${esc(fmtDateTime(state.lastSync))}.` : 'Ще не оновлювався.'}
        ${state.stale ? `<b>Чекають оновлення: ${state.stale}.</b>` : ''}</div>
      <div class="btn-row" style="margin-bottom:12px">
        <select id="cBrand" aria-label="Бренд"><option value="">Усі бренди</option>${brands.map((b) => `<option value="${b.id}" ${String(catFilter.brand) === String(b.id) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <input id="cQ" placeholder="Назва або ID товару" value="${esc(catFilter.q)}" style="max-width:260px">
      </div>
      ${rows.length ? `<table class="list"><thead><tr><th></th><th>Товар</th><th class="hide-m">Бренд</th><th class="r">РРЦ</th><th>Показувати</th></tr></thead><tbody>
        ${rows.map((r) => `<tr>
          <td style="width:48px">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" style="width:40px;height:40px;object-fit:contain">` : ''}</td>
          <td><b>${esc(r.name || `Товар ${r.product_id}`)}</b><div class="small muted">ID ${r.product_id}${r.article ? ` · ${esc(r.article)}` : ''}${r.manual ? ' · додано вручну' : ''}</div></td>
          <td class="small hide-m">${esc(r.brand)}</td>
          <td class="r">${r.rrp > 0 ? `${money(r.rrp)} грн` : '<span class="muted small">немає</span>'}</td>
          <td><input type="checkbox" data-vis="${r.product_id}" ${r.hidden ? '' : 'checked'} aria-label="Показувати партнерам"></td>
        </tr>`).join('')}</tbody></table>${rows.length >= 500 ? '<div class="small muted">Показано перші 500 — уточніть пошук.</div>' : ''}`
        : '<div class="card empty"><div class="big">Товарів не знайдено</div>Каталог наповнюється з аналітики. Спершу оновіть аналітику або додайте товари за ID.</div>'}`;
    $('#cBrand').onchange = (e) => { catFilter.brand = e.target.value; viewCatalog(); };
    let t;
    $('#cQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { catFilter.q = e.target.value.trim(); viewCatalog(); }, 400); };
    $('#cSync').onclick = (e) => syncCatalog(e.currentTarget);
    $('#cSend').onclick = () => sendPrices();
    $('#cAnn').onclick = () => announce();
    $$('[data-vis]').forEach((cb) => (cb.onchange = async () => {
      try { await api('PUT', `/api/b2b/catalog/${cb.dataset.vis}`, { hidden: !cb.checked }); toast(cb.checked ? 'Товар показується партнерам' : 'Товар приховано від партнерів'); }
      catch (e) { toast(e.message, true); cb.checked = !cb.checked; }
    }));
    $('#cAdd').onclick = () => {
      const m = modal('Додати товари за ID з LP-CRM', `<label class="f"><span>ID товарів через кому</span><textarea id="cIds" rows="3" placeholder="965, 452, 701"></textarea></label>
        <div class="small muted">Після додавання натисніть «Оновити з LP-CRM» — підтягнуться назва, РРЦ і фото. Бренд визначиться автоматично, коли товар з’явиться в аналітиці.</div>`,
      { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="cIdsSave">Додати</button>' });
      $('#cIdsSave', m.el).onclick = async () => {
        try { const r = await api('POST', '/api/b2b/catalog/add', { ids: $('#cIds', m.el).value }); m.close(); toast(`Додано: ${r.added}`); viewCatalog(); }
        catch (e) { toast(e.message, true); }
      };
    };
  }

  // ---------------------------------------------------------------- замовлення партнерів (бухгалтер)
  let ordFilter = { status: '', partner: '', q: '', from: '', to: '' };
  async function viewOrders(id) {
    if (id === 'new') return viewAdminSupplyForm(ordFilter.partner);
    if (id) return viewOrder(id);
    const qs = filterQs(ordFilter);
    const [{ rows, statuses, counts }, partners] = await Promise.all([api('GET', `/api/b2b/orders${qs ? `?${qs}` : ''}`), api('GET', '/api/b2b/partners')]);
    main.innerHTML = `
      <div class="head-row"><h2>Закупівлі партнерів</h2><div class="btn-row"><button class="btn" id="finGroup">Група «Фінансові питання»</button><a class="btn primary" href="#/b2borders/new">+ Закупівля для партнера</a></div></div>
      <div class="btn-row" style="margin-bottom:12px;flex-wrap:wrap">
        <button class="chip ${ordFilter.status ? '' : 'on'}" data-st="">Усі</button>
        ${Object.entries(statuses).map(([k, v]) => `<button class="chip ${ordFilter.status === k ? 'on' : ''}" data-st="${k}">${esc(v)}${counts[k] ? ` · ${counts[k]}` : ''}</button>`).join('')}
        <select id="oPartner" aria-label="Партнер"><option value="">Усі партнери</option>${partners.map((p) => `<option value="${p.id}" ${String(ordFilter.partner) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </div>
      ${filterBar(ordFilter, { placeholder: '№, юрособа, № рахунку чи накладної…' })}
      ${bulkBar()}
      ${rows.length ? `<table class="list"><thead><tr>${selHead()}<th>№</th><th>Партнер</th><th class="hide-m">Дата</th><th class="r">Сума</th><th>Статус</th><th class="hide-m">Рахунок</th></tr></thead><tbody>
        ${rows.map((o) => `<tr class="click" data-o="${o.id}">
          ${selCell(o.id)}
          <td><b>${esc(o.number)}</b>${o.delivery === 'pickup' ? '<div><span class="badge info">🚗 самовивіз</span></div>' : o.delivery === 'warehouse' ? `<div><span class="badge info">🏬 на склад${o.crm_id || o.crm_ext ? ' · в LP-CRM' : ''}</span></div>` : ''}</td>
          <td>${esc(o.partner)}<div class="small muted">${esc(o.status === 'confirm' ? 'юрособу обере партнер' : o.entity.split('\n')[0].split(',')[0])}</div></td>
          <td class="small hide-m">${esc(fmtDateTime(o.created_at))}</td>
          <td class="r"><b>${uah(o.total)}</b></td>
          <td>${statusBadge(o)}</td>
          <td class="small hide-m">${o.invoice_no ? `№ ${esc(o.invoice_no)}` : '—'}${o.files ? ` · 📎 ${o.files}` : ''}</td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="card empty"><div class="big">Замовлень немає</div>${qs ? 'За цими фільтрами нічого не знайдено.' : 'Тут з’являться закупівлі, які оформлюють партнери.'}</div>`}`;
    wireFilterBar(ordFilter, () => viewOrders());
    $('#finGroup').onclick = () => groupModal('fin');
    const setSt = (status) => (id) => api('POST', `/api/b2b/orders/${id}/status`, { status });
    wireBulk([
      { key: 'paid', label: 'Оплачено', run: setSt('paid') },
      { key: 'done', label: 'Завершено', run: setSt('done') },
      { key: 'cancelled', label: 'Скасувати', danger: true, confirm: (n) => `Скасувати ${n} закупівель?`, run: setSt('cancelled') },
      { key: 'del', label: 'Видалити в кошик', danger: true, confirm: (n) => `Перенести ${n} закупівель у кошик?`, run: (id) => api('DELETE', `/api/b2b/orders/${id}`) },
    ], { onDone: () => viewOrders(), confirmDanger });
    $$('[data-st]').forEach((b) => (b.onclick = () => { ordFilter.status = b.dataset.st; viewOrders(); }));
    $('#oPartner').onchange = (e) => { ordFilter.partner = e.target.value; viewOrders(); };
    $$('[data-o]').forEach((tr) => (tr.onclick = () => { location.hash = `#/b2borders/${tr.dataset.o}`; }));
  }

  async function viewOrder(id) {
    const d = await api('GET', `/api/b2b/orders/${id}`);
    if (d.order.kind === 'client') { location.hash = `#/b2bclients/${id}`; return; }
    const { order: o, items, files, history, partner, clients = [] } = d;
    const closed = o.status === 'cancelled';
    main.innerHTML = `
      <div class="head-row"><h2>${esc(o.number)} · ${esc(partner?.name || '')} ${statusBadge(o)}</h2><div class="btn-row"><a class="btn" href="#/b2borders">← До списку</a>${o.status === 'draft' ? '<button class="btn primary" id="oSendDraft">Відправити закупівлю</button>' : ''}${o.status === 'open' ? '<button class="btn primary" id="oForm">🧾 Сформувати закупівлю</button>' : ''}${closed ? '' : '<button class="btn" id="oEdit">✏️ Змінити</button>'}<button class="btn danger" id="oDel">Видалити</button></div></div>
      ${o.reinvoice ? `<div class="alert warn" style="margin-bottom:12px"><b>Закупівлю змінено після рахунку</b> — потрібно переробити рахунок № ${esc(o.reinvoice)}. Запит надіслано в «Фінансові питання»; новий рахунок замінить старий файл і піде в групу партнера.${o.paid_amount ? ` Уже оплачено: ${uah(o.paid_amount)}.` : ''}</div>` : ''}
      ${o.status === 'open' ? '<div class="alert info" style="margin-bottom:12px"><b>Відкрита закупівля</b> — сюди автоматично складаються замовлення клієнтів партнера без закупівлі. Сформуйте її («🧾 Сформувати закупівлю»): оберіть юрособу партнера й оплату — вона стане звичайною закупівлею «Очікує рахунок», а наступні замовлення без закупівлі підуть у нову відкриту.</div>' : ''}
      ${o.status === 'confirm' ? '<div class="alert warn" style="margin-bottom:12px"><b>Чекає підтвердження партнера</b> — закупівлю створили ми; партнер отримав її в кабінеті й у Telegram. Після підтвердження він обере юрособу, і в «Фінансові питання» піде запит рахунку. Склад ще можна змінити («✏️ Змінити»).</div>' : ''}
      ${o.status === 'draft' ? '<div class="alert warn" style="margin-bottom:12px"><b>Чернетка партнера</b> — команда партнера ще збирає товари. Відправити її (як від партнера) може керівник партнера або ви.</div>' : ''}
      <div class="form-page">
        <div class="form-stack">
          <div class="card">${itemsTable(items, { rrp: true })}</div>
          ${o.comment ? `<div class="card small"><b>Коментар:</b> ${esc(o.comment)}</div>` : ''}
          ${o.delivery === 'warehouse' && !closed ? `<div class="card form-stack"><h3>🏬 Відправка на склад партнера</h3>
            ${o.crm_id || o.crm_ext ? `<div>Передано в LP-CRM${o.crm_id ? `: № <b>${esc(o.crm_id)}</b>` : ''}${o.crm_sent_at && !String(o.crm_sent_at).startsWith('sending') ? ` · ${esc(fmtDateTime(o.crm_sent_at))}` : ''}</div>`
              : o.status === 'confirm' ? '<div class="small muted">Передати в LP-CRM можна після підтвердження партнером.</div>'
                : `<div class="small">Уся закупівля піде одним замовленням у LP-CRM («Нові»), отримувач — склад партнера, ціни — партнера.</div><div class="btn-row"><button class="btn primary" id="oCrm">🚚 Додати в LP-CRM на відправку</button></div>`}
          </div>` : ''}
          <div class="card form-stack">
            <h3>Платник (юрособа партнера)</h3>
            <div class="small" style="white-space:pre-line" id="oEnt">${esc(o.entity || (o.status === 'confirm' ? 'Партнер обере юрособу при підтвердженні.' : '—'))}</div>
            ${closed || o.status === 'open' || o.crm_id || o.crm_ext ? `<div class="small"><b>Отримання:</b> ${esc(o.delivery_name || '')}</div>` : `<label class="f"><span>Отримання</span>
              <select id="oDeliv">${[['np', 'Відправка клієнтам (Нова пошта)'], ['pickup', '🚗 Самовивіз — партнер забирає всю закупівлю'], ['warehouse', '🏬 На склад партнера (уся закупівля — Новою поштою)']].map(([k, v]) => `<option value="${k}" ${o.delivery === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`}
            ${o.delivery === 'warehouse' && o.ship_to ? `<div class="small"><b>Склад партнера:</b> ${esc([o.ship_to.name, phoneFmt(o.ship_to.phone), o.ship_to.address].filter(Boolean).join(', '))}${closed || o.crm_id || o.crm_ext ? '' : ' <button type="button" class="btn sm" id="oShipEd">Змінити</button>'}</div>` : ''}
            <div class="btn-row"><button class="btn sm" id="oCopy">Скопіювати реквізити</button></div>
          </div>
          ${clients.length ? `<div class="card form-stack"><h3>Замовлення клієнтів із цієї закупівлі</h3>
            ${clients.map((x) => `<a class="small" href="#/b2bclients/${x.id}">${esc(x.number)} · ${esc(x.client_name)} · ${uah(x.total)} · ${esc(x.status_name)}</a>`).join('')}
            <table class="list"><thead><tr><th>Товар</th><th class="r">Закуплено</th><th class="r">Розписано</th><th class="r">Залишок</th></tr></thead><tbody>
              ${d.left.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${r.qty}</td><td class="r">${r.used}</td><td class="r"><b>${r.left}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
        </div>
        <div class="form-stack">
          <form class="card form-stack" id="oAcc">
            <h3>Рахунок і накладна</h3>
            <div class="grid2"><label class="f"><span>№ рахунку</span><input name="invoice_no" value="${esc(o.invoice_no)}" ${closed ? 'disabled' : ''}></label>
              <label class="f"><span>Дата рахунку</span><input name="invoice_date" type="date" value="${esc(o.invoice_date)}" ${closed ? 'disabled' : ''}></label></div>
            <label class="f"><span>№ накладної</span><input name="waybill_no" value="${esc(o.waybill_no)}" ${closed ? 'disabled' : ''}></label>
            ${closed ? '' : '<div class="btn-row"><button class="btn primary">Зберегти</button></div><div class="small muted">Після збереження номера рахунку статус стає «Очікує оплату», а партнер отримує сповіщення.</div>'}
          </form>
          <div class="card form-stack">
            <h3>Файли</h3>
            ${files.length ? files.map((f) => `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <a class="btn sm" href="/api/b2b/files/${f.id}" target="_blank" rel="noopener">📎 ${esc(f.kind_name)}: ${esc(f.name)}</a>
              <span class="small muted">${fileSize(f.size)} · ${esc(fmtDateTime(f.created_at))}</span>
              <button class="btn sm danger" data-fdel="${f.id}" aria-label="Видалити файл">✕</button></div>`).join('') : '<div class="small muted">Файлів ще немає.</div>'}
            ${closed ? '' : `<div class="btn-row">
              <label class="btn sm">+ Рахунок (файл)<input type="file" data-up="invoice" hidden></label>
              <label class="btn sm">+ Накладна (файл)<input type="file" data-up="waybill" hidden></label></div>
              <div class="small muted">PDF, Word, Excel або фото до 5 МБ. Файли зберігаються 30 днів; партнер бачить і може завантажити їх.</div>`}
          </div>
          <div class="card form-stack">
            <h3>Статус</h3>
            <div class="btn-row" style="flex-wrap:wrap">
              ${['pay_wait', 'partial'].includes(o.status) ? '<button class="btn primary" data-set="paid">Оплачено (вручну)</button>' : ''}
              ${o.status === 'partial' ? '<button class="btn" data-set="pay_wait">Зняти часткову оплату</button>' : ''}
              ${['paid'].includes(o.status) ? '<button class="btn primary" data-set="done">Завершено</button><button class="btn" data-set="pay_wait">Скасувати «Оплачено»</button>' : ''}
              ${['pay_wait', 'partial', 'paid', 'done'].includes(o.status) ? '<button class="btn" id="oCheckPay">Перевірити оплату (Opendatabot)</button>' : ''}
              ${o.status === 'done' ? '<button class="btn" data-set="paid">Повернути «Оплачено»</button>' : ''}
              ${closed ? '' : '<button class="btn danger" data-set="cancelled">Скасувати замовлення</button>'}
            </div>
            ${o.status === 'partial' ? `<div class="alert info small">Отримано ${uah(o.paid_amount)} з ${uah(o.total)} — <b>ще до оплати ${uah(o.due)}</b></div>` : ''}
            ${o.pay_terms === 'postpay' ? `<div class="small">⏳ <b>Відстрочка оплати ${o.pay_days} дн.</b>${o.due_date ? ` — оплатити до <b>${esc(fmtDay(o.due_date))}</b>` : ' — строк рахується від дати рахунку'}${o.overdue ? ` <span class="badge bad">прострочено ${o.overdue} дн.</span>` : ''}</div>` : ''}
            ${o.paid_at ? `<div class="small">Оплата: ${esc(fmtDateTime(o.paid_at))}${o.paid_by && o.paid_by !== 'Opendatabot' ? ` · позначив(ла) ${esc(o.paid_by)}` : ' · Opendatabot'}</div>` : ''}
          </div>
          ${['pay_wait', 'partial', 'paid', 'done'].includes(o.status) ? '<div class="card form-stack" id="oPays"><h3>Платежі (Opendatabot)</h3><div class="small muted">Завантаження…</div></div>' : ''}
          ${historyCard(history)}
        </div>
      </div>`;
    $('#oCopy').onclick = async () => { try { await navigator.clipboard.writeText(o.entity); toast('Реквізити скопійовано'); } catch { toast('Не вдалося скопіювати', true); } };
    $('#oAcc').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('PUT', `/api/b2b/orders/${o.id}`, Object.fromEntries(new FormData(e.target))); toast('Збережено'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
    };
    $$('[data-up]').forEach((inp) => (inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      try { const r = await uploadFile(`/api/b2b/orders/${o.id}/files?kind=${inp.dataset.up}`, file); toast(r.toGroup ? 'Файл додано й надіслано в Telegram-групу партнера' : 'Файл додано'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
    }));
    $('#oDel').onclick = async () => {
      if (!(await confirmDanger(`Видалити закупівлю ${o.number}?`, 'Закупівля піде в «Кошик» (видно, хто видалив; можна відновити). Партнер побачить її в своєму кошику.', 'Видалити закупівлю'))) return;
      try { await api('DELETE', `/api/b2b/orders/${o.id}`); toast('Закупівлю перенесено в кошик'); location.hash = '#/b2borders'; } catch (er) { toast(er.message, true); }
    };
    $('#oEdit') && ($('#oEdit').onclick = () => (o.status === 'open'
      ? modal('Відкрита закупівля', '<div class="small">Відкрита закупівля складається із замовлень клієнтів без закупівлі. Змініть або видаліть ці замовлення (список — у картці «Замовлення клієнтів із цієї закупівлі»), і закупівля перерахується сама.</div>', { footer: '<button class="btn primary" data-close>Зрозуміло</button>' })
      : editSupply(o, items)));
    $$('[data-fdel]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmDanger('Видалити файл?', 'Партнер більше не зможе його завантажити.', 'Видалити'))) return;
      try { await api('DELETE', `/api/b2b/files/${b.dataset.fdel}`); toast('Видалено'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
    }));
    if ($('#oPays')) loadPays(o);
    if ($('#oForm')) $('#oForm').onclick = async () => {
      let opt;
      try { opt = await api('GET', `/api/b2b/orders/${o.id}/edit-options`); } catch (er) { toast(er.message, true); return; }
      if (!opt.entities.length) {
        modal('Немає юросіб партнера', `<div class="small">У «${esc(partner?.name || '')}» ще немає жодної юрособи — рахунок нема на кого виставити. Попросіть партнера додати юрособу в кабінеті («Мої юрособи»), тоді сформуйте закупівлю.</div>`, { footer: '<button class="btn primary" data-close>Зрозуміло</button>' });
        return;
      }
      const m = modal(`Сформувати ${o.number}`, `<form id="fmF" class="form-stack">
          <div class="small">${items.length} поз. на <b>${uah(o.total)}</b> — із замовлень клієнтів без закупівлі.</div>
          <label class="f"><span>Юрособа партнера (на неї рахунок)</span><select name="entity_id">${opt.entities.map((e) => `<option value="${e.id}" ${e.id === opt.default_entity ? 'selected' : ''}>${esc(e.name)} · ${esc(e.code)}</option>`).join('')}</select></label>
          <label class="check"><input type="radio" name="pay_terms" value="prepay" checked> Передоплата</label>
          <label class="check"><input type="radio" name="pay_terms" value="postpay"> Відстрочка оплати</label>
          <label class="f" id="fmDays" hidden><span>Днів від дати рахунку</span><input name="pay_days" type="number" min="1" max="90" value="${opt.postpay_days || 14}" style="max-width:120px"></label>
          <label class="f"><span>Коментар</span><textarea name="comment" rows="2" maxlength="1000">${esc(o.comment || '')}</textarea></label>
          <div class="small muted">Закупівля стане «Очікує рахунок»: партнеру — сповіщення (особисто й у групу), у «Фінансові питання» — запит рахунку.</div>
        </form>`, { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="fmOk">Сформувати закупівлю</button>' });
      $$('[name=pay_terms]', m.el).forEach((r) => (r.onchange = () => { $('#fmDays', m.el).hidden = r.value !== 'postpay' || !r.checked; }));
      $('#fmOk', m.el).onclick = async (e) => {
        e.currentTarget.disabled = true;
        try { const r = await api('POST', `/api/b2b/orders/${o.id}/form`, Object.fromEntries(new FormData($('#fmF', m.el)))); m.close(); toast(`Закупівлю ${r.number} сформовано — чекає рахунок`); viewOrder(o.id); }
        catch (er) { toast(er.message, true); e.target.closest('button').disabled = false; }
      };
    };
    if ($('#oSendDraft')) $('#oSendDraft').onclick = async () => {
      if (!(await confirmDanger(`Відправити чернетку ${o.number}?`, 'Вона стане закупівлею «Очікує рахунок»: прийдуть сповіщення, у «Фінансових питаннях» — запит рахунку.', 'Відправити закупівлю'))) return;
      try { await api('POST', `/api/b2b/orders/${o.id}/send`); toast('Закупівлю відправлено'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
    };
    // Склад партнера (отримувач, телефон, відділення) — для «на склад партнера».
    const shipForm = (cur) => new Promise((resolve) => {
      const m = modal('Склад партнера', `<form id="shF" class="form-stack">
          <label class="f"><span>Отримувач (ПІБ)</span><input name="name" value="${esc(cur?.name || '')}" required></label>
          <label class="f"><span>Телефон</span><input name="phone" value="${esc(cur?.phone || '')}" inputmode="tel" required></label>
          <label class="f"><span>Місто й відділення Нової пошти</span><input name="address" value="${esc(cur?.address || '')}" required></label></form>`,
      { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="shOk">Зберегти склад</button>' });
      let done = false;
      $('#shOk', m.el).onclick = () => { done = true; const d = Object.fromEntries(new FormData($('#shF', m.el))); m.close(); resolve(d); };
      new MutationObserver((_, obs) => { if (!document.contains(m.el)) { obs.disconnect(); if (!done) resolve(null); } }).observe(document.body, { childList: true });
    });
    const setDelivery = async (delivery, ship_to) => {
      try { await api('POST', `/api/b2b/orders/${o.id}/delivery`, { delivery, ship_to }); toast('Спосіб отримання змінено — партнеру надіслано повідомлення'); viewOrder(o.id); }
      catch (er) { toast(er.message, true); if ($('#oDeliv')) $('#oDeliv').value = o.delivery; }
    };
    if ($('#oDeliv')) $('#oDeliv').onchange = async (e) => {
      if (e.target.value !== 'warehouse') return setDelivery(e.target.value);
      const opts = await api('GET', `/api/b2b/partners/${o.partner_id}/supply-options`).catch(() => null);
      const ship = await shipForm(opts?.partner?.warehouse);
      if (!ship) { e.target.value = o.delivery; return; }
      return setDelivery('warehouse', ship);
    };
    if ($('#oShipEd')) $('#oShipEd').onclick = async () => { const ship = await shipForm(o.ship_to); if (ship) setDelivery('warehouse', ship); };
    if ($('#oCrm')) $('#oCrm').onclick = async (e) => {
      const unpaid = !['paid', 'done'].includes(o.status) && o.pay_terms !== 'postpay';
      if (!(await confirmDanger(`Додати ${o.number} у LP-CRM на відправку?`, `Одне замовлення в «Нові» на ${esc(uah(o.total))}: ${esc([o.ship_to?.name, o.ship_to?.address].filter(Boolean).join(', '))}.${unpaid ? ' <b>Закупівля ще не оплачена.</b>' : ''}`, 'Додати в LP-CRM'))) return;
      const b = e.target.closest("button");
      b.disabled = true;
      try { const r = await api('POST', `/api/b2b/orders/${o.id}/crm`); toast(r.crm_id ? `Додано в LP-CRM: № ${r.crm_id}` : 'Додано в LP-CRM'); viewOrder(o.id); }
      catch (er) { toast(er.message, true); b.disabled = false; }
    };
    if ($('#oCheckPay')) $('#oCheckPay').onclick = () => checkPay(o);
    $$('[data-set]').forEach((b) => (b.onclick = async () => {
      const st = b.dataset.set;
      if (st === 'pay_wait' && !(await confirmDanger(o.status === 'partial' ? 'Зняти часткову оплату?' : 'Скасувати статус «Оплачено»?', 'Платежі Opendatabot відв’яжуться від закупівлі й більше не зараховуватимуться в неї автоматично.', 'Так, зняти оплату'))) return;
      if (st === 'cancelled' && !(await confirmDanger(`Скасувати ${o.number}?`, 'Партнер отримає сповіщення.', 'Скасувати замовлення'))) return;
      try { await api('POST', `/api/b2b/orders/${o.id}/status`, { status: st }); toast('Статус змінено'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
    }));
  }


  // Платежі закупівлі: зараховані (можна відв'язати, якщо Opendatabot помилився) і можливі (від цієї юрособи або
  // ті, де Opendatabot не зміг вибрати закупівлю) — «Зарахувати».
  async function loadPays(o) {
    const box = $('#oPays');
    try {
      const d = await api('GET', `/api/b2b/orders/${o.id}/payments`);
      const row = (t, btn) => `<tr><td class="small nowrap">${esc(fmtDateTime(t.date))}</td><td class="r nowrap"><b>${uah(t.amount)}</b></td>
        <td class="small">${esc(t.payer_name || t.payer_code)}<div class="muted">${esc(t.purpose)}</div></td><td>${btn}</td></tr>`;
      const canAdd = ['pay_wait', 'partial', 'paid'].includes(d.status);
      box.innerHTML = `<h3>Платежі (Opendatabot)</h3>
        ${d.linked.length ? `<table class="list"><tbody>${d.linked.map((t) => row(t, `<span class="small muted">${t.auto ? 'авто' : 'вручну'}</span> <button class="btn sm danger" data-unpay="${esc(t.tx_id)}">Відв’язати</button>`)).join('')}</tbody></table>`
          : '<div class="small muted">Платежів ще не зараховано. Opendatabot зараховує їх автоматично: платник — ця юрособа, сума не більша за залишок.</div>'}
        ${canAdd && d.possible.length ? `<h4 style="margin:8px 0 4px">Можливо, це оплата за цією закупівлею</h4>
          <table class="list"><tbody>${d.possible.map((t) => row(t, `${t.hint ? '<span class="badge info">№ рахунку</span> ' : ''}<button class="btn sm" data-pay="${esc(t.tx_id)}">Зарахувати</button>`)).join('')}</tbody></table>` : ''}`;
      $$('[data-pay]', box).forEach((b) => (b.onclick = async () => {
        try { await api('POST', `/api/b2b/orders/${o.id}/payments`, { tx_id: b.dataset.pay }); toast('Платіж зараховано'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
      }));
      $$('[data-unpay]', box).forEach((b) => (b.onclick = async () => {
        if (!(await confirmDanger('Відв’язати платіж?', 'Він більше не зараховуватиметься в цю закупівлю; статус оплати перерахується.', 'Відв’язати'))) return;
        try { await api('DELETE', `/api/b2b/orders/${o.id}/payments/${encodeURIComponent(b.dataset.unpay)}`); toast('Платіж відв’язано'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
      }));
    } catch (er) { box.innerHTML = `<h3>Платежі (Opendatabot)</h3><div class="small muted">${esc(er.message)}</div>`; }
  }

  // «Перевірити оплату»: свіжі платежі з Opendatabot і висновок — чи підтверджена оплата цієї закупівлі.
  async function checkPay(o) {
    const btn = $('#oCheckPay');
    btn.disabled = true;
    btn.textContent = 'Перевіряю…';
    let d;
    try { d = await api('POST', `/api/b2b/orders/${o.id}/check-pay`); } catch (er) { toast(er.message, true); btn.disabled = false; btn.textContent = 'Перевірити оплату (Opendatabot)'; return; }
    const manualPaid = ['paid', 'done'].includes(d.status) && d.paid_by && d.paid_by !== 'Opendatabot';
    const VERDICT = {
      confirmed: ['ok', `✅ Оплату підтверджено Opendatabot: ${uah(d.paid)} з ${uah(d.total)}.`],
      partial: ['info', `💳 За Opendatabot оплачено частково: ${uah(d.paid)} з ${uah(d.total)}, ще ${uah(d.due)}.`],
      maybe: ['warn', `Від цієї юрособи є платежі, ще не зараховані в закупівлю — перевірте нижче і натисніть «Зарахувати», якщо це оплата.`],
      none: ['bad', `Opendatabot не бачив платежів від юрособи закупівлі (код ${esc(d.code || '—')}) за останні 120 днів після рахунку.${manualPaid ? ' Статус «Оплачено» поставлено вручну — якщо грошей не було, скасуйте його.' : ''}`],
    };
    const [cls, text] = VERDICT[d.verdict];
    const row = (t, extra) => `<tr><td class="small nowrap">${esc(fmtDateTime(t.date))}</td><td class="r nowrap"><b>${uah(t.amount)}</b></td>
      <td class="small">${esc(t.payer_name)}<div class="muted">${esc(t.purpose)}</div></td><td class="small">${extra}</td></tr>`;
    const m = modal(`Оплата ${o.number}`, `<div class="alert ${cls}">${text}</div>
      ${d.added ? `<div class="small muted">Щойно отримано нових платежів з Opendatabot: ${d.added}.</div>` : ''}
      ${d.linked.length ? `<h4 style="margin:12px 0 4px">Зараховані платежі</h4><table class="list"><tbody>${d.linked.map((t) => row(t, '')).join('')}</tbody></table>` : ''}
      ${d.others.length ? `<h4 style="margin:12px 0 4px">Інші платежі цієї юрособи (120 днів)</h4><table class="list"><tbody>${d.others.map((t) => row(t,
        t.order ? `у ${esc(t.order)}` : `${t.hint ? '<span class="badge info">№ рахунку</span> ' : ''}${t.before ? '<span class="muted">до рахунку</span> ' : ''}<button class="btn sm" data-cpay="${esc(t.tx_id)}">Зарахувати</button>`)).join('')}</tbody></table>` : ''}
      <div class="btn-row" style="margin-top:12px">${manualPaid && d.verdict !== 'confirmed' ? '<button class="btn danger" id="cpUnpaid">Скасувати «Оплачено»</button>' : ''}<button class="btn" id="cpClose">Закрити</button></div>`, { wide: true });
    $('#cpClose', m.el).onclick = () => { m.close(); viewOrder(o.id); };
    if ($('#cpUnpaid', m.el)) $('#cpUnpaid', m.el).onclick = async () => {
      try { await api('POST', `/api/b2b/orders/${o.id}/status`, { status: 'pay_wait' }); m.close(); toast('Статус «Оплачено» скасовано'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
    };
    $$('[data-cpay]', m.el).forEach((b) => (b.onclick = async () => {
      try { await api('POST', `/api/b2b/orders/${o.id}/payments`, { tx_id: b.dataset.cpay }); m.close(); toast('Платіж зараховано'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
    }));
  }

  // ---------------------------------------------------------------- замовлення клієнтів партнерів
  let clFilter = { view: '', partner: '', q: '', from: '', to: '', pay: '' };
  const VIEWS = { '': 'Усі', new: 'Нові', crm: 'Передані в CRM', nosupply: 'Без закупівлі', cancelled: 'Скасовані' };
  async function viewClients(id) {
    if (id) return viewClient(id);
    const qs = filterQs(clFilter);
    const [{ rows, counts, crm }, partners, cfg] = await Promise.all([
      api('GET', `/api/b2b/clients${qs ? `?${qs}` : ''}`), api('GET', '/api/b2b/partners'), api('GET', '/api/b2b/crm-settings'),
    ]);
    main.innerHTML = `
      <div class="head-row"><h2>Замовлення клієнтів</h2><div class="btn-row"><button class="btn" id="clLabels">Група маркувань</button><button class="btn" id="clCfg">Налаштування CRM</button></div></div>
      <div class="alert ${crm ? 'info' : 'warn'}" style="margin-bottom:12px">${crm
        ? `Кнопка «Додати в CRM» створює замовлення в LP-CRM (відділ ID ${esc(cfg.office)}, ціни партнера, вкладка «Нові»).`
        : 'Передача в LP-CRM вимкнена: поки ключ не має дозволу на addNewOrder, створюйте замовлення в CRM вручну і вписуйте його номер — партнер бачитиме статус. Увімкнути — «Налаштування CRM».'}</div>
      <div class="btn-row" style="margin-bottom:12px;flex-wrap:wrap">
        ${Object.entries(VIEWS).map(([k, v]) => `<button class="chip ${clFilter.view === k ? 'on' : ''}" data-v="${k}">${esc(v)}${k && counts[k] ? ` · ${counts[k]}` : ''}</button>`).join('')}
        <select id="clPartner" aria-label="Партнер"><option value="">Усі партнери</option>${partners.map((p) => `<option value="${p.id}" ${String(clFilter.partner) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </div>
      ${filterBar(clFilter, { pay: true })}
      ${bulkBar()}
      ${rows.length ? `<table class="list"><thead><tr>${selHead()}<th>№</th><th>Партнер / клієнт</th><th class="r">Сума</th><th>Статус</th><th class="hide-m">Оплата</th><th class="hide-m">CRM</th></tr></thead><tbody>
        ${rows.map((o) => `<tr class="click ${o.pending ? 'row-info' : o.no_supply && o.status !== 'cancelled' ? 'row-bad' : ''}" data-o="${o.id}">
          ${selCell(o.id)}
          <td><b>${esc(o.number)}</b><div>${supplyMark(o)}</div>${o.pending ? '<div><span class="badge info">🔵 чекає підтвердження партнера</span></div>' : ''}<div class="small muted hide-m">${esc(fmtDateTime(o.created_at))}</div></td>
          <td>${esc(o.partner)}<div class="small">${esc(o.client_name)} · ${esc(phoneFmt(o.client_phone))}</div><div class="small muted">${o.ttn ? `ТТН ${esc(o.ttn)} · ` : ''}${o.labels ? `📎 маркування: ${o.labels}` : (o.status === 'new' ? '<span class="badge bad">без маркування</span>' : '')}${o.files > (o.labels || 0) ? ` · 📄 документів: ${o.files - (o.labels || 0)}` : ''}</div></td>
          <td class="r"><b>${uah(o.total)}</b></td>
          <td>${statusBadge(o)}</td>
          <td class="hide-m">${payBadge(o)}</td>
          <td class="hide-m">${crmCell(o)}</td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="card empty"><div class="big">Замовлень немає</div>${qs ? 'За цими фільтрами нічого не знайдено.' : 'Тут з’являться замовлення, які партнери оформлюють для своїх клієнтів.'}</div>`}`;
    wireFilterBar(clFilter, () => viewClients());
    const byId = new Map(rows.map((r) => [r.id, r]));
    wireBulk([
      ...(crm ? [{ key: 'crm', label: 'Додати в CRM', confirm: (n) => `Передати ${n} замовлень у LP-CRM?`,
        run: (id) => { const o = byId.get(id); if (o.status !== 'new') throw new Error(o.status === 'crm' ? 'вже в CRM' : 'скасовано'); if (o.pending) throw new Error('чекає підтвердження партнера'); return api('POST', `/api/b2b/clients/${id}/crm`); } }] : []),
      { key: 'paid', label: 'Оплачено (без закупівлі)', run: (id) => { if (!byId.get(id).no_supply) throw new Error('оплата — за закупівлею'); return api('POST', `/api/b2b/clients/${id}/paid`, { paid: true }); } },
      { key: 'cancel', label: 'Скасувати', danger: true, confirm: (n) => `Скасувати ${n} замовлень? Ті, що вже в LP-CRM, скасуйте там вручну.`, run: (id) => api('POST', `/api/b2b/clients/${id}/cancel`) },
      { key: 'del', label: 'Видалити в кошик', danger: true, confirm: (n) => `Перенести ${n} замовлень у кошик? Ті, що вже в LP-CRM, видаліть там вручну.`, run: (id) => api('DELETE', `/api/b2b/orders/${id}`) },
    ], { onDone: () => viewClients(), confirmDanger });
    $$('[data-v]').forEach((b) => (b.onclick = () => { clFilter.view = b.dataset.v; viewClients(); }));
    $('#clPartner').onchange = (e) => { clFilter.partner = e.target.value; viewClients(); };
    $$('[data-o]').forEach((tr) => (tr.onclick = () => { location.hash = `#/b2bclients/${tr.dataset.o}`; }));
    $('#clLabels').onclick = () => labelsGroup();
    $('#clCfg').onclick = () => {
      const TTN_F = { '': 'ніде більше', additional_2: 'Додаткове поле 2', additional_3: 'Додаткове поле 3', additional_4: 'Додаткове поле 4' };
      const m = modal('Передача замовлень у LP-CRM', `<form id="crmF" class="form-stack">
          <label class="f"><span>Вхідний ключ API (LP-CRM → Інтеграції → Landing page, рядок 'key')</span>
            <input name="in_key" value="${esc(cfg.in_key)}" autocomplete="off" placeholder="${cfg.in_key ? '' : 'порожньо — використовується основний ключ'}"></label>
          <div class="grid2"><label class="f"><span>ID відділу B2B *</span><input name="office" value="${esc(cfg.office)}" inputmode="numeric"></label>
            <label class="f"><span>ID позначки (необов’язково)</span><input name="notification" value="${esc(cfg.notification)}" inputmode="numeric"></label></div>
          <label class="f"><span>ID виду доставки (Нова пошта — 1)</span><input name="delivery" value="${esc(cfg.delivery)}" inputmode="numeric"></label>
          <div class="grid2"><label class="f"><span>ID виду оплати, якщо закупівлю оплачено («Оплачено» — 1)</span><input name="payment_paid" value="${esc(cfg.payment_paid)}" inputmode="numeric"></label>
            <label class="f"><span>ID виду оплати, якщо не оплачено (порожньо — без значка)</span><input name="payment" value="${esc(cfg.payment)}" inputmode="numeric"></label></div>
          <label class="f"><span>Сайт-джерело замовлень (як буде видно в LP-CRM)</span><input name="site" value="${esc(cfg.site || '')}" placeholder="${esc(location.host)}"></label>
          <label class="f"><span>ТТН іде в поле «Адреса доставки»; додатково записувати ще в</span><select name="ttn_field">${Object.entries(TTN_F).map(([k, v]) => `<option value="${k}" ${cfg.ttn_field === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="on" ${cfg.on ? 'checked' : ''}> Увімкнути кнопку «Додати в CRM»</label>
          <div class="small muted">Замовлення потрапляє у вкладку «Нові» вибраного відділу, ціни — партнерські, «Поле 1» лишається порожнім.
            ТТН — у полі «Адреса доставки» (окремого поля ТТН API не має; перенесіть її в поле ТТН у CRM), без ТТН — відділення з маркування. У коментарі — № B2B, партнер, ТТН і оплата: «ОПЛАЧЕНО» (рахунок, коли, скільки, від кого й на який рахунок — з Opendatabot)
            або «ОЧІКУЄМО ОПЛАТУ» (рахунок, на кого, від кого). Якщо оплата прийде вже після передачі — бот надішле адмінам номер у CRM і готовий текст коментаря
            (змінювати створене замовлення API LP-CRM не дає). Номер замовлення в CRM і статус підтягуються автоматично.</div>
          ${cfg.ready ? '' : '<div class="alert bad">Не вказано піддомен або основний API-ключ LP-CRM у «Налаштуваннях» — без нього не оновлюються статуси.</div>'}
        </form>`, { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="crmSave">Зберегти</button>' });
      $('#crmSave', m.el).onclick = async () => {
        const f = $('#crmF', m.el);
        const d = Object.fromEntries(new FormData(f));
        d.on = f.on.checked;
        try { await api('PUT', '/api/b2b/crm-settings', d); m.close(); toast('Збережено'); viewClients(); }
        catch (e) { toast(e.message, true); }
      };
    };
  }

  // Службові Telegram-групи: маркування («накладні розетка») і «Фінансові питання» (рахунки й накладні).
  const GROUPS = {
    labels: {
      url: '/api/b2b/labels-group', title: 'Група маркувань у Telegram', example: '«накладні розетка»', ok: 'Групу прив’язано для маркувань',
      about: `Сюди бот надсилає кожне маркування замовлення клієнта (з сайту або з групи партнера) з підписом:
        <b>ПІБ клієнта · CRM № … (або «ще не в CRM») · B2B-… · ТТН</b>; коли замовлення отримує № у CRM — окремий рядок із номером.
        З маркування Нової пошти бот читає ТТН і телефон: порожню ТТН у замовленні заповнює, розбіжності показує.`,
    },
    fin: {
      url: '/api/b2b/fin-group', title: 'Група «Фінансові питання»', example: '«Фінансові питання»', ok: 'Групу прив’язано як «Фінансові питання»',
      about: `<b>Нова закупівля</b> → бот пише в гілку General запит рахунку (на кого, товари, сума). Бухгалтер надсилає PDF рахунку
        <b>відповіддю на запит</b>: якщо покупець, сума і всі товари збіглися — рахунок одразу в закупівлі й у групі партнера.
        <b>Після оплати</b> бот відповіддю на рахунок просить видаткову накладну — так само.
        Є розбіжності — бот показує їх і кнопки, які спрацьовують лише для адміністраторів групи або сайту.
        Щоб бот впізнавав і PDF без відповіді — зробіть його <b>адміністратором</b> групи (права можна мінімальні).`,
    },
  };
  async function groupModal(key) {
    const G = GROUPS[key];
    const g = await api('GET', G.url);
    const m = modal(G.title, `<div class="form-stack">
        ${g.chat ? `<div>✅ Прив’язано: <b>${esc(g.title || g.chat)}</b></div>` : '<div class="small muted">Групу ще не прив’язано.</div>'}
        <div class="small">${G.about}</div>
        <div id="grCode"></div>
      </div>`, { footer: `${g.chat ? '<button class="btn danger" id="grOff" style="margin-right:auto">Відв’язати</button>' : ''}<button class="btn" data-close>Закрити</button><button class="btn primary" id="grLink">${g.chat ? 'Прив’язати іншу' : 'Прив’язати групу'}</button>` });
    $('#grLink', m.el).onclick = async () => {
      try {
        const { code, bot } = await api('POST', G.url);
        $('#grCode', m.el).innerHTML = `<ol class="form-stack" style="padding-left:18px;margin:0">
          <li>Додайте <b>@${esc(bot)}</b> у групу ${G.example}.</li>
          <li>Надішліть у групі: <code style="font-size:16px">/link ${esc(code)}</code></li>
          <li>Бот відповість «${G.ok}». Код діє 30 хвилин.</li></ol>`;
      } catch (e) { toast(e.message, true); }
    };
    $('#grOff', m.el) && ($('#grOff', m.el).onclick = async () => { try { await api('DELETE', G.url); m.close(); toast('Відв’язано'); } catch (e) { toast(e.message, true); } });
  }
  const labelsGroup = () => groupModal('labels');

  async function viewClient(id) {
    const [{ order: o, items, files, history, partner, missing = [] }, cfg] = await Promise.all([api('GET', `/api/b2b/orders/${id}`), api('GET', '/api/b2b/crm-settings')]);
    if (o.kind !== 'client') { location.hash = `#/b2borders/${id}`; return; }
    const closed = o.status === 'cancelled';
    main.innerHTML = `
      <div class="head-row"><h2>${esc(o.number)} · ${esc(partner?.name || '')} ${statusBadge(o)} ${payBadge(o)}</h2><div class="btn-row"><a class="btn" href="#/b2bclients">← До списку</a>${closed ? '' : '<button class="btn" id="clEdit">✏️ Змінити</button>'}<button class="btn danger" id="clDel">Видалити</button></div></div>
      ${o.pending ? `<div class="card form-stack card-info" style="margin-bottom:12px"><b>🔵 Чекає підтвердження партнера</b>
          ${o.pending.crm_old ? `<div class="small">Старе замовлення в LP-CRM № <b>${esc(o.pending.crm_old)}</b> анульовано — скасуйте його в CRM; нове передайте після підтвердження.</div>` : ''}
          ${o.pending.changes.length ? `<ul class="small" style="margin:0;padding-left:18px">${o.pending.changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <div class="small muted">Змінив(ла): ${esc(o.pending.by)}${o.pending.at ? ` · ${esc(fmtDateTime(o.pending.at))}` : ''}. Доки партнер не підтвердить, у LP-CRM не передається.</div></div>` : ''}
      ${o.no_supply && !closed ? '<div class="alert bad" style="margin-bottom:12px"><b>Без закупівлі.</b> Товари не з закупівлі партнера — виставте рахунок/накладну нижче і позначте оплату.</div>' : ''}
      ${!o.no_supply && o.pay !== 'paid' && !closed ? `<div class="alert warn" style="margin-bottom:12px">Закупівля <a href="#/b2borders/${o.supply_id}">${esc(o.supply_number)}</a> ще не оплачена.</div>` : ''}
      <div class="form-page">
        <div class="form-stack">
          <div class="card">${itemsTable(items, { rrp: true })}</div>
          ${o.comment ? `<div class="card small"><b>Коментар партнера:</b> ${esc(o.comment)}</div>` : ''}
          <div class="card form-stack ${o.no_supply && !closed ? 'card-bad' : ''}">
            <h3>Клієнт і доставка</h3>
            <div><b>${esc(o.client_name)}</b> · ${esc(phoneFmt(o.client_phone))}</div>
            <div>ТТН партнера: ${o.ttn ? `<b>${esc(o.ttn)}</b>` : '<span class="muted">не вказано</span>'}</div>
            <div>${o.no_supply ? supplyMark(o) : `Із закупівлі <a href="#/b2borders/${o.supply_id}">${esc(o.supply_number)}</a>`}</div>
          </div>
        </div>
        <div class="form-stack">
          <div class="card form-stack">
            <h3>LP-CRM</h3>
            ${missing.length ? `<div class="alert bad small">Бракує: <b>${missing.map(esc).join(', ')}</b> — «Додати в CRM» не спрацює, доки партнер їх не додасть.</div>` : ''}
            ${o.crm_id ? `<div>Замовлення № <b>${esc(o.crm_id)}</b>${o.crm_status ? ` · <span class="badge info">${esc(o.crm_status)}</span>` : ''}</div>` : ''}
            ${!closed && o.status === 'new' ? `<button class="btn primary" id="clCrm" ${cfg.on && !o.pending ? '' : 'disabled'}>Додати в CRM</button>${o.pending ? '<div class="small muted">Спершу партнер має підтвердити зміни.</div>' : ''}
              ${cfg.on ? '' : '<div class="small muted">Передача в LP-CRM ще вимкнена (вкладка «Замовлення клієнтів» → «Налаштування CRM»). Поки що створіть замовлення в CRM вручну і впишіть номер нижче.</div>'}` : ''}
            ${!closed ? `<form id="clLink" class="btn-row"><input name="crm_id" value="${esc(o.crm_id)}" inputmode="numeric" placeholder="№ або код замовлення LP-CRM" style="max-width:220px" aria-label="Номер замовлення LP-CRM">
              <button class="btn">${o.crm_id ? 'Змінити номер' : 'Прив’язати номер'}</button>${o.crm_id ? '<button type="button" class="btn" id="clRefresh">Оновити статус</button>' : ''}</form>` : ''}
          </div>
          ${o.no_supply ? `<form class="card form-stack" id="oAcc">
            <h3>Рахунок і накладна</h3>
            <div class="grid2"><label class="f"><span>№ рахунку</span><input name="invoice_no" value="${esc(o.invoice_no)}" ${closed ? 'disabled' : ''}></label>
              <label class="f"><span>Дата рахунку</span><input name="invoice_date" type="date" value="${esc(o.invoice_date)}" ${closed ? 'disabled' : ''}></label></div>
            <label class="f"><span>№ накладної</span><input name="waybill_no" value="${esc(o.waybill_no)}" ${closed ? 'disabled' : ''}></label>
            ${closed ? '' : `<div class="btn-row"><button class="btn primary">Зберегти</button>
              <button type="button" class="btn" id="clPaid">${o.paid_at ? 'Зняти «Оплачено»' : 'Оплачено (вручну)'}</button></div>`}
            ${o.paid_at ? `<div class="small">Оплачено: ${esc(fmtDateTime(o.paid_at))}${o.paid_by ? ` · ${esc(o.paid_by)}` : ''}</div>` : ''}
          </form>` : ''}
          <div class="card form-stack">
            <h3>Файли</h3>
            ${files.length ? files.map((f) => `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <a class="btn sm" href="/api/b2b/files/${f.id}" target="_blank" rel="noopener">📎 ${esc(f.kind_name)}: ${esc(f.name)}</a>
              <span class="small muted">${fileSize(f.size)} · ${esc(fmtDateTime(f.created_at))}</span>
              <button class="btn sm danger" data-fdel="${f.id}" aria-label="Видалити файл">✕</button></div>`).join('') : '<div class="small muted">Файлів ще немає (маркування додає партнер).</div>'}
            ${closed ? '' : `<div class="btn-row">
              ${o.no_supply ? '<label class="btn sm">+ Рахунок<input type="file" data-up="invoice" hidden></label><label class="btn sm">+ Накладна<input type="file" data-up="waybill" hidden></label>' : ''}
              <label class="btn sm">+ Маркування<input type="file" data-up="label" hidden></label></div>`}
          </div>
          ${closed ? '' : '<div class="card"><button class="btn danger" id="clCancel">Скасувати замовлення</button></div>'}
          ${historyCard(history)}
        </div>
      </div>`;
    const re = () => viewClient(o.id);
    $('#clCrm') && ($('#clCrm').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await api('POST', `/api/b2b/clients/${o.id}/crm`); toast(r.crm_id ? `Додано в CRM: № ${r.crm_id}` : 'Додано в CRM — номер не повернувся, впишіть його вручну'); re(); }
      catch (er) { toast(er.message, true); re(); }
    });
    $('#clLink') && ($('#clLink').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('PUT', `/api/b2b/clients/${o.id}`, { crm_id: e.target.crm_id.value }); toast('Збережено'); re(); } catch (er) { toast(er.message, true); }
    });
    $('#clRefresh') && ($('#clRefresh').onclick = async () => { try { await api('POST', `/api/b2b/clients/${o.id}/refresh`); re(); } catch (er) { toast(er.message, true); } });
    $('#oAcc') && ($('#oAcc').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('PUT', `/api/b2b/orders/${o.id}`, Object.fromEntries(new FormData(e.target))); toast('Збережено'); re(); } catch (er) { toast(er.message, true); }
    });
    $('#clPaid') && ($('#clPaid').onclick = async () => { try { await api('POST', `/api/b2b/clients/${o.id}/paid`, { paid: !o.paid_at }); toast('Збережено'); re(); } catch (er) { toast(er.message, true); } });
    $$('[data-up]').forEach((inp) => (inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      try { const r = await uploadFile(`/api/b2b/orders/${o.id}/files?kind=${inp.dataset.up}`, file); toast(r.warnings?.length ? `Додано. ⚠️ ${r.warnings.join('; ')}` : r.toGroup ? 'Файл додано й надіслано в Telegram-групу партнера' : 'Файл додано', !!r.warnings?.length); re(); } catch (er) { toast(er.message, true); }
    }));
    $$('[data-fdel]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmDanger('Видалити файл?', 'Партнер більше не зможе його завантажити.', 'Видалити'))) return;
      try { await api('DELETE', `/api/b2b/files/${b.dataset.fdel}`); toast('Видалено'); re(); } catch (er) { toast(er.message, true); }
    }));
    $('#clDel').onclick = async () => {
      if (!(await confirmDanger(`Видалити замовлення ${o.number}?`, `Замовлення піде в «Кошик» (можна відновити); товар повернеться в залишок закупівлі.${o.crm_id ? ` Замовлення № ${o.crm_id} у LP-CRM видаліть вручну.` : ''}`, 'Видалити замовлення'))) return;
      try { await api('DELETE', `/api/b2b/orders/${o.id}`); toast('Замовлення перенесено в кошик'); location.hash = '#/b2bclients'; } catch (er) { toast(er.message, true); }
    };
    $('#clEdit') && ($('#clEdit').onclick = () => editClient(o, items));
    $('#clCancel') && ($('#clCancel').onclick = async () => {
      if (!(await confirmDanger(`Скасувати ${o.number}?`, o.crm_id ? `Замовлення № ${o.crm_id} у LP-CRM скасуйте вручну.` : 'Партнер отримає сповіщення.', 'Скасувати замовлення'))) return;
      try { await api('POST', `/api/b2b/clients/${o.id}/cancel`); toast('Скасовано'); re(); } catch (er) { toast(er.message, true); }
    });
  }

  // ---------------------------------------------------------------- правки адміна
  const n2 = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
  // Закупівля: к-сть, ціна, прибрати, додати товар; юрособа; коментар. З рахунком — рахунок перевиставляється.
  async function editSupply(o, items) {
    const opt = await api('GET', `/api/b2b/orders/${o.id}/edit-options`);
    const cat = new Map(opt.catalog.map((p) => [p.product_id, p]));
    let rows = items.map((i) => ({ product_id: i.product_id, name: i.name, article: i.article, qty: i.qty, price: i.price, was: i.qty }));
    const m = modal(`Змінити закупівлю ${o.number}`, `<div class="form-stack">
        ${opt.invoiced ? `<div class="alert warn small">Рахунок № <b>${esc(o.invoice_no)}</b> уже виставлено. Після збереження закупівля знову «Очікує рахунок»: у «Фінансові питання» піде запит
          переробити рахунок № ${esc(o.invoice_no)} на новий склад, партнер отримає сповіщення; новий рахунок (файл) замінить старий і піде в групу партнера.${o.paid_amount ? ` Оплата ${uah(o.paid_amount)} лишається зарахованою.` : ''}</div>`
          : o.status === 'invoice_wait' ? '<div class="small muted">Бухгалтер отримає оновлений запит рахунку, партнер — сповіщення.</div>' : '<div class="small muted">Чернетка — сповіщень не буде.</div>'}
        <div id="seRows"></div>
        <label class="f"><span>Додати товар (каталог партнера)</span><input id="seQ" list="seCat" placeholder="Почніть вводити назву або ID"><datalist id="seCat">${opt.catalog.map((p) => `<option value="${p.product_id} · ${esc(p.name)}">`).join('')}</datalist></label>
        <label class="f"><span>Юрособа (на кого рахунок)</span><select id="seEnt">${opt.entities.map((e) => `<option value="${e.id}" ${e.id === o.entity_id ? 'selected' : ''}>${esc(e.name)} · ${esc(e.code)}</option>`).join('')}</select></label>
        <label class="f"><span>Коментар</span><textarea id="seCom" rows="2">${esc(o.comment || '')}</textarea></label>
      </div>`, { wide: true, footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="seSave">Зберегти</button>' });
    const sync = () => rows.forEach((r, i) => { const q = $(`[data-sq="${i}"]`, m.el); const p = $(`[data-sp="${i}"]`, m.el); if (q) r.qty = Math.max(0, Math.floor(n2(q.value))); if (p) r.price = n2(p.value); });
    const draw = () => {
      const total = rows.reduce((t, r) => t + Math.round(r.qty * r.price * 100) / 100, 0);
      $('#seRows', m.el).innerHTML = `<table class="list"><thead><tr><th>Товар</th><th class="r">К-сть</th><th class="r">Ціна, грн</th><th class="r">Сума</th><th></th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr style="${r.qty ? '' : 'opacity:.5;text-decoration:line-through'}"><td>${esc(r.name)}${r.was === undefined ? ' <span class="badge info">новий</span>' : ''}<div class="small muted">ID ${r.product_id}${r.article ? ` · ${esc(r.article)}` : ''}</div></td>
          <td class="r"><input data-sq="${i}" type="number" min="0" step="1" value="${r.qty}" style="width:76px" aria-label="Кількість"></td>
          <td class="r"><input data-sp="${i}" inputmode="decimal" value="${String(r.price).replace('.', ',')}" style="width:100px" aria-label="Ціна"></td>
          <td class="r nowrap">${money(Math.round(r.qty * r.price * 100) / 100)}</td>
          <td class="r"><button type="button" class="btn sm danger" data-sx="${i}" aria-label="Прибрати">✕</button></td></tr>`).join('')}
        <tr><td colspan="3" class="r"><b>Разом</b></td><td class="r nowrap"><b>${uah(total)}</b></td><td></td></tr></tbody></table>
        <div class="small muted">К-сть 0 або ✕ — прибрати товар (запис потрапить у «Кошик»). Не можна менше, ніж уже розписано на замовлення клієнтів.</div>`;
      $$('[data-sq],[data-sp]', m.el).forEach((x) => (x.onchange = () => { sync(); draw(); }));
      $$('[data-sx]', m.el).forEach((b) => (b.onclick = () => { sync(); rows[Number(b.dataset.sx)].qty = 0; draw(); }));
    };
    draw();
    $('#seQ', m.el).onchange = (e) => {
      const id = parseInt(e.target.value, 10);
      const p = cat.get(id);
      e.target.value = '';
      if (!p) { toast('Оберіть товар зі списку', true); return; }
      sync();
      const have = rows.find((r) => r.product_id === id);
      if (have) have.qty = (have.qty || 0) + 1; else rows.push({ product_id: id, name: p.name, article: p.article, qty: 1, price: p.price });
      draw();
    };
    $('#seSave', m.el).onclick = async (e) => {
      sync();
      if (opt.invoiced && !(await confirmDanger(`Змінити закупівлю з рахунком № ${o.invoice_no}?`, 'Рахунок доведеться переробити: бухгалтер отримає запит у «Фінансові питання», партнер — сповіщення.', 'Зберегти зміни'))) return;
      e.target.closest("button").disabled = true;
      try {
        const r = await api('PUT', `/api/b2b/orders/${o.id}/edit`, { items: rows.map((x) => ({ product_id: x.product_id, qty: x.qty, price: x.price })), entity_id: Number($('#seEnt', m.el).value) || undefined, comment: $('#seCom', m.el).value });
        m.close();
        toast(!r.changed ? 'Змін немає' : r.reinvoice ? 'Збережено — запит переробити рахунок надіслано' : 'Збережено');
        viewOrder(o.id);
      } catch (er) { toast(er.message, true); e.target.closest('button').disabled = false; }
    };
  }

  // Замовлення клієнта: клієнт, телефон, ТТН, коментар, закупівля-джерело, товари — у будь-якому статусі, крім скасованого.
  async function editClient(o, items) {
    const opt = await api('GET', `/api/b2b/clients/${o.id}/edit-options`);
    const qty = new Map(items.map((i) => [i.product_id, i.qty]));
    let src = o.no_supply ? '' : String(o.supply_id || '');
    if (src && !opt.supplies.some((s) => String(s.id) === src)) src = '';
    let q = '';
    const m = modal(`Змінити замовлення ${o.number}`, `<form id="ceF" class="form-stack">
        ${o.status === 'crm' ? `<div class="alert warn small">Замовлення вже в LP-CRM${o.crm_id ? ` (№ <b>${esc(o.crm_id)}</b>)` : ''}. Після збереження старе замовлення вважається анульованим: партнер (особисто й у групі) отримає, що було і що буде, замовлення повернеться в «Нові»; скасуйте старе в CRM і передайте нове після підтвердження партнером.</div>`
          : '<div class="small muted">Після збереження партнер має підтвердити зміни — до того замовлення не передається в LP-CRM.</div>'}
        <div class="grid2"><label class="f"><span>ПІБ клієнта</span><input name="client_name" value="${esc(o.client_name)}"></label>
          <label class="f"><span>Телефон</span><input name="client_phone" value="${esc(o.client_phone)}" inputmode="tel"></label></div>
        <div class="grid2"><label class="f"><span>ТТН</span><input name="ttn" value="${esc(o.ttn || '')}" inputmode="numeric"></label>
          <label class="f"><span>Товари з</span><select id="ceSrc"><option value="">Без закупівлі (відкрита закупівля, з каталогу)</option>
            ${opt.supplies.map((s) => `<option value="${s.id}" ${String(s.id) === src ? 'selected' : ''}>${esc(s.number)} · ${esc(s.status_name)}</option>`).join('')}</select></label></div>
        <div id="ceList"></div>
        <label class="f"><span>Коментар</span><textarea name="comment" rows="2">${esc(o.comment || '')}</textarea></label>
      </form>`, { wide: true, footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="ceSave">Зберегти</button>' });
    const extra = new Map(); // інші товари з каталогу, яких немає в закупівлі-джерелі
    const catMap = new Map(opt.catalog.map((p) => [p.product_id, p]));
    for (const i of items) if (!o.no_supply && !(opt.supplies.find((s) => String(s.id) === src)?.items || []).some((x) => x.product_id === i.product_id)) extra.set(i.product_id, { product_id: i.product_id, name: i.name, price: i.price, left: 0 });
    const list = () => {
      if (src) {
        const sItems = (opt.supplies.find((s) => String(s.id) === src)?.items || []).map((i) => ({ ...i, hint: `залишок ${i.left}` }));
        return [...sItems, ...[...extra.values()].filter((x) => !sItems.some((i) => i.product_id === x.product_id)).map((x) => ({ ...x, hint: 'немає в закупівлі — буде додано' }))];
      }
      const ql = q.trim().toLowerCase();
      const all = opt.catalog.map((p) => ({ ...p, hint: '' }));
      return all.filter((p) => qty.get(p.product_id) || !ql || p.name.toLowerCase().includes(ql) || String(p.product_id) === ql).slice(0, 120);
    };
    const draw = () => {
      const l = list();
      $('#ceList', m.el).innerHTML = `${src ? `<label class="f"><span>Замінити / додати інший товар (з каталогу партнера)</span><input id="ceAdd" list="ceCat" placeholder="Почніть вводити назву або ID">
          <datalist id="ceCat">${opt.catalog.map((p) => `<option value="${p.product_id} · ${esc(p.name)}">`).join('')}</datalist></label>` : `<input id="ceQ" placeholder="Пошук товару в каталозі партнера" value="${esc(q)}">`}
        <table class="list"><thead><tr><th>Товар</th><th class="r">Ціна</th><th class="r">К-сть</th></tr></thead><tbody>
        ${l.map((p) => `<tr><td>${esc(p.name)}<div class="small muted">ID ${p.product_id}${p.hint ? ` · ${esc(p.hint)}` : ''}</div></td><td class="r nowrap">${money(p.price)}</td>
          <td class="r"><input data-cq="${p.product_id}" type="number" min="0" step="1" value="${qty.get(p.product_id) || ''}" style="width:76px" aria-label="Кількість"></td></tr>`).join('')
          || '<tr><td colspan="3" class="small muted">Немає товарів.</td></tr>'}</tbody></table>`;
      $$('[data-cq]', m.el).forEach((x) => (x.onchange = () => { const v = Math.max(0, Math.floor(n2(x.value))); if (v) qty.set(Number(x.dataset.cq), v); else qty.delete(Number(x.dataset.cq)); }));
      const ai = $('#ceAdd', m.el);
      if (ai) ai.onchange = () => {
        const p = catMap.get(parseInt(ai.value, 10));
        if (!p) { toast('Оберіть товар зі списку', true); return; }
        if (!list().some((x) => x.product_id === p.product_id)) extra.set(p.product_id, { product_id: p.product_id, name: p.name, price: p.price, left: 0 });
        qty.set(p.product_id, (qty.get(p.product_id) || 0) + 1);
        draw();
      };
      const qi = $('#ceQ', m.el);
      if (qi) qi.oninput = () => { q = qi.value; const pos = qi.selectionStart; draw(); const n = $('#ceQ', m.el); n.focus(); n.setSelectionRange(pos, pos); };
    };
    $('#ceSrc', m.el).onchange = (e) => { src = e.target.value; draw(); };
    draw();
    $('#ceSave', m.el).onclick = async (e) => {
      const f = Object.fromEntries(new FormData($('#ceF', m.el)));
      const ids = new Set(list().map((p) => p.product_id));
      const its = [...qty].filter(([id, n]) => n > 0 && (src ? ids.has(id) : true)).map(([product_id, n]) => ({ product_id, qty: n }));
      if (!its.length) { toast('Вкажіть кількість хоча б одного товару', true); return; }
      // Бракує в закупівлі — додати в закупівлю (з рахунком — перевиставлення).
      let addToSupply = false;
      if (src) {
        const l = new Map(list().map((x) => [x.product_id, x.left ?? 0]));
        const short = its.filter((x) => x.qty > Math.max(0, l.get(x.product_id) ?? 0)).map((x) => `${(list().find((p) => p.product_id === x.product_id) || {}).name || x.product_id} × ${x.qty - Math.max(0, l.get(x.product_id) ?? 0)}`);
        const sup = opt.supplies.find((s) => String(s.id) === src);
        if (short.length) {
          if (!(await confirmDanger(`Додати в закупівлю ${sup?.number || ''}?`, `Бракує в закупівлі: ${short.join(', ')}. Товар буде додано в закупівлю${/Очікує рахунок|Чернетка/.test(sup?.status_name || '') ? '' : ' — рахунок доведеться переробити (запит у «Фінансові питання»)'}.`, 'Додати й зберегти'))) return;
          addToSupply = true;
        }
      }
      const btn = e.target.closest("button");
      btn.disabled = true;
      try {
        const r = await api('PUT', `/api/b2b/clients/${o.id}/edit`, { ...f, supply_id: src || null, items: its, add_to_supply: addToSupply });
        m.close();
        toast(r.crmOld ? `Збережено. Скасуйте в LP-CRM старе замовлення № ${r.crmOld}; нове — після підтвердження партнером` : r.pending ? 'Збережено — партнер має підтвердити зміни' : 'Збережено');
        viewClient(o.id);
      } catch (er) { toast(er.message, true); btn.disabled = false; }
    };
  }

  // ---------------------------------------------------------------- кошик
  let trashPartner = '';
  async function viewTrash() {
    const [rows, partners] = await Promise.all([api('GET', `/api/b2b/trash${trashPartner ? `?partner=${trashPartner}` : ''}`), api('GET', '/api/b2b/partners')]);
    const KIND = { supply: 'Закупівля', client: 'Замовлення клієнта', item: 'Товар із закупівлі' };
    main.innerHTML = `
      <div class="head-row"><h2>Кошик</h2><select id="trP" aria-label="Партнер" style="max-width:260px"><option value="">Усі партнери</option>${partners.map((p) => `<option value="${p.id}" ${String(trashPartner) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="alert info help" style="margin-bottom:12px">Видалені закупівлі й замовлення клієнтів (можна відновити) і прибрані з закупівель товари. Партнер бачить свій кошик, але видаляти не може (лише свої чернетки).</div>
      ${rows.length ? `<table class="list"><thead><tr><th>Коли</th><th>Що</th><th class="hide-m">Партнер</th><th class="r">Сума</th><th>Хто видалив</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="small nowrap">${esc(fmtDateTime(r.deleted_at))}</td>
          <td><span class="small muted">${KIND[r.kind] || r.kind}</span><div>${esc(r.title)}</div></td>
          <td class="hide-m small">${esc(r.partner)}</td><td class="r nowrap">${money(r.total)}</td>
          <td class="small">${esc(r.deleted_by)}${r.by_partner ? ' <span class="badge">партнер</span>' : ''}</td>
          <td class="r">${r.restored_at ? `<span class="small muted">відновлено ${esc(fmtDateTime(r.restored_at))}${r.restored_by ? ` · ${esc(r.restored_by)}` : ''}</span>${r.order_id ? ` <a class="btn sm" href="#/${r.kind === 'client' ? 'b2bclients' : 'b2borders'}/${r.order_id}">Відкрити</a>` : ''}`
            : r.can_restore ? `<button class="btn sm" data-rs="${r.id}">↩️ Відновити</button>` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<div class="card empty"><div class="big">Кошик порожній</div>Тут з’являться видалені закупівлі, замовлення клієнтів і прибрані з закупівель товари.</div>'}`;
    $('#trP').onchange = (e) => { trashPartner = e.target.value; viewTrash(); };
    $$('[data-rs]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { const r = await api('POST', `/api/b2b/trash/${b.dataset.rs}/restore`); toast('Відновлено'); location.hash = `#/${r.kind === 'client' ? 'b2bclients' : 'b2borders'}/${r.id}`; }
      catch (er) { toast(er.message, true); b.disabled = false; }
    }));
  }

  return { viewPartners, viewCatalog, viewOrders, viewClients, viewTrash, pct, fmtDay };
}
