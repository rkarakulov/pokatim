# plan-D.md — PR D `feature/event-tickets-reminders`: напоминания участникам о событии

Architect, 2026-10-30. Основа — task.md §3.0 T3, §3.1 (D), §5.1 (`TICKET_NOTICES`), §5.2 (`reminders[]`,
`remindersSent[]`), §5.5 (PR D), §8.1 RC-T14/RC-T15, §9 AC10 и код `origin/develop` @ 167f4d7f (модули `tickets`,
`notifications`, контракты, `apps/app/src/app/settings/notifications.tsx`, `apps/admin/src/features/tickets`).
Status: **CONCERNS** (блокеров нет; RC-D1…RC-D12 coder принимает по умолчанию, если человек не решит иначе). Главная
находка — RC-D1: расширить `NotificationSettings` в лоб нельзя, старые сборки сломаются.

## 0. Факты из кода (проверено)

- **Web Push в develop есть** (ADR-0022, `web-push.sender.ts`, `pushChannelEnabled` = Expo **или** Web Push, SW
  `apps/app/scripts/service-worker.ts` — `push`/`notificationclick`). RC-T14 снят: напоминание идёт теми же каналами, что
  остальные уведомления — центр + `notifications.push` (Expo и Web Push одной задачей) + `notifications.email`.
- Приём: outbox «тип → одна очередь»; маршруты объявляет подписчик (`notificationsOutboxRoutes`, 12 типов →
  `notifications-intake`). `NotificationsIntakeProcessor`: событие > 72 ч — `stale` (`isEventStale` по uuidv7 id
  события) → `NotificationIntake.drafts(type, payload)` (порты источников: `RESULTS_NOTICES`, `DISPUTE_NOTICES`,
  `RIDE_NOTICES`, `ROUTE_NOTICES`, `RACE_REGISTRY`) → `liveUserIds` пачками по 500 → `findSettingsMany` →
  `initialDelivery` → `writeNotices` (уникальный `(sourceEventId, userId)`) → `DeliveryJobs.scheduleEvent`.
- `NoticeDraft` — **одна** `target` на всех получателей черновика. Цель на `/tickets/<код>` у каждого своя → нужна
  цель на получателя (RC-D6).
- Тексты — `notification-texts.ts` (`NoticeText` union, `TITLES: Record<NotificationKind,…>`, даты Минска `dayTime`);
  письмо — `notification-email.ts` (`renderNotificationEmail({title, body})`, **без ссылок**, `OPEN_APP_LINE`).
  Письма — только `EMAIL_KINDS` (`dispute_decided`, `ride_cancelled`); `initialDelivery` пишет `email: null` для
  прочих и для группы `races`.
- Группы: `NOTIFICATION_GROUPS = ['races','disputes','rides']`, `KIND_GROUPS` в `notifications.policy.ts`
  (`const [RACES, DISPUTES, RIDES] = NOTIFICATION_GROUPS` — сторож имени коллекции споров).
- **Настройки:** `NotificationSettings` — `z.strictObject` (`push {races,disputes,rides}`, `email {disputes,rides}`,
  `quietHours`), **одна схема для запроса и ответа**; api-client разбирает ответ `GET|PUT /v1/notifications/settings`
  ею же (`request(path, NotificationSettings, …)` → `schema.parse(body)` в `@rkarakulov/api-client-core`). Новый ключ в
  ответе = ошибка разбора в уже установленных сборках. `saveSettings` — `replaceOne` (старый PUT стёр бы новые поля).
- Цели: `NotificationTarget` — `discriminatedUnion` (`race|ride|dispute-response|my-route`, id — `Uuid`);
  `NotificationTargetView` — незнакомый тип → `{type:'unknown'}`. Приложение — `notification-target.ts`
  (`notificationTargetPath`), web — **отдельная копия** `targetPath` в шаблоне SW. Строка центра `kind`/`group` не
  использует — старые сборки покажут title/body нового kind без правок.
