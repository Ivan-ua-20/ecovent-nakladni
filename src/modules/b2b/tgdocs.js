// B2B у Telegram: документи й маркування.
//
// 1) Рахунок / накладна ОСОБИСТО боту (власник, адміни): відповіддю на повідомлення про закупівлю, з підписом «B2B-9»
//    або просто файлом. Бот читає PDF (BAS): тип, №, дату, покупця, суму, товари — знаходить закупівлю, звіряє
//    покупця, суму, кожен товар (кількість і ціну) і ЗАВЖДИ просить підтвердити: [Зберегти] / [Зберегти все одно].
//    Після збереження — файл і № у закупівлі, статус, сповіщення партнеру, файл у групу партнера; 15 хв — «Скасувати».
// 2) Маркування в групі партнера: відповідь файлом на повідомлення бота про замовлення клієнта. Бот зберігає його,
//    звіряє ТТН і телефон з маркування НП (порожню ТТН заповнює) і пересилає в групу маркувань («накладні розетка»)
//    з ПІБ клієнта і № замовлення в CRM (або «ще не в CRM»). Маркування, додані на сайті, — так само.
// 3) Коли замовлення з маркуванням отримує № у CRM — бот пише це в групу маркувань.
// 4) Група «Фінансові питання» (бот — адмін, бачить усі повідомлення): на нову закупівлю бот пише запит рахунку
//    (у гілку General); бухгалтер відповідає PDF — якщо все збіглося, рахунок одразу в закупівлі й у групі партнера.
//    Після оплати бот відповіддю на рахунок просить накладну — так само. PDF без відповіді бот впізнає за вмістом
//    (лише точний збіг) і пропонує [Прикріпити]. Кнопки в групі спрацьовують лише для адмінів групи / сайту.
import { fail, need, nowIso, loadSettings } from '../../core/common.js';
import { can, randomToken } from '../../core/auth.js';
import { pdfText, parseBasDoc, parseNpLabel, hintsOf, sameName, modelTokens } from '../../integrations/pdftext.js';
import { orderNo } from './orders.js';

const KIND_NAME = { invoice: 'Рахунок', waybill: 'Накладна' };
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nf = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m2 = (n) => nf.format(Number(n) || 0);
const UNDO_MIN = 15;
const MAX_FILE = 5 * 1024 * 1024;
const PAGE = 8;
const kyivToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
const fmtDate = (d) => (d ? d.split('-').reverse().join('.') : '');
const phoneFmt = (p) => (/^380\d{9}$/.test(p || '') ? `+${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8, 10)} ${p.slice(10)}` : (p || ''));

