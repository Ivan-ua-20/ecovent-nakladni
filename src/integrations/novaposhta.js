// Клієнт API Нової пошти 2.0 (https://api.novaposhta.ua/v2.0/json/). Лише те, що потрібно для маркування:
// перевірка ключа (відправник кабінету), список ТТН кабінету за день, PDF маркування 100×100.
// API 2.0 завжди відповідає HTTP 200 — помилки приходять у { success: false, errors: [...] }.

export const NP_API = 'https://api.novaposhta.ua/v2.0/json/';
export const NP_PRINT = 'https://my.novaposhta.ua/orders/printMarking100x100';

export async function npCall(fetchFn, apiKey, modelName, calledMethod, methodProperties = {}) {
  let res;
  try {
    res = await fetchFn(NP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, modelName, calledMethod, methodProperties }),
    });
  } catch (e) {
    if (e.pending) throw e;
    throw Object.assign(new Error('Нова пошта не відповідає. Спробуйте ще раз за хвилину.'), { status: 502 });
  }
  const j = await res.json().catch(() => null);
  if (!j) throw Object.assign(new Error(`Нова пошта: помилка ${res.status}`), { status: 502 });
  if (!j.success) {
    const msg = [...(j.errors || []), ...(j.warnings || [])].filter((x) => typeof x === 'string').join('; ');
    throw Object.assign(new Error(`Нова пошта: ${msg || 'запит не виконано'}`), { status: 400, npErrors: j.errorCodes || [] });
  }
  return Array.isArray(j.data) ? j.data : [];
}

// Хто відправник у кабінеті (для перевірки ключа і підпису кабінету).
export async function npSender(fetchFn, apiKey) {
  const list = await npCall(fetchFn, apiKey, 'Counterparty', 'getCounterparties', { CounterpartyProperty: 'Sender', Page: '1' });
  const s = list[0] || {};
  return { name: String(s.Description || s.CounterpartyFullName || '').trim(), code: String(s.EDRPOU || '').trim() };
}

// «2026-10-21» → «21.10.2026» (формат дат API 2.0)
export const npDate = (day) => day.split('-').reverse().join('.');
// Останні 9 цифр телефону — однаково для «+380 67…», «067…» і «38067…».
export const phone9 = (p) => String(p || '').replace(/\D/g, '').slice(-9);

// Одна сторінка ТТН кабінету, створених за день. Повертає лише потрібні поля.
export async function npDocumentsPage(fetchFn, apiKey, day, page) {
  const list = await npCall(fetchFn, apiKey, 'InternetDocument', 'getDocumentList', {
    DateTimeFrom: npDate(day), DateTimeTo: npDate(day), Page: String(page), GetFullList: '0',
  });
  return list.map((d) => ({
    ttn: String(d.IntDocNumber || '').trim(),
    phone: phone9(d.RecipientsPhone || d.RecipientContactPhone || d.PhoneRecipient || ''),
    orderRef: String(d.InfoRegClientBarcodes || d.ClientBarcode || '').trim(),
    recipient: String(d.RecipientContactPerson || d.RecipientDescription || '').trim().slice(0, 120),
    service: String(d.ServiceType || '').trim().slice(0, 40),
  })).filter((d) => /^\d{10,20}$/.test(d.ttn));
}

// Тип доставки ТТН («DoorsWarehouse», «WarehouseWarehouse»…) — з відстеження відправлення ключем кабінету-відправника.
export async function npServiceType(fetchFn, apiKey, ttn) {
  const list = await npCall(fetchFn, apiKey, 'TrackingDocument', 'getStatusDocuments', { Documents: [{ DocumentNumber: ttn, Phone: '' }] });
  return String(list[0]?.ServiceType || '').trim().slice(0, 40);
}
// Статус відправлення для відстеження (з телефоном отримувача НП віддає повні дані, без нього — основне).
export async function npTracking(fetchFn, apiKey, ttn, phone = '') {
  const list = await npCall(fetchFn, apiKey, 'TrackingDocument', 'getStatusDocuments', { Documents: [{ DocumentNumber: ttn, Phone: phone }] });
  const d = list[0] || {};
  return {
    status: String(d.Status || '').trim().slice(0, 200),
    code: String(d.StatusCode || ''),
    city: String(d.CityRecipient || '').trim().slice(0, 80),
    warehouse: String(d.WarehouseRecipient || '').trim().slice(0, 160),
    scheduled: String(d.ScheduledDeliveryDate || '').trim().slice(0, 30),
    received: String(d.RecipientDateTime || '').trim().slice(0, 30),
    // ЕН, створена на основі цієї (повернення, переадресація), і її тип.
    basis: String(d.LastCreatedOnTheBasisNumber || '').trim().slice(0, 40),
    basisType: String(d.LastCreatedOnTheBasisDocumentType || '').trim().slice(0, 40),
  };
}
// Адресний (кур'єрський) забір: відправлення забирає кур'єр НП з адреси відправника — тип доставки «Doors…».
export const isDoorPickup = (service) => /^Doors/i.test(String(service || ''));

