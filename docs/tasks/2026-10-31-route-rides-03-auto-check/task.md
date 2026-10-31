# task.md — route-rides-03: автопроверка заезда по маршрутам + `activityId` в детали

Уровень: task3. Ветка: `feature/route-rides-auto-check` от `origin/develop`. Шаг 1 из 3 этапа 2 заездов по маршруту
(далее — «Другие», route-rides-04; участки, route-rides-05). Продуктовые решения — `docs/product/routes.md`, раздел
«Этап 2» (V1–V5).

## 1. Title

Новая активность райдера автоматически проверяется по маршрутам, по которым он уже ездил, и по его готовым маршрутам;
сохраняется только «Пройден». Попутно — `activityId` в `RouteRideDetail` (follow-up RC-2 route-rides-02).

## 2. Goal

Сейчас заезд по маршруту проверяется только по явному выбору (R4). Райдер, регулярно катающий одну петлю, должен
видеть новый результат без ручного выбора: импорт Garmin/Wahoo или загрузка файла → через минуту в «Моих заездах»
маршрута появляется «Пройден» со сравнением.

## 3. Scope

Решения автора 2026-10-31 (вопросы в сессии): автопроверка — по «уже ездил + мои». Детали — `[ASSUMPTION]`:

1. **V1 — триггер.** Активность стала готовой (`tracks.activity-ready` или эквивалент): основная активность группы
   дублей, своя, не `cycling_indoor`, бег/прочее (`other`) — нет (как R5 профиля: `cycling` и `unknown`), начало заезда
   не раньше 7 дней до момента готовности. Дубль, ставший основным при удалении другого, — не новый заезд (не
   триггерит). Повтор события — идемпотентно.
2. **V2 — маршруты.** Видимые райдеру сейчас (порт `RiderRouteRides`/`RouteRideRoutes`: каталог или свой готовый):
   (а) маршруты, по которым у райдера есть хотя бы один видимый заезд (любой статус), и (б) свои готовые «Мои
   маршруты». Фильтр — `boundsNear(activity.bounds, route.bounds, 600)`. Не больше 20 маршрутов: сначала (а) по дате
   последнего заезда, затем (б) от новых к старым.
3. **V3 — только «Пройден».** Для каждого маршрута сверка тем же движком и политикой, что ручная (`widthM 50`, окно
   заезда ±1 мин). `counted` → создаётся заезд `passed` (как ручной, со сравнением); `rejected` и провал окружения —
   заезда нет, ничего не видно. Провал окружения повторяется ретраем BullMQ; на последней попытке — тихо пропустить.
4. **V4 — пропуски и лимиты.** Уже есть заезд этой группы дублей по маршруту (любой статус) — маршрут пропускается.
   Квота 100 заездов на маршрут — пропуск. Лимит ручных проверок `route-rides-user` (30/ч) не тратится. Ручной POST
   поверх автозаезда — тот же заезд (как сейчас).
5. **V5 — происхождение.** У заезда поле `origin: manual | auto` (контракт `tolerantEnum`, старые документы без
   поля — `manual`); в приложении на экране результата у `auto` — строка «Проверен автоматически».
6. **`activityId` в `RouteRideDetail`** — id основной активности заезда (аддитивно). «Проверить снова» в приложении
   шлёт `POST { activityId }` напрямую (без `fetchQuery` кандидатов); 404 — прежний текст «Заезда нет среди доступных
   — загрузите файл заезда ещё раз».
7. **Документация** — `docs/product/routes.md` (уже V1–V5), `.claude/rules/pokatim-backend.md`, `pokatim-db.md`,
   `pokatim-app.md` по факту.

## 4. Out of Scope

- Таблица «Другие» (route-rides-04), участки (route-rides-05).
- Уведомления/push о результате автопроверки; настройка «выключить автопроверку».
- Автопроверка по всему каталогу рядом; перепроверка старой истории (бэкфилл) при появлении нового маршрута.
- Движок коридора, `CORRIDOR_ENGINE_VERSION`, golden, гонки и `results` — без изменений поведения.

## 5. Architecture Context

- Модуль `apps/api/src/modules/route-rides/` (route-rides-01): коллекция `route_rides`, `RouteRideCheckProcessor`,
  событие `route-rides.check-requested` → очередь `route-ride-check`.
- Ограничение outbox базы: один тип события — одна очередь; `tracks.activity-ready/-removed` уже слушает `results`
  (route-rides-01 §5, RC-1). Нужен способ доставить «активность готова» в `route-rides` без правки базы — решает
  architect (образцы: `notifications` fan-out, `achievements-sweep`, или отдельное событие `tracks`).
- Порты: `ActivitySource` (`tracks`), `RiderRouteRides`/`RouteRideRoutes` (`routes`) — только через `index.ts`.
- ADR-0012 (движок в worker), ADR-0011 (активности), ADR-0015 (удаление аккаунта).

## 5.1 Placement & Reuse Gate (обязательно)

Architecture Review — route-rides-03. **Status: APPROVED** (блокеров нет; решения 8.1 AC-1…AC-12 — рекомендации
architect, по умолчанию coder идёт по ним; вопросы человеку — AC-2, AC-6, не блокирующие).

**Placement.** Новый код — `apps/api/src/modules/route-rides/` (папка, не пакет; один потребитель). Слои:
- `route-ride-evaluator.ts` — **новый** `RouteRideEvaluator` (worker): `evaluate(ride)`, `analyze(...)`, `parseLimits` —
  перенос (не копия) приватного `RouteRideCheckProcessor.evaluate` + `analyze` + `THREAD_FAILURES`/`emptyResult`/
  `failed`. `RouteRideCheckProcessor` делегирует ему; поведение ручной сверки не меняется.
- `route-ride-auto.processor.ts` — **новый** `RouteRideAutoProcessor` (очередь `route-ride-auto`, параллелизм 1):
  событие `tracks.activity-group-created` → план маршрутов (AC-4) → по маршруту: `evaluator.evaluate` → `passed` —
  вставка заезда `origin: 'auto'`; иначе — ничего.
- `route-rides.policy.ts` — чистые правила автопроверки (`ROUTE_RIDE_AUTO_POLICY`, `autoEligible`, порядок/фильтр
  плана) — unit-тестируемые.
