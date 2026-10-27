# routes-02 — «Мои маршруты»: загрузка GPX/KML райдером, личная библиотека

Уровень: task3. Ветка `feature/routes-02-my-routes` от `origin/develop` (после routes-01, PR #52). Связано:
`docs/product/routes.md`, `docs/tasks/2026-10-27-routes-01-library/task.md` (D1, out of scope), ADR-0012 п. 1
(модуль `routes`), ADR-0011 (загрузка треков райдером — образец лимитов и выбора файла), ADR-0014 (карты).

## 1. Title

Второй слайс блока «Маршруты»: райдер загружает свой маршрут (GPX или KML) в приложении, видит список своих
маршрутов со статусами, открывает карточку с картой, переименовывает и удаляет. Маршрут виден только автору.

## 2. Goal

Сейчас во вкладке «Маршруты» только каталог команды. Райдер хочет держать в приложении свои маршруты (с Komoot,
Strava, RideWithGPS, Google My Maps) и смотреть их на карте теми же цифрами, что и каталог: длина, набор, петля.
Публикации, UGC в каталоге и модерации в этом слайсе нет — это основа для будущего «маршрута у кофе-райда».

## 2.1 Продуктовые решения (human gate, пользователь, 2026-10-27)

| # | Вопрос | Решение |
|---|---|---|
| M1 | Где в приложении | переключатель «Каталог / Мои» вверху вкладки «Маршруты»; в «Моих» — «Загрузить маршрут» и список своих маршрутов со статусами (обрабатывается / готов / ошибка с причиной) |
| M2 | Форматы | GPX **и KML** (`.kml`, LineString и `gx:Track`); KMZ, FIT-курс, TCX — «Формат не поддерживается» |
| M3 | Видимость | только автор: карточка своего маршрута открывается только ему; чужим и гостям — «Маршрут недоступен», без OG и без «Поделиться»; в каталог, в панель и в коридоры гонок маршрут райдера не попадает |
| M4 | Действия | название при загрузке (по умолчанию — имя файла без расширения), потом «Переименовать»; «Удалить» — с подтверждением, насовсем (маршрут, линия и исходник) |

Согласовано ранее (routes-01, последний отчёт): вкладка только для вошедших (RC-9); название маршрута команды при
публикации не меняется (RC-14); пустой каталог на Главной — «Маршрутов пока нет».

## 3. Scope

- **tracks (`packages/tracks`):** разбор KML для маршрута: `detectTrackFormat` различает `kml` (корень `<kml>`,
  BOM/пролог как у GPX); `analyzeRoute` принимает KML — точки из `LineString/coordinates` и `gx:Track/gx:coord` в
  порядке документа (несколько линий — решает architect: склейка по порядку или самая длинная), высота — если есть;
  те же защиты XML, что у GPX (запрет `DOCTYPE`/`ENTITY`, лимиты размера и числа точек); фикстуры реальных KML
  (Google My Maps, Google Earth `gx:Track`, без высот, пустой, `MultiGeometry`, XXE, billion laughs).
- **contracts (`routes`):** `RouteOrigin` (`platform` | `rider`); схемы приложения `MyRoute` (id, title, status,
  failure, distanceM, elevationGainM, isLoop, createdAt), `MyRoutePage`, `MyRouteQuery` (курсор, limit),
  `RenameRouteInput` (title — те же правила, что у названия загрузки), карта своего маршрута — `RouteMapGeometry`
  (reuse); коды ошибок — reuse `ROUTE_FORMAT_UNSUPPORTED`, `ROUTE_TOO_LARGE`, `RATE_LIMITED`, новый — квота числа
  маршрутов (имя решает architect). Справочники в ответах приложения — `tolerantEnum` (R6).
- **api (`routes`):**
  - данные: `RouteDoc.origin: 'platform' | 'rider'`; уникальность дедупа — в пределах `(origin, ownerUserId,
    sha256)` (сотрудник, загрузивший тот же файл в приложении, не должен получить маршрут команды — architect
    проверяет индекс `routes_owner_sha_unique` и решает про миграцию); индекс списка «моих»;
  - приложение (`AuthGuard`, `Cache-Control: no-store`): загрузка (сырое тело, `?title=`, лимит частоты на
    райдера, квота числа маршрутов), список своих (курсор, новые сверху), карточка своего, карта своего,
    переименование, удаление; чужой и неизвестный — `404 NOT_FOUND`; пути — решает architect (образец —
    `tracks/uploads`);
  - приём — тот же `RoutesService.accept`/обработка worker'ом (outbox → `route-processing`), без дублирования;
  - **изоляция маршрутов райдера:** панель (`list`/`get`, видимость Q2 «готовые — всем с `races.read`»), каталог
    (`publish`, публичные `GET /v1/routes*`), коридор гонки (`findReady`/порт `RouteCatalog`, `GET
    /v1/routes/:id/races`) — только `origin: 'platform'`;
  - удаление — транзакция «маршрут + геометрия + исходник» (+ журнал/событие, если нужно по правилам), только свой
    `rider`-маршрут; маршрут в обработке — решает architect (запрет или удаление с безопасным no-op worker'а).
- **api-client:** методы «моих маршрутов» (загрузка сырым телом — как загрузка трека).
- **app:**
  - вкладка `(tabs)/routes.tsx`: переключатель «Каталог / Мои» (по образцу существующих переключателей/чипов
    дизайн-системы); фильтры каталога в «Моих» не показываются;
  - «Мои»: «Загрузить маршрут» — выбор файла (reuse `features/devices/pick-track-file*` с GPX/KML), название (по
    умолчанию имя файла), загрузка, ошибки §4.12 (формат, размер, лимит частоты, квота, сеть); список карточек
    (reuse `components/route-list-card` где возможно) со статусом; опрос, пока есть «обрабатывается»; пусто —
    «У вас пока нет маршрутов» + «Загрузить»; ошибка с повтором; pull-to-refresh;
  - карточка своего маршрута — защищённый экран (путь решает architect, например `routes/mine/[id]`): карта (reuse
    `features/maps/route-map`, без коридора), длина, набор, петля, дата загрузки; «Переименовать», «Удалить» с
    подтверждением; без «Поделиться» и без OG; чужой/удалённый — «Маршрут недоступен»; в обработке/ошибка — статус
    вместо карты.
- **i18n:** свой блок `routes.mine.*` (и `routes.switch.*`), существующие ключи не менять.
- **docs:** `docs/product/routes.md` (раздел «Мои маршруты», M1–M4), `pokatim-security.md` (маршрут райдера —
  приватные данные автора: не в панели, не в каталоге, не в логах координат), `pokatim-app.md`, `pokatim-db.md`
  (если миграция), `pokatim-contracts.md`, ADR-0011/0012 — только если меняется принятое решение.

## 4. Out of Scope

- Публикация маршрута райдера в каталог, UGC, модерация, жалобы, «Поделиться» своим маршрутом.
- Маршрут у кофе-райда; выбор своего маршрута где-либо ещё.
- KMZ, FIT-курс, TCX, импорт по ссылке (Komoot/Strava API), экспорт GPX.
- Правка геометрии, обрезка концов, профиль высот.
- Загрузка KML в панели — только если выходит бесплатно общим разбором (решает architect, отметить в §8.2).
- Гостевой режим «Моих».

## 5. Architecture Context

Модуль `routes` (ADR-0012 п. 1) — единственный писатель `routes`/`route_geometries`/`route_sources`; разбор — worker
`route-processing` в потоке с лимитами (`parse-thread`). Сейчас все маршруты — `origin: 'platform'`, загрузка —
только панель (`PanelPrincipal`). Загрузка райдером по образцу `tracks/uploads` (`AuthGuard`, `readLimited`, лимит
частоты до чтения тела). Каталог (routes-01) — `catalog` у `RouteDoc`, публичные ручки `RoutesPublicController`.

Дополнение architect (сверено по коду `53c85f1`, 2026-10-27):

- Маршрут райдера — тот же документ `routes` с `origin: 'rider'`, те же `route_geometries`/`route_sources`, тот же
  приём (`RoutesService.accept`, обобщённый по владельцу) и тот же worker `route-processing` (outbox
  `routes.route-received`). Новая HTTP-часть — `RoutesMineController` (`AuthGuard` из `identity`) →
  `MyRoutesService`. `routes` теперь зависит от `panel` **и** `identity` (как `rides`); о гонках по-прежнему не знает.
- Граница приватности — **в фильтрах `RoutesRepository`**, не в сервисах: каждый метод, который читают панель,
  каталог и порты (`findReady`, `findPublished`, `routesByIds`, `listVisible`, `findByOwnerSha`), содержит
  `origin` в фильтре; маршрут райдера читается только методами с `{ ownerUserId, origin: 'rider' }` в фильтре.
  Порты `RouteCatalog`/`RouteGeometry` (races, results, публичная карта) видят только `platform` — LRU-кэш геометрии
  `RoutesCatalogService` маршрут райдера никогда не содержит и остаётся безопасным.
- Удаление — новое для модуля, но только `rider`: инвариант «маршрут платформы не меняется и не удаляется» (ADR-0012
  п. 1, `pokatim-db.md`, замок не нужен в транзакции гонки) сохраняется. Удаление — транзакция трёх коллекций, без
  журнала и outbox (потребителей нет; журнал панели — не место для приватных названий райдера).
- `packages/tracks`: KML — новый `kml.ts`; защиты XML (`<!DOCTYPE`/`<!ENTITY`, подсчёт элементов до дерева,
  `XMLValidator`) выносятся из `gpx.ts` в общий `xml.ts` без копии; формат маршрута — новый `detectRouteFormat`,
  `detectTrackFormat` не меняется (RC-3).
- Приложение: `features/routes/` (+ «Мои»), загрузка — конвейер `features/devices` (picker, тело, отправка с
  прогрессом), карта — `features/maps` через общий `RouteLineMap`.

## 5.1 Placement & Reuse Gate

- Reuse (api): `RoutesService.accept`/`again`/`RoutesRepository.requeue`, `RouteProcessingProcessor`,
  `analyzeRoute` + `runParseThread`, `readLimited`, `RateLimiter` + `rateLimitKeyForIp` (как `tracks`), `page-cursor`,
  `RouteTitle`/`UploadRouteQuery`, `ROUTE_FILE_MAX_BYTES`, `ROUTE_FAILURE_CODES`, `RouteMapGeometry`, `tolerantEnum`,
  `RoutesRepository.displayLine` + `boundsOf`, `isDuplicateKey`, `MongoTransactions`.
- Reuse (app): `pickTrackFile` (параметр расширений), `trackFileBody`, `sendTrackFile` → общий `sendFile`,
  `UploadProgress`, `withAccessToken`, `RouteListCard` (общая рамка), `routeStats`/`routeKm`, `CatalogRouteMap` →
  `RouteLineMap`, `withoutCorridor`/`useMapStyle`/`RouteMap corridor={false}`, `SegmentedControl`, `TextField`, `Pill`,
  `AsyncContent`/`EmptyState`/`Banner`/`OfflineBanner`, `usePullToRefresh`, `DetailHeader`, `DocumentTitle`,
  встроенное подтверждение удаления как в `UploadRow`.
- Запрещено: вторая коллекция/очередь/разбор для маршрутов райдера; копия `accept`/`again`; чтение маршрута
  райдера через порты и кэш `RoutesCatalogService`; запись действий райдера в `PanelAudit`; названия и координаты
  в логах; второй компонент карты и правка существующих пропсов `RouteMap`; правка `detectTrackFormat`, `TrackFormat`,
  `TRACK_FILE_EXTENSIONS`, `TRACK_FORMATS`; HTTP `DELETE`/`PATCH` для «моих» (CORS без `DELETE`, конвенция — `POST` с
  глаголом); `fetch` в экранах; правка существующих ключей i18n.

## 6. Relevant Files

- `apps/api/src/modules/routes/*` (service, repository, collection, policy, controllers, processor, порты).
- `apps/api/src/modules/races/races.service.ts` (`findReady` коридора), `races` контроллер `routes/:id/races`.
- `apps/api/src/modules/tracks/track-uploads.controller.ts` — образец приёма от райдера.
- `packages/tracks/src/{format,gpx,parse}.ts`, `__fixtures__/`.
- `packages/contracts/src/routes/*`, `packages/api-client`.
- `apps/app/src/app/(tabs)/routes.tsx`, `features/routes/*`, `components/route-list-card.tsx`,
  `features/devices/pick-track-file*.ts`, `features/maps/*`.

## 7. Implementation Notes

- `[ASSUMPTION]` Лимиты райдера: 20 загрузок в час, не больше 100 маршрутов у райдера, файл до 5 МиБ
  (`ROUTE_FILE_MAX_BYTES`), точек — общие лимиты разбора.
- `[ASSUMPTION]` Название: 1–120 символов после обрезки пробелов (как у загрузки в панели — architect сверяет).
- Опрос статуса «обрабатывается» — как у загрузок треков (интервал и стоп по готовности).

## 8. Risks / Assumptions / Open Questions

- Утечка приватного маршрута в панель/каталог/гонки — главный риск; нужны отрицательные int-тесты на каждую точку
  (`pokatim-tests.md`).
- Дедуп `(ownerUserId, sha256)` пересекает origin — сотрудник с тем же файлом. Решение — architect.
- KML от Google My Maps может содержать несколько Placemark (точки + линии) — точки без линии игнорируются.
- Удаление маршрута во время обработки — гонка с worker'ом.

## 8.1 Requirements Consistency (заполняет architect)

Architecture Review — routes-02-my-routes: **CONCERNS** (блокеров нет). Решения ниже — по умолчанию, coder идёт по ним;
человек может переиграть любое до старта coder. M1–M4 не пересматриваются. **HG-1** (RC-4) — подтверждение человека
на удаление индекса `routes_owner_sha_unique` до применения миграции на dev/prod и merge (`db.md`: удаление индекса —
только с человеком).

- **HG-1 — решено человеком 2026-10-27: «Да, заменить».** Миграция `0021_routes_rider` создаёт
  `routes_owner_origin_sha_unique` и `routes_owner_origin_idx`, затем удаляет `routes_owner_sha_unique`. RC-1…RC-16 и
  M1–M4 подтверждены; RC-11 (гость по ссылке на свой маршрут уходит на вход) — принято.

- **RC-1 · Пути эндпоинтов (недоопределённость).** Альтернативы: (a) `/v1/routes/mine` — `POST` (загрузка,
  `?title=`), `GET` (список), `GET :id`, `GET :id/map`, `POST :id/rename`, `POST :id/delete`; контроллер
  `@Controller('routes/mine') @UseGuards(AuthGuard)` — **первым** в `controllers` модуля (правило
  `pokatim-backend.md`: статический сегмент до параметрического, иначе pipe `Uuid` → 400); (b) `/v1/me/routes` —
  новый корневой префикс, в API его нет; (c) `/v1/routes/uploads` по образцу `tracks/uploads` — путает загрузку и
  библиотеку. **Рекомендация: (a)** (образец сосуществования — `rides/cities` под `AuthGuard` и публичный
  `rides/:id`). Мутации — `POST` с глаголом: CORS API без `DELETE` (`http-app.ts`), образцы
  `tracks/uploads/:id/delete` (204) и `rides/:id/cancel`. int-тесты пересечений: `GET /v1/routes/mine` без входа — 401
  (не 400 и не публичный ответ), `GET /v1/routes/mine/<uuid>` — свой маршрут (не `routes/:id/races`).
- **RC-2 · Изоляция — одна граница в репозитории (главный риск §8).** Сейчас маршрут райдера утёк бы в 4 местах:
  (1) `listVisible` — ветка `{ ownerUserId: viewerUserId }` без `origin` (сотрудник увидел бы свои маршруты из
  приложения в панели); (2) `visible()` — `status === 'ready'` без `origin` (готовый маршрут райдера — всем с
  `races.read` в `GET /v1/admin/routes/:id` и в публикации); (3) `findReady` без `origin` (коридор гонки, линия
  сверки и рамка `results`, карта `GET /v1/races/:id/route`, кэш процесса); (4) `findByOwnerSha` без `origin`
  (сотрудник получил бы в панели свой маршрут райдера). Решение: `origin: 'platform'` в фильтрах `findReady`,
  `findPublished`, `routesByIds`, обеих ветках `listVisible`; `visible()` = `route.origin === 'platform' && (ready ||
  свой)`; `findByOwnerSha(origin, ownerUserId, sha256)`. Чужой/райдерский маршрут в панели и публичных ручках —
  тот же `404 NOT_FOUND`, коридор — `ROUTE_NOT_READY`. Каждая точка — отрицательный int-тест с доказательством:
  условие `origin` убрано → тест красный по результату (`pokatim-tests.md`), итог — в §12.
- **RC-3 · `detectTrackFormat` не трогаем (отклонение от §3, → §8.2).** §3 просит, чтобы `detectTrackFormat` различал
  `kml`. Но `TrackUploadsService.accept` пропускает любой ненулевой формат: KML ушёл бы в загрузку заездов, в
  `track_uploads.format` и контракт `TRACK_FORMATS` (тест `format.test.ts` прямо фиксирует `kml → null`).
  Альтернативы: (a) новый `detectRouteFormat(bytes): 'gpx' | 'kml' | null` на общем сканере пролога (BOM, пробелы,
  `<?…?>`, комментарии; `<!DOCTYPE` до корня → `null`), `detectTrackFormat` — тот же код для `gpx`; (b) `kml` в
  `detectTrackFormat` + отказ `kml` в `tracks` — правка чужого модуля и типа `TrackFormat`; (c) проверка корня в
  `RoutesService` — разбор формата вне пакета. **Рекомендация: (a).** `TrackFormat` не меняется: `parseKml` отдаёт
  точки, не `ParsedTrack`.
- **RC-4 · Дедуп и индекс `routes_owner_sha_unique` (AC5, HG-1).** Индекс `{ ownerUserId, sha256 }` (0013) не даст
  сотруднику завести маршрут райдера из файла маршрута команды. Альтернативы: (a) миграция `0021_routes_rider`:
  создать `routes_owner_origin_sha_unique { ownerUserId: 1, origin: 1, sha256: 1 }` (unique) и
  `routes_owner_origin_idx { ownerUserId: 1, origin: 1, _id: -1 }`, **затем** удалить `routes_owner_sha_unique`
  (идемпотентно: `indexExists` → `dropIndex`); (b) expand сейчас, удаление — следующим релизом: до него AC5 не
  выполняется (вставка упадёт на старом индексе — нужен временный отказ); (c) префикс `rider:` в `sha256` — ломает
  смысл поля и дедуп. **Рекомендация: (a) с подтверждением человека (HG-1).** Почему безопасно: новый индекс для
  `platform` эквивалентен старому и создаётся до удаления; данные не удаляются; старый код между миграцией и
  выкладкой проверяет дубль `findByOwnerSha` до вставки — расходится только имя индекса в `isDuplicateKey` при
  одновременной двойной загрузке (500 вместо 200, окно в минуты). Откат кода после появления у сотрудника пары
  `platform`+`rider` одного файла — старый индекс заново не создать (принято, в `pr.md`). `routes_owner_idx`
  остаётся (поглощён новым префиксом; удаление — follow-up contract).
- **RC-5 · Квота, лимиты и коды ошибок (недоопределённость).** Новый код **`ROUTE_QUOTA_EXCEEDED` (409)** в конец
  `ErrorCode` (образец `RIDE_QUOTA_EXCEEDED`), без `details`; предел — константа контракта `MY_ROUTE_MAX_COUNT = 100`
  (текст приложения). Порядок приёма: `AuthGuard` → лимиты до тела (райдер 20/ч `routes-upload-rider:<uid>`, IP 60/ч
  `routes-upload-ip:<hmac>` через `rateLimitKeyForIp`, семафор 4 приёма на процесс — как `tracks`: регистрация
  бесплатна, тело до 5 МиБ в памяти) → `readLimited` (413 `ROUTE_TOO_LARGE`) → пусто 400 → формат 415
  `ROUTE_FORMAT_UNSUPPORTED` → sha256 → дедуп своего `rider` (200 / 202 повтор отказа) → квота (`countDocuments
  { ownerUserId, origin: 'rider' }` ≥ 100 → 409) → вставка. Квота после дедупа: тот же файл при полной квоте — 200, не
  409. Квота мягкая (счёт вне транзакции, как у райдов): перебор ≤ числа параллельных приёмов — принято. Все статусы
  (и `failed`) считаются — освобождает удаление. Текст API `ROUTE_FORMAT_UNSUPPORTED` → «Выберите файл GPX или KML».
- **RC-6 · Название (расхождение §7).** §7 предполагает 1–120 «как в панели», а в панели `RouteTitle = RaceTitle` —
  **3–120**, одна строка, trim. Альтернативы: (a) reuse `RouteTitle` и `UploadRouteQuery` (одно правило названия
  маршрута, будущая публикация без миграции правил); (b) новая схема 1–120 — второе правило для той же сущности.
  **Рекомендация: (a).** Название по умолчанию — имя файла без расширения, управляющие символы и переводы строк →
  пробел, обрезка до 120; короче 3 — ошибка «Слишком короткое» под полем до отправки. Тот же файл с другим
  названием — существующий маршрут со старым названием (дедуп), приложение показывает ответ сервера.
- **RC-7 · Несколько линий KML (решение §3).** Альтернативы: (a) все линии в порядке документа склеиваются —
  `LineString` (в т. ч. внутри `MultiGeometry`) и `gx:Track` (в т. ч. `gx:MultiTrack`); (b) самая длинная линия;
  (c) отказ на нескольких линиях — новый код отказа в `ROUTE_FAILURE_CODES`. **Рекомендация: (a)** — паритет с GPX
  (`parseGpx` склеивает все `trk`/`trkseg`), детерминированно, без нового кода. Риск: My Maps с несвязанными линиями
  даёт перемычку в длине — автор видит карту и удаляет. `Point`, `Polygon`/`LinearRing` игнорируются; линий нет —
  `no_track`. **Высоты:** третья координата `coordinates` (`lon,lat[,alt]`) и `gx:coord` (`lon lat [alt]`); если
  **все** высоты = 0 (My Maps пишет `,0` при `clampToGround`) — высот нет (`elevationGainM: null`), иначе «набор
  0 м» врёт. **Лимиты:** `<!DOCTYPE`/`<!ENTITY` → `unreadable`; открывающих тегов ≤ `XML_MAX_ELEMENTS`; `countTags(
  'coord') > ROUTE_MAX_POINTS` до разбора; `XMLValidator`; кортежи `coordinates` считаются при разборе с обрывом на
  `ROUTE_MAX_POINTS` → `too_many_points`; нечисловые кортежи пропускаются, вне диапазона — `sanitizePoints`.
- **RC-8 · Удаление маршрута в обработке (решение §3).** Альтернативы: (a) удаление всегда: транзакция
  `routes.deleteOne({ _id, ownerUserId, origin: 'rider' })` (0 → 404) + `route_geometries` + `route_sources`; worker:
  `claim` удалённого → `null` → `skipped`; захват до удаления → исходника нет → `findRoute` → маршрута нет →
  `skipped` **без исключения** (сейчас бросает и ретраит до `failed`-no-op); `markReady` после удаления —
  `updateOne` 0 → `false` → геометрия не пишется (запись `routes` и удаление конфликтуют в транзакциях — повтор на
  свежем снимке, сирот нет); (b) запрет в обработке (`409 ROUTE_INVALID_STATE`) — зависшую обработку не удалить до
  15 мин. **Рекомендация: (a).** Повторное удаление — 404 (как `tracks/uploads/:id/delete`); приложение считает 404
  на удалении успехом. Журнала и события нет (§5); лог `route <id> deleted by <uid>`.
- **RC-9 · Переименование.** `POST /v1/routes/mine/:id/rename` `{ title: RouteTitle }` → `200 MyRoute` в любом статусе;
  то же название — 200 без записи; `findOneAndUpdate({ _id, ownerUserId, origin: 'rider' }, { $set: { title,
  updatedAt } })`, `null` → 404. Сдвиг `updatedAt` у `processing` откладывает признак «зависла» (15 мин) — принято.
- **RC-10 · KML в панели (§4).** API — да, бесплатно: общий `accept`/`detectRouteFormat` без развилки по `origin`.
  UI панели (`accept=".gpx"`, «Загрузить GPX», тексты `admin.routes.*`) не меняется — follow-up; фиксируется в §8.2.
- **RC-11 · Защищённый экран карточки своего маршрута.** `src/app/routes/mine/[id].tsx` внутри `Stack.Protected`
  (образец `rides/edit/[id]`), без `loader`, `generateMetadata`, OG и «Поделиться». Гость по ссылке — редирект гарда
  на вход/регистрацию (как все защищённые экраны), а не буквальное «Маршрут недоступен»: цель M3 (гостю ни данных,
  ни OG) соблюдена; альтернатива — экран вне гарда, всегда «недоступен» гостю, — особый случай без пользы (ссылками
  никто не делится). Вошедший: невалидный id (без запроса), чужой, удалённый, неизвестный (404) — «Маршрут
  недоступен» + «Мои маршруты». `/routes/mine` без id попадает в `routes/[id]` → «Маршрут недоступен» (`Uuid`) —
  допустимо.
- **RC-12 · Опрос статуса.** Как загрузки заездов: `refetchInterval` 3 с (`MY_ROUTE_POLL_MS = 3000`), пока в
  загруженных страницах есть `processing`; карточка — пока сама `processing`; в фоне не опрашиваем (умолчание
  TanStack). Предела времени нет: worker на последней попытке пишет `failed: unreadable`, зависшее лечит повторная
  загрузка (`again`).
- **RC-13 · Переключатель «Каталог / Мои».** `SegmentedControl` из `@rkarakulov/ui` («вкладки внутри экрана»,
  в приложении ещё не использовался — правка системы не нужна). Состояние — параметр `?view=mine`
  (`useLocalSearchParams` + `router.setParams`): возврат с карточки и перезагрузка web сохраняют «Мои». Альтернативы:
  `useState` — теряется на перезагрузке web; чип `FilterGroup` — это фильтр, а не вкладка. Переключатель — в шапке
  обеих лент под заголовком; фильтры каталога — только в «Каталоге».
- **RC-14 · Загрузка в приложении — reuse конвейера треков.** `pickTrackFile(ROUTE_FILE_EXTENSIONS)` (web — фильтр
  `.gpx,.kml`, native — `*/*`), `precheckRouteFile` (`@pokatim/tracks`: расширение gpx/kml, пусто, > 5 МиБ — без
  запроса; `.kmz`/`.fit`/`.tcx` → «Формат не поддерживается»), шаг «Название» (`TextField`), отправка `sendFile` с
  прогрессом и «Отменить» (`UploadProgress`). `sendTrackFile` становится обёрткой `sendFile(…, TrackUpload, …)` без
  смены поведения. Альтернатива — `fetch` api-client без прогресса: 5 МиБ на мобильной сети без индикации.
- **RC-15 · Карта и карточка списка — без копий.** Геометрия своего маршрута — не через порт/кэш:
  `MyRoutesService.map` → `findOwn` (`ready`) → `displayLine` → общий `displayGeometryOf(route, line)`, вынесенный
  из `RoutesCatalogService.displayGeometry`. В приложении `CatalogRouteMap` обобщается в `RouteLineMap({ distanceM,
  mapQuery })` (`queryOptions` TanStack; `CatalogRouteMap` делегирует, его тесты не меняются). `RouteListCard` —
  общая рамка `RouteCardFrame` (название, строка цифр, вторая строка, `Pill` статуса) + `MyRouteListCard` в том же
  файле; у `processing`/`failed` вместо цифр — статус («Обрабатывается» / причина `failure`).
- **RC-16 · Очередь общая.** Маршруты райдеров идут в ту же `route-processing` (concurrency 1) — могут задержать
  маршрут сотрудника на минуты. Принято v1 (лимиты частоты ограничивают поток); отдельная очередь — при жалобах.

Нет находок по серверному авторитету: длина, набор, петля, статус считает только worker; клиент шлёт байты и
название.

## 8.2 Deviations from spec

- **DEV-1 (RC-3):** `detectTrackFormat` не меняется — формат маршрута определяет новый `detectRouteFormat` (общий
  сканер пролога `xmlRootAfterProlog`); `TrackFormat`, `TRACK_FILE_EXTENSIONS`, `TRACK_FORMATS` прежние.
- **DEV-2 (RC-6):** название — `RouteTitle` 3–120 (как в панели), а не 1–120 из §7.
- **DEV-3 (RC-10):** API панели принимает KML бесплатно (общий `accept`); UI панели (`accept=".gpx"`, тексты) не
  менялся — follow-up.
- **DEV-4 (RC-11, принято человеком):** гость по ссылке `/routes/mine/<id>` уходит на вход (гард), а не видит
  «Маршрут недоступен».
- **HG-1 (принято человеком 2026-10-27):** `0021_routes_rider` удаляет `routes_owner_sha_unique` после создания новых
  индексов.
- **DEV-5 (фикстуры KML):** реальных экспортов My Maps/Google Earth в репозитории и у агента нет — фикстуры
  синтетические в раскладке экспортёров, генератор `packages/tracks/scripts/generate-kml-fixtures.ts` (эталоны
  `expected.json` считаются независимо от пакета), как `route-*.gpx` и `generate-fixtures.ts`. Проверка на реальных
  файлах — смоук dev.
- **DEV-6 (`xml.ts`, `kml.ts`):** вместо одного `parseXml(text, parser, { maxElements })` — три помощника
  (`assertNoForbiddenMarkup`, `assertElementCount`, `parseValidXml`), порядок проверок GPX прежний (тесты `gpx.test.ts`
  без правок). `parseKml` — `XMLParser` с `preserveOrder` (порядок документа между `LineString` и `gx:Track` — соседями
  разного имени), а не `isArray`; обход дерева — без рекурсии.
- **DEV-7 (`RouteLineMap`):** пропсы `{ mapQuery, accessibilityLabel, failedMessage, skeletonTestID }` вместо
  `{ distanceM, mapQuery }` — у своего маршрута своя подпись карты; `CatalogRouteMap` делегирует, его тесты и testID
  прежние. `useCatalogRouteMap` → `catalogRouteMapOptions`.
- **DEV-8 (репозиторий):** квота — `countOwned(origin, ownerUserId)` (вместо `countOwn(ownerUserId)`), `accept(…, {
  maxRoutes })`; `origin: 'platform'` — во всех чтениях каталога (`IN_CATALOG`: список, города, `findPublished`), не
  только в `findPublished`; запрос списка каталога — `hint('routes_catalog_idx')`: `origin` в фильтре делал кандидатом
  `routes_list_idx` (сортировка в памяти).
- **DEV-9 (i18n):** сверх §11 — `routes.mine.titleError.*`, `detail.kicker`, `detail.status`, `detail.renameCancel`,
  `detail.renameFailed`, `detail.deleteFailed`; существующие ключи не менялись.
- **DEV-10 (тесты app):** сценарии `my-route-feed`, `use-my-route-upload`, `my-route-detail`, `routes-tab` — одним
  экранным тестом `src/__tests__/my-routes.test.tsx` (хук загрузки — через экран), плюс `my-route-format.test.ts`,
  `route-list-card.test.tsx`, `pick-track-file.web.test.ts`. Проверка порта `RouteGeometry` (results) — в
  `routes-public.int.test.ts` (реальная БД). `MyRouteDetail` не заводился — карточка использует `MyRoute`.
- **Follow-up (ревью pass 1, Claude LOW 5):** семафор приёмов (4 на процесс) общий для всех райдеров — один аккаунт
  медленной отправкой может занять его целиком. Вместе с `tracks`: не больше 1 одновременного приёма на `userId` и
  таймаут чтения тела в `readLimited`. В этом PR не делается (шаблон `TrackUploadsService.admit`, принят для v1).

## 8.3 Security checklist

- [x] Маршрут райдера не виден другим (API 404, без утечки существования), не попадает в панель, каталог, коридоры.
- [x] Лимит частоты до чтения тела; квота числа маршрутов; размер тела.
- [x] KML: запрет `DOCTYPE`/`ENTITY`, лимиты, разбор в потоке.
- [x] Логи — без координат и названий маршрутов райдера.
- [x] Ответы `no-store`.
- [x] AuthN/AuthZ: `AuthGuard` на всех шести; фильтр владельца и `origin: 'rider'` в репозитории; чужой = неизвестный =
  404; изоляция RC-2 с отрицательными тестами.
- [x] Входные данные: `title` — `RouteTitle` (zod до сервиса), id — `Uuid`, тело — только `application/octet-stream`,
  обрыв на 5 МиБ; KML — запрет `DOCTYPE`/`ENTITY`, подсчёт элементов и `gx:coord` до дерева, обрыв кортежей, разбор
  только в `runParseThread`.
- [x] Данные наружу: `MyRoute` — явный список полей, без `ownerUserId`/`sha256`/`origin`/`attempts`/`catalog`/линии
  сверки; карта — только линия показа своего `ready`.
- [x] Злоупотребления: лимит райдера и IP до тела, семафор приёмов, квота 100.
- [x] Логи: `routeId`, `userId`, коды; без названий, имён файлов и координат; действия райдера не пишутся в журнал
  панели.

## 9. Acceptance Criteria

1. Райдер во вкладке «Маршруты» → «Мои» загружает GPX и KML; маршрут появляется со статусом «обрабатывается», затем
   «готов» с длиной, набором и петлёй; битый/пустой файл — «ошибка» с причиной.
2. KMZ/FIT/TCX/прочее — «Формат не поддерживается»; больше лимита — «Файл слишком большой»; лимит частоты и квота —
   понятные сообщения.
3. Карточка своего маршрута показывает карту и цифры; «Переименовать» меняет название в списке и карточке;
   «Удалить» после подтверждения убирает маршрут, карточка после этого — «Маршрут недоступен».
4. Чужой маршрут: API `404` на все ручки «моих»; публичные `GET /v1/routes/:id*` — `404`; в панели не виден; как
   коридор гонки не выбирается (`ROUTE_NOT_READY`); опубликовать в каталог нельзя.
5. Тот же файл у того же райдера — тот же маршрут (дедуп); сотрудник, загрузивший файл маршрута команды в
   приложении, получает свой отдельный маршрут райдера.
6. Каталог, панель и гонки routes-01 работают как раньше (регрессия — существующие тесты зелёные).
7. `pnpm check` зелёный; e2e веба — шаг «Мои маршруты» (переключатель, пустое состояние).

## 10. Documentation Impact

`docs/product/routes.md`, `.claude/rules/pokatim-{security,app,backend,contracts,db}.md` по изменениям,
`docs/tasks/README.md` (если ведётся список задач).

Дополнение architect:
- `pokatim-db.md` («Маршруты и коридор»): `origin: 'platform' | 'rider'`; «удаления нет» → «маршрут платформы не
  удаляется; маршрут райдера удаляет автор — транзакция `routes` + `route_geometries` + `route_sources`»; дедуп —
  `routes_owner_origin_sha_unique`; `0021_routes_rider` (индексы, удаление старого — HG-1); правило «чтение вне
  «моих» — с `origin: 'platform'` в фильтре».
- `pokatim-security.md`: раздел «Маршруты райдера» (только автор, 404 чужому, `no-store`, лимиты RC-5, KML-защиты,
  логи без названий и координат, не в журнале панели); в `paths:` — `packages/tracks/src/{gpx,kml,xml,format}.ts`
  (сейчас покрыт только `parse*`).
- `pokatim-backend.md`: `routes` зависит от `identity`; `RoutesMineController` первым; порты видят только `platform`.
- `pokatim-contracts.md`: `my-route.schema.ts`, `ROUTE_ORIGINS`, `ROUTE_FILE_EXTENSIONS`, `ROUTE_QUOTA_EXCEEDED`.
- `pokatim-app.md` («Маршруты»): переключатель `?view=mine`, ключи `['routes','mine',…]`, экран `routes/mine/[id]`
  под гардом, `RouteLineMap`, загрузка через конвейер `features/devices`.
- `docs/product/routes.md`: раздел «Мои маршруты» (M1–M4, RC-5 лимиты, RC-7 KML, RC-11 гость); таблица «Что не
  входит» — убрать строку routes-02, оставить UGC/модерацию.
- ADR-0011/0012 — без изменений (решения не меняются: коридоры — только `platform`, ADR-0012 предусматривал
  `origin: 'rider'`). `pr.md` — миграция `0021` с удалением индекса (HG-1) и порядок «миграция → API».

## 11. Implementation Context (заполняет architect)

Сверено по коду ветки `feature/routes-02-my-routes` (`53c85f1`, после routes-01 #52), 2026-10-27. Решения RC-1…RC-16 —
§8.1.

### ENTRY POINTS

- API приложения: `POST|GET /v1/routes/mine`, `GET /v1/routes/mine/:id`, `GET /v1/routes/mine/:id/map`,
  `POST /v1/routes/mine/:id/rename`, `POST /v1/routes/mine/:id/delete` → `RoutesMineController` → `MyRoutesService`
  (приём — `RoutesService.accept`).
- Worker: `RouteProcessingProcessor.processRoute` (без новых задач; правка «исходника нет и маршрута нет → skipped»).
- Разбор: `analyzeRoute` (`@pokatim/tracks/parse`) → `detectRouteFormat` → `parseGpx` | `parseKml`.
- App: вкладка `src/app/(tabs)/routes.tsx` (`SegmentedControl`, `?view=mine`) → `features/routes/route-feed.tsx` |
  `features/routes/my-route-feed.tsx`; карточка `src/app/routes/mine/[id].tsx` → `features/routes/my-route-detail.tsx`.

### Эндпоинты, видимость, коды

| Метод и путь | Гард | Кэш | Ответ | Отказы |
|---|---|---|---|---|
| `POST /v1/routes/mine?title=` (тело `application/octet-stream`) | `AuthGuard` | `no-store` | `202 MyRoute` (новый или повтор отказа) / `200 MyRoute` (тот же файл) | 400 (`title`, пустое тело), 401, 413 `ROUTE_TOO_LARGE`, 415 `ROUTE_FORMAT_UNSUPPORTED`, 409 `ROUTE_QUOTA_EXCEEDED`, 429 `RATE_LIMITED` (до тела) |
| `GET /v1/routes/mine?cursor&limit` | `AuthGuard` | `no-store` | `MyRoutePage` (свои `rider`, новые сверху по `_id`) | 400 (курсор, limit, лишний ключ), 401 |
| `GET /v1/routes/mine/:id` | `AuthGuard` | `no-store` | `MyRoute` | 400 (`Uuid`), 401, 404 `NOT_FOUND` (чужой, `platform`, удалённый, неизвестный) |
| `GET /v1/routes/mine/:id/map` | `AuthGuard` | `no-store` | `RouteMapGeometry` | 400, 401, 404 (то же + не `ready`) |
| `POST /v1/routes/mine/:id/rename` | `AuthGuard` | `no-store` | `200 MyRoute` | 400 (тело `RenameRouteInput`), 401, 404 |
| `POST /v1/routes/mine/:id/delete` | `AuthGuard` | `no-store` | `204` | 400, 401, 404 (в т. ч. повтор) |

- Видимость «моих» — только фильтр `{ _id, ownerUserId: user.userId, origin: 'rider' }` в репозитории; 404 без
  различия «чужой / не существует».
- Изоляция (RC-2): панель `GET /v1/admin/routes(/:id)`, `POST …/:id/publish|unpublish` — 404 для `rider`; публичные
  `GET /v1/routes`, `/cities`, `/:id`, `/:id/map`, `/:id/races` — 404/нет в списке; `RaceInput.corridor.routeId` =
  маршрут райдера → `ROUTE_NOT_READY` на `corridor.routeId`.
- `@Controller('routes/mine')` — первым в `RoutesModule.controllers`; на каждом методе `@Header('Cache-Control',
  'no-store')`; `id` — `ZodValidationPipe(Uuid, FieldErrorCode)`; `@HttpCode(200)` у `rename`, `@HttpCode(204)` у
  `delete`, `reply.status(created ? 202 : 200)` у загрузки, `Connection: close` при недочитанном теле — как
  `track-uploads.controller.ts`.

### FILES TO MODIFY / CREATE

contracts (`packages/contracts`)
- `src/routes/route.schema.ts` — `ROUTE_ORIGINS = ['platform', 'rider'] as const` + `RouteOrigin` (только в конец);
  `ROUTE_FILE_EXTENSIONS = ['gpx', 'kml'] as const`; комментарий `UploadRouteQuery` — «и `POST /v1/routes/mine`».
  Шапка файла: «только панель» → «панель; приложение — `my-route.schema.ts`».
- `src/routes/my-route.schema.ts` (новый) + экспорт в `src/index.ts` (см. TYPES).
- `src/common.ts` — в конец `ErrorCode`: `'ROUTE_QUOTA_EXCEEDED'` (комментарий «routes-02: предел числа своих
  маршрутов»); `common.test.ts` — порядок.

tracks (`packages/tracks`)
- `src/xml.ts` (новый) — из `gpx.ts` без смены поведения: `FORBIDDEN_MARKUP`, `countMatches`, `countTags`,
  `ELEMENT_OPEN`, `XML_MAX_ELEMENTS` (= нынешний `GPX_MAX_ELEMENTS`; `gpx.ts` реэкспортирует старое имя),
  `parseXml(text, parser, { maxElements })` — запрет разметки → подсчёт элементов → `XMLValidator` → `parse`, ошибки →
  `TrackParseError('unreadable')`. `gpx.ts` — на них (тесты `gpx.test.ts` без правок).
- `src/kml.ts` (новый) — `parseKml(text, { maxPoints }): { points: ParsedPoint[] }`: свой `XMLParser` (те же опции,
  `removeNSPrefix: true` → `gx:Track` = `Track`, `gx:coord` = `coord`; `isArray` для `Placemark`, `Folder`,
  `Document`, `MultiGeometry`, `LineString`, `Track`, `MultiTrack`, `coord`); обход дерева в порядке документа:
  `LineString/coordinates` (кортежи `lon,lat[,alt]` через пробелы/переводы строк) и `Track/coord` (`lon lat [alt]`);
  `when`, `Point`, `Polygon`, `LinearRing`, `ExtendedData` — игнор; до разбора `countTags(text, 'coord') > maxPoints`
  → `too_many_points`; при разборе — обрыв на `maxPoints` кортежей; все высоты 0 → высоты удаляются (RC-7).
- `src/format.ts` — сканер пролога `xmlRootAfterProlog(bytes, name)` (бывший `isGpxHead`), `detectRouteFormat(bytes):
  'gpx' | 'kml' | null`; `detectTrackFormat` — без изменения поведения.
- `src/track.ts` — `ROUTE_FILE_EXTENSIONS = ['gpx', 'kml'] as const`, `ROUTE_FILE_MAX_BYTES = 5 * 1024 * 1024`
  (комментарий: совпадает с контрактом, пакет от контракта не зависит).
- `src/precheck.ts` — `precheckRouteFile(file)` (общий внутренний помощник с `precheckTrackFile`, результат тот же
  тип `TrackPrecheckResult`).
- `src/parse.ts` — `analyzeRoute`: `detectRouteFormat` → `gpx`: `parseGpx(…, { allowRoute, maxPoints })`; `kml`:
  `parseKml(…, { maxPoints: ROUTE_MAX_POINTS })`; `null` → `unreadable`; дальше без изменений; экспорт `parseKml`.
- `src/__fixtures__/` — см. TESTS; `expected.json` — записи KML.

api (`apps/api`)
- `src/db/migrations/0021_routes_rider.ts` (новый) + в конец `migrations`: экспорт `ROUTES_RIDER_INDEXES`; создать
  `routes_owner_origin_sha_unique` и `routes_owner_origin_idx` (RC-4), затем `if (await
  routes.indexExists('routes_owner_sha_unique')) await routes.dropIndex('routes_owner_sha_unique')`. Без транзакции,
  без бэкфилла (`origin` есть у всех документов с 0013).
- `src/modules/routes/routes.collection.ts` — `origin: RouteOrigin`; комментарий: уникальны `(ownerUserId, origin,
  sha256)`; `rider` — личный маршрут автора, `catalog` всегда `null`, удаляется автором.
- `src/modules/routes/routes.repository.ts`:
  - правки RC-2: `findReady`, `findPublished`, `routesByIds` — `+ origin: 'platform'`; `listVisible` — `origin:
    'platform'` в обеих ветках `$or`; `findByOwnerSha(origin, ownerUserId, sha256)`;
  - новые: `findOwn(ownerUserId, id)`, `listOwn(ownerUserId, beforeId, limit)` (`{ ownerUserId, origin: 'rider' }`,
    `sort({ _id: -1 })`, индекс `routes_owner_origin_idx`), `countOwn(ownerUserId)`, `renameOwn(ownerUserId, id,
    title, now): Promise<RouteDoc | null>` (`findOneAndUpdate`, `returnDocument: 'after'`), `deleteOwn(session,
    ownerUserId, id): Promise<boolean>` (три `deleteOne` с `{ session }`).
- `src/modules/routes/routes.service.ts` — `accept(owner: { userId; origin: RouteOrigin }, title, bytes, options?: {
  maxRoutes?: number }): Promise<{ created; route: RouteDoc }>`: формат — `detectRouteFormat`; дедуп и гонка
  `isDuplicateKey(error, 'routes_owner_origin_sha_unique')` по `(origin, userId)`; квота после дедупа (RC-5);
  `PanelAudit.append('route.created')` — **только** `platform`; outbox — обоим. `again` возвращает `RouteDoc`.
  `visible()` — RC-2. Лог без названия.
- `src/modules/routes/routes-admin.controller.ts` — `upload` → `accept({ userId, origin: 'platform' }, …)` +
  `routes.view(result.route)` (ответ панели прежний).
- `src/modules/routes/route-catalog.ts` — `export function displayGeometryOf(route: RouteDoc, line):
  RouteDisplayGeometry | null` (вынос из `displayGeometry`, тот же код); комментарий кэша: «только `platform`».
- `src/modules/routes/route-processing.processor.ts` — `analyzeAndRecord`: исходника нет → `findRoute(id)`; нет →
  `skipped` (лог `route <id> deleted during processing`), иначе — исключение как раньше.
- `src/modules/routes/my-routes.service.ts` (новый) — `MyRoutesService`: `parseTitle`, `admit(userId, ip)` (лимиты
  и семафор RC-5, `ENV.EMAIL_TOKEN_SECRET` для `rateLimitKeyForIp` — как `TrackUploadsService.admit`), `upload`,
  `list` (курсор `encodeCursor('m', _id)`, ключ `z.literal('m')`), `get`, `map` (`findOwn` → `ready` →
  `displayLine` → `displayGeometryOf`; иначе 404), `rename` (то же название — без записи), `delete`
  (`MongoTransactions.run(tx => deleteOwn)`; `false` → 404; лог после коммита); `toMyRoute(route)` — явный список
  полей.
- `src/modules/routes/routes-mine.controller.ts` (новый) — таблица выше.
- `src/modules/routes/routes.policy.ts` — `riderUploadUserLimit: { limit: 20, windowSec: 3600 }`,
  `riderUploadIpLimit: { limit: 60, windowSec: 3600 }`, `riderMaxConcurrentUploads: 4`, `riderMaxRoutes:
  MY_ROUTE_MAX_COUNT`.
- `src/modules/routes/routes.module.ts` — `RoutesModule.imports += IdentityModule`; `controllers:
  [RoutesMineController, RoutesAdminController, RoutesPublicController]`; `providers += MyRoutesService`.
- `src/error-messages.ts` — `ROUTE_QUOTA_EXCEEDED: 'Достигнут предел маршрутов'`; `ROUTE_FORMAT_UNSUPPORTED: 'Выберите
  файл GPX или KML'`.
- `test/routes.ts` — `MY_ROUTES = '/v1/routes/mine'`, `uploadMyRoute(h, accessToken, bytes, title, ip?)`,
  `parsedMyRoute`; существующие помощники без смены поведения.

api-client (`packages/api-client/src/index.ts`, блок «маршруты райдера», вход обязателен)
- `uploadMyRoute(token, body: Blob | Uint8Array, title)` и `myRouteUploadRequest(token, title)` (`{ url, method,
  headers }`, как `trackUploadRequest`; `title` — `queryString({ title })`); `listMyRoutes(token, params: { limit?;
  cursor? } = {})`; `getMyRoute(token, id)`; `getMyRouteMap(token, id)` → `RouteMapGeometry`; `renameMyRoute(token, id,
  body: RenameRouteInput)` → `postAuthorized`; `deleteMyRoute(token, id)` → `POST …/delete`, `z.undefined()`. Все id —
  `encodeURIComponent`.

app (`apps/app`)
- `src/features/devices/pick-track-file.ts`, `.web.ts` — `pickTrackFile(extensions: readonly string[] =
  TRACK_FILE_EXTENSIONS)`: web — `type: extensions.map(…)`, native — параметр не используется (`*/*`). Вызовы
  заездов — без правок.
- `src/features/devices/send-track-file.ts` — `sendFile<T>(request, body, schema: z.ZodType<T>, options)`;
  `sendTrackFile = (r, b, o) => sendFile(r, b, TrackUpload, o)` (поведение и тесты прежние).
- `src/features/routes/my-routes-queries.ts` (новый) — ключи и хуки (см. «Ключи query»), `useRenameMyRoute`,
  `useDeleteMyRoute` (404 → успех), все через `withAccessToken`.
- `src/features/routes/use-my-route-upload.ts` (новый) — состояния `idle` → `naming { file, title, error? }` →
  `uploading { name, progress }` → `idle` (успех: `setQueryData` первой страницы + `invalidateQueries(['routes',
  'mine'])`) | `failed { message }`; `choose()` (picker + `precheckRouteFile`), `setTitle`, `submit()` (валидация
  `RouteTitle` — ошибка под полем), `cancel()` (abort).
- `src/features/routes/my-route-upload.tsx` (новый) — блок «Загрузить маршрут» (`Button`) / `TextField` «Название»
  + «Загрузить» (`loading`) + «Отменить» / `UploadProgress` / `Banner tone="error"` с текстом.
- `src/features/routes/my-route-format.ts` (новый) — `defaultRouteTitle(fileName)` (RC-6), `myRouteStatus(route):
  { label, tone } | null` (`processing` → «Обрабатывается», `failed` → причина `routes.mine.failure.<code>`,
  `'unknown'` → «Не удалось обработать»), `myRouteUploadedAt(route)` (дата по Минску, `minsk-format`).
- `src/features/routes/error-messages.ts` (новый) — `myRouteErrorMessage(error)`: `ROUTE_FORMAT_UNSUPPORTED`,
  `ROUTE_TOO_LARGE`, `RATE_LIMITED`, `ROUTE_QUOTA_EXCEEDED` (с `MY_ROUTE_MAX_COUNT`), сеть → «Нет соединения», прочее
  → «Не удалось загрузить маршрут»; precheck — `routes.mine.precheck.extension|empty|too_large`.
- `src/components/route-list-card.tsx` — внутренняя рамка `RouteCardFrame` (название, строка цифр, вторая строка,
  необязательный `Pill`); `RouteListCard` — на ней без смены разметки (тест прежний); новый `MyRouteListCard({ route,
  onPress })`: `ready` — `routeStats`, вторая строка — дата загрузки; `processing`/`failed` — `Pill` статуса вместо
  цифр; a11y — одна ссылка «название. статус или цифры». Скелетон общий.
- `src/features/routes/my-route-feed.tsx` (новый) — `FlatList` по образцу `route-feed.tsx`: шапка (заголовок,
  переключатель — пропс `header`), `OfflineBanner`, блок загрузки, `AsyncContent` (скелетон — 3
  `RouteListCardSkeleton`; ошибка без данных — «Нет соединения»/«Не удалось загрузить» с повтором; при данных —
  баннер), пусто — `EmptyState` «У вас пока нет маршрутов» + действие «Загрузить маршрут»; догрузка `loadMore`;
  `usePullToRefresh([feed.refetch])`; карточка → `/routes/mine/<id>`.
- `src/features/routes/route-line-map.tsx` (новый) — тело `CatalogRouteMap` с пропсами `{ distanceM, mapQuery:
  UseQueryOptions<RouteMapGeometry> }` (`useQuery({ ...mapQuery, enabled: styleUrl !== null })`); `catalog-route-map.tsx`
  — `<RouteLineMap distanceM={route.distanceM} mapQuery={catalogRouteMapOptions(route.id)} />` (testID и тесты
  прежние; `useCatalogRouteMap` → `catalogRouteMapOptions` в `queries.ts`).
- `src/features/routes/detail-row.tsx` (новый) — `Row` из `route-detail.tsx` (перенос, без копии).
- `src/features/routes/my-route-detail.tsx` (новый) — `Uuid.safeParse(id)` → иначе «недоступен» без запроса;
  `DetailHeader`, `DocumentTitle` (название; неизвестен — «Маршрут»), `OfflineBanner`, `AsyncContent`; 404 —
  `EmptyState` «Маршрут недоступен» + «Мои маршруты» (`/routes?view=mine`); тело: название, `ready` — `RouteLineMap`
  (`myRouteMapOptions(id)`) и строки «Длина», «Набор», «Петля», «Загружен»; `processing` — статус «Обрабатывается» с
  опросом; `failed` — причина; «Переименовать» (встроенная форма `TextField` + «Сохранить»/«Отменить», ошибки под
  полем), «Удалить» → подтверждение «Удалить маршрут насовсем?» (`Button` + «Отменить», как `UploadRow`) → после
  успеха `router.replace('/routes?view=mine')`. Без «Поделиться». Pull-to-refresh — деталь.
- `src/app/routes/mine/[id].tsx` (новый) — экран без `loader`/`generateMetadata`; `src/app/_layout.tsx` —
  `<Stack.Screen name="routes/mine/[id]" />` **внутри** первого `Stack.Protected` (рядом с `rides/edit/[id]`).
- `src/app/(tabs)/routes.tsx` — `view` из `useLocalSearchParams` (`'mine'` | иначе каталог), `SegmentedControl`
  (`routes.switch.catalog` «Каталог», `routes.switch.mine` «Мои»), `router.setParams({ view })`; рендер `RouteFeed` или
  `MyRouteFeed`, переключатель — в `header` обеих лент.
- `e2e/web.spec.ts` — шаг с API (см. TESTS).

i18n (`packages/i18n/src/ru.ts`) — новые ключи, существующие не меняются
- `routes.switch.label|catalog|mine`.
- `routes.mine.*`: `empty` («У вас пока нет маршрутов»), `emptyHint`, `upload` («Загрузить маршрут»), `title`
  («Название»), `submit` («Загрузить»), `cancel`, `status.processing` («Обрабатывается»), `status.unknown`,
  `failure.unreadable|no_track|too_many_points|too_short|too_long|timeout`, `error.ROUTE_FORMAT_UNSUPPORTED`
  («Формат не поддерживается — выберите GPX или KML»), `error.ROUTE_TOO_LARGE` («Файл слишком большой — до 5 МБ»),
  `error.RATE_LIMITED`, `error.ROUTE_QUOTA_EXCEEDED` («Можно хранить до {limit} маршрутов — удалите ненужные»),
  `error.generic`, `precheck.extension|empty|too_large`, `card.label`, `detail.uploadedAt` («Загружен»),
  `detail.notFound` («Маршрут недоступен»), `detail.back` («Мои маршруты»), `detail.rename`, `detail.renameSave`,
  `detail.delete`, `detail.deleteConfirm` («Удалить маршрут насовсем? Линия и файл будут удалены»),
  `detail.deleteCancel`, `detail.map.label`, `detail.map.failed`. Длина/набор/петля — reuse `routes.detail.*`.

### TYPES & SCHEMAS

```ts
// packages/contracts/src/routes/route.schema.ts
export const ROUTE_ORIGINS = ['platform', 'rider'] as const;           // только в конец
export type RouteOrigin = (typeof ROUTE_ORIGINS)[number];
export const ROUTE_FILE_EXTENSIONS = ['gpx', 'kml'] as const;          // = packages/tracks ROUTE_FILE_EXTENSIONS

// packages/contracts/src/routes/my-route.schema.ts — ответы приложения: справочники tolerantEnum (R6)
export const MY_ROUTE_MAX_COUNT = 100;                                  // квота, 409 ROUTE_QUOTA_EXCEEDED
export const MY_ROUTE_LIST_MAX_LIMIT = 50;
/** Загрузка — UploadRouteQuery (title: RouteTitle 3–120), тело — байты GPX/KML. */
export const MyRoute = z.object({
  id: Uuid, title: z.string(),
  status: tolerantEnum(ROUTE_STATUSES), failure: tolerantEnum(ROUTE_FAILURE_CODES).nullable(),
  distanceM: z.number().int().nullable(), elevationGainM: z.number().int().nullable(), isLoop: z.boolean().nullable(),
  createdAt: z.iso.datetime(),
});                                   // без origin, ownerUserId, sha256, sizeBytes, attempts, catalog, линий
export const MyRouteDetail = MyRoute; // GET :id — те же поля
export const MyRoutePage = z.object({ items: z.array(MyRoute), nextCursor: z.string().nullable() });
export const MyRouteQuery = z.strictObject({
  ...PageQuery.shape,
  limit: z.coerce.number().int().min(1).max(MY_ROUTE_LIST_MAX_LIMIT).default(20),
  cursor: PageCursor.optional(),
});
export const RenameRouteInput = z.strictObject({ title: RouteTitle });
// карта — RouteMapGeometry (reuse); ErrorCode += 'ROUTE_QUOTA_EXCEEDED'
```

```ts
// packages/tracks
export function detectRouteFormat(bytes: Uint8Array): 'gpx' | 'kml' | null;
export function parseKml(text: string, options: { maxPoints: number }): { points: ParsedPoint[] };
export function precheckRouteFile(file: { name: string; size: number }): TrackPrecheckResult;
// apps/api
export function displayGeometryOf(route: RouteDoc, line: [number, number][] | undefined): RouteDisplayGeometry | null;
```

Совместимость: эндпоинты новые (старые сборки их не зовут; новая сборка со старым API — 404 на `GET
/v1/routes/mine`: «Не удалось загрузить» с повтором; деплой API до сборок). `ErrorCode` и `ROUTE_ORIGINS` — в конец.
Ответы панели (`PanelRoute*`) и публичные (`Catalog*`) не меняются. `MyRoute.status` — `tolerantEnum`: новый статус
в будущем — `'unknown'`, без опроса.

### Данные, миграции, индексы (`pokatim-db.md`)

- `routes.origin` — `'platform' | 'rider'`, неизменно. Маршрут райдера: `catalog: null`, `ownerUserId` — автор;
  меняются только `title` (rename) и поля обработки (worker).
- `0021_routes_rider`: `routes_owner_origin_sha_unique { ownerUserId: 1, origin: 1, sha256: 1 }` unique,
  `routes_owner_origin_idx { ownerUserId: 1, origin: 1, _id: -1 }`, затем удаление `routes_owner_sha_unique` (HG-1).
  Идемпотентна, без транзакции. Порядок деплоя: миграция → API (`pr.md`).
- Запросы «моих»: список/квота — `routes_owner_origin_idx` (`explain` без `SORT`); дедуп — уникальный индекс.
- Удаление — `MongoTransactions.run`: `routes` (фильтр с `ownerUserId` и `origin: 'rider'`) → `route_geometries` →
  `route_sources`; колбэк без логов. Конфликт с `markReady` — write conflict по документу `routes` → повтор.
- Переименование — один `findOneAndUpdate` (без транзакции).

### Ключи query (app)

| Ключ | Хук | Источник | Примечание |
|---|---|---|---|
| `['routes','mine','list','pages']` | `useMyRoutes()` | `listMyRoutes({ limit: 20, cursor })` | `useInfiniteQuery`, `refetchInterval` 3 с при `processing`, `staleTime` — `DEFAULT_STALE_MS` |
| `['routes','mine','detail',id]` | `useMyRoute(id, enabled)` | `getMyRoute` | опрос при `processing`; при `ready` — инвалидирует список |
| `['routes','mine','map',id]` | `myRouteMapOptions(id)` → `RouteLineMap` | `getMyRouteMap` | только `ready`, `staleTime: Infinity` (геометрия неизменна) |

Префикс `['routes','mine']` не пересекается с каталогом (`['routes','list'|'cities'|'detail'|'map'|'races',…]`);
инвалидация после мутаций — только `['routes','mine']`; удаление — `removeQueries(['routes','mine','detail'|'map',
id])`. Выход из аккаунта очищает кэш как раньше (проверить, что `['routes','mine']` не переживает выход).

### FILES TO READ

- api: `modules/routes/{routes.service.ts,routes.repository.ts,route-catalog.ts,route-processing.processor.ts,
  routes.module.ts,routes-admin.controller.ts,routes-admin.int.test.ts,routes-public.int.test.ts}`,
  `modules/tracks/{track-uploads.controller.ts,track-uploads.service.ts,track-uploads.int.test.ts,tracks.policy.ts}`,
  `modules/races/{races.service.ts (corridor ~стр. 200–245),races-corridor.int.test.ts}`, `modules/rides/rides.module.ts`
  (порядок контроллеров), `src/{raw-body.ts,parse-thread.ts,http-app.ts,page-cursor.ts}`,
  `db/migrations/{0013_routes.ts,0020_routes_catalog.ts,migrations.int.test.ts}`, `test/{routes.ts,identity.ts,panel.ts}`.
- tracks: `src/{format.ts,gpx.ts,parse.ts,precheck.ts,track.ts,summary.ts}`, `format.test.ts`, `analyze-route.test.ts`,
  `__fixtures__/{xxe.gpx,billion-laughs.gpx,route-*.gpx,expected.json}`.
- contracts/api-client: `routes/{route.schema.ts,route-catalog.schema.ts}`, `tracks/track-upload.schema.ts`,
  `common.ts`, `api-client/src/{index.ts,tracks.test.ts,routes.test.ts}`.
- app: `features/devices/{pick-track-file*.ts,send-track-file.ts,upload-track*.ts,use-track-file-upload.ts,
  upload-progress.tsx,upload-row.tsx,queries.ts,error-messages.ts,format.ts}`, `features/routes/*`,
  `components/route-list-card.tsx`, `app/(tabs)/routes.tsx`, `app/_layout.tsx`, `app/rides/edit/[id].tsx`,
  `features/maps/{route-map-props.ts,route-geometry.ts,use-map-style.ts}`, `lib/query-client.ts`.

### TESTS

tracks (vitest; фикстуры — `src/__fixtures__/`, реальные экспорты, ≤ 50 КБ; источник — комментарием в `expected.json`
или в описании теста, `pokatim-tests.md`)
- Фикстуры KML: `route-mymaps.kml` (экспорт Google My Maps «KML»: `Document/Folder/Placemark`, `LineString` с `,0`
  высотами, плюс `Point`-метки), `route-earth-gxtrack.kml` (Google Earth Pro, `gx:Track` с `when`/`gx:coord` и
  высотами), `route-no-alt.kml` (`coordinates` без третьей координаты), `route-multigeometry.kml` (две `LineString` в
  `MultiGeometry` + `Point`), `route-points-only.kml` (только `Point` → `no_track`), `empty.kml` (`<Document/>` →
  `no_track`), `xxe.kml`, `billion-laughs.kml`, `route.kmz` (zip-заголовок `PK\x03\x04` → формат `null`).
- `format.test.ts`: `detectRouteFormat` — GPX/KML с BOM, прологом, комментариями, без декларации → формат; `<!DOCTYPE`
  до корня, `<kmlfoo>`, KMZ, FIT, пусто → `null`; **`detectTrackFormat(kml) === null` — прежний тест без правок**.
- `kml.test.ts`: My Maps — точки линии в порядке, метки `Point` не попали, высоты 0 удалены; `gx:Track` — `gx:coord`
  с высотами; `MultiGeometry` — склейка в порядке документа (число точек = сумма); без высот; `<!DOCTYPE`/`<!ENTITY`
  → `unreadable`; > `maxPoints` кортежей `coordinates` и `gx:coord` → `too_many_points` (синтетика в памяти);
  битый XML → `unreadable`.
- `analyze-route.test.ts`: KML-фикстуры → `distanceM`/`elevationGainM` (`null` у My Maps и без высот)/`isLoop` по
  `expected.json`; GPX-кейсы без правок.
- `precheck.test.ts` (или в существующем): `precheckRouteFile` — `.gpx`/`.KML` ok, `.kmz`/`.fit`/`.tcx` →
  `extension`, 0 байт → `empty`, 5 МиБ + 1 → `too_large`; `precheckTrackFile` прежний.
- `gpx.test.ts` — зелёный без правок после выноса в `xml.ts`.

contracts / api-client (vitest)
- `my-route.schema.test.ts`: `MyRoute` — новый статус/код отказа → `'unknown'`; `MyRouteQuery` — limit 51, лишний
  ключ → ошибка; `RenameRouteInput` — 2 символа, 121, перевод строки, пробелы вокруг (trim), лишний ключ.
  `route.schema.test.ts` — `ROUTE_ORIGINS`, `ROUTE_FILE_EXTENSIONS`. `common.test.ts` — порядок `ErrorCode`.
- api-client `routes.test.ts`: пути `/v1/routes/mine…`, `encodeURIComponent('a/b')`, `?title=` с кириллицей,
  `Authorization`, `content-type: application/octet-stream`, `POST …/rename` с телом, `…/delete` → 204, 404 →
  `ApiHttpError`.

api int (реальная MongoDB, изолированные `MONGO_URL_TEST`/`REDIS_URL_TEST`; свой IP на файл)
- `routes-mine.int.test.ts`: загрузка GPX → 202 `processing` → `processRoute` → `GET :id` `ready` с длиной; KML →
  `ready`; пустой KML → `failed: no_track`; повтор того же файла → 200 тот же id (дедуп), после `failed` → 202
  (requeue); KMZ/FIT/TCX-байты → 415; > 5 МиБ → 413 + `Connection: close`; без `title`/2 символа → 400; 21-я загрузка за
  час → 429 **до чтения тела** (тело не читается — как `track-uploads.int.test.ts`); квота: 100 маршрутов (прямой
  вставкой) → новый файл 409 `ROUTE_QUOTA_EXCEEDED`, тот же файл → 200; список — только свои `rider`, новые сверху,
  курсор по 2 на 5 без дублей; `/map` готового — ровно `bounds, finish, line, start`, не готового — 404; rename → 200,
  в списке новое название, то же название — без записи (`updatedAt` прежний); delete → 204, три коллекции пусты,
  повтор → 404, `GET :id` → 404; **удаление в обработке**: delete при `processing` → `processRoute` → `skipped`, нет
  `route_geometries`/`route_sources`; захват до удаления (spy `sourceBytes` → удалить → `undefined`) → `skipped` без
  исключения; ключи `MyRoute` — ровно контрактные, в теле нет `ownerUserId`, `sha256`, `origin`, `attempts`,
  `catalog`, `matchLine`; `Cache-Control: no-store` на всех; без входа — 401 на всех шести; `GET /v1/routes/mine` без
  входа — 401 (не 400 и не публичный ответ); `explain` списка — `IXSCAN routes_owner_origin_idx` без `SORT`.
- **Изоляция (отрицательные, RC-2; доказательство — убрать условие `origin` → красный, итог в §12):**
  - чужой райдер: `GET/map/rename/delete` маршрута другого райдера → 404, документ не изменился;
  - панель (`routes-admin.int.test.ts`): сотрудник-владелец маршрута райдера (тот же пользователь вошёл в
    приложение) — `GET /v1/admin/routes` (с `status=ready` и без) не содержит его `ready`/`processing` маршрут
    райдера; `GET /v1/admin/routes/:id` → 404 (и другому сотруднику с `races.read`);
  - каталог (`routes-catalog-admin.int.test.ts`): `POST /v1/admin/routes/:id/publish` маршрута райдера → 404,
    `catalog` остался `null`;
  - публично (`routes-public.int.test.ts`): `GET /v1/routes` не содержит, `GET /v1/routes/:id`, `/map`,
    `/routes/cities` — 404 / нет города; ещё отрицательно — документ райдера с проставленным вручную `catalog`
    (защита в глубину `findPublished`) → 404;
  - races (`races-corridor.int.test.ts`): `RaceInput.corridor.routeId` = готовый маршрут райдера → 400
    `ROUTE_NOT_READY` на `corridor.routeId`; `GET /v1/routes/:id/races` → 404; гонка с подставленным в БД
    `corridor.routeId` райдера → `GET /v1/races/:id/route` → 404 (порт `displayGeometry`);
  - results: `RouteGeometry.matchGeometry`/`bounds` для id маршрута райдера → `null` (unit сервиса на реальной БД).
- Дедуп между origin (AC5): сотрудник загрузил файл в панели (`platform`) → тот же файл в приложении → 202 **новый**
  `rider`-маршрут (другой id); снова в панели → 200 маршрут `platform`; одновременная двойная загрузка райдера →
  один маршрут (`isDuplicateKey` нового индекса).
- `migrations.int.test.ts`: `0021` — оба индекса (unique), `routes_owner_sha_unique` отсутствует, повторный `up` без
  ошибки; ожидания полного набора индексов `0013`/`0020` — дополнить (как DEV-5 routes-01).
- `parse-thread.test.ts`: `analyzeRoute` KML-фикстуры в потоке → результат; `billion-laughs.kml` → `unreadable`.

app (jest; TZ Europe/Minsk)
- `my-route-format.test.ts`: `defaultRouteTitle` («Кольцо.gpx» → «Кольцо», «a.b.kml» → «a.b», перевод строки →
  пробел, 200 символов → 120); `myRouteStatus` (processing / failed с кодом / `'unknown'`).
- `route-list-card.test.tsx`: `MyRouteListCard` — `ready` (цифры, дата), `processing` (Pill), `failed` (причина), a11y;
  `RouteListCard` — прежние кейсы.
- `my-route-feed.test.tsx`: скелетон, карточки, пусто «У вас пока нет маршрутов» + «Загрузить маршрут», ошибка с
  повтором, баннер при данных, опрос идёт при `processing` и останавливается при `ready` (fake timers), догрузка.
- `use-my-route-upload.test.ts`: `.kmz` → «Формат не поддерживается» без запроса; > 5 МиБ → без запроса; название по
  умолчанию из имени; 2 символа → ошибка под полем без запроса; 415/413/429/409 → тексты; отмена; успех — элемент в
  начале списка.
- `my-route-detail.test.tsx`: невалидный id — «Маршрут недоступен» без запроса; 404 — то же + «Мои маршруты»;
  `ready` — карта `RouteLineMap` (`corridor={false}`), цифры, «Загружен»; `processing` — статус без карты; rename —
  `POST …/rename`, название обновилось, ошибка под полем; delete — подтверждение → `POST …/delete` → переход на
  `/routes?view=mine`; кнопки «Поделиться» нет.
- `routes-tab.test.tsx` (или тест экрана вкладки): переключатель — «Каталог» по умолчанию с фильтрами; «Мои» —
  `?view=mine`, фильтров нет; `view=mine` в URL открывает «Мои».
- `catalog-route-map`/`route-detail` тесты routes-01 — зелёные без правок после выноса `RouteLineMap`/`Row`;
  `send-track-file`/`upload-track.web.test.ts` — без правок.

e2e (`e2e/web.spec.ts`, Playwright, `E2E_API=1`)
- После входа: вкладка «Маршруты» → «Мои» → «У вас пока нет маршрутов» и кнопка «Загрузить маршрут»; перезагрузка с
  `?view=mine` — снова «Мои». Без API — шаг пропускается (как прочие шаги с входом).

### Порядок реализации

1. tracks: `xml.ts` (вынос, `gpx.test` зелёный) → `detectRouteFormat` → `kml.ts` + фикстуры → `analyzeRoute` →
   `precheckRouteFile`; тесты.
2. contracts: `ROUTE_ORIGINS`, `ROUTE_FILE_EXTENSIONS`, `my-route.schema.ts`, `ROUTE_QUOTA_EXCEEDED`; тесты.
3. api данные: `0021_routes_rider`, `RouteDoc.origin`; **изоляция RC-2** в репозитории и `visible()` + отрицательные
   int-тесты панели/каталога/races (сначала красные на старом коде — доказательство); тест миграции.
4. api приём: обобщение `accept`/`again`, `isDuplicateKey` нового индекса, processor «удалён в обработке»;
   регрессия `routes-admin.int.test.ts`.
5. api «мои»: `MyRoutesService`, `RoutesMineController` (первым), политика, тексты ошибок; int.
6. api-client + тесты.
7. app: `pickTrackFile(extensions)`, `sendFile`, `RouteLineMap`/`Row` вынос (тесты routes-01 зелёные), запросы,
   загрузка, карточка списка, лента «Мои», переключатель, карточка `routes/mine/[id]`, `_layout`, i18n; тесты.
8. e2e, docs (§10), `TURBO_CONCURRENCY=1 pnpm check`; `pr.md` — миграция `0021` (HG-1), порядок деплоя.

### OUT OF SCOPE

UI загрузки KML в панели (RC-10, follow-up); удаление `routes_owner_idx` (contract follow-up); отдельная очередь для
маршрутов райдеров (RC-16); публикация/«Поделиться» своим маршрутом, UGC, модерация; маршрут у кофе-райда; KMZ, FIT-
курс, TCX, импорт по ссылке, экспорт; правка геометрии и профиль высот; гостевой режим «Моих»; удаление маршрутов
при удалении аккаунта (появится с удалением аккаунта — зафиксировать в `pokatim-db.md` строкой «обязано удалить
`routes` `origin: 'rider'` автора»).

### Для §8.3 (coder переносит в чек-лист)

- AuthN/AuthZ: `AuthGuard` на всех шести; фильтр владельца и `origin: 'rider'` в репозитории; чужой = неизвестный =
  404; изоляция RC-2 с отрицательными тестами.
- Входные данные: `title` — `RouteTitle` (zod до сервиса), id — `Uuid`, тело — только `application/octet-stream`,
  обрыв на 5 МиБ; KML — запрет `DOCTYPE`/`ENTITY`, подсчёт элементов и `gx:coord` до дерева, обрыв кортежей, разбор
  только в `runParseThread`.
- Данные наружу: `MyRoute` — явный список полей, без `ownerUserId`/`sha256`/`origin`/`attempts`/`catalog`/линии
  сверки; карта — только линия показа своего `ready`.
- Злоупотребления: лимит райдера и IP до тела, семафор приёмов, квота 100.
- Логи: `routeId`, `userId`, коды; без названий, имён файлов и координат; действия райдера не пишутся в журнал
  панели.

## 12. Outcome (заполняет coder)

Coder, 2026-10-27, ветка `feature/routes-02-my-routes` (коммиты `98d2d49`…`a00b66a` + docs). Порядок — §11, TDD.

### Что сделано

- **tracks:** `xml.ts` (общие защиты XML, `gpx.test.ts` без правок), `detectRouteFormat` (`detectTrackFormat` прежний,
  тест `kml → null` зелёный), `kml.ts` (`parseKml`), `analyzeRoute` GPX/KML, `precheckRouteFile`,
  `ROUTE_FILE_EXTENSIONS`/`ROUTE_FILE_MAX_BYTES`; 9 фикстур KML + генератор.
- **contracts / api-client:** `ROUTE_ORIGINS`, `ROUTE_FILE_EXTENSIONS`, `my-route.schema.ts`, `ROUTE_QUOTA_EXCEEDED`;
  методы `uploadMyRoute`, `myRouteUploadRequest`, `listMyRoutes`, `getMyRoute`, `getMyRouteMap`, `renameMyRoute`,
  `deleteMyRoute`.
- **api:** миграция `0021_routes_rider` (HG-1); `RouteDoc.origin: RouteOrigin`; изоляция RC-2 в `RoutesRepository`
  и `visible()`; общий `RoutesService.accept(owner, title, bytes, { maxRoutes })` (журнал панели — только
  `platform`, дедуп по новому индексу); процессор: удалён в обработке — `skipped`; `RoutesMineController` (первым) +
  `MyRoutesService`, политика RC-5, тексты ошибок; `displayGeometryOf`.
- **app:** `pickTrackFile(extensions)`, `sendFile`; `RouteLineMap`, `DetailRow`; запросы, загрузка, `MyRouteListCard`,
  лента «Мои», переключатель `?view=mine`, карточка `routes/mine/[id]` под гардом; i18n `routes.switch.*`,
  `routes.mine.*`; e2e — шаг «Мои» в тесте вкладки «Маршруты».
- **docs:** `docs/product/routes.md`, `.claude/rules/pokatim-{app,backend,contracts,db,security}.md`, `pr.md`.

### Изоляция RC-2 — отрицательные доказательства

Тесты изоляции написаны до правки репозитория и прогнаны на старом коде (после миграции): все **красные по
результату**, после правки — зелёные.

| Точка | Тест | На старом коде |
|---|---|---|
| `listVisible` + `visible()` (панель) | `routes-admin.int`: сотрудник-автор маршрутов райдера | список содержал 4 маршрута вместо 1 |
| `findByOwnerSha` без `origin` (дедуп панели) | `routes-admin.int`: файл, уже загруженный в приложении | 200 (маршрут райдера) вместо 202 |
| `visible()` в публикации | `routes-catalog-admin.int`: публикация маршрута райдера | 409 вместо 404 |
| `findPublished`/каталог | `routes-public.int`: подставленный `catalog` | список и города содержали маршрут райдера |
| порты `findReady`/`matchGeometry`/`displayGeometry`/`summaries` | `routes-public.int`: порты races/results | `findReady` вернул маршрут райдера |
| коридор гонки (`findReady`) | `races-corridor.int`: `corridor.routeId` = маршрут райдера | 201 вместо 400 `ROUTE_NOT_READY` |
| `inCatalog` и карта гонки | `races-corridor.int`: гонки маршрута / подставленный коридор | 200 вместо 404 |

Удаление во время обработки (RC-8): условие «маршрута нет → `skipped`» в процессоре временно убрано — тест
`routes-mine.int` «захват до удаления» красный (`source is missing`), возвращено — зелёный.

### Проверки

- `MONGO_URL_TEST=…/pokatim_routes02_test REDIS_URL_TEST=…/13 TURBO_CONCURRENCY=1 pnpm check` → **EXIT 0**: Prettier
  — чисто; ESLint — 0; dependency-cruiser — «no dependency violations found (1104 modules)»; typecheck — 13/13 задач;
  тесты: tracks 255, contracts 246, design-tokens 120, i18n 6, api-client 84, api 1013 (100 файлов), admin 232, app
  1053 (119 наборов). Первый прогон `pnpm check` упал на `tracks/src/corridor/bench.test.ts` (AC14: 4,3 с при пределе
  3 с; load average машины ~29 — параллельные агенты); отдельно бенч — 0,25 с, повторный `pnpm check` — зелёный.
- Jest приложения: 1 из 3 полных прогонов — падение теста переключателя (`my-routes.test.tsx`) под нагрузкой; отдельно и
  в двух других полных прогонах — зелёный (риск флака по таймингу `findBy*`).

### NOT VERIFIED

- e2e веба с API (`E2E_API=1 pnpm e2e:web`, шаг «Мои») — не запускался: нужны `build:web`, API, worker и Mailpit.
- Ручная проверка iOS/Android/web, загрузка реальных экспортов My Maps, Google Earth, Komoot, Strava, RideWithGPS.
- Применение `0021_routes_rider` на dev/prod (порядок: миграция → API, `pr.md`).

### Риски

- Флак таймингов под нагрузкой (бенч AC14, тест переключателя).
- Склейка нескольких линий KML даёт перемычку в длине (RC-7, принято).
- Квота мягкая (перебор ≤ числа параллельных приёмов), общая очередь `route-processing` (RC-16).

### Фиксы ревью pass 1 (`findings.md`)

- **Codex HIGH — карта без сообщения:** `RouteLineMap` — состояния через `AsyncContent`: загрузка — скелетон, ошибка без
  данных — «Нет соединения» / «Не удалось загрузить» с «Повторить» (`geometry.refetch`); 404 геометрии и не заданный
  env — блока нет (как раньше). Pull-to-refresh карточки своего маршрута перезапрашивает и карту. Тесты: 500 → повтор
  → карта; нет сети → pull-to-refresh → карта.
- **Codex MEDIUM — 404 при кеше:** `NOT_FOUND` обновления — «Маршрут недоступен» и при показанных данных, кеш геометрии
  удаляется, опрос «Обрабатывается» на 404 останавливается. Тест: чтение → 404 при обновлении → «Маршрут недоступен»,
  карты, строк и «Удалить» нет.
- **Claude MEDIUM 1:** `pr.md` — откат API после первой загрузки в «Моих» раскрывает маршруты райдеров панели, каталогу
  и коридорам; перед откатом — скрыть или удалить `routes { origin: 'rider' }` либо исправлять только вперёд.
- **Claude MEDIUM 2:** после удаления — `router.dismissTo('/routes?view=mine')` вместо `replace`. Тест: лента → карточка
  → удалить → в корневом стеке один `(tabs)`; отрицательное доказательство — с `replace` в стеке два `(tabs)` (тест
  красный).
- **Claude LOW 4:** список инвалидируется только при переходе `processing → *` (предыдущий статус в `useRef`). Тест:
  открытие готовой карточки из ленты не перезапрашивает ленту.
- **Claude LOW 3:** `useMyRouteUpload` поднят в экран вкладки (выше переключателя) — «Каталог» во время отправки её не
  отменяет. Тест: прогресс 40 % → «Каталог» → «Мои» — прогресс на месте, запрос не прерван.
- **Claude LOW 5:** follow-up в §8.2.
- Слит `origin/develop` (PR #53, `fix/admin-smoke`) — без конфликтов.
- Проверка после фиксов и слияния: `TURBO_CONCURRENCY=1 pnpm check` (`pokatim_routes02_test`, Redis db 13) — **EXIT 0**:
  Prettier чисто, ESLint 0, dependency-cruiser «no dependency violations found (1106 modules)», typecheck и test —
  13/13 задач (часть — из кеша turbo при тех же входах); tracks 255, contracts 246, design-tokens 120, i18n 6,
  api-client 84, api 1013, admin 238, app 1059 (119 наборов).
