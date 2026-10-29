# 2FA (TOTP) для панели «Протокол»

- Уровень: task3 (контракты, API, миграция, env/deploy, CLI, админка, безопасность)
- Ветка: `feature/panel-2fa` от `origin/develop` (один PR)
- Основание: ADR-0009 «Последствия» (C1, C3), `.claude/rules/pokatim-security.md` («до прода — 2FA для admin»),
  `docs/product/admin-panel.md` §2FA. Новый ADR-0024 (номер 0023 занял event-tickets, см. §8.2).

## 1. Что было (UNDERSTAND)

- Вход в панель: `POST /v1/admin/session/sign-in` → `PanelCredentials.verify` (identity, `CredentialsCheck`: счётчики
  `signin-*` IP → e-mail+IP → e-mail, пустышка argon2, один 401) → `verificationRequired` как есть → член `active`, иначе
  403 `PANEL_ACCESS_DENIED` → сессия (`panel_sessions`, sha256 токена, `credentialsStamp`, простой 2 ч / абсолют 12 ч)
  + `panel.signed_in` + отзыв прежней cookie (`superseded`) одной транзакцией. Cookie `__Secure-pokatim_admin_sid`,
  `Path=/v1/admin`, `SameSite=Strict`.
- `PanelGuard` на каждом запросе: сессия → аккаунт → штамп → член `active` → права роли. Журнал `PanelAudit.append(tx,…)`
  — append-only, без e-mail/IP/UA. Причина действия — `ActionReason` (members.schema). Админские действия над
  сотрудниками — `members.manage` (только admin). CLI `panel.js grant-admin`.
- Шифрование на `node:crypto` уже есть (`web-push.crypto.ts`); секреты сервера — `infra/deploy/env.template` (`@secret`
  генерирует `bootstrap.sh`: `openssl rand -hex 32`).
- Экрана «мой аккаунт» в админке нет; блок сотрудника — внизу сайдбара (`AppLayout`).

## 2. Чего не хватает

Второго фактора: пароль приложения = доступ к панели (C1), а панель на том же домене (C3). Нужны TOTP (RFC 6238),
коды восстановления, шаг кода после пароля, «запомнить устройство», сброс админом, флаг обязательности.

## 3. Спецификация

### 3.1 Решения

