# Центр уведомлений: модуль notifications, push через Expo, экран в приложении

Уровень task3. Ветка `feature/notifications` от `origin/develop`. Продукт — `docs/product/notifications.md`
(N1–N12, тексты), ADR-0016.

## 1. Title

Центр уведомлений v1: события модулей → уведомления в приложении, Expo push (iOS/Android), e-mail для двух событий.

## 2. Goal

Райдер узнаёт о результатах, спорах и райдах, не открывая каждый экран. Решение A11 эпика результатов
(`docs/tasks/2026-10-27-race-results/epic.md`): модуль `notifications` подписан на outbox, модули-источники только
пишут события. Колокольчик на Главной (`docs/product/home.md`) появляется вместе с центром.

## 3. Scope

**Источники событий (пишут outbox в своих транзакциях, payload — только id и коды):**

- `results`: новое `results.attempt-verdict-changed {attemptId, raceId, userId, status}` — в транзакции записи вердикта
  (`attempt-check.processor.ts` `record`), только при смене видимого статуса на `counted` или `rejected`. Маршруты
  для существующих `results.protocol-published`, `results.result-revised`.
- `disputes`: маршруты для существующих `disputes.dispute-filed|-withdrawn|-responded|-decided`.
- `rides`: новые `rides.ride-cancelled`, `rides.ride-rescheduled` (по `changesStart`), `rides.participant-joined` —
  update/cancel/join переводятся на `MongoTransactions` + outbox. `rides.reports-resolved {rideId, reportIds}` — в
  транзакции `rides-moderation.service.ts` `act` (закрытые открытые жалобы). Массовая отмена при удалении аккаунта
  (`RideErasure`) тоже пишет `rides.ride-cancelled`.
- Каждый модуль-источник экспортирует через `index.ts` порт чтения для notifications (получатели и поля текста:
  название, дата, `userId` участников/сторон спора/авторов жалоб). Прямых чтений чужих коллекций нет.

**Модуль `apps/api/src/modules/notifications`:**

- Коллекции (миграция `0024_notifications`): `notifications` (TTL 90 дней по `expireAt`), `notification_settings`,
  `push_tokens`. Уникальность уведомления — `(sourceEventId, userId)`; схлопывание — `collapseKey` (N7).
- Очередь `notifications-intake`: событие outbox → получатели через порты → настройки → upsert уведомлений; событие
  старше 72 ч — skip. Повтор задачи не создаёт дублей (уникальный ключ).
- Очередь `notifications-delivery`: push через Expo Push API и письма (N2). Состояние доставки — в документе
  уведомления (claim/lease/complete как `link-email.handler.ts`); ретраи BullMQ; повтор не шлёт второй push/письмо.
  Тихие часы — отложенная задача до конца интервала; сводка «У вас N новых уведомлений» при >1 отложенном. Лимит
  20 push/час на райдера (сверх — только центр).
- Регламент `notifications-maintenance`: чек квитанций Expo (receipts) → `DeviceNotRegistered` снимает токен.
- Текст уведомления рендерится на сервере при создании (заголовок, текст — строки `packages/i18n` или словарь
  модуля, решает architect) и хранится снимком; цель deep link — `{type: race|ride|dispute-response, ids}`.
- API (`/v1/notifications`, AuthGuard, только свои): список с курсором, `GET unread-count`, `POST {id}/read`,
  `POST read-all`, `GET/PUT settings`, `PUT push-tokens` (регистрация/обновление токена устройства),
  `POST push-tokens/revoke` (снять токен этого устройства — до выхода из аккаунта). Rate limit на мутации по
  userId (как `ride-reports.service.ts`).
- Удаление аккаунта: порт `PushTokens.revokeAllOf(tx, userId)` в транзакции `account-deletion.service.ts`; шаг
  стирания `notifications` в `account-erasure.service.ts` (уведомления, настройки, токены).
