// Рахунок на оплату: HTML (екран, друк, PDF) і Word (.docx). Макет за зразком рахунку від ТОВ.
import { esc, money, qtyFmt, dateUa } from './invoice.js';
import { amountInWords } from './words.js';

const pibOnly = (s) => String(s || '').replace(/^\s*ФОП\s+/i, '').trim();
const fopTitle = (f) => f.full_name || f.short_name || '';

export function rahunokParts(r) {
  const f = r.fop || {};
  const supplier = [
    f.iban && `п/р ${f.iban}${f.bank ? ` у банку ${f.bank}` : ''},`,
    f.address && `${f.address},`,
    f.ipn && `РНОКПП ${f.ipn}${f.phone ? `, тел. ${f.phone}` : ''}`,
    !f.ipn && f.phone && `тел. ${f.phone}`,
  ].filter(Boolean);
  const buyer = [r.client?.edrpou && `код за ЄДРПОУ ${r.client.edrpou}`].filter(Boolean);
  return {
    f,
    title: `Рахунок на оплату № ${r.number} від ${dateUa(r.date)}`,
    supplier,
    buyer,
    words: amountInWords(r.total),
    signer: pibOnly(fopTitle(f)),
  };
}

// QR-код на оплату: картинка — це посилання (клікабельне і в збереженому PDF), під нею — текстове посилання.
const shortUrl = (u) => String(u || '').replace(/^https?:\/\//, '');
function payBlock(pay) {
  if (!pay) return '';
  if (pay.placeholder) {
    return `<div class="rh-pay"><div class="rh-qr rh-qr-ph">QR-код з’явиться після збереження</div>
      <div class="rh-pay-text"><b>Оплатити онлайн</b><br>Відскануйте QR-код камерою телефона або в застосунку банку.</div></div>`;
  }
  return `<div class="rh-pay"><a class="rh-qr" href="${esc(pay.page)}" target="_blank" rel="noopener"><img src="${esc(pay.qr)}" alt="QR-код для оплати"></a>
    <div class="rh-pay-text"><b>Оплатити онлайн</b><br>Відскануйте QR-код камерою телефона або в застосунку банку — реквізити й сума заповняться самі.
    На телефоні можна просто натиснути на QR-код або на посилання:<br><a href="${esc(pay.page)}" target="_blank" rel="noopener">${esc(shortUrl(pay.page))}</a></div></div>`;
}

export function renderRahunok(r) {
  const p = rahunokParts(r);
  const f = p.f;
  const rows = r.items.map((i, n) => `<tr>
      <td class="c-n">${n + 1}</td><td>${esc(i.name)}</td>
      <td class="c-q">${qtyFmt(i.qty)}</td><td class="c-u">${esc(i.unit || 'шт')}</td>
      <td class="c-m">${money(i.price)}</td><td class="c-m">${money(i.sum)}</td></tr>`).join('');
  return `<div class="paper"><div class="rh">
    ${f.warning_text ? `<div class="rh-warn">${esc(f.warning_text)}</div>` : ''}
    <div class="rh-sample">
      <div class="rh-sample-title">Зразок заповнення платіжного доручення</div>
      <div class="rh-grid">
        <div class="lbl">Отримувач</div><div class="val"><b>${esc(fopTitle(f))}</b></div>
        <div class="lbl">Код</div><div class="val"><span class="rh-box"><b>${esc(f.ipn || '')}</b></span></div>
        <div class="lbl">Банк отримувача</div><div class="val rh-bankrow"><b>${esc(f.bank || '')}</b><span class="rh-credit">КРЕДИТ рах. №</span></div>
        <div></div><div class="val rh-ibanrow"><span class="rh-box rh-iban"><b>${esc(f.iban || '')}</b></span></div>
      </div>
    </div>
    <h1 class="rh-title">${esc(p.title)}</h1>
    <div class="rh-parties">
      <div class="lbl">Постачальник:</div>
      <div><b class="rh-big">${esc(fopTitle(f))}</b>${p.supplier.map((l) => `<br>${esc(l)}`).join('')}</div>
      <div class="lbl">Покупець:</div>
      <div><b class="rh-big">${esc(r.client?.name || '')}</b>${p.buyer.map((l) => `<br>${esc(l)}`).join('')}</div>
      ${r.client?.contract ? `<div class="lbl">Договір:</div><div>${esc(r.client.contract)}</div>` : ''}
    </div>
    <table class="rh-items">
      <thead><tr><th class="c-n">№</th><th>Товари (роботи, послуги)</th><th class="c-q">Кіл-сть</th><th class="c-u">Од.</th><th class="c-m">Ціна</th><th class="c-m">Сума</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="rh-totals">
      <div><span>Всього:</span><b>${money(r.total)}</b></div>
      <div><span>Без ПДВ</span><b></b></div>
    </div>
    <div class="rh-words">Всього найменувань ${r.items.length}, на суму ${money(r.total)} грн.<br><b>${esc(p.words)}</b></div>
    ${payBlock(r.pay)}
    <div class="rh-sign">
      <span class="rh-sign-label">Виписав(ла):</span>
      <span class="rh-sign-line">
        ${f.signature ? `<img class="rh-sig" src="${f.signature}" alt="">` : ''}
        ${f.stamp ? `<img class="rh-stamp" src="${f.stamp}" alt="">` : ''}
      </span>
      <span class="rh-sign-name">${esc(p.signer)}</span>
    </div>
  </div></div>`;
}

// ---------- Word ----------
const D = () => window.docx;
const FONT = 'Arial';

function dataUrlBytes(url) {
  const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(url || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1].toLowerCase().replace('jpeg', 'jpg'), bytes };
}
const imgSize = (url) => new Promise((res) => {
  const im = new Image();
  im.onload = () => res({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
  im.onerror = () => res({ w: 1, h: 1 });
  im.src = url;
});
async function image(url, maxW, maxH) {
  const info = dataUrlBytes(url);
  if (!info) return null;
  const { w, h } = await imgSize(url);
  const k = Math.min(maxW / w, maxH / h, 1);
  return new (D().ImageRun)({ type: info.type, data: info.bytes, transformation: { width: Math.round(w * k), height: Math.round(h * k) } });
}

export async function rahunokDocx(r) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType } = D();
  const p = rahunokParts(r);
  const f = p.f;
  const run = (t, o = {}) => new TextRun({ text: String(t ?? ''), font: FONT, size: o.size || 18, bold: o.bold, color: o.color });
  const par = (children, o = {}) => new Paragraph({ children: [].concat(children), alignment: o.align, spacing: { before: o.before || 0, after: o.after ?? 40 } });
  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const LINE = { style: BorderStyle.SINGLE, size: 6, color: '333333' };
  const noB = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
  const cell = (children, o = {}) => new TableCell({
    children: [].concat(children), width: o.w ? { size: o.w, type: WidthType.DXA } : undefined, columnSpan: o.span,
    borders: o.borders || { top: NONE, bottom: NONE, left: NONE, right: NONE },
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
  });
  const boxed = { top: LINE, bottom: LINE, left: LINE, right: LINE };
  const body = [];

  if (f.warning_text) body.push(par(run(f.warning_text, { size: 15 }), { align: AlignmentType.CENTER, after: 160 }));

  // Зразок платіжного доручення
  body.push(par(run('Зразок заповнення платіжного доручення', { bold: true, size: 18 }), { align: AlignmentType.CENTER, after: 60 }));
  body.push(new Table({
    width: { size: 9600, type: WidthType.DXA }, columnWidths: [1900, 3300, 1100, 3300],
    borders: { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      new TableRow({ children: [cell(par(run('Отримувач', { size: 16 })), { w: 1900 }), cell(par(run(fopTitle(f), { bold: true, size: 17 })), { w: 7700, span: 3 })] }),
      new TableRow({ children: [cell(par(run('Код', { size: 16 })), { w: 1900 }), cell(par(run(f.ipn || '', { bold: true, size: 17 }), { align: AlignmentType.CENTER }), { w: 3300, borders: boxed }), cell(par(run('')), { w: 1100 }), cell(par(run('')), { w: 3300 })] }),
      new TableRow({ children: [cell(par(run('Банк отримувача', { size: 16 })), { w: 1900 }), cell(par(run('')), { w: 3300 }), cell(par(run('')), { w: 1100 }), cell(par(run('КРЕДИТ рах. №', { size: 16 }), { align: AlignmentType.CENTER }), { w: 3300 })] }),
      new TableRow({ children: [cell(par(run(f.bank || '', { bold: true, size: 17 })), { w: 5200, span: 2 }), cell(par(run('')), { w: 1100 }), cell(par(run(f.iban || '', { bold: true, size: 17 }), { align: AlignmentType.CENTER }), { w: 3300, borders: boxed })] }),
    ],
  }));

  body.push(new Paragraph({
    children: [run(p.title, { bold: true, size: 28 })], spacing: { before: 280, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 4 } },
  }));

  const partyRow = (label, lines) => new TableRow({ children: [
    cell(par(run(label, { size: 18 })), { w: 1900 }),
    cell(lines.map((l, i) => par(run(l, { bold: i === 0, size: i === 0 ? 20 : 17 }), { after: 20 })), { w: 7700 }),
  ] });
  const partyRows = [
    partyRow('Постачальник:', [fopTitle(f), ...p.supplier]),
    partyRow('Покупець:', [r.client?.name || '', ...p.buyer]),
  ];
  if (r.client?.contract) partyRows.push(partyRow('Договір:', [r.client.contract]));
  body.push(new Table({ width: { size: 9600, type: WidthType.DXA }, columnWidths: [1900, 7700], borders: noB, rows: partyRows }));
  body.push(par(run(''), { after: 120 }));

  const cols = [
    { h: '№', w: 500, a: AlignmentType.CENTER, v: (i, n) => String(n + 1) },
    { h: 'Товари (роботи, послуги)', w: 5000, v: (i) => i.name },
    { h: 'Кіл-сть', w: 900, a: AlignmentType.RIGHT, v: (i) => qtyFmt(i.qty) },
    { h: 'Од.', w: 600, a: AlignmentType.CENTER, v: (i) => i.unit || 'шт' },
    { h: 'Ціна', w: 1300, a: AlignmentType.RIGHT, v: (i) => money(i.price) },
    { h: 'Сума', w: 1300, a: AlignmentType.RIGHT, v: (i) => money(i.sum) },
  ];
  const grid = { top: LINE, bottom: LINE, left: LINE, right: LINE };
  body.push(new Table({
    width: { size: 9600, type: WidthType.DXA }, columnWidths: cols.map((c) => c.w),
    rows: [
      new TableRow({ tableHeader: true, children: cols.map((c) => cell(par(run(c.h, { bold: true, size: 17 }), { align: AlignmentType.CENTER, after: 0 }), { w: c.w, borders: grid, fill: 'EEEEEE' })) }),
      ...r.items.map((it, n) => new TableRow({ children: cols.map((c) => cell(par(run(c.v(it, n), { size: 17 }), { align: c.a, after: 0 }), { w: c.w, borders: grid })) })),
    ],
  }));

  body.push(par([run('Всього:  ', { bold: true, size: 20 }), run(money(r.total), { bold: true, size: 20 })], { align: AlignmentType.RIGHT, before: 140, after: 20 }));
  body.push(par(run('Без ПДВ', { bold: true, size: 18 }), { align: AlignmentType.RIGHT, after: 160 }));
  body.push(par(run(`Всього найменувань ${r.items.length}, на суму ${money(r.total)} грн.`, { size: 17 }), { after: 20 }));
  body.push(new Paragraph({
    children: [run(p.words, { bold: true, size: 20 })], spacing: { after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 6 } },
  }));

  if (r.pay?.qr) {
    const { ExternalHyperlink } = D();
    const qr = await image(r.pay.qr, 110, 110);
    const link = (children) => new ExternalHyperlink({ link: r.pay.page, children: [].concat(children) });
    body.push(new Table({
      width: { size: 9600, type: WidthType.DXA }, columnWidths: [1900, 7700], borders: noB,
      rows: [new TableRow({ children: [
        cell(par(qr ? link(qr) : run(''), { after: 0 }), { w: 1900 }),
        cell([
          par(run('Оплатити онлайн', { bold: true, size: 20 }), { after: 40 }),
          par(run('Відскануйте QR-код камерою телефона або в застосунку банку — реквізити й сума заповняться самі. На телефоні можна натиснути на QR-код або на посилання:', { size: 16 }), { after: 40 }),
          par(link(new TextRun({ text: String(r.pay.page).replace(/^https?:\/\//, ''), font: FONT, size: 17, color: '0563C1', underline: {} })), { after: 0 }),
        ], { w: 7700 }),
      ] })],
    }));
    body.push(par(run(''), { after: 60 }));
  }

  const imgs = [];
  if (f.signature) { const i = await image(f.signature, 130, 45); if (i) imgs.push(i); }
  if (f.stamp) { const i = await image(f.stamp, 95, 95); if (i) imgs.push(i); }
  body.push(new Table({
    width: { size: 9600, type: WidthType.DXA }, columnWidths: [4200, 3000, 2400], borders: noB,
    rows: [new TableRow({ children: [
      cell(par(run('Виписав(ла):', { bold: true, size: 19 }), { align: AlignmentType.RIGHT }), { w: 4200 }),
      cell([par(imgs.length ? imgs : [run(' ')], { align: AlignmentType.CENTER, after: 0 }), par(run('____________________________', { color: '777777' }), { align: AlignmentType.CENTER })], { w: 3000 }),
      cell(par(run(p.signer, { size: 18 })), { w: 2400 }),
    ] })],
  }));

  const doc = new Document({
    creator: 'Накладні', title: p.title,
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 800, bottom: 800, left: 1100, right: 1100 } } }, children: body }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const client = String(r.client?.name || '').replace(/[^\p{L}\p{N}.]+/gu, '_').slice(0, 40);
  a.download = `Рахунок_${r.number}${client ? '_' + client : ''}.docx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
