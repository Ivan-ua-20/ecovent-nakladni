// Правила вкладки «Перевірка»: чисті функції без бази й запитів — легко перевіряти тестами.
//
// Що звіряємо для кожного відправленого замовлення LP-CRM:
//  1) вид оплати в CRM ↔ наложка в ТТН (Нова пошта: «Контроль оплати» або «Грошовий переказ»; ROZETKA Delivery — сума
//     накладеного платежу): післяплата — наложка має бути і на суму замовлення; передоплата — наложки бути не повинно;
//  1б) Prom: Пром-оплата отримана / оплата при отриманні — проти виду оплати в CRM (ТТН «PRM-…» — лише так);
//  2) чек Checkbox: є, на суму замовлення, спосіб оплати в чеку відповідає виду оплати, ФОП чека — як за відділом / полем 1;
//  3) оплата на рахунок (Opendatabot): гроші прийшли на того ж ФОП, на кого чек (ТТН може бути від іншого ФОП — це не помилка);
//  4) дублі: та сама ТТН у кількох замовленнях; той самий телефон, обидва замовлення відправлені за кілька днів.

// Класи видів оплати:
//  cod    — післяплата: у ТТН має бути наложка на суму замовлення (або суму мінус передоплата з коментаря);
//  prepay — оплата через сервіс (RozetkaPay, Пром-оплата, онлайн): у ТТН наложки бути не повинно;
//  bank   — оплата на рахунок / картку ФОП: наложки бути не повинно, надходження шукаємо в Opendatabot;
//  skip   — не перевіряти (обмін, повернення коштів, готівка при самовивозі тощо).
export const CLASSES = { cod: 'Післяплата', prepay: 'Оплата через сервіс', bank: 'Оплата на рахунок ФОП', skip: 'Не перевіряти' };

// Види оплат LP-CRM (як у «Налаштування → Оплата») і що очікуємо. cb — слово, яке має бути в способі оплати чека
// (як налаштовано в модулі Checkbox LP-CRM: NovaPay, RozetkaPay, mono, LiqPay, Картка, Готівка, еквайринг).
export const PAY_DEFAULTS = {
  4: { name: 'Післяплата', cls: 'cod' },
  9: { name: 'Оплата готівкою', cls: 'skip', cb: 'Готівка' },
  6: { name: 'Оплата на картку', cls: 'bank', cb: 'Картка' },
  2: { name: 'Передоплата', cls: 'bank' },
  7: { name: 'Передоплата на картку', cls: 'bank', cb: 'LiqPay' },
  10: { name: 'Пром-оплата', cls: 'prepay', cb: 'RozetkaPay' },
  11: { name: 'Онлайн-оплата', cls: 'prepay', cb: 'mono' },
  12: { name: 'OLX доставка', cls: 'prepay' },
  1: { name: 'Оплачено', cls: 'prepay' }, // загальний «оплачено» (RozetkaPay, mono, NovaPay…) — спосіб оплати в чеку не звіряємо
  8: { name: 'Повернення коштів', cls: 'skip' },
  5: { name: 'Обмін', cls: 'skip' },
  3: { name: 'POS-термінал', cls: 'skip' },
  13: { name: 'Передоплата отримана', cls: 'bank' },
  14: { name: 'RozetkaPay', cls: 'prepay', cb: 'RozetkaPay' },
  15: { name: 'Післяплата Rozetka', cls: 'cod', cb: 'RozetkaPay' },
  16: { name: 'Післяплата NovaPay', cls: 'cod', cb: 'NovaPay' },
  17: { name: 'Післяплата Укрпошта', cls: 'cod' },
  18: { name: 'Післяплата Meest', cls: 'cod' },
  19: { name: 'Apple Pay', cls: 'prepay' },
  20: { name: 'Google Pay', cls: 'prepay' },
  21: { name: 'Mastercard', cls: 'prepay' },
  22: { name: 'VISA', cls: 'prepay' },
  23: { name: 'PayPal', cls: 'prepay' },
  24: { name: 'ПРОСТІР', cls: 'prepay' },
  25: { name: 'Кредит', cls: 'prepay' },
  26: { name: 'Оплата частинами', cls: 'prepay' },
  27: { name: 'Розстрочка', cls: 'prepay' },
  28: { name: 'Portmone', cls: 'prepay' },
  29: { name: 'whitepay', cls: 'prepay' },
  30: { name: 'LiqPay', cls: 'prepay', cb: 'LiqPay' },
  31: { name: 'Приват24', cls: 'bank' },
  32: { name: 'ПриватБанк', cls: 'bank' },
  33: { name: 'Western Union', cls: 'bank' },
  34: { name: 'monobank', cls: 'bank' },
  35: { name: 'Ощадбанк', cls: 'bank' },
  36: { name: 'UKRSIBBANK', cls: 'bank' },
  37: { name: 'Укрексімбанк', cls: 'bank' },
  38: { name: 'Укргазбанк', cls: 'bank' },
  39: { name: 'Креді Агріколь Банк', cls: 'bank' },
  40: { name: 'Південний', cls: 'bank' },
  41: { name: 'Universal Bank', cls: 'bank' },
  42: { name: 'ПУМБ', cls: 'bank' },
  43: { name: 'Forward Bank', cls: 'bank' },
  44: { name: 'абанк', cls: 'bank' },
  45: { name: 'Raiffeisen Bank', cls: 'bank' },
  46: { name: 'OTP Bank', cls: 'bank' },
  47: { name: 'sense bank', cls: 'bank' },
};

