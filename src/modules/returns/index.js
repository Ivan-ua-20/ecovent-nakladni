// Модуль «Повернення»: посилки, що повертаються до нас, з усіх підключених джерел — інформаційний розділ.
//
// Як не дублювати: облік ведемо по посилці, а не по замовленню.
//  1) Реєстр відправлень (ret_ships): кожна вихідна ТТН Нової пошти — один раз, з якого б джерела вона не прийшла
//     (кабінети НП — усі активні, нові підхоплюються самі; Розетка-постачальник; маркетплейси). «Звідки» (замовлення
//     Розетки, Prom, Епіцентру, LP-CRM) підтягуємо під час показу за тією самою ТТН.
//  2) Відстеження пакетами по 100 ТТН: відмова (102/103/108) або закінчився строк зберігання (105) → повернення (ret_items,
//     ключ — початкова ТТН). ЕН повернення — та, що НП створила «на основі» початкової (або returnTtn від Розетки);
//     вона унікальна, тож одна посилка двічі не потрапить. Далі відстежуємо вже ЕН повернення до отримання.
//  3) Цикл перевірки — раз на 12 год у фоні (і кнопкою «Оновити інформацію»), частинами: за один запит не більше
//     CALLS звернень до НП (ліміт підзапитів Cloudflare). Новий кабінет НП → одразу дочитуємо його ТТН за BORDER_DAYS днів,
//     тож усі повернення, що зараз очікують, з'являються після першого циклу.
import { need, nowIso, kyivDay } from '../../core/common.js';
import { npDocumentsPage, npTrackMany } from '../../integrations/novaposhta.js';

const BORDER_DAYS = 45; // відправлення за останні 45 днів (повернення зазвичай приходять за 2–4 тижні)
const SHOW_DAYS = 120; // отримані повернення показуємо 120 днів
const CYCLE_MS = 12 * 3600e3;
const CALLS = 28; // звернень до НП за один запит
const GAP_MS = 400; // пауза між зверненнями: НП відповідає «To many requests» на часті запити
const REFUSED = [102, 103, 105, 108];
const RECEIVED = [9, 10, 11, 106];
const BRANCH = [7, 8];
const OVERDUE_DAYS = 5; // у відділенні 5+ днів — прострочено
const NP_TTN = (col) => `(length(${col}) BETWEEN 11 AND 20 AND ${col} NOT GLOB '*[^0-9]*')`;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const days = (from, to = Date.now()) => (from ? Math.max(0, Math.floor((to - Date.parse(from)) / 86400000)) : null);

