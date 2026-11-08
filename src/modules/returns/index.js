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
//  4) Повернення від клієнтів після отримання: ЕН «на основі» отриманої посилки з типом Return (стежимо 30 днів після
//     отримання), вхідні посилки кабінетів від людей, яким ми відправляли (телефон або прізвище й ім'я), а також статуси
//     маркетплейсів (Розетка «Замовлення повернено», Епіцентр «Запит на повернення»).
//  5) Розетка (усі активні кабінети): модуль ROZETKA Delivery — посилки RMP-…, від яких відмовились / не забрали, повернення
//     в дорозі (номер Міст Експрес), очікує в точці видачі, повернено продавцю; і заявки покупців на повернення.
import { need, nowIso, kyivDay } from '../../core/common.js';
import { npDocumentsPage, npTrackMany, npContacts, npIncomingPage } from '../../integrations/novaposhta.js';
import { rzDeliveryList, rzRefunds, rzRefundDetail, RD_RETURN_STATUSES } from '../../integrations/rozetka.js';

const BORDER_DAYS = 45; // відправлення за останні 45 днів (повернення зазвичай приходять за 2–4 тижні)
const SHOW_DAYS = 120; // отримані повернення показуємо 120 днів
const CYCLE_MS = 12 * 3600e3;
const CALLS = 20; // звернень до НП за один запит
const GAP_MS = 1000; // пауза між зверненнями: НП відповідає «To many requests» на часті запити
const BACKOFF_MS = 10 * 60e3; // НП попросила зачекати — наступна спроба не раніше ніж за 10 хв
const REFUSED = [102, 103, 105, 108];
const RECEIVED = [9, 10, 11, 106];
const BRANCH = [7, 8];
const OVERDUE_DAYS = 5; // у відділенні 5+ днів — прострочено
const WATCH_DAYS = 30; // отримані клієнтом відправлення ще 30 днів стежимо: чи не повертає (ЕН «на основі», тип Return)
const MP_DAYS = 60; // маркетплейси: замовлення за 60 днів
const MP_CLOSE_DAYS = 21; // Розетка Делівері / маркетплейс не повідомляє про прибуття — через 21 день вважаємо, що повернулось
const CONTACTS_MS = 7 * 86400e3; // контакти кабінетів НП оновлюємо раз на тиждень
// Статуси маркетплейсів, що означають повернення: Розетка 12 — відмова при отриманні, 11 — не прийшов, 19 — замовлення повернено
// (клієнт повертає після отримання); Епіцентр — запит на повернення.
const MP_RET = { epc: { return_requested: 'customer' } };
const STUCK_DAYS = 60; // Розетка: відмова без оформленого повернення / заявка без посилки довше 60 днів — «застрягло»
const RZ_MAX = 35; // запитів до Розетки за один крок (кабінет)
const RD_STATE = (st) => (st === '50020' ? 'branch' : st.startsWith('500') ? 'transit' : 'nottn');
const REFUND_GOT = [1, 2, 4, 13, 16]; // отримано від клієнта і далі (СЦ, повернення коштів, відправлено покупцю)
const isReturnType = (t) => /return/i.test(t) && !/backward/i.test(t); // «CargoReturn» — так, «BackwardDelivery» (гроші) — ні
const nameKey = (n) => String(n || '').toLowerCase().replace(/[^a-zа-яіїєґё'’\s-]/gi, ' ').split(/[\s-]+/).filter((w) => w.length > 1).slice(0, 2).sort().join(' ');
const mpIso = (v) => String(v || '').replace(' ', 'T').slice(0, 19);
const NP_TTN = (col) => `(length(${col}) BETWEEN 11 AND 20 AND ${col} NOT GLOB '*[^0-9]*')`;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// Скільки календарних днів (за Києвом) минуло: дати перевізників — київський час без поясу, наші — ISO з «Z».
const kday = (v) => (typeof v === 'number' ? kyivDay(new Date(v)) : /(Z|[+-]\d\d:\d\d)$/.test(String(v)) ? kyivDay(new Date(v)) : String(v).slice(0, 10));
const days = (from, to = Date.now()) => {
  if (!from) return null;
  const a = Date.parse(kday(from)); const b = Date.parse(kday(to));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86400000)) : null;
};

