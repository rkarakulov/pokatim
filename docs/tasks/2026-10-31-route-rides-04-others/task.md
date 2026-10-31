# task.md — route-rides-04: таблица «Другие» по маршруту

Уровень: task3. Шаг 2 из 3 этапа 2. Продуктовые решения — `docs/product/routes.md`, раздел «Этап 2» (O1–O5).
Два PR (решение architect, RC-1): **A** — contracts, API, индекс, api-client (ветка `feature/route-rides-others-api`,
этот task.md); **B** — приложение (`feature/route-rides-others-app`, после слияния A). Причина: `UpdateProfileRequest`
— `strictObject`, форма профиля шлёт все поля; приложение раньше API — каждое сохранение профиля 400.

## 1. Title

Сравнение с другими райдерами на маршруте каталога: отдельное согласие на показ своих заездов, таблица лучших
пройденных заездов, своя строка — «Вы».

## 2. Goal

Сейчас сравнение — только со своими заездами (R2). Райдер хочет видеть, как маршрут проехали другие, — но заезд
раскрывает, что человек был на маршруте и когда, поэтому участие — только по отдельному согласию.

## 3. Scope

Решение автора 2026-10-31: **отдельное согласие (opt-in)**. Детали — `[ASSUMPTION]`:

1. **O1 — согласие.** Флаг профиля `showRouteRides` («Показывать мои заезды в таблицах маршрутов», по умолчанию
   выключен) в модуле `profile`. Включение/отзыв — в журнал `profile_consent_events`, `kind: 'route_rides'`, версия
   `ROUTE_RIDES_CONSENT_VERSION = '2026-10-31'`, только при фактической смене, в той же транзакции, что `PATCH`
   (как Q1). Клиент присылает только флаг. Текст пояснения (PR B, `[ASSUMPTION]`): «Другие райдеры увидят ваше время
   и день заезда на маршрутах каталога. Имя и фото — только если включён показ имени.»
2. **O2 — где таблица.** Только у маршрутов каталога (`IN_CATALOG`), видимых сейчас. Не по `access` порта: `rideable()`
   отдаёт автору одобренного маршрута `access: 'own'`, а таблица у такого маршрута есть и у автора. Маршрут не каталога
   / не видим — `404`.
3. **O3 — строки.** По одной на райдера с согласием сейчас: лучший **живой пройденный** заезд (минимум `elapsedSec`;
   ничья — раньше дата заезда, затем меньший `_id`). Удалён лучший — строка по лучшему из оставшихся живых (берутся до
   3 лучших заездов райдера). Места уникальные (без «=N»). Поля — как в таблицах гонок: `riderName` и `RiderRowLink`
   (имя, аватар, ссылка на публичный профиль по P1/R4, иначе «Участник»), `elapsedSec`, `rideDate` — день по Минску
   (`LocalDate`), без времени суток. `rideId` — только у своей строки.
4. **O4 — своя строка.** `me` — своя строка всегда (если есть живой пройденный заезд), даже без согласия и даже вне
   `limit`; без согласия она видна только себе, и место считается среди показанных + себя. `shared` — включён ли показ
   у зрителя.
5. **O5 — удаление.** Удаление аккаунта, удалённая активность, скрытый/снятый маршрут, отзыв согласия — строки нет.
   Автозаезды (route-rides-03) участвуют наравне с ручными.
6. **API** (contracts-first): `GET /v1/routes/:routeId/rides/leaderboard?limit=` (`AuthGuard`, `no-store`, `limit`
   1–100, по умолчанию 10, без курсора), ответ: `rows`, `total`, `me`, `shared`. Скан — не больше 5000 райдеров
   маршрута. Лимит запросов — 300/ч на пользователя. Согласие читается без кэша на каждом запросе.
7. **Порты:** `RIDER_NAMES.routeRideRiders(userIds)` → `{ shares, card }` (одним запросом, условие согласия в
   фильтре); `routes.catalogRoute` (через `inCatalogByIds`); `tracks.liveActivityIds` (чужие активности, наружу только
   набор id).
8. **Индекс** — миграция следующим свободным номером: `route_rides` `{ routeId, 'segment.elapsedSec',
   'activity.startedAt', _id }`, частичный по `status: 'passed'`.
9. **Документация** — `docs/product/routes.md`, `docs/product/profile.md` (новое согласие), правила по факту.

## 4. Out of Scope

- PR B (приложение: блок «Другие на маршруте» на карточке — 5 строк + своя отдельно, «Видно только вам» и «Включить
  показ»; экран `/routes/others/<id>` + сторож манифеста SSR; переключатель под «Показывать имя…»; строки —
  `TableRow`/`RiderWho` из `features/races/table-row.tsx`).
- Участки (route-rides-05) и участки в таблице; таблица у «Моих маршрутов»; гостевой доступ, SSR; уведомления.
- Трек/карта чужого заезда; фильтры; жалобы на строки.

## 5. Architecture Context

`modules/route-rides` (выборка лучших, контроллер), `modules/profile` (флаг, журнал согласий, порт `RIDER_NAMES`),
`modules/routes` (каталог), `modules/tracks` (живые активности). Чужой модуль — только через `index.ts`.

## 5.1 Placement & Reuse Gate