| # | Решение | Почему |
|---|---|---|
| D1 | Обязательность — **только `admin`**, при `PANEL_TOTP_ENFORCED=true` (по умолчанию `false`; dev — `false`). moderator и organizer подключают по желанию, в настройках — рекомендация. | Решение пользователя 2026-10-29; ADR-0009. Флаг — чтобы не запереть dev. |
| D2 | admin без 2FA при включённом флаге после верного пароля получает `totpSetupRequired`: подключение прямо на экране входа (QR → код → коды восстановления), сессия — только после подтверждения. | Решение пользователя: никто не запирается, флаг включается без подготовки. |
| D3 | 10 одноразовых кодов восстановления (формат `xxxxx-xxxxx`, алфавит base32 без `0 1 8 9`, 50 бит), показываются один раз; в БД — `HMAC-SHA256(PANEL_TOTP_KEY, нормализованный код)`; перевыпуск — с текущим кодом TOTP. Вход кодом восстановления гасит этот код. Аварийно — CLI `reset-totp` и сброс другим admin. | Решение пользователя. Энтропия 50 бит + лимиты — быстрого HMAC достаточно, argon2 не нужен. |
| D4 | «Запомнить устройство» на **30 дней**: галочка на шаге кода; отдельная cookie `__Secure-pokatim_admin_device` (`HttpOnly; Secure; SameSite=Strict; Path=/v1/admin/session`, без `Domain`, Max-Age 30 дн), в БД — sha256, `userId`, `credentialsStamp`, `totpEpoch`. Пропускает **только шаг кода** (пароль — всегда). Гаснет: смена пароля (штамп), отключение/сброс/повторное подключение 2FA (`totpEpoch`), срок. Не больше 10 устройств на сотрудника (старые вытесняются). | Решение пользователя; привязка к штампу и эпохе — без отдельного отзыва на каждом пути. |
| D5 | TOTP — свой RFC 6238 на `node:crypto` (SHA-1, 30 с, 6 цифр, окно ±1 шаг), base32 — свой; без зависимостей в API. Секрет — 20 байт (`randomBytes`). Повтор кода закрыт: `lastUsedStep` — код принимается, только если его шаг `>` записанного (условное обновление). | RFC 4226/6238 тест-векторы; повтор перехваченного кода — классическая атака. |
| D6 | Секрет хранится зашифрованным: AES-256-GCM, ключ `PANEL_TOTP_KEY` (hex 64 = 32 байта, env; dev — `@secret`), формат `v1:<iv b64url>:<tag b64url>:<ct b64url>`, AAD = `panel-totp:<userId>` (секрет нельзя переставить другому сотруднику). Без ключа: подключение — `503 TOTP_UNAVAILABLE`, вход сотрудника с 2FA — тот же 503 (fail closed); `PANEL_TOTP_ENFORCED=true` без ключа — отказ на старте. | Ключ — env (требование); утечка БД не даёт секретов. |
| D7 | Шаг входа: после пароля и проверки члена — **вызов (challenge)**: непрозрачный токен (32 байта) в теле ответа, в БД `panel_sign_in_challenges` — sha256, `userId`, `credentialsStamp`, `purpose: 'totp'\|'setup'`, `attempts`, `expiresAt` (5 мин, TTL-индекс). ≤ 5 неверных кодов на вызов (дальше вызов гаснет — вход заново с паролем). Успех гасит вызов атомарно (`findOneAndDelete` / условное обновление). Сессия создаётся только при живом вызове, совпадении штампа с текущим и `active`-члене. | Пароль не пересылается повторно; токен короткий, одноразовый, без cookie. |
| D8 | Лимиты кода (по образцу `CredentialsCheck`, `RateLimiter`, по очереди до первого отказа): `panel-totp-ip` 50/15 мин, `panel-totp-user` 10/15 мин (ключ — HMAC от userId, как `signInLimitKeys`). Списывается каждая попытка ввода кода (вход, подключение, отключение, перевыпуск кодов). 429 — `RATE_LIMITED` c `retryAfterSec`. | Перебор 10⁶ кодов при окне ±1: 10 попыток / 15 мин ≈ 3·10⁻⁵ за окно. |
| D9 | Настройки сотрудника (любая роль): статус, подключение (QR + секрет текстом, подтверждение кодом → коды восстановления), перевыпуск кодов (с кодом TOTP), отключение (с кодом TOTP или восстановления). admin при `PANEL_TOTP_ENFORCED=true` отключить себе 2FA не может (`409 TOTP_REQUIRED`). Подключение в настройках: незавершённое подключение — `pending` секрет в документе 2FA (заменяется при новом старте), активным становится только после кода. | |
| D10 | Сброс 2FA другому сотруднику — `members.manage` (admin), обязательная причина `ActionReason`, себя — нельзя (`409 CANNOT_CHANGE_SELF`, как у роли). Сброс удаляет документ 2FA, доверенные устройства цели и **отзывает её сессии панели** (`totp_reset`) одной транзакцией. CLI `reset-totp --email` — аварийный путь (actor `cli`), e-mail не печатает. | Утерянный телефон; последний admin. |
| D11 | Журнал `PanelAudit`: `panel.totp_enabled`, `panel.totp_disabled` (сам), `panel.totp_reset` (admin/CLI, target, reason). Перевыпуск кодов и вход кодом восстановления — `panel.totp_recovery_regenerated`, `panel.totp_recovery_used`. Неудачные коды — не в журнал (как неудачные входы), только лог `uid` + причина. | Требование + видимость использования кодов. |
| D12 | Сессия хранит фактор входа `secondFactor: 'totp' \| 'recovery' \| 'device' \| null`; `PanelMe.user.totp` = `{ enabled, required }` (клиент показывает баннер «подключите 2FA» moderator/organizer и admin при выключенном флаге). Отключение 2FA собственных сессий не гасит; сброс админом — гасит. | |

### 3.2 Контракты (`packages/contracts/src/admin/totp.schema.ts` + `session.schema.ts`)

- `TotpCode` — ровно 6 цифр (строка, пробелы клиент убирает до отправки). `RecoveryCode` — `^[a-z2-7]{5}-?[a-z2-7]{5}$`
  без учёта регистра (сервер нормализует: нижний регистр, без дефиса). `SignInChallenge` — base64url 43.
