# maps-01 — карта маршрута с коридором на карточке гонки

Уровень: task3. Ветка `feature/maps-route-corridor` от `origin/develop`. ADR: [0014](../../adr/0014-maps-and-tiles.md)
(Accepted 2026-10-27, провайдер — OpenFreeMap, выбор пользователя).

## 1. Title

Первый слайс карт: публичная геометрия маршрута гонки и карта MapLibre с коридором на `races/[id]`.

## 2. Goal

Райдер и гость видят на карточке гонки, где проходит маршрут и какой ширины коридор, а не только строку «±N м».
Эпик результатов (`docs/tasks/2026-10-27-race-results/epic.md` §7) вынес карту в отдельное решение — ADR-0014.

## 3. Scope

- **contracts:** схема `RaceRouteMap` (линия показа `[lon, lat][]`, `start`, `finish`, `bounds`, `widthM`).
- **api (`races`, `routes`):** `GET /v1/races/:id/route` в `RacesPublicController` — `PublicReadGuard`,
  `PUBLIC_READ_CACHE_CONTROL`; гонка видима публично (опубликованная/отменённая, как `GET /v1/races/:id`), есть
  `corridor`, маршрут `ready` — иначе `404` (один код, как у карточки). Линию и точки даёт новый метод порта
  `routes` (`RouteCatalog.displayGeometry` или отдельный порт — решает architect), с кэшем в процессе (готовый маршрут
  неизменяем). В ответе — только перечисленные поля: без `routeId`, `title`, `matchLine`, `sha256`, статуса.
- **api-client:** метод `raceRoute(id)`.
- **app:** компонент карты `features/maps/` (native — `@maplibre/maplibre-react-native` 11, web — `maplibre-gl` 6 в
  `*.web.tsx`, динамический `import()` после монтирования). На карточке `races/[id]` при `race.corridor` — блок карты
  отдельным компонентом (`race-route-map.tsx`): коридор (линия шириной 2 × `widthM` в метрах через выражение зума,
  цвет `map.corridor` с прозрачностью), осевая линия (`map.route`), старт и финиш (круги + подписи в a11y), камера по
  `bounds` с отступом, стиль по теме приложения (`EXPO_PUBLIC_MAP_STYLE_LIGHT/DARK`), атрибуция. Запрос — клиентский
  `useQuery(['races','route',id])`, в SSR не попадает.
- **Состояния:** загрузка (место фиксированной высоты, скелетон), ошибка геометрии (тихо: блок не показывается,
  текстовая строка коридора остаётся), ошибка тайлов/стиля (сообщение «Карта не загрузилась» + линия поверх пустого
  фона, если возможно; минимум — сообщение), env не задан — карты нет.
- **Доступность:** карта — `accessible` изображение с подписью-альтернативой («Маршрут N км, коридор ±M м, старт
  и финиш …» — без координат), жесты карты не единственный носитель информации (текстовые строки карточки
  остаются); reduce motion — камера без анимации (`animationDuration: 0`), иначе плавный fit тоже не нужен — fit
  сразу. Карта в скролле карточки — без перехвата вертикального скролла: интерактив (pan/zoom) выключен,
  статичный вид маршрута (v1).
- **app.json:** config plugin `@maplibre/maplibre-react-native`; `.env.example` — URL стилей OpenFreeMap.
- **Jest:** мок нативного модуля MapLibre и `maplibre-gl` (jsdom без WebGL).
- **docs:** ADR-0014, правила `pokatim-app.md` (карта), `pokatim-security.md` (публично теперь линия маршрута гонки с
  коридором), `pokatim-backend.md`, runbook `local-dev.md` (env, dev-сборка), `docs/adr/README.md`.

## 4. Out of Scope

- Свой трек участника и подсветка участков вне коридора → следующий слайс (§8.2, D1).
- Карта в панели (CSP панели), «рядом» для райдов, геокодер, офлайн-тайлы, интерактивная карта на весь экран.
- SSR-мета и OG-картинка с картой.
- Нативная dev-сборка и смоук на устройстве — не в CI (D2).

## 5. Architecture Context

- api: `races` (публичный контроллер/сервис) → `routes` только через `modules/routes/index.ts`; `routes` о гонках не
  знает. Миграций и индексов нет (чтение `route_geometries` по `_id`, `routes` по `_id`).
- contracts: новая схема, старые клиенты не затронуты (новый эндпоинт).
- Очередей и outbox нет.
- app: новый feature-модуль `features/maps/` (переиспользуемый компонент карты), блок на `race-detail.tsx`.

## 5.1 Placement & Reuse Gate

- Reuse: `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`, видимость публичной гонки из `RacesPublicService.get`
  (не второй фильтр статусов), порт-паттерн `RouteGeometry` (кэш в процессе), `Bounds` из `@pokatim/tracks`, роли
  темы `map.*` (`@pokatim/design-tokens`), `useTheme`/тема приложения, `usePrefersReducedMotion` (если есть —
  найти), i18n `@pokatim/i18n`, `apiClient` и ключи query карточки.
