// B2B «ТТН створює Ековент». Для партнера з увімкненою опцією (b2b_partners.ttn_by_us) замовлення клієнта оформлюється
// без ТТН і маркування: партнер заповнює отримувача — прізвище, ім'я, по батькові, телефон, тип доставки (відділення,
// поштомат, адресна доставка), місто, відділення / поштомат або вулицю, будинок, квартиру — з довідників Нової пошти,
// і суму, яку клієнт платить при отриманні. Перед передачею в LP-CRM адмін натискає «Створити ТТН»: обирає кабінет НП
// (від якої ТОВ), контактну особу, місто й відділення відправки, перевіряє отримувача, ставить контроль оплати —
// і ТТН створюється через API НП (Counterparty.save → Address.save для адреси → InternetDocument.save).
import { fail, need, nowIso, kyivDay } from '../../core/common.js';
import { npDate, npSearchCities, npWarehouses, npStreets, npSenderFull, npCreateRecipient, npCreateAddress, npSaveDocument, npDeleteDocument } from '../../integrations/novaposhta.js';
import { orderNo } from './orders.js';

export const NP_TYPES = { warehouse: 'Відділення', postomat: 'Поштомат', doors: 'Адресна доставка' };
const NAME_RE = /^[А-ЩЬЮЯҐЄІЇа-щьюяґєії'’ʼ-]{2,40}$/u;
const s = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const num = (v) => Math.round((Number(String(v ?? '').replace(',', '.')) || 0) * 100) / 100;
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const h = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Отримувач з форми → перевірені дані (ПІБ українською, як вимагає НП; телефон 380XXXXXXXXX; місто й відділення — з довідника).
export function npRecipientOf(b) {
  const r = b && typeof b === 'object' ? b : {};
  const name = (v) => s(v, 40).replace(/\s+/g, '');
  const last = name(r.last);
  const first = name(r.first);
  const middle = name(r.middle);
  if (!NAME_RE.test(last) || !NAME_RE.test(first)) throw fail(400, 'Вкажіть прізвище й ім’я отримувача українськими літерами (так вимагає Нова пошта).');
  if (middle && !NAME_RE.test(middle)) throw fail(400, 'По батькові — українськими літерами або залиште порожнім.');
  let phone = String(r.phone ?? '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(phone)) phone = `38${phone}`;
  if (!/^380\d{9}$/.test(phone)) throw fail(400, 'Телефон отримувача: 0XXXXXXXXX або 380XXXXXXXXX.');
  const type = NP_TYPES[r.type] ? r.type : '';
  if (!type) throw fail(400, 'Оберіть спосіб доставки: відділення, поштомат чи адресна доставка.');
  const city = r.city && s(r.city.ref, 40) ? { ref: s(r.city.ref, 40), name: s(r.city.name, 200) } : null;
  if (!city) throw fail(400, 'Оберіть населений пункт зі списку Нової пошти.');
  const out = { last, first, middle, phone, type, city, warehouse: null, street: null, house: '', flat: '', cod: Math.max(0, num(r.cod)) };
  if (type === 'doors') {
    if (!r.street || !s(r.street.ref, 40)) throw fail(400, 'Оберіть вулицю зі списку Нової пошти.');
    out.street = { ref: s(r.street.ref, 40), name: s(r.street.name, 200) };
    out.house = s(r.house, 20);
    out.flat = s(r.flat, 20);
    if (!out.house) throw fail(400, 'Вкажіть номер будинку.');
  } else {
    if (!r.warehouse || !s(r.warehouse.ref, 40)) throw fail(400, type === 'postomat' ? 'Оберіть поштомат зі списку.' : 'Оберіть відділення зі списку.');
    out.warehouse = { ref: s(r.warehouse.ref, 40), name: s(r.warehouse.name, 300), number: s(r.warehouse.number, 10) };
  }
  return out;
}
export const npFullName = (r) => [r.last, r.first, r.middle].filter(Boolean).join(' ');
export const npAddressText = (r) => (r ? `${NP_TYPES[r.type]}: ${r.city.name}, ${r.type === 'doors' ? `${r.street.name}, буд. ${r.house}${r.flat ? `, кв. ${r.flat}` : ''}` : r.warehouse.name}` : '');

export function mountB2bNpTtn(app, { db, fetchFn, services = {}, myPartner, orders, hooks }) {
  const { orderOf, log, tgPartner, link } = orders;
  const keyOf = async (account) => {
    if (!services.marking?.npKey) throw fail(400, 'Модуль Нової пошти не підключено.');
    return services.marking.npKey(account);
  };
  const userName = (c) => s(c.get('user')?.name || c.get('user')?.login, 80);
  const defaults = async () => parse((await db.get(`SELECT value FROM settings WHERE key = 'b2b_np_sender'`))?.value) || {};

  // ---------- довідники НП: населені пункти, відділення / поштомати, вулиці ----------
  async function lookup(c, key) {
    const what = c.req.param('what');
    const q = s(c.req.query('q'), 60);
    const city = s(c.req.query('city'), 40);
    if (what === 'cities') return q.length < 2 ? [] : npSearchCities(fetchFn, key, q);
    if (!city) throw fail(400, 'Спершу оберіть населений пункт.');
    if (what === 'warehouses') return npWarehouses(fetchFn, key, city, q, ['warehouse', 'postomat'].includes(c.req.query('kind')) ? c.req.query('kind') : '');
    if (what === 'streets') return q.length < 2 ? [] : npStreets(fetchFn, key, city, q);
    throw fail(404, 'Невідомий довідник.');
  }
  app.get('/api/b2b/p/np/:what', async (c) => {
    const p = await myPartner(c);
    if (!p.ttn_by_us) throw fail(403, 'Ця функція для вас не ввімкнена — зверніться до менеджера.');
    return c.json({ rows: await lookup(c, await keyOf((await defaults()).account)) });
  });
  app.get('/api/b2b/np/:what{cities|warehouses|streets}', async (c) => {
    need(c, 'b2b.admin');
    return c.json({ rows: await lookup(c, await keyOf(Number(c.req.query('account')) || (await defaults()).account)) });
  });

  // Кабінети НП (від якої ТОВ) і контактні особи обраного кабінету + збережені налаштування відправника.
  app.get('/api/b2b/np/senders', async (c) => {
    need(c, 'b2b.admin');
    const accounts = await (services.marking?.npAccounts?.() ?? []);
    if (!accounts.length) throw fail(400, 'Немає підключеного кабінету Нової пошти (Налаштування → Доставка).');
    const def = await defaults();
    const id = Number(c.req.query('account')) || (accounts.some((a) => a.id === def.account) ? def.account : accounts[0].id);
    const sender = await npSenderFull(fetchFn, await keyOf(id));
    return c.json({ accounts, account: id, sender, defaults: def });
  });

  // Позначка «ТТН створює Ековент» у замовленні: без ТТН партнера — отримувач обов'язковий.
  hooks.npRecipient = (p, b, cur = null) => {
    if (!p.ttn_by_us || !b.np || String(b.ttn ?? '').trim()) return null;
    const r = npRecipientOf(b.np);
    if (cur?.np_doc_ref) {
      const was = parse(cur.np_recipient);
      if (JSON.stringify({ ...was, cod: 0 }) !== JSON.stringify({ ...r, cod: 0 })) throw fail(400, 'ТТН уже створено — щоб змінити отримувача, попросіть менеджера видалити ТТН.');
    }
    return r;
  };

  // ---------- створити ТТН ----------
  app.post('/api/b2b/clients/:id/ttn', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind !== 'client') throw fail(404, 'Замовлення не знайдено.');
    if (o.status !== 'new' || o.crm_id) throw fail(400, 'ТТН створюється до передачі в LP-CRM — це замовлення вже передане або скасоване.');
    if (o.ttn) throw fail(400, `У замовленні вже є ТТН ${o.ttn}.`);
    const b = await c.req.json().catch(() => ({}));
    const r = npRecipientOf(b.recipient);
    const snd = b.sender || {};
    if (!s(snd.ref, 40) || !s(snd.contact, 40)) throw fail(400, 'Оберіть кабінет і контактну особу відправника.');
    let sPhone = String(snd.phone ?? '').replace(/\D/g, '');
    if (/^0\d{9}$/.test(sPhone)) sPhone = `38${sPhone}`;
    if (!/^380\d{9}$/.test(sPhone)) throw fail(400, 'Телефон відправника: 0XXXXXXXXX або 380XXXXXXXXX.');
    if (!s(snd.city?.ref, 40) || !s(snd.warehouse?.ref, 40)) throw fail(400, 'Оберіть місто й відділення відправки.');
    const pc = b.parcel || {};
    const weight = num(pc.weight);
    const seats = Math.max(1, Math.min(20, parseInt(pc.seats, 10) || 1));
    const cost = Math.round(num(pc.cost));
    const description = s(pc.description, 100) || 'Кліматична техніка';
    const dims = ['length', 'width', 'height'].map((k) => Math.round(num(pc[k])));
    const hasDims = dims.every((x) => x > 0);
    if (!(weight > 0)) throw fail(400, 'Вкажіть вагу відправлення, кг.');
    if (!(cost >= 1)) throw fail(400, 'Вкажіть оголошену вартість, грн.');
    if (r.type === 'postomat') {
      if (!hasDims) throw fail(400, 'Для поштомата вкажіть розміри (довжина × ширина × висота, см).');
      if (seats > 1) throw fail(400, 'У поштомат — лише одне місце.');
      if (weight > 20) throw fail(400, 'У поштомат — до 20 кг.');
    }
    const payer = b.payer === 'Sender' ? 'Sender' : 'Recipient';
    const control = Math.max(0, num(b.control));
    const account = Number(b.account) || 0;
    const key = await keyOf(account);
    // Захист від подвійного натискання.
    const now = nowIso();
    const stale = new Date(Date.now() - 2 * 60e3).toISOString();
    const claim = await db.run(`UPDATE b2b_orders SET np_meta = ? WHERE id = ? AND ttn = '' AND (np_meta NOT LIKE 'creating:%' OR np_meta < ?)`, [`creating:${now}`, o.id, `creating:${stale}`]);
    if (!claim.changes) throw fail(409, 'ТТН уже створюється — оновіть сторінку за хвилину.');
    let doc;
    try {
      const rec = await npCreateRecipient(fetchFn, key, r);
      const recAddress = r.type === 'doors' ? await npCreateAddress(fetchFn, key, { counterparty: rec.ref, street: r.street.ref, house: r.house, flat: r.flat }) : r.warehouse.ref;
      const [L, W, H] = dims;
      const props = {
        PayerType: payer, PaymentMethod: payer === 'Sender' ? 'NonCash' : 'Cash', DateTime: npDate(kyivDay()), CargoType: 'Parcel',
        Weight: String(weight), SeatsAmount: String(seats), ServiceType: r.type === 'doors' ? 'WarehouseDoors' : 'WarehouseWarehouse',
        Description: description, Cost: String(cost),
        CitySender: s(snd.city.ref, 40), Sender: s(snd.ref, 40), SenderAddress: s(snd.warehouse.ref, 40), ContactSender: s(snd.contact, 40), SendersPhone: sPhone,
        CityRecipient: r.city.ref, Recipient: rec.ref, RecipientAddress: recAddress, ContactRecipient: rec.contact, RecipientsPhone: r.phone,
        InfoRegClientBarcodes: orderNo(o.id),
        ...(control > 0 ? { AfterpaymentOnGoodsCost: String(control) } : {}),
        ...(hasDims ? {
          VolumeGeneral: String(Math.round(((L * W * H) / 1e6) * seats * 10000) / 10000),
          OptionsSeat: Array.from({ length: seats }, () => ({ volumetricVolume: String(Math.round(((L * W * H) / 4000) * 100) / 100), volumetricWidth: String(W), volumetricLength: String(L), volumetricHeight: String(H), weight: String(Math.round((weight / seats) * 100) / 100) })),
        } : {}),
      };
      doc = await npSaveDocument(fetchFn, key, props);
    } catch (e) {
      await db.run(`UPDATE b2b_orders SET np_meta = '' WHERE id = ?`, [o.id]);
      if (e.pending) throw e;
      await log(o.id, c.get('user'), `ТТН не створено: ${String(e.message).slice(0, 300)}`);
      throw e.status ? e : fail(502, e.message);
    }
    const meta = { cost: doc.cost, estimated: doc.estimated, control, payer, account, sender: s(snd.name, 120), contact: s(snd.contactName, 120), weight, seats, declared: cost, by: userName(c), at: nowIso() };
    await db.run(`UPDATE b2b_orders SET ttn = ?, np_doc_ref = ?, np_account = ?, np_meta = ?, np_recipient = ?, client_name = ?, client_phone = ?, updated_at = ? WHERE id = ?`,
      [doc.ttn, doc.ref, account || null, JSON.stringify(meta), JSON.stringify(r), npFullName(r), r.phone, nowIso(), o.id]);
    await log(o.id, c.get('user'), `створено ТТН ${doc.ttn} (Нова пошта, ${npAddressText(r)}${control ? `, контроль оплати ${control} грн` : ''}${doc.cost ? `, доставка ${doc.cost} грн` : ''})`);
    if (b.remember !== false) {
      await db.run(`INSERT INTO settings (key, value) VALUES ('b2b_np_sender', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [JSON.stringify({ account, contact: s(snd.contact, 40), city: snd.city, warehouse: snd.warehouse, payer, description, weight, length: L0(dims, 0), width: L0(dims, 1), height: L0(dims, 2) })]);
    }
    await tgPartner(o.partner_id, `📦 Замовлення ${orderNo(o.id)} (${h(npFullName(r))}): створено ТТН <b>${doc.ttn}</b> — ${h(npAddressText(r))}.\n${link(c, `pclients/${o.id}`)}`).catch(() => 0);
    return c.json({ ok: true, ttn: doc.ttn, cost: doc.cost, estimated: doc.estimated });
  });
  const L0 = (d, i) => (d[i] > 0 ? d[i] : '');

  // Видалити ТТН (до передачі в LP-CRM): в НП — InternetDocument.delete, у замовленні — ТТН очищується.
  app.delete('/api/b2b/clients/:id/ttn', async (c) => {
    need(c, 'b2b.admin');
    const o = await orderOf(c.req.param('id'));
    if (o.kind !== 'client' || !o.np_doc_ref) throw fail(400, 'У цьому замовленні немає ТТН, створеної через сервіс.');
    if (o.status !== 'new' || o.crm_id) throw fail(400, 'Замовлення вже передане в LP-CRM — ТТН видаляйте в кабінеті Нової пошти.');
    // force — ТТН уже видалили в кабінеті НП (або НП її не знаходить): лише прибрати із замовлення, щоб створити нову.
    const force = c.req.query('force') === '1';
    if (!force) {
      try { await npDeleteDocument(fetchFn, await keyOf(o.np_account), o.np_doc_ref); }
      catch (e) {
        if (e.pending || e.status !== 400) throw e;
        throw Object.assign(fail(409, `${e.message}. Якщо ТТН ${o.ttn} уже видалено в кабінеті Нової пошти — її можна просто прибрати із замовлення.`), { extra: { can_force: true } });
      }
    }
    await db.run(`UPDATE b2b_orders SET ttn = '', np_doc_ref = '', np_meta = '', updated_at = ? WHERE id = ?`, [nowIso(), o.id]);
    await log(o.id, c.get('user'), force ? `ТТН ${o.ttn} прибрано із замовлення (у Новій пошті її вже видалено)` : `видалено ТТН ${o.ttn}`);
    return c.json({ ok: true });
  });
}
