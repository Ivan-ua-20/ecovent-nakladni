// Маркетплейси → Розетка: групи замовлень (Нові, В обробці, Доставляється, Успішні, Неуспішні, Скасовані),
// «Потрібно зателефонувати», хто скасував (покупець / менеджер / автоматично); JS і SQL групують однаково.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { rzGroupOf, rzCancelBy } from '../src/modules/market/index.js';

const db = openDb(':memory:');
await migrate(db);
const now = new Date().toISOString();
await db.run(`INSERT INTO rz_accounts (id, name, username, password, token, token_at, active, created_at) VALUES (1, 'Ековент', 'u', 'p', 'rztok', ?, 1, ?)`, [now, now]);
await db.run(`INSERT INTO settings (key, value) VALUES ('mp_rz_success', ?)`, [JSON.stringify({ at: Date.now(), ids: ['6', '87'] })]);
const kyiv = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
const ago = (min) => kyiv(Date.now() - min * 60e3);

// [id, status, status_group, created (хв тому), changed (хв тому)]
const ROWS = [
  ['1', '1', 1, 10, 10], // нове 10 хв — ще не дзвонити
  ['2', '1', 1, 45, 45], // нове 45 хв — дзвонити
  ['3', '26', 1, 100, 50], // обробляється менеджером
  ['4', '47', 1, 200, 60], // повторний дзвінок — дзвонити
  ['5', '55', 1, 3000, 2000], // очікує оплату понад добу — дзвонити
  ['6', '55', 1, 300, 300], // очікує оплату 5 год — ні
  ['7', '5', 1, 9000, 6000], // у пункті 4+ дні — дзвонити
  ['8', '4', 1, 3000, 1000], // доставляється
  ['9', '82', 1, 3000, 1000], // у РЦ — доставляється
  ['10', '6', 2, 9000, 5000], // виконано
  ['11', '6', 0, 9000, 5000], // виконано, старий рядок без групи
  ['12', '12', 3, 9000, 5000], // відмова при отриманні — неуспішні
  ['13', '45', 3, 900, 800], // скасовано покупцем
  ['14', '40', 3, 900, 800], // клієнт передумав — менеджер
  ['15', '42', 3, 900, 800], // немає в наявності — менеджер
  ['16', '50', 3, 900, 800], // не оплатив — автоматично
  ['17', '49', 3, 900, 800], // повторне замовлення (дубль) — автоматично, НЕ нове
  ['18', '18', 0, 900, 800], // не вдалося зв'язатися, старий рядок — скасовані
  ['19', '61', 1, 900, 800], // заплановано передачу перевізнику — в обробці
];
for (const [id, st, g, c, ch] of ROWS) {
  await db.run(`INSERT INTO mp_orders (mp, account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, status_group)
    VALUES ('rozetka', 1, ?, ?, ?, ?, ?, ?, 'Клієнт', '380671112233', 100, '[]', ?)`, [id, id, ago(c), ago(ch), st, `Статус ${st}`, g]);
}
const mk = () => createApp({ db, fetchFn: async (u) => { throw new Error(`неочікуваний запит ${u}`); } });
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const get = async (qs) => { const r = await mk().request(`/api/mp/orders?mp=rozetka&${qs}`, { headers: H }); assert.equal(r.status, 200); return r.json(); };
const ids = (d) => d.rows.map((r) => Number(r.id)).sort((a, b) => a - b);

// ---------- лічильники груп ----------
const all = await get('');
assert.deepEqual(all.groups, { new: 2, work: 5, call: 4, delivery: 3, success: 2, failed: 1, cancelled: 6 });
assert.deepEqual(all.cancels, { client: 1, manager: 3, auto: 2 });
assert.equal(all.statuses.find((x) => x.status === '6').n, 2, 'один статус з різними status_group — один рядок фільтра');
assert.equal(all.statuses.find((x) => x.status === '49').grp, 'cancelled');

// ---------- фільтр за групою ----------
assert.deepEqual(ids(await get('grp=new')), [1, 2]);
assert.deepEqual(ids(await get('grp=work')), [3, 4, 5, 6, 19]);
assert.deepEqual(ids(await get('grp=delivery')), [7, 8, 9]);
assert.deepEqual(ids(await get('grp=success')), [10, 11]);
assert.deepEqual(ids(await get('grp=failed')), [12]);
assert.deepEqual(ids(await get('grp=cancelled')), [13, 14, 15, 16, 17, 18]);
assert.deepEqual(ids(await get('grp=call')), [2, 4, 5, 7]);
assert.deepEqual(ids(await get('grp=cancelled&cancel=client')), [13]);
assert.deepEqual(ids(await get('grp=cancelled&cancel=manager')), [14, 15, 18]);
assert.deepEqual(ids(await get('grp=cancelled&cancel=auto')), [16, 17]);
assert.deepEqual(ids(await get('grp=work&status=55')), [5, 6], 'підстатус у групі');
assert.deepEqual(ids(await get('grp=bogus')), ROWS.map((r) => Number(r[0])), 'невідома група — без фільтра');
// групи не залежать від обраної групи (лічильники бічної панелі однакові)
assert.deepEqual((await get('grp=new')).groups, all.groups);

// ---------- JS і SQL групують однаково ----------
const ok = new Set(['6', '87']);
for (const [id, st, g] of ROWS) {
  const grp = rzGroupOf(st, g, ok);
  assert.ok(ids(await get(`grp=${grp}`)).includes(Number(id)), `замовлення ${id} (статус ${st}) — у групі ${grp}`);
}
assert.equal(rzCancelBy('45'), 'client');
assert.equal(rzCancelBy('50'), 'auto');
assert.equal(rzCancelBy('31'), 'manager');

// ---------- Prom: без груп ----------
const r = await mk().request('/api/mp/orders?mp=prom', { headers: H });
const p = await r.json();
assert.ok(!('groups' in p));

// ---------- дзвінки для картки: без Binotel — порожньо ----------
const t = await (await mk().request('/api/tel/calls?phones=380671112233', { headers: H })).json();
assert.deepEqual(t, { configured: false, calls: [] });

console.log('OK — маркетплейси: групи Розетки, «Потрібно зателефонувати», хто скасував');
