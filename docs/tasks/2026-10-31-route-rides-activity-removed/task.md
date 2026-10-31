# Заезды по маршруту: удаление по `tracks.activity-removed` (task2)

## 1. Title

`route-rides` подписан на `tracks.activity-removed` через fan-out outbox (follow-up RC-1 route-rides-01, outbox-fanout §12).

## 2. Goal

Заезды удалённой активности сейчас только скрыты фильтром на чтении и удаляются в транзакции следующего нового заезда
по тому же маршруту (RC-1 (a)): производные данные (время сегмента, позиции на линии) живут неопределённо долго. С
fan-out (api-kit 0.6.0) `route-rides` подписывается на тот же тип, что и `results`, и удаляет заезды сразу.

## 3. Scope

- `route-rides.events.ts`: `routeRidesOutboxRoutes[TRACK_ACTIVITY_REMOVED] = QUEUE.routeRidesIntake`.
- `queues.ts`: новая очередь `route-rides-intake` — лёгкая, не за сверками `route-ride-check` (параллелизм 1, поток
  разбора до минуты).
- `RouteRidesIntakeProcessor` (worker): payload `TrackActivityRemoved` → `RouteRidesRepository.deleteOfActivity(userId,
  activityId)` — `deleteMany { userId, activityId }` по всем маршрутам. Невалидный payload — warn и пропуск; неизвестное
  имя задачи — исключение (как `route-ride-check`).
- `RouteRidesWorkerModule`: очередь и процессор. Тестовый стенд `routeRidesWorker` — задача в процессор своей очереди.
- Правила `pokatim-db.md` (сироты), комментарии RC-1 в коде, отметка follow-up в `2026-10-31-outbox-fanout/task.md`.

## 4. Out of Scope

- Уборка старых сирот (до выкладки) и заездов недоступного маршрута (RC-8) — их держит фильтр; уборщик не нужен, пока
  сирот не накапливается заметно.
- `primaryActivityId` события не используется: заезд группы не переносится на новую основную — райдер проверит её сам
  (новый заезд, как после удаления).

## 5. Решение: фильтр на чтении остаётся страховкой

Подписка асинхронна, а транзакция нового заезда не берёт замок активностей: POST, прочитавший активность живой до
коммита удаления, может вставить заезд после того, как событие уже обработано, — сирота. Ещё окно между коммитом
удаления и обработкой события и сироты, созданные до выкладки. Поэтому фильтр по `liveActivities` на всех чтениях и
`deleteOrphans` в транзакции нового заезда остаются без изменений; подписка — основной путь удаления, фильтр — гарантия
AC7.

## 8. Risks / Assumptions

- Идемпотентность: повтор задачи (jobId = id события) — `deleteMany` удаляет 0. Сверка, идущая для удалённого заезда,
  пишет итог условием `_id + checkRevision` — промах, `skipped`.
- Индекс: фильтр `{ userId, activityId }` — префикс `userId` уникального индекса; заездов одного райдера мало
  (≤ 100 на маршрут), миграция не нужна.
- Порядок событий не важен: удаление необратимо, `activity-ready` к `route-rides` не маршрутизирован.

## 8.3 Security checklist

Новых эндпоинтов, данных и секретов нет; удаление — только заездов владельца события (`userId` в фильтре).

## 9. Acceptance Criteria

1. Событие `tracks.activity-removed` маршрутизировано в `results-intake` и `route-rides-intake` (сторож
   `outbox-routes.test.ts`).
2. Удаление загрузки → после обработки события заездов этой активности нет в БД ни по одному маршруту; заезды других
   активностей и других райдеров не тронуты.
3. Повтор той же задачи — без ошибки, 0 удалений; невалидный payload — пропуск.
4. Фильтр на чтении и `deleteOrphans` сохранены (существующие тесты AC6/AC7 зелёные).
5. `pnpm check` зелёный.

## 10. Documentation Sync

`.claude/rules/pokatim-db.md`, `.claude/rules/pokatim-backend.md`, `docs/product/routes.md`,
`docs/architecture/README.md`, ADR-0017 (отметка outbox-fanout), `docs/tasks/2026-10-31-outbox-fanout/task.md` (§12).

## 12. Outcome

- **Review:** Claude independent-reviewer pass 1 — APPROVE; MEDIUM (архитектурный обзор и ADR-0017) и LOW (§10,
  dead-letter в правилах, проверка заездов до события в тесте) исправлены. Отрицательное доказательство: без маршрута
  `tracks.activity-removed` новый тест красный.
