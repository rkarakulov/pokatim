# Центр уведомлений: модуль notifications, push через Expo, экран в приложении

Уровень task3. Ветка `feature/notifications` от `origin/develop`. Продукт — `docs/product/notifications.md`
(N1–N12, тексты), ADR-0017.

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
  update/cancel/join переводятся на `MongoTransactions` + outbox. `rides.reports-resolved {rideId, resolvedAt}` (RC-3) — в
  транзакции `rides-moderation.service.ts` `act` (закрытые открытые жалобы). Массовая отмена при удалении аккаунта
  (`RideErasure`) тоже пишет `rides.ride-cancelled`.
- Каждый модуль-источник экспортирует через `index.ts` порт чтения для notifications (получатели и поля текста:
  название, дата, `userId` участников/сторон спора/авторов жалоб). Прямых чтений чужих коллекций нет.

**Модуль `apps/api/src/modules/notifications`:**

- Коллекции (миграция `0025_notifications`, RC-5): `notifications` (TTL 90 дней по `expireAt`), `notification_settings`, `push_tickets`,
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

Architecture Review (architect, 2026-10-27): **CONCERNS** — блокеров нет, решения ниже обязательны для coder.

- Затронуто: api (новый модуль `notifications`; `results`, `disputes`, `rides`, `identity`, `account`; `queues.ts`,
  `worker.module.ts`, `app.module.ts`, `config/env.ts`, миграции), contracts, api-client, app.
- Граф модулей (Nest и dependency-cruiser): `notifications → results, disputes, rides, races, identity` — только
  через их `index.ts`; `account → notifications` (порты `PushTokens`, `NotificationErasure`). `results`, `disputes`,
  `rides`, `races`, `identity` о `notifications` не знают (циклов нет). Ядро `NotificationsCoreModule` не импортирует
  модули-источники — `account` не тянет `results`/`rides` транзитивно.
- Outbox: один тип → одна очередь (`OutboxRoutes` базы — `Record<string, string>`). Маршруты чужих типов объявляет
  **подписчик** (как `resultsOutboxRoutes` для `tracks.*`): `notificationsOutboxRoutes` в
  `notifications/notifications.events.ts` — 11 типов → `QUEUE.notificationsIntake`. Ни один из них сейчас не
  маршрутизирован (проверено: `results.protocol-published`/`result-revised` и `disputes.*` лежат с
  `publishedAt: null`). После выката публикатор выгрузит накопленные — intake отсечёт их по 72 ч.
- Очереди: `notifications-intake` (событие → уведомления), `notifications-delivery` (push по пользователю, письмо по
  уведомлению), `notifications-maintenance` (квитанции Expo, перепостановка зависших доставок).
- Миграции: `0025_notifications` — expand (коллекции и индексы), `0026_attempt_last_verdict` — бэкфилл нового поля
  попыток (не деструктивно). Последняя применённая — `0023_account_deletion` (проверено в `migrations/index.ts`).
- Совместимость клиентов: только новые эндпоинты и поля; старые сборки их не вызывают. Новые enum-ы ответов —
  `tolerantEnum`, неизвестная цель — `{ type: 'unknown' }` (уведомление без перехода).
- Rides: `update`/`cancel`/`join` и отмена при стирании переходят на `MongoTransactions` + outbox; инвариант
  участия не меняется — по-прежнему **одна условная операция над документом райда** (фильтр с лимитом, статусом,
  временем, членством), транзакция только добавляет событие (поправка ADR-0013 п. 2 — в ADR-0017).

## 5.1 Placement & Reuse Gate

- **Placement.** `apps/api/src/modules/notifications/` (новый контекст, уже перечислен в `pokatim-backend.md`):
  `notifications.controller.ts` (тонкий) → `notifications.service.ts` / `notification-settings.service.ts` /
  `push-tokens.service.ts` → `notifications.repository.ts` (+ `notifications.collection.ts`); worker —
  `notifications-intake.processor.ts`, `notifications-delivery.processor.ts`, `notifications-maintenance.processor.ts`;
  чистая логика — `notifications.policy.ts` (тихие часы, группы, правила получателей), тексты —
  `notification-texts.ts`; Expo — порт `push-sender.ts` + адаптер `expo-push.sender.ts`. Новый пакет не нужен
  (один потребитель); общий для проектов Expo-клиент — кандидат в app-foundation позже, не в этой задаче.
- **Reuse (обязательно):** `MongoOutboxWriter/Reader`, `MongoTransactions`, `uuidv7`, `isDuplicateKey`
  (`api-kit/mongo`); `RateLimiter`, `MAILER`, `CLOCK`, `ENV` (`api-kit/core`); `src/page-cursor.ts`
  (`encodeCursor/decodeCursor`); `IdentityAccounts.emailsOf` (+ новый `liveUserIds`); `RaceRegistry.get` (название
  гонки — через `RacesCoreModule`, его реэкспортирует `ResultsCoreModule`); `escapeHtml`/`htmlEmail` из
  `identity/mail/html.ts` — **экспортом через `identity/index.ts`** (не копия); `PLATFORM_TIME_ZONE` из
  `@pokatim/contracts`; `tolerantEnum`, `Uuid`, `fieldError` (`contracts/common.ts`); образец адаптера внешнего HTTP —
  `devices/open-wearables.aggregator.ts` (таймаут, лимит тела, zod-ответ, ключ только из env), образец фейк-сервера
  для int-тестов — `apps/api/test/fake-ow.ts`; образец идемпотентной доставки — `identity/jobs/link-email.handler.ts`.
  Приложение: `AsyncContent`, `SkeletonListRow`, `EmptyState`, `Banner`, `Toggle`, `Chip`, `Pill`, `TextAction`,
  `Button`, `SectionHeader` (`@rkarakulov/ui`), `BottomSheet` (`components/bottom-sheet`), `SymbolView`
  (`expo-symbols`), `withAccessToken`/`api` (`lib/api.ts`), `minsk-format.ts`.
- **Запрещено:** чтение чужих коллекций из `notifications` (только порты); `userId`, тексты и массивы id жалоб в
  payload событий; импорт `@pokatim/i18n` в api (строки сервера — словарь модуля, как `error-messages.ts` и письма
  identity); свой HTTP-клиент в приложении (только `@pokatim/api-client`); `Platform.OS` в экранах (развилка
  `push(.web).ts`); hex/px в компонентах колокольчика; `createIndex` вне миграций; `new Date()` в сервисах.

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

- **Вердикт (видимый статус).** Сейчас прошлый вердикт не сохраняется: `requeueAttempt` стирает `status` в `queued`.
  Новое поле попытки `lastVisibleVerdict?: 'counted' | 'rejected' | null` (чтение `?? null`), **не** сбрасывается
  `requeueAttempt`. Видимый вердикт итога = `counted`/`rejected` **и** `!attemptHidden({ origin, status, matched,
  reasons })` (`results.policy.ts`): авто-попытка без полного сегмента и `implausible` скрыты от райдера — о них
  «не засчитан» не шлём (иначе каждый заезд рядом с коридором = уведомление). В `AttemptCheckProcessor.record`
  внутри транзакции: `next = visibleVerdict(attempt.origin, result)`; `recordCheck` пишет
  `lastVisibleVerdict: next ?? attempt.lastVisibleVerdict ?? null` (провал/снятие прежний не затирают); событие
  `results.attempt-verdict-changed` — только если `next !== null && next !== (attempt.lastVisibleVerdict ?? null)`.
  Бэкфилл `0026_attempt_last_verdict`: `status ∈ {counted, rejected}` и поля нет → `lastVisibleVerdict = status`
  (pipeline `$set`), иначе первая же перепроверка старых гонок разошлёт «засчитан» повторно. `failed`, `withdrawn`,
  `excluded` и `failAttempt` регламента — без события.
- **`result-revised`:** `disqualified`/`disqualification_revoked` — владельцу `entryId`; `recheck_applied` —
  `userId` строк ревизии `revision` (участники с результатом). **`protocol-published`** — `userId` активных заявок
  гонки (`race_entries_race_idx`), включая без результата.
- **Споры:** получатели — `DisputeNotices.parties(disputeId)`: `filed`, `withdrawn` → `targetUserId`; `responded` →
  `complainantUserId`; `decided` → оба. Исход: `upheld` → «спор удовлетворён», `rejected` → «спор отклонён»
  `[ASSUMPTION]`.
- **Райды:** `ride-cancelled`, `ride-rescheduled` → участники «Иду» без организатора; `participant-joined` →
  организатор; `reports-resolved` → авторы жалоб, закрытых этим действием. Райд в момент intake не в ожидаемом
  статусе (`cancelled` для отмены, `published` для переноса и участника) — skip.
- **`collapseKey`:** `ride:<id>:joined`, `ride:<id>:rescheduled`. Upsert по `{ userId, collapseKey, sourceEventId:
  { $lt: eventId } }` (uuidv7 упорядочены по времени — устаревшее событие не перетирает новое): `$set` заголовка,
  текста, `sourceEventId`, `readAt: null`, `createdAt: now`, `expireAt`, push → `pending`. Совпадения нет → вставка →
  `isDuplicateKey(e, 'notifications_collapse_unique')` = событие устарело или повтор — не ошибка.
- **Возраст события:** `eventTimeOf(outboxEventId)` — первые 48 бит uuidv7 (своего хелпера в api-kit нет, локальный
  `notifications/event-time.ts` + unit). `clock.now() − eventTime > 72 ч` → `skipped`, лог
  `notifications.event_stale type=<t> event=<id>`. `createdAt` уведомления — `clock.now()` при intake (не время
  события). ⚠ `uuidv7()` берёт `Date.now()`, а не `CLOCK`: в int-тестах `TestClock` стоит в 2026-10-22, события
  «из будущего» — тест старого события сдвигает часы на `Date.now() − clock.now() + 73 ч` или пишет событие в outbox
  с id, собранным на нужный момент (хелпер в `test/notifications.ts`).
- **Получатели живые.** Перед записью — `IdentityAccounts.liveUserIds(ids)` (новый метод: `deletedAt: null`,
  проекция `_id`): удалённым уведомления не создаются (их заявки и строки протоколов остаются — иначе стирание
  обгоняли бы новые документы).
- **Push payload:** `{ to, title, body, sound: 'default', data: { target } }`, сводка — `data: { target: null }`
  (приложение откроет `/notifications`). Без имён и e-mail. Android — `channelId: 'default'` (канал создаёт
  приложение). Токен — `^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$`.
- **Тихие часы:** `startHour/endHour` 0–23 по Минску, интервал может переходить через полночь, `start == end` —
  400 (`fieldError('INVALID')`, путь `quietHours.endHour`). `quietUntil(now, settings): Date | null` — чистая
  функция (`notifications.policy.ts`) через `PLATFORM_TIME_ZONE`; `notBefore = quietUntil ?? now`. Письма тихие часы
  не задерживают.
- **Сводка:** «У вас {N} новых уведомлений» — с русскими формами множественного числа (1 новое уведомление, 2 новых
  уведомления, 5 новых уведомлений) — `ruPlural` в `notification-texts.ts` `[ASSUMPTION: правка текста продукта]`.
- **Лимит 20 push/ч:** `RateLimiter.consume('notifications-push:<uid>', { limit: 20, windowSec: 3600 })` **после**
  захвата (повтор задачи захвата не получит и лимит не тратит); сводка = 1 push; отказ — `push.state: 'limited'`.
