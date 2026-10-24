// Кабінет партнера (B2B): каталог, юрособи, закупівлі (оформлення, зміна до рахунку, файли), замовлення клієнтів, інструкція.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime } from '../core/ui.js';
import { uah, statusBadge, fmtDay, fileSize, itemsTable, payBadge, supplyMark, crmCell, phoneFmt, historyCard, uploadFile, teamTable, teamFormHtml, teamFormData, filterBar, wireFilterBar, filterQs } from './b2b-shared.js';

const KINDS = { fop: 'ФОП', tov: 'ТОВ', other: 'Інша юрособа' };

export function createPartnerPages(ctx = {}) {
  // «Лише перегляд» — без кнопок створення й зміни (сервер теж не дасть).
  const canEdit = () => !ctx.can || ctx.can('b2b.order');
  const supFilter = { status: '', q: '', from: '', to: '' };
  const cliFilter = { status: '', q: '', from: '', to: '', pay: '' };
  const filter = { brand: '', q: '', cat: '', sort: 'brand' };

  // ---------------------------------------------------------------- каталог
  // Фільтри: бренд (зі знижкою від РРЦ), категорія (з кількістю, у межах бренду), пошук, сортування.
  // Список згрупований за брендами. Вибір запам'ятовується в браузері.
  const FKEY = 'b2b_cat_filter';
  try { Object.assign(filter, JSON.parse(localStorage.getItem(FKEY) || '{}')); } catch { /* приватний режим */ }
  const saveFilter = () => { try { localStorage.setItem(FKEY, JSON.stringify(filter)); } catch { /* */ } };
  const SORTS = { brand: 'За брендом', name: 'За назвою', cheap: 'Дешевші спочатку', dear: 'Дорожчі спочатку', profit: 'Найбільша вигода' };
  const pct = (v) => `${String(Math.round((Number(v) || 0) * 100) / 100).replace('.', ',')}%`;

  async function viewPartnerCatalog() {
    const { partner, brands, categories = [], products } = await api('GET', '/api/b2b/p/catalog');
    if (filter.brand && !brands.some((b) => String(b.id) === String(filter.brand))) filter.brand = '';
    filter.cat = filter.cat ?? '';
    filter.sort = SORTS[filter.sort] ? filter.sort : 'brand';
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
      const by = {
        brand: (a, b) => a.brand.localeCompare(b.brand, 'uk') || a.name.localeCompare(b.name, 'uk'),
        name: (a, b) => a.name.localeCompare(b.name, 'uk'),
        cheap: (a, b) => a.price - b.price,
        dear: (a, b) => b.price - a.price,
        profit: (a, b) => (b.rrp - b.price) - (a.rrp - a.price),
      }[filter.sort];
      list = [...list].sort(by);
      const grouped = filter.sort === 'brand';
      let lastBrand = null;
      const rowsHtml = list.map((p) => {
        const head = grouped && p.brand_id !== lastBrand
          ? `<tr class="grp"><td colspan="6"><b>${esc(p.brand)}</b> <span class="badge ok">ваша знижка ${pct(p.margin)} від РРЦ</span></td></tr>` : '';
        lastBrand = p.brand_id;
        return `${head}<tr>
          <td style="width:56px">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" style="width:48px;height:48px;object-fit:contain">` : ''}</td>
          <td><b>${esc(p.name)}</b><div class="small muted">${[p.article, catName.get(String(p.cat))].filter(Boolean).map(esc).join(' · ')}</div></td>
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
      <div class="head-row"><h2>Каталог — ${esc(partner.name)}</h2>${products.length && canEdit() ? '<a class="btn primary" href="#/porders/new">+ Нова закупівля</a>' : ''}</div>
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
    draw();
  }

  // ---------------------------------------------------------------- юрособи
  async function viewEntities() {
    const rows = await api('GET', '/api/b2b/p/entities');
    main.innerHTML = `
      <div class="head-row"><h2>Мої юрособи</h2>${canEdit() ? '<button class="btn primary" id="eNew">+ Додати юрособу</button>' : ''}</div>
      <div class="alert info" style="margin-bottom:14px">На ці юрособи виставляються рахунки за закупівлі. Оплату ми бачимо за кодом (ЄДРПОУ / ІПН) —
        платіть, будь ласка, з рахунку тієї юрособи, на яку виставлено рахунок.</div>
      ${rows.length ? `<div class="fop-cards">${rows.map((e) => `<div class="card fop-card">
          <div class="name">${esc(e.name)}</div>
          <div class="muted small">${esc(KINDS[e.kind] || '')} · ${e.code.length === 8 ? 'ЄДРПОУ' : 'ІПН'} ${esc(e.code)}${e.vat ? ' · платник ПДВ' : ''}</div>
          ${e.iban ? `<div class="small">${esc(e.iban)}</div>` : ''}${e.address ? `<div class="small muted">${esc(e.address)}</div>` : ''}
          ${canEdit() ? `<div class="btn-row" style="margin-top:8px"><button class="btn sm" data-ee="${e.id}">Змінити</button><button class="btn sm danger" data-ed="${e.id}">Видалити</button></div>` : ''}
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
          <td><b>${esc(o.number)}</b><div class="small muted">${esc(o.entity.split('\n')[0].split(',')[0])}</div></td>
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
    const editable = o.status === 'invoice_wait' && canEdit();
    const hasLeft = o.status !== 'cancelled' && left.some((r) => r.left > 0);
    main.innerHTML = `
      <div class="head-row"><h2>Закупівля ${esc(o.number)} ${statusBadge(o)}</h2>
        <div class="btn-row"><a class="btn" href="#/porders">← До списку</a>
          ${editable ? `<a class="btn" href="#/porders/${o.id}/edit">Змінити</a><button class="btn danger" id="oCancel">Скасувати</button>` : ''}</div></div>
      <div class="form-page">
        <div class="form-stack">
          <div class="card">${itemsTable(items)}</div>
          ${o.comment ? `<div class="card small"><b>Коментар:</b> ${esc(o.comment)}</div>` : ''}
          ${o.status !== 'cancelled' ? `<div class="card form-stack">
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
            ${o.invoice_no ? `<div><b>Рахунок № ${esc(o.invoice_no)}</b>${o.invoice_date ? ` від ${esc(fmtDay(o.invoice_date))}` : ''}</div>` : '<div class="muted small">Рахунок ще готується — сповістимо в Telegram.</div>'}
            ${o.waybill_no ? `<div>Накладна № ${esc(o.waybill_no)}</div>` : ''}
            ${o.status === 'paid' || o.status === 'done' ? `<div class="badge ok">Оплачено ${esc(fmtDateTime(o.paid_at))}</div>` : ''}
            ${files.length ? `<div class="form-stack">${files.map((f) => `<a class="btn sm" href="/api/b2b/p/files/${f.id}" target="_blank" rel="noopener">📎 ${esc(f.kind_name)}: ${esc(f.name)} <span class="muted">${fileSize(f.size)}</span></a>`).join('')}</div>
              <div class="small muted">Файли зберігаються 30 днів — завантажте їх собі.</div>` : ''}
          </div>
          ${historyCard(history)}
        </div>
      </div>`;
    $('#oCancel') && ($('#oCancel').onclick = async () => {
      if (!(await confirmDanger(`Скасувати закупівлю ${o.number}?`, 'Замовлення буде скасовано, менеджер отримає сповіщення.', 'Скасувати закупівлю'))) return;
      try { await api('POST', `/api/b2b/p/orders/${o.id}/cancel`); toast('Скасовано'); viewOrder(o.id); } catch (e) { toast(e.message, true); }
    });
  }

  // Оформлення або зміна закупівлі: товари з каталогу з кількістю, юрособа, коментар.
  async function orderForm(id) {
    const [{ products, brands }, entities, cur] = await Promise.all([
      api('GET', '/api/b2b/p/catalog'), api('GET', '/api/b2b/p/entities'), id ? api('GET', `/api/b2b/p/orders/${id}`) : null,
    ]);
    if (cur && cur.order.status !== 'invoice_wait') { location.hash = `#/porders/${id}`; return; }
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
            <label class="f"><span>Рахунок виставити на</span><select id="ofEnt">${entities.map((e) => `<option value="${e.id}" ${String(cur?.order.entity_id) === String(e.id) ? 'selected' : ''}>${esc(e.name)} (${esc(e.code)})</option>`).join('')}</select></label>
            <label class="f"><span>Коментар</span><textarea id="ofComment" rows="2">${esc(cur?.order.comment || '')}</textarea></label>
            <button class="btn primary" id="ofSave">${id ? 'Зберегти зміни' : 'Оформити закупівлю'}</button>
            <div class="small muted">Після оформлення бухгалтер підготує рахунок — він з’явиться в закупівлі, а вам прийде повідомлення в Telegram.
              Доки рахунку немає, замовлення можна змінити або скасувати.</div>
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
        ${list.map((p) => `<tr><td>${esc(p.name)}${p.article ? `<div class="small muted">${esc(p.article)}</div>` : ''}</td><td class="r"><b>${money(p.price)}</b><div class="small muted">РРЦ ${money(p.rrp)}</div></td>
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
    $('#ofSave').onclick = async () => {
      const items = [...qty].filter(([, q]) => q > 0).map(([product_id, q]) => ({ product_id, qty: q }));
      if (!items.length) { toast('Вкажіть кількість хоча б одного товару', true); return; }
      const body = { entity_id: Number($('#ofEnt').value), items, comment: $('#ofComment').value };
      $('#ofSave').disabled = true;
      try {
        if (id) { await api('PUT', `/api/b2b/p/orders/${id}`, body); toast('Зміни збережено'); location.hash = `#/porders/${id}`; }
        else { const r = await api('POST', '/api/b2b/p/orders', body); toast(`Закупівлю ${r.number} оформлено`); location.hash = `#/porders/${r.id}`; }
      } catch (e) { toast(e.message, true); $('#ofSave').disabled = false; }
    };
    draw();
    sum();
  }


  // ---------------------------------------------------------------- замовлення клієнтів
  async function viewClients(id, mode) {
    if (id === 'new') return clientForm(null, mode);
    if (id && mode === 'edit') return clientForm(id);
    if (id) return viewClient(id);
    const qs = filterQs(cliFilter);
    const { rows, statuses } = await api('GET', `/api/b2b/p/clients${qs ? `?${qs}` : ''}`);
    main.innerHTML = `
      <div class="head-row"><h2>Замовлення клієнтів</h2>${canEdit() ? '<a class="btn primary" href="#/pclients/new">+ Замовлення клієнта</a>' : ''}</div>
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
    $$('[data-pst]').forEach((b) => (b.onclick = () => { cliFilter.status = b.dataset.pst; viewClients(); }));
    $$('[data-o]').forEach((tr) => (tr.onclick = () => { location.hash = `#/pclients/${tr.dataset.o}`; }));
  }

  async function viewClient(id) {
    const { order: o, items, files, history } = await api('GET', `/api/b2b/p/clients/${id}`);
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
            ${files.length ? files.map((f) => `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <a class="btn sm" href="/api/b2b/p/files/${f.id}" target="_blank" rel="noopener">📎 ${esc(f.kind_name)}: ${esc(f.name)}</a><span class="small muted">${fileSize(f.size)}</span>
              ${editable && f.kind === 'label' ? `<button class="btn sm danger" data-fdel="${f.id}" aria-label="Видалити файл">✕</button>` : ''}</div>`).join('') : '<div class="small muted">Файлів ще немає.</div>'}
            ${editable ? `<label class="btn sm">+ Файл маркування (етикетка ТТН)<input type="file" id="cUp" accept=".pdf,image/*" hidden></label>
              <div class="small muted">PDF або фото до 5 МБ. Файли зберігаються 30 днів.</div>` : ''}
          </div>
          ${historyCard(history)}
        </div>
      </div>`;
    $('#cCancel') && ($('#cCancel').onclick = async () => {
      if (!(await confirmDanger(`Скасувати замовлення ${o.number}?`, 'Товари повернуться в залишок закупівлі.', 'Скасувати замовлення'))) return;
      try { await api('POST', `/api/b2b/p/clients/${o.id}/cancel`); toast('Скасовано'); viewClient(o.id); } catch (e) { toast(e.message, true); }
    });
    $('#cUp') && ($('#cUp').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { const r = await uploadFile(`/api/b2b/p/clients/${o.id}/files`, file); toast(r.warnings?.length ? `Маркування додано. ⚠️ ${r.warnings.join('; ')}` : 'Маркування додано', !!r.warnings?.length); viewClient(o.id); } catch (er) { toast(er.message, true); }
    });
    $$('[data-fdel]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmDanger('Видалити файл?', '', 'Видалити'))) return;
      try { await api('DELETE', `/api/b2b/p/clients/${o.id}/files/${b.dataset.fdel}`); toast('Видалено'); viewClient(o.id); } catch (er) { toast(er.message, true); }
    }));
  }

  // Оформлення / зміна: джерело товарів (закупівля із залишком або «без закупівлі» — каталог), клієнт, ТТН.
  async function clientForm(id, presetSupply) {
    const [supplies, catalog, cur] = await Promise.all([
      api('GET', '/api/b2b/p/supplies'), api('GET', '/api/b2b/p/catalog'), id ? api('GET', `/api/b2b/p/clients/${id}`) : null,
    ]);
    if (cur && cur.order.status !== 'new') { location.hash = `#/pclients/${id}`; return; }
    // Закупівля поточного замовлення — із залишком з урахуванням його власних позицій.
    if (cur?.order.supply_id) {
      const own = new Map(cur.items.map((i) => [i.product_id, i.qty]));
      const s = supplies.find((x) => x.id === cur.order.supply_id);
      if (s) s.items.forEach((i) => { i.left += own.get(i.product_id) || 0; });
      else {
        const d = await api('GET', `/api/b2b/p/orders/${cur.order.supply_id}`).catch(() => null);
        if (d) supplies.unshift({ id: d.order.id, number: d.order.number, pay: '', items: d.left.map((r) => ({ ...r, left: r.left + (own.get(r.product_id) || 0) })) });
      }
    }
    let source = cur ? String(cur.order.supply_id || '') : (presetSupply || (supplies[0] ? String(supplies[0].id) : ''));
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
                <span class="small muted">Товари з каталогу за вашою ціною — менеджер виставить на них рахунок окремо.</span>
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
            <label class="f"><span>Маркування (етикетка ТТН)${cur?.files?.length ? ` — вже додано: ${cur.files.length}` : ''}</span>
              <input type="file" id="cfFiles" accept=".pdf,image/*" multiple></label>
            <div class="small muted">PDF або фото до 5 МБ; можна кілька. Менеджер завантажить його зі свого боку.</div>
            <div id="cfSum"></div>
            <button class="btn primary" id="cfSave">${id ? 'Зберегти зміни' : 'Оформити замовлення'}</button>
          </form>
        </div>
      </div>`;
    const lines = () => {
      if (!source) return catalog.products.map((p) => ({ product_id: p.id, name: p.name, article: p.article, price: p.price, left: null }));
      return (supplies.find((s) => String(s.id) === source)?.items || []);
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
    $('#cfForm').onsubmit = async (e) => {
      e.preventDefault();
      const allowed = new Set(lines().map((l) => l.product_id));
      const items = [...qty].filter(([pid, q]) => q > 0 && allowed.has(pid)).map(([product_id, q]) => ({ product_id, qty: q }));
      if (!items.length) { toast('Вкажіть кількість хоча б одного товару', true); return; }
      const body = { ...Object.fromEntries(new FormData(e.target)), supply_id: source ? Number(source) : null, items };
      const files = [...$('#cfFiles').files];
      const big = files.find((f) => f.size > 5 * 1024 * 1024);
      if (big) { toast(`Файл «${big.name}» завеликий (до 5 МБ)`, true); return; }
      $('#cfSave').disabled = true;
      let orderId = id;
      try {
        if (id) await api('PUT', `/api/b2b/p/clients/${id}`, body);
        else orderId = (await api('POST', '/api/b2b/p/clients', body)).id;
      } catch (er) { toast(er.message, true); $('#cfSave').disabled = false; return; }
      // Маркування — після збереження замовлення; якщо файл не пройшов, замовлення вже є — його можна додати на сторінці замовлення.
      let failed = 0;
      for (const f of files) { try { await uploadFile(`/api/b2b/p/clients/${orderId}/files`, f); } catch (er) { failed++; toast(`${f.name}: ${er.message}`, true); } }
      toast(id ? 'Зміни збережено' : 'Замовлення оформлено' + (files.length && !failed ? ' разом із маркуванням' : ''));
      location.hash = `#/pclients/${orderId}`;
    };
    draw();
  }


  // ---------------------------------------------------------------- команда (керівник партнера)
  async function viewTeam() {
    const { users, roles, max, me } = await api('GET', '/api/b2b/p/team');
    main.innerHTML = `
      <div class="head-row"><h2>Команда</h2>${users.length < max ? '<button class="btn primary" id="uNew">+ Додати колегу</button>' : ''}</div>
      <div class="alert info" style="margin-bottom:14px">Додавайте колег, щоб кожен входив під своїм логіном. Ролі:
        <b>Керівник</b> — усе, включно з командою; <b>Менеджер</b> — каталог, закупівлі, замовлення клієнтів, юрособи;
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
          m.close(); toast(u ? 'Збережено' : 'Колегу додано — передайте йому логін і пароль'); viewTeam();
        } catch (e) { toast(e.message, true); }
      };
    };
    $('#uNew') && ($('#uNew').onclick = () => form(null));
    $$('[data-ue]').forEach((b) => (b.onclick = () => form(users.find((x) => String(x.id) === b.dataset.ue))));
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
        <p>Керівник у вкладці «Команда» додає колег із власним логіном і паролем і обирає роль: <b>Керівник</b> (усе, включно з командою),
          <b>Менеджер</b> (каталог, закупівлі, замовлення клієнтів, юрособи) або <b>Лише перегляд</b>. Вимкнений користувач більше не зможе увійти.</p>
        <h3>6. Сповіщення в Telegram</h3>
        <p>Натисніть «Telegram» угорі сторінки, потім «Підключити Telegram» і «Start» у боті. Приходитимуть повідомлення про рахунки, оплату й зміну цін.</p>
        <h3>7. Пароль і безпека</h3>
        <p>Змінити пароль — кнопка «Пароль» угорі. Не передавайте логін іншим: для кожного співробітника менеджер може створити окремий вхід.</p>
        <h3>Питання</h3>
        <p>Звертайтеся до вашого менеджера в ТОВ «Ековент Дистриб’юшн».</p>
      </div>`;
  }

  return { viewPartnerCatalog, viewPartnerHelp, viewEntities, viewOrders, viewClients, viewTeam };
}
