# Деплой на production

Всё работает в Docker на одном сервере:

```
Интернет ─► Caddy :80/:443 (HTTPS, Let's Encrypt) ─► app :3000 (API + бот + Mini App) ─► Postgres
```

- **caddy** — единственный сервис с открытыми портами. Сертификат получает и продлевает сам.
- **app** — сервер, бот (long polling) и собранный Mini App в одном контейнере.
- **migrate** — запускается перед `app`, применяет миграции Prisma и завершается. Если миграция упала, `app` не стартует.
- **db** — Postgres 17, данные в томе `pgdata`.

Файлы: [`compose.yaml`](../compose.yaml), [`Dockerfile`](../Dockerfile), [`deploy/Caddyfile`](../deploy/Caddyfile), [`deploy/backup.sh`](../deploy/backup.sh), [`.env.production.example`](../.env.production.example).

## 1. Что нужно

- VPS с Ubuntu 24.04: от 1 vCPU и 2 ГБ RAM. На 1 ГБ сборка образа может не уместиться в память, тогда добавьте swap (шаг 2).
- Домен (или поддомен), A-запись которого вы можете менять.
- Токен бота, ключи CISPAY и Install-IOS.

> Пока домена нет, можно пройти шаги 2 и 4. Запускать (шаг 5) — после того как DNS начнёт указывать на сервер: Telegram открывает Mini App только по HTTPS, а сертификат без домена не выпустить.

## 2. Подготовка сервера

Под root:

```bash
# Пользователь для деплоя
adduser deploy
usermod -aG sudo deploy
# Скопируйте свой SSH-ключ: на локальной машине `ssh-copy-id deploy@<IP>`

# Файрвол: SSH, HTTP, HTTPS (443/udp — HTTP/3)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable

# Docker (официальный скрипт) и доступ к нему для deploy
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

Если RAM меньше 2 ГБ, добавьте swap:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Дальше всё под пользователем `deploy` (перезайдите, чтобы применилась группа `docker`; проверка — `docker ps`).

Если у провайдера есть свой файрвол (Security Groups и т.п.), откройте в нём те же порты 80 и 443.

## 3. DNS

Создайте A-запись: `shop.example.com → <IP сервера>`. Если для домена есть AAAA-запись (IPv6), она тоже должна вести на этот сервер — или удалите её, иначе Let's Encrypt может не выдать сертификат.

Проверка (должен вернуться IP сервера):

```bash
dig +short shop.example.com
```

## 4. Код и настройки

Репозиторий приватный, поэтому серверу нужен deploy key (только чтение):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/istock_deploy -N ""
cat ~/.ssh/istock_deploy.pub
```

Добавьте ключ в GitHub: репозиторий → Settings → Deploy keys → Add deploy key (без «Allow write access»). Затем:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/istock_deploy
EOF

git clone git@github.com:oyabun-del/istockapps.git ~/istockapps
cd ~/istockapps
cp .env.production.example .env
chmod 600 .env
openssl rand -hex 24   # → POSTGRES_PASSWORD
nano .env
```

Что заполнить в `.env`:

| Переменная | Значение |
|---|---|
| `DOMAIN` | домен без `https://`, например `shop.example.com` |
| `ACME_EMAIL` | ваша почта: Let's Encrypt пишет о проблемах с сертификатом |
| `POSTGRES_PASSWORD` | результат `openssl rand -hex 24` (только буквы и цифры: пароль входит в URL подключения) |
| `BOT_TOKEN`, `BOT_USERNAME` | из @BotFather. **Отдельный бот для прода**: один токен не может работать в двух местах |
| `REQUIRED_CHANNEL`, `ADMIN_IDS`, `SUPPORT_USERNAME` | как в разработке |
| `SELLER_NAME`, `SELLER_INN`, `SELLER_OGRNIP`, `SELLER_EMAIL` | реквизиты ИП для соглашения и политики конфиденциальности, без них сервер не стартует |
| `CISPAY_SHOP_ID`, `CISPAY_API_KEY` | кабинет CISPAY → «Настройки магазина» |
| `INSTALLIOS_API_KEY`, `INSTALLIOS_DEFAULT_PRICE_RUB`, `INSTALLIOS_PRICES` | ключ партнёра и цены |

