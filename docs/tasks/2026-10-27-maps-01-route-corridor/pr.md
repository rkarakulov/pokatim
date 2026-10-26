# Карты 01: карта маршрута с коридором на карточке гонки (ADR-0014)

## Что

- **ADR-0014** (Accepted, выбор пользователя): MapLibre (RN 11 + GL JS 6), тайлы по URL стиля из env
  `EXPO_PUBLIC_MAP_STYLE_LIGHT/DARK`, на старте — OpenFreeMap (без ключа и аккаунта). Смена провайдера — смена env.
- **API:** `GET /v1/races/:id/route` — линия показа (≤ 1000 точек), старт, финиш, рамка, `widthM`; только
  опубликованная/отменённая гонка с коридором и готовым маршрутом, иначе `404 NOT_FOUND`; `PublicReadGuard`,
  `public, max-age=60`. Порт `RouteGeometry.displayGeometry` (проекция без `matchLine`, свой LRU).
- **contracts / api-client:** `RaceRouteMap`, `getRaceRoute(id)`.
- **app:** `features/maps/` (native — ленивая загрузка MapLibre RN при наличии нативного модуля; web — `maplibre-gl`
  динамическим `import()` после монтирования, воркер — `public/maplibre-gl-worker.mjs`); блок карты на `races/[id]`:
  коридор (ширина линии 2 × `widthM` в метрах по зуму), осевая линия, старт/финиш, тема, атрибуция, подпись-альтернатива,
  камера без анимации, скелетон/ошибка; pull-to-refresh перезапрашивает карту.
- **infra:** `ARG EXPO_PUBLIC_MAP_STYLE_*` в `infra/docker/Dockerfile` (build-web), build-args OpenFreeMap в
  `.github/workflows/deploy-dev.yml`.
- **docs:** правила `pokatim-app/security/backend/contracts`, runbook `local-dev.md`.

## Важно

- Нативная зависимость + config plugin: **нужна новая dev-сборка** (`eas build --profile development`). В Expo Go и
  старом dev-клиенте карточка открывается без карты.
- Линия показа маршрута гонки теперь публична (раньше — только `widthM`); линия сверки — нет.
- Не в scope (D1): свой трек с подсветкой вне коридора — слайс maps-02 (нужны интервалы вне коридора от worker).

## Проверки

- `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo/Redis) — см. комментарий в PR.
- Ревью: independent-reviewer pass 1 — REQUEST CHANGES (HIGH 1, MEDIUM 1, LOW 4) → исправлено; pass 2 — APPROVE
  (MEDIUM 1 → исправлен с отрицательным доказательством). `findings.md`.
- `pnpm build:web` (coder): `maplibre-gl` — отдельный async-чанк клиента; в серверном бандле код есть, не исполняется.

## NOT VERIFIED

- Карта в браузере с реальной гонкой и тайлами OpenFreeMap; native на dev-сборке/устройстве (D2, D8).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