export function mountReturns(app, { db, fetchFn, onCron, services = {} }) {
  const getState = async () => {
    const r = await db.get(`SELECT value FROM settings WHERE key = 'ret_cycle'`);
    try { return { started: '', finished: '', done: true, ...(r ? JSON.parse(r.value) : {}) }; } catch { return { started: '', finished: '', done: true }; }
  };
  const setState = (st) => db.run(`INSERT INTO settings (key, value) VALUES ('ret_cycle', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(st)]);
  const accounts = () => db.all(`SELECT id, name, api_key, sender_name FROM np_accounts WHERE active = 1 ORDER BY id`).catch(() => []);
  const getJson = async (key) => { try { return JSON.parse((await db.get(`SELECT value FROM settings WHERE key = ?`, [key]))?.value || '{}') || {}; } catch { return {}; } };
  const setJson = (key, v) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, JSON.stringify(v)]);

  // Кабінет НП, ще не прочитаний за BORDER_DAYS днів (новий) — треба цикл одразу, не чекаючи 12 год.
  async function needsBackfill(accs) {
    if (!accs.length) return false;
    const today = kyivDay();
    const border = addDays(today, -BORDER_DAYS);
    const have = new Map((await db.all(`SELECT account_id, COUNT(*) AS n FROM np_days WHERE done = 1 AND day >= ? AND day < ? GROUP BY account_id`, [border, addDays(today, -2)]))
      .map((r) => [r.account_id, r.n]));
    return accs.some((a) => (have.get(a.id) || 0) < BORDER_DAYS - 3);
  }

  // Розетка, один кабінет: ROZETKA Delivery і заявки на повернення. Запити — з паузою, не більше RZ_MAX.
  async function syncRozetka(a) {
    let n = 0;
    const call = async (fn) => {
      if (n >= RZ_MAX) throw Object.assign(new Error('ліміт запитів за крок'), { more: true });
      if (n) await new Promise((r) => setTimeout(r, 300));
      n++;
      try { return await fn(await services.marking.rozetkaToken(a)); } catch (e) {
        if (!e.rzAuth) throw e;
        n++;
        return fn(await services.marking.rozetkaToken(a, true));
      }
    };
    const now = nowIso();
    const today = kyivDay();
    const stuckBorder = new Date(Date.now() - STUCK_DAYS * 86400e3).toISOString();
    const p9 = (p) => String(p || '').replace(/\D/g, '').slice(-9);

    // ROZETKA Delivery: усі посилки, що повертаються або мають повернутись (зазвичай кілька десятків).
    const seen = new Set();
    const stmts = [];
    // ЕН повернення унікальна: якщо номер уже в іншого повернення (той самий трек в іншому кабінеті) — не дублюємо.
    const owners = new Map((await db.all(`SELECT ret_ttn, orig_ttn FROM ret_items WHERE ret_ttn != ''`)).map((x) => [x.ret_ttn, x.orig_ttn]));
    for (let page = 1, pages = 1; page <= pages && page <= 5; page++) {
      const r = await call((t) => rzDeliveryList(fetchFn, t, { statuses: RD_RETURN_STATUSES, page }));
      pages = r.pageCount;
      for (const x of r.rows) {
        seen.add(x.ttn);
        if (x.retTrack && owners.has(x.retTrack) && owners.get(x.retTrack) !== x.ttn) x.retTrack = '';
        if (x.retTrack) owners.set(x.retTrack, x.ttn);
        let state = RD_STATE(x.status);
        // Відмова без оформленого повернення або повернення в точці видачі понад 60 днів — «застрягло» (уточнювати в підтримці Розетки).
        if (state !== 'transit' && x.updated && x.updated < stuckBorder) state = 'stuck';
        const note = [x.status === '50021' ? 'невірна локація повернення' : '', x.reserveEnding ? 'закінчується резерв' : '', x.toSchedule ? `графік ${x.toSchedule}` : ''].filter(Boolean).join(' · ');
        stmts.push([`INSERT INTO ret_items (orig_ttn, ret_ttn, carrier, reason, state, shop_id, ext_id, customer, phone, cargo, cost, cod, refused_at, arrived_at, ret_code, ret_status,
            to_name, to_phone, warehouse, note, created_at, checked_at)
          VALUES (?, ?, 'rd', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(orig_ttn) DO UPDATE SET ret_ttn = CASE WHEN excluded.ret_ttn != '' THEN excluded.ret_ttn ELSE ret_items.ret_ttn END, carrier = 'rd', state = excluded.state,
            reason = CASE WHEN ret_items.reason IN ('refused', 'storage') AND excluded.reason = 'refused' THEN ret_items.reason ELSE excluded.reason END,
            shop_id = excluded.shop_id, ext_id = excluded.ext_id, arrived_at = CASE WHEN excluded.state = 'branch' THEN excluded.arrived_at ELSE '' END, ret_code = excluded.ret_code,
            ret_status = excluded.ret_status, to_name = excluded.to_name, to_phone = excluded.to_phone, warehouse = excluded.warehouse, note = excluded.note,
            got_at = '', checked_at = excluded.checked_at`,
        [x.ttn, x.retTrack, x.status === '40070' ? 'storage' : 'refused', state, a.id, x.orderId, x.customer, p9(x.phone), x.cargo, x.cost, x.cod, x.updated || now,
          state === 'branch' ? x.updated : '', Number(x.status) || 0, x.statusTitle, x.to, p9(x.toPhone), x.toAddress, note, now, now]]);
      }
    }
    for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
    // Ті, що зникли зі списку: дивимось кінцевий стан за ТТН (повернено продавцю — отримано; видано клієнту / скасовано — не повернення).
    const gone = (await db.all(`SELECT orig_ttn FROM ret_items WHERE carrier = 'rd' AND shop_id = ? AND state != 'got'`, [a.id])).map((x) => x.orig_ttn).filter((t) => !seen.has(t));
    for (const ttn of gone.slice(0, 15)) {
      if (n >= RZ_MAX - 10) break;
      const x = (await call((t) => rzDeliveryList(fetchFn, t, { ttn }))).rows[0];
      if (!x) continue;
      if (x.status === '60040') await db.run(`UPDATE ret_items SET state = 'got', got_at = ?, ret_code = 60040, ret_status = ?, note = '', checked_at = ? WHERE orig_ttn = ?`, [x.updated || now, x.statusTitle, now, ttn]);
      else if (!RD_RETURN_STATUSES.includes(x.status)) await db.run(`DELETE FROM ret_items WHERE orig_ttn = ? AND carrier = 'rd'`, [ttn]);
    }

    // Заявки покупців на повернення (за 120 днів): статус, причина, товар; ТТН посилки клієнта — з картки заявки (для відкритих).
    const border = addDays(today, -SHOW_DAYS);
    const list = [];
    for (let page = 1, pages = 1; page <= pages && page <= 8; page++) {
      const r = await call((t) => rzRefunds(fetchFn, t, page));
      pages = r.pageCount;
      let old = false;
      for (const x of r.rows) { if (String(x.datetime || '').slice(0, 10) < border) { old = true; break; } list.push(x); }
      if (old) break;
    }
    const orders = new Map((await db.all(`SELECT number, REPLACE(ttn, ' ', '') AS ttn FROM mp_orders WHERE mp = 'rozetka' AND number IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(list.map((x) => String(x.order_id)))]).catch(() => [])).map((x) => [x.number, x.ttn]));
    const known = new Map((await db.all(`SELECT ext_id, orig_ttn, ret_ttn, state, got_at FROM ret_items WHERE ext_id IN (SELECT value FROM json_each(?))`, [JSON.stringify(list.map((x) => x.id))])).map((x) => [x.ext_id, x]));
    // Та сама посилка вже є (НП знайшла вхідну від клієнта або повернення «на основі») — доповнюємо її, а не дублюємо.
    const rstmts = [];
    for (const x of list) {
      const code = Number(x.status_code);
      const prev = known.get(x.id);
      if (code === 14) { if (prev) rstmts.push([`DELETE FROM ret_items WHERE ext_id = ?`, [x.id]]); continue; } // відмова в поверненні
      const got = REFUND_GOT.includes(code);
      let retTtn = prev?.ret_ttn || '';
      if (!got && !retTtn && n < RZ_MAX - 2) {
        const d = await call((t) => rzRefundDetail(fetchFn, t, x.id)).catch(() => null);
        retTtn = String(d?.ttn || '').replace(/\s/g, '').slice(0, 40);
      }
      const isNp = /^\d{11,20}$/.test(retTtn);
      const at = mpIso(x.datetime);
      const state = got ? 'got' : retTtn ? 'transit' : at < stuckBorder.slice(0, 19) ? 'stuck' : 'nottn';
      // Ключ — посилка замовлення (ТТН відправлення; якщо вона вже є серед повернень — доповнюємо той рядок), інакше сама заявка.
      const key = prev?.orig_ttn || (retTtn && owners.get(retTtn)) || orders.get(String(x.order_id)) || `rzref:${x.id}`;
      if (retTtn && owners.has(retTtn) && owners.get(retTtn) !== key) retTtn = ''; // ЕН уже в іншого повернення
      owners.set(retTtn, key);
      rstmts.push([`INSERT INTO ret_items (orig_ttn, ret_ttn, carrier, reason, state, shop_id, ext_id, customer, phone, cargo, refused_at, got_at, ret_status, note, created_at, checked_at)
        VALUES (?, ?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
        ON CONFLICT(orig_ttn) DO UPDATE SET ret_ttn = CASE WHEN excluded.ret_ttn != '' THEN excluded.ret_ttn ELSE ret_items.ret_ttn END,
          carrier = CASE WHEN ret_items.carrier = 'np' THEN 'np' ELSE excluded.carrier END, ext_id = excluded.ext_id,
          state = CASE WHEN ret_items.carrier = 'np' AND ret_items.ret_ttn != '' THEN ret_items.state ELSE excluded.state END,
          got_at = CASE WHEN excluded.state = 'got' AND ret_items.got_at = '' THEN excluded.got_at ELSE ret_items.got_at END,
          ret_status = CASE WHEN ret_items.carrier = 'np' AND ret_items.ret_code > 0 THEN ret_items.ret_status ELSE excluded.ret_status END, note = excluded.note, shop_id = excluded.shop_id,
          checked_at = CASE WHEN ret_items.ret_ttn = '' AND excluded.ret_ttn != '' THEN '' ELSE ret_items.checked_at END`,
      [key, retTtn, isNp ? 'np' : 'rzr', state, a.id, x.id, [x.buyer_surname, x.buyer_name].filter(Boolean).join(' ').slice(0, 120), p9(x.buyer_phone),
        String(x.item_name || '').slice(0, 200), at, got ? (prev?.got_at || (prev ? now : at)) : '', String(x.status_title || ''),
        `${x.reason_title || 'Повернення'} · заявка ${x.id} · замовлення ${x.order_id}${orders.get(String(x.order_id)) ? ` · ТТН ${orders.get(String(x.order_id))}` : ''}`, now]]);
    }
    for (let i = 0; i < rstmts.length; i += 100) await db.batch(rstmts.slice(i, i + 100));
    return { calls: n };
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
    const np = async (what, fn, n = 1) => {
      if (calls) await new Promise((r) => setTimeout(r, GAP_MS));
      calls += n;
      try { return await fn(); } catch (e) {
        if (/many requests/i.test(e.message)) throw Object.assign(new Error(`Нова пошта просить зачекати (${what}, після ${calls - 1} запитів)`), { rate: true });
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
          const docs = await np('список ТТН кабінету', () => npDocumentsPage(fetchFn, a.api_key, d, page));
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

    // Отримані клієнтом за WATCH_DAYS днів — ще стежимо (повернення після отримання); старіші — остаточно.
    await db.run(`UPDATE ret_ships SET final = 0 WHERE final = 1 AND code IN (9, 10, 11) AND day >= ? AND ttn NOT IN (SELECT orig_ttn FROM ret_items)`, [addDays(today, -WATCH_DAYS)]);

    // 2а) Контакти кабінетів НП (хто й на який номер забирає повернення) — раз на тиждень.
    const cont = await getJson('ret_contacts');
    for (const a of accs) {
      if (cont[a.id]?.at && Date.now() - Date.parse(cont[a.id].at) < CONTACTS_MS) continue;
      if (out()) return { left: 'contacts' };
      try { cont[a.id] = { at: nowIso(), ...(await np('контакти кабінету', () => npContacts(fetchFn, a.api_key), 2)) }; } catch (e) {
        if (e.rate) throw e;
        cont[a.id] = { at: nowIso(), code: '', persons: [], error: String(e.message || e).slice(0, 200) };
      }
      await setJson('ret_contacts', cont);
    }

    // 2б) Епіцентр (без запитів назовні — з уже синхронізованих замовлень): «Запит на повернення». Розетка — нижче, з її модулів.
    {
      const mpRows = await db.all(`SELECT mp, account_id, number, ttn, status, status_name, customer, phone, total, items, delivery, changed_at FROM mp_orders
        WHERE created_at >= ? AND mp = 'epc' AND status = 'return_requested'`, [addDays(today, -MP_DAYS)]).catch(() => []);
      const shops = new Map([...(await db.all(`SELECT id, name FROM rz_accounts`).catch(() => [])).map((x) => [`rozetka:${x.id}`, x.name]),
        ...(await db.all(`SELECT id, name FROM epc_accounts`).catch(() => [])).map((x) => [`epc:${x.id}`, x.name])]);
      const keep = [];
      const stmts = [];
      for (const o of mpRows) {
        const reason = MP_RET[o.mp]?.[o.status];
        if (!reason) continue;
        const ttn = String(o.ttn || '').replace(/\s/g, '');
        const isNp = /^\d{11,20}$/.test(ttn);
        if (isNp && reason !== 'customer') continue; // відмову з ТТН НП бачить відстеження НП
        const at = mpIso(o.changed_at);
        const goods = (() => { try { return JSON.parse(o.items || '[]').map((i) => i.name).filter(Boolean).join('; ').slice(0, 200); } catch { return ''; } })();
        const phone = String(o.phone || '').replace(/\D/g, '').slice(-9);
        if (isNp) {
          // Клієнт повертає посилку НП після отримання: ЕН повернення ще шукаємо (вхідні посилки) — поки «немає ЕН».
          stmts.push([`INSERT INTO ret_items (orig_ttn, carrier, reason, state, customer, phone, cargo, cost, refused_at, ret_status, created_at)
            VALUES (?, 'np', 'customer', 'nottn', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(orig_ttn) DO NOTHING`, [ttn, o.customer || '', phone, goods, Number(o.total) || 0, at, o.status_name, nowIso()]]);
          continue;
        }
        const key = ttn || `${o.mp}:${o.number}`;
        keep.push(key);
        const closed = at && Date.parse(at) < Date.now() - MP_CLOSE_DAYS * 86400e3;
        const gotAt = closed ? new Date(Date.parse(at) + MP_CLOSE_DAYS * 86400e3).toISOString() : '';
        stmts.push([`INSERT INTO ret_items (orig_ttn, carrier, reason, state, customer, phone, cargo, cost, refused_at, got_at, ret_status, to_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(orig_ttn) DO UPDATE SET reason = excluded.reason, state = excluded.state, got_at = excluded.got_at, ret_status = excluded.ret_status,
            refused_at = excluded.refused_at, cargo = excluded.cargo, cost = excluded.cost, to_name = excluded.to_name`,
        [key, 'mp', reason, closed ? 'got' : 'transit', o.customer || '', phone, goods, Number(o.total) || 0, at, gotAt,
          o.status_name || '', shops.get(`${o.mp}:${o.account_id}`) || '', nowIso()]]);
      }
      // Замовлення вийшло зі статусу повернення (клієнт усе ж забрав тощо) — прибираємо.
      stmts.push([`DELETE FROM ret_items WHERE carrier = 'mp' AND refused_at >= ? AND orig_ttn NOT IN (SELECT value FROM json_each(?))`, [addDays(today, -MP_DAYS + 7), JSON.stringify(keep)]]);
      for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
    }

    // 2в) Розетка — по кожному кабінету окремим кроком (ліміт запитів): модуль ROZETKA Delivery (стан посилки RMP-…:
    // повертається, чекає в точці видачі, повернено продавцю) і заявки покупців на повернення.
    const rzAccs = await db.all(`SELECT * FROM rz_accounts WHERE active = 1 ORDER BY id`).catch(() => []);
    if (rzAccs.length && services.marking?.rozetkaToken) {
      const rzst = await getJson('ret_rz');
      if (rzst.started !== st.started) { rzst.started = st.started; rzst.done = []; rzst.errors = {}; }
      for (const a of rzAccs) {
        if (rzst.done.includes(a.id)) continue;
        if (calls) return { left: 'rozetka' }; // Розетку — у кроці без запитів до НП
        try { await syncRozetka(a); delete rzst.errors[a.id]; } catch (e) {
          if (e.pending) throw e;
          rzst.errors = { ...(rzst.errors || {}), [a.id]: String(e.message || e).slice(0, 200) };
        }
        rzst.done.push(a.id);
        await setJson('ret_rz', rzst);
        return { left: 'rozetka' };
      }
    }

    // 3) Відстеження вихідних ТТН, які ще не отримано клієнтом, — пакетами по 100, ключем кабінету-відправника.
    for (;;) {
      if (out()) return { left: 'ships' };
      const rows = await db.all(`SELECT ttn, account_id, day, phone, customer FROM ret_ships WHERE final = 0 AND day >= ? AND checked_at < ? ORDER BY account_id, ttn LIMIT 100`, [border, st.started]);
      if (!rows.length) break;
      const key = keyOf.get(rows[0].account_id) || key0;
      if (!key) break;
      const batch = rows.filter((r) => (keyOf.get(r.account_id) || key0) === key);
      const tr = await np('відстеження відправлень', () => npTrackMany(fetchFn, key, batch.map((r) => ({ ttn: r.ttn, phone: r.phone }))));
      const now = nowIso();
      const rz = new Map((await db.all(`SELECT REPLACE(ttn, ' ', '') AS t, return_ttn FROM rzs_orders WHERE return_ttn != '' AND REPLACE(ttn, ' ', '') IN (SELECT value FROM json_each(?))`,
        [JSON.stringify(batch.map((r) => r.ttn))]).catch(() => [])).map((r) => [r.t, String(r.return_ttn).replace(/\D/g, '')]));
      // ЕН повернення вже належить іншій посилці (одна зворотна на кілька відправлень, або та сама від Розетки) — не дублюємо.
      const owner = new Map((await db.all(`SELECT ret_ttn, orig_ttn FROM ret_items WHERE ret_ttn != '' AND ret_ttn IN (SELECT value FROM json_each(?))`,
        [JSON.stringify([...new Set(batch.map((r) => tr.get(r.ttn)?.basis).concat([...rz.values()]).filter(Boolean))])])).map((x) => [x.ret_ttn, x.orig_ttn]));
      const stmts = [];
      for (const r of batch) {
        const t = tr.get(r.ttn) || { code: 0, status: '' };
        const basis = t.basis && /^\d{10,20}$/.test(t.basis) && (REFUSED.includes(t.code) || isReturnType(t.basisType)) ? t.basis : '';
        let retTtn = basis || rz.get(r.ttn) || '';
        if (retTtn && owner.has(retTtn) && owner.get(retTtn) !== r.ttn) {
          stmts.push([`UPDATE ret_ships SET code = ?, status = ?, final = 1, checked_at = ? WHERE ttn = ?`, [t.code, t.status, now, r.ttn]]);
          continue;
        }
        if (retTtn) owner.set(retTtn, r.ttn);
        const isRet = REFUSED.includes(t.code) || !!retTtn;
        // Отримане клієнтом стежимо ще WATCH_DAYS днів (раптом поверне); далі — остаточно.
        const final = (RECEIVED.includes(t.code) && r.day < addDays(today, -WATCH_DAYS)) || t.code === 2 || (t.code === 3 && r.day < addDays(today, -5)) || (isRet && !!retTtn);
        const reason = RECEIVED.includes(t.code) ? 'customer' : t.code === 105 ? 'storage' : 'refused';
        stmts.push([`UPDATE ret_ships SET code = ?, status = ?, final = ?, checked_at = ? WHERE ttn = ?`, [t.code, t.status, final ? 1 : 0, now, r.ttn]]);
        if (isRet) {
          stmts.push([`INSERT INTO ret_items (orig_ttn, ret_ttn, reason, state, account_id, customer, phone, cargo, cost, cod, refused_at, created_at, checked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
            ON CONFLICT(orig_ttn) DO UPDATE SET ret_ttn = CASE WHEN ret_items.ret_ttn = '' THEN excluded.ret_ttn ELSE ret_items.ret_ttn END,
              state = CASE WHEN ret_items.state = 'nottn' AND excluded.ret_ttn != '' THEN 'transit' ELSE ret_items.state END,
              reason = CASE WHEN ret_items.reason = '' OR (ret_items.ret_ttn = '' AND excluded.ret_ttn != '') THEN excluded.reason ELSE ret_items.reason END,
              cargo = CASE WHEN excluded.cargo != '' THEN excluded.cargo ELSE ret_items.cargo END,
              cost = CASE WHEN excluded.cost > 0 THEN excluded.cost ELSE ret_items.cost END, cod = CASE WHEN excluded.cod > 0 THEN excluded.cod ELSE ret_items.cod END`,
          [r.ttn, retTtn, reason, retTtn ? 'transit' : 'nottn', r.account_id, r.customer || t.recipient || '', r.phone || '',
            t.cargo || '', t.cost || 0, t.cod || 0, now, now]]);
        }
      }
      for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
    }

    // 3б) Повернення від клієнтів: вхідні посилки кабінетів (ми — отримувач) від людей, яким ми відправляли за останні 60 днів
    // (збіг за телефоном або прізвищем та ім'ям). Службові «плечі» НП (переадресація, повернення) пропускаємо — їх видно вище.
    const inc = await getJson('ret_inc');
    if (inc.started !== st.started) { inc.started = st.started; inc.done = []; }
    let idx = null;
    // Наші люди (на них приходять повернення, контактні особи кабінетів): посилки між ними — внутрішні переміщення, не повернення.
    const staffRows = await db.all(`SELECT DISTINCT to_name, to_phone FROM ret_items WHERE carrier = 'np' AND (to_name != '' OR to_phone != '')`);
    const staff = { names: new Set(), phones: new Set() };
    for (const x of [...staffRows.map((r) => ({ name: r.to_name, phone: String(r.to_phone || '').slice(-9) })), ...Object.values(cont).flatMap((c0) => c0.persons || [])]) {
      const k = nameKey(x.name);
      if (k.includes(' ')) staff.names.add(k);
      if (x.phone && String(x.phone).length >= 9) staff.phones.add(String(x.phone).slice(-9));
    }
    const isStaff = (name, phone) => staff.names.has(nameKey(name)) || (!!phone && staff.phones.has(String(phone).slice(-9)));
    // Раніше помилково зараховані (посилки від наших людей) — прибираємо.
    const wrong = (await db.all(`SELECT orig_ttn, customer, phone FROM ret_items WHERE carrier = 'np' AND reason = 'customer' AND ret_ttn != ''`)).filter((r) => isStaff(r.customer, r.phone));
    if (wrong.length) await db.run(`DELETE FROM ret_items WHERE orig_ttn IN (SELECT value FROM json_each(?))`, [JSON.stringify(wrong.map((r) => r.orig_ttn))]);
    for (const a of accs) {
      if (inc.done.includes(a.id)) continue;
      if (!idx) {
        // Кандидати — посилки, які клієнт отримав і по яких ще немає ЕН повернення; own — усі наші вихідні (їх не плутаємо з вхідними).
        const ships = await db.all(`SELECT ttn, customer, phone, day, code FROM ret_ships WHERE day >= ? ORDER BY day DESC`, [addDays(today, -60)]);
        const hasRet = new Set((await db.all(`SELECT orig_ttn FROM ret_items WHERE ret_ttn != ''`)).map((x) => x.orig_ttn));
        idx = { byPhone: new Map(), byName: new Map(), own: new Set(ships.map((x) => x.ttn)) };
        for (const x of ships.filter((y) => RECEIVED.includes(y.code) && !hasRet.has(y.ttn) && !isStaff(y.customer, y.phone))) {
          if (x.phone && !idx.byPhone.has(x.phone)) idx.byPhone.set(x.phone, x);
          const k = nameKey(x.customer);
          if (k.includes(' ') && !idx.byName.has(k)) idx.byName.set(k, x); // найновіше відправлення цій людині
        }
      }
      for (let page = 1; page <= 10; page++) {
        if (out()) return { left: 'incoming' };
        let list;
        try { list = await np('вхідні посилки', () => npIncomingPage(fetchFn, a.api_key, addDays(today, -30), addDays(today, 1), page)); } catch (e) {
          if (e.rate) throw e;
          inc.errors = { ...(inc.errors || {}), [a.id]: String(e.message || e).slice(0, 200) };
          break;
        }
        const cand = list.filter((d) => !d.owner && !idx.own.has(d.ttn));
        const taken = new Set((await db.all(`SELECT ret_ttn FROM ret_items WHERE ret_ttn IN (SELECT value FROM json_each(?))`, [JSON.stringify(cand.map((d) => d.ttn))])).map((x) => x.ret_ttn));
        const stmts = [];
        for (const d of cand) {
          if (taken.has(d.ttn) || isStaff(d.sender, d.phone)) continue;
          const ship = (d.phone && idx.byPhone.get(d.phone)) || idx.byName.get(nameKey(d.sender));
          if (!ship) continue;
          const state = RECEIVED.includes(d.code) ? 'got' : BRANCH.includes(d.code) ? 'branch' : 'transit';
          stmts.push([`INSERT INTO ret_items (orig_ttn, ret_ttn, carrier, reason, state, account_id, customer, phone, cargo, refused_at, arrived_at, got_at, ret_code, ret_status, created_at, checked_at)
            VALUES (?, ?, 'np', 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
            ON CONFLICT(orig_ttn) DO UPDATE SET ret_ttn = CASE WHEN ret_items.ret_ttn = '' THEN excluded.ret_ttn ELSE ret_items.ret_ttn END,
              state = CASE WHEN ret_items.ret_ttn = '' THEN excluded.state ELSE ret_items.state END,
              account_id = COALESCE(ret_items.account_id, excluded.account_id), checked_at = CASE WHEN ret_items.ret_ttn = '' THEN '' ELSE ret_items.checked_at END`,
          [ship.ttn, d.ttn, state, a.id, ship.customer || d.sender, ship.phone || d.phone, d.cargo, d.created || nowIso(), BRANCH.includes(d.code) || state === 'got' ? (d.arrived || '') : '',
            state === 'got' ? (d.received || nowIso()) : '', d.code, d.status, nowIso()]]);
          taken.add(d.ttn);
        }
        if (stmts.length) await db.batch(stmts);
        if (list.length < 100) break;
      }
      inc.done.push(a.id);
      await setJson('ret_inc', inc);
    }

    // 4) Відстеження ЕН повернення, доки не отримано (телефон клієнта — відправника повернення — дає повні дані).
    for (;;) {
      if (out()) return { left: 'returns' };
      // Отримані — ще раз, лише якщо дата відмови пізніша за отримання (уточнюємо її за датою створення ЕН повернення).
      const rows = await db.all(`SELECT orig_ttn, ret_ttn, phone FROM ret_items WHERE (state != 'got' OR (got_at != '' AND refused_at > got_at)) AND ret_ttn != '' AND carrier = 'np' AND checked_at < ?
        ORDER BY ret_ttn LIMIT 100`, [st.started]);
      if (!rows.length || !key0) break;
      const tr = await np('відстеження повернень', () => npTrackMany(fetchFn, key0, rows.map((r) => ({ ttn: r.ret_ttn, phone: r.phone }))));
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
    if (st.pause_until && Date.parse(st.pause_until) > Date.now()) return { ...st, wait: true };
    // Один крок за раз (фонова задача і кнопка не мають іти паралельно — інакше подвійні запити до НП).
    const lock = await db.run(`INSERT INTO settings (key, value) VALUES ('ret_lock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?`,
      [nowIso(), new Date(Date.now() - 90e3).toISOString()]);
    if (!lock.changes) return { ...st, busy: true };
    let r;
    try { r = await step(st); } catch (e) {
      if (e.rate) { st = { ...st, error: '', note: e.message, pause_until: new Date(Date.now() + BACKOFF_MS).toISOString() }; await setState(st); return { ...st, wait: true }; }
      if (!e.pending) await setState({ ...st, error: String(e.message || e).slice(0, 300), error_at: nowIso() });
      throw e;
    } finally { await db.run(`UPDATE settings SET value = '' WHERE key = 'ret_lock'`).catch(() => 0); }
    st = r.left ? { ...st, left: r.left, error: '', note: '', pause_until: '' } : { ...st, left: '', done: true, finished: nowIso(), error: '', note: '', pause_until: '' };
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
    const [rows, accs, st, cont] = await Promise.all([
      db.all(`SELECT * FROM ret_items WHERE created_at >= ? OR state != 'got' ORDER BY created_at DESC LIMIT 3000`, [since]),
      db.all(`SELECT id, name, sender_name, sender_code, active FROM np_accounts ORDER BY id`).catch(() => []),
      getState(), getJson('ret_contacts'),
    ]);
    const accName = new Map(accs.map((a) => [a.id, a.sender_name || a.name]));
    const shopName = new Map((await db.all(`SELECT id, name FROM rz_accounts`).catch(() => [])).map((x) => [x.id, x.name]));
    const rzErr = (await getJson('ret_rz')).errors || {};
    const refs = await refsOf([...new Set(rows.flatMap((r) => [r.orig_ttn, r.ret_ttn]).filter(Boolean))]);
    const now = Date.now();
    const out = rows.map((r) => {
      // Номер замовлення Розетки: Делівері — з модуля доставки, заявка — з примітки (якщо замовлення ще не синхронізоване).
      const rzOrder = r.carrier === 'rd' ? r.ext_id : r.carrier === 'rzr' ? (/замовлення ([\w-]+)/.exec(r.note || '') || [])[1] : '';
      const orders = [...(refs.get(r.orig_ttn) || []), ...(refs.get(r.ret_ttn) || []), ...(rzOrder ? [{ src: 'rozetka', label: 'Розетка', no: rzOrder }] : [])].filter((x, i, a) => a.findIndex((y) => y.src === x.src && y.no === x.no) === i)
        .sort((a, b) => SRC_ORDER.indexOf(a.src) - SRC_ORDER.indexOf(b.src));
      const inBranch = r.state === 'branch' ? days(r.arrived_at, now) : null;
      return {
        ...r, orders, src: orders[0]?.src || (r.carrier === 'rd' || r.carrier === 'rzr' ? 'rozetka' : r.account_id ? 'np' : 'other'),
        account: accName.get(r.account_id) || '', shop: shopName.get(r.shop_id) || '',
        to: r.carrier === 'rd' || r.carrier === 'rzr' ? (shopName.get(r.shop_id) || r.to_name || '') : accName.get(r.account_id) || r.to_name || '',
        branch_days: inBranch, overdue: inBranch !== null && (inBranch >= OVERDUE_DAYS || /резерв/.test(r.note || '')),
        wait_days: r.state === 'got' ? days(r.refused_at, Date.parse(r.got_at) || now) : days(r.refused_at, now),
      };
    });
    // Щоб забрати: по кожному кабінету НП — ЄДРПОУ/ІПН, на кого й на який номер приходять повернення (з самих ЕН повернення),
    // контактні особи кабінету, у яких відділеннях що чекає.
    const pickup = accs.filter((a) => a.active).map((a) => {
      const mine = out.filter((r) => r.account_id === a.id && r.carrier === 'np');
      const seen = new Map();
      for (const r of mine) if (r.to_phone || r.to_name) { const k = `${r.to_name}|${String(r.to_phone).slice(-9)}`; seen.set(k, { name: r.to_name, phone: String(r.to_phone).slice(-9), n: (seen.get(k)?.n || 0) + 1 }); }
      const persons = [...seen.values()].sort((x, y) => y.n - x.n).slice(0, 3);
      for (const p of cont[a.id]?.persons || []) if (!persons.some((x) => (p.phone && x.phone === p.phone) || (p.name && x.name === p.name))) persons.push({ name: p.name, phone: p.phone, contact: true });
      const wh = new Map();
      for (const r of mine.filter((x) => x.state === 'branch')) { const k = [r.city, r.warehouse].filter(Boolean).join(', '); wh.set(k, (wh.get(k) || 0) + 1); }
      return { id: a.id, name: a.sender_name || a.name, code: a.sender_code || cont[a.id]?.code || '', persons: persons.slice(0, 5),
        branch: mine.filter((x) => x.state === 'branch').length, transit: mine.filter((x) => x.state === 'transit').length,
        warehouses: [...wh].map(([w, n]) => ({ w, n })).sort((x, y) => y.n - x.n).slice(0, 6) };
    });
    // Розетка Делівері: у яких точках видачі чекають повернення, на чиє ім'я й телефон, графік.
    const pts = new Map();
    for (const r of out.filter((x) => x.carrier === 'rd' && x.state === 'branch')) {
      const k = `${r.shop_id}|${r.warehouse}`;
      const p = pts.get(k) || { shop: r.shop, address: r.warehouse, name: r.to_name, phone: r.to_phone, schedule: (/графік ([^·]+)/.exec(r.note || '') || [])[1]?.trim() || '', n: 0, reserve: 0, oldest: 0 };
      p.n++; if (/резерв/.test(r.note || '')) p.reserve++; p.oldest = Math.max(p.oldest, r.branch_days || 0);
      pts.set(k, p);
    }
    const pickupRd = [...pts.values()].sort((x, y) => y.n - x.n);
    return c.json({ rows: out, overdue_days: OVERDUE_DAYS, cycle: st, pickup, pickup_rd: pickupRd, mp_close_days: MP_CLOSE_DAYS,
      rz_errors: Object.entries(rzErr).map(([id, e]) => ({ shop: shopName.get(Number(id)) || id, error: e })),
      accounts: accs.filter((a) => a.active).map((a) => ({ id: a.id, name: a.sender_name || a.name })), cycle_hours: CYCLE_MS / 3600e3 });
  });
  // «Оновити інформацію»: запустити перевірку зараз і пройти крок; сторінка повторює, доки done = false.
  app.post('/api/returns/refresh', async (c) => {
    need(c, 'returns.view');
    const b = await c.req.json().catch(() => ({}));
    return c.json(await run({ force: !!b.start }));
  });
  return { run };
}
