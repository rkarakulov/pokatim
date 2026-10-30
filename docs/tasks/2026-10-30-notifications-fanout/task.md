# Уведомления: раскладка большого события пачками и группа «Маршруты» (task3)

## 1. Title

Intake уведомлений раскладывает событие с большой аудиторией на задачи-пачки получателей; группа настроек
«Маршруты» (подресурс `settings/routes`).

## 2. Goal

1. **Пачки получателей.** Сейчас `notifications-intake` пишет все уведомления события одной задачей (протокол гонки —
   сотни участников, пачки по 500 внутри задачи): долгая задача, сбой на любой пачке повторяет всё событие. Событие
   с аудиторией больше одной пачки intake раскладывает на задачи-пачки (`notifications.fanout`) в той же очереди:
   время задачи ограничено размером пачки, ретрай — только упавшей пачки, повтор не создаёт дублей.
2. **Группа «Маршруты».** Решения по заявке своего маршрута (`route_published`, `route_rejected`) переезжают из группы
   «Райды» в новую группу «Маршруты» с тумблером push (писем у группы нет, N2). Решение координатора по
   `[ASSUMPTION]` N4 (2026-10-28) — «Маршруты» отдельной группой.

## 3. Scope

- `notifications` (api): раскладка в `NotificationsIntakeProcessor`, задача `notifications.fanout`, доставка по
  уведомлениям пачки; группа `routes` в политике; подресурс `GET|PUT /v1/notifications/settings/routes`.
- `contracts`: `routes` — в конец `NOTIFICATION_GROUPS`; `RouteNotificationSettingsView`,
  `UpdateRouteNotificationSettings`, `DEFAULT_ROUTE_NOTIFICATION_SETTINGS`; api-client
  `getRouteNotificationSettings` / `updateRouteNotificationSettings`.
- `app`: блок «Маршруты» на `/settings/notifications` (тумблер push), хуки запроса, i18n ru.
- Документы: N3/N4 `docs/product/notifications.md`, ADR-0017 (дополнение), правила `pokatim-backend.md`,
  `pokatim-db.md`, `pokatim-contracts.md`, `pokatim-app.md` (если есть раздел).

## 4. Out of Scope

- **Outbox fan-out «тип события → несколько очередей»** (ADR-0017 п. 5) — правка `@rkarakulov/api-kit` в
  app-foundation, релиз и обновление каталога: отдельная задача (§12 follow-up).
- Новые события маршрутов (заезды по маршруту, райды по маршруту) — в спеке N3 их нет.
- Файлы `apps/app/src/features/notifications/push-soft-prompt*` (идёт отдельно).
- Письма группы «Маршруты», панель failed-доставок.

## 5. Architecture Context

- Очередь та же — `notifications-intake`; имена задач: тип события (outbox, как сейчас) и `notifications.fanout`
  (пачка). Новых очередей, коллекций и индексов нет.
- Доставка: `DeliveryJobs.scheduleEvent(eventId)` читает все `pending` события — у пачки нужен вариант по
  получателям пачки.
- Группа хранится в документе уведомления (`group`) — доставка читает тумблер по ней; уже записанные `route_*` с
  `group: 'rides'` остаются в «Райдах» (снимок).
- Настройки: `notification_settings.push.routes` — без миграции; ответ `/settings` не меняется (RC-D1: строгий
  разбор у старых сборок) — подресурс, как «Мероприятия».

## 5.1 Placement & Reuse Gate

- Reuse: `writeDraft` (живые получатели, настройки пачкой, `writeNotices`), `DeliveryJobs.ensure`, образец подресурса
  `settings/events` (контроллер, сервис, `saveEventSettings`, контракт, api-client, хуки и блок `EventsGroup` в app).
- Всё — внутри `notifications`; источники не меняются.

## 6. Relevant Files

- `apps/api/src/modules/notifications/{notifications-intake.processor.ts,notifications.events.ts,delivery-jobs.ts,notifications.repository.ts,notifications.policy.ts,notification-settings.service.ts,notifications.controller.ts}`
- `packages/contracts/src/notifications/notification.schema.ts`, `packages/api-client/src/*notifications*`
- `apps/app/src/app/settings/notifications.tsx`, `apps/app/src/features/notifications/*settings*` (хуки), i18n ru.
- Тесты: `notifications-intake.int.test.ts`, `notifications.int.test.ts`, `notifications.policy.test.ts`,
  `notification.schema.test.ts`, тест экрана настроек (если есть).

