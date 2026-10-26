---
paths:
  - "apps/api/**"
---

# pokatim — backend (дополняет `backend.md`)

Доменные правила pokatim поверх общего правила шаблона. Процесс — скил `app-dev-kit:backend-nest`.

## Модули и reuse

- Контексты `src/modules/<context>/`: identity, profile, routes, rides, calendar, races, results, disputes,
  seasons, gamification, sharing, notifications, moderation, media (по мере появления).
  Есть: `identity` (учётка, сессии, `AuthGuard`), `profile` (онбординг: опрос, коллекция `profiles`; `GET /v1/profile` — ответы опроса своего
  пользователя для Главной, публичное имя и согласие, `no-store`, документа нет — `[]` / `null` / `false`;
  `PATCH /v1/profile` — частичное обновление имени и согласия, лимит `profile-update:<uid>` 30/ч; порт `RIDER_NAMES`
  (`RiderNameDirectory`) для `results` — через `ProfileCoreModule` (репозиторий + порт, без контроллеров; его
  импортируют `ProfileModule` и `ResultsCoreModule`); авторизация — `AuthGuard` через `modules/identity/index.ts`,
  коллекции identity не читает; `results` берёт имена только через порт после snapshot-сессии, в снимок протокола
  их не пишет; profile-02: журнал согласий в транзакции `PATCH`, панельный контроллер `admin/profiles` (сброс
  имени, `ProfileModerationService`) — `ProfileModule` импортирует `PanelModule`; `ResultsPanelReadService` получает
  имена через `RIDER_NAMES` — `ResultsModule` импортирует `ProfileCoreModule`), `panel` (доступ к панели «Протокол»:
  члены команды и роли, сессии панели, журнал; identity — только порт `PanelCredentials`/`IdentityAccounts`),
  `races` (сезоны и гонки по коридору — одна граница, ADR-0010: определение сезона живёт здесь, отдельного модуля
  `seasons` нет), `calendar` (календарь стартов, с гонками не связан), `tracks` (загрузки, разбор, активности —
  ADR-0011), `devices` (Garmin/Wahoo через агрегатор Open Wearables), `routes` (маршруты команды платформы —
  эталон коридора гонки, ADR-0012 Proposed) и `rides` (кофе-райды, ADR-0013 Proposed: зависит только от `identity`;
  панель — с модерацией 05b).
- `routes` о гонках не знает и зависит только от `panel`; `races → routes` — только порт `RouteCatalog`
  (`modules/routes/index.ts`, `RoutesCoreModule`): готовый маршрут по id в транзакции правки гонки и названия
  маршрутов списка. Записи `routes`/`route_*` из `races` (и наоборот) — нет. Карта коридора (maps-01, ADR-0014):
  `races` читает линию показа через порт `RouteGeometry.displayGeometry` (только `ready`, проекция без
  `matchLine`, свой LRU-кэш в процессе отдельно от кэша линии сверки); публичный `GET /v1/races/:id/route` —
  `RacesPublicController`, видимость — общий `publicRace` сервиса (та же, что у `GET /v1/races/:id`).
- Каталог маршрутов (routes-01): `routes` зависит от `panel` и `src/public-read.guard.ts`. Панель —
  `RoutesCatalogAdminService` (`POST /v1/admin/routes/:id/publish|unpublish`, транзакция «чтение маршрута → запись →
  `PanelAudit.append`», повтор с теми же значениями — без записи и журнала); публично — `RoutesPublicController`
  (`routes`, `routes/cities` **до** `routes/:id`, `routes/:id/map`) → `RoutesPublicService` (геометрия — порт
  `ROUTE_GEOMETRY`, тот же `RoutesCatalogService`). `GET /v1/routes/:id/races` живёт в `races`
  (`RacesPublicController`): проверка «в каталоге» — порт `RouteCatalog.inCatalog` (без кэша), 404 — до разбора
  курсора.
