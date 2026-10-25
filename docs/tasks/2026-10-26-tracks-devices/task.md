# 1. Title

Треки и устройства: ручная загрузка FIT/GPX, подключение Garmin и Wahoo через агрегатор Open Wearables, шаг
«Подключите устройство» в онбординге, экран «Устройства»

# 2. Goal

Райдер получает заезды в «Покатим» без записи GPS в приложении (`AGENTS.md` §1):

- **вручную** — файл FIT или GPX с часов/велокомпьютера через системный picker (все платформы, ADR-0003);
- **автоматически** — подключив Garmin или Wahoo. «Покатим» не интегрируется с провайдерами напрямую: OAuth,
  токены и приём данных провайдеров делает self-hosted агрегатор **Open Wearables** (OW, версия пинуется); pokatim
  через свой API key OW создаёт пользователя OW, получает ссылку авторизации, забирает велотренировки и их трек
  (`/timeseries`: широта, долгота, высота) — по расписанию, по кнопке и (если включено) по вебхуку OW;
- в онбординге после геопозиции — шаг «Подключите устройство» (Garmin / Wahoo / «Позже»), пропускаемый; позже —
  экран «Устройства» (статус, «Синхронизировать сейчас», «Отключить», «Загрузить файл»).

Сервер — единственный авторитет (`AGENTS.md` §4.1): из файла или потока точек он сам считает время, дистанцию,
вид спорта, дубли; клиент присылает только байты файла. Результат — **активность** (`activities`) с упрощённой
геометрией (GeoJSON `LineString`, `2dsphere`) и исходником без прореживания (файл или сохранённый поток точек
агрегатора). Связь активности с гонкой — вне scope, модель её допускает (§5).

**Решения автора (2026-10-26):**
- v1 = ручная загрузка FIT/GPX + Garmin + Wahoo (Strava — нет), провайдеры — **через Open Wearables** (как в
  эталонной интеграции соседнего проекта), за портом агрегатора (ROOK и т. п. — будущий адаптер).
- ADR-0011 одобрен; правка `AGENTS.md` §1 одобрена.
- Q2–Q11 — по рекомендациям архитектора (§8.1): только велотренировки; без TCX; история 30 дней через historical
  sync OW (если поддерживается провайдером); при отключении заезды остаются (удаление — галочкой); шаг онбординга один
  раз, в том числе для уже зарегистрированных; загрузка без resumable; вход в «Устройства» — иконка в верхней панели;
  исходники хранятся, пока есть активность; лимит файла 16 МБ.

Источники: `AGENTS.md` §1, §4; `.claude/rules/{security,pokatim-security,backend,pokatim-backend,db,pokatim-db,
contracts,pokatim-contracts,app,pokatim-app,tests,pokatim-tests}.md`; ADR-0003, 0005, 0007, 0008, 0010;
`docs/product/onboarding.md`; `docs/runbooks/deploy.md`; эталонная интеграция OW соседнего проекта (вне
репозитория, только чтение: порт `HealthDataProvider`, адаптер OW 0.9, OAuth-callback с одноразовым state,
Svix-вебхук, cron-синхронизация) и исходники Open Wearables — сведения об API в Приложении A. Код и `.env`
соседнего проекта не копируются.

# 3. Scope

**ADR и рамки MVP**
- ADR-0011 «Треки и устройства»: Garmin/Wahoo — только импорт велозаездов **через self-hosted агрегатор** (без
  push, записи GPS, BLE); порт агрегатора; версия OW пинуется; хранилище файлов; общий инстанс OW на dev и свой —
  для prod (§8.1 K1). Правка `AGENTS.md` §1 и `pokatim-app.md`.

**Contracts / api-client** (`packages/contracts/src/{tracks,devices}/*.schema.ts`, `src/profile/onboarding.schema.ts`)
- Треки: `TRACK_FORMATS` (`fit`, `gpx`, `stream`), `TRACK_SOURCES` (`upload`, `garmin`, `wahoo`),
  `TRACK_UPLOAD_STATUSES`, `TRACK_FAILURE_CODES`, `ACTIVITY_SPORTS`; `TrackUpload`, `TrackUploadPage`,
  `TrackUploadQuery`; `TRACK_FILE_MAX_BYTES = 16 MiB`, `TRACK_FILE_EXTENSIONS`.
- Устройства: `DEVICE_PROVIDERS` (`garmin`, `wahoo` — порядок экрана, только в конец), `DEVICE_STATUSES`,
  `DEVICE_ISSUES`; `DeviceList`, `ConnectDeviceRequest`/`ConnectDeviceResponse`, `CompleteDeviceRequest`,
  `DisconnectDeviceRequest`, `DEVICE_RETURN_RESULTS`.
- Онбординг: `OnboardingStatus.devicesStepCompleted` (необязательное поле ответа), `CompleteDevicesStepRequest`.
- Коды ошибок (в конец): `TRACK_FORMAT_UNSUPPORTED`, `TRACK_TOO_LARGE`, `TRACK_STORAGE_FULL`,
  `DEVICE_PROVIDER_UNAVAILABLE`, `DEVICE_LINK_INVALID`, `DEVICE_PROVIDER_ERROR`.
- Enum-ы ответов приложения — `tolerantEnum`, запросы — строгие.
- `createApiClient` (явный `accessToken`, ADR-0008): `uploadTrack`, `getTrackUpload`, `listTrackUploads`,
  `deleteTrackUpload`, `listDevices`, `connectDevice`, `completeDevice`, `syncDevice`, `disconnectDevice`,
  `completeDevicesStep`.

**`packages/tracks` (`@pokatim/tracks`)** — разбор и геометрия (app pre-check + worker)
- `precheckTrackFile`, `detectTrackFormat` (по содержимому), `parseFit` (`@garmin/fitsdk`), `parseGpx`
  (`fast-xml-parser`, без DTD/сущностей), `parseStream` (наш нормализованный поток точек `pokatim.stream.v1` —
  JSON из агрегатора), `sanitizePoints`, `summarizeTrack`, `simplifyTrack` (≤ 1000 точек), `checkPlausibility`.
- Фикстуры `__fixtures__/` (реальные FIT/GPX, поток из OW, битые, пустые, без времени, XXE, «миллиард смехов»).

**API — модуль `apps/api/src/modules/tracks`** (есть заготовка: очередь `track-processing`)
- Коллекции `track_uploads`, `activities`, `activity_tracks`, `activity_meta`. Миграция `0010_tracks`.
- `POST /v1/tracks/uploads` (`AuthGuard`, `application/octet-stream`, ≤ 16 MiB) → `202`; `GET /v1/tracks/uploads`,
  `GET /v1/tracks/uploads/:id`, `POST /v1/tracks/uploads/:id/delete`.
- `TrackFileStore` (порт) + адаптер ФС (том `trackfiles` на dev), квота, уборка.
- Worker: разбор в `worker_threads` с лимитами → активность, геометрия, дедуп (±180 с, ±5 %).
- Порт для `devices`: `TrackIngest.ingestProviderStream(...)` (экспорт через `modules/tracks/index.ts`).

**API — модуль `apps/api/src/modules/devices`** (новый)
- Порт `WearablesAggregator` + адаптер `OpenWearablesAggregator` (REST OW 0.9, `X-Open-Wearables-API-Key`);
  выбор — `DEVICES_AGGREGATOR=open_wearables`; фейковый OW (HTTP-стенд) для тестов.
- Коллекции `device_accounts`, `device_connections`, `device_link_tickets`, `device_imports`, `device_audit`.
  Миграция `0011_devices` (новая модель: без токенов провайдеров).
- `GET /v1/devices` (провайдеры = живой `GET /oauth/providers` OW ∩ allowlist `DEVICE_PROVIDERS_ALLOWLIST`);
  `POST /v1/devices/:provider/connect` → URL авторизации OW; `GET /v1/devices/callback` (возврат из OW, без входа) →
  302 в приложение; `POST /v1/devices/:provider/complete` (активация под `AuthGuard` по одноразовому тикету);
  `POST /v1/devices/:provider/sync`; `POST /v1/devices/:provider/disconnect`.
- Синхронизация: pull по расписанию (BullMQ repeatable) + «Синхронизировать сейчас»; вебхук OW
  `POST /v1/devices/webhook` (Svix, проверка подписи) — ускоритель, если `OW_WEBHOOK_SECRET` задан и в OW включены
  исходящие вебхуки. Импорт только велотренировок; трек — `/timeseries` (`latitude`, `longitude`, `elevation`).
- Очереди `devices-sync`, `devices-maintenance`.

**API — `profile`**: `devicesStepCompletedAt`, `PUT /v1/profile/onboarding/devices`,
`OnboardingStatus.devicesStepCompleted`.

**Приложение (`apps/app`)**
- Шаг онбординга `(setup)/devices` после `/location` (Garmin, Wahoo, «Позже»).
- Экран «Устройства» `settings/devices` (статусы, «Подключить» / «Синхронизировать сейчас» / «Отключить»,
  «Загрузить файл», последние загрузки со статусом и «Удалить»); вход — иконка в верхней панели.
- Возврат авторизации `devices/return` (вне гардов, как `auth/verify`) → `complete` → назад к шагу/экрану.
- `features/devices/*`: запросы (`withAccessToken`), поток подключения (`*.native.ts` — `expo-web-browser`
  `openAuthSessionAsync`; `*.web.ts` — переход страницы), выбор и отправка файла (`expo-document-picker`; прогресс),
  опрос статуса загрузки.
- Строки `devices.*`, `tracks.*`.

**Infra / docs**
- `infra/deploy/docker-compose.yml`: том `trackfiles` (api + worker); доступ api/worker к API OW (§8.1 V3);
  `env.template`: `OW_*`, `DEVICES_*` (ключи вписывает владелец), репетиция деплоя; runbook.
- ADR-0011, product, rules, architecture (§10).

# 4. Out of Scope

- **Связь с гонками**: участие, выбор заезда, коридор, результат, напоминание у гонки (модель готова, §5).
- Прямые интеграции с API Garmin/Wahoo (OAuth, вебхуки провайдеров, токены у нас) — заменены агрегатором.
- Strava, Polar, Suunto, Coros и др. (в OW включены, но не в allowlist v1); TCX, KML; FIT-курсы.
- Свой инстанс OW для prod и свои consumer-приложения Garmin/Wahoo — задача prod-readiness (ADR-0011, K1).
- Адаптер ROOK/иного агрегатора — только порт.
- Карта трека и экран деталей заезда, список «Мои заезды» вне «Устройств» — блок профиля.
- Ряды пульса/мощности/каденса — не запрашиваются и не хранятся (R9); wellness-данные — нет.
- Resumable-загрузка (отклонение от `pokatim-app.md`, §8.2), удаление аккаунта (обязанности — в правилах, §10),
  S3-адаптер, видимость провалов в панели «Протокол».
- Изменения в соседнем сервисе и в конфигурации OW, кроме перечисленных в Приложении B (их делает владелец).

# 5. Architecture Context

- **Два контекста.** `tracks` — файлы/потоки заездов, разбор, активности, геометрия; `devices` — пользователи и
  подключения в агрегаторе, авторизация, синхронизация, доставка потока в `tracks`. Зависимости: `devices → tracks`
  (только `modules/tracks/index.ts`: `TrackIngest`), `devices → identity`, `tracks → identity`; `profile` — без
  новых зависимостей. `tracks` не знает об агрегаторе (источник — enum + непрозрачный `sourceRef`, поле `via`).
