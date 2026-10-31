## Рейтинг сезона: пересчёт по событиям outbox

`standings` подписан на `results.protocol-published` и `results.result-revised` через fan-out outbox
(`@rkarakulov/api-kit` 0.6.0, ADR-0017 п. 5). Таблица сезона обновляется сразу после публикации протокола или новой
ревизии, а не через ~1 мин регламента (DV-1 race-results-08 заменено).

- `standingsOutboxRoutes` (тип → `standings-recalc`) — в конце `subscriberOutboxRoutes`; оба типа уходят и в
  `notifications-intake`, и в `standings-recalc` (сторож `outbox-routes.test.ts`).
- `StandingsSyncProcessor`: задачи событий → `StandingsRecalc.syncRace(raceId)` → сезон гонки (новый метод порта
  `SEASON_RACES.protocolRaceSeason`) → `sync([seasonId])`. Идемпотентно (сверка отпечатка, `claimSeason`); отказ —
  исключение и ретрай; невалидный payload — пропуск с логом.
- Решение S1: регламент `standings.sync` остаётся страховкой — раз в 15 мин и при старте worker (задача события,
  исчерпавшая ретраи; смена формулы; события до выката — бэкфилл не нужен).
- Документация: `pokatim-backend.md`, ADR-0017 п. 5, эпик race-results, `docs/product/notifications.md`.

Спека: `docs/tasks/2026-10-31-standings-outbox-events/task.md`. Ревью: independent-reviewer — APPROVE (проход 2).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
