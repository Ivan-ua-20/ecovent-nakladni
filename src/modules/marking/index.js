// Модуль «Маркування»: кабінети Нової пошти (ФОП і ТОВ) і друк маркування 100×100 за номером замовлення.
//
// Як знаходимо ТТН і кабінет, витрачаючи якнайменше запитів:
//  1) ТТН є в замовленні CRM → кабінет беремо з індексу np_docs; якщо його там немає — пробуємо друк у кабінетах
//     (спершу той, з якого друкували найчастіше) і запам'ятовуємо, чий він. Наступного разу — один запит.
//  2) ТТН у CRM немає → шукаємо в індексі за телефоном отримувача / номером замовлення за дні від дати замовлення
//     (+3 дні). Відсутні дні дочитуємо з кабінетів посторінково і зберігаємо: минулі дні — один раз назавжди,
//     сьогоднішній — не частіше ніж раз на 5 хв. Знайшли — зупиняємось, не читаючи решти.
//  Адресний забір (тип доставки «Doors…» — посилку забирає кур'єр НП з адреси): друк маркування повертає позначку,
//  і сторінка попереджає менеджера, щоб той передав складу. Тип береться з індексу або з відстеження (раз, далі — з індексу).
//  Ліміти Cloudflare: не більше PAGES_PER_CALL сторінок за одне звернення; далі сервер відповідає «триває»,
//  браузер повторює запит, і пошук продовжується з місця зупинки (прогрес — у np_days).
// Розетка (ROZETKA Delivery, ТТН «RMP-…»; «PRM-…» — створені в кабінеті Prom, пробуємо так само): магазини з логіном/паролем кабінету продавця; токен — раз на добу,
// магазин ТТН запам'ятовується (rz_docs) — друк з першої спроби.
import { MASK, fail, need, kyivDay } from '../../core/common.js';
import { logAudit } from '../../core/requisites.js';
import { npSender, npDocumentsPage, npMarkingPdf, npServiceType, npTracking, isDoorPickup, phone9 } from '../../integrations/novaposhta.js';
import { rzLogin, rzTtnPdf } from '../../integrations/rozetka.js';
import { promOrders, promDelivery } from '../../integrations/prom.js';
import { epcOrders, epcDelivery, epcLabelPdf, EPC_LABEL_PROVIDERS } from '../../integrations/epicentr.js';

const PAGES_PER_CALL = 12;
const TODAY_REFRESH_MS = 5 * 60 * 1000;
const SEARCH_DAYS = 3; // від дати замовлення і ще 3 дні
const KEEP_DAYS = 60; // індекс ТТН тримаємо 60 днів

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const keyHint = (k) => (k ? `${MASK}${String(k).slice(-4)}` : '');
const pending = () => Object.assign(new Error('Шукаю ТТН у кабінетах Нової пошти…'), { pending: true });