Architect, 2026-10-31 (повторно, сверено с кодом ветки `feature/route-rides-auto-check`, PR #167). Решения §3 не
меняются; уточнения — §8.1.

**Placement.** Новых пакетов и модулей нет (инвариант 4: всё — в `apps/api` и существующих пакетах).

| Что | Где | Слой |
|---|---|---|
| Флаг `showRouteRides`, журнал `route_rides` | `modules/profile` (`ProfileService.writeProfile`, `ProfileRepository.updatePublicName`) | service + repository |
| Порт `RIDER_NAMES.routeRideRiders` | `modules/profile` (`rider-names.port.ts`, `rider-names.ts`, `ProfileRepository.findRouteRideRiders`) | port + repository |
| Порт `RouteRideRoutes.catalogRoute` | `modules/routes` (`route-ride-routes.{port,}.ts` поверх `RoutesRepository.inCatalogByIds`) | port |
| Порт `ActivitySource.liveActivityIds` | `modules/tracks` (`activity-source.{port,}.ts`, `TracksRepository.liveActivityIds`) | port + repository |
| Таблица «Другие» | `modules/route-rides`: `route-ride-leaderboard.ts` (чистая сборка мест), `RouteRidesRepository.leaderboardTop` (агрегат), `RouteRideLeaderboardService`, ручка в `RouteRidesController` | policy + repository + service + controller |
| Индекс | `apps/api/src/db/migrations/0047_route_rides_leaderboard_idx.ts` | migration |
| Контракты | `packages/contracts/src/profile/profile.schema.ts`, `packages/contracts/src/route-rides/route-ride.schema.ts` | contracts |
| Клиент | `packages/api-client/src/index.ts` (`getRouteRideLeaderboard`) | api-client |

Зависимость `route-rides → profile` — только HTTP-модуль `RouteRidesModule` импортирует `ProfileCoreModule` (через
`modules/profile/index.ts`); `RouteRidesCoreModule` (его берут `account`, `achievements`, worker) не меняется. Цикла нет:
`profile` не знает о `route-rides`. dependency-cruiser allow-list модулей не ведёт.

**Reuse (обязательно) / запрещённые дубли.**

- Ранжирование — ключ `bestOf` (`route-rides.policy.ts`): `segment.elapsedSec` ↑, `activity.startedAt` ↑, `_id` ↑. Не
  писать второй компаратор: вынести ключ в экспортируемый `compareRides` и использовать его в `bestOf` и в таблице.
- Своя строка — тот же путь, что «Мои заезды»: `listOwn` → `ActivitySource.liveActivities(userId, …)` → `bestOf`
  (время `me` совпадает с `summary.best` в `GET …/rides`).
- Карточка строки — `PublicRiderCard` + `riderRowFields` (`rider-names.port.ts`) и `RiderRowLink` контрактов: те же
  поля и правила P1/R3/R4, что у таблиц гонок (`results`). Условие «публичен» — `isPublicProfile` (`profile.policy.ts`),
  не копия.
- Каталог — `RoutesRepository.inCatalogByIds` (единственное условие `IN_CATALOG`); своих фильтров каталога в
  `route-rides` нет.
- Журнал согласий — `insertConsentEvent` в транзакции `writeProfile` (как Q1); дата Минска — `minskToday(date)`
  (`@pokatim/contracts`, `time.ts`); лимит — `RateLimiter` из `@rkarakulov/api-kit/core`; 404/429 — `domainError`.
- Клиент: `queryString` (`packages/api-client/src/admin.ts`) и `authorized(... withCredentials)` — как `listRouteRides`.
- Запрещено: читать `profiles`/`activities`/`routes` из `route-rides` напрямую (`$lookup` в т.ч.), кэшировать согласие
  или видимость маршрута, дублировать `riderRowFields`/`IN_CATALOG`, новый пакет.

## 6. Relevant Files

- Контракты: `packages/contracts/src/profile/profile.schema.ts` (`ProfileView`, `UpdateProfileRequest`,
  `PUBLIC_NAME_CONSENT_VERSION`), `packages/contracts/src/profile/rider-avatar.schema.ts` (`RiderRowLink`),
  `packages/contracts/src/route-rides/route-ride.schema.ts`, `packages/contracts/src/time.ts` (`LocalDate`,
  `minskToday`), образец строки — `RaceResultRow` в `packages/contracts/src/results/results.schema.ts`.
- Профиль: `apps/api/src/modules/profile/{profile.service.ts,profile.repository.ts,profile.collection.ts,profile.policy.ts,rider-names.port.ts,rider-names.ts,index.ts}`.
- Маршруты: `apps/api/src/modules/routes/{route-ride-routes.port.ts,route-ride-routes.ts,routes.repository.ts}`
  (`inCatalogByIds`, `IN_CATALOG`).
- Треки: `apps/api/src/modules/tracks/{activity-source.port.ts,activity-source.ts,tracks.repository.ts}`
  (`ownActivityHeads` — образец).
- Заезды по маршруту: `apps/api/src/modules/route-rides/{route-rides.controller.ts,route-rides.module.ts,route-rides-read.service.ts,route-rides.policy.ts,route-rides.repository.ts,route-rides.collection.ts,rider-route-rides.ts}`
  (`rider-route-rides.ts` — образец пачек `chunks`).
- Миграции: `apps/api/src/db/migrations/{0044_route_rides_passed_idx.ts,0046_route_ride_auto_plans.ts,index.ts,migrations.int.test.ts}`.
- Клиент: `packages/api-client/src/{index.ts,route-rides.test.ts,profile.test.ts,admin.ts}`.
- Тестовые помощники: `apps/api/test/{route-rides.ts,profiles.ts,tracks.ts,routes.ts,results.ts,harness.ts}`.
- Правила/доки: `.claude/rules/pokatim-{backend,contracts,db,security,tests}.md`, `docs/product/{routes,profile}.md`.

## 7. Implementation Notes

Contracts-first, TDD. Своя БД Mongo `*_test` и свой Redis db.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` O1–O5, текст пояснения, `limit`, 5000, 300/ч.
- Риск ПДн: дата заезда + маршрут = место и день; показ — только с согласием; без времени суток.
- Журнал согласий после удаления аккаунта — проверить юристом до прода (как Q1).
- Без согласия зритель видит себя в таблице, места остальных у него сдвигаются на 1 (O4).

## 8.1 Requirements Consistency (заполняет architect)

Блокеров нет. Решения §3 (O1–O5, порты, индекс, лимиты) подтверждены кодом; ниже — уточнения, найденные по коду
(рекомендация — первый вариант, принята в §11).

- **RC-1 — две ветки PR (A/B)** — подтверждено: `UpdateProfileRequest` — `strictObject`, старый API ответит 400 на
  `showRouteRides`. Порядок: PR A сливается и выкатывается на dev раньше PR B.
- **RC-2 — своя строка: из своих заездов, а не из агрегата.** Агрегат берёт до 3 лучших пройденных заездов райдера;
  если все три удалены, а живой 4-й есть, агрегат райдера теряет. Для зрителя это расходилось бы с «Моими заездами».
  (a) **рекомендация:** своя строка — `listOwn` → `liveActivities(userId)` → `bestOf` (ровно `summary.best`), зритель
  исключается из агрегатных строк и вставляется своим лучшим; (b) брать зрителя из агрегата — расхождение с R2;
  (c) поднять `n` до 100 — память ×33. Для чужих райдеров потеря строки при трёх удалённых лучших временна: заезды
  удалённой активности удаляет `RouteRidesIntakeProcessor` по `tracks.activity-removed`.
- **RC-3 — зритель в строках всегда.** O4 «место считается среди показанных + себя» = зритель с живым пройденным
  заездом входит в ранжирование и в `rows` (если попал в `limit`) независимо от `shared`; `total` — длина этого же
  списка. Другие зрители видят его, только если `shared`. Своя строка в `rows` отмечена `rideId !== null`; имя —
  по P1 как у всех (приложение подписывает «Вы»).
- **RC-4 — предел скана 5000.** `$group` проходит все `passed`-заезды маршрута (≤ 100 на райдера, квота), предел
  ограничивает только число райдеров после группировки (память и `$in` порта). Усечение: строки и `total` — по 5000
  лучшим (по лучшему из их топ-3 до фильтров); место зрителя вне скана = (число строк скана, лучших его) + 1;
  лог `route_rides.leaderboard_truncated route=<id>`. (b) keyset-скан с фильтром согласия по пачкам — сложнее, без
  выигрыша на масштабе Беларуси. Принято (a), `[ASSUMPTION]`.
- **RC-5 — `ActivitySource` «владение по `userId`».** Порт задуман только для своих активностей. Новый
  `liveActivityIds(ids)` — без `userId`: наружу только подмножество входных id (ни `userId`, ни сводок), ≤ 1000 id за
  вызов (больше — `Error`, как `rideableBounds`); комментарий порта и `pokatim-security.md` дополняются. Альтернатива —
  `liveActivities` по каждому райдеру (до 5000 запросов) — отклонена.
- **RC-6 — `catalogRoute` без линии.** `rideable` требует линию показа и `distanceM`; таблице линия не нужна.
  `catalogRoute(routeId)` → `{ id, title } | null` по `inCatalogByIds([id])` (`ready` + `IN_CATALOG`), `distanceM === null`
  → `null` (как `rideable`: маршрут без длины не участвует в заездах). Автор одобренного маршрута получает таблицу (O2).
- **RC-7 — оба флага в одном `PATCH`.** Смена `showNameInResults` и `showRouteRides` одним запросом — два события
  (`public_name`, затем `route_rides`) в одной транзакции. `KEEP_PROFILE_FIELDS` получает
  `showRouteRides: { $ifNull: ['$showRouteRides', false] }` (поле материализуется при следующей записи; бэкфилла нет).
- **RC-8 — дата строки.** `rideDate = minskToday(activity.startedAt)` (та же дата, что `rideStartedAt` у «Моих
  заездов», и второй ключ ничьей), без времени суток (риск ПДн §8).
- **RC-9 — тест миграции `0044`.** Он сверяет **полный** набор индексов `route_rides` (`toEqual`) — после `0047` тест
  падает. Обновить ожидание `0044` (третий индекс) или сверять по имени; новый тест — у `0047`.
- **RC-10 — удаление аккаунта в процессе.** Шаг `profile` стирания идёт первым (`account-erasure.service.ts`) — согласие
  исчезает до шагов `tracks`/`route-rides`; окно «подтвердил удаление → задача стирания» — как у таблиц гонок, принято.

Противоречий с инвариантами AGENTS §4 нет: серверный авторитет (клиент шлёт только флаг и `limit`), contracts-first,
границы модулей (только порты через `index.ts`), миграция expand-only.

## 8.2 Deviations from spec

Coder, 2026-10-31 (уточнения реализации, решения §3 не меняются):

- `rankLeaderboard` получает и `shared` (иначе сервис дописывал бы поле в ответ после чистой функции);
  `leaderboardTop(routeId, scanRiders, topPerRider)` — `n` параметром из политики.
- Имя индекса для `hint` — константа `ROUTE_RIDES_LEADERBOARD_INDEX` в `route-rides.repository.ts` (модуль не
  импортирует миграции; совпадение держит int-тест плана `IXSCAN route_rides_leaderboard_idx`).
- `chunks` экспортирован из `rider-route-rides.ts` (переиспользование пачек, без копии).
- Своя строка в `rows` получает карточку из того же `routeRideRiders` — значит имя/фото у неё есть, только если у
  зрителя включены и показ заездов, и показ имени; без согласия — `null` (приложение всё равно подписывает «Вы», RC-3).
- `ProfileView.showRouteRides` обязателен в выходном типе — фикстуры `ProfileView` в 22 тестах `apps/app` дополнены
  `showRouteRides: false` (только тесты, отдельный коммит), иначе `typecheck @pokatim/app` красный.

## 8.3 Security checklist

Зона — `pokatim-security.md` («Заезд по маршруту», профиль/согласия): чек-лист обязателен.

- **AuthN/AuthZ.** `GET …/rides/leaderboard` — `AuthGuard` (гость — 401), пользователь — `@CurrentUser()`; `routeId` —
  `Uuid`-pipe. Маршрут — `RouteRideRoutes.catalogRoute` без кэша на каждом запросе; не каталог, не готов, снят, скрыт,
  свой неопубликованный — один `404 NOT_FOUND`. `PATCH /v1/profile` — без изменений (свой профиль из access).
- **Входные данные.** Query — `RouteRideLeaderboardQuery` (`strictObject`, `limit` 1–100, `coerce`), лишние ключи —
  400. Тело `PATCH` — `showRouteRides: boolean` (не boolean — `INVALID`); версия согласия и время — сервер.
- **Данные наружу.** Явный список полей строки (int-тест ключей): `place`, `elapsedSec`, `rideDate` (`LocalDate`, без
  времени суток), `riderName`/`riderPublicId`/`riderAvatar` (только «имя + `showNameInResults`», иначе `null`), `rideId`
  (только своя строка). Нет `userId`, `activityId`, `routeId`, источника, дистанции, трека, сегмента, `createdAt`.
  Чужие строки — только при `showRouteRides: true` сейчас (фильтр запроса `routeRideRiders`, без кэша). Порт
  `liveActivityIds` отдаёт только подмножество входных id.
- **Злоупотребления.** Лимит `route-rides-leaderboard:<uid>` 300/ч до любых чтений (считает и 404) → `429
  RATE_LIMITED` с `retryAfterSec`; `limit` ≤ 100; скан ≤ 5000 райдеров; `liveActivityIds` ≤ 1000 id за вызов
  (пачки). Перебор `routeId` бесполезен: 404 одинаков, данные — только с согласием. `PATCH` — прежний лимит
  `profile-update` 30/ч.
- **Секреты и логи.** Логи — id маршрута и счётчики (`route_rides.leaderboard_truncated`); без имён, дат заездов,
  `userId` чужих.
- **Аудит.** `profile_consent_events` — append-only (`insertOne`, тест-сторож), `kind: 'route_rides'`,
  `granted|revoked`, `ROUTE_RIDES_CONSENT_VERSION`, время `CLOCK`, только при фактической смене, в транзакции `PATCH`.
  Хранение после удаления аккаунта — риск §8 (юрист до прода, как Q1).
- **Кэш.** `Cache-Control: no-store`; гостевого/SSR доступа нет (§4).

## 9. Acceptance Criteria

1. Без согласия чужие заезды не видны; с согласием — лучший живой пройденный заезд райдера, имя по P1/R4.
2. `me` видна себе без согласия; другим — только с согласием.
3. Отзыв согласия / удаление аккаунта / удаление активности / снятие маршрута — строки нет.
4. Журнал согласий пишет `granted/revoked` только при смене, в транзакции `PATCH`.
5. Не каталог / не видимый маршрут — 404; гость — 401.
6. Старые клиенты: `PATCH` профиля без `showRouteRides` работает; ответ профиля — аддитивно.
7. Тесты, lint, typecheck затронутых пакетов зелёные; CI зелёный.

## 10. Documentation Impact

`docs/product/routes.md`, `docs/product/profile.md`, `.claude/rules/pokatim-*.md` по факту, `pr.md`.

## 11. Implementation Context (заполняет architect)

Status: **APPROVED** (уточнения — §8.1 RC-2…RC-10, блокеров нет).

### ENTRY POINTS

- HTTP: `GET /v1/routes/:routeId/rides/leaderboard?limit=` — `RouteRidesController.leaderboard` (объявить **до**
  `@Get(':rideId')`) → `RouteRideLeaderboardService.table(userId, routeId, query)`.
- HTTP: `PATCH /v1/profile` — `ProfileService.update` → `writeProfile` (флаг и журнал), `GET /v1/profile` — `view`.
- Миграция: `0047_route_rides_leaderboard_idx` (`pnpm --filter @pokatim/api db:migrate`).
- Клиент: `api.getRouteRideLeaderboard(accessToken, routeId, params?)`.

### FILES TO MODIFY

Контракты:
- `packages/contracts/src/profile/profile.schema.ts` — `ROUTE_RIDES_CONSENT_VERSION`, `ProfileView.showRouteRides`,
  `UpdateProfileRequest.showRouteRides` (+ условие `REQUIRED`).
- `packages/contracts/src/route-rides/route-ride.schema.ts` — константы, `RouteRideLeaderboardQuery`,
  `RouteRideLeaderboardRow`, `RouteRideLeaderboardMe`, `RouteRideLeaderboard` (импорт `RiderRowLink` из
  `../profile/rider-avatar.schema.ts`, `LocalDate` из `../time.ts`).
- `packages/contracts/src/{profile/profile.schema.test.ts,route-rides/route-ride.schema.test.ts}`.

Клиент:
- `packages/api-client/src/index.ts` — тип `RouteRideLeaderboardParams = Partial<Pick<RouteRideLeaderboardQuery, 'limit'>>`,
  метод `getRouteRideLeaderboard` после `getRouteRideTrack`:
  ``request(`/v1/routes/${encodeURIComponent(routeId)}/rides/leaderboard${queryString(params)}`, RouteRideLeaderboard,
  authorized(accessToken, { method: 'GET', ...withCredentials }))``; `packages/api-client/src/route-rides.test.ts`,
  `packages/api-client/src/profile.test.ts`.

Профиль:
- `apps/api/src/modules/profile/profile.collection.ts` — `ProfileDoc.showRouteRides?: boolean` (нет поля — `false`),
  `PROFILE_CONSENT_KINDS = ['public_name', 'route_rides']`; комментарий `ProfileConsentEventDoc.version` — версия
  вида согласия.
- `apps/api/src/modules/profile/profile.repository.ts` — `ProfileViewDoc`/`VIEW_PROJECTION` + `showRouteRides`;
  `KEEP_PROFILE_FIELDS.showRouteRides = { $ifNull: ['$showRouteRides', false] }`; `updatePublicName` — `patch.showRouteRides`
  (`undefined` — KEEP, иначе `$literal`); новый `findRouteRideRiders(userIds)`:
  `find({ _id: { $in }, showRouteRides: true }, { projection: { publicName: 1, showNameInResults: 1, publicId: 1, avatarId: 1 } })`.
- `apps/api/src/modules/profile/profile.policy.ts` — `profileViewOf`: `showRouteRides: doc?.showRouteRides ?? false`.
- `apps/api/src/modules/profile/profile.service.ts` — `ProfilePatch.showRouteRides`; в `writeProfile` после события
  `public_name`: `wasShared = before?.showRouteRides ?? false`, `shared = after.showRouteRides ?? false`, при смене —
  `insertConsentEvent({ kind: 'route_rides', action, version: ROUTE_RIDES_CONSENT_VERSION, at: now })`. Перевыпуск
  фото (`isPublicProfile`) от `showRouteRides` **не** зависит.
- `apps/api/src/modules/profile/rider-names.port.ts` + `rider-names.ts` — метод порта (см. TYPES).
- `apps/api/src/modules/profile/index.ts` — экспорт `type RouteRideRiders` (тип ответа порта).

Маршруты:
- `apps/api/src/modules/routes/route-ride-routes.port.ts` + `route-ride-routes.ts` — `catalogRoute(routeId)`.

Треки:
- `apps/api/src/modules/tracks/activity-source.port.ts` + `activity-source.ts` — `liveActivityIds(ids)`;
  `tracks.repository.ts` — `liveActivityIds(ids)`: `find({ _id: { $in } }, { projection: { _id: 1 } })`.

Заезды по маршруту:
- `apps/api/src/modules/route-rides/route-rides.policy.ts` — вынести ключ `bestOf` в экспортируемый
  `compareRides(a, b)`; `ROUTE_RIDE_LEADERBOARD_POLICY = { scanRiders: 5000, topPerRider: 3, liveBatch: 1000,
  userLimit: { limit: 300, windowSec: 3600 } }`.
- **новый** `apps/api/src/modules/route-rides/route-ride-leaderboard.ts` — чистые функции `firstAlive`,
  `rankLeaderboard` (см. TYPES).
- `apps/api/src/modules/route-rides/route-rides.repository.ts` — `leaderboardTop(routeId, scanRiders)` (агрегат ниже).
- **новый** `apps/api/src/modules/route-rides/route-ride-leaderboard.service.ts` — `RouteRideLeaderboardService`.
- `apps/api/src/modules/route-rides/route-rides.controller.ts` — ручка `leaderboard`.
- `apps/api/src/modules/route-rides/route-rides.module.ts` — `RouteRidesModule.imports += ProfileCoreModule`
  (из `../profile`), `providers += RouteRideLeaderboardService`.

Миграции:
- **новый** `apps/api/src/db/migrations/0047_route_rides_leaderboard_idx.ts` — `ROUTE_RIDES_LEADERBOARD_INDEX`
  (`satisfies IndexDef`), `routeRidesLeaderboardIdx` (`createIndex`, без транзакции и бэкфилла, идемпотентна, после
  `0046_route_ride_auto_plans`); `index.ts` — в конец списка; `migrations.int.test.ts` — новый тест и ожидание `0044`
  (RC-9).

Доки и правила (последний коммит): `docs/product/routes.md` (O1–O5 — «сделано», API), `docs/product/profile.md`
(раздел «Показ заездов в таблицах маршрутов (route-rides-04)»: флаг, журнал `route_rides`, версия, риск Q1),
`.claude/rules/pokatim-backend.md` (порты `routeRideRiders`/`catalogRoute`/`liveActivityIds`, `route-rides → profile`),
`pokatim-contracts.md` (схемы, `ROUTE_RIDES_CONSENT_VERSION`, api-client), `pokatim-db.md` (`0047`, вид журнала),
`pokatim-security.md` (раздел route-rides: таблица «Другие», R2 снят, кросс-пользовательский `liveActivityIds`),
`docs/tasks/2026-10-31-route-rides-04-others/pr.md`.

### FILES TO READ

`AGENTS.md` §4; `.claude/rules/pokatim-{backend,contracts,db,security,tests}.md` (разделы profile и route-rides);
`docs/product/profile.md` (P1, Q1, R3, R4, R9); `apps/api/src/modules/route-rides/route-rides-read.service.ts`
(`visible`, порядок 404/лимит); `apps/api/src/modules/route-rides/rider-route-rides.ts` (пачки);
`apps/api/src/modules/results/*` (как `publicRiders` + `riderRowFields` дают строки); `apps/api/test/route-rides.ts`
(`catalogCorridorRoute`, `ownCorridorRoute`), `apps/api/test/profiles.ts` (`patchProfile`, `publicRider`).

### TYPES & SCHEMAS

Контракт профиля (`profile.schema.ts`):

```ts
/** Версия текста согласия «Показывать мои заезды в таблицах маршрутов» (route-rides-04); ключи i18n — PR B. */
export const ROUTE_RIDES_CONSENT_VERSION = '2026-10-31';

// ProfileView — аддитивно (старый сервер — false):
showRouteRides: z.boolean().default(false),

export const UpdateProfileRequest = z
  .strictObject({
    publicName: RiderPublicName.optional(),
    showNameInResults: z.boolean({ error: fieldError('INVALID') }).optional(),
    club: RiderClub.optional(),
    showRouteRides: z.boolean({ error: fieldError('INVALID') }).optional(),
  })
  .refine(
    (body) =>
      body.publicName !== undefined ||
      body.showNameInResults !== undefined ||
      body.club !== undefined ||
      body.showRouteRides !== undefined,
    { error: 'REQUIRED' },
  );
```

Контракт таблицы (`route-ride.schema.ts`):

```ts
/** Строк таблицы «Другие» за запрос (route-rides-04): по умолчанию 10, не больше 100; курсора нет. */
export const ROUTE_RIDE_LEADERBOARD_DEFAULT = 10;
export const ROUTE_RIDE_LEADERBOARD_MAX = 100;

/** `GET /v1/routes/:routeId/rides/leaderboard` — лишние ключи — 400. */
export const RouteRideLeaderboardQuery = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(ROUTE_RIDE_LEADERBOARD_MAX)
    .default(ROUTE_RIDE_LEADERBOARD_DEFAULT),
});
export type RouteRideLeaderboardQuery = z.infer<typeof RouteRideLeaderboardQuery>;

