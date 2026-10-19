// Модуль «Адміністрування»: перенесення налаштувань між копіями (експорт/імпорт) і журнал змін.
import { fail, need, nowIso, loadSettings } from '../../core/common.js';
import { dropUnsafeImages } from '../../core/validate.js';
import { logAudit } from '../../core/requisites.js';

export function mountAdmin(app, { db }) {
  const settings = () => loadSettings(db);

  // ---------- Перенесення налаштувань між копіями (локально ⇄ Cloudflare) ----------
  const EXPORT_TABLES = ['templates', 'fops', 'offices', 'channels', 'inv_fops'];
  // Історія накладних — лише у файлі (для перенесення в окремий сервіс накладних); тут не імпортується.
  const HISTORY_TABLES = ['order_prefs', 'versions'];
  const EXPORT_SETTINGS = ['lpcrm_subdomain', 'lpcrm_search_days', 'default_fop_id', 'checkbox_enabled', 'checkbox_search_days',
    'invoice_date_mode', 'rahunok_next_number', 'retention_days', 'seller_note'];
  const SECRET_COLS = new Set(['checkbox_password', 'checkbox_pin', 'checkbox_license', 'checkbox_login']);

  app.get('/api/admin/export', async (c) => {
    need(c, 'users');
    const out = { version: 1, exported_at: nowIso(), tables: {}, settings: {} };
    for (const t of [...EXPORT_TABLES, ...HISTORY_TABLES]) {
      out.tables[t] = (await db.all(`SELECT * FROM ${t}`)).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLS.has(k))));
    }
    const s = await settings();
    for (const k of EXPORT_SETTINGS) if (s[k] !== undefined) out.settings[k] = s[k];
    return c.json(out);
  });

  // Журнал змін (власник і адміни): ?kind=fop&ref=3 — для одного ФОП.
  app.get('/api/audit', async (c) => {
    need(c, 'users');
    const kind = String(c.req.query('kind') || '');
    const ref = String(c.req.query('ref') || '');
    const rows = await db.all(
      `SELECT id, at, user_name, kind, ref_id, action, changes FROM audit_log
       ${kind ? `WHERE kind = ?${ref ? ' AND ref_id = ?' : ''}` : ''} ORDER BY id DESC LIMIT 100`,
      kind ? (ref ? [kind, ref] : [kind]) : [],
    );
    return c.json(rows.map((r) => ({ ...r, changes: JSON.parse(r.changes || '[]') })));
  });

  app.post('/api/admin/import', async (c) => {
    need(c, 'users');
    const b = await c.req.json();
    if (!b?.tables) throw fail(400, 'Це не файл експорту налаштувань.');
    const counts = {};
    // Усе одним пакетом (транзакція): якщо щось не так — жодна таблиця не залишиться напівпорожньою.
    const st = [];
    for (const t of EXPORT_TABLES) {
      const rows = b.tables[t];
      if (!Array.isArray(rows)) continue;
      const cols = new Set((await db.all(`PRAGMA table_info(${t})`)).map((x) => x.name));
      st.push([`DELETE FROM ${t}`, []]);
      for (const r0 of rows) {
        const r = dropUnsafeImages(r0 || {});
        const keys = Object.keys(r).filter((k) => cols.has(k) && !SECRET_COLS.has(k));
        if (!keys.length) continue;
        st.push([`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => r[k])]);
      }
      counts[t] = rows.length;
    }
    for (const [k, v] of Object.entries(b.settings || {})) {
      if (!EXPORT_SETTINGS.includes(k)) continue;
      if (k === 'lpcrm_subdomain' && !/^[a-z0-9-]{1,63}$/i.test(String(v).trim())) continue;
      st.push([`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [k, String(v)]]);
    }
    await db.batch(st);
    await logAudit(db, { user: c.get('user'), kind: 'settings', action: 'імпорт налаштувань', changes: Object.entries(counts).map(([field, n]) => ({ field, from: '', to: `${n} рядків` })) });
    return c.json({ ok: true, counts });
  });
}