export function mountReturns(app, { db, fetchFn, onCron }) {
  const getState = async () => {
    const r = await db.get(`SELECT value FROM settings WHERE key = 'ret_cycle'`);
    try { return { started: '', finished: '', done: true, ...(r ? JSON.parse(r.value) : {}) }; } catch { return { started: '', finished: '', done: true }; }
  };
  const setState = (st) => db.run(`INSERT INTO settings (key, value) VALUES ('ret_cycle', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(st)]);
  const accounts = () => db.all(`SELECT id, name, api_key, sender_name FROM np_accounts WHERE active = 1 ORDER BY id`).catch(() => []);

  // Кабінет НП, ще не прочитаний за BORDER_DAYS днів (новий) — треба цикл одразу, не чекаючи 12 год.
  async function needsBackfill(accs) {
    if (!accs.length) return false;
    const today = kyivDay();
    const border = addDays(today, -BORDER_DAYS);
    const have = new Map((await db.all(`SELECT account_id, COUNT(*) AS n FROM np_days WHERE done = 1 AND day >= ? AND day < ? GROUP BY account_id`, [border, addDays(today, -2)]))
      .map((r) => [r.account_id, r.n]));
    return accs.some((a) => (have.get(a.id) || 0) < BORDER_DAYS - 3);
  }

  // Один крок циклу: дочитати дні кабінетів → оновити реєстр → відстежити відправлення → відстежити повернення.
  async function step(st) {
    const accs = await accounts();
    const key0 = accs[0]?.api_key || '';
    const keyOf = new Map(accs.map((a) => [a.id, a.api_key]));
    const today = kyivDay();
    const border = addDays(today, -BORDER_DAYS);
    let calls = 0;
    const out = () => calls >= CALLS;
    // Звернення до НП з паузою; «забагато запитів» — зупиняємо крок (не помилка), продовжимо наступного разу.
    const np = async (fn) => {
      if (calls) await new Promise((r) => setTimeout(r, GAP_MS));
      calls++;
      try { return await fn(); } catch (e) {
        if (/many requests/i.test(e.message)) throw Object.assign(new Error('Нова пошта просить зачекати'), { rate: true });
        throw e;
      }
    };

    // 1) ТТН кабінетів НП за дні, яких ще немає (минулі — один раз; останні 3 дні — раз за цикл). Спільний індекс з «Маркуванням».
    const seen = new Map((await db.all(`SELECT account_id, day, next_page, done, at FROM np_days WHERE day >= ?`, [border])).map((r) => [`${r.account_id}|${r.day}`, r]));
    for (const a of accs) {
      for (let d = today; d >= border; d = addDays(d, -1)) {
        const s = seen.get(`${a.id}|${d}`);
        if (s?.done && (d < addDays(today, -2) || (s.at || '') >= st.started)) continue;
        let page = s && !s.done ? s.next_page : 1;
        for (;;) {
          if (out()) return { left: 'days' };
          const docs = await np(() => npDocumentsPage(fetchFn, a.api_key, d, page));
          const done = docs.length < 100;
          await db.batch([
            ...docs.map((x) => [`INSERT INTO np_docs (ttn, account_id, day, phone, order_ref, recipient, service) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(ttn) DO UPDATE SET account_id = excluded.account_id, day = excluded.day, phone = excluded.phone, order_ref = excluded.order_ref,
              recipient = excluded.recipient, service = CASE WHEN excluded.service != '' THEN excluded.service ELSE np_docs.service END`,
            [x.ttn, a.id, d, x.phone, x.orderRef, x.recipient, x.service || '']]),
            [`INSERT INTO np_days (account_id, day, next_page, done, at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(account_id, day) DO UPDATE SET next_page = excluded.next_page, done = excluded.done, at = excluded.at`, [a.id, d, done ? page : page + 1, done ? 1 : 0, nowIso()]],
          ]);
          if (done) break;
          page++;
        }
      }
    }

    // 2) Реєстр відправлень: усі джерела, одна ТТН — один рядок (дані доповнюються, не дублюються).
    const up = `ON CONFLICT(ttn) DO UPDATE SET account_id = COALESCE(ret_ships.account_id, excluded.account_id),
      phone = CASE WHEN ret_ships.phone = '' THEN excluded.phone ELSE ret_ships.phone END,
      customer = CASE WHEN ret_ships.customer = '' THEN excluded.customer ELSE ret_ships.customer END`;
    await db.batch([
      [`INSERT INTO ret_ships (ttn, account_id, day, phone, customer) SELECT ttn, account_id, day, phone, recipient FROM np_docs WHERE day >= ? ${up}`, [border]],
      [`INSERT INTO ret_ships (ttn, account_id, day, phone, customer) SELECT t, NULL, substr(created_at, 1, 10), substr(phone, -9), customer
        FROM (SELECT REPLACE(ttn, ' ', '') AS t, created_at, phone, customer FROM rzs_orders WHERE created_at >= ?) WHERE ${NP_TTN('t')} ${up}`, [border]],
      [`INSERT INTO ret_ships (ttn, account_id, day, phone, customer) SELECT t, NULL, substr(created_at, 1, 10), substr(phone, -9), customer
        FROM (SELECT REPLACE(ttn, ' ', '') AS t, created_at, phone, customer FROM mp_orders WHERE created_at >= ?) WHERE ${NP_TTN('t')} ${up}`, [border]],
    ]);

    // 3) Відстеження вихідних ТТН, які ще не отримано клієнтом, — пакетами по 100, ключем кабінету-відправника.
    for (;;) {
      if (out()) return { left: 'ships' };
      const rows = await db.all(`SELECT ttn, account_id, day, phone, customer FROM ret_ships WHERE final = 0 AND day >= ? AND checked_at < ? ORDER BY account_id, ttn LIMIT 100`, [border, st.started]);
      if (!rows.length) break;
      const key = keyOf.get(rows[0].account_id) || key0;
      if (!key) break;
      const batch = rows.filter((r) => (keyOf.get(r.account_id) || key0) === key);
      const tr = await np(() => npTrackMany(fetchFn, key, batch.map((r) => ({ ttn: r.ttn, phone: r.phone }))));
      const now = nowIso();
      const rz = new Map((await db.all(`SELECT REPLACE(ttn, ' ', '') AS t, return_ttn FROM rzs_orders WHERE return_ttn != '' AND REPLACE(ttn, ' ', '') IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(batch.map((r) => r.ttn))]).catch(() => [])).map((r) => [r.t, String(r.return_ttn).replace(/\D/g, '')]));
      const stmts = [];
      for (const r of batch) {
        const t = tr.get(r.ttn) || { code: 0, status: '' };
        const basis = t.basis && /^\d{10,20}$/.test(t.basis) && (REFUSED.includes(t.code) || /return|повер/i.test(t.basisType)) ? t.basis : '';
        const retTtn = basis || rz.get(r.ttn) || '';
        const isRet = REFUSED.includes(t.code) || !!retTtn;
        const final = RECEIVED.includes(t.code) || t.code === 2 || (t.code === 3 && r.day < addDays(today, -5)) || (isRet && !!retTtn);
        stmts.push([`UPDATE ret_ships SET code = ?, status = ?, final = ?, checked_at = ? WHERE ttn = ?`, [t.code, t.status, final ? 1 : 0, now, r.ttn]]);
        if (isRet) {
          stmts.push([`INSERT INTO ret_items (orig_ttn, ret_ttn, reason, state, account_id, customer, phone, cargo, cost, cod, refused_at, created_at, checked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
            ON CONFLICT(orig_ttn) DO UPDATE SET ret_ttn = CASE WHEN ret_items.ret_ttn = '' THEN excluded.ret_ttn ELSE ret_items.ret_ttn END,
              state = CASE WHEN ret_items.state = 'nottn' AND excluded.ret_ttn != '' THEN 'transit' ELSE ret_items.state END,
              reason = CASE WHEN ret_items.reason = '' THEN excluded.reason ELSE ret_items.reason END,
              cargo = CASE WHEN excluded.cargo != '' THEN excluded.cargo ELSE ret_items.cargo END,
              cost = CASE WHEN excluded.cost > 0 THEN excluded.cost ELSE ret_items.cost END, cod = CASE WHEN excluded.cod > 0 THEN excluded.cod ELSE ret_items.cod END`,
          [r.ttn, retTtn, t.code === 105 ? 'storage' : 'refused', retTtn ? 'transit' : 'nottn', r.account_id, r.customer || t.recipient || '', r.phone || '',
            t.cargo || '', t.cost || 0, t.cod || 0, now, now]]);
        }
      }
      for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
    }

    // 4) Відстеження ЕН повернення, доки не отримано (телефон клієнта — відправника повернення — дає повні дані).
    for (;;) {
      if (out()) return { left: 'returns' };
      const rows = await db.all(`SELECT orig_ttn, ret_ttn, phone FROM ret_items WHERE state != 'got' AND ret_ttn != '' AND checked_at < ? ORDER BY ret_ttn LIMIT 100`, [st.started]);
      if (!rows.length || !key0) break;
      const tr = await np(() => npTrackMany(fetchFn, key0, rows.map((r) => ({ ttn: r.ret_ttn, phone: r.phone }))));
      const now = nowIso();
      const stmts = rows.map((r) => {
        const t = tr.get(r.ret_ttn);
        if (!t) return [`UPDATE ret_items SET checked_at = ? WHERE orig_ttn = ?`, [now, r.orig_ttn]];
        const state = RECEIVED.includes(t.code) ? 'got' : BRANCH.includes(t.code) ? 'branch' : 'transit';
        const arrived = BRANCH.includes(t.code) || state === 'got' ? (t.arrived || now) : '';
        return [`UPDATE ret_items SET state = ?, ret_code = ?, ret_status = ?, city = ?, warehouse = ?,
            refused_at = CASE WHEN ? != '' AND ? < refused_at THEN ? ELSE refused_at END,
            arrived_at = CASE WHEN ? != '' AND arrived_at = '' THEN ? ELSE arrived_at END, paid_from = ?, storage = ?,
            got_at = CASE WHEN ? = 'got' THEN ? ELSE '' END,
            to_name = CASE WHEN ? != '' THEN ? ELSE to_name END, to_phone = CASE WHEN ? != '' THEN ? ELSE to_phone END, checked_at = ? WHERE orig_ttn = ?`,
        [state, t.code, t.status, t.city, t.warehouse, t.created, t.created, t.created, arrived, arrived,
          t.paidFrom, t.storage, state, t.received || now, t.recipient, t.recipient, t.recipientPhone, t.recipientPhone, now, r.orig_ttn]];
      });
      await db.batch(stmts);
    }
    return { left: '' };
  }

  // Запустити цикл (якщо час або примусово) і пройти один крок. Повертає стан для сторінки.
  async function run({ force = false } = {}) {
    let st = await getState();
    const accs = await accounts();
    if (!accs.length) return { ...st, skipped: 'немає активних кабінетів Нової пошти' };
    const due = !st.started || Date.now() - Date.parse(st.started) >= CYCLE_MS || await needsBackfill(accs);
    if (st.done && (force || due)) {
      // Повторне натискання одразу після завершеного циклу не запускає ще один.
      if (!force || !st.finished || Date.now() - Date.parse(st.finished) > 60e3) { st = { started: nowIso(), finished: '', done: false }; await setState(st); }
    }
    if (st.done) return st;
    // Один крок за раз (фонова задача і кнопка не мають іти паралельно — інакше подвійні запити до НП).
    const lock = await db.run(`INSERT INTO settings (key, value) VALUES ('ret_lock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?`,
      [nowIso(), new Date(Date.now() - 90e3).toISOString()]);
    if (!lock.changes) return { ...st, busy: true };
    let r;
    try { r = await step(st); } catch (e) {
      if (e.rate) { st = { ...st, wait: true }; await setState({ ...st, wait: false }); return st; }
      if (!e.pending) await setState({ ...st, error: String(e.message || e).slice(0, 300), error_at: nowIso() });
      throw e;
    } finally { await db.run(`UPDATE settings SET value = '' WHERE key = 'ret_lock'`).catch(() => 0); }
    st = r.left ? { ...st, left: r.left, error: '' } : { ...st, left: '', done: true, finished: nowIso(), error: '' };
    await setState(st);
    return st;
  }
  onCron('returns', 'Повернення: статуси посилок у Новій пошті (раз на 12 год)', () => run());

  // ---------------------------------------------------------------- API
  // Звідки посилка: замовлення Розетки-постачальника, маркетплейсів, LP-CRM — за ТТН (і початковою, і поверненням).
  async function refsOf(ttns) {
    const list = JSON.stringify(ttns);
    const [rzs, mp, crm] = await Promise.all([
      db.all(`SELECT REPLACE(ttn, ' ', '') AS t, order_num FROM rzs_orders WHERE ttn != '' AND REPLACE(ttn, ' ', '') IN (SELECT value FROM json_each(?))`, [list]).catch(() => []),
      db.all(`SELECT REPLACE(ttn, ' ', '') AS t, mp, number FROM mp_orders WHERE ttn != '' AND REPLACE(ttn, ' ', '') IN (SELECT value FROM json_each(?))`, [list]).catch(() => []),
      db.all(`SELECT ttn AS t, code, id FROM an_orders WHERE ttn != '' AND ttn IN (SELECT value FROM json_each(?))`, [list]).catch(() => []),
    ]);
    const m = new Map();
    const add = (t, x) => { if (!m.has(t)) m.set(t, []); m.get(t).push(x); };
    rzs.forEach((r) => add(r.t, { src: 'rzs', label: 'Розетка — постачальник', no: r.order_num }));
    mp.forEach((r) => add(r.t, { src: r.mp === 'epicentr' ? 'epc' : r.mp, label: { rozetka: 'Розетка', prom: 'Prom', epc: 'Епіцентр', epicentr: 'Епіцентр' }[r.mp] || r.mp, no: r.number }));
    crm.forEach((r) => add(r.t, { src: 'crm', label: 'LP-CRM', no: String(r.id || r.code) }));
    return m;
  }
  const SRC_ORDER = ['rzs', 'rozetka', 'prom', 'epc', 'crm'];

  app.get('/api/returns', async (c) => {
    need(c, 'returns.view');
    const since = addDays(kyivDay(), -SHOW_DAYS);
    const [rows, accs, st] = await Promise.all([
      db.all(`SELECT * FROM ret_items WHERE created_at >= ? OR state != 'got' ORDER BY created_at DESC LIMIT 3000`, [since]),
      db.all(`SELECT id, name, sender_name, active FROM np_accounts ORDER BY id`).catch(() => []),
      getState(),
    ]);
    const accName = new Map(accs.map((a) => [a.id, a.sender_name || a.name]));
    const refs = await refsOf([...new Set(rows.flatMap((r) => [r.orig_ttn, r.ret_ttn]).filter(Boolean))]);
    const now = Date.now();
    const out = rows.map((r) => {
      const orders = [...(refs.get(r.orig_ttn) || []), ...(refs.get(r.ret_ttn) || [])].filter((x, i, a) => a.findIndex((y) => y.src === x.src && y.no === x.no) === i)
        .sort((a, b) => SRC_ORDER.indexOf(a.src) - SRC_ORDER.indexOf(b.src));
      const inBranch = r.state === 'branch' ? days(r.arrived_at, now) : null;
      return {
        ...r, orders, src: orders[0]?.src || (r.account_id ? 'np' : 'other'),
        account: accName.get(r.account_id) || '', to: accName.get(r.account_id) || r.to_name || '',
        branch_days: inBranch, overdue: inBranch !== null && inBranch >= OVERDUE_DAYS,
        wait_days: r.state === 'got' ? days(r.refused_at, Date.parse(r.got_at) || now) : days(r.refused_at, now),
      };
    });
    return c.json({ rows: out, overdue_days: OVERDUE_DAYS, cycle: st, accounts: accs.filter((a) => a.active).map((a) => ({ id: a.id, name: a.sender_name || a.name })), cycle_hours: CYCLE_MS / 3600e3 });
  });
  // «Оновити інформацію»: запустити перевірку зараз і пройти крок; сторінка повторює, доки done = false.
  app.post('/api/returns/refresh', async (c) => {
    need(c, 'returns.view');
    const b = await c.req.json().catch(() => ({}));
    return c.json(await run({ force: !!b.start }));
  });
  return { run };
}
