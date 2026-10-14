// Сума прописом українською: 1234.5 → «Одна тисяча двісті тридцять чотири гривні 50 копійок»

const ONES_M = ['', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
const ONES_F = ['', 'одна', 'дві', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
const TEENS = ['десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', "п'ятнадцять",
  'шістнадцять', 'сімнадцять', 'вісімнадцять', "дев'ятнадцять"];
const TENS = ['', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яносто"];
const HUNDREDS = ['', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот', 'вісімсот', "дев'ятсот"];

// [одна, дві-чотири, п'ять+]
const UNITS = [
  { forms: ['гривня', 'гривні', 'гривень'], fem: true },
  { forms: ['тисяча', 'тисячі', 'тисяч'], fem: true },
  { forms: ['мільйон', 'мільйони', 'мільйонів'], fem: false },
  { forms: ['мільярд', 'мільярди', 'мільярдів'], fem: false },
];

export function plural(n, forms) {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 19) return forms[2];
  if (n10 === 1) return forms[0];
  if (n10 >= 2 && n10 <= 4) return forms[1];
  return forms[2];
}

function triad(n, fem) {
  const out = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) out.push(HUNDREDS[h]);
  if (t === 1) out.push(TEENS[o]);
  else {
    if (t) out.push(TENS[t]);
    if (o) out.push((fem ? ONES_F : ONES_M)[o]);
  }
  return out;
}

export function amountInWords(amount) {
  const total = Math.round(Math.abs(Number(amount) || 0) * 100);
  let uah = Math.floor(total / 100);
  const kop = total % 100;
  const parts = [];
  if (uah === 0) parts.push('нуль', 'гривень');
  else {
    const groups = [];
    while (uah > 0) { groups.push(uah % 1000); uah = Math.floor(uah / 1000); }
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      const unit = UNITS[i];
      if (g === 0 && i !== 0) continue;
      parts.push(...triad(g, unit.fem));
      parts.push(plural(g, unit.forms));
    }
  }
  const kopStr = String(kop).padStart(2, '0');
  const text = `${parts.join(' ')} ${kopStr} ${plural(kop, ['копійка', 'копійки', 'копійок'])}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
