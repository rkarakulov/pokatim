# Маршруты 01: каталог маршрутов команды — вкладка «Маршруты» и карточка маршрута

## Что

Решения пользователя (D1–D5, `task.md` §2.1): каталог — только маршруты команды, опубликованные флагом в панели;
фильтры — город, дистанция, покрытие; карточка с картой, цифрами и гонками на маршруте; «Мои маршруты» и маршрут
райда — следующими слайсами.

- **contracts / api-client:** `route-catalog.schema.ts` (`CatalogRouteQuery/Card/Detail/Page/Cities`,
  `RouteMapGeometry`, `ROUTE_DISTANCE_BUCKETS`), `PublishRouteInput`, `PanelRouteSummary.catalog`, код
  `ROUTE_INVALID_STATE`, действия журнала `route.published|unpublished|catalog_updated`; методы клиента.
- **API `routes`:** `RouteDoc.catalog` (`{ city, surfaces, publishedAt } | null`); панель —
  `POST /v1/admin/routes/:id/publish|unpublish` (`races.manage`, только `ready`, транзакция «чтение → запись →
  журнал», повтор — без записи); публично (`PublicReadGuard`, `public, max-age=60`) — `GET /v1/routes`,
  `/routes/cities`, `/routes/:id`, `/routes/:id/map`; не опубликованное — `404`.
- **API `races`:** `GET /v1/routes/:id/races` — публичные гонки с этим маршрутом коридора (через порт
  `RouteCatalog.inCatalog`).
- **Панель:** экран «Маршруты» (список, «В каталоге», загрузка GPX, публикация с городом и покрытием, правка,
  снятие); загрузка GPX вынесена из `CorridorField` в `features/routes/`.
- **Приложение:** вкладка «Маршруты» (фильтры, состояния §4.12, pull-to-refresh), публичная карточка
  `/routes/<id>` (SSR + OG, карта без коридора, гонки на маршруте, шеринг), раздел «Маршруты» на Главной.
  Карта — новый необязательный пропс `RouteMap.corridor` (по умолчанию `true`), карта гонки не изменилась.
- **docs:** `docs/product/routes.md`, `home.md`, правила `pokatim-{app,backend,contracts,db,security,web}.md`.

## Важно

- **Миграция `0020_routes_catalog`** (expand-only): частичный индекс `routes_catalog_idx`, индекс
  `races_route_idx` по `corridor.routeId`, бэкфилл `catalog: null`.
- Новое публичное раскрытие: линия, старт и финиш маршрута, опубликованного в каталоге (осознанное действие
  сотрудника, предупреждение в окне публикации).

## Проверки

- `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo/Redis) — зелёный.
- e2e без API (`playwright -g "маршрут|…"`) — зелёный.
- Ревью: pass 1 — Claude APPROVE (MEDIUM 1, LOW 2), Codex REQUEST CHANGES (HIGH 1) → исправлено; pass 2 Codex —
  APPROVE. `findings.md`.

## NOT VERIFIED

- e2e-шаг с API (`E2E_API=1`), `pnpm e2e:admin`; карта на устройстве и в браузере с тайлами OpenFreeMap.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
