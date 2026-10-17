// Користувачі: ролі, логіни LP-CRM, передача прав власника.
import { esc } from '../invoice.js';
import { $, $$, main, MASK, api, setPending, toast, modal, confirmDanger, fmtDateTime, readImage, printHtml, todayKyiv } from '../core/ui.js';

export function createUsersPages(ctx) {
  const { can, loadBoot, activeFops, fopById, tplById } = ctx;

async function viewUsers() {
  const [{ users, roles }, vals] = await Promise.all([api('GET', '/api/users'), can('analytics') ? api('GET', '/api/an/values').catch(() => null) : null]);
  const crmUsers = (vals?.users || []).map((x) => x.v);
  const me = ctx.boot.user;
  const assignable = ['admin', 'manager', 'viewer'];
  const roleOpts = (sel) => assignable.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${esc(roles[r])}</option>`).join('');
  main.innerHTML = `
    <div class="head-row"><h2>Користувачі</h2><div class="btn-row">${me.role === 'owner' && users.length > 1 ? '<button class="btn" id="uOwner">Передати права власника</button>' : ''}<button class="btn primary" id="uNew">+ Новий користувач</button></div></div>
    <div class="alert info" style="margin-bottom:14px">
      <b>Адміністратор</b> — усе, включно з API, користувачами й аналітикою. <b>Менеджер</b> — накладні, рахунки, довідники і власна аналітика (лише замовлення його логінів LP-CRM, без таргетів).
      <b>Перегляд</b> — лише дивитися, друкувати й завантажувати.</div>
    <table class="list"><thead><tr><th>Логін</th><th>Ім’я</th><th>Роль</th><th>Логіни LP-CRM</th><th>Стан</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr>
        <td><b>${esc(u.login)}</b>${String(u.id) === String(me.id) ? ' <span class="badge info">це ви</span>' : ''}</td>
        <td>${esc(u.name)}</td>
        <td>${u.role === 'owner' ? `<span class="badge ok">${esc(u.role_name)}</span>` : esc(u.role_name)}</td>
        <td class="small">${u.crm_logins.length ? u.crm_logins.map(esc).join(', ') : (u.role === 'manager' ? '<span class="muted">не прив’язано</span>' : '')}</td>
        <td>${u.active ? '<span class="badge ok">активний</span>' : '<span class="badge bad">вимкнений</span>'}</td>
        <td style="text-align:right">${u.role === 'owner' && me.role !== 'owner' ? '' : `<button class="btn sm" data-uedit="${u.id}">Змінити</button>`}</td>
      </tr>`).join('')}
    </tbody></table>`;
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
        <label class="f"><span>${isNew ? 'Пароль (від 6 символів)' : 'Новий пароль (залиште порожнім, щоб не міняти)'}</span><input name="password" type="text" autocomplete="new-password" ${isNew ? 'required' : ''}></label>
        ${!isNew && !owner && String(u.id) !== String(me.id) ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Активний (може входити)</label>` : ''}
      </form>`, { footer: `${!isNew && !owner && String(u.id) !== String(me.id) ? '<button class="btn danger" id="uDel" style="margin-right:auto">Видалити</button>' : ''}<button class="btn" data-close>Скасувати</button><button class="btn primary" id="uSave">Зберегти</button>` });
    const uf = $('#uF', m.el);
    const showCrm = () => { $('#uCrm', m.el).hidden = !uf.role || uf.role.value !== 'manager'; };
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
