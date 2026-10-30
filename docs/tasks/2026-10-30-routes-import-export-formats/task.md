# task.md — routes-formats: импорт KMZ и TCX, экспорт KML и TCX

## 1. Title

Форматы маршрутов: загрузка KMZ и TCX (рядом с GPX/KML), скачивание KML и TCX (рядом с «Скачать GPX»).

## 2. Goal

Сейчас маршрут принимается только как GPX или KML (`docs/product/routes.md` «Форматы (M2)»: «KMZ, FIT-курс, TCX и
прочее — „Формат не поддерживается“»), а скачать опубликованный маршрут можно только очищенным GPX (P5). В таблице
«позже» `routes.md` стоят «KMZ, FIT-курс, TCX» и «Экспорт KML/FIT/TCX». Закрываем часть: импорт KMZ и TCX, экспорт
KML и TCX. Цель — райдер и команда загружают файл из Google Earth (KMZ) и Garmin/TrainingPeaks (TCX), а скачивают
маршрут в формате своего навигатора/приложения.

Задачу поставила родительская сессия (автономный режим): продуктовое поведение меняется по её прямому указанию;
решения ниже — `[ASSUMPTION]`, отражаются в `docs/product/routes.md`.

## 3. Scope

**Импорт (`packages/tracks`, worker; API — только сигнатура):**

- **TCX** (Garmin Training Center Database v2): корень `<TrainingCenterDatabase` (тот же сканер пролога, что GPX/KML).
  Точки — `Trackpoint/Position/{LatitudeDegrees,LongitudeDegrees}` (+ `AltitudeMeters`) из `Courses/Course/Track` и
  `Activities/Activity/Lap/Track` — все `Track` в порядке документа (как `trk/trkseg` GPX, RC-7). `Trackpoint` без
  `Position` пропускается (паузы, indoor). `Time`, пульс, мощность, `CoursePoint`, `Extensions` — игнорируются.
  Защиты XML — общие (`xml.ts`: DTD/сущности, предел элементов, предел точек подсчётом `Trackpoint` до разбора).
- **KMZ** (zip с KML): сигнатура `PK\x03\x04`. В worker — минимальный разбор zip на `node:zlib` (без новых
  зависимостей): EOCD → central directory → запись `doc.kml` в корне архива, иначе первая запись `*.kml` в корне по
  порядку central directory (правило KMZ Google). Методы 0 (stored) и 8 (deflate); шифрование, zip64, многотомность,
  нет `.kml` — `unreadable`. Распаковка с `maxOutputLength` (предел распакованного KML — `[ASSUMPTION]` 32 МиБ) —
  защита от zip-бомбы; дальше — тот же `parseKml`. Остальные файлы архива (картинки, вложенные KML в папках) не
  читаются.
- `detectRouteFormat` → `'gpx' | 'kml' | 'kmz' | 'tcx' | null`; `ROUTE_FILE_EXTENSIONS` (+ `kmz`, `tcx`) — пакет
  `@pokatim/tracks` и `@pokatim/contracts` синхронно; `precheckRouteFile`, окна выбора файла приложения и панели
  (`accept`, MIME), тексты подсказок и ошибок (`ROUTE_FORMAT_UNSUPPORTED`: «Выберите файл GPX, KML, KMZ или TCX»).