- `tickets`: `event_ticketing` (без `reminders`), `tickets` (без `remindersSent`); `upsertTicketing` — `insertOne`
  (версия 0) или `$set` перечисленных полей (чужие поля, как `checkInLock`, не трогает). `TicketingAdminService.update`
  — транзакция: версия → `next()` (правила по `kind`) → `changedFields` → журнал `tickets.settings_updated`.
  `TicketEvents.resolveMany` — `EventFacts { state: scheduled|cancelled, startsAt, place, address, title, … }`
  (календарь — момент из старта, RC-T2). Регламент — `tickets-maintenance`, одна задача `tickets.reconcile`
  (`* * * * *` Минск + boot). Индексы: `tickets_event_idx {kind, eventId, _id}`, `event_ticketing_enabled_idx {kind,
  enabled, startsAt}`.
- Граф: `tickets` не импортирует `notifications`; `notifications` импортирует источники через `index.ts`. Ребро
  `notifications → tickets` (`TicketsCoreModule`) цикла не даёт (Core тянет `results`, `calendar`, `profile`,
  `identity` — ни один не зависит от `notifications`). depcruise `no-circular` и `api-module-public-api-only`.
- Последняя миграция в develop — `0040_panel_totp`. ADR-0017 — Accepted, с пометками «Снято ADR-0022» (прецедент
  дополнений); ADR-0023 — Proposed, п. 1–11.

## 1. Requirements Consistency (PR D)

- **RC-D1 Группа «Мероприятия» ломает старые сборки (контракт).** Добавить `events` в `NotificationSettings`: (1)
  старый клиент разбирает ответ `strictObject` → экран настроек падает; (2) старый PUT без `events` — 400 (или,
  при optional, `replaceOne` стирает тумблеры). R: **отдельный подресурс** `GET|PUT /v1/notifications/settings/events`
  → `EventNotificationSettings { push: boolean, email: boolean }` (ответ — `z.object`, запрос — отдельная
  `strictObject`: ошибку `NotificationSettings` не повторяем). Прежний `/settings` по форме не меняется: GET —
  проекция без `events`, PUT — `updateOne $set` известных путей (`push.races`, …, `quietHours`, `updatedAt`, upsert),
  `push.events`/`email.events` сохраняются. Хранение — тот же документ `notification_settings`, чтение `?? true`
  (N4: всё включено). Лимит — общий `notifications-settings:<uid>` 30/ч. Альтернативы: (б) `/v1/notifications/preferences`
  — полная v2-форма (одна форма, но два эндпоинта на одни данные); (в) заголовок версии клиента (в API нет).
- **RC-D2 Кто планирует и кто фиксирует «отправлено».** R: планирует `tickets` (новая задача `tickets.reminders` в
  `tickets-maintenance`, раз в минуту + boot), уведомление пишет `notifications` через outbox — одно событие на
  **(событие, правило, отправку)**, не на билет:
  транзакция «отправки»: (1) условный `$push` в `event_ticketing.reminderDispatches` `{ reminderId, dueAt, dispatchId,
  at, count: 0 }` с фильтром «правило с этим `id` и `offsetHours` есть, записи `(reminderId, dueAt)` нет» — 0 совпадений →
  выход (параллельный регламент уже отправил: замок-сериализатор); (2) `updateMany` билетов `{ kind, eventId, status:
  'active', createdAt ≤ dueAt, 'remindersSent.reminderId': { $ne: id } }` → `$push remindersSent { reminderId,
  dispatchId, at }`; (3) `$set count` (arrayFilters по `dispatchId`); (4) при `modifiedCount > 0` — outbox
  `tickets.reminder-due { kind, eventId, reminderId, dispatchId }`. Intake читает получателей портом
  `TICKET_NOTICES` по `remindersSent.dispatchId` (как `protocolAudience`). Один раз на билет и правило — по
  `remindersSent` (AC10); дубли intake — уникальный `(sourceEventId, userId)`. Альтернативы: (б) outbox на каждый
  билет (тысячи событий и задач на правило); (в) без маркера в настройках — каждую минуту `updateMany` по всем
  билетам события до старта.
- **RC-D3 «Не уходит выпущенным после времени отправки» и отменённым.** R: `dueAt = startsAt − offsetHours`; билет
  получает напоминание, только если `createdAt ≤ dueAt` и `status = 'active'` (и при отправке, и при чтении портом).
  `checked_in` — не получает (уже на месте). `cancelled` и `event_cancelled` (гонка отменена, старт снят, билеты
  выключены) — регламент не отправляет, intake → `state`. Новый билет после повторной регистрации календаря —
  `createdAt` новый, правило уже прошло → не получает.
