// Спільне для сторінок B2B (адмін і партнер): статуси, суми, завантаження файлів.
import { esc, money } from '../invoice.js';

export const uah = (n) => `${money(n)} грн`;
const ST_CLS = { invoice_wait: 'warn', pay_wait: 'warn', partial: 'info', paid: 'ok', done: 'ok', cancelled: 'bad' };
export const statusBadge = (o) => `<span class="badge ${ST_CLS[o.status] || ''}">${esc(o.status_name || o.status)}</span>`;
export const fmtDay = (d) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');
export const fileSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

// Завантажити файл на сервер (тіло — сам файл, назва — у заголовку).
export async function uploadFile(url, file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Файл завеликий (до 5 МБ).');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Файл не завантажено.');
  return j;
}

// Позиції замовлення таблицею.
export function itemsTable(items, { rrp = false } = {}) {
  const total = items.reduce((t, i) => t + Math.round(i.price * i.qty * 100) / 100, 0);
  return `<table class="list"><thead><tr><th>Товар</th><th class="r">К-сть</th>${rrp ? '<th class="r hide-m">РРЦ</th>' : ''}<th class="r">Ціна</th><th class="r">Сума</th></tr></thead><tbody>
    ${items.map((i) => `<tr><td>${esc(i.name)}${i.article ? `<div class="small muted">${esc(i.article)}</div>` : ''}</td>
      <td class="r">${i.qty}</td>${rrp ? `<td class="r small muted hide-m">${money(i.rrp)}</td>` : ''}<td class="r">${money(i.price)}</td><td class="r"><b>${money(Math.round(i.price * i.qty * 100) / 100)}</b></td></tr>`).join('')}
    <tr><td colspan="${rrp ? 4 : 3}" class="r"><b>Разом (з ПДВ)</b></td><td class="r"><b>${uah(total)}</b></td></tr>
  </tbody></table>`;
}
