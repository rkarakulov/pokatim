# Достижения: push о новом достижении


> **Этот PR — часть N1** (RC-P10): уведомление из сверки `GET`, событие, порт, группа, приложение. Серверная сверка в
> worker, порты источников и миграция `0044` — часть N2, следующим PR (AC3, AC5 — там).
Уровень: task3 (worker/регламент, outbox, уведомления, контракты). Follow-up 3/4 серии
(`docs/tasks/2026-10-30-achievements-levels` — уровни, `docs/tasks/2026-10-31-achievements-seasonal` — сезонные).
Out of Scope v1: «Push-уведомление о новом достижении». Следом — PR M: ручная выдача/отзыв в панели.

## 1. Title

Push и запись в центре уведомлений при получении достижения (новое, новый уровень, сезонное).

## 2. Goal

Райдер узнаёт о новом достижении (или уровне) сразу, а не только при следующем открытии приложения.

### Решения P1–P6 (автор — сессия follow-up, 2026-10-31)

Push:

- **P1 — когда.** Выдача, которая вспыхнула бы (`seen: false`: новое достижение, новый уровень, новое сезонное), —
  ещё и уведомление в центре + push. Тихие выдачи первой сверки (A3), восстановления (A4) и понижения — без
  уведомления. Ручная выдача (PR M) — тоже уведомление, тем же механизмом. Выдача, найденная сверкой в
  `GET /v1/achievements` (райдер сейчас в приложении и видит вспышку), — только запись в центре, без push; найденная
  серверной сверкой (P2) — центр + push.
- **P2 — сверка не только при чтении.** Чтобы push пришёл без открытия приложения, сервер сверяет достижения
  райдеров, у которых недавно изменились факты (протокол опубликован или пересчитан, райд прошёл, заезд по маршруту
  засчитан, снимок сезона пересчитан), — в worker (не в HTTP), той же сверкой, что `GET /v1/achievements`. Райдеры
  без первой сверки (не открывали достижения после выкладки v1) не сверяются сервером — их первая сверка остаётся
  тихой при открытии приложения. Как находить «изменившихся» — решает architect (регламент по курсору времени над
  портами владельцев или события); полный скан всех райдеров — нет (ADR-0020).
- **P3 — один раз.** Уведомление на выдачу — ровно одно (идемпотентно: ключ выдачи + уровень), даже если сверку
  сделали параллельно GET и worker. Вспышка при открытии приложения не отменяется push-ом (A5 как было); открытие
  push → экран достижения.
- **P4 — группа настроек.** Новая группа уведомлений «Достижения» (тумблер push, без e-mail), по умолчанию включена;
  тихие часы и сводка — как у остальных (ADR-0017).
- **P5 — текст.** «Новое достижение: Подиум» / «Новый уровень: Гонщик · Серебро» / «Новое достижение: Чемпион
  сезона — Сезон 2026»; тело — объект («Гонка «…»»). Без ПДн других людей.
- **P6 — старые сборки** незнакомую группу/тип не показывают (tolerant) — центр уведомлений не ломается.

## 4. Out of Scope

- Push для старых выдач (ретро) и для понижений/восстановлений; e-mail о достижениях.
- Ручная выдача/отзыв в панели (PR M).
- Карточка сторис сезонных.

## 5. Architecture Context

Architecture Review (architect, 2026-10-31) — **Status: CONCERNS** (блокеров нет; RC-P1…RC-P10 — в 8.1, решения
оркестратора нужны по RC-P1, RC-P2, RC-P5).

Объём — две части, **рекомендуется два PR** (RC-P10):

- **PR N1 «уведомление о выдаче»** — сверка пишет событие outbox в транзакции с выдачей, notifications принимает его
  (порт `ACHIEVEMENT_NOTICES`), новая группа «Достижения» (подресурс настроек), цель `achievement`, приложение.
  Источник событий — только GET (`origin: 'read'` → центр без push). Закрывает AC1 (GET), AC2, AC4 (через событие
  `origin: 'server'` в int-тесте intake), AC6.
- **PR N2 «серверная сверка»** — worker-модуль `achievements`, регламент по курсорам портов владельцев, задачи по
  райдеру (`origin: 'server'` → центр + push), индекс `route_rides`. Закрывает AC1 (worker), AC3, AC5.

### 5.A Модель (дополнение ADR-0020, не замена)

- **Выдача — по-прежнему проекция фактов.** Сверка одна: `AchievementsService.sync` распадается на
  `AchievementsReconciler.reconcile(userId, origin)` (факты → планы → запись → маркер → результат для ответа) и
  HTTP-обёртку (лимит `achievements-read:<uid>` + сборка `AchievementList`). Worker зовёт тот же `reconcile` без лимита
  пользователя. Копии планов/условий нет.
- **«Уведомление должно быть» = выдача вспыхнула бы, и об этом уровне ещё не сообщали** (P1/P3):
  - `insert` несезонного/сезонного **не в первой сверке** (`seenAt: null`) — уведомление об уровне `level`
    (разовые и сезонные — без уровня);
  - `refresh`/`restore` несезонного — уведомление, только если новый ранг `L` > `notifiedLevel` документа **и** ранг `L`
    не показан (`!isSeen(before, L)`). Это и есть «новый уровень»; смена объекта/даты на том же уровне, понижение,
    возврат на показанный или уже объявленный уровень — тихо (L3, A4);
  - сезонный `restore`, любой `revoke`, **вся первая сверка** (`first === true`, A3) — без уведомления.
- **Новое поле `achievement_grants.notifiedLevel`** (ранг 1–3, монотонно `$max`): наибольший уровень, о котором
  создано событие. Нет поля (документы до выката) ≡ сохранённый `level ?? 1` — ретро-уведомлений нет (Out of Scope).
  Ставится при каждой вставке (`= level`, и в первой сверке — тихо) и в `refresh`/`restore`
  (`$max(ifNull(notifiedLevel, ifNull(level,1)), L)`). Сезонным поле не нужно: уведомление даёт только победитель
  вставки (уникальный индекс), сезонный `restore` всегда тихий.
