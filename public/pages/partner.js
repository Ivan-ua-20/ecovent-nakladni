// Кабінет партнера (B2B): каталог, юрособи, закупівлі (оформлення, зміна до рахунку, файли), замовлення клієнтів, інструкція.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime } from '../core/ui.js';
import { downloadXlsx } from '../core/xlsx.js';
import { uah, statusBadge, fmtDay, fileSize, itemsTable, payBadge, supplyMark, crmCell, phoneFmt, historyCard, uploadFile, teamTable, teamFormHtml, teamFormData, filterBar, wireFilterBar, filterQs } from './b2b-shared.js';

const KINDS = { fop: 'ФОП', tov: 'ТОВ', other: 'Інша юрособа' };

export function createPartnerPages(ctx = {}) {
  // «Лише перегляд» — без кнопок створення й зміни (сервер теж не дасть).
  const canEdit = () => !ctx.can || ctx.can('b2b.order');
  // Зона перетягування файлів: файл, кинутий на неї, — як вибраний кнопкою. onFiles(File[]).
  let dropGuard = false;
  function dropZone(el, onFiles) {
    if (!el) return;
    // Файл, кинутий повз зону, браузер відкрив би замість сторінки (і заповнена форма пропала б).
    if (!dropGuard) {
      dropGuard = true;
      for (const ev of ['dragover', 'drop']) {
        window.addEventListener(ev, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files') && !e.target.closest?.('.drop-zone')) e.preventDefault(); });
      }
    }
    let depth = 0;
    const on = (v) => el.classList.toggle('drop-on', v);
    el.addEventListener('dragenter', (e) => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; e.preventDefault(); depth++; on(true); });
    el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) on(false); });
    el.addEventListener('drop', (e) => {
      e.preventDefault(); depth = 0; on(false);
      const files = [...(e.dataTransfer?.files || [])].filter((f) => /pdf|image\//i.test(f.type) || /\.(pdf|jpe?g|png|webp|heic)$/i.test(f.name));
      if (!files.length) { toast('Перетягніть PDF або фото маркування', true); return; }
      onFiles(files);
    });
  }
  const supFilter = { status: '', q: '', from: '', to: '' };
  const cliFilter = { status: '', q: '', from: '', to: '', pay: '' };
  const filter = { brand: '', q: '', cat: '', sort: 'brand' };

  // ---------------------------------------------------------------- відкрита закупівля (замовлення без закупівлі)
  // Червоний банер на всю ширину: сума відкритої закупівлі, ліміт, вибір юрособи і «Сформувати рахунок».
  async function openBanner() {
    const [lim, entities] = await Promise.all([api('GET', '/api/b2b/p/limits'), canEdit() ? api('GET', '/api/b2b/p/entities') : []]);
    const o = lim.open;
    const unpaidLine = `<div class="small" style="margin-top:6px">Неоплачені закупівлі: <b>${uah(lim.unpaid.total)}</b> з ліміту ${uah(lim.unpaid.limit)}</div>`;
    if (!o.id) return { html: lim.unpaid.total ? `<div class="small muted" style="margin-bottom:10px">Неоплачені закупівлі: ${uah(lim.unpaid.total)} з ліміту ${uah(lim.unpaid.limit)}</div>` : '', wire: () => {} };
    const full = o.total >= o.limit - 0.01;
    const html = `<div class="alert bad open-banner" style="margin-bottom:12px">
        <div style="font-size:17px"><b>🔴 Закупівля не оплачена</b> — відкрита закупівля <a href="#/porders/${o.id}">${esc(o.number)}</a>:
          <b>${uah(o.total)}</b> з ліміту ${uah(o.limit)} · замовлень без закупівлі: ${o.orders}</div>
        <div class="small" style="margin:4px 0 8px">${full ? '<b>Ліміт вичерпано — нові замовлення без закупівлі неможливі.</b> ' : ''}Оберіть, на кого виставити рахунок, і сформуйте його — після цього можна продовжувати.</div>
        ${canEdit() ? (entities.length ? `<div class="btn-row" style="flex-wrap:wrap">
          <select id="obEnt" aria-label="Юрособа для рахунку" style="max-width:320px">${entities.map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.code)})</option>`).join('')}</select>
          <button class="btn primary" id="obForm">Сформувати рахунок на закупівлю</button></div>`
          : '<a class="btn primary" href="#/pentities">Додати юрособу для рахунку</a>') : ''}
        ${unpaidLine}
      </div>`;
    const wire = (after) => {
      const b = $('#obForm');
      if (!b) return;
      b.onclick = async () => {
        if (!(await confirmDanger(`Сформувати рахунок на ${o.number} (${uah(o.total)})?`, 'Закупівля піде бухгалтеру на рахунок; нові замовлення без закупівлі почнуть нову відкриту закупівлю.', 'Сформувати рахунок'))) return;
        b.disabled = true;
        try { await api('POST', '/api/b2b/p/open/form', { entity_id: Number($('#obEnt').value) }); toast(`Рахунок на ${o.number} замовлено — сповістимо в Telegram`); after(); }
        catch (e) { toast(e.message, true); b.disabled = false; }
      };
    };
    return { html, wire };
  }

  // ---------------------------------------------------------------- каталог
  // Фільтри: бренд (зі знижкою від РРЦ), категорія (з кількістю, у межах бренду), пошук, сортування.
  // Список згрупований за брендами. Вибір запам'ятовується в браузері.
  const FKEY = 'b2b_cat_filter';
  try { Object.assign(filter, JSON.parse(localStorage.getItem(FKEY) || '{}')); } catch { /* приватний режим */ }
  if (filter.sortV !== 2) { filter.sort = 'often'; filter.sortV = 2; } // один раз: спершу те, що партнер замовляє найчастіше
  const saveFilter = () => { try { localStorage.setItem(FKEY, JSON.stringify(filter)); } catch { /* */ } };
  const SORTS = { often: 'Часто замовляю', brand: 'За брендом', name: 'За назвою', cheap: 'Дешевші спочатку', dear: 'Дорожчі спочатку', profit: 'Найбільша вигода' };
  const pct = (v) => `${String(Math.round((Number(v) || 0) * 100) / 100).replace('.', ',')}%`;

  async function viewPartnerCatalog() {
    const { partner, brands, categories = [], products } = await api('GET', '/api/b2b/p/catalog');
    if (filter.brand && !brands.some((b) => String(b.id) === String(filter.brand))) filter.brand = '';
    filter.cat = filter.cat ?? '';
    filter.sort = SORTS[filter.sort] ? filter.sort : 'often';
    const catName = new Map(categories.map((c) => [String(c.id), c.name]));
    const byBrand = (p) => !filter.brand || String(p.brand_id) === String(filter.brand);
    const matchQ = (p) => {
      const q = filter.q.toLowerCase();
      return !q || p.name.toLowerCase().includes(q) || String(p.article || '').toLowerCase().includes(q);
    };
    const draw = () => {
      // категорії — лише ті, що є в обраному бренді, з кількістю
      const inBrand = products.filter(byBrand);
      const counts = inBrand.reduce((m, p) => m.set(String(p.cat), (m.get(String(p.cat)) || 0) + 1), new Map());
      if (filter.cat !== '' && !counts.has(String(filter.cat))) filter.cat = '';
      $('#pcCats').innerHTML = counts.size > 1 ? `<button class="chip ${filter.cat === '' ? 'on' : ''}" data-cat="">Усі категорії · ${inBrand.length}</button>
        ${[...counts].sort((a, b) => (catName.get(a[0]) || '').localeCompare(catName.get(b[0]) || '', 'uk'))
          .map(([id, n]) => `<button class="chip ${String(filter.cat) === id ? 'on' : ''}" data-cat="${esc(id)}">${esc(catName.get(id) || 'Інше')} · ${n}</button>`).join('')}` : '';
      $$('[data-cat]').forEach((b) => (b.onclick = () => { filter.cat = b.dataset.cat; saveFilter(); draw(); }));
      let list = inBrand.filter((p) => (filter.cat === '' || String(p.cat) === String(filter.cat)) && matchQ(p));
      const byBrandName = (a, b) => a.brand.localeCompare(b.brand, 'uk') || a.name.localeCompare(b.name, 'uk');
      const by = {
        often: (a, b) => (b.ordered || 0) - (a.ordered || 0) || (b.ordered_qty || 0) - (a.ordered_qty || 0) || byBrandName(a, b),
        brand: byBrandName,
        name: (a, b) => a.name.localeCompare(b.name, 'uk'),
        cheap: (a, b) => a.price - b.price,
        dear: (a, b) => b.price - a.price,
        profit: (a, b) => (b.rrp - b.price) - (a.rrp - a.price),
      }[filter.sort];
      list = [...list].sort(by);
      const grouped = filter.sort === 'brand' || filter.sort === 'often';
      let lastBrand = null;
      const rowsHtml = list.map((p) => {
        const gk = filter.sort === 'often' && p.ordered ? 'fav' : p.brand_id; // «часто» — окремою групою зверху
        const head = grouped && gk !== lastBrand
          ? (gk === 'fav' ? '<tr class="grp"><td colspan="6"><b>⭐ Часто замовляєте</b></td></tr>'
            : `<tr class="grp"><td colspan="6"><b>${esc(p.brand)}</b> <span class="badge ok">ваша знижка ${pct(p.margin)} від РРЦ</span></td></tr>`) : '';
        lastBrand = gk;
        return `${head}<tr>
          <td style="width:56px">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" style="width:48px;height:48px;object-fit:contain">` : ''}</td>
          <td><b>${esc(p.name)}</b><div class="small muted">${[p.article, catName.get(String(p.cat)), p.ordered ? `замовляли ${p.ordered} раз` : ''].filter(Boolean).map(esc).join(' · ')}</div></td>
          <td class="small hide-m">${esc(p.brand)}</td>
          <td class="r small muted">${money(p.rrp)} грн</td>
          <td class="r small hide-m">${pct(p.margin)}<div class="muted">−${money(p.rrp - p.price)}</div></td>
          <td class="r"><b>${money(p.price)} грн</b></td>
        </tr>`;
      }).join('');
      $('#pcCount').textContent = `Знайдено: ${list.length} з ${products.length}`;
      $('#pcList').innerHTML = list.length ? `<table class="list"><thead><tr><th></th><th>Товар</th><th class="hide-m">Бренд</th><th class="r">РРЦ</th><th class="r hide-m">Знижка від РРЦ</th><th class="r">Ваша ціна</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>`
        : `<div class="card empty"><div class="big">Нічого не знайдено</div>Змініть пошук, бренд чи категорію.
          <div class="btn-row" style="justify-content:center;margin-top:10px"><button class="btn" id="pcReset">Скинути фільтри</button></div></div>`;
      $('#pcReset') && ($('#pcReset').onclick = () => { Object.assign(filter, { brand: '', cat: '', q: '' }); saveFilter(); viewPartnerCatalog(); });
    };
    main.innerHTML = `
      <div class="head-row"><h2>Каталог — ${esc(partner.name)}</h2><div class="btn-row">${products.length ? '<button class="btn" id="pcXlsx">⬇ Excel</button>' : ''}${products.length && canEdit() ? '<a class="btn primary" href="#/porders/new">+ Нова закупівля</a>' : ''}</div></div>
      ${products.length ? `
        <div class="btn-row" style="margin-bottom:8px;flex-wrap:wrap">
          ${brands.length > 1 ? `<button class="chip ${filter.brand ? '' : 'on'}" data-br="">Усі бренди</button>` : ''}
          ${brands.map((b) => `<button class="chip ${String(filter.brand) === String(b.id) || brands.length === 1 ? 'on' : ''}" data-br="${b.id}">${esc(b.name)} <span class="small">−${pct(b.margin)}</span></button>`).join('')}
        </div>
        <div class="btn-row" id="pcCats" style="margin-bottom:8px;flex-wrap:wrap"></div>
        <div class="btn-row" style="margin-bottom:8px;flex-wrap:wrap;align-items:center">
          <input id="pcQ" type="search" placeholder="Пошук за назвою або артикулом" value="${esc(filter.q)}" style="max-width:300px" aria-label="Пошук товару">
          <select id="pcSort" aria-label="Сортування" style="max-width:220px">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${filter.sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <span class="small muted" id="pcCount"></span>
        </div>
        <div class="small muted" style="margin-bottom:8px">Ціни з ПДВ. «Ваша ціна» = РРЦ − ваша знижка на бренд; РРЦ — рекомендована роздрібна ціна.</div>
        <div id="pcList"></div>`
        : '<div class="card empty"><div class="big">Каталог ще порожній</div>Ваш менеджер ще не відкрив вам бренди. Зверніться до нього — після цього товари з’являться тут.</div>'}`;
    if (!products.length) return;
    $$('[data-br]').forEach((b) => (b.onclick = () => { filter.brand = b.dataset.br; filter.cat = ''; saveFilter(); viewPartnerCatalog(); }));
    let t;
    $('#pcQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { filter.q = e.target.value.trim(); saveFilter(); draw(); }, 200); };
    $('#pcSort').onchange = (e) => { filter.sort = e.target.value; saveFilter(); draw(); };
    // Excel: кожна категорія — окремий аркуш; назва, артикул, бренд, РРЦ, ваша ціна, знижка (маржа) від РРЦ у %.
    $('#pcXlsx').onclick = () => {
      const byCat = new Map();
      for (const p of products) {
        const k = String(p.cat);
        if (!byCat.has(k)) byCat.set(k, []);
        byCat.get(k).push(p);
      }
      const cols = [{ title: 'Товар', width: 60 }, { title: 'Артикул', width: 18 }, { title: 'Бренд', width: 16 },
        { title: 'РРЦ, грн', width: 13, fmt: 'money' }, { title: 'Ваша ціна, грн', width: 15, fmt: 'money' }, { title: 'Маржа від РРЦ', width: 14, fmt: 'pct' }];
      const sheets = [...byCat].map(([k, list]) => ({
        name: catName.get(k) || 'Інше',
        cols,
        rows: [...list].sort((a, b) => a.brand.localeCompare(b.brand, 'uk') || a.name.localeCompare(b.name, 'uk'))
          .map((p) => [p.name, p.article || '', p.brand, Number(p.rrp), Number(p.price), Math.round((p.rrp ? ((p.rrp - p.price) / p.rrp) * 100 : 0) * 100) / 100]),
      })).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
      downloadXlsx(`Каталог ${partner.name} ${new Date().toLocaleDateString('uk-UA')}.xlsx`.replace(/[\\/:*?"<>|]+/g, '_'), sheets);
      toast(`Завантажено: ${products.length} товарів, ${sheets.length} ${sheets.length === 1 ? 'аркуш' : 'аркушів'}`);
    };
    draw();
  }

  // ---------------------------------------------------------------- юрособи
  async function viewEntities() {
    const rows = await api('GET', '/api/b2b/p/entities');
    main.innerHTML = `
      <div class="head-row"><h2>Мої юрособи</h2>${canEdit() ? '<button class="btn primary" id="eNew">+ Додати юрособу</button>' : ''}</div>
      <div class="alert info" style="margin-bottom:14px">На ці юрособи виставляються рахунки за закупівлі. Оплату ми бачимо за кодом (ЄДРПОУ / ІПН) —
        платіть, будь ласка, з рахунку тієї юрособи, на яку виставлено рахунок.</div>
      ${rows.length ? `<div class="fop-cards">${rows.map((e) => `<div class="card fop-card" ${e.is_default ? 'style="border-color:var(--accent, #0f766e);border-width:2px"' : ''}>
          <div class="name">${esc(e.name)}${e.is_default ? ' <span class="badge ok">за замовчуванням</span>' : ''}</div>
          <div class="muted small">${esc(KINDS[e.kind] || '')} · ${e.code.length === 8 ? 'ЄДРПОУ' : 'ІПН'} ${esc(e.code)}${e.vat ? ' · платник ПДВ' : ''}</div>
          ${e.iban ? `<div class="small">${esc(e.iban)}</div>` : ''}${e.address ? `<div class="small muted">${esc(e.address)}</div>` : ''}
          ${canEdit() ? `<div class="btn-row" style="margin-top:8px;flex-wrap:wrap"><button class="btn sm" data-ee="${e.id}">Змінити</button>
            ${e.is_default ? `<button class="btn sm" data-edef="${e.id}" data-on="0">Зняти «за замовчуванням»</button>` : `<button class="btn sm" data-edef="${e.id}" data-on="1">★ За замовчуванням</button>`}
            <button class="btn sm danger" data-ed="${e.id}">Видалити</button></div>` : ''}
        </div>`).join('')}</div>`
        : '<div class="card empty"><div class="big">Юросіб ще немає</div>Додайте ФОП або ТОВ, на який виставляти рахунки.</div>'}`;
    const form = (e) => {
      const isNew = !e;
      const m = modal(isNew ? 'Нова юрособа' : `Юрособа «${e.name}»`, `<form id="eF" class="form-stack">
          <label class="f"><span>Тип</span><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${(e?.kind || 'fop') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="f"><span>Повна назва (як у документах) *</span><input name="name" value="${esc(e?.name || '')}" placeholder="ФОП Іваненко Іван Іванович / ТОВ «…»" required></label>
          <label class="f"><span>ЄДРПОУ (8 цифр) або ІПН ФОП (10 цифр) *</span><input name="code" value="${esc(e?.code || '')}" inputmode="numeric" required></label>
          <label class="f"><span>Адреса</span><input name="address" value="${esc(e?.address || '')}"></label>
          <label class="f"><span>IBAN</span><input name="iban" value="${esc(e?.iban || '')}" placeholder="UA…"></label>
          <div class="grid2"><label class="f"><span>Телефон</span><input name="phone" value="${esc(e?.phone || '')}"></label>
            <label class="f"><span>E-mail</span><input name="email" value="${esc(e?.email || '')}"></label></div>
          <label class="check"><input type="checkbox" name="vat" ${e?.vat ? 'checked' : ''}> Платник ПДВ</label>
        </form>`, { footer: `<button class="btn" data-close>Скасувати</button><button class="btn primary" id="eSave">Зберегти</button>` });
      $('#eSave', m.el).onclick = async () => {
        const f = $('#eF', m.el);
        const d = Object.fromEntries(new FormData(f));
        d.vat = f.vat.checked;
        try {
          if (isNew) await api('POST', '/api/b2b/p/entities', d); else await api('PUT', `/api/b2b/p/entities/${e.id}`, d);
          m.close(); toast('Збережено'); viewEntities();
        } catch (er) { toast(er.message, true); }
      };
    };
    $('#eNew') && ($('#eNew').onclick = () => form(null));
    $$('[data-ee]').forEach((b) => (b.onclick = () => form(rows.find((x) => String(x.id) === b.dataset.ee))));
    $$('[data-edef]').forEach((b) => (b.onclick = async () => {
      try {
        await api('POST', `/api/b2b/p/entities/${b.dataset.edef}/default`, { on: b.dataset.on === '1' });
        toast(b.dataset.on === '1' ? 'Тепер ця юрособа обирається в нових закупівлях першою' : 'Знято');
        viewEntities();
      } catch (er) { toast(er.message, true); }
    }));
    $$('[data-ed]').forEach((b) => (b.onclick = async () => {
      const e = rows.find((x) => String(x.id) === b.dataset.ed);
      if (!(await confirmDanger(`Видалити «${e.name}»?`, 'Нові рахунки на неї виставити не вийде. Уже оформлені замовлення не зміняться.', 'Видалити'))) return;
      try { await api('DELETE', `/api/b2b/p/entities/${e.id}`); toast('Видалено'); viewEntities(); } catch (er) { toast(er.message, true); }
    }));
  }

  // ---------------------------------------------------------------- закупівлі
  async function viewOrders(id, mode) {
    if (id === 'new') return orderForm(null);
    if (id && mode === 'edit') return orderForm(id);
    if (id) return viewOrder(id);
    const qs = filterQs(supFilter);
    const { rows, statuses } = await api('GET', `/api/b2b/p/orders${qs ? `?${qs}` : ''}`);
    main.innerHTML = `
      <div class="head-row"><h2>Закупівлі</h2>${canEdit() ? '<a class="btn primary" href="#/porders/new">+ Нова закупівля</a>' : ''}</div>
      <div class="btn-row" style="margin-bottom:8px;flex-wrap:wrap"><button class="chip ${supFilter.status ? '' : 'on'}" data-pst="">Усі</button>
        ${Object.entries(statuses).map(([k, v]) => `<button class="chip ${supFilter.status === k ? 'on' : ''}" data-pst="${k}">${esc(v)}</button>`).join('')}</div>
      ${filterBar(supFilter, { placeholder: '№, юрособа, № рахунку…' })}
      ${rows.length ? `<table class="list"><thead><tr><th>№</th><th class="hide-m">Дата</th><th>Сума</th><th>Статус</th><th class="hide-m">Рахунок</th></tr></thead><tbody>
        ${rows.map((o) => `<tr class="click" data-o="${o.id}">
          <td><b>${esc(o.number)}</b>${o.delivery === 'pickup' ? ' <span class="badge info">🚗 самовивіз</span>' : ''}<div class="small muted">${esc(o.entity.split('\n')[0].split(',')[0])}</div></td>
          <td class="small hide-m">${esc(fmtDateTime(o.created_at))}</td>
          <td><b>${uah(o.total)}</b></td>
          <td>${statusBadge(o)}</td>
          <td class="small hide-m">${o.invoice_no ? `№ ${esc(o.invoice_no)}${o.files ? ` · 📎 ${o.files}` : ''}` : '—'}</td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="card empty"><div class="big">${qs ? 'Нічого не знайдено' : 'Закупівель ще немає'}</div>${qs ? 'Змініть фільтри.' : 'Оберіть товари в каталозі й оформіть першу закупівлю.'}</div>`}`;
    wireFilterBar(supFilter, () => viewOrders());
    $$('[data-pst]').forEach((b) => (b.onclick = () => { supFilter.status = b.dataset.pst; viewOrders(); }));
    $$('[data-o]').forEach((tr) => (tr.onclick = () => { location.hash = `#/porders/${tr.dataset.o}`; }));
  }

  async function viewOrder(id) {
    const { order: o, items, files, history, clients = [], left = [] } = await api('GET', `/api/b2b/p/orders/${id}`);
    const isDraft = o.status === 'draft';
    const editable = ['invoice_wait', 'draft'].includes(o.status) && canEdit();
    const head = ctx.can ? ctx.can('b2b.team') : true;
    const pickup = o.delivery === 'pickup';
    const hasLeft = !pickup && !['cancelled', 'open'].includes(o.status) && left.some((r) => r.left > 0);
    const ob = o.status === 'open' ? await openBanner() : { html: '', wire: () => {} };
    main.innerHTML = `
      ${ob.html}
      <div class="head-row"><h2>Закупівля ${esc(o.number)} ${statusBadge(o)}</h2>
        <div class="btn-row"><a class="btn" href="#/porders">← До списку</a>
          ${isDraft && head ? '<button class="btn primary" id="oSend">Відправити закупівлю</button>' : ''}
          ${editable ? `<a class="btn" href="#/porders/${o.id}/edit">Змінити</a><button class="btn danger" id="oCancel">${isDraft ? 'Видалити чернетку' : 'Скасувати'}</button>` : ''}</div></div>
      ${isDraft ? `<div class="alert warn" style="margin-bottom:12px"><b>Чернетка</b> — її бачить лише ваша команда, нам вона ще не надійшла.
        Менеджери додають товари (у «Нова закупівля» → «Додати до чернетки» або «Змінити»), ${head ? 'а ви натискаєте «Відправити закупівлю», коли все зібрано.' : 'а керівник вашої команди відправляє її нам.'}</div>` : ''}
      <div class="form-page">
        <div class="form-stack">
          <div class="card">${itemsTable(items)}</div>
          ${o.comment ? `<div class="card small"><b>Коментар:</b> ${esc(o.comment)}</div>` : ''}
          ${pickup ? '<div class="alert info">🚗 <b>Самовивіз</b> — усю закупівлю ви забираєте зі складу самі; замовлення клієнтів з неї не оформлюються.</div>' : ''}
          ${o.status !== 'cancelled' && !pickup ? `<div class="card form-stack">
            <div class="head-row"><h3>Замовлення клієнтів із цієї закупівлі</h3>${hasLeft && canEdit() ? `<a class="btn sm primary" href="#/pclients/new/${o.id}">+ Замовлення клієнта</a>` : ''}</div>
            <table class="list"><thead><tr><th>Товар</th><th class="r">Закуплено</th><th class="r">Розписано</th><th class="r">Залишок</th></tr></thead><tbody>
              ${left.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${r.qty}</td><td class="r">${r.used}</td><td class="r"><b>${r.left}</b></td></tr>`).join('')}</tbody></table>
            ${clients.length ? clients.map((x) => `<a class="small" href="#/pclients/${x.id}">${esc(x.number)} · ${esc(x.client_name)} · ${uah(x.total)} · ${esc(x.status_name)}</a>`).join('') : '<div class="small muted">Ще немає.</div>'}
          </div>` : ''}
        </div>
        <div class="form-stack">
          <div class="card form-stack">
            <h3>Рахунок</h3>
            <div class="small" style="white-space:pre-line"><b>Платник:</b> ${esc(o.entity)}</div>
            <div class="small"><b>Отримання:</b> ${esc(o.delivery_name || '')}</div>
            ${o.invoice_no ? `<div><b>Рахунок № ${esc(o.invoice_no)}</b>${o.invoice_date ? ` від ${esc(fmtDay(o.invoice_date))}` : ''}</div>` : '<div class="muted small">Рахунок ще готується — сповістимо в Telegram.</div>'}
            ${o.waybill_no ? `<div>Накладна № ${esc(o.waybill_no)}</div>` : ''}
            ${o.status === 'paid' || o.status === 'done' ? `<div class="badge ok">Оплачено ${esc(fmtDateTime(o.paid_at))}</div>` : ''}
            ${files.length ? `<div class="form-stack">${files.map((f) => `<a class="btn sm" href="/api/b2b/p/files/${f.id}" target="_blank" rel="noopener">📎 ${esc(f.kind_name)}: ${esc(f.name)} <span class="muted">${fileSize(f.size)}</span></a>`).join('')}</div>
              <div class="small muted">Файли зберігаються 30 днів — завантажте їх собі.</div>` : ''}
          </div>
          ${historyCard(history)}
        </div>
      </div>`;
    ob.wire(() => viewOrder(o.id));
    $('#oCancel') && ($('#oCancel').onclick = async () => {
      if (isDraft) {
        if (!(await confirmDanger(`Видалити чернетку ${o.number}?`, 'Товари з неї буде видалено; нам вона не надходила.', 'Видалити чернетку'))) return;
        try { await api('POST', `/api/b2b/p/orders/${o.id}/cancel`); toast('Чернетку видалено'); location.hash = '#/porders'; } catch (e) { toast(e.message, true); }
        return;
      }
      if (!(await confirmDanger(`Скасувати закупівлю ${o.number}?`, 'Замовлення буде скасовано, менеджер отримає сповіщення.', 'Скасувати закупівлю'))) return;
      try { await api('POST', `/api/b2b/p/orders/${o.id}/cancel`); toast('Скасовано'); viewOrder(o.id); } catch (e) { toast(e.message, true); }
    });
    $('#oSend') && ($('#oSend').onclick = async () => {
      if (!(await confirmDanger(`Відправити закупівлю ${o.number} на ${uah(o.total)}?`, 'Ми підготуємо рахунок на вибрану юрособу; змінити закупівлю можна, доки рахунку немає.', 'Відправити закупівлю'))) return;
      try { await api('POST', `/api/b2b/p/orders/${o.id}/send`); toast(`Закупівлю ${o.number} відправлено`); viewOrder(o.id); } catch (e) { toast(e.message, true); }
    });
  }

  // Оформлення або зміна закупівлі: товари з каталогу з кількістю, юрособа, коментар.
  async function orderForm(id) {
    const [{ products, brands }, entities, cur] = await Promise.all([
      api('GET', '/api/b2b/p/catalog'), api('GET', '/api/b2b/p/entities'), id ? api('GET', `/api/b2b/p/orders/${id}`) : null,
    ]);
    if (cur && !['invoice_wait', 'draft'].includes(cur.order.status)) { location.hash = `#/porders/${id}`; return; }
    const head = ctx.can ? ctx.can('b2b.team') : true;
    // Чернетки команди: нову закупівлю можна додати до наявної чернетки (кількості сумуються).
    const drafts = id ? [] : (await api('GET', '/api/b2b/p/orders?status=draft').catch(() => ({ rows: [] }))).rows || [];
    const qty = new Map((cur?.items || []).map((i) => [i.product_id, i.qty]));
    let fb = '';
    let fq = '';
    if (!entities.length) {
      main.innerHTML = `<h2>${id ? 'Зміна закупівлі' : 'Нова закупівля'}</h2><div class="card empty"><div class="big">Спершу додайте юрособу</div>
        На неї виставлятиметься рахунок.<div class="btn-row" style="justify-content:center;margin-top:12px"><a class="btn primary" href="#/pentities">Додати юрособу</a></div></div>`;
      return;
    }
    main.innerHTML = `
      <div class="head-row"><h2>${id ? `Зміна закупівлі ${esc(cur.order.number)}` : 'Нова закупівля'}</h2><a class="btn" href="#/porders${id ? `/${id}` : ''}">← Назад</a></div>
      <div class="form-page">
        <div class="form-stack">
          <div class="btn-row" style="flex-wrap:wrap">
            <button class="chip on" data-fb="">Усі бренди</button>
            ${brands.map((b) => `<button class="chip" data-fb="${b.id}">${esc(b.name)}</button>`).join('')}
            <input id="ofQ" placeholder="Пошук товару" style="max-width:240px">
          </div>
          <div class="card" id="ofList"></div>
        </div>
        <div class="form-stack">
          <div class="card form-stack" style="position:sticky;top:12px">
            <h3>Ваше замовлення</h3>
            <div id="ofSum"></div>
            <div class="f"><span>Як отримуєте товар</span>
              <label class="check"><input type="radio" name="ofDel" value="np" ${cur?.order.delivery === 'pickup' ? '' : 'checked'}> Відправка клієнтам Новою поштою (оформлюю замовлення на клієнтів)</label>
              <label class="check"><input type="radio" name="ofDel" value="pickup" ${cur?.order.delivery === 'pickup' ? 'checked' : ''}> Самовивіз — забираю всю закупівлю зі складу</label></div>
            <label class="f"><span>Рахунок виставити на</span><select id="ofEnt">${entities.map((e) => `<option value="${e.id}" ${String(cur?.order.entity_id) === String(e.id) ? 'selected' : ''}>${esc(e.name)} (${esc(e.code)})</option>`).join('')}</select></label>
            <label class="f"><span>Коментар</span><textarea id="ofComment" rows="2">${esc(cur?.order.comment || '')}</textarea></label>
            ${drafts.length ? `<label class="f"><span>Чернетка</span><select id="ofDraft"><option value="">Нова закупівля</option>
              ${drafts.map((d) => `<option value="${d.id}">Додати до чернетки ${esc(d.number)} (${uah(d.total)}, ${esc(d.created_by || '')})</option>`).join('')}</select></label>` : ''}
            ${id ? `<button class="btn primary" id="ofSave">Зберегти зміни</button>`
              : `${head ? '<button class="btn primary" id="ofSave">Оформити закупівлю</button>' : ''}<button class="btn ${head ? '' : 'primary'}" id="ofDraftSave">${head ? 'Зберегти як чернетку' : 'Зберегти в чернетку'}</button>`}
            <div class="small muted">${head ? 'Після оформлення бухгалтер підготує рахунок — він з’явиться в закупівлі, а вам прийде повідомлення в Telegram. Доки рахунку немає, замовлення можна змінити або скасувати. Чернетку бачить лише ваша команда — її відправляєте ви.'
              : 'Закупівля зберігається в чернетку вашої команди — її відправляє нам керівник. Кілька менеджерів можуть додавати товари в одну чернетку.'}</div>
          </div>
        </div>
      </div>`;
    const sum = () => {
      const lines = products.filter((p) => qty.get(p.id) > 0);
      const total = lines.reduce((t, p) => t + Math.round(p.price * qty.get(p.id) * 100) / 100, 0);
      $('#ofSum').innerHTML = lines.length ? `${lines.map((p) => `<div class="small" style="display:flex;justify-content:space-between;gap:8px"><span>${esc(p.name)} × ${qty.get(p.id)}</span><b>${money(Math.round(p.price * qty.get(p.id) * 100) / 100)}</b></div>`).join('')}
        <div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:6px;margin-top:4px"><b>Разом з ПДВ</b><b>${uah(total)}</b></div>`
        : '<div class="small muted">Вкажіть кількість біля товарів зліва.</div>';
    };
    const draw = () => {
      const q = fq.toLowerCase();
      const list = products.filter((p) => (!fb || String(p.brand_id) === fb) && (!q || p.name.toLowerCase().includes(q) || String(p.article || '').toLowerCase().includes(q)));
      $('#ofList').innerHTML = list.length ? `<table class="list"><thead><tr><th>Товар</th><th class="r">Ціна</th><th class="r">К-сть</th></tr></thead><tbody>
        ${list.map((p) => `<tr><td>${p.ordered ? '<span title="Часто замовляєте">⭐</span> ' : ''}${esc(p.name)}${p.article || p.ordered ? `<div class="small muted">${[p.article, p.ordered ? `замовляли ${p.ordered} раз` : ''].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</td><td class="r"><b>${money(p.price)}</b><div class="small muted">РРЦ ${money(p.rrp)}</div></td>
          <td class="r"><input type="number" min="0" step="1" inputmode="numeric" data-q="${p.id}" value="${qty.get(p.id) || ''}" style="width:80px;text-align:right" aria-label="Кількість: ${esc(p.name)}"></td></tr>`).join('')}</tbody></table>`
        : '<div class="small muted">Нічого не знайдено.</div>';
      $$('[data-q]').forEach((inp) => (inp.oninput = () => {
        const v = Math.max(0, Math.floor(Number(inp.value) || 0));
        if (v) qty.set(Number(inp.dataset.q), v); else qty.delete(Number(inp.dataset.q));
        sum();
      }));
    };
    $$('[data-fb]').forEach((b) => (b.onclick = () => { fb = b.dataset.fb; $$('[data-fb]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    $('#ofQ').oninput = (e) => { fq = e.target.value.trim(); draw(); };
    const submit = async (draft) => {
      const items = [...qty].filter(([, q]) => q > 0).map(([product_id, q]) => ({ product_id, qty: q }));
      if (!items.length) { toast('Вкажіть кількість хоча б одного товару', true); return; }
      const body = { entity_id: Number($('#ofEnt').value), items, comment: $('#ofComment').value, delivery: $('input[name="ofDel"]:checked')?.value || 'np' };
      const toDraft = draft && $('#ofDraft')?.value ? Number($('#ofDraft').value) : 0;
      $$('#ofSave, #ofDraftSave').forEach((b) => { b.disabled = true; });
      try {
        if (id) { await api('PUT', `/api/b2b/p/orders/${id}`, body); toast('Зміни збережено'); location.hash = `#/porders/${id}`; }
        else {
          const r = await api('POST', '/api/b2b/p/orders', { ...body, draft, to_draft: toDraft || undefined });
          toast(r.draft ? (toDraft ? `Товари додано до чернетки ${r.number}` : `Чернетку ${r.number} збережено`) : `Закупівлю ${r.number} оформлено`);
          location.hash = `#/porders/${r.id}`;
        }
      } catch (e) { toast(e.message, true); $$('#ofSave, #ofDraftSave').forEach((b) => { b.disabled = false; }); }
    };
    $('#ofSave') && ($('#ofSave').onclick = () => submit(false));
    $('#ofDraftSave') && ($('#ofDraftSave').onclick = () => submit(true));
    $('#ofDraft') && ($('#ofDraft').onchange = (e) => { if ($('#ofSave')) $('#ofSave').hidden = !!e.target.value; });
    draw();
    sum();
  }


  // ---------------------------------------------------------------- замовлення клієнтів
  async function viewClients(id, mode) {
    if (id === 'new') return clientForm(null, mode);
    if (id && mode === 'edit') return clientForm(id);
    if (id) return viewClient(id);
    const qs = filterQs(cliFilter);
    const [{ rows, statuses }, ob] = await Promise.all([api('GET', `/api/b2b/p/clients${qs ? `?${qs}` : ''}`), openBanner()]);
    main.innerHTML = `
      <div class="head-row"><h2>Замовлення клієнтів</h2>${canEdit() ? '<a class="btn primary" href="#/pclients/new">+ Замовлення клієнта</a>' : ''}</div>
      ${ob.html}
      <div class="small muted" style="margin-bottom:10px">Замовлення, яке ви оформлюєте для свого клієнта: товари з вашої закупівлі, ваша ТТН і маркування.
        <span class="badge bad">Без закупівлі</span> — товари не з закупівлі, менеджер виставить рахунок окремо.</div>
      <div class="btn-row" style="margin-bottom:8px;flex-wrap:wrap"><button class="chip ${cliFilter.status ? '' : 'on'}" data-pst="">Усі</button>
        ${Object.entries(statuses).map(([k, v]) => `<button class="chip ${cliFilter.status === k ? 'on' : ''}" data-pst="${k}">${esc(v)}</button>`).join('')}</div>
      ${filterBar(cliFilter, { pay: true })}
      ${rows.length ? `<table class="list"><thead><tr><th>№</th><th>Клієнт</th><th class="r">Сума</th><th>Статус</th><th class="hide-m">Оплата</th><th class="hide-m">CRM</th></tr></thead><tbody>
        ${rows.map((o) => `<tr class="click ${o.no_supply && o.status !== 'cancelled' ? 'row-bad' : ''}" data-o="${o.id}">
          <td><b>${esc(o.number)}</b><div>${supplyMark(o)}</div><div class="small muted hide-m">${esc(fmtDateTime(o.created_at))}</div></td>
          <td>${esc(o.client_name)}<div class="small muted">${esc(phoneFmt(o.client_phone))}${o.ttn ? ` · ТТН ${esc(o.ttn)}` : ''}</div></td>
          <td class="r"><b>${uah(o.total)}</b></td>
          <td>${statusBadge(o)}</td>
          <td class="hide-m">${payBadge(o)}</td>
          <td class="hide-m">${crmCell(o)}</td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="card empty"><div class="big">${qs ? 'Нічого не знайдено' : 'Замовлень клієнтів ще немає'}</div>${qs ? 'Змініть фільтри.' : 'Відкрийте закупівлю і натисніть «+ Замовлення клієнта» або створіть замовлення тут.'}</div>`}`;
    wireFilterBar(cliFilter, () => viewClients());
    ob.wire(() => viewClients());
    $$('[data-pst]').forEach((b) => (b.onclick = () => { cliFilter.status = b.dataset.pst; viewClients(); }));
    $$('[data-o]').forEach((tr) => (tr.onclick = () => { location.hash = `#/pclients/${tr.dataset.o}`; }));
  }

  async function viewClient(id) {
    const [{ order: o, items, files, history, missing = [] }, docTypes] = await Promise.all([api('GET', `/api/b2b/p/clients/${id}`), api('GET', '/api/b2b/p/doc-types').catch(() => [])]);
    const editable = o.status === 'new' && canEdit();
    main.innerHTML = `
      <div class="head-row"><h2>Замовлення ${esc(o.number)} ${statusBadge(o)} ${payBadge(o)}</h2>
        <div class="btn-row"><a class="btn" href="#/pclients">← До списку</a>
          ${editable ? `<a class="btn" href="#/pclients/${o.id}/edit">Змінити</a><button class="btn danger" id="cCancel">Скасувати</button>` : ''}</div></div>
      ${o.no_supply && o.status !== 'cancelled' ? '<div class="alert bad" style="margin-bottom:12px"><b>Без закупівлі.</b> Товари не з вашої закупівлі — менеджер виставить на них рахунок окремо.</div>' : ''}
      ${!o.no_supply && o.pay !== 'paid' && o.status !== 'cancelled' ? `<div class="alert warn" style="margin-bottom:12px">Закупівля <a href="#/porders/${o.supply_id}">${esc(o.supply_number)}</a> ще не оплачена — замовлення позначене як неоплачене.</div>` : ''}
      <div class="form-page">
        <div class="form-stack">
          <div class="card">${itemsTable(items)}</div>
          ${o.comment ? `<div class="card small"><b>Коментар:</b> ${esc(o.comment)}</div>` : ''}
        </div>
        <div class="form-stack">
          <div class="card form-stack">
            <h3>Клієнт і доставка</h3>
            <div><b>${esc(o.client_name)}</b><div>${esc(phoneFmt(o.client_phone))}</div></div>
            <div>ТТН: ${o.ttn ? `<b>${esc(o.ttn)}</b>` : '<span class="muted">не вказано</span>'}</div>
            <div>${o.no_supply ? supplyMark(o) : `Із закупівлі <a href="#/porders/${o.supply_id}">${esc(o.supply_number)}</a>`}</div>
          </div>
          <div class="card form-stack">
            <h3>Статус у CRM</h3>
            ${o.crm_id ? `<div>Замовлення № <b>${esc(o.crm_id)}</b></div><div>${o.crm_status ? `<span class="badge info">${esc(o.crm_status)}</span>` : '<span class="small muted">статус оновиться за кілька хвилин</span>'}</div>`
              : (o.status === 'crm' ? '<div>Передано в роботу.</div>' : '<div class="small muted">Ще не передано — менеджер перевірить замовлення й передасть його в роботу.</div>')}
          </div>
          <div class="card form-stack">
            <h3>Файли</h3>
            ${missing.length && o.status === 'new' ? `<div class="alert bad small">Бракує: <b>${missing.map(esc).join(', ')}</b> — без цього замовлення не передадуть у роботу.</div>` : ''}
            ${files.length ? files.map((f) => `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <a class="btn sm" href="/api/b2b/p/files/${f.id}" target="_blank" rel="noopener">${f.kind === 'doc' ? '📄' : '📎'} ${esc(f.kind_name)}: ${esc(f.name)}</a><span class="small muted">${fileSize(f.size)}</span>
              ${editable && ['label', 'doc'].includes(f.kind) ? `<button class="btn sm danger" data-fdel="${f.id}" aria-label="Видалити файл">✕</button>` : ''}</div>`).join('') : '<div class="small muted">Файлів ще немає.</div>'}
            ${editable ? `<div class="drop-zone" id="cDrop"><div class="drop-hint">Перетягніть файл маркування сюди або <label class="btn sm">+ Файл маркування (етикетка ТТН)<input type="file" id="cUp" accept=".pdf,image/*" hidden></label></div></div>
              ${docTypes.map((t) => `<div class="drop-zone" id="cDocZone${t.id}"><div class="drop-hint">${esc(t.name)}${t.required ? ' *' : ''}: перетягніть сюди або <label class="btn sm">+ Додати<input type="file" data-cdoc="${t.id}" accept=".pdf,image/*" hidden></label></div></div>`).join('')}
              <div class="small muted">PDF або фото до 5 МБ. Файли зберігаються 30 днів.</div>` : ''}
          </div>
          ${historyCard(history)}
        </div>
      </div>`;
    $('#cCancel') && ($('#cCancel').onclick = async () => {
      if (!(await confirmDanger(`Скасувати замовлення ${o.number}?`, 'Товари повернуться в залишок закупівлі.', 'Скасувати замовлення'))) return;
      try { await api('POST', `/api/b2b/p/clients/${o.id}/cancel`); toast('Скасовано'); viewClient(o.id); } catch (e) { toast(e.message, true); }
    });
    const upLabels = async (files) => {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) { toast(`Файл «${file.name}» завеликий (до 5 МБ)`, true); continue; }
        try { const r = await uploadFile(`/api/b2b/p/clients/${o.id}/files`, file); toast(r.warnings?.length ? `Маркування додано. ⚠️ ${r.warnings.join('; ')}` : 'Маркування додано', !!r.warnings?.length); } catch (er) { toast(`${file.name}: ${er.message}`, true); }
      }
      viewClient(o.id);
    };
    $('#cUp') && ($('#cUp').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) upLabels(f); });
    dropZone($('#cDrop'), upLabels);
    const upDocs = async (tid, list) => {
      for (const file of list) {
        if (file.size > 5 * 1024 * 1024) { toast(`Файл «${file.name}» завеликий (до 5 МБ)`, true); continue; }
        try { await uploadFile(`/api/b2b/p/clients/${o.id}/files?type=${tid}`, file); toast('Документ додано'); } catch (er) { toast(`${file.name}: ${er.message}`, true); }
      }
      viewClient(o.id);
    };
    for (const t of editable ? docTypes : []) dropZone($(`#cDocZone${t.id}`), (f) => upDocs(t.id, f));
    $$('[data-cdoc]').forEach((inp) => (inp.onchange = () => { const f = [...inp.files]; inp.value = ''; if (f.length) upDocs(Number(inp.dataset.cdoc), f); }));
    $$('[data-fdel]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmDanger('Видалити файл?', '', 'Видалити'))) return;
      try { await api('DELETE', `/api/b2b/p/clients/${o.id}/files/${b.dataset.fdel}`); toast('Видалено'); viewClient(o.id); } catch (er) { toast(er.message, true); }
    }));
  }

  // Оформлення / зміна: джерело товарів (закупівля із залишком або «без закупівлі» — каталог), клієнт, ТТН.
  async function clientForm(id, presetSupply) {
    const [supplies, catalog, cur, docTypes] = await Promise.all([
      api('GET', '/api/b2b/p/supplies'), api('GET', '/api/b2b/p/catalog'), id ? api('GET', `/api/b2b/p/clients/${id}`) : null,
      api('GET', '/api/b2b/p/doc-types').catch(() => []),
    ]);
    if (cur && cur.order.status !== 'new') { location.hash = `#/pclients/${id}`; return; }
    // Закупівля поточного замовлення — із залишком з урахуванням його власних позицій.
    if (cur?.order.supply_id && !cur.order.open_supply) {
      const own = new Map(cur.items.map((i) => [i.product_id, i.qty]));
      const s = supplies.find((x) => x.id === cur.order.supply_id);
      if (s) s.items.forEach((i) => { i.left += own.get(i.product_id) || 0; });
      else {
        const d = await api('GET', `/api/b2b/p/orders/${cur.order.supply_id}`).catch(() => null);
        if (d) supplies.unshift({ id: d.order.id, number: d.order.number, pay: '', items: d.left.map((r) => ({ ...r, left: r.left + (own.get(r.product_id) || 0) })) });
      }
    }
    const lim = await api('GET', '/api/b2b/p/limits');
    let source = cur ? String(cur.order.open_supply ? '' : (cur.order.supply_id || '')) : (presetSupply || (supplies[0] ? String(supplies[0].id) : ''));
    const qty = new Map((cur?.items || []).map((i) => [i.product_id, i.qty]));
    const o = cur?.order || {};
    const payTxt = { paid: 'оплачено', partial: 'частково оплачено', unpaid: 'не оплачено' };
    main.innerHTML = `
      <div class="head-row"><h2>${id ? `Зміна замовлення ${esc(o.number)}` : 'Нове замовлення клієнта'}</h2><a class="btn" href="#/pclients${id ? `/${id}` : ''}">← Назад</a></div>
      <div class="form-page">
        <div class="form-stack">
          <div class="card form-stack">
            <h3>1. З якої закупівлі відправляємо</h3>
            <div class="src-cards" role="radiogroup" aria-label="Закупівля">
              ${supplies.map((s) => `<label class="src-card ${String(s.id) === source ? 'on' : ''}">
                <input type="radio" name="cfSrc" value="${s.id}" ${String(s.id) === source ? 'checked' : ''}>
                <span class="src-head"><b>${esc(s.number)}</b>${s.pay ? `<span class="badge ${s.pay === 'paid' ? 'ok' : 'warn'}">${esc(payTxt[s.pay] || '')}</span>` : ''}</span>
                <span class="small muted">${s.invoice_no ? `Рахунок № ${esc(s.invoice_no)} · ` : 'Рахунок ще готується · '}${esc(fmtDay(s.created_at))}${s.total ? ` · ${uah(s.total)}` : ''}</span>
                <span class="small">Залишок: ${s.items.filter((i) => i.left > 0).map((i) => `${esc(i.name)} — ${i.left}`).join('; ')}</span>
              </label>`).join('')}
              <label class="src-card bad ${source === '' ? 'on' : ''}">
                <input type="radio" name="cfSrc" value="" ${source === '' ? 'checked' : ''}>
                <span class="src-head"><b>Без закупівлі</b><span class="badge bad">червоним</span></span>
                <span class="small muted">Товари з каталогу за вашою ціною — додаються у відкриту закупівлю${lim.open.id ? ` ${esc(lim.open.number)}` : ''}:
                  <b>${uah(lim.open.total)}</b> з ліміту ${uah(lim.open.limit)}. Рахунок на неї формуєте самі.</span>
              </label>
            </div>
            ${supplies.length ? '' : '<div class="small muted">Закупівель із залишком немає — можна оформити без закупівлі або спершу оформити закупівлю.</div>'}
          </div>
          <h3 style="margin:4px 0 0">2. Товари й кількість</h3>
          <div id="cfWarn"></div>
          <div class="card" id="cfList"></div>
        </div>
        <div class="form-stack">
          <form class="card form-stack" id="cfForm" style="position:sticky;top:12px">
            <h3>Клієнт</h3>
            <label class="f"><span>ПІБ клієнта *</span><input name="client_name" value="${esc(o.client_name || '')}" required autocomplete="off"></label>
            <label class="f"><span>Телефон *</span><input name="client_phone" value="${esc(o.client_phone || '')}" inputmode="tel" placeholder="0XXXXXXXXX" required></label>
            <label class="f"><span>ТТН (ваша)</span><input name="ttn" value="${esc(o.ttn || '')}" inputmode="numeric" placeholder="20450000000000"></label>
            <label class="f"><span>Коментар</span><textarea name="comment" rows="2">${esc(o.comment || '')}</textarea></label>
            <div class="f"><span>Маркування (етикетка ТТН) *</span>
              <div class="drop-zone" id="cfDrop">
                <div id="cfFileList" class="form-stack" style="gap:6px"></div>
                <div class="drop-hint">Перетягніть файл сюди або <label class="btn sm">+ Додати маркування<input type="file" id="cfFiles" accept=".pdf,image/*" multiple hidden></label></div>
              </div></div>
            <div class="small muted">PDF або фото до 5 МБ; можна кілька, зайве — ✕. Те саме маркування двічі (в одне чи різні замовлення) додати не можна.</div>
            ${docTypes.map((t) => `<div class="f"><span>${esc(t.name)}${t.required ? ' *' : ''}</span>
              <div class="drop-zone" id="cfDocZone${t.id}"><div id="cfDocList${t.id}" class="form-stack" style="gap:6px"></div>
                <div class="drop-hint">Перетягніть файл сюди або <label class="btn sm">+ Додати<input type="file" data-doc="${t.id}" accept=".pdf,image/*" multiple hidden></label></div></div></div>`).join('')}
            ${docTypes.length ? '' : '<div class="small muted">Свої документи для клієнта (чек, накладна тощо) можна додати у «Налаштуваннях».</div>'}
            <div id="cfSum"></div>
            <button class="btn primary" id="cfSave">${id ? 'Зберегти зміни' : 'Оформити замовлення'}</button>
          </form>
        </div>
      </div>`;
    const often = new Map(catalog.products.map((p, i) => [p.id, { n: p.ordered || 0, i }]));
    const byOften = (a, b) => (often.get(b.product_id)?.n || 0) - (often.get(a.product_id)?.n || 0) || (often.get(a.product_id)?.i ?? 1e9) - (often.get(b.product_id)?.i ?? 1e9);
    const lines = () => {
      if (!source) return catalog.products.map((p) => ({ product_id: p.id, name: p.name, article: p.article, price: p.price, left: null }));
      return [...(supplies.find((s) => String(s.id) === source)?.items || [])].sort(byOften); // часті — першими
    };
    const sum = () => {
      const ls = lines().filter((l) => qty.get(l.product_id) > 0);
      const total = ls.reduce((t, l) => t + Math.round(l.price * qty.get(l.product_id) * 100) / 100, 0);
      $('#cfSum').innerHTML = ls.length ? `<div style="display:flex;justify-content:space-between"><b>Разом з ПДВ</b><b>${uah(total)}</b></div>` : '<div class="small muted">Вкажіть кількість товарів.</div>';
    };
    const draw = () => {
      const s = supplies.find((x) => String(x.id) === source);
      $('#cfWarn').innerHTML = !source ? '<div class="alert bad"><b>Без закупівлі.</b> Замовлення буде підсвічене червоним; менеджер виставить рахунок на ці товари окремо.</div>'
        : (s && s.pay && s.pay !== 'paid' ? `<div class="alert warn">Закупівля ${esc(s.number)} ще не оплачена — замовлення буде позначене як неоплачене.</div>` : '');
      const ls = lines();
      $('#cfList').innerHTML = ls.length ? `<table class="list"><thead><tr><th>Товар</th><th class="r">Ціна</th>${source ? '<th class="r">Залишок</th>' : ''}<th class="r">К-сть</th></tr></thead><tbody>
        ${ls.map((l) => `<tr><td>${esc(l.name)}${l.article ? `<div class="small muted">${esc(l.article)}</div>` : ''}</td><td class="r">${money(l.price)}</td>
          ${source ? `<td class="r">${l.left}</td>` : ''}
          <td class="r"><input type="number" min="0" step="1" ${source ? `max="${l.left}"` : ''} inputmode="numeric" data-q="${l.product_id}" value="${qty.get(l.product_id) || ''}" style="width:80px;text-align:right" aria-label="Кількість: ${esc(l.name)}"></td></tr>`).join('')}</tbody></table>`
        : '<div class="small muted">Немає доступних товарів.</div>';
      $$('[data-q]').forEach((inp) => (inp.oninput = () => {
        let v = Math.max(0, Math.floor(Number(inp.value) || 0));
        if (inp.max && v > Number(inp.max)) { v = Number(inp.max); inp.value = v; }
        if (v) qty.set(Number(inp.dataset.q), v); else qty.delete(Number(inp.dataset.q));
        sum();
      }));
      sum();
    };
    $$('input[name="cfSrc"]').forEach((r) => (r.onchange = () => {
      source = r.value; qty.clear();
      $$('.src-card').forEach((c) => c.classList.toggle('on', c.contains(r)));
      draw();
    }));
    // Маркування: уже збережені (при зміні замовлення) — з ✕ одразу на сайті; нові — у списку до збереження.
    const saved = [...(cur?.files || []).filter((f) => f.kind === 'label')];
    const pending = []; // { file, ttn }
    const drawFiles = () => {
      $('#cfFileList').innerHTML = [...saved.map((f) => ({ name: f.name, size: f.size, saved: f.id })), ...pending.map((x, i) => ({ name: x.file.name, size: x.file.size, idx: i, ttn: x.ttn }))]
        .map((f) => `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="small">📎 ${esc(f.name)} <span class="muted">${fileSize(f.size)}${f.ttn ? ` · ТТН ${esc(f.ttn)}` : ''}${f.saved ? ' · збережено' : ''}</span></span>
          <button type="button" class="btn sm danger" ${f.saved ? `data-fsaved="${f.saved}"` : `data-fpend="${f.idx}"`} aria-label="Прибрати маркування ${esc(f.name)}">✕</button></div>`).join('')
        || '<div class="small muted">Ще не додано.</div>';
      $$('[data-fpend]').forEach((b) => (b.onclick = () => { pending.splice(Number(b.dataset.fpend), 1); drawFiles(); }));
      $$('[data-fsaved]').forEach((b) => (b.onclick = async () => {
        if (!(await confirmDanger('Видалити маркування?', 'Файл буде видалено із замовлення.', 'Видалити'))) return;
        try { await api('DELETE', `/api/b2b/p/clients/${id}/files/${b.dataset.fsaved}`); saved.splice(saved.findIndex((f) => String(f.id) === b.dataset.fsaved), 1); drawFiles(); toast('Маркування видалено'); } catch (er) { toast(er.message, true); }
      }));
    };
    drawFiles();
    // Документи партнера за видами (з «Налаштувань»): збережені — з ✕ одразу, нові — до збереження замовлення.
    const docSaved = new Map(docTypes.map((t) => [t.id, (cur?.files || []).filter((f) => f.kind === 'doc' && f.doc_type === t.id)]));
    const docPend = new Map(docTypes.map((t) => [t.id, []]));
    const drawDocs = (tid) => {
      const box = $(`#cfDocList${tid}`);
      if (!box) return;
      box.innerHTML = [...docSaved.get(tid).map((f) => ({ name: f.name, size: f.size, saved: f.id })), ...docPend.get(tid).map((f, i) => ({ name: f.name, size: f.size, idx: i }))]
        .map((f) => `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="small">📄 ${esc(f.name)} <span class="muted">${fileSize(f.size)}${f.saved ? ' · збережено' : ''}</span></span>
          <button type="button" class="btn sm danger" ${f.saved ? `data-dsaved="${f.saved}"` : `data-dpend="${f.idx}"`} data-dt="${tid}" aria-label="Прибрати ${esc(f.name)}">✕</button></div>`).join('')
        || '<div class="small muted">Ще не додано.</div>';
      $$(`[data-dpend][data-dt="${tid}"]`, box).forEach((b) => (b.onclick = () => { docPend.get(tid).splice(Number(b.dataset.dpend), 1); drawDocs(tid); }));
      $$(`[data-dsaved][data-dt="${tid}"]`, box).forEach((b) => (b.onclick = async () => {
        if (!(await confirmDanger('Видалити документ?', 'Файл буде видалено із замовлення.', 'Видалити'))) return;
        try { await api('DELETE', `/api/b2b/p/clients/${id}/files/${b.dataset.dsaved}`); docSaved.set(tid, docSaved.get(tid).filter((f) => String(f.id) !== b.dataset.dsaved)); drawDocs(tid); } catch (er) { toast(er.message, true); }
      }));
    };
    const addDocs = (tid, files) => {
      for (const f of files) {
        if (f.size > 5 * 1024 * 1024) { toast(`Файл «${f.name}» завеликий (до 5 МБ)`, true); continue; }
        if (docPend.get(tid).some((x) => x.name === f.name && x.size === f.size)) { toast(`«${f.name}» уже додано`, true); continue; }
        docPend.get(tid).push(f);
      }
      drawDocs(tid);
    };
    for (const t of docTypes) {
      drawDocs(t.id);
      dropZone($(`#cfDocZone${t.id}`), (files) => addDocs(t.id, files));
    }
    $$('[data-doc]').forEach((inp) => (inp.onchange = () => { const f = [...inp.files]; inp.value = ''; addDocs(Number(inp.dataset.doc), f); }));
    // Новий файл: перевірка на дубль (той самий файл чи ТТН в іншому замовленні), і з маркування НП — ПІБ, телефон, ТТН.
    const addLabels = async (files) => {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) { toast(`Файл «${file.name}» завеликий (до 5 МБ)`, true); continue; }
        if (pending.some((x) => x.file.name === file.name && x.file.size === file.size)) { toast(`«${file.name}» уже додано`, true); continue; }
        let r = {};
        try {
          const res = await fetch(`/api/b2b/p/parse-label${id ? `?except=${id}` : ''}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
          r = await res.json();
        } catch { /* розбір не вдався — додаємо без перевірки, сервер перевірить при збереженні */ }
        if (r.dup) { toast(`«${file.name}»: ${r.dup_text}`, true); continue; }
        if (r.ttn && pending.some((x) => x.ttn === r.ttn)) { toast(`«${file.name}»: маркування з ТТН ${r.ttn} уже додано`, true); continue; }
        pending.push({ file, ttn: r.ttn || '' });
        drawFiles();
        if (r.found) fillFromLabel(r);
      }
    };
    $('#cfFiles').onchange = () => { const files = [...$('#cfFiles').files]; $('#cfFiles').value = ''; addLabels(files); };
    dropZone($('#cfDrop'), addLabels);
    // Маркування Нової пошти → ПІБ, телефон і ТТН клієнта (порожні поля заповнюються, різницю показуємо).
    const fillFromLabel = (r) => {
      {
        const fm = $('#cfForm');
        const diff = [];
        for (const [k, label] of [['client_name', 'ПІБ'], ['client_phone', 'телефон'], ['ttn', 'ТТН']]) {
          if (!r[k]) continue;
          const cur = fm[k].value.trim();
          const norm = (v) => String(v).replace(/\D/g, '').replace(/^38(?=0)/, '');
          if (!cur) fm[k].value = r[k];
          else if ((k === 'client_name' ? cur.toLowerCase() !== r[k].toLowerCase() : norm(cur) !== norm(r[k]))) diff.push(`${label}: у маркуванні «${r[k]}»`);
        }
        if (r.address && !fm.comment.value.trim()) fm.comment.value = `НП: ${r.address}`;
        toast(diff.length ? `⚠️ Дані відрізняються від маркування — ${diff.join('; ')}` : 'Дані клієнта підтягнуто з маркування', diff.length > 0);
      }
    };
    $('#cfForm').onsubmit = async (e) => {
      e.preventDefault();
      const allowed = new Set(lines().map((l) => l.product_id));
      const items = [...qty].filter(([pid, q]) => q > 0 && allowed.has(pid)).map(([product_id, q]) => ({ product_id, qty: q }));
      if (!items.length) { toast('Вкажіть кількість хоча б одного товару', true); return; }
      const body = { ...Object.fromEntries(new FormData(e.target)), supply_id: source ? Number(source) : null, items };
      const files = pending.map((x) => x.file);
      // Обов'язкові: маркування завжди, документи з позначкою «обов'язковий».
      const lack = [...(saved.length + pending.length ? [] : ['маркування']), ...docTypes.filter((t) => t.required && !docSaved.get(t.id).length && !docPend.get(t.id).length).map((t) => t.name)];
      if (lack.length) { toast(`Додайте: ${lack.join(', ')}`, true); return; }
      if (!(await confirmOrder(body, items))) return;
      $('#cfSave').disabled = true;
      let orderId = id;
      try {
        if (id) await api('PUT', `/api/b2b/p/clients/${id}`, body);
        else orderId = (await api('POST', '/api/b2b/p/clients', body)).id;
      } catch (er) { toast(er.message, true); $('#cfSave').disabled = false; return; }
      // Маркування — після збереження замовлення; якщо файл не пройшов, замовлення вже є — його можна додати на сторінці замовлення.
      let failed = 0;
      for (const f of files) { try { await uploadFile(`/api/b2b/p/clients/${orderId}/files`, f); } catch (er) { failed++; toast(`${f.name}: ${er.message}`, true); } }
      for (const [tid, list] of docPend) for (const f of list) { try { await uploadFile(`/api/b2b/p/clients/${orderId}/files?type=${tid}`, f); } catch (er) { failed++; toast(`${f.name}: ${er.message}`, true); } }
      toast(id ? 'Зміни збережено' : 'Замовлення оформлено' + (files.length && !failed ? ' разом із маркуванням' : ''));
      location.hash = `#/pclients/${orderId}`;
    };
    // Підтвердження перед збереженням: товари й кількість, звідки, клієнт, телефон, ТТН, маркування.
    const confirmOrder = (body, items) => new Promise((resolve) => {
      const byId = new Map(lines().map((l) => [l.product_id, l]));
      const rows = items.map((x) => ({ ...byId.get(x.product_id), qty: x.qty }));
      const total = rows.reduce((t, l) => t + Math.round(l.price * l.qty * 100) / 100, 0);
      const s = supplies.find((x) => String(x.id) === source);
      const labels = [...saved.map((f) => f.name), ...pending.map((x) => x.file.name)];
      const m = modal('Перевірте замовлення', `<div class="form-stack">
          <table class="list"><thead><tr><th>Товар</th><th class="r">К-сть</th><th class="r">Сума</th></tr></thead><tbody>
            ${rows.map((l) => `<tr><td>${esc(l.name)}${l.article ? `<div class="small muted">${esc(l.article)}</div>` : ''}</td><td class="r"><b>${l.qty} шт</b></td><td class="r">${money(Math.round(l.price * l.qty * 100) / 100)}</td></tr>`).join('')}
            <tr><td colspan="2"><b>Разом з ПДВ</b></td><td class="r"><b>${uah(total)}</b></td></tr></tbody></table>
          <div>${source ? `Із закупівлі <b>${esc(s?.number || '')}</b>` : '<span class="badge bad">Без закупівлі</span> — у відкриту закупівлю'}</div>
          <div class="card form-stack" style="gap:4px">
            <div>Отримувач: <b>${esc(body.client_name)}</b></div>
            <div>Телефон: <b>${esc(phoneFmt(body.client_phone))}</b></div>
            <div>ТТН: ${body.ttn ? `<b>${esc(body.ttn)}</b>` : '<span class="badge warn">не вказано</span>'}</div>
            <div>Маркування: ${labels.length ? labels.map(esc).join(', ') : '<span class="badge warn">не додано</span>'}</div>
            ${docTypes.map((t) => { const n = [...docSaved.get(t.id).map((f) => f.name), ...docPend.get(t.id).map((f) => f.name)]; return `<div>${esc(t.name)}: ${n.length ? n.map(esc).join(', ') : `<span class="badge ${t.required ? 'bad' : 'warn'}">не додано</span>`}</div>`; }).join('')}
            ${body.comment ? `<div class="small">Коментар: ${esc(body.comment)}</div>` : ''}
          </div>
          <div class="small muted">Перевірте товари, кількість і дані отримувача — після передачі в роботу змінити їх зможе лише менеджер.</div></div>`,
        { footer: '<button class="btn" id="coBack">← Виправити</button><button class="btn primary" id="coOk">Усе правильно — оформити</button>', wide: true });
      let done = false;
      const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
      $('#coBack', m.el).onclick = () => finish(false);
      $('#coOk', m.el).onclick = () => finish(true);
      $$('[data-close]', m.el).forEach((b) => b.addEventListener('click', () => finish(false)));
    });
    draw();
  }


  // ---------------------------------------------------------------- команда (керівник партнера)
  // Команда — блок у «Налаштуваннях» (box) або окрема сторінка (старі посилання #/pteam ведуть у «Налаштування»).
  async function viewTeam(box = null) {
    if (!box) { location.hash = '#/psettings'; return; }
    const { users, roles, max, me } = await api('GET', '/api/b2b/p/team');
    box.innerHTML = `
      <div class="head-row" style="margin:0"><h3 style="margin:0">Команда</h3>${users.length < max ? '<button class="btn primary sm" id="uNew">+ Додати колегу</button>' : ''}</div>
      <div class="small muted">Додавайте колег, щоб кожен входив під своїм логіном. Ролі:
        <b>Керівник</b> — усе, включно з командою, налаштуваннями й відправкою закупівель; <b>Менеджер</b> — каталог, чернетки закупівель, замовлення клієнтів, юрособи;
        <b>Лише перегляд</b> — бачить усе, але нічого не змінює. Ваш менеджер у Ековент бачить склад команди. До ${max} користувачів.</div>
      ${teamTable(users, { me, showAdded: false })}`;
    const form = (u) => {
      const self = u && u.id === me;
      const m = modal(u ? `Користувач ${u.login}` : 'Новий колега', teamFormHtml(u, roles, { self }),
        { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="puSave">Зберегти</button>' });
      $('#puSave', m.el).onclick = async () => {
        try {
          const d = teamFormData($('#puF', m.el));
          if (u) await api('PUT', `/api/b2b/p/team/${u.id}`, d); else await api('POST', '/api/b2b/p/team', d);
          m.close(); toast(u ? 'Збережено' : 'Колегу додано — передайте йому логін і пароль'); viewTeam(box);
        } catch (e) { toast(e.message, true); }
      };
    };
    $('#uNew', box) && ($('#uNew', box).onclick = () => form(null));
    $$('[data-ue]', box).forEach((b) => (b.onclick = () => form(users.find((x) => String(x.id) === b.dataset.ue))));
  }

  // ---------------------------------------------------------------- інструкція
  function viewPartnerHelp() {
    main.innerHTML = `
      <h2>Інструкція для партнера</h2>
      <div class="card form-stack" style="max-width:820px">
        <h3>1. Каталог</h3>
        <p>У розділі «Каталог» — товари брендів, відкритих вам менеджером. Для кожного товару видно <b>РРЦ</b> (рекомендовану роздрібну ціну)
          і <b>вашу ціну</b> як партнера. Ціни з ПДВ. Пошук — за назвою або артикулом; кнопки вгорі — фільтр за брендом.</p>
        <h3>2. Юрособи</h3>
        <p>У «Мої юрособи» додайте ФОП або ТОВ, на які виставляти рахунки: повна назва, ЄДРПОУ (8 цифр) або ІПН ФОП (10 цифр), адреса, IBAN.
          Юрособ може бути скільки завгодно. Оплачуйте рахунок з рахунку тієї юрособи, на яку його виставлено, — так оплата зарахується автоматично.</p>
        <h3>3. Закупівля</h3>
        <p>«Закупівлі» → «Нова закупівля»: вкажіть кількість біля потрібних товарів, оберіть юрособу і натисніть «Оформити закупівлю».
          Статуси: <b>Очікує рахунок</b> → <b>Очікує оплату</b> (рахунок готовий — файл у закупівлі) → <b>Оплачено</b> → <b>Завершено</b>.
          Доки рахунку немає, закупівлю можна змінити або скасувати. Файли рахунку й накладної зберігаються 30 днів — завантажте їх собі.</p>
        <h3>4. Замовлення клієнтів</h3>
        <p>«Замовлення клієнтів» → «+ Замовлення клієнта» (або кнопка в самій закупівлі): оберіть закупівлю, з якої відправляємо товар, вкажіть кількість
          (не більше залишку), ПІБ і телефон клієнта та вашу ТТН. Після оформлення додайте <b>файл маркування</b> (етикетку ТТН, PDF або фото).
          Якщо закупівля ще не оплачена, замовлення можна оформити — воно буде позначене «Не оплачено».
          Можна оформити і <b>без закупівлі</b> (товари з каталогу) — таке замовлення підсвічується червоним, рахунок на нього менеджер виставить окремо.</p>
        <p>Менеджер перевіряє замовлення й передає його в роботу (у нашу CRM) — після цього у замовленні видно номер і статус у CRM.
          Доки замовлення не передане, його можна змінити або скасувати.</p>
        <p><b>Маркування через Telegram:</b> у вашій групі з ботом натисніть «Відповісти» на повідомлення бота «📦 Нове замовлення клієнта B2B-…»
          і прикріпіть файл маркування (PDF Нової пошти або фото). Бот збереже його до цього замовлення, прочитає ТТН і перевірить телефон одержувача.</p>
        <h3>5. Команда</h3>
        <p>Керівник у «Налаштуваннях» → «Команда» додає колег із власним логіном і паролем і обирає роль: <b>Керівник</b> (усе, включно з командою),
          <b>Менеджер</b> (каталог, закупівлі, замовлення клієнтів, юрособи) або <b>Лише перегляд</b>. Вимкнений користувач більше не зможе увійти.</p>
        <h3>6. Сповіщення в Telegram</h3>
        <p>Натисніть «Telegram» угорі сторінки, потім «Підключити Telegram» і «Start» у боті. Приходитимуть повідомлення про рахунки, оплату й зміну цін.</p>
        <h3>7. Пароль і безпека</h3>
        <p>Змінити пароль — кнопка «Пароль» угорі. Не передавайте логін іншим: для кожного співробітника менеджер може створити окремий вхід.</p>
        <h3>Питання</h3>
        <p>Звертайтеся до вашого менеджера в ТОВ «Ековент Дистриб’юшн».</p>
      </div>`;
  }

  // ---------------------------------------------------------------- налаштування партнера: види документів
  async function viewSettings() {
    let types = await api('GET', '/api/b2b/p/doc-types');
    const head = ctx.can ? ctx.can('b2b.team') : true;
    main.innerHTML = `<div class="head-row"><h2>Налаштування</h2></div>
      ${head ? '<div class="card form-stack" id="setTeam" style="max-width:980px;margin-bottom:14px"><span class="spinner"></span></div>' : ''}
      <div id="setDocs"></div>`;
    if (head) viewTeam($('#setTeam')).catch((e) => { $('#setTeam').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; });
    const draw = () => {
      $('#setDocs').innerHTML = `
        <div class="card form-stack" style="max-width:980px">
          <h3>Документи до замовлень клієнтів</h3>
          <div class="small muted">Маркування (етикетка ТТН) потрібне завжди. Тут — ваші документи для клієнта: чек, накладна, гарантійний талон тощо (до 5).
            У замовленні для кожного буде окреме поле. <b>Обов’язковий</b> — без нього замовлення не оформити й не передати в роботу.
            <b>Друкувати</b> — ми отримуємо його разом із маркуванням і вкладаємо в посилку.</div>
          <table class="list"><thead><tr><th>Назва документа</th><th class="r">Обов’язковий</th><th class="r">Друкувати</th>${head ? '<th></th>' : ''}</tr></thead><tbody>
            ${types.map((t, i) => `<tr>
              <td>${head ? `<input data-tn="${i}" value="${esc(t.name)}" maxlength="60" aria-label="Назва документа" placeholder="Напр. Чек для клієнта" style="width:100%">` : esc(t.name)}</td>
              <td class="r"><input type="checkbox" data-tr="${i}" ${t.required ? 'checked' : ''} ${head ? '' : 'disabled'} aria-label="Обов’язковий"></td>
              <td class="r"><input type="checkbox" data-tp="${i}" ${t.print ? 'checked' : ''} ${head ? '' : 'disabled'} aria-label="Друкувати"></td>
              ${head ? `<td class="r"><button class="btn sm danger" data-tdel="${i}" aria-label="Прибрати">✕</button></td>` : ''}</tr>`).join('')
              || `<tr><td colspan="4" class="small muted">Ще немає — лише маркування.</td></tr>`}
          </tbody></table>
          ${head ? `<div class="btn-row">${types.length < 5 ? '<button class="btn" id="tAdd">+ Додати документ</button>' : ''}<button class="btn primary" id="tSave">Зберегти</button></div>`
            : '<div class="small muted">Змінює керівник вашої команди.</div>'}
        </div>`;
      if (!head) return;
      const sync = () => {
        types = types.map((t, i) => ({ ...t, name: $(`[data-tn="${i}"]`)?.value ?? t.name, required: $(`[data-tr="${i}"]`)?.checked ?? t.required, print: $(`[data-tp="${i}"]`)?.checked ?? t.print }));
      };
      $('#tAdd') && ($('#tAdd').onclick = () => { sync(); types.push({ id: 0, name: '', required: false, print: true }); draw(); $(`[data-tn="${types.length - 1}"]`)?.focus(); });
      $$('[data-tdel]').forEach((b) => (b.onclick = () => { sync(); types.splice(Number(b.dataset.tdel), 1); draw(); }));
      $('#tSave').onclick = async () => {
        sync();
        try { types = (await api('PUT', '/api/b2b/p/doc-types', { types: types.filter((t) => t.name.trim()) })).types; toast('Збережено'); draw(); } catch (e) { toast(e.message, true); }
      };
    };
    draw();
  }

  return { viewPartnerCatalog, viewPartnerHelp, viewEntities, viewOrders, viewClients, viewTeam, viewSettings };
}
