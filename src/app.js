// Серверна частина (API). Не залежить від середовища:
// локально запускається через Node.js, на хостингу — як Cloudflare Worker.
//
// Цей файл лише збирає модулі (src/modules/*). Кожен модуль має власні маршрути й таблиці
// і звертається до інших модулів тільки через те, що вони повертають із mount…() (services нижче).
import { Hono } from 'hono';
import { loadSettings } from './core/common.js';
import { mountAuth } from './modules/auth/index.js';
import { mountRefs } from './modules/refs/index.js';
import { mountNakladni } from './modules/nakladni/index.js';
import { mountAdmin } from './modules/admin/index.js';
import { mountRahunky } from './modules/rahunky/index.js';
import { mountAnalytics } from './modules/analytics/index.js';
import { mountTg } from './modules/notify/index.js';
import { mountErrLog } from './modules/errlog/index.js';
import { mountB2b } from './modules/b2b/index.js';
import { mountMarking } from './modules/marking/index.js';
import { mountRetail } from './modules/retail/index.js';
import { mountOdb, ODB_BASE } from './modules/payments/index.js';
import { mountHome } from './modules/home/index.js';

// shared — стан, що живе довше за одне звернення (на Cloudflare застосунок створюється на кожен запит,
// а об'єкт shared з pages-entry.js — один на ізолят): мітка останньої чистки, кеш чеків, замок синхронізації.
export function createApp({ db, fetchFn: rawFetch = fetch, maxSubrequests = Infinity, odbBase = ODB_BASE, shared = {} }) {
  const app = new Hono();
  // Ліміт зовнішніх запитів на одне звернення (Cloudflare: 50). Коли вичерпано — відповідаємо «триває»,
  // і браузер сам повторює запит; пошук продовжується з того місця, де зупинився.
  let usedSubrequests = 0;
  const fetchFn = async (...args) => {
    if (++usedSubrequests > maxSubrequests) {
      throw Object.assign(new Error('Обробка триває…'), { pending: true });
    }
    return rawFetch(...args);
  };

  app.onError(async (err, c) => {
    if (err.pending) return c.json({ pending: true, message: err.message }, 202);
    if (!err.status) console.error(err);
    // Збої сервера й зовнішніх сервісів (не помилки введення) — у журнал і адміністраторам у Telegram.
    if (!err.status || err.status >= 500) {
      const u = c.get('user');
      await services.errlog?.log(err, { path: c.req.path, user: u?.name || u?.login || '' });
    }
    return c.json({ error: err.message || String(err), ...(err.extra || {}) }, err.status || 500);
  });

  // ---------- Строк зберігання: модулі реєструють свою чистку, вона йде не частіше разу на годину ----------
  const cleanupTasks = [];
  const onCleanup = (fn) => cleanupTasks.push(fn);
  // Легкі фонові задачі на запитах (кожна сама вирішує, чи вже час), напр. перевірка дублів ТТН кожні 10 хв.
  const tickTasks = [];
  const onTick = (fn) => tickTasks.push(fn);
  // На Cloudflare екземплярів (ізолятів) багато й вони короткоживучі, тож пам'ятати час чистки лише в пам'яті
  // замало: кожен новий екземпляр чистив би знову. Тому «бронюємо» чистку в базі — один запит, раз на годину на всі.
  async function runCleanup(c = null) {
    for (const t of tickTasks) { try { t(c); } catch { /* фонова задача не заважає запиту */ } }
    if (Date.now() - (shared.lastCleanup || 0) < 60 * 60 * 1000) return;
    shared.lastCleanup = Date.now();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const claim = await db.run(
      `INSERT INTO settings (key, value) VALUES ('cleanup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value < ?`,
      [new Date().toISOString(), hourAgo],
    );
    if (!claim.changes) return;
    const s = await loadSettings(db);
    const days = Math.max(1, Number(s.retention_days) || 7);
    const border = new Date(Date.now() - days * 86400000).toISOString();
    for (const task of cleanupTasks) await task(border);
  }

  // Публічні входи модулів для інших модулів.
  const services = {};
  const ctx = { db, fetchFn, services, onCleanup, onTick, runCleanup, shared };

  // Порядок важливий: auth першим (його маршрути входу не потребують сесії, а далі стоїть перевірка входу).
  mountAuth(app, ctx);
  mountRefs(app, ctx);
  services.nakladni = mountNakladni(app, ctx);
  mountAdmin(app, ctx);
  services.errlog = mountErrLog(app, ctx);
  services.b2b = mountB2b(app, ctx);
  services.rahunky = mountRahunky(app, ctx);
  services.marking = mountMarking(app, ctx);
  services.retail = mountRetail(app, ctx);
  services.analytics = mountAnalytics(app, ctx);
  services.notify = mountTg(app, ctx);
  mountHome(app, ctx);
  services.payments = mountOdb(app, { ...ctx, base: odbBase, notify: (...a) => services.notify.notify(...a), onTx: (ids, origin) => services.b2b?.onPayments?.(ids, origin) });

  return app;
}
