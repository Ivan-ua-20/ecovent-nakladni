// Користувачі: ролі, логіни LP-CRM, передача прав власника.
import { esc } from '../invoice.js';
import { $, $$, main, MASK, api, setPending, toast, modal, confirmDanger, fmtDateTime, readImage, printHtml, todayKyiv } from '../core/ui.js';

export function createUsersPages(ctx) {
  const { can, loadBoot, activeFops, fopById, tplById } = ctx;

async function viewUsers() {
  const [{ users, roles }, vals, tgInfo, markets] = await Promise.all([api('GET', '/api/users'), can('analytics') ? api('GET', '/api/an/values').catch(() => null) : null,
    api('GET', '/api/users/tg').catch(() => null), can('market.view') ? api('GET', '/api/mp/shops').catch(() => []) : []]);
  // Доступ до розділів (менеджер і перегляд): B2B, Рітейл, Маркетплейси (+ магазини), сповіщення в Telegram.
  const SECS = [
    { k: 'b2b', label: 'B2B партнери', lv: [['view', 'перегляд'], ['full', 'повний — зміни, ціни, оплати, партнери']], tg: true },
    { k: 'retail', label: 'Рітейл', lv: [['view', 'перегляд'], ['work', 'робота — підтвердити, ТТН, LP-CRM']], tg: true },
    { k: 'market', label: 'Маркетплейси', lv: [['view', 'перегляд'], ['work', 'робота — нагадування про відгуки, чат, оновити']] },
  ];
  const LVN = { view: 'перегляд', work: 'робота', full: 'повний' };
  const shopName = new Map(markets.flatMap((m) => m.shops.map((x) => [`${m.key}:${x.id}`, `${m.title || m.key} · ${x.name}`])));
  const accCell = (u) => {
    if (!u.access) return u.role === 'owner' || u.role.startsWith('admin') ? '<span class="small muted">усі розділи</span>' : '';
    const a = u.access;
    const parts = SECS.filter((x) => a[x.k] !== 'none').map((x) => `<span class="badge ${a[x.k] === 'view' ? '' : 'ok'}" title="${esc(LVN[a[x.k]])}">${esc(x.label.split(' ')[0])}${a[x.k] === 'view' ? ' 👁' : ''}${a.tg?.includes(x.k) ? ' 🔔' : ''}</span>`);
    if (a.market !== 'none' && a.shops) parts.push(`<span class="small muted" title="${esc(a.shops.map((x) => shopName.get(x) || x).join(', '))}">${a.shops.length} маг.</span>`);
    return parts.join(' ') || '<span class="small muted">лише накладні й рахунки</span>';
  };
  const tgOf = new Map((tgInfo?.users || []).map((t) => [String(t.id), t]));
  const tgCell = (u) => {
    const t = tgOf.get(String(u.id));
    if (!t) return '';
    return t.connected ? `<span class="badge ok">✓ підключено</span><div class="small">${esc(t.name || '')}</div>${t.at ? `<div class="small muted">${esc(fmtDateTime(t.at))}</div>` : ''}`
      : '<span class="small muted">не підключено</span>';
  };
  const crmUsers = (vals?.users || []).map((x) => x.v);
  const me = ctx.boot.user;
  const assignable = ['admin', 'admin_lite', 'manager', 'viewer'];
  const roleOpts = (sel) => assignable.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${esc(roles[r])}</option>`).join('');
  main.innerHTML = `
    <div class="head-row"><h2>Користувачі</h2><div class="btn-row">${me.role === 'owner' && users.length > 1 ? '<button class="btn" id="uOwner">Передати права власника</button>' : ''}<button class="btn primary" id="uNew">+ Новий користувач</button></div></div>
    <div class="alert info help" style="margin-bottom:14px">
      <b>Адміністратор</b> — усе, включно з API, користувачами й аналітикою. <b>Менеджер</b> — накладні, рахунки, довідники і власна аналітика (лише замовлення його логінів LP-CRM, без таргетів).
      <b>Перегляд</b> — лише дивитися, друкувати й завантажувати.
      Менеджеру й перегляду можна відкрити розділи <b>B2B</b>, <b>Рітейл</b>, <b>Маркетплейси</b> (і лише потрібні магазини) — «Змінити» → «Доступ до розділів». 👁 — лише перегляд, 🔔 — сповіщення розділу в Telegram.</div>
    ${tgInfo ? `<div class="small muted" style="margin-bottom:8px">Telegram-бот${tgInfo.bot ? ` <b>@${esc(tgInfo.bot)}</b>` : ''}: підключили ${tgInfo.users.filter((t) => t.connected).length} з ${tgInfo.users.length}. Кожен підключає себе сам — «Telegram» угорі сторінки.</div>` : ''}
    <table class="list"><thead><tr><th>Логін</th><th>Ім’я</th><th>Роль</th><th>Логіни LP-CRM</th><th>Telegram-бот</th><th>Доступ</th><th>Аналітика</th><th>Стан</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr>
        <td><b>${esc(u.login)}</b>${String(u.id) === String(me.id) ? ' <span class="badge info">це ви</span>' : ''}</td>
        <td>${esc(u.name)}</td>
        <td>${u.role === 'owner' ? `<span class="badge ok">${esc(u.role_name)}</span>` : esc(u.role_name)}</td>
        <td class="small">${u.crm_logins.length ? u.crm_logins.map(esc).join(', ') : (u.role === 'manager' ? '<span class="muted">не прив’язано</span>' : '')}</td>
        <td>${tgCell(u)}</td>
        <td>${accCell(u)}</td>
        <td>${me.role === 'owner' && u.role !== 'owner'
          ? `<label class="check" title="Доступ до розділу «Аналітика» (змінює лише власник)"><input type="checkbox" data-an="${u.id}" ${u.analytics ? 'checked' : ''}> ${u.analytics ? 'так' : 'ні'}</label>`
          : (u.analytics ? '<span class="badge ok">так</span>' : '<span class="badge">ні</span>')}</td>
        <td>${u.active ? '<span class="badge ok">активний</span>' : '<span class="badge bad">вимкнений</span>'}</td>
        <td style="text-align:right">${u.role === 'owner' && me.role !== 'owner' ? '' : `<button class="btn sm" data-uedit="${u.id}">Змінити</button>`}</td>
      </tr>`).join('')}
    </tbody></table>`;
  $$('[data-an]').forEach((cb) => (cb.onchange = async () => {
    try { await api('PUT', `/api/users/${cb.dataset.an}`, { analytics: cb.checked }); toast(cb.checked ? 'Аналітику увімкнено' : 'Аналітику вимкнено'); viewUsers(); }
    catch (e) { toast(e.message, true); cb.checked = !cb.checked; }
  }));
  const form = (u) => {
    const isNew = !u;
    const owner = u?.role === 'owner';
    const m = modal(isNew ? 'Новий користувач' : `Користувач ${u.login}`, `<form id="uF" class="form-stack">
        ${isNew ? '<label class="f"><span>Логін (латиницею)</span><input name="login" required autocomplete="off"></label>' : ''}
        <label class="f"><span>Ім’я</span><input name="name" value="${esc(u?.name || '')}"></label>
        ${owner ? '' : `<label class="f"><span>Роль</span><select name="role">${roleOpts(u?.role || 'manager')}</select></label>`}
        <div class="f" id="uCrm"><span>Логіни LP-CRM <span class="muted small">— менеджер бачить в аналітиці лише замовлення цих логінів</span></span>
          <div class="crm-pick">${[...new Set([...crmUsers, ...(u?.crm_logins || [])])].sort().map((l) => `<label class="chk-chip"><input type="checkbox" name="crm" value="${esc(l)}" ${u?.crm_logins?.includes(l) ? 'checked' : ''}> ${esc(l)}</label>`).join('') || '<span class="small muted">Логіни з’являться після завантаження аналітики.</span>'}</div>
          <input name="crm_extra" placeholder="інший логін, через кому" autocomplete="off"></div>
        <div class="f" id="uAcc"><span>Доступ до розділів <span class="muted small">— накладні й рахунки є завжди (за роллю)</span></span>
          <div class="form-stack" style="gap:6px">
          ${SECS.map((x) => `<div class="btn-row" style="align-items:center;gap:10px;flex-wrap:wrap">
              <label class="check" style="min-width:170px"><input type="checkbox" data-sec="${x.k}"> <b>${esc(x.label)}</b></label>
              <select data-lv="${x.k}" style="max-width:360px" aria-label="Рівень доступу: ${esc(x.label)}">${x.lv.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>
              ${x.tg ? `<label class="check small"><input type="checkbox" data-tgs="${x.k}"> сповіщення в Telegram</label>` : ''}</div>`).join('')}
          </div>
          <div id="uShops" class="form-stack" style="gap:4px;margin-top:6px">
            <label class="check small"><input type="checkbox" id="shAll"> <b>Усі магазини маркетплейсів</b> (і ті, що додадуться згодом)</label>
            ${markets.filter((m) => m.shops.length).map((m) => `<div class="crm-pick"><span class="small muted" style="min-width:80px">${esc(m.title || m.key)}:</span>${m.shops.map((x) => `<label class="chk-chip"><input type="checkbox" data-shop="${m.key}:${x.id}"> ${esc(x.name)}</label>`).join('')}</div>`).join('') || '<span class="small muted">Магазинів ще немає.</span>'}
          </div>
          ${users.some((x) => x.access && String(x.id) !== String(u?.id)) ? `<label class="small muted" style="margin-top:6px">Скопіювати доступ з: <select id="uCopy" style="max-width:240px"><option value="">—</option>${users.filter((x) => x.access && String(x.id) !== String(u?.id)).map((x) => `<option value="${x.id}">${esc(x.name || x.login)}</option>`).join('')}</select></label>` : ''}
        </div>
        <label class="f"><span>${isNew ? 'Пароль (від 6 символів)' : 'Новий пароль (залиште порожнім, щоб не міняти)'}</span><input name="password" type="text" autocomplete="new-password" ${isNew ? 'required' : ''}></label>
        ${!isNew && !owner && String(u.id) !== String(me.id) ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Активний (може входити)</label>` : ''}
      </form>`, { footer: `${!isNew && !owner && String(u.id) !== String(me.id) ? '<button class="btn danger" id="uDel" style="margin-right:auto">Видалити</button>' : ''}<button class="btn" data-close>Скасувати</button><button class="btn primary" id="uSave">Зберегти</button>` });
    const uf = $('#uF', m.el);
    const role = () => (uf.role ? uf.role.value : u?.role);
    // доступ: поточний (або типовий для ролі) → прапорці
    const setAcc = (a) => {
      for (const x of SECS) {
        $(`[data-sec="${x.k}"]`, m.el).checked = a[x.k] !== 'none';
        if (a[x.k] !== 'none') $(`[data-lv="${x.k}"]`, m.el).value = a[x.k];
        const t = $(`[data-tgs="${x.k}"]`, m.el); if (t) t.checked = (a.tg || []).includes(x.k);
      }
      $('#shAll', m.el).checked = !a.shops;
      $$('[data-shop]', m.el).forEach((cb) => { cb.checked = !a.shops || a.shops.includes(cb.dataset.shop); });
    };
    const DEF = { manager: { b2b: 'none', retail: 'work', market: 'work', shops: null, tg: [] }, viewer: { b2b: 'none', retail: 'view', market: 'view', shops: null, tg: [] } };
    setAcc(u?.access || DEF[role()] || DEF.manager);
    const syncAcc = () => {
      const viewer = role() === 'viewer';
      for (const x of SECS) {
        const on = $(`[data-sec="${x.k}"]`, m.el).checked;
        const sel = $(`[data-lv="${x.k}"]`, m.el);
        if (viewer) sel.value = 'view';
        sel.disabled = !on || viewer;
        const t = $(`[data-tgs="${x.k}"]`, m.el); if (t) { t.disabled = !on; if (!on) t.checked = false; }
      }
      $('#uShops', m.el).hidden = !$('[data-sec="market"]', m.el).checked;
      $$('[data-shop]', m.el).forEach((cb) => { cb.disabled = $('#shAll', m.el).checked; if (cb.disabled) cb.checked = true; });
    };
    $$('#uAcc input, #uAcc select', m.el).forEach((x) => { x.onchange = syncAcc; });
    $('#shAll', m.el).onchange = () => { if (!$('#shAll', m.el).checked) $$('[data-shop]', m.el).forEach((cb) => { cb.checked = false; }); syncAcc(); };
    if ($('#uCopy', m.el)) $('#uCopy', m.el).onchange = (e) => { const src = users.find((x) => String(x.id) === e.target.value); if (src?.access) { setAcc(src.access); syncAcc(); toast(`Доступ скопійовано з ${src.name || src.login} — натисніть «Зберегти»`); } };
    const readAcc = () => {
      const a = {};
      for (const x of SECS) a[x.k] = $(`[data-sec="${x.k}"]`, m.el).checked ? $(`[data-lv="${x.k}"]`, m.el).value : 'none';
      a.tg = SECS.filter((x) => $(`[data-tgs="${x.k}"]`, m.el)?.checked).map((x) => x.k);
      a.shops = $('#shAll', m.el).checked ? null : $$('[data-shop]', m.el).filter((cb) => cb.checked).map((cb) => cb.dataset.shop);
      return a;
    };
    const showCrm = () => {
      $('#uCrm', m.el).hidden = !uf.role || uf.role.value !== 'manager';
      $('#uAcc', m.el).hidden = owner || !['manager', 'viewer'].includes(role());
      syncAcc();
    };
    if (uf.role) uf.role.onchange = showCrm;
    showCrm();
    $('#uSave', m.el).onclick = async () => {
      const f = $('#uF', m.el);
      const fd = new FormData(f);
      const d = Object.fromEntries(fd);
      d.crm_logins = [...fd.getAll('crm'), ...String(d.crm_extra || '').split(',')].map((x) => x.trim()).filter(Boolean);
      delete d.crm; delete d.crm_extra;
      if (f.active) d.active = f.active.checked;
      if (!d.password) delete d.password;
      if (!$('#uAcc', m.el).hidden) {
        d.access = readAcc();
        if (d.access.market !== 'none' && d.access.shops && !d.access.shops.length) { toast('Позначте хоча б один магазин маркетплейсів або зніміть «Маркетплейси»', true); return; }
      }
      try {
        if (isNew) await api('POST', '/api/users', d); else await api('PUT', `/api/users/${u.id}`, d);
        m.close(); toast('Збережено'); viewUsers();
      } catch (e) { toast(e.message, true); }
    };
    $('#uDel', m.el) && ($('#uDel', m.el).onclick = async () => {
      if (!(await confirmDanger(`Видалити користувача «${u.login}»?`, 'Користувач більше не зможе увійти. Його накладні й рахунки залишаться.', 'Видалити користувача'))) return;
      try { await api('DELETE', `/api/users/${u.id}`); m.close(); toast('Видалено'); viewUsers(); } catch (e) { toast(e.message, true); }
    });
  };
  $('#uNew').onclick = () => form(null);
  const tr = $('#uOwner');
  if (tr) tr.onclick = () => {
    const others = users.filter((x) => String(x.id) !== String(me.id) && x.active);
    const m = modal('Передати права власника', `<form id="oF" class="form-stack">
        <div class="alert">Власник може бути лише один. Після передачі новий власник отримає повний доступ, а ви — вибрану роль. Повернути права зможе лише новий власник.</div>
        <label class="f"><span>Новий власник</span><select name="userId" required><option value="">— вибрати —</option>${others.map((x) => `<option value="${x.id}">${esc(x.name ? `${x.name} (${x.login})` : x.login)} · ${esc(x.role_name)}</option>`).join('')}</select></label>
        <label class="f"><span>Ваша нова роль</span><select name="myRole">${roleOpts('admin')}</select></label>
        <label class="f"><span>Ваш пароль для підтвердження</span><input name="password" type="password" autocomplete="current-password" required></label>
      </form>`, { footer: '<button class="btn" data-close>Скасувати</button><button class="btn danger" id="oGo">Передати права</button>' });
    $('#oGo', m.el).onclick = async () => {
      const d = Object.fromEntries(new FormData($('#oF', m.el)));
      if (!d.userId) { toast('Виберіть нового власника', true); return; }
      try { await api('POST', '/api/users/transfer-owner', d); m.close(); toast('Права власника передано'); location.reload(); } catch (e) { toast(e.message, true); }
    };
  };
  $$('[data-uedit]').forEach((b) => (b.onclick = () => form(users.find((x) => String(x.id) === b.dataset.uedit))));
}


  return { viewUsers };
}
