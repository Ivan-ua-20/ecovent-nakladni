// Чистка за строком зберігання — раз на годину на всі екземпляри (на Cloudflare їх багато), а не на кожен новий.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const setup = await createApp({ db }).request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { Cookie: setup.headers.get('set-cookie').split(';')[0] };

// рахує DELETE-запити чистки
let deletes = 0;
const counted = { ...db, run: (sql, p) => { if (/^\s*DELETE FROM (sessions|error_log|invoices|versions) WHERE/.test(sql)) deletes++; return db.run(sql, p); },
  batch: (st) => { deletes += st.filter(([sql]) => /^\s*DELETE FROM (orders_index|b2b_file_parts)/.test(sql)).length; return db.batch(st); } };

await db.run(`DELETE FROM settings WHERE key = 'cleanup_at'`);
await createApp({ db: counted, shared: {} }).request('/api/bootstrap', { headers: H });
const first = deletes;
assert.ok(first > 0, 'перший запит — чистка');
// новий «екземпляр» (окремий shared) у ту ж годину — без чистки
await createApp({ db: counted, shared: {} }).request('/api/bootstrap', { headers: H });
await createApp({ db: counted, shared: {} }).request('/api/bootstrap', { headers: H });
assert.equal(deletes, first, 'інші екземпляри не чистять повторно');
// минула година — знову
await db.run(`UPDATE settings SET value = '2020-01-01T00:00:00Z' WHERE key = 'cleanup_at'`);
await createApp({ db: counted, shared: {} }).request('/api/bootstrap', { headers: H });
assert.ok(deletes > first);
console.log(`OK — чистка раз на годину на всі екземпляри (${first} запитів за раз)`);
