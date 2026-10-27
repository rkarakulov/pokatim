# 1. Title

Удаление аккаунта райдера (экран 14 «Путь райдера»): подтверждение паролем, мгновенный отзыв сессий, фоновая
очистка данных по модулям через порты, письмо, экран в приложении на всех платформах.

# 2. Goal

App Store требует удаление аккаунта из приложения, Google Play — ещё и ссылку на удаление из веба. Сейчас удаления
нет. Поле `users.deletedAt` уже проверяется в `AuthGuard`, refresh, входе, панели и сбросе пароля, но нет самой
операции и очистки данных модулей.

Продуктовые решения A1–A12 — `docs/product/account.md`. **Human gate (вопросы) пройден** автором 2026-10-27: все
рекомендации приняты.

# 3. Scope

**1. Контракт (`packages/contracts`).**
- `POST /v1/account/delete`, тело `{ password }` (строка, лимит длины как у входа). Ответ `204`.
- Новые коды ошибок: член команды панели (A11, `409`); неверный пароль — код, который клиент **не** путает с
  истёкшей сессией (не `401 UNAUTHORIZED` — иначе `withAccessToken` уйдёт в refresh/выход); `429 RATE_LIMITED`.
  Точные имена — architect.
- Причина отзыва сессий `account_deleted` (в конец перечислений), действие журнала панели `account.deleted`
  (в конец `AUDIT_ACTIONS`).

**2. API — синхронная часть (одна транзакция аккаунта).**
- Новый модуль-оркестратор (рабочее имя `account`): контроллер + сервис. Чужие модули — только через их `index.ts`.
- Порядок: `AuthGuard` → лимит по пользователю → проверка роли панели через порт `panel` (A11) → проверка пароля
  через `CredentialsCheck` identity (те же счётчики, что у входа, A2) → транзакция identity под `lockUser`:
  `deletedAt`, отзыв **всех** сессий (`account_deleted`), гашение ссылок verify/reset и токена регистрации, outbox
  `account.deletion-requested { userId }` → `204`. Web: cookie сессии очищается (`SessionCookie.clear`).
- Повтор для уже удалённого: `AuthGuard` вернёт 401 (сессии отозваны) — безопасно.
- Запись в журнал панели `account.deleted` (subject `rider`, без e-mail и имени).

**3. API — фоновая очистка (worker, очередь `account-deletion`).** Одна идемпотентная задача, шаги по порядку,
каждый шаг повторяем (ретрай задачи безопасен), работают только через порты модулей:
1. `profile` — удалить документ `profiles` (идемпотентно; поздний `PATCH` может его воскресить — шаг повторяем,
   см. `pokatim-db.md`). Журнал согласий не трогать (A9).
2. `rides` — отменить будущие `published` райды организатора (`organizer_unavailable`), снять отметки в чужих
   будущих райдах (`$pull` + `$inc`), стереть `organizerName` в прошлых/отменённых райдах организатора (A6).
   Жалобы `ride_reports` не трогать.
3. `routes` — удалить все `origin:'rider'` маршруты пользователя с геометрией, исходниками, экспортами (как
   `deleteOwn`).
4. `tracks` — удалить все загрузки пользователя каскадом с файлами `TrackFileStore` (как удаление загрузки);
   события `tracks.activity-removed` снимают попытки (results уже умеет). Сбросить кэш занятого места. Маркеры
   `track_source_refs` и `activity_meta` — решение architect (§8.1).
5. `devices` — отозвать подключения в Open Wearables (`revokeConnection`, not_found = успех), удалить
   `device_accounts`/`device_connections`/`device_imports`/тикеты. `device_audit` не трогать (A9).
6. `identity` — отправить письмо «Аккаунт удалён» (A10, маркер «отправлено», чтобы ретрай не слал второе),
   затем стереть `email` (заменить на HMAC-хеш для блока повторной регистрации, A4), `birthDate`, `passwordHash`;
   отметка «очистка завершена».
- Регистрация и вход учитывают хеш удалённого адреса: регистрация — тот же нейтральный отказ D-07; вход и сброс
  пароля по такому адресу ведут себя как для неизвестного адреса.

**4. Приложение (`apps/app`, iOS/Android/web).**
- Экран «Профиль»: внизу ссылка «Удалить аккаунт».
- Экран `settings/account/delete` (за входом; гость → вход → возврат): заголовок, список последствий (A3–A8,
  A4 — «этот e-mail нельзя будет использовать снова»), поле пароля, кнопка «Удалить навсегда» (опасная). Ошибки:
  неверный пароль — под полем; член команды — баннер с текстом A11; 429 — баннер с повтором позже; сеть — баннер.
- Успех → локальный выход **без** «возврата на вход» (`returning:false`) → гостевой экран с сообщением
  «Аккаунт удалён».
- i18n (`packages/i18n`), a11y: роли, подписи, фокус на ошибке, объявление результата скринридеру.

**5. Docs.** `docs/product/account.md` (уже), `docs/product/profile.md` (P4 → ссылка на account.md),
`.claude/rules/pokatim-{db,security,backend}.md` (как устроено удаление), runbook `docs/runbooks/account-deletion.md`
(ручной шаг OW, повторный запуск очистки), ADR — если architect решит, что оркестратор удаления — новое решение.

# 4. Out of Scope

- Отсрочка удаления и отмена при входе (A1).
- Удаление аккаунта сотрудником панели или по запросу в поддержку; экспорт данных («скачать мои данные»).
- Удаление пользователя в Open Wearables через API (A8 — ручной шаг).
- Подпись «Удалённый участник» в таблицах результатов (A3).
- Уведомления участникам отменённых райдов (push нет; in-app лента уже показывает «Отменён»).
- Смена или удаление записей append-only журналов (A9).
- Удаление аккаунта сотрудника панели (A11 — запрет).

# 5. Architecture Context

Architecture Review — account-deletion. **Status: CONCERNS** (блокеров нет; открытые вопросы человеку — §8.1 F1, F7, F8;
остальное решено здесь).

**Новый модуль-оркестратор `apps/api/src/modules/account`** — без своих коллекций и репозитория: только контроллер,
сервисы, событие, процессор очереди и регламент. Чужие данные — **только через порты модулей-владельцев**
(`modules/<m>/index.ts`), каждый порт пишет только коллекции своего модуля (единственный писатель — его репозиторий).

Граф зависимостей (без циклов, `forwardRef` не нужен): `account → identity, panel, profile, rides, routes, tracks,
devices`; **никто не импортирует `account`**. `identity` по-прежнему не импортирует модули; `panel → identity`,
`profile → identity, panel`, `rides/routes → identity, panel`, `devices → identity, tracks`, `tracks → identity` —
без изменений.

**Синхронная часть (API, `AccountModule` в `app.module.ts`).** `POST /v1/account/delete` (`AuthGuard`, `no-store`) →
`AccountDeletionService.delete(userId, body, ip)`:
1. лимит `account-delete:<uid>` 5/ч (`RateLimiter`, ключ — uid, не e-mail) → `429 RATE_LIMITED { retryAfterSec }`;
2. `PanelMembership.hasActiveRole(userId)` → `409 ACCOUNT_PANEL_MEMBER` (A11) — до пароля: заведомый отказ не
   расходует счётчики входа;
3. `AccountClosure.verifyPassword(userId, password, ip)` — та же `CredentialsCheck` (счётчики `signin-*` по e-mail
   аккаунта и IP, argon2) → неверный — `403 PASSWORD_INCORRECT`; 429 — как у входа; возвращает проверенный хеш;
4. `MongoTransactions.run(tx => …)`, колбэк без логов и Redis: `AccountClosure.close(tx, userId, checkedHash, now)`
   (**первой** операцией `lockUserCredentials`; `deletedAt`, `revokeAllSessions('account_deleted')`, гашение активных
   ссылок verify/reset, `revokeRegistrationToken`) → только при `'closed'`: `PanelAudit.append(tx, account.deleted)` и
   `MongoOutboxWriter.append(tx, account.deletion-requested { userId })`;
5. после `run`: лог `account.deleted user=<uid> sessions=<n>`, `SessionCookie.clear(reply)` → `204`.

