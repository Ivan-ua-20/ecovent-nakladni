// Перевірки безпеки: картинки ФОП (XSS) і атомарний лічильник номерів рахунків.
import assert from 'node:assert/strict';
import { openDb } from '../src/db-node.js';
import { migrate } from '../src/schema.js';
import { isSafeImage, checkImages, dropUnsafeImages } from '../src/validate.js';
import { takeRahunokNumber, peekRahunokNumber } from '../src/counters.js';

// ---------- картинки ----------
const png = 'data:image/png;base64,iVBORw0KGgo=';
assert.ok(isSafeImage(''));
assert.ok(isSafeImage(png));
assert.ok(isSafeImage('data:image/jpeg;base64,/9j/4AAQ'));
for (const bad of [
  'x" onerror="alert(1)',
  'data:image/png;base64,AAA" onerror="alert(1)',
  'data:image/svg+xml;base64,PHN2Zz4=', // SVG може містити скрипт
  'javascript:alert(1)',
  'https://example.com/a.png',
  `data:image/png;base64,${'A'.repeat(3_000_001)}`,
]) assert.equal(isSafeImage(bad), false, bad.slice(0, 40));

const fail = (status, message) => Object.assign(new Error(message), { status });
assert.doesNotThrow(() => checkImages({ logo: png, signature: '', name: 'x' }, fail));
assert.throws(() => checkImages({ stamp: 'x" onerror="1' }, fail), (e) => e.status === 400);
assert.deepEqual(dropUnsafeImages({ id: 1, logo: 'x"y', stamp: png }), { id: 1, logo: '', stamp: png });

// ---------- лічильник номерів ----------
const db = openDb(':memory:');
await migrate(db);
const nums = await Promise.all(Array.from({ length: 20 }, () => takeRahunokNumber(db)));
assert.equal(new Set(nums).size, 20, 'номери рахунків не повинні повторюватися');
assert.equal(Math.min(...nums.map(Number)), 10516);
const s = Object.fromEntries((await db.all(`SELECT key, value FROM settings`)).map((r) => [r.key, r.value]));
assert.equal(peekRahunokNumber(s), '10536');
await db.run(`UPDATE settings SET value = '500' WHERE key = 'rahunok_next_number'`);
assert.equal(await takeRahunokNumber(db), '500');
await db.run(`DELETE FROM settings WHERE key = 'rahunok_next_number'`);
assert.equal(await takeRahunokNumber(db), '10516');
assert.equal(await takeRahunokNumber(db), '10517');

console.log('OK — картинки перевіряються, номери рахунків не дублюються');
