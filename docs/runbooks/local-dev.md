# Локальная разработка

Когда применять: первый запуск на новой машине, после `pnpm install`, когда API не стартует из-за env.

## Шаги

0. Доступ к пакетам базы `@rkarakulov/*` (GitHub Packages, ADR-0004), один раз на машине:
   `gh auth refresh -s read:packages` и в пользовательский `~/.npmrc` строку
   `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` (pnpm раскрывает переменные только там, не в
   проектном `.npmrc`). Перед `pnpm install` — `export NODE_AUTH_TOKEN=$(gh auth token)`.
   Сам токен нигде не записывается.
1. Инфраструктура: `pnpm infra:up` — MongoDB 8.0 (`127.0.0.1:27017`, single-node replica set `rs0`: при первом
   запуске healthcheck делает `rs.initiate`, команда ждёт PRIMARY), Redis (`:6379`), Mailpit (SMTP `:1025`, веб
   `http://127.0.0.1:8025`). MongoDB в dev — без пользователей и пароля, поэтому порт открыт только на `127.0.0.1`.
2. Окружение API: `cp apps/api/.env.example apps/api/.env` и заполнить секреты:
   `JWT_SECRET` и `EMAIL_TOKEN_SECRET` — случайные строки не короче 32 символов
   (`openssl rand -hex 32`). Файл `.env` в git не попадает.
3. Миграции (отдельный шаг, при старте API не выполняются): `pnpm --filter @pokatim/api db:migrate`.
4. Запуск: `pnpm dev --filter=@pokatim/api` (HTTP `:3000`) и `pnpm dev:worker` (outbox → BullMQ, письма).
   Без worker письма не уходят — события копятся в `outbox`.
5. Приложение: `pnpm --filter @pokatim/app dev` (QR → Expo Go, `i` / `a` — симуляторы, `w` — браузер,
   `http://localhost:8081`; web — раздел «Web»).
   Админка: `pnpm dev --filter=@pokatim/admin` (`http://127.0.0.1:5173`, `/v1` проксируется на API).

## Переменные API

| Переменная | Dev-значение | Назначение |
|---|---|---|
| `MONGO_URL` | `mongodb://127.0.0.1:27017/pokatim?directConnection=true` | основная БД: имя БД в пути обязательно; `directConnection` — член набора объявлен как `127.0.0.1:27017` внутри контейнера |
| `REDIS_URL` | `redis://127.0.0.1:6379` | BullMQ, rate-limit |
| `TRUST_PROXY` | `0` | `1` за обратным прокси: доверять одному прокси в `X-Forwarded-For` |
| `SMTP_URL` | `smtp://127.0.0.1:1025` | Mailpit |
| `JWT_SECRET` | случайная строка ≥ 32 | подпись access JWT |
| `EMAIL_TOKEN_SECRET` | случайная строка ≥ 32 | HMAC токенов ссылок в письмах (ADR-0002) |
| `MAIL_FROM` | `'Покатим <no-reply@limedolphin.com>'` | отправитель писем (в кавычках) |
| `APP_LINK_BASE` | `exp://127.0.0.1:8081/--/` | база ссылок в письмах, со слешем в конце |
| `AGREEMENT_VERSION` | `2026-10-draft` | версия соглашения, записывается в `user_consents` |
| `CORS_ORIGINS` | `http://localhost:8081,…` | origin-ы web в dev через запятую: `expo start` (:8081), `start:web` (:8080), `e2e:web` (:8090, :8091); пусто — CORS выключен (прод: один origin за прокси) |

`127.0.0.1`, а не `localhost`: на macOS `localhost` может уйти в IPv6, где контейнеры не слушают.

## Ссылки из писем и Expo Go

Expo Go не открывает схему `pokatim://`. Для проверки на телефоне через Expo Go:

- `APP_LINK_BASE=exp://<LAN-IP компьютера>:8081/--/` (тот же адрес, что показывает `expo start`);
  на симуляторе — `exp://127.0.0.1:8081/--/`;
- в нативных dev/preview-сборках до появления домена — `APP_LINK_BASE=pokatim://`;
- в браузере (web в dev) — `APP_LINK_BASE=http://127.0.0.1:8081/`: ссылка открывает маршрут приложения в браузере;
- в проде — https-база приложения (ADR-0003 §5): ссылка открывается в браузере/PWA или в установленном приложении.

После смены `APP_LINK_BASE` перезапустите worker: ссылка собирается при отправке письма.

## Web

