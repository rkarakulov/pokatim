# 1. Title

Результат гонки, слайс 01: маршрут и коридор гонки — эталонный GPX в панели, разбор маршрута в worker, коридор
гонки (маршрут + допуск), дистанция из маршрута, строка «Коридор: ±N м от маршрута» в карточке гонки

# 2. Goal

Первый слайс эпика `docs/tasks/2026-10-27-race-results/epic.md` (§7, слайс 01). Гонка перестаёт быть только
анонсом: команда платформы задаёт **эталонный коридор** — неизменяемый маршрут (GPX) и допуск «±N м от маршрута».
Это основа для сверки заездов (слайс 02), участия и попыток (слайс 03).

- Маршрут — сущность нового модуля `routes` (эпик A1): v1 — только маршруты команды платформы, загружаются в форме
  гонки панели; разбор GPX — только в worker (`worker_threads` с лимитами, `AGENTS.md` §4.5, `pokatim-backend.md`).
- Коридор — поле гонки `races.corridor = { routeId, widthM, distanceM }`; дистанция гонки с коридором вычисляется
  сервером из длины маршрута (`AGENTS.md` §4.1).
- Приложение показывает в карточке гонки «Коридор: ±50 м от маршрута» и «62 км по GPS-треку» (iOS, Android,
  web/PWA с SSR — ADR-0003). Карты нет (эпик §7, «вне эпика»).
- Создаётся ADR-0012 «Результаты гонок» со статусом **Proposed** (черновик — эпик §5).

Источники: `AGENTS.md` §1, §4; ADR-0007, 0009, 0010, 0011; `docs/product/races-and-seasons.md` («Эталонный
коридор», «Открыто»); `.claude/rules/{backend,pokatim-backend,db,pokatim-db,contracts,pokatim-contracts,web,
pokatim-web,app,pokatim-app,security,pokatim-security,tests,pokatim-tests}.md`; прототипы автора (конфиденциальны):
форма гонки панели («Эталонный коридор» — только маршрут; поля фиксируются с первой записи участника), карточка гонки
приложения (строка допуска под картой, OQ 63). Код сверен по `origin/develop` @ `41e4590`.

# 3. Scope

**Contracts / api-client**
- Новое `packages/contracts/src/routes/route.schema.ts`: `ROUTE_FILE_MAX_BYTES` (5 МиБ), `ROUTE_STATUSES`,
  `ROUTE_FAILURE_CODES`, `RouteTitle`, `PanelRouteSummary`, `PanelRoute` (с линией превью), `PanelRouteQuery`,
  `PanelRoutePage`.
- `races/race.schema.ts`: `CORRIDOR_WIDTH_*`, `CorridorInput`, `RaceInput.corridor` (необязательное),
  `RaceInput.distanceKm` — обязательно только без коридора (правило сервера), `'corridor'` в конец `RACE_FIELDS`,
  `PanelRace.corridor`.
- `races/race-public.schema.ts`: `RaceDetail.corridor: { widthM } | null` (необязательное поле ответа).
- `admin/audit.schema.ts`: действие `route.created` и вид объекта `route` — в конец.
- `common.ts`: коды ошибок `ROUTE_FORMAT_UNSUPPORTED`, `ROUTE_TOO_LARGE` и код поля `ROUTE_NOT_READY` — в конец.
- `packages/api-client/src/admin.ts`: `uploadRoute(bytes, title)`, `listRoutes(params)`, `getRoute(id)`.

**`packages/tracks`**
- `parseGpx(text, { allowRoute: true })`: без `trk` — точки `rte/rtept` (с `trk` — только `trk`, как сейчас).
- `analyzeRoute(bytes)` во входе `@pokatim/tracks/parse`: сигнатура GPX → разбор → очистка → проверки (точек ≥ 2,
  ≤ 50 000; длина 1–1000 км) → длина, набор высоты, старт, финиш, петля, линия показа (≤ 1000 точек) и линия сверки
  (≤ 20 000 точек). Время в точках не нужно.
- Экспорт `elevationGainM(points)` из `summary.ts` (сейчас приватная) — без дубля.
- Тип `CorridorGeometry` (вход слайса 02) — в `track.ts`.

**API — новый модуль `apps/api/src/modules/routes`**
- Коллекции `routes`, `route_geometries`, `route_sources`; миграция `0013_routes` (индексы + бэкфилл
  `races.corridor = null`).
- `POST /v1/admin/routes?title=…` (`application/octet-stream`, ≤ 5 МиБ, `races.manage`) → `202 PanelRoute`
  (`processing`) или `200` (тот же файл того же сотрудника); `GET /v1/admin/routes` (`races.read`, готовые и свои
  необработанные, новые сверху, курсор); `GET /v1/admin/routes/:id` (`races.read`).
- Outbox `routes.route-received` → очередь `route-processing` → `RouteProcessingProcessor` (worker) → `ready` с
  геометрией или `failed` с кодом.
- Порт `RouteCatalog` (через `modules/routes/index.ts`) для `races`: готовый маршрут по id, сводки по списку id.

**API — `races`**
- `RaceDoc.corridor`; правила: коридор — у черновика и предстоящей гонки; в открытом окне — только если коридора
  нет; закрытое окно и отменённая — нет (`FIELD_LOCKED`). С коридором `distanceKm` = длина маршрута (0,1 км), поле
  `distanceKm` вне `editable.fields`.
- Создание и правка гонки проверяют маршрут через `RouteCatalog` (готов, иначе поле `corridor.routeId` →
  `ROUTE_NOT_READY`); журнал `race.updated` с `changedFields: ['corridor', 'distanceKm']`.
- Публичная карточка `GET /v1/races/:id` — `corridor: { widthM } | null`.

**Общий код API (src)**
- `src/raw-body.ts` — `readLimited` из `track-uploads.controller.ts` (переезд, обе загрузки используют его).
- `src/parse-thread.ts` — запуск функции `@pokatim/tracks/parse` в `worker_threads` с лимитами (обобщение
  `track-parse.thread.ts`; `tracks` переходит на него без изменения поведения).

**Панель (`apps/admin`)**
- Форма гонки, группа «Гонка»: поле «Эталонный коридор» (выбор готового маршрута или «Без коридора»), «Загрузить
  GPX» → окно «Новый маршрут» (название из имени файла) → «Обрабатываем маршрут…» (опрос) → маршрут выбран; ошибка —
  под полем с причиной. «Допуск коридора, м» (по умолчанию 50) и подсказка «Коридор: ±50 м от маршрута». Превью —
  линия маршрута SVG (без подложки карты), длина, набор, «Круговой». Дистанция с коридором — только чтение
  «86,0 км — по маршруту». Зафиксировано — замок и `ReadonlyField`.
- `src/ui`: `FileButton` (кнопка + скрытый `<input type="file">`), `LinePreview` (SVG-полилиния из точек) — без
  доменных импортов, с тестами (кандидаты admin-kit, F6).

**Приложение (`apps/app`)**
- `features/races/race-detail.tsx`: строка «Коридор» — «±50 м от маршрута»; дистанция при коридоре — «62 км по
  GPS-треку». Без коридора и у старого API (поля нет) — как сейчас.

**Docs** — §10 (ADR-0012 Proposed, продукт, архитектура, правила).

# 4. Out of Scope

- Сверка заезда с коридором (`matchCorridor`) — слайс 02; заявки, попытки, фиксация полей с первой заявки (V-12) —
  слайс 03 (здесь только точка расширения в `raceEditable`).
