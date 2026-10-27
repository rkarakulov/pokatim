# Деплой dev-стенда

Когда применять: первичная настройка автодеплоя, смена домена, разбор упавшего деплоя, откат, логи и почта стенда.

**dev = ветка `develop`** — каждый push в `develop` разворачивает стенд автоматически. **prod = `main`** — свой
workflow и сервер позже (не настроен; `infra/docker-compose.prod.yml` с Caddy — заготовка под VPS).

Обозначения: `<сервер>` — адрес сервера из секрета `DEV_SSH_HOST` окружения `dev` (в репозитории не пишется);
`<хост>` — публичное имя стенда, переменная `DEV_PUBLIC_HOST` окружения `dev`. Репозиторий публичный: адрес сервера,
чужие сервисы на нём и логи приложений в документы и лог Actions не попадают.

## Схема

```
push develop ─► deploy-dev.yml
                 ├─ preflight   environment dev: секреты DEV_SSH_*, DEV_PUBLIC_HOST, тег sha-<7>
                 ├─ ci          ci.yml (reusable): format, lint, arch, typecheck, test, сборка, web-смоук
                 ├─ build       infra/docker/Dockerfile → GHCR: pokatim-api, pokatim-web, pokatim-admin
                 │              теги sha-<7> и develop, linux/amd64
                 └─ deploy      environment dev; SSH: файлы стека → ~/pokatim, deploy.sh (токен GHCR — stdin)

Сервер — общий (на нём живут другие проекты: их сайты, контейнеры, тома и порты не трогаем):
  nginx хоста :80/:443 ─ /etc/nginx/sites-available/pokatim (server_name = <хост>)
     /v1/*     → 127.0.0.1:3100  api      (NestJS)
     /admin/*  → 127.0.0.1:8181  admin    (статика, nginx без root)
     /mail/*   → 127.0.0.1:8125  mailpit  (UI писем, basic-auth; только при https)
     /         → 127.0.0.1:8180  web      (SSR, expo-server)
  compose project pokatim-dev (~/pokatim/docker-compose.yml, .env):
     worker, mongo (MongoDB 8.0, replica set rs0, keyfile + пользователи), redis — без портов хоста;
     mailpit — UI 127.0.0.1:8125, SMTP только внутри
```

`deploy.sh` на каждом деплое: `bootstrap.sh` (каталог, `.env`, keyfile MongoDB, vhost, сертификат) → pull →
mongo/redis/mailpit → **набор и пользователи MongoDB** (`mongo-init.js`: rs0, root, пользователь приложения —
идемпотентно) → **миграции одноразовым контейнером** (`compose run --rm migrate`, `node dist/db/migrate.js`) →
api/worker/web/admin с ожиданием healthcheck → smoke (`/v1/health` = ok и `database: up`, `/register`, `/admin/`,
`/mail/` без пароля 401 и с паролем 200, `/v1/health` и `/mail/` через vhost nginx) → `compose up --remove-orphans`
(контейнеры удалённых сервисов) → прочистка образов pokatim без контейнеров (по label `by.pokatim.project=pokatim`,
чужие образы не трогаются).

Свои порты хоста — 3100, 8180, 8181, 8125, только `127.0.0.1`; выбраны свободными. Менять — после `sudo ss -ltnp` на
сервере. Лимиты памяти контейнеров — в `infra/deploy/docker-compose.yml`, всего 2560m (mongo 640, redis 320, mailpit
128, api 512, worker 384, web 512, admin 64; healthcheck mongo — `mongosh` раз в 15 с в лимите mongo), логи контейнеров
ротируются (json-file, 3 × 10 МБ на контейнер).

## Первичная настройка (один раз)

1. **SSH-ключ деплоя** — отдельная пара, публичная часть — в `~ubuntu/.ssh/authorized_keys` сервера:

   ```bash
   ssh-keygen -t ed25519 -N '' -C pokatim-deploy -f ~/.ssh/pokatim-deploy
   ssh-copy-id -i ~/.ssh/pokatim-deploy.pub ubuntu@<сервер>
   ```

2. **GitHub Environment `dev`** — секреты деплоя получают только джобы `environment: dev` на ветке `develop`:

   ```bash
   # окружение с правилом Deployment branches = develop
   gh api -X PUT repos/rkarakulov/pokatim/environments/dev \
     -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/rkarakulov/pokatim/environments/dev/deployment-branch-policies -f name=develop -f type=branch
   ```

   (то же в UI: Settings → Environments → New environment `dev` → Deployment branches and tags → Selected → `develop`.)

