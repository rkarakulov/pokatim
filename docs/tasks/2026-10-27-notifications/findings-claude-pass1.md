# Findings — 2026-10-27-notifications — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..4a60e3e (be7942a … 4a60e3e), working tree clean
verdict: REQUEST CHANGES

Проверено: `pnpm arch:check` (0 нарушений), `typecheck` api и app, unit api (49 файлов / 393 теста), jest app по
уведомлениям, колокольчику, top-bar и use-sign-out (24 suites / 143 теста) — всё зелёное.
**NOT VERIFIED:** int-тесты (`notifications*.int.test.ts`, rides, results-check, account, migrations): локальный mongod на
27017 — standalone, harness требует replica set; запустить в CI или на `pnpm infra:up`.

Без замечаний по: intake (уникальный `(sourceEventId, userId)`, collapse `sourceEventId $lt`, 72 ч, liveness), захват
push/e-mail по `claimId`/`claimedUntil`, детерминированные jobId и `ensure` (completed — remove + add), регламент
redeliver, авторизация по `userId` сессии (чужое → 404, revoke чужого → 204), зод-контракты и `tolerantEnum`,
белый список целей в приложении, Expo-адрес только из env (production — только `exp.host`, без редиректов, таймаут,
лимит тела), токены не в логах, `revokeAllOf` в транзакции удаления после `lockUserCredentials`, шаг стирания
`notifications`, rides `join/update/cancel` в транзакции с условием в фильтре, `RideErasure` по одному райду,
`reports-resolved` в транзакции модерации, `lastVisibleVerdict` + бэкфилл 0026, миграции expand-only, развилка
`push(.web).ts`, i18n-ключи.

### [HIGH] Настройки уведомлений: переключатели и чипы не блокируются на время сохранения — гонка полных PUT
- **file:** apps/app/src/app/settings/notifications.tsx
- **location:** `SettingsForm` (`value = update.isPending && update.variables ? …`, `save`, `<Toggle …>`, `HourPicker` / `<Chip>`)
- **problem:** каждое изменение шлёт полный объект `PUT /v1/notifications/settings`, но `Toggle` и `Chip` остаются
  активными, пока предыдущий запрос в полёте. Два быстрых изменения дают два параллельных полных PUT; `onSuccess`
  каждого вызова делает `setQueryData(settingsKey, saved)`, поэтому ответ, пришедший последним (не обязательно
  последнего запроса), затирает кеш. Сервер тоже может применить их в любом порядке (`replaceOne`). Итог — UI показывает
  одно, на сервере другое (пример: выключили push «Райды», сразу e-mail «Споры» → один из тумблеров «вернулся»), а
  ошибка второго запроса откатывает к устаревшему `saved`.
- **why_it_matters:** AGENTS.md §4.12 «мутации — состояние кнопки (disabled на время запроса)»; по контракту ревью
  нарушение §4.12 — HIGH. Плюс тихая потеря пользовательской настройки (push не выключился).
- **evidence:** `<Toggle label=… value={value.push[group.id]} onChange={(on) => save({...})} />` — без `disabled`;
  `ToggleProps` в `@rkarakulov/ui` поддерживает `disabled?: boolean`; `onSuccess: (saved) => queryClient.setQueryData(settingsKey, saved)` в `useUpdateNotificationSettings`.
- **recommended_fix:** `disabled={update.isPending}` на всех `Toggle` и `Chip` формы (или сериализовать: `mutationKey` +
  `scope: { id: 'notification-settings' }` TanStack Query v5, чтобы мутации шли по очереди), и тест «второе изменение
  во время сохранения недоступно / ставится после первого».

### [MEDIUM] Push-токены переживают сброс пароля и выход по 401 — устройство без сессии продолжает получать push аккаунта
- **file:** apps/api/src/modules/identity/password-reset.service.ts; apps/app/src/features/auth/session-store.ts; apps/app/src/features/notifications/push-registration.ts
- **location:** `password-reset.service.ts:134` (`revokeAllSessions(…, 'password_reset')`); `session-store.ts` `applyAccessRefresh` (переход в `signedOut` без `useSignOut`) и native `revalidateSession` 401
- **problem:** токены снимаются только явным `useSignOut`, `DeviceNotRegistered` и удалением аккаунта. Сброс пароля
  отзывает все сессии, но не `push_tokens`; токен не привязан к сессии. Злоумышленник с украденной сессией, успевший
  зарегистрировать свой Expo-токен, после сброса пароля жертвой продолжает получать её push (названия гонок, вердикты,
  споры, отмены райдов) бессрочно. Аналогично: локальный выход по 401 refresh (сессия отозвана с другого устройства,
  reuse detection) не вызывает `revokeDevicePushToken` — выйденное устройство продолжает получать push, а
  `pokatim.pushToken` остаётся в SecureStore.
