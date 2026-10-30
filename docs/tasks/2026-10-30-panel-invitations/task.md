# task.md — panel-invitations

## 1. Title

Панель «Протокол»: приглашение в команду по e-mail (ссылка с ролью, срок, отзыв, принятие → вход) и письма о выдаче,
смене и снятии роли.

## 2. Goal

Follow-up из `docs/product/admin-panel.md` §«Доступ»: «Выдача роли адресу без аккаунта — ошибка (приглашение на
регистрацию — follow-up)», «Письма о выдаче и снятии роли нет (follow-up вместе с приглашением)». ADR-0009 (один
аккаунт на человека, роль — данные `panel`, сессия панели, журнал append-only), ADR-0024 (2FA на входе).

Сейчас админ может выдать роль только существующему подтверждённому пользователю. Нужно: пригласить любой адрес,
приглашённый сам заходит по ссылке (регистрируется в приложении, если аккаунта нет), принимает приглашение своим
паролем и сразу входит в панель; сотрудник получает письмо, когда ему выдали, сменили или сняли роль.

## 3. Scope

**API (`apps/api/src/modules/panel`)**
- Коллекция `panel_invitations` (миграция `0041_panel_invitations`): приглашение = нормализованный e-mail, роль, имя в
  панели, кто пригласил, `createdAt`, `expiresAt` (7 суток, `PANEL_POLICY.invitationTtlMs`), статус
  `pending | accepted | revoked`, `acceptedUserId`, `acceptedAt`/`revokedAt`, `version` (замок), `purgeAt` (TTL-индекс:
  документ удаляется через 30 суток после закрытия/истечения — e-mail не хранится вечно). Уникальный частичный индекс
  `email` при `status: 'pending'` — одно живое приглашение на адрес.
- Токен: `HMAC(EMAIL_TOKEN_SECRET, "panel-invitation:" + id)` (как ссылки identity — ретрай письма даёт ту же ссылку,
  сырого токена нет нигде); в БД — только `tokenHash = sha256(token)` (уникальный индекс). Сам токен — только в письме.
- Эндпоинты (`members.manage`, кроме публичных):
  - `GET /v1/admin/invitations` — живые приглашения (`pending`, не истёкшие; истёкшие `pending` — тоже, со статусом
    «истекло» на клиенте по `expiresAt`), до cap, новые сверху; поле `invitedBy` — имя из `panel_members`.
  - `POST /v1/admin/invitations` `{ email, displayName, role }` → 201. Адрес уже активного члена — `409
    PANEL_ALREADY_MEMBER`. Есть живое `pending` на тот же адрес — заменяется (старое `revoked`, новое — одной
    транзакцией): это и есть «Отправить повторно». Аккаунта может не быть — это нормально. Журнал
    `panel.invitation_sent { roleTo }` (без e-mail; `subject` — приглашение `Приглашение ·<id>`), outbox
    `panel.invitation-email-requested { invitationId }`.
  - `POST /v1/admin/invitations/:id/revoke` → 204 (без причины). Не `pending` — 404. Журнал `panel.invitation_revoked`.
  - `POST /v1/admin/invitations/lookup` `{ token }` (`@Public`, IP-лимит) → `{ role, displayName, expiresAt }`; токен
    неизвестен / истёк / отозван / принят — `410 PANEL_INVITATION_INVALID` (одна ошибка на всё, без утечки состояния).
    Токен — в теле, не в URL (логи).
  - `POST /v1/admin/invitations/accept` `{ token, email, password }` (`@Public`) → тот же ответ, что
    `POST /admin/session/sign-in` (`PanelSignInResponse`: `signedIn` + cookie, `totpRequired`, `totpSetupRequired`,
    `verificationRequired`). Порядок: проверка пароля тем же портом `PanelCredentials.verify` (общие лимиты `signin-*`,
    401 как у входа) → аккаунт подтверждён (иначе `verificationRequired` как у входа) → e-mail аккаунта == e-mail
    приглашения (иначе `409 PANEL_INVITATION_EMAIL_MISMATCH`) → транзакция: `lockAdmins` (если роль `admin`) →
    замок приглашения (`$inc version` при `status: 'pending'`, `expiresAt > now`; нет — `410
    PANEL_INVITATION_INVALID`) → `lockMember` → уже `active` — `409 PANEL_ALREADY_MEMBER` (приглашение не гасится) →
    активация (`activate()` из `PanelMembersService`: новый или повторная активация снятого) → приглашение `accepted`
    → журнал `panel.invitation_accepted` (актор — сам приглашённый, `targetUserId` — он же, `details.roleTo`) → outbox
    письма о роли **не** пишется (человек сам принял). Затем — продолжение входа как после верного пароля
    (2FA-ветки ADR-0024 без повторной проверки пароля): рефактор `PanelSessionService.signIn` →
    `continueAfterCredentials(verified, previousToken, deviceToken)`.
- Письма о роли: `grant`, `changeRole`, `revoke` (и CLI `grant-admin`) в своей транзакции пишут outbox
  `panel.role-email-requested { auditId }` (id записи журнала). Сброс 2FA — без письма (вне scope).
- Worker: `PanelWorkerModule` + очередь `QUEUE.panelEmail = 'panel-email'`, один процессор по имени задачи:
  - приглашение: читает приглашение; не `pending` или истекло — `skipped`; ссылка
    `${panelLinkBase}invite#token=<token>`; at-least-once без захвата (дубль — та же ссылка, безвреден, как «Пароль
    изменён»);
  - роль: читает запись журнала по id; адрес — `IdentityAccounts.emailsOf` в момент отправки (удалён — `skipped`);
    тексты «Вам выдана роль …», «Ваша роль изменена: … → …», «Ваша роль … снята» (без причины — её пишет админ для
    журнала); ссылка «Открыть панель» — `panelLinkBase`.
  - `panelLinkBase`: env `PANEL_LINK_BASE` (optional, `http(s)://…/` с завершающим слешем; для `pnpm dev` админки в
    корне) → иначе `${APP_WEB_ORIGIN}/admin/` → иначе нет: создание приглашения — `503 PANEL_INVITATIONS_UNAVAILABLE`,
    письмо о роли — без кнопки.
- Письма — `htmlEmail`/`buttonHtml`/`escapeHtml` из `modules/identity` (как tickets). Логи — только id, без адреса.

**Contracts (`packages/contracts/src/admin`)** — `invitations.schema.ts`: `PanelInvitation`, `PanelInvitationList`,
`InviteRequest`, `InvitationLookupRequest`/`Response`, `InvitationAcceptRequest`; новые коды ошибок; действия журнала
`panel.invitation_sent`, `panel.invitation_revoked`, `panel.invitation_accepted` (в конец `AUDIT_ACTIONS`); при нужде
— `AuditSubjectKind` `invitation`. api-client — методы.

**Admin (`apps/admin`)**
- «Сотрудники»: кнопка «Пригласить» (`members.manage`) → окно (e-mail, имя в панели, роль) → «Отправить приглашение»;
  под таблицей сотрудников — блок «Приглашения»: e-mail, имя, роль, пригласил, отправлено, действует до / «Истекло»,
  действия «Отправить повторно» (тот же POST) и «Отозвать» (подтверждение без причины). Пусто — блока нет или пустое
  состояние «Приглашений нет». Ошибка `NOT_FOUND` в «Выдать роль» — подсказка «Аккаунта нет — отправьте приглашение».
