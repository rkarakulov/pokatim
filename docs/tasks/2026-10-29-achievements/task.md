# Достижения и экран «Вспышка достижения»

Уровень: task3. Два PR: **A** — API (`apps/api`, `packages/contracts`, `packages/api-client`, миграция); **B** —
приложение (`apps/app`, `packages/i18n`). Панель не нужна: ручной выдачи и модерации достижений в v1 нет.

## 1. Title

Достижения райдера: каталог v1, выдача сверкой фактов, список в профиле, полноэкранная «Вспышка достижения».

## 2. Goal

Райдер получает достижения за гонки, заезды по маршрутам и кофе-райды, видит их в профиле и один раз — полноэкранной
«вспышкой» при следующем открытии приложения. Гоночное достижение можно сразу отправить в сторис готовой карточкой
результата (`races/story/[id]`, ADR-0018). Место под достижения в профиле оставлено задачей rider-profile (R10).

Решения автора (human gate 2026-10-29) — A1–A8 ниже; переносятся в `docs/product/profile.md` (раздел «Достижения»).

### Решения A1–A8

- **A1 — каталог v1, 9 достижений** (каждое — один раз на райдера, уровней нет):

  | Код | Название | Условие (факт) | Дата факта | Объект |
  |---|---|---|---|---|
  | `race_first_finish` | Первый финиш | строка райдера в текущей ревизии опубликованного протокола, статус не `dq` | старт лучшего сегмента самой ранней такой гонки | гонка |
  | `race_podium` | Подиум | то же, место 1–3 в своей группе | самая ранняя | гонка |
  | `race_win` | Победа | то же, место 1 в своей группе (`=1` тоже) | самая ранняя | гонка |
  | `races_5` | Пять гонок | 5 разных гонок с такой строкой | 5-я по дате | гонка (5-я) |
  | `route_first` | Первый маршрут | заезд по маршруту со статусом `passed` (активность не удалена) | старт активности самого раннего | маршрут |
  | `routes_5` | Пять маршрутов | `passed` на 5 разных маршрутах | 5-й по дате | маршрут (5-й) |
  | `ride_first` | Первый кофе-райд | прошедший неотменённый нескрытый райд, где райдер «Иду» или организатор (как R8) | старт самого раннего | райд |
  | `ride_organizer` | Организатор | такой райд, где райдер организатор и есть ещё хотя бы один «Иду» | самый ранний | райд |
  | `rides_10` | Десять кофе-райдов | 10 таких райдов | 10-й по дате | райд (10-й) |

  START и Verified без пульса в протокол не входят — гоночные достижения только «в зачёте» (как R6).
- **A2 — выдача сверкой при чтении.** Сервер выводит набор заработанных достижений из фактов (порты `results`,
  `route-rides`, `rides`) и сверяет с сохранёнными выдачами райдера при его запросе списка: новое — выдать, пропавшее
  — отозвать. Worker, очередей и outbox-событий нет (ограничение «тип события → одна очередь», DV-1 слайса 08).
- **A3 — ретро-выдача тихая.** Всё, что найдено при первой сверке райдера, выдаётся сразу просмотренным (без вспышки);
  дата в списке — дата факта. Вспышка — только для выдач последующих сверок.
- **A4 — отзыв молча.** Факт пропал (DQ или новая ревизия протокола, удаление активности или заезда, отмена или
  скрытие райда, удаление райда модератором) — достижение скрывается из списка, вспышки и публичного профиля.
  Факт вернулся — достижение снова видно, уже просмотренное повторно не вспыхивает. Объект и дата факта
  пересчитываются при каждой сверке (например, «Подиум» переходит на другую гонку после DQ).
- **A5 — вспышка.** Полноэкранный экран при следующем открытии или возвращении в приложение (вошедший райдер): по
  одной выдаче, от старых к новым, «Дальше» / «Закрыть». Просмотренными помечаются показанные. Повторно не
  показывается ни на этом, ни на другом устройстве.
- **A6 — шеринг.** У гоночных достижений на вспышке и в карточке достижения — «Поделиться» → экран сторис
  результата гонки объекта (`/races/story/<raceId>`). У маршрутных и райдовых шеринга нет; новой карточки нет.
- **A7 — видимость.** В своём профиле — все достижения. В публичном профиле `/riders/<publicId>` — только гоночные
  (R9: публично — только протоколы), при тех же условиях публичности (имя и согласие). Маршруты и райды — личные.
- **A8 — список.** Только полученные (без «закрытых» целей и заглушек), от новых фактов к старым. Ни одного — блока
  нет.

## 3. Scope

### PR A — API

1. Модуль-композиция `achievements` (образец — `riders`/`standings`): каталог и правила — чистые функции над
   фактами; факты — только порты чужих модулей через `index.ts`; своя коллекция выдач — единственный писатель —
   репозиторий модуля.
2. Коллекция выдач (миграция `0035_achievements`, номер сверить с develop перед мержем): `userId`, `code`, объект
   (`kind` + `id`), дата факта, время выдачи, `seenAt`, `revokedAt`; уникальность `(userId, code)`. Признак «первая
   сверка выполнена» для A3 — способ выбирает architect.
3. `GET /v1/achievements` (`AuthGuard`, `no-store`) — сверка (A2–A4) и список видимых выдач: код, объект
   (`{ kind: 'race' | 'route' | 'ride', id, title }`), дата факта, `seen`. Параллельные запросы одного райдера не
   создают дублей и не падают.
4. `POST /v1/achievements/seen` (`AuthGuard`) — тело `{ codes: AchievementCode[] }` (1–9, без повторов): пометить
   просмотренными свои видимые выдачи; незнакомые/чужие/отозванные — без ошибки и без записи. Идемпотентно.
5. Публично: гоночные достижения в ответе публичного профиля или отдельным `GET /v1/riders/:publicId/achievements`
   (`PublicReadGuard`) — выбирает architect; вычисляются из протоколов без записи, без `seen`.
6. Удаление аккаунта удаляет выдачи (по образцу других модулей, `docs/product/account.md`).
7. Контракты (`@pokatim/contracts`): `AchievementCode` (через `tolerantEnum` для чтения в приложении), схемы ответа,
   тело `seen`; методы `api-client`.

### PR B — приложение

1. Блок «Достижения» в `/profile` (на месте комментария rider-profile) — сетка/список значков «Эмаль», нет
   достижений — блока нет. Нажатие — экран достижения (тот же макет, что вспышка, без «Дальше»).
2. «Вспышка» — полноэкранный маршрут (modal) поверх вкладок: значок, название, условие, объект (название гонки,
   маршрута или райда), дата; «Поделиться» (A6), «Дальше» (есть ещё) / «Закрыть». Хост вспышки в зоне вошедшего
   райдера запрашивает список при старте и возвращении приложения (`focusManager`), открывает вспышку при `seen:false`
   и после показа шлёт `seen`.
3. Публичный профиль `/riders/[id]` — блок гоночных достижений (SSR-посев как у остального экрана).
4. Тексты — `packages/i18n` (ru, en при наличии ключей en в проекте), a11y-подписи, тема — токены дизайн-системы.
   Анимация вспышки — с учётом «уменьшить движение».

## 4. Out of Scope

- Push-уведомление о новом достижении, уведомление в центре уведомлений.
- Новая карточка шеринга «Достижение», шеринг маршрутных и райдовых достижений.
- Уровни (бронза/серебро/золото), «закрытые» цели, прогресс «3 из 5».
- Панель: ручная выдача/отзыв, статистика достижений.
- Финишёры без места (START) в «гонках» статистики (RC-A3 (b) rider-profile) — отдельно.
- Сезонные достижения (победитель сезона и т. п.).

## 5. Architecture Context

Architecture Review — achievements (architect, 2026-10-29). **Status: CONCERNS** — блокеров нет; RC-1…RC-15 в 8.1 —
решения архитектора с рекомендацией, человеку подтвердить RC-4, RC-5, RC-6, RC-7, RC-13 (меняют формулировки spec/AC).

- **Приложения и пакеты.** PR A — `apps/api` (новый модуль `achievements`; новые порты в `rides`, `route-rides`;
  расширение порта `routes` `RouteRideRoutes`; шаг стирания в `account`), `packages/contracts`
  (`src/achievements/achievement.schema.ts`), `packages/api-client`, миграция `0035_achievements`. PR B — `apps/app`,
  `packages/i18n`. Новых пакетов нет (≥2 потребителей нет), в app-foundation ничего не уходит.