- Карта (MapLibre, тайлы — внешний сервис, ADR), линия маршрута в приложении, обложки.
- Библиотека маршрутов райдеров (UGC, публикация, модерация, «рядом», `2dsphere` по маршрутам), раздел «Маршруты»
  панели, переименование и удаление маршрутов, KML, FIT-курсы.
- Ручные контрольные точки (эпик §3.1: v1 — неявные КП покрытием, слайс 02), отдельные ворота старта/финиша.
- Обязательность коридора для публикации (ADR-0010 Q4: публикация без коридора — анонс остаётся).
- Уведомления участникам о смене коридора (участников ещё нет).

# 5. Architecture Context

- **Модули и зависимости:** новый `routes` (зависит только от `panel` — гард, права, журнал); `races → routes`
  только через `modules/routes/index.ts` (`RouteCatalog`, `RoutesCoreModule`). `routes` о гонках не знает. `tracks`
  не меняет поведения: из него в общий `src/` переезжают `readLimited` и запуск потока разбора.
- **Слои `routes`:** `routes-admin.controller.ts` (тонкий: гард, права, контракт, чтение тела) →
  `routes.service.ts` (сигнатура, sha256, дедуп, транзакция «маршрут + исходник + outbox», лимит частоты) →
  `routes.repository.ts` (единственный писатель трёх коллекций) → `route-processing.processor.ts` (worker).
- **Неизменяемость:** маршрут в `ready` не меняется (ни геометрия, ни длина) — гонка хранит `routeId` и снимок
  `distanceM`; правка маршрута = новый маршрут. Поэтому проверка «маршрут готов» в транзакции правки гонки не
  требует замка: `ready` — терминальный статус, удаления нет (write skew невозможен — §7).
- **Исходник маршрута — в БД** (`route_sources`, BSON Binary ≤ 5 МиБ), не в `TrackFileStore`: уборка
  `tracks-maintenance` удаляет файлы без документа `track_uploads` (`tracks-maintenance.processor.ts:68–86`) и
  стёрла бы маршруты; квота тома — тоже о заездах. Исходник хранится (пересчёт линии сверки новой версией движка).
- **Поток загрузки:** `POST /v1/admin/routes` → `PanelGuard` + `races.manage` → лимит частоты → `readLimited`
  (5 МиБ, `413 ROUTE_TOO_LARGE`) → `detectTrackFormat === 'gpx'` (иначе `415 ROUTE_FORMAT_UNSUPPORTED`; FIT-курс
  тоже 415) → sha256 → `(ownerUserId, sha256)` есть → `200` с ним → транзакция { `routes` (`processing`) +
  `route_sources` + `PanelAudit.append(route.created)` + outbox `routes.route-received { routeId }` } → `202`.
  Гонка двух одинаковых загрузок — `isDuplicateKey(error, 'routes_owner_sha_unique')` → `200` с существующим.
- **Разбор (worker):** `jobId` = id события outbox; захват `findOneAndUpdate({ _id, status: 'processing' },
  { $inc: { attempts: 1 } })` (терминальный статус — no-op) → байты из `route_sources` → `runParseThread('analyzeRoute',
  bytes, limits)` (160 МБ / 32 МБ / 30 с) → отказ — `failed: <код>`; успех — транзакция { `route_geometries` upsert
  по `_id` + `routes` `processing → ready` с длиной, набором, стартом, финишем, `isLoop` } (условие статуса делает
  повтор no-op). Сбой окружения — исключение и ретрай BullMQ (5 попыток); последняя — `failed: unreadable`. Финальный
  провал виден в панели статусом маршрута и причиной под полем (`pokatim-backend.md`: «не тишина»).
- **Коридор гонки — правила (`races.policy.ts`):**

  | Статус / фаза | `corridor` | `distanceKm` |
  |---|---|---|
  | черновик, `upcoming` | менять, снимать | вручную без коридора; с коридором — вычисляется, вне `fields` |
  | `open` | задать, только если `null` (гонка-анонс); иначе `FIELD_LOCKED` | как слева |
  | `closed`, `cancelled` | `FIELD_LOCKED` / `RACE_INVALID_STATE` | как сейчас (V-11) |

  Слайс 03 добавит условие «нет заявок» (`lockedAt`) к той же функции; точка расширения — параметр `locked` в
  `raceEditable` и `validateRaceRules` (здесь всегда `false`, без поля в документе — «нет на вырост»).
- **Дистанция:** с коридором `distanceKm = round(distanceM / 100) / 10`. Запрос с коридором может не нести
  `distanceKm`; если несёт и значение ≠ вычисленному — `FIELD_LOCKED` на `distanceKm`. Без коридора и без
  `distanceKm` при создании — `REQUIRED`. Снятие коридора оставляет последнюю вычисленную дистанцию (поле снова
  редактируемое).
- **Контракты и совместимость:** только добавления. Приложение: `RaceDetail.corridor` — `.nullable().optional()`,
  отсутствие = `null` (новая сборка со старым API). Старые сборки лишнее поле игнорируют (`z.object` не строгий).
  Панель деплоится с API — строгие схемы (`PanelRace.corridor` обязателен). `RACE_FIELDS`, `AUDIT_ACTIONS`,
  `AUDIT_SUBJECT_KINDS`, коды ошибок — в конец.
- **Миграция `0013_routes`** — expand-only, идемпотентна, без транзакции: коллекции и индексы; `races.updateMany(
  { corridor: { $exists: false } }, { $set: { corridor: null } })`. Чтение терпит отсутствие поля (`?? null`).
- **Очереди:** `QUEUE.routeProcessing = 'route-processing'` (concurrency 1); маршрут события — `routesOutboxRoutes`
  в `worker.module.ts`. Новых расписаний нет.
- **Время:** `createdAt`/`updatedAt` — UTC из `CLOCK`; показ — `src/format.ts` панели.

# 5.1 Placement & Reuse Gate

- **Переиспользуем:** `PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelAudit`, `PanelDirectory`
  (`modules/panel/index.ts`); `MongoTransactions`, `MongoOutboxWriter`/`MongoOutboxReader`, `uuidv7`,
  `isDuplicateKey`, `RateLimiter` (`@rkarakulov/api-kit`); `ZodValidationPipe`, `domainError`, `page-cursor.ts`,
  `ensureCollection` (`0002_identity`), `QueueModule` (5 попыток, экспонента); `@pokatim/tracks`:
  `detectTrackFormat`, `parseGpx`, `sanitizePoints`, `trackLengthMeters`, `haversineMeters`, `simplifyTrack`;
  тестовый стенд `apps/api/test/{harness,panel,races}.ts`, фикстуры `packages/tracks/src/__fixtures__/`
  (`komoot.gpx`, `billion-laughs.gpx`, `no-time.gpx`). Панель: `SelectField`, `TextField`, `ReadonlyField`,
  `LockMark`, `Dialog`, `Button`, `DisabledReason`, `Banner`, `StatusTag`, `ErrorState`, `ConflictBanner`,
  `field-errors.ts`, `format.ts`. Приложение: `Row` карточки гонки, `formatDistances` (`lib/minsk-format.ts`).
- **Переносим, а не копируем:** `readLimited` → `src/raw-body.ts`; поток разбора → `src/parse-thread.ts`
  (`track-parse.thread.ts` становится тонкой обёрткой, его тесты зелёные без правок ожиданий).
