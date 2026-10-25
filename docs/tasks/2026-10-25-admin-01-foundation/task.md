# 1. Title

Админка «Протокол», слайс 1: основа панели — вход аккаунтом приложения в отдельную сессию панели, роли и права
команды платформы, «Нет доступа», каркас (layout, навигация, плотные таблицы), «Сотрудники» (выдача, смена и снятие
роли), append-only журнал действий

# 2. Goal

Команда платформы работает в веб-панели «Протокол» (`apps/admin`, desktop 1440, светлая тема `panel`, путь `/admin/`
того же домена) **тем же e-mail и паролем, что в приложении** (решение автора 2026-10-25, прототип D-13): один аккаунт
на человека, роль команды (администратор / модератор / организатор) выдаётся существующему пользователю приложения.
Вход в панель — всегда повторный ввод пароля и **отдельная серверная сессия панели**: сессия приложения (access JWT,
refresh-cookie, SecureStore) панель не открывает. Первый администратор — CLI-командой на сервере по e-mail
существующего подтверждённого пользователя; дальше роли выдаёт только администратор в экране «Сотрудники».
Права определяются ролью и проверяются только на сервере на каждом запросе; интерфейс скрывает недоступное (`Can`) и
показывает «Нет доступа». Каждое чувствительное действие (выдача, смена и снятие роли, вход и выход в панель, выдача
роли CLI) пишет запись в append-only журнал: кто, что, когда, над кем, причина.

Гонок, треков, результатов, споров в системе пока нет: слайс даёт основу, на которую следующие слайсы панели
(Приложение A «Карта прототипа») добавляют разделы, права и записи журнала без переделки каркаса.

Источники: `AGENTS.md` §1, §4; `.claude/rules/{web,pokatim-web,security,pokatim-security,db,pokatim-db,backend,
pokatim-backend,contracts,pokatim-contracts,tests,pokatim-tests}.md`; ADR-0003 (п. 4, п. 6), ADR-0005, ADR-0006,
ADR-0007, ADR-0008 (`AuthGuard`, `request.auth`); прототипы панели автора (три макета `key-web-panel*`, 2026-10-25,
**конфиденциальны** — в репозиторий не копируются; здесь только краткие описания и необходимые UI-тексты); ответы
автора 2026-10-25 (§8.2).

# 3. Scope

**Contracts / api-client** (`packages/contracts/src/admin/*.schema.ts` — новые; `packages/api-client/src/admin.ts`)
- `PanelRole` (`admin | moderator | organizer`), `Permission` (`members.read`, `members.manage`, `audit.read`) —
  enum-ы только дополняются в конец (§8.1 R6). Карта «роль → права» — **только на сервере**; клиент получает итоговый
  список прав в `PanelMe`.
- `PanelSignInRequest` / `PanelSignInResponse` (`signedIn` + `PanelMe` | `verificationRequired` — как у входа
  приложения), `PanelMe`, `PanelMember`, `PanelMemberList`, `GrantRoleRequest`, `ChangeRoleRequest`,
  `RevokeRoleRequest` (обязательная причина), `AuditEntry`, `AuditPage`, `AuditQuery`, `PANEL_SESSION_COOKIE`.
