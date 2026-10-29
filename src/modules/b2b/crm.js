// Робота з партнером для адмінів: відповідальний менеджер, нотатки й нагадування, автопауза при простроченні оплати.
import { fail, need, nowIso, kyivDay, loadSettings } from '../../core/common.js';
import { DEBT } from './orders.js';

const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const OVERRIDE_DAYS = 7; // знято з автопаузи вручну — стільки днів автопауза цього партнера не чіпає

export function mountB2bCrm(app, { db, services, onCleanup }) {
  const tgAdmins = (text) => services.notify?.sendText({ admins: true }, text).catch(() => 0);
  const tgPartner = (partnerId, text) => services.notify?.sendText({ partnerId }, text).catch(() => 0);
  const partnerOf = async (id) => {
    const p = await db.get(`SELECT * FROM b2b_partners WHERE id = ? AND COALESCE(deleted_at, '') = ''`, [id]);
    if (!p) throw fail(404, 'Партнера не знайдено.');
    return p;
  };

  // ---------- відповідальний менеджер ----------
  // Кого можна призначити: усі активні користувачі команди з доступом до B2B.
  app.get('/api/b2b/managers', async (c) => {
    need(c, 'b2b.admin');
    const rows = await db.all(`SELECT id, login, name FROM users WHERE active = 1 AND role IN ('owner', 'admin', 'admin_lite') ORDER BY name, login`);
    return c.json(rows.map((u) => ({ id: u.id, name: u.name || u.login })));
  });
  app.put('/api/b2b/partners/:id/manager', async (c) => {
    need(c, 'b2b.admin');
    const p = await partnerOf(c.req.param('id'));
    const id = parseInt((await c.req.json()).manager_id, 10) || null;
    if (id && !(await db.get(`SELECT id FROM users WHERE id = ? AND active = 1 AND role IN ('owner', 'admin', 'admin_lite')`, [id]))) throw fail(400, 'Такого менеджера немає.');
    await db.run(`UPDATE b2b_partners SET manager_id = ? WHERE id = ?`, [id, p.id]);
    return c.json({ ok: true });
  });

  // ---------- нотатки й нагадування ----------
  app.get('/api/b2b/partners/:id/notes', async (c) => {
    need(c, 'b2b.admin');
    const p = await partnerOf(c.req.param('id'));
    return c.json(await db.all(`SELECT * FROM b2b_notes WHERE partner_id = ? ORDER BY done, CASE WHEN remind_at = '' THEN 1 ELSE 0 END, remind_at, id DESC LIMIT 200`, [p.id]));
  });
  app.post('/api/b2b/partners/:id/notes', async (c) => {
    need(c, 'b2b.admin');
    const p = await partnerOf(c.req.param('id'));
    const b = await c.req.json();
    const text = String(b.text || '').trim().slice(0, 2000);
    const remind = String(b.remind_at || '').trim();
    if (!text) throw fail(400, 'Напишіть текст нотатки.');
    if (remind && !/^\d{4}-\d{2}-\d{2}$/.test(remind)) throw fail(400, 'Дата нагадування — у форматі РРРР-ММ-ДД.');
    const u = c.get('user');
    const r = await db.run(`INSERT INTO b2b_notes (partner_id, text, remind_at, user_id, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [p.id, text, remind, u.id, u.name || u.login, nowIso()]);
    return c.json({ id: r.lastId });
  });
  app.put('/api/b2b/notes/:id', async (c) => {
    need(c, 'b2b.admin');
    const n = await db.get(`SELECT * FROM b2b_notes WHERE id = ?`, [c.req.param('id')]);
    if (!n) throw fail(404, 'Нотатку не знайдено.');
    const b = await c.req.json();
    await db.run(`UPDATE b2b_notes SET done = ? WHERE id = ?`, [b.done ? 1 : 0, n.id]);
    return c.json({ ok: true });
  });
  app.delete('/api/b2b/notes/:id', async (c) => {
    need(c, 'b2b.admin');
    await db.run(`DELETE FROM b2b_notes WHERE id = ?`, [c.req.param('id')]);
    return c.json({ ok: true });
  });

  // ---------- налаштування автопаузи ----------
  app.get('/api/b2b/autopause', async (c) => {
    need(c, 'b2b.admin');
    return c.json({ days: Number((await loadSettings(db)).b2b_autopause_days) || 0 });
  });
  app.put('/api/b2b/autopause', async (c) => {
    need(c, 'b2b.admin');
    const days = Math.max(0, Math.min(365, parseInt((await c.req.json()).days, 10) || 0));
    await db.run(`INSERT INTO settings (key, value) VALUES ('b2b_autopause_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(days)]);
    return c.json({ days });
  });

  // Раз на годину (разом з чисткою): прострочка понад N днів — пауза; оплатили — пауза знімається (лише автоматична).
  async function autopause() {
    const days = Number((await loadSettings(db)).b2b_autopause_days) || 0;
    if (!days) return;
    const t = kyivDay();
    const border = addDays(t, -days);
    const late = new Map((await db.all(`SELECT partner_id, MIN(due_date) AS due FROM b2b_orders WHERE kind = 'supply' AND status IN ${DEBT}
      AND due_date != '' AND due_date < ? GROUP BY partner_id`, [border])).map((r) => [r.partner_id, r.due]));
    const partners = await db.all(`SELECT id, name, paused, paused_auto, pause_override FROM b2b_partners WHERE active = 1 AND COALESCE(deleted_at, '') = ''`);
    for (const p of partners) {
      const due = late.get(p.id);
      const overridden = p.pause_override && p.pause_override >= addDays(t, -OVERRIDE_DAYS);
      if (due && !p.paused && !overridden) {
        const note = `Прострочено оплату понад ${days} дн. — нові закупівлі відкриються після оплати.`;
        await db.run(`UPDATE b2b_partners SET paused = 1, paused_auto = 1, pause_note = ? WHERE id = ?`, [note, p.id]);
        await tgPartner(p.id, `⏸ <b>Нові закупівлі призупинено</b>: прострочено оплату на ${daysBetween(due, t)} дн. Після оплати доступ відкриється автоматично.`);
        await tgAdmins(`⏸ Партнера «${p.name}» поставлено на автопаузу: прострочка ${daysBetween(due, t)} дн.`);
      } else if (!due && p.paused && p.paused_auto) {
        await db.run(`UPDATE b2b_partners SET paused = 0, paused_auto = 0, pause_note = '' WHERE id = ?`, [p.id]);
        await tgPartner(p.id, '▶️ <b>Закупівлі знову доступні</b> — дякуємо за оплату.');
        await tgAdmins(`▶️ З партнера «${p.name}» знято автопаузу: прострочених оплат немає.`);
      }
    }
  }
  onCleanup(autopause);

  // Для черги «Потребує дій»: нагадування на сьогодні й раніше.
  async function attention(user) {
    const where = user ? 'AND (n.user_id = ? OR p.manager_id = ?)' : '';
    const r = await db.get(`SELECT COUNT(*) AS n FROM b2b_notes n JOIN b2b_partners p ON p.id = n.partner_id
      WHERE n.done = 0 AND n.remind_at != '' AND n.remind_at <= ? ${where}`, user ? [kyivDay(), user.id, user.id] : [kyivDay()]);
    return r?.n ? [{ key: 'b2b_notes', level: 'info', count: r.n, label: 'Нагадування по партнерах на сьогодні', link: '#/b2bpartners' }] : [];
  }

  return { autopause, attention };
}
