# Findings — routes-import-export-formats — pass 2 — reviewer: claude
base: origin/develop   commits: working tree (не закоммичено; HEAD = 167f4d7f, origin/develop = ad4ff4a7 — ветка отстаёт на #134–#137)
verdict: APPROVE

## Сверка находок pass 1

| Находка pass 1 | Статус | Evidence |
|---|---|---|
| codex MEDIUM — EOCD в комментарии | исправлено | `kmz.ts:83–95` проверяет `at + 22 + commentLength === byteLength`; тест `kmz.test.ts:76–87` (ложная `PK\x05\x06` в комментарии → тот же KML; длина комментария больше остатка → `unreadable`) |
| codex MEDIUM — `altitudeMode` KML | исправлено | `route-kml.ts:13,17`: `absolute` только если у всех точек есть высота, иначе по умолчанию (`clampToGround`) — обосновано (иначе точки без высоты встали бы на 0 м); тест `route-kml.test.ts:32–47`; `routes.md:87` |
| claude MEDIUM — OOM потока от KMZ (4 млн элементов) | исправлено | `xml.ts` `ROUTE_XML_MAX_ELEMENTS = ROUTE_MAX_POINTS × 20 = 1 млн`; применён в `parseKml` (`kml.ts:46`), `parseTcx` (`tcx.ts:44`), `parseGpx` маршрута (`parse.ts` `maxElements`); `parseKml`/`parseTcx` вызываются только из `loadRoutePoints` (`git grep`), так что жёсткий предел в них не задевает треки; предел треков 4 млн не тронут. Тесты: `analyze-route.test.ts:233–275` (`route-many-elements.kmz` → `too_many_points`, `XMLValidator.validate` не вызван, и для `deriveRoute`). В pass 1 1 млн элементов уже давал быстрый `no_track` без OOM. Запас по законным файлам: самая тяжёлая точка — TCX activity (~13–14 элементов) × 50 000 < 1 млн; GPX 5 МиБ — ≈ 35 тыс. точек × 7 элементов |
| claude MEDIUM / codex LOW — `.claude/rules/*` (RC-16) | обоснованно оставлено | правки правил без OK пользователя не делаем; follow-up с перечнем файлов и строк записан в task.md §12 «Open follow-ups». Статус: открыт, до merge нужен отдельный PR после OK пользователя (см. LOW ниже) |
| claude LOW — тест «ложный размер» не доказывал `maxOutputLength` | исправлено | фикстура объявляет ровно 16 МиБ (проходит проверку объявленного), шпион `inflateRawSync` (`kmz.test.ts:16–20,89–97`) проверяет аргумент `{ maxOutputLength }` и `ERR_BUFFER_TOO_LARGE`; при удалении опции тест упадёт. Плюс `kmz.test.ts:99–102` — отказ по объявленному размеру без распаковки |
| claude LOW — отставание от develop | не исправлено (см. LOW ниже) | теперь отставание на 4 PR |
| claude LOW — a11y подписи формата | частично | `route-download-sheet.tsx:38–56` — `View role="group" aria-label="KML: …"`; на web это имя группы; на iOS/Android `View` без `accessible` своё имя не озвучивает — подпись по-прежнему читается после кнопки. Ограничение UI-кита (`Button` без `accessibilityHint`) зафиксировано follow-up'ом в app-foundation — принимаю, отдельной находкой не поднимаю |
| claude LOW — TCX > ~4 ч и 5 МиБ | исправлено | `routes.md:122` |

## Проверено самостоятельно

- `packages/tracks` vitest (Node 24.22.1): `Test Files 27 passed (27)`, `Tests 374 passed (374)`.
- `apps/api` `src/modules/routes` + `parse-thread.test.ts`, int на `pokatim_rvw_claude2_test` / Redis db 9: прогон 1 —
  `1 failed | 160 passed (161)` (файл не зафиксирован, вывод не сохранён), прогоны 2 и 3 — `Test Files 14 passed (14)`,
  `Tests 161 passed (161)`. Падение не воспроизвелось; машина под нагрузкой параллельных сессий — NOT VERIFIED как флак.
- `apps/app` jest `route-detail.test.tsx` + `src/features/routes`: `10 passed`, `114 passed`.
- prettier и eslint по 62 изменённым/новым `.ts/.tsx` — чисто; `tsc --noEmit` tracks, api — ок.
- Пересечение с develop: из файлов ветки develop менял только `apps/app/src/__tests__/ride-detail.test.tsx` (другие
  hunks: ассерты шита «Райд опубликован») и `packages/i18n/src/ru.ts` (другая строка) — текстового конфликта не жду.
  RTL-тесты шита скачивания опираются на `testID` и `heading`, e2e — на `getByRole('dialog', { name })`; это работает и с
  ModalSheet из #134 (имя окна на `Modal`), но сам прогон после rebase — NOT VERIFIED.
- NOT VERIFIED: полный `pnpm check` после фиксов pass 1 (coder его не перезапускал, см. task.md §12), e2e Playwright.

Измерения без новых замечаний: correctness (EOCD, предел элементов, `altitudeMode`), регрессии и вызовы (`parseKml`/
`parseTcx` — только маршрут; `parseGpx` трека — прежний предел), безопасность (защиты до разбора; zip — отказ до и во
время распаковки), контракты и старые клиенты (без изменений с pass 1), серверный авторитет / аудит / BullMQ (бэкфилл:
детерминированный отказ → `derivedFailure`, маршрут остаётся с GPX версии 1 и `exportFormats: ['gpx']`), миграции не
нужны, i18n, дизайн-система, платформы (один код шита web/native), Documentation Sync (`routes.md`).

### [LOW] Правила `.claude/rules/*` остаются рассинхронизированы (RC-16) — follow-up до merge
- **file:** .claude/rules/pokatim-security.md; pokatim-backend.md; pokatim-app.md; pokatim-db.md; pokatim-contracts.md
- **location:** frontmatter `pokatim-security.md` (`packages/tracks/src/{gpx,kml,xml,format}.ts` — нет `tcx`, `kmz`);
  ссылки на `gpxIpLimit`, `gpxFileName`, `catalogRouteGpxUrl`, `route_exports { gpx … }`
- **problem:** то же, что в pass 1; сознательно не правится без OK пользователя и записано в task.md §12.
- **why_it_matters:** без пути `kmz.ts`/`tcx.ts` в frontmatter security-правила не подключатся при правке zip/TCX-разбора.
- **evidence:** `git diff HEAD --name-only | grep .claude` — пусто.
- **recommended_fix:** запросить OK пользователя и сделать отдельный PR правил сразу за этим (или вместе с ним, если
  OK получен); в PR-описании указать follow-up явно.

### [LOW] Ветка отстаёт от origin/develop уже на 4 PR (#134–#137) — rebase и `pnpm check` перед PR
- **file:** вся ветка; пересекаются `apps/app/src/__tests__/ride-detail.test.tsx`, `packages/i18n/src/ru.ts`
- **location:** `git log HEAD..origin/develop` → `8856cd29` (#134), `55eef45e` (#135), `5c2ce78a` (#136), `ad4ff4a7` (#137)
- **problem:** `RouteDownloadSheet` и его тесты проверены на ModalSheet до #134; полный `pnpm check` после фиксов pass 1
  не запускался. `git diff origin/develop` поэтому показывает и «обратные» изменения develop (modal-sheet, push, tickets,
  Dockerfile), что мешает ревью.
- **why_it_matters:** AGENTS.md §6 требует зелёный `pnpm check` на итоговом состоянии; конфликт/поломка на ModalSheet
  #134 вскроется только в CI.
- **evidence:** см. раздел «Проверено самостоятельно» (пересечения файлов, прогоны только таргетные).
- **recommended_fix:** rebase/merge origin/develop, затем `pnpm check` (своя тестовая БД) и, по возможности, e2e
  routes-01…03.

## Итог

CRITICAL/HIGH нет. Все MEDIUM pass 1 исправлены с тестами, которые падают без исправления (шпионы `inflateRawSync` и
`XMLValidator.validate`, ложная EOCD в комментарии, `altitudeMode`). Правила `.claude/rules/*` обоснованно вынесены в
follow-up. Остались два LOW процессного характера (синхронизация правил, rebase + полный `pnpm check`).

verdict: APPROVE