- Запрещено: чтение коллекций `routes` из `races`; свой `fetch` в экране; координаты в логах; хардкод URL тайлов в
  коде (только env); второй SVG-рендер линии в приложении.
- Тонкий контроллер, логика — в `RacesPublicService`.

## 6. Relevant Files

- `apps/api/src/modules/races/races-public.controller.ts`, `races-public.service.ts`, `races-public.int.test.ts`
- `apps/api/src/modules/routes/index.ts`, `route-catalog.port.ts` / `route-geometry.port.ts`, `route-catalog.ts`,
  `routes.repository.ts`
- `packages/contracts/src/races/*` — схема ответа
- `packages/api-client/src/*` — метод
- `apps/app/src/features/races/race-detail.tsx`, `queries.ts`
- `apps/app/app.json`, `apps/app/.env.example`, `apps/app/jest.setup.ts`
- `packages/design-tokens/src/brand.ts` — роли `map.*`
- `packages/i18n` — строки `races.detail.map.*`

## 7. Implementation Notes

- Ширина коридора в пикселях: метров на пиксель в MapLibre (тайлы 512) = `78271.517 × cos(lat) / 2^zoom`;
  `line-width` = `interpolate exponential 2` по `zoom` с опорами `[0, 2w/mpp(0)]`, `[22, 2w/mpp(22)]`, широта —
  центр `bounds`. Чистая функция в `features/maps/corridor-style.ts` с unit-тестом.
- Native: `<Map>` (v11 API — сверить имена компонентов `Camera`, `GeoJSONSource`, `Layer` по документации 11.x в
  `node_modules`), `attribution` включена. Web: `new maplibregl.Map({ container, style, interactive: false,
  attributionControl: { compact: true } })`, источник GeoJSON + слои после `load`, `map.remove()` при размонтировании,
  `error` стиля/тайлов → состояние ошибки.
- Тема — смена стиля при смене темы (web — `setStyle` + повторное добавление слоёв или пересоздание карты).
- Высота блока — фиксированная (≈ 220), без сдвига вёрстки.
- `EXPO_PUBLIC_*` — только прямое обращение `process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT` (Metro подставляет).

## 8. Risks / Assumptions / Open Questions

- R1: Expo SDK 58 / RN 0.88 — peer `@maplibre/maplibre-react-native` 11.5 (`expo ≥ 54`, `react-native ≥ 0.80`,
  только новая архитектура) удовлетворён; нативная сборка локально не проверяется (диск, нет EAS-сборки в CI).
- R2: OpenFreeMap без SLA — ошибка тайлов не ломает карточку (ADR-0014).
- R3: публичность линии маршрута — допустимо: маршрут опубликованной гонки и так нужно проехать; правило
  `pokatim-security.md` («координаты не выходят») меняется этой задачей.
- A1: размер ответа ≤ 1000 точек × 2 числа — ≈ 25–40 КБ JSON, приемлемо с кэшем 60 с.

## 8.1 Requirements Consistency (заполняет architect)

Architecture Review — maps-01-route-corridor: **CONCERNS** (блокеров нет; RC-1 и RC-5 — решения по умолчанию ниже,
человек может переиграть до начала coder).

- **RC-1 · env стилей не доходит до web на dev/prod (недоопределённость, влияет на AC5/AC7).** Клиентский бандл web
  получает `EXPO_PUBLIC_*` только на сборке (`infra/docker/Dockerfile`, стадия `build-web`, `ARG EXPO_PUBLIC_API_URL`;
  `deploy-dev.yml` → `build-args`), а серверный бандл SSR читает `process.env.EXPO_PUBLIC_*` процесса во время запроса
  (`.env.example`, `infra/deploy/docker-compose.yml` → `web.environment`). Без правки инфраструктуры карта на dev EC2
  не появится; при разном env у сервера и клиента — рассинхрон гидрации.
  Альтернативы: (a) добавить необязательные `ARG EXPO_PUBLIC_MAP_STYLE_LIGHT/DARK` в `build-web` (без `test -n`: нет —
  карты нет) и `build-args` в `deploy-dev.yml` с URL OpenFreeMap (значения публичные, не секреты); (b) web без карты
  до отдельной infra-задачи; (c) URL стилей в коде по умолчанию — нарушает ADR-0014 п. 1.
  **Рекомендация: (a)** + решение RC-2 (рендер не зависит от env до монтирования), правка CI/infra — явно в `pr.md`
  (AGENTS.md §6). Runtime-env web-контейнера не нужен при RC-2.
- **RC-2 · SSR/гидрация и «без сдвига вёрстки».** Решение «есть ли карта» по env и по запросу геометрии нельзя
  принимать в SSR (серверный env ≠ клиентский, запрос — только клиентский). Правило: при `race.corridor` и SSR, и
  первый клиентский рендер отдают **место карты фиксированной высоты** (скелетон); после монтирования: env не задан
  или геометрия 404/ошибка — блок схлопывается (тихо, AC7); иначе — карта. Схлопывание после монтирования — принятый
  сдвиг только в деградированных случаях.