- **why_it_matters:** pokatim-security.md: «инвалидация всех сессий при сбросе пароля» — смысл в том, что сброс
  выкидывает чужое устройство; ADR-0017 п. 7 и security-правило «Снятие: выход…» — выход по 401 тоже выход.
- **evidence:** `PushTokensService.register` пишет `{ token, userId, platform }` без `sid`; `NotificationsRepository.revokeAllTokens`
  вызывается только из `AccountDeletionService`; `useSignOut` — единственный вызов `revokeDevicePushToken`.
- **recommended_fix:** в транзакции сброса пароля (после `lockUserCredentials`) — `PushTokens.revokeAllOf(tx, userId)`
  (identity → notifications через порт или событие; либо хранить `sessionId` в токене и в доставке брать только токены
  живых сессий). В приложении — при переходе в `signedOut` не через `useSignOut` хотя бы `forgetPushToken()`; задокументировать
  остаточный риск, если серверную часть откладываете.

### [LOW] Documentation Sync: `apps/api/.env.example` и `docs/runbooks/deploy.md` не обновлены
- **file:** apps/api/.env.example; docs/runbooks/deploy.md
- **location:** —
- **problem:** §10 task.md требует обоих; отклонение D-4 описано («запрет чтения .env* в брифе шага»), но `.env.example`
  — не секрет, и `PUSH_ENABLED`/`EXPO_ACCESS_TOKEN`/`EXPO_PUSH_API_URL` в нём нет.
- **why_it_matters:** локальный запуск и новый разработчик не узнают о флаге и адресе фейк-сервера.
- **evidence:** `git diff origin/develop...HEAD --stat` — файлов нет; task.md §8.2 D-4.
- **recommended_fix:** добавить три переменные с комментариями в `.env.example`; в deploy.md — строку про 0025/0026.

### [LOW] Лимит 20 push/ч расходуется на каждой попытке ретрая
- **file:** apps/api/src/modules/notifications/push-delivery.ts
- **location:** `deliver` — `rateLimiter.consume` до `sender.send`
- **problem:** сбой Expo → `pending` + ретрай BullMQ (до 5 попыток) — каждая попытка снова списывает лимит; при
  нестабильном Expo одна сводка может съесть 5 из 20.
- **why_it_matters:** лишние `limited` у райдера (N7), push теряются только в центре.
- **evidence:** `const limited = await this.rateLimiter.consume(...)` перед `try { tickets = await this.sender.send(messages) }`.
- **recommended_fix:** принять и задокументировать, либо не списывать повторно для того же `claimId`/job (например, ключ лимита — при первом успешном ответе Expo).

### [LOW] Collapse: одновременная первая вставка двух событий одного объекта отбрасывает более новое как «устаревшее»
- **file:** apps/api/src/modules/notifications/notifications.repository.ts
- **location:** `writeNotices`, ветка `collapseKey` + `isRepeatOrStale`
- **problem:** при пустой коллекции две параллельные задачи intake (concurrency 4) с событиями A<B обе делают upsert;
  если A вставился первым, B ловит `11000` по `notifications_collapse_unique` и считается устаревшим (фильтр с `$lt` —
  не равенство, сервер upsert не повторяет). Текст берётся из текущего состояния райда, так что содержание обычно
  совпадает — потеря практически невидима.
- **why_it_matters:** N7 «замена прежнего более новым» в узком окне не выполняется.
- **evidence:** `filter: { userId, collapseKey, sourceEventId: { $lt: sourceEventId } }, upsert: true`; dup-key → `return error.result.upsertedCount + …`.
- **recommended_fix:** при `11000` по collapse-индексу повторить операцию один раз (второй проход найдёт документ и
  применит `$lt`); или принять с комментарием в репозитории.
