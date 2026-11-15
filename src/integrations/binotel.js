// Binotel (телефонія) — REST API 4.0: https://api.binotel.com/api/4.0/<метод>.json, POST JSON з key і secret у тілі.
// Тут — лише журнал дзвінків за період (stats/list-of-calls-for-period, період не довший за 24 год).
export const BINOTEL_API = 'https://api.binotel.com/api/4.0/';
export const BINOTEL_MAX_PERIOD = 86400; // секунд

const s = (v, n = 200) => String(v ?? '').slice(0, n);

export async function binotelRequest(fetchFn, { key, secret }, method, params = {}) {
  let res;
  try {
    res = await fetchFn(`${BINOTEL_API}${method}.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...params, key, secret }),
    });
  } catch (e) {
    if (e.pending) throw e;
    throw Object.assign(new Error('Binotel не відповідає. Спробуйте ще раз за хвилину.'), { status: 502 });
  }
  let j = null;
  try { j = await res.json(); } catch { /* не JSON */ }
  if (!j || j.status !== 'success') {
    const msg = j?.message || (res.status === 401 || res.status === 403 ? 'невірний ключ або секрет' : `помилка ${res.status}`);
    throw Object.assign(new Error(`Binotel: ${msg}`), { status: 400, binotelCode: j?.code ?? res.status });
  }
  return j;
}

// Номер телефону → останні 9 цифр (порівнюємо 0671234567, 380671234567 і +38 067 123-45-67 однаково).
export const phone9 = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
};

// Дзвінок Binotel → { id, ts (unix, с), dir in|out, phone9, disp, billsec, who }.
export function binotelCallRow(c) {
  return {
    id: s(c.generalCallID ?? c.callID, 40),
    ts: Number(c.startTime) || 0,
    dir: String(c.callType) === '1' ? 'out' : 'in',
    phone9: phone9(c.externalNumber),
    disp: s(c.disposition, 20),
    billsec: Number(c.billsec) || 0,
    who: s(c.employeeData?.name || c.internalNumber, 80),
  };
}

// Усі дзвінки (вхідні й вихідні) за [startTime, stopTime] — unix-секунди, не довше 24 год.
export async function binotelCallsForPeriod(fetchFn, cred, startTime, stopTime) {
  const j = await binotelRequest(fetchFn, cred, 'stats/list-of-calls-for-period', { startTime, stopTime });
  const list = Array.isArray(j.callDetails) ? j.callDetails : Object.values(j.callDetails || {});
  return list.map(binotelCallRow).filter((r) => r.id && r.ts);
}
