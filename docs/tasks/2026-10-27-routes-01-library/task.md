# routes-01 — каталог маршрутов команды: вкладка «Маршруты» и карточка маршрута

Уровень: task3. Ветка `feature/routes-01-library` от `origin/develop`. Связано: ADR-0012 п. 1 (модуль `routes`),
ADR-0014 (карты), эпик `docs/tasks/2026-10-27-race-results/epic.md` §3.1, `docs/product/rides.md` (маршрут райда —
«до блока Маршруты»).

## 1. Title

Первый слайс блока «Маршруты»: публикация маршрутов команды в каталог (панель), публичный каталог с фильтрами и
карточка маршрута с картой в приложении.

## 2. Goal

Вкладка «Маршруты» сейчас — заглушка (`ScreenPlaceholder`). Райдер и гость должны видеть каталог маршрутов по
Беларуси от команды платформы, фильтровать его по городу старта, дистанции и покрытию и открывать карточку маршрута
по публичной ссылке: карта, длина, набор, петля, гонки на этом маршруте.

## 2.1 Продуктовые решения (human gate, пользователь, 2026-10-26)

| # | Вопрос | Решение |
|---|---|---|
| D1 | Что в каталоге v1 | только опубликованные маршруты команды (`origin: 'platform'`); «Мои маршруты» (загрузка GPX райдером, без публикации) — слайс routes-02; публичная UGC с модерацией — позже |
| D2 | Как маршрут попадает в каталог | явный флаг «Опубликован в каталоге» в панели у готового маршрута; при публикации задаются город старта (справочник `CITY_CODES`) и покрытие (`SURFACES`, мультивыбор); можно снять с публикации; коридоры гонок без флага в каталог не попадают |
| D3 | Фильтры | город старта, дистанция корзинами (< 50 км, 50–100 км, > 100 км), покрытие (асфальт/гравий); сортировка — новые публикации сверху |
| D4 | Карточка | карта (линия, старт, финиш), длина, набор, петля, город, покрытие; список гонок на этом маршруте; публичная ссылка `/routes/<id>` с SSR и OG |
| D5 | Кофе-райды | маршрут у райда — отдельный слайс позже |

## 3. Scope

- **contracts (`routes`):** `CatalogRouteCard` (список: id, title, distanceM, elevationGainM, isLoop, city, surfaces,
  publishedAt), `CatalogRouteDetail` (то же + ничего служебного), `CatalogRouteQuery` (`city[]`, `distance[]` из
  `ROUTE_DISTANCE_BUCKETS`, `surface[]`, `cursor`, `limit`), `CatalogRoutePage`; геометрия для карты — схема без
  `widthM` (общая часть с `RaceRouteMap`, решает architect без поломки `RaceRouteMap`); панель — `PublishRouteInput`
  (`city`, `surfaces`), поле `catalog` в `PanelRouteSummary` (`null` | `{ city, surfaces, publishedAt }`). Ответы
  приложения — `tolerantEnum` для справочников (R6).
- **api (`routes`):**
  - данные: в `RouteDoc` — `catalog: { city, surfaces, publishedAt } | null` (существующие документы — `null` через
    миграцию или чтение отсутствующего поля как `null`, решает architect по `pokatim-db.md`); индекс под список
    каталога (опубликованные, сортировка `publishedAt desc, _id desc`, фильтр city/surfaces/distanceM);
  - панель: `PUT /v1/admin/routes/:id/catalog` (публикация/правка города и покрытия) и
    `DELETE /v1/admin/routes/:id/catalog` (снять), право `races.manage`; только `ready`; журнал панели
    `route.published` / `route.unpublished`; ответ — `PanelRoute`;
  - публично (`PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`): `GET /v1/routes` (каталог, курсор),
    `GET /v1/routes/:id` (карточка), `GET /v1/routes/:id/map` (линия показа, старт, финиш, рамка — через
    существующий `displayGeometry`); не опубликованный в каталоге или неизвестный — `404 NOT_FOUND`. Наружу — без
    `ownerUserId`, `sha256`, статуса, `failure`, `attempts`, линии сверки.
- **api (`races`):** `GET /v1/routes/:id/races` — публичные гонки (опубликованные и отменённые, как `GET /v1/races`)
  с `corridor.routeId = id`, курсор, `RacePage`; живёт в `races` (races → routes, не наоборот); маршрут не в
  каталоге — `404`. Индекс по `corridor.routeId`.
- **api-client:** методы каталога, карточки, карты, гонок маршрута; панели — публикация/снятие.
- **admin (панель):** экран «Маршруты» (список маршрутов команды с колонкой «В каталоге», загрузка GPX — reuse
  существующей загрузки из `CorridorField`, если без дублирования), действие «Опубликовать в каталоге» — форма
  город + покрытие, «Изменить», «Снять с публикации» с подтверждением; пункт навигации.
- **app:**
  - вкладка `(tabs)/routes.tsx`: список (`FlatList`, `useInfiniteQuery`), фильтры-чипы (город, дистанция, покрытие)
    по образцу ленты гонок/райдов, состояния §4.12 (скелетон, пусто без фильтров «Маршрутов пока нет», пусто с
    фильтрами + «Сбросить фильтры», ошибка с повтором, ошибка догрузки — баннер в подвале), pull-to-refresh;
  - карточка `routes/[id].tsx` — публичный экран вне `Stack.Protected`: SSR + `publicPageMetadata` (название,
    «N км · набор M м»), карта (reuse `features/maps/route-map`; без коридора — новым необязательным пропсом, без
    смены существующих), длина, набор, петля, город, покрытие, «Гонки на маршруте» (ссылки на `races/[id]`, пусто —
    блока нет), шеринг ссылки; 404 — «Маршрут недоступен»;
  - Главная: раздел `routes` в `AVAILABLE_HOME_SECTIONS` (данные — `GET /v1/routes?limit=1`), герой — линия
    маршрута без обложки по правилам Главной (если без новой графики не выходит — текстовый герой, решает architect);
  - deep link `/routes/<id>` — маршрут Router; e2e-смоук `e2e/web.spec.ts` — шаг публичной карточки.
- **i18n:** свои блоки `routes.*`, `admin.routes.*` (не трогать `races.detail.map.*`).
- **docs:** `docs/product/routes.md` (решения D1–D5), правила `pokatim-security.md` (публичная линия маршрута
  каталога), `pokatim-app.md` (вкладка «Маршруты»), `pokatim-backend.md`/`pokatim-db.md` при изменениях, эпик
  race-results §3.1 — ссылка, `docs/tasks/README.md`.

## 4. Out of Scope

- «Мои маршруты», загрузка GPX/KML райдером, UGC, модерация, жалобы — routes-02 и позже.
- Маршрут у кофе-райда, «Набор» райда.
- «Рядом» (геопозиция), сортировка по расстоянию, геокодер названий старта/финиша, профиль высот, полоса покрытия
  в процентах (покрытие — только набор значений).
- Экспорт GPX, навигация, офлайн, карта в панели.
- Изменение компонента карты и карточки гонки сверх нового необязательного пропса (параллельная сессия «Карты 02»).
- Засев тестовых маршрутов — не код этой задачи (после слияния и выката на dev, вне PR).

## 5. Architecture Context

- `routes` владеет каталогом (документ маршрута, публичный контроллер, панельные действия); `races` знает `routes`
  через `modules/routes/index.ts` (проверка «маршрут в каталоге» для `GET /v1/routes/:id/races`); `routes` о гонках
  не знает.
- Готовый маршрут неизменяем по геометрии и длине; каталожные поля (`catalog`) — изменяемые метаданные, не влияют на
  коридоры гонок.
- Очередей нет; outbox не нужен (нет потребителей событий публикации). Журнал панели — в транзакции с изменением.
- Приложение: новый feature-модуль `features/routes/`; карта — `features/maps/`.

## 5.1 Placement & Reuse Gate

- Reuse: `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`, `page-cursor`, `RoutesCatalogService.displayGeometry`
  (кэш), `CITY_CODES`/`domain.city.*`, `SURFACES` и подписи покрытий гонок, `queryArray`, `tolerantEnum`,
  фильтры ленты гонок/райдов (`features/races/filters.ts`, чипы), `AsyncContent`/состояния §4.12,
  `usePullToRefresh`, `publicPageMetadata`, `features/maps/*`, `formatDistances`/`minsk-format`, `PanelAudit`,
  `MongoTransactions`, загрузка маршрута в панели (`routes-query.ts`).
- Запрещено: чтение коллекций `routes` из `races` и наоборот; свой `fetch` в экранах; координаты в логах; второй
  компонент карты; смена существующих пропсов `RouteMap`; свободный текст города.
- Дополнение architect: `RoutesCatalogService.displayGeometry` — только через сервис `routes` (публичная карта) и
  порт `RouteGeometry` (`races`); видимость каталога — одна точка `RoutesRepository.findPublished`; `visible()` и
  `toSummary`/`view` панели — без копий; загрузка GPX в панели — вынос из `CorridorField` (RC-15); `SectionHero`
  (герой Главной, RC-8), `RaceListCard` (гонки маршрута), `FilterGroup`/`FilterGroupSkeleton`, `withinAvailable`/
  `sortCitiesByLabel`, `shareLink`, `DetailHeader`, `fetchPublicForSsr`/`publicPath`, `HomeSection`.
- Запрещено дополнительно: `PUT`/`DELETE` в панели (RC-1); кэш в процессе для признака «в каталоге»; правка
  `race-route.schema.ts`, `race-route-map.tsx` и существующих пропсов `RouteMap` (RC-5, RC-6).

