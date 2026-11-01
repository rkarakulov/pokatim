---
paths:
  - "apps/api/**"
---

# pokatim — backend (дополняет `backend.md`)

Доменные правила pokatim поверх общего правила шаблона. Процесс — скил `app-dev-kit:backend-nest`.

## Модули и reuse

- Контексты `src/modules/<context>/`: identity, profile, routes, rides, calendar, races, results, disputes,
  seasons, gamification, sharing, notifications, moderation, media (по мере появления).
  Есть: `identity` (учётка, сессии, `AuthGuard`; P7 — активный день `ActiveDay`, единственное ребро к другому модулю —
  лист `product-events`), `profile` (онбординг: опрос, коллекция `profiles`; `GET /v1/profile` — ответы опроса своего
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
- Порт `ROUTES_FOR_SOCIAL.respectTarget` («Свои» P4, `RoutesCoreModule`): `findInCatalog` (`IN_CATALOG`) +
  `origin: 'rider'` → `{ routeId, authorUserId }`; маршрут команды, заявка, скрытый — `null`. Копии `IN_CATALOG` вне
  `routes` нет.
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
  `routes/:id/{gpx,kml,tcx}` (общий `sendExport`) — `IpRateLimitGuard` +
  `@IpRateLimit('route-gpx', ROUTE_POLICY.exportIpLimit)` после класс-гарда,
  байты `route_exports`, заголовки файла через `HttpAdapterHost` после чтения (Nest пишет `@Header` до обработчика —
  404 с типом файла не сериализовался бы). Сжатие (route-exports-gzip): `@Headers('accept-encoding')` →
  `acceptsGzip` (`routes.policy.ts`) → `RoutesPublicService.exportFile(id, format, acceptGzip)`: хранится gzip и клиент
  принимает — байты как есть + `Content-Encoding: gzip`; не принимает — `gunzip` ≤ `ROUTE_POLICY.exportMaxBytes`
  (распаковка своих данных, не разбор и не сборка; сбой — лог `routeId`/формат/класс ошибки, 500); старый несжатый
  документ — как есть. `Vary: Accept-Encoding` — у каждого 200. Глобального `@fastify/compress` нет. Общий IP-лимит метода — `consumeIpLimit`/`IpRateLimitGuard` в
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
  `RoutesService.accept({ userId, origin }, …)`: формат — `detectRouteFormat` (GPX/KML/KMZ/TCX; панель — API и UI,
  `.gpx,.kml,.kmz,.tcx`), журнал панели — только `platform`, outbox `routes.route-received` и worker `route-processing` —
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
- 2FA панели (ADR-0024): всё — модуль `panel` (`totp.ts`, `recovery-codes.ts`, `totp-secret-box.ts` — чистые
  функции и ключ; `PanelTotpCodes` — лимиты и проверка кода; `PanelSessionService` — вызов второго шага;
  `PanelAccountTotpController` `admin/account/totp` — `PanelGuard` без `@RequirePermission`, свой аккаунт любой роли;
  сброс — `PanelMembersService.resetTotp`/`resetTotpFromCli`). Новые `@Public()` — только шаги входа с вызовом
  и вход паролем по приглашению `POST admin/invitations/accept` (ADR-0026; `admin-routes.test.ts` перечисляет их явно).
- Приглашения панели (ADR-0026): всё — модуль `panel`. `PanelInvitationsController` (`admin/invitations`: `GET` —
  `members.read`, `POST` и `:id/revoke` — `members.manage`, `accept` — `@Public` + IP-лимит) → `PanelInvitationsService`
  / `PanelInvitationAccept` (снимок по токену и сверка с текущим секретом до пароля → `PanelCredentials.verify` →
  e-mail аккаунта = адрес → транзакция `lockAccountState` → `lockAdmins` → `lockPending` → `lockMember` → журнал →
  `PanelSessionService.continueAfterCredentials`; второй проверки пароля и копии 2FA нет). Письма — outbox
  `panel.invitation-email-requested { invitationId }` и `panel.role-email-requested { auditId }` (выдача, смена,
  снятие роли и CLI `grant-admin` — в транзакции действия) → очередь `panel-email` (`PanelWorkerModule`); база
  ссылок — `panelLinkBase()` (`PANEL_LINK_BASE` или `${APP_WEB_ORIGIN}/admin/`).
- Код, нужный ≥2 приложениям (разбор трека для pre-check в приложении и на сервере), — в `packages/tracks`
  (`@pokatim/tracks`): парсинг GPX/TCX/FIT/KML и геометрия; дубли разбора в модулях запрещены.

## Авторитет сервера и история

- Результаты, места, кластеры считает только сервер; входящие от клиента значения времени игнорируются.
- Append-only (только INSERT): история споров (`dispute_events`), исключения треков, пересчёты, модерация, решения
  организатора. Проекция `disputes` — переходы только из `open` (`pokatim-db.md`, «Споры»).

## Профиль райдера (`profile`, `riders`, rider-profile)

- `profile`: клуб и `publicId` — `PATCH /v1/profile` (`club`), аватар — `ProfileAvatarsController`
  (`@Controller('profile/avatar')`, `AuthGuard`: `PUT` сырыми байтами — query `AvatarCropQuery` до слота и тела,
  `ProfileAvatarService.admit` (лимит `profile-avatar:<uid>` 20/ч, общие `ImageUploadSlots` чтения 4/1 — слот до лимита) → `readLimited` 10 МиБ (таймауты 10/60 с) → место обработки
  `ImageProcessing` (`modules/media`, 1 на процесс на все фото, ожидание ≤ 5 с, иначе 429) →
  `processAvatar`; `POST delete` — лимит `profile-update`), отдача — `AvatarsPublicController` (`avatars/:id`,
  `PublicReadGuard`, заголовки через `HttpAdapterHost` после чтения). Порт `RIDER_PROFILES`
  (`RiderProfileDirectory.findPublic`) — в `ProfileCoreModule`.
- **Исключение RC-A1 (ADR-0019):** перекодирование аватара `sharp` (`avatar-image.ts`) — в HTTP-обработчике: вход
  ≤ 10 МиБ, JPEG/WebP ≤ 100 Мп (две стадии: shrink-on-load до 2048 px, затем квадрат), PNG ≤ 25 Мп, `failOn: 'error'`,
  `timeout` 10 с, 1 обработка на процесс (память — ADR-0019), пул libvips вне event loop. «Рендер в HTTP-обработчике»
  красных флагов — Skia, ffmpeg, OG; другие изображения — только по этому образцу и с ADR. Фото организатора райда
  (ADR-0028) — тот же конвейер `modules/media` (`processCover`: поворот + вписать в 1600 px, одна стадия).
- **`media` (ADR-0028)** — инфраструктурный модуль-лист `modules/media` (правило `media-leaf`): `detectImageFormat`,
  `inspectImage`, `decodeOriented`, `processCover`, `replyJpeg`, `MEDIA_POLICY`; настройки sharp — только
  `image-pipeline.ts`. `MediaModule` (не `@Global`, провайдеры `ImageProcessing` и `ImageUploadSlots`) импортируют
  `ProfileModule` и `RidesModule` — один экземпляр гейта и слотов на процесс; `ProfileModule`/`RidesModule` их не
  объявляют. Worker — только чистые функции (`sharing`, рендер 4a). Хранение, права и модерация фото — у модуля-владельца
  (`profile_avatars` — `profile`, `ride_photos` — `rides`).
- Истории своего профиля — в модулях-владельцах: `results` — `ProfileRacesController` (`profile/races`) →
  `ResultsHistoryService` (`entriesOfUserPage` + `ResultsReadService.entryResult` в одной snapshot-сессии, места не
  дублируются); `rides` — `ProfileRidesController` (`profile/rides`) → `RidesHistoryService` (`pastOf`,
  `rides_participant_idx`). Пути `/v1/profile/{avatar,races,rides,stats}` — статические сегменты, у
  `ProfileController` только `GET /`, `PATCH /` и `PUT theme` (user-theme).
- `riders` — модуль-композиция (образец `standings`, своих коллекций нет): `riders → profile, results, tracks,
  identity` только через `index.ts`; `riders` импортируют только `AppModule` и `sharing` (`RidersCoreModule`, порт
  `RIDERS_FOR_SHARING` — публичная статистика для OG райдера, та же `summarize`). Порты: `RIDER_PROFILES`
  (`profile`), `RIDER_RESULTS` (`results`: `publishedRows` — строки текущих ревизий, `racesOf`), `ACTIVITY_TOTALS`
  (`tracks`, отдельный порт — `ActivitySource` не расширяется; реэкспорт через `ResultsCoreModule`). HTTP:
  `ProfileStatsController` (`profile/stats`, `AuthGuard`, `no-store`) и `RidersPublicController` (`riders/:publicId`,
  `/races` — `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`, 404 профиля до разбора курсора). Правила —
  `riders.policy.ts` (`summarize`, `pageRows`). `profile` не импортирует `results`: цикл `results → profile`.
  `riders/:publicId` и `/races` — публичное чтение `riders`; `riders/:publicId/{me,reports}` — модуль `profile`
  (RC-P6 profile-moderation), `riders/:publicId/social*` — модуль `social` (P3): пути различаются статическим
  сегментом, guard — на классе своего контроллера.
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
  Follow-up (profile-moderation-followups): очередь `?reason=` (одна причина), строка — `openReasons`; сброс с
  `{ reset: true }` пишет в той же транзакции после журнала outbox `profile.field-reset` (`profile.events.ts`, строгая
  схема `ProfileFieldReset`: `userId`, `field`, `resetAt`, `seq`, `avatarBlockedUntil` — только если запрет включил этот
  сброс; без причины и значения). Запрет загрузки фото — `PROFILE_POLICY.avatarBan` (3 сброса за 180 дн. → 30 дн.,
  `[ASSUMPTION]`), `ProfileAvatarService.admit` — `409 PROFILE_INVALID_STATE { reason: 'avatar_blocked', until }`;
  `POST admin/rider-profiles/:userId/avatar-unblock` — журнал `profile.avatar_unblocked`, нет запрета —
  `{ unblocked: false }` без журнала и события. `ProfileView.avatarUploadBlockedUntil` — `profileViewOf(doc, now)` во
  всех ответах профиля.

## Очереди (worker)

- **Outbox: маршруты** (api-kit ≥ 0.6.0, fan-out): подписчик объявляет `<модуль>OutboxRoutes` (тип → очередь), composition
  root `worker.module.ts` объединяет их **только** `mergeOutboxRoutes(...)` (`@rkarakulov/api-kit/core`, сборка —
  `src/outbox-routes.ts`): тип у нескольких подписчиков — задача в каждой очереди, jobId = id события в каждой. Spread
  `{ ...a, ...b }` молча оставил бы последнего подписчика (сторож — `outbox-routes.test.ts`). Обработчик идемпотентен:
  повтор публикации после частичного сбоя ставит задачу в очереди, где её ещё нет. `tracks.activity-ready` — `results-intake` +
  `social-intake` (автоявка, P5); `tracks.activity-removed` — `results-intake` + `route-rides-intake`.

- Брокер — BullMQ на Redis; RabbitMQ не используем (переход — только через ADR; outbox оставляет к нему путь).
- Регламенты «по курсору» без событий: `og-sync`, `tickets-maintenance`,
  `achievements-sync` (achievements-push N2: `achievements.sweep` → `achievements.rider`); новый источник курсора —
  метод порта владельца с keyset `changed-since.ts`, не чтение чужой коллекции.
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
  загрузки, исходник для worker). События `tracks.activity-ready/-removed` — свои типы подписчика (до api-kit 0.6.0
  outbox вёл тип в одну очередь; теперь — fan-out, раздел «Outbox: маршруты»). Сверка — `runParseThread('analyzeAttempt')` в worker; потоки разбора на процесс
  ограничены семафором `PARSE_THREADS_MAX` (`src/parse-thread.ts`).
