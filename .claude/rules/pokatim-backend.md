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
  `PATCH /v1/profile` — частичное обновление имени и согласия, лимит `profile-update:<uid>` 30/ч; user-theme
  (ADR-0021): `ProfileView.themeId` (нет выбора — `classic`), `PUT /v1/profile/theme` `{ themeId }` — одна атомарная
  операция вне транзакции, без журнала, свой лимит `profile-theme:<uid>` 60/ч; порт `RIDER_THEMES` (`themeOf`) для
  `sharing`; порт `RIDER_NAMES`
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
  эталон коридора гонки, ADR-0012 Proposed) и `rides` (кофе-райды, ADR-0013 Proposed: зависит от `identity` и порта `routes` `RideRoutes` (05c);
  панель — с модерацией 05b), `appearance` (сезонный декор — глобальная настройка платформы,
  `platform_settings/appearance`; тема — личная у райдера, `profile`, ADR-0021; импортирует только `panel/index.ts` и
  `public-read.guard.ts`, потребителей вне модуля нет; публичное `GET /v1/appearance` — ровно `{ themeId, decor }`,
  `themeId` — константа `classic` для сборок до user-theme, `Cache-Control: no-cache`; панель
  `GET|PUT /v1/admin/appearance` — `appearance.manage`, замена по `version` (409), тело — `{ decor, version }`
  (halloween-decor: `none | halloween`; `themeId` — 400), журнал `appearance.decor_changed` с
  `subject.kind = 'platform'` (nil UUID) в транзакции; повтор того же декора — без записи; старые записи
  `appearance.theme_changed` — история).
- `routes` о гонках не знает и зависит от `panel` и `identity` (routes-02: `AuthGuard` «моих маршрутов», как `rides`); `races → routes` — только порт `RouteCatalog`
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
- Карточка и GPX каталога (routes-03): `RoutesPublicService.get` — `findPublished` → `RoutesRepository.derivedOf`
  (проекция профиля и версии, без кэша в процессе; порт `RouteGeometry` и `displayCache` не меняются);
  `routes/:id/gpx` — `IpRateLimitGuard` + `@IpRateLimit('route-gpx', ROUTE_POLICY.gpxIpLimit)` после класс-гарда,
  байты `route_exports`, заголовки файла через `HttpAdapterHost` после чтения (Nest пишет `@Header` до обработчика —
  404 с типом файла не сериализовался бы). Общий IP-лимит метода — `consumeIpLimit`/`IpRateLimitGuard` в
  `src/public-read.guard.ts` (им же пользуется `PublicReadGuard`).
- Очередь `routes-maintenance` (routes-03, `RoutesWorkerModule`): `RoutesSchedules` — расписание `routes.maintenance`
  каждые 10 мин + разовая `routes.derive.boot` при старте worker; `RoutesMaintenanceProcessor` → `RouteDerivedBackfill.run`
  (≤ `ROUTE_POLICY.deriveBatch` маршрутов, `runParseThread('deriveRoute')` по одному — семафор отпускается между ними;
  полная пачка с прогрессом — следующая пачка в той же задаче, ≤ `ROUTES_DERIVE_MAX_BATCHES`; продолжение отдельной
  задачей с постоянным `jobId` BullMQ отбросил бы как дубль ещё не удалённой текущей). `deriveRoute` и `analyzeRoute` разбирают исходник одним
  `loadRoutePoints` (`@pokatim/tracks/parse`) — новый формат маршрута добавляется туда.
- Мои маршруты (routes-02): `RoutesMineController` (`@Controller('routes/mine')`, `AuthGuard`) — **первым** в
  `RoutesModule.controllers` (статический сегмент до публичного `routes/:id`, иначе pipe `Uuid` → 400) →
  `MyRoutesService` (лимиты и слот приёма `UploadSlots` до тела, квота, список, карточка, карта через
  `displayGeometryOf` — не через порт и кэш, `rename`, `delete` в транзакции). Приём — общий
  `RoutesService.accept({ userId, origin }, …)`: формат — `detectRouteFormat` (GPX/KML; панель — API и UI,
  `.gpx,.kml`), журнал панели — только `platform`, outbox `routes.route-received` и worker `route-processing` —
  общие. Порты `RouteCatalog`/`RouteGeometry` и `RoutesCatalogService` видят только `platform`. Мутации «моих» — `POST` с глаголом (`rename`, `delete`).
