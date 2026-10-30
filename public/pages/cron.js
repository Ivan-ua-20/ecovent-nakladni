// Фонові задачі: стан задач за розкладом, ключ і покрокове налаштування Cloudflare Worker (Cron Trigger).
import { esc } from '../invoice.js';
import { $, $$, main, api, toast, confirmDanger, fmtDateTime } from '../core/ui.js';

// Коротко про результат задачі — людською мовою.
const resultText = (r) => {
  if (!r || typeof r !== 'object') return '';
  if (r.skipped) return `пропущено: ${r.skipped}`;
  if (r.fresh) return 'ще не час — нічого не робила';
  if (r.busy) return 'LP-CRM зайнята — наступного разу';
  if (r.more) return 'частину зроблено, продовжить наступного разу';
  if (r.started) return 'почала оновлення';
  if (r.step) return `оновлення: ${r.step}${r.pct != null ? ` (${r.pct}%)` : ''}`;
  if (r.indexed != null) return `у списку ${r.indexed} прийнятих замовлень`;
  if (r.listed != null) return `перевірено замовлень: ${r.listed}${r.dups ? `, дублів: ${r.dups}` : ''}`;
  if (r.saved != null) return `оновлено замовлень: ${r.saved}`;
  return '';
};

export function createCronPages() {
  async function viewCron() {
    const d = await api('GET', '/api/jobs');
    const code = `// Фонові задачі сайту ${location.origin}: кожну задачу викликає окремим запитом.
export default {
  async scheduled(event, env, ctx) {
    const base = '${location.origin}';
    const headers = { 'X-Cron-Key': env.CRON_KEY };
    ctx.waitUntil((async () => {
      const r = await fetch(base + '/api/cron/tasks', { headers });
      if (!r.ok) return;
      const { tasks = [] } = await r.json();
      for (const t of tasks) await fetch(base + '/api/cron/run/' + t, { method: 'POST', headers }).catch(() => {});
    })());
  },
};`;
    main.innerHTML = `
      <div class="head-row"><h2>Фонові задачі</h2></div>
      <div class="alert ${d.active ? 'info' : 'warn'}" style="margin-bottom:14px">${d.active
        ? `✅ <b>Розклад працює.</b> Останній запуск: ${esc(fmtDateTime(d.lastTick))}. Задачі виконуються самі, навіть коли на сайті нікого немає.`
        : `⏳ <b>Розклад не налаштовано${d.lastTick ? ` (останній запуск: ${esc(fmtDateTime(d.lastTick))})` : ''}.</b> Поки що ці задачі запускаються лише попутно, коли хтось працює на сайті.`}</div>
      <table class="list"><thead><tr><th>Задача</th><th>Останній запуск</th><th>Результат</th><th></th></tr></thead><tbody>
        ${d.tasks.map((t) => `<tr>
          <td><b>${esc(t.title)}</b><div class="small muted">${esc(t.name)}</div></td>
          <td class="small">${t.last ? `${esc(fmtDateTime(t.last.at))}<div class="muted">${(t.last.ms / 1000).toFixed(1)} с</div>` : '<span class="muted">ще не запускалась</span>'}</td>
          <td class="small">${t.last ? (t.last.ok ? esc(resultText(t.last.result) || 'виконано') : `<span class="badge bad">помилка</span> ${esc(t.last.error)}`) : ''}</td>
          <td style="text-align:right"><button class="btn sm" data-run="${esc(t.name)}">Запустити зараз</button></td>
        </tr>`).join('')}</tbody></table>
      <div class="card form-stack" style="margin-top:20px;max-width:860px">
        <h3 style="margin:0">Як налаштувати розклад (Cloudflare Worker)</h3>
        <div class="small">Сайт працює на Cloudflare Pages, а там немає запуску за розкладом. Тому його робить маленький безкоштовний Cloudflare Worker: раз на 3 хв він викликає задачі сайту.</div>
        <ol class="small" style="padding-left:18px;margin:0;line-height:1.8">
          <li><b>Ключ</b> (його знає лише Worker): <span class="pl-url"><input readonly id="cronKey" value="${esc(d.key)}" placeholder="ще не створено" aria-label="Ключ"><button type="button" class="btn sm" id="cronCopyKey">Копіювати</button><button type="button" class="btn sm" id="cronNewKey">${d.key ? 'Новий ключ' : 'Створити ключ'}</button></span></li>
          <li>Cloudflare → <b>Workers &amp; Pages</b> → <b>Create</b> → <b>Create Worker</b> (шаблон «Hello World»), назва напр. <code>ecovent-cron</code> → <b>Deploy</b>.</li>
          <li><b>Edit code</b> → замініть увесь код на цей → <b>Deploy</b>:
            <pre class="small" style="white-space:pre-wrap;background:var(--soft,#f4f4f4);padding:8px;border-radius:6px;margin:6px 0">${esc(code)}</pre><button type="button" class="btn sm" id="cronCopyCode">Копіювати код</button></li>
          <li>У Worker'і: <b>Settings</b> → <b>Variables and Secrets</b> → <b>Add</b> → тип <b>Secret</b>, назва <code>CRON_KEY</code>, значення — ключ з п. 1 → <b>Deploy</b>.</li>
          <li><b>Settings</b> → <b>Trigger Events</b> → <b>Add</b> → <b>Cron Triggers</b> → <code>*/3 * * * *</code> → <b>Add</b>.</li>
          <li>За кілька хвилин угорі цієї сторінки з'явиться «Розклад працює».</li>
        </ol>
        <div class="small muted">Якщо раніше вже налаштовували Worker для перевірки ТТН — замініть у ньому код на новий і розклад на <code>*/3 * * * *</code>; ключ лишається той самий.</div>
      </div>`;
    const cp = async (t, msg) => { try { await navigator.clipboard.writeText(t); toast(msg); } catch { toast('Не вдалося скопіювати', true); } };
    $('#cronCopyKey').onclick = () => (d.key ? cp(d.key, 'Ключ скопійовано') : toast('Спершу створіть ключ', true));
    $('#cronCopyCode').onclick = () => cp(code, 'Код скопійовано');
    $('#cronNewKey').onclick = async () => {
      if (d.key && !(await confirmDanger('Створити новий ключ?', 'Старий перестане працювати — оновіть CRON_KEY у Worker’і.', 'Створити'))) return;
      try { await api('POST', '/api/jobs/key'); toast('Ключ створено — додайте його в Worker як CRON_KEY'); viewCron(); } catch (er) { toast(er.message, true); }
    };
    $$('[data-run]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('POST', `/api/jobs/run/${encodeURIComponent(b.dataset.run)}`);
        toast(r.ok ? `Виконано${resultText(r.result) ? `: ${resultText(r.result)}` : ''}` : `Помилка: ${r.error}`, !r.ok);
        viewCron();
      } catch (er) { toast(er.message, true); b.disabled = false; }
    }));
  }
  return { viewCron };
}
