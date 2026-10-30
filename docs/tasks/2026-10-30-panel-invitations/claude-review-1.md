# Findings — panel-invitations — pass 1 — reviewer: claude
base: origin/develop   commits: 001153f6..3e8b9757 (working tree clean, кроме неотслеживаемого codex-review-1.md)
verdict: REQUEST CHANGES

Проверено и запущено: `panel-invitations.int.test.ts`, `panel-invitations-locks.int.test.ts`, `panel-email.int.test.ts`,
`cli/panel-cli.int.test.ts` — 44/44 зелёные (БД `pokatim_rev_test`, Redis db 9). Admin: `features/{invite,members,sign-in,audit}`
— 58/58 зелёные. `pnpm check` целиком не запускался (NOT VERIFIED; отчёт coder — зелёный с таймаутами вне задачи).

Без замечаний по измерениям: порядок accept (IP-лимит → снимок по `tokenHash` до argon2 → `PanelCredentials.verify` →
сверка нормализованного e-mail → транзакция `lockAccountState` первой операцией → `lockAdmins` → `lockPending` →
`lockMember`), удалённый аккаунт / смена пароля (штамп в транзакции), отсутствие второй проверки пароля и копии 2FA
(`continueAfterCredentials` — вынос без изменения веток), cookie сессии (`superseded`), токен только хешем, e-mail нет в
журнале / outbox / логах, outbox в транзакции действия (откат проверен тестом), миграция expand-only идемпотентна,
индексы (частичный уникальный `pending`, TTL `purgeAt`), `@Public` только `accept`, контракты в конец списков,
`MongoOutboxModule` в CLI, Button по умолчанию `type="button"` (кнопка «Отправить приглашение» внутри формы не сабмитит).

### [HIGH] «Отозвать» — мутация без состояния кнопки; повтор даёт 404 с текстом «Аккаунта нет — отправьте приглашение»
- **file:** apps/admin/src/features/members/InvitationsSection.tsx
- **location:** 56–63 (`revoke`), 118–128 (кнопка строки), 170–175 (кнопка подтверждения)
- **problem:** подтверждение вызывает `revoke.mutate(id)` и сразу закрывает диалог; `revoke.isPending` нигде не используется —
  кнопка «Отозвать» строки остаётся активной до ответа и рефетча, у неё нет `busy`/`disabled`. Ошибка мутации маппится через
  `memberErrorText`, где `NOT_FOUND` теперь = «Аккаунта нет — отправьте приглашение».
- **why_it_matters:** AGENTS.md §4.12 («мутации — состояние кнопки, disabled на время запроса»); контракт ревью: нарушение §4.12 —
  HIGH. Сценарий: медленная сеть → админ жмёт «Отозвать» второй раз → второй запрос `404 NOT_FOUND` → баннер «Аккаунта нет —
  отправьте приглашение» над только что отозванным приглашением (ложная подсказка). То же при гонке с принятием.
- **evidence:** `onClick={() => { if (revoking) revoke.mutate(revoking.id); setRevoking(undefined); }}`; кнопка строки —
  без `busy`/`disabled`; `member-errors.ts`: `NOT_FOUND: 'admin.members.error.NOT_FOUND'`.
- **recommended_fix:** держать диалог открытым до `onSuccess`, `busy={revoke.isPending}`/`disabled` на подтверждении и на
  действиях этой строки (как `resend`); для отзыва 404 — свой текст («Приглашение уже принято или отозвано») + рефетч. Тест RTL.

### [MEDIUM] Глобальная смена текста `NOT_FOUND` задевает другие действия «Сотрудников»
- **file:** packages/i18n/src/ru.ts; apps/admin/src/features/members/member-errors.ts; MembersScreen.tsx
- **location:** `admin.members.error.NOT_FOUND`; `MembersScreen.tsx:264, 277, 290` (`errorText={memberErrorText}` у
  «Изменить роль», «Снять роль», «Сбросить 2FA»); `InvitationsSection.tsx:54, 60`
- **problem:** подсказка «Аккаунта нет — отправьте приглашение» уместна только в «Выдать роль» по e-mail, но ключ общий для всех
  действий над сотрудником и приглашениями.
- **why_it_matters:** 404 у смены/снятия роли или сброса 2FA (сотрудник/аккаунт исчез между загрузкой и действием) и у отзыва
  приглашения покажет неверный совет.
- **evidence:** единственный `MEMBER_ERROR_KEYS.NOT_FOUND` используется всеми вызовами `memberErrorText`.
- **recommended_fix:** отдельный ключ для режима `grant` в `GrantRoleDialog` (`admin.members.error.grantNotFound`), прежний
  нейтральный текст для остальных; отзыв приглашения — свой текст (см. HIGH).

