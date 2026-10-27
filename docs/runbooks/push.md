# Push через Expo

Как устроено — ADR-0016, продукт — `docs/product/notifications.md`. Центр уведомлений и колокольчик работают всегда;
push — только на iOS и Android, когда есть EAS `projectId`, ключи APNs/FCM в EAS и `PUSH_ENABLED=true` на сервере.
Web push нет.

## 1. EAS `projectId` (приложение)

Без него приложение не получает токен (`getExpoPushTokenAsync`) и ничего не регистрирует.

1. В `apps/app`: `pnpm exec eas init` (вход в аккаунт Expo владельца) — команда создаёт проект и пишет
   `expo.extra.eas.projectId` в `app.json`.
2. Закоммитить `app.json` (идентификатор проекта не секрет).
3. Проверка: `Constants.expoConfig.extra.eas.projectId` в сборке не пуст — в dev build после входа и разрешения push
   на сервере появляется документ в `push_tokens` (см. п. 4).

Expo Go на Android удалённые push не получает (SDK 53+): проверять только в dev build (`eas build --profile
development`) или preview-сборке на устройстве, не на симуляторе.

## 2. Ключи APNs и FCM (EAS)

1. iOS: `pnpm exec eas credentials -p ios` → Push Notifications → создать или загрузить ключ APNs (.p8) из Apple
   Developer. Ключ хранится в EAS, в git и чат не попадает.
2. Android: Firebase-проект с пакетом `by.pokatim.app` → сервисный аккаунт FCM v1 (JSON) → `pnpm exec eas
   credentials -p android` → FCM V1 service account key. Файл ключа — только в EAS.
3. Пересобрать приложение (`build:preview` / `build:testflight`) — плагин `expo-notifications` уже в `app.json`.

## 3. Сервер (api и worker)

| Переменная | Значение | Где |
|---|---|---|
| `PUSH_ENABLED` | `true` — отправлять; по умолчанию `false`: push помечается `skipped/push_off`, центр работает | `.env` сервера (dev — `infra/deploy/env.template`) |
| `EXPO_ACCESS_TOKEN` | необязательный секрет Expo (если в проекте Expo включена «Enhanced security for push») | только `.env` сервера, не в git |
| `EXPO_PUSH_API_URL` | по умолчанию `https://exp.host/--/api/v2/push`; в production другого быть не может | менять только в тестах |

После правки — перезапустить api и worker. Секреты в логи не пишутся; токены устройств — тоже (в логах — id
документа).

## 4. Проверка

1. На устройстве: войти, «Уведомления» → «Включить push-уведомления» → разрешить.
2. mongosh (база API): `db.push_tokens.find({ userId: '<uid>' }, { token: 0 })` — документ есть, `platform` верный.
3. Вызвать событие (например, перенести свой тестовый райд, где тестовый райдер нажал «Я иду») — push приходит, нажатие
   открывает карточку райда; в центре уведомление непрочитано.
4. Логи worker: `notifications.push_failed` — нет; через 15–30 мин `notifications.receipts checked=<n>
   unregistered=<n>`.
5. Состояние доставки: `db.notifications.find({ userId: '<uid>' }, { push: 1, kind: 1 })` — `push.state: 'sent'`.
   `skipped` с `reason: 'push_off'` — выключен `PUSH_ENABLED`; `no_tokens` — нет токена; `disabled` — группа выключена
   в настройках; `limited` — больше 20 push за час.

## 5. Сбои

- Expo недоступен (сеть, 429, 5xx): задача повторяется BullMQ; после последней попытки — `push.state: 'failed'` и лог
  `notifications.push_failed uid=<uid> count=<n>`; failed-задача — очередь `notifications-delivery`. Регламент
  `notifications.redeliver` (каждые 10 мин) переставляет потерянные задачи.
- `DeviceNotRegistered` (приложение удалено, токен устарел) — токен снимается сам (в тикете или квитанции).
- Принятый риск: падение worker между ответом Expo и записью факта даёт повторный push.

## 6. Откат

`PUSH_ENABLED=false` и перезапуск worker: новые уведомления пишутся только в центр, отложенные push уходят в
`skipped`. Токены остаются; включение обратно не требует действий в приложении.
