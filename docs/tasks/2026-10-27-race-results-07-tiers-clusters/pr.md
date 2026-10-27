# race-results-07a: уровни Verified/START, группы пол × возраст, финишёры, флаги «Требует внимания» — модель, API, worker

Задача: `docs/tasks/2026-10-27-race-results-07-tiers-clusters/task.md` (07a; 07b — панель, 07c — приложение — отдельные PR).

## Что меняется

- contracts / api-client / i18n: уровни заявки, группы, финишёры, анкета Verified, флаги панели, 4 кода ошибок, право
  `profiles.verified_edit`, действие журнала `profile.verified_demographics_changed`, `not_ranked` в причинах спора.
- `packages/tracks`: `sensorFlags` (`HR_GAPS`, `HR_POWER_DECOUPLED`, `FLAGS_VERSION = 1`), `analyzeAttempt` отдаёт
  `sensors`/`flags`/`flagsVersion` (вне `CorridorMatch`, golden коридора не тронут).
- `apps/api`: анкета (`profile`), схема групп гонки (`races.admitEntry`), матрица заявки и повышение START → Verified,
  места по группе, финишёры, протокол по группам, флаги в панели и на разборе спора, worker пишет датчики и флаги.

## Миграция `0025_entry_tier` (без транзакции, идемпотентна)

1. `race_entries.tier: null → 'verified'`, `best.ranked = true` у заявок с `best`.
2. `races.groupScheme = 'overall'` у гонок с `lockedAt`, явный `null` — остальным.
3. Коллекция `rider_verified_profiles`.
4. Индексы `race_entries_ranked_idx`, `race_entries_finishers_idx`, `race_protocol_rows_group_idx`.
5. **Удаляет `race_entries_ranking_idx`** (решение автора 2026-10-27; откат — повтор `0015_results` создаёт его снова).

Опубликованные протоколы не меняются (строки без `groupKey` читаются как `overall`).

## Порядок деплоя

Миграция → API и worker **вместе** (RC-7). В окне «миграция → перезапуск» старый API может создать заявку с
`tier: null`, старый worker — `best` без `ranked`. Проверка после деплоя (`mongosh`, БД приложения):

```js
db.race_entries.countDocuments({ tier: null })
db.race_entries.countDocuments({ best: { $type: 'object' }, 'best.ranked': { $exists: false } })
db.races.countDocuments({ lockedAt: { $type: 'date' }, groupScheme: { $exists: false } })
```

Ненулевой результат — выполнить шаги 1–3 миграции вручную теми же `updateMany` (идемпотентны; журнал миграций
повтор `0025` не запустит) или перепроверить гонку из панели («Перепроверить треки» пересчитает `best`).

## Env / конфиг

Не меняются.