- Общий код загрузок в `src/`: `raw-body.ts` (`readLimited` — тело `application/octet-stream` после гарда и лимита,
  обрыв на лимите — `413` с кодом модуля и `Connection: close`) и `parse-thread.ts` (`runParseThread` — функция
  `@pokatim/tracks/parse` из белого списка `PARSE_FUNCTIONS` в `worker_threads`, `DEFAULT_PARSE_LIMITS` 160/32 МБ,
  30 с; таймаут — `timeout`, OOM — `unreadable`, сбой загрузчика — исключение и ретрай). Свой поток разбора в модуле —
  нет.
- `tracks` об агрегаторе не знает (источник — enum + непрозрачный `sourceRef`, поле `via`); `devices` пишет в
  `tracks` только через порт `TrackIngest` (`modules/tracks/index.ts`). Разбор FIT/GPX/потока — только
  `@pokatim/tracks/parse` в worker (`worker_threads` с лимитами), в HTTP-обработчике — только сигнатура формата.
- REST агрегатора — только адаптер за портом `WearablesAggregator` (`open-wearables.aggregator.ts`): адрес и ключ —
  env, без редиректов, таймаут и лимит байт, zod-ответы. Pull — основной путь, вебхук OW — только сигнал (данные из
  тела не используются); импорт — только для `active` подключений. Ключ OW и секрет вебхука — только env.
- Доменный модуль панели пишет журнал `PanelAudit.append(tx, { action, subject: { kind, id, label }, details })` —
  `label` — название на момент действия; имена сотрудников — порт `PanelDirectory` (не `panel_members`).
- Публичное чтение (`/v1/races`, `/v1/seasons` — список, `current`, `:id`, `:id/races`; `/v1/calendar`) — отдельные
  контроллеры без гарда панели; статический маршрут (`seasons/current`) объявляется до параметрического
  (`seasons/:id`), иначе он уйдёт в pipe `Uuid` (400). Только опубликованное, без владельца и служебных полей,
  `@Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)`, `PublicReadGuard` (IP-лимит `public-read`), курсор —
  `src/page-cursor.ts`. Мутаций без гарда нет. Календарь: `calendar/cities` и `calendar/months` объявлены до
  `calendar/:id`; фаза старта — `calendarPhase` (`calendar.policy.ts`) по `minskToday(CLOCK.now())`.
- Новые эндпоинты панели (`/v1/admin/*`, модули следующих слайсов) — `@UseGuards(PanelGuard)` +
  `@RequirePermission(...)` + `@CurrentPanelUser()`; чувствительное действие пишет `PanelAudit.append(tx, …)` в
  транзакции действия. Всё — из `modules/panel/index.ts`; новое право — в конец `PERMISSIONS` контракта и в
  `ROLE_PERMISSIONS`.
- Код, нужный ≥2 приложениям (разбор трека для pre-check в приложении и на сервере), — в `packages/tracks`
  (`@pokatim/tracks`): парсинг GPX/TCX/FIT/KML и геометрия; дубли разбора в модулях запрещены.

## Авторитет сервера и история

- Результаты, места, кластеры считает только сервер; входящие от клиента значения времени игнорируются.
- Append-only (только INSERT): история споров (`dispute_events`), исключения треков, пересчёты, модерация, решения
  организатора. Проекция `disputes` — переходы только из `open` (`pokatim-db.md`, «Споры»).

## Очереди (worker)

- Брокер — BullMQ на Redis; RabbitMQ не используем (переход — только через ADR; outbox оставляет к нему путь).
- Тяжёлая работа — только в worker: разбор трека, геопересчёт (коридор), рендер Skia/ffmpeg, OG-картинки,
  бейджи, уведомления, пересчёт сезона. HTTP-обработчик ставит задачу.
- Лимиты времени и памяти — для разбора файлов и рендеринга (Skia, ffmpeg).
- Финальный провал задачи — dead-letter → видимое действие в панели организатора, а не тишина.

## Данные и логи

- Логи — без биометрии (пульс, мощность, FTP, вес) и e-mail.
- Время — UTC в БД, Europe/Minsk — только на отображении (AGENTS.md §4.7).
- Геометрия (ADR-0007, R11): GeoJSON + `2dsphere` в MongoDB для «рядом»/bbox; коридор, длина, прогресс по маршруту,
  правдоподобие — функции `packages/tracks` в worker (`pokatim-db.md`). Геозапросы проверяются интеграционными
  тестами на реальном MongoDB, моки БД для геозапросов запрещены.