- **Выход:** `POST /v1/notifications/push-tokens/revoke { token }` до `signOut` сессии; ошибка и таймаут (3 с) не
  блокируют выход; после удаления аккаунта (`notice: 'accountDeleted'`, сессия уже отозвана) — не вызывается: токены
  сняты сервером в транзакции.
- **Письма N2** (`ride_cancelled`, `dispute_decided`): тема = заголовок, текст = снимок + «Откройте приложение
  „Покатим“» — без ссылки (`pokatim://` в почте на десктопе не открывается) `[ASSUMPTION]`; адрес —
  `IdentityAccounts.emailsOf` в момент отправки (удалённого нет — `skipped`).

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` всё помеченное в `docs/product/notifications.md`.
- Нет EAS `projectId` и ключей APNs/FCM — push на устройствах не проверяется на dev; проверка — центр (web).
- Слайс 08 и fan-out — ADR-0017, follow-up.
- Rides без транзакций: перевод update/cancel/join на транзакции — регресс-риск, покрыть существующими int-тестами.

## 8.1 Requirements Consistency (заполняет architect)

Итог: противоречий, требующих человека до старта coder, нет; ниже — конфликты, которые снимает ADR-0017, и
недоопределённости с принятым решением (`R` — рекомендация architect, реализуется по ней).

- **RC-1 Конфликт с инвариантом (снят автором).** AGENTS §1 и §4.9 «нет push», `pokatim-app.md` (строки «нет push»,
  «уведомления — только in-app»), `docs/product/account.md` A6 «push в MVP нет» vs N1. Снимает ADR-0017 + правка этих
  мест в той же PR. Ключевые пункты ADR-0017:
  1. Push — Expo Push Service (новый внешний сервис, исходящий HTTPS только на `exp.host`); web push — нет.
  2. Модуль `notifications` — единственный потребитель событий для уведомлений; модули-источники пишут только
     outbox (payload — id и коды) и дают порт чтения получателей через `index.ts`.
  3. Текст рендерится сервером при создании и хранится снимком; цель — тип + id из белого списка, адресов нет.
  4. Доставка at-least-once: захват (lease) в документе уведомления, остаточный риск — дубль push/письма при падении
     worker между ответом Expo/SMTP и записью факта.
  5. Outbox «тип → одна очередь»: `results.protocol-published` и `results.result-revised` теперь уходят в
     `notifications-intake`. Слайсу 08 (рейтинг) нужен fan-out — **задача в app-foundation**: `OutboxRoutes =
     Record<string, string | readonly string[]>` (jobId = id события в каждой очереди). Альтернативы: (б) intake
     уведомлений после обработки ставит задачу рейтинга — связывает несвязанные модули, нет; (в) `results` пишет два
     события (второе — для 08) — дубль источника, допустимо как временная мера. Рекомендация — (а). События, уже
     опубликованные в `notifications-intake`, слайсу 08 не достанутся — ему нужен бэкфилл по `race_recalculations`.
  6. Поправка ADR-0013 п. 2: «Я иду», правка и отмена — по-прежнему одна условная операция над документом, но в
     транзакции с outbox (без замков и чтения-проверки).
  7. Хранение: 90 дней TTL; токены — до снятия (выход, `DeviceNotRegistered`, удаление аккаунта в транзакции).
  8. Секрет `EXPO_ACCESS_TOKEN` — только env; `PUSH_ENABLED=false` по умолчанию.
- **RC-2 Недоопределённость: «смена видимого статуса» не вычислима из данных.** `requeueAttempt` стирает прежний
  вердикт; кроме того, авто-попытки без полного сегмента скрыты (`attemptHidden`) — уведомлять о них «не засчитан»
  вредно (спам за каждую поездку рядом с коридором). Варианты: (а) поле `lastVisibleVerdict` + бэкфилл — **R**;
  (б) сравнивать с `entry.best`/`summary` — теряет отказ при наличии лучшего; (в) уведомлять любой вердикт — спам
  при перепроверке. Детали — §7.
- **RC-3 Payload `rides.reports-resolved {rideId, resolvedAt}`** — массив не ограничен (жалоб на райд — сколько
  угодно пользователей). **R:** `{ rideId, resolvedAt }` (ISO); авторы — `RideNotices.resolvedReporters(rideId,
  resolvedAt)` по `ride_reports_ride_idx` (закрытие пишет один `resolvedAt` на все). Альтернатива — `reportIds` с
  потолком 100 — нет: молча теряет авторов.
- **RC-4 Удалённые получатели.** Заявки, строки протоколов и споры удалённого остаются (A9) → intake создавал бы ему
  уведомления после стирания. **R:** фильтр `IdentityAccounts.liveUserIds` в intake + проверка в доставке; гонка
  «`PUT push-tokens` ↔ транзакция удаления» (разные документы) закрывается проверкой живости в доставке и шагом
  стирания (повтор через 15 мин).
- **RC-5 Четыре коллекции, а не три.** Квитанции Expo приходят по id тикета через ≥15 мин; хранить их негде.
  **R:** `push_tickets` (TTL 24 ч). Альтернатива — массив в `push_tokens` — растёт без границы, нет.
- **RC-6 Отсечка 72 ч по uuidv7.** Хелпера в api-kit нет; `uuidv7` берёт `Date.now()`, не `CLOCK` — тесты (§7).
  Альтернатива — `createdAt` outbox — `MongoOutboxReader` его не отдаёт, прямое чтение `outbox` — обход базы, нет.
- **RC-7 Текст сводки** «У вас {N} новых уведомлений» грамматически неверен для 1, 2–4, 21… **R:** формы числа
  (§7). Не блокер; автор может вернуть одну форму.
- **RC-8 Отмена скрытых райдов при стирании** (`cancelHiddenFutureOf`, `hiddenFromStatus: 'cancelled'`) — участники
  скрытый райд не видят, цель вела бы на «Не найдено». **R:** без события. Отмена `published` — событие на каждый
  райд в своей транзакции.
- **RC-9 Тексты: i18n или словарь модуля.** `@pokatim/i18n` — строки клиентов (app, admin), api от него не зависит;
  тексты писем и ошибок сервера уже живут в api. **R:** `notifications/notification-texts.ts` (типизированный
  словарь по `kind`, unit-тест на каждую строку таблицы продукта). Строки экранов приложения — `packages/i18n`.
- **RC-10 Подмена Expo в тестах.** `createMongoApiHarness` не умеет `overrideProvider`. **R:** env
  `EXPO_PUSH_API_URL` (по умолчанию `https://exp.host/--/api/v2/push`; в production+prod — только этот адрес,
  `envDependencyErrors`) + фейк-сервер `test/fake-expo.ts` по образцу `fake-ow.ts`; сервис доставки дополнительно
  покрыт unit-тестами с фейком порта `PushSender`.
- **RC-11 Expo Go и projectId.** Удалённые push в Expo Go на Android не работают (с SDK 53), в `app.json`/`eas.json`
  нет `extra.eas.projectId`. Регистрация без `projectId` или на симуляторе (`Device.isDevice === false`) не
  выполняется, строка «Включить push» остаётся (разрешение можно дать) — проверка push только в dev build после
  runbook. Не блокер.
- **RC-12 Нагрузка «Я иду» в транзакции.** Параллельные записи на один райд теперь конфликтуют и повторяются
  драйвером (`withTransaction`) вместо сериализации на документе. Для ≤100 участников приемлемо; регресс-сторож —
  существующий `rides-participation.int.test.ts` (параллельные записи на последнее место) без правок ожиданий.
- **RC-13 Настройки не ретроактивны:** выключенная группа не удаляет уже созданные уведомления центра (N4: центр
  видит всё); push проверяет тумблер и тихие часы ещё раз в момент отправки.
- Вредных решений и конфликтов с §4 сверх RC-1 не найдено. Серверный авторитет: клиент присылает только намерение
  (прочитать, настройки, токен); получателей, тексты и цели считает сервер.

## 8.2 Deviations from spec