- **Запрещённые дубли:** второй парсер GPX; разбор маршрута в HTTP-обработчике; своя геометрия (длина, упрощение)
  вне `packages/tracks`; DTO маршрута вне contracts; запись коллекций `routes` из `races` и наоборот; хранение
  исходника маршрута в `TrackFileStore`; `fetch` панели мимо `createAdminApiClient`; hex/px в SVG превью (только
  токены).
- **Новые пакеты:** нет (`routes` — папка модуля). Зависимостей npm нет.
- **Кандидаты в базу (follow-up, не здесь):** `parse-thread` (запуск функции модуля в потоке с лимитами), `FileButton`
  и `LinePreview` (admin-kit, F6).

# 6. Relevant Files

- `apps/api/src/modules/races/{races.collection,races.policy,races.service,races-public.service,races.module}.ts` —
  коридор, правила, представление.
- `apps/api/src/modules/tracks/{track-uploads.controller,track-parse.thread,tracks-maintenance.processor}.ts` —
  `readLimited` и поток разбора (переезд); уборка (почему не `TrackFileStore`).
- `apps/api/src/{http-app,queues,worker.module,app.module,error-messages}.ts` — парсер `octet-stream` (уже глобальный),
  очередь, маршруты outbox, тексты ошибок.
- `apps/api/src/db/migrations/{0010_tracks,index,migrations.int.test}.ts` — образец миграции и регистрация `0013`.
- `packages/tracks/src/{gpx,parse,summary,simplify,track,points}.ts` — разбор и геометрия маршрута.
- `packages/contracts/src/{common.ts,races/race.schema.ts,races/race-public.schema.ts,admin/audit.schema.ts}` —
  контракты.
- `packages/api-client/src/admin.ts` — методы панели.
- `apps/admin/src/features/races/{RaceEditor.tsx,race-form.ts,races-query.ts}`, `apps/admin/src/ui/index.ts` — форма.
- `apps/app/src/features/races/race-detail.tsx`, `apps/app/src/__tests__/race-detail.test.tsx` — строка коридора.
- `apps/admin/e2e/races.spec.ts` — смоук (API и worker из `dist` уже поднимаются `e2e/project.ts`).

# 7. Implementation Notes

**`packages/tracks`**
- `parseGpx(text, options?: { allowRoute?: boolean })`: подсчёт размера до разбора учитывает `rtept`
  (`countTags(text, 'rtept')`); `ALWAYS_ARRAY` + `rte`, `rtept`. Если в документе есть хотя бы одна `trkpt` —
  используются только `trk` (поведение заездов не меняется); иначе при `allowRoute` — `rte/rtept` всех `rte` по
  порядку. Без `allowRoute` — как сейчас (заезд из `rte` не принимается).
- `analyzeRoute(bytes: Uint8Array): RouteAnalysis` (только `parse.ts`): `detectTrackFormat(bytes) !== 'gpx'` →
  `unreadable`; точек > `ROUTE_MAX_POINTS` (50 000) → `too_many_points`; `sanitizePoints` (время не обязательно —
  точки без времени сохраняются) → < 2 → `no_track`; длина `trackLengthMeters` < 1000 м → `too_short`, > 1 000 000 м
  → `too_long`; линия показа `simplifyTrack(points, 5, 1000)`, линия сверки `simplifyTrack(points, 1, 20_000)`;
  `isLoop = haversine(start, finish) ≤ 200 м`; `elevationGainM(points)` (тот же гистерезис 3 м, что у заездов).
  Ошибки — `TrackParseError` с кодом из `RouteFailureCode`.
- `CorridorGeometry` (тип для слайса 02): `{ line: [lon, lat][]; widthM: number; isLoop: boolean; distanceM: number }`.

**`src/parse-thread.ts`**
- `runParseThread<T>(fn: 'analyzeTrack' | 'analyzeRoute', args: unknown[], limits: ParseLimits):
  Promise<{ ok: true; result: T } | { ok: false; code: string }>` — тот же код потока (`eval`, `import(
  '@pokatim/tracks/parse')`), имя функции — из белого списка (не строка запроса). Ошибка загрузки модуля —
  исключение (ретрай), таймаут — `{ ok: false, code: 'timeout' }`, OOM — `unreadable`. `analyzeInThread` в `tracks`
  вызывает его с `'analyzeTrack'`.

**`routes`**
- `ROUTE_POLICY` (`routes.policy.ts`): `maxFileBytes` 5 МиБ, `uploadUserLimit` 20/ч на сотрудника `[ASSUMPTION]`,
  лимиты потока — значения `TRACKS_POLICY` (общие константы не дублировать — импорт из `tracks` нельзя, поэтому
  `parse-thread.ts` экспортирует `DEFAULT_PARSE_LIMITS`, обе политики берут их).
- Название: `?title=` — `RouteTitle` (3–120, одна строка); иначе `400 VALIDATION_FAILED` (поле `title`).
- Список `GET /v1/admin/routes?status=ready&cursor&limit` (по умолчанию 50, максимум 100): `ready` — все готовые
  маршруты платформы (Q2); без `status` — готовые + свои `processing`/`failed`. Сортировка `_id` убыв. (UUID v7 —
  время создания), курсор — `page-cursor.ts`. `PanelRouteSummary` без линии; `GET :id` — с линией показа.
- Чужой несуществующий/недоступный id — `404 NOT_FOUND`.
- `RouteCatalog`: `findReady(id, tx?): Promise<{ id; title; distanceM } | null>`, `summaries(ids):
  Promise<Map<id, { title }>>`. Реализация читает только `routes` (линия сверки понадобится слайсу 02 — порт
  `RouteGeometry` появится там).

**`races`**
- `RaceDoc.corridor: { routeId: string; widthM: number; distanceM: number } | null`.
- `RACE_FIELDS` + `'corridor'`; `sameValue` в `races.policy.ts` сравнивает объект коридора по `routeId` и `widthM`.
- `validateRaceRules(next, prev, now)`: правила таблицы §5 для `corridor`; `distanceKm` ≠ вычисленному при коридоре —
  `FIELD_LOCKED`. `raceEditable`: `fields` без `distanceKm` при коридоре; `corridor` по таблице.
- `RacesService.create/update`: при `corridor` в запросе — `routeCatalog.findReady(routeId, tx)` в той же транзакции;
  нет — поле `corridor.routeId` код `ROUTE_NOT_READY`; иначе `corridor = { routeId, widthM, distanceM }`,
  `distanceKm` — вычисленная. `publish` не требует коридора.
- Представление `PanelRace.corridor = { route: { id, title }, widthM, distanceM }`; список гонок — одним вызовом
  `summaries`. Публичное — `{ widthM }` (без `routeId`: геометрия наружу не выходит до карты).

**Панель**
- `race-form.ts`: `corridorRouteId: string` (`''` — без коридора), `corridorWidthM: string` (по умолчанию `'50'`);
  `distanceKm` обязателен, только если коридора нет (`superRefine`). В запрос: `corridor: null | { routeId, widthM }`;
  `distanceKm` — только без коридора.
- Список маршрутов — `useQuery(['admin','routes','ready'])`; загрузка — `useMutation(uploadRoute)` → новый маршрут
  `processing` → `useQuery(routeQuery(id), { refetchInterval: 2000 пока processing })` → `ready` — выбрать в поле и
  обновить список; `failed` — ошибка под полем `admin.routes.failure.<код>`.
- Превью: `LinePreview` получает точки `[lon, lat][]`, проецирует в `viewBox` (равнопромежуточно вокруг центра,
  сохраняя пропорции), обводка — токен роли линии маршрута, толщина — `stroke.*`; `role="img"` + `aria-label`.