## 6. Relevant Files

- `apps/api/src/modules/routes/*`, `apps/api/src/modules/races/races-public.*`, `races.repository.ts`
- миграции Mongo (каталог миграций api), `apps/api/src/public-read.guard.ts`
- `packages/contracts/src/routes/route.schema.ts`, `races/race-public.schema.ts`, `races/race-route.schema.ts`,
  `geo/city.schema.ts`
- `packages/api-client/src/*`
- `apps/admin/src/features/races/{CorridorField.tsx,routes-query.ts}`, навигация панели
- `apps/app/src/app/(tabs)/routes.tsx`, `apps/app/src/app/_layout.tsx`, `features/maps/*`, `features/home/*`,
  `features/races/{race-feed.tsx,filters.ts,format.ts}`, `e2e/web.spec.ts`
- `packages/i18n`

## 7. Implementation Notes

- Корзины дистанции: `lt50` (< 50 000 м), `50to100` ([50 000; 100 000] м), `gt100` (> 100 000 м) — несколько
  корзин — `$or` диапазонов.
- Покрытие фильтра: маршрут подходит, если в его `surfaces` есть хотя бы одно выбранное значение.
- Курсор каталога — `(publishedAt, _id)`; повторная публикация после снятия — новый `publishedAt`.
- Правка `catalog` (город/покрытие) у опубликованного маршрута `publishedAt` не меняет.

## 8. Risks / Assumptions / Open Questions

- R1: параллельная сессия «Карты 02» меняет `features/maps/*` и карточку гонки — перед PR синхронизация с
  `develop`, пропс карты — только новый необязательный.
- R2: публичность линии маршрута каталога — новое публичное раскрытие (сейчас публична только линия коридора
  опубликованной гонки); маршрут каталога публикуется осознанно сотрудником — правило `pokatim-security.md`
  дополняется.
- A1: город старта задаёт сотрудник, не вычисляется по координатам (геокодера нет).
- A2: лимит списка — как у гонок (20 по умолчанию, ≤ 50).

## 8.1 Requirements Consistency (заполняет architect)

Architecture Review — routes-01-library: **CONCERNS** (блокеров нет). Ниже решения по умолчанию: coder идёт по ним,
человек может переиграть любое до старта coder. D1–D5 не пересматриваются.

- **RC-1 · HTTP-методы панели (конфликт с конвенцией, AC1).** В scope `PUT`/`DELETE /v1/admin/routes/:id/catalog`, а
  все мутации панели — `POST` с глаголом в пути (`races/:id/publish|cancel|discard`, `calendar/:id/unpublish|republish`;
  `createAdminApiClient` умеет только `get`/`post`/`request`). Кроме того, CORS API (`http-app.ts`) не разрешает
  `DELETE`. Альтернативы: (a) `POST /v1/admin/routes/:id/publish` (тело `PublishRouteInput`; у опубликованного —
  правка города и покрытия) и `POST /v1/admin/routes/:id/unpublish` (тело `{}`); (b) `PUT`/`DELETE` по scope + `DELETE`
  в CORS + `put`/`del` в клиенте панели — второй стиль в одном API; (c) один `POST …/catalog` с `catalog: null` для
  снятия — неочевидный контракт. **Рекомендация: (a).**
- **RC-2 · Отказы и идемпотентность (недоопределённость AC1).** Маршрут не виден сотруднику (чужой `processing`/
  `failed`) или неизвестен — `404 NOT_FOUND` (как `GET /v1/admin/routes/:id`); свой не `ready` — **новый код
  `409 ROUTE_INVALID_STATE`** (в конец `ErrorCode`, текст в `error-messages.ts`; `RACE_INVALID_STATE` — чужой домен,
  `422` в проекте для состояния не используется). Повторная публикация с теми же `city`/`surfaces` — `200` без записи и
  журнала; снятие неопубликованного — `200` без записи и журнала (повтор безопасен). Альтернатива — `409` на снятие
  неопубликованного: лишняя ошибка при двойном клике.
- **RC-3 · Журнал правки (недоопределённость).** Scope называет только `route.published`/`route.unpublished`, а правка
  города/покрытия опубликованного маршрута — тоже публичное изменение. Альтернативы: (a) третье действие
  `route.catalog_updated` с `details.changedFields` (`['city']`, `['surfaces']`; как `race.updated`); (b) правка пишется
  как `route.published` — журнал врёт о публикации; (c) правка без журнала. **Рекомендация: (a)**; все три — в конец
  `AUDIT_ACTIONS`, подписи `admin.audit.action.route.*`.
- **RC-4 · Чипы «Город» (вредное по UX, недоопределённость).** `CITY_CODES` — 25 городов; 25 чипов над списком из
  десятка маршрутов почти все дадут «пусто». Образец — райды и календарь (`GET /v1/rides/cities`,
  `/v1/calendar/cities`). Альтернативы: (a) `GET /v1/routes/cities` — коды городов опубликованных маршрутов,
  статический путь объявлен **до** `routes/:id`; чипы — по алфавиту подписи, до ответа `FilterGroupSkeleton`, ошибка или
  пусто — группа скрыта, исчезнувший город снимается (`withinAvailable`, как календарь); (b) все 25 из справочника;
  (c) города из загруженных страниц — неполно. **Рекомендация: (a).** Предел `city` в запросе — `CITY_CODES.length`
  (клиентского ограничения выбора нет).
- **RC-5 · Карта без коридора (ограничение «только новый необязательный пропс»).** `RouteMapProps.map: RaceRouteMap`
  требует `widthM`, у маршрута каталога его нет. Альтернативы: (a) новый пропс `corridor?: boolean` (по умолчанию
  `true`); при `false` слой `corridor` не создаётся и `map.widthM` не читается; вызывающий каталога передаёт
  `{ ...geometry, widthM: 0 }` через хелпер `withoutCorridor(geometry)` в `features/maps/` (комментарий: значение не
  читается); (b) расширить тип существующего пропса до `RouteMapGeometry & { widthM?: number }` (без коридора — нет
  `widthM`) — чище по данным, но меняет тип существующего пропса, что запрещено условием сессии «Карты 02»;
  (c) второй компонент карты — запрещено §5.1. **Рекомендация: (a)**; тесты maps-01 не меняются, правка
  `route-map.tsx`/`route-map.web.tsx` — одна строка фильтра слоёв в каждом (минимум конфликтов с maps-02, который
  добавляет `track?`).
- **RC-6 · Схема геометрии (`RaceRouteMap` не ломать).** `RouteMapGeometry` (`line`, `start`, `finish`, `bounds`) —
  в новом файле `routes/route-catalog.schema.ts` из `LonLat`/`RACE_ROUTE_MAX_POINTS`; `race-route.schema.ts` **не
  трогаем** (его читает maps-02). Совместимость держит тест типов (`RaceRouteMap` присваивается `RouteMapGeometry`) и
  тест схем. Вынос общей части `RaceRouteMap = RouteMapGeometry.extend(...)` — follow-up после слияния maps-02.
- **RC-7 · Данные (решение scope «миграция или `?? null`»).** Индекс нужен в любом случае — миграция `0020_routes_catalog`
  (expand-only, идемпотентна): частичный индекс каталога + бэкфилл `catalog: null` у документов без поля (как
  `0013` для `races.corridor`); чтение всё равно `?? null`. Новый маршрут пишется с `catalog: null`. Индекс
  гонок маршрута — там же.
- **RC-8 · Главная: герой и пусто (недоопределённость AC7).** Линия маршрута на Главной = запрос `/map` + MapLibre на
  Главной (или второй SVG-рендер — запрещено) — тяжело и вне «без новой графики». **Решение: текстовый герой**
  `SectionHero`: кикер «Маршрут команды», крупно — длина (`date={{ value: '86', unit: 'км' }}`), название, мета
  «набор 1 200 м · петля», «Минск · асфальт, гравий». AC7 «при наличии маршрутов» конфликтует с правилом Главной Q9
  («пусто — пустой герой раздела, без скрытия»): альтернативы (a) раздел всегда, пусто — `EmptyState` «Маршрутов пока
  нет» (без действия); (b) раздел скрыт при пустом каталоге — сдвиг ленты после загрузки и особый случай.
  **Рекомендация: (a)**, AC7 читать как «раздел в реестре и показывает героя при наличии маршрутов».
- **RC-9 · «Гость видит каталог» (Goal) vs вкладки под гардом.** Вкладки — только для вошедших (Главная Q5, ADR-0003).
  Решение: как у гонок — гость открывает **карточку** по ссылке (`/routes/<id>` вне `Stack.Protected`); вкладка
  «Маршруты» — вошедшим. Публичный список для гостя — отдельным решением вместе с гостевой лентой.
- **RC-10 · Конкурентная правка.** У `routes` нет `version`; правка и снятие — транзакция «прочитать маршрут (сессия) →
  `updateOne` того же документа → `PanelAudit.append`»: две транзакции одного маршрута конфликтуют по документу и
  повторяются на свежем снимке (`MongoTransactions.run`), журнал согласован с итогом. Правка «последний пишущий
  выигрывает» без `409 CONFLICT` — принято (метаданные, журнал фиксирует обе). Альтернатива — `version` в `RouteDoc` и
  форме: лишняя сложность v1.
- **RC-11 · Публикация раскрывает точные старт и финиш.** GPX сотрудника может начинаться у дома. Решение: окно
  публикации показывает `LinePreview` маршрута и подсказку «Линия, старт и финиш станут видны всем»; правило
  `pokatim-security.md` — исключение «линия показа маршрута каталога» (R2). Обрезка концов — не v1.