- **M-1 (слияние develop, оркестратор).** develop (темы приложения, PR #69) занял миграцию `0024` и ADR-0016:
  миграции слайса перенумерованы в `0025_notifications` и `0026_attempt_last_verdict`, ADR — в
  `0017-notifications-and-push.md`. Упоминания `0024`/`0025` в отчётах шагов ниже — номера до слияния.
  Колокольчик рисуется через `Icon` (`bell`) — единственный вход `expo-symbols` по ADR-0016 тем.
- **A-1 (шаг A).** Уведомления в int-тестах шага A вставляются хелпером `test/notifications.ts` прямо в коллекцию
  (`notificationsCollections(h.db)`), а не методом репозитория: метода вставки «только для тестов» в репозитории нет,
  запись уведомлений появится в intake (шаг B). Причина — не держать мёртвый код в единственном писателе.
- **A-2 (шаг A).** `NotificationsCoreModule` экспортирует ещё и `NotificationsRepository` (его внедряют сервисы
  `NotificationsModule` и будущие процессоры worker). Наружу через `index.ts` репозиторий не выходит — только порты.
- **A-3 (шаг A, недоопределённость текстов).** Формат дат в текстах: заезд — «14 июня» (день и месяц), райд — «14
  июня, 10:00» (по Минску). Исход спора — дословно §7: «спор рассмотрен — спор удовлетворён / спор отклонён»; повтор
  слова «спор» в одной фразе — вопрос к автору, заменить можно одной строкой `OUTCOME` в `notification-texts.ts`.
  **Решено (шаг B, оркестратор):** `OUTCOME = { upheld: 'удовлетворён', rejected: 'отклонён' }` — «{гонка}: спор
  рассмотрен — удовлетворён.»
- **B-1 (шаг B, reuse).** Отмена при стирании (`RideErasure`) — существующий `RidesRepository.cancel(id,
  organizerUserId, 'organizer_unavailable', now, tx)` (тот же фильтр: организатор, `published`, `startsAt > now`)
  вместо нового `cancelOne`; получатели «Протокол опубликован» — существующий `activeEntryUserIds` репозитория.
- **B-2 (шаг B).** «Жалоба рассмотрена» по скрытому модерацией райду — `target: null` (райд автору не виден, переход
  вёл бы на «Не найдено»); по отклонённым жалобам — цель `ride`.
- **B-3 (шаг B).** Письмо N2 при выключенном тумблере e-mail группы — `email.state: 'skipped'` (а не `null`): видно,
  что письмо было положено и не ушло по настройке; прочим событиям — `null`.
- **B-4 (шаг B, недоопределённость).** `rides.ride-rescheduled` пишется, только если правка меняет старт
  (`changesStart`) **и** `rescheduledAt` поставлен этой записью: правка не старта в тот же миллисекундный момент
  (`TestClock`) события не даёт.
- **C-1 (шаг C, документация).** context7 в сессии недоступен (MCP не подключился): формат Expo Push API (`POST
  …/send` — массив ≤ 100, ответ `{ data: [{ status: 'ok', id } | { status: 'error', message, details: { error } }] }`;
  `POST …/getReceipts { ids ≤ 1000 }` → `{ data: { <id>: … } }`; код `DeviceNotRegistered`) и семантика BullMQ
  (`add` с существующим `jobId` в любом состоянии — no-op) — по памяти и `node_modules`.
- **C-2 (шаг C, недоопределённость jobId).** BullMQ хранит завершённые задачи (`removeOnComplete: 1000`) и молча
  отбрасывает `add` с тем же `jobId`: новое уведомление пользователя в тот же миллисекундный `notBefore` и
  перепостановка регламентом терялись бы. Постановка — `DeliveryJobs` (новый `delivery-jobs.ts`): живая задача с тем
  же jobId — пропуск, завершённая/упавшая — удаляется и ставится заново.
- **C-3 (шаг C).** Исходы push сверх §11: удалённый аккаунт в момент отправки — `skipped/deleted`; все тикеты с ошибкой —
  `failed` с кодом Expo (`DeviceNotRegistered` при этом снимает токены); письмо удалённому — `skipped`. Тумблер e-mail
  в момент отправки не перепроверяется (только intake, §11).

- **D-1 (шаг D, UI минимальный).** Тихие часы — ряды `Chip` 0–23 прямо на экране настроек (без `BottomSheet` и
  `quiet-hours-sheet.tsx`); час другого края в ряду не показывается — `start == end` из UI недостижимо (сервер
  по-прежнему отвечает 400). Список центра — в самом экране (`app/notifications.tsx`, без `notifications-list.tsx`).
- **D-2 (шаг D, развилки).** Весь нативный push — в одном `features/notifications/push.ts` (+ `push.web.ts` no-op):
  разрешение, канал, токен, хранение, подписка на нажатия. Хуки и регистрация (`push-registration.ts`:
  `registerDevicePush`, `revokeDevicePushToken`, `usePushNotifications(ready, queryClient)`) платформонезависимы —
  отдельных `push-responses(.web).ts`/`push-registration.web.ts` нет. `queryClient` передаётся явно: корневой layout
  вызывает хук вне своего `QueryClientProvider`.
- **D-3 (шаг D).** `expo-notifications` `~58.1.6` (по `bundledNativeModules.json` SDK 58 — `~58.1.5`; §11 писал
  `~58.0.x`). Смена токена (`addPushTokenListener`) не слушается: регистрация — при каждом входе и запуске с сессией
  (идемпотентный `PUT`).
- **D-4 (шаг D, документация).** `apps/api/.env.example` не правился (запрет чтения `.env*` в брифе шага); переменные —
  в `docs/runbooks/push.md` и `infra/deploy/env.template`/`docker-compose.yml`. `docs/runbooks/deploy.md` не менялся:
  миграции применяются общим шагом `migrate`, отдельных действий 0024–0025 не требуют. Web-смоук (`e2e:web`,
  опционально при `E2E_API=1`) не добавлен.
- **R1-1 (фиксы ревью pass 1, push-токен и сессия).** Токен привязан к сессии регистрации (`push_tokens.sessionId`
  из `AuthGuard`); доставка шлёт только на токены живых сессий (`IdentityAccounts.liveSessionIds`, пачкой), остальные
  снимает. Токены, записанные до привязки (dev), без `sessionId` — как мёртвые: снимаются при первой доставке,
  приложение регистрирует заново при следующем запуске. Поле без индекса (фильтр — по `_id` сессий) — миграции нет.
  `revokeAllOf` при сбросе пароля не добавлялся: мёртвую сессию отсекает доставка.
- **R1-2 (фиксы ревью pass 1, приложение).** Токен запоминается локально до запроса регистрации (раньше — после
  ответа): сбой регистрации оставляет запись, выход снимет токен (идемпотентный `204`). У `Chip` базы нет `disabled` —
  ряд часов на время сохранения недоступен целиком (`aria-disabled`, `pointerEvents: 'none'`), без визуального
  приглушения (токена прозрачности нет); `disabled` у `Chip` — follow-up в app-foundation.
- **R2-1 (фиксы ревью pass 2, приложение).** Хук `usePushNotifications(ready, queryClient)` (D-2) заменён компонентом
  `PushNotifications({ ready })` в `push-registration.ts`: рендерится рядом со `Stack` корневого layout (внутри
  `AppThemeProvider` и `QueryClientProvider`), `queryClient` — из контекста. Отложенная цель — сам последний ответ
  `expo-notifications`: гасится только после успешного перехода, иначе повторяется при следующей подписке (отдельного
  хранилища нет). `useRootNavigationState`/`isReady()` не используются: в expo-router 58 контейнер с засеянным
  состоянием `isReady()` = `true` ещё до монтирования `Stack`, сигналом служит само монтирование компонента.
- **R2-2 (фиксы ревью pass 2, API).** `push_tickets.userId` + миграция `0027_push_tickets_user` (индекс
  `push_tickets_user_idx`); `eraseUser` стирает тикеты по владельцу. Тикеты без поля (до миграции, dev) убирает TTL
  24 ч. Квитанции снимают токен по `{ _id, userId }` (сессии в тикете нет).

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

- `docs/adr/0017-notifications-and-push.md` (пункты — §8.1 RC-1) + строка в `docs/adr/README.md`; пометка в
  `docs/adr/0013-coffee-rides.md` («п. 2 уточнён ADR-0017»).
- `AGENTS.md` §1 (push через Expo на iOS/Android по ADR-0017; WebSocket/BLE/Strava — по-прежнему нет) и §4.9 (пример
  «push» убрать из списка запретов).
- `.claude/rules/pokatim-app.md` — «нет push» и «уведомления — только in-app»; новый абзац «Уведомления»
  (`features/notifications`, развилка `push(.web).ts`, белый список целей, polling 60 с).
- `.claude/rules/pokatim-backend.md` — раздел «Уведомления (`notifications`)»: порты источников, маршруты подписчика,
  очереди, доставка; в «Кофе-райды» — «Outbox-событий в 05a нет» → события и транзакции; в «Протокол» и «Споры» —
  «без маршрута» → маршрут в `notifications-intake`; `account` — шаг `notifications`.
- `.claude/rules/pokatim-db.md` — коллекции и индексы `0024`, `race_attempts.lastVisibleVerdict` (`0025`), правка
  абзаца «Участие — одна атомарная операция… без транзакций» (теперь — в транзакции с outbox, условие в фильтре
  обязательно), шаг стирания.
- `.claude/rules/pokatim-contracts.md` — `src/notifications/notification.schema.ts`.
- `.claude/rules/pokatim-security.md` — push-токены (только свои, снятие при выходе/удалении, не в логах),
  `EXPO_ACCESS_TOKEN`.
- `docs/product/home.md` (колокольчик), `docs/product/account.md` A6 и N11, `docs/product/README.md` (ссылка на
  `notifications.md`).
- `docs/runbooks/push.md` (новый: EAS `projectId` в `app.json` `extra.eas`, ключи APNs/FCM в EAS, `PUSH_ENABLED`,
  `EXPO_ACCESS_TOKEN`, проверка квитанций), `docs/runbooks/account-deletion.md` (шаг `notifications`),
  `docs/runbooks/deploy.md` (миграции 0024–0025), `infra/deploy/env.template`, `apps/api/.env.example`.

## 11. Implementation Context

Документация библиотек: context7 в сессии architect недоступен — Expo Push API, `expo-notifications` и BullMQ сверены
по памяти и по `node_modules` (`@rkarakulov/api-kit` 0.4.1: `QueueModule` — `attempts: 5`, exponential 5 с,
`removeOnComplete: 1000`, `removeOnFail: false`; публикатор outbox — `add(type, { outboxEventId }, { jobId: id })`).
Coder сверяет через context7: `getExpoPushTokenAsync`, `setNotificationChannelAsync`,
`addNotificationResponseReceivedListener`/`useLastNotificationResponse`, плагин `expo-notifications` для SDK 58;
`send`/`getReceipts` Expo Push API; `Queue.add` с `delay` и `jobId`.

### ENTRY POINTS

- Worker: `NotificationsIntakeProcessor` (`@Processor(QUEUE.notificationsIntake, { concurrency: 4 })`, имя задачи =
  тип события), `NotificationsDeliveryProcessor` (`notifications-delivery`, имена `notifications.push`,
  `notifications.email`), `NotificationsMaintenanceProcessor` + `NotificationsSchedules` (`notifications-maintenance`:
  `notifications.receipts` каждые 15 мин, `notifications.redeliver` каждые 10 мин; образец — `account-schedules.ts`).
- HTTP: `NotificationsController` — `@Controller('notifications')`, `@UseGuards(AuthGuard)`, `@CurrentUser()`,
  `@Header('Cache-Control', 'no-store')` на чтениях. Статические пути объявлены **до** `:id`:
  | Метод и путь | Тело / query | Ответ | Лимит (`RateLimiter`, ключ uid) |
  |---|---|---|---|
  | `GET /v1/notifications` | `NotificationListQuery { cursor?, limit 1–50 = 20 }` (`strictObject`) | `NotificationPage` | — |
  | `GET /v1/notifications/unread-count` | — | `UnreadCount { count }` (≤ 100) | — |
  | `GET /v1/notifications/settings` | — | `NotificationSettings` (нет документа — умолчания) | — |
  | `PUT /v1/notifications/settings` | `NotificationSettings` (`strictObject`, полный) | `NotificationSettings` | `notifications-settings` 30/ч |
  | `PUT /v1/notifications/push-tokens` | `RegisterPushToken { token, platform }` | 204 | `notifications-push-token` 30/ч |
  | `POST /v1/notifications/push-tokens/revoke` | `RevokePushToken { token }` | 204 (чужой/неизвестный — тоже 204) | `notifications-push-token` |
  | `POST /v1/notifications/read-all` | — | 204 | `notifications-read` 120/мин |
  | `POST /v1/notifications/:id/read` | pipe `Uuid` | 204; не своё/нет — `404 NOT_FOUND` | `notifications-read` |
  Отказ лимита — `429 RATE_LIMITED { retryAfterSec }` (как `ride-reports.service.ts`). Новых `ErrorCode` нет.
- Источники событий (в существующих транзакциях):
  - `results/attempt-check.processor.ts` `record` — `RESULTS_ATTEMPT_VERDICT_CHANGED` (§7);
    `MongoOutboxWriter` в конструктор.
  - `rides/rides.service.ts` — `update`: `transactions.run(tx → repository.update(tx, …) → если
    updated.rescheduledAt?.getTime() === now.getTime() → outbox RIDES_RIDE_RESCHEDULED)`; `cancel`: `run(tx →
    repository.cancel(tx, …) → если не null → RIDES_RIDE_CANCELLED)` (повторная отмена — без события); `join`:
    `run(tx → repository.join(tx, …) → если не null → RIDES_PARTICIPANT_JOINED)` (идемпотентный «уже участник» — без
    события). Классификация отказов по свежему чтению — после транзакции, как сейчас. `create`/`leave` — без изменений.
  - `rides/ride-erasure.ts` — `cancelFutureOf` заменить на `futurePublishedIdsOf(organizer, now)` + по каждому
    `run(tx → cancelOne(tx, id, 'organizer_unavailable', now) (фильтр organizerUserId, status 'published', startsAt >
    now) → событие)`; повтор безопасен (отменённые фильтр не проходят); `cancelHiddenFutureOf`, `leaveAllFuture`,
    `clearOrganizerName` — без изменений; `RideErasureResult` тот же.
  - `rides/rides-moderation.service.ts` `act` — при `closed > 0` (hide/dismiss) в той же транзакции
    `RIDES_REPORTS_RESOLVED { rideId, resolvedAt: now.toISOString() }`.
- Удаление аккаунта: `account-deletion.service.ts` — в транзакции после `audit.append`:
  `await this.pushTokens.revokeAllOf(tx, userId)`; `account-erasure.service.ts` — шаг `notifications` между
  `tracks` и `identity`: `NotificationErasure.erase(userId)` → `deleted=<n> settings=<0|1> tokens=<n>`.

### FILES TO MODIFY

- `apps/api/src/queues.ts` — `notificationsIntake: 'notifications-intake'`, `notificationsDelivery:
  'notifications-delivery'`, `notificationsMaintenance: 'notifications-maintenance'` (с doc-комментариями jobId).
- `apps/api/src/worker.module.ts` — `...notificationsOutboxRoutes`, `NotificationsWorkerModule`.
- `apps/api/src/app.module.ts` — `NotificationsModule`.
- `apps/api/src/config/env.ts` — `notificationsEnvShape`: `PUSH_ENABLED: flag(false)`, `EXPO_ACCESS_TOKEN:
  optional(z.string().min(20))`, `EXPO_PUSH_API_URL: z.url({ protocol: /^https?$/ }).default('https://exp.host/--/api/v2/push')`;
  в `envDependencyErrors`: production+prod и адрес ≠ умолчанию — ошибка. `apps/api/src/config/env.test.ts`.
- `apps/api/src/db/migrations/index.ts` — `notifications`, `attemptLastVerdict` в конец.
- `apps/api/src/modules/results/`: `results.events.ts` (+`RESULTS_ATTEMPT_VERDICT_CHANGED`,
  `ResultsAttemptVerdictChanged = z.object({ attemptId: z.uuid(), raceId: z.uuid(), userId: z.uuid(), status:
  z.enum(['counted', 'rejected']) })`), `results.collection.ts` (`lastVisibleVerdict?`), `results.policy.ts`
  (`visibleVerdict(origin, result)` — поверх `attemptHidden`), `results.repository.ts` (`recordCheck` пишет поле;
  `activeEntryUserIds(raceId)`, `protocolRowUserIds(raceId, revision)`, `entryUserId(entryId)`,
  `attemptForNotice(attemptId)` — проекции), `attempt-check.processor.ts`, новые `results-notices.port.ts` +
  `results-notices.ts`, `results.module.ts` (провайдер в `ResultsCoreModule`, экспорт `RESULTS_NOTICES`), `index.ts`
  (экспорт порта, типов, констант и схем событий `RESULTS_PROTOCOL_PUBLISHED`, `ResultsProtocolPublished`,
  `RESULTS_RESULT_REVISED`, `ResultsResultRevised`, `RESULTS_ATTEMPT_VERDICT_CHANGED`, `ResultsAttemptVerdictChanged`).
- `apps/api/src/modules/disputes/`: новые `dispute-notices.port.ts` + `dispute-notices.ts` (через
  `DisputesRepository.findById` — проекция без `description/response/decision.note`), `disputes.module.ts`
  (провайдер и экспорт в `DisputesCoreModule`), `index.ts` (порт + `DISPUTES_DISPUTE_*`, `DisputeEventPayload`,
  `DisputeDecidedPayload`).
- `apps/api/src/modules/rides/`: новый `rides.events.ts` (`RIDES_RIDE_CANCELLED`, `RIDES_RIDE_RESCHEDULED`,
  `RIDES_PARTICIPANT_JOINED` — `RideEventPayload = { rideId }`; `RIDES_REPORTS_RESOLVED` — `{ rideId, resolvedAt:
  z.iso.datetime() }`), `rides.repository.ts` (`session?: DbSession` в `join`/`update`/`cancel`, `cancelOne`,
  `futurePublishedIdsOf`, `findForNotice(id)` — `title, startsAt, status, organizerUserId, goingCount,
  participants.userId`), `ride-reports.repository.ts` (`reportersResolvedAt(rideId, at)`), `rides.service.ts`,
  `ride-erasure.ts`, `rides-moderation.service.ts`, новые `ride-notices.port.ts` + `ride-notices.ts`,
  `rides.module.ts` (`RideReportsRepository` и `RideNoticesService` — в `RidesCoreModule`, экспорт; `RidesModule`
  получает репозиторий жалоб через импорт ядра), `index.ts`.
- `apps/api/src/modules/identity/`: `identity-accounts.ts` + `identity.repository.ts` (`liveUserIds(ids):
  Promise<Set<string>>`, `deletedAt: null`, проекция `_id`), `index.ts` (+ `escapeHtml`, `htmlEmail` из
  `mail/html.ts`).
- `apps/api/src/modules/account/`: `account-deletion.service.ts`, `account-erasure.service.ts`, `account.module.ts`
  (`NotificationsCoreModule` в оба модуля), `account-erasure.int.test.ts`, `account-deletion.int.test.ts`.
- `packages/contracts/src/index.ts`, `packages/api-client/src/index.ts` (+ тест).
- `apps/app/src/components/top-bar.tsx` (+ `onOpenNotifications?`, `unreadCount?`), `apps/app/src/app/(tabs)/index.tsx`,
  `apps/app/src/app/_layout.tsx` (экраны `notifications`, `settings/notifications` в первом `Stack.Protected`; хуки
  `usePushResponses()`, `usePushRegistration()` — только при `signedIn`), `apps/app/src/features/auth/use-sign-out.ts`
  (снятие токена до `signOut`, кроме `notice: 'accountDeleted'`/`serverEnded`), `apps/app/src/app/settings/profile.tsx`
  (строка «Уведомления»), `apps/app/app.json` (плагин `"expo-notifications"`), `apps/app/package.json`
  (`expo-notifications` `~58.0.x` — добавляет человек/coder через `npx expo install expo-notifications`, architect
  не запускал), `packages/i18n/src/ru.ts` (`notifications.*`: экраны, a11y «Уведомления, {count} непрочитанных»,
  «99+», настройки, пустое состояние, ошибки).

### NEW FILES

- `apps/api/src/modules/notifications/`: `index.ts` (`NotificationsCoreModule`, `NotificationsModule`,
  `NotificationsWorkerModule`, `notificationsOutboxRoutes`, `PushTokens`, `NotificationErasure`),
  `notifications.module.ts`, `notifications.events.ts` (маршруты подписчика, имена задач, `pushJobId(userId,
  notBefore) = push-<uid>-<ms>`, `emailJobId(id) = email-<id>` — без `:`), `notifications.collection.ts`,
  `notifications.repository.ts`, `notifications.policy.ts`, `notification-texts.ts`, `event-time.ts`,
  `notifications.controller.ts`, `notifications.service.ts`, `notification-settings.service.ts`,
  `push-tokens.service.ts`, `push-tokens.ts` (порт `revokeAllOf(tx, userId)`), `notification-erasure.ts`,
  `notification-intake.ts` (разбор события → `NoticeDraft[]` через порты), `notifications-intake.processor.ts`,
  `push-delivery.ts`, `email-delivery.ts`, `notifications-delivery.processor.ts`, `push-receipts.ts`,
  `notifications-maintenance.processor.ts` (+ `NotificationsSchedules`), `push-sender.ts` (порт `PUSH_SENDER`),
  `expo-push.sender.ts`.
- `apps/api/src/db/migrations/0025_notifications.ts`, `0026_attempt_last_verdict.ts`.
- `packages/contracts/src/notifications/notification.schema.ts` (+ `.test.ts`).
- `apps/api/test/notifications.ts` (хелперы: событие outbox с id на момент, прогон intake/delivery),
  `apps/api/test/fake-expo.ts`.
- `apps/app/src/app/notifications.tsx`, `apps/app/src/app/settings/notifications.tsx`;
  `apps/app/src/features/notifications/`: `queries.ts` (`useUnreadCount` — `refetchInterval: 60_000`, только
  `signedIn`; `useNotifications` — `useInfiniteQuery`; мутации read/read-all/settings с инвалидацией счётчика),
  `notification-target.ts` (цель → `Href` только из белого списка: `race` → `/races/<raceId>`, `ride` →
  `/rides/<rideId>`, `dispute-response` → `/races/dispute-response/<raceId>/<disputeId>`; `unknown`/`null` →
  `/notifications`; id — `Uuid.safeParse`), `push.ts` (native: разрешение, канал Android `default`, токен с
  `projectId` из `Constants.expoConfig?.extra?.eas?.projectId`, без него или не устройство — `null`; хранение
  последнего токена в SecureStore `pokatim.pushToken`), `push.web.ts` (`pushSupported = false`, no-op),
  `push-responses.ts`/`push-responses.web.ts` (нажатие на push и холодный старт → `notificationPath(data.target)`;
  `setNotificationHandler` — показывать баннер, инвалидировать счётчик), `push-registration.ts`/`.web.ts`,
  `notifications-list.tsx`, `notification-row.tsx`, `quiet-hours-sheet.tsx` (BottomSheet + `Chip` 0–23);
  `apps/app/src/components/notification-bell.tsx` (SymbolView `{ ios: 'bell', android: 'notifications', web:
  'notifications' }` + `Pill` счётчика, «99+» при `count > 99`, a11y-лейбл) + тесты.

### FILES TO READ

`AGENTS.md` §4; `.claude/rules/{backend,pokatim-backend,db,pokatim-db,contracts,pokatim-contracts,app,pokatim-app,
pokatim-security,tests,pokatim-tests}.md`; `docs/adr/0007,0008,0012,0013,0015`; `docs/product/notifications.md`;
`identity/jobs/link-email.handler.ts` + `identity.repository.ts` (`claimLinkSend/releaseLinkSend/completeLinkSend`);
`devices/open-wearables.aggregator.ts`, `devices/devices.module.ts` (фабрика адаптера от `ENV`), `test/fake-ow.ts`;
`results/results-for-disputes(.port).ts` (образец порта); `results/results.policy.ts` (`attemptHidden`);
`account/account-schedules.ts` (регламент); `src/page-cursor.ts`; `rides/rides-participation.int.test.ts`,
`rides/ride-reports.int.test.ts`, `rides/rides-moderation.int.test.ts`; `db/migrations/0003_identity_ttl.ts`,
`0017_ride_reports.ts`, `0023_account_deletion.ts`; `apps/app/src/features/auth/{use-sign-out,session-store}.ts`,
`features/location/location-permission(.web).ts` (образец развилки разрешения), `features/auth/return-path-allowlist.ts`.

### TYPES & SCHEMAS

Контракты (`packages/contracts/src/notifications/notification.schema.ts`; справочники — только в конец):

```ts
NOTIFICATION_GROUPS = ['races', 'disputes', 'rides']
NOTIFICATION_KINDS = ['result_counted', 'result_rejected', 'protocol_published', 'protocol_disqualified',
  'protocol_restored', 'protocol_rechecked', 'dispute_filed', 'dispute_withdrawn', 'dispute_responded',
  'dispute_decided', 'ride_cancelled', 'ride_rescheduled', 'ride_joined', 'ride_report_resolved']
NotificationTarget = discriminatedUnion('type', [
  { type: 'race', raceId: Uuid }, { type: 'ride', rideId: Uuid },
  { type: 'dispute-response', raceId: Uuid, disputeId: Uuid } ])
NotificationTargetView = NotificationTarget | { type: 'unknown' }   // незнакомое → unknown, ответ не падает (тест)
NotificationView = { id, kind: tolerantEnum, group: tolerantEnum, title, body, createdAt: iso, read: boolean,
  target: NotificationTargetView | null }
NotificationPage = { items: NotificationView[], nextCursor: string | null }
NotificationListQuery = strictObject { cursor?: PageCursor, limit: coerce 1..50 default 20 }
UnreadCount = { count: int 0..100 }
NotificationSettings = strictObject { push: { races, disputes, rides: boolean }, email: { disputes, rides: boolean },
  quietHours: { enabled: boolean, startHour: int 0..23, endHour: int 0..23 } }  // refine start ≠ end → INVALID
DEFAULT_NOTIFICATION_SETTINGS = всё true, quietHours { enabled: true, startHour: 22, endHour: 8 }
PUSH_PLATFORMS = ['ios', 'android'];  ExpoPushToken = regex §7, max 220
RegisterPushToken = strictObject { token: ExpoPushToken, platform: enum(PUSH_PLATFORMS) }
RevokePushToken = strictObject { token: ExpoPushToken }
```

api-client: `listNotifications(at, query)`, `getUnreadCount(at)`, `markNotificationRead(at, id)`,
`markAllNotificationsRead(at)`, `getNotificationSettings(at)`, `updateNotificationSettings(at, body)`,
`registerPushToken(at, body)`, `revokePushToken(at, body)`.

Порты источников (все — `Symbol` + интерфейс в `*.port.ts`, реализация в ядре модуля, экспорт через `index.ts`):

```ts
// results/results-notices.port.ts — ResultsCoreModule
RESULTS_NOTICES; interface ResultsNotices {
  attempt(attemptId): Promise<{ userId; raceId; activityStartedAt: Date } | null>;
  protocolAudience(raceId): Promise<string[]>;            // userId активных заявок
  revisionAudience(raceId, revision): Promise<string[]>;   // userId строк ревизии
  entryUser(entryId): Promise<string | null>; }
// disputes/dispute-notices.port.ts — DisputesCoreModule
DISPUTE_NOTICES; interface DisputeNotices {
  parties(disputeId): Promise<{ raceId; complainantUserId; targetUserId } | null>; }
// rides/ride-notices.port.ts — RidesCoreModule
RIDE_NOTICES; interface RideNotice { id; title; startsAt: Date; status: RideStatus; organizerUserId;
  goingCount; participantUserIds: string[] /* без организатора */ }
interface RideNotices { ride(rideId): Promise<RideNotice | null>;
  resolvedReporters(rideId, resolvedAt: Date): Promise<string[]>; }
// races — существующий RACE_REGISTRY.get(raceId).title (через RacesCoreModule)
// identity — IdentityAccounts.liveUserIds(ids): Promise<Set<string>>, emailsOf(ids)
// notifications (для account): PushTokens.revokeAllOf(tx, userId): Promise<number>;
//   NotificationErasure.erase(userId): Promise<{ notifications; settings; tokens; tickets }>
```

Маршруты (`notificationsOutboxRoutes` → `QUEUE.notificationsIntake`): `results.attempt-verdict-changed`,
`results.protocol-published`, `results.result-revised`, `disputes.dispute-filed|-withdrawn|-responded|-decided`,
`rides.ride-cancelled`, `rides.ride-rescheduled`, `rides.participant-joined`, `rides.reports-resolved` (11 типов).

Документы (`notifications.collection.ts`):

```ts
NOTIFICATIONS_COLLECTIONS = { notifications: 'notifications', settings: 'notification_settings',
  pushTokens: 'push_tokens', pushTickets: 'push_tickets' }
NotificationDoc { _id: uuidv7; userId; kind; group; title; body; target: NotificationTarget | null;
  sourceEventId; collapseKey?: string; createdAt: Date; readAt: Date | null; expireAt: Date /* createdAt + 90 д */;
  push: { state: 'pending' | 'sending' | 'sent' | 'skipped' | 'limited' | 'failed'; notBefore: Date;
          claimId: string | null; claimedUntil: Date | null; sentAt: Date | null; reason: string | null };
  email: { state: 'pending' | 'sending' | 'sent' | 'skipped' | 'failed'; claimedUntil: Date | null;
           sentAt: Date | null } | null }
NotificationSettingsDoc { _id: userId; push; email; quietHours; updatedAt }   // нет документа — умолчания
PushTokenDoc { _id: uuidv7; token; userId; platform; createdAt; updatedAt }   // ≤ 10 на userId: 11-й вытесняет старейший
PushTicketDoc { _id: uuidv7; ticketId; tokenId; createdAt; expireAt /* + 24 ч */ }
```

Индексы `0025_notifications` (имена — для `isDuplicateKey`):
`notifications_event_user_unique { sourceEventId: 1, userId: 1 }` unique;
`notifications_collapse_unique { userId: 1, collapseKey: 1 }` unique, partial `{ collapseKey: { $type: 'string' } }`;
`notifications_user_list_idx { userId: 1, createdAt: -1, _id: -1 }` (список, курсор, стирание);
`notifications_user_unread_idx { userId: 1 }` partial `{ readAt: { $eq: null } }` (счётчик, read-all);
`notifications_push_due_idx { 'push.state': 1, 'push.notBefore': 1 }` partial `{ 'push.state': { $in: ['pending',
'sending'] } }` (захват по пользователю — `{ userId, 'push.state', 'push.notBefore' }` идёт по `user_list` +
остаток; регламент — по этому индексу); `notifications_email_due_idx { 'email.state': 1 }` partial
`{ 'email.state': { $in: ['pending', 'sending'] } }` (`$in` в `partialFilterExpression` — сверить с документацией
MongoDB 8.0 через context7; не поддерживается — индекс без partial); `notifications_expire_ttl { expireAt: 1 }`
`expireAfterSeconds: 0`; `push_tokens_token_unique { token: 1 }` unique; `push_tokens_user_idx { userId: 1,
updatedAt: 1 }`; `push_tickets_ticket_unique { ticketId: 1 }` unique; `push_tickets_created_idx { createdAt: 1 }`;
`push_tickets_expire_ttl { expireAt: 1 }` `expireAfterSeconds: 0`. Чтения проверяют `expireAt > now` сами (TTL —
только уборка).

Доставка (образец захвата — `link-email.handler.ts`):
- intake: черновики по получателям → настройки пачкой (`_id $in`) → `updateOne(upsert)` по `{ sourceEventId, userId }`
  с `$setOnInsert` (или по `collapseKey`, §7); push `pending` (группа включена и `PUSH_ENABLED`) иначе `skipped`
  (`reason: 'disabled' | 'push_off'`); email `pending` только для `ride_cancelled`/`dispute_decided` при включённом
  тумблере. Затем — перечитать уведомления события (`sourceEventId`) в `pending` и поставить задачи с детерминированными
  jobId (`push-<uid>-<notBeforeMs>` c `delay`, `email-<id>`): повтор intake ставит те же задачи, а не новые.
  Получателей — пачками по 500.
- push (задача на пользователя): захват `updateMany({ userId, 'push.state': 'pending', 'push.notBefore': { $lte: now } }
  ∪ истёкший `sending`) → `$set sending, claimId, claimedUntil = now + 60 с` → чтение по `claimId` → повторно:
  тумблер группы, тихие часы (сейчас тихо — назад в `pending` с новым `notBefore` и задачей), живость, токены (нет —
  `skipped/no_tokens`) → лимит 20/ч (`limited`) → одно сообщение на токен (N = 1 — текст уведомления, N > 1 — сводка)
  → тикеты: `DeviceNotRegistered` — удалить токен сразу, `ok` — `push_tickets` → `sent` по `claimId`. Сбой сети/5xx/429
  — снять захват (`pending`) и бросить (ретрай BullMQ); последняя попытка — `failed`, лог
  `notifications.push_failed uid=<uid> count=<n>`.
- email: захват `findOneAndUpdate({ _id, 'email.state': 'pending' } ∪ истёкший `sending`)` → адрес `emailsOf` (нет —
  `skipped`) → `MAILER.send` → `sent`; сбой — снять захват и бросить; последняя попытка — `failed`.
- регламент `redeliver`: `pending` с `notBefore < now − 10 мин` и истёкший `sending` → те же jobId (потерянная
  задача). `receipts`: тикеты старше 15 мин пачками ≤ 1000 → `getReceipts` → `DeviceNotRegistered` снимает токен,
  обработанные тикеты удаляются.
- `ExpoPushSender` (за `PUSH_SENDER`, фабрика от `ENV`): `POST {EXPO_PUSH_API_URL}/send` — массив ≤ 100 сообщений,
  `POST …/getReceipts { ids ≤ 1000 }`; заголовки `Content-Type`/`Accept: application/json`, `Authorization: Bearer
  <EXPO_ACCESS_TOKEN>` только если задан; `AbortSignal.timeout(10 с)`, лимит тела 1 МБ, `redirect: 'error'`, ответ —
  zod (`data[]` тикетов `{ status: 'ok', id } | { status: 'error', message, details?: { error? } }`; квитанции —
  `data: Record<id, …>`). Токены и тело в логи и ошибки не попадают (лог — `tokenId`, число, код ошибки).

### TESTS

Unit: `notifications.policy.test.ts` (`quietUntil` — через полночь, границы часа, выключено; группы kind→group),
`notification-texts.test.ts` (каждая строка таблицы продукта, кавычки «», даты по Минску, формы числа сводки),
`event-time.test.ts`, `notification-target.test.ts` (app: белый список, чужой URL/строка/не-Uuid → `/notifications`),
`notification.schema.test.ts` (токен, `start == end`, неизвестные kind/target), `expo-push.sender.test.ts` (фейк-
сервер: чанки 100/1000, ошибки, таймаут, без токена — без заголовка), `results.policy.test.ts` (`visibleVerdict`),
`env.test.ts`, `notification-bell.test.tsx` («99+», a11y, 0 — без счётчика), `top-bar.test.tsx`.

Int (реальный replica set, `harness`, `fake-expo`):
- `notifications.int.test.ts` (HTTP): список/курсор/`unread-count` только свои; `POST {чужой id}/read` → 404;
  read идемпотентен; read-all; settings GET умолчания / PUT / 400 `start == end`; push-tokens: регистрация, тот же
  токен другим пользователем — переходит к нему, 11-й вытесняет старейший, revoke чужого — 204 без эффекта; 429 на
  каждый лимит; без сессии — 401; истёкший (`expireAt ≤ now`) не виден.
- `notifications-intake.int.test.ts`: каждое событие N3 → нужные получатели и текст, посторонним — нет (не участник,
  удалённый аккаунт); повтор той же задачи и повторная публикация → одно уведомление, одна задача доставки;
  collapse (два переноса — один документ, снова непрочитан, наверху; старое событие после нового — не перетирает);
  событие > 72 ч → skip; объект исчез → skip; невалидный payload → skip.
- `notifications-delivery.int.test.ts`: push уходит один раз при повторе задачи и параллельных двух задачах;
  выключенная группа — нет push; тихие часы → отложено, два отложенных → одна сводка; 21-й за час — `limited`;
  `PUSH_ENABLED=false` — `skipped`; `DeviceNotRegistered` в тикете и в квитанции снимает токен; сбой Expo → ретрай,
  последняя попытка → `failed`; e-mail только `ride_cancelled`/`dispute_decided`, по тумблеру, один раз при повторе,
  не задерживается тихими часами.
- Источники: `results-check.int.test.ts` — первый видимый вердикт → событие; перепроверка с тем же статусом — нет;
  `counted → rejected` — есть; скрытая авто-попытка — нет; `failed` — нет. `rides.int.test.ts` /
  `rides-participation.int.test.ts` — события `cancel`/`update` (перенос с участниками и без), `join`; повторная отмена
  и повторный join — без второго события; **существующие тесты гонок без правки ожиданий**. `rides-moderation.int.test.ts`
  — `reports-resolved` при hide/dismiss с жалобами, restore — нет. `account-erasure.int.test.ts` — отмена будущих
  райдов пишет событие на каждый, повтор прохода — без новых; шаг `notifications` стирает всё. `account-deletion.int.test.ts`
  — токены сняты в транзакции (откат при `changed`/`already` — не сняты).
- Миграции: `migrations.int.test.ts` — индексы 0024 и бэкфилл 0025 (counted/rejected получают поле, прочие — нет,
  повторный прогон идемпотентен).
- arch: `pnpm arch:check` — `notifications` только через `index.ts`, циклов нет.
E2E: web-смоук (`e2e:web`) — колокольчик со счётчиком, центр, «Прочитать все» (опционально, при `E2E_API=1`).

### OUT OF SCOPE

Web push; e-mail кроме N2; дайджесты; ручное удаление уведомлений; уведомления в панели «Протокол» и экран
failed-доставок (follow-up вместе с F13); WebSocket; fan-out outbox и рейтинг сезона (08) — задача в app-foundation;
правки `@rkarakulov/*`; EAS `projectId`, ключи APNs/FCM (runbook, ручной шаг); уведомления о скрытии райда
модерацией и об уходе участника; локализация кроме ru.

### Декомпозиция для coder (последовательно, каждый шаг — зелёный `pnpm check` и коммит)

- **A — ядро notifications + контракты + API.** Контракты и api-client; `queues.ts`; env; миграция 0024;
  `notifications.collection/repository/policy/texts/event-time`; HTTP (контроллер, сервисы, лимиты);
  `PushTokens`/`NotificationErasure`; `NotificationsCoreModule`/`NotificationsModule` в `AppModule`. Тесты: unit
  политики, текстов, схем; int HTTP (чужие не видны, 404, 429, токены). Уведомления в тестах — вставкой репозитория.
- **B — источники и intake.** `lastVisibleVerdict` + 0025, событие вердикта; порты `ResultsNotices`,
  `DisputeNotices`, `RideNotices`; события rides и перевод `update/cancel/join`, `RideErasure`, `act` на транзакции;
  `IdentityAccounts.liveUserIds`; `notificationsOutboxRoutes`, intake-процессор, `NotificationsWorkerModule` (пока
  без доставки: push `skipped`/`pending` без задач). Тесты: int источников и intake (повтор без дублей, 72 ч, получатели),
  регресс rides.
- **C — доставка + account.** `PushSender`/`ExpoPushSender`, `fake-expo`, delivery (push по пользователю, тихие часы,
  сводка, лимит, e-mail), регламент (квитанции, перепостановка), постановка задач из intake; `account`:
  `revokeAllOf` в транзакции удаления, шаг стирания. Тесты: int доставки (один push/письмо при повторе и параллели),
  квитанции, account.
- **D — приложение.** `expo-notifications` (пакет + плагин), `features/notifications` (запросы, цели, развилки
  push), колокольчик, экраны центра и настроек, вход из профиля, снятие токена при выходе, обработка нажатия; i18n.
  Тесты: unit целей, колокольчика, экранов (состояния §4.12: скелетон, пусто, ошибка с повтором, баннер обновления);
  web-смоук. Затем — документация §10 и ADR-0017.

### Security notes (зона `pokatim-security.md` и `security.md` затронута — чек-лист 8.3 обязателен)

Все выборки и мутации — с `userId` из `@CurrentUser()` в фильтре (`{ _id, userId }`), фильтры только из примитивов
после zod; токен push — строгий формат, не в логах (лог — id документа); снятие чужого токена невозможно (фильтр по
`userId`), ответ одинаковый; захват токена другим аккаунтом — переход владельца (устройство одно) — принят;
исходящий HTTP — один хост из env, в production — только `exp.host`, таймаут, лимит тела, без редиректов;
`EXPO_ACCESS_TOKEN` — только заголовок; payload push и письма — без чужих ПДн (N12); удаление аккаунта — токены в
транзакции, уведомления/настройки/тикеты — шагом стирания.

## 12. Outcome

### Шаг A — ядро notifications, контракты, HTTP API

**Changes.**
- Контракты `src/notifications/notification.schema.ts`: справочники `NOTIFICATION_GROUPS`/`NOTIFICATION_KINDS`/
  `PUSH_PLATFORMS`, `NotificationTarget` (белый список) и `NotificationTargetView` (незнакомое → `{ type: 'unknown' }`),
  `NotificationView` (`tolerantEnum`), `NotificationPage`, `NotificationListQuery` (`strictObject`, limit 1–50),
  `UnreadCount` (0–100), `NotificationSettings` (`strictObject`, `start ≠ end` → `INVALID` на `quietHours.endHour`),
  `DEFAULT_NOTIFICATION_SETTINGS`, `ExpoPushToken`, `RegisterPushToken`, `RevokePushToken`. api-client — 8 методов §11.
- api: `queues.ts` (+3 очереди, процессоров ещё нет — шаги B/C), env `PUSH_ENABLED`/`EXPO_ACCESS_TOKEN`/
  `EXPO_PUSH_API_URL` (+ `envDependencyErrors`: в production+prod — только `exp.host`), миграция `0025_notifications`
  (4 коллекции, 12 индексов; `$in` в `partialFilterExpression` на MongoDB 8 работает — проверено int-тестом).
- Модуль `notifications`: `notifications.collection.ts`, `notifications.repository.ts` (единственный писатель; все
  выборки с `userId` и `expireAt > now`), `notifications.policy.ts` (`groupOf`, `EMAIL_KINDS`, `quietUntil`, лимиты),
  `notification-texts.ts` (`renderNotification` по таблице продукта, `renderPushSummary` с формами числа),
  `event-time.ts` (`eventTimeOf`, `isEventStale` 72 ч), сервисы списка/прочтения, настроек и токенов (лимиты
  `notifications-read` 120/мин, `notifications-settings` 30/ч, `notifications-push-token` 30/ч → `429
  RATE_LIMITED`), контроллер `/v1/notifications` (`AuthGuard`, статические пути до `:id/read`, `no-store`),
  порты `PushTokens.revokeAllOf(tx, userId)` и `NotificationErasure.erase(userId)`; `NotificationsCoreModule` /
  `NotificationsModule` в `AppModule`. Подключение портов в `account` — шаг C.

**Files.** `packages/contracts/src/notifications/notification.schema{,.test}.ts`, `packages/contracts/src/index.ts`,
`packages/api-client/src/{index,notifications.test}.ts`, `apps/api/src/{queues,app.module}.ts`,
`apps/api/src/config/env{,.test}.ts`, `apps/api/src/db/migrations/{0025_notifications,index,migrations.int.test}.ts`,
`apps/api/src/modules/notifications/*` (index, module, collection, repository, policy, texts, event-time,
controller, 3 сервиса, push-tokens, notification-erasure + тесты), `apps/api/test/notifications.ts`.

**Tests.** Unit: `notification.schema.test.ts` (20), `notifications.test.ts` api-client (6), `env.test.ts` (+3),
`event-time.test.ts` (8), `notifications.policy.test.ts` (9), `notification-texts.test.ts` (29: каждая строка таблицы,
даты по Минску, формы числа). Int: `notifications.int.test.ts` (29: 401 на каждом пути; только свои в списке и
счётчике; курсор; истёкшее не видно; потолок 100; чужой id → 404 без изменений; read идемпотентен; read-all только
свои; настройки умолчания/PUT/400; токены — переход владельца, параллельная регистрация → один документ, 11-й
вытесняет старейший, revoke чужого — 204 без эффекта; 429 на каждый лимит; порты — откат транзакции оставляет токены,
стирание и повтор), `migrations.int.test.ts` (+1, 0024 — индексы и идемпотентность).
Отрицательное доказательство: убран `userId` из фильтров `list`/`markRead` → красные «только свои…» и «чужое — 404…»
(2 failed), восстановлено.
`TURBO_CONCURRENCY=1 pnpm check` (изолированные `MONGO_URL_TEST`/`REDIS_URL_TEST`) — зелёный: arch:check «no
dependency violations found», api 113 files / 1177 tests passed, contracts 270, api-client 96, admin 240;
`Tasks: 13 successful, 13 total`.

**Follow-ups.** Шаг B: intake, порты источников, `notificationsOutboxRoutes`, `NotificationsWorkerModule`, хелпер
события outbox «на момент» в `test/notifications.ts`. Шаг C: доставка, `revokeAllOf`/`NotificationErasure` в
`account`. Вопрос автору — формулировка исхода спора (8.2 A-3).

### Шаг B — источники событий и intake

**Changes.**
- `results`: поле попытки `lastVisibleVerdict` (не стирается `requeueAttempt`), `visibleVerdict(origin, result)` поверх
  `attemptHidden`; `AttemptCheckProcessor.record` пишет поле (`next ?? previous`) и событие
  `results.attempt-verdict-changed` в транзакции вердикта только при смене на видимый `counted`/`rejected`; миграция
  `0026_attempt_last_verdict` (pipeline-бэкфилл `counted|rejected` без поля); порт `RESULTS_NOTICES`
  (`ResultsCoreModule`), экспорт событий протокола.
- `disputes`: порт `DISPUTE_NOTICES` (проекция сторон без описания/ответа/решения) в `DisputesCoreModule`, экспорт
  событий. `identity`: `IdentityAccounts.liveUserIds`.
- `rides`: `rides.events.ts` (4 события); `update`/`cancel`/`join` — та же условная операция в `MongoTransactions` +
  outbox (повтор/«уже участник»/отказ — без события); `RideErasure` — отмена опубликованных по одному райду в
  транзакции с событием (скрытые — без события, RC-8); `act` — `rides.reports-resolved { rideId, resolvedAt }` при
  закрытых жалобах; порт `RIDE_NOTICES`; `RideReportsRepository` перенесён в `RidesCoreModule`.
- `notifications`: `notificationsOutboxRoutes` (11 типов → `notifications-intake`) в `worker.module.ts`,
  `NotificationIntake` (событие → черновики через порты), `NotificationsIntakeProcessor` (72 ч → черновики → живые →
  настройки пачкой → `writeNotices`), `initialDelivery` (push `pending`/`skipped: disabled|push_off`, `notBefore` —
  тихие часы; письмо N2 по тумблеру), `NotificationsWorkerModule`. Постановка доставки — точка расширения шага C
  (комментарий в процессоре после записи; push остаётся `pending` без задач). Текст исхода спора — §8.2 A-3.

**Files.** `apps/api/src/db/migrations/{0026_attempt_last_verdict,index,migrations.int.test}.ts`,
`apps/api/src/modules/results/{attempt-check.processor,results.events,results.collection,results.policy(.test),
results.repository,results-notices(.port),results.module,index,results-check.int.test}.ts`,
`apps/api/src/modules/disputes/{dispute-notices(.port),disputes.repository,disputes.module,disputes.events,index}.ts`,
`apps/api/src/modules/rides/{rides.events,rides.repository,rides.service,ride-erasure,rides-moderation.service,
ride-reports.repository,ride-notices(.port),rides.module,index}.ts` + int-тесты rides,
`apps/api/src/modules/identity/{identity-accounts,identity.repository}.ts`, `apps/api/src/modules/account/
account-erasure.int.test.ts`, `apps/api/src/modules/notifications/{notifications.events,notification-intake,
notifications-intake.processor,notifications.repository,notifications.policy(.test),notifications.module,index,
notification-texts(.test),notifications-intake.int.test}.ts`, `apps/api/src/worker.module.ts`,
`apps/api/test/notifications.ts`.

**Tests.** Unit: `visibleVerdict` (2), `initialDelivery` (3), тексты исхода спора. Int: `results-check` (+5: первый
видимый → событие, перепроверка тем же статусом — нет, `counted → rejected` — есть, скрытая — нет, провал не
затирает, повтор задачи — нет); `migrations` (+1: бэкфилл 0025 и идемпотентность); `rides.int` (+3: отмена/повтор,
перенос с участниками/без/правка не старта, отказ записи), `rides-participation` (+2: повтор/организатор/полный/leave
без события; параллельные «Я иду» — одно событие), `rides-moderation` (+2: hide/dismiss — событие, без жалоб и restore
— нет; откат — нет), `account-erasure` (+событие на райд, повтор прохода — без новых);
`notifications-intake.int.test.ts` (16: получатели и тексты каждого события N3, посторонним/снятым/организатору —
нет; схлопывание «Новый участник» и переноса, старое после нового не перетирает; статус райда не тот — skip;
повтор задачи, повторная публикация и 4 параллельные задачи — одно уведомление; удалённый аккаунт — нет; > 72 ч —
stale, ровно 72 ч — принят; объект исчез, невалидный payload — skip; выключенная группа push — запись в центр есть,
`push: skipped/disabled`). Существующие тесты rides (в т.ч. `rides-participation`) — без правки ожиданий.
Отрицательные доказательства (вернул после): без `liveUserIds` — красный «удалённый аккаунт»; без отсечки 72 ч —
красный «старше 72 ч»; без `sourceEventId $lt` в схлопывании — красный «старое событие не перетирает»; событие
переноса без условия — красный тест rides; событие вердикта без сравнения с прежним — 2 красных в `results-check`.

`TURBO_CONCURRENCY=1 pnpm check` (изолированные `MONGO_URL_TEST`/`REDIS_URL_TEST`) — зелёный: arch:check «no
dependency violations found», api 114 files / 1211 tests passed, contracts 270, api-client 96, admin 240.

**Follow-ups.** Шаг C: постановка задач доставки из intake (точка — `NotificationsIntakeProcessor.process`),
доставка, регламент, `account`. Документация §10 (правила «rides без outbox», «без маршрута» у протокола и споров) —
шаг D.

### Шаг C — доставка push и писем, регламент, account

**Changes.**
- Порт `PUSH_SENDER` (`push-sender.ts`) и адаптер `ExpoPushSender` (`expo-push.sender.ts`, фабрика от `ENV`):
  `send` пачками ≤ 100 (`sound: 'default'`, `channelId: 'default'`, `data.target`), `getReceipts` пачками ≤ 1000,
  `Authorization: Bearer` только при `EXPO_ACCESS_TOKEN`, таймаут 10 с, тело ≤ 1 МБ, `redirect: 'error'`, zod-ответы;
  ошибки `PushSendError` (`unavailable` — сеть/таймаут/429/5xx, `rejected`, `protocol`), токены и тела — не в логах.
- Доставка (`notifications-delivery`): `PushDelivery` — захват всех уведомлений пользователя к сроку (`claimPush`,
  `claimId` + `claimedUntil` 60 с) → `PUSH_ENABLED` → живость → тумблер группы → тихие часы (назад в `pending` до
  конца интервала + задача на этот срок) → токены → лимит 20/ч после захвата → одно сообщение на токен (1 — текст и
  цель, > 1 — сводка без цели) → тикеты (`DeviceNotRegistered` снимает токен, `ok` → `push_tickets`) → `sent`; сбой —
  захват снят и ретрай, последняя попытка — `failed` + `notifications.push_failed`. `EmailDelivery` — по образцу
  `link-email.handler.ts` (`claimEmail`/`settleEmail`, `emailsOf` в момент отправки, `busy` → ретрай), шаблон
  `notification-email.ts` через `htmlEmail`/`escapeHtml` из `identity/index.ts`.
- Постановка: `DeliveryJobs.scheduleEvent` из `NotificationsIntakeProcessor` (и при повторе intake — те же jobId
  `push-<uid>-<notBeforeMs>` с задержкой, `email-<id>`), см. 8.2 C-2.
- Регламент (`notifications-maintenance`, `NotificationsSchedules`): `notifications.receipts` (*/15) — `PushReceipts`;
  `notifications.redeliver` (*/10) — потерянные `pending` (> 10 мин) и истёкшие `sending`.