- Опрос — допустим (`AGENTS.md` §1: статусы — polling).

**Приложение**
- `race-detail.tsx`: `race.corridor ?? null`; строка `races.detail.corridor` / `races.detail.corridorValue`
  («±{width} м от маршрута»); дистанция — `races.detail.distanceByRoute` («{distance} по GPS-треку»). Платформенных
  развилок нет. SSR-мета не меняется (OG без коридора).

**Состояния (`AGENTS.md` §4.12)**

| Где | Первая загрузка | Ошибка без данных | Ошибка обновления | Пусто | Мутация |
|---|---|---|---|---|---|
| Поле «Эталонный коридор» | скелетон поля (`.skeleton` поля выбора) | под полем «Не удалось загрузить маршруты» + «Повторить» (сеть — «Нет соединения») | значения остаются, баннер формы с повтором | только «Без коридора» и «Загрузить GPX» | «Загрузить» в окне — disabled с индикатором в кнопке |
| Обработка маршрута | — | `failed` — текст причины, «Загрузить другой файл» | опрос продолжается, баннер не показывается до 3 сбоев подряд | — | «Обрабатываем маршрут…» (`role="status"`), без спиннера |
| Превью линии | скелетон блока превью | «Не удалось загрузить маршрут» + «Повторить» | данные остаются | — | — |
| Карточка гонки (app) | без изменений (скелетон экрана) | без изменений | без изменений | строки нет | — |

**i18n (`packages/i18n/src/ru.ts`, формальное «вы»)** `[ASSUMPTION copy]`
- `admin.races.field.corridor` «Эталонный коридор»; `admin.races.corridor.none` «Без коридора»;
  `admin.races.corridor.upload` «Загрузить GPX»; `admin.races.corridor.hint` «Только маршрут GPX. Старт и финиш —
  начало и конец маршрута.»; `admin.races.field.corridorWidthM` «Допуск коридора, м»;
  `admin.races.corridor.widthHint` «Коридор: ±{width} м от маршрута»; `admin.races.corridor.distanceByRoute`
  «{distance} — по маршруту»; `admin.races.corridor.loop` «Круговой»; `admin.races.corridor.processing`
  «Обрабатываем маршрут…»; `admin.races.corridor.previewLabel` «Линия маршрута «{title}», {distance}».
- `admin.routes.dialog.title` «Новый маршрут»; `admin.routes.field.title` «Название маршрута»;
  `admin.routes.dialog.submit` «Загрузить»; `admin.routes.listFailed` «Не удалось загрузить маршруты».
- `admin.routes.failure.{unreadable,no_track,too_many_points,too_short,too_long,timeout}`: «Не удалось прочитать
  GPX», «В файле нет маршрута», «Слишком много точек — упростите маршрут», «Маршрут короче 1 км», «Маршрут длиннее
  1000 км», «Обработка заняла слишком долго — попробуйте другой файл».
- Ошибки: `ROUTE_FORMAT_UNSUPPORTED` «Выберите файл GPX», `ROUTE_TOO_LARGE` «Файл больше 5 МБ», поле
  `ROUTE_NOT_READY` «Маршрут ещё обрабатывается или недоступен».
- Журнал: `admin.audit.action.route.created` «Загружен маршрут», вид объекта `route` «Маршрут».
- Приложение: `races.detail.corridor` «Коридор», `races.detail.corridorValue` «±{width} м от маршрута»,
  `races.detail.distanceByRoute` «{distance} по GPS-треку».

**Доступность**
- `FileButton`: доступное имя «Загрузить GPX», `accept=".gpx"`, фокус возвращается на кнопку после окна.
- Окно «Новый маршрут» — `Dialog` (ловушка фокуса, Esc, возврат фокуса).
- Статус обработки — `role="status"` (озвучивается без перевода фокуса); ошибка — `aria-describedby` поля.
- Превью — `role="img"` + `aria-label` с названием и длиной; декоративная линия без интерактива.
- Зафиксированный коридор — `LockMark` + `ReadonlyField` (как остальные поля, V-11).
- Приложение: строка «Коридор» — обычный текст `Row` (читается диктором парой «подпись — значение»).

**Платформы:** панель — desktop 1440, светлая; приложение — одна строка в общем компоненте карточки (iOS, Android,
web SSR), развилок нет; web-смоук открывает карточку гонки с коридором (`E2E_API=1`).

# 8. Risks / Assumptions / Open Questions

- **R1. Нет библиотеки маршрутов, а прототип требует «только маршрут библиотеки».** Модуль `routes` создаётся
  раньше библиотеки с `origin: 'platform'` (эпик A1); UGC расширит его. Риск — «нет на вырост» (`AGENTS.md` §4.9):
  в модели только то, что нужно коридору (без публикации, модерации, `2dsphere`).
- **R2. Маршруты планировщиков** (Komoot, RideWithGPS, Strava routes) — `trk` без времени или `rte` с редкими
  точками; разбор принимает оба, линия сверки не уплотняется здесь (слайс 02 интерполирует отрезки).
- **R3. Маршрут «туда-обратно» по одной дороге** — сверка различает направления по пройденной доле (слайс 02);
  здесь — только `isLoop` для петель.
- **R4. Размер `route_geometries`:** 20 000 + 1000 пар координат ≈ 0,7 МБ BSON — в пределах 16 МБ.
- **A. Допущения** `[ASSUMPTION]`: лимиты (5 МиБ, 50 000 точек, 1–1000 км, 20 загрузок/ч), тексты §7, допуск
  20–200 м шагом 5, по умолчанию 50.

# 8.1 Requirements Consistency

- **Противоречие в источнике:** прототип — «эталонный коридор: только опубликованный маршрут из библиотеки,
  отдельная загрузка трека при создании гонки не предусмотрена»; задача автора — «эталонный трек (GPX от
  организатора)»; ADR-0010 Q4 — коридор «в слайсе Маршруты». → **Трактовка:** GPX загружается в панели как маршрут
  модуля `routes` (это и есть «маршрут библиотеки», пока её единственный источник — команда платформы), гонка
  выбирает маршрут. Альтернативы — эпик A1.
- **Противоречие ADR-0010 ↔ эпик:** ADR-0010 обещает фазы `provisional` и `final`; эпик добавляет только `final`
  («предварительный» — статус результата). В этом слайсе фазы не меняются; решение — в ADR-0012 (Proposed) и
  слайсе 05.
- **Конфликт с кодом:** `tracks-maintenance` удаляет файлы хранилища без `track_uploads` → исходник маршрута в
  `TrackFileStore` был бы стёрт. → Исходник маршрута — в БД (`route_sources`), §5.
- **Конфликт с правилом V-11 ↔ V-12:** сейчас в открытом окне можно менять класс и дистанцию; прототип фиксирует
  коридор, окно, класс и покрытия «с первой записи участника». В этом слайсе записей нет; коридор фиксируется с
  открытия окна (если задан) — строже V-12 и безопасно (заявки до окна возможны, но слайс 03 добавит условие
  «нет заявок»). Расхождение с V-12 только в сторону строгости — оставляем.
- **Недоопределено (не блокирует, решено по умолчанию):** Q1–Q8 ниже.
- **Вредное решение:** нет находок.

### Вопросы (по умолчанию — рекомендация; блокирующих нет)