- Публичный экран `/invite` (вне каркаса, как «Вход»): токен из `location.hash` (`#token=…`), сразу убирается из
  адреса (`history.replaceState`); `lookup` → «Вас пригласили в команду платформы «Покатим»: роль …, действует до …»;
  форма e-mail + пароль → «Принять и войти»; ответ — как у входа (те же шаги 2FA `TotpSignInSteps`, затем «Обзор»).
  Подсказка: «Нет аккаунта? Зарегистрируйтесь в приложении «Покатим» на этот адрес, подтвердите e-mail и вернитесь по
  ссылке». Недействительная ссылка — «Приглашение недействительно — попросите администратора отправить новое».
- «Журнал действий» — подписи трёх новых действий.

**Уточнения architect (PLAN; подробности — 8.1, порядок операций — §11)**
- accept: сначала снимок приглашения по токену (410 до пароля), затем пароль, e-mail, транзакция с первой операцией
  `IdentityAccounts.lockAccountState` (RC-2, RC-3); cookie устройства на accept не видна (RC-4).
- Создание гасит любое `pending` адреса, в т. ч. истёкшее (RC-5); закрытие пишет `email: null` (RC-6).
- `emailState` приглашения — видимый провал письма (RC-7); подпись объекта журнала — имя в панели (RC-8);
  `GET` — `members.read`, признак `expired` — от сервера (RC-10); лимит приглашений на сотрудника (RC-9).
- Отдельный `PanelInvitationsRepository` — единственный писатель `panel_invitations`; ADR — новый 0026.

## 4. Out of Scope

- Регистрация аккаунта прямо в панели (только в приложении — один аккаунт на человека, ADR-0009).
- Письмо о сбросе 2FA, о входе; рассылки; настройка срока жизни из UI.
- Принятие приглашения уже вошедшим в панель сотрудником без пароля.
- Изменение правил `.claude/rules/*`.

## 5. Architecture Context

- api (panel, worker), contracts, api-client, admin, i18n; миграция `0041`; новая очередь `panel-email`, события outbox
  `panel.invitation-email-requested`, `panel.role-email-requested` (маршрут — `panelOutboxRoutes` в `worker.module.ts`).
- Совместимость: только новые эндпоинты и поля; старые клиенты не затронуты.

## 5.1 Placement & Reuse Gate

- Reuse: `PanelCredentials.verify`, `PanelSessionService` (2FA-ветки), `PanelMembersService.activate`/`runWithInsertRetry`,
  `PanelRepository.lockAdmins/lockMember`, `PanelAudit.append`, `randomToken/sha256` и HMAC-вывод токена как в
  `identity/tokens.ts`, `htmlEmail/buttonHtml/escapeHtml`, `MAILER`, `MongoOutboxReader`, outbox-запись как у identity
  /tickets; admin — `Dialog`, `ReasonDialog`/подтверждение, `DataTable`, `TotpSignInSteps`, `field-errors`.
- Запрещено: второй путь проверки пароля, копия 2FA-логики входа, e-mail в журнале/логах/payload outbox, сырой токен в
  БД, импорт внутренностей identity мимо `index.ts`.
- Единственный писатель `panel_invitations` — отдельный `PanelInvitationsRepository` в модуле panel (architect:
  `PanelRepository` уже ~520 строк и пишет 7 коллекций; образец — `MaterialsRepository` в `tickets`). Журнал —
  по-прежнему только `PanelAudit` → `PanelRepository.insertAudit`.
- Reuse (architect): `normalizeEmail` из `@pokatim/contracts` (им нормализуют `CredentialsCheck` и
  `IdentityAccounts.findVerifiedByEmail`); `IpRateLimitGuard`/`@IpRateLimit` из `src/public-read.guard.ts`;
  `consumeUserLimit` (`src/user-limit.ts`); HMAC-токен — по образцу `tickets/ticket-qr.ts` (`identity.LinkPurpose` не
  расширяется); `TotpStep`/`TotpSetupStep` — как есть; `UnverifiedCard` — вынос из `SignInScreen.tsx`;
  `GrantRoleDialog` — режим `invite` вместо второй формы.

## 6. Relevant Files

- `apps/api/src/modules/panel/panel-members.service.ts` — выдача/смена/снятие, `activate`, замки.
- `apps/api/src/modules/panel/panel-session.service.ts`, `panel-session.controller.ts` — вход, 2FA, cookie.
- `apps/api/src/modules/panel/panel.repository.ts`, `panel.collection.ts`, `panel.policy.ts`, `panel-core.module.ts`.
- `apps/api/src/modules/identity/tokens.ts`, `jobs/link-email.handler.ts`, `jobs/password-changed-email.handler.ts`.
- `apps/api/src/modules/tickets/jobs/*`, `mail/ticket-email.ts` — образец письма/процессора чужого модуля.
- `apps/api/src/worker.module.ts`, `queues.ts`, `db/migrations/0040_panel_totp.ts`, `config/env.ts`.
- `packages/contracts/src/admin/{members,audit,session}.schema.ts`.
- `apps/admin/src/features/members/*`, `features/sign-in/*`, `router.tsx`, `features/audit/*`.

## 7. Implementation Notes

- Гонки (замки — первым действием транзакции, тесты-ворота с отрицательным доказательством):
  - два параллельных `accept` одного приглашения → ровно одна активация и одна запись журнала;
  - `accept` ↔ `revoke` → либо принято, либо отозвано, не оба;
  - два параллельных `POST /invitations` на один адрес → одно `pending` (уникальный частичный индекс + повтор);
  - `accept` admin-приглашения сериализуется с понижением/снятием админов (`lockAdmins`).
- (architect, RC-15) отрицательное доказательство — для accept ↔ revoke и accept ↔ повторное приглашение;
  два accept одного приглашения уже сериализует `lockMember` (принять может только один аккаунт), `lockAdmins` на
  accept — единый порядок замков без инварианта для отрицательного доказательства.
- `accept` по истёкшему приглашению — 410 даже если документ ещё `pending`.
- E-mail нормализуется так же, как в identity — `normalizeEmail` из `@pokatim/contracts` (`trim().toLowerCase()`;
  architect).
- Принятие при `PANEL_TOTP_ENFORCED` и роли admin без 2FA → `totpSetupRequired` (тот же экран подключения).
- Под нагрузкой int-тесты флакают на таймаутах — перезапуск файла отдельно.

## 8. Risks / Assumptions / Open Questions

- Предположение (решение оркестратора, автономный режим): срок жизни 7 суток; приглашение требует аккаунт приложения
  с тем же e-mail (регистрация в приложении), принятие — паролем; письмо о роли и при смене роли тоже.
- Риск: ссылка-приглашение = возможность получить роль тому, кто владеет почтой адресата (та же модель, что сброс
  пароля). Компенсация: привязка к e-mail аккаунта, пароль, срок, отзыв, журнал.
- Риск: `PANEL_LINK_BASE`/`APP_WEB_ORIGIN` не задан на стенде → приглашения 503 (явно, не тихо).

## 8.1 Requirements Consistency (заполняет architect)

Проверено по коду `origin/develop` (167f4d7f). Блокеров нет; статус **CONCERNS** — RC-1 требует решения оркестратора
(правило), остальное — решения architect, внесённые в §3/§7/§11 (помечены «architect»).

- **RC-1 (конфликт с правилом).** `pokatim-backend.md`: «Новые `@Public()` — только шаги входа с вызовом
  (`admin-routes.test.ts` перечисляет их явно)». `accept` — вход паролем (укладывается), `lookup` — чтение по
  капабилити-токену (не укладывается). §4 запрещает правку правил.
  Варианты: (a) снять запрет §4 на одну строку: в `pokatim-backend.md` и `pokatim-security.md` (раздел «Панель») —
  «+ `invitations/lookup`, `invitations/accept` (ADR-0026)»; (b) без `lookup`: экран `/invite` без превью роли,
  роль видна только после принятия — хуже UX и AC10; (c) `lookup` как шаг под `admin/session/*` — формально «шаг
  входа», по сути то же нарушение. **Рекомендация (a)**; до решения coder реализует как (a), правку правила делает
  тем же PR только с разрешения оркестратора (иначе — follow-up в `pr.md`).
