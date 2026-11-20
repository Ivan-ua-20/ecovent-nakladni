// Маркетплейси → «Створити ТТН» для замовлення Розетки: ROZETKA Delivery, Нова пошта, Meest — через API кабінету продавця
// (ТТН одразу прив'язується до замовлення в Розетці, як у кабінеті). Одержувач і відділення — із замовлення (get-user-info),
// відправник і параметри посилки за замовчуванням — з налаштувань магазину в кабінеті Розетки. Ключ НП нікуди не віддаємо.
import { fail, need } from '../../core/common.js';
import { RZ_TTN, rzTtnPdf, rzCarrierPdf } from '../../integrations/rozetka.js';

export const CARRIERS = { rd: 'ROZETKA Delivery', np: 'Нова пошта', me: 'Meest' };
// Перевізник за назвою служби доставки в замовленні.
export const carrierOf = (delivery) => {
  const s = String(delivery || '').toLowerCase();
  if (/rozetka|розетка/.test(s)) return 'rd';
  if (/нова\s*пошта|nova\s*poshta|новая\s*почта/.test(s)) return 'np';
  if (/meest|міст|мист/.test(s)) return 'me';
  return '';
};
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const parseJ = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || 'null'); } catch { return null; } };
const phone12 = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 && d.startsWith('0') ? `38${d}` : d.length === 9 ? `380${d}` : d; };

