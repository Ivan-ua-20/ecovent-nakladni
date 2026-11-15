// Пошук фіскального чека в Checkbox для визначення ФОП.
// Кожен ФОП — окремий акаунт/каса в Checkbox. Ми перебираємо ФОПи з налаштованим доступом
// і шукаємо чек, у якому згадано номер замовлення, або (запасний варіант) чек на ту саму суму.

const BASE = 'https://api.checkbox.ua/api/v1';
const CLIENT = { 'X-Client-Name': 'nakladni-local', 'X-Client-Version': '0.1' };
const tokens = new Map(); // fopId -> token

async function req(fetchFn, path, { method = 'GET', token, license, body } = {}) {
  const headers = { ...CLIENT, Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (license) headers['X-License-Key'] = license;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetchFn(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) {
    const msg = json?.message || json?.detail || text.slice(0, 200);
    const err = new Error(`Checkbox ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export const hasCheckbox = (fop) =>
  Boolean((fop.checkbox_login && fop.checkbox_password) || (fop.checkbox_license && fop.checkbox_pin));

async function signIn(fetchFn, fop, force = false) {
  if (!force && tokens.has(fop.id)) return tokens.get(fop.id);
  let json;
  if (fop.checkbox_login && fop.checkbox_password) {
    json = await req(fetchFn, '/cashier/signin', {
      method: 'POST',
      body: { login: fop.checkbox_login, password: fop.checkbox_password },
    });
  } else {
    json = await req(fetchFn, '/cashier/signinPinCode', {
      method: 'POST',
      license: fop.checkbox_license,
      body: { pin_code: fop.checkbox_pin },
    });
  }
  const token = json?.access_token;
  if (!token) throw new Error('Checkbox не повернув токен доступу');
  tokens.set(fop.id, token);
  return token;
}

async function authed(fetchFn, fop, path, opts = {}) {
  let token = await signIn(fetchFn, fop);
  try {
    return await req(fetchFn, path, { ...opts, token, license: fop.checkbox_license || undefined });
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      token = await signIn(fetchFn, fop, true);
      return req(fetchFn, path, { ...opts, token, license: fop.checkbox_license || undefined });
    }
    throw e;
  }
}

const parseDate = (s) => {
  if (!s) return new Date();
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

function summarize(receipt, fop, how) {
  return {
    fopId: fop.id,
    fopName: fop.short_name,
    receiptId: receipt.id,
    fiscalCode: receipt.fiscal_code || '',
    date: receipt.fiscal_date || receipt.created_at || '',
    total: receipt.total_sum != null ? receipt.total_sum / 100 : null,
    url: receipt.id ? `https://check.checkbox.ua/${receipt.id}` : '',
    match: how, // 'order' | 'sum' | 'manual'
  };
}

// Пряме посилання: користувач вставив ID чека або фіскальний номер.
export async function findReceiptByRef(fetchFn, fops, ref) {
  const clean = String(ref).trim();
  const uuid = clean.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  const errors = [];
  for (const fop of fops.filter(hasCheckbox)) {
    try {
      if (uuid) {
        const r = await authed(fetchFn, fop, `/receipts/${uuid}`);
        if (r?.id) return { receipt: summarize(r, fop, 'manual'), errors };
      } else {
        const r = await authed(fetchFn, fop, `/receipts/search?fiscal_code=${encodeURIComponent(clean)}&limit=5`);
        const hit = (r?.results || [])[0];
        if (hit) return { receipt: summarize(hit, fop, 'manual'), errors };
      }
    } catch (e) {
      if (e.status !== 404) errors.push(`${fop.short_name}: ${e.message}`);
    }
  }
  return { receipt: null, errors };
}

// Автопошук: чеки за кілька днів від дати замовлення у всіх ФОПів.
export async function findReceiptForOrder(fetchFn, fops, order, { days = 7 } = {}) {
  const errors = [];
  const from = parseDate(order.date);
  from.setDate(from.getDate() - 1);
  const to = new Date(from);
  to.setDate(to.getDate() + Number(days) + 1);
  const orderNo = String(order.orderId);
  const orderNoRe = new RegExp(`(^|\\D)${orderNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\D|$)`);
  const sumMatches = [];

  for (const fop of fops.filter(hasCheckbox)) {
    try {
      let offset = 0;
      for (let page = 0; page < 10; page++) {
        const qs = new URLSearchParams({
          from_date: from.toISOString(),
          to_date: to.toISOString(),
          limit: '100',
          offset: String(offset),
          self_receipts: 'false',
        });
        const r = await authed(fetchFn, fop, `/receipts/search?${qs}`);
        const results = r?.results || [];
        for (const rc of results) {
          const text = [rc.header, rc.footer, rc.barcode, rc.order_id, rc.external_id,
            ...(rc.goods || []).map((g) => `${g.good?.code || ''} ${g.good?.name || ''}`)]
            .filter(Boolean).join(' ');
          if (orderNoRe.test(text)) return { receipt: summarize(rc, fop, 'order'), errors };
          if (rc.type !== 'RETURN' && rc.total_sum != null && Math.abs(rc.total_sum / 100 - order.total) < 0.01) {
            sumMatches.push(summarize(rc, fop, 'sum'));
          }
        }
        if (results.length < 100) break;
        offset += 100;
      }
    } catch (e) {
      errors.push(`${fop.short_name}: ${e.message}`);
    }
  }
  // За сумою приймаємо лише однозначний збіг.
  if (sumMatches.length === 1) return { receipt: sumMatches[0], errors };
  if (sumMatches.length > 1) {
    errors.push(`Знайдено ${sumMatches.length} чеки(ів) на суму ${order.total} грн — оберіть ФОП вручну або вкажіть чек.`);
  }
  return { receipt: null, errors, candidates: sumMatches };
}

export async function testCheckbox(fetchFn, fop) {
  tokens.delete(fop.id);
  const me = await authed(fetchFn, fop, '/cashier/me');
  return { cashier: me?.full_name || '', organization: me?.organization?.title || '' };
}

// Сторінка чеків ФОП за період (до 100, усі каси організації): для звірки «чек ↔ замовлення».
// Повертає { rows, more }. refs — числа з чека (номер замовлення може стояти в шапці, підвалі, коді товару чи order_id).
export async function listReceipts(fetchFn, fop, fromIso, toIso, offset = 0) {
  const qs = new URLSearchParams({ from_date: fromIso, to_date: toIso, limit: '100', offset: String(offset), self_receipts: 'false' });
  const r = await authed(fetchFn, fop, `/receipts/search?${qs}`);
  const results = Array.isArray(r?.results) ? r.results : [];
  const rows = results.map(receiptRow).filter((x) => x.id);
  return { rows, more: results.length >= 100 };
}

// Чек Checkbox → рядок для звірки.
function receiptRow(rc) {
  const text = [rc.header, rc.footer, rc.barcode, rc.order_id, rc.external_id, ...(rc.goods || []).map((g) => g.good?.code || '')].filter(Boolean).join(' ');
  const refs = [...new Set(String(text).match(/\d{5,20}/g) || [])].slice(0, 20).join(' ');
  return {
    id: String(rc.id || ''),
    type: String(rc.type || ''),
    at: String(rc.fiscal_date || rc.created_at || ''),
    total: rc.total_sum != null ? rc.total_sum / 100 : 0,
    fiscal: String(rc.fiscal_code || ''),
    pays: (rc.payments || []).map((p) => ({ type: String(p.type || ''), label: String(p.label || ''), value: p.value != null ? p.value / 100 : 0 })),
    refs,
  };
}

// Один чек за його номером (UUID, як прив'язано в замовленні LP-CRM). null — у цій організації (ФОП) такого чека немає.
export async function getReceipt(fetchFn, fop, id) {
  try {
    const rc = await authed(fetchFn, fop, `/receipts/${encodeURIComponent(id)}`);
    return rc?.id ? receiptRow(rc) : null;
  } catch (e) {
    if (e.pending) throw e;
    if ([400, 403, 404, 422].includes(e.status)) return null;
    throw e;
  }
}
