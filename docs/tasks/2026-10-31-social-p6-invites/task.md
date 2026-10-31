# «Свои», P6 — приглашения (K9)

Уровень: task3. Эпик — `docs/tasks/2026-10-31-social-stage-0/task.md` (строка P6 таблицы §3.2, решения RC-1…RC-16),
продукт — `docs/product/social.md` K9, архитектура — ADR-0027 п. 5. P0 (миграция `0045_social` с `invite_codes`,
`SocialConnectionsService.linkInvite`, имя очереди `social-intake`) — в develop (#158).

## 1. Title

Атрибуция приглашений: личный код райдера в ссылках шеринга и на карточках для сторис, хранение кода 7 дней на
клиенте, `RegisterRequest.invite`, связь `invite` в обе стороны после подтверждения e-mail.

## 2. Goal

Каждый, кто пришёл по ссылке райдера и подтвердил e-mail, становится «своим» с пригласившим (K1, K9), а журнал метрик
получает событие `invite-registered` (K12) — для метрики «приглашения» закрытого теста.

## 3. Scope

1. **Личный код.** Случайный короткий код райдера (`invite_codes`, выдача лениво, upsert по `_id` = userId; дубль
   `code` — новый код). Эндпоинт `GET /v1/social/invite-code` (AuthGuard, `no-store`) → `{ code }`.
2. **Ссылки шеринга несут код** (`?invite=<code>`), если пользователь вошёл и код получен:
   - общий `shareLink` (native и web) — ссылки на райд, маршрут и билет гонки;
   - **«Позвать друзей» в своём профиле** (решение автора 2026-10-31): делится ссылкой на свой публичный профиль
     `/riders/<publicId>`, если профиль публичный, иначе — на главную `/`; обе с кодом.
3. **Короткая ссылка на карточках для сторис** (решение автора 2026-10-31): на картинке карточки (все типы — гонка,
   райд, маршрут, достижение; оба шаблона) печатается адрес вида `<домен>/i/<code>`. Web-маршрут `/i/:code`
   сохраняет код и ведёт на главную. Карточка без кода (код не выдан, сбой) — без строки адреса.
4. **Хранение на клиенте.** Любая страница/экран, открытые с `?invite=<code>` или по `/i/<code>`, сохраняют последний
   код и время перехода (web — `localStorage`, native — постоянное хранилище приложения); код старше 7 дней
   `[ASSUMPTION K9]` не используется и стирается. Вошедшему пользователю код не нужен — не сохраняется.
5. **Регистрация.** `RegisterRequest.invite` — необязательное поле (старые сборки совместимы); клиент передаёт
   сохранённый код. Код неверного формата — регистрация проходит, код отбрасывается (не 400). Сервер хранит код на
   документе `users` (не ПДн, но стирается вместе с аккаунтом). После успешной регистрации клиент код стирает.
6. **Подтверждение e-mail → связь.** При первом подтверждении e-mail аккаунта с кодом `identity` в той же транзакции
   пишет outbox `identity.account-confirmed {userId, invite}` → очередь `social-intake`; процессор `social`
   (jobId = id события outbox) разрешает код в пригласившего и вызывает `linkInvite`. Повтор задачи идемпотентен.
   Связи нет, если: код неизвестен; аккаунт пригласившего удалён (в т. ч. помечен удалённым, стирание ещё не
   прошло); приглашённый удалён к моменту обработки; код — свой. Аккаунт без подтверждения события не порождает.
7. **Метрика.** При создании связи по приглашению — `product_events` `invite-registered` с `userId` пригласившего
   (RC-12), в той же транзакции, только при первом создании (повтор задачи — без дубля).
8. **Уведомление пригласившему (K10 «По вашей ссылке зарегистрировались»)** — P1 ещё не в develop: в P6 не
   отправляется; точка привязки для P7 — в процессоре после `linkInvite` (комментарий + данные `inviterId`,
   `inviteeId`, созданность связи).

## 4. Out of Scope

Уведомление пригласившему (P7). Универсальные ссылки (associated domains / app links) — их нет в сборке; native
получает код только из deep link приложения, основной путь — web. Атрибуция входа существующего аккаунта (только
регистрация). Экраны «Свои» (P3), Главная (P7).

## 5. Architecture Context

ADR-0027 п. 5: `identity` о `social` не знает; событие `identity.account-confirmed` → `social-intake`. Разрешение кода
и проверка «аккаунт пригласившего не удалён» — в `social` через порт (в `social` нет прямого чтения `users`).

## 5.1 Placement & Reuse Gate

- Переиспользуем: `MongoOutboxWriter` и маршруты outbox (`identityOutboxRoutes`), `SocialConnectionsService.linkInvite`,
  `InviteCodesRepository`, `PRODUCT_EVENTS`, `shareLink`/`shareOrigin`, рендер карточек `sharing`, `isDuplicateKey`.
- Запрещено: `social` читает `users` напрямую; `identity` импортирует `social`.
- Уточнение architect (§8.1): маршрут `identity.account-confirmed → social-intake` объявляет подписчик —
  `socialOutboxRoutes` (а не `identityOutboxRoutes`); живость аккаунтов — существующий порт `IdentityAccounts.liveUserIds`;
  `sharing → social` (узкий `InviteCodes`) — новое разрешённое ребро. Нового пакета нет; миграции нет.

## 6. Relevant Files

Заполнено architect 2026-10-31 (подробно — §11).

- API `social`: `apps/api/src/modules/social/{social.module.ts,index.ts,invite-codes.repository.ts,connections.service.ts,connections.repository.ts,social.collection.ts,social-erasure.ts}`.
- API `identity`: `apps/api/src/modules/identity/{identity.events.ts,identity.collection.ts,identity.repository.ts,registration.service.ts,verification.service.ts,password-reset.service.ts,identity-accounts.ts,identity.module.ts,index.ts}`.
- API `sharing`: `apps/api/src/modules/sharing/{card-requests.ts,story-card.inputs.ts,ride-invite.inputs.ts,route-card.inputs.ts,achievement-card.inputs.ts,*.service.ts,story-card.processor.ts,story-card.render.ts,ride-invite.render.ts,route-card.render.ts,achievement-card.render.ts,sharing.policy.ts,sharing.module.ts}`.
- API общее: `apps/api/src/queues.ts` (`socialIntake` уже есть), `apps/api/src/outbox-routes.ts` (+ `.test.ts`), `apps/api/src/worker.module.ts` (якорь `SocialWorkerModule` уже подключён), `apps/api/src/config/env.ts` (`APP_WEB_ORIGIN`), `apps/api/src/modules/product-events/product-events.types.ts` (`invite-registered` уже есть), `.dependency-cruiser.cjs` (`social-consumers-only`).
- Контракты: `packages/contracts/src/auth/registration.schema.ts`, `packages/contracts/src/social/` (новый `invite.schema.ts`), `packages/contracts/src/index.ts`; токены — `packages/design-tokens/src/story-card.ts`; клиент API — `packages/api-client/src/index.ts`.
- Приложение: `apps/app/src/lib/share-link{,.web}.ts`, `apps/app/src/app/_layout.tsx`, `apps/app/src/app/(onboarding)/register.tsx`, `apps/app/src/features/auth/{queries.ts,secure-storage.ts}`, `apps/app/src/features/profile/own-profile-screen.tsx`, `apps/app/src/app-routes-manifest.server.test.ts`, образец хранилища — `apps/app/src/features/notifications/push-soft-prompt-storage{,.web}.ts`.

## 7. Implementation Notes

- Формат кода — короткий, читаемый с картинки, без похожих символов `[ASSUMPTION]`.
- Кэш карточек для сторис: карточка с кодом зависит от владельца — проверить ключ кэша/токен рендера.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION K9]` 7 дней хранения кода.
- `[ASSUMPTION]` Последний код перекрывает предыдущий (K9 «последний код»).
- Параллельные сессии P1–P5 правят соседние файлы — добавления в общие файлы только в конец списков.

## 8.1 Requirements Consistency (заполняет architect)

Статус: **CONCERNS, блокеров нет**. По каждой находке есть рекомендация, по ней написан §11.

- **RC-P6-1. Второй путь подтверждения e-mail.** `PasswordResetService.confirm` подтверждает e-mail неподтверждённого
  аккаунта (`if (!user.emailVerifiedAt) markEmailVerified`). Если писать событие только в `VerificationService.confirm`,
  приглашённый, который «забыл пароль» до подтверждения, связь не получит. Варианты: (a) общий шаг `identity`
  «первое подтверждение» для обоих путей; (b) только `verification.confirm` (потеря атрибуции); (c) регламент сверки.
  **Рекомендация — (a):** `markEmailVerified` становится условной атомарной записью (`emailVerifiedAt: null` в фильтре)
  и возвращает `invite`; событие пишет общий хелпер в той же транзакции. Других путей выставить `emailVerifiedAt`
  в коде нет: `panel-credentials` и `sign-in` только читают, `insertUser` пишет `null`.
- **RC-P6-2. Когда пишется событие и что в payload.** ADR п. 5: `identity.account-confirmed {userId, invite?}` (по
  смыслу — при любом подтверждении), §3.6 спеки — только если у аккаунта есть код. **Рекомендация:** писать только
  при первом подтверждении аккаунта, у которого есть `invite`; payload `{ userId, invite }`, `invite` обязателен
  (YAGNI: других потребителей нет, и «пустые» задачи не нужны). Код берётся из payload, а не через порт identity:
  `social` не читает `users`, лишний порт не нужен. В ADR п. 5 — уточнить формулировку.
- **RC-P6-3. Кто объявляет маршрут outbox.** §5.1 говорит «переиспользуем `identityOutboxRoutes`». Но маршрут
  `→ social-intake` в `identity` нарушил бы ADR п. 5 («identity о social не знает») и правило fan-out («маршрут
  объявляет подписчик»). **Рекомендация:** новый `socialOutboxRoutes = { [IDENTITY_ACCOUNT_CONFIRMED]: QUEUE.socialIntake }`
  в `social/social.events.ts`, в конец `subscriberOutboxRoutes`. Константа и схема события экспортируются из
  `identity/index.ts` (образец — `standingsOutboxRoutes` и `results`).
- **RC-P6-4. `sharing → social` противоречит ADR п. 1 и dependency-cruiser `social-consumers-only`** (сейчас
  разрешены только `notifications` и `account`). Код владельца на карточке берёт сервер. Варианты: (a) `sharing`
  импортирует `SocialCoreModule` и читает узкий сервис `InviteCodes` через `social/index.ts`; (b) клиент передаёт код в
  запросе карточки — серверу всё равно нужно проверить, что код свой, то есть та же зависимость, плюс риск
  произвольного текста на картинке; (c) коды в `identity` — противоречит P0 (`invite_codes` в `social`).
  **Рекомендация — (a):** добавить `sharing` в `pathNot` правила, а в ADR п. 1 — в список «на social ссылаются».
  Цикла нет: `social` не знает `sharing`.
- **RC-P6-5. Кэш карточек.** Сейчас ключ карточек райда и маршрута — хэш входов без `userId` (общий для всех с одной
  темой). Гонки и достижения и так личные. С адресом в хэше карточки райда и маршрута становятся личными: больше
  рендеров, лимит `story-card-render:<uid>` 30/ч остаётся. **Рекомендация:** принять. Адрес один раз вычисляет HTTP,
  он кладётся в данные задачи и в хэш, worker берёт его из задачи. Тогда сбой порта или окружения не даёт
  расхождения хэша между HTTP и worker (иначе — `skipped` и «вечный pending» до TTL). Нужно поднять
  `STORY_CARD_POLICY.renderVersion` до 5.
- **RC-P6-6. «Домен» на карточке.** Отдельного env нет. **Рекомендация:** host из `APP_WEB_ORIGIN`
  (`new URL(origin).host`, без схемы), напр. `pokatim.by/i/K7M2PQX`. Если env не задан (dev), строки адреса нет —
  как и «карточка без кода».
- **RC-P6-7. «Вошедшему код не сохраняется» и неизвестная сессия.** При первом рендере (SSR и native до гидрации)
  статус `unknown`, а редиректы гарда могут потерять `?invite=`. **Рекомендация:** сохранять код всегда, кроме статуса
  `signedIn`. Код используется только при регистрации, так что сохранить его «лишний раз» безвредно.
- **RC-P6-8. Что значит «первое создание» для `invite-registered`.** `upsertInvite` возвращает `true` только при
  вставке документа, а у существующей пары он выставляет `inviteAt` и возвращает `false`. **Рекомендация:**
  событие пишется, когда у документа пригласившего (`inviter → invitee`) `inviteAt` впервые стал не-`null` (вставка
  или переход `null → now`). `linkInvite` возвращает этот признак (для P7). Повтор задачи — `false`, без дубля.
- **RC-P6-9. Окно удаления.** Живость обоих проверяется `IdentityAccounts.liveUserIds` до транзакции `linkInvite`.
  Удаление, закоммиченное между проверкой и коммитом связи, оставит «позднюю» связь, и её уберёт повторный проход
  стирания (`account.deletion-sweep` повторяет шаг `social`). **Рекомендация:** принять. Альтернатива —
  `lockAccountState` обоих в транзакции `social` — пишет в `users` чужого модуля и конфликтует с действиями
  пользователя: избыточно.
- **RC-P6-10. Финальный провал задачи `social-intake`.** Связь не создаётся, задача остаётся в failed-наборе BullMQ
  (лог `social.invite_failed event=<id>`), регламента сверки нет. **Рекомендация:** принять на закрытый тест.
  Регламент — при необходимости в P7.
- **RC-P6-11. Повторное использование кода.** Код удалённого аккаунта освобождается на шаге стирания `social`. Новый
  случайный код может совпасть с кодом, который ещё лежит у кого-то на клиенте (7 дней): при алфавите 31^7 вероятность
  ничтожна. **Рекомендация:** принять, надгробий кодов не делать.
- **RC-P6-12. «Позвать друзей» до получения кода.** **Рекомендация:** показывать кнопку, только когда есть origin
  шеринга (web — после монтирования) и код уже загружен. Иначе — нет кнопки (AC3 требует ссылку с кодом).
- **RC-P6-13. Побочный эффект в GET.** `GET /v1/social/invite-code` при первом вызове создаёт код. Это идемпотентно:
  `_id` = userId, повтор возвращает тот же код. **Рекомендация:** принять (выдача лениво — решение P0).

**Решения оркестратора (2026-10-31):** RC-P6-1…RC-P6-13 приняты по рекомендациям architect. Отклонения от
ADR-0027 (п. 1 — ребро `sharing → social`; п. 5 — событие только при наличии кода, оба пути подтверждения, маршрут
объявляет `social`) — записать в ADR в этом PR.

## 9. Acceptance Criteria

- AC1. `GET /v1/social/invite-code` вошедшему возвращает один и тот же код; без входа — 401.
- AC2. Ссылка «Поделиться» райда/маршрута/билета у вошедшего содержит `?invite=<code>`; у гостя — без параметра.
- AC3. «Позвать друзей» в своём профиле делится ссылкой на публичный профиль (или главную) с кодом.
- AC4. Карточка для сторис вошедшего содержит строку `<домен>/i/<code>`; `/i/<code>` сохраняет код и открывает главную.
- AC5. Переход с кодом → регистрация в течение 7 дней передаёт `invite`; через 7 дней и 1 минуту — не передаёт.
- AC6. Подтверждение e-mail при валидном коде → две связи `invite` (A→B, B→A) и одно `invite-registered`; повтор
  задачи — без изменений.
- AC7. Неизвестный код, удалённый пригласивший, удалённый приглашённый, неверный формат — связей нет, регистрация
  успешна.
- AC8. Неподтверждённый аккаунт — события `identity.account-confirmed` нет.
- AC9. Стирание аккаунта стирает код на `users` и `invite_codes`.

## 10. Documentation Impact

`social.md` K9 — решения автора (короткая ссылка на карточке, «Позвать друзей»); `profile.md` — кнопка; правила
`pokatim-backend.md` — событие `identity.account-confirmed`; ADR-0027 п. 5 — уточнения architect.

## 11. Implementation Context

Architecture Review — social-p6-invites, 2026-10-31. Status: **CONCERNS (READY, без блокеров)**; находки и решения —
§8.1 (RC-P6-1…13). Миграции нет: поле `users.invite` необязательное (чтение `?? null`), индекс `invite_codes_code_unique`
уже есть в `0045_social`.

### 11.1 Контракты (`packages/contracts`)

- Новый `src/social/invite.schema.ts` (отдельный файл — чтобы не конфликтовать с P2/P3 в `social.schema.ts`), экспорт —
  строка в конец `src/index.ts`:
  - `INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'` (31 символ: без `0 O 1 I L`), `INVITE_CODE_LENGTH = 7`;
  - `InviteCode = z.string().trim().toUpperCase().regex(/^[2-9A-HJKMNP-Z]{7}$/)` (регистр не важен: со сторис код
    набирают руками);
  - `InviteCodeResponse = z.object({ code: InviteCode })` — `GET /v1/social/invite-code`.