- `account`: `PushTokens.revokeAllOf(tx, userId)` в транзакции `account-deletion.service.ts`; шаг `notifications` между
  `tracks` и `identity` в `account-erasure.service.ts`; `NotificationsCoreModule` в оба модуля account.
- `NOTIFICATIONS_POLICY`: `pushLimit`, `deliveryLeaseMs`, сроки регламента; job-константы и схемы данных — в
  `notifications.events.ts`.

**Files.** `apps/api/src/modules/notifications/{push-sender,expo-push.sender(.test),delivery-jobs,push-delivery,
email-delivery,notification-email(.test),push-receipts,notifications-delivery.processor,
notifications-maintenance.processor,notifications-delivery.int.test,notifications.module,notifications.events,
notifications.policy,notifications.repository,notifications-intake.processor}.ts`, `apps/api/src/modules/identity/
index.ts`, `apps/api/src/modules/account/{account-deletion.service,account-erasure.service,account.module,
account-deletion.int.test,account-erasure.int.test}.ts`, `apps/api/test/{fake-expo,notifications}.ts`.

**Tests.** Unit: `expo-push.sender.test.ts` (11: форма сообщения и заголовки, пачки 100/1000, без ключа — без
`Authorization`, 429/5xx/4xx, не по схеме/не JSON/число тикетов, лимит тела, таймаут и сеть, редирект, токены и ключ
не в логах), `notification-email.test.ts` (2). Int `notifications-delivery.int.test.ts` (22): постановка из intake и
повтор — те же 4 задачи; тихие часы — задача с задержкой, письмо сразу; push один раз и повтор `none`, чужие токены —
нет; две параллельные задачи — один push; сбой Expo → ретрай один push, последняя — `failed`; сбой worker после ответа
Expo — ретрай в пределах захвата не шлёт; выключенная группа — `skipped/disabled`; тихие часы → отложено, два — одна
сводка «У вас 2 новых уведомления.»; 21-й за час — `limited`; нет токенов / удалённый; тикет `DeviceNotRegistered`;
все тикеты с ошибкой; `PUSH_ENABLED=false` — `push_off` без запросов; квитанции (моложе 15 мин не проверяются,
`DeviceNotRegistered` снимает токен, неготовые остаются); письмо один раз, параллель — `busy`, сбой SMTP → ретрай,
последняя — `failed`, удалённый — `skipped`; регламент — потерянные задачи, без дублей, завершённая задача с тем же
jobId не мешает; истёкшее не захватывается. `account-deletion.int.test.ts` (+3: токены сняты, чужие на месте; откат
транзакции — токены остаются; неверный пароль — не тронуты), `account-erasure.int.test.ts` (+1: шаг стирает
уведомления/настройки/токены/тикеты A, B цел, повтор; шаг `notifications` в логах).
Отрицательные доказательства (вернул после): `revokeAllOf` вне транзакции — красный «откат транзакции»; захват push и
письма без условия состояния — 4 красных (push один раз, ретрай после сбоя, письмо один раз, параллельное письмо).