export function mountB2bTgDocs(app, { db, services, orders, hooks }) {
  const notify = () => services.notify;
  const tgApi = (method, body) => notify()?.api(method, body);
  const set = (key, value) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  const isPdf = (bytes) => bytes?.[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;

  // ================================================================ група маркувань
  app.get('/api/b2b/labels-group', async (c) => {
    need(c, 'b2b.admin');
    const s = await loadSettings(db);
    return c.json({ chat: s.b2b_labels_chat || '', title: s.b2b_labels_title || '', bot: s.tg_bot || '' });
  });
  app.post('/api/b2b/labels-group', async (c) => {
    need(c, 'b2b.admin');
    const s = await loadSettings(db);
    if (!s.tg_token || !s.tg_bot) throw fail(400, 'Telegram-бота ще не підключено (Налаштування → Telegram).');
    const code = randomToken(6);
    await set('b2b_labels_code', `${code}|${Date.now() + 30 * 60000}`);
    return c.json({ code, bot: s.tg_bot });
  });
  app.delete('/api/b2b/labels-group', async (c) => {
    need(c, 'b2b.admin');
    await db.batch([[`DELETE FROM settings WHERE key IN ('b2b_labels_chat', 'b2b_labels_title', 'b2b_labels_code')`, []]]);
    return c.json({ ok: true });
  });
  // /link КОД у групі: спершу перевіряє партнерів (index.js), потім — код групи маркувань.
  async function linkLabelsGroup(code, chat, title) {
    const s = await loadSettings(db);
    const [want, exp] = String(s.b2b_labels_code || '').split('|');
    if (!want || want !== code || (Number(exp) || 0) < Date.now()) return '';
    await db.batch([
      [`INSERT INTO settings (key, value) VALUES ('b2b_labels_chat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [chat]],
      [`INSERT INTO settings (key, value) VALUES ('b2b_labels_title', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(title).slice(0, 120)]],
      [`DELETE FROM settings WHERE key = 'b2b_labels_code'`, []],
    ]);
    return '✅ Групу прив\'язано для <b>маркувань</b>: сюди надходитимуть маркування замовлень клієнтів B2B з ПІБ клієнта і № замовлення в CRM.';
  }
  const labelsChat = async () => (await db.get(`SELECT value FROM settings WHERE key = 'b2b_labels_chat'`))?.value || '';

  // ================================================================ маркування
  const labelCaption = (o, extra = '') => `🏷 <b>${h(o.client_name)}</b> · ${o.crm_id ? `CRM № <b>${h(o.crm_id)}</b>` : '<i>ще не в CRM</i>'} · ${orderNo(o.id)}`
    + `${o.ttn ? ` · ТТН ${h(o.ttn)}` : ''}${extra}`;

  // Після збереження маркування (сайт або група партнера): звірка з маркуванням НП, ТТН у замовлення, пересилання.
  async function afterLabel(o, f, _user, { fileId = '', replaced = false } = {}) {
    const warnings = [];
    let np = null;
    if (f.bytes && isPdf(f.bytes)) np = parseNpLabel(await pdfText(f.bytes));
    if (np?.ttn) {
      if (!o.ttn) {
        await db.run(`UPDATE b2b_orders SET ttn = ?, updated_at = ? WHERE id = ?`, [np.ttn, nowIso(), o.id]);
        await orders.log(o.id, { name: 'Telegram' }, `ТТН ${np.ttn} — з маркування`);
        o = { ...o, ttn: np.ttn };
      } else if (np.ttn !== o.ttn) warnings.push(`ТТН у маркуванні ${np.ttn} не збігається із замовленням (${o.ttn})`);
      if (np.phone && o.client_phone && np.phone !== o.client_phone) warnings.push(`телефон одержувача ${phoneFmt(np.phone)} ≠ телефон клієнта ${phoneFmt(o.client_phone)}`);
    }
    const chat = await labelsChat();
    if (chat) {
      const extra = `${replaced ? ' · <b>оновлено</b>' : ''}${np?.rozetka ? ` · Розетка ${h(np.rozetka)}` : ''}${warnings.length ? `\n⚠️ ${h(warnings.join('; '))}` : ''}`;
      const sent = await notify()?.sendFile({ chatIds: [chat] }, fileId ? { fileId } : f, labelCaption(o, extra)).catch(() => 0);
      if (sent) await orders.log(o.id, { name: 'Telegram' }, 'маркування надіслано в групу маркувань');
    }
    return { warnings, ttn: np?.ttn || '' };
  }

  // Номер у CRM з'явився — у групу маркувань (якщо в замовлення є маркування).
  async function crmLinked(orderId, num) {
    const chat = await labelsChat();
    if (!chat) return;
    const o = await db.get(`SELECT id, client_name, ttn, (SELECT COUNT(*) FROM b2b_files f WHERE f.order_id = b2b_orders.id AND f.kind = 'label') AS labels FROM b2b_orders WHERE id = ?`, [orderId]);
    if (!o?.labels) return;
    await notify()?.sendText({ chatIds: [chat] }, `🔗 ${orderNo(o.id)} · <b>${h(o.client_name)}</b> → CRM № <b>${h(num)}</b>${o.ttn ? ` · ТТН ${h(o.ttn)}` : ''}`).catch(() => 0);
  }

  // Файл у відповідь на повідомлення бота в групі партнера → маркування замовлення клієнта.
  async function tgGroupFile(msg, base) {
    const chat = String(msg.chat.id);
    const reply = (text) => tgApi('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_to_message_id: msg.message_id }).catch(() => 0);
    const p = await db.get(`SELECT id, name FROM b2b_partners WHERE tg_group = ? AND COALESCE(deleted_at, '') = ''`, [chat]);
    if (!p) return;
    const replied = String(msg.reply_to_message?.text || msg.reply_to_message?.caption || '');
    const id = /B2B-(\d+)/.exec(replied)?.[1];
    if (!id || !/замовлення клієнта/i.test(replied)) {
      await reply('Маркування додається <b>відповіддю на повідомлення про замовлення клієнта</b> (📦 Нове замовлення клієнта B2B-…).');
      return;
    }
    const o = await db.get(`SELECT * FROM b2b_orders WHERE id = ? AND partner_id = ? AND kind = 'client'`, [Number(id), p.id]);
    if (!o) { await reply('Замовлення не знайдено.'); return; }
    if (o.status === 'cancelled') { await reply(`Замовлення ${orderNo(o.id)} скасовано — маркування не додано.`); return; }
    const file = fileOf(msg);
    if (file.size > MAX_FILE) { await reply('Файл завеликий (до 5 МБ).'); return; }
    const bytes = await notify().download(file.id);
    const info = await orders.labelInfo(bytes);
    const dup = await orders.labelDup(info, o.id);
    if (dup) { await reply(`⚠️ ${h(dup.id && (await db.get(`SELECT partner_id FROM b2b_orders WHERE id = ?`, [dup.id]))?.partner_id === p.id ? orders.dupText(dup) : 'Таке маркування вже використане в іншому замовленні.')}`); return; }
    if (await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = 'label' AND hash = ?`, [o.id, info.hash])) { await reply(`Це маркування вже додано до ${orderNo(o.id)}.`); return; }
    const replaced = !!(await db.get(`SELECT id FROM b2b_files WHERE order_id = ? AND kind = 'label' LIMIT 1`, [o.id]));
    const who = { name: `${[msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'партнер'} (Telegram)` };
    const f = await orders.storeFile(o, 'label', { bytes, name: file.name, mime: file.mime, hash: info.hash, ttn: info.ttn }, who, ' через групу Telegram');
    const r = await afterLabel(o, f, who, { fileId: file.id, replaced });
    await reply(`✅ Маркування додано до <b>${orderNo(o.id)}</b> (${h(o.client_name)})${r.ttn && !o.ttn ? `\nТТН ${r.ttn} записано в замовлення.` : ''}${r.warnings.length ? `\n⚠️ ${h(r.warnings.join('; '))}` : ''}`);
  }

  // ================================================================ документи особисто боту
  const fileOf = (msg) => {
    if (msg.document) return { id: msg.document.file_id, uid: msg.document.file_unique_id, name: msg.document.file_name || 'document', mime: msg.document.mime_type || 'application/octet-stream', size: msg.document.file_size || 0 };
    const ph = [...(msg.photo || [])].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
    return { id: ph.file_id, uid: ph.file_unique_id, name: `фото_${kyivToday()}.jpg`, mime: 'image/jpeg', size: ph.file_size || 0, photo: true };
  };
  const docOf = (id) => db.get(`SELECT * FROM b2b_tg_docs WHERE id = ?`, [id]);
  const saveDoc = (d, fields) => db.run(`UPDATE b2b_tg_docs SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(fields), d.id]);
  const parsedOf = (d) => { try { return JSON.parse(d.parsed || 'null'); } catch { return null; } };

  // Закупівлі й замовлення «без закупівлі», до яких можна прикріпити документ (найсвіжіші 200 за 120 днів).
  async function candidates() {
    const since = new Date(Date.now() - 120 * 86400000).toISOString();
    const rows = await db.all(
      `SELECT o.id, o.kind, o.status, o.partner_id, o.total, o.entity, o.invoice_no, o.waybill_no, o.client_name, o.created_at, p.name AS partner
       FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id
       WHERE o.status NOT IN ('cancelled', 'open') AND o.created_at > ? AND (o.kind = 'supply' OR o.supply_id IS NULL) ORDER BY o.id DESC LIMIT 200`, [since],
    );
    const ents = await db.all(`SELECT partner_id, name FROM b2b_entities`);
    const byPartner = new Map();
    for (const e of ents) byPartner.set(e.partner_id, [...(byPartner.get(e.partner_id) || []), e.name]);
    return rows.map((r) => ({ ...r, names: r.kind === 'supply' ? [String(r.entity || '').split('\n')[0].split(',')[0]] : (byPartner.get(r.partner_id) || []) }));
  }
  const needs = (o, kind) => (kind === 'waybill' ? !o.waybill_no : !o.invoice_no);
  function score(o, doc, kind) {
    let s = 0;
    if (doc?.total != null && Math.abs(doc.total - o.total) < 0.01) s += 100;
    if (doc?.buyer && o.names.some((n) => sameName(n, doc.buyer))) s += 50;
    if (kind && needs(o, kind)) s += 20;
    if (kind === 'waybill' && o.invoice_no) s += 5;
    return s;
  }
  async function ranked(doc, kind) {
    const list = await candidates();
    return list.map((o) => ({ o, s: score(o, doc, kind) })).sort((a, b) => b.s - a.s || b.o.id - a.o.id).map((x) => x.o);
  }
  // Автоматичний вибір: лише один кандидат, у якого збігаються і сума, і покупець.
  async function autoPick(doc, kind) {
    if (!doc) return null;
    const list = await candidates();
    const best = list.filter((o) => score(o, doc, kind) >= 150);
    if (best.length === 1) return best[0].id;
    const needy = best.filter((o) => needs(o, kind));
    return needy.length === 1 ? needy[0].id : null;
  }

  // Звірка товарів документа із замовленням: спершу за ціною й кількістю, далі за моделлю в назві.
  function compareItems(docItems, orderItems) {
    const left = orderItems.map((i) => ({ ...i, tokens: modelTokens(i.name), used: false }));
    const lines = [];
    let bad = 0;
    for (const d of docItems) {
      let hit = left.find((i) => !i.used && Math.abs(i.price - d.price) < 0.01 && i.qty === d.qty);
      if (!hit) {
        const dt = modelTokens(d.name);
        let best = null;
        let bestN = 0;
        for (const i of left) {
          if (i.used) continue;
          const n = [...dt].filter((t) => i.tokens.has(t)).length;
          if (n > bestN) { best = i; bestN = n; }
        }
        hit = bestN >= 1 ? best : null;
      }
      const short = h(d.name.length > 60 ? `${d.name.slice(0, 58)}…` : d.name);
      if (!hit) { bad++; lines.push(`❌ ${short} — ${d.qty} шт × ${m2(d.price)} — <b>немає в замовленні</b>`); continue; }
      hit.used = true;
      if (hit.qty === d.qty && Math.abs(hit.price - d.price) < 0.01) lines.push(`✅ ${short} — ${d.qty} шт × ${m2(d.price)}`);
      else { bad++; lines.push(`⚠️ ${short} — у документі <b>${d.qty} шт × ${m2(d.price)}</b>, у замовленні <b>${hit.qty} шт × ${m2(hit.price)}</b>`); }
    }
    for (const i of left.filter((x) => !x.used)) { bad++; lines.push(`❌ ${h(i.name.slice(0, 60))} — ${i.qty} шт × ${m2(i.price)} — <b>немає в документі</b>`); }
    return { lines, bad };
  }

  const kbd = (rows) => ({ inline_keyboard: rows.filter((r) => r.length) });
  const btn = (text, d, act, arg = '') => ({ text, callback_data: `bd:${d.id}:${act}${arg !== '' ? `:${arg}` : ''}` });

  // Повідомлення-перевірка (або список, якщо замовлення ще не обрано).
  async function render(d, { page = 0 } = {}) {
    const doc = parsedOf(d);
    const kind = d.kind;
    const head = `${kind ? `${kind === 'invoice' ? '🧾' : '📦'} <b>${KIND_NAME[kind]}</b>` : '📄 <b>Документ</b>'}${d.number ? ` № <b>${h(d.number)}</b>` : ''}`
      + `${d.doc_date ? ` від ${fmtDate(d.doc_date)}` : ''}${doc?.total != null ? ` · <b>${m2(doc.total)} грн</b>` : ''}`
      + `${doc?.buyer ? `\nПокупець: ${h(doc.buyer)}` : ''}\n<i>${h(d.name)}</i>${doc ? '' : (d.mime === 'application/pdf' ? '\n<i>Текст у PDF не прочитано — № введіть вручну.</i>' : '')}`;
    if (!d.order_id) {
      let list = await ranked(doc, kind);
      const only = (() => { try { return JSON.parse(d.choices || '[]'); } catch { return []; } })();
      if (d.source === 'fin' && only.length) list = list.filter((o) => only.includes(o.id));
      const slice = list.slice(page * PAGE, page * PAGE + PAGE);
      const rows = slice.map((o) => [btn(`${o.kind === 'client' ? '🔴 ' : ''}${orderNo(o.id)} · ${o.partner} · ${m2(o.total)} ₴${score(o, doc, kind) >= 150 ? ' ✅' : ''}${needs(o, kind || 'invoice') ? (kind === 'waybill' ? ' · без накладної' : ' · без рахунку') : ''}`.slice(0, 64), d, 'o', o.id)]);
      const nav = [];
      if (page > 0) nav.push(btn('◀️ Назад', d, 'pg', page - 1));
      if (list.length > (page + 1) * PAGE) nav.push(btn('Ще ▶️', d, 'pg', page + 1));
      return {
        text: `${head}\n\n<b>До якого замовлення прикріпити?</b>${list.length ? '\n✅ — збігаються сума і покупець · 🔴 — замовлення клієнта без закупівлі' : '\nНемає відкритих закупівель.'}`,
        keyboard: kbd([...rows, nav, [btn(d.source === 'fin' ? 'Не той файл' : 'Скасувати', d, 'cancel')]]),
        bad: 1,
      };
    }
    const o = await db.get(`SELECT o.*, p.name AS partner FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id WHERE o.id = ?`, [d.order_id]);
    if (!o || o.status === 'cancelled') {
      await saveDoc(d, { order_id: null });
      return render({ ...d, order_id: null });
    }
    const items = await db.all(`SELECT name, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    const names = o.kind === 'supply' ? [String(o.entity || '').split('\n')[0].split(',')[0]] : (await db.all(`SELECT name FROM b2b_entities WHERE partner_id = ?`, [o.partner_id])).map((x) => x.name);
    const checks = [];
    let bad = 0;
    if (doc?.buyer) { const ok = names.some((n) => sameName(n, doc.buyer)); bad += ok ? 0 : 1; checks.push(ok ? '✅ Покупець збігається' : `⚠️ Покупець у документі не збігається з юрособою (${h(names[0] || '—')})`); }
    if (doc?.total != null) { const ok = Math.abs(doc.total - o.total) < 0.01; bad += ok ? 0 : 1; checks.push(ok ? '✅ Сума збігається' : `⚠️ Сума: у документі <b>${m2(doc.total)}</b>, у замовленні <b>${m2(o.total)}</b>`); }
    let itemLines = [];
    if (doc?.items?.length) { const r = compareItems(doc.items, items); bad += r.bad; itemLines = r.lines; }
    if (kind === 'invoice' && o.invoice_no && o.invoice_no !== d.number) checks.push(`⚠️ У замовленні вже є рахунок № ${h(o.invoice_no)} — буде замінено`);
    if (kind === 'waybill' && o.waybill_no && o.waybill_no !== d.number) checks.push(`⚠️ У замовленні вже є накладна № ${h(o.waybill_no)} — буде замінено`);
    if (d.number && kind) {
      const dup = await db.get(`SELECT id FROM b2b_orders WHERE id != ? AND ${kind === 'invoice' ? 'invoice_no' : 'waybill_no'} = ? AND status != 'cancelled' LIMIT 1`, [o.id, d.number]);
      if (dup) { bad++; checks.push(`⚠️ ${KIND_NAME[kind]} № ${h(d.number)} уже є в ${orderNo(dup.id)}`); }
    }
    const target = `→ <b>${orderNo(o.id)}</b> · ${h(o.partner)}${o.kind === 'client' ? ` · клієнт ${h(o.client_name)} · 🔴 <b>без закупівлі</b>` : ` · ${h(names[0] || '')}`} · ${m2(o.total)} ₴`;
    const more = itemLines.length > 20 ? [`…ще ${itemLines.length - 20}`] : [];
    const text = `${head}\n\n${target}\n${[...checks, ...itemLines.slice(0, 20), ...more].join('\n')}${!kind ? '\n\n<b>Що це за документ?</b>' : ''}${kind === 'invoice' && !d.number ? '\n\n⚠️ Немає № рахунку — натисніть «Вказати №».' : ''}`;
    const rows = [];
    if (d.source === 'fin') {
      // у групі: лише головне, без зміни № (його беремо з PDF)
      rows.push([btn(bad ? `⚠️ Прикріпити все одно до ${orderNo(o.id)}` : `✅ Прикріпити до ${orderNo(o.id)}`, d, 'save')]);
      rows.push([btn('Інше замовлення', d, 'other'), btn('Не той файл', d, 'cancel')]);
      return { text, keyboard: kbd(rows), bad };
    }
    if (!kind) rows.push([btn('🧾 Рахунок', d, 'k', 'invoice'), btn('📦 Накладна', d, 'k', 'waybill')]);
    else rows.push([btn(bad ? '⚠️ Зберегти все одно' : '✅ Зберегти', d, 'save')]);
    rows.push([btn(d.number ? 'Змінити №' : 'Вказати №', d, 'num'), ...(kind ? [btn(kind === 'invoice' ? 'Це накладна' : 'Це рахунок', d, 'k', kind === 'invoice' ? 'waybill' : 'invoice')] : [])]);
    rows.push([btn('Інше замовлення', d, 'other'), btn('Скасувати', d, 'cancel')]);
    return { text, keyboard: kbd(rows), bad };
  }
  async function show(d, { page = 0, fresh = false } = {}) {
    const r = await render(d, { page });
    if (d.msg_id && !fresh) {
      await tgApi('editMessageText', { chat_id: d.chat_id, message_id: d.msg_id, text: r.text, parse_mode: 'HTML', reply_markup: r.keyboard, disable_web_page_preview: true }).catch(() => 0);
    } else {
      const m = await tgApi('sendMessage', { chat_id: d.chat_id, text: r.text, parse_mode: 'HTML', reply_markup: r.keyboard, disable_web_page_preview: true,
        ...(d.reply_to ? { reply_to_message_id: d.reply_to, allow_sending_without_reply: true } : {}) });
      await saveDoc(d, { msg_id: m?.message_id || 0 });
    }
  }

  async function tgPrivate(msg, user, base) {
    if (!can(user, 'b2b.admin')) return false;
    const chat = String(msg.chat.id);
    // відповідь на «Напишіть №…»
    if (msg.text && !msg.text.startsWith('/')) {
      const d = await db.get(`SELECT * FROM b2b_tg_docs WHERE chat_id = ? AND state = 'await_number' ORDER BY id DESC LIMIT 1`, [chat]);
      if (!d) return false;
      const num = String(msg.text).trim().replace(/^№\s*/, '').slice(0, 40);
      await saveDoc(d, { number: num, state: 'pending' });
      await show({ ...(await docOf(d.id)) }, { fresh: true });
      return true;
    }
    if (!msg.document && !msg.photo) return false;
    const file = fileOf(msg);
    if (file.size > MAX_FILE) {
      await tgApi('sendMessage', { chat_id: chat, text: 'Файл завеликий: на сайті зберігаються файли до 5 МБ. Стисніть PDF або надішліть менший файл.' }).catch(() => 0);
      return true;
    }
    const bytes = await notify().download(file.id);
    const doc = isPdf(bytes) ? parseBasDoc(await pdfText(bytes)) : null;
    const hints = hintsOf(`${msg.caption || ''} ${file.name}`);
    const replyId = Number(/B2B-(\d+)/.exec(String(msg.reply_to_message?.text || msg.reply_to_message?.caption || ''))?.[1]) || null;
    const kind = doc?.kind || hints.kind || '';
    const orderId = replyId || hints.order || await autoPick(doc, kind);
    const r = await db.run(
      `INSERT INTO b2b_tg_docs (chat_id, user_id, file_id, file_uid, name, mime, size, parsed, order_id, kind, number, doc_date, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [chat, user.id, file.id, file.uid || '', file.name, file.mime, file.size || bytes.length, doc ? JSON.stringify(doc) : '', orderId, kind,
        doc?.number || hints.number || '', doc?.date || kyivToday(), nowIso()],
    );
    await show(await docOf(r.lastId), { fresh: true });
    return true;
  }

  // Адмін групи в Telegram (власник або адміністратор чату).
  async function isChatAdmin(chat, tgUserId) {
    const r = await tgApi('getChatMember', { chat_id: chat, user_id: tgUserId }).catch(() => null);
    return ['creator', 'administrator'].includes(r?.status);
  }
  const tgWho = (from) => ({ name: `${[from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'Telegram'} (Telegram)` });

  async function tgCallback(cq, user, base) {
    const m = /^bd:(\d+):(\w+)(?::(.+))?$/.exec(String(cq.data || ''));
    if (!m) return '';
    const d = await docOf(Number(m[1]));
    if (!d || d.chat_id !== String(cq.message?.chat?.id)) return 'Застаріла кнопка.';
    // У групі «Фінансові питання» — лише адміни групи або сайту; особисто — лише адміни сайту.
    const siteAdmin = !!user && can(user, 'b2b.admin');
    if (d.source === 'fin' ? !(siteAdmin || await isChatAdmin(d.chat_id, cq.from?.id)) : !siteAdmin) return 'Лише для адміністраторів.';
    user = siteAdmin ? user : null;
    d.who = siteAdmin ? null : tgWho(cq.from);
    const act = m[2];
    const arg = m[3];
    if (d.state === 'cancelled') return 'Уже скасовано.';
    if (act === 'undo') return undo(d, user, base);
    if (d.state === 'saved' || d.state === 'undone') return 'Уже збережено.';
    if (act === 'cancel') {
      await saveDoc(d, { state: 'cancelled' });
      await tgApi('editMessageText', { chat_id: d.chat_id, message_id: d.msg_id, text: `✖️ Скасовано — «${h(d.name)}» нікуди не збережено.`, parse_mode: 'HTML' }).catch(() => 0);
      return '';
    }
    if (act === 'pg') { await show(d, { page: Number(arg) || 0 }); return ''; }
    if (act === 'other') { await saveDoc(d, { order_id: null }); await show({ ...d, order_id: null }); return ''; }
    if (act === 'o') { await saveDoc(d, { order_id: Number(arg) }); await show({ ...d, order_id: Number(arg) }); return ''; }
    if (act === 'k' && KIND_NAME[arg]) { await saveDoc(d, { kind: arg }); await show({ ...d, kind: arg }); return ''; }
    if (act === 'num') {
      await saveDoc(d, { state: 'await_number' });
      await tgApi('sendMessage', { chat_id: d.chat_id, text: `Напишіть № ${d.kind === 'waybill' ? 'накладної' : 'рахунку'} одним повідомленням (наприклад: 125).`, reply_markup: { force_reply: true } }).catch(() => 0);
      return '';
    }
    if (act === 'save') return save(d, user, base);
    return '';
  }

  async function save(d, user, base) {
    if (!d.order_id) return 'Спершу оберіть замовлення.';
    if (!d.kind) return 'Оберіть: рахунок чи накладна.';
    if (d.kind === 'invoice' && !d.number) {
      await saveDoc(d, { state: 'await_number' });
      await tgApi('sendMessage', { chat_id: d.chat_id, text: 'Напишіть № рахунку одним повідомленням — і натисніть «Зберегти» ще раз.', reply_markup: { force_reply: true } }).catch(() => 0);
      return 'Потрібен № рахунку';
    }
    const o = await orders.orderOf(d.order_id);
    if (o.status === 'cancelled') return 'Замовлення скасовано.';
    // «бронюємо» збереження від подвійного натискання
    const claim = await db.run(`UPDATE b2b_tg_docs SET state = 'saving' WHERE id = ? AND state = 'pending'`, [d.id]);
    if (!claim.changes) return 'Уже зберігається…';
    try {
      const bytes = await notify().download(d.file_id);
      const who = user ? { id: user.id, name: user.name || user.login } : (d.who || { name: d.tg_name || 'Telegram' });
      const f = await orders.storeFile(o, d.kind, { bytes, name: d.name, mime: d.mime }, who, d.source === 'fin' ? ' (група «Фінансові питання»)' : ' через Telegram');
      const prev = { invoice_no: o.invoice_no, invoice_date: o.invoice_date, waybill_no: o.waybill_no, status: o.status };
      const next = d.kind === 'invoice' ? { invoice_no: d.number, invoice_date: d.doc_date || kyivToday() } : (d.number ? { waybill_no: d.number } : {});
      await orders.applyNumbers(o, next, who, base, ' (через Telegram)');
      // розбіжності — в історію
      const r = await render({ ...d, state: 'saving' });
      const issues = r.text.split('\n').filter((l) => l.startsWith('⚠️') || l.startsWith('❌')).map((l) => l.replace(/<[^>]+>/g, ''));
      if (issues.length) await orders.log(o.id, who, `збережено з розбіжностями: ${issues.join('; ').slice(0, 900)}`);
      // у групу партнера
      let group = null;
      const g = await orders.groupOf(o.partner_id);
      if (g) {
        const cap = `${d.kind === 'invoice' ? '🧾 Рахунок' : '📦 Накладна'}${d.number ? ` № ${h(d.number)}` : ''} — ${o.kind === 'client' ? 'замовлення' : 'закупівля'} <b>${orderNo(o.id)}</b> на ${m2(o.total)} грн`;
        if (await notify().sendFile({ chatIds: [g] }, { fileId: d.file_id }, cap).catch(() => 0)) group = notify().lastFileMessage?.() || null;
      }
      await saveDoc(d, { state: 'saved', saved_at: nowIso(), file_row: f.id, prev: JSON.stringify(prev), group_msg: group ? JSON.stringify(group) : '' });
      // у «Фінансових питаннях» — запам'ятати повідомлення з рахунком (на нього бот відповість після оплати)
      if (d.source === 'fin' && d.kind === 'invoice' && d.reply_to) await db.run(`UPDATE b2b_orders SET fin_inv_msg = ? WHERE id = ?`, [d.reply_to, o.id]);
      // «Фінансові питання» — без повідомлень «Збережено»: реакція 👌 на документ, підказку з кнопками прибрати.
      // Скасувати — на сайті (файл і № у закупівлі).
      if (d.source === 'fin') {
        if (d.reply_to) await tgApi('setMessageReaction', { chat_id: d.chat_id, message_id: d.reply_to, reaction: [{ type: 'emoji', emoji: '👌' }] }).catch(() => 0);
        if (d.msg_id) await tgApi('deleteMessage', { chat_id: d.chat_id, message_id: d.msg_id }).catch(() => 0);
        return 'Збережено';
      }
      const url = `${base}/#/${o.kind === 'client' ? 'b2bclients' : 'b2borders'}/${o.id}`;
      const done = {
        chat_id: d.chat_id, parse_mode: 'HTML', disable_web_page_preview: true,
        text: `✅ <b>Збережено:</b> ${KIND_NAME[d.kind]}${d.number ? ` № ${h(d.number)}` : ''} → <b>${orderNo(o.id)}</b> (${h(o.client_name || o.entity.split('\n')[0].split(',')[0])}, ${m2(o.total)} ₴)`
          + `${issues.length ? `\n⚠️ з розбіжностями (${issues.length}) — записано в історію` : ''}${group ? '\n📤 Надіслано в групу партнера' : ''}`,
        reply_markup: kbd([[{ text: 'Відкрити на сайті', url }, btn(`↩️ Скасувати (${UNDO_MIN} хв)`, d, 'undo')]]),
      };
      if (d.msg_id) await tgApi('editMessageText', { ...done, message_id: d.msg_id }).catch(() => 0);
      else {
        const sent = await tgApi('sendMessage', { ...done, ...(d.reply_to ? { reply_to_message_id: d.reply_to, allow_sending_without_reply: true } : {}) }).catch(() => null);
        if (sent?.message_id) await saveDoc(d, { msg_id: sent.message_id });
      }
      return 'Збережено';
    } catch (e) {
      await saveDoc(d, { state: 'pending' });
      throw e;
    }
  }

  async function undo(d, user, base) {
    if (d.state !== 'saved') return 'Нічого скасовувати.';
    if (Date.now() - Date.parse(d.saved_at) > UNDO_MIN * 60000) return `Скасувати можна лише ${UNDO_MIN} хв — змініть на сайті.`;
    const prev = JSON.parse(d.prev || '{}');
    const o = await orders.orderOf(d.order_id).catch(() => null);
    if (o) {
      await orders.deleteFile(d.file_row);
      await db.run(`UPDATE b2b_orders SET invoice_no = ?, invoice_date = ?, waybill_no = ?, status = ?, updated_at = ? WHERE id = ?`,
        [prev.invoice_no ?? o.invoice_no, prev.invoice_date ?? o.invoice_date, prev.waybill_no ?? o.waybill_no, prev.status ?? o.status, nowIso(), o.id]);
      await orders.log(o.id, user ? { name: user.name || user.login } : (d.who || { name: 'Telegram' }), `скасовано через Telegram: ${KIND_NAME[d.kind]}${d.number ? ` № ${d.number}` : ''}`);
      if (d.source === 'fin' && d.kind === 'invoice') await db.run(`UPDATE b2b_orders SET fin_inv_msg = NULL WHERE id = ? AND fin_inv_msg = ?`, [o.id, d.reply_to]);
      if (d.kind === 'invoice' && d.number && d.number !== prev.invoice_no) {
        await orders.tgPartner(o.partner_id, `↩️ Рахунок № ${h(d.number)} до ${orderNo(o.id)} відкликано — менеджер надішле правильний.`);
      }
    }
    const g = d.group_msg ? JSON.parse(d.group_msg) : null;
    if (g?.id) await tgApi('deleteMessage', { chat_id: g.chat, message_id: g.id }).catch(() => 0);
    await saveDoc(d, { state: 'undone' });
    await tgApi('editMessageText', { chat_id: d.chat_id, message_id: d.msg_id, text: `↩️ Скасовано: ${KIND_NAME[d.kind]}${d.number ? ` № ${h(d.number)}` : ''} прибрано з ${orderNo(d.order_id)}.`, parse_mode: 'HTML' }).catch(() => 0);
    return 'Скасовано';
  }


  // ================================================================ група «Фінансові питання»
  const FIN_SET = ['b2b_fin_chat', 'b2b_fin_title', 'b2b_fin_code'];
  app.get('/api/b2b/fin-group', async (c) => {
    need(c, 'b2b.admin');
    const s = await loadSettings(db);
    return c.json({ chat: s.b2b_fin_chat || '', title: s.b2b_fin_title || '', bot: s.tg_bot || '' });
  });
  app.post('/api/b2b/fin-group', async (c) => {
    need(c, 'b2b.admin');
    const s = await loadSettings(db);
    if (!s.tg_token || !s.tg_bot) throw fail(400, 'Telegram-бота ще не підключено (Налаштування → Telegram).');
    const code = randomToken(6);
    await set('b2b_fin_code', `${code}|${Date.now() + 30 * 60000}`);
    return c.json({ code, bot: s.tg_bot });
  });
  app.delete('/api/b2b/fin-group', async (c) => {
    need(c, 'b2b.admin');
    await db.batch([[`DELETE FROM settings WHERE key IN (${FIN_SET.map(() => '?').join(', ')})`, FIN_SET]]);
    return c.json({ ok: true });
  });
  async function linkFinGroup(code, chat, title) {
    const s = await loadSettings(db);
    const [want, exp] = String(s.b2b_fin_code || '').split('|');
    if (!want || want !== code || (Number(exp) || 0) < Date.now()) return '';
    await set('b2b_fin_chat', chat);
    await set('b2b_fin_title', String(title).slice(0, 120));
    await db.run(`DELETE FROM settings WHERE key = 'b2b_fin_code'`);
    return '✅ Групу прив\'язано як <b>«Фінансові питання»</b>: сюди бот писатиме запити рахунків і накладних на закупівлі B2B. '
      + 'Надсилайте документ <b>відповіддю на запит</b>. Щоб бот бачив і документи без відповіді — зробіть його адміністратором групи.';
  }
  const finChat = async () => (await db.get(`SELECT value FROM settings WHERE key = 'b2b_fin_chat'`))?.value || '';
  const orderFull = (id) => db.get(`SELECT o.*, p.name AS partner FROM b2b_orders o JOIN b2b_partners p ON p.id = o.partner_id WHERE o.id = ?`, [id]);
  const firstLine = (e) => String(e || '').split('\n')[0];

  // Запит рахунку на закупівлю (нову або змінену) — у гілку General.
  // Текст запиту рахунку; done — рахунок уже є: те саме замовлення, лише з позначкою (повідомлення лишається в групі).
  async function reqText(o, { mode = '', done = false } = {}) {
    const items = await db.all(`SELECT name, qty, price FROM b2b_order_items WHERE order_id = ? ORDER BY id`, [o.id]);
    const lines = items.slice(0, 50).map((i) => `${h(i.name)} — ${i.qty} шт — ${m2(i.price)}`);
    if (items.length > 50) lines.push(`…і ще ${items.length - 50} поз.`);
    const head = done ? `🧾 <b>Закупівля ${orderNo(o.id)}</b> · ✅ рахунок № ${h(o.invoice_no)} додано`
      : `🧾 <b>Потрібен рахунок · ${orderNo(o.id)}</b>${mode === 'changed' ? ' <i>(закупівлю змінено)</i>' : ''}`;
    return `${head}\nПартнер: «${h(o.partner)}»\n\n`
      + `<b>Рахунок на:</b>\n${h(o.entity)}\n\n<b>Товари:</b>\n${lines.join('\n')}\n\n<b>Разом: ${m2(o.total)} грн</b> (з ПДВ)`
      + `${o.comment ? `\n<i>Коментар: ${h(String(o.comment).slice(0, 200))}</i>` : ''}${done ? '' : '\n\n↩️ Надішліть рахунок <b>відповіддю на це повідомлення</b>'}`;
  }
  async function finRequest(orderId, mode = '') {
    const chat = await finChat();
    if (!chat) return;
    const o = await orderFull(orderId);
    if (!o || o.kind !== 'supply' || o.status !== 'invoice_wait') return;
    const text = await reqText(o, { mode });
    if (o.fin_req_msg) {
      const ok = await tgApi('editMessageText', { chat_id: chat, message_id: o.fin_req_msg, text, parse_mode: 'HTML' }).catch(() => null);
      if (ok) { await tgApi('sendMessage', { chat_id: chat, text: `✏️ Закупівлю ${orderNo(o.id)} змінено — рахунок на оновлений список.`, reply_to_message_id: o.fin_req_msg, allow_sending_without_reply: true }).catch(() => 0); return; }
    }
    const m = await tgApi('sendMessage', { chat_id: chat, text, parse_mode: 'HTML' }).catch(() => null);
    if (m?.message_id) await db.run(`UPDATE b2b_orders SET fin_req_msg = ? WHERE id = ?`, [m.message_id, o.id]);
  }
  // Закупівлю скасовано / видалено — позначити запит.
  async function finClosed(orderId, note, snap = null) {
    const chat = await finChat();
    const o = snap || await orderFull(orderId);
    if (!chat || !o?.fin_req_msg) return;
    await tgApi('editMessageText', { chat_id: chat, message_id: o.fin_req_msg, parse_mode: 'HTML',
      text: `<s>🧾 Потрібен рахунок · ${orderNo(o.id)}</s> — <b>${h(note)}</b>\n${h(firstLine(o.entity))} · ${m2(o.total)} грн` }).catch(() => 0);
  }
  // № рахунку / накладної внесено (сайт, бот особисто чи група) — позначити запит виконаним.
  async function finNumbers(orderId) {
    const chat = await finChat();
    const o = await orderFull(orderId);
    if (!chat || !o) return;
    // Виконаний запит прибираємо з групи (менше повідомлень). Старше 48 год Telegram видалити не дасть — тоді позначаємо.
    // Запит рахунку (саме замовлення) лишається в групі — лише позначка, що рахунок додано.
    if (o.fin_req_msg && o.invoice_no) {
      await tgApi('editMessageText', { chat_id: chat, message_id: o.fin_req_msg, parse_mode: 'HTML', text: await reqText(o, { done: true }) }).catch(() => 0);
    }
    if (o.fin_pay_msg && o.waybill_no) {
      if (await tgApi('deleteMessage', { chat_id: chat, message_id: o.fin_pay_msg }).catch(() => null)) await db.run(`UPDATE b2b_orders SET fin_pay_msg = NULL WHERE id = ?`, [o.id]);
      else {
        await tgApi('editMessageText', { chat_id: chat, message_id: o.fin_pay_msg, parse_mode: 'HTML',
          text: `✅ <b>Накладна № ${h(o.waybill_no)} · ${orderNo(o.id)}</b> — додано (рахунок № ${h(o.invoice_no)}, ${m2(o.total)} грн)` }).catch(() => 0);
      }
    }
    // Підсумок — одне повідомлення, коли в закупівлі є і рахунок, і накладна.
    if (o.kind === 'supply' && o.invoice_no && o.waybill_no && !o.fin_done) {
      const claim = await db.run(`UPDATE b2b_orders SET fin_done = 1 WHERE id = ? AND COALESCE(fin_done, 0) = 0`, [o.id]);
      if (claim.changes) {
        await tgApi('sendMessage', { chat_id: chat, parse_mode: 'HTML',
          text: `✅ <b>Закупівлю ${orderNo(o.id)} закрито</b> — «${h(o.partner)}»\n${h(firstLine(o.entity))}\nРахунок № ${h(o.invoice_no)} · накладна № ${h(o.waybill_no)} · ${m2(o.total)} грн` }).catch(() => 0);
      }
    }
  }
  // Оплачено — відповіддю на повідомлення з рахунком: зробіть накладну.
  async function finPaid(orderId) {
    const chat = await finChat();
    const o = await orderFull(orderId);
    if (!chat || !o || o.waybill_no) return;
    const reply = o.fin_inv_msg || o.fin_req_msg;
    const m = await tgApi('sendMessage', {
      chat_id: chat, parse_mode: 'HTML', ...(reply ? { reply_to_message_id: reply, allow_sending_without_reply: true } : {}),
      text: `💰 <b>${orderNo(o.id)} оплачено</b> (рахунок № ${h(o.invoice_no)}, ${m2(o.total)} грн, «${h(o.partner)}»)\n`
        + `Потрібна <b>видаткова накладна</b> на: ${h(firstLine(o.entity))}\n\n↩️ Надішліть накладну <b>відповіддю на це повідомлення</b>`,
    }).catch(() => null);
    if (m?.message_id) await db.run(`UPDATE b2b_orders SET fin_pay_msg = ? WHERE id = ?`, [m.message_id, o.id]);
  }

  // Повний збіг документа із закупівлею: покупець, сума, усі товари, № не повторюється.
  async function exactMatch(doc, o) {
    if (!doc || o.kind !== 'supply') return false;
    if (Math.abs((doc.total ?? -1) - o.total) >= 0.01) return false;
    if (!doc.buyer || !sameName(firstLine(o.entity).split(',')[0], doc.buyer)) return false;
    const items = await db.all(`SELECT name, qty, price FROM b2b_order_items WHERE order_id = ?`, [o.id]);
    if (!doc.items?.length || compareItems(doc.items, items).bad) return false;
    const dup = await db.get(`SELECT id FROM b2b_orders WHERE id != ? AND ${doc.kind === 'invoice' ? 'invoice_no' : 'waybill_no'} = ? AND status != 'cancelled' LIMIT 1`, [o.id, doc.number]);
    return !dup;
  }

  // PDF у групі «Фінансові питання».
  async function tgFinFile(msg, base) {
    const chat = String(msg.chat.id);
    const d0 = msg.document;
    if (!d0 || !(/pdf/i.test(d0.mime_type || '') || /\.pdf$/i.test(d0.file_name || ''))) return; // лише PDF
    const s = await loadSettings(db);
    const rm = msg.reply_to_message;
    const replyId = rm?.from?.is_bot && rm.from.username === s.tg_bot ? Number(/B2B-(\d+)/.exec(String(rm.text || rm.caption || ''))?.[1]) || null : null;
    const replyTo = msg.message_id;
    const say = (text) => tgApi('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_to_message_id: replyTo, allow_sending_without_reply: true }).catch(() => 0);
    // без відповіді — лише невеликі файли (обмеження процесорного часу); з відповіддю — до 5 МБ
    if ((d0.file_size || 0) > (replyId ? MAX_FILE : 1024 * 1024)) { if (replyId) await say('Файл завеликий (до 5 МБ).'); return; }
    const bytes = await notify().download(d0.file_id);
    const doc = parseBasDoc(await pdfText(bytes));
    if (!doc) { if (replyId) await say('Не вдалося прочитати рахунок чи накладну з цього PDF. Надішліть його особисто боту або додайте на сайті.'); return; }
    let orderId = replyId;
    let choices = [];
    if (!replyId) {
      // впізнавання за вмістом: лише закупівлі, що чекають саме цей документ, з повним збігом
      const list = (await candidates()).filter((o) => o.kind === 'supply' && needs(o, doc.kind) && (doc.kind !== 'waybill' || o.invoice_no) && score(o, doc, doc.kind) >= 150);
      for (const o of list) if (await exactMatch(doc, o)) choices.push(o.id);
      if (!choices.length) return; // чужий документ — мовчимо
      if (choices.length === 1) orderId = choices[0];
    }
    const r = await db.run(
      `INSERT INTO b2b_tg_docs (chat_id, user_id, file_id, file_uid, name, mime, size, parsed, order_id, kind, number, doc_date, state, created_at, source, reply_to, tg_name, choices)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'fin', ?, ?, ?)`,
      [chat, d0.file_id, d0.file_unique_id || '', d0.file_name || 'document.pdf', 'application/pdf', d0.file_size || bytes.length, JSON.stringify(doc), orderId,
        doc.kind, doc.number, doc.date || kyivToday(), nowIso(), replyTo, tgWho(msg.from).name, JSON.stringify(choices)],
    );
    const d = await docOf(r.lastId);
    // відповідь на запит + повний збіг → зберігаємо одразу
    if (replyId) {
      const o = await orderFull(replyId);
      if (o && o.status !== 'cancelled' && await exactMatch(doc, o)) {
        d.who = tgWho(msg.from);
        await save(d, null, base);
        return;
      }
    }
    await show(d, { fresh: true });
  }

  // Будь-який файл у групі: «Фінансові питання» — документи; група партнера — маркування (лише відповідь боту).
  async function tgGroupMessage(msg, base) {
    if (String(msg.chat.id) === await finChat()) return tgFinFile(msg, base);
    const s = await loadSettings(db);
    if (msg.reply_to_message?.from?.is_bot && msg.reply_to_message.from.username === s.tg_bot) return tgGroupFile(msg, base);
  }

  // Старі незавершені завантаження — прибрати.
  hooks.cleanup = () => db.run(`DELETE FROM b2b_tg_docs WHERE created_at < ?`, [new Date(Date.now() - 3 * 86400000).toISOString()]);
  hooks.afterLabel = afterLabel;
  hooks.crmLinked = crmLinked;
  hooks.finRequest = finRequest;
  hooks.finClosed = finClosed;
  hooks.finNumbers = finNumbers;
  hooks.finPaid = finPaid;

  const linkSpecialGroup = async (code, chat, title) => (await linkLabelsGroup(code, chat, title)) || linkFinGroup(code, chat, title);
  return { tgPrivate, tgCallback, tgGroupMessage, linkSpecialGroup };
}

