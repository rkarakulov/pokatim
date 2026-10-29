# task: erasure-failures — сбои удаления аккаунтов в панели (F13)

Уровень: task2. Follow-up из `docs/tasks/2026-10-29-admin-overview/pr.md`.

## 1. Title

Экран «Сбои удаления аккаунтов» панели «Протокол» и действие «Повторить удаление».

## 2. Goal

Админ видит удаления аккаунтов, чья фоновая очистка не завершилась (та же выборка, что карточка «Обзора»): шаг и код
последнего сбоя, число неудачных попыток, время — и ставит повтор очистки с причиной в журнал. Без ПДн удалённого.

## 3. Scope

- **Данные сбоя** (worker): `AccountErasureService.step` при провале шага пишет в `users` удалённого
  `erasureLastFailure { step, code, at }` и `$inc erasureFailedAttempts` (порт `AccountErasure.recordFailure`). Код —
  только безопасный токен (`error.code` `[A-Z0-9_]`, числовой код драйвера, имя класса ошибки), текст ошибки не
  хранится (может содержать e-mail). Сбой записи сбоя не маскирует исходную ошибку (лог warn).
- **Контракт** `packages/contracts/src/admin/account-erasures.schema.ts`: `ERASURE_STEPS`, `AccountErasureQuery`
  (курсор, limit ≤ 50), `AccountErasureRow` (`userId`, `deletedAt`, `failedAttempts`, `lastFailure | null`,
  `retryRequestedAt | null`), `AccountErasurePage`, `RetryAccountErasureRequest { reason }`,
  `RetryAccountErasureResult { queued }`; действие журнала `account.erasure_retried`.
- **API** (модуль `account`, HTTP): `GET /v1/admin/account-erasures` и `POST /v1/admin/account-erasures/:userId/retry`
  под `PanelGuard` + `platform.stats`. Чтение и захват повтора — новый порт identity `ErasureFailures`
  (`IdentityAccountsModule`). Повтор — одна транзакция: условная отметка `erasureRetryRequestedAt` → `PanelAudit`
  (`account.erasure_retried`, subject `rider`, подпись `Участник ·<id>`) → outbox `account.erasure-retry-requested`
  → worker: повторный проход (`pass: 'sweep'`).
- **Идемпотентность**: повтор уже запрошен < 15 мин назад и после него сбоя не было — `{ queued: false }` без журнала
  и события; аккаунт не удалён / нет — 404; очистка уже завершена (`erasureSweptAt`) или ещё не «зависла» — 409
  `CONFLICT`.
- **Порог** «зависло» — один на «Обзор» и экран: `ERASURE_STUCK_MS` (сутки) из identity.
- **Панель**: `features/account-erasures/AccountErasuresScreen.tsx`, маршрут `/account-erasures`
  (`RequirePermission platform.stats`), `DataTable` + «Показать ещё», состояния §4.12, «Повторить» — `ReasonDialog`;
  карточка «Обзора» — ссылка «Открыть».
- Тесты: int на реальной MongoDB (список, курсор, права, повтор, идемпотентность, журнал, outbox, запись сбоя
  worker, без ПДн), RTL экрана, контракт, api-client.

## 4. Out of Scope

- Сбои до «зависания» (< суток) — экран повторяет карточку «Обзора».
- Ротация выборки регламента resume (runbook §3 «голодание») — без изменений.
- Пункт навигации — вход только с «Обзора» (раздел редкий, только admin).

## 5.1 Placement & Reuse Gate

| Что | Где | Почему |
|---|---|---|
| Запись сбоя | `identity` (`AccountErasure.recordFailure`, репозиторий) | `users` — коллекция identity |
| Список и захват повтора | `identity/erasure-failures.ts` (порт) | то же; `account` не читает чужие коллекции |
| Контроллер/сервис панели | `account/account-erasures-admin.*` | оркестратор удаления, владелец очереди и событий |
| Событие повтора | `account.events.ts` + `accountOutboxRoutes` | outbox (§4.5): журнал и событие — одна транзакция |
| Экран | `apps/admin/src/features/account-erasures` | `DataTable`, `ReasonDialog`, `EmptyState` из `src/ui` |

Миграция не нужна: выборка — частичный индекс `users_erasure_pending_idx` (0023), новые поля необязательные.

## 8. Risks / Assumptions / Open Questions

## 8.2 Принятые решения (без доков)

- **Право** — существующее `platform.stats` (только admin) на чтение и повтор: новый ключ прав конфликтовал бы с
  параллельными PR (#121, #122), повтор безопасен (шаги идемпотентны), а видеть экран без права на действие смысла нет.
- **Где хранить сбой** — в документе `users` удалённого (а не BullMQ): failed-набор Redis хранит текст ошибок и
  исчезает при чистке; документ — источник правды, без ПДн (шаг, код, время, счётчик).
- **Порог** — сутки, как у карточки «Обзора»: число на карточке = строки экрана.
- **Повтор** — через outbox, а не `queue.add` из HTTP: журнал и постановка атомарны.
- **Окно идемпотентности** повтора — 15 мин (как повторный проход `sweepDelayMs`).
- **Подпись** аккаунта — `Участник ·<хвост id>` (как журнал), полный `userId` — в строке (псевдоним, не ПДн).

## 9. Acceptance Criteria

1. Список содержит ровно удалённые > суток назад без `erasureSweptAt`, самые давние первыми, курсор без дублей.
2. Без `platform.stats` (moderator, organizer) — 403; без сессии — 401.
3. Строка — `userId`, `deletedAt`, шаг/код/время сбоя, попытки; ни e-mail, ни имени, ни текста ошибки.
4. Повтор — журнал `account.erasure_retried` с причиной, событие outbox; worker проходит очистку и ставит
   `erasureSweptAt`; повторный клик в окне — `{ queued: false }` без второй записи.
5. Провал шага в worker пишет шаг, код и счётчик попыток.
6. Экран: скелетон, ошибка с повтором, пусто, «Показать ещё», диалог с причиной; «Обзор» ведёт на экран.
