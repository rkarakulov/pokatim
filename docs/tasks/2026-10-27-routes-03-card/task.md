# routes-03 — карточка маршрута: толстая линия, профиль высоты, время в пути, «Скачать GPX»

Уровень: task3. Ветка `feature/routes-03-card` от `origin/develop`. Связано: routes-01 (PR #52,
`docs/tasks/2026-10-27-routes-01-library/task.md`, `docs/product/routes.md`), ADR-0014 (карты), maps-01/maps-02.
Параллельно: routes-02 «Мои маршруты» (другая сессия) — тоже трогает модуль `routes` и экраны маршрутов; правки —
своими блоками, i18n — своими ключами, миграция нумеруется по `develop` в момент PR.

## 1. Title

Карточка маршрута каталога «как в вело-приложениях»: карта с толстой линией, чипы, стат-блок (дистанция, набор,
время в пути), площадной профиль высоты, «Скачать GPX».

## 2. Goal

Карточка `/routes/<id>` сейчас — тонкая линия и столбик строк «длина / набор / петля / город / покрытие». Райдер
выбирает маршрут по цифрам и рельефу и забирает его в навигатор. Нужно: читаемая линия на карте, профиль высоты с
мин./макс., оценка времени в пути, «Круговой / В одну сторону», скачивание GPX маршрута для навигатора.

## 2.1 Продуктовые решения (образец пользователя от 2026-10-27; автономный режим — решения сессии)

| # | Вопрос | Решение |
|---|---|---|
| P1 | Раскладка | сверху карта; под ней название, чипы (покрытия, «↻ Круговой» / «→ В одну сторону», город), стат-блок из трёх колонок, «Профиль высоты», действия, «Гонки на маршруте». Типографский герой с крупной длиной (`SectionHero`) с карточки убирается — длина в стат-блоке |
| P2 | Стат-блок | «Дистанция · 68 км · круговой / в одну сторону»; «Набор · ↑ 620 м · макс. 267 м» (нет набора — колонки нет, блок из двух колонок; нет профиля — без «макс.»); «В пути · 2 ч 30 мин · при 27 км/ч» |
| P3 | Время в пути `[ASSUMPTION]` | дистанция ÷ скорость по покрытию: асфальт **27 км/ч**, гравий **20 км/ч**, асфальт + гравий **24 км/ч**; покрытие неизвестно (`unknown`/пусто) — 27. Округление до 5 мин (минимум 5 мин). Набор высоты не учитывается (v1) |
| P4 | Профиль высоты | площадной график высоты по дистанции (≤ 300 точек), справа диапазон «191–267 м», ось X — км (4 подписи, «круглый» шаг). Нет высот в GPX — блока нет. Текстовая альтернатива: «Профиль высоты: от 191 до 267 м, набор 620 м» |
| P5 | «Скачать GPX» | очищенный GPX маршрута (только точки lat/lon/ele, без служебных метаданных исходника); web — скачивание файла, native — открыть ссылку в системном браузере (скачивание / «Открыть в…» делает ОС). Только маршрут, опубликованный в каталоге |
| P6 | Линия на карте | маршрут каталога — толще (5 px); карта гонки — без изменений. Старт/финиш — как на карте гонки (заливка/обводка, RC-5 maps-01), не как в образце: единый язык карт важнее (см. §8.2) |
| P7 | «Создать заезд», автор и аватар | вне scope: маршруты каталога — команды платформы, автора-человека нет; создание заезда (райда) с маршрутом — слайс «маршрут у райда» (D5 routes-01). См. §8.2 |

## 3. Scope

- **tracks (`packages/tracks`):**
  - `elevationProfile(points)` — профиль высоты: равные шаги по дистанции, ≤ `ROUTE_PROFILE_MAX_POINTS = 300` точек
    `[distanceM, elevationM]` (целые), концы маршрута сохранены, точки без высоты — пропуск (интерполяция между
    соседями с высотой), высот нет — `null`; сглаживание шума не сильнее, чем у набора (`ELEVATION_NOISE_M`), — решает
    architect;
  - `routeGpx(points)` — очищенный GPX 1.1: `creator="Pokatim"`, один `trk/trkseg`, `trkpt lat lon` (6 знаков) и `ele`
    (1 знак), без `name`/`desc`/`time`/`extensions`/`metadata` исходника; точки — упрощение линии сверки (1 м,
    ≤ 20 000) с высотами;
  - `analyzeRoute` возвращает дополнительно `profile` и `gpx` (строка или байты — structured clone); новая функция
    `deriveRoute(bytes)` для бэкфилла (то же разбором исходника, только `profile` + `gpx`) — в белый список
    `PARSE_FUNCTIONS`.
- **api (`routes`):**
  - данные: в `route_geometries` — `profile: [number, number][] | null` и `derivedVersion: number` (нет поля —
    профиль не посчитан); новая коллекция `route_exports` (`_id` = routeId, `gpx: Binary`, `sizeBytes`) — очищенный
    GPX; пишутся в той же транзакции `markReady`; миграция `00NN_routes_derived` (expand-only): создание коллекции
    `route_exports`, индекс для поиска маршрутов без профиля (если нужен — решает architect);
  - бэкфилл: регламент `routes-maintenance` в worker (расписание как `results-maintenance`, напр. каждые 10 мин; плюс
    один прогон при старте worker): готовые маршруты без `derivedVersion` (или с меньшей версией) — пачкой (≤ 20 за
    прогон), исходник из `route_sources` → `deriveRoute` в потоке разбора → `$set` профиля и версии + upsert экспорта;
    отказ разбора одного маршрута — лог без координат и пропуск (не блокирует остальные, повторяется в следующий
    прогон не бесконечно — architect: метка неудачи или та же версия с `profile: null`);
  - API: `CatalogRouteDetail` = `CatalogRouteCard` + `elevation: { minM, maxM, profile: [distanceM, elevationM][] } |
    null` + `gpxAvailable: boolean`; список (`CatalogRouteCard`) не меняется;
  - `GET /v1/routes/:id/gpx` — `PublicReadGuard` + отдельный IP-лимит `route-gpx` (`[ASSUMPTION]` 30/мин),
    `Cache-Control: public, max-age=60`, `Content-Type: application/gpx+xml; charset=utf-8`,
    `Content-Disposition: attachment; filename="pokatim-route.gpx"; filename*=UTF-8''<безопасное имя из названия>.gpx`,
    `X-Content-Type-Options: nosniff`; не в каталоге / неизвестен / экспорта нет — `404 NOT_FOUND`.
- **api-client:** URL скачивания GPX (`catalogRouteGpxUrl(id)`) — без fetch (скачивает браузер / ОС).
- **app:**
  - карта: новый необязательный пропс `RouteMap.lineWidth?: number` (по умолчанию — текущая `stroke.indicator`),
    `CatalogRouteMap` передаёт 5 px (`ROUTE_CATALOG_LINE_WIDTH`, через токены: `space.s1 + 1` нельзя — константа с
    комментарием в `corridor-style.ts`); карта гонки и её тесты не меняются;
  - карточка `route-detail.tsx`: раскладка P1, чипы, стат-блок P2, профиль высоты P4, действия P5/P6 («Поделиться»
    — primary, «Скачать GPX» — secondary, нет `gpxAvailable` — кнопки нет), «Гонки на маршруте» — как было;
  - профиль высоты — без новых зависимостей: площадь из `View`-столбиков (≤ 300 → ресэмплинг под ширину, без
    зазоров), подписи оси X и диапазон — `Text`; цвета — роли темы карты/акцента, без хардкода; SSR-безопасно
    (ширина — `onLayout`, до неё — место той же высоты);
  - время в пути и подписи — чистые функции в `features/routes/format.ts` (P3, константы `ROUTE_PACE_KMH`);
  - «Скачать GPX»: web — переход по URL API (`Content-Disposition: attachment` — страница остаётся), native —
    `expo-web-browser` / `Linking.openURL` (решает architect).
