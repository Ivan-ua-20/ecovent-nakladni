// Маркетплейси: замовлення магазинів Розетки (кабінет продавця), Prom і Епіцентру — вкладка на маркетплейс,
// підвкладки — магазини (назви як у «Налаштування → Доставка»; адміни можуть перейменувати). Лише перегляд.
// Розетка: історія за 4 роки (завантажується у фоні; поки сторінка відкрита — можна швидше);
// відгуки на товари — фільтр «хто ще не залишив відгук» і нагадування (Viber, Telegram, дзвінок, чат Розетки).
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, modal, fmtDateTime, todayKyiv } from '../core/ui.js';

const uah = (n) => `${Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₴`;
const dt = (s) => String(s || '').slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1');
const dDay = (s) => String(s || '').slice(0, 10).split('-').reverse().join('.');
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// Телефон покупця → +380XXXXXXXXX (для Viber, Telegram і дзвінка).
const intlPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 && d.startsWith('0')) return `+38${d}`;
  if (d.length === 9) return `+380${d}`;
  return `+${d}`;
};
const firstName = (full) => { const w = String(full || '').trim().split(/\s+/); return w.length > 1 ? w[1] : w[0] || ''; }; // «Прізвище Ім'я»
const VIA = { viber: 'Viber', telegram: 'Telegram', phone: 'дзвінок', copy: 'текст', chat: 'чат Розетки', manual: 'вручну' };
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* немає доступу до буфера — старий спосіб */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* */ }
  ta.remove();
  return ok;
}

