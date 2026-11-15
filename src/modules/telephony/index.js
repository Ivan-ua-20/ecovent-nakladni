// Модуль «Телефонія» (Binotel): ключ і секрет вводить адміністратор у «Налаштуваннях»; фонова задача кожні кілька хвилин
// забирає журнал дзвінків (вхідні й вихідні) — перший раз за останні BACKFILL_DAYS днів, далі лише нові.
// Іншим модулям (маркетплейси) — services.telephony.marks(): чи дзвонив покупець до замовлення і чи дзвонив менеджер після.
import { MASK, fail, need } from '../../core/common.js';
import { binotelCallsForPeriod, phone9, BINOTEL_MAX_PERIOD } from '../../integrations/binotel.js';

const BACKFILL_DAYS = 90;
const CHUNKS_PER_RUN = 8; // діб журналу за один запуск (кожна доба — один запит до Binotel)
const EVERY_MS = 4 * 60e3;
const OVERLAP_S = 15 * 60; // перечитуємо останні 15 хв: дзвінок міг ще тривати
const KEEP_DAYS = 400;
const BEFORE_DAYS = 30; // «дзвонив до замовлення» — за 30 днів до нього
const AFTER_DAYS = 30;

const kyivAt = (ts) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(new Date(ts * 1000));
// 'YYYY-MM-DD HH:MM:SS' ± дні (обидві дати за Києвом — зсув однаковий)
const shiftAt = (at, days) => new Date(Date.parse(`${String(at).slice(0, 19).replace(' ', 'T')}Z`) + days * 864e5).toISOString().slice(0, 19).replace('T', ' ');
const hint = (k) => (k ? `${MASK}${String(k).slice(-4)}` : '');