export function mountMarking(app, { db, fetchFn, onCleanup }) {
  onCleanup(async () => {
    const border = addDays(kyivDay(), -KEEP_DAYS);
    await db.batch([
      [`DELETE FROM np_docs WHERE day != '' AND day < ?`, [border]],
      [`DELETE FROM np_days WHERE day < ?`, [border]],
      [`DELETE FROM rz_docs WHERE day != '' AND day < ?`, [border]],
    ]);
  });

  const publicAccount = (a) => ({
    id: a.id, name: a.name, key: keyHint(a.api_key), sender_name: a.sender_name, sender_code: a.sender_code, active: a.active,
  });
  const activeAccounts = () => db.all(`SELECT * FROM np_accounts WHERE active = 1 ORDER BY hits DESC, id`);

  // ---------------------------------------------------------------- кабінети (власник і адміни)
  app.get('/api/np/accounts', async (c) => {
    need(c, 'api');
    return c.json((await db.all(`SELECT * FROM np_accounts ORDER BY active DESC, name`)).map(publicAccount));
  });

  app.post('/api/np/accounts', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const key = String(b.api_key || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(key)) throw fail(400, 'Ключ API Нової пошти — 32 символи (цифри й латинські літери a–f).');
    if (await db.get(`SELECT id FROM np_accounts WHERE api_key = ?`, [key])) throw fail(400, 'Цей ключ уже додано.');
    const sender = await npSender(fetchFn, key);
    const name = String(b.name || '').trim() || sender.name || 'Кабінет НП';
    const r = await db.run(
      `INSERT INTO np_accounts (name, api_key, sender_name, sender_code, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
      [name, key, sender.name, sender.code, new Date().toISOString()],
    );
    await logAudit(db, { user: c.get('user'), kind: 'np', refId: r.lastId, action: 'додано кабінет НП', changes: [{ field: 'name', from: '', to: name }] });
    return c.json({ id: r.lastId, sender });
  });

  app.put('/api/np/accounts/:id', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const cur = await db.get(`SELECT * FROM np_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'Кабінет не знайдено.');
    const next = { name: cur.name, api_key: cur.api_key, sender_name: cur.sender_name, sender_code: cur.sender_code, active: cur.active };
    if (b.name !== undefined) next.name = String(b.name).trim() || cur.name;
    if (b.active !== undefined) next.active = b.active ? 1 : 0;
    const key = String(b.api_key ?? '').trim();
    const keyChanged = key && key !== MASK && !key.startsWith(MASK) && key !== cur.api_key;
    if (keyChanged || b.check) {
      if (keyChanged && !/^[0-9a-f]{32}$/i.test(key)) throw fail(400, 'Ключ API Нової пошти — 32 символи (цифри й латинські літери a–f).');
      const sender = await npSender(fetchFn, keyChanged ? key : cur.api_key);
      Object.assign(next, { sender_name: sender.name, sender_code: sender.code }, keyChanged ? { api_key: key } : {});
    }
    await db.run(`UPDATE np_accounts SET name = ?, api_key = ?, sender_name = ?, sender_code = ?, active = ? WHERE id = ?`,
      [next.name, next.api_key, next.sender_name, next.sender_code, next.active, cur.id]);
    if (keyChanged) {
      // ТТН, знайдені зі старим ключем, могли належати іншому кабінету — перечитаємо за потреби.
      await db.batch([[`DELETE FROM np_docs WHERE account_id = ?`, [cur.id]], [`DELETE FROM np_days WHERE account_id = ?`, [cur.id]]]);
      await logAudit(db, { user: c.get('user'), kind: 'np', refId: cur.id, action: 'змінено ключ кабінету НП', changes: [{ field: 'api_key', from: keyHint(cur.api_key), to: keyHint(key) }] });
    }
    return c.json(publicAccount({ ...cur, ...next }));
  });

  app.delete('/api/np/accounts/:id', async (c) => {
    need(c, 'api');
    const cur = await db.get(`SELECT * FROM np_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'Кабінет не знайдено.');
    await db.batch([
      [`DELETE FROM np_accounts WHERE id = ?`, [cur.id]],
      [`DELETE FROM np_docs WHERE account_id = ?`, [cur.id]],
      [`DELETE FROM np_days WHERE account_id = ?`, [cur.id]],
    ]);
    await logAudit(db, { user: c.get('user'), kind: 'np', refId: cur.id, action: 'видалено кабінет НП', changes: [{ field: 'name', from: cur.name, to: '' }] });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- пошук ТТН замовлення
  // Тіло: { ttn, phone, date (дата замовлення), refs: [номери замовлення] } — усе це вже є на сторінці накладної,
  // тому LP-CRM повторно не питаємо.
  app.post('/api/np/find', async (c) => {
    need(c, 'docs.view');
    const b = await c.req.json();
    const accounts = await activeAccounts();
    if (!accounts.length) throw fail(400, 'Кабінети Нової пошти ще не додано: «Налаштування → Доставка: НП, Розетка, Prom, Епіцентр».');
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const answer = (row, source) => c.json({
      ttn: row.ttn, accountId: row.account_id || null, accountName: byId.get(row.account_id)?.name || '', source,
    });

    const ttn = String(b.ttn || '').replace(/\D/g, '');
    if (/^\d{10,20}$/.test(ttn)) {
      const known = await db.get(`SELECT ttn, account_id FROM np_docs WHERE ttn = ?`, [ttn]);
      return answer(known || { ttn, account_id: null }, 'crm');
    }

    const phone = phone9(b.phone);
    const refs = (Array.isArray(b.refs) ? b.refs : []).map((x) => String(x || '').trim()).filter((x) => x.length >= 3).slice(0, 3);
    if (phone.length < 9 && !refs.length) throw fail(400, 'У замовленні немає ні ТТН, ні телефону отримувача — шукати нема за чим.');
    const today = kyivDay();
    const from = /^\d{4}-\d{2}-\d{2}/.test(String(b.date || '')) ? String(b.date).slice(0, 10) : today;
    const to = addDays(from, SEARCH_DAYS) < today ? addDays(from, SEARCH_DAYS) : today;
    if (from > today) throw fail(400, 'Дата замовлення в майбутньому — перевірте замовлення.');

    const match = (docs) => docs.find((d) => (phone.length === 9 && d.phone === phone) || (d.orderRef && refs.includes(d.orderRef)));
    const lookup = () => db.get(
      `SELECT ttn, account_id FROM (
         SELECT ttn, account_id, day FROM np_docs WHERE phone = ? AND day BETWEEN ? AND ?
         UNION ALL
         SELECT ttn, account_id, day FROM np_docs WHERE order_ref IN (SELECT value FROM json_each(?)) AND day BETWEEN ? AND ?
       ) ORDER BY day DESC LIMIT 1`,
      [phone.length === 9 ? phone : '-', from, to, JSON.stringify(refs), from, to],
    );
    const hit = await lookup();
    if (hit && byId.has(hit.account_id)) return answer(hit, 'index');

    // Дочитуємо з кабінетів дні, яких ще немає в індексі.
    const days = [];
    for (let d = to; d >= from; d = addDays(d, -1)) days.push(d); // з найновішого: ТТН зазвичай створюють у день замовлення або пізніше
    const state = new Map((await db.all(
      `SELECT account_id, day, next_page, done, at FROM np_days WHERE day BETWEEN ? AND ?`, [from, to],
    )).map((r) => [`${r.account_id}|${r.day}`, r]));
    let pages = 0;
    for (const a of accounts) {
      for (const day of days) {
        const st = state.get(`${a.id}|${day}`);
        const fresh = st?.at && Date.now() - Date.parse(st.at) < TODAY_REFRESH_MS;
        if (st?.done && (day < today || fresh)) continue;
        let page = st?.done || !st ? 1 : st.next_page; // сьогоднішній день перечитуємо з початку (раз на 5 хв)
        for (;;) {
          if (pages >= PAGES_PER_CALL) throw pending();
          pages++;
          const docs = await npDocumentsPage(fetchFn, a.api_key, day, page);
          const done = docs.length < 100;
          await db.batch([
            ...docs.map((d) => [
              `INSERT INTO np_docs (ttn, account_id, day, phone, order_ref, recipient, service) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ttn) DO UPDATE SET account_id = excluded.account_id, day = excluded.day, phone = excluded.phone, order_ref = excluded.order_ref,
               service = CASE WHEN excluded.service != '' THEN excluded.service ELSE np_docs.service END`,
              [d.ttn, a.id, day, d.phone, d.orderRef, d.recipient, d.service || ''],
            ]),
            [`INSERT INTO np_days (account_id, day, next_page, done, at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(account_id, day) DO UPDATE SET next_page = excluded.next_page, done = excluded.done, at = excluded.at`,
            [a.id, day, done ? page : page + 1, done ? 1 : 0, new Date().toISOString()]],
          ]);
          const m = match(docs);
          if (m) return answer({ ttn: m.ttn, account_id: a.id }, 'np');
          if (done) break;
          page++;
        }
      }
    }
    const last = await lookup();
    if (last && byId.has(last.account_id)) return answer(last, 'index');
    throw fail(404, `ТТН не знайдено: у CRM її немає, а в кабінетах НП за ${from === to ? from : `${from} – ${to}`} немає відправлення на цей телефон.`);
  });

  // ---------------------------------------------------------------- PDF маркування 100×100
  app.get('/api/np/marking/:ttn', async (c) => {
    need(c, 'docs.view');
    const ttn = String(c.req.param('ttn')).replace(/\D/g, '');
    if (!/^\d{10,20}$/.test(ttn)) throw fail(400, 'Невірний номер ТТН.');
    const accounts = await activeAccounts();
    if (!accounts.length) throw fail(400, 'Кабінети Нової пошти ще не додано: «Налаштування → Доставка: НП, Розетка, Prom, Епіцентр».');
    const known = await db.get(`SELECT account_id, service FROM np_docs WHERE ttn = ?`, [ttn]);
    const wanted = Number(c.req.query('account')) || known?.account_id;
    const order = [...accounts.filter((a) => a.id === wanted), ...accounts.filter((a) => a.id !== wanted)];
    for (const a of order) {
      const pdf = await npMarkingPdf(fetchFn, a.api_key, ttn);
      if (!pdf) continue;
      // Тип доставки: з індексу; немає — з відстеження (ключем цього кабінету), далі зберігаємо.
      const service = known?.service || await npServiceType(fetchFn, a.api_key, ttn).catch(() => '');
      await db.batch([
        [`INSERT INTO np_docs (ttn, account_id, day, service) VALUES (?, ?, ?, ?) ON CONFLICT(ttn) DO UPDATE SET account_id = excluded.account_id,
          service = CASE WHEN excluded.service != '' THEN excluded.service ELSE np_docs.service END`, [ttn, a.id, kyivDay(), service]],
        [`UPDATE np_accounts SET hits = hits + 1 WHERE id = ?`, [a.id]],
      ]);
      return new Response(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="marking-${ttn}.pdf"`,
          'X-NP-Account': encodeURIComponent(a.name),
          'X-NP-Service': service,
          'X-NP-Pickup': isDoorPickup(service) ? '1' : '0',
          'Access-Control-Expose-Headers': 'X-NP-Account, X-NP-Service, X-NP-Pickup',
          'Cache-Control': 'private, no-store',
        },
      });
    }
    throw fail(404, `ТТН ${ttn} немає в жодному з підключених кабінетів Нової пошти (або її видалено).`);
  });

  // ================================================================ РОЗЕТКА (ROZETKA Delivery)
  const RZ_TOKEN_MS = 20 * 60 * 60 * 1000; // токен Розетки діє 24 год — оновлюємо трохи раніше
  const publicRz = (a) => ({
    id: a.id, name: a.name, username: a.username, password: a.password ? MASK : '', market_title: a.market_title, active: a.active,
  });
  async function rzToken(a, force = false) {
    if (!force && a.token && Date.now() - Date.parse(a.token_at || 0) < RZ_TOKEN_MS) return a.token;
    const r = await rzLogin(fetchFn, a.username, a.password);
    await db.run(`UPDATE rz_accounts SET token = ?, token_at = ?, market_id = ?, market_title = ? WHERE id = ?`,
      [r.token, new Date().toISOString(), r.marketId, r.marketTitle, a.id]);
    Object.assign(a, { token: r.token, market_title: r.marketTitle });
    return r.token;
  }

  app.get('/api/rz/accounts', async (c) => {
    need(c, 'api');
    return c.json((await db.all(`SELECT * FROM rz_accounts ORDER BY active DESC, name`)).map(publicRz));
  });

  app.post('/api/rz/accounts', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    if (!username || !password) throw fail(400, 'Вкажіть логін і пароль кабінету продавця Розетки.');
    if (await db.get(`SELECT id FROM rz_accounts WHERE username = ?`, [username])) throw fail(400, 'Цей логін уже додано.');
    const r = await rzLogin(fetchFn, username, password);
    const name = String(b.name || '').trim() || r.marketTitle || 'Магазин Розетки';
    const ins = await db.run(
      `INSERT INTO rz_accounts (name, username, password, market_id, market_title, token, token_at, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [name, username, password, r.marketId, r.marketTitle, r.token, new Date().toISOString(), new Date().toISOString()],
    );
    await logAudit(db, { user: c.get('user'), kind: 'rz', refId: ins.lastId, action: 'додано магазин Розетки', changes: [{ field: 'name', from: '', to: name }] });
    return c.json({ id: ins.lastId, market: r.marketTitle });
  });

  app.put('/api/rz/accounts/:id', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const cur = await db.get(`SELECT * FROM rz_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'Магазин не знайдено.');
    const next = { ...cur };
    if (b.name !== undefined) next.name = String(b.name).trim() || cur.name;
    if (b.active !== undefined) next.active = b.active ? 1 : 0;
    if (b.username !== undefined && String(b.username).trim()) next.username = String(b.username).trim();
    if (b.password && b.password !== MASK) next.password = String(b.password);
    const credsChanged = next.username !== cur.username || next.password !== cur.password;
    if (credsChanged || b.check) {
      next.token = '';
      await rzToken(next, true);
    }
    await db.run(`UPDATE rz_accounts SET name = ?, username = ?, password = ?, active = ? WHERE id = ?`,
      [next.name, next.username, next.password, next.active, cur.id]);
    if (credsChanged) {
      await db.run(`DELETE FROM rz_docs WHERE account_id = ?`, [cur.id]);
      await logAudit(db, { user: c.get('user'), kind: 'rz', refId: cur.id, action: 'змінено доступ до магазину Розетки', changes: [{ field: 'username', from: cur.username, to: next.username }] });
    }
    return c.json(publicRz(next));
  });

  app.delete('/api/rz/accounts/:id', async (c) => {
    need(c, 'api');
    const cur = await db.get(`SELECT * FROM rz_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'Магазин не знайдено.');
    await db.batch([[`DELETE FROM rz_accounts WHERE id = ?`, [cur.id]], [`DELETE FROM rz_docs WHERE account_id = ?`, [cur.id]]]);
    await logAudit(db, { user: c.get('user'), kind: 'rz', refId: cur.id, action: 'видалено магазин Розетки', changes: [{ field: 'name', from: cur.name, to: '' }] });
    return c.json({ ok: true });
  });

  // PDF ТТН ROZETKA Delivery: спершу магазин, з якого ця ТТН уже друкувалась, далі — решта.
  app.get('/api/rz/marking/:ttn', async (c) => {
    need(c, 'docs.view');
    const ttn = String(c.req.param('ttn')).toUpperCase().replace(/\s/g, '');
    if (!/^(RMP|PRM)-?[0-9A-Z-]{4,30}$/.test(ttn)) throw fail(400, 'Невірний номер ТТН Розетки (має починатися з RMP або PRM).');
    // PRM (ЕН з кабінету Prom): на кіоску Rozetka її вводять 9 цифрами — пробуємо і повний номер, і лише цифри.
    const tries = ttn.startsWith('PRM') ? [ttn, ttn.replace(/\D/g, '')] : [ttn];
    const reasons = new Set();
    const accounts = await db.all(`SELECT * FROM rz_accounts WHERE active = 1 ORDER BY hits DESC, id`);
    if (!accounts.length) throw fail(400, 'Магазини Розетки ще не додано: «Налаштування → Доставка: НП, Розетка, Prom, Епіцентр».');
    const known = await db.get(`SELECT account_id FROM rz_docs WHERE ttn = ?`, [ttn]);
    const order = [...accounts.filter((a) => a.id === known?.account_id), ...accounts.filter((a) => a.id !== known?.account_id)];
    for (const a of order) {
      let pdf = null;
      for (const t of tries) {
        try {
          pdf = await rzTtnPdf(fetchFn, await rzToken(a), t, (w) => reasons.add(w));
        } catch (e) {
          if (!e.rzAuth) throw e;
          pdf = await rzTtnPdf(fetchFn, await rzToken(a, true), t, (w) => reasons.add(w)); // токен прострочено — вхід заново і ще одна спроба
        }
        if (pdf) break;
      }
      if (!pdf) continue;
      await db.batch([
        [`INSERT INTO rz_docs (ttn, account_id, day) VALUES (?, ?, ?) ON CONFLICT(ttn) DO UPDATE SET account_id = excluded.account_id`, [ttn, a.id, kyivDay()]],
        [`UPDATE rz_accounts SET hits = hits + 1 WHERE id = ?`, [a.id]],
      ]);
      return new Response(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="marking-${ttn}.pdf"`,
          'X-NP-Account': encodeURIComponent(a.name),
          'Cache-Control': 'private, max-age=600',
        },
      });
    }
    const why = reasons.size ? ` Відповідь Розетки: ${[...reasons].join('; ')}.` : '';
    if (ttn.startsWith('PRM')) throw fail(404, `ЕН ${ttn} створена в кабінеті Prom, і Розетка не дає її надрукувати через кабінет продавця.${why} Надрукуйте етикетку в кабінеті Prom (замовлення → ЕН → «Друк»).`);
    throw fail(404, `ТТН ${ttn} немає в жодному з підключених магазинів Розетки (або її скасовано).${why}`);
  });

  // ---------------------------------------------------------------- магазини Prom.ua
  // Токен перевіряємо запитом останніх замовлень. «Перевірити» показує доставку останніх замовлень (спосіб, перевізник, ЕН) —
  // за цими даними налаштовується маркування замовлень Prom з доставкою до магазинів Rozetka.
  const publicProm = (a) => ({ id: a.id, name: a.name, token: keyHint(a.token), active: a.active, checked_at: a.checked_at || '' });
  const promSample = (orders) => orders.map((o) => ({ id: o.id, date: String(o.date_created || ''), status: String(o.status_name || o.status || ''), ...promDelivery(o) }));
  app.get('/api/prom/accounts', async (c) => {
    need(c, 'api');
    return c.json((await db.all(`SELECT * FROM prom_accounts ORDER BY active DESC, name`)).map(publicProm));
  });
  app.post('/api/prom/accounts', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const token = String(b.token || '').trim();
    if (!/^[\w-]{20,200}$/.test(token)) throw fail(400, 'Вставте токен API з кабінету Prom.');
    if (await db.get(`SELECT id FROM prom_accounts WHERE token = ?`, [token])) throw fail(400, 'Цей токен уже додано.');
    const orders = await promOrders(fetchFn, token, { limit: 10 });
    const name = String(b.name || '').trim().slice(0, 100) || 'Магазин Prom';
    const now = new Date().toISOString();
    const r = await db.run(`INSERT INTO prom_accounts (name, token, active, checked_at, created_at) VALUES (?, ?, 1, ?, ?)`, [name, token, now, now]);
    await logAudit(db, { user: c.get('user'), kind: 'prom', refId: r.lastId, action: 'додано магазин Prom', changes: [{ field: 'name', from: '', to: name }] });
    return c.json({ id: r.lastId, orders: promSample(orders) });
  });
  app.put('/api/prom/accounts/:id', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const cur = await db.get(`SELECT * FROM prom_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'Магазин не знайдено.');
    const next = { ...cur };
    if (b.name !== undefined) next.name = String(b.name).trim().slice(0, 100) || cur.name;
    if (b.active !== undefined) next.active = b.active ? 1 : 0;
    const t = String(b.token ?? '').trim();
    const tokenChanged = t && !t.startsWith(MASK) && t !== cur.token;
    if (tokenChanged && !/^[\w-]{20,200}$/.test(t)) throw fail(400, 'Вставте токен API з кабінету Prom.');
    let orders = null;
    if (tokenChanged || b.check) {
      orders = await promOrders(fetchFn, tokenChanged ? t : cur.token, { limit: 10 });
      next.checked_at = new Date().toISOString();
      if (tokenChanged) next.token = t;
    }
    await db.run(`UPDATE prom_accounts SET name = ?, token = ?, active = ?, checked_at = ? WHERE id = ?`, [next.name, next.token, next.active, next.checked_at, cur.id]);
    if (tokenChanged) await logAudit(db, { user: c.get('user'), kind: 'prom', refId: cur.id, action: 'змінено токен Prom', changes: [{ field: 'token', from: keyHint(cur.token), to: keyHint(t) }] });
    return c.json({ ...publicProm(next), ...(orders ? { orders: promSample(orders) } : {}) });
  });
  app.delete('/api/prom/accounts/:id', async (c) => {
    need(c, 'api');
    const cur = await db.get(`SELECT * FROM prom_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'Магазин не знайдено.');
    await db.run(`DELETE FROM prom_accounts WHERE id = ?`, [cur.id]);
    await logAudit(db, { user: c.get('user'), kind: 'prom', refId: cur.id, action: 'видалено магазин Prom', changes: [{ field: 'name', from: cur.name, to: '' }] });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- магазини Епіцентр Маркету
  // Токен перевіряємо запитом останніх замовлень; «Перевірити» показує їхню доставку (провайдер, номер накладної).
  // Маркування: PDF накладної з API Епіцентру (Укрпошта, Meest, центри видачі й поштомати Епіцентру).
  const TOKEN_RE = /^[\w.-]{20,4000}$/;
  const publicEpc = (a) => ({ id: a.id, name: a.name, token: keyHint(a.token), active: a.active, checked_at: a.checked_at || '' });
  const epcSample = (orders) => orders.map((o) => ({ id: String(o.number || o.id || ''), date: String(o.createdAt || ''), status: String(o.statusCode || ''), ...epcDelivery(o) }));
  app.get('/api/epc/accounts', async (c) => {
    need(c, 'api');
    return c.json((await db.all(`SELECT * FROM epc_accounts ORDER BY active DESC, name`)).map(publicEpc));
  });
  app.post('/api/epc/accounts', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const token = String(b.token || '').trim();
    if (!TOKEN_RE.test(token)) throw fail(400, 'Вставте токен API з кабінету продавця Епіцентру (Налаштування компанії → API).');
    if (await db.get(`SELECT id FROM epc_accounts WHERE token = ?`, [token])) throw fail(400, 'Цей токен уже додано.');
    const orders = await epcOrders(fetchFn, token, { limit: 10 });
    const name = String(b.name || '').trim().slice(0, 100) || 'Магазин Епіцентру';
    const now = new Date().toISOString();
    const r = await db.run(`INSERT INTO epc_accounts (name, token, active, checked_at, created_at) VALUES (?, ?, 1, ?, ?)`, [name, token, now, now]);
    await logAudit(db, { user: c.get('user'), kind: 'epc', refId: r.lastId, action: 'додано магазин Епіцентру', changes: [{ field: 'name', from: '', to: name }] });
    return c.json({ id: r.lastId, orders: epcSample(orders) });
  });
  app.put('/api/epc/accounts/:id', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    const cur = await db.get(`SELECT * FROM epc_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'Магазин не знайдено.');
    const next = { ...cur };
    if (b.name !== undefined) next.name = String(b.name).trim().slice(0, 100) || cur.name;
    if (b.active !== undefined) next.active = b.active ? 1 : 0;
    const t = String(b.token ?? '').trim();
    const tokenChanged = t && !t.startsWith(MASK) && t !== cur.token;
    if (tokenChanged && !TOKEN_RE.test(t)) throw fail(400, 'Вставте токен API з кабінету продавця Епіцентру (Налаштування компанії → API).');
    let orders = null;
    if (tokenChanged || b.check) {
      orders = await epcOrders(fetchFn, tokenChanged ? t : cur.token, { limit: 10 });
      next.checked_at = new Date().toISOString();
      if (tokenChanged) next.token = t;
    }
    await db.run(`UPDATE epc_accounts SET name = ?, token = ?, active = ?, checked_at = ? WHERE id = ?`, [next.name, next.token, next.active, next.checked_at, cur.id]);
    if (tokenChanged) await logAudit(db, { user: c.get('user'), kind: 'epc', refId: cur.id, action: 'змінено токен Епіцентру', changes: [{ field: 'token', from: keyHint(cur.token), to: keyHint(t) }] });
    return c.json({ ...publicEpc(next), ...(orders ? { orders: epcSample(orders) } : {}) });
  });
  app.delete('/api/epc/accounts/:id', async (c) => {
    need(c, 'api');
    const cur = await db.get(`SELECT * FROM epc_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'Магазин не знайдено.');
    await db.run(`DELETE FROM epc_accounts WHERE id = ?`, [cur.id]);
    await logAudit(db, { user: c.get('user'), kind: 'epc', refId: cur.id, action: 'видалено магазин Епіцентру', changes: [{ field: 'name', from: cur.name, to: '' }] });
    return c.json({ ok: true });
  });
  // PDF накладної Епіцентру: провайдер — з параметра (якщо відомий), інакше по черзі всі, що друкуються; магазини — від того,
  // з якого друкували найчастіше.
  app.get('/api/epc/marking/:ttn', async (c) => {
    need(c, 'docs.view');
    const ttn = String(c.req.param('ttn')).replace(/\s/g, '');
    if (!/^[\w-]{5,40}$/.test(ttn)) throw fail(400, 'Невірний номер накладної.');
    const p = String(c.req.query('provider') || '');
    const providers = EPC_LABEL_PROVIDERS.includes(p) ? [p] : EPC_LABEL_PROVIDERS;
    const accounts = await db.all(`SELECT * FROM epc_accounts WHERE active = 1 ORDER BY hits DESC, id`);
    if (!accounts.length) throw fail(400, 'Магазини Епіцентру ще не додано: «Налаштування → Доставка: НП, Розетка, Prom, Епіцентр».');
    const reasons = new Set();
    for (const a of accounts) {
      for (const prov of providers) {
        const pdf = await epcLabelPdf(fetchFn, a.token, prov, ttn, (w) => reasons.add(w));
        if (!pdf) continue;
        await db.run(`UPDATE epc_accounts SET hits = hits + 1 WHERE id = ?`, [a.id]);
        return new Response(pdf, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="marking-${ttn}.pdf"`,
            'X-NP-Account': encodeURIComponent(a.name),
            'Cache-Control': 'private, max-age=600',
          },
        });
      }
    }
    const why = reasons.size ? ` Відповідь Епіцентру: ${[...reasons].slice(0, 3).join('; ')}.` : '';
    throw fail(404, `Накладної ${ttn} немає в підключених магазинах Епіцентру.${why}`);
  });

  // Статус ТТН для інших модулів (B2B: замовлення клієнтів партнера). Відстежити можна будь-яку ТТН НП ключем будь-якого кабінету.
  async function trackTtn(ttn, phone = '') {
    const t = String(ttn || '').replace(/\s/g, '');
    if (!/^\d{10,20}$/.test(t)) throw fail(400, 'ТТН Нової пошти — 10–20 цифр.');
    const acc = await db.get(`SELECT api_key FROM np_accounts WHERE active = 1 ORDER BY hits DESC, id LIMIT 1`);
    if (!acc) throw fail(400, 'Немає підключеного кабінету Нової пошти (Налаштування → Доставка: НП, Розетка, Prom, Епіцентр).');
    return npTracking(fetchFn, acc.api_key, t, String(phone || '').replace(/\D/g, '').slice(-12));
  }
  return { trackTtn };
}