- Коды ошибок проекта — в конец `defineErrorCodes`: `PANEL_ACCESS_DENIED` (верный пароль, роли нет),
  `PANEL_USER_UNVERIFIED`, `PANEL_ALREADY_MEMBER`, `PANEL_LAST_ADMIN`, `PANEL_SELF_ACTION`. Базовые: `UNAUTHORIZED`,
  `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `VALIDATION_FAILED`; проекта — `INVALID_CREDENTIALS`.
- `createAdminApiClient({ baseUrl })` — фабрика панели (тот же origin, `credentials: 'same-origin'`, без
  `Authorization`): `signIn`, `signOut`, `me`, `resendVerification` (существующий контракт identity), `listMembers`,
  `grantRole`, `changeRole`, `revokeRole`, `listAudit`. Клиент приложения не меняется.

**API — `identity`: узкий порт учётных данных для панели** (`identity/index.ts`)
- `PanelCredentials.verify({ email, password }, ip)` — та же механика, что вход приложения: лимиты (общие счётчики со
  входом приложения, §8.1 R3) → поиск → argon2 (пустышка для неизвестного/удалённого) → один `401
  INVALID_CREDENTIALS`; неподтверждённый с верным паролем → `verificationRequired` (перевыпуск токена регистрации под
  `lockUserCredentials`, как `SignInService`). Успех → `{ userId, email, credentialsStamp }`. Общая часть с
  `SignInService` выносится, а не копируется.
- `IdentityAccounts`: `accountState(userId)` → `{ active, credentialsStamp }` (не удалён, подтверждён; штамп —
  HMAC от текущего хеша пароля, §8.1 R2), `findVerifiedByEmail(email)`, `emailsOf(userIds)`. Коллекции identity
  читает только identity.

**API — новый модуль `apps/api/src/modules/panel`** (все пути — `/v1/admin/...`)
- Коллекции `panel_members` (`_id` = id пользователя: роль, статус, отображаемое имя), `panel_sessions`, `panel_audit`
  (append-only), `panel_meta` (документ-замок набора администраторов). Миграция `0005_panel`.
- **Сессия панели** (§8.1 R1): непрозрачный случайный токен в cookie `__Secure-pokatim_admin_sid` (`HttpOnly; Secure;
  SameSite=Strict; Path=/v1/admin`, без `Domain`), в БД — sha256; простой 2 ч, абсолют 12 ч. `PanelGuard` на каждом
  запросе: сессия жива → аккаунт приложения активен и штамп учётных данных совпадает с записанным при входе → член
  команды `active` → права роли. Сброс пароля приложения, удаление аккаунта, снятие роли действуют сразу.
  `POST /admin/session/sign-in`, `POST /admin/session/sign-out`, `GET /admin/session/me`.
- **Права:** `defineRoles` → `ROLE_PERMISSIONS` (admin — все; moderator — `audit.read`; organizer — нет),
  `@RequirePermission(...)`, без права — `403 FORBIDDEN`; маршрут без `PanelGuard` или явного `@Public()` ловит тест.
- **Сотрудники** (`members.manage`, только admin): `POST /admin/members` — выдать роль существующему подтверждённому
  пользователю по e-mail (+ отображаемое имя); `POST /admin/members/:userId/role` — сменить роль (причина);
  `POST /admin/members/:userId/revoke` — снять роль (причина; отзывает все сессии панели в той же транзакции).
  Защита: нельзя менять/снимать себе, нельзя оставить панель без активного администратора (§8.1 R7).
  `GET /admin/members` (`members.read`) — список (до 500), `GET /admin/audit` (`audit.read`) — курсор по `_id`.
- **Журнал:** `PanelAudit.append(tx, entry)` — единственный писатель `panel_audit`, в той же транзакции, что действие;
  экспорт через `modules/panel/index.ts` для будущих модулей панели.
- **CLI** `node dist/cli/panel.js grant-admin --email <e> --name <имя>` — роль `admin` существующему подтверждённому
  пользователю (первый и аварийный администратор); запись журнала с актором `cli`; секретов не требует.

**Admin (`apps/admin`)**
- Зависимости: `@tanstack/react-router`, `@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`,
  `@playwright/test` (dev). Версии — через context7 и `minimumReleaseAge` (старше суток).
- Роутер с `basepath` из `import.meta.env.BASE_URL` (`/admin/` на стенде и в проде, `/` в `pnpm dev`).
- Сессия в клиенте: запрос `me` (TanStack Query) — «кто я и что могу»; гард маршрутов (`beforeLoad`), 401 → «Вход» с
  «Сессия истекла» и возвратом на исходный путь; 403 → «Нет доступа к разделу»; `Can` / `useCan(permission)`.
- Каркас `src/ui`: `AppShell` (тёмный сайдбар `--density-sidebar-width`, `--nav-*`; пункты — из конфигурации навигации с
  правом; внизу — имя, роль · «команда платформы», «Выйти»), `PageHeader`, `DataTable` (TanStack Table), `Dialog`
  (нативный `<dialog>`), `ReasonDialog`, поля форм, `Button`, `Banner`, `StatusTag`, `AuthCard`, `EmptyState`,
  `ErrorState`.
- Экраны: «Вход в панель» и его состояния из прототипа (покой, неверные данные, «Нет доступа к панели», «Сессия
  истекла», «Слишком много попыток», «E-mail не подтверждён» с повтором письма), «Забыли пароль?» → общий сброс пароля
  приложения (`/forgot-password` web приложения, слайс 3), «Обзор», «Сотрудники», «Журнал действий», «Нет доступа к
  разделу», «Страница не найдена».
- Строки — `@pokatim/i18n` (`admin.*`); навигация — один файл; оформление — переменные и классы `@pokatim/design-tokens`
  (тема `panel`).

**Infra / CI / docs**
- Прод — панель на `/admin/` того же домена (Q13): Caddy `PUBLIC_HOST` `/admin/*` → контейнер `admin` (nginx с
  заголовками), блок `ADMIN_HOST` убирается; строгий CSP панели и `Cache-Control`/`no-store` — §8.3.
- Playwright-смоук панели `apps/admin/e2e/admin.spec.ts` на `/admin/` (`vite preview` с `ADMIN_BASE=/admin/` и
  прокси `/v1`), `pnpm e2e:admin`, шаг в CI.
- ADR-0009, runbook (CLI), architecture, rules, product (§10).

# 4. Out of Scope

- Разделы следующих слайсов (Приложение A) и их права и записи журнала.
- **2FA (TOTP) для администраторов** — отдельный слайс, обязателен **до прода** (Q5, §8 «Пароль приложения = доступ
  к панели»).
- Приглашение на регистрацию (выдача роли адресу без аккаунта, применяется после регистрации) — follow-up (§8.1 R4).
- Письмо-уведомление о выдаче/снятии роли — follow-up (§8.1 R5).
- Свой сброс пароля панели — нет: общий сброс приложения (Q11); экран сброса в панели из прототипа (3b) не делаем.
- Строгий CSP web приложения (`apps/app/server`, SSR с inline-скриптами гидрации — нужны nonce/хеши) — отдельная
  задача, обязательна до прода (компенсация C3, §8).
- Роль MongoDB без `update`/`remove` для append-only коллекций — follow-up инфраструктуры.
- Удаление аккаунта: снятие роли и отзыв сессий панели — в задаче удаления аккаунта (гард уже отказывает удалённому).
- Перенос в app-foundation (F6, `admin-kit`) — после слайса 2 панели (§8.2 Q14).
- Раскладка ниже 1440, тёмная тема панели.

# 5. Architecture Context

- **Placement API:** новый контекст `apps/api/src/modules/panel` (доступ к панели «Протокол»: члены команды и роли,
  сессии панели, журнал действий панели). `PanelModule` — в `app.module.ts`; worker не меняется (очередей и писем в
  слайсе нет). Будущие модули панели импортируют `PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelAudit`
  только через `modules/panel/index.ts`. `panel` → `identity` — только через `identity/index.ts` и только порт
  `PanelCredentials` / `IdentityAccounts`; `identity` о `panel` не знает (циклов нет).
- **Почему не поле в `users`:** роль — данные другого контекста (доступ к панели), а `users` — зона R1 identity
  (каждая запись — под `lockUser`); отдельная коллекция `panel_members` (`_id` = userId, как `profiles` слайса 4)
  пишется только модулем `panel`, читается одним запросом по `_id`, анонимизируется удалением документа (§8.1 R2).
- **Изоляция от сессии приложения** (§8.1 R1): отдельная коллекция сессий, отдельная cookie (имя и путь `/v1/admin`
  против `__Secure-pokatim_rt` и `/v1/auth/session`), отдельный гард с полем `request.panel` (у `AuthGuard` —
  `request.auth`). Access JWT и refresh приложения панель не открывают; вход в панель — только паролем.
- **Сессия — серверная, без JWT:** на запрос — `panel_sessions` по `tokenHash`, `users` по `_id` (через
  `IdentityAccounts`), `panel_members` по `_id` — три чтения по уникальному ключу; продление простоя — условный
  `updateOne` не чаще раза в 5 мин.
- **Штамп учётных данных** (§8.1 R2): `credentialsStamp = HMAC(EMAIL_TOKEN_SECRET, "credentials:" + passwordHash)`
  считается в identity из того же чтения документа, что и проверка пароля, записывается в сессию панели при входе и
  сверяется гардом на каждом запросе. Смена пароля (сброс, слайс 3; будущая смена в профиле) мгновенно гасит все сессии
  панели без записи в коллекции `panel` и без зависимости identity → panel; закрывает и гонку «вход в панель
  проверил старый пароль ↔ сброс».
- **Транзакции:** транзакции панели меняют только документы `panel_*`: первой операцией — `lockMember`
  (`$inc version` документа `panel_members`; при выдаче нового члена — вставка, гонку ловит `_id`), если меняется набор
  активных администраторов — сначала `lockAdmins` (`$inc version` документа `panel_meta._id = 'admins'`). Аудит —
  вставка в той же транзакции. Документы identity в транзакциях панели не пишутся — `lockUser` не нужен.
- **Очереди/outbox:** не нужны в этом слайсе (писем нет, событий для других модулей нет).
- **Контракты:** только добавления; приложение райдера не затронуто.
- **Admin:** SPA без SSR; данные — только `createAdminApiClient` + TanStack Query; токенов в JS нет (cookie);
  токен регистрации из `verificationRequired` — только в памяти экрана (для «Отправить письмо ещё раз»).
- **Deploy:** dev-стенд и прод — `/admin/` того же домена; миграция `0005_panel` — шагом деплоя; CLI —
  `dc exec api node dist/cli/panel.js grant-admin …` (runbook).

# 5.1 Placement & Reuse Gate

- **Переиспользуем:** identity — механику входа `SignInService` (лимиты IP → e-mail+IP → e-mail, HMAC-ключи,
  пустышка argon2, `verificationRequired` с перевыпуском токена регистрации) через выделенную общую функцию;
  `rateLimitKeyForIp`, `randomToken`, `sha256`; `POST /v1/auth/verification/resend` (повтор письма из панели);
  web приложения `/forgot-password` и `auth/reset/<token>` (сброс пароля — слайс 3); образцы — `SessionCookie`
  (атрибуты cookie одним объектом, `noStore`), `profiles` (`_id` = userId), `ensureCollection`. База: `RateLimiter`,
  `CLOCK`, `ENV`, `ZodValidationPipe`, `DomainError`, `MongoTransactions`, `uuidv7`, `isDuplicateKey`, `PageQuery`,
  `Uuid`, `RateLimitedDetails`, `enableCsrfProtection`, `createMongoApiHarness`, `TestClock`. Contracts — `Email`,
  `SignInPassword`, `RegistrationToken`, `ResendVerificationRequest/Response`, `normalizeEmail`. Веб —
  `designSystemCss({ theme: 'panel' })`, `.t-panel-*`, `.skeleton`, `--density-*`, `--nav-*`, `--color-*`, `--space-*`.
- **Запрещённые дубли:** второй вход по паролю (копия лимитов/argon2/пустышки) в `panel`; чтение `users`/`sessions`
  из `panel` мимо порта identity; своя страница сброса пароля; запись `panel_audit` мимо `PanelAudit`; ручной `fetch`
  в `apps/admin`; DTO вне contracts; тексты вне `@pokatim/i18n`; hex/px-литералы в CSS панели; модалки и таблицы мимо
  `src/ui`; проверка прав в UI как источник истины; приём access JWT приложения в `PanelGuard`.
- **Новые пакеты:** нет. `apps/admin/src/ui/*` — кандидаты в `@rkarakulov/admin-kit` (F6), явное исключение
  `AGENTS.md` §4.11 до F6 (§8.1 C4). Общие токены размеров панели — задачей в app-foundation (Q17).

# 6. Relevant Files

- identity: `apps/api/src/modules/identity/{sign-in.service,session-cookie,session.controller,password-hasher,tokens,
  identity.policy,identity.collection,identity.repository,identity.module,auth.guard,access-token,
  current-user.decorator,index}.ts`, `{sign-in,auth-guard,password-reset,identity-races}.int.test.ts`.
- `apps/api/src/{app.module,http-app,error-messages}.ts`, `config/env.ts`, `db/migrations/{0002_identity,0004_profile,
  index,migrations.int.test}.ts`, `modules/profile/*` (образец `_id` = userId), `apps/api/test/{harness,identity,
  test-env}.ts`, `apps/api/nest-cli.json`, `apps/api/package.json`.
- Contracts: `packages/contracts/src/{common,index}.ts`, `auth/{sign-in,verification,registration}.schema.ts`;
  `packages/api-client/src/index.ts`.
- Admin: `apps/admin/{package.json,vite.config.ts,index.html,tsconfig.json}`, `src/*`; `packages/i18n/src/ru.ts`;
  `packages/design-tokens/src/{brand,css}.ts`.
- App web (ссылка «Забыли пароль?»): `apps/app/src/app/(onboarding)/forgot-password.tsx`.
- Infra/CI: `infra/Caddyfile`, `infra/docker-compose.prod.yml`, `infra/docker/{Dockerfile,admin-nginx.conf}`,
  `.github/workflows/ci.yml`; `apps/app/e2e/{mailpit,project}.ts`, `apps/app/playwright.config.ts` (образец).

# 7. Implementation Notes

- **Порт входа (identity).** Из `SignInService` выделяется `CredentialsCheck` (лимиты + поиск + argon2/пустышка) —
  им пользуются и вход приложения, и `PanelCredentials.verify`; поведение входа приложения не меняется (его int-тесты
  — регрессия). Лимиты — **те же ключи** `signin-*` (§8.1 R3). `verify`: неизвестен / удалён / неверный пароль →
  `401 INVALID_CREDENTIALS` (тело как у приложения); неподтверждён → транзакция под `lockUserCredentials` со сверкой
  хеша → `reissueToken` → `verificationRequired`; подтверждён → **без транзакции** `{ userId, email,
  credentialsStamp }` (штамп из того же прочитанного хеша; сессию выдаёт `panel`).
- **Вход в панель (`PanelSessionService.signIn`):** `PanelCredentials.verify` → `verificationRequired` — ответ как
  есть (сессии нет) → `panel_members.findOne({ _id: userId, status: 'active' })` → нет — `403 PANEL_ACCESS_DENIED`
  (только после верного пароля: посторонний оракула не получает; сессии и записи журнала нет) → вставка
  `panel_sessions` (`credentialsStamp`, `idleExpiresAt = now + 2 ч`, `expiresAt = now + 12 ч`) + аудит
  `panel.signed_in` одной транзакцией → прежняя cookie панели этого браузера — отзыв `superseded` → cookie + `PanelMe`.
  Гонка «вход ↔ снятие роли/сброс пароля» закрыта гардом (роль и штамп проверяются на каждом запросе).
- **`PanelGuard`:** cookie → `OpaqueToken.safeParse` → `panel_sessions.findOne({ tokenHash, revokedAt: null,
  idleExpiresAt: { $gt: now }, expiresAt: { $gt: now } })` → `IdentityAccounts.accountState(userId)` (`active` и
  `credentialsStamp === session.credentialsStamp`) → `panel_members.findOne({ _id: userId, status: 'active' })` → права
  роли → `request.panel = { userId, sessionId, role, permissions }`. Любой отказ — `401 UNAUTHORIZED` (одно тело) +
  сброс cookie, если предъявлена; нет права из `@RequirePermission` — `403 FORBIDDEN`. Продление простоя:
  `updateOne({ _id, lastSeenAt: { $lt: now − 5 мин } }, { $set: { lastSeenAt: now, idleExpiresAt: min(now + 2 ч,
  expiresAt) } })`. `Cache-Control: no-store` на `/v1/admin/*`. Отказ из-за штампа/удаления/роли — сессия
  помечается `revoked` (`credentials_changed` / `account_inactive` / `role_revoked`) — лог `sid` и причина.
- **Cookie:** `PanelSessionCookie` — один объект атрибутов для set/clear: `__Secure-pokatim_admin_sid`, `HttpOnly`,
  `Secure`, `SameSite=Strict`, `Path=/v1/admin`, без `Domain`, `Max-Age` — остаток абсолютного срока. Идентификатор
  генерирует только сервер при входе (фиксация невозможна); ротация не нужна (не покидает cookie, срок короткий).
- **CSRF:** глобальный `enableCsrfProtection` покрывает `/v1/admin`; панель same-origin (dev — прокси Vite, стенд и
  прод — `/admin/` того же домена), CORS не нужен; мутации — только `POST`. Int-тест: `Sec-Fetch-Site: cross-site` → 403.
- **Выдача роли (`grant`):** `email` → `normalizeEmail` → `IdentityAccounts.findVerifiedByEmail` → нет аккаунта —
  `404 NOT_FOUND` («Пользователь с таким e-mail не найден — попросите зарегистрироваться в приложении»),
  неподтверждён — `409 PANEL_USER_UNVERIFIED`; транзакция: `lockAdmins` (если роль `admin`) → документ уже `active` —
  `409 PANEL_ALREADY_MEMBER`; `revoked` — `lockMember` и повторная активация с новой ролью; нет — вставка
  (`isDuplicateKey('_id_')` → повтор транзакции) → аудит `panel.role_granted { roleTo }`.
- **Смена роли / снятие:** `userId` — `Uuid`; сам себе — `409 PANEL_SELF_ACTION`; транзакция: `lockAdmins`, если
  затронут админ (было/станет `admin`, снятие у админа) → `lockMember` → не `active` — `404 NOT_FOUND` → активных
  админов после изменения 0 — `409 PANEL_LAST_ADMIN` → запись → снятие: `status: 'revoked'`, `revokedAt`, все
  `panel_sessions` пользователя `revoked('role_revoked')` → аудит (`panel.role_changed { roleFrom, roleTo }`,
  `panel.role_revoked { roleFrom }`) с причиной. Сессия приложения пользователя не трогается.
- **Журнал (`panel_audit`):** `{ _id: uuidv7, at, actor: { kind: 'user', userId } | { kind: 'cli' }, action,
  targetUserId | null, reason | null, details: { roleFrom?, roleTo? } | null }` — без e-mail, IP, UA, имён (имя —
  `displayName` из `panel_members` при выдаче, e-mail в журнале не показывается). Причина — 3–500 символов, без
  управляющих (кроме перевода строки). Только `insertOne`. `GET /admin/audit` — `_id < cursor`, `_id: -1`, фильтры
  `action`, `actorUserId`, `targetUserId` (после zod), `limit` из `PageQuery`.
- **Список сотрудников:** `panel_members` (до 500, все статусы) + `IdentityAccounts.emailsOf(ids)` одним запросом
  `$in`; удалённый аккаунт — e-mail «Удалённый участник», статус по факту.
- **CLI** (`apps/api/src/cli/panel.ts` → `dist/cli/panel.js`): `createApplicationContext(PanelCliModule)` (Config,
  Clock, Mongo, Redis не нужен — порт identity без лимитера: `IdentityAccounts` + `PanelRepository` + `PanelAudit`).
  `grant-admin --email --name`: подтверждённый пользователь → транзакция `lockAdmins` → активировать/вставить
  `admin` → аудит `panel.role_granted { actor: cli, roleTo: 'admin' }`; нет пользователя / неподтверждён — код выхода
  2 с текстом без персональных данных; уже `admin` — код 0, «уже администратор». Вывод — id пользователя, без e-mail.
- **Admin — сессия в клиенте:** `useMe()` = `useQuery(['admin', 'me'], api.me, { retry: false, staleTime: 60 с })`;
  `beforeLoad` защищённой ветки — `ensureQueryData(me)`; 401 → `redirect('/sign-in', { search: { reason: 'expired',
  next } })` (`next` — путь внутри `basepath`, начинается с `/`, без `//` и схемы); глобальные `QueryCache`/
  `MutationCache.onError`: 401 → `queryClient.clear()` и тот же редирект; 403 — «Нет доступа к разделу». Выход —
  `signOut` → `clear()` → «Вход».
- **Экран входа — состояния:** `PANEL_ACCESS_DENIED` → окно «Нет доступа к панели»: «Аккаунт <введённый e-mail> не
  входит в команду платформы. В приложении он работает как обычно.» + «Войти другим аккаунтом»;
  `verificationRequired` → «E-mail не подтверждён», «Отправить письмо ещё раз» (`resendVerification` с токеном из
  ответа, неактивна с отсчётом `resendAvailableInSec`), «Вернуться ко входу»; 429 → «Слишком много попыток»,
  «Попробуйте через N мин.», поля и «Войти» неактивны до конца паузы; `reason=expired` → «Сессия истекла», «Войдите
  снова — откроется та же страница.», «Войти» неактивна при пустом пароле; «Забыли пароль?» — ссылка у подписи поля
  «Пароль» на `/forgot-password` приложения (тот же origin; в `pnpm dev` — `VITE_APP_WEB_URL`).
- **`Can`/навигация:** `useCan(p) = me.permissions.includes(p)`; пункты меню — `src/navigation.ts`
  (`{ to, labelKey, permission? }`); прямой URL без права — «Нет доступа к разделу» внутри каркаса.
- **`DataTable`, `ReasonDialog`, время** — как в разделе §3; первая загрузка — 8 строк `.skeleton` под видимой шапкой и
  фильтрами; ошибки — §4.12; диалог — `showModal()`, фокус на поле, возврат на триггер, «Отмена» + Esc,
  подтверждение неактивно без причины, разрушительный вариант у «Снять роль»; время — `Intl.DateTimeFormat('ru-RU',
  { timeZone: 'Europe/Minsk' })`, тесты admin — `TZ=Europe/Minsk`.
- **Тексты:** из прототипа (кратко) — «Покатим» + «Панель команды платформы» над окном; «Вход в панель»; «Тот же
  e-mail и пароль, что в приложении Покатим.»; «E-mail», «Пароль», «Забыли пароль?», «Войти»; «Доступ только для
  команды платформы.»; «Неверный e-mail или пароль»; «Нет доступа к панели»; «Войти другим аккаунтом»; «Сессия
  истекла»; «Слишком много попыток»; «E-mail не подтверждён»; «Отправить письмо ещё раз»; «Вернуться ко входу»;
  «Отмена», «Esc», «Причина (обязательно)»; подпись сотрудника в сайдбаре — «<Имя> · <Роль> · команда платформы».
  `[ASSUMPTION]` (в макетах нет): «Обзор» и его пустое состояние «Разделы панели появятся здесь», «Сотрудники»,
  «Выдать роль», «Имя в панели», «Роль» (Администратор / Модератор / Организатор), «Статус» (Активен / Роль снята),
  «Изменить роль», «Снять роль» («Сессии панели сотрудника завершатся. Доступ к приложению сохранится.»), «Журнал
  действий», «Нет доступа к разделу», «Обратитесь к администратору панели.», «Страница не найдена».

# 8. Risks / Assumptions / Open Questions

- **Пароль приложения = доступ к панели (главный риск модели D-13).** Кто узнал пароль райдера-сотрудника (фишинг,
  повтор пароля с других сайтов, утечка), тот входит и в панель; сброс пароля по ссылке из почты сотрудника тоже даёт
  панель. Отдельная сессия и повторный ввод пароля защищают от **кражи сессии** приложения (токен телефона, cookie
  refresh, access в памяти — панель не открывают), но не от **кражи пароля**. Компенсации слайса: общие лимиты входа,
  короткая сессия (2 ч / 12 ч), мгновенное погашение сессий панели при смене пароля (штамп), журнал входов. **До
  прода — обязательна 2FA (TOTP) для `admin`** (рекомендуется и для `moderator`: видит журнал, позже — биометрию в
  спорах) — отдельный слайс (Q5); до него в панель не допускаются внешние организаторы.
- **Тот же домен `/admin/` в проде (C3, принятый риск, Q13).** XSS в web приложения райдера (тот же origin) может
  слать same-origin запросы к `/v1/admin/*`: если в этом браузере открыта сессия панели, cookie уйдёт, а Fetch Metadata
  покажет `same-origin` — CSRF-защита не спасает. Компенсации: строгий CSP панели (этот слайс) и web приложения
  (отдельная задача **до прода**, §4), cookie панели с узким путём `/v1/admin` и `SameSite=Strict` (не уходит ни на
  `/v1/auth/*`, ни с чужих сайтов), повторный пароль при входе в панель, короткая сессия панели, журнал; рекомендация
  в runbook — работать в панели в отдельном профиле браузера. Пересмотр — отдельный хост панели, если появится
  пользовательский HTML/Markdown в web приложения или 2FA не успевает к проду.
- **Удаление аккаунта (будущее).** Гард отказывает удалённому сразу; задача удаления обязана снять роль
  (`panel_members` → `revoked`/удаление) и отозвать `panel_sessions` — записать в `pokatim-db.md`. Последний
  администратор, удаливший аккаунт, — панель без админа → восстановление CLI.
- **Неподтверждённый с верным паролем в панели** перевыпускает токен регистрации (как вход приложения) — прежний на
  другом устройстве перестаёт действовать (ADR-0005, принято).
- **Общие счётчики лимитов** со входом приложения: перебор через панель блокирует и вход приложения этого адреса на
  ≤ 15 мин (и наоборот) — принято ради того, чтобы панель не удваивала число попыток.
- **Append-only на уровне БД** — пользователь MongoDB с `readWrite`; запрет держит код и тест-сторож; роль БД —
  follow-up.
- **Компоненты панели в проекте (C4)** — исключение §4.11 до F6.
- **Safari и `Secure` cookie на `http://localhost`** в `pnpm dev` — может не сохраниться; dev-проверка — Chromium/Firefox.
- `[ASSUMPTION]` Экраны вне макетов (§7 «Тексты»), раскладка «Сотрудники»/«Журнал» по образцу таблиц макета; пункты
  «Сотрудники» и «Журнал» — нижняя группа сайдбара над блоком сотрудника.

# 8.1 Requirements Consistency

Architecture Review — admin-01-foundation (ревизия 2 после ответов автора 2026-10-25). **Status: CONCERNS** — блокеров
нет; принятые автором риски (C1 — пароль приложения даёт панель до 2FA; C3 — тот же домен) записаны в §8, §8.3 и
ADR-0009 с обязательными до прода follow-ups (2FA для admin, CSP web приложения). R — решения архитектора, оркестратор
может переиграть.

**Конфликты и недоопределённость**

- **C1. Один аккаунт (D-13) против изоляции панели.** Решено автором: один аккаунт. Изоляция от кражи **сессии**
  приложения — отдельная сессия и повторный пароль (R1); от кражи **пароля** — только 2FA (до прода). Отменённое
  решение «отдельные служебные аккаунты» (дизайн F6 §7) — пометить в `design.md` §7 (§10).
- **C2. Прототип: «роли организатора здесь нет»** — автор оставил три роли; `organizer` в слайсе 1 — только «Обзор».
- **C3. Тот же домен в проде** — принятый риск (§8).
- **C4. `AGENTS.md` §4.11: общие компоненты — в базе.** Каркас, таблица, диалог причины — `apps/admin/src/ui` без
  доменных импортов, вынос в `admin-kit` в F6 (Q14). Альтернатива — сначала релиз базы — блокирует слайс при одном
  потребителе.
- **C5. Сброс пароля в макете — в панели (3b), автор — общий сброс приложения (Q11).** «Забыли пароль?» ведёт в web
  приложения (тот же домен); ссылка из письма открывает web/приложение, а не панель. Текст прототипа «вы выйдете на
  всех устройствах — в приложении и в панели» верен: сброс гасит и сессии панели (штамп).
- **C6. Append-only** — код + тест, роль БД — follow-up.

**Решения архитектора**

- **R1. Сессия панели.** (а) **Отдельная серверная непрозрачная сессия в cookie `__Secure-pokatim_admin_sid`,
  `Path=/v1/admin`, проверка на каждом запросе** (сессия + аккаунт + штамп + роль): вход только паролем, кража
  сессии приложения не даёт панели, снятие роли/сброс пароля/удаление действуют сразу, токенов в JS нет; (б) access JWT
  приложения + `AuthGuard` + проверка роли — переиспользование, но любой украденный access/refresh приложения (в том
  числе с телефона) открывает панель, срок — 180 дней; (в) «step-up»: сессия приложения + повторный пароль раз в N
  часов — та же поверхность, что (б), плюс сложность. **Рекомендую (а)** — ADR-0009.
- **R2. Данные и штамп.** Роль — коллекция `panel_members` (`_id` = userId) модуля `panel`, а не поле `users`: другой
  контекст, без записи в зону R1 identity, единственный писатель. Связь с учётными данными — штамп (HMAC хеша пароля),
  который identity отдаёт портом: смена пароля гасит сессии панели без записи из identity в `panel` (без события,
  без цикла модулей) и закрывает гонку «вход ↔ сброс». Альтернативы: событие outbox `identity.password-changed` →
  отзыв сессий панели (асинхронно, окно секунд, событийная связь ради одной проверки); поле `credentialsVersion` в
  `users` (правка всех путей смены пароля). **Рекомендую штамп.**
- **R3. Лимиты входа панели** — те же счётчики `signin-*`, что у приложения (один пароль — одна цель перебора);
  отдельные — удвоили бы попытки. Минус — взаимная блокировка на ≤ 15 мин (§8).
- **R4. «Приглашение».** (а) **Выдать роль существующему подтверждённому пользователю по e-mail** (админ знает
  адрес; неизвестный — понятная ошибка «попросите зарегистрироваться»); (б) приглашение на регистрацию — ожидающая
  выдача по адресу, применяется после подтверждения e-mail (событие identity → panel, TTL, письмо) — follow-up, когда
  понадобится массовое подключение; (в) ссылка-приглашение, по которой пользователь сам «принимает» роль — лишний шаг
  без выигрыша безопасности. **Рекомендую (а)** сейчас. Раскрытие «есть ли аккаунт» — только администратору
  (доверенная роль), запись в журнал.
- **R5. Письма в слайсе 1 — нет** (выдача роли — устно/в мессенджере команды); уведомление «Вам выдан доступ к панели» —
  follow-up вместе с R4(б) (очередь и шаблон). Плюс сейчас — нет `ADMIN_LINK_BASE` и worker-части.
- **R6. Совместимость enum** — `PanelRole`, `Permission`, `AuditAction` только дополняются; SPA обновляется с деплоем.
- **R7. «Последний администратор»** — write skew по нескольким документам: транзакции, меняющие набор активных
  админов, первой операцией пишут `panel_meta.admins` (`$inc version`); int-тест с воротами и отрицательным
  доказательством. CLI — тот же замок.
- **R8. Журнал** — модуль `panel`, `PanelAudit.append(tx, …)` экспортируется будущим модулям панели; доменные
  append-only истории (пересчёты, споры) — в своих модулях. Входы/выходы панели — пишем (без IP/UA); неудачные
  попытки и «Нет доступа к панели» — нет (не член команды, шум).
- **R9. Роутер** — TanStack Router (типизированные search-параметры фильтров/сортировки в URL, `beforeLoad`, один
  вендор с Query/Table); альтернатива — React Router v7. Версии и API — context7 при реализации.
- **R10. Подмена по прототипу без переделки** — тексты `admin.*`, навигация `src/navigation.ts`, раскладка `src/ui`.
- **R11. Нумерация** — ADR-0009, миграция `0005_panel` (слайс 4 слит: ADR-0008, `0004_profile`).

**Конфликтов с инвариантами `AGENTS.md` §4 нет** при C4 как явном исключении §4.11 до F6: §4.1 — роль и права
считает сервер на каждом запросе; §4.2 — контракты первыми; §4.3 — `panel` → `identity/index.ts`, обратной связи нет;
§4.4 — пакетов нет; §4.5 — асинхронной работы нет; §4.6 — миграция шагом деплоя, expand-only; §4.7 — UTC/Минск;
§4.8 — секретов не добавляется; §4.9 — внешних сервисов нет; §4.10 — `panel_audit` append-only; §4.12 — скелетоны;
§4.13 — панель desktop (ADR-0003 п. 6).

### Открытые вопросы автору (по умолчанию — рекомендация)

| # | Вопрос | Рекомендация |
|---|---|---|
| N1 | Уведомлять пользователя письмом о выдаче/снятии роли | Не в слайсе 1; вместе с приглашением на регистрацию (R4б, R5) |
| N2 | Выдача роли адресу без аккаунта | Ошибка «попросите зарегистрироваться» сейчас; приглашение на регистрацию — follow-up |
| N3 | 2FA — для кого обязательна | `admin` — обязательно до прода; `moderator` — рекомендуется (журнал, позже биометрия в спорах) |

# 8.2 Deviations from spec

**Решения автора 2026-10-25 (ответы на Q ревизии 1):**

- **Q1 → модель D-13:** вход в панель тем же e-mail и паролем, что в приложении; один аккаунт на человека, роль
  выдаётся пользователю приложения; прежнее решение «отдельные служебные аккаунты» (дизайн F6 §7) отменено; экраны
  «участник без роли» и «E-mail не подтверждён» — как в прототипе. Изоляция от кражи сессии приложения — отдельная
  сессия панели + повторный пароль; 2FA для admin — до прода.
- **Q2:** все права у `admin`; `moderator` — дополнительно `audit.read`; `organizer` — только «Обзор».
- **Q3:** выдаёт, меняет и снимает роли только `admin`.
- **Q5:** 2FA — отдельный слайс до прода.
- **Q6:** сессия панели — простой 2 ч, абсолют 12 ч.
- **Q9:** название — «Панель команды платформы» (прототип) вместо «Панель организатора».
- **Q10:** CLI `grant-admin` разрешён и при существующих админах (аварийное восстановление), с записью журнала.
- **Q11:** сброс пароля — общий сброс приложения (слайс 3), своего в панели нет.
- **Q12:** журнал видят `admin` и `moderator`; хранится бессрочно; входы/выходы пишутся, неудачные попытки — нет.
- **Q13:** прод — тот же домен `/admin/`; риск C3 принят с компенсациями (§8, §8.3, ADR-0009).
- **Q14:** сначала pokatim, вынос в базу (F6) после слайса 2 панели.
- **Q15:** причина обязательна при смене и снятии роли; выдача — без причины.
- **Q16:** отображаемое имя в панели вводит админ при выдаче роли; e-mail — из аккаунта приложения.
- **Q17:** новые токены размеров панели (окно входа 400, диалог 420, колонка формы 560, правая колонка 330) — задачей в
  app-foundation (`density.compact`), релиз до S5; если не успевает — временно в `@pokatim/design-tokens` с follow-up.
- Q7 (срок ссылок) и Q8 (политика пароля сотрудника) — сняты: ссылок приглашения нет, пароль — политика приложения.

**Решения оркестратора 2026-10-25 (N1–N3 §8.1, Q17 — до реализации):**

- **N1:** письма о выдаче/снятии роли нет — follow-up вместе с приглашением на регистрацию (R4б, R5).
- **N2:** выдача роли адресу без аккаунта — понятная ошибка `404 NOT_FOUND` «попросите зарегистрироваться в
  приложении»; приглашение — follow-up.
- **N3:** 2FA (TOTP) обязательна для `admin` до прода — отдельный слайс; для `moderator` — рекомендуется.
- **Q17 (уточнение):** токенов размеров панели (окно входа 400, диалог 420, колонка формы 560, правая колонка 330) в
  `@rkarakulov/design-tokens` нет — задаются локально в `apps/admin` отдельным модулем (`src/panel-tokens.ts`, CSS-
  переменные `--panel-*`, без hex) с TODO; follow-up «вынести в базу» — §12. Слайс не блокируется.

_Отклонения при реализации — дописываются ниже._

**Отклонения при реализации (coder, 2026-10-25):**

- **D1. `@tanstack/react-table` ^8.21** вместо свежей 9.x: 9 — новый мажор с другим API (features/atoms), документации
  офлайн нет (context7 недоступен); 8.x — стабильный API `useReactTable`. Переход на 9 — follow-up.
- **D2. `eslint-disable-next-line react-hooks/incompatible-library`** в `apps/admin/src/ui/DataTable.tsx`: правило
  React Compiler сообщает (warning), что `useReactTable` несовместим с мемоизацией, и само пропускает компонент; при
  `--max-warnings=0` это ломает lint. Точечное отключение с комментарием — **вопрос оркестратору** (альтернатива —
  исключение правила для `apps/admin/src/ui/DataTable.tsx` в пресете базы).
- **D3. Первый визит без сессии** — «Вход в панель» без «Сессия истекла» (§7 предлагал `reason=expired` уже в
  `beforeLoad`): иначе первый вход всегда показывал бы «Сессия истекла». «Сессия истекла» — после 401 при уже
  открытой сессии (глобальный обработчик). `next` сохраняется в обоих случаях.
- **D4. `AuditQuery`** — `z.strictObject({ ...PageQuery.shape, … })` вместо `PageQuery.extend`: лишние параметры
  (`action[$ne]=…`) — 400, а не тихое отбрасывание.
- **D5. `createAdminApiClient.health()`** — статус API на «Обзоре» (прежняя заглушка `App.tsx` удалена); панель
  ходит в API только этим клиентом.
- **D6. Модуль `IdentityAccountsModule`** (репозиторий + `IdentityAccounts`; его импортируют `IdentityModule` и CLI):
  один экземпляр `IdentityRepository` в приложении — без него spy в гоночных int-тестах identity попадал не в тот
  экземпляр. Тесты `IdentityAccounts` — в `panel-credentials.int.test.ts` (отдельного `identity-accounts.int.test.ts`
  нет). Из `identity/index.ts` дополнительно экспортированы `randomToken`, `sha256`.
- **D7. CLI:** окружение — `cliEnv` (только `MONGO_URL` и `EMAIL_TOKEN_SECRET`, без Redis/SMTP/JWT); разбор и
  выполнение — `apps/api/src/cli/panel-cli.ts` (тестируемая функция), вход — `panel.ts`. Активный член с другой ролью
  CLI повышает до `admin` (журнал `role_granted { roleFrom, roleTo: 'admin' }`). Смоук вызывает CLI из `dist`.
- **D8. Смена роли на ту же** — 200 без изменения и без записи журнала.
- **D9. `POST /admin/session/sign-out` — `@Public()`** (идемпотентный выход и при погашенной сессии); запись
  `panel.signed_out` — только при отзыве живой сессии. Публичные маршруты панели: вход и выход (тест).
- **D10. UI-контракты расширены:** `NavItem.group` (основная/нижняя группа сайдбара); `DataTable` — `TableQuery`
  (подходит и `useInfiniteQuery`), `filter`, `noMatches`, `caption`, `renderError`, `footer`, `initialSorting`.
  «Войти» неактивна при пустом пароле во всех состояниях, не только «Сессия истекла».
- **D11. Q17** — `apps/admin/src/panel-tokens.ts` (`--panel-auth-card-width 400`, `--panel-dialog-width 420`,
  `--panel-form-width 560`, `--panel-rail-width 330`) с TODO.
- **D12. CSP проверяется смоуком:** `vite preview` отдаёт CSP из `infra/docker/admin-nginx.conf` (разбор `set
  $panel_csp`), e2e проверяет заголовок и отсутствие ошибок консоли. `pnpm e2e:admin` — шагом job `web` CI (те же
  MongoDB, Redis, Mailpit, собранный API). Dev-стенд (`infra/deploy`) уже отдавал панель на `/admin/` — не менялся.
- **D13. 403 глобально** — перечитать `me` (роль могла смениться), экран сам показывает «Нет доступа к разделу».
- **D14 (ревью pass 1, `findings.md`).** Выход завершается только при успехе ответа (иначе баннер с повтором); запрос
  на паузе без сети — «Нет соединения» (таблицы, «Обзор»), «кто я» — `networkMode: 'always'`; «Обзор» — «Данные
  могли устареть» при ошибке обновления; cookie панели — свой `requestCookie` (без глубокого импорта Nest); выход
  погашенной сессией — отзыв с причиной гарда без `panel.signed_out` (`PanelSessionCheck`); предел списка —
  `PANEL_MEMBER_LIST_CAP` контракта. D2 — оставлен по решению оркестратора.

# 8.3 Security checklist

Затронуты аутентификация и сессии (порт входа identity, новая сессия панели), роли и права, персональные данные
(e-mail сотрудников в списке), инфраструктура (Caddy, nginx, CI), CLI на сервере — `security.md`,
`pokatim-security.md` (`paths:` дополнить `modules/panel/**`, `apps/api/src/cli/**`, `apps/admin/src/session/**`).

1. **AuthN/AuthZ.** Все `/v1/admin/*`, кроме `session/sign-in`, — под `PanelGuard` (тест обходит маршруты контроллеров
   `panel`: без гарда и без явного `@Public()` — красный). Вход в панель — только паролем (`PanelCredentials`), сессия
   приложения не принимается (ни `Authorization: Bearer`, ни cookie `__Secure-pokatim_rt`). Гард на каждом запросе:
   сессия панели жива → аккаунт приложения не удалён и подтверждён → штамп учётных данных совпадает → член команды
   `active` → права роли (карта — только в коде сервера); `Can` в UI — только отображение. Пользователь запроса — из
   сессии (`@CurrentPanelUser()`), цель — `Uuid` из пути; себя менять нельзя; последнего админа убрать нельзя (R7).
   Cookie — `HttpOnly; Secure; SameSite=Strict; Path=/v1/admin`, без `Domain`; простой 2 ч, абсолют 12 ч; снятие роли
   отзывает сессии панели в той же транзакции; сброс пароля гасит их штампом. CSRF — глобальный Fetch Metadata +
   Origin. **Принятый риск C3 (тот же домен):** XSS web приложения может действовать от имени открытой в том же
   браузере сессии панели — компенсации: CSP панели (здесь) и web приложения (до прода), узкий путь cookie,
   SameSite=Strict, повторный пароль, короткая сессия, журнал; 2FA для `admin` — до прода. CLI — только с доступом к
   контейнеру.
2. **Входные данные.** Тела — `z.strictObject` контрактов; `email` — `Email` + `normalizeEmail`; пароль —
   `SignInPassword` (≤ 128 до argon2); имя и причина — длины, без управляющих символов; роль, право, действие — enum;
   `userId`, `cursor` — `Uuid`; cookie — `OpaqueToken`; в фильтры Mongo — только примитивы после zod (int-тест
   `{ "$ne": null }` в теле, query и cookie). Лимит тела — общий 64 KiB.
3. **Данные наружу.** `PanelMe` — id, имя в панели, e-mail, роль, права; список сотрудников — только
   `members.read` (admin); ни хешей, ни штампа, ни `version`; журнал — без e-mail, IP, UA; «Нет доступа к панели»
   повторяет только введённый адрес и только после верного пароля; `Cache-Control: no-store` на `/v1/admin/*`; CSP
   панели (nginx `admin`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self';
   img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';
   object-src 'none'` (inline — только `<style>` дизайн-системы).
4. **Злоупотребления.** Вход — те же лимиты и HMAC-ключи, что у приложения (IP → e-mail+IP → e-mail, до argon2,
   429 одинаков), неверный пароль / неизвестный / удалённый — один 401 с пустышкой; «Нет доступа к панели» и
   `verificationRequired` — только после верного пароля (нового оракула нет: вход приложения раскрывает то же);
   повтор письма подтверждения — существующие лимиты resend; выдача роли — только `admin`, раскрытие «есть ли аккаунт» —
   только ему, с записью в журнал; открытой регистрации в панель нет.
5. **Секреты и логи.** Новых секретов и env нет (штамп — HMAC на `EMAIL_TOKEN_SECRET` с назначением
   `credentials:`); токен сессии — только sha256 в БД; логи — `userId`, `sid`, причина отзыва; без e-mail, имён,
   паролей, токенов, IP; CLI не печатает e-mail.
6. **Аудит.** `panel_audit` append-only (только `insertOne`, тест-сторож на update/delete в `panel.repository.ts`):
   выдача роли (в том числе CLI), смена роли (from/to), снятие роли, вход и выход в панель — кто (пользователь/cli),
   что, когда, над кем, причина; запись — в транзакции действия. Роль БД без update/remove — follow-up.

# 9. Acceptance Criteria

1. **CLI:** `grant-admin --email --name` для подтверждённого пользователя → член команды `admin`, журнал
   `panel.role_granted` с актором `cli`; неизвестный или неподтверждённый адрес → код выхода 2 без изменений и без
   e-mail в выводе; повтор для уже `admin` → код 0 без новой записи.
2. **Вход в панель:** активный член команды с верным паролем → 200 `signedIn` + `PanelMe` + cookie (атрибуты §8.3),
   запись `panel.signed_in`; неверный пароль, неизвестный и удалённый адрес → `401 INVALID_CREDENTIALS` с телом, побайтно
   равным ответу входа приложения; верный пароль без роли или с `revoked` → `403 PANEL_ACCESS_DENIED`, сессии нет;
   неподтверждённый с верным паролем → `verificationRequired` с токеном регистрации, с которым
   `/v1/auth/verification/resend` работает; попытки панели и приложения расходуют одни счётчики (6-я попытка пары
   e-mail+IP за 15 мин суммарно → 429 до проверки пароля); прежняя cookie панели при входе отзывается.
3. **Изоляция:** `GET /v1/admin/session/me` с живым access JWT приложения в `Authorization` и с refresh-cookie
   приложения, без cookie панели → 401; cookie панели не уходит на `/v1/auth/session/*` (путь); `Sec-Fetch-Site:
   cross-site` на `POST /v1/admin/*` → 403.
4. **Сессия:** `me` с живой cookie → 200; мусор, отозванная, истёкшая по простою (CLOCK + 2 ч без запросов) и по
   абсолюту (12 ч при активности), после снятия роли, после сброса пароля приложения (слайс 3), после пометки аккаунта
   удалённым → `401 UNAUTHORIZED` одним телом и сброс cookie; выход → 204, cookie сброшена, сессия отозвана, запись
   `panel.signed_out`. Гонка: вход в панель проверил старый пароль (ворота перед вставкой сессии) ↔ сброс пароля
   закоммичен → выданная сессия на первом запросе 401 (**отрицательное доказательство:** без сверки штампа — 200).
5. **Права:** `organizer` — `GET /admin/members`, `GET /admin/audit`, мутации → 403; `moderator` — `GET /admin/audit`
   → 200, `members` → 403; `admin` → 200; каждый маршрут `panel` — под гардом или явно публичный (тест).
6. **Выдача роли:** admin выдаёт роль подтверждённому пользователю → `active`, журнал `role_granted`; неизвестный адрес
   → 404, неподтверждённый → 409 `PANEL_USER_UNVERIFIED`, уже член → 409 `PANEL_ALREADY_MEMBER`; повторная выдача после
   снятия → `active` с новой ролью; два параллельных `grant` одного пользователя → один документ, одна запись журнала.
7. **Смена и снятие роли:** с причиной → роль сменена (права — со следующего запроса без перевхода) / снята (все
   сессии панели пользователя отозваны в той же транзакции, сессия приложения жива); себе → 409 `PANEL_SELF_ACTION`;
   последнего активного админа понизить/снять → 409 `PANEL_LAST_ADMIN`; два админа параллельно снимают друг друга →
   ровно одно изменение (**отрицательное доказательство:** без `lockAdmins` — 0 админов); без причины → 400.
8. **Журнал:** каждое действие AC1, 2, 4 (выход), 6, 7 даёт ровно одну запись (кто, что, когда по CLOCK, над кем,
   причина); откат транзакции после `append` — записи нет; `GET /admin/audit` — новые сверху, курсор, фильтры; e-mail
   и IP нет ни в документе, ни в ответе; тест-сторож: в репозитории нет update/delete `panel_audit`.
9. **Панель — вход:** `/admin/` без сессии → «Вход в панель» («Покатим», «Панель команды платформы»); состояния:
   неверные данные — баннер «Неверный e-mail или пароль»; «Нет доступа к панели» с введённым адресом и «Войти другим
   аккаунтом»; «E-mail не подтверждён» — «Отправить письмо ещё раз» с отсчётом и «Вернуться ко входу»; «Слишком много
   попыток» — поля неактивны до конца паузы; «Сессия истекла» после 401 — после входа возврат на исходную страницу
   (`next` с чужим origin или `//` отбрасывается); «Забыли пароль?» ведёт на `/forgot-password` приложения.
10. **Панель — каркас:** после входа — сайдбар (пункты по правам: admin — «Обзор», «Сотрудники», «Журнал действий»;
    moderator — «Обзор», «Журнал действий»; organizer — «Обзор»), внизу имя · роль · «команда платформы» и «Выйти»;
    прямой URL без права → «Нет доступа к разделу»; неизвестный путь → «Страница не найдена».
11. **Панель — «Сотрудники»:** плотная таблица (имя, e-mail, роль, статус, выдана; сортировка с `aria-sort`, фильтр
    статуса и роли, поиск, фиксированная шапка); загрузка — скелетон строк под видимой шапкой и фильтрами; ошибки —
    §4.12; «Выдать роль» — диалог-форма (e-mail, имя в панели, роль; 404/409 — под полем e-mail); «Изменить роль»,
    «Снять роль» — диалог с обязательной причиной (подтверждение неактивно без причины, Esc, фокус на поле, возврат
    фокуса; «Снять роль» — разрушительный вариант); своя строка — без действий.
12. **Панель — «Журнал действий»:** таблица (время Europe/Minsk, кто, действие словами, над кем, причина), фильтр
    действия, «Показать ещё» по курсору.
13. **Миграция** `0005_panel` на чистой БД и повторно — без ошибок; коллекции, индексы и документ `panel_meta.admins`.
14. **Infra:** ответы `/admin/` (nginx `admin`) — CSP §8.3; Caddy прода — `/admin/*` на `PUBLIC_HOST`, блока
    `ADMIN_HOST` нет; `caddy validate` проходит.
15. **E2E (Playwright, Chrome, `/admin/`):** два пользователя зарегистрированы и подтверждены через API + Mailpit →
    CLI `grant-admin` первому → вход в панель → «Сотрудники» → выдать второму `moderator` → вход второго: «Журнал»
    виден, «Сотрудники» по URL — «Нет доступа к разделу» → первый снимает роль с причиной → следующий запрос второго —
    «Сессия истекла», повторный вход — «Нет доступа к панели» → журнал содержит записи; `pageerror`/`console.error`
    пусты, кроме согласованных 401/403.
16. Регрессия: int-тесты входа приложения (`sign-in`, `identity-races`, `password-reset`, `auth-guard`) — зелёные без
    правок ожиданий; `pnpm check` зелёный; int-тесты на реальном MongoDB RS + Redis.

# 10. Documentation Impact

- **ADR-0009** «Доступ к панели «Протокол»: роль на аккаунте приложения, отдельная серверная сессия панели с повторным
  паролем, штамп учётных данных, права ролей, журнал; тот же домен `/admin/` — принятый риск» (R1–R3, R7, R8, C1, C3;
  обязательные до прода: 2FA для admin, CSP web приложения; пересмотр — отдельный хост, F6) + строка в
  `docs/adr/README.md`; ADR-0003 — «Реализация (admin-01)»: сессия панели серверная, не JWT; ADR-0005 — «Пересмотр
  (admin-01)»: проверка учётных данных вынесена в общую функцию, панель делит счётчики входа; ADR-0006 — сброс пароля
  гасит и сессии панели (штамп).
- `docs/architecture/README.md` — модуль `panel` (коллекции, сессия, гард, права, журнал), порт identity
  `PanelCredentials`/`IdentityAccounts`, поток «вход в панель», `apps/admin` (роутер, сессия, `ui`).
- `docs/product/admin-panel.md` (новый) — ответы автора (§8.2), роли и матрица прав (текущая и плановая), карта
  разделов (Приложение A кратко, без содержимого макетов) + строка в `docs/product/README.md`.
- `docs/tasks/2026-10-22-app-foundation/design.md` §7 — «Модель отдельных служебных аккаунтов отменена для pokatim
  (2026-10-25, admin-01): роль на аккаунте приложения + отдельная сессия панели; для F6 — пересмотреть модель базы».
- `.claude/rules/pokatim-web.md` — роутер и гард, `Can`/`useCan`, `src/ui` обязателен для новых экранов, навигация в
  `src/navigation.ts`, общая обработка 401/403, кандидаты в `admin-kit`.
- `.claude/rules/pokatim-security.md` — `paths:` + `modules/panel/**`, `apps/api/src/cli/**`,
  `apps/admin/src/session/**`; правила: вход в панель только паролем через порт identity, `PanelGuard` + штамп, роль —
  на каждом запросе, последний админ, принятый риск того же домена и обязательные до прода 2FA/CSP.
- `.claude/rules/pokatim-backend.md` — контекст `panel`; новые эндпоинты панели — `PanelGuard` + `RequirePermission` +
  `PanelAudit` в транзакции действия.
- `.claude/rules/pokatim-db.md` — `panel_members` (`_id` = userId), `lockMember`/`lockAdmins`, `panel_audit`
  append-only, удаление аккаунта снимает роль и отзывает сессии панели.
- `docs/runbooks/deploy.md` — миграция `0005_panel`, Caddy прода (`/admin/` на основном хосте), «Первый
  администратор»: зарегистрироваться в приложении и подтвердить e-mail → `dc exec api node dist/cli/panel.js
  grant-admin --email … --name …`, аварийное восстановление; рекомендация — панель в отдельном профиле браузера.
  `docs/runbooks/local-dev.md` — панель локально (`pnpm dev --filter=@pokatim/admin`, CLI через `tsx`, Safari и
  `Secure` cookie), `pnpm e2e:admin`.
- `AGENTS.md` §3 — команда `pnpm e2e:admin`.

# 11. Implementation Context

Уровень — task3 (контракты, правка identity в зоне безопасности, новый модуль и миграция, права, infra, CI, новое
веб-приложение). Слайсы — по коммиту, проверка после каждого обязательна. Ветка — от `develop` (слайс 4 слит).

### ENTRY POINTS
- API: `apps/api/src/modules/panel/{panel-session.controller,panel-members.controller,panel-audit.controller}.ts`,
  `panel.guard.ts`; identity — `panel-credentials.ts`, `identity-accounts.ts`; CLI `apps/api/src/cli/panel.ts`.
- Admin: `apps/admin/src/main.tsx` → `router.tsx`; экраны `src/features/{sign-in,overview,members,audit}`.

### Слайсы и проверка после каждого
| # | Что | Проверка |
|---|---|---|
| **S1** | Contracts: `admin/{permissions,session,members,audit}.schema.ts` (+ tests), коды ошибок в конец `common.ts`, экспорт; api-client `admin.ts` (`createAdminApiClient`, + test); тексты кодов в `error-messages.ts` | TDD; `pnpm --filter @pokatim/contracts test`, `--filter @pokatim/api-client test`, `pnpm typecheck` |
| **S2** (после S1) | identity: выделить проверку учётных данных из `SignInService` (`credentials-check.ts`), `PanelCredentials`, `IdentityAccounts` (`accountState`, `findVerifiedByEmail`, `emailsOf`), штамп `credentialsStamp` в `tokens.ts`, `IdentityModule.exports`, `index.ts` | регрессия `sign-in.int`, `identity-races.int`, `password-reset.int`, `auth-guard.int` без правок ожиданий; новые int `panel-credentials.int.test.ts` (одинаковое тело 401, общие счётчики, `verificationRequired`, штамп меняется при сбросе); `pnpm arch:check` |
| **S3** (после S2) | panel данные: `panel.collection.ts`, миграция `0005_panel`, `panel.repository.ts` (`lockMember`, `lockAdmins`, члены, сессии, `insertAudit`), `permissions.ts` (`defineRoles`), `panel.policy.ts`, `PanelAudit`; CLI `grant-admin` + `PanelCliModule`, сборка `dist/cli` | int: миграция на чистой и повторно, CLI на `*_test` (AC1), тест-сторож append-only; `pnpm build --filter @pokatim/api` и `node dist/cli/panel.js --help` |
| **S4** (после S3) | panel сессия и права: вход/выход/`me`, `PanelSessionCookie`, `PanelGuard` + `RequirePermission` + `CurrentPanelUser` + `Public`, `no-store`, `PanelModule` в `app.module.ts`, тест «все маршруты под гардом» | int AC2–AC5, гонка «вход ↔ сброс» с отрицательным доказательством; Security п. 1, 2, 4, 5 — тестами; `pnpm check` |
| **S5** (после S4) | panel сотрудники и журнал: `grant`, `role`, `revoke`, `GET members` (+ `emailsOf`), `GET audit` | int AC6–AC8: ворота на `lockAdmins`/`lockMember`, параллельные операции, отрицательное доказательство R7 (в §12), инъекция; `pnpm check` |
| **S6** (после S1; параллельно S2–S5) | Admin основа: зависимости, `router.tsx` (basepath), `api.ts`, `session/{use-me,guard,can}`, `ui/*`, `navigation.ts`, экраны «Вход» со всеми состояниями, «Обзор», «Нет доступа к разделу», «Не найдено»; строки `ru.ts`; токены (Q17) | `pnpm --filter @pokatim/admin test` (vitest jsdom, `TZ=Europe/Minsk`), `typecheck`, `ADMIN_BASE=/admin/ pnpm --filter @pokatim/admin build`; ESLint без hex |
| **S7** (после S5, S6) | Admin экраны «Сотрудники» (таблица, диалоги выдачи/смены/снятия), «Журнал действий»; заглушку `App.tsx` убрать (статус API — в «Обзор», §8.2) | vitest экранов (AC9–AC12 на моках api); `pnpm check` |
| **S8** (после S7) | Infra и e2e: CSP и `no-store` в `admin-nginx.conf`, Caddy прода (`/admin/*` → `admin:8080` на `PUBLIC_HOST`, без `ADMIN_HOST`), `docker-compose.prod.yml`; `apps/admin/{playwright.config.ts,e2e/*}`, `pnpm e2e:admin`, шаг CI (API + worker + Mailpit + CLI); docs §10, ADR-0009 | `pnpm --filter @pokatim/admin e2e` с `pnpm infra:up` — зелёный (AC15); `docker build --target admin` + `curl -I` (AC14); `caddy validate`; `pnpm check` |

Параллель: S2–S5 — только `apps/api/**`; S6–S7 — только `apps/admin/**`, `packages/i18n/src/ru.ts` (и
`packages/design-tokens`, если Q17 — временно в проекте). `packages/contracts`, `api-client` — только S1;
`pnpm-lock.yaml` — только S6 и S8 (последовательно).

### FILES TO MODIFY
| Файл | Слайс | Изменение |
|---|---|---|
| `packages/contracts/src/admin/{permissions,session,members,audit}.schema.ts` (новые, + tests), `src/common.ts`, `src/index.ts` | S1 | схемы §TYPES, 5 кодов ошибок в конец |
| `packages/api-client/src/admin.ts` (новый, + `admin.test.ts`), `src/index.ts` | S1 | `createAdminApiClient` |
| `apps/api/src/error-messages.ts` | S1 | тексты 5 кодов (typecheck) |
| `apps/api/src/modules/identity/credentials-check.ts` (новый), `sign-in.service.ts` (использует его) | S2 | общая проверка учётных данных |
| `apps/api/src/modules/identity/{panel-credentials,identity-accounts}.ts` (новые, + `panel-credentials.int.test.ts`, `identity-accounts.int.test.ts`) | S2 | порт для панели |
| `apps/api/src/modules/identity/{tokens.ts,identity.repository.ts,identity.module.ts,index.ts}` | S2 | `credentialsStamp`, чтения по `_id`/`$in`, экспорт |
| `apps/api/src/modules/panel/{panel.collection,panel.repository,panel.policy,permissions,panel-audit,index}.ts` (новые, + tests) | S3 | данные, права, журнал |
| `apps/api/src/db/migrations/0005_panel.ts` (новый), `index.ts`, `migrations.int.test.ts` | S3 | коллекции, индексы, `panel_meta.admins` |
| `apps/api/src/cli/{panel.ts,panel-cli.module.ts}` (новые, + `panel-cli.int.test.ts`), `apps/api/package.json` (скрипт `panel` → `tsx src/cli/panel.ts`) | S3 | CLI |
| `apps/api/src/modules/panel/{panel-session.service,panel-session.controller,panel-session-cookie,panel.guard,require-permission.decorator,current-panel-user.decorator,public.decorator,panel.module}.ts` (новые, + `panel-session.int.test.ts`, `panel-routes.test.ts`) | S4 | сессия, гард, права |
| `apps/api/src/app.module.ts` | S4 | `PanelModule` |
| `apps/api/src/modules/panel/{panel-members.service,panel-members.controller,panel-audit.controller}.ts` (новые, + `panel-members.int.test.ts`, `panel-races.int.test.ts`, `panel-audit.int.test.ts`), `apps/api/test/panel.ts` (хелпер: подтверждённый пользователь, роль, вход, cookie) | S5 | сотрудники и журнал |
| `apps/admin/package.json`, `vite.config.ts` (`preview.proxy`), `index.html` (заголовок) | S6 | зависимости, превью |
| `apps/admin/src/{main.tsx,router.tsx,api.ts,navigation.ts}`, `src/session/*`, `src/ui/*`, `src/features/{sign-in,overview,no-access,not-found}/*`, `src/index.css` (+ tests) | S6 | основа панели |
| `packages/i18n/src/ru.ts` | S6–S7 | `admin.*` (заголовок — «Панель команды платформы») |
| `apps/admin/src/features/{members,audit}/*` (+ tests); `src/App.tsx`, `App.test.tsx` — убрать | S7 | экраны |
| `infra/docker/admin-nginx.conf`, `infra/Caddyfile`, `infra/docker-compose.prod.yml` | S8 | CSP, `/admin/` на основном хосте |
| `apps/admin/{playwright.config.ts,e2e/admin.spec.ts,e2e/mailpit.ts,e2e/project.ts}` (новые), корневой `package.json` (`e2e:admin`), `.github/workflows/ci.yml` | S8 | смоук панели |
| docs §10 | S8 | — |

### FILES TO READ
`AGENTS.md` §2–§4; `.claude/rules/{web,pokatim-web,security,pokatim-security,backend,pokatim-backend,db,pokatim-db,
contracts,pokatim-contracts,tests,pokatim-tests}.md`; ADR-0003 (п. 4, 6, «Реализация»), ADR-0005, ADR-0006,
ADR-0007, ADR-0008; identity: `sign-in.service.ts` (порядок лимитов, пустышка, `lockUserCredentials`,
`verificationRequired`), `session-cookie.ts`, `auth.guard.ts` (`request.auth` — не пересекаться),
`identity.repository.ts` (`findCredentialsByEmail`, проекции), `tokens.ts`; `modules/profile/*` (`_id` = userId);
`apps/api/test/{harness,identity}.ts` (`gate()`, `holdTransaction`, регистрация и подтверждение); `apps/app/e2e/
{mailpit,project}.ts`, `apps/app/playwright.config.ts`; `infra/docker/{Dockerfile,admin-nginx.conf}`,
`infra/Caddyfile`; context7 — TanStack Router (basepath, `beforeLoad`, `redirect`, search), TanStack Table, react-hook-form
+ zod 4 resolver, Vite `preview.proxy`, NestJS `createApplicationContext`, Fastify cookie `path`, Caddy `handle`.

### TYPES & SCHEMAS
```ts
// packages/contracts/src/admin/permissions.schema.ts — значения только дополняются в конец (R6)
export const PANEL_ROLES = ['admin', 'moderator', 'organizer'] as const;
export const PanelRole = z.enum(PANEL_ROLES);
export const PERMISSIONS = ['members.read', 'members.manage', 'audit.read'] as const;
export const Permission = z.enum(PERMISSIONS);

// packages/contracts/src/admin/session.schema.ts
export const PANEL_SESSION_COOKIE = { name: '__Secure-pokatim_admin_sid', path: '/v1/admin' } as const;
export const PanelSignInRequest = z.strictObject({ email: Email, password: SignInPassword });
export const PanelMe = z.object({
  user: z.object({ id: Uuid, displayName: z.string(), email: z.string(), role: PanelRole }),
  permissions: z.array(Permission),
});
export const PanelSignInResponse = z.discriminatedUnion('state', [
  z.object({ state: z.literal('signedIn'), me: PanelMe }),
  z.object({ state: z.literal('verificationRequired'), registrationToken: RegistrationToken, email: z.string(),
    resendAvailableInSec: z.number().int().nonnegative() }),
]);
// POST /v1/admin/session/sign-in → PanelSignInResponse (+cookie) | 401 INVALID_CREDENTIALS | 403 PANEL_ACCESS_DENIED | 429
// POST /v1/admin/session/sign-out → 204; GET /v1/admin/session/me → PanelMe | 401

// packages/contracts/src/admin/members.schema.ts
export const MemberStatus = z.enum(['active', 'revoked']);
export const DisplayName = z.string().trim().min(1).max(80).regex(/^[^\p{Cc}]+$/u);
export const ActionReason = z.string().trim().min(3).max(500).regex(/^[^\p{Cc}]*(?:\n[^\p{Cc}]*)*$/u);
export const GrantRoleRequest = z.strictObject({ email: Email, displayName: DisplayName, role: PanelRole });
export const ChangeRoleRequest = z.strictObject({ role: PanelRole, reason: ActionReason });
export const RevokeRoleRequest = z.strictObject({ reason: ActionReason });
export const PanelMember = z.object({
  userId: Uuid, displayName: z.string(), email: z.string(), role: PanelRole, status: MemberStatus,
  grantedAt: z.iso.datetime(), revokedAt: z.iso.datetime().nullable(),
});
export const PanelMemberList = z.object({ items: z.array(PanelMember), truncated: z.boolean() });
// GET /v1/admin/members → PanelMemberList; POST /v1/admin/members → PanelMember (201)
// POST /v1/admin/members/:userId/role | /revoke → PanelMember

// packages/contracts/src/admin/audit.schema.ts
export const AUDIT_ACTIONS = ['panel.role_granted', 'panel.role_changed', 'panel.role_revoked',
  'panel.signed_in', 'panel.signed_out'] as const;
export const AuditAction = z.enum(AUDIT_ACTIONS);
export const AuditQuery = PageQuery.extend({ cursor: Uuid.optional(), action: AuditAction.optional(),
  actorUserId: Uuid.optional(), targetUserId: Uuid.optional() });
export const AuditEntry = z.object({
  id: Uuid, at: z.iso.datetime(), action: AuditAction,
  actor: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), userId: Uuid, displayName: z.string() }),
    z.object({ kind: z.literal('cli') }),
  ]),
  target: z.object({ userId: Uuid, displayName: z.string() }).nullable(),
  reason: z.string().nullable(),
  details: z.object({ roleFrom: PanelRole.optional(), roleTo: PanelRole.optional() }).nullable(),
});
export const AuditPage = z.object({ items: z.array(AuditEntry), nextCursor: Uuid.nullable() });

// common.ts — в конец defineErrorCodes: 'PANEL_ACCESS_DENIED', 'PANEL_USER_UNVERIFIED', 'PANEL_ALREADY_MEMBER',
// 'PANEL_LAST_ADMIN', 'PANEL_SELF_ACTION'
```

```ts
// apps/api/src/modules/identity (экспорт через index.ts)
export interface VerifiedCredentials { userId: string; email: string; credentialsStamp: string }
export type PanelCredentialsResult = { state: 'verified' } & VerifiedCredentials
  | ({ state: 'verificationRequired' } & RegisterResponse);
class PanelCredentials { verify(input: { email: string; password: string }, ip: string): Promise<PanelCredentialsResult> } // 401/429 — DomainError
class IdentityAccounts {
  accountState(userId: string): Promise<{ active: boolean; credentialsStamp: string } | undefined>; // active = не удалён и подтверждён
  findVerifiedByEmail(email: string): Promise<{ userId: string; verified: boolean } | undefined>;
  emailsOf(userIds: readonly string[]): Promise<Map<string, string>>;
}
// tokens.ts: credentialsStamp(secret, passwordHash) = HMAC-SHA256(secret, 'credentials:' + passwordHash) base64url

// apps/api/src/modules/panel/panel.collection.ts
export const PANEL_COLLECTIONS = { members: 'panel_members', sessions: 'panel_sessions', audit: 'panel_audit',
  meta: 'panel_meta' } as const;
export interface PanelMemberDoc { _id: string /* userId */; role: PanelRole; status: 'active' | 'revoked';
  displayName: string; grantedAt: Date; revokedAt: Date | null; version: number }
