# task.md — route-rides-01: заезд по маршруту (модель, API, worker)

Уровень: task3. Ветка: `feature/route-ride` от `origin/develop`. PR 1 из 2 (PR 2 — экран приложения,
`docs/tasks/2026-10-28-route-rides-02-app/task.md`; панель не нужна — публичных данных и модерации нет).

## 1. Title

Заезд по маршруту вне гонки: сверка своего заезда с маршрутом каталога или своим маршрутом, личная история и
сравнение со своими прошлыми заездами — API и worker.

## 2. Goal

Райдер выбирает маршрут (каталог или свой готовый из «Моих»), выбирает свой заезд (импорт Garmin/Wahoo или
загруженный файл) — сервер в worker сверяет трек с маршрутом тем же движком коридора, что и гонки (±50 м), и
отдаёт: пройден ли маршрут (или почему нет), время, сравнение с лучшим и прошлым своим заездом по этому маршруту.

## 3. Scope

Решения автора от 2026-10-28 (вопросы в сессии): **R1** экрана в прототипе нет — собираем по аналогии с блоком
«Ваше участие · Ваши заезды: N · лучший 2:04:37» детали гонки и экраном результата гонки, копии — `[ASSUMPTION]`;
**R2** сравнение — только со своими заездами (никакой таблицы и данных других райдеров); **R3** частичный проезд
не засчитывается — правила коридора гонки, иначе «Не пройден» с причиной, без времени; **R4** маршруты — каталог и
свои готовые из «Моих», проверка — только по явному выбору райдера (автоперебора нет).

1. **Модуль `route-rides`** (новый контекст `apps/api/src/modules/route-rides/`): коллекция `route_rides`, сервис,
   контроллер под `AuthGuard`, worker-процессор сверки, порт стирания.
2. **Маршрут для заезда** — порт `routes` (новый, в `RoutesCoreModule`, через `modules/routes/index.ts`):
   видимость для райдера сейчас (маршрут каталога `IN_CATALOG` **или** свой готовый `ownRider`) → название, рамка,
   круговой; линия сверки такого маршрута — для worker. Без кэша в процессе (маршрут райдера не кэшируется —
   правило `pokatim-security.md`); существующие `RouteCatalog`/`RouteGeometry` (только `platform`) не меняются.
3. **Заезды** — порт `tracks` `ActivitySource` (`activity`, `uploadState`, `listInRange`, `group`, `readSource`,
   `trackLine`): только свои; основная активность группы дублей.
4. **Сверка** — `runParseThread('analyzeAttempt', …)` из `@pokatim/tracks/parse` без изменений движка: коридор
   `widthM = 50` (`ROUTE_RIDE_POLICY.corridorWidthM`), окно — время самого заезда `[startedAt − 1 мин,
   endedAt + 1 мин)`, линия показа активности — для разметки схода (`trackMap`). `CORRIDOR_ENGINE_VERSION` и golden
   не меняются. Вердикт `counted` → «Пройден», `rejected` (включая `implausible`) → «Не пройден» с первой причиной.
   Провал окружения — ретрай BullMQ, на последней попытке — видимый `failed` с кодом.
5. **API** (contracts-first, `packages/contracts/src/route-rides/`; api-client — методы с явным access-токеном),
   все — `AuthGuard`, `no-store`, пользователь — `@CurrentUser()`, id — `Uuid`; маршрут, не видимый райдеру сейчас,
   — один `404 NOT_FOUND`:
   - `GET /v1/routes/:routeId/rides` — свои заезды по маршруту: сводка (`count`, `passedCount`, `best` — лучший
     пройденный: id, время, дата) и строки (новые по дате заезда сверху, ≤ 100 — квота, без курсора);
   - `GET /v1/routes/:routeId/rides/candidates` — свои основные активности для выбора: последние 365 дней,
     рамка пересекает рамку маршрута, новые сверху, ≤ 30; у строки — `rideId` уже проверенного заезда этой группы
     дублей по этому маршруту или `null`;
   - `POST /v1/routes/:routeId/rides` `{ activityId } | { uploadId }` — проверить заезд: своя основная активность
     (по `uploadId` — активность загрузки; загрузка ещё в обработке — `409 ROUTE_RIDE_NOT_READY`, загрузка с
     отказом — `409 ROUTE_RIDE_UPLOAD_FAILED`); уже есть заезд этой группы дублей по маршруту — тот же заезд (повтор
     `failed` — новая ревизия проверки); иначе — новый `queued` + outbox-событие проверки в той же транзакции.
     Чужая/неизвестная активность или загрузка — `404 NOT_FOUND`. Лимит `route-rides-user:<uid>` 30/ч → `429`;
     квота 100 заездов на маршрут → `409 ROUTE_RIDE_QUOTA_EXCEEDED`;
   - `GET /v1/routes/:routeId/rides/:rideId` — заезд: статус, вердикт, причина, время, дистанция по маршруту,
     данные заезда (дата, источник, общая дистанция и время), сравнение (`best` — лучший пройденный по маршруту,
     `isBest`, `deltaToBestSec`, `previous` — предыдущий по дате пройденный заезд и `deltaToPreviousSec`);
   - `GET /v1/routes/:routeId/rides/:rideId/track` — своя линия заезда и разметка схода (как
     `…/entry/attempts/:attemptId/track`, maps-02): `marks: pending | ready | unavailable`.
   Статусы заезда наружу: `queued | checking | passed | not_passed | failed`; причины — `CorridorRejection` +
   `implausible`; провал — `AttemptFailure`-подобные коды (`timeout | unreadable | corridor_invalid | storage |
   error`). Время, вердикт и сравнение считает только сервер.
6. **Миграция** — коллекция `route_rides` и индексы (номер — следующий свободный на момент слияния; сейчас 0032).
7. **Удаление**: удаление аккаунта — порт стирания модуля и шаг в `account` (после `tracks` или рядом — решит
   architect); удалённая активность и удалённый/скрытый маршрут — заезды не показываются (как — решит architect:
   фильтр на чтении по живым активностям/видимому маршруту и/или чистка).
8. **Документация** — `docs/product/routes.md` (раздел «Заезд по маршруту»), `.claude/rules/pokatim-backend.md`,
   `pokatim-security.md`, `pokatim-db.md` (модуль, порты, коллекция), `docs/architecture/` если там перечень модулей.

## 4. Out of Scope

- Гонки, результаты, их правила, движок коридора, пороги, `CORRIDOR_ENGINE_VERSION`, golden — без изменений.
- Таблица и любые данные других райдеров по маршруту (R2); частичный зачёт/сегменты (R3); автопроверка новых
  заездов (R4); уведомления о вердикте; панель «Протокол»; сторис/карточки (сессия «Карточки для сторис»);
  профиль райдера (сессия «Профиль райдера») — их файлы не трогать.
- Экран приложения — PR 2.
- Удаление отдельного заезда райдером — follow-up.

## 5. Architecture Context

- ADR-0012 (коридор, движок в worker), ADR-0011 (tracks/активности), ADR-0007 (MongoDB, geo в packages/tracks),
  ADR-0015 (удаление аккаунта), ADR-0008 (AuthGuard).
- Образец приёма и сверки: `modules/results/attempt-intake.ts`, `attempt-check.processor.ts`, `races/pick` (UI).
- Ограничение outbox базы: один тип события — одна очередь (`tracks.activity-ready/-removed` уже слушает
  `results`); подписка `route-rides` на них без fan-out невозможна — architect выбирает решение без правки базы.

## 5.1 Placement & Reuse Gate (обязательно)

Architecture Review — route-rides-01. **Status: APPROVED** (блокеров нет; решения 8.1 RC-1…RC-14 — рекомендации
architect, вопросы человеку — RC-1, RC-7).