- `PanelSignInResponse` += `{ state: 'totpRequired', challenge, expiresInSec }`,
  `{ state: 'totpSetupRequired', challenge, expiresInSec }`.
- `POST /v1/admin/session/sign-in/totp` — `strictObject({ challenge, code?: TotpCode, recoveryCode?: RecoveryCode,
  rememberDevice: boolean })`, ровно одно из `code`/`recoveryCode` → `{ state: 'signedIn', me }`.
- `POST /v1/admin/session/sign-in/totp-setup` — `{ challenge }` → `TotpSetup = { secret (base32), otpauthUri }`.
- `POST /v1/admin/session/sign-in/totp-setup/confirm` — `{ challenge, code, rememberDevice }` →
  `{ state: 'signedIn', me, recoveryCodes: string[10] }`.
- `GET /v1/admin/account/totp` → `TotpStatus = { enabled, enabledAt|null, required, recoveryCodesLeft }`.
- `POST /v1/admin/account/totp/setup` → `TotpSetup` (409 `TOTP_ALREADY_ENABLED`).
- `POST /v1/admin/account/totp/confirm` — `{ code }` → `{ recoveryCodes }`.
- `POST /v1/admin/account/totp/recovery-codes` — `{ code }` → `{ recoveryCodes }`.
- `POST /v1/admin/account/totp/disable` — `{ code? , recoveryCode? }` (ровно одно) → 204.
- `POST /v1/admin/members/:userId/totp/reset` — `{ reason: ActionReason }` → 204.
- `PanelMe.user.totp = { enabled: boolean, required: boolean }`; `MemberRow` += `totpEnabled: boolean`.
- Ошибки: `TOTP_INVALID_CODE` (400, одно сообщение для неверного кода / кода восстановления / повторённого кода),
  `TOTP_CHALLENGE_EXPIRED` (401 — вызов неизвестен, истёк, исчерпан, штамп сменился), `TOTP_ALREADY_ENABLED`,
  `TOTP_NOT_ENABLED`, `TOTP_REQUIRED` (409), `TOTP_UNAVAILABLE` (503), `RATE_LIMITED` (429). Тексты — в
  `error-messages` и i18n.
- `AUDIT_ACTIONS` += пять действий D11. otpauth: `otpauth://totp/Покатим%20Протокол:<e-mail>?secret=…&issuer=Покатим%20Протокол&algorithm=SHA1&digits=6&period=30`.

### 3.3 API (модуль `panel`)

- `totp.ts` (чистые функции): base32, `generateTotp(secret, step)`, `verifyTotp(secret, code, now, lastUsedStep)` →
  принятый шаг | null, `timingSafeEqual` для сравнения; `recovery-codes.ts`: генерация, нормализация, HMAC.
- `totp-secret-box.ts`: AES-256-GCM `seal/open(userId, secret)` по `PANEL_TOTP_KEY` (D6).
- Коллекции (миграция `00NN_panel_totp` — номер сверить с develop перед мержем): `panel_totp` (`_id` = userId,
  `status: 'pending'|'active'`, `secretEnc`, `lastUsedStep`, `recoveryCodes: [{hash, usedAt}]`, `enabledAt`,
  `epoch` (uuidv7, меняется при каждом подключении), `updatedAt`), `panel_sign_in_challenges` (`tokenHash` unique,
  TTL `expiresAt`), `panel_trusted_devices` (`tokenHash` unique, `userId` idx, TTL `expiresAt`). Писатель — `PanelRepository`
  (или отдельный `PanelTotpRepository` в модуле `panel`). `panel_sessions` += `secondFactor` (необязательное поле,
  старые документы — `null`).
- `PanelTotpService`: подключение/подтверждение/перевыпуск/отключение/сброс/проверка кода; лимиты D8 (`PANEL_POLICY`).
- `PanelSessionService.signIn` → вызов или сессия (D2, D4, D7); `completeTotp`, `startSetup`, `confirmSetup`.
  Политика «нужен ли код»: 2FA `active` → код (или живое доверенное устройство); нет 2FA и `admin` и `ENFORCED` →
  `setup`; иначе — сессия сразу (как сейчас).
- Контроллеры: `panel-session.controller` (три `@Public()` маршрута вызова), `panel-account-totp.controller`
  (`PanelGuard`, без `@RequirePermission` — свой аккаунт любой роли; проверка `admin-routes.test.ts` должна это
  принимать явно — смотри, как устроен `me`), сброс — в `panel-members.controller` (`members.manage`).