- **i18n:** свои ключи `routes.detail.*` (новый подблок `routes.detail.stats.*`, `routes.detail.profile.*`,
  `routes.detail.gpx*`, `routes.detail.chip.*`); устаревшие ключи карточки, ставшие ненужными, — удалить.
- **docs:** `docs/product/routes.md` (карточка, P1–P7), `.claude/rules/pokatim-security.md` (публичный GPX каталога),
  `pokatim-db.md` (`route_exports`, профиль, регламент), `docs/tasks/README.md`.

## 4. Out of Scope

- «Создать заезд» с маршрутом, автор маршрута, аватар (P7).
- Учёт набора высоты во времени в пути, персональная скорость райдера.
- Интерактивный профиль (палец/курсор с маркером на карте), уклоны цветом, полоса покрытия по участкам.
- Изменение карты гонки, стиля старта/финиша, коридора.
- Экспорт KML/FIT/TCX, отправка в Garmin/Komoot.
- GPX в панели (сотрудник и так имеет исходник).

## 5. Architecture Context

- `packages/tracks` — чистые функции; разбор исходника — только в потоке разбора worker (`runParseThread`,
  `pokatim-security.md`). API GPX **не разбирает**: отдаёт заранее посчитанный worker'ом очищенный файл.
- Геометрия готового маршрута неизменна; профиль и экспорт — производные данные исходника (версионируются
  `derivedVersion`, пересчитываются регламентом при росте версии).
- `routes-maintenance` — новая очередь worker; задачи идемпотентны (повтор = тот же результат).

## 5.1 Placement & Reuse Gate

- Reuse: `runParseThread`/`PARSE_FUNCTIONS`, `parseGpx`/`sanitizePoints`/`simplifyTrack`/`trackLengthMeters`
  (`packages/tracks`), `RoutesRepository` (единственный писатель), `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`,
  `rateLimitKeyForIp` + `RateLimiter`, `ResultsSchedules`-образец расписания, `RoutesPublicService.published`,
  `features/maps/*`, `formatDistances`/`minsk-format`, `routeKm`, `shareLink`, `Button`/`Banner` UI-кита, админский
  `SeriesChart` — как образец масштаба (не импорт: другой рантайм).
- Reuse (architect): `lib/open-external-url.ts` (native «Скачать GPX», RC-6), `components/stat-block.tsx` (+ `note`, RC-16), `Pill` UI-кита (чипы), `ensureCollection` миграций, `RESULTS_SCHEDULES`/`ResultsSchedules` — образец `RoutesSchedules`, `simplifyTrack` линии сверки — точки экспорта (одно вычисление), `PublicReadGuard` → общий `consumeIpLimit` (RC-5). Новое: `ElevationProfile` (`features/routes/`), `lib/download-file*.ts`.
- Запрещено: разбор GPX в API-процессе; координаты и название маршрута в логах; новая библиотека графиков/SVG без
  решения architect; смена существующих пропсов `RouteMap`; правка `race-route.schema.ts`; свой `fetch` в экранах.

## 6. Relevant Files

- `packages/tracks/src/{parse.ts,summary.ts,simplify.ts,track.ts}` + тесты, фикстуры `__fixtures__`
- `apps/api/src/parse-thread.ts`, `queues.ts`, `worker.module.ts`, `db/migrations/*`
- `apps/api/src/modules/routes/{route-processing.processor.ts,routes.collection.ts,routes.repository.ts,
  routes-public.*,routes.module.ts}` + int-тесты
- `packages/contracts/src/routes/route-catalog.schema.ts`, `packages/api-client/src/*`
- `apps/app/src/features/maps/{route-map.tsx,route-map.web.tsx,route-map-props.ts,corridor-style.ts}`
- `apps/app/src/features/routes/{route-detail.tsx,catalog-route-map.tsx,format.ts,queries.ts}`, `e2e/web.spec.ts`
- `packages/i18n`

## 7. Implementation Notes

- Профиль: шаг = `ceil(distance / 299)`, но не меньше 25 м; высота точки ряда — линейная интерполяция по дистанции.
- Мин./макс. — по профилю (не по сырым точкам: всплески GPS сглажены ресэмплингом), целые метры.
- Подписи оси X: шаг из ряда 1/2/5 × 10ⁿ км, 3–5 подписей, первая «0», единица «км» у последней.
- Имя файла: из названия — убрать управляющие символы и `\/:*?"<>|`, схлопнуть пробелы, ≤ 80 символов; пусто —
  `pokatim-route`; ASCII-fallback `filename="pokatim-route.gpx"`.

## 8. Risks / Assumptions / Open Questions

- A1 (P3): скорости 27/20/24 км/ч — допущение, правится константой.
- A2: лимит `route-gpx` 30/мин с IP.
- R1: параллельная routes-02 правит `routes` — конфликты в `routes.repository.ts`, `route-processing.processor.ts`,
  i18n; синхронизация с `develop` перед PR.
- R2: GPX публичен — раскрывает то же, что линия на карте (уже публична для каталога), плюс высоты; `time`,
  пульс, имя устройства исходника — вырезаются.
- R3: бэкфилл на dev — регламент сам доберёт маршруты после выката; проверка — `curl /v1/routes/<id>` (`elevation`).

## 8.1 Requirements Consistency (заполняет architect)

Architecture Review — routes-03-card: **CONCERNS** (блокеров нет). Ниже — решения по умолчанию для coder; P1–P7 не
пересматриваются. Человек может переиграть любое RC до старта coder.

- **RC-1 · Форма хранения производных данных и признак «посчитано» (решает architect).** Альтернативы: (a) в
  `route_geometries` — `profile: [distanceM, elevationM][] | null` и `derivedVersion: number` (нет поля — не посчитано;
  чтение `?? null`), очищенный GPX — отдельная коллекция `route_exports { _id: routeId, gpx: Binary, sizeBytes,
  derivedVersion }`; профиль, версия и экспорт пишутся **одной транзакцией** (в `markReady` и в бэкфилле) —
  инвариант «есть `derivedVersion` ⇒ есть экспорт», поэтому `gpxAvailable = derivedVersion !== null` (одно чтение
  геометрии с проекцией, без запроса к `route_exports`); (b) профиль и признак в документе `routes` — документы списка
  каталога (`listCatalog` читает их целиком, без проекции) потяжелеют на ~10 КБ профиля, а `routes` — изменяемый
  документ публикации; (c) GPX в `route_geometries` — `geometry()`/`displayLine` тянули бы ещё до ~1,2 МБ.
  **Рекомендация: (a).** Версия алгоритма — `ROUTE_DERIVED_VERSION = 1` в `@pokatim/tracks/parse` (как
  `CORRIDOR_ENGINE_VERSION`): меняется алгоритм профиля/экспорта — +1, регламент пересчитает. Линия, длина, `matchLine`
  готового маршрута по-прежнему не меняются; правило `pokatim-db.md` «геометрия пишется один раз» уточняется: «линии и
  длина — один раз; производные (`profile`, `derivedVersion`, `derivedFailure`, `route_exports`) — пересчитывает только
  регламент `routes-maintenance` по росту версии».
- **RC-2 · Отказ разбора в бэкфилле — не крутить бесконечно (решает architect).** Альтернативы: (a) метка
  `route_geometries.derivedFailure = { version, code, at }` на детерминированный отказ потока (`ok: false`: код файла,
  `timeout`, `unreadable`/OOM): маршрут исключается из выборки **для этой версии** навсегда (тот же исходник — тот же
  итог); исключение окружения (нет исходника, сбой загрузчика потока, ошибка записи) — лог и пропуск без метки, повтор в
  следующий прогон (сбой окружения ломает и всё остальное; на маршрут — один лог за прогон); рост версии снимает
  исключение (условие `'derivedFailure.version': { $ne: V }`), успешная запись — `$unset derivedFailure`;
  (b) `derivedVersion = V` + `profile: null` без экспорта — ломает инвариант RC-1 («без высот» и «отказ» неотличимы,
  `gpxAvailable` надо считать вторым запросом); (c) счётчик попыток (`attempts ≤ 3`) — лишнее состояние ради
  детерминированного отказа. **Рекомендация: (a).** Лог отказа — `routeId` и код, без названия и координат.
