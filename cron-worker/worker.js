// Cloudflare Worker з розкладом (Cron Trigger) для фонових задач сайту.
// Cloudflare Pages не вміє запускати код за розкладом, тому це робить окремий Worker:
// раз на 3 хв бере список задач і викликає кожну окремим запитом (у кожної — власний ліміт запитів).
// Налаштування — «Налаштування → Фонові задачі» на сайті (там же код з адресою сайту і ключ).
// Секрет CRON_KEY — ключ зі сторінки «Фонові задачі»; розклад — */3 * * * * (wrangler.toml).
const BASE = 'https://ecovent-nakladni.pages.dev';

export default {
  async scheduled(event, env, ctx) {
    const headers = { 'X-Cron-Key': env.CRON_KEY };
    ctx.waitUntil((async () => {
      const r = await fetch(`${BASE}/api/cron/tasks`, { headers });
      if (!r.ok) return;
      const { tasks = [] } = await r.json();
      for (const t of tasks) await fetch(`${BASE}/api/cron/run/${t}`, { method: 'POST', headers }).catch(() => {});
    })());
  },
};
