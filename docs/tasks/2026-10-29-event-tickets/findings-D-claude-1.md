# Findings — event-tickets PR D (reminders) — pass 1 — reviewer: claude
base: origin/develop   commits: b29cb0ab, fb36e530 (origin/develop...HEAD)
verdict: APPROVE

Проверено вручную: `ticket-reminders.ts`, `reminders.policy.ts`, `ticket-notices*.ts`, `tickets.repository.ts`
(claim / mark / count / recipients), `ticketing-admin.service.ts`, `tickets-maintenance.processor.ts`, приём
(`notification-intake.ts`, `notifications-intake.processor.ts`), настройки (`notification-settings.service.ts`,
`notifications.repository.ts`, контроллер), `push-delivery.ts`, `email-delivery.ts`, `notification-email.ts`,
контракты (`notification.schema.ts`, `ticketing-admin.schema.ts`, `ticket.schema.ts`), api-client, панель
(`TicketingSettingsForm.tsx`, remount по `key={version}` в `EventTicketsScreen.tsx`), приложение (`settings/notifications.tsx`,
`queries.ts`, `notification-target.ts`, SW).

Запуски (изоляция `pokatim_reminders_rv_test`, Redis db 4):
- `vitest run tickets-reminders.int, reminders.policy, tickets-admin.int, notifications.int, notification-intake, notifications.policy` → `Test Files 6 passed (6)`, `Tests 90 passed (90)`.
- `pnpm arch:check` → `no dependency violations found (2194 modules, 8475 dependencies cruised)`.
- Полный `pnpm check`, `build:web`, e2e — NOT VERIFIED (не запускались в этом проходе).

Что подтверждено (без находок):
- Идемпотентность: захват — первая запись транзакции в документ настроек с `$elemMatch {id, offsetHours}` и
  `$not $elemMatch {reminderId, dueAt}`; параллельный прогон получает WriteConflict, повтор колбэка — захват 0 → `null`.
  `updateMany` с `'remindersSent.reminderId': {$ne}` — один раз на билет и правило при смене offset/старта.
  Повтор outbox/intake — уникальный `(sourceEventId, userId)` → `unchanged`. `dispatchId = uuidv7()` внутри колбэка,
  побочных эффектов в колбэке нет (R1-правило про повтор колбэка соблюдено).
- «Не отменённым / не выпущенным после»: `status: 'active'` + `createdAt ≤ dueAt` при метке, `status: 'active'` при
  чтении получателей; `checked_in` не получает (RC-D3). Остаточный риск «билет закоммичен после отправки» — принят в plan-D §11.
- Совместимость: `GET /settings` — явная проекция прежних ключей; `PUT /settings` — `$set` путей (тумблеры
  `events` не стираются, есть int-тест и отрицательное доказательство); kind/group — в конец, ответы — `tolerantEnum`;
  цель `ticket` — в конец union, старые сборки → `unknown`; `EventNotificationSettingsView` — `z.object` (терпит ключи),
  запрос — `strictObject`; 404 подресурса старого API — группа скрыта.
- Граф: `NotificationsWorkerModule → TicketsCoreModule` без цикла (depcruise зелёный).
- Права панели: правила идут тем же `PUT …/ticketing` под `PanelEvents.resolve(…,'manage')`; валидация — контракт
  (≤ 3, 1–168 целое, текст 1–500 `MULTI_LINE`, дубль offset) + сервер (чужой/повторный `id` → 400 `reminders.N.id`);
  журнал `changedFields` + `reminders` в транзакции.
- Тихие часы: push по N6 (откладывается), письмо и центр сразу; подсказка организатору — в панели (RC-D8).
- Состояния данных (§4.12): группа «Мероприятия» — скелетон, ошибка с повтором (`AsyncContent`), мутация блокирует
  тумблеры, ошибка — баннер и прежнее значение.

### [MEDIUM] Захват отправки не сверяет старт события — перенос старта в окне прогона шлёт напоминание по старому времени
- **file:** apps/api/src/modules/tickets/ticket-reminders.ts; apps/api/src/modules/tickets/tickets.repository.ts
- **location:** `TicketReminders.dispatchDue` (факты — `resolveMany` в строке ~50, вне транзакции) → `dispatch()` (строки 82–125); `claimReminderDispatch` (строки ~128–145)
- **problem:** `dueAt` и `state` вычисляются из фактов, прочитанных до цикла по всем событиям и вне транзакции.
  Фильтр захвата проверяет только `enabled` и `(id, offsetHours)` правила, но не `startsAt` (гонка — поле того же
  документа `event_ticketing`) и не статус события. Если организатор переносит очный старт гонки позже (или старт
  календаря) между чтением фактов и захватом, транзакция отправки конфликтует с правкой и **повторяет колбэк с теми же
  замкнутыми `dueAt`/`rule`** — условие захвата снова выполняется.
