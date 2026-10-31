# Findings — achievements-push (N2) — pass 1 — reviewer: claude
base: origin/develop   commits: 7dc2b0a1..be6e2ec6 (origin/develop...HEAD), working tree clean
verdict: APPROVE

Проверено самостоятельно (evidence): `pnpm --filter api typecheck` — зелёный; eslint `--max-warnings=0` и prettier по
файлам diff — чисто; `pnpm arch:check` — без нарушений; vitest на изолированных Mongo RS / Redis
(`pokatim_revn2_test`, redis db 13): `src/modules/achievements/**`, `achievements-sync*`, `migrations.int.test.ts`,
`route-rides/**`, `standings/**`, `results-revisions`, og-тесты — все зелёные (15 + 10 + 4 файла).

Измерения без находок: безопасность (нет ввода пользователя; фильтры Mongo из примитивов; логи — uid и счётчики);
серверный авторитет; аудит (не требуется, 7.5); миграция `0044` — expand-only, идемпотентный `createIndex`, через
`db:migrate`, не при старте, номер следующий за `0043` в `origin/develop`; границы модулей (источники — методы
существующих портов владельцев через `index.ts`, условия «прошёл»/«засчитан» — в репозиториях владельцев; depcruise
чист; `AchievementsWorkerModule` только в `WorkerModule`); `changed-since.ts` — `changedAfter(after)` без поля
даёт прежний фильтр, `CHANGED_SORT` прежний, вызовы og.sync (`races`, `rides`, `routes`, `calendar`) не менялись;
keyset `changedWithin` корректен (`[at, until]` ∧ (`field > at` ∨ `_id > id`)), индексы покрывают все окна
(`route_rides_passed_checked_idx` частичный по `status: 'passed'` — запрос содержит равенство; `rides_feed_idx`;
`_id_` журнала; `season_standing_rows_user_idx`; строки протокола — `race_protocol_rows_unique (raceId, revision, …)`);
полного скана нет; курсоры двигаются после `addBulk`, сбой источника не двигает его курсор, сбой фильтра/постановки
не двигает ни одного; замок со снятием своим токеном (истечение замка даёт только перекрытие/откат курсора назад —
дубли, не пропуски); задача райдера идемпотентна (`reconcile` + гарантия N1 «одно событие»), ретраи 3 × exp,
последняя попытка — лог `achievements.server_sync_failed`, failed-набор ограничен; фильтр `liveUserIds` ∩
`syncedAmong` пачками; ревизия протокола пишется в той же транзакции, что строки протокола (`writeRevision`), поэтому
uuidv7 `_id` журнала ≈ момент коммита; снимок сезона — `computedAt` в начале пересчёта (секунды до коммита).
i18n, дизайн-система, состояния данных, платформы — не применимо (только backend). Тесты честные: AC5 считает задачи
поимённо (без маркера, закрытый, старше окна, моложе `settleMs`, райд < 3 ч), AC3 идёт через реальную очередь до
фейкового Expo, источники — окно/страница/продолжение/«не тот факт».

### [MEDIUM] Источник `route_rides`: `checkedAt` — момент до ожидания семафора разбора, а не момент записи итога
- **file:** apps/api/src/modules/route-rides/route-rides.repository.ts (`passedWithin`), apps/api/src/db/migrations/0044_route_rides_passed_idx.ts; причина — apps/api/src/modules/route-rides/route-ride-check.processor.ts
- **location:** `RouteRideCheckProcessor.evaluate` (`const now = this.clock.now();` перед `this.analyze(...)`), `record(...)`; `passedWithin` (`changedWithin(after, until, 'checkedAt')`)
- **problem:** `checkedAt` итога берётся до `runParseThread`, который ждёт общий FIFO-семафор `PARSE_THREADS_MAX = 1`
  (track-processing, route-processing, attempt-check, dispute-series, routes-maintenance) и потом работает до 30 с.
  Строка становится `passed` (коммит `record`) позже `checkedAt` на время ожидания + разбора. Если это больше
  `settleMs` (2 мин) и прогон уже сдвинул курсор за `checkedAt`, строка никогда не попадёт в окно.
- **why_it_matters:** `settleMs` в 5.D — «запас на коммит транзакции»; здесь задержка не ограничена и систематична в
  дни гонок (очередь attempt-check по 30 с на попытку легко даёт > 2 мин ожидания) — push за засчитанный заезд
  теряется регулярно, а не «при сбое». RC-P9 принимал потерю при сбое, а не по конструкции источника. Запись в
  центре появится при GET, поэтому не HIGH.
