// Текст із PDF без сторонніх бібліотек (працює і в Cloudflare Workers, і в Node.js) + розбір наших документів:
// рахунок / видаткова накладна з BAS і маркування Нової пошти (100×100, TCPDF).
// Підтримується те, що трапляється в цих документах: стиснення FlateDecode, шрифти Identity-H із ToUnicode,
// рядки <hex> і (літерали з \ddd). Скан (картинка) тексту не має — тоді повертається порожній рядок.

// Байти → рядок 1:1. TextDecoder('latin1') — це windows-1252: байти 0x80–0x9F стають іншими символами, тож для
// точних байтів повертаємо їм код (byteAt).
const dec1252 = new TextDecoder('latin1');
const W1252 = new Map([...Array(32)].map((_, i) => [dec1252.decode(new Uint8Array([0x80 + i])).charCodeAt(0), 0x80 + i]));
const latin1 = (u8) => dec1252.decode(u8);
const byteAt = (ch) => { const c = ch.charCodeAt(0); return c < 256 ? c : (W1252.get(c) ?? 63); };

async function inflate(u8) {
  // Читаємо частинами: «сміття» після кінця стиснених даних (буває в PDF) не ламає результат.
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  w.write(u8).catch(() => {});
  w.close().catch(() => {});
  const chunks = [];
  let n = 0;
  const r = ds.readable.getReader();
  try {
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
    }
  } catch { /* кінець даних */ }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Об'єкти PDF: номер → { dict, stream }
function objects(bytes) {
  const s = latin1(bytes);
  const out = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    const body = s.slice(start, end);
    const si = body.indexOf('stream');
    let dict = body;
    let stream = null;
    if (si >= 0) {
      dict = body.slice(0, si);
      let a = start + si + 6;
      if (s[a] === '\r') a++;
      if (s[a] === '\n') a++;
      const lm = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dict);
      const direct = lm && !lm[2];
      let b = direct ? a + Number(lm[1]) : s.indexOf('endstream', a);
      if (!direct) while (b > a && (s[b - 1] === '\n' || s[b - 1] === '\r')) b--;
      stream = bytes.subarray(a, b);
    }
    out.set(Number(m[1]), { dict, stream });
    re.lastIndex = end;
  }
  return out;
}

const hexToStr = (hex) => {
  let r = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) { const c = parseInt(hex.slice(i, i + 4), 16); if (!Number.isNaN(c)) r += String.fromCodePoint(c); }
  return r;
};
function parseCMap(txt) {
  const map = new Map();
  for (const blk of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  }
  for (const blk of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const a = parseInt(m[1], 16);
      const b = parseInt(m[2], 16);
      if (m[3]) { const base = parseInt(m[3], 16); for (let c = a; c <= b && c - a < 5000; c++) map.set(c, String.fromCodePoint(base + c - a)); }
      else [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((x, i) => map.set(a + i, hexToStr(x[1])));
    }
  }
  return map;
}

// рядок PDF → байти: <hex> або (літерал з \ddd, \n, \( …)
function bytesOf(tokS) {
  const out = [];
  if (tokS[0] === '<') {
    const hx = tokS.slice(1, -1).replace(/\s/g, '');
    for (let i = 0; i < hx.length; i += 2) out.push(parseInt(hx.slice(i, i + 2).padEnd(2, '0'), 16));
    return out;
  }
  const t = tokS.slice(1, -1);
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch !== '\\') { out.push(byteAt(ch)); continue; }
    const nx = t[++i];
    if (nx === undefined) break;
    if (/[0-7]/.test(nx)) { let o = nx; while (o.length < 3 && /[0-7]/.test(t[i + 1])) o += t[++i]; out.push(parseInt(o, 8) & 255); }
    else if (nx === '\n' || nx === '\r') continue;
    else out.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[nx] ?? byteAt(nx));
  }
  return out;
}

const MAX_PDF = 6 * 1024 * 1024;