- API `RoutesService.accept`: формат по сигнатуре теперь знает KMZ (любой zip принимается в обработку; не KMZ внутри —
  `failed/unreadable` worker'ом) и TCX. FIT-курс и прочее — по-прежнему 415.

**Экспорт (worker считает, API отдаёт готовые байты — «разбора в API нет», как у GPX):**

- `routeKml(points)` — KML 2.2: один `Placemark/LineString/coordinates` (`lon,lat[,ele]`, 6 и 1 знак), без имени,
  стилей и метаданных исходника. `routeTcx(points)` — TCX v2 `Courses/Course`: `Name` — константа `Pokatim`
  (`Name` обязателен в схеме, ≤ 15 символов; строк исходника и названия маршрута в файле нет — как в GPX), один `Lap`
  (`TotalTimeSeconds`, `DistanceMeters`, `BeginPosition`, `EndPosition`, `Intensity=Active`), `Track/Trackpoint` с
  `Time`, `Position`, `AltitudeMeters` (если есть), `DistanceMeters` (накопленная). **`Time` обязателен схемой TCX** —
  `[ASSUMPTION]` синтетическое время: от `2000-01-01T00:00:00Z` при 24 км/ч (скорость «В пути» карточки), целые
  секунды; реального времени исходника в файле нет.
- Точки экспорта — те же, что у GPX (линия сверки с высотами, `matchPointsOf`).
- `RouteDerived` += `kml`, `tcx`; `ROUTE_DERIVED_VERSION` 1 → 2: регламент `routes-maintenance` пересчитает готовые
  маршруты (KML/TCX появятся у старых без участия автора). `route_exports` += `kml`, `tcx` (Binary), пишутся вместе с
  `gpx` в той же транзакции; у документов версии 1 этих полей нет.
- Публичные эндпоинты рядом с `GET /v1/routes/:id/gpx`: `GET /v1/routes/:id/kml` (`application/vnd.google-earth.kml+xml`)
  и `GET /v1/routes/:id/tcx` (`application/vnd.garmin.tcx+xml`) — тот же `public-read`, тот же IP-лимит скачивания
  (общий ключ `route-gpx` → один бюджет на все форматы), то же имя файла из названия с нужным расширением, 404 —
  маршрута нет в каталоге или нет экспорта этого формата.
- Контракт карточки `CatalogRouteDetail`: `gpxAvailable` остаётся (старые приложения), + `exportFormats:
  ('gpx'|'kml'|'tcx')[]` с `.default([])` (новое поле необязательно для старого API, RC-10). Форматы — по наличию
  полей в `route_exports`.
- Приложение (карточка маршрута каталога): вместо одной «Скачать GPX» — «Скачать» с выбором формата GPX / KML / TCX
  (доступные из `exportFormats`; нет `exportFormats` — как раньше по `gpxAvailable`). Форма выбора — по дизайн-системе
  приложения (architect: существующий меню/шторка-компонент; если нет — три secondary-кнопки нельзя, ряд действий
  «Поделиться» + «Скачать» в одну строку остаётся). Ошибка скачивания — прежний баннер с форматом.
- `api-client`: `catalogRouteKmlUrl`, `catalogRouteTcxUrl` (или `catalogRouteExportUrl(id, format)`).

## 4. Out of Scope

- FIT-курс (импорт и экспорт), импорт по ссылке Komoot/Strava, отправка в Garmin/Komoot.
- Экспорт «Моих маршрутов» и маршрутов панели (экспорт — только каталог, как GPX сейчас).
- Треки активностей (`TRACK_FILE_EXTENSIONS`, FIT/GPX заездов) — TCX заездов не добавляем.
- Скачивание в панели.
- Изменение `CORRIDOR_ENGINE_VERSION`, golden коридора, simplify, sensor-flags.

## 5. Architecture Context

- `packages/tracks`: `format.ts` (сигнатуры), новые `tcx.ts`, `kmz.ts` (zip на `node:zlib` — только в `parse.ts`-входе,
  не в лёгком `index.ts` для приложения), `route-kml.ts`, `route-tcx.ts` рядом с `route-gpx.ts`; `parse.ts` —
  `loadRoutePoints` (единственная точка новых форматов, RC-12), `analyzeRoute`/`deriveRoute`, `ROUTE_DERIVED_VERSION`.
- `packages/contracts`: `ROUTE_FILE_EXTENSIONS`, `CatalogRouteDetail.exportFormats`.
- `apps/api` `modules/routes`: `routes.service.accept` (сигнатура), `route-processing.processor` и регламент
  (запись kml/tcx), `routes.repository` (`writeExport`, `exportGpx` → чтение по формату, флаги форматов карточки),
  `routes.collection` (`RouteExportDoc`), `routes-public.controller/service` (+2 эндпоинта), `routes.policy`
  (имя файла/Content-Disposition по расширению). Миграция не нужна (новые поля необязательные, индексов нет);
  architect подтверждает.
- `apps/app`: карточка маршрута (`route-detail.tsx`), выбор файла «Моих маршрутов» (accept/MIME), i18n.
- `apps/admin`: `route-upload.tsx`/`CorridorField` — фильтр выбора файла и подсказки.

## 5.1 Placement & Reuse Gate

- Переиспользуем: `xmlRootAfterProlog`, `xml.ts` (защиты), `parseKml` (KMZ после распаковки), `sanitizePoints`,
  `matchPointsOf`, `gpxContentDisposition`/`gpxFileName` (обобщить по расширению, без копии), guard `route-gpx`,
  `downloadFile` приложения, `FileButton` панели.
- Запрещено: второй сканер сигнатур, вторая копия защит XML, zip-библиотека в зависимостях (решает architect, если
  `node:zlib` недостаточно — обоснование в 8.2), разбор/сериализация файлов в API, копипаста контроллера GPX трижды
  без общего хелпера.
- Новые форматы маршрута — только через `loadRoutePoints` (их получат и `analyzeRoute`, и бэкфилл `deriveRoute`).

## 6. Relevant Files

- `packages/tracks/src/format.ts`, `parse.ts`, `kml.ts`, `gpx.ts`, `xml.ts`, `route-gpx.ts`, `precheck.ts`, `track.ts`
- `packages/tracks/scripts/generate-kml-fixtures.ts`, `src/__fixtures__/` (+ `route.kmz`, `expected.json`)
- `packages/contracts/src/routes/route.schema.ts`, `route-catalog.schema.ts`
- `apps/api/src/modules/routes/{routes.service,route-processing.processor,routes.repository,routes.collection,routes-public.controller,routes-public.service,routes.policy}.ts`
- `apps/app/src/features/routes/route-detail.tsx`, выбор файла «Моих маршрутов»; `apps/admin/src/features/routes/route-upload.tsx`
- `packages/i18n/src/ru.ts`, `packages/api-client/src/routes.ts`
- `docs/product/routes.md`

## 7. Implementation Notes

- KMZ: сигнатура в API — только `PK\x03\x04` (zip). Разбор zip — по central directory (размеры локального
  заголовка могут быть 0 при флаге data descriptor); имена — CP437/UTF-8, сравнение `doc.kml` без учёта регистра,
  «в корне» = без `/`. Распакованный KML > предела — `unreadable`; распакованный KML дальше идёт со всеми проверками
  `parseKml`.
- TCX: `removeNSPrefix`, `preserveOrder` не обязателен (порядок `Track` внутри `Lap`/`Course` — массивами); предел точек —
  `countTags(text, 'Trackpoint')` до разбора.
- Существующая фикстура `route.kmz` (только локальный заголовок, без central directory, пустой `Document`) — теперь
  `detectRouteFormat` = `kmz`, разбор — `unreadable` (нет EOCD); API принимает её (202), а не 415 — тесты
  `format.test.ts`, `analyze-route.test.ts`, `routes-mine.int.test.ts` меняются осознанно. Нужны новые фикстуры:
  реальный KMZ Google Earth (doc.kml + картинка, deflate), KMZ без doc.kml (первый `.kml` в корне), KMZ без KML,
  zip-бомба (маленький архив, распаковка > предела), TCX курса Garmin Connect, TCX активности (Lap/Track, точки без
  `Position`), TCX без точек, TCX с DTD. **Решение (golden):** `expected.json` фикстур KML дополняется новыми
  записями; существующие значения не меняются.
- Экспорт — только числа (как GPX): ни одной строки из исходника и ни названия маршрута в файле.
- Имя скачиваемого файла: `<название>.kml` / `.tcx` — тот же санитайзер, что GPX.
- Старые маршруты (`derivedVersion` 1) до прохода регламента: `exportFormats: ['gpx']` — в карточке только GPX.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` синтетическое время TCX (2000-01-01, 24 км/ч) — TCX без `Time` невалиден по XSD и часть
  навигаторов его не берёт.
- `[ASSUMPTION]` `Name` курса TCX — константа `Pokatim` (как отсутствие названия в GPX).
- `[ASSUMPTION]` предел распакованного KML 32 МиБ; KMZ-архив по-прежнему ≤ 5 МиБ (`ROUTE_FILE_MAX_BYTES`).
- Размер `route_exports`: GPX ≤ ~1,2 МБ, KML ≤ ~0,6 МБ, TCX ≤ ~4 МБ на 20 000 точек — сумма < 16 МБ документа.
- Риск: регламент пересчитывает все готовые маршруты (версия 2) — нагрузка worker разовая, механизм уже есть.

## 8.1 Requirements Consistency (заполняет architect)

Architect review: **CONCERNS** (блокеров нет). Миграция не нужна: валидаторов коллекций (`$jsonSchema`) в
`apps/api/src/db/migrations` нет, `route_exports` создаёт `ensureCollection` (`0022_routes_derived`), вторичных индексов
у неё нет; новые поля `kml`/`tcx` необязательные, бэкфилл — регламент, не миграция (последняя — `0040_panel_totp`).

- **RC-1 (ошибка в spec: «24 км/ч — скорость „В пути“ карточки»).** Оценка карточки — `ROUTE_PACE_KMH` пакета
  `@pokatim/route-view` по покрытию: асфальт 27 (и «неизвестно»), гравий 20, смешанное 24. `@pokatim/tracks` её
  импортировать не может (`route-view` зависит от `tracks` — цикл), а покрытие — изменяемые метаданные каталога (экспорт
  считается до публикации и не пересчитывается при правке покрытия). Варианты: (a) своя константа
  `ROUTE_TCX_PACE_KMH = 24` в `route-tcx.ts` с пометкой «условная скорость синтетического времени, не оценка
  карточки»; (b) 27 (дефолт карточки); (c) по покрытию — нельзя (см. выше). **Рекомендация: (a)**, формулировку spec и
  `routes.md` исправить.
- **RC-2 (`exportFormats` «по наличию полей в `route_exports`» — лишнее чтение).** Обычная проекция наличие поля без
  его выдачи не показывает: карточке пришлось бы читать Binary до ~4 МБ или делать второй запрос. Варианты:
  (a) по `derivedVersion` геометрии, который карточка уже читает `derivedOf` (без нового запроса):
  `null` → `[]`, `1` → `['gpx']`, `≥ 2` → `['gpx','kml','tcx']` — верно по инварианту «геометрия и экспорт одной версии
  пишутся одной транзакцией» (`markReady`/`recordDerived`); (b) второй `findOne` в `route_exports` с проекцией-выражением
  `{ kml: { $ne: [{ $type: '$kml' }, 'missing'] } }` (Mongo 8 умеет; +1 запрос на карточку); (c) поле `formats` в
  `RouteExportDoc`. **Рекомендация: (a)** — одна функция `routeExportFormats(derivedVersion)` рядом с `ROUTE_POLICY`
  (версия появления формата — константа `{ gpx: 1, kml: 2, tcx: 2 }`); эндпоинты `/kml`, `/tcx` читают своё поле
  проекцией `{ <format>: 1 }`, нет поля — 404. AC8 переформулирован в 8.2.
- **RC-3 (контракт: строгий enum в ответе приложения).** `exportFormats: z.array(z.enum(...))` уронит разбор всей
  карточки у этой сборки, когда сервер добавит `fit` (FIT-курс в «позже»). Правило `pokatim-contracts.md`: массив кодов
  в ответе приложения — неизвестные отбрасываются `transform` (образец — `ProfileView.rideReasons`).
  **Решение:** `ROUTE_EXPORT_FORMATS = ['gpx','kml','tcx'] as const` (только в конец) и
  `exportFormats: z.array(z.string()).transform(оставить известные).default([])` + тест «незнакомый формат — отброшен».
- **RC-4 (предел распакованного KML 32 МиБ против памяти потока разбора).** Поток разбора — 160 МБ old generation
  (`DEFAULT_PARSE_LIMITS`): 32 МиБ байтов + строка (до 64 МБ UTF-16 при кириллице) + `XMLValidator` + дерево
  `preserveOrder` — гарантированный OOM, т. е. «unreadable через падение потока», а не через проверку. 50 000 точек KML
  (`ROUTE_MAX_POINTS`) — ≤ ~5–8 МБ даже с `gx:Track`/`when`. Варианты: (a) 16 МиБ; (b) 8 МиБ; (c) 32 МиБ (spec).
  **Рекомендация: (a)** `ROUTE_KMZ_MAX_KML_BYTES = 16 МиБ`, плюс отказ до распаковки, если объявленный в central
  directory распакованный размер больше предела (`maxOutputLength` остаётся страховкой от ложного заголовка).
- **RC-5 (KMZ: детали разбора zip, которых нет в spec).** (1) Данные записи — по смещению локального заголовка из
  central directory: `offset + 30 + nameLen(локальн.) + extraLen(локальн.)` — длины `extra` локального и центрального
  заголовков могут различаться; размеры — из central directory (флаг 3, data descriptor). (2) Метод 8 —
  `inflateRawSync` (raw deflate, не `inflateSync`), метод 0 — срез. (3) Проверка CRC-32 (`zlib.crc32`, Node ≥ 22.2;
  проект — Node 24) — несовпадение `unreadable`. (4) `unreadable`: нет EOCD (поиск с конца в последних 22 + 65 535
  байтах), флаг 0 (шифрование), маркеры zip64 (`0xFFFF`/`0xFFFFFFFF`, запись zip64 EOCD), номер диска ≠ 0, выход за
  границы буфера, записей больше разумного предела (например 1000). (5) «В корне» — нет `/` и `\` в имени; имя записи
  `doc.kml` — без учёта регистра (ASCII; CP437 для ASCII-имён не важен). (6) Распакованный KML проходит
  `detectRouteFormat(inner) === 'kml'` (тот же сканер пролога: `<!DOCTYPE` до корня — `unreadable`), затем `parseKml`.
- **RC-6 (любой zip — 202).** `.docx`/`.apk`/`.zip` проходят `accept` (202 → `failed/unreadable`), списывают лимит
  загрузок и место в квоте до удаления. Альтернатива — читать имена central directory в API — это разбор файла в API
  (запрет `pokatim-security.md`). **Рекомендация: как в spec** (отказ виден автору причиной «Не удалось прочитать
  файл»); тест на zip без KML через API.
- **RC-7 (объём `route_exports`).** TCX ≈ 3–4× GPX (≈ 200 Б на точку), KML ≈ 0,5× GPX; экспорт считается для **всех**
  готовых маршрутов (и личных маршрутов райдеров, квота 100), хотя скачивание — только каталог. Варианты: (a) как в spec,
  размер документа ≤ ~6 МБ (< 16 МБ) — проверить тестом на 20 000 точек; (b) хранить экспорт gzip (worker — `node:zlib`,
  API отдаёт с `Content-Encoding: gzip`/распаковывает) — сжатие ×8–10; (c) KML/TCX только маршрутам каталога —
  ломает инвариант версии и требует пересчёта при публикации. **Рекомендация: (a)** сейчас (прода нет, объёмы малы),
  (b) — follow-up при росте; `sizeBytes` документа экспорта — сумма трёх файлов (диагностика), не только GPX.
- **RC-8 (выбор формата в приложении).** В `@rkarakulov/ui` нет ActionSheet/Menu; `SegmentedControl` — переключатель
  состояния/фильтра, не действие. Есть `components/modal-sheet.tsx` (`ModalSheet`, образец — `features/rides/
  ride-published-sheet.tsx`). **Решение:** доступен один формат (маршрут версии 1 до бэкфилла, старый API) — прежняя
  кнопка «Скачать GPX» без шита (e2e и `routes.md` P5 не ломаются); ≥ 2 — secondary «Скачать» в той же строке с
  «Поделиться» → `ModalSheet` «Скачать маршрут»: по кнопке на формат во всю ширину (secondary, подпись — для чего
  формат) и `TextAction` «Закрыть». `downloadFile` вызывается синхронно в обработчике кнопки шита (web: `<a download>` до
  любого `await`), затем шит закрывается; шит монтируется только после монтирования экрана (`mounted`, не на SSR).
  Ошибка — прежний баннер под строкой с форматом. Три secondary-кнопки в строке действий — нет.
- **RC-9 (откат на `gpxAvailable`).** С `.default([])` клиент не отличит «старый API» от «экспорта нет», поэтому:
  `formats = exportFormats.length > 0 ? exportFormats : gpxAvailable ? ['gpx'] : []`. Сервер держит
  `gpxAvailable ⇔ 'gpx' ∈ exportFormats` (тест).
- **RC-10 (обобщение API без копипасты).** Не `@Get('routes/:id/:format')` (пересекается с `/map`, `/races`, лишний
  pipe) — три тонких метода `gpx`/`kml`/`tcx` с теми же декораторами и общий приватный `sendExport(reply, format, id)`
  (заголовки после чтения, как сейчас). Ключ IP-лимита — строка `'route-gpx'` без переименования (счётчики не
  сбрасываются; один бюджет на три формата), поле политики — `exportIpLimit` (или прежнее `gpxIpLimit` с уточнённым
  комментарием). `gpxFileName`/`gpxContentDisposition` → `routeFileName(title)` / `routeContentDisposition(title,
  extension)` (ASCII-fallback `pokatim-route.<ext>`); MIME — таблица `ROUTE_EXPORT_CONTENT_TYPES` в `routes.policy.ts`
  (`application/gpx+xml`, `application/vnd.google-earth.kml+xml`, `application/vnd.garmin.tcx+xml`, все
  `; charset=utf-8`).
- **RC-11 (TCX: порядок элементов XSD).** `Course`: `Name`, `Lap`, `Track`; `Lap` (CourseLap_t): `TotalTimeSeconds`,
  `DistanceMeters`, `BeginPosition`, `BeginAltitudeMeters?`, `EndPosition`, `EndAltitudeMeters?`, `Intensity`;
  `Trackpoint`: `Time`, `Position`(`LatitudeDegrees`, `LongitudeDegrees`), `AltitudeMeters?`, `DistanceMeters`.
  Пространство имён `http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2`; `Time` — `YYYY-MM-DDTHH:MM:SSZ`.
  `DistanceMeters` — гаверсинус по точкам экспорта (линия сверки): отличается от `distanceM` карточки (полные точки)
  на доли процента — допустимо, фиксируется в `routes.md`.
- **RC-12 (типы пакета).** `parseTcx` возвращает `{ points }`, как `parseKml`; `TrackFormat`/`TRACK_FORMATS` и
  `detectTrackFormat` не меняются (TCX заездов — вне scope, ADR-0011). `kmz.ts`, `tcx.ts`, `route-kml.ts`, `route-tcx.ts`
  не экспортируются из `index.ts` (лёгкий вход Expo: `node:zlib` и `fast-xml-parser` туда нельзя); `format.ts` с
  сигнатурой zip остаётся чистым.
- **RC-13 (бэкфилл версии 2 — проверено, ок).** `pendingDerived(2)` выберет все геометрии с `derivedVersion < 2`
  (индекс `route_geometries_derived_idx`), пачки по 20, ≤ 10 пачек на задачу, при старте worker и каждые 10 мин;
  `recordDerived` перезапишет профиль (те же значения) и экспорт целиком (`replaceOne` с `gpx`, `kml`, `tcx`).
  Маршруты с `derivedFailure.version = 1` будут повторены на версии 2 — ожидаемо. Откат кода: старый worker пишет
  версию 1 без kml/tcx, `pendingDerived(1)` версию 2 не трогает, старое API читает только `gpx` — безопасно; новый
  код после повторного выката догонит версию 1. Карточка до прохода регламента — только GPX (RC-2 (a)).
- **RC-14 (тесты, меняющиеся осознанно, — не все названы в spec).** `routes-mine.int.test.ts`: «KMZ, FIT, TCX, XXE —
  415» (минимальный TCX и `route.kmz` теперь 202 → `failed`: `no_track`/`unreadable`) и «слот освобождается после 413 и
  415» (`route.kmz` → FIT); `format.test.ts` (KMZ, `<TrainingCenterDatabase>` → не `null`; `precheckRouteFile` `.kmz`/
  `.tcx` → `ok`); `analyze-route.test.ts` (`route.kmz` → `unreadable` остаётся, но теперь через zip-разбор);
  `contracts route.schema.test.ts` (`ROUTE_FILE_EXTENSIONS`); app `my-routes.test.tsx` (`route.kmz` больше не
  отказ pre-check — заменить на `.zip`/`.fit`), `my-route-format.test.ts`, `route-detail.test.tsx`; admin
  `RoutesScreen.test.tsx`, `RaceEditor.corridor.test.tsx` (`accept`, подсказка, текст 415); `routes-public.int.test.ts`
  (`DETAIL_KEYS` += `exportFormats`; отрицательные N1 по суффиксам `['', '/map', '/gpx']` += `/kml`, `/tcx`);
  `routes-admin.int.test.ts:131` (`sizeBytes`); e2e `apps/app/e2e/web.spec.ts` («Скачать GPX» → «Скачать» + шит).
- **RC-15 (генератор фикстур).** `generate-fixtures.ts` перезаписывает `expected.json` целиком, `generate-kml-fixtures.ts`
  читает и дописывает. Новые фикстуры TCX/KMZ — в генераторе, который читает и дописывает (`generate-kml-fixtures.ts`
  или новый `generate-route-format-fixtures.ts`, запуск — после двух прежних, порядок — в шапке). Фикстуры
  синтетические в раскладке экспортёров (Garmin Connect course, Garmin activity, Google Earth KMZ: `doc.kml` +
  `files/icon.png`, deflate, флаг 3 с нулевыми размерами в локальном заголовке), без ПДн; эталоны — независимо от
  пакета; zip в генераторе собирается `deflateRawSync` + `crc32` (не кодом пакета).
- **RC-16 (документы-правила с перечнем форматов).** Помимо `routes.md`: `.claude/rules/pokatim-security.md` (frontmatter
  `packages/tracks/src/{gpx,kml,xml,format}.ts` += `tcx`, `kmz`; строки 84, 200, 223–229, 242), `pokatim-backend.md`
  (52–54, 68–69), `pokatim-app.md` (25, 413–415), `pokatim-db.md` (219–221: `route_exports` += `kml`, `tcx`),
  `pokatim-contracts.md` (40: `ROUTE_FILE_EXTENSIONS`; `exportFormats`), `docs/product/admin-panel.md:92`,
  `docs/product/races-and-seasons.md:34`. ADR-0011 «TCX не поддерживается» — про заезды, не меняется.

## 8.2 Deviations from spec

- §3/§8 «24 км/ч — скорость „В пути“ карточки» → константа `ROUTE_TCX_PACE_KMH = 24` пакета `tracks`, «условная
  скорость синтетического времени» (RC-1).
- AC8 «`exportFormats` по наличию полей экспорта» → по `derivedVersion` геометрии (`routeExportFormats`), эквивалентно
  по инварианту одной транзакции; эндпоинты `kml`/`tcx` — 404 по отсутствию поля (RC-2).
- `exportFormats` в контракте — массив строк с отбрасыванием незнакомых, не строгий `z.enum` (RC-3).
- Предел распакованного KML — 16 МиБ, не 32 (RC-4).
- `RouteExportDoc.sizeBytes` — сумма трёх файлов (RC-7).

## 8.3 Security checklist

Затронуто: входные файлы (zip-бомба, XXE/DTD в TCX и KML внутри KMZ, предел точек и элементов, обход путей zip — не
применимо: на диск не пишем), данные наружу (экспорт — только числа, без строк исходника), злоупотребления (IP-лимит
скачивания общий на форматы). AuthZ эндпоинтов — как у GPX (публичный каталог).

## 9. Acceptance Criteria

1. `detectRouteFormat`: GPX, KML, KMZ (`PK\x03\x04`), TCX (`<TrainingCenterDatabase`, с декларацией/BOM/комментариями) —
   распознаются; FIT, `<!DOCTYPE` перед корнем, мусор — `null`.
2. TCX курса и активности (реальные фикстуры) → маршрут: длина/высоты как у эталона в `expected.json`; несколько
   `Track` склеиваются по порядку; точки без `Position` пропускаются; TCX без точек — `no_track`; DTD/сущности —
   `unreadable`; точек > предела — `too_many_points` до разбора.
3. KMZ Google Earth → тот же результат, что его `doc.kml`; без `doc.kml` — первый `.kml` в корне; без KML, битый zip,
   шифрование, неизвестный метод, zip-бомба — `unreadable`; KML внутри с DTD — `unreadable`.
4. `analyzeRoute`/`deriveRoute` возвращают `gpx`, `kml`, `tcx` из одних точек; `ROUTE_DERIVED_VERSION = 2`.
5. `routeKml`/`routeTcx`: валидный XML (разбирается обратно нашими `parseKml`/`parseTcx` в те же точки с точностью
   округления), без строк исходника; TCX — `Time` монотонно растёт, `DistanceMeters` накопленная, `Lap` с итогами.
6. API: загрузка KMZ и TCX (`POST /v1/routes/mine`, `POST /v1/admin/routes`) — 202 и `ready` после worker; FIT — 415.
7. `GET /v1/routes/:id/kml` и `/tcx`: 200 с нужным `Content-Type` и `Content-Disposition` (`<название>.kml|.tcx`),
   кэш как у GPX; маршрута нет в каталоге — 404; экспорт версии 1 без поля формата — 404 для kml/tcx, GPX — 200;
   IP-лимит общий с GPX.
8. Карточка: `exportFormats` по наличию полей экспорта; `gpxAvailable` прежний; контракт принимает ответ без
   `exportFormats` (дефолт `[]`).
9. Регламент `routes-maintenance` пересчитывает маршруты версии 1 → kml/tcx появляются.
10. Приложение: «Скачать» с выбором доступных форматов; без `exportFormats` — прежняя «Скачать GPX»; выбор файла
    «Моих маршрутов» и панель принимают `.kmz`/`.tcx`; тексты подсказок и ошибок с новыми форматами.
11. `pnpm check` зелёный; `docs/product/routes.md` обновлён.

## 10. Documentation Impact

`docs/product/routes.md`: «Форматы (M2)», «Действия (P5)», таблица «позже» (убрать KMZ/TCX/экспорт KML/TCX, оставить
FIT-курс, ссылки, отправку). ADR не нужен (расширение существующего решения routes-02/03).

## 11. Implementation Context (заполняет architect)

**ENTRY POINTS**

- `packages/tracks/src/parse.ts` — `loadRoutePoints` (единственная развилка форматов), `analyzeRoute`, `deriveRoute`,
  `ROUTE_DERIVED_VERSION = 2`, `RouteDerived { profile, gpx, kml, tcx }`.
- `apps/api/src/modules/routes/routes.service.ts` — `accept` (415 только при `detectRouteFormat === null`).
- `apps/api/src/modules/routes/routes-public.controller.ts` — `GET routes/:id/{gpx,kml,tcx}`.
- `apps/app/src/features/routes/route-detail.tsx` — `RouteActions`.

**FILES TO MODIFY**

- `packages/tracks/src/format.ts` — `RouteFileFormat = 'gpx'|'kml'|'kmz'|'tcx'`; `detectRouteFormat`: zip
  `50 4B 03 04` → `kmz`, `xmlRootAfterProlog(bytes, 'TrainingCenterDatabase')` → `tcx`; `detectTrackFormat` — без
  изменений.
- `packages/tracks/src/track.ts` — `ROUTE_FILE_EXTENSIONS = ['gpx','kml','kmz','tcx']` (в конец).
- `packages/tracks/src/precheck.ts` — только комментарий.
- новый `packages/tracks/src/tcx.ts` — `parseTcx(text, { maxPoints }) → { points }` (`assertNoForbiddenMarkup`,
  `assertElementCount`, `countTags(text,'Trackpoint') > maxPoints` → `too_many_points`, `parseValidXml`,
  `removeNSPrefix`, `isArray` для `Activity`/`Lap`/`Course`/`Track`/`Trackpoint`; все `Track` в порядке документа;
  без `Position` — пропуск; `AltitudeMeters` → `ele`).
- новый `packages/tracks/src/kmz.ts` — `kmlFromKmz(bytes, maxBytes) → Uint8Array` (EOCD → central directory → выбор
  записи → `inflateRawSync(..., { maxOutputLength })`/stored → CRC), ошибки → `TrackParseError('unreadable')` (RC-5).
- новые `packages/tracks/src/route-kml.ts` (`routeKml(points)`) и `route-tcx.ts` (`routeTcx(points)`,
  `ROUTE_TCX_PACE_KMH`, `ROUTE_TCX_START = '2000-01-01T00:00:00Z'`, имя курса `Pokatim`) — рядом с `route-gpx.ts`, только
  числа.
- `packages/tracks/src/parse.ts` — `loadRoutePoints`: `kmz` → `kmlFromKmz` → `detectRouteFormat(inner)==='kml'` →
  `parseKml`; `tcx` → `parseTcx`; `analyzeRoute`/`deriveRoute` — `gpx`, `kml`, `tcx` из одного `matchPointsOf(points)`;
  экспорт `parseTcx`, `routeKml`, `routeTcx` (для тестов API); `ROUTE_KMZ_MAX_KML_BYTES`.
- `packages/tracks/package.json` — `description` (форматы), зависимостей не добавлять.
- `packages/tracks/scripts/generate-kml-fixtures.ts` (или новый `generate-route-format-fixtures.ts`, см. RC-15);
  `src/__fixtures__/` — новые файлы + ключи `expected.json`; `route.kmz` остаётся (битый zip без central directory).
- `packages/contracts/src/routes/route.schema.ts` — `ROUTE_FILE_EXTENSIONS`, комментарии `UploadRouteQuery`.
- `packages/contracts/src/routes/route-catalog.schema.ts` — `ROUTE_EXPORT_FORMATS`, `RouteExportFormat`,
  `CatalogRouteDetail.exportFormats` (RC-3); экспорт из индекса пакета, если индекс перечисляет имена.
- `packages/contracts/src/common.ts` — комментарий `ROUTE_FORMAT_UNSUPPORTED`.
- `apps/api/src/modules/routes/routes.collection.ts` — `RouteExportDoc { gpx: Binary; kml?: Binary; tcx?: Binary;
  sizeBytes; derivedVersion }` (необязательны — документы версии 1), комментарий `ROUTES_COLLECTIONS.exports`.
- `apps/api/src/modules/routes/routes.repository.ts` — тип `RouteExportFiles { gpx; kml; tcx: Uint8Array }`;
  `markReady`/`recordDerived`/`writeExport` принимают его (одна транзакция, `replaceOne`); `exportGpx` →
  `exportFile(id, format)` (проекция `{ [format]: 1 }`, нет документа или поля — `undefined`); комментарий инварианта.
- `apps/api/src/modules/routes/route-processing.processor.ts`, `route-derived.ts` — кодирование трёх строк
  (`TextEncoder`) и передача `RouteExportFiles`.
- `apps/api/src/modules/routes/routes.policy.ts` — `routeFileName`, `routeContentDisposition(title, ext)`,
  `ROUTE_EXPORT_CONTENT_TYPES`, `routeExportFormats(derivedVersion)`, поле лимита (RC-10); ключ `'route-gpx'` прежний.
- `apps/api/src/modules/routes/routes-public.service.ts` — `toCatalogDetail` += `exportFormats`; `gpx(id)` →
  `exportFile(id, format)` (`findInCatalog` → `exportFile` → 404).
- `apps/api/src/modules/routes/routes-public.controller.ts` — три метода + приватный `sendExport`.
- `apps/api/src/modules/routes/routes.service.ts` — комментарий 415 (KMZ и TCX принимаются).
- `apps/api/src/public-read.guard.ts` — комментарий `route-gpx` (общий бюджет экспорта).
- `packages/api-client/src/index.ts` — `catalogRouteExportUrl(id, format)`; `catalogRouteGpxUrl` — через него (не
  удалять: тесты и единственный потребитель переводятся, но совместимость дешёвая).
- `apps/app/src/features/routes/route-detail.tsx` — `RouteActions` (RC-8, RC-9); новый
  `apps/app/src/features/routes/route-download-sheet.tsx` (`ModalSheet` + кнопки форматов); при необходимости чистая
  функция `availableExportFormats(route)` в `features/routes/format.ts`.
- `apps/app/src/features/routes/use-my-route-upload.ts`, `features/devices/pick-track-file.web.ts` — только
  комментарии (фильтр web строится из `ROUTE_FILE_EXTENSIONS`, native — `*/*`).
- `apps/admin/src/features/routes/route-upload.tsx` (`ROUTE_FILE_ACCEPT` строится из контракта — меняется сам),
  `apps/admin/src/ui/FileButton.tsx`, `apps/admin/src/features/races/CorridorField.tsx`,
  `apps/admin/src/features/routes/RoutesScreen.tsx` — комментарии.
- `packages/i18n/src/ru.ts` — `admin.races.corridor.hint`, `admin.routes.error.ROUTE_FORMAT_UNSUPPORTED`
  («Выберите файл GPX, KML, KMZ или TCX»), `routes.mine.emptyHint` (+ Google Earth, Garmin), `routes.mine.error.
  ROUTE_FORMAT_UNSUPPORTED`, `routes.mine.precheck.extension`, `rides.routePick.mineEmptyHint`; карточка:
  `routes.detail.download` («Скачать»), `routes.detail.downloadTitle` («Скачать маршрут»), `routes.detail.format.
  {gpx,kml,tcx}` + подписи, `routes.detail.downloadClose`, `routes.detail.downloadFailed` («Не удалось открыть файл
  {format}.») вместо `gpxFailed`; `routes.detail.gpx` («Скачать GPX») остаётся для одного формата;
  `landing.routes.text` — по желанию.
- Документы — раздел 10 + RC-16.

**FILES TO READ**

- `packages/tracks/src/{kml,gpx,xml,route-gpx,route-profile,simplify,points}.ts`, `packages/tracks/src/analyze-route.test.ts`,
  `kml.test.ts`, `route-gpx.test.ts`, `format.test.ts`.
- `apps/api/src/parse-thread.ts` (+ `parse-thread.test.ts`), `apps/api/src/modules/routes/routes-maintenance.processor.ts`,
  `routes-derived.int.test.ts`, `routes-public.int.test.ts`, `routes-mine.int.test.ts`, `routes-admin.int.test.ts`.
- `apps/app/src/components/modal-sheet.tsx`, `apps/app/src/features/rides/ride-published-sheet.tsx`,
  `apps/app/src/lib/download-file(.web).ts`, `apps/app/src/__tests__/route-detail.test.tsx`.
- `packages/contracts/src/profile/profile.schema.ts` (`rideReasons` — образец отбрасывания кодов),
  `.claude/rules/pokatim-{security,backend,db,contracts,app,tests}.md`.

**TYPES & SCHEMAS**

- `RouteFileFormat = 'gpx' | 'kml' | 'kmz' | 'tcx'` (`@pokatim/tracks`); `ROUTE_FILE_EXTENSIONS` пакета = контракта.
- `RouteDerived { profile: [number, number][] | null; gpx: string; kml: string; tcx: string }`, `ROUTE_DERIVED_VERSION = 2`.
- `ROUTE_EXPORT_FORMATS = ['gpx','kml','tcx'] as const`, `RouteExportFormat`;
  `CatalogRouteDetail.exportFormats: RouteExportFormat[]` (неизвестные отброшены, `.default([])`); `gpxAvailable` — прежний.
- `RouteExportDoc { _id; gpx: Binary; kml?: Binary; tcx?: Binary; sizeBytes; derivedVersion }`.
- Ошибки — без новых кодов (`ROUTE_FORMAT_UNSUPPORTED` 415, `RouteFailureCode` прежние).

**TESTS**

- unit `packages/tracks`:
  - `format.test.ts` — KMZ (`PK\x03\x04`), TCX (BOM, декларация, комментарий), DOCTYPE перед `<TrainingCenterDatabase`
    → `null`, FIT/мусор → `null`; `precheckRouteFile` `.kmz`/`.TCX` → `ok`, `.fit`/`.zip` → `extension`.
  - новый `tcx.test.ts` — курс (Courses/Course/Track), активность (Lap/Track, несколько `Track`, точки без
    `Position`), без точек → `points: []` (`analyzeRoute` → `no_track`), DTD/сущности → `unreadable`, `Trackpoint` >
    предела → `too_many_points` до разбора (шпион/время, как у GPX), битая разметка → `unreadable`.
  - новый `kmz.test.ts` — Google Earth (`doc.kml` + картинка, deflate, флаг 3) = результат его `doc.kml`; без
    `doc.kml` → первый `.kml` в корне (KML в папке игнорируется); без KML, `route.kmz` (нет EOCD), шифрование,
    метод 12, zip64-маркер, битый CRC, zip-бомба (объявленный размер и ложный заголовок с реальной распаковкой >
    предела), KML внутри с DTD/DOCTYPE → `unreadable`.
  - новые `route-kml.test.ts`, `route-tcx.test.ts` — обратный разбор `parseKml`/`parseTcx` в те же точки (6/1 знак),
    точки без высоты, нет строк исходника; TCX: `Time` монотонно растёт от `2000-01-01T00:00:00Z`, `DistanceMeters`
    накопленная, итоги `Lap`, `Name = Pokatim`, порядок элементов XSD (RC-11); размер на 20 000 точек < 5 МБ.
  - `analyze-route.test.ts` — TCX/KMZ фикстуры против `expected.json`; `deriveRoute` возвращает `gpx`, `kml`, `tcx`
    из одних точек; `ROUTE_DERIVED_VERSION === 2`; `structuredClone`.
- unit `packages/contracts` — `route.schema.test.ts` (расширения), `route-catalog.schema.test.ts` (`exportFormats`:
  дефолт `[]`, незнакомое отброшено). `packages/api-client/src/routes.test.ts` — `catalogRouteExportUrl`.
- unit `apps/api` — `routes.policy.test.ts` (`routeFileName`, `routeContentDisposition` для трёх расширений,
  `routeExportFormats`); `parse-thread.test.ts` — KMZ и TCX через поток.
- int (реальная MongoDB/Redis) `apps/api`:
  - `routes-mine.int.test.ts`, `routes-admin.int.test.ts` — KMZ и TCX: 202 → `ready` после worker; zip без KML →
    202 → `failed/unreadable`; FIT, PNG — 415; переделка тестов из RC-14; экспорт содержит `gpx`, `kml`, `tcx`.
  - `routes-public.int.test.ts` — `/kml`, `/tcx`: 200, `Content-Type`, `Content-Disposition` (bidi-название), CSP,
    `nosniff`, кэш; не в каталоге / маршрут райдера без одобрения — 404 (N1 по суффиксам); экспорт версии 1 без полей
    — `/kml`, `/tcx` 404, `/gpx` 200, `exportFormats: ['gpx']`; общий IP-лимит (GPX+KML+TCX вместе исчерпывают
    один бюджет); `DETAIL_KEYS`.
  - `routes-derived.int.test.ts` — геометрия версии 1 + экспорт только `gpx` → прогон регламента → версия 2,
    `kml`/`tcx` появились, профиль прежний; повторный прогон — no-op.
- unit/RTL `apps/app` — `route-detail.test.tsx`: один формат — «Скачать GPX» без шита; три — «Скачать» → шит → нажатие
  формата → `downloadFile(url формата)` синхронно, шит закрыт; отказ — баннер с форматом; старый ответ без
  `exportFormats` — по `gpxAvailable`; `my-routes.test.tsx`, `my-route-format.test.ts` — тексты.
- unit `apps/admin` — `RoutesScreen.test.tsx`, `RaceEditor.corridor.test.tsx`: `accept = '.gpx,.kml,.kmz,.tcx'`, тексты.
- e2e `apps/app/e2e/web.spec.ts` (routes-01…03): «Поделиться» и «Скачать» в одном ряду; «Скачать» → шит → KML и TCX
  скачиваются (`suggestedFilename` `.kml`/`.tcx`); `GET /kml`, `/tcx` — 200, `attachment`, нет `<name>Покат`/строк
  исходника. Admin e2e — без изменений (GPX).

**OUT OF SCOPE**

- FIT-курс, импорт по ссылке, отправка в Garmin/Komoot; экспорт «Моих маршрутов» и панели; TCX заездов
  (`TRACK_FILE_EXTENSIONS`, `detectTrackFormat`, `TrackFormat`); хранение экспорта gzip (RC-7 (b) — follow-up);
  миграция БД; новые зависимости (zip-библиотека); изменения `CORRIDOR_ENGINE_VERSION`, golden коридора/simplify,
  `elevationProfile`; переименование ключа IP-лимита.

## 12. Outcome (заполняет coder)

### Changes

- `packages/tracks`: `detectRouteFormat` → `'gpx' | 'kml' | 'kmz' | 'tcx'` (zip `PK\x03\x04` → `kmz`, корень
  `<TrainingCenterDatabase` → `tcx`); `ROUTE_FILE_EXTENSIONS` += `kmz`, `tcx`. Новые: `tcx.ts` (`parseTcx`: Activities →
  Courses, все `Track` по порядку, без `Position` — пропуск, предел `Trackpoint` подсчётом до разбора, общие защиты
  `xml.ts`), `kmz.ts` (`kmlFromKmz`: EOCD → central directory → `doc.kml`/первый `.kml` в корне; stored/deflate
  `inflateRawSync` + `maxOutputLength`, CRC-32 `zlib.crc32`; шифрование, zip64, многотомность, > 1000 записей, другой
  метод, объявленный/фактический размер > `ROUTE_KMZ_MAX_KML_BYTES` = 16 МиБ, выход за границы — `unreadable`),
  `route-kml.ts` (`routeKml`), `route-tcx.ts` (`routeTcx`, `ROUTE_TCX_PACE_KMH = 24`, `ROUTE_TCX_START`, `Name` =
  `Pokatim`, порядок XSD, время строго растёт). `parse.ts`: `loadRoutePoints` — KMZ → KML (повторная проверка сигнатуры
  KML) и TCX; `analyzeRoute`/`deriveRoute` возвращают `gpx`, `kml`, `tcx` из одних точек линии сверки;
  `ROUTE_DERIVED_VERSION = 2`. Новые модули не экспортируются из лёгкого `index.ts`.
- `packages/contracts`: `ROUTE_FILE_EXTENSIONS` += `kmz`, `tcx`; `ROUTE_EXPORT_FORMATS`, `RouteExportFormat`;
  `CatalogRouteDetail.exportFormats` — массив строк с отбрасыванием незнакомых кодов, `.default([])` (RC-3).
- `packages/api-client`: `catalogRouteExportUrl(id, format)`; `catalogRouteGpxUrl` оставлен.
- `apps/api`: `RouteExportDoc` += `kml?`, `tcx?`, `sizeBytes` — сумма; `RouteExportFiles`; `markReady`/`recordDerived`/
  `writeExport` пишут три файла одной транзакцией; `exportGpx` → `exportFile(id, format)` (проекция поля, нет поля —
  404); `exportFilesOf` (кодирование строк) — общий для разбора и бэкфилла; `routes.policy`: `routeFileName`,
  `routeContentDisposition(title, ext)`, `ROUTE_EXPORT_CONTENT_TYPES`, `routeExportFormats(derivedVersion)` (RC-2),
  `exportIpLimit` (ключ `route-gpx` прежний — общий бюджет); контроллер — `gpx`/`kml`/`tcx` + приватный `sendExport`
  (RC-10); карточка — `exportFormats`; `accept` — KMZ (любой zip) и TCX принимаются, FIT — 415. Миграции нет.
- `apps/app`: `availableExportFormats` (RC-9); `RouteActions`: только GPX — прежняя «Скачать GPX», несколько — «Скачать»
  → новый `RouteDownloadSheet` (`ModalSheet`, кнопка на формат с подписью, «Закрыть»; `downloadFile` синхронно в
  обработчике, шит закрывается; монтируется после `mounted`); баннер «Не удалось открыть файл {format}.».
- `apps/admin`: `accept` строится из контракта (`.gpx,.kml,.kmz,.tcx`), комментарии; i18n — подсказки и тексты 415/
  pre-check с KMZ и TCX, ключи шита скачивания; `routes.detail.gpxFailed` → `routes.detail.downloadFailed`.
- Фикстуры — новый генератор `packages/tracks/scripts/generate-route-format-fixtures.ts` (читает и дописывает
  `expected.json`: 4 новых ключа, прежние значения не тронуты; zip — `deflateRawSync` + `crc32`, флаг 3, extra только
  в локальном заголовке). Эталонный `doc.kml` архива Google Earth — `__fixtures__/route-earth-kmz/doc.kml` (подпапка:
  golden `simplify` обходит только корень `__fixtures__` и `corridor/`, golden не перезаписывался).

- **Ревью pass 1 (findings-codex-1, findings-claude-1):** (1) `findEocd` принимает подпись EOCD, только если
  `offset + 22 + commentLength = length`, иначе ищет дальше; (2) `routeKml`: у всех точек есть высота —
  `<altitudeMode>absolute</altitudeMode>`, хотя бы у одной нет — режима нет (`clampToGround`: `absolute` поставил бы
  точки без высоты на 0 м), высоты в кортежах остаются; (3) `ROUTE_XML_MAX_ELEMENTS = ROUTE_MAX_POINTS × 20 = 1 млн`
  (`xml.ts`; самая тяжёлая законная точка — `Trackpoint` активности TCX, 13 элементов: 50 000 × 13 ≈ 650 000, запас
  ×1,5) — `parseKml` (в т. ч. KML из KMZ), `parseTcx` и `parseGpx` маршрута (`maxElements` из `loadRoutePoints`); предел
  треков (4 млн) не меняется; (4) фикстура `route-bomb-lying.kmz` — объявленный размер ровно 16 МиБ (проходит проверку
  объявленного), реальный поток 17 МиБ: тест шпионит за `inflateRawSync` и доказывает отказ `ERR_BUFFER_TOO_LARGE` по
  `maxOutputLength`; (5) подпись формата в шите связана с кнопкой группой `role="group"` + `aria-label` «формат: для
  чего» (у `Button` UI-кита нет `accessibilityHint` и он не пробрасывает пропсы); `routes.md` — TCX-тренировка длиннее
  ~4 ч может не влезть в 5 МБ, предел 1 млн элементов, режим высоты KML. Новая фикстура генератором —
  `route-many-elements.kmz` (1,1 млн пустых элементов, ≈ 4 КиБ архив).

### Files touched

- `packages/tracks/src/{format,track,precheck,parse}.ts`, новые `tcx.ts`, `kmz.ts`, `route-kml.ts`, `route-tcx.ts` и их
  тесты; `format.test.ts`, `analyze-route.test.ts`; `package.json` (description); `scripts/generate-route-format-fixtures.ts`;
  `src/__fixtures__/`: `route-garmin-course.tcx`, `route-garmin-activity.tcx`, `route-no-points.tcx`, `route-dtd.tcx`,
  `route-earth.kmz`, `route-earth-kmz/doc.kml`, `route-no-doc.kmz`, `route-no-kml.kmz`, `route-encrypted.kmz`,
  `route-method12.kmz`, `route-zip64.kmz`, `route-bad-crc.kmz`, `route-dtd-inside.kmz`, `route-bomb.kmz`,
  `route-bomb-lying.kmz`, `expected.json` (дописан).
- `packages/contracts/src/{common.ts,routes/route.schema.ts,routes/route-catalog.schema.ts}` + тесты.
- `packages/api-client/src/{index.ts,routes.test.ts}`; `packages/i18n/src/ru.ts`.
- `apps/api/src/modules/routes/{routes.collection,routes.repository,route-processing.processor,route-derived,
  routes.policy,routes-public.service,routes-public.controller,routes.service,my-routes.service}.ts`,
  `apps/api/src/public-read.guard.ts`; тесты `routes.policy.test.ts`, `parse-thread.test.ts`,
  `routes-{public,mine,admin,derived}.int.test.ts`.
- `apps/app/src/features/routes/{route-detail.tsx,route-download-sheet.tsx,format.ts,use-my-route-upload.ts}`,
  `features/devices/pick-track-file{,.web}.ts`; тесты `route-detail`, `my-routes`, `my-route-format`, `format`,
  фикстуры карточки в `ride-detail`, `route-report`, `route-rides-block`; `e2e/web.spec.ts`.
- `apps/admin/src/{ui/FileButton.tsx,features/routes/{route-upload,RoutesScreen}.tsx,features/races/CorridorField.tsx}`,
  тесты `RoutesScreen.test.tsx`, `RaceEditor.corridor.test.tsx`.

### Docs updated

- `docs/product/routes.md`: «Форматы (M2)» (KMZ, TCX), «Действия (P5)» (шит «Скачать», KML/TCX, условное время TCX,
  общий лимит), бэкфилл, таблица «не входит» (осталось: FIT-курс, ссылки, экспорт FIT/«Моих»/панели, отправка).
- `docs/product/admin-panel.md:92`, `docs/product/races-and-seasons.md:34` — форматы загрузки.

### Tests

- Добавлены: `tcx.test.ts`, `kmz.test.ts`, `route-kml.test.ts`, `route-tcx.test.ts` (обратный разбор, XSD-порядок, время,
  дистанция, 20 000 точек < 5 МБ); `format.test.ts`, `analyze-route.test.ts` (TCX/KMZ против `expected.json`, KMZ = его
  `doc.kml`, отказы, `ROUTE_DERIVED_VERSION = 2`, `deriveRoute` ≡ четыре поля); контракты (`exportFormats` дефолт и
  отбрасывание), api-client (`catalogRouteExportUrl`); `routes.policy.test.ts`, `parse-thread.test.ts` (KMZ/TCX/бомба в
  потоке); int: `routes-mine` (KMZ/TCX → ready, любой zip → 202 → `failed/unreadable`, TCX без точек → `no_track`, FIT/
  PNG/DTD → 415), `routes-admin` (KMZ/TCX → ready, `sizeBytes` — сумма), `routes-public` (`/kml`, `/tcx`: заголовки, bidi,
  404 версии 1 и N1 по суффиксам, общий IP-лимит, `DETAIL_KEYS`), `routes-derived` (версия 1 → 2: KML/TCX появились,
  профиль прежний, повтор no-op); app `route-detail` (один формат без шита, три — шит, синхронный `downloadFile`, отказ с
  форматом, старый ответ), `format.test.ts`; admin `accept`/тексты. Golden corridor/simplify/sensor-flags не менялись.
- `MONGO_URL_TEST='mongodb://127.0.0.1:27117/pokatim_routefmt_test?replicaSet=rs0&directConnection=true'
  REDIS_URL_TEST='redis://127.0.0.1:6479/4' TURBO_CONCURRENCY=1 pnpm check`: format, lint, arch (`✔ no dependency
  violations found (2197 modules, 8468 dependencies cruised)`), typecheck — зелёные; test — `Tasks: 14 successful, 15
  total`, `Failed: @pokatim/api#test`: `Test Files 3 failed | 201 passed (204)` — `identity-races`,
  `notifications-delivery`, `results-protocol` (таймауты 17–60 с под нагрузкой, вне scope). Повторный прогон этих трёх
  файлов отдельно: `Test Files 3 passed (3)`, `Tests 50 passed (50)`. Остальные пакеты: tracks 27/27 файлов, contracts
  50/50, api-client 22/22, admin 47/47, app `Tests: 2364 passed, 2364 total`.
- После фиксов ревью pass 1 (новые тесты: EOCD с `PK\x05\x06` в комментарии, `maxOutputLength` через шпион
  `inflateRawSync`, отказ по объявленному размеру без распаковки, `altitudeMode`, предел элементов маршрута для KML/GPX/
  TCX и KMZ `route-many-elements.kmz` → `too_many_points` без `XMLValidator`, группа подписи формата в шите — каждый
  сначала красный): prettier и eslint затронутого — чисто; `tsc --noEmit` — tracks, i18n, contracts, api-client, app,
  admin, api — ок. Тесты (`pokatim_routefmt_test`, redis db 4): tracks `Test Files 27 passed (27)`, `Tests 374 passed
  (374)`; i18n 2/2 (15); contracts 50/50 (443); api-client 22/22 (158); admin `Test Files 47 passed (47)`, `Tests 461
  passed (461)`; api `src/modules/routes` + `parse-thread.test.ts` — `Test Files 14 passed (14)`, `Tests 161 passed
  (161)`; app — первый прогон `Tests: 19 failed, 2345 passed` (3 файла, таймауты под нагрузкой), повтор целиком —
  `Tests: 2364 passed, 2364 total`. Полный `pnpm check` после фиксов не перезапускался.
- e2e (`apps/app/e2e/web.spec.ts`) — обновлён, NOT VERIFIED локально (стенд Playwright не поднимался).

### Open follow-ups

- ~~`.claude/rules/*`~~ — обновлены в этом PR по OK пользователя (RC-16): frontmatter `pokatim-security.md`
  (`packages/tracks/src/{gpx,kml,xml,format}.ts` += `tcx`, `kmz`) и строки RC-16 в `pokatim-security.md`,
  `pokatim-backend.md`, `pokatim-app.md`, `pokatim-db.md` (`route_exports` += `kml`, `tcx`), `pokatim-contracts.md`
  (`ROUTE_FILE_EXTENSIONS`, `exportFormats`).
- app-foundation: `accessibilityHint` (или `aria-describedby`) у `Button` `@rkarakulov/ui` — тогда подпись формата шита
  станет подсказкой кнопки вместо группы.
- RC-7 (b): хранение экспорта в gzip — при росте объёма `route_exports` (TCX ≈ 4,6 МБ на 20 000 точек).
- e2e `apps/app/e2e/web.spec.ts` обновлён, но локально не запускался (Playwright-стенд не поднимался).
- Тестовая БД: в инструкции `pokatim_routefmt` — test-kit требует `*_test`, прогон шёл на `pokatim_routefmt_test`.