Итог `close`: `'closed'` — удалён сейчас; `'already'` — уже удалён параллельным запросом (двойное нажатие) → `204` без
второго события и записи журнала (N6); `'changed'` — хеш пароля сменился после проверки (сброс пароля между проверкой
и транзакцией; он же отозвал все сессии) → `401 UNAUTHORIZED`.

**Фоновая часть (worker, `AccountWorkerModule` в `worker.module.ts`).** Очередь `account-deletion`, **один** процессор
`AccountErasureProcessor` разбирает задачи по имени (как `identity-email`): `account.deletion-requested` (из outbox,
jobId = id события) и `account.deletion-sweep` (повторный проход, ставится напрямую, `deduplication.id =
account-sweep:<userId>` — свой jobId с `:` BullMQ не принимает). Обе вызывают `AccountErasureService.run(userId,
{ pass, final })`:

| # | Шаг | Порт | Идемпотентность |
|---|---|---|---|
| 0 | Охрана: аккаунт удалён (`deletedAt ≠ null`), иначе `skipped` + warn (никогда не чистить живой) | `AccountErasure.deletionState` | чтение |
| — | (только `pass: 'first'`) поставить sweep с задержкой `ACCOUNT_POLICY.sweepDelayMs` (15 мин) | очередь `account-deletion` | дедупликация по `account-sweep:<userId>` |
| 1 | профиль: `deleteOne` `profiles` | `ProfileErasure.erase` | нет документа — no-op |
| 2 | райды: отмена будущих своих, «Не иду» в чужих, стирание подписи | `RideErasure.erase` | фильтры по состоянию |
| 3 | «Мои маршруты» (`origin:'rider'`) каскадом | `RouteErasure.erase` | `deleteOwn` по каждому id |
| 4 | **устройства** (раньше треков — §8.1 F4): отзыв в OW, удаление `device_*` (кроме `device_audit`) | `DeviceErasure.erase` | нет подключений — только `deleteMany` |
| 5 | треки: все загрузки каскадом + файлы, затем `track_source_refs` и `activity_meta` пользователя | `TrackErasure.erase` | по каждой загрузке — существующий `remove` |
| 6 | identity: письмо «Аккаунт удалён» (захват → отправка → отметка), затем стирание ПДн и `erasedAt`; на sweep — ещё `erasureSweptAt` | `AccountErasure.notifyAndErase` / `markSwept` | условия в фильтрах, маркеры |

Ретрай задачи (BullMQ по умолчанию 5 попыток, экспонента от 5 с) повторяет все шаги с начала — каждый шаг безопасен
при повторе. Регламент `AccountSchedules` (`account.erasure-resume`, раз в час) ставит sweep аккаунтам, удалённым
раньше `now − 1 ч` без `erasureSweptAt` (финальный провал обоих проходов не застревает навсегда; R5 и окно OW).

# 5.1 Placement & Reuse Gate

**Placement.** Приложение `apps/api` → новый модуль `modules/account` (оркестратор ≠ данные identity: в identity он
потянул бы зависимости на все модули и цикл). Новых пакетов нет (потребитель один). В app-foundation — ничего
обязательного; follow-up там: вариант `Button` «опасная» и ref/фокус у `TextField` (§8.1 F7). Код, общий с другими
проектами, не появляется.

**Reuse (обязательно, дубли запрещены):**

| Нужно | Переиспользовать | Запрещено |
|---|---|---|
| проверка пароля, счётчики A2 | `CredentialsCheck` (вынести `verify(...)` → `CheckedCredentials \| undefined`; `check` = `verify` ?? 401) | второй argon2/лимитер входа в `account` |
| сериализация аккаунта | `lockUserCredentials` (как вход, R4 слайса 3) | запись `users` без замка |
| отзыв сессий, ссылки, токен регистрации | `revokeAllSessions`, `supersedeActiveVerificationTokens`, `supersedeActivePasswordResetTokens`, `revokeRegistrationToken` | свои `updateMany` по `sessions` вне identity |
| cookie web | `SessionCookie.clear` / `noStore` (экспорт из identity) | ручной `Set-Cookie` |
| аудит | `PanelAudit.append(tx, …)`, подпись субъекта — `riderSubjectLabel` profile | своя коллекция журнала |
| маршруты | `RoutesRepository.deleteOwn` в `MongoTransactions.run` (как `MyRoutesService.delete`) | `deleteMany` по `routes` без каскада |
| треки | приватный `TrackUploadsService.remove` (замок активностей, перевыбор основной, outbox `activity-removed`/`upload-deleted`, файл, `invalidateUsage`) — сделать общим для `delete`/`deleteSource`/стирания | свой каскад активностей/линий |
| устройства | логика `DevicesSyncService.revokeLocked` (замок pull, `revokeConnection` с `not_found` = успех, `revokeFailed` + журнал на финальной попытке) — вынести общую функцию/сервис | второй клиент OW |
| райды | семантика `RidesRepository.cancel`/`leave` (условия в фильтре, `$pull` + `$inc`) — пакетные версии `updateMany` с теми же условиями | чтение и запись отдельными операциями |
| письмо | `MAILER`, шаблон рядом с `mail/password-changed-email.ts`, захват отправки по образцу `claimLinkSend` | отправка без маркера |
| лимит | `RateLimiter` базы | — |
| очереди | `QUEUE`, outbox базы, `deduplication` как `DevicesPullQueue` | jobId с `:` |
| app | `useSignOut`, `withAccessToken`, `return-path(.web).ts`, `useSettingsShell`/`ShellSkeleton`, `Banner`/`Button`/`TextField`/`TextAction` `@rkarakulov/ui`, `fieldErrorMessage`/`retryAfterSec`/`apiErrorCode` | свой fetch, свой стор сессии, цвета/отступы литералами |

# 6. Relevant Files

API (читать): `apps/api/src/modules/identity/{identity.repository,identity.collection,credentials-check,
registration.service,password-reset.service,sign-in.service,session.controller,session-cookie,identity.module,
identity-accounts,index}.ts`, `identity/jobs/{identity-email.processor,link-email.handler,
password-changed-email.handler}.ts`, `identity/mail/password-changed-email.ts`; `panel/{panel-audit,panel.repository,
panel-core.module,index}.ts`, `profile/{profile.repository,profile.module,profile-moderation.service,index}.ts`;
`rides/{rides.repository,rides.collection,rides.module,index}.ts`; `routes/{routes.repository,my-routes.service,
routes.module,index}.ts`; `tracks/{track-uploads.service,tracks.repository,tracks.module,index}.ts`;
`devices/{devices-sync.service,devices.service,devices.repository,devices.module,devices-jobs,devices.events,
wearables-aggregator}.ts`; `src/{queues,worker.module,app.module,error-messages}.ts`, `db/migrations/{0011_devices,
0012_track_source_refs,index}.ts`; тесты-образцы `test/{harness,identity,devices,fake-ow,tracks,rides,routes,
results}.ts`, `identity-races.int.test.ts`, `profile-cleanup.int.test.ts`, сторожа `profile.repository.test.ts`,
`device-audit.test.ts`, `panel.repository.test.ts`.

Контракты/клиент: `packages/contracts/src/{common,index}.ts`, `auth/sign-in.schema.ts` (`SignInPassword`),
`admin/audit.schema.ts`; `packages/api-client/src/index.ts`.

App: `apps/app/src/app/{_layout,settings/profile,(onboarding)/register,devices/return}.tsx`,
`features/auth/{use-sign-out,session-store,authorized,return-path,return-path.web,return-path-allowlist,
error-messages}.ts`, `features/profile/queries.ts`, `features/profile/profile-form.tsx`, `features/devices/settings-shell.tsx`;
`packages/i18n/src/ru.ts`; admin — `apps/admin/src/features/audit/AuditScreen.tsx`.

# 7. Implementation Notes