- **RC-D4 Правку правила или старта после отправки.** `id` правила стабилен. R: текст правят — повтора нет (`remindersSent`
  по `reminderId`); смена `offsetHours` или `startsAt` → новый `dueAt`: отправка — только билетам без этого
  `reminderId` и с `createdAt ≤ нового dueAt` (уже получившим — не повторяем); удаление правила — не отправляется
  (уже ушедшее остаётся); удалить и создать заново = новый `id` = новая отправка (явное решение организатора,
  подсказка в панели). Удалили правило между отправкой и intake — intake `gone` (билеты помечены, уведомления нет —
  принято).
- **RC-D5 Догоняние и «опоздавшие» правила.** R: регламент шлёт просроченное, пока `now < startsAt` (лёг на 10 мин —
  уйдёт после подъёма; intake тоже проверяет `now < startsAt`, иначе `state`). Но правило, созданное или со сменой
  `offsetHours` **после** своего `dueAt`, не отправляется (иначе «за 24 ч», добавленное за 2 ч, ушло бы всем сразу): в
  правиле хранится `armedAt` (время сервера при создании/смене offset), условие отправки `armedAt ≤ dueAt`. Перенос
  старта ближе (новый `dueAt` уже прошёл, правило давнее) — уйдёт сразу, это корректно. Панель показывает «Время
  отправки прошло — не будет отправлено». Альтернативы: (б) отправлять сразу всегда; (в) окно догоняния фиксированное
  (например, 2 ч) — неочевидно организатору.
- **RC-D6 Цель уведомления.** R: новый тип в **конец** `NotificationTarget`: `{ type: 'ticket', code }` (`code` —
  канонический Crockford 10 символов, новая экспортируемая схема `TicketCodeCanonical` в `ticket.schema.ts`; код не
  секрет без входа — T2). Старые сборки: центр — `unknown` (без перехода), push — центр уведомлений. Приложение —
  `/tickets/<code>`; SW — та же ветка в `targetPath` (регулярка кода). `NoticeDraft` получает необязательное
  `targets?: ReadonlyMap<userId, NotificationTarget>` (цель получателя поверх `target`) — один черновик, пачки по 500
  сохраняются.
- **RC-D7 Каналы и тумблеры.** Kind `event_reminder` (в конец `NOTIFICATION_KINDS`), группа `events` (в конец
  `NOTIFICATION_GROUPS`, `KIND_GROUPS`), `EMAIL_KINDS` + `event_reminder`. Центр — всегда (N4); push — по
  `push.events`; e-mail — по `email.events`. `initialDelivery` получает внутренний тип настроек с `events` (условие
  `group === RACES` остаётся).
- **RC-D8 Тихие часы.** Push «за 1 ч» в 06:00 при тихих 22–8 уйдёт в 08:00 (возможно, после старта). R: правило N6 не
  меняем (явный выбор райдера), письмо и центр — сразу; подсказка организатору в панели («Push в тихие часы райдера
  (по умолчанию 22–8) придёт утром — выбирайте время днём»). Альтернативы: (б) напоминания игнорируют тихие часы;
  (в) push пропускается, если `notBefore ≥ startsAt` (нужен `startsAt` в доставке) — follow-up.
- **RC-D8a Сводка push.** Без изменений: несколько отложенных — одна сводка «У вас N новых уведомлений», цель — центр.
- **RC-D9 Текст и письмо.** R: заголовок «Скоро старт», тело — `«{событие}» — {день, время}{, место}.` + текст
  организатора (снимок при приёме, Минск). Текст правила обязателен (1–500, `MULTI_LINE`, trim). Письмо — тот же
  `renderNotificationEmail` + необязательная кнопка «Открыть билет» → `${APP_WEB_ORIGIN}/tickets/<код>` **только для
  цели `ticket`** (нет env — без кнопки, `OPEN_APP_LINE` как сейчас); `EmailDelivery` берёт `APP_WEB_ORIGIN` из `ENV`,
  `buttonHtml`/`escapeHtml` из `identity`. Текст организатора — не ПДн райдеров (N12 соблюдён), экранируется.