- `route-rides.repository.ts` — `ridesByRoute(userId)` (агрегат по маршрутам) и `insertChecked(doc)`.
- `tracks` (владелец события): новое событие `tracks.activity-group-created` в той же транзакции записи активности
  (`track-processing.processor.ts`), `insertGrouped` возвращает ещё признак «новая группа». Маршрут очереди — у
  подписчика (`routeRidesOutboxRoutes`), как `resultsOutboxRoutes` для `tracks.activity-ready`.
- `routes` (владелец видимости): аддитивные методы порта `RouteRideRoutes` — `ownReadyIds`, `rideableBounds` (AC-5).
- Контракты: `packages/contracts/src/route-rides/route-ride.schema.ts` — аддитивно. Приложение —
  `apps/app/src/features/route-rides/route-ride-detail.tsx`, `packages/i18n/src/ru.ts`.
- Нового пакета нет; кода для app-foundation нет (`@rkarakulov/api-kit` не трогаем).

**Reuse (обязательно) / запрещённые дубли.**
- Сверка — `RouteRideEvaluator` (общий для ручной и автопроверки): `runParseThread('analyzeAttempt')`, семафор
  `PARSE_THREADS_MAX`, лимиты `DEFAULT_PARSE_LIMITS`, `matchWindowOf`, `verdictOf`, `ROUTE_RIDE_POLICY.corridorWidthM`.
  **Запрещено** копировать `evaluate`/маппинг `THREAD_FAILURES` в автопроцессор.
- Существующий заезд группы — `findExisting` + `ActivitySource.liveActivities` (как ручной POST); основная группы —
  как `RouteRidesService.primaryOf` (вынести общую функцию/метод, не копировать логику «дубль → основная»).
- Рамки — `boundsNear` из `@pokatim/tracks`, запас `ROUTE_RIDE_POLICY.boundsMarginM` (600) — не новая константа;
  `boundsOf` для линии маршрута — внутри `routes` (как `RouteRideRoutesService.rideable`).
- Квота — `ROUTE_RIDE_POLICY.maxPerRoute`; гонка вставки — `isDuplicateKey(error, ROUTE_RIDES_UNIQUE_INDEX)`.
- Документ нового заезда — общий конструктор документа с `RouteRidesService.create` (вынести `newRideDoc(...)` в
  policy/репозиторий), не вторая ручная сборка полей.
- Видимость маршрута — только порт `RouteRideRoutes` (условие `findRideable`: `IN_CATALOG` или `ownRider`, `ready`),
  коллекции `routes`/`tracks` из `route-rides` не читать.
- Достижения: автозаезд `passed` подхватывает существующий `achievements.sweep` (`passedWithin` по `updatedAt`) —
  ничего не добавлять.
- Приложение: `useCheckRouteRide`, `routeRideErrorMessage`, `Banner`, `DetailRow`/`Text` из дизайн-системы, ключи
  `routes.rides.result.*`.

## 6. Relevant Files

- `apps/api/src/modules/route-rides/*` — модуль заездов по маршруту.
- `apps/api/src/modules/tracks/tracks.events.ts`, `track-processing.processor.ts`, `activity-source*.ts` — событие
  готовности, порт активностей.
- `apps/api/src/modules/results/results.events.ts`, `results-intake.processor.ts` — нынешний потребитель
  `tracks.activity-ready`.
- `apps/api/src/modules/notifications/notification-fanout.ts`, `fanout-jobs.ts` — образец fan-out.
- `apps/api/src/queues.ts`, `worker.module.ts`.
- `packages/contracts/src/route-rides/route-ride.schema.ts`, `packages/api-client/src/index.ts`.
- `apps/app/src/features/route-rides/*`, экран `src/app/routes/rides/[routeId]/[rideId].tsx`, `packages/i18n`.

## 7. Implementation Notes