- `RegisterRequest` += `invite: InviteCode.optional().catch(undefined)`: поле необязательное, старые сборки совместимы.
  Неверный формат или тип превращается в `undefined`, а не в 400 (§3.5). Форма регистрации поле не рендерит: тип
  формы — `z.input`, `invite` в нём необязательный.
- `packages/api-client/src/index.ts`: `getInviteCode: () => get('/v1/social/invite-code', InviteCodeResponse)` — в
  конец объекта методов (P1–P3 тоже добавляют туда методы). Тест — `src/social-invite.test.ts` (новый файл).

### 11.2 API — `identity` (производитель; о `social` не знает)

- `identity.collection.ts`: `UserDoc.invite?: string | null` — код пригласившего из регистрации (не ПДн; стирается
  вместе с аккаунтом).
- `identity.events.ts`: `IDENTITY_ACCOUNT_CONFIRMED = 'identity.account-confirmed'`,
  `IdentityAccountConfirmed = z.object({ userId: z.uuid(), invite: InviteCode })`. В `identityOutboxRoutes` маршрут
  **не** добавлять (RC-P6-3). `index.ts` += экспорт константы, схемы и типа.
- `identity.repository.ts`:
  - `insertUser(..., { ..., invite: string | null })` — пишет поле явно (`null`, если кода нет);
  - `markEmailVerified(tx, userId, at)` → `findOneAndUpdate({ _id, emailVerifiedAt: null }, { $set: { emailVerifiedAt: at } },
    { session, projection: { invite: 1 } })`, возвращает `{ invite: string | null } | undefined` (`undefined` — уже
    подтверждён: событие не пишется);
  - `eraseDeleted` — в `$set` добавить `invite: null` (AC9). `deleteUnverifiedBatch` удаляет документ целиком.
