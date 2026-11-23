// B2B «Ремонт»: Telegram-група для повернень і заявок «Брак / обмін» + статус «Повернуто» замовлення клієнта.
// 1) Група: адмін бере код у B2B → Налаштування, додає бота в групу і пише «/link КОД» у потрібній гілці (напр. General).
//    Чат зберігається як «id» або «id#гілка» — повідомлення йдуть саме в цю гілку.
// 2) Повернення: партнер у замовленні «Передано в CRM» вказує ТТН повернення, на кого їде посилка (юрособа партнера або
//    номер гарантійного відділу) і коментар (обов'язково) → статус «Повернуто», повідомлення в групу «Ремонт».
//    Скасувати повернення (знову «Передано в CRM») може лише наш менеджер.
// 3) Усі події заявок «Брак / обмін» (claims.js) теж ідуть у групу «Ремонт» — через tgRepair / fileRepair.
import { fail, need, nowIso, loadSettings } from '../../core/common.js';
import { randomToken } from '../../core/auth.js';
import { RETURN_TO, orderNo } from './orders.js';

const KEYS = ['b2b_repair_chat', 'b2b_repair_title', 'b2b_repair_code'];

export function mountB2bRepair(app, { db, services = {}, myPartner, orders }) {
  const { orderOf, log, tgAdmins, tgPartner, link, h } = orders;
  const set = (key, value) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  const repairChat = async () => (await db.get(`SELECT value FROM settings WHERE key = 'b2b_repair_chat'`))?.value || '';
  const tgRepair = async (text) => {
    const chat = await repairChat();
    return chat ? services.notify?.sendText({ chatIds: [chat] }, text).catch(() => 0) : 0;
  };
  const fileRepair = async (file, caption) => {
    const chat = await repairChat();
    return chat ? services.notify?.sendFile?.({ chatIds: [chat] }, file, caption).catch(() => 0) : 0;
  };

  // ---------------------------------------------------------------- налаштування: група «Ремонт» і номер гарантійного відділу
  app.get('/api/b2b/repair-group', async (c) => {
    need(c, 'b2b.admin');
    const s = await loadSettings(db);
    return c.json({ chat: s.b2b_repair_chat || '', title: s.b2b_repair_title || '', bot: s.tg_bot || '', warranty_phone: s.b2b_warranty_phone || '' });
  });
  app.post('/api/b2b/repair-group', async (c) => {
    need(c, 'b2b.admin');
    const s = await loadSettings(db);
    if (!s.tg_token || !s.tg_bot) throw fail(400, 'Telegram-бота ще не підключено (Налаштування → Telegram).');
    const code = randomToken(6);
    await set('b2b_repair_code', `${code}|${Date.now() + 30 * 60000}`);
    return c.json({ code, bot: s.tg_bot });
  });
  app.delete('/api/b2b/repair-group', async (c) => {
    need(c, 'b2b.admin');
    await db.run(`DELETE FROM settings WHERE key IN (SELECT value FROM json_each(?))`, [JSON.stringify(KEYS)]);
    return c.json({ ok: true });
  });
  app.put('/api/b2b/warranty-phone', async (c) => {
    need(c, 'b2b.admin');
    const raw = String((await c.req.json().catch(() => ({}))).phone ?? '').trim().slice(0, 40);
    const digits = raw.replace(/\D/g, '');
    if (raw && digits.length < 9) throw fail(400, 'Вкажіть номер телефону повністю, напр. +380 67 123 45 67.');
    await set('b2b_warranty_phone', raw);
    return c.json({ ok: true, phone: raw });
  });
  // /link КОД у групі (index.js → tgGroupLink): thread — гілка, де написали команду (у звичайній групі — немає).
  async function linkRepairGroup(code, chat, title, thread) {
    const s = await loadSettings(db);
    const [want, exp] = String(s.b2b_repair_code || '').split('|');
    if (!want || want !== code || (Number(exp) || 0) < Date.now()) return '';
    await set('b2b_repair_chat', thread ? `${chat}#${thread}` : String(chat));
    await set('b2b_repair_title', String(title).slice(0, 120));
    await db.run(`DELETE FROM settings WHERE key = 'b2b_repair_code'`);
    return '✅ Групу прив\'язано як <b>«Ремонт»</b>: сюди надходитимуть повернення замовлень клієнтів B2B і всі заявки «Брак / обмін».';
  }
  // група стала супергрупою / бота прибрали
  async function groupMoved(from, to) {
    const cur = await repairChat();
    if (cur && cur.split('#')[0] === String(from)) await set('b2b_repair_chat', [to, ...cur.split('#').slice(1)].join('#'));
  }
  async function groupLeft(chat) {
    const cur = await repairChat();
    if (cur && cur.split('#')[0] === String(chat)) await db.run(`DELETE FROM settings WHERE key IN ('b2b_repair_chat', 'b2b_repair_title')`);
  }

  // ---------------------------------------------------------------- повернення замовлення клієнта
  const itemsOf = (id) => db.all(`SELECT name, article, qty FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [id]);
  async function returnText(c, o, partnerName) {
    const items = await itemsOf(o.id);
    const s = await loadSettings(db);
    const to = o.return_to === 'warranty' ? `номер гарантійного відділу${s.b2b_warranty_phone ? ` (${h(s.b2b_warranty_phone)})` : ''}` : 'юрособу партнера';
    return `↩️ <b>Повернення · ${orderNo(o.id)} · ${h(partnerName)}</b>`
      + `\nТТН до нас: <b>${h(o.return_ttn)}</b>`
      + `\nЇде на: ${to}`
      + `\nLP-CRM: ${o.crm_id ? `№ <b>${h(o.crm_id)}</b>` : 'ще без номера'}`
      + `\nКлієнт: ${h(o.client_name || '—')}${o.client_phone ? `, +${h(o.client_phone)}` : ''}${o.ttn ? `\nТТН відправки клієнту: ${h(o.ttn)}` : ''}`
      + `\nТовар:\n${items.map((i) => `• ${h(i.name)}${i.article ? ` (${h(i.article)})` : ''} × ${i.qty}`).join('\n')}`
      + `\n<b>Коментар партнера:</b> ${h(o.return_note)}`
      + `\n${link(c, `b2bclients/${o.id}`)}`;
  }
  // Форма для партнера: номер гарантійного відділу (щоб вписати одержувача в ТТН).
  app.get('/api/b2b/p/return-info', async (c) => {
    await myPartner(c);
    const s = await loadSettings(db);
    return c.json({ warranty_phone: s.b2b_warranty_phone || '', to: RETURN_TO });
  });
  app.post('/api/b2b/p/clients/:id/return', async (c) => {
    const p = await myPartner(c);
    need(c, 'b2b.order');
    const o = await orderOf(c.req.param('id'), p.id);
    if (o.kind !== 'client') throw fail(404, 'Замовлення не знайдено.');
    if (o.status === 'returned') throw fail(400, 'Повернення вже оформлено.');
    if (o.status !== 'crm') throw fail(400, 'Повернення можна оформити лише для замовлення, переданого в роботу (статус «Передано в CRM»).');
    const b = await c.req.json().catch(() => ({}));
    const ttn = String(b.ttn ?? '').replace(/\s/g, '');
    if (!/^\d{10,20}$/.test(ttn)) throw fail(400, 'Вкажіть ТТН повернення — лише цифри (14 цифр для Нової пошти).');
    const to = RETURN_TO[b.to] ? b.to : '';
    if (!to) throw fail(400, 'Оберіть, на кого їде посилка: на юрособу партнера чи на номер гарантійного відділу.');
    const note = String(b.note ?? '').trim().slice(0, 1000);
    if (note.length < 5) throw fail(400, 'Напишіть коментар: чому повертають і в якому стані товар.');
    const now = nowIso();
    const r = await db.run(`UPDATE b2b_orders SET status = 'returned', return_ttn = ?, return_to = ?, return_note = ?, returned_at = ?, updated_at = ? WHERE id = ? AND status = 'crm'`,
      [ttn, to, note, now, now, o.id]);
    if (!r.changes) throw fail(409, 'Замовлення вже змінено — оновіть сторінку.');
    await log(o.id, c.get('user'), `повернення: ТТН ${ttn}, ${RETURN_TO[to]} — ${note}`.slice(0, 1800));
    const text = await returnText(c, { ...o, return_ttn: ttn, return_to: to, return_note: note }, p.name);
    const sent = await tgRepair(text);
    if (!sent) await tgAdmins(text); // групу «Ремонт» ще не прив'язано — щоб не загубилось
    return c.json({ ok: true });
  });
  // Скасувати повернення (помилково позначено) — лише наш менеджер: знову «Передано в CRM».
  app.post('/api/b2b/clients/:id/unreturn', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind !== 'client' || o.status !== 'returned') throw fail(400, 'Замовлення не в статусі «Повернуто».');
    await db.run(`UPDATE b2b_orders SET status = 'crm', updated_at = ? WHERE id = ? AND status = 'returned'`, [nowIso(), o.id]);
    await log(o.id, c.get('user'), `повернення скасовано (ТТН ${o.return_ttn}) — знову «Передано в CRM»`);
    await tgPartner(o.partner_id, `↩️ Повернення замовлення ${orderNo(o.id)} (${h(o.client_name)}) скасував менеджер — замовлення знову в роботі.`);
    await tgRepair(`↩️ Повернення ${orderNo(o.id)} (ТТН ${h(o.return_ttn)}) скасовано менеджером.`);
    return c.json({ ok: true });
  });

  return { tgRepair, fileRepair, linkRepairGroup, groupMoved, groupLeft };
}