- **Граф модулей (новые рёбра).** `achievements → identity, profile, results, rides, route-rides` — только через
  `index.ts`; `account → achievements` (порт стирания, RC-6). `results`, `rides`, `route-rides`, `profile` об
  `achievements` не знают; `achievements` импортируют только `AppModule` (`AchievementsModule`) и
  `AccountWorkerModule` (`AchievementsCoreModule`). Циклов нет: ни один источник не зависит от `achievements`.
- **Nest-модули** (образец — `riders` + `standings`):
  - `AchievementsCoreModule` — `AchievementsRepository`, `AchievementErasure`; модулей не импортирует (только
    `MONGO_DB`); экспорт — `AchievementErasure` (и репозиторий для `AchievementsModule`).
  - `AchievementsModule` (API) — imports `IdentityModule`, `ProfileCoreModule` (`RIDER_PROFILES`),
    `ResultsCoreModule` (`RIDER_RESULTS`), `RidesCoreModule` (новый `RIDER_RIDES`), `RouteRidesCoreModule` (новый
    `RIDER_ROUTE_RIDES`), `AchievementsCoreModule`; controllers `AchievementsController`, `AchievementsPublicController`;
    providers `AchievementsService`, `PublicReadGuard`. Своего worker-модуля нет (A2).
- **Слои.** Controller (тонкий: guard, zod-pipe, `@CurrentUser`, `Cache-Control`) → `AchievementsService` (лимит,
  факты — порты, правила и план сверки — чистые функции `achievements.policy.ts`, запись — репозиторий, ответ — явный
  список полей) → `AchievementsRepository` (единственный писатель `achievement_grants`, `achievement_syncs`).
- **HTTP.**
  - `GET /v1/achievements` — `AuthGuard`, `no-store`, лимит `achievements-read:<uid>` → сверка (7.2) → `{ items }`.
  - `POST /v1/achievements/seen` — `AuthGuard`, `no-store`, `@HttpCode(204)`, лимит `achievements-seen:<uid>`, тело
    `MarkAchievementsSeenRequest`.
  - `GET /v1/riders/:publicId/achievements` — `AchievementsPublicController` (`@Controller('riders')`,
    `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`, pipe `RiderPublicId`) — RC-5. Путь отличается от
    `riders/:publicId` (`riders`) и `riders/:publicId/{me,reports}` (`profile`) статическим сегментом.
- **Контракты.** Только новые схемы (7.5); старые сборки приложения не затронуты. Ответы — `tolerantEnum` (код, вид
  объекта), запрос `seen` — строгий `z.enum`. Коды каталога — только в конец `ACHIEVEMENT_CODES`.
- **Данные.** `0035_achievements` (expand-only, без бэкфилла): коллекции `achievement_grants`, `achievement_syncs`,
  уникальный индекс `achievement_grants_user_code_unique { userId: 1, code: 1 }` (RC-1). Не append-only: выдачи —
  проекция фактов, отзыв — поле, стирание — `deleteMany`.
- **Очереди и outbox.** Нет (A2): ни задач BullMQ, ни событий, ни регламента. Сверка — в HTTP `GET` (лёгкая: ≤ ~10
  запросов по индексам, без разбора треков и рендера — красные флаги не задеты). ADR-0020 — RC-13.

## 5.1 Placement & Reuse Gate

**Переиспользуем (не копируем):**
- `results`: порт `RIDER_RESULTS` как есть — `publishedRows` (текущие ревизии, лимит `RIDER_RESULTS_MAX_ROWS`, лог
  `riders.rows_truncated`) и `racesOf` (названия). Предикат «в зачёте» — общий с `riders.policy` (RC-9).
- `profile`: `RIDER_PROFILES.findPublic` (условие публичности — в фильтре порта, как у `riders`).
- `route-rides`: семантика видимости заезда — та же, что `RouteRidesReadService.visible` (живая активность через
  `ActivitySource.liveActivities` + маршрут, видимый через `RouteRideRoutes`) — новый порт реализуется в модуле-владельце
  поверх `RouteRidesRepository` и этих же портов, не в `achievements`.
- `rides`: условия R8 — те же, что `RidesRepository.pastOf` (`participants.userId`, `status: 'published'`,
  `startsAt < now`; индекс `rides_participant_idx`).
- Инфраструктура: `AuthGuard`/`@CurrentUser` (`identity/index.ts`), `PublicReadGuard` и `PUBLIC_READ_CACHE_CONTROL`
  (`src/public-read.guard.ts`), `RateLimiter` и `CLOCK` (`@rkarakulov/api-kit/core`), `uuidv7`/`isDuplicateKey`
  (`@rkarakulov/api-kit/mongo`), `domainError` (`src/error-messages.ts`), `ZodValidationPipe` + `FieldErrorCode`,
  `ensureCollection` (`0002_identity`), `tolerantEnum`/`Uuid`/`LocalDate`/`minskToday` (`@pokatim/contracts`).
- Тестовый стенд: `test/harness.ts`, `test/identity.ts`, `test/standings.ts` (`seedProtocolRace`, `placedRow`,
  `dqRow`, `addRevision`), `test/route-rides.ts`, `test/rides.ts`, `test/tracks.ts`.

**Запрещённые дубли:**
- Чтение чужих коллекций из `achievements` (`race_protocol_rows`, `route_rides`, `rides`, `routes`, `profiles`,
  `activities`) — только порты из `index.ts` (AC8, `pnpm arch:check`).
- Второй расчёт «текущей ревизии», мест и DQ — только `publishedRows`; копия условий R8 или видимости заезда по
  маршруту в `achievements` — нет (условия живут в портах владельцев).
- Отдельный «публичный» набор правил: публичные гоночные достижения — те же чистые функции `achievements.policy`
  (подмножество `race_*`), что и в своём списке.
- Поле достижений в `PublicRiderProfile`/`RidersService` — нет (RC-5).
- Новая карточка шеринга, новый эндпоинт сторис — нет: `/races/story/<raceId>` как есть (RC-10).

## 6. Relevant Files

| Путь | Роль |
|---|---|
| `apps/api/src/modules/riders/{riders.module,riders.service,riders.policy,riders-public.controller}.ts` | образец модуля-композиции, публичного контроллера `riders/:publicId…`, предикат «в зачёте» |
| `apps/api/src/modules/standings/{standings.module,standings.repository}.ts` | образец «своя коллекция + порты», `isDuplicateKey` |
| `apps/api/src/modules/results/rider-results.{port,}.ts` | порт `RIDER_RESULTS` (переиспользуется без изменений, кроме RC-9) |
| `apps/api/src/modules/rides/{rides.repository,rides-history.service,rides.module,index}.ts` | `pastOf` (условия R8) → новый порт `RIDER_RIDES` |
| `apps/api/src/modules/route-rides/{route-rides-read.service,route-rides.repository,route-rides.module,index}.ts` | видимость заезда (`visible`) → новый порт `RIDER_ROUTE_RIDES` |
| `apps/api/src/modules/routes/{route-ride-routes.port,route-ride-routes,routes.repository}.ts` | `RouteRideRoutes` + `findRideable` → пакетное `rideableTitles` |
| `apps/api/src/modules/account/{account-erasure.service,account.module}.ts`, `route-rides/route-ride-erasure.ts` | шаг стирания и образец порта стирания |
| `apps/api/src/modules/sharing/story-card.service.ts`, `results/results-for-sharing.ts`, `results/results.policy.ts` (`storyCardEligible`) | проверка доступности сторис (RC-10) |
| `apps/api/src/db/migrations/{0033_rider_profile,0034_profile_reports,index,migrations.int.test}.ts` | образец миграции и её теста |
| `apps/api/src/modules/riders/riders.int.test.ts`, `apps/api/test/{standings,route-rides,rides}.ts` | образец int-тестов и посев фактов |
| `packages/contracts/src/profile/rider-profile.schema.ts`, `packages/contracts/src/common.ts` | образец схем ответов, `tolerantEnum` |
| `packages/api-client/src/index.ts` (`getRider`, `markNotificationRead`) | образец методов (публичный GET, POST → 204) |

## 7. Implementation Notes

### 7.1 Правила (чистые функции `achievements.policy.ts`)