`NODE_ENV`, `PORT`, `TRUST_PROXY_HOPS`, `WEBAPP_URL`, `PUBLIC_URL` и `DATABASE_URL` задаёт `compose.yaml` — в `.env` их не нужно (и они бы не применились). Адреса Mini App и webhook получаются из `DOMAIN`.

При старте сервер проверяет все настройки: в production запрещены mock-оплата, mock-каталог, `DEV_USER_ID` и HTTP-адреса, а реквизиты ИП обязательны. Ошибка в `.env` видна в `docker compose logs app` строкой `Invalid environment configuration`.

## 5. Первый запуск

```bash
cd ~/istockapps
docker compose up -d --build
```

Первая сборка занимает несколько минут. Проверка:

```bash
docker compose ps                    # db, app, caddy — Up (healthy); migrate — Exited (0)
docker compose logs app | tail -20   # «Bot started», «Install-IOS catalog synced»
docker compose logs caddy | grep -i certificate
curl https://shop.example.com/health # {"success":true,"data":{"status":"ok"},...}
```

## 6. Telegram

1. Кнопку меню с Mini App бот настраивает сам при старте (адрес берётся из `DOMAIN`). Ничего вручную в @BotFather указывать не нужно.
2. Добавьте бота **администратором** канала из `REQUIRED_CHANNEL`.
3. Каждый админ из `ADMIN_IDS` и аккаунт поддержки нажимают `/start` в боте, иначе бот не сможет им писать.
4. Откройте бота, нажмите кнопку магазина — Mini App должен открыться.

## 7. CISPAY

1. В кабинете CISPAY укажите webhook: `https://shop.example.com/webhooks/cispay`.
2. Тестовый платёж из «Песочницы»: временно поставьте `ALLOW_SANDBOX_PAYMENTS=true`, примените (`docker compose up -d`), оплатите заказ, убедитесь, что пришло уведомление админам и открылась выдача.
3. **Верните `ALLOW_SANDBOX_PAYMENTS=false`** и снова `docker compose up -d`. Иначе тестовые платежи засчитываются как настоящие.

Поступление webhook видно в логе: `docker compose logs app | grep "CISPAY webhook"`. Если webhook не дошёл, статус всё равно подтянется опросом CISPAY, только медленнее.

### Проверка магазина в CISPAY

На время проверки оплату открывают только по промокоду:

1. В боте: `/promo add` создаст случайный код на 5 приложений (или `/promo add IOS-REVIEW 5`).
2. `/payments` → «🟡 Только по промокоду». Остальные покупатели видят в корзине поле промокода, без него оплатить нельзя.
3. Передайте код проверяющему. Ему тоже нужно подписаться на `REQUIRED_CHANNEL`, иначе Mini App не откроется.
4. Если проверяющий платит из «Песочницы», временно включите `ALLOW_SANDBOX_PAYMENTS=true`: иначе тестовый платёж не засчитается и заказ останется неоплаченным. Выдача через Install-IOS при этом настоящая, лимит кода ограничивает расход. Тестовые оплаты в `/stats` не входят в выручку.
5. После проверки: `/payments` → «🟢 Открыть для всех», `/promo off КОД`, `ALLOW_SANDBOX_PAYMENTS=false`.

`/payments` → «🔴 Закрыть» останавливает приём оплат для всех, например на время работ у поставщика.

## 8. Install-IOS

От имени админа в боте: `/balance` — долг и аванс, `/sync` — обновить каталог. Каталог также обновляется сам каждые 5 минут.

Статистика продаж — `/stats`, итоги дня приходят админам сами в 23:55 по Москве (`DAILY_REPORT_TIME`, `STATS_TIME_ZONE`).

## Повседневная работа

### Изменить настройки

```bash
nano .env
docker compose up -d     # пересоздаст контейнеры, у которых изменилось окружение
```

`docker compose restart` новые значения из `.env` **не** подхватывает — только `up -d`.

### Обновить версию

