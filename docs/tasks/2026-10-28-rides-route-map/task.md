# 1. Title

Кофе-райды 05c: маршрут у райда (карта и профиль высоты на карточке), карта ленты и фильтр «Рядом» (гео-индекс,
запрос по радиусу), пустое состояние без геопозиции.

# 2. Goal

Довести экран 05 «Кофе-райды» прототипа: организатор прикрепляет к райду маршрут из каталога или из «Моих
маршрутов» — участники видят карту маршрута и профиль высоты со скраббингом, «Набор» в цифрах и дистанцию из
маршрута; ленту можно смотреть картой точек старта и фильтровать «Рядом» по геопозиции пользователя.

Источники: прототип «Кофе-райды» (лента «рядом, по времени», «в N км от вас», шапка детали — карта маршрута, форма
с пикером «Маршрут» и «Дистанция — из маршрута. Можно изменить.»), `docs/product/rides.md` (таблица «Скрыто и до
каких блоков»), `docs/product/routes.md`, ADR-0013, ADR-0014 (п. 5 — приватность координат), routes-01…06.

**Human gate:** пропущен — автономный режим (память `autonomous-mode`), задача поставлена сессией-оркестратором с явным
требованием «API запроса по радиусу». Решения ниже — `[ASSUMPTION]` (§8), отражаются в `docs/product/rides.md` и
поправке ADR-0014.

# 3. Scope

**PR A — контракты, API, миграция, api-client, docs.**
- `RideDoc.routeId: string | null` и `RideDoc.geo: GeoJSON Point` (точка для «Рядом»), `RideDoc.startPrecise: boolean`.
- Создание и правка райда принимают `routeId` (`uuid | null`). Прикрепить можно: маршрут, видимый публично
  (`findInCatalog`: каталог команды или одобренный маршрут райдера), **или** свой маршрут организатора в статусе
  `ready` (любая публикация). Иначе — `400 VALIDATION_FAILED` (8.1 RC-5) поле `routeId` (`RIDE_ROUTE_UNAVAILABLE`) — один ответ на
  «нет такого», «чужой непубличный», «не готов» (без оракула существования).
- Точка старта: маршрут прикреплён → `geo` = старт маршрута, `startPrecise = true`; без маршрута → центр города
  (`CITY_CENTERS` в контрактах), `startPrecise = false`. Пересчитывается при смене маршрута или города.
- Ответ райда (карточка, `me`, лента, публичная карточка): `route: RideRoute | null` (`.default(null)`) и
  `start: [lon, lat] | null` (только `startPrecise`).
  - `RideRoute = { id, title, distanceM, elevationGainM, access: 'public' | 'private' }`.
  - **Инвариант приватности:** не-организатору (и в публичной кэшируемой карточке) `route` отдаётся только если маршрут
    сейчас в `findInCatalog` — проверка на каждом чтении через порт routes, без снимка геометрии в райде и без кэша.
    Иначе `route: null`. Организатору — свой непубличный маршрут с `access: 'private'` (через `findOwn`).
  - `start` — старт маршрута, **видимого зрителю сейчас** (та же проверка, что у `route`); после снятия маршрута с
    публикации точка наружу не отдаётся (8.1 RC-1 — заменяет прежнее `[ASSUMPTION A3]`). Для `access: 'private'`
    (свой непубличный маршрут) точка **не** раскрывается не-организатору: `geo` = центр города, `startPrecise = false`,
    пока маршрут не опубликован; на чтении — та же проверка.
  - Удалённый/стёртый маршрут — висячий `routeId` → `route: null` без 500.
- Карта и профиль маршрута на карточке — существующими эндпоинтами: `GET /v1/routes/:id`, `/:id/map` (публичный) и
  `GET /v1/routes/mine/:id`, `/mine/:id/map` (организатору). Новых эндпоинтов геометрии нет.
- «Рядом»: `GET /v1/rides?near=<lat>,<lon>&radiusKm=<5..100>` (+ `city`, `cursor`, `limit` как раньше) — фильтр
  `$geoWithin: { $centerSphere }` по `geo`, сортировка по времени (курсор не меняется). Координаты из запроса — не
  хранятся, не логируются (проверить логгер), округляются клиентом до 0,01°.
- Карта ленты: `GET /v1/rides/map?near&radiusKm&city` → `{ items: [{ id, title, startsAt, start, goingCount, limit,
  full }] }` — только `startPrecise`, будущие видимые зрителю, ≤ 200, сорт. по времени; `no-store`, `AuthGuard`.
- Миграция `0031_rides_geo` (номер — следующий свободный на момент слияния): бэкфилл `routeId: null`,
  `geo` = центр города, `startPrecise: false`; индекс `rides_geo_feed_idx` `{ geo: '2dsphere', startsAt: 1 }`.
- Порт routes для rides: отдельный порт `RIDE_ROUTES` (`RideRoutes`, 8.1 RC-2; `RouteCatalog` не расширяется) — чтение
  маршрута райда по правилам выше (публичный через `IN_CATALOG`, свой — по `ownerUserId`); `rides → routes` только через
  порт (`RoutesCoreModule`).
- ADR-0014 — поправка 05c: координаты для «Рядом» уходят в запрос ленты (округлённые, по нажатию, не хранятся).
  `docs/product/rides.md`, `docs/product/routes.md` (маршрут в райде).

**PR B — приложение.**
- Форма райда: поле «Маршрут» (пикер — экран выбора: вкладки «Каталог» / «Мои», поиск не нужен; свой непубличный
  помечен «Виден только вам»), «Без маршрута»; при выборе — дистанция подставляется (helper «Из маршрута. Можно
  изменить.»).
- Карточка райда: шапка — карта маршрута (`CatalogRouteMap`/`RouteLineMap` 3:2 в прокрутке, как карта гонки) и
  профиль высоты со скраббингом (`ElevationProfile` + общий `scrub`), «Набор» в `StatBlock`, строка-ссылка «Маршрут
  райда» → `routes/[id]` (публичный) или `routes/mine/[id]` (свой). Организатору с непубличным маршрутом — баннер
  «Маршрут виден только вам — опубликуйте его, чтобы участники увидели карту».
- Лента: переключатель «Список / Карта» и чип «Рядом». «Рядом» — одно foreground-чтение позиции по нажатию (как
  «Моё местоположение»), координаты — только в памяти; «в N км от вас» в строке райда — расчёт на клиенте для
  `start != null`. Карта — точки старта (новый компонент мультимаркеров, native MapLibre RN / web maplibre-gl), нажатие
  на точку — карточка райда; райды без точной точки — строкой «Ещё N райдов без точки старта — в списке».
- Без разрешения (отказ, ошибка, web без геолокации): пустое состояние «Включите геопозицию, чтобы видеть райды рядом»
  + «Открыть настройки» (native, отказ навсегда) / «Разрешить» + «Выбрать город» (переход к фильтру городов).
- Строка iOS `locationWhenInUsePermission` — упомянуть «райды рядом» (новая нативная сборка).

# 4. Out of Scope

- Фото организатора и аватары участников: аватаров в профиле нет — зависимость от профиля (отчёт).
- Выбор точки старта булавкой на карте без маршрута; геокодер адреса места встречи.
- Карточка-приглашение, шит «Райд опубликован», «в N км» на сервере, сортировка по расстоянию.
- Панель: модерация райда не показывает маршрут (маршруты модерируются своим разделом).
- Уведомления участникам о смене маршрута.

# 5. Architecture Context

Architect review (plan), 2026-10-28. **Status: CONCERNS.** Блокеров нет. Есть шесть решений, которые расходятся со
spec (8.1 RC-1…RC-6). Они уже внесены в план ниже; §3/§8/§9 поправлены точечно, со ссылкой на 8.1.

- **Владелец данных.** Райд хранит только `routeId`, точку для «Рядом» `geo` (GeoJSON Point) и флаг
  `startPrecise`. Название, длину, набор и старт маршрута райд не хранит: на каждом чтении их отдаёт **новый порт
  routes** `RIDE_ROUTES` (`RideRoutes`), без кэша. Геометрию и профиль клиент берёт существующими эндпоинтами routes.
- **Видимость маршрута в райде** проверяется на каждом чтении в `RidesFeedService` (лента, `me`, публичная карточка,
  карта ленты, ответы мутаций) одним батч-вызовом порта на страницу:
  - `access: 'public'` — маршрут сейчас в `IN_CATALOG` (`findInCatalog`-условие, ready);
  - `access: 'private'` — свой готовый маршрут райдера, и зритель — **организатор этого райда**;
  - иначе `route: null`.
- **`start` = старт видимого зрителю маршрута** (`route ? routeStart : null`). Снимок точки в райде наружу не
  уходит (RC-1 заменяет A3). `geo`/`startPrecise` — только фильтр «Рядом» и выборка карты ленты.
- **`geo` пишется при записи райда** (создание, правка). Маршрут виден публично в момент записи — `geo = route.start`,
  `startPrecise = true`. Иначе (нет маршрута или свой непубличный) — `CITY_CENTERS[cityCode]`, `startPrecise = false`.
  При правке `geo` пересчитывается, если меняется `routeId` или `cityCode` или у райда прикреплён маршрут с
  `startPrecise = false` (свой маршрут стал публичным — точка «повышается» любой правкой, RC-3).
- **Перенос (`rescheduledAt`, событие `ride-rescheduled`)** к прежним условиям (время, город, место) добавляет одно:
  была точная точка, новая тоже точная, и координаты отличаются (RC-4).
- **«Рядом».** Фильтр `$geoWithin: { $centerSphere: [[lon, lat], radiusKm / 6378.1] }` по `geo` внутри `$and`
  существующей ленты. Курсор `(startsAt, _id)` и сортировка не меняются. `$near`/`$geoNear` не используются: они
  сортируют по расстоянию и ломают курсор.
- **Карта ленты** `GET /v1/rides/map` — в том же `RidesController` (`AuthGuard`, `no-store`), статический путь
  (как `cities`). Ответ — точки только для `startPrecise` и маршрута, который виден зрителю сейчас, плюс счётчик
  `withoutStart`.
- **Границы модулей.** `rides → routes` — только через `modules/routes/index.ts` (порт `RIDE_ROUTES`).
  `RidesCoreModule` импортирует **и реэкспортирует** `RoutesCoreModule` (цикла нет: routes от rides не зависит).
  Порт нужен `RideErasure` в ядре; `RidesService`/`RidesFeedService` из `RidesModule` видят его только через
  реэкспорт, транзитивного импорта в Nest нет. Ядро rides работает и в worker (`account`), а `RoutesCoreModule`
  там уже есть.
- **Стирание (ADR-0015).** `RideErasure.erase` ещё и сбрасывает точки райдов (любых организаторов), прикреплённых к
  маршрутам удаляемого пользователя: `geo` = центр города, `startPrecise = false`. Список его маршрутов — порт
  `RideRoutes.ownedRouteIds(userId)`. Шаг rides идёт до шага routes (`account-erasure.service.ts`), id ещё есть.
  `routeId` не трогается: маршрута больше нет, чтение даёт `null`.
- **Клиент.** Координаты пользователя живут только в состоянии экрана вкладки «Райды» (память). В ключ TanStack
  Query попадает не координата, а счётчик нажатия «Рядом» (RC-7). Persist кэша в приложении нет (проверено: нет
  `persistQueryClient`; SW кэширует только precache-список, не `/v1`).

# 5.1 Placement & Reuse Gate