Contracts-first, TDD. Int-тесты — своя БД Mongo (`*_test`-суффикс) и свой Redis db.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` V1 7 дней, V2 20 маршрутов и 600 м, V3 «только пройден», V5 подпись.
- Риск нагрузки: одна активность → до 20 прогонов движка; параллелизм очереди и лимит потоков (`PARSE_THREADS_MAX`)
  — общие с ручной проверкой и гонками; architect оценивает приоритет/параллелизм, чтобы автопроверка не задерживала
  гонки.
- Риск гонки: ручной POST и автопроверка одной группы по одному маршруту одновременно — уникальный индекс
  `route_rides` должен дать один заезд.

## 8.1 Requirements Consistency (заполняет architect)

Блокеров нет. Противоречий с инвариантами AGENTS.md §4 нет (серверный авторитет: клиент не участвует; outbox в
транзакции записи активности; задачи идемпотентны). Находки — с рекомендацией; **вопросы человеку — AC-2 и AC-6**
(не блокируют: по умолчанию — рекомендация).

- **AC-1. Доставка «активность готова» в `route-rides`.** Outbox базы: тип события → одна очередь,
  `tracks.activity-ready` занят `results-intake`. Fan-out `notifications` (PR #151, `FanoutJobs`) — раскладка
  **получателей** внутри своей очереди, не раздача события нескольким модулям; не применим. Варианты:
  (a) **новое событие владельца `tracks.activity-group-created`** в той же транзакции записи активности, маршрут — у
  подписчика `routeRidesOutboxRoutes` → очередь `route-ride-auto`; (b) регламент-скан по курсору (образец
  `achievements.sweep`): курсорный порт в `tracks`, замок-аренда, расписание, задержка до минуты — больше
  инфраструктуры; (c) пересылка из `results-intake` (связь `results → route-rides`, нарушает границы) или fan-out в
  `api-kit` (база не правится). **Рекомендация — (a)**: доставка сразу, без новой инфраструктуры, `results` не
  затронут (AC9.4). Ограничение «тип → одна очередь» сохраняется и для нового типа (второму подписчику — снова
  своё событие или fan-out базы) — записать в `pokatim-backend.md`.
- **AC-2. «Новая» активность vs дубль и смена основной (V1).** Решается **в транзакции записи под
  `lockUserActivities`**, не у подписчика. Варианты: (a) **событие только когда новая активность образовала новую
  группу** (дублей-кандидатов нет, `primaryId === activity._id` и группа из одной); поздний Garmin поверх Wahoo того же
  заезда второй круг не запускает; (b) событие при каждой новой основной (в т. ч. перехват основной поздним
  источником) — у райдера с двумя устройствами до 2× прогонов движка на заезд; (c) решать у подписчика по группе
  «сейчас» — **теряется заезд**: к обработке события Wahoo уже дубль, а у Garmin группа из двух. **Рекомендация —
  (a)**. Цена: если первый источник группы не прошёл, лучший поздний источник автоматически не перепроверяется
  (ручная проверка доступна). Подписчик работает с **основной группы на момент обработки** (как `primaryOf` POST).
  Удаление основной (`regroupAfterDelete`) события не даёт — «дубль, ставший основным», не триггерит по построению.
  **Вопрос человеку:** согласны с (a)?
- **AC-3. «Момент готовности» для 7 дней.** Рекомендация — `ActivityRef.uploadCreatedAt` (приём файла сервером), а не
  `clock.now()` в worker: детерминирован при ретраях и задержке очереди; отличие от момента разбора — секунды. Условие:
  `startedAt ≥ uploadCreatedAt − 7 сут`; спорт — только `cycling` и `unknown` (не `cycling_indoor`, не `other`). →
  8.2 Deviations (уточнение формулировки V1).
- **AC-4. Порядок плана (V2) и где применяются пропуски (V4).** «Не больше 20» — это 20 **прогонов движка**: пропуски
  V4 (есть заезд группы — `findExisting`; живых заездов маршрута ≥ 100), видимость и `boundsNear` применяются **до**
  отсечения 20. Порядок: (а) маршруты со своими видимыми заездами (≥ 1 заезд с живой активностью, маршрут видим) по
  дате последнего заезда (`max(activity.startedAt)`) убыв.; затем (б) свои готовые маршруты новые → старые (`_id`
  uuidv7 убыв.), без повторов (а). Скан (а) — не больше 200 маршрутов по дате последнего заезда (`[ASSUMPTION]`,
  `ROUTE_RIDE_AUTO_POLICY.riddenRoutesScan`); (б) ограничено `MY_ROUTE_MAX_COUNT` (100).
- **AC-5. Рамка маршрута.** В `routes` рамка не хранится — считается из линии показа (≤ 1000 точек, как
  `RouteRideRoutesService.rideable`). Варианты: (a) **порт `rideableBounds(routeIds ≤ 25, userId)` пачками в порядке
  плана с остановкой на 20 подходящих** (обычно 1–2 пачки); (b) хранимая рамка маршрута — миграция и бэкфилл в
  `routes` вне задачи; (c) геозапрос по `route_geometries.line` — индекса 2dsphere нет, семантика ≠ `boundsNear`.
  **Рекомендация — (a)**.
- **AC-6. Одна задача на активность или задача на маршрут.** (a) **одна задача** (jobId = id события outbox), прогоны
  по маршрутам последовательно; сбой окружения на маршруте: не финальная попытка — исключение и ретрай всей задачи
  (сохранённые `passed` пропускаются по V4, отказные прогоняются снова — только при сбое окружения), финальная —
  маршрут тихо пропущен (лог), остальные проверяются; (b) план + задачи по маршруту (`jobId
  rra-<activityId>-<routeId>`) — точечные ретраи, но вторая схема задач и сверка постановки (как `FanoutJobs`).
  **Рекомендация — (a)** (проще; ретрай — редкий путь). **Вопрос человеку:** согласны?
- **AC-7. Нагрузка и приоритет гонок.** Отдельная очередь `route-ride-auto` (параллелизм 1), **не** `route-ride-check`:
  иначе ручная проверка (райдер ждёт на экране с опросом) стояла бы за 20 прогонами. Семафор потоков FIFO, каждый
  прогон берёт слот отдельно → попытка гонки ждёт не больше одного прогона от каждой очереди (≤ 30 с таймаута, как
  RC-10 route-rides-01). Приоритет BullMQ действует только внутри очереди — не нужен; `PARSE_THREADS_MAX` (1) не
  менять. Длинная задача (до 20 × (прогон + ожидание слота)) — блокировка BullMQ продлевается (поток не блокирует
  event loop); stalled → повтор идемпотентен (V4 + уникальный индекс).
- **AC-8. Гонка с ручным POST.** Оба пишут основную группы на момент → одинаковый `activityId` → уникальный
  `(userId, routeId, activityId)`: автопроверка проиграла — `isDuplicateKey` → пропуск; ручной POST после
  автозаезда — `findExisting` → тот же заезд (`passed` не перепоставляется). Перед вставкой автопроверка повторяет
  `findExisting` (основная могла смениться за время прогона); остаточное окно «две основные одной группы» — принятое
  ограничение RC-3 route-rides-01.
- **AC-9. «Только пройден» — без промежуточных статусов.** Заезд вставляется готовым документом `passed`
  (`origin: 'auto'`, `checkRevision 1`, `checkAttempts 1`, итог эвалюатора, `updatedAt` = момент вставки — его читает
  `achievements.sweep`) одной записью, без транзакции и outbox. `queued`/`checking` автопроверка не создаёт — «Мои
  заезды» не мигают. Сироты маршрута не чистит (только ручной POST, RC-1).
- **AC-10. Данные.** `origin` — необязательное поле документа (`origin?: 'manual' | 'auto'`), чтение `?? 'manual'`,
  ручной create пишет `'manual'`; бэкфилла нет → **миграции нет**. Агрегат «маршруты со своими заездами» —
  `{ userId }` = префикс `route_rides_user_route_activity_unique`; нового индекса нет.
- **AC-11. `activityId` в детали — основная группы сейчас** (`heads.get(ride.activityId).primaryId` из `visible`),
  не хранимый id (мог стать дублем после позднего импорта). Контракт: `activityId: Uuid.nullable().default(null)`
  (новая сборка со старым API — `null`: кнопка «Проверить снова» скрыта, окно — минуты деплоя);
  `origin: tolerantEnum(ROUTE_RIDE_ORIGINS).default('manual')` (незнакомое — `'unknown'`, строки нет).
  `RouteRideRow` не меняется (V5 — только экран результата).
- **AC-12. Удаление аккаунта во время автопроверки.** Шаг стирания `tracks` идёт раньше `route-rides`; перед вставкой
  автопроверка перечитывает активность (`ActivitySource.activity`) → `null` → пропуск. Остаточное окно (вставка между
  шагами) закрывает повторный проход `account.deletion-sweep` (ADR-0015) — coder проверяет, что повторный проход
  выполняет и шаг `route-rides`; если нет — 8.2 и вопрос оркестратору.

## 8.2 Deviations from spec

- **AC-3 (V1, уточнение формулировки):** «момент готовности» для окна 7 суток — `ActivityRef.uploadCreatedAt` (приём файла
  сервером), не `clock.now()` worker: условие `startedAt ≥ uploadCreatedAt − 7 сут` (`autoEligible`).
- **AC-2, AC-6** — приняты рекомендации architect: событие только для новой группы дублей; одна задача на активность.
- `RouteRideResult` перенесён из `route-rides.repository.ts` в `route-rides.collection.ts` (иначе цикл
  `policy ↔ repository` на `newRideDoc`, `arch:check`); поведение не меняется.
- **AC-1 после merge develop (PR #160, fan-out outbox, api-kit 0.6.0):** аргумент «тип события → одна очередь» больше не
  действует — `mergeOutboxRoutes` раздаёт тип всем подписчикам. Отдельное событие `tracks.activity-group-created`
  оставлено по второй причине AC-2: «новая группа дублей» известна только в транзакции записи под
  `lockUserActivities`; подписчик `tracks.activity-ready`, читающий группу «сейчас», её не восстановит (вариант (c) —
  потеря заезда). Маршрут `route-ride-auto` подключён через `routeRidesOutboxRoutes` в `subscriberOutboxRoutes`.
- **Ревью pass 1–3 (CRITICAL):** план события зафиксирован и устойчив. (1) Первая попытка сохраняет план (≤ 20 id
  маршрутов) в коллекцию `route_ride_auto_plans` по id события outbox (`insertOne`, дубль — план победителя;
  миграция `0046_route_ride_auto_plans`, TTL 30 сут, стирание по `userId` в шаге `route-rides`) — ретрай и повтор
  события, в том числе после удаления задачи BullMQ, проверяют только его (pass 3; `job.updateData` убран). Отклонение
  от §11 «миграций нет» — новая служебная коллекция (expand-only).
  (2) Пересчёт (первая попытка, повтор события после удаления задачи): заезды группы исключены из агрегата
  `ridesByRoute` до `$group`/`$limit` (автозаезды не сдвигают окно скана в 200 маршрутов), маршруты с автозаездом
  группы (`groupRides`) резервируют слоты первыми, остальные добирают до 20. Ручной заезд группы — пропуск до
  отсечения (V4). По маршруту плана с уже существующим заездом группы — пропуск без прогона движка.
  `RouteRideAutoOutcome.planned` — размер плана.
- **Ревью pass 3 (MEDIUM):** квота своего маршрута вне скана истории — проверка живых заездов до отсечения 20.
- **Ревью pass 1 (MEDIUM):** порядок (а) — по последнему **живому** заезду (`ridesByRoute` отдаёт `rides[]` с датой и
  `origin`); свой маршрут с одними сиротами — в (б).
- Порт `rideableBounds` при > 25 id бросает исключение (защита предела), а не режет молча.

## 8.3 Security checklist

Затронуто: данные пользователя (треки, заезды), worker, новый ответ API. Чек-лист — обязателен.

- [x] **AuthZ (worker).** `userId` — только из payload события, записанного сервером в транзакции `tracks`; активность
  — `ActivitySource.activity(userId, id)` (чужая/удалённая — `null` → пропуск); маршруты — только порт
  `RouteRideRoutes` (условие `findRideable`: `IN_CATALOG` или `ownRider(userId)`, `ready`), видимость повторно
  проверяет `matchGeometry` перед чтением линии сверки (RC-9). Чужие маршруты райдеров и снятые с публикации в план не
  попадают (int-тест).
- [x] **AuthZ (API).** `RouteRideDetail.activityId` — основная **своей** группы (`liveActivities(userId, …)`), деталь
  по-прежнему с `userId` в фильтре; ключи ответа — явный список (int-тест ключей: + `activityId`, `origin`).
- [x] **Данные наружу.** Без `userId`, `trackMap`, `engineVersion`, координат; `origin` — только `manual|auto`.
  Правило `pokatim-security.md` «без id активности (кроме кандидатов)» дополняется: «и `activityId` своей основной в
  детали».
- [x] **Злоупотребления / нагрузка.** Триггер — только новая группа (AC-2), спорт `cycling|unknown`, старт ≤ 7 сут до
  приёма файла (синхронизация истории не заваливает worker); ≤ 20 прогонов на активность; квота 100; параллелизм 1,
  отдельная очередь; загрузки уже ограничены лимитами `tracks`/`devices`. Лимит `route-rides-user` не тратится.
- [x] **Серверный авторитет.** Клиент не влияет на план и вердикт; `origin` ставит только сервер.
- [x] **Логи.** Только id (активность, пользователь, маршрут, заезд), счётчики, статусы и коды:
  `route-ride-auto activity <id> user <uid>: planned N, passed K, skipped S in T ms`, `route-ride <id> auto passed`;
  без названий маршрутов, координат, рамок.
- [x] **Удаление аккаунта.** Автозаезды стираются `RouteRideErasure.deleteAllOf`; гонка — AC-12.
- [x] **Секреты/конфиг.** Не затронуты.

## 9. Acceptance Criteria

1. Новая подходящая активность (импорт или загрузка) → в течение работы worker у маршрутов V2 с прохождением
   появляется заезд `passed`, `origin: auto`, со сравнением; у маршрутов без прохождения — ничего.
2. Не триггерят: дубль, станок, бег/прочее, заезд старше 7 дней, чужой/невидимый маршрут, далёкая рамка, маршрут с
   уже существующим заездом группы, квота 100. Больше 20 маршрутов — проверяются первые 20 по порядку V2.
3. Повтор события — без второго заезда; одновременный ручной POST — один заезд.
4. Гонки (`results`) получают `tracks.activity-ready` как прежде (регрессионный тест).
5. `RouteRideDetail.activityId` и `origin` в контракте, API, api-client; «Проверить снова» шлёт `activityId`;
   «Проверен автоматически» у `auto`.
6. Тесты, lint, typecheck затронутых пакетов зелёные; полный `pnpm check` — на группу шагов; CI зелёный.

## 10. Documentation Impact

`docs/product/routes.md` (V1–V5 — сделано), `.claude/rules/pokatim-backend.md`, `pokatim-db.md`, `pokatim-app.md`,
`pr.md`.

Дополнение architect: `pokatim-backend.md` — раздел route-rides (эвалюатор, `RouteRideAutoProcessor`, очередь
`route-ride-auto`, событие `tracks.activity-group-created` и ограничение «тип → одна очередь» для него, AC-1…AC-9);
`pokatim-db.md` — `route_rides.origin` (нет поля — `manual`), агрегат по префиксу индекса; `pokatim-security.md` —
`activityId` своей основной в детали, автопроверка в worker (8.3); `pokatim-contracts.md` — `ROUTE_RIDE_ORIGINS`,
`RouteRideDetail.activityId/origin` с `.default`; `pokatim-app.md` — «Проверить снова» по `activityId`, «Проверен
автоматически»; JSDoc `QUEUE.routeRideAuto`, `routeRidesOutboxRoutes`, `tracks.events.ts`. ADR не нужен (новое
событие и очередь в рамках ADR-0011/0012).

## 11. Implementation Context (заполняет architect)

**ENTRY POINTS**
- Worker: `TrackProcessingProcessor.record` (`apps/api/src/modules/tracks/track-processing.processor.ts`) → outbox
  `tracks.activity-group-created` → публикатор (`worker.module.ts`, `routeRidesOutboxRoutes`) → очередь
  `route-ride-auto` → `RouteRideAutoProcessor.process`.
- API: `GET /v1/routes/:routeId/rides/:rideId` (`RouteRidesReadService.detail`) — `activityId`, `origin`.
- Приложение: `RecheckAction` в `apps/app/src/features/route-rides/route-ride-detail.tsx`.

**FILES TO MODIFY / CREATE**
- `packages/contracts/src/route-rides/route-ride.schema.ts` — `ROUTE_RIDE_ORIGINS = ['manual', 'auto'] as const`
  (только в конец), `RouteRideOrigin`; в `RouteRideDetail` — `activityId: Uuid.nullable().default(null)`,
  `origin: tolerantEnum(ROUTE_RIDE_ORIGINS).default('manual')`; экспорт из `src/index.ts`; тест схемы.
- `packages/api-client/src/index.ts` — кода нет (схема та же); при необходимости тест разбора старого ответа.
- `apps/api/src/queues.ts` — `routeRideAuto: 'route-ride-auto'` с JSDoc (событие, jobId = id события outbox,
  параллелизм 1, финальный провал маршрута — тихий пропуск).
- `apps/api/src/modules/tracks/activity-groups.ts` — `insertGrouped` → `{ primaryId, newGroup }`
  (`newGroup = candidates.length === 0`); вызывающий — один.
- `apps/api/src/modules/tracks/tracks.events.ts` — `TRACK_ACTIVITY_GROUP_CREATED = 'tracks.activity-group-created'`,
  `TrackActivityGroupCreated = z.object({ activityId: z.uuid(), uploadId: z.uuid(), userId: z.uuid() })`, JSDoc
  (только новая группа дублей, под замком активностей; маршрут — у подписчика); экспорт в `tracks/index.ts`.
- `apps/api/src/modules/tracks/track-processing.processor.ts` — в транзакции после `activity-ready`: при `newGroup`
  — `append(TRACK_ACTIVITY_GROUP_CREATED)`. `activity-ready` не меняется.
- `apps/api/src/modules/routes/route-ride-routes.port.ts` + `route-ride-routes.ts` + `routes.repository.ts` —
  `ownReadyIds(userId, limit): Promise<string[]>` (`ready`, `distanceM ≠ null`, `ownRider`, `_id` убыв.) и
  `rideableBounds(routeIds ≤ 25, userId): Promise<Map<string, Bounds>>` (условие `findRideableTitles` + линии показа
  одним `$in` с проекцией `line` → `boundsOf`; без линии — нет в карте). Экспорт типов через `routes/index.ts`.
- `apps/api/src/modules/route-rides/route-ride-evaluator.ts` (новый) — `RouteRideEvaluator`: `parseLimits`,
  `analyze(...)`, `evaluate(ride: Pick<RouteRideDoc, '_id'|'userId'|'routeId'|'activityId'|'activity'|
  'corridorWidthM'>): Promise<RouteRideResult>` — перенос из процессора, без изменений поведения.
- `apps/api/src/modules/route-rides/route-ride-check.processor.ts` — делегирует `evaluate` эвалюатору; убрать
  `analyze`/`parseLimits` (тесты — на эвалюатор).
- `apps/api/src/modules/route-rides/route-ride-auto.processor.ts` (новый) — `@Processor(QUEUE.routeRideAuto,
  { concurrency: 1 })`: имя ≠ события — исключение; payload невалиден — `skipped`; `finalAttempt` как у check.
  `run(activityId, userId, { finalAttempt })`:
  1) основная группы сейчас (`ActivitySource.activity` → `isPrimary` или `activity(primaryId)`; нет — `skipped`);
  2) `autoEligible(primary)` (спорт `cycling|unknown`, `startedAt ≥ uploadCreatedAt − 7 сут`) — иначе `skipped`;
  3) план: `repository.ridesByRoute(userId, 200)` → `liveActivities` пачками ≤ 200 → по маршруту: живые заезды,
     `findExisting(…, primary.id)`, число живых; (а) = маршруты с ≥ 1 живым, без заезда группы, живых < 100, по
     `lastStartedAt` убыв.; (б) = `routes.ownReadyIds(userId, 100)` минус (а) и минус маршруты с заездом группы /
     квотой; пачками по 25 — `routes.rideableBounds` → `boundsNear(primary.bounds, bounds, 600)` → первые 20;
  4) по маршруту: `evaluator.evaluate({ …, corridorWidthM: ROUTE_RIDE_POLICY.corridorWidthM, activity: снимок })`;
     исключение → не финальная — пробросить (ретрай), финальная — лог и следующий маршрут; `status ≠ 'passed'` —
     ничего; `passed` → повтор `listOwn`+`liveActivities`+`findExisting` → нет — `repository.insertChecked(doc)`
     (`origin: 'auto'`), `false` (дубль ключа) — пропуск;
  5) лог итога (8.3). Возврат — `{ planned, passed }` или `'skipped'` для тестов.
- `apps/api/src/modules/route-rides/route-rides.policy.ts` — `ROUTE_RIDE_AUTO_POLICY = { recentDays: 7, maxRoutes:
  20, riddenRoutesScan: 200, boundsBatch: 25, sports: ['cycling', 'unknown'] }`, `autoEligible(activity)`,
  `autoPlan(...)` (чистая: порядок (а)/(б), пропуски, дедуп), `newRideDoc(...)` (общий конструктор документа для
  ручного `queued` и авто `passed`).
- `apps/api/src/modules/route-rides/route-rides.collection.ts` — `RouteRideOrigin`, `origin?: RouteRideOrigin`
  (JSDoc: нет поля — `manual`).
- `apps/api/src/modules/route-rides/route-rides.repository.ts` — `ridesByRoute(userId, limit)` (aggregate `$match
  { userId }` → `$group { _id: routeId, lastStartedAt: $max activity.startedAt, rides: $push { activityId } }` →
  `$sort lastStartedAt -1` → `$limit`); `insertChecked(doc): Promise<boolean>` (`insertOne`, `isDuplicateKey(…,
  ROUTE_RIDES_UNIQUE_INDEX)` → `false`).
- `apps/api/src/modules/route-rides/route-rides.service.ts` — `create` через `newRideDoc` (`origin: 'manual'`);
  `primaryOf` — общая часть «дубль → основная» вынести (функция над `ActivitySource`), использовать и в авто.
- `apps/api/src/modules/route-rides/route-rides-read.service.ts` — `detail`: `activityId` = основная из `heads`,
  `origin: ride.origin ?? 'manual'` (`visible` вернёт и `heads`).
- `apps/api/src/modules/route-rides/route-rides.events.ts` — `[TRACK_ACTIVITY_GROUP_CREATED]: QUEUE.routeRideAuto` в
  `routeRidesOutboxRoutes`; JSDoc (AC-1).
- `apps/api/src/modules/route-rides/route-rides.module.ts` — в `RouteRidesWorkerModule`: `registerQueue
  ({ name: QUEUE.routeRideAuto })`, провайдеры `RouteRideEvaluator`, `RouteRideAutoProcessor`.
- `apps/api/test/route-rides.ts` — `routeRidesWorker` диспетчеризует по типу (check → `RouteRideCheckProcessor`,
  group-created → `RouteRideAutoProcessor`) и **по умолчанию не обрабатывает** `tracks.activity-group-created`
  (опция `{ auto: true }`), чтобы прежние тесты ручной проверки не получали автозаездов; хелпер `autoEvents(h)`.
- `apps/app/src/features/route-rides/route-ride-detail.tsx` — `RecheckAction`: `ride.activityId === null` — кнопки
  нет; иначе `check.mutateAsync({ activityId: ride.activityId })`, ошибка `NOT_FOUND` → баннер `recheckMissing`
  (прежний текст), прочее — `routeRideErrorMessage`; убрать `fetchQuery` кандидатов и состояние `finding`
  (индикатор — `check.isPending`). `RideVerdict` у `passed` (и любой статус) при `origin === 'auto'` — строка
  `t('routes.rides.result.autoChecked')` (`Text` `textStyle('caption'|'body')`, `theme.text.secondary`).
- `apps/app/src/features/route-rides/queries.ts` — комментарий у `routeRideCandidatesOptions` (больше не для
  «Проверить снова»); `fetchQuery`-вариант убрать, если не нужен.
- `apps/app/src/features/route-rides/route-ride-format.ts` (+ test) — при необходимости `routeRideOriginText(origin)`
  (`auto` → строка, иначе `null`).
- `packages/i18n/src/ru.ts` — `'routes.rides.result.autoChecked': 'Проверен автоматически'`.

**FILES TO READ**
`docs/product/routes.md` («Этап 2»), task.md route-rides-01 (§8.1 RC-1…RC-15) и -02; `route-ride-check.processor.ts`,
`route-rides.service.ts`, `route-rides.policy.ts`, `route-rides-read.service.ts`, `route-rides.repository.ts`;
`tracks/track-processing.processor.ts`, `activity-groups.ts`, `activity-source.port.ts`/`.ts`;
`results/results.events.ts`, `results-intake.processor.ts` (регрессия); `routes/route-ride-routes*.ts`,
`routes.repository.ts` (`findRideableTitles`, `listOwn`, `displayLine`); `parse-thread.ts`; `queues.ts`,
`worker.module.ts`; `test/route-rides.ts`, `test/tracks.ts`, `test/results.ts`; правила `pokatim-backend.md`
(route-rides, outbox), `pokatim-db.md`, `pokatim-security.md`, `pokatim-app.md`, `pokatim-tests.md`; ADR-0011,
ADR-0012, ADR-0015.

**TYPES & SCHEMAS**
`ROUTE_RIDE_ORIGINS`, `RouteRideOrigin`, `RouteRideDetail.{activityId, origin}`; `TrackActivityGroupCreated`;
`RouteRideRoutes.{ownReadyIds, rideableBounds}`; `RouteRideEvaluator`; `ROUTE_RIDE_AUTO_POLICY`; `RouteRideDoc.origin?`;
импорт без копий: `ActivityRef`, `Bounds`, `boundsNear`, `ROUTE_RIDE_POLICY`, `ROUTE_RIDES_UNIQUE_INDEX`,
`OutboxJobData`, `MY_ROUTE_MAX_COUNT`.

**TESTS** (int — своя БД Mongo `*_test` и свой Redis db, `pokatim-tests.md`)
- Unit `route-rides.policy.test.ts`: `autoEligible` — `cycling`/`unknown` да; `cycling_indoor`/`other` нет; старт
  ровно `uploadCreatedAt − 7 сут` — да, на 1 мс раньше — нет. `autoPlan` — порядок (а) по последнему заезду, затем
  (б) новые → старые; маршрут в (а) и (б) — один раз, в (а); заезд группы — пропуск; живых 100 — пропуск, 99 — да;
  далёкая рамка — пропуск; 25 подходящих → первые 20; пропуски не занимают места в 20.
- Unit контракта: `RouteRideDetail` без `activityId`/`origin` → `null`/`'manual'`; `origin: 'x'` → `'unknown'`.
- Int `activity-source.int.test.ts` (tracks): новая группа → одно `tracks.activity-group-created` + одно
  `activity-ready`; дубль (другой источник ±180 с) → только `activity-ready`; поздний источник, перехвативший
  основную, → без group-created; удаление основной → без group-created; повтор задачи разбора → без второго события.
- Int регрессия `results`: `tracks.activity-ready` по-прежнему маршрутизируется в `results-intake`, попытка гонки
  создаётся как прежде (существующий тест + проверка маршрутов публикатора: оба типа есть, очереди разные).
- Int `route-ride-auto.int.test.ts` (новый): AC1 — у райдера есть заезд по маршруту каталога (любой статус) и свой
  готовый маршрут; новый `clean.gpx` → `passed`, `origin: 'auto'`, сравнение (`previous`/`best`), деталь отдаёт
  `activityId`, `origin`; маршрут без прохождения (`stop-80pct.gpx`) — заезда нет. AC2 — не триггерят: дубль, станок,
  `other`, старт старше 7 сут, чужой маршрут райдера / снятый с публикации, далёкая рамка, маршрут с заездом группы,
  квота 100 (вставкой фикстур), 21 подходящий маршрут → проверено 20 (спай `evaluate`, порядок). AC3 — повтор задачи
  (тот же jobId/событие) → один заезд; ручной POST во время автопроверки (ворота `test/rides.ts`-стиля или вставка
  перед `insertChecked`) → один заезд; ручной POST после автозаезда → `200`, тот же `id`, `origin: 'auto'`. Сбой
  окружения: `analyze` бросает → не финальная — исключение, финальная — заезда нет, следующий маршрут проверен.
  Лимит `route-rides-user` не списан (Redis-ключ). Активность удалена до обработки → `skipped`. Видимость: маршрут
  скрыт между планом и прогоном → заезда нет (`matchGeometry` `null` → не `passed`).
- Int `route-ride-check.int.test.ts` — существующие кейсы зелёные после переноса в эвалюатор (спаи — на
  `RouteRideEvaluator.analyze`/`parseLimits`); `route-rides.int.test.ts` — ключи детали + `activityId` (основная после
  позднего дубля-перехвата), `origin: 'manual'`; старый документ без `origin` → `'manual'`.
- Int `route-ride-routes.int.test.ts` (routes): `ownReadyIds` — только свои `ready`, порядок, лимит; `rideableBounds` —
  каталог и свой да, чужой непубличный/не готовый нет, рамка = `boundsOf(линии)`.
- App: `route-ride-format.test.ts` (текст `origin`), `error-messages.test.ts` без изменений; при наличии тестов
  компонентов — «Проверить снова» шлёт `{ activityId }`, `NOT_FOUND` → `recheckMissing`, `activityId: null` — кнопки нет.
- `pnpm arch:check` — новые импорты только через `index.ts`.

**ПОРЯДОК (TDD, коммиты)**
1. Контракты: `ROUTE_RIDE_ORIGINS`, `RouteRideDetail.activityId/origin` + тест схемы → коммит.
2. API деталь: `origin?` в документе, `newRideDoc` (manual), `detail` отдаёт `activityId`/`origin` + int-тест ключей →
   коммит.
3. Рефакторинг: `RouteRideEvaluator` + делегирование в `RouteRideCheckProcessor`, тесты check зелёные → коммит.
4. `tracks`: `insertGrouped` → `newGroup`, событие `tracks.activity-group-created` + int-тест событий → коммит.
5. `routes`: `ownReadyIds`, `rideableBounds` + int-тест → коммит.
6. Политика автопроверки (unit) → репозиторий `ridesByRoute`/`insertChecked` → `RouteRideAutoProcessor`, очередь,
   маршрут outbox, модуль, хелпер `test/route-rides.ts` + int-тесты AC1–AC3, регрессия `results` → коммит(ы).
   Полный `pnpm check` после шага 6.
7. Приложение: «Проверить снова» по `activityId`, строка «Проверен автоматически», i18n → коммит.
8. Документация (§10) → коммит; полный `pnpm check`.

**OUT OF SCOPE**
Уведомления/push об автозаезде, настройка выключения, бэкфилл истории, автопроверка по всему каталогу, «Другие»
(04), участки (05); движок коридора, `CORRIDOR_ENGINE_VERSION`, golden; поведение `results`; `origin` в `RouteRideRow`
и в списке; миграции и новые индексы; правка `@rkarakulov/api-kit`; уборщик сирот.

## 12. Outcome (заполняет coder)

Коммиты (ветка `feature/route-rides-auto-check`, не запушено; хук pre-commit лёгкий — `--no-verify` не применялся):
`c8999700` контракты (шаг 1) · `1bf5bd7b` деталь `activityId`/`origin`, `newRideDoc` (2) · `ad83e181`
`RouteRideEvaluator` (3) · `891e3289` `tracks.activity-group-created` (4) · `8d26a120` `ownReadyIds`/`rideableBounds`
(5) · `13bc9025` автопроверка: политика, репозиторий, `RouteRideAutoProcessor`, очередь, маршрут outbox, хелпер (6) ·
`68ddfcfa` `RouteRideResult` в collection (arch:check) · `34043cd6` приложение и i18n (7) · документация (8).

**Сделано.** §3 п. 1–7 по плану §11: событие владельца `tracks.activity-group-created` (только новая группа, в
транзакции под `lockUserActivities`) → `routeRidesOutboxRoutes` → очередь `route-ride-auto` (параллелизм 1) →
`RouteRideAutoProcessor` (основная группы сейчас → `autoEligible` → `autoPlan` → `rideableBounds` пачками по 25 +
`nearRoutes` → ≤ 20 прогонов общего `RouteRideEvaluator` → только `passed`: повтор проверки активности, заезда группы
и квоты → `insertChecked` с `origin: 'auto'`). `RouteRideDetail.activityId` (основная группы сейчас) и `origin`;
«Проверить снова» шлёт `activityId` детали; «Проверен автоматически».

**AC-12.** Проверено: повторный проход `account.deletion-sweep` (`AccountErasureService.run`, `pass: 'sweep'`, через
`ACCOUNT_POLICY.sweepDelayMs` = 15 мин) выполняет все шаги, включая `route-rides` (`RouteRideErasure.deleteAllOf`).
Перед вставкой автопроверка перечитывает активность (`null` → пропуск, int-тест). Остаточное окно — задача
автопроверки дольше 15 мин между шагами стирания (не наблюдается при ≤ 20 прогонах), принятое ограничение.

**Тесты (добавлено).** Контракт: `activityId`/`origin` по умолчанию, `unknown`. Unit политики: `autoEligible` (спорт,
граница 7 сут ± 1 мс), `autoPlan` (порядок (а)/(б), дедуп, заезд группы, квота 100/99, без живых), `nearRoutes`
(далёкая/невидимая рамка, 20 из 26). Int: `activity-source` — group-created только для новой группы (дубль, перехват,
удаление основной, повтор задачи — без события); `route-ride-routes` — `ownReadyIds`, `rideableBounds`;
`route-ride-auto.int.test.ts` (10 тестов: AC1 passed+сравнение, не пройден, лимит не списан (Redis), process/повтор
события, станок/бег/старше 7 сут/удалённая/чужая, дубль, чужой/снятый/далёкий/квота, 20 из 22 по порядку, гонка
с ручным POST (ворота на `insertChecked`), проигрыш индекса, сбой окружения (не финальная/финальная), скрытие маршрута
и удаление активности во время прогона, маршруты публикатора results vs route-rides); `route-rides.int` — ключи
детали, `activityId` после позднего перехвата, старый документ без `origin`; `route-ride-check.int` — спаи на
эвалюаторе. App: `route-ride.test.tsx` (POST `{ activityId }` без кандидатов, 404 → `recheckMissing`, `null` — без
кнопки, «Проверен автоматически»), `route-ride-format.test.ts`.

**Проверки** (node 24, Mongo `pokatim_rr03_test` на 27117, Redis db 7; полный `pnpm check` не запускался — решение
пользователя):
- `@pokatim/api` int `route-rides, results, tracks, account, achievements, routes` → 48 files, 682 passed; int
  `devices, notifications, disputes, test/` → 32 files, 484 passed; unit → 95 files, 898 passed; `tsc --noEmit` — ок;
  после правки цикла — повторный прогон `route-rides` → 5 files, 52 passed.
- `@pokatim/contracts` test 52/483 passed, typecheck ок; `@pokatim/api-client` 22/169, typecheck ок; `@pokatim/i18n`
  2/15, typecheck ок.
- `@pokatim/app`: `tsc` ок; jest полный — 262/266 suites, 21 падение в несвязанных `calendar-detail`, `race-disputes`,
  `auth-guard`, `register`, `modal-sheet` под параллельной нагрузкой (набор менялся между прогонами); отдельно эти 5 —
  76/76 passed. Затронутые `route-ride*`, `route-rides-block`, `features/route-rides` — 79/79.
- eslint затронутых путей — без замечаний; `pnpm format:check` — ок; `pnpm arch:check` — no dependency violations.

**Процесс.** Шаг 5 (порт `routes`): тест и реализация написаны одним заходом — красная фаза не наблюдалась; остальные
шаги — тест красный → код.

**Риски.** Нагрузка: до 20 прогонов движка на новую активность в отдельной очереди с параллелизмом 1 и общим семафором
потоков; ретрай всей задачи при сбое окружения повторяет отказные прогоны. Остаточное окно «две основные одной
группы» (RC-3) — как у ручной проверки.

**Ревью pass 1 и merge develop (2026-10-31).** Коммиты `64cff2dc` (детерминированный план: маршрут с автозаездом
группы — `done` на своём месте; (а) по живым заездам без заездов группы; свой маршрут с сиротами — в (б); JSDoc
`displayLine`), `7aa82a30` (merge `origin/develop`: fan-out outbox PR #160 — конфликт только в `pokatim-backend.md`),
затем фиксы после merge (JSDoc событий, §8.2, сторож итоговой карты в `src/outbox-routes.test.ts`). TDD: unit
`autoPlan`/`nearRoutes` — 6 красных до правки; int «21 маршрут: ретрай после частичного успеха и повтор — те же 20» —
отрицательное доказательство: со старым правилом (заезд группы блокирует маршрут) ретрай даёт `{ planned: 16, passed: 16 }`
и 21 заезд. Проверки после merge (`pnpm install`, api-kit из lockfile): api `tsc` ок; int `route-rides, routes, tracks,
results, account` — 40 файлов, 541/542 (упал `results-read` RC-5 под параллельной нагрузкой, `Z_BUF_ERROR`; отдельно —
10/10); `outbox-routes.test.ts` + политика — 24/24; eslint `apps/api/src`, `apps/api/test` — чисто; typecheck
contracts и app — ок; `format:check`, `arch:check` — ок. Будущий конфликт: PR #164 (`route-rides` слушает
`tracks.activity-removed`) — те же `route-rides.events.ts` и раздел правил.

**Ревью pass 2 (2026-10-31).** CRITICAL Codex (скан истории сдвигали автозаезды группы) и LOW-1 Claude (слот `done`
вытеснялся новым маршрутом) закрыты: план в данных задачи + исключение заездов группы из агрегата + резерв `done`
первыми (§8.2). LOW-2 — описание плана в `pokatim-backend.md`/`pokatim-db.md` обновлено. TDD: 6 unit `autoPlan`/
`nearRoutes` и 3 int (сценарий Codex: 200 маршрутов истории, 190 невидимы, + 21 свой; ретрай по плану задачи с новым
маршрутом между попытками; резерв `done`) — красные до правки. Отрицательное доказательство: без `$nin` группы в
`ridesByRoute` сценарий Codex — повтор даёт `passed: 10` (новые маршруты). Проверки: int/unit `route-rides`, `route-ride-routes`, `tracks`, `outbox-routes.test.ts` — 11 файлов, 125/125; api
`tsc`, eslint `apps/api/src`+`test`, `arch:check`, `format:check` — ок.

**Ревью pass 3 (2026-10-31).** CRITICAL Codex (повтор события после удаления задачи замещал маршрут с `not_passed`
новым) — план события в `route_ride_auto_plans` (миграция `0046`, TTL, стирание по `userId`); MEDIUM (квота своего
маршрута вне скана) — проверка до отсечения. TDD: оба сценария Codex — красные до правки (`passed: 1` вместо 0;
проверен заполненный маршрут вместо 20-го подходящего). Проверки: `route-rides` + `migrations.int.test.ts` +
`outbox-routes.test.ts` — 7 файлов, 112/112; `account-erasure` шаг `route-rides` — 1/1; api `tsc`, eslint,
`arch:check`, `format:check` — ок.
