# race-results-08a: рейтинг сезона — модель, API, worker

Задача: `docs/tasks/2026-10-28-race-results-08-season-standings/task.md` (08a; 08b — панель, 08c — приложение —
отдельные PR).

## Что меняется

- contracts / api-client: схемы `standings` (сводка и таблица сезона, свои строки `/me`, панель), методы клиента.
- `apps/api`: модуль `standings` — правила зачёта (Ф1, `N = M − ⌊M/3⌋`, DQ — 0 и не выбрасывается, ничьи в гонке и
  сезоне), снимок `season_standings` + `season_standing_rows`, регламент пересчёта, публичные чтения, `/me`, панель.
  Порты `SEASON_RACES` (`races`) и `RESULTS_FOR_STANDINGS` (`results`); `races`/`results` о `standings` не знают.
- Правила `.claude/rules/pokatim-{backend,db,security,contracts}.md`, ADR-0017 п. 5, `docs/product/*`, `epic.md`.

## Пересчёт — регламент, не события (DV-1)

Outbox базы ведёт тип события в одну очередь, события протокола уже у `notifications`. Worker раз в минуту (и при
старте) сверяет отпечаток источника сезона со снимком и пересчитывает изменившиеся сезоны целиком. Задержка таблицы —
до ~1 мин. Накопленные протоколы попадают в таблицу первым прогоном — бэкфилла нет. Fan-out outbox — follow-up в
app-foundation.

## Миграция `0030_standings` (expand-only, идемпотентна)

Коллекции `season_standings`, `season_standing_rows`; индексы `season_standing_rows_order_unique`,
`season_standing_rows_user_idx`, частичный `races_protocol_idx` (`protocolPublishedAt: { $type: 'date' }`).

## Порядок деплоя

Миграция → API и worker. Проверка после деплоя (через минуту после старта worker):

```js
db.season_standings.find({}, { _id: 1, formulaVersion: 1, sourceVersion: 1, computedAt: 1 })
```

Сезоны с опубликованными протоколами должны получить снимок; лог worker — `standings.recomputed`, без
`standings.sync_failed`.

## Env / конфиг

Не меняются.

## Проверки

`TURBO_CONCURRENCY=1 pnpm check` — зелёный. Ревью: Claude — APPROVE, Codex — APPROVE; фиксы pass 1 — task.md §12.1.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