// Текст сторінок рядками (порядок — як у файлі). Помилка розбору — порожній рядок, не виняток.
export async function pdfText(bytes) {
  try {
    if (!bytes?.length || bytes.length > MAX_PDF || latin1(bytes.subarray(0, 5)) !== '%PDF-') return '';
    const objs = objects(bytes);
    const dec = async (o) => (o.stream ? (/FlateDecode/.test(o.dict) ? await inflate(o.stream) : o.stream) : null);
    const fontCmap = new Map();
    for (const [n, o] of objs) {
      if (!/\/Type\s*\/Font/.test(o.dict)) continue;
      const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(o.dict);
      const cm = tu && objs.get(Number(tu[1]));
      if (cm) fontCmap.set(n, parseCMap(latin1(await dec(cm))));
    }
    const resName = new Map();
    for (const [, o] of objs) {
      const fm = /\/Font\s*<<([^>]*)>>/.exec(o.dict);
      if (fm) for (const m of fm[1].matchAll(/\/(\S+?)\s+(\d+)\s+0\s+R/g)) resName.set(m[1], Number(m[2]));
    }
    const lines = [];
    const tok = /\/(\S+)\s+[\d.]+\s+Tf|([\d.-]+)\s+([\d.-]+)\s+Td|[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+([\d.-]+)\s+Tm|(<[0-9A-Fa-f\s]*>|\((?:\\[\s\S]|[^\\)])*\))\s*Tj|\[((?:\\[\s\S]|[^\]\\])*)\]\s*TJ|\bT\*|\bET\b/g;
    for (const [, o] of objs) {
      if (!o.stream || /\/(Subtype\s*\/Image|Length1|FontFile|Type\s*\/Font|Type\s*\/XRef|Type\s*\/ObjStm)/.test(o.dict)) continue;
      let content;
      try { content = latin1(await dec(o)); } catch { continue; }
      if (!/\bTf\b/.test(content)) continue;
      let cmap = null;
      let line = '';
      let lastY = null;
      const flush = () => { if (line.trim()) lines.push(line.replace(/\s+/g, ' ').trim()); line = ''; };
      const decode = (s) => {
        if (!cmap) return '';
        const b = bytesOf(s);
        let r = '';
        for (let i = 0; i + 1 < b.length; i += 2) r += cmap.get((b[i] << 8) | b[i + 1]) ?? '';
        return r;
      };
      tok.lastIndex = 0;
      let m;
      while ((m = tok.exec(content))) {
        if (m[1]) cmap = fontCmap.get(resName.get(m[1])) || null;
        else if (m[3] !== undefined) { if (Math.abs(Number(m[3])) > 0.5) flush(); else line += ' '; }
        else if (m[5] !== undefined) { const y = Number(m[5]); if (lastY !== null && Math.abs(y - lastY) > 2) flush(); else line += ' '; lastY = y; }
        else if (m[6] !== undefined) line += decode(m[6]);
        else if (m[7] !== undefined) {
          for (const p of m[7].matchAll(/(<[0-9A-Fa-f\s]*>|\((?:\\[\s\S]|[^\\)])*\))|(-?[\d.]+)/g)) {
            if (p[1] !== undefined) line += decode(p[1]); else if (Number(p[2]) < -200) line += ' ';
          }
        } else flush();
      }
      flush();
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- документи
const MONTHS = { січня: 1, лютого: 2, березня: 3, квітня: 4, травня: 5, червня: 6, липня: 7, серпня: 8, вересня: 9, жовтня: 10, листопада: 11, грудня: 12 };
const money = (s) => Number(String(s).replace(/[\s  ]/g, '').replace(',', '.'));
const MONEY_RE = /^\d{1,3}(?:[\s  ]\d{3})*,\d{2}$/;

// Рахунок на оплату / видаткова накладна (BAS): тип, №, дата, покупець, сума, товари.
export function parseBasDoc(text) {
  const t = String(text || '').replace(/[  ]/g, ' ');
  const head = /(Рахунок на оплату|Рахунок-фактура|Рахунок|Видаткова накладна|Накладна)\s*№\s*([\w\-/.]+)\s*від\s*(\d{1,2})\s+([а-яіїєґ']+)\s+(\d{4})/i.exec(t);
  if (!head) return null;
  const total = /Всього:\s*([\d ]+,\d{2})/.exec(t) || /на суму\s*([\d ]+,\d{2})\s*UAH/.exec(t);
  const buyer = /Покупець:\s*([^\n]+)/.exec(t);
  const mon = MONTHS[head[4].toLowerCase()];
  // Товари: «№», рядки назви, кількість, одиниця, ціна з ПДВ, сума з ПДВ.
  const items = [];
  const lines = t.split('\n').map((x) => x.trim());
  let i = lines.findIndex((x) => /^Сума з ПДВ$/i.test(x));
  if (i >= 0) {
    for (i += 1; i < lines.length; i++) {
      if (/^Всього/.test(lines[i])) break;
      if (!/^\d{1,3}$/.test(lines[i])) continue;
      const name = [];
      let j = i + 1;
      while (j < lines.length && !(/^\d+(?:[.,]\d+)?$/.test(lines[j]) && /^[а-яіїєґa-z.]{1,6}$/i.test(lines[j + 1] || '') && MONEY_RE.test(lines[j + 2] || ''))) {
        if (/^Всього/.test(lines[j])) break;
        name.push(lines[j]);
        j++;
      }
      if (j >= lines.length || /^Всього/.test(lines[j])) break;
      items.push({ n: Number(lines[i]), name: name.join(' ').replace(/\s+/g, ' ').trim(), qty: Number(lines[j].replace(',', '.')), price: money(lines[j + 2]), sum: MONEY_RE.test(lines[j + 3] || '') ? money(lines[j + 3]) : null });
      i = j + 3;
    }
  }
  return {
    kind: /накладна/i.test(head[1]) ? 'waybill' : 'invoice',
    number: head[2].replace(/[.]+$/, ''),
    date: mon ? `${head[5]}-${String(mon).padStart(2, '0')}-${head[3].padStart(2, '0')}` : '',
    total: total ? money(total[1]) : null,
    buyer: buyer ? buyer[1].trim() : '',
    items,
  };
}

// Маркування Нової пошти: ТТН, телефон і ПІБ одержувача, № замовлення Розетки (РОЗ…).
export function parseNpLabel(text) {
  const t = String(text || '');
  // ТТН: 14 цифр із 20/59, на маркуванні групами «20 4005 5698 2593» (інколи з переносом рядка).
  const ttn = (/(?<![\d ])((?:20|59)(?:[ \n]?\d){12})(?![ \n]?\d)/.exec(t)?.[1] || '').replace(/\D/g, '');
  const phones = [...t.matchAll(/(?<!\d)(0\d{2})[ -]?(\d{3})[ -]?(\d{2})[ -]?(\d{2})(?!\d)/g)].map((m) => `38${m[1]}${m[2]}${m[3]}${m[4]}`);
  const lines = t.split('\n').map((x) => x.trim());
  // одержувач: рядки між «Приватна особа»/назвою (після «КОМУ:») і адресою «…, Відділення …»
  let recipient = '';
  const komu = lines.findIndex((x) => /^КОМУ:?$/i.test(x));
  if (komu >= 0) {
    const after = lines.slice(komu + 1);
    const priv = after.findIndex((x) => /^Приватна особа$/i.test(x));
    if (priv >= 0) {
      const name = [];
      for (const x of after.slice(priv + 1)) { if (/Відділення|Поштомат|вул\.|\d{3} \d{3}/i.test(x)) break; name.push(x); }
      recipient = name.join(' ').trim();
    }
  }
  return ttn ? { ttn, phone: phones.at(-1) || '', recipient, rozetka: /РОЗ\s?(\d{6,})/.exec(t)?.[1] || '' } : null;
}

// Підказки з назви файлу або підпису: № замовлення B2B, тип і № документа.
export function hintsOf(str) {
  const s = String(str || '');
  const order = /B2B[\s-]*(\d{1,9})/i.exec(s)?.[1];
  const kind = /накладн|\bрн\b|\bвн\b/i.test(s) ? 'waybill' : /рахун|\bсф\b|invoice/i.test(s) ? 'invoice' : '';
  const number = /(?:№|N|#|номер)\s*([A-Za-zА-Яа-яІЇЄ]{0,4}-?\d{1,10})/i.exec(s)?.[1] || '';
  return { order: order ? Number(order) : null, kind, number };
}

// Назва юрособи для порівняння: без лапок, форми власності й регістру; слова — у відсортованому наборі.
export function nameKey(s) {
  return String(s || '').toLowerCase()
    .replace(/товариство з обмеженою відповідальністю|приватне підприємство|фізична особа[\s-]*підприємець/g, ' ')
    .replace(/[«»"'’`.,()]/g, ' ')
    .split(/\s+/).filter((w) => w && !['тов', 'фоп', 'пп', 'фо-п', 'фоп-'].includes(w))
    .sort().join(' ');
}
export function sameName(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = new Set(x.split(' '));
  const ys = y.split(' ');
  const common = ys.filter((w) => xs.has(w)).length;
  return common >= Math.min(2, Math.min(xs.size, ys.length)) && common >= Math.min(xs.size, ys.length) * 0.66;
}

// Слова-моделі для зіставлення назв (BAS ↔ каталог): латиниця й числа, напр. «Dryora», «12», «Core», «600S».
export const modelTokens = (s) => new Set(String(s || '').toLowerCase().replace(/\[\d+\]/g, ' ')
  .split(/[^a-z0-9а-яіїєґ]+/i).filter((w) => w.length >= 2 && (/[a-z]/.test(w) || /\d/.test(w)) && !['wi', 'fi', 'uv', 'hepa', 'smart', 'true', 'mod', 'auto'].includes(w)));
