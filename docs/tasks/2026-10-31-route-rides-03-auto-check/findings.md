# Claude review pass 1

# Findings — route-rides-03-auto-check — pass 1 — reviewer: claude
base: origin/develop   commits: 3d5b7335..8f6a8cb4 (working tree clean)
verdict: APPROVE

Проверено: идемпотентность (повтор события — V4 + уникальный индекс, `insertChecked` → `isDuplicateKey`), гонка с ручным
POST (обе стороны пишут основную группы; `findExisting` перед вставкой), `results` по-прежнему получает
`tracks.activity-ready` (тип не изменён, `tracksOutboxRoutes`/`resultsOutboxRoutes` не тронуты, новый тип — отдельный),
событие только при `candidates.length === 0` в транзакции под `lockUserActivities`, приватность (`ActivitySource.activity(userId, …)`,
маршруты только через `findRideableTitles`/`matchGeometry` — `IN_CATALOG | ownRider`, `ready`), удаление аккаунта (перечитывание
активности перед вставкой + sweep), совместимость контракта (`.default(null)` / `.default('manual')`, `tolerantEnum`; старые
клиенты отбрасывают лишние ключи), приложение (POST `{ activityId }`, `NOT_FOUND` → `recheckMissing`, `null` — без кнопки,
`check.isPending`). Повтор: BullMQ 5 попыток, exponential 5 с (api-kit `queue.module.js`). Миграций нет (поле необязательное).
Прогон: `vitest run src/modules/route-rides src/modules/routes/route-ride-routes.int.test.ts
src/modules/tracks/activity-source.int.test.ts` (Mongo `pokatim_rr03r_test`, Redis db 8) — 7 files, 69 passed.
Полный `pnpm check` и jest приложения — NOT VERIFIED (не запускались ревьюером).

### [MEDIUM] Свой готовый маршрут, у которого остались только заезды удалённых активностей, выпадает из плана (б)
- **file:** apps/api/src/modules/route-rides/route-rides.policy.ts
- **location:** `autoPlan`, `seen.add(route.routeId)` до вычисления `skip`; `own = … .filter((routeId) => !seen.has(routeId))`
- **problem:** `seen` пополняется каждым маршрутом из `ridesByRoute`, включая пропущенные по `alive.length === 0`. Маршрут без
  живых заездов в (а) не попадает (верно — «видимого заезда нет»), но и из (б) исключается, хотя он «свой готовый».
- **why_it_matters:** райдер удалил активность (или её стёрла пересинхронизация источника) — сироты `route_rides` остаются
  до ручного POST (RC-1, сирот автопроверка не чистит), и его собственный маршрут больше никогда не проверяется
  автоматически. Нарушает V2(б)/AC-4: «(б) = ownReadyIds минус (а) и минус маршруты с заездом группы / квотой» — маршрут с
  одними сиротами не входит ни в одно из исключений.
- **evidence:** policy.test.ts «autoPlan …»: `route(4)` с `activityIds: [id(99)]` (нет в `heads`) — сценарий есть, но
  `route(4)` не передан в `own`, поэтому дефект не виден. Если добавить `route(4)` в `own`, план его не вернёт.
- **recommended_fix:** добавлять в `seen` только маршруты, реально попавшие в (а) или пропущенные по заезду группы/квоте
  (`alive.length > 0`); тест: свой маршрут с одними мёртвыми заездами → в (б).

### [LOW] JSDoc `displayLine` оказался над `displayLines`
- **file:** apps/api/src/modules/routes/routes.repository.ts
- **location:** ~строки 874–886
- **problem:** новый метод с JSDoc вставлен между прежним комментарием «Только линия показа (проекция без `matchLine`…)» и
  `displayLine`; у `displayLines` два JSDoc подряд, у `displayLine` — ни одного.
- **why_it_matters:** документация метода вводит в заблуждение (IDE покажет второй комментарий; первый потерян).
- **evidence:** diff `@@ -856,6 +872,15 @@` — `/** Только линия показа … */` сразу над `/** Линии показа маршрутов по id … */`.
- **recommended_fix:** перенести старый JSDoc обратно над `displayLine`.

### [LOW] Регрессия AC-4 проверена только статически
- **file:** apps/api/src/modules/route-rides/route-ride-auto.int.test.ts
- **location:** `describe('AC4: …')`
- **problem:** тест сравнивает объекты маршрутов `resultsOutboxRoutes`/`routeRidesOutboxRoutes`, но не итоговую карту
  composition root (`worker.module.ts` — spread, последний ключ молча побеждает) и не «попытка гонки создаётся как прежде»
  после новой загрузки (task.md §11 TESTS).
- **why_it_matters:** будущий модуль, объявивший тот же тип позже в spread, перехватит `tracks.activity-ready` без падения
  теста. Сейчас дефекта нет (существующие int `results` зелёные по Outcome).
- **evidence:** `expect(resultsOutboxRoutes['tracks.activity-ready']).toBe(QUEUE.resultsIntake)` — только модульные объекты.
- **recommended_fix:** по желанию — проверка пересечения ключей всех `*OutboxRoutes` из `worker.module.ts` (без дублей).

Измерения без находок: безопасность/приватность, placement (порты через `index.ts`, `arch:check` по Outcome), контракты и
старые клиенты, серверный авторитет, миграции (нет), идемпотентность BullMQ, обработка ошибок (финальная попытка — пропуск
маршрута с логом без PII), i18n (ключ `routes.rides.result.autoChecked`), дизайн-система (`Text`/`textStyle`/`theme`),
состояния данных (кнопка — `isPending`, ошибки баннером), платформы (общий компонент, без нативных развилок), Documentation
Sync (§10: routes.md, pokatim-backend/db/security/contracts/app.md, JSDoc очереди и события — есть; `pr.md` — NOT VERIFIED,
файла в diff нет, он создаётся на finish).