3. **Секреты и переменные окружения `dev`** (значения — из файла/stdin, не печатаются):

   ```bash
   printf '%s' '<сервер>' | gh secret set DEV_SSH_HOST --env dev
   gh secret set DEV_SSH_KEY --env dev < ~/.ssh/pokatim-deploy
   ssh-keyscan -t ed25519 <сервер> > /tmp/pokatim-known-hosts   # сверить отпечаток с сервером:
   #   ssh ubuntu@<сервер> ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   gh secret set DEV_SSH_KNOWN_HOSTS --env dev < /tmp/pokatim-known-hosts
   gh variable set DEV_PUBLIC_HOST --env dev --body '<хост>'
   # необязательно: e-mail для Let's Encrypt (уведомления об истечении); пользователь SSH, если не ubuntu
   gh variable set DEV_CERTBOT_EMAIL --env dev --body '<e-mail>'
   gh variable set DEV_SSH_USER --env dev --body 'ubuntu'
   # необязательно: реальная доставка писем разрешённым адресам (раздел «Почта»)
   gh secret set DEV_MAIL_RELAY_RECIPIENTS --repo rkarakulov/pokatim --env dev --body '<адрес>,<адрес>'   # или '*'
   ```

   Все четыре — `DEV_SSH_HOST`, `DEV_SSH_KEY`, `DEV_SSH_KNOWN_HOSTS`, `DEV_PUBLIC_HOST` — обязательны: без них preflight
   падает с этим списком команд. `DEV_PUBLIC_HOST` не должен совпадать со значением секрета (GitHub отбросит выход
   preflight с хостом — build упадёт с подсказкой).

4. **Убрать уровень репозитория.** Секреты репозитория видны любому workflow любой ветки — после переноса удалить:

   ```bash
   gh secret delete DEV_SSH_HOST; gh secret delete DEV_SSH_KEY; gh secret delete DEV_SSH_KNOWN_HOSTS
   gh variable delete DEV_PUBLIC_HOST
   gh secret list; gh secret list --env dev   # на уровне репозитория DEV_* не осталось
   ```

5. **Пакеты `@rkarakulov/*`** уже открыты репозиторию для CI (local-dev.md, «CI и сборки») — сборка образов читает их
   тем же `GITHUB_TOKEN` (build secret, в слои не попадает). Образы `pokatim-*` в GHCR создаются первым деплоем,
   приватные, привязаны к репозиторию (label `org.opencontainers.image.source`) — отдельного доступа не нужно.
6. **DNS.** Временный хост — `pokatim-dev.<IP сервера через дефисы>.sslip.io`: wildcard-DNS sslip.io сам резолвит его в
   IP. Постоянный домен `pokatim-dev.limedolphin.com` — A-запись на IP сервера, затем «Смена домена».

На сервере вручную ничего не готовится: каталог `~/pokatim`, `.env` с секретами, vhost и сертификат создаёт первый
деплой. Предусловия (уже есть): Docker + Compose v2 (системный плагин), nginx, certbot, `ubuntu` в группе `docker` и
с sudo без пароля.

## Запуск

- **Автоматически:** push (merge PR) в `develop`. CI для push в `develop` идёт внутри `deploy-dev` (отдельного прогона
  `ci` на push нет); PR в `develop` проверяет `ci` (`pull_request`).
- **Вручную:** Actions → `deploy-dev` → Run workflow, ветка `develop`. Кнопка видна в UI, только когда
  `deploy-dev.yml` есть на default-ветке репозитория (сейчас `main`). До этого — `gh workflow run deploy-dev.yml --ref
  develop [-f image_tag=sha-…]` (GitHub принимает, если workflow уже регистрировался push-ем в `develop`) или новый push
  в `develop`.
- Поле `image_tag` пусто — CI, сборка и деплой текущего `develop`; задано — деплой уже собранного тега (откат).
- Итог — Summary прогона: тег, адреса, https или http. Cancel прогона останавливает и деплой.

## `.env` сервера

`~/pokatim/.env` (600) создаёт `bootstrap.sh` по `infra/deploy/env.template`:

- `MONGO_ROOT_PASSWORD` (root MongoDB — только администрирование), `MONGO_PASSWORD` (пользователь приложения
  `pokatim`, `readWrite` только на БД `pokatim`), `JWT_SECRET`, `EMAIL_TOKEN_SECRET`, `MAILPIT_UI_PASSWORD` —
  генерируются на сервере (`openssl rand -hex 32`) при первом деплое (новый ключ — при первом деплое после его
  появления в шаблоне); в лог, git и GitHub не попадают; повторные деплои их не меняют.
- `~/pokatim/mongo-keyfile` (600) — keyfile replica set (`openssl rand -base64 756`), создаёт `bootstrap.sh` один
  раз; в контейнер монтируется только для чтения, копия — в томе `mongoconfig` с владельцем `mongodb`.
- Недостающие ключи шаблона дописываются, существующие значения не трогаются (правка руками сохраняется).
- `MAIL_RELAY_HOST`/`MAIL_RELAY_PORT` (умолчание — SES `email-smtp.eu-north-1.amazonaws.com:587`),
  `MAIL_RELAY_USERNAME`/`MAIL_RELAY_PASSWORD` (пусто) — relay почты, вписываются руками (раздел «Почта»).
- `MAIL_RELAY_RECIPIENTS` (адреса или `*`) — из секрета `DEV_MAIL_RELAY_RECIPIENTS` каждого деплоя (нет — очищается);
  `MAILPIT_RELAY_*` и файл `~/pokatim/mailpit-relay.yml` (600) вычисляет `bootstrap.sh` —
  руками не править.
- `PUBLIC_HOST`, `WEB_ORIGIN` (`https://<хост>`), `APP_LINK_BASE` (`https://<хост>/`), `POKATIM_TAG` — **всегда** из
  деплоя (переменная окружения `dev` и тег).
