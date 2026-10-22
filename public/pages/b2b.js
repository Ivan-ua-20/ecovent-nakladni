// B2B (власник і адміністратори): партнери, їхні користувачі, бренди й маржа, каталог з цінами з LP-CRM.
import { esc, money } from '../invoice.js';
import { $, $$, main, api, toast, modal, fmtDateTime } from '../core/ui.js';

const pct = (v) => `${String(Number(v) || 0).replace('.', ',')}%`;

export function createB2bPages() {
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
          <td class="r">${p.users}</td><td class="r">${p.brands}</td>
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
      </form>`, { footer: `<button class="btn" data-close>Скасувати</button><button class="btn primary" id="pSave">${isNew ? 'Створити' : 'Зберегти'}</button>` });
    $('#pSave', m.el).onclick = async () => {
      const f = $('#pF', m.el);
      const d = Object.fromEntries(new FormData(f));
      if (f.active) d.active = f.active.checked;
      try {
        if (isNew) { const r = await api('POST', '/api/b2b/partners', d); m.close(); location.hash = `#/b2bpartners/${r.id}`; }
        else { await api('PUT', `/api/b2b/partners/${p.id}`, d); m.close(); toast('Збережено'); viewPartner(p.id); }
      } catch (e) { toast(e.message, true); }
    };
  }

  async function viewPartner(id) {
    const { partner: p, users, brands } = await api('GET', `/api/b2b/partners/${id}`);
    main.innerHTML = `
      <div class="head-row"><h2>${esc(p.name)} ${p.active ? '' : '<span class="badge bad">вимкнений</span>'}</h2>
        <div class="btn-row"><a class="btn" href="#/b2bpartners">← До списку</a><button class="btn" id="pEdit">Змінити</button></div></div>
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
            <div class="btn-row"><button class="btn primary" id="mSave">Зберегти бренди й маржу</button></div>
          </div>
        </div>
        <div class="form-stack">
          <div class="card form-stack">
            <h3>Контакти</h3>
            <div class="small">${esc([p.phone, p.email].filter(Boolean).join(' · ') || 'Не вказано')}</div>
            ${p.note ? `<div class="small muted">${esc(p.note)}</div>` : ''}
          </div>
          <div class="card form-stack">
            <div class="head-row" style="margin:0"><h3 style="margin:0">Користувачі партнера</h3><button class="btn sm primary" id="uNew">+ Користувач</button></div>
            ${users.length ? `<table class="list"><tbody>${users.map((u) => `<tr>
                <td><b>${esc(u.login)}</b><div class="small muted">${esc(u.name || '')}</div></td>
                <td>${u.active ? '<span class="badge ok">активний</span>' : '<span class="badge bad">вимкнений</span>'}</td>
                <td style="text-align:right"><button class="btn sm" data-ue="${u.id}">Змінити</button></td>
              </tr>`).join('')}</tbody></table>`
              : '<div class="small muted">Ще немає. Додайте логін і пароль — передайте їх партнеру; увійти він зможе на цьому ж сайті.</div>'}
          </div>
        </div>
      </div>`;
    $('#pEdit').onclick = () => partnerForm(p);
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
      try { const r = await api('PUT', `/api/b2b/partners/${p.id}/margins`, list); toast(r.changed ? 'Бренди й маржу збережено' : 'Змін немає'); viewPartner(p.id); }
      catch (e) { toast(e.message, true); }
    };
    const userForm = (u) => {
      const isNew = !u;
      const m = modal(isNew ? `Новий користувач — ${p.name}` : `Користувач ${u.login}`, `<form id="puF" class="form-stack">
          ${isNew ? '<label class="f"><span>Логін (латиницею)</span><input name="login" required autocomplete="off"></label>' : ''}
          <label class="f"><span>Ім’я</span><input name="name" value="${esc(u?.name || '')}"></label>
          <label class="f"><span>${isNew ? 'Пароль (від 6 символів)' : 'Новий пароль (залиште порожнім, щоб не міняти)'}</span><input name="password" type="text" autocomplete="new-password" ${isNew ? 'required' : ''}></label>
          ${isNew ? '' : `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Активний (може входити)</label>`}
        </form>`, { footer: `<button class="btn" data-close>Скасувати</button><button class="btn primary" id="puSave">Зберегти</button>` });
      $('#puSave', m.el).onclick = async () => {
        const f = $('#puF', m.el);
        const d = Object.fromEntries(new FormData(f));
        if (f.active) d.active = f.active.checked;
        if (!d.password) delete d.password;
        try {
          if (isNew) await api('POST', `/api/b2b/partners/${p.id}/users`, d);
          else await api('PUT', `/api/b2b/partners/${p.id}/users/${u.id}`, d);
          m.close(); toast('Збережено'); viewPartner(p.id);
        } catch (e) { toast(e.message, true); }
      };
    };
    $('#uNew').onclick = () => userForm(null);
    $$('[data-ue]').forEach((b) => (b.onclick = () => userForm(users.find((x) => String(x.id) === b.dataset.ue))));
  }

  // ---------------------------------------------------------------- каталог
  let catFilter = { brand: '', q: '' };
  async function syncCatalog(btn) {
    btn.disabled = true;
    try {
      for (let i = 0; i < 100; i++) {
        btn.innerHTML = `<span class="spinner"></span> Оновлюю з LP-CRM…`;
        const r = await api('POST', '/api/b2b/catalog/sync');
        if (!r.left || !r.checked) { toast(`Каталог оновлено${r.changed ? ` · змінилися ціни: ${r.changed}` : ''}`); break; }
      }
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
    viewCatalog();
  }

  async function viewCatalog() {
    const qs = new URLSearchParams(Object.entries(catFilter).filter(([, v]) => v !== '')).toString();
    const [{ rows, state }, brands] = await Promise.all([api('GET', `/api/b2b/catalog${qs ? `?${qs}` : ''}`), api('GET', '/api/b2b/brands')]);
    main.innerHTML = `
      <div class="head-row"><h2>Каталог і ціни</h2><div class="btn-row"><button class="btn" id="cAdd">+ Товари за ID</button><button class="btn primary" id="cSync">Оновити з LP-CRM</button></div></div>
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

  return { viewPartners, viewCatalog, pct };
}
