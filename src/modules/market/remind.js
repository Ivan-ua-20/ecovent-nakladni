// Маркетплейси → Розетка: «Передзвонити» — скасовані замовлення, по яких варто набрати покупця, і ранкове нагадування
// менеджерам у Telegram (кожному — лише його магазини, власнику й адміністраторам — зведення по всіх).
// Два списки:
//  • скасовані (крім дублів, фейкових і з неправильними контактами) — запропонувати інший варіант, знижку, допомогу з оплатою;
//  • «Клієнт не оплатив» (код 50) — покупець хотів купити, але оплата не пройшла, а менеджер не дзвонив.
// Не потрапляють: покупець (той самий телефон) зробив інше замовлення пізніше; менеджер уже дзвонив (Binotel після
// скасування / після створення для неоплачених) або відмітив «Подзвонив» у картці.
import { fail, need, nowIso } from '../../core/common.js';
import { accessOf, shopAllowed } from '../../core/auth.js';

export const RECALL_SKIP = ['31', '49', '44', '28']; // дубль (менеджер / Розетка), фейкове, неправильні контакти
export const RECALL_UNPAID = ['50']; // «Клієнт не оплатив»
export const RECALL_DAYS = 3; // група «Передзвонити» в сервісі — скасовані за 3 дні
const MAX_ITEMS = 30; // замовлень у списку одного повідомлення
const MAX_WINDOW_H = 72; // після вихідних — не більше ніж за 3 доби
export const REMIND_DEFAULT = { on: true, hour: 9, days: [1, 2, 3, 4, 5, 6], admins: true, client: true, unpaid: true, empty: false };
const inList = (a) => a.map((x) => `'${x}'`).join(', ');

// Умова SQL для mp_orders: скасоване, з телефоном, без відмітки «Подзвонив», пізніших замовлень покупця немає. Параметр — межа changed_at.
export const recallSql = (failed) => `(mp = 'rozetka' AND status_group = 3 AND status NOT IN (${inList([...failed, ...RECALL_SKIP])})
  AND phone != '' AND called_at = '' AND changed_at >= ?
  AND NOT EXISTS (SELECT 1 FROM mp_orders o2 WHERE o2.mp = 'rozetka' AND o2.phone != '' AND substr(o2.phone, -9) = substr(mp_orders.phone, -9)
    AND o2.created_at > mp_orders.created_at AND NOT (o2.account_id = mp_orders.account_id AND o2.id = mp_orders.id)))`;

const kyivParts = (ms) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
}).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const uah = (n) => `${Math.round(Number(n) || 0).toLocaleString('uk-UA').replace(/ /g, ' ')} ₴`;
const phoneFmt = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length === 12 ? `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}` : d ? `+${d}` : ''; };
const dm = (s) => { const v = String(s || ''); return `${v.slice(8, 10)}.${v.slice(5, 7)} ${v.slice(11, 16)}`; };