| Что | Где | Почему |
|---|---|---|
| `CITY_CENTERS` | `packages/contracts/src/geo/city.schema.ts` | рядом с `CITY_CODES`. Тип `Record<CityCode, LonLat>` ловит пропущенный город. Нужен API (запись, миграция) и приложению (камера пустой карты ленты по выбранному городу) |
| `RideRoute`, `RideMapPoint`, `RideMap`, `RideMapQuery`, `near`/`radiusKm` | `packages/contracts/src/rides/ride.schema.ts` | contracts-first |
| `RIDE_ROUTE_UNAVAILABLE` | `packages/contracts/src/common.ts`, новый массив `RIDE_ROUTE_FIELD_ERROR_CODES` после `CORRIDOR_FIELD_ERROR_CODES` | коды полей — только в конец |
| Порт `RIDE_ROUTES` / `RideRoutes` + реализация `RideRoutesService` | `apps/api/src/modules/routes/ride-routes.port.ts`, `ride-routes.ts`; экспорт — `index.ts`; провайдер — `RoutesCoreModule` | **не** расширение `RouteCatalog` (RC-2): тот документирован и покрыт отрицательными тестами «только platform», и его реализация кэширует |
| Запросы видимости по id | `RoutesRepository.inCatalogByIds`, `ownReadyByIds`, `findOwnReady` | `IN_CATALOG` и `ownRider` остаются единственной точкой условий видимости |
| `geo`, `startPrecise`, `routeId` | `RideDoc` (`rides.collection.ts`), единственный писатель — `RidesRepository` | |
| Расчёт точки и переноса | `rides.policy.ts` (`rideStartOf`, расширенный `changesStart`) | чистые функции с unit-тестом, как остальная политика |
| Сборка `route`/`start` в ответ | `rides-feed.service.ts` (`summaryOf` + `RouteLookup`) | ответы собираются здесь явным списком полей |
| Мультимаркерная карта | `apps/app/src/features/rides/ride-points-map.tsx` + `.web.tsx` + `ride-points-map-props.ts`, слои — `ride-points-style.ts` | потребитель один (приложение), поэтому не `@pokatim/route-view` и не новый пакет. Переиспользуются `RouteMapFrame`, `useMapStyle`, `loadMaplibre(-native)`, `MapOverlayControls`, `LocationLayer`/`createLocationStore`, `interactiveMapOptions`, `collapseAttribution`, `guardWheelZoom` |
| Пикер маршрута | `apps/app/src/app/rides/route-pick.tsx` → `features/rides/ride-route-pick.tsx`; передача выбора — `features/rides/route-choice-store.ts` (zustand, память, как `registration-store`) | паттерн экрана — `races/pick/[id]` |
| Блок маршрута на карточке | `features/rides/ride-route-block.tsx` | реюз `CatalogRouteMap`, `RouteLineMap` + `myRouteMapOptions`, `ElevationProfile`, `createScrubStore`, `useScrubScrollEnabled`, `StatBlock` |
| «Рядом» | `features/rides/use-near.ts` (на базе `useLocate`/`readCurrentPosition`), `features/rides/near.ts` (округление, км) | `haversineMeters` из `@pokatim/tracks` (зависимость приложения уже есть) |

**Запрещённые дубли:** вторая реализация условия каталога (только `IN_CATALOG` в `RoutesRepository`); свой
`readCurrentPosition`/разрешения (только `features/location/*`); своя рамка, загрузка maplibre или кнопки камеры
(только `features/maps/*`); своя формула расстояния (`haversineMeters`); `queryString` (уже в api-client); копия
`CatalogRouteMap`/`RouteLineMap` в rides; новые эндпоинты геометрии и профиля маршрута; кэш геометрии райдера в
`RoutesCatalogService`. Сегменты «Список / Карта» и «Каталог / Мои» — `SegmentedControl` базы, «Рядом» — `Chip`.
Новый общий компонент в app-foundation не нужен.

# 6. Relevant Files

**PR A — изменить:**
- `packages/contracts/src/geo/city.schema.ts` (+ `.test.ts`) — `CITY_CENTERS`.
- `packages/contracts/src/rides/ride.schema.ts` (+ `.test.ts`) — `RideRoute`, `route`/`start` в `RideSummary`,
  `routeId` в запросах и форме, `near`/`radiusKm`, `RideMapQuery`, `RideMap`.
- `packages/contracts/src/common.ts` (+ `common.test.ts` — порядок кодов) — `RIDE_ROUTE_UNAVAILABLE`.
- `packages/api-client/src/index.ts` (+ тест клиента, если есть на `listRides`) — `RideListParams.near/radiusKm`,
  `listRideMap`.
- `apps/api/src/modules/routes/{ride-routes.port.ts (new), ride-routes.ts (new), routes.repository.ts, routes.module.ts, index.ts}`.
- `apps/api/src/modules/rides/{rides.collection.ts, rides.repository.ts, rides.policy.ts, rides.service.ts, rides-feed.service.ts, rides.controller.ts, rides.module.ts, ride-erasure.ts}`.
- `apps/api/src/db/migrations/{0031_rides_geo.ts (new), index.ts, migrations.int.test.ts}`.
- `apps/api/test/rides.ts` — хелперы `rideBody({ routeId })`, `nearQuery`.
- `apps/api/src/error-messages.ts` — только если `RIDE_ROUTE_UNAVAILABLE` нужен текст (коды полей текст не несут —
  проверить).
- `infra/deploy/bootstrap.sh` — **только с «да» человека** (8.1 RC-6): формат access-лога nginx без query string.
- Документы — §10.

**PR A — прочитать:** `routes/route-catalog.ts` (LRU, `displayGeometryOf`), `routes/routes.collection.ts`
(`RouteDoc.start`, `publication`), `routes/my-routes.service.ts` (как отдаётся свой маршрут),
`routes/routes-public.service.ts`, `test/routes.ts` (`seedRiderRoute`, `seedApprovedRiderRoute`, `readyRoute`),
`rides/*.int.test.ts` (стенд), `account/account-erasure.service.ts` (порядок шагов), `page-cursor.ts`.

**PR B — изменить/создать:**
- `apps/app/src/features/rides/{queries.ts, filters.ts, format.ts, ride-form.tsx, ride-detail.tsx, ride-feed.tsx}`.
- новые: `features/rides/{ride-route-block.tsx, ride-route-pick.tsx, route-choice-store.ts, near.ts, use-near.ts,
  near-empty.tsx, ride-map-view.tsx, ride-points-map.tsx, ride-points-map.web.tsx, ride-points-map-props.ts,
  ride-points-style.ts}` + тесты; `src/app/rides/route-pick.tsx`.
- `apps/app/src/app/_layout.tsx` — `<Stack.Screen name="rides/route-pick" />` под гардом вошедших.
- `apps/app/src/app/(tabs)/rides.tsx` — состояние «Список/Карта» и позиции «Рядом».
- `apps/app/src/components/ride-list-row.tsx` — необязательная строка `distanceLabel`.
- `apps/app/app.json` — `locationWhenInUsePermission`.
- `packages/i18n/src/ru.ts` — строки.

**PR B — прочитать:** `features/maps/{route-map.tsx, route-map.web.tsx, route-map-frame.tsx, use-map-style.ts,
map-overlay-controls.tsx, use-locate.ts, location-layer.tsx, location-store.ts, location-style.ts}`,
`features/location/*`, `features/routes/{route-detail.tsx, catalog-route-map.tsx, route-line-map.tsx,
elevation-profile.tsx, use-scrub-scroll-lock*.ts, queries.ts, my-routes-queries.ts, my-route-format.ts}`,
`features/races/{race-pick.tsx, race-route-map.tsx}`, `app/(tabs)/routes.tsx` (`SegmentedControl`),
`features/auth/registration-store.ts` (паттерн стора-передачи), `components/route-list-card.tsx`.

# 7. Implementation Notes

## 7.1 Контракты (PR A)

```ts
// geo/city.schema.ts — WGS84 [lon, lat], приблизительные центры (ратуша/центральная площадь), 4 знака.
export const CITY_CENTERS: Readonly<Record<CityCode, readonly [number, number]>> = {
  minsk: [27.559, 53.9006],        brest: [23.7341, 52.0976],      vitebsk: [30.2049, 55.1904],
  gomel: [30.9754, 52.4345],       grodno: [23.8131, 53.6694],     mogilev: [30.3449, 53.9168],
  baranovichi: [26.0139, 53.1327], bobruisk: [29.2214, 53.1384],   borisov: [28.505, 54.2279],
  pinsk: [26.0951, 52.1229],       orsha: [30.4172, 54.5081],      mozyr: [29.2456, 52.0495],
  soligorsk: [27.5415, 52.7876],   novopolotsk: [28.6534, 55.5346], lida: [25.2997, 53.8833],
  molodechno: [26.85, 54.3167],    polotsk: [28.7856, 55.4879],    zhlobin: [30.024, 52.8926],
  svetlogorsk: [29.7389, 52.6329], rechitsa: [30.3916, 52.3617],   slutsk: [27.5597, 53.0274],
  zhodino: [28.3331, 54.0985],     kobrin: [24.3564, 52.2138],     slonim: [25.3163, 53.0869],
  volkovysk: [24.4513, 53.1561],
};
```
Тест: ключи = `CITY_CODES`, все точки внутри рамки Беларуси (lon 23–33, lat 51–56,5).

