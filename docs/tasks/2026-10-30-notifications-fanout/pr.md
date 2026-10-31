## Уведомления: пачки получателей и группа «Маршруты»

Задача: `docs/tasks/2026-10-30-notifications-fanout/task.md` (task3).

### Что сделано

- **Пачки получателей.** Событие с аудиторией больше 200 (`NOTIFICATIONS_POLICY.fanoutChunk`) intake раскладывает
  на задачи `notifications.fanout` в той же очереди `notifications-intake`. Время одной задачи ограничено пачкой,
  ретрай — только упавшей пачки, запись — прежний `writeNotices` (без дублей), доставка — только получателям пачки.
  - План раскладки сохраняется в данных задачи intake (`job.updateData`) до постановки: повтор берёт его, порты
    источников заново не зовутся.
  - Постановка — `FlowProducer.addBulk` (MULTI) с явными опциями очереди; затем проверка каждого jobId, недостающие
    ставятся ещё раз, иначе исключение. `addBulk` молча пропускает ошибки отдельных команд (OOM Redis).
  - Отсечка 72 ч — и в пачке; финальный провал пачки — лог `notifications.fanout_failed`.
- **Группа «Маршруты».** `route_published`/`route_rejected` — группа `routes` (в конце `NOTIFICATION_GROUPS`),
  подресурс `GET|PUT /v1/notifications/settings/routes` (только push). Нет `push.routes` — значение `push.rides`
  (выключивший «Райды» не начнёт получать push о маршрутах). Форма `/settings` прежняя. Приложение — блок «Маршруты»
  после «Райдов»; 404 старого сервера — блок скрыт.
- Документы: N3/N4 `docs/product/notifications.md`, ADR-0017 (дополнение), правила backend/db/contracts/app.

### Не сделано (follow-up)

Fan-out outbox «тип → несколько очередей» — правка `@rkarakulov/api-kit` в app-foundation (ADR-0017 п. 5).

### Проверки

- Тесты уведомлений api (unit + int на реальных Mongo/Redis) — 265 passed после слияния develop; contracts 465;
  Jest экрана настроек 34; tsc/eslint чистые.
- Полный `TURBO_CONCURRENCY=1 pnpm check` локально — красный только таймаутами 5 с в файлах вне задачи
  (`@pokatim/admin`, `parse-thread.test.ts`); отдельно они зелёные. Итог — CI.

### Ревью

- Claude independent-reviewer pass 1 — APPROVE, 3 LOW (исправлены).
- Codex pass 1 — REQUEST CHANGES (HIGH: ошибки `addBulk` проглатываются) → исправлено; pass 2 — APPROVE.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