- **RC-2 (порядок accept, architect).** В §3 пароль проверяется первым. Тогда мусорный токен с чужим e-mail тратит
  argon2 и счётчики `signin-*` жертвы. Решение: сначала IP-лимит и снимок приглашения по `tokenHash` (`pending`,
  `expiresAt > now`, иначе `410` без проверки пароля) → пароль → сверка e-mail → транзакция. Токен знает только
  владелец ящика — 410 до пароля ничего не раскрывает.
- **RC-3 (гонка с удалением аккаунта и сбросом пароля, architect).** `PanelCredentials.verify` для подтверждённого
  аккаунта — без транзакции; между проверкой и активацией аккаунт может быть удалён (A11: удалённый получит роль) или
  сменён пароль. Решение: **первой** операцией транзакции accept — `IdentityAccounts.lockAccountState(tx, userId)`
  (санкционированная запись порта, как `PanelTotpGuard`): не `active` или штамп ≠ `verified.credentialsStamp` —
  `401 INVALID_CREDENTIALS`. Затем `lockAdmins` (если роль admin) → `lockPending` приглашения → `lockMember`.
- **RC-4 (cookie устройства не видна, architect).** `PANEL_DEVICE_COOKIE.path = /v1/admin/session`, а accept — под
  `/v1/admin/invitations`: «запомненное устройство» на accept не работает, сотрудник с уже активной 2FA (повторная
  активация снятого) всегда получает шаг кода. Варианты: (a) принять — `deviceToken = undefined` (рекомендация:
  редкий случай, путь cookie ADR-0024 не трогаем); (b) перенести accept под `admin/session/invitation/accept`;
  (c) расширить путь cookie — нет. Cookie сессии (`/v1/admin`) видна — прежняя сессия браузера отзывается
  (`superseded`), как у входа.
- **RC-5 (уникальный индекс и истёкшие, уточнение).** Частичный уникальный `email` при `status: 'pending'` держит и
  истёкшие `pending`: создание приглашения гасит **любое** `pending` адреса (в т. ч. истёкшее), не только «живое».
- **RC-6 (хранение e-mail, architect).** Закрытие приглашения (принято, отозвано, заменено) пишет `email: null` —
  адрес хранится только у `pending`; `purgeAt`: `pending` — `expiresAt + 30 сут` (блок «Истекло» виден месяц),
  закрытые — `закрытие + 30 сут`. Порт стирания не нужен: данные по адресу, не по `userId`, живут ≤ 37 сут. В
  журнал, outbox, логи адрес не попадает.
- **RC-7 (финальный провал письма — видимое состояние, `backend.md`).** В §3 письмо приглашения «at-least-once без
  захвата», провал не виден. Решение: поле `emailState: 'pending' | 'sent' | 'failed'` в приглашении (worker — одна
  условная запись по `_id` и `status: 'pending'`), блок «Приглашения» показывает «Письмо не отправлено» →
  «Отправить повторно». Письма о роли — лог `panel.role_email_failed audit=<id>` + failed-набор BullMQ (принятый
  риск: факт смены роли виден в «Сотрудниках» и журнале, письмо информационное).
- **RC-8 (подпись объекта журнала, architect).** `Приглашение ·<id>` в колонке «Объект» бесполезна. Решение:
  `subject = { kind: 'invitation', id, label: displayName }` — имя, введённое админом (тот же класс данных, что
  `panel_members.displayName`, тоже хранится бессрочно). Альтернатива — оставить id-подпись (если оркестратор
  считает имя неприглашённого лишним в append-only журнале).
- **RC-9 (злоупотребления, добавлено).** Админ (или украденная сессия) может слать письма на любые адреса. Лимит
  `panel-invitations-user:<uid>` 30/ч (`consumeUserLimit`, `src/user-limit.ts`) после права, до БД. Публичные:
  `@IpRateLimit('panel-invitation-lookup', 60/15 мин)`, `@IpRateLimit('panel-invitation-accept', 20/15 мин)` (+
  общие `signin-*` у пароля).
- **RC-10 (право списка).** `GET /v1/admin/invitations` — `members.read` (как список сотрудников, тот же состав
  ролей сегодня), мутации — `members.manage`. Признак «истекло» — поле `expired` от сервера по `CLOCK` (инвариант 1),
  не вычисление клиента.
- **RC-11 (уже активный член на accept).** По §3 — `409 PANEL_ALREADY_MEMBER`, приглашение остаётся `pending`.
  Оставлено (админ отзовёт; закрывать «принятым» без активации — ложная запись журнала).
- **RC-12 (accept зафиксирован, продолжение входа упало).** Транзакция accept и сессия — разные транзакции: после
  коммита возможны `503 TOTP_UNAVAILABLE` (снятый сотрудник с оставшейся 2FA, нет ключа) и `403` (роль сняли
  между). Повтор accept даёт `410`. Экран `/invite` на `410` показывает «Приглашение недействительно или уже
  принято» + кнопку «Войти» (`/sign-in`), на прочие ошибки после отправки формы — то же + текст ошибки.
- **RC-13 (наследие, вне scope).** Снятие роли не удаляет `panel_totp`: повторно активированный (и `grant`, и
  accept) получит шаг кода со старым приложением-аутентификатором. Существующее поведение `grant`; follow-up.
- **RC-14 (CLI).** `PanelCliModule` не подключает outbox — после добавления `MongoOutboxWriter` в
  `PanelMembersService` CLI упадёт на DI. Нужен `MongoOutboxModule` в `PanelCliModule` (только MongoDB; coder
  проверяет, что писатель не тянет Redis — иначе провайдер `MongoOutboxWriter` напрямую) + тест CLI на событие.
- **RC-15 (ворота гонок §7, уточнение).** Принять приглашение может только аккаунт с его e-mail (один `userId`):
  два параллельных accept уже сериализует `lockMember` — тест позитивный, отрицательное доказательство осмысленно
  только для accept ↔ revoke и accept ↔ повторное приглашение (без `lockPending` обе транзакции коммитятся:
  приглашение `revoked`, сотрудник активен). `lockAdmins` на accept admin-приглашения не защищает инвариант
  «≥ 1 админ» (добавление его не нарушает) — держим для единого порядка замков (как `grant`), тест — сериализация
  без отрицательного доказательства. Два POST на адрес — уникальный частичный индекс + повтор транзакции (доказательство —
  один `pending`, второй ответ 201, путь повтора пройден — шпион на вставку вызван дважды).
- **RC-16 (`PANEL_LINK_BASE`).** Нужен: `APP_WEB_ORIGIN` — только https, а `pnpm dev` (админка в корне на своём
  порту) и `pnpm e2e:admin` (`vite preview` под `/admin/`) — http. Оставлен optional; при `NODE_ENV=production` и
  `DEPLOY_STAGE=prod` — только https (`envDependencyErrors`).
- **RC-17 (неподтверждённый на accept).** `PanelCredentials.verify` для неподтверждённого перевыпускает токен
  регистрации (как вход) — ответ `verificationRequired`, приглашение не трогается; экран `/invite` переиспользует
  карточку «E-mail не подтверждён» (`UnverifiedCard`, вынести из `SignInScreen.tsx`).

## 8.2 Deviations from spec

