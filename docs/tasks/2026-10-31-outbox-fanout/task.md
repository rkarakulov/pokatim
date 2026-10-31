# Fan-out outbox: api-kit 0.6.0 и composition root pokatim (task2)

## 1. Title

Тип события outbox — в нескольких очередях (follow-up ADR-0017 п. 5, notifications-fanout §12).

## 2. Goal

Outbox базы вёл тип события в одну очередь: рейтингу сезона, заездам по маршруту и достижениям нужны события, которые
уже слушают `notifications`/`results`, — они обходились регламентами. Сделать fan-out в базе и подключить его в pokatim.

## 3. Scope

- app-foundation (PR #21, релиз 0.6.0 — PR #22): `OutboxRoutes = Record<string, string | readonly string[]>`,
  публикаторы PostgreSQL/MongoDB ставят задачу в каждую очередь типа (jobId = id события), `mergeOutboxRoutes`,
  тип без очередей — ошибка старта.
- pokatim: каталог `@rkarakulov/*` 0.5.0 → 0.6.0; `src/outbox-routes.ts` — `workerOutboxRoutes =
  mergeOutboxRoutes(...subscriberOutboxRoutes)` вместо spread в `worker.module.ts`; сторож `outbox-routes.test.ts`;
  ADR-0017 п. 5 (отметка), `docs/product/notifications.md`, `pokatim-backend.md` («Outbox: маршруты»), комментарии.

## 4. Out of Scope

Подписка `standings`, `achievements`, `route-rides` на события вместо регламентов — у каждого своя задача (продукт и
проектирование: что остаётся от регламента, порядок событий, идемпотентность пересчёта).

## 8. Risks / Assumptions

- Сейчас ни один тип не объявлен двумя подписчиками — поведение публикации не меняется; сторож ловит будущий spread.
- `copier update` не делался (как и для 0.5.0, `_commit: v0.4.1`): шаблон в 0.6.0 изменил только комментарий
  `worker.module.ts.jinja`.

## 8.3 Security checklist

Новых эндпоинтов, данных и секретов нет. Зависимость — только `@rkarakulov/*` (собственный реестр, исключение
`minimumReleaseAge`).

## 9. Acceptance Criteria

1. pokatim на `@rkarakulov/*` 0.6.0, `pnpm check` зелёный.
2. Маршруты outbox собираются `mergeOutboxRoutes`; сторож: каждый (тип, очередь) подписчика есть в итоговой карте,
   лишних нет, у каждого типа есть очередь.
3. Документы отмечают fan-out сделанным, подписки потребителей — follow-up.

## 12. Outcome

- **Open follow-ups:** подписка `standings` на `results.protocol-published`/`result-revised` (вместо или поверх
  `standings.sync`); `achievements` — на события источников (вместо `achievements.sweep`); `route-rides` — на
  `tracks.activity-removed` (сделано — `2026-10-31-route-rides-activity-removed`).
- **Review:** Codex pass 1 — APPROVE, MEDIUM: сторож не отличал spread от `mergeOutboxRoutes` (типы подписчиков сейчас не
  пересекаются) → `buildOutboxRoutes` и тест на пересекающихся картах; отрицательное доказательство — с
  `Object.assign` вместо `mergeOutboxRoutes` тест красный.