- CLI: `reset-totp --email <e-mail>` в `cli/panel-cli.ts`.
- Env: `PANEL_TOTP_KEY` (optional, hex 64), `PANEL_TOTP_ENFORCED` (bool, default false; `true` без ключа — ошибка);
  `infra/deploy/env.template` (`PANEL_TOTP_KEY=@secret`, `PANEL_TOTP_ENFORCED=false`), `docker-compose.yml`,
  `.env.example`.

### 3.4 Админка (`apps/admin`)

- Вход: после пароля — шаг «Код из приложения» (6 цифр, `autocomplete="one-time-code"`, `inputmode="numeric"`),
  ссылка «Использовать код восстановления», галочка «Запомнить это устройство на 30 дней», «Назад» (к паролю). Истёк
  вызов — сообщение и возврат к паролю. `totpSetupRequired` — шаги подключения (D2) на экране входа.
- Подключение (общий компонент для входа и настроек): QR (матрица из `qrcode.create`, рендер своим `<svg>` — без
  `data:` и `innerHTML`), секрет текстом группами по 4 с копированием, поле кода → коды восстановления (список,
  «Скопировать», «Скачать .txt», подтверждение «Я сохранил коды» перед продолжением).
- Новый раздел «Безопасность» (`/account/security`, вход из блока сотрудника в сайдбаре, любая роль): статус,
  подключить, перевыпустить коды (осталось N), отключить (с кодом; для admin при обязательности — кнопка недоступна с
  пояснением). Баннер рекомендации на «Обзоре», если 2FA не подключена.
- «Сотрудники»: колонка/метка «2FA», действие «Сбросить 2FA» (admin, не себе, только если подключена) через
  `ReasonDialog`.
- i18n — `@pokatim/i18n` ключи `admin.totp.*`; a11y — подписи полей, фокус на поле кода, ошибки в `aria-live`.

## 4. Security checklist

1. **AuthN/AuthZ:** маршруты вызова — `@Public()`, но требуют живой вызов (sha256 в БД, 5 мин, ≤ 5 попыток, атомарное
   погашение); сессия создаётся только после второго фактора при совпадении штампа и `active`-члене. Настройки —
   `PanelGuard`, только свой аккаунт (userId из гарда). Сброс — `members.manage`, не себе, причина обязательна.
2. **Перебор:** лимиты D8 по IP и пользователю + лимит попыток на вызов; пароль — прежние `signin-*`. Повтор кода
   закрыт `lastUsedStep`; код восстановления — одноразовый (условное `$set usedAt`).
3. **Секреты:** TOTP-секрет — AES-256-GCM, ключ только в env (dev — генерирует `bootstrap.sh`), AAD = userId. Секрет и
   otpauth отдаются только при подключении (до подтверждения), потом — никогда. Коды восстановления — только HMAC.
   Токены вызова и устройства — только sha256. Без ключа — fail closed.
4. **Cookie устройства:** `HttpOnly; Secure; SameSite=Strict; Path=/v1/admin/session`, без `Domain`; пропускает только
   код, не пароль; гаснет при смене пароля и любой смене 2FA; ≤ 10 на сотрудника.
5. **Данные наружу/логи:** в ответах нет хешей, `secretEnc`, `epoch`; в логах — `uid`, `sid`, исход, без кодов,
   секретов, e-mail, токенов. CLI не печатает e-mail.
6. **Аудит:** D11 — в транзакции действия; без кодов и секретов.
7. **Timing:** сравнение кодов — `timingSafeEqual`; неверный код, повтор и неверный код восстановления — один ответ.
8. **Fail-safe флага:** `PANEL_TOTP_ENFORCED` выключен по умолчанию; admin с выключенной 2FA при включённом флаге
   входит только через подключение (D2) — не запирается.

## 5. Test matrix