Приложение одно для iOS, Android и браузера: `web.output: 'server'` — HTML каждой страницы рендерится на сервере
(SSR), публичные экраны отдают OG-мета; PWA — manifest и service worker (кеш только статики сборки).

- **Dev:** `pnpm --filter @pokatim/app dev` и `w`; открывайте `http://127.0.0.1:8081` при
  `EXPO_PUBLIC_API_URL=http://127.0.0.1:3000` — тот же хост, что у API: `localhost` и `127.0.0.1` — разные
  сайты, cookie сессии web (`SameSite=Strict`) между ними не ходит. Браузер ходит в API на другом порту — origin
  должен быть в `CORS_ORIGINS` API (`.env.example` — значения для dev): он же доверенный для CSRF-защиты, иначе
  POST из браузера получит 403. Пустой `CORS_ORIGINS` вне production API отмечает предупреждением в логе при
  старте. Ссылки из писем в браузер — `APP_LINK_BASE=http://127.0.0.1:8081/`.
- **Сессия web:** refresh — httpOnly cookie `__Secure-pokatim_rt` (`Path=/v1/auth/session`), access — в памяти
  вкладки; после перезагрузки приложение восстанавливает вход запросом `POST /v1/auth/session/refresh` по cookie.
  Без входа этот запрос отвечает 401 — в консоли браузера «Failed to load resource … 401», это ожидаемо.
  Регистрация «Подтвердите e-mail» — в `sessionStorage` вкладки. Chrome и Firefox считают `http://127.0.0.1`
  безопасным контекстом и хранят `Secure`-cookie; **Safari по `http` её не хранит** — вход не переживёт
  перезагрузку. Проверка в Safari — только по https (Caddy `infra/Caddyfile` локально) или принять ограничение dev.
- **Production-сборка:** сначала `cp apps/app/.env.example apps/app/.env` (`EXPO_PUBLIC_API_URL` нужен уже сборке:
  без него `build:web` падает «EXPO_PUBLIC_API_URL не задан для сборки»), затем `pnpm build:web` (`apps/app/dist`:
  `client/` — статика и `sw.js`, `server/` — рендер и API-маршруты) и `pnpm --filter @pokatim/app start:web`
  (`http://127.0.0.1:8080`). Кеш, сжатие и TLS — на обратном прокси перед сервером. Прод (`infra/`): Caddy
  `PUBLIC_HOST` отдаёт `/v1/*` → `api:3000`, остальное → `web:8080` — один origin, CORS выключен.
- **Смоук в браузере:** `pnpm e2e:web` (Playwright, `apps/app/e2e/`): production- и dev-сборка (`dist-dev`, там
  витрина `/ui-kit`). Браузер — установленный Google Chrome; без него — `PW_CHANNEL=chromium` и один раз
  `pnpm --filter @pokatim/app exec playwright install chromium` (~150 МБ). Ошибки страницы проверяет
  фикстура `e2e/fixtures.ts` (тесты импортируют `test`, `expect` из неё): исключения и `console.error`
  production-сборки; отказ загрузки ресурса допустим, только если он в списке (URL + статус), отказ соединения с
  API — только без `E2E_API=1`.
- **Смоук проекта:** `apps/app/e2e/project.ts` — единственный проектный файл смоука, `copier update` его не
  перезаписывает: `servers` (API, worker и др. до web-серверов, обычно при `E2E_API=1`), `webServerEnv` (env
  web-серверов, например `API_INTERNAL_URL`), `expectedResourceErrors` (ожидаемые отказы: URL и HTTP-статус).
  `playwright.config.ts`, `fixtures.ts`, `urls.ts` — шаблонные. `pnpm e2e:web` запускает turbo с `--env-mode=loose`:
  окружение процесса (`E2E_*`, env серверов) доходит до Playwright и его серверов без списка в `turbo.json`.
  pokatim: ожидаемые отказы — 401 `POST /v1/auth/session/refresh` анонима и 401 `POST /v1/auth/session/sign-in`
  (шаг «неверный пароль»); письма — `e2e/mailpit.ts` (`MAILPIT_URL`).