export const PANEL_SESSION_REVOKED_REASONS = ['signed_out', 'superseded', 'role_revoked', 'credentials_changed',
  'account_inactive'] as const;
export interface PanelSessionDoc { _id: string; userId: string; tokenHash: string; credentialsStamp: string;
  createdAt: Date; lastSeenAt: Date; idleExpiresAt: Date; expiresAt: Date; revokedAt: Date | null;
  revokedReason: PanelSessionRevokedReason | null }
export interface PanelAuditDoc { _id: string; at: Date; action: AuditAction;
  actor: { kind: 'user'; userId: string } | { kind: 'cli' }; targetUserId: string | null; reason: string | null;
  details: { roleFrom?: PanelRole; roleTo?: PanelRole } | null }
export interface PanelMetaDoc { _id: 'admins'; version: number }

// apps/api/src/modules/panel/permissions.ts
export function defineRoles<R extends string, P extends string>(map: Record<R, readonly P[]>): Record<R, ReadonlySet<P>>;
export const ROLE_PERMISSIONS = defineRoles<PanelRole, Permission>({
  admin: PERMISSIONS, moderator: ['audit.read'], organizer: [],
});

// apps/api/src/modules/panel/index.ts
export { PanelModule } from './panel.module';
export { PanelGuard } from './panel.guard';
export { RequirePermission } from './require-permission.decorator';
export { CurrentPanelUser, type PanelPrincipal } from './current-panel-user.decorator'; // { userId, sessionId, role, permissions }
export { PanelAudit } from './panel-audit';