`TURBO_CONCURRENCY=1 pnpm check --force` (`MONGO_URL_TEST=…/pokatim_notifications_test`, `REDIS_URL_TEST=…/9`) —
зелёный: arch:check «no dependency violations found», api 117 files / 1250 tests passed, contracts 270, api-client 96,
admin 240; `Tasks: 13 successful, 13 total`. Во время разработки Redis db 9 параллельно чистили тесты другого
worktree (`nice-pasteur-1d135d`, `flushdb`) — отладочные прогоны шли на db 15, итоговый — на db 9 после их остановки.

**Follow-ups.** Шаг D (приложение, документация §10). Риски: две параллельные задачи push одного пользователя при
нескольких созревших уведомлениях делят их (два разных push, не дубль); уведомление, пришедшее во время активной задачи
того же jobId, ждёт регламента (≤ 20 мин).

### Шаг D — приложение и документация

**Changes.**
- Пакет `expo-notifications` `~58.1.6` (SDK 58) + плагин в `app.json`; `features/notifications/`: `queries.ts`
  (счётчик — polling 60 с только у вошедшего, список — `useInfiniteQuery`, мутации read/read-all/settings с
  инвалидацией `['notifications']`), `notification-target.ts` (белый список `race`/`ride`/`dispute-response` через
  схему контрактов; незнакомое — без перехода, из push — `/notifications`), `push.ts` (разрешение, канал Android
  `default`, токен только при `extra.eas.projectId` и на устройстве, токен в `secureStorage` `pokatim.pushToken`,
  обработчик и нажатия на push) + `push.web.ts` (no-op), `push-registration.ts` (регистрация, снятие с таймаутом 3 с,
  `usePushNotifications` в корневом layout после входа и онбординга), `push-permission-row.tsx` (запрос по нажатию;
  отказ навсегда — настройки ОС), `notification-row.tsx`.
