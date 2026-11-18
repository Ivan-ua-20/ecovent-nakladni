// Вебінтерфейс LP-CRM (не API): лише читання номерів чеків Checkbox, прив'язаних до замовлень.
// API LP-CRM номера чека не віддає, а список замовлень сайту — віддає (cash_register_data), тому входимо окремим
// користувачем LP-CRM і читаємо цей список пачками. Нічого в LP-CRM не змінюємо.
// Без доступу до бази: сесію (cookie) зберігає модуль, що викликає.

const base = (sub) => `https://${sub}.lp-crm.biz`;
// Захист Cloudflare перед сайтом LP-CRM відсікає запити «не з браузера» (403 «administrative rules»), тому заголовки — як у Chrome.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const browser = (sub, extra = {}) => ({
  'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8', Origin: base(sub), ...extra,
});
const ajax = (sub, referer, cookie) => browser(sub, {
  Accept: 'application/json, text/javascript, */*; q=0.01', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest', Referer: referer, ...(cookie ? { Cookie: cookie } : {}),
});
// Відмова захисту сайту (не LP-CRM): пароль не перевірявся, капчею не загрожує — модуль не робить довгої паузи.
const blocked = (res, text, step) => (res.status === 403 || res.status === 429 || res.status === 503) && !/^\d:/.test(text)
  ? Object.assign(new Error(`захист сайту LP-CRM не пропустив запит (${step}, відповідь ${res.status}${/administrative rules/i.test(text) ? ': administrative rules' : ''})`), { blocked: true })
  : null;

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
  const { Origin: _o, ...page } = browser(sub);
  const first = await fetchFn(`${base(sub)}/`, { headers: page, redirect: 'manual' });
  let cookie = mergeCookies('', first);
  const firstText = await first.text().catch(() => '');
  const b0 = blocked(first, firstText, 'сторінка входу');
  if (b0) throw b0;
  const body = new URLSearchParams({ login, pass, REQUEST_URI: `${base(sub)}/`, HTTP_REFERER: `${base(sub)}/`, op: 'login' });
  const res = await fetchFn(`${base(sub)}/login`, {
    method: 'POST', redirect: 'manual', body: body.toString(),
    headers: ajax(sub, `${base(sub)}/`, cookie),
  });
  cookie = mergeCookies(cookie, res);
  const text = (await res.text().catch(() => '')).trim();
  const b1 = blocked(res, text, 'вхід');
  if (b1) throw b1;
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
    headers: ajax(sub, `${base(sub)}/orders`, cookie),
  });
  const text = await res.text().catch(() => '');
  const b2 = blocked(res, text, 'список замовлень');
  if (b2) throw b2;
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