- **RC-3 · Индекс выборки бэкфилла (решает architect).** Документ `route_geometries` — до ~1 МБ (`matchLine` ≤ 20 000
  точек); COLLSCAN каждые 10 минут читал бы с диска все геометрии. **Решение: нужен** —
  `route_geometries_derived_idx { derivedVersion: 1 }` (не частичный: условие «нет поля или меньше» частичным фильтром не
  выражается). Запрос — `{ $or: [{ derivedVersion: null }, { derivedVersion: { $lt: V } }], 'derivedFailure.version':
  { $ne: V } }`, проекция `{ _id: 1 }`, `limit(20)`, без сортировки (оба плеча `$or` — IXSCAN; помеченные отказом
  отсекаются FETCH-фильтром, их единицы). После бэкфилла прогон — пустой скан индекса. Альтернативы: (b) без индекса —
  принять скан (маршрутов сотни, но документы тяжёлые); (c) признак на `routes` (лёгкие документы) — отвергнуто RC-1.
- **RC-4 · Кэш карточки (решает architect).** `RoutesCatalogService.displayCache` (LRU, неизменная линия) профиль **не**
  хранит, порт `RouteGeometry` (его читает `races` для карты гонки, ADR-0014) не меняется. `RoutesPublicService.get` после
  `findPublished` читает `RoutesRepository.derivedOf(id)` — `findOne({ _id }, { projection: { profile: 1,
  derivedVersion: 1 } })` без кэша в процессе: один запрос по `_id`, ответ и так `public, max-age=60`; устаревший `null`
  после бэкфилла живёт ≤ 60 с (HTTP-кэш), не до рестарта API. Альтернативы: (b) кэшировать только непустые профили —
  лишняя ветка ради одного чтения по `_id`; (c) положить профиль в `displayCache` — закэширует `null` до рестарта.
  **Рекомендация: без кэша.**
- **RC-5 · Где IP-лимит `route-gpx` (решает architect).** Альтернативы: (a) общий для `src/` гард
  `IpRateLimitGuard` + декоратор `@IpRateLimit(name, limit)` (метаданные через `Reflector`) в `src/public-read.guard.ts`;
  общая функция `consumeIpLimit(...)` — её же использует `PublicReadGuard` (ключ `<name>:<HMAC IP>`, 429 + `Retry-After`
  тем же `RATE_LIMITED`); на методе `gpx` — `@UseGuards(IpRateLimitGuard) @IpRateLimit('route-gpx',
  ROUTE_POLICY.gpxIpLimit)`: класс-гард `public-read` срабатывает первым, затем `route-gpx`, оба — до БД; (b) лимит в
  `RoutesPublicService` — сервис не знает IP, нужен проброс запроса; (c) свой гард в `modules/routes` с
  `rateLimitKeyForIp` — новая зависимость `routes → identity` (`pokatim-backend.md`: `routes` зависит только от `panel`
  и `src/public-read.guard.ts`). **Рекомендация: (a).** `ROUTE_POLICY.gpxIpLimit = { limit: 30, windowSec: 60 }`
  (`[ASSUMPTION]` A2).
- **RC-6 · «Скачать GPX» на native и web (решает architect).** Native — альтернативы: (a) системный браузер
  `Linking.openURL` через существующий `lib/open-external-url.ts` (Safari/Chrome скачивают `attachment` сами, «Открыть
  в…»/«Файлы»/загрузки — ОС); (b) `expo-web-browser.openBrowserAsync` — SFSafariViewController/Custom Tabs: скачивание
  внутри них ограничено и пропадает при закрытии листа; (c) `expo-file-system` + `expo-sharing` — две новые нативные
  зависимости (пересборка EAS) ради одной кнопки. **Рекомендация: (a)**, `expo-web-browser` не нужен. Web — альтернативы:
  (a) переход в той же вкладке по `<a href download>` (`attachment` — страница остаётся; prod — тот же origin); (b)
  `openExternalUrl` (новая вкладка — Safari оставляет пустую вкладку); (c) `fetch` → Blob → objectURL — свой HTTP вне
  api-client и `Access-Control-Expose-Headers` в dev. **Рекомендация: (a)**; принятый край: 404 (снят в эту минуту) и 429
  (≥ 30/мин с адреса) покажут JSON-страницу ошибки API — человеку недостижимо, кнопка есть только при `gpxAvailable`.
  Обе ветки — `lib/download-file.ts` / `lib/download-file.web.ts` (платформенная развилка файлом, §4.13); ошибка
  native (нет браузера) — баннер под кнопкой, адрес не логируется.
- **RC-7 · Профиль высоты без новых зависимостей и SSR (решает architect; отклонение от §3).** §3 предлагает ширину
  через `onLayout` и ресэмплинг «под ширину». Альтернативы: (a) **фиксированное число столбиков** — `profileBars(profile,
  PROFILE_BARS = 96)` (среднее по корзине, ≤ длины профиля), столбики `flex: 1` без зазоров, высота столбика — процент
  (раскладка, не px), высота графика — `aspectRatio` (прецедент `MAP_ASPECT_RATIO`): разметка зависит только от данных
  → SSR и первый клиентский рендер совпадают, ни `onLayout`, ни заглушки; ~3,6 px на столбик при 343 px, Yoga округляет
  к пиксельной сетке без щелей; (b) `onLayout` + ресэмплинг под ширину — второй рендер, SSR-заглушка, скачок; (c)
  `react-native-svg` — новая нативная зависимость (пересборка, web-полифил) без ADR — запрещено §5.1. **Рекомендация:
  (a).** Цвет площади — роль `theme.map.route` (контраст с `surface` не проверен — coder сверяет `contrastRatio` в тесте
  или берёт `theme.text.secondary`), подписи — `textStyle('label')`/`theme.text.secondary`; график для скринридера —
  один элемент `accessibilityRole="image"` с текстовой альтернативой P4, столбики скрыты.
- **RC-8 · Толщина линии каталога без px-литерала (конфликт §3 с §4.11).** §3: «5 px — константа с комментарием», а
  §4.11 запрещает px-литералы толщин. Альтернативы: (a) `ROUTE_CATALOG_LINE_WIDTH = stroke.bannerError +
  stroke.hairline` (4 + 1 = 5) в `corridor-style.ts` с комментарием — прецедент `SEGMENT_WIDTH = stroke.indicator +
  stroke.hairline` (`track-style.ts`, maps-02); (b) литерал `5` с комментарием — нарушение §4.11; (c) токен
  `map`-толщин в app-foundation — правильно в перспективе, но релиз базы ради одного числа. **Рекомендация: (a)** +
  follow-up «толщины карты в токены» вместе с RC-5 maps-01. API: `routeLayers(theme, widthM, bounds, lineWidth =
  stroke.indicator)` — четвёртый необязательный аргумент; `RouteMapProps.lineWidth?: number`; native — в `useMemo`
  слоёв (и в deps), web — в цикле `addLayer` (и в deps эффекта). Существующие пропсы и вызовы карты гонки не меняются.
- **RC-9 · Алгоритм профиля (недоопределённость §7, off-by-one).** «Шаг `ceil(D/299)`, концы сохранены» даёт до 301 точки.
  **Решение:** `n = clamp(floor(D / 25) + 1, 2, 300)`, `d_k = round(D · k / (n − 1))` — концы `0` и `D` точно (`D` —
  та же сумма haversine, что `distanceM`); высота точки — среднее высот исходных точек в окне `[d_k − h/2, d_k + h/2]`
  (`h` — шаг), пустое окно — линейная интерполяция между ближайшими точками с высотой по дистанции, за краями —
  ближайшая высота; округление до целых. Профиль `null` тогда и только тогда, когда `elevationGainM === null` (нет ни
  одной конечной `ele`) — одно условие, Набор и профиль не расходятся. Дополнительного сглаживания нет: окно шага
  (≥ 25 м) гасит всплески GPS не слабее гистерезиса 3 м набора. Мин./макс. — по профилю.
