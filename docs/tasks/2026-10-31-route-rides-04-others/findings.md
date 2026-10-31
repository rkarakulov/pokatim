# Findings — route-rides-04-others — pass 1 — reviewer: claude
base: origin/develop   commits: 2e15bfea..19f4bc54 (9 коммитов, рабочее дерево чистое)
verdict: APPROVE

## Claude review pass 1

Проверено (evidence):
- Таргетные тесты на `pokatim_rr04r_test` / Redis db 8: `route-ride-leaderboard{,.int}.test.ts`, `route-rides.policy.test.ts`,
  `profile.int.test.ts`, `rider-names.test.ts`, `activity-source.int.test.ts`, `route-ride-routes.int.test.ts`,
  `migrations.int.test.ts` — 8 файлов, 172 теста, зелёные. `pnpm --filter @pokatim/api typecheck` — чисто.
- Приватность: чужие строки только через `shares.has` (фильтр `showRouteRides: true` в запросе `findRouteRideRiders`,
  без кэша); `total` = длина ранжированного списка (согласные + зритель) — несогласные не учитываются ни в `total`, ни в
  местах; `me` строится только из своих заездов (`listOwn` + `liveActivities(userId, …)` с фильтром `userId`). Строка —
  явный литерал без `userId`/`activityId`/`routeId`/координат; `rideId` только у зрителя (`entry === me`). int-тест
  ключей ответа и строки — точный список. `liveActivityIds` — вход только из серверного агрегата, наружу подмножество
  входных id (проекция `_id`), ≤ 1000. Логи — только `route=<id>`.
- Журнал согласий: событие `route_rides` только при `before ?? false !== after ?? false`, в той же `transactions.run`, что
  и `updatePublicName`; оба флага — два события; валидатора `kind` у коллекции нет (`0019`), вставка `route_rides` не
  ломается. `KEEP_PROFILE_FIELDS.showRouteRides` попадает и в прочие pipeline-записи профиля (тема, модерация) — флаг не
  сбрасывается.
- Совместимость: `ProfileView.showRouteRides.default(false)` — новый клиент со старым API; `UpdateProfileRequest`
  без ключа — старые клиенты не затронуты; порядок PR A → PR B зафиксирован (RC-1).
- Места/тай-брейки: один компаратор `compareRides` (bestOf + таблица), `$topN.sortBy` и `$sort` по `best.*` — тот же
  порядок; места уникальные; `firstAlive` по порядку топ-3.
- Индекс/план: `0047` expand-only, идемпотентен, partial `passed`, `hint` + int-тест `IXSCAN`; Mongo 8.0 (`$topN` ≥ 5.2).
- Лимиты: 300/ч до любых чтений (404 тратит), скан 5000, пачки 1000. Удаление: профиль стёрт → нет в `shares`;
  активность удалена → `firstAlive`/`liveActivities`; снятый маршрут → `catalogRoute` `null` → 404 (int-тесты).

### [LOW] Правило автопроверки «приклеено» к новому пункту о таблице «Другие»
- **file:** .claude/rules/pokatim-backend.md
- **location:** ~строки 657–668 (раздел «Заезд по маршруту»)
- **problem:** Новый пункт вставлен в середину абзаца автопроверки: хвост «Отдельный тип нужен и при fan-out: «новая
  группа» решается только в транзакции записи под замком активностей … (8.1 AC-2)» теперь стоит в конце пункта
  «Таблица «Другие»» после «Правила — `ROUTE_RIDE_LEADERBOARD_POLICY`.».
- **why_it_matters:** Правило о транзакции группы дублей (route-rides-03) читается как относящееся к таблице «Другие»;
  Documentation Sync — правила должны отражать код точно.
- **evidence:** diff: `-  Правила — ROUTE_RIDE_AUTO_POLICY (...). Отдельный тип нужен и при fan-out: «новая группа»` →
  `+  Правила — ROUTE_RIDE_AUTO_POLICY (...).` + новый пункт `… Правила — ROUTE_RIDE_LEADERBOARD_POLICY. Отдельный тип
  нужен и при fan-out: «новая группа»`.
- **recommended_fix:** Вернуть фразу «Отдельный тип нужен и при fan-out … (8.1 AC-2)» в пункт автопроверки (после
  `ROUTE_RIDE_AUTO_POLICY`), новый пункт закончить на `ROUTE_RIDE_LEADERBOARD_POLICY`.

### [LOW] Лог усечения срабатывает и при ровно 5000 райдерах
- **file:** apps/api/src/modules/route-rides/route-ride-leaderboard.service.ts
- **location:** `table`, `if (scanned.length >= scanRiders)`
- **problem:** При ровно `scanRiders` райдерах маршрута агрегат не усечён, но пишется `route_rides.leaderboard_truncated`.
- **why_it_matters:** Ложный сигнал в мониторинге; на корректность ответа не влияет.
- **evidence:** `$limit: scanRiders` не отличает «ровно N» от «больше N».
- **recommended_fix:** По желанию — запрашивать `scanRiders + 1` и отрезать лишний, лог только при `> scanRiders`;
  либо оставить и уточнить текст лога («достигнут предел»).

Замечаний CRITICAL/HIGH/MEDIUM нет. Дизайн-система, состояния данных, платформы, i18n — вне PR A (UI в PR B); в
`apps/app` только фикстуры тестов.