1. **`lookup` нет** (решение оркестратора по RC-1): схем `InvitationLookupRequest/Response`, метода api-client и
   IP-лимита `panel-invitation-lookup` нет; экран `/invite` — общий текст без роли и срока (они в письме),
   недействительная ссылка узнаётся по `410` на `accept` (или сразу, если в адресе нет токена).
2. **`subject.label` = `Приглашение ·<последние 6 символов id>`** (решение оркестратора по RC-8) — тот же формат, что
   `Участник ·<id>` (`id.slice(-6)`); полный id — в `subject.id`.
3. **`PanelInvitationsService` и `PanelInvitationAccept` — в `PanelModule`, не в `PanelCoreModule`:** лимит
   `panel-invitations-user` требует `RateLimiter` (Redis), а `PanelCoreModule` поднимает CLI без Redis. В
   `PanelCoreModule` — только `PanelInvitationsRepository` (его берёт worker).
4. **`PanelInvitationsRepository` не использует `panelCollections()`** — только свою коллекцию: сторож append-only
   (`panel.repository.test.ts`) разрешает знать журнал по имени лишь `PanelRepository` и описанию коллекций.
5. **`PanelAudit.append` возвращает id записи** — единственный вызывающий с явным `Promise<void>`
   (`results-protocol.service.ts`, `journal`) переписан на `async`/`await` без смены поведения.
6. **Письмо о снятии роли тоже с кнопкой «Открыть панель»** (§3: ссылка — у писем о роли без исключений).
7. **Подсказка «Аккаунта нет — отправьте приглашение»** — отдельный ключ `admin.members.error.grantNotFound`, только в
   «Выдать роль» (ревью pass 1, MEDIUM); общий `admin.members.error.NOT_FOUND` — прежний текст; отзыв приглашения на
   404 — «Приглашение уже принято или отозвано.». В «Выдать роль» под полем — ещё кнопка «Отправить приглашение»
   (окно переключается в режим `invite` с теми же полями).
8. **Правила `.claude/rules/*` не правились** (запрет §4 и задания): строки о `panel_invitations` (`pokatim-db.md`),
   `accept` как `@Public` шаге входа (`pokatim-backend.md`, `pokatim-security.md`) — follow-up в `pr.md`.
9. **БД тестов — `pokatim_invites_test`** (задание: `pokatim_invites`): `@rkarakulov/test-kit` требует суффикс
   `_test` (иначе globalSetup падает); изоляция та же.
10. **Что держит гонки принятия (ревью pass 1, LOW).** Инвариант «принято XOR отозвано» держат две перепроверки
    статуса в транзакции принятия: `lockPending` (условие `pending` + не истекло, запись `$inc version`) и
    `markAccepted` (условие `pending`, `matchedCount` 0 — откат, 410). Запись-замок `$inc version` задаёт порядок: отзыв
    или замена посреди транзакции принятия ждёт её (повтор транзакции) и получает 404/новое приглашение после
    принятия; без `$inc` (условное чтение) отзыв проходит посреди принятия, а принятие получает 410 уже от конфликта
    записи `markAccepted` — рассогласования нет, меняется только победитель. Поэтому отрицательное доказательство
    инварианта — «без перепроверки статуса» (`lockPending` — чтение без условия, `markAccepted` — без записи: обе
    операции коммитятся), а доказательство самого замка — ворота внутри транзакции (с `$inc` отзыв ждёт и получает
    404; без `$inc` — проходит 204, принятие 410).
11. **Ротация `EMAIL_TOKEN_SECRET`** (ревью pass 1): `accept` после снимка сверяет `tokenHash` с выводом из текущего
    секрета и id (`timingSafeEqual`), несовпадение — 410; worker письма при несовпадении — `skipped` и
    `emailState: 'failed'` («Письмо не отправлено» → «Отправить повторно» выдаст новую ссылку).

## 8.3 Security checklist

Затронуто: AuthZ (`members.manage`, публичные lookup/accept), токены (только хеш, HMAC-вывод), лимиты (общие
`signin-*` для accept, IP-лимит для lookup), данные наружу (lookup не раскрывает e-mail и состояние), журнал без e-mail,
логи без адреса и токена, токен в фрагменте URL (не уходит на сервер и в Referer).

## 9. Acceptance Criteria

1. Админ приглашает адрес без аккаунта → письмо со ссылкой; регистрация в приложении, подтверждение, ссылка → ввод
   пароля → сотрудник с ролью, вход в панель (с 2FA-шагом при необходимости); журнал: `invitation_sent`,
   `invitation_accepted`.
2. Повторное приглашение того же адреса гасит прежнюю ссылку (410), работает новая.
3. Отозванное, принятое, истёкшее (> 7 суток) приглашение — 410 и на lookup, и на accept.
4. Accept чужим аккаунтом (другой e-mail) — 409 `PANEL_INVITATION_EMAIL_MISMATCH`, роль не выдана.
5. Неверный пароль на accept — 401 и счётчик `signin-*` тот же, что у входа.
6. Выдача, смена, снятие роли (и CLI `grant-admin`) → письмо сотруднику; удалённый аккаунт — пропуск; в письме нет
   причины.
7. Гонки из §7 — тестами-воротами с отрицательным доказательством.
8. Модератор/организатор — 403 на управление приглашениями; публичные эндпоинты не раскрывают e-mail.
9. В БД нет сырого токена; в журнале и логах — нет e-mail.
10. Admin: окно «Пригласить», блок «Приглашения» (скелетон/ошибка/пусто по §4.12), экран `/invite`, подписи журнала;
    тесты экранов.
11. `pnpm check` зелёный.
12. (architect) Провал письма приглашения после всех попыток виден в блоке «Приглашения» («Письмо не отправлено»);
    удаление аккаунта между проверкой пароля и принятием — 401, роль не выдана; CLI `grant-admin` ставит письмо.

## 10. Documentation Impact

- `docs/product/admin-panel.md` — «Доступ» (приглашения вместо follow-up, письма о роли), журнал (новые действия).
- **Новый ADR-0026** «Приглашения в команду панели» (architect: новый вид капабилити-ссылки, дающей роль; публичные
  эндпоинты панели; письма о роли — решение уровня ADR, не правка 0009) + строка в `docs/adr/README.md`; в ADR-0009
  (Последствия) — ссылка «Выдача роли без аккаунта — приглашение, ADR-0026».
- `docs/runbooks/local-dev.md` — `PANEL_LINK_BASE` для `pnpm dev`; `docs/runbooks/deploy.md` — стенд/прод берут
  ссылку от `APP_WEB_ORIGIN` (`/admin/`), `PANEL_LINK_BASE` — только при другом адресе панели; `apps/api/.env.example`.
- `.claude/rules/pokatim-backend.md` («Новые `@Public()`») и `pokatim-security.md` («Панель») — строка о `lookup`/`accept`
  (RC-1, только с разрешения оркестратора; иначе follow-up в `pr.md`); `pokatim-db.md` («Панель») — `panel_invitations`
  (тот же вопрос).
- `pr.md` — новая миграция `0041`, новый env, новая очередь `panel-email`.

## 11. Implementation Context

Architecture Review — panel-invitations. Status: **CONCERNS** (RC-1 — решение оркестратора по правилу; блокеров
нет). Решения: отдельный `PanelInvitationsRepository`; **новый ADR-0026** (+ строка-ссылка в ADR-0009); env
`PANEL_LINK_BASE` вводится; миграция **`0041_panel_invitations`** (в `origin/develop` последняя — `0040_panel_totp`,
в удалённых ветках `0041+` нет).