## 7. Implementation Notes

- **Порог.** Аудитория события (сумма уникальных получателей черновиков) ≤ `fanoutChunk` — как сейчас, одной
  задачей. Больше — пачки. Размер пачки — `NOTIFICATIONS_POLICY.fanoutChunk` (architect: ~200).
- **Данные пачки** — то, что intake уже посчитал: снимок текста (`kind`, `title`, `body`), цель, `collapse`, цели
  получателей пачки (`targets` — только её получатели), `userIds` пачки, `eventId`. Порты источников в пачке не
  перечитываются: состав и границы пачек фиксируются один раз.
- **Идемпотентность.** jobId пачки — детерминированный от `eventId`, номера черновика и номера пачки (без `:`).
  Все пачки ставятся одной атомарной операцией (`addBulk`): повтор intake после постановки — те же jobId, BullMQ их
  не дублирует; повтор до постановки — новый расчёт и та же атомарная постановка. Запись — прежний `writeNotices`
  (уникальность `(sourceEventId, userId)`, схлопывание) — повтор пачки дублей не даёт.
- **Доставка** пачки — только по её получателям (`pendingDeliveriesOf(eventId, userIds)`), те же детерминированные
  jobId доставки.
- **Возраст.** Пачка — та же отсечка 72 ч по id события (задача, застрявшая в ретраях дольше, не будит людей
  вчерашним событием) — architect подтверждает или отклоняет.
- **Группа «Маршруты».** `KIND_GROUPS`: `route_*` → `routes`. `DeliverySettings.push.routes`; e-mail у группы нет.
  Нет поля `push.routes` в документе настроек — **значение `push.rides`** (райдер, выключивший «Райды», раньше не
  получал push о решении по маршруту — после выката не начнёт); нет документа — включено. `PUT settings/routes` —
  `$set push.routes`, лимит `notifications-settings`.