| Что | Где |
|---|---|
| TOTP: векторы RFC 6238 (SHA-1), окно ±1, повтор шага, неверная длина; base32 | `totp.test.ts` |
| секрет: seal/open, чужой userId (AAD) — отказ, порча тега — отказ | `totp-secret-box.test.ts` |
| коды восстановления: формат, нормализация, HMAC | `recovery-codes.test.ts` |
| схемы: code/recoveryCode ровно одно, strict, новые состояния ответа | `totp.schema.test.ts`, `session.schema.test.ts` |
| вход: без 2FA — сессия; с 2FA — вызов → код → сессия + `secondFactor`; код восстановления гасится и пишет журнал; повтор кода — 400; 5 неверных — вызов погашен; истёк — 401; смена пароля между шагами — 401; лимит — 429; доверенное устройство — сразу сессия; устройство после смены пароля / отключения 2FA — снова код; admin + ENFORCED без 2FA — `totpSetupRequired` → setup → confirm → сессия + коды; ENFORCED выключен — сессия | `panel-totp-sign-in.int.test.ts` |
| настройки: подключение (setup → confirm, журнал), повторный setup до confirm заменяет секрет, setup при активной — 409, перевыпуск кодов, отключение (журнал, устройства гаснут), admin + ENFORCED — отключение 409 | `panel-account-totp.int.test.ts` |
| сброс: admin сбрасывает модератору (журнал с причиной, сессии и устройства цели отозваны), себе — 409, moderator — 403, без причины — 400 | `panel-members.int.test.ts` |
| CLI `reset-totp` | `panel-cli.int.test.ts` |
| env: ENFORCED без ключа — отказ; ключ не hex 64 — отказ | `env.test.ts` |
| гард маршрутов: новые `/v1/admin/*` покрыты | `admin-routes.test.ts` |
| админка: шаг кода (успех, неверный код, восстановление, истёк вызов), подключение на входе, экран «Безопасность», сброс в «Сотрудниках» | `SignInScreen.test.tsx`, `SecurityScreen.test.tsx`, `MembersScreen.test.tsx` |

## 6. Placement

Всё — модуль `panel` (2FA — свойство сотрудника панели, не аккаунта приложения; identity не меняется). Контракты —
`packages/contracts/src/admin`. Админка — `features/sign-in`, новая `features/security`, `features/members`.
Новый ADR-0024; правки ADR-0009 («Последствия» → ссылка на 0024), `pokatim-security.md`, `docs/product/admin-panel.md`.

## 7. Outcome

См. §12.

## 8.2 Deviations from spec

Решения при реализации (открытые места spec — по его рекомендации):

1. **ADR-0024, а не 0023:** номер 0023 в `origin/develop` занял ADR event-tickets. Ссылки в коде, контрактах и
   документах — на 0024.
2. **Миграция `0040_panel_totp`:** последняя в `origin/develop` — `0038_tickets`, номер `0039` занимает
   `0039_event_materials` параллельного PR #121 (мержится первым). Тест порядка проверяет «последняя и после
   `0038_tickets`», а не «сразу после»; при слиянии #121 — добавить `0039_event_materials` в список id. Ревью pass 1:
   номер `0040_panel_totp` остаётся, порядок слияния — #121 (`0039`) первым (обеспечивает оркестратор).
3. **Себе сбросить 2FA — `409 PANEL_SELF_ACTION`**, а не `CANNOT_CHANGE_SELF`: spec требует «как у роли», а роль
   использует `PANEL_SELF_ACTION`; нового кода ошибки не вводили.
4. **Писатель — `PanelRepository`** (не отдельный `PanelTotpRepository`): тест-сторож `panel.repository.test.ts`
   разрешает `panelCollections(` только описанию коллекций, миграциям и `PanelRepository`.
5. **TTL вызовов и устройств — `expiresAt` + сутки** (`PANEL_TOTP_TTL_GRACE_SECONDS`), как у сессий: срок проверяет
   сервер по `CLOCK`, TTL — только уборка.
6. **Сброс 2FA другим admin** — цель должна быть членом команды (любой статус, иначе 404); 2FA не подключена — `409
   TOTP_NOT_ENABLED`. Сброс удаляет и незавершённое (`pending`) подключение только вместе с активной 2FA; CLI для
   неподключённой 2FA — код 0 «2FA не подключена» без записи журнала.
7. **CLI `reset-totp`** — причина в журнале фиксированная: «Аварийный сброс 2FA (CLI)» (spec аргумента причины не
   задаёт).
8. **Подтверждение подключения без начатого `pending`** — в настройках `409 TOTP_NOT_ENABLED`, на входе — `400
   TOTP_INVALID_CODE` (попытка вызова списывается).