- **Порт агрегатора** (по образцу `HealthDataProvider` эталона): `WearablesAggregator` — `ensureUser`,
  `createAuthorization`, `listConnections`, `revokeConnection`, `requestHistoricalSync`, `requestSync`,
  `listWorkouts`, `fetchWorkoutTrack`, `verifyWebhook`, `listProviders`, `status`. Доменные типы pokatim (не формат
  OW); адаптер `OpenWearablesAggregator` — единственное место, знающее REST OW. Замена агрегатора — новый адаптер.
- **Токены провайдеров у нас не хранятся** — их держит OW. У pokatim — свой API key OW и секрет вебхука, **только в
  env** (не в БД), и соответствие «пользователь pokatim ↔ пользователь OW».
- **Пространство имён в OW** (общий инстанс на dev): пользователь OW создаётся с `external_user_id =
  "pokatim:<userId>"` (уникален в OW), без ПДн (имя, e-mail не передаются); pokatim не листает чужих пользователей,
  события вебхука по неизвестным `user_id` отбрасывает без записи и лога.
- **Ручная загрузка:** `POST /v1/tracks/uploads` → сигнатура → sha256 → тот же файл уже есть → `200` (идемпотентно) →
  квота → файл (временное имя → `rename`) → транзакция { `track_uploads` (`queued`) + outbox
  `tracks.upload-received` } → `202`; приложение опрашивает статус.
- **Подключение (R4):** `connect` (под входом) → `ensureUser` (лениво, один раз) → тикет (32 байта, в БД — sha256,
  TTL 30 мин) → `createAuthorization(aggUserId, provider, redirect_uri = https://<хост>/v1/devices/callback?t=<тикет>)`
  → в OW-ссылку → провайдер → **callback OW** (обмен кода и токены — в OW) → 303 на наш `redirect_uri` →
  `GET /v1/devices/callback` → 302 на `returnUrl` из тикета (allowlist) с `?provider&result=pending&t=…` → приложение
  `POST …/complete { ticket }` с Bearer → сервер: тикет принадлежит текущему пользователю → `listConnections(aggUserId)`
  подтверждает подключение → `device_connections` `active` → audit → historical sync 30 дней → первая синхронизация.
  Связка в OW возникает уже в callback OW, поэтому защита от привязки чужого аккаунта по ссылке злоумышленника — на
  стороне pokatim: подключение без `complete` владельцем тикета **не активируется и не импортируется**, `complete`
  чужим пользователем — немедленный `revokeConnection` в OW для пользователя-инициатора; уборка отзывает в OW
  подключения, не подтверждённые за TTL (§8.3 п. 1).
- **Синхронизация (pull — основной путь):** repeatable-задача каждые 15 мин (`[ASSUMPTION]`) ставит по задаче на
  активное подключение (jobId `ow-pull:<connectionId>` — без накопления) → `listWorkouts(aggUserId, окно)` (окно —
  от `lastSyncedAt − 1 сут`; первые 48 ч после подключения — все 30 дней: историческая выгрузка приходит в OW
  асинхронно, как в эталоне) → только велотипы (`cycling`, `mountain_biking`, `cyclocross`, `indoor_cycling`,
  `e_biking`, … — allowlist в коде, `[VERIFY]` по 0.9) и провайдер тренировки (вложенный `source.provider`) = провайдер
  подключения → новые (`device_imports`, уникально `(provider, aggWorkoutId)`) → `fetchWorkoutTrack` (`/timeseries`,
  `resolution=raw`, `latitude`/`longitude`/`elevation`, без децимации) → `TrackIngest.ingestProviderStream` (поток
  точек как файл `stream` в `TrackFileStore` → тот же `track-processing`). «Синхронизировать сейчас» —
  `requestSync` в OW (провайдеры в pull-режиме, Wahoo) + немедленный pull (лимит 1/10 мин).
- **Вебхук OW (ускоритель):** `POST /v1/devices/webhook` — подпись Svix (`svix-id`, `svix-timestamp`,
  `svix-signature`, HMAC-SHA256, окно 5 мин, `OW_WEBHOOK_SECRET`) → `user_id` своего подключения → та же pull-задача
  (jobId дедуплицирует). Данные из тела не используются. Без секрета маршрут отвечает `404` (push выключен).
- **Отключение:** транзакция { `disconnecting`, audit, outbox } → worker: `revokeConnection` в OW (OW отзывает у
  провайдера) → `revoked`; провал — `revoked` + `revokeFailed` (подсказка отозвать в Garmin Connect / Wahoo).
  Заезды остаются; галочка «Удалить заезды из Garmin» — удаление загрузок источника. `device_imports` удалённых
  загрузок остаются как «надгробия» (`status: deleted`) — следующий pull их не вернёт.
- **Модель данных:** `track_uploads` (файл/поток и статус) → `activities` (сводка, флаги, точка старта,
  `duplicateOf`) + `activity_tracks` (упрощённая `LineString`, `2dsphere`). Исходник — без изменений в хранилище:
  для ручной загрузки — файл, для агрегатора — поток точек OW в формате `pokatim.stream.v1` (gzip JSON). OW
  подрезает сырые ряды своим data lifecycle — точность для будущих гонок и споров обеспечивает **наша копия**.
- **Биометрия (R9):** пульс и мощность у агрегатора не запрашиваются и не хранятся; `hasHeartRate`/`hasPower` — из
  наличия средних в сводке тренировки OW (без значений) или из FIT; в ответах и логах — ничего.
- **Дедуп (R7):** `(userId, sha256)`, `(provider, aggWorkoutId)` и «тот же заезд с разных источников» (|Δ старта| ≤
  180 с, |Δ длительности| ≤ 5 %) → основная: с мощностью > с пульсом > ручная загрузка > Garmin > Wahoo > раньше
  созданная; вставка — транзакция с первой операцией `lockUserActivities` (`activity_meta`, `$inc version`).
- **Связь с гонками (позже):** участие сошлётся на `activityId`; коридор и правдоподобие — функции
  `packages/tracks` по исходнику; активность неизменяема после `ready`.
- **Время:** UTC в БД; показ — Минск (`contracts/src/time.ts`).
- **Очереди:** `track-processing` (есть), `devices-sync`, `devices-maintenance`, `tracks-maintenance`; события —
  outbox; финальный провал виден пользователю (загрузка `failed` с кодом, подключение `issue: 'sync_failed'`).
- **Контракты** — только добавления; старые сборки шаг «Устройства» не показывают.

# 5.1 Placement & Reuse Gate

- **Переиспользуем:** `AuthGuard`/`CurrentUser`, `withAccessToken`, `MongoTransactions`, `MongoOutboxWriter` +
  `MongoOutboxPublisherModule`, `QueueModule` (5 попыток, экспонента 5 с, `removeOnFail: false`), `RateLimiter`,
  `rateLimitKeyForIp`, `randomToken`/`sha256` (`identity/tokens`), `uuidv7`, `isDuplicateKey`, `CLOCK`/`TestClock`,
  `ZodValidationPipe`, `domainError`, `page-cursor.ts`, `ensureCollection`, `createHarness`; `packages/tracks`
  (`haversineMeters`, `trackLengthMeters`); app — `AsyncContent`/`Skeleton*`, `Button`, `TextAction`,
  `AuthScreen`/`AuthActions`, `DocumentTitle`, `usePullToRefresh`, `focusManager`, `ShellSkeleton`,
  `onboarding-store`.
- **Запрещённые дубли:** разбор FIT/GPX/потока вне `packages/tracks`; вызовы REST OW вне адаптера; прямые вызовы API
  Garmin/Wahoo; хранение API key/секрета вебхука в БД или задачах; второй `AuthGuard`; ручной `fetch` в приложении
  мимо api-client; DTO вне contracts; запись коллекций `tracks` из `devices` (только `TrackIngest`); флаг шага
  онбординга вне `profile`.
- **Новые пакеты:** нет. Зависимости: `@garmin/fitsdk`, `fast-xml-parser` (`packages/tracks`),
  `expo-document-picker` (app). HTTP к OW — встроенный `fetch` (таймаут, лимит байт), без SDK. Кандидаты в базу
  (follow-up): порт агрегатора с адаптером OW (второй потребитель — другие проекты базы), `FileStore`-порт.

# 6. Relevant Files

- API: `apps/api/src/{app.module,worker.module,queues,http-app,main,error-messages,public-read.guard,page-cursor}.ts`,
  `config/env.ts`, `.env.example`, `db/migrations/{0004_profile,0008_calendar,index,migrations.int.test}.ts`,
  `modules/tracks/*` (заготовка), `modules/identity/{index,auth.guard,tokens,identity.events}.ts`,
  `modules/identity/jobs/*` (процессор, расписания), `modules/profile/*`, `test/{harness,identity}.ts`.
- База: `@rkarakulov/api-kit` 0.4.1 — `createFastifyAdapter` (глобальный `bodyLimit` 64 КБ), `QueueModule`,
  `MongoOutboxWriter`, `RateLimiter`.
- Contracts: `packages/contracts/src/{common,index,time}.ts`, `profile/onboarding.schema.ts`; `packages/api-client/src/index.ts`.
- Tracks: `packages/tracks/{package.json,src/geo.ts,src/index.ts}`.
- App: `apps/app/src/app/{_layout.tsx,(setup)/_layout.tsx,(setup)/location.tsx,auth/verify/*}`,
  `features/onboarding/{onboarding-store,queries,device-flags}.ts`, `features/auth/{authorized,read-json}.ts`,
  `lib/{api,query-client}.ts`, `components/{top-bar,shell-skeleton}.tsx`, `app.json`, `package.json`.
- Infra: `infra/deploy/{docker-compose.yml,env.template,bootstrap.sh,deploy.sh,rehearsal.sh}`, `docs/runbooks/deploy.md`.
- Вне репозитория (только чтение, сведения — Приложение A): эталонная интеграция OW соседнего проекта; исходники
  Open Wearables (`backend/app/api/routes/v1/{oauth,connections,users,events,timeseries,sync_data}.py`,
  `schemas/workout_types.py`) — **сверять с тегом развёрнутой версии**, локальная копия старше 0.9.

# 7. Implementation Notes

**Ручная загрузка (`tracks`)** — без изменений относительно первой редакции
- Приём: `application/octet-stream`, свой парсер типа содержимого только для него (`bodyLimit` 16 MiB + запас;
  глобальные 64 КБ остальных маршрутов не меняются); `?name=` — исходное имя (≤ 120 символов, без управляющих
  символов и путей, только для показа). nginx dev уже `client_max_body_size 20m`.
- Формат — по сигнатуре: FIT — размер заголовка 12/14 и `.FIT` в байтах 8–11; GPX — (BOM) `<?xml`… и корневой `<gpx`.
  Иначе `415 TRACK_FORMAT_UNSUPPORTED`; > 16 MiB — `413 TRACK_TOO_LARGE`; 0 байт — `400 INVALID`. Формат `stream`
  через HTTP не принимается (только `TrackIngest`).