```ts
// common.ts — после CORRIDOR_FIELD_ERROR_CODES, и в defineFieldErrorCodes([... , ...RIDE_ROUTE_FIELD_ERROR_CODES])
export const RIDE_ROUTE_FIELD_ERROR_CODES = ['RIDE_ROUTE_UNAVAILABLE'] as const;

// ride.schema.ts
export const RIDE_NEAR_RADIUS_KM = { min: 5, max: 100, default: 25 } as const;
export const RIDE_MAP_MAX_POINTS = 200;
export const RIDE_ROUTE_ACCESS = ['public', 'private'] as const; // только в конец

/** id маршрута в запросе: uuid или null (снять); формат — `Uuid` базы. */
export const RideRouteId = Uuid.nullable();

// создание — routeId необязателен (старые сборки не шлют): default(null)
export const RideFields = z.strictObject({ ...RIDE_FIELD_SHAPE, routeId: RideRouteId.default(null) });
export const CreateRideRequest = RideFields.superRefine(paceOrder);
// правка — НЕ из RideFields: `.partial()` над полем с `.default(null)` в zod 4 подставит null и снимет маршрут
// у каждой правки старой сборки. Только optional без default:
export const UpdateRideRequest = z.strictObject(RIDE_FIELD_SHAPE).partial()
  .extend({ version: Version, routeId: RideRouteId.optional() }).superRefine(paceOrder);

// форма: routeId вне строк ввода
CreateRideForm … .extend({ routeId: RideRouteId })    // emptyForm → null

/** `near=<lat>,<lon>` → [lon, lat], округление до 0,01° на сервере (защита в глубину к округлению клиента). */
const NearPoint = z.string().regex(/^-?\d{1,2}(\.\d{1,6})?,-?\d{1,3}(\.\d{1,6})?$/, { error: 'INVALID' })
  .transform((v) => { const [lat, lon] = v.split(',').map(Number); return [round2(lon), round2(lat)] as const; })
  .pipe(LonLat);  // LonLat из races/race-route.schema.ts (диапазоны)
const RadiusKm = z.coerce.number().int().min(RIDE_NEAR_RADIUS_KM.min).max(RIDE_NEAR_RADIUS_KM.max);
const nearShape = { near: NearPoint.optional(), radiusKm: RadiusKm.optional() };
/** radiusKm без near — INVALID на `radiusKm`. near без radiusKm — 25 (сервер). */
const nearPair = (v: { near?: unknown; radiusKm?: unknown }, ctx) => { if (v.radiusKm !== undefined && v.near === undefined)
  ctx.addIssue({ code: 'custom', path: ['radiusKm'], message: 'INVALID' }); };

export const RideListQuery = z.strictObject({ ...существующие поля, ...nearShape }).superRefine(nearPair);
export const RideMapQuery = z.strictObject({ city: queryArray(CityCode, RIDE_CITY_FILTER_MAX).optional(), ...nearShape })
  .superRefine(nearPair);

/** Маршрут райда — только видимый зрителю сейчас; без геометрии. */
export const RideRoute = z.object({
  id: Uuid, title: z.string(), distanceM: z.number().int(), elevationGainM: z.number().int().nullable(),
  access: tolerantEnum(RIDE_ROUTE_ACCESS),
});
// RideSummary: + route: RideRoute.nullable().default(null), start: LonLat.nullable().default(null)

export const RideMapPoint = z.object({
  id: Uuid, title: z.string(), startsAt: z.iso.datetime(), start: LonLat,
  goingCount: z.number(), limit: z.number().nullable(), full: z.boolean(),
});
export const RideMap = z.object({
  items: z.array(RideMapPoint).max(RIDE_MAP_MAX_POINTS),
  /** видимые будущие опубликованные в том же фильтре, но без точки на карте (не в выдаче) */
  withoutStart: z.number().int().nonnegative().default(0),
});
```
Совместимость: новые поля ответа — `.default(null)`/`.default(0)`, так что новая сборка разберёт старый API.
Старая сборка поля пропускает (`z.object`, не strict). Старая сборка шлёт создание без `routeId` — `null`. Правку
без `routeId` маршрут не трогает (тест). `RideViewer`, `RideDetailForOrganizer` не меняются.

api-client: `RideListParams` + `near?: string` (клиент сам форматирует `"53.90,27.56"`), `radiusKm?: number`;
`listRideMap(accessToken, params: { city?, near?, radiusKm? })` → `GET /v1/rides/map${queryString(params)}`, схема
`RideMap`.

## 7.2 Порт routes для rides (PR A)

```ts
// routes/ride-routes.port.ts
export const RIDE_ROUTES = Symbol('RIDE_ROUTES');
export interface RideRouteRef {
  id: string; title: string; distanceM: number; elevationGainM: number | null;
  start: [number, number];
  access: 'public' | 'private';
}
export interface RideRoutes {
  /** Можно ли прикрепить: в каталоге (ready + IN_CATALOG) → public; иначе свой ready-маршрут райдера → private; иначе null. */
  attachable(routeId: string, organizerUserId: string): Promise<RideRouteRef | null>;
  /**
   * Видимые маршруты по id одним-двумя запросами, без кэша: в каталоге → public; иначе, если `ownerUserId` задан, —
   * его ready-маршрут → private. Остальные id в результат не попадают (нет, чужой, не готов, удалён).
   */
  visible(routeIds: readonly string[], ownerUserId: string | null): Promise<Map<string, RideRouteRef>>;
  /** Id маршрутов райдера (стирание аккаунта — сброс точек райдов). */
  ownedRouteIds(userId: string): Promise<string[]>;   // = RoutesRepository.ownIds
}
```
Реализация `RideRoutesService` (`routes/ride-routes.ts`, провайдер `RoutesCoreModule`, `{ provide: RIDE_ROUTES,
useExisting }`, экспорт из `index.ts`). Документ без `start`/`distanceM` (не должно быть у ready) — пропускается.

```ts
// RoutesRepository — проекция { title, distanceM, elevationGainM, start, origin }; ids ≤ 200 (вызывающий дедуплицирует)
inCatalogByIds(ids): find({ _id: { $in: ids }, status: 'ready', ...IN_CATALOG })
ownReadyByIds(ownerUserId, ids): find({ _id: { $in: ids }, status: 'ready', ...ownRider(ownerUserId) })
findOwnReady(ownerUserId, id): findOne({ _id: id, status: 'ready', ...ownRider(ownerUserId) })
```
`visible`: сначала `inCatalogByIds(ids)`. Остаток, если задан `ownerUserId`, — `ownReadyByIds`. Пустой `ids` — без запроса.

## 7.3 Rides (PR A)

`RideDoc` + `routeId: string | null`, `geo: { type: 'Point'; coordinates: [number, number] }`, `startPrecise: boolean`.
Документы до `0030` (и вставки старого API в окне деплоя) читаются так: `routeId ?? null`, `startPrecise ?? false`.
`VIEWER_FIELDS` получает все три поля (`satisfies` заставит). `PUBLIC_PROJECTION` — добавить `geo: 0, startPrecise: 0`
(наружу не нужны). `RidePatch` + `routeId`, `geo`, `startPrecise`.

Политика (`rides.policy.ts`):
```ts
export function rideStartOf(route: RideRouteRef | null, cityCode: CityCode):
  { geo: GeoPoint; startPrecise: boolean } // public → route.start/true, иначе CITY_CENTERS[cityCode]/false
export function changesStart(ride: Pick<RideDoc,'startsAt'|'cityCode'|'place'|'geo'|'startPrecise'>,
  patch: { startsAt?; cityCode?; place?; geo?; startPrecise? }): boolean
  // + (ride.startPrecise && patch.startPrecise === true && patch.geo && !samePoint(ride.geo, patch.geo))
```

`RidesService.create`: `body.routeId` не null → `attachable(routeId, userId)` до вставки. `null` →
`fieldFailure('routeId', 'RIDE_ROUTE_UNAVAILABLE')` (400, как остальные `fieldFailure`). Точка — `rideStartOf`.
`update`: после проверки `version`
- `body.routeId !== undefined && body.routeId !== current.routeId` → `attachable` (null-маршрут — без проверки) →
  `patch.routeId`;
- `nextRouteId = patch.routeId ?? current.routeId`; пересчёт точки, если изменились `routeId` или `cityCode`, или
  `nextRouteId && !current.startPrecise` (повышение, RC-3). Маршрут для пересчёта — тот же `attachable`
  (`nextRouteId`, `userId`). Не прикрепляем заново: `null` (маршрут удалён или чужой снят) — точка центра города,
  без ошибки. `patch.geo`/`patch.startPrecise` пишутся, только если отличаются от текущих.
- `reschedule = changesStart(current, patch)`.
Ответы мутаций — `rideViewOf(doc, userId, now, reported, routes)`, где `routes` — результат `visible([routeId],
userId)`.

`RidesFeedService`:
- `private lookup(docs, viewerUserId|null)` → `Map` одним вызовом `visible(uniqueRouteIds, viewerUserId)`.
- `routeOf(doc, map, viewerUserId)`: `ref = map.get(doc.routeId)`; `ref.access === 'private' && doc.organizerUserId
  !== viewerUserId` → `null`. `summaryOf` получает `route` (`{ id, title, distanceM, elevationGainM, access }`) и
  `start: route ? ref.start : null`.
- `get(id)` (публичная): `visible([routeId], null)`. В публичной проекции нет `organizerUserId`, поэтому `routeOf`
  с `viewer = null` и только `public`.
- `list`: `near` → `listFeed(..., near: { center, radiusKm } | null)`.
- `map(userId, query)`: `repository.listMapPoints(userId, now, city, near, RIDE_MAP_MAX_POINTS)` (фильтр:
  `startsAt > now`, `status: 'published'`, `startPrecise: true`, город, near; сорт `startsAt, _id`; проекция
  `title, startsAt, routeId, goingCount, limit, organizerUserId`) → `visible(ids, userId)` → точки только с видимым
  маршрутом (`start` — `ref.start`). `withoutStart = countDocuments(тот же фильтр без startPrecise) − items.length`,
  не меньше 0.
- Лимит частоты `rides-near:<uid>` 60/мин (`RateLimiter`, `RIDES_POLICY.nearLimit`) — только для `list` с `near` и
  для `map` (8.3 п. 4).

Репозиторий: `visible(userId, now, cities, near?)` + `{ geo: { $geoWithin: { $centerSphere: [near.center, near.radiusKm
/ EARTH_RADIUS_KM] } } }` (`EARTH_RADIUS_KM = 6378.1`). `resetStartsForRoutes(routeIds, now)`: для каждого `cityCode`
из `CITY_CODES` выполняется `updateMany({ routeId: { $in }, startPrecise: true, cityCode }, { $set: { geo: center,
startPrecise: false, updatedAt: now } })`. 25 операций; можно одной pipeline-операцией с `$switch` — на усмотрение
coder. `version` не меняется (не правка организатора).

Контроллер: `@Get('map')` в `RidesController` рядом с `cities` (`no-store`, `ZodValidationPipe(RideMapQuery)`).
Логи сервиса — без `near` (в `rides.*` логах только id и uid; новых логов не добавлять).

## 7.4 Миграция `0031_rides_geo` (PR A)

```ts
export const RIDES_GEO_INDEX = {
  key: { geo: '2dsphere', startsAt: 1 },
  options: { name: 'rides_geo_feed_idx' },
} as const;
/** Точка «Рядом» райдов до 05c: центр города, без маршрута. Expand-only, без транзакции, идемпотентна; после 0029. */
export const ridesGeo: MongoMigration = {
  id: '0031_rides_geo',
  async up(db) {
    const rides = db.collection(RIDES_COLLECTIONS.rides);
    for (const code of CITY_CODES) {
      await rides.updateMany(
        { cityCode: code, geo: { $exists: false } },
        { $set: { geo: { type: 'Point', coordinates: [...CITY_CENTERS[code]] }, startPrecise: false } },
      );
    }
    await rides.updateMany({ routeId: { $exists: false } }, { $set: { routeId: null } });
    await rides.createIndex(RIDES_GEO_INDEX.key, RIDES_GEO_INDEX.options);
  },
};
```
Сначала бэкфилл, потом индекс. На пустой коллекции работает. Номер берётся следующий свободный при слиянии;
тест «последняя» в `migrations.int.test.ts` переносится с `0029` на `0030`.

## 7.5 Приложение (PR B)

**Запросы (`features/rides/queries.ts`).**
- `useRideFeed(filters, near: NearQuery | null)`: `near = { seq: number; point: string; radiusKm }` хранится в
  состоянии вкладки. Ключ — `['rides','list',{ city, limit, near: near?.seq ?? null },'pages']`, без координат.
  `queryFn` берёт `near.point` из замыкания.
- `useRideMap(filters, near)`: ключ `['rides','map',{ city, near: seq|null }]`, `staleTime: FEED_STALE_MS`,
  `enabled` — только в режиме «Карта».
- `useRideRoutePick` не нужен: пикер использует `useRouteFeed(NO_FILTERS)` (каталог) и `useMyRoutes()` (мои).
- `applyRideView` — без изменений (`invalidateQueries(['rides'])` покрывает `map`).

