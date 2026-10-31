# route-rides-04 (PR A): таблица «Другие» — согласие, API, индекс, api-client

Шаг 2 из 3 этапа 2 заездов по маршруту, PR A (API). Решения — `docs/product/routes.md`, «Этап 2» (O1–O5). Задача —
`docs/tasks/2026-10-31-route-rides-04-others/task.md`. Приложение — PR B (`feature/route-rides-others-app`), после
выката этого PR: `UpdateProfileRequest` — `strictObject`, старый API ответил бы 400 на `showRouteRides`.

## Что сделано

- **Согласие (O1).** Флаг профиля `showRouteRides` (по умолчанию `false`) в `PATCH /v1/profile` и `ProfileView`;
  журнал `profile_consent_events` — `kind: 'route_rides'`, `ROUTE_RIDES_CONSENT_VERSION = '2026-10-31'`, только при
  смене, в транзакции `PATCH`; оба флага одним запросом — два события. На публичность профиля не влияет.
- **Таблица (O2–O5).** `GET /v1/routes/:routeId/rides/leaderboard?limit=` (`AuthGuard`, `no-store`, 1–100, по
  умолчанию 10) → `{ rows, total, me, shared }`. Только маршрут каталога (у автора одобренного — тоже), иначе 404.
  Строка — лучший живой пройденный заезд райдера с согласием сейчас (до 3 лучших), места уникальные, `rideDate` — день
  по Минску, имя/ссылка/фото — P1/R4, `rideId` — только своя. Своя строка — путь «Моих заездов», видна себе и без
  согласия. Лимит 300/ч, скан ≤ 5000 райдеров (лог `route_rides.leaderboard_truncated`).
- **Порты:** `RIDER_NAMES.routeRideRiders`, `RouteRideRoutes.catalogRoute`, `ActivitySource.liveActivityIds`
  (единственный метод порта без `userId`: наружу только подмножество id, ≤ 1000). Компаратор `compareRides` — один для
  `bestOf` и таблицы. Ребро `route-rides → profile` — только HTTP-модуль.
- **api-client:** `getRouteRideLeaderboard(token, routeId, { limit })`; `showRouteRides` в `updateProfile`.

## Миграции / env / конфиги

- **Миграция `0047_route_rides_leaderboard_idx`** (expand-only, без бэкфилла): частичный индекс `route_rides`
  `{ routeId, segment.elapsedSec, activity.startedAt, _id }` по `status: 'passed'`. env и конфиги не менялись.

## Проверки

- Таргетные (полный `pnpm check` — перед PR, решение пользователя): см. §12 task.md.

## Риски

- Журнал согласий после удаления аккаунта — юрист до прода (как Q1).
- Зритель без согласия видит себя в таблице — места остальных у него сдвинуты на 1 (O4).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
