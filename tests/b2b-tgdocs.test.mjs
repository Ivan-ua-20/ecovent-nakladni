// Telegram: рахунок / накладна особисто боту (розбір PDF, автопошук закупівлі, звірка товарів, підтвердження,
// «Скасувати»), маркування відповіддю в групі партнера (ТТН з маркування НП, група маркувань, № у CRM).
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db-node.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { pdfText, parseBasDoc, parseNpLabel, sameName, hintsOf } from '../src/integrations/pdftext.js';
import { miniPdf, basDoc, npLabel } from './helpers/mini-pdf.mjs';

// ---------- 1. Розбір документів ----------
const inv = parseBasDoc(await pdfText(miniPdf(basDoc({ number: '110', buyer: 'Рубан Ольга Олександрівна ФОП', items: [{ name: 'Осушувач Evoair Dryora 12, 12 л/24 год,|датчик вологості', qty: 2, price: 900 }] }))));
assert.deepEqual([inv.kind, inv.number, inv.date, inv.total, inv.buyer], ['invoice', '110', '2026-10-24', 1800, 'Рубан Ольга Олександрівна ФОП']);
assert.deepEqual(inv.items.map((i) => [i.qty, i.price, i.name]), [[2, 900, 'Осушувач Evoair Dryora 12, 12 л/24 год, датчик вологості']]);
const wb = parseBasDoc(await pdfText(miniPdf(basDoc({ kind: 'waybill', number: '2443', date: '3 листопада 2026', buyer: 'X', items: [{ name: 'A', qty: 1, price: 1 }] }))));
assert.deepEqual([wb.kind, wb.number, wb.date], ['waybill', '2443', '2026-11-03']);
const np = parseNpLabel(await pdfText(miniPdf(npLabel({ ttn: '20400556982593', phone: '050 111 22 33' }))));
assert.deepEqual([np.ttn, np.phone, np.rozetka], ['20400556982593', '380501112233', '629905423']);
assert.equal(await pdfText(new Uint8Array([1, 2, 3])), '', 'не PDF — порожньо, без помилки');
assert.ok(sameName('ФОП Рубан Ольга Олександрівна', 'Рубан Ольга Олександрівна ФОП'));
assert.ok(sameName('ТОВ «Розетка. УА»', 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ "РОЗЕТКА. УА"'));
assert.ok(!sameName('ФОП Рубан Ольга', 'ФОП Петренко Іван'));
assert.deepEqual(hintsOf('B2B-9 рахунок № 125'), { order: 9, kind: 'invoice', number: '125' });

// ---------- середовище ----------
const db = openDb(':memory:');
await migrate(db);
await db.batch([
  [`UPDATE settings SET value = 'k' WHERE key = 'lpcrm_key'`, []],
  ...[['tg_token', '1:x'], ['tg_bot', 'ecobot'], ['tg_secret', 'sec']].map(([k, v]) => [`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, v]]),
  [`INSERT INTO an_brands (id, name, keywords, sort) VALUES (901, 'Evoair', 'evoair', 98)`, []],
  [`INSERT INTO an_products (product_id, name, brand_id) VALUES (11, 'Fan', 901), (12, 'Fan 2', 901)`, []],
]);
const files = new Map(); // file_id → bytes
const calls = []; // [method, body]
let msgId = 1000;
const fetchFn = async (url, opts = {}) => {
  if (url.startsWith('https://api.telegram.org/file/')) return new Response(files.get(decodeURIComponent(url.split('/').pop())));
  if (url.startsWith('https://api.telegram.org/')) {
    const method = url.split('/').pop();
    const body = opts.body instanceof FormData ? Object.fromEntries(opts.body) : JSON.parse(opts.body || '{}');
    calls.push([method, body]);
    if (method === 'getFile') return new Response(JSON.stringify({ ok: true, result: { file_path: encodeURIComponent(body.file_id) } }));
    return new Response(JSON.stringify({ ok: true, result: { message_id: ++msgId } }));
  }
  const p = new URLSearchParams(opts.body);
  if (!p.get('product_id')) return new Response(JSON.stringify({ status: 'ok', data: [] }));
  return new Response(JSON.stringify({ status: 'ok', data: p.get('product_id').split(',').map((id) => ({ id, name: { 11: 'Осушувач Evoair Dryora 12 (DRYORA12)', 12: 'Очищувач Levoit Core 600S' }[id], price: { 11: '1000.00', 12: '2000.00' }[id] })) }));
};
const mk = () => createApp({ db, fetchFn });
const login = async (l, pw) => {
  const r = await mk().request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: l, password: pw }) });
  return { 'Content-Type': 'application/json', Cookie: r.headers.get('set-cookie').split(';')[0] };
};
const setup = await mk().request('/api/auth/setup', { method: 'POST', body: JSON.stringify({ login: 'owner', password: 'secret123', name: 'Бухгалтер' }), headers: { 'Content-Type': 'application/json' } });
const H = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0] };
const req = async (method, path, body, headers = H) => {
  const r = await mk().request(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
};
const hook = (upd) => mk().request('/api/tg/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'sec' }, body: JSON.stringify(upd) });
const last = (method) => [...calls].reverse().find(([m]) => m === method)?.[1];
const sendDoc = async (bytes, { id, name = 'doc.pdf', mime = 'application/pdf', caption, replyText, chat = 1 } = {}) => {
  files.set(id, bytes);
  await hook({ message: { message_id: 5, chat: { id: chat, type: 'private' }, from: { id: chat }, document: { file_id: id, file_unique_id: `u${id}`, file_name: name, mime_type: mime, file_size: bytes.length }, ...(caption ? { caption } : {}), ...(replyText ? { reply_to_message: { message_id: 4, from: { is_bot: true, username: 'ecobot' }, text: replyText } } : {}) } });
};
const press = (data, chat = 1) => hook({ callback_query: { id: 'cq', from: { id: chat }, data, message: { message_id: 1, chat: { id: chat } } } });
const buttons = (body) => (body?.reply_markup?.inline_keyboard || []).flat();
const btnData = (body, re) => buttons(body).find((b) => re.test(b.text))?.callback_data;

// перший запит — вебхук оновлюється (натискання кнопок)
await hook({ message: { message_id: 1, chat: { id: 77, type: 'private' }, text: 'hi' } });
const wh = calls.find(([m]) => m === 'setWebhook');
assert.ok(wh && wh[1].allowed_updates.includes('callback_query'), 'вебхук оновлено: + callback_query');
calls.length = 0;
await hook({ message: { message_id: 1, chat: { id: 77, type: 'private' }, text: 'hi' } });
assert.ok(!calls.some(([m]) => m === 'setWebhook'), 'лише один раз');

const pa = await req('POST', '/api/b2b/partners', { name: 'Тест Партнер' });
await req('POST', `/api/b2b/partners/${pa.id}/users`, { login: 'pa', password: 'pass1234' });
await req('PUT', `/api/b2b/partners/${pa.id}/margins`, [{ brand_id: 901, margin: 10 }]);
await req('POST', '/api/b2b/catalog/sync');
const A = await login('pa', 'pass1234');
const ent = await req('POST', '/api/b2b/p/entities', { name: 'ФОП Рубан Ольга Олександрівна', code: '1234567890' }, A);
const s1 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 2 }, { product_id: 12, qty: 1 }] }, A); // 1800 + 1800 = 3600
const s2 = await req('POST', '/api/b2b/p/orders', { entity_id: ent.id, items: [{ product_id: 11, qty: 1 }] }, A); // 900
await db.run(`UPDATE users SET tg_chat_id = '1' WHERE login = 'owner'`);
await db.run(`UPDATE users SET tg_chat_id = '2' WHERE login = 'pa'`);
await db.run(`UPDATE b2b_partners SET tg_group = '-500' WHERE id = ?`, [pa.id]);

// ---------- 2. Рахунок особисто боту: автопошук, звірка, «Зберегти» ----------
const invItems = [{ name: 'Осушувач повітря Evoair Dryora 12, 12 л/24 год,|білий', qty: 2, price: 900 }, { name: 'Очищувач повітря Smart Levoit Core 600S Wi-Fi', qty: 1, price: 1800 }];
calls.length = 0;
await sendDoc(miniPdf(basDoc({ number: '110', buyer: 'Рубан Ольга Олександрівна ФОП', items: invItems })), { id: 'f1', name: 'Рахунок на оплату № 110.pdf' });
let m = last('sendMessage');
assert.equal(m.chat_id, '1');
assert.match(m.text, new RegExp(`Рахунок</b> № <b>110</b> від 24\\.10\\.2026 · <b>3[\\s ]600,00 грн`));
assert.match(m.text, new RegExp(`→ <b>B2B-${s1.id}</b>`), 'закупівлю знайдено за сумою й покупцем');
assert.match(m.text, /✅ Покупець збігається/);
assert.match(m.text, /✅ Сума збігається/);
assert.match(m.text, /✅ Осушувач повітря Evoair Dryora 12.* — 2 шт × 900,00/);
assert.match(m.text, /✅ Очищувач повітря Smart Levoit Core 600S/);
const saveBtn = btnData(m, /^✅ Зберегти/);
assert.ok(saveBtn, 'кнопка «Зберегти» (без розбіжностей)');
let o1 = await req('GET', `/api/b2b/orders/${s1.id}`);
assert.equal(o1.order.invoice_no, '', 'до підтвердження нічого не збережено');
calls.length = 0;
await press(saveBtn);
o1 = await req('GET', `/api/b2b/orders/${s1.id}`);
assert.equal(o1.order.invoice_no, '110');
assert.equal(o1.order.invoice_date, '2026-10-24');
assert.equal(o1.order.status, 'pay_wait');
assert.equal(o1.files[0].kind, 'invoice');
assert.match(o1.history.map((x) => x.action).join('\n'), /через Telegram/);
const toGroup = calls.find(([mm, b]) => mm === 'sendDocument' && b.chat_id === '-500');
assert.ok(toGroup && toGroup[1].document === 'f1', 'файл — у групу партнера за file_id');
assert.ok(calls.some(([mm, b]) => mm === 'sendMessage' && b.chat_id === '2' && /Рахунок № 110/.test(b.text)), 'партнеру — сповіщення');
const edited = last('editMessageText');
assert.match(edited.text, /Збережено:.*Рахунок № 110 → <b>B2B-\d+/s);
assert.ok(buttons(edited).some((b) => b.url?.includes(`#/b2borders/${s1.id}`)));
// повторне натискання — нічого
await press(saveBtn);
assert.equal((await req('GET', `/api/b2b/orders/${s1.id}`)).files.length, 1);

// «Скасувати» (15 хв)
calls.length = 0;
await press(btnData(edited, /Скасувати/));
o1 = await req('GET', `/api/b2b/orders/${s1.id}`);
assert.deepEqual([o1.order.invoice_no, o1.order.status, o1.files.length], ['', 'invoice_wait', 0], 'усе повернуто');
assert.ok(calls.some(([mm, b]) => mm === 'deleteMessage' && b.chat_id === '-500'), 'файл прибрано з групи');

// ---------- 3. Розбіжності в товарах — «Зберегти все одно» ----------
calls.length = 0;
await sendDoc(miniPdf(basDoc({ number: '111', buyer: 'Рубан Ольга Олександрівна ФОП', items: [{ name: 'Осушувач Evoair Dryora 12', qty: 3, price: 900 }, { name: 'Зволожувач Humix560', qty: 1, price: 900 }] })), { id: 'f2', caption: `B2B-${s1.id}` });
m = last('sendMessage');
assert.match(m.text, new RegExp(`→ <b>B2B-${s1.id}</b>`), 'з підпису B2B-…');
assert.match(m.text, /⚠️ Сума: у документі <b>3[\s ]600,00<\/b>|✅ Сума збігається/);
assert.match(m.text, /⚠️ Осушувач Evoair Dryora 12 — у документі <b>3 шт × 900,00<\/b>, у замовленні <b>2 шт × 900,00<\/b>/);
assert.match(m.text, /❌ Зволожувач Humix560 — 1 шт × 900,00 — <b>немає в замовленні<\/b>/);
assert.match(m.text, /❌ Очищувач Levoit Core 600S — 1 шт × 1[\s ]800,00 — <b>немає в документі<\/b>/);
assert.ok(btnData(m, /Зберегти все одно/));
await press(btnData(m, /Зберегти все одно/));
o1 = await req('GET', `/api/b2b/orders/${s1.id}`);
assert.equal(o1.order.invoice_no, '111');
assert.match(o1.history.map((x) => x.action).join('\n'), /з розбіжностями/);

// ---------- 4. Фото без підказок: список → тип → № → зберегти ----------
calls.length = 0;
await sendDoc(new Uint8Array([0xff, 0xd8, 1, 2]), { id: 'f3', name: 'img.jpg', mime: 'image/jpeg' });
m = last('sendMessage');
assert.match(m.text, /До якого замовлення прикріпити/);
const pick = btnData(m, new RegExp(`B2B-${s2.id} `));
assert.ok(pick);
await press(pick);
m = last('editMessageText');
assert.match(m.text, /Що це за документ/);
await press(btnData(m, /Накладна/));
m = last('editMessageText');
await press(btnData(m, /Зберегти/));
// накладна без № — дозволено; для рахунку бот питає №
const doc4 = await db.get(`SELECT * FROM b2b_tg_docs ORDER BY id DESC LIMIT 1`);
assert.equal(doc4.state, 'saved');
assert.equal((await req('GET', `/api/b2b/orders/${s2.id}`)).files[0].kind, 'waybill');
// рахунок фото → № текстом
await sendDoc(new Uint8Array([0xff, 0xd8, 5]), { id: 'f4', name: 'img2.jpg', mime: 'image/jpeg', caption: `рахунок B2B-${s2.id}` });
m = last('sendMessage');
await press(btnData(m, /Зберегти/));
assert.match(last('sendMessage').text, /№ рахунку/);
await hook({ message: { message_id: 9, chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '№ 777' } });
m = last('sendMessage');
assert.match(m.text, /Рахунок<\/b> № <b>777<\/b>/);
await press(btnData(m, /Зберегти/));
assert.equal((await req('GET', `/api/b2b/orders/${s2.id}`)).order.invoice_no, '777');

// ---------- 5. Не адмін (партнер) особисто боту — документ не приймається ----------
calls.length = 0;
await sendDoc(new Uint8Array([1]), { id: 'f5', chat: 2 });
assert.match(last('sendMessage').text, /Щоб отримувати сповіщення/);
assert.equal(await db.get(`SELECT id FROM b2b_tg_docs WHERE file_id = 'f5'`), null);

// ---------- 6. Маркування відповіддю в групі партнера ----------
const { code } = await req('POST', '/api/b2b/labels-group');
await hook({ message: { message_id: 1, chat: { id: -900, type: 'group', title: 'накладні розетка' }, text: `/link ${code}` } });
assert.match(last('sendMessage').text, /для <b>маркувань<\/b>/);
assert.equal((await req('GET', '/api/b2b/labels-group')).title, 'накладні розетка');
const cl = await req('POST', '/api/b2b/p/clients', { client_name: 'Петренко Олена', client_phone: '0501112233', supply_id: s1.id, items: [{ product_id: 11, qty: 1 }] }, A);
assert.ok(!calls.some(([mm, b]) => mm === 'sendMessage' && b.chat_id === '-500' && /Нове замовлення клієнта/.test(b.text)), 'замовлення клієнтів у групу партнера не йдуть');
// маркування відповіддю на старе повідомлення бота про замовлення клієнта — як і раніше
const clientMsg = { text: `📦 Нове замовлення клієнта B2B-${cl.id} від «Партнер А»` };
files.set('lab1', miniPdf(npLabel({ ttn: '20400556982593', phone: '050 111 22 33' })));
calls.length = 0;
await hook({ message: { message_id: 30, chat: { id: -500, type: 'supergroup' }, from: { id: 50, first_name: 'Олег' },
  document: { file_id: 'lab1', file_unique_id: 'ul1', file_name: 'marking.pdf', mime_type: 'application/pdf', file_size: 900 },
  reply_to_message: { message_id: 29, from: { is_bot: true, username: 'ecobot' }, text: clientMsg.text } } });
let co = await req('GET', `/api/b2b/orders/${cl.id}`);
assert.equal(co.files[0].kind, 'label');
assert.equal(co.order.ttn, '20400556982593', 'ТТН з маркування');
const toLabels = calls.find(([mm, b]) => mm === 'sendDocument' && b.chat_id === '-900')?.[1];
assert.ok(toLabels && toLabels.document === 'lab1');
assert.match(toLabels.caption, /🏷 <b>Петренко Олена<\/b> · <i>ще не в CRM<\/i> · B2B-\d+ · ТТН 20400556982593/);
assert.match(calls.find(([mm, b]) => mm === 'sendMessage' && b.chat_id === '-500')[1].text, /Маркування додано до <b>B2B-\d+<\/b> \(Петренко Олена\)/);
// телефон не той — попередження
files.set('lab2', miniPdf(npLabel({ ttn: '20400556982593', phone: '067 000 00 00' })));
calls.length = 0;
await hook({ message: { message_id: 31, chat: { id: -500, type: 'supergroup' }, from: { id: 50 }, document: { file_id: 'lab2', file_unique_id: 'ul2', file_name: 'm2.pdf', mime_type: 'application/pdf', file_size: 900 },
  reply_to_message: { message_id: 29, from: { is_bot: true, username: 'ecobot' }, text: clientMsg.text } } });
assert.match(calls.find(([mm, b]) => mm === 'sendMessage' && b.chat_id === '-500')[1].text, /⚠️ телефон одержувача/);
assert.match(calls.find(([mm, b]) => mm === 'sendDocument' && b.chat_id === '-900')[1].caption, /оновлено/);
// відповідь на повідомлення про закупівлю — підказка, не зберігається
calls.length = 0;
await hook({ message: { message_id: 32, chat: { id: -500, type: 'supergroup' }, from: { id: 50 }, document: { file_id: 'lab3', file_unique_id: 'ul3', file_name: 'x.pdf', mime_type: 'application/pdf', file_size: 9 },
  reply_to_message: { message_id: 28, from: { is_bot: true, username: 'ecobot' }, text: `🆕 Нова закупівля B2B-${s1.id}` } } });
assert.match(last('sendMessage').text, /відповіддю на повідомлення про замовлення клієнта/);
// маркування з сайту — теж у групу маркувань
calls.length = 0;
const up = await mk().request(`/api/b2b/p/clients/${cl.id}/files`, { method: 'POST', headers: { Cookie: A.Cookie, 'Content-Type': 'image/png', 'X-File-Name': 'label.png' }, body: new Uint8Array([1, 2, 3]) });
assert.equal(up.status, 200);
assert.ok(calls.some(([mm, b]) => mm === 'sendDocument' && b.chat_id === '-900'), 'маркування з сайту — у групу маркувань');

// ---------- 7. № у CRM — рядок у групу маркувань ----------
calls.length = 0;
await req('PUT', `/api/b2b/clients/${cl.id}`, { crm_id: '108971' });
assert.ok(calls.some(([mm, b]) => mm === 'sendMessage' && b.chat_id === '-900' && /Петренко Олена<\/b> → CRM № <b>108971<\/b>/.test(b.text)));

console.log('OK — Telegram: рахунки й накладні особисто боту, маркування з групи партнера, група маркувань');