**7.1 Контракты (`packages/contracts`).** Новый `src/account/account-deletion.schema.ts`: `DeleteAccountRequest =
z.strictObject({ password: SignInPassword })` (тот же лимит длины, что у входа), экспорт в `index.ts`. В конец
`defineErrorCodes`: `PASSWORD_INCORRECT` (403), `ACCOUNT_PANEL_MEMBER` (409). В конец `AUDIT_ACTIONS`:
`'account.deleted'`. `SESSION_REVOKED_REASONS` (API, `identity.collection.ts`) — `'account_deleted'` в конец. Тексты
кодов — `apps/api/src/error-messages.ts`. api-client: `deleteAccount(accessToken, body)` → `POST /v1/account/delete`,
`z.undefined()` (204), `authorized(…, withCredentials)` как `updateProfile`. Admin i18n:
`admin.audit.action.account.deleted` («Райдер удалил аккаунт») — иначе `AuditScreen` не соберётся.

**7.2 identity.**
- `UserDoc`: `passwordHash: string | null`, `birthDate: string | null`; новые необязательные поля (чтение `?? null`,
  без миграции и бэкфилла): `deletionEmailClaimedAt`, `deletionEmailSentAt`, `erasedAt`, `erasureSweptAt` (`Date |
  null`). Методы чтения учётных данных (`findCredentialsByEmail/ById`, `lockUserCredentials`) для `passwordHash ===
  null` возвращают «нет учётных данных» → вход и порт панели ведут себя как для неизвестного аккаунта.
- **Стёртый e-mail** (A4, решение §8.1 F3): поле `email` получает маркер `erased:<HMAC-SHA256(EMAIL_TOKEN_SECRET,
  'deleted-email:' + normalizedEmail), base64url>` — одной атомарной записью вместе с `birthDate: null`,
  `passwordHash: null`, `erasedAt`. Маркер без `@` — `normalizeEmail` валидного адреса его не даёт, вход и сброс по
  адресу его не находят (= неизвестный адрес, AC6). Полный `users_email_unique` сохраняет D-07: адреса уникальны,
  маркеры тоже. Функция маркера — `tokens.ts` (`erasedEmailMarker(secret, email)`), рядом с прочими HMAC.
- Регистрация: `findUserByEmail` → `findUserForRegistration(email, marker, tx)` с `email: { $in: [email, marker] }`;
  найден удалённый — прежний `409 EMAIL_UNAVAILABLE`. Гонки нет: до стирания виден открытый адрес удалённого, после —
  маркер; запись одна атомарная. Вход, сброс пароля, verify — без изменений (они уже отказывают удалённому).
- `CredentialsCheck`: выделить `verify(input, ip): Promise<CheckedCredentials | undefined>` (лимиты → поиск → argon2 по
  хешу или пустышке); `check` = `verify ?? throw invalidCredentials()`.
- Порт **`AccountClosure`** (HTTP, провайдер `IdentityModule`, экспорт в `index.ts` и `exports` модуля):
  - `verifyPassword(userId, password, ip): Promise<string>` — `findCredentialsById`; нет/удалён/стёрт — `401
    UNAUTHORIZED`; `CredentialsCheck.verify({ email, password }, ip)`; `undefined` — `403 PASSWORD_INCORRECT`;
    возвращает проверенный `passwordHash` (наружу из сервиса account не уходит, в логи — нет).
  - `close(tx, userId, checkedHash, now): Promise<{ outcome: 'closed' | 'already' | 'changed'; revoked: number }>` —
    первой `lockUserCredentials`; затем `users.updateOne({ _id, deletedAt: null }, { $set: { deletedAt: now } })`,
    `revokeAllSessions(tx, userId, now, 'account_deleted')`, `supersedeActive{Verification,PasswordReset}Tokens`,
    `revokeRegistrationToken`. Новых записей в `user_consents` нет, удалений — нет (A9).
- Экспорт `SessionCookie` из `IdentityModule` (`exports`) и `index.ts`.
- Порт **`AccountErasure`** (worker; новый `IdentityErasureModule` = `IdentityAccountsModule` + `AccountErasure`; MAILER —
  из `MailModule` worker; экспорт в `index.ts`):
  - `deletionState(userId)` → `{ deletedAt, erasedAt, erasureSweptAt } | undefined`;
  - `notifyAndErase(userId, now, { abandonEmailAfterMs }): 'erased' | 'already' | 'not_deleted'` — если `erasedAt` —
    `'already'`; если письмо не отправлено: захват `findOneAndUpdate({ _id, deletedAt: {$ne:null}, erasedAt: null,
    deletionEmailSentAt: null, $or: [claim null, claim < now − ACCOUNT_DELETION_EMAIL_CLAIM_MS] }, { $set: claim })` →
    `MAILER.send` (шаблон `mail/account-deleted-email.ts`: дата удаления — Минск, без имени и ссылок с токенами) →
    `deletionEmailSentAt`; сбой отправки — снять захват и бросить (ретрай); захват чужой и свежий — бросить
    (ретрай позже). Затем стирание: `updateOne({ _id, deletedAt: {$ne:null}, erasedAt: null, $or: [{
    deletionEmailSentAt: {$ne:null} }, { deletedAt: { $lt: now − abandonEmailAfterMs } }] }, { $set: { email: marker,
    birthDate: null, passwordHash: null, erasedAt: now } })` (маркер — от текущего открытого адреса документа). Письмо
    не ушло за `abandonEmailAfterMs` (24 ч, §8.1 F8) — стирание без письма, лог `account.deletion_email_abandoned`.
    At-least-once: падение между отправкой и отметкой даёт второе письмо после истечения захвата (принятый риск, как
    у ссылок R6).
  - `markSwept(userId, now)`; `pendingSweeps(deletedBefore, limit): string[]` (индекс §7.5).
- `findEmailsByIds`, `IdentityAccounts.findVerifiedByEmail` уже исключают удалённых — проверить, что маркер нигде не
  выходит наружу (панель «Сотрудники» показывает `DELETED_MEMBER`).

**7.3 Порты модулей (каждый — в своём модуле, экспорт через `index.ts`, пишет только свои коллекции).**
- `panel`: **`PanelMembership.hasActiveRole(userId): Promise<boolean>`** (`PanelCoreModule`; `findActiveMember`).
  Гонка «проверка роли ↔ выдача роли» принята (запись в разные документы; гард панели удалённому всё равно
  отказывает, `PanelDirectory` покажет «Удалённый участник») — комментарий в сервисе account, риск R7 ниже.
- `profile`: **`ProfileErasure.erase(userId): Promise<boolean>`** (`ProfileCoreModule`; `ProfileRepository.deleteProfile`
  — `profiles.deleteOne({ _id })`). `profile_consent_events` не трогается (сторож `profile.repository.test.ts` должен
  остаться зелёным — метод работает только с `this.profiles`). `riderSubjectLabel` — экспорт из `profile/index.ts`.
- `rides`: новый **`RidesCoreModule`** (`RidesRepository`, `RideErasure`);
  `RidesModule` импортирует его. **`RideErasure.erase(userId, now)`** — четыре `updateMany` в `RidesRepository`
  (каждый документ атомарен, условия в фильтре — повтор безопасен):
  1. отмена: `{ organizerUserId, status: 'published', startsAt: { $gt: now } }` → `status: 'cancelled', cancelReason:
     'organizer_unavailable', cancelledAt, updatedAt, $inc version`;
  2. скрытые модерацией будущие свои с `hiddenFromStatus: 'published'` → `hiddenFromStatus: 'cancelled'` + те же
     поля отмены (статус остаётся `hidden`; «Вернуть» покажет «Отменён», а не живой райд удалённого — §8.1 F6);
  3. «Не иду»: `{ 'participants.userId': userId, organizerUserId: { $ne: userId }, status: { $in: ['published',
     'hidden'] }, startsAt: { $gt: now } }` → `$pull` + `$inc goingCount −1` + `updatedAt` (участие — без `version`);
  4. подпись: `{ organizerUserId, organizerName: { $ne: null } }` → `organizerName: null` (все статусы — A6 и будущие
     только что отменённые). `ride_reports` — не трогаются (A6).