- **evidence:** `route-ride-check.processor.ts`: `const now = this.clock.now(); const outcome = await this.analyze(..., now, line);` → `{ ...emptyResult(now), ... }` (`checkedAt: now`); `record(..., this.clock.now())` ставит `updatedAt` = момент записи; `parse-thread.ts`: `PARSE_THREADS_MAX = 1`, «ожидание не входит в таймаут потока».
- **recommended_fix:** вести окно по моменту записи итога: частичный индекс `{ updatedAt: 1, _id: 1 }` по
  `status: 'passed'` и `changedWithin(after, until, 'updatedAt')` (лишние совпадения при других обновлениях
  безвредны — сверка идемпотентна), либо ставить `checkedAt` в `record` из её `now`. Миграция ещё не выкачена —
  можно поправить `0044` до мержа. Добавить int-тест «итог записан позже `checkedAt` на > settleMs — читается».

### [LOW] Сезон становится итоговым без пересчёта снимка — события нет
- **file:** apps/api/src/modules/standings/rider-season-standings.ts
- **location:** `settledRidersAfter` (момент `max(computedAt, endsBefore)`)
- **problem:** итог сезона не полон, пока есть опубликованная гонка с коридором без протокола (`awaitingProtocol`,
  RC-S2). Если такую гонку отменяют после конца сезона, сезон становится итоговым, но отпечаток источника снимка не
  меняется → `computedAt` не двигается, `endsBefore` уже позади курсора → райдеры сезона не сверяются сервером.
- **why_it_matters:** сезонные выдачи этого сезона придут только вспышкой при GET, без push (best effort, RC-P9 —
  поэтому LOW).
- **evidence:** `races.repository.ts` `seasonsAwaitingProtocol` (`status: 'published', protocolPublishedAt: null, corridor: { $ne: null }`); `standings-recalc.ts` `if (state?.fingerprint === source.fingerprint) continue;`.
- **recommended_fix:** принять и упомянуть в ADR-0020 (RC-P9) или учитывать момент отмены/снятия гонки сезона
  (`races.updatedAt` завершённых сезонов) как ещё одно событие сезона.

### [LOW] Ревизии: N+1 запрос строк протокола на страницу журнала
- **file:** apps/api/src/modules/results/rider-results.ts
- **location:** `revisedRidersAfter`, цикл `for (const { raceId, revision } of revisions) … protocolRowUserIds(...)`
- **problem:** до `pageRows` (500) последовательных запросов за прогон при догоне после простоя — расходится с оценкой
  5.D «≤ 4 источника × (1–2 запроса)».
- **why_it_matters:** в обычном режиме ревизий единицы, поэтому только стоимость при догоне.
- **evidence:** код цикла выше; индекс есть (`race_protocol_rows_unique (raceId, revision, entryId)`).
- **recommended_fix:** один запрос `find({ $or: [{ raceId, revision }, …] }, { projection: { userId: 1 } })` или
  `distinct('userId', { $or })` на страницу.

### [LOW] Неиспользуемая общность в `changed-since.ts`
- **file:** apps/api/src/changed-since.ts
- **location:** перегрузка `changedAfter(after, field)`; поле `RiderChanges.full`
- **problem:** `changedAfter` с полем не вызывается в продакшен-коде (новые источники — `changedWithin`), `full` не
  читает `AchievementsSweep` (продолжение и так — следующим прогоном).
- **why_it_matters:** лишняя поверхность общего модуля и контракта портов (AGENTS: без лишней сложности).
- **evidence:** `grep changedAfter modules/` — только `races`, `rides`, `routes`, `calendar` без второго аргумента; `full` — только в тестах.
- **recommended_fix:** убрать перегрузку и `full` (или использовать `full` в логе прогона «есть остаток»).

### [LOW] `pr.md` не обновлён под N2
- **file:** docs/tasks/2026-10-31-achievements-push/pr.md
- **location:** весь файл (описывает N1)
- **problem:** раздел 10 task.md требует в `pr.md` миграцию `0044`, новую очередь и расписание; файл не в diff.
- **why_it_matters:** Documentation Sync; при мерже деплой не увидит шаг `db:migrate` для `0044`.
- **evidence:** `git diff origin/develop...HEAD --stat` — `pr.md` отсутствует.
- **recommended_fix:** обновить в finish-task (миграция `0044` перед выкатом worker, очередь `achievements-sync`).

## Вердикт

APPROVE — CRITICAL/HIGH нет. Рекомендуется исправить MEDIUM (источник `route_rides` по моменту записи итога) до
выката `0044`, пока миграция не применена.