**Placement.** Новый контекст `apps/api/src/modules/route-rides/` (папка, не пакет: один потребитель — API/worker).
Слои: контроллер `route-rides.controller.ts` → сервисы `route-rides.service.ts` (POST) и `route-rides-read.service.ts`
(чтения) → `route-rides.repository.ts` (единственный писатель `route_rides`) → чистая политика `route-rides.policy.ts`;
worker — `route-ride-check.processor.ts`; стирание — `route-ride-erasure.ts`. Три Nest-модуля по образцу `results`:
`RouteRidesCoreModule` (репозиторий, стирание; imports `RoutesCoreModule`, `TracksCoreModule`), `RouteRidesModule`
(HTTP; + `IdentityModule`), `RouteRidesWorkerModule` (очередь `route-ride-check`). Зависимости: `route-rides → routes,
tracks, identity` и `account → route-rides` — только через `index.ts`; `routes`/`tracks` о `route-rides` не знают.
Нового пакета нет, кода для app-foundation нет.

**Reuse (обязательно) / запрещённые дубли:**
- Движок — `runParseThread('analyzeAttempt', …)` (`src/parse-thread.ts`, семафор `PARSE_THREADS_MAX`, `DEFAULT_PARSE_LIMITS`)
  без изменений `@pokatim/tracks`; геометрия рамок — `boundsNear`/`boundsOf` из `@pokatim/tracks`; тип разметки —
  `TrackMap` из `@pokatim/tracks/parse`. Свой поток разбора, второй расчёт рамок, копия движка — запрещены.
- Видимость маршрута — **новый** порт `routes` `RouteRideRoutes` (`ROUTE_RIDE_ROUTES`) поверх условий `IN_CATALOG` и
  `ownRider` репозитория (как `RideRoutes`, 05c), без кэша. `RouteCatalog`, `RouteGeometry`, `RideRoutes`,
  `RoutesCatalogService` и их кэши — **не меняются** (они читают только `platform` / не отдают линию сверки).
- Заезды — порт `ActivitySource` (`activity`, `uploadState`, `listInRange`, `readSource`, `trackLine`) + **одно
  аддитивное** чтение `liveActivities` (8.1 RC-2). Коллекции `tracks`/`routes` из `route-rides` не читать.
- Контракты: `ATTEMPT_REJECTIONS`, `ATTEMPT_FAILURES`, `TRACK_SOURCES`, `TrackMapRun`, `ATTEMPT_TRACK_MARKS`,
  `MY_ATTEMPT_TRACK_MAX_POINTS/RUNS`, `LonLat` — импорт, не копии. Новые enum только `ROUTE_RIDE_STATUSES`.
- Оркестрация сверки — **маленькая копия** `AttemptCheckProcessor.evaluate` (≈ 60 строк: маппинг `THREAD_FAILURES`,
  `implausible`, финальная попытка), не рефакторинг `results`: процессор гонок связан с `lockEntry`, ревизией заявки,
  датчиками и событием вердикта; общий хелпер потребовал бы правки `results` (риск для гонок/golden) и экспорта из
  `results/index.ts` в чужой контекст. Общая часть (движок, поток, лимиты) уже общая.
- Лимит — `RateLimiter` базы (инлайн-хелпер в сервисе, как в `rides`; `consumeUserLimit` из `results` не импортировать).
- Транзакции и outbox — `MongoTransactions`, `MongoOutboxWriter`/`MongoOutboxReader` из `@rkarakulov/api-kit/mongo`.

**Contracts & compatibility.** Только добавления: новый файл `route-rides/route-ride.schema.ts`, экспорт из `index.ts`,
три кода в **конец** `defineErrorCodes`. Ответы — `tolerantEnum`; существующие схемы не меняются → старые сборки не
затронуты.

**Data.** Коллекция `route_rides`, миграция `0032_route_rides` (expand-only, `ensureCollection` + один уникальный индекс,
8.1/11). Append-only не требуется (личные данные райдера; удаление — разрешено).

**Jobs & events.** Событие `route-rides.check-requested` → очередь `route-ride-check` (jobId = id события), параллелизм 1,
ретраи по умолчанию `QueueModule` (5); финальный провал — видимый `failed: error`; зависшие — «ленивый» `failed` при
чтении (8.1 RC-5). Подписки на `tracks.*` нет (8.1 RC-1).

**Security.** Чек-лист нужен — да (данные пользователя, треки, маршруты райдера; 8.3 + дополнения в 7/11).

## 6. Relevant Files

Образцы (читать, не менять, кроме отмеченного):
- `apps/api/src/modules/results/attempt-check.processor.ts` — оркестрация сверки (claim → evaluate → record, финальная
  попытка, `THREAD_FAILURES`, `implausible`, точка подмены `analyze`, `parseLimits`).
- `apps/api/src/modules/results/attempts.service.ts` — POST по `activityId | uploadId` через `ActivitySource`, кандидаты.
- `apps/api/src/modules/results/results-read.service.ts` (`myAttemptTrack`) — ответ `/track` и `marks`.
- `apps/api/src/modules/results/results.repository.ts` (`claimAttempt`, `recordCheck`) — запись своей ревизией.
- `apps/api/src/modules/results/race-entry.controller.ts` — контроллер под `AuthGuard`, `no-store`, `Uuid`-pipe, 201/200.
- `apps/api/src/modules/results/results.module.ts`, `results.events.ts` — Core/HTTP/Worker-модули, события и маршруты.
- `apps/api/src/modules/routes/ride-routes.port.ts`, `ride-routes.ts` — образец порта видимости без кэша (05c).
- `apps/api/src/modules/routes/routes.repository.ts` — `IN_CATALOG`, `ownRider`, `displayLine`, `geometry` (**меняется**:
  + `findRideable`).
- `apps/api/src/modules/routes/routes.module.ts`, `index.ts` (**меняются**: провайдер и экспорт нового порта).
- `apps/api/src/modules/tracks/activity-source.port.ts`, `activity-source.ts`, `tracks.repository.ts`, `index.ts`
  (**меняются**: + `liveActivities`).
- `apps/api/src/modules/account/account-erasure.service.ts`, `account.module.ts` (**меняются**: шаг `route-rides`).
- `apps/api/src/queues.ts`, `worker.module.ts`, `app.module.ts`, `error-messages.ts` (**меняются**).
- `apps/api/src/parse-thread.ts` — не меняется (`analyzeAttempt` уже в белом списке).
- `packages/tracks/src/corridor/match.ts` (`verdict`: `outside_window` — `start < startsAt || finish ≥ closesAt`),
  `corridor/types.ts`, `parse.ts` (`analyzeAttempt`, `loadTrack`) — не меняются.
- `packages/contracts/src/results/results.schema.ts` (`ATTEMPT_*`, `MyAttemptTrack`, `TrackMapRun`), `common.ts`
  (**меняется**: коды в конец), `index.ts` (**меняется**).
- `packages/api-client/src/index.ts` (**меняется**), образец — `getMyAttemptTrack`, `addRaceAttempt`.
- Тесты-образцы: `apps/api/src/modules/results/results-check.int.test.ts`, `results-attempts.int.test.ts`,
  `results-my-track.int.test.ts`, `routes/routes-mine.int.test.ts`, `account/account-erasure.int.test.ts`,
  `db/migrations/migrations.int.test.ts`; хелперы `apps/api/test/results.ts` (`corridorRoute`, `rideGpx`, `uploadRide`,
  `importRide`, `resultsWorker`, `rider`, `signIn`, `travelTo`), `test/routes.ts` (`seedRiderRoute`,
  `seedApprovedRiderRoute`, `publicationDoc`), `test/tracks.ts`; фикстуры
  `packages/tracks/src/__fixtures__/corridor/*.gpx` + `corridor-expected.json` (`widthM = 50`, как политика).