| № | Вопрос | Варианты | По умолчанию |
|---|---|---|---|
| Q1 | Права на маршруты | (1) `races.manage` — загрузка, `races.read` — чтение; (2) новые `routes.read/manage` | **(1)**: маршрут v1 существует только ради коридора; права библиотеки — со слайсом UGC |
| Q2 | Видимость маршрутов организаторам | все готовые маршруты платформы / только свои | **все готовые** (эталоны общие; организатор видит название и линию, не чужие гонки); свои необработанные — только автору |
| Q3 | Форматы маршрута | GPX (`trk` и `rte`) / + KML / + FIT-курс | **GPX** (`pokatim-app.md`: маршрут — GPX/KML; KML — со слайсом библиотеки) |
| Q4 | Название маршрута | ввод перед загрузкой (из имени файла) / `<name>` из GPX | **ввод**, предзаполнен именем файла без расширения |
| Q5 | Допуск | число 20–200 шагом 5 / список 25/50/100 | **число 20–200 шагом 5, по умолчанию 50** (эпик A2 — решение автора) |
| Q6 | Когда коридор фиксируется | с открытия окна / с первой заявки / никогда до закрытия | **с открытия окна** (гонке-анонсу — задать можно и в открытом окне); слайс 03 добавит «с первой заявки» |
| Q7 | Дистанция с коридором | вычисляется из маршрута / вводится вручную | **вычисляется** (сервер — авторитет; совпадает с «62 км по GPS-треку») |
| Q8 | Публичная геометрия | отдавать линию маршрута в `RaceDetail` сейчас / с картой | **с картой** (без потребителя — «нет на вырост»), сейчас только `widthM` |

### Требует решения автора (с рекомендацией)

- **A1 — источник коридора** (эпик §6): модуль `routes` с маршрутами команды платформы. Рекомендация — да.
- **A2 — допуск по умолчанию ±50 м**, диапазон 20–200 м. Рекомендация — да; при другой цифре меняется одна константа.

# 8.2 Deviations from spec

**Решения (2026-10-27):**
- Автор просил вести блок автономно: Q1–Q8 закрыты рекомендациями архитектора (колонка «По умолчанию» §8).
- A1 — да: эталонный коридор из маршрутов команды платформы (GPX), модуль `routes`.
- A2 — да: допуск по умолчанию ±50 м, 20–200 м шагом 5.
- A3–A11 — для следующих слайсов, здесь не применяются.

**Ревью pass 1 (Codex REQUEST CHANGES, Claude APPROVE с замечаниями) — исправлено в той же ветке:**
- последняя попытка разбора: сбой записи результата тоже даёт `failed: unreadable`;
- тот же файл после `failed` или обработки, зависшей > 15 мин (`ROUTE_POLICY.stuckAfterMs`), — снова `processing`
  новым событием outbox, ответ `202` (уточнение AC1: `200` — только для готового и идущего разбора);
- предел точек маршрута (50 000) — подсчётом до разбора XML (`parseGpx({ maxPoints })`);
- сервер отдаёт все ошибки формы сразу (`REQUIRED`, `ROUTE_NOT_READY` и правила); зафиксированный коридор —
  `FIELD_LOCKED` без проверки маршрута;
- панель: баннер ошибки обновления превью; все страницы готовых маршрутов; повторная загрузка того же файла снова
  выбирает маршрут; опрос не дольше 5 мин («проверьте позже»); после снятия коридора дистанция редактируется и
  уходит в той же правке.

**Отклонения реализации:**
- D1 (AC2, строже): GPX с `<!DOCTYPE …>` до корня (`xxe.gpx`, `billion-laughs.gpx`) отвергается при приёме —
  `415 ROUTE_FORMAT_UNSUPPORTED` (сигнатура `detectTrackFormat`, как у заездов), а не `failed`. `<!ENTITY` внутри
  документа после корня — `failed: unreadable` в worker. Оба пути покрыты int-тестами.
- D2 (AC9): `changedFields` журнала — в порядке `RACE_FIELDS`: `['distanceKm', 'corridor']` (состав как в spec).
- D3: реализация порта `RouteCatalog` — отдельный файл `modules/routes/route-catalog.ts` (`RoutesCatalogService`);
  `races-query.ts` панели не менялся (запросы маршрутов — `routes-query.ts`).
- D4: `TrackParseError.code` — `TrackFailureCode | RouteFailureCode` (один класс ошибки разбора для заездов и маршрутов).
- D5: «баннер после 3 сбоев опроса подряд» — запрос статуса маршрута с `retry: 2` и `retryDelay` 2 с: состояние
  ошибки наступает после трёх неудачных попыток подряд, опрос продолжается.
- D6: тексты сверх §7 `[ASSUMPTION copy]`: `admin.races.corridor.uploadOther` «Загрузить другой файл»,
  `…elevation` «набор {gain} м», `…previewFailed`, `…pollFailed`, `admin.routes.listRefreshFailed`,
  `admin.routes.error.RATE_LIMITED`. Подпись вида объекта журнала `route` не добавлена — экран журнала вид не
  показывает (только `label`).
- D7: форма панели — ошибка дистанции/допуска (зависит от выбора коридора, проверка уровня формы) показывается вместе
  с ошибками других полей, кроме случая, когда другое поле отвергнуто с `abort` (пустое название): тогда — после его
  исправления (ограничение `superRefine` zod 4). Сервер проверяет всё сразу.

# 8.3 Security checklist

Зона: `pokatim-security.md` (`modules/races/**`, `packages/tracks/src/parse*`) + новый `modules/routes/**`
(добавить в `paths:` правила, §10).

- **AuthN/AuthZ:** все `/v1/admin/routes*` — `@UseGuards(PanelGuard)` + `@RequirePermission` (`races.manage` —
  загрузка, `races.read` — чтение); `src/admin-routes.test.ts` обходит новый контроллер. Владение гонкой — как
  сейчас (без `races.manage_any` чужая — 404); организатор может прикрепить любой **готовый** маршрут платформы (Q2),
  чужой необработанный — 404. `ownerUserId`, статус, длина, геометрия — только сервер.
- **Входные данные:** тело — только `application/octet-stream`, чтение после гарда и лимита частоты, обрыв на 5 МиБ
  (`413` + `Connection: close`); формат — по сигнатуре; GPX — отказ на `<!DOCTYPE`/`<!ENTITY` до разбора, подсчёт
  элементов и `rtept` до построения дерева, `XMLValidator`; разбор — только worker, `worker_threads` с лимитами
  памяти и 30 с; `title` — `RouteTitle` (без управляющих символов); `corridor` — `strictObject`, `routeId` — `Uuid`
  (без операторов в фильтре), `widthM` — целое в пределах.
- **Данные наружу:** панель — линия показа (≤ 1000 точек), длина, набор; без sha256, исходника, `route_sources`.
  Публично — только `widthM`; `routeId` и координаты не выходят. Без ПДн и имён сотрудников в публичном ответе.
- **Злоупотребления:** 20 загрузок/ч на сотрудника (`RateLimiter`, ключ — `userId`); один и тот же файл — тот же
  маршрут (дедуп); параллелизм разбора — 1; исходник ≤ 5 МиБ в документе (лимит BSON соблюдён).
- **Секреты и логи:** логи — `routeId`, код отказа, `uid`; без названий файлов, координат и содержимого.
- **Аудит:** `route.created` (объект `route`, `label` — название) и `race.updated` с `changedFields` (`corridor`,
  `distanceKm`) — `PanelAudit.append(tx, …)` в транзакции действия (append-only).

# 9. Acceptance Criteria