- **RC-D10 Контракт PUT настроек билетов.** R: `EventTicketingUpdate.reminders?: EventReminderInput[]` (≤ 3; нет поля —
  не трогать, RC-T15); `EventReminderInput = strictObject({ id: Uuid.optional(), offsetHours: int 1–168, text })`; без
  `id` — сервер даёт uuidv7 и `armedAt = now`; `id`, которого нет в текущих правилах, → `400 VALIDATION_FAILED`
  (`reminders.N.id INVALID`); одинаковые `offsetHours` → `reminders.N.offsetHours INVALID`. Ответ
  `EventTicketingSettings.reminders: EventReminder[]` (`{ id, offsetHours, text, sendAt|null, sentAt|null, sentCount,
  late: boolean }` из `reminderDispatches` по текущему `dueAt`; панель деплоится с API — поле обязательное). Журнал —
  `changedFields` + `'reminders'` (новых действий нет). Правила можно настроить при выключенных билетах — отправка
  только при `enabled`.
- **RC-D11 Выборка регламента.** Гонки — `event_ticketing_enabled_idx` (`kind:'race', enabled, startsAt ∈ (now, now +
  168 ч]`, `reminders.0` есть); календарь — `kind:'calendar', enabled, reminders.0` (момент — из старта, RC-T2, без
  денормализации) → `TicketEvents.resolveMany`. Число календарных настроек с правилами мало (ведёт admin) — новый индекс
  не нужен; рост — follow-up (порт `CALENDAR_EVENTS.startingBetween`).
- **RC-D12 Стирание аккаунта и ADR.** Новых ПДн нет: `remindersSent` — id правил, уведомления стирает
  `NotificationErasure`, билеты отменяет `TicketErasure` (шаг перед `notifications`); intake фильтрует `liveUserIds`.
  Новый шаг стирания не нужен — записать в `pokatim-db.md`. ADR: основное — **ADR-0023 п. 12 «Напоминания»** (модель,
  RC-D2…D5); в ADR-0017 — строка «Дополнено ADR-0023 п. 12: группа «Мероприятия», письмо `event_reminder`,
  подресурс настроек» (как «Снято ADR-0022»). Отдельный ADR не нужен.

## 2. Placement & Reuse

- API — модули `tickets` (данные правил, регламент, порт) и `notifications` (приём, тексты, письмо, настройки). Новых
  модулей и пакетов нет. Ребро графа — одно новое: `NotificationsWorkerModule → TicketsCoreModule` (§5.1 task).
- `tickets`: `ticket-notices.port.ts` (`TICKET_NOTICES`, `TicketNotices`), `ticket-notices.ts` (реализация в Core),
  `ticket-reminders.ts` (`TicketReminders.dispatchDue()` — Worker), правила — чистые функции `reminders.policy.ts`.
- Reuse: `TicketEvents.resolveMany`, `MongoTransactions`, `MongoOutboxWriter.append`, `uuidv7`, `upsertJobScheduler`
  (`TICKETS_SCHEDULES`), `consumeUserLimit`, `renderNotificationEmail`, `buttonHtml`/`escapeHtml` (`identity`),
  `dayTime`/`quoted` из `notification-texts.ts`, `MULTI_LINE`/`Uuid` контрактов, панель — `TextAreaField`,
  `SelectField`, `DisabledReason`, `field-errors.ts`; приложение — `SettingRow`-строки экрана настроек.
- Запрещённые дубли: своя доставка push/e-mail в `tickets`; второй словарь текстов; своя проверка тихих часов; копия
  `targetPath` вне SW (SW — единственное исключение, сторож — тест SW); вычисление `startsAt` календаря вне `TicketEvents`.

## 3. Контракты (`packages/contracts`, append-only)

- `notifications/notification.schema.ts`: `NOTIFICATION_GROUPS` + `'events'`; `NOTIFICATION_KINDS` + `'event_reminder'`;
  `NotificationTarget` + `{ type: 'ticket', code: TicketCodeCanonical }`; `EventNotificationSettingsView = z.object({
  push, email })` (ответ), `UpdateEventNotificationSettings = z.strictObject({ push: Toggle, email: Toggle })`,
  `DEFAULT_EVENT_NOTIFICATION_SETTINGS = { push: true, email: true }`. `NotificationSettings` **не меняется**.
- `tickets/ticket.schema.ts`: экспорт `TicketCodeCanonical` (регулярка `CANONICAL_CODE`, без transform).
- `tickets/ticketing-admin.schema.ts`: `EVENT_REMINDERS_MAX = 3`, `EVENT_REMINDER_OFFSET_MIN/MAX_HOURS = 1/168`,
  `EVENT_REMINDER_TEXT_MAX = 500`; `EventReminderInput`, `EventReminder` (ответ), `EventTicketingUpdate.reminders`
  (`.max(3).optional()`, `superRefine` — повтор `offsetHours`), `EventTicketingSettings.reminders`.