export function mountMarketTtn(app, { db, fetchFn, rzCall, accOf, rzOrderOf }) {
  // Дані для вікна: одержувач, відправник, оплата, посилка за замовчуванням, обмеження відділення.
  async function prep(acc, o, carrier) {
    const call = (fn) => rzCall(acc, (t) => fn(fetchFn, t, o.id));
    const callS = (fn) => rzCall(acc, (t) => fn(fetchFn, t));
    const items = parseJ(o.items) || [];
    const descr = str(items.map((i) => i.name).filter(Boolean).join(', '), 100);
    const base = { carrier, carrier_name: CARRIERS[carrier], paid: Boolean(o.paid), pay: [o.pay_type, o.pay_status].filter(Boolean).join(' · '), total: num(o.total), description: descr };
    if (carrier === 'rd') {
      const [ui, st] = await Promise.all([call(RZ_TTN.rdUserInfo), callS(RZ_TTN.rdSettings).catch(() => null)]);
      const s = st?.sender || null;
      const p = (st?.parcels || [])[0] || {};
      const d = ui?.itemDimensions || {};
      const lim = ui?.departmentRestrictions || null;
      return {
        ...base, amount: num(ui?.amount) || base.total,
        recipient: { name: str(ui?.name), phone: str(ui?.phone, 20), place: [ui?.city, [ui?.street, ui?.houseNumber].filter(Boolean).join(' '), ui?.apartmentNumber ? `кв. ${ui.apartmentNumber}` : ''].filter(Boolean).join(', '),
          kind: ui?.departmentType === 2 ? 'поштомат' : ui?.departmentId ? 'відділення' : 'адреса' },
        sender: s?.department ? { name: str(s.name), place: str(s.address || s.city), phone: str((s.phones || [])[0] || '', 20) } : null,
        sender_hint: 'Відправника задають у кабінеті Розетки: ROZETKA Delivery → Налаштування передзаповнення.',
        parcel: { weight: num(p.weight) || num(d.weight) || 1, length: num(p.length) || num(d.length) || 20, width: num(p.width) || num(d.width) || 20, height: num(p.height) || num(d.height) || 20, places: 1, description: str(p.description, 100) || descr },
        limits: lim ? { weight: num(lim.max_weight) || null, cost: num(lim.max_cost) || null, length: num(lim.max_length) || null, width: num(lim.max_width) || null, height: num(lim.max_height) || null } : null,
        cod_allowed: ui?.isReturnMoneyAllowed !== false,
      };
    }
    if (carrier === 'np') {
      const [ui, st, cm] = await Promise.all([call(RZ_TTN.npUserInfo), callS(RZ_TTN.npSettings).catch(() => null), callS(RZ_TTN.npCommon).catch(() => null)]);
      const sel = parseJ(st?.selected_sender) || {};
      const cargo = parseJ(st?.selected_cargo) || st?.cargo || {};
      const ok = Boolean(st?.conterparty?.Ref && st?.sender?.Ref && st?.address?.Ref);
      return {
        ...base, amount: num(ui?.amount) || base.total,
        recipient: { name: str(ui?.name), phone: str(ui?.phone, 20), place: ui?.is_warehouse ? str(ui?.place_number) : [ui?.city_name, ui?.street, ui?.place_house, ui?.place_flat ? `кв. ${ui.place_flat}` : ''].filter(Boolean).join(', '),
          kind: ui?.is_warehouse ? 'відділення' : 'адреса' },
        sender: ok ? { name: str(st.conterparty?.Description || [sel.LastName, sel.FirstName].filter(Boolean).join(' ')), place: str(st.address?.Description), phone: str(sel.Phones, 20) } : null,
        sender_hint: 'Ключ НП і відправника задають у кабінеті Розетки: Налаштування → Нова пошта (ТТН).',
        parcel: { weight: num(cargo.Weight) || 1, length: 20, width: 20, height: 20, places: 1, description: str(cargo.Description && cargo.Description !== 'none' ? cargo.Description : '', 100) || descr },
        payment_control: Boolean(cm?.CanAfterpaymentOnGoodsCost), payment_control_on: Boolean(cm?.CanAfterpaymentOnGoodsCost && st?.is_add_payment_control !== false),
        cod_allowed: true,
      };
    }
    const [ui, st] = await Promise.all([call(RZ_TTN.meUserInfo), callS(RZ_TTN.meSettings).catch(() => null)]);
    const s = parseJ(st?.selected_sender);
    const pc = (parseJ(st?.selected_cargo)?.placesItems || [])[0] || {};
    return {
      ...base, amount: num(ui?.amount) || base.total,
      recipient: { name: str(ui?.name), phone: str(ui?.phone, 20), place: [ui?.city, [ui?.street, ui?.houseNumber].filter(Boolean).join(' ')].filter(Boolean).join(', '), kind: ui?.branchId ? 'відділення' : 'адреса' },
      sender: s?.branchID ? { name: str(s.name), place: 'відділення Meest', phone: str(s.phone, 20) } : null,
      sender_hint: 'Відправника задають у кабінеті Розетки: Налаштування → Meest.',
      parcel: { weight: num(pc.weight) || 1, length: num(pc.length) || 20, width: num(pc.width) || 20, height: num(pc.height) || 20, places: 1, description: descr },
      cod_allowed: true, branch: Boolean(ui?.branchId),
    };
  }

  const loadOrder = async (c, b) => {
    need(c, 'market.edit');
    const o = await rzOrderOf(b, c);
    return { o, acc: await accOf('rozetka', o.account_id) };
  };

  app.get('/api/mp/ttn/prep', async (c) => {
    const { o, acc } = await loadOrder(c, { account: c.req.query('account'), id: c.req.query('id') });
    const carrier = CARRIERS[c.req.query('carrier')] ? c.req.query('carrier') : carrierOf(o.delivery);
    if (!carrier) return c.json({ carrier: '', delivery: o.delivery, carriers: CARRIERS });
    try {
      return c.json({ ...(await prep(acc, o, carrier)), delivery: o.delivery, ttn: o.ttn || '', carriers: CARRIERS });
    } catch (e) {
      if (e.pending) throw e;
      throw fail(400, `${CARRIERS[carrier]}: не вдалося отримати дані замовлення з Розетки (${e.message.replace(/^Розетка:\s*/, '')}). Перевірте, що доставка в замовленні — ${CARRIERS[carrier]} і модуль підключено в кабінеті Розетки.`);
    }
  });

  app.post('/api/mp/ttn/create', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const { o, acc } = await loadOrder(c, b);
    if (o.ttn) throw fail(400, `У замовлення вже є ТТН ${o.ttn}.`);
    if (Number(o.status_group) === 3) throw fail(400, 'Замовлення скасоване — ТТН не створюється.');
    const carrier = CARRIERS[b.carrier] ? b.carrier : carrierOf(o.delivery);
    if (!carrier) throw fail(400, 'Оберіть перевізника.');
    const p = await prep(acc, o, carrier);
    if (!p.sender) throw fail(400, `Не налаштовано відправника. ${p.sender_hint}`);
    const weight = num(b.weight); const length = Math.round(num(b.length)); const width = Math.round(num(b.width)); const height = Math.round(num(b.height));
    const places = Math.max(1, Math.min(20, Math.round(num(b.places) || 1)));
    const declared = Math.round(num(b.declared) || p.amount);
    const cod = Math.max(0, Math.round(num(b.cod)));
    const payer = b.payer === 'recipient' ? 'recipient' : 'sender';
    const description = str(b.description, 100) || p.description || 'Товар';
    if (!(weight >= 0.1) || !(length >= 1) || !(width >= 1) || !(height >= 1)) throw fail(400, 'Вкажіть вагу (від 0,1 кг) і габарити (від 1 см).');
    if (carrier === 'rd' && (weight > 30 || Math.max(length, width, height) > 120)) throw fail(400, 'ROZETKA Delivery: вага до 30 кг, кожна сторона до 120 см.');
    if (p.limits?.weight && weight > p.limits.weight) throw fail(400, `Вага більша за ліміт відділення одержувача (${p.limits.weight} кг).`);
    if (cod && !p.cod_allowed) throw fail(400, 'У відділенні одержувача накладений платіж недоступний.');
    let ttn = '';
    const res = { };
    if (carrier === 'rd') {
      const st = await rzCall(acc, (t) => RZ_TTN.rdSettings(fetchFn, t));
      const s = st.sender;
      const r = await rzCall(acc, (t) => RZ_TTN.rdCreate(fetchFn, t, {
        order_id: Number(o.id), payer, places, description,
        params: { weight, length, width, height, volume: Math.round((length * width * height) / 4000 * 1000) / 1000 },
        sender: { type: s.type, city: s.city, address: s.address, department: s.department, name: s.name, phones: s.phones || [], info: s.info || '' },
        has_paid: !cod, cost: cod, carrier: Number(s.carrier) || 1,
      }));
      ttn = str(r?.ttn || r?.DeliveryTtn?.ttn, 40);
      res.price = num(r?.delivery_price);
    } else if (carrier === 'np') {
      const [ui, st, cm] = await Promise.all([
        rzCall(acc, (t) => RZ_TTN.npUserInfo(fetchFn, t, o.id)), rzCall(acc, (t) => RZ_TTN.npSettings(fetchFn, t)), rzCall(acc, (t) => RZ_TTN.npCommon(fetchFn, t)),
      ]);
      const sel = parseJ(st.selected_sender) || {};
      const control = Boolean(b.payment_control) && Boolean(cm?.CanAfterpaymentOnGoodsCost);
      const recCp = (cm?.recipientCounterParties || [])[0]?.Ref || '';
      const seats = Array.from({ length: places }, () => ({ volumetricWidth: width, volumetricLength: length, volumetricHeight: height, weight: Math.max(1, Math.round(weight / places)) }));
      const body = {
        order_id: Number(o.id), ServiceType: ui.is_warehouse ? 'WarehouseWarehouse' : 'WarehouseDoors', CargoType: 'Parcel',
        Cost: String(declared), Description: description, SeatsAmount: String(places), Weight: String(weight),
        VolumeGeneral: String(Math.max(0.0004, Math.round(((length * width * height) / 1e6) * places * 10000) / 10000)), OptionsSeat: seats,
        PayerType: payer === 'recipient' || (cod && !control) ? 'Recipient' : 'Sender', PaymentMethod: 'Cash',
        Sender: st.conterparty?.Ref, CitySender: st.address?.CityRef, SenderAddress: st.address?.Ref, ContactSender: st.sender?.Ref, SendersPhone: phone12(sel.Phones),
        RecipientsPhone: phone12(ui.phone), InfoRegClientBarcodes: String(o.id),
        CanAfterpaymentOnGoodsCost: control, BackwardDeliveryPayer: 'Recipient',
        ...(cod ? (control ? { AfterpaymentOnGoodsCost: String(cod) } : { BackwardDeliveryMoney: String(cod) }) : {}),
        ...(ui.is_warehouse
          ? { Recipient: recCp, CityRecipient: ui.cityRef, RecipientAddress: ui.warehouseRef, ContactRecipient: str(ui.name) }
          : { NewAddress: '1', RecipientType: 'PrivatePerson', RecipientName: str(ui.name), RecipientCityName: str(ui.city_name), RecipientArea: str(ui.area), RecipientAreaRegions: str(ui.region),
            RecipientAddressName: str(ui.street), RecipientHouse: str(ui.place_house, 20), RecipientFlat: str(ui.place_flat, 20) }),
      };
      const r = await rzCall(acc, (t) => RZ_TTN.npCreate(fetchFn, t, body));
      const d = (r?.data || [])[0] || r?.[0] || r || {};
      if (r && r.success === false) throw fail(400, `Нова пошта: ${[...(r.errors || [])].join('; ') || 'ТТН не створено'}`);
      ttn = str(d.IntDocNumber, 40);
      res.price = num(d.CostOnSite);
    } else {
      const [ui, st] = await Promise.all([rzCall(acc, (t) => RZ_TTN.meUserInfo(fetchFn, t, o.id)), rzCall(acc, (t) => RZ_TTN.meSettings(fetchFn, t))]);
      const s = parseJ(st.selected_sender) || {};
      if (!ui.branchId) throw fail(400, 'Meest: зараз підтримується доставка лише до відділення.');
      const r = await rzCall(acc, (t) => RZ_TTN.meCreate(fetchFn, t, {
        order_id: Number(o.id), payType: 'cash', receiverPay: payer === 'recipient', notation: description,
        ...(cod ? { COD: cod } : {}),
        sender: { name: s.name, phone: s.phone, branchID: s.branchID, service: 'Branch' },
        receiver: { name: str(ui.name), phone: `+${phone12(ui.phone)}`, branchID: ui.branchId, service: 'Branch' },
        placesItems: [{ quantity: places, weight, volume: Math.round(((length * width * height) / 1e6) * 10000) / 10000, insurance: declared, length, width, height }],
      }));
      ttn = str(r?.ttn || r?.DeliveryTtn?.ttn, 40);
      res.price = num(r?.delivery_price);
    }
    if (!ttn) throw fail(502, 'Розетка не повернула номер ТТН — перевірте замовлення в кабінеті Розетки, ТТН могла створитися.');
    await db.run(`UPDATE mp_orders SET ttn = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [ttn, o.account_id, o.id]);
    return c.json({ ok: true, ttn, carrier, price: res.price || null });
  });

  // Наліпка / ТТН (PDF) для створеної ТТН.
  app.get('/api/mp/ttn/label', async (c) => {
    need(c, 'market.view');
    const o = await rzOrderOf({ account: c.req.query('account'), id: c.req.query('id') }, c);
    if (!o.ttn) throw fail(400, 'У замовлення ще немає ТТН.');
    const acc = await accOf('rozetka', o.account_id);
    const carrier = carrierOf(o.delivery) || (/^(RMP|PRM|UNK)-/i.test(o.ttn) ? 'rd' : /^\d{14}$/.test(o.ttn) ? 'np' : 'me');
    const pdf = carrier === 'rd' ? await rzCall(acc, (t) => rzTtnPdf(fetchFn, t, o.ttn)) : await rzCall(acc, (t) => rzCarrierPdf(fetchFn, t, carrier, o.ttn));
    if (!pdf) throw fail(404, 'Розетка не віддала файл ТТН — спробуйте за хвилину або надрукуйте в кабінеті Розетки.');
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="TTN-${o.ttn}.pdf"`, 'Cache-Control': 'no-store' } });
  });
}