**Функциональные**
- AC1. Сотрудник с `races.manage` загружает GPX (`trk` или `rte`) ≤ 5 МиБ → `202`, маршрут `processing`; worker
  переводит его в `ready` с длиной, набором, стартом, финишем, `isLoop`, линией показа ≤ 1000 и сверки ≤ 20 000
  точек. Повтор того же файла тем же сотрудником → `200` с тем же маршрутом.
- AC2. Битый GPX / без точек / < 1 км / > 1000 км / > 50 000 точек / XXE → `failed` с кодом; в панели — текст причины
  под полем. Не-GPX (FIT, PNG) → `415 ROUTE_FORMAT_UNSUPPORTED`; > 5 МиБ → `413 ROUTE_TOO_LARGE`.
- AC3. В форме гонки (черновик, предстоящая) можно выбрать готовый маршрут и допуск → `PanelRace.corridor` с
  названием, допуском, длиной; `distanceKm` = длина маршрута (0,1 км), поле дистанции — только чтение; снять коридор
  — дистанция снова редактируемая.
- AC4. Открытое окно: гонке без коридора коридор задаётся; с коридором — `FIELD_LOCKED`; закрытое окно —
  `FIELD_LOCKED`; отменённая — `409 RACE_INVALID_STATE`. `editable.fields` совпадает с этими правилами.
- AC5. Маршрут не `ready` (или чужой необработанный, или несуществующий) в `corridor.routeId` → `400` с полем
  `corridor.routeId` код `ROUTE_NOT_READY`.
- AC6. `distanceKm` в запросе при коридоре и ≠ вычисленному → `FIELD_LOCKED`; без коридора и без `distanceKm` при
  создании → `REQUIRED`.
- AC7. Публикация гонки без коридора работает как раньше (анонс).
- AC8. `GET /v1/races/:id` возвращает `corridor: { widthM }` или `null`, без `routeId` и координат. Карточка в
  приложении (iOS, Android, web SSR) показывает «Коридор — ±50 м от маршрута» и «62 км по GPS-треку»; без коридора
  — как сейчас; ответ без поля `corridor` — как без коридора.
- AC9. Журнал: `route.created` и `race.updated` с `changedFields: ['corridor','distanceKm']`.

**Технические**
- AC10. Разбор маршрута — только в worker, в `worker_threads` с лимитами; повтор задачи после `ready`/`failed` —
  no-op; сбой окружения — ретрай, последняя попытка — `failed: unreadable`.
- AC11. Миграция `0013_routes` создаёт коллекции и индексы, бэкфилл `corridor: null`; повторный прогон — без
  изменений (int-тест).
- AC12. `tracks` после переезда `readLimited` и потока разбора — поведение и тесты без изменений ожиданий.
- AC13. Состояния §7 (скелетон поля и превью, ошибки с повтором, статус обработки без спиннера, кнопка мутации).

**Негативные**
- AC14. Без сессии панели — `401`; модератор (`races.read`) — список и чтение да, загрузка `403`; access JWT
  приложения панель не принимает.
- AC15. `corridor: { routeId: { $ne: null } }`, лишние ключи, `widthM` 15/205/52 → `400`.
- AC16. Параллельные загрузки одного файла — один маршрут (int-тест, `isDuplicateKey`).

**Архитектурные**
- AC17. `races` импортирует `routes` только через `index.ts`; `routes` не импортирует `races`/`tracks`; `pnpm
  arch:check` зелёный. Единственные писатели — `RoutesRepository`, `RacesRepository`.
- AC18. Нет второго парсера GPX, своей геометрии вне `packages/tracks`, DTO вне contracts, hex/px в панели и
  приложении.

# 10. Documentation Impact

- **`docs/adr/0012-race-results.md`** — новый, Proposed (черновик — эпик §5); строка в `docs/adr/README.md`.
- `docs/product/races-and-seasons.md` — раздел «Эталонный коридор»: маршрут из GPX в панели, допуск, дистанция из
  маршрута, когда коридор фиксируется; «Открыто» — убрать «эталонный коридор», оставить библиотеку маршрутов.
- `docs/architecture/README.md` — модуль `routes` в «Есть», поток «Маршрут» (панель → `route_sources` → outbox →
  `route-processing` → `route_geometries`).
- `.claude/rules/pokatim-backend.md` — `routes` (маршруты команды, `RouteCatalog`, `races → routes`), общие
  `src/raw-body.ts` и `src/parse-thread.ts`.
- `.claude/rules/pokatim-db.md` — `routes`/`route_geometries`/`route_sources`: единственный писатель, неизменяемость
  `ready`, исходник в БД (почему не `TrackFileStore`), `races.corridor`.
- `.claude/rules/pokatim-contracts.md` — `routes/route.schema.ts`, `RaceDetail.corridor` (optional).
- `.claude/rules/pokatim-security.md` — `paths:` + `apps/api/src/modules/routes/**`, `apps/api/src/raw-body.ts`,
  `apps/api/src/parse-thread.ts`; абзац о загрузке маршрутов.
- `.claude/rules/pokatim-web.md` — поле коридора, `FileButton`, `LinePreview`, опрос статуса.
- `.claude/rules/pokatim-app.md` — строка коридора в карточке гонки (раздел «Гонки и сезон»).
- `AGENTS.md` — изменений нет. `docs/runbooks` — нет (новых env и сервисов нет).

# 11. Implementation Context

### ENTRY POINTS
- API: `apps/api/src/modules/routes/routes-admin.controller.ts` (новый), `races/races.service.ts`.
- Worker: `apps/api/src/modules/routes/route-processing.processor.ts` (новый), `worker.module.ts`.
- Пакет: `packages/tracks/src/parse.ts` (`analyzeRoute`).
- Панель: `apps/admin/src/features/races/RaceEditor.tsx`. Приложение: `features/races/race-detail.tsx`.

### Порядок (каждый шаг — зелёные тесты своего пакета)
1. `packages/tracks`: `parseGpx` + `allowRoute`, `analyzeRoute`, `elevationGainM`, `CorridorGeometry`, фикстуры.
2. Contracts + api-client.
3. API: `raw-body.ts`, `parse-thread.ts` (переезд `tracks`, его int-тесты зелёные).
4. `routes`: коллекции, миграция `0013`, репозиторий, сервис, контроллер, процессор, порт; int-тесты.
5. `races`: коридор, политика, сервис, публичное представление; unit + int.
6. Панель: `FileButton`, `LinePreview`, форма; тесты; e2e.
7. Приложение: строка коридора; тест; web-смоук.
8. Документация §10, `pnpm check`.

### FILES TO MODIFY
- `packages/tracks/src/{gpx.ts,parse.ts,summary.ts,track.ts,index.ts}`, новые фикстуры
  `src/__fixtures__/{route-trk-no-time.gpx,route-rte.gpx,route-loop.gpx,route-short.gpx}`, `expected.json`.
- `packages/contracts/src/{common.ts,index.ts,races/race.schema.ts,races/race-public.schema.ts,admin/audit.schema.ts}`,
  новое `routes/route.schema.ts` (+ `route.schema.test.ts`).
- `packages/api-client/src/admin.ts`.
- `packages/i18n/src/ru.ts`.
- `apps/api/src/{queues.ts,worker.module.ts,app.module.ts,error-messages.ts}`, новые `raw-body.ts`, `parse-thread.ts`.
- `apps/api/src/modules/tracks/{track-uploads.controller.ts,track-parse.thread.ts,tracks.policy.ts}`.
- Новый `apps/api/src/modules/routes/{index.ts,routes.module.ts,routes.collection.ts,routes.repository.ts,
  routes.service.ts,routes-admin.controller.ts,route-processing.processor.ts,routes.events.ts,route-catalog.port.ts,
  routes.policy.ts}`.