- api-client: приложение — `getEventNotificationSettings`, `updateEventNotificationSettings`; панель — без новых
  методов (`updateEventTicketing` принимает поле). Тесты схем: порядок групп/kind, цель `ticket` (валидный/битый код
  → `unknown`), строгий запрос подресурса, `reminders` (0/3/4, 0/169 ч, 501 символ, дубль offset, неизвестный ключ).
- Совместимость: старые сборки — прежний `/settings` той же формы, неизвестные kind/group/target — `unknown`;
  старая панель (кеш) без `reminders` — правила не трогаются.

## 4. API

| Ручка / задача | Поведение |
|---|---|
| `PUT /v1/admin/events/:kind/:eventId/ticketing` | + `reminders` (RC-D10): `TicketingAdminService.next()` → `nextReminders(current, input, now)`; `upsertTicketing` пишет `reminders` в `$set` (только если поле пришло); `reminderDispatches` не трогает; `changedFields` + `reminders` |
| `GET …/ticketing` | `reminders` с `sendAt`, `sentAt`, `sentCount`, `late` (`reminderView(rule, facts, dispatches, now)`) |
| `GET|PUT /v1/notifications/settings/events` | `AuthGuard`, `no-store`, лимит `notifications-settings:<uid>`; хранение `push.events`/`email.events` |
| `GET|PUT /v1/notifications/settings` | форма прежняя; PUT — `$set` путей, не `replaceOne` (сторож: после старого PUT `events` сохранены) |
| `tickets.reminders` (`tickets-maintenance`, `* * * * *` Минск + `tickets.reminders.boot`) | RC-D11 выборка → `dueReminders(event, ticketing, now)` (`state = scheduled`, `armedAt ≤ dueAt ≤ now < startsAt`, нет записи `(id, dueAt)`) → транзакция RC-D2 на правило; сбой события — лог `tickets.reminders_failed event=<kind:id>`, остальные идут, в конце — исключение (failed-набор); лог `tickets.reminder_dispatched event=… reminder=… count=N` |
| outbox `tickets.reminder-due` → `notifications-intake` | `NotificationIntake.eventReminder(payload)`: `TICKET_NOTICES.reminder(…)` → `'gone'` (нет события/правила) / `'state'` (не `scheduled` или `now ≥ startsAt`) / `{ event, text, recipients: {userId, code}[] }` → один черновик: `text {kind:'event_reminder', event, startsAt, place, text}`, `target: null`, `targets` (RC-D6) |

Порт `TicketNotices.reminder({ kind, eventId, reminderId, dispatchId }, now)` — билеты `remindersSent.dispatchId` +
`status: 'active'` (индекс `tickets_event_idx` по префиксу), курсор пачками; ПДн наружу — только `userId` и код.

## 5. Данные — миграция **не нужна**

- `event_ticketing.reminders: [{ id, offsetHours, text, armedAt }]` (≤ 3), `reminderDispatches: [{ reminderId, dueAt,
  dispatchId, at, count }]` (пишет только регламент; версию настроек не меняет, как `registeredCount`); чтение `?? []`.
- `tickets.remindersSent: [{ reminderId, dispatchId, at }]`; чтение `?? []` (RC-T15).
- `notification_settings.push.events`/`email.events` — `?? true`.
- Индексы — существующие (RC-D11, §4). Номер миграции не занимается (последняя — `0040_panel_totp`).
- Транзакция отправки на крупную гонку — `updateMany` до нескольких тысяч билетов (в пределах лимитов транзакции);
  > 10 000 — follow-up (пачки по `_id`).

## 6. Панель (`apps/admin`)

- `TicketingSettingsForm` — секция «Напоминания»: до 3 строк (`SelectField` «За сколько»: 1, 2, 3, 6, 12, 24, 48, 72,
  168 ч; `TextAreaField` текст ≤ 500 со счётчиком; «Удалить»), «Добавить напоминание» (`aria-disabled` +
  `DisabledReason` на 3); под строкой — «Отправка: 13 июня, 10:00» / «Отправлено 12 июня · N участникам» / «Время
  отправки прошло — не будет отправлено» (`late`); подсказка тихих часов (RC-D8) и «Удалённое и созданное заново
  напоминание уйдёт ещё раз». `requestOf` шлёт `reminders` с `id` существующих. 400 по `reminders.N.*` — под полем
  (`field-errors.ts`), 409 — как сейчас.
