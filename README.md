# AppDrop — Telegram Mini App

Магазин приложений, удалённых из App Store или недоступных в регионе: каталог, оплата через CISPAY, скачивание, выдача логина/пароля и кода для активации.

## Что внутри

```
apps/server     Fastify API + бот (grammY) + Prisma
apps/miniapp    React Mini App (Vite, Tailwind, Motion)
packages/shared общие типы, статусы заказа, схемы запросов
docs/           спецификация CISPAY (OpenAPI)
design/         исходные макеты
```

**Готово:** бот (`/start`, `/support`, проверка подписки, кнопка магазина), уведомления всем админам о покупках и возвратах, оплата CISPAY по СБП (создание счёта, webhook с проверкой подписи, опрос статуса как запасной вариант), заказ со статусами, все экраны Mini App.

**Поддержка** — только в Telegram: кнопки в боте и Mini App ведут на `SUPPORT_USERNAME`. Обращений в Mini App нет, таблица `Ticket` удалена миграцией `20261028120000_code_step_drop_tickets`.

**Шаги активации** открываются по очереди: следующий шаг не показывается, пока не выполнен текущий (скачать → логин и пароль → код → «Приложение работает»). Шаг с кодом завершается, когда сервер увидел полученный код или покупатель нажал «Apple не запросил код» (`POST /api/orders/:id/skip-code`); отметка хранится в `Order.codeReceivedAt`, без неё `complete` отвечает 409.