- Колокольчик `components/notification-bell.tsx` («99+», a11y «Уведомления, N непрочитанных») в `TopBar` (новые
  необязательные пропсы), Главная передаёт счётчик. Экраны `/notifications` (FlatList, `AsyncContent` + скелетон строк,
  пусто, ошибки с повтором, баннер устаревших данных, догрузка с баннером ошибки в подвале, нажатие → read + переход,
  «Прочитать все» — недоступна без непрочитанных и во время запроса, строка push, вход в настройки) и
  `/settings/notifications` (группы × push, e-mail у «Споры»/«Райды», тихие часы — тумблер и чипы часов; сохранение
  каждого изменения, ошибка — баннер и прежнее значение); оба — в `Stack.Protected` вкладок; строка «Уведомления» в
  «Профиле». `useSignOut` снимает токен до отзыва сессии; после удаления аккаунта (`serverEnded`) — только забывает.
  Строки — `packages/i18n` (`notifications.*`, `profile.notifications`). Отклонения — §8.2 D-1…D-4.
- Документация: ADR-0017 + `docs/adr/README.md`, пометка в ADR-0013 п. 2; `AGENTS.md` §1 и §4.9; правила
  `pokatim-app/backend/db/contracts/security.md`; `docs/product/{home,account,README}.md`; `docs/runbooks/push.md`
  (новый), `account-deletion.md`, `runbooks/README.md`; `infra/deploy/docker-compose.yml` (`PUSH_ENABLED`,
  `EXPO_ACCESS_TOKEN` с пустым умолчанием) и `env.template` (`PUSH_ENABLED=false`).

