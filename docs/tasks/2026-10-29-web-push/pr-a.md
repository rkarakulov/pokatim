# Web Push (PR A): API, worker, env и деплой

Задача — `docs/tasks/2026-10-29-web-push/task.md`, решение — ADR-0022 (снимает «web push — нет» из ADR-0017 п. 1 и AGENTS §1/§4.9). Клиент и service worker — PR B.

## Что сделано

- **Web Push — второй транспорт канала `push`**, не отдельная система. Подписка браузера хранится в `push_tokens` (`platform: 'web'`, `token` = endpoint, ключи — `webPush`). Остальное работает как для Expo: уникальность и переход endpoint к вошедшему, ≤ 10 устройств, привязка к сессии, тумблеры групп, тихие часы, лимит 20/ч, сводка, захват и ретраи, стирание аккаунта. **Миграции нет**: индексы `push_tokens` подходят.
- **Контракты:** `WebPushEndpoint` (https, хосты push-сервисов FCM, Mozilla, WNS и Apple — защита от SSRF), `RegisterWebPushSubscription`, `RevokeWebPushSubscription`, `WebPushConfig`. В api-client — `getWebPushConfig`, `registerWebPushSubscription`, `revokeWebPushSubscription`.
- **HTTP** (все под `AuthGuard`, лимит `notifications-push-token` 30/ч):
  - `GET /v1/notifications/web-push` возвращает публичный ключ или `null`;
  - `PUT /v1/notifications/web-push/subscriptions`;
  - `POST /v1/notifications/web-push/subscriptions/revoke`.
- **Worker:** `PushDelivery` отправляет в Expo (`PUSH_ENABLED`) и в Web Push (`WEB_PUSH_SENDER`). Сбой одного транспорта не мешает другому, ретрай — только если не принял никто. Ответ 404/410 и невалидный ключ подписки снимают её сразу.
- **Адаптер** без новых зависимостей: aes128gcm (RFC 8291) на `node:crypto` совпадает байт в байт с вектором Appendix A, VAPID (RFC 8292) — через `jose`. Endpoint повторно проверяется по белому списку, редирект не исполняется, таймаут 10 с, в логах нет endpoint, ключей и JWT.
- **env:**
  - `WEB_PUSH_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. На старте проверяется, что ключи — пара;
  - `WEB_PUSH_TEST_ORIGIN` — только при `NODE_ENV=test`;
  - канал выключен (`push_off`), только если выключены оба транспорта.

## Env, конфиг и деплой

- `infra/deploy/env.template`: `WEB_PUSH_ENABLED=true`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY=@vapid-public`, `VAPID_PRIVATE_KEY=@vapid-private`.
- `infra/deploy/bootstrap.sh` один раз генерирует пару VAPID на сервере (openssl, P-256). Значения не печатаются и не покидают сервер. Если в `.env` осталась половина пары, деплой падает. **Секретов в GitHub не нужно.**
- `infra/deploy/docker-compose.yml` передаёт переменные в api и worker.
- `apps/api/.env.example`, runbooks `push.md` (раздел 7 «Web Push») и `deploy.md`.

## Проверки

- `pnpm check` — зелёный (format, lint, arch, typecheck, test; int-тесты на изолированных Mongo и Redis).
- Независимое ревью pass 1 — APPROVE (`findings-a.md`): 2 MEDIUM и 4 LOW исправлены.