/**
 * Строка таблицы «Другие» (O3): лучший живой пройденный заезд райдера с согласием; места уникальные (1…), без «=N».
 * Имя, ссылка и фото — по P1/R4 (иначе `null` → «Участник»). `rideId` — только у своей строки («Вы»).
 */
export const RouteRideLeaderboardRow = z.object({
  place: int,
  elapsedSec: int,
  /** день заезда по Минску, без времени суток */
  rideDate: LocalDate,
  riderName: z.string().nullable().default(null),
  ...RiderRowLink,
  rideId: Uuid.nullable().default(null),
});
export type RouteRideLeaderboardRow = z.infer<typeof RouteRideLeaderboardRow>;

/** Своя строка (O4): видна себе всегда, пока есть живой пройденный заезд; место — среди строк таблицы и себя. */
export const RouteRideLeaderboardMe = z.object({
  place: int,
  elapsedSec: int,
  rideDate: LocalDate,
  rideId: Uuid,
});
export type RouteRideLeaderboardMe = z.infer<typeof RouteRideLeaderboardMe>;

/**
 * Таблица «Другие» маршрута каталога (route-rides-04, `no-store`): первые `limit` строк, `total` — всего строк
 * (райдеры с согласием + вы), `me` — своя строка или `null`, `shared` — включён ли у вас показ заездов.
 */
