// Excel без бібліотек: назви аркушів, ZIP (контрольні суми), числа й текст у комірках.
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { xlsxBytes, sheetNames } from '../public/core/xlsx.js';

assert.deepEqual(sheetNames(['Очищувачі: [нові]/*?', 'Очищувачі: [нові]/*?', '', 'Дуже довга назва категорії товарів понад тридцять один символ']),
  ['Очищувачі нові', 'Очищувачі нові 2', 'Аркуш', 'Дуже довга назва категорії това']);

const cols = [{ title: 'Товар' }, { title: 'РРЦ', fmt: 'money' }, { title: 'Маржа', fmt: 'pct' }];
const b = xlsxBytes([{ name: 'Осушувачі', cols, rows: [['A & <B> "C"', 8900, 20]] }, { name: 'Порожня', cols, rows: [] }]);
const dv = new DataView(b.buffer);
assert.equal(dv.getUint32(0, true), 0x04034b50, 'ZIP');
// центральний каталог: усі файли, контрольні суми збігаються
const endAt = b.length - 22;
assert.equal(dv.getUint32(endAt, true), 0x06054b50);
const n = dv.getUint16(endAt + 10, true);
let p = dv.getUint32(endAt + 16, true);
const names = [];
const dec = new TextDecoder();
for (let i = 0; i < n; i++) {
  const nameLen = dv.getUint16(p + 28, true);
  const size = dv.getUint32(p + 24, true);
  const crc = dv.getUint32(p + 16, true);
  const off = dv.getUint32(p + 42, true);
  const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
  const dataAt = off + 30 + dv.getUint16(off + 26, true);
  const data = b.subarray(dataAt, dataAt + size);
  assert.equal(crc32(data) >>> 0, crc, `CRC ${name}`);
  names.push([name, dec.decode(data)]);
  p += 46 + nameLen;
}
const files = Object.fromEntries(names);
assert.ok(files['xl/workbook.xml'].includes('name="Осушувачі"') && files['xl/workbook.xml'].includes('name="Порожня"'));
const s1 = files['xl/worksheets/sheet1.xml'];
assert.match(s1, /<t xml:space="preserve">A &amp; &lt;B&gt; &quot;C&quot;<\/t>/, 'текст екрановано');
assert.match(s1, /<c r="B2" s="2"><v>8900<\/v><\/c>/, 'РРЦ — число з форматом грошей');
assert.match(s1, /<c r="C2" s="3"><v>20<\/v><\/c>/, 'маржа — число з %');
assert.match(s1, /state="frozen"/, 'заголовок закріплено');
console.log('OK — Excel: аркуші, ZIP, комірки');