- Лимиты: 30 загрузок/ч на пользователя, 60/ч на IP (`[ASSUMPTION]`); ≤ 4 одновременных приёма в процессе API.
- Квота (dev): `TRACK_STORAGE_MAX_BYTES` (2 GiB: сумма `sizeBytes` загрузок с файлом — агрегация, кеш Redis 60 с) и
  свободное место ≥ `TRACK_STORAGE_MIN_FREE_BYTES` (1 GiB, `fs.statfs`) — иначе `503 TRACK_STORAGE_FULL` (загрузка)
  / отложенный повтор (агрегатор).
- Ключ файла — `randomToken()`, путь `<2 символа>/<ключ>.<fit|gpx|stream.json.gz>`; файлы наружу не отдаются.
- Удаление загрузки (своей, иначе 404): транзакция { `track_uploads`, `activities`, `activity_tracks`, перевыбор
  основной в группе под `lockUserActivities` } → затем файл; источник агрегатора — `device_imports.status = 'deleted'`
  через порт обратного уведомления (`TrackIngest` возвращает `sourceRef`; `devices` подписан на outbox
  `tracks.upload-deleted`).

**Разбор (`track-processing`, worker)**
- Захват: `findOneAndUpdate({ _id, status: { $in: ['queued', 'processing'] } }, …)`; финальные статусы — no-op.
- `worker_threads`: `resourceLimits.maxOldGenerationSizeMb = 160`, таймаут 30 с → `timeout`; точек ≤ 200 000;
  параллелизм — 1 (`[ASSUMPTION]`).
- `checkPlausibility`: ≥ 2 точек с координатами (`no_track`), время (`no_timestamps`), начало ≥ 2000-01-01 и ≤
  `now + 24 ч`, длительность ≤ 48 ч, невалидные координаты отбрасываются → `implausible`, если осталось < 50 %.
- Спорт: FIT — `session.sport`/`sub_sport`; GPX — `<type>`, иначе `unknown`; поток — тип тренировки OW (до импорта
  уже отфильтрован). Ручная загрузка принимается любая (`sport` как распознан).
- Результат — транзакция: `lockUserActivities` → кандидаты дубля (`startedAt ± 180 с`) → вставка `activities` +
  `activity_tracks` (линия ≥ 2 различных точек) → `duplicateOf` группы → загрузка `ready`/`duplicate`.

**Агрегатор (`devices`)**
- `device_accounts`: `{ _id: userId, aggUserId, createdAt }` — создание лениво в `connect`: Redis-замок
  `devices:account:<userId>` → `POST /api/v1/users { external_user_id: "pokatim:<userId>" }` (ни имени, ни e-mail) →
  `insertOne`; конфликт уникальности в OW (повтор после сбоя) → поиск по `external_user_id` (`GET /users?…`,
  `[VERIFY]` фильтр в 0.9) → сохранить.
- Провайдеры экрана: `listProviders()` (`GET /api/v1/oauth/providers`: `provider`, `name`, `is_enabled`,
  `live_sync_mode`) ∩ `DEVICE_PROVIDERS_ALLOWLIST` (`garmin,wahoo`), кеш Redis 5 мин; OW недоступен → провайдеры
  `available: false` (экран показывает «Подключение временно недоступно», ручная загрузка работает).
- `device_connections`: `{ _id, userId, aggUserId, provider, status: 'pending' | 'active' | 'disconnecting' |
  'revoked', issue, ticketExpiresAt, connectedAt, lastSyncedAt, catchUpUntil, revokedAt, revokedReason,
  revokeFailed, version }`; частичный уникальный `(userId, provider)` для `pending|active|disconnecting`. Повторный
  `connect` при `active` с `issue: 'reauthorize'` — разрешён (тот же документ → `pending`).
- `connect` (`{ returnUrl }`, лимит 10/ч): провайдер вне allowlist или выключен в OW → `409
  DEVICE_PROVIDER_UNAVAILABLE`; `returnUrl` — точный префикс из `DEVICE_RETURN_URLS` (`https://<хост>/devices/return`,
  `pokatim://devices/return`, `exp://` — только вне production), иначе `400`; тикет → `device_link_tickets`
  `{ _id: sha256(t), userId, provider, connectionId, returnUrl, expiresAt }` (TTL) → `createAuthorization` →
  `{ authorizeUrl }` (проверка: `https`; хост — из ответа OW, не из клиента).
- `GET /v1/devices/callback?t=` (без входа): тикет существует и не истёк → 302 на его `returnUrl` с
  `?provider=<p>&result=pending&t=<t>`; иначе — 302 на web-ссылку по умолчанию с `result=error`. Ничего не меняет
  (идемпотентен, повторный заход — тот же редирект до истечения); `Referrer-Policy: no-referrer`, `no-store`; тикет
  в логи не пишется. **OW при ошибке провайдера уводит на свою страницу ошибки, а не на наш `redirect_uri`**
  (`[VERIFY]` в 0.9): приложение по закрытию браузера без результата обновляет «Устройства», подключение остаётся
  `pending` до уборки.
- `complete` (`{ ticket }`, под входом): `findOneAndDelete({ _id: sha256(t), expiresAt > now })` → `userId` тикета ≠
  текущий → outbox `devices.revoke-requested` для подключения инициатора, ответ `DEVICE_LINK_INVALID` →
  `listConnections(aggUserId)` содержит провайдер в статусе `active` → транзакция { `active`, `connectedAt`,
  `catchUpUntil = now + 48 ч`, audit `connected`, outbox `devices.connected` } → `200 DeviceList`; нет подключения в
  OW → `DEVICE_LINK_INVALID` (`pending` остаётся до уборки).
- `devices.connected` → `requestHistoricalSync(provider, days = 30)` (`POST /providers/{p}/users/{uid}/sync/historical`,
  если провайдер поддерживает; ошибка — лог и продолжение) + немедленный pull.
- Уборка (`devices-maintenance`, каждые 10 мин): `pending` с истёкшим тикетом → `revokeConnection` в OW (если OW
  показывает подключение) → `revoked` (`revokedReason: 'unconfirmed'`); ежедневная сверка `active` ↔
  `listConnections` → в OW нет/истёк → `issue: 'reauthorize'`.
- `sync` (лимит 1/10 мин на подключение): `requestSync` в OW (`POST /providers/{p}/users/{uid}/sync`, `[VERIFY]` путь
  0.9) + pull-задача с задержкой 30 с и ещё одна через 3 мин (OW тянет у провайдера асинхронно).
- `disconnect` (`{ deleteActivities }`): транзакция { `disconnecting`, audit, outbox `devices.revoke-requested` } →
  worker `revokeConnection` (`DELETE /users/{uid}/connections/{p}`, 404 = успех) → `revoked`; финальный провал —
  `revoked` + `revokeFailed`. `deleteActivities` — удаление загрузок `source = provider` пользователя.
- Пользователь OW при отключении всех провайдеров **не удаляется** (`DELETE /users` в OW требует прав разработчика,
  не API key) — остаётся пустым; удаление — с будущим удалением аккаунта (владелец/скрипт) — §10.

**Pull и импорт**
- `listWorkouts`: `GET /api/v1/users/{uid}/events/workouts?start_date&end_date` (даты обязательны, курсор),
  ≤ 50 страниц; поля: `id`, `type`, `start_time`, `end_time`, `duration`, `source.provider`, средние пульса/мощности
  (только факт наличия), `distance`.
- Фильтр: велотип (allowlist), провайдер ∈ подключённые, длительность ≤ 48 ч; не-вело — не импортируются вовсе (нет
  записи `device_imports`).
- `fetchWorkoutTrack`: `GET /api/v1/users/{uid}/timeseries?types=latitude,longitude,elevation&start_time&end_time&
  resolution=raw&limit=1000` (курсор) — ≤ 300 000 сэмплов (иначе `too_many_points`), выравнивание широты и долготы по
  одинаковой метке времени (как в эталоне), **без децимации**; нет координат (indoor) — `skipped: 'no_track'` без
  файла.
- `device_imports`: `{ _id, userId, provider, aggWorkoutId, status: 'queued' | 'imported' | 'skipped' | 'failed' |
  'deleted', reason, uploadId, firstSeenAt, updatedAt }`, уникально `(provider, aggWorkoutId)` (`aggWorkoutId` — UUID OW,
  уникален в инстансе). Повторная попытка `failed` — на следующем pull до 5 раз, затем `issue: 'sync_failed'`.

**Задачи (BullMQ) и идемпотентность**

| Очередь / задача | Ключ (jobId) | Защита от дубля | Финальный провал |
|---|---|---|---|
| `track-processing` / `parse` | id события outbox | захват по статусу загрузки | `failed: <код>` |
| `devices-sync` / `pull` | `ow-pull:<connectionId>` (повтор пока ждёт — не ставится) | `device_imports` уникален; `TrackIngest` — `(source, sourceRef)` | `issue: 'sync_failed'` |
| `devices-sync` / `historical` | `ow-hist:<connectionId>` | один раз на подключение | лог; история — ручной загрузкой |
| `devices-sync` / `revoke` | id события outbox | статус `disconnecting` → `revoked` | `revoked` + `revokeFailed` |
| `devices-maintenance` / `schedule-pull` (каждые 15 мин) | имя расписания | ставит `pull` активным | — |
| `devices-maintenance` / `cleanup-pending`, `reconcile` | имя расписания | по статусам | лог счётчиков |
| `tracks-maintenance` / `cleanup` (ежечасно) | имя расписания | отбракованные файлы > 7 дней, файлы без документа > 1 ч | лог счётчиков |

- 429/5xx OW → повтор с экспонентой; 401/403 OW (ключ) → без повторов, `status()` в `GET /v1/health`
  не включается (OW — внешняя зависимость, не здоровье API), лог `ow.auth_failed`.
- Бюджет запросов к общему OW: pull — не чаще 1 раза в 15 мин на подключение, ≤ 5 параллельных задач (`[ASSUMPTION]`).

**Приложение**
- Онбординг: `OnboardingStep` + `'devices'` по `OnboardingStatus.devicesStepCompleted` (сервер, аккаунт); кеш
  «пройдено» рядом с кешем опроса (тот же владелец, стирается при выходе); поля нет (старый API) — шаг пропускается.
  Экран: провайдеры из `GET /v1/devices` (`available`), «Позже»; после подключения — «Garmin подключён» и
  «Продолжить». Любой исход → `PUT /v1/profile/onboarding/devices` → Главная. Если `GET /v1/devices` недоступен —
  только «Позже» и «Загрузить заезды файлом можно в разделе «Устройства»».
- Подключение: native — `openAuthSessionAsync(authorizeUrl, returnUrl)` → `success` → `t` из URL → `completeDevice`;
  `dismiss`/`cancel` → обновить список; web — `location.assign(authorizeUrl)`, возврат на `/devices/return?…` →
  `completeDevice` → назад (`origin` в `sessionStorage` вкладки). `result=error` — «Не удалось подключить. Повторите.»
- «Устройства»: строки провайдеров (статус, «Синхронизировано …», `issue` с действием), «Синхронизировать сейчас»,
  «Отключить» (подтверждение с галочкой «Удалить заезды из Garmin»), «Загрузить файл» (`.fit`, `.gpx`,
  `precheckTrackFile`, прогресс, «Отменить»), последние 20 загрузок (имя/источник, дата старта по Минску, км,
  статус, причина `failed`, «Удалить»). Скелетон, ошибки §4.12, pull-to-refresh, опрос статуса только при
  незавершённых загрузках (3 с).