- **RC-10 · Совместимость контракта (порядок выката).** Старые приложения: `CatalogRouteDetail` — `z.object`, новые
  поля отбрасываются — совместимо. Новые клиенты (web SSR, приложение) против API до выката: строгие поля дали бы ошибку
  разбора карточки. Альтернативы: (a) в схеме ответа `elevation: CatalogRouteElevation.nullable().default(null)`,
  `gpxAvailable: z.boolean().default(false)` — новый клиент со старым API показывает карточку без профиля и GPX;
  (b) строгие поля + жёсткий порядок «API раньше web» в `pr.md`. **Рекомендация: (a).** `CatalogRouteCard` (список) не
  меняется; `CatalogRouteDetail` перестаёт быть алиасом карточки (`CatalogRouteCard.extend(...)`).
- **RC-11 · Для каких маршрутов считать производные.** Альтернативы: (a) для всех готовых (`route_geometries` без учёта
  каталога и `origin`): единый инвариант, публикация не требует пересчёта, «Мои маршруты» (routes-02) получат профиль
  без второго бэкфилла; цена — до ~1,2 МБ GPX на маршрут при пределе загрузки 5 МиБ исходника; (b) только опубликованные
  — бэкфилл должен реагировать на публикацию (ещё триггер). **Рекомендация: (a).** Выдача GPX — только каталогу
  (`findPublished`).
- **RC-12 · Параллельный routes-02 (R1).** routes-02 учит `analyzeRoute` KML и, вероятно, добавляет миграцию.
  **Решение:** routes-03 выносит общий шаг `loadRoutePoints(bytes): ParsedPoint[]` (сигнатура → разбор → очистка →
  ≥ 2 точек → пределы длины) в `parse.ts`; `analyzeRoute` и `deriveRoute` — поверх него, KML routes-02 добавляет туда
  же (иначе бэкфилл не разберёт KML-маршрут → `derivedFailure`). Миграция — `0021_routes_derived`; если routes-02
  влился раньше со своей `0021_*` — переименовать в `0022_routes_derived` до PR (на dev применяется только `develop`).
  Конфликты `markReady`/процессора/i18n — текстовые, сливает второй.
- **RC-13 · Прогон при старте worker и скорость бэкфилла.** `RoutesSchedules.onApplicationBootstrap`:
  `upsertJobScheduler('routes.maintenance', { pattern: '*/10 * * * *', tz: 'Europe/Minsk' }, { name: ROUTES_DERIVE_JOB })`
  и `queue.add(ROUTES_DERIVE_JOB, {}, { jobId: 'routes.derive.boot', removeOnComplete: true, removeOnFail: true })`
  (дедуп одновременного старта нескольких worker; опция `immediately` расписания не используется — её семантика
  менялась между версиями BullMQ). Прогон — ≤ 20 маршрутов (`ROUTE_POLICY.deriveBatch`); полная пачка — ставит
  продолжение `queue.add(ROUTES_DERIVE_JOB, {}, { jobId: 'routes.derive.more', removeOnComplete: true, removeOnFail:
  true })`: сотни старых маршрутов догоняются за минуты, а не часы, при этом каждый вызов потока отпускает семафор
  `PARSE_THREADS_MAX` (разбор новых маршрутов и сверка попыток не ждут всю пачку).
- **RC-14 · Безопасное имя файла (уточнение §7).** К списку §7 добавить: удалить `\p{Cc}` и `\p{Cf}` (в т. ч. bidi
  `U+202E` — подмена расширения «…gpx.exe» визуально), обрезать точки и пробелы по краям, ≤ 80 **кодовых точек** (не
  резать суррогатную пару), `.gpx` дописывает сервер; `filename*` — RFC 5987: `encodeURIComponent` + `'()*` → `%XX`.
  Дополнительно к заголовкам §3 — `Content-Security-Policy: default-src 'none'; sandbox` (файл не исполняется, даже если
  браузер решит его показать). Функция — чистая `gpxFileName(title)` в `routes.policy.ts`.
- **RC-15 · Подписи оси X (P4 «4 подписи» против §7 «3–5»).** Берётся §7: шаг — наименьший из 1/2/5 × 10ⁿ км, при
  котором подписей (с «0») ≤ 5; если их < 3 и шаг можно уменьшить — следующий меньший; «км» — у последней; последняя
  подпись не выходит за правый край (выравнивание по правому краю у конца оси). P4 «4 подписи» — пример (68 км → 0, 20,
  40, 60 км).
- **RC-16 · Стат-блок и чипы — reuse.** P2 требует третьей строки в колонке («круговой», «макс. 267 м», «при 27 км/ч»),
  у `components/stat-block.tsx` её нет. **Решение:** необязательный `StatItem.note?: string` (строка под подписью,
  `textStyle('label')`, входит в `accessibilityLabel`); райды и календарь не меняются. Чипы — `Pill` из `@rkarakulov/ui`
  (не интерактивны; `Chip` — переключатель фильтра). Новый компонент — только `ElevationProfile` в
  `features/routes/`.

## 8.2 Deviations from spec

- P6: старт/финиш оставлены в стиле карты гонки (старт — заливка, финиш — обводка), образец — наоборот.
- P7: «Создать заезд» и автор с аватаром не делаются: автора-человека у маршрута каталога нет (`origin:
  'platform'`), заезд с маршрутом — слайс «маршрут у райда».
- Coder (routes-03): заголовки файла `GET /v1/routes/:id/gpx` (`Content-Type`, `Content-Disposition`, `nosniff`, CSP)
  ставятся через `HttpAdapterHost.setHeader` **после** чтения экспорта, а не `@Header`: Nest пишет `@Header` до
  обработчика, и 404 с `Content-Type: application/gpx+xml` не сериализовался в JSON ошибки (500 — пойман int-тестом).
  `Cache-Control` — по-прежнему `@Header`. Ошибки 404/429 — JSON без заголовков файла (тест).
- Coder: выборка бэкфилла — `{ derivedVersion: { $exists: false } }` вместо `{ derivedVersion: null }` (типы драйвера
  не допускают `null` для `number | undefined`; поле никогда не пишется `null` — семантика та же); план — IXSCAN
  `route_geometries_derived_idx` (int-тест через профилировщик).
- Coder: `profileSummary(elevation, gainM)` и `profileRangeLabel(elevation)` — вместо `profileSummary(route)`;
  `routeChips(route)` — новая чистая функция чипов (покрытия → форма → город). `elevationProfile`/`routeGpx`/
  `ROUTE_PROFILE_MAX_POINTS` дополнительно реэкспортированы из `@pokatim/tracks/parse`.
- Coder: цвет площади профиля — `theme.map.route`; контраст с `surface.default` ≥ `WCAG.ui` в обеих темах — тест
  `elevation-profile.test.tsx`.
- Coder: `docs/tasks/README.md` не менялся — в нём нет индекса задач (только описание артефактов).

## 8.3 Security checklist

- Публичный эндпоинт файла: IP-лимит, кэш, `attachment` + `nosniff`, безопасное имя, только каталог.
- Очистка GPX: только координаты и высоты (без времени, датчиков, устройства, автора).
- Разбор — только поток worker; логи без координат и названий.

## 9. Acceptance Criteria

1. Маршрут каталога на карте — линия 5 px; карта гонки — прежняя (тесты maps-01/02 зелёные без правок).
2. Новый маршрут: после разбора `GET /v1/routes/:id` отдаёт `elevation` (≤ 300 точек, `minM ≤ maxM`, первая точка
   `0`, последняя ≈ `distanceM`) и `gpxAvailable: true`; без высот — `elevation: null`, `gpxAvailable: true`.
3. Старый маршрут (без производных данных): после прогона регламента — то же, что п. 2; до прогона — `elevation:
   null`, `gpxAvailable: false`, карточка без профиля и без кнопки GPX.
4. `GET /v1/routes/:id/gpx` — 200, заголовки §3, тело — валидный GPX, без `time`/`extensions`/`metadata`/имени
   исходника; не в каталоге / неизвестный / без экспорта — 404; лимит — 429 + `Retry-After`.
