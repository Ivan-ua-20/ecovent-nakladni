// Експорт накладної у Word (.docx) прямо в браузері, бібліотека docx (vendor/docx.js → window.docx).
import { prepare, money, qtyFmt, dateUa } from './invoice.js';

const D = () => window.docx;
const FONT = 'Arial';

function dataUrlInfo(url) {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.*)$/i.exec(url || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const type = m[1].toLowerCase().replace('jpeg', 'jpg');
  return { type, bytes };
}

const imgSize = (url) =>
  new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
    im.onerror = () => resolve({ w: 1, h: 1 });
    im.src = url;
  });

async function image(url, maxW, maxH) {
  const info = dataUrlInfo(url);
  if (!info) return null;
  const { w, h } = await imgSize(url);
  const k = Math.min(maxW / w, maxH / h, 1);
  return new (D().ImageRun)({ type: info.type, data: info.bytes, transformation: { width: Math.round(w * k), height: Math.round(h * k) } });
}

const run = (text, opts = {}) => new (D().TextRun)({ text: String(text ?? ''), font: FONT, size: opts.size || 20, bold: opts.bold, color: opts.color, italics: opts.italics });
const para = (children, opts = {}) =>
  new (D().Paragraph)({ children: Array.isArray(children) ? children : [children], alignment: opts.align, spacing: { after: opts.after ?? 60, before: opts.before ?? 0 } });

const NONE = () => ({ style: D().BorderStyle.NONE, size: 0, color: 'FFFFFF' });
const noBorders = () => ({ top: NONE(), bottom: NONE(), left: NONE(), right: NONE(), insideHorizontal: NONE(), insideVertical: NONE() });

function cell(children, opts = {}) {
  const { TableCell, WidthType, ShadingType } = D();
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    borders: opts.borders,
  });
}

export async function exportDocx(inv) {
  const { Document, Packer, Table, TableRow, WidthType, AlignmentType } = D();
  const p = prepare(inv);
  const { o, order, fop } = p;
  const accent = (o.accent || '#1f2937').replace('#', '');
  const R = AlignmentType.RIGHT;
  const C = AlignmentType.CENTER;
  const body = [];

  if (inv.template?.layout === 'branded' && fop.logo) {
    const logo = await image(fop.logo, 180, 60);
    if (logo) body.push(para(logo, { after: 120 }));
  }
  if (o.headerText) body.push(para(run(o.headerText, { size: 18, italics: true }), { after: 120 }));
  body.push(para(run(`${o.title} № ${p.number}`, { size: 30, bold: true, color: accent }), { after: 40 }));
  body.push(para(run(`від ${dateUa(order.invoiceDate || order.date)}`, { size: 20, color: '555555' }), { after: 200 }));

  // Сторони
  const partyCell = (label, ls, bold = 1) =>
    cell([
      para(run(label.toUpperCase(), { size: 16, bold: true, color: '777777' }), { after: 40 }),
      ...ls.map((l, i) => para(run(l, { bold: i < bold, size: i < bold ? 21 : 19 }), { after: 20 })),
    ], { width: 4800, borders: noBorders() });
  body.push(new Table({
    width: { size: 9600, type: WidthType.DXA },
    columnWidths: [4800, 4800],
    borders: noBorders(),
    rows: [new TableRow({ children: [partyCell('Постачальник', p.supplierLines, p.nameCount), partyCell('Покупець', p.buyerLines)] })],
  }));
  if (p.metaLines.length) body.push(para(run(p.metaLines.join('   ·   '), { size: 18, color: '444444' }), { before: 120, after: 120 }));

  // Товари
  const cols = [
    { h: '№', w: 500, a: C, v: (i, idx) => String(idx + 1) },
    o.showArticle && { h: 'Артикул', w: 1300, v: (i) => i.article },
    { h: 'Найменування', w: 0, v: (i) => (!o.showArticle && i.article ? `${i.name} [${i.article}]` : i.name) },
    o.showUnit && { h: 'Од.', w: 600, a: C, v: (i) => i.unit || 'шт' },
    { h: 'К-сть', w: 800, a: R, v: (i) => qtyFmt(i.qty) },
    { h: 'Ціна, грн', w: 1300, a: R, v: (i) => money(i.price) },
    { h: 'Сума, грн', w: 1400, a: R, v: (i) => money(i.sum) },
  ].filter(Boolean);
  const fixed = cols.reduce((s, c) => s + c.w, 0);
  cols.find((c) => c.w === 0).w = 9600 - fixed;
  const header = new TableRow({
    tableHeader: true,
    children: cols.map((c) => cell(para(run(c.h, { bold: true, size: 18 }), { align: c.a, after: 0 }), { width: c.w, fill: 'EEEEEE' })),
  });
  const rows = order.items.map((it, idx) =>
    new TableRow({ children: cols.map((c) => cell(para(run(c.v(it, idx), { size: 19 }), { align: c.a, after: 0 }), { width: c.w })) }),
  );
  body.push(new Table({ width: { size: 9600, type: WidthType.DXA }, columnWidths: cols.map((c) => c.w), rows: [header, ...rows] }));

  // Підсумки
  const tl = [];
  if (order.discount || order.deliveryCost) tl.push(['Разом за товари', money(order.itemsTotal)]);
  if (order.discount) tl.push(['Знижка', `−${money(order.discount)}`]);
  if (order.deliveryCost) tl.push(['Доставка', money(order.deliveryCost)]);
  tl.push(['Всього до сплати', money(order.total), true]);
  body.push(para(run(''), { after: 60 }));
  for (const [k, v, strong] of tl) body.push(para([run(`${k}: `, { bold: strong, size: strong ? 22 : 20 }), run(v, { bold: true, size: strong ? 22 : 20 })], { align: R, after: 20 }));
  if (o.vatNote) body.push(para(run(o.vatNote, { size: 18, color: '555555' }), { align: R }));
  body.push(para([run(`Всього найменувань ${p.count}, на суму: `), run(p.words, { bold: true })], { before: 160, after: 160 }));
  if (o.footerText) body.push(para(run(o.footerText, { size: 18, color: '444444' }), { after: 200 }));

  // Підписи
  if (o.showSignatures) {
    const sigRuns = [];
    if (fop.signature) { const s = await image(fop.signature, 140, 50); if (s) sigRuns.push(s); }
    if (o.showStamp && fop.stamp) { const s = await image(fop.stamp, 100, 100); if (s) sigRuns.push(s); }
    const box = (label, name, imgs) =>
      cell([
        para(run(label, { size: 18, color: '555555' }), { after: 40 }),
        para(imgs.length ? imgs : [run(' ')], { after: 0 }),
        para(run('______________________________', { color: '999999' }), { after: 20 }),
        para(run(name || '', { size: 18 })),
      ], { width: 4800, borders: noBorders() });
    body.push(new Table({
      width: { size: 9600, type: WidthType.DXA },
      columnWidths: [4800, 4800],
      borders: noBorders(),
      rows: [new TableRow({ children: [box('Відвантажив (продавець)', fop.full_name || fop.short_name, sigRuns), box('Отримав (покупець)', order.buyer?.name, [])] })],
    }));
  }

  const doc = new Document({
    creator: 'Накладні',
    title: `${o.title} ${p.number}`,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1150, right: 1150 } } }, children: body }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Накладна_${p.number}${fop.short_name ? '_' + fop.short_name.replace(/[^\p{L}\p{N}.]+/gu, '_') : ''}.docx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
