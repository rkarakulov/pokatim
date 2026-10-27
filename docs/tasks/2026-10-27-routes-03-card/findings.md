# Findings — routes-03-card — pass 1 — reviewer: claude
base: origin/develop   commits: bf5df5f..a0763b3 (bf5df5f + merge develop), working tree clean
verdict: APPROVE

Проверено вручную: diff целиком (api, tracks, contracts, api-client, app, i18n, rules/docs), вызовы `geometry()`/
`markReady`/`runParseThread`, дедупликация jobId в BullMQ 6.4.0 (`addStandardJob-9.js`), семантика отказов потока
(`parse-thread.ts`). Запущено: tracks `route-profile|route-gpx|analyze-route` — 29/29; api unit `routes.policy|
routes-schedules|parse-thread` — 15/15; app jest `features/routes`, `route-detail`, `download-file*`, `stat-block`,
`corridor-style` — 48/48.
NOT VERIFIED: int-тесты api (`routes-derived`, `routes-public`, `routes-admin`, `migrations`) — нужен Mongo/Redis
стенд, не поднимал (coder сообщает зелёный `pnpm check`); `pnpm e2e:web`, ручная проверка iOS/Android/браузер — не
запускались ни coder'ом, ни мной.

Измерения без замечаний: безопасность GPX (только `findPublished`, 404 без заголовков файла, `attachment` +
ASCII-fallback + RFC 5987, `\p{Cc}\p{Cf}` вырезаны, `nosniff`, CSP `sandbox`, `route-gpx` 30/мин после
`public-read`, тело — только числа `trkpt/ele`, без строк исходника); разбор — только `runParseThread`
(`deriveRoute` в белом списке), API не разбирает; инвариант «`derivedVersion` ⇒ экспорт» — обе записи в одной
транзакции, `recordDerived` условен по версии (идемпотентен, гонка двух прогонов безопасна); отказ потока
`loader`/падение — исключение (без метки), `timeout`/`unreadable`/код файла — метка версии, как в RC-2; индекс и
миграция expand-only, идемпотентна; контракт: старый клиент отбрасывает новые поля, новый клиент со старым API —
дефолты; SSR профиля — разметка зависит только от данных (без `onLayout`); i18n — свои ключи, удалённые нигде не
используются; дизайн-система — `Pill`, `StatBlock`, токены, `ROUTE_CATALOG_LINE_WIDTH` из токенов; карта гонки не
тронута (дефолт `stroke.indicator`).

### [MEDIUM] Продолжение бэкфилла `routes.derive.more` дедуплицируется само с собой — цепочка обрывается после одного шага
- **file:** apps/api/src/modules/routes/routes-maintenance.processor.ts
- **location:** `RoutesMaintenanceProcessor.process`, строки 212–219 (`queue.add(..., { jobId: ROUTES_DERIVE_MORE_JOB_ID, ... })`); `route-derived.ts:50` (`more`)
- **problem:** продолжение ставится с фиксированным `jobId: 'routes.derive.more'` изнутри обработчика. Когда
  полную пачку обрабатывает сама задача `routes.derive.more`, её хэш в Redis ещё существует (задача `active`,
  `removeOnComplete` срабатывает только после завершения), и `addStandardJob` возвращает дубликат
  (`if rcall("EXISTS", jobIdKey) == 1 then return handleDuplicatedJob(...)`, bullmq 6.4.0
  `dist/cjs/scripts/addStandardJob-9.js:536`). Итог: на каждый запуск (boot или cron) — не больше двух пачек
  (40 маршрутов), дальше — ждать следующего cron через 10 мин.
- **why_it_matters:** RC-13 обещает «сотни старых маршрутов догоняются за минуты, а не часы»; фактически 300 маршрутов
  — ~70 мин, всё это время карточки без профиля и без «Скачать GPX» (AC3 «после прогона регламента»). Тест
  `routes-derived.int.test.ts` («RoutesMaintenanceProcessor») подменяет `queue.add`, поэтому дедупликацию не ловит.
  Вторая сторона: `more = ids.length === deriveBatch` считается без учёта прогресса — если наивно сделать jobId
  уникальным, 20 маршрутов с постоянным сбоем окружения (нет исходника → `skipped` без метки) дадут бесконечный
  горячий цикл задач.
