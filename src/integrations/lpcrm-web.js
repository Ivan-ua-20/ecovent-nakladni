// Вебінтерфейс LP-CRM (не API): лише читання номерів чеків Checkbox, прив'язаних до замовлень.
// API LP-CRM номера чека не віддає, а список замовлень сайту — віддає (cash_register_data), тому входимо окремим
// користувачем LP-CRM і читаємо цей список пачками. Нічого в LP-CRM не змінюємо.
// Без доступу до бази: сесію (cookie) зберігає модуль, що викликає.

const base = (sub) => `https://${sub}.lp-crm.biz`;
const UA = 'Mozilla/5.0 (compatible; EcoventChecks/1.0)';

// Cookie з відповіді: «назва=значення» без атрибутів, злиті з уже наявними.
export function mergeCookies(prev, res) {
  const jar = new Map(String(prev || '').split(/;\s*/).filter(Boolean).map((p) => [p.split('=')[0], p]));
  const list = typeof res?.headers?.getSetCookie === 'function' ? res.headers.getSetCookie()
    : String(res?.headers?.get?.('set-cookie') || '').split(/,(?=\s*[A-Za-z0-9_-]+=)/).filter(Boolean);
  for (const line of list) {
    const pair = String(line).split(';')[0].trim();
    const name = pair.split('=')[0];
    if (!name) continue;
    if (/=(deleted)?$/.test(pair)) jar.delete(name); else jar.set(name, pair);
  }
  return [...jar.values()].join('; ');
}

// Вхід. Повертає cookie сесії. Помилка — з текстом LP-CRM (після кількох невдалих спроб LP-CRM вимагає капчу,
// тому модуль після помилки не пробує знову кілька годин).
export async function lpWebLogin(fetchFn, sub, login, pass) {
  if (!sub || !login || !pass) throw Object.assign(new Error('Не вказано логін або пароль LP-CRM.'), { auth: true });
  const first = await fetchFn(`${base(sub)}/`, { headers: { 'User-Agent': UA }, redirect: 'manual' });
  let cookie = mergeCookies('', first);
  await first.text().catch(() => '');
  const body = new URLSearchParams({ login, pass, REQUEST_URI: `${base(sub)}/`, HTTP_REFERER: `${base(sub)}/`, op: 'login' });
  const res = await fetchFn(`${base(sub)}/login`, {
    method: 'POST', redirect: 'manual', body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': UA, Referer: `${base(sub)}/`, ...(cookie ? { Cookie: cookie } : {}) },
  });
  cookie = mergeCookies(cookie, res);
  const text = (await res.text().catch(() => '')).trim();
  if (text !== 'true') {
    const msg = text.includes(':') ? text.slice(text.indexOf(':') + 1) : text;
    const clean = msg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    throw Object.assign(new Error(`LP-CRM не пустила: ${clean || `відповідь ${res.status}`}`), { auth: true });
  }
  if (!cookie) throw Object.assign(new Error('LP-CRM не повернула сесію після входу.'), { auth: true });
  return cookie;
}

// Чеки до замовлень за внутрішніми номерами LP-CRM (id, до ~150 за раз).
// Повертає { byCode: { <код замовлення>: [{ uuid, type, action, at }] }, seen: [id, …] } або кидає { expired: true }, якщо сесія скінчилась.
export async function lpWebReceipts(fetchFn, sub, cookie, ids) {
  const body = ['status=0', 'mode=point', ...ids.map((id) => `ids%5B%5D=${encodeURIComponent(id)}`)].join('&');
  const res = await fetchFn(`${base(sub)}/getOrdersPage?m=point&s=on&c=miss&n=${ids.length}&i=${encodeURIComponent(ids[0] || '')}`, {
    method: 'POST', redirect: 'manual', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': UA, Referer: `${base(sub)}/orders`, Cookie: cookie },
  });
  const text = await res.text().catch(() => '');
  let j = null;
  try { j = JSON.parse(text); } catch { /* не JSON — сторінка входу */ }
  if (!j || typeof j !== 'object' || !('array' in j)) throw Object.assign(new Error('Сесія LP-CRM завершилась.'), { expired: true });
  const byCode = {};
  for (const [code, list] of Object.entries(j.cash_register_data || {})) {
    const rows = (Array.isArray(list) ? list : Object.values(list || {}))
      .filter((x) => x && x.uuid && String(x.is_test) !== '1')
      .map((x) => ({ uuid: String(x.uuid).toLowerCase(), type: String(x.type || ''), action: String(x.action_type || ''), at: String(x.date_add || '') }));
    if (rows.length) byCode[String(code)] = rows;
  }
  const seen = (Array.isArray(j.array) ? j.array : []).map((o) => String(o.id || '')).filter(Boolean);
  return { byCode, seen, mergeCookie: (c) => mergeCookies(c, res) };
}

// Головний чек продажу: найпізніший «продаж» (action_type 1), інакше найпізніший чек післяплати / передоплати.
export function mainReceipt(rows) {
  const sells = (rows || []).filter((r) => r.action !== '2');
  const pick = (list) => list.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  return pick(sells.filter((r) => r.type === 'sell' || !r.type)) || pick(sells) || null;
}