- `routes`: **`RouteErasure.erase(userId): Promise<number>`** (`RoutesCoreModule`): `RoutesRepository.ownIds(userId)`
  (`{ ownerUserId, origin: 'rider' }`, проекция `_id`, индекс `routes_owner_origin_idx`) → `deleteOwn` по каждому в
  своей `MongoTransactions.run`. Маршруты платформы не видит по фильтру `origin`.
- `tracks`: **`TrackErasure.erase(userId): Promise<number>`** (`TracksCoreModule`): `listUploadIds(userId)` (все
  источники и статусы, `track_uploads_user_created_idx`) → общий `remove(userId, id)` (сейчас приватный в
  `TrackUploadsService`) → затем `TracksRepository.deleteUserMarkers(userId)`: `track_source_refs.deleteMany({ userId })`
  и `activity_meta.deleteOne({ _id: userId })` (§8.1 F5). Попытки снимает существующая подписка `results` на
  `tracks.activity-removed` (AC4).
- `devices`: новый **`DevicesCoreModule`** (`DevicesRepository`, `DeviceAudit`, `DevicesLocks`, агрегатор,
  `DeviceErasure`) — без очереди pull. **`DeviceErasure.erase(userId, { final })`**: для каждого подключения в живом
  статусе — замок `devices:pull:<id>` (ожидание как у `revoke`; занят — `RevokeBusyError`, ретрай) → транзакция
  `requestDisconnect` (из `pending|active`) + `device_audit` `disconnected` / `account_deleted` → `revokeConnection`
  (`not_found` — успех; повторяемая ошибка и не финал — бросить; иначе `revokeFailed` + журнал `revoke_failed`) →
  `markRevoked` (причина `account_deleted` в конец union `revokedReason`). Затем `deleteMany({ userId })`
  `device_link_tickets`, `device_imports`, `device_connections`, `deleteOne({ _id: userId })` `device_accounts`.
  `device_audit` не трогается (сторож `device-audit.test.ts`: миграция 0023 ссылается на `DEVICES_COLLECTIONS.<имя>`,
  не на `audit` и не на `devicesCollections(`). Позднее `tracks.upload-deleted` → `tombstone` (без upsert) — no-op.

**7.4 Модуль `account`.** Файлы: `account.controller.ts` (`@Controller('account')`, `@Post('delete')`, `@HttpCode(204)`,
`@UseGuards(AuthGuard)`, `@CurrentUser()`, `@Ip()`, `@Res({ passthrough: true })`, pipe `ZodValidationPipe(
DeleteAccountRequest, FieldErrorCode)`), `account-deletion.service.ts`, `account.events.ts`
(`ACCOUNT_DELETION_REQUESTED = 'account.deletion-requested'`, `AccountDeletionRequested = z.object({ userId: z.uuid()
})`, `ACCOUNT_DELETION_SWEEP_JOB`, `accountOutboxRoutes = { [ACCOUNT_DELETION_REQUESTED]: QUEUE.accountDeletion }`),
`account.policy.ts` (`deleteLimit` 5/ч, `sweepDelayMs` 15 мин, `resumeAfterMs` 1 ч, `resumeBatch` 50,
`abandonEmailAfterMs` 24 ч, `emailClaimMs` 5 мин), `account-erasure.service.ts`, `account-erasure.processor.ts`,
`account-schedules.ts` (repeatable `account.erasure-resume` по образцу `IdentitySchedules`/`RoutesSchedules`),
`account.module.ts` (`AccountModule` — imports `IdentityModule`, `PanelCoreModule`; `AccountWorkerModule` — imports
`IdentityErasureModule`, `ProfileCoreModule`, `RidesCoreModule`, `RoutesCoreModule`, `TracksCoreModule`,
`DevicesCoreModule`, `BullModule.registerQueue({ name: QUEUE.accountDeletion })`), `index.ts` (`AccountModule`,
`AccountWorkerModule`, `accountOutboxRoutes`). `QUEUE.accountDeletion = 'account-deletion'` с комментарием.
`worker.module.ts`: `...accountOutboxRoutes`, `AccountWorkerModule`. `app.module.ts`: `AccountModule`.
Логи — только `uid`, шаг, исход, счётчики; без e-mail, имён, названий.

Шаг 2 стирания идёт до 3–5 — публичная подпись в райдах пропадает первой (R4). Каждый шаг пишет лог
`account.erasure user=<uid> step=<s> …`; ошибка шага — бросок (ретрай всей задачи); на финальной попытке —
`logger.error('account.erasure_failed user=<uid> step=<s>')` перед броском (видимо в логах и в failed-наборе BullMQ;
регламент resume перезапустит через час).

**7.5 Миграция `0023_account_deletion`** (expand-only, без транзакции, идемпотентна): `device_connections_user_idx
{ userId: 1 }`, `device_imports_user_idx { userId: 1 }`, `device_link_tickets_user_idx { userId: 1 }` (сейчас
`deleteMany({ userId })` по ним — COLLSCAN; у `device_connections` частичный уникальный индекс покрывает только живые),
`users_erasure_pending_idx { deletedAt: 1 }` с `partialFilterExpression: { deletedAt: { $type: 'date' },
erasureSweptAt: { $eq: null } }` (регламент resume; `$eq: null` совпадает и с отсутствием поля). Деструктивного нет;
индекс `users_email_unique` не меняется. Проверка — `migrations.int.test.ts` (повторный прогон, наличие индексов).

**7.6 App (`apps/app`).**
- Маршрут `src/app/settings/account/delete.tsx` — **вне** `Stack.Protected` (как `devices/return`; регистрация
  `<Stack.Screen name="settings/account/delete" />` рядом с публичными) — экран сам решает: сессия `unknown`/
  `unavailable` → `ShellSkeleton` (SSR отдаёт оболочку, данных нет); `signedOut` и нет отметки «аккаунт удалён» →
  `rememberReturnPath('/settings/account/delete')` в эффекте + `<Redirect href="/sign-in" />`; `signedOut` с отметкой →
  `<Redirect href="/register" />`; `signedIn` (онбординг не обязателен) → контент. Allowlist возврата
  (`return-path-allowlist.ts`): добавить **точный** путь `/settings/account/delete` (без параметров) рядом с regex
  карточек + тест. Возврат — существующий механизм корневого layout (после входа и онбординга).
- Контент `features/account/delete-account-form.tsx`: заголовок (`accessibilityRole="header"`), список последствий
  A3–A8 (статичный, `Text` + `textStyle`, отступы — токены), `TextField` пароля (`secureTextEntry`,
  `autoComplete="current-password"`), `Button` «Удалить навсегда» (`loading` на время запроса, disabled без пароля),
  «Назад» — `TextAction`. Форма — `react-hook-form` + `zodResolver(DeleteAccountRequest)`. Ошибки:
  `PASSWORD_INCORRECT` → под полем «Неверный пароль»; `ACCOUNT_PANEL_MEMBER` → `Banner tone="error"` с текстом A11;
  `RATE_LIMITED` → баннер с паузой (`retryAfterSec`, как «Вход»); сеть/прочее → `actionErrorMessage`. Блок ошибок и
  поля — `accessibilityLiveRegion="assertive"` (RN-web → `aria-live`); фокус в поле — после follow-up `TextField` с
  ref (§8.1 F7).
- Мутация `features/account/queries.ts`: `useDeleteAccount` → `withAccessToken(t => api.deleteAccount(t, body))`,
  `networkMode: 'always'`; успех → `signOut({ returning: false, notice: 'accountDeleted' })` → `router.replace(
  '/register')`. 401 после refresh (сессию отозвал другой клиент) — обычный локальный выход `withAccessToken`.
- `session-store.ts`: `signOut(options?: { returning?: boolean; notice?: 'accountDeleted' })` (умолчание — как сейчас,
  `returning: true`), поле `notice: 'accountDeleted' | null` (только память; сбрасывают `signIn` и сам экран
  регистрации после показа при уходе). `use-sign-out.ts` пробрасывает опции. `resetSessionStore` — с `notice: null`.
- `(onboarding)/register.tsx`: `notice === 'accountDeleted'` → `Banner tone="info"` «Аккаунт удалён» над формой с
  `accessibilityLiveRegion="polite"` (объявление результата).