- `results` (race-results-03): заявки и попытки; другие модули — только порты через `index.ts`: `RaceRegistry`
  (`races`: гонка, окно, `admitEntry` — фиксация V-12 в транзакции заявки, видимость в панели), `RouteGeometry`
  (`routes`: линия сверки и рамка, кэш в процессе; `races` — линия показа для карты), `ActivitySource` (`tracks`: группа дублей, свои активности и
  загрузки, исходник для worker). События `tracks.activity-ready/-removed` — свои типы подписчика: outbox базы
  отправляет тип в одну очередь. Сверка — `runParseThread('analyzeAttempt')` в worker; потоки разбора на процесс
  ограничены семафором `PARSE_THREADS_MAX` (`src/parse-thread.ts`).
- Сверка заезда с коридором гонки — `matchCorridor` / `analyzeAttempt` из `@pokatim/tracks/parse` (ADR-0012 п. 5):
  только worker (`worker_threads`), по исходнику без прореживания; `engineVersion` пишется в попытку, смена версии
  не пересчитывает результаты молча. Лёгкий вход `@pokatim/tracks` движок не экспортирует.
- Разметка схода на карте участника (maps-02, ADR-0012 «Разметка схода»): считает worker при сверке, не чтение и не
  клиент. `matchCorridorDetailed` = `matchCorridor` + интервалы схода выбранного сегмента по времени трека (один
  повторный проход `offCorridor`; golden и `CORRIDOR_ENGINE_VERSION` не меняются); `analyzeAttempt(…, line)`
  получает **сохранённую** линию показа активности (порт `ActivitySource.trackLine`) и `trackMapOf` переводит
  интервалы в позиции на ней (дробный индекс вершины): время → путь по исходнику (точки со временем, бинарный поиск;
  путь — haversine по всем точкам) → отрезок линии. Линия в потоке не пересчитывается: Дуглас — Пекер на дрожании
  стоянки — O(n²) (71 с на AC14). Точность: поперёк — допуск упрощения (5 м; при удвоении допуска до 1000 точек —
  больше), вдоль — метры (хорды ≠ отрезки линии); стоянки и точки без времени позицию не сдвигают. Подсветка —
  иллюстрация, итог — `offCorridorM`/`maxExcursionM` попытки.
- `GET /v1/races/:raceId/entry/attempts/:attemptId/track` (`RaceEntryController`, `ResultsReadService.myAttemptTrack`):
  попытка этой гонки, своя и видимая в «моём участии» (`attemptHidden`), линия — через порт `tracks`; ответ — по
  полям; `marks`: `queued|checking` — `pending`, `trackMap` есть и `linePoints` = точкам линии — `ready`, иначе
  `unavailable`.
- Анонимизация при удалении аккаунта — «Удалённый участник» (см. `pokatim-db.md`).

## Красные флаги pokatim

Клиентское время в расчёте результата · UPDATE/DELETE аудита и истории споров, переход спора не из `open` ·
биометрия или e-mail в логах · разбор трека или рендер в HTTP-обработчике.

## Протокол (`results`, race-results-05)

- Мутации панели — `results-protocol.controller.ts` → `ResultsProtocolService` (транзакция под `lockResults`, журнал
  `PanelAudit.append` и outbox в ней же, лог после коммита — без причины и `userId` райдера); чтения панели —
  `results-admin.controller.ts` → `ResultsPanelReadService`. Чек-лист — одна чистая `publishChecklist` для чтения и
  транзакции публикации, снимок — `buildProtocol`, места — только `rankRows`.
- «Перепроверить треки» в HTTP не перепоставляет попытки: только `recheck_started` + событие
  `results.race-recheck-requested` → `results-intake` → `ResultsRecheck.requestRace` (транзакция на попытку под
  `lockEntry`, идемпотентно по `checkedAt < requestedAt`). Пока есть незавершённые проверки — публикация и
  «Применить пересчёт» отвечают 409.
- `results.protocol-published` / `results.result-revised` — в outbox без маршрута (`publishedAt: null` до слайса 08;
  издатель базы берёт только типы из маршрутов).
