# Findings — event-tickets PR D (reminders) — pass 2 — reviewer: claude
base: origin/develop   commits: b29cb0ab, fb36e530, dd84e8cb (origin/develop...HEAD); фокус — dd84e8cb
verdict: APPROVE

Проверено вручную: `ticket-reminders.ts` (сверка гонки, `calendarUnchanged`, `dispatch`), `tickets.repository.ts`
(`claimReminderDispatch` с `startsAt`, `markReminderSent`, `reminderRecipients`), `ticket-notices.ts` (фильтр
активных заявок), `race-tickets.ts` (`reconcileRace`, `apply`, `refresh`), `ticket-events.ts` (`raceFacts`,
`calendarMoments`, `lockCalendarStart`), `calendar.repository.ts` (`lockForAdmission`), `results.repository.ts`
(`entriesPageOfRace`, `withdrawEntry`), `reminders.policy.ts` (`dueReminders`), `ticketing-admin.service.ts`
(обязательность `startsAt` у гонки при `enabled`), `notification-intake.ts` (`eventReminder`), новые int-тесты.

Запуски (изоляция `pokatim_reminders_rv_test`, Redis db 4):
- `vitest run tickets-reminders.int, reminders.policy, tickets-admin.int, notifications.int, notification-intake, tickets-checkin*`
  → `Test Files 6 passed (6)`, `Tests 96 passed (96)`.
- `vitest run src/modules/tickets src/modules/calendar` → `Test Files 18 passed (18)`, `Tests 143 passed (143)`.
- `tsc --noEmit -p apps/api` — без ошибок; `pnpm arch:check` → `no dependency violations found (2194 modules, 8479 dependencies cruised)`.
- Полный `pnpm check`, `build:web`, e2e, устройства — NOT VERIFIED (в этом проходе не запускались; отчёт coder — в task.md §12).

## Закрытие HIGH pass 1

**HIGH-1 (снятая заявка без сверки) — закрыт.** Два рубежа:
1. `dispatchDue` перед метками гонки зовёт `RaceTickets.reconcileRace` (вне транзакции): `raceReconcilePlan`
   для `withdrawn` → `cancel` активного билета (`tickets.policy.ts:156–157`), `markReminderSent` фильтрует
   `status: 'active'` — снятому метка не ставится. Отрицательное доказательство B в task.md; AC10-тест больше не
   маскирует сценарий (убран `raceTicket` после `withdraw`).
2. Окно «сверка → метка → приём» закрыто в порте: `TicketNoticesService.reminder` у гонки оставляет только билеты,
   чей `registrationId` — активная заявка (`entriesPage`, `status === 'active'`). Повторная заявка с новым `entryId`
   корректно отсекает старый билет. Новый int-тест «участие снято после отметки, до приёма» — красный без фильтра
   (доказательство A). Остаточное окно «снял после приёма» — вне AC (уведомление уже записано).

**HIGH-2 (перенос старта между чтением и захватом) — закрыт.**
- Гонка: `startsAt` фактов = `ticketing.startsAt ?? race.windowStartsAt` (`ticket-events.ts:51`); при `enabled`
  сервер требует `startsAt` (`ticketing-admin.service.ts:208–209`), а захват фильтрует `enabled: true` → значение
  фильтра всегда равно сохранённому полю, ложного «не совпало» нет. Правка панели пишет тот же документ настроек:
  при параллельной транзакции — WriteConflict → повтор колбэка → фильтр по старому `startsAt` не проходит → `null`
  без меток; следующий прогон считает новый `dueAt`. Тест «гонка: старт перенесён позже…» — красный без фильтра (C).
- Календарь: первой операцией транзакции `lockForAdmission` (`$inc admissionLock`, `returnDocument: 'after'`) —
  тот же замок, что у регистрации и check-in; правка старта пишет тот же документ → конфликт/сериализация; затем
  сверка `published` и `calendarMoments(start).startsAt` с фактами. Тест «календарь: старт перенесён…» — красный без
  сверки (D). Побочный плюс: регистрация календаря сериализуется с отправкой, остаточный риск «билет закоммичен после
  меток» для календаря исчез.
- Застревания нет: при расхождении `null`, а следующий прогон читает новый старт; снятый с публикации старт даёт
  `state: 'cancelled'` → `dueReminders` пуст, транзакция не открывается.