- Публикация маршрутов райдеров (routes-06): порядок контроллеров `RoutesModule` — `RoutesMineController`,
  `RoutesViewerController`, `RoutesAdminController`, `RoutesModerationController`, `RoutesPublicController`.
  `RoutesMineController` + `publish`/`unpublish` → `MyRoutePublicationService` (атомарная запись без журнала;
  подача — транзакция: условная запись, затем лимит `routes-publication-submit:<uid>` 10/сут — квоту тратят только
  успешные подачи, отказ 409 и проигравшая параллельная подача — нет, 429 откатывает запись);
  `RoutesViewerController` (`@Controller('routes')` + `AuthGuard`, `:id/me`, `:id/reports`) → `RouteReportsService`
  (лимит `routes-report:<uid>` 20/сут); `RoutesModerationController` (`admin/rider-routes`, `PanelGuard` +
  `routes.moderate`) → `RoutesModerationService`. Публичный каталог — `findInCatalog`/`listCatalog` (`IN_CATALOG`);
  карта маршрута райдера — `displayGeometryOf` без кэша, маршрута команды — порт `ROUTE_GEOMETRY`; «Гонки на маршруте»
  (`races`, порт `inCatalog` — только платформа) для маршрута райдера — `404` (U7). Имя автора — порт `profile`
  `RIDER_NAMES.attributionNames` (только `publicName`, без `showNameInResults`; согласие — `publication.showAuthorName`),
  один вызов на страницу, читается на каждом запросе; `RoutesModule` импортирует `ProfileCoreModule`.
  Удаление маршрута (автор и `RouteErasure`) — `RouteDeletion` (маршрут + жалобы). Событие outbox
  `routes.publication-decided` (`routeId`, `authorUserId`, `decision`, `decidedAt`) — маршрут объявляет подписчик
  (`notificationsOutboxRoutes`), поля текста — порт `RouteNotices` (`ROUTE_NOTICES`, `findForNotice`). Хвост давних
  решений (8.1 RC-3) отсекает intake: события старше 72 ч — `stale`.