- **Транзакции (минимально).** Только шаги, которые могут дать уведомление, идут в `MongoTransactions.run` с
  `MongoOutboxWriter.append` (AGENTS §4.5):
  - `insert` (не первая сверка): `insertOne(…, { session })` + `append` в одной транзакции. Дубль уникального индекса
    внутри транзакции её **обрывает** (не транзиентная ошибка) — `isDuplicateKey` ловится **снаружи** `run`
    (транзакция откатилась, события нет) → `false`, как сейчас. Ловить дубль внутри колбэка запрещено (api-kit:
    «ошибки операций внутри не глотать»).
  - `refresh`/`restore` несезонного: `findOneAndUpdate(filter, pipeline, { session, returnDocument: 'before' })` —
    одна условная операция (фильтр прежний: `userId, code, revokedAt`), pipeline пишет `object, factAt, level,
    revokedAt: null, updatedAt, notifiedLevel = $max(...)`; по документу **до** записи решается `due`, и если да —
    `append` в той же транзакции.
  - `insert` первой сверки, `revoke`, сезонные `restore`/`revoke`, маркер, `POST seen` — как сейчас, без транзакции.
  - Замков нет и не нужно: параллельные GET+worker пишут один документ → конфликт записи → драйвер повторяет колбэк
    (`withTransaction`), повтор видит закоммиченный `notifiedLevel`/документ → `due = false`. Первым действием
    транзакции стоит сама условная запись выдачи — чтения-проверки перед ней нет.
- **Вторая линия идемпотентности — схлопывание notifications (N7):** `collapse = { key: 'achievement:<grantId>', seq:
  rank ?? 1 }`. Уникальный `(userId, collapseKey)` и условие `collapseSeq < seq` дают одно уведомление на
  (выдача, уровень) даже при двух событиях; серебро заменяет непрочитанную бронзу и снова непрочитано.
- **Признак источника — в payload:** `origin: 'read' | 'server'` (PR M добавит `'panel'`). Кто выиграл запись, тот и
  задал канал; гонка GET и worker даёт либо центр, либо центр + push — оба исхода допустимы (P1).

### 5.B Событие и приём

- Тип `achievements.grant-noticed` (константа `ACHIEVEMENTS_GRANT_NOTICED` + схема `AchievementsGrantNoticed` в
  `achievements/achievements.events.ts`, экспорт через `index.ts`). Payload — только id и коды, без `userId` и текстов
  (ADR-0017 п. 2): `{ grant: 'fact' | 'season', grantId: Uuid, level: 1|2|3|null, origin: 'read'|'server' }`.
- Маршрут объявляет подписчик: `notificationsOutboxRoutes[ACHIEVEMENTS_GRANT_NOTICED] = notificationsIntake`
  (ребро `notifications → achievements` через `index.ts`; `achievements` о `notifications` не знает — цикла нет).
- Порт `ACHIEVEMENT_NOTICES` (`AchievementNotices.notice(event, now)` → `AchievementNotice | 'gone' | 'state'`) в
  `achievements` (модуль `AchievementsSyncModule`, см. 5.1):
  - читает выдачу по `_id` (свой репозиторий); нет — `gone` (стёрт аккаунт);
  - отозвана, или (несезонная) сохранённый ранг < `event.level`, или код больше не заработан по фактам — `state`;
  - название объекта: несезонное — `AchievementFactsReader.evaluate` + `titled` (тот же источник, что у GET; заодно
    подтверждает факт); сезонное — актуальный итог `RiderSeasonStandings.outcomesOf(userId, [seasonId], now)` +
    `seasonalAchievements` (ключ заработан по `final`-исходу; `pending` — `state`; фикс ревью pass 1);
  - возвращает `{ userId, code, level, object: { kind, title }, seasonId | null }`.
- `NotificationIntake.achievementGranted`: черновик `{ text: { kind: 'achievement_granted', code, level, objectKind,
  objectTitle }, target: { type: 'achievement', code, seasonId? }, collapse, recipients: [userId], inApp: origin ===
  'read' }`. Живость — прежняя `liveUserIds`; отсечка 72 ч — прежняя.
- `initialDelivery(…, { inApp })`: `inApp` → push `skipped`, `reason: 'in_app'`; иначе — тумблер группы, тихие часы,
  лимит 20/ч, сводка — без изменений (P4). Уведомление из GET создаётся **непрочитанным** (RC-P6).

### 5.C Группа «Достижения» и тексты

- `NOTIFICATION_GROUPS` += `'achievements'` (в конец), `NOTIFICATION_KINDS` += `'achievement_granted'` (в конец),
  `KIND_GROUPS.achievement_granted = 'achievements'`; писем нет (`DeliverySettings.email` исключает группу).
- Подресурс `GET|PUT /v1/notifications/settings/achievements` `{ push }` — по образцу `settings/routes` (RC-D1:
  `NotificationSettings` ответа строгий у установленных сборок; `PUT settings` — `$set` известных полей, тумблер
  подресурса не стирается). Хранение — `push.achievements?` в документе настроек; нет поля — `true` (P4, наследования
  нет). Лимит — общий `notifications-settings` 30/ч.
- Тексты (P5) — `notification-texts.ts`; заголовок динамический (сейчас `TITLES[kind]` статичен — нужен вариант с
  функцией для этого вида). Имена кодов и уровней — строки каталога `@pokatim/i18n` (`achievements.<code>.title`,
  `achievements.level.*`, `achievements.object.*`) — как `achievement-card.texts.ts` в `sharing` (RC-P5):
  - ранг ≥ 2 → «Новый уровень: Гонщик · Серебро» (как `isLevelUp` вспышки);
  - иначе → «Новое достижение: Подиум» (счётное на бронзе — «Новое достижение: Гонщик»);
  - тело — объект: «Гонка «…»» / «Маршрут «…»» / «Кофе-райд «…»» / сезонное — см. RC-P5.