export function mountTelephony(app, { db, fetchFn, onCron = () => {}, onCleanup = () => {} }) {
  const getVal = async (key) => (await db.get(`SELECT value FROM settings WHERE key = ?`, [key]))?.value || '';
  const putVal = (key, value) => db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  const creds = async () => {
    const rows = await db.all(`SELECT key, value FROM settings WHERE key IN ('binotel_key', 'binotel_secret', 'binotel_sync')`);
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    let sync = {};
    try { sync = JSON.parse(m.binotel_sync || '{}') || {}; } catch { sync = {}; }
    return { key: m.binotel_key || '', secret: m.binotel_secret || '', sync };
  };

  onCleanup(async () => { await db.run(`DELETE FROM tel_calls WHERE ts < ?`, [Math.floor(Date.now() / 1000) - KEEP_DAYS * 86400]); });

  async function saveCalls(rows) {
    const list = rows.filter((r) => r.phone9);
    for (let i = 0; i < list.length; i += 100) {
      await db.batch(list.slice(i, i + 100).map((r) => [
        `INSERT INTO tel_calls (id, ts, at, dir, phone9, disp, billsec, who) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET disp = excluded.disp, billsec = excluded.billsec, who = excluded.who
         WHERE tel_calls.disp IS NOT excluded.disp OR tel_calls.billsec IS NOT excluded.billsec OR tel_calls.who IS NOT excluded.who`,
        [r.id, r.ts, kyivAt(r.ts), r.dir, r.phone9, r.disp, r.billsec, r.who],
      ]));
    }
    return list.length;
  }

  // Один запуск: до CHUNKS_PER_RUN діб журналу від місця, де зупинились.
  async function step({ force = false, nowMs = Date.now() } = {}) {
    const cur = await creds();
    if (!cur.key || !cur.secret) return { skipped: 'Binotel не налаштовано' };
    const st = cur.sync;
    if (!force && st.at && nowMs - Date.parse(st.at) < EVERY_MS) return { skipped: 'ще рано' };
    const now = Math.floor(nowMs / 1000) - 60;
    let to = Number(st.to) || now - BACKFILL_DAYS * 86400;
    const from = Number(st.from) || to;
    let saved = 0;
    let chunks = 0;
    let error = '';
    try {
      while (chunks < CHUNKS_PER_RUN && to < now) {
        const stop = Math.min(to + BINOTEL_MAX_PERIOD - 1, now);
        saved += await saveCalls(await binotelCallsForPeriod(fetchFn, cur, to, stop));
        to = stop + 1;
        chunks++;
      }
    } catch (e) {
      if (e.pending && !chunks) throw e;
      if (!e.pending) error = String(e.message || e).slice(0, 300);
    }
    const caught = to >= now;
    const next = { from, to: caught ? Math.max(from, now - OVERLAP_S) : to, at: new Date(nowMs).toISOString(), done: Boolean(st.done || caught),
      error, error_at: error ? new Date(nowMs).toISOString() : '' };
    await putVal('binotel_sync', JSON.stringify(next));
    if (error) throw Object.assign(new Error(error), { status: 400 });
    return { saved, chunks, caught };
  }
  onCron('binotel', 'Binotel: журнал дзвінків (раз на 5 хв)', () => step());

  const state = async () => {
    const cur = await creds();
    const st = cur.sync;
    const n = (await db.get(`SELECT COUNT(*) AS n FROM tel_calls`))?.n || 0;
    const now = Math.floor(Date.now() / 1000);
    const span = Math.max(1, now - (Number(st.from) || now));
    return {
      configured: Boolean(cur.key && cur.secret), key: hint(cur.key), secret: cur.secret ? MASK : '',
      sync: { at: st.at || '', error: st.error || '', error_at: st.error_at || '', calls: n, done: Boolean(st.done),
        to: st.to ? kyivAt(Number(st.to)) : '', pct: st.done ? 100 : st.to ? Math.min(99, Math.round(((Number(st.to) - Number(st.from)) / span) * 100)) : 0 },
    };
  };

  app.get('/api/tel/settings', async (c) => { need(c, 'api'); return c.json(await state()); });

  app.put('/api/tel/settings', async (c) => {
    need(c, 'api');
    const b = await c.req.json();
    if (b.clear) {
      await db.run(`DELETE FROM settings WHERE key IN ('binotel_key', 'binotel_secret', 'binotel_sync')`);
      return c.json(await state());
    }
    const cur = await creds();
    const fresh = (v) => { const t = String(v ?? '').trim(); return t && !t.startsWith(MASK) ? t : ''; };
    const key = fresh(b.key) || cur.key;
    const secret = fresh(b.secret) || cur.secret;
    if (!key || !secret) throw fail(400, 'Вкажіть ключ і секрет Binotel (Binotel → Налаштування → API).');
    if (key.length > 200 || secret.length > 200) throw fail(400, 'Задовгий ключ або секрет.');
    // перевіряємо доступ: журнал за останні 10 хв
    const now = Math.floor(Date.now() / 1000);
    await binotelCallsForPeriod(fetchFn, { key, secret }, now - 600, now);
    await db.batch([
      [`INSERT INTO settings (key, value) VALUES ('binotel_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key]],
      [`INSERT INTO settings (key, value) VALUES ('binotel_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [secret]],
    ]);
    return c.json(await state());
  });

  app.post('/api/tel/sync', async (c) => {
    need(c, 'api');
    const r = await step({ force: true });
    return c.json({ ...r, ...(await state()) });
  });

  // Позначки дзвінків для замовлень: list — [{ key, phones: [...], at: 'YYYY-MM-DD HH:MM:SS' (створення) }].
  // Повертає null, якщо Binotel не налаштовано; інакше Map key → { before, after }, де кожне —
  // { n, answered, last: { at, dir, disp, billsec, who } | null }.
  async function marks(list) {
    const cur = await creds();
    if (!cur.key || !cur.secret) return null;
    const phones = [...new Set(list.flatMap((o) => o.phones.map(phone9)).filter(Boolean))];
    const calls = phones.length ? await db.all(
      `SELECT phone9, at, dir, disp, billsec, who FROM tel_calls WHERE phone9 IN (SELECT value FROM json_each(?)) ORDER BY at`,
      [JSON.stringify(phones)],
    ) : [];
    const byPhone = new Map();
    for (const r of calls) { if (!byPhone.has(r.phone9)) byPhone.set(r.phone9, []); byPhone.get(r.phone9).push(r); }
    const sum = (arr) => ({ n: arr.length, answered: arr.filter((r) => r.disp === 'ANSWER' && r.billsec > 0).length,
      last: arr.length ? (({ phone9: _p, ...r }) => r)(arr[arr.length - 1]) : null });
    const out = new Map();
    for (const o of list) {
      const mine = [...new Set(o.phones.map(phone9).filter(Boolean))].flatMap((p) => byPhone.get(p) || []).sort((a, b) => (a.at < b.at ? -1 : 1));
      const at = String(o.at || '').slice(0, 19);
      const lo = at ? shiftAt(at, -BEFORE_DAYS) : '';
      const hi = at ? shiftAt(at, AFTER_DAYS) : '';
      out.set(o.key, {
        before: sum(mine.filter((r) => r.at >= lo && r.at <= at)),
        after: sum(mine.filter((r) => r.at > at && r.at <= hi)),
      });
    }
    return out;
  }

  return { marks, step, configured: async () => { const c = await creds(); return Boolean(c.key && c.secret); } };
}
