# Findings — notifications-fanout — pass 1 — reviewer: claude
base: origin/develop   commits: 2b8122e5..4e4066b1 (5 коммитов, рабочее дерево чистое)
verdict: APPROVE

## Проверено (evidence)

- `apps/api`: `tsc --noEmit` — OK; `vitest run src/modules/notifications` (unit + int, реальные Mongo :27117 и Redis :6479,
  своя БД `pokatim_review_fanout_rv_test`, Redis db 9) — 14 файлов, 246/246 зелёные. Первый прогон на Redis db 13 дал
  9 падений из-за другого агента в той же db (37 чужих клиентов, `flushdb`) — к изменению не относится, на свободной db
  всё зелёное.
- `apps/app`: `tsc` — OK; Jest `notifications.test.tsx`, `notification-settings-no-push.test.tsx` — 34/34.
- `packages/contracts` (notifications) — 47/47; `packages/api-client` (notifications) — 9/9.
- prettier --check и eslint по всем изменённым .ts/.tsx — чисто. Полный `pnpm check` — NOT VERIFIED (прогнаны
  только затронутые пакеты).

## Измерения

- **Correctness / идемпотентность пачек.** `planFanout` нумерует только непустые черновики (`filter` до `flatMap`),
  поэтому `-0-0` есть при любой раскладке; jobId без `:`; `targets` пачки — только её получатели. Постановка —
  один `FlowProducer.addBulk` (MULTI) плоскими узлами, опции — `queue.defaultJobOptions` явно (int AC2 проверяет
  attempts 5 / exponential 5 с / removeOnComplete 1000 / removeOnFail false); `prefix` — из `queue.opts.prefix`
  (у BullMQ всегда задан, по умолчанию `bull`, совпадает с FlowProducer). Сторож `started()` стоит до портов —
  AC3 (в т. ч. выросшая аудитория и повтор после completed) покрыт int-тестом. Повтор до постановки — пересчёт,
  дубли исключает `notifications_event_user_unique`; смешанный сценарий «прямой путь частично → пачки» тоже без
  дублей. Запись — общая `writeRecipients` (копии цикла нет), доставка пачки — `pendingDeliveriesOf(eventId,
  userIds)` → `$in` по префиксу уникального индекса; AC5 доказывает, что повтор упавшей пачки ставит доставку
  только её получателям (отрицательное доказательство по jobId). 72 ч в пачке — до записи, тест есть.
  Многочерновиковые события (споры) имеют аудиторию ≪ 200, порядок черновиков при параллельных пачках не важен.
- **Группа «Маршруты».** `deliverySettingsOf`: `routes: doc.push.routes ?? doc.push.rides`, нет документа —
  `DEFAULT_DELIVERY_SETTINGS.push.routes = true`; `push-delivery.ts:82` читает `settings.push[doc.group]` —
  старые `group: 'rides'` идут по «Райдам» (int-тест delivery). `$setOnInsert` (`settingsOnInsert()`) не содержит
  `push.routes`/`push.events` — конфликта путей нет; `saveSettings` — `$set` по путям, `push.routes` не стирает
  (int-тест). `GET /settings` собирает ответ из явных ключей — форма прежняя (RC-D1).
- **Контракты / старые клиенты.** `routes` — в конце `NOTIFICATION_GROUPS`, ответы — `tolerantEnum` (тест старого
  справочника → `unknown`); `NotificationSettings` не расширен (тест: ключ `routes` — ошибка); запрос подресурса —
  `strictObject`. Фильтров списка по группе нет — регрессий в центре нет.
- **Безопасность.** Эндпоинты под `AuthGuard` (401-тесты для GET/PUT), только свой `userId`, zod-pipe до сервиса,
  лимит `notifications-settings` общий (429-тест). Логи пачек — без списков `userId` (тест на `fanout_failed`).
  Данные пачки (id, снимок текста, коды билетов) в Redis — принятый риск §8.
- **Placement.** Всё в `modules/notifications`; FlowProducer и `FanoutJobs` — только в `NotificationsWorkerModule`;
  новых очередей, коллекций, индексов, миграций нет. Цикла импортов `events → policy` нет (policy не импортирует
  events).
