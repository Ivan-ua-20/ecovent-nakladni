// ШІ-помічник аналітики: питання звичайною мовою → Claude (Anthropic API) з інструментами, що питають ту саму
// аналітику, що й дашборд (/api/an/query — з правами того, хто питає: менеджер бачить лише свої замовлення).
// Модель не бачить бази напряму і не вигадує цифр: лише підсумки, які повернула аналітика (без ПІБ і телефонів клієнтів).
// Ключ API і модель — у «Налаштуваннях аналітики» (власник і адміністратори); ключ не показується після збереження.
import { fail, MASK } from '../../core/common.js';

const AI_URL = 'https://api.anthropic.com/v1/messages';
export const AI_MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5 — збалансовано (рекомендовано)' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5 — швидко й дешевше' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5 — найглибші висновки, дорожче' },
];
const MAX_ROUNDS = 6; // запитів до аналітики на одне питання
const MAX_HISTORY = 10; // попередніх реплік розмови, що йдуть разом із питанням
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const TOOLS = [
  {
    name: 'query_analytics',
    description: 'Підсумки продажів (замовлення LP-CRM) за період з фільтрами — те саме, що показує дашборд аналітики. '
      + 'Повертає: KPI (сума, оборот без відмов, кількість, відмови, завершені, відправлені), розбивки за відділами, джерелами («Поле 1»), '
      + 'менеджерами, групами статусів, службами доставки, брендами, категоріями, топ товарів і дані по днях. '
      + 'Якщо задати період порівняння, кожен рядок має ще й prev-значення. Фільтри — id з довідника в системних інструкціях (менеджери — логін).',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Початок періоду, YYYY-MM-DD' },
        to: { type: 'string', description: 'Кінець періоду включно, YYYY-MM-DD' },
        compare_from: { type: 'string', description: 'Початок періоду для порівняння, YYYY-MM-DD (необовʼязково)' },
        compare_to: { type: 'string', description: 'Кінець періоду для порівняння, YYYY-MM-DD (необовʼязково)' },
        depts: { type: 'array', items: { type: 'integer' }, description: 'id відділів' },
        sources: { type: 'array', items: { type: 'integer' }, description: 'id джерел («Поле 1»)' },
        managers: { type: 'array', items: { type: 'string' }, description: 'логіни менеджерів LP-CRM' },
        brands: { type: 'array', items: { type: 'integer' }, description: 'id брендів' },
        cats: { type: 'array', items: { type: 'integer' }, description: 'id категорій' },
        products: { type: 'array', items: { type: 'integer' }, description: 'id товарів LP-CRM (знайти — find_products)' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'find_products',
    description: 'Пошук товарів за назвою або ID — повертає id і назви для фільтра products у query_analytics.',
    input_schema: { type: 'object', properties: { q: { type: 'string', description: 'Частина назви або ID товару' } }, required: ['q'] },
  },
];

// Відповідь /api/an/query → компактно для моделі (менше токенів, без службових полів).
function compactQuery(q) {
  const hasPrev = Boolean(q.cmp);
  const row = (r, extra = {}) => ({
    name: r.name ?? r.login, rev: r2(r.rev), net: r2(r.net), cnt: r.cnt, rcnt: r.rcnt,
    ...(hasPrev ? { prevRev: r2(r.prevRev), prevNet: r2(r.prevNet), prevCnt: r.prevCnt } : {}), ...extra,
  });
  const days = q.daily?.cur || [];
  // по днях — до 62 днів; довший період — по тижнях (сума з понеділка)
  let series;
  if (days.length <= 62) series = days.map((d) => [d.day, d.cnt, r2(d.rev), r2(d.net)]);
  else {
    const wk = new Map();
    for (const d of days) {
      const dt = new Date(`${d.day}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      const k = dt.toISOString().slice(0, 10);
      const w = wk.get(k) || [k, 0, 0, 0];
      w[1] += d.cnt; w[2] = r2(w[2] + d.rev); w[3] = r2(w[3] + d.net);
      wk.set(k, w);
    }
    series = [...wk.values()];
  }
  return {
    period: q.range, compare: q.cmp || (q.compareEnabled ? null : 'порівняння вимкнене в налаштуваннях аналітики'),
    scope: q.own ? `лише замовлення менеджера (${q.own.logins.join(', ') || 'логін не привʼязано'})` : 'усі замовлення',
    kpi: q.kpi?.cur, kpiPrev: q.kpi?.prev,
    target: q.target?.applicable ? { plan: q.target.plan, fact: q.target.fact, pct: q.target.pct, base: q.target.base } : null,
    byDept: (q.byDept || []).map((r) => row(r, r.plan ? { plan: r.plan } : {})),
    bySource: (q.bySource || []).slice(0, 30).map((r) => row(r, r.plan ? { plan: r.plan } : {})),
    byManager: (q.byManager || []).slice(0, 30).map((r) => row(r, { login: r.login })),
    byStatusGroup: (q.byStatusGroup || []).map((r) => ({ name: r.name, cnt: r.cnt, rev: r2(r.rev), ...(hasPrev ? { prevCnt: r.prevCnt, prevRev: r2(r.prevRev) } : {}) })),
    byDelivery: (q.byDelivery || []).map((r) => ({ name: r.name, cnt: r.cnt, rcnt: r.rcnt, rev: r2(r.rev), ...(hasPrev ? { prevCnt: r.prevCnt } : {}) })),
    byBrand: (q.byBrand || []).slice(0, 20).map((r) => row(r, { qty: r.qty })),
    byCategory: (q.byCategory || []).slice(0, 20).map((r) => row(r, { qty: r.qty })),
    topProducts: (q.top || []).slice(0, 25).map((r) => ({ id: r.id, name: r.name, brand: r.brand, qty: r.qty, refusedQty: r.rqty, rev: r2(r.rev), ...(r.prevQty != null ? { prevQty: r.prevQty } : {}) })),
    series: { columns: ['date', 'cnt', 'rev', 'net'], step: days.length <= 62 ? 'day' : 'week', rows: series },
    lastSync: q.lastSync,
  };
}

export function mountAnalyticsAi(app, { db, fetchFn, kyivDay, addDays }) {
  const getVal = async (key) => (await db.get(`SELECT value FROM settings WHERE key = ?`, [key]))?.value || '';
  const setVal = (key, value) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  const modelOf = async () => {
    const m = await getVal('an_ai_model');
    return AI_MODELS.some((x) => x.id === m) ? m : AI_MODELS[0].id;
  };
  async function usage() {
    try { return JSON.parse(await getVal('an_ai_usage')) || {}; } catch { return {}; }
  }
  // Облік за місяць: питання й токени (для оцінки витрат).
  async function addUsage(u) {
    const month = kyivDay().slice(0, 7);
    const cur = await usage();
    const v = cur.month === month ? cur : { month, asks: 0, input: 0, output: 0 };
    v.asks += u.asks || 0; v.input += u.input || 0; v.output += u.output || 0;
    await setVal('an_ai_usage', JSON.stringify(v));
  }

  // Налаштування (лише з правом «analytics» — решту /api/an/* відсікає перевірка модуля).
  app.get('/api/an/ai/settings', async (c) => {
    const key = await getVal('an_ai_key');
    return c.json({ key: key ? MASK : '', model: await modelOf(), models: AI_MODELS, usage: await usage() });
  });
  app.put('/api/an/ai/settings', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    if (b.model !== undefined) {
      if (!AI_MODELS.some((x) => x.id === b.model)) throw fail(400, 'Невідома модель.');
      await setVal('an_ai_model', b.model);
    }
    if (b.key !== undefined && b.key !== MASK) {
      const key = String(b.key || '').trim();
      if (key && !/^sk-ant-[\w-]{20,}$/.test(key)) throw fail(400, 'Ключ Anthropic API починається з «sk-ant-» — скопіюйте його з console.anthropic.com → API Keys.');
      await setVal('an_ai_key', key);
    }
    return c.json({ ok: true, key: (await getVal('an_ai_key')) ? MASK : '', model: await modelOf() });
  });
  // Чи підключено ШІ (для сторінки «Питання до ШІ» — бачать усі, хто має аналітику).
  app.get('/api/an/ai/status', async (c) => c.json({ enabled: Boolean(await getVal('an_ai_key')) }));

  // Внутрішній запит до аналітики з правами того, хто питає (та сама сесія).
  async function inner(c, method, path, body) {
    const r = await app.request(path, {
      method,
      headers: { cookie: c.req.header('cookie') || '', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `помилка ${r.status}`);
    return j;
  }
  async function runTool(c, name, input) {
    if (name === 'query_analytics') {
      const ids = (a) => (Array.isArray(a) ? a : []);
      const q = await inner(c, 'POST', '/api/an/query', {
        from: input.from, to: input.to, cmpFrom: input.compare_from, cmpTo: input.compare_to,
        depts: ids(input.depts), sources: ids(input.sources), managers: ids(input.managers), brands: ids(input.brands), cats: ids(input.cats), products: ids(input.products),
      });
      return compactQuery(q);
    }
    if (name === 'find_products') {
      const r = await inner(c, 'GET', `/api/an/product-search?q=${encodeURIComponent(String(input.q || '').slice(0, 80))}`);
      return (Array.isArray(r) ? r : []).slice(0, 30).map((p) => ({ id: p.id, name: p.name }));
    }
    throw new Error(`невідомий інструмент ${name}`);
  }

  async function callClaude(key, body) {
    let res;
    try {
      res = await fetchFn(AI_URL, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (e.pending) throw e;
      throw fail(502, 'ШІ не відповідає — спробуйте ще раз за хвилину.');
    }
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = j?.error?.message || `помилка ${res.status}`;
      if (res.status === 401) throw fail(400, 'ШІ: невірний ключ API — перевірте його в «Налаштуваннях аналітики».');
      if (res.status === 429) throw fail(429, 'ШІ: забагато запитів або вичерпано ліміт — спробуйте за хвилину.');
      if (res.status === 400 && /credit|balance|billing/i.test(msg)) throw fail(400, 'ШІ: на рахунку Anthropic закінчились кошти — поповніть баланс у console.anthropic.com.');
      throw fail(502, `ШІ: ${msg}`.slice(0, 300));
    }
    return j;
  }

  app.post('/api/an/ai/ask', async (c) => {
    const key = await getVal('an_ai_key');
    if (!key) throw fail(400, 'ШІ ще не підключено: власник або адміністратор вводить ключ Anthropic API у «Налаштуваннях аналітики».');
    const b = await c.req.json().catch(() => ({}));
    const hist = (Array.isArray(b.messages) ? b.messages : [])
      .filter((m) => ['user', 'assistant'].includes(m.role) && String(m.text || '').trim())
      .slice(-(MAX_HISTORY + 1))
      .map((m) => ({ role: m.role, content: String(m.text).slice(0, 4000) }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    if (!hist.length || hist[hist.length - 1].role !== 'user') throw fail(400, 'Напишіть питання.');

    // Довідник для фільтрів (з тієї ж аналітики: відділи, джерела, менеджери, бренди, категорії).
    const today = kyivDay();
    const base = await inner(c, 'POST', '/api/an/query', { from: addDays(today, -6), to: today });
    const o = base.options || {};
    const list = (a, f) => (a || []).map(f).join('; ');
    const system = [
      'Ти — аналітик продажів компанії (e-commerce: роздріб, маркетплейси, B2B). Відповідай українською, коротко і по суті.',
      `Сьогодні ${today} (Київ). Дані — замовлення LP-CRM, оновлені ${base.lastSync || 'невідомо коли'}.`,
      base.own ? `Користувач — менеджер: йому доступні лише його замовлення (${base.own.logins.join(', ')}). Не обіцяй даних по інших менеджерах.` : 'Користувачу доступні всі замовлення.',
      'Цифри бери ЛИШЕ з результатів інструментів, нічого не вигадуй і не округлюй до неправди. Якщо даних немає або період ще не завантажено — так і скажи.',
      'Перед відповіддю викликай query_analytics з потрібним періодом і фільтрами; для порівняння задавай compare_from/compare_to. Можна кілька викликів (наприклад, окремо по брендах чи менеджерах).',
      'Терміни: rev — сума замовлень (усі статуси), net — оборот без відмов і повернень, cnt — кількість замовлень, rcnt — відмови й повернення, rpct — % відмов, '
        + 'drev/dcnt — завершені, srev/scnt — відправлені (усі, крім «Прийнято»), avg — середній чек. Гроші — у гривнях (₴).',
      '«Цей тиждень» — з понеділка по сьогодні; «минулий місяць» — повний календарний місяць. Завжди назви період, за який відповідаєш.',
      'Формат: перше речення — головна відповідь з цифрою; далі за потреби короткий список або невелика таблиця markdown; наприкінці — 1–2 висновки чи що перевірити. Без вступів.',
      `Відділи (id: назва): ${list(o.depts, (x) => `${x.id}: ${x.name}`)}.`,
      `Джерела «Поле 1» (id: назва): ${list(o.sources, (x) => `${x.id}: ${x.name}`)}.`,
      `Менеджери (логін: імʼя): ${list(o.managers, (x) => `${x.login}: ${x.name}`)}.`,
      `Бренди (id: назва): ${list(o.brands, (x) => `${x.id}: ${x.name}`)}.`,
      `Категорії (id: назва): ${list(o.cats, (x) => `${x.id}: ${x.name}`)}.`,
    ].join('\n');

    const model = await modelOf();
    const messages = [...hist];
    const used = { asks: 1, input: 0, output: 0 };
    const steps = [];
    let answer = '';
    try {
      for (let round = 0; round <= MAX_ROUNDS; round++) {
        const last = round === MAX_ROUNDS; // останній крок — без інструментів: відповісти з того, що є
        const r = await callClaude(key, { model, max_tokens: 2000, system, messages, ...(last ? {} : { tools: TOOLS }) });
        used.input += r.usage?.input_tokens || 0;
        used.output += r.usage?.output_tokens || 0;
        const content = Array.isArray(r.content) ? r.content : [];
        const calls = content.filter((x) => x.type === 'tool_use');
        if (r.stop_reason !== 'tool_use' || !calls.length) {
          answer = content.filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();
          break;
        }
        messages.push({ role: 'assistant', content });
        const results = [];
        for (const t of calls) {
          try {
            const out = await runTool(c, t.name, t.input || {});
            steps.push(t.name === 'query_analytics' ? `аналітика ${t.input.from} – ${t.input.to}${t.input.compare_from ? ` (порівняння з ${t.input.compare_from} – ${t.input.compare_to})` : ''}` : `пошук товару «${t.input.q}»`);
            results.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out) });
          } catch (e) {
            if (e.pending) throw e;
            results.push({ type: 'tool_result', tool_use_id: t.id, content: `Помилка: ${String(e.message || e).slice(0, 300)}`, is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
      }
    } finally {
      await addUsage(used).catch(() => 0);
    }
    if (!answer) answer = 'Не вдалося сформувати відповідь — спробуйте переформулювати питання.';
    return c.json({ answer, steps, model, usage: { input: used.input, output: used.output } });
  });
}
