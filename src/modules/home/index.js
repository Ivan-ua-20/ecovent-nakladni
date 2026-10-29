// Модуль «Головна»: черга «Потребує дій» — що чекає дій користувача в усіх розділах.
// Таблиць не має: лише питає інші модулі (services.*.attention) — кожен рахує своє.
import { can } from '../../core/auth.js';

export function mountHome(app, { services }) {
  // Розділ → право, з яким його дії видно.
  const SOURCES = [
    ['b2b', 'b2b.admin'],
    ['retail', 'docs.view'],
    ['errlog', 'users'],
  ];
  app.get('/api/home', async (c) => {
    const u = c.get('user');
    const parts = await Promise.all(SOURCES.filter(([, perm]) => can(u, perm))
      .map(([name]) => Promise.resolve(services[name]?.attention?.(u)).catch(() => [])));
    return c.json({ items: parts.flat().filter(Boolean) });
  });

  // Пошук по всьому сайту: кожен розділ шукає своє (services.*.search), видно лише доступне за правами.
  const SEARCH = [
    ['nakladni', 'docs.view'],
    ['rahunky', 'docs.view'],
    ['b2b', 'b2b.admin'],
    ['retail', 'docs.view'],
  ];
  app.get('/api/search', async (c) => {
    const u = c.get('user');
    const q = String(c.req.query('q') || '').trim().slice(0, 60);
    if (q.length < 2) return c.json({ items: [] });
    const parts = await Promise.all(SEARCH.filter(([, perm]) => can(u, perm))
      .map(([name]) => Promise.resolve(services[name]?.search?.(q)).catch(() => [])));
    return c.json({ items: parts.flat().filter(Boolean) });
  });
}
