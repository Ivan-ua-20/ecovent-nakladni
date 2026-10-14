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