- **Смоук с API** (регистрация → письмо → подтверждение → вход → перезагрузка → выход → вход по паролю →
  перезагрузка → выход → «Забыли пароль?» → письмо → новый пароль → старый пароль 401 → вход новым → письмо
  «Пароль изменён»): при `E2E_API=1` Playwright сам
  поднимает API и worker из `apps/api/dist` (`e2e/project.ts`) с `APP_LINK_BASE` и `CORS_ORIGINS` смоука (`:8090`,
  `:8091`), остальное окружение — из `apps/api/.env`. Нужны `pnpm infra:up` (MongoDB, Redis, Mailpit), миграции
  и свободный порт API из `EXPO_PUBLIC_API_URL` (dev-API на `:3000` — остановить или взять другой порт):

  ```bash
  pnpm turbo run build --filter=@pokatim/api
  pnpm --filter @pokatim/api db:migrate
  EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 E2E_API=1 pnpm e2e:web
  ```

  Каждый прогон регистрирует подтверждённый аккаунт `e2e-<время>@pokatim.test` в dev-БД (очисткой неподтверждённых
  не удаляется). Без `E2E_API=1` сценарий регистрации пропускается (`skipped`), остальные шаги — без API.
- **Блокировка входа в dev** (ADR-0005: 5 попыток на e-mail+IP, 20 на e-mail, 50 на IP за 15 мин): ключи в Redis —
  `rl:signin-ip:*`, `rl:signin-email:*`, `rl:signin-email-ip:*` (HMAC, адресов в них нет). Снять все блокировки
  входа dev-API — удалить эти ключи в Redis из `REDIS_URL` (сервис `redis` из `pnpm infra:up`):
  `docker compose -f infra/docker-compose.dev.yml exec redis sh -c "redis-cli --scan --pattern 'rl:signin-*' | xargs -r redis-cli del"`
  (или подождать конца окна).
- **Лимиты запроса сброса пароля в dev** (ADR-0006: IP — 20 в час, e-mail — пауза 60 с и 5 писем в сутки): ключи
  `rl:pwreset-ip:*`, `rl:pwreset-email:*` (HMAC). Снять — так же, с шаблоном `'rl:pwreset-*'`. Новых переменных
  окружения сброс не требует: ссылка — `APP_LINK_BASE` + `auth/reset/<токен>`, письма — тот же SMTP (Mailpit).
- **PWA:** устанавливается только с https или `localhost`/`127.0.0.1`. Service worker регистрируется только в
  production-сборке; после смены сборки страница берёт новый `sw.js` (он `no-cache`). Сбросить —
  DevTools → Application → Service workers → Unregister.

Окружение web-сервера (`apps/app/.env`, `start:web` читает его сам; в проде — переменные окружения):

| Переменная | Dev-значение | Назначение |
|---|---|---|
| `PORT`, `HOST` | `8080`, `127.0.0.1` | адрес сервера (в контейнере — `HOST=0.0.0.0`) |
| `EXPO_PUBLIC_API_URL` | `http://127.0.0.1:3000` | публичный адрес API: нужен **и при сборке** (клиентский бандл), **и процессу сервера** (серверный бандл читает его во время запроса; без него сервер не стартует) |
| `API_INTERNAL_URL` | `http://127.0.0.1:3000` | адрес API для `loader` на сервере (в docker — внутренний); не задан — экраны берут данные из API в браузере |
| `WEB_ORIGIN` | `http://127.0.0.1:8080` | публичный origin сайта для `og:url`; не задан — `og:url` не выводится |
| `WEB_DIST` | `dist` | каталог сборки (e2e dev-сборки — `dist-dev`) |

`EXPO_PUBLIC_*` попадают в клиентский бандл — только публичные значения; серверные — без этого префикса.

## Проверка

- `curl http://127.0.0.1:3000/v1/health` → `{"status":"ok",…}`.
- Письма — в Mailpit: `http://127.0.0.1:8025` (API: `GET http://127.0.0.1:8025/api/v1/messages`).
- Регистрация: `POST /v1/auth/register` → письмо в Mailpit со ссылкой `…auth/verify/<token>`.
- Регистрация в браузере: `http://127.0.0.1:8081` → форма → письмо в Mailpit → ссылка → «Подтвердить e-mail» →
  первая вкладка входит; перезагрузка — вход сохранён (cookie, раздел «Web»).

## Тесты

`pnpm test` поднимает интеграционные тесты API на реальных MongoDB (replica set) и Redis:

- `MONGO_URL_TEST` (по умолчанию `mongodb://127.0.0.1:27017/pokatim_test?directConnection=true`) — база
  **удаляется** перед прогоном, миграции проекта применяются заново; имя обязано оканчиваться на `_test`;
  перед каждым тестом коллекции очищаются (индексы и учёт миграций остаются);