`earnedAchievements(facts): Map<AchievementCode, Earned>`, `Earned = { object: { kind, id }, factAt: Date, title }`.
Каталог — `ACHIEVEMENT_RULES satisfies Record<AchievementCode, …>` (исчерпывающий: новый код без правила — ошибка
типов). Сортировка фактов — по времени ↑, при равенстве — id ↑ (детерминированно: объект не «прыгает» между
сверками).

| Код | Вход | Отбор | Объект и дата |
|---|---|---|---|
| `race_first_finish` | `RiderProtocolRow[]` | «в зачёте»: `status !== 'dq' && place !== null` (RC-9) | самая ранняя по `startedAt` |
| `race_podium` | то же | + `place <= 3` | самая ранняя |
| `race_win` | то же | + `place === 1` (`tied` не важен) | самая ранняя |
| `races_5` | то же | ≥ 5 строк (строка = гонка) | 5-я по `startedAt` ↑ |
| `route_first` | `RiderRouteRideFact[]` | все (порт уже отдал только видимые `passed`) | самый ранний по `startedAt` |
| `routes_5` | то же | ≥ 5 разных `routeId`; дата маршрута — его самый ранний заезд | 5-й маршрут по этой дате |
| `ride_first` | `RiderRideFact[]` | все (порт — условия R8) | самый ранний по `startsAt` |
| `ride_organizer` | то же | `organizer && goingCount >= 2` (RC-15) | самый ранний |
| `rides_10` | то же | ≥ 10 | 10-й по `startsAt` ↑ |

Публичный список — та же функция на `{ races: rows, routes: [], rides: [] }`, отфильтрованная по `kind === 'race'`.

### 7.2 Сверка при `GET /v1/achievements` (RC-1, RC-2)

1. Лимит `achievements-read:<uid>` (60/мин) → `429 RATE_LIMITED`.
2. Факты параллельно: `RIDER_RESULTS.publishedRows(uid)`, `RIDER_ROUTE_RIDES.passedOf(uid)`, `RIDER_RIDES.pastOf(uid)`
   → `earnedAchievements` → названия гонок-объектов `racesOf(ids)` (≤ 4 id). У строки опубликованного протокола
   гонка есть всегда (отмена после публикации запрещена, `races.service.ts` `cancel`); нет в карте — код в ответ не
   попадает (запись не трогается), лог `achievements.race_missing uid=<uid>`.
3. Сохранённое: `repository.listOf(uid)` (все, включая отозванные; ≤ 9) и `repository.syncedAt(uid)`;
   `first = syncedAt === null`.
4. План — чистая `reconcilePlan(stored, earned, first, now)`:
   - заработано, записи нет → `insert` (`seenAt = first ? now : null`, `grantedAt = now`, `revokedAt = null`);
   - заработано, запись отозвана → `restore` (`revokedAt = null`, новые `object`, `factAt`; **`seenAt` не трогать**);
   - заработано, запись видима, `object`/`factAt` другие → `refresh` (только `object`, `factAt`);
   - не заработано, запись видима → `revoke` (`revokedAt = now`);
   - иначе — ничего (устойчивое состояние — ноль записей).
5. Применение — по одной условной операции на код, без транзакции (каждая — один документ):
   - `insert` — `insertOne({ _id: uuidv7(), … })`; `isDuplicateKey(e, 'achievement_grants_user_code_unique')` —
     проигравший параллельный GET, не ошибка;
   - `revoke` — `updateOne({ userId, code, revokedAt: null }, { $set: { revokedAt, updatedAt } })`;
   - `restore`/`refresh` — `updateOne({ userId, code }, { $set: { object, factAt, revokedAt: null, updatedAt } })`
     (`seenAt`, `grantedAt` не в `$set`).
6. Только если `first` и шаги 5 завершились — `achievement_syncs.updateOne({ _id: uid }, { $setOnInsert: { firstSyncAt:
   now } }, { upsert: true })` (дубль `_id` при параллельном upsert — `isDuplicateKey`, не ошибка). **Порядок
   «выдачи → маркер» обязателен** (RC-1): кто увидел маркер, тот видит и тихие выдачи первой сверки.
7. Ответ: перечитать `listOf(uid)` (видимые; `seen` — из БД, с учётом записей параллельного запроса) ∩ `earned`
   (название и `factDate` — из фактов этого запроса) → сортировка `factAt` ↓, при равенстве — порядок каталога ↓.
8. Лог после записи (только если план не пуст): `achievements.sync uid=<uid> first=<bool> granted=<n> revoked=<n>
   restored=<n>` — без кодов объектов и названий.

Сбой посередине — следующий GET доводит до того же состояния (план идемпотентен). Устаревший параллельный GET может
перезаписать `object`/`factAt` значениями своего чтения — следующая сверка исправит (принятая eventual
consistency, не влияет на `seen`).

### 7.3 `POST /v1/achievements/seen`

Лимит `achievements-seen:<uid>` (120/ч) → `updateMany({ userId, code: { $in: codes }, revokedAt: null, seenAt: null },
{ $set: { seenAt: now, updatedAt: now } })` → `204`. Незнакомые для пользователя, отозванные и уже просмотренные —
без записи и без ошибки. Сверку не запускает.

### 7.4 Порты (RC-3)

- `rides` — `RIDER_RIDES` (`rider-rides.port.ts` + `rider-rides.ts`, в `RidesCoreModule`):
  `pastOf(userId): Promise<RiderRideFact[]>`, `RiderRideFact = { rideId, title, startsAt, organizer: boolean,
  goingCount }`. Репозиторий — новый `pastFactsOf(userId, now, limit)`: тот же фильтр, что `pastOf`, сортировка
  `startsAt ↑, _id ↑` (при усечении теряются новые, а не первые), проекция `title, startsAt, organizerUserId,
  goingCount`; предел `RIDER_RIDES_MAX_ROWS = 2000`, лог `achievements.rides_truncated uid=<uid>` при достижении.
  `pastOf`/`RidesHistoryService` не меняются.
- `route-rides` — `RIDER_ROUTE_RIDES` (`rider-route-rides.port.ts` + `rider-route-rides.ts`, в `RouteRidesCoreModule`):
  `passedOf(userId): Promise<RiderRouteRideFact[]>`, `RiderRouteRideFact = { routeId, routeTitle, startedAt }`
  (`startedAt` = `activity.startedAt`). Реализация: `RouteRidesRepository.passedOf(userId, limit)` (`{ userId, status:
  'passed' }`, проекция `routeId, activityId, activity.startedAt`, префикс уникального индекса; предел 2000 + лог) →
  `ActivitySource.liveActivities(userId, activityIds)` (как `visible`) → `RouteRideRoutes.rideableTitles(routeIds,
  userId)` → только заезды видимых маршрутов (RC-4). Зависшие статусы не важны: берётся только `passed`.
- `routes` — расширение `RouteRideRoutes`: `rideableTitles(routeIds, userId): Promise<Map<string, string>>` — то же
  условие, что `findRideable` (`status: 'ready'`, `IN_CATALOG | ownRider(userId)`, `distanceM` не `null`), одним
  `find` с `$in` (≤ 500 id), без кэша; новый `RoutesRepository.findRideableTitles`. `rideable`/`matchGeometry`,
  `RouteCatalog`/`RouteGeometry` не меняются.
- `results` — `RIDER_RESULTS` без изменений (RC-9 — только экспорт предиката).
- `profile` — `RIDER_PROFILES` без изменений.

### 7.5 Контракты (`packages/contracts/src/achievements/achievement.schema.ts`, экспорт из `src/index.ts`)

- `ACHIEVEMENT_CODES` (9 кодов A1, только в конец), `AchievementCode = z.enum(ACHIEVEMENT_CODES)` (запросы),
  `ACHIEVEMENT_OBJECT_KINDS = ['race', 'route', 'ride']`.
- `AchievementObject = z.object({ kind: tolerantEnum(KINDS), id: Uuid, title: z.string() })`.
- `Achievement = z.object({ code: tolerantEnum(ACHIEVEMENT_CODES), object: AchievementObject, factDate: LocalDate,
  seen: z.boolean() })`; `AchievementList = z.object({ items: z.array(Achievement) })`.