- Новый `account-confirmation.ts` (провайдер `IdentityModule`): `confirmEmail(tx, userId, at)` = `markEmailVerified` →
  если вернулся `invite` и он проходит `InviteCode.safeParse` → `outbox.append(tx, { type: IDENTITY_ACCOUNT_CONFIRMED,
  payload: { userId, invite } })`. Вызовы:
  - `verification.service.ts confirm` — вместо `markEmailVerified` (под `lockUser`, в той же транзакции);
  - `password-reset.service.ts confirm` — вместо `if (!user.emailVerifiedAt) markEmailVerified(...)` (RC-P6-1).
- `registration.service.ts register`: `invite: input.invite ?? null` → `insertUser`. Ответ от `invite` не зависит
  (нет оракула проверки кода). Код не логировать.

### 11.3 API — `social` (потребитель)

- `invite-codes.repository.ts`: `findCode(userId)`, `insert(userId, code, now)` (вставка: `_id` = userId), `ownerOf(code):
  Promise<string | undefined>` (по `invite_codes_code_unique`), `deleteOf` — без изменений.
- Новый `invite-codes.service.ts` — `InviteCodes` (экспорт из `SocialCoreModule` и `index.ts`):
  - `ensureOf(userId): Promise<string>` — есть код → вернуть. Иначе до 5 попыток: `generateInviteCode()` → `insert`.
    Дубль `_id_` (параллельная первая выдача) → перечитать. Дубль `invite_codes_code_unique` → новый код.
    `isDuplicateKey(error, name)`. Исчерпал попытки → бросок (500);
  - `ownerOf(code)` — для intake.
  - `generateInviteCode()` — чистая функция в `social.policy.ts`: `crypto.randomInt(31)` на каждый символ
    `INVITE_CODE_ALPHABET`. Генератор внедряемый (тест коллизии).
