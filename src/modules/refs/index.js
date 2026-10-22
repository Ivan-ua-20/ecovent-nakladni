// Модуль «Довідники»: стартові дані інтерфейсу (bootstrap), загальні налаштування, ФОПи накладних,
// відділи LP-CRM, значення «Поле 1» (канали) і шаблони накладних.
import { can, publicUser } from '../../core/auth.js';
import { MASK, fail, need, parseTpl, loadSettings } from '../../core/common.js';
import { DEFAULT_WARNING } from '../../core/schema.js';
import { checkImages } from '../../core/validate.js';
import { FOP_REQUISITES, REQUISITES_DENIED, changedFields, describeChanges, logAudit } from '../../core/requisites.js';
import { hasCheckbox, testCheckbox } from '../../integrations/checkbox.js';

const SECRET_FOP_FIELDS = ['checkbox_password', 'checkbox_pin', 'checkbox_license'];
const FOP_FIELDS = [
  'short_name', 'full_name', 'ipn', 'address', 'iban', 'bank', 'phone', 'email', 'extra',
  'template_id', 'logo', 'signature', 'stamp',
  'checkbox_login', 'checkbox_password', 'checkbox_license', 'checkbox_pin', 'active',
];

const publicFop = (f) => {
  if (!f) return null;
  const out = { ...f };
  for (const k of SECRET_FOP_FIELDS) out[k] = f[k] ? MASK : '';
  out.has_checkbox = hasCheckbox(f);
  return out;
};