- `PublicRiderAchievement` — без `seen`; `PublicRiderAchievementList = { items }` (RC-7: `factDate`, не время).
- `MarkAchievementsSeenRequest = z.strictObject({ codes: z.array(AchievementCode).min(1).max(ACHIEVEMENT_CODES.length)
  .refine(без повторов, { error: fieldError('INVALID') }) })` — 400 `VALIDATION_FAILED`.
- api-client: `listAchievements(accessToken)`, `markAchievementsSeen(accessToken, codes)` (204 → `undefined`),
  `getRiderAchievements(publicId)` (`getPublic`). Новых кодов ошибок нет.

### 7.6 Коллекции (`achievements.collection.ts`)

- `achievement_grants`: `{ _id: uuidv7, userId, code, object: { kind, id }, factAt: Date, grantedAt: Date, seenAt:
  Date | null, revokedAt: Date | null, updatedAt: Date }`. Названия не хранятся (берутся из фактов при ответе —
  переименование видно сразу, ПДн чужих не копируются).
- `achievement_syncs`: `{ _id: userId, firstSyncAt: Date }` — маркер «первая сверка выполнена» (RC-1).
- Стирание `AchievementErasure.erase(userId)` → `{ grants, syncs }` (`deleteMany({ userId })` + `deleteOne({ _id })`),
  повтор — нули. Шаг `achievements` в `AccountErasureService` — после `route-rides`, до `notifications`.

### 7.7 Публичный список

`findPublic(publicId)` → нет — `404 NOT_FOUND` (тот же, что у `riders`) → `publishedRows(userId)` → правила `race_*` →
`racesOf` → `{ items }` явным списком полей (без `userId`, `seen`, времени). Без записи, без лимита пользователя
(IP-лимит `PublicReadGuard`), `public, max-age=60`.

## 8. Risks / Assumptions / Open Questions

- **Стоимость сверки на чтение.** Каждый `GET` читает протоколы, заезды по маршрутам и райды райдера. Ожидаемо —
  десятки–сотни строк; лимиты портов (как `RIDER_RESULTS_MAX_ROWS`). Клиент — `staleTime` и запрос только на
  старте/возврате приложения.
- **Гонки сверки.** Два одновременных `GET` — уникальный индекс и условные записи; второй не должен падать 500.
- **«Первая сверка».** Райдер с фактами, впервые открывший приложение после релиза, получит всё тихо — даже если факт
  свежий (сознательный компромисс A3).
- **Отзыв без уведомления** — сознательно (A4).

## 8.1 Requirements Consistency (architect)

- **RC-1 — форма выдач и «первая сверка» (A3, решение за architect).** Варианты: (a) отдельная коллекция-маркер
  `achievement_syncs { _id: userId, firstSyncAt }`, ставится **после** записи выдач первой сверки; (b) «у райдера нет
  ни одной выдачи» = первая сверка — **неверно**: новичок без фактов остаётся «первым» навсегда, его первая выдача
  придёт тихо, без вспышки; (c) служебный документ с особым `code` в `achievement_grants` — ломает enum и уникальность
  по смыслу. **Рекомендация — (a).** Выдачи — один документ на `(userId, code)` (уникальный индекс), отзыв — поле
  `revokedAt` (A4: «вернулся — `seen` прежний» требует сохранить `seenAt`). Порядок «выдачи → маркер» даёт
  корректность при параллельных GET: оба до маркера — оба «первые» (тихо, одинаково); второй после маркера — выдачи
  первой сверки уже записаны, вставляет только действительно новые. Сбой до маркера — следующий GET снова «первый»
  (тихо — допустимо по A3).
- **RC-2 — алгоритм сверки и параллельные GET.** Без транзакции: каждая операция — один документ с условием в фильтре
  (7.2), вставка — `insertOne` + `isDuplicateKey` уникального индекса, маркер — upsert `$setOnInsert` + `isDuplicateKey`.
  Альтернативы: транзакция на весь план (конфликты записи → повторы и `TransientTransactionError` у двух GET, без
  выигрыша — исход один и тот же); замок на пользователя в Redis (лишняя инфраструктура). **Рекомендация — условные
  записи.** Устойчивое состояние — GET без записей. AC5 проверяется int-тестом `Promise.all` из 5 GET (первая и
  последующая сверка) + отрицательное доказательство: без обработки `isDuplicateKey` — 500.
- **RC-3 — порты.** `results` — существующий `RIDER_RESULTS` (без изменений); `rides` — новый `RIDER_RIDES`
  (`pastOf`); `route-rides` — новый `RIDER_ROUTE_RIDES` (`passedOf`, видимость — внутри владельца); `routes` — пакетный
  `RouteRideRoutes.rideableTitles` (иначе N вызовов `rideable` с чтением линии показа на каждый маршрут при каждом
  GET). Названия объектов — только из портов (гонка — `racesOf`, маршрут — `routeTitle`, райд — `title`), в
  `achievement_grants` не хранятся. Подробно — 7.4.
- **RC-4 — недоопределено: маршрут больше не виден (A1/A4).** A1 говорит «`passed`, активность не удалена», но
  модуль `route-rides` скрывает заезды недоступного маршрута (снят с каталога, скрыт, свой удалён — `pokatim-db.md`
  «Сироты», RC-8 route-rides-01), а названия у удалённого маршрута нет. Варианты: (a) факт считается только по
  видимым сейчас маршрутам — снятие маршрута молча отзывает (A4 расширяется); (b) считать всегда, `title` —
  `nullable` («Маршрут недоступен»), новый порт названий без условия видимости — риск утечки названия чужого
  снятого маршрута; (c) хранить снимок названия в выдаче — копия чужих данных, расходится с A4 «объект
  пересчитывается». **Рекомендация — (a)**: совпадает с тем, что райдер видит в «Заездах по маршруту»; в
  `docs/product/profile.md` (A4) дописать «маршрут снят или удалён».
- **RC-5 — публичные достижения: отдельный эндпоинт (решение за architect).** Поле в `PublicRiderProfile` потребовало
  бы `riders → achievements` (нарушение AC8 и дубль правил в `riders`) либо копии правил. **Решение:**
  `GET /v1/riders/:publicId/achievements` в модуле `achievements` (как `riders/:publicId/{me,reports}` в `profile`).
  Следствие для PR B (п. 3 Scope «SSR-посев»): блок публичного профиля грузится **только на клиенте**, как публичная
  история гонок (`useRiderRaces`); мета `noindex`, SEO не нужен. Альтернатива — `loader` сеет два запроса (меняется
  форма посева `useLoaderSeed`) — не рекомендую. Человеку подтвердить формулировку п. 3.
- **RC-6 — конфликт AC8 с п. 6 Scope (стирание).** AC8: «`achievements` не импортирует никто, кроме `AppModule`», но
  удаление аккаунта по ADR-0015 — порт стирания модуля-владельца, вызываемый `account` (`account →
  route-rides`, `rides`, …). Варианты: (a) `account → achievements` через `index.ts` (`AchievementsCoreModule`,
  `AchievementErasure`) — как у всех модулей с данными пользователя; (b) без порта — выдачи остаются с псевдонимным
  `userId` (нарушает п. 6 и «новый модуль с данными пользователя обязан дать порт стирания»); (c) TTL — не подходит.
  **Рекомендация — (a)**, AC8 читать как «кроме `AppModule` и `account` (порт стирания)».
- **RC-7 — вредное решение: время факта в публичном ответе.** «Дата факта» гонки = старт лучшего сегмента —
  время суток заезда; rider-profile убрал его даже из публичного курсора (HIGH-1). Варианты: (a) наружу —
  `factDate: LocalDate` (день по Минску), и в своём, и в публичном ответе; (b) своё — ISO-время, публичное — дата;
  (c) публично — начало окна гонки. **Рекомендация — (a)**: UI показывает только дату, утечки нет, одна схема.
  Порядок списка и очереди вспышки — по полному `factAt` сервера (порядок массива ответа).
- **RC-8 — незнакомый код в старой сборке.** `tolerantEnum` превращает новый код в `'unknown'`; такую выдачу
  приложение не может ни показать, ни пометить (`seen` требует строгий код) — вспышка зациклилась бы. **Решение:**
  приложение отбрасывает элементы с `code === 'unknown'` из списка и вспышки (после обновления приложения выдача
  вспыхнет — `seen: false`); `object.kind === 'unknown'` — без «Поделиться».