- `CORS_ORIGINS` пусто (web и API — один origin за nginx), `TRUST_PROXY=1` (один прокси — nginx хоста; он
  перезаписывает `X-Forwarded-For` адресом клиента).
- Треки и устройства (ADR-0011, раздел «Треки и устройства»): `TRACK_STORAGE_MAX_BYTES` (2 GiB),
  `TRACK_STORAGE_MIN_FREE_BYTES` (1 GiB), `DEVICES_ENABLED=false`, `OW_API_URL`, `OW_API_KEY`, `OW_WEBHOOK_SECRET`,
  `OW_SHARED_INSTANCE=true`, `OW_DOCKER_NETWORK` — пустые ключи OW дописывает шаблон, значения вписывает владелец
  руками (как `MAIL_RELAY_*`).
- Push через Expo (ADR-0017, runbook [`push.md`](push.md)): `PUSH_ENABLED=false` дописывает шаблон (push выключен —
  уведомления только в центре), `EXPO_ACCESS_TOKEN` — необязательный секрет, вписывает владелец руками.

Потеря `.env` при живом томе `mongodata`: новый `MONGO_ROOT_PASSWORD` не совпадёт с root в базе — `mongo-init.js`
упадёт с сообщением «MONGO_ROOT_PASSWORD из .env не подходит к root в томе mongodata».
Частично упавший деплой (после старта `mongo`) так не ломается: `bootstrap.sh` дописывает пароли в `.env` до первого
старта, повторный деплой идёт с тем же `.env` и томом. Восстановить файл из бэкапа или пересоздать стенд (`down -v` — данные dev
теряются, только с согласия автора). Смена `MONGO_PASSWORD` в `.env` — следующий деплой обновит пароль пользователя
приложения сам (root не меняется).

## nginx

Свой файл `/etc/nginx/sites-available/pokatim` + ссылка в `sites-enabled`; перед reload — `nginx -t`, при ошибке
откатывается только свой файл. Чужие сайты не меняются:

- `listen 443 ssl;` без `http2` и без `default_server`: в nginx 1.24 (Ubuntu 24.04) параметры `listen` действуют на
  весь сокет `*:443` — `http2` включил бы HTTP/2 соседним сайтам.
- Сервер по умолчанию для порта (запросы без SNI/с чужим `Host`) — блок с `default_server`, иначе первый по порядку
  включения (`sites-enabled` — по алфавиту). `bootstrap.sh` после установки проверяет `nginx -T`: если по умолчанию для
  :80 или :443 оказался `pokatim` — `::warning::` в логе (деплой ничего не меняет у соседей). Проверить вручную:
  `sudo nginx -T | grep -nE '^# configuration file|listen'` — первым с `listen 443`/`listen 80` (или с
  `default_server`) должен быть не `pokatim`. Если всё же он — согласовать с владельцами сервера явный
  `default_server` у их сайта; переименовывать свой файл «в конец алфавита» — крайняя мера (имя меняет и откат).
- Dev-стенд отдаёт `X-Robots-Tag: noindex, nofollow` — поисковики его не индексируют.
- `/mail/` (UI Mailpit) — только в https-блоке, с WebSocket (`map $http_upgrade $pokatim_mail_connection` — своё имя
  переменной: `map` общий для всех сайтов сервера). Без сертификата `/mail/` → 404.
- `/ow/` — прокси на Open Wearables этого хоста (ADR-0011), только если в `.env` задан
  `OW_PUBLIC_PROXY=http://127.0.0.1:<порт API OW>` (другие адреса отклоняются — открытого прокси нет). Нужен для
  вебхуков провайдеров на нашем домене: в портале Garmin — `https://<PUBLIC_HOST>/ow/api/v1/providers/garmin/webhooks`.
  Сам API pokatim ходит в OW по docker-сети (`OW_API_URL`), не через этот путь.

## TLS

Сертификат Let's Encrypt выпускается `certbot certonly --webroot -w /var/www/html --cert-name <хост>` (тот же
webroot, что у соседних сайтов), только если домен ведёт на этот сервер: A-запись = публичный IP EC2 (IMDSv2) или
проба HTTP-01 через этот nginx прошла. Продление — штатный `certbot renew` (таймер certbot) с
`--deploy-hook 'systemctl reload nginx'`.

Нет DNS, лимит Let's Encrypt (sslip.io — общий домен), ошибка certbot — **деплой не падает**: vhost только на :80,
`::warning::` в логе и строка в Summary; следующий деплой пробует снова. Адреса в лог не выводятся; сверить DNS —
`dig +short <хост>` против IP сервера. **До сертификата web-сессия не работает:** refresh-cookie `__Secure-pokatim_rt`
браузер принимает только по https, клиентский бандл ходит на `https://<хост>` (`EXPO_PUBLIC_API_URL` вшит при
сборке). API (`/v1/health`) и админка открываются и по http.

## Смена домена

1. A-запись нового домена → IP сервера (проверить: `dig +short pokatim-dev.limedolphin.com`).
2. `gh variable set DEV_PUBLIC_HOST --env dev --body 'pokatim-dev.limedolphin.com'`.
3. Деплой (push в `develop` или ручной запуск **без** `image_tag`: образ web пересобирается — адрес API вшит в бандл).