// Налаштування з бази (лише змінені поля) поверх типових.
export function payRules(saved = {}) {
  const out = {};
  for (const [id, d] of Object.entries(PAY_DEFAULTS)) out[id] = { ...d, ...(saved[id] || {}) };
  for (const [id, d] of Object.entries(saved)) if (!out[id] && d && CLASSES[d.cls]) out[id] = { name: d.name || `Оплата ${id}`, cls: d.cls, cb: d.cb || '' };
  return out;
}

// Служба доставки за номером ТТН: Нова пошта — 14 цифр (20…, 59…), ROZETKA Delivery — «RMP-…», Prom — «PRM-…», Meest — інше.
export function carrierOf(ttn, delivery = '') {
  const t = String(ttn || '').replace(/\s/g, '').toUpperCase();
  if (!t) return '';
  if (/^\d{14}$/.test(t)) return 'np';
  if (/^RMP-/.test(t)) return 'rd';
  if (/^PRM-/.test(t)) return 'prm';
  if (/meest|міст/i.test(delivery)) return 'meest';
  if (/укрпошт/i.test(delivery)) return 'up';
  return 'other';
}
export const CARRIERS = { np: 'Нова пошта', rd: 'Розетка Делівері', prm: 'Prom (Розетка Делівері)', meest: 'Meest', up: 'Укрпошта', other: 'Інша служба' };

// Передоплата з коментаря менеджера: «передоплата 500», «аванс 1 000 грн», «часткова оплата 300». null — суми не видно.
const PART_RE = /(передоплат|предоплат|частков|аванс|завдат)/i;
export function partialOf(comment) {
  const c = String(comment || '');
  if (!PART_RE.test(c)) return null;
  const m = c.match(/(?:передоплат|предоплат|частков\S*\s+оплат|аванс|завдат)\S*\D{0,12}?(\d[\d\s]{0,7}(?:[.,]\d{1,2})?)/i);
  const sum = m ? Number(m[1].replace(/\s/g, '').replace(',', '.')) : 0;
  return { sum: sum > 0 ? sum : 0 };
}

// Чек, пробитий вручну в Checkbox: стандартний UUID v4 (його генерує Checkbox). Автофіскалізація LP-CRM генерує свої номери
// нестандартного формату (напр. 6d8d1213-807b-2b2d-96c9-…). Перевірено на чеках, прив'язаних у LP-CRM.
export const isManualReceipt = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''));