- Env: `EXPO_ACCESS_TOKEN` (необязательный, секрет), `PUSH_ENABLED` (по умолчанию false в тестах; без него push
  помечается `skipped`).

**Контракты (`packages/contracts/src/notifications/`):** DTO списка, счётчика, настроек, регистрации токена,
цели deep link, коды ошибок. `packages/api-client` — методы.

**Приложение `apps/app`:**

- Колокольчик со счётчиком в `components/top-bar.tsx` на Главной (polling `unread-count`, «99+», a11y-лейбл
  «Уведомления, N непрочитанных»).
- Экран `/notifications`: список (AsyncContent + Skeleton, пусто, ошибки с повтором, бесконечная прокрутка),
  нажатие → read + переход по цели, «Прочитать все», строка «Включить push» (native), вход в настройки.
- Экран `/settings/notifications`: группы × push/e-mail, тихие часы (вкл/выкл, начало и конец по часам), вход из
  центра и из профиля.
- Push: `expo-notifications` — разрешение по нажатию (N5), регистрация токена при входе и смене, снятие при выходе
  (`useSignOut` до `api.signOut`), обработка нажатия на push → маршрут по цели. Web: развилка `*.web.ts` без push.
  Нет `projectId` EAS — регистрация не выполняется, остальное работает.
- UI минимальный: существующие компоненты `@rkarakulov/ui` и токены (параллельно идёт сессия «Темы приложения»).
- Строки — `packages/i18n`.

## 4. Out of Scope

Web push, e-mail кроме N2, дайджесты, удаление уведомлений вручную, уведомления в панели «Протокол», WebSocket,
рейтинг сезона (08) и fan-out для него, правки `@rkarakulov/*` (app-foundation), EAS-настройка ключей APNs/FCM
(ручной шаг, runbook).

## 5. Architecture Context

- api (модули notifications, results, disputes, rides, account), contracts, api-client, i18n, app.
- Outbox: один тип → одна очередь (`OutboxRoutes`). Все новые маршруты событий-источников ведут в
  `notifications-intake`, кроме уже занятых.
- Миграция `0024_notifications` — expand (новые коллекции и индексы), не деструктивная.
- Совместимость клиентов: новые эндпоинты; старые приложения их не вызывают.

## 5.1 Placement & Reuse Gate

- Reuse: `MongoOutboxWriter/Reader`, `MongoTransactions`, `RateLimiter` api-kit, `MAILER` и шаблоны писем
  (`identity/mail/html.ts` — через экспорт или копия разметки решает architect), `page-cursor.ts`,
  `IdentityAccounts.emailsOf`, `AsyncContent`/`Skeleton*`, компоненты `@rkarakulov/ui`, `expo-symbols` для иконки.
- Запрещено: чтение чужих коллекций из notifications; userId и тексты в payload событий споров (D-51); свой
  HTTP-клиент поверх contracts; хардкод стилей в приложении.
- Контроллеры тонкие, логика — сервисы; чужой модуль — только `index.ts`.

## 6. Relevant Files

- `apps/api/src/worker.module.ts`, `apps/api/src/queues.ts` — маршруты и очереди.
- `apps/api/src/modules/results/attempt-check.processor.ts`, `results-protocol.service.ts`, `results.repository.ts`.
- `apps/api/src/modules/disputes/disputes.events.ts`, `disputes.collection.ts`.
- `apps/api/src/modules/rides/rides.service.ts`, `rides.repository.ts`, `rides-moderation.service.ts`,
  `ride-reports.repository.ts`, `ride-erasure.ts`.
- `apps/api/src/modules/account/account-deletion.service.ts`, `account-erasure.service.ts`, `account.module.ts`.
- `apps/api/src/modules/identity/jobs/link-email.handler.ts` — образец идемпотентной доставки.
- `apps/api/src/db/migrations/index.ts`, `0017_ride_reports.ts`, `0003_identity_ttl.ts`.
- `apps/app/src/components/top-bar.tsx`, `apps/app/src/app/(tabs)/index.tsx`, `apps/app/src/app/_layout.tsx`,
  `apps/app/src/features/auth/use-sign-out.ts`, `apps/app/src/app/settings/profile.tsx`.