**Tests.** `notification-target.test.ts` (15: белый список, unknown/null/не Uuid/адрес/путь строкой — без перехода,
push без цели — центр), `notification-bell.test.tsx` (9: 0/99/100 → «99+», a11y), `top-bar.test.tsx` (+1: колокольчик
первым), `push.test.ts` (4: холодный старт, нажатие, сводка без цели, баннер и счётчик, отписка),
`push-registration.test.ts` (8: регистрация, нет projectId — нет, нет разрешения — без запроса, снятие, ошибка и
таймаут не блокируют), `push.web.test.ts` (2: web без push), `use-sign-out.test.tsx` (3: снятие до отзыва сессии, сбой
не мешает выходу, `serverEnded` — без запроса), `__tests__/notifications.test.tsx` (25: скелетон, список, пусто, ошибки
с повтором, баннер обновления, догрузка по курсору и ошибка в подвале, переход по цели, unknown/null — без перехода,
«Прочитать все» и её состояния, строка push — запрос/нет/отказ навсегда, настройки — группы, тумблер, часы, выключено,
ошибка сохранения и загрузки, вход из «Профиля»).

`TURBO_CONCURRENCY=1 pnpm check` (`MONGO_URL_TEST=…/pokatim_notifications_test`, `REDIS_URL_TEST=…/14`) — зелёный:
arch:check «no dependency violations found», api 117 files, app 148 suites / 1298 tests, `Tasks: 13 successful, 13
total`. `EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 pnpm --filter @pokatim/app build:web` — `Exported: dist`, чанки
`notifications`, `expo-notifications` в web-бандл не попал.

