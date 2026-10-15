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

**Готово:** бот (`/start`, `/support`, проверка подписки, кнопка магазина), уведомления всем админам о покупках, возвратах и обращениях, оплата CISPAY (создание счёта, webhook с проверкой подписи, опрос статуса как запасной вариант), заказ со статусами, все экраны Mini App.

**Заглушки до появления вашего API** (`apps/server/src/providers/`):
- `catalog/mock-catalog-provider.ts` — список приложений и иконки;
- `delivery/mock-delivery-provider.ts` — ссылка на скачивание, логин/пароль, код.

Чтобы подключить API, напишите реализации интерфейсов `CatalogProvider` и `DeliveryProvider` и подключите их в `apps/server/src/container.ts`. Экраны и бизнес-логику менять не нужно. Иконка категории (`icon`) должна быть из списка `apps/miniapp/src/lib/icons.ts`, иначе Mini App покажет запасную.

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

### Проверка в обычном браузере
1. В `.env`: `NODE_ENV=development`, `PAYMENT_PROVIDER=mock`, `DEV_USER_ID=<ваш Telegram id>` (узнать: @userinfobot), `WEBAPP_URL` и `PUBLIC_URL` = `http://localhost:5173`.
2. `pnpm dev` и откройте http://localhost:5173 (мобильный экран в DevTools: `Ctrl+Shift+M`).

Подписка на канал проверяется и здесь, поэтому нужны настоящий `BOT_TOKEN`, бот-админ канала и подписка аккаунта из `DEV_USER_ID`. Иначе вместо магазина будет «Не удалось проверить подписку».

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
- USDT: CISPAY присылает сумму в центах USD, поэтому оплата сверяется с рублёвой суммой через `GET /payments/status` (поле `source_amount`).
- Способы оплаты берутся из `GET /store/capabilities` CISPAY: СБП, карта, USDT. **T-Pay из макета CISPAY не поддерживает**, поэтому его плитки нет.

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