- **RC-9 — предикат «в зачёте».** A1: «статус не `dq`»; `riders` (R6) считает гонку «в зачёте» как `status !== 'dq' &&
  place !== null`. Берём тот же предикат, чтобы «Пять гонок» ⇔ `stats.races ≥ 5`. Чтобы не дублировать — вынести
  `isRankedRow(row)` рядом с `RiderProtocolRow` (`results/rider-results.port.ts`, экспорт из `results/index.ts`) и
  использовать в `riders.policy.summarize` и `achievements.policy` (минимальная правка `riders`, тесты не меняются).
- **RC-10 — сторис доступна (проверено кодом).** `/races/story/<raceId>` → `GET races/:raceId/entry/story-card` →
  `ResultsForSharing.storyCardFacts`: при опубликованном протоколе статус и время берутся из строки текущей ревизии
  (`protocolResult`), `storyCardEligible` требует `entry.status === 'active'`, время и статус `final|revised`. Для
  строки «в зачёте» это выполняется всегда: снятие заявки закрыто после фазы `open` (`entries.service.ts` `withdraw`),
  отмена гонки после публикации протокола запрещена (`races.service.ts` `cancel`). Условие для A6 совпадает с условием
  гоночных достижений — дополнительных условий в 8.1 нет. Кнопка — только в своём списке и вспышке (сторис — свой
  результат под входом), не в публичном профиле.
- **RC-11 — «удаление райда модератором» (A4).** В модели `rides` удаления нет — модерация скрывает (`status:
  'hidden'`); фильтр `status: 'published'` покрывает. Стирание организатора отменяет его райды (`RideErasure`) — у
  других участников «Первый кофе-райд» отзывается молча (по A4). Находка не блокирует.
- **RC-12 — недоопределено: частота.** Spec не задаёт лимиты; GET выполняет ~10 запросов и может писать. **Решение:**
  `achievements-read:<uid>` 60/мин, `achievements-seen:<uid>` 120/ч (`429 RATE_LIMITED`); публично — IP-лимит
  `PublicReadGuard`. Приложение: `staleTime` 60 с, запрос на старте и возврате (A5).
- **RC-13 — ADR (решение за architect).** «Выдача сверкой при чтении» — новый архитектурный приём: запись в `GET`,
  производное состояние без outbox/worker в обход AGENTS.md §4.5 «события между модулями — outbox» (как DV-1 у
  `standings`, но там регламент в worker). **Рекомендация — ADR-0020 «Достижения: выдача сверкой при чтении»**
  (Proposed в PR A, Accepted — человек): почему не outbox (тип → одна очередь), не регламент (скан всех райдеров),
  следствия (нет push о достижении без отдельного механизма; стоимость GET; eventual consistency объекта).
- **RC-14 — номер миграции.** Проверено: на `origin/develop` последняя — `0034_profile_reports`, веток с `0035+` нет →
  `0035_achievements`; перед мержем — перепроверить. Тест `0034_profile_reports … последняя` в
  `migrations.int.test.ts` переносит «последняя» на `0035`.
- **RC-15 — «есть ещё хотя бы один «Иду»» (`ride_organizer`).** Организатор входит в `participants` и `goingCount`
  (`rides.collection.ts`: «организатор — первый», `rescheduledAt` при `goingCount > 1`) → условие `goingCount >= 2`.

- **Решение по RC-1…RC-15 (исполнитель, 2026-10-29; автономный режим, вынесено в отчёт человеку):** везде принят
  вариант-рекомендация architect. RC-4 (невидимый маршрут — факта нет) и RC-7 (наружу только дата по Минску)
  уточняют A1/A4; RC-6 — AC8 читать как «импортирует только `AppModule` и `account` (стирание)»; RC-13 — ADR-0020.

## 8.2 Отклонения при реализации (coder, PR A)

- **D1 — `Earned.title: string | null`.** У гоночных правил названия нет (оно приходит из `racesOf` после правил):
  `null` у гонки, название факта — у маршрута и райда. Форма 7.1 иначе не выполнима без порта в чистой функции.
- **D2 — гонки нет в `racesOf` (7.2 п. 2).** «Запись не трогается» прочитано как «не отзывать»: план строится по полному
  набору заработанного, код только не попадает в ответ (лог `achievements.race_missing`). Случай невозможен по
  инвариантам `races` (отмена после публикации запрещена).
- **D3 — пачки портов.** `RiderRouteRides.passedOf` вызывает `liveActivities` пачками по 200 id и `rideableTitles` —
  по 500 (пределы портов при 2000 строк). Лог усечения заездов — `achievements.route_rides_truncated` (7.4: «предел
  2000 + лог» без имени).
- **D4 — `rideableTitles` без линии показа.** Условие — как у `findRideable` (+ `distanceM` не `null`), как и записано
  в 7.4; `rideable` дополнительно требует линию показа (рамку). Готовый маршрут без геометрии не бывает (геометрия
  пишется вместе с `ready`).
- **D5 — тестовый стенд.** Изоляция по поручению оркестратора: `test-kit` требует имя БД `*_test` и Redis db ≥ 1 —
  использованы `pokatim_achievements_test` (вместо `pokatim_test_achievements`) и `redis://127.0.0.1:6491/1`; replica
  set локально — порт 27117 (на 27017 — standalone).
- **D6 — `pokatim-security.md`:** в `paths:` добавлен `apps/api/src/modules/achievements/**` (иначе правило зоны не
  подгружается для нового модуля).

## 8.2 Отклонения при реализации (coder, PR B)

- **B1 — `seen` при показе, а не по кнопке.** Вспышка шлёт `POST seen [code]` сразу при показе элемента (11 «PR B»:
  «Дальше»/«Закрыть»/«Поделиться» → `seen`). Исход для кнопок тот же, а закрытие жестом «назад» (Android, свайп
  модалки) тоже помечает показанное — по A5 «просмотренными помечаются показанные». «Закрыть» — только на последнем
  элементе, на остальных — «Дальше» (AC10).
- **B2 — показанные в этом запуске (`flash-session.ts`).** Сбой `seen` откатывает `seen: false` в кэше; без набора
  показанных хост сразу открыл бы вспышку снова. Набор — память процесса, сброс при выходе; после перезапуска
  непомеченное сервером вспыхнет ещё раз (at-least-once).
  Ревью pass 1 (MEDIUM-1): вся открытая очередь тоже скрыта до ответа сервера новее снимка — «назад» или «Поделиться»
  посреди очереди не открывают вспышку сразу снова; остаток вспыхнет после нового ответа (возврат на передний план
  после `staleTime`, pull-to-refresh).
- **B3 — иконки.** В наборе приложения (`components/icon.tsx`) не было подходящих для «Подиума» и «Победы» — добавлены
  `medal` (SF `medal` / Material `military_tech`) и `trophy` (SF `trophy` / Material `emoji_events`); остальные коды —
  существующие `races`, `routes`, `rides`, `person`. Счётные (`races_5`, `routes_5`, `rides_10`) — число на кольце.
- **B4 — размер значка — бренд-слой токенов (ревью pass 1, HIGH).** Диаметр — `layout.badgeGrid` (72) /
  `layout.badgeHero` (152), пропорции кольца, диска и иконки — `badgeShape` в `@pokatim/design-tokens` (образец —
  `layout.avatarProfile`), тест в `design-tokens.test.ts`; px-литералов в фиче нет. Follow-up — `size.badge*` в
  app-foundation (`@rkarakulov/design-tokens`). Значок — роли `surface.default`, `text.primary`, `text.accent`,
  `action.*`, скругление `radius.pill`; дуговой подписи прототипа нет (в RN без SVG-текста) — follow-up при
  необходимости.
- **B5 — публичный блок при ошибке** — компактный баннер с повтором (`TabFailure`), как у своего; 404 — блока нет. Только
  гоночные коды отбираются и на клиенте (`publicItems`, ревью pass 1, LOW-2).

## 8.3 Security checklist

Затронуты зоны `security.md`: персональные данные, публичные ссылки, удаление аккаунта, `app.module.ts`,
`src/db/**` (миграция) — чек-лист обязателен.

- **AuthN/AuthZ.** `GET /v1/achievements`, `POST …/seen` — `AuthGuard` на классе, пользователь — только
  `@CurrentUser()`; `userId` в **каждом** фильтре репозитория; чужие коды в `seen` — без записи (фильтр по `userId`).
  Публично — `PublicReadGuard`; доступ — по непредсказуемому `publicId` и только при имени и согласии
  (`RIDER_PROFILES.findPublic`), иначе один `404` (непубличный = неизвестный, без оракула).