### [MEDIUM] Ротация `EMAIL_TOKEN_SECRET` не гасит выданные ссылки и порождает нерабочие письма (ADR-0026 §2 неверен)
- **file:** apps/api/src/modules/panel/panel-invitation-accept.ts; jobs/invitation-email.handler.ts; docs/adr/0026-panel-invitations.md
- **location:** accept 34–38; handler 51–60; ADR §Решение п.2 «ротация секрета гасит все приглашения»
- **problem:** accept ищет только `sha256(token)` в БД — соответствие токена текущему секрету не проверяется, поэтому старая
  ссылка после ротации живёт до `expiresAt`. Обратная сторона: ретрай/отложенное письмо после ротации выводит токен новым
  секретом, его хеш ≠ сохранённому `tokenHash` — письмо уходит с мёртвой ссылкой и `emailState: 'sent'`.
- **why_it_matters:** задокументированная гарантия отзыва не выполняется; провал письма невидим (противоречит RC-7). Сценарий
  редкий (ротация секрета), поэтому не блокер.
- **evidence:** `findLiveByTokenHash(invitationTokenHash(input.token), now)`; worker — `panelInvitationToken(this.env.EMAIL_TOKEN_SECRET, invitation._id)` без сравнения с `invitation.tokenHash`.
- **recommended_fix:** в accept после снимка — `timingSafeEqual(invitationTokenHash(panelInvitationToken(secret, snapshot._id)), snapshot.tokenHash)`,
  иначе 410; в worker при несовпадении — `skipped` + `emailState: 'failed'`. Либо поправить ADR (ротация не гасит). Тест: секрет A → B.

### [LOW] Ворота гонок доказывают перепроверку статуса в транзакции, но не запись-замок `lockPending`
- **file:** apps/api/src/modules/panel/panel-invitations-locks.int.test.ts
- **location:** 55–72 (`pauseAfterSnapshot`, `lockPendingAsRead`), тесты 76–155
- **problem:** пауза стоит до транзакции (на снимке), отзыв/замена коммитится целиком раньше, чем accept открывает транзакцию.
  «Отрицательное доказательство» заменяет `lockPending` чтением **без условия статуса** — то есть снимает перепроверку, а не
  `$inc version`. Вариант с условным `findOne` без записи прошёл бы все позитивные тесты.
- **why_it_matters:** корректность сейчас держится (условие `status: 'pending'` + `markAccepted` пишет тот же документ → write
  conflict), но тест не ловит регресс, если `markAccepted`/`lockPending` станут чтением; «замки первым действием, ворота с
  отрицательным доказательством» (§7) выполнены частично.
- **evidence:** `vi.spyOn(repo, 'lockPending').mockImplementation((tx, id) => repo.findById(id, tx))`.
- **recommended_fix:** добавить ворота внутри транзакции (пауза после `lockPending`, отзыв параллельно — он должен дождаться/
  конфликтовать) и отрицательный вариант «условное чтение без `$inc`».

### [LOW] `markAccepted` не проверяет результат записи
- **file:** apps/api/src/modules/panel/panel-invitations.repository.ts
- **location:** 104–110
- **problem:** `updateOne({ _id, status: 'pending' })` без проверки `matchedCount`; при сломанном замке приглашение останется
  `revoked`, а сотрудник станет активным (ровно сценарий отрицательного теста).
- **why_it_matters:** защита в глубину для инварианта «принято XOR отозвано».
- **recommended_fix:** `matchedCount !== 1` → бросить (откат транзакции).

### [LOW] RC-3: не покрыта ветка «пароль сменён между verify и транзакцией»
- **file:** apps/api/src/modules/panel/panel-invitations.int.test.ts
- **location:** 391–418
- **problem:** тест проверяет только удаление аккаунта; ветка `credentialsStamp !== verified.credentialsStamp` (сброс пароля) без теста.
- **recommended_fix:** второй кейс с заменой `passwordHash` в паузе после `verify` → 401, роли нет.

### [LOW] Мелочи UI/текстов
- **file:** packages/i18n/src/ru.ts; apps/admin/src/features/invite/InviteScreen.tsx
- **location:** `admin.members.inviteLead` («Ссылка действует 7 дней»); InviteScreen 172–175
- **problem:** срок захардкожен в тексте при наличии `PANEL_INVITATION_TTL_DAYS`; баннер `PANEL_ALREADY_MEMBER` («просто
  войдите») без кнопки «Войти».
- **recommended_fix:** параметр `{days}` из контракта; кнопка/ссылка на `/sign-in` в баннере.

### [LOW] Documentation Sync: `pr.md` отсутствует
- **file:** docs/tasks/2026-10-30-panel-invitations/
- **problem:** §10 и §12 ссылаются на `pr.md` (миграция 0041, env `PANEL_LINK_BASE`, очередь `panel-email`, follow-up правил
  `.claude/rules/*`), файла нет. Вероятно, создаётся на `finish-task` — NOT VERIFIED.
- **recommended_fix:** создать до PR.

## Verdict
REQUEST CHANGES — HIGH: «Отозвать» без состояния мутации (§4.12) и ложная подсказка на 404.