export function mountRefs(app, { db, fetchFn }) {
  const settings = () => loadSettings(db);

  // ---------- Довідники ----------
  app.get('/api/bootstrap', async (c) => {
    const user = c.get('user');
    // Партнерові — лише він сам (довідники, ФОПи й налаштування сайту йому не потрібні й не показуються).
    if (user.role === 'partner') {
      return c.json({ fops: [], templates: [], offices: [], channels: [], invFops: [], settings: {}, user: publicUser(user) });
    }
    const s = await settings();
    const apiOk = can(user, 'api');
    const fops = (await db.all(`SELECT * FROM fops ORDER BY active DESC, short_name`)).map(publicFop).map((f) => {
      if (apiOk) return f;
      const { checkbox_login, checkbox_password, checkbox_license, checkbox_pin, ...rest } = f;
      return rest;
    });
    const invFops = await db.all(`SELECT * FROM inv_fops ORDER BY active DESC, short_name`);
    const templates = (await db.all(`SELECT * FROM templates ORDER BY id`)).map(parseTpl);
    const offices = await db.all(`SELECT * FROM offices ORDER BY CAST(office_id AS INTEGER)`);
    const channels = await db.all(`SELECT * FROM channels ORDER BY name`);
    return c.json({
      fops,
      templates,
      offices,
      channels,
      invFops,
      defaultWarning: DEFAULT_WARNING,
      user: publicUser(user),
      settings: apiOk
        ? { ...s, lpcrm_key: s.lpcrm_key ? MASK : '', odb_key: s.odb_key ? MASK : '', tg_token: s.tg_token ? MASK : '', tg_secret: '' }
        : Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith('lpcrm_') && !k.startsWith('checkbox_') && !k.startsWith('odb_') && !k.startsWith('tg_')).concat([['lpcrm_key', s.lpcrm_key ? MASK : ''], ['lpcrm_subdomain', s.lpcrm_subdomain || '']])),
    });
  });

  app.put('/api/settings', async (c) => {
    need(c, 'refs.edit');
    const body = await c.req.json();
    const apiKeys = ['lpcrm_subdomain', 'lpcrm_key', 'lpcrm_search_days', 'checkbox_enabled', 'checkbox_search_days', 'odb_key', 'odb_name'];
    const general = ['invoice_date_mode', 'default_fop_id', 'seller_note', 'retention_days', 'rahunok_next_number'];
    const allowed = can(c.get('user'), 'api') ? [...apiKeys, ...general] : general;
    if (body.rahunok_next_number !== undefined && !/^\d{1,12}$/.test(String(body.rahunok_next_number).trim())) throw fail(400, 'Номер рахунку — лише цифри.');
    if (body.retention_days !== undefined && !(Number(body.retention_days) >= 1)) throw fail(400, 'Строк зберігання — щонайменше 1 день.');
    // Піддомен підставляється в адресу LP-CRM: лише літери, цифри й дефіс (інакше ключ міг би піти на чужий сайт).
    if (body.lpcrm_subdomain !== undefined && !/^[a-z0-9-]{1,63}$/i.test(String(body.lpcrm_subdomain).trim())) throw fail(400, 'Піддомен LP-CRM — лише латинські літери, цифри й дефіс.');
    for (const k of allowed) {
      if (body[k] === undefined || body[k] === MASK) continue;
      await db.run(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
        k, String(body[k]).trim(),
      ]);
    }
    return c.json({ ok: true });
  });

  // ---------- ФОПи ----------
  const fopCols = (c, b) => FOP_FIELDS.filter((k) => b[k] !== undefined && b[k] !== MASK && (can(c.get('user'), 'api') || !k.startsWith('checkbox_')));
  app.post('/api/fops', async (c) => {
    need(c, 'refs.edit');
    if (!can(c.get('user'), 'requisites')) throw fail(403, REQUISITES_DENIED);
    const b = await c.req.json();
    if (!b.short_name) return c.json({ error: 'Вкажіть коротку назву ФОП' }, 400);
    checkImages(b, fail);
    const cols = fopCols(c, b);
    const r = await db.run(
      `INSERT INTO fops (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((k) => b[k]),
    );
    const fields = changedFields({}, b, FOP_REQUISITES);
    await logAudit(db, { user: c.get('user'), kind: 'fop', refId: r.lastId, action: 'створено', changes: describeChanges({}, b, fields) });
    return c.json({ id: r.lastId });
  });

  app.put('/api/fops/:id', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    checkImages(b, fail);
    const cur = await db.get(`SELECT * FROM fops WHERE id = ?`, [c.req.param('id')]);
    if (!cur) throw fail(404, 'ФОП не знайдено.');
    const req = changedFields(cur, b, FOP_REQUISITES);
    if (req.length && !can(c.get('user'), 'requisites')) throw fail(403, REQUISITES_DENIED);
    const cols = fopCols(c, b);
    if (!cols.length) return c.json({ ok: true });
    await db.run(`UPDATE fops SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
      ...cols.map((k) => b[k]), cur.id,
    ]);
    if (req.length) await logAudit(db, { user: c.get('user'), kind: 'fop', refId: cur.id, action: 'змінено реквізити', changes: describeChanges(cur, b, req) });
    return c.json({ ok: true });
  });

  app.delete('/api/fops/:id', async (c) => {
    need(c, 'refs.edit');
    await db.run(`UPDATE fops SET active = 0 WHERE id = ?`, [c.req.param('id')]);
    return c.json({ ok: true });
  });

  app.post('/api/fops/:id/checkbox-test', async (c) => {
    need(c, 'api');
    const fop = await db.get(`SELECT * FROM fops WHERE id = ?`, [c.req.param('id')]);
    if (!fop) return c.json({ error: 'ФОП не знайдено' }, 404);
    if (!hasCheckbox(fop)) return c.json({ error: 'Не вказано доступ до Checkbox' }, 400);
    return c.json(await testCheckbox(fetchFn, fop));
  });

  // ---------- Відділи ----------
  app.put('/api/offices', async (c) => {
    need(c, 'refs.edit');
    const list = await c.req.json();
    // Одним пакетом: атомарно і один запит до D1 замість одного на кожен відділ.
    await db.batch((Array.isArray(list) ? list : []).filter((o) => o.office_id).map((o) => [
      `INSERT INTO offices (office_id, name, fop_id, seller_text) VALUES (?, ?, ?, ?)
       ON CONFLICT(office_id) DO UPDATE SET name = excluded.name, fop_id = excluded.fop_id, seller_text = excluded.seller_text`,
      [String(o.office_id).trim(), o.name || '', o.fop_id || null, String(o.seller_text || '').trim()],
    ]));
    return c.json({ ok: true });
  });

  app.put('/api/channels', async (c) => {
    need(c, 'refs.edit');
    const list = await c.req.json();
    // Видалення і вставки — одним пакетом (транзакція): обрив посередині не залишить таблицю порожньою.
    const st = [[`DELETE FROM channels`, []]];
    for (const ch of Array.isArray(list) ? list : []) {
      const name = String(ch.name || '').trim();
      if (!name) continue;
      st.push([`INSERT INTO channels (name, fop_id, seller_text) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET fop_id = excluded.fop_id, seller_text = excluded.seller_text`, [name, ch.fop_id || null, String(ch.seller_text || '').trim()]]);
    }
    await db.batch(st);
    return c.json({ ok: true });
  });

  app.delete('/api/offices/:id', async (c) => {
    need(c, 'refs.edit');
    await db.run(`DELETE FROM offices WHERE office_id = ?`, [c.req.param('id')]);
    return c.json({ ok: true });
  });

  // ---------- Шаблони ----------
  app.post('/api/templates', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    const r = await db.run(`INSERT INTO templates (name, layout, options) VALUES (?, ?, ?)`, [
      b.name || 'Новий шаблон', b.layout || 'classic', JSON.stringify(b.options || {}),
    ]);
    return c.json({ id: r.lastId });
  });

  app.put('/api/templates/:id', async (c) => {
    need(c, 'refs.edit');
    const b = await c.req.json();
    await db.run(`UPDATE templates SET name = ?, layout = ?, options = ? WHERE id = ?`, [
      b.name, b.layout, JSON.stringify(b.options || {}), c.req.param('id'),
    ]);
    return c.json({ ok: true });
  });

  app.delete('/api/templates/:id', async (c) => {
    need(c, 'refs.edit');
    const id = c.req.param('id');
    const used = await db.get(`SELECT COUNT(*) AS n FROM fops WHERE template_id = ? AND active = 1`, [id]);
    if (used?.n) return c.json({ error: 'Шаблон використовується ФОПами — спершу змініть їм шаблон' }, 400);
    await db.run(`DELETE FROM templates WHERE id = ?`, [id]);
    return c.json({ ok: true });
  });
}
