## Маршруты: импорт KMZ и TCX, экспорт KML и TCX

Spec и решения: `docs/tasks/2026-10-30-routes-import-export-formats/task.md`.

**Импорт** (`packages/tracks`, разбор в worker):
- TCX (`<TrainingCenterDatabase`): курсы и тренировки, все `Track` по порядку, точки без `Position` пропускаются.
- KMZ (zip): свой разбор на `node:zlib` — EOCD с проверкой длины комментария, central directory, `doc.kml` в корне
  или первый `.kml` в корне; stored/deflate, CRC; zip64/шифрование/многотомность — `unreadable`; распакованный KML
  ≤ 16 МиБ (`maxOutputLength`).
- Предел XML-элементов маршрута — 1 млн (`ROUTE_XML_MAX_ELEMENTS`): отказ подсчётом, а не OOM потока.
- API принимает любой zip (202 → worker) и TCX; FIT и прочее — 415.

**Экспорт** (считает worker, API отдаёт байты):
- `routeKml` (KML 2.2, `altitudeMode absolute`, если высоты у всех точек) и `routeTcx` (курс, `Name=Pokatim`,
  условное время от 2000-01-01 при 24 км/ч — `Time` обязателен XSD); только числа, без строк исходника.
- `route_exports` += `kml`, `tcx`; `ROUTE_DERIVED_VERSION = 2` — регламент пересчитает готовые маршруты. Миграции нет.
- `GET /v1/routes/:id/kml` и `/tcx`, общий IP-лимит с GPX; карточка `exportFormats` (по `derivedVersion`,
  незнакомые коды отбрасываются, дефолт `[]`); `gpxAvailable` сохранён.
- Приложение: один формат — «Скачать GPX», несколько — «Скачать» → `ModalSheet` выбора формата.
- Окна выбора файла приложения и панели — `.gpx,.kml,.kmz,.tcx`; тексты; `docs/product/routes.md`.

**Проверки:** полный `pnpm check` (см. комментарий CI); ревью Claude и Codex — APPROVE (pass 2,
`findings-*-2.md`). e2e Playwright локально не запускались — их гоняет CI.

**Правила:** `.claude/rules/pokatim-*` синхронизированы (frontmatter `pokatim-security.md` += `kmz.ts`, `tcx.ts`; RC-16)
по OK пользователя.

**Follow-up:** хранение экспорта в gzip; `accessibilityHint` у `Button` (app-foundation).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