**ENTRY POINTS**
- HTTP: `PanelInvitationsController` (`@Controller('admin/invitations')`, `@UseGuards(PanelGuard)` на классе):
  `GET /` (`members.read`), `POST /` (`members.manage`, 201), `POST /:id/revoke` (`members.manage`, 204, `Uuid`
  pipe), `POST /lookup` (`@Public()`, `@UseGuards(IpRateLimitGuard)` + `@IpRateLimit('panel-invitation-lookup',
  { limit: 60, windowSec: 900 })`, 200), `POST /accept` (`@Public()`, `IpRateLimitGuard` +
  `@IpRateLimit('panel-invitation-accept', { limit: 20, windowSec: 900 })`, 200, cookie как у `sign-in`).
  Статические `lookup`/`accept` (2 сегмента) с `:id/revoke` (3 сегмента) не пересекаются.
- Worker: `PanelEmailProcessor` (`@Processor(QUEUE.panelEmail)`), разбор по `job.name`.
- Транзакции, пишущие outbox о роли: `PanelMembersService.grant | changeRole | revoke | grantAdminFromCli`.
- Admin: маршрут `invite` (дочерний `rootRoute`, вне `appRoute`, как `sign-in`), блок «Приглашения» в
  `MembersScreen`.

**Порядок операций (обязателен)**
- `invite(actor, input)`: `consumeUserLimit('panel-invitations-user', uid, 30/ч)` → `panelLinkBase(env)` нет — `503
  PANEL_INVITATIONS_UNAVAILABLE` → `accounts.findVerifiedByEmail(email)` есть и `findActiveMember` — `409
  PANEL_ALREADY_MEMBER` → `id = uuidv7()`, `token = panelInvitationToken(secret, id)` → транзакция (повтор один раз
  на `isDuplicateKey(e, 'panel_invitations_pending_email_unique')`): `closePending(tx, email, now)` (`updateMany
  { email, status: 'pending' }` → `revoked`, `revokedReason: 'replaced'`, `email: null`, `purgeAt`) → `insert` →
  `audit.append(panel.invitation_sent, subject invitation, details { roleTo })` → `outbox.append
  (PANEL_INVITATION_EMAIL_REQUESTED, { invitationId })`. Ответ — `PanelInvitation`.
- `revoke(actor, id)`: транзакция `revokePending(tx, id, now)` (условный `findOneAndUpdate { _id, status:
  'pending' }`; нет — `404 NOT_FOUND`; истёкшее `pending` отзывается) → `panel.invitation_revoked` (`details
  { roleTo }`).
- `lookup(token)`: `findLiveByTokenHash(sha256(token), now)` → `{ role, displayName, expiresAt }`, иначе `410
  PANEL_INVITATION_INVALID`.
- `accept({ token, email, password }, ip, previousToken)`: снимок `findLiveByTokenHash` (нет — 410) →
  `credentials.verify({ email, password }, ip)` (401/429; `verificationRequired` — вернуть как есть) →
  `normalizeEmail(email) !== invitation.email` — `409 PANEL_INVITATION_EMAIL_MISMATCH` → транзакция
  (`runWithInsertRetry`): `accounts.lockAccountState(tx, userId)` (не active / штамп ≠ — 401
  `INVALID_CREDENTIALS`) → `role === 'admin'` — `lockAdmins` → `lockPending(tx, id, now)` (`$inc version` при
  `status: 'pending'`, `expiresAt > now`; нет — 410) → `lockMember` → `active` — 409 `PANEL_ALREADY_MEMBER` →
  `activateIn(tx, current, { userId, role, displayName })` → `markAccepted(tx, id, userId, now)` (`email: null`,
  `purgeAt`) → `panel.invitation_accepted` (actor и `targetUserId` — `userId`, `details { roleTo }`). Outbox о роли
  **не** пишется. После коммита — лог `panel.invitation_accepted uid=<uid> invitation=<id>` →
  `sessions.continueAfterCredentials(verified, previousToken, undefined)` (RC-4).

**FILES TO CREATE**
- `apps/api/src/db/migrations/0041_panel_invitations.ts` — `PANEL_INVITATIONS_INDEXES` + `ensureCollection`, export
  `panelInvitations`; в конец `index.ts`; кейс в `migrations.int.test.ts` (список id + индексы).
- `apps/api/src/modules/panel/panel-invitations.repository.ts` — **единственный писатель** `panel_invitations`
  (комментарий-правила как у `PanelRepository`): `insert`, `closePending`, `revokePending`, `lockPending`,
  `markAccepted`, `setEmailState(id, state)` (условие `status: 'pending'`), `findLiveByTokenHash`, `findById`,
  `listPending(limit)` (`hint('panel_invitations_status_created_idx')`).
- `apps/api/src/modules/panel/panel-invitations.service.ts` — `PanelInvitationsService` (`list`, `invite`,
  `revoke`, `lookup`, `acceptIn` — транзакция accept), в `PanelCoreModule`.
- `apps/api/src/modules/panel/panel-invitation-accept.ts` — `PanelInvitationAccept` (HTTP-оркестратор: снимок →
  `PanelCredentials.verify` → `acceptIn` → `PanelSessionService.continueAfterCredentials`), в `PanelModule`.
- `apps/api/src/modules/panel/panel-invitations.controller.ts` — тонкий, cookie — `PanelSessionCookie` (общий
  хелпер `signedIn(reply, result)` вынести из `PanelSessionController` в `PanelSessionCookie.signedIn` или
  функцию модуля — без копии).
- `apps/api/src/modules/panel/panel-invitation-token.ts` — `panelInvitationToken(secret, id)` =
  `HMAC-SHA256(EMAIL_TOKEN_SECRET, 'panel-invitation:' + id)` base64url (43 символа, проходит `OpaqueToken`);
  `tokenHash = sha256(token)` (`sha256` из `identity/index.ts`). Образец — `tickets/ticket-qr.ts` (не
  `identity.LinkPurpose`).
- `apps/api/src/modules/panel/panel.events.ts` — `PANEL_INVITATION_EMAIL_REQUESTED = 'panel.invitation-email-requested'`
  (`{ invitationId: z.uuid() }`), `PANEL_ROLE_EMAIL_REQUESTED = 'panel.role-email-requested'` (`{ auditId: z.uuid() }`),
  `panelOutboxRoutes` (оба → `QUEUE.panelEmail`).
- `apps/api/src/modules/panel/jobs/panel-email.processor.ts`, `jobs/invitation-email.handler.ts`,
  `jobs/role-email.handler.ts` — по образцу `identity-email.processor.ts` + `password-changed-email.handler.ts`
  (без захвата); приглашение: не `pending`/истекло — `skipped`; финальная попытка (`isFinal(job)` как в tickets) —
  `setEmailState('failed')` + лог `panel.invitation_email_failed invitation=<id>`; успех — `sent`. Роль: запись
  журнала по id (`PanelRepository.findAuditById`), только `role_granted|role_changed|role_revoked`, иначе
  `skipped`; адрес — `IdentityAccounts.emailsOf([targetUserId])` (нет — `skipped`).
- `apps/api/src/modules/panel/mail/panel-emails.ts` — `renderInvitationEmail({ role, expiresAt, link })`,
  `renderRoleEmail({ action, roleFrom, roleTo, link | null })`; `htmlEmail`/`buttonHtml`/`escapeHtml`/
  `minskDateTime` из `identity/index.ts`; подписи ролей — `PANEL_ROLE_LABELS` (серверный снимок, не `@pokatim/i18n`,
  как `notification-texts.ts`); без причины, без имени пригласившего.
- `apps/api/src/modules/panel/panel-worker.module.ts` — `PanelWorkerModule` (`PanelCoreModule` +
  `BullModule.registerQueue({ name: QUEUE.panelEmail })`, обработчики, процессор).