- «Профиль» (`settings/profile.tsx`): внизу `TextAction` «Удалить аккаунт» → `router.push('/settings/account/delete')`.
- i18n `packages/i18n/src/ru.ts`: `account.delete.{title,lead,consequence.*,password,submit,back,errors.*}`,
  `profile.deleteAccount`, `auth.register.accountDeleted`; формальное «вы», тексты A3–A8/A11 из `account.md`.
- Web: экран не публичный — без `generateMetadata`/`loader`; `DocumentTitle`. Смоук `e2e/web.spec.ts`: гость на
  `/settings/account/delete` → «Вход» (адрес для Google Play).

**7.7 Порядок работы coder (коммиты).** (1) контракты, api-client, тексты ошибок, i18n (вкл. admin); (2) identity:
типы, причина отзыва, `CredentialsCheck.verify`, маркер, регистрация, `AccountClosure`, `AccountErasure`, шаблон
письма, `IdentityErasureModule` + int; (3) порты panel/profile/rides/routes/tracks/devices + int; (4) миграция 0023;
(5) модуль `account` HTTP + worker + регламент, регистрация в `app.module`/`worker.module` + int; (6) app + тесты +
смоук; (7) документы, ADR-0015, runbook. После каждого — тесты зоны; в конце `TURBO_CONCURRENCY=1 pnpm check` на своих
Mongo DB / Redis db.

# 8. Risks / Assumptions / Open Questions

- **R1 — юрист (D10, A9).** Хранение журналов согласий после удаления — проверить до прода.
- **R2 — ручной шаг OW (A8).** Пустой пользователь `pokatim:<id>` в агрегаторе до ручного удаления.
- **R3 — спор без трека (A5 × A7).** Модератор решает по попытке и протоколу.
- **R4 — окно фоновой очистки.** Публичное имя и подпись в райдах видны до завершения шагов 1–2 (минуты).
- **R5 — поздние записи.** Запрос, прошедший `AuthGuard` до отзыва сессий, может создать данные после очистки
  (профиль, загрузка, маршрут). Мера — порядок «сначала транзакция identity, потом очистка», повторяемые шаги;
  architect оценит, нужен ли повторный проход очистки с задержкой.
- [ASSUMPTION] Прототип экрана 14 локально недоступен (в `pokatim-private/proto/` его нет). Экран собирается из
  дизайн-системы по образцу «Профиля»; тексты — из этого task.md.
- [ASSUMPTION] Лимит удаления — 5 попыток в час на пользователя поверх счётчиков входа.
- [ASSUMPTION] Последствия на экране — статичный список, без подсчёта («у вас 3 маршрута»).
- [ASSUMPTION] Гостевой экран после удаления — экран регистрации/приветствия, сообщение — баннер.

# 8.1 Requirements Consistency (заполняет architect)

Решения A1–A12 не переоткрываются. Находки — с решением architect; **вопросы человеку — F7 и F8** (не блокируют
старт coder: работа идёт по рекомендации, человек может поправить до merge).

- **F1 — код неверного пароля.** `401` нельзя: `withAccessToken` (`features/auth/authorized.ts`) на любой 401 делает
  refresh и повтор, затем локальный выход. Варианты: (а) **`403 PASSWORD_INCORRECT`** — отдельный код в конце
  `ErrorCode`; (б) `400 VALIDATION_FAILED { fields: [{ path: 'password', code: 'PASSWORD_INCORRECT' }] }` — смешивает
  проверку формы и проверку секрета, код поля пришлось бы исключать из `FIELD_MESSAGES` регистрации; (в) `422` с
  общим кодом. **Решение: (а).** Одинаковое тело на любой неверный пароль, без «осталось N попыток»; 429 — общий с
  входом (счётчики `signin-*`, A2). Член панели — `409 ACCOUNT_PANEL_MEMBER`.
- **F2 — оркестратор vs fan-out событий.** Fan-out (`account.deletion-requested` в каждую очередь модуля) невозможен
  без смены базы: публикатор outbox отправляет **один тип — в одну очередь**; пришлось бы плодить N типов и терять
  порядок шагов («письмо и стирание e-mail — последними», «подпись в райдах — первой», «устройства до треков»).
  **Решение: один обработчик `account-deletion` в модуле `account`, шаги по порядку через порты** (§5). Цена —
  `account` зависит от всех модулей с данными пользователя; правило для будущих модулей (новый модуль с данными
  пользователя обязан дать порт стирания и шаг) — в ADR-0015 и `pokatim-backend.md`.
- **F3 — хеш e-mail и `users_email_unique`.** Варианты: (а) **маркер в самом поле `email`** (`erased:<HMAC>`) —
  полный уникальный индекс остаётся как есть, D-07 держится той же проверкой регистрации, замена — одна атомарная
  запись, без миграции; (б) отдельное поле `emailHash` + частичный уникальный индекс — тогда `email` всё равно надо
  чем-то заменить (полный уникальный индекс не допустит два `null`) — это сужение индекса, expand/contract с
  человеком; (в) отдельная коллекция заблокированных хешей — второй источник правды и write skew с регистрацией.
  **Решение: (а).** Ключ — существующий `EMAIL_TOKEN_SECRET` (тот же HMAC-ключ identity, что у ключей лимитов и штампа
  учётных данных); новой переменной нет. Следствие: **ротация `EMAIL_TOKEN_SECRET` снимает блок D-07 со стёртых
  адресов** (и гасит ссылки из писем) — записать в runbook. Порядок «письмо → стереть»: захват/отметка отправки
  (`deletionEmailClaimedAt/SentAt`) как у ссылок; стирание — только после отметки (или по F8).
- **F4 — порядок шагов «устройства → треки» (отклонение от §3 п. 3, шаги 4↔5).** Пока подключение `active`, pull
  агрегатора может принять новый заезд между стиранием треков и устройств (барьер `ingestSeq` пускает импорт только
  `active`). Сначала перевод в `disconnecting`/`revoked` и удаление `device_*`, затем треки — новых приёмов нет. Позднее
  событие `tracks.upload-deleted` → `tombstone` без upsert — no-op. Отмечено в §8.2.
- **F5 — `track_source_refs` и `activity_meta`.** Маркеры (`<source>:<sourceRef>`, `userId`, `deleted`) нужны, только
  пока возможен повторный импорт; после шага устройств подключений нет, приём провайдера для пользователя
  невозможен. `activity_meta` — пустой документ-замок (`_id = userId`, `version`). **Решение: удалить оба в конце шага
  треков** (индекс `track_source_refs_user_idx` уже есть). Повторный `lockUserActivities` создаёт замок заново — без
  вреда.
- **F6 — `hidden`-райды организатора.** Будущий скрытый модерацией райд (`hiddenFromStatus: 'published'`) после
  «Вернуть» стал бы живым райдом удалённого организатора. **Решение:** перевести `hiddenFromStatus` в `cancelled` с
  причиной `organizer_unavailable` (статус `hidden` не меняется, журнал модерации и жалобы не трогаются). Отметки
  удалённого в чужих скрытых будущих — снимаются (как в опубликованных). `ride_reports` — не трогаются (A6).
- **F7 — дизайн-система (вопрос человеку, §4.11).** В `@rkarakulov/ui` нет «опасной» кнопки (`Button` — `primary |
  secondary`) и нет ref/фокуса у `TextField` (a11y «фокус на ошибке»). Варианты: (а) **сейчас `Button
  variant="primary"` с текстом «Удалить навсегда» + `accessibilityLiveRegion` для ошибок; follow-up задача в
  app-foundation (`Button variant="danger"` на роли `status.error`, `TextField` с `ref`/`focus`) и замена после
  релиза**; (б) сначала релиз app-foundation, экран — после (задача ждёт базу); (в) продуктовый компонент в
  `apps/app/src/components` из токенов — дублирует будущий общий компонент (запрещено, если он общий). Рекомендация —
  (а): прецедент фолбэков до релиза базы (`TimeField`), опасность передают текст, список последствий и пароль.
