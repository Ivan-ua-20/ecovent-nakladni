// Повідомлення покупців Розетки → Telegram: лише менеджерам з увімкненим сповіщенням «Маркетплейси» і доступом до магазину,
// лише в робочий час (Пн–Пт 9–18, Сб 10–17, неділя — ні), одне повідомлення — одне сповіщення, власнику — ні,
// без підписаних менеджерів — Розетку не питаємо.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
await migrate(db);
const tg = [];
let rz = [];
// Чати магазину: два по замовленнях, одне питання про товар; повідомлення продавця (sender 2) не сповіщаються.
let CHATS = {
  orders: [
    { id: 501, order_id: 910492503, updated: '2026-11-09 10:05:00', unread_messages_count: 1, user_fio: 'Ганжа Ігор', messages: [
      { id: 1, sender: 3, body: 'Як зробити заміну?', created: '2026-11-09 09:00:00' }, { id: 2, sender: 2, body: 'Напишіть номер', created: '2026-11-09 09:30:00' },
      { id: 3, sender: 3, body: '+380972366059 Ігор', created: '2026-11-09 10:05:00' }] },
    { id: 502, order_id: 910430501, updated: '2026-10-01 10:00:00', unread_messages_count: 1, user_fio: 'Давній', messages: [{ id: 9, sender: 3, body: 'старе', created: '2026-10-01 10:00:00' }] },
  ],
  items: [
    { id: 601, item_id: 586009156, item: { id: 586009156, name: 'Вентилятор DECORA Ø100' }, updated: '2026-11-09 09:40:00', unread_messages_count: 2, user_fio: 'Поліщук Сергій', messages: [
      { id: 21, sender: 3, body: 'Є таймер?', created: '2026-11-09 09:34:00' }, { id: 22, sender: 3, body: 'Шукаю без <таймера>', created: '2026-11-09 09:40:00' }] },
  ],
};
const fetchFn = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.host === 'api.telegram.org') { tg.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })); }
  if (u.host === 'api-seller.rozetka.com.ua') {
    rz.push(u.pathname + u.search);
    const ok = (content) => new Response(JSON.stringify({ success: true, content }));
    if (u.pathname === '/sites') return ok({ access_token: 'tok', market: { id: 1, title: 'OneDay' } });
    if (u.pathname === '/messages/counts') return ok({ ordersChatUnread: CHATS.orders.length, itemsChatUnread: CHATS.items.length });
    if (u.pathname === '/messages/search') {
      assert.equal(u.searchParams.get('read'), '0');
      return ok({ chats: CHATS[u.searchParams.get('msgType')] || [], _meta: { pageCount: 1 } });
    }
  }
  return new Response('{"ok":true,"result":{}}');
};
// Робочий час — через годинник для тестів (shared.clock); Київ: UTC+2 у листопаді.
let now = Date.parse('2026-11-09T08:10:00Z'); // понеділок, 10:10 за Києвом
const shared = { clock: () => now };
const call = async (m, path, body, cookie) => {
  const r = await createApp({ db, fetchFn, shared }).request(path, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => ({})), r };
};
const H = (await call('POST', '/api/auth/setup', { login: 'o', password: 'secret123' })).r.headers.get('set-cookie').split(';')[0];
const { key } = (await call('POST', '/api/jobs/key', null, H)).j;
const run = async () => (await (await createApp({ db, fetchFn, shared }).request('/api/cron/run/market-msgs', { method: 'POST', headers: { 'X-Cron-Key': key } })).json()).result;

await db.batch([
  [`INSERT INTO settings (key, value) VALUES ('tg_token', '1:x')`, []],
  [`INSERT INTO rz_accounts (id, name, username, password) VALUES (1, 'OneDay', 'u', 'p'), (2, 'Ековент', 'u2', 'p')`, []],
  [`UPDATE users SET tg_chat_id = '100' WHERE login = 'o'`, []], // власник — не отримує
]);
// Менеджери: m1 — OneDay зі сповіщенням; m2 — Ековент зі сповіщенням; m3 — OneDay без сповіщення.
for (const [login, shops, tgs, chat] of [['m1', ['rozetka:1'], ['market'], '201'], ['m2', ['rozetka:2'], ['market'], '202'], ['m3', ['rozetka:1'], [], '203']]) {
  await call('POST', '/api/users', { login, password: 'pass1234', role: 'manager', access: { b2b: 'none', retail: 'none', market: 'work', returns: 'none', shops, tg: tgs } }, H);
  await db.run(`UPDATE users SET tg_chat_id = ? WHERE login = ?`, [chat, login]);
}
await db.run(`UPDATE rz_accounts SET active = 0 WHERE id = 2`); // Ековент вимкнено — m2 нічого
assert.deepEqual((await call('GET', '/api/users', null, H)).j.users.find((u) => u.login === 'm1').access.tg, ['market'], 'сповіщення «Маркетплейси» зберігається');