- Строки (`[ASSUMPTION]`): «Подключите устройство»; лид «Заезды с часов и велокомпьютера будут появляться в
  «Покатим» сами. Можно подключить позже в разделе «Устройства».»; «Позже»; «Подключено», «Не подключено», «Нужно
  подключить снова», «Отключаем…», «Ожидаем подтверждения»; «Новые заезды подтягиваются каждые 15 минут»;
  загрузка — «Загрузить файл», «FIT или GPX, до 16 МБ», «Обрабатываем…», «Готово», «Такой заезд уже есть»,
  «Не удалось прочитать файл», «В файле нет трека», «В файле нет времени».

# 8. Risks / Assumptions / Open Questions

- **Общий инстанс OW на dev** (§8.1 K1): API key OW не ограничен пользователями — ключ соседнего сервиса видит
  данные пользователей pokatim в OW и наоборот; один consumer Garmin (и Wahoo) у обоих проектов; глобальные
  настройки OW (исходящие вебхуки, data lifecycle, провайдеры) общие. Принимается для dev с тестерами; prod — свой OW.
- **Один аккаунт Garmin — один проект** (ограничение consumer): подключение того же аккаунта Garmin в pokatim может
  отвязать его в соседнем сервисе (и наоборот), отключение в одном — отзывает регистрацию у Garmin для обоих.
  Компенсация: тестеры — с аккаунтами, не подключёнными к соседнему сервису (runbook, подсказка нет — в UI это не
  выяснить); prod — свой consumer.
- **Привязка в OW до подтверждения** (OW завершает OAuth сам): компенсация — `pending` не импортируется, чужой
  `complete` и истёкший тикет → отзыв в OW (§7).
- **Версия OW `latest` на сервере** — API может смениться без нас; ADR требует пин тега (Приложение B).
  Контрактный тест адаптера против фейкового OW + ручной смоук на dev после каждого обновления OW.
- **Подрезка рядов OW (data lifecycle)**: при простое pokatim дольше окна ретеншена трек тренировки может пропасть
  в OW — импорт `no_track`; компенсация — ручная загрузка файла.
- **Точность потока OW** (`resolution=raw` — как отдаёт провайдер; Wahoo/Garmin могут прореживать): для будущего
  коридора возможна меньшая точность, чем у FIT — `[VERIFY]` на первых заездах (сравнить с FIT того же заезда).
- **Диск dev** (6 ГБ свободно, сервер общий): квота 2 GiB + проверка свободного места + уборка; prod — S3.
- **Память worker** 384m — разбор в потоке ≤ 160 МБ, параллелизм 1; при нехватке — 512m (владелец, V6).
- **`@garmin/fitsdk`** — лицензия Garmin FIT Protocol (бесплатная, неисключительная) — V5.
- `[ASSUMPTION]` лимиты, интервалы pull, окна, тексты, сроки уборки, квота; `[VERIFY]` — пути и поля OW 0.9
  (Приложение A).

# 8.1 Requirements Consistency

Architecture Review — tracks-devices (редакция 2: провайдеры через Open Wearables). **Status: CONCERNS** — блокеров
для ручной загрузки (S1–S4) и для провайдерских слайсов на фейковом OW нет; **живая проверка Garmin/Wahoo ждёт
владельца** (API key OW, сетевой доступ к OW, пин версии — Приложение B). Решения автора по Q2–Q11 приняты.

**Конфликты с каноном (сняты решениями автора)**
- **C1. Рамки MVP** (`AGENTS.md` §1, `pokatim-app.md`: нет Garmin API без ADR) — ADR-0011 одобрен, правка §1
  одобрена; новый внешний сервис (OW) — тем же ADR.
- **C2. Хранение файлов в S3** — порт `TrackFileStore`, том на dev, S3 до прода (R8).
- **C3. Resumable-загрузка** — v1 без неё (решение автора, Q8), оговорка в правиле.
- **C4. TCX** — нет (решение автора).
- **C5. Биометрия** — ряды не запрашиваются и не хранятся (R9).

**K1. Общий Open Wearables на dev**

Факты (исходники OW и эталон): API key OW — **глобальный** (проверяется только существование ключа, без привязки к
пользователям); OAuth провайдеров завершает OW (redirect URI у провайдеров указывают на callback OW), после чего OW
делает 303 на `redirect_uri`, переданный при `authorize` (в проверенной версии — без allowlist, `[VERIFY]` 0.9);
`external_user_id` пользователя OW уникален; удаление пользователя OW — только с правами разработчика; consumer
Garmin/Wahoo — один на инстанс OW.

| Тема | dev (общий OW с соседним сервисом) | prod |
|---|---|---|
| Инстанс | общий, свой API key pokatim, пользователи `pokatim:<userId>` | свой OW (пин версии), отдельный стек/сервер |
| Consumer Garmin/Wahoo | общий: один аккаунт Garmin — в одном проекте; отключение отзывает регистрацию для обоих; экран согласия — с названием приложения соседнего сервиса | свои приложения «Покатим» (Garmin — заявка в Connect Developer Program; Wahoo — sandbox → review) |
| Изоляция данных | нет (глобальный ключ): принимается для тестеров | свой инстанс — полная |
| Вебхуки OW | включение исходящих вебхуков — настройка всего инстанса; эндпоинт pokatim получит события и по чужим пользователям → отбрасываются без записи | включены, свой эндпоинт |
| Без вебхуков | pull каждые 15 мин + «Синхронизировать сейчас» — полностью рабочий вариант | так же как резерв |

**Рекомендация (R1):** dev — общий OW с режимом pull по умолчанию (не требует менять глобальные настройки OW и
согласия соседнего сервиса), вебхук — опционально, когда владелец включит исходящие вебхуки и зарегистрирует
эндпоинт pokatim; prod — свой OW со своими consumer, проверка на старте: `OW_SHARED_INSTANCE=true` при
`NODE_ENV=production` — отказ запуска.

**Решения архитектора**
- **R2. Формат по содержимому**; расширение — только pre-check приложения.
- **R3. Сырой поток `application/octet-stream`** вместо multipart (один файл, простой лимит).
- **R4. Активация под входом по тикету из `redirect_uri`**: тикет не возвращается инициатору (`connect` отдаёт только
  ссылку OW), приходит в браузер того, кто прошёл авторизацию у провайдера; активирует — только владелец тикета.
  Альтернативы: завершать в callback без входа (уязвимо к привязке чужого аккаунта — OW уже связал), cookie-привязка
  (не работает единообразно в native auth session и web).
- **R5. Pull — основной путь, вебхук — сигнал** (Svix-подпись, данные из тела не используются).
- **R6. Порт агрегатора** с доменными типами; адаптер OW — единственный знает REST; фейковый OW — HTTP-стенд в тестах.
- **R7. Дедуп** на активностях под `lockUserActivities` — с отрицательным доказательством.
- **R8. `TrackFileStore`** — порт + ФС (dev, тесты); S3 — prod-readiness.
- **R9. Без биометрии**: у OW запрашиваются только `latitude`, `longitude`, `elevation`; флаги датчиков — из наличия
  средних в сводке. Если слайсу споров понадобятся пульс/мощность — запрашивать тогда (OW к тому времени ряды может
  подрезать — принято автором).
- **R10. Исходник агрегатора = наш поток `pokatim.stream.v1`** (gzip JSON `{ v: 1, provider, aggWorkoutId, points:
  [[t, lat, lon, ele?]] }`) в `TrackFileStore` и тот же `track-processing`: одна цепочка проверок, точность не
  зависит от ретеншена OW.
- **R11. Номера**: миграции `0010_tracks`, `0011_devices` (app-03 берёт `0009` — согласовать до слияния), ADR-0011.
- **R12. Флаг шага онбординга — на сервере** (`profiles.devicesStepCompletedAt`).
- **R13. Секреты OW только в env** (`OW_API_KEY`, `OW_WEBHOOK_SECRET`), не в БД — шифрование секретов в БД не нужно.

**Конфликтов с инвариантами §4 после ADR-0011 нет:** §4.1 — сервер считает всё из исходника; §4.2 — contracts
первыми; §4.3 — `devices → tracks` через `index.ts`; §4.4 — пакетов нет; §4.5 — pull, импорт, отзыв, разбор —
worker, события — outbox; §4.6 — expand-only; §4.7 — UTC; §4.8 — ключи только env; §4.9 — ADR; §4.10 —
`device_audit` append-only; §4.11–§4.13 — UI из системы, скелетоны, все платформы (развилки — файлами).

### Ответы автора (2026-10-26)

| # | Вопрос | Решение |
|---|---|---|
| Q1 | Как подключать Garmin/Wahoo | Через Open Wearables (порт агрегатора); dev — общий OW, prod — свой |
| Q2 | Какие тренировки импортировать | Только велосипед (indoor без трека → `skipped`) |
| Q3 | TCX | Нет |
| Q4 | История при подключении | 30 дней через historical sync OW, если провайдер поддерживает |
| Q5 | Отключение и заезды | Заезды остаются; удаление — галочкой |
| Q6 | Аккаунт провайдера уже связан с другим профилем | В OW связь — на пользователя OW: у pokatim два профиля = два пользователя OW; поведение consumer (вытеснение регистрации) — риск §8, отдельной логики нет |
| Q7 | Шаг онбординга существующим | Да, один раз |
| Q8 | Resumable | Нет в v1 |
| Q9 | Вход в «Устройства» | Иконка в верхней панели |
| Q10 | Хранение исходников | Пока есть активность; отбракованные — 7 дней; dev — квота 2 GiB |
| Q11 | Лимит файла | 16 МБ |

### Новые вопросы (по умолчанию — рекомендация)

| # | Вопрос | Рекомендация | Альтернативы |
|---|---|---|---|
| N1 | Push через вебхуки OW на dev | Pull по умолчанию; вебхук — когда владелец включит исходящие вебхуки OW (настройка всего инстанса) | Сразу push (нужно согласие соседнего сервиса) |
| N2 | Интервал pull | 15 мин | 5 мин (нагрузка на общий OW) / 60 мин |
| N3 | Доступ pokatim к API OW на сервере | Общая docker-сеть со стеком OW (внутренний адрес, без публичного пути) | Публичный HTTPS-путь OW через vhost соседнего сервиса (зависимость от чужого vhost) |

### Вопросы владельцу

| # | Вопрос |
|---|---|
| V1 | API key OW для pokatim (dev-портал OW) — создать и вписать в `~/pokatim/.env` (`OW_API_KEY`) |
| V2 | Сеть: подключить api/worker pokatim к docker-сети стека OW (N3) или дать адрес API OW, доступный из контейнеров |
| V3 | Принимает ли OW 0.9 произвольный `redirect_uri` в `authorize`; если есть allowlist — добавить `https://pokatim-dev.limedolphin.com/v1/devices/callback` |
| V4 | Пин версии OW (тег вместо `latest`) и уведомление pokatim об обновлениях OW |
| V5 | Лицензия Garmin FIT SDK для проекта приемлема |
| V6 | Память worker 512m и том `trackfiles` до 2 GiB на общем сервере |
| V7 | (если N1 = push) включить исходящие вебхуки OW и зарегистрировать эндпоинт `https://pokatim-dev.limedolphin.com/v1/devices/webhook`; секрет `whsec_…` — в `.env` (`OW_WEBHOOK_SECRET`) |
| V8 | Prod: свой инстанс OW и заявки на свои приложения Garmin/Wahoo — кто и когда |

