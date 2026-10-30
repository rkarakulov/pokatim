# Findings — event-tickets-reminders — pass 2 — reviewer: codex
base: origin/develop   commits: origin/develop..dd84e8cb
verdict: APPROVE

Прежние HIGH исправлены: получатели гонки проверяются по активным заявкам; захват отправки сверяет старт гонки, а для календаря захватывает документ старта и проверяет его время и публикацию. Добавлены соответствующие интеграционные сценарии. Новых CRITICAL/HIGH не выявлено.

### [MEDIUM] Правила проекта по-прежнему расходятся с реализацией напоминаний

- **file:** .claude/rules/pokatim-backend.md
- **location:** строки 251–253, 505–508; Documentation Impact в `docs/tasks/2026-10-29-event-tickets/plan-D.md`, §12
- **problem:** Запланированная синхронизация `.claude/rules/pokatim-{backend,db,contracts,app}.md` отсутствует. Правила продолжают ограничивать потребителей `tickets` прежним списком и описывают 12 типов событий уведомлений.
- **why_it_matters:** Следующие изменения будут опираться на неверный граф зависимостей и неполное описание данных и контрактов.
- **evidence:** `NotificationsWorkerModule` импортирует `TicketsCoreModule`; `notificationsOutboxRoutes` содержит новый `TICKETS_REMINDER_DUE`. Однако `pokatim-backend.md:252–253` перечисляет только `AppModule`, `WorkerModule` и `AccountWorkerModule`, а строка 508 утверждает «12 типов». В task.md отсутствие правок прямо зафиксировано.
- **recommended_fix:** Синхронизировать четыре файла правил по plan-D §12: порт и зависимость, регламент, новые поля документов, группу `events`, kind `event_reminder`, цель `ticket` и подресурс настроек.

NOT VERIFIED: тесты, `pnpm check`, сборки, e2e и проверки устройств независимо не запускались. Ревью выполнено чтением diff и связанных файлов; среда доступна только для чтения, зависимости приложений отсутствуют.