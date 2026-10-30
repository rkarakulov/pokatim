# Findings — routes-import-export-formats — pass 1 — reviewer: claude
base: origin/develop   commits: working tree (не закоммичено; HEAD = 167f4d7f, origin/develop = 8856cd29 — ветка отстаёт на #134)
verdict: APPROVE

Проверено самостоятельно (evidence):
- `packages/tracks` vitest: 3 прогона, 2 — `27 passed (27)`, первый — `1 failed | 26 passed` (файл не определён, при
  повторе не воспроизвелось; новых тестов с таймингами нет) — NOT VERIFIED как флак вне diff.
- `apps/api`: `routes.policy.test.ts`, `parse-thread.test.ts` — 31 passed; int (своя БД `pokatim_rvw_claude1_test`, Redis db 9)
  `routes-public`, `routes-derived`, `routes-mine`, `routes-admin` — `4 files, 76 passed`.
- eslint / prettier по изменённым файлам — чисто; `arch:check` — `no dependency violations`; typecheck (turbo, cache) — ок.
- Golden: `expected.json` — только +19 строк (4 новых ключа), удалений нет; md5 `__fixtures__/*.json` и `corridor/*`
  до и после прогонов тестов совпали — ничего не перезаписывается.
- e2e `apps/app/e2e/web.spec.ts` — NOT VERIFIED (стенд Playwright не поднимался).
- Валидация `routeTcx` реальным XSD Garmin (xmllint --schema) — NOT VERIFIED (XSD не в репо); порядок элементов
  сверен вручную с TrainingCenterDatabasev2.xsd (Course_t: Name, Lap*, Track*; CourseLap_t: TotalTimeSeconds,
  DistanceMeters, BeginPosition?, BeginAltitudeMeters?, EndPosition?, EndAltitudeMeters?, Intensity; Trackpoint_t: Time,
  Position?, AltitudeMeters?, DistanceMeters?) — совпадает.

Измерения без замечаний: correctness разбора zip (EOCD с конца в 22+65535, zip64-локатор и маркеры 0xFFFF/0xFFFFFFFF,
диск ≠ 0, ≤ 1000 записей, бит 0 шифрования, методы 0/8, `inflateRawSync` + `maxOutputLength`, размеры/CRC из central
directory, смещение данных по длинам локального заголовка, повторная сигнатура KML внутри; любые RangeError → `unreadable`);
TCX (общие защиты `xml.ts`, `countTags('Trackpoint')` до разбора, пропуск без `Position`); экспорт — только числа
(`Name` = константа `Pokatim`, нет строк исходника — проверено int-тестом и e2e-ассертами); контракт (`exportFormats` —
строки с отбрасыванием незнакомых, `.default([])`, `gpxAvailable` сохранён; ответ без `.strict()` — старые клиенты
не ломаются); серверный авторитет/аудит/BullMQ — без изменения семантики; миграция не нужна (полей-индексов нет,
бэкфилл — регламент `pendingDerived(2)`, `recordDerived` с условием `$lt version`, инвариант «версия ⇒ экспорт этой
версии» держится: других писателей `route_geometries`/`route_exports` нет); IP-лимит — общий ключ `route-gpx`
(int-тест 30 вперемешку → 31-е любого формата 429); 404 для v1 без полей; контроллер без копипасты (`sendExport`);
лёгкий `index.ts` не тянет `kmz.ts`/`tcx.ts`/`node:zlib`; UI шита — `ModalSheet` + `Button`/`TextAction` из
`@rkarakulov/ui`, токены, i18n через `t()`, web/native один код; документация раздела 10 (`routes.md`) обновлена.

### [MEDIUM] KMZ делает дешёвым OOM потока разбора: предел элементов XML рассчитан на треки, а не на маршруты
- **file:** packages/tracks/src/xml.ts; packages/tracks/src/kmz.ts; packages/tracks/src/parse.ts
- **location:** `xml.ts:15` (`XML_MAX_ELEMENTS = TRACK_MAX_POINTS * 20` = 4 000 000), `kmz.ts:10` (`ROUTE_KMZ_MAX_KML_BYTES` 16 МиБ), `parse.ts` `loadRoutePoints` (KMZ → `parseKml` с дефолтным пределом элементов)
- **problem:** до KMZ входной KML ограничен 5 МиБ (≈ 1,3 млн `<a/>`), теперь распакованный KML до 16 МиБ проходит
  `assertElementCount` с пределом 4 млн элементов (порог для заездов 200 000 точек, а у маршрута `ROUTE_MAX_POINTS` = 50 000).
  `XMLValidator` + дерево на ~4 млн узлов не помещаются в 160 МБ old generation потока. Это ровно сценарий, который RC-4
  хотел исключить («unreadable через падение потока, а не через проверку»): снижение до 16 МиБ его не закрыло.
- **why_it_matters:** любой автор (райдер, квота/лимит загрузок) архивом в ~15 КБ гарантированно доводит поток разбора до
  `ERR_WORKER_OUT_OF_MEMORY` за ~2 с на каждую попытку (и на каждый повтор бэкфилла). Итог тот же `unreadable` (поток
  изолирован, `parse-thread.ts:171`), поэтому не HIGH, но защита держится на аварийном пути V8, а не на проверке до разбора.
- **evidence:** эксперимент: zip с `doc.kml` = `<kml>` + `'<a/>'.repeat(3_999_000)` + `</kml>` (15 996 011 байт KML, zip
  15 686 байт) → `analyzeRoute` в `Worker` с `maxOldGenerationSizeMb: 160` → `worker error ERR_WORKER_OUT_OF_MEMORY 1779 ms`;
  тот же с 1 000 000 элементов → `no_track` за 915 мс.
- **recommended_fix:** для файлов маршрута передавать предел элементов от `ROUTE_MAX_POINTS` (например
  `assertElementCount(text, ROUTE_MAX_POINTS * 20)` = 1 млн — с запасом для `gx:Track`/TCX-точки ~10–12 элементов) в
  `parseKml`/`parseTcx`/`parseGpx(allowRoute)` через опцию `maxElements` (рядом с `maxPoints`); тест: KMZ с > предела
  элементов → `too_many_points` без вызова `XMLValidator.validate` (шпион, как в `tcx.test.ts` для DTD).

### [MEDIUM] Правила `.claude/rules/*` не синхронизированы (RC-16): устаревшие имена и перечни форматов, security-правила не цепляются к новым парсерам
- **file:** .claude/rules/pokatim-security.md; .claude/rules/pokatim-backend.md; .claude/rules/pokatim-app.md; .claude/rules/pokatim-db.md; .claude/rules/pokatim-contracts.md
- **location:** `pokatim-security.md:16` (frontmatter `packages/tracks/src/{gpx,kml,xml,format}.ts` — нет `tcx`, `kmz`), `:84`, `:200`, `:229` (`gpxFileName`), `:242`; `pokatim-backend.md:54` (`ROUTE_POLICY.gpxIpLimit`), `:68`; `pokatim-app.md:25` («маршрут: GPX/KML»), `:414` (`api.catalogRouteGpxUrl`); `pokatim-db.md:219–221` (`route_exports { gpx, sizeBytes … }`, «`gpxAvailable` без чтения»)
- **problem:** код переименовал `gpxIpLimit` → `exportIpLimit`, `gpxFileName`/`gpxContentDisposition` → `routeFileName`/
  `routeContentDisposition`, добавил `kml`/`tcx` в `route_exports` и `exportFormats`, а правила, которые task.md RC-16 явно
  перечисляет к обновлению, ссылаются на несуществующие символы и старый перечень форматов. Frontmatter
  `pokatim-security.md` не покрывает `kmz.ts`/`tcx.ts` — следующий агент, правящий разбор zip/TCX, не получит правил безопасности.
- **why_it_matters:** правила — канон для будущих правок (AGENTS.md); устаревшие имена ведут к ошибочным правкам, а
  отсутствие путей — к правке zip-парсера без security-контекста. Outcome фиксирует это как follow-up («запрет задачи»),
  но в task.md такого запрета нет — RC-16 требует обновления.
- **evidence:** `git grep -n "gpxIpLimit\|gpxFileName\|catalogRouteGpxUrl" .claude/rules` → `pokatim-backend.md:54`,
  `pokatim-security.md:229`, `pokatim-app.md:414`; в коде `gpxIpLimit`/`gpxFileName` больше нет.
- **recommended_fix:** обновить строки RC-16 и frontmatter (`{gpx,kml,xml,format,tcx,kmz}.ts`) в этой же ветке; если
  правка `.claude/` запрещена сессии — явный follow-up-PR до merge, а не после.

### [LOW] Тест «ложный размер» не доказывает работу `maxOutputLength`
- **file:** packages/tracks/src/kmz.test.ts; packages/tracks/scripts/generate-route-format-fixtures.ts
- **location:** `kmz.test.ts:50` (`route-bomb-lying.kmz`), генератор `:396–398` (объявлено 100 байт, реально 17 МиБ)
- **problem:** без `maxOutputLength` архив всё равно даст `unreadable` — по `out.length !== entry.uncompressedSize`
  (`kmz.ts:153`) после полной распаковки. Тест зелёный и при удалённой страховке, т. е. не различает защищённую и
  незащищённую реализацию.
- **why_it_matters:** регрессия (кто-то уберёт `maxOutputLength` или поставит больший предел) пройдёт тесты незамеченной;
  реальная бомба (ГБ нулей в ~1–2 МБ архива) тогда распакуется целиком в external memory процесса потока.
- **recommended_fix:** проверять ограничение ресурса, а не код: например прогон в `runParseThread` с бомбой ≥ 1 ГиБ
  распакованных нулей (архив < 5 МиБ) — ожидать `unreadable` быстро и без OOM; или замер `process.memoryUsage().arrayBuffers`
  до/после `kmlFromKmz` (< 32 МиБ прироста).

### [LOW] Ветка отстаёт от origin/develop на #134 (ModalSheet) — нужен rebase и повторный прогон app/e2e
- **file:** apps/app/src/components/modal-sheet.tsx (в develop); apps/app/src/__tests__/ride-detail.test.tsx
- **location:** `git log HEAD..origin/develop` → `8856cd29 Merge #134 modal-sheet-followups`
- **problem:** `RouteDownloadSheet` построен на ModalSheet до #134; в develop имя окна перенесено на `Modal`
  (`aria-label={title}`, «на web он и есть role=dialog»), добавлены `placement`/`headerAction`. e2e ищет
  `getByRole('dialog', { name: 'Скачать маршрут' })`; `ride-detail.test.tsx` правят обе ветки — вероятен конфликт.
  `git diff origin/develop` поэтому показывает и обратные изменения #134 (например «удалённый» `modal-sheet.web.test.tsx`).
- **why_it_matters:** RTL-тесты шита и e2e (уже NOT VERIFIED) проверены не на той версии компонента, с которой уйдут в develop.
- **recommended_fix:** rebase на origin/develop, затем `pnpm --filter @pokatim/app test` и e2e routes-01…03.

### [LOW] Подпись формата в шите не связана с кнопкой для скринридера
- **file:** apps/app/src/features/routes/route-download-sheet.tsx
- **location:** `:36–43`
- **problem:** кнопка озвучивается только «GPX/KML/TCX, кнопка», подсказка «для чего формат» — отдельный `Text` после неё.
  Пользователь VoiceOver/TalkBack выбирает формат, не услышав назначения (или слышит его уже после кнопки).
- **why_it_matters:** a11y шита — назначение формата это и есть смысл выбора (RC-8 «подпись — для чего формат»).
- **recommended_fix:** передать подпись в `accessibilityHint` кнопки (если `Button` из `@rkarakulov/ui` его принимает),
  а видимый `Text` пометить `importantForAccessibility="no"`/`aria-hidden`, чтобы не дублировать.

### [LOW] TCX-активности упираются в 5 МиБ раньше пользовательских ожиданий — в `routes.md` не сказано
- **file:** docs/product/routes.md
- **location:** «Форматы (M2)», абзац про TCX
- **problem:** TCX многословен (Garmin activity с пульсом/мощностью ≈ 300–400 Б на `Trackpoint`): 5 МиБ ≈ 13–17 тыс.
  точек ≈ 4 ч записи раз в секунду. Длинная тренировка из Garmin Connect получит «Файл больше 5 МБ», хотя по точкам
  (`ROUTE_MAX_POINTS` 50 000) прошла бы. Решение «≤ 5 МиБ» в 8 — осознанное, но продуктовый документ его последствие
  для TCX не фиксирует.
- **why_it_matters:** ожидаемый сценарий «загрузить TCX из Garmin» частично не работает без объяснения в продукте.
- **recommended_fix:** одна фраза в `routes.md` (TCX-тренировки длиннее ~4 ч — экспортируйте курс или GPX) или
  follow-up на сжатие/предел по формату.

## Итог

CRITICAL/HIGH нет. Acceptance 1–10 покрыты тестами (int и unit прогнаны мной зелёными, кроме e2e — NOT VERIFIED);
AC11 — по отчёту coder и моим частичным прогонам. Два MEDIUM (предел элементов для KMZ, синхронизация правил)
стоит закрыть до merge, но они не блокируют.
