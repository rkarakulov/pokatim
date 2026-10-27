# Маршруты 03: карточка маршрута — толстая линия, профиль высоты, время в пути, «Скачать GPX»

## Что

Карточка `/routes/<id>` по образцу вело-приложений (решения P1–P7, `task.md` §2.1; RC-1…RC-16 — §8.1).

- **tracks:** `elevationProfile` (≤ 300 точек `[distanceM, elevationM]`), `routeGpx` (очищенный GPX 1.1: только
  `trkpt lat/lon` и `ele`, `creator="Pokatim"`), общий `loadRoutePoints`; `analyzeRoute` отдаёт `profile` и `gpx`;
  `deriveRoute` + `ROUTE_DERIVED_VERSION = 1` для бэкфилла.
- **contracts / api-client:** `CatalogRouteDetail` + `elevation: { minM, maxM, profile } | null` и `gpxAvailable`
  (по умолчанию `null`/`false` — совместимо в обе стороны); `catalogRouteGpxUrl(id)`.
- **API `routes`:** профиль и `derivedVersion` — в `route_geometries`, GPX — новая коллекция `route_exports`; пишутся
  в транзакции `markReady`. Регламент `routes-maintenance` (worker): каждые 10 мин + разовый прогон при старте —
  бэкфилл маршрутов без производных данных пачками по 20 (до 10 пачек за задачу), отказ разбора — метка
  `derivedFailure` до роста версии. `GET /v1/routes/:id/gpx` — только каталог; `attachment` с безопасным именем
  (RFC 5987, без управляющих и bidi-символов), `nosniff`, CSP `sandbox`, `public, max-age=60`, IP-лимит `route-gpx`
  30/мин поверх `public-read`. Общий `consumeIpLimit`/`IpRateLimitGuard` в `public-read.guard.ts`.
- **Приложение:** `RouteMap.lineWidth?` (каталог — 5 px, карта гонки без изменений); карточка: карта → название →
  чипы (покрытие, «Круговой» / «В одну сторону», город) → стат-блок «Дистанция / Набор / В пути» → площадной
  «Профиль высоты» (96 столбиков `View`, без новых зависимостей, SSR без `onLayout`, текстовая альтернатива) →
  «Поделиться» (primary) и «Скачать GPX» (secondary; web — скачивание, native — системный браузер). `SectionHero`
  с карточки убран (пустой серый блок над картой). Время в пути `[ASSUMPTION]`: асфальт 27, гравий 20, оба 24 км/ч.
- **docs:** `docs/product/routes.md`, правила `pokatim-{app,backend,db,security}.md`.

## Важно

- **Миграция `0022_routes_derived`** (expand-only): коллекция `route_exports`, индекс `route_geometries_derived_idx`.
- **Новая очередь worker `routes-maintenance`:** бэкфилл стартует сам при запуске worker; до него старые маршруты —
  без профиля и без кнопки GPX.
- Новое публичное раскрытие: очищенный GPX маршрута каталога (та же линия, что уже на карте, плюс высоты; без
  времени, датчиков, устройства и метаданных исходника).
- «Создать заезд», автор и аватар — вне scope (§8.2, P7).

## Слияние с routes-02

Миграция — `0022_routes_derived`; удаление своего маршрута удаляет и экспорт GPX; бэкфилл считает и KML (task.md §13).

## Проверки

- `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo/Redis) — зелёный.
- Ревью: pass 1 — Claude independent-reviewer APPROVE (MEDIUM 1, LOW 2) → все три исправлены (`findings.md`).

## NOT VERIFIED

- e2e web (смоук расширен) — в CI; ручная проверка карточки — на dev после выката.
- «Скачать GPX» на iOS/Android вручную.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