5. Карточка: раскладка P1, чипы, стат-блок P2 (время по P3), профиль P4 с текстовой альтернативой, «Поделиться»
   (primary), «Скачать GPX» (secondary; web — скачивание, native — системный браузер).
6. Состояния карточки §4.12 как в routes-01 (скелетон, 404, ошибка, офлайн); SSR карточки рендерит профиль без
   ошибок гидрации.
7. `TURBO_CONCURRENCY=1 pnpm check` зелёный.

## 10. Documentation Impact

`docs/product/routes.md`, `.claude/rules/pokatim-security.md`, `.claude/rules/pokatim-db.md`,
`docs/tasks/README.md`.

Architect (дополнение): `.claude/rules/pokatim-backend.md` (очередь `routes-maintenance`, `IpRateLimitGuard`/`consumeIpLimit` в `src/public-read.guard.ts`, `deriveRoute` в `PARSE_FUNCTIONS`), `.claude/rules/pokatim-db.md` — уточнение «готовый маршрут не меняется» (RC-1), индекс `route_geometries_derived_idx`, `route_exports`, миграция `0021_routes_derived`; `pr.md` — миграция и новая очередь worker (бэкфилл стартует сам).

## 11. Implementation Context

Architect, 2026-10-27. Решения — §8.1 (RC-1…RC-16). Код не написан.

### ENTRY POINTS

- `packages/tracks/src/parse.ts` — `analyzeRoute` (расширение), новые `deriveRoute`, `loadRoutePoints`,
  `ROUTE_DERIVED_VERSION`.
- `apps/api/src/modules/routes/route-processing.processor.ts` — запись производных в `markReady`.
- Новый `apps/api/src/modules/routes/routes-maintenance.processor.ts` — регламент бэкфилла.
- `apps/api/src/modules/routes/routes-public.controller.ts` — `GET routes/:id/gpx`; `routes-public.service.ts` — `elevation`,
  `gpxAvailable`, `gpx(id)`.
- `apps/app/src/features/routes/route-detail.tsx` — раскладка P1.

### Эндпоинты, видимость, коды

| Метод и путь | Гарды | Ответ | Отказы |
|---|---|---|---|
| `GET /v1/routes/:id` | `PublicReadGuard` (класс) | `CatalogRouteDetail` (+ `elevation`, `gpxAvailable`), `public, max-age=60` | 404 `NOT_FOUND` (не в каталоге/не готов/неизвестен), 400 не-UUID, 429 |
| `GET /v1/routes/:id/gpx` | `PublicReadGuard` → `IpRateLimitGuard` (`route-gpx` 30/60 с) | 200 `application/gpx+xml; charset=utf-8`, тело — байты `route_exports.gpx`; заголовки §3 + `Content-Security-Policy: default-src 'none'; sandbox` | 404 `NOT_FOUND` (не в каталоге/неизвестен/нет экспорта), 400 не-UUID, 429 + `Retry-After` |

Объявить `routes/:id/gpx` рядом с `routes/:id/map` (статических конфликтов нет). Заголовки с именем файла — через
`HttpAdapterHost.httpAdapter.setHeader(reply, …)` с `@Res({ passthrough: true }) reply: unknown` (образец
`modules/identity/session-cookie.ts`), `Cache-Control` — `@Header(..., PUBLIC_READ_CACHE_CONTROL)`; возврат — `Buffer`.
Ошибки до записи заголовков (404 — JSON ошибки, без `Content-Disposition`).

### FILES TO MODIFY / CREATE

**packages/tracks**
- `src/route-profile.ts` (новый, лёгкий вход — без парсеров): `export const ROUTE_PROFILE_MAX_POINTS = 300;
  export const ROUTE_PROFILE_MIN_STEP_M = 25; export function elevationProfile(points: readonly TrackPoint[]):
  [number, number][] | null` — RC-9. Экспорт из `src/index.ts` не обязателен (приложению не нужен); достаточно
  `parse.ts`.
- `src/route-gpx.ts` (новый): `export function routeGpx(points: readonly TrackPoint[]): string` — `<?xml version="1.0"
  encoding="UTF-8"?>`, `<gpx version="1.1" creator="Pokatim" xmlns="http://www.topografix.com/GPX/1/1">`, один
  `<trk><trkseg>`, `<trkpt lat="…" lon="…">` (`toFixed(6)`), `<ele>` (`toFixed(1)`) только при конечной `ele`; ни
  `metadata`, ни `name`, ни `time`, ни `extensions`. Без интерполяции строк из исходника — только числа.
- `src/parse.ts`:
  - `export const ROUTE_DERIVED_VERSION = 1;` (комментарий: +1 при смене `elevationProfile`/`routeGpx`/допуска точек
    экспорта — регламент пересчитает);
  - `function loadRoutePoints(bytes: Uint8Array): ParsedPoint[]` — вынести из `analyzeRoute` (сигнатура GPX → `parseGpx`
    с `allowRoute`, `maxPoints: ROUTE_MAX_POINTS` → `sanitizePoints` → `< 2` `no_track` → длина `too_short`/`too_long`),
    RC-12;
  - `RouteAnalysis` + `profile: [number, number][] | null; gpx: string;` — `analyzeRoute`: `matchPoints =
    simplifyTrack(points, MATCH_LINE_TOLERANCE_M, MATCH_LINE_MAX_POINTS)` вычисляется **один раз**: `matchLine =
    matchPoints.map(lonLat)` (золотые значения не меняются), `gpx = routeGpx(matchPoints)`, `profile =
    elevationProfile(points)`;
  - `export interface RouteDerived { profile: [number, number][] | null; gpx: string }`;
    `export function deriveRoute(bytes: Uint8Array): RouteDerived` — `loadRoutePoints` → те же `profile`/`gpx`, что
    `analyzeRoute` (тест на равенство).
- `src/__fixtures__/` — при необходимости `route-no-ele.gpx` (маршрут без `<ele>`) и маршрут с `time`/`extensions`/
  `metadata` (можно взять `garmin-connect.gpx`/`strava.gpx` — в них есть `time` и датчики).

**apps/api**
- `src/parse-thread.ts` — `'deriveRoute'` в конец `PARSE_FUNCTIONS`; комментарий семафора дополнить `routes-maintenance`.
- `src/queues.ts` — `routesMaintenance: 'routes-maintenance'` (комментарий: регламент производных маршрута, RC-13).
- `src/public-read.guard.ts` — `export async function consumeIpLimit(limiter, secret, clock, ip, name, limit): Promise<void>`
  (бросает `RATE_LIMITED` 429 с `retryAfterSec`); `PublicReadGuard` — через неё (поведение и ключ `public-read:` прежние);
  `export const IpRateLimit = (name: string, limit: { limit: number; windowSec: number }) => SetMetadata(...)`;
  `@Injectable() export class IpRateLimitGuard` (читает метаданные `Reflector`; нет метаданных — ошибка конфигурации,
  `throw new Error`). RC-5.
- `src/modules/routes/routes.collection.ts`:
  - `ROUTES_COLLECTIONS.exports = 'route_exports'`;
  - `RouteGeometryDoc` + `profile?: [number, number][] | null; derivedVersion?: number; derivedFailure?: { version:
    number; code: string; at: Date };` (документы до 0021 полей не имеют — чтение `?? null`);
  - `export interface RouteExportDoc { _id: string; gpx: Binary; sizeBytes: number; derivedVersion: number }`;
  - `RoutesCollections.exports`, `routesCollections` — дополнить.
