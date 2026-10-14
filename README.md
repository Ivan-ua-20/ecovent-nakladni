# Накладні ФОП і рахунки (LP-CRM)

Сервіс для формування видаткових накладних і рахунків на оплату за замовленнями LP-CRM.

- **Накладні ФОП** — за номером замовлення LP-CRM; ФОП визначається з чека Checkbox, поля 1, відділу або вручну; шаблони, друк, Word, PDF, історія версій.
- **Рахунки (Word)** — з замовлення CRM або вручну; окремий довідник ФОПів рахунків; Word і PDF.
- **Акаунти** — власник, адміністратори, менеджери, перегляд.

## Локальний запуск

```bash
npm install
npm run build      # збирає dist/: server.mjs + public/ + start.bat
npm start          # http://localhost:8787
```

Для Windows-користувачів: архів папки `dist/` → `start.bat` (потрібен Node.js 22.13+).

## Структура

- `src/app.js` — API (Hono), не залежить від середовища (Node.js / Cloudflare Workers)
- `src/lpcrm.js`, `src/checkbox.js` — клієнти LP-CRM і Checkbox
- `src/schema.js` — схема БД (SQLite / Cloudflare D1)
- `src/auth.js` — ролі й паролі
- `public/` — інтерфейс (без збірки), шаблони накладних і рахунків, експорт у Word

## Тести

```bash
node --no-warnings tests/flow.test.mjs
node --no-warnings tests/auth-rahunky.test.mjs
node --no-warnings tests/real-shape.test.mjs
node --no-warnings tests/ratelimit.test.mjs
```

Ключі API, база даних і папка `data/` у репозиторій не потрапляють.

## Cloudflare Pages

Сайт: **https://ecovent-nakladni.pages.dev** (Pages, гілка `main`, автоматичне розміщення з GitHub).

- Статичні файли — папка `public/` (Build output directory = `public`, Build command — порожньо).
- Серверна частина — `functions/api/[[path]].js` (готовий файл, збирається командою `npm run build` з `src/pages-entry.js`).
  **Після змін у `src/` обов'язково виконайте `npm run build` і закомітьте оновлений файл.**
- База — Cloudflare D1, binding з іменем **`DB`** (Settings → Bindings). Таблиці створюються автоматично.
- Ліміти безкоштовного плану враховано: ≤40 зовнішніх запитів на звернення (довгий пошук у LP-CRM
  продовжується автоматично наступними зверненнями), легший хеш пароля (10 000 ітерацій PBKDF2).

Необов'язкові змінні середовища (Settings → Variables and Secrets):

| Змінна | Призначення |
|---|---|
| `OWNER_RESET_PASSWORD` | Новий пароль власника (від 6 символів). Застосовується один раз; після входу змінну краще видалити. |
| `PBKDF2_ITERATIONS` | Кількість ітерацій хешу пароля (за замовчуванням 10000). |
| `MAX_SUBREQUESTS` | Ліміт зовнішніх запитів на звернення (за замовчуванням 40). |

Перенесення налаштувань з локальної версії: **Налаштування → Перенесення налаштувань** (експорт у файл → імпорт на сайті).

Локальна перевірка в середовищі Cloudflare: `npm run build && npm run dev:cf`.