Деплой перепишет vhost `pokatim` на новый `server_name`, выпустит сертификат, выставит `PUBLIC_HOST`/`WEB_ORIGIN`/
`APP_LINK_BASE`; секреты и данные не меняются. Старый сертификат остаётся (предупреждение в логе) — удалить:
`ssh ubuntu@<сервер> sudo certbot delete --cert-name <старый хост>`. Ссылки из уже отправленных писем ведут на
старый хост.

## Логи, почта, состояние

В лог Actions деплой при сбое выводит только состояние контейнеров (`compose ps`) и коды выхода — логи приложений
могут содержать персональные данные тестировщиков, их смотрят только по SSH. Вывод миграций каждого деплоя —
в `~/pokatim/migrate.log`, подготовки MongoDB — в `~/pokatim/mongo-init.log` на сервере (права 600,
перезаписываются), в Actions — только код выхода и строки `mongo-init:`:

```bash
ssh ubuntu@<сервер>
cd ~/pokatim
alias dc='docker compose -p pokatim-dev -f docker-compose.yml --env-file .env'
dc ps -a
dc logs -f --tail 200 api worker
dc logs --tail 200 web admin
cat migrate.log                              # вывод миграций последнего деплоя (в Actions — только код выхода)
dc run --rm migrate                          # повторить миграции вручную (вывод — в терминал)
curl -s http://127.0.0.1:3100/v1/health      # version = развёрнутый тег
```

MongoDB/Redis — только изнутри. MongoDB — root, пароль — `MONGO_ROOT_PASSWORD` из `.env` (mongosh спросит, в argv и
историю не попадает): `dc exec mongo mongosh -u root -p --authenticationDatabase admin pokatim`; Redis —
`dc exec redis redis-cli`.

**Бэкап MongoDB вручную** (ночной дамп в S3 — задача `backup-restore.md`): пароль root mongodump/mongorestore
спрашивают сами (`-u` без `-p`, нужен TTY — без `-T`), архив — во временный файл контейнера и в `~/pokatim/backup/`:

```bash
mkdir -p -m 700 ~/pokatim/backup
dc exec mongo mongodump -u root --authenticationDatabase admin --db pokatim --gzip --archive=/tmp/pokatim.archive.gz
dc cp mongo:/tmp/pokatim.archive.gz ~/pokatim/backup/pokatim-$(date +%F).archive.gz && dc exec mongo rm /tmp/pokatim.archive.gz
# восстановление (--drop — заменить коллекции):
dc cp ~/pokatim/backup/pokatim-<дата>.archive.gz mongo:/tmp/restore.archive.gz
dc exec mongo mongorestore -u root --authenticationDatabase admin --gzip --archive=/tmp/restore.archive.gz --drop
dc exec mongo rm /tmp/restore.archive.gz
```

## Почта

Письма стенда (подтверждение e-mail и др.) ловит Mailpit — **все** видны в `https://<хост>/mail/`. Наружу письма
уходят, только если relay включён (ниже): Mailpit пересылает их через внешний SMTP адресатам из списка
`DEV_MAIL_RELAY_RECIPIENTS` или всем (`*`). Без relay наружу не уходит ничего, «Release» в UI недоступен.

- **Открыть:** `https://<хост>/mail/`, логин `dev` (basic-auth самого Mailpit; без пароля — 401). Ссылка — и в Summary
  прогона `deploy-dev`. Только по https: пока сертификата нет, `/mail/` → 404 (пароль не идёт открытым текстом).
- **Пароль** — `MAILPIT_UI_PASSWORD` в `.env` сервера (генерирует деплой, в git/GitHub/лог не попадает):

  ```bash
  ssh ubuntu@<сервер> 'grep ^MAILPIT_UI_PASSWORD= ~/pokatim/.env'
  ```

  Передавать тестировщикам — личным сообщением, не в общие каналы и не в issue/PR (репозиторий публичный).
- **Сменить** (утёк, ушёл тестировщик) — удалить ключ и передеплоить (ручной запуск `deploy-dev` с текущим
  `image_tag` или push в `develop`): деплой сгенерирует новый и пересоздаст контейнер mailpit.

  ```bash
  ssh ubuntu@<сервер> "sed -i '/^MAILPIT_UI_PASSWORD=/d' ~/pokatim/.env"
  ```

  Свой пароль — вписать `MAILPIT_UI_PASSWORD=<значение>` в `.env` (только `[A-Za-z0-9]`: значение уходит в
  `MP_UI_AUTH` как `dev:<пароль>` и в конфиг curl smoke) и передеплоить.
- **Доступ к письмам = доступ к чужим аккаунтам стенда** (ссылки подтверждения): пароль обязателен, UI не открывать
  без него.
- **Запасной путь** (нет https, проверка без nginx) — SSH-туннель к порту хоста, тот же логин и пароль:

  ```bash
  ssh -N -L 8125:127.0.0.1:8125 ubuntu@<сервер>   # письма: http://127.0.0.1:8125/mail/
  ```

### Реальная доставка (relay)

Включён, когда заданы все три: секрет `DEV_MAIL_RELAY_RECIPIENTS` (окружение `dev`) и `MAIL_RELAY_USERNAME` +
`MAIL_RELAY_PASSWORD` в `~/pokatim/.env`. Чего-то нет — relay выключен, деплой не падает, в логе — строка
`почта: relay выключен (нет …)` (имена ключей, без значений).

