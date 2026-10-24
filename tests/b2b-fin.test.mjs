// Група «Фінансові питання»: запит рахунку на нову закупівлю → рахунок відповіддю (повний збіг — одразу в закупівлю
// й у групу партнера) → після оплати запит накладної відповіддю на рахунок → накладна. Розбіжності — кнопки лише для
// адмінів; PDF без відповіді — впізнавання за вмістом (лише точний збіг), чужі документи — тиша.
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { miniPdf, basDoc } from './helpers/mini-pdf.mjs';

const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  ...[['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_secret', 'sec'], ['tg_hook_v', '2']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]),
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901)`, []],
]);
const files = new Map();
const calls = [];
let msgId = 5000;
const FIN = -700;
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/file/')) return new Response(files.get(decodeURIComponent(url.split('/').pop())));
  if (url.startsWith('https://api.telegram.org/')) {
    const method = url.split('/').pop();
    const body = opts.body instanceof FormData ? Object.fromEntries(opts.body) : JSON.parse(opts.body || '{}');
    calls.push([method, body]);
    if (method === 'getFile') return new Response(JSON.stringify({ ok: true, result: { file_path: encodeURIComponent(body.file_id) } }));
    if (method === 'getChatMember') return new Response(JSON.stringify({ ok: true, result: { status: body.user_id === 900 ? 'administrator' : 'member' } }));
    return new Response(JSON.stringify({ ok: true, result: { message_id: ++msgId } }));
  }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: { 11: 'Осушувач Evoair Dryora 12', 12: 'Очищувач Levoit Core 600S' }[id], price: { 11: '1000.00', 12: '2000.00' }[id] })) }));
};
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const hook = (upd) => mk().request('/api/tg/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'sec' }, body: JSON.stringify(upd) });
let docMsg = 100;
const postPdf = async (bytes, { id, replyTo = null, replyText = '' } = {}) => {
  files.set(id, bytes);
  const message_id = ++docMsg;
  await hook({ message: { message_id, chat: { id: FIN, type: 'supergroup', is_forum: true }, from: { id: 55, first_name: 'Інна' },
    document: { file_id: id, file_unique_id: `u${id}`, file_name: `${id}.pdf`, mime_type: 'application/pdf', file_size: bytes.length },
    ...(replyTo ? { reply_to_message: { message_id: replyTo, from: { is_bot: true, username: 'ecobot' }, text: replyText } } : {}) } });
  return message_id;
};
const press = (data, from) => hook({ callback_query: { id: 'cq', from: { id: from }, data, message: { message_id: 1, chat: { id: FIN } } } });
const sent = (pred) => calls.filter(([m, b]) => m === 'sendMessage' && pred(b)).map(([, b]) => b);
const buttons = (b) => (b?.reply_markup?.inline_keyboard || []).flat();

const pa = await req('POST', '/api/b2b/partners', { name: 'Тест Партнер' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
await db.run(`UPDATE b2b_partners SET tg_group = '-500' WHERE id = ?`, [pa.id]);
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Рубан Ольга Олександрівна', code: '1234567890' }, A);
const BUYER = 'Рубан Ольга Олександрівна ФОП';
const ITEMS = [{ name: 'Осушувач повітря Evoair Dryora 12, 12 л/24 год,|білий', qty: 2, price: 900 }, { name: 'Очищувач Levoit Core 600S', qty: 1, price: 1800 }];

// ---------- 1. Прив'язка групи ----------
const { code } = await req('POST', '/api/b2b/fin-group');
await hook({ message: { message_id: 1, chat: { id: FIN, type: 'supergroup', title: 'Фінансові питання' }, text: `/link ${code}` } });
assert.match(sent((b) => b.chat_id === FIN).at(-1).text, /Фінансові питання/);
assert.equal((await req('GET', '/api/b2b/fin-group')).title, 'Фінансові питання');

// ---------- 2. Нова закупівля → запит рахунку (у General — без гілки) ----------
calls.length = 0;
const s1 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 1 }] }, A);
const reqMsg = sent((b) => b.chat_id === String(FIN) || b.chat_id === FIN).find((b) => /Потрібен рахунок/.test(b.text));
assert.ok(reqMsg, 'запит рахунку в групі');
assert.equal(reqMsg.message_thread_id, undefined, 'у гілку General');
assert.match(reqMsg.text, new RegExp(`Потрібен рахунок · B2B-${s1.id}.*ФОП Рубан Ольга Олександрівна, ІПН 1234567890.*Осушувач Evoair Dryora 12 — 2 шт — 900,00.*Разом: 3[\\s ]600,00 грн`, 's'));
const reqId = (await db.get(`SELECT fin_req_msg FROM b2b_orders WHERE id = ?`, [s1.id])).fin_req_msg;
assert.ok(reqId);

// ---------- 3. Рахунок відповіддю, усе збіглося → одразу збережено ----------
calls.length = 0;
const invMsg = await postPdf(miniPdf(basDoc({ number: '110', buyer: BUYER, items: ITEMS })), { id: 'inv1', replyTo: reqId, replyText: reqMsg.text });
let o = (await req('GET', `/api/b2b/orders/${s1.id}`)).order;
assert.deepEqual([o.invoice_no, o.status], ['110', 'pay_wait']);
assert.equal((await db.get(`SELECT fin_inv_msg FROM b2b_orders WHERE id = ?`, [s1.id])).fin_inv_msg, invMsg);
assert.ok(calls.some(([m, b]) => m === 'sendDocument' && b.chat_id === '-500' && b.document === 'inv1'), 'рахунок — у групу партнера');
assert.ok(!sent((b) => String(b.chat_id) === String(FIN) && /Збережено/.test(b.text)).length, 'у групі — без «Збережено»');
assert.ok(calls.some(([m, b]) => m === 'setMessageReaction' && b.message_id === invMsg && b.reaction[0].emoji === '👌'), 'реакція на рахунок');
assert.ok(!calls.some(([m, b]) => m === 'deleteMessage' && b.message_id === reqId), 'замовлення (запит рахунку) лишається');
assert.ok(calls.some(([m, b]) => m === 'editMessageText' && b.message_id === reqId && /✅ рахунок № 110 додано.*Осушувач Evoair Dryora 12 — 2 шт/s.test(b.text) && !/Надішліть рахунок/.test(b.text)), 'з позначкою, товари на місці');
assert.match((await req('GET', `/api/b2b/orders/${s1.id}`)).history.map((x) => x.action).join('\n'), /Фінансові питання/);

// ---------- 4. Оплачено → запит накладної відповіддю на рахунок → накладна ----------
calls.length = 0;
await req('POST', `/api/b2b/orders/${s1.id}/status`, { status: 'paid' });
const payMsg = sent((b) => /оплачено/.test(b.text) && /видаткова накладна/.test(b.text))[0];
assert.ok(payMsg && payMsg.reply_to_message_id === invMsg, 'запит накладної — відповіддю на рахунок');
const payId = (await db.get(`SELECT fin_pay_msg FROM b2b_orders WHERE id = ?`, [s1.id])).fin_pay_msg;
calls.length = 0;
await postPdf(miniPdf(basDoc({ kind: 'waybill', number: '2459', buyer: BUYER, items: ITEMS })), { id: 'wb1', replyTo: payId, replyText: payMsg.text });
o = (await req('GET', `/api/b2b/orders/${s1.id}`)).order;
assert.equal(o.waybill_no, '2459');
assert.ok(calls.some(([m, b]) => m === 'sendDocument' && b.chat_id === '-500' && b.document === 'wb1'), 'накладна — у групу партнера');
assert.ok(calls.some(([m, b]) => m === 'deleteMessage' && b.message_id === payId), 'запит накладної прибрано');
assert.ok(!sent((b) => /Збережено/.test(b.text)).length);
const fin1 = sent((b) => String(b.chat_id) === String(FIN) && /закрито/.test(b.text));
assert.equal(fin1.length, 1, 'одне підсумкове повідомлення');
assert.match(fin1[0].text, new RegExp(`Закупівлю B2B-${s1.id} закрито.*Рахунок № 110 · накладна № 2459`, 's'));
await req('PUT', `/api/b2b/orders/${s1.id}`, { waybill_no: '2460' });
assert.equal(sent((b) => /закрито/.test(b.text)).length, 1, 'повторно — ні');

// ---------- 5. Розбіжність → кнопки лише для адмінів ----------
const s2 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 1 }] }, A); // 900
const req2 = (await db.get(`SELECT fin_req_msg FROM b2b_orders WHERE id = ?`, [s2.id])).fin_req_msg;
calls.length = 0;
await postPdf(miniPdf(basDoc({ number: '120', buyer: BUYER, items: [{ name: 'Осушувач Evoair Dryora 12', qty: 3, price: 900 }] })), { id: 'inv2', replyTo: req2, replyText: `🧾 Потрібен рахунок · B2B-${s2.id}` });
assert.equal((await req('GET', `/api/b2b/orders/${s2.id}`)).order.invoice_no, '', 'розбіжність — не зберігаємо самі');
const warn = sent((b) => /у документі <b>3 шт × 900,00<\/b>/.test(b.text))[0];
assert.ok(warn);
const force = buttons(warn).find((x) => /Прикріпити все одно/.test(x.text)).callback_data;
calls.length = 0;
await press(force, 77); // звичайний учасник
assert.equal(calls.find(([m]) => m === 'answerCallbackQuery')[1].text, 'Лише для адміністраторів.');
assert.equal((await req('GET', `/api/b2b/orders/${s2.id}`)).order.invoice_no, '');
await press(force, 900); // адмін групи
assert.equal((await req('GET', `/api/b2b/orders/${s2.id}`)).order.invoice_no, '120');
assert.match((await req('GET', `/api/b2b/orders/${s2.id}`)).history.map((x) => `${x.user_name}: ${x.action}`).join('\n'), /Telegram\).*розбіжностями/s);

// ---------- 6. Без відповіді: точний збіг → [Прикріпити]; чужий документ — тиша ----------
const s3 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 12, qty: 2 }] }, A); // 3600
calls.length = 0;
await postPdf(miniPdf(basDoc({ number: '130', buyer: BUYER, items: [{ name: 'Очищувач Levoit Core 600S', qty: 2, price: 1800 }] })), { id: 'inv3' });
const sug = sent(() => true).find((b) => buttons(b).some((x) => x.text === `✅ Прикріпити до B2B-${s3.id}`));
assert.ok(sug, 'пропонує прикріпити');
assert.equal((await req('GET', `/api/b2b/orders/${s3.id}`)).order.invoice_no, '', 'без відповіді — лише після підтвердження');
await press(buttons(sug).find((x) => /Прикріпити до/.test(x.text)).callback_data, 900);
assert.equal((await req('GET', `/api/b2b/orders/${s3.id}`)).order.invoice_no, '130');
calls.length = 0;
await postPdf(miniPdf(basDoc({ number: '999', buyer: 'ТОВ «Інший клієнт»', items: [{ name: 'Щось', qty: 1, price: 50 }] })), { id: 'alien' });
await postPdf(miniPdf(basDoc({ number: '998', buyer: BUYER, items: [{ name: 'Осушувач Evoair Dryora 12', qty: 7, price: 900 }] })), { id: 'near' });
assert.equal(sent(() => true).length, 0, 'чужі й неточні документи без відповіді — тиша');
calls.length = 0;
await hook({ message: { message_id: 400, chat: { id: FIN, type: 'supergroup' }, from: { id: 55 }, text: 'Доброго дня, колеги' } });
await hook({ message: { message_id: 401, chat: { id: FIN, type: 'supergroup' }, from: { id: 55 }, photo: [{ file_id: 'ph', file_unique_id: 'ph', file_size: 10 }] } });
assert.equal(calls.length, 0, 'текст і фото — без жодних запитів до Telegram');

// ---------- 7. Скасування закупівлі — запит позначено ----------
const s4 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 1 }] }, A);
const req4 = (await db.get(`SELECT fin_req_msg FROM b2b_orders WHERE id = ?`, [s4.id])).fin_req_msg;
calls.length = 0;
await req('POST', `/api/b2b/p/orders/${s4.id}/cancel`, {}, A);
assert.ok(calls.some(([m, b]) => m === 'editMessageText' && b.message_id === req4 && /скасовано партнером/.test(b.text)));

console.log('OK — «Фінансові питання»: запит рахунку → рахунок → оплата → запит накладної → накладна; кнопки лише для адмінів');