- **Миграции.** Нет; `push.routes` — expand без миграции, `group` старых уведомлений — снимок. OK.
- **App (§4.11–4.13).** `RoutesGroup` — `AsyncContent` со скелетоном `SkeletonListRow`, баннер ошибки сохранения,
  прежнее значение при ошибке, тумблер `disabled` на время мутации; 404 — блок скрыт; без push — ни блока, ни
  запроса (`enabled: push`); инвалидация `settings/routes` после `PUT settings` (RC-F2) — Jest. Один код для
  native и web, развилок нет. i18n — ключ `notifications.settings.group.routes`.
- **Documentation Sync (§10).** N3/N4, ADR-0017 (две вставки, fan-out outbox — follow-up), `pokatim-backend.md`,
  `pokatim-db.md`, `pokatim-contracts.md`, `pokatim-app.md` — обновлены и соответствуют коду.

## Findings

### [LOW] Смешанные версии / откат: старый worker валит задачи-пачки, старая доставка гасит `group: 'routes'`
- **file:** apps/api/src/modules/notifications/notifications-intake.processor.ts; docs/adr/0017-notifications-and-push.md
- **location:** `process` (ветка `NOTIFICATIONS_FANOUT_JOB`); push-delivery `settings.push[doc.group]`
- **problem:** Сборка до этого PR, получив задачу `notifications.fanout` (перекрытие версий при выкате или откат при
  непустой очереди), бросает `unknown job … in queue notifications-intake` → 5 попыток (~75 с) → failed: уведомления
  этой пачки не создаются. Аналогично после отката уже записанные `group: 'routes'` у старого кода дают
  `settings.push['routes'] === undefined` → push `skipped: disabled`.
- **why_it_matters:** Тихая (только failed-набор) потеря уведомлений большого события в окне выката/отката; в ADR
  ограничение не отмечено.
- **evidence:** develop-версия `process`: `if (!isNotificationSourceEvent(type)) throw new Error('unknown job …')`;
  `push-delivery.ts:82` `!settings.push[doc.group]`. Топология деплоя (есть ли перекрытие старого и нового worker) —
  NOT VERIFIED.
- **recommended_fix:** Достаточно одной строки в ADR-0017 (дополнение «пачки получателей»): откат при непустой
  `notifications-intake` теряет пачки, `route_*` с группой `routes` после отката не доставляются push. Код не менять.

### [LOW] Неразбираемые данные пачки не дают лога `fanout_failed`; схема пачки привязана к текущему `fanoutChunk`
- **file:** apps/api/src/modules/notifications/notifications-intake.processor.ts; apps/api/src/modules/notifications/notifications.events.ts
- **location:** `processChunk` — `FanoutJobData.parse(job.data)` до `try`; `FanoutJobData.userIds.max(NOTIFICATIONS_POLICY.fanoutChunk)`
- **problem:** `parse` стоит вне `try`, поэтому на последней попытке для битых данных лога
  `notifications.fanout_failed` нет (RC-F3 обещает лог на любом финальном провале пачки). Кроме того, данные
  задачи, лежащей в Redis, проверяются по `max` текущей политики: уменьшение `fanoutChunk` в следующем релизе
  сделает уже поставленные пачки неразбираемыми → 5 попыток → failed без лога.
- **why_it_matters:** Финальный провал должен быть видимым состоянием (backend.md «Правила»); сейчас — только
  failed-набор.
- **evidence:** `const data = FanoutJobData.parse(job.data);` перед `try { … } catch (error) { if (isFinal(job)) … }`.
- **recommended_fix:** Перенести `parse` внутрь `try` (лог без `type`/`eventId`, если их нет — `job.id`), либо
  `max` схемы — отдельная константа-потолок (например 500 = `RECIPIENTS_BATCH`), не текущий порог раскладки.

### [LOW] Строка JSDoc длиннее 120 символов
- **file:** apps/api/src/modules/notifications/notification-settings.service.ts
- **location:** строка 18 (JSDoc класса)
- **problem:** Вставка «„Маршруты" без сохранённого тумблера — значение „Райдов"» не перенесена; prettier
  комментарии не переносит.
- **why_it_matters:** Косметика, стиль файла (остальные строки ≤ 120).
- **evidence:** ` * прежние ключи, его `PUT` их тумблеры не стирает. «Маршруты» без сохранённого тумблера — значение «Райдов». Лимит — общий. Не ретроактивны (RC-13): …`
- **recommended_fix:** Перенести строку.

## Вердикт

APPROVE — CRITICAL/HIGH нет. Acceptance 1–8 подтверждены тестами (запущены ревьюером); AC9 (`pnpm check` целиком) —
NOT VERIFIED, затронутые пакеты зелёные.