```bash
cd ~/istockapps
git pull
docker compose up -d --build
docker image prune -f    # удалить старые образы
```

Миграции применятся автоматически (сервис `migrate`). Простой — несколько секунд, пока перезапускается `app`.

Перед обновлением с новыми миграциями сделайте бэкап: `./deploy/backup.sh`.

### Откатить версию

```bash
git log --oneline -10
git checkout <коммит>
docker compose up -d --build
```

Миграции сами не откатываются. Если в откатываемой версии была миграция, удаляющая или переименовывающая колонки, старый код с новой схемой работать не будет — восстановите бэкап, сделанный до обновления (ниже). Поэтому миграции лучше делать «добавляющими»: новые поля и таблицы, а удаление — отдельным обновлением позже.

Вернуться на актуальную версию: `git checkout main && git pull && docker compose up -d --build`.

### Логи и состояние

```bash
docker compose ps
docker compose logs -f app                 # Ctrl+C — выйти
docker compose logs --since 1h app
docker compose exec db psql -U istock istock   # консоль базы
```

Логи каждого контейнера ограничены 5 файлами по 10 МБ.

## Бэкапы

`deploy/backup.sh` делает дамп базы в `backups/istock-<дата>.sql.gz` и удаляет дампы старше 14 дней (`KEEP_DAYS`).

Папку для дампов создайте заранее (она не хранится в Git, а cron пишет в неё лог ещё до запуска скрипта):

```bash
mkdir -p ~/istockapps/backups && chmod 700 ~/istockapps/backups
```

Ежедневно в 03:30 — `crontab -e` и строка:

```cron
30 3 * * * /home/deploy/istockapps/deploy/backup.sh >> /home/deploy/istockapps/backups/backup.log 2>&1
```

Храните копии и вне сервера — например, забирайте раз в день на свою машину:

```bash
scp 'deploy@<IP>:istockapps/backups/*.sql.gz' ./istock-backups/
```

### Восстановление

```bash
cd ~/istockapps
docker compose stop app
gunzip -c backups/istock-20261028-033000.sql.gz \
  | docker compose exec -T db psql -v ON_ERROR_STOP=1 --single-transaction -U istock -d istock
docker compose start app
```

Дамп сначала удаляет таблицы, затем создаёт их заново, поэтому восстанавливать можно поверх существующей базы. Восстановление идёт одной транзакцией: при любой ошибке база остаётся как была.

## Если что-то не работает

| Симптом | Где смотреть и что делать |
|---|---|
| `docker compose up` пишет `Set DOMAIN in .env` (или другую переменную) | Не заполнена переменная в `.env` |
| `dependency failed to start: migrate` | `docker compose logs migrate`: ошибка миграции или подключения к базе |
| `app` перезапускается | `docker compose logs app`: почти всегда `Invalid environment configuration` со списком полей |
| Сайт вообще не открывается, `caddy` в статусе `Created` | Caddy ждёт, пока `app` станет healthy. Смотрите `docker compose logs app` (строкой выше) |
| Сертификат не выпускается, браузер ругается на HTTPS | `docker compose logs caddy`. Проверьте `dig +short <домен>`, AAAA-запись, открыты ли 80/443 у провайдера. После нескольких неудач Let's Encrypt временно блокирует выпуск — исправьте причину и подождите час |
| Mini App не открывается в Telegram | Откройте `https://<домен>` в браузере. Если домен меняли — `docker compose up -d`, затем перезапустите Telegram |
| Бот молчит, в логе `409 Conflict` | Этот же токен запущен где-то ещё (локально или вторая копия). Для разработки нужен отдельный бот |
| Платёж прошёл, заказ не оплачен | `docker compose logs app \| grep -i cispay`. Проверьте webhook в кабинете CISPAY и `ALLOW_SANDBOX_PAYMENTS` для тестовых платежей |
| Сборка падает с `Killed` / `exit code 137` | Не хватило памяти — добавьте swap (шаг 2) |

Сервис `app` нельзя масштабировать (`--scale app=2`): бот работает через long polling, и две копии с одним токеном мешают друг другу.