- **evidence:** см. location; BullMQ: задача с существующим jobId не добавляется, включая активную.
- **recommended_fix:** ставить продолжение с jobId, не совпадающим с текущей задачей (например, чередовать
  `routes.derive.more.a`/`.b` по `job.id`, или `routes.derive.more:<номер прохода>` из `job.data`), и только при
  прогрессе: `more = ids.length === batch && derived + failed > 0`. Int-тест на реальной очереди: 45 «старых»
  маршрутов → после одного запуска processor'а и дренажа очереди все 45 посчитаны; 20 без исходника → нет
  продолжения.

### [LOW] Декоративные символы в текстах для скринридера
- **file:** apps/app/src/features/routes/format.ts; packages/i18n/src/ru.ts
- **location:** `routeStatItems` (`stats.gainValue` = `'↑ {gain}'` → `accessibilityLabel` «Набор ↑ 1 240 м …»),
  `routeShape`/`chip.loop|oneWay` (`'↻ Круговой'`, `'→ В одну сторону'` в `Pill`)
- **problem:** стрелки входят в озвучиваемый текст: VoiceOver/TalkBack читают «стрелка вверх», «стрелка по часовой».
- **why_it_matters:** a11y-шум на ключевых цифрах карточки (тест `route-detail.test.tsx:126` фиксирует метку со
  стрелкой).
- **evidence:** `accessibilityLabel={[item.label, item.value, item.unit, item.note]...}` в `stat-block.tsx`.
- **recommended_fix:** символ — отдельным элементом с `accessibilityElementsHidden`/`aria-hidden`, либо отдельное
  поле `a11yValue` без стрелки в `StatItem`; для чипов — `accessibilityLabel` без символа.

### [LOW] Сбой окружения бэкфилла логируется без класса ошибки
- **file:** apps/api/src/modules/routes/route-derived.ts
- **location:** `run()`, `catch { ... 'derive skipped: environment error' }` (строки ~56–58)
- **problem:** исключение (падение потока, ошибка записи/транзакции) проглатывается без `error.name`/кода; маршрут
  повторяется каждые 10 мин без метки — повторяющийся сбой не диагностируется.
- **why_it_matters:** эксплуатация: «вечный skipped» без причины в логах.
- **evidence:** `} catch { this.logger.warn(\`route ${id} derive skipped: environment error\`); ...}`
- **recommended_fix:** логировать `error instanceof Error ? error.name : 'unknown'` (и `code` MongoServerError, если
  есть) — без сообщения, чтобы не утекли данные.

Итог: CRITICAL/HIGH нет — APPROVE. MEDIUM — исправить до merge желательно (влияет на AC3 по времени, не по итогу).

## Фиксы после pass 1

- **MEDIUM (бэкфилл 40 / 10 мин):** продолжение отдельной задачей убрано — `RoutesMaintenanceProcessor` гоняет пачки
  подряд в одной задаче, пока пачка полная **и** есть прогресс (`derived + failed > 0`), не больше
  `ROUTES_DERIVE_MAX_BATCHES = 10` (≤ 200 маршрутов); пачка из одних пропусков — стоп (без горячего цикла). Int-тесты:
  три пачки подряд, стоп без прогресса, предел пачек.
- **LOW (стрелки в a11y):** символы «↑», «↻», «→» убраны из текста чипов и стат-блока (декор, зачитывается
  скринридером).
- **LOW (класс ошибки):** в лог сбоя окружения добавлен `error.name` без текста сообщения.

# Findings — routes-03-card — pass 2 — reviewer: claude
base: origin/develop (9332f26)   commits: e603d35 (фиксы pass 1), 41fb4cc (merge develop / routes-02), working tree clean
verdict: APPROVE

Проверено: `git show e603d35`; `git diff 41fb4cc^1 41fb4cc` и `git diff 41fb4cc^2 41fb4cc`; маркеров конфликтов нет.
Запущено (изолированные `pokatim_r03rev2_test` / Redis db 13): api `src/db/migrations/migrations.int.test.ts` +
`src/modules/routes` — 8 файлов, 93/93; `packages/tracks` — 269/269; app jest `features/routes`, `route-detail`,
`my-routes`, `components` — 123/123; `pnpm typecheck` (8/8), `pnpm lint`, `pnpm arch:check` — зелёные.
NOT VERIFIED: `pnpm e2e:web` (нужен поднятый web+api стенд), ручная проверка iOS/Android.