## 7. Implementation Notes

Порядок — contracts-first, TDD (тест → красный → код → зелёный) на каждом шаге. Int-тесты — на реальных MongoDB/Redis
стенда; при параллельной работе агентов — своя БД Mongo и свой номер Redis db (не общий `*_test`).

**Шаг 1. Контракты** (`packages/contracts/src/route-rides/route-ride.schema.ts` + `.test.ts`, экспорт в `index.ts`, коды в
конец `common.ts`, тексты в `apps/api/src/error-messages.ts`). Схемы — §11. Тест: `tolerantEnum` (незнакомый статус/
причина → `unknown`), `RouteRideRequest` — ровно одно поле (оба, ни одного, лишний ключ, не-UUID — отказ), пределы
массивов (≤ 100 строк, ≤ 30 кандидатов, линия 2–1000, `offRuns` ≤ 100), `MyAttemptTrack`/`AttemptRequest` не изменились
(тест типов не нужен — схемы не трогаем). `error-messages.test.ts` — новые коды имеют текст.

**Шаг 2. api-client** (`packages/api-client/src/index.ts` + `route-rides.test.ts`): `listRouteRides`,
`listRouteRideCandidates`, `checkRouteRide`, `getRouteRide`, `getRouteRideTrack` — явный `accessToken`, `encodeURIComponent`
id, разбор ответа схемой; тест — URL, метод, тело, заголовок `Authorization`, разбор.

**Шаг 3. Порт `routes` `RouteRideRoutes`** (`route-ride-routes.port.ts`, `route-ride-routes.ts`,
`RoutesRepository.findRideable`; провайдер/экспорт в `RoutesCoreModule`, экспорт из `routes/index.ts`). Int-тест в
`route-rides.int.test.ts` (или `routes/route-ride-routes.int.test.ts`): видимы — платформа в каталоге, одобренный
маршрут райдера (чужой) в каталоге, свой готовый; **не** видимы — платформа не в каталоге (маршрут только гонки),
чужой непубличный, свой `processing`/`failed`, `pending`/`hidden`/`withdrawn` чужого, подставленный `catalog` без
`approved` (N1), неизвестный. `matchGeometry` — те же условия, отдаёт `matchLine`; нет геометрии — `null`. Кэша нет
(тест: снятие с публикации видно следующим вызовом).

**Шаг 4. `ActivitySource.liveActivities`** (`activity-source.port.ts`, `activity-source.ts`,
`TracksRepository.ownActivityHeads` — `find({ _id: { $in }, userId }, { projection: { duplicateOf: 1 } })`). Int-тест в
`tracks/activity-source.int.test.ts`: свои живые → `primaryId`, дубль → id основной, чужие/удалённые/неизвестные — нет
в карте, пустой вход — пустая карта без запроса.

**Шаг 5. Политика** `route-rides.policy.ts` + `route-rides.policy.test.ts` (чистые функции, `ROUTE_RIDE_POLICY`, §11):
`matchWindowOf` (±1 мин), `effectiveStatus` (зависшие `queued` > 2 ч / `checking` > 15 мин по `updatedAt` → `failed:
error`, граница — строго больше), `verdictOf` (counted → `passed`, rejected → `not_passed` + причины), `bestOf`
(минимум `elapsedSec` среди `passed`; ничья — раньше `activity.startedAt`, затем меньший `_id`), `previousOf` (последний
`passed` с `activity.startedAt` строго раньше; ничья по времени — меньший `_id`), `comparisonOf` (дельты — только у
`passed`; у лучшего `deltaToBestSec = 0`, `isBest = true`), `summaryOf` (`count` — все видимые, `passedCount`, `best`),
`sortRides` (новые по `activity.startedAt` сверху, затем `_id` desc), `candidateRows` (без `cycling_indoor`,
`boundsNear(activity.bounds, route.bounds, 600)`, ≤ 30, `rideId` — заезд, чья активность сейчас в группе с основной
кандидата: `heads.get(ride.activityId)?.primaryId === candidate.id`), `findExisting` (тот же критерий для POST).

**Шаг 6. Коллекция, репозиторий, миграция**: `route-rides.collection.ts` (§11), `route-rides.repository.ts`,
`db/migrations/0032_route_rides.ts` + `index.ts`; в `migrations.int.test.ts` — индекс ровно как в §11, `0032` последняя
и после `0031_rides_geo`, повторный `up` без изменений. Номер — следующий свободный на момент слияния (если develop
занял `0032` — переименовать и поправить тест).

**Шаг 7. POST и чтения** (`route-rides.service.ts`, `route-rides-read.service.ts`, `route-rides.controller.ts`,
`route-rides.module.ts`, `index.ts`, `RouteRidesModule` в `app.module.ts`). Алгоритм POST (`RouteRidesService.check`):
1) лимит `route-rides-user:<uid>` 30/ч (до всего, считает и повторы и 404 — анти-перебор);
2) `rideable(routeId, uid)` → `null` — `404 NOT_FOUND`;
3) источник: `activityId` → `activity(uid, id)` (`null` → 404) → основная группы: `isPrimary ? ref :
   activity(uid, ref.primaryId)`; `uploadId` → `uploadState(uid, id)` (`null` → 404; `queued|processing` →
   `409 ROUTE_RIDE_NOT_READY`; `failed|skipped` → `409 ROUTE_RIDE_UPLOAD_FAILED`; `activity: null` → `409
   ROUTE_RIDE_NOT_READY`) → основная по `activity.primaryId`;
4) `listOwn(uid, routeId)` + `liveActivities(uid, ids)`; существующий заезд группы (`findExisting`): не `failed`
   (с учётом `effectiveStatus`) → ответ `200` без записи и события; `failed`/зависший → транзакция `requeue` (условие —
   прежняя `checkRevision` и `failed` либо зависание в фильтре) + outbox → `200`; проиграл гонку (`requeue` = false) —
   перечитать и вернуть;
5) нового нет: живых (`liveActivities`) ≥ 100 → `409 ROUTE_RIDE_QUOTA_EXCEEDED`; иначе транзакция: `deleteOrphans`
   (свои заезды этого маршрута, чьих активностей нет) → `insert` (`queued`, `checkRevision: 1`, снимок активности) →
   outbox `route-rides.check-requested` → `201`. `isDuplicateKey(error)` после `run` (параллельный POST той же группы)
   → перечитать по `(userId, routeId, activityId)` → `200`;
6) ответ — `RouteRideDetail` через read-сервис; лог после коммита — `route-ride <id> route <routeId> user <uid>
   created|existing|requeued`.
Чтения (`RouteRidesReadService`): каждое — `rideable` (404), свои заезды маршрута → фильтр `liveActivities` → политика.
`GET :rideId` и `/track` — заезд свой, этого маршрута и живой, иначе 404; `/track` — `trackLine(uid, activityId)` (нет
или < 2 точек — 404), `marks`: `queued|checking` (эффективный) — `pending`; `trackMap` есть и `linePoints === line.length`
— `ready`; иначе `unavailable` (как `myAttemptTrack`). Кандидаты — `listInRange(uid, now − 365 д, now, 200)` →
`candidateRows`. Контроллер: `@Controller('routes/:routeId/rides')` + `@UseGuards(AuthGuard)`, у каждого метода
`@Header('Cache-Control', 'no-store')`, `candidates` объявлен **до** `:rideId`; POST — `@Res({ passthrough: true })`
201/200.

