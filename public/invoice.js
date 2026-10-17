// Рендер накладної в HTML (екран і друк). Той самий набір даних використовує експорт у Word.
import { amountInWords } from './words.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export const money = (n) =>
  (Number(n) || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ');

export const qtyFmt = (n) => (Number(n) || 0).toLocaleString('uk-UA', { maximumFractionDigits: 3 });

const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

export function dateUa(s) {
  let d = s ? new Date(String(s).replace(' ', 'T')) : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} р.`;
}

export const phoneFmt = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('380')) return `+38 (${d.slice(2, 5)}) ${d.slice(5, 8)}-${d.slice(8, 10)}-${d.slice(10)}`;
  return p || '';
};

export const DEFAULT_OPTIONS = {
  title: 'Видаткова накладна',
  accent: '#1f2937',
  showArticle: true,
  showUnit: true,
  showDelivery: true,
  showPayment: true,
  showSignatures: true,
  showStamp: true,
  vatNote: 'Без ПДВ',
  headerText: '',
  footerText: '',
  copies: 1,
};

// Готує все, що потрібно будь-якому формату (HTML, Word).
export function prepare(inv) {
  const o = { ...DEFAULT_OPTIONS, ...(inv.template?.options || {}) };
  const order = inv.order;
  const fop = inv.fop || {};
  // Назва продавця: якщо для відділу / поля 1 задано свій текст — він замінює рядок з назвою ФОП
  // (можна кілька рядків), реквізити нижче лишаються.
  const nameLines = inv.sellerText
    ? String(inv.sellerText).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : [fop.full_name ? `ФОП ${String(fop.full_name).replace(/^\s*ФОП\s+/i, '')}` : fop.short_name || '— ФОП не обрано —'];
  const supplierLines = [
    ...nameLines,
    fop.ipn && `ІПН (РНОКПП): ${fop.ipn}`,
    fop.address && `Адреса: ${fop.address}`,
    fop.iban && `IBAN: ${fop.iban}${fop.bank ? `, ${fop.bank}` : ''}`,
    fop.phone && `Тел.: ${fop.phone}`,
    fop.email && `E-mail: ${fop.email}`,
    fop.extra,
  ].filter(Boolean);
  const buyerLines = [
    order.buyer?.name || '—',
    order.buyer?.phone && `Тел.: ${phoneFmt(order.buyer.phone)}`,
    o.showDelivery && order.delivery?.address && `Доставка: ${order.delivery.address}`,
  ].filter(Boolean);
  const metaLines = [
    o.showDelivery && order.delivery?.method && `Спосіб доставки: ${order.delivery.method}`,
    o.showDelivery && order.delivery?.ttn && `ТТН: ${order.delivery.ttn}`,
    o.showPayment && order.payment && `Оплата: ${order.payment}`,
  ].filter(Boolean);
  const number = order.orderId;
  return {
    o,
    order,
    fop,
    supplierLines,
    nameCount: nameLines.length,
    buyerLines,
    metaLines,
    number,
    title: `${o.title} № ${number}`,
    dateText: `від ${dateUa(order.invoiceDate || order.date)}`,
    words: amountInWords(order.total),
    count: order.items.length,
  };
}

function itemsTable(p) {
  const { o, order } = p;
  const head = [
    '<th class="c-n">№</th>',
    o.showArticle ? '<th class="c-art">Артикул</th>' : '',
    '<th>Найменування</th>',
    o.showUnit ? '<th class="c-u">Од.</th>' : '',
    '<th class="c-q">К-сть</th>',
    '<th class="c-m">Ціна, грн</th>',
    '<th class="c-m">Сума, грн</th>',
  ].join('');
  const rows = order.items
    .map(
      (i, idx) => `<tr>
        <td class="c-n">${idx + 1}</td>
        ${o.showArticle ? `<td class="c-art">${esc(i.article)}</td>` : ''}
        <td>${esc(i.name)}${!o.showArticle && i.article ? ` <span style="color:#666">[${esc(i.article)}]</span>` : ''}</td>
        ${o.showUnit ? `<td class="c-u">${esc(i.unit || 'шт')}</td>` : ''}
        <td class="c-q">${qtyFmt(i.qty)}</td>
        <td class="c-m">${money(i.price)}</td>
        <td class="c-m">${money(i.sum)}</td>
      </tr>`,
    )
    .join('');
  return `<table class="inv-items"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function totals(p) {
  const { order, o } = p;
  const lines = [];
  if (order.discount || order.deliveryCost) lines.push(['Разом за товари', money(order.itemsTotal)]);
  if (order.discount) lines.push(['Знижка', `−${money(order.discount)}`]);
  if (order.deliveryCost) lines.push(['Доставка', money(order.deliveryCost)]);
  lines.push(['Всього до сплати', money(order.total), true]);
  return `<div class="inv-totals">
    ${lines.map(([k, v, strong]) => `<div class="${strong ? 'strong' : ''}"><span>${k}:</span><b>${v}</b></div>`).join('')}
    ${o.vatNote ? `<div class="vat">${esc(o.vatNote)}</div>` : ''}
  </div>`;
}

function signatures(p) {
  const { o, fop } = p;
  if (!o.showSignatures) return '';
  const sig = fop.signature ? `<img class="sig-img" src="${esc(fop.signature)}" alt="">` : '';
  const stamp = o.showStamp && fop.stamp ? `<img class="stamp-img" src="${esc(fop.stamp)}" alt="">` : '';
  return `<div class="inv-sign">
    <div class="sign-box">
      <div class="sign-label">Відвантажив (продавець)</div>
      <div class="sign-line">${sig}${stamp}</div>
      <div class="sign-name">${esc(fop.full_name || fop.short_name || '')}</div>
    </div>
    <div class="sign-box">
      <div class="sign-label">Отримав (покупець)</div>
      <div class="sign-line"></div>
      <div class="sign-name">${esc(p.order.buyer?.name || '')}</div>
    </div>
  </div>`;
}

const lines = (arr, bold = 1) => arr.map((l, i) => (i < bold ? `<div class="party-name">${esc(l)}</div>` : `<div>${esc(l)}</div>`)).join('');

function pageClassic(p) {
  const { o } = p;
  return `<div class="inv inv-classic" style="--accent:${esc(o.accent)}">
    ${o.headerText ? `<div class="inv-headnote">${esc(o.headerText)}</div>` : ''}
    <h1 class="inv-title">${esc(p.title)}<span>${esc(p.dateText)}</span></h1>
    <div class="inv-parties">
      <div class="party"><div class="party-label">Постачальник</div>${lines(p.supplierLines, p.nameCount)}</div>
      <div class="party"><div class="party-label">Покупець</div>${lines(p.buyerLines)}</div>
    </div>
    ${p.metaLines.length ? `<div class="inv-meta">${p.metaLines.map(esc).join(' &nbsp;·&nbsp; ')}</div>` : ''}
    ${itemsTable(p)}
    ${totals(p)}
    <div class="inv-words">Всього найменувань ${p.count}, на суму: <b>${esc(p.words)}</b></div>
    ${o.footerText ? `<div class="inv-foot">${esc(o.footerText)}</div>` : ''}
    ${signatures(p)}
  </div>`;
}

function pageCompact(p) {
  const { o } = p;
  return `<div class="inv inv-compact" style="--accent:${esc(o.accent)}">
    <div class="cmp-head">
      <div><div class="cmp-title">${esc(p.title)}</div><div class="cmp-date">${esc(p.dateText)}</div></div>
      <div class="cmp-seller">${p.supplierLines.slice(0, 3).map(esc).join('<br>')}</div>
    </div>
    ${o.headerText ? `<div class="inv-headnote">${esc(o.headerText)}</div>` : ''}
    <div class="cmp-buyer"><b>Покупець:</b> ${p.buyerLines.map(esc).join(', ')}</div>
    ${p.metaLines.length ? `<div class="inv-meta">${p.metaLines.map(esc).join(' · ')}</div>` : ''}
    ${itemsTable(p)}
    ${totals(p)}
    <div class="inv-words">Сума прописом: <b>${esc(p.words)}</b></div>
    ${o.footerText ? `<div class="inv-foot">${esc(o.footerText)}</div>` : ''}
    ${signatures(p)}
  </div>`;
}

function pageBranded(p) {
  const { o, fop } = p;
  return `<div class="inv inv-branded" style="--accent:${esc(o.accent)}">
    <div class="br-band">
      ${fop.logo ? `<img class="br-logo" src="${esc(fop.logo)}" alt="">` : `<div class="br-mark">${esc((fop.short_name || 'ФОП').replace(/^ФОП\s*/, ''))}</div>`}
      <div class="br-doc"><div class="br-title">${esc(o.title)}</div><div class="br-no">№ ${esc(p.number)} · ${esc(dateUa(p.order.invoiceDate || p.order.date))}</div></div>
    </div>
    ${o.headerText ? `<div class="inv-headnote">${esc(o.headerText)}</div>` : ''}
    <div class="inv-parties">
      <div class="party"><div class="party-label">Продавець</div>${lines(p.supplierLines, p.nameCount)}</div>
      <div class="party"><div class="party-label">Покупець</div>${lines(p.buyerLines)}</div>
    </div>
    ${p.metaLines.length ? `<div class="inv-meta">${p.metaLines.map(esc).join(' &nbsp;·&nbsp; ')}</div>` : ''}
    ${itemsTable(p)}
    ${totals(p)}
    <div class="inv-words">Всього на суму: <b>${esc(p.words)}</b></div>
    ${o.footerText ? `<div class="inv-foot">${esc(o.footerText)}</div>` : ''}
    ${signatures(p)}
  </div>`;
}

const LAYOUTS = { classic: pageClassic, compact: pageCompact, branded: pageBranded };
export const LAYOUT_NAMES = { classic: 'Класична', compact: 'Компактна', branded: 'Брендована' };

// Повертає HTML усіх сторінок (з урахуванням кількості копій).
export function renderInvoice(inv) {
  const p = prepare(inv);
  const fn = LAYOUTS[inv.template?.layout] || pageClassic;
  const page = fn(p);
  const copies = Math.max(1, Math.min(3, Number(p.o.copies) || 1));
  return Array.from({ length: copies }, () => `<div class="paper">${page}</div>`).join('');
}
