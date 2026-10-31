# route-rides-03: автопроверка заезда по маршрутам + `activityId` в детали

Шаг 1 из 3 этапа 2 заездов по маршруту. Решения автора — `docs/product/routes.md`, «Этап 2» (V1–V5; там же O1–O5
и U1–U4 для следующих шагов). Задача — `docs/tasks/2026-10-31-route-rides-03-auto-check/task.md`.

## Что сделано

- **Автопроверка (V1–V5).** Новая группа дублей (импорт или загрузка; `cycling`/`unknown`, начало не раньше 7 суток
  до приёма файла) → событие `tracks.activity-group-created` (в транзакции записи активности) → очередь
  `route-ride-auto`. План — до 20 видимых маршрутов: где у райдера уже есть живой заезд (по дате последнего), затем
  свои готовые; рамка ≤ 600 м; пропуск — заезд группы по маршруту, квота 100. Сверка — общий `RouteRideEvaluator`
  (вынесен из ручного процессора без изменения поведения). Сохраняется только `passed` с `origin: 'auto'`; лимит
  ручных проверок не тратится; гонка с ручным POST — уникальный индекс.
- **Идемпотентность.** План события хранится в `route_ride_auto_plans` (id события, TTL 30 суток); ретраи и повторы
  проверяют только его; без плана и старше 7 суток — пропуск.
- **Контракт:** `RouteRideDetail.activityId` (основная активность, `null` по умолчанию) и `origin`
  (`manual | auto`, по умолчанию `manual`) — аддитивно.
- **Приложение:** «Проверить снова» шлёт `{ activityId }` напрямую (404 — прежний текст, `null` — кнопки нет);
  «Проверен автоматически» у `auto`.
- Порт `routes`: `ownReadyIds`, `rideableBounds`. `results` получает `tracks.activity-ready` как прежде
  (тест итоговой карты outbox).

## Миграции / env / конфиги

- **Миграция `0046_route_ride_auto_plans`** (expand-only): коллекция, TTL-индекс `expiresAt`, индекс `userId`.
- Новая очередь BullMQ `route-ride-auto` (параллелизм 1, ретраи по умолчанию). env и конфиги не менялись.

## Проверки

- `TURBO_CONCURRENCY=4 pnpm check` на `c3eec6ea` (изолированные `pokatim_rr03full_test`, Redis db 9) — зелёный:
  15/15 задач, api 2633/2633, contracts 489, api-client 170, tracks 374, admin 511. После него в ветку добавлен только
  этот `pr.md`.
- Ревью: Claude independent-reviewer — APPROVE (pass 2); Codex — APPROVE (pass 5; CRITICAL pass 1–4 по
  идемпотентности плана закрыты, `findings.md`, `codex-findings*.md`).

## Открыто

- PR #164 (`route-rides` слушает `tracks.activity-removed`) правит тот же `route-rides.events.ts` и раздел правил —
  при слиянии второго ожидается конфликт.
- Следующие шаги: route-rides-04 «Другие» (API → приложение), route-rides-05 участки (API → приложение).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