- **RC-3 · код ошибки.** `RACE_NOT_FOUND` в контракте нет; карточка отдаёт базовый `404 NOT_FOUND`
  (`domainError('NOT_FOUND', 404)`). Решение: **`NOT_FOUND`**, новых кодов нет (AC2 — «код карточки»).
- **RC-4 · reduce motion.** Требование противоречиво само («без анимации», «иначе плавный fit тоже не нужен»). Решение:
  камера **никогда** не анимируется — native `Camera initialViewState={{ bounds, padding }}`, web — `bounds` +
  `fitBoundsOptions` в конструкторе `Map` (или `fitBounds(..., { animate: false })`). `useReducedMotion` (есть в
  `@rkarakulov/ui`) не нужен; AC8 проверяется тестом «анимации нет» (нет `animationDuration`/`duration > 0`).
- **RC-5 · токены, которых нет (инвариант §4.11).** Высоты карты (≈220), прозрачности коридора, радиуса кругов
  старта/финиша и ролей цвета старта/финиша в дизайн-системе нет; ESLint ловит только hex/`color.*`.
  Альтернативы: (a) высота — `aspectRatio` контейнера (раскладка, не px; ширина известна CSS — без сдвига), радиус —
  `size.iconSm / 2`, обводка — `stroke.indicator`, линия маршрута — `stroke.indicator`; старт — заливка `map.route` +
  обводка `map.background`, финиш — заливка `map.background` + обводка `map.route` (различимы без цвета);
  прозрачность коридора — одна именованная константа `CORRIDOR_OPACITY` в `features/maps/corridor-style.ts` с
  комментарием; (b) новые токены `size.mapPreview`, `opacity.*` и роли `map.start/finish` задачей и релизом
  app-foundation до этой задачи; (c) px-литералы по месту — запрещено.
  **Рекомендация: (a)** в этом слайсе, follow-up — токены карты в app-foundation (вместе с maps-02).
- **RC-6 · interactive: false vs атрибуция на native.** Перехват скролла гасится пропсами `Map` (`dragPan`,
  `touchZoom`, `doubleTapZoom`, `doubleTapHoldZoom`, `touchRotate`, `touchPitch` = `false`), **не**
  `pointerEvents="none"`: иначе кнопка атрибуции (ADR-0014 п. 3) не нажимается. Риск (Android, вложенный
  `ScrollView`) — в смоук dev-клиента (D2).
- **RC-7 · порт.** Новый метод — в `RouteGeometry` (порт геометрии с кэшем), не в `RouteCatalog` (каталог —
  названия/длины для правки гонки). Кэш показа — **отдельный** LRU от кэша линии сверки: текущий `cached()` тянет
  `matchLine` (≤ 20 000 точек ≈ 1 МБ) — в API-процессе для показа это лишняя память. Чтение `route_geometries` — с
  проекцией без `matchLine`.
- **RC-8 · вес PWA.** Чанк `maplibre-gl` (~800 КБ) хеширован и попадёт в precache service worker
  (`scripts/service-worker.ts`, `HASHED`) — скачивается всем при установке PWA, а не только на карточке гонки.
  Решение по умолчанию: принять в этом слайсе (кэш статики не влияет на корректность), отметить в `pr.md`;
  исключение из precache — follow-up при жалобах на трафик.
- **RC-9 · имя метода api-client.** Конвенция пакета — `getRace`, `getRaceResults`; в scope — `raceRoute(id)`.
  Решение: **`getRaceRoute(id)`** (конвенция важнее формулировки scope).
- **RC-10 · peer `@types/geojson`.** У `@maplibre/maplibre-react-native@11.5.0` peer `@types/geojson ^7946` — добавить в
  `devDependencies` приложения (иначе typecheck типов `GeoJSONSource`).

## 8.2 Deviations from spec

- D1 · Свой трек участника с подсветкой вне коридора не делаем · в API нет посегментных данных вне коридора (у
  попытки только агрегаты `offCorridorM/Share`, `maxExcursionM`), а считать подсветку на клиенте — второй источник
  истины рядом с `matchCorridor` сервера · решение автора 2026-10-27 · следующий слайс maps-02: worker при сверке
  пишет интервалы вне коридора (индексы упрощённой линии `activity_tracks`), авторизованное чтение своей попытки.
- D2 · Нативная карта проверяется jest-моком, без dev-сборки и устройства · см. R1 · follow-up: смоук на dev-клиенте.

- D3 · Воркер `maplibre-gl` 6 — свой файл на origin приложения · библиотека ищет воркер по `import.meta.url`, в бандле
  Metro его нет (`globalThis.__ExpoImportMetaRegistry`) → без `setWorkerUrl` карта на web не поднимется. Решение:
  `scripts/copy-map-worker.ts` копирует `maplibre-gl/dist/maplibre-gl-worker.mjs` в `apps/app/public/` (gitignore,
  prettier/eslint ignore) в скриптах `dev`, `build:web`, `build:web:dev`; карта — `setWorkerUrl('/maplibre-gl-worker.mjs?v=<версия>')`.
  Файл без хеша — вне precache SW · coder 2026-10-26 (решение реализации, вынесено оркестратору) · —.