- `src/modules/routes/routes.repository.ts`:
  - `markReady(session, id, fields, geometry: Omit<RouteGeometryDoc, '_id' | 'derivedFailure'>, gpx: Uint8Array, now)`:
    после `replaceOne` геометрии (с `profile`, `derivedVersion`) — `exports.replaceOne({ _id: id }, { gpx: new
    Binary(gpx), sizeBytes: gpx.byteLength, derivedVersion }, { session, upsert: true })`;
  - `pendingDerived(version: number, limit: number): Promise<string[]>` — запрос RC-3, проекция `_id`;
  - `recordDerived(session, id, version, profile, gpx: Uint8Array): Promise<boolean>` — `geometries.updateOne({ _id: id,
    $or: [{ derivedVersion: null }, { derivedVersion: { $lt: version } }] }, { $set: { profile, derivedVersion: version },
    $unset: { derivedFailure: '' } }, { session })`; `matchedCount === 0` → `false` (уже посчитан — без экспорта); иначе
    upsert экспорта в той же сессии;
  - `markDerivedFailed(id, version, code, now): Promise<void>` — `updateOne({ _id: id }, { $set: { derivedFailure: {
    version, code, at: now } } })`;
  - `derivedOf(id): Promise<{ profile: [number, number][] | null; derivedVersion: number | null } | undefined>` — проекция
    `{ profile: 1, derivedVersion: 1 }`;
  - `exportGpx(id): Promise<Uint8Array | undefined>` — проекция `{ gpx: 1 }`.
  - Комментарий класса: производные пишутся только `markReady` и `recordDerived`, обе — с экспортом в одной транзакции
    (инвариант RC-1).
- `src/modules/routes/route-processing.processor.ts` — `markReady(..., { line, matchLine, sourcePointCount, profile:
  analysis.profile, derivedVersion: ROUTE_DERIVED_VERSION }, new TextEncoder().encode(analysis.gpx), now)`.
- `src/modules/routes/route-derived.ts` (новый, `@Injectable() RouteDerivedBackfill`): `derive(bytes):
  Promise<ThreadOutcome<RouteDerived>>` (точка подмены в тестах, `runParseThread('deriveRoute', [bytes],
  ROUTE_POLICY.parseLimits)`); `run(): Promise<{ derived: number; failed: number; skipped: number; more: boolean }>` —
  `pendingDerived(V, deriveBatch)` → по одному: `sourceBytes` (нет — лог, `skipped`) → `derive` → `!ok` —
  `markDerivedFailed` + лог `route <id> derive failed: <code>` → `ok` — `transactions.run(tx => recordDerived(...))`;
  исключение по маршруту — лог без координат и названия, `skipped`, к следующему; `more = ids.length === batch`.
- `src/modules/routes/routes-maintenance.processor.ts` (новый): `export const ROUTES_DERIVE_JOB = 'derive'`,
  `ROUTES_SCHEDULES` (образец `RESULTS_SCHEDULES`), `@Processor(QUEUE.routesMaintenance) RoutesMaintenanceProcessor`
  (неизвестное имя — `throw`; `run()`; `more` → `queue.add(ROUTES_DERIVE_JOB, {}, { jobId: 'routes.derive.more',
  removeOnComplete: true, removeOnFail: true })`), `@Injectable() RoutesSchedules implements OnApplicationBootstrap` —
  upsert расписаний + разовый `routes.derive.boot` (RC-13).
- `src/modules/routes/routes.module.ts` — `RoutesWorkerModule`: `BullModule.registerQueue({ name:
  QUEUE.routeProcessing }, { name: QUEUE.routesMaintenance })`, провайдеры `RouteDerivedBackfill`,
  `RoutesMaintenanceProcessor`, `RoutesSchedules`; `RoutesModule` — `IpRateLimitGuard` в providers.
- `src/modules/routes/routes.policy.ts` — `gpxIpLimit: { limit: 30, windowSec: 60 }`, `deriveBatch: 20`;
  `export function gpxFileName(title: string): string` (без `.gpx`) и `export function gpxContentDisposition(title):
  string` (RC-14).
- `src/modules/routes/routes-public.service.ts`:
  - `toCatalogDetail(route, derived)`: `elevation = profile ? { minM, maxM, profile } : null` (`min`/`max` по второй
    координате), `gpxAvailable = derivedVersion !== null`;
  - `get(id)` — `published` → `derivedOf` (RC-4);
  - `gpx(id): Promise<{ bytes: Uint8Array; title: string }>` — `published` → `exportGpx` → нет — `notFound()`.
- `src/modules/routes/routes-public.controller.ts` — метод `gpx` (таблица выше).
- `src/db/migrations/0021_routes_derived.ts` (новый): `ensureCollection(db, 'route_exports')`, индекс
  `route_geometries_derived_idx { derivedVersion: 1 }`; expand-only, без транзакции, без бэкфилла данных (бэкфилл —
  регламент). `migrations/index.ts` — в конец (RC-12 — номер по `develop` в момент PR).
- `src/admin-routes.test.ts` — не трогать (новый путь не `/v1/admin/*`).

**packages/contracts**
- `src/routes/route-catalog.schema.ts`:
  - `export const CATALOG_ROUTE_PROFILE_MAX_POINTS = 300;`
  - `export const CatalogRouteElevation = z.object({ minM: z.number().int(), maxM: z.number().int(), profile:
    z.array(z.tuple([z.number().int().min(0), z.number().int()])).min(2).max(CATALOG_ROUTE_PROFILE_MAX_POINTS) })`;
  - `CatalogRouteDetail = CatalogRouteCard.extend({ elevation: CatalogRouteElevation.nullable().default(null),
    gpxAvailable: z.boolean().default(false) })` (RC-10); комментарий `GET /v1/routes/:id/gpx` (ответ — не JSON, схемы
    нет).
- `src/routes/route-catalog.schema.test.ts` — новые случаи. Индекс экспорта `src/index.ts` — проверить.

**packages/api-client**
- `src/index.ts` — `catalogRouteGpxUrl: (id: string) => \`${baseUrl}/v1/routes/${encodeURIComponent(id)}/gpx\`` (без
  запроса, как `trackUploadRequest`); `src/routes.test.ts` — URL и разбор `CatalogRouteDetail` без новых полей
  (дефолты).

**apps/app**
- `src/features/maps/corridor-style.ts` — `ROUTE_CATALOG_LINE_WIDTH` (RC-8), `routeLayers(..., lineWidth =
  stroke.indicator)`; `route-map-props.ts` — `lineWidth?: number` (JSDoc: routes-03, по умолчанию `stroke.indicator`);
  `route-map.tsx`, `route-map.web.tsx` — проброс + deps.
- `src/features/routes/catalog-route-map.tsx` — `lineWidth={ROUTE_CATALOG_LINE_WIDTH}`.
- `src/features/routes/format.ts` — `ROUTE_PACE_KMH = { asphalt: 27, gravel: 20, mixed: 24 } as const`,
  `routePaceKmh(surfaces): number` (известные покрытия; ни одного — 27), `routeDurationMin(distanceM, paceKmh): number`
  (округление до 5, минимум 5), `routeDuration(min): string` («2 ч 30 мин», «45 мин», «3 ч»), `routeShape(isLoop)`
  («Круговой»/«В одну сторону»), `routeStatItems(route): StatItem[]` (P2: 3 или 2 колонки), `profileTicks(distanceM):
  { km: number; label: string }[]` (RC-15), `profileBars(profile, n): number[]`, `profileRangeLabel(elevation)`
  («191–267 м»), `profileSummary(route)` (текстовая альтернатива P4).
- `src/features/routes/elevation-profile.tsx` (новый): `ElevationProfile({ elevation, distanceM, gainM })` — RC-7; блок
  с заголовком «Профиль высоты»; `elevation === null` — `null`.
- `src/components/stat-block.tsx` — `StatItem.note?: string` (RC-16) + тест.
- `src/lib/download-file.ts` (native → `openExternalUrl`) и `src/lib/download-file.web.ts` (`<a href rel="noopener"
  download>` + `click()` синхронно в обработчике) + тесты (RC-6).
- `src/features/routes/route-detail.tsx` — P1: убрать `SectionHero` и строки `Row`; порядок — `CatalogRouteMap`,
  название (`textStyle('displaySm')`, `accessibilityRole="header"`), чипы (`Pill`: покрытия, «↻ Круговой»/«→ В одну
  сторону», город; `'unknown'` — без чипа), `StatBlock items={routeStatItems(route)}`, `ElevationProfile`, действия
  (`ShareAction` — `variant="primary"`; `GpxAction` — `variant="secondary"`, только `route.gpxAvailable`, ошибка — баннер
  `routes.detail.gpxFailed`), `RouteRaces`. Скелетон `AsyncContent` — повторить новую раскладку (место карты, строка
  названия, стат-блок, профиль).