- i18n `@pokatim/i18n`: `admin.tickets.reminders.*`, `admin.tickets.field.reminders` (подпись `changedFields` журнала).

## 7. Приложение (`apps/app`)

- `app/settings/notifications.tsx` — группа «Мероприятия» после «Райды»: push (при доступном push) и e-mail, подсказка
  «Только напоминания о событиях с билетом»; данные — `eventNotificationSettingsQuery` + мутация в
  `features/notifications/queries.ts` (оптимистично, как основная форма; ошибка — тот же `Banner`); 404 старого API —
  группу не показывать.
- `notification-target.ts` — `ticket` → `/tickets/${code}`; `scripts/service-worker.ts` `targetPath` — та же ветка.
- i18n: `notifications.settings.group.events` «Мероприятия», `notifications.settings.emailHint.events`.
- Центр уведомлений — без правок (текст рисует сервер).

## 8. Security checklist (обязателен: исходящая почта, push с текстом организатора, новые поля панели)

1. AuthZ: правила — только через `PanelEvents.resolve(…,'manage')` (как настройки); подресурс настроек — `AuthGuard`,
   только свой документ.
2. Вход: `strictObject`, ≤ 3 правил, `offsetHours` целое 1–168, текст `MULTI_LINE` 1–500; `id` — только из текущих.
3. Наружу: payload outbox — только id; уведомление — название события, время, место, текст организатора; цель — код
   билета (не секрет без входа); письмо — `escapeHtml`, ссылка только на `APP_WEB_ORIGIN`, без QR/токена.
4. Злоупотребления: один раз на билет и правило (`remindersSent`), лимит push 20/ч не меняется, лимит настроек 30/ч.
5. Логи: id события/правила, число получателей; без текста и адресов.

## 9. Тест-матрица

| Уровень | Тест | Что доказывает |
|---|---|---|
| int API | `tickets-reminders.int.test.ts` (новый) | AC10: правило 24 ч, `CLOCK` = `dueAt` → регламент → одно событие outbox, `remindersSent` у активных; повтор прогона и **два параллельных** `dispatchDue` → одна отправка; билет `createdAt > dueAt` — нет; `cancelled`/`checked_in` — нет; гонка `cancelled`, старт снят, `enabled:false` — нет; `now ≥ startsAt` — нет; догоняние (`now = dueAt + 10 мин`) — да; `armedAt > dueAt` — нет (RC-D5); смена offset после отправки — только новым, без повтора; смена текста — без повтора; удалённое правило — нет |
| int API | `notifications-intake.int.test.ts` (дополнить) | `tickets.reminder-due` → уведомление каждому получателю, `kind/group`, title/body с текстом правила, цель `ticket` у каждого своя; удалённый аккаунт — нет; правило удалено → `skipped gone`; событие началось → `state`; повтор задачи — без дублей; `push.events=false` → push `skipped disabled`, `email.events=false` → письмо `skipped` |
| int API | `notifications-delivery.int.test.ts` (дополнить) | письмо `event_reminder`: тема, тело, кнопка `${APP_WEB_ORIGIN}/tickets/<код>`; без env — без кнопки; тихие часы — push отложен, письмо сразу |
| int API | `notifications.int.test.ts` (дополнить) | подресурс `settings/events`: умолчания, PUT/GET, 401, 400 лишний ключ, 429; **старый PUT `/settings` не стирает `events`**, ответ `/settings` — ровно прежние ключи (сторож старых сборок: `NotificationSettings.parse` ответа) |
| int API | `tickets-admin.int.test.ts` (дополнить) | `reminders`: права (403/404 как настройки), 4 правила/169 ч/501 символ/дубль offset/чужой `id` → 400 с путём; без поля — правила не тронуты; `changedFields` содержит `reminders`; ответ `sendAt/sentAt/sentCount/late` |
| unit API | `reminders.policy.test.ts`, `notification-texts.test.ts`, `notification-email.test.ts`, `notifications.policy.test.ts` | `dueAt`, `dueReminders` (границы `≤`/`<`), `nextReminders` (новый id, `armedAt` при смене offset, без смены текстом); текст и экранирование; группа и `EMAIL_KINDS` |
| unit API | `tickets-maintenance.processor.test.ts` | две задачи в расписании, неизвестное имя — ошибка |
| contracts / api-client | схемы §3, методы подресурса | порядок списков, цель `ticket`, строгость запроса |
| RTL панели | `EventTicketsScreen.test.tsx` (дополнить) | добавить/удалить правило, лимит 3 (`DisabledReason`), 400 под полем, статусы «Отправлено»/«прошло», запрос с `id` существующих |
| app | `notifications.test.tsx`, `notification-target.test.ts`, тест SW | группа «Мероприятия» (тумблеры шлют подресурс, без push — только e-mail, 404 — группы нет); `ticket` → `/tickets/<code>`, битый код — `null`; SW открывает `/tickets/<code>` |