- D4 · Web-тест карты мокает точку загрузки `features/maps/load-maplibre.ts`, а не `maplibre-gl` · jest-expo не
  транспилирует динамический `import()` (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`); маршрут импорта проверен
  сборкой `build:web` (отдельный чанк) · coder 2026-10-26 · —.
- D5 · Кейсы карточки — отдельный файл `src/__tests__/race-route-map.test.tsx`, не `race-detail.test.tsx` ·
  параллельные сессии правят тест и экран карточки — меньше конфликтов · coder 2026-10-26 · —.
- D6 · Типы спецификаций слоёв — `@maplibre/maplibre-gl-style-spec@26.2.1` в devDependencies (версия зависимости
  `@maplibre/maplibre-react-native` 11.5.0): `maplibre-gl` их не экспортирует, иначе — транзитивный импорт · coder
  2026-10-26 · —.

## 8.3 Security checklist

- AuthN/AuthZ: публичный эндпоинт без входа; видимость — как у `GET /v1/races/:id` (черновик и неизвестный — 404).
- Входные данные: `:id` — `Uuid` pipe.
- Данные наружу: только линия показа, старт, финиш, рамка, `widthM`; без `routeId`, названия файла, линии сверки,
  sha256, владельца. Линия показа становится публичной (R3).
- Злоупотребления: `PublicReadGuard` (`public-read`), кэш `public, max-age=60`, ответ ограничен 1000 точками.
- Секреты и логи: ключа тайлов нет (OpenFreeMap); env публичный; логи без координат.
- Аудит: не требуется (чтение).

## 9. Acceptance Criteria

1. `GET /v1/races/:id/route` опубликованной гонки с коридором и готовым маршрутом — 200, схема `RaceRouteMap`,
   `Cache-Control: public, max-age=60`, ключи ответа — ровно `line, start, finish, bounds, widthM`.
2. Черновик, неизвестный id, гонка без коридора — 404 `RACE_NOT_FOUND` (или код карточки); невалидный id — 400.
3. Нет `routeId`/`matchLine`/служебных полей в ответе (int-тест на ключи).
4. Карточка гонки с коридором показывает карту: коридор, осевая линия, старт и финиш; без коридора — блока нет.
5. Тема карты следует теме приложения; атрибуция видна.
6. Карта имеет текстовую альтернативу (a11y-подпись); строки «Коридор» и дистанция остаются.
7. Ошибка геометрии — блока нет, карточка работает; ошибка стиля/тайлов — сообщение; env не задан — блока нет.
8. Reduce motion — камера без анимации.
9. SSR web: серверный рендер `races/[id]` не импортирует `maplibre-gl` и не падает (тест/сборка `build:web`).
10. `TURBO_CONCURRENCY=1 pnpm check` зелёный.

## 10. Documentation Impact

ADR-0014 + реестр; `.claude/rules/pokatim-app.md` (карта), `pokatim-security.md` (публичная линия),
`pokatim-backend.md` (эндпоинт, порт); `docs/runbooks/local-dev.md` (env стилей, dev-сборка для native).

Дополнение architect: `pokatim-contracts.md` (`RaceRouteMap`, `src/races/race-route.schema.ts`); в `pokatim-security.md`
раздел «Загрузка маршрутов» — заменить «Публично — только `corridor.widthM`: `routeId` и координаты не выходят» на
исключение для линии показа через `GET /v1/races/:id/route`; в `pokatim-app.md` — убрать «Карт и линии маршрута в
приложении нет», описать `features/maps/`, RC-2 (место карты до монтирования), env; комментарии `Dockerfile`/`deploy-dev.yml`
(RC-1); `pr.md` — env, infra, precache (RC-8).

## 11. Implementation Context (заполняет architect)

Сверено по коду ветки и `npm view @maplibre/maplibre-react-native@11.5.0` + типы 11.5.0 (unpkg), 2026-10-26.

### ENTRY POINTS

- API: `GET /v1/races/:id/route` → `RacesPublicController.route(id)` → `RacesPublicService.route(id)`.
- App: `RaceDetailBody` в `apps/app/src/features/races/race-detail.tsx` → `<RaceRouteMap race={race} />` сразу после
  строки «Коридор» (внутри `{corridor ? … : null}`).

### FILES TO MODIFY / CREATE

contracts / api-client
- `packages/contracts/src/races/race-route.schema.ts` (новый) + экспорт в `src/index.ts`; тест
  `race-route.schema.test.ts`.
- `packages/api-client/src/index.ts` — `getRaceRoute: (id: string) => getPublic(\`/v1/races/${encodeURIComponent(id)}/route\`, RaceRouteMap)`
  в блоке «read-модель гонок»; тест — в `packages/api-client/src/races.test.ts` (путь, `encodeURIComponent`, без
  `authorization`, 404 → `ApiHttpError`).

api
- `apps/api/src/modules/routes/route-geometry.port.ts` — тип `RouteDisplayGeometry` и метод
  `displayGeometry(routeId: string): Promise<RouteDisplayGeometry | null>` (только `ready`; иначе `null`); комментарий
  порта: потребители `results` и `races`.
- `apps/api/src/modules/routes/routes.repository.ts` — `displayLine(id: string): Promise<[number, number][] | undefined>`:
  `geometries.findOne({ _id: id }, { projection: { line: 1 } })` (без `matchLine`).
- `apps/api/src/modules/routes/route-catalog.ts` — реализация `displayGeometry`: `findReady` (start/finish из
  `RouteDoc`, `null` при отсутствии) + `displayLine` + `boundsOf`; **отдельный** LRU `displayCache` (напр. 256 записей,
  ≈ 25 КБ каждая); существующий `cached()` (match) не трогать.
- `apps/api/src/modules/routes/index.ts` — экспорт типа `RouteDisplayGeometry`.
- `apps/api/src/modules/races/races-public.service.ts` — инжект `@Inject(ROUTE_GEOMETRY) routes: RouteGeometry`
  (импорт из `'../routes'`); метод `route(id): Promise<RaceRouteMap>`; общий приватный `publicRace(id): Promise<RaceDoc>`
  (`repository.findPublic` + `domainError('NOT_FOUND', 404)`) — его же использует `get()` (одна точка видимости, без
  второго фильтра статусов). Нет `corridor` или `displayGeometry` → `null` — тот же `404 NOT_FOUND`. Ответ — явный
  объект `{ line, start, finish, bounds, widthM: race.corridor.widthM }`.
- `apps/api/src/modules/races/races-public.controller.ts` — `@Get('races/:id/route')`,
  `@Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)`, `Uuid` pipe с `FieldErrorCode` (как `get`). Guard — уже на
  классе. `races.module.ts` не меняется (`RoutesCoreModule` уже импортирован и экспортирует `ROUTE_GEOMETRY`).

app
- `apps/app/package.json` — `@maplibre/maplibre-react-native@11.5.x`, `maplibre-gl@^6.16`, dev `@types/geojson`.
- `apps/app/app.json` — в `plugins` `"@maplibre/maplibre-react-native"` (опции `MapLibrePluginProps` не нужны).
- `apps/app/.env.example` — закомментированные `EXPO_PUBLIC_MAP_STYLE_LIGHT=https://tiles.openfreemap.org/styles/positron`,
  `EXPO_PUBLIC_MAP_STYLE_DARK=https://tiles.openfreemap.org/styles/dark` (без них карты нет).
- `apps/app/src/features/maps/map-style.ts` — `mapStyleUrl(dark: boolean): string | null` (только прямые
  `process.env.EXPO_PUBLIC_MAP_STYLE_LIGHT/DARK`; пустая строка = не задан).
- `apps/app/src/features/maps/corridor-style.ts` — чистые функции и константы для обеих платформ:
  `metersPerPixel(lat: number, zoom: number): number` (`78271.517 * cos(lat) / 2 ** zoom`),
  `corridorLineWidth(widthM: number, lat: number)` → выражение
  `['interpolate', ['exponential', 2], ['zoom'], 0, 2*w/mpp(0), 22, 2*w/mpp(22)]`, `centerLat(bounds: Bounds)`,
  `routeLayers(theme: AppTheme, widthM, bounds)` → массив спецификаций слоёв (`id`, `type`, `paint`, `layout`) —
  `corridor` (line, `map.corridor`, `CORRIDOR_OPACITY`, `line-cap/join: round`), `route` (line, `map.route`,
  `stroke.indicator`), `start`/`finish` (circle, см. RC-5), `routeFeatures(map: RaceRouteMap)` → GeoJSON
  `FeatureCollection` (LineString + 2 Point с `properties.kind`). Один источник стиля для native и web.
- `apps/app/src/features/maps/route-map.tsx` (native) и `route-map.web.tsx` (web) — одинаковый API:
  `RouteMap(props: { map: RaceRouteMap; styleUrl: string; theme: AppTheme; accessibilityLabel: string; onError(): void })`.
  - native (v11 API, проверено по типам 11.5.0): `import { Map, Camera, GeoJSONSource, Layer } from '@maplibre/maplibre-react-native'`;
    `<Map mapStyle={styleUrl} attribution logo={false} compass={false} scaleBar={false} dragPan={false}
    touchZoom={false} doubleTapZoom={false} doubleTapHoldZoom={false} touchRotate={false} touchPitch={false}
    onDidFailLoadingMap={onError}>`; `<Camera initialViewState={{ bounds: map.bounds, padding }} />` (`LngLatBounds` =
    `[west, south, east, north]` = `Bounds`); `<GeoJSONSource id="race-route" data={features}>` +
    `<Layer {...spec} />` для каждого слоя (Layer v11 принимает style-spec `paint`/`layout`; `ShapeSource`,
    `LineLayer`, `CircleLayer`, `MapView`, `styleURL` — API v10, в v11 нет). Смена темы — новый `mapStyle`, слои-дети
    библиотека добавляет заново.
  - web: `useEffect` → `const { Map } = await import('maplibre-gl')` (+ CSS `maplibre-gl/dist/maplibre-gl.css` — тем
    же динамическим импортом, если Metro web это поддерживает; иначе статический импорт CSS — проверить, что в первый
    чанк попадает только CSS, не JS); `new Map({ container, style: styleUrl, interactive: false,
    attributionControl: { compact: true }, bounds: map.bounds, fitBoundsOptions: { padding } })`; на `load` —
    `addSource` + `addLayer(spec)`; `on('error')` → `onError`; cleanup — `map.remove()` и флаг отмены, если
    размонтировали до резолва импорта. Смена темы — пересоздание карты (зависимость эффекта `styleUrl`).
  - Обёртка: `View` с `accessible`, `accessibilityRole="image"`, `accessibilityLabel`; фон — `theme.map.background`;
    высота — `aspectRatio` (RC-5).
- `apps/app/src/features/races/race-route-map.tsx` — `RaceRouteMap({ race }: { race: RaceDetail })`: возвращает `null`
  без `race.corridor`; `mounted` (после монтирования) → `styleUrl = mapStyleUrl(useTheme<AppTheme>() === themes.dark)`
  (тема: `useTheme` из `@rkarakulov/ui` + `themes` из `@pokatim/design-tokens` — тот же объект, что передан в
  `configureDesignSystem`; `useColorScheme` база не экспортирует); до монтирования и при `isPending` — скелетон
  места (`Skeleton*` базы, та же высота); `isError` или `styleUrl === null` после монтирования — `null`; ошибка стиля/тайлов
  (`onError`) — `Banner`/текст «Карта не загрузилась» поверх фона `map.background` (линию поверх пустого фона не
  обещаем на native — минимум сообщение).
- `apps/app/src/features/races/queries.ts` — `useRaceRoute(id: string, enabled: boolean)`: ключ
  `['races','route',id]`, `api.getRaceRoute(id)`, `staleTime: PUBLIC_STALE_MS`, `retry: false` для 404 (как другие
  публичные 404 — проверить `query-client.ts`); `enabled = mounted && Boolean(race.corridor) && styleUrl !== null`.
  Pull-to-refresh карточки ключ не инвалидирует (геометрия неизменна).
- `apps/app/jest.setup.ts` — `jest.mock('@maplibre/maplibre-react-native', …)`: `Map`, `Camera`, `GeoJSONSource`,
  `Layer` — простые компоненты (`View`), пропсы доступны тестам (`testID`/`UNSAFE_getByType`).
- `packages/i18n/src/ru.ts` — после `races.detail.distanceByRoute`: `races.detail.map.label`
  («Карта маршрута: {distance}, коридор ±{width} м от маршрута, старт и финиш отмечены»), `races.detail.map.failed`
  («Карта не загрузилась»). Без координат.
- Infra (RC-1, решение (a)): `infra/docker/Dockerfile` (`build-web`: необязательные `ARG EXPO_PUBLIC_MAP_STYLE_LIGHT/DARK`,
  проброс в `build:web`), `.github/workflows/deploy-dev.yml` (`build-args` — URL OpenFreeMap). В `pr.md` — явно.
- Docs — §10.

### FILES TO READ

- `apps/api/src/modules/races/races-public.{controller,service}.ts`, `races.repository.ts` (`findPublic`),
  `apps/api/src/public-read.guard.ts`, `apps/api/src/modules/routes/{route-catalog.ts,route-geometry.port.ts,routes.repository.ts,routes.collection.ts,routes.module.ts}`.
- `apps/api/src/modules/races/races-corridor.int.test.ts` (сценарий «публичная карточка», `readyRoute`),
  `apps/api/test/routes.ts`, `apps/api/src/modules/races/races-public.int.test.ts` (`get` с отдельным IP).
- `packages/contracts/src/races/race-public.schema.ts`, `packages/api-client/src/index.ts` (`getPublic`),
  `packages/tracks/src/geo.ts` (`Bounds`, `boundsOf`).
- `apps/app/src/features/races/{race-detail.tsx,queries.ts}`, `apps/app/src/app/races/[id].tsx`,
  `apps/app/src/lib/{public-ssr.ts,query-client.ts,share-link.ts}` (образец env), `apps/app/jest.{config.js,setup.ts,setup.web.ts}`,
  `apps/app/src/__tests__/race-detail.test.tsx`, `apps/app/scripts/service-worker.ts`,
  `node_modules/@rkarakulov/ui/dist/{index.d.ts,theme/theme.d.ts,theme/color-scheme.web.js}`,
  `packages/design-tokens/src/brand.ts` (`map.*`), `apps/admin/src/ui/LinePreview.tsx` (не дублировать).
- Типы библиотеки после установки: `node_modules/@maplibre/maplibre-react-native/lib/typescript/module/components/{map/Map,camera/Camera,sources/geojson-source/GeoJSONSource,layer/Layer}.d.ts`.

### TYPES & SCHEMAS

```ts
// packages/contracts/src/races/race-route.schema.ts
export const LonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
/** GET /v1/races/:id/route — линия показа коридора гонки (ADR-0014): публичная, без routeId/matchLine/sha256. */
export const RaceRouteMap = z.object({
  line: z.array(LonLat).min(2).max(1000),
  start: LonLat,
  finish: LonLat,
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]), // [west, south, east, north]
  widthM: z.number().positive(),
});
export type RaceRouteMap = z.infer<typeof RaceRouteMap>;

// apps/api/src/modules/routes/route-geometry.port.ts
export interface RouteDisplayGeometry {
  line: [number, number][]; start: [number, number]; finish: [number, number]; bounds: Bounds;
}
```

Ответ — `z.object` (не strict, как прочие ответы); «ровно 5 ключей» держит сервис и int-тест. Совместимость: новый
эндпоинт; новая сборка + старый API → 404 → блок скрыт; старая сборка эндпоинт не зовёт.

### TESTS

- contracts (vitest): валидный ответ; `line` 1 точка / 1001 точка, широта 91, `bounds` из 3 чисел — ошибка.
- api-client (vitest): путь, `encodeURIComponent('a/b')`, без `authorization`, разбор ответа, 404 → `{ status: 404 }`.
- api int (реальная MongoDB, `races-corridor.int.test.ts`, describe «карта маршрута (maps-01)»): опубликованная с
  коридором → 200, `RaceRouteMap.parse`, `Object.keys(body).sort()` = `['bounds','finish','line','start','widthM']`,
  `Cache-Control: public, max-age=60`, `line` = `route_geometries.line` маршрута, `widthM` из гонки; отменённая с
  коридором → 200; черновик с коридором, неизвестный id, опубликованная без коридора, коридор снят правкой → 404
  `NOT_FOUND`; `not-a-uuid` → 400; сериализованное тело не содержит `routeId`, sha256, названия маршрута;
  кэш: второй запрос не читает `route_geometries` (spy на `RoutesRepository.displayLine` — один вызов) и не грузит
  `matchLine` (spy на `geometry` — 0 вызовов). 429 — уже покрыт guard'ом, повторять не нужно.
- app native (jest): `corridor-style.test.ts` — `metersPerPixel(0, 0) ≈ 78271.517`, на широте 53.9 и zoom 22;
  выражение ширины: опоры 0 и 22, `2 × widthM / mpp`; `routeFeatures` — LineString + start/finish; `map-style.test.ts` —
  env задан/пустой/не задан, светлая/тёмная. `race-detail.test.tsx` (+ кейсы): с коридором и env — после ответа
  `getRaceRoute` есть `Map` мока с `mapStyle` светлой темы, `Camera.initialViewState.bounds`, без анимации;
  `accessibilityLabel` из `races.detail.map.label`; строки «Коридор»/дистанция остаются; без коридора — `getRaceRoute`
  не вызван; env не задан — не вызван, блока нет; `getRaceRoute` 404 — блока нет, карточка цела; `onDidFailLoadingMap`
  — «Карта не загрузилась»; тёмная схема (мок `useColorScheme` RN) — `mapStyle` тёмный.
- app web (jest, `*.web.test.tsx`, мок `maplibre-gl` через `jest.mock`): `route-map.web.test.tsx` — до эффекта
  конструктор не вызван (серверная отрисовка `renderToString` — `maplibre-gl` не импортирован, есть место карты);
  после монтирования — `new Map` с `interactive: false`, `attributionControl.compact`, `bounds`; `error` → сообщение;
  размонтирование — `remove()`; смена `styleUrl` — пересоздание.
- SSR/AC9: CI-job `web` (`pnpm build:web` + `e2e:web`) — сборка не падает; дополнительно проверить, что
  `dist/server` не содержит статического импорта `maplibre-gl` в бандле маршрута `races/[id]` (ручная проверка → §12).
- Native-смоук на устройстве — `NOT VERIFIED` (D2).

### OUT OF SCOPE

Трек участника и подсветка вне коридора (maps-02), карта в панели (CSP), «рядом»/райды, геокодер, офлайн-тайлы,
интерактив и полноэкранная карта, SSR-мета/OG с картой, новые токены дизайн-системы (follow-up RC-5), исключение
`maplibre-gl` из precache (RC-8), изменение `LinePreview` панели, миграции/индексы, очереди/outbox.

## 12. Outcome (заполняет coder)

Реализовано по §11 с решениями RC-1…RC-10 «как предложено»; отклонения — §8.2 D3–D6.

**Что сделано**

- contracts: `RaceRouteMap`, `LonLat`, `RACE_ROUTE_MAX_POINTS` (`src/races/race-route.schema.ts`); api-client:
  `getRaceRoute(id)` (RC-9).
- api: `GET /v1/races/:id/route` (`RacesPublicController.route` → `RacesPublicService.route`); видимость — общий
  `publicRace` (его же использует `get`); нет коридора / маршрут не `ready` → `404 NOT_FOUND` (RC-3). Порт
  `RouteGeometry.displayGeometry` (RC-7): `RoutesRepository.displayLine` с проекцией `{ line: 1 }`, отдельный LRU
  `displayCache` (256), существующий `cached()` не тронут; линия < 2 точек — `null`.
- app: `features/maps/` — `corridor-style.ts` (mpp, выражение ширины, GeoJSON, слои, `CORRIDOR_OPACITY`,
  `MAP_ASPECT_RATIO`, `MAP_PADDING`), `map-style.ts`, `route-map.tsx` (native v11: `Map`/`Camera initialViewState`/
  `GeoJSONSource`/`Layer`, жесты выключены пропсами, `attribution`), `route-map.web.tsx` (`loadMaplibre()` после
  монтирования, `interactive: false`, `attributionControl.compact`, `bounds` + `fitBoundsOptions.animate: false`,
  пересоздание по `styleUrl`/теме, `remove()`), `route-map-frame.tsx` (a11y-изображение, «Карта не загрузилась» поверх),
  `load-maplibre.ts`, `map-worker.ts`; `races/race-route-map.tsx` + `useRaceRoute` (`['races','route',id]`); одна
  вставка в `race-detail.tsx` после строки «Коридор»; `useMounted()` вынесен в `lib/use-minsk-clock.ts`
  (`useMinskClockAfterMount` на нём). i18n `races.detail.map.label/failed`. `app.json` — config plugin; `.env.example`.
- infra (RC-1 a): `Dockerfile` `build-web` — необязательные `ARG EXPO_PUBLIC_MAP_STYLE_LIGHT/DARK`; `deploy-dev.yml` —
  build-args с URL OpenFreeMap. Сборка web — `scripts/copy-map-worker.ts` в `dev`/`build:web`/`build:web:dev` (D3).
- docs: `pokatim-app.md`, `pokatim-security.md`, `pokatim-backend.md`, `pokatim-contracts.md`, `local-dev.md`.

**Тесты**

- contracts `race-route.schema.test.ts`; api-client `races.test.ts` (путь, `a%2Fb`, без `authorization`, разбор, 404).
- api int `races-corridor.int.test.ts` «карта маршрута (maps-01)»: 200 + ровно 5 ключей + `public, max-age=60` +
  `line`/`start`/`finish` из БД + отсутствие `routeId`/sha256/названия; отменённая — 200; черновик, без коридора,
  коридор снят, неизвестный — 404 `NOT_FOUND`; `not-a-uuid` — 400; кэш: `displayLine` 1 вызов на 2 запроса,
  `geometry` (линия сверки) — 0.
- app: `corridor-style.test.ts`, `map-style.test.ts`, `route-map.web.test.tsx` (SSR `renderToString` — загрузчик не
  вызван; опции `Map`, воркер, слои после `load`, `error` → сообщение, пересоздание по стилю, `remove()`),
  `race-route-map.test.tsx` (карта светлой/тёмной темы, подпись a11y, камера без анимации, строки остаются,
  `onDidFailLoadingMap` → сообщение, 404 / env не задан / без коридора — блока нет), `scripts/copy-map-worker.test.ts`.

**Проверки**

- `TURBO_CONCURRENCY=1 pnpm check` (MONGO/REDIS_URL_TEST — изолированные БД) — зелёный (третий прогон):
  `Tasks: 13 successful, 13 total`, `exit=0`; api 905, app 906, admin 212, contracts 212, api-client 72 теста.
  Первые два прогона падали на таймаутах 5 с несвязанных тестов под нагрузкой (`ui-kit.test.tsx` app,
  `SignInScreen.test.tsx` admin 429) — отдельно проходят, в третьем прогоне зелёные.
- AC9 / SSR: `build:web` с env стилей — успешно; `maplibre-gl` — отдельный async-чанк клиента (~1,1 МБ), в чанке
  `races/[id]` — только вызов загрузчика; воркер — `dist/client/maplibre-gl-worker.mjs`. Серверный бандл Metro
  (`dist/server/_expo/server/render.js`) **содержит** код `maplibre-gl` (сервер не делит на чанки), но модуль
  исполняется только по `loadMaplibre()` в эффекте; `start:web` → `GET /races/<id>` — 200 (API недоступен, карточка
  в состоянии «недоступно» — рендер с данными гонки не проверен), `GET /maplibre-gl-worker.mjs` — 200
  `text/javascript`.
- NOT VERIFIED: карта в браузере с реальной гонкой и тайлами OpenFreeMap (нет поднятого API с данными в сессии);
  native — dev-сборка и устройство (D2).

**Риски / follow-up**

- Expo Go / старый dev-клиент (решено после отчёта, оркестратор 2026-10-26): пакет MapLibre RN зовёт
  `TurboModuleRegistry.getEnforcing` при импорте — теперь загрузка ленивая (`load-maplibre-native.ts`, `import()`;
  `require` в `.ts` запрещён ESLint) и только при `mapSupported()` (`MLRNCameraModule` — первый при импорте,
  `MLRNMapViewModule` — главный); иначе блока нет. Тест `race-route-map.test.tsx` («нет нативного модуля»),
  отрицательное доказательство: без `mapSupported()` тест красный (1 failed).
- CSS `maplibre-gl` (~70 КБ) Metro web подключает глобально — `<link>` на всех страницах, не только на карточке.
- RC-8: чанк `maplibre-gl` в precache SW (хешированный); воркер — без хеша, не в precache.
- RC-5: токены карты (пропорция, прозрачность, роли старта/финиша) — follow-up в app-foundation.