## 7. Implementation Notes

- Вердикт: уведомлять только при смене статуса относительно прошлого вердикта попытки (массовая перепроверка не
  спамит); `failed`/`withdrawn` не уведомляют.
- `result-revised`: `disqualified`/`disqualification_revoked` — райдеру `entryId`; `recheck_applied` — всем
  участникам с результатом.
- `collapseKey`: `ride:<id>:joined`, `ride:<id>:rescheduled` — upsert заменяет текст, сбрасывает `readAt`, обновляет
  `createdAt` (поднимается наверх).
- Старые события: время события — из uuidv7 id outbox; > 72 ч — skip с логом.
- Push payload: `data: {target}` без ПДн сверх текста; `sound: default`; токен — только формат `ExponentPushToken[…]`.
- Тихие часы: `start/end` — часы 0–23, интервал может переходить через полночь; `start == end` недопустимо.
- Выход: `POST /v1/notifications/push-tokens/revoke` с токеном устройства, ошибка не блокирует выход.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` всё помеченное в `docs/product/notifications.md`.
- Нет EAS `projectId` и ключей APNs/FCM — push на устройствах не проверяется на dev; проверка — центр (web).
- Слайс 08 и fan-out — ADR-0016, follow-up.
- Rides без транзакций: перевод update/cancel/join на транзакции — регресс-риск, покрыть существующими int-тестами.

## 8.1 Requirements Consistency (заполняет architect)

- **Конфликт с инвариантом:** AGENTS §1/§4.9 «нет push» vs N1 → снято решением автора, ADR-0016, правка AGENTS §1.

## 8.2 Deviations from spec

## 8.3 Security checklist

AuthN/AuthZ: все эндпоинты под AuthGuard, выборки только по `userId` из сессии; чужое уведомление → 404.
Входные данные: zod-контракты, токен — строгий формат. Данные наружу: без ПДн других райдеров (N12). Злоупотребления:
rate limit мутаций и регистрации токенов, лимит токенов на пользователя (10). Секреты: `EXPO_ACCESS_TOKEN` только env,
не в логах; push-токены в логах не печатаются. Удаление: токены — синхронно в транзакции.

## 9. Acceptance Criteria

1. Каждое событие N3 создаёт уведомление нужным получателям с текстом из таблицы; посторонним — нет.
2. Повтор задачи intake/delivery (тот же jobId, повторная публикация) не создаёт второго уведомления, push или письма.
3. `GET /v1/notifications` и `unread-count` видят только свои; `POST {чужой id}/read` → 404.
4. read, read-all, settings, push-tokens — работают, rate limit → 429.
5. Push не уходит при выключенной группе, в тихие часы откладывается, отложенные >1 — одна сводка; e-mail — только N2
   и по тумблеру.
6. `DeviceNotRegistered` снимает токен; выход снимает токен устройства; удаление аккаунта снимает все токены в
   транзакции, стирание удаляет уведомления, настройки и токены.
7. Перепроверка без смены статуса не создаёт уведомлений; событие старше 72 ч — skip.
8. Приложение: колокольчик со счётчиком, центр, настройки — iOS, Android, web; i18n, a11y; состояния §4.12.
9. `TURBO_CONCURRENCY=1 pnpm check` зелёный; arch:check — notifications ходит в чужие модули только через index.ts.

## 10. Documentation Impact

`docs/product/notifications.md` (новый), ADR-0016 + `docs/adr/README.md`, AGENTS §1 (push), `docs/product/home.md`
(колокольчик), `docs/product/account.md` A6 (push), `docs/product/README.md`, `docs/runbooks/push.md` (EAS, ключи,
env), `.claude/rules/pokatim-backend.md` (маршруты notifications), `docs/runbooks/account-deletion.md` (шаг).

## 11. Implementation Context

## 12. Outcome