- Новый `invite-code.controller.ts` (`SocialModule.controllers`): `GET social/invite-code`, `AuthGuard`,
  `Cache-Control: no-store` → `InviteCodeResponse`. `SocialModule.imports` += `IdentityModule` (AuthGuard).
- `connections.repository.ts upsertInvite` → возвращает `'inserted' | 'invited' | 'unchanged'` (`invited` —
  `modifiedCount` перехода `inviteAt: null → now`). `connections.service.ts linkInvite(inviterId, inviteeId):
  Promise<boolean>`: в той же транзакции — `connection-created` по `inserted` (как сейчас), а если у стороны
  `inviter → invitee` `inserted | invited` → `PRODUCT_EVENTS.record({ type: 'invite-registered', userId: inviterId,
  props: {} }, tx)`. Возвращает этот признак (RC-P6-8). Гонка двух первых upsert одной пары — как в `addManual`:
  повтор на `CONNECTIONS_UNIQUE_INDEX`.
- Новый `social.events.ts`: `socialOutboxRoutes = { [IDENTITY_ACCOUNT_CONFIRMED]: QUEUE.socialIntake } as const`
  (P5 допишет `tracks.activity-recorded` в конец). Экспорт из `index.ts`; `apps/api/src/outbox-routes.ts` —
  `socialOutboxRoutes` в конец `subscriberOutboxRoutes` с комментарием; `outbox-routes.test.ts` — кейс
  `identity.account-confirmed → ['social-intake']`.