9. **Админка:** заголовок шага кода — «Подтверждение входа» (поле — «Код из приложения»: иначе доступное имя секции
   дублировало подпись поля); QR — `src/ui/QrCode.tsx` (без доменных импортов, кандидат в admin-kit); зависимость
   `qrcode` 1.5.4 + `@types/qrcode` 1.5.6 (точные версии).
10. **e2e:** отдельного Playwright-сценария 2FA нет — стенд смоука без `PANEL_TOTP_KEY`, вход в нём прежний; поведение
    покрыто int-тестами API и тестами экранов. Follow-up — сценарий подключения с тестовым ключом в `e2e/project.ts`.

**Фиксы ревью pass 1** (Codex CRITICAL/HIGH, Claude MEDIUM/LOW):

11. **Вход по доверенному устройству — перепроверка в транзакции сессии** (CRITICAL-1): `openByDevice` условно пишет
    документ устройства (`$inc version` по `_id`, `userId`, штамп, эпоха, срок) и читает 2FA в снимке транзакции;
    сброс и отключение 2FA удаляют устройства — конфликт записи MongoDB упорядочивает их со входом. Устройство или 2FA
    устарели — вызов `totpRequired` (как у устаревшего устройства без гонки). Новое поле `panel_trusted_devices.version`
    (без миграции: на dev 2FA никто не подключал, валидатора схемы нет).
12. **Эпоха в фильтрах** (HIGH-2): `acceptTotpStep` и `useRecoveryCode` принимают `epoch` прочитанного документа —
    вход (`completeTotp`), перевыпуск кодов, отключение; несовпадение — отмена транзакции как отклонённый код (`400
    TOTP_INVALID_CODE`, попытка вызова списана).
13. **«Безопасность»: ошибка статуса при данных — баннер** (HIGH-3): полноэкранный `ErrorState` — только без данных;
    иначе `Banner` (`state.staleTitle`, «Повторить») над блоком, показанные коды восстановления остаются.
14. **Попытка кода резервируется атомарно до проверки** (MEDIUM-4): `reserveChallengeAttempt` —
    `findOneAndUpdate({tokenHash, purpose, expiresAt > now, attempts < 5}, {$inc: {attempts: 1}})`; неверный код только гасит
    исчерпанный вызов (`dropExhaustedChallenge`). Старт подключения попытку не тратит (`findLiveChallenge`).
15. **Нечитаемый секрет** (MEDIUM-5): `matchTotp` ловит ошибку расшифровки → лог `secret_unreadable uid=…` и `503
    TOTP_UNAVAILABLE`. Код `TOTP_UNAVAILABLE` в контрактах, i18n и `error-messages` уже был — новый не вводили.
16. **Подключи ключа** (MEDIUM-6): `panelTotpKeys` — HKDF-SHA256 из `PANEL_TOTP_KEY` (salt пустой, info
    `panel-totp-enc` / `panel-recovery-hmac`, 32 байта) для AES-GCM и HMAC кодов. Миграции нет: данных на проде нет,
    на dev 2FA не подключали.
17. **ADR-0024 «Последствия»** (LOW-7): остаточный риск D2 при `PANEL_TOTP_ENFORCED=true` и порядок включения флага;
    то же — в runbook деплоя.

**Фиксы ревью pass 2** (Codex):

18. **Сессия без фактора — под замком сотрудника** (CRITICAL-1): `openWithoutFactor` — первой операцией транзакции
    `lockMember` (`$inc version` члена), под замком перечитываются член и 2FA: 2FA уже активна — вызов `totpRequired`,
    обязательна — `totpSetupRequired`, член снят — `403 PANEL_ACCESS_DENIED`. Подтверждение подключения (настройки и
    экран входа) тоже берёт `lockMember` в своей транзакции — конфликт записи упорядочивает их. Побочный эффект: вход
    без фактора теперь сериализуется и со снятием роли — тест `panel-races` «роль снята между проверкой членства и
    выдачей сессии» ждёт повтора снятия (`untilBlocked`), итог тот же (сессия отозвана, `me` — 401).
19. **«Безопасность» без сети** (HIGH-2): статус на паузе (`fetchStatus: 'paused'`) без данных — `ErrorState
    offline` («Нет соединения», «Повторить»), а не вечный скелетон.
