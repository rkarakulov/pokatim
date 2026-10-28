# Уведомление автору о решении по заявке маршрута (task2)

## 1. Title

Подключить outbox `routes.publication-decided` к центру уведомлений.

## 2. Goal

routes-06 (A6, `docs/product/routes.md`) пишет событие решения модератора по заявке маршрута райдера в каталог, но
маршрута в очередь у него нет: событие лежит в outbox с `publishedAt: null`, автор узнаёт о решении только из «Моих».
Подключаем событие к `notifications` (ADR-0017): автору приходит «Маршрут опубликован» или «Маршрут отклонён» с
причиной.

## 3. Scope

- `routes`: порт чтения `RouteNotices` (`ROUTE_NOTICES`, через `index.ts`) — название, владелец, статус заявки,
  `decidedAt`, код причины отклонения; экспорт события и схемы payload.
- `notifications`: тип в `notificationsOutboxRoutes`, разбор в `NotificationIntake`, тексты, группа.
- `contracts`: виды `route_published`, `route_rejected` (в конец справочника), цель `{ type: 'my-route', routeId }`.
- `app`: путь цели `my-route` → `/routes/mine/<id>`.

## 4. Out of Scope

Новая группа настроек «Маршруты», письмо, комментарий модератора в тексте, бейдж на Главной.

## 5. Architecture Context

- api: `modules/routes` (порт, `RoutesRepository.findForNotice`), `modules/notifications` (intake, тексты, политика).
- contracts: расширение справочника (`tolerantEnum` у клиента) и union цели (`NotificationTargetView` старой сборки
  отдаёт `unknown` — без перехода). Совместимо со старыми версиями приложения.
- Миграций и новых очередей нет. Outbox: маршрут события → `notifications-intake`.

## 5.1 Placement & Reuse Gate

- Reuse: схема `RoutePublicationDecided` (`routes.events.ts`), `isEventStale` (72 ч), `RideNotices`-образец порта,
  `writeNotices` и `collapseKey`, `quoted()` текстов.
- `notifications` коллекцию `routes` не читает — только порт; `routes` о `notifications` не знает.
- Подписи причин — словарь в `notification-texts.ts` (api не зависит от `@pokatim/i18n`, как `OUTCOME`).

## 6. Relevant Files

- `apps/api/src/modules/routes/route-notices.port.ts`, `route-notices.ts` — порт и реализация (новые).
- `apps/api/src/modules/routes/{index.ts,routes.module.ts,routes.repository.ts}` — экспорт, провайдер, проекция.
- `apps/api/src/modules/notifications/{notifications.events.ts,notification-intake.ts,notification-texts.ts,notifications.policy.ts,notifications.module.ts}`.
- `packages/contracts/src/notifications/notification.schema.ts` — виды и цель.
- `apps/app/src/features/notifications/notification-target.ts` — путь цели.

## 7. Implementation Notes

- Получатель — `ownerUserId` маршрута из порта (payload — только id и коды, RC-1).
- Решение пересмотрено к моменту приёма (статус ≠ `decision` или `decidedAt` ≠ события: новая подача, скрытие,
  отзыв, удаление) — `state`/`gone`, без уведомления о прежнем решении.
- `collapseKey: route:<id>:publication` — новое решение по тому же маршруту заменяет прежнее уведомление.
- Хвост накопленных событий (правило «хвост», 8.1 RC-3 routes-06): intake пропускает события старше 72 ч по времени
  uuidv7 id события (`isEventStale`) — строже 7 дней правила; подтверждается int-тестом.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` Группа — «Райды» (N4: три группы; новая группа — смена контракта настроек и экрана). Push
  выключенной группы «Райды» гасит и это уведомление; в центре оно видно всегда.
- `[ASSUMPTION]` Причина `other` без подписи: «Подробности — в карточке маршрута» (комментарий модератора — N12).

## 8.1 Requirements Consistency

Правило «хвост» (`pokatim-backend.md`) предлагает миграцию или пропуск по `decidedAt` старше 7 дней; общий порог
intake 72 ч строже и уже применяется ко всем событиям — используем его, отдельный порог не нужен.

## 8.2 Deviations from spec

Нет.

## 8.3 Security checklist

Новых эндпоинтов нет. Данные наружу: название своего маршрута и код причины — только автору. Чужих ПДн и
комментария модератора в тексте нет (N12). Цель — id из белого списка (N10).

## 9. Acceptance Criteria

1. Одобрение заявки → у автора уведомление `route_published`, «Маршрут опубликован», цель `my-route`, группа `rides`.
2. Отклонение → `route_rejected`, «Маршрут отклонён», в тексте подпись причины; `other` — без подписи.
3. Посторонним — ничего; повтор задачи — без дублей; новое решение по маршруту схлопывает прежнее.
4. Событие старше 72 ч — `stale`; решение пересмотрено — `skipped`; маршрут удалён — `skipped`.
5. Событие доходит до `notifications-intake` через публикатор outbox (`publishedAt` проставлен).
6. Приложение открывает `/routes/mine/<id>` по цели `my-route`.

## 10. Documentation Impact

`docs/product/notifications.md` (N3, N10, тексты), `.claude/rules/pokatim-backend.md` (публикация маршрутов,
уведомления), ADR-0017 — список источников.

## 11. Implementation Context

ENTRY POINTS: `NotificationsIntakeProcessor.process` → `NotificationIntake.drafts`.
TESTS: `notification-texts.test.ts`, `notifications.policy.test.ts`, контракты, `notification-target` (app),
`notifications-intake.int.test.ts` (маршруты), `routes-moderation.int.test.ts` (публикация события).

## 12. Outcome

Заполняется после реализации.
