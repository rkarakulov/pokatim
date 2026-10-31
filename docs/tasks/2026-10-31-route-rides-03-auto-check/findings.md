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

# Claude review pass 2

# Findings — route-rides-03-auto-check — pass 2 — reviewer: claude
base: origin/develop   commits: 3d5b7335..49f940b2 (working tree clean; origin/develop без новых коммитов поверх 7aa82a30)
verdict: APPROVE

Закрытие находок pass 1 (коммит `64cff2dc`):
- **Codex CRITICAL (повтор/ретрай расширял план сверх 20) — закрыто.** `autoPlan` больше не блокирует маршрут автозаездом
  группы: такой маршрут остаётся на своём месте (`done: true`), заезды группы исключены из порядка (а) (`others`) и из
  квоты; `nearRoutes` считает `done` в `room`; `run` пропускает `done` без прогона. Блокирует только ручной (или без
  `origin`) заезд группы и квота — как до отсечения 20 (AC-4). Int «21 подходящий маршрут: ретрай после частичного
  успеха и повтор — те же 20» (сбой на 6-м прогоне → 5 заездов → ретрай `{20, 15}` → повтор `{20, 0}`, 20 заездов,
  `own[0]` не проверен) — честный, не тавтология.
- **MEDIUM (свой маршрут с одними сиротами выпадал из (б)) — закрыто.** `seen` заменён на `inRidden` (только маршруты с
  живыми заездами вне группы) и `blocked`; unit «свой маршрут … только заезды удалённых активностей — в (б)».
- **Codex MEDIUM (lastStartedAt по удалённым) — закрыто для итогового порядка.** `ridesByRoute` отдаёт `rides[]` с
  `startedAt`/`origin`, `autoPlan` сортирует по максимуму живых заездов вне группы; unit «удалённый свежий заезд не
  поднимает маршрут». Окно скана 200 по-прежнему сортируется по всем заездам — задокументировано («порядок скана»),
  влияет только при > 200 маршрутах.
- LOW JSDoc `displayLine` — закрыто; LOW AC-4 статически — закрыто сторожем итоговой карты `src/outbox-routes.test.ts`
  (`workerOutboxRoutes`: `activity-ready` → только `results-intake`, `activity-group-created` → только `route-ride-auto`).

Merge develop (`7aa82a30`, `49f940b2`): `routeRidesOutboxRoutes` подключён в `subscriberOutboxRoutes` (`mergeOutboxRoutes`),
очередь зарегистрирована в `RouteRidesWorkerModule`; `tracks.activity-ready` по-прежнему уходит только в `results`;
JSDoc события/маршрутов и §8.2 обоснование отдельного типа при fan-out — согласованы с кодом. Регрессий не найдено.

Прогон ревьюера: `vitest run src/modules/route-rides src/modules/routes/route-ride-routes.int.test.ts
src/modules/tracks/activity-source.int.test.ts src/outbox-routes.test.ts` (Mongo `pokatim_rr03r_test`, Redis db 8) —
8 files, 78 passed; `tsc --noEmit` (apps/api) — 0 ошибок; `eslint` route-rides/tracks/routes.repository/outbox-routes.test —
чисто. Полный `pnpm check`, jest приложения — NOT VERIFIED ревьюером.

### [LOW] Слот `done` может быть вытеснен изменением внешнего состояния между попытками — тогда ≤ 20 автозаездов не гарантировано
- **file:** apps/api/src/modules/route-rides/route-ride-auto.processor.ts
- **location:** `plan` (строки 106–127) + `autoPlan` (порядок (б) `ownReadyIds` новые → старые)
- **problem:** детерминизм держится, пока между попытками не меняются входы плана. Если райдер между попытками создал
  новый готовый свой маршрут рядом (он встаёт первым в (б)), стал видимым каталожный маршрут выше по порядку, или
  при > 200 маршрутах сдвинулось окно скана, то при ≥ 20 подходящих последний `done`-маршрут уходит за отсечение, а
  новый маршрут прогоняется: повтор завершённого события (stalled) даёт 21 автозаезд группы.
- **why_it_matters:** V2 «не больше 20» — граница нагрузки и результата; окно узкое (ретрай в пределах backoff,
  повтор завершённого — только stalled), поэтому LOW.
- **evidence:** `nearRoutes(batch, bounds, …, maxRoutes - picked.length)` отсекает по позиции; `done` не имеет приоритета
  над новыми не-`done` кандидатами, стоящими раньше.
- **recommended_fix:** по желанию — резервировать слоты `done` первыми: `room` для не-`done` = 20 − число `done`
  (видимых и рядом), порядок прогона прежний; unit: 20 `done` + новый свой маршрут первым в (б) → план без прогонов.

### [LOW] Правило `pokatim-backend.md` про план автопроверки неточно в двух словах
- **file:** .claude/rules/pokatim-backend.md
- **location:** раздел «Автопроверка (route-rides-03 …)»
- **problem:** «по последнему заезду ↓» и «пропуски — заезд группы, квота 100», тогда как код: порядок — по последнему
  **живому** заезду вне группы, пропуск — **ручной** заезд группы (автозаезд — `done`, слот занят; это сказано
  последним предложением абзаца, но противоречит перечню пропусков выше).
- **why_it_matters:** правило — канон для следующих задач (PR #164 трогает тот же раздел); противоречие внутри абзаца.
- **evidence:** `autoPlan`: `group.some((ride) => (ride.origin ?? 'manual') !== 'auto')` → `blocked`; `others` для `lastStartedAt`.
- **recommended_fix:** «(а) по последнему живому заезду вне группы ↓ … пропуски — ручной заезд группы, квота 100
  (без заездов группы)».

Измерения без находок: correctness (кроме LOW выше), регрессии/call sites (`ridesByRoute`/`RiddenRoute` — единственный
вызывающий процессор), безопасность и приватность (без изменений с pass 1), placement/`arch:check` (по Outcome), контракты,
серверный авторитет, миграции (нет), идемпотентность BullMQ (V4 + уникальный индекс + `done`), обработка ошибок, тесты
(unit на каждую находку pass 1 + int 21 маршрута), acceptance AC-4/AC-6, i18n/дизайн-система/платформы (diff приложения
не менялся после pass 1), Documentation Sync (§8.2, Outcome, JSDoc — соответствуют; см. LOW).