20. **Погашение вызова — только живого** (MEDIUM-3): `consumeChallenge(tx, id, now)` — фильтр `expiresAt > now` в
    транзакции второго шага; истёк между резервированием и погашением — `401 TOTP_CHALLENGE_EXPIRED`, транзакция
    откатывается. Уборка негодного вызова (`expire`) — без условия срока.

## 8.3 Security checklist

См. §4 — выполнено; проверки — §12.

## 10. Documentation Sync

- `docs/adr/0024-panel-totp.md` — новый ADR; ревью pass 1: подключи HKDF, эпоха в принятии кода, резерв попытки,
  перепроверка устройства в транзакции, нечитаемый секрет — 503, «Последствия» — остаточный риск D2 и порядок
  включения `PANEL_TOTP_ENFORCED`.
- `docs/adr/0009-admin-panel-access.md` («Последствия» → ADR-0024), `docs/adr/README.md` (индекс).
- `docs/product/admin-panel.md` — 2FA сотрудника, «Безопасность», сброс в «Сотрудниках».
- `docs/runbooks/deploy.md` — `PANEL_TOTP_KEY`, `PANEL_TOTP_ENFORCED`, аварийный `reset-totp`, порядок включения флага.
- `.claude/rules/pokatim-security.md`, `pokatim-db.md`, `pokatim-backend.md` — инварианты 2FA (ключи, вызов, эпоха,
  устройство, писатель).
- `infra/deploy/env.template`, `infra/.env.example`, `docker-compose.yml` — новые переменные.

## 12. Outcome

### Сделано

- Контракты (`admin/totp.schema.ts`, `session.schema.ts`, `members.schema.ts`, `audit.schema.ts`, `common.ts`): коды,
  вызов, новые состояния входа, `TotpSetup`/`TotpStatus`, `PanelMe.user.totp`, `MemberRow.totpEnabled`, ошибки,
  пять действий журнала; клиент `api-client/admin.ts`.
- API, модуль `panel`: `totp.ts` (RFC 6238 + base32 на `node:crypto`), `totp-secret-box.ts` (AES-256-GCM, AAD userId),
  `recovery-codes.ts` (HMAC), `panel-totp-codes.ts` (проверка кода + лимиты D8), `PanelAccountTotpService` и
  контроллер `/v1/admin/account/totp/*`, шаги входа `sign-in/totp`, `sign-in/totp-setup(/confirm)` и cookie
  устройства, сброс `members/:userId/totp/reset`, `secondFactor` сессии, писатель — `PanelRepository`.
- Миграция `0040_panel_totp` (коллекции `panel_totp`, `panel_sign_in_challenges`, `panel_trusted_devices`, TTL).
- Env `PANEL_TOTP_KEY` / `PANEL_TOTP_ENFORCED` (+ отказ старта без ключа), `env.template`, `docker-compose.yml`,
  `.env.example`, `rehearsal.sh`, runbook деплоя; CLI `reset-totp --email`.
- Админка: шаг кода и подключение на экране входа (`TotpSignInSteps`), общий `TotpEnrollment`, `QrCode` (свой `<svg>`),
  экран «Безопасность» (`/account/security`), баннер на «Обзоре», колонка и сброс 2FA в «Сотрудниках», i18n
  `admin.totp.*`/`admin.security.*`.
- Документы: ADR-0024, ADR-0009 «Последствия», `docs/product/admin-panel.md`, правила `pokatim-security/db/backend`.

### Тесты

Матрица §5 закрыта: `totp.test.ts` (8), `totp-secret-box.test.ts` (3), `recovery-codes.test.ts` (3),
`totp.schema.test.ts` (9), `session.schema.test.ts` (11), `panel-totp-sign-in.int.test.ts` (13),
`panel-account-totp.int.test.ts` (7), `panel-members.int.test.ts` (14), `panel-cli.int.test.ts` (7), `env.test.ts` (23),
`admin-routes.test.ts` (4), `migrations.int.test.ts` (39), `SignInScreen.test.tsx` (21), `SecurityScreen.test.tsx` (5),
`MembersScreen.test.tsx` (10).

### Проверки

`pnpm check` (format → lint → depcruise → typecheck → test, `TURBO_CONCURRENCY=1`, отдельные Mongo DB / Redis db) после
слияния `origin/develop` — зелёный, 15/15 задач turbo: api 196 файлов / 2016 тестов, admin 40 / 396, app 239 / 2256,
contracts 47 / 426, design-tokens 5 / 604, tracks 22 / 307, api-client 21 / 148, route-view 10 / 51, i18n 2 / 15;
depcruise — 0 нарушений (2079 модулей).