export const RouteRideLeaderboard = z.object({
  rows: z.array(RouteRideLeaderboardRow).max(ROUTE_RIDE_LEADERBOARD_MAX),
  total: int,
  me: RouteRideLeaderboardMe.nullable(),
  shared: z.boolean(),
});
export type RouteRideLeaderboard = z.infer<typeof RouteRideLeaderboard>;
```

Порты:

```ts
// profile/rider-names.port.ts
/** Райдеры с согласием на показ заездов (route-rides-04): `shares` — у кого `showRouteRides`; `cards` — из них
 * публичные (имя + `showNameInResults`, как `publicRiders`). Один запрос, согласие — в фильтре. */
export interface RouteRideRiders { shares: Set<string>; cards: Map<string, PublicRiderCard> }
routeRideRiders(userIds: readonly string[]): Promise<RouteRideRiders>; // пустой вход — пустые без запроса; дедуп

// routes/route-ride-routes.port.ts
/** Маршрут каталога (`ready` + `IN_CATALOG`, длина есть) без кэша — таблица «Другие»; иначе `null`. */
catalogRoute(routeId: string): Promise<{ id: string; title: string } | null>;

// tracks/activity-source.port.ts
/** Какие из активностей (любых пользователей) живы сейчас (route-rides-04): наружу только подмножество входных id;
 * ≤ 1000 id за вызов (больше — Error); пустой вход — пустое множество без запроса. */