Два режима — по значению секрета:

| Секрет | Режим | Кому уходит | Summary |
|---|---|---|---|
| `a@x.com,b@y.org` | список | только этим адресам | «relay включён — только адресам из секрета …» |
| `*` (ровно звёздочка) | всем | каждому адресату любого письма | «relay: всем — каждое письмо уходит адресату …» |
| нет секрета / пусто | выключен | никому | «relay выключен — письма только в Mailpit» |

- **Как работает:** штатный relay Mailpit; письмо всегда сохраняется в Mailpit, копия уходит наружу.
  - Список — auto-relay по регулярке (`MP_SMTP_RELAY_MATCHING`): `bootstrap.sh` собирает из адресов якорную
    `(?i)^(a@x\.com|b@y\.org)$`; она же — `allowed-recipients` для ручного «Release» из UI.
  - Всем — `MP_SMTP_RELAY_ALL=true` («relay all»), без ограничения адресатов (и для «Release» тоже).
  - Хост, порт, логин и пароль — в `~/pokatim/mailpit-relay.yml` (600, генерирует `bootstrap.sh`), не в env
    контейнера. STARTTLS обязателен, сертификат сервера проверяется.
  - Ошибка внешнего SMTP (лимит, sandbox, неверный пароль) — только в логе mailpit; API письмо всё равно отправлено
    (в Mailpit оно есть).
- **Получатели** — секрет (маскируется в логах Actions, на сервер идёт через stdin): ровно `*` или адреса через
  запятую, не больше 20, каждый — простой e-mail (латиница, цифры, `. _ + -`; без пробелов и кавычек), иначе
  preflight падает с номером элемента. Секрет — источник истины: удалить его — relay выключится на следующем деплое.

  ```bash
  gh secret set DEV_MAIL_RELAY_RECIPIENTS --repo rkarakulov/pokatim --env dev --body 'alice@example.com,bob+test@example.org'
  gh secret set DEV_MAIL_RELAY_RECIPIENTS --repo rkarakulov/pokatim --env dev --body '*'   # всем
  ```

- **Риски режима «всем».** Письмо уходит на любой адрес, введённый при регистрации, — в т. ч. на чужой или выдуманный
  (спам от имени ящика стенда, жалобы, рост bounce).
  - Защита в API — лимиты: регистраций не больше 20 в час с одного IP, повтор письма — пауза 60 с и не больше 10 в
    сутки на аккаунт. Других барьеров нет.
  - Gmail: лимит порядка 500 писем в сутки; при злоупотреблении (жалобы, bounce) Google может заблокировать ящик.
  - Для prod — только SES с проверенным доменом (DKIM/SPF/DMARC, production access), не Gmail.
  - Включать «всем» на время активного тестирования; иначе — список или выключено.

- **Логин и пароль SMTP** — сразу в `.env` сервера (не пересылать в мессенджерах, не в issue/PR), затем деплой (ручной
  запуск `deploy-dev` или push в `develop`). Допустимы латиница, цифры и `. _ @ + / = -`; значение можно взять в
  одинарные кавычки (`MAIL_RELAY_PASSWORD='…'`), иначе деплой падает с именем ключа:

  ```bash
  ssh ubuntu@<сервер>
  nano ~/pokatim/.env   # MAIL_RELAY_USERNAME='…', MAIL_RELAY_PASSWORD='…' (и при необходимости MAIL_RELAY_HOST/PORT, MAIL_FROM)
  ```

  Смена любого значения пересоздаёт контейнер mailpit — уже пойманные письма при этом теряются (хранилище без тома).

**Вариант (а) — Gmail** (временно, до SES): ящик `pokatim@gmail.com`.

- В аккаунте Google — двухэтапная аутентификация, затем «Пароли приложений» → пароль из 16 символов
  (обычный пароль аккаунта не подойдёт). Пробелы из показанного пароля убрать.
- `.env`: `MAIL_RELAY_HOST=smtp.gmail.com`, `MAIL_RELAY_PORT=587`, `MAIL_RELAY_USERNAME=pokatim@gmail.com`,
  `MAIL_RELAY_PASSWORD=<пароль приложения>`, `MAIL_FROM='Покатим dev <pokatim@gmail.com>'` (Gmail всё равно подставит
  в From свой ящик; ручное значение деплой не меняет).
- Лимит Gmail — порядка 500 писем в сутки; превышение — ошибки в логе mailpit, письма остаются в Mailpit.

**Вариант (б) — Amazon SES** (регион eu-north-1; умолчания `MAIL_RELAY_HOST`/`MAIL_RELAY_PORT` уже на него).

1. SES → Identities → домен `limedolphin.com` (Easy DKIM). В DNS домена:
   - 3 записи CNAME DKIM из консоли SES (`<token>._domainkey.limedolphin.com` → `<token>.dkim.amazonses.com`);
   - SPF: TXT `v=spf1 include:amazonses.com ~all` (если SPF уже есть — добавить `include:amazonses.com` в него,
     вторую запись SPF не создавать);
   - по желанию DMARC: TXT `_dmarc.limedolphin.com` → `v=DMARC1; p=none;`.
   Дождаться статуса Verified.