- `packages/i18n/src/ru.ts` — новые `routes.detail.stats.*` (distance, gain, time, loop, oneWay, max, pace, hours/
  minutes), `routes.detail.profile.*` (title, range, summary), `routes.detail.chip.*` (loop, oneWay), `routes.detail.gpx`,
  `routes.detail.gpxFailed`; удалить ставшие ненужными (`routes.detail.kicker`, `length`, `elevation`, `elevationValue`,
  `loop`, `yes`, `no`, `city`, `surface`) — только после `grep` по `apps/` (Главная и OG могут использовать).

**e2e / docs** — `apps/app/e2e/web.spec.ts`, документы §10.

### TYPES & SCHEMAS

```ts
// @pokatim/tracks/parse
export const ROUTE_DERIVED_VERSION: number;
export interface RouteAnalysis { /* как было */ profile: [number, number][] | null; gpx: string }
export interface RouteDerived { profile: [number, number][] | null; gpx: string }
export function deriveRoute(bytes: Uint8Array): RouteDerived;
// @pokatim/contracts
export type CatalogRouteElevation = { minM: number; maxM: number; profile: [number, number][] };
export type CatalogRouteDetail = CatalogRouteCard & { elevation: CatalogRouteElevation | null; gpxAvailable: boolean };
```

### Данные, миграции, индексы (`pokatim-db.md`)

- `route_geometries`: `profile`, `derivedVersion`, `derivedFailure` (необязательные); индекс
  `route_geometries_derived_idx { derivedVersion: 1 }` (RC-3).
- `route_exports` (новая, `_id` = routeId): `gpx: Binary` (≤ ~1,2 МБ: ≤ 20 000 `trkpt`), `sizeBytes`, `derivedVersion`;
  без вторичных индексов (чтение по `_id`). Единственный писатель — `RoutesRepository`.
- Миграция `0021_routes_derived` — expand-only, идемпотентна; contract-фазы нет.

### FILES TO READ

`packages/tracks/src/{parse.ts,simplify.ts,summary.ts,geo.ts,gpx.ts}`, `analyze-route.test.ts`; `apps/api/src/
{parse-thread.ts,public-read.guard.ts,queues.ts,worker.module.ts}`; `modules/routes/*`; `modules/results/
results-maintenance.processor.ts` (образец расписания) и `results-check.int.test.ts:420–440` (тест регламента);
`modules/identity/session-cookie.ts` (заголовки через адаптер); `db/migrations/{0013_routes,0020_routes_catalog}.ts`,
`migrations.int.test.ts`; `apps/app/src/{features/routes/*,features/maps/*,components/stat-block.tsx,lib/
open-external-url*.ts,app/routes/[id].tsx}`; `apps/app/e2e/{web.spec.ts,schedule-fixture.ts}`; routes-02 task.md (R1).

### TESTS

| Слой | Файл | Что |
|---|---|---|
| unit tracks | `route-profile.test.ts` (новый) | ≤ 300 точек, шаг ≥ 25 м, первая `[0, …]`, последняя `[distanceM, …]` (равна `analyzeRoute.distanceM`), дистанции строго растут, целые; точки без `ele` — интерполяция; высот нет — `null`; одна высота — ровный профиль; всплеск +50 м на одной точке гасится окном; короткий маршрут (1 км) — 41 точка |
| unit tracks | `route-gpx.test.ts` (новый) | шапка 1.1, `creator="Pokatim"`, один `trk/trkseg`; 6/1 знаков; нет `ele` — без `<ele>`; на `garmin-connect.gpx`/`strava.gpx` — в выходе нет `<time>`, `<extensions>`, `<metadata>`, `<name>`, `hr`; выход снова разбирается `parseGpx` (тот же счёт точек) |
| unit tracks | `analyze-route.test.ts` | `profile`/`gpx` у `route-loop.gpx`, `route-rte.gpx`; `matchLine`/`line` — прежние значения (регрессия); `deriveRoute(bytes)` ≡ `{ profile, gpx }` из `analyzeRoute`; отказы `deriveRoute` — те же коды (`xxe.gpx`, `route-short.gpx`) |
| unit api | `parse-thread.test.ts` | `deriveRoute` в потоке: результат и отказ кодом |
| unit api | `routes.policy.test.ts` (новый) | `gpxFileName`: управляющие, `\/:*?"<>|`, `U+202E`, пробелы, 80 кодовых точек (эмодзи не режется пополам), пусто → `pokatim-route`; `gpxContentDisposition` — RFC 5987 (`'()*` экранированы), ASCII-fallback |
| unit api | `routes-schedules.test.ts` (новый, образец `identity-schedules.test.ts`) | upsert расписания + разовая задача `routes.derive.boot` |
| int api | `routes-admin.int.test.ts` | обработка нового маршрута пишет `profile`, `derivedVersion = ROUTE_DERIVED_VERSION` и `route_exports` в одной транзакции; повтор задачи — без второго экспорта |
| int api | `routes-derived.int.test.ts` (новый) | «старый» маршрут (`$unset profile/derivedVersion`, без экспорта) → `run()` пишет оба; второй прогон — 0; пачка 20 из 25 → `more: true`, остаток — следующим; подмена `derive` → `{ ok: false, code: 'timeout' }` → `derivedFailure`, следующий прогон его не берёт; рост версии (подмена `V`) — берёт снова; исключение (нет исходника) — без метки, остальные обработаны; план `pendingDerived` — IXSCAN `route_geometries_derived_idx` (`explain`); обработчик неизвестного имени задачи — ошибка |
| int api | `routes-public.int.test.ts` | ключи карточки — ровно контрактные (+ `elevation`, `gpxAvailable`); без производных — `elevation: null, gpxAvailable: false`; без высот — `elevation: null, gpxAvailable: true`; с высотами — `minM ≤ maxM`, ≤ 300, `[0, …]`…`[distanceM, …]`; GPX: 200, все заголовки §3 + CSP, тело — валидный GPX без `time`/`metadata`/`extensions`/названия; 404 — не опубликован, снят, `processing`, неизвестный, без экспорта; 400 не-UUID; 31-й запрос с адреса — 429 + `Retry-After`, другой адрес не задет, `public-read` по-прежнему 300 |
| int api | `migrations.int.test.ts` | `0021_routes_derived`: коллекция и индекс, повторный `up` — без ошибки, порядок после `0020` |
| unit contracts / api-client | `route-catalog.schema.test.ts`, `routes.test.ts` | дефолты `elevation`/`gpxAvailable`; профиль > 300 и дробные — отказ; `catalogRouteGpxUrl` экранирует id |
| unit app | `corridor-style.test.ts`, `route-map.web.test.tsx` | по умолчанию `line-width` = `stroke.indicator`; `lineWidth` — в слое `route`; `ROUTE_CATALOG_LINE_WIDTH === 5`; карта гонки (тесты maps-01/02) — без правок |
| unit app | `format.test.ts` | темп по покрытиям (asphalt 27, gravel 20, оба 24, пусто/unknown 27); 68 км/27 → «2 ч 30 мин»; минимум 5 мин; округление до 5; `profileTicks` (68 км → 0/20/40/60 км; 5 км; 1,2 км); `profileBars` (≤ n, средние); стат-блок 3/2 колонки и «макс.» только с профилем |
| unit app | `stat-block.test.tsx`, `download-file*.test.ts`, `route-detail.test.tsx` (`__tests__`), `elevation-profile.test.tsx` | `note` в разметке и a11y; native → `openExternalUrl(url)`, web — клик по ссылке синхронно, адрес не в логах; карточка: без героя, чипы, стат-блок, профиль с текстовой альтернативой, «Поделиться» primary, «Скачать GPX» secondary только при `gpxAvailable`, нажатие → `downloadFile(api.catalogRouteGpxUrl(id))`; профиль без `onLayout` (рендер идентичен до/после монтирования) |
| e2e web | `e2e/web.spec.ts` (тест routes-01 расширить) | с API: ожидать `gpxAvailable` опросом `GET /v1/routes/:id` (маршрут смоука мог появиться до слайса — бэкфилл при старте worker); SSR-HTML карточки содержит «Профиль высоты» и текстовую альтернативу; после гидрации — без ошибок консоли (фикстура `console-errors`); «Скачать GPX» → событие `download` с именем `*.gpx`; `request.get(.../gpx)` — 200, `content-disposition: attachment` |