liveActivityIds(ids: readonly string[]): Promise<Set<string>>;
```

Агрегат `RouteRidesRepository.leaderboardTop(routeId, scanRiders)` (индекс `route_rides_leaderboard_idx`, `hint`):

```ts
type TopRide = { id: string; activityId: string; elapsedSec: number; startedAt: Date };
// → Promise<{ userId: string; top: TopRide[] }[]>
[
  { $match: { routeId, status: 'passed' } },
  { $group: { _id: '$userId', top: { $topN: {
      n: ROUTE_RIDE_LEADERBOARD_POLICY.topPerRider,
      sortBy: { 'segment.elapsedSec': 1, 'activity.startedAt': 1, _id: 1 },
      output: { id: '$_id', activityId: '$activityId', elapsedSec: '$segment.elapsedSec', startedAt: '$activity.startedAt' },
  } } } },
  { $set: { best: { $first: '$top' } } },
  { $sort: { 'best.elapsedSec': 1, 'best.startedAt': 1, 'best.id': 1 } },
  { $limit: scanRiders },
  { $project: { _id: 0, userId: '$_id', top: 1 } },
]
```

Сервис `RouteRideLeaderboardService.table(userId, routeId, { limit })`, порядок:

1. `rateLimiter.consume('route-rides-leaderboard:' + userId, ROUTE_RIDE_LEADERBOARD_POLICY.userLimit, now)` → `429
   RATE_LIMITED { retryAfterSec }`.
2. `routes.catalogRoute(routeId)` → `null` — `404 NOT_FOUND`.
3. `repository.leaderboardTop(routeId, scanRiders)`; длина = `scanRiders` — `logger.warn('route_rides.leaderboard_truncated route=<id>')`.
4. `names.routeRideRiders([...scanned.userIds без зрителя, userId])` → `shared = shares.has(userId)`; другие — только
   `shares.has`.
5. `activities.liveActivityIds` пачками по 1000 по `top[].activityId` райдеров с согласием → `firstAlive(top, live)`.
6. Своя: `listOwn(userId, routeId)` → `liveActivities(userId, ids)` → `bestOf(alive)` (RC-2).
7. `rankLeaderboard({ others, me, cards, limit })` → ответ (поля — явным литералом, `riderRowFields(card)`).

```ts
// route-ride-leaderboard.ts — чистые функции (unit)
export interface LeaderboardEntry { userId: string; rideId: string; elapsedSec: number; startedAt: Date }
/** Первый живой из топ-3 (уже в порядке ключа); нет — undefined. */
export function firstAlive(top: readonly TopRide[], live: ReadonlySet<string>): TopRide | undefined;
/** Сортировка по `compareRides`-ключу (elapsedSec, startedAt, rideId), места 1…n уникальные; зритель (`me`) — в
 * общем списке; rows = первые limit; total = n; me — запись зрителя с местом или null. */