- **RC-12 · Гонки маршрута: порядок и объём.** Порядок — `windowStartsAt desc, _id desc` (новые сверху; курсор
  `UtcMinute`, как у списков гонок); на карточке — первая страница `limit: 10` и «Показать ещё» (`useInfiniteQuery`),
  блока нет при пустой первой странице, при 404 и при ошибке (тихо, как карта; карточка цела).
- **RC-13 · Кэш после снятия.** `public, max-age=60` и кэш SSR web-сервера (60 с) могут показывать снятый маршрут до
  минуты — принято (как гонки); int-тест проверяет `404` сразу после снятия на уровне API.
- **RC-14 · Название в каталоге = название загрузки (вопрос человеку, не блокер).** Название задаётся при загрузке GPX
  (по умолчанию — имя файла) и в форме публикации не меняется. По умолчанию — так (v1); альтернатива — поле «Название»
  в окне публикации (`RouteTitle`, журнал `changedFields: ['title']`). Готовый маршрут неизменяем по геометрии, не по
  названию — правило не нарушается.
- **RC-15 · Reuse загрузки в панели.** Загрузка (окно «Новый маршрут», мутация, опрос статуса) сейчас внутри
  `CorridorField`. Решение: вынести в `features/routes/route-upload.tsx` (`useRouteUpload` + `RouteUploadDialog`) и
  перенести `routes-query.ts` в `features/routes/`; `CorridorField` использует их без смены поведения
  (`RaceEditor.corridor.test.tsx` зелёный без правок, кроме импортов). Копия логики загрузки — запрещена.
- **RC-16 · Гейт карты на карточке маршрута.** Логика «после монтирования, `mapSupported()`, `mapStyleUrl`, скелетон,
  схлопывание» — как в `race-route-map.tsx`. Решение: новый хук `features/maps/use-map-style.ts`
  (`{ mounted, styleUrl, theme }`) — использует только новый блок каталога; перевод `RaceRouteMap` на хук — follow-up
  после maps-02 (иначе конфликт).

## 8.2 Deviations from spec

- DEV-1 (coder, backend): `ROUTE_DISTANCE_RANGES_M` хранит диапазоны сразу операторами MongoDB (`$lt`/`$gte`/`$lte`/`$gt`)
  — константа используется только репозиторием, границы §7 те же (int-тест границ 49 999 / 50 000 / 100 000 / 100 001).
- DEV-2 (coder, backend): фильтр `findPublished`/`listCatalog`/`catalogCities` дополнительно содержит `status: 'ready'`
  (остаточный фильтр; `catalog` пишется только у `ready`) — `explain` по-прежнему `IXSCAN routes_catalog_idx` без `SORT`.
- DEV-3 (coder, backend): `RoutesPublicService` получает `displayGeometry` через порт `ROUTE_GEOMETRY` (тот же
  экземпляр `RoutesCatalogService`), чтобы не добавлять экспорт в `RoutesCoreModule`.
- DEV-4 (coder, backend): вне шагов 1–6, но нужно для зелёного `pnpm check` после смены контрактов — подписи журнала
  `admin.audit.action.route.published|unpublished|catalog_updated` в `packages/i18n` (типизированный `t()` экрана
  журнала), `catalog: null` в фикстурах `RaceEditor.corridor.test.tsx` и `api-client/admin.test.ts` (§11
  «Совместимость»). Остальные ключи `admin.routes.*`/`routes.*` — со следующей частью.
- DEV-5 (coder, backend): тест `disputes.schema.test.ts` «коды споров — в конце `ErrorCode`» проверял `slice(-2)` и
  ломался любым новым кодом; теперь проверяет, что коды споров идут сразу после `RESULTS_PUBLISH_BLOCKED` (полный
  порядок `ErrorCode` по-прежнему держит `common.test.ts`). Ожидания полного набора индексов в тестах `0007_races` и
  `0013_routes` дополнены индексами `0020` (как было с `0009`).
- DEV-6 (coder, frontend): кроме `useRouteUpload`/`RouteUploadDialog` (RC-15) из `CorridorField` вынесен и превью
  `RoutePreview` (`features/routes/RoutePreview.tsx`) — его же показывает окно публикации (RC-11), без копии. Хук
  загрузки дополнительно инвалидирует `['admin','routes','list']` (после загрузки и по завершении обработки), чтобы
  экран «Маршруты» видел новый маршрут; ключ `ready` — как раньше (только при `ready`).
- DEV-7 (coder, frontend): существующие тесты, кодирующие прежний состав, обновлены под новое поведение (не
  ослаблены): `AppLayout.test.tsx` (пункт «Маршруты» в навигации), `sections.test.ts` и `home.test.tsx` (раздел
  `routes` в реестре; кейс «раздел без бэкенда» заменён на «`routes` в опросе поднимает раздел с тегом», скелетонов и
  «Нет соединения» — 4). Тесты maps-01 и `RaceEditor.corridor.test.tsx` — без правок.
- DEV-8 (coder, frontend): i18n отличается от перечня §11 в деталях: нет `routes.citiesFailed` (ошибка городов —
  группа скрыта без текста, как календарь); добавлены `routes.heroUnit`, `routes.detail.kicker|elevationValue|
  copied|shareFailed`, `admin.routes.column.*|status.*|yes|no|elevation`, `admin.routes.catalog.dialog.save|
  cityPlaceholder`. Мета `routes/[id]` — отдельный файл `route-metadata.test.ts` (не `public-metadata.test.ts`).
- DEV-9 (coder, frontend): `docs/tasks/README.md` индекса задач не ведёт — не менялся. `git merge origin/develop` —
  «Already up to date» (maps-02 в develop ещё нет, R1 остаётся до слияния maps-02).

## 8.3 Security checklist

- Публичные ответы — только перечисленные поля (int-тест на ключи); не опубликованный маршрут не виден публично ни
  по одному эндпоинту (включая карту и гонки маршрута).
- Панель: публикация — `races.manage`, CSRF/авторизация панели как у загрузки маршрута; журнал без координат.
- Логи — id маршрута, коды; без координат и названий файлов.

## 9. Acceptance Criteria

1. Панель: у готового маршрута «Опубликовать в каталоге» с городом и покрытием → маршрут в `GET /v1/routes`;
   «Снять с публикации» → исчезает из каталога, карточка, карта и гонки маршрута — `404`; не `ready` — отказ
   (`409`/`422`, код решает architect); без `races.manage` — `403`; запись в журнале панели.
2. `GET /v1/routes` — только опубликованные, новые публикации сверху, курсор без дублей и пропусков; фильтры город,
   дистанция, покрытие (в том числе комбинации и несколько значений); невалидный параметр — `400`;
   `Cache-Control: public, max-age=60`; ключи элемента — ровно контрактные.
3. `GET /v1/routes/:id` и `/map` — опубликованный → `200`; неизвестный/не опубликованный → `404 NOT_FOUND`;
   невалидный id → `400`; в ответах нет `ownerUserId`, `sha256`, `status`, `failure`, линии сверки.
4. `GET /v1/routes/:id/races` — публичные гонки с этим маршрутом коридора, черновики не видны; маршрут не в
   каталоге — `404`.
5. Вкладка «Маршруты»: список с карточками (название, км, набор, петля, город, покрытие), фильтры, состояния
   загрузки/пусто/пусто с фильтрами/ошибка/догрузка; pull-to-refresh.
6. Карточка `/routes/<id>`: карта без коридора (линия, старт, финиш), цифры, гонки на маршруте, шеринг; гость
   открывает по ссылке; SSR отдаёт мета без ПДн; 404 — «Маршрут недоступен»; существующая карта гонки не изменилась.
7. Главная показывает раздел «Маршруты» при наличии маршрутов в каталоге (в порядке и с тегом опроса).
8. i18n — ключи во всех локалях проекта; a11y — подписи карточек и карты (текстовая альтернатива).
9. `TURBO_CONCURRENCY=1 pnpm check` зелёный (изолированные `MONGO_URL_TEST`/`REDIS_URL_TEST`).

## 10. Documentation Impact

- `docs/product/routes.md` (новый), `docs/product/README.md`, `docs/tasks/README.md`.
- `.claude/rules/pokatim-security.md`, `pokatim-app.md`, при необходимости `pokatim-backend.md`, `pokatim-db.md`.
Дополнение architect: `pokatim-backend.md` (публичный контроллер `routes`, порт `RouteCatalog.inCatalog`,
`GET /v1/routes/:id/races` в `races`, порядок `routes/cities` до `routes/:id`, `routes` зависит от `panel` и
`src/public-read.guard.ts`); `pokatim-db.md` (раздел «Маршруты»: `catalog`, `0020_routes_catalog`, индексы,
транзакция «чтение → запись → журнал»); `pokatim-contracts.md` (`route-catalog.schema.ts`, `RouteMapGeometry`,
`PublishRouteInput`, `ROUTE_INVALID_STATE`); `pokatim-security.md` («Загрузка маршрутов» — исключение для линии
показа маршрута каталога, `POST …/publish|unpublish` под `races.manage`); `pokatim-web.md` (экран «Маршруты»,
вынос загрузки); `pokatim-app.md` (вкладка, карточка `routes/[id]`, пропс `corridor`, ключи, раздел Главной);
`docs/product/home.md` (раздел «Маршруты», RC-8); `pr.md` — миграция `0020`.

## 11. Implementation Context (заполняет architect)

