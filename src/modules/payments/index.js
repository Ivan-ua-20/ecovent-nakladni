// Opendatabot IBAN: рахунки (ФОП/ТОВ/ПП), посилання на оплату з QR, надходження з усіх «Автоклієнтів».
// Документація: https://iban.opendatabot.ua/api-docs
import { takeRahunokNumber, peekRahunokNumber } from '../../core/counters.js';
import { can } from '../../core/auth.js';
import { fail, need, nowIso, userName, round2, num, loadSettings, putSetting as putSettingDb } from '../../core/common.js';

export const ODB_BASE = 'https://iban.opendatabot.ua';

// 10 цифр — РНОКПП (ФОП), 8 — ЄДРПОУ (ТОВ, ПП та інші юрособи)
export const kindOf = (code) => (/^\d{10}$/.test(String(code || '').trim()) ? 'fop' : 'company');

const kyivParts = (d) => {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return f.format(d).replace(' ', 'T');
};
// Дата платежу → «YYYY-MM-DDTHH:MM:SS» за київським часом
export function normDate(v) {
  const s = String(v ?? '').trim();
  let m = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
  m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return `${m[1]}T${m[2] || '00'}:${m[3] || '00'}:${m[4] || '00'}`;
  const d = new Date(s);
  if (s && !Number.isNaN(d.getTime())) return kyivParts(d);
  return kyivParts(new Date());
}