- Цель `{ type: 'achievement', code: AchievementCode, seasonId?: Uuid }` → `/achievements/<code>` или
  `/achievements/<code>?season=<id>` (`[code].tsx` уже читает `season`). Старые сборки: `NotificationTargetView` →
  `unknown` (в центре без перехода, push → центр), вид/группа → `'unknown'` (`tolerantEnum`), строка с текстом
  сервера показывается (RC-P8).

### 5.D Серверная сверка (PR N2)

- **Регламент с курсорами по портам владельцев (DV-1 `standings`, курсоры `og.sync`), не события:** fan-out outbox нет
  (ADR-0017 п. 5), `results.*`/`rides.*` уже заняты `notifications-intake`, у «заезд засчитан» и «сезон завершился»
  событий нет. Полного скана нет: только строки, изменившиеся после курсора.
- Очередь `achievements-sync` (`QUEUE.achievementsSync`), `AchievementsWorkerModule`:
  - `achievements.sweep` — расписание `* * * * *` (Europe/Minsk) + разовая `achievements.sweep.boot`; один прогон за раз
    (`concurrency: 1` у sweep — отдельный процессор/имя или проверка в процессоре, как `standings`).
  - `achievements.rider` — `{ userId }`, `concurrency: 4`, `attempts: 3`, backoff экспоненциальный; jobId
    `ach-rider-<uid>-<windowEndMs>` (без `:`): дубли внутри прогона схлопываются, следующий прогон ставит заново.
    Последняя попытка — лог `achievements.server_sync_failed uid=<uid>` + failed-набор BullMQ (видимость как у
    `notifications.fanout_failed`; экрана в панели нет — follow-up).