Сверено по коду ветки (`cac3af3`, от `origin/develop` `f344e1f`) и плану maps-02 (`worktrees/maps-02-own-track-*`),
2026-10-27. Решения RC-1…RC-16 — §8.1.

### ENTRY POINTS

- API панель: `POST /v1/admin/routes/:id/publish|unpublish` → `RoutesAdminController` → `RoutesCatalogAdminService`.
- API публично: `GET /v1/routes`, `/v1/routes/cities`, `/v1/routes/:id`, `/v1/routes/:id/map` →
  `RoutesPublicController` → `RoutesPublicService`; `GET /v1/routes/:id/races` → `RacesPublicController.routeRaces` →
  `RacesPublicService.listRouteRaces` (проверка каталога — порт `RouteCatalog.inCatalog`).
- App: вкладка `src/app/(tabs)/routes.tsx` → `features/routes/route-feed.tsx`; карточка `src/app/routes/[id].tsx`
  (SSR) → `features/routes/route-detail.tsx`; Главная `src/app/(tabs)/index.tsx` — раздел `routes`.
- Admin: маршрут `routes` в `router.tsx` → `features/routes/RoutesScreen.tsx`; пункт `NAVIGATION`.

### Эндпоинты, видимость, коды

| Метод и путь | Где | Гард / право | Кэш | Ответ | Отказы |
|---|---|---|---|---|---|
| `POST /v1/admin/routes/:id/publish` | `RoutesAdminController` | `PanelGuard` + `races.manage` | `no-store` (гард) | `PanelRoute` | 400 (id, тело), 403, 404 (нет / не виден), 409 `ROUTE_INVALID_STATE` (не `ready`) |
| `POST /v1/admin/routes/:id/unpublish` | там же | `races.manage` | `no-store` | `PanelRoute` | 400, 403, 404 |
| `GET /v1/routes` | `RoutesPublicController` | `PublicReadGuard` | `PUBLIC_READ_CACHE_CONTROL` | `CatalogRoutePage` | 400 (параметры, курсор), 429 |
| `GET /v1/routes/cities` | там же, **до** `routes/:id` | `PublicReadGuard` | public 60 | `CatalogRouteCities` | 429 |
| `GET /v1/routes/:id` | там же | `PublicReadGuard` | public 60 | `CatalogRouteDetail` | 400 (`Uuid`), 404 `NOT_FOUND` |
| `GET /v1/routes/:id/map` | там же | `PublicReadGuard` | public 60 | `RouteMapGeometry` | 400, 404 `NOT_FOUND` |
| `GET /v1/routes/:id/races` | `RacesPublicController` | `PublicReadGuard` (класс) | public 60 | `RacePage` | 400 (id, курсор — после 404), 404 `NOT_FOUND` |

- Видимость публично — одна точка `RoutesRepository.findPublished(id)` (`{ _id, status: 'ready', 'catalog.publishedAt':
  { $type: 'date' } }`): неизвестный, не готовый, не опубликованный, снятый — один `404 NOT_FOUND`. Без кэша в процессе
  (каталог изменяем); кэшируется только геометрия (`displayGeometry`, неизменна).
- Порядок объявления в `RoutesPublicController`: `@Get('routes')`, `@Get('routes/cities')`, `@Get('routes/:id')`,
  `@Get('routes/:id/map')`. В `RacesPublicController` — `@Get('routes/:id/races')` (имя параметра то же — `id`).
  int-тест: `GET /v1/routes/cities` → 200, а не 400 pipe `Uuid`.
- Панель: видимость маршрута — существующая `visible()` из `routes.service.ts` (готовый — всем с правом; свой
  необработанный — автору); `origin: 'platform'` в фильтре записи.

### FILES TO MODIFY / CREATE

contracts (`packages/contracts`)
- `src/races/race.schema.ts` — вынести список покрытий запроса в `export const SurfaceList` (тот же
  `z.array(Surface…).min(1).max(SURFACES.length).refine(unique)`), `RaceInput.surfaces: SurfaceList` (поведение то же).
- `src/routes/route-catalog.schema.ts` (новый) + экспорт в `src/index.ts`: `ROUTE_DISTANCE_BUCKETS`,
  `RouteDistanceBucket`, `CATALOG_ROUTE_LIST_MAX_LIMIT = 50`, `CatalogRouteQuery`, `CatalogRouteCard`,
  `CatalogRouteDetail`, `CatalogRoutePage`, `CatalogRouteCities`, `RouteMapGeometry`, `CatalogRouteRacesQuery` (см.
  TYPES). Тест `route-catalog.schema.test.ts`.
- `src/routes/route.schema.ts` — `PublishRouteInput`, `PanelRouteCatalog`, поле `catalog` в `PanelRouteSummary`
  (обязательное `nullable`: панель деплоится с API).
- `src/admin/audit.schema.ts` — в конец `AUDIT_ACTIONS`: `'route.published'`, `'route.unpublished'`,
  `'route.catalog_updated'`.
- `src/common.ts` — в конец `ErrorCode`: `'ROUTE_INVALID_STATE'` (комментарий «routes-01: действие с маршрутом
  недоступно в его статусе»).
- `src/races/race-route.schema.ts` — **не меняется** (RC-6).

api-client (`packages/api-client`)
- `src/index.ts` (блок «read-модель», публично, `getPublic`): `listCatalogRoutes(params: CatalogRouteListParams = {})`
  → `/v1/routes${queryString(params)}`; `listCatalogRouteCities()`; `getCatalogRoute(id)`; `getCatalogRouteMap(id)`
  → `/v1/routes/:id/map`; `listCatalogRouteRaces(id, params)` → `/v1/routes/:id/races` (`RacePage`). Все пути —
  `encodeURIComponent(id)`. Тип `CatalogRouteListParams` рядом с `RaceListParams`.
- `src/admin.ts`: `publishRoute(id, body: PublishRouteInput)` → `post(\`${route(id)}/publish\`, PanelRoute, body)`;
  `unpublishRoute(id)` → `post(\`${route(id)}/unpublish\`, PanelRoute)`.

api (`apps/api`)
- `src/modules/routes/routes.collection.ts` — `RouteCatalogDoc { city: CityCode; surfaces: Surface[]; publishedAt:
  Date }`, в `RouteDoc` — `catalog: RouteCatalogDoc | null` (комментарий: документы до `0020` — `?? null`, миграция
  ставит `null`; изменяемые метаданные готового маршрута, на коридоры не влияют).
- `src/db/migrations/0020_routes_catalog.ts` (новый) + в конец `migrations` в `index.ts`: экспорт `ROUTES_CATALOG_INDEXES`;
  `routes`: `{ 'catalog.publishedAt': -1, _id: -1 }` name `routes_catalog_idx`, `partialFilterExpression:
  { 'catalog.publishedAt': { $type: 'date' } }`; `races`: `{ 'corridor.routeId': 1, windowStartsAt: -1, _id: -1 }` name
  `races_route_idx` (без частичного фильтра: равенство по строке не доказывает `$type`); бэкфилл
  `routes.updateMany({ catalog: { $exists: false } }, { $set: { catalog: null } })`. Expand-only, без транзакции.
- `src/modules/routes/routes.repository.ts`:
  - `findPublished(id): Promise<RouteDoc | undefined>` — фильтр видимости выше; `projection` без `sha256`/`ownerUserId`
    не обязательна (наружу идёт явный маппинг), но допустима;
  - `listCatalog(filter: { cities?, distance?, surfaces? }, after: CursorPosition<Date> | null, limit)` — `$and`:
    `{ 'catalog.publishedAt': { $type: 'date' } }` (обязательно — условие частичного индекса), город —
    `{ 'catalog.city': { $in } }`, покрытие — `{ 'catalog.surfaces': { $in } }`, дистанция — `{ $or: buckets.map(range) }`
    (`lt50`: `distanceM < 50000`; `50to100`: `50000 ≤ distanceM ≤ 100000`; `gt100`: `> 100000`), курсор —
    `{ $or: [{ 'catalog.publishedAt': { $lt: k } }, { 'catalog.publishedAt': k, _id: { $lt: id } }] }`;
    `.sort({ 'catalog.publishedAt': -1, _id: -1 })`; диапазоны корзин — константа `ROUTE_DISTANCE_RANGES_M` в
    `routes.policy.ts`;
  - `catalogCities(): Promise<string[]>` — `distinct('catalog.city', { 'catalog.publishedAt': { $type: 'date' } })`;
  - `setCatalog(session, id, catalog: RouteCatalogDoc, now): Promise<boolean>` и `clearCatalog(session, id, now)` —
    `updateOne({ _id: id, status: 'ready', origin: 'platform' }, { $set: { catalog, updatedAt: now } }, { session })`;
  - `insertRoute` — документ с `catalog: null` (правка `RoutesService.accept`).
- `src/modules/routes/routes.policy.ts` — `ROUTE_DISTANCE_RANGES_M: Record<RouteDistanceBucket, { min?, max?, … }>`
  (границы §7), используется только репозиторием.
- `src/modules/routes/route-catalog.port.ts` + `route-catalog.ts` — метод `inCatalog(id: string): Promise<boolean>`
  (`findPublished`, без кэша); комментарий порта: «`races`: гонки маршрута каталога».