**«Рядом» (`use-near.ts`, `near.ts`).** Нажатие на чип вызывает `useLocate` (одно foreground-чтение, синхронно из
обработчика — для web). При `ok` — `roundNear(lngLat)` до 0,01°, в состояние вкладки `{ seq: seq + 1, lngLat }`.
Повторное нажатие выключает «Рядом» и стирает позицию из состояния. `denied` — пустое состояние `NearEmpty` с
«Открыть настройки» (`openLocationSettings`, native и `canOpenSettings`) или «Разрешить» (повторное чтение), плюс
«Выбрать город» (выключить «Рядом» и прокрутить или раскрыть фильтр «Город»). `unavailable`/web без
`navigator.geolocation` — то же без «Открыть настройки». `distanceKm(from, to)` — `haversineMeters`, подпись «в N км
от вас» (< 1 — «меньше 1 км»), только для `start != null`.

**Пустое состояние без разрешения** — `EmptyState` базы с `action` («Разрешить» / «Открыть настройки»), вторая
кнопка — `TextAction` «Выбрать город». Фильтры и заголовок остаются (§4.12).

**Лента (`ride-feed.tsx`).** Над фильтром «Город» — `SegmentedControl<'list'|'map'>` («Список» / «Карта») и
`Chip` «Рядом» (selected). Режим и `near` поднимаются в `app/(tabs)/rides.tsx` (как `filters`). В режиме «Карта»
вместо `FlatList` — `RideMapView`: шапка и фильтры те же, ниже — `RidePointsMap` (fill), строка
«Ещё N райдов без точки старта — в списке» (`TextAction` → режим «Список»), при `items.length === 0` —
`EmptyState`.

**Мультимаркерная карта `RidePointsMap`** (props — `ride-points-map-props.ts`):
```ts
interface RidePointsMapProps {
  points: readonly RideMapPoint[];
  /** позиция «Рядом» (уже округлённая) — точка пользователя и центр камеры; null — камера по точкам */
  me: readonly [number, number] | null;
  styleUrl: string; theme: AppTheme; accessibilityLabel: string; failedMessage: string;
  onOpen: (rideId: string) => void;
}
```
- `ride-points-style.ts` (чистое, тест): `ridePointFeatures(points)` группирует точки с одинаковыми координатами
  (`key = lon.toFixed(5),lat.toFixed(5)`) в одну Feature `{ key, count, ids }` (стартов с популярного маршрута
  много). `ridePointLayers(theme)`: `circle` (заливка `theme.map.route`, обводка `theme.map.background`, радиус
  `size.iconSm / 2`) и `symbol` с `count > 1` (текст — число; если глифы стиля недоступны — без подписи, только
  размер круга по `count`; проверить на OpenFreeMap). `pointsBounds(points, me)` — через `boundsOf`
  (`@pokatim/tracks`). Одна точка и вырожденная рамка — расширить на ±0,05°. Нет точек — `CITY_CENTERS` выбранного
  города / Минска.
- Native (`ride-points-map.tsx`): как `RouteMap` — `loadMapLibreNative`, `lib.Map` с теми же жестами и атрибуцией,
  `lib.Camera initialViewState={{ bounds, padding }}`, `lib.GeoJSONSource id="ride-points" data onPress`.
  `onPress` → `features[0].properties.key`, выбор — в листовом состоянии. Сигнатуру `onPress` v11 проверить через
  context7; если её нет — `Map.onPress` + `queryRenderedFeatures`. `LocationLayer` + `createLocationStore` для `me`
  (`store.setState` при смене `me`). `MapOverlayControls` (zoom, «в рамку», «Моё местоположение»).
- Web (`ride-points-map.web.tsx`): как `route-map.web.tsx` — `loadMaplibre`, `setWorkerUrl`,
  `interactiveMapOptions({ bounds, padding })`, `AttributionControl` в `bottom-left`, `collapseAttribution`,
  `guardWheelZoom` не нужен (fill — колесо масштабирует, как у карточки маршрута). `on('load')` — `addSource` и
  слои. `on('click', 'ride-points', e => select(e.features[0].properties.key))`, курсор `pointer` на
  `mouseenter`/`mouseleave`. Точка пользователя — `LOCATION_SOURCE_ID` из `location-style.ts`.
- Выбор точки — **карточка под картой** (поверх нижнего края, `surface.raised`): 1…n строк `RideListRow` выбранной
  группы (нажатие — `onOpen(id)`) и «Закрыть». Это и есть «нажатие на точку — карточка райда», и путь для
  скринридера/клавиатуры: подпись карты — «На карте N райдов», а полный путь — режим «Список».
- В `accessibilityLabel` и логах нет координат.

**Блок маршрута на карточке (`ride-route-block.tsx`).** Вход — `ride.route`, `viewer`. Сразу под `SectionHero`
(шапка): `route.access === 'public'` → `useCatalogRoute(route.id, undefined, true)` → `CatalogRouteMap route={data}
scrub={data.elevation ? scrub : undefined}` (3:2, без `fill`), под ним `ElevationProfile elevation distanceM gainM
scrub`. `'private'` (только организатор) → `RouteLineMap mapQuery={myRouteMapOptions(id)}` без профиля (у `MyRoute`
профиля нет, новых эндпоинтов не делаем — RC-9) + `Banner` «Маршрут виден только вам — опубликуйте его…».
`scrub` — `useState(createScrubStore)` на экран. `ScrollView` карточки получает `scrollEnabled={useScrubScrollEnabled
(scrub)}` и `onScrollBeginDrag` гасит курсор (как `route-detail.tsx`). `StatBlock` + «Набор» `{ value:
elevationGainM, unit: 'м', label: 'Набор' }`, только если `route?.elevationGainM != null`. Строка-ссылка «Маршрут
райда» (`TextAction`) → `/routes/<id>` или `/routes/mine/<id>`. Карта не загрузилась или 404 — блок схлопывается
по правилам `RouteLineMap`. Цифры остаются.

**Пикер (`ride-route-pick.tsx`, `/rides/route-pick?form=new|<rideId>`).** `SafeAreaView` + `DetailHeader` «Маршрут»,
`SegmentedControl` «Каталог» / «Мои». Строка «Без маршрута» сверху (выбор `null`). Каталог —
`useRouteFeed(NO_FILTERS)`, строки `RouteListCard`, подгрузка у конца. Мои — `useMyRoutes()`, только `status ===
'ready'`, подпись `Pill` «Виден только вам», если `publication?.status !== 'approved'`. Пусто — `EmptyState`
(«Загрузите маршрут» → `/routes?view=mine`). Нажатие — `routeChoice.set({ form, route: { id, title, distanceM,
elevationGainM, access } | null })` и `router.back()` (без истории — `replace` на форму). Скелетоны —
`AsyncContent`.

**Форма (`ride-form.tsx`).** Поле «Маршрут» — строка-кнопка с названием или «Без маршрута» →
`router.push('/rides/route-pick?form=…')`. `useFocusEffect` забирает выбор из стора для своего `form` (`take`
очищает): `setValue('routeId')`, `setValue('distanceKm', String(Math.round(distanceM / 1000)))`, подсказка «Из
маршрута. Можно изменить.». Если км вне 5…300, поле валидирует схема и показывает обычную ошибку (RC-8). Ошибка
сервера `routeId`/`RIDE_ROUTE_UNAVAILABLE` → под полем «Маршрут» («Маршрут недоступен — выберите другой»). Правка:
`rideFormOf` → `routeId: ride.route?.id ?? null`, подпись — `ride.route.title` (`access: 'private'` — «Виден только
вам»). `SERVER_FIELDS` + `routeId`. `changedFields` сравнивает `routeId` как остальные поля.

**Строка iOS (`app.json`).** «Покатим показывает ваше местоположение на карте и ищет райды рядом, когда вы нажимаете
«Моё местоположение» или «Рядом». Для поиска на сервер уходят округлённые координаты, они не сохраняются.» (старая
строка «не отправляются» станет неправдой — RC-10).

# 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION A1]` Прикрепить можно публичный маршрут или **свой** в `ready` (в т.ч. на модерации) — участники
  увидят его карту только после одобрения; инвариант проверяется на чтении.
- `[ASSUMPTION A2]` Без маршрута точка райда — центр города (для «Рядом»), на карте ленты такие райды не рисуются.
- ~~`[ASSUMPTION A3]` Старт публичного маршрута остаётся после снятия маршрута с публикации.~~ Заменено 8.1 RC-1:
  `start` — только пока маршрут виден зрителю; свой непубличный маршрут точку не раскрывает.
- `[ASSUMPTION A4]` Смена маршрута меняет точку старта → считается переносом места (`rescheduledAt`), если шли другие
  (уточнено 8.1 RC-4: только смена точной точки на другую точную).
- `[ASSUMPTION A5]` Радиус «Рядом» — 25 км по умолчанию, без настройки в UI (API 5–100).
- `[ASSUMPTION A6]` Координаты пользователя уходят на сервер только в запросе «Рядом», округлённые до 0,01° (~1 км).
- Риск: публичная карточка кэшируется 60 с — снятый с публикации маршрут может быть виден в ней до минуты (как RC-13).
- Риск: нативная проверка (карта мультимаркеров, разрешение) — только вручную.

# 8.1 Requirements Consistency

Ниже — находки architect. Где spec противоречит коду, инвариантам или самому себе, план выбирает вариант и помечает
«решение плана». Остальное — уточнения.

- **RC-1 (HIGH, приватность) — A3 «точка остаётся после снятия маршрута» противоречит согласию автора.** Если
  организатор A прикрепил одобренный маршрут райдера B, а B отозвал публикацию (routes-06: «автор забрал согласие на
  показ линии»), модератор скрыл маршрут или B удалил аккаунт (ADR-0015), то старт маршрута B (часто у дома)
  оставался бы в карточке, ленте, публичном кэше и на карте у всех. Альтернативы:
  (a) **решение плана:** `start` отдаётся только как старт маршрута, видимого зрителю сейчас (та же проверка, что у
  `route`). Снимок точки наружу не уходит. При стирании аккаунта точки райдов на маршрутах удалённого сбрасываются
  на центр города.
  (b) A3 только для маршрутов команды (`platform`), для маршрутов райдеров — (a). Правило сложнее, а выигрыш —
  только райды на снятых маршрутах команды.
  (c) Подписка rides на события снятия маршрута с публикации (outbox) с синхронным сбросом `geo`. В routes нет
  событий снятия, скрытия и удаления — это новые события и worker-обработчик. Для этого слайса избыточно.
  **Фиксы ревью pass 1:** (a) распространено на фильтры — «Рядом» и карта ленты берут точку райда сейчас
  (`ridePointNow`): сохранённая точная — только пока маршрут в каталоге, иначе центр города; стирание аккаунта после
  шага `routes` сбрасывает точки на висячих маршрутах. Остаток риска — снятая точка хранится в БД до стирания аккаунта
  автора, но не участвует ни в ответах, ни в фильтрах (оракула ~1 км нет).
  Остаток риска (a): `geo` снятого, но не удалённого маршрута ещё фильтрует «Рядом». Перебором центров можно сузить
  точку примерно до 1 км (радиус ≥ 5 км, сервер округляет `near` до 0,01°, лимит `rides-near` 60/мин). Принято и
  записано в ADR-0014.
- **RC-2 — «`RouteCatalog` расширяется методом» конфликтует с правилом безопасности.** `pokatim-security.md`
  (routes-02/06): порты `RouteCatalog`/`RouteGeometry` и LRU-кэш читают только `origin: 'platform'`, и на это есть
  отрицательные int-тесты. **Решение плана:** отдельный порт `RIDE_ROUTES` (`RideRoutes`) в `RoutesCoreModule`, без
  кэша, условия — только `IN_CATALOG`/`ownRider` репозитория. `RouteCatalog` и `RoutesCatalogService` не меняются.