**Шаг 8. Worker** (`route-rides.events.ts`, `route-ride-check.processor.ts`, `QUEUE.routeRideCheck`,
`RouteRidesWorkerModule`, `routeRidesOutboxRoutes` в `worker.module.ts`). `process(job)`: имя ≠ события — исключение;
payload невалиден — `skipped`; `finalAttempt = attemptsMade + 1 ≥ opts.attempts`. `check(rideId, revision)`: `claim` →
`evaluate`: `matchGeometry(routeId, userId)` (`null` → `failed: corridor_invalid`, лог `route_unavailable`) →
`readSource(activityId)` (`null` → `failed: storage`) → `trackLine(userId, activityId)` → `analyze(bytes, format,
{ ...geometry, widthM: 50 }, matchWindowOf(ride.activity), now, line)`; `!ok`: `implausible` → `not_passed`
`['implausible']`, `timeout|unreadable|corridor_invalid` → `failed` с кодом, прочее → `failed: unreadable`; исключение
окружения — проброс (ретрай), на финальной — `failed: error`. `record` — одна `updateOne` своей ревизией (`checking` в
фильтре), без транзакции и без событий. Лог — id, ревизия, статус, код/первая причина, мс; без названий и координат.

**Шаг 9. Стирание**: `RouteRideErasure.erase(userId)` (`deleteMany({ userId })` → число), экспорт из `index.ts`, шаг
`route-rides` в `AccountErasureService.run` **после `tracks`, до `notifications`**, `RouteRidesCoreModule` в imports
`AccountWorkerModule`. Тест — в `account/account-erasure.int.test.ts` (заезды удалённого стёрты, чужие целы, повтор —
0) и комментарий порядка в `AccountErasureService`.

**Шаг 10. Документация** — §10.

**Test matrix.**

| Уровень | Файл | Что |
|---|---|---|
| unit | `packages/contracts/src/route-rides/route-ride.schema.test.ts` | tolerantEnum, запрос «ровно одно поле», пределы |
| unit | `packages/api-client/src/route-rides.test.ts` | URL/метод/токен/разбор пяти методов |
| unit | `apps/api/src/modules/route-rides/route-rides.policy.test.ts` | окно, effectiveStatus, verdict, best/previous/дельты/ничьи, summary, сортировка, кандидаты (indoor, рамки, ≤ 30, `rideId` через `primaryId`), findExisting |
| unit | `apps/api/src/error-messages.test.ts` | тексты новых кодов (существующий тест) |
| int | `apps/api/src/modules/route-rides/route-rides.int.test.ts` | AC1–AC7, AC9 (ниже) |
| int | `apps/api/src/modules/route-rides/route-ride-check.int.test.ts` | worker: эталоны, сбои, ревизии, зависшие |
| int | `apps/api/src/modules/tracks/activity-source.int.test.ts` | `liveActivities` |
| int | `apps/api/src/modules/account/account-erasure.int.test.ts` | шаг `route-rides` |
| int | `apps/api/src/db/migrations/migrations.int.test.ts` | `0032_route_rides` |
| регресс | все тесты `results`, `routes`, `rides`, `packages/tracks` (golden) | без изменений, зелёные |

Int `route-rides.int.test.ts` (хелперы — новый `apps/api/test/route-rides.ts`: `routeRidesDb`, `catalogCorridorRoute`
(=`corridorRoute` + `catalog: { city: 'minsk', surfaces, publishedAt }`), `ownCorridorRoute(h, userId)` (маршрут райдера с
линией `CORRIDOR`), `routeRidesWorker(h)` (как `resultsWorker`: события `route-rides.check-requested` → `process`),
`ridesUrl(routeId, path)`):
1. AC1 — `clean.gpx` (`rideGpx`) по маршруту каталога → `201 queued`, одно событие outbox → worker → `passed`,
   `elapsedSec` = эталон ±1 с, `routeDistanceM` = `segment.distanceM`, сводка `count 1 / passedCount 1 / best`.
2. AC2 — `stop-80pct.gpx` → `not_passed` `no_finish`, `wobble-3pct.gpx` → `off_corridor`; без времени; `best` их не
   учитывает; `window-start-before.gpx` → `passed` (окно = время заезда, `outside_window` не возникает).
3. AC3 — свой готовый маршрут → `passed`; чужой непубличный, свой не готовый, неизвестный, платформа не в каталоге,
   чужой `hidden` — `404` на **всех пяти** ручках; одобренный чужой в каталоге — доступен.
4. AC4 — три заезда (два `passed` разного времени, один `not_passed`): `isBest`, `deltaToBestSec`, `previous`,
   `deltaToPreviousSec`; строки — новые по дате сверху.
5. AC5 — повтор POST той же активности → `200`, тот же `id`, событий не прибавилось; тот же GPX импортом Garmin
   (`importRide` — дубль группы) по `activityId` дубля и по `uploadId` → тот же заезд; заезд `failed` (прямой записью)
   → `200`, `checkRevision 2`, новое событие; поздний `check(id, 1)` — `skipped`.
6. AC6 — загрузка без разбора → `409 ROUTE_RIDE_NOT_READY`; негодный файл после разбора (`failed`) →
   `409 ROUTE_RIDE_UPLOAD_FAILED`; чужая активность/загрузка → `404`; 31-й POST за час → `429 RATE_LIMITED`; 100 живых
   заездов (прямой вставкой с живыми активностями) → `409 ROUTE_RIDE_QUOTA_EXCEEDED`; с осиротевшими — POST проходит и
   сироты удалены.
7. AC7 — удаление загрузки (`POST /v1/tracks/uploads/:id/delete`) → заезд пропал из списка, `GET`/`track` → `404`;
   свой маршрут удалён (`POST /v1/routes/mine/:id/delete`) или маршрут каталога снят с публикации → `404`; снова
   опубликован — заезды видны (данные не стёрты).
8. AC9 — ключи ответов ровно по §11 (`Object.keys` сортированно): нет `userId`, `activityId` (кроме кандидатов),
   `sha256`, `trackMap`, `engineVersion`, датчиков, координат вне `/track`; `Cache-Control: no-store` у всех пяти;
   без токена — `401`; `GET …/rides/candidates` не уходит в pipe `Uuid` (200, не 400); не-UUID `rideId` — `400`.
9. Кандидаты — заезд вне рамки маршрута (`far-away.gpx`) и `cycling_indoor` (`rideGpx(…, { type })`) не попадают,
   старше 365 дней — нет; у проверенного — `rideId`, у дубля группы — тот же `rideId`; ≤ 30.