Отрицательные доказательства: убрать условие `(reminderId, dueAt)` из `$push` и `$ne` из `updateMany` → тест
«два параллельных прогона» красный (два события); убрать `createdAt ≤ dueAt` → тест «выпущен после» красный; вернуть
`replaceOne` → тест «старый PUT не стирает events» красный.

## 10. Порядок работ (coder)

1. Контракты §3 + тесты → api-client (+ тесты).
2. `notifications`: внутренний тип настроек, `saveSettings` → `$set`, подресурс (сервис, контроллер), int-тесты.
3. `notifications`: kind/группа/`EMAIL_KINDS`, `NoticeText` + текст, `NoticeDraft.targets`, письмо с кнопкой (unit).
4. `tickets`: `reminders.policy.ts` (TDD), PUT/GET правил, `upsertTicketing`, тесты админки.
5. `tickets`: `TicketReminders` + задача регламента, `tickets.reminder-due` (`tickets.events.ts`), порт `TICKET_NOTICES`
   (Core, `index.ts`) → `notificationsOutboxRoutes` + `NotificationIntake` + импорт `TicketsCoreModule` в worker;
   int-тесты AC10, `pnpm arch:check`.
6. Панель: секция «Напоминания», i18n.
7. Приложение: группа «Мероприятия», цель `ticket` (+ SW), i18n.
8. Документы §12 → `TURBO_CONCURRENCY=1 pnpm check` (своя БД/Redis db), `pnpm build:web`.

## 11. Риски

- Тихие часы задерживают ранние push (RC-D8) — принято, подсказка в панели.
- Транзакция `updateMany` на очень крупном событии (RC-D2/§5).
- Билет, выпущенный сверкой с `createdAt < dueAt`, но закоммиченный после отправки (секунды) — без напоминания
  (принятый остаточный риск; регистрация календаря сериализована `reserveSeat` по документу настроек).
- Выборка календаря без индекса по моменту (RC-D11).

## 12. Documentation Impact

ADR-0023 п. 12 «Напоминания» (RC-D2…D6, D8); ADR-0017 — строка-дополнение (RC-D12); `docs/product/notifications.md`
— N2 (+ напоминание о событии), N4 (четыре группы, «Мероприятия» push + e-mail), таблица событий и «Тексты v1»,
экран настроек; `docs/product/tickets.md` — напоминания (правила, AC10, догоняние, `late`); `admin-panel.md` —
секция «Напоминания»; `.claude/rules/pokatim-backend.md` — порт `TICKET_NOTICES`, ребро `notifications → tickets`,
задача `tickets.reminders`, 13 типов в `notificationsOutboxRoutes`; `pokatim-db.md` — новые поля без миграции, шаг
стирания не нужен; `pokatim-contracts.md` — группа, kind, цель `ticket`, подресурс, `reminders`; `pokatim-app.md` —
группа «Мероприятия», цель `ticket` (и SW); task.md 8.2/12 — оркестратор/coder.

## 13. Out of scope (PR D)

Wallet (PR E); напоминания кофе-райдов; правка текста отправленного уведомления; обход тихих часов (RC-D8 б/в);
напоминания для `checked_in`; SMS/Telegram; пользовательские (личные) напоминания; UI материалов в приложении (долг PR C).

**Статус: CONCERNS** — блокеров нет; RC-D1 (совместимость настроек) обязателен к исполнению как описано.