- **RC-3 — Свой маршрут прикреплён на модерации и потом одобрен: `geo` остаётся центром города.** Spec пересчитывает
  точку только при смене маршрута или города, поэтому райд не попал бы на карту и в точное «Рядом» до повторного
  прикрепления. Альтернативы: (a) **решение плана** — любая правка райда с прикреплённым маршрутом и `startPrecise =
  false` пересчитывает точку (порт, одно чтение). Перенос это не ставит. (b) Подписка на
  `routes.publication-decided` (approved) и `updateMany` в worker — правильнее для пользователя, но это новый
  обработчик outbox в rides; follow-up. (c) Ничего не делать. Остаток (a): без правки райда точка не появится. Карта
  и профиль маршрута участникам при этом видны сразу (проверка на чтении).
- **RC-4 — A4 «смена маршрута — перенос» уточнена.** Прикрепить маршрут к райду без маршрута — значит уточнить
  место встречи, а не перенести его. Если считать это переносом, участники получат push «время или место изменены»
  без реального переноса. **Решение плана:** перенос — только смена точной точки на другую точную (координаты
  отличаются), плюс прежние время, город и место. Снять маршрут — не перенос (текст места тот же).
- **RC-5 — «422 VALIDATION_FAILED» противоречит коду.** Во всём API `VALIDATION_FAILED` — **400**
  (`ZodValidationPipe` базы, `fieldFailure` в `rides.service.ts`, `page-cursor.ts`). Невалидный `near`/`radiusKm`
  отклонит pipe базы со статусом 400 — 422 без правки базы не получить. **Решение плана:** 400 везде. §3 и AC3/AC5
  поправлены.
- **RC-6 (MEDIUM) — координаты из query попадают в access-лог nginx dev-стенда.** API их не логирует: адаптер
  Fastify создаётся без `logger` (`createFastifyAdapter` базы), `ApiExceptionFilter` пишет только имя ошибки и
  кадры стека, URL не логирует никто в `apps/api/src`. Caddy (`infra/Caddyfile`) без `log` — access-лога нет. Но
  хостовый nginx dev (`infra/deploy/bootstrap.sh`) не задаёт `access_log`, поэтому действует формат `combined` с
  `$request` — путь **с query**. Альтернативы:
  (a) **рекомендация:** в `bootstrap.sh` задать `log_format pokatim_noargs '$remote_addr [$time_local] "$request_method
  $uri" $status $body_bytes_sent'` и `access_log … pokatim_noargs` для `location /v1/` — это правка инфраструктуры,
  **нужно «да» человека** (AGENTS §7);
  (b) перенести `near` в тело `POST /v1/rides/search` — без инфраструктуры, но ломает REST-форму ленты и курсор GET,
  и spec говорит о GET;
  (c) принять: координаты уже округлены до ~1 км, логи ротируются. Без (a) AC9 «логи API» выполнен только для
  процесса API.
  План: (c) в PR A, (a) — отдельный пункт pr.md на подтверждение человеком. В prod-Caddy access-лог не включать
  (строка в ADR-0014).
- **RC-7 — AC9 «не попадают в ключи TanStack Query с persist» слабее ADR-0014 п. 5** («не в TanStack Query» вообще).
  Persist в приложении нет. **Решение плана:** в ключе — счётчик нажатия «Рядом», координаты — в состоянии экрана и в
  замыкании `queryFn`. Данные ответа координат пользователя не содержат. ADR-0014 поправляется формулировкой:
  «координаты пользователя — в памяти экрана и в запросе ленты; не в ключах и данных кэша, не в persist».
- **RC-8 — Дистанция из маршрута может не пройти `RIDE_DISTANCE_KM` (5…300, целые км).** Маршрут каталога бывает
  < 5 км или > 300 км, `distanceM` — в метрах. Решение плана: подставлять `Math.round(distanceM / 1000)`; вне
  диапазона поле покажет обычную ошибку схемы. Диапазон не меняется. Альтернатива — не давать выбрать такой маршрут
  в пикере (скрыть строку) — отклонена: путаница «где мой маршрут».
- **RC-9 — «Профиль высоты» для своего непубличного маршрута.** Эндпоинта профиля для `/v1/routes/mine/:id` нет
  (`MyRoute` без `elevation`), а spec запрещает новые эндпоинты геометрии. Решение плана: организатору с `private` —
  карта и «Набор» без профиля. Участники видят профиль, когда маршрут публичный. Альтернатива — `elevation` в
  `MyRoute` (`.nullable().default(null)`) — отдельная задача routes.
- **RC-10 — Строка iOS «Координаты не сохраняются и не отправляются» станет неправдой.** «Рядом» отправляет
  округлённые координаты. Строку нужно переписать (§7.5). Нужна новая нативная сборка; пока её нет, старая строка
  остаётся в старых сборках — принятый риск, в pr.md.
- **RC-11 — Карта ленты: точки с одинаковым стартом.** Райды по одному популярному маршруту стартуют в одной точке
  — касание попадёт в несколько маркеров. Решение плана: группировка по координатам и карточка-список под картой
  (§7.5). Кластеризация MapLibre не нужна (≤ 200 точек).
- **RC-12 — Что такое «видимые зрителю» на карте.** Лента показывает и отменённые свои; на карте отменённые — шум.
  Решение плана: карта — только `published`, будущие. `withoutStart` считается в том же фильтре.
- **RC-13 — Кэш публичной карточки (60 с).** Карточка без зрителя: `route` и `start` в ней — только `public`, поэтому
  кэш не смешивает зрителей. Снятый маршрут виден в кэше до минуты (как RC-13 routes-01). Посев SSR (`useLoaderSeed`)
  получает то же. Отдельного решения не нужно; риск уже в §8.
- **RC-14 — ADR-0013 п. 4** («координаты, „рядом“ и карта — отдельным решением»). Эта задача — то решение, и
  поправку нужно сделать и в ADR-0013 (ссылкой на поправку ADR-0014), не только в ADR-0014.
- Конфликтов с инвариантами §4 после решений выше нет. Серверный авторитет соблюдён: точку, доступ к маршруту и
  перенос считает сервер. `distanceKm` — ввод организатора, не вычисляемый итог.

# 8.2 Deviations

- **Фиксы ревью pass 1 (RC-1, HIGH).** Сохранённая `geo` снятого маршрута фильтровала «Рядом» и карту (оракул ~1 км),
  стирание сбрасывало точки только на маршрутах, которые ещё существуют. Решение (направление модулей rides → routes
  только через порт): точка на чтении — `ridePointNow` (политика rides), общая для ленты и карты; кандидаты «Рядом» —
  `geo` в круге ИЛИ точная точка райда города, чей центр в круге (`citiesNear`), отбор — после чтения пачками
  (≤ 5), курсор — по последней строке страницы или последней прочитанной. Карта — только маршруты в каталоге
  (свой непубличный маршрут организатора — не точка), `withoutStart` с «Рядом» — по точке сейчас (порт `visible` для
  `distinct routeId`). Стирание — новый шаг `ride-starts` после `routes`: `RideErasure.resetDanglingStarts` (порт
  `RideRoutes.existing`, пачки по `_id`, повтор — no-op).
- **Фиксы ревью pass 2 (HIGH, оракул курсора).** Кандидат «Рядом» по сохранённой `geo` (`$geoWithin`) оставлял
  оракул: райд на снятом маршруте со старой точкой в круге читался и отбрасывался, и наличие или значение `nextCursor`
  после предела пачек выдавало, лежит ли старый старт в круге. Решение: кандидаты — только по публичным данным,
  `$or` [`cityCode` ∈ городов круга; `startPrecise: true` + `routeId` ∈ `RideRoutes.publicStartsWithin(center,
  radiusKm)` + `geo` в круге]. Новый метод порта — id маршрутов каталога (`ready`, `IN_CATALOG`) со стартом в круге,
  до 500 (`PUBLIC_STARTS_CAP`, принятое ограничение: сверх него райд виден по городу), индекс `routes_start_2dsphere`
  в той же `0031_rides_geo` (миграция ещё не выкатывалась). `ridePointNow` отдаёт координаты точной точки из старта
  маршрута сейчас, не из `geo`. Карта: точки — только `preciseNear`; `withoutStart` — `preciseNear` | город круга без
  точной точки на маршруте каталога (`cityPreciseRouteIds` + порт `visible`). Ветка города не требует
  `geo`/`startPrecise` — документ старого API (MEDIUM) находится по городу.
- **Карта (MEDIUM).** Предел 200 применялся до проверки видимости — теперь пачки по `(startsAt, _id)` до 200 видимых
  точек, не больше 5 пачек.

# 8.3 Security checklist

Зона: `apps/api/src/modules/{rides,routes}/**`, `apps/app/src/features/rides/**` (`pokatim-security.md`),
персональные данные (геопозиция).

1. **AuthN/AuthZ.** Лента, `map`, `me`, мутации — `AuthGuard`, пользователь только из `@CurrentUser()`. Прикрепить
   можно маршрут из каталога или **свой** (`ownRider(userId)` в фильтре репозитория). Чужой непубличный, нет, не
   готов — один `400 RIDE_ROUTE_UNAVAILABLE`, без оракула существования (int-тест — одинаковые тела). `access:
   'private'` отдаётся только организатору этого райда и только для его собственного маршрута (двойная проверка:
   `ownerUserId` в запросе и `organizerUserId === viewer` в сервисе).
2. **Входные данные.** `routeId` — `Uuid.nullable()`. `near` — regex и диапазоны `LonLat`, округление до 0,01° на
   сервере. `radiusKm` — целое 5…100, без `near` — 400. Запросы — `strictObject`, лишний ключ — 400. Батч
   `$in` ≤ 200 id.
3. **Данные наружу.** `RideRoute` — id, название, длина, набор, доступ; без `ownerUserId`, `origin`, `publication`,
   линии. `start` — только старт видимого зрителю маршрута. `geo`/`startPrecise` не выходят
   (`PUBLIC_PROJECTION`, явный список полей; int-тест на ключи ответа). Карта ленты — только точки с видимым
   маршрутом. Координаты пользователя в ответах не возвращаются.
4. **Злоупотребления.** `rides-near:<uid>` 60/мин на `list` с `near` и на `map` → `429 RATE_LIMITED`. Существующие
   `rides-create`/`rides-manage` покрывают прикрепление. Оракула точки снятого маршрута нет: фильтры «Рядом» и карты
   берут точку сейчас (8.1 RC-1, фиксы ревью pass 1).
5. **Секреты и логи.** Нет новых логов с `near`, названиями и координатами. Fastify-логгер выключен,
   `ApiExceptionFilter` URL не пишет (проверено). nginx dev — 8.1 RC-6. Клиент: координаты не попадают в
   `console.*`, ключи и данные Query, persist, URL экрана (параметр маршрута Expo Router не используется), подписи
   a11y.
6. **Аудит.** Действия райдера в журнал не пишутся (как в 05a). Модерация не меняется. Стирание — сброс точек в
   рамках `RideErasure` (повторяемо).

# 9. Acceptance Criteria

1. Создание/правка с `routeId` публичного маршрута → в ответе `route.access = 'public'`, `start` = старт маршрута.
2. Свой маршрут на модерации → организатору `access: 'private'`; другому райдеру, гостю (публичная карточка) и в ленте —
   `route: null`, `start: null`.