export function createMarketPages({ can }) {
  const state = { status: '', q: '', from: '', to: '', rv: '' };
  let lastMp = '';
  let pump = 0; // id «швидшого» завантаження історії (зупиняється, коли пішли зі сторінки)

  async function viewMarket(mp, account = '') {
    // за замовчуванням — останні 30 днів (історія Розетки — десятки тисяч замовлень, «Увесь час» — кнопкою)
    if (mp !== lastMp) { Object.assign(state, { status: '', q: '', from: addDays(todayKyiv(), -30), to: '', rv: '' }); lastMp = mp; }
    pump++;
    const rz = mp === 'rozetka';
    const [all, rvSet] = await Promise.all([api('GET', '/api/mp/shops'), rz ? api('GET', '/api/mp/review/settings') : null]);
    const m = all.find((x) => x.key === mp);
    const shops = m.shops;
    const acc = shops.find((s) => String(s.id) === String(account)) || null;
    const route = { rozetka: 'mprz', prom: 'mpprom', epc: 'mpepc' }[mp];
    if (!shops.length) {
      main.innerHTML = `<div class="head-row"><h2>${esc(m.title)}</h2></div>
        <div class="card empty"><div class="big">Магазинів ${esc(m.title)} ще не підключено</div>
          Додайте магазин у ${can('api') ? '<a href="#/np">Налаштування → Доставка</a>' : '«Налаштування → Доставка» (адміністратор)'} — і його замовлення з'являться тут за кілька хвилин.</div>`;
      return;
    }
    const total = shops.reduce((a, s) => a + s.orders, 0);
    const syncInfo = (s) => [s.synced_at ? `оновлено ${esc(fmtDateTime(s.synced_at))}` : 'ще не оновлювався', s.loading ? 'довантажує…' : '', !s.active ? 'вимкнено' : '']
      .filter(Boolean).join(' · ');
    const hist = (s) => {
      const h = s.history;
      if (!h) return '';
      if (!h.started) {
        return can('api') ? `<div class="card small" style="margin-bottom:10px">Історія «${esc(s.name)}»: зараз лише останні 30 днів.
          <button class="btn sm primary" data-hstart="${s.id}" style="margin-left:8px">Завантажити історію за 4 роки</button></div>` : '';
      }
      if (h.done) return `<div class="small muted" style="margin-bottom:6px">✅ Історія «${esc(s.name)}» завантажена з ${esc(dDay(h.from))} · ${h.saved} замовлень</div>`;
      const pausedNote = h.paused ? '<div class="small muted" style="margin:4px 0">На сьогодні денну норму завантажено — продовжиться завтра автоматично (щоб не перевищити ліміт бази для решти сайту).</div>' : '';
      return `<div class="card small" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>⏳ Історія «${esc(s.name)}»: завантажено до ${esc(dDay(h.to))} · ${h.saved} замовлень</span><b>${h.pct}%</b></div>
        <div style="height:6px;background:var(--line);border-radius:4px;margin:6px 0"><div style="height:6px;width:${h.pct}%;background:var(--accent);border-radius:4px"></div></div>
        ${h.error ? `<div class="alert warn small" style="margin:6px 0">Остання спроба: ${esc(h.error)}</div>` : ''}${pausedNote}
        ${h.paused ? '' : `<span class="muted">Вантажиться у фоні (кожні 3 хв). </span><button class="btn sm" data-hfast="${s.id}">Вантажити швидше, поки сторінка відкрита</button>`}</div>`;
    };
    main.innerHTML = `
      <div class="head-row"><h2>${esc(m.title)}${acc ? ` · ${esc(acc.name)}` : ''}</h2>
        <div class="btn-row">${acc && can('api') ? '<button class="btn sm" id="mpRename">Перейменувати</button>' : ''}${acc ? `<button class="btn sm" id="mpSync" ${acc.active ? '' : 'disabled'}>Оновити зараз</button>` : ''}</div></div>
      <div class="f-chips" style="margin-bottom:10px">
        <a class="chip ${acc ? '' : 'on'}" href="#/${route}">Усі магазини · ${total}</a>
        ${shops.map((s) => `<a class="chip ${acc?.id === s.id ? 'on' : ''}" href="#/${route}/${s.id}" title="${esc(syncInfo(s))}">${esc(s.name)} · ${s.orders}${s.error ? ' ⚠️' : ''}</a>`).join('')}
      </div>
      ${(acc ? [acc] : shops).filter((s) => s.error).map((s) => `<div class="alert warn small" style="margin-bottom:10px">⚠️ «${esc(s.name)}»: не вдалося оновити${s.error_at ? ` (${esc(fmtDateTime(s.error_at))})` : ''} — ${esc(s.error)}</div>`).join('')}
      ${(acc ? [acc] : shops).filter((s) => s.active).map(hist).join('')}
      ${(acc ? [acc] : shops).filter((s) => s.active && s.reviews).map((s) => (s.reviews.error ? `<div class="alert warn small" style="margin-bottom:6px">Відгуки «${esc(s.name)}»: ${esc(s.reviews.error)}</div>`
    : !s.reviews.full ? `<div class="small muted" style="margin-bottom:6px">⏳ Відгуки «${esc(s.name)}» завантажуються у фоні${s.reviews.n ? '' : ' — перші з\'являться за кілька хвилин'}.</div>` : '')).join('')}
      <div class="small muted" style="margin-bottom:10px">${acc ? syncInfo(acc) : `Нові й змінені замовлення оновлюються самі кожні кілька хвилин${mp === 'rozetka' ? '' : ' (зберігаються 45 днів)'}.`}</div>
      <div class="btn-row" style="margin-bottom:10px;flex-wrap:wrap">
        <label class="sr-only" for="mpQ">Пошук</label><input id="mpQ" type="search" placeholder="№ замовлення, клієнт, телефон або ТТН" value="${esc(state.q)}" style="max-width:320px">
        <label class="small muted">з <input type="date" id="mpFrom" value="${esc(state.from)}"></label>
        <label class="small muted">по <input type="date" id="mpTo" value="${esc(state.to)}"></label>
        <button class="btn sm" data-per="30">30 днів</button>${mp === 'rozetka' ? '<button class="btn sm" data-per="365">Рік</button>' : ''}<button class="btn sm" data-per="">Увесь час</button>
      </div>
      ${rz ? `<div class="btn-row" style="margin-bottom:6px;flex-wrap:wrap;align-items:center"><span class="small muted">Відгуки:</span><span id="mpRv" class="f-chips"></span>
        ${can('api') ? '<button class="btn sm" id="mpRvSet">Текст нагадування</button>' : ''}</div><div id="mpRvStats" class="small muted" style="margin-bottom:10px"></div>` : ''}
      <div id="mpStatuses" class="f-chips" style="margin-bottom:10px"></div>
      <div id="mpTotal" class="small" style="margin-bottom:8px"></div>
      <div id="mpList"><div class="card empty"><span class="spinner"></span> Завантажую…</div></div>`;

    const name = new Map(shops.map((s) => [s.id, s.name]));
    const byKey = new Map(); // замовлення на екрані — для вікна нагадування
    const rvCell = (o) => {
      byKey.set(`${o.account_id}:${o.id}`, o);
      if (o.review_n > 0) return `<span class="badge ok">✓ відгук${o.review_mark ? ` ★${o.review_mark}` : ''}</span>${o.review_n > 1 ? ` <span class="muted">×${o.review_n}</span>` : ''}`;
      const asked = o.asked_at ? `<div class="muted">нагадав ${esc(dDay(o.asked_at.slice(0, 10)))}${o.asked_by ? ` · ${esc(o.asked_by)}` : ''}${o.asked_via ? ` · ${esc(VIA[o.asked_via] || o.asked_via)}` : ''}</div>` : '';
      if (!o.ok) return asked || '<span class="muted">—</span>';
      return `${asked}<button class="btn sm ${o.asked_at ? '' : 'primary'}" data-rvask="${esc(o.account_id)}:${esc(o.id)}">${o.asked_at ? 'Ще раз' : 'Нагадати'}</button>`;
    };
    const rowHtml = (o) => `<tr>
          <td><b>${esc(o.number)}</b><div class="small muted">${esc(dt(o.created_at))}</div></td>
          ${acc ? '' : `<td class="small">${esc(name.get(o.account_id) || '')}</td>`}
          <td>${esc(o.customer || '—')}<div class="small muted">${esc(o.phone || '')}</div></td>
          <td class="small">${o.items.length ? `${esc(o.items[0].name)}${o.items[0].qty > 1 ? ` × ${o.items[0].qty}` : ''}${o.items.length > 1 ? ` <span class="muted">+${o.items.length - 1}</span>` : ''}` : '—'}</td>
          <td class="r"><b>${uah(o.total)}</b></td>
          <td class="small">${esc(o.delivery || '—')}${o.ttn ? `<div class="muted">ТТН ${esc(o.ttn)}</div>` : ''}</td>
          <td><span class="badge">${esc(o.status_name || o.status || '—')}</span></td>
          ${rz ? `<td class="small" data-rvcell="${esc(o.account_id)}:${esc(o.id)}">${rvCell(o)}</td>` : ''}
        </tr>`;
    let offset = 0;
    const load = async (more = false) => {
      offset = more ? offset + 300 : 0;
      const qs = new URLSearchParams({ mp, offset: String(offset), ...(acc ? { account: acc.id } : {}), ...(state.status ? { status: state.status } : {}),
        ...(state.q ? { q: state.q } : {}), ...(state.from ? { from: state.from } : {}), ...(state.to ? { to: state.to } : {}), ...(state.rv ? { rv: state.rv } : {}) });
      const d = await api('GET', `/api/mp/orders?${qs}`);
      const sum = d.statuses.reduce((a, s) => a + s.n, 0);
      $('#mpStatuses').innerHTML = `<button class="chip ${state.status ? '' : 'on'}" data-st="">Усі · ${sum}</button>${d.statuses.map((s) => `<button class="chip ${state.status === s.status ? 'on' : ''}" data-st="${esc(s.status)}">${esc(s.status_name || s.status || '—')} · ${s.n}</button>`).join('')}`;
      $$('[data-st]').forEach((b) => (b.onclick = () => { state.status = b.dataset.st; load(); }));
      if (rz && d.reviews) {
        const s = d.reviews.stats;
        const pct = s.done ? Math.round((s.reviewed / s.done) * 100) : 0;
        const chips = [['', 'Усі'], ['ask', `Можна нагадати · ${s.toask}`], ['none', `Без відгуку · ${s.done - s.reviewed}`], ['asked', `Нагадали, чекаємо · ${s.asked - s.asked_reviewed}`], ['has', `З відгуком · ${s.reviewed}`]];
        $('#mpRv').innerHTML = chips.map(([k, t]) => `<button class="chip ${state.rv === k ? 'on' : ''}" data-rv="${k}" ${k === 'ask' ? `title="Виконані замовлення без відгуку, отримані щонайменше ${d.reviews.days} дн. тому, яким ще не нагадували"` : ''}>${esc(t)}</button>`).join('');
        $$('[data-rv]').forEach((b) => (b.onclick = () => { state.rv = b.dataset.rv; load(); }));
        $('#mpRvStats').innerHTML = s.done ? `Виконано ${s.done} замовлень · з відгуком на товар <b>${s.reviewed}</b> (${pct}%) · нагадали ${s.asked}, з них залишили відгук <b>${s.asked_reviewed}</b>${
          d.reviews.by.length ? ` · ${d.reviews.by.map((m) => `${esc(m.who || 'без імені')}: ${m.n} (відгуків ${m.reviewed})`).join(', ')}` : ''}` : '';
      }
      const tot = d.total || { n: 0, sum: 0 };
      $('#mpTotal').innerHTML = tot.n ? `Знайдено <b>${tot.n}</b> замовлень на <b>${uah(tot.sum)}</b>` : '';
      const moreBtn = d.more ? '<div style="margin-top:8px"><button class="btn sm" id="mpMore">Показати ще</button></div>' : '';
      if (more) {
        $('#mpList tbody').insertAdjacentHTML('beforeend', d.rows.map(rowHtml).join(''));
        bindAsk();
        $('#mpMore')?.parentElement.remove();
        $('#mpList').insertAdjacentHTML('beforeend', moreBtn);
      } else {
        $('#mpList').innerHTML = d.rows.length ? `<table class="list"><thead><tr><th>Замовлення</th>${acc ? '' : '<th>Магазин</th>'}<th>Клієнт</th><th>Товари</th><th class="r">Сума</th><th>Доставка</th><th>Статус</th>${rz ? '<th>Відгук</th>' : ''}</tr></thead><tbody>
          ${d.rows.map(rowHtml).join('')}</tbody></table>${moreBtn}`
          : `<div class="card empty">${state.q || state.status || state.from || state.to || state.rv ? 'Нічого не знайдено.' : 'Замовлень ще немає — вони з\'являться після першого оновлення (кілька хвилин).'}</div>`;
      }
      if ($('#mpMore')) $('#mpMore').onclick = () => load(true);
      if (!more) bindAsk();
    };

    // ---------- нагадування про відгук ----------
    function bindAsk() {
      $$('[data-rvask]').forEach((b) => (b.onclick = () => askModal(byKey.get(b.dataset.rvask))));
    }
    const fillTpl = (o) => String(rvSet?.tpl || '')
      .replaceAll("{ім'я}", firstName(o.customer)).replaceAll('{імʼя}', firstName(o.customer))
      .replaceAll('{товар}', String(o.items[0]?.name || 'товар').slice(0, 90)).replaceAll('{замовлення}', o.number).replaceAll('{магазин}', name.get(o.account_id) || '')
      .replace(/ ,/g, ',').replace(/\s{2,}/g, ' ');
    function askModal(o) {
      if (!o) return;
      const ph = intlPhone(o.phone);
      const digits = ph.replace(/\D/g, '');
      const md = modal(`Нагадати про відгук · №${o.number}`, `
        <div class="small" style="margin-bottom:8px"><b>${esc(o.customer || '—')}</b>${ph ? ` · ${esc(ph)}` : ''}<div class="muted">${o.items.map((i) => esc(i.name)).join('<br>') || '—'}</div>
          <div class="muted">${esc(o.status_name || '')} · ${esc(dt(o.changed_at))}</div></div>
        <label class="f"><span>Повідомлення (можна змінити)</span><textarea id="rvText" rows="6" style="width:100%">${esc(fillTpl(o))}</textarea></label>
        <div class="small muted" style="margin:4px 0 10px">Viber і Telegram відкриють чат з покупцем — текст уже буде скопійовано, лишиться вставити. У чат Розетки — без посилань і телефонів.</div>
        <div class="btn-row" style="flex-wrap:wrap">
          ${ph ? `<a class="btn" data-via="viber" href="viber://chat?number=%2B${digits}">Viber</a>
          <a class="btn" data-via="telegram" href="https://t.me/+${digits}" target="_blank" rel="noopener">Telegram</a>
          <a class="btn" data-via="phone" href="tel:${esc(ph)}">Подзвонити</a>` : '<span class="small muted">Телефону покупця немає.</span>'}
          <button class="btn" data-via="copy">Скопіювати текст</button>
          <button class="btn" id="rvChat">Надіслати в чат Розетки</button>
        </div>`,
      { footer: `${o.asked_at ? '<button class="btn" id="rvUndo">Зняти позначку</button>' : ''}<button class="btn" id="rvManual">Нагадав іншим способом</button><button class="btn primary" data-close>Готово</button>` });
      const text = () => $('#rvText', md.el).value.trim();
      const mark = async (via) => {
        try { Object.assign(o, await api('POST', '/api/mp/review/ask', { account: o.account_id, id: o.id, via })); toast(`Позначено: нагадав (${VIA[via]})`); load(); }
        catch (er) { toast(er.message, true); }
      };
      $$('[data-via]', md.el).forEach((b) => (b.onclick = async () => {
        if (b.dataset.via !== 'phone') await copyText(text());
        mark(b.dataset.via); // посилання відкривається саме (href)
      }));
      $('#rvManual', md.el).onclick = async () => { await mark('manual'); md.close(); };
      if ($('#rvUndo', md.el)) $('#rvUndo', md.el).onclick = async () => {
        try { await api('POST', '/api/mp/review/ask', { account: o.account_id, id: o.id, undo: true }); md.close(); load(); } catch (er) { toast(er.message, true); }
      };
      $('#rvChat', md.el).onclick = async (e) => {
        const b = e.currentTarget;
        b.disabled = true; b.innerHTML = '<span class="spinner"></span> Надсилаю…';
        try { await api('POST', '/api/mp/review/chat', { account: o.account_id, id: o.id, text: text() }); toast('Надіслано в чат Розетки'); md.close(); load(); }
        catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Надіслати в чат Розетки'; }
      };
    }
    if ($('#mpRvSet')) $('#mpRvSet').onclick = () => {
      const md = modal('Нагадування про відгук', `<form id="rvSetF" class="form-stack">
        <label class="f"><span>Пропонувати нагадати через (днів після отримання)</span><input name="days" type="number" min="0" max="60" value="${esc(rvSet.days)}" required></label>
        <label class="f"><span>Текст повідомлення. Підставляються: {ім'я}, {товар}, {замовлення}, {магазин}</span><textarea name="tpl" rows="6" required>${esc(rvSet.tpl)}</textarea></label>
        <div class="small muted">Для чату Розетки — без посилань, телефонів і реклами. Просимо саме чесний відгук: за накручені відгуки Розетка накладає санкції.</div></form>`,
      { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="rvSetSave">Зберегти</button>' });
      $('#rvSetSave', md.el).onclick = async () => {
        const f = $('#rvSetF', md.el);
        try { Object.assign(rvSet, await api('PUT', '/api/mp/review/settings', { days: Number(f.days.value), tpl: f.tpl.value })); md.close(); toast('Збережено'); load(); }
        catch (er) { toast(er.message, true); }
      };
    };
    let t = 0;
    $('#mpQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 300); };
    $('#mpFrom').onchange = (e) => { state.from = e.target.value; load(); };
    $('#mpTo').onchange = (e) => { state.to = e.target.value; load(); };
    $$('[data-per]').forEach((b) => (b.onclick = () => {
      state.to = '';
      state.from = b.dataset.per ? addDays(todayKyiv(), -Number(b.dataset.per)) : '';
      $('#mpFrom').value = state.from; $('#mpTo').value = '';
      load();
    }));
    if ($('#mpSync')) $('#mpSync').onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Оновлюю…';
      try { const r = await api('POST', '/api/mp/sync', { mp, account: acc.id }); toast(`Оновлено: ${r.saved} замовлень${r.more ? ' — решту довантажить автоматично' : ''}`); viewMarket(mp, acc.id); }
      catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Оновити зараз'; }
    };
    if ($('#mpRename')) $('#mpRename').onclick = () => {
      const md = modal(`Перейменувати «${acc.name}»`, `<form id="mpRn" class="form-stack"><label class="f"><span>Назва магазину (так само зміниться в налаштуваннях доставки)</span><input name="name" value="${esc(acc.name)}" required autocomplete="off"></label></form>`,
        { footer: '<button class="btn" data-close>Скасувати</button><button class="btn primary" id="mpRnSave">Зберегти</button>' });
      $('#mpRnSave', md.el).onclick = async () => {
        try { await api('PUT', `/api/mp/shops/${mp}/${acc.id}`, { name: $('#mpRn', md.el).name.value }); md.close(); toast('Перейменовано'); viewMarket(mp, acc.id); }
        catch (er) { toast(er.message, true); }
      };
    };
    $$('[data-hstart]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await api('POST', '/api/mp/history/start', { mp, account: Number(b.dataset.hstart) }); toast('Історію почато — вантажиться у фоні'); viewMarket(mp, account); }
      catch (er) { toast(er.message, true); b.disabled = false; }
    }));
    $$('[data-hfast]').forEach((b) => (b.onclick = async () => {
      const my = ++pump;
      const id = Number(b.dataset.hfast);
      b.disabled = true;
      for (;;) {
        if (my !== pump || !document.contains(b)) return; // пішли зі сторінки або перемальовано
        let h;
        try { h = await api('POST', '/api/mp/history/step', { mp, account: id }); } catch (er) { toast(er.message, true); b.disabled = false; return; }
        b.textContent = `Вантажу… ${h.pct}% · до ${dDay(h.to)} · ${h.saved} замовлень`;
        if (h.done) { toast('Історію завантажено'); viewMarket(mp, account); return; }
        if (h.paused) { toast('Денну норму завантажено — історія продовжиться завтра'); viewMarket(mp, account); return; }
        if (h.error) { toast(h.error, true); b.disabled = false; return; }
      }
    }));
    await load();
  }
  return { viewMarket };
}