Int `route-ride-check.int.test.ts`: `parseLimits.timeoutMs` крошечный → `failed: timeout`; подмена `analyze` с
исключением: не финальная попытка — проброс, финальная — `failed: error`; `readSource` → `null` (удалён файл
хранилища) → `failed: storage`; маршрут стал невидим до проверки → `failed: corridor_invalid`; `implausible` →
`not_passed`; зависший `checking` (сдвиг `travelTo` > 15 мин) — `GET` показывает `failed`/`error`, POST перепоставляет;
`/track`: `pending` до проверки, `ready` после (`segment`, `offRuns`), `unavailable` у `failed`.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` ширина коридора 50 м и окно «время заезда ± 1 мин»; кандидаты — 365 дней, ≤ 30; квота 100 на
  маршрут; лимит 30/ч.
- `[ASSUMPTION]` повторная проверка того же заезда возвращает существующий результат (кроме `failed`).
- Маршрут команды и маршрут райдера идут через один порт: риск отдать линию сверки чужого непубличного маршрута —
  видимость проверяется в каждой точке (POST, чтения, worker перед сверкой не нужен — проверено при создании, но
  чтение результата снова проверяет видимость).
- Нагрузка worker: сверка — тот же семафор `PARSE_THREADS_MAX`; очередь отдельная, параллелизм 1, гонки не ждут
  заездов по маршруту дольше, чем сейчас ждут друг друга (architect оценит, нужен ли приоритет гонок).

## 8.1 Requirements Consistency (заполняет architect)

Блокеров нет. Находки — с рекомендацией; **вопросы человеку — RC-1 и RC-7** (по умолчанию coder идёт по рекомендации).

- **RC-1. Удалённая активность: outbox «один тип — одна очередь».** `tracks.activity-ready/-removed` уже в
  `results-intake`; подписаться нельзя без fan-out в app-foundation. Варианты: (a) **фильтр на чтении** по живым
  активностям (`ActivitySource.liveActivities`) + удаление сирот этого маршрута в транзакции POST + стирание с аккаунтом;
  (b) регламент-уборщик `route-rides-maintenance` (скан всей коллекции, новая очередь и расписание — сверх PR1);
  (c) fan-out outbox в app-foundation (задача базы, follow-up — уже записан в правилах для `standings`).
  **Рекомендация — (a)**: AC7 выполняется сразу и детерминированно, без новой инфраструктуры. Цена: производные данные
  удалённого заезда (время сегмента, разметка позиций без координат) остаются невидимыми до следующего POST по этому
  маршруту или удаления аккаунта. **Вопрос человеку:** приемлемо ли это хранение (ПДн минимальны — без координат и
  датчиков)? Если нет — follow-up (b) или (c) отдельной задачей.
- **RC-2. Расширение `ActivitySource`.** В §3 п. 3 перечислены существующие методы; для фильтра 100 заездов одним
  запросом нужен аддитивный `liveActivities(userId, ids) → Map<id, { primaryId }>`. Альтернатива — `activity()` на
  каждый заезд: ≤ 100 × (активность + загрузка + линия ≤ 1000 точек) на каждое чтение — отвергнуто. Метод аддитивный,
  потребители `results`/`disputes` не затронуты. → 8.2 Deviations.
- **RC-3. Идентичность «заезда группы дублей».** Состав и основная группы меняются (поздний импорт Garmin, удаление).
  Решение: проверяется **основная группы на момент POST** (`activityId` хранится); существующий заезд ищется по текущей
  основной его активности (`liveActivities[..].primaryId === основная запроса`); гонку двух POST одной группы ловит
  уникальный `(userId, routeId, activityId)`. Принятое ограничение: слияние двух групп, у каждой из которых уже был
  заезд, оставляет два заезда (оба видимы).
- **RC-4. Окно ±1 мин корректно.** `verdict` ставит `outside_window`, если `start < startsAt` или `finish ≥ closesAt`;
  ворота — интерполяция между точками трека, т. е. внутри `[первая, последняя точка]` = `[startedAt, endedAt]` той же
  санитизации (`loadTrack` → `summarizeTrack`). Поэтому причина не возникает; ±1 мин — запас на дрейф сводки при смене
  версии разбора. Тест — фикстура `window-start-before.gpx` → `passed`. `CORRIDOR_ENGINE_VERSION`/golden не трогаем.
- **RC-5. Финальный провал и зависшие.** Финальная попытка BullMQ → `failed: error` (как гонки). Задача, потерянная
  при падении worker (stalled сверх лимита), оставила бы `checking` навсегда. Варианты: (a) **«ленивый» статус** —
  `effectiveStatus` при чтении (`queued` > 2 ч, `checking` > 15 мин → `failed: error`), POST перепоставляет такой
  заезд; (b) регламент как `ResultsMaintenanceProcessor` (очередь + расписание). **Рекомендация — (a)**: видимо
  райдеру, есть действие («проверить снова»), без новой очереди; панели нет (личные данные). Правило «dead-letter →
  панель» здесь неприменимо — организатора нет; фиксируется в `pokatim-backend.md`.
- **RC-6. Кандидаты: 365 дней, ≤ 30.** `listInRange` сортирует по старту и режет **до** фильтра рамок; рамки считаются
  по линиям (до 1000 точек на активность). Решение: скан `candidatesScan = 200` последних основных → фильтр
  (`cycling_indoor` нет, `boundsNear(…, 600 м)` как `mayMatch`) → ≤ 30. `[ASSUMPTION]`: у райдера с > 200 заездов за год
  старые совпадения не видны в выборе (их можно проверить загрузкой файла). Follow-up при жалобах — геозапрос по
  `activity_tracks_line_2dsphere` в `tracks`.
- **RC-7. `activityId` дубля и вид спорта.** В гонках `activityId` не основной → `409 ATTEMPT_SOURCE_INVALID`. Здесь
  `uploadId` по ТЗ ведёт к основной группы; для единообразия **рекомендация** — и `activityId` дубля приводить к
  основной (без нового кода ошибки). Спорт в POST не ограничиваем (судит движок, как явные попытки гонок); из
  кандидатов `cycling_indoor` исключён. **Вопрос человеку:** согласны с приведением дубля к основной?
- **RC-8. Маршрут удалён/снят/скрыт.** `routes` не знает `route-rides` — каскада нет. Заезды становятся невидимыми
  (404 на всех ручках), не удаляются: повторная публикация возвращает историю. Хранятся до удаления аккаунта
  (данные самого райдера). Удалённый маршрут (id исчез навсегда) — follow-up уборщик вместе с RC-1 (b).
- **RC-9. Видимость в worker.** §8 считает проверку в worker ненужной. Рекомендация — проверять: `matchGeometry`
  порта уже с условием видимости (тот же запрос), иначе worker прочитал бы линию сверки маршрута, к которому райдер
  потерял доступ. Невидим → `failed: corridor_invalid` (и так скрыт), повтор POST после возврата видимости
  перепроверит.
- **RC-10. Нагрузка и приоритет гонок.** `PARSE_THREADS_MAX = 1` на процесс, очередь FIFO; очередь `route-ride-check`
  с параллелизмом 1 занимает ≤ 1 слот → попытка гонки ждёт не более одной сверки заезда (≤ 30 с таймаута). Приоритет
  BullMQ не нужен; при росте — отдельный процесс worker (вне PR1).
- **RC-11. Квота мягкая.** Подсчёт живых заездов — до транзакции; параллельные POST разных групп могут превысить 100 на
  единицы (ограничено лимитом 30/ч). Как `ROUTE_QUOTA_EXCEEDED` (мягкая) — принимаем, без замка.
- **RC-12. Коды ответа POST.** `201` — новый заезд; `200` — существующий (в т. ч. перепоставленный `failed`).
  Тело — `RouteRideDetail` (как участие: 201/200).
- **RC-13. Сравнение у `not_passed`/`failed`.** `best` — всегда лучший пройденный (если есть), `isBest = false`;
  `previous` — предыдущий по дате пройденный до этого заезда при любом статусе; обе дельты — только у `passed`
  (иначе `null`). У самого лучшего `deltaToBestSec = 0`.
- **RC-14. Маршрут в ответе.** Экран (PR2) открывается и из истории, не зная, каталог это или «Мои»: в списке и детали
  — `route: { id, title, distanceM }` (название видимого райдеру маршрута; в логи не пишется).
- **RC-15. Ширина коридора.** Пишется в документ (`corridorWidthM`) — смена `ROUTE_RIDE_POLICY.corridorWidthM` не
  переписывает старые вердикты молча (как `engineVersion`).

## 8.2 Deviations from spec

- **RC-2 (решение человека, 2026-10-28): аддитивный метод `ActivitySource.liveActivities(userId, ids)`** сверх
  перечня §3 п. 3 (`TracksRepository.ownActivityHeads` — `_id`/`duplicateOf` своих активностей одним запросом).
  Потребители `results`/`disputes` не затронуты.
- **RC-1 (решение человека): вариант (a)** — фильтр на чтении по живым активностям + удаление сирот маршрута в
  транзакции нового заезда + стирание с аккаунтом; производные данные удалённого заезда (время сегмента, позиции без
  координат) хранятся до следующего нового заезда по маршруту или удаления аккаунта. Уборщик (b) / fan-out (c) —
  follow-up.
- **RC-6 (решение человека):** кандидаты — скан 200 последних основных за 365 дней → фильтр рамок → ≤ 30.
- **RC-7 (решение человека):** `activityId` дубля приводится к основной группы (без нового кода ошибки); спорт в POST
  не ограничен.
- Реализация: граница зависания — общая `stuckBounds(now)` политики (вместо отдельной функции на статус) — одна и та
  же для `effectiveStatus` и фильтра `requeue`.

## 8.3 Security checklist

AuthN/AuthZ: всё `AuthGuard`, `@CurrentUser()`; видимость маршрута — каталог или свой; активность — своя.
Входные данные: `strictObject`, `Uuid`. Данные наружу: явный список полей, без `userId`, id активности наружу —
только свои, без координат кроме своей линии в `/track`, без датчиков и биометрии, без `sha256`/ключей.
Злоупотребления: лимит 30/ч, квота 100 на маршрут, кандидаты ≤ 30. Секреты и логи: в логах — id и коды, без
названий маршрутов и координат. Аудит: не требуется (действия райдера над своими данными).

## 9. Acceptance Criteria

1. Синтетический трек, проходящий маршрут каталога целиком, → `passed`, время = время сегмента движка.
2. Трек, сошедший с маршрута / не доехавший до финиша → `not_passed` с причиной `off_corridor` / `no_finish`,
   без времени в сводке «лучший».
3. Свой готовый маршрут из «Моих» проверяется; чужой непубличный, не готовый, неизвестный — `404`.
4. Сводка: `count`, `passedCount`, `best`; деталь — `isBest`, `deltaToBestSec`, `previous`, `deltaToPreviousSec`.
5. Повторный POST той же активности (или её дубля) → тот же заезд, без новой проверки; `failed` → новая ревизия.
6. Загрузка в обработке → `409 ROUTE_RIDE_NOT_READY`; чужая активность → `404`; лимит → `429`; квота → `409`.
7. Удаление аккаунта стирает заезды; удалённая активность и недоступный маршрут — заезд не виден.
8. Тесты гонок, `packages/tracks` и golden коридора — зелёные без изменений; `pnpm check` зелёный.
9. Int-тест ключей ответов (нет `userId`, координат вне `/track`, датчиков).

## 10. Documentation Impact

`docs/product/routes.md`, `.claude/rules/pokatim-backend.md`, `pokatim-security.md`, `pokatim-db.md`,
`apps/api/src/db/migrations`.

Дополнение architect (что именно обновить):
- `docs/product/routes.md` — раздел «Заезд по маршруту»: R1–R4, статусы, причины, сравнение (RC-13), кандидаты
  (RC-6), удаление активности/маршрута (RC-1, RC-8), зависшие (RC-5).
- `.claude/rules/pokatim-backend.md` — модуль `route-rides` в перечне «Есть», зависимости `route-rides → routes, tracks,
  identity`, `account → route-rides`; порт `RouteRideRoutes`; `ActivitySource.liveActivities`; очередь
  `route-ride-check`, событие, ленивые зависшие; шаг стирания `route-rides` (после `tracks`) в списке портов стирания.
- `.claude/rules/pokatim-security.md` — раздел «Заезд по маршруту»: видимость маршрута на каждой ручке и в worker,
  `RouteRideRoutes` — в перечне точек без кэша маршрута райдера; поля наружу; лимит/квота; логи.
- `.claude/rules/pokatim-db.md` — `route_rides` (писатель, индекс, ревизия, `trackMap` без координат, сироты RC-1/RC-8),
  порядок шагов удаления аккаунта (+ `route-rides`).
- `.claude/rules/pokatim-contracts.md` — `route-rides/route-ride.schema.ts`, коды, методы api-client.
- `docs/architecture/README.md` — модуль в списке «Модули API» и короткий поток (POST → outbox → worker → чтение).
- `apps/api/src/db/migrations/0032_route_rides.ts`.

## 11. Implementation Context

**ENTRY POINTS**
- HTTP: `RouteRidesController` — `@Controller('routes/:routeId/rides')`, `@UseGuards(AuthGuard)`; методы (порядок
  объявления): `@Get()` list, `@Get('candidates')`, `@Post()` check, `@Get(':rideId')`, `@Get(':rideId/track')`. Pipe id —
  `new ZodValidationPipe(Uuid, FieldErrorCode)`; тело — `new ZodValidationPipe(RouteRideRequest, FieldErrorCode)`.
- Worker: `RouteRideCheckProcessor` — `@Processor(QUEUE.routeRideCheck, { concurrency: 1 })`, имя задачи =
  `ROUTE_RIDES_CHECK_REQUESTED`.
- Стирание: `AccountErasureService.run` — шаг `'route-rides'` → `RouteRideErasure.erase(userId)` → лог
  `deleted=<n>`.

**FILES TO CREATE**
- `packages/contracts/src/route-rides/route-ride.schema.ts`, `route-ride.schema.test.ts`
- `packages/api-client/src/route-rides.test.ts`
- `apps/api/src/modules/route-rides/`: `index.ts`, `route-rides.module.ts`, `route-rides.collection.ts`,
  `route-rides.repository.ts`, `route-rides.policy.ts`, `route-rides.policy.test.ts`, `route-rides.service.ts`,
  `route-rides-read.service.ts`, `route-rides.controller.ts`, `route-rides.events.ts`, `route-ride-check.processor.ts`,
  `route-ride-erasure.ts`, `route-rides.int.test.ts`, `route-ride-check.int.test.ts`
- `apps/api/src/modules/routes/route-ride-routes.port.ts`, `route-ride-routes.ts`
- `apps/api/src/db/migrations/0032_route_rides.ts`
- `apps/api/test/route-rides.ts`

**FILES TO MODIFY**
- `packages/contracts/src/common.ts` (3 кода в конец), `packages/contracts/src/index.ts` (+ `export * from
  './route-rides/route-ride.schema.ts'`), `packages/api-client/src/index.ts` (5 методов).
- `apps/api/src/error-messages.ts`, `apps/api/src/queues.ts`, `apps/api/src/app.module.ts` (+ `RouteRidesModule`),
  `apps/api/src/worker.module.ts` (+ `...routeRidesOutboxRoutes`, `RouteRidesWorkerModule`).
- `apps/api/src/modules/routes/routes.repository.ts` (+ `findRideable`), `routes.module.ts` (провайдер + экспорт
  `ROUTE_RIDE_ROUTES`), `routes/index.ts`.
- `apps/api/src/modules/tracks/activity-source.port.ts`, `activity-source.ts`, `tracks.repository.ts`
  (+ `ownActivityHeads`), `activity-source.int.test.ts`.
- `apps/api/src/modules/account/account-erasure.service.ts`, `account.module.ts`, `account-erasure.int.test.ts`.
- `apps/api/src/db/migrations/index.ts`, `migrations.int.test.ts`.
- Документы — §10.

**FILES TO READ** — §6.

**TYPES & SCHEMAS**

Контракты (`route-ride.schema.ts`; ответы — `z.object`, enum — `tolerantEnum`; запрос — `strictObject`):
```ts
export const ROUTE_RIDE_STATUSES = ['queued', 'checking', 'passed', 'not_passed', 'failed'] as const; // только в конец
export const ROUTE_RIDE_MAX_PER_ROUTE = 100;
export const ROUTE_RIDE_CANDIDATES_MAX = 30;
export const RouteRideRequest = z.union([z.strictObject({ activityId: Uuid }), z.strictObject({ uploadId: Uuid })]);
export const RouteRideRouteRef = z.object({ id: Uuid, title: z.string(), distanceM: z.number().int() });
export const RouteRideActivity = z.object({ startedAt: iso, source: tolerantEnum(TRACK_SOURCES),
  elapsedSec: int, distanceM: int });