- Общий код загрузок в `src/`: `raw-body.ts` (`readLimited` — тело `application/octet-stream` после гарда и лимита,
  обрыв на лимите — `413` с кодом модуля, тишина > 30 с или тело > 180 с — `408 VALIDATION_FAILED` (`body`), оба —
  с `Connection: close`), `upload-slots.ts` (`UploadSlots` — слоты приёма заездов и «моих маршрутов»: предел процесса
  и 1 на пользователя, отказ — `429` до тела; панель — без слотов) и `parse-thread.ts` (`runParseThread` — функция
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
- Публичное чтение (`/v1/races`, `/v1/seasons` — список, `current`, `:id`, `:id/races`; `/v1/calendar`;
  `/v1/appearance`) — отдельные
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

## Профиль райдера (`profile`, `riders`, rider-profile)

- `profile`: клуб и `publicId` — `PATCH /v1/profile` (`club`), аватар — `ProfileAvatarsController`
  (`@Controller('profile/avatar')`, `AuthGuard`: `PUT` сырыми байтами — query `AvatarCropQuery` до слота и тела,
  `ProfileAvatarService.admit` (лимит `profile-avatar:<uid>` 20/ч, свои `UploadSlots` чтения 4/1 — слот до лимита) → `readLimited` 10 МиБ (таймауты 10/60 с) → место обработки
  `AvatarProcessingGate` (1 на процесс, ожидание ≤ 5 с, иначе 429) →
  `processAvatar`; `POST delete` — лимит `profile-update`), отдача — `AvatarsPublicController` (`avatars/:id`,
  `PublicReadGuard`, заголовки через `HttpAdapterHost` после чтения). Порт `RIDER_PROFILES`
  (`RiderProfileDirectory.findPublic`) — в `ProfileCoreModule`.
- **Исключение RC-A1 (ADR-0019):** перекодирование аватара `sharp` (`avatar-image.ts`) — в HTTP-обработчике: вход
  ≤ 10 МиБ, JPEG/WebP ≤ 100 Мп (две стадии: shrink-on-load до 2048 px, затем квадрат), PNG ≤ 25 Мп, `failOn: 'error'`,
  `timeout` 10 с, 1 обработка на процесс (память — ADR-0019), пул libvips вне event loop. «Рендер в HTTP-обработчике»
  красных флагов — Skia, ffmpeg, OG; другие изображения — только по этому образцу и с ADR.
- Истории своего профиля — в модулях-владельцах: `results` — `ProfileRacesController` (`profile/races`) →
  `ResultsHistoryService` (`entriesOfUserPage` + `ResultsReadService.entryResult` в одной snapshot-сессии, места не
  дублируются); `rides` — `ProfileRidesController` (`profile/rides`) → `RidesHistoryService` (`pastOf`,
  `rides_participant_idx`). Пути `/v1/profile/{avatar,races,rides,stats}` — статические сегменты, у
  `ProfileController` только `GET /`, `PATCH /` и `PUT theme` (user-theme).
- `riders` — модуль-композиция (образец `standings`, своих коллекций нет): `riders → profile, results, tracks,
  identity` только через `index.ts`; `riders` не импортирует никто, кроме `AppModule`. Порты: `RIDER_PROFILES`
  (`profile`), `RIDER_RESULTS` (`results`: `publishedRows` — строки текущих ревизий, `racesOf`), `ACTIVITY_TOTALS`
  (`tracks`, отдельный порт — `ActivitySource` не расширяется; реэкспорт через `ResultsCoreModule`). HTTP:
  `ProfileStatsController` (`profile/stats`, `AuthGuard`, `no-store`) и `RidersPublicController` (`riders/:publicId`,
  `/races` — `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`, 404 профиля до разбора курсора). Правила —
  `riders.policy.ts` (`summarize`, `pageRows`). `profile` не импортирует `results`: цикл `results → profile`.
  `riders/:publicId` и `/races` — публичное чтение `riders`; `riders/:publicId/{me,reports}` — модуль `profile`
  (RC-P6 profile-moderation): пути различаются статическим сегментом, guard — на классе своего контроллера.
- **Модерация профиля (profile-moderation)** — всё в `profile` (единственный писатель `profiles`, `profile_avatars`,
  `profile_reports`), новых рёбер графа нет. `RiderReportsController` (`@Controller('riders')`, `AuthGuard`, `no-store`:
  `GET :publicId/me`, `POST :publicId/reports`) → `ProfileReportsService` (лимит `profile-report:<uid>` 20/сут до
  проверок; непубличный и неизвестный — один 404; свой — 409 `PROFILE_INVALID_STATE { reason: 'own_profile' }`; одна
  открытая — повтор и дубль индекса — идемпотентный успех; лог `profile.reported uid=<uid> reason=<code>` без цели,
  `publicId` и комментария). `RiderProfilesModerationController` (`admin/rider-profiles`, `PanelGuard` +
  `profiles.moderate`: очередь, карточка, `avatar-reset`, `club-reset`, `dismiss-reports`) и прежний
  `ProfileAdminController` (`name-reset`) → `ProfileModerationService`: транзакция «условная запись профиля → побочное
  (удаление фото / перевыпуск id) → `closeOpen` жалоб → `PanelAudit.append`», журнал `profile.{name,avatar,club}_reset`
  / `profile.reports_dismissed` с `details.reportCount`, подпись `riderSubjectLabel`; нечего сбрасывать —
  `{ reset: false }` без журнала; устаревший `reportRevision` — 409 `CONFLICT` (RC-P1), открытых нет —
  `{ dismissed: false }` (RC-P2). `AvatarReissue` — перевыпуск id фото при переходе «публичен → нет» в транзакциях
  `PATCH /v1/profile` (`ProfileService.writeProfile`) и сброса имени; публичность — `isPublicProfile` (`profile.policy.ts`).

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
- Удаление аккаунта (ADR-0015) — модуль-оркестратор `account` без своих коллекций: `AccountModule` (HTTP
  `POST /v1/account/delete`: лимит `account-delete:<uid>` 5/ч → `PanelMembership` → `AccountClosure.verifyPassword` →
  транзакция `AccountClosure.close` + `PanelAudit` `account.deleted` + outbox `account.deletion-requested`) и
  `AccountWorkerModule` (очередь `account-deletion`, `AccountErasureProcessor` по имени задачи: событие, sweep,
  регламент `account.erasure-resume`). Зависимости: `account → identity, panel, profile, rides, routes, route-rides, achievements,
  tracks, devices, notifications` только через `index.ts`; `account` не импортирует никто. Порты стирания — `ProfileErasure`
  (`ProfileCoreModule`), `RideErasure` (`RidesCoreModule`), `RouteErasure` (`RoutesCoreModule`), `DeviceErasure`
  (`DevicesCoreModule`), `TrackErasure` (`TracksCoreModule`), `RouteRideErasure` (`RouteRidesCoreModule`, шаг `route-rides` после `tracks`), `AchievementErasure`
  (`AchievementsCoreModule`, шаг `achievements` после `route-rides`),
  `NotificationErasure` (`NotificationsCoreModule`, шаг
  между `tracks` и `identity`), `AccountErasure` (`IdentityErasureModule`); push-токены — `PushTokens.revokeAllOf(tx)`
  в транзакции удаления. Новый модуль с
  данными пользователя — порт стирания и шаг. Строка таблиц удалённого — «Участник» (A3). Финальный провал шага — лог
  `account.erasure_failed user=<uid> step=<s>`, failed-набор BullMQ, регламент; экран в панели — follow-up (F13).

## «Обзор» панели (`overview`, admin-overview)

- Модуль-композиция `overview` (образец `riders`): `GET /v1/admin/overview` — `OverviewController` под `PanelGuard`
  без права на маршруте, блоки режет `OverviewService` по `principal.permissions` (нет права — нет поля). Своих
  коллекций нет; `overview` не импортирует никто, кроме `AppModule` (в `panel` нельзя — цикл).
- Счётчики — порты-классы модулей-владельцев через `index.ts` (только чтение, фильтры очередей разделов):
  `DisputesOverview`, `RacesOverview` (фазы `open`/`closed`, `ownScope`), `ResultsOverview` (чек-лист —
  `ResultsPanelReadService.checks`, поэтому в `ResultsModule`, не в ядре), `RidesOverview`, `RoutesOverview`
  (`countPublicationQueue`), `ProfilesOverview` (`countReportQueue`), `IdentityOverview` (регистрации, зависшие
  удаления — фильтр `pendingSweeps`), `TracksOverview`, `CalendarOverview` (`CalendarCoreModule`). Пределы —
  `overview.policy.ts`. Новый счётчик — метод порта владельца, не чтение чужой коллекции.

## Достижения (`achievements`, ADR-0020 Proposed)

- Модуль-композиция (образец `riders` + `standings`): `achievements → identity, profile, results, rides, route-rides`
  только через `index.ts`; на `achievements` ссылаются только `AppModule` (`AchievementsModule`) и
  `AccountWorkerModule` (`AchievementsCoreModule`, порт стирания). Источники о нём не знают — циклов нет.
  `AchievementsCoreModule` — `AchievementsRepository` + `AchievementErasure` (модулей не импортирует);
  `AchievementsModule` — + `IdentityModule`, `ProfileCoreModule`, `ResultsCoreModule`, `RidesCoreModule`,
  `RouteRidesCoreModule`. Worker-модуля, очередей, outbox и регламента нет.
- Факты — только порты владельцев: `RIDER_RESULTS` (`publishedRows`, `racesOf` — как у `riders`), `RIDER_ROUTE_RIDES`
  (`route-rides`: `passedOf` — `passed` + `ActivitySource.liveActivities` + `RouteRideRoutes.rideableTitles`, та же
  видимость, что у «Заездов по маршруту»; снятый маршрут — факта нет, RC-4), `RIDER_RIDES` (`rides`: `pastOf` —
  условия R8 в `RidesRepository.pastFactsOf`, порядок ↑), `RIDER_PROFILES` (публичность). Пределы портов — 2000 строк
  и лог `achievements.{rides,route_rides}_truncated`. Предикат «в зачёте» — общий `isRankedRow` (`results/index.ts`,
  RC-9: им же считает `riders.policy.summarize`). Копий условий и второго расчёта мест в `achievements` нет.
- Правила и план — чистые функции `achievements.policy.ts`: `ACHIEVEMENT_RULES` (`satisfies Record<AchievementCode,
  …>` — новый код без правила не скомпилируется), `earnedAchievements` (факты по времени ↑, при равенстве — id ↑),
  `raceAchievements` (публичный список — те же правила), `reconcilePlan`, `sortForList` (факт ↓, равенство — каталог
  ↓), `ACHIEVEMENTS_POLICY` (лимиты).
- Сверка — в `GET /v1/achievements` (`AchievementsService.sync`): лимит `achievements-read:<uid>` 60/мин → факты
  параллельно → `reconcilePlan` (insert — первая сверка `seenAt = now`; restore — `seenAt` не трогать; refresh;
  revoke) → по одной условной операции на код без транзакции (вставка — `isDuplicateKey` уникального индекса) →
  **только после выдач** — маркер первой сверки (RC-1) → ответ: перечитанные видимые ∩ заработанные (название и дата —
  из фактов запроса). Лог `achievements.sync uid first granted revoked restored` — только если план не пуст.
  `POST /v1/achievements/seen` — лимит `achievements-seen:<uid>` 120/ч, `updateMany` своих видимых непросмотренных,
  сверку не запускает. Публично — `AchievementsPublicController` (`riders/:publicId/achievements`, `PublicReadGuard`)
  → `publicList`: `findPublic` (нет — 404) → `raceAchievements` → без записи.

## Карточки для сторис (`sharing`, story-cards, ADR-0018)

- Модуль `sharing`: `SharingModule` (`AppModule`: `StoryCardController` — `GET races/:raceId/entry/story-card`,
  `AuthGuard`, `no-store`; `StoryCardImageController` — `GET story-cards/:file`, `IpRateLimitGuard`) и
  `SharingWorkerModule` (`WorkerModule`: очередь `story-card`, `StoryCardProcessor`, `concurrency: 1`). Зависит от
  `results` (порт `RESULTS_FOR_SHARING`: `storyCardFacts` — как «моё участие», `storyCardLine` — `sliceLine` по
  `trackMap.segment` или линия маршрута), `profile` (`RIDER_NAMES`; `RIDER_THEMES` — тема запрашивающего карточку,
  user-theme: владелец заявки для сторис, зритель для приглашения), `identity` — только `index.ts`; на `sharing` не
  ссылается никто.
- Входы — `StoryCardInputs.resolve` (одна реализация для HTTP и worker), ключ — `storyCardHash`; кэш — Redis
  (`StoryCardCache`: `token:<hash>`, `png:<token>`, `pending:<hash>` NX, `failed:<hash>` `GETDEL`). Worker сверяет
  хэш (не совпал — `skipped`). Рендер — чистые `storyCardTree` (satori-узлы, только flex) → `renderStoryCardSvg`
  (шрифты темы по ролям) → `renderStoryCardPng` (resvg). Изменил разметку, тексты или токены карточки — подними
  `STORY_CARD_POLICY.renderVersion`. Превью — `pnpm --filter @pokatim/api preview:story-cards <каталог>`.
- Приглашение кофе-райда: `RideInviteController` (`GET rides/:rideId/invite-card`, `AuthGuard`, `no-store`) →
  `RideInviteService` → `RideInviteInputs` (порт `rides` `RIDES_FOR_SHARING`: `inviteFacts` — скрытый 404, не будущий
  `null`; `inviteLine` — `RideRoutes.catalogLine`, только `IN_CATALOG`) → общий `CardRequests` (лимиты, кэш,
  постановка) → задача `ride-invite.render` той же очереди → `StoryCardProcessor.buildRideInvite` →
  `rideInviteTree` (`ride-invite.render.ts`, узлы и линия — `story-card.render.ts`/`story-card.png.ts`).
  `SharingModule`/`SharingWorkerModule` импортируют `RidesCoreModule`; `rides` о `sharing` не знает.
- Общий код карточки — пакеты: форматтеры `@pokatim/i18n` (`format.ts`), геометрия линии `@pokatim/route-view`
  (`line-geometry.ts`), таблица начертаний `appFontFaces` и токены `storyCard` — `@pokatim/design-tokens`.

## Красные флаги pokatim

Клиентское время в расчёте результата · UPDATE/DELETE аудита и истории споров, переход спора не из `open` ·
биометрия или e-mail в логах · разбор трека или рендер в HTTP-обработчике (перекодирование аватара — исключение
RC-A1, ADR-0019).

## Уровни и группы зачёта (`results`, `profile`, race-results-07)

- Анкета Verified — модуль `profile`: `VerifiedProfileController` (`GET|PUT /v1/profile/verified`, `AuthGuard`),
  `VerifiedProfileService` (лимит, атомарная запись с условием фиксации, подсказка года — `identity.IdentityAccounts.
  birthYearOf`), панель — `ProfileVerifiedAdminController` (`/v1/admin/profiles/:userId/verified-demographics`,
  отдельный класс с `profiles.verified_edit`) → `ProfileVerifiedAdminService` (транзакция: запись анкеты →
  `PanelAudit`). Порт `VERIFIED_PROFILES` (`demographicsOf`, `lockForEntry`) — в `ProfileCoreModule`, `results` читает
  анкету только через него; стирание — `ProfileErasure`.
- Заявка (`EntriesService.enter`, тело `RaceEntryRequest`): `admitEntry` (схема групп) → `lockEntryOf` → чистая
  `planEntryChange` (вся матрица RC-1…RC-3) → для Verified `lockForEntry` анкеты в той же транзакции → вставка или
  `setEntryTier` + `refreshEntry`. Группа и возраст — `ownGroup`/`allowedGroups` (`results.policy.ts`, сервер —
  источник правды); правило мест — `rankRule`, лучший — `pickBest(attempts, rule)`.
- Чтения — по группе заявки: «моё участие» (`verified`, `canUpgrade`, `unranked`), публичная таблица
  `GET /v1/races/:id/results?group` (`groups`, `finishers`), таблица финишёров `GET /v1/races/:id/finishers`
  (`ResultsPublicController`, курсор `f`); протокол — `buildProtocol` по группам (флаг скорости — по строкам
  ревизии), «Участники» панели — тот же `buildProtocol` на живых строках, фильтры `group`/`attention`/`finishers`
  (до предела ответа), `counts.attention`/`finishers`. `SPEED_CLUSTER_HIGH` — `speedClusterFlags`; флаги датчиков — worker
  (`analyzeAttempt` → `sensorFlags`), outbox-событий нет (R4). Споры — `not_ranked` / `target_not_counted` по
  `DisputeEntry.ranked`, флаги цели — в `DisputeStanding`.

## Протокол (`results`, race-results-05)

- Мутации панели — `results-protocol.controller.ts` → `ResultsProtocolService` (транзакция под `lockResults`, журнал
  `PanelAudit.append` и outbox в ней же, лог после коммита — без причины и `userId` райдера); чтения панели —
  `results-admin.controller.ts` → `ResultsPanelReadService`. Чек-лист — одна чистая `publishChecklist` для чтения и
  транзакции публикации, снимок — `buildProtocol`, места — только `rankRows`.
- «Перепроверить треки» в HTTP не перепоставляет попытки: только `recheck_started` + событие
  `results.race-recheck-requested` → `results-intake` → `ResultsRecheck.requestRace` (транзакция на попытку под
  `lockEntry`, идемпотентно по `checkedAt < requestedAt`). Пока есть незавершённые проверки — публикация и
  «Применить пересчёт» отвечают 409.
- `results.protocol-published` / `results.result-revised` / `results.attempt-verdict-changed` — маршрут в
  `notifications-intake` (объявляет подписчик, ADR-0017). Рейтинг сезона (08) событий не слушает — регламент сверки
  (DV-1); fan-out outbox в app-foundation — follow-up.
- Отказы состояния — `409 RESULTS_ACTION_BLOCKED { reason, count? }`, `409 RESULTS_PUBLISH_BLOCKED { blockedBy,
  checklist }`.

## Рейтинг сезона (`standings`, race-results-08)

- Модуль `standings` (`results ──► standings`): `StandingsCoreModule` (репозиторий снимка, `StandingsSource`,
  `StandingsRecalc`; imports `RacesCoreModule`, `ResultsCoreModule`), `StandingsModule` (API: + `IdentityModule`,
  `PanelModule`, `ProfileCoreModule`), `StandingsWorkerModule` (`WorkerModule`). Порты — только через `index.ts`:
  `SEASON_RACES` (`races`: гонки с протоколом, `seasonExists`, `seesAllRaces`), `RESULTS_FOR_STANDINGS` (`results`:
  `currentRevisions` одним `aggregate`, `protocolRows` ревизии), `RIDER_NAMES` (`profile`). `races`/`results` о
  `standings` не знают.
- Правила зачёта — чистые функции `standings.policy.ts` (`pointsForPlace`, `racesCounted`, `selectCounted`,
  `compareRiders`, `buildSeasonStandings`, `sourceFingerprint`), версия `STANDINGS_FORMULA_VERSION` в снимке: смена —
  полный пересчёт всех сезонов. Клиент ничего не считает.
- Пересчёт — **регламент** вместо событий (DV-1): очередь `standings-recalc`, `StandingsSchedules` — `standings.sync`
  каждую минуту (Минск) + разовая `standings.sync.boot` при старте worker; `StandingsRecalc.sync` сверяет отпечаток
  источника сезона (гонки, ревизии, класс, схема, формула) с отпечатком снимка и пересчитывает изменившиеся сезоны
  целиком. Отказ сезона — лог `standings.recompute_failed`, остальные идут; после прохода — исключение
  (`standings.sync_failed`, failed-набор BullMQ), следующий прогон повторяет. Гонка с протоколом без ревизии —
  пропуск с логом `standings.revision_missing`. Сохранённый снимок не старше источника, а отпечаток другой (откат
  деплоя) — пропуск с логом `standings.version_conflict`, без пересчёта. **Изменил вход отпечатка или правила
  зачёта — подними `STANDINGS_FORMULA_VERSION`**, иначе старые снимки не пересчитаются.
- HTTP читает только снимок: `StandingsPublicController` (`seasons/:id/standings`, `/table`), `StandingsMeController`
  (`/me`, `AuthGuard`), `StandingsAdminController` (`admin/seasons/:id/standings`, `/table`, `races.read`) →
  `StandingsReadService`. Таблица, которой нет в снимке, — пустая страница (RC-12); сводка панели — `sync:
  pending|current` тем же `StandingsSource`.

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
- События `disputes.dispute-filed/-withdrawn/-responded/-decided` — маршрут в `notifications-intake` (A11,
  ADR-0017); в событиях только id и коды. Лог после коммита — `disputeId`, `raceId`, действие, исход.
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
  (join и leave); квоты — `409 RIDE_QUOTA_EXCEEDED` с `RideQuotaDetails`. Аудита в 05a нет. События (ADR-0017) — `rides.events.ts`:
  `update`/`cancel`/`join`, отмена при стирании и `act` модерации — та же одна условная операция над документом, но
  в `MongoTransactions` с outbox (`ride-cancelled`, `ride-rescheduled` по смене старта, `participant-joined`,
  `reports-resolved`); повтор и отказ — без события.
- Маршрут райда и «Рядом» (05c): `rides → routes` — только порт `RIDE_ROUTES` (`RideRoutes`: `attachable`, `visible`,
  `publicStartsWithin`, `ownedRouteIds`, `existing`; реализация `RideRoutesService` в `RoutesCoreModule`, без кэша, условия — только `IN_CATALOG` и
  `ownRider` репозитория; `RouteCatalog` не расширяется). `RidesCoreModule` импортирует и реэкспортирует
  `RoutesCoreModule`. Видимость маршрута — `lookupRoutes` + `routeOf` в `rides-feed.service.ts` на каждом чтении и
  ответе мутации (одним вызовом порта на страницу); `private` — только организатору. `GET /v1/rides/map` (статический
  путь до `:id`, `no-store`) — `RidesFeedService.map`; `near` в ленте. Лимит `rides-near:<uid>` 60/мин — лента с
  `near` и карта. Точка «Рядом» и карты — на чтении `ridePointNow` (`rides.policy`): точная — старт маршрута, пока он в
  каталоге, иначе центр города; кандидаты — только по публичным данным (города круга | маршруты каталога со стартом в
  круге, `publicStartsWithin`), отбор после чтения пачками (≤ 5). `RideErasure` сбрасывает точки райдов на маршрутах
  удалённого (`restarted`), шаг `ride-starts` после `routes` — на висячих маршрутах (`resetDanglingStarts`).

## Заезд по маршруту (`route-rides`, route-rides-01)

- Модуль `route-rides` (`route-rides → routes, tracks, identity`; `account → route-rides`) — только через `index.ts`;
  `routes`/`tracks` о нём не знают. `RouteRidesCoreModule` (репозиторий, `RouteRideErasure`; imports `RoutesCoreModule`,
  `TracksCoreModule`), `RouteRidesModule` (HTTP, + `IdentityModule`), `RouteRidesWorkerModule` (очередь
  `route-ride-check`).
- Видимость маршрута — порт `routes` `RouteRideRoutes` (`ROUTE_RIDE_ROUTES`: `rideable`, `matchGeometry`; условие —
  `IN_CATALOG` или `ownRider` в `RoutesRepository.findRideable`, без кэша) на каждой ручке и в worker перед сверкой;
  `RouteCatalog`/`RouteGeometry` не расширяются. Заезды — `ActivitySource` + `liveActivities(userId, ids)` (живые свои
  активности и основная группы одним запросом).
- `RouteRidesController` (`routes/:routeId/rides`, `AuthGuard`, `no-store`; `candidates` до `:rideId`) →
  `RouteRidesService.check` (лимит `route-rides-user:<uid>` 30/ч до всего → видимость → основная группы → существующий
  заезд группы или квота 100 → транзакция { сироты → `insert` → outbox `route-rides.check-requested` }; гонка двух POST
  — `isDuplicateKey` уникального индекса) и `RouteRidesReadService` (фильтр по живым активностям, сравнение —
  `route-rides.policy.ts`).
- Сверка — `RouteRideCheckProcessor` (параллелизм 1): `runParseThread('analyzeAttempt')`, коридор
  `ROUTE_RIDE_POLICY.corridorWidthM` (пишется в документ), окно — время заезда ± 1 мин; итог — одна запись своей
  ревизией без транзакции и событий. Финальная попытка — `failed: error`; dead-letter в панель неприменим (личные
  данные, организатора нет): зависшие (`queued` > 2 ч, `checking` > 15 мин) — «ленивый» `failed: error` при чтении,
  POST перепоставляет (RC-5). Подписки на `tracks.*` нет (outbox — тип в одну очередь, RC-1).

## Уведомления (`notifications`, ADR-0017)

- Источники (`results`, `disputes`, `rides`, `routes`) пишут только outbox в своих транзакциях (payload — id и коды)
  и дают порт чтения через `index.ts`: `ResultsNotices`, `DisputeNotices`, `RideNotices`, `RouteNotices`; плюс `RaceRegistry`,
  `IdentityAccounts.liveUserIds/emailsOf`. Чужих коллекций `notifications` не читает; источники о нём не знают.
- Маршруты объявляет подписчик: `notificationsOutboxRoutes` (12 типов → `notifications-intake`). Очереди:
  `notifications-intake` (событие → получатели → настройки → upsert; > 72 ч — skip; уникальность `(sourceEventId,
  userId)`, схлопывание `collapseKey`), `notifications-delivery` (`notifications.push` по пользователю — захват,
  тумблер, тихие часы, лимит 20/ч, сводка; `notifications.email` — только N2), `notifications-maintenance`
  (`receipts` */15 — `DeviceNotRegistered` снимает токен; `redeliver` */10).
- Текст — снимок сервера (`notification-texts.ts`, не `@pokatim/i18n`); цель — белый список типов. Expo — порт
  `PUSH_SENDER` (`expo-push.sender.ts`, адрес из env, в production — только `exp.host`); `PUSH_ENABLED=false` — push
  `skipped`.
- HTTP `/v1/notifications` под `AuthGuard`, только свои (`userId` сессии в фильтре, чужое — 404); лимиты
  `notifications-read` 120/мин, `notifications-settings` 30/ч, `notifications-push-token` 30/ч → `429 RATE_LIMITED`.
- Web Push (ADR-0022) — второй транспорт того же `notifications.push`, не отдельная система: подписка — `push_tokens`
  (`platform: 'web'`), HTTP `GET web-push` (публичный ключ или `null`), `PUT web-push/subscriptions`, `POST
  web-push/subscriptions/revoke` (лимит `notifications-push-token`). Порт `WEB_PUSH_SENDER` (`web-push.sender.ts`,
  шифрование — `web-push.crypto.ts`, RFC 8291/8292 без пакета `web-push`) — `null`, если `webPushVapid(env)` пуст;
  endpoint — только хосты `isWebPushEndpoint` контракта (SSRF), повторно в адаптере. 404/410 снимают подписку; канал
  выключен (`push_off`), только если выключены оба транспорта (`pushChannelEnabled`). Тесты — фейковый push-сервис
  `test/fake-web-push.ts` (`WEB_PUSH_TEST_ORIGIN`, только `NODE_ENV=test`), тело расшифровывается ключом подписки.