- `packages/contracts/src/admin/invitations.schema.ts` (+ `.test.ts`), экспорт в `src/index.ts`.
- `apps/admin/src/features/invite/InviteScreen.tsx` (+ `.test.tsx`); `features/members/InvitationsSection.tsx`,
  `features/members/invitations-query.ts`; `features/sign-in/UnverifiedCard.tsx` (вынос из `SignInScreen.tsx`).
- `docs/adr/0026-panel-invitations.md` + строка в `docs/adr/README.md`.

**FILES TO MODIFY**
- `panel.collection.ts` — `PANEL_COLLECTIONS.invitations = 'panel_invitations'`, `PanelInvitationDoc`, в
  `PanelCollections`/`panelCollections`; `AuditDetailsDoc` не меняется (`roleTo` есть).
- `panel.policy.ts` — `invitationTtlMs: 7 сут`, `invitationPurgeAfterMs: 30 сут`, `invitationListCap`
  (= `PANEL_INVITATION_LIST_CAP`), `invitationsUserLimit`, IP-лимиты.
- `panel.repository.ts` — `findAuditById(id)` (чтение; append-only не нарушается).
- `panel-audit.ts` — `append` возвращает `_id` записи (`Promise<string>`, вызывающие не ломаются).
- `panel-members.service.ts` — `MongoOutboxWriter` в конструктор; в транзакциях `grant`, `changeRole` (только при
  фактической смене), `revoke`, `grantAdminFromCli` (только `changed`) — `outbox.append(PANEL_ROLE_EMAIL_REQUESTED,
  { auditId })`; `activate` → публичный `activateIn`; `runWithInsertRetry` → функция модуля с параметром имени
  индекса (переиспользует `PanelInvitationsService`).
- `panel-session.service.ts` — `signIn` = `verify` + `continueAfterCredentials(verified: VerifiedCredentials,
  previousToken, deviceToken)` (публичный, логика 2FA-веток без изменений).
- `panel-session.controller.ts` — хелпер `signedIn` переиспользуемый (см. выше).
- `panel-core.module.ts` (+ `PanelInvitationsRepository`, `PanelInvitationsService`), `panel.module.ts`
  (+ контроллер, `PanelInvitationAccept`, `IpRateLimitGuard`), `index.ts` (+ `PanelWorkerModule`,
  `panelOutboxRoutes`).
- `apps/api/src/queues.ts` — `panelEmail: 'panel-email'` (комментарий: jobId = id события outbox, дубль безвреден,
  приглашение — `emailState`).
- `apps/api/src/worker.module.ts` — `...panelOutboxRoutes`, `PanelWorkerModule`.
- `apps/api/src/cli/panel-cli.module.ts` — `MongoOutboxModule` (RC-14).
- `apps/api/src/config/env.ts` — `PANEL_LINK_BASE: optional(z.url({ protocol: /^https?$/ }).refine(endsWith('/')))`,
  `export function panelLinkBase(env): string | null` (`PANEL_LINK_BASE ?? (APP_WEB_ORIGIN ? `${APP_WEB_ORIGIN}/admin/`
  : null)`), `envDependencyErrors`: prod-стенд — только https.
- `apps/api/src/error-messages.ts` — тексты трёх кодов.
- `apps/api/src/admin-routes.test.ts` — список `@Public` + `PanelInvitationsController.{lookup,accept}`, имя
  контроллера в списке.
- `apps/api/.env.example`, `docs/runbooks/local-dev.md` (`PANEL_LINK_BASE` для `pnpm dev`), `docs/runbooks/deploy.md`
  (стенд/прод — от `APP_WEB_ORIGIN`), env смоука `apps/admin/e2e/project.ts` (`PANEL_LINK_BASE=<PANEL_URL>`).
- `packages/contracts/src/common.ts` — в **конец** `ErrorCode`: `PANEL_INVITATION_INVALID`,
  `PANEL_INVITATION_EMAIL_MISMATCH`, `PANEL_INVITATIONS_UNAVAILABLE`.
- `packages/contracts/src/admin/audit.schema.ts` — в **конец** `AUDIT_ACTIONS`: `panel.invitation_sent`,
  `panel.invitation_revoked`, `panel.invitation_accepted`; в **конец** `AUDIT_SUBJECT_KINDS`: `invitation`
  (`id` — id приглашения, `label` — имя в панели, RC-8).
- `packages/api-client/src/admin.ts` (+ `admin.test.ts`): `listInvitations()`, `invite(body)`,
  `revokeInvitation(id)`, `lookupInvitation(body)`, `acceptInvitation(body)` (ответ — `PanelSignInResponse`).
- `packages/i18n/src/ru.ts` — `admin.audit.action.panel.invitation_*` (шаблонный ключ `admin.audit.action.${action}`
  не скомпилируется без них), `admin.audit.subject`-подписи не нужны (label — снимок), тексты блока, окна, экрана
  `/invite`, ошибок; `admin.members.error.NOT_FOUND` — «Аккаунта нет — отправьте приглашение».
- `apps/admin/src/router.tsx` — `inviteRoute` (`path: 'invite'`, `getParentRoute: () => rootRoute`), в `routeTree`
  рядом с `signInRoute`.
- `apps/admin/src/config.ts` — `REGISTER_URL = `${appWebUrl}/register`` (маршрут приложения — `(onboarding)/register.tsx`).
- `apps/admin/src/features/members/{MembersScreen.tsx, GrantRoleDialog.tsx, member-errors.ts}` — кнопка
  «Пригласить» (`useCan('members.manage')`), окно приглашения = `GrantRoleDialog` с режимом `invite` (поля те же —
  без второй формы), блок «Приглашения» (скелетон / «Не удалось загрузить» + повтор / баннер при показанных данных /
  «Приглашений нет»), «Отозвать» — `Dialog`-подтверждение без причины (образец удаления в `MaterialDialogs.tsx`),
  `NOT_FOUND` в «Выдать роль» — подсказка + действие «Отправить приглашение» с тем же e-mail.
- `apps/admin/src/features/audit/AuditScreen.tsx` — детали `roleTo` у новых действий (как у `role_granted`).
- `apps/admin/src/features/sign-in/SignInScreen.tsx` — импорт вынесенной `UnverifiedCard`.
- `docs/adr/0009-admin-panel-access.md` (Последствия: «Приглашения — ADR-0026»), `docs/product/admin-panel.md`.

**FILES TO READ**
- `modules/panel/{panel-members.service,panel-session.service,panel-session.controller,panel.repository,
  panel-totp-guard,panel-session-cookie,panel.guard,public.decorator}.ts`, `modules/identity/{panel-credentials,
  credentials-check,identity-accounts,tokens,index}.ts`, `modules/identity/jobs/{identity-email.processor,
  password-changed-email.handler}.ts`, `modules/tickets/{ticket-qr.ts,jobs/*,tickets.events.ts,tickets.module.ts}`,
  `src/public-read.guard.ts` (`IpRateLimitGuard`, `@IpRateLimit`), `src/user-limit.ts`, `db/migrations/0040_panel_totp.ts`,
  `test/panel.ts` (сиды, `panelSignIn`, `pauseAfterTotpRead` — образец ворот), `test/tickets.ts`
  (`sendTicketEmails` — вызов процессора из теста), `panel-session.int.test.ts` («отрицательное доказательство»).
- Admin: `features/sign-in/{SignInScreen,TotpSignInSteps}.tsx` (`TotpStep`/`TotpSetupStep` с `onSignedIn`,
  `onExpired`, `onBack` — переиспользуются как есть; `onExpired` на `/invite` → «Вход» с баннером),
  `features/members/*`, `features/tickets/MaterialDialogs.tsx`, `session/me.ts` (`ME_QUERY_KEY`), `query-client.ts`
  (мутации `accept`/`lookup` — `meta: { ownsUnauthorized: true }`).