- **F8 — письмо не уходит (вопрос человеку, [ASSUMPTION]).** A10: письмо — до стирания e-mail. При постоянном сбое
  почты открытый адрес хранился бы бесконечно (вредно для A4/минимизации ПДн). Рекомендация: стирать **без письма**,
  если оно не ушло за 24 ч после удаления (лог `account.deletion_email_abandoned`, повторы — регламентом). Варианты:
  (б) ждать письма бесконечно (ручной разбор по runbook); (в) не ждать письма вовсе (противоречит A10).
- **F9 — R5 (поздние записи).** Реальный сценарий: загрузка заезда/маршрута, начатая до удаления, читает тело до 180 с
  (`readLimited`) и коммитит после шагов очистки; `PATCH /v1/profile`, «Я иду», `complete` устройства — то же окно.
  **Решение: нужен повторный проход** — sweep через 15 мин (ставится первым проходом, дедуп по пользователю) +
  регламент resume раз в час для удалённых без `erasureSweptAt` (он же — вторая попытка после финального провала).
  Шаги идемпотентны, повторный проход — та же функция.
- **F10 — конфликт с правилами проекта (уровень 3) — снимается решениями человека A2/A3/A6/A12, правила обновить
  (§10):** `pokatim-app.md` «Удаление аккаунта: нативный alert» и «Публичное удаление аккаунта: только e-mail,
  подтверждение по ссылке» — заменены экраном за входом с паролем (A2, A12; `Alert` на web не работает, §4.13);
  `pokatim-db.md`/`pokatim-backend.md` «анонимизация — „Удалённый участник“» — по A3 строка «Участник»; `pokatim-db.md`
  «жалобы — обезличить или удалить отдельным решением» — решено A6 (хранить); `pokatim-db.md` «Удаление аккаунта обязано
  снять роль в панели» — по A11 у удаляемого роли нет, снимать нечего.
- **F11 — `device_*` «удалить» vs `device_audit` append-only.** Противоречия нет: удаляются `device_accounts`,
  `device_connections`, `device_imports`, `device_link_tickets`; журнал остаётся (A9) и получает новые записи
  (`disconnected`/`revoke_failed`, причина `account_deleted`) — только `insertOne`.
- **F12 — гонка «проверка роли панели ↔ выдача роли» (R7, принятая).** Разные документы, общего замка нет. Итог гонки —
  активная роль у удалённого: `PanelGuard` его не пускает (аккаунт неактивен), «Сотрудники» показывают «Удалённый
  участник», админ снимает роль. Замок через `users` из `panel` запрещён (документы identity в транзакциях панели не
  пишутся) — не вводим.
- **F13 — видимость финального провала.** `pokatim-backend.md` требует «видимое действие в панели»; экрана задач в
  панели нет. Для MVP — лог `account.erasure_failed` с шагом, failed-набор BullMQ (`removeOnFail: false`), регламент
  resume и запрос «зависших» в runbook; экран в панели — follow-up (вне scope).
- **F14 — ADR.** Оркестратор удаления, порты стирания модулей, маркер стёртого e-mail и повторный проход — новое
  сквозное решение, влияющее на все будущие модули → **ADR-0015** (§10).
- Прочее проверено, расхождений нет: очистка неподтверждённых (`deletedAt: null` в фильтре) удалённых не трогает;
  `rotateSession`/`findActiveSession` уже отказывают удалённому; `race_entries`, споры, протоколы не меняются (A3, A5,
  A7); `results` получает имена только через `RIDER_NAMES` — после удаления профиля строка «Участник».

**Риски (дополнение к R1–R5).**
- **R6 — второе письмо** при падении worker между отправкой и отметкой (at-least-once, как ссылки).
- **R7 — гонка роли панели** (F12).
- **R8 — ротация `EMAIL_TOKEN_SECRET`** снимает блок повторной регистрации со стёртых адресов (F3).
- **R9 — `DEVICES_ENABLED=false` при живых подключениях:** отзыв невозможен (`disabled`) → `revokeFailed` + журнал,
  данные удаляются, ручной шаг по runbook.

# 8.2 Deviations from spec

- Порядок фоновых шагов: устройства (5) выполняются **до** треков (4) — §8.1 F4.
- Повторный проход очистки (sweep + регламент resume) — добавлен по R5 (§8.1 F9).
- §9: уточнён код N1 (`403 PASSWORD_INCORRECT`), добавлены N8 (живой аккаунт не чистится) и N9 (поздняя запись
  убирается повторным проходом) — architect, 2026-10-27.

# 8.3 Security checklist

1. **AuthN/AuthZ.** `POST /v1/account/delete` — только `AuthGuard` identity (access JWT + живая сессия + не удалён);
   пользователь — `@CurrentUser()`, не из тела. Подтверждение — текущий пароль через `CredentialsCheck` (общие
   счётчики `signin-*`, argon2 до транзакции). Транзакция identity — первой `lockUserCredentials`, сверка хеша
   (сброс пароля между проверкой и коммитом → 401); отзыв **всех** сессий `account_deleted`, гашение ссылок
   verify/reset и токена регистрации — в той же транзакции (`pokatim-security.md`). A11 — проверка роли на сервере
   (порт `panel`), UI не решает. Worker стирает только аккаунт с `deletedAt ≠ null` (шаг 0, N8).
2. **Входные данные.** `DeleteAccountRequest` — `strictObject`, пароль — `SignInPassword` (лимит длины входа); лишние
   ключи — 400; тело ≤ общего `bodyLimit`. `userId` очереди — `z.uuid()` из payload outbox.
3. **Данные наружу.** Ответ — `204` без тела; ошибки — коды без подробностей (что удалено, сколько, есть ли
   подключения — не раскрывается). Маркер стёртого e-mail наружу не выходит (панель — «Удалённый участник»). Письмо —
   без ссылок с токенами и без имени.
4. **Злоупотребления.** Лимит `account-delete:<uid>` 5/ч + счётчики входа (IP → e-mail+IP → e-mail): перебор пароля
   через удаление упирается в те же пределы, что вход; 429 одинаковый. Повтор после удаления — 401 (сессии отозваны),
   двойное нажатие — один эффект (`'already'`). CSRF web: эндпоинт с Bearer, cookie не читает, но глобальная защита
   (Fetch Metadata + Origin) отклоняет межсайтовый POST — int-тест N7; ответ очищает cookie refresh
   (`SessionCookie.clear`, атрибуты как при выдаче).
5. **Секреты и логи.** Логи — `uid`, шаг, исход, счётчики; без e-mail, имён, названий райдов/маршрутов, пароля и хеша.
   HMAC маркера — `EMAIL_TOKEN_SECRET` из env, в логи и ответы не попадает; payload outbox/задач — только `userId`.
   Тест на отсутствие e-mail в логах шага identity (spy логгера).
6. **Аудит.** `panel_audit` `account.deleted` (actor — сам райдер `{ kind: 'user', userId }`, subject `rider`, label
   `Участник ·<6>`; без e-mail, имени, причины) в транзакции удаления; `device_audit` — `disconnected`/`revoke_failed`
   с причиной `account_deleted`. Append-only коллекции (`user_consents`, `profile_consent_events`, `panel_audit`,
   `device_audit`, `dispute_events`, `race_recalculations`, `race_protocol_rows`) — без update/delete; сторожа зелёные.

# 9. Acceptance Criteria

**Функциональные**
- AC1. Вошедший райдер с верным паролем → `204`; после этого его access и refresh отклоняются (`401`), web-cookie
  очищена.
- AC2. После завершения задачи: нет `profiles`, «Моих маршрутов», загрузок/заездов/треков и их файлов, данных
  устройств; подключения OW отозваны (вызов агрегатора); будущие райды организатора отменены, отметки в чужих сняты,
  `organizerName` стёрт; в `users` нет открытого e-mail, даты рождения, хеша пароля.
- AC3. Опубликованный протокол с результатом райдера не меняется, строка — «Участник».
- AC4. Попытка в гонке с открытым окном снята, предварительная таблица пересчитана.
- AC5. Письмо «Аккаунт удалён» уходит один раз (ретрай задачи не шлёт второе).
- AC6. Регистрация на адрес удалённого аккаунта — нейтральный отказ D-07; вход — как неизвестный адрес.
- AC7. Запись `account.deleted` в журнале панели без ПДн.
- AC8. Приложение: «Профиль» → «Удалить аккаунт» → экран → пароль → «Удалить навсегда» → гостевой экран с «Аккаунт
  удалён». Работает в iOS, Android, web; гость по `/settings/account/delete` → вход → возврат на экран.