- **why_it_matters:** сценарий: правило «за 24 ч», старт 12 июня 10:00, прогон в 11 июня 10:00:05 прочитал факты, в
  это время организатор перенёс старт на 13 июня. Захват проходит по старому `dueAt`, все активные билеты получают метку,
  intake шлёт напоминание (с новой датой в тексте) на сутки раньше; по новому `dueAt` отправка — `count 0`, т.к. метки
  уже стоят. Нарушается «время отправки = старт − offset» (RC-D2/RC-D4). Окно — от `resolveMany` до захвата, включая
  `updateMany` по билетам предыдущих событий цикла (секунды при крупных гонках), т.е. не только миллисекунды.
  Для отмены события последствия мягче: intake вернёт `state`, но билеты помечены.
- **evidence:** `claimReminderDispatch` фильтр: `{ _id, enabled: true, reminders: { $elemMatch: { id, offsetHours } }, reminderDispatches: { $not: … } }` — без `startsAt`; `dueAt` передаётся параметром из `dueReminders(event, …)`, `event` получен до транзакции.
- **recommended_fix:** для гонки — добавить `startsAt: event.startsAt` в фильтр захвата (то же поле документа, конфликт
  сериализуется); для календаря — внутри транзакции перечитать старт (`TicketEvents.lockCalendarStart`, как в
  регистрации/check-in) и пересчитать `dueAt`/`state`, выход при расхождении. Int-тест: перенос старта между чтением и
  захватом (или unit с подменой фактов) → нет отправки по старому `dueAt`.

### [MEDIUM] Правила `.claude/rules/pokatim-backend.md` расходятся с кодом после PR D
- **file:** .claude/rules/pokatim-backend.md
- **location:** строка 251 («На `tickets` ссылаются только `AppModule`, `WorkerModule` и `AccountWorkerModule`»), строка 505 (список источников без `tickets`), строка 508 («12 типов»)
- **problem:** diff добавляет ребро `NotificationsWorkerModule → TicketsCoreModule`, порт `TICKET_NOTICES`, 13-й тип
  в `notificationsOutboxRoutes`, задачу `tickets.reminders`, новые поля без миграции (`pokatim-db.md`), группу/kind/цель
  (`pokatim-contracts.md`, `pokatim-app.md`) — правила это прямо отрицают («только …»). Сам coder отметил NOT DONE (нужен OK пользователя).
- **why_it_matters:** правила — канон для следующих агентов и ревьюеров; утверждение «на tickets ссылаются только …»
  заставит следующего ревьюера считать ребро нарушением границ или наоборот разрешит что-то ещё по устаревшему тексту.
  plan-D §12 включает эти правки в Documentation Impact.
- **evidence:** `apps/api/src/modules/notifications/notifications.module.ts` (+`TicketsCoreModule`), `notifications.events.ts` (+`[TICKETS_REMINDER_DUE]`); task.md §8.2 «PR D» → «Правки `.claude/rules/**` — не сделаны, нужен OK пользователя».
- **recommended_fix:** получить OK пользователя и внести правки по plan-D §12 в этом PR (или отдельным PR до merge D в develop).

### [LOW] Неиспользуемый ключ i18n `notifications.settings.hint.events`
- **file:** packages/i18n/src/ru.ts
- **location:** строка 853
- **problem:** ключ добавлен, но нигде не используется (экран показывает `emailHint.events`).
- **why_it_matters:** мёртвая строка в словаре; путаница при переводе.
- **evidence:** `grep -rn "settings.hint.events" apps packages` → только `ru.ts:853`.
- **recommended_fix:** удалить ключ или использовать как подсказку группы.

### [LOW] Нет int-теста «перенос старта после отправки»
- **file:** apps/api/src/modules/tickets/tickets-reminders.int.test.ts
- **location:** тест «смена текста — без повтора; смена offset — только новым билетам; удалённое — не уходит» (строка ~200)
- **problem:** plan-D §9 и RC-D4 требуют поведение для смены `offsetHours` **или `startsAt`**; проверена только смена offset.
  Для гонки `startsAt` — поле настроек, путь отличается от offset (`armedAt` не обновляется, правило не «late»).
- **why_it_matters:** регрессия «перенос старта ближе → повтор уже получившим» или «перенос → late» не поймается.
- **evidence:** `grep -n "startsAt" tickets-reminders.int.test.ts` — переноса старта после `dispatchDue` нет.
- **recommended_fix:** добавить сценарий: отправка → PUT `startsAt` позже → новый `dueAt` → только билеты без метки; и перенос ближе (новый `dueAt` уже прошёл) → уходит сразу только новым.

## Итог
CRITICAL/HIGH нет → **APPROVE**. Рекомендуется закрыть MEDIUM-1 (сверка старта в захвате) до merge; MEDIUM-2 — после OK пользователя.