**Каталог и выдача** (`apps/server/src/providers/`): `CATALOG_PROVIDER` и `DELIVERY_PROVIDER` (оба одинаковые):
- `mock` — заглушки для разработки (`catalog/mock-catalog-provider.ts`, `delivery/mock-delivery-provider.ts`);
- `installios` — [Install-IOS Partner API](https://api.installios.ru/docs), см. ниже.

### Install-IOS
Серверная интеграция: ключ не покидает сервер, логины, пароли, коды и ссылки не пишутся в базу и логи.

```dotenv
CATALOG_PROVIDER=installios
DELIVERY_PROVIDER=installios
INSTALLIOS_API_KEY=...            # ключ партнёра, только в .env на сервере
INSTALLIOS_DEFAULT_PRICE_RUB=199  # Install-IOS не передаёт цены
INSTALLIOS_PRICES={"app_…": 299}  # необязательно: цены отдельных приложений
# INSTALLIOS_API_BASE=https://installios.ru/api/partner/v1  # резервный адрес
```

- **Каталог** — один общий список из всех каталогов Install-IOS, объединённый по `application.id`. Загружается при старте и каждые 5 минут; витрина меняется, только когда загрузились все каталоги, иначе остаётся прежний полный список. Категория одна — «Все».
- **Выдача.** Заявка Install-IOS создаётся при первом открытии оплаченного заказа (`external_order_id = istock-<paymentOrderId>`, `source_mode: auto`); повтор возвращает ту же заявку. Начисление поставщика — при первом переходе по ссылке установки. Каждый показ ссылок и реквизитов заново читает заявку: блокировка учётки, бесплатная автозамена и смена пароля видны сразу, без webhook.
- **Код.** Покупатель сначала включает ожидание, потом запрашивает код на iPhone; Mini App опрашивает статус раз в 1,5 с, код живёт до 60 с и затем стирается. Лимит — 3 успешных кода на аккаунт (берётся из API). Старт ожидания сокращает срок заявки (в sandbox: 12 ч → 6 ч), он показывается под ссылками.
- **Админ-команды бота** (только `ADMIN_IDS`): `/balance` — долг и аванс перед Install-IOS, `/sync` — обновить каталог сейчас.
- Не реализовано: повторная выдача (`set_extend`/`extend`), webhook Install-IOS, сообщение о блокировке (`report-blocked`), возвраты Install-IOS.
- **Откат:** `CATALOG_PROVIDER=mock`, `DELIVERY_PROVIDER=mock` (только вне production). Код — `git revert` коммита интеграции; миграция `20261027120000_installios_delivery` добавляет таблицу `CodeWaitAttempt` и поля `deliveryRef`/`deliveryExpiresAt` и удаляет устаревшие `codeRequests`/`lastCodeAt`.

## Запуск локально

Нужны Node.js 20.19+ и pnpm 11 (проще всего через `corepack enable`: нужная версия указана в `package.json`).

```bash
pnpm install
cp .env.example .env          # заполните BOT_TOKEN, REQUIRED_CHANNEL, ADMIN_IDS, SUPPORT_USERNAME
pnpm db:migrate               # создаст SQLite-базу (только для разработки)
pnpm build                    # соберёт Mini App и сервер
pnpm start
```

Telegram открывает Mini App только по HTTPS, поэтому для проверки в Telegram нужен туннель (cloudflared или ngrok):

- **`pnpm start`** (собранная версия, сервер на :3000): `cloudflared tunnel --url http://localhost:3000`, адрес туннеля укажите в `WEBAPP_URL` и `PUBLIC_URL`.
- **`pnpm dev`** (горячая перезагрузка: сервер на :3000, Vite на :5173): туннель на `http://localhost:5173`, его адрес в `WEBAPP_URL` и `PUBLIC_URL`. Vite проксирует `/api` и `/dev` на сервер. Webhook CISPAY через Vite не проходит: для `PAYMENT_PROVIDER=cispay` нужен второй туннель на :3000 в `PUBLIC_URL`.

После смены `WEBAPP_URL` перезапустите сервер: кнопка меню бота настраивается при старте.

### Проверка в обычном браузере (без бота)
1. В `.env`: `NODE_ENV=development`, `PAYMENT_PROVIDER=mock`, `DEV_USER_ID=111111111`, `TELEGRAM_OFFLINE=true`, `WEBAPP_URL` и `PUBLIC_URL` = `http://localhost:5173`. `BOT_TOKEN` не нужен.
2. `pnpm db:migrate`, затем `pnpm dev` и откройте http://localhost:5173 (мобильный экран в DevTools: `Ctrl+Shift+M`).

В офлайн-режиме бот не запускается, подписка на канал считается оформленной, а сообщения админам и покупателю пишутся в лог сервера. Работает весь путь: каталог, заказ, тестовая оплата, логин и пароль, код, отмена. Режим запрещён в production и с реальной оплатой.

Чтобы проверить вместе с настоящим ботом и подпиской, уберите `TELEGRAM_OFFLINE`, укажите `BOT_TOKEN`, добавьте бота админом канала и подпишите на канал аккаунт из `DEV_USER_ID`.

Для отладки внутри Telegram Desktop: Настройки → Продвинутые → Экспериментальные настройки → «Enable webview inspecting», затем правый клик в Mini App.

### Чек-лист настройки Telegram
1. Создайте бота в @BotFather, получите токен.
2. Добавьте бота **администратором** канала из `REQUIRED_CHANNEL`, иначе проверка подписки не работает.
3. Каждый админ из `ADMIN_IDS` и аккаунт поддержки должны один раз нажать `/start` в боте, иначе бот не сможет им написать.
4. Бот-админ канала также читает его название и число подписчиков для экрана подписки. Если прав нет, экран всё равно работает, просто без этих данных.
5. Пользовательское соглашение: опубликуйте текст (например, в Telegraph) и укажите ссылку в `TERMS_URL`, тогда в профиле появится пункт со ссылкой.

### Оплата
- `PAYMENT_PROVIDER=mock` — после «Оплатить» откроется тестовая страница с кнопками «Оплатить / Отклонить».
- `PAYMENT_PROVIDER=cispay` — реальные платежи. В кабинете CISPAY укажите webhook `${PUBLIC_URL}/webhooks/cispay` (например, `https://shop.example.com/webhooks/cispay`). Тестовые платежи из «Песочницы» CISPAY тоже присылают webhook (пометка `is_sandbox`).
- **Только СБП.** Магазин принимает новые заказы только с `paymentMethod: "SBP"`, карта и USDT отклоняются проверкой запроса. СБП предлагается, если он включён в `GET /store/capabilities` CISPAY; иначе Mini App пишет «Оплата временно недоступна». Старые заказы картой или USDT показываются как раньше.
- Если webhook пришёл без суммы в рублях, оплата сверяется с рублёвой суммой через `GET /payments/status` (поле `source_amount`).

## Проверки

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
```

## Production
- Миграции применяйте командой `pnpm db:deploy`, **не** `pnpm db:migrate`: `migrate dev` при расхождении схемы предлагает сбросить базу.
- Если `NODE_ENV` не задан, сервер считает окружение production. В production запрещены mock-оплата, mock-каталог и mock-выдача (иначе покупатели получили бы тестовый пароль), `DEV_USER_ID` и HTTP-адреса. `DEV_USER_ID` также запрещён при `PAYMENT_PROVIDER=cispay`.
- Платежи из «Песочницы» CISPAY и платежи заблокированных покупателей (`is_sandbox`) не засчитываются ни через webhook, ни при опросе статуса, пока не задан `ALLOW_SANDBOX_PAYMENTS=true`.
- За reverse-proxy укажите `TRUST_PROXY_HOPS=1`, чтобы rate limit видел настоящий IP.
- Для Postgres смените `provider` в `apps/server/prisma/schema.prisma` на `postgresql`, укажите `DATABASE_URL` и пересоздайте миграции.