**Негативные**
- N1. Неверный пароль → отказ (`403 PASSWORD_INCORRECT`), данных не тронуто, счётчики входа растут; клиент не
  выходит из сессии.
- N2. Член команды панели → `409`, данные не тронуты.
- N3. Превышен лимит → `429`, данные не тронуты.
- N4. Чужие данные не задеты: у второго пользователя профиль, маршруты, заезды, райды, отметки, устройства на месте;
  маршруты платформы и чужие райды целы.
- N5. Повторный запуск задачи очистки (и после частичного сбоя на любом шаге) безопасен: тот же итог, без ошибок,
  без второго письма.
- N6. Повторный вызов эндпоинта после удаления → `401`, вторая задача не создаётся.
- N7. Без входа → `401`; web без CSRF-заголовков → отказ.
- N8. Задача очистки для неудалённого аккаунта ничего не трогает (`skipped`).
- N9. Данные, записанные запросом, прошедшим `AuthGuard` до удаления, убирает повторный проход очистки (R5).

**Технические / архитектурные**
- Модули — только через `index.ts`, чужие коллекции не читаются (`pnpm arch:check`).
- Append-only коллекции не изменяются (сторожевые тесты где есть).
- i18n: все строки в `packages/i18n`; a11y: подписи, роли, фокус на ошибке.
- `TURBO_CONCURRENCY=1 pnpm check` зелёный на изолированных Mongo/Redis.

# 10. Documentation Impact

См. Scope п. 5; конкретно (architect):
- **ADR-0015 «Удаление аккаунта: оркестратор `account` и порты стирания»** (`docs/adr/0015-account-deletion.md` +
  индекс `docs/adr/README.md`): F2 (один обработчик vs fan-out), порядок шагов, порты, F3 (маркер e-mail, ключ,
  ротация), F9 (sweep + resume), правило «новый модуль с данными пользователя — порт стирания и шаг».
- `docs/runbooks/account-deletion.md` (+ `docs/runbooks/README.md`): ручное удаление пользователя OW
  (`pokatim:<id>`), `revokeFailed`/`DEVICES_ENABLED=false`, поиск зависших (`deletedAt` есть, `erasureSweptAt` нет
  дольше 2 ч), повторный запуск (регламент resume; разовый — failed-задача BullMQ `retry`), R6 (второе письмо), R8
  (ротация `EMAIL_TOKEN_SECRET`), D10/R1 (юрист).
- `docs/product/profile.md` — P4 → ссылка на `account.md`; `docs/product/account.md` — без изменений решений
  (при ответе человека на F7/F8 — дописать).
- `.claude/rules/pokatim-backend.md` — модуль `account` в списке контекстов, зависимости, очередь `account-deletion`,
  порты стирания; «Анонимизация — „Удалённый участник“» → «Участник» (A3).
- `.claude/rules/pokatim-db.md` — заменить блоки «Удаление аккаунта (когда появится)» фактическим поведением
  (profiles, rides с `hidden`, routes, tracks + маркеры, devices, panel по A11), поля `users`
  (`deletionEmail*`, `erasedAt`, `erasureSweptAt`, `null` у `passwordHash`/`birthDate`, маркер `email`), миграция 0023;
  «Мягкое удаление = „Удалённый участник“» → A3; жалобы `ride_reports` — хранятся (A6).
- `.claude/rules/pokatim-security.md` — блок «Удаление аккаунта» (A2 пароль через `CredentialsCheck`, коды 403/409/429,
  лимит, `lockUserCredentials`, cookie, маркер и ключ); allowlist возврата + `/settings/account/delete`; строку
  «нейтральные ответы … удаления аккаунта» уточнить (эндпоинт за входом, e-mail не принимает).
- `.claude/rules/pokatim-app.md` — «Удаление аккаунта: нативный alert» и «Публичное удаление … по ссылке» → экран
  `settings/account/delete` (A2, A12), `signOut({ returning: false, notice })`, баннер на «Регистрации».
- `.claude/rules/pokatim-contracts.md` — `account/account-deletion.schema.ts`, коды `PASSWORD_INCORRECT`,
  `ACCOUNT_PANEL_MEMBER`, `AUDIT_ACTIONS` `account.deleted`.
- `apps/api/src/queues.ts` — комментарий очереди. `.env.example` — без изменений (новых переменных нет).
- `pr.md`: миграция `0023_account_deletion` (expand-only, шаг деплоя `db:migrate` до выкладки worker), новая очередь.

# 11. Implementation Context

**ENTRY POINTS**
- HTTP: `apps/api/src/modules/account/account.controller.ts` → `AccountDeletionService.delete`.
- Worker: `apps/api/src/modules/account/account-erasure.processor.ts` (`account.deletion-requested`,
  `account.deletion-sweep`, `account.erasure-resume`) → `AccountErasureService.run`.
- App: `apps/app/src/app/settings/account/delete.tsx`; ссылка — `apps/app/src/app/settings/profile.tsx`.

**FILES TO MODIFY / CREATE**
- contracts: `packages/contracts/src/account/account-deletion.schema.ts` (new), `src/index.ts`, `src/common.ts`
  (коды в конец), `src/admin/audit.schema.ts` (`account.deleted` в конец) + тесты схем.
- api-client: `packages/api-client/src/index.ts` (`deleteAccount`) + тест.
- i18n: `packages/i18n/src/ru.ts` (app + `admin.audit.action.account.deleted`).
- api: `src/queues.ts`, `src/error-messages.ts`, `src/app.module.ts`, `src/worker.module.ts`,
  `src/db/migrations/0023_account_deletion.ts` (new) + `migrations/index.ts`.
- identity: `identity.collection.ts`, `identity.repository.ts`, `credentials-check.ts`, `registration.service.ts`,
  `tokens.ts`, `identity-accounts.ts` (null-хеш), `identity.module.ts`, `index.ts`, new `account-closure.ts`,
  `account-erasure.ts`, `mail/account-deleted-email.ts` (+ test).
- panel: new `panel-membership.ts`, `panel-core.module.ts`, `index.ts`.
- profile: `profile.repository.ts` (`deleteProfile`), new `profile-erasure.ts`, `profile.module.ts`, `index.ts`
  (+ `riderSubjectLabel`).
- rides: `rides.repository.ts` (пакетные методы стирания), new `ride-erasure.ts`, `rides.module.ts`
  (`RidesCoreModule`), `index.ts`.
- routes: `routes.repository.ts` (`ownIds`), new `route-erasure.ts`, `routes.module.ts`, `index.ts`.
- tracks: `track-uploads.service.ts` (общий `remove`), `tracks.repository.ts` (`listUploadIds`, `deleteUserMarkers`),
  new `track-erasure.ts`, `tracks.module.ts`, `index.ts`.
- devices: `devices-sync.service.ts` (общий отзыв), `devices.repository.ts` (`liveConnectionsOf`, `deleteUserData`),
  `devices.collection.ts` (`revokedReason` + `account_deleted`), new `device-erasure.ts`, `devices.module.ts`
  (`DevicesCoreModule`), `index.ts`.
- account (new): `account.controller.ts`, `account-deletion.service.ts`, `account.events.ts`, `account.policy.ts`,
  `account-erasure.service.ts`, `account-erasure.processor.ts`, `account-schedules.ts`, `account.module.ts`,
  `index.ts`.
- app: `src/app/_layout.tsx` (Stack.Screen), new `src/app/settings/account/delete.tsx`,
  `src/app/settings/profile.tsx`, `src/app/(onboarding)/register.tsx`, `src/features/auth/{session-store,use-sign-out,
  return-path-allowlist}.ts`, new `src/features/account/{delete-account-form.tsx,queries.ts}`, `e2e/web.spec.ts`.
- admin: только i18n-ключ (тип `MessageKey` ловит пропуск).
- docs: §10.