# 8.2 Deviations from spec

_Ответы автора и отклонения при реализации — дописываются ниже._

- Редакция 2 (2026-10-26, решение автора): прямые OAuth/вебхуки Garmin и Wahoo, relay nginx, режим общего consumer
  и шифрование токенов провайдеров **удалены** — провайдеры через Open Wearables.
- Загрузка без resumable/очереди (C3, Q8) — правило `pokatim-app.md` дополняется оговоркой «v1».
- Решения автора по новым вопросам (2026-10-26, рекомендации архитектора): **N1** — на dev pull; вебхук Svix
  реализуется, без `OW_WEBHOOK_SECRET` отвечает `404`; **N2** — pull каждые 15 мин; **N3** — доступ api/worker к OW
  через общую docker-сеть `OW_DOCKER_NETWORK` (external network в compose, имя из `.env`, по умолчанию не
  подключается); конфигурацию сервера агент не меняет — инструкция в runbook и Приложении B.
- Живая проверка Garmin/Wahoo — только на фейковом OW; `DEVICES_ENABLED=false` по умолчанию.
- Эталон поведения провайдерской части — интеграция OW соседнего проекта (порт, адаптер, синхронизация; только
  чтение). Расхождения spec ↔ эталон фиксируются в §12.

# 8.3 Security checklist

Затронуты: аутентификация (OAuth через агрегатор, `AuthGuard`), **загрузка и разбор файлов**, **публичные
эндпоинты** (callback, вебхук), **внешние вызовы** (API OW), **секреты** (API key OW, секрет вебхука),
**персональные данные** (геотрек), инфраструктура (`infra/**`, env), зависимости — `security.md`,
`pokatim-security.md` (дополнить `paths:` `modules/tracks/**`, `modules/devices/**`, `apps/app/src/features/devices/**`,
`packages/tracks/src/parse*`).

1. **AuthN/AuthZ.**
   - Все эндпоинты `tracks`/`devices`, кроме `GET /v1/devices/callback` и `POST /v1/devices/webhook`, — `AuthGuard`;
     пользователь — только `@CurrentUser()`; чужая загрузка/подключение — `404`, фильтр `userId` ставит сервер.
   - `callback` без входа ничего не меняет (только редирект на `returnUrl` тикета); активирует подключение только
     `complete` владельца тикета; тикет одноразовый (`findOneAndDelete`), TTL 30 мин, в БД — sha256.
   - Привязка чужого аккаунта провайдера по ссылке злоумышленника: тикет попадает в браузер жертвы, её `complete` ≠
     инициатор → `DEVICE_LINK_INVALID` + отзыв подключения в OW; инициатор тикета не знает (`connect` возвращает
     только ссылку OW); неподтверждённое — не импортируется и отзывается уборкой.
   - `returnUrl` — только allowlist `DEVICE_RETURN_URLS`, хранится в тикете; редирект — только туда (нет open
     redirect); `exp://` — только вне production. `authorizeUrl` — `https`, из ответа OW.
   - Импорт — только для `active` подключений и пользователя OW из `device_accounts`; `user_id` вебхука вне маппинга —
     отбрасывается.
   - Вебхук: подпись Svix (HMAC-SHA256 по `id.timestamp.body`, `timingSafeEqual`, окно 5 мин, несколько подписей в
     заголовке); без секрета в env — `404`; неверная подпись — `401` без лога тела.
2. **Входные данные.**
   - Загрузка ≤ 16 MiB, 0 байт — 400, формат по сигнатуре, имя — длина, без управляющих символов и разделителей пути.
   - Разбор — worker, `worker_threads` с лимитами памяти/времени и точек; FIT — CRC (`checkIntegrity`); GPX — отказ при
     `<!DOCTYPE`/`<!ENTITY` до разбора, `processEntities: false`; поток OW — zod-схема `pokatim.stream.v1`, координаты в
     диапазоне, время монотонно.
   - Ответы OW — zod (строгие типы нужных полей, лишние игнорируются), длины массивов и страниц ограничены, тело ≤ 5 МБ
     на ответ; тело вебхука ≤ 256 КБ.
   - Запросы — `z.strictObject`; `:provider` — enum; `:id` — `Uuid`; курсор — `page-cursor.ts`; инъекции `{ "$ne": … }`
     — 400.
3. **Данные наружу.**
   - Ответы — свои загрузки и подключения: без `aggUserId`, `aggWorkoutId`, `storageKey`, sha256, тикетов, координат
     (v1), биометрии; `no-store`; `callback` и `/devices/return` — `Referrer-Policy: no-referrer`.
   - В OW уходят только `external_user_id = pokatim:<uuid>` — без имени, e-mail, телефона.
   - Ошибки нейтральны: чужой/истёкший/повторный тикет — один `DEVICE_LINK_INVALID`.
4. **Злоупотребления.**
   - `RateLimiter`: загрузки (30/ч пользователь, 60/ч IP), `connect` (10/ч), `sync` (1/10 мин), вебхук (600/мин IP);
     квота хранилища и свободного места; семафор приёмов; бюджет pull к OW (≤ 5 параллельно, 1 раз в 15 мин на
     подключение).
   - Исходящие запросы — только к `OW_API_URL` (без редиректов, таймаут 15 с, лимит байт); адрес из env, не из данных.
   - Повторы — уникальности `(userId, sha256)`, `(source, sourceRef)`, `(provider, aggWorkoutId)`, jobId pull.
5. **Секреты и логи.**
   - `OW_API_KEY`, `OW_WEBHOOK_SECRET` — только env сервера (вписывает владелец; в git, GitHub, task.md, чаты не
     попадают); в БД не хранятся. Проверка env: `DEVICES_ENABLED=true` без `OW_API_URL`/`OW_API_KEY` — отказ запуска;
     `OW_SHARED_INSTANCE=true` в production — отказ запуска.
   - Логи: id подключения/загрузки/импорта, провайдер, HTTP-статус OW; **без** API key (заголовок не логируется),
     тикетов, `authorizeUrl`, тел вебхуков и ответов OW, `aggUserId` чужих пользователей, координат, имён файлов, e-mail.
   - Зависимости: `@garmin/fitsdk`, `fast-xml-parser`, `expo-document-picker` — точные версии с
     `minimumReleaseAge`, лицензии в pr.md.
6. **Аудит.** `device_audit` (append-only, только `insertOne`, тест-сторож): `connected`, `disconnected` (пользователь /
   уборка неподтверждённого / чужой тикет), `revoke_failed`, `reauthorize_required` — `{ userId, provider,
   connectionId, action, reason, at }`, без `aggUserId`.

# 9. Acceptance Criteria

1. **Загрузка FIT/GPX:** реальные FIT (Garmin Edge, Wahoo Elemnt, часы) и GPX → `202 queued` → `ready`; активность
   (время, дистанция ±1 % от эталона фикстуры, спорт), линия ≤ 1000 точек в `2dsphere`; файл байт-в-байт.
2. **Отказы загрузки:** PNG с расширением `.fit` → `415`; 17 MiB → `413`; 0 байт → 400; битый CRC → `unreadable`;
   без координат → `no_track`; без времени → `no_timestamps`; XXE/«миллиард смехов» → `unreadable` без сети и роста
   памяти; долгий разбор → `timeout`; без входа → 401; чужая загрузка → 404.
3. **Идемпотентность и дедуп:** тот же файл дважды → один документ (`200`); повтор задачи после `ready` — no-op; один
   заезд файлом и из агрегатора → одна основная (с мощностью), другая `duplicate`; две параллельные вставки
   одного заезда (ворота на `lockUserActivities`) → одна основная (**отрицательное доказательство**: без замка — две).
4. **Квота и уборка:** исчерпание → `503 TRACK_STORAGE_FULL`, файл не записан; уборка — отбракованные > 7 дней и
   файлы без документа > 1 ч.
5. **Удаление загрузки:** загрузка, активность, геометрия, файл удалены; основной в группе — следующий по приоритету;
   импорт агрегатора → `device_imports.deleted`, следующий pull его не возвращает.
6. **Провайдеры:** `GET /v1/devices` — `garmin`, `wahoo` из живого списка OW ∩ allowlist (Strava из OW — не
   показан); OW недоступен → `available: false`, ответ 200.
7. **Подключение (фейковый OW):** `connect` → пользователь OW создан с `external_user_id = pokatim:<id>` (без ПДн) и
   ровно один на пользователя (два параллельных `connect` → один пользователь OW); `authorizeUrl` из OW;
   `callback?t=` → 302 на `returnUrl` с `result=pending&t`; `complete` владельцем при подключении в OW → `active`,
   audit, historical sync 30 дней, pull; `complete` другим пользователем → `DEVICE_LINK_INVALID` + отзыв в OW, импорта
   нет; повтор тикета → `DEVICE_LINK_INVALID`; `returnUrl` вне allowlist → 400; неподтверждённое за TTL → отозвано в OW.
8. **Pull и импорт:** тренировки `cycling`/`mountain_biking` → импорт с треком из `/timeseries` (все точки, без
   децимации), `source = provider` тренировки; `running` — без записи; indoor без координат → `skipped: no_track`;
   повторный pull — без дублей; первые 48 ч — окно 30 дней, затем — от `lastSyncedAt − 1 сут`; 429/5xx OW → повтор;
   5 провалов импорта → `issue: 'sync_failed'`; `sync` чаще 1/10 мин → 429.
9. **Вебхук:** без `OW_WEBHOOK_SECRET` → 404; неверная подпись/старая метка → 401, без записи; верная подпись,
   свой пользователь → pull поставлен (jobId не дублируется); чужой `user_id` → 200 без записи.
10. **Отключение:** `disconnecting` → `revokeConnection` в OW → `revoked`, audit; провал → `revoked` + `revokeFailed`;
    `deleteActivities: true` → загрузки провайдера удалены; заезды без галочки остаются.
11. **Онбординг:** новый аккаунт: опрос → геопозиция → «Подключите устройство» → «Позже» → Главная; флаг на сервере;
    другое устройство шаг не показывает; старый API без поля — шаг пропущен; подключение из шага → возврат →
    «Garmin подключён» → «Продолжить» (native и web).
12. **«Устройства»:** скелетон, ошибки §4.12; статусы и `issue` с действием; «Синхронизировать сейчас»; загрузка с
    pre-check, прогрессом, отменой, опросом статуса; «Удалить»; «Отключить» с галочкой; iOS, Android, web.
13. **Безопасность ответов и логов:** ни один ответ не содержит `aggUserId`, `aggWorkoutId`, `storageKey`, sha256,
    тикетов, координат, биометрии; `no-store`; перехваченный логгер не содержит маркер API key, тикета, тела вебхука.
