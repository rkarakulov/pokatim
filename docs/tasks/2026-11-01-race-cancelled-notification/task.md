# Уведомление «Гонка отменена» (`race_cancelled`)

Уровень: task2 (полный цикл, без architect — образец `ride_cancelled` / `protocol_published` уже есть).

## 1. Title

Отмена гонки панелью → уведомление всем записавшимся (центр + push, группа «Гонки»).

## 2. Goal

Райдер с активной заявкой узнаёт об отмене гонки сразу, а не случайно на карточке.

## 3. Scope

- `packages/contracts`: `race_cancelled` — в конец `NOTIFICATION_KINDS` (`tolerantEnum` у старых сборок → `unknown`).
- `races`: событие outbox `races.race-cancelled { raceId, reason }` (`races.events.ts`, экспорт через `index.ts`) —
  в транзакции `RacesService.cancel`, после журнала. Повтор отмены (409) и отказ — без события.
- `notifications`: маршрут типа в `notificationsOutboxRoutes`; intake — `RaceRegistry.get` (нет — `gone`; статус не
  `cancelled` — `state`), получатели — `ResultsNotices.protocolAudience` (активные заявки), цель `race`, группа
  `races`, без письма (N2 не меняется). Текст — `notification-texts.ts`.
- Тексты: заголовок «Гонка отменена», текст ««{гонка}» отменена. Причина — {причина}.» (свой словарь причин сервера,
  как `REJECTION` маршрутов).
- Приложение: отдельного кода нет (текст и цель — снимок сервера, цель `race` → `/races/<id>`); тест экрана на текст и
  переход.
- Документы: `docs/product/notifications.md` (N3, «Тексты v1»), `.claude/rules/pokatim-backend.md` (источник `races`).

## 4. Out of Scope

Письмо об отмене, уведомление билетам календаря, отмена черновика.

## 8. Risks / Assumptions

- `[ASSUMPTION]` «Записавшиеся» = активные заявки (`race_entries.status = active`) на момент приёма события; снявшие
  заявку до приёма — не получают.
- Причина — код в payload (payload — id и коды, RC-1 уведомлений); у гонки причину не перечитываем (отмена
  необратима).
- Событие старше 72 ч — `stale` (общее правило intake).

## 9. Acceptance Criteria

1. Отмена опубликованной гонки пишет одно событие `races.race-cancelled` в той же транзакции; отказ — ни одного.
2. Intake: активным заявкам — `race_cancelled`, группа `races`, цель гонки, текст с причиной; снятым и посторонним —
   нет; гонка не отменена к приёму — `skipped`.
3. Push — как у остальных уведомлений группы «Гонки» (выключенная группа — `disabled`), письма нет.
4. Приложение показывает текст и ведёт на карточку гонки.

## 12. Outcome

(заполняется после реализации)
