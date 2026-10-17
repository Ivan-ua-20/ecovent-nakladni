// Міграції модулів: повторний запуск і перехід зі старої бази (без ключів schema:*) не змінюють даних,
// а підвищення версії одного модуля запускає міграцію лише цього модуля.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate, MODULE_SCHEMAS } from '../src/migrate.js';

const counted = (raw) => {
  let n = 0;
  const db = { all: (...a) => { n++; return raw.all(...a); }, get: (...a) => { n++; return raw.get(...a); }, run: (...a) => { n++; return raw.run(...a); }, batch: (l) => { if (l.length) n++; return raw.batch(l); } };
  return { db, count: () => n };
};
async function dump(db) {
  const out = {};
  for (const t of await db.all(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)) {
    out[t.name] = {
      cols: (await db.all(`PRAGMA table_info(${t.name})`)).map((c) => `${c.name}:${c.type}:${c.dflt_value}`).sort(),
      rows: (await db.all(`SELECT * FROM ${t.name}`)).map((r) => JSON.stringify(r)).filter((r) => !r.includes('"key":"schema:')).sort(),
    };
  }
  return out;
}

const raw = openDb(':memory:');
const first = counted(raw);
await migrate(first.db);
assert.ok(first.count() <= 45, `нова база: ${first.count()} запитів — забагато для D1`);
const base = await dump(raw);
assert.ok(base.fops.rows.length >= 6 && base.templates.rows.length === 3, 'нова база засіяна');

// повторний запуск — один запит, нічого не змінюється
const again = counted(raw);
await migrate(again.db);
assert.equal(again.count(), 1, 'повторна міграція — лише перевірка версій');
assert.deepEqual(await dump(raw), base);

// стара база (до розділення схеми: ключів schema:* ще немає) з робочими даними
await raw.run(`UPDATE fops SET iban = 'UA00TEST' WHERE id = 1`);
await raw.run(`DELETE FROM settings WHERE key LIKE 'schema:%'`);
const legacy = await dump(raw);
await migrate(raw);
assert.deepEqual(await dump(raw), legacy, 'перехід на модульні міграції не змінює даних');
assert.equal((await raw.all(`SELECT key FROM settings WHERE key LIKE 'schema:%'`)).length, MODULE_SCHEMAS.length);

// нова версія одного модуля → мігрує лише він
let ran = [];
const bumped = MODULE_SCHEMAS.map((m) => ({ ...m, seed: async (db, o) => { ran.push(m.name); return m.seed?.(db, o); }, version: m.name === 'payments' ? m.version + 1 : m.version }));
await migrate(raw, bumped);
assert.deepEqual(ran, ['payments'], 'мігрує лише модуль зі зміненою версією');
assert.deepEqual(await dump(raw), legacy);

console.log(`OK — міграції модулів: нова база ${first.count()} запитів, повторно 1, дані не змінюються`);