**NOT VERIFIED.** Push на устройстве (нет EAS `projectId` и ключей APNs/FCM — runbook `push.md`), ручная проверка на
симуляторе и в браузере (`start:web`), web-смоук `e2e:web`.

### Фиксы ревью pass 1

По `findings-codex-pass1.md` и `findings-claude-pass1.md`; отклонения — §8.2 R1-1, R1-2.

- **[HIGH] Канал Android до разрешения.** `push.ts`: `ensureAndroidChannel()` — канал `default` до
  `requestPermissionsAsync` («Включить push») и до проверки разрешения при регистрации. Тесты: `push.test.ts` (+2:
  порядок вызовов на Android, iOS без канала), `push-registration.test.ts` (+1: канал до `getPermissionsAsync`).
- **[HIGH] Настройки во время сохранения.** `settings/notifications.tsx`: все `Toggle` — `disabled` при
  `update.isPending`, ряды часов — `aria-disabled` и без нажатий, `save` при pending — no-op. Тест
  `__tests__/notifications.test.tsx` (+1: при pending тумблеры и чип недоступны, второе изменение не уходит).
- **[HIGH] Гонка регистрации и выхода.** `push-registration.ts`: токен запоминается до запроса; регистрации в полёте —
  в наборе, `revokeDevicePushToken` ждёт их и снимает сохранённый токен (общий таймаут 3 с), затем стирает запись;
  после начала выхода регистрации под этой сессией не стартуют (новый вход — новая сессия). Тесты (+4): выход во время
  запроса ждёт и снимает тот же токен; регистрация до сервера при начавшемся выходе не стартует; после выхода — нет,
  после нового входа — да; зависшая регистрация — выход по таймауту, поздний ответ токен не возвращает.
- **[MEDIUM] Токены после сброса пароля / отзыва сессий.** API: `sessionId` в `push_tokens` (регистрация —
  `user.sessionId`), `IdentityAccounts.liveSessionIds(userId, ids, now)` + `IdentityRepository.findLiveSessionIds`,
  `PushDelivery.liveTokensOf` — push только на токены живых сессий, мёртвые снимаются (лог
  `notifications.token_session_ended`). Приложение: локальный выход по 401 (`applyAccessRefresh`, в т. ч.
  `revalidateSession`) — `forgetPushToken()`. ADR-0017 п. 7, `pokatim-security.md`. Int-тесты (+3): токен привязан к
  сессии запроса; сброс пароля → push не уходит, токен снят; отозванная сессия и сессия чужого пользователя — токены
  сняты, push только на живой. `session-store.test.ts`: 401 → токен забыт.
- **[MEDIUM] `expireAt` у писем.** `claimEmail`, `stuckEmails`, `stuckPush` — `expireAt > now`. Int-тест (+1:
  `expireAt === now` — письмо не захватывается, регламент не перепоставляет ни письмо, ни push).
- **[LOW] Лимит 20/ч на ретрае.** Сбой отправки (не последняя попытка) возвращает уведомления в `pending` с
  `push.limitCharged: true`; ретрай, где все уведомления уже списаны, лимит не тратит. Int-тест (+1: три сбоя Expo на
  20-м push — уходит, 21-й — `limited`).
- **[LOW] Documentation Sync.** `docs/runbooks/deploy.md` — строка про `PUSH_ENABLED`/`EXPO_ACCESS_TOKEN` в `.env`
  сервера.

**Проверки.** `TURBO_CONCURRENCY=1 pnpm check` (`MONGO_URL_TEST=…:27117/pokatim_notifications_test`,
`REDIS_URL_TEST=…:6479/14`) — зелёный: arch:check «no dependency violations found», api 119 files / 1269 tests, app
1379 tests, `Tasks: 15 successful, 15 total`.

**Follow-ups.**
- `apps/api/.env.example`: добавить `PUSH_ENABLED=false`, `EXPO_ACCESS_TOKEN=`, `EXPO_PUSH_API_URL` с комментариями —
  человеку (агентам чтение `.env*` запрещено).
- [LOW claude] Схлопывание при одновременной первой вставке двух событий одного объекта — не исправлялось.
- app-foundation: `disabled` у `Chip` `@rkarakulov/ui` (сейчас ряд часов блокируется обёрткой).
- Зависшая регистрация (без ответа сервера) остаётся в наборе ожидания до ответа сети: следующий выход ждёт её до
  таймаута 3 с.

### Фиксы ревью pass 2

По `findings-codex-pass2.md` (HIGH, 2 MEDIUM) и `findings-claude-pass2.md` (LOW 1); отклонения — §8.2 R2-1, R2-2.

- **[HIGH] Холодный старт по push до монтирования навигатора.** `PushNotifications` рядом со `Stack` в `_layout.tsx`:
  эффекты подписки и регистрации — только после готовности темы и шрифтов и монтирования навигатора.
  `subscribePushResponses`: слушатель нажатий ставится первым, сбои обработчика показа / последнего ответа — по
  отдельности и в `console.warn` (не отключают нажатия); последний ответ гасится только после успешного перехода.
  Тесты: `push-cold-start.test.tsx` (+1, `renderRouter`: корень ждёт шрифты, сессия готова раньше — до готовности
  ответ не тронут, после — `/rides/:id`, ответ погашен); `push.test.ts` (+2: неудачный переход — ответ не гасится,
  слушатель есть; сбой `setNotificationHandler` — нажатия и холодный старт работают).
- **[MEDIUM] Выход после таймаута и следующий аккаунт.** `revokeDevicePushToken` фиксирует сессию и операцию;
  `revokeStoredToken` после каждого ожидания проверяет, что операция не истекла и сессия та же, — иначе не читает
  хранилище и не снимает токен. Тест `push-registration.test.ts` (+1: A → таймаут выхода → вход B с токеном B →
  поздний ответ A — `revoke` не вызван, в хранилище токен B).
- **[MEDIUM] Тикеты при удалении аккаунта.** `PushTicketDoc.userId`, `insertTickets(userId, …)`, `eraseUser` —
  `deleteMany({ userId })`; миграция `0027_push_tickets_user`. Int-тесты: `notifications-delivery.int.test.ts` (+1: push
  → тикет → `revokeAllOf` в транзакции → `NotificationErasure.erase` — тикетов A нет, тикет B цел),
  `migrations.int.test.ts` (+1: индекс, порядок, повторный `up`).
- **[LOW claude-1] Снятие токенов по снимку.** `deleteTokens(PushTokenSnapshot[])` — `$or` по `{ _id, userId,
  sessionId }` (`null` → `$exists: false`); доставка — снимок прочитанного токена, квитанции — `{ _id, userId }`.
  Int-тесты (+2): токен мёртвой сессии, перепривязанный в окне к B, остаётся; `DeviceNotRegistered` при
  перерегистрации в окне под новой сессией — токен остаётся.
- Документация: `.claude/rules/pokatim-app.md` (`PushNotifications`), `.claude/rules/pokatim-db.md` (`push_tickets.userId`,
  0027, снятие по снимку).

**Проверки.** `TURBO_CONCURRENCY=1 pnpm check` (`MONGO_URL_TEST=…:27117/pokatim_notifications_test`,
`REDIS_URL_TEST=…:6479/14`) — зелёный: arch:check «no dependency violations found», api 119 files / 1273 tests, app
1383 tests, `Tasks: 15 successful, 15 total`.

### Фиксы ревью pass 3

По `findings-codex-pass3.md` (вердикт APPROVE): MEDIUM 2 и LOW исправлены, MEDIUM 1 — follow-up.

- **[MEDIUM] Неготовые квитанции блокировали следующие тикеты.** `NotificationsRepository.dueTickets(…, after)` —
  курсор обхода `(createdAt, _id)`; `PushReceipts.check` идёт дальше после последнего просмотренного тикета (до
  `receiptsMaxBatches` пачек за проход), пачка без готовых квитанций обход не останавливает. Без поля и миграции.
  Int-тест `notifications-delivery.int.test.ts` (+1): 1000 старших тикетов без квитанций, следующий —
  `DeviceNotRegistered` → в том же проходе `{ checked: 1, unregistered: 1 }`, токен снят, 1000 тикетов ждут.
- **[LOW] Гонка первой вставки по `collapseKey`.** `writeNotices`: дубль `notifications_collapse_unique` у операции со
  схлопыванием → повтор условной замены (`sourceEventId $lt`) без upsert; более новое событие заменяет вставленное
  старшее, устаревшее — без эффекта. Int-тест `notifications-intake.int.test.ts` (+1): старшее событие вставляется
  перед вставкой нового (подмена `bulkWrite` с настоящей ошибкой E11000) → один документ с `sourceEventId` и текстом
  нового. Закрывает follow-up «[LOW claude] Схлопывание при одновременной первой вставке» pass 1.

**Проверки.** `TURBO_CONCURRENCY=1 pnpm check` (`MONGO_URL_TEST=…:27117/pokatim_notifications_test`,
`REDIS_URL_TEST=…:6479/14`) — зелёный: api 119 files / 1275 tests, `Tasks: 15 successful, 15 total`.

**Follow-ups.**
- [MEDIUM codex pass 3] Поздняя регистрация старой сессии перезаписывает токен нового аккаунта: `registerToken`
  обновляет документ по `{ token }` без повторной проверки сессии; регистрация A, прошедшая `AuthGuard` до выхода, может
  записаться после регистрации B того же Expo-токена — владельцем станет A (мёртвая сессия), доставка его снимет, push B
  пропадут до следующей регистрации. Предлагаемый фикс: сериализовать проверку живой сессии и запись токена с отзывом
  сессии через порт identity и транзакцию с соответствующим замком; конкурентный тест — один токен, запрос A остановлен
  перед записью → выход A → регистрация B → продолжение A; владелец — B.

### Ревью pass 4 (Codex — APPROVE) и гейты оркестратора

- Codex pass 4: APPROVE; MEDIUM «поздняя регистрация старой сессии» и «порядок uuidv7 внутри миллисекунды при
  схлопывании» — follow-up (`pr.md`).
- `TURBO_CONCURRENCY=1 pnpm check` (оркестратор, изолированные Mongo/Redis db 14) — exit 0, `Tasks: 15 successful`,
  arch:check без нарушений, app 1383 теста.
