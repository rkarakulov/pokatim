# routes-05 — панель: карта маршрута, профиль высоты и скраббинг

Уровень: task3. Ветка `feature/routes-05-panel-map` от `origin/develop` (после routes-04b, PR #59). Связано: ADR-0014
(карты; дополнение routes-04b — интерактивная карта), routes-03/04/04b (карточка в приложении), routes-01 (панель
«Маршруты», `RoutePreview`, `RouteCatalogDialog`, `CorridorField`), `@pokatim/tracks` `src/scrub.ts` (общая логика
скраббинга, лёгкий вход).

## 1. Title

Панель «Маршруты»: страница маршрута с настоящей картой MapLibre GL, профилем высоты и связанным скраббингом; превью
маршрута в окне публикации и поле коридора — карта с толстой линией.

## 2. Goal

Пользователь (2026-10-27): «в админке тоже нужно будет при просмотре маршрута сделать как в приложении профиль высоты с
данными и тасканием точки, чтоб на карте и на профиле были связаны; сейчас нет самой карты в админке — только линия и
она тонкая». Сотрудник, публикуя маршрут и выбирая коридор гонки, должен видеть маршрут на подложке, его рельеф и
цифры.

## 2.1 Продуктовые решения

| # | Вопрос | Решение |
|---|---|---|
| A1 | Где (пользователь, 2026-10-27) | **страница + превью**: новая страница `/routes/:id` (из списка «Маршруты»): большая интерактивная карта, цифры (длина, набор, макс./мин. высота, круговой/в одну сторону, время в пути по покрытию), профиль со скраббингом, статус и действия каталога (опубликовать/изменить/снять — существующие); в окне публикации и поле коридора — компактная карта с толстой линией (без профиля) и ссылка «Открыть маршрут» |
| A2 | Поведение карты (по образцу приложения, routes-04b; **решение пользователя 2026-10-27: один палец**) | `maplibre-gl` 6, стиль — env панели `VITE_MAP_STYLE_LIGHT` (тот же URL OpenFreeMap, что у приложения; панель только светлая — `DARK` не заводится, RC-3; не задан — блок без карты), карта перетаскивается **одним пальцем/мышью** (без `cooperativeGestures`), колесо мыши — зум только с Ctrl/⌘ (свой фильтр колеса, RC-2), кнопки «+», «−», «в рамку», вращение/наклон выключены, зум 2–17, линия 5 px, старт/финиш как в приложении; тема — тема панели |
| A3 | Скраббинг | как web приложения: hover/перетаскивание по профилю → маркер на карте, перетаскивание маркера по линии → курсор профиля; карточка «км · м · уклон % · набор»; профиль — `role="slider"` (←/→ 1 км, Home/End); логика — `@pokatim/tracks` (`pointAtFraction`, `nearestFraction`, `elevationAt`, `gradeAt`, `gainTo`, `stepDistance`, `profilePoints`) |
| A4 | Данные | `GET /v1/admin/routes/:id` (`PanelRoute`) + `elevation: { minM, maxM, profile } \| null` (из производных routes-03; для любого готового маршрута, не только каталога); старый ответ без поля — `null` |

## 3. Scope

- **contracts / api:** `PanelRoute.elevation` (`CatalogRouteElevation` переиспользовать), `RoutesService` панели —
  `derivedOf` (как публичная карточка); int-тест ключей.
- **admin:** `features/maps/` панели (карта MapLibre GL — компонент, стиль из env, слои маршрута — по образцу
  `corridor-style.ts` приложения; общий код слоёв — вынести в пакет, если без дублирования не выходит — решает
  architect), страница `features/routes/RouteScreen.tsx` + маршрут в `router.tsx`, ссылка из `RoutesScreen`,
  профиль высоты SVG + скраббинг, `RoutePreview` → компактная карта, i18n `admin.routes.detail.*`.
- **docs:** `docs/product/routes.md` (панель), `docs/product/admin-panel.md`, `.claude/rules/pokatim-web.md` (или правило
  панели), ADR-0014 — панель использует ту же карту.

## 4. Out of Scope

- Редактирование линии, обрезка концов, перерисовка маршрута.
- Скраббинг в поле коридора гонки и окне публикации (там только карта).
- Карта гонки в панели (коридор поверх) — follow-up, если понадобится.

## 5. Placement (architect)

- **Новый пакет `@pokatim/route-view`** (`packages/route-view`, ≥ 2 потребителя: `apps/app` и `apps/admin`, AGENTS.md
  §4.4): чистые части отображения маршрута без React, RN и i18n-разметки — слои/GeoJSON MapLibre, камера, проекция
  линии и допуск маркера, сторы скраббинга (`zustand/vanilla`), опции интерактивной карты и фильтр колеса, атрибуция
  (DOM, без React), пути SVG профиля, числа скраббинга и тики оси, скорость/время в пути. Перенос из `apps/app` —
  механический (файлы и их тесты переезжают, приложение импортирует из пакета; копий нет). Состав — §11.
- **`@pokatim/tracks` не расширяется** (геометрия и разбор; дизайн-токены и стиль MapLibre ему чужие).
- **apps/admin:** `src/features/maps/` — DOM-компоненты карты панели (`RouteMap`, `ScrubMarker`, `MapControls`, env
  стиля, ленивый загрузчик, тема карты); `src/features/routes/` — страница `RouteScreen`, профиль `ElevationProfile`,
  подписи `route-detail-format.ts`, `RoutePreview` → компактная карта. React/DOM-код приложения (`*.web.tsx` на
  RN-web) в панель не копируется и не выносится: у панели свои DOM-компоненты поверх общих чистых функций.
- **apps/api:** модуль `routes` — `RoutesService.view()` (+ `elevation`), общая функция `elevationOf(profile)`
  (новый `route-elevation.ts`, её же берёт `routes-public.service.ts`), репозиторий — проекция линии и профиля одним
  запросом. Контроллер и права не меняются.
- **infra:** CSP панели (`infra/docker/admin-nginx.conf`), `ARG VITE_MAP_STYLE_LIGHT` в цели `build-admin`
  (`infra/docker/Dockerfile`) + `COPY packages/route-view/package.json`, build-args admin в `deploy-dev.yml`.

## 5.1 Placement & Reuse Gate

- Reuse: `@pokatim/tracks` scrub, контракт `CatalogRouteElevation`, `RoutesRepository.derivedOf`, `maplibre-gl` 6 (как в
  приложении; добавить в `apps/admin`), подписи и время в пути — по образцу `apps/app/src/features/routes/format.ts`
  (общие чистые функции — в пакет, если панели нужны те же).
- Запрещено: копировать модули приложения целиком (RN-зависимости в панели); свой парсер/проекции вместо
  `@pokatim/tracks`; хардкод цветов вне токенов панели.

- Reuse (architect): `routeQuery` (`['admin','routes','item',id]`) — один ключ для страницы, превью и
  `afterCatalogChange` (ответ публикации — тот же `view()`, уже с `elevation`); `RouteCatalogDialog` /
  `UnpublishRouteDialog` принимают `PanelRouteSummary` — `PanelRoute` им присваивается; `ErrorState`, `EmptyState`,
  `PageHeader`, `Banner`, `StatusTag`, `StatTile`, `Button` из `src/ui`; строки `maps.*` и `routes.detail.scrub.*`
  `@pokatim/i18n` — где формулировка та же, новые — `admin.routes.detail.*`.

## 8. Risks / Assumptions

- R1: стиль OpenFreeMap и CSP панели (если есть CSP — разрешить домены тайлов и worker `blob:`).
- A1: `VITE_MAP_STYLE_*` задаются в окружении панели на dev (deploy-конфиг).

## 8.1 Requirements Consistency (заполняет architect)

- **RC-1 (порядок с routes-04c, нужен оркестратор).** Вынос в `@pokatim/route-view` трогает `apps/app/src/features/maps/*`
  и `routes/{format,scrub,profile-path,profile-style}.ts`; параллельный routes-04c (один палец в приложении) правит
  `route-map.web.tsx`, `map-locale.web.ts`, строки `maps.gestures.*`. Альтернативы: (a) **рекомендация** — смержить
  04c первым, routes-05 ребейзится и переносит уже обновлённые модули; общий фильтр колеса (`guardWheelZoom`) и опции
  карты (`interactiveMapOptions`) — в пакете, приложение переходит на них в routes-05 (или 04c сразу кладёт их в
  пакет, тогда routes-05 только потребляет); (b) пакет только для панели сейчас, перевод приложения — follow-up
  (временный дубль — нарушение «копировать нельзя», не рекомендую); (c) копия в admin — запрещено §5.1.
- **RC-2 (колесо и один палец).** В `maplibre-gl` 6.16 `cooperativeGestures` — один переключатель: он же требует Ctrl/⌘
  для колеса, два пальца для пана (`touch_pan`: `minTouches = 2`) и три для щипка (`two_fingers_touch`). Разделить
  без своего кода нельзя. Решение: `cooperativeGestures: false`, `scrollZoom` включён, поверх — свой фильтр колеса
  `guardWheelZoom(container, { onBlocked })` (пакет): слушатель `wheel` в фазе захвата на обёртке холста пропускает
  событие к MapLibre только с `ctrlKey`/`metaKey` (щипок тачпада браузер шлёт как `wheel` с `ctrlKey` — работает), без
  модификатора — `stopPropagation` без `preventDefault` (страница прокручивается) и `onBlocked` → подсказка поверх
  карты (строки `maps.gestures.wheel`/`wheelMac`, без затухания при reduce motion). Математика зума — MapLibre.
  Альтернативы: обычное колесо (на длинной странице, в форме гонки и окне публикации колесо «съедает» прокрутку —
  вредно), `cooperativeGestures: true` (против решения пользователя). Дополнение ADR-0014 п. 1 (web) — заменить.
- **RC-3 (тёмный стиль).** Панель только светлая (AGENTS.md §2, `pokatim-web.md`) — `VITE_MAP_STYLE_DARK` не нужен
  («нет на вырост», §4.9). Заводится только `VITE_MAP_STYLE_LIGHT`; A2 поправлен.
- **RC-4 (CSP).** Сейчас `connect-src 'self'`, `worker-src` нет (→ `script-src 'self'`), `img-src 'self' data:`. Нужно:
  `connect-src 'self' https://tiles.openfreemap.org` (стиль, тайлы, глифы, спрайты OpenFreeMap), `worker-src 'self'
  blob:` (MapLibre может поднять воркер через blob), `img-src 'self' data: blob:`. Воркер — свой ассет Vite
  (`maplibre-gl/dist/maplibre-gl-worker.mjs?url` → `/admin/assets/…`, тот же origin) через `setWorkerUrl`: по
  умолчанию MapLibre ищет его по `import.meta.url` чанка (`new URL('./maplibre-gl-worker.mjs', …)` динамически — Vite
  файл не копирует). Origin провайдера в CSP — жёстко: смена провайдера = env + CSP (одна правка, ADR-0014 п. 1
  дополнить). Сторож — тест admin: origin `VITE_MAP_STYLE_LIGHT` из `deploy-dev.yml` входит в `connect-src` CSP
  `admin-nginx.conf`. Альтернатива — шаблон nginx через `envsubst` (ломает чтение CSP в `vite.config.ts`, сложнее) —
  нет. CSP меняется только вместе со смоуком `pnpm e2e:admin` (`pokatim-security.md`).
- **RC-5 (геометрия без контракта карты).** `PanelRoute` даёт только `line`; рамка, старт и финиш — на клиенте:
  `geometryFromLine(line)` (пакет; `boundsOf` из `@pokatim/tracks`, старт/финиш — концы линии показа). Альтернатива —
  `PanelRoute.map: RouteMapGeometry` (рост контракта ради трёх производных от `line`) — нет.
- **RC-6 (лишнее чтение в API).** `RoutesService.view()` читает `repository.geometry(id)` — весь документ с `matchLine`
  (до 20 000 точек) ради `line`. С `elevation` — один запрос с проекцией `{ line, profile }` (новый
  `RoutesRepository.panelGeometry(id)`), без второго `derivedOf`. Сборка `{ minM, maxM, profile }` — одна функция
  `elevationOf` для публичной карточки и панели (сейчас — внутри `toCatalogDetail`).
- **RC-7 (форма поля).** Правило контрактов: поля ответов панели обязательны (панель деплоится с API); A4 —
  «старый ответ без поля — `null`». Следуем A4: `elevation: CatalogRouteElevation.nullable().default(null)` (как
  `CatalogRouteDetail`) — безвредно, тест на оба входа. Отклонение от правила — §8.2 не нужно (A4 решён).
- **RC-8 («Открыть маршрут» из формы гонки).** Ссылка в поле коридора уводит со страницы с несохранённой формой гонки —
  потеря ввода. Решение: в `CorridorField` — новая вкладка (`target="_blank"`, `rel="noopener noreferrer"`), в окне
  публикации на «Маршрутах» — обычный переход (окно закрывается), на самой странице маршрута (окно «Изменить») — без
  ссылки (проп `openLink`). Альтернативы: всегда та же вкладка (потеря формы), без ссылки в поле коридора.
- **RC-9 (без env стиля).** Приложение без env прячет блок. В панели сейчас есть `LinePreview` — убрать его без env
  значит регресс превью и шага смоука (`races.spec.ts` ищет `img` «Линия маршрута «…»», в CI стиля нет). Решение:
  без env — прежний `LinePreview` (и на странице, и в компактном месте), профиль и цифры остаются (AC3 «блок без
  карты»). С env — карта.
- **RC-10 (маршрут не готов).** Страница `processing` (видит только автор) — статус «Обрабатывается» и опрос
  `ROUTE_POLL_MS` не дольше `ROUTE_POLL_MAX_MS` (как загрузка; затем «проверьте позже» с «Обновить»); `failed` —
  причина `admin.routes.failure.*`; карты, профиля и цифр нет. Чужой необработанный/райдерский — 404 сервера.
- **RC-11 (время в пути вне каталога).** Покрытие есть только у опубликованного маршрута; иначе — скорость «как
  асфальт» (правило `routePaceKmh`: известных покрытий нет) с подписью «при 27 км/ч». Альтернатива — скрыть время у
  неопубликованных (A1 просит время всегда) — нет.
- **RC-12 (цвета карты).** Paint MapLibre требует значения, не CSS-переменные: слои берут роли `themes.panel.map.*`
  (`@pokatim/design-tokens`, роли — не палитра; ESLint `designSystemOnly` не нарушается). DOM-оверлеи (маркер, кнопки,
  подсказка, профиль) — CSS-переменные `--color-*`/`--size-*`/`--stroke-*` в `index.css`.
- **RC-13 (вес).** `maplibre-gl` (~1,1 МБ) и его CSS (~70 КБ) — только в async-чанке: загрузчик
  `Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])`; статического импорта CSS в
  модулях первого чанка нет (проверка — `vite build`, чанк отдельный).

Конфликтов с инвариантами, кроме RC-1 (порядок работ), нет; блокирующих противоречий в требованиях нет.

## 8.2 Deviations from spec

Сверка §11 с develop после routes-04c/04d (coder):
- **D1 `guardWheelZoom`** — 04c уже положил эквивалент (`map-wheel.web.ts`); перенесён в `map-options.ts` пакета с
  прежней сигнатурой `guardWheelZoom(container, onBlocked)` + отдельные `isMacPlatform()`, `WHEEL_HINT_MS` (§11 —
  «если 04c положил эквивалент — переиспользовать»), вместо `(target, { onBlocked, isMac })`.
- **D2 `interactiveMapOptions`** даёт `attributionControl: { compact: true }`; приложение (04d, RC-6) переопределяет
  `attributionControl: false` и ставит контрол в `'bottom-left'`. `disableRotation()` (щипок, клавиатура) — у
  вызывающих после создания (это не опции `MapOptions`).
- **D3 `camera.ts`** переехал целиком (вместе с `cameraPadding`, `cameraCall`, `CAMERA_MIN_VIEW_PX` из 04d/native) —
  механический перенос модуля; панель их не использует. `location-*`, `track-style.ts` остались в приложении.
- **D4** приложение: хук `useScrub` — `features/maps/use-scrub.ts` (`scrub-store.ts` удалён, тест хука — рядом);
  тест `scrubStep` переехал в пакет; тесты времени в пути — в пакете (`pace.test.ts`), `format.test.ts` приложения
  оставлен с теми же ожиданиями (импорт чисел — из пакета). `profile-chart.web.tsx` перешёл на `scrubKeyTarget` /
  `fractionAt` пакета (поведение то же).
- **D5 `RouteMap` панели** принимает `styleUrl` пропом (выбор «карта или `LinePreview`» — у вызывающего, `RouteLine`
  в `RoutePreview.tsx`, общий для страницы и превью); `ScrubLayer` — в том же файле, что `ScrubMarker`.
- **D6 подпись карты** — новая строка `admin.routes.detail.mapLabel` («Карта маршрута «…»: …, старт и финиш
  отмечены»); у `LinePreview` — прежняя `admin.races.corridor.previewLabel` (смоук ищет её).
- **D7 `turbo.json`** — `VITE_MAP_STYLE_LIGHT` в `env` задачи `build` (иначе кэш turbo отдаёт сборку без стиля).
- **D8 slider профиля** — `aria-valuemin/max/now` в км (одна десятая), как в §11 (приложение — метры).
- **D9** пакет: `vitest.config.ts` с условием `@pokatim/source` (node и jsdom), `tsconfig` с `lib: DOM`.

## 9. Acceptance Criteria

1. Страница `/routes/:id` панели: интерактивная карта с толстой линией, цифры, профиль со скраббингом (hover/drag ↔
   маркер), slider с клавишами; состояния (загрузка, ошибка с повтором, 404, маршрут не готов — без карты/профиля).
2. Окно публикации и поле коридора — компактная карта с толстой линией и ссылкой на страницу.
3. Без env стиля — блок без карты, цифры и профиль остаются.
4. `GET /v1/admin/routes/:id` отдаёт `elevation`; права и видимость (`races.read`, origin `platform`) — без изменений.
5. `TURBO_CONCURRENCY=1 pnpm check` зелёный; e2e панели (если есть смоук) — зелёный.

## 10. Documentation Impact

`docs/product/routes.md`, `docs/product/admin-panel.md`, правило панели, ADR-0014.

architect — уточнение:
- ADR-0014: п. 8 («панель остаётся с SVG-превью») заменить — панель использует карту (`maplibre-gl` 6, общий пакет
  `@pokatim/route-view`), env `VITE_MAP_STYLE_LIGHT` (только светлая), CSP панели (`connect-src` origin провайдера,
  `worker-src 'self' blob:`, `img-src blob:`), смена провайдера = env + CSP; один палец + Ctrl/⌘-колесо (RC-2) —
  дополнение к п. 1 routes-04b для web (согласовать текст с routes-04c, одно дополнение на оба слайса).
- `AGENTS.md` §2 — строка `route-view/` в `packages/`.
- `.claude/rules/pokatim-web.md` — абзац «Страница маршрута и карта (routes-05)»: `features/maps/` панели, загрузчик,
  воркер `?url`, env, фолбэк `LinePreview`, CSP-сторож, ссылка из поля коридора — новая вкладка.
- `.claude/rules/pokatim-app.md` — пути модулей карты/профиля, переехавших в `@pokatim/route-view`.
- `docs/runbooks/local-dev.md` («Панель») — `VITE_MAP_STYLE_LIGHT` для `pnpm dev`; `infra/docker/Dockerfile` —
  комментарий build-arg admin.
- `docs/product/routes.md`, `docs/product/admin-panel.md` — страница `/routes/:id`, компактная карта, RC-9…RC-11.

## 11. Implementation Context

### ENTRY POINTS
- `apps/admin/src/router.tsx` — `routeRoute`: `path: 'routes/$routeId'`, `RequirePermission permission="races.read"`,
  `<RouteScreen routeId={routeId} />`; в `routeTree` — рядом с `routesRoute`.
- `apps/api/src/modules/routes/routes.service.ts` — `view()`.
- `packages/contracts/src/routes/route.schema.ts` — `PanelRoute`.

### FILES TO MODIFY / CREATE

**contracts**
- `route.schema.ts`: `PanelRoute = PanelRouteSummary.extend({ line: …, elevation:
  CatalogRouteElevation.nullable().default(null) })` (импорт из `route-catalog.schema.ts` — проверить отсутствие цикла
  импортов; `route-catalog.schema.ts` сейчас не импортирует `route.schema.ts`). Тест — `route.schema.test.ts` (или
  рядом): с полем, без поля → `null`, невалидный профиль (1 точка) → ошибка.

**api (`apps/api/src/modules/routes/`)**
- `route-elevation.ts` (новый): `export function elevationOf(profile: [number, number][] | null):
  CatalogRouteElevation | null` — перенос из `toCatalogDetail` (`routes-public.service.ts` переходит на него).
- `routes.repository.ts`: `panelGeometry(id): Promise<{ line: [number, number][]; profile: [number, number][] | null }
  | undefined>` — `geometries.findOne({ _id }, { projection: { line: 1, profile: 1 } })`.
- `routes.service.ts` `view()`: `route.status === 'ready' ? repository.panelGeometry(id) : undefined` →
  `line: geometry?.line ?? []`, `elevation: elevationOf(geometry?.profile ?? null)`. `repository.geometry()` остаётся
  для `route-catalog.ts` (сверка).
- Права, видимость (`visible`), контроллер — без изменений.

**package `packages/route-view`** (новый; `package.json` как у `@pokatim/tracks`: `exports` с `@pokatim/source`, `build`
`tsc`, `typecheck`, `test` vitest; deps — `@pokatim/contracts`, `@pokatim/design-tokens`, `@pokatim/i18n`,
`@pokatim/tracks`, `zustand` (5.0.15); dev — `@maplibre/maplibre-gl-style-spec` (типы), `maplibre-gl` (только `import
type`), `@types/geojson`, vitest/jsdom для DOM-тестов). Переезд из `apps/app` с тестами:
- `route-layers.ts` ← `features/maps/corridor-style.ts` целиком; тема — `type MapTheme = Pick<Theme, 'map'>`
  (`Theme` из `@pokatim/design-tokens`), не `AppTheme`; `routeFeatures(map: RouteMapGeometry)`.
- `camera.ts` ← `map-camera.ts`; `scrub-line.ts` ← `scrub-line.ts`; `geometry.ts` ← `route-geometry.ts`
  (`withoutCorridor`) + новый `geometryFromLine(line: readonly LonLat[]): RouteMapGeometry | null` (< 2 точек или
  нулевая рамка — `null`).
- `stores.ts` ← `createScrubStore`, `ScrubState`, `ScrubDragging`, `ScrubStore`, `SCRUB_MARKER_ATTR`
  (`scrub-store.ts`) и `createMapViewStore`, `MapViewStore` (`map-view-store.ts`); хук `useScrub` остаётся в
  приложении (React), панель — `useStore` из `zustand`.
- `attribution.ts` ← `attribution.web.ts`: `collapseAttribution(map, container)`, `attributionCss(scope, theme:
  Pick<Theme,'surface'|'text'>, dark: boolean)` (флаг вместо сравнения с `themes.dark`).
- `map-locale.ts` ← `map-locale.web.ts` (после 04c — актуальный набор строк).
- `map-options.ts` (новый): `interactiveMapOptions({ bounds, padding }): Omit<MapOptions, 'container' | 'style'>` —
  `interactive: true`, `cooperativeGestures: false`, `dragRotate: false`, `pitchWithRotate: false`, `touchPitch:
  false`, `maxPitch: 0`, `minZoom`/`maxZoom`, `locale: mapLocale()`, `attributionControl: { compact: true }`,
  `fitBoundsOptions: { padding, animate: false }`; `guardWheelZoom(target: HTMLElement, options: { onBlocked?: () =>
  void; isMac?: boolean }): () => void` (RC-2; возвращает отписку). Если 04c уже положил эквивалент — переиспользовать.
- `profile.ts` ← `profile-path.ts` + `profile-style.ts` (`PROFILE_VIEW_*`, `profilePaths`, `profileGradientId`,
  `PROFILE_FILL_OPACITY`, `PROFILE_ASPECT_RATIO`) + числовые части: `profileTickValues(distanceM): { km: number;
  position: number }[]` (из `profileTicks`, без подписей), `scrubValues(elevation, distanceM, gainM, fraction): { km:
  number; elevationM: number; grade: number; gainM: number }`, `scrubStep(fraction, distanceM, direction)`,
  `scrubKeyTarget(key: string, fraction: number, distanceM: number): number | null` (←/→/Home/End; прочее — `null`),
  `fractionAt(clientX: number, left: number, width: number): number` (0…1).
- `pace.ts` ← `ROUTE_PACE_KMH`, `routePaceKmh(surfaces: readonly string[])`, `routeDurationMin`.
- `index.ts` — публичный вход. Приложение: `format.ts`, `scrub.ts`, `profile-chart(.web).tsx`, `route-map(.web).tsx`,
  `scrub-marker(.web).tsx` и др. импортируют из пакета; i18n-обёртки (`routeDuration`, `profileTicks`,
  `scrubReadout`) остаются в приложении поверх чисел пакета. Удаляемые файлы приложения — без реэкспорт-шимов.

**admin**
- `package.json`: `maplibre-gl` `~6.16.0`, `zustand` `5.0.15`, `@pokatim/tracks`, `@pokatim/route-view` (`workspace:*`).
- `src/vite-env.d.ts`: `readonly VITE_MAP_STYLE_LIGHT?: string`.
- `src/features/maps/map-style.ts`: `mapStyleUrl(): string | null` (пусто — `null`).
- `src/features/maps/load-maplibre.ts`: `loadMaplibre(): Promise<typeof import('maplibre-gl')>` — `Promise.all` модуля и
  CSS (RC-13), `setWorkerUrl(workerUrl)` из `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'` (один
  раз). Точка подмены в тестах.
- `src/features/maps/panel-map-theme.ts`: `PANEL_MAP_THEME = themes.panel`.
- `src/features/maps/use-reduced-motion.ts`: `matchMedia('(prefers-reduced-motion: reduce)')` с подпиской.
- `src/features/maps/RouteMap.tsx`: `RouteMap({ geometry: RouteMapGeometry; label: string; variant: 'page' |
  'compact'; scrub?: ScrubStore })` — по образцу `route-map.web.tsx`: создание в эффекте после `loadMaplibre`,
  `interactiveMapOptions`, `guardWheelZoom` на обёртке холста (подсказка — свой `div` с `aria-hidden`), слои
  `routeLayers(PANEL_MAP_THEME, 0, bounds, ROUTE_CATALOG_LINE_WIDTH)` без коридора, `collapseAttribution` +
  `<style>{attributionCss(scope, PANEL_MAP_THEME, false)}</style>`, ошибка только до `load` — «Карта не
  загрузилась» поверх (`maps.*`/`races.detail.*` строка — найти существующую), маркер — `ScrubLayer`/`ScrubMarker` по
  стору вида, кнопки — `MapControls` после создания. Подпись-альтернатива — `role="img"` слой с `aria-label`.
  Пропорция — `MAP_ASPECT_RATIO` (CSS `aspect-ratio`), размеры — переменные токенов.
- `src/features/maps/ScrubMarker.tsx`, `ScrubLayer.tsx`, `MapControls.tsx` — DOM-версии (pointer capture, `aria-hidden`
  маркер; кнопки — `Button` панели с `aria-label` `maps.controls.*`, колонка сверху справа).
- `src/features/routes/ElevationProfile.tsx`: `ElevationProfile({ elevation, distanceM, gainM, scrub, label })` —
  inline SVG (`profilePaths`, градиент), `role="slider"`, `aria-valuemin/max/now` (км), `aria-valuetext`, клавиши через
  `scrubKeyTarget`, hover/drag через `fractionAt`, курсор и карточка «км · м · уклон % · набор»; касание вне профиля и
  маркера (`SCRUB_MARKER_ATTR`) скрывает курсор.
- `src/features/routes/route-detail-format.ts`: подписи `admin.routes.detail.*` поверх `scrubValues`, `pace.ts`,
  `profileTickValues` (`formatKmFromMeters` панели — где подходит).
- `src/features/routes/RouteScreen.tsx`: `RouteScreen({ routeId })` — `useQuery(routeQuery(id))` + `refetchInterval`
  для `processing` (RC-10); состояния как `RaceScreen` (скелетон под шапкой с крошкой «Маршруты», 403 —
  `NoAccessScreen`, 404 — `EmptyState` «Маршрут не найден», ошибка — `ErrorState` с повтором, ошибка обновления при
  данных — `Banner` с повтором); готовый — карта (или `LinePreview` без env, RC-9), `StatTile`-цифры (длина, набор,
  макс./мин., круговой/в одну сторону, время в пути с подписью скорости, RC-11), профиль (нет `elevation` — блока
  нет, текст «Нет данных о высоте»), статус каталога и действия `races.manage` (`RouteCatalogDialog openLink={false}`,
  `UnpublishRouteDialog`). Стор скраббинга — `useState(createScrubStore)` на экземпляр (`key={routeId}`).
- `src/features/routes/RoutePreview.tsx`: `RoutePreview({ routeId, openLink?: 'same-tab' | 'new-tab' | false })` —
  компактная `RouteMap variant="compact"` без скраббинга (без env — `LinePreview`), мета, ссылка «Открыть маршрут».
- `RouteCatalogDialog.tsx` (`openLink` проп, по умолчанию `'same-tab'`), `CorridorField.tsx` (`openLink="new-tab"`,
  RC-8), `RoutesScreen.tsx` (название — `Link` на `/routes/$routeId` для всех строк).
- `src/index.css`: классы карты, кнопок, маркера, подсказки колеса (reduce motion — без перехода), профиля, страницы.
- `packages/i18n/src/ru.ts`: `admin.routes.detail.*` (заголовки блоков, цифры, «Нет данных о высоте», «Открыть
  маршрут», «Маршрут не найден», «Обрабатывается — проверьте позже»), без дублей существующих.

**infra / CI**
- `infra/docker/admin-nginx.conf` — CSP (RC-4). `infra/docker/Dockerfile` — `COPY packages/route-view/package.json …`
  в `deps`; `build-admin`: `ARG VITE_MAP_STYLE_LIGHT=` → в окружение `pnpm --filter @pokatim/admin build`.
- `.github/workflows/deploy-dev.yml` — шаг admin: `build-args: VITE_MAP_STYLE_LIGHT=https://tiles.openfreemap.org/styles/positron`.

### FILES TO READ
`apps/app/src/features/maps/{route-map.web.tsx,scrub-marker.web.tsx,scrub-layer.tsx,route-map.web.test.tsx,
route-map-scrub.web.test.tsx}`, `apps/app/src/features/routes/{profile-chart.web.tsx,profile-chart.web.test.tsx,
format.ts,scrub.ts}`, `apps/admin/src/features/{races/RaceScreen.tsx,routes/*}`, `apps/admin/src/ui/{LinePreview,
StatTile,states}.tsx`, `apps/admin/vite.config.ts`, `infra/docker/admin-nginx.conf`, `apps/admin/e2e/races.spec.ts`,
`apps/api/src/modules/routes/{routes.service.ts,routes-public.service.ts,routes-admin.int.test.ts}`, ветка routes-04c.

### TYPES & SCHEMAS
`PanelRoute` (+ `elevation`), `CatalogRouteElevation`, `RouteMapGeometry`, `LonLat`, `Theme`/`themes.panel`,
`ScrubStore`/`ScrubState`, `MapViewStore`, `MapOptions` (`maplibre-gl`, только тип).

### ПОРЯДОК (TDD)
1. Контракт: тест `PanelRoute` (с/без `elevation`) → схема. 2. API: int-тест ключей и `elevation` → `elevationOf`,
`panelGeometry`, `view()`. 3. Пакет: перенос модулей с их тестами (зелёные без правок логики) → новые функции
(`geometryFromLine`, `guardWheelZoom`, `interactiveMapOptions`, `scrubValues`, `scrubKeyTarget`, `fractionAt`,
`profileTickValues`) тест-первыми → приложение на импорты пакета (`pnpm --filter @pokatim/app test` зелёный без
изменения ожиданий). 4. admin: `map-style`, загрузчик, `RouteMap` (мок загрузчика) → `ElevationProfile` →
`RouteScreen` → `RoutePreview`/ссылки → роутер. 5. CSP + сторож + Dockerfile/deploy. 6. e2e. 7. Документация.

### TEST MATRIX
| Уровень | Что |
|---|---|
| unit contracts | `PanelRoute`: `elevation` есть / нет (→ `null`) / профиль 1 точка — ошибка |
| int api (реальная Mongo) | `routes-admin.int.test.ts`: ключи ответа `GET /v1/admin/routes/:id` ровно `[…summary, line, elevation]`; готовый с профилем — `{ minM, maxM, profile }` (мин./макс. по профилю); готовый без профиля — `null`; `processing` автора — `line: []`, `elevation: null`; райдерский — 404; без `races.read` — 403 (как было). `routes-catalog-admin.int.test.ts`: ответ публикации содержит `elevation`. `routes-public.int.test.ts` — без изменений (зелёный после `elevationOf`) |
| unit route-view | перенесённые тесты; `geometryFromLine` (2 точки, 1 точка, нулевая рамка); `guardWheelZoom` (jsdom: без модификатора — до слушателя холста не доходит, `defaultPrevented` false, `onBlocked`; с `ctrlKey`/`metaKey` — доходит; отписка); `interactiveMapOptions` (`cooperativeGestures: false`, зум 2–17, наклон/вращение выкл.); `scrubValues`/`scrubKeyTarget`/`fractionAt`/`profileTickValues` |
| unit app (jest) | существующие тесты карты, профиля, формата — зелёные на импортах пакета |
| unit admin (vitest + Testing Library, мок `load-maplibre` как в приложении: фейковый `Map` с `on/addSource/addLayer/project/fitBounds/zoomIn/zoomOut/remove`) | `map-style` (`vi.stubEnv`); `RouteMap`: без загрузки — место карты с подписью; опции (`cooperativeGestures: false`), слои без коридора, линия 5; ошибка до `load` — сообщение, после — нет; кнопки ±/«в рамку»; маркер по `project`, перерасчёт на `move`; размонтирование — `remove`. `ElevationProfile`: `role="slider"`, ←/→ 1 км, Home/End, `aria-valuetext`, hover/drag (pointer events) двигают долю, маркер-стор ↔ курсор. `RouteScreen`: скелетон, 404, 403, ошибка с повтором, баннер обновления, `processing` (опрос), `failed` (причина), готовый без env (`LinePreview`, профиль и цифры есть), без `elevation`, действия только с `races.manage`. `RoutePreview`: компактная карта/фолбэк, ссылка `new-tab` в поле коридора. `RoutesScreen`: ссылка на страницу. Сторож CSP: origin стиля из `deploy-dev.yml` ∈ `connect-src`, есть `worker-src 'self' blob:` |
| e2e admin (`pnpm e2e:admin`) | `races.spec.ts` (или новый шаг): «Маршруты» → название → страница: цифры, профиль-слайдер (ArrowRight меняет `aria-valuetext`), без ошибок консоли/CSP. Рекомендуется: сборка смоука с `VITE_MAP_STYLE_LIGHT=${ORIGIN}/admin/__e2e__/map-style.json` и `page.route` (пустой стиль `{version:8,sources:{},layers:[]}`) — карта поднимает воркер под CSP без сети: CSP воркера и чанка проверяются в CI |
| ручная | dev-стенд: тайлы OpenFreeMap под CSP, Ctrl/⌘-колесо и тачпад, перетаскивание мышью, страница длинного маршрута — в pr.md (`NOT VERIFIED`, если не делалось) |

### OUT OF SCOPE
Скраббинг в компактной карте; карта гонки (коридор) в панели; тёмный стиль панели; смена провайдера; правка
`track-style.ts`/native-жестов приложения (кроме импортов из пакета).

## 12. Outcome (заполняет coder)


Статус: реализовано, не закоммичено (удаления файлов приложения — `git rm`, в индексе).

- **contracts:** `PanelRoute.elevation` = `CatalogRouteElevation.nullable().default(null)`; тест — с полем, без поля
  (`null`), профиль из 1 точки — ошибка.
- **api:** `route-elevation.ts` (`elevationOf`, общий с `routes-public.service.ts`), `RoutesRepository.panelGeometry`
  (проекция `{ line, profile }` одним запросом), `RoutesService.view()` → `elevation`. Int: ключи ответа ровно
  summary + `line` + `elevation`, мин./макс. по профилю, без профиля — `null`, `processing` автора — `[]`/`null`,
  райдерский — 404; ответ публикации содержит `elevation`. Права и контроллер — без изменений.
- **`@pokatim/route-view`** (новый пакет): перенос из приложения `route-layers` (← `corridor-style`), `camera`,
  `scrub-line`, `geometry` (+ `geometryFromLine`), `stores` (сторы скраббинга и вида), `attribution` (флаг `dark`),
  `map-locale`, `map-options` (`interactiveMapOptions`, `guardWheelZoom` 04c), `profile` (пути, оформление,
  `profileTickValues`, `scrubValues`, `scrubStep`, `scrubKeyTarget`, `fractionAt`), `pace`; тесты перенесены (vitest) +
  новые. Приложение импортирует из пакета, удалённые файлы — без шимов; ожидания тестов приложения не менялись.
- **admin:** `features/maps/` (`RouteMap`, `ScrubMarker`/`ScrubLayer`, `MapControls`, `load-maplibre` — async-чанк +
  воркер `?url`, `map-style`, `panel-map-theme`, `use-reduced-motion`), страница `RouteScreen` + маршрут
  `routes/$routeId`, `ElevationProfile`, `route-detail-format.ts`, `RoutePreview` → компактная карта/`LinePreview` +
  «Открыть маршрут» (`openLink`), ссылка-название в `RoutesScreen`, CSS, i18n `admin.routes.detail.*`. Сторож CSP —
  `src/csp.test.ts`.
- **infra:** CSP `admin-nginx.conf` (`connect-src` OpenFreeMap, `worker-src 'self' blob:`, `img-src blob:`),
  Dockerfile (`COPY packages/route-view/package.json`, `ARG VITE_MAP_STYLE_LIGHT`), `deploy-dev.yml` (build-arg admin;
  **не запушено** — нужен `gh` credential), `turbo.json` (env сборки).
- **docs:** ADR-0014 (п. 8 заменён, поправка routes-05, ссылка 04c на пакет), `AGENTS.md` §2, `pokatim-web.md`,
  `pokatim-app.md`, `pokatim-contracts.md`, `local-dev.md` («Панель»), `docs/product/routes.md`, `admin-panel.md`.
- **e2e:** `races.spec.ts` — «Маршруты» → название → страница: «Длина», профиль-слайдер (ArrowRight меняет
  `aria-valuetext`); подпись превью — `(Линия|Карта) маршрута`.

Проверки:
- `TURBO_CONCURRENCY=1 pnpm check` (Node 24, Mongo :27117 `pokatim_routes05_test`, Redis db 12) — зелёный: 15/15 задач;
  api 109 файлов, admin 31, app 137 наборов / 1207 тестов, route-view 9. Первый прогон упал на фикстурах
  `api-client` (`PanelRoute` без `elevation`) — исправлены, второй прогон зелёный.
- `vite build` admin: `maplibre-gl-*.js` (1,1 МБ) и `maplibre-gl-*.css` (71 КБ) — отдельные чанки, воркер —
  `assets/maplibre-gl-worker-*.mjs`.
- `pnpm e2e:admin` локально (Mailpit из brew, Mongo :27117, Redis db 13): 2/2 без стиля карты; 2/2 и с
  `VITE_MAP_STYLE_LIGHT=https://tiles.openfreemap.org/styles/positron` — карта под CSP `vite preview`, ошибок консоли
  нет (`expect(errors).toEqual([])`).
- NOT VERIFIED: ручная проверка на dev-стенде (тайлы под CSP nginx, Ctrl/⌘-колесо и тачпад, перетаскивание мышью,
  длинный маршрут); смоук со стабом стиля через `page.route` (рекомендация матрицы) не добавлен — CI идёт по
  `LinePreview`.