3. Чужой непубличный, несуществующий, `processing`/`failed` маршрут → 400 `routeId` (8.1 RC-5), одинаковый ответ.
4. Маршрут снят с публикации/скрыт/удалён после прикрепления → другим `route: null` без ошибок; организатору —
   `private` (свой) или `null` (удалён/чужой).
5. `GET /v1/rides?near=53.90,27.56&radiusKm=25` — райды в радиусе (точные и по центру города), вне — нет; сортировка
   по времени, курсор работает; невалидные `near`/`radiusKm` → 400 (8.1 RC-5).
6. `GET /v1/rides/map` — только точные точки, только видимые зрителю будущие; лимит 200.
7. Миграция идемпотентна, бэкфилл старых райдов, индекс 2dsphere создан; повторный `up` — без изменений.
8. Приложение: пикер маршрута, карта + профиль со скраббингом на карточке, баннер организатору, «Список/Карта»,
   «Рядом», пустое состояние без разрешения с выбором города; все 7 тем — на токенах.
9. Координаты пользователя не попадают в TanStack Query ключи с persist, `console.*`, логи API.
10. `pnpm check` зелёный; CI зелёный; на dev проверено на синтетических аккаунтах.

# 10. Documentation Impact

- **ADR-0014** — поправка «2026-10-28 (05c): райды рядом и карта ленты». Координаты уходят только в запрос ленты и
  карты, по нажатию «Рядом», округлённые до 0,01° (клиент и сервер). Не хранятся и не логируются; в кэше Query —
  счётчик, не координаты. Access-лог прокси без query (RC-6). Старт маршрута в райде — только пока маршрут виден
  (RC-1). Остаток риска — оракул ~1 км.
- **ADR-0013** — п. 4 «отдельным решением» → ссылка на поправку ADR-0014 05c (RC-14).
- `docs/product/rides.md` — таблица «Скрыто и до каких блоков»: строки «Рядом/карта» и «Маршрут райда, Набор,
  дистанция из маршрута» перенести в «сделано» (кроме фото). Плюс правила A1, A2, RC-1, RC-3, RC-4, A5, RC-12 и
  пустое состояние без геопозиции.
- `docs/product/routes.md` — «Маршрут в райде»: какие маршруты можно прикрепить, кто видит карту, «Виден только
  вам», баннер опубликовать.
- `.claude/rules/pokatim-backend.md` (rides) — `GET /v1/rides/map`, `near`, `rides-near`, порт `RIDE_ROUTES`,
  `RidesCoreModule → RoutesCoreModule`. В routes — порт `RideRoutes` (без кэша, `IN_CATALOG`/`ownRider`).
- `.claude/rules/pokatim-db.md` (rides) — `routeId`, `geo`, `startPrecise`, `rides_geo_feed_idx`, `0031_rides_geo`,
  пересчёт точки, сброс при стирании.
- `.claude/rules/pokatim-contracts.md` (rides) — `RideRoute`, `RideMap`, `RideMapQuery`, `near`/`radiusKm`,
  `RIDE_ROUTE_ACCESS`, `CITY_CENTERS`, `RIDE_ROUTE_UNAVAILABLE`, `routeId` в правке без default.
- `.claude/rules/pokatim-security.md` (rides и «Маршруты райдера») — `start` только видимого маршрута, порт
  `RideRoutes` в перечне точек «не кэшировать маршрут райдера», `rides-near`.
- `.claude/rules/pokatim-app.md` (rides) — «Рядом», ключ-счётчик, карта ленты, пикер, блок маршрута.
- `docs/runbooks/deploy.md` — если человек одобрит RC-6 (a): формат access-лога.
- `pr.md` PR A — миграция `0031_rides_geo` (expand-only, бэкфилл, индекс); env нет. PR B — новая нативная сборка
  (строка iOS).

# 11. Implementation Context

```
ENTRY POINTS   PR A: packages/contracts/src/rides/ride.schema.ts → apps/api/src/modules/routes/ride-routes.ts →
               apps/api/src/modules/rides/rides.service.ts / rides-feed.service.ts / rides.controller.ts →
               apps/api/src/db/migrations/0031_rides_geo.ts
               PR B: apps/app/src/app/(tabs)/rides.tsx, src/app/rides/route-pick.tsx, features/rides/ride-detail.tsx,
               features/rides/ride-form.tsx
FILES TO MODIFY  §6
FILES TO READ    §6
TYPES & SCHEMAS  §7.1 (RideRoute, RideMap*, near/radiusKm, routeId, CITY_CENTERS, RIDE_ROUTE_UNAVAILABLE), §7.2 (RideRoutes)
OUT OF SCOPE     §4 + новые эндпоинты геометрии/профиля; elevation в MyRoute (RC-9); outbox-подписка на одобрение (RC-3 b);
                 правка infra без «да» человека (RC-6 a); сортировка по расстоянию; кластеризация MapLibre.
```

## 11.1 Шаги PR A (контракты + API + миграция + api-client + docs)

1. Контракты: `CITY_CENTERS` + тест; `RIDE_ROUTE_FIELD_ERROR_CODES` + порядок в `common.test.ts`; `RideRoute`,
   `route`/`start` в `RideSummary`, `routeId` в `RideFields`/`UpdateRideRequest`/`CreateRideForm`, `near`/`radiusKm`
   в `RideListQuery`, `RideMapQuery`, `RideMapPoint`, `RideMap`. Экспорт из `index.ts`.
2. api-client: `RideListParams.near/radiusKm`, `listRideMap`.
3. routes: `RoutesRepository.inCatalogByIds/ownReadyByIds/findOwnReady`; `ride-routes.port.ts`, `ride-routes.ts`
   (`RideRoutesService`); провайдер и экспорт в `RoutesCoreModule`; экспорт в `index.ts`.
4. rides: `RideDoc`, `VIEWER_FIELDS`, `PUBLIC_PROJECTION`, `RidePatch`; `rideStartOf`, `changesStart`,
   `RIDES_POLICY.nearLimit`; `RidesCoreModule`: `imports` и `exports` + `RoutesCoreModule`.
5. `RidesService.create/update` — проверка `routeId`, точка, перенос (§7.3). `rideViewOf` принимает `RouteLookup`.
6. `RidesFeedService.list/get/me/map` + батч-поиск маршрутов; `RidesRepository.listFeed(near)`, `listMapPoints`,
   `countMap`, `resetStartsForRoutes`; `@Get('map')`.
7. `RideErasure`: `ownedRouteIds(userId)` → `resetStartsForRoutes`; результат + `restarted`.
   Проверить потребителя `RideErasureResult` в `account`.
8. Миграция `0031_rides_geo` + `index.ts` + `migrations.int.test.ts`.
9. Документы §10 (кроме `pokatim-app.md` — в PR B), ADR-поправки, `pr.md` (миграция, RC-6 на подтверждение).
10. `pnpm check`.

## 11.2 Шаги PR B (приложение)

1. i18n-строки (форма, пикер, карточка, баннер, лента, «Рядом», пустое состояние, карта, «в N км», ошибка
   `RIDE_ROUTE_UNAVAILABLE`).
2. `near.ts` (+ тест) и `use-near.ts`; `queries.ts`: `useRideFeed(filters, near)`, `useRideMap`.
3. `route-choice-store.ts` (+ тест); `ride-route-pick.tsx` + `src/app/rides/route-pick.tsx` + `_layout.tsx`.
4. `ride-form.tsx`: поле «Маршрут», подстановка дистанции, ошибка сервера.
5. `ride-route-block.tsx` + `ride-detail.tsx` (шапка, «Набор», ссылка, баннер, скраббинг и прокрутка).
6. `ride-points-style.ts` (+ тест); `ride-points-map.tsx` / `.web.tsx` / `-props.ts`; `ride-map-view.tsx`.
7. `ride-feed.tsx` + `(tabs)/rides.tsx`: «Список/Карта», «Рядом», `NearEmpty`, «в N км» в `RideListRow`/`RideHero`.
8. `app.json` — строка iOS. `pokatim-app.md`. `pnpm check`. Ручная проверка native (карта, разрешение) — в pr.md
   как NOT VERIFIED в CI.

## 11.3 Тест-матрица

**Unit — contracts** (`ride.schema.test.ts`, `city.schema.test.ts`, `common.test.ts`):
- `CITY_CENTERS` покрывает все `CITY_CODES`, точки внутри рамки РБ.
- `CreateRideRequest` без `routeId` → `routeId: null`; с невалидным uuid → `INVALID`. **`UpdateRideRequest` без
  `routeId` → `undefined` в выходе** (защита от снятия маршрута старыми сборками); `routeId: null` → `null`.
- `RideListQuery`: `near=53.9,27.56` → `[27.56, 53.9]`; `near=53.9049,27.5612` → округление до 0,01;
  `near=91,0`, `near=abc`, `near=53.9` → `INVALID`; `radiusKm` 4/101/2.5 → ошибка; `radiusKm` без `near` → ошибка на
  `radiusKm`; лишний ключ → ошибка.
- Ответ: старый `RideCard` без `route`/`start` → `null`; `access: 'shared'` → `'unknown'`; `RideMap` без
  `withoutStart` → 0; `items` > 200 → ошибка.
- Порядок `FieldErrorCode`: `RIDE_ROUTE_UNAVAILABLE` — последний.

**Unit — API** (`rides.policy.test.ts`):
- `rideStartOf`: public → старт/true; private → центр города/false; null → центр/false.
- `changesStart`: точная → другая точная = true; та же точка = false; без точки → точная = false; точная → без
  маршрута = false; прежние кейсы (время, город, место) — без изменений.

**Интеграционные (реальная MongoDB, `*.int.test.ts`)** — новый `rides-route.int.test.ts` + дополнения:
- AC1: create с маршрутом команды из каталога → `route.access = 'public'`, `start = route.start`; в БД `geo` = старт,
  `startPrecise = true`. Одобренный маршрут райдера — так же.
- AC2: свой маршрут на модерации (`pending`) → организатору в `me` и в ответе мутации `access: 'private'`,
  `start` = старт. Другому райдеру в `me` и ленте, гостю в `GET /v1/rides/:id` — `route: null`, `start: null`. В БД
  `geo` = центр города, `startPrecise: false`.
- AC3: чужой непубличный, несуществующий, `processing`, `failed`, маршрут команды не в каталоге → 400, `fields:
  [{ path: 'routeId', code: 'RIDE_ROUTE_UNAVAILABLE' }]`, тела **побайтно равны**.
- AC4: после прикрепления — отзыв публикации, скрытие модератором, удаление автором → другим `route: null`, `start:
  null`, 200. Организатору (свой маршрут) — `private`. Чужой маршрут организатора удалён или снят → `null`.
- RC-3: свой `pending` прикреплён → одобрен (`seedApprovedRiderRoute`/прямое обновление) → правка названия райда →
  `startPrecise: true`, `rescheduledAt` не поставлен, события `ride-rescheduled` нет.
- RC-4/A4: при двух участниках смена маршрута на другой с иным стартом → `rescheduledAt`, одно событие outbox;
  прикрепление к райду без маршрута → без переноса.
