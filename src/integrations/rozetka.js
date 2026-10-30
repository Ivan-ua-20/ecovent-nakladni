// Клієнт API продавця Розетки (https://api-seller.rozetka.com.ua). Лише те, що потрібно для маркування
// ROZETKA Delivery (точки видачі, ТТН «RMP-…», а також «PRM-…» — створені в кабінеті Prom): вхід, друк ТТН (PDF).
// Вхід — логін і пароль кабінету продавця (пароль у base64), токен діє 24 год і продовжується при використанні.
// Помилки приходять з HTTP 200: { success: false, errors: { message, code } }.

export const RZ_API = 'https://api-seller.rozetka.com.ua';
// Коди, після яких треба увійти заново.
const AUTH_CODES = new Set([5401, 6001, 1020]);

const b64 = (s) => {
  const bytes = new TextEncoder().encode(String(s));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const isPdf = (buf) => buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

const rzError = (j) => {
  const e = j?.errors || {};
  const code = Number(e.code) || 0;
  const text = { invalid_credentials: 'потрібно увійти', session_expired: 'сесія закінчилася', incorrect_username_pasword: 'неправильний логін або пароль',
    entity_not_found: 'не знайдено', access_denied: 'немає доступу', error_print_ttn: 'не вдалося надрукувати ТТН' }[e.message] || e.message || 'запит не виконано';
  return Object.assign(new Error(`Розетка: ${text}`), { status: 400, rzCode: code, rzAuth: AUTH_CODES.has(code) });
};

async function send(fetchFn, path, { method = 'GET', token, body } = {}) {
  try {
    return await fetchFn(`${RZ_API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Content-Language': 'uk', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.pending) throw e;
    throw Object.assign(new Error('Розетка не відповідає. Спробуйте ще раз за хвилину.'), { status: 502 });
  }
}

// Вхід: токен і назва магазину.
export async function rzLogin(fetchFn, username, password) {
  const res = await send(fetchFn, '/sites', { method: 'POST', body: { username, password: b64(password) } });
  const j = await res.json().catch(() => null);
  if (!j?.success || !j.content?.access_token) throw rzError(j);
  return { token: j.content.access_token, marketId: String(j.content.market?.id || ''), marketTitle: String(j.content.market?.title || '') };
}

// PDF ТТН ROZETKA Delivery. null — ТТН не з цього магазину (why отримує відповідь Розетки); помилка з rzAuth — потрібен новий вхід.
export async function rzTtnPdf(fetchFn, token, ttn, why = () => {}) {
  const res = await send(fetchFn, '/delivery-rozetka/ttn-print-batch', { method: 'POST', token, body: { track_numbers: [ttn] } });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (isPdf(buf)) return buf;
  let j = null;
  try { j = JSON.parse(new TextDecoder().decode(buf)); } catch { why(`HTTP ${res.status}`); return null; }
  if (!j?.success) {
    const err = rzError(j);
    if (err.rzAuth) throw err;
    why(err.message);
    return null; // entity_not_found / access_denied / error_print_ttn — пробуємо інший магазин
  }
  // На випадок, якщо файл прийде в JSON (base64 або посилання).
  const c = j.content;
  const file = typeof c === 'string' ? c : c?.file || c?.content || c?.base64 || '';
  if (file && !/^https?:/.test(file)) {
    try { const pdf = unb64(file.replace(/^data:[^,]+,/, '')); if (isPdf(pdf)) return pdf; } catch { /* не base64 */ }
  }
  const url = c?.url || c?.link || (/^https?:/.test(file) ? file : '');
  if (url) {
    const r = await fetchFn(url);
    const pdf = new Uint8Array(await r.arrayBuffer());
    if (isPdf(pdf)) return pdf;
  }
  return null;
}