- `apps/api/src/modules/races/{races.collection.ts,races.policy.ts,races.service.ts,races-public.service.ts,
  races.module.ts}`.
- `apps/api/src/db/migrations/{0013_routes.ts (новый),index.ts}`.
- `apps/api/test/{routes.ts (новый: загрузка фикстуры, обработка напрямую),races.ts}`.
- `apps/admin/src/ui/{FileButton.tsx,LinePreview.tsx,index.ts}`, `apps/admin/src/features/races/{RaceEditor.tsx,
  race-form.ts,races-query.ts,routes-query.ts (новый)}`, `apps/admin/e2e/races.spec.ts` (+ фикстура GPX).
- `apps/app/src/features/races/race-detail.tsx`, `apps/app/e2e/web.spec.ts` (шаг карточки с коридором при `E2E_API`).
- Документы §10.

### FILES TO READ
- `apps/api/src/modules/tracks/{track-processing.processor,track-uploads.service,tracks.repository}.ts` — образец
  приёма, захвата и ретрая.
- `apps/api/src/modules/races/{races.repository,schedule-errors,races.policy.test}.ts`, `races-admin.int.test.ts`.
- `apps/api/src/modules/panel/index.ts`, `apps/api/src/admin-routes.test.ts`.
- `apps/api/src/db/migrations/{0002_identity,0010_tracks}.ts`.
- `apps/admin/src/ui/{fields,layout-parts,Dialog,DateTimeField}.tsx`, `apps/admin/src/panel-tokens.ts`.
- `docs/tasks/2026-10-26-admin-02-seasons-races/task.md` (V-11, `editable`), `docs/tasks/2026-10-26-tracks-devices/task.md`
  (приём файла, поток разбора).

### TYPES & SCHEMAS

```ts
// packages/contracts/src/routes/route.schema.ts
export const ROUTE_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const ROUTE_STATUSES = ['processing', 'ready', 'failed'] as const;           // панель — строгий z.enum
export const ROUTE_FAILURE_CODES =
  ['unreadable', 'no_track', 'too_many_points', 'too_short', 'too_long', 'timeout'] as const;
export const RouteTitle = RaceTitle;                                                 // 3–120, одна строка
export const PanelRouteSummary = z.object({
  id: Uuid, title: z.string(), status: z.enum(ROUTE_STATUSES),
  failure: z.enum(ROUTE_FAILURE_CODES).nullable(),
  distanceM: z.number().int().nullable(), elevationGainM: z.number().int().nullable(),
  isLoop: z.boolean().nullable(),
  owner: z.object({ userId: Uuid, displayName: z.string() }),
  createdAt: z.iso.datetime(),
});
export const PanelRoute = PanelRouteSummary.extend({
  line: z.array(z.tuple([z.number(), z.number()])).max(1000),                       // [] пока не ready
});
export const PanelRouteQuery = z.strictObject({
  ...PageQuery.shape, limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: PageCursor.optional(), status: z.literal('ready').optional(),
});
export const PanelRoutePage = z.object({ items: z.array(PanelRouteSummary), nextCursor: z.string().nullable() });
export const UploadRouteQuery = z.strictObject({ title: RouteTitle });

// packages/contracts/src/races/race.schema.ts (добавления)
export const CORRIDOR_WIDTH_MIN_M = 20, CORRIDOR_WIDTH_MAX_M = 200, CORRIDOR_WIDTH_STEP_M = 5,
  CORRIDOR_WIDTH_DEFAULT_M = 50;
export const CorridorInput = z.strictObject({
  routeId: Uuid,
  widthM: z.number().int().min(CORRIDOR_WIDTH_MIN_M).max(CORRIDOR_WIDTH_MAX_M).multipleOf(CORRIDOR_WIDTH_STEP_M),
});
// RaceInput: distanceKm: DistanceKm.optional(), corridor: CorridorInput.nullable().optional()
// RACE_FIELDS: [..., 'corridor']
// PanelRace: corridor: z.object({ route: z.object({ id: Uuid, title: z.string() }),
//                                 widthM: z.number().int(), distanceM: z.number().int() }).nullable()

// race-public.schema.ts
// RaceDetail = RaceCard.extend({ description, corridor: z.object({ widthM: z.number() }).nullable().optional() })

// common.ts: ErrorCode += 'ROUTE_FORMAT_UNSUPPORTED', 'ROUTE_TOO_LARGE'; SCHEDULE_FIELD_ERROR_CODES += 'ROUTE_NOT_READY'
// audit.schema.ts: AUDIT_ACTIONS += 'route.created'; AUDIT_SUBJECT_KINDS += 'route'
```

```ts
// apps/api/src/modules/routes/routes.collection.ts
export const ROUTES_COLLECTIONS = { routes: 'routes', geometries: 'route_geometries', sources: 'route_sources' } as const;
export interface RouteDoc {
  _id: string; origin: 'platform'; ownerUserId: string; title: string;
  status: RouteStatus; failure: RouteFailureCode | null; attempts: number;
  sha256: string; sizeBytes: number;
  distanceM: number | null; elevationGainM: number | null; isLoop: boolean | null;
  start: { type: 'Point'; coordinates: [number, number] } | null;
  finish: { type: 'Point'; coordinates: [number, number] } | null;
  createdAt: Date; updatedAt: Date;
}
export interface RouteGeometryDoc {        // _id = routeId; пишется один раз при ready
  _id: string;
  line: { type: 'LineString'; coordinates: [number, number][] };   // ≤ 1000, показ
  matchLine: [number, number][];                                   // ≤ 20 000, сверка (без индекса)
  sourcePointCount: number;
}
export interface RouteSourceDoc { _id: string; bytes: Binary; }    // _id = routeId, GPX ≤ 5 МиБ

// races.collection.ts
export interface RaceCorridor { routeId: string; widthM: number; distanceM: number; }
// RaceDoc.corridor: RaceCorridor | null

// routes/route-catalog.port.ts
export const ROUTE_CATALOG = Symbol('ROUTE_CATALOG');
export interface RouteCatalog {
  findReady(id: string, tx?: DbSession): Promise<{ id: string; title: string; distanceM: number } | null>;
  summaries(ids: readonly string[]): Promise<Map<string, { title: string }>>;
}

// packages/tracks/src/parse.ts
export interface RouteAnalysis {
  distanceM: number; elevationGainM: number | null; isLoop: boolean;
  start: [number, number]; finish: [number, number];
  line: [number, number][]; matchLine: [number, number][]; sourcePointCount: number;
}
export function analyzeRoute(bytes: Uint8Array): RouteAnalysis;   // TrackParseError(RouteFailureCode)
```

Индексы `0013_routes`: `routes_owner_sha_unique { ownerUserId: 1, sha256: 1 }` unique; `routes_list_idx { origin: 1,
status: 1, _id: -1 }`; `routes_owner_idx { ownerUserId: 1, _id: -1 }`; `route_geometries`, `route_sources` — без
вторичных индексов. Очередь: `QUEUE.routeProcessing = 'route-processing'`; событие `ROUTE_RECEIVED =
'routes.route-received'`, payload `{ routeId: z.uuid() }`.

### TESTS