14. **Миграции** `0010`, `0011` на чистой БД и повторно; индексы (уникальные, частичные, TTL, `2dsphere`).
15. **Gate:** `pnpm check` зелёный; e2e web: онбординг «Позже» → Главная; загрузка GPX на «Устройствах» → «Готово».
16. **Деплой:** `deploy-rehearsal` зелёный с томом и новыми ключами `.env`; `DEVICES_ENABLED=false` по умолчанию —
    стенд стартует без ключей OW, ручная загрузка работает.

# 10. Documentation Impact

- **ADR-0011** (одобрен автором) «Треки и устройства: импорт велозаездов Garmin/Wahoo через self-hosted агрегатор
  Open Wearables (порт `WearablesAggregator`, адаптер OW, версия пинуется; ROOK — будущий адаптер), ручная загрузка
  FIT/GPX, разбор в worker (`@garmin/fitsdk`, `fast-xml-parser`), исходник — файл или наш поток точек, хранилище (порт;
  том на dev, S3 до прода), активация подключения под входом по тикету, pull + Svix-вебхук, без биометрии; общий OW на
  dev, свой — в prod» + строка в `docs/adr/README.md`.
- `AGENTS.md` §1 — «нет … Strava API; Garmin и Wahoo — только импорт заездов через агрегатор (ADR-0011)» (одобрено).
- `docs/product/tracks-and-devices.md` (новый): источники заездов, шаг онбординга, экран «Устройства», дубли,
  ошибки, ответы Q1–Q11 + строка в `docs/product/README.md`; `docs/product/onboarding.md` — порядок «… → геопозиция →
  устройства → Главная».
- `docs/architecture/README.md` — модули `tracks`, `devices`, агрегатор, поток загрузки, pull и вебхука, очереди.
- `.claude/rules/pokatim-backend.md` — контексты `tracks`, `devices`; REST агрегатора — только адаптер; pull-основной
  путь, вебхук — сигнал; импорт только `active`.
- `.claude/rules/pokatim-db.md` — коллекции, `lockUserActivities`, уникальности, надгробия `device_imports`,
  биометрия не хранится, `device_audit` append-only; обязанности удаления аккаунта: отозвать подключения в OW,
  удалить `device_*`, загрузки, файлы, активности; пользователь OW — удаление владельцем (права разработчика OW).
- `.claude/rules/pokatim-security.md` — `paths:`; активация по тикету, allowlist `returnUrl`, Svix, ключи OW только env.
- `.claude/rules/pokatim-app.md` — рамки MVP (ADR-0011), шаг `(setup)/devices`, «Устройства», загрузка v1 без resumable.
- `.claude/rules/pokatim-contracts.md` — `src/tracks`, `src/devices`, tolerant-enum статусов/проблем.
- `docs/runbooks/deploy.md` — том `trackfiles`, ключи `OW_*`/`DEVICES_*`, сеть к OW, включение, проверка (`GET
  /v1/devices`), переход на свой OW; `docs/runbooks/local-dev.md` — локально `DEVICES_ENABLED=false`, фейковый OW.

# 11. Implementation Context

Уровень — task3. Ветка — `feature/tracks-devices` от `develop`. **Ручная загрузка (S1–S4) — первой** (кодер уже её
ведёт: §§ ручной загрузки в этой редакции не менялись, кроме добавления формата `stream` в конец `TRACK_FORMATS` и
`TrackIngest.ingestProviderStream` вместо `ingestProviderFile`). Провайдерские слайсы (S5–S8) — заново под OW, на
фейковом OW; живая проверка — после Приложения B (иначе NOT VERIFIED).

### ENTRY POINTS
- API: `modules/tracks/{track-uploads.controller,track-processing.processor}.ts`,
  `modules/devices/{devices.controller,devices-callback.controller,devices-webhook.controller,devices-sync.processor,
  devices-maintenance.processor}.ts`, `modules/profile/onboarding.controller.ts`.
- App: `apps/app/src/app/{(setup)/devices.tsx,settings/devices.tsx,devices/return.tsx}`, `features/devices/*`.

### Слайсы и проверка после каждого
| # | Что | Проверка |
|---|---|---|
| **S0** | ADR-0011 (Accepted), правка `AGENTS.md` §1, черновик `docs/product/tracks-and-devices.md`; Приложение B — владельцу | ревью |
| **S1** | Contracts треков (`src/tracks/*`, коды `TRACK_*`) + api-client загрузок; **отдельным коммитом** — contracts устройств и онбординга (`src/devices/*`, `devicesStepCompleted`, коды `DEVICE_*`) + api-client | TDD; `pnpm --filter @pokatim/contracts test`, `--filter @pokatim/api-client test`, `pnpm typecheck` |
| **S2** (параллельно S1) | `packages/tracks`: формат, pre-check, `parseFit`, `parseGpx`, `parseStream`, точки, сводка, упрощение, правдоподобие; фикстуры | unit на фикстурах, XXE — отказ без сети |
| **S3** (после S1) | tracks данные: коллекции, `0010_tracks`, `TracksRepository` (`lockUserActivities`, дедуп), `TrackFileStore` + ФС, квота, env | int миграции (`2dsphere`), unit дедупа |
| **S4** (после S2, S3) | Загрузка: парсер octet-stream, контроллер, сервис, `track-processing` (`worker_threads`), список, удаление, уборка, `TrackIngest.ingestProviderStream` | int AC1–AC5, гонка дедупа с **отрицательным доказательством**; `pnpm check` |
| **S5** (после S1, S3) | devices ядро: `WearablesAggregator` (порт, доменные типы), `OpenWearablesAggregator`, фейковый OW (`apps/api/test/fake-ow.ts`), `devices.collection.ts`, `0011_devices`, env (+ проверки старта), `GET /devices`, `connect`, `callback`, `complete`, `disconnect`, audit, уборка `pending` | unit адаптера на записанных ответах OW (поля, пагинация, ошибки 401/404/429/5xx); int AC6, AC7, AC10, AC13 |
| **S6** (после S4, S5) | Синхронизация: `schedule-pull`, `pull` (окна, catch-up 48 ч, фильтр вело/провайдера, `/timeseries` → поток → `TrackIngest`), historical sync, `sync`, `reconcile`, надгробия при удалении (outbox `tracks.upload-deleted`) | int AC8, AC5 (импорт), дубль файл ↔ OW (AC3) |
| **S7** (после S6) | Вебхук OW: Svix-проверка (unit по эталонным векторам), `POST /v1/devices/webhook` → pull | unit подписи (верная, подменённое тело, старая метка, несколько подписей); int AC9 |
| **S8** (после S1) | profile: `devicesStepCompletedAt`, `PUT /v1/profile/onboarding/devices` | int: статус до/после, идемпотентность, 401 |
| **S9** (после S1; параллельно S3–S7 на моках api) | App «Устройства»: `features/devices/*` (`connect-flow(.native/.web).ts`, `pick-track-file`, `upload-track(.native/.web).ts`, запросы), `settings/devices.tsx`, `devices/return.tsx`, иконка в `top-bar.tsx`, строки | jest (TZ Minsk): состояния, `available: false`, pre-check, прогресс/отмена, опрос статуса, `issue` → действие, возврат (`openAuthSessionAsync` замокан; web — `devices/return`) |
| **S10** (после S8, S9) | Онбординг: шаг `devices`, `(setup)/devices.tsx`, гарды, кеш | jest гарда |
| **S11** (после S4–S7) | Infra: том `trackfiles`, сеть к OW (внешняя сеть из `.env` — `OW_DOCKER_NETWORK`, необязательна), память worker, `env.template` (`DEVICES_ENABLED=false`, пустые `OW_*`), `rehearsal.sh`, runbook | `deploy-rehearsal` зелёный (AC16) |
| **S12** (после всех) | e2e web, документация §10, pr.md (env, миграции, зависимости, действия владельца) | `pnpm build:web && pnpm e2e:web` (`E2E_API=1`); `pnpm check` |

Параллель: S2 — `packages/tracks`; S3–S8 — `apps/api/**`; S9–S10 — `apps/app/**`, `packages/i18n`. Contracts и
api-client — только S1 (два коммита). Провайдерская часть (S5–S7, S9-подключение) отделима: без ключа OW — флаг
`DEVICES_ENABLED=false`, экран показывает только ручную загрузку.

### FILES TO MODIFY
| Файл | Слайс | Изменение |
|---|---|---|
| `docs/adr/0011-tracks-and-devices.md` (новый), `docs/adr/README.md`, `AGENTS.md` §1 | S0 | ADR, рамки MVP |
| `packages/contracts/src/tracks/{track-upload,activity}.schema.ts`, `src/devices/device.schema.ts` (новые, + tests), `src/profile/onboarding.schema.ts`, `src/common.ts`, `src/index.ts` | S1 | схемы |
| `packages/api-client/src/index.ts` (+ tests), `apps/api/src/error-messages.ts` | S1 | методы, тексты кодов |
| `packages/tracks/{package.json,src/{format,precheck,fit,gpx,stream,points,summary,simplify,plausibility,index}.ts}`, `src/__fixtures__/*` (+ tests) | S2 | разбор, геометрия |
| `apps/api/src/modules/tracks/{tracks.collection,tracks.repository,track-file-store,fs-track-file-store,track-uploads.service,track-uploads.controller,track-processing.processor,track-parse.thread,tracks.policy,tracks.events,tracks-maintenance.processor,track-ingest,tracks.module,index}.ts` (+ unit/int) | S3, S4 | модуль |
| `apps/api/src/modules/devices/{wearables-aggregator,open-wearables.aggregator,svix-signature,devices.collection,devices.repository,device-audit,devices.service,devices-link.service,devices-sync.service,devices.controller,devices-callback.controller,devices-webhook.controller,devices-sync.processor,devices-maintenance.processor,devices.events,devices.policy,devices.module,index}.ts` (+ unit/int) | S5–S7 | модуль |
| `apps/api/src/db/migrations/{0010_tracks,0011_devices}.ts`, `index.ts`, `migrations.int.test.ts` | S3, S5 | коллекции, индексы |
| `apps/api/src/{app.module,worker.module,queues,http-app}.ts`, `config/env.ts` (+ test), `.env.example` | S4–S7 | модули, outbox, очереди, парсер, env |
| `apps/api/src/modules/profile/{profile.collection,profile.repository,onboarding.service,onboarding.controller}.ts` (+ int) | S8 | шаг |
| `apps/api/test/{tracks,devices,fake-ow}.ts` (новые) | S4–S7 | хелперы, фейковый OW |
| `apps/app/src/features/devices/*` (+ tests), `src/app/settings/devices.tsx`, `src/app/devices/return.tsx`, `src/components/top-bar.tsx` | S9 | экран, подключение, загрузка |
| `apps/app/src/features/onboarding/{onboarding-store,queries}.ts`, `src/app/(setup)/{_layout,devices}.tsx`, `src/app/_layout.tsx` (+ tests) | S10 | шаг |
| `apps/app/package.json` (`expo-document-picker`), `packages/i18n/src/ru.ts` | S9, S10 | зависимость, строки |
| `infra/deploy/{docker-compose.yml,env.template,rehearsal.sh}`, `docs/runbooks/{deploy,local-dev}.md` | S11 | том, сеть, env |
| `apps/app/e2e/web.spec.ts`, docs §10 | S12 | смоук, документация |