- `src/modules/routes/routes-catalog-admin.service.ts` (новый) — `publish(principal, id, input)`, `unpublish(principal,
  id)`: `MongoTransactions.run(tx => { route = repository.findRoute(id, tx); не найден / !visible → 404; status !==
  'ready' → 409 ROUTE_INVALID_STATE; вычислить действие (null → published с publishedAt = now; иначе changedFields по
  city/surfaces (сравнение множеств); пусто → без записи); setCatalog/clearCatalog; PanelAudit.append(tx, { action,
  actor, subject: { kind: 'route', id, label: route.title }, details: changedFields ? { changedFields } : null }) })`;
  лог после `run` — `route <id> <action> by <uid>`; ответ — `RoutesService.view` (сделать его публичным методом или
  вынести `view`/`toSummary` в общий `routes.view.ts`, без копии). `visible()` — экспортировать из одного места.
- `src/modules/routes/routes.service.ts` — `toSummary` + `catalog: route.catalog ? { city, surfaces, publishedAt:
  iso } : null` (`route.catalog ?? null`); `accept` — `catalog: null`.
- `src/modules/routes/routes-admin.controller.ts` — `@Post(':id/publish')` (`races.manage`, `idPipe`,
  `@Body(new ZodValidationPipe(PublishRouteInput, FieldErrorCode))`), `@Post(':id/unpublish')` (`races.manage`,
  `@HttpCode(200)` на обоих — как `races-admin.controller.ts` `publish`).
- `src/modules/routes/routes-public.service.ts` (новый) — `list`, `cities`, `get`, `map`: ответы — явный список полей
  (`toCatalogCard(route)`: `id, title, distanceM, elevationGainM, isLoop, city, surfaces, publishedAt`); `map` →
  `findPublished` → `catalog.displayGeometry(id)` (инжект `RoutesCatalogService`) → `{ line, start, finish, bounds }`;
  `null` → 404. Курсор — `decodeCursor(cursor, z.iso.datetime())` / `encodeCursor(publishedAt.toISOString(), _id)`.
- `src/modules/routes/routes-public.controller.ts` (новый) — `@Controller() @UseGuards(PublicReadGuard)`, порядок
  выше, `@Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)` на каждом, `Uuid` pipe с `FieldErrorCode`.
- `src/modules/routes/routes.module.ts` — `RoutesModule`: `controllers: [RoutesAdminController,
  RoutesPublicController]`, `providers: [RoutesService, RoutesCatalogAdminService, RoutesPublicService,
  PublicReadGuard]` (`PublicReadGuard` — из `../../public-read.guard`, как `RacesModule`). `RoutesCoreModule` и
  `index.ts` — без новых экспортов, кроме типа порта (метод в `RouteCatalog`).
- `src/modules/races/races.repository.ts` — `listPublicByRoute(routeId, after: CursorPosition<Date> | null, limit)`:
  `{ 'corridor.routeId': routeId, status: { $in: ['published','cancelled'] } }` + курсор по `windowStartsAt desc,
  _id desc`, `.sort({ windowStartsAt: -1, _id: -1 })`.
- `src/modules/races/races-public.service.ts` — `@Inject(ROUTE_CATALOG) catalog: RouteCatalog` (импорт из
  `'../routes'`); `listRouteRaces(routeId, query)`: сначала `inCatalog` → 404, затем курсор (`UtcMinute`), затем
  `cards(page, now)` (без второго маппинга).
- `src/modules/races/races-public.controller.ts` — `@Get('routes/:id/races')` с `Uuid` pipe и
  `ZodValidationPipe(CatalogRouteRacesQuery, FieldErrorCode)`.
- `src/error-messages.ts` — текст `ROUTE_INVALID_STATE` («Маршрут ещё не готов»).
- `src/db/migrations/migrations.int.test.ts` — кейс `0020_routes_catalog`.

admin (`apps/admin`)
- `src/features/routes/routes-query.ts` — перенос из `features/races/` (+ `routesPageQuery` для экрана по образцу
  `RacesScreen`/`DataTable`); `features/races/CorridorField.tsx` — импорты.
- `src/features/routes/route-upload.tsx` (новый, RC-15) — `useRouteUpload()` (мутация, опрос `ROUTE_POLL_MS`/
  `ROUTE_POLL_MAX_MS`, `pendingSince`, `pollExpired`) и `RouteUploadDialog` (окно «Новый маршрут»); `CorridorField` —
  на них.
- `src/features/routes/RoutesScreen.tsx` (новый) — `PageHeader` «Маршруты» + «Загрузить GPX» (`FileButton` →
  `RouteUploadDialog`, только `useCan('races.manage')`); `DataTable`: «Название», «Длина», «Набор», «Петля», «Статус»
  (`StatusTag`; отказ — причина `admin.routes.failure.*`), «Загрузил», «В каталоге» («Минск · асфальт, гравий» или
  «—»); действия строки (только `races.manage`, только `ready`): «Опубликовать в каталоге» / «Изменить» / «Снять с
  публикации». Состояния — `DataTable` (скелетон, ошибка с повтором, пусто «Маршрутов пока нет»).
- `src/features/routes/RouteCatalogDialog.tsx` (новый) — `Dialog`: `LinePreview` (`routeQuery(id)`), подсказка RC-11,
  «Город старта» — `SelectField` из `CITY_CODES` по алфавиту подписи `domain.city.*`, «Покрытие» — `ChipGroup`/
  `ToggleChip` из `SURFACES` (`domain.surface.*`); валидация — `PublishRouteInput` (zod контракта) + ошибки сервера
  под полями (`serverFieldErrors`); `409 ROUTE_INVALID_STATE` — текст в окне; кнопка — `busy`.
  «Снять с публикации» — `Dialog` подтверждения без причины. Успех — `setQueryData` маршрута +
  `invalidateQueries(ROUTES_QUERY_KEY)`.
- `src/router.tsx` — `path: 'routes'`, `RequirePermission permission="races.read"`; `src/navigation.ts` — `to` += `'/routes'`,
  пункт `{ to: '/routes', labelKey: 'admin.nav.routes', permission: 'races.read', group: 'main' }` после «Календаря»,
  до «Сезонов» (сезоны — последними в основной группе).

app (`apps/app`)
- `src/features/maps/route-map-props.ts` — новый необязательный `corridor?: boolean` («`false` — линия, старт и финиш
  без коридора; `map.widthM` не читается»). `route-map.tsx`, `route-map.web.tsx` — слои:
  `routeLayers(...).filter((layer) => corridor !== false || layer.id !== CORRIDOR_LAYER_ID)`;
  `corridor-style.ts` — `export const CORRIDOR_LAYER_ID = 'corridor'` (использовать в `routeLayers`). Существующие
  пропсы, `RaceRouteMap`, `race-route-map.tsx` — без изменений.
- `src/features/maps/route-geometry.ts` (новый) — `withoutCorridor(geometry: RouteMapGeometry): RaceRouteMap`
  (`widthM: 0`, комментарий RC-5); `src/features/maps/use-map-style.ts` (новый, RC-16) — `useMapStyle(): { mounted,
  styleUrl: string | null, theme }`.
- `src/features/routes/queries.ts` (новый) — ключи и хуки (см. «Ключи query»).
- `src/features/routes/filters.ts` (новый) — `RouteFilters { city: CityCode[]; distance: RouteDistanceBucket[];
  surface: Surface[] }`, `NO_FILTERS`, `hasFilters`, `DISTANCE_CHIPS = ROUTE_DISTANCE_BUCKETS`, `SURFACE_CHIPS =
  SURFACES`, `withinAvailable` городов; `toggle` — из `src/lib/filter-chips.ts`; сортировка городов —
  `sortCitiesByLabel` (`features/rides/filters.ts`; при неудобной зависимости — перенести его и `cityLabel` в
  `src/lib/`, райды импортируют оттуда; копии нет).
- `src/features/routes/format.ts` (новый) — `routeKm(distanceM)` (через `formatDistances([m/1000])`), `routeStats(route)`
  («86 км · набор 1 200 м · петля»; `elevationGainM: null` — без набора), `routePlace(route)` («Минск · асфальт,
  гравий»; `'unknown'` — без своей части, `domainLabel`), `routeShareDescription(route)` (мета/OG без ПДн),
  `routeHeroDate(route)` (`{ value, unit }` для `SectionHero`).
- `src/components/route-list-card.tsx` (новый, + `RouteListCardSkeleton`, тест) — по образцу `race-list-card.tsx`:
  название, `routeStats`, `routePlace`; `accessibilityRole="link"`, подпись одной строкой.
- `src/features/routes/route-feed.tsx` (новый) — `FlatList` по образцу `race-feed.tsx`: шапка (заголовок
  `routes.title`), `OfflineBanner`, фильтры `FilterGroup` «Город» (`FilterGroupSkeleton` до ответа; ошибка/пусто —
  скрыта), «Дистанция», «Покрытие», «Сбросить фильтры» (`TextAction`) при фильтрах; `AsyncContent` с
  `isError && !isFetchNextPageError`: скелетон — 3 `RouteListCardSkeleton`; пусто без фильтров — `EmptyState`
  «Маршрутов пока нет»; пусто с фильтрами — `EmptyState` + действие «Сбросить фильтры»; подвал — скелетон догрузки
  или `Banner` + «Повторить» (`fetchNextPage`); `onEndReached` → `loadMore`; pull-to-refresh — `usePullToRefresh([feed.refetch,
  cities.refetch])`. Смена фильтра — новый ключ, скелетон на месте данных (без `keepPreviousData`).
- `src/app/(tabs)/routes.tsx` — экран вкладки по образцу `(tabs)/races.tsx` (`SafeAreaView`, `DocumentTitle`, `TopBar`,
  `RouteFeed`, фильтры — `useState`).