## Новые проблемы от фиксов — проверено

- Транзакции: в колбэке нет внешних побочных эффектов (`reconcileRace` — до транзакции, `uuidv7` — внутри колбэка);
  повтор колбэка идемпотентен. `lockUser` (R1) не нужен — документы аккаунта не пишутся.
- Замки календаря: `admissionLock` не меняет `version`/`updatedAt`, наружу не выходит (`calendar.collection.ts:33`);
  отправка держит замок на время `updateMany` билетов одного события — конкурирующие регистрации получат
  транзиентный конфликт и повтор (как с check-in), не отказ.
- `reconcileRace` в регламенте: вызывается только при `due.length > 0` (правило к отправке и ещё не отправлено) — на
  практике ≤ 3 раз на событие плюс переносы; каждую минуту без нужды не идёт. Стоимость — как у одного шага
  `tickets.reconcile` (пачки по 500, `(raceId, _id)`). Выпуск билетов внутри — с `canIssue` по текущим часам;
  выпущенные сейчас билеты (`createdAt > dueAt`) метку не получат — то же поведение, что без сверки (не регрессия).

### [LOW] ADR-0023 п.12 и JSDoc захвата не отражают фиксы pass 1
- **file:** docs/adr/0023-event-tickets.md; apps/api/src/modules/tickets/tickets.repository.ts
- **location:** ADR строки 93–99 («условный `$push` … первой операцией»); `claimReminderDispatch` JSDoc строки 123–127; task.md строка 909 («не закоммичено»)
- **problem:** ADR и JSDoc по-прежнему утверждают, что захват — первая операция транзакции и сверяет только
  правило; у календаря первая операция теперь `lockForAdmission`, у гонки захват сверяет `startsAt`. Сверка заявок
  перед метками и фильтр активных заявок в `TICKET_NOTICES` в ADR не описаны. Заголовок §12 task.md о фиксах
  говорит «не закоммичено», хотя это коммит dd84e8cb.
- **why_it_matters:** Documentation Sync: ADR — канон модели отправки; следующий автор может «вернуть» захват первой
  операцией у календаря или убрать фильтр в порте как лишний.
- **evidence:** `ticket-reminders.ts` `dispatch`: `if (!race && !(await this.calendarUnchanged(tx, event))) return null;` до `claimReminderDispatch`.
- **recommended_fix:** дописать в ADR п.12 два рубежа HIGH-1 и сверку старта HIGH-2 (гонка — `startsAt` в фильтре,
  календарь — `lockForAdmission` первой операцией); поправить JSDoc захвата и заголовок в task.md.

### [LOW] Фильтр заявок в порте читает все заявки гонки и выносит `registrationId` наружу
- **file:** apps/api/src/modules/tickets/ticket-notices.ts
- **location:** `activeEntries`, `reminder` (строки 24–51)
- **problem:** на каждый приём отправки гонки — полный обход заявок гонки пачками по 500, хотя нужны только заявки
  получателей; кроме того, в `recipients` порта остаётся поле `registrationId` (структурная типизация TS это
  пропускает), вопреки JSDoc порта «наружу — `userId` и код».
- **why_it_matters:** при больших гонках — лишние десятки запросов на приём (терпимо: одна отправка на правило);
  утечка поля — мелкая, `notification-intake` использует только `userId`/`code`.
- **evidence:** `for (;;) { const page = await this.results.entriesPage(raceId, afterId, TICKETS_POLICY.reconcileBatch); … }`; `recipients = recipients.filter(...)` без проекции.
- **recommended_fix:** по желанию — точечная проверка по `registrationId` получателей (метод порта `results` с
  `$in` по `_id`, пачками) и `map(({ userId, code }) => ({ userId, code }))` перед возвратом.

### Перенесено из pass 1 (без изменения severity, не блокер по указанию заказчика)
- [MEDIUM] `.claude/rules/pokatim-{backend,db,contracts,app}.md` не синхронизированы (plan-D §12) — ждут OK
  пользователя.

## Итог
CRITICAL/HIGH нет; оба HIGH pass 1 закрыты и подтверждены тестами с отрицательными доказательствами → **APPROVE**.