2. SES → SMTP settings → Create SMTP credentials (IAM-пользователь с `ses:SendRawEmail`) — логин и пароль SMTP
   (это не ключи IAM). Вписать в `.env` сервера `MAIL_RELAY_USERNAME`/`MAIL_RELAY_PASSWORD`; `MAIL_FROM` — умолчание
   шаблона `'Покатим dev <no-reply@limedolphin.com>'`.
3. **Sandbox:** новый аккаунт SES шлёт только на подтверждённые в SES адреса (Identities → Email address) и с
   лимитом 200 писем в сутки. Для любых адресов из списка — запросить production access (Account dashboard →
   Request production access).

**Проверить:**

- Summary прогона `deploy-dev` — одна из строк:
  - «Почта наружу: relay включён — только адресам из секрета `DEV_MAIL_RELAY_RECIPIENTS`, копия в Mailpit (runbook
    «Почта»)»;
  - «Почта наружу: relay: всем — каждое письмо уходит адресату, копия в Mailpit (runbook «Почта»)»;
  - «Почта наружу: relay выключен — письма только в Mailpit (runbook «Почта»)».

  Smoke деплоя сверяет состояние relay в Mailpit (`/mail/api/v1/webui`, `MessageRelay.Enabled`).
- Зарегистрироваться на стенде с разрешённого адреса — письмо в ящике и в `/mail/`; с неразрешённого — только в
  `/mail/` (в режиме «всем» — в ящике любой адрес).
- Ошибки отправки — `dc logs --tail 200 mailpit | grep relay` (по SSH; в логе есть адреса — не копировать в публичные
  места).

**Выключить:** `gh secret delete DEV_MAIL_RELAY_RECIPIENTS --repo rkarakulov/pokatim --env dev` и деплой — relay
выключен, логин и пароль остаются в `.env`. Насовсем — ещё очистить `MAIL_RELAY_USERNAME`/`MAIL_RELAY_PASSWORD` в
`.env` (и удалить SMTP credentials в SES / пароль приложения Google). Без деплоя (срочно) — очистить
`MAIL_RELAY_PASSWORD` в `.env` и `bash ~/pokatim/bootstrap.sh` с `PUBLIC_HOST=<хост> POKATIM_SKIP_NGINX=1`, затем
`dc up -d mailpit`.

## Переезд на MongoDB

Переезд dev-стенда PostgreSQL → MongoDB (ADR-0007, 2026-10-26) выполнен на сервере: контейнер `postgres` и том
`pokatim-dev_pgdata` удалены, ключи PostgreSQL убраны из `.env`, данные dev не переносились. Шаг `retire_postgres`
удалён из `deploy.sh` (слайс онбординга 4, 2026-10-25): он был идемпотентен, но больше не нужен. Если на каком-то
хосте остался стек на PostgreSQL — переезжать деплоем из коммита до удаления шага (история `infra/deploy/deploy.sh`).

**Репетиция обновления** (`infra/deploy/rehearsal.sh`, CI job `deploy-rehearsal` на PR, меняющих деплой, образ, API
или workflow): стек базовой ветки (её `deploy.sh` и файлы стека, образы — локальные сборки PR) + маркер-данные в
MongoDB → новый `deploy.sh` поверх (новые миграции применены, smoke, маркер и секреты `.env` на месте) → повторный
деплой («новых миграций нет») → права пользователя `pokatim` → деплой с битым `JWT_SECRET` падает, данные на месте,
после восстановления проходит. Записи миграций, которых нет в базовой ветке, после шага базовой ветки снимаются — БД
в её состоянии. Только с **отдельным** `POKATIM_PROJECT` (по умолчанию `pokatim-rehearsal`; `pokatim-dev` скрипт
отвергает), временным `HOME` и `POKATIM_SKIP_PULL=1 POKATIM_SKIP_NGINX=1`; вручную — на машине с Docker и локальными
образами (`POKATIM_TAG`, `POKATIM_IMAGE_PREFIX`), не на общем сервере (те же порты хоста).

## Остатки переезда on-bike → pokatim

Переезд стенда on-bike → pokatim (2026-10-25) завершён деплоем `sha-64bf48d`; шаги переезда из скриптов удалены.
Каталог `~/on-bike` и тома `on-bike-dev_*` на сервере уже убраны. Если что-то осталось — только с согласия автора:
`docker volume ls --filter name=on-bike-dev_`, `docker volume rm <тома>`; vhost `on-bike` в
`/etc/nginx/sites-{available,enabled}/` — `sudo rm` обоих, `sudo nginx -t && sudo systemctl reload nginx`.

## Откат

Actions → `deploy-dev` → Run workflow, `image_tag` = прошлый тег `sha-<7>` (теги — в Summary прошлых прогонов или
GHCR → Packages → `pokatim-api`). CI и сборка пропускаются, разворачиваются образы этого тега (из GHCR; локальные
старые образы прочищаются). Workflow тянет образы токеном `GITHUB_TOKEN` сам.

- **Через границу БД откат невозможен:** образы до перехода на MongoDB ждут PostgreSQL (`DATABASE_URL`), а деплой
  кладёт compose с MongoDB — для них только «Ручной возврат на PostgreSQL» (раздел выше).
