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

**Готово:** бот (`/start`, проверка подписки, кнопка магазина), уведомления всем админам о покупках, возвратах и обращениях, оплата CISPAY (создание счёта, webhook с проверкой подписи, опрос статуса как запасной вариант), заказ со статусами, все экраны Mini App.

**Заглушки до появления вашего API** (`apps/server/src/providers/`):
- `catalog/mock-catalog-provider.ts` — список приложений и иконки;
- `delivery/mock-delivery-provider.ts` — ссылка на скачивание, логин/пароль, код.

Чтобы подключить API, напишите реализации интерфейсов `CatalogProvider` и `DeliveryProvider` и подключите их в `apps/server/src/container.ts`. Экраны и бизнес-логику менять не нужно.

## Запуск локально

Нужны Node.js 20.19+ и pnpm.

```bash
pnpm install
cp .env.example .env          # заполните BOT_TOKEN, REQUIRED_CHANNEL, ADMIN_IDS, SUPPORT_USERNAME
pnpm db:migrate               # создаст SQLite-базу
pnpm build                    # соберёт Mini App и сервер
pnpm start
```

Telegram открывает Mini App только по HTTPS. Для разработки поднимите туннель (`cloudflared tunnel --url http://localhost:3000` или ngrok) и укажите его адрес в `WEBAPP_URL` и `PUBLIC_URL`.

Режим разработки с горячей перезагрузкой: `pnpm dev` (сервер на :3000, Vite на :5173 с прокси `/api`).

### Чек-лист настройки Telegram
1. Создайте бота в @BotFather, получите токен.
2. Добавьте бота **администратором** канала из `REQUIRED_CHANNEL`, иначе проверка подписки не работает.
3. Каждый админ из `ADMIN_IDS` и аккаунт поддержки должны один раз нажать `/start` в боте, иначе бот не сможет им написать.

### Оплата
- `PAYMENT_PROVIDER=mock` — после «Оплатить» откроется тестовая страница с кнопками «Оплатить / Отклонить».
- `PAYMENT_PROVIDER=cispay` — реальные платежи. В кабинете CISPAY укажите webhook `https://<PUBLIC_URL>/webhooks/cispay`. Тестовые платежи из «Песочницы» CISPAY тоже присылают webhook (пометка `is_sandbox`).
- Способы оплаты берутся из `GET /store/capabilities` CISPAY: СБП, карта, USDT. **T-Pay из макета CISPAY не поддерживает**, поэтому его плитки нет.

## Проверки

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
```

## Production
- Если `NODE_ENV` не задан, сервер считает окружение production. В production запрещены mock-оплата, mock-каталог и mock-выдача (иначе покупатели получили бы тестовый пароль), `DEV_USER_ID` и HTTP-адреса. Платежи из «Песочницы» CISPAY не засчитываются, пока не задан `ALLOW_SANDBOX_PAYMENTS=true`.
- За reverse-proxy укажите `TRUST_PROXY_HOPS=1`, чтобы rate limit видел настоящий IP.
- Для Postgres смените `provider` в `apps/server/prisma/schema.prisma` на `postgresql`, укажите `DATABASE_URL` и пересоздайте миграции.
