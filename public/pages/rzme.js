// Особисті входи менеджера в Розетку: вікно «Мої входи в Розетку» (посилання «Розетка» вгорі) і підпис «від кого»
// біля дій, що йдуть у Розетку (повідомлення покупцю, скасування, статус, ТТН). Сервер — src/modules/market/rzme.js.
import { esc } from '../invoice.js';
import { $, $$, api, toast, modal, fmtDateTime } from '../core/ui.js';

let cache = null;
export async function rzMe(fresh = false) {
  if (!cache || fresh) cache = api('GET', '/api/mp/rz/me').catch(() => null);
  return cache;
}
const STATE = {
  ok: ['ok', 'Підключено'],
  bad: ['bad', 'Пароль змінено'],
  none: ['warn', 'Не підключено'],
};

// Рядок «Від кого» для магазину accountId (порожньо — якщо дані ще не завантажені).
export async function rzWho(accountId) {
  const me = await rzMe();
  const a = me?.accounts.find((x) => Number(x.id) === Number(accountId));
  if (!a) return '';
  if (a.state === 'ok') return `<div class="small rz-who">Від кого в Розетці: <b>${esc(a.username)}</b> (ваш вхід)</div>`;
  const blocked = me.require && !me.exempt;
  const why = a.state === 'bad' ? 'Розетка не прийняла ваш вхід (можливо, змінено пароль)' : 'ваш вхід у Розетку не підключено';
  return `<div class="alert ${blocked ? 'bad' : 'warn'} small rz-who">${blocked
    ? `Дію вимкнено: ${why}.`
    : `Піде від службового входу «Для сервісу»: ${why}.`} <a href="#" data-rzme>Підключити свій вхід</a></div>`;
}
// Посилання «Підключити свій вхід» у підписі відкриває вікно входів.
export const wireRzWho = (root) => $$('[data-rzme]', root).forEach((a) => (a.onclick = (e) => { e.preventDefault(); rzLoginsDialog(); }));

export async function rzLoginsDialog() {
  const me = await rzMe(true);
  if (!me) return toast('Не вдалося завантажити магазини Розетки.', true);
  const m = modal('Мої входи в Розетку', '<div id="rzmeBox"></div>', { wide: true, footer: '<button class="btn primary" data-close>Готово</button>' });
  const draw = (d) => {
    $('#rzmeBox', m.el).innerHTML = `<div class="form-stack">
      <div class="small muted">Свій менеджерський логін кабінету продавця Розетки створює адміністратор магазину в Розетці: <b>Налаштування → Менеджери</b>
        (права «Відповідь на повідомлення» і «Перегляд переписки з ROZETKA»). З підключеним входом повідомлення покупцям, скасування, зміна статусу й ТТН
        ідуть від вашого імені. Пароль зберігається на сервері й нікому не показується.</div>
      ${d.require && !d.exempt ? '<div class="alert warn small">Власник увімкнув правило: без особистого входу дії в Розетці вимкнено.</div>' : ''}
      ${d.accounts.length ? `<table class="list"><tbody>${d.accounts.map((a) => {
        const [cls, label] = STATE[a.state] || STATE.none;
        return `<tr><td><b>${esc(a.name)}</b></td>
          <td><span class="badge ${cls}">${label}</span></td>
          <td class="small muted">${a.state === 'ok' ? esc(a.username) : a.state === 'bad' ? `${esc(a.username)} · ${esc(a.error || '')}${a.checked_at ? ` · ${esc(fmtDateTime(a.checked_at))}` : ''}` : 'дії підуть від службового входу «Для сервісу»'}</td>
          <td class="r nowrap">${d.canAct ? `<button class="btn sm" data-set="${a.id}">${a.state === 'none' ? 'Підключити' : a.state === 'bad' ? 'Оновити' : 'Змінити'}</button>` : ''}
            ${a.state !== 'none' ? `<button class="btn sm" data-off="${a.id}">Відключити</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>` : '<div class="small muted">У вас немає доступу до магазинів Розетки.</div>'}
    </div>`;
    $$('[data-set]', m.el).forEach((b) => (b.onclick = () => connect(d.accounts.find((a) => String(a.id) === b.dataset.set))));
    $$('[data-off]', m.el).forEach((b) => (b.onclick = async () => {
      try { await api('DELETE', `/api/mp/rz/me/${b.dataset.off}`); toast('Відключено'); draw(await rzMe(true)); } catch (er) { toast(er.message, true); }
    }));
  };
  const connect = (a) => {
    const f = modal(`Підключити: ${a.name}`, `<form class="form-stack" id="rzmeF" autocomplete="off">
        <label class="f"><span>Логін (e-mail) вашого менеджерського входу</span><input name="username" value="${esc(a.username || '')}" required autocomplete="off"></label>
        <label class="f"><span>Пароль</span><input name="password" type="password" required autocomplete="new-password"></label>
        <div class="small muted">Сервіс одразу перевірить вхід у Розетці й те, що це саме магазин «${esc(a.name)}».</div></form>`,
    { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="rzmeGo">Перевірити й зберегти</button>' });
    const form = $('#rzmeF', f.el);
    const go = $('#rzmeGo', f.el);
    go.onclick = async () => {
      if (!form.username.value.trim() || !form.password.value) return toast('Вкажіть логін і пароль.', true);
      go.disabled = true; go.innerHTML = '<span class="spinner"></span> Перевіряю в Розетці…';
      try {
        await api('PUT', `/api/mp/rz/me/${a.id}`, { username: form.username.value.trim(), password: form.password.value });
        f.close(); toast(`Вхід у «${a.name}» підключено`); draw(await rzMe(true));
      } catch (er) { toast(er.message, true); go.disabled = false; go.textContent = 'Перевірити й зберегти'; }
    };
  };
  draw(me);
}