### Порядок реализации (TDD)

1. tracks: тесты → `route-profile.ts`, `route-gpx.ts` → `loadRoutePoints`, `analyzeRoute`, `deriveRoute`,
   `ROUTE_DERIVED_VERSION`.
2. contracts + api-client: схема и URL (тесты сначала).
3. api данные: коллекция, миграция `0021`, репозиторий, `markReady` + процессор; int-тесты обработки и миграции.
4. api регламент: очередь, `RouteDerivedBackfill`, процессор, расписания, `RoutesWorkerModule`; int-тест бэкфилла.
5. api публичное: `consumeIpLimit`/`IpRateLimitGuard`, `gpxContentDisposition`, сервис и контроллер; int-тесты.
6. app карта: `lineWidth` (тесты карты гонки не трогать).
7. app карточка: `format.ts`, `StatBlock.note`, `download-file*`, `ElevationProfile`, `route-detail.tsx`, i18n.
8. e2e, документы §10; `TURBO_CONCURRENCY=1 pnpm check`.

### OUT OF SCOPE

§4; плюс: правка `RouteGeometry`-порта и `displayCache`; `race-route.schema.ts`; карта гонки; GPX райдерских маршрутов
наружу (routes-02); `expo-web-browser`/`expo-file-system`/`expo-sharing`/`react-native-svg`; токены карты в
app-foundation (follow-up RC-8).

## 12. Outcome (заполняет coder)

Coder, 2026-10-27. Реализовано по §3, §8.1 (RC-1…RC-16), §11; отклонения — §8.2 (пункты «Coder»).

- **tracks:** `route-profile.ts` (`elevationProfile`, RC-9: `n = clamp(floor(D/25)+1, 2, 300)`, среднее окна шага,
  интерполяция пустых окон, `null` ⇔ нет высот), `route-gpx.ts` (`routeGpx`, GPX 1.1 только `trkpt`/`ele`);
  `parse.ts` — `loadRoutePoints` (общий шаг, RC-12), `analyzeRoute` + `profile`/`gpx` (точки экспорта = линия сверки,
  одно вычисление; `line`/`matchLine` прежние), `deriveRoute`, `ROUTE_DERIVED_VERSION = 1`.
- **contracts / api-client:** `CatalogRouteElevation`, `CatalogRouteDetail = CatalogRouteCard.extend(...)` с дефолтами
  (RC-10), `CATALOG_ROUTE_PROFILE_MAX_POINTS`; `catalogRouteGpxUrl(id)` без запроса.
- **api:** `route_exports` + поля `profile`/`derivedVersion`/`derivedFailure`; миграция `0021_routes_derived`
  (коллекция, `route_geometries_derived_idx`); `markReady` пишет профиль, версию и экспорт в одной транзакции;
  `pendingDerived`/`recordDerived`/`markDerivedFailed`/`derivedOf`/`exportGpx`; `RouteDerivedBackfill` + очередь
  `routes-maintenance` (`RoutesMaintenanceProcessor`, `RoutesSchedules`: каждые 10 мин + `routes.derive.boot`,
  продолжение `routes.derive.more`); `deriveRoute` в `PARSE_FUNCTIONS`; `consumeIpLimit`/`IpRateLimit`/
  `IpRateLimitGuard` (`PublicReadGuard` — через `consumeIpLimit`, поведение прежнее); карточка — `elevation`,
  `gpxAvailable`; `GET /v1/routes/:id/gpx` (лимит `route-gpx` 30/мин, заголовки §3 + CSP; `gpxFileName`/
  `gpxContentDisposition`, RC-14).
- **app:** `RouteMap.lineWidth?` + `ROUTE_CATALOG_LINE_WIDTH = stroke.bannerError + stroke.hairline` (5),
  каталог — 5 px, карта гонки без изменений; карточка без `SectionHero` (серого блока героя над картой больше нет):
  карта → название → чипы (`Pill`) → `StatBlock` (+ `note`) → `ElevationProfile` (96 столбиков `View`, `aspectRatio`,
  без `onLayout`, a11y — одно изображение с текстовой альтернативой) → «Поделиться» (primary) / «Скачать GPX»
  (secondary, только `gpxAvailable`, ошибка — баннер) → «Гонки на маршруте»; скелетон — та же раскладка;
  `lib/download-file(.web).ts`; подписи и время в пути — `format.ts` (`ROUTE_PACE_KMH`).
- **i18n:** `routes.detail.chip.*`, `routes.detail.stats.*`, `routes.detail.profile.*`, `routes.detail.gpx`,
  `routes.detail.gpxFailed`; удалены `routes.detail.kicker|length|elevation|elevationValue|loop|yes|no|city|surface`
  (использовались только карточкой).
- **docs:** `docs/product/routes.md`, `.claude/rules/pokatim-{db,security,backend,app}.md`.

Тесты: tracks — `route-profile.test.ts`, `route-gpx.test.ts`, `analyze-route.test.ts` (профиль/GPX, `deriveRoute` ≡
`analyzeRoute`, коды отказов); api — `routes.policy.test.ts`, `routes-schedules.test.ts`, `parse-thread.test.ts`
(`deriveRoute`), int `routes-derived.int.test.ts` (бэкфилл, пачка 20/25 → `more`, `derivedFailure`, рост версии,
сбой окружения без метки, гонка повторной записи, IXSCAN, процессор), `routes-admin.int.test.ts` (производные в
транзакции разбора, повтор — без второго экспорта), `routes-public.int.test.ts` (ключи карточки, `elevation`/
`gpxAvailable`, GPX 200/заголовки/тело, 404 без `Content-Disposition`, 400, 429 + `Retry-After`, другой IP и
`public-read` не задеты), `migrations.int.test.ts` (`0021`); contracts/api-client — дефолты, пределы профиля, URL;
app — `format.test.ts`, `stat-block.test.tsx`, `elevation-profile.test.tsx` (в т. ч. контраст `map.route`),
`download-file(.web).test.ts`, `corridor-style.test.ts`, `route-map-corridor.web.test.tsx`, `route-detail.test.tsx`;
e2e — `web.spec.ts` (опрос `gpxAvailable`, SSR-профиль, скачивание, заголовок GPX).

Проверки:
- `MONGO_URL_TEST=…pokatim_routes03_test… REDIS_URL_TEST=redis://127.0.0.1:6479/6 TURBO_CONCURRENCY=1 pnpm check` —
  **EXIT=0**: Prettier OK, `eslint --max-warnings=0` OK, `no dependency violations found (1090 modules)`, typecheck
  13/13; тесты: api 102 файла / 1013, app 119 / 1034, admin 25 / 232, tracks 19 / 244, contracts 26 / 239,
  api-client 12 / 82, design-tokens 120, i18n 6; `Tasks: 13 successful, 13 total`, 7 мин 15 с.
- Первый прогон `pnpm check` завис (load average ≈ 95 на машине, `PoolClearedOnNetworkError` MongoDB в чужих
  тестах — `panel-session`, identity; тест `routes-admin` «сбой записи» висел 45 мин при `testTimeout` 20 с — блок
  окружения). Остановлен; новые/изменённые int-тесты routes и миграций по одному с `timeout 600` — 10/13/8/7 с, все
  зелёные, процесс завершается; повторный полный прогон — зелёный (выше). Утечки хэндлов в новых тестах не найдено.
- **NOT VERIFIED:** `pnpm e2e:web` (нужны `build:web`, API-сборка, Chrome) — смоук расширен, не запускался; ручная
  проверка на iOS/Android-симуляторе и в браузере не делалась.