- Миграции MongoDB не откатываются (у мигратора нет down): откат кода на версию до миграции работает, только если
  миграция обратно совместима (expand → contract). Деструктивные миграции — только с человеком (AGENTS.md §4.6).
- Образ web прошлого тега содержит адрес API того хоста, с которым собран: после смены домена откатываться только на
  сборки нового домена.
- **Вручную по SSH** (без workflow) `deploy.sh` тянет образы из GHCR сам: пакеты `pokatim-*` сейчас public, логин не
  нужен; если пакет закрыт — токен `read:packages` первой строкой stdin:
  `printf '%s\n' "$TOKEN" | GHCR_USER=<логин> GHCR_TOKEN_STDIN=1 POKATIM_TAG=sha-<7> PUBLIC_HOST=<хост> bash ~/pokatim/deploy.sh`
  (логин — во временный `DOCKER_CONFIG`, удаляется после pull).

## Уборка GHCR

Пакеты прежнего имени `on-bike-{api,web,admin}` (public) деплой не использует с `sha-64bf48d`. Удаляет человек после
merge перехода на MongoDB (токен с `delete:packages`: `gh auth refresh -s delete:packages`):

```bash
for p in on-bike-api on-bike-web on-bike-admin; do
  gh api -X DELETE "/user/packages/container/$p"
done
```

Удаление пакета необратимо (теги и версии пропадают); пакеты `pokatim-*` не трогать.

## Треки и устройства

ADR-0011, `docs/product/tracks-and-devices.md`.

**Память worker** — 512m (разбор трека в потоке: 160 МБ старого + 32 МБ молодого поколения).

**Хранилище исходников.** Том `trackfiles` (`/data/trackfiles` в api и worker): файлы FIT/GPX и потоки агрегатора
(`<2 символа>/<ключ>.<fit|gpx|stream.json.gz>`). Квота — `TRACK_STORAGE_MAX_BYTES` (сумма хранимых, 2 GiB), запас
диска — `TRACK_STORAGE_MIN_FREE_BYTES` (1 GiB): при нехватке загрузка — `503 TRACK_STORAGE_FULL`, импорт откладывается.
Уборка (worker, ежечасно): исходники отбракованных загрузок старше 7 дней и файлы без документа старше 1 ч. Бэкап —
вместе с MongoDB (`docker run --rm -v pokatim-dev_trackfiles:/data -v "$PWD":/out busybox tar czf /out/trackfiles.tgz
-C /data .`); без тома заезды остаются в БД, но исходник для будущих гонок и споров теряется. Размер:
`docker system df -v | grep trackfiles`. S3 — до прода.

**Устройства (Open Wearables).** На dev — общий инстанс OW соседнего сервиса (`OW_SHARED_INSTANCE=true`; в prod —
запрещено, сервис не стартует). Включение (владелец, агенту ключи не передаются):

1. API key OW для pokatim (dev-портал OW) → `~/pokatim/.env`: `OW_API_KEY`, `OW_API_URL=http://<сервис OW>:8000`.
2. Сеть: `OW_DOCKER_NETWORK=<сеть стека OW>` — деплой подключает api и worker к этой внешней сети
   (`docker-compose.ow.yml`); проверить: `docker network inspect <сеть> | grep pokatim-dev`. Пусто — файл не
   подключается.
3. `DEVICES_ENABLED=true`, деплой. Проверка: `GET /v1/devices` под входом — Garmin/Wahoo `available: true`;
   OW недоступен — `available: false`, ручная загрузка работает.
4. `redirect_uri` — `https://<хост>/v1/devices/callback?t=…`: в OW 0.9 allowlist `redirect_uri` нет (исходники OW),
   у провайдеров ничего не меняется (их redirect URI ведут в OW).
5. Push (необязательно): исходящие вебхуки OW — настройка всего инстанса (согласовать с соседним сервисом);
   эндпоинт `https://<хост>/v1/devices/webhook`, типы `workout.created`, `connection.*` (тело ≤ 64 КБ —
   timeseries-события не подписывать), секрет `whsec_…` → `OW_WEBHOOK_SECRET`. Без секрета маршрут отвечает 404,
   работает pull каждые 15 мин.
6. Тестеры — аккаунты Garmin/Wahoo, **не подключённые к соседнему сервису** (один consumer на инстанс OW: подключение
   или отключение в одном проекте затрагивает регистрацию у провайдера для другого).

**Expo Go:** подключение устройств проверяется только в dev build (`pokatim://devices/return`); `exp://` в
`DEVICE_RETURN_URLS` — только локально (в production запрещён проверкой env).

**Версия OW** — пин на коммит `0.9.0-140` (`git describe` развёрнутого образа: `0.9.0-140-g25edd80c`); адаптер сверен с
исходниками OW этой версии. Обновление OW — предупредить pokatim и прогнать ручной смоук «Устройств».

**Откат:** `DEVICES_ENABLED=false` + деплой — экран показывает только ручную загрузку; подключения и заезды в БД
остаются. Отключить сеть OW — очистить `OW_DOCKER_NETWORK` и задеплоить.

**Переход на свой OW (prod):** свой инстанс (пин версии), свои приложения Garmin/Wahoo, `OW_SHARED_INSTANCE=false`;
подключения dev не переносятся.

## Диск