| Уровень | Что |
|---|---|
| unit `packages/tracks` | `analyzeRoute`: `trk` без времени, `rte`, `trk`+`rte` (берётся `trk`), петля (`isLoop`), < 1 км, > 50 000 точек (синтетика), `billion-laughs.gpx` → `unreadable`, FIT → `unreadable`; пределы линий (≤ 1000 / ≤ 20 000, концы сохранены); `parseGpx` без `allowRoute` на `rte` — `no_track` (поведение заездов не изменилось) |
| unit contracts | `CorridorInput` (15, 20, 52, 200, 205; лишние ключи), `RaceInput` с/без коридора, `PanelRoute`, `RaceDetail` без поля `corridor` разбирается |
| unit API | `races.policy`: таблица §5 по фазам, `distanceKm` вне `fields` при коридоре, `sameValue` для коридора, `FIELD_LOCKED` для `distanceKm`; `parse-thread` — белый список функций |
| int API (реальный MongoDB) | загрузка: 202 / 200 повтор / 415 / 413 / 400 без `title` / 401 / 403 модератору; параллельные одинаковые загрузки → один маршрут; обработка (вызов `processRoute` напрямую): `ready` с геометрией, `failed` с кодами, повтор no-op, последняя попытка → `unreadable`; коридор: черновик, предстоящая, открытая без/с коридором, закрытая, отменённая; `ROUTE_NOT_READY` (processing, failed, несуществующий, чужой необработанный); организатор — чужой готовый маршрут да, чужая гонка 404; журнал `route.created`, `race.updated` с полями; публичная карточка `{ widthM }` без `routeId`; миграция: индексы, бэкфилл, повторный прогон; `tracks` int-тесты загрузки зелёные; `admin-routes.test.ts` видит новый контроллер |
| unit admin (RTL) | `FileButton` (имя, accept, выбор файла), `LinePreview` (проекция, `aria-label`, токены); `RaceEditor`: выбор маршрута, окно «Новый маршрут», статус обработки и переход в `ready`, причина `failed`, дистанция только чтение при коридоре, замок при `editable` без `corridor`, скелетон и ошибка списка маршрутов |
| unit app | `race-detail`: строка коридора и «по GPS-треку» при `corridor`; без коридора и без поля — как раньше (TZ Europe/Minsk) |
| e2e | `pnpm e2e:admin` (`races.spec.ts`): загрузка фикстуры GPX → «Обрабатываем маршрут…» → `ready` (worker из `dist` уже в стенде) → коридор ±50 → сохранить → после перезагрузки — коридор и вычисленная дистанция; `pnpm e2e:web` с `E2E_API=1` — карточка гонки с коридором показывает строку |

Отрицательное доказательство (`pokatim-tests.md`): убрать условие `status: 'processing'` в захвате → int-тест
«повтор после ready» краснеет по результату; убрать проверку `findReady` → тест `ROUTE_NOT_READY` краснеет.

### OUT OF SCOPE
§4.

# 12. Outcome

**Статус:** реализовано по слайсам §11 (8 шагов), ветка `feature/race-results-01-corridor` от `origin/develop`
@ `41e4590`. Решения Q1–Q8, A1, A2 — §8.2; отклонения D1–D7 — §8.2.

**Сделано**
- `packages/tracks`: `parseGpx(text, { allowRoute })` (точки `rte/rtept` только без `trkpt`, подсчёт `rtept` до
  разбора), `analyzeRoute` (сигнатура → разбор → ≤ 50 000 точек → очистка → 1–1000 км → линии показа ≤ 1000 и сверки
  ≤ 20 000, петля ≤ 200 м), экспорт `elevationGainM`, типы `RouteFailureCode`, `CorridorGeometry`; фикстуры
  `route-{trk-no-time,rte,loop,short}.gpx` (синтетика).
- Контракты: `routes/route.schema.ts`, `CorridorInput`, `RaceInput.corridor` / `distanceKm?`, `PanelRace.corridor`,
  `RaceDetail.corridor` (optional), `route.created` / `route`, коды `ROUTE_FORMAT_UNSUPPORTED`, `ROUTE_TOO_LARGE`,
  `ROUTE_NOT_READY`; api-client панели: `uploadRoute`, `listRoutes`, `getRoute`.
- API: общие `src/raw-body.ts`, `src/parse-thread.ts` (белый список функций); `tracks` переведён на них (int-тесты
  загрузок без правок ожиданий). Модуль `routes` (приём, дедуп, транзакция с журналом и outbox, список и чтение,
  `route-processing` в worker, порт `RouteCatalog`), миграция `0013_routes`. `races.corridor`: правила по фазам
  (`raceEditable`, `validateRaceRules`, точка расширения `locked`), дистанция из маршрута, `ROUTE_NOT_READY`, журнал,
  публичный `{ widthM }`.
- Панель: `FileButton`, `LinePreview` (`src/ui`), `CorridorField` (выбор, загрузка, опрос, отказ, превью, замок),
  допуск и дистанция «по маршруту» в `RaceEditor`; e2e `races.spec.ts` — загрузка GPX → ready → коридор ±50 →
  после перезагрузки коридор и 10,6 км → публичный `corridor: { widthM: 50 }`.
- Приложение: строка «Коридор — ±50 м от маршрута» и «… по GPS-треку» в карточке гонки; шаг web-смоука с гонкой с
  коридором (маршрут через API панели, разбор worker).
- Документы: ADR-0012 (Proposed) + реестр, продукт, архитектура, правила `pokatim-{backend,db,contracts,security,web,
  app}`.

**Проверки**
- `TURBO_CONCURRENCY=1 pnpm check` (MongoDB RS :27117, Redis :6479/1) — EXIT 0: format, lint, arch, typecheck, тесты
  (api 68 файлов / 621+ тестов, admin 17 / 143, app 631, пакеты).
- Миграции на отдельной БД: чистая — 0001…0013 по порядку; состояние develop (без 0013, гонка без поля) — применена
  только `0013_routes`, бэкфилл `corridor: null`, индексы `routes_*`; повтор — «новых миграций нет».
- `E2E_API=1 pnpm e2e:web` (своя БД `pokatim_e2e_slice01`, свой Mailpit :1126/:8126, Redis db 2; включает
  `build:web`) — 18 passed. `pnpm e2e:admin` (то же окружение, API :3202) — 2 passed (первый прогон нашёл вложенную
  форму окна «Новый маршрут» — исправлено, тест-сторож в RTL). `vite build` панели — ок. `expo export -p android` — ок.
- Отрицательные доказательства: без условия `status: 'processing'` в захвате — int-тест «повтор после ready» красный;
  без `findReady` — тест `ROUTE_NOT_READY` красный.

- Ревью pass 1: `TURBO_CONCURRENCY=1 pnpm check` — EXIT 0 (один прогон упал на нестабильном
  `ChoiceDialog` «фокус возвращается на триггер» в `admin-02-ui.test.tsx` — файл слайс не менял; отдельно 3/3 зелёный,
  повтор `check` — EXIT 0); `pnpm e2e:admin` — 2 passed; `E2E_API=1 pnpm e2e:web` — 18 passed (повторные прогоны
  упираются в IP-лимиты регистрации в Redis смоука — нужна чистая БД Redis).

**NOT VERIFIED**
- iOS/Android на симуляторе/устройстве (только `expo export -p android` и jest); визуальная сверка с прототипами.
- e2e `pnpm e2e:admin` / `e2e:web` в CI (локально — на нативных mongod/redis/mailpit вместо docker).

**Follow-up**
- `parse-thread`, `FileButton`, `LinePreview` — кандидаты в базу (app-foundation, F6).
- Слайс 02: порт `RouteGeometry` (линия сверки), `matchCorridor`; слайс 03: условие `locked` («есть заявки»).
