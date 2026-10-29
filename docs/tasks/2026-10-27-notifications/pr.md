# Центр уведомлений: модуль notifications, push через Expo, экран 13

## Что

Райдер узнаёт о результатах, спорах и райдах из центра уведомлений и push. Решения автора N1–N12 —
`docs/product/notifications.md`, архитектура — ADR-0017 (снимает запрет push из AGENTS §1 для iOS/Android; web push —
позже). Решение A11 эпика результатов: модули-источники только пишут outbox, `notifications` подписан на них.

- **Источники (outbox в своих транзакциях, payload — только id и коды):**
  - `results`: новое `results.attempt-verdict-changed` — только при смене видимого вердикта (поле `lastVisibleVerdict`,
    массовая перепроверка без смены статуса не уведомляет);
  - маршруты для `results.protocol-published` и `results.result-revised`, а также `disputes.*`;
  - `rides`: `update`/`cancel`/`join`, отмена при стирании и `act` модерации переведены на `MongoTransactions` + outbox.
    События `ride-cancelled`, `ride-rescheduled`, `participant-joined`, `reports-resolved`;
  - порты чтения получателей `ResultsNotices`, `DisputeNotices`, `RideNotices`, `IdentityAccounts.liveUserIds` и
    `liveSessionIds`. Чужие коллекции `notifications` не читает.
- **Модуль `notifications`:**
  - Очередь `notifications-intake`: событие → получатели → настройки → upsert. Уникальность `(sourceEventId, userId)`,
    схлопывание по `collapseKey`, события старше 72 ч пропускаются.
  - Очередь `notifications-delivery`: push через Expo (порт `PUSH_SENDER`) — одна задача на пользователя, захват с
    lease, тихие часы с отложенной задачей и сводкой, лимит 20/ч. Письма N2 — решение по спору и отмена райда.
  - Регламент `notifications-maintenance`: квитанции Expo (`DeviceNotRegistered` снимает токен) и повторная доставка
    зависших.
  - Тексты — снимок сервера без чужих ПДн.
- **API `/v1/notifications`** (AuthGuard, только свои, чужое — 404): список с курсором, `unread-count`, `:id/read`,
  `read-all`, `settings` GET/PUT, `push-tokens` PUT и `revoke`. Лимиты: read 120/мин, settings 30/ч, push-token 30/ч.
- **Push-токены** привязаны к сессии: доставка идёт только на токены живых сессий, поэтому выход, сброс пароля и отзыв
  сессии отрезают устройство. При удалении аккаунта токены снимаются в транзакции удаления. Шаг стирания
  `notifications` удаляет уведомления, настройки, токены и квитанции.
- **Приложение (iOS/Android/web):**
  - колокольчик со счётчиком на Главной (polling 60 с, «99+», a11y);
  - центр `/notifications`: состояния §4.12, «Прочитать все», переход по цели из белого списка;
  - настройки `/settings/notifications`: группы × push/e-mail, тихие часы — вход из центра и профиля;
  - `expo-notifications`: разрешение по нажатию, канал Android создаётся до запроса; токен снимается при выходе;
    нажатие на push обрабатывается после монтирования навигатора. В web push нет.
- **Документация:** ADR-0017, AGENTS §1/§4.9, `docs/product/{notifications,home,account,README}.md`, runbooks
  `push.md` (новый), `account-deletion.md`, `deploy.md`, правила `pokatim-{app,backend,db,contracts,security}.md`.

## Важно

- **Миграции** `0025_notifications` (4 коллекции, индексы, TTL 90 дней), `0026_attempt_last_verdict` (бэкфилл
  `lastVisibleVerdict` у counted/rejected) и `0027_push_tickets_user` (индекс). Все только добавляют данные, ничего не
  удаляют. Порядок деплоя: миграции → API/worker.
- **Новые env:**
  - `PUSH_ENABLED` — по умолчанию `false`; без него push помечаются `skipped`, а центр работает;
  - `EXPO_ACCESS_TOKEN` — необязательный секрет;
  - `EXPO_PUSH_API_URL` — в production разрешён только `exp.host`.

  В `infra/deploy` добавлены `PUSH_ENABLED=false` и проброс `EXPO_ACCESS_TOKEN`.
- **Накопленные события** споров и протоколов теперь получают маршрут. Издатель outbox заберёт их хвост, но intake
  пропустит всё старше 72 ч.
- **Ручной шаг для push на устройствах:** `eas init` (`projectId`), ключи APNs и FCM в EAS, `PUSH_ENABLED=true` —
  runbook `push.md`.
- **Слайс 08 (рейтинг)** тоже слушает `protocol-published` и `result-revised`, а outbox ведёт тип в одну очередь. Нужен
  fan-out в app-foundation (ADR-0017).

## Проверки

- `TURBO_CONCURRENCY=1 pnpm check` на изолированных Mongo и Redis — зелёный (`task.md` §12).
- Ревью Claude independent-reviewer: pass 1 — REQUEST CHANGES, pass 2 — APPROVE. Codex: pass 1 и pass 2 — REQUEST
  CHANGES, pass 3 и pass 4 — APPROVE. Находки исправлены, отчёты — `findings-*.md`.

## NOT VERIFIED

- Push на реальных iOS/Android: нет EAS `projectId` и ключей.
- e2e веба с API.
- Проверка центра на dev — после деплоя, на синтетическом аккаунте.

## Follow-ups

- ~~Поздняя регистрация токена старой сессией может перезаписать токен нового аккаунта на том же устройстве (MEDIUM
  Codex pass 3).~~ Закрыто `docs/tasks/2026-10-29-push-token-race` (порядок сессий в фильтре `registerToken`).
- ~~Схлопывание сравнивает `sourceEventId` (uuidv7): два события одного объекта в одну миллисекунду могут прийти в
  обратном порядке, и останется старший текст (MEDIUM Codex pass 4).~~ Закрыто `docs/tasks/2026-10-29-push-token-race`
  (счётчик состояния объекта `collapseSeq`).
- `apps/api/.env.example`: добавить `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN`, `EXPO_PUSH_API_URL`. Агентам читать `.env*`
  запрещено, поэтому правка за человеком.
- `disabled` у `Chip` в `@rkarakulov/ui` (app-foundation).
- Fan-out outbox для слайса 08.
- Web push.