- Сверка заезда с коридором гонки — `matchCorridor` / `analyzeAttempt` из `@pokatim/tracks/parse` (ADR-0012 п. 5):
  только worker (`worker_threads`), по исходнику без прореживания; `engineVersion` пишется в попытку, смена версии
  не пересчитывает результаты молча. Лёгкий вход `@pokatim/tracks` движок не экспортирует.
- Разметка схода на карте участника (maps-02, ADR-0012 «Разметка схода»): считает worker при сверке, не чтение и не
  клиент. `matchCorridorDetailed` = `matchCorridor` + интервалы схода выбранного сегмента по времени трека (один
  повторный проход `offCorridor`; golden и `CORRIDOR_ENGINE_VERSION` не меняются); `analyzeAttempt(…, line)`
  получает **сохранённую** линию показа активности (порт `ActivitySource.trackLine`) и `trackMapOf` переводит
  интервалы в позиции на ней (дробный индекс вершины): время → путь по исходнику (точки со временем, бинарный поиск;
  путь — haversine по всем точкам) → отрезок линии. Линия в потоке не пересчитывается — позиции по той же линии, что
  у активности. Точность: поперёк — допуск упрощения (5 м; при удвоении допуска до 1000 точек —
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
  tickets, tracks, devices, notifications, social, product-events` только через `index.ts`; `account` не импортирует никто. Порты стирания — `ProfileErasure`
  (`ProfileCoreModule`), `RideErasure` (`RidesCoreModule`), `RouteErasure` (`RoutesCoreModule`), `DeviceErasure`
  (`DevicesCoreModule`), `TrackErasure` (`TracksCoreModule`), `RouteRideErasure` (`RouteRidesCoreModule`, шаг `route-rides` после `tracks`), `AchievementErasure`
  (`AchievementsCoreModule`, шаг `achievements` после `route-rides`), `TicketErasure` (`TicketsCoreModule`, шаг
  `tickets` после `achievements`), `SocialErasure` (`SocialCoreModule`, шаг `social` после `tickets`),
  `ProductEventErasure` (`ProductEventsCoreModule`, шаг `product-events` после `social`, перед `notifications`),
  `NotificationErasure` (`NotificationsCoreModule`, шаг
  между `tracks` и `identity`), `AccountErasure` (`IdentityErasureModule`); push-токены — `PushTokens.revokeAllOf(tx)`
  в транзакции удаления. Новый модуль с
  данными пользователя — порт стирания и шаг. Строка таблиц удалённого — «Участник», в таблице гонки — «Райдер #N» (A3, name-consent-prompt N7). Финальный провал шага — лог
  `account.erasure_failed user=<uid> step=<s>`, failed-набор BullMQ, регламент; экран в панели — «Сбои удаления аккаунтов» (ниже).

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

## Сбои удаления аккаунтов (erasure-failures)

- Провал шага очистки (`AccountErasureService.step`, каждая попытка) — `AccountErasure.recordFailure`: в `users`
  удалённого `erasureLastFailure { step, code, at }` и `$inc erasureFailedAttempts`; код — `erasureErrorCode`
  (строковый `code`, числовой код драйвера или имя класса), текст ошибки не хранится (может нести e-mail). Сбой
  записи не подменяет исходную ошибку.
- Панель — `account/account-erasures-admin.*` (`GET /v1/admin/account-erasures`, `POST …/:userId/retry`,
  `platform.stats`); чтение и захват повтора — порт `ErasureFailures` (identity, `IdentityAccountsModule`), порог
  `ERASURE_STUCK_MS` — общий с карточкой «Обзора». Повтор — транзакция: `claimRetry` (условный `updateOne`:
  зависло, не завершено, прошлый повтор старше `ERASURE_RETRY_COOLDOWN_MS` или после него был сбой) → журнал
  `account.erasure_retried` → outbox `account.erasure-retry-requested` → процессор `account-deletion`, проход
  `sweep`. Недавний повтор — `{ queued: false }`; нет удалённого — 404; завершено или не зависло — 409.

## Билеты (`tickets`, event-tickets, ADR-0023 Proposed)

- Модуль-потребитель: `tickets → results` (`ResultsCoreModule`: порт `RESULTS_FOR_TICKETS` — `entryOf`,
  `entriesPage`, `lockEntryForTicket` (замок заявки в транзакции check-in); реэкспорт `RacesCoreModule` — `RACE_REGISTRY.get/getMany`), `calendar` (`CalendarCoreModule`: порт
  `CALENDAR_EVENTS` — `get`, `getMany`), `profile` (`RIDER_NAMES.attributionNames`), `identity`
  (`IdentityAccounts.liveUserIds/emailsOf`, `AuthGuard`), `panel` — только через `index.ts`. На `tickets` ссылаются
  только `AppModule` (`TicketsModule`), `WorkerModule` (`TicketsWorkerModule`, `ticketsOutboxRoutes`) и
  `AccountWorkerModule` (`TicketsCoreModule`, порт `TicketErasure`, шаг `tickets` перед `notifications`) и
  `NotificationsWorkerModule` (`TicketsCoreModule`, порт `TICKET_NOTICES`, PR D).
- `TicketsCoreModule` — репозиторий, `TicketEvents` (факты событий: гонка — `RACE_REGISTRY` + настройки, календарь —
  `CALENDAR_EVENTS`, момент старта вычисляется `calendarMoments`, RC-T2), `TicketIssuer` (код, `qrHash`, outbox
  `tickets.issued`; дубль кода — новая транзакция ≤ 3), `RaceTickets` (сверка), `TicketErasure`. Правила —
  чистые функции `tickets.policy.ts` (`ticketStatus`, `checkInWindow`, `isPast`, `canIssue`, `raceReconcilePlan`,
  `registrationGate`, `eventAccess`, `maskEmail`, `TICKETS_POLICY`).
- Регламент сверки: гонки со стартом позже `now − 61 сут`; выпуск — пока открыто окно check-in, отмены и смена группы —
  пока открыто окно гонки + сутки.
- Билет гонки — **сверкой** (`results` о билетах не знает; подписки на `results.*` нет): лениво в
  `GET /v1/races/:raceId/ticket` и регламентом `tickets.reconcile` (`* * * * *` Минск + `tickets.reconcile.boot`,
  очередь `tickets-maintenance`); `RaceTickets.refresh` перед показом и check-in отменяет билет снятой заявки. Дубль
  выпуска — `isDuplicateKey(…, 'tickets_registration_unique')`.
- Check-in — транзакция с замками: `RACE_REGISTRY.lockResults` (гонка, конфликт с отменой; `status: 'published'`),
  `lockTicketing` (настройки, конфликт с выключением и переносом; окно check-in
  пересчитывается по ним и `CLOCK` в каждой попытке), `CALENDAR_EVENTS.lockForAdmission` (старт календаря — им же
  захватывают старт регистрация и её отмена: снятие, перенос, дистанции конфликтуют), `lockEntryForTicket` (гонка,
  конфликт с отменой участия) / `lockRegistration` (календарь, конфликт с отменой регистрации), затем `markCheckedIn`;
  проверки вне транзакции — только для ответа. Отмена регистрации отмеченного — `409 EVENT_REGISTRATION_CLOSED
  { reason: 'checked_in' }` (проверка в транзакции отмены). Письмо: любой сбой после захвата снимает захват; чужой
  живой захват — `moveToDelayed` до его конца.
- Регистрация календаря — транзакция: **первой** `reserveSeat` (условный `$inc registeredCount` документа
  настроек), затем регистрация и билет; дубль активной — `event_registrations_active_unique` → 200 с ней.
- QR — `ticket-qr.ts` (HMAC `EMAIL_TOKEN_SECRET`, `ticket-qr:<id>`, в БД `sha256`), не `identity.LinkPurpose`.
- HTTP: `RaceTicketController`, `CalendarRegistrationController`, `TicketsController` (`AuthGuard`, `no-store`, чужое
  — 404), `TicketingPublicController` (`events/:kind/:eventId/ticketing`, `PublicReadGuard`),
  `TicketingAdminController` (`admin/events/:kind/:eventId/{ticketing,tickets}`, `PanelGuard`; право по `kind` —
  `eventAccess` в сервисе, участники — `@RequirePermission('tickets.checkin')`), `CheckInController`
  (`admin/tickets/{lookup,check-in}`, `tickets.checkin`). Журнал — `tickets.settings_updated`, `tickets.checked_in`
  (`details.ticketCode`). Лимиты — `tickets-read:<uid>` 120/мин, `tickets-register:<uid>` 20/ч,
  `tickets-checkin:<сессия панели>` 120/мин; общий `consumeUserLimit` — `src/user-limit.ts`.
- Письмо — очередь `tickets-email` (`TicketEmailHandler`, захват `email.state`, RC-T11), шаблон
  `mail/ticket-email.ts` (`htmlEmail`/`buttonHtml`/`escapeHtml`/`minskDateTime` из `identity`), кнопка — env
  `APP_WEB_ORIGIN`.
- Напоминания (PR D, ADR-0023 п. 12): правила — `event_ticketing.reminders[]` (≤ 3, `id` стабилен, `armedAt`), правка —
  `PUT …/ticketing` (нет поля `reminders` — не трогать), правила — `reminders.policy.ts` (`dueReminders`,
  `nextReminders`, `reminderView`). Регламент `tickets.reminders` (`* * * * *` Минск + `tickets.reminders.boot`,
  очередь `tickets-maintenance`) — `TicketReminders.dispatchDue`: гонке сначала `RaceTickets.reconcileRace` (вне
  транзакции); на правило — транзакция: календарю первой `CALENDAR_EVENTS.lockForAdmission` и сверка старта, затем
  захват `claimReminderDispatch` (условный `$push` в `reminderDispatches` по `(reminderId, dueAt)`, гонке — и по
  `startsAt`; 0 — уже отправлено или старт перенесён), метки `remindersSent` билетам (`status: active`,
  `createdAt ≤ dueAt`, `$ne reminderId`), outbox `tickets.reminder-due`. Пропущенное уходит, пока событие не
  началось; правило, заданное после своего времени, — нет. Получателей отдаёт порт `TICKET_NOTICES`
  (`TicketNoticesService.reminder`: билеты с меткой отправки, гонке — только активные заявки `RESULTS_FOR_TICKETS`).
- Доступ панели к событию — один класс `PanelEvents.resolve(principal, kind, eventId, purpose)` (403 до чтения, нет
  или чужое — 404); его зовут `TicketingAdminService` и `MaterialsAdminService`, второй проверки нет.
- Материалы (PR C): `MaterialsRepository` — единственный писатель `event_materials`/`event_material_files`/
  `event_material_locks`, фильтры всегда с `kind, eventId`; мутации набора — под `lockEvent` (первая операция); `MaterialsAdminService` (CRUD, `PUT …/materials/order`, `POST …/materials/:id/delete`,
  загрузка `POST …/materials/files` — до тела: доступ → лимит `tickets-material-upload:<uid>` 30/ч → счётчики →
  `readLimited` 10 МиБ → сигнатура `%PDF-` → транзакция; журнал `tickets.material_*`); `MaterialsRead` (публичный
  список `events/:kind/:eventId/materials`, `TicketView.materials`, письмо); `EventFilesController`
  (`event-files/:id`, `PublicReadGuard` + `@IpRateLimit('event-file', 60/ч)`, заголовки после чтения). Правила
  содержимого — `materialContentIssues` контрактов; политика файла — `materials.policy.ts`.

## Достижения (`achievements`, ADR-0020 Proposed)

- Модуль-композиция (образец `riders` + `standings`): `achievements → identity, profile, results, rides, route-rides,
  standings, panel` только через `index.ts` (`panel` — achievements-panel, `panel` об `achievements` не знает) (`standings` — порт `RIDER_SEASON_STANDINGS`, `StandingsCoreModule` импортируют
  `AchievementsReadModule` (право и название сезонной карточки, achievement-season-story-card), `AchievementsSyncModule`
  и `AchievementsWorkerModule`; `sharing` его напрямую не получает — только через `AchievementsReadModule`); на `achievements` ссылаются только `AppModule` (`AchievementsModule`), `WorkerModule` (`AchievementsWorkerModule`, N2),
  `AccountWorkerModule` (`AchievementsCoreModule`, порт стирания), `sharing` (`AchievementsReadModule`, порт
  `ACHIEVEMENTS_FOR_SHARING`) и `NotificationsWorkerModule` (`AchievementsSyncModule`, порт `ACHIEVEMENT_NOTICES`,
  achievements-push). Источники и `notifications` о нём не знают в обратную сторону — циклов нет.
  `AchievementsCoreModule` — `AchievementsRepository` + `AchievementErasure` (модулей не импортирует);
  `AchievementsReadModule` — `AchievementFactsReader` (факты портов + правила, только чтение) и порт карточки
  (`ResultsCoreModule`, `RidesCoreModule`, `RouteRidesCoreModule`, `StandingsCoreModule`, `AchievementsCoreModule`);
  `AchievementsSyncModule` (achievements-push) — `AchievementsReconciler` и порт `ACHIEVEMENT_NOTICES`
  (`AchievementsCoreModule`, `AchievementsReadModule`, `StandingsCoreModule`; транзакции и outbox — глобальные модули
  базы); `AchievementsModule` — + `IdentityModule`, `ProfileCoreModule`, `ResultsCoreModule`, `AchievementsReadModule`,
  `AchievementsSyncModule`, а для панели (achievements-panel) — `PanelModule`, `IdentityAccountsModule`,
  `StandingsCoreModule`. `AchievementsWorkerModule` (`WorkerModule`, achievements-push N2) — серверная сверка:
  очередь `achievements-sync`, `AchievementsSchedules` (`achievements.sweep` `* * * * *` Минск +
  `achievements.sweep.boot`), `AchievementsSweep` (курсоры Redis `achievements:cursor:<source>` и замок-аренда прогона —
  `AchievementsSyncState`: `extend` своим токеном перед каждым шагом, `setCursors` — проверка токена и запись одним
  Lua, потеря аренды — `achievements.sweep_lease_lost` без записи курсоров; источники — по одному методу портов
  владельцев: `RIDER_RESULTS.revisedRidersAfter` (получатели страницы — один запрос `$or` по `(raceId, revision)`),
  `RIDER_RIDES.startedRidersAfter` (`until = now − rideSettleMs`), `RIDER_ROUTE_RIDES.passedRidersAfter` (по
  `updatedAt` — моменту записи итога), `RIDER_SEASON_STANDINGS.settledRidersAfter` (событие — `max(computedAt,
  endsBefore, SEASON_RACES.lastCancelledAt)`); окно и страница — `changed-since.ts` (`changedWithin`, `RiderChanges`),
  пределы — `ACHIEVEMENTS_SERVER_SYNC`; только `IdentityAccounts.liveUserIds` ∩ `syncedAmong`; курсоры — после
  постановки; сбой источника — лог `achievements.sweep_source_failed`, курсор стоит, прогон падает) →
  `achievements.rider` (`AchievementsSyncProcessor`, `concurrency: 4`, 3 попытки, последняя — лог
  `achievements.server_sync_failed`) → `reconcile(uid, 'server')`. Imports: `AchievementsSyncModule`,
  `AchievementsCoreModule`, `IdentityAccountsModule`, `ResultsCoreModule`, `RidesCoreModule`, `RouteRidesCoreModule`,
  `StandingsCoreModule`. Условия «прошёл»/«засчитан» — только в репозиториях владельцев (рядом с `pastFactsOf`/`passedOf`).
- Факты — только порты владельцев: `RIDER_RESULTS` (`publishedRows`, `racesOf` — как у `riders`), `RIDER_ROUTE_RIDES`
  (`route-rides`: `passedOf` — `passed` + `ActivitySource.liveActivities` + `RouteRideRoutes.rideableTitles`, та же
  видимость, что у «Заездов по маршруту»; снятый маршрут — факта нет, RC-4), `RIDER_RIDES` (`rides`: `pastOf` —
  условия R8 в `RidesRepository.pastFactsOf`, порядок ↑), `RIDER_PROFILES` (публичность). Пределы портов — 2000 строк
  и лог `achievements.{rides,route_rides}_truncated`. Предикат «в зачёте» — общий `isRankedRow` (`results/index.ts`,
  RC-9: им же считает `riders.policy.summarize`). Копий условий и второго расчёта мест в `achievements` нет.
- Правила и план — чистые функции `achievements.policy.ts`: `ACHIEVEMENT_RULES` (`satisfies Record<FactAchievementCode,
  …>` — новый несезонный код без правила не скомпилируется; сезонные — `SEASONAL_RULES`), `evaluateAchievements` (одна сортировка фактов: по времени ↑, при
  равенстве — id ↑ → `earned` + `progress`), `earnedAchievements` (= `.earned`), `raceAchievements` (публичный список —
  те же правила, с уровнем `races_5`), `reconcilePlan`, `sortForList` (факт ↓, равенство — каталог ↓),
  `ACHIEVEMENTS_POLICY` (лимиты). Уровни: пороги — только `ACHIEVEMENT_LEVEL_TARGETS` из контрактов (своих констант
  нет); `LEVELED_FACTS` — источник счёта счётного кода для правила и прогресса (второго счёта нет); правило — наибольший
  ранг, объект и дата — факт порога; `Earned.level` (ранг, разовые — `null`), `levelName` (ранг → строка),
  `storedRank`, `isSeen(grant, level)` (`seenAt != null && seenLevel >= level`, `null` ≡ 1); `refresh` — и при
  другом ранге.
- Сверка — `AchievementsReconciler.reconcile(userId, origin)` (`'read'` — `GET /v1/achievements`, `'server'` — worker
  PR N2); `AchievementsService.sync` — лимит `achievements-read:<uid>` 60/мин и сборка ответа поверх итога сверки. Факты
  параллельно → `reconcilePlan` (insert — первая сверка `seenAt = now`; restore — `seenAt` не трогать; refresh;
  revoke) → по одной условной операции на код; шаги, которые могут дать уведомление (achievements-push: вставка не в
  первой сверке, `refresh`/`restore` несезонной, сезонная вставка не в первой сверке), — `MongoTransactions.run` с
  outbox `achievements.grant-noticed` (`achievements.events.ts`: `{ grant, grantId, level, origin }`): вставка —
  `insert*InTx` + `append`, дубль уникального индекса — `isDuplicateKey` **снаружи** `run` (внутри колбэка не ловить);
  `refresh`/`restore` — `restoreOrRefresh` (`findOneAndUpdate` pipeline, `returnDocument: 'before'`, `notifiedLevel =
  $max(...)`) первой операцией, событие — если `noticeDue(before, level)`. Первая сверка, отзывы, сезонный `restore`,
  маркер — без транзакции (вставка первой сверки — `isDuplicateKey` в репозитории) →
  **только после выдач** — маркер первой сверки (RC-1) → ответ: перечитанные видимые ∩ заработанные (название и дата —
  из фактов запроса; `level` — из фактов запроса, `seen` — `isSeen` по уровню ответа, не сохранённому, RC-L10;
  `progress` — из той же `Evaluation`). Лог `achievements.sync uid first granted revoked restored refreshed … origin
  noticed` — только если план не пуст. Порт `ACHIEVEMENT_NOTICES` (`achievement-notices.ts`): выдача по `_id`
  (`findGrant`; нет — `gone`; отозвана, ранг ниже события, код не заработан по фактам — `state`), название — `evaluate`
  + `titled`; сезонная — `RIDER_SEASON_STANDINGS.outcomesOf` + `seasonalAchievements`: ключ не заработан по
  `final`-исходу или сезон `pending` — `state` (без ложного «Новое достижение»), название — из исхода. `POST /v1/achievements/seen` — лимит `achievements-seen:<uid>` 120/ч, `updateMany` pipeline своих
  видимых с непоказанным уровнем (`seenLevel = max(seenLevel, level)` из документа), сверку не запускает. Публично — `AchievementsPublicController` (`riders/:publicId/achievements`, `PublicReadGuard`)
  → `publicList`: `findPublic` (нет — 404) → `raceAchievements` + сезонные по `final` → без записи.
- Ручные решения (achievements-panel, ADR-0020 «Дополнение: ручные решения»): `AchievementsAdminController`
  (`admin/rider-achievements`, `PanelGuard` + `achievements.manage`: `GET :userId`, `POST :userId/{grant,revoke,clear}`)
  → `AchievementsPanelService`: лимит `achievements-panel:<actor>` 60/ч (`consumeUserLimit`) → `IdentityAccounts
  .liveUserIds` (404) → (выдача) объект вне транзакции → `MongoTransactions.run` { запись выдачи **первой** (замок) →
  (выдача) outbox `achievements.grant-noticed` `origin: 'server'` → `PanelAudit.append` } → дубль индекса снаружи `run`
  (409 `ACHIEVEMENT_INVALID_STATE`); снятие → после коммита `reconcile(userId, 'server')` при маркере первой сверки
  (сбой — `reconciled: false`, лог `achievements.override_reconcile_failed`). Лог `achievements.manual action by
  outcome`. Объекты несезонных — `AchievementObjects` (`AchievementsReadModule`: `resolve` — годность и дата, `titles` —
  названия пачкой; порты `RIDER_RESULTS.racesOf`, `RIDER_ROUTE_RIDES.routeTitles`, `RIDER_RIDES.ridesOf`), сезон —
  `RIDER_SEASON_STANDINGS.outcomesOf` (`pending` тоже, с `endsBefore`); вид — `ACHIEVEMENT_OBJECT_KIND_BY_CODE`.
  Политика: планы пропускают код/ключ с `override`, `adminStatus`, `progressBeyondManual` (RC-9). Ответы: `sync` —
  фактовые видимые ∩ факты + ручные из документа (нет названия — лог `achievements.manual_object_missing`), сезонная
  ручная — при любом исходе; `publicList` — `overridesOf` (ручной отзыв убирает, ручная `race_*`/`season_*`
  добавляет); `cardFacts` — ручная из документа; `ACHIEVEMENT_NOTICES` — ручная без перепроверки фактами.
- Сезонные (achievements-seasonal, ADR-0020 «Дополнение: сезонные»): факты — порт `RIDER_SEASON_STANDINGS.outcomesOf
  (userId, alsoSeasonIds, now)` (`standings/rider-season-standings.ts`, `StandingsCoreModule`): `SEASON_RACES
  .finishedSeasons(now)` → одна snapshot-сессия `rowsOfUserIn` + `headersOf` (нужные сезоны — строк ∪ сохранённых
  выдач) → `SEASON_RACES.awaitingProtocol` и `StandingsSource.load(seasonIds)`; `final` ⇔ нет гонки с коридором без
  протокола (RC-S2) и отпечаток снимка = источнику, иначе `pending`. `SeasonRaces.protocolRaces(seasonIds?)` и
  `StandingsSource.load(seasonIds?)` принимают набор сезонов (регламент — без аргумента, сводка панели — `[id]`).
  Политика: `FACT_ACHIEVEMENT_CODES`/`FactAchievementCode` (несезонные — `ACHIEVEMENT_RULES`, `evaluateAchievements`,
  `reconcilePlan` обходят только их, RC-S7), `SEASONAL_RULES` (`placedRaces ≥ 1` у «Чемпиона» и «Призёра», RC-S1;
  `≥ SEASON_REGULAR_MIN_RACES` ячеек `placed` в одной таблице, RC-S3), `seasonalAchievements` (`earned` по ключу
  `code:seasonId`, `factAt = endsBefore − 1 мс`; `settled` — `final`-сезоны), `seasonalPlan` (insert/restore/revoke
  только по `settled`; `refresh` нет). `sync`: оба плана → маркер после обоих → ответ: сезонные — видимые ∩
  заработанные (`final`), в `pending` — видимая остаётся с названием из исхода. Лог — счётчики `seasonal_*`. Карточка
  (achievement-season-story-card): `cardFacts(userId, { code, seasonId })` — выдача `listSeasonalOf` не отозвана, исход —
  `RIDER_SEASON_STANDINGS.outcomesOf(userId, [seasonId])` **напрямую** (сбой — исключение: HTTP 500, worker — ретрай;
  не 409, RC-5); ручная (`manuallyGranted`, `achievements.policy.ts` — одна для списка, публичного и карточки) — при
  любом исходе, иначе только `final` и `seasonalAchievements([outcome]).earned`; `pending` без ручной — `null` (409,
  RC-2; список её показывает). Ответ — как сезонный элемент списка (дата `grant.factAt`). Сбой порта сезонов в списке — `seasonOutcomes` → `[]`
  (лог `achievements.seasons_unavailable`): сезонные не трогаются и не отдаются, остальной список — как обычно;
  серверная сверка (`origin: 'server'`) зовёт порт напрямую — сбой уходит в ретрай задачи.

## Карточки для сторис (`sharing`, story-cards, ADR-0018)

- Модуль `sharing`: `SharingModule` (`AppModule`: `StoryCardController` — `GET races/:raceId/entry/story-card`,
  `AuthGuard`, `no-store`; `StoryCardImageController` — `GET story-cards/:file`, `IpRateLimitGuard`) и
  `SharingWorkerModule` (`WorkerModule`: очередь `story-card`, `StoryCardProcessor`, `concurrency: 1`). Зависит от
  `results` (порт `RESULTS_FOR_SHARING`: `storyCardFacts` — как «моё участие», `storyCardLine` — `sliceLine` по
  `trackMap.segment` или линия маршрута), `profile` (`RIDER_NAMES`; `RIDER_THEMES` — тема запрашивающего карточку,
  user-theme: владелец заявки для сторис, зритель для приглашения), `races`, `routes`, `calendar` (OG-картинки),
  `identity` — только `index.ts`; на `sharing` не ссылается никто.
- Адрес приглашения (P6, K9): `InviteAddress.of(userId)` (только `SharingModule`, порт `social` `InviteCodes.ensureOf`)
  — `<host APP_WEB_ORIGIN>/i/<код>`; нет env или сбой — `null` (лог `sharing.invite_address_failed`). HTTP-сервисы
  четырёх карточек считают его после `consumeRead`, передают в `*Inputs.resolve(…, template, address)` и в данные
  задачи (`address`, `.nullable().default(null)` — задачи в полёте); worker берёт адрес из задачи, хэш включает его —
  карточки райда и маршрута стали личными (RC-P6-5, `renderVersion` 5). Рендер — `brandRow` (`story-card.render.ts`):
  бренд слева, адрес справа (токен `storyCard.text.address`, высота строки — бренда); без адреса — прежний узел.
- Входы — `StoryCardInputs.resolve` (одна реализация для HTTP и worker), ключ — `storyCardHash`; кэш — Redis
  (`StoryCardCache`: `token:<hash>`, `png:<token>`, `pending:<hash>` NX, `failed:<hash>` `GETDEL`; приглашение — ещё
  `ride:<token>` = `{ rideId, photoId нарисованного }` той же `MULTI`, ride-photo-followups). Отдача
  `StoryCardImageController` → `StoryCardImageService.png` (привязка → `RIDES_FOR_SHARING.inviteCardLive`; неактуальна —
  `revoke`, 404); `buildRideInvite` пишет PNG своим `OutcomeSink` с привязкой. Worker сверяет
  хэш (не совпал — `skipped`). Рендер — чистые `storyCardTree` (satori-узлы, только flex) → `renderStoryCardSvg`
  (шрифты темы по ролям) → `renderStoryCardPng` (resvg). Изменил разметку, тексты или токены карточки — подними
  `STORY_CARD_POLICY.renderVersion`. Превью — `pnpm --filter @pokatim/api preview:story-cards <каталог>`.
- Приглашение кофе-райда: `RideInviteController` (`GET rides/:rideId/invite-card`, `AuthGuard`, `no-store`) →
  `RideInviteService` → `RideInviteInputs` (порт `rides` `RIDES_FOR_SHARING`: `inviteFacts` — скрытый 404, не будущий
  `null`; `inviteLine` — `RideRoutes.catalogLine`, только `IN_CATALOG`) → общий `CardRequests` (лимиты, кэш,
  постановка) → задача `ride-invite.render` той же очереди → `StoryCardProcessor.buildRideInvite` →
  `rideInviteTree` (`ride-invite.render.ts`, узлы, `statRow`, `cardTrackView` и линия — `story-card.render.ts`/
  `story-card.png.ts`).
  `SharingModule`/`SharingWorkerModule` импортируют `RidesCoreModule`; `rides` о `sharing` не знает.
- Карточка достижения: `AchievementCardController` (`GET achievements/:code/story-card`, query
  `AchievementStoryCardQuery`, `AuthGuard`, `no-store`) → `AchievementCardService` (адрес `cardRef(code, seasonId)` —
  `AchievementCardRef`; сезонный без `seasonId` — 400 `seasonId:REQUIRED`, несезонный с ним — `seasonId:INVALID`, **до**
  `consumeRead`) → `AchievementCardInputs.resolve(userId, ref, template)` (порт `achievements`
  `ACHIEVEMENTS_FOR_SHARING.cardFacts` — факты ∩ не отозванная выдача, без записи; маршрут — название только из
  `ROUTES_FOR_SHARING.ogFacts`; сезон — название из фактов) → `CardRequests` → задача `achievement-card.render`
  (`AchievementCardJob.seasonId` — `Uuid.nullable().default(null)`; worker собирает тот же `cardRef`, лог без сезона) →
  `buildAchievementCard` → `achievementCardTree` (значок — глиф Material Symbols, `achievement-card.icons.ts` — зеркало
  иконок каталога приложения, `Record<AchievementCode, …>`, сезонные — без числа; число — `badgeCount(code, level)` из
  `ACHIEVEMENT_LEVEL_TARGETS`; условие «Сезона в зачёте» — `{count}` = `SEASON_REGULAR_MIN_RACES`, смена константы —
  подъём `renderVersion`). Сезон в хэше — `object.id` и название (отдельный `seasonId` не добавлять, RC-7). Порт отдаёт `level` (строка или `null`); уровень — в `achievementCardHash` явно после
  кода; тексты — метка уровня в kicker (`achievementCard.kickerLevel`), условие с `{count}` порога; сменил строки или
  вёрстку — подними `STORY_CARD_POLICY.renderVersion` (сейчас 5 — invites). `SharingModule`/`SharingWorkerModule` импортируют
  `AchievementsReadModule`.
- Карточка маршрута каталога (route-story-card): `RouteCardController` (`GET routes/:routeId/story-card`, `AuthGuard`,
  `no-store`) → `RouteCardService` (не в каталоге — 404) → `RouteCardInputs` (`ROUTES_FOR_SHARING.ogFacts`/`ogLine`,
  только `IN_CATALOG`) → `CardRequests` → задача `route-card.render` → `buildRouteCard` (устарел хэш, снят с каталога,
  нет линии — `skipped`) → `routeCardTree`.
- OG-картинки публичных страниц (og-images): `OgCardController` (`og/cards/brand/site`, `og/cards/:kind/:id` →
  `{ version }`, IP-лимит `og-card`; `og/images/brand/site/:file`, `og/images/:kind/:id/:file` — PNG без входа,
  IP-лимит `og-image`, старая версия — `302`, нет PNG — бренд `no-store` + постановка) → `OgCardService` →
  `OgCardInputs` (порты владельцев `RACES_FOR_SHARING`, `RIDES_FOR_SHARING.ogFacts`, `ROUTES_FOR_SHARING`,
  `CALENDAR_FOR_SHARING`, `RIDERS_FOR_SHARING`: `ogFacts` — только публичный объект, иначе `null`; `ogChanged` — keyset
  `changed-since.ts`). Виды: `race, ride, route, calendar, season, rider` (+ бренд); id по виду — `OG_CARD_ID`
  контракта (`rider` — `RiderPublicId`, остальные `Uuid`). Сезон — `seasonOgFacts` и `liveSeasonIds` порта `races`.
  Рендер — только worker: `og-card.render` очереди `story-card` (`priority`, `StoryCardProcessor.buildOgCard`,
  диспетчер по имени задачи), пререндер — `OgSync` (очередь `og-sync`, `og.sync` каждую минуту и при старте). Ключи
  Redis `og:png:<hash>` (TTL 7 сут., вне окна пререндера — 1 сут.; продление при выдаче), `og:obj:<kind>:<id>` →
  текущий хэш (новая версия удаляет PNG прежней — Lua `storeReady`), `og:pending:<hash>` (NX; после провала —
  удержание), `og:cursor:<kind>` (только `OG_CURSOR_KINDS`: гонка, райд, маршрут, старт), `og:sweep`; сезоны — без курсора, каждый
  прогон все живые (`liveSeasonIds`: число гонок не меняет `seasons.updatedAt`); райдер — без пререндера, только
  самолечение. Сбой строки `og.sync` — лог и пропуск. Тема — «Классика» (`OG_THEME_ID`); схема по виду —
  `OG_CARD_POLICY.scheme` (гонка, сезон, райдер — `dark`, остальные — `light`), входит в хэш; смена таблицы без подъёма
  `renderVersion` полный проход не запускает. **Изменил разметку, тексты или токены `ogCard`
  — подними `OG_CARD_POLICY.renderVersion`** (новые URL, полный проход `og.sync`; сейчас 4 — фото райда).
- OG райда с фото (ride-photo-followups): `photoId` — в канонических фактах `ride`; `buildOgCard` берёт байты
  `invitePhoto` (снято — `skipped`), `renderOgCard(input, line, photo)` → `composeWithPhoto` (`sharing/photo-card.png.ts`
  — общая с 4a композиция: `onPhotoColors`, `scrimSvg`, `encodePhotoCard`, `PHOTO_CARD_PALETTES`; вторых скрима и
  энкодера нет), скрим `photoScrimHero` цвета `overlay.scrim` схемы вида, предел `OG_CARD_POLICY.maxPhotoPngBytes`.
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
  `notifications-intake` (объявляет подписчик, ADR-0017); `protocol-published` и `result-revised` — ещё и в
  `standings-recalc` (`standingsOutboxRoutes`, fan-out).
- Отказы состояния — `409 RESULTS_ACTION_BLOCKED { reason, count? }`, `409 RESULTS_PUBLISH_BLOCKED { blockedBy,
  checklist }`.
- Видимость строки публичной таблицы — одна: `publicTableMode(race)` (`empty` / `provisional` / `protocol`) и
  `isPublicProtocolRow(row)` (`results.policy.ts`) общие для `publicResults`/`protocolResults` и
  `ResultsReadService.publicRow(entryId)` — порт `RESULTS_FOR_SOCIAL.respectTarget` («Свои» P4). Копии правила вне
  `results` нет.

## Рейтинг сезона (`standings`, race-results-08)

- Модуль `standings` (`results ──► standings`): `StandingsCoreModule` (репозиторий снимка, `StandingsSource`,
  `StandingsRecalc`; imports `RacesCoreModule`, `ResultsCoreModule`), `StandingsModule` (API: + `IdentityModule`,
  `PanelModule`, `ProfileCoreModule`), `StandingsWorkerModule` (`WorkerModule`). Порты — только через `index.ts`:
  `SEASON_RACES` (`races`: гонки с протоколом, `protocolRaceSeason`, `seasonExists`, `seesAllRaces`, `finishedSeasons`, `awaitingProtocol`),
  `RESULTS_FOR_STANDINGS` (`results`:
  `currentRevisions` одним `aggregate`, `protocolRows` ревизии), `RIDER_NAMES` (`profile`). `races`/`results` о
  `standings` не знают.
- Правила зачёта — чистые функции `standings.policy.ts` (`pointsForPlace`, `racesCounted`, `selectCounted`,
  `compareRiders`, `buildSeasonStandings`, `sourceFingerprint`), версия `STANDINGS_FORMULA_VERSION` в снимке: смена —
  полный пересчёт всех сезонов. Клиент ничего не считает.
- Пересчёт — **события** `results.protocol-published` / `results.result-revised` (`standingsOutboxRoutes` →
  `standings-recalc`, standings-outbox-events) + регламент-страховка: `StandingsSchedules` — `standings.sync` каждые
  15 мин (Минск) + разовая `standings.sync.boot` при старте worker (смена формулы, события до выката). Задача события →
  `StandingsRecalc.syncRace` (сезон — `SEASON_RACES.protocolRaceSeason`; нет — `skipped`) → `sync([seasonId])`;
  невалидный payload — лог `standings.event_skipped`. `StandingsRecalc.sync(seasonIds?)` сверяет отпечаток
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
- `join` — необязательное тело `JoinRideRequest` (`{ source? }`, K12; `ZodValidationPipe(JoinRideRequest.optional())`):
  новая запись с `source` → `PRODUCT_EVENTS.record({ type: 'ride-joined' })` после коммита (`RidesService.recordJoined`,
  сбой — лог `product_events.record_failed type=ride-joined` без отказа); повтор, квотная ветка и без `source` — без
  события. `RidesModule` импортирует `ProductEventsCoreModule` (`rides → identity, routes, media, panel,
  product-events`).
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
- Фото организатора (ride-photo, ADR-0028): `RidePhotosController` (`rides/:id/photo`, `AuthGuard`: `PUT` — `admit`
  (`RidesService.ownRide` → `assertUpcoming` → `ImageUploadSlots` → лимит `ride-photo:<uid>`) до тела, `POST delete`) и
  `RidePhotosPublicController` (`ride-photos/:id`, `PublicReadGuard`) → `RidePhotosService` (гейт `ImageProcessing`,
  `processCover`, транзакции «райд первым»); проверки «свой будущий райд» — методы `RidesService`, без копий. Сброс —
  `RidesModerationService.resetPhoto`; стирание — шаг `RideErasure`; порт `RIDES_FOR_SHARING` — `photoId` в фактах и
  `invitePhoto` (байты только текущего фото нескрытого райда; 4a и OG райда).
- ride-photo-followups: `RidesModerationController` `GET :id/photo` → `RidePhotosService.moderationBytes` (`findBytes` +
  `RidesRepository.hasPhoto` — любой статус; `RIDE_PHOTO_MODERATION_CACHE_CONTROL`, `replyJpeg`). Сброс
  (`RidesRepository.resetPhoto` — `$inc noticeSeq`) пишет outbox `rides.photo-reset` (`RidesPhotoReset { rideId, seq }`)
  → `notificationsOutboxRoutes` → `NotificationIntake.ridePhotoReset` (порт `RIDE_NOTICES`, организатору, любой
  статус, `canReplace` = `published` и старт впереди, `collapse` `ride:<id>:photo-reset` по `seq`). Условие «райд не
  скрыт и фото текущее» — один `RidesRepository.isShareable(rideId, photoId | null)` (`isCurrentPhoto` — через него);
  порт `RIDES_FOR_SHARING.inviteCardLive` — для отдачи PNG приглашения.

## Заезд по маршруту (`route-rides`, route-rides-01)

- Модуль `route-rides` (`route-rides → routes, tracks, identity`, HTTP — ещё `profile`, route-rides-04; `account → route-rides`) — только через `index.ts`;
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
  POST перепоставляет (RC-5).
- `tracks.activity-removed` — fan-out в `route-rides-intake`: `RouteRidesIntakeProcessor` удаляет заезды активности по
  всем маршрутам; фильтр на чтении по живым активностям и сироты в транзакции POST — страховка (RC-1). Финальный провал
  задачи — без dead-letter: сироты скрыты фильтром и убираются `deleteOrphans`. Планы автопроверки при удалении
  активности не чистятся (TTL).
- Автопроверка (route-rides-03, `docs/product/routes.md` V1–V5): сверка — общий `RouteRideEvaluator`
  (`route-ride-evaluator.ts`: `analyze`, `parseLimits`, `evaluate` — без записи; им же пользуется
  `RouteRideCheckProcessor`, копий `evaluate`/`THREAD_FAILURES` нет). Триггер — событие владельца
  `tracks.activity-group-created` (только **новая** группа дублей, в транзакции записи активности под
  `lockUserActivities`; дубль, перехват основной поздним источником и `regroupAfterDelete` его не дают) → маршрут у
  подписчика `routeRidesOutboxRoutes` (`mergeOutboxRoutes`, `src/outbox-routes.ts`) → очередь `route-ride-auto` (параллелизм 1, отдельно от `route-ride-check`) →
  `RouteRideAutoProcessor`: основная группы сейчас (`primaryOfGroup`) → `autoEligible` → план `autoPlan`:
  маршруты с автозаездом группы (`groupRides`) резервируют слоты первыми; кандидаты — свои заезды `ridesByRoute`
  **без заездов группы** (≤ 200 маршрутов) по последнему живому заезду ↓, затем `RouteRideRoutes.ownReadyIds`;
  пропуск — ручной заезд группы, квота 100 (у своих маршрутов вне скана — проверкой живых заездов до отсечения) →
  `RouteRideRoutes.rideableBounds` пачками по 25 + `nearRoutes` (`boundsNear` 600 м) → ≤ 20 маршрутов. План события —
  в `route_ride_auto_plans` (`_id` = id события outbox, первая запись побеждает) до сверок: ретрай и повтор события,
  в том числе после удаления задачи BullMQ, проверяют только его; плана нет и с приёма файла прошло больше
  `processDeadlineMs` (7 сут < TTL плана 30 сут, unit-тест) — задача без плана и сверок (поздний повтор после TTL). По маршруту: заезд группы уже есть — пропуск без прогона; иначе сверка → только `passed`:
  повторно активность, `findExisting`, квота → `insertChecked` (`origin: 'auto'`). Одна задача на активность: сбой
  окружения — ретрай всей задачи, на последней попытке маршрут пропускается с логом.
  Правила — `ROUTE_RIDE_AUTO_POLICY` (`route-rides.policy.ts`). Отдельный тип нужен и при fan-out: «новая группа»
  решается только в транзакции записи под замком активностей — подписчик `tracks.activity-ready`, читающий группу
  «сейчас», её не восстановит (поздний дубль уже перехватил основную, 8.1 AC-2).
- Таблица «Другие» (route-rides-04): `RouteRidesController.leaderboard` (`leaderboard` до `:rideId`) →
  `RouteRideLeaderboardService.table`: лимит `route-rides-leaderboard:<uid>` → `RouteRideRoutes.catalogRoute` (поверх
  `RoutesRepository.inCatalogByIds`, не `rideable`: автор одобренного маршрута тоже получает таблицу) →
  `RouteRidesRepository.leaderboardTop` → порт `profile` `RIDER_NAMES.routeRideRiders` (`{ shares, cards }` одним
  запросом) → порт `tracks` `ActivitySource.liveActivityIds` пачками по 1000 → своя строка тем же путём, что «Мои
  заезды» (`listOwn` → `liveActivities` → `bestOf`, RC-2) → чистые `firstAlive`/`rankLeaderboard`
  (`route-ride-leaderboard.ts`, ключ — `compareRides`). Ребро `route-rides → profile` — только у HTTP-модуля
  `RouteRidesModule` (`ProfileCoreModule`); `RouteRidesCoreModule` (account, achievements, worker) о `profile` не
  знает. Правила — `ROUTE_RIDE_LEADERBOARD_POLICY`; скан читает `scanRiders + 1` — лог
  `route_rides.leaderboard_truncated` только при фактическом усечении.
- Участки маршрута (route-rides-05, `docs/product/routes.md` U1–U4): разбиение — `routeSections(line, widthM)`
  (`packages/tracks/src/corridor/sections.ts`, чистая, только серверный вход): границы через 10 км по chainage
  `matchLine`, хвост < 5 км — к последнему, < 15 км или > 30 участков — `[]`. Участок «у ворот» — концы ≤
  `2·corridorGateRadiusM + 50` м или линия, снова подходящая к своему началу/концу ближе этого (`returnIndex`: движок
  завершает попытку на повторном входе в ворота): его точка разворота (самая дальняя вершина до возврата) — опорная
  граница, если дальше 5 км от остальных опорных; шаг/хвост — в каждом плече между опорными (route-rides-06). Остаток «у
  ворот» — слияние с соседним; < 2 после слияний — без участков. Chainage линии считается один раз (`sectionLineOn`).
  Любая смена границ → +1 `ROUTE_SECTIONS_VERSION` (сейчас 2). Сверка — `analyzeSections` (белый список `PARSE_FUNCTIONS`): неизменённые
  `prepareCorridor`/`matchCorridor` на подлиниях (`sectionLine`, `isLoop: false`), файл разбирается один раз; версия —
  `ROUTE_SECTIONS_VERSION`, отдельно от `CORRIDOR_ENGINE_VERSION` (движок и golden не меняются). В `RouteRideEvaluator`
  — второй вызов потока **после** итога движка: `evaluate(ride, { sections })`, ручная проверка — `always`,
  автопроверка — `ifPassed` (RC-9: без итога движка — `sections: null`); маршрут `distanceM` < 15 км — пусто без потока
  (RC-8); отказ потока — `failure` тем же маппингом `THREAD_FAILURES`, исключение — `failure: 'error'` без ретрая
  (RC-10: вердикт маршрута уже получен). «Лучший» и дельты участков — на чтении: `sectionsOf` (`route-rides.policy.ts`,
  те же `fromM/toM` и версия, ключ — `compareRides`, только видимые свои заезды), `detail.sections` — только у
  `passed`/`not_passed`. Лог — `route-ride <id> sections: <n> items, <k> passed[, failure <code>] in <T> ms`.

## Уведомления (`notifications`, ADR-0017)

- Источники (`results`, `disputes`, `rides`, `routes`, `tickets`, `races`) пишут только outbox в своих транзакциях (payload — id и
  коды) и дают порт чтения через `index.ts`: `ResultsNotices`, `DisputeNotices`, `RideNotices`, `RouteNotices`,
  `TicketNotices`; плюс `RaceRegistry`,
  `IdentityAccounts.liveUserIds/emailsOf`. Чужих коллекций `notifications` не читает; источники о нём не знают.
  `profile` — источник без порта: `PROFILE_FIELD_RESET` и схема `ProfileFieldReset` из `profile/index.ts`, payload
  самодостаточен, живость получателя — `liveUserIds`; Nest-импорт `ProfileCoreModule` — в `NotificationsModule` и
  `NotificationsWorkerModule` (не в `NotificationsCoreModule`) ради порта `RIDER_NAMES` для имён «Своих» (social-p1); схлопывание `profile:<uid>:<field>` по `seq`, событие без `seq` — `invalid_payload`.
- Маршруты объявляет подписчик: `notificationsOutboxRoutes` (21 тип → `notifications-intake`; `rides.photo-reset` (ride-photo-followups);
  `races.race-cancelled` (`{ raceId, reason }`, транзакция `RacesService.cancel` после журнала) — `RaceRegistry.get`
  (`cancelled`, иначе `state`) + `ResultsNotices.protocolAudience`, без письма; social-p7 — четыре
  `social.*`, черновики — `socialNoticeDraft`, `drafts(type, payload, now, eventId)`: процессор передаёт id события;
  «Свои идут» — вторая ветка `rides.participant-joined` (записавшийся — участник с `seq` события, только публичный,
  аудитория — `SOCIAL_NOTICES.goingAudience` без организатора и участников); названия — `RIDE_NOTICES`,
  `ROUTE_NOTICES`, `RACE_REGISTRY` + `RESULTS_NOTICES.entryRace`; `NotificationsWorkerModule` импортирует
  `SocialCoreModule`; `achievements.grant-noticed`
  — порт `ACHIEVEMENT_NOTICES`, черновик с `inApp` при `origin: 'read'` → push `skipped`/`in_app`
  (`initialDelivery(…, { inApp })`, флаг идёт и в пачку `FanoutJobData.inApp`), схлопывание `achievement:<grantId>` по
  рангу; `tickets.reminder-due` — получателю своя цель `ticket` через `NoticeDraft.targets`). Очереди:
  `notifications-intake` (событие → получатели → настройки → upsert; > 72 ч — skip; уникальность `(sourceEventId,
  userId)`, схлопывание `collapseKey`; аудитория > `NOTIFICATIONS_POLICY.fanoutChunk` (200) — задачи-пачки
  `notifications.fanout` той же очереди: `planFanout` (`notification-fanout.ts`) → план в данных задачи intake
  (`job.updateData`, `IntakeJobData.fanout`; есть — порты не зовутся) → `FanoutJobs.enqueue` — `FlowProducer.addBulk`
  (MULTI; `Queue.addBulk` — pipeline), опции — `defaultJobOptions` очереди явно; MULTI не гарантирует успеха команд —
  каждый jobId проверяется `getJob`, недостающие — ещё раз, нет — исключение; пачка: 72 ч, общая `writeRecipients`,
  `scheduleEvent(eventId, userIds)`, последняя попытка — лог `notifications.fanout_failed`), `notifications-delivery` (`notifications.push` по пользователю — захват,
  тумблер, тихие часы, лимит 20/ч, сводка; `notifications.email` — только N2), `notifications-maintenance`
  (`receipts` */15 — `DeviceNotRegistered` снимает токен; `redeliver` */10).
- Текст — снимок сервера (`notification-texts.ts`, не `@pokatim/i18n`; исключение RC-P5 — имена достижений, уровней и
  объектов из каталога `@pokatim/i18n` `achievements.*`, заголовок `achievement_granted` — функция `achievementTitle`);
  цель — белый список типов. Второе исключение — группа «Свои» (ADR-0027 п. 6, P1): `actors` + `params`, имена — при
  чтении списка и отправке push через `RIDER_NAMES.publicRiders` (нет публичного — «Райдер»). Чистые функции группы —
  `social-notices.ts` (`SOCIAL_NOTICE_KINDS`, `socialCollapseKey` — день события по Минску, `socialNoticeDraft` — точка
  входа P7, `renderSocialNotice`, `socialActorIds`); `NoticeDraft.actor` → `RenderedDraft.social` →
  `FanoutJobData.social?` → `writeRecipients` (`actors: [лицо]`, `params`) → режим накопления `writeNotices`; рендер —
  `NotificationsService.list` (один `publicRiders` на страницу) и `contentOf` push (одно социальное — имена на момент
  отправки, сводка — без имён); цель `rider` в документе не хранится (`null`), выводится из показанного лица. Expo — порт
  `PUSH_SENDER` (`expo-push.sender.ts`, адрес из env, в production — только `exp.host`); `PUSH_ENABLED=false` — push
  `skipped`.
- HTTP `/v1/notifications` под `AuthGuard`, только свои (`userId` сессии в фильтре, чужое — 404); лимиты
  `notifications-read` 120/мин, `notifications-settings` 30/ч, `notifications-push-token` 30/ч → `429 RATE_LIMITED`.
  Группа «Маршруты» (`route_published`/`route_rejected`) — подресурс `GET|PUT settings/routes` (`push.routes`, только
  push; нет поля — значение `push.rides`). Группа «Достижения» (`achievement_granted`, achievements-push) — подресурс
  `GET|PUT settings/achievements` (`push.achievements`, только push; нет поля — включено). Группа «Свои» (social-p1) —
  подресурс `GET|PUT settings/social` (`push.social`, только push; нет поля — включено).
  Группа «Мероприятия» — подресурс `GET|PUT settings/events` (`push.events`, `email.events`; нет поля — включено):
  `NotificationSettings` ответа строгий, новое поле сломало бы старые сборки (RC-D1); `PUT settings` — `$set`
  известных полей, не `replaceOne` (старые сборки не стирают тумблеры подресурса). Внутренний тип — `DeliverySettings`.
- Web Push (ADR-0022) — второй транспорт того же `notifications.push`, не отдельная система: подписка — `push_tokens`
  (`platform: 'web'`), HTTP `GET web-push` (публичный ключ или `null`), `PUT web-push/subscriptions`, `POST
  web-push/subscriptions/revoke` (лимит `notifications-push-token`). Порт `WEB_PUSH_SENDER` (`web-push.sender.ts`,
  шифрование — `web-push.crypto.ts`, RFC 8291/8292 без пакета `web-push`) — `null`, если `webPushVapid(env)` пуст;
  endpoint — только хосты `isWebPushEndpoint` контракта (SSRF), повторно в адаптере. 404/410 снимают подписку; канал
  выключен (`push_off`), только если выключены оба транспорта (`pushChannelEnabled`). Тесты — фейковый push-сервис
  `test/fake-web-push.ts` (`WEB_PUSH_TEST_ORIGIN`, только `NODE_ENV=test`), тело расшифровывается ключом подписки.

## «Свои» (`social`, `product-events`, ADR-0027 Proposed, `docs/product/social.md`)

- Модуль `social` — потребитель: `social → rides, profile, product-events, identity, results, routes, tracks` (P0;
  `identity` — `AuthGuard` контроллеров с P2; `results`, `routes` — P4, Главная P7; `tracks` — порт `ACTIVITY_STARTS`, P5) только через
  `index.ts` и порты: `RIDES_FOR_SOCIAL`
  (`rides-for-social.port.ts`, `rideFacts`: фаза — `ridePhase` внутри `rides`, участники «Иду» с организатором первым,
  точная точка старта при `startPrecise`; `nextRideCard` (P3, «Идёт») — ближайший опубликованный будущий райд райдера
  (`RidesRepository.nextOfRider`, `rides_participant_idx`) карточкой ленты `rideCardOf` с этим зрителем;
  P5: `ridesOfParticipant` — райды участника по окну старта, любой статус, ≤ 20 (`participantRidesBetween`,
  `rides_participant_idx`), `startedRidesWithin` — опубликованные по окну старта поверх `startedWithin`),
  `RIDER_NAMES.publicRiders` (публичность — при чтении, K3; ручное добавление — только к публичному),
  `RESULTS_FOR_SOCIAL.respectTarget` и `ROUTES_FOR_SOCIAL.respectTarget` (P4, цели «Респекта»). Коллекции
  `rides`, `profiles`, `activities`, `race_entries`, `routes` `social` не читает. На `social` ссылаются только `notifications`, `account`,
  `sharing` (порт `InviteCodes`, P6), `AppModule`, `WorkerModule` (dependency-cruiser `social-consumers-only`).
- Композиция (RC-13): `SocialCoreModule` (репозитории, `SocialConnectionsService`, `SocialAttendanceService`,
  `SocialReactionsService`, `SocialErasure`), `SocialModule` (`AppModule`, контроллеры: P2 — `RideParticipantsController`; P3 — `RiderSocialController`, `SocialConnectionsController`; P4 — `SocialRespectController`; далее P7; `ResultsCoreModule` и `RoutesCoreModule` — только здесь, RC-P4-12),
  `SocialWorkerModule` (`WorkerModule`, процессоры `social-intake` / `social-maintenance`; imports `TracksCoreModule`,
  `RidesCoreModule`, одна `registerQueue` на обе очереди). Дальше правки —
  только в `social/*`.
- Правила — `social.policy.ts` (`SOCIAL_POLICY`: лимит ручного «В свои» `social-manual:<uid>` 30/24 ч, окно ручной
  явки 7 дн, пороги автоявки, `bulkBatch`; `attendanceCheck`, `rideConnectionDiff`, `connectionSources`). Отказы —
  `409 SOCIAL_ACTION_BLOCKED { reason }` (`socialBlocked`), райда нет и непубличный профиль — `404 NOT_FOUND`, лимит —
  `429 RATE_LIMITED` (проверяется первым, на каждую попытку).
- Приглашения (P6, K9, ADR-0027 п. 5): код — `InviteCodes` (`invite-codes.service.ts`, экспорт `SocialCoreModule` и
  `index.ts`): `ensureOf` — выдача лениво (`_id` = userId, дубль `_id_` — перечитать, дубль `invite_codes_code_unique` —
  новый код, ≤ 5 попыток; генератор `generateInviteCode` внедряемый `INVITE_CODE_GENERATOR`), `ownerOf`.
  `GET /v1/social/invite-code` (`InviteCodeController`, `AuthGuard`, `no-store`). Событие `identity.account-confirmed
  {userId, invite}` пишет `identity` (`AccountConfirmation.confirmEmail` — общий шаг подтверждения по ссылке и сбросом
  пароля, только при первом подтверждении аккаунта с кодом); маршрут → `social-intake` объявляет `socialOutboxRoutes`
  (`social.events.ts`, новые типы — в конец). `SocialIntakeProcessor` — таблица `тип → { схема, обработчик }` (P5
  дописывает строку): неизвестное имя — бросок, payload не по схеме — `skipped`. `InviteIntake.handle`: код → владелец
  (`unknown_code`), свой (`self`), живость обоих — `IdentityAccounts.liveUserIds` (`inviter_deleted` /
  `invitee_deleted`), `linkInvite` (`linked` / `already_linked`); уведомление пригласившему — outbox в транзакции `linkInvite` (P7). Логи — id
  события и итог, без кода. `linkInvite` → `boolean`: `invite-registered` (`userId` пригласившего) — когда у стороны
  пригласившего `inviteAt` впервые стал не-`null` (`upsertInvite` → `inserted | invited | unchanged`, RC-P6-8).
- Явка (RC-2a) — транзакция: условная запись документа явки райда → явившиеся → `rideConnectionDiff` с парами райда
  → `bulkWrite` связей → удаление пар без источников (надгробие `removedAt` остаётся, RC-6) → события. Повтор — no-op
  без событий. «Меня не было» ставит `declinedAt` (RC-3a), явка по треку его не перекрывает.
- Профиль (P3): `RiderSocialController` (`@Controller('riders')`, `AuthGuard`, `no-store`: `GET :publicId/social`,
  `PUT :publicId/social/connection` `{ connected }` — один идемпотентный глагол, DELETE в CORS нет) и
  `SocialConnectionsController` (`social/connections`) → `RiderSocialService`: `publicId` → райдер только
  `RIDER_PROFILES.findPublic` (неизвестный и непубличный — один `404`) → себе — `409 self` (и для `false`) →
  `addManual` / `remove`; ответ — свежий `RiderSocial`; «Идёт» — только при связи райдер → зритель
  (`SocialConnectionsService.pairState`); список — `listOf` без строк без `publicId`, `count = items.length`, без
  `userId`.
- Дубль пары в транзакции (RC-P3-2): параллельные upsert одной пары в транзакциях (`addManual`, `linkInvite`, пересчёт
  явки) приходят как `112 WriteConflict` и повторяются `withTransaction`; повторов по `isDuplicateKey` в транзакционных
  путях нет (дубль ловит только `remove` вне транзакции). Доказательство — ворота в `social-connections.int.test.ts`.
- Реакции: `thank` — только между явившимися, повтор — no-op (RC-4); `toggleRespect` — на разрешённой вызывающим цели,
  дубль уникального ключа — перечитать состояние (HTTP его не вызывает). P4: `thankAll` — по явке P0 минус актёр
  (непубличные включены), уже поблагодарённые (`recipientsOf`) пропускаются, по одной транзакции `insert` на реакцию;
  `setRespect(actor, target, respected)` — идемпотентно (`true` — `insert`, дубль — `false`; `false` — `delete`), себе
  — `409 self`. Все новые реакции — через приватный `insert` (вставка + `product_events` в одной транзакции): точка
  outbox `social.*` для P7 (RC-P4-14). Писатель `social_reactions` — один (`ReactionsRepository`).
- «Спасибо за компанию» (P4): `POST rides/:id/thanks` `{ publicId? }` (`RideThanksRequest.optional()`) →
  `SocialRideParticipantsService.thank`: лимит `social-thanks:<uid>` 60/ч → видимость (404) → `publicId` —
  `RIDER_PROFILES.findPublic` (нет — 404) и `thank`, без — `thankAll` → лог `social.thanks ride= uid= added=` → `view`.
  Строка «Ехали» — `RideAttendedRow` (`self`, `thanked`), `allThanked` — все явившиеся «Ехали N», кроме зрителя.
- «Респект» (P4): `SocialRespectController` (`@Controller()`, `AuthGuard`, `no-store`: `GET|PUT
  races/:raceId/results/:entryId/respect`, `GET|PUT routes/:id/respect`) → `SocialRespectService` (`SocialModule`):
  цель — только портом (`raceId` пути ≠ `target.raceId` — как нет цели); `GET` без цели — `NEUTRAL_RESPECT`, `PUT` —
  лимит `social-respect:<uid>` 60/ч (общий) → 404 → `setRespect` → свежий `respectStateView` (`count` всем, `from` —
  только получателю: `respectActors` ≤ `respectFromMax` + `RIDER_NAMES`, остальные числом). Получатель от клиента не
  принимается, `userId` наружу не выходит.
- Участники и явка райда (P2): `RideParticipantsController` (`SocialModule` + `IdentityModule`, `@Controller('rides')`,
  `AuthGuard`, `no-store`: `GET :id/participants`, `POST :id/attendance`, `POST :id/attendance/decline`) →
  `SocialRideParticipantsService` (`SocialCoreModule`, export — P4): лимит `social-attendance:<uid>` 60/ч
  (`SOCIAL_POLICY.attendanceLimit`, общий на оба POST, первым) → `rideFacts` и видимость (нет или скрытый не
  организатору — 404, RC-1) → `markManual`/`unmark` P0 → свежий `view`. Ответ — чистая `rideParticipantsView`
  (`ride-participants.view.ts`): строки из `RIDER_NAMES.publicRiders` явным списком полей, флаги — `attendanceCheck`.
  Порт `RIDES_FOR_SOCIAL` не расширялся.
- Автоявка (P5, K2, ADR-0027 п. 4): `tracks.activity-ready` → `social-intake` (fan-out, строка в `socialOutboxRoutes`)
  → строка таблицы `SocialIntakeProcessor` → `AutoAttendanceIntake.handle`: старт основной группы сейчас — порт
  `tracks` `ACTIVITY_STARTS.primaryStart` (`duplicateOf ?? id`, два чтения; `userId` payload не используется) → только
  `cycling` → `IdentityAccounts.liveUserIds` (`user_deleted`) → `ridesOfParticipant` по окну → чистая
  `autoAttendanceCheck` (`attendanceCheck` по треку → фаза `past` → точный старт → обработан ≤ 7 дн по `CLOCK` → старт
  заезда в `[−30 мин; +2 ч]` → `haversineMeters` ≤ 500 м) → `SocialAttendanceService.markByTrack` по каждому; `404`/`409`
  (`isDomainError`) — пропуск райда, остальное — ретрай. Итог `marked | unchanged | no_activity | not_cycling |
  user_deleted | no_rides`; лог отказа — `social.intake_failed type=… event=…`.
- Регламент «Как прошёл райд?» (P5, K10): `social-maintenance`, `SocialSchedules` — `social.ride-ask` `*/30 * * * *`
  Минск + `social.ride-ask.boot` → `SocialMaintenanceProcessor` → `RideAskSweep.run`: окно старта
  `[now − askAfterMs − askCatchUpMs; now − askAfterMs]` (4 ч, догон 24 ч, `SOCIAL_POLICY`), полный проход окна за
  прогон без курсора → `askedAmong` → на райд транзакция `claimAsk` (захват `askedAt`) → `entriesIn` → адресаты
  `rideAskRecipients` (участники «Иду» без записи явки, только живые) → точка P7 `RIDE_ASK_DUE.due(tx, { rideId,
  userIds })` — P7: `OutboxRideAskDue` (outbox `social.ride-ask-due` в той же транзакции, лог `social.ride_ask_due
  ride count`; сбой `append` откатывает захват). Сбой райда — лог
  `social.ride_ask_failed`, в конце — исключение.
- Уведомления K10 (P7): outbox `social.*` — в транзакции действия, payload — только id: `social.reaction-created
  { reactionId }` (приватный `insert` реакций), `social.connection-added { ownerId, otherId }` (`addManual`: только
  если связи не было и захвачена отметка K11 `claimManualNotice` — `manualNoticeAt` не моложе `manualRenotifyMs`),
  `social.invite-registered { inviterId, inviteeId }` (`linkInvite`, при `registered`), `social.ride-ask-due { rideId,
  userIds }` (`OutboxRideAskDue` — реализация `RIDE_ASK_DUE` в `SocialWorkerModule`, заглушки `LoggingRideAskDue` нет).
  `socialOutboxRoutes` их не содержит — маршрут у подписчика (`notificationsOutboxRoutes`). Порт `SOCIAL_NOTICES`
  (`social-notices.port.ts`, `SocialCoreModule`): `reaction` (снята — `null`), `connected`, `goingAudience` (взаимные
  связи, RC-P7-1a).
- Главная (P7, K7): `SocialHomeController` (`GET social/home`, `AuthGuard`, `no-store`) → `SocialHomeService`
  (`SocialModule`): лимит `social-home:<uid>` первым → `listOf` (публичные, ≤ `homeConnectionsMax`) → райды — только
  взаимные «свои» (`ConnectionsRepository.ownerIdsOf`) → порты `RIDES_FOR_SOCIAL.upcomingWithRiders`,
  `RESULTS_FOR_SOCIAL.recentResults` (`ResultsReadService.recentPublicRows`: `RACE_REGISTRY.protocolsPublishedSince`,
  те же предикаты таблицы), `ROUTES_FOR_SOCIAL.recentByAuthors` (`toCatalogCard`, имя — `RIDER_NAMES`;
  `RoutesCoreModule` импортирует `ProfileCoreModule`) → чистые `social-home.view.ts` (`pickHomeRows` — по кругу видов,
  ≤ 3). Запросы портов — с `hint` своих индексов (`rides_participant_idx`, `races_protocol_published_idx`,
  `routes_catalog_idx`).
- Активный день (P7, K12): `AuthGuard` → `ActiveDay.touch` (`identity/active-day.ts`, провайдер и экспорт
  `IdentityModule`, `IdentityModule` импортирует `ProductEventsCoreModule`): `REDIS` `SET NX EX` до конца суток по
  Минску + 1 ч → `PRODUCT_EVENTS.record(active-day)`; ожидание ≤ `ACTIVE_DAY_WAIT_MS` (200), не бросает; сбой — `DEL`
  ключа и лог `product_events.record_failed type=active-day error=<класс>`. Тесты, считающие `product_events` после
  HTTP-запросов, фильтруют `type`; отказ `record` в тестах — по типу события, не `mockRejectedValueOnce`.
- Модуль `product-events` — листовой (dependency-cruiser `product-events-leaf`): порт `PRODUCT_EVENTS.record(event,
  session?)`, справочник и `props` — `product-events.types.ts` (zod, `strictObject`, без id пользователей, RC-11, RC-12).
  `social` пишет события в своей транзакции; вызывающий вне транзакции — после основной записи, сбой — лог
  `product_events.record_failed type=<t>` без отказа. Коллекцию `product_events` пишет только модуль. Пишут `social`,
  `rides`, `identity` (P7); новых очередей «Свои» в P7 нет.
