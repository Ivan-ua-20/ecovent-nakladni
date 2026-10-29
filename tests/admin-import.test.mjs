// Імпорт налаштувань: не стирає збережені ключі Checkbox і пише зміни реквізитів (IBAN…) у журнал докладно.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const app = createApp({ db, fetchFn: async () => new Response('{}') });
const setup = await app.request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body) => {
  const r = await app.request(path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw new Error(j.error || r.status);
  return j;
};

const IBAN = 'UA213223130000026007233566001';
const f = await req('POST', '/api/fops', { short_name: 'ФОП Тест', full_name: 'Тест Т. Т.', ipn: '1234567890', iban: IBAN });
await db.run(`UPDATE fops SET checkbox_login = 'cb', checkbox_password = 'cbpass', checkbox_license = 'lic' WHERE id = ?`, [f.id]);

const file = await req('GET', '/api/admin/export');
const row = file.tables.fops.find((r) => r.id === f.id);
assert.equal(row.checkbox_password, undefined, 'секретів у файлі немає');

// той самий файл, але інший IBAN
const IBAN2 = 'UA903052992990004149123456789';
row.iban = IBAN2;
await req('POST', '/api/admin/import', file);

const after = await db.get(`SELECT * FROM fops WHERE id = ?`, [f.id]);
assert.equal(after.iban, IBAN2);
assert.deepEqual([after.checkbox_login, after.checkbox_password, after.checkbox_license], ['cb', 'cbpass', 'lic'], 'ключі Checkbox збережено');

const log = await req('GET', `/api/audit?kind=fop&ref=${f.id}`);
const entry = log.find((x) => /імпорт/.test(x.action));
assert.ok(entry, 'зміна реквізитів у журналі');
assert.deepEqual(entry.changes, [{ field: 'iban', from: IBAN, to: IBAN2 }]);

// без змін — у журналі ФОП нічого нового
await req('POST', '/api/admin/import', file);
assert.equal((await req('GET', `/api/audit?kind=fop&ref=${f.id}`)).filter((x) => /імпорт/.test(x.action)).length, 1);

console.log('OK — імпорт налаштувань: ключі Checkbox і журнал реквізитів');