export function rankLeaderboard(input: {
  others: readonly LeaderboardEntry[]; me: LeaderboardEntry | null;
  cards: ReadonlyMap<string, PublicRiderCard>; limit: number;
}): RouteRideLeaderboard;
// rideDate = minskToday(entry.startedAt); rideId — только у entry.userId === me.userId
```

Индекс (`0047`):

```ts
export const ROUTE_RIDES_LEADERBOARD_INDEX = {
  key: { routeId: 1, 'segment.elapsedSec': 1, 'activity.startedAt': 1, _id: 1 },
  options: { name: 'route_rides_leaderboard_idx', partialFilterExpression: { status: 'passed' } },
} as const satisfies IndexDef;
// id: '0047_route_rides_leaderboard_idx'
```

### TESTS

Unit (vitest):
- `packages/contracts/src/profile/profile.schema.test.ts`: `ProfileView` старого сервера без поля → `showRouteRides:
  false`; `UpdateProfileRequest` — `{ showRouteRides: true }` проходит; `{ showRouteRides: 'yes' }` → `INVALID`;
  `{}` → `REQUIRED`; лишний ключ — ошибка; `ROUTE_RIDES_CONSENT_VERSION` — дата `YYYY-MM-DD`.
- `packages/contracts/src/route-rides/route-ride.schema.test.ts`: query — `{}` → `limit 10`, `'5'` → 5, `0`/`101`/
  `1.5` — ошибка, лишний ключ — ошибка; ответ — строка без `riderName`/`riderPublicId`/`riderAvatar`/`rideId` →
  `null`; `rideDate` с временем — ошибка; `rows` > 100 — ошибка.
- `packages/api-client/src/route-rides.test.ts`: `getRouteRideLeaderboard` — `GET …/rides/leaderboard?limit=5`, без
  params — без query, Bearer, ответ через zod; `profile.test.ts` — `showRouteRides` в теле `PATCH`.
- `apps/api/src/modules/route-rides/route-ride-leaderboard.test.ts` (новый): ничья по времени → раньше дата, затем
  меньший `rideId`; места уникальные; `firstAlive` — лучший удалён → второй, все три удалены → нет строки; зритель
  без согласия в списке, места других сдвинуты; `me` вне `limit` — есть в `me`, нет в `rows`; `total`; `rideId` только
  у своей; карточка → поля P1, нет карточки → `null`; `rideDate` по Минску (заезд 22:30 UTC → следующий день).
- `apps/api/src/modules/route-rides/route-rides.policy.test.ts`: `compareRides` = прежний порядок `bestOf` (регрессия).
- `apps/api/src/modules/profile/rider-names.test.ts`: `routeRideRiders` — пустой вход без запроса, дедуп, `cards`
  только при имени + `showNameInResults`.

Интеграционные (реальные Mongo `*_test` и Redis db своего агента):
- `apps/api/src/modules/profile/profile.int.test.ts`: `GET` нового профиля — `showRouteRides: false`; `PATCH
  { showRouteRides: true }` → ответ `true` + одно событие `{ kind: 'route_rides', action: 'granted', version:
  ROUTE_RIDES_CONSENT_VERSION }`; повтор `true` — событий не прибавилось; `false` → `revoked`; оба флага одним
  `PATCH` → два события в одной транзакции; `PATCH { publicName }` без ключа — флаг сохранён; старый документ без поля
  → `false`; сторож append-only журнала проходит.
- `apps/api/src/modules/routes/route-ride-routes.int.test.ts`: `catalogRoute` — маршрут команды в каталоге и
  одобренный маршрут райдера → `{ id, title }`; свой неопубликованный, `pending`/`hidden`/`withdrawn`, не `ready`,
  снят с каталога, неизвестный → `null`.
- `apps/api/src/modules/tracks/activity-source.int.test.ts`: `liveActivityIds` — активности разных пользователей,
  удалённая и неизвестная — нет; пустой вход; 1001 id → `Error`.
- **новый** `apps/api/src/modules/route-rides/route-ride-leaderboard.int.test.ts` (заезды — прямой вставкой
  `newRideDoc`/`routeRidesDb` поверх реальных активностей `test/tracks`; маршрут — `catalogCorridorRoute`):
  гость → 401; маршрут не каталога / свой неопубликованный / снятый (`publicationDoc`) → 404; `limit=0` → 400;
  без согласия чужие не видны; с согласием — лучший живой пройденный, имя/ссылка/фото по P1 (с `showNameInResults`)
  и `null` без него; `not_passed`/`failed` не участвуют; удалённая лучшая активность → строка по следующему; отзыв
  согласия → строки нет; стирание аккаунта (`ProfileErasure` / удаление профиля) → строки нет; автозаезд (`origin:
  'auto'`) участвует; зритель без согласия видит себя (`shared: false`, `me`, места сдвинуты), второй зритель его не
  видит; одобренный маршрут райдера — таблица есть и у автора; ключи ответа и строки — точный список (нет `userId`,
  `activityId`), `rideId` только у своей; `Cache-Control: no-store`; лимит — исчерпать ключ
  `route-rides-leaderboard:<uid>` через `RateLimiter` (300) → 429 с `retryAfterSec`, 404 тоже тратит лимит;
  усечение — `leaderboardTop(routeId, 2)` на 3 райдерах отдаёт 2 лучших; план `explain` агрегата — `IXSCAN
  route_rides_leaderboard_idx`.
- `apps/api/src/db/migrations/migrations.int.test.ts`: `0047` сразу после `0046`, индекс `{ routeId,
  'segment.elapsedSec', 'activity.startedAt', _id }` частичный по `passed`, повторный `up` без изменений; тест `0044`
  — ожидание с третьим индексом (RC-9).

E2E: нет (UI — PR B).

Порядок шагов (TDD, отдельный коммит на шаг; после каждого — тесты затронутых пакетов):
1. contracts: профиль (`showRouteRides`, версия) + таблица — тесты → схемы.
2. api-client: `getRouteRideLeaderboard` — тест → метод.
3. profile: флаг, журнал, `routeRideRiders` — int/unit → код.
4. tracks `liveActivityIds` + routes `catalogRoute` — int → код.
5. миграция `0047` — тест → миграция (+ правка теста `0044`).
6. route-rides: `compareRides`, `route-ride-leaderboard.ts` (unit) → `leaderboardTop` → сервис → контроллер (int).
7. docs/rules/pr.md; полный `pnpm check` (`TURBO_CONCURRENCY=4`) перед PR.

### OUT OF SCOPE

PR B (`feature/route-rides-others-app`): блок «Другие на маршруте» на карточке (5 строк + своя), «Видно только вам» /
«Включить показ», экран `/routes/others/<id>` и сторож манифеста SSR, переключатель в форме профиля и тексты i18n
(`profile.routeRides.*`), строки `TableRow`/`RiderWho`. Также: участки (route-rides-05), таблица у «Моих маршрутов»,
гостевой/SSR доступ, курсор, уведомления, трек/карта чужого заезда, фильтры, жалобы, панель (журнал согласий в
«Протоколе»).

## 12. Outcome (заполняет coder)

Coder, 2026-10-31. PR A реализован по §11, 7 шагов TDD — отдельные коммиты (+ коммит фикстур приложения).

- **Контракты:** `ROUTE_RIDES_CONSENT_VERSION`, `ProfileView.showRouteRides`, `UpdateProfileRequest.showRouteRides`;
  `ROUTE_RIDE_LEADERBOARD_DEFAULT/MAX`, `RouteRideLeaderboardQuery/Row/Me`, `RouteRideLeaderboard`.
- **api-client:** `RouteRideLeaderboardParams`, `getRouteRideLeaderboard`.
- **API:** профиль (флаг, журнал `route_rides`, `findRouteRideRiders`, порт `routeRideRiders`); `catalogRoute`;
  `liveActivityIds`; `compareRides`, `ROUTE_RIDE_LEADERBOARD_POLICY`, `route-ride-leaderboard.ts`, `leaderboardTop`,
  `RouteRideLeaderboardService`, ручка `leaderboard`; миграция `0047` (+ ожидание `0044`, RC-9; `0046` больше не
  последняя).
- **Проверки (MONGO `pokatim_rr04_test`, Redis db 7):** contracts — 496 тестов, typecheck 0 ошибок; api-client — 172
  теста, typecheck 0; api — unit 941 тест (100 файлов), int+unit модулей route-rides, profile, routes, tracks,
  account, migrations, `test/harness.int.test.ts` — 642 теста (46 файлов); typecheck api и app — 0 ошибок; jest
  изменённых тестов app — 441 (22 набора); eslint затронутых путей — чисто; `pnpm format:check` — чисто; `pnpm
  arch:check` — 0 нарушений. Полный `pnpm check` не запускался (решение пользователя) — перед PR.
- **Отрицательные доказательства** (временная правка сервиса, откачено): без фильтра согласия `shares.has` — 3 int-теста
  таблицы красные; своя строка без фильтра живых активностей — 1 красный.
- Доки: `docs/product/routes.md`, `docs/product/profile.md`, правила `pokatim-{backend,contracts,db,security}.md`,
  `pr.md`.