export function mountMarketRemind(app, { db, services = {}, onCron = () => {}, shopsOf, kyivDT, failed, rzOrderOf, shared = {}, clock }) {
  const now = () => (clock ? clock() : Date.now());
  const getJson = async (key, def) => { try { return JSON.parse((await db.get(`SELECT value FROM settings WHERE key = ?`, [key]))?.value || 'null') ?? def; } catch { return def; } };
  const putJson = (key, v) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, JSON.stringify(v)]);
  const settings = async () => ({ ...REMIND_DEFAULT, ...(await getJson('mp_remind', {})) });
  const userName = (u) => String(u?.name || u?.login || '').slice(0, 80);
  const SQL = recallSql(failed);

  // Скасовані з межею since ('YYYY-MM-DD HH:MM:SS' за Києвом), розкладені на два списки; дзвінки Binotel відсіюють тих, кому вже дзвонили.
  async function lists(since, accounts = null) {
    const rows = await db.all(`SELECT account_id, id, number, created_at, changed_at, status, status_name, customer, phone, total, items, pay_type
      FROM mp_orders WHERE ${SQL} ${accounts ? 'AND account_id IN (SELECT value FROM json_each(?))' : ''} ORDER BY changed_at LIMIT 400`,
    accounts ? [since, JSON.stringify(accounts)] : [since]);
    const unpaid = (r) => RECALL_UNPAID.includes(String(r.status));
    const tel = rows.length ? await services.telephony?.marks(rows.map((r) => ({ key: `${r.account_id}:${r.id}`, phones: [r.phone], at: unpaid(r) ? r.created_at : r.changed_at }))).catch(() => null) : null;
    const out = { client: [], unpaid: [], called: 0 };
    for (const r of rows) {
      const m = tel?.get(`${r.account_id}:${r.id}`);
      if (m?.after?.n) { out.called++; continue; }
      let item = '';
      try { const it = JSON.parse(r.items || '[]'); item = it[0]?.name || ''; } catch { /* */ }
      (unpaid(r) ? out.unpaid : out.client).push({ ...r, item, items: undefined });
    }
    return out;
  }
  // Скільки покупців уже зробили нове замовлення — для рядка «не показую» (без відмітки «Подзвонив»).
  async function reorderedCount(since, accounts) {
    const r = await db.get(`SELECT COUNT(*) AS n FROM mp_orders WHERE mp = 'rozetka' AND status_group = 3 AND phone != '' AND changed_at >= ?
      ${accounts ? 'AND account_id IN (SELECT value FROM json_each(?))' : ''}
      AND EXISTS (SELECT 1 FROM mp_orders o2 WHERE o2.mp = 'rozetka' AND substr(o2.phone, -9) = substr(mp_orders.phone, -9) AND o2.created_at > mp_orders.created_at
        AND NOT (o2.account_id = mp_orders.account_id AND o2.id = mp_orders.id))`, accounts ? [since, JSON.stringify(accounts)] : [since]);
    return r?.n || 0;
  }

  function message({ name, l, shopNames, reordered, origin, st, title }) {
    const line = (r, i) => {
      const shop = shopNames.get(r.account_id) || '';
      return `${i}. <b>${esc(r.number)}</b> · ${esc(String(r.item).slice(0, 60))} · ${uah(r.total)}\n   ${esc(r.customer || '—')} · ${esc(phoneFmt(r.phone))}${shop ? ` · ${esc(shop)}` : ''}\n   `
        + `${RECALL_UNPAID.includes(String(r.status)) ? `${esc(r.pay_type || 'оплата')} не пройшла · ` : ''}скасовано ${esc(dm(r.changed_at))} · «${esc(r.status_name || r.status)}»`;
    };
    const parts = [`📞 <b>${esc(title)}</b>`, `${name ? `${esc(name)}, о` : 'О'}сь кому варто подзвонити сьогодні.`];
    let i = 0;
    if (st.client && l.client.length) {
      parts.push('', `<b>Скасовані — ${l.client.length}</b>`, '<i>Запропонувати інший варіант, знижку або допомогу з оплатою.</i>');
      for (const r of l.client.slice(0, MAX_ITEMS)) parts.push(line(r, ++i));
      if (l.client.length > MAX_ITEMS) parts.push(`…і ще ${l.client.length - MAX_ITEMS}`);
    }
    if (st.unpaid && l.unpaid.length) {
      parts.push('', `<b>Не оплатили, скасовано — ${l.unpaid.length}</b>`, '<i>Покупець хотів купити, але оплата не пройшла.</i>');
      for (const r of l.unpaid.slice(0, MAX_ITEMS)) parts.push(line(r, ++i));
      if (l.unpaid.length > MAX_ITEMS) parts.push(`…і ще ${l.unpaid.length - MAX_ITEMS}`);
    }
    const skipped = [reordered ? `${reordered} покупц. уже зробили нове замовлення` : '', l.called ? `${l.called} — менеджер уже дзвонив` : ''].filter(Boolean);
    if (skipped.length) parts.push('', `<i>Не показую: ${skipped.join(', ')}.</i>`);
    if (origin) parts.push('', `<a href="${origin}/#/mprz?grp=recall">Відкрити список у сервісі</a>`);
    parts.push('<i>Відмітьте «Подзвонив» у картці замовлення — наступного разу воно не повториться.</i>');
    return parts.join('\n').slice(0, 4000);
  }

  // Надіслати нагадування. only — лише цьому користувачу (тест); інакше всім менеджерам і зведення адмінам.
  async function send({ only = null, force = false } = {}) {
    const st = await settings();
    if (!services.notify?.sendText) return { skipped: 'Telegram не підключено' };
    const t = now();
    const last = await getJson('mp_remind_last', {});
    const fromMs = Math.max(t - MAX_WINDOW_H * 3600e3, last.at && !only ? Date.parse(last.at) : t - 24 * 3600e3);
    const since = kyivDT(fromMs);
    const shops = ((await shopsOf()).rozetka || []);
    const shopNames = new Map(shops.map((s) => [s.id, s.name]));
    const origin = (await getJson('mp_site_origin', '')) || '';
    const kp = kyivParts(t);
    const title = `Передзвонити · ${kp.day}.${kp.month}`;
    const out = { sent: 0, users: 0, orders: 0 };
    const users = only ? [only] : (await db.all(`SELECT * FROM users WHERE active = 1 AND tg_chat_id != '' AND role IN ('manager', 'viewer')`))
      .filter((u) => accessOf(u)?.tg.includes('market'));
    for (const u of users) {
      const accs = shops.filter((s) => shopAllowed(u, 'rozetka', s.id)).map((s) => s.id);
      if (!accs.length) continue;
      const l = await lists(since, accs);
      const n = (st.client ? l.client.length : 0) + (st.unpaid ? l.unpaid.length : 0);
      if (!n && !st.empty && !only) continue;
      const text = n ? message({ name: String(u.name || '').split(/\s+/)[0], l, shopNames, reordered: await reorderedCount(since, accs), origin, st, title })
        : `📞 <b>${esc(title)}</b>\nСьогодні передзвонювати нікому.`;
      out.sent += (await services.notify.sendText({ chatIds: [u.tg_chat_id] }, text).catch(() => 0)) || 0;
      out.users++;
      out.orders += n;
    }
    if (!only && st.admins) {
      const l = await lists(since);
      const n = (st.client ? l.client.length : 0) + (st.unpaid ? l.unpaid.length : 0);
      if (n || st.empty) {
        const text = n ? message({ name: '', l, shopNames, reordered: await reorderedCount(since, null), origin, st, title: `${title} · усі магазини` })
          : `📞 <b>${esc(title)}</b>\nСьогодні передзвонювати нікому.`;
        out.sent += (await services.notify.sendText({ admins: true }, text).catch(() => 0)) || 0;
      }
    }
    if (!only) await putJson('mp_remind_last', { day: `${kp.year}-${kp.month}-${kp.day}`, at: new Date(t).toISOString(), ...out, force });
    return out;
  }

  // Фонова задача: раз на день, у вибрані дні, не раніше вказаної години. День «бронюється» в базі, щоб не надіслати двічі.
  async function tick() {
    const st = await settings();
    if (!st.on) return { skipped: 'вимкнено' };
    const kp = kyivParts(now());
    if (!st.days.includes(WD[kp.weekday])) return { skipped: 'сьогодні не надсилаємо' };
    if (Number(kp.hour) < Number(st.hour)) return { skipped: `ще рано (о ${st.hour}:00)` };
    const day = `${kp.year}-${kp.month}-${kp.day}`;
    const last = await getJson('mp_remind_last', {});
    if (last.day === day) return { skipped: 'сьогодні вже надіслано' };
    const claim = await db.run(`INSERT INTO settings (key, value) VALUES ('mp_remind_claim', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value != excluded.value`, [day]);
    if (!claim.changes) return { skipped: 'надсилається' };
    return send();
  }
  onCron('market-remind', 'Ранкове нагадування менеджерам у Telegram: скасовані й неоплачені замовлення Розетки, кому передзвонити', tick);

  // ---------- маршрути ----------
  const rememberOrigin = (c) => { const o = new URL(c.req.url).origin; if (shared.mpOrigin !== o) { shared.mpOrigin = o; putJson('mp_site_origin', o).catch(() => 0); } };
  app.get('/api/mp/remind/settings', async (c) => {
    need(c, 'market.view');
    rememberOrigin(c);
    return c.json({ ...(await settings()), last: await getJson('mp_remind_last', null) });
  });
  app.put('/api/mp/remind/settings', async (c) => {
    need(c, 'api');
    rememberOrigin(c);
    const b = await c.req.json().catch(() => ({}));
    const hour = Number(b.hour);
    if (!Number.isInteger(hour) || hour < 5 || hour > 20) throw fail(400, 'Година надсилання — від 5 до 20.');
    const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => d >= 1 && d <= 7))].sort();
    const v = { on: Boolean(b.on), hour, days, admins: Boolean(b.admins), client: Boolean(b.client), unpaid: Boolean(b.unpaid), empty: Boolean(b.empty) };
    await putJson('mp_remind', v);
    return c.json(v);
  });
  // Надіслати тестове собі (у свій Telegram), за останні 24 год.
  app.post('/api/mp/remind/test', async (c) => {
    need(c, 'market.view');
    rememberOrigin(c);
    const u = await db.get(`SELECT * FROM users WHERE id = ?`, [c.get('user').id]);
    if (!u?.tg_chat_id) throw fail(400, 'Спершу підключіть свій Telegram (Налаштування → Користувачі → Telegram), тоді надішлемо тестове.');
    const r = await send({ only: u });
    if (!r.sent) throw fail(400, 'Не вдалося надіслати в Telegram — перевірте, що бот підключений.');
    return c.json(r);
  });
  // Відмітка «Подзвонив» (undo — зняти): замовлення зникає з «Передзвонити» і з нагадувань.
  app.post('/api/mp/called', async (c) => {
    need(c, 'market.edit');
    const b = await c.req.json().catch(() => ({}));
    const o = await rzOrderOf(b, c);
    const at = b.undo ? '' : nowIso();
    const by = b.undo ? '' : userName(c.get('user'));
    await db.run(`UPDATE mp_orders SET called_at = ?, called_by = ? WHERE mp = 'rozetka' AND account_id = ? AND id = ?`, [at, by, o.account_id, o.id]);
    return c.json({ called_at: at, called_by: by });
  });

  return { send, tick, lists, settings };
}
