// Кабінет партнера (B2B): каталог, юрособи, закупівлі (оформлення, зміна до рахунку, файли), інструкція.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime } from '../core/ui.js';
import { uah, statusBadge, fmtDay, fileSize, itemsTable } from './b2b-shared.js';

const KINDS = { fop: 'ФОП', tov: 'ТОВ', other: 'Інша юрособа' };

export function createPartnerPages() {
  let filter = { brand: '', q: '' };

  // ---------------------------------------------------------------- каталог
  async function viewPartnerCatalog() {
    const { partner, brands, products } = await api('GET', '/api/b2b/p/catalog');
    const draw = () => {
      const q = filter.q.toLowerCase();
      const list = products.filter((p) => (!filter.brand || String(p.brand_id) === String(filter.brand))
        && (!q || p.name.toLowerCase().includes(q) || String(p.article || '').toLowerCase().includes(q)));
      $('#pcList').innerHTML = list.length ? `<table class="list"><thead><tr><th></th><th>Товар</th><th class="hide-m">Бренд</th><th class="r">РРЦ</th><th class="r">Ваша ціна</th></tr></thead><tbody>
        ${list.map((p) => `<tr>
          <td style="width:56px">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" style="width:48px;height:48px;object-fit:contain">` : ''}</td>
          <td><b>${esc(p.name)}</b>${p.article ? `<div class="small muted">${esc(p.article)}</div>` : ''}</td>
          <td class="small hide-m">${esc(p.brand)}</td>
          <td class="r small muted">${money(p.rrp)} грн</td>
          <td class="r"><b>${money(p.price)} грн</b></td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="card empty"><div class="big">Нічого не знайдено</div>Спробуйте інший пошук або бренд.</div>';
    };
    main.innerHTML = `
      <div class="head-row"><h2>Каталог — ${esc(partner.name)}</h2>${products.length ? '<a class="btn primary" href="#/porders/new">+ Нова закупівля</a>' : ''}</div>
      ${products.length ? `
        <div class="btn-row" style="margin-bottom:12px;flex-wrap:wrap">
          <button class="chip ${filter.brand ? '' : 'on'}" data-br="">Усі бренди</button>
          ${brands.map((b) => `<button class="chip ${String(filter.brand) === String(b.id) ? 'on' : ''}" data-br="${b.id}">${esc(b.name)}</button>`).join('')}
          <input id="pcQ" placeholder="Пошук за назвою або артикулом" value="${esc(filter.q)}" style="max-width:280px">
        </div>
        <div class="small muted" style="margin-bottom:8px">Ціни з ПДВ. «Ваша ціна» — ціна для вас як партнера; РРЦ — рекомендована роздрібна ціна.</div>
        <div id="pcList"></div>`
        : '<div class="card empty"><div class="big">Каталог ще порожній</div>Ваш менеджер ще не відкрив вам бренди. Зверніться до нього — після цього товари з’являться тут.</div>'}`;
    if (!products.length) return;
    $$('[data-br]').forEach((b) => (b.onclick = () => { filter.brand = b.dataset.br; viewPartnerCatalog(); }));
    $('#pcQ').oninput = (e) => { filter.q = e.target.value.trim(); draw(); };
    draw();
  }

  // ---------------------------------------------------------------- юрособи
  async function viewEntities() {
    const rows = await api('GET', '/api/b2b/p/entities');
    main.innerHTML = `
      <div class="head-row"><h2>Мої юрособи</h2><button class="btn primary" id="eNew">+ Додати юрособу</button></div>
      <div class="alert info" style="margin-bottom:14px">На ці юрособи виставляються рахунки за закупівлі. Оплату ми бачимо за кодом (ЄДРПОУ / ІПН) —
        платіть, будь ласка, з рахунку тієї юрособи, на яку виставлено рахунок.</div>
      ${rows.length ? `<div class="fop-cards">${rows.map((e) => `<div class="card fop-card">
          <div class="name">${esc(e.name)}</div>
          <div class="muted small">${esc(KINDS[e.kind] || '')} · ${e.code.length === 8 ? 'ЄДРПОУ' : 'ІПН'} ${esc(e.code)}${e.vat ? ' · платник ПДВ' : ''}</div>
          ${e.iban ? `<div class="small">${esc(e.iban)}</div>` : ''}${e.address ? `<div class="small muted">${esc(e.address)}</div>` : ''}
          <div class="btn-row" style="margin-top:8px"><button class="btn sm" data-ee="${e.id}">Змінити</button><button class="btn sm danger" data-ed="${e.id}">Видалити</button></div>
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
    $('#eNew').onclick = () => form(null);
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
    const { rows } = await api('GET', '/api/b2b/p/orders');
    main.innerHTML = `
      <div class="head-row"><h2>Закупівлі</h2><a class="btn primary" href="#/porders/new">+ Нова закупівля</a></div>
      ${rows.length ? `<table class="list"><thead><tr><th>№</th><th class="hide-m">Дата</th><th>Сума</th><th>Статус</th><th class="hide-m">Рахунок</th></tr></thead><tbody>
        ${rows.map((o) => `<tr class="click" data-o="${o.id}">
          <td><b>${esc(o.number)}</b><div class="small muted">${esc(o.entity.split('\n')[0].split(',')[0])}</div></td>
          <td class="small hide-m">${esc(fmtDateTime(o.created_at))}</td>
          <td><b>${uah(o.total)}</b></td>
          <td>${statusBadge(o)}</td>
          <td class="small hide-m">${o.invoice_no ? `№ ${esc(o.invoice_no)}${o.files ? ` · 📎 ${o.files}` : ''}` : '—'}</td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="card empty"><div class="big">Закупівель ще немає</div>Оберіть товари в каталозі й оформіть першу закупівлю.</div>'}`;
    $$('[data-o]').forEach((tr) => (tr.onclick = () => { location.hash = `#/porders/${tr.dataset.o}`; }));
  }

  async function viewOrder(id) {
    const { order: o, items, files, history } = await api('GET', `/api/b2b/p/orders/${id}`);
    const editable = o.status === 'invoice_wait';
    main.innerHTML = `
      <div class="head-row"><h2>Закупівля ${esc(o.number)} ${statusBadge(o)}</h2>
        <div class="btn-row"><a class="btn" href="#/porders">← До списку</a>
          ${editable ? `<a class="btn" href="#/porders/${o.id}/edit">Змінити</a><button class="btn danger" id="oCancel">Скасувати</button>` : ''}</div></div>
      <div class="form-page">
        <div class="form-stack">
          <div class="card">${itemsTable(items)}</div>
          ${o.comment ? `<div class="card small"><b>Коментар:</b> ${esc(o.comment)}</div>` : ''}
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
          <div class="card"><h3>Історія</h3>${history.map((h) => `<div class="small"><span class="muted">${esc(fmtDateTime(h.at))}</span> · ${esc(h.action)}${h.user_name ? ` <span class="muted">(${esc(h.user_name)})</span>` : ''}</div>`).join('')}</div>
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
        <h3>4. Сповіщення в Telegram</h3>
        <p>Натисніть «Telegram» угорі сторінки, потім «Підключити Telegram» і «Start» у боті. Приходитимуть повідомлення про рахунки, оплату й зміну цін.</p>
        <h3>5. Пароль і безпека</h3>
        <p>Змінити пароль — кнопка «Пароль» угорі. Не передавайте логін іншим: для кожного співробітника менеджер може створити окремий вхід.</p>
        <h3>Питання</h3>
        <p>Звертайтеся до вашого менеджера в ТОВ «Ековент Дистриб’юшн».</p>
      </div>`;
  }

  return { viewPartnerCatalog, viewPartnerHelp, viewEntities, viewOrders };
}
