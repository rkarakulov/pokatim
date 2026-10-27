# Findings — 2026-10-27-notifications — pass 2 — reviewer: claude
base: origin/develop   commits: origin/develop..4439f07 (фиксы pass 1 — 4439f07), working tree clean (кроме findings-*.md)
verdict: APPROVE

Проверено самостоятельно: `pnpm arch:check` (0 нарушений), `tsc --noEmit` api и app, `pnpm format:check`;
`apps/api` `pnpm test` целиком (unit + int) на `MONGO_URL_TEST=…:27117/pokatim_notifications_review_test?replicaSet=rs0`,
`REDIS_URL_TEST=…:6479/5` — 119 файлов / 1269 тестов, зелёно (примечание: имя БД должно оканчиваться на `_test`,
иначе globalSetup падает с маскированной ошибкой vitest `code.charCodeAt`); jest app — уведомления, auth,
колокольчик, top-bar (22 suites / 178 тестов), зелёно.

## Проверка находок pass 1

| Находка | Статус | Основание |
|---|---|---|
| [HIGH codex] Канал Android после разрешения | исправлено | `push.ts` `ensureAndroidChannel()` до `requestPermissionsAsync` и до `getPermissionsAsync`; тесты порядка вызовов (`invocationCallOrder`) в `push.test.ts`, `push-registration.test.ts` |
| [HIGH claude+codex] Настройки не блокируются при сохранении | исправлено | `busy = update.isPending`: `disabled` у всех `Toggle`, `save` — no-op при pending, ряд часов `aria-disabled` + `pointerEvents: 'none'` + guard в `onPress`; тест «второе изменение не уходит» |
| [HIGH codex] Гонка регистрации токена и выхода | исправлено | `inFlight` + `closingSession`; токен запоминается до запроса; `revokeStoredToken` ждёт `allSettled(inFlight)` под общим таймаутом; поздняя серверная запись нейтрализуется привязкой к сессии (сессия отзывается выходом). 4 конкурентных теста |
| [MEDIUM claude] Токены после сброса пароля / 401 | исправлено | `push_tokens.sessionId` из `AuthGuard`; `PushDelivery.liveTokensOf` → `IdentityAccounts.liveSessionIds` (фильтр `userId`, `revokedAt: null`, `expiresAt > now`); ротация refresh сохраняет `_id` сессии (`rotateSession` — тот же документ, скользящий `expiresAt`), т. е. токен не «умирает» на refresh. Приложение: `applyAccessRefresh` → `forgetPushToken()` (web — no-op из `push.web.ts`). Int-тесты: сброс пароля, отозванная и чужая сессия |
| [MEDIUM codex] `expireAt` в захвате письма | исправлено | `claimEmail`, `stuckEmails`, `stuckPush` — `expireAt: { $gt: now }`; тест `expireAt === now` |
| [LOW claude] Лимит на ретрае | исправлено | `push.limitCharged` при `pending` после сбоя; ретрай, где все захваченные уже списаны, лимит не тратит; int-тест |
| [LOW claude] Documentation Sync | частично (принято) | `deploy.md` — строка про `PUSH_ENABLED`/`EXPO_ACCESS_TOKEN`; миграции — общим шагом `migrate` (обосновано в §8.2); `.env.example` — follow-up человеку (см. ниже) |
| [LOW claude] Collapse при одновременной первой вставке | не исправлялось, принято | follow-up в task.md |

## Новые находки

### [LOW] Снятие токенов по одному `_id` может удалить токен, только что перепривязанный к новой сессии или другому аккаунту
- **file:** apps/api/src/modules/notifications/notifications.repository.ts; apps/api/src/modules/notifications/push-delivery.ts
- **location:** `deleteTokens` (фильтр `{ _id: { $in } }`); вызовы из `liveTokensOf` (мёртвые сессии) и после тикетов `DeviceNotRegistered`
- **problem:** `registerToken` при повторной регистрации того же устройства обновляет существующий документ (тот же
  `_id`, новые `userId`/`sessionId`). Если между `tokensOf` и `deleteTokens` устройство перерегистрировалось (новый вход
  после выхода, смена владельца устройства), доставка удаляет уже живой токен — и, при смене владельца, токен другого
  пользователя (фильтра по `userId` нет).
- **why_it_matters:** окно — миллисекунды, но последствие тихое: устройство без push до следующего запуска приложения
  (регистрация — только при переходе `ready`).
- **evidence:** `this.pushTokens.deleteMany({ _id: { $in: [...tokenIds] } })`; `registerToken` — `updateOne({ token }, { $set: { userId, sessionId, … } }, { upsert: true })`.
- **recommended_fix:** снимать по снимку: `deleteMany({ $or: dead.map(({ _id, sessionId }) => ({ _id, userId, sessionId })) })`
  (для отсутствующего `sessionId` — `{ $exists: false }`), для `DeviceNotRegistered` — хотя бы `{ _id, userId }`.

### [LOW] Ряд часов на время сохранения не приглушён и чипы не помечены недоступными по отдельности
- **file:** apps/app/src/app/settings/notifications.tsx
- **location:** `HourPicker` (`aria-disabled` на обёртке `View`, `styles.disabled = { pointerEvents: 'none' }`)
- **problem:** `Toggle` визуально недоступны, чипы — нет; скринридер на native объявляет каждый `Chip` как активную
  кнопку (атрибут только у контейнера). Функционально нажатие отсекается guard'ом в `onPress`.
- **why_it_matters:** §4.11/§4.12 — состояние мутации должно быть видно; сейчас рассинхрон с тумблерами. Отклонение
  задокументировано (R1-2), `disabled` у `Chip` — follow-up в app-foundation.
- **evidence:** `ChipProps { label; selected?; onPress? }` в `@rkarakulov/ui` — `disabled` нет.
- **recommended_fix:** закрыть follow-up в app-foundation (`Chip disabled` с тестом и примером на `/ui-kit`) и
  подключить здесь; до тех пор — оставить как есть.

### [LOW] `apps/api/.env.example` без `PUSH_ENABLED` / `EXPO_ACCESS_TOKEN` / `EXPO_PUSH_API_URL`
- **file:** apps/api/.env.example
- **location:** —
- **problem:** §10 task.md требует обновить; перенесено в follow-up человеку (агентам чтение `.env*` запрещено).
- **why_it_matters:** локальный запуск не узнаёт о флаге и адресе фейк-сервера Expo.
- **evidence:** `grep PUSH apps/api/.env.example` — пусто; task.md «Follow-ups».
- **recommended_fix:** добавить три переменные с комментариями до merge или вынести в issue.

## Измерения без замечаний

correctness и идемпотентность доставки (захват по `claimId`, `limitCharged`, `expireAt`), регрессии call sites
(`PushTokensService.register` — единственный вызов из контроллера обновлён; `IdentityAccounts` — новый метод без
изменения существующих), безопасность (токен привязан к сессии; проверка сессии с `userId`; чужая сессия не считается
живой — тест), placement (identity → notifications только через экспортируемый `IdentityAccounts`, arch:check чист),
миграции (поле `sessionId` без индекса — миграция не нужна; старые токены без поля считаются мёртвыми — dev-only),
все платформы (`forgetPushToken` есть в `push.web.ts`; `session-store` импортирует развилку без расширения),
i18n, тесты честные (порядок вызовов, конкурентные сценарии с отложенными промисами, негативные int).