- **Входные данные.** Тело `seen` — `strictObject`, строгий `z.enum`, 1–9, без повторов → `400 VALIDATION_FAILED`;
  `publicId` — `RiderPublicId` pipe; в фильтры — только примитивы после zod (`$in` из провалидированных кодов).
- **Данные наружу.** Свой ответ: код, объект `{ kind, id, title }`, `factDate`, `seen` — без `userId`, `_id` выдачи,
  `grantedAt`, `revokedAt`, времени суток (RC-7). Публичный: только `race_*`, без `seen`, `userId` и времени
  (ключи держит int-тест, как `riders.int.test.ts`). Маршруты и райды публично не уходят (A7); названия маршрутов —
  только видимых райдеру (RC-4).
- **Злоупотребления.** Лимиты RC-12; GET пишет не больше 9 документов на пользователя (уникальный индекс), повтор —
  без записи; публичное чтение без записи.
- **Секреты и логи.** Логи — `uid`, счётчики и флаг `first`; без кодов-объектов, названий гонок/маршрутов/райдов,
  `publicId`, имён.
- **Аудит.** Не требуется: выдачи — производная проекция фактов, а не решение человека; append-only журналов не
  трогаем. Стирание — шаг `achievements` в `AccountErasureService` (лог шага — как у других: `deleted=<n>`).

## 9. Acceptance Criteria

PR A:

- AC1. Для каждого из 9 кодов юнит-тест правила: факт есть → выдача с правильным объектом и датой; граничные случаи
  (DQ, `=1`, START нет в протоколе, 4 vs 5 гонок, повторный заезд того же маршрута, отменённый/скрытый/будущий райд,
  организатор без других «Иду»).
- AC2. Первая сверка райдера с фактами → выдачи с `seen: true`; новый факт после → `seen: false`.
- AC3. Факт пропал → выдачи нет в ответе; вернулся → есть, `seen` прежний.
- AC4. `POST seen` помечает только свои видимые выдачи; повтор идемпотентен; неверное тело — 400
  `VALIDATION_FAILED`; без входа — 401.
- AC5. Параллельные `GET` одного райдера (int-тест) — без дублей и 500.
- AC6. Публичные достижения — только гоночные, только для публичного профиля; непубличный — 404; без `seen`, без
  `userId`.
- AC7. Удаление аккаунта удаляет выдачи.
- AC8. Модуль `achievements` читает чужие данные только через порты из `index.ts`; его не импортирует никто, кроме
  `AppModule`.

PR B:

- AC9. Новое достижение → вспышка при открытии/возврате; «Закрыть» → `seen`, повторно не показывается.
- AC10. Несколько новых — «Дальше» по очереди, затем «Закрыть».
- AC11. Гоночное — «Поделиться» открывает `/races/story/<raceId>`; у остальных кнопки нет.
- AC12. Блок в `/profile` и в `/riders/[id]` (только гоночные); пусто — блока нет; ошибка загрузки блока не ломает
  экран профиля.
- AC13. Тексты в i18n, a11y-подписи, web/iOS/Android; «уменьшить движение» — без анимации.

## 10. Documentation Impact

- `docs/product/profile.md` — раздел «Решения A1–A8 (achievements, 2026-10-29)».
- `.claude/rules/` — правила зоны app/api для нового модуля и экранов (по образцу rider-profile).
- ADR — если architect сочтёт «сверку при чтении» новым архитектурным решением.
- Architect (2026-10-29), PR A: ADR-0020 «Достижения: выдача сверкой при чтении» + строка в `docs/adr/README.md`
  (RC-13); `docs/product/profile.md` — A1–A8 с уточнениями RC-4, RC-7, RC-15 и «Где в продукте» (эндпоинты);
  `docs/product/account.md` (A7 — достижения удаляются); `.claude/rules/pokatim-backend.md` (раздел «Достижения»:
  граф, порты, сверка, `account → achievements`), `pokatim-db.md` (коллекции, индекс, порядок шагов стирания),
  `pokatim-security.md` (эндпоинты, лимиты, публичные поля), `pokatim-contracts.md` (схемы, RC-8). PR B —
  `pokatim-app.md` (хост вспышки, ключи запросов, отбрасывание `unknown`).

## 11. Implementation Context

### PR A — API (подробно)

**ENTRY POINTS**
- `GET /v1/achievements` → `AchievementsController.list` → `AchievementsService.sync(userId)`.
- `POST /v1/achievements/seen` → `AchievementsController.seen` → `AchievementsService.markSeen(userId, codes)`.
- `GET /v1/riders/:publicId/achievements` → `AchievementsPublicController.list` → `AchievementsService.publicList`.
- Стирание: `AccountErasureService.run` → шаг `achievements` → `AchievementErasure.erase`.

**FILES TO CREATE**
- `apps/api/src/modules/achievements/index.ts` — `AchievementsModule`, `AchievementsCoreModule`, `AchievementErasure`.
- `…/achievements/achievements.module.ts` — Core + API (5).
- `…/achievements/achievements.collection.ts` — `ACHIEVEMENTS_COLLECTIONS { grants, syncs }`, `AchievementGrantDoc`,
  `AchievementSyncDoc`.
- `…/achievements/achievements.repository.ts` — `listOf`, `syncedAt`, `insertGrant` (дубль — `false`), `revoke`,
  `restoreOrRefresh`, `markSynced`, `markSeen`, `deleteAllOf`; константа `ACHIEVEMENT_GRANTS_UNIQUE_INDEX`.
- `…/achievements/achievements.policy.ts` — `ACHIEVEMENT_RULES`, `earnedAchievements`, `raceAchievements`,
  `reconcilePlan`, `sortForList`, `ACHIEVEMENTS_POLICY` (лимиты).
- `…/achievements/achievements.service.ts` — `sync`, `markSeen`, `publicList`.
- `…/achievements/achievements.controller.ts` (`@Controller('achievements')`, `AuthGuard`, `no-store`).
- `…/achievements/achievements-public.controller.ts` (`@Controller('riders')`, `PublicReadGuard`, `:publicId/achievements`).
- `…/achievements/achievement-erasure.ts`.
- `apps/api/src/modules/rides/rider-rides.port.ts`, `rider-rides.ts` — `RIDER_RIDES`.
- `apps/api/src/modules/route-rides/rider-route-rides.port.ts`, `rider-route-rides.ts` — `RIDER_ROUTE_RIDES`.
- `apps/api/src/db/migrations/0035_achievements.ts` — `ensureCollection` ×2, `ACHIEVEMENTS_INDEXES` (уникальный
  `achievement_grants_user_code_unique`), expand-only, идемпотентна.
- `packages/contracts/src/achievements/achievement.schema.ts` (+ `.test.ts`).
- `packages/api-client/src/achievements.test.ts`.
- `apps/api/test/achievements.ts` — `achievementsDb(h)`, посев фактов поверх `test/standings|route-rides|rides`.
- `docs/adr/0020-achievements-reconcile-on-read.md`.

**FILES TO MODIFY**
- `apps/api/src/app.module.ts` — `AchievementsModule` (после `RidersModule`).
- `apps/api/src/modules/rides/{rides.repository.ts (pastFactsOf), rides.module.ts (провайдер + экспорт RIDER_RIDES), index.ts}`.
- `apps/api/src/modules/route-rides/{route-rides.repository.ts (passedOf), route-rides.module.ts, index.ts}`.
- `apps/api/src/modules/routes/{route-ride-routes.port.ts, route-ride-routes.ts, routes.repository.ts (findRideableTitles)}`.
- `apps/api/src/modules/results/{rider-results.port.ts (isRankedRow), index.ts}`, `riders/riders.policy.ts` (RC-9).
- `apps/api/src/modules/account/{account-erasure.service.ts (шаг achievements), account.module.ts (AchievementsCoreModule в AccountWorkerModule)}`.
- `apps/api/src/db/migrations/{index.ts, migrations.int.test.ts}`.
- `packages/contracts/src/index.ts`, `packages/api-client/src/index.ts`.
- Документы — раздел 10.

**FILES TO READ**: раздел 6; `.claude/rules/{backend,db,contracts,tests,security}.md` и `pokatim-{backend,db,contracts,security,tests}.md`.