export const RouteRideRef = z.object({ id: Uuid, elapsedSec: int, rideStartedAt: iso }); // best / previous
export const RouteRideRow = z.object({ id: Uuid, status: tolerantEnum(ROUTE_RIDE_STATUSES),
  reason: tolerantEnum(ATTEMPT_REJECTIONS).nullable(), elapsedSec: int.nullable(), isBest: z.boolean(),
  activity: RouteRideActivity, createdAt: iso });
export const RouteRidePage = z.object({ route: RouteRideRouteRef,
  summary: z.object({ count: int, passedCount: int, best: RouteRideRef.nullable() }),
  items: z.array(RouteRideRow).max(ROUTE_RIDE_MAX_PER_ROUTE) });
export const RouteRideCandidate = z.object({ activityId: Uuid, startedAt: iso, source: tolerantEnum(TRACK_SOURCES),
  elapsedSec: int, distanceM: int, rideId: Uuid.nullable() });
export const RouteRideCandidates = z.object({ items: z.array(RouteRideCandidate).max(ROUTE_RIDE_CANDIDATES_MAX) });
export const RouteRideDetail = z.object({ id: Uuid, route: RouteRideRouteRef, status: tolerantEnum(ROUTE_RIDE_STATUSES),
  reason: tolerantEnum(ATTEMPT_REJECTIONS).nullable(),        // первая причина; только not_passed
  failure: tolerantEnum(ATTEMPT_FAILURES).nullable(),         // только failed
  elapsedSec: int.nullable(), routeDistanceM: int.nullable(), // только passed
  activity: RouteRideActivity,
  comparison: z.object({ best: RouteRideRef.nullable(), isBest: z.boolean(), deltaToBestSec: int.nullable(),
    previous: RouteRideRef.nullable(), deltaToPreviousSec: int.nullable() }),
  createdAt: iso, checkedAt: iso.nullable() });