async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(key, body) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const sameHex = (a, b) => {
  a = String(a || '').trim().toLowerCase(); b = String(b || '').trim().toLowerCase();
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

// Платіж з повідомлення / стрічки транзакцій → рядок бази (лише надходження).
// Ключ — хеш змістовних полів: однаковий для повідомлення і для стрічки, тож дублів не буде.
export async function txRow(item) {
  const t = item?.transaction || {};
  const type = String(t.transactionType || '').toLowerCase();
  const amount = round2(num(t.amount));
  if (type === 'debit' || (!type && amount <= 0) || amount <= 0) return null;
  const date = normDate(t.date);
  const id = await sha1([String(t.date ?? ''), amount.toFixed(2), t.iban || '', t.counterpartyAcc || t.counterpartyEdrpou || '', t.purpose || ''].join('|'));
  // Можливі рахунки: за документацією Opendatabot — { matches, transaction, invoice: { id } };
  // підтримуємо й простий { id } або рядок з id.
  const possible = (Array.isArray(item.possibleInvoices) ? item.possibleInvoices : [])
    .map((p) => (typeof p === 'object' && p !== null ? p.invoice?.id ?? p.id : p))
    .filter((v) => v != null && typeof v !== 'object' && String(v) !== '')
    .map(String);
  return {
    id,
    date,
    amount,
    currency: String(t.currency || 'UAH').toUpperCase(),
    purpose: String(t.purpose || ''),
    iban: String(t.iban || '').replace(/\s/g, '').toUpperCase(),
    payer_name: String(t.counterpartyName || '').trim(),
    payer_code: String(t.counterpartyEdrpou || '').trim(),
    payer_acc: String(t.counterpartyAcc || '').replace(/\s/g, '').toUpperCase(),
    our_code: String(t.edrpou || '').trim(),
    invoice_id: item.invoice?.id ? String(item.invoice.id) : null,
    possible: JSON.stringify(possible.slice(0, 10)),
    config_id: item.autoclientConfigId ? String(item.autoclientConfigId) : '',
  };
}

// Назва отримувача з налаштувань IBAN: назва, яку ви задали, або отримувач, як його показує Opendatabot.
function pickName(x) {
  for (const k of ['alias', 'name', 'recipient', 'recipientName', 'receiver', 'receiverName', 'title', 'companyName', 'ownerName', 'fullName', 'counterpartyName']) {
    const v = x?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim()) return v.name.trim();
  }
  // запасний варіант: будь-яке текстове поле, схоже на назву (літери і пробіл)
  for (const [k, v] of Object.entries(x || {})) {
    if (['id', 'iban', 'code', 'fileId', 'logoUrl'].includes(k) || typeof v !== 'string') continue;
    if (/[A-Za-zА-Яа-яІіЇїЄєҐґ]{2,}\s+[A-Za-zА-Яа-яІіЇїЄєҐґ«"]/.test(v) && !/^https?:/.test(v)) return v.trim();
  }
  return '';
}

// Банк за МФО в IBAN (6 цифр після «UAxx»)
const BANKS = { 305299: 'Приват', 322001: 'моно', 300465: 'Ощад', 300528: 'ОТП', 380805: 'Райффайзен', 334851: 'ПУМБ', 351005: 'УкрСиббанк', 320478: 'Укргазбанк', 322313: 'Укрексімбанк', 380775: 'Креді Агріколь', 339500: 'Глобус', 325365: 'Кредобанк', 336503: 'Ідея Банк', 320649: 'Sense', 380838: 'Південний', 313849: 'Таскомбанк' };
export const bankOf = (iban) => BANKS[String(iban || '').replace(/\s/g, '').slice(4, 10)] || '';
const ACC = `COALESCE(NULLIF(a.name, ''), NULLIF(a.alias, ''), a.iban)`;

export function mountOdb(app, { db, fetchFn, base = ODB_BASE, notify = async () => 0 }) {
  const settings = () => loadSettings(db);
  const putSetting = (key, value) => putSettingDb(db, key, value);
  async function creds() {
    const s = await settings();
    if (!s.odb_key || !s.odb_name) throw fail(400, 'Opendatabot не підключено: вкажіть ключ і назву клієнта в «Налаштуваннях рахунків».');
    return { key: s.odb_key, name: s.odb_name, s };
  }
  async function odb(cr, method, path, body) {
    const r = await fetchFn(`${base}${path}`, {
      method,
      headers: { 'x-client-key': cr.key, 'x-client-name': cr.name, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch { /* не JSON */ }
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw fail(400, 'Opendatabot: невірний ключ або назва клієнта.');
      if (r.status === 402) throw fail(400, 'Opendatabot: доступ призупинено через неоплачені рахунки сервісу.');
      const det = Array.isArray(j?.errors) ? j.errors.map((e) => e.message || e.field).join('; ') : '';
      throw fail(502, `Opendatabot: ${j?.message || `помилка ${r.status}`}${det ? ` (${det})` : ''}`);
    }
    return j || {};
  }

  // Рахунки, з яких приходять платежі (усі «Автоклієнти»), навіть якщо їх немає в налаштуваннях IBAN.
  // Такі рахунки мають id «iban:UA…» і лише показують платежі; щоб створювати на них посилання — «Додати в Opendatabot».
  async function addSeenAccounts() {
    await db.batch([
      [`UPDATE odb_accounts SET code = (SELECT MAX(t.our_code) FROM odb_tx t WHERE t.iban = odb_accounts.iban AND t.our_code != '')
        WHERE code = '' AND EXISTS (SELECT 1 FROM odb_tx t WHERE t.iban = odb_accounts.iban AND t.our_code != '')`, []],
      [`INSERT OR IGNORE INTO odb_accounts (id, iban, code, alias, kind, enabled, sort, seen)
        SELECT 'iban:' || t.iban, t.iban, COALESCE(MAX(t.our_code), ''), '', CASE WHEN length(MAX(t.our_code)) = 8 THEN 'company' ELSE 'fop' END, 0, 1000, 1
        FROM odb_tx t WHERE t.iban != '' AND t.iban NOT IN (SELECT iban FROM odb_accounts) GROUP BY t.iban`, []],
      [`UPDATE odb_accounts SET kind = CASE WHEN length(code) = 8 THEN 'company' ELSE 'fop' END WHERE code != ''`, []],
    ]);
  }
  // Назва за замовчуванням: з наших ФОПів (за IBAN або кодом) + банк; інакше — назва з Opendatabot.
  async function fillNames() {
    const empty = await db.all(`SELECT id, iban, code, alias FROM odb_accounts WHERE name = ''`);
    if (!empty.length) return;
    const known = await db.all(`SELECT full_name, short_name, ipn, iban FROM inv_fops UNION ALL SELECT full_name, short_name, ipn, iban FROM fops`);
    const norm = (x) => String(x || '').replace(/\s/g, '').toUpperCase();
    const st = [];
    for (const a of empty) {
      const f = known.find((k) => norm(k.iban) === a.iban) || (a.code ? known.find((k) => String(k.ipn || '').trim() === a.code) : null);
      let base = a.alias || (f ? (f.full_name || f.short_name || '').trim() : '');
      if (f && !/^(ФОП|ТОВ|ПП)(\s|$)/i.test(base) && kindOf(a.code) === 'fop') base = `ФОП ${base}`;
      if (!base) continue;
      const bank = bankOf(a.iban);
      st.push([`UPDATE odb_accounts SET name = ? WHERE id = ?`, [bank && !base.toLowerCase().includes(bank.toLowerCase()) ? `${base} (${bank})` : base, a.id]]);
    }
    await db.batch(st);
  }

  // ---------------------------------------------------------------- рахунки (IBAN) з Opendatabot
  app.get('/api/odb/accounts', async (c) => {
    need(c, 'docs.edit');
    if (c.req.query('refresh')) {
      need(c, 'api');
      const cr = await creds();
      const j = await odb(cr, 'GET', '/api/iban-settings');
      const list = Array.isArray(j.ibanSettings) ? j.ibanSettings : Array.isArray(j) ? j : [];
      const ids = list.map((x) => String(x.id));
      const st = list.map((x, i) => [
        `INSERT INTO odb_accounts (id, iban, code, alias, kind, sort) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET iban = excluded.iban, code = excluded.code, alias = excluded.alias, kind = excluded.kind, sort = excluded.sort`,
        [String(x.id), String(x.iban || '').replace(/\s/g, '').toUpperCase(), String(x.code || ''), pickName(x), kindOf(x.code), i],
      ]);
      // рахунки, яких більше немає в налаштуваннях IBAN, стають «лише платежі» (назва зберігається)
      st.push([`UPDATE odb_accounts SET id = 'iban:' || iban, enabled = 0, seen = 1 WHERE id NOT LIKE 'iban:%' AND id NOT IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM odb_accounts b WHERE b.id = 'iban:' || odb_accounts.iban)`, [JSON.stringify(ids)]]);
      st.push([`DELETE FROM odb_accounts WHERE id NOT LIKE 'iban:%' AND id NOT IN (SELECT value FROM json_each(?))`, [JSON.stringify(ids)]]);
      // назва з Opendatabot («Отримувач») замінює автоматичну; назви, задані вручну (✎), не чіпаємо
      st.push([`UPDATE odb_accounts SET name = '' WHERE name_manual = 0 AND alias != '' AND id NOT LIKE 'iban:%'`, []]);
      await db.batch(st);
    }
    await addSeenAccounts();
    await fillNames();
    // ФОП рахунків з назвою за замовчуванням («ФОП <код>») отримує назву рахунку
    await db.run(`UPDATE inv_fops SET short_name = (SELECT COALESCE(NULLIF(a.name, ''), NULLIF(a.alias, '')) FROM odb_accounts a WHERE a.id = inv_fops.odb_id)
      WHERE odb_id != '' AND short_name = 'ФОП ' || ipn
        AND EXISTS (SELECT 1 FROM odb_accounts a WHERE a.id = inv_fops.odb_id AND COALESCE(NULLIF(a.name, ''), NULLIF(a.alias, '')) IS NOT NULL)`);
    const rows = await db.all(`SELECT id, iban, code, alias AS odb_alias, name, ${ACC} AS alias, kind, enabled, seen FROM odb_accounts a ORDER BY seen, sort, ${ACC}`);
    const s = await settings();
    return c.json({ accounts: rows.map((r) => ({ ...r, bank: bankOf(r.iban) })), connected: Boolean(s.odb_key && s.odb_name) });
  });

  // Увімкнути/вимкнути формування рахунків. ФОП також з'являється у «ФОПах рахунків» (для Word).
  app.put('/api/odb/accounts/:id', async (c) => {
    need(c, 'api');
    const acc = await db.get(`SELECT * FROM odb_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!acc) throw fail(404, 'Рахунок не знайдено — оновіть список.');
    const b = await c.req.json();
    if (b.name !== undefined) {
      // Перейменування: у нас і (для налаштувань IBAN) — в Opendatabot
      const name = String(b.name || '').trim().slice(0, 120);
      const oldName = acc.name || acc.alias || '';
      await db.run(`UPDATE odb_accounts SET name = ?, name_manual = ? WHERE id = ?`, [name, name ? 1 : 0, acc.id]);
      // ФОП рахунків, створений з цього рахунку, отримує нову назву, якщо її ще не змінювали вручну
      if (name) await db.run(`UPDATE inv_fops SET short_name = ? WHERE odb_id = ? AND (short_name = ? OR short_name = ? OR short_name = '')`, [name, acc.id, oldName, `ФОП ${acc.code}`]);
      if (!acc.id.startsWith('iban:') && name) {
        const cr = await creds().catch(() => null);
        if (cr) await odb(cr, 'PUT', `/api/iban-settings/${encodeURIComponent(acc.id)}`, { alias: name }).catch(() => {});
      }
      if (!name) await fillNames();
      return c.json({ ok: true });
    }
    if (acc.id.startsWith('iban:')) throw fail(400, 'Цей рахунок лише в «Автоклієнті». Щоб створювати на нього посилання, натисніть «Додати в Opendatabot».');
    const on = b.enabled ? 1 : 0;
    const st = [[`UPDATE odb_accounts SET enabled = ? WHERE id = ?`, [on, acc.id]]];
    if (acc.kind === 'fop') {
      if (on) {
        const ex = await db.get(`SELECT id FROM inv_fops WHERE odb_id = ? OR REPLACE(UPPER(iban), ' ', '') = ?`, [acc.id, acc.iban]);
        if (ex) st.push([`UPDATE inv_fops SET odb_id = ?, active = 1, short_name = CASE WHEN short_name = ? AND ? != '' THEN ? ELSE short_name END WHERE id = ?`, [acc.id, `ФОП ${acc.code}`, acc.name || acc.alias || '', acc.name || acc.alias || '', ex.id]]);
        else st.push([`INSERT INTO inv_fops (short_name, full_name, ipn, iban, odb_id, active) VALUES (?, '', ?, ?, ?, 1)`, [acc.name || acc.alias || `ФОП ${acc.code}`, acc.code, acc.iban, acc.id]]);
      } else {
        st.push([`UPDATE inv_fops SET active = 0 WHERE odb_id = ?`, [acc.id]]);
      }
    }
    await db.batch(st);
    return c.json({ ok: true });
  });

  // Рахунок з «Автоклієнта» → налаштування IBAN в Opendatabot (тоді на нього можна створювати посилання)
  app.post('/api/odb/accounts/:id/register', async (c) => {
    need(c, 'api');
    const acc = await db.get(`SELECT * FROM odb_accounts WHERE id = ?`, [c.req.param('id')]);
    if (!acc || !acc.id.startsWith('iban:')) throw fail(400, 'Цей рахунок уже є в Opendatabot.');
    const b = await c.req.json().catch(() => ({}));
    const code = String(b.code || acc.code || '').trim();
    if (!/^(\d{8}|\d{10})$/.test(code)) throw fail(400, 'Вкажіть код: ЄДРПОУ (8 цифр) для ТОВ/ПП або РНОКПП (10 цифр) для ФОП.');
    const cr = await creds();
    const r = await odb(cr, 'POST', '/api/iban-settings', { iban: acc.iban, code, alias: acc.name || '' });
    if (!r.id) throw fail(502, 'Opendatabot не повернув ідентифікатор рахунку.');
    await db.batch([
      [`DELETE FROM odb_accounts WHERE id = ?`, [acc.id]],
      [`INSERT OR REPLACE INTO odb_accounts (id, iban, code, alias, kind, enabled, sort, seen, name) VALUES (?, ?, ?, ?, ?, 0, 500, 0, ?)`,
        [String(r.id), acc.iban, code, String(r.alias || ''), kindOf(code), acc.name || '']],
    ]);
    return c.json({ ok: true, id: String(r.id) });
  });

  // ---------------------------------------------------------------- посилання на оплату
  const LINK_COLS = `l.id, l.odb_id, l.number, l.order_ref, l.account_id, l.amount, l.purpose, l.client, l.url, l.page, l.status, l.paid_amount, l.paid_at,
    l.rahunok_id, l.created_at, l.created_by_id, l.created_by, ${ACC} AS account_alias, a.kind AS account_kind, a.iban AS account_iban`;

  const nextManualNumber = () => takeRahunokNumber(db);

  // Створення рахунку в Opendatabot і запис у базу. Дублікати: неоплачене посилання з тим самим номером/замовленням.
  async function createLink(c, { account_id, amount, number, order_ref = '', client = '', purpose = '', force = false, rahunok_id = null }) {
    const acc = await db.get(`SELECT * FROM odb_accounts WHERE id = ?`, [account_id]);
    if (!acc || !acc.enabled) throw fail(400, 'Цей рахунок вимкнено для формування — увімкніть його в налаштуваннях рахунків.');
    const sum = round2(num(amount));
    if (!(sum > 0)) throw fail(400, 'Вкажіть суму більше 0.');
    order_ref = String(order_ref || '').trim();
    if (!force && (order_ref || number)) {
      const dup = await db.get(
        `SELECT ${LINK_COLS} FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id
         WHERE l.account_id = ? AND l.status IN ('pending', 'partial', 'check') AND (${order_ref ? 'l.order_ref = ?' : 'l.number = ?'})
         ORDER BY l.id DESC LIMIT 1`,
        [account_id, order_ref || String(number)],
      );
      if (dup) return { duplicate: dup };
    }
    const no = String(number || order_ref || (await nextManualNumber()));
    const text = String(purpose || '').trim() || `Оплата за рахунком № ${no}`;
    const cr = await creds();
    const j = await odb(cr, 'POST', '/api/invoice', { ibanSettingId: acc.id, amount: sum.toFixed(2), purpose: text, responseMode: 'json' });
    if (!j.id) throw fail(502, 'Opendatabot не повернув номер рахунку.');
    const page = `${base}/invoice/${encodeURIComponent(j.id)}`;
    const me = c.get('user');
    const r = await db.run(
      `INSERT INTO pay_links (odb_id, number, order_ref, account_id, amount, purpose, client, url, page, qr, status, rahunok_id, created_at, created_by_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [String(j.id), no, order_ref, acc.id, sum, text, String(client || '').trim(), String(j.url || page), page, String(j.qrcode || ''), rahunok_id, nowIso(), me.id, userName(c)],
    );
    const link = await db.get(`SELECT ${LINK_COLS}, l.qr FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id WHERE l.id = ?`, [r.lastId]);
    return { link };
  }

  // Для Word-рахунку з QR: те саме посилання, якщо номер і сума не змінились; інакше — нове.
  async function linkForRahunok(c, data) {
    const fop = await db.get(`SELECT odb_id, iban FROM inv_fops WHERE id = ?`, [data.fop.id]);
    const acc = await db.get(
      `SELECT * FROM odb_accounts WHERE enabled = 1 AND kind = 'fop' AND (id = ? OR iban = ?) LIMIT 1`,
      [fop?.odb_id || '', String(fop?.iban || '').replace(/\s/g, '').toUpperCase()],
    );
    if (!acc) throw fail(400, 'Для цього ФОП немає увімкненого рахунку Opendatabot — QR-код додати не можна.');
    const ex = await db.get(
      `SELECT id, page, qr, amount, status FROM pay_links WHERE account_id = ? AND number = ? AND status NOT IN ('closed') ORDER BY id DESC LIMIT 1`,
      [acc.id, data.number],
    );
    if (ex && Math.abs(ex.amount - data.total) < 0.005 && ex.qr) return { link_id: ex.id, page: ex.page, qr: ex.qr };
    if (ex && ['pending', 'check'].includes(ex.status)) await db.run(`UPDATE pay_links SET status = 'closed' WHERE id = ?`, [ex.id]);
    const { link } = await createLink(c, {
      account_id: acc.id, amount: data.total, number: data.number, order_ref: data.source === 'crm' ? data.number : '',
      client: data.client?.name || '', force: true,
    });
    return { link_id: link.id, page: link.page, qr: link.qr };
  }

  app.get('/api/odb/links', async (c) => {
    need(c, 'docs.edit');
    const f = c.req.query('filter') || 'all';
    const mine = c.req.query('mine') === '1';
    const q = String(c.req.query('q') || '').trim();
    const where = [];
    const params = [];
    if (f === 'unpaid') where.push(`l.status IN ('pending', 'partial', 'check')`);
    if (f === 'paid') where.push(`l.status IN ('paid', 'over', 'manual')`);
    if (mine) { where.push('l.created_by_id = ?'); params.push(c.get('user').id); }
    if (q) { where.push('(l.number LIKE ? OR l.order_ref LIKE ? OR l.client LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const rows = await db.all(
      `SELECT ${LINK_COLS} FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY l.id DESC LIMIT 300`, params,
    );
    const s = await settings();
    return c.json({ links: rows, lastSync: s.odb_sync_at || '', nextNumber: peekRahunokNumber(s) });
  });

  app.get('/api/odb/links/:id', async (c) => {
    need(c, 'docs.edit');
    const link = await db.get(`SELECT ${LINK_COLS}, l.qr FROM pay_links l LEFT JOIN odb_accounts a ON a.id = l.account_id WHERE l.id = ?`, [c.req.param('id')]);
    if (!link) throw fail(404, 'Посилання не знайдено.');
    const payments = await db.all(`SELECT id, date, amount, currency, purpose, payer_name, payer_code, manual FROM odb_tx WHERE link_id = ? ORDER BY date`, [link.id]);
    const possible = await db.all(
      `SELECT t.id, t.date, t.amount, t.purpose, t.payer_name FROM odb_tx t, json_each(t.possible) j
       WHERE t.link_id IS NULL AND j.value = ? ORDER BY t.date DESC LIMIT 10`, [link.odb_id],
    );
    return c.json({ link, payments, possible });
  });

  app.post('/api/odb/links', async (c) => {
    need(c, 'docs.edit');
    const b = await c.req.json();
    const r = await createLink(c, {
      account_id: String(b.account_id || ''), amount: b.amount, order_ref: b.order_ref, client: b.client, purpose: b.purpose, force: Boolean(b.force),
    });
    return c.json(r);
  });

  // Закрити неоплачене посилання (у нас; клієнту краще надіслати нове)
  app.post('/api/odb/links/:id/close', async (c) => {
    need(c, 'docs.edit');
    await db.run(`UPDATE pay_links SET status = 'closed' WHERE id = ? AND status IN ('pending', 'check')`, [c.req.param('id')]);
    return c.json({ ok: true });
  });

  // Позначити оплаченим вручну (адміни): і в Opendatabot, і в нас
  app.post('/api/odb/links/:id/paid', async (c) => {
    need(c, 'users');
    const link = await db.get(`SELECT * FROM pay_links WHERE id = ?`, [c.req.param('id')]);
    if (!link) throw fail(404, 'Посилання не знайдено.');
    const cr = await creds();
    await odb(cr, 'POST', `/api/invoice/${encodeURIComponent(link.odb_id)}/paid`);
    await db.run(`UPDATE pay_links SET status = 'manual', paid_at = COALESCE(paid_at, ?) WHERE id = ?`, [nowIso(), link.id]);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- надходження
  async function saveTx(items) {
    const rows = (await Promise.all(items.map(txRow))).filter(Boolean);
    if (!rows.length) return { rows, fresh: 0, freshRows: [] };
    const known = new Set((await db.all(`SELECT id FROM odb_tx WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(rows.map((r) => r.id))])).map((r) => r.id));
    const now = nowIso();
    await db.batch(rows.map((r) => [
      `INSERT INTO odb_tx (id, date, amount, currency, purpose, iban, payer_name, payer_code, payer_acc, invoice_id, possible, config_id, our_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET invoice_id = COALESCE(odb_tx.invoice_id, excluded.invoice_id), possible = excluded.possible, our_code = excluded.our_code`,
      [r.id, r.date, r.amount, r.currency, r.purpose, r.iban, r.payer_name, r.payer_code, r.payer_acc, r.invoice_id, r.possible, r.config_id, r.our_code, now],
    ]));
    await addSeenAccounts();
    const freshRows = rows.filter((r) => !known.has(r.id));
    return { rows, fresh: freshRows.length, freshRows };
  }

  // Прив'язка платежів до наших посилань і перерахунок статусів. Повертає посилання, що щойно стали оплаченими.
  async function relink() {
    const before = await db.all(`SELECT id, status FROM pay_links WHERE status NOT IN ('closed', 'manual')`);
    await db.batch([
      [`UPDATE odb_tx SET link_id = (SELECT p.id FROM pay_links p WHERE p.odb_id = odb_tx.invoice_id)
        WHERE link_id IS NULL AND manual = 0 AND invoice_id IS NOT NULL AND EXISTS (SELECT 1 FROM pay_links p WHERE p.odb_id = odb_tx.invoice_id)`, []],
      [`UPDATE pay_links SET
          paid_amount = (SELECT COALESCE(SUM(t.amount), 0) FROM odb_tx t WHERE t.link_id = pay_links.id),
          paid_at = COALESCE((SELECT MAX(t.date) FROM odb_tx t WHERE t.link_id = pay_links.id), CASE WHEN odb_paid = 1 THEN paid_at END)
        WHERE status NOT IN ('closed', 'manual')`, []],
      [`UPDATE pay_links SET status = CASE
          WHEN paid_amount > amount + 1 THEN 'over'
          WHEN paid_amount >= amount - 1 AND paid_amount > 0 THEN 'paid'
          WHEN paid_amount > 0 THEN 'partial'
          WHEN odb_paid = 1 THEN 'paid'
          WHEN EXISTS (SELECT 1 FROM odb_tx t, json_each(t.possible) j WHERE t.link_id IS NULL AND j.value = pay_links.odb_id) THEN 'check'
          ELSE 'pending' END
        WHERE status NOT IN ('closed', 'manual')`, []],
    ]);
    const after = new Map((await db.all(`SELECT id, status FROM pay_links WHERE status IN ('paid', 'over', 'partial')`)).map((r) => [r.id, r.status]));
    return before.filter((r) => after.has(r.id) && after.get(r.id) !== r.status).map((r) => r.id);
  }

  // Повідомлення «Автоклієнта» про оплату (без входу, перевірка підпису ключем клієнта)
  app.post('/api/odb/hook', async (c) => {
    const raw = await c.req.text();
    const s = await settings();
    if (!s.odb_key) throw fail(400, 'Opendatabot не підключено.');
    const sig = c.req.header('signature') || c.req.header('x-signature') || '';
    if (!sameHex(sig, await hmacHex(s.odb_key, raw))) throw fail(401, 'Невірний підпис.');
    let body;
    try { body = JSON.parse(raw); } catch { throw fail(400, 'Невірний JSON.'); }
    const { fresh, freshRows } = await saveTx([body]);
    const paid = await relink();
    await putSetting('odb_hook_at', nowIso());
    await notify({ linkIds: paid, freshRows }).catch(() => 0);
    return c.json({ ok: true, fresh, paid: paid.length });
  });

  // Звірка: нові надходження (зверху стрічки), поступово — уся історія, і статуси наших рахунків.
  const PAGE = 100;
  app.post('/api/odb/sync', async (c) => {
    need(c, 'docs.edit');
    const b = await c.req.json().catch(() => ({}));
    const s = await settings();
    if (!s.odb_key || !s.odb_name) return c.json({ ok: false, connected: false });
    const last = Date.parse(s.odb_sync_at || '') || 0;
    if (!b.force && Date.now() - last < 60000) return c.json({ ok: true, skipped: true, lastSync: s.odb_sync_at, hist: JSON.parse(s.odb_hist || '{}') });
    await putSetting('odb_sync_at', nowIso());
    const cr = { key: s.odb_key, name: s.odb_name };
    let added = 0;
    const newRows = [];
    // 1) нові: з початку стрічки, доки не підуть уже відомі
    for (let p = 0; p < 5; p++) {
      const j = await odb(cr, 'GET', `/api/transactions?limit=${PAGE}&offset=${p * PAGE}`);
      const items = Array.isArray(j.items) ? j.items : [];
      const { rows, fresh, freshRows } = await saveTx(items);
      added += fresh;
      newRows.push(...freshRows);
      if (items.length < PAGE || (rows.length && fresh === 0)) break;
    }
    // 2) історія — кілька сторінок за раз, з місця, де зупинились
    let hist = {};
    try { hist = JSON.parse(s.odb_hist || '{}'); } catch { /* */ }
    // одноразово перечитати історію, щоб дізнатися коди власників рахунків (нове поле)
    if (!s.odb_hist_v2) { hist = {}; await putSetting('odb_hist_v2', '1'); }
    if (!hist.done) {
      let off = hist.offset || 0;
      for (let p = 0; p < 3; p++) { // небагато сторінок за раз — ліміт процесорного часу Cloudflare
        const j = await odb(cr, 'GET', `/api/transactions?limit=${PAGE}&offset=${off}`);
        const items = Array.isArray(j.items) ? j.items : [];
        const { fresh } = await saveTx(items);
        added += fresh;
        off += items.length;
        hist.total = Number(j.count) || hist.total || 0;
        if (items.length < PAGE) { hist.done = true; break; }
      }
      hist.offset = off;
      await putSetting('odb_hist', JSON.stringify(hist));
    }
    // 3) оплачені рахунки за даними Opendatabot (на випадок, якщо платіж ще не потрапив у стрічку)
    const open = await db.get(`SELECT COUNT(*) AS n FROM pay_links WHERE status IN ('pending', 'check')`);
    if (open?.n) {
      const j = await odb(cr, 'GET', `/api/invoices?status=paid&limit=${PAGE}&offset=0`);
      const paidIds = (Array.isArray(j.items) ? j.items : []).filter((x) => String(x.paymentStatus || 'paid') === 'paid').map((x) => String(x.id));
      if (paidIds.length) await db.run(`UPDATE pay_links SET odb_paid = 1, paid_at = COALESCE(paid_at, ?) WHERE odb_paid = 0 AND odb_id IN (SELECT value FROM json_each(?))`, [nowIso(), JSON.stringify(paidIds)]);
    }
    const paid = await relink();
    // сповіщення: лише якщо історію вже завантажено (інакше це старі платежі)
    await notify({ linkIds: paid, freshRows: hist.done ? newRows : [] }).catch(() => 0);
    const me = c.get('user');
    const minePaid = paid.length
      ? await db.all(`SELECT id, number, amount, client FROM pay_links WHERE created_by_id = ? AND id IN (SELECT value FROM json_each(?))`, [me.id, JSON.stringify(paid)])
      : [];
    return c.json({ ok: true, added, paid: paid.length, minePaid, hist, lastSync: nowIso() });
  });

  app.get('/api/odb/payments', async (c) => {
    need(c, 'docs.edit');
    const tab = c.req.query('tab') === 'mine' ? 'mine' : 'all';
    const from = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('from') || '') ? c.req.query('from') : '';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('to') || '') ? c.req.query('to') : '';
    const acc = String(c.req.query('account') || '');
    const only = c.req.query('only') || '';
    const where = [];
    const params = [];
    if (from) { where.push('t.date >= ?'); params.push(`${from}T00:00:00`); }
    if (to) { where.push('t.date <= ?'); params.push(`${to}T23:59:59`); }
    if (acc) { where.push('t.iban = (SELECT iban FROM odb_accounts WHERE id = ?)'); params.push(acc); }
    if (tab === 'mine') { where.push('l.created_by_id = ?'); params.push(c.get('user').id); }
    if (only === 'ours') where.push('t.link_id IS NOT NULL');
    if (only === 'check') where.push(`t.link_id IS NULL AND t.possible != '[]'`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows, tot, accounts] = await Promise.all([
      db.all(
        `SELECT t.id, t.date, t.amount, t.currency, t.purpose, t.iban, t.payer_name, t.payer_code, t.possible, t.link_id, t.manual,
                l.number AS link_number, l.status AS link_status, l.created_by AS link_author, ${ACC} AS account_alias, a.kind AS account_kind
         FROM odb_tx t LEFT JOIN pay_links l ON l.id = t.link_id LEFT JOIN odb_accounts a ON a.iban = t.iban
         ${w} ORDER BY t.date DESC LIMIT 500`, params,
      ),
      db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN t.currency = 'UAH' THEN t.amount END), 0) AS sum FROM odb_tx t LEFT JOIN pay_links l ON l.id = t.link_id ${w}`, params),
      db.all(`SELECT id, ${ACC} AS alias, kind FROM odb_accounts a ORDER BY seen, sort, alias`),
    ]);
    const s = await settings();
    let hist = {};
    try { hist = JSON.parse(s.odb_hist || '{}'); } catch { /* */ }
    return c.json({ rows, count: tot?.n || 0, sum: round2(tot?.sum || 0), accounts, lastSync: s.odb_sync_at || '', hist, connected: Boolean(s.odb_key && s.odb_name) });
  });

  // Ручна прив'язка платежу до посилання (або відв'язка: link_id = null)
  // Менеджер — лише до своїх посилань; власник і адміни — до будь-яких.
  app.put('/api/odb/payments/:id', async (c) => {
    need(c, 'docs.edit');
    const b = await c.req.json();
    const me = c.get('user');
    const admin = can(me, 'users');
    const linkId = b.link_id ? parseInt(b.link_id, 10) : null;
    const link = linkId ? await db.get(`SELECT id, created_by_id FROM pay_links WHERE id = ?`, [linkId]) : null;
    if (linkId && !link) throw fail(404, 'Посилання не знайдено.');
    if (!admin) {
      const tx = await db.get(`SELECT t.link_id, l.created_by_id FROM odb_tx t LEFT JOIN pay_links l ON l.id = t.link_id WHERE t.id = ?`, [c.req.param('id')]);
      if (!tx) throw fail(404, 'Платіж не знайдено.');
      const mine = (x) => String(x ?? '') === String(me.id);
      if ((link && !mine(link.created_by_id)) || (tx.link_id && !mine(tx.created_by_id))) {
        throw fail(403, 'Прив’язувати платежі до чужих посилань можуть лише власник і адміністратори.');
      }
    }
    await db.run(`UPDATE odb_tx SET link_id = ?, manual = 1 WHERE id = ?`, [linkId, c.req.param('id')]);
    await relink();
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- аналітика оплат (власник і адміни)
  const PERSON = 'person';
  const payerKey = `CASE WHEN length(t.payer_code) = 10 THEN '${PERSON}' WHEN t.payer_code != '' THEN t.payer_code ELSE 'name:' || t.payer_name END`;
  app.get('/api/odb/stats', async (c) => {
    need(c, 'analytics');
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
    const from = day(c.req.query('from')) || '2000-01-01';
    const to = day(c.req.query('to')) || '2999-12-31';
    const cmpFrom = day(c.req.query('cmpFrom'));
    const cmpTo = day(c.req.query('cmpTo'));
    const group = ['day', 'week', 'month'].includes(c.req.query('group')) ? c.req.query('group') : 'day';
    const accs = String(c.req.query('accounts') || '').split(',').filter(Boolean).slice(0, 40);
    const payer = String(c.req.query('payer') || '');
    const bucket = group === 'month' ? `substr(t.date, 1, 7)`
      : group === 'week' ? `date(substr(t.date, 1, 10), 'weekday 0', '-6 days')` : `substr(t.date, 1, 10)`;
    const scope = (f, tt) => {
      const w = [`t.date >= ?`, `t.date <= ?`, `t.currency = 'UAH'`];
      const p = [`${f}T00:00:00`, `${tt}T23:59:59`];
      if (accs.length) { w.push(`t.iban IN (SELECT iban FROM odb_accounts WHERE id IN (SELECT value FROM json_each(?)))`); p.push(JSON.stringify(accs)); }
      if (payer) { w.push(`${payerKey} = ?`); p.push(payer); }
      return { w: `WHERE ${w.join(' AND ')}`, p };
    };
    const cur = scope(from, to);
    const prev = cmpFrom && cmpTo ? scope(cmpFrom, cmpTo) : null;
    const q = (sc, sql) => db.all(sql.replace('$W', sc.w), sc.p);
    const [tot, series, byAcc, byPayer, ptot, pseries, pAcc, pPayer, accounts, names, range] = await Promise.all([
      q(cur, `SELECT COUNT(*) AS cnt, COALESCE(SUM(t.amount), 0) AS sum FROM odb_tx t $W`),
      q(cur, `SELECT ${bucket} AS k, COUNT(*) AS cnt, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY k ORDER BY k`),
      q(cur, `SELECT t.iban, COUNT(*) AS cnt, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY t.iban`),
      q(cur, `SELECT ${payerKey} AS k, MAX(t.payer_name) AS name, COUNT(*) AS cnt, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY k ORDER BY sum DESC LIMIT 40`),
      prev ? q(prev, `SELECT COUNT(*) AS cnt, COALESCE(SUM(t.amount), 0) AS sum FROM odb_tx t $W`) : null,
      prev ? q(prev, `SELECT ${bucket} AS k, COUNT(*) AS cnt, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY k ORDER BY k`) : null,
      prev ? q(prev, `SELECT t.iban, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY t.iban`) : null,
      prev ? q(prev, `SELECT ${payerKey} AS k, SUM(t.amount) AS sum FROM odb_tx t $W GROUP BY k`) : null,
      db.all(`SELECT id, iban, ${ACC} AS alias, kind FROM odb_accounts a ORDER BY seen, sort, alias`),
      db.all(`SELECT code, name FROM odb_payers`),
      db.get(`SELECT MIN(date) AS min, MAX(date) AS max FROM odb_tx`),
    ]);
    const accBy = new Map(accounts.map((a) => [a.iban, a]));
    const nameBy = new Map(names.map((n) => [n.code, n.name]));
    const pA = new Map((pAcc || []).map((r) => [r.iban, r.sum]));
    const pP = new Map((pPayer || []).map((r) => [r.k, r.sum]));
    const s = await settings();
    let hist = {};
    try { hist = JSON.parse(s.odb_hist || '{}'); } catch { /* */ }
    return c.json({
      group,
      total: { sum: round2(tot[0].sum), cnt: tot[0].cnt, avg: tot[0].cnt ? round2(tot[0].sum / tot[0].cnt) : 0 },
      prevTotal: ptot ? { sum: round2(ptot[0].sum), cnt: ptot[0].cnt, avg: ptot[0].cnt ? round2(ptot[0].sum / ptot[0].cnt) : 0 } : null,
      series: series.map((r) => ({ k: r.k, sum: round2(r.sum), cnt: r.cnt })),
      prevSeries: pseries ? pseries.map((r) => ({ k: r.k, sum: round2(r.sum), cnt: r.cnt })) : null,
      byAccount: byAcc.map((r) => {
        const a = accBy.get(r.iban);
        return { id: a?.id || '', iban: r.iban, name: a?.alias || r.iban || '—', kind: a?.kind || '', sum: round2(r.sum), cnt: r.cnt, prevSum: prev ? round2(pA.get(r.iban) || 0) : null };
      }).sort((x, y) => y.sum - x.sum),
      byPayer: byPayer.map((r) => ({
        key: r.k,
        name: r.k === PERSON ? 'Фізичні особи' : nameBy.get(r.k) || r.name || '—',
        auto: r.k === PERSON ? '' : r.name || '',
        code: r.k === PERSON || r.k.startsWith('name:') ? '' : r.k,
        sum: round2(r.sum), cnt: r.cnt, prevSum: prev ? round2(pP.get(r.k) || 0) : null,
      })),
      accounts: accounts.map((a) => ({ id: a.id, name: a.alias, kind: a.kind })),
      range: { min: range?.min?.slice(0, 10) || '', max: range?.max?.slice(0, 10) || '' },
      lastSync: s.odb_sync_at || '',
      hist,
    });
  });

  // Своя назва для платника (група за ЄДРПОУ)
  app.put('/api/odb/payers/:code', async (c) => {
    need(c, 'analytics');
    const code = c.req.param('code');
    const name = String((await c.req.json()).name || '').trim().slice(0, 120);
    if (!name) await db.run(`DELETE FROM odb_payers WHERE code = ?`, [code]);
    else await db.run(`INSERT INTO odb_payers (code, name) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name`, [code, name]);
    return c.json({ ok: true });
  });

  return { linkForRahunok };
}