- Новый `invite-intake.ts` — `InviteIntake.handle(event: IdentityAccountConfirmed)`. Алгоритм:
  1. `inviterId = await codes.ownerOf(event.invite)`; нет → `'unknown_code'`;
  2. `inviterId === event.userId` → `'self'`;
  3. `live = await accounts.liveUserIds([inviterId, event.userId])` (`IdentityAccounts`, `IdentityAccountsModule`). Нет
     пригласившего → `'inviter_deleted'` (окно «помечен удалённым, стирание `social` ещё не прошло» закрыто
     `deletedAt`). Нет приглашённого → `'invitee_deleted'`;
  4. `registered = await connections.linkInvite(inviterId, event.userId)`;
  5. `// P7: уведомление пригласившему K10 — здесь, по { inviterId, inviteeId, registered }` → вернуть итог.
  Логи — только id события и итог, без кода.
- Новый `social-intake.processor.ts` — `@Processor(QUEUE.socialIntake) SocialIntakeProcessor`: разбор по `job.name`
  (образец `standings-sync.processor.ts`): таблица `type → { schema, handle }`. Неизвестное имя — бросок; payload
  `outbox.payloadOf(outboxEventId)` не прошёл схему → `'skipped'` с логом. P5 добавит строку в таблицу.
- `social.module.ts`: `SocialWorkerModule` = `imports: [SocialCoreModule, IdentityAccountsModule,
  BullModule.registerQueue({ name: QUEUE.socialIntake })]`, `providers: [InviteIntake, SocialIntakeProcessor]`.
  `SocialCoreModule` += `InviteCodes` (provider + export).
