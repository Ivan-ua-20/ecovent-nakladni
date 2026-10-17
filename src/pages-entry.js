// Cloudflare Pages Functions: обробляє всі запити /api/*. Статичні файли віддає Pages з папки public/.
import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { d1Db } from './core/db-d1.js';
import { setIterations, resetOwnerPassword } from './core/auth.js';

let ready = null;
// Живе, поки живе ізолят: чистка за строком зберігання — раз на годину, а не на кожен запит; кеш чеків Checkbox.
const shared = {};

export async function onRequest(ctx) {
  const { env, request } = ctx;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'Не підключено базу D1: у налаштуваннях проєкту Pages додайте D1 binding з іменем DB.' }), {
      status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  // Безкоштовний план має ліміт 10 мс процесорного часу на запит, тому хеш пароля легший, ніж локально.
  setIterations(Number(env.PBKDF2_ITERATIONS) || 10000);
  const db = d1Db(env.DB);
  if (!ready) ready = migrate(db).catch((e) => { ready = null; throw e; });
  await ready;

  // Скидання пароля власника: змінна середовища OWNER_RESET_PASSWORD (див. README).
  if (env.OWNER_RESET_PASSWORD && env.OWNER_RESET_PASSWORD.length >= 6) {
    const mark = await db.get(`SELECT value FROM settings WHERE key = 'owner_reset_mark'`);
    const tag = `${env.OWNER_RESET_PASSWORD.length}:${[...env.OWNER_RESET_PASSWORD].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7)}`;
    if (mark?.value !== tag) {
      await resetOwnerPassword(db, env.OWNER_RESET_PASSWORD);
      await db.run(`INSERT INTO settings (key, value) VALUES ('owner_reset_mark', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [tag]);
    }
  }

  // Ліміт безкоштовного плану — 50 зовнішніх запитів на одне звернення; беремо із запасом.
  // LPCRM_TEST_URL — лише для перевірки з імітацією LP-CRM (на робочому сайті не задається).
  const fetchFn = env.LPCRM_TEST_URL
    ? (url, opts) => fetch(String(url).replace(/^https?:\/\/[^/]+\.lp-crm\.biz/, env.LPCRM_TEST_URL), opts)
    : fetch;
  const app = createApp({ db, fetchFn, maxSubrequests: Number(env.MAX_SUBREQUESTS) || 40, shared });
  return app.fetch(request, env, ctx);
}