**FILES TO READ** — §6.

**TYPES & SCHEMAS**
- `DeleteAccountRequest { password: SignInPassword }`; ответ — `204`.
- `ErrorCode += 'PASSWORD_INCORRECT' (403), 'ACCOUNT_PANEL_MEMBER' (409)`; `RATE_LIMITED` 429 `{ retryAfterSec }`.
- `AUDIT_ACTIONS += 'account.deleted'`; `SESSION_REVOKED_REASONS += 'account_deleted'`;
  `DeviceConnectionDoc.revokedReason += 'account_deleted'`.
- `UserDoc`: `passwordHash: string | null`, `birthDate: string | null`, `deletionEmailClaimedAt?`,
  `deletionEmailSentAt?`, `erasedAt?`, `erasureSweptAt?: Date | null`.
- Событие `account.deletion-requested { userId: uuid }` → `QUEUE.accountDeletion = 'account-deletion'`; задача
  `account.deletion-sweep { userId }` (`deduplication.id = account-sweep:<userId>`, `delay = sweepDelayMs`);
  repeatable `account.erasure-resume`.
- Порты: `AccountClosure { verifyPassword(userId, password, ip): Promise<string>; close(tx, userId, checkedHash, now):
  Promise<{ outcome: 'closed' | 'already' | 'changed'; revoked: number }> }`; `AccountErasure { deletionState(userId);
  notifyAndErase(userId, now, opts): Promise<'erased' | 'already' | 'not_deleted'>; markSwept(userId, now);
  pendingSweeps(deletedBefore, limit): Promise<string[]> }`; `PanelMembership { hasActiveRole(userId): Promise<boolean> }`;
  `ProfileErasure { erase(userId): Promise<boolean> }`; `RideErasure { erase(userId, now): Promise<{ cancelled; left;
  unsigned }> }`; `RouteErasure { erase(userId): Promise<number> }`; `TrackErasure { erase(userId): Promise<number> }`;
  `DeviceErasure { erase(userId, attempt: { final: boolean }): Promise<{ revoked: number; failed: number }> }`.
- Порты — классы-провайдеры (как `IdentityAccounts`/`PanelDirectory`); токены `Symbol` — только если нужна подмена в
  тестах (как `ACTIVITY_SOURCE`).

**TESTS** (Vitest API — int на реальном replica set и Redis, своя БД `*_test`/Redis db; app — Jest)
- contracts/api-client unit: схема (`strictObject`, длина пароля), коды в конце списка, `deleteAccount` (204 →
  `undefined`, 403/409/429 → `ApiHttpError`).
- identity unit: `erasedEmailMarker` (детерминирован, без `@`, разные адреса — разные маркеры); шаблон письма (дата
  Минска, нет ссылок/имени).
- `account-deletion.int.test.ts` (HTTP, harness): AC1 (204; старый access → 401; refresh → 401; `Set-Cookie` сброса
  `SESSION_COOKIE` с теми же атрибутами; одна запись outbox; `sessions.revokedReason = 'account_deleted'` у всех);
  N1 (403 `PASSWORD_INCORRECT`, документы не изменены, счётчик `signin-*` вырос: после предела входа — 429 и у входа);
  N2 (член панели → 409, ничего не изменено, счётчики входа не тронуты); N3 (6-я попытка → 429 до проверки пароля);
  N6 (повтор → 401, второго события нет; параллельные два запроса → один `'closed'`, одно событие, одна запись
  журнала); N7 (без токена → 401; `Sec-Fetch-Site: cross-site` → 403); AC7 (`panel_audit`: ключи записи, нет
  e-mail/имени; `actor.userId` = удалённый); гонка со сбросом пароля (ворота `gate()` на `lockUserCredentials` из
  `test/identity.ts`): сброс коммитится между проверкой и транзакцией → 401, аккаунт не удалён; **отрицательное
  доказательство**: замок подменён чтением → удаление проходит со сменённым паролем (тест краснеет без механизма).
- `identity` int: AC6 — регистрация на адрес до и после стирания → 409 `EMAIL_UNAVAILABLE`; вход по нему → 401 тело =
  телу неизвестного адреса; запрос сброса → нейтральный ответ, письма нет; `rotateSession` удалённого → 401; порт
  панели `accountState` стёртого → неактивен.
- `account-erasure.int.test.ts` (процессор/сервис напрямую, FakeMailer, `test/fake-ow.ts`, `resultsWorker(h)`):
  два пользователя A (удаляемый) и B с одинаковым набором данных (профиль + согласия, свои райды будущие/прошлые/
  отменённые/скрытый будущий, отметка в чужом будущем и прошедшем, маршруты rider и маршрут платформы, ручная и
  провайдерская загрузка с файлом, активное и отозванное подключение, тикет, импорты, заявка с попыткой в открытом
  окне, опубликованный протокол). Проверки: AC2 по каждой коллекции; файлы A удалены из `TrackFileStore`; OW —
  `revokeConnection` вызван для живых подключений A; AC3 (`race_protocol_rows` байт-в-байт, `riderName` = `null`);
  AC4 (попытка снята, предварительная таблица пересчитана); AC5 (одно письмо; повтор задачи — писем 1); A9 —
  `user_consents`, `profile_consent_events`, `device_audit`, `panel_audit`, `ride_reports`, `race_entries` A на месте;
  N4 — все данные B и маршрут платформы без изменений; скрытый райд A — `hiddenFromStatus: 'cancelled'`; прошлый
  райд B с отметкой A — отметка осталась.
- N5: повтор всей задачи — тот же итог; сбой на каждом шаге 1–6 (spy бросает один раз) → ретрай завершает; письмо не
  дублируется; захват письма чужим процессом (свежий) → бросок, после истечения — одно письмо.
- N8: задача для **неудалённого** пользователя → `skipped`, ничего не тронуто (обязательный отрицательный тест).
- N9 (R5): после первого прохода — прямая поздняя запись (профиль upsert, загрузка, маршрут) → sweep убирает; resume
  ставит sweep только удалённым раньше часа без `erasureSweptAt` (IXSCAN по `users_erasure_pending_idx`).
- devices: `not_found` → успех; `unavailable` не на финале → бросок (ретрай); на финале / `disabled` → `revokeFailed`
  + `device_audit revoke_failed`, данные удалены; позднее `tracks.upload-deleted` не создаёт `device_imports`.
- F8: письмо падает > 24 ч → стирание без письма, лог `abandoned`.
- Логи: spy логгера шагов — нет e-mail/имён.
- Сторожа (должны остаться зелёными без правок списков): `profile.repository.test.ts`, `device-audit.test.ts`,
  `panel.repository.test.ts`, `results.repository.test.ts`, `disputes.repository.test.ts`,
  `ride-reports.repository.test.ts`; `admin-routes.test.ts` (account не `/admin`); `migrations.int.test.ts` (0023).
- app (Jest, Europe/Minsk): экран — гость → `rememberReturnPath` + редирект на «Вход»; pending → скелетон;
  ошибки 403/409/429/сеть → поле/баннеры; успех → `signOut({ returning: false, notice })` и «Регистрация» с баннером
  «Аккаунт удалён»; кнопка disabled/loading; подписи a11y и live region; allowlist — точный путь принят,
  `/settings/account/delete?x`, `/settings/account/delete/1`, `//host` — нет; `session-store` — `returning:false`,
  `notice` сбрасывается входом; ссылка в «Профиле». Web: `return-path.web.test.ts` для нового пути.
- e2e web смоук: гость на `/settings/account/delete` → «Вход». С `E2E_API=1` (по возможности): регистрация → вход →
  удаление → гостевой экран.
- `TURBO_CONCURRENCY=1 pnpm check` зелёный; отрицательные доказательства — результат в §12.

**OUT OF SCOPE** — §4; плюс: экран провалов задач в панели (F13), «опасная» кнопка и фокус `TextField` в
app-foundation (F7, follow-up), удаление пользователя OW через API (A8), изменение `users_email_unique`, новая
переменная окружения под HMAC маркера, правка писем/журналов прошлого.

# 12. Outcome

Заполняет coder.