- Идемпотентность: jobId = id события outbox (публикатор) + состояние (`upsertInvite` по паре, событие только на
  переходе). Ретраи — настройки публикатора outbox. Финальный провал — failed-набор, лог (RC-P6-10).

### 11.4 API — `sharing` (адрес на карточках)

- Новый `invite-address.ts` — `InviteAddress.of(userId): Promise<string | null>`: нет `APP_WEB_ORIGIN` → `null`; иначе
  `${new URL(origin).host}/i/${await codes.ensureOf(userId)}`. Сбой → лог `sharing.invite_address_failed` и `null`
  (карточка без строки).
- HTTP-сервисы четырёх карточек (`story-card.service.ts`, `ride-invite.service.ts`, `route-card.service.ts`,
  `achievement-card.service.ts`) вызывают `InviteAddress.of(userId)` **после** `consumeRead` и до `resolve`. Сигнатура
  `*Inputs.resolve(userId, …, template, address)`; `address` идёт во вход и в каждую `*Hash` функцию (после
  `template`), а также в данные задачи `CardRenderJob.data.address`. Схемы задач:
  `address: z.string().max(80).nullable().default(null)` (`default` — для задач в полёте при выкатке). Worker
  (`story-card.processor.ts`) передаёт `job.address` в `resolve` — хэш совпадает детерминированно (RC-P6-5).
- Рендер: вход каждого дерева += `address: string | null`. Общий узел `brandRow(token, colors, brand, address)` в
  `story-card.render.ts`: бренд слева, адрес справа (`justifyContent: 'space-between'`). Вставляется вместо
  `text(storyCard.text.colophon …)` («Линия») и `text(storyCard.text.masthead …)` («Ночь») во всех четырёх
  `*.render.ts` — геометрия ярусов не меняется. Без адреса — как сейчас.
- `packages/design-tokens/src/story-card.ts` += `text.address` (роль шрифта и размер — по образцу `colophon`).
  `sharing.policy.ts`: `renderVersion: 5` с комментарием «invites: адрес /i/<code>». OG-картинки (`og-card.*`) не
  меняются.
- `sharing.module.ts`: только `SharingModule` (HTTP) импортирует `SocialCoreModule` и получает провайдер
  `InviteAddress`; `SharingWorkerModule` не меняется — адрес приходит в данных задачи. `.dependency-cruiser.cjs` `social-consumers-only`: `pathNot` +=
  `sharing` (RC-P6-4).

### 11.5 Приложение (`apps/app`)

- Новый каталог `src/features/invites/` (не `features/social` — его создают P2/P3):
  - `invite-storage.ts` / `invite-storage.web.ts` (образец `push-soft-prompt-storage`): запись `{ code, at }` JSON.
    Native — `secureStorage` ключ `pokatim.invite` (в конец `SecureKey` с комментарием «не секрет, как
    `pokatim.pushSoftPrompt`»), web — `localStorage['pokatim.invite']` в `try/catch` (SSR, Safari). API: `rememberInvite(raw,
    now)` (только `InviteCode.safeParse`, перекрывает прежний), `takeInvite(now): Promise<string | null>` (старше
    `INVITE_TTL_MS = 7 * 24 * 3600_000` — стереть и `null`), `forgetInvite()`;
  - `invite-capture.tsx` — `InviteCapture` (монтируется в `RootShell` `_layout.tsx` одной строкой): `useGlobalSearchParams`
    `invite` → если статус сессии не `signedIn` → `rememberInvite` (RC-P6-7). Работает и для deep link
    `pokatim://…?invite=`;
  - `queries.ts` — `useOwnInviteCode()`: `useQuery({ queryKey: ['social', 'invite-code'], queryFn: api.getInviteCode,
    enabled: signedIn, staleTime: Infinity })`;
  - `invite-share-sync.tsx` — `InviteShareSync` (в `RootShell`): код из `useOwnInviteCode` → `setShareInvite(code)`,
    выход/гость → `setShareInvite(null)`;
  - `invite-friends-action.tsx` — `TextAction` «Позвать друзей» → `shareLink({ title, text, path: publicId ?
    '/riders/<publicId>' : '/' })` синхронно в обработчике; кнопка — только при `mounted && shareOrigin() && code`
    (RC-P6-12); уведомление «Ссылка скопирована» / сбой — как в `TicketActions`.
