## Заезд по маршруту — модель, API, worker (route-rides-01)

PR 1 из 2: экран приложения — следующим PR. Панель не нужна.

Райдер проверяет свой заезд по маршруту каталога или своему готовому маршруту из «Моих». Сервер в worker сверяет трек
тем же движком коридора, что и гонки (±50 м, окно — время заезда ± 1 мин), и отдаёт: пройден или нет (с причиной,
частичный проезд не засчитывается), время, сравнение только со своими заездами — лучший, разница с лучшим и с
предыдущим. Данных других райдеров нет. Решения R1–R4 и RC-1…RC-15 — `task.md`.

### Что изменено

- Контракты `packages/contracts/src/route-rides/`, коды `ROUTE_RIDE_NOT_READY`, `ROUTE_RIDE_UPLOAD_FAILED`,
  `ROUTE_RIDE_QUOTA_EXCEEDED` (409) — в конце `ErrorCode`; api-client — 5 методов.
- Новый модуль `apps/api/src/modules/route-rides/`: `GET|POST /v1/routes/:routeId/rides`, `…/candidates`,
  `…/:rideId`, `…/:rideId/track` — `AuthGuard`, `no-store`; очередь `route-ride-check`.
- `routes`: порт `RouteRideRoutes` (каталог или свой готовый маршрут, без кэша). `tracks`: аддитивный
  `ActivitySource.liveActivities`. Существующие порты, гонки, `results`, движок коридора и golden — без изменений.
- Удаление аккаунта — шаг `route-rides` после `tracks`.

### Миграции, env, конфиги

- Миграция `0032_route_rides`: коллекция `route_rides`, уникальный индекс `(userId, routeId, activityId)`.
  Аддитивная. Env и конфиги не менялись.

### Проверки

- `TURBO_CONCURRENCY=1 pnpm check` до слияния develop — зелёный (api 1535, admin 357, app 1727).
- После слияния develop: typecheck всех пакетов — зелёный; `route-rides`, миграции, account, error-messages —
  102/102. Полный прогон — CI.
- Ревью: Codex — APPROVE без находок; Claude — APPROVE (MEDIUM исправлен, LOW — 3 из 4 исправлены).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