**TYPES & SCHEMAS**
- `PanelInvitationDoc { _id: uuidv7; email: string | null (нормализованный, null после закрытия); role: PanelRole;
  displayName: string; invitedBy: string (userId); tokenHash: string; status: 'pending' | 'accepted' | 'revoked';
  revokedReason: 'revoked' | 'replaced' | null; emailState: 'pending' | 'sent' | 'failed'; createdAt; expiresAt;
  acceptedUserId: string | null; acceptedAt: Date | null; revokedAt: Date | null; purgeAt: Date; version: number }`.
- Индексы `0041`: `panel_invitations_token_hash_unique { tokenHash: 1 }` unique;
  `panel_invitations_pending_email_unique { email: 1 }` unique + `partialFilterExpression: { status: 'pending' }`;
  `panel_invitations_status_created_idx { status: 1, createdAt: -1, _id: -1 }`;
  `panel_invitations_purge_ttl { purgeAt: 1 }` `expireAfterSeconds: 0` (уборка; срок проверяет сервер).
- Контракты (`invitations.schema.ts`): `PANEL_INVITATION_LIST_CAP = 200`; `InvitationEmailState = z.enum(['pending',
  'sent','failed'])`; `PanelInvitation = z.object({ id: Uuid, email: z.string(), displayName: z.string(), role:
  PanelRole, invitedBy: z.string() /* имя; удалённый — «Удалённый участник» */, createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(), expired: z.boolean(), emailState: InvitationEmailState })`; `PanelInvitationList =
  { items, truncated }`; `InviteRequest = z.strictObject({ email: Email, displayName: DisplayName, role: PanelRole })`;
  `InvitationLookupRequest = z.strictObject({ token: OpaqueToken })`; `InvitationLookupResponse = z.object({ role, displayName,
  expiresAt })`; `InvitationAcceptRequest = z.strictObject({ token: OpaqueToken, email: Email, password:
  SignInPassword })`; ответ accept — `PanelSignInResponse`.
- Коды: `410 PANEL_INVITATION_INVALID`, `409 PANEL_INVITATION_EMAIL_MISMATCH`, `503 PANEL_INVITATIONS_UNAVAILABLE`;
  существующие `409 PANEL_ALREADY_MEMBER`, `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED`, `404 NOT_FOUND`.
- Журнал: `panel.invitation_sent` (actor user, `targetUserId: null`, subject `invitation`, `details.roleTo`),
  `panel.invitation_revoked` (то же), `panel.invitation_accepted` (actor = target = принявший, subject, `roleTo`).
- Ссылка: `${panelLinkBase}invite#token=<token>`; кнопка «Открыть панель» — `panelLinkBase`.

**TESTS** (int — реальный MongoDB/Redis; ворота гонок — паузой через `gate()`/`vi.spyOn`, как `pauseAfterTotpRead`)
- `panel-invitations.int.test.ts`: AC1 (без аккаунта → письмо в `FakeMailer` со ссылкой → регистрация,
  подтверждение → accept → `signedIn` + cookie, журнал `invitation_sent`, `invitation_accepted`, в журнале/outbox/
  логах нет адреса — `JSON.stringify` + шпион логгера); AC2 (повтор → прежний токен 410 на lookup и accept, новый
  работает, одна запись `pending`); AC3 (отозванное, принятое, истёкшее по `TestClock` + 7 сут — 410 на обоих,
  истёкшее `pending` — тоже); AC4 (чужой аккаунт — 409, роль не выдана, приглашение `pending`); AC5 (неверный пароль
  — 401, счётчик `signin-*` тот же: после N неверных accept — 429 на `session/sign-in`); мусорный токен — 410 без
  списания `signin-*` (RC-2); неподтверждённый — `verificationRequired`, приглашение `pending` (RC-17); уже активный —
  409; снятый сотрудник — повторная активация; admin при `PANEL_TOTP_ENFORCED` без 2FA — `totpSetupRequired`
  (отдельный harness с `PANEL_TOTP_KEY`); AC8 (moderator/organizer — 403 на list/invite/revoke; lookup отдаёт ровно
  `{ role, displayName, expiresAt }`); AC9 (`tokenHash` ≠ токену, токена нет в БД/outbox); 503 без link base;
  лимиты: `panel-invitations-user` и IP-лимиты — 429; удаление аккаунта между verify и транзакцией — 401 и роли нет
  (RC-3, пауза после `verify`); прежняя cookie сессии этого браузера — `superseded`.
- `panel-invitations-locks.int.test.ts` (AC7): accept ↔ revoke и accept ↔ повторное приглашение — ровно одно из
  «принято»/«отозвано», журнал согласован (пауза в `lockPending`/после снимка); **отрицательное доказательство**:
  `lockPending` подменён чтением без записи — обе транзакции коммитятся (сотрудник активен и приглашение
  `revoked`); два параллельных accept — одна активация, одна запись журнала, второй 409/410; два POST на адрес —
  один `pending`, оба 201, вставка вызвана повторно; accept admin ↔ понижение другого админа — обе завершаются
  последовательно (`panel_meta.admins.version` вырос на 2), без отрицательного доказательства (RC-15).
- `panel-email.int.test.ts` (AC6): письмо приглашения (тема, роль, «действует до» по Минску, ссылка с
  `#token=`); отозванное до отправки — `skipped`; финальная попытка — `emailState: 'failed'`, в списке
  `emailState`; повтор задачи — второе письмо с той же ссылкой (принято); письма о `grant`, `changeRole`, `revoke`,
  CLI-повышении: тексты, без причины, кнопка от `panelLinkBase`/без неё; удалённый аккаунт — `skipped`; `changeRole`
  на ту же роль — нет события.
- `cli/panel-cli.int.test.ts` — `grant-admin` пишет `panel.role-email-requested`; повтор для admin — нет события.
- Без регрессии: `panel-session.int.test.ts`, `panel-totp-sign-in.int.test.ts`, `panel-members.int.test.ts` (+ outbox
  в транзакции: откат при сбое `MongoOutboxWriter.append` — роли нет), `account-deletion.int.test.ts`.
- Unit: `panel-invitation-token.test.ts` (детерминизм, префикс назначения, ≠ `ticketQrToken`), `mail/panel-emails.test.ts`
  (экранирование `displayName`, нет причины), `config/env.test.ts` (`PANEL_LINK_BASE` без слеша — ошибка, http на
  prod-стенде — ошибка, fallback `APP_WEB_ORIGIN/admin/`), `admin-routes.test.ts`, `migrations.int.test.ts`,
  `packages/contracts/src/admin/invitations.schema.test.ts` (strict, токен 43 символа), `audit.schema.test.ts`
  (новые значения в конце), `api-client/src/admin.test.ts`.
- Admin (Vitest + RTL): `MembersScreen.test.tsx` (кнопка только с `members.manage`, окно, блок: скелетон / ошибка с
  повтором / пусто / «Истекло» / «Письмо не отправлено», «Отправить повторно», «Отозвать» с подтверждением,
  подсказка на `NOT_FOUND`), `InviteScreen.test.tsx` (токен из `#token=` убран из адреса, lookup-скелетон, 410,
  accept → `signedIn` → «Обзор», `totpRequired` → `TotpStep`, `verificationRequired` → `UnverifiedCard`, 409
  mismatch под полем e-mail, 429), `AuditScreen.test.tsx` (подписи трёх действий).