Порог деплоя — 1,5 ГБ свободно (`MIN_FREE_MB`), иначе `::error::` без изменений на сервере. Освобождать только своё:
`docker image prune -af --filter label=by.pokatim.project=pokatim`. Чужие образы, тома и `docker system prune` —
нельзя (общий сервер).

## Миграции релизов

- `0004_profile` (онбординг, слайс 4) — коллекция `profiles`; expand-only, без переноса данных, повторный прогон —
  без изменений. Применяется шагом `migrate` деплоя до запуска API.
- `0005_panel` (панель «Протокол», admin-01) — коллекции `panel_members`, `panel_sessions` (TTL-уборка 30 дней после
  абсолютного срока), `panel_audit`, `panel_meta` с документом-замком `admins`; expand-only, идемпотентна. Тем же
  шагом `migrate`.
- `0006_panel_audit_subject`, `0007_races`, `0008_calendar` (admin-02) — индекс журнала по объекту действия
  (`panel_audit_subject_idx`; старые записи не меняются), коллекции `seasons`, `races`, `race_meta` (документ-замок
  `schedule`), `calendar_starts` с индексами публичных списков и панели; expand-only, без переноса данных,
  идемпотентны (повторный прогон — «новых миграций нет»). Тем же шагом `migrate`.
- `0010_tracks`, `0011_devices` (tracks-devices, ADR-0011) — коллекции `track_uploads`, `activities`
  (`2dsphere` точки старта), `activity_tracks` (`2dsphere` линии), `activity_meta`; `device_accounts`,
  `device_connections` (частичный уникальный по живым статусам), `device_link_tickets` (TTL), `device_imports`,
  `device_audit`; expand-only, идемпотентны. `0012_track_source_refs` — маркеры удалённых объектов источника
  (удалённый заезд агрегатора не воскресает); expand-only.

## Панель «Протокол»: первый администратор

Панель — `https://<хост>/admin/` (стенд и прод — тот же домен; прод: Caddy `PUBLIC_HOST` `/admin/*` → контейнер
`admin`, `infra/Caddyfile`). Вход — e-mail и пароль аккаунта приложения; роль выдаёт администратор (ADR-0009).

1. Будущий администратор регистрируется в приложении (web `https://<хост>/register`) и подтверждает e-mail.
2. На сервере (каталог стека, `dc` — `docker compose` проекта):

   ```bash
   dc exec api node dist/cli/panel.js grant-admin --email <e-mail> --name "<Имя в панели>"
   ```

   Код 0 — роль выдана (или уже администратор), в выводе — id пользователя (e-mail не печатается); код 2 —
   пользователь не найден или e-mail не подтверждён (зарегистрироваться и подтвердить). Запись журнала — с актором
   `cli`.
3. Вход на `/admin/` → «Сотрудники» → «Выдать роль» остальным (только существующим пользователям приложения).

**Аварийное восстановление** (последний администратор удалил аккаунт или потерял доступ) — та же команда для другого
подтверждённого пользователя; разрешена и при существующих администраторах (Q10), каждое применение — в журнале.

Рекомендации команде: работать в панели в **отдельном профиле браузера** (тот же домен, что у web приложения —
принятый риск C3, ADR-0009); сброс пароля в приложении сразу завершает сессии панели. **До прода** — 2FA (TOTP) для
администраторов и строгий CSP web приложения (отдельные задачи).

## Release-чеклист сторов (приложение)

- **Шаг геопозиции в онбординге — только при живой фиче «рядом»** (R6 слайса 4, App Review 5.1.1): до первой
  публикации в App Store / Google Play проверить, что «рядом» использует геопозицию; иначе выключить шаг —
  `LOCATION_STEP_ENABLED = false` в `apps/app/src/features/onboarding/onboarding-store.ts` (экран и разрешение
  остаются в сборке, но не запрашиваются).
- **Кофе-райды — модерация есть (05b)**: перед выпуском в прод проверить, что у команды платформы есть хотя бы один
  `moderator` или `admin` панели (очередь «Модерация райдов» разбирается людьми; автоскрытия нет).
- **«Поделиться» в native** — сборке EAS нужен `EXPO_PUBLIC_WEB_ORIGIN` (`https://<хост>`, публичный адрес web-
  карточек; задаётся в EAS env профиля вместе с `EXPO_PUBLIC_API_URL`): без него кнопки «Поделиться» нет. Web берёт
  адрес страницы.

## Проверка

- Summary прогона: «Статус: success», адреса.
- `https://<хост>/v1/health` → `{"status":"ok","version":"sha-…"}`.
- `/register` — форма регистрации (SSR), `/admin/` — «Вход в панель» (заголовки: строгий
  `Content-Security-Policy`, `Cache-Control: no-store`).
- `https://<хост>/mail/` без пароля → 401; с логином `dev` — UI Mailpit.
- Регистрация → письмо в Mailpit (`https://<хост>/mail/`) → ссылка `https://<хост>/auth/verify/…`.

## Убрать стенд

Только с согласия автора: `dc down -v` (тома данных удаляются), `sudo rm /etc/nginx/sites-enabled/pokatim
/etc/nginx/sites-available/pokatim && sudo nginx -t && sudo systemctl reload nginx`, `sudo certbot delete --cert-name
<хост>`, `rm -rf ~/pokatim`.