- `src/features/routes/route-detail.tsx` (новый) — по образцу `race-detail.tsx`: `Uuid.safeParse(id)` → иначе «не
  найдено» без запроса; 404 → `EmptyState` «Маршрут недоступен» + «Все маршруты» (вошедшему `/routes`, гостю `/`);
  `DetailHeader`, `DocumentTitle`, `OfflineBanner`, `AsyncContent` (скелетон героя + текст); тело: название, блок
  карты, строки «Длина», «Набор», «Петля» (да/нет), «Город старта», «Покрытие», «Поделиться» (`shareLink`/`shareOrigin`,
  путь `/routes/<id>`; нет origin — кнопки нет), «Гонки на маршруте» (RC-12: `RaceListCard` с `datesWithYear`, ссылки
  `/races/<id>`, «Показать ещё»). Pull-to-refresh — деталь + гонки (карта не перезапрашивается: геометрия неизменна).
- `src/features/routes/catalog-route-map.tsx` (новый) — по образцу `race-route-map.tsx` через `useMapStyle`: до
  монтирования и при `isPending` — скелетон `MAP_ASPECT_RATIO`; env/модуль нет, 404/ошибка без данных — `null`;
  иначе `<RouteMap key={\`${styleUrl}|${bounds}\`} map={withoutCorridor(data)} corridor={false} …
  accessibilityLabel={t('routes.detail.map.label', { distance })} failedMessage={t('routes.detail.map.failed')} />`.
- `src/app/routes/[id].tsx` (новый) — копия схемы `src/app/races/[id].tsx`: `routeForSsr` = `publicPath('/v1/routes',
  params.id)` → `fetchPublicForSsr(path, CatalogRouteDetail)`; `loader` → `ssrData`; `generateMetadata`: найден —
  `publicPageMetadata({ title: route.title, description: routeShareDescription(route), path: '/routes/<id>' })`;
  не найден — нейтральная `{ title: t('routes.detail.title'), description: t('app.tagline') }` + `robots: 'noindex'`;
  недоступен — нейтральная без `robots`. Экран — `RouteDetailScreen` с `useLoaderSeed`.
- `src/app/_layout.tsx` — `<Stack.Screen name="routes/[id]" />` рядом с `races/[id]` (вне `Stack.Protected`).
- `src/features/home/sections.ts` — `'routes'` в `AVAILABLE_HOME_SECTIONS` (между `rides` и `calendar` — порядок
  вкладок держит `HOME_SECTION_ORDER`); комментарий реестра. `src/features/home/queries.ts` — `useLatestRoute()`
  (`['routes','list',{ limit: 1 }]`, `api.listCatalogRoutes({ limit: 1 })`, `staleTime` 60 с).
  `src/features/home/heroes.tsx` — `RouteHero` (`SectionHero`, RC-8). `src/app/(tabs)/index.tsx` — `SECTION_COPY.routes`
  (`home.routes.*`, `href: '/routes'`), ветка `id === 'routes'` (`HomeSection`, пусто — `EmptyState` «Маршрутов пока
  нет»), `routes.refetch` в `refetchers`, `routes.data` в `hasData`, `routes.dataUpdatedAt` в `useMinskClock`.
- `e2e/web.spec.ts` — шаги (см. TESTS); `e2e/schedule-fixture.ts` — `publishCatalogRoute(request)` на существующей
  загрузке маршрута фикстуры (+ `POST …/publish`).

i18n (`packages/i18n/src/ru.ts`, единственная локаль)
- Свой блок `routes.*`: `title`, `filter.city|distance|surface`, `distance.lt50` («до 50 км»), `distance.50to100`
  («50–100 км»), `distance.gt100` («больше 100 км»), `empty`, `noMatchTitle`, `noMatch`, `resetFilters`, `stats.*`
  (`elevation` «набор {gain} м», `loop` «петля»), `card.label` (a11y), `detail.title` («Маршрут»), `detail.notFound`
  («Маршрут недоступен»), `detail.allRoutes`, `detail.length|elevation|loop|city|surface`, `detail.yes|no`,
  `detail.share`, `detail.races`, `detail.racesMore`, `detail.map.label` («Карта маршрута: {distance}, старт и финиш
  отмечены»), `detail.map.failed`, `citiesFailed`.
- `home.routes.kicker|title|all|heroKicker|empty`.
- `admin.routes.*` (существующий блок дополняется): `title`, `upload`, `column.*`, `catalog.none` («—»),
  `catalog.publish|edit|unpublish`, `catalog.dialog.title|editTitle|hint|submit|city|surfaces`,
  `catalog.unpublishConfirm.title|message|confirm`, `error.ROUTE_INVALID_STATE`, `empty`; `admin.nav.routes`;
  `admin.audit.action.route.published|unpublished|catalog_updated`. `races.detail.map.*` не трогать.

### TYPES & SCHEMAS

```ts
// packages/contracts/src/routes/route-catalog.schema.ts
export const ROUTE_DISTANCE_BUCKETS = ['lt50', '50to100', 'gt100'] as const;   // только в конец
export const RouteDistanceBucket = z.enum(ROUTE_DISTANCE_BUCKETS, { error: fieldError('INVALID') });
export const CATALOG_ROUTE_LIST_MAX_LIMIT = 50;
/** GET /v1/routes?city&distance&surface&cursor&limit — внутри фильтра ИЛИ, между — И; лишние ключи — 400. */
export const CatalogRouteQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(CATALOG_ROUTE_LIST_MAX_LIMIT).default(20),
  cursor: PageCursor.optional(),
  city: queryArray(CityCode, CITY_CODES.length).optional(),
  distance: queryArray(RouteDistanceBucket, ROUTE_DISTANCE_BUCKETS.length).optional(),
  surface: queryArray(Surface, SURFACES.length).optional(),
});
/** Ответ приложения: справочники — tolerantEnum (R6). Без ownerUserId, sha256, status, failure, attempts. */
export const CatalogRouteCard = z.object({
  id: Uuid, title: z.string(), distanceM: z.number().int(), elevationGainM: z.number().int().nullable(),
  isLoop: z.boolean(), city: tolerantEnum(CITY_CODES), surfaces: z.array(tolerantEnum(SURFACES)),
  publishedAt: z.iso.datetime(),
});
export const CatalogRouteDetail = CatalogRouteCard;   // GET /v1/routes/:id — те же поля
export const CatalogRoutePage = z.object({ items: z.array(CatalogRouteCard), nextCursor: z.string().nullable() });
export const CatalogRouteCities = z.object({                // незнакомые коды отбрасываются
  cities: z.array(z.string()).transform((codes) => codes.filter(isCityCode)),
});
/** GET /v1/routes/:id/map — линия показа (≤ 1000), старт, финиш, рамка [w, s, e, n]; без widthM и линии сверки. */
export const RouteMapGeometry = z.object({
  line: z.array(LonLat).min(2).max(RACE_ROUTE_MAX_POINTS), start: LonLat, finish: LonLat,
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export const CatalogRouteRacesQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(RACE_LIST_MAX_LIMIT).default(20),
  cursor: PageCursor.optional(),
});

// packages/contracts/src/routes/route.schema.ts (панель — строгие enum)
export const PublishRouteInput = z.strictObject({ city: CityCode, surfaces: SurfaceList });
export const PanelRouteCatalog = z.object({
  city: z.enum(CITY_CODES), surfaces: z.array(z.enum(SURFACES)), publishedAt: z.iso.datetime(),
});
// PanelRouteSummary: + catalog: PanelRouteCatalog.nullable()
```

Совместимость: все публичные эндпоинты новые (старые сборки их не зовут; новая сборка со старым API — 404: вкладка и
раздел Главной показывают «Не удалось загрузить» с повтором, карточка — «Маршрут недоступен»; деплой API — до сборок).
`PanelRouteSummary.catalog` обязателен — панель деплоится с API; фикстуры тестов панели получают `catalog: null`.
Новые enum-значения (`AUDIT_ACTIONS`, `ErrorCode`) — в конец.

### Данные, миграции, индексы (`pokatim-db.md`)

- `routes.catalog = { city, surfaces, publishedAt } | null` — пишет только `RoutesRepository` (`setCatalog`/
  `clearCatalog`, условие `status: 'ready', origin: 'platform'` в фильтре). Повторная публикация после снятия — новый
  `publishedAt`; правка опубликованного — `publishedAt` прежний (§7). Геометрия, длина, статус — не трогаются.
- Транзакция действия: чтение маршрута с `session` → запись того же документа → `PanelAudit.append` (RC-10); колбэк —
  без логов и побочных эффектов (повторяется). Замков `lockUser`/других документов нет — условие только по самому
  маршруту.
- `0020_routes_catalog`: `routes_catalog_idx` (частичный, запрос каталога обязан содержать
  `'catalog.publishedAt': { $type: 'date' }`), `races_route_idx`, бэкфилл `catalog: null`. Чтение — `?? null`.
- Каталог мал (десятки–сотни): город/покрытие/дистанция — остаточный фильтр по скану индекса в порядке сортировки,
  блокирующей `SORT` нет (проверка `explain`). Отдельные индексы по городу — не v1.

### Ключи query (app)