// PANEL_POLICY: sessionIdleMs 2 ч, sessionAbsoluteMs 12 ч, touchIntervalMs 5 мин, memberListCap 500
```

Миграция `0005_panel`: `ensureCollection` × 4; индексы — `panel_members_role_status_idx` (`{ role: 1, status: 1 }` —
подсчёт активных админов); `panel_sessions_token_hash_unique`, `panel_sessions_user_id_idx`,
`panel_sessions_expires_at_ttl` (TTL 30 дней после `expiresAt` — уборка); `panel_audit_action_idx`
(`{ action: 1, _id: -1 }`), `panel_audit_actor_idx` (`{ 'actor.userId': 1, _id: -1 }`), `panel_audit_target_idx`
(`{ targetUserId: 1, _id: -1 }`); `panel_meta`: `updateOne({ _id: 'admins' }, { $setOnInsert: { version: 0 } },
{ upsert: true })`. Expand-only, без транзакции, идемпотентна.

```ts
// apps/admin
type NavItem = { to: string; labelKey: I18nKey; permission?: Permission };
function useCan(permission: Permission): boolean;
function Can(props: { permission: Permission; children: ReactNode; fallback?: ReactNode }): ReactNode;
function DataTable<T>(props: { columns: ColumnDef<T>[]; query: UseQueryResult<T[]>; empty: ReactNode; toolbar?: ReactNode }): ReactNode;
function ReasonDialog(props: { open: boolean; title: string; consequences: string; confirmLabel: string;
  destructive?: boolean; extraFields?: ReactNode; onConfirm(reason: string): Promise<void>; onClose(): void }): ReactNode;
