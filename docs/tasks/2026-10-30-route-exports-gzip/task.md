# task.md — route-exports-gzip: файлы экспорта маршрута в `route_exports` сжатыми gzip

## 1. Title

Хранить `route_exports.{gpx,kml,tcx}` сжатыми gzip (follow-up RC-7 (b) задачи `2026-10-30-routes-import-export-formats`).

## 2. Goal

Экспорт считается для всех готовых маршрутов (и личных, квота 100 на райдера), а TCX на 20 000 точек — до ~4,6 МБ,
документ целиком — до ~6,4 МБ. XML экспорта сжимается gzip в ×8–10: документ ≤ ~1 МБ, меньше объём БД, бэкапов и
трафика скачивания. Поведение для клиента не меняется: те же эндпоинты, те же байты файла после распаковки.

Задачу поставила родительская сессия (автономный режим); решения ниже — `[ASSUMPTION]` автора, без human gate:
продуктовое поведение не меняется.

## 3. Scope

- **Сжатие — в worker**, до транзакции: `exportFilesOf` (`route-derived.ts`) становится асинхронной и жмёт три
  строки `node:zlib` `gzip` (promisified, пул libuv — не блокирует event loop worker'а; уровень по умолчанию 6).
  Вызывающие — `RouteProcessingProcessor` (разбор) и `RouteDerivedBackfill` (бэкфилл). Транзакция не удлиняется:
  сжатие до `transactions.run`. API не жмёт (правило «разбора и сборки файлов в API нет» сохраняется).
- **Признак в документе**: `RouteExportDoc.encoding?: 'gzip'`. Новые записи (`writeExport`) — всегда `'gzip'`; нет
  поля — старый несжатый документ. `RouteExportFiles` — сжатые байты (тип переименовывается не нужно, меняется
  смысл и JSDoc).
- **Без роста `ROUTE_DERIVED_VERSION`**: это версия алгоритма производных (`@pokatim/tracks`), способ хранения —
  забота API. Старые несжатые документы читаются и отдаются как есть (ветка совместимости постоянная, ~3 строки);
  пережмутся при следующем росте версии (регламент `routes-maintenance` перезаписывает экспорт `replaceOne`).
  Принудительного прохода нет: прода нет, на dev объём мал.
- **`sizeBytes`** — сумма хранимых (сжатых) байт трёх файлов: диагностика объёма хранения. У старых документов —
  несжатая сумма, как было.
- **Отдача** (`routes-public.controller.ts` `sendExport`): репозиторий возвращает `{ bytes, gzip: boolean }`.
  - хранится gzip и клиент принимает gzip (`acceptsGzip(Accept-Encoding)`) → байты как есть +
    `Content-Encoding: gzip`;
  - хранится gzip, клиент не принимает → распаковка в API `gunzip` с `maxOutputLength`
    (`ROUTE_POLICY.exportMaxBytes`, 8 МиБ — больше максимума TCX ~4,6 МБ); распаковка — не разбор и не сборка;
  - несжатый (старый) → байты как есть, без `Content-Encoding`.
  - Всегда `Vary: Accept-Encoding` (ответ зависит от заголовка; `Cache-Control: public, max-age=60` уже есть).
- `acceptsGzip(header: string | undefined): boolean` — чистая функция в `routes.policy.ts`: токены через запятую,
  без учёта регистра; `gzip` или `x-gzip` или `*` с `q` > 0 → `true`; `gzip;q=0` → `false` даже при `*`; нет
  заголовка → `false` (RFC 9110 §12.5.3: нет заголовка — «любая», но безопаснее отдать несжатое).
- Повреждённый gzip в БД (сбой распаковки) → 500 через общий фильтр (не данные пользователя; лог — `routeId` и класс
  ошибки без текста).
- Правила: `.claude/rules/pokatim-db.md` (схема `route_exports`: `encoding?: 'gzip'`, `sizeBytes` — хранимые байты),
  `.claude/rules/pokatim-backend.md` (отдача: `Content-Encoding`/`Vary`, распаковка — не разбор).
- JSDoc `RouteExportDoc`, `writeExport`, `exportFile`.

## 4. Out of Scope

Рост `ROUTE_DERIVED_VERSION`, миграция/пережатие старых документов, глобальный `@fastify/compress`, brotli, сжатие
других коллекций, изменения клиентов (браузер и `fetch` распаковывают прозрачно; `catalogRouteGpxUrl` не меняется),
контракты `@pokatim/contracts`.

## 8. Risks / Assumptions

- `[ASSUMPTION]` Прокси dev (Caddy/nginx) не пережимает ответ с готовым `Content-Encoding` — штатное поведение обоих.
- Откат (ревью Claude pass 1, MEDIUM): worker и API — один образ; откат на релиз до этой задачи отдал бы gzip-байты
  без `Content-Encoding`, а записанные документы назад не разжимаются (пересчёт — только по росту версии). Двух
  релизов (сначала читатель) не делаем: прода нет; на dev окно `compose up` — секунды. Запрет отката — в
  `pokatim-db.md`.
- `fastify.inject` в int-тестах не распаковывает — тесты проверяют заголовок и `gunzipSync` тела.
- Размер: на 20 000 точек TCX — ожидание ×8+; int-тест (или unit на `exportFilesOf`) проверяет, что сжатое меньше
  исходного хотя бы ×4 на синтетике.

## 8.1 Requirements Consistency (заполняет architect)

Проверено кодом (PLAN, 2026-10-30). Блокеров нет; правки spec — RC-1…RC-6, остальное подтверждено.

- **RC-1 (прокси и глобальное сжатие) — конфликта нет, допущение §8 подтверждено.** В API нет `@fastify/compress` и
  сжатия ответов (`http-app.ts`, `configureHttpApp`). Прод: Caddy `encode zstd gzip` (`infra/Caddyfile`) — пропускает
  ответ с уже выставленным `Content-Encoding` и сам добавляет `Vary`; транспорт `reverse_proxy` (Go) при запросе
  клиента **без** `Accept-Encoding` сам шлёт апстриму `gzip` и прозрачно распаковывает ответ — клиент получит
  несжатый файл (поведение корректно, распаковка лишь переезжает в Caddy). Dev EC2: nginx `gzip on; gzip_proxied any`
  (`infra/deploy/bootstrap.sh`) — gzip-фильтр nginx не трогает ответ с `Content-Encoding`, а `gzip_types` наших
  XML-типов не содержит. Действий не нужно.
- **RC-2 (`Accept-Encoding` в контроллере) — правка spec.** `HttpAdapterHost` заголовков запроса не отдаёт
  (`getRequestHostname/Method/Url` только). Решение: параметр `@Headers('accept-encoding') acceptEncoding: string |
  undefined` (`@nestjs/common`, на Fastify работает: Nest читает `request.headers`; Node склеивает повторы заголовка
  через запятую — всегда `string`). `HttpAdapterHost` остаётся только для записи заголовков ответа.
- **RC-3 (где распаковка) — правка spec.** Spec кладёт ветвление и `gunzip` в `sendExport` контроллера. Контроллер в
  проекте тонкий (`pokatim-backend.md`); решение «отдать как есть / распаковать» и лог сбоя с `routeId` — в
  `RoutesPublicService.exportFile(id, format, acceptGzip)`, который возвращает `{ bytes, contentEncoding: 'gzip' |
  null, title }`. Контроллер: `acceptsGzip(header)` → сервис → заголовки (`Content-Encoding` только если не `null`,
  `Vary: Accept-Encoding` всегда на 200). Альтернатива (как в spec, всё в контроллере) — хуже: логика и логгер в
  HTTP-слое, unit-тест сложнее.
- **RC-4 (`ROUTE_POLICY.exportMaxBytes`) — правка spec: константы нет**, добавить в `routes.policy.ts`:
  `exportMaxBytes: 8 * 1024 * 1024` с JSDoc (предел распаковки при отдаче; TCX ≤ ~4,6 МБ). Превышение
  `maxOutputLength` (`RangeError` `ERR_BUFFER_TOO_LARGE`) и `Z_DATA_ERROR` — одна ветка: `logger.error(route <id>
  export <format> unreadable (<error.name>))` без текста и rethrow → 500 общим фильтром.
- **RC-5 (async `exportFilesOf` и транзакция) — уточнение spec, порядок не ломается при условии.** Сейчас
  `exportFilesOf(...)` вызывается **внутри** колбэка `transactions.run` (processor и backfill). Просто сделать её async
  и `await` в колбэке нельзя: сжатие удлинит транзакцию и повторится при ретрае `TransientTransactionError`. Обязательно:
  `const files = await exportFilesOf(...)` **до** `transactions.run`, в колбэк — готовый `files`. Processor: после
  `analyze` и проверки `outcome.ok`, до `const now`; сбой gzip → исключение → обычный ретрай BullMQ / на последней
  попытке `failed: unreadable` (существующий `catch` в `processRoute`). Backfill: после `outcome.ok`, сбой → `catch` в
  `run` → `skipped` (лог класса ошибки). Захват `claim` и `markReady`-условие `status: 'processing'` не меняются.
- **RC-6 (детерминизм gzip) — подтверждение, на нём держатся существующие тесты.** `routes-derived` «совпадает с
  разбором нового» и «версия 1 → 2» сравнивают документ экспорта `toEqual` после повторного расчёта: `zlib.gzip` Node
  детерминирован при тех же входе и уровне (mtime в заголовке = 0, один процесс/одна версия zlib). Уровень задаётся
  явно (`level: 6`, константа), чтобы смена дефолта не ломала сравнение.
- **Другие читатели `route_exports`** — только `RoutesRepository.exportFile` (каталог). `deleteOwn`/`RouteErasure`
  (`deleteOne` по `_id`), миграция `0022` (коллекция без индексов), `routeExportFormats` (по версии, без чтения) —
  от формата хранения не зависят. Шаринг (`routes-for-sharing`) экспорт не читает. Контракты не меняются.
- **Ветка совместимости и `ROUTE_DERIVED_VERSION`** — согласен с spec: без роста версии, старые документы без
  `encoding` отдаются как есть (AC4). Признак — на документе целиком (все три поля одной записи), не на поле.
- **Нет заголовка `Accept-Encoding` → несжатое** — согласен (за Caddy заголовок всегда есть, см. RC-1). Невалидный
  `q` (`q=abc`, `q=2`) — токен считается непринимающим (`false`), без исключений.
- Сжатие ≥ ×4 на синтетике 20 000 точек — unit на `exportFilesOf` (не int: тяжело для БД-стенда).

## 8.2 Decisions (coder)

- **D1 (порог сжатия в unit `exportFilesOf`).** Test matrix п. 2 требовал «≤ исходного / 4 для каждого файла». На
  синтетике 20 000 точек (извилистая линия с высотами): GPX ×6,6, TCX ×13,7, **KML ×3,0** — KML состоит только из
  чисел координат, ×3 — предел энтропии цифр, не дефект реализации (подгонять синтетику под порог — обман теста).
  Документ целиком: 6,77 МБ → 0,73 МБ (×9,3) — цель §2 («документ ≤ ~1 МБ», ×8–10) выполняется. Тест проверяет: GPX и
  TCX ≤ / 4, KML ≤ / 2,5, сумма трёх файлов ≤ / 8.

## 9. Acceptance Criteria

1. AC1 Новый маршрут (разбор) и бэкфилл пишут `route_exports` с `encoding: 'gzip'`; `gunzip` каждого поля = прежний
   XML; `sizeBytes` = сумма сжатых длин (int `routes-derived`, `routes-admin`/разбор).
2. AC2 `GET /v1/routes/:id/{gpx,kml,tcx}` с `Accept-Encoding: gzip` → 200, `Content-Encoding: gzip`,
   `Vary: Accept-Encoding`, тело распаковывается в файл; прочие заголовки (Content-Type, Disposition, CSP, nosniff)
   прежние (int `routes-public`).
3. AC3 Без `Accept-Encoding` (или `gzip;q=0`) → 200 без `Content-Encoding`, тело — несжатый файл (int).
4. AC4 Старый документ без `encoding` → 200, тело как есть, без `Content-Encoding` при любом `Accept-Encoding` (int).
5. AC5 404/429/400 — прежние JSON без файловых заголовков (существующие тесты зелёные).
6. AC6 `acceptsGzip` — unit-тест таблицей (`routes.policy.test.ts`).
7. AC7 `pnpm check` зелёный.

## 10. Documentation Impact

`.claude/rules/pokatim-db.md`, `.claude/rules/pokatim-backend.md`; `docs/tasks/2026-10-30-routes-import-export-formats/task.md`
RC-7 — отметка «(b) сделано в route-exports-gzip».

## 11. Implementation Context (заполняет architect)

Placement: только `apps/api/src/modules/routes` (worker-путь — `route-derived.ts`, `route-processing.processor.ts`;
API — `routes-public.*`; хранение — `routes.repository.ts`/`routes.collection.ts`). Новых пакетов, зависимостей,
миграций, очередей, событий outbox нет. Security-чеклист: краткий (данные наружу — те же байты; распаковка своих
данных с пределом `maxOutputLength`; лог без текста ошибки).

**ENTRY POINTS:** `RouteProcessingProcessor.analyzeAndRecord`, `RouteDerivedBackfill.deriveOne`,
`RoutesPublicController.{gpx,kml,tcx}` → `sendExport`.

**FILES TO MODIFY**

1. `routes.policy.ts`
   - `ROUTE_POLICY.exportMaxBytes: 8 * 1024 * 1024` (JSDoc: предел распаковки экспорта при отдаче, RC-4).
   - `export function acceptsGzip(header: string | undefined): boolean` — разбор `token[;q=…]` через запятую, trim,
     lower-case; q по умолчанию 1, невалидный q → 0; явный `gzip`/`x-gzip` решает по своему q (`gzip;q=0` → `false`
     даже при `*`); иначе — по `*`; нет заголовка/пусто → `false`.
2. `routes.collection.ts` — `RouteExportDoc.encoding?: 'gzip'` + JSDoc: поля `gpx/kml/tcx` — gzip при `encoding`,
   иначе (старые документы) — UTF-8 как есть; `sizeBytes` — сумма **хранимых** байт.
3. `routes.repository.ts`
   - `RouteExportFiles` — тип прежний, JSDoc «сжатые gzip байты файлов».
   - `writeExport` — добавить `encoding: 'gzip'` в документ; `sizeBytes` — как сейчас (сумма длин переданных, т.е.
     сжатых, байт). JSDoc.
   - `exportFile(id, format): Promise<StoredExportFile | undefined>`, где
     `export interface StoredExportFile { bytes: Uint8Array; gzip: boolean }`; проекция `{ [format]: 1, encoding: 1 }`;
     `gzip = doc.encoding === 'gzip'`.
4. `route-derived.ts`
   - `export async function exportFilesOf(derived: Pick<RouteDerived,'gpx'|'kml'|'tcx'>): Promise<RouteExportFiles>` —
     `promisify(gzip)` из `node:zlib`, три вызова `Promise.all`, `{ level: EXPORT_GZIP_LEVEL }` (константа `6` рядом,
     RC-6); результат `Buffer` → `Uint8Array` (Buffer и есть Uint8Array — копия не нужна).
   - `deriveOne`: `const files = await exportFilesOf(outcome.result);` до `transactions.run`; колбэк получает `files`.
5. `route-processing.processor.ts` — `const files = await exportFilesOf(analysis);` после проверки `outcome.ok`, до
   `transactions.run`; в `markReady` — `files` (RC-5). JSDoc класса: «экспорт сжат gzip до транзакции».
6. `routes-public.service.ts`
   - `CatalogRouteExport { bytes: Uint8Array; contentEncoding: 'gzip' | null; title: string }`.
   - `exportFile(id, format, acceptGzip: boolean)`: `published` → `repository.exportFile` → нет — 404; `!gzip` → как
     есть, `null`; `gzip && acceptGzip` → как есть, `'gzip'`; иначе `await gunzipAsync(bytes, { maxOutputLength:
     ROUTE_POLICY.exportMaxBytes })`, `null`. Ошибка распаковки → `Logger.error` (`routeId`, `format`, `error.name`)
     и rethrow (500).
7. `routes-public.controller.ts` — у `gpx/kml/tcx` параметр `@Headers('accept-encoding') acceptEncoding: string |
   undefined` (RC-2); `sendExport(reply, id, format, acceptEncoding)` → `routes.exportFile(id, format,
   acceptsGzip(acceptEncoding))`; после чтения — прежние 4 заголовка + `Vary: Accept-Encoding` + `Content-Encoding:
   gzip` если `contentEncoding`. JSDoc `sendExport`.

**FILES TO READ:** `routes-derived.int.test.ts` (хелперы `backfill`, `oldRoute`, `seedOld`), `routes-public.int.test.ts`
(`seedDerived`, `getRaw`), `routes-admin.int.test.ts:120-175`, `test/routes.ts`, `.claude/rules/pokatim-db.md:225-233`,
`.claude/rules/pokatim-backend.md:52-58`.

**TYPES & SCHEMAS:** `RouteExportDoc.encoding?: 'gzip'`, `StoredExportFile`, `CatalogRouteExport.contentEncoding`,
`ROUTE_POLICY.exportMaxBytes`. `@pokatim/contracts` — без изменений.

**TESTS (test matrix, порядок TDD)**

1. unit `routes.policy.test.ts` — `describe('acceptsGzip (route-exports-gzip, AC6)')`, `it.each` таблицей:
   `undefined`/`''` → false; `gzip`, `GZip`, `x-gzip`, `deflate, gzip`, `gzip;q=0.5`, `*`, `br;q=1, *;q=0.1` → true;
   `gzip;q=0`, `gzip;q=0.000`, `gzip;q=0, *`, `identity`, `br, deflate`, `*;q=0`, `gzip;q=abc` → false.
2. unit (новый) `route-derived.test.ts` — `describe('exportFilesOf (route-exports-gzip)')`:
   `it('gzip каждого файла: gunzipSync = исходный XML')`; `it('детерминирован: два вызова — одинаковые байты')`;
   `it('20 000 точек: сжатое ≤ исходного / 4 для каждого файла')` (строки — `routeGpx/routeKml/routeTcx` из
   `@pokatim/tracks/parse` на синтетике).
3. int `routes-admin.int.test.ts` (AC1, разбор) — в существующем тесте ready (стр. ~128): `encoding: 'gzip'`,
   `gpx = gunzipSync(exported.gpx.buffer).toString('utf8')`; `sizeBytes` = сумма сжатых длин (как сейчас) и
   `gunzip(kml/tcx)` разбираются. **Сломается без правки** — стр. 130 (`Buffer.from(gpx.buffer).toString`).
4. int `routes-derived.int.test.ts` (AC1, бэкфилл) — **сломаются без правки**: стр. 112-115 (`parseGpx` сырых байт) и
   стр. 140 (`text()` → через `gunzipSync`); в «версия 1 → 2» подготовка `replaceOne` версии 1 должна сохранить
   `encoding: exportBefore.encoding` (иначе документ «несжатый» с gzip-байтами); `toEqual(freshExport)` /
   `toEqual(exportBefore)` остаются (RC-6). Добавить проверку `encoding: 'gzip'` после бэкфилла.
5. int `routes-public.int.test.ts` — `seedDerived` получает опцию `{ gzip?: boolean }` (gzip → `gzipSync` полей +
   `encoding: 'gzip'`); текущие вызовы без опции = старые документы (AC4 бесплатно). `getRaw(url, ip, headers?)`.
   Новый `describe('route_exports gzip (route-exports-gzip)')`:
   - `it.each(['gpx','kml','tcx'])('%s: gzip в БД + Accept-Encoding: gzip → Content-Encoding: gzip, Vary, тело —
     gunzipSync = файл; Content-Type/Disposition/CSP/nosniff/Cache-Control прежние')` (AC2; `rawPayload`);
   - `it('gzip в БД, без Accept-Encoding / gzip;q=0 / identity → без Content-Encoding, тело — несжатый файл, Vary
     есть')` (AC3);
   - `it('старый документ без encoding: Accept-Encoding: gzip → тело как есть, без Content-Encoding')` (AC4);
   - `it('повреждённый gzip в БД → 500 JSON без Content-Disposition')` (RC-4);
   - `it('новый маршрут после разбора: /gpx с gzip и без — один и тот же XML')` (сквозной, через `readyRoute`).
   404/429/400 — существующие тесты без изменений (AC5); тест стр. 452 (разбор → `/gpx` без заголовка) остаётся
   зелёным через распаковку.
6. `routes-mine.int.test.ts:136` (`byteLength > 0`), `routes-admin.int.test.ts:173` (`toEqual([exported])`),
   `routes-mine.int.test.ts:370` (вставка без `encoding`) — без правок.

Порядок: 1 → policy; 2 → `exportFilesOf`; 3–4 → repository/processor/backfill; 5 → service/controller; затем
правила и JSDoc, `pnpm check` (AC7).

**OUT OF SCOPE:** как §4; плюс `routes-for-sharing`, `RouteErasure`/`deleteOwn`, миграции, `infra/*`, клиенты.

**Documentation Impact (уточнение §10):** `.claude/rules/pokatim-db.md:225-226` — схема с `encoding?: 'gzip'`,
`sizeBytes` — хранимые байты, сжатие в worker до транзакции; `.claude/rules/pokatim-backend.md:52-58` — отдача:
`Content-Encoding: gzip` по `Accept-Encoding`, иначе распаковка ≤ `exportMaxBytes` (не разбор), `Vary`, старые
несжатые — как есть; `@Headers('accept-encoding')`. RC-7 предыдущей задачи — отметка «(b) сделано».

## 12. Outcome (заполняет coder)

Сделано по §3 с правками 8.1 (RC-2…RC-6), отклонение — 8.2 D1.

- **Worker:** `exportFilesOf` (`route-derived.ts`) — async, `promisify(gzip)` уровня `EXPORT_GZIP_LEVEL = 6` для трёх
  строк параллельно; processor и бэкфилл сжимают **до** `transactions.run` (RC-5), в колбэк — готовые `files`.
- **Хранение:** `RouteExportDoc.encoding?: 'gzip'`; `writeExport` пишет `encoding: 'gzip'`, `sizeBytes` — сумма сжатых
  байт; `RoutesRepository.exportFile` → `StoredExportFile { bytes, gzip }` (проекция поля формата и `encoding`).
- **Отдача:** `acceptsGzip` и `ROUTE_POLICY.exportMaxBytes` (8 МиБ) — `routes.policy.ts`;
  `RoutesPublicService.exportFile(id, format, acceptGzip)` → `{ bytes, contentEncoding, title }` (gzip как есть /
  `gunzip` с `maxOutputLength` / старый как есть; сбой — `logger.error` с `routeId`, форматом и классом ошибки,
  rethrow → 500); контроллер — `@Headers('accept-encoding')`, `Vary: Accept-Encoding` всегда на 200,
  `Content-Encoding: gzip` по сервису.
- **Тесты:** unit `acceptsGzip` (16 строк таблицы, AC6), unit `route-derived.test.ts` (gunzip = XML, детерминизм,
  сжатие на 20 000 точек); int `routes-admin` (разбор: `encoding`, gunzip, `sizeBytes`), `routes-derived` (бэкфилл,
  версия 1 → 2 с сохранением `encoding`, рост версии), `routes-public` — новый `describe('route_exports gzip')`: AC2 по
  трём форматам, AC3 (нет заголовка / `gzip;q=0` / `identity`), AC4 (старый документ), повреждённый gzip → 500 JSON,
  сквозной после разбора. 404/429/400 — прежние тесты зелёные (AC5).
- **Правила:** `pokatim-db.md` (схема `route_exports`), `pokatim-backend.md` (отдача), `pokatim-security.md` (экспорт
  каталога); RC-7 задачи `routes-import-export-formats` — отметка «(b) — сделано».
- **Проверки:** int-тесты routes (4 файла, 83 теста) и `pnpm check` — зелёные на изолированном стенде (свой mongod
  replica set `:27217`, БД `pokatim_gzip_test`, Redis db 11).
