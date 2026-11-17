# CLAUDE.md — опис проєкту для ШІ-асистента

Цей файл автоматично читає Claude Code (і корисний будь-якому розробнику). Тут — що це за сервіс, як він
влаштований і за якими правилами в ньому працювати. Опис функцій для користувачів — у `README.md`.

## 1. Що це

Внутрішній вебсервіс компанії Ековент (продаж кліматичної техніки) для роботи з замовленнями й документами.
Сайт: **https://ecovent-nakladni.pages.dev**. Мова інтерфейсу, коментарів у коді й повідомлень — **українська**.

Розділи (меню в `public/app.js`, масив `SECTIONS`):

| Розділ | Що робить | Модуль сервера | Сторінка |
|---|---|---|---|
| Головна / Потребує дій | Черга справ з усіх розділів | `home` | `pages/home.js` |
| Накладні ФОП | Накладна за ID замовлення LP-CRM, версії, історія | `nakladni`, `refs` | `pages/nakladna.js`, `pages/refs.js` |
| Рахунки Word | Рахунки на оплату (.docx), QR-посилання, платежі | `rahunky`, `payments` | `pages/rahunky.js`, `pay.js` |
| Аналітика | Дашборд продажів з LP-CRM, таргети, «Питання до ШІ», оплати | `analytics` | `an.js`, `anpay.js`, `pages/anai.js` |
| B2B партнери | Партнери, бренди й маржа, каталог, закупівлі, рахунки, обміни, кабінет партнера | `b2b` | `pages/b2b*.js`, `pages/partner.js` |
| Рітейл | Розетка — кабінет постачальника (дропшипінг) | `retail` | `pages/retail.js` |
| Маркетплейси | Замовлення Розетки (кабінет продавця), Prom, Епіцентру; дзвінки Binotel; зв'язок з LP-CRM | `market` (+ `crm.js`), `telephony` | `pages/market.js` |
| Повернення | Посилки, що повертаються | `returns` | `pages/returns.js` |
| Перевірка | Звірка оплат, наложки й чеків Checkbox | `checks` | `pages/checks.js` |
| Нова пошта / маркування | Кабінети НП, друк маркування 100×100 | `marking` | `pages/np.js` |
| Налаштування, користувачі, журнали | Ключі API, ролі, журнал змін і помилок, фонові задачі | `auth`, `admin`, `errlog`, `notify`, `cron` | `pages/settings.js`, `users.js`, `errors.js`, `cron.js` |

## 2. Стек