- `src/lib/share-invite.ts` (новый): модульное значение `setShareInvite(code | null)` и `withInvite(path)` (добавляет
  `invite=<code>` с `?` или `&`). Значение нужно синхронно: `navigator.share` вызывается до любого `await`.
  `share-link.ts` и `share-link.web.ts`: `url = origin + withInvite(path)` — одно место для всех четырёх вызывающих
  (райд, маршрут, билет, «Позвать друзей»). Гость → без параметра (AC2).
- Web-маршрут `src/app/i/[code].tsx`: эффект `rememberInvite(code)` (если не `signedIn`) → `router.replace('/')`,
  пока — пустой экран. В `app-routes-manifest.server.test.ts` — кейс `/i/K7M2PQX → /i/[code]`. Проверить, что
  `/i/` не попадает под `TOKEN_PATH_PREFIXES` `server/web-server.ts` (код не секрет — правка не нужна).
  `robots.txt+api.ts`: `Disallow: /i/`.
- `src/app/(onboarding)/register.tsx onSubmit`: `const invite = await takeInvite(Date.now())` →
  `register.mutateAsync(invite ? { ...values, invite } : values)` → после успеха (`store.start`) — `forgetInvite()`.
  Ошибка регистрации код не стирает.
- `own-profile-screen.tsx`: в `ProfileActions` — `<InviteFriendsAction publicId={publicId} />` **последним элементом**
  (P3 добавляет «Свои · N» в тот же экран). i18n: `invites.friends.action|shareTitle|shareText` — в конец словаря
  `packages/i18n` (оба языка, как принято в проекте).

### 11.6 Тест-матрица

| Уровень | Что |
|---|---|
| int API (реальная Mongo) `identity/registration.int.test.ts` | `invite` валидный → `users.invite` (верхний регистр); неверный формат / число / отсутствует → 201 и `invite: null` |
| int `identity/verification.int.test.ts` | первое подтверждение с кодом → ровно одно событие outbox `identity.account-confirmed {userId, invite}`; без кода — нет; повторный confirm — нет второго; неподтверждённый — нет (AC8) |
| int `identity/password-reset.int.test.ts` | сброс пароля неподтверждённого с кодом → событие; подтверждённого → нет (RC-P6-1) |
| int `identity/account-deletion.int.test.ts` / `account-erasure` | стирание ставит `users.invite = null`, `invite_codes` удалён (AC9) |
| int `social/social-invites.int.test.ts` (новый) | `GET social/invite-code`: 401 без входа, один и тот же код, `no-store`, формат; параллельные `ensureOf` → один код; коллизия кода (внедрённый генератор) → новый код |
| int там же: intake | валидно → 2 связи `invite`, 2 `connection-created`, 1 `invite-registered` (userId пригласившего, `props: {}`); повтор задачи → без изменений (AC6); неизвестный код, свой код, пригласивший с `deletedAt` (коды ещё не стёрты), удалённый приглашённый, payload не по схеме → связей нет, итог в ответе (AC7) |
| int `sharing/*-card.int.test.ts` | с `APP_WEB_ORIGIN` — `data.address = '<host>/i/<code>'` и хэш с адресом; без env — `null`; сбой `InviteCodes` → `null`, карточка рендерится; worker рендерит с адресом из задачи |
| unit API | `generateInviteCode` (алфавит, длина), `brandRow`/деревья 4 карточек × 2 шаблона с адресом и без, хэши меняются от `address`, `outbox-routes.test.ts` (маршрут `social-intake`), `SocialIntakeProcessor` (неизвестное имя — бросок, мусор — `skipped`) |
| unit contracts | `InviteCode` (нижний регистр → верхний, `0/O/1/I/L` отклонены, длина); `RegisterRequest` с мусорным `invite` → парсится, `invite: undefined`; `InviteCodeResponse` |
| unit app (jest, native + web) | `invite-storage(.web)`: перекрытие последним кодом, 7 дней — отдаёт, 7 дней + 1 мин — `null` и стёрт (AC5), мусор игнорируется, SSR без `window`; `withInvite` (без кода, с кодом, путь с `?`); `share-link(.web).test.ts` — URL с `invite`; `InviteCapture` не пишет при `signedIn`; `register` передаёт `invite` и стирает после успеха; `InviteFriendsAction` — путь публичного профиля / `/`, скрыт без кода; manifest `/i/[code]` |
| e2e web (`apps/app/e2e/web.spec.ts`) | гость открывает `/i/<code>` → главная; регистрация → тело `POST /v1/auth/register` содержит `invite` (перехват запроса) |