export const RouteRideTrack = z.object({ rideId: Uuid,
  line: z.array(LonLat).min(2).max(MY_ATTEMPT_TRACK_MAX_POINTS), segment: TrackMapRun.nullable(),
  offRuns: z.array(TrackMapRun).max(MY_ATTEMPT_TRACK_MAX_RUNS), marks: tolerantEnum(ATTEMPT_TRACK_MARKS) });
```
(`iso` = `z.iso.datetime()`, `int` = `z.number().int()`; знаковые дельты — `int`, отрицательная = быстрее.)

Коды ошибок (конец `defineErrorCodes`, комментарий `// route-rides-01: …`) и тексты `PROJECT_ERROR_MESSAGES`:
- `ROUTE_RIDE_NOT_READY` (409) — «Заезд ещё обрабатывается, попробуйте чуть позже»
- `ROUTE_RIDE_UPLOAD_FAILED` (409) — «Файл заезда не удалось обработать»
- `ROUTE_RIDE_QUOTA_EXCEEDED` (409) — «Достигнут предел заездов по маршруту»
- прочее — базовые `NOT_FOUND` (404), `RATE_LIMITED` (429 + `RateLimitedDetails`), `VALIDATION_FAILED` (400), `UNAUTHORIZED`.

api-client: `listRouteRides(accessToken, routeId) → RouteRidePage`; `listRouteRideCandidates(accessToken, routeId) →
RouteRideCandidates`; `checkRouteRide(accessToken, routeId, body: RouteRideRequest) → RouteRideDetail`;
`getRouteRide(accessToken, routeId, rideId) → RouteRideDetail`; `getRouteRideTrack(accessToken, routeId, rideId) →
RouteRideTrack`.

Документ (`route-rides.collection.ts`):
```ts
export const ROUTE_RIDES_COLLECTIONS = { rides: 'route_rides' } as const;
export type RouteRideStatus = 'queued' | 'checking' | 'passed' | 'not_passed' | 'failed';
export interface RouteRideDoc {
  _id: string; userId: string; routeId: string;
  activityId: string;                       // основная группы на момент POST
  activity: { startedAt: Date; endedAt: Date; source: TrackSource; elapsedSec: number; distanceM: number }; // снимок
  corridorWidthM: number;                   // 50 на момент создания
  status: RouteRideStatus; checkRevision: number; checkAttempts: number;
  reasons: AttemptRejection[]; failure: AttemptFailure | null;
  segment: CorridorSegment-поля без noisePoints (startedAt, finishedAt, elapsedSec, distanceM, offCorridorM,
           offCorridorShare, maxExcursionM, coverage) | null;
  touchedCorridor: boolean | null; engineVersion: number | null;
  trackMap: TrackMap | null;                // позиции на линии activity_tracks, без координат
  createdAt: Date; updatedAt: Date; checkedAt: Date | null;
}
```
Датчиков, флагов, `diagnostics`, `candidates` не хранить (минимизация).

Индекс (миграция `0032_route_rides`, export `ROUTE_RIDES_INDEXES`; `ensureCollection` из `0002_identity`):
`route_rides_user_route_activity_unique` — `{ userId: 1, routeId: 1, activityId: 1 }`, `unique: true` (дедуп гонки POST;
префикс обслуживает список/квоту `(userId, routeId)` и стирание `{ userId }`). Других индексов не нужно.

Репозиторий `RouteRidesRepository` (единственный писатель):
`listOwn(userId, routeId, session?)` (проекция без `trackMap`), `findOwn(userId, routeId, id)`,
`findByActivity(userId, routeId, activityId)`, `insert(tx, doc)`, `requeue(tx, id, checkRevision, stuck: { queuedBefore,
checkingBefore }, now): Promise<boolean>` (`$inc checkRevision`, сброс итога в `null`/`[]`, `status: 'queued'`),
`deleteOrphans(tx, userId, routeId, ids)`, `claim(id, checkRevision, now)` (`queued|checking` → `checking`,
`$inc checkAttempts`), `record(id, checkRevision, result, now): Promise<boolean>` (фильтр `status: 'checking'`),
`deleteAllOf(userId): Promise<number>`.

Порт `routes` (`route-ride-routes.port.ts`):
```ts
export const ROUTE_RIDE_ROUTES = Symbol('ROUTE_RIDE_ROUTES');
export interface RideableRoute { id: string; title: string; distanceM: number; isLoop: boolean; bounds: Bounds;
  access: 'catalog' | 'own' }
export interface RouteRideRoutes {
  /** IN_CATALOG или свой готовый (ownRider), без кэша; иначе null */
  rideable(routeId: string, userId: string): Promise<RideableRoute | null>;
  /** те же условия; линия сверки для worker; нет геометрии — null */
  matchGeometry(routeId: string, userId: string): Promise<RouteMatchGeometry | null>;
}
```
Реализация `RouteRideRoutesService` (`route-ride-routes.ts`): `RoutesRepository.findRideable(userId, id)` —
`findOne({ _id: id, status: 'ready', $or: [IN_CATALOG, ownRider(userId)] }, { projection: { title, distanceM, isLoop,
origin, ownerUserId } })`; рамка — `boundsOf(displayLine(id))`; линия сверки — `geometry(id).matchLine`; `access` —
`origin === 'rider' && ownerUserId === userId ? 'own' : 'catalog'`.

Порт `tracks` (аддитивно): `liveActivities(userId: string, ids: readonly string[]): Promise<Map<string, { primaryId:
string }>>` (≤ 200 id; пустой вход — пустая карта).

