// B2B (власник і адміністратори): партнери, їхні користувачі, бренди й маржа, каталог з цінами з LP-CRM,
// закупівлі (рахунок, накладна, файли), замовлення клієнтів партнерів (передача в LP-CRM).
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, modal, confirmDanger, fmtDateTime } from '../core/ui.js';
import { uah, statusBadge, fmtDay, fileSize, itemsTable, uploadFile, payBadge, supplyMark, crmCell, phoneFmt, historyCard, teamTable, teamFormHtml, teamFormData, filterBar, wireFilterBar, filterQs, selCell, selHead, wireBulk, bulkBar } from './b2b-shared.js';

const pct = (v) => `${String(Number(v) || 0).replace('.', ',')}%`;

export function createB2bPages(ctx = {}) {
  // Додавати, змінювати й видаляти людей (користувачів партнерів) і партнерів — лише з правом «people».
  const people = () => !ctx.can || ctx.can('people');
  // ---------------------------------------------------------------- партнери
  async function viewPartners(id) {
    if (id) return viewPartner(id);
    const rows = await api('GET', '/api/b2b/partners');
    main.innerHTML = `
      <div class="head-row"><h2>B2B партнери</h2><button class="btn primary" id="pNew">+ Новий партнер</button></div>
      <div class="alert info" style="margin-bottom:14px">Партнер бачить лише свій кабінет: каталог увімкнених йому брендів з РРЦ і своєю ціною (РРЦ − маржа).
        За замовчуванням партнер не бачить жодного бренду — увімкніть бренди й задайте маржу в картці партнера.</div>
      ${rows.length ? `<table class="list"><thead><tr><th>Партнер</th><th class="hide-m">Контакти</th><th class="r">Користувачі</th><th class="r">Бренди</th><th>Стан</th></tr></thead><tbody>
        ${rows.map((p) => `<tr class="click" data-p="${p.id}">
          <td><b>${esc(p.name)}</b></td>
          <td class="small hide-m">${esc([p.phone, p.email].filter(Boolean).join(' · ') || '—')}</td>
          <td class="r">${p.users}${p.users_by_partner ? `<div class="small muted">з них додав партнер: ${p.users_by_partner}</div>` : ''}</td><td class="r">${p.brands}</td>
          <td>${p.active ? '<span class="badge ok">активний</span>' : '<span class="badge bad">вимкнений</span>'}</td>
        </tr>`).join('')}</tbody></table>`
        : '<div class="card empty"><div class="big">Партнерів ще немає</div>Створіть першого партнера, додайте йому користувача і ввімкніть бренди.</div>'}`;
    $$('[data-p]').forEach((tr) => (tr.onclick = () => { location.hash = `#/b2bpartners/${tr.dataset.p}`; }));
    $('#pNew').onclick = () => partnerForm(null);
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
          Неоплачені закупівлі — сума всіх неоплачених (разом із відкритою); понад ліміт нові закупівлі не приймаються.</div>
      </form>`, { footer: `<button class="btn" data-close>Скасувати</button><button class="btn primary" id="pSave">${isNew ? 'Створити' : 'Зберегти'}</button>` });
    $('#pSave', m.el).onclick = async () => {
      const f = $('#pF', m.el);
      const d = Object.fromEntries(new FormData(f));
      if (f.active) d.active = f.active.checked;
      try {
        if (isNew) {
          const r = await api('POST', '/api/b2b/partners', d);
          if (d.open_limit || d.unpaid_limit) await api('PUT', `/api/b2b/partners/${r.id}`, { open_limit: d.open_limit, unpaid_limit: d.unpaid_limit });
          m.close(); location.hash = `#/b2bpartners/${r.id}`;
        }
        else { await api('PUT', `/api/b2b/partners/${p.id}`, d); m.close(); toast('Збережено'); viewPartner(p.id); }
      } catch (e) { toast(e.message, true); }
    };
  }

  async function viewPartner(id) {
    const { partner: p, users, brands, entities = [], roles = {}, limits } = await api('GET', `/api/b2b/partners/${id}`);
    const byPartner = users.filter((u) => u.added_by_partner).length;
    main.innerHTML = `
      <div class="head-row"><h2>${esc(p.name)} ${p.active ? '' : '<span class="badge bad">вимкнений</span>'}</h2>
        <div class="btn-row"><a class="btn" href="#/b2bpartners">← До списку</a><button class="btn" id="pEdit">Змінити</button>${people() ? '<button class="btn danger" id="pDel">Видалити</button>' : ''}</div></div>
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
          ${limits ? `<div class="card form-stack">
            <h3>Ліміти</h3>
            <div class="small">Відкрита закупівля${limits.openId ? ` <a href="#/b2borders/${limits.openId}">B2B-${limits.openId}</a>` : ''}: <b>${money(limits.openTotal)}</b> з ${money(limits.open)} грн</div>
            <div class="small">Неоплачені закупівлі: <b>${money(limits.unpaidTotal)}</b> з ${money(limits.unpaid)} грн</div>
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
  async function sendPrices() {
    const rows = await api('GET', '/api/b2b/price-changes');
    const withCh = rows.filter((r) => !r.empty);
    const dest = (r) => (r.group ? `група «${esc(r.group)}»` : r.tgUsers ? `особисто: ${r.tgUsers} корист.` : '<span class="badge bad">нікому — немає Telegram</span>');
    const m = modal('Надіслати зміни цін партнерам', withCh.length ? `<div class="form-stack">
        <div class="small muted">Зміни РРЦ і знижок з минулої розсилки кожному партнеру. Оновіть каталог з LP-CRM перед розсилкою, щоб РРЦ були свіжі.</div>
        ${withCh.map((r) => `<div class="card form-stack" style="padding:10px 12px">
          <label class="check"><input type="checkbox" data-pp="${r.id}" ${r.group || r.tgUsers ? 'checked' : 'disabled'}> <b>${esc(r.name)}</b> — товарів: ${r.products}${r.brands ? `, брендів: ${r.brands}` : ''} → ${dest(r)}</label>
          <details><summary class="small">Переглянути повідомлення</summary>${r.preview.map((t) => `<pre class="small" style="white-space:pre-wrap;margin:6px 0">${t}</pre>`).join('')}</details>
        </div>`).join('')}
        ${rows.length > withCh.length ? `<div class="small muted">Без змін: ${rows.filter((r) => r.empty).map((r) => esc(r.name)).join(', ')}</div>` : ''}
      </div>` : '<div class="small">Змін цін і знижок з минулої розсилки немає.</div>',
    { wide: true, footer: `<button class="btn" data-close>Закрити</button>${withCh.length ? '<button class="btn primary" id="ppSend">Надіслати</button>' : ''}` });
    $('#ppSend', m.el) && ($('#ppSend', m.el).onclick = async (e) => {
      const ids = $$('[data-pp]', m.el).filter((x) => x.checked).map((x) => Number(x.dataset.pp));
      if (!ids.length) { toast('Оберіть партнерів', true); return; }
      e.currentTarget.disabled = true;
      try {
        const { results } = await api('POST', '/api/b2b/price-changes/send', { partner_ids: ids });
        const ok = results.filter((r) => r.sent).length;
        toast(`Надіслано: ${ok} з ${results.length}`, ok < results.length);
        m.close();
      } catch (er) { toast(er.message, true); e.currentTarget.disabled = false; }
    });
  }

  // ---------------------------------------------------------------- каталог
  let catFilter = { brand: '', q: '' };
  async function syncCatalog(btn, done = viewCatalog) {
    btn.disabled = true;
    try {
      for (let i = 0; i < 100; i++) {
        btn.innerHTML = `<span class="spinner"></span> Оновлюю з LP-CRM…`;
        const r = await api('POST', '/api/b2b/catalog/sync');
        if (!r.left || !r.checked) { toast(`Каталог оновлено${r.changed ? ` · змінилися ціни: ${r.changed}` : ''}`); break; }
      }
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
    done();
  }

  async function viewCatalog() {
    const qs = new URLSearchParams(Object.entries(catFilter).filter(([, v]) => v !== '')).toString();
    const [{ rows, state }, brands] = await Promise.all([api('GET', `/api/b2b/catalog${qs ? `?${qs}` : ''}`), api('GET', '/api/b2b/brands')]);
    main.innerHTML = `
      <div class="head-row"><h2>Каталог і ціни</h2><div class="btn-row"><button class="btn" id="cAdd">+ Товари за ID</button><button class="btn" id="cSend">Надіслати зміни цін</button><button class="btn primary" id="cSync">Оновити з LP-CRM</button></div></div>
      <div class="alert info" style="margin-bottom:14px">Товари — з аналітики (усе, що продавалося) і додані вручну за ID з LP-CRM. Назва, РРЦ і фото оновлюються з LP-CRM
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
    if (id) return viewOrder(id);
    const qs = filterQs(ordFilter);
    const [{ rows, statuses, counts }, partners] = await Promise.all([api('GET', `/api/b2b/orders${qs ? `?${qs}` : ''}`), api('GET', '/api/b2b/partners')]);
    main.innerHTML = `
      <div class="head-row"><h2>Закупівлі партнерів</h2><button class="btn" id="finGroup">Група «Фінансові питання»</button></div>
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
          <td><b>${esc(o.number)}</b>${o.delivery === 'pickup' ? '<div><span class="badge info">🚗 самовивіз</span></div>' : ''}</td>
          <td>${esc(o.partner)}<div class="small muted">${esc(o.entity.split('\n')[0].split(',')[0])}</div></td>
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
      { key: 'del', label: 'Видалити', danger: true, confirm: (n) => `Видалити ${n} закупівель назавжди (з товарами, історією і файлами)?`, run: (id) => api('DELETE', `/api/b2b/orders/${id}`) },
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
      <div class="head-row"><h2>${esc(o.number)} · ${esc(partner?.name || '')} ${statusBadge(o)}</h2><div class="btn-row"><a class="btn" href="#/b2borders">← До списку</a>${o.status === 'draft' ? '<button class="btn primary" id="oSendDraft">Відправити закупівлю</button>' : ''}<button class="btn danger" id="oDel">Видалити</button></div></div>
      ${o.status === 'draft' ? '<div class="alert warn" style="margin-bottom:12px"><b>Чернетка партнера</b> — команда партнера ще збирає товари. Відправити її (як від партнера) може керівник партнера або ви.</div>' : ''}
      <div class="form-page">
        <div class="form-stack">
          <div class="card">${itemsTable(items, { rrp: true })}</div>
          ${o.comment ? `<div class="card small"><b>Коментар партнера:</b> ${esc(o.comment)}</div>` : ''}
          <div class="card form-stack">
            <h3>Платник (юрособа партнера)</h3>
            <div class="small" style="white-space:pre-line" id="oEnt">${esc(o.entity)}</div>
            ${closed || o.status === 'open' ? `<div class="small"><b>Отримання:</b> ${esc(o.delivery_name || '')}</div>` : `<label class="f"><span>Отримання</span>
              <select id="oDel">${[['np', 'Відправка клієнтам (Нова пошта)'], ['pickup', '🚗 Самовивіз — партнер забирає всю закупівлю']].map(([k, v]) => `<option value="${k}" ${o.delivery === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`}
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
      if (!(await confirmDanger(`Видалити закупівлю ${o.number}?`, 'Закупівля, її товари, історія і файли видаляться назавжди (для тестових замовлень). Партнер її більше не побачить.', 'Видалити закупівлю'))) return;
      try { await api('DELETE', `/api/b2b/orders/${o.id}`); toast('Закупівлю видалено'); location.hash = '#/b2borders'; } catch (er) { toast(er.message, true); }
    };
    $$('[data-fdel]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmDanger('Видалити файл?', 'Партнер більше не зможе його завантажити.', 'Видалити'))) return;
      try { await api('DELETE', `/api/b2b/files/${b.dataset.fdel}`); toast('Видалено'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
    }));
    if ($('#oPays')) loadPays(o);
    if ($('#oSendDraft')) $('#oSendDraft').onclick = async () => {
      if (!(await confirmDanger(`Відправити чернетку ${o.number}?`, 'Вона стане закупівлею «Очікує рахунок»: прийдуть сповіщення, у «Фінансових питаннях» — запит рахунку.', 'Відправити закупівлю'))) return;
      try { await api('POST', `/api/b2b/orders/${o.id}/send`); toast('Закупівлю відправлено'); viewOrder(o.id); } catch (er) { toast(er.message, true); }
    };
    if ($('#oDel')) $('#oDel').onchange = async (e) => {
      try { await api('POST', `/api/b2b/orders/${o.id}/delivery`, { delivery: e.target.value }); toast('Спосіб отримання змінено — партнеру надіслано повідомлення'); viewOrder(o.id); }
      catch (er) { toast(er.message, true); e.target.value = o.delivery; }
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
        ${rows.map((o) => `<tr class="click ${o.no_supply && o.status !== 'cancelled' ? 'row-bad' : ''}" data-o="${o.id}">
          ${selCell(o.id)}
          <td><b>${esc(o.number)}</b><div>${supplyMark(o)}</div><div class="small muted hide-m">${esc(fmtDateTime(o.created_at))}</div></td>
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
        run: (id) => { const o = byId.get(id); if (o.status !== 'new') throw new Error(o.status === 'crm' ? 'вже в CRM' : 'скасовано'); return api('POST', `/api/b2b/clients/${id}/crm`); } }] : []),
      { key: 'paid', label: 'Оплачено (без закупівлі)', run: (id) => { if (!byId.get(id).no_supply) throw new Error('оплата — за закупівлею'); return api('POST', `/api/b2b/clients/${id}/paid`, { paid: true }); } },
      { key: 'cancel', label: 'Скасувати', danger: true, confirm: (n) => `Скасувати ${n} замовлень? Ті, що вже в LP-CRM, скасуйте там вручну.`, run: (id) => api('POST', `/api/b2b/clients/${id}/cancel`) },
      { key: 'del', label: 'Видалити', danger: true, confirm: (n) => `Видалити ${n} замовлень назавжди?`, run: (id) => api('DELETE', `/api/b2b/orders/${id}`) },
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
      <div class="head-row"><h2>${esc(o.number)} · ${esc(partner?.name || '')} ${statusBadge(o)} ${payBadge(o)}</h2><div class="btn-row"><a class="btn" href="#/b2bclients">← До списку</a><button class="btn danger" id="clDel">Видалити</button></div></div>
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
            ${!closed && o.status === 'new' ? `<button class="btn primary" id="clCrm" ${cfg.on ? '' : 'disabled'}>Додати в CRM</button>
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
      if (!(await confirmDanger(`Видалити замовлення ${o.number}?`, `Замовлення, його товари, історія і файли видаляться назавжди; товар повернеться в залишок закупівлі.${o.crm_id ? ` Замовлення № ${o.crm_id} у LP-CRM видаліть вручну.` : ''}`, 'Видалити замовлення'))) return;
      try { await api('DELETE', `/api/b2b/orders/${o.id}`); toast('Замовлення видалено'); location.hash = '#/b2bclients'; } catch (er) { toast(er.message, true); }
    };
    $('#clCancel') && ($('#clCancel').onclick = async () => {
      if (!(await confirmDanger(`Скасувати ${o.number}?`, o.crm_id ? `Замовлення № ${o.crm_id} у LP-CRM скасуйте вручну.` : 'Партнер отримає сповіщення.', 'Скасувати замовлення'))) return;
      try { await api('POST', `/api/b2b/clients/${o.id}/cancel`); toast('Скасовано'); re(); } catch (er) { toast(er.message, true); }
    });
  }

  return { viewPartners, viewCatalog, viewOrders, viewClients, pct, fmtDay };
}
