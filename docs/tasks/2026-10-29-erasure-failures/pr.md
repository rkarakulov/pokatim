# erasure-failures: сбои удаления аккаунтов в панели (F13)

task: `docs/tasks/2026-10-29-erasure-failures/task.md`

## Что сделано

- **Worker**: провал шага очистки пишет в `users` удалённого `erasureLastFailure { step, code, at }` и
  `$inc erasureFailedAttempts` (`AccountErasure.recordFailure`); код — безопасный токен (`erasureErrorCode`), текст
  ошибки не хранится. Ошибка SMTP несёт код свойством (`ECONNECTION`), без адреса.
- **API** (`account`): `GET /v1/admin/account-erasures` (курсор, самые давние первыми) и
  `POST /v1/admin/account-erasures/:userId/retry` (`ActionReason`), право `platform.stats` (только admin). Повтор —
  транзакция: захват (`ErasureFailures.claimRetry`, порт identity) → журнал `account.erasure_retried` → outbox
  `account.erasure-retry-requested` → повторный проход. Повтор в окне 15 мин без нового сбоя — `{ queued: false }`;
  нет удалённого — 404; завершено или не зависло — 409.
- **Порог** «зависло» — `ERASURE_STUCK_MS` (identity) общий с карточкой «Обзора».
- **Панель**: экран `/account-erasures` (`DataTable`, «Показать ещё», `ReasonDialog`, состояния §4.12), карточка
  «Обзора» ведёт на него.
- **Контракты**: `admin/account-erasures.schema.ts`, `AuditAction` + `account.erasure_retried`.
- Документы: `docs/product/admin-panel.md`, runbook `account-deletion.md` §3, `.claude/rules/pokatim-{backend,web}.md`.

## Миграции / env / конфиг

Нет. Новые поля `users` необязательные; выборка — частичный индекс `users_erasure_pending_idx` (0023).

## Проверки

- `pnpm check`: format, lint, arch, typecheck, тесты пакетов и admin — зелёные; в api один посторонний тест
  (`dispute-series` — таймаут 20 с на нагруженной машине) — отдельно зелёный вместе с `modules/account` (54/54).
- Int `account-erasures-admin.int.test.ts` — 8 (список, курсор, «Обзор» = список, права, запись сбоя, SMTP-код,
  повтор → журнал → outbox → worker → `erasureSweptAt`, идемпотентность и окно 15 мин, 404/409/400); unit
  `erasureErrorCode`; RTL экрана — 7, «Обзор» — ссылка.

## Ревью

Codex — APPROVE (2 MEDIUM исправлены); Claude independent-reviewer — REQUEST CHANGES (HIGH — тест порядка журнала,
MEDIUM — код SMTP) → исправлено, LOW закрыты или приняты (task.md §12).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
