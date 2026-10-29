# Web Push для PWA — канал `push` существующей системы уведомлений

- Уровень: task3 (контракты, API, worker, env/deploy, приложение, service worker, безопасность)
- Ветки: `feature/web-push-api` (PR A: контракты, API, worker, env, deploy), `feature/web-push-app` (PR B: приложение, SW)
- Основание: follow-up «Web push» из `docs/tasks/2026-10-27-notifications/pr.md`; ADR-0017 п. 1 («web push — нет»)
  снимается новым ADR-0022.

## 1. Что было (UNDERSTAND)

- API `notifications` (ADR-0017): событие источника → outbox → `notifications-intake` → документ уведомления (текст —
  снимок сервера, цель — тип + id из белого списка) → `initialDelivery` по настройкам (`settings.push[group]`, тихие
  часы, `PUSH_ENABLED`) → задача `notifications.push` (jobId на пользователя и срок) → `PushDelivery`: захват (lease),
  тумблер группы, тихие часы, токены живых сессий (`IdentityAccounts.liveSessionIds`), лимит 20/ч, одно сообщение на
  токен (одно уведомление или сводка), `ExpoPushSender`, `DeviceNotRegistered` → снятие токена, тикеты → квитанции.
- Хранение устройств — `push_tokens` (`token` глобально уникален и переходит к вошедшему, ≤ 10 на пользователя,
  `sessionId` — сессия регистрации, `platform: ios|android`). Регистрация `PUT /v1/notifications/push-tokens`, снятие
  `POST …/push-tokens/revoke` (лимит 30/ч по uid), снятие всех — в транзакции удаления аккаунта, стирание — шаг
  `NotificationErasure`.
- Приложение: шов платформы `features/notifications/push.ts` (native, `expo-notifications`) / `push.web.ts` (no-op,
  `pushSupported = false`). `PushNotifications` (корневой layout) регистрирует токен при входе/запуске и слушает
  нажатия; `revokeDevicePushToken` снимает токен до `api.signOut`. Экран `/settings/notifications`: строка разрешения
  `PushPermissionRow`, тумблеры push по группам, e-mail, тихие часы; на web — только письма.
- Web: Expo Router SSR + PWA, `sw.js` генерирует `scripts/build-service-worker.ts` (precache хешированной статики),
  регистрация — inline-скрипт в `+html.tsx` (`/sw.js`, scope `/`). manifest — `public/manifest.webmanifest`
  (display `standalone`). Standalone-детекта в коде нет.

## 2. Чего не хватает

Транспорта Web Push: VAPID, хранения `PushSubscription`, шифрования payload (RFC 8291) и отправки на push-сервис,
обработчиков `push`/`notificationclick` в SW, клиентской подписки и состояния на экране настроек.

## 3. Спецификация

### 3.1 Решения

