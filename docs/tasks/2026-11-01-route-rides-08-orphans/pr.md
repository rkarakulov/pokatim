# route-rides-08: уборщик сирот заездов по маршруту

Задача — `docs/tasks/2026-11-01-route-rides-08-orphans/task.md` (follow-up route-rides-01 RC-1 вариант (b)).

## Что сделано

- Очередь `route-rides-maintenance`: `RouteRidesMaintenanceProcessor` (задача `orphans`) + `RouteRidesSchedules`
  (ежедневно 04:23 Минск, upsert; разовый прогон при старте worker).
- Скан `route_rides` по `_id` пачками по 500; сирота — активности нет (`ActivitySource.liveActivityIds`) или маршрута
  нет в `routes` вовсе (новый метод порта `RouteRideRoutes.existingIds`, реюз `RoutesRepository.existingIds`).
  Снятый с публикации и скрытый маршрут — не сирота (повторная публикация возвращает историю, RC-8).
- Удаление с условием ссылки (идемпотентно); ≤ 200 пачек за прогон, курсор хвоста — Redis (7 сут).
- Метрики — итог задачи `{ scanned, deletedActivity, deletedRoute, batches, more }` и строка лога со счётчиками.
- Документы: `routes.md` (уборщик убран из «Что не входит»), `pokatim-db.md`, `pokatim-backend.md`.

## Проверки

- int `route-rides-orphans` (удаления по причинам, живые/чужие/снятый/дубль целы, повтор — 0, пачки и курсор),
  unit `route-rides-schedules`.
- Полный `pnpm check`: lint, typecheck, arch — зелёные; тесты — зелёные, кроме флаков под нагрузкой (load ≈ 20) в
  нетронутых модулях: перф-бенчи `@pokatim/tracks`, `devices-sync`, `notifications` (лимит), `invite-friends-action` —
  повтор по отдельности зелёный (кроме бенчей; CI проверяет всё).

## Ревью

Codex pass 1 — APPROVE, находок нет. Claude independent-reviewer не запускался (форк без субагентов).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