### 11.7 Implementation Context (для coder)

- **ENTRY POINTS:** `VerificationService.confirm`, `PasswordResetService.confirm`, `RegistrationService.register`,
  `GET /v1/social/invite-code`, `SocialIntakeProcessor`, четыре HTTP-сервиса карточек, `shareLink`, `RootShell`,
  `register.tsx`.
- **FILES TO MODIFY:** §11.1–11.5 (identity: events, collection, repository, verification, password-reset,
  registration, module, index; social: module, index, invite-codes.repository, connections.{repository,service},
  social.policy; sharing: inputs×4, services×4, processor, render×5, policy, module; `outbox-routes.ts(+test)`,
  `.dependency-cruiser.cjs`, contracts `registration.schema.ts` + `index.ts`, design-tokens `story-card.ts`, api-client
  `index.ts`, app `share-link{,.web}.ts`, `_layout.tsx`, `register.tsx`, `secure-storage.ts`, `own-profile-screen.tsx`,
  `robots.txt+api.ts`, `app-routes-manifest.server.test.ts`, i18n).
- **NEW FILES:** contracts `social/invite.schema.ts`; identity `account-confirmation.ts`; social
  `invite-codes.service.ts`, `invite-code.controller.ts`, `invite-intake.ts`, `social-intake.processor.ts`,
  `social.events.ts`, `social-invites.int.test.ts`; sharing `invite-address.ts`; app `features/invites/*`,
  `lib/share-invite.ts`, `app/i/[code].tsx`.
- **FILES TO READ:** `standings/standings-sync.processor.ts` (процессор по имени), `standings/standings.events.ts`
  (маршрут подписчика), `notifications/push-soft-prompt-storage{,.web}.ts`, `tickets/ticket-actions.tsx` (уведомления
  шеринга), `social/social-connections.int.test.ts` (хелперы `publicRider`).
- **OUT OF SCOPE:** уведомление пригласившему (P7, только комментарий-точка), универсальные ссылки, атрибуция входа,
  экраны «Свои», шеринг публичного профиля райдера чужим.
- **Пересечения с P1–P5:** только дописывание в конец: `api-client/index.ts`, `contracts/index.ts`, `SecureKey`, i18n,
  `subscriberOutboxRoutes`, `ProfileActions` (последним элементом), `SocialModule`/`SocialCoreModule` списки providers/
  exports/controllers. P6 создаёт `social-intake.processor.ts` и `social.events.ts` первым — P5 добавляет строки.
- **Команды:** `pnpm --filter @pokatim/contracts test`; `pnpm --filter @pokatim/api exec vitest run src/modules/identity
  src/modules/social src/modules/sharing src/outbox-routes.test.ts`; `pnpm --filter @pokatim/app test -- invites
  share-link register app-routes-manifest`; `pnpm arch:check`; `pnpm typecheck`; превью карточек
  `pnpm --filter @pokatim/api preview:story-cards <каталог>`; в конце группы — полный `pnpm check`
  (`TURBO_CONCURRENCY=4`).

### 11.8 Documentation Impact

- ADR-0027: п. 1 — `sharing` среди ссылающихся на `social` (порт `InviteCodes`); п. 5 — событие только при первом
  подтверждении аккаунта с кодом (оба пути: ссылка и сброс пароля), payload `{userId, invite}`, маршрут объявляет
  `social` (`socialOutboxRoutes`), проверка живости — `IdentityAccounts.liveUserIds`.
- `social.md` K9 — короткая ссылка `<домен>/i/<code>` на карточках, «Позвать друзей», формат кода (7 символов, без
  похожих); `profile.md` — кнопка «Позвать друзей».
- `pokatim-backend.md` — раздел «Свои»: `identity.account-confirmed`, `InviteCodes`, `social-intake` процессор,
  `sharing → social`; раздел карточек — адрес, `renderVersion 5`. `pokatim-app.md` — `features/invites`, ключ
  `pokatim.invite`, `withInvite` в `shareLink`. `pokatim-contracts.md` — `InviteCode`, `RegisterRequest.invite` с `catch`.

## 12. Outcome