| Ключ | Хук | Источник | Примечание |
|---|---|---|---|
| `['routes','list',{ city, distance, surface, limit },'pages']` | `useRouteFeed(filters)` | `listCatalogRoutes` | `useInfiniteQuery`, фильтры отсортированы, `staleTime` 60 с, `loadMore` как у гонок |
| `['routes','list',{ limit: 1 }]` | `useLatestRoute()` | `listCatalogRoutes({ limit: 1 })` | Главная, префикс общий с вкладкой |
| `['routes','cities']` | `useRouteCities()` | `listCatalogRouteCities` | чипы «Город» |
| `['routes','detail',id]` | `useCatalogRoute(id, seed, enabled)` | `getCatalogRoute` | посев SSR (`initialData`) |
| `['routes','map',id]` | `useCatalogRouteMap(id, enabled)` | `getCatalogRouteMap` | только клиент; `enabled` — `styleUrl !== null` и есть карточка |
| `['routes','races',id,'pages']` | `useCatalogRouteRaces(id, enabled)` | `listCatalogRouteRaces(id, { limit: 10 })` | только клиент |

Все — публичные, без `withAccessToken`; `retry` — общий `shouldRetry` (404 не повторяется — проверить
`lib/query-client.ts`).

### FILES TO READ

- api: `modules/routes/{routes.service.ts,routes.repository.ts,route-catalog.ts,routes-admin.controller.ts,routes.module.ts}`,
  `modules/races/{races-public.controller.ts,races-public.service.ts,races.repository.ts}`, `src/{page-cursor.ts,
  public-read.guard.ts}`, `db/migrations/{0013_routes.ts,0017_ride_reports.ts,migrations.int.test.ts}`,
  `modules/calendar/calendar-admin.controller.ts` (`POST :id/unpublish`), `test/routes.ts` (`uploadRoute`,
  `readyRoute`), `modules/races/races-public.int.test.ts` (`system.profile`, отдельный IP), `src/admin-routes.test.ts`.
- contracts: `races/{race.schema.ts,race-public.schema.ts,race-route.schema.ts}`, `rides/ride.schema.ts`
  (`RideListQuery`, `RideCities`), `geo/city.schema.ts`, `common.ts` (`queryArray`, `tolerantEnum`).
- app: `features/races/{race-feed.tsx,queries.ts,race-detail.tsx,race-route-map.tsx,format.ts}`,
  `features/calendar/calendar-feed.tsx` (чипы из API, `withinAvailable`), `features/rides/{filters.ts,ride-detail.tsx}`
  (шеринг), `features/maps/*`, `features/home/*`, `src/app/races/[id].tsx`, `src/lib/{public-ssr.ts,page-metadata.ts,
  share-link.ts,filter-chips.ts,minsk-format.ts}`, `components/{race-list-card.tsx,filter-group.tsx,section-hero.tsx}`.
- admin: `features/races/{CorridorField.tsx,routes-query.ts,RacesScreen.tsx}`, `features/calendar/CalendarScreen.tsx`,
  `ui/{DataTable,Dialog,ChipGroup,LinePreview,StatusTag}.tsx`, `navigation.ts`, `router.tsx`.

### TESTS

contracts / api-client (vitest)
- `route-catalog.schema.test.ts`: `CatalogRouteQuery` — одиночная строка → массив; неизвестный город/корзина/покрытие —
  ошибка; лишний ключ — ошибка; `limit` 51 — ошибка; `CatalogRouteCard` — новое покрытие/город → `'unknown'`;
  `CatalogRouteCities` отбрасывает незнакомые; `RouteMapGeometry` — 1 и 1001 точка, рамка из 3 чисел — ошибка; тип:
  `RaceRouteMap` присваивается `RouteMapGeometry` (`expectTypeOf`). `route.schema.test`: `PublishRouteInput` — пустые/
  дублированные покрытия, свободный город, лишний ключ. `race.schema.test` — `RaceInput.surfaces` после выноса прежний.
- api-client: пути и `encodeURIComponent('a/b')`, массивы `city`/`distance`/`surface` в query, без `authorization`,
  404 → `ApiHttpError`; панель — `POST` и `credentials: 'same-origin'`, тело.

api int (реальная MongoDB, изолированные `MONGO_URL_TEST`/`REDIS_URL_TEST`)
- `routes-catalog-admin.int.test.ts`: публикация готового → 200, `catalog` в `PanelRoute` и списке, журнал
  `route.published` (subject route, без координат); правка города → `route.catalog_updated { changedFields: ['city'] }`,
  `publishedAt` прежний; те же значения → 200 без записи журнала; снятие → `route.unpublished`, `catalog: null`;
  снятие неопубликованного → 200 без журнала; повторная публикация → новый `publishedAt`; `processing`/`failed` своего
  → 409 `ROUTE_INVALID_STATE`; чужой необработанный, неизвестный → 404; невалидные тело/город/покрытия → 400;
  модератор (`races.read`) → 403; без сессии → 401; транзакция: сбой `PanelAudit.append` (spy reject) — `catalog` не
  изменился.
- `routes-public.int.test.ts` (свой IP): только опубликованные; порядок `publishedAt desc`; курсор по 2 на 5 элементах —
  без дублей и пропусков (в т. ч. одинаковый `publishedAt` — тай-брейк `_id`); фильтры: город, два города, корзины
  (границы ровно 50 000 и 100 000 — в `50to100`, 49 999 — `lt50`, 100 001 — `gt100`), две корзины, покрытие (хотя бы
  одно), комбинации; мусорный курсор, неизвестная корзина, лишний ключ → 400; `Cache-Control: public, max-age=60`;
  `Object.keys(item).sort()` ровно контрактные; в сериализованном теле нет `ownerUserId`, `sha256`, `status`,
  `failure`, `attempts`, `matchLine`; `GET /routes/cities` → 200 (не 400 pipe), только города опубликованных; карточка и
  `/map` опубликованного → 200 (`/map` — ровно `bounds, finish, line, start`, линия = `route_geometries.line`);
  неопубликованный, снятый (сразу после снятия), `processing`, неизвестный → 404 `NOT_FOUND`; `not-a-uuid` → 400;
  `explain` списка — `IXSCAN routes_catalog_idx` без стадии `SORT`.
- races (`races-corridor.int.test.ts`, describe «гонки маршрута (routes-01)»): опубликованная и отменённая гонка с
  коридором на маршруте каталога → в `RacePage`; черновик с тем же маршрутом — нет; гонка другого маршрута — нет;
  маршрут не в каталоге / снят → 404 (и с мусорным курсором — 404, не 400); курсор `windowStartsAt desc`; ключи
  карточки — `RaceCard`.
- `migrations.int.test.ts`: `0020` — индексы с `partialFilterExpression`, бэкфилл `catalog: null` у документа без поля,
  повторный `up` — без ошибки. `admin-routes.test.ts` — новые маршруты под `PanelGuard` (без правок, сам найдёт).

admin (vitest + RTL)
- `RoutesScreen.test.tsx`: таблица с колонкой «В каталоге»; без `races.manage` — нет действий и загрузки; окно
  публикации: город и покрытие обязательны (ошибки под полями), `POST …/publish` с телом, успех — строка обновлена;
  `409 ROUTE_INVALID_STATE` — текст в окне; «Снять с публикации» — подтверждение → `POST …/unpublish`; загрузка GPX —
  через `RouteUploadDialog`. `RaceEditor.corridor.test.tsx` — зелёный после выноса (RC-15).

app (jest; TZ Europe/Minsk)
- `features/routes/filters.test.ts`, `format.test.ts` (набор `null`, `'unknown'` покрытие/город, км с десятыми).
- `route-list-card.test.tsx`; `route-feed.test.tsx`: скелетон, карточки, пусто без/с фильтрами + сброс, ошибка с
  повтором, ошибка догрузки — баннер в подвале, чипы города из API (до ответа — скелетон группы, ошибка — группы нет),
  ключ запроса меняется при фильтре.
- `route-detail.test.tsx`: данные, «Маршрут недоступен» (404 и невалидный id без запроса), гонки на маршруте (пусто —
  блока нет, «Показать ещё»), шеринг (нет origin — кнопки нет), карта: `RouteMap` получен с `corridor={false}`,
  слоя `corridor` нет (мок `Layer`), подпись a11y без координат, env не задан — карты нет.
- `route-map.web.test.tsx` + native-кейс: `corridor={false}` — `addLayer` без `corridor`; **существующие тесты
  maps-01 — без правок**.
- `sections.test.ts` (routes в реестре и порядке, тег опроса `routes`), тест Главной (раздел, пусто, герой ведёт в
  `/routes/<id>`); SSR: `generateMetadata` `routes/[id]` — найден / 404 (`noindex`) / недоступен (без `robots`), мета без
  ПДн (по образцу тестов `races/[id]`, если есть; иначе — тест `routeShareDescription`).

e2e (`e2e/web.spec.ts`, Playwright)
- Без API: «публичная карточка неизвестного маршрута: HTML 200 (с API — `noindex`), после гидрации — «Маршрут
  недоступен» (без API — «Нет соединения»), гостя не уводит».
- С API (`E2E_API=1`): маршрут фикстуры опубликован через API панели → `/routes/<id>` — `<title>`/OG с названием в HTML
  до JS, без ПДн; после входа вкладка «Маршруты» показывает его.

### Порядок реализации