### FILES TO READ
`AGENTS.md` §1–§4; rules §8.3, `pokatim-{backend,db,contracts,app,tests}.md`; ADR-0007, ADR-0008, ADR-0010
(`lockSchedule` — образец замка); `modules/races/races.repository.ts`, `modules/identity/{identity.events,tokens,
auth.guard}.ts`, `modules/identity/jobs/*`, `public-read.guard.ts`, `test/{harness,identity}.ts` (`gate()`);
`apps/app/src/app/(setup)/*`, `features/onboarding/onboarding-store.ts`, `features/auth/authorized.ts`,
`app/auth/verify/*`. Open Wearables — Приложение A; эталонный адаптер OW соседнего проекта (вне репозитория) — только
чтение для сверки полей. context7 (не по памяти): NestJS + Fastify (`addContentTypeParser` с `bodyLimit`, сырое тело
для вебхука — подпись по байтам), BullMQ 6 (`jobId`, repeatable/job schedulers), MongoDB driver 7 (частичные индексы,
TTL, `2dsphere`), Node `worker_threads`, `crypto` (`createHmac`, `timingSafeEqual`), `fetch`
(`AbortSignal.timeout`, потоковое чтение); `@garmin/fitsdk`, `fast-xml-parser` 5; Expo SDK 58 —
`expo-web-browser` (`openAuthSessionAsync`), `expo-document-picker`, `expo-file-system` (upload с прогрессом),
`expo-linking`, Expo Router (`Stack.Protected`).

### TYPES & SCHEMAS
```ts
// packages/contracts/src/tracks/track-upload.schema.ts — справочники только в конец
export const TRACK_FILE_MAX_BYTES = 16 * 1024 * 1024;
export const TRACK_FILE_EXTENSIONS = ['fit', 'gpx'] as const;
export const TRACK_FORMATS = ['fit', 'gpx', 'stream'] as const;          // stream — поток агрегатора
export const TRACK_SOURCES = ['upload', 'garmin', 'wahoo'] as const;
export const TRACK_UPLOAD_STATUSES = ['queued', 'processing', 'ready', 'failed', 'duplicate', 'skipped'] as const;
export const TRACK_FAILURE_CODES = ['unreadable', 'no_track', 'no_timestamps', 'implausible', 'too_many_points',
  'timeout', 'storage'] as const;
export const ACTIVITY_SPORTS = ['cycling', 'cycling_indoor', 'other', 'unknown'] as const;
export const TrackUploadQuery = z.strictObject({ ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(50).default(20) });
export const TrackUpload = z.object({
  id: Uuid, source: tolerantEnum(TRACK_SOURCES), format: tolerantEnum(TRACK_FORMATS),
  fileName: z.string().nullable(), status: tolerantEnum(TRACK_UPLOAD_STATUSES),
  failure: tolerantEnum(TRACK_FAILURE_CODES).nullable(), createdAt: z.iso.datetime(),
  activity: z.object({ id: Uuid, sport: tolerantEnum(ACTIVITY_SPORTS), startedAt: z.iso.datetime(),
    elapsedSec: z.number().int().nonnegative(), distanceM: z.number().nonnegative() }).nullable(),
});
export const TrackUploadPage = z.object({ items: z.array(TrackUpload), nextCursor: z.string().nullable() });
// POST /v1/tracks/uploads?name=… (octet-stream) → 202 | 200; GET /v1/tracks/uploads[/:id]; POST …/:id/delete → 204

// packages/contracts/src/devices/device.schema.ts
export const DEVICE_PROVIDERS = ['garmin', 'wahoo'] as const;
export const DEVICE_STATUSES = ['not_connected', 'pending', 'active', 'disconnecting', 'revoked'] as const;
export const DEVICE_ISSUES = ['reauthorize', 'sync_failed', 'revoke_failed'] as const;
export const DEVICE_RETURN_RESULTS = ['pending', 'error'] as const;
export const DeviceProvider = z.enum(DEVICE_PROVIDERS);
export const DeviceView = z.object({
  provider: tolerantEnum(DEVICE_PROVIDERS), name: z.string(), available: z.boolean(),
  status: tolerantEnum(DEVICE_STATUSES), issue: tolerantEnum(DEVICE_ISSUES).nullable(),
  connectedAt: z.iso.datetime().nullable(), lastSyncedAt: z.iso.datetime().nullable(),
});
export const DeviceList = z.object({ items: z.array(DeviceView) });
export const ConnectDeviceRequest = z.strictObject({ returnUrl: z.string().max(300) });
export const ConnectDeviceResponse = z.object({ authorizeUrl: z.url({ protocol: /^https$/ }) });
export const CompleteDeviceRequest = z.strictObject({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const DisconnectDeviceRequest = z.strictObject({ deleteActivities: z.boolean().default(false) });
// GET /v1/devices; POST /v1/devices/:provider/{connect,complete,sync,disconnect}
// GET /v1/devices/callback?t= → 302 <returnUrl>?provider&result&t; POST /v1/devices/webhook (Svix)

// profile/onboarding.schema.ts
export const OnboardingStatus = z.object({ surveyCompleted: z.boolean(),
  devicesStepCompleted: z.boolean().optional() });
export const CompleteDevicesStepRequest = z.strictObject({ outcome: z.enum(['connected', 'later']) });
// common.ts — в конец ErrorCode: 'TRACK_FORMAT_UNSUPPORTED', 'TRACK_TOO_LARGE', 'TRACK_STORAGE_FULL',
// 'DEVICE_PROVIDER_UNAVAILABLE', 'DEVICE_LINK_INVALID', 'DEVICE_PROVIDER_ERROR'
```

```ts
// packages/tracks
export type TrackFormat = 'fit' | 'gpx' | 'stream';
export interface ParsedPoint extends TrackPoint { time?: Date }
export interface ParsedTrack { format: TrackFormat; sport: ActivitySport; points: ParsedPoint[];
  hasHeartRate: boolean; hasPower: boolean }
export const TrackStreamV1 = z.object({ v: z.literal(1), provider: z.string(), sport: z.string(),
  hasHeartRate: z.boolean(), hasPower: z.boolean(),
  points: z.array(z.tuple([z.number().int() /* unix ms */, z.number(), z.number(), z.number().nullable()]))
    .max(300_000) });
export function detectTrackFormat(bytes: Uint8Array): 'fit' | 'gpx' | null;
export function precheckTrackFile(file: { name: string; size: number }): 'ok' | 'extension' | 'empty' | 'too_large';
export function parseFit(bytes: Uint8Array): ParsedTrack;
export function parseGpx(text: string): ParsedTrack;
export function parseStream(json: unknown): ParsedTrack;
export function summarizeTrack(points: readonly ParsedPoint[]): TrackSummary;
export function simplifyTrack(points: readonly TrackPoint[], toleranceM: number, maxPoints: number): TrackPoint[];
export function checkPlausibility(track: ParsedTrack, now: Date): TrackFailureCode | null;
```

```ts
// apps/api/src/modules/tracks/tracks.collection.ts
export const TRACKS_COLLECTIONS = { uploads: 'track_uploads', activities: 'activities',
  tracks: 'activity_tracks', meta: 'activity_meta' } as const;
export interface TrackUploadDoc { _id: string; userId: string; source: TrackSource; via: 'open_wearables' | null;
  sourceRef: string | null; format: TrackFormat; fileName: string | null; sizeBytes: number; sha256: string;
  storageKey: string | null; status: TrackUploadStatus; failure: TrackFailureCode | null; attempts: number;
  activityId: string | null; createdAt: Date; updatedAt: Date }
export interface ActivityDoc { _id: string; userId: string; uploadId: string; source: TrackSource;
  sport: ActivitySport; startedAt: Date; endedAt: Date; elapsedSec: number; movingSec: number; distanceM: number;
  elevationGainM: number | null; hasHeartRate: boolean; hasPower: boolean;
  startPoint: { type: 'Point'; coordinates: [number, number] }; duplicateOf: string | null; createdAt: Date }
export interface ActivityTrackDoc { _id: string; userId: string;
  line: { type: 'LineString'; coordinates: [number, number][] }; sourcePointCount: number }
export interface ActivityMetaDoc { _id: string /* userId */; version: number }
export interface TrackIngest { ingestProviderStream(input: { userId: string; source: 'garmin' | 'wahoo';
  via: 'open_wearables'; sourceRef: string; stream: TrackStreamV1 }): Promise<{ uploadId: string; created: boolean }> }
export interface TrackFileStore { put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>; delete(key: string): Promise<void>; freeBytes(): Promise<number> }

// apps/api/src/modules/devices/wearables-aggregator.ts — порт (доменные типы pokatim)
export interface AggregatorProvider { provider: string; name: string; enabled: boolean;
  liveSync: 'webhook' | 'pull' | null }
export interface AggregatorWorkout { id: string; provider: string | null; type: string; startedAt: Date;
  endedAt: Date | null; durationSec: number | null; hasHeartRate: boolean; hasPower: boolean }
export interface WearablesAggregator {
  ensureUser(externalId: string): Promise<string>;                       // id пользователя агрегатора
  createAuthorization(input: { aggUserId: string; provider: DeviceProvider; redirectUri: string }):
    Promise<{ authorizeUrl: string }>;
  listConnections(aggUserId: string): Promise<{ provider: string; status: 'active' | 'expired' | 'revoked' }[]>;
  revokeConnection(aggUserId: string, provider: DeviceProvider): Promise<void>;     // 404 — успех
  requestHistoricalSync(aggUserId: string, provider: DeviceProvider, days: number): Promise<boolean>;
  requestSync(aggUserId: string, provider: DeviceProvider): Promise<void>;
  listWorkouts(aggUserId: string, window: { from: Date; to: Date }): AsyncIterable<AggregatorWorkout>;
  fetchWorkoutTrack(aggUserId: string, window: { from: Date; to: Date }, maxSamples: number):
    Promise<[number, number, number, number | null][]>;                    // [unix ms, lat, lon, ele]
  verifyWebhook(headers: Record<string, string>, rawBody: Buffer): { aggUserId: string | null; type: string };
  listProviders(): Promise<AggregatorProvider[]>;
}
export const WEARABLES_AGGREGATOR = Symbol('WEARABLES_AGGREGATOR'); // OpenWearablesAggregator | будущий адаптер

// devices.collection.ts
export const DEVICES_COLLECTIONS = { accounts: 'device_accounts', connections: 'device_connections',
  tickets: 'device_link_tickets', imports: 'device_imports', audit: 'device_audit' } as const;
export interface DeviceAccountDoc { _id: string /* userId */; aggregator: 'open_wearables'; aggUserId: string;
  createdAt: Date }
export interface DeviceConnectionDoc { _id: string; userId: string; aggUserId: string; provider: DeviceProvider;
  status: 'pending' | 'active' | 'disconnecting' | 'revoked'; issue: DeviceIssue | null; pendingUntil: Date | null;
  connectedAt: Date | null; lastSyncedAt: Date | null; catchUpUntil: Date | null; failedImports: number;
  revokedAt: Date | null; revokedReason: 'user' | 'unconfirmed' | 'foreign_ticket' | 'aggregator' | null;
  revokeFailed: boolean; version: number }
export interface DeviceLinkTicketDoc { _id: string /* sha256 */; userId: string; provider: DeviceProvider;
  connectionId: string; returnUrl: string; expiresAt: Date }
export interface DeviceImportDoc { _id: string; userId: string; provider: DeviceProvider; aggWorkoutId: string;
  status: 'queued' | 'imported' | 'skipped' | 'failed' | 'deleted'; reason: string | null; attempts: number;
  uploadId: string | null; firstSeenAt: Date; updatedAt: Date }
export interface DeviceAuditDoc { _id: string; userId: string; provider: DeviceProvider; connectionId: string;
  action: 'connected' | 'disconnected' | 'revoke_failed' | 'reauthorize_required'; reason: string | null; at: Date }
```

