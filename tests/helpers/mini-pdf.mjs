// Маленький PDF для тестів у форматі, як у BAS / TCPDF: шрифт Type0 Identity-H з ToUnicode, вміст стиснено FlateDecode,
// текст — літерали з \ddd. Кожен рядок — окремий рядок на сторінці.
import { deflateSync } from 'node:zlib';

export function miniPdf(lines) {
  const chars = [...new Set(lines.join(''))];
  const code = new Map(chars.map((ch, i) => [ch, i + 1]));
  const lit = (s) => `(${[...s].map((ch) => { const c = code.get(ch); return `\\${(c >> 8).toString(8).padStart(3, '0')}\\${(c & 255).toString(8).padStart(3, '0')}`; }).join('')})`;
  const content = `BT\n/F1 10 Tf\n40 800 Td\n${lines.map((l, i) => `${i ? '0 -12 Td\n' : ''}[${lit(l)}] TJ`).join('\n')}\nET\n`;
  const cmap = `/CIDInit /ProcSet findresource begin\nbegincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chars.length} beginbfchar\n`
    + `${chars.map((ch) => `<${code.get(ch).toString(16).padStart(4, '0')}> <${ch.codePointAt(0).toString(16).padStart(4, '0')}>`).join('\n')}\nendbfchar\nendcmap\nend\n`;
  const z = (s) => deflateSync(Buffer.from(s, 'latin1'));
  const cz = z(content);
  const mz = deflateSync(Buffer.from(cmap, 'utf8'));
  const parts = [];
  const offsets = [];
  let pos = 0;
  const push = (b) => { const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b; parts.push(buf); pos += buf.length; };
  push('%PDF-1.4\n');
  const obj = (n, body, stream) => {
    offsets[n] = pos;
    if (stream) { push(`${n} 0 obj\n<<\n${body}\n/Length ${stream.length}\n>>\nstream\n`); push(stream); push('\nendstream\nendobj\n'); }
    else push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  obj(1, '<<\n/Type /Catalog\n/Pages 2 0 R\n>>');
  obj(2, '<<\n/Type /Pages\n/Kids [ 3 0 R ]\n/Count 1\n>>');
  obj(3, '<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 595 842]\n/Contents 4 0 R\n/Resources\n<<\n/Font <<\n/F1 5 0 R\n>>\n>>\n>>');
  obj(4, '/Filter /FlateDecode', cz);
  obj(5, '<<\n/Type /Font\n/Subtype /Type0\n/BaseFont /HPDFAA+ArialMT\n/Encoding /Identity-H\n/ToUnicode 6 0 R\n>>');
  obj(6, '/Filter /FlateDecode', mz);
  const xref = pos;
  push(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}

// Рахунок / накладна як у BAS (рядки — як їх читає pdfText).
export function basDoc({ kind = 'invoice', number, date = '24 жовтня 2026', buyer, items }) {
  const total = items.reduce((t, i) => t + i.qty * i.price, 0);
  const fm = (n) => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/ /g, ' ');
  return [
    `${kind === 'invoice' ? 'Рахунок на оплату' : 'Видаткова накладна'} № ${number} від ${date} р.`,
    'Постачальник:', 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «ЕКОВЕНТ-ДИСТРИБ’ЮШН»',
    'Покупець:', buyer,
    'Договір:', 'Договір',
    '№', 'Товари (роботи, послуги)', 'Кіл-сть', 'Од.', 'Ціна з', 'ПДВ', 'Сума з ПДВ',
    ...items.flatMap((i, n) => [String(n + 1), ...i.name.split('|'), String(i.qty), 'шт', fm(i.price), fm(i.qty * i.price)]),
    'Всього:', fm(total), 'У тому числі ПДВ:', fm(total / 6),
    `Всього найменувань ${items.length}, на суму ${fm(total)} UAH.`,
  ];
}

// Маркування Нової пошти 100×100 (TCPDF).
export function npLabel({ ttn, phone = '095 700 18 04', name = 'Іваненко Петро Петрович' }) {
  const t = ttn.replace(/(\d{2})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4');
  return ['ПОЛТАВА', 'ГАДЯЧ', 'ВІД: 24.10/07:00', 'КОМУ:', 'Rozetka_DS', 'Тестовий Відправник', 'Чернівці, Відділення №4', '063 968 92 86',
    'Приватна особа', name, 'Гадяч, Відділення №1', phone, 'Вартість дост.: грн (відпр., безг-ка),', 'н/з:', 'РОЗ629905423', '10.80', 'П', '1', '1',
    t.slice(0, 12), t.slice(13)];
}