1. contracts (`SurfaceList`, `route-catalog.schema.ts`, панельные схемы, `AUDIT_ACTIONS`, `ErrorCode`) + тесты.
2. api данные: `RouteDoc.catalog`, `0020_routes_catalog`, методы репозитория, `ROUTE_DISTANCE_RANGES_M`; тест миграции.
3. api панель: `RoutesCatalogAdminService`, `POST :id/publish|unpublish`, `toSummary.catalog`, текст ошибки; int.
4. api публично: `RoutesPublicService`/`Controller` (порядок путей), `PublicReadGuard` в модуле; int + `explain`.
5. api races: `RouteCatalog.inCatalog`, `listPublicByRoute`, `GET routes/:id/races`; int.
6. api-client (+ тесты).
7. admin: перенос `routes-query`, вынос загрузки (RC-15, тесты зелёные), `RoutesScreen`, окно, навигация, i18n.
8. app maps: `corridor?` пропс, `CORRIDOR_LAYER_ID`, `withoutCorridor`, `useMapStyle` + тесты (maps-01 тесты без правок).
9. app routes: queries, filters, format, карточка списка, вкладка, карточка `routes/[id]` (SSR), `_layout`, i18n.
10. Главная: реестр, хук, герой, ветка раздела.
11. e2e, docs (§10), `TURBO_CONCURRENCY=1 pnpm check`; перед PR — `git merge origin/develop` (maps-02, R1).

### OUT OF SCOPE

«Мои маршруты», UGC, модерация; маршрут райда; геокодер, «рядом»; правка названия маршрута (RC-14, follow-up);
карта в панели; перевод `RaceRouteMap`/`race-route-map.tsx` на общие `RouteMapGeometry`/`useMapStyle` (follow-up после
maps-02); `RoutesService.view` без чтения `matchLine` (follow-up: `displayLine`); индексы по городу/покрытию; гостевой
публичный список; засев маршрутов на dev.

## 12. Outcome (заполняет coder)

### Backend (шаги 1–6 §11: contracts, api, api-client) — coder, 2026-10-27

Коммиты: `05f4e0a` контракты · `72e67e4` данные и миграция `0020` · `3387c09` панель publish/unpublish · `bfbbb53`
публичный каталог · `a6da109` гонки маршрута · `f21846f` api-client · `ac5f48f` геометрия через порт.

Сделано:
- contracts: `route-catalog.schema.ts` (`ROUTE_DISTANCE_BUCKETS`, `CatalogRouteQuery/Card/Detail/Page/Cities`,
  `RouteMapGeometry`, `CatalogRouteRacesQuery`), `PublishRouteInput`, `PanelRouteCatalog`, обязательное
  `PanelRouteSummary.catalog`, `SurfaceList` (вынос из `RaceInput`), `ROUTE_INVALID_STATE`, `route.published|unpublished|
  catalog_updated`; `race-route.schema.ts` не тронут, `RaceRouteMap` присваивается `RouteMapGeometry` (тест типов).
- api данные: `RouteDoc.catalog` (новый маршрут — `null`, чтение `?? null`), миграция `0020_routes_catalog`
  (`routes_catalog_idx` частичный, `races_route_idx`, бэкфилл), `RoutesRepository.findPublished|listCatalog|catalogCities|
  setCatalog|clearCatalog`.
- api панель: `POST /v1/admin/routes/:id/publish|unpublish` (`races.manage`) → `RoutesCatalogAdminService`: транзакция
  «чтение → запись → журнал», `route.catalog_updated { changedFields }`, повтор без записи и журнала, не `ready` —
  `409 ROUTE_INVALID_STATE`, не виден — 404; лог после коммита — id маршрута, действие, uid.
- api публично: `RoutesPublicController` (`routes`, `routes/cities` до `routes/:id`, `routes/:id/map`),
  `PublicReadGuard` + `public, max-age=60`, явный список полей, курсор `(publishedAt, _id)`.
- api races: порт `RouteCatalog.inCatalog`, `RacesRepository.listPublicByRoute`, `GET /v1/routes/:id/races`
  (404 до разбора курсора).
- api-client: `listCatalogRoutes`, `listCatalogRouteCities`, `getCatalogRoute`, `getCatalogRouteMap`,
  `listCatalogRouteRaces`; панель — `publishRoute`, `unpublishRoute`.

Тесты: `route-catalog.schema.test.ts`, дополнены `route.schema.test.ts`, `race.schema.test.ts`, `common.test.ts`,
`audit.schema.test.ts`; int `routes-catalog-admin.int.test.ts` (7), `routes-public.int.test.ts` (9, в т. ч. `explain`
через `system.profile`), `races-corridor.int.test.ts` «гонки маршрута (routes-01)» (2), `migrations.int.test.ts`
(`0020`); `api-client/src/routes.test.ts` (4).

Проверка: `TURBO_CONCURRENCY=1 pnpm check` (`MONGO_URL_TEST=…/pokatim_routes_test`, `REDIS_URL_TEST=…:6479/12`) → exit 0:

```
$ pnpm format:check && pnpm lint && pnpm arch:check && pnpm typecheck && pnpm test
All matched files use Prettier code style!
@pokatim/contracts:test:       Tests  236 passed (236)
@pokatim/api-client:test:       Tests  80 passed (80)
@pokatim/api:test:       Tests  981 passed (981)
@pokatim/admin:test:       Tests  223 passed (223)
@pokatim/app:test: Tests:       924 passed, 924 total
 Tasks:    13 successful, 13 total
```

Не сделано в этой части (по поручению): admin, app, e2e, docs §10 — следующая часть (шаги 7–11).

### Frontend (шаги 7–11 §11: admin, app maps, app routes, Главная, e2e, docs) — coder, 2026-10-27

Коммиты: `6fa71e7` панель · `cd0ac66` карта (`corridor?`) · `72a5487` вкладка и карточка `/routes/<id>` · `9660104`
Главная · `5b5d334` документация · `5c8433c` e2e-смоук.

Сделано:
- admin: `routes-query.ts` перенесён в `features/routes/` (+ `routesPagesQuery`); загрузка GPX — `useRouteUpload` +
  `RouteUploadDialog`, превью — `RoutePreview` (RC-15, DEV-6), `CorridorField` на них без смены поведения
  (`RaceEditor.corridor.test.tsx` без правок, зелёный); экран «Маршруты» (`/routes`, `races.read`): таблица с
  «В каталоге», «Загрузить GPX» и действия только с `races.manage` и только у `ready`; `RouteCatalogDialog` (линия +
  предупреждение RC-11, город — справочник по алфавиту, покрытие — чипы, react-hook-form + zod контракта, ошибки
  сервера под полями, `409 ROUTE_INVALID_STATE` — баннер), «Снять с публикации» — подтверждение; пункт навигации
  после «Календаря».
- app maps: `RouteMap.corridor?` (по умолчанию `true`, native и web — фильтр слоя `CORRIDOR_LAYER_ID`),
  `withoutCorridor`, `useMapStyle`; существующие пропсы, `RaceRouteMap`, `race-route-map.tsx`, тесты maps-01 — без
  изменений.
- app routes: `features/routes/{filters,format,queries,route-feed,route-detail,catalog-route-map}`,
  `components/route-list-card.tsx`, вкладка `(tabs)/routes.tsx` (вместо заглушки), карточка `routes/[id].tsx` (SSR,
  `generateMetadata`: найден / 404 `noindex` / недоступен), `Stack.Screen` вне `Stack.Protected`.
- Главная: `routes` в `AVAILABLE_HOME_SECTIONS` (между райдами и календарём), `useLatestRoute`, текстовый `RouteHero`
  (RC-8), пусто — «Маршрутов пока нет».
- i18n: `routes.*`, `home.routes.*`, `admin.routes.*` (дополнен), `admin.nav.routes` (DEV-8).
- e2e: без API — неизвестный маршрут (HTML 200, «Маршрут недоступен» / «Нет соединения», гостя не уводит); с API —
  `publishCatalogRoute` (фикстура через API панели) → SSR/OG без ПДн → вкладка после входа → карточка; снятие в `finally`.
- docs: `docs/product/routes.md` (новый), `docs/product/{README,home}.md`, эпик race-results §3.1, правила
  `pokatim-{security,app,backend,db,contracts,web}.md`.

Тесты: admin `RoutesScreen.test.tsx` (8); app `filters.test.ts`, `format.test.ts`, `route-list-card.test.tsx`,
`routes.test.tsx` (9), `route-detail.test.tsx` (8, в т. ч. слои `route/start/finish` без `corridor`, env не задан —
без карты и запроса), `route-metadata.test.ts` (4), `route-map-corridor.web.test.tsx` (2), `home.test.tsx` (+3),
`sections.test.ts` (обновлён, DEV-7).

Проверки:
- `TURBO_CONCURRENCY=1 pnpm check` (`MONGO_URL_TEST=…/pokatim_routes_test`, `REDIS_URL_TEST=…:6479/12`) → exit 0:

```
$ pnpm format:check && pnpm lint && pnpm arch:check && pnpm typecheck && pnpm test
All matched files use Prettier code style!
✔ no dependency violations found (1056 modules, 3785 dependencies cruised)
 Tasks:    8 successful, 8 total
@pokatim/contracts:test:       Tests  236 passed (236)
@pokatim/api-client:test:       Tests  80 passed (80)
@pokatim/api:test:       Tests  981 passed (981)
@pokatim/admin:test:       Tests  231 passed (231)
@pokatim/app:test: Tests:       959 passed, 959 total
 Tasks:    13 successful, 13 total
```

- `EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 pnpm build:web && pnpm build:web:dev && playwright test -g
  "маршрут|Главная без входа|неизвестной гонки"` (без API) → `3 passed, 1 skipped` (шаг с API пропущен).
- NOT VERIFIED: e2e с API (`E2E_API=1`, шаг «Маршруты (routes-01)») — нужен поднятый API/worker/mailpit смоука на
  общей БД стенда; `pnpm e2e:admin`; ручная проверка на симуляторе iOS/Android и в браузере с картой (env стиля).
- `git merge origin/develop` перед прогоном — «Already up to date» (DEV-9).
