# route-rides-05 (PR A): участки маршрута — разбиение, сверка, хранение, сравнение

Шаг 3 из 3 этапа 2 заездов по маршруту, PR A (`packages/tracks` + контракты + API). Решения — `docs/product/routes.md`,
«Этап 2» (U1–U4). Задача — `docs/tasks/2026-10-31-route-rides-05-segments/task.md`. Приложение (блок «Участки» в
`RideView`, i18n) — PR B; контракт аддитивный (`sections` `.default([])`), порядок выката свободный.

## Что сделано

- **Разбиение (U1).** `routeSections(line, widthM)` в `packages/tracks/src/corridor/sections.ts` (только серверный
  вход): границы через 10 км по chainage линии сверки, хвост < 5 км — к последнему участку, маршрут < 15 км или > 30
  участков — участков нет. Участок с концами ближе `2 · радиус ворот + 50` м (разворот) сливается с соседним (RC-4,
  детерминированно). `sectionLine` — подлиния с интерполированными концами. `ROUTE_SECTIONS_VERSION = 1`.
- **Сверка (U2).** `analyzeSections` (белый список потока разбора): файл разбирается один раз, по участку —
  неизменённые `prepareCorridor`/`matchCorridor` (`isLoop: false`). Движок, golden и `CORRIDOR_ENGINE_VERSION` не
  менялись.
- **Worker.** `RouteRideEvaluator.evaluate(ride, { sections })` — второй вызов потока после итога движка: ручная
  проверка — всегда, автопроверка — только «Пройден». Маршрут < 15 км — без потока. Таймаут/отказ потока участков —
  `sections.failure`, сбой окружения — `failure: 'error'` без ретрая: вердикт маршрута не страдает.
- **Хранение.** `route_rides.sections` (`{ version, failure, items }`, участок — `fromM`, `toM`, статус, время), без
  миграции; `requeue` сбрасывает в `null`.
- **Сравнение (U3).** `sectionsOf` — лучший и дельта по участку среди своих видимых заездов с теми же границами и
  версией (ключ — `compareRides`), считается при чтении. `GET /v1/routes/:routeId/rides/:rideId` → `sections` (только у
  «Пройден»/«Не пройден»).
- **Контракты.** `ROUTE_RIDE_SECTION_STATUSES`, `ROUTE_RIDE_SECTIONS_MAX`, `RouteRideSection`,
  `RouteRideDetail.sections` (`.default([])`, статус — `tolerantEnum`).

## Миграции / env / конфиги

Нет. Бэкфилла нет: у заездов до этого PR участков нет.

## Проверки

- Golden движка не менялся: `git diff --stat origin/develop -- packages/tracks/src/corridor/{match,prepare,project,policy,types}.ts packages/tracks/src/__fixtures__` — пусто.
- Таргетные прогоны — §12 task.md (полный `pnpm check` не гонялся по решению оркестратора).

## Открытый вопрос

- **Q1 (§8.2 task.md):** слитый участок с разворотом «туда-обратно» по одной дороге проходит через свои ворота старта —
  неизменённый движок его не засчитывает. Реализовано по спеке; нужен выбор варианта (рекомендация — не создавать такие
  участки).

## Риски

- До 30 прогонов движка по всему треку в одном потоке после основной сверки: бенч 200 км × 50 000 точек ≈ 0,4 с
  локально; таймаут потока даёт `sections.failure: 'timeout'`, вердикт маршрута цел.
- Сумма времён участков ≠ время маршрута (ворота у границ) — в приложении сумму не показывать (PR B).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