- Источники (каждый — метод **существующего** порта владельца, keyset `(время, _id)`, страница ≤
  `ACHIEVEMENTS_SERVER_SYNC.pageRows` (500), строки не новее `now − settleMs` (2 мин — запас на коммит транзакции):

  | Факт | Порт / метод | Что читает | Индекс |
  |---|---|---|---|
  | протокол опубликован/пересчитан | `RIDER_RESULTS.revisedRidersAfter(cursor, until, limit)` | `race_recalculations` с `revision ≠ null` по `_id` (uuidv7 = время) → `race_protocol_rows` этой `(raceId, revision)` → `userId` | `_id_`; строки — существующий по `(raceId, revision, …)` (проверить) |
  | райд прошёл (R8: `startsAt < now`) | `RIDER_RIDES.startedRidersAfter(cursor, until, limit)` | `rides { status: 'published', startsAt ∈ (cursor, until] }` → `participants.userId` (организатор — первый участник) | `rides_feed_idx (startsAt, _id)` |
  | заезд по маршруту засчитан | `RIDER_ROUTE_RIDES.passedRidersAfter(cursor, until, limit)` | `route_rides { status: 'passed', checkedAt > cursor }` | **новый** `route_rides_passed_checked_idx (checkedAt, _id)`, partial `status: 'passed'` |
  | снимок сезона пересчитан / сезон завершился | `RIDER_SEASON_STANDINGS.settledRidersAfter(cursor, until, limit)` | заголовки `computedAt ∈ окно` ∪ `finishedSeasons` с `endsBefore ∈ окно` → строки сезона (keyset по `_id` строк) | `season_standing_rows_user_idx (seasonId, userId)` |

  Ключ сортировки общий — расширить `src/changed-since.ts` полем времени (сейчас жёстко `updatedAt`), а не копировать.
- Курсоры — Redis `achievements:cursor:<source>` (как `og:cursor:<kind>`), JSON `{ at, id }`. Нет ключа (первый
  запуск или потеря Redis) — курсор = `now` (без ретро: Out of Scope «push для старых выдач»).
- Прогон: для каждого источника страница → `userId`; затем `IdentityAccounts.liveUserIds` (закрытые аккаунты — нет:
  гонка со стиранием, RC-P7) ∩ `AchievementsRepository.syncedAmong(userIds)` (`achievement_syncs { _id: $in }` —
  райдеры без первой сверки **не** сверяются, P2/AC5) → `Queue.addBulk` задач `achievements.rider` → курсоры
  сдвигаются **после** постановки. Полная страница — продолжение в следующем прогоне (без цикла в одной задаче).
  Сбой источника — лог `achievements.sweep_source_failed source=<s>`, его курсор не двигается, остальные идут; в конце
  — исключение (failed-набор).
- `achievements.rider` → `reconcile(userId, 'server')`. Лог — прежний `achievements.sync … origin=server` (только если
  план не пуст), без кодов и названий.
- Стоимость: прогон — ≤ 4 источника × (1–2 запроса по индексу) + 2 запроса на фильтр; задача — бюджет GET (≤ ~16).

## 5.1 Placement & Reuse Gate

- **Модуль `achievements`** (новых модулей и пакетов нет):
  - `AchievementsCoreModule` — без изменений состава (репозиторий: `notifiedLevel`, `syncedAmong`, `findGrantById`,
    варианты записи с `session`).
  - **новый** `AchievementsSyncModule` — `AchievementsReconciler` и порт `ACHIEVEMENT_NOTICES`; imports `AchievementsCoreModule`,
    `AchievementsReadModule`, `StandingsCoreModule` (`MongoTransactions`/`MongoOutboxWriter` — глобальный
    `MongoOutboxModule`; проверить, что `MongoTransactions` доступен так же, как в `rides`). Его импортируют
    `AchievementsModule` (HTTP), `AchievementsWorkerModule` и `NotificationsWorkerModule`.
  - `AchievementsModule` — `AchievementsService` = лимит + ответ поверх `reconcile`; `StandingsCoreModule` — через
    `AchievementsSyncModule`.
  - **новый** `AchievementsWorkerModule` (PR N2) — очередь, `AchievementsSweep`, процессор, расписание; imports
    `AchievementsSyncModule`, `AchievementsCoreModule`, `IdentityAccountsModule`, `ResultsCoreModule`,
    `RidesCoreModule`, `RouteRidesCoreModule`, `StandingsCoreModule`, Redis. Регистрируется в `worker.module.ts`.
  - `AchievementsReadModule` и `sharing` — без изменений (стандингс им не достаётся).
- **notifications:** новый случай `NotificationIntake`, тексты, группа, подресурс настроек — по образцу «Маршрутов».
- **Владельцы фактов** (`results`, `rides`, `route-rides`, `standings`) — по одному методу в уже существующих портах
  для `achievements`; о `achievements` они не узнают.
- **Reuse / запрещённые дубли:** `reconcilePlan`/`seasonalPlan`/`isSeen`/`storedRank` — единственные; условия «прошёл»
  у райдов и «засчитан» у заездов — только в репозиториях владельцев (рядом с `pastFactsOf`/`passedOf`); keyset —
  `changed-since.ts`; outbox/транзакции — api-kit; доставка, тихие часы, лимит, сводка, схлопывание — notifications как
  есть; имена кодов — каталог `@pokatim/i18n` (RC-P5); путь экрана в приложении — `achievementItemPath`
  (`features/achievements`), не новая сборка строки; подресурс настроек — копия схемы `routes` с `achievements`.
  Своего брокера/событий в app-foundation не требуется (fan-out outbox не нужен).

## 6. Relevant Files

API — `apps/api/src/`:
- `modules/achievements/` — `achievements.service.ts` (разделить), **`achievements-reconciler.ts`** (новый),
  `achievements.repository.ts`, `achievements.collection.ts` (`notifiedLevel`), `achievements.policy.ts` (`noticeDue`,
  чистая), **`achievements.events.ts`**, **`achievement-notices.port.ts` / `achievement-notices.ts`**,
  `achievements.module.ts`, `index.ts`; PR N2: **`achievements-sweep.ts`**, **`achievements-sync.processor.ts`**
  (+ schedules).
- `modules/notifications/` — `notifications.events.ts` (маршрут), `notification-intake.ts`, `notification-texts.ts`,
  `notifications.policy.ts` (группа, `initialDelivery` `inApp`), `notifications.collection.ts` (`push.achievements?`),
  `notification-settings.service.ts`, `notifications.controller.ts` (подресурс), `notifications.module.ts`
  (import `AchievementsSyncModule`).
- PR N2: `modules/results/rider-results.port.ts` + `rider-results.ts` + `results.repository.ts`;
  `modules/rides/rider-rides.port.ts` + `rider-rides.ts` + `rides.repository.ts`;
  `modules/route-rides/rider-route-rides.port.ts` + `rider-route-rides.ts` + `route-rides.repository.ts`;
  `modules/standings/rider-season-standings.port.ts` + `rider-season-standings.ts` (`seasonTitles` из N1 удалён фиксом ревью pass 1);
  `changed-since.ts`; `queues.ts`; `worker.module.ts`; `db/migrations/0044_route_rides_passed_idx.ts` + `index.ts` +
  `migrations.int.test.ts`.

Контракты — `packages/contracts/src/notifications/notification.schema.ts` (+ test): группа, вид, цель, подресурс.

Приложение — `apps/app/src/`: `features/notifications/notification-target.ts` (+ test), `queries.ts` (подресурс),
`app/settings/notifications.tsx` (секция), `packages/i18n/src/ru.ts` (`notifications.settings.group.achievements`),
api-client (`get/updateAchievementNotificationSettings`).

Читать: ADR-0017, ADR-0020, `notifications-intake.int.test.ts` (образец через очередь), `achievements.int.test.ts`
(параллельные GET, отрицательные доказательства), `standings-sync.processor.ts` (расписание), `og-sync.processor.ts`
(курсоры Redis), `rides.service.ts#writeWithEvent` (условная запись + outbox).

## 7. Implementation Notes

### 7.1 Контракты (обратная совместимость)

- Только добавления в конец: `NOTIFICATION_GROUPS`, `NOTIFICATION_KINDS`, вариант `NotificationTarget`. Ответы
  разбираются `tolerantEnum` и `NotificationTargetView` — старые сборки не падают (есть тест контракта на «новая
  группа/вид/цель → `unknown`»).
- `NotificationSettings` (строгий) **не меняется**. Новые `AchievementNotificationSettingsView = z.object({ push })`,
  `UpdateAchievementNotificationSettings = z.strictObject({ push: Toggle })`, `DEFAULT_ACHIEVEMENT_NOTIFICATION_SETTINGS
  = { push: true }`.
- Цель: `z.object({ type: z.literal('achievement'), code: AchievementCode, seasonId: Uuid.optional() })`; строгий
  `AchievementCode` — незнакомый будущий код у старой сборки уходит в `unknown` (без перехода).
- `Achievement*` схемы не меняются.

### 7.2 Политика и репозиторий

- `noticeDue(before, L)` — чистая функция: `!isSeen(before, L) && (before.notifiedLevel ?? storedRank(before)) < L`.
- `insertGrant(…, session?)` пишет `notifiedLevel: level`; `restoreOrRefresh(…, session)` → `findOneAndUpdate`
  pipeline с `returnDocument: 'before'` (одна операция; поля v1 — `$ifNull`).
- `insertSeasonal(…, session?)` — как сейчас + сессия.
- `findGrant(kind, grantId)` для порта, `syncedAmong(userIds)` для sweep. Все фильтры — с `userId` или `_id` своей
  коллекции; запись — только этот репозиторий.
- Стирание (`deleteAllOf`) — без изменений; событие в outbox после стирания даёт `gone`.

### 7.3 Сверка

- `reconcile(userId, origin)`: как текущий `sync` до сборки ответа; шаги `insert`/`refresh`/`restore` при `!first`
  — через `writeWithNotice` (транзакция + `append` при `due`); результат — то, что нужно HTTP-обёртке
  (`titled`, `progress`, `seasonal`, `outcomes`) — чтобы не читать факты дважды.
- Лог — прежний + `origin` и `noticed=<n>`.

### 7.4 Приложение

- `notificationTargetPath`: `achievement` → путь через `achievementItemPath`-эквивалент (`/achievements/<code>` /
  `?season=<id>`); код — из схемы, адресов из push не принимаем.
- Настройки: секция «Достижения» (только push) последней; запрос подресурса, 404 → секции нет
  (`isSettingsResourceMissing`), скелетон/ошибка — как у «Маршрутов».
- Центр уведомлений и вспышка не меняются: открытие push → экран → обычный GET (вспышка остаётся, A5).
- Все платформы: web — без push (центр), PWA с Web Push — тот же канал (ADR-0022).

### 7.5 Security checklist (зоны: `worker.module.ts`, `db/**` — `security.md`; `rides/**` — `pokatim-security.md`)

1. **AuthN/AuthZ:** подресурс `settings/achievements` — `AuthGuard`, только свой документ (`userId` сессии). Worker и
   intake не принимают ввод пользователя; получатель — владелец выдачи из порта, не из payload.
2. **Входные данные:** `UpdateAchievementNotificationSettings` строгий; payload события разбирается zod
   (`invalid_payload` → skip); `origin` — enum. Клиент не влияет на выдачу, уровень и канал (серверный авторитет).
3. **Данные наружу:** payload — id и коды без `userId`/текстов; текст — название своего объекта (гонка/маршрут/райд/
   сезон), без чужих ПДн (N12); цель — белый список, `seasonId`/код по схеме.
4. **Злоупотребления:** лимит `notifications-settings` 30/ч; push ≤ 20/ч и тихие часы (ADR-0017); серверная сверка
   ограничена страницей источника и `settleMs`; GET-лимит не обходится (worker — свой путь, не HTTP).
5. **Логи:** uid и счётчики, без кодов объектов, названий, e-mail.
6. **Аудит:** не требуется (производная проекция, не решение человека); ручная выдача — PR M.
- Стирание аккаунта: шаг `achievements` прежний; закрытые аккаунты отфильтрованы в sweep (`liveUserIds`) и в intake.

### 7.6 Test matrix

| Уровень | Что | Где |
|---|---|---|
| unit | `noticeDue`: insert/refresh вверх/понижение/возврат на показанный/на объявленный/legacy без `notifiedLevel`/первая сверка | `achievements.policy.test.ts` |
| unit | тексты: разовое, счётное бронза, серебро/золото, сезонное, объект каждого вида; без чужих ПДн | `notification-texts.test.ts` |
| unit | `initialDelivery` `inApp` → `skipped/in_app`; группа выключена → `disabled`; `groupOf` | `notifications.policy.test.ts` |
| unit | контракт: группа/вид/цель → `unknown` у старого разбора; подресурс строгий | `notification.schema.test.ts` |
| unit | `notificationTargetPath` `achievement` (обычное, `?season=`), битый код/seasonId → `null` | `notification-target.test.ts` |
| int (Mongo RS) | AC1: новая выдача после первой сверки → ровно одно событие и одно уведомление; повторный GET — нет; **параллельные `reconcile('read')` × N + `reconcile('server')`** → одно событие (`outbox.count`) и одно уведомление | `achievements.int.test.ts` |
| int | AC2: первая сверка, восстановление, понижение, смена объекта — `outbox` пуст | `achievements.int.test.ts` |
| int | уровень: бронза → серебро → одно событие `level: 2`; серебро → бронза → серебро — второго нет | `achievements.int.test.ts` |
| int | **отрицательные доказательства**: (а) событие вне транзакции (append после коммита, сбой между) — выдача есть, события нет; (б) дубль ловится внутри колбэка — транзакция не откатывается/ошибка драйвера; (в) без условия `notifiedLevel` — два события при параллели. Каждое — подменой репозитория в тесте, ожидаемо красное | `achievements-notices.int.test.ts` |
| int | intake: событие → уведомление, `group: 'achievements'`, цель, коллапс; `origin: 'read'` → `push skipped in_app`; `server` + группа выключена → центр без push (AC4); отозвана → `state`; стёрта → `gone`; два события одного уровня → одно уведомление | `notifications-intake.int.test.ts` |
| int | подресурс `settings/achievements`: GET по умолчанию `true`, PUT, `PUT settings` старой формы не стирает тумблер; 401; лимит | `notifications.int.test.ts` |
| int (N2) | AC3: протокол опубликован → `achievements.sweep` → `achievements.rider` (реальные очереди) → push в фейковом Expo | `achievements-sync.int.test.ts` |
| int (N2) | AC5: райдер без маркера, закрытый аккаунт, строки до курсора/новее `settleMs` — не ставятся; ставятся только райдеры изменившихся фактов (счёт задач = ожидаемым) | `achievements-sync.int.test.ts` |
| int (N2) | каждый источник: keyset/страница/продолжение; нет курсора → `now`; сбой источника не двигает его курсор | порты владельцев + sweep |
| int (N2) | миграция `0044`: индекс с partial | `migrations.int.test.ts` |
| app | секция «Достижения»: есть/404 скрыта/переключение; нажатие уведомления `achievement` → экран | `__tests__/…`, `push.test.ts` |
| e2e | нет (push не проверяется в Playwright); смоук центра — существующий | — |

## 8.1 Requirements Consistency (architect)

P1–P6 приняты; изменения предлагаются только там, где указана причина.

- **RC-P1 (MEDIUM, P2 × R8) — push за кофе-райд приходит в момент старта.** «Райд прошёл» в фактах = `startsAt < now`
  (R8, `pastFactsOf`), значит серверная сверка выдаст «Первый кофе-райд» / уровень «Завсегдатая» в минуту старта —
  посреди поездки. Варианты: (a) как GET — в момент старта; (b) **только источник райдов в sweep смещён:
  `until = now − ACHIEVEMENTS_SERVER_SYNC.rideSettleMs` (3 ч)** — push после поездки; если райдер откроет приложение
  раньше, будет вспышка и запись в центре без push (P1); (c) сменить R8 — вне рамок. **Рекомендация: (b)** (константа,
  без изменения правил выдачи).
- **RC-P2 (MEDIUM, P5) — текст сезонного дублирует сезон.** По P5 заголовок «Новое достижение: Чемпион сезона — Сезон
  2026», тело — объект «Сезон «Сезон 2026»» — повтор, и заголовок длинный (push на iOS обрезает ~40–50 символов).
  Варианты: (a) **заголовок «Новое достижение: Чемпион сезона», тело «Сезон «Сезон 2026»»** — как у остальных (имя в
  заголовке, объект в теле); (b) по P5 буквально + тело «Итоги сезона подведены.»; (c) по P5 + тело-объект (повтор).
  **Рекомендация: (a)**; P5 меняется только с согласия оркестратора/человека.
- **RC-P3 (LOW, P1) — восстановление на более высоком уровне.** P1: «восстановления — без уведомления». Но
  восстановленная выдача на ранге выше показанного вспыхнет «Новый уровень» (L3). Правило «вспыхнула бы и не
  объявлялось» → уведомление. Варианты: (a) **уведомлять (как вспышка)**; (b) любое `restore` — тихо (вспышка без
  push). **Рекомендация: (a)**; восстановление на прежнем/показанном уровне — тихо, как в P1.
- **RC-P4 (LOW) — массовая выдача при завершении сезона.** Сезон становится `final` в полночь по Минску (или после
  последнего протокола) — уведомления всем райдерам сезона сразу. Тихие часы 22–8 отложат push до утра одной сводкой;
  intake — по задаче на выдачу. Принять; размер — сотни, в пределах `fanout`-нагрузки.
- **RC-P5 (LOW, ADR-0017 п. 3) — откуда имена кодов.** ADR-0017: текст — «словарь модуля, не `@pokatim/i18n`».
  Варианты: (a) **имена кодов/уровней/объектов — строки каталога `@pokatim/i18n`** (прецедент
  `sharing/achievement-card.texts.ts`; снимок по-прежнему рендерит сервер при создании); (b) копия в
  `notification-texts.ts` с `satisfies Record<AchievementCode, string>` (второй каталог). **Рекомендация: (a)**,
  отметить в ADR-0017 как уточнение.
- **RC-P6 (LOW, P1) — уведомление из GET непрочитано.** Райдер видит вспышку и одновременно +1 на колокольчике.
  Варианты: (a) **непрочитанное (как все; без особых случаев в notifications)**; (b) сразу прочитанное (`readAt =
  createdAt`) — меньше шума, но запись не выделена. **Рекомендация: (a)**.
- **RC-P7 (LOW) — гонка серверной сверки и удаления аккаунта.** Задача `achievements.rider`, начатая до закрытия
  аккаунта, может записать выдачу после шага стирания `achievements`. Меры: `liveUserIds` в sweep и в intake
  (уведомления не будет). Остаток — осиротевшие выдачи закрытого аккаунта (без ПДн, кроме `userId`); принять, отметить
  в ADR-0020; альтернатива — повтор шага `achievements` регламентом `account.erasure-resume` (вне рамок).
- **RC-P8 (LOW, P6) — формулировка.** Старые сборки строку **показывают** (текст — снимок сервера, вид и группа —
  `unknown`), но не переходят: в центре без перехода, push открывает центр. Центр и настройки не ломаются (AC6).
  Поправить формулировку P6 в `notifications.md`.
- **RC-P9 (MEDIUM) — push — «не больше одного», а не «ровно один».** Push теряется, если: коммит факта позже
  `settleMs`; задача райдера не поставилась; потерян курсор Redis. Запись в центре при этом появится на следующем GET
  (`origin: 'read'`, без push). Варианты: (a) **принять; потеря курсора → старт с `now − 10 мин`** (небольшая
  перекрышка, сверка идемпотентна); (b) курсоры в Mongo (своя коллекция в миграции) — надёжнее, но лишняя коллекция при
  самолечащемся исходе. **Рекомендация: (a)**; AC1 «одно уведомление» гарантируется (транзакция + схлопывание), push —
  best effort.
- **RC-P10 (MEDIUM) — объём.** Одним PR — контракты, notifications, приложение, четыре порта владельцев, worker,
  миграция. **Рекомендация: два PR** (N1 — уведомление из GET + группа + приложение; N2 — серверная сверка), task.md
  один; N1 выкатывается сам по себе (центр без push), N2 включает push. Альтернатива — один PR (дольше ревью, общий
  откат).
- Миграции: в `origin/develop` последняя — `0042_profile_report_reasons`, `0043_achievements_seasonal` занят PR #153.
  N1 миграции не требует (поле `notifiedLevel` без индекса, `$ifNull`). N2 — `0044_route_rides_passed_idx` (только
  expand); перед мержем проверить номер ещё раз.
- Противоречий с инвариантами нет: outbox в транзакции (§4.5), тяжёлое — в worker, сервер решает выдачу и канал.

## 8.2 Решения и отклонения реализации

Решения оркестратора: RC-P1 (b) — для N2; RC-P2 (a) — заголовок «Новое достижение: Чемпион сезона», тело «Сезон
«…»»; RC-P5 (a) — имена из каталога `@pokatim/i18n`; остальные RC — по рекомендации architect (RC-P3 (a), RC-P6 (a),
RC-P8, RC-P9 (a), RC-P10 — два PR).

Отклонения N1 (coder, 2026-10-31):

- **`noticeDue` — только для `refresh`/`restore`** (формула 7.2); вставка не в первой сверке уведомляет всегда — это
  решает сверка (`AchievementsReconciler.apply`), не функция.
- **Порт `ACHIEVEMENT_NOTICES` строже 5.B:** несезонная — `state` и тогда, когда ранг по фактам ниже ранга события;
  сезонная — `state`, если ключ `code:seasonId` не заработан по `final`-исходу `outcomesOf` или сезон `pending` (фикс
  ревью pass 1; было — «сезона нет среди завершённых», `seasonTitles`).
- **`inApp` важнее `push_off`:** `reason: 'in_app'` при любом состоянии канала (в центр без push по замыслу P1).
- **Service worker:** цель `achievement` добавлена и в копию белого списка SW (`scripts/service-worker.ts`) — иначе
  Web Push открывал бы центр; коды — `SW_ACHIEVEMENT_CODES` (генератор SW запускается Node без сборки пакетов),
  равенство с `ACHIEVEMENT_CODES` и паритет путей держит `notification-target.test.ts`.
- **Reuse пути экрана:** из `achievementItemPath` выделен `achievementPath(code, seasonId)` (им собираются оба пути);
  цель уведомления не строит строку сама.
- **Экран настроек:** разметка группы «Маршруты» вынесена в общий `PushOnlyGroup` («Маршруты» и «Достижения» — одна
  форма `{ push }`), поведение «Маршрутов» не менялось (тесты прежние).
- **Отрицательное доказательство (б)** — детерминированно, последовательно: проигравшая сверка получает снимок плана
  до вставки победившей (подмена `listOf` на один вызов) → её вставка даёт дубль в транзакции. С перехватом дубля внутри
  колбэка сервер уже оборвал транзакцию: следующая операция (событие) падает `NoSuchTransaction`, драйвер повторил бы
  колбэк до таймаута `withTransaction` (120 с) — ворота теста останавливают повтор после первого отказа, результат —
  500 и `NoSuchTransaction`. Параллельные GET вместо снимка давали недетерминированный исход (то 500, то повтор до
  таймаута).
- **Отрицательное доказательство (в):** подмена `restoreOrRefresh` возвращает «документ до записи» из снимка плана
  (бронза, ничего не объявлено) — параллельные сверки дают больше одного события; центр схлопывает их в одно
  уведомление (вторая линия, N7) — это тоже проверяется.
- `push.test.ts` приложения не менялся: путь нажатия push — `pushTargetPath` (unit + паритет SW в
  `notification-target.test.ts`).

## 9. Acceptance Criteria

- AC1. Новая выдача после первой сверки (GET или worker) → одно уведомление в центре + push; повторная сверка и
  параллельные GET+worker — не дублируют (int).
- AC2. Тихие: первая сверка, восстановление, понижение — без уведомления.
- AC3. Protocol published → worker сверяет участников без открытия приложения → push (int через очередь).
- AC4. Группа «Достижения» выключена → в центре есть, push нет (как у групп N4).
- AC5. Серверная сверка не трогает райдеров без первой сверки и не пересчитывает всех (тест на выборку).
- AC6. Приложение: открытие push/уведомления → экран достижения; группа «Достижения» в настройках; старые ответы
  не ломают центр уведомлений и настройки.
- AC7. `pnpm check` зелёный; документы: `profile.md`, `notifications.md` (N3/N4), ADR-0020 (серверная сверка для
  push), ADR-0017 (новый источник), `.claude/rules`.

## 10. Documentation Impact

- **ADR-0020** — «Дополнение: push (achievements-push)»: сверка = `reconcile(origin)` в GET и в worker; шаги
  выдачи, которые могут дать уведомление, — транзакция с outbox (`revoke`, маркер, `seen` — прежние операции без
  транзакции); `notifiedLevel`; регламент `achievements.sweep` по курсорам портов (почему не события); только райдеры
  с маркером; RC-P7, RC-P9. Следствие «нет push без отдельного механизма» снять.
- **ADR-0017** — новый источник `achievements.grant-noticed` (14 → 15 типов), шестая группа «Достижения» (подресурс
  `settings/achievements`, только push), цель `achievement`, `reason: 'in_app'`, RC-P5 (имена из каталога).
- **`docs/product/notifications.md`** — N3 (событие), N4 (шесть групп), N10 (цель), тексты, P6 (RC-P8).
- **`docs/product/profile.md`** — раздел достижений: push и центр (P1–P6), когда без push.
- **`.claude/rules/pokatim-backend.md`** — «Достижения» (модули `AchievementsSyncModule`, `AchievementsWorkerModule`,
  убрать «Worker-модуля, очередей, outbox и регламента нет», ребро `StandingsCoreModule`), «Уведомления» (15 типов,
  группа, `in_app`), «Очереди» — `achievements-sync`.
- **`.claude/rules/pokatim-db.md`** — `notifiedLevel`, индекс `route_rides_passed_checked_idx`.
- **`.claude/rules/pokatim-contracts.md`**, **`pokatim-app.md`** — группа, цель, секция настроек.
- `apps/api/src/queues.ts` (комментарий очереди), `pr.md` — миграция `0044` (N2), новая очередь и расписание.

## 11. Implementation Context

ENTRY POINTS: `AchievementsService.sync` → `AchievementsReconciler.reconcile`; `NotificationIntake.drafts`
(`ACHIEVEMENTS_GRANT_NOTICED`); `NotificationsController` (подресурс); PR N2 — `AchievementsSyncProcessor`
(`achievements.sweep`, `achievements.rider`).

FILES TO MODIFY / READ — раздел 6.

TYPES & SCHEMAS: `AchievementsGrantNoticed` (achievements), `AchievementNotices`/`AchievementNotice` (порт),
`NoticeDraft.inApp`, `NoticeText` `achievement_granted`, контракты 7.1, методы портов владельцев 5.D.

TESTS — 7.6.

OUT OF SCOPE — раздел 4; экран сбоев серверной сверки в панели; fan-out outbox.

Порядок TDD (каждый шаг — сначала красный тест):

PR N1
1. Контракты: группа, вид, цель, подресурс (+ тест «старый разбор → `unknown`»).
2. `noticeDue` (unit), затем репозиторий: `notifiedLevel`, `findOneAndUpdate` `before`, сессии (int).
3. `AchievementsReconciler` вынести из сервиса без смены поведения — существующий `achievements.int.test.ts` зелёный.
4. Транзакция + outbox в шагах `insert/refresh/restore` (int AC1/AC2/уровни; параллель N × GET + `server`);
   отрицательные доказательства (а)–(в) — красные на подменах.
5. Порт `ACHIEVEMENT_NOTICES` (сезонная — `outcomesOf` + `seasonalAchievements`), `gone/state` (int).
6. notifications: маршрут, `achievementGranted`, тексты (unit), `initialDelivery` `inApp`, группа, подресурс (int AC4).
7. Приложение: цель → экран, секция настроек, i18n, api-client.
8. Документы (раздел 10, без частей N2), `pnpm check`.

PR N2
1. `changed-since.ts` с полем времени (unit).
2. Методы портов владельцев + миграция `0044` (int на каждом, keyset и страница).
3. `AchievementsSweep`: курсоры, `settleMs`/`rideSettleMs`, `liveUserIds` ∩ `syncedAmong`, постановка (int AC5).
4. Процессор, расписание, `worker.module.ts`, очередь (int AC3 через реальные очереди до фейкового Expo).
5. Документы N2, `pnpm check`.

## 12. Outcome

### N1 — уведомление о выдаче из сверки `GET /v1/achievements` (2026-10-31)

Сделано:

- Контракты: группа `achievements`, вид `achievement_granted`, цель `achievement` (`code`, `seasonId?`), подресурс
  `AchievementNotificationSettingsView` / `UpdateAchievementNotificationSettings` / `DEFAULT_…` (+ тест «старый разбор
  → `unknown`»); api-client `get/updateAchievementNotificationSettings`.
- `achievements`: `noticeDue` (политика), `notifiedLevel`, `insertGrantInTx` / `insertSeasonalInTx`,
  `restoreOrRefresh` → `findOneAndUpdate` pipeline (`returnDocument: 'before'`), `findGrant`; `AchievementsReconciler`
  (`reconcile(userId, origin)`, транзакция + outbox только у шагов с событием; `origin: 'server'` готов для N2, вызывающего
  пока нет); `AchievementsService` — лимит + ответ; событие `achievements.grant-noticed`; порт `ACHIEVEMENT_NOTICES`;
  `AchievementsSyncModule`. `standings`: `RIDER_SEASON_STANDINGS.seasonTitles` (удалён фиксом ревью pass 1).
- `notifications`: маршрут события, `achievementGranted` (цель, схлопывание `achievement:<grantId>` по рангу, `inApp`
  при `origin: 'read'`), `initialDelivery(…, { inApp })` → `skipped/in_app`, группа и `KIND_GROUPS`, тексты (заголовок
  — функция, имена из каталога), подресурс `GET|PUT settings/achievements` (`push.achievements`, нет поля — включено).
- Приложение: цель → `/achievements/<код>` (`?season=`), в т. ч. в service worker; секция «Достижения» (только push,
  последней; 404 — секции нет); строка i18n.
- Документы: ADR-0017 (дополнение + RC-P5), ADR-0020 («Дополнение: push»), `notifications.md` (N3, N4, N10, P6, тексты),
  `profile.md`, `.claude/rules/pokatim-{backend,db,contracts,app}.md`.

Отрицательные доказательства (`achievements-notices.int.test.ts`; механизм убран подменой — тест показывает нарушение
по результату):

- (а) вставка выдачи вне транзакции события + сбой `append` → выдача есть, события нет навсегда (`{ grants: 1, events: 0 }`);
  с транзакцией — сбой откатывает выдачу, следующий GET выдаёт с событием (`{ grants: 1, events: 1 }`).
- (б) дубль уникального индекса глотается внутри колбэка → `NoSuchTransaction` на записи события, 500; с перехватом
  снаружи `run` — проигравшая сверка 200 без второго события.
- (в) решение о событии по снимку плана, а не по документу до записи в транзакции → параллельные `reconcile` × 3 дают
  > 1 события (центр схлопывает в одно); с механизмом — ровно одно.
- Гонки AC1 (`achievements.int.test.ts`): `reconcile('read')` × 4 + `reconcile('server')` с воротами на чтении — одна
  выдача, одно событие, одно уведомление на код; то же при повышении до серебра — одно событие `level: 2`.

Не входит в N1 (N2): worker и регламент `achievements.sweep`, методы портов источников, миграция `0044`, push без
открытия приложения (AC3, AC5).

### Фиксы ревью pass 1 (2026-10-31; `findings-claude.md`, `findings-codex.md`)

- **MEDIUM (оба ревьюера) — сезонная выдача перепроверяется по актуальному итогу.** `AchievementNoticesService.notice`:
  сезонная ветка — `RIDER_SEASON_STANDINGS.outcomesOf(userId, [seasonId], now)` → `seasonalAchievements`; ключ
  `code:seasonId` не заработан по `final`-исходу — `state`; сезон `pending` (ревизия протокола без пересчёта снимка) —
  тоже `state` (решение: безопасная сторона, без ложного «Новое достижение»; приём события не повторяется — если
  чемпионство подтвердится, сверка уже держит выдачу, а уведомление не придёт — допустимо: экран покажет достижение).
  Название — из исхода. `RiderSeasonStandings.seasonTitles` стал мёртвым — удалён (порт, реализация, int-тест).
  TDD: int «сезонная: пересчёт снимка отнял место до приёма события (без промежуточного GET) — state, уведомления нет;
  ревизия без пересчёта (`pending`) — state» (`achievements-notices.int.test.ts`) — до правки красный (порт вернул
  уведомление на `pending`), после — зелёный; положительный контроль — «Призёр сезона» уведомлён.
- **LOW — тест «старая сборка» проверяет цель:** имитация подменяет и `target` на белый список без `achievement` +
  прежний структурный fallback; `parsed.target` → `{ type: 'unknown' }`, заголовок и тело сервера сохранены.
- **LOW — `inApp` через пачки:** unit `planFanout` — флаг в каждой пачке, проходит `FanoutJobData` и план
  `IntakeJobData`; без флага ключа нет.
- **LOW — `pokatim-security.md` («Достижения»):** GET пишет и события outbox `achievements.grant-noticed` (payload —
  id и коды, без `userId` и ПДн; получатель — из выдачи через порт). Также `pokatim-backend.md` и ADR-0020 — сезонная
  перепроверка вместо `seasonTitles`.