const near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 1.005; // допуск 1 грн (копійки, округлення)
const fmt = (n) => `${Math.round(Number(n) * 100) / 100} грн`;
const kyivDayOf = (iso) => (/(Z|[+-]\d\d:\d\d)$/.test(String(iso)) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date(iso)) : String(iso || '').slice(0, 10));
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Чеки ↔ замовлення: спершу чек, прив'язаний у LP-CRM; далі за номером замовлення в чеку (16-значний код або № разом із сумою),
// потім — за сумою: чек продажу на ту саму суму від дня замовлення до +20 днів, лише якщо збіг однозначний.
// cbOf(o) — слово, яке має бути в способі оплати чека (за видом оплати замовлення): серед однакових за товарами й сумою
// чеків спершу беремо той, де спосіб оплати збігається.
export function matchReceipts(orders, receipts, sameOrg = (a, b) => String(a) === String(b), cbOf = () => '') {
  const sells = receipts.filter((r) => !/RETURN/i.test(r.type));
  const byOrder = new Map();
  const used = new Set();
  const take = (o, r) => { byOrder.set(o.code, r); used.add(r.id); };
  const refIndex = new Map();
  for (const r of sells) for (const x of String(r.refs || '').split(' ').filter(Boolean)) { if (!refIndex.has(x)) refIndex.set(x, []); refIndex.get(x).push(r); }
  // 1) Чек, прив'язаний до замовлення в LP-CRM (номер чека Checkbox), — найнадійніше.
  // Таке замовлення далі НЕ підбираємо (навіть якщо чек ще не завантажено), а його чек не віддаємо іншим замовленням.
  const byId = new Map(receipts.map((r) => [String(r.id).toLowerCase(), r]));
  const pinned = new Set();
  for (const o of orders) {
    if (!o.receipt_ref) continue;
    pinned.add(o.code);
    const r = byId.get(String(o.receipt_ref).toLowerCase());
    if (r) take(o, { ...r, byRef: true });
  }
  for (const o of orders) for (const x of o.webList || []) if (x.uuid) used.add(byId.get(String(x.uuid).toLowerCase())?.id ?? x.uuid);
  for (const o of orders) {
    if (byOrder.has(o.code) || pinned.has(o.code)) continue;
    const hit = (refIndex.get(o.code) || []).find((r) => !used.has(r.id))
      || (refIndex.get(String(o.id)) || []).find((r) => !used.has(r.id) && near(r.total, o.total));
    if (hit) take(o, hit);
  }
  // За товарами: усі товари замовлення є в чеку (код товару LP-CRM у квадратних дужках назви або код Checkbox),
  // чек — не раніше дня замовлення і не пізніше +20 днів. Підбираємо ПРОХОДАМИ від найточнішого збігу до найслабшого —
  // кожен прохід по всіх замовленнях, перш ніж послабити умови. Так замовлення, якому підходить чек лише «приблизно»,
  // не забере чек, який точно належить іншому замовленню:
  //   1) сума до копійки + каса відділу + правильний спосіб оплати;  2) сума + каса відділу;  3) сума + спосіб оплати;
  //   4) сума;  5–6) те саме з допуском суми 1 грн (округлення) і з урахуванням передоплати.
  // Серед підхожих чеків беремо найближчий за часом після створення замовлення.
  const toksOf = new Map();
  const byTok = new Map(); // «код товару|сума, грн» → чеки (за часом)
  const atMs = new Map();
  for (const r of [...sells].sort((x, y) => String(x.at).localeCompare(String(y.at)))) {
    atMs.set(r.id, Date.parse(r.at) || 0);
    if (!r.goods) continue;
    const toks = new Set(String(r.goods).split(/[\s/]+/).filter(Boolean));
    toksOf.set(r.id, toks);
    // індекс «код товару + сума в гривнях» — кандидатів одразу мало навіть для популярних товарів
    const uah = Math.round(Number(r.total) || 0);
    for (const t of toks) { const k = `${t}|${uah}`; if (!byTok.has(k)) byTok.set(k, []); byTok.get(k).push(r); }
  }
  const goodsHit = (o, r) => { const toks = toksOf.get(r.id); return Boolean(toks) && o.goodsKeys.every((keys) => keys.some((k) => toks.has(k))); };
  const rDay = (r) => r.day || kyivDayOf(r.at);
  const exact = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
  // час створення замовлення (київський) → мс; ±1 год на перехід часу не важить: беремо чеки не раніше ніж за 1 год до замовлення
  const oMs = (o) => (o.dt ? Date.parse(`${String(o.dt).replace(' ', 'T')}+02:00`) - 3600e3 : Date.parse(`${o.day}T00:00:00+02:00`)) || 0;
  const goodsOrders = orders.filter((o) => o.goodsKeys?.length).sort((a, b) => String(a.dt || a.day).localeCompare(String(b.dt || b.day)));
  // Кандидати кожного замовлення рахуємо один раз: ті самі товари, вікно часу, сума з допуском (або з передоплатою).
  const cands = new Map(goodsOrders.map((o) => {
    const end = addDays(o.day, 20);
    const from = oMs(o);
    const sumNear = (r) => near(r.total, o.total) || (o.prepayment > 0 && (near(r.total, o.total - o.prepayment) || near(r.total, o.prepayment)));
    const amounts = [o.total, ...(o.prepayment > 0 ? [o.total - o.prepayment, o.prepayment] : [])].flatMap((a) => { const x = Math.round(a); return [x - 1, x, x + 1]; });
    const list = [...new Set(o.goodsKeys[0].flatMap((k) => amounts.flatMap((a) => byTok.get(`${k}|${a}`) || [])))]
      .filter((r) => atMs.get(r.id) >= from && rDay(r) >= o.day && rDay(r) <= end && sumNear(r) && goodsHit(o, r))
      .sort((x, y) => atMs.get(x.id) - atMs.get(y.id));
    return [o.code, list];
  }));
  // Чек іншої каси й з іншим способом оплати — найчастіше чек ІНШОГО такого самого замовлення (той самий товар і сума).
  // Його не видаємо за чек замовлення, а показуємо як «схожий» (hint): замовлення лишається без чека, але видно, що перевірити.
  const PASSES = [
    { sum: 'exact', org: true, cb: true }, { sum: 'exact', org: true, cb: false }, { sum: 'exact', org: false, cb: true },
    { sum: 'near', org: true, cb: false }, { sum: 'exact', org: false, cb: false, hint: true }, { sum: 'near', org: false, cb: false, hint: true },
  ];
  const similar = new Map();
  for (const pass of PASSES) {
    for (const o of goodsOrders) {
      if (byOrder.has(o.code) || pinned.has(o.code)) continue;
      const list = cands.get(o.code);
      if (!list.length) continue;
      const sumOk = pass.sum === 'exact' ? (r) => exact(r.total, o.total) || (o.prepayment > 0 && (exact(r.total, o.total - o.prepayment) || exact(r.total, o.prepayment))) : () => true;
      const orgOk = (r) => o.fopId == null || (o.fopOk ? o.fopOk(r.fop_id) : sameOrg(r.fop_id, o.fopId));
      const cb = String(cbOf(o) || '').toLowerCase();
      const cbOk = (r) => !cb || (r.pays || []).some((p) => String(p.label || '').toLowerCase().includes(cb));
      const ok = (r) => !used.has(r.id) && sumOk(r) && (!pass.org || orgOk(r)) && (!pass.cb || cbOk(r));
      // Найближчий за часом підхожий чек. Ручні чеки — звичайна практика (наприклад, післяплата Meest), тож переваги чекам LP-CRM не даємо.
      const hit = list.find(ok);
      if (hit && pass.hint) { if (!similar.has(o.code)) similar.set(o.code, hit); } else if (hit) take(o, { ...hit, byGoods: true });
    }
  }

  // За сумою: групи «сума → замовлення» і «сума → чеки»; однозначний збіг — лише якщо в групі одне замовлення в цьому вікні.
  const free = sells.filter((r) => !used.has(r.id));
  const key = (n) => Math.round(Number(n) * 100); // лише точна сума (до копійки)
  const rcBySum = new Map();
  for (const r of free) { const k = key(r.total); if (!rcBySum.has(k)) rcBySum.set(k, []); rcBySum.get(k).push(r); }
  const left = orders.filter((o) => !byOrder.has(o.code) && !pinned.has(o.code) && o.total > 0);
  const ordBySum = new Map();
  for (const o of left) { const k = key(o.total); if (!ordBySum.has(k)) ordBySum.set(k, []); ordBySum.get(k).push(o); }
  // День чека й межі вікна рахуємо один раз (чеків і замовлень тисячі — інакше сторінка не встигає).
  const dayOf = new Map(free.map((r) => [r.id, r.day || kyivDayOf(r.at)]));
  const winEnd = new Map(left.map((o) => [o.code, addDays(o.day, 20)]));
  const inWin = (o, r) => { const d = dayOf.get(r.id); return d >= o.day && d <= winEnd.get(o.code); };
  for (const [k, list] of ordBySum) {
    const rcs = rcBySum.get(k);
    if (!rcs) continue;
    for (const o of list) {
      const cands = [];
      const cb = String(cbOf(o) || '').toLowerCase();
      const cbOk = (r) => !cb || (r.pays || []).some((p) => String(p.label || '').toLowerCase().includes(cb));
      for (const r of rcs) {
        if (used.has(r.id) || !inWin(o, r)) continue;
        const orgOk = o.fopId == null || (o.fopOk ? o.fopOk(r.fop_id) : sameOrg(r.fop_id, o.fopId));
        // чек іншої каси — лише якщо збігається спосіб оплати; інакше це, найімовірніше, чек іншого замовлення
        if (!orgOk && !(list.length === 1 && cbOk(r))) { if (list.length === 1 && !similar.has(o.code)) similar.set(o.code, r); continue; }
        cands.push(r);
        if (cands.length > 1) break; // неоднозначно — далі не шукаємо
      }
      if (cands.length !== 1) continue;
      const rival = list.some((x) => x !== o && !byOrder.has(x.code) && inWin(x, cands[0]));
      if (!rival) take(o, { ...cands[0], bySum: true });
    }
  }
  for (const [code, r] of similar) if (byOrder.has(code) || used.has(r.id)) similar.delete(code);
  byOrder.similar = similar; // «схожий чек» для замовлень без чека
  return byOrder;
}