**TYPES & SCHEMAS**: `AchievementCode`, `ACHIEVEMENT_CODES`, `Achievement`, `AchievementList`, `PublicRiderAchievement(List)`,
`MarkAchievementsSeenRequest` (7.5); порты `RiderRides`/`RiderRideFact`, `RiderRouteRides`/`RiderRouteRideFact`,
`RouteRideRoutes.rideableTitles`, `RiderResults`/`RiderProtocolRow`/`isRankedRow`, `RiderProfileDirectory` (7.4).

**TESTS**
- Unit `achievements.policy.test.ts` — AC1 по каждому коду: факт есть → объект и дата; DQ; `place` 1–3 / 4; `=1`
  (`tied`); строка без места; 4 vs 5 гонок и 5-я по дате; повторный заезд того же маршрута (один маршрут, дата —
  ранний); 4 vs 5 маршрутов; организатор с `goingCount` 1 vs 2; 9 vs 10 райдов; детерминизм при равных датах.
  `reconcilePlan` — insert (first → `seenAt`, иначе `null`), revoke, restore с сохранённым `seenAt`, refresh
  объекта (Подиум переходит на другую гонку), пустой план в устойчивом состоянии.
- Unit контракты: `MarkAchievementsSeenRequest` (0, 10, повтор, незнакомый код, лишний ключ → ошибка),
  `Achievement` (незнакомый код/вид → `'unknown'`); api-client — пути, методы, Bearer, 204.
- Int `achievements.int.test.ts` (реальный MongoDB, образец `riders.int.test.ts`):
  AC2 (первая сверка с фактами → все `seen: true`; новый факт → `seen: false`; райдер без фактов — маркер ставится,
  первый факт потом — `seen: false`); AC3 (DQ новой ревизией `addRevision` → нет; вернулся → есть, `seen` прежний;
  удалена активность заезда по маршруту; маршрут снят с каталога — RC-4; райд скрыт/отменён); AC4 (`seen` только своих
  видимых; чужой/отозванный — без записи; повтор — 204; 400; 401; 429); AC5 (`Promise.all` ×5 GET — первая и
  последующая сверка: ровно ≤ 9 документов, без 500, `seen` согласован; отрицательное доказательство — без
  `isDuplicateKey` или с маркером до выдач тест краснеет по результату); AC6 (публичный: только `race_*`, ключи ответа
  и элемента — точный список, без `seen`/`userId`/времени; непубличный и неизвестный `publicId` — 404; мусор — 400;
  `Cache-Control`); ключи своего ответа — точный список; лог без названий.
- Int порты: `rider-rides` (прошедший/будущий/отменённый/скрытый, «Иду»/организатор, порядок ↑, предел),
  `rider-route-rides` (только `passed`, живая активность, видимый маршрут, свой удалённый маршрут), `rideableTitles`
  (`IN_CATALOG`, свой, чужой непубличный, не `ready`).
- Int стирание: `account-erasure.int.test.ts` — выдачи и маркер удалены, повтор — нули (AC7).
- Миграция: `migrations.int.test.ts` — `0035_achievements` последняя, коллекции и индекс (уникальность), повторный `up`.
- Архитектура: `pnpm arch:check` (AC8: импорты только через `index.ts`; на `achievements` ссылаются только
  `app.module.ts` и `account`).
- Gate: `pnpm check`.

**OUT OF SCOPE (PR A)**: приложение и i18n; панель; push/уведомления; worker, очереди, outbox; изменения
`RidersService`/`PublicRiderProfile`, `sharing`, `RIDER_RESULTS.publishedRows`.

### PR B — приложение (предварительно)

- **Фича** `apps/app/src/features/achievements/`:
  - `queries.ts` — `ACHIEVEMENTS_KEY = ['achievements']` (`useAchievements`: `withAccessToken(api.listAchievements)`,
    `staleTime` 60 с, `refetchOnWindowFocus` — от `focusManager`); `useMarkAchievementsSeen` (оптимистично
    `seen: true` в кэше, ошибка — откат); публично `riderAchievementsKey(id) = ['riders', 'achievements', id]`
    (`useRiderAchievements(id, enabled)`, `staleTime` 60 с; под префиксом `['riders']` — инвалидация мутаций профиля).
  - `achievement-catalog.ts` — код → ключи i18n (название, условие), значок, `shareable` (только `race_*`);
    `knownItems` (отброс `unknown`, RC-8); `flashQueue(items)` — неувиденные известные в порядке «от старых к новым»
    (обратный порядок ответа) — unit-тест.
  - `achievement-badge.tsx` — значок «Эмаль» (`.bdg` прототипа) — продуктовый компонент из токенов и `@rkarakulov/ui`
    с тестом; нужных токенов нет — расширение в app-foundation или вопрос человеку (AGENTS.md §4.11).
  - `achievement-card.tsx` — общий макет вспышки и экрана достижения: значок, название, условие, объект, дата
    (`format.ts` `@pokatim/i18n`, Минск), «Поделиться» (A6) → `storyPath(raceId)` из `features/races/story/paths.ts`.
  - `achievements-block.tsx` — сетка для `/profile` и `/riders/[id]`; пусто — `null`; первая загрузка — скелетон;
    ошибка — блочная ошибка с повтором, экран профиля не ломается (AC12, §4.12).
  - `achievement-flash-host.tsx` — монтируется в `app/_layout.tsx` рядом с `<PushNotifications ready=…/>` с тем же
    `ready={signedIn && step === 'done'}`; подписан на `useAchievements`; есть очередь и текущий путь не вспышка/не
    сторис/не авторизация — `router.push('/achievements/flash')`.
- **Маршруты** (внутри `Stack.Protected` вкладок): `app/achievements/flash.tsx` (`presentation: 'fullScreenModal'`;
  очередь — снимок при открытии; «Дальше» → `seen [code]` → следующий; «Закрыть» → `seen [code]` → `back`;
  «Поделиться» → `seen [code]` → `replace(storyPath)`; анимация — `useReducedMotion()` из `@rkarakulov/ui`);
  `app/achievements/[code].tsx` — экран достижения из своего списка (тот же макет, без «Дальше»).
- **Профиль**: `features/profile/own-profile-screen.tsx` — заменить комментарий rider-profile на `<AchievementsBlock>`,
  добавить refetch в pull-to-refresh; нажатие — `/achievements/<code>`.
- **Публичный профиль**: `features/riders/rider-screen.tsx` — блок гоночных достижений, данные только на клиенте
  (RC-5), без «Поделиться» и без перехода.
- **i18n**: `packages/i18n/src/ru.ts` — `achievements.*` (9 названий и условий, заголовок блока, «Дальше»,
  «Закрыть», «Поделиться», a11y-подписи «Достижение: …, гонка …, дата …»); en-словаря в проекте нет.
- **Тесты**: `flashQueue`/`knownItems` unit; хост (новое → открытие; `seen` → не повторяется; ошибка — тишина);
  экран вспышки (Дальше/Закрыть/Поделиться, reduce motion); блоки профиля (пусто — нет блока, ошибка не ломает
  экран); web-тесты `*.web.test.tsx` при платформенных развилках; Playwright-смоук при `E2E_API=1` — по возможности.

## 12. Outcome

### PR A — API (coder, 2026-10-29)

Сделано по 7.1–7.7 и 11 «PR A»; отклонения — 8.2 (D1–D6). PR B не начат.

- Контракты и клиент: `packages/contracts/src/achievements/achievement.schema.ts` (+ тест), методы `listAchievements`,
  `markAchievementsSeen`, `getRiderAchievements` (+ `packages/api-client/src/achievements.test.ts`).
- Порты: `RIDER_RIDES` (`rides/rider-rides*.ts`, `RidesRepository.pastFactsOf`), `RIDER_ROUTE_RIDES`
  (`route-rides/rider-route-rides*.ts`, `RouteRidesRepository.passedOf`), `RouteRideRoutes.rideableTitles`
  (`RoutesRepository.findRideableTitles`), `isRankedRow` (`results`, им же — `riders.policy.summarize`).
- Модуль `apps/api/src/modules/achievements/` (policy, repository, service, два контроллера, стирание), миграция
  `0035_achievements`, `AchievementsModule` в `AppModule`, шаг `achievements` в `AccountErasureService` (после
  `route-rides`).