### Фиксы ревью pass 1

Замечания Codex (CRITICAL-1, HIGH-2, HIGH-3) и Claude (MEDIUM-4…6, LOW-7…9) — §8.2 п. 2, 11–17, §10. Красные тесты до
правки → зелёные:

- `panel-totp-sign-in.int.test.ts` (+5): сброс 2FA между проверкой устройства и сессией (ворота после
  `findLiveTrustedDevice`) — `totpRequired`, живых сессий 0; новая эпоха между чтением 2FA и принятием кода TOTP / кода
  восстановления — 400, сессии нет; 8 параллельных неверных кодов (все держатся на лимите до проверки) — проверок ≤ 5,
  5 × 400 + 3 × 401; нечитаемый секрет — `503 TOTP_UNAVAILABLE`.
- `panel-account-totp.int.test.ts` (+3): перевыпуск кодов и отключение (код TOTP / восстановления) по старой эпохе —
  400, без изменений и журнала.
- `totp-secret-box.test.ts` (+2): подключи HKDF, секрет не открывается мастер-ключом, HMAC — подключом.
- `SecurityScreen.test.tsx` (+3): confirm / перевыпуск успешны, перечитка статуса падает — коды остаются, баннер
  «Повторить»; без данных — полноэкранная ошибка.

`pnpm check` (`TURBO_CONCURRENCY=1`, Mongo DB `pokatim_2fafix_test`, Redis db 11) — зелёный, 15/15 задач turbo: api
196 файлов / 2034 теста, admin 40 / 399, app 240 / 2266, contracts 47 / 429, design-tokens 5 / 604, tracks 22 / 307,
api-client 21 / 148, route-view 10 / 51, i18n 2 / 15; depcruise — 0 нарушений (2082 модуля).

### Фиксы ревью pass 2

Замечания Codex (CRITICAL-1, HIGH-2, MEDIUM-3) — §8.2 п. 18–20. Красные тесты до правки → зелёные:

- `panel-totp-sign-in.int.test.ts` (+4): подключение 2FA между первым чтением 2FA и сессией (ворота после
  `findTotp`) — было `signedIn`, стало `totpRequired`, сессий по паролю не прибавилось; с замком — подтверждение в
  настройках повторяется (`lockMember` ≥ 2 раз) и не коммитится, пока открыта транзакция входа; отрицательное
  доказательство — без замка активация коммитится посреди входа и сессия по паролю выдаётся при активной 2FA; вызов
  истёк между резервированием и погашением — было 200, стало `401 TOTP_CHALLENGE_EXPIRED`, код восстановления не
  погашен.
- `SecurityScreen.test.tsx` (+1): первое открытие без сети («кто я» в кэше) — «Нет соединения» и «Повторить», без
  скелетона (было: вечный скелетон).
- `panel-races.int.test.ts`: «роль снята между проверкой членства и выдачей сессии» — снятие теперь ждёт замок входа
  (`untilBlocked`), проверки итога прежние.

`pnpm check` (`TURBO_CONCURRENCY=1`, Mongo DB `pokatim_2fafix_test`, Redis db 11) — зелёный, 15/15 задач turbo: api
196 файлов / 2038 тестов, admin 40 / 400, app 240 / 2266, contracts 47 / 429, design-tokens 5 / 604, tracks 22 / 307,
api-client 21 / 148, route-view 10 / 51, i18n 2 / 15; depcruise — 0 нарушений (2082 модуля). Два предыдущих прогона
под нагрузкой машины (load ~17) падали на посторонних тестах (`results-read` — таймаут 20 с, `notifications-delivery`
— лимиты в Redis); отдельно оба зелёные (10/10, 30/30), третий полный прогон — зелёный.

### NOT VERIFIED

- Playwright e2e админки и смоук стенда (вне `pnpm check`; сценария 2FA нет — §8.2 п.10).
- Ручная проверка в браузере и на реальном приложении-аутентификаторе (сканирование QR).
- `bootstrap.sh` / деплой с `PANEL_TOTP_KEY` на dev; CI ветки.
- Независимое ревью (Codex / independent-reviewer) по этой ветке.