// Надходження на рахунок (Opendatabot) для замовлення «оплата на рахунок»: сума = сумі замовлення (або передоплаті),
// від 7 днів до замовлення до 2 днів після; перевага — у призначенні є № замовлення або прізвище покупця.
export function findPayment(o, txs, expected) {
  const surname = String(o.buyer || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  const from = addDays(o.day, -7); const to = addDays(o.day, 2);
  const cands = txs.filter((t) => near(t.amount, expected) && t.day >= from && t.day <= to);
  if (!cands.length) return null;
  const score = (t) => { const p = String(t.purpose || '').toLowerCase() + ' ' + String(t.payer_name || '').toLowerCase(); return (p.includes(String(o.id)) || p.includes(o.code) ? 2 : 0) + (surname.length > 2 && p.includes(surname) ? 1 : 0); };
  return cands.sort((a, b) => score(b) - score(a))[0];
}

// Оцінка одного замовлення. ctx: { rules, receipt, fops (id → назва), expectedFop, payment, today, dup }.
// Повертає { level: ok | warn | bad | wait | skip, items: [{ level, text }] }.
export function evaluate(o, ctx) {
  const items = [];
  // group — етап перевірки: mp (маркетплейс), pay (вид оплати в CRM), ttn (ТТН і наложка), comment, fact (оплата по факту),
  // receipt (чек), dup (дублі). Сторінка показує етапи по порядку.
  let grp = 'pay';
  const add = (level, text, group = grp) => items.push({ level, text, group });
  const rule = ctx.rules[String(o.payment)] || null;
  const fopName = (id) => ctx.fops[String(id)] || `ФОП ${id}`;
  const noPay = !o.payment || o.payment === '0';
  if (!rule) add('warn', noPay ? 'У замовленні не вказано вид оплати.' : `Вид оплати ${o.payment} невідомий — оберіть, що перевіряти, у «Перевірка → Налаштування».`);
  const cls = rule?.cls || '';
  if (cls === 'skip') return { level: 'skip', items: [{ level: 'skip', text: `«${rule.name}» — не перевіряємо`, group: 'pay' }] };
  if (rule) add('ok', `${rule.name} — ${{ cod: 'післяплата: у ТТН має бути наложка', prepay: 'оплата через сервіс: наложки бути не повинно', bank: 'оплата на рахунок ФОП: наложки бути не повинно' }[cls] || ''}`);
  // Часткова оплата: поле «передоплата» LP-CRM, інакше — сума з коментаря.
  const part = cls === 'cod' ? (o.prepayment > 0 ? { sum: o.prepayment } : partialOf(o.comment)) : null;
  const expCod = part ? (part.sum ? o.total - part.sum : null) : o.total;

  grp = 'ttn';
  // 1) Наложка в ТТН. Рітейл Розетки (дропшипінг): наложку (контроль оплати за ціною Розетки) ставить Розетка — не звіряємо.
  const retail = /riteil|рітейл|ритейл|retail/i.test(o.channel || '');
  if (!o.ttn) add('warn', 'Немає ТТН у замовленні.');
  else if (retail) add('info', 'Рітейл Розетки: наложку в ТТН ставить Розетка (за своєю ціною) — не звіряємо.');
  else if (o.carrier === 'np' || o.carrier === 'rd' || (o.carrier === 'prm' && o.ttn_at)) {
    if (!o.ttn_at) add('wait', 'ТТН ще не перевірено — дані з’являться після наступного оновлення.');
    else if (o.ttn_err) add('warn', `ТТН: ${o.ttn_err}`);
    else if (cls === 'cod') {
      if (!(o.cod > 0)) add('bad', o.carrier === 'prm' ? `Післяплата за CRM («${rule.name}»), а в Prom — «${o.mp_pay_name || 'без оплати при отриманні'}».` : `Післяплата за CRM («${rule.name}»), а в ТТН наложки немає.`);
      else if (part) {
        if (part.sum && !near(o.cod, expCod) && !near(o.cod, o.total)) add('bad', `Часткова оплата: наложка ${fmt(o.cod)}, а має бути ${fmt(expCod)} (${fmt(o.total)} − передоплата ${fmt(part.sum)}).`);
        else if (part.sum && near(o.cod, o.total) && !near(expCod, o.total)) add('bad', `Передоплата ${fmt(part.sum)}, а наложка — на всю суму ${fmt(o.total)} (має бути ${fmt(expCod)}).`);
        else if (!part.sum && o.cod >= o.total - 0.5) add('warn', 'У коментарі згадано передоплату, але наложка — на всю суму замовлення.');
        else add('ok', `Наложка ${fmt(o.cod)} (часткова оплата)`);
      } else if (!near(o.cod, o.total)) add('bad', `Наложка ${fmt(o.cod)}, а сума замовлення ${fmt(o.total)}.`);
      else add('ok', `Наложка ${fmt(o.cod)}${o.cod_kind === 'ctrl' ? ' · контроль оплати' : o.cod_kind === 'redelivery' ? ' · грошовий переказ' : o.cod_kind === 'prom' ? ' · оплата при отриманні (Prom)' : ''}`);
    } else if (cls === 'prepay' || cls === 'bank') {
      if (o.cod > 0) add('bad', o.cod_kind === 'prom' ? `Оплата «${rule.name}», а в Prom — «${o.mp_pay_name || 'оплата при отриманні'}» (наложка ${fmt(o.cod)}).` : `Оплата «${rule.name}», а в ТТН стоїть ${o.cod_kind === 'ctrl' ? 'контроль оплати' : 'наложка'} ${fmt(o.cod)}.`);
      else add('ok', 'Наложки немає — як і має бути');
    }
  } else if (o.carrier === 'meest') add('info', 'Meest: наложку поки перевіряйте вручну.');
  else if (o.carrier === 'prm') add(o.day < ctx.today ? 'info' : 'wait', o.day < ctx.today ? 'ТТН Prom: замовлення з цією ТТН серед замовлень Prom не знайдено — перевірте вручну.' : 'ТТН Prom: замовлення в Prom ще не знайдено.');
  else add('info', `${CARRIERS[o.carrier] || 'Служба доставки'}: наложка не перевіряється.`);

  grp = 'mp';
  // 1б) Оплата в Prom (замовлення Prom з тією самою ТТН): Пром-оплата отримана / ні / при отриманні — проти виду оплати в CRM.
  if (o.mp_pay && cls) {
    const isProsale = /пром[\s-]*оплат/i.test(rule?.name || '');
    const pn = o.mp_pay_name || '';
    if (isProsale && o.mp_pay === 'prosale_unpaid') add('bad', 'Пром-оплата в Prom ще не надійшла (не оплачено).');
    else if (isProsale && !o.mp_pay.startsWith('prosale') && o.mp_pay !== 'credit') add('bad', `У CRM «${rule.name}», а в Prom спосіб оплати «${pn}».`);
    else if (cls === 'cod' && (o.mp_pay === 'prosale_paid' || o.mp_pay === 'credit')) add('bad', `У Prom оплачено через Prom («${pn}»), а в CRM «${rule.name}».`);
    else if ((cls === 'prepay' || cls === 'bank') && o.mp_pay === 'cod' && o.carrier !== 'prm') add('bad', `У CRM «${rule.name}», а в Prom — «${pn}» (оплата при отриманні).`);
    else add('ok', `Prom: ${pn}${o.mp_pay === 'prosale_paid' ? ' · оплачено' : o.mp_pay === 'prosale_unpaid' ? ' · не оплачено' : o.mp_pay === 'credit' ? ' · через Prom' : ''}`);
  }

  // 2) Чек
  const r = ctx.receipt;
  grp = 'receipt';
  // Чек видають під час відправки (і для післяплати теж): відправлене замовлення без чека — помилка.
  if (!r && o.receipt_ref && o.ref_state === 'nofop') add('warn', 'У LP-CRM чек прив’язано, але жодна каса з доступом його не бачить — внесіть пароль касира в «Перевірка → Налаштування → Каси Checkbox».');
  else if (!r && o.receipt_ref) add('wait', 'У LP-CRM чек прив’язано — завантажуємо його з Checkbox.');
  else if (!r && ctx.noCashier) add('info', `Чек не звіряємо: для відділу ${o.office || '—'} не вказано касу («Перевірка → Налаштування → Каси Checkbox»).${o.webSeen ? ' У LP-CRM чек до замовлення не прив’язаний.' : ''}`);
  // LP-CRM (вебінтерфейс) каже, що чека немає, і в Checkbox схожого не знайшли — помилка навіть без доступу до каси.
  else if (!r && o.webSeen) add('bad', 'Відправлено, а чека немає: у LP-CRM до замовлення чек не прив’язаний, і в Checkbox схожого не знайдено.');
  else if (!r && ctx.canReceipt === false) add('info', `Чек не звіряємо: до каси «${fopName(ctx.expectedFop)}» немає доступу — внесіть пароль касира в «Перевірка → Налаштування → Каси Checkbox».`);
  else if (!r && ctx.similar) {
    const h = ctx.similar;
    let when = '';
    try { when = new Date(h.at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { when = String(h.at || '').slice(0, 16); }
    const labels = (h.pays || []).map((p) => p.label).filter(Boolean).join(', ');
    add('bad', `Чек на касі відділу не знайдено. Схожий чек: ${fopName(h.fop_id)}, ${fmt(h.total)}${labels ? `, «${labels}»` : ''}, ${when} — якщо це чек цього замовлення, його пробито не на тій касі й не тим способом оплати.`);
  } else if (!r) add('bad', 'Відправлено, а чек у Checkbox не знайдено.');
  else {
    const how = r.byRef ? ' (прив’язаний у LP-CRM)' : r.bySum ? ' (знайдено лише за сумою — можливо, створено вручну)' : r.byGoods ? '' : ' (знайдено за № замовлення)';
    if (isManualReceipt(r.id) && !r.byRef) add('warn', 'Чек пробито вручну в Checkbox (не автоматично з LP-CRM) — перевірте суму, ФОП і спосіб оплати.');
    if (!r.byRef && o.webSeen) add('warn', 'У LP-CRM чек до замовлення не прив’язаний — цей чек знайдено за товаром і сумою (можливо, пробито вручну). Перевірте, що він саме від цього замовлення.');
    if (!part && !near(r.total, o.total)) add('bad', `Чек на ${fmt(r.total)}, а замовлення на ${fmt(o.total)}${how}.`);
    else add('ok', `Чек ${fmt(r.total)} · ${fopName(r.fop_id)}${how}`);
    const labels = (r.pays || []).map((p) => p.label).filter(Boolean);
    if (rule?.cb && labels.length && !labels.some((l) => l.toLowerCase().includes(rule.cb.toLowerCase()))) {
      add('bad', `У чеку спосіб оплати «${labels.join(', ')}», а для «${rule.name}» має бути «${rule.cb}».`);
    }
    const same = ctx.sameOrg || ((a, b) => String(a) === String(b));
    if (ctx.expectedFop != null && !(ctx.fopOk ? ctx.fopOk(r.fop_id) : same(ctx.expectedFop, r.fop_id))) {
      add('bad', `Чек пробито на «${fopName(r.fop_id)}», а для цього відділу каса — «${fopName(ctx.expectedFop)}» (як у LP-CRM)`);
    }
  }
  if ((o.webList || []).some((x) => x.action === '2')) add('info', 'У LP-CRM до замовлення є чек повернення.');

  grp = 'fact';
  if (cls === 'cod' && o.cod > 0) add('info', `Наложка ${fmt(o.cod)}: гроші прийдуть після отримання посилки.`);
  else if (cls === 'prepay' && o.mp_pay === 'prosale_paid') add('ok', 'Оплачено через Prom.');
  else if (cls === 'prepay' && !o.mp_pay) add('info', `«${rule.name}»: надходження від сервісу (Розетка, Prom тощо) приходять загальною сумою — окремо не звіряємо.`);
  // 3) Оплата на рахунок
  if (cls === 'bank') {
    const p = ctx.payment;
    if (!p) add('warn', 'Надходження на рахунок ФОП на цю суму не знайдено (Opendatabot).');
    else {
      const payFop = p.account || (p.fop_id != null ? fopName(p.fop_id) : 'рахунок');
      const same = ctx.sameOrg || ((a, b) => String(a) === String(b));
      if (r && p.fop_id != null && !same(p.fop_id, r.fop_id)) add('bad', `Оплата прийшла на «${payFop}», а чек пробито на «${fopName(r.fop_id)}»`);
      else add('ok', `Оплата ${fmt(p.amount)} на «${payFop}» · ${p.day.split('-').reverse().join('.')}`);
    }
  }

  grp = 'comment';
  // 3б) Коментар менеджера про особливу оплату (передоплата, доплата, без наложки, обмін, повернення) — звірити вручну.
  // Звичайні «оплата через …» (автокоментарі замовлень маркетплейсів) не позначаємо.
  const com = String(o.comment || '').trim();
  if (com && /(передоплат|предоплат|аванс|завдат|частков|доплат|без\s+(налож|накладен|післяплат|контрол)|обмін|обмен|поверн|безкошт|залік|зарах)/i.test(com)) {
    add('warn', `Коментар про особливу оплату — звірте вручну: «${com.length > 160 ? `${com.slice(0, 157)}…` : com}»`);
  }

  grp = 'dup';
  // 4) Дублі: та сама ТТН у кількох замовленнях (одна посилка на два замовлення) або той самий телефон
  if (ctx.dupTtn?.length) add('bad', `Та сама ТТН у замовленні № ${ctx.dupTtn.join(', № ')} — одна посилка на кілька замовлень?`);
  if (ctx.dup?.length) add('warn', `Можливий дубль: той самий телефон у відправленому замовленні № ${ctx.dup.join(', № ')}.`);

  const order = ['bad', 'warn', 'wait', 'info', 'ok'];
  const level = items.reduce((lv, it) => (order.indexOf(it.level) < order.indexOf(lv) ? it.level : lv), 'ok');
  return { level: level === 'info' ? 'ok' : level, items };
}