- `REDIS_URL_TEST` (по умолчанию `redis://127.0.0.1:6379/1`) — db 1, очищается перед каждым тестом.

Только unit: `pnpm --filter @pokatim/api exec vitest run --project unit`.

## CI и сборки

- **GitHub Actions** читает `@rkarakulov/*` токеном `GITHUB_TOKEN` только после того, как владелец пакетов
  откроет доступ репозиторию проекта: в настройках **каждого** из 8 пакетов (`config`, `design-tokens`, `ui`,
  `i18n-core`, `contracts-core`, `api-client-core`, `api-kit`, `test-kit`) → Manage Actions access → репозиторий
  проекта, роль Read. Без этого `pnpm install` в CI падает с 403.
- **Web в CI:** job `web` — `pnpm e2e:web` (web-сборка и Playwright-смоук на Google Chrome раннера). Отчёт при
  падении — артефакт `playwright-report`. Смоук с API — в отмеченных комментариями местах job: `services`, `env`
  (`E2E_API: '1'`, окружение API — только тестовые значения) и шаги подготовки (сборка API, миграции) перед
  `pnpm e2e:web`. pokatim: MongoDB replica set — шагом (как в `check`), services Redis и Mailpit, секреты API в
  job — фиктивные значения.
- **EAS Build** (облачная сборка) не видит ваш `~/.npmrc`: перед первой сборкой создайте в EAS секрет
  `NODE_AUTH_TOKEN` (токен с `read:packages`, видимость — secret) и хук `eas-build-pre-install` в
  `apps/app/package.json`, который дописывает строку авторизации в `~/.npmrc` сборщика — тот же вид, что
  локально. До этого EAS-сборка упадёт на установке `@rkarakulov/*` (шаблон хук пока не поставляет).

## Обновление шаблона

`uvx copier update --defaults` в чистом рабочем дереве: переносит изменения шаблона app-foundation
трёхсторонним слиянием и поднимает версию `@rkarakulov/*` в каталоге `pnpm-workspace.yaml`. Конфликты — маркеры
в файлах и `*.rej`; разрешить, удалить `*.rej`, затем `pnpm install && pnpm check`. Проверить наличие новой
версии — `uvx copier check-update`.

## MongoDB: миграции и прод

- **Миграции** — `apps/api/src/db/migrations/` (`NNNN_<имя>.ts`, объект `{ id, up(db) }`) и список в
  `migrations/index.ts`: новая — в конец, применённую не меняют. `db:migrate` применяет новые по порядку, учёт —
  коллекция `_migrations`. В dev и CI — `pnpm --filter @pokatim/api db:migrate` (`tsx`), в проде — шаг
  деплоя `node dist/db/migrate.js` (в каталоге `apps/api`, с `MONGO_URL`) до запуска новой версии API и worker.
- **«Миграции MongoDB уже идут»** — блокировка от параллельного запуска: документ `{ _id: 'lock' }` в
  `_migrations_lock`. Остался после падения процесса — убедиться, что `db:migrate` нигде не идёт, и удалить:
  `db.getCollection('_migrations_lock').deleteOne({ _id: 'lock' })` в `mongosh`.
- **Прод:** replica set из 3 узлов или Atlas (standalone `mongod` API не принимает: транзакции и outbox работают
  только на replica set), `MONGO_URL` с пользователем и паролем, TLS (`tls=true` или `mongodb+srv://`) и
  `replicaSet=…` вместо `directConnection`; пользователь приложения — роль `readWrite` только на свою БД.
- **Смена БД** (`database` в `.copier-answers.yml`) у готового проекта через `copier update` не поддерживается.

## Переезд на MongoDB (2026-10-26, ADR-0007)

Dev compose (project `pokatim-dev`): сервис `mongo` вместо `postgres`, том `mongodata` вместо `pgdata`. Данные dev
не переносятся — аккаунты регистрируются заново (сессии приложения — вход заново).

```bash
docker compose -f infra/docker-compose.dev.yml up -d --wait --remove-orphans   # снимает контейнер postgres
pnpm --filter @pokatim/api db:migrate
```

В своём `apps/api/.env` — `MONGO_URL` из `.env.example` вместо `DATABASE_URL`. Тестовая БД `pokatim_test`
создаётся сама при `pnpm test`. Том PostgreSQL удалить, когда не нужен: `docker volume rm pokatim-dev_pgdata`.

## Откат

Сбросить локальные данные: `pnpm infra:down`, удалить тома docker (`mongodata`, `redisdata`) вручную,
затем шаги 1–3.