// PDF маркування 100×100. Повертає байти PDF або null, якщо ТТН не з цього кабінету (НП віддає не PDF).
export async function npMarkingPdf(fetchFn, apiKey, ttn) {
  const res = await fetchFn(`${NP_PRINT}/orders[]/${encodeURIComponent(ttn)}/type/pdf/apiKey/${encodeURIComponent(apiKey)}`);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const isPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF
  return isPdf ? buf : null;
}

// Дата НП («2026-10-31 12:10:00», «31.10.2026 12:10:00» або «31-10-2026 12:10:00» — так у відстеженні) → «2026-10-31T12:10:00»; інакше порожньо.
export function npDateIso(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:00`;
  m = /^(\d{2})[.-](\d{2})[.-](\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00` : '';
}
// Відстеження до 100 ТТН одним запитом. docs: [{ ttn, phone }] (телефон відправника або отримувача дає повні дані).
// Повертає Map ТТН → { code, status, city, warehouse, created, arrived, received, paidFrom, storage, basis, basisType, recipient, recipientPhone, cargo, cost, cod }.
export async function npTrackMany(fetchFn, apiKey, docs) {
  const list = await npCall(fetchFn, apiKey, 'TrackingDocument', 'getStatusDocuments', {
    Documents: docs.slice(0, 100).map((d) => ({ DocumentNumber: d.ttn, Phone: d.phone ? (String(d.phone).length === 9 ? `380${d.phone}` : String(d.phone)) : '' })),
  });
  const s = (v, n = 200) => String(v ?? '').trim().slice(0, n);
  const n = (v) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : 0; };
  const out = new Map();
  for (const d of list) {
    const ttn = s(d.Number, 40);
    if (!ttn) continue;
    out.set(ttn, {
      code: Number(d.StatusCode) || 0, status: s(d.Status), city: s(d.CityRecipient, 80), warehouse: s(d.WarehouseRecipient, 160),
      created: npDateIso(d.DateCreated), arrived: npDateIso(d.ActualDeliveryDate), received: npDateIso(d.RecipientDateTime), paidFrom: npDateIso(d.DatePayedKeeping),
      storage: n(d.StorageAmount), basis: s(d.LastCreatedOnTheBasisNumber, 40), basisType: s(d.LastCreatedOnTheBasisDocumentType, 40),
      recipient: s(d.RecipientFullName || d.RecipientFullNameEW, 120), recipientPhone: s(d.PhoneRecipient, 20),
      cargo: s(d.CargoDescriptionString, 200), cost: n(d.AnnouncedPrice), cod: n(d.AfterpaymentOnGoodsCost) || n(d.RedeliverySum),
    });
  }
  return out;
}

// Контактні особи кабінету (відправника): хто й на який номер може забрати повернення. Два запити.
export async function npContacts(fetchFn, apiKey) {
  const cp = (await npCall(fetchFn, apiKey, 'Counterparty', 'getCounterparties', { CounterpartyProperty: 'Sender', Page: '1' }))[0] || {};
  if (!cp.Ref) return { code: '', persons: [] };
  const list = await npCall(fetchFn, apiKey, 'Counterparty', 'getCounterpartyContactPersons', { Ref: cp.Ref, Page: '1' });
  return {
    code: String(cp.EDRPOU || '').trim(),
    persons: list.map((p) => ({ name: String(p.Description || [p.LastName, p.FirstName, p.MiddleName].filter(Boolean).join(' ')).trim().slice(0, 120), phone: phone9(p.Phones || '') }))
      .filter((p) => p.name || p.phone).slice(0, 10),
  };
}
// Вхідні посилки кабінету (ми — отримувач) за період, сторінка до 100. Службові «плечі» (переадресація, повернення НП)
// мають непорожній owner (OwnerDocumentType). Повертає [] на порожній сторінці.
export async function npIncomingPage(fetchFn, apiKey, fromDay, toDay, page) {
  const data = await npCall(fetchFn, apiKey, 'InternetDocument', 'getIncomingDocumentsByPhone', {
    DateTimeFrom: npDate(fromDay), DateTimeTo: npDate(toDay), Page: String(page),
  });
  const rows = Array.isArray(data[0]?.result) ? data[0].result : Array.isArray(data) && data[0]?.Number ? data : [];
  const s = (v, n = 200) => String(v ?? '').trim().slice(0, n);
  return rows.map((d) => ({
    ttn: s(d.Number, 40), code: Number(d.TrackingStatusCode) || 0, status: s(d.TrackingStatusName), owner: s(d.OwnerDocumentType, 40),
    sender: s(d.SenderName || d.CounterpartySenderDescription, 120), senderOrg: s(d.CounterpartySenderDescription, 120),
    phone: phone9(d.PhoneSender || d.SenderPhone || d.SendersPhone || d.CounterpartySenderPhone || ''), cargo: s(d.CargoDescription || d.CargoDescriptionString),
    created: npDateIso(d.DateTime || d.CreateTime || d.DateCreated), arrived: npDateIso(d.ArrivalDateTime), received: npDateIso(d.ReceivingDateTime),
  })).filter((d) => /^\d{10,20}$/.test(d.ttn));
}