Фиксы pass 1 — подтверждены, повторно не репортятся:
- MEDIUM бэкфилл: продолжение отдельной задачей убрано, пачки в цикле одной задачи до `ROUTES_DERIVE_MAX_BATCHES = 10`,
  стоп при неполной пачке или без прогресса (`derived + failed === 0`) — горячего цикла нет; остаток — следующий cron.
  Разбор в `worker_threads`, event loop не блокируется — продление lock BullMQ работает. `ROUTES_DERIVE_MORE_JOB_ID`
  нигде не используется. Тесты: три пачки подряд, стоп без прогресса, предел пачек.
- LOW a11y: стрелки удалены из `chip.loop|oneWay`, `stats.gainValue`; тесты обновлены.
- LOW лог: `error.name` без текста сообщения.

Merge 41fb4cc — по пунктам:
- `parse.ts`: `loadRoutePoints` содержит `detectRouteFormat` + ветку `parseKml` (routes-02) с `maxPoints`; и
  `analyzeRoute`, и `deriveRoute` идут через него — KML-маршруты получают профиль/GPX и при разборе, и в бэкфилле.
- Миграции: `0021_routes_rider` (develop) не тронута, `0022_routes_derived` последней в `index.ts`; тест 0021
  ослаблен корректно (`toContain` вместо `at(-1)`), тест 0022 проверяет порядок «сразу после 0021», индекс и
  идемпотентность; ожидаемые индексы `route_geometries` обновлены.
- Граница приватности: `derivedOf`/`exportGpx` вызываются только после `published()` → `findPublished`
  (`status: 'ready'` + `IN_CATALOG` с `origin: 'platform'`); int-тест «изоляция маршрутов райдера» проверяет 404 на
  `''`, `/map`, `/gpx` для маршрута райдера, в т.ч. с подставленным `catalog`. `MyRoute`-ответы профиль/GPX не отдают.
  Утечки GPX/профиля маршрута райдера не найдено.
- `deleteOwn` удаляет `route_exports` в той же транзакции. Гонка с бэкфиллом: `recordDerived` пишет экспорт только
  при `matchedCount === 1` по `route_geometries` (обновление того же документа, который удаляет `deleteOwn`, —
  write conflict, одна из транзакций повторяется/откатывается); `markDerivedFailed` — `updateOne` без upsert. Осиротевший
  экспорт не остаётся. Других путей удаления маршрутов в API нет; правило `pokatim-db.md` про будущее удаление аккаунта
  дополнено `route_exports`.
- `routes.module.ts`: `IpRateLimitGuard` в провайдерах API, `RouteDerivedBackfill`/`RoutesMaintenanceProcessor`/
  `RoutesSchedules` и очередь `routesMaintenance` — только в `RoutesWorkerModule`, рядом с `MyRoutesService`.
- `route-line-map.tsx`: необязательный `lineWidth` проброшен до `RouteMap`; каталог передаёт `ROUTE_CATALOG_LINE_WIDTH`,
  карточка «Моего маршрута» — дефолт.
- i18n: `routes.detail.{length,elevation,elevationValue,loop,yes,no}` возвращены и используются
  `my-route-detail.tsx:173–180`; удалённые `kicker`, `city`, `surface` нигде не используются.
- e2e: сценарий routes-03 встроен в тест routes-01/02 (опрос `gpxAvailable`, SSR профиля, скачивание, заголовки GPX);
  блок «Мои» не тронут.

### [LOW] Эквивалентность `deriveRoute` ≡ `analyzeRoute` не проверена на KML
- **file:** packages/tracks/src/analyze-route.test.ts
- **location:** тест «deriveRoute ≡ { profile, gpx } из analyzeRoute; отказы — те же коды» (строки ~216–227)
- **problem:** после слияния `loadRoutePoints` разбирает KML (task.md §13: «бэкфилл считает и KML-маршруты»), но цикл
  эквивалентности и проверка кодов отказа идут только по GPX-фикстурам; бэкфилл KML-маршрута не покрыт ни здесь, ни в
  `routes-derived.int.test.ts`.
- **why_it_matters:** сейчас эквивалентность держится конструкцией (общий `loadRoutePoints`), но заявленное в §13
  поведение не зафиксировано тестом — регрессия при будущем разделении путей GPX/KML пройдёт незамеченной.
- **evidence:** `for (const name of ['route-loop.gpx', 'route-rte.gpx', 'zero-points.gpx'])`; отказы — `xxe.gpx`,
  `route-short.gpx`, `.fit`.
- **recommended_fix:** добавить в цикл `route-earth-gxtrack.kml` (с высотами) и `route-mymaps.kml` (без высот), в
  отказы — `xxe.kml` → `unreadable`.

Итог: CRITICAL/HIGH нет — APPROVE.
