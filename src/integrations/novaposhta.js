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