- **App.** Блок «Маршруты» как «Мероприятия», только push; старый сервер без подресурса (404) — блок скрыт.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` Нет `push.routes` — наследует `push.rides` (см. §7).
- `[ASSUMPTION]` «Маршруты» — пятая группа, порядок на экране: после «Райдов».
- Риск: старые сборки видят `group: 'routes'` в центре как `unknown` (`tolerantEnum`) — группа в центре не
  показывается, вреда нет.
- Риск: данные пачки в Redis — id получателей и снимок текста (без ПДн по N12; коды билетов — не секрет без входа, T2).

## 8.1 Requirements Consistency

ADR-0017 п. 5 называет fan-out раскладку по очередям (app-foundation); здесь — раскладка по получателям внутри
`notifications`. Термин в документах разводится: «пачки получателей» vs «fan-out outbox».

**Architect (2026-10-30):**

- **RC-F1 — `Queue.addBulk` не атомарен (BullMQ 6.4.0).** §7 опирается на «все пачки одной атомарной операцией
  (`addBulk`)». В установленной версии `Queue.addBulk` → `Job.createBulk` → `RedisQueueBackend.addJobs` — это
  `client.pipeline()`, **не** `MULTI` (`node_modules/bullmq/dist/esm/classes/redis-queue-backend.js:480`): обрыв
  соединения может оставить часть пачек. Атомарен только `FlowProducer.addBulk` → `backend.addFlow` (`client.multi()`,
  там же `:507`; в JSDoc: «either it fails and no jobs will be added, or it succeeds and all jobs will be added»).
  Альтернативы: (a) `FlowProducer.addBulk` плоскими узлами без `children` (MULTI) + сторож «пачки уже поставлены»
  перед портами; (b) `Queue.addBulk` без сторожа — повтор intake пересчитывает и доставляет недостающие jobId
  (существующие BullMQ не дублирует: `handleDuplicatedJob` возвращает тот же id), но при выросшей аудитории ставит
  **новые** пачки (нарушает AC3 «новых задач-пачек нет»; дублей уведомлений нет — уникальный индекс); (c) свой Lua/MULTI
  по внутренним скриптам BullMQ — хрупко. **Рекомендация: (a)** — реализует ровно §7 и AC3. Цена: регистрация
  `BullModule.registerFlowProducer` и явные опции задач (`FlowProducer` не применяет `defaultJobOptions` очереди —
  берём `intakeQueue.defaultJobOptions`, см. §11).
- **RC-F2 — наследование `push.routes ← push.rides` «живое».** Пока райдер не трогал «Маршруты», переключение «Райды»
  (в т. ч. в старой сборке) меняет и «Маршруты» — это и есть ожидаемое поведение для старых сборок (раньше `route_*`
  были в «Райдах»). Следствие для app: после успешного `PUT settings` инвалидировать запрос `settings/routes`, иначе
  блок покажет устаревшее значение. Материализовать `push.routes` миграцией не нужно (expand без миграции, как
  `push.events`).
- **RC-F3 — финальный провал пачки.** Ретраи — `defaultJobOptions` базы (`attempts: 5`, exponential 5 с,
  `removeOnFail: false`): провал виден в failed-наборе BullMQ; панели failed-доставок нет (Out of Scope). Добавляем
  лог `notifications.fanout_failed` на последней попытке (образец `isFinal` из `tickets-email.processor.ts`), без
  `userId`.
- **RC-F4 — сторож и уборка завершённых.** `removeOnComplete: 1000` (count): если intake повторно получит событие
  после того, как пачки ушли из completed-набора (повторная публикация outbox через часы), сторож их не увидит —
  пересчёт и повторная постановка; дублей уведомлений и доставок нет (уникальный индекс, `pendingDeliveriesOf` — только
  `pending`). Принимаем как остаточный.

## 8.2 Deviations from spec

N4 `[ASSUMPTION]` «решение по заявке маршрута — в группе „Райды“» заменяется отдельной группой «Маршруты».

## 8.3 Security checklist

Новый эндпоинт `GET|PUT /v1/notifications/settings/routes` — `AuthGuard`, только свой документ, `strictObject`
запроса, лимит `notifications-settings`. Данные пачки не выходят наружу. Логи — без `userId` списков.

## 9. Acceptance Criteria

1. Событие с аудиторией ≤ пачки — одна задача intake, поведение прежнее (текущие int-тесты зелёные).
2. Событие с аудиторией > пачки — intake ставит ⌈N/пачка⌉ задач `notifications.fanout` и сам уведомлений не пишет;
   после их выполнения у каждого живого получателя ровно одно уведомление, доставка поставлена.
3. Повтор intake (тот же jobId события, в т. ч. после изменения состава аудитории в порту) — новых задач-пачек и
   дублей нет.
4. Повтор пачки — без дублей уведомлений и задач доставки.
5. Падение одной пачки (ошибка записи) не мешает остальным; её повтор дописывает только её получателей.
6. `route_published`/`route_rejected` — группа `routes`; push гасит `push.routes`, не `push.rides`.
7. `GET settings/routes` без документа — `{ push: true }`; с `push.rides: false` и без `push.routes` — `{ push: false }`;
   `PUT` пишет `push.routes`, не трогает остальное; `GET|PUT settings` — прежняя форма.
8. App: блок «Маршруты» с тумблером push; сохранение через `PUT settings/routes`; при 404 блок скрыт.
9. `pnpm check` зелёный.

## 10. Documentation Impact

`docs/product/notifications.md` (N3 группа, N4), ADR-0017 (дополнение: пачки получателей, группа «Маршруты»;
fan-out outbox — по-прежнему follow-up), `.claude/rules/pokatim-{backend,db,contracts}.md`, `pokatim-app.md` при наличии.

## 11. Implementation Context

Architecture Review — notifications-fanout: **APPROVED с условием RC-F1** (атомарная постановка — `FlowProducer.addBulk`,
не `Queue.addBulk`). Placement — всё в `apps/api/src/modules/notifications`, новых пакетов, очередей, коллекций,
индексов и миграций нет; источники не меняются.

### 11.1 ENTRY POINTS

- `NotificationsIntakeProcessor.process` (`notifications-intake.processor.ts`) — диспетчер по `job.name`.
- `NotificationSettingsService.getRoutes/putRoutes` ← `NotificationsController` `GET|PUT settings/routes`.
- App: `apps/app/src/app/settings/notifications.tsx` (`RoutesGroup`), хуки `features/notifications/queries.ts`.

### 11.2 Решения — пачки получателей

1. **Порог и размер.** `NOTIFICATIONS_POLICY.fanoutChunk = 200` (≤ 200 id в `$in` `liveUserIds`/`findSettingsMany`,
   ≤ 200 upsert в `bulkWrite`; данные задачи ≈ 8–20 КБ с целями билетов). Аудитория = сумма уникальных получателей
   непустых черновиков (до проверки живости — живость проверяет пачка в момент записи, RC-4). `≤ fanoutChunk` — прежний
   путь одной задачей; `>` — пачки. Внутренний `RECIPIENTS_BATCH = 500` остаётся (на пачке — одна итерация).
2. **Раскладка.** Черновики без получателей отбрасываются **до** нумерации (`d` — индекс среди непустых, поэтому пачка
   `0-0` существует при любой раскладке — она сторож). Для каждого черновика: `renderNotification(draft.text)` один раз
   (снимок текста — в intake), уникальные получатели режутся по `fanoutChunk`; пачка `c` получает `userIds` своего
   среза и `targets` — только записи `draft.targets` для них (Map → объект). Порты в пачке не вызываются.
3. **Данные задачи** (`notifications.events.ts`):
   ```ts
   export const NOTIFICATIONS_FANOUT_JOB = 'notifications.fanout';
   export const FanoutJobData = z.object({
     eventId: z.uuid(),
     type: z.string(),                       // тип события-источника — только для логов
     kind: z.enum(NOTIFICATION_KINDS),
     title: z.string(), body: z.string(),
     target: NotificationTarget.nullable(),
     targets: z.record(z.uuid(), NotificationTarget).optional(),
     collapse: z.object({ key: z.string(), seq: z.number().int().optional() }).optional(),
     userIds: z.array(z.uuid()).min(1).max(NOTIFICATIONS_POLICY.fanoutChunk),
   });
   /** jobId пачки: событие, черновик, пачка; без `:` (BullMQ). */
   export const fanoutJobId = (eventId: string, draft: number, chunk: number) =>
     `fanout-${eventId}-${draft}-${chunk}`;
   ```
   `NotificationTarget`, `NOTIFICATION_KINDS` — из `@pokatim/contracts`. Нет ПДн (N12): id и снимок текста.
   Нерасшифровываемые данные (`safeParse` не прошёл) — `throw` (баг кода, видно в failed-наборе), не тихий skip.
   Сторож: `'notifications.fanout'` не совпадает ни с одним ключом `notificationsOutboxRoutes` (unit-тест).
4. **Постановка (RC-F1).** Новый `@Injectable() FanoutJobs` (`fanout-jobs.ts`, образец `DeliveryJobs`):
   - `@InjectQueue(QUEUE.notificationsIntake) queue` и `@InjectFlowProducer(NOTIFICATIONS_FANOUT_PRODUCER) flow`
     (`BullModule.registerFlowProducer({ name: 'notifications-fanout' })` в `NotificationsWorkerModule`; общий
     `connection` — из `BullModule.forRootAsync` базы, проверено в `@nestjs/bullmq@12` `createFlowProducerOptionProviders`).
   - `started(eventId): Promise<boolean>` — `queue.getJob(fanoutJobId(eventId, 0, 0))` (любое состояние).
   - `enqueue(chunks): Promise<number>` — **один** `flow.addBulk(chunks.map(c => ({ name: NOTIFICATIONS_FANOUT_JOB,
     queueName: QUEUE.notificationsIntake, data: c.data, opts: { ...this.queue.defaultJobOptions, jobId: c.jobId } })))`
     — `MULTI`: все или ни одной. Опции явно: `FlowProducer` не применяет `defaultJobOptions` очереди (attempts 5,
     exponential 5 с, `removeOnComplete: 1000`, `removeOnFail: false` — `@rkarakulov/api-kit` `QueueModule`).
     Существующий jobId BullMQ не перезаписывает (`handleDuplicatedJob` → тот же id, без ошибки).
   - Чистая раскладка — `planFanout(eventId, type, drafts, chunk)` в `notification-fanout.ts` (unit-тестируемая):
     возвращает `null` (≤ порога) или `{ jobId, data }[]`.
5. **Intake (порядок):** имя задачи `notifications.fanout` → ветка пачки; иначе `isNotificationSourceEvent` → прежняя
   ветка; иначе `throw`. Ветка события: `isEventStale` → **сторож** `fanout.started(eventId)` → да: лог
   `notifications.fanout_exists`, `'fanned_out'` (порты не зовутся: состав зафиксирован, AC3 — в т. ч. при изменившейся
   аудитории) → `drafts` → `planFanout` → `null`: прежняя запись + `scheduleEvent(eventId)`; иначе `enqueue`, лог
   `notifications.fanout type event chunks=N recipients=M`, `'fanned_out'`. Повтор до постановки — новый расчёт и та
   же атомарная постановка; прямой путь при первом прогоне и пачки при повторе (аудитория выросла за порог) — дублей
   нет (уникальный `(sourceEventId, userId)`).
   `IntakeOutcome = 'written' | 'unchanged' | 'stale' | 'skipped' | 'fanned_out'`.
6. **Ветка пачки:** `FanoutJobData.parse` → `isEventStale(eventId, now)` → `'stale'` (лог `notifications.fanout_stale`)
   → `writeRecipients(eventId, rendered, userIds, now)` → `jobs.scheduleEvent(eventId, userIds)` → лог
   `notifications.fanout_chunk event= job= written= scheduled=` → `'written' | 'unchanged'`. Ошибка на последней
   попытке (`job.attemptsMade + 1 >= (job.opts.attempts ?? 1)`) — лог `notifications.fanout_failed event= job=
   attempts=` и rethrow (RC-F3). Логи — без списков `userId`.
7. **Общая запись.** `writeDraft` делится на `renderDraft(draft) → RenderedDraft { kind, title, body, target,
   targets?: ReadonlyMap|Record, collapse? }` и `writeRecipients(eventId, rendered, recipients, now)` — прежний цикл
   (`liveUserIds` → `findSettingsMany` → `initialDelivery` → `writeNotices`, `target = targets[userId] ?? target`).
   Прямой путь и пачка зовут одну функцию; копии цикла нет.
8. **Доставка пачки.** `DeliveryJobs.scheduleEvent(sourceEventId, userIds?)` → `repository.pendingDeliveriesOf(
   sourceEventId, userIds?)`: при `userIds` фильтр `userId: { $in: userIds }`. Индекс есть —
   `notifications_event_user_unique { sourceEventId: 1, userId: 1 }` (`0025_notifications`), точечные границы
   IXSCAN; нового индекса не нужно. jobId доставки прежние (`pushJobId`, `emailJobId`).
9. **72 ч в пачке — ДА.** Ретраи пачки укладываются в ~75 с; > 72 ч — только простой worker. Будить вчерашним событием
   нельзя (RC-6) — то же правило, что у intake; частичный центр в этом сценарии допустим (как и сейчас при простое).

### 11.3 Решения — группа «Маршруты»

- **contracts** `notification.schema.ts`: `NOTIFICATION_GROUPS = ['races','disputes','rides','events','routes']`
  (в конец; ответы — `tolerantEnum`); `RouteNotificationSettingsView = z.object({ push: z.boolean() })`,
  `UpdateRouteNotificationSettings = z.strictObject({ push: Toggle })`, `DEFAULT_ROUTE_NOTIFICATION_SETTINGS = { push:
  true }`. `NotificationSettings` не меняется (RC-D1).
- **policy:** `const [RACES, DISPUTES, RIDES, EVENTS, ROUTES] = NOTIFICATION_GROUPS`; `route_published`/
  `route_rejected` → `ROUTES` (комментарий `[ASSUMPTION]` убрать). `DeliverySettings.email:
  Record<Exclude<NotificationGroup, 'races' | 'routes'>, boolean>`; `initialDelivery`: `if (!EMAIL_KINDS.has(kind) ||
  group === RACES || group === ROUTES) return { push, email: null }` (сужение типа для `settings.email[group]`).
  `DEFAULT_DELIVERY_SETTINGS.push.routes = DEFAULT_ROUTE_NOTIFICATION_SETTINGS.push`.
- **collection:** `NotificationSettingsDoc.push: … & { events?: boolean; routes?: boolean }` (комментарий: нет поля —
  значение `push.rides`).
- **repository:** `deliverySettingsOf` — `push: { ...doc.push, events: doc.push.events ?? true, routes:
  doc.push.routes ?? doc.push.rides }` (одно место для `findSettings` и `findSettingsMany`; `push-delivery.ts` читает
  `settings.push[doc.group]` — `routes` подхватывается без правки). `saveRouteSettings(userId, { push }, now)`:
  `$set { 'push.routes', updatedAt }` + тот же `$setOnInsert`, что у `saveEventSettings` (вынести общий
  `settingsOnInsert()`; `push.routes` в него **не** класть — иначе конфликт путей).
- **service:** `getRoutes(userId) → { push: current.push.routes }`, `putRoutes(userId, body)` — `consume` (лимит
  `notifications-settings`) → `saveRouteSettings` → `{ push: body.push }`.
- **controller:** `@Get('settings/routes')` (`no-store`) и `@Put('settings/routes')` `@HttpCode(200)` с
  `ZodValidationPipe(UpdateRouteNotificationSettings, FieldErrorCode)` — рядом с `settings/events`, до `:id/read`.
- **api-client** `packages/api-client/src/index.ts`: `getRouteNotificationSettings(token)` (GET,
  `RouteNotificationSettingsView`), `updateRouteNotificationSettings(token, body)` (PUT) — копия пары `…EventNotification…`.
- **app** `queries.ts`: `routeSettingsKey = ['notifications','settings','routes']`, `useRouteNotificationSettings(
  { enabled })`, `useUpdateRouteNotificationSettings` (`setQueryData`); 404-предикат — общий (`isEventSettingsMissing`
  переименовать в `isSettingsResourceMissing` или переиспользовать как есть). `useUpdateNotificationSettings.onSuccess`
  — `invalidateQueries(routeSettingsKey)` (RC-F2). Экран: `RoutesGroup` между циклом `ALL_GROUPS` и `EventsGroup`
  (порядок — после «Райдов»), только push (тумблер + `pushBlocked`, `control.enableFromToggle` — как в `EventsGroup`);
  платформа без push — блок не рендерится и запрос не делается (`enabled: push`); 404 — скрыт. Обновить JSDoc экрана.
- **i18n** `packages/i18n/src/ru.ts`: `'notifications.settings.group.routes': 'Маршруты'` (рядом с `group.events`).
  Других строк не нужно.
- **НЕ трогать** `apps/app/src/features/notifications/push-soft-prompt*`.

### 11.4 FILES TO MODIFY

api: `notifications-intake.processor.ts`, `notifications.events.ts`, `notification-fanout.ts` (новый, чистый
`planFanout`), `fanout-jobs.ts` (новый), `delivery-jobs.ts`, `notifications.repository.ts`, `notifications.collection.ts`,
`notifications.policy.ts`, `notification-settings.service.ts`, `notifications.controller.ts`, `notifications.module.ts`
(`registerFlowProducer`, провайдер `FanoutJobs` в worker-модуле), `apps/api/test/notifications.ts` (хелперы
`intakeQueue(h)`, `fanoutJobs(h)` — ждущие задачи пачек, `runFanout(h, job)`, `seedLiveUsers(h, n)` — минимальные
документы `users` с `deletedAt: null`).
contracts/client/app/i18n: `packages/contracts/src/notifications/notification.schema.ts`,
`packages/api-client/src/index.ts`, `apps/app/src/features/notifications/queries.ts`,
`apps/app/src/app/settings/notifications.tsx`, `packages/i18n/src/ru.ts`.

FILES TO READ: `delivery-jobs.ts` (образец постановки), `push-delivery.ts:80-85` (тумблер по `doc.group`),
`tickets/jobs/tickets-email.processor.ts:13` (`isFinal`), `test/notifications.ts`, `migrations/0025_notifications.ts`.

### 11.5 Test matrix

Unit (Vitest):
- `notification-fanout.test.ts`: ≤ 200 → `null`; 200 → `null`, 201 → 2 пачки (200 + 1); 450 в одном черновике → 3
  (`-0-0`, `-0-1`, `-0-2`); дубли получателей не считаются; пустой черновик не получает номер (сторож `-0-0` при
  пустом первом); сумма по двум черновикам > порога → пачки обоих; `targets` пачки — только её получатели; jobId без
  `:`; `FanoutJobData.parse(data)` проходит для каждой пачки; `'notifications.fanout'` ∉ `notificationsOutboxRoutes`.
- `notifications.policy.test.ts`: `route_*` → `routes`; `initialDelivery(route_published)` — `email: null`, push по
  `push.routes` (rides не влияет); `DEFAULT_DELIVERY_SETTINGS.push.routes === true`.
- `notification.schema.test.ts`: `routes` — последний в `NOTIFICATION_GROUPS`; `UpdateRouteNotificationSettings`
  строгая (лишний ключ, не boolean — ошибка); ответ терпит лишние ключи; старый разбор `group: 'routes'` в
  `NotificationView` у списка без `routes` — `unknown` (если есть такой тест для events — по образцу).
- `packages/api-client/src/notifications.test.ts`: URL/метод/тело двух новых методов.

Int (реальные Mongo + Redis, `notifications-intake.int.test.ts`, новый `describe('пачки получателей')`): аудитория —
`seedLiveUsers` + `vi.spyOn(h.worker.get(NotificationIntake), 'drafts').mockResolvedValue([...])` (порт источника —
граница, не БД; БД настоящая):
1. AC1: 200 получателей → одна задача, `'written'`, пачек в очереди нет.
2. AC2: 450 → `'fanned_out'`, в `notifications-intake` 3 задачи `notifications.fanout` с jobId `fanout-<id>-0-{0,1,2}`,
   уведомлений 0; прогон пачек → у каждого из 450 ровно одно, задачи доставки — по всем `pending`.
3. AC3: повтор intake → `'fanned_out'`, задач 3, `drafts` не вызван второй раз; повтор, когда порт вернул 650 —
   задач 3, уведомлений после прогона 450; повтор после выполнения пачек (они в completed) — новых нет.
4. AC4: пачка дважды → `'written'`, затем `'unchanged'`; число уведомлений и задач доставки не меняется.
5. AC5: `vi.spyOn(repository, 'writeNotices')` — `mockRejectedValueOnce` на второй пачке (вызов по порядку,
   остальные — `callThrough`): пачка 1 бросает, пачки 0 и 2 записали 250; повтор пачки 1 → 450; задачи доставки,
   поставленные повтором, — только по её получателям (`scheduleEvent(eventId, userIds)` → проверка по jobId).
6. Пачка старше 72 ч (`uuidv7At`) → `'stale'`, без записи; удалённый получатель пачки — без уведомления (RC-4).
7. Отрицательное доказательство атомарности (опционально): `enqueue` через `Queue.addBulk` нельзя проверить обрывом —
   фиксируем в §12 ссылку на `addFlow`/`MULTI` (код BullMQ), не тест.

Int — группа «Маршруты»:
- intake: решение по маршруту → `group: 'routes'` (обновить тест «группа „Райды“» в `describe('маршруты райдеров…')`);
  `push.routes: false` → push `skipped: disabled`; документ с `push.rides: false` без `push.routes` → `skipped`;
  `push.routes: true, push.rides: false` → `pending`.
- `notifications-delivery.int.test.ts`: `route_published` (`group: 'routes'`) — тумблер на доставке `push.routes`;
  старый документ `group: 'rides'` — по `push.rides` (снимок).
- `notifications.int.test.ts`: 401 без входа для `GET|PUT settings/routes` (список строки 67); `GET` без документа —
  `{ push: true }`; с `push.rides: false` без `push.routes` — `{ push: false }`; `PUT { push: true }` → документ
  `push.routes: true`, остальное без изменений, `GET settings` — прежняя форма и значения; `PUT` без документа —
  `$setOnInsert` умолчаний (`GET settings` — полный объект); строгий запрос — 400 `VALIDATION_FAILED`; общий лимит
  `notifications-settings` (`PUT settings/routes` расходует его → 429 по образцу events); `PUT settings` не стирает
  `push.routes`.

App (Jest, `apps/app/src/__tests__/notifications.test.tsx`, `notification-settings-no-push.test.tsx`): добавить
мок `getRouteNotificationSettings` по умолчанию (иначе существующие тесты падают); счётчик push-тумблеров 4 → 5 и
индексы тумблеров в тестах «Мероприятий»; «Маршруты» — заголовок после «Райды», один push-тумблер, без e-mail;
тумблер → `updateRouteNotificationSettings(token, { push: false })`, основной `PUT` не вызван; 404 — блока нет;
ошибка сохранения — баннер и прежнее значение; без push — блока нет и запроса нет; после `PUT settings` запрос
`settings/routes` перечитан.

### 11.6 Порядок TDD

1. contracts (`NOTIFICATION_GROUPS`, Route-схемы) + schema-тест → api-client + тест.
2. policy unit (группа, `initialDelivery`, типы `DeliverySettings`) → collection/repository (`deliverySettingsOf`,
   `saveRouteSettings`) → service/controller → int `settings/routes` и intake/delivery для группы.
3. `notification-fanout.ts` unit (`planFanout`, `FanoutJobData`, `fanoutJobId`).
4. Рефактор `writeDraft` → `renderDraft` + `writeRecipients` (существующие int зелёные — AC1).
5. `pendingDeliveriesOf(eventId, userIds?)` / `scheduleEvent(eventId, userIds?)`.
6. `FanoutJobs` + `registerFlowProducer` → ветки intake/пачки → int AC2–AC5.
7. App: хуки, `RoutesGroup`, i18n, Jest. 8. Документы (§10). 9. `pnpm check`.

### 11.7 OUT OF SCOPE

Fan-out outbox в app-foundation; новые события маршрутов; письма «Маршрутов»; панель failed-доставок;
`push-soft-prompt*`; миграции (данные без миграции: `push.routes` — expand, `group` старых уведомлений — снимок).

### 11.8 Documentation Impact (уточнение §10)

`docs/product/notifications.md` — N3 (решения по маршруту — группа «Маршруты»), N4 (пять групп, «Маршруты» — только
push, нет поля — значение «Райдов»); ADR-0017 — дополнение «пачки получателей» (порог 200, `notifications.fanout`,
`FlowProducer.addBulk`/MULTI, сторож `-0-0`, 72 ч) и группа «Маршруты», fan-out outbox — follow-up;
`pokatim-backend.md` «Уведомления» — задача `notifications.fanout` в `notifications-intake`, подресурс
`settings/routes`; `pokatim-db.md` — `push.routes` (нет поля — `push.rides`); `pokatim-contracts.md` — `routes` в
`NOTIFICATION_GROUPS`, Route-схемы, 2 метода api-client; `pokatim-app.md` (строки 30+) — блок «Маршруты» как
«Мероприятия», только push.

## 12. Outcome

- **Реализовано (coder, 2026-10-30):** коммиты `2b8122e5` (группа «Маршруты»: контракт, политика, подресурс),
  `960b428b` (пачки получателей), `dc4302b5` (приложение: блок «Маршруты»), `f1220b13` (документы).
- Пачки: `notification-fanout.ts` (`renderDraft`, `planFanout`), `fanout-jobs.ts` (`FanoutJobs.started/enqueue`,
  `FlowProducer.addBulk`, `BullModule.registerFlowProducer({ name: 'notifications-fanout' })`), ветка
  `notifications.fanout` в `NotificationsIntakeProcessor`, общая `writeRecipients`, `scheduleEvent(eventId, userIds?)`.
  Помимо test matrix: AC3 проверяет повторную постановку тех же jobId через `FanoutJobs.enqueue` (BullMQ не дублирует);
  AC2 — опции задач пачки = `defaultJobOptions` очереди; неразбираемые данные пачки — `throw`.
- Атомарность (§11.5 п. 7): тестом обрыва не проверяется; основание — `RedisQueueBackend.addFlow` (`client.multi()`)
  против `addJobs` (`client.pipeline()`), `node_modules/bullmq/dist/esm/classes/redis-queue-backend.js` (BullMQ 6.4.0).
- `RenderedDraft.targets` — только `ReadonlyMap` (пачка переводит `Record` в `Map`); `isEventSettingsMissing`
  переименован в `isSettingsResourceMissing`. Отклонений от §11 нет.
- **Open follow-ups:** fan-out outbox «тип → несколько очередей» в app-foundation (`OutboxRoutes = Record<string,
  string | readonly string[]>`, jobId = id события в каждой очереди) + релиз `@rkarakulov/api-kit` + каталог pokatim;
  затем подписка `standings`/`route-rides`/`achievements` на события вместо регламентов (ADR-0017 п. 5, ADR-0020).