- Документы: ADR-0020 (Proposed) + индекс, `docs/product/profile.md` (A1–A8, эндпоинты, follow-up),
  `docs/product/account.md`, `.claude/rules/pokatim-{backend,db,security,contracts}.md`.

Тесты: unit `achievements.policy.test.ts` (AC1 — 9 кодов и границы, `reconcilePlan`, `sortForList`); int
`achievements.int.test.ts` (AC2–AC6, ключи ответов, лог без названий, 401/400/429), `rider-rides.int.test.ts`,
`rider-route-rides.int.test.ts`, `route-ride-routes.int.test.ts` (`rideableTitles`), `account-erasure.int.test.ts`
(AC7, шаг в логах), `migrations.int.test.ts` (`0035` — последняя, индекс, повторный `up`).

Отрицательные доказательства (AC5, постоянные тесты в `achievements.int.test.ts`; 5 GET читают состояние до записей —
ворота на `syncedAt`):
- вставка без перехвата `isDuplicateKey` → среди 5 параллельных GET есть **500** (с перехватом — все 200, 3 документа);
- маркер первой сверки до выдач (симуляция в `insertGrant`) → выдача первой сверки у параллельного GET приходит с
  **`seen: false`** (правильный порядок — все `seen: true`).

AC8: `pnpm arch:check` — без нарушений; на `modules/achievements` ссылаются только `app.module.ts` и `account`
(`account.module.ts`, `account-erasure.service.ts`), кроме миграции (коллекция) и тестов.

Гейт (Node 24.22.1, свой Mongo `pokatim_achievements_test` на rs0:27117, свой Redis `:6491/1`, `TURBO_CONCURRENCY=1`):

```
$ pnpm check   # format:check + lint + arch:check + typecheck + test
All matched files use Prettier code style!
✔ no dependency violations found (1818 modules, 6838 dependencies cruised)
 Tasks:    9 successful, 9 total            # typecheck
@pokatim/contracts:test:   Test Files  43 passed (43)     Tests  370 passed (370)
@pokatim/api-client:test:  Test Files  20 passed (20)     Tests  136 passed (136)
@pokatim/api:test:         Test Files  163 passed (163)   Tests  1759 passed (1759)
@pokatim/admin:test:       Test Files  40 passed (40)     Tests  381 passed (381)
@pokatim/app:test:         Test Suites: 210 passed        Tests: 1932 passed
 Tasks:    15 successful, 15 total
  Time:    11m25.735s
exit=0
```

Первый прогон `pnpm check` упал на lint (неиспользуемая переменная в тесте контракта) — исправлено отдельным коммитом,
повторный прогон выше — зелёный. Независимое ревью — не проводилось (шаг оркестратора).

### PR B — приложение (coder, 2026-10-29)

Сделано по A5–A8, 3 «PR B», 11 «PR B», RC-5, RC-7, RC-8; отклонения — 8.2 (B1–B5). `apps/api` не менялся.

- Фича `apps/app/src/features/achievements/`: `achievement-catalog.ts` (каталог 9 кодов, `knownItems`, `flashQueue`,
  `shareRaceId`, подписи), `queries.ts` (`['achievements']`, оптимистичный `seen` с откатом своих кодов,
  `['riders','achievements',id]`), `flash-session.ts`, `achievement-badge.tsx` («Эмаль»), `achievement-card.tsx`
  (общий макет, появление значка только без «Уменьшить движение»), `achievements-block.tsx`,
  `achievement-flash-host.tsx`, `achievement-flash-screen.tsx`, `achievement-screen.tsx`.
- Маршруты `achievements/flash` (`fullScreenModal`) и `achievements/[code]` в `Stack.Protected` вкладок; хост — рядом с
  `PushNotifications` корневого layout; блок — в `/profile` (вместо комментария rider-profile) и `/riders/[id]` (только
  клиент, после найденного профиля); pull-to-refresh обоих экранов перезапрашивает блок.
- Иконки `medal`, `trophy` в `components/icon.tsx`; тексты `achievements.*` в `packages/i18n/src/ru.ts` (en-словаря нет).
- Правило `.claude/rules/pokatim-app.md` — раздел «Достижения»; смоук `e2e/web.spec.ts` — оба адреса без сессии;
  сторож порядка SSR-маршрутов — `/achievements/flash` и `/achievements/<code>`.

Тесты: unit `achievement-catalog.test.ts` (`knownItems`, `flashQueue` с порядком и показанными, `shareRaceId`, подписи);
`__tests__/achievement-flash.test.tsx` — хост (новое → вспышка; «Закрыть» → `seen`, не повторяется; всё просмотрено,
`unknown`, ошибка запроса, `ready: false`, экран сторис — без вспышки; сбой `seen` — без повтора), экран вспышки
(«Дальше» от старых к новым, затем «Закрыть»; «Поделиться» → `/races/story/<raceId>`; незнакомый вид — без кнопки;
reduce motion — без `Animated.timing`; движение — одно появление; прямой адрес без новых — Главная), экран
`/achievements/[code]`; `__tests__/achievements-blocks.test.tsx` — блоки профиля и публичного профиля (порядок,
`unknown`, нажатие, пусто — нет блока, ошибка — баннер, профиль на месте, 404, профиль не найден — без запроса).
Отрицательная проверка: хост без набора показанных — тест «сбой `seen`» краснеет.

Гейт (Node 24.22.1, свой Mongo `pokatim_achv_app_test` на rs0:27117, свой Redis `:6493/1`, `TURBO_CONCURRENCY=1`):

```
$ pnpm check   # format:check + lint + arch:check + typecheck + test
All matched files use Prettier code style!
✔ no dependency violations found (1845 modules, 6940 dependencies cruised)
 Tasks:    9 successful, 9 total            # typecheck
@pokatim/contracts:test:   Test Files  43 passed (43)     Tests  370 passed (370)
@pokatim/api-client:test:  Test Files  20 passed (20)     Tests  136 passed (136)
@pokatim/api:test:         Test Files  163 passed (163)   Tests  1760 passed (1760)
@pokatim/admin:test:       Test Files  40 passed (40)     Tests  381 passed (381)
@pokatim/app:test:         Test Suites: 214 passed        Tests: 1998 passed
 Tasks:    15 successful, 15 total
pnpm check  12:29.06 total
exit=0
```

Первый прогон упал на typecheck (тип `_layout` в тесте вспышки) — исправлено, повторный выше — зелёный.

NOT VERIFIED: ручная проверка на iOS/Android-симуляторе и в браузере (`build:web` + `start:web`, `e2e:web` — шаг смоука
добавлен, не запускался); вид значка «Эмаль» в темах приложения глазами не сверялся.

#### PR B — исправления ревью pass 1 (coder, 2026-10-29)

Все находки pass 1 исправлены, подробности — `findings.md` «PR B — исправления pass 1»; 8.2 B2, B4, B5 обновлены.
Гейт (то же изолированное окружение: Mongo `pokatim_achv_app_test`, Redis `:6493/1`, `TURBO_CONCURRENCY=1`):

```
$ pnpm check
All matched files use Prettier code style!
✔ no dependency violations found (1846 modules, 6942 dependencies cruised)
 Tasks:    9 successful, 9 total            # typecheck
@pokatim/design-tokens:test:  Test Files  3 passed (3)       Tests  579 passed (579)
@pokatim/contracts:test:      Test Files  43 passed (43)     Tests  370 passed (370)
@pokatim/api-client:test:     Test Files  20 passed (20)     Tests  136 passed (136)
@pokatim/api:test:            Test Files  163 passed (163)   Tests  1760 passed (1760)
@pokatim/admin:test:          Test Files  40 passed (40)     Tests  381 passed (381)
@pokatim/app:test:            Test Suites: 215 passed        Tests: 2010 passed
 Tasks:    15 successful, 15 total
pnpm check  9:24.83 total
exit=0
```

Два прогона до этого упали в `apps/api` на разных тестах, не связанных с PR B (`apps/api` не менялся): EPIPE в
`track-uploads.int.test.ts` (413 через сокет) и таймаут 5 с в `avatar-image.test.ts` (48 Мп JPEG) под нагрузкой
машины; оба файла отдельно — 47/47 зелёные, третий прогон целиком — зелёный (выше; часть задач — из кэша turbo
прошлых прогонов с тем же кодом). NOT VERIFIED — как выше (симуляторы, браузер, `e2e:web`).