- Правка без `routeId` маршрут не снимает; `routeId: null` снимает → `geo` = центр, `start: null`.
- Смена города без маршрута → `geo` = новый центр. С точным маршрутом → `geo` не меняется.
- AC5: райды в Минске (точный старт около центра и без маршрута), в Бресте и точный старт за 40 км от Минска;
  `?near=53.90,27.56&radiusKm=25` → только минские, по времени; курсор (limit 1, две страницы) без дублей и
  пропусков; `near` + `city` — И. Невалидные `near`/`radiusKm` → 400. Ответ не содержит `geo`/`startPrecise`.
- AC6: `GET /v1/rides/map` — только `startPrecise` с видимым маршрутом, только будущие `published` (отменённый
  свой, прошедший, скрытый — нет); снятый маршрут — точки нет, `withoutStart` его считает; 201 райд с точкой →
  200 в выдаче; `no-store`; без входа — 401; путь `map` не уходит в pipe `Uuid` публичного `:id`.
- Лимит `rides-near`: 61-й запрос с `near` → 429 + `Retry-After`; без `near` — не считается.
- Публичная карточка: ключи ответа — явный список (+ `route`, `start`), без `geo`, `startPrecise`, `routeId` вне
  `route`.
- `RideErasure`: райд другого организатора на маршруте удаляемого → `startPrecise: false`, `geo` = центр; повторный
  `erase` — без изменений.
- Порт `RideRoutes` (`routes`): `visible` не отдаёт маршрут райдера без `approved` без `ownerUserId` (защита в
  глубину: подставленный `catalog` без `approved` — нет); `attachable` чужого `pending` — `null`; кэша нет (снятие
  видно следующим вызовом).
- Отрицательный тест N3 routes: `RoutesCatalogService`/`ROUTE_CATALOG` по-прежнему не отдаёт маршрут райдера
  (существующие тесты остаются зелёными).
- Миграция (AC7): в `migrations.int.test.ts` документ райда до 0030 (`cityCode: 'brest'`, без полей) → `geo` = центр
  Бреста, `startPrecise: false`, `routeId: null`. Индекс `rides_geo_feed_idx` с ключом `{ geo: '2dsphere',
  startsAt: 1 }`. Повторный `up` не меняет документы и индексы. `0030` — последняя, сразу после `0029`.

**Приложение (jest, `*.test.ts(x)` / `*.web.test.tsx`):**
- `near.test.ts`: округление до 0,01; `distanceLabel` (< 1 км, 12 км); `null` старт — без подписи.
- `ride-points-style.test.ts`: группировка одинаковых координат, `count`, слои только на токенах темы, рамка одной
  точки расширена, пустой вход → центр города.
- `route-choice-store.test.ts`: `take` по `form` возвращает выбор один раз; чужой `form` — нет.
- `ride-form` (тест экрана): выбор маршрута подставляет дистанцию и подсказку; `RIDE_ROUTE_UNAVAILABLE` под полем;
  правка с `private` — «Виден только вам».
- `ride-route-pick` (тест экрана): «Без маршрута», вкладки, только `ready` в «Мои», пометка непубличного, пусто.
- `ride-detail` (тест экрана): `route: null` — блока нет; `public` — карта (мок `RouteLineMap`) + профиль + «Набор»
  + ссылка `/routes/<id>`; `private` — баннер и ссылка `/routes/mine/<id>`, без профиля.
- `ride-feed`/вкладка: «Рядом» → `readCurrentPosition` мок `ok` → `listRides` вызван с `near: '53.90,27.56'`,
  `radiusKm: 25`; **ключи всех запросов в `queryClient.getQueryCache()` не содержат координат** (AC9);
  `denied` с `canOpenSettings` → «Открыть настройки»; `unavailable` → «Разрешить» + «Выбрать город»; повторное
  нажатие выключает. «в N км» в строке при `start`.
- `ride-points-map.web.test.tsx` (мок `loadMaplibre`, как `route-map.web.test.tsx`): источник и слои добавлены,
  клик по слою выбирает группу → карточка со строками → `onOpen(id)`; `me` — источник точки пользователя.
- `ride-points-map` native (мок `loadMapLibreNative`, как `route-map-*.test.tsx`): `GeoJSONSource` с данными,
  `onPress` → карточка.
- `console.*` не вызывается с координатами (шпион в тесте «Рядом»).

**e2e:** web-смоук Playwright не обязателен (карта в CI — заглушка стиля). Ручная проверка native/web на dev — AC10.

# 12. Outcome (coder, PR A)

**Сделано (PR A — контракты, API, миграция, api-client, docs):**
- Контракты: `CITY_CENTERS` (`geo/city.schema.ts`); `RIDE_ROUTE_FIELD_ERROR_CODES` (`RIDE_ROUTE_UNAVAILABLE` — последний
  `FieldErrorCode`); `RideRouteId`, `routeId` в `RideFields` (`.default(null)`), `UpdateRideRequest` (только
  `.optional()`), `CreateRideForm`; `RIDE_NEAR_RADIUS_KM`, `RIDE_MAP_MAX_POINTS`, `RIDE_ROUTE_ACCESS`; `near`/`radiusKm` в
  `RideListQuery` и `RideMapQuery`; `RideRoute`, `route`/`start` в `RideSummary`; `RideMapPoint`, `RideMap`.
- api-client: `RideListParams.near/radiusKm`, `RideMapParams`, `listRideMap`.
- routes: порт `RIDE_ROUTES` (`ride-routes.port.ts`), `RideRoutesService` (`ride-routes.ts`, без кэша) в
  `RoutesCoreModule`, экспорт из `index.ts`; `RoutesRepository.inCatalogByIds/ownReadyByIds/findOwnReady` (проекция
  без линии; условия — `IN_CATALOG`/`ownRider`). `RouteCatalog`/`RoutesCatalogService` не тронуты.
- rides: `RideDoc.routeId/geo/startPrecise`; `VIEWER_FIELDS`, `PUBLIC_PROJECTION` (`geo: 0, startPrecise: 0`),
  `RidePatch`; политика `rideStartOf`, `changesStart` (+ точная → другая точная), `RIDES_POLICY.nearLimit`;
  `RidesService.create/update` (`attachable`, пересчёт точки с RC-3, перенос RC-4); `RidesFeedService` — `lookupRoutes` +
  `routeOf` на каждом чтении (лента, `me`, публичная карточка, ответы мутаций и жалобы), `map`; лимит
  `rides-near:<uid>`; `RidesRepository` — `near` в ленте (`$geoWithin $centerSphere`), `listMapPoints`, `countMap`,
  `resetStartsForRoutes` (одна pipeline-операция с `$switch`); `@Get('map')`; `RidesCoreModule` импортирует и
  реэкспортирует `RoutesCoreModule`; `RideErasure` → `restarted` (лог шага `account` дополнен).
- Миграция `0031_rides_geo` (бэкфилл → индекс `rides_geo_feed_idx`), `migrations/index.ts`.
- Документы: поправка ADR-0014 «2026-10-28 (05c)», ADR-0013 п. 4 — ссылка; `docs/product/rides.md` (раздел «Маршрут
  райда и «Рядом» (05c)», таблица «Скрыто»), `docs/product/routes.md` («Маршрут в райде»); правила
  `pokatim-backend/db/contracts/security.md`.
- apps/app — только компиляция (контракт): `routeId` в `emptyForm`/`rideFormOf`/`requestOfRide` (`ride.route?.id ??
  null` — поведение формы не меняется), `RideRouteFieldErrorCode` исключён из `FIELD_MESSAGES` auth; фикстуры тестов
  + `route: null, start: null`; ожидание тела `createRide` + `routeId: null`.

**Тесты:** contracts — `city.schema.test.ts` (центры), `common.test.ts` (порядок кодов), `ride.schema.test.ts`
(routeId создания/правки/формы, `near`/`radiusKm`, `RideMapQuery`, ответы без `route`/`start`, `access` →
`unknown`, `RideMap`); `results.schema.test.ts` — последние два кода. api-client — `listRides` с `near`,
`listRideMap`. API unit — `rides.policy.test.ts` (`changesStart` RC-4, `rideStartOf`, `nearLimit`). Int (реальная
MongoDB) — новый `rides-route.int.test.ts` (20 тестов: AC1–AC6, RC-3, RC-4/A4, правка без `routeId`, смена города,
лимит `rides-near`, ключи публичной карточки, стирание, порт `RideRoutes` без кэша и защита в глубину);
`migrations.int.test.ts` — `0031_rides_geo` (бэкфилл, индекс, идемпотентность, последняя).

**Отрицательные доказательства (мутации, тест краснеет по результату):** убрать проверку «`private` — только
организатору» в `routeOf` → 1 красный (AC4: автор маршрута видел бы `private` в чужом райде); убрать `$geoWithin` из
ленты → 1 красный (AC5); убрать «повышение» точки RC-3 → 1 красный. Код восстановлен.

**Отклонения (8.2):**
- `rideViewOf(doc, userId, now, routes, reported = false)` — `routes` перед необязательным `reported` (в §7.3 — после).
- `NearPoint`: диапазоны проверяются `refine` перед `.pipe(LonLat)` — код `INVALID` под `near`, а не под `near.1`.
- `RideRouteId = Uuid.nullable()` (база): невалидный uuid даёт сообщение базы, не `INVALID` (как `corridor.routeId`).
- Карта ленты списывает `rides-near` всегда (и без `near`) — §7.3 «для `map`».
- `pr.md` не создан — шаг FINISH оркестратора (миграция expand-only; RC-6 (a) — правка `bootstrap.sh` на «да» человека).
- Тестовый Redis: db 13 из задания одновременно использовали другие агенты (их vitest с `REDIS_URL_TEST=…/13`) — лимиты
  частоты флакали; прогон — на свободной db 6.

**Проверки:** `TURBO_CONCURRENCY=1 pnpm check` (Mongo `pokatim_rides05c_test`, Redis db 6) → `Tasks: 15 successful, 15
total`; api — 131 файлов тестов, app — 1582/1582. Первый прогон упал одним таймаутом 5 с в
`features/auth/verification-states.test.tsx` (не связан с задачей, под нагрузкой машины); отдельно и `turbo --force`
для app — зелёный.

## 12.1 Fixes pass 1 (ревью PR A)

- **RC-1 / HIGH:** `rides.policy` — `EARTH_RADIUS_KM`, `distanceKm`, `citiesNear`, `ridePointNow`;
  `RidesRepository` — `NearFilter.cities`, кандидаты «Рядом» `$or` (geo в круге | точная точка города в круге),
  `listMapPoints(after)`, `mapPreciseRouteIds`, `countMap(publicRouteIds)`, `precisePage`; `RidesFeedService.list` —
  отбор после чтения пачками; `map` — пачки до 200 точек, только маршруты в каталоге; порт `RideRoutes.existing` +
  `RoutesRepository.existingIds`; `RideErasure.resetDanglingStarts`, шаг `ride-starts` в `AccountErasureService` после
  `routes`.
- **MEDIUM:** карта — предел после видимости; `docs/product/rides.md`, `routes.md` — «API — PR A, интерфейс — PR B»;
  ADR-0014 05c п. 4 и 8.1 RC-1 — остаток риска после фикса.
- **Тесты:** unit `rides.policy.test.ts` (+3: `distanceKm`, `citiesNear`, `ridePointNow`); int
  `rides-route.int.test.ts` (+5: отозван/удалён — «Рядом» и карта по центру города до стирания; свой маршрут скрыт —
  не точка; курсор при отброшенных строках; предел пачек — пустая страница с курсором; карта — недоступные маршруты
  раньше доступных); `account-erasure.int.test.ts` (+1: маршрут удалён автором до стирания → точка чужого райда —
  центр города, повтор — no-op; лог шага `ride-starts`).