Миграции (expand-only, идемпотентны):
- `0010_tracks`: `ensureCollection` × 4; `track_uploads_user_sha_unique` (`{ userId, sha256 }`),
  `track_uploads_source_ref_unique` (`{ source, sourceRef }`, partial `sourceRef: { $type: 'string' }`),
  `track_uploads_user_created_idx` (`{ userId: 1, _id: -1 }`), `track_uploads_cleanup_idx` (`{ status, updatedAt }`);
  `activities_user_started_idx` (`{ userId: 1, startedAt: -1 }`), `activities_upload_idx`,
  `activities_start_point_2dsphere`; `activity_tracks_line_2dsphere`, `activity_tracks_user_idx`.
- `0011_devices`: `device_accounts_agg_user_unique` (`{ aggregator, aggUserId }`);
  `device_connections_user_provider_live_unique` (`{ userId, provider }`, partial `status ∈ pending|active|
  disconnecting`), `device_connections_agg_user_idx` (`{ aggUserId: 1 }`), `device_connections_status_idx`
  (`{ status: 1, pendingUntil: 1 }`); `device_link_tickets_ttl` (`expiresAt`, 0); `device_imports_workout_unique`
  (`{ provider, aggWorkoutId }`), `device_imports_upload_idx` (`{ uploadId: 1 }`, partial);
  `device_audit_user_idx` (`{ userId: 1, _id: -1 }`).

Env (`config/env.ts`, зависимости — `superRefine`): `TRACK_STORAGE_DIR`, `TRACK_STORAGE_MAX_BYTES` (2 GiB),
`TRACK_STORAGE_MIN_FREE_BYTES` (1 GiB); `DEVICES_ENABLED` (false), `DEVICES_AGGREGATOR` (`open_wearables`),
`DEVICE_PROVIDERS_ALLOWLIST` (`garmin,wahoo`), `DEVICE_RETURN_URLS`, `PUBLIC_API_ORIGIN`, `DEVICES_SYNC_INTERVAL_MIN`
(15), `DEVICES_HISTORY_DAYS` (30), `OW_API_URL`, `OW_API_KEY`, `OW_WEBHOOK_SECRET` (необязателен — push выключен),
`OW_EXTERNAL_ID_PREFIX` (`pokatim:`), `OW_SHARED_INSTANCE` (true на dev; в production — отказ запуска).

### TESTS
- **packages/tracks:** FIT Garmin Edge/часы/Wahoo Elemnt, бег, несколько сессий, сжатые метки, indoor, битый CRC,
  усечённый; GPX Garmin Connect/Komoot, без `<time>`, пустой `<trk>`, (0,0), обратное время, XXE и «миллиард
  смехов» — отказ; поток `pokatim.stream.v1` (валидный, координаты вне диапазона, немонотонное время, > лимита);
  `detectTrackFormat`; `simplifyTrack`; `checkPlausibility`.
- **contracts/api-client:** строгие запросы, `tolerantEnum` ответов, формат тикета; Bearer только в методах под входом.
- **API unit:** адаптер OW на записанных ответах (поля `source.provider`, пагинация курсором, обязательные даты,
  401/404/429/5xx), Svix (векторы из спецификации Svix: верная, подменённое тело, старая метка, несколько подписей,
  `whsec_`-префикс), политика импорта (велотипы, провайдер, окна, catch-up 48 ч), дедуп (границы, приоритеты).
- **API int (MongoDB RS + Redis, `TestClock`, фейковый OW — локальный HTTP-сервер):** AC1–AC10, AC13–AC14; гонки:
  (1) две вставки одного заезда — ворота на `lockUserActivities` — **отрицательное доказательство**; (2) два
  параллельных `connect` одного пользователя — один пользователь OW (ворота на Redis-замке, **отрицательное
  доказательство** без замка — два); (3) два `complete` одного тикета — один успех; (4) удаление загрузки ↔ pull того
  же импорта — нет воскрешения. Маршруты `tracks`/`devices` (кроме callback и вебхука) — под `AuthGuard` (обход
  контроллеров). Логи — без маркера API key/тикета.
- **App (jest, TZ Europe/Minsk):** гард онбординга (`survey → location → devices → done`, поле отсутствует —
  `done`), шаг (`available: false` → только «Позже»), «Устройства» (состояния, загрузка, отключение с галочкой,
  «Синхронизировать сейчас» с 429), `devices/return` (`pending` → `completeDevice`, `error`, мусорный тикет — без
  запроса); `*.web.test.ts`.
- **E2E (web, `E2E_API=1`):** «Позже» → Главная; загрузка GPX → «Готово».
- **Деплой:** `deploy-rehearsal` (AC16).
- **Ручной смоук (человек; NOT VERIFIED, если не делался):** dev с ключом OW — подключение Wahoo и Garmin (аккаунты,
  не подключённые к соседнему сервису) с iOS/Android/web → заезд → «Синхронизировать сейчас» → «Готово»; сравнение
  дистанции с FIT того же заезда.

### OUT OF SCOPE
§4. Плюс: свой OW и свои consumer для prod, адаптер ROOK, S3, видимость провалов в панели, удаление аккаунта, 2FA/CSP.

# 12. Outcome

_Заполняется после реализации: ветка, коммиты по слайсам, вывод `pnpm check`, отрицательные доказательства
(`lockUserActivities`, замок `ensureUser`), e2e, репетиция деплоя, ручной смоук или NOT VERIFIED, follow-ups (свой OW
и consumer для prod, S3, resumable, TCX, видимость провалов в панели)._

# Приложение A. Open Wearables: что использует pokatim (`[VERIFY]` — сверить с развёрнутой 0.9.x)

| Операция | REST OW (`/api/v1`, заголовок `X-Open-Wearables-API-Key`) | Примечания |
|---|---|---|
| Провайдеры | `GET /oauth/providers` → `[{ provider, name, has_cloud_api, is_enabled, icon_url, live_sync_mode }]` | на dev: garmin — webhook live sync, wahoo — pull |
| Пользователь | `POST /users { external_user_id }` → `{ id }` | `external_user_id` уникален; OW не дедуплицирует пользователей без него; удаление — `DELETE /users/{id}` только с правами разработчика |
| Авторизация | `GET /oauth/{provider}/authorize?user_id&redirect_uri` → `{ authorization_url, state }` | redirect URI у провайдеров → callback OW; OW после обмена кода — 303 на `redirect_uri`; при ошибке — своя страница ошибки (`[VERIFY]`); allowlist `redirect_uri` — `[VERIFY]` |
| Подключения | `GET /users/{id}/connections` → `[{ provider, status }]`; `DELETE /users/{id}/connections/{provider}` (404 — уже нет) | отзыв у провайдера выполняет OW |
| История | `POST /providers/{provider}/users/{id}/sync/historical?days=N` | Garmin — до ~30 дней за запрос, асинхронно; повтор окна у Garmin → 409 (окно отдаётся один раз на consumer) |
| Синхронизация | `POST /providers/{provider}/users/{id}/sync` (`[VERIFY]` путь в 0.9) | для pull-провайдеров (Wahoo) |
| Тренировки | `GET /users/{id}/events/workouts?start_date&end_date[&cursor]` | даты обязательны; провайдер — вложенный `source.provider`; типы: `cycling`, `mountain_biking`, `indoor_cycling`, `cyclocross`, `e_biking`, … |
| Трек | `GET /users/{id}/timeseries?types=latitude,longitude,elevation&start_time&end_time&resolution=raw&limit=1000[&cursor]` | плоский список сэмплов `{ type, timestamp, value }`; широта/долгота выравниваются по метке времени |
| Вебхук | Svix: заголовки `svix-id`, `svix-timestamp`, `svix-signature` (`v1,<base64>`), подпись HMAC-SHA256 от `id.timestamp.body` ключом `whsec_<base64>`; `data.user_id`, `data.provider`, `type` | исходящие вебхуки OW выключены по умолчанию (`OUTGOING_WEBHOOKS_ENABLED`), эндпоинт регистрируется в OW (`POST /webhooks/endpoints` / dev-портал) |
| Ретеншен | data lifecycle OW подрезает сырые ряды (`DATA_LIFECYCLE_ENABLED`) | pokatim держит свою копию трека |

# Приложение B. Что нужно от владельца

**Для dev (общий OW)**
1. **API key OW для pokatim** — создать в dev-портале OW, вписать в `~/pokatim/.env` руками: `OW_API_KEY`,
   `OW_API_URL` (адрес, доступный из контейнеров api/worker), `DEVICES_ENABLED=true`, `OW_SHARED_INSTANCE=true`;
   агенту не передавать.
2. **Сеть (N3)** — рекомендация: подключить api/worker pokatim к docker-сети стека OW (имя сети — в `.env`,
   `OW_DOCKER_NETWORK`; compose pokatim объявит её внешней) и `OW_API_URL=http://<сервис OW>:8000`; альтернатива —
   адрес OW, доступный с хоста через docker host-gateway (OW должен слушать не только `127.0.0.1`).
3. **`redirect_uri`** — проверить, что OW 0.9 принимает `https://pokatim-dev.limedolphin.com/v1/devices/callback?t=…`;
   если есть allowlist — добавить. У провайдеров (Garmin/Wahoo) ничего менять не нужно: их redirect URI уже ведут в
   OW.
4. **Пин версии OW** — заменить `latest` на точный тег 0.9.x и предупреждать об обновлениях (адаптер сверяется с
   версией).
5. **Тестеры** — аккаунты Garmin/Wahoo, **не подключённые к соседнему сервису** (один аккаунт — один проект на общем
   consumer; отключение в одном проекте отзывает регистрацию у Garmin и для другого). Экран согласия покажет название
   приложения, настроенного в OW.
6. **(Опционально, push — N1/V7)** — включить исходящие вебхуки OW (настройка всего инстанса — согласовать с
   соседним сервисом), зарегистрировать эндпоинт `https://pokatim-dev.limedolphin.com/v1/devices/webhook`, секрет
   `whsec_…` — в `.env` (`OW_WEBHOOK_SECRET`). Без этого работает pull каждые 15 мин.
7. Ответы V5 (лицензия FIT SDK), V6 (память/диск).

**Для prod (до релиза)**
1. Свой инстанс OW (пин версии, свой Postgres/Redis/Svix, бэкапы) — изоляция данных и настроек.
2. Свои приложения у провайдеров под «Покатим»: Garmin Connect Developer Program (заявка, одобрение — от дней до
   недель), Wahoo (sandbox → production review); redirect URI → callback своего OW.
3. `OW_SHARED_INSTANCE=false`; подключения dev в prod не переносятся.