- Отказы состояния — `409 RESULTS_ACTION_BLOCKED { reason, count? }`, `409 RESULTS_PUBLISH_BLOCKED { blockedBy,
  checklist }`.

## Споры (`disputes`, race-results-06)

- Модуль `disputes`: `DisputesService` (приложение — подача, отзыв, ответ, «мои споры в гонке»), `DisputesPanelService`
  (список, разбор, решение), политика — чистые функции `disputes.policy.ts`. Другие модули — только через
  `index.ts`: `ResultsForDisputes` (`results`: заявки гонки, `lockEntry` цели, `disqualify`, `standing` — место через
  `ResultsReadService.entryResult`, без второго расчёта мест), `RaceRegistry` (`races`: гонка, фаза, `lockResults`).
- Гейты: `results` объявляет `ResultDisputeGate` (D-39, чек-лист `open_disputes`), `races` — `RaceCancelGate`
  (D-19); реализация `DisputeGates` — в `@Global DisputesCoreModule`, его импортируют `AppModule` и `WorkerModule`.
  Инъекция обязательная, без `@Optional`: забытая регистрация роняет старт, а не выключает D-39 молча.
- D-39: `EntriesService.withdraw` и `AttemptsService.add` под `lockEntry` → `RACE_WITHDRAW_CLOSED` /
  `ATTEMPT_UPLOAD_CLOSED { reason: 'dispute_open' | 'disqualified' }`. Авто-приём (`AttemptIntake.syncGroup`) при
  открытом споре по заявке и без запроса райдера по группе — выход без изменений: группа заморожена целиком (снятие
  `not_primary` тоже). После решения авто-попытки сами не появятся — райдер выбирает заезд явно.
- Решение — `lockResults` → проверки (`not_open`, `cancelled`, `protocol_published`, `too_early` с `availableAt`) →
  `lockEntry` цели → переход → при `upheld` `disqualify` (идемпотентно) → событие, outbox, `PanelAudit.append` в той же
  транзакции.
- События `disputes.dispute-filed/-withdrawn/-responded/-decided` — в outbox без маршрута до модуля `notifications`
  (A11); в событиях только id и коды. Лог после коммита — `disputeId`, `raceId`, действие, исход.
- Отказы — `409 DISPUTE_ACTION_BLOCKED { reason, availableAt? }`, `404 DISPUTE_NOT_FOUND`; отмена гонки при открытых
  спорах — `409 RACE_INVALID_STATE { reason: 'disputes_open' }`.
- Ряды пульса и мощности (06b): `DisputeSeriesService` (HTTP — кэш и постановка) → очередь `dispute-series` →
  `DisputeSeriesProcessor` в `DisputesWorkerModule` (`WorkerModule`): `ResultsForDisputes.bestSegment` → исходник
  через порт `tracks` `ActivitySource.readSource` (зависимость `disputes → tracks`, только `index.ts`) →
  `runParseThread('analyzeSeries')` → `DisputeSeriesCache` (Redis, ключ — попытка и ревизия; дедупликация — ключ
  постановки NX, не jobId). Лучшая попытка или ревизия сменилась — задача `skipped`, кэш не пишет.

## Кофе-райды (`rides`, блок 05)

- Лента `GET /v1/rides`, города `GET /v1/rides/cities`, состояние зрителя `GET /v1/rides/:id/me` и все мутации —
  `rides.controller.ts` под `AuthGuard`, `no-store` (лента зависит от зрителя: роль, отменённые свои). Публичное
  чтение — только `GET /v1/rides/:id` (`rides-public.controller.ts`, `PublicReadGuard`, `public, max-age=60`).
  `rides/cities` — статический путь, в pipe `Uuid` не уходит (int-тест).
- Фаза и права зрителя — `rides.policy.ts` (`ridePhase`, `rideViewer`, `validateStartsAt`, `RIDES_POLICY`); ответы
  собирает `rides-feed.service.ts` из явного списка полей.
- Лимиты частоты (`RateLimiter` базы, ключ — `uid`): `rides-create`, `rides-manage` (правка и отмена), `rides-rsvp`
  (join и leave); квоты — `409 RIDE_QUOTA_EXCEEDED` с `RideQuotaDetails`. Outbox-событий и аудита в 05a нет.
