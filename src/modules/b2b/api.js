// Публічне API для партнерів (v1): програміст партнера передає замовлення клієнтів зі своєї CRM / сайту.
// Вхід — API-ключем (Authorization: Bearer ecv_… або X-Api-Key). Ключ діє від імені партнера як «керівник» його команди.
// Записи (створити / змінити / скасувати / файли) йдуть через ті самі маршрути, що й кабінет (/api/b2b/p/…):
// ті самі перевірки, ліміти, історія й сповіщення. Внутрішній виклик несе користувача-ключ у env під символом API_USER,
// який ззовні підробити неможливо. Документація для програміста — /api-docs.html.
import { fail, need, nowIso, API_USER } from '../../core/common.js';
import { randomToken } from '../../core/auth.js';

const PREFIX = 'ecv_';
const MAX_KEYS = 5;
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const userName = (u) => u?.name || u?.login || '';
const isoOk = (s) => /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));

export function mountB2bApi(app, { db, myPartner, tgPartner, CLIENT_STATUS, orderNo, payState, PAY_NAME }) {
  // ---------------------------------------------------------------- ключі
  const keyRow = (k) => ({ id: k.id, name: k.name, prefix: k.prefix, created_by: k.created_by, created_at: k.created_at, last_used_at: k.last_used_at || '', revoked_at: k.revoked_at || '' });
  const keysOf = (partnerId) => db.all(`SELECT * FROM b2b_api_keys WHERE partner_id = ? ORDER BY revoked_at IS NOT NULL AND revoked_at != '', id DESC`, [partnerId]);

  async function createKey(partnerId, name, by) {
    const n = (await db.get(`SELECT COUNT(*) AS n FROM b2b_api_keys WHERE partner_id = ? AND COALESCE(revoked_at, '') = ''`, [partnerId])).n;
    if (n >= MAX_KEYS) throw fail(400, `Уже ${MAX_KEYS} активних ключів — відкличте непотрібний.`);
    const title = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'API';
    const key = `${PREFIX}${randomToken(24)}`;
    const now = nowIso();
    const r = await db.run(`INSERT INTO b2b_api_keys (partner_id, name, prefix, hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [partnerId, title, key.slice(0, 10), await sha256(key), by, now]);
    await tgPartner(partnerId, `🔑 Створено API-ключ «${title}» (${key.slice(0, 10)}…) — ${by}. Якщо це не ви, відкличте його в кабінеті: Налаштування → API.`).catch(() => 0);
    return { id: r.lastId, name: title, key, prefix: key.slice(0, 10), created_at: now };
  }
  async function revokeKey(partnerId, id, by) {
    const r = await db.run(`UPDATE b2b_api_keys SET revoked_at = ?, revoked_by = ? WHERE id = ? AND partner_id = ? AND COALESCE(revoked_at, '') = ''`, [nowIso(), by, id, partnerId]);
    if (!r.changes) throw fail(404, 'Ключ не знайдено або вже відкликано.');
  }

  // кабінет партнера (керівник)
  app.get('/api/b2b/p/api-keys', async (c) => {
    const p = await myPartner(c);
    need(c, 'b2b.team');
    return c.json((await keysOf(p.id)).map(keyRow));
  });
  app.post('/api/b2b/p/api-keys', async (c) => {
    const p = await myPartner(c);
    need(c, 'b2b.team');
    if (c.get('user')?.api_key_id) throw fail(403, 'Ключі створюються лише в кабінеті.');
    return c.json(await createKey(p.id, (await c.req.json().catch(() => ({}))).name, userName(c.get('user'))));
  });
  app.delete('/api/b2b/p/api-keys/:id', async (c) => {
    const p = await myPartner(c);
    need(c, 'b2b.team');
    if (c.get('user')?.api_key_id) throw fail(403, 'Ключі відкликаються лише в кабінеті.');
    await revokeKey(p.id, c.req.param('id'), userName(c.get('user')));
    return c.json({ ok: true });
  });
  // адмінка: ключі будь-якого партнера
  app.get('/api/b2b/partners/:id/api-keys', async (c) => {
    need(c, 'b2b.view');
    return c.json((await keysOf(Number(c.req.param('id')))).map(keyRow));
  });
  app.post('/api/b2b/partners/:id/api-keys', async (c) => {
    need(c, 'b2b.admin');
    const pid = Number(c.req.param('id'));
    if (!(await db.get(`SELECT id FROM b2b_partners WHERE id = ? AND active = 1`, [pid]))) throw fail(404, 'Партнера не знайдено.');
    return c.json(await createKey(pid, (await c.req.json().catch(() => ({}))).name, userName(c.get('user'))));
  });
  app.delete('/api/b2b/partners/:id/api-keys/:kid', async (c) => {
    need(c, 'b2b.admin');
    await revokeKey(Number(c.req.param('id')), c.req.param('kid'), userName(c.get('user')));
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- вхід ключем
  app.use('/api/v1/*', async (c, next) => {
    const auth = c.req.header('authorization') || '';
    const key = (auth.match(/^Bearer\s+(\S+)$/i)?.[1] || c.req.header('x-api-key') || '').trim();
    if (!key.startsWith(PREFIX)) throw fail(401, 'Потрібен API-ключ: заголовок Authorization: Bearer ecv_…');
    const k = await db.get(`SELECT k.*, p.name AS partner_name FROM b2b_api_keys k JOIN b2b_partners p ON p.id = k.partner_id
      WHERE k.hash = ? AND COALESCE(k.revoked_at, '') = '' AND p.active = 1`, [await sha256(key)]);
    if (!k) throw fail(401, 'Невірний або відкликаний API-ключ.');
    // остання активність — не частіше разу на хвилину (менше записів у базу)
    if (!k.last_used_at || Date.now() - Date.parse(k.last_used_at) > 60000) {
      await db.run(`UPDATE b2b_api_keys SET last_used_at = ?, last_ip = ? WHERE id = ?`, [nowIso(), (c.req.header('cf-connecting-ip') || '').slice(0, 64), k.id]);
    }
    const user = { id: 0, login: 'api', name: `API · ${k.name}`, role: 'partner', partner_role: 'head', partner_id: k.partner_id, active: 1, api_key_id: k.id };
    c.set('user', user);
    c.set('apiKey', k);
    await next();
  });

  // Внутрішній виклик маршруту кабінету від імені ключа. Помилку віддаємо як є (статус і текст).
  async function call(c, method, path, { json, raw, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (raw) init.body = raw;
    else if (json !== undefined) { init.body = JSON.stringify(json); init.headers['Content-Type'] = 'application/json'; }
    let ctx;
    try { ctx = c.executionCtx; } catch { ctx = undefined; }
    const r = await app.request(path, init, { ...(c.env || {}), [API_USER]: c.get('user') }, ctx);
    const j = await r.json().catch(() => ({}));
    if (r.status >= 400) throw fail(r.status, j.error || 'Помилка');
    return j;
  }

  // ---------------------------------------------------------------- формат відповідей v1 (стабільний)
  const statusOut = (o) => ({ status: o.status, status_name: CLIENT_STATUS[o.status] || o.status });
  function orderOut(o, items, files = null, missing = null) {
    return {
      id: o.id,
      number: orderNo(o.id),
      external_id: o.ext_id || null,
      ...statusOut(o),
      crm: { order_id: o.crm_id || null, status: o.status === 'crm' ? o.crm_status || null : null },
      client: { name: o.client_name, phone: o.client_phone },
      ttn: o.ttn || null,
      comment: o.comment || '',
      total: o.total,
      supply: o.supply_id ? { id: o.supply_id, number: orderNo(o.supply_id) } : null,
      ...(o.pay ? { pay: o.pay, pay_name: o.pay_name } : {}),
      pending_changes: Boolean(o.pending),
      items: items.map((i) => ({ product_id: i.product_id, article: i.article || '', name: i.name, qty: i.qty, price: i.price, rrp: i.rrp || 0 })),
      ...(files ? { files: files.map((f) => ({ id: f.id, kind: f.kind, kind_name: f.kind_name, doc_type_id: f.doc_type || null, name: f.name, size: f.size, created_at: f.created_at })) } : {}),
      ...(missing ? { missing_docs: missing } : {}),
      created_at: o.created_at,
      updated_at: o.updated_at,
    };
  }
  // № замовлення: 123 або B2B-123; лише свої замовлення клієнтів.
  async function findOrder(c) {
    const ref = String(c.req.param('ref') || '');
    const id = Number(ref.replace(/^B2B-/i, ''));
    const o = Number.isInteger(id) && id > 0 ? await db.get(`SELECT id FROM b2b_orders WHERE id = ? AND partner_id = ? AND kind = 'client'`, [id, c.get('user').partner_id]) : null;
    if (!o) throw fail(404, `Замовлення ${ref} не знайдено.`);
    return o.id;
  }
  async function getOrder(c, id) {
    const d = await call(c, 'GET', `/api/b2b/p/clients/${id}`);
    const ext = await db.get(`SELECT ext_id FROM b2b_orders WHERE id = ?`, [id]);
    return orderOut({ ...d.order, ext_id: ext?.ext_id }, d.items, d.files, d.missing);
  }
  // Тіло замовлення v1 → тіло кабінету. Товар — product_id або article (артикул з каталогу партнера).
  async function orderIn(c, b) {
    if (!b || typeof b !== 'object') throw fail(400, 'Очікується JSON.');
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) throw fail(400, 'items: додайте хоча б один товар.');
    let byArticle = null;
    if (items.some((i) => !i.product_id && i.article)) {
      const cat = await call(c, 'GET', '/api/b2b/p/catalog');
      byArticle = new Map(cat.products.filter((p) => p.article).map((p) => [String(p.article).trim().toLowerCase(), p.id]));
    }
    const out = items.map((i, n) => {
      const pid = parseInt(i.product_id, 10) || byArticle?.get(String(i.article || '').trim().toLowerCase());
      if (!pid) throw fail(400, `items[${n}]: товар ${i.article ? `з артикулом «${i.article}» не знайдено в каталозі` : 'не вказано (product_id або article)'}.`);
      const qty = Number(i.qty);
      if (!Number.isInteger(qty) || qty <= 0 || qty > 999) throw fail(400, `items[${n}]: qty — ціле число від 1 до 999.`);
      return { product_id: pid, qty };
    });
    const client = b.client || {};
    const supplyId = parseInt(String(b.supply_id ?? b.supply ?? '').replace(/^B2B-/i, ''), 10) || 0;
    return {
      client_name: client.name ?? b.client_name, client_phone: client.phone ?? b.client_phone,
      ttn: b.ttn ?? '', comment: b.comment ?? '', supply_id: supplyId || '', into: b.into === 'open' ? 'new' : (parseInt(b.into, 10) || ''), items: out,
    };
  }
  const extIdOf = (b) => {
    const v = b?.external_id;
    if (v == null || v === '') return '';
    const s = String(v).trim();
    if (!/^[\w.:/#-]{1,64}$/.test(s)) throw fail(400, 'external_id: до 64 символів — латиниця, цифри, . _ - : / #');
    return s;
  };

  // ---------------------------------------------------------------- методи v1
  app.get('/api/v1/me', async (c) => {
    const k = c.get('apiKey');
    return c.json({ partner: { id: k.partner_id, name: k.partner_name }, key: { name: k.name, prefix: k.prefix } });
  });

  app.get('/api/v1/products', async (c) => {
    const d = await call(c, 'GET', '/api/b2b/p/catalog');
    const cats = new Map(d.categories.map((x) => [x.id, x.name]));
    return c.json({
      products: d.products.map((p) => ({
        product_id: p.id, article: p.article || '', name: p.name, brand: p.brand, category: cats.get(p.cat) || '', image: p.image || '',
        rrp: p.rrp, price: p.price, price_warehouse: p.price_wh, special: p.special, special_until: p.special_until || null, is_new: p.is_new,
        ...(p.rrp_new ? { next_price: { rrp: p.rrp_new, price: p.price_new, price_warehouse: p.price_wh_new, from: p.grace_until } } : {}),
      })).sort((a, b) => a.name.localeCompare(b.name, 'uk')),
    });
  });

  app.get('/api/v1/supplies', async (c) => {
    const d = await call(c, 'GET', '/api/b2b/p/supplies');
    return c.json({ supplies: d.map((s) => ({ id: s.id, number: s.number, status: s.status, status_name: s.status_name, pay: s.pay, created_at: s.created_at,
      items: s.items.map((i) => ({ product_id: i.product_id, article: i.article || '', name: i.name, price: i.price, qty: i.qty, left: i.left })) })) });
  });

  app.get('/api/v1/doc-types', async (c) => {
    const d = await call(c, 'GET', '/api/b2b/p/doc-types');
    return c.json({ doc_types: d.map((t) => ({ id: t.id, name: t.name, required: Boolean(t.required) })) });
  });

  app.get('/api/v1/statuses', async (c) => {
    // статуси LP-CRM — ті, що вже траплялися в замовленнях цього партнера
    const crm = await db.all(`SELECT crm_status AS name, COUNT(*) AS orders FROM b2b_orders WHERE partner_id = ? AND kind = 'client' AND status = 'crm' AND COALESCE(crm_status, '') != '' GROUP BY crm_status ORDER BY orders DESC`, [c.get('user').partner_id]);
    return c.json({ statuses: Object.entries(CLIENT_STATUS).map(([id, name]) => ({ id, name })), crm_statuses: crm });
  });

  // Список: для синхронізації — updated_since (ISO) і сортування за updated_at; інакше — найновіші.
  app.get('/api/v1/orders', async (c) => {
    const pid = c.get('user').partner_id;
    const q = c.req.query();
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    const where = ['o.partner_id = ?', "o.kind = 'client'"];
    const params = [pid];
    if (q.updated_since) { if (!isoOk(q.updated_since)) throw fail(400, 'updated_since — дата ISO 8601, напр. 2026-11-06T10:00:00Z.'); where.push('o.updated_at > ?'); params.push(new Date(q.updated_since).toISOString()); }
    if (q.status) { if (!CLIENT_STATUS[q.status]) throw fail(400, `status — одне з: ${Object.keys(CLIENT_STATUS).join(', ')}.`); where.push('o.status = ?'); params.push(q.status); }
    if (q.external_id) { where.push('o.ext_id = ?'); params.push(String(q.external_id)); }
    const rows = await db.all(`SELECT o.*, s.status AS supply_status FROM b2b_orders o LEFT JOIN b2b_orders s ON s.id = o.supply_id WHERE ${where.join(' AND ')} ORDER BY ${q.updated_since ? 'o.updated_at, o.id' : 'o.id DESC'} LIMIT ?`, [...params, limit + 1]);
    const page = rows.slice(0, limit);
    const items = page.length ? await db.all(`SELECT order_id, product_id, name, article, qty, price, rrp FROM b2b_order_items WHERE order_id IN (SELECT value FROM json_each(?)) ORDER BY id`, [JSON.stringify(page.map((o) => o.id))]) : [];
    const by = items.reduce((m, i) => m.set(i.order_id, [...(m.get(i.order_id) || []), i]), new Map());
    return c.json({ orders: page.map((o) => orderOut({ ...o, pay: payState(o), pay_name: PAY_NAME[payState(o)] }, by.get(o.id) || [])), has_more: rows.length > limit, ...(q.updated_since && page.length ? { next_updated_since: page[page.length - 1].updated_at } : {}) });
  });

  app.get('/api/v1/orders/:ref', async (c) => c.json(await getOrder(c, await findOrder(c))));

  // Створити. Повторний запит з тим самим external_id не створює дубль — повертає наявне замовлення (duplicate: true).
  app.post('/api/v1/orders', async (c) => {
    const b = await c.req.json().catch(() => null);
    const ext = extIdOf(b);
    const pid = c.get('user').partner_id;
    if (ext) {
      const was = await db.get(`SELECT id FROM b2b_orders WHERE partner_id = ? AND kind = 'client' AND ext_id = ?`, [pid, ext]);
      if (was) return c.json({ duplicate: true, order: await getOrder(c, was.id) });
    }
    const r = await call(c, 'POST', '/api/b2b/p/clients', { json: await orderIn(c, b) });
    if (ext) await db.run(`UPDATE b2b_orders SET ext_id = ? WHERE id = ?`, [ext, r.id]);
    return c.json({ duplicate: false, order: await getOrder(c, r.id) }, 201);
  });

  // Змінити — доки замовлення «new» (не передане в роботу). Тіло — як при створенні, повністю.
  app.put('/api/v1/orders/:ref', async (c) => {
    const id = await findOrder(c);
    const b = await c.req.json().catch(() => null);
    await call(c, 'PUT', `/api/b2b/p/clients/${id}`, { json: await orderIn(c, b) });
    return c.json({ order: await getOrder(c, id) });
  });

  app.post('/api/v1/orders/:ref/cancel', async (c) => {
    const id = await findOrder(c);
    await call(c, 'POST', `/api/b2b/p/clients/${id}/cancel`, { json: { confirm: true } });
    return c.json({ order: await getOrder(c, id) });
  });

  // Файл: маркування (етикетка ТТН, PDF) або документ партнера (doc_type_id). Тіло — сам файл (application/pdf, image/*)
  // з ?kind=…&filename=…, або JSON { kind, doc_type_id, filename, content_base64 }.
  app.post('/api/v1/orders/:ref/files', async (c) => {
    const id = await findOrder(c);
    const ct = (c.req.header('content-type') || '').toLowerCase();
    let kind = c.req.query('kind') || 'label';
    let typeId = parseInt(c.req.query('doc_type_id'), 10) || 0;
    let name = c.req.query('filename') || '';
    let bytes;
    let mime = ct.split(';')[0];
    if (ct.startsWith('application/json')) {
      const b = await c.req.json().catch(() => ({}));
      kind = b.kind || kind;
      typeId = parseInt(b.doc_type_id, 10) || typeId;
      name = b.filename || name;
      try {
        const bin = atob(String(b.content_base64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, ''));
        bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      } catch { throw fail(400, 'content_base64 — невірний base64.'); }
      mime = b.mime || (bytes[0] === 0x25 && bytes[1] === 0x50 ? 'application/pdf' : 'application/octet-stream');
    } else bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!bytes?.length) throw fail(400, 'Порожній файл.');
    if (bytes.length > 5 * 1024 * 1024) throw fail(400, 'Файл більший за 5 МБ.');
    if (!['label', 'doc'].includes(kind)) throw fail(400, 'kind — label (маркування) або doc (документ).');
    if (kind === 'doc' && !typeId) throw fail(400, 'Для документа вкажіть doc_type_id (див. GET /api/v1/doc-types).');
    const r = await call(c, 'POST', `/api/b2b/p/clients/${id}/files${kind === 'doc' ? `?type=${typeId}` : ''}`, {
      raw: bytes, headers: { 'Content-Type': mime || 'application/octet-stream', 'X-File-Name': encodeURIComponent(String(name || (kind === 'label' ? 'label.pdf' : 'document')).slice(0, 120)) },
    });
    return c.json({ file_id: r.id, warnings: r.warnings || [], order: await getOrder(c, id) }, 201);
  });

  app.delete('/api/v1/orders/:ref/files/:fid', async (c) => {
    const id = await findOrder(c);
    await call(c, 'DELETE', `/api/b2b/p/clients/${id}/files/${parseInt(c.req.param('fid'), 10) || 0}`);
    return c.json({ order: await getOrder(c, id) });
  });

  // Невідомий метод v1 — зрозуміла помилка замість порожньої відповіді.
  app.all('/api/v1/*', () => { throw fail(404, 'Невідомий метод API. Документація: /api-docs.html'); });
}