```

### TESTS
- **contracts:** роли/права/действия — только известные; `PanelSignInRequest` — пустой пароль, 129 символов, лишний
  ключ; имя и причина — управляющие символы, 2/501 символ; `AuditQuery` — `cursor` не UUID, `limit` 0/101;
  `PanelSignInResponse` — обе ветки; коды ошибок — в конце списка.
- **api-client:** пути и методы `createAdminApiClient`, `credentials: 'same-origin'`, нет `Authorization`, ответы по
  схемам, 204 выхода, `resendVerification` — тот же путь, что у клиента приложения.
- **API unit:** `defineRoles` — полнота по `PanelRole`, `admin` ⊇ все права, `moderator` = `{audit.read}`;
  `credentialsStamp` — меняется при смене хеша, не равен хешу; порядок отказов `PanelGuard` на моках.
- **API int (MongoDB RS `*_test` + Redis db 1, `TestClock`):** регрессия входа приложения (S2); AC1–AC8 по пунктам;
  побайтное равенство тел 401 панели и приложения; общие счётчики (3 попытки в приложении + 3 в панели → 6-я 429);
  гонки (`pokatim-tests.md`): вход в панель ↔ сброс пароля (ворота перед вставкой сессии; **отрицательное
  доказательство** — без сверки штампа `me` → 200), вход ↔ снятие роли (сессия не работает), два админа снимают друг
  друга (**отрицательное доказательство** — без `lockAdmins` 0 админов), два параллельных `grant`; инъекция
  `{ "email": { "$ne": null } }`, `?action[$ne]=x`, cookie `{"$gt":""}` → 400/401 без изменений; cross-site → 403;
  `no-store`; access JWT и refresh-cookie приложения на `/v1/admin/*` → 401; журнал — одна запись на действие,
  откат транзакции — без записи, тест-сторож append-only; маршруты — все под гардом или `@Public()`; миграция на
  чистой БД и повторно.
- **Admin (vitest + jsdom + Testing Library, `TZ=Europe/Minsk`):** гард — без сессии → «Вход», 401 → «Сессия
  истекла» с `next`, плохой `next` отбрасывается; навигация по ролям (admin/moderator/organizer), прямой URL без права
  → «Нет доступа к разделу»; вход — все состояния AC9 (неверные данные, `PANEL_ACCESS_DENIED` с введённым адресом и
  «Войти другим аккаунтом», `verificationRequired` с отсчётом и повтором письма, 429 с неактивными полями, «Забыли
  пароль?» — ссылка на `/forgot-password`); `DataTable` — скелетон под шапкой, «Нет соединения»/«Не удалось загрузить» +
  «Повторить», баннер ошибки обновления, пусто, сортировка (`aria-sort`), фильтр; `ReasonDialog` — подтверждение
  неактивно без причины, Esc, фокус и возврат фокуса, ошибка сервера в диалоге; «Сотрудники» — действия только с
  `members.manage`, своя строка без действий, 404/409 под полем e-mail; «Журнал» — время по Минску, «Показать ещё».
- **E2E:** AC15 (Chrome; `vite preview` с `ADMIN_BASE=/admin/` и прокси `/v1` → API; Mailpit; CLI через `tsx`).
- **Ручной смоук (человек; NOT VERIFIED, если не делался):** dev-стенд `/admin/` — регистрация в приложении, CLI на
  сервере, вход в панель, выдача и снятие роли; сброс пароля в приложении гасит сессию панели; Firefox и Safari.

### OUT OF SCOPE
§4. Плюс: изменения app-foundation (F6, токены Q17 — отдельной задачей базы); письма о роли; приглашение на
регистрацию; 2FA; CSP web приложения; роль MongoDB для append-only; экраны Приложения A.

# 12. Outcome

Ветка `feature/admin-01-foundation` (от `origin/develop`), коммиты по слайсам S1–S8.

**Слайсы**

| # | Итог |
|---|---|
| S1 | `packages/contracts/src/admin/{permissions,session,members,audit}.schema.ts` + тесты; 5 кодов `PANEL_*` в конец; `createAdminApiClient` (cookie same-origin, без `Authorization`) + тест; тексты кодов |
| S2 | `CredentialsCheck` (выделена из `SignInService`), `PanelCredentials`, `IdentityAccounts`, `credentialsStamp`; регрессия identity int без правок ожиданий |
| S3 | `panel.collection`, миграция `0005_panel`, `PanelRepository` (`lockMember`, `lockAdmins`, сессии, журнал только `insertOne` + тест-сторож), `ROLE_PERMISSIONS`, `PanelAudit`, CLI `grant-admin` |
| S4 | вход/выход/`me`, `PanelSessionCookie`, `PanelGuard` (+ unit порядка отказов), `RequirePermission`, `CurrentPanelUser`, `Public`, тест «все маршруты под гардом» |
| S5 | выдача/смена/снятие роли, `GET members`, `GET audit` (курсор, фильтры), int AC5–AC8, гонки |
| S6 | `apps/admin`: TanStack Router (basepath), сессия (`me`, гард, 401/403, `safeNext`), `src/ui`, вход со всеми состояниями, «Обзор», «Нет доступа», «Не найдено», строки `admin.*` |
| S7 | «Сотрудники» (таблица, фильтры, поиск, диалоги выдачи/смены/снятия), «Журнал действий» («Показать ещё») |
| S8 | CSP и `no-store` nginx `admin`, Caddy прода `/admin/*` на `PUBLIC_HOST`, `admin` в `docker-compose.prod.yml`, `pnpm e2e:admin` + CI, документация §10 |

**Проверки (2026-10-25, нативные MongoDB RS 127.0.0.1:27117 и Redis :6479)**

- `pnpm check` (`MONGO_URL_TEST=…/pokatim_test?replicaSet=rs0`, `REDIS_URL_TEST=…:6479/1`) → EXIT 0: prettier ok,
  eslint 0 предупреждений, `✔ no dependency violations found (402 modules)`, typecheck 8/8; тесты — contracts 11 файлов,
  api-client 5, admin 8 (65 тестов), api 42 файла (309 тестов), прочие пакеты — зелёные.
- Регрессия входа приложения (AC16): `sign-in.int`, `identity-races.int`, `password-reset.int`, `auth-guard.int` —
  зелёные без правок ожиданий.
- Миграции дважды (AC13): `db:migrate` на `pokatim_e2e` — «миграции применены: 0001…0005_panel», повтор — «новых
  миграций нет»; int `migrations.int.test.ts` — чистая база и повторный `up` (документ-замок не сбрасывается).
- `ADMIN_BASE=/admin/ pnpm --filter @pokatim/admin build` → ✓ built (предупреждение Vite о чанке > 500 kB).
- `pnpm e2e:admin` (API :3101 из `dist`, worker, Mailpit, `vite preview` под `/admin/` с CSP панели) → 1 passed (AC15:
  CLI `grant-admin` → вход → выдача moderator → «Журнал» виден, «Сотрудники» по URL — «Нет доступа к разделу» →
  снятие роли → «Сессия истекла» → «Нет доступа к панели» → журнал; CSP-заголовок, ошибок консоли нет).
- `pnpm e2e:web` (`E2E_API=1`, Chrome) → 12 passed (регрессия web приложения).
- CLI на тестовой БД (AC1): `panel-cli.int.test.ts` (5 тестов) и `node dist/cli/panel.js` в e2e; `--help` → код 0.
- `caddy validate --config infra/Caddyfile --adapter caddyfile` → «Valid configuration».

**Отрицательные доказательства (`pokatim-tests.md`)**

- R7 «последний администратор» (`panel-races.int.test.ts`): два админа параллельно снимают друг друга (первая
  транзакция на воротах после подсчёта админов) — с замком `lockAdmins` статусы `[200, 409 PANEL_LAST_ADMIN]`, 1
  активный админ; **без `lockAdmins`** (spy на прототипе — no-op) — `[200, 200]`, **0 активных админов**.
- Штамп учётных данных (`panel-session.int.test.ts`): вход проверил старый пароль (ворота перед вставкой сессии) ↔
  сброс закоммичен — первый запрос выданной сессии 401 (`credentials_changed`); **без сверки штампа** (порт
  возвращает записанный при входе штамп) — та же сессия **200**.
- Вход ↔ снятие роли: сессия, выданная после снятия, на первом запросе 401. Две выдачи одному пользователю
  (4 параллельно) — один 201, три 409, один документ, одна запись журнала.

**NOT VERIFIED**

- `docker build --target admin` + `curl -I /admin/` и `nginx -t` для `admin-nginx.conf` — Docker daemon на машине
  недоступен, nginx не установлен; строка CSP проверена смоуком (тот же заголовок из этого файла в `vite preview`),
  синтаксис nginx и запуск образа проверит job `deploy-rehearsal` на PR (меняется `infra/docker/**`).
- Ручной смоук на dev-стенде (CLI на сервере, вход, выдача и снятие роли, сброс пароля гасит сессию панели),
  Firefox и Safari.

**Follow-ups**

- Токены размеров панели (`density.compact`: 400/420/560/330) — в `@rkarakulov/design-tokens`; удалить
  `apps/admin/src/panel-tokens.ts` (Q17).
- До прода: 2FA (TOTP) для `admin` (N3), строгий CSP web приложения (C3).
- Роль MongoDB без `update`/`remove` для `panel_audit`.
- Приглашение на регистрацию и письмо о выдаче/снятии роли (N1, N2, R4б, R5).
- Удаление аккаунта: снять роль и отозвать `panel_sessions` (правило — `pokatim-db.md`).
- Вынос `apps/admin/src/ui` и `defineRoles`/гарда в `admin-kit` (F6) после слайса 2 панели.
- Переход на `@tanstack/react-table` 9 (D1); вопрос по D2; code-splitting сборки панели (чанк > 500 kB).


# Приложение A. Карта прототипа (план следующих слайсов панели)

Источник — три макета автора (конфиденциальны, в репозиторий не копируются). Общее: регистр «Протокол» — 1440, только
светлая тема, тёмный сайдбар 224 px (Гонки, Результаты, Споры со счётчиком, Календарь, Модерация, Сезоны; внизу — имя
и роль), голова страницы (крошки, кикер, заголовок Playfair, мета, волосяная линия), KPI-полоса, плотные таблицы 36 px,
статусные метки со значками, формы в одну колонку (≈560 px) с меткой «Europe/Minsk» у дат, модальное окно ≈420 px с
обязательной причиной (Esc, ловушка и возврат фокуса, разрушительное — не по умолчанию), неактивная кнопка с причиной
под ней (`aria-disabled` + `aria-describedby`).

| Экран (макет) | Ключевые элементы | Слайс (план) | Права (план) |
|---|---|---|---|
| Вход (3a) | окно 400 px без сайдбара; состояния покой, «Нет доступа к панели», «Сессия истекла», «Слишком много попыток», «E-mail не подтверждён» | **этот слайс** | все |
| Сброс пароля в панели (3b) | запрос, нейтральное подтверждение, форма нового пароля, «ссылка устарела», «пароль изменён» | не делаем — общий сброс приложения (Q11) | — |
| Сезоны (3c) | таблица сезонов, форма в правой колонке, ошибка пересечения дат, завершённый — только чтение, сезон с гонками не удаляется | admin-03 | `seasons.manage` |
| Создание и редактирование гонки (2a, 3d) | обязательные поля (название, класс, эталонный коридор — опубликованный маршрут, окно с явным временем, дата протокола ≥ конец окна + 48 ч), покрытие — мультивыбор, обложка, вычисляемый сезон; фиксация полей с первой записи участника; после закрытия окна дата протокола — только позже | admin-03 | `races.manage` |
| Отмена гонки (3e) | модалка с шаблонной причиной (радиогруппа) и превью «Участники увидят»; блок при финальном результате или открытом споре | admin-03 | `races.cancel` |
| Проверка результатов и публикация (1a) | KPI, вкладки кластеров, таблица мест (ничьи, отставание, исключения/флаги), «Не засчитано», чек-лист публикации (блокирующие, временные, dead-letter → «Исключить трек»), флаг «Требует внимания» (коды, фильтр, не блокирует), «Исключить трек» / «Вернуть в обработку» с причиной | admin-04 | `results.review`, `results.publish`, `tracks.exclude` |
| Рассмотрение спора (1b) | KPI биометрии (только здесь), графики пульса и мощности по дистанции со спорным участком, заявление (подавший скрыт), ответ участника, решение + шаблонная причина + внутренняя заметка, запрет раньше 12 ч | admin-05 | `disputes.decide`, `biometrics.read` |
| Экстренный пересчёт (2c, 3f) | только финальный протокол; действие (DQ / пересчёт по трекам / отмена DQ), результат, обязательная причина, «Последствия», событие пересмотра, без ручного времени | admin-05 | `results.recalculate` |
| Календарь стартов (2b) | форма внешнего старта (название, дата, дисциплина, город, дистанция, ссылка регистрации, медиа), публикуется сразу | admin-06 | `calendar.manage` |
| Очередь модерации (2d) | вкладки по типу контента со счётчиками, строки (владелец, объект, число сообщений, причина, комментарий), «Оставить»/«Удалить», сообщивший скрыт | admin-07 | `moderation.decide` |

Не нарисовано в макетах (этот слайс — `[ASSUMPTION]`): «Обзор», «Сотрудники», «Журнал действий», «Нет доступа к
разделу» внутри каркаса, их пункты меню (нижняя группа сайдбара над блоком сотрудника).