| # | Решение | Почему |
|---|---|---|
| D1 | Web Push — второй **транспорт** канала `push`: те же настройки групп, тихие часы, лимит 20/ч, захват, сводка, привязка к сессии. Подписка — документ `push_tokens` с `platform: 'web'`, `token = endpoint`, ключи `p256dh`/`auth` — поле `webPush`. | «Без параллельной системы»: уникальность endpoint, переход владельца, ≤ 10 на пользователя, снятие при выходе, удалении аккаунта и мёртвой сессии — уже есть. Миграция не нужна: `push_tokens_token_unique` и `push_tokens_user_idx` покрывают. |
| D2 | Свой адаптер `WebPushSender` (aes128gcm RFC 8291 на `node:crypto`, VAPID RFC 8292 — ES256 JWT через уже подключённый `jose`) вместо пакета `web-push`. | Без новых зависимостей; адаптер в стиле `ExpoPushSender` (таймаут, без редиректов, лимит тела, без токенов в логах). Корректность шифрования — тест-вектор RFC 8291 Appendix A. |
| D3 | Endpoint — только `https` на хостах push-сервисов из allowlist (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`/`*.push.apple.com`); проверка в контракте и повторно в адаптере. | Сервер шлёт POST на адрес от клиента — защита от SSRF. |
| D4 | Флаги транспорта: `PUSH_ENABLED` — Expo (как было), `WEB_PUSH_ENABLED` + `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` — Web Push. Канал выключен (`push_off`), только если выключены оба. Токены выключенного транспорта не трогаются и не считаются. | Dev включает Web Push, не включая Expo (нет EAS `projectId`). |
| D5 | Публичный ключ — `GET /v1/notifications/web-push` (`{ publicKey: string \| null }`, `null` — выключено): клиент без пересборки узнаёт ключ и скрывает опцию, если сервер Web Push не шлёт. | Ротация ключа без пересборки web; один источник правды. |
| D6 | Payload — `{ title, body, target }` (снимок уведомления или сводка; цель — тип + id из белого списка), шифруется ключами подписки. Ни userId, ни e-mail, ни адресов. SW строит путь по цели своей копией белого списка (паритет с `notificationTargetPath` — тест). | ADR-0017 п. 3 «адресов нет». |
| D7 | 404/410 от push-сервиса → подписка удаляется сразу (как `DeviceNotRegistered`); 429/5xx/сеть → ретрай задачи, если никто не принял; 413/прочие 4xx → `failed` этой подписки. | Требование «очистка при 404/410». |
| D8 | Подписка привязана к пользователю, endpoint (устройство/профиль браузера) и сессии входа (как токены Expo): после выхода, сброса пароля, отзыва push не уходят. Клиент при каждом запуске с сессией и разрешением повторно отправляет подписку (upsert) — переподписка, истечение (`expirationTime`) и новая сессия обрабатываются этим же путём; подписка под другим `applicationServerKey` (сервер сменил пару VAPID) — отписка и новая подписка. | Состояние верно после reload и login; «не к сессии браузера» — запись живёт по endpoint, а не по вкладке. |
| D9 | Выход: `POST …/web-push/subscriptions/revoke` (до `signOut`) + `PushSubscription.unsubscribe()` в браузере. Следующий вход с выданным разрешением подписывает заново без запроса. | «При logout — отписка или отвязка» — обе. |
| D10 | Поддержка: `serviceWorker` + `PushManager` + `Notification`; iOS/iPadOS — только standalone (`navigator.standalone` / `display-mode: standalone`); сервер вернул `publicKey`. Иначе опции нет (экран — как сейчас на web, только письма). | Платформы из задачи. |

### 3.2 Контракты (`packages/contracts`)

- `WebPushEndpoint` — https URL ≤ 2048, хост из allowlist (D3).
- `RegisterWebPushSubscription` = `{ endpoint, keys: { p256dh (base64url, 65 байт), auth (base64url, 16 байт) } }`
  (strict; `expirationTime` клиент не шлёт).
- `RevokeWebPushSubscription` = `{ endpoint }`; `WebPushConfig` = `{ publicKey: string | null }`.
- `PUSH_PLATFORMS` не меняется (Expo); тип платформы токена в БД — `PushPlatform | 'web'`.

### 3.3 API

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/v1/notifications/web-push` | `WebPushConfig`, `no-store` |
| PUT | `/v1/notifications/web-push/subscriptions` | `204`; upsert по endpoint, владелец и сессия — из `AuthGuard` |
| POST | `/v1/notifications/web-push/subscriptions/revoke` | `204` всегда (чужая/неизвестная — без эффекта) |

Под `AuthGuard`, лимит — общий `notifications-push-token:<uid>` (30/ч). Тело — zod из контракта.

### 3.4 Worker

`PushDelivery.deliver`: гейт `push_off` — оба транспорта выключены; токены живых сессий делятся по платформе;
Expo — `ExpoPushSender` (как было), web — `WebPushSender` по одной подписке (TTL 24 ч, `urgency: normal`).
Сбой Expo не останавливает Web Push. Итог: принят хоть одним — `sent`; никто не принял и были временные сбои web или
сбой Expo — ретрай (последняя попытка — `failed`); иначе `failed` с первой ошибкой. 404/410 и ключ подписки не точка
P-256 — подписка снимается (снимок, как `deleteTokens`).
Лог: `uid`, счётчики `tokens/web/accepted/unregistered` — без endpoint и ключей.

### 3.5 Приложение и SW (PR B)

- `push.web.ts`: реальная реализация шва (поддержка D10, разрешение, подписка VAPID, `endpoint` для снятия,
  нажатия — `message` от SW). Интерфейс шва расширен: `usePushSupported()` (native — `true`; web — после монтирования,
  SSR — `null`), `getPushPermission()` → `status` (`unavailable | undetermined | denied | granted`) и для web при
  `granted` — `subscription: active | missing | expired`; отправка регистрации/снятия — `sendPushRegistration` /
  `sendPushRevoke` шва (экраны и `push-registration.ts` о платформе не знают). Сбой `GET web-push` (сеть, 5xx) —
  как «нет поддержки» до следующего открытия экрана (принято, ревью B LOW-1).
- `PushPermissionRow`: строки для `default` (включить — запрос), `granted-unsubscribed` (включить на этом устройстве),
  `expired` (обновить подписку), `denied` (web: «разрешите в настройках браузера или системы», без перехода).
- `/settings/notifications`: тумблеры push и тихие часы — когда поддержка есть (web — тоже).
- SW (`serviceWorkerSource`): `push` — `showNotification(title, { body, icon, data: { target } })` (без `tag`: каждое
  уведомление видно; без `badge`: монохромной иконки нет) и
  `postMessage({ type: 'pokatim:push' })` открытым окнам; `notificationclick` — окно своего origin есть: `focus()` +
  `postMessage({ type: 'pokatim:open', target })`; нет — `openWindow(путь цели)`; `pushsubscriptionchange` —
  ничего не шлёт (нет access token), синхронизация — при следующем запуске приложения (D8).

## 4. Security checklist

1. **AuthN/AuthZ:** все три эндпоинта — `AuthGuard`; `userId`/`sessionId` — только из гарда, в теле их нет (strict).
   Снятие — `deleteOne({ userId, token })`: чужая подписка не снимается. Upsert по endpoint переносит владельца на
   вошедшего (устройство одно), сессия — текущая.
2. **Входные данные:** strict-схемы, endpoint — https + allowlist хостов (D3), ≤ 2048; ключи — base64url точной длины
   (p256dh — 65 байт, начинается с `0x04`; auth — 16 байт). Адаптер повторно проверяет endpoint перед отправкой.
3. **Данные наружу:** `WebPushConfig` — только публичный ключ. Payload — снимок текста и цель (D6), зашифрован.
4. **Злоупотребления:** лимит 30/ч по uid на регистрацию/снятие, ≤ 10 устройств на пользователя, лимит 20 push/ч.
   SSRF — allowlist, редирект не исполняется (`redirect: 'manual'` → `protocol`), таймаут 10 с, тело ответа не читается.
5. **Секреты и логи:** `VAPID_PRIVATE_KEY` — только env сервера (dev — генерируется на сервере `bootstrap.sh`, не
   покидает его); в логах нет endpoint, ключей, JWT. Проверка на старте: ключи — пара (публичный выводится из
   приватного).
6. **Аудит:** не требуется (не чувствительное действие по AGENTS §4.10).

## 5. Test matrix

| Что | Где |
|---|---|
| схемы: endpoint allowlist/https/длина, ключи, strict | `notification.schema.test.ts` |
| api-client: пути и методы | `api-client/src/notifications.test.ts` |
| шифрование aes128gcm — вектор RFC 8291 A, VAPID JWT (aud, exp, sub, подпись ключом) | `web-push.crypto.test.ts` |
| адаптер: 201 → ok, 404/410 → gone, 429/5xx/сеть → unavailable, 413/4xx → rejected, чужой хост — без запроса | `web-push.sender.test.ts` |
| env: `WEB_PUSH_ENABLED` без ключей / ключи не пара — отказ | `env.test.ts` |
| subscribe / resubscribe (смена владельца), unsubscribe чужой — без эффекта, лимит, гард, SSRF — 400 | `web-push.int.test.ts` |
| доставка: web при включённой группе, выключенная группа — нет, несколько подписок, 404/410 → удаление, отозванная сессия, Expo выключен — web идёт, сбой web — ретрай | `web-push.int.test.ts` |
| intake: при выключенном Expo и включённом Web Push — `pending`, не `push_off` | `web-push.int.test.ts` |
| оба транспорта: сбой Expo — web доставлен без ретрая; сбой web — Expo без ретрая; оба — ретрай; `DeviceNotRegistered` + 410 | `web-push-expo.int.test.ts` |
| SW: `push` показывает уведомление, `notificationclick` фокус + message / openWindow по цели; паритет путей | `scripts/service-worker.test.ts`, `notification-target.test.ts` (PR B) |
| `push.web.ts`: поддержка, статусы, подписка, снятие | `push.web.test.ts` (PR B) |

## 6. Placement

Всё в модуле `notifications` (API) и `features/notifications` (приложение); env — `config/env.ts`; deploy —
`infra/deploy/*`. Новых модулей и пакетов нет. ADR-0022 снимает «web push нет» (AGENTS §1, §4.9, ADR-0017 п. 1).

## 7. Outcome

- PR A (API, worker, env, deploy, ADR-0022): independent review pass 1 — APPROVE (2 MEDIUM, 4 LOW,
  `findings-a.md`); исправлены: сбой Expo больше не блокирует Web Push, тесты обоих транспортов, байтовый лимит
  payload (`encodePayload`), невалидный ключ подписки — `gone`, спека redirect и матрица тестов. PR #109 смержен.
- ADR перенумерован в 0022 (0021 занял user-theme, смержен раньше).
- PR B (приложение, SW): independent review pass 1 — APPROVE (1 MEDIUM, 7 LOW, `findings-b.md`); исправлены: выход не
  ждёт `serviceWorker.ready` (`getRegistration`), без `badge`, комментарий о цикле импорта, крайние случаи паритета.