- e2e (рекомендуется, `apps/admin/e2e/admin.spec.ts`): приглашение → письмо в Mailpit → `/admin/invite#token=…` →
  принятие → «Обзор».

**OUT OF SCOPE**
- Регистрация в панели; письма о сбросе 2FA и входе; срок жизни из UI; удаление `panel_totp` при снятии роли
  (RC-13); принятие без пароля уже вошедшим; пропуск кода доверенным устройством на accept (RC-4); правка правил
  `.claude/rules/*` — кроме строки RC-1, если оркестратор разрешит.

## 12. Outcome

### Решения оркестратора по 8.1 (2026-10-30)

- **RC-1 → `lookup` убран.** `.claude/rules` без OK человека не правим. Роль, имя и срок есть в письме-приглашении;
  экран `/invite` показывает общий текст и форму; недействительная ссылка узнаётся ответом `accept` (`410
  PANEL_INVITATION_INVALID`, снимок приглашения до проверки пароля — RC-2). `accept` — шаг входа паролем (как
  `sign-in`), правилу `@Public()` соответствует. IP-лимит `lookup` не нужен.
- **RC-8 → `subject.label` = `Приглашение ·<id>`** (имя не принявшего человека в append-only журнал не пишем).
- Остальные RC — как предложил architect.

### Итог реализации (coder, 2026-10-30)

**Сделано** (коммит `001153f6` в `feature/panel-invitations`, push не делался):

- Contracts: `admin/invitations.schema.ts` (`PanelInvitation`, `PanelInvitationList`, `InviteRequest`,
  `InvitationAcceptRequest`, `PANEL_INVITATION_LIST_CAP`, `InvitationEmailState`); коды `PANEL_INVITATION_INVALID`,
  `PANEL_INVITATION_EMAIL_MISMATCH`, `PANEL_INVITATIONS_UNAVAILABLE`; действия `panel.invitation_sent|revoked|accepted`
  и вид объекта `invitation` — в конец списков. api-client: `listInvitations`, `invite`, `revokeInvitation`,
  `acceptInvitation`.
- API (`modules/panel`): миграция `0041_panel_invitations`; `PanelInvitationsRepository` (единственный писатель),
  `PanelInvitationsService` (`list`, `invite`, `revoke`, `acceptIn`), `PanelInvitationAccept`, контроллер
  `admin/invitations` (`GET` — `members.read`, `POST`/`:id/revoke` — `members.manage`, `accept` — `@Public` + IP-лимит
  20/15 мин); токен — `panel-invitation-token.ts`; `PanelSessionService.continueAfterCredentials`;
  `PanelSessionCookie.signedIn` (общий для входа и принятия); письма о роли в транзакциях `grant`, `changeRole`
  (фактическая смена), `revoke`, `grantAdminFromCli` (outbox `panel.role-email-requested { auditId }`);
  `PanelWorkerModule` + очередь `panel-email` (`InvitationEmailHandler` с `emailState`, `RoleEmailHandler`);
  `MongoOutboxModule` в `PanelCliModule`; env `PANEL_LINK_BASE` + `panelLinkBase()`, prod — только https.
- Admin: «Пригласить» (`GrantRoleDialog` в режиме `invite`), блок «Приглашения» (`InvitationsSection`: скелетон,
  ошибка с повтором, баннер обновления — `DataTable`; «Истекло», «Письмо не отправлено», «Отправить повторно»,
  «Отозвать» — `Dialog` без причины), подсказка и кнопка «Отправить приглашение» на `NOT_FOUND`, экран `/invite`
  (токен из `#token=` убирается `history.replaceState`), `UnverifiedCard` вынесена, подписи журнала.
- Документация: ADR-0026 (+ README, ссылка в ADR-0009), `docs/product/admin-panel.md`, `local-dev.md`, `deploy.md`,
  `apps/api/.env.example`, env смоука `apps/admin/e2e/project.ts`.

**Тесты-ворота гонок (AC7, `panel-invitations-locks.int.test.ts`) и отрицательное доказательство:**

- accept ↔ revoke: принятие остановлено после снимка приглашения, отзыв коммитится → принятие `410`, роли нет, в
  журнале только отзыв. **Без `lockPending`** (подменён чтением документа без условия и записи) — принятие `200`:
  сотрудник `active` и приглашение `revoked`, в журнале и `invitation_revoked`, и `invitation_accepted` (тест
  зелёный именно на этом рассогласовании).
- accept ↔ повторное приглашение: то же; без `lockPending` сотрудник активен по заменённой (`replaced`) ссылке.
- Два параллельных accept (оба остановлены после снимка) — одна активация и одна запись журнала, второй `409`/`410`.
- Два параллельных POST на адрес (оба остановлены после `closePending`) — оба `201`, `pending` одно, `insert` вызван
  ≥ 3 раз (путь повтора).
- accept admin-приглашения ↔ понижение другого админа — обе `200`, `panel_meta.admins.version` +2 (без
  отрицательного доказательства, RC-15).
- Ревью pass 1: отрицательное доказательство переписано — «без перепроверки статуса в транзакции» (`lockPending` —
  чтение без условия, `markAccepted` — без записи) → обе операции коммитятся (сотрудник `active` + приглашение
  `revoked`/`replaced`). Добавлены ворота внутри транзакции после `lockPending`: с записью-замком отзыв ждёт
  (повтор) → принятие 200, отзыв 404; `lockPending` условным чтением без `$inc` → отзыв проходит посреди принятия
  (204), принятие 410 от конфликта записи `markAccepted` (§8.2 п. 10).

**Остальные тесты:** `panel-invitations.int.test.ts` (21: AC1–AC5, AC8, AC9, RC-2, RC-3, RC-9, RC-11, RC-17, 503,
superseded, 2FA `totpSetupRequired` на отдельном стенде), `panel-email.int.test.ts` (9: AC6, AC12, откат outbox),
`cli/panel-cli.int.test.ts` (+событие и его отсутствие при повторе), `migrations.int.test.ts` (0041),
unit: `panel-invitation-token`, `mail/panel-emails`, `config/env`, `admin-routes`; contracts — `invitations.schema`,
`audit.schema`, `common`; api-client; admin — `MembersScreen` (+6), `InviteScreen` (6), `AuditScreen` (+1).

**Follow-up (в `pr.md`):** строки правил `.claude/rules/pokatim-backend.md` (новый `@Public` — `accept`),
`pokatim-security.md` («Панель» — приглашения), `pokatim-db.md` («Панель» — `panel_invitations`) — с разрешения
человека; e2e смоука `pnpm e2e:admin` (приглашение → Mailpit → `/admin/invite` → «Обзор») — не добавлен; RC-13
(`panel_totp` после снятия роли).

**Проверки** (`MONGO_URL_TEST=…/pokatim_invites_test`, `REDIS_URL_TEST=…:6479/8`, Node 24):

- `TURBO_CONCURRENCY=1 pnpm check` → format:check ✓, lint ✓ (0 warnings), arch:check ✓ (no dependency violations),
  typecheck ✓ (9/9); test: contracts 51/51, api-client 22/22, i18n, tracks, route-view, design-tokens, admin — ✓;
  `@pokatim/api` — `Test Files 3 failed | 206 passed (209)`: 6 тестов вне задачи упали по таймауту 20 с под нагрузкой
  машины (load average ~16–21; `results-tiers`, `routes-derived`, `tickets-materials`).
- Перезапуск упавших файлов отдельно: `results-tiers.int.test.ts` 17/17, `routes-derived.int.test.ts` 10/10,
  `tickets-materials.int.test.ts` 14/14 — зелёные. Файлы задачи (`panel-invitations*`, `panel-email`, `panel-cli`,
  `migrations`) в полном прогоне — зелёные.