- **Сервер:** [Hono](https://hono.dev) на JavaScript (ES-модулі, без TypeScript, без фреймворків на фронті).
- **Хостинг:** Cloudflare Pages (статика з `public/`) + Pages Functions (`functions/api/[[path]].js` — обробляє всі `/api/*`).
- **База:** Cloudflare D1 (SQLite), binding **`DB`**. Необов'язково — R2, binding **`FILES`** (великі файли «Новин»; у маршруті — `c.env?.FILES`). Локально — SQLite через `node:sqlite` (`src/core/db-node.js`).
- **Фонові задачі:** окремий Cloudflare Worker `cron-worker/` (кожні 3 хв), викликає `/api/cron/...`.
- **Збірка:** esbuild (`scripts/build.mjs`). Залежності: `hono`, `@hono/node-server`, `docx`.
- **Node.js 22.13+** (потрібен `node:sqlite`).

## 3. Структура репозиторію

```
src/
  pages-entry.js     вхід Cloudflare: міграції, createApp(), змінні середовища
  server-node.js     локальний сервер (npm run dev / dist/server.mjs), заголовки безпеки
  app.js             createApp(): ліміт зовнішніх запитів, обробка помилок, чистка, cron; монтує модулі
  migrate.js         міграції: MODULE_SCHEMAS — список схем модулів (порядок важливий)
  core/              спільне: db-d1 / db-node (однаковий інтерфейс), auth (ролі, права, паролі), common
                     (fail, need, loadSettings, putSetting, num, round2, kyivDay…), schema, counters,
                     requisites, validate
  integrations/      лише клієнти зовнішніх API, без доступу до бази і без імпорту модулів:
                     lpcrm, checkbox, rozetka (продавець), rozetka-supplier, prom, epicentr,
                     novaposhta, meest, binotel, pdftext
  modules/<модуль>/  index.js (mount<Модуль>), schema.js, інші файли модуля
public/              статика (віддається як є, без збирання)
  index.html, app.js оболонка: вхід, меню SECTIONS, роутер routes{} (hash: #/назва/аргументи)
  core/ui.js         $, $$, api(), modal(), toast(), confirmDanger(), fmtDateTime…
  core/icons.js, xlsx.js, share.js
  pages/*.js         сторінки: кожна експортує create<Щось>Pages(...) і реєструється в app.js
  _headers           CSP та інші заголовки для Cloudflare Pages
functions/api/[[path]].js   ЗІБРАНИЙ бандл src/ (генерується, вручну не редагувати)
cron-worker/         Worker з Cron Trigger (wrangler.toml, worker.js)
tests/*.test.mjs     тести (node, без фреймворку, node:assert)
scripts/build.mjs    збірка functions/ і dist/ (локальна версія для Windows: dist/start.bat)
local/               файли для локального запуску на Windows
```

## 4. Як влаштовано сервер

### Модулі
Кожен модуль — незалежний блок: `export function mountX(app, ctx)` реєструє маршрути `app.get/post/put/delete('/api/...')`
і **повертає публічний вхід** (об'єкт функцій), який `app.js` кладе в `services.x`. Інші модулі звертаються до нього
тільки через `services.x.*` або імпорт `../x/index.js`.

`ctx` = `{ db, fetchFn, services, onCleanup, onTick, onCron, cronActive, runCleanup, shared, sleepFn }`:
- `db` — `db.get(sql, params)`, `db.all(...)`, `db.run(...)` → `{changes}`, `db.batch([...])`;
- `fetchFn` — fetch з лічильником зовнішніх запитів (Cloudflare: ліміт ~50 на звернення). Коли ліміт вичерпано,
  кидається помилка `pending` → відповідь 202 `{pending:true}`, і браузер (`api()` у `core/ui.js`) повторює запит;
  довгі операції мають уміти продовжуватися з місця зупинки;
- `onCleanup(fn(borderIso))` — чистка старих даних (раз на годину на всі ізоляти);
- `onCron(name, title, fn)` — фонова задача; її викликає Worker. Список задач перевіряє `tests/cron.test.mjs`
  (додаєте задачу — оновіть список у тесті);
- `sleepFn` — пауза (у тестах підміняється, щоб не чекати);
- `shared` — стан ізоляту між зверненнями (кеші, мітки часу).

**Правило архітектури** (перевіряє `tests/architecture.test.mjs`): модуль імпортує лише `../../core/`,
`../../integrations/`, свої файли `./…` і `../<інший>/index.js`. `core/` та `integrations/` не залежать від модулів.
Таблиці модуля пише лише сам модуль.

### База і міграції
- Таблиці модуля — у `modules/<модуль>/schema.js`: `{ name, version, tables: [...], columns: [[таблиця, колонка, тип], ...], after: [...] }`.
- **Змінили схему — підвищте `version`** цього модуля. Міграції лише додають: `CREATE TABLE/INDEX IF NOT EXISTS`,
  `ALTER TABLE ADD COLUMN` (через `columns`, якщо колонки ще немає). Нічого не видаляють і не перейменовують — дані користувачів на сайті живі.
- Індекс на нову колонку — у `after` (виконується після додавання колонок).
- Налаштування й ключі — таблиця `settings (key, value)`; хелпери `loadSettings`, `putSetting` у `core/common.js`.
- D1 на безкоштовному плані: мало запитів на звернення (тест `tests/d1-budget.test.mjs`), ≤100 тис. записів на добу,
  обережно з важкими запитами по великих таблицях (замовлення маркетплейсів, аналітика) — вони вже перевантажували базу.

### Доступ і ролі
`src/core/auth.js`: ролі `owner`, `admin`, `admin_lite`, `manager`, `viewer`, `partner`; права (`docs.view`, `docs.edit`,
`refs.edit`, `api`, `users`, `people`, `requisites`, `analytics`, `an.view`, `b2b.*`, `retail.*`, `market.*`, `returns.view`).
У маршруті: `need(c, 'market.edit')`. Для менеджера/перегляду є доступ по розділах і по магазинах (`users.access`,
`accessOf`, `shopAllowed`). Партнер B2B бачить лише свій кабінет. Помилки для користувача — `throw fail(400, 'Текст')`.

### Фонові задачі (cron)
Worker кожні 3 хв бере `/api/cron/tasks` і викликає `/api/cron/run/<назва>` окремим зверненням для кожної задачі.
Кожна задача сама вирішує, чи вже час, і робить невелику порцію роботи (ліміти Cloudflare). Перелік —
`grep -rn "onCron('" src` (analytics, checks, market*, binotel, b2b-crm-status, returns, rzs, ttn, orders…).
Стан задач видно на сторінці «Фонові задачі».

### Зовнішні сервіси
LP-CRM (основна CRM), Checkbox (чеки), Розетка (кабінет продавця і постачальника), Prom, Епіцентр, Нова пошта
(відстеження, маркування), Meest, Binotel (журнал дзвінків), Opendatabot (IBAN, надходження), Telegram (сповіщення
й «Фінансові питання» в B2B). Клієнти — у `src/integrations/`, ключі — у `settings`.

## 5. Фронтенд
- Без збирання: `public/*.js` — ES-модулі, які браузер завантажує напряму. Жодних npm-залежностей на фронті
  (бібліотеки — у `public/vendor/`).
- Нова сторінка: файл у `public/pages/`, `create…Pages()` → маршрут у `routes` і пункт у `SECTIONS` (`public/app.js`).
- Стилі — `public/app.css` (префікси за розділом: `mp-*` маркетплейси, `b2b-*` …).
- Кешу-бастингу немає: після викладки користувачам інколи треба **Ctrl+F5**.
- CSP у `public/_headers` і `src/server-node.js`: без inline-скриптів і сторонніх доменів без потреби.

## 6. Розробка, тести, викладка

```bash
npm install
npm run dev                  # локально, http://localhost:8787 (SQLite у data/)
npm run build                # functions/api/[[path]].js + dist/
for t in tests/*.test.mjs; do node --no-warnings "$t" || break; done   # усі тести
```

- Тести — звичайні скрипти з `node:assert`; більшість піднімає `createApp()` на SQLite у пам'яті з підробленим
  `fetchFn` (дивись `tests/market-crm.test.mjs`, `tests/telephony.test.mjs` як зразки). `tests/ui-smoke.test.mjs`
  відкриває всі сторінки й ловить помилки JS. Нова функція → новий або розширений тест.
- **Git-процес:** гілка → pull request у `main`. CI (`.github/workflows/ci.yml`) запускає тести, сам збирає
  і комітить `functions/api/[[path]].js` у гілку PR, і зливає PR автоматично, якщо всі тести зелені
  (змінна репозиторію `AUTO_MERGE=true`; мітка `no-automerge` — залишити на ручну перевірку). У `main` CI перевіряє,
  що бандл відповідає `src/`.
- Після злиття Cloudflare Pages сам викладає `main` (check-run «Cloudflare Pages»). Міграції бази виконуються
  автоматично при першому зверненні.
- Якщо два PR одночасно змінюють `src/`, бандл `functions/` може конфліктувати — злийте `main` у гілку і перезберіть.
- Збої GitHub (502) при автозлитті — перезапустити невдалі jobs у CI, а не обходити перевірки.

## 7. Правила роботи (обов'язково)

1. **Не поламати наявний функціонал.** Перед впровадженням — перевірити тричі: тести, збірка, ручна перевірка;
   після викладки — відкрити живий сайт у браузері й переконатися, що все працює.
2. **Секрети не в коді й не в чаті.** Ключі API, токени, паролі користувач вводить на сайті (Налаштування);
   вони зберігаються в базі й не віддаються в `/api/bootstrap` (маска `MASK` з `core/common.js`). Паролі за людей не вводити.
3. **Живі дані.** На робочому сайті не скасовувати й не змінювати реальні замовлення, не надсилати повідомлення
   клієнтам без згоди власника. Дії, що змінюють дані в Розетці / LP-CRM / Telegram, — лише з явного дозволу.
4. **Дизайн — спочатку макет.** Великі зміни інтерфейсу спершу показати макетом і впроваджувати лише після «впроваджуй».
5. **Міграції лише додають** (див. §4), версію схеми модуля — підвищувати.
6. **Ліміти Cloudflare:** ≤40–50 зовнішніх запитів і небагато запитів до D1 на одне звернення; довгу роботу ділити
   на порції (cron або повтор `pending`). Не запускати важкі запити до бази на робочому сайті для «перевірки».
7. **Тексти для людей — українською**, зрозуміло й без технічного жаргону; помилки — з підказкою, що робити.
8. У PR — опис змін для людини (що змінилось і як перевірити), без персональних даних.

## 8. Де шукати

| Питання | Файл |
|---|---|
| Як підключено модуль | `src/app.js` |
| Таблиці модуля | `src/modules/<модуль>/schema.js`, порядок — `src/migrate.js` |
| Ролі й права | `src/core/auth.js` |
| Запит до API з браузера, діалоги | `public/core/ui.js` |
| Меню й маршрути | `public/app.js` |
| Маркетплейси ↔ LP-CRM | `src/modules/market/crm.js` |
| «Передзвонити», «Подзвонив», ранкове нагадування в Telegram | `src/modules/market/remind.js` |
| Товари маркетплейсів ↔ товари LP-CRM (довідник, правила прив'язки) | `src/modules/market/items.js`, словник LP-CRM — `src/modules/catalog/index.js` |
| Вікна «Підтвердіть товари» / «Перевірте, що піде в LP-CRM», «Маркетплейси → Налаштування» | `public/pages/mpcrm.js`, сервер — `src/modules/market/crm.js` |
| B2B: закупівлі, рахунки, Telegram | `src/modules/b2b/orders.js`, `edits.js`, `tgdocs.js` |
| B2B «Новини» (статті, файли D1/R2, Telegram-групи партнерів) | `src/modules/b2b/news.js`, сторінки — `public/pages/b2b-news.js` |
| B2B «ТТН створює Ековент» (отримувач НП, створення ТТН через API НП) | `src/modules/b2b/npttn.js`, API НП — `src/integrations/novaposhta.js`, сторінки — `public/pages/np-picker.js`, `b2b-npttn.js` |
| Змінні середовища Cloudflare | `README.md` → «Cloudflare Pages» |
| Опис для користувачів | `README.md` |