Политика (`route-rides.policy.ts`):
```ts
export const ROUTE_RIDE_POLICY = {
  corridorWidthM: 50, windowMarginMs: 60_000,
  candidatesDays: 365, candidatesScan: 200, candidatesLimit: 30, boundsMarginM: 600,
  maxPerRoute: 100, userLimit: { limit: 30, windowSec: 3600 },
  stuckQueuedMs: 2 * 3_600_000, stuckCheckingMs: 15 * 60_000,
} as const;
```
Функции: `matchWindowOf`, `effectiveStatus`, `verdictOf`, `bestOf`, `previousOf`, `comparisonOf`, `summaryOf`,
`sortRides`, `candidateRows`, `findExisting` (§7 шаг 5).

События и очередь:
- `QUEUE.routeRideCheck = 'route-ride-check'` (комментарий: jobId = id события outbox, параллелизм 1).
- `ROUTE_RIDES_CHECK_REQUESTED = 'route-rides.check-requested'`, payload
  `RouteRidesCheckRequested = z.object({ rideId: z.uuid(), checkRevision: z.number().int().positive() })`.
- `routeRidesOutboxRoutes = { [ROUTE_RIDES_CHECK_REQUESTED]: QUEUE.routeRideCheck } as const`.

Лимит: ключ `route-rides-user:<uid>`, правило `ROUTE_RIDE_POLICY.userLimit`, отказ — `429 RATE_LIMITED`
`{ retryAfterSec }`.

Модули: `RouteRidesCoreModule` (imports `RoutesCoreModule`, `TracksCoreModule`; providers/exports
`RouteRidesRepository`, `RouteRideErasure`), `RouteRidesModule` (imports `IdentityModule`, `RouteRidesCoreModule`;
controller; providers `RouteRidesService`, `RouteRidesReadService`), `RouteRidesWorkerModule` (imports
`RouteRidesCoreModule`, `BullModule.registerQueue({ name: QUEUE.routeRideCheck })`; provider `RouteRideCheckProcessor`).
`index.ts` экспортирует три модуля, `routeRidesOutboxRoutes`, `RouteRideErasure`.

**TESTS** — матрица §7. Заезды — `rideGpx(<фикстура corridor>, startAt)` + `uploadRide`/`importRide`; маршруты —
`corridorRoute` (+ `catalog`) и маршрут райдера с линией `CORRIDOR` (новый хелпер; `seedRiderRoute` даёт короткую
`RIDER_LINE` — для отрицательных тестов видимости). Обработка событий — свой `routeRidesWorker(h)`
(`resultsWorker` фильтрует только типы `results`, гонки не задевает).

**OUT OF SCOPE** — §4; плюс: изменения `results`, `AttemptCheckProcessor`, `RouteCatalog`/`RouteGeometry`/`RideRoutes`,
`@pokatim/tracks`, golden; регламент-уборщик и fan-out outbox (RC-1, RC-8); геозапрос кандидатов (RC-6); экран
приложения (PR2).

**Объём PR.** Оценка ≈ 2–2,5 тыс. строк с тестами. Делить не обязательно (человек хочет PR1 = модель+API+worker);
коммиты — по шагам §7 (контракты → порты → политика → данные → API → worker → стирание → документы). Если ревью
просит разрезать: PR1a — контракты, api-client, порт `RouteRideRoutes`, `liveActivities` (без поведения для
пользователя); PR1b — модуль `route-rides`, миграция, worker, стирание.

## 12. Outcome (заполняет coder)

**Сделано** (ветка `feature/route-ride`, коммиты по шагам §7): контракты `route-rides/route-ride.schema.ts` + 3 кода
в конце `ErrorCode` и тексты; 5 методов api-client; порт `routes` `RouteRideRoutes` (`findRideable`: `IN_CATALOG` или
`ownRider`, без кэша); `ActivitySource.liveActivities` (8.2, RC-2); модуль `route-rides` (коллекция, репозиторий,
политика, POST и чтения, контроллер, worker `route-ride-check`, порт стирания); миграция `0032_route_rides` (номер
свободен в `origin/develop` на 2026-10-28); шаг `route-rides` в `AccountErasureService` после `tracks`; документы §10.

**Тесты:** unit — `route-ride.schema.test.ts` (6), `api-client/route-rides.test.ts` (3), `route-rides.policy.test.ts`
(11), `common.test.ts` (сторож порядка кодов + 3 кода в конце); int — `route-rides.int.test.ts` (14: AC1–AC7, AC9,
кандидаты), `route-ride-check.int.test.ts` (8: эталон, `timeout`, `implausible`, сбой окружения/финальная попытка,
`storage`, `corridor_invalid`, ревизии, зависшие `checking`/`queued`, `/track` pending/ready/unavailable),
`routes/route-ride-routes.int.test.ts` (3: видимость, N1, без кэша), `activity-source.int.test.ts` (+1
`liveActivities`), `account-erasure.int.test.ts` (+1 шаг, + шаг в тесте логов), `migrations.int.test.ts` (+1 `0032`).
Тесты гонок, `results`, `routes`, `rides`, `packages/tracks` (golden коридора) — без изменений, зелёные.

**Отрицательное доказательство** (фильтр по живым активностям, RC-1): в `RouteRidesReadService.visible` фильтр
`heads.has(ride.activityId)` заменён на «всегда true» → AC7 «удаление загрузки → заезд пропал» красный (заезд в
списке); возвращён — зелёный.

**Проверки** (изолированные: `MONGO_URL_TEST=…:27117/pokatim_route_rides_test`, `REDIS_URL_TEST=…:6479/9`, Node 24.22.1):
- прогон 2 `TURBO_CONCURRENCY=1 pnpm check` → `EXIT=1`: 9 тестов лимитов частоты в чужих модулях (rides, profile,
  notifications, disputes, session, races-public, track-uploads) — счётчики Redis сбрасывались посреди теста; те же 7
  файлов отдельно — `7 passed / 160 tests`. Прогон 3 — API `140 files / 1535 tests passed`; `@pokatim/admin`
  `SignInScreen.test.tsx` — таймаут 5 с под нагрузкой (файл не менялся; отдельно 3× — 15/15).
- финальный `TURBO_CONCURRENCY=1 pnpm check` → `EXIT=0` (тесты пакетов и API — кэш прогона 3 на тех же исходниках):
  ```
  @pokatim/api:test:  Test Files  140 passed (140)
  @pokatim/api:test:       Tests  1535 passed (1535)
  @pokatim/admin:test:  Test Files  38 passed (38)
  @pokatim/admin:test:       Tests  357 passed (357)
  @pokatim/app:test: Test Suites: 188 passed, 188 total
  @pokatim/app:test: Tests:       1727 passed, 1727 total
   Tasks:    15 successful, 15 total
  Cached:    13 cached, 15 total
  ```

**Отклонения** — 8.2. **Риски:** квота мягкая (RC-11); производные данные удалённого заезда хранятся до следующего
нового заезда по маршруту или удаления аккаунта (RC-1 a); у райдера с > 200 заездами за год старые совпадения не в
кандидатах (RC-6). Push не делался.

### Ревью pass 1 (claude + codex) — исправления автора

Codex — APPROVE без находок; Claude — APPROVE (MEDIUM 1, LOW 4, `findings.md`). Исправлено: MEDIUM — тест «чужой
заезд по видимому маршруту → 404 на деталь, track и POST; в списке и кандидатах чужого нет» и `/track` на удалённом и
снятом маршруте (AC7); отрицательное доказательство — без `this.route(...)` в `RouteRidesReadService.track` AC7
краснеет. LOW — удалены `RouteRidesRepository.findById` и `Visible.now`; `docs/product/routes.md` — сироты удаляются
при проверке нового заезда, случай удалённой основной активности группы описан. Не исправлено (LOW, принято):
параллельный POST одной группы (ветка `isDuplicateKey`) без int-теста. Модуль: `vitest run src/modules/route-rides`
— 34/34.
