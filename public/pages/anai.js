// Аналітика → «Питання до ШІ»: чат, у якому ШІ відповідає на питання про продажі з даних аналітики.
// Розмова живе, доки відкрита вкладка браузера (sessionStorage); на сервер ідуть лише останні репліки.
// Підключення (ключ Anthropic API, модель, витрати за місяць) — тут же, для власника й адміністраторів.
import { esc } from '../invoice.js';
import { $, $$, main, api, toast } from '../core/ui.js';

const STORE = 'an_ai_chat';
const EXAMPLES = [
  'Як ідуть продажі цього місяця порівняно з минулим?',
  'Який менеджер продав найбільше за останні 30 днів і з якою часткою відмов?',
  'Які 5 товарів дали найбільший оборот у жовтні?',
  'Чому могли впасти продажі за останній тиждень?',
  'Порівняй відділи за оборотом без відмов цього місяця.',
];

// Мінімальний markdown відповіді: таблиці, списки, **жирний**, `код`, абзаци (після екранування).
function md(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = String(text || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
      const head = cells(l);
      const body = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
      i--;
      const num = (x) => /^[-+−]?[\d\s.,]+\s*(₴|грн|%|шт)?$/.test(x);
      out.push(`<div class="table-wrap"><table class="list"><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((x) => `<td class="${num(x) ? 'r' : ''}">${inline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^\s*[-*•]\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ''));
      i--;
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
    } else if (/^\s*\d+[.)]\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      i--;
      out.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`);
    } else if (/^#{1,4}\s+/.test(l)) out.push(`<p><b>${inline(l.replace(/^#{1,4}\s+/, ''))}</b></p>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('');
}

export function createAnAiPages({ can }) {
  let chat = [];
  try { chat = JSON.parse(sessionStorage.getItem(STORE) || '[]'); } catch { chat = []; }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(chat.slice(-30))); } catch { /* приватний режим */ } };
  let busy = false;

  async function viewAsk() {
    const admin = can('analytics');
    const [st, set] = await Promise.all([api('GET', '/api/an/ai/status'), admin ? api('GET', '/api/an/ai/settings').catch(() => null) : null]);
    main.innerHTML = `
      <div class="head-row"><h2>Питання до ШІ</h2>${chat.length ? '<button class="btn sm" id="aiClear">Нова розмова</button>' : ''}</div>
      ${st.enabled ? '' : `<div class="alert warn" style="margin-bottom:12px">ШІ ще не підключено. ${admin ? 'Вставте ключ Anthropic API нижче, у «Підключенні ШІ».' : 'Попросіть власника або адміністратора підключити його.'}</div>`}
      <div class="card ai-chat">
        <div id="aiLog" class="ai-log" aria-live="polite"></div>
        <form id="aiForm" class="ai-form">
          <label class="sr-only" for="aiQ">Питання</label>
          <textarea id="aiQ" rows="2" placeholder="Напишіть питання про продажі — наприклад, «який бренд найбільше виріс за місяць?»" ${st.enabled ? '' : 'disabled'}></textarea>
          <button class="btn primary" id="aiSend" ${st.enabled ? '' : 'disabled'}>Запитати</button>
        </form>
        <div class="small muted">Відповіді — з даних аналітики (замовлення LP-CRM)${can('analytics') ? '' : ' — лише по ваших замовленнях'}. ШІ може помилитися у висновках, а цифри бере тільки з аналітики. Enter — надіслати, Shift+Enter — новий рядок.</div>
      </div>
      ${admin && set ? `<details class="card" style="margin-top:12px" ${st.enabled ? '' : 'open'}><summary><b>Підключення ШІ</b> <span class="small muted">— ключ Anthropic API і модель</span></summary>
        <form id="aiSet" class="form-stack" style="margin-top:10px;max-width:560px">
          <label class="f"><span>Ключ Anthropic API</span><input name="key" value="${esc(set.key)}" placeholder="sk-ant-…" autocomplete="off"></label>
          <div class="small muted">Створіть на <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com → API Keys</a> і поповніть баланс. Там же можна поставити місячний ліміт витрат. Після збереження ключ не показується.</div>
          <label class="f"><span>Модель</span><select name="model">${set.models.map((m) => `<option value="${m.id}" ${m.id === set.model ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
          ${set.usage?.month ? `<div class="small muted">За ${esc(set.usage.month)}: питань ${set.usage.asks}, токенів — вхід ${Number(set.usage.input).toLocaleString('uk-UA')}, вихід ${Number(set.usage.output).toLocaleString('uk-UA')} (вартість — у console.anthropic.com → Usage).</div>` : ''}
          <div class="btn-row"><button class="btn primary">Зберегти</button>${set.key ? '<button type="button" class="btn danger" id="aiOff">Відключити ШІ</button>' : ''}</div>
          <div class="small muted">ШІ отримує лише підсумки аналітики (суми, кількості, назви товарів, логіни менеджерів) — без ПІБ і телефонів клієнтів.</div>
        </form></details>` : ''}`;

    const log = $('#aiLog');
    const draw = () => {
      log.innerHTML = chat.length ? chat.map((m) => (m.role === 'user'
        ? `<div class="ai-msg me">${esc(m.text).replace(/\n/g, '<br>')}</div>`
        : `<div class="ai-msg bot">${m.error ? `<div class="alert bad">${esc(m.text)}</div>` : md(m.text)}${m.steps?.length ? `<div class="small muted ai-steps">Дані: ${m.steps.map(esc).join(' · ')}</div>` : ''}</div>`)).join('')
        + (busy ? '<div class="ai-msg bot"><span class="spinner"></span> Дивлюся аналітику…</div>' : '')
        : `<div class="ai-empty"><div class="muted" style="margin-bottom:8px">Приклади питань:</div>${EXAMPLES.map((x) => `<button type="button" class="chip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
      log.scrollTop = log.scrollHeight;
      $$('[data-ex]').forEach((b) => (b.onclick = () => { $('#aiQ').value = b.dataset.ex; $('#aiQ').focus(); }));
    };
    draw();

    async function ask() {
      const q = $('#aiQ').value.trim();
      if (!q || busy) return;
      chat.push({ role: 'user', text: q });
      $('#aiQ').value = '';
      busy = true; save(); draw();
      $('#aiSend').disabled = true;
      try {
        const r = await api('POST', '/api/an/ai/ask', { messages: chat.filter((m) => !m.error).map(({ role, text }) => ({ role, text })) });
        chat.push({ role: 'assistant', text: r.answer, steps: r.steps });
      } catch (e) {
        chat.push({ role: 'assistant', text: e.message, error: true });
      }
      busy = false; save();
      if (!document.contains(log)) return; // пішли зі сторінки
      draw();
      $('#aiSend').disabled = false;
      $('#aiQ').focus();
    }
    $('#aiForm').onsubmit = (e) => { e.preventDefault(); ask(); };
    $('#aiQ').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
    if ($('#aiClear')) $('#aiClear').onclick = () => { chat = []; save(); viewAsk(); };
    if ($('#aiSet')) $('#aiSet').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try { await api('PUT', '/api/an/ai/settings', { key: f.key.value, model: f.model.value }); toast('Збережено'); viewAsk(); }
      catch (er) { toast(er.message, true); }
    };
    if ($('#aiOff')) $('#aiOff').onclick = async () => {
      try { await api('PUT', '/api/an/ai/settings', { key: '' }); toast('ШІ відключено'); viewAsk(); } catch (er) { toast(er.message, true); }
    };
    if (st.enabled) $('#aiQ').focus();
  }
  return { viewAsk };
}