- **Проверки:** red → green по каждому новому тесту (9 красных до правки); `TURBO_CONCURRENCY=1 pnpm check` (Mongo
  `pokatim_rides05c_test`, Redis db 6) → `Tasks: 15 successful, 15 total`; api — 131 файл, 1453 теста.

## 12.2 Fixes pass 2 (ревью PR A)

- **HIGH (оракул курсора):** порт `RideRoutes.publicStartsWithin` + `RoutesRepository.inCatalogStartsWithin`
  (`PUBLIC_STARTS_CAP = 500`); `0031_rides_geo` — индекс `routes_start_2dsphere`; `NearFilter.publicRouteIds`;
  `RidesRepository` — `preciseNear`, `nearCondition` = город круга | `preciseNear`, `listMapPoints` с «Рядом» —
  `preciseNear`, `cityPreciseRouteIds` (вместо `mapPreciseRouteIds`), `countMap(cityPublicRouteIds)`;
  `ridePointNow` — координаты точной точки = старт маршрута порта; `RidesFeedService.nearOf` — асинхронный (порт).
- **MEDIUM (документ старой формы):** ветка города без условий на `geo`/`startPrecise`/`routeId`.
- **Docs:** ADR-0014 05c п. 4 (оракул закрыт, предел 500), `pokatim-db.md`, `pokatim-backend.md`, 8.2.
- **Тесты:** unit `rides.policy.test.ts` (точная точка — старт маршрута сейчас); int `rides-route.int.test.ts` (+3:
  два набора, различающиеся только `geo` райдов на снятом маршруте, — побайтно одинаковые ответы полного обхода
  `limit=1` через предел пачек, `limit=20` и карты; документ старой формы — в «Рядом» по городу и в `withoutStart`;
  порт `publicStartsWithin`; тест «предел пачек» переписан на публичный старт вне круга — снятый маршрут больше не
  кандидат); `migrations.int.test.ts` — индекс `routes_start_2dsphere`, идемпотентность.
- **Проверки:** red → green (3 новых int и 1 unit красные до правки); `TURBO_CONCURRENCY=1 pnpm check` (Mongo
  `pokatim_rides05c_p2_test`, Redis db 11: `pokatim_rides05c_test` одновременно использовал другой прогон — флаки
  «no user»/«no active verification token») → `Tasks: 15 successful, 15 total`; api — 136 файлов, 1496 тестов. Первый
  прогон упал гонкой `account-deletion.int.test.ts` N6 (`[204, 401]` против 403, под нагрузкой; не связан, отдельно
  3/3 зелёный).

# 12. Outcome (coder, PR B — приложение)

**Сделано (apps/app, i18n, правило app):**
- i18n: строки формы («Маршрут», «Без маршрута», «Из маршрута. Можно изменить.»), пикера, блока маршрута («Набор»,
  «Маршрут райда», баннер «Маршрут виден только вам — опубликуйте его…»), ленты («Список / Карта», «Рядом», «в N км
  от вас»), пустого состояния без геопозиции, карты («На карте N райдов», «Ещё N райдов без точки старта — в списке»),
  `field.error.RIDE_ROUTE_UNAVAILABLE`.
- «Рядом»: `near.ts` (округление 0,01°, параметр `"lat,lon"`, `distanceLabel` через `haversineMeters`), `use-near.ts`
  (одно чтение через `useLocate`, позиция — только состояние вкладки, `seq` — в ключе), `near-empty.tsx`
  («Открыть настройки» / «Разрешить» + «Выбрать город»). `queries.ts`: `useRideFeed(filters, near)` — ключ
  `['rides','list',{ city, limit, near: seq|null },'pages']`, `useRideMap(filters, near, enabled)` — ключ
  `['rides','map',{ city, near: seq|null }]`; координаты — только в замыкании `queryFn`.
- Пикер: `route-choice-store.ts`, `ride-route-pick.tsx` + `app/rides/route-pick.tsx` (+ `_layout` внутри
  `Stack.Protected`, `app-routes`, шаг смоука `e2e/web.spec.ts`): «Каталог / Мои», «Без маршрута», в «Моих» только
  `ready`, не в каталоге — «Виден только вам»; пусто — «Загрузите маршрут» → `/routes?view=mine`.
- Форма: поле «Маршрут» (строка-кнопка, «Виден только вам» для `private`), выбор — `useFocusEffect` + `take(form)`,
  дистанция `Math.round(distanceM / 1000)` с подсказкой, `RIDE_ROUTE_UNAVAILABLE` под полем; `routeId` в
  `SERVER_FIELDS`; правка без смены маршрута `routeId` не шлёт (`changedFields`).
- Карточка: `ride-route-block.tsx` под шапкой — `public`: `RouteLineMap` каталога (3:2) с маркером + `ElevationProfile`
  (общий `createScrubStore` экрана, `useScrubScrollEnabled` + сброс курсора на прокрутке); `private`: карта «Моего
  маршрута» без профиля + баннер; ссылка «Маршрут райда» → `/routes/<id>` | `/routes/mine/<id>`; «Набор» в `StatBlock`.
- Лента: «Список / Карта» (`SegmentedControl`) и чип «Рядом» над «Городом» (`(tabs)/rides.tsx` держит режим и
  `useNear`); «в N км от вас» в `RideListRow` (`distance`) и `RideHero`; отказ — `NearEmpty` вместо выдачи; «Сбросить
  фильтры» выключает и «Рядом». Карта: `ride-map-view.tsx` → `ride-points-map.tsx` (native, `GeoJSONSource onPress`,
  `nativeEvent.features` — сигнатура v11.5 проверена по типам пакета) / `ride-points-map.web.tsx` (`on('click', layer)`,
  курсор), `ride-points-style.ts` (группы одинакового старта, круг + число на ролях `theme.map.*`, шрифт глифов
  OpenFreeMap `Noto Sans Regular` — проверен запросом `fonts/Noto Sans Regular/0-255.pbf` → 200), `ride-point-card.tsx`.
- `app.json` — строка iOS `locationWhenInUsePermission` (RC-10, нужна новая нативная сборка). `pokatim-app.md` —
  раздел 05c.

**Тесты:** `near.test.ts`, `route-choice-store.test.ts`, `ride-points-style.test.ts` (группы, слои во всех 7 темах ×
схемы, рамка одной точки и пустая — центр города), `ride-points-map.web.test.tsx` (SSR без координат, источник/слои,
точка «Рядом», клик → карточка → `onOpen`, курсор, ошибка до `load`), `ride-route-pick.test.tsx` (вкладки, «Без
маршрута», только `ready`, пометка, пусто), `ride-form.test.tsx` (+4: выбор → дистанция и подсказка → `routeId` в
запросе; «Без маршрута» снимает; `RIDE_ROUTE_UNAVAILABLE` под полем; правка с `private`), `ride-detail.test.tsx` (+3:
без маршрута; `public` — карта, профиль, «Набор», ссылка; `private` — баннер, без профиля, ссылка на «Мои»),
`rides.test.tsx` (+6: «Рядом» → `near: '53.90,27.56'`, `radiusKm: 25`, ключи кэша и `console.*` без координат (AC9),
«в 12 км от вас»; выключение; `denied` + `canOpenSettings` → «Открыть настройки»; `unavailable` → «Разрешить» и
«Выбрать город»; «Карта» — точки, группа, `GeoJSONSource onPress` → карточка → райд, «Ещё 3 райда…»; пустая карта).

**Отклонения (8.2):**
- `route-choice-store` — переменная модуля с `set/take/clear`, не zustand: подписчиков нет, нужна только передача.
- Блок маршрута использует `RouteLineMap` + `catalogRouteMapOptions` напрямую (это и есть содержимое `CatalogRouteMap`)
  — карта не ждёт ответа карточки каталога; подпись карты — из `ride.route`.
- Карточка точки карты — `RidePointCard` (название, дата, «идут N из M»), а не `RideListRow`: у `RideMapPoint` нет
  места, темпа, `viewer`.
- `RidePointsMapProps` + `bounds` и `now` (рамка считается в `RideMapView`, `useMemo` — карта не пересоздаётся на
  рендер).
- Сообщение пустого состояния «Рядом» одно для native и web (без отдельного текста про настройки браузера).

**Не проверено (NOT VERIFIED):** native-карта мультимаркеров, нажатие на точку и системный запрос геопозиции на
устройстве; web-смоук `e2e/web.spec.ts` (новый шаг `/rides/route-pick`) локально не запускался — в CI/на dev.

**Ревью PR B pass 1 (REQUEST CHANGES) — исправлено:**
1. Лента: герой — `all[0]`, строки — остальные; «пусто» — только `all.length === 0 && !hasNextPage`. Пустая последняя
   страница с курсором дочитывается сразу (`useRideFeed`, эффект с `emptyTail` в зависимостях), не больше
   `EMPTY_PAGES_MAX = 5` подряд — дальше «Показать ещё» в подвале; пока всё пусто и идёт дочитывание — скелетон.
2. Профиль высоты блока маршрута — `AsyncContent` по карточке каталога: место профиля, ошибка с «Повторить», баннер
   при ошибке обновления; 404 — без профиля.
3. `RidePointCard`: `maxHeight: '70%'` области карты, список группы — `ScrollView`, «Закрыть» — в шапке над списком.
4. `useNear`: номер чтения — счётчик модуля (на процесс), а не экземпляра: после перемонтирования новый ключ.
5. «Рядом» в ожидании позиции — скелетон (лента и карта), запросы без near не показываются как «рядом».
6. Запросы — только активного режима: `useRideFeed(..., view === 'list')`, `useRideMap(..., view === 'map')` (поднят в
   ленту, офлайн-баннер — от активного запроса).
7. Пикер «Мои»: одно условие `ready && distanceM !== null` для строк и пустоты; пусто — только без следующей страницы,
   иначе дочитывание со скелетоном.
Тесты: `rides.test.tsx` (+7: пустая первая страница, короткая, пустая середина, предел пустых и «Показать ещё»,
ожидание позиции, «Карта» + «Рядом» без near в ленте, большая группа), `use-near.test.tsx` (перемонтирование,
выключение до ответа), `ride-detail.test.tsx` (+1: загрузка/ошибка/повтор профиля), `ride-route-pick.test.tsx` (+2).

**Ревью PR B pass 2 (Codex, REQUEST CHANGES) — исправлено:**
1. `RideMapView`: при данных карта — в постоянном контейнере `flex: 1` (`ride-map-area`), ошибка обновления — баннер
   «Данные могли устареть» с «Повторить» соседним блоком (не stale-обёртка `AsyncContent`); без данных — состояния
   `AsyncContent`.
2. Место карты на загрузке — полноразмерный блок `flex: 1` без `SkeletonGroup`, подпись «Загрузка» у самого места.
3. Пикер: подвал обеих вкладок — скелетон карточки при догрузке, ошибка следующей страницы — баннер с повтором
   `fetchNextPage`, строки остаются (ошибка догрузки не уходит в `AsyncContent`).
Проверено: в `ride-feed.tsx` `AsyncContent` оборачивает только героя в шапке списка (без flex-контента); режим «Карта» —
`RideMapView` в контейнере `flex: 1`. Тесты: `rides.test.tsx` (+2), `ride-route-pick.test.tsx` (+2).