// Неробочий час: неділя, ніч, субота після 17:00 — без запитів і сповіщень.
for (const t of ['2026-11-08T10:00:00Z', '2026-11-09T05:30:00Z', '2026-11-09T16:00:00Z', '2026-11-07T15:30:00Z']) {
  now = Date.parse(t);
  assert.match((await run()).skipped, /неробочий/, t);
}
assert.equal(rz.length + tg.length, 0);

// Субота 10:30 — робочий час: два нових чати → два сповіщення лише m1; давній (понад 7 днів) — ні.
now = Date.parse('2026-11-07T08:30:00Z');
let r = await run();
assert.deepEqual([r.shops, r.chats, r.sent], [1, 2, 2], JSON.stringify(r));
assert.deepEqual([...new Set(tg.map((m) => String(m.chat_id)))], ['201'], 'лише менеджеру магазину зі сповіщенням');
const o = tg.find((m) => /Замовлення №910492503/.test(m.text));
assert.ok(o && /Від: Ганжа Ігор/.test(o.text) && /чат 501/.test(o.text) && /\+380972366059 Ігор/.test(o.text) && !/Напишіть номер/.test(o.text), o?.text);
assert.match(o.text, /href="https:\/\/seller\.rozetka\.com\.ua\/main\/messages\/orders\?msgType=orders&amp;search=910492503"|search=910492503/);
const it = tg.find((m) => /Питання про товар/.test(m.text));
assert.match(it.text, /items\?msgType=items&(amp;)?search=586009156/);
assert.ok(/Є таймер\?/.test(it.text) && /Шукаю без &lt;таймера&gt;/.test(it.text), 'обидва непрочитані, HTML екрановано');
assert.ok(!tg.some((m) => /старе/.test(m.text)), 'давніший за 7 днів — ні');
assert.ok(!rz.some((p) => /delete|mark|read=1/.test(p)), 'нічого не позначаємо прочитаним');

// Повторно — те саме не надсилається; нове повідомлення в тому ж чаті — так.
tg.length = 0;
assert.equal((await run()).sent, 0);
CHATS.orders[0].messages.push({ id: 4, sender: 3, body: 'Чекаю відповіді', created: '2026-11-09 10:20:00' });
CHATS.orders[0].unread_messages_count = 2;
r = await run();
assert.equal(r.sent, 1);
assert.ok(/Чекаю відповіді/.test(tg[0].text) && !/\+380972366059/.test(tg[0].text), 'лише нове');

// Усе прочитали — без зайвих запитів списку; багато нових одразу — одним підсумком.
tg.length = 0; rz = [];
const keep = CHATS;
CHATS = { orders: [], items: [] };
assert.equal((await run()).sent, 0);
assert.ok(rz.every((p) => p.startsWith('/messages/counts') || p === '/sites'), 'лише лічильник');
CHATS = { orders: [1, 2, 3, 4, 5].map((i) => ({ id: 700 + i, order_id: 9000 + i, updated: '2026-11-07 10:00:00', unread_messages_count: 1, user_fio: `Покупець ${i}`, messages: [{ id: 100 + i, sender: 3, body: `текст ${i}`, created: '2026-11-07 10:00:00' }] })), items: [] };
r = await run();
assert.equal(r.sent, 1);
assert.match(tg[0].text, /нові повідомлення: 5/);

// Нікого не підписано — Розетку не питаємо.
CHATS = keep;
await db.run(`UPDATE users SET access = json_set(access, '$.tg', json('[]')) WHERE login = 'm1'`);
tg.length = 0; rz = [];
await run();
assert.equal(rz.length + tg.length, 0);
console.log('OK — повідомлення Розетки в Telegram');
