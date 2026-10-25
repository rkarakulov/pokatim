# 1. Title

Перевод pokatim (бывший on-bike) с PostgreSQL 18 + PostGIS + Drizzle на MongoDB 8.0 (replica set) поверх
`@rkarakulov/api-kit/{core,mongo}` и `@rkarakulov/test-kit/{core,mongo}` базы app-foundation 0.4.1

# 2. Goal

Решение автора: проект целиком на MongoDB. Данные dev не переносятся (стенд стартует с пустой БД), prod ещё нет.
После задачи pokatim — рендер шаблона app-foundation `v0.4.1` с ответом `database: mongo` плюс домен проекта:
`.copier-answers.yml` — `database: mongo` (без `use_postgis`), дальнейшие `copier update` идут чисто.

Поведение API, контракты и все гарантии безопасности слайсов 1–3 онбординга сохраняются **и подтверждаются
интеграционными тестами на реальном replica set**: одноразовый обмен токена регистрации, ротация refresh (из
параллельных одним токеном проходят ровно две), окно повтора, reuse detection, `revoked_reason`, отзыв всех сессий при
сбросе пароля, R4 (вход, проверивший старый пароль до коммита сброса, сессию не получает), R5 (сброс гасит токен
регистрации, poll, начатый до сброса, — 401), одна активная ссылка, захват отправки письма, очистка неподтверждённых
без удаления только что подтверждённого.

Dev-сервер переезжает сам при первом деплое: `mongo` (replica set) вместо `postgres`, старый контейнер postgres стека
остановлен и удалён **без удаления тома** `pokatim-dev_pgdata`, повторный деплой — без шагов переезда.

Попутно закрываются три LOW ревью переименования (PR #19): откат в runbook требует логина GHCR; уборка старых
пакетов GHCR `on-bike-*`; удаление legacy-шагов переезда on-bike → pokatim из `deploy.sh`/`bootstrap.sh`.

# 3. Scope

**Каркас API (дельты шаблона `postgres` → `mongo`, сверено рендером v0.4.1, §5)**
- `.copier-answers.yml`: `database: mongo`, без `use_postgis`.
- Зависимости: `mongodb` (каталог `^7.7.0`) вместо `pg`/`drizzle-orm`/`drizzle-kit`/`@types/pg`; `tsx` в devDeps API;
  `packageExtensions` — необязательные `pg`/`drizzle-orm` у `@rkarakulov/api-kit`/`test-kit`; lockfile.
- `apps/api`: env (`defineCoreEnv` + `mongoEnvShape`, `MONGO_URL`, `loadMongoUrl`), `src/db/{index,migrate,
  migrate-error}.ts`, `src/db/migrations/{index,0001_outbox}.ts`, health (`MONGO_DB.command({ ping: 1 })`),
  `app.module.ts`/`worker.module.ts` (`MongoModule`, `MongoOutboxModule`, `MongoOutboxPublisherModule`), импорты
  только из `/core` и `/mongo` (ESLint запрещает корни пакетов), стенд тестов (`createMongoApiHarness`,
  `recreateTestMongoDatabase`), `tsconfig.json`, `vitest.config.mts`, `package.json` (`db:migrate` = `tsx
  src/db/migrate.ts`, без `db:generate`/`db:studio`). Удаляются `drizzle/**`, `drizzle.config.ts`,
  `src/db/schema.ts`, `test/db.ts`.
- Корень: `infra/docker-compose.dev.yml` (`mongo:8.0` single-node RS, `127.0.0.1:27017`, healthcheck с
  `rs.initiate`, том `mongodata`), `package.json` (`infra:up` с `--wait`), `turbo.json` (`MONGO_URL_TEST`),
  `eslint.config.mjs`, `.prettierignore`.

**Модуль `identity` на MongoDB**
- `identity.schema.ts` → `identity.collection.ts`: имена коллекций, интерфейсы документов, `SESSION_REVOKED_REASONS`,
  `identityCollections(db)`.
- Миграция `0002_identity` (все коллекции и индексы identity: уникальность e-mail, частичные уникальные «одна
  активная ссылка», уникальность хешей токенов, индексы `userId`, частичный индекс очистки неподтверждённых) и
  `0003_identity_ttl` (TTL-уборка, Q2).
- `identity.repository.ts` — на драйвере `mongodb`: прежние методы и `*State`-типы (сервисы почти не меняются),
  `session?: DbSession` вместо `DbExecutor`, `lockUser`/`lockUserCredentials` = `$inc: { version: 1 }` в транзакции
  (R1), ротация — один `findOneAndUpdate` с pipeline-обновлением (R3), каскад удаления — явный (R4), `nextId` →
  `uuidv7()` базы.
- Сервисы и worker: `repository.db.transaction(...)` → `MongoTransactions.run(...)`, `OutboxWriter`/`OutboxReader`
  → `MongoOutboxWriter`/`MongoOutboxReader`, `isUniqueViolation` → `isDuplicateKey`.
- Все int-тесты identity переносятся на MongoDB без ослабления проверок; гонки, проверявшиеся `FOR UPDATE` +
  `waitForLockWaiter`, — переписываются на ворота (spy) и удерживаемую транзакцию (R9); новые тесты гонок,
  которых в PG не было, но которые в Mongo устроены иначе (сброс ↔ ротация в обоих порядках, сброс в процессе ↔ вход,
  очистка ↔ подтверждение, регистрация одного адреса).

**Треки / геоданные** — PostGIS в коде не используется (проверено, §5): удаляется миграция `0000_enable_postgis`,
правила и документы переводятся на GeoJSON + `2dsphere` (R11, Q3); `packages/tracks` — только комментарий.

**CI / сборка / деплой**
- `.github/workflows/ci.yml`: job `check` и `web` — без service `postgres`, шаг replica set (как рендер), env
  `MONGO_URL_TEST` / `MONGO_URL`; миграции смоука — `db:migrate`.
- `infra/docker/Dockerfile`: без `drizzle-kit` и `drizzle/`; миграции — `node dist/db/migrate.js`.
- `infra/deploy/{docker-compose.yml,deploy.sh,bootstrap.sh,env.template}`, `.github/workflows/deploy-dev.yml`
  (список копируемых файлов): сервис `mongo` (RS, auth по Q1, healthcheck, тома `mongodata`/`mongoconfig`, лимит
  памяти и кэша WiredTiger), `migrate` — `node dist/db/migrate.js`, идемпотентный переезд (`retire_postgres`),
  пользователь приложения (Q1), смоук.
- Удаление legacy-шагов переезда on-bike → pokatim (LOW 3): `migrate_legacy_env`, `stop_legacy_stack`, прочистка по
  `by.on-bike.project`, `POKATIM_LEGACY_*`, `remove_legacy_vhost`, `LEGACY_MAIL_FROM`, `ON_BIKE_TAG` в управляемых
  ключах.
- `infra/docker-compose.prod.yml`, `infra/.env.example` (заготовка prod) — MongoDB вместо PostgreSQL.

**Документы и правила** — §10: новый ADR-0007, пересмотр ADR-0001 (+ пометки 0002/0005/0006), `AGENTS.md`,
`CLAUDE.md`, `README.md`, `.claude/rules/{db,backend}.md` (рендер), `pokatim-{db,backend,tests}.md`,
`tools/ai_review/review_contract.md` (рендер), architecture, runbooks (`local-dev`, `deploy` + LOW 1–2, `README`).

# 4. Out of Scope

- Перенос данных dev-БД (PostgreSQL → MongoDB) — стенд стартует пустым; тестовые аккаунты регистрируются заново.
- Удаление тома `pokatim-dev_pgdata` и пакетов GHCR `on-bike-*` — **руками человека** после проверки (команды —
  в runbook), не скриптом.
- Изменения контрактов, API, приложения (`apps/app`, `apps/admin`), кроме текста пропуска e2e.
- Изменения app-foundation. Кандидаты в базу (follow-up): помощник теста «удерживаемая транзакция»
  (аналог `waitForLockWaiter`), `lockDocument` (`$inc version`), TTL/уборка опубликованного `outbox`, identity (F6).
- Реализация геофункций (коридор, «рядом», кластеры) — только решение и правила (R11, Q3).
- Автоматический ночной бэкап MongoDB — планируемый `backup-restore.md` (Q4); здесь — ручной `mongodump` в runbook.
- `$jsonSchema`-валидаторы коллекций (R5), CSFLE, шардирование, change streams, Mongoose (D1 базы).
- Журнал `auth_events`, AuthGuard, лимитер `peek/reset` и прочие follow-up слайсов 2–3.
- Мобильные сборки: API не меняется, старые сборки работают; сессии dev — заново (новая БД).

# 5. Architecture Context

Проверено по `origin/develop` (`64bf48d`) и рендерам шаблона `v0.4.1` (`uvx copier@9.19.1 copy --vcs-ref v0.4.1
--defaults --data database=mongo|postgres …` с ответами pokatim, `diff -r` рендеров):

- **Дельта шаблона `postgres` → `mongo`** (30 файлов): `.copier-answers.yml`, `.github/workflows/ci.yml` (RS-шаг вместо
  service, `MONGO_URL_TEST`), `.prettierignore`, `AGENTS.md` (§2 строка про входы, §3 `infra:up`/`db:migrate`, §4.5,
  §8), `CLAUDE.md`, `README.md`, `.claude/rules/{db,backend}.md`, `tools/ai_review/review_contract.md` (строка
  операторной инъекции — HIGH), `docs/adr/0001-stack.md`, `docs/runbooks/local-dev.md`, `eslint.config.mjs`
  (`no-restricted-imports` корней), `infra/docker-compose.dev.yml`, `package.json` (`infra:up --wait`),
  `pnpm-workspace.yaml`, `turbo.json`, `apps/api/{.env.example,package.json,tsconfig.json,vitest.config.mts}`,
  `apps/api/src/{app.module,worker.module,main,http-app(.test),error-messages(.test)}.ts`,
  `src/config/env(.test).ts`, `src/db/index.ts`, `src/modules/health/{health.service,health.controller.test}.ts`,
  `test/{global-setup,harness,harness.int.test,test-env}.ts`; только в mongo — `src/db/{migrate,migrate-error(.test)}.ts`,
  `src/db/migrations/*`; только в postgres — `drizzle/**`, `drizzle.config.ts`, `src/db/schema.ts`, `test/db.ts`.
- **API пакетов базы 0.4.1** (`app-foundation` `origin/main`): `/core` — `ClockModule`, `CLOCK`, `ConfigModule`,
  `defineCoreEnv`, `ENV`, `mailEnvShape`, `ApiExceptionFilter`, `DomainError`, `ZodValidationPipe`,
  `createFastifyAdapter`, `MailModule`, `MAILER`, `OutboxJobData`, `QueueModule`, `RateLimiter`, `RedisModule`;
  `/mongo` — `MongoModule`, `MONGO_CLIENT`, `MONGO_DB`, `MongoTransactions.run(fn)` (`readConcern: snapshot`,
  `writeConcern: majority`, колбэк может повториться при `TransientTransactionError`), `MongoOutboxWriter.append
  (session, event)`, `MongoOutboxReader.payloadOf(id)`, `MongoOutboxPublisherModule.forRoot({ routes })`,
  `isDuplicateKey(err, indexName)` (без `keyValue`), `uuidv7()`, `runMongoMigrations`, `ensureOutboxIndexes`;
  test-kit `/mongo` — `createMongoApiHarness` (`{ env, clock, mailer, app, worker, client, db, redis, reset, close }`),
  `recreateTestMongoDatabase`, `clearCollections`; `/core` — `TestClock`, `FakeMailer`, `DAY/HOUR/MINUTE`.
  **Аналога `waitForLockWaiter` нет** (в Mongo нет ожидания блокировки строки — конфликт записи и повтор).
- **PostgreSQL-специфика identity** (`identity.repository.ts`, 575 строк): `SELECT … FOR UPDATE` (`lockUser`,
  `lockUserCredentials`), `uuidv7()` в SQL (`nextId`), `UPDATE … FROM users` (захват отправки), `EXISTS (users …)`
  в условиях (`consumeRegistrationToken`, `rotateSession`), `UPDATE … SET previous = refresh_token_hash` и
  `LEAST(…, created_at + interval)` (ротация), `ON CONFLICT DO UPDATE` (`replaceRegistrationToken`), `DELETE … IN
  (subquery)` с перепроверкой условий после ожидания блокировки (очистка), FK `ON DELETE CASCADE` (5 таблиц), CHECK
  (`users_email_lowercase`, `user_consents_kind_check`, `sessions_revoked_reason_check`). Сервисы транзакции
  открывают через `repository.db.transaction`. Тесты: `h.db` (drizzle) в 9 int-файлах, `h.pool` +
  `waitForLockWaiter` — 3 теста гонок (`password-reset.int.test.ts` ×2, `cleanup-unverified.processor.int.test.ts`),
  `test/db.ts` (`createTestDb`, `truncateAll`) — `identity.repository.int.test.ts`.
- **PostGIS:** миграция `0000_enable_postgis.sql` (только `CREATE EXTENSION`), `drizzle.config.ts`
  (`extensionsFilters`), тест стенда (`spatial_ref_sys`). Геометрических колонок, `ST_*`, гео-запросов **нет**;
  `packages/tracks` — чистый TS (`haversineMeters`, `trackLengthMeters`), `TrackProcessingProcessor` — заглушка.
- **Деплой:** `infra/deploy/docker-compose.yml` (`postgis/postgis:18-3.6@sha256`, `POSTGRES_PASSWORD`, `migrate` —
  `drizzle-kit migrate`), `deploy.sh` (`compose up … postgres redis mailpit`, затем `run --rm migrate`, `up
  --remove-orphans`), `Dockerfile` (`runtime-deps … drizzle-kit`, копия `drizzle/`). Лог деплоя `sha-64bf48d`
  (2026-10-24 20:04): все шаги переезда on-bike → pokatim выполнены (`.env` перенесён, прежний стек остановлен,
  прежний vhost снят, образы прочищены) — legacy-код можно удалять. В GHCR лежат `on-bike-{api,web,admin}` и
  `pokatim-{api,web,admin}`.
- **Redis, BullMQ, лимиты, JWT, cookie, контракты** — без изменений.

# 5.1 Placement & Reuse Gate

| Что | Где | Почему |
|---|---|---|
| Клиент, транзакции, outbox, мигратор, `uuidv7`, `isDuplicateKey` | `@rkarakulov/api-kit/mongo` (есть) | общий код базы; копии в проекте запрещены |
| Стенд тестов | `@rkarakulov/test-kit/mongo` (есть) | `createMongoApiHarness`, `recreateTestMongoDatabase` |
| Каркас `apps/api` и инфраструктура dev/CI | дословно из рендера `v0.4.1 mongo` | `copier update` дальше без конфликтов |
| Коллекции и документы identity | `apps/api/src/modules/identity/identity.collection.ts` | `db.md`: коллекция модуля — `*.collection.ts` |
| Индексы identity | `apps/api/src/db/migrations/0002_identity.ts`, `0003_identity_ttl.ts` | индексы — только миграциями (D8) |
| Помощники тестов гонок (удерживаемая транзакция, ворота) | `apps/api/test/identity.ts` (или `test/races.ts`) | один потребитель; кандидат в test-kit — follow-up |
| Коридор и геометрия треков (когда появятся) | `packages/tracks` (TS, worker) + GeoJSON/`2dsphere` | R11 |

- **Переиспользуем:** `MongoTransactions`, `MongoOutboxWriter/Reader`, `MongoOutboxPublisherModule`, `MONGO_DB`,
  `uuidv7`, `isDuplicateKey`, `runMongoMigrations`, `ensureOutboxIndexes`, `createMongoApiHarness`,
  `recreateTestMongoDatabase`, `clearCollections`, `TestClock`, `FakeMailer`; из проекта — все сервисы, токены,
  политика, письма, контроллеры, обработчики писем, `identityOutboxRoutes`, `QUEUE` без изменений смысла.
- **Запрещённые дубли:** свой Mongo-клиент/модуль/мигратор/outbox/`uuidv7` в проекте; второй источник схемы
  (Mongoose, `$jsonSchema` рядом с TS-интерфейсами — R5); копия рендерных файлов шаблона с «улучшениями» (только
  дословно + project-дельты, отмеченные в §11); импорт корней `@rkarakulov/api-kit`/`test-kit`; `createIndex` вне
  миграций; объект запроса в фильтре/обновлении; запись в документы аккаунта в транзакции без `lockUser` (R1);
  вторая реализация захвата отправки письма (одна `claimLinkSend` для двух коллекций ссылок, как сейчас).
- **Пакеты:** новых нет.

# 6. Relevant Files

- Рендер шаблона (эталон): `uvx copier@9.19.1 copy --vcs-ref v0.4.1 --defaults --trust --data database=mongo
  --data project_name=pokatim --data project_slug=pokatim --data npm_scope=pokatim --data app_scheme=pokatim
  --data bundle_id=by.pokatim.app --data "author=Roman Karakulov" gh:rkarakulov/app-foundation <scratch>` (git — через
  `gh auth git-credential`); для дельты — тот же рендер с `database=postgres --data use_postgis=true`.
- `apps/api/src/modules/identity/**` (все файлы), `apps/api/src/{app.module,worker.module,main,http-app,
  error-messages,queues}.ts`, `src/config/env(.test).ts`, `src/db/*`, `src/modules/health/*`, `src/modules/tracks/*`,
  `apps/api/drizzle/*`, `apps/api/test/*`, `apps/api/{package.json,tsconfig.json,vitest.config.mts,.env.example,
  drizzle.config.ts}`.
- `infra/deploy/*`, `infra/docker/{Dockerfile,runtime-deps.mjs}`, `infra/docker-compose.{dev,prod}.yml`,
  `infra/.env.example`, `.github/workflows/{ci,deploy-dev}.yml`, `pnpm-workspace.yaml`, `package.json`, `turbo.json`,
  `eslint.config.mjs`, `.prettierignore`, `.copier-answers.yml`.
- `packages/tracks/src/geo.ts`, `apps/app/e2e/web.spec.ts` (текст пропуска).
- Документы §10.

# 7. Implementation Notes

**Перенос каркаса.** Ручной перенос по дельте рендеров (§5) — файлы, которые проект не менял, берутся из
mongo-рендера дословно; в файлах с project-частью (`env.ts`: `JWT_SECRET`, `EMAIL_TOKEN_SECRET`, `APP_LINK_BASE`,
`AGREEMENT_VERSION`; модули — `IdentityModule`, `TracksModule`, маршруты outbox; `ci.yml` — job `web` с API;
`AGENTS.md`, `CLAUDE.md`, `README.md` — тексты проекта) применяется только дельта шаблона. Проверка похожести —
`copier update` в копии ветки (AC10). `copier update --data database=mongo` не используем: шаблон смену БД не
поддерживает, PG-правки проекта применятся поверх mongo-рендера как пользовательский дифф (R8).

**Документы.** Поля — camelCase, `_id` — строка UUID v7 (`uuidv7()` в приложении до вставки: от id выводится токен
ссылки и `sid`), время — BSON `Date` из `CLOCK`, nullable-поля пишутся явным `null` (фильтры `{ x: null }` и частичные
индексы `{ $eq: null }` совпадают). Репозиторий отдаёт прежние `UserState`, `VerificationTokenState`,
`PasswordResetTokenState`, `RegistrationTokenState` (`_id` → `id`) — сервисы меняются только в транзакциях и
импортах. Чтение терпит отсутствие поля (`?? null`) — правило expand/contract D8.

| Коллекция | Документ (кроме `_id`) |
|---|---|
| `users` | `email` (нормализованный), `passwordHash`, `birthDate` (`'YYYY-MM-DD'`), `emailVerifiedAt`, `createdAt`, `deletedAt`, `version` (int, R1) |
| `user_consents` | `userId`, `kind` (`'personal_data' \| 'agreement'`), `version`, `acceptedAt` — append-only |
| `email_verification_tokens`, `password_reset_tokens` | `userId`, `tokenHash`, `createdAt`, `expiresAt`, `usedAt`, `supersededAt`, `sentAt`, `sendClaimedAt` |
| `registration_tokens` | `userId`, `tokenHash`, `createdAt`, `expiresAt`, `consumedAt` |
| `sessions` | `userId`, `refreshTokenHash`, `previousRefreshTokenHash`, `rotatedAt`, `createdAt`, `expiresAt`, `revokedAt`, `revokedReason` |

**Транзакции и сериализация аккаунта (R1).** `lockUser(session, userId)` =
`users.findOneAndUpdate({ _id: userId }, { $inc: { version: 1 } }, { session, returnDocument: 'after', projection })`
— **первая** операция каждой транзакции, меняющей документы аккаунта (confirm/resend подтверждения, poll, вход,
запрос и смена пароля, очистка). Две такие транзакции одного аккаунта пишут один документ → у второй конфликт записи
(`WriteConflict`, `TransientTransactionError`) → `MongoTransactions.run` повторяет колбэк целиком на свежем снимке —
аналог ожидания `FOR UPDATE` с перечитыванием. Поэтому внутри колбэка: только операции с `session`, без побочных
эффектов; argon2 — до транзакции (как сейчас); логи и ответ — после `run`. `lockUserCredentials` — тот же вызов с
`passwordHash` в проекции (R4 слайса 3: сравнить с проверенным хешем).

**Операции вне транзакции — только атомарные над одним документом:** ротация (`findOneAndUpdate`), reuse detection,
отзыв по токену (`updateOne`), захват/фиксация/снятие захвата отправки письма. Если документ держит транзакция,
запись вне транзакции ждёт её конца и перепроверяет фильтр (поведение MongoDB для in-progress транзакций — сверить
по docs, context7) — отозванная сброшенная сессия после коммита сброса не ротируется.

**Методы репозитория — соответствие PG → Mongo:**
- `nextId` — удаляется: `uuidv7()` из `@rkarakulov/api-kit/mongo` в сервисах.
- `insertUser` — `insertOne`; гонка одного адреса — уникальный индекс `users_email_unique`: в транзакции вторая
  регистрация получает `WriteConflict` (повтор → `findUserByEmail` видит адрес → `EMAIL_TAKEN`) или `11000` после
  коммита первой → `isDuplicateKey(error, 'users_email_unique')` → `EMAIL_TAKEN`.
- `consumeRegistrationToken(session, tokenHash, now, user)` — условие «e-mail подтверждён» берётся из документа
  `lockUser` той же транзакции (вместо `EXISTS`); обмен — `findOneAndUpdate({ tokenHash, consumedAt: null,
  expiresAt: { $gt: now } }, { $set: { consumedAt: now } })`.
- `replaceRegistrationToken` — `updateOne({ userId }, { $set: {…, consumedAt: null}, $setOnInsert: { _id: uuidv7(),
  userId } }, { upsert: true, session })` (под `lockUser`).
- `rotateSession` — R3. `markReuseDetected`, `revokeSession` — `findOneAndUpdate`/`updateOne` с теми же условиями.
- `revokeAllSessions` — `updateMany({ userId, revokedAt: null }, { $set: { revokedAt, revokedReason } }, { session })`,
  возвращает `modifiedCount`.
- `claimLinkSend(kind, id, now, leaseMs)` — чтение владельца (`deletedAt`, для подтверждения — `emailVerifiedAt`) →
  `findOneAndUpdate` документа ссылки с прежними условиями (`sentAt: null`, `usedAt: null`, `supersededAt: null`,
  `expiresAt > now`, захват свободен или истёк) → `claimed`; иначе `findOne` по тем же условиям без захвата → `busy`;
  иначе `undefined`. Условие по аккаунту — не атомарно с захватом (R6). Коллекция — по `kind` (одна реализация).
- `deleteUnverifiedBatch` — R4.
- Остальные (`find*ByHash`, `findPasswordResetById`, `supersede*`, `mark*`, `extendRegistrationToken`,
  `revokeRegistrationToken`, `updatePasswordHash`, `markEmailVerified`, `insertConsents`) — прямой перенос
  (`findOne` + чтение владельца вторым запросом вместо `JOIN`; в транзакции — в той же `session`).

**Миграции.** `0001_outbox` — из рендера (`ensureOutboxIndexes`). `0002_identity` — `createCollection` (если нет) и
индексы (имена сохраняем из PG — тесты и `isDuplicateKey` ссылаются на них):

| Коллекция | Индекс | Ключ / опции |
|---|---|---|
| `users` | `users_email_unique` | `{ email: 1 }`, unique (вкл. удалённые, D-07) |
| `users` | `users_unverified_created_at_idx` | `{ createdAt: 1 }`, partial `{ emailVerifiedAt: { $eq: null }, deletedAt: { $eq: null } }` |
| `user_consents` | `user_consents_user_id_idx` | `{ userId: 1 }` |
| `email_verification_tokens` | `…_token_hash_unique` | `{ tokenHash: 1 }`, unique |
| `email_verification_tokens` | `…_user_id_idx` | `{ userId: 1, createdAt: -1 }` (ключ отличается от частичного — без вопроса о двух индексах на одном ключе) |
| `email_verification_tokens` | `…_active_unique` | `{ userId: 1 }`, unique, partial `{ usedAt: { $eq: null }, supersededAt: { $eq: null } }` |
| `password_reset_tokens` | `…_token_hash_unique`, `…_user_id_idx`, `…_active_unique` | как у подтверждения |
| `registration_tokens` | `registration_tokens_user_id_unique`, `…_token_hash_unique` | `{ userId: 1 }` unique; `{ tokenHash: 1 }` unique |
| `sessions` | `sessions_refresh_token_hash_unique` | `{ refreshTokenHash: 1 }`, unique |
| `sessions` | `sessions_previous_refresh_token_hash_unique` | `{ previousRefreshTokenHash: 1 }`, unique, partial `{ previousRefreshTokenHash: { $type: 'string' } }` (`$exists` пропустил бы `null`) |
| `sessions` | `sessions_user_id_idx` | `{ userId: 1 }` |

`0003_identity_ttl` (Q2, по умолчанию — да): `{ expiresAt: 1 }` с `expireAfterSeconds` = 30 дней на `sessions`,
`email_verification_tokens`, `password_reset_tokens`, `registration_tokens` (имена `*_expires_at_ttl`). TTL — только
уборка: истечение по-прежнему проверяет сервер по `CLOCK`. Одна миграция identity вместо 0002–0005: применённых
миграций Mongo нигде нет, история PG в Mongo не нужна.

**Порядок деплоя (переезд dev-сервера, идемпотентно):** bootstrap (`.env`: новые `@secret`, keyfile — Q1) → pull →
`retire_postgres` (есть контейнер сервиса `postgres` проекта `pokatim-dev` → `docker stop` + `docker rm`, **без**
`-v`; лог «том pokatim-dev_pgdata сохранён»; нет контейнера — ничего) → `compose up -d --wait mongo redis mailpit` →
пользователь приложения (Q1, `createUser`/`updateUser` идемпотентно) → `compose run --rm migrate` (`node
dist/db/migrate.js`, вывод — в `~/pokatim/migrate.log`) → api/worker/web/admin → smoke (`/v1/health` →
`checks.database: up`). Ключ `POSTGRES_PASSWORD` в `.env` сервера не удаляется (нужен для ручного отката, §8).

# 8. Risks / Assumptions / Open Questions

- **Гарантии гонок меняют механизм.** PG — ожидание блокировки строки и перепроверка `WHERE`; Mongo — конфликт
  записи и повтор транзакции. Каждая гарантия слайсов 1–3 перепроверяется тестом на реальном RS, причём для R4 и
  отзыва сессий — в обоих порядках (коммит до чтения и транзакция «в процессе»), и для ключевых — с «отрицательным
  доказательством» (без механизма тест падает; фиксируется в §12) (R9).
- **Write skew.** Условие по другому документу без записи в него в Mongo не защищено (F7 базы). Закрыто R1
  (все мутации аккаунта пишут `users.version`) и тем, что единственные записи вне транзакций — атомарные операции
  над одним документом. Новое правило — в `pokatim-db.md`; нарушение — HIGH в ревью.
- **Повтор колбэка транзакции.** Побочные эффекты внутри колбэка (лог, запрос в Redis, письмо) при повторе
  задвоятся. Сейчас внутри только БД и outbox, кроме `takeResendAllowance` в регистрации (Redis, «Redis недоступен —
  откат и 500»): при повторе колбэка `insertUser` получает новый `uuidv7`, и второй вызов списывает лимит уже с
  нового ключа `verify-resend:<новый id>` — 429 не возникает, остаётся «сиротский» ключ с TTL окна. Принимается как
  исключение с комментарием и тестом (R12).
- **Конкуренция одного аккаунта.** Вместо очереди на блокировке — немедленный конфликт и повтор с backoff драйвера
  (до 120 с `withTransaction`). Для одного пользователя редкость; argon2 вне транзакций.
- **Ротация и удалённый аккаунт.** `EXISTS users.deleted_at IS NULL` в одном UPDATE в Mongo невозможно: ротация
  читает пользователя перед `findOneAndUpdate`; окно гонки закрывается инвариантом «удаление аккаунта (будущее) в
  той же транзакции отзывает все сессии» (R3). Удаления аккаунта сейчас нет — `deletedAt` ставят только тесты.
- **Потеря ограничений БД.** CHECK (нижний регистр e-mail, `kind`, `revoked_reason`) и FK с каскадом исчезают:
  инвариант держит код (типы, единственный писатель — репозиторий) + int-тесты; каскад — явный (R4, R5).
- **Устаревшие задачи BullMQ.** В Redis стенда могут лежать задачи `identity-email` с id событий PG-outbox: обработчики
  не найдут payload и залогируют `skipped` — безвредно. Сессии и cookie dev-пользователей не найдутся → 401 → вход
  заново (данные не переносятся).
- **Откат через границу БД невозможен** через `image_tag`: образы до этой задачи ждут `DATABASE_URL` и `postgres`, а
  деплой кладёт новый compose. Ручной возврат — compose-файлы из коммита до задачи, том `pgdata` и `POSTGRES_PASSWORD`
  сохранены (runbook).
- **MongoDB с auth в RS на общем сервере (Q1)** — keyfile, healthcheck с аутентификацией, создание пользователя;
  поведение entrypoint образа `mongo:8.0` с `--replSet` + `--keyFile` + `MONGO_INITDB_ROOT_*` проверить прототипом
  до кода S3 (запасной путь — пользователи через localhost exception после `rs.initiate`).
- **Память стенда.** Сервер общий (лимиты ≤ 2,5 ГБ): `mongo` — лимит `768m` и `--wiredTigerCacheSizeGB 0.25`
  [ASSUMPTION: сверить по docs, учитывает ли mongod 8.0 лимит cgroup]; postgres (512m) освобождается.
- **Геоданные (Q3).** Чего нет в MongoDB относительно PostGIS — R11; функций сейчас нет, риск — в будущих задачах
  треков.
- `[ASSUMPTION]` Деплой `sha-64bf48d` завершил переезд on-bike → pokatim (лог Actions), поэтому legacy-шаги удаляются
  без ущерба; тома `on-bike-dev_*` и `~/on-bike` остаются до ручной уборки (runbook).

# 8.1 Requirements Consistency

Architecture Review — pokatim-mongo. **Status: CONCERNS** — блокеров нет: решение автора («всё на Mongo, данные dev не
переносим») не противоречит инвариантам AGENTS.md §4 (§4.5 «outbox в Postgres» и §4.6 переписываются рендером
шаблона, смысл тот же). Вопросы Q1–Q8 — автору (human gate), без ответа реализуется рекомендация; Q1 влияет только на
S3 (деплой). Решения R1–R13 — архитектора, оркестратор может переиграть.

- **R1. Сериализация мутаций аккаунта без `SELECT … FOR UPDATE`.** Альтернативы: (а) **`lockUser` =
  `$inc: { version: 1 }` документа `users` первой операцией транзакции** — правило D8 базы; конфликт записи
  сериализует транзакции одного аккаунта, повтор колбэка перечитывает состояние на новом снимке; методы
  `lockUser`/`lockUserCredentials` сохраняют имена и смысл, сервисы почти не меняются; (б) отдельная коллекция
  блокировок с lease (`account_locks`) — пессимистичная блокировка руками: истечение lease, уборка, зависания при
  падении процесса; (в) вложить сессии и ссылки в документ `users` — неограниченные массивы, горячий документ на
  каждый refresh, большие диффы. **Рекомендую (а).** Следствие-правило: любая запись в документы аккаунта, от которой
  зависят проверки другой транзакции, — только в транзакции с `lockUser`; вне транзакции — только атомарные операции
  над одним документом (ротация/отзыв по токену, захват отправки).
- **R2. R4 слайса 3 (вход ↔ сброс) сохраняется дословно:** пароль проверяется до транзакции, под `lockUserCredentials`
  хеш сверяется с проверенным, иначе 401. В Mongo два пути: сброс закоммичен до снимка входа → вход видит новый хеш;
  сброс «в процессе» → `$inc` входа конфликтует, повтор после коммита видит новый хеш. Оба — тестом (R9).
- **R3. Ротация refresh одним `findOneAndUpdate` с pipeline-обновлением.** Фильтр: `revokedAt: null`, `expiresAt >
  now`, `$or` [`refreshTokenHash = h`, (`previousRefreshTokenHash = h` и `rotatedAt > now − grace`)]. Обновление:
  `[{ $set: { previousRefreshTokenHash: '$refreshTokenHash', refreshTokenHash: { $literal: next }, rotatedAt:
  { $literal: now }, expiresAt: { $min: [{ $literal: sliding }, { $add: ['$createdAt', absoluteTtlMs] }] } } }]` —
  `previous` берёт значение документа до обновления (как `SET` в PG). Значения — только через `$literal` (строка,
  начинающаяся с `$`, в pipeline — путь поля; правило в `pokatim-db.md`). Параллельные ротации одного токена
  сериализуются на документе с перепроверкой фильтра — проходят ровно две (тест «5 refresh» остаётся). Удалённый
  пользователь — чтение `users` перед ротацией (окно гонки закрывает инвариант: будущее удаление аккаунта отзывает
  все сессии в той же транзакции — правило в `pokatim-security.md`). Альтернативы: ротация в транзакции с `lockUser`
  — каждый refresh пишет `users`, конфликты между устройствами одного пользователя без выигрыша в гарантиях;
  денормализация `userDeletedAt` в сессии — та же запись при удалении, что и отзыв. **Рекомендую pipeline + инвариант.**
- **R4. Каскад вместо FK.** Очистка неподтверждённых: кандидаты (`users_unverified_created_at_idx`, `limit`) → на
  каждого — транзакция: `findOneAndDelete({ _id, emailVerifiedAt: null, deletedAt: null, createdAt: { $lt } })`
  (запись в `users` = конфликт с идущим подтверждением; после повтора условие не выполняется → пропуск) → при
  удалении — `deleteMany({ userId })` в `user_consents`, двух коллекциях ссылок, `registration_tokens`, `sessions`.
  Удаление согласий неподтверждённого аккаунта — как каскад PG (не нарушение append-only: аккаунт так и не
  существовал). Альтернатива — TTL на `users` — не делает каскад и не проверяет подтверждение. Нет.
- **R5. CHECK-ограничения → типы и тесты.** Альтернативы: (а) **TS-интерфейсы + единственный писатель
  (репозиторий) + int-тесты** (нижний регистр e-mail, допустимые `kind`/`revokedReason`) — D1 базы, один источник
  схемы; (б) `$jsonSchema` через `collMod` в миграции — второй источник схемы рядом с TS, вне правил базы.
  **Рекомендую (а).**
- **R6. Захват отправки письма не атомарен с условием по аккаунту** (было `UPDATE … FROM users`). Гонка: аккаунт
  подтвердили/удалили между чтением владельца и захватом → одно лишнее письмо по ссылке, которая уже ничего не делает
  (подтверждённый — «уже подтверждён», удалённый — 404). Альтернатива — захват в транзакции с `lockUser`: worker
  конфликтует с действиями пользователя ради безвредного письма. **Принимаем**, комментарий в репозитории.
- **R7. Миграции:** одна `0002_identity` вместо 0002–0005 PG (применённых Mongo-миграций нет) + `0003_identity_ttl`
  (Q2); имена индексов — из PG; у частичного уникального и обычного индекса по `userId` — разные ключи (§7).
- **R8. Способ перехода — ручной перенос по дельте рендеров + проверка `copier update` в копии** (AC10). Альтернативы:
  `copier update --data database=mongo` — шаблон смену БД не поддерживает, PG-файлы проекта вернутся как
  пользовательский дифф, исключения `_exclude` новой БД не уберут старые файлы; свежий `copier copy` + пересадка
  домена — максимум шума в истории и риск потерять project-правки. **Рекомендую ручной перенос.**
- **R9. Тесты гонок без `waitForLockWaiter`.** Два приёма: **ворота** — `vi.spyOn(repository, 'lockUser…')`
  приостанавливает операцию между проверкой и блокировкой, другая операция завершается полностью, ворота открываются
  (как тест poll ↔ сброс слайса 3); **удерживаемая транзакция** — помощник стенда открывает `client.startSession()`,
  `startTransaction()`, пишет документ (например, `$inc version` + новый `passwordHash`), не коммитит; проверяемая
  операция стартует; `vi.waitFor` ждёт её повтора (счётчик вызовов spy ≥ 2 — конфликт случился) или ожидания
  записи вне транзакции; затем `commitTransaction()`. Ключевые тесты — с отрицательным доказательством (убрать
  механизм → тест красный; результат — в §12). Помощник — `apps/api/test/identity.ts`, кандидат в test-kit.
- **R10. Деплой MongoDB на общем dev-сервере.** Single-node replica set (транзакции и outbox без RS не работают,
  `MongoModule` падает на старте), без портов хоста, член набора — `mongo:27017` (адрес сервиса в сети compose,
  `MONGO_URL` с `replicaSet=rs0`; в dev/CI — `directConnection=true` как в шаблоне), healthcheck — PRIMARY,
  тома `mongodata:/data/db` и `mongoconfig:/data/configdb` (иначе анонимный том образа), образ — `mongo:8.0@sha256:…`
  (как остальные образы стенда), лимит памяти и кэш WiredTiger (§8). Аутентификация — Q1. Переезд —
  `retire_postgres` (§7), `pgdata` остаётся. Миграции — тот же одноразовый контейнер `migrate`, вывод — в файл.
- **R11. Геоданные: что теряем без PostGIS.** Сейчас не используется ничего (только `CREATE EXTENSION`). Для будущих
  функций в MongoDB `2dsphere` есть: GeoJSON `Point`/`LineString`/`Polygon`/`Multi*`, `$geoWithin` (полигон,
  `$centerSphere`), `$geoIntersects`, `$near`/`$geoNear` с сортировкой по расстоянию и `maxDistance` (метры, сфера
  WGS84). Нет: буфера (`ST_Buffer` — коридор вокруг линии), расстояния точка↔линия и длины линии как функций
  (`ST_Distance`/`ST_Length` на geography), упрощения (`ST_Simplify`), линейной привязки (`ST_LineLocatePoint` —
  прогресс по маршруту), кластеризации (`ST_ClusterDBSCAN`), починки геометрий (`ST_MakeValid` — `2dsphere`
  отвергает невалидную геометрию при вставке), SRID/проекций, топологии. Ограничения: документ ≤ 16 МБ, тяжёлый
  индекс на длинных `LineString`. **Рекомендую:** коридор, длина, прогресс, правдоподобие — чистые функции
  `packages/tracks` в worker (тестируемы фикстурами, уже место для геометрии); в MongoDB — упрощённая геометрия
  маршрута и точки старта с `2dsphere` для «рядом»/bbox; сырые точки трека — файл в S3 (как в архитектуре). Новая
  гео-библиотека (turf и т. п.) — отдельным решением задачи треков. Q3.
- **R12. Побочные эффекты в колбэке транзакции:** правило «внутри — только операции с `session`»; исключение —
  `takeResendAllowance` регистрации (§8, безвредно: ключ по новому `userId`), с комментарием и тестом повтора.
- **R13. LOW ревью переименования.** (1) runbook «Откат»: развёртывание прошлого тега тянет образы из GHCR — через
  workflow токеном `GITHUB_TOKEN` автоматически, вручную по SSH — `GHCR_USER` + `GHCR_TOKEN_STDIN=1` (токен
  `read:packages`), если пакет закрыт (сейчас `pokatim-*` и `on-bike-*` — public; формулировку сверить с текстом
  находки PR #19); (2) уборка пакетов `on-bike-{api,web,admin}` — команды `gh api -X DELETE
  /user/packages/container/on-bike-…` (нужен scope `delete:packages`), выполняет человек (Q6); (3) удалить из
  `deploy.sh`/`bootstrap.sh` всё про переезд on-bike → pokatim (§3), раздел runbook «Переезд on-bike → pokatim»
  свести к ручной уборке остатков (тома `on-bike-dev_*`, `~/on-bike`) — лог `sha-64bf48d` подтверждает выполненный
  переезд. Новый шаг `retire_postgres` сам станет legacy — follow-up удалить после первого успешного деплоя.
- **Конфликтов с инвариантами §4 нет:** серверный авторитет и контракты не затронуты (§4.1–4.2); outbox — в той же
  транзакции (§4.5); миграции — отдельный шаг, не при старте (`createIndex` в коде запрещён, §4.6); деструктивное —
  только человек (тома, пакеты GHCR, §4.6/§7); секреты — генерируются на сервере (§4.8); нового внешнего сервиса нет
  (MongoDB заменяет PostgreSQL, ADR-0007, §4.9); append-only — правило D8 (§4.10).
- **Недоопределённость:** аутентификация Mongo на сервере, TTL-уборка, геостратегия, бэкап, откат, уборка GHCR — Q1–Q8.

### Вопросы автору (human gate)

| # | Вопрос | Рекомендация (по умолчанию) |
|---|---|---|
| Q1 | Аутентификация MongoDB на общем dev-сервере | **(в) auth + keyfile RS: root-пользователь (только healthcheck/администрирование) и пользователь приложения `pokatim` с `readWrite` на БД `pokatim`; пароли и keyfile — `@secret`/генерация в bootstrap, значения не выводятся.** (а) Без auth, только сеть compose — как Redis сейчас, но контейнерные IP доступны любому процессу хоста, а в БД — e-mail и хеши паролей (PostgreSQL был под паролем). (б) Только root-пользователь для приложения — проще, но у API права администратора БД |
| Q2 | TTL-уборка истёкших данных identity | **Да, через 30 дней после `expiresAt`:** `sessions` (вкл. отозванные — `revokedReason` живёт ≥ 30 дней после истечения), ссылки подтверждения и сброса (после уборки ссылка → 404 «больше не действует» вместо «устарела»), токены регистрации. Альтернативы: 90 дней (дольше аудит); без TTL (как сейчас — данные копятся, follow-up «очистка» остаётся) |
| Q3 | Геостратегия без PostGIS | **Принять R11:** коридор/длина/прогресс — TS в worker (`packages/tracks`), MongoDB `2dsphere` — «рядом» и bbox по упрощённой геометрии. Альтернатива — вернуть PostGIS отдельной БД только для гео (две БД на одну VPS) — против решения «всё на Mongo» |
| Q4 | Бэкап MongoDB dev-стенда | **Сейчас — ручной `mongodump --archive --gzip` в runbook** (PostgreSQL-бэкапа тоже не было); ночной дамп в S3 — задача `backup-restore.md` (переписать план с PostgreSQL на MongoDB) |
| Q5 | Откат через границу БД и судьба `pgdata` | **Откат через `image_tag` на теги до задачи невозможен — принять; ручной возврат по runbook; том `pokatim-dev_pgdata` и `POSTGRES_PASSWORD` в `.env` держим до вашего «удаляем» (≈ неделя работы стенда на Mongo)** |
| Q6 | Пакеты GHCR `on-bike-{api,web,admin}` (public, 26 версий) | **Удалить вручную** командами из runbook после merge этой задачи (деплой их не использует с `sha-64bf48d`). Альтернатива — оставить архивом (public-образы старого имени) |
| Q7 | Удаление legacy-шагов переезда on-bike → pokatim из скриптов в этой задаче | **Да** (переезд выполнен, лог `sha-64bf48d`); ручная уборка `on-bike-dev_*` томов и `~/on-bike` — остаётся в runbook до вашего «удаляем» |
| Q8 | Образ MongoDB | **`mongo:8.0`, закреплённый по digest** в деплое (dev/CI — тег, как в шаблоне). Альтернатива — 8.2/8.3 (короче поддержка, расходится с шаблоном) |

# 8.2 Deviations from spec

**Ответы на вопросы (2026-10-26):**

- **Q1 (автор)** — auth + keyfile RS на dev: root-пользователь — только healthcheck/администрирование; приложению —
  пользователь `pokatim` с `readWrite` на свою БД. Пароли и keyfile генерирует bootstrap на сервере, в лог не выводятся.
- **Q2 (автор)** — TTL-уборка через 30 дней после `expiresAt` (`0003_identity_ttl`).
- **Q3 (автор)** — геостратегия R11: `2dsphere` в MongoDB + расчёты в TS (`packages/tracks`).
- **Q4 (оркестратор)** — ручной `mongodump` в runbook; ночной бэкап — follow-up (`backup-restore.md`).
- **Q5 (автор) — ОТКЛОНЕНИЕ от §2/§4/§7/AC8.** Откат через `image_tag` невозможен — принято. Том `pgdata` **удаляется
  деплоем** после успешного переезда: когда новый Mongo-стек healthy и smoke зелёный, деплой останавливает и удаляет
  контейнер `postgres` стека и том `pokatim-dev_pgdata` (только свой, по точному имени; идемпотентно) и убирает из
  `.env` ключи только PostgreSQL (`POSTGRES_*`, `DATABASE_URL`). Следствия: ручной возврат на PostgreSQL в runbook —
  только «старые compose + пустая БД»; AC8 — «контейнер и том `pgdata` удалены после healthy + smoke, ключи PG из
  `.env` убраны»; out of scope §4 про удаление тома руками больше не действует.
- **Q6 (оркестратор)** — пакеты GHCR `on-bike-*` удаляет человек командами из runbook.
- **Q7 (оркестратор)** — legacy-шаги переезда on-bike → pokatim удаляются из скриптов сейчас (каталог `~/on-bike` на
  сервере уже удалён, старых томов нет).
- **Q8 (оркестратор)** — `mongo:8.0`, закреплённый по digest в деплое (dev/CI — тег, как в шаблоне).
- Прототип auth + keyfile + RS в `mongo:8.0` — первым шагом S3 (запасной путь — localhost exception); результат —
  ниже.

**Отклонения при реализации (coder, 2026-10-25):**

- **Прототип Q1 — запасной путь (localhost exception), без `MONGO_INITDB_ROOT_*`.** Docker Desktop на машине
  разработки упал (диск хоста заполнен, VM не поднимается) — прототип в контейнере `mongo:8.0` не выполнен.
  Прототип — нативный `mongod 8.2.7` (`--replSet rs0 --keyFile`, пустая БД) и `infra/deploy/mongo-init.js`:
  1-й прогон — `rs.initiate`, root через localhost exception, пользователь `pokatim` (`readWrite` на `pokatim`);
  2-й — «обновлён» (идемпотентно); смена `MONGO_PASSWORD` — пароль обновлён; неверный root-пароль — код 1 без
  значений; `pokatim` пишет в свою БД, в `admin` — `Unauthorized`; `hello` без входа отвечает (healthcheck).
  Поведение entrypoint образа (обёртка копирует keyfile в том `mongoconfig` с владельцем `mongodb`, 400) —
  **NOT VERIFIED** (Docker).
- **Healthcheck — `hello` без входа** (PRIMARY), root не нужен: root — только администрирование (`mongo-init.js`,
  ручной доступ). Пароли в `mongo-init.js` — из env процесса `mongosh` (`exec -e ИМЯ` без значения), вывод — в
  `~/pokatim/mongo-init.log`.
- **Новый файл стека `infra/deploy/mongo-init.js`** (+ в список `scp` `deploy-dev.yml`): набор rs0 и пользователи
  создаёт деплой до `compose up --wait` (healthcheck ждёт PRIMARY, а PRIMARY — после `rs.initiate`).
- **Порядок Q5 в `deploy.sh`:** основной `compose up` api/worker/web/admin — без `--remove-orphans` (иначе контейнер
  `postgres` снялся бы до smoke); после зелёного smoke — `retire_postgres` (контейнер, том `pokatim-dev_pgdata` с
  проверкой label проекта, ключи `POSTGRES_*`/`DATABASE_URL` в `.env`), затем `compose up --remove-orphans`.
- **`consumeRegistrationToken(session, tokenHash, now)`** — подтверждённость e-mail проверяет `poll` по документу
  `lockUser` той же транзакции (§7), репозиторий — только условный обмен; прежний тест «не обменивает до
  подтверждения» на уровне репозитория заменён: pending до подтверждения — `poll.int.test.ts`, после истечения —
  репозиторий.
- **Методы репозитория вне транзакции** (`findRegistrationByHash`, `findCredentialsByEmail`, `rotateSession`,
  `markReuseDetected`, `revokeSession`, `claimLinkSend`, `completeLinkSend`, `releaseLinkSend`,
  `findPasswordResetById`, `deleteUnverifiedBatch`) — без параметра `session`; чтения, нужные и в транзакции, —
  `(…, session?)` последним параметром; транзакционные — `session` первым.
- **Тестовая инфраструктура проверок агента** — нативные `mongod 8.2.7` (RS, `127.0.0.1:27118`), `redis-server`
  (`:6391`), `mailpit` (`:1025/:8025`) вместо контейнеров (Docker недоступен); CI — `mongo:8.0` (шаг рендера).
- **Отрицательное доказательство для `lockUser` в confirm сброса:** без `lockUser` «два confirm» остаётся
  зелёным — транзакции всё равно конфликтуют на записи `passwordHash` и документа ссылки. Ключевое доказательство
  R1 — `lockUserCredentials` без `$inc` во входе (§12).
- Lockfile: `pg`/`drizzle-orm`/`@types/pg` оставались разрешёнными необязательными peer `bullmq`/`api-kit` из
  прежнего lockfile; удалены точечно (снимки и суффиксы peer), без пересборки остальных версий (`pnpm install
  --frozen-lockfile` — ок).

**Ревью pass 1 (PR #20; findings — у оркестратора, `findings.md`):** Codex — REQUEST CHANGES (HIGH AC7/AC8, MEDIUM память), Claude — APPROVE
(3 MEDIUM, 2 LOW). Решение оркестратора: AC7/AC8 — CI-job `deploy-rehearsal` (`infra/deploy/rehearsal.sh`) на PR вместо
локальной репетиции (Docker недоступен); лимиты стека — 2560m (mongo 640m, worker 384m), healthcheck mongo раз в 15 с;
исключения R1 (новый аккаунт, запись первой операцией в тот же документ `users`); тест «ротация ↔ выход» — воротами;
runbook — репетиция только в своём `POKATIM_PROJECT`.

# 8.3 Security checklist

Затронуты: хранилище учётных данных и сессий (identity), гарантии гонок аутентификации, инфраструктура (compose,
деплой, CI), секреты (`MONGO_URL`, пароли и keyfile MongoDB), зависимости (`mongodb`) — `security.md`,
`pokatim-security.md`.

1. **AuthN/AuthZ.** API и контракты не меняются. Гарантии слайсов 1–3 сохраняются и тестируются на реальном RS:
   обмен токена регистрации ровно один раз; ротация — ровно две из параллельных, reuse detection с отзывом; отозванная
   сессия не ротируется (в т. ч. сброс «в процессе» ↔ ротация и ротация между снимком сброса и отзывом); R4 в обоих
   порядках; R5 (poll ↔ сброс); два confirm сброса — один 200; очистка не удаляет только что подтверждённый аккаунт.
   Сериализация аккаунта — R1 (правило и ревью). Доступ к MongoDB: без портов хоста, auth по Q1, пользователь
   приложения — `readWrite` только на свою БД.
2. **Входные данные.** Фильтры и обновления — только из примитивов после zod (`OpaqueToken`, `Email`, `Uuid`, хеши
   sha256 hex); тест: тело `{ refreshToken: { $ne: null } }`, `{ token: { $gt: '' } }` → 400 до БД; значения в
   pipeline-обновлении — через `$literal` (R3); `$where`/`$function`/`$accumulator` — нет. `MONGO_URL` валидируется на
   старте (имя БД обязательно).
3. **Данные наружу.** Ответы не меняются; `isDuplicateKey` не читает `keyValue` (e-mail); `ApiExceptionFilter`
   логирует код ошибки драйвера без `errmsg`; health — `up/down`; `db:migrate` выводит ошибку без `message`
   (`describeMigrateError` шаблона), вывод миграций на сервере — в файл, в лог Actions — только код.
4. **Злоупотребления.** Лимиты (Redis) без изменений; конфликт транзакций одного аккаунта не даёт обхода лимитов
   (лимиты — до БД). TTL не участвует в проверке сроков (Q2).
5. **Секреты и логи.** Пароли MongoDB и keyfile генерируются на сервере (`openssl rand`), `.env`/keyfile — 600 (keyfile
   в контейнере — владелец `mongodb`, 400), в репозитории и логе Actions значений нет; `MONGO_URL` с паролем не
   печатается (env-валидатор и мигратор — без значения; тест шаблона); `.env.example` — без учётных данных; CI — без
   auth на `127.0.0.1`.
6. **Аудит.** `revokedReason`, `usedAt`, `createdAt` ссылок, `user_consents` (append-only, без update/delete в коде,
   кроме каскада очистки неподтверждённых — R4) — сохранены; срок хранения — Q2.
7. **Зависимости и образы.** `mongodb@^7.7.0` (официальный, каталог шаблона), его необязательные peer не ставятся;
   `pg`/`drizzle-*` уходят из lockfile (AC3); образ `mongo:8.0` по digest (Q8); CI — без сторонних actions для Mongo.

# 9. Acceptance Criteria

1. `pnpm infra:up` (MongoDB RS PRIMARY, Redis, Mailpit) → `pnpm --filter @pokatim/api db:migrate` — «миграции
   применены: 0001_outbox, 0002_identity, 0003_identity_ttl», повтор — «новых миграций нет» → `pnpm check` — EXIT 0.
2. API на MongoDB: `/v1/health` — `checks.database: up`; worker стартует; регистрация → письмо (Mailpit) →
   подтверждение → вход → refresh → выход → сброс пароля работают как до задачи (e2e AC6).
3. `pnpm-lock.yaml` без `pg`, `drizzle-orm`, `drizzle-kit`, `@types/pg`; `apps/api` без `drizzle/`, `drizzle.config.ts`,
   `src/db/schema.ts`, `test/db.ts`; импорты только `@rkarakulov/api-kit/{core,mongo}`, `@rkarakulov/test-kit/{core,mongo}`
   (ESLint); `git grep -i -E 'drizzle|postgis|postgres|pg_|FOR UPDATE'` — только журнал `docs/tasks/*`, ADR-история и
   оправданные остатки (runbook отката, `retire_postgres`) — список в §12.
4. Все прежние int-тесты identity перенесены и зелёные на реальном RS без ослабления ожиданий (количество тестов не
   меньше, чем было: api 176 на `64bf48d`); новые тесты гонок R9 — зелёные; отрицательные доказательства (R2/R4 входа,
   `lockUser` в confirm, перепроверка в очистке, `revokedAt: null` в ротации) — тест краснеет без механизма (§12).
5. Индексы после миграций: имена, `unique`, `partialFilterExpression`, `expireAfterSeconds` — проверены тестом;
   вторая активная ссылка у пользователя → дубликат ключа; дубликат e-mail → `EMAIL_TAKEN`.
6. CI: `check` и `web` (с `E2E_API=1`) — зелёные на MongoDB RS; `api dist loads`; `actionlint` — без замечаний.
7. Образ api: `node dist/db/migrate.js` в контейнере применяет миграции; `drizzle-kit` в образе нет.
8. Деплой, локальная репетиция (временный HOME, `POKATIM_SKIP_PULL/SKIP_NGINX`, свои порты): стек `pokatim-dev` из
   `origin/develop` (postgres) → новый `deploy.sh`: контейнер `postgres` удалён, том `…_pgdata` на месте (данные в
   нём), `mongo` healthy (PRIMARY, auth по Q1), пользователь приложения создан, миграции применены, smoke зелёный;
   повторный деплой — без шагов переезда, миграции «новых нет». `shellcheck -x` — 0.
9. Скрипты деплоя без legacy-шагов on-bike → pokatim; runbook — откат (логин GHCR), уборка пакетов `on-bike-*`,
   переезд на MongoDB, бэкап `mongodump`, ручной возврат на PostgreSQL.
10. `uvx copier@9.19.1 update --vcs-ref v0.4.1 --defaults` в копии ветки — дифф только ожидаемый (как AC7
    переименования: 5 PNG иконок), без `*.rej`; `diff -r` template-файлов с mongo-рендером — только project-дельты
    (список в §12). `.copier-answers.yml` — `database: mongo`, без `use_postgis`.
11. Документы §10 обновлены; ADR-0007 принят; ссылки живые.

# 10. Documentation Impact

- **ADR-0007** «MongoDB вместо PostgreSQL + PostGIS» (решение автора; replica set; сериализация аккаунта `$inc
  version` (R1); ротация pipeline (R3); потеря CHECK/FK и каскад (R4, R5); геостратегия (R11, Q3); TTL (Q2); откат
  через границу БД) + строка в `docs/adr/README.md`.
- **ADR-0001** — статус «частично заменён 0003 (гостевой веб) и 0007 (данные)», пункт «Данные» → ссылка на 0007.
- **ADR-0002, 0005, 0006** — строка «Пересмотр 2026-10-26: реализация на MongoDB — ADR-0007 (`FOR UPDATE` →
  `$inc version` в транзакции, `UPDATE … RETURNING` → `findOneAndUpdate`); гарантии прежние».
- `AGENTS.md` — дельта рендера (§2 входы пакетов, §3 `infra:up`/`db:migrate`, без `db:generate`, §4.5, §8
  `db.md`), §1/§2 без PostGIS; `CLAUDE.md` — «драйвер MongoDB» вместо Drizzle; `README.md` — `infra:up`, без
  PostGIS-образа.
- `.claude/rules/db.md`, `backend.md` — из mongo-рендера; `tools/ai_review/review_contract.md` — строка операторной
  инъекции (рендер) + project: «запись в документы аккаунта в транзакции без `lockUser` — HIGH».
- `.claude/rules/pokatim-db.md` — `paths:` (`apps/api/src/db/**`, `**/*.collection.ts`, `**/*.repository.ts`);
  сериализация аккаунта (R1), атомарные одно-документные операции вне транзакций, `$literal` в pipeline, явные `null`,
  каскад — явный (R4); геометрия — GeoJSON + `2dsphere` миграциями, вычисления — `packages/tracks` (R11); без
  `0000_enable_postgis`.
- `.claude/rules/pokatim-backend.md` — геометрия (R11), гео-запросы — int-тесты на реальном MongoDB.
- `.claude/rules/pokatim-tests.md` — гонки: ворота и удерживаемая транзакция (R9), отрицательное доказательство;
  гео — реальный MongoDB.
- `.claude/rules/pokatim-security.md` — «удаление аккаунта отзывает все сессии в той же транзакции» (R3); вход
  сверяет хеш под `lockUser` (формулировка без `FOR UPDATE`).
- `docs/architecture/README.md` — контейнеры (MongoDB RS), сериализация аккаунта, ротация, TTL.
- `docs/proposal-stack-architecture.md` — пометка вверху: «БД заменена — ADR-0007» (документ исторический).
- `docs/runbooks/local-dev.md` — по рендеру (MongoDB RS, `MONGO_URL`, `MONGO_URL_TEST`, `directConnection`), раздел
  «Переезд на MongoDB» (`docker compose -f infra/docker-compose.dev.yml up -d --wait --remove-orphans`, том
  `pokatim-dev_pgdata` — удалить, когда не нужен), «Переезд on-bike → pokatim» — убрать; откат — тома `mongodata`.
- `docs/runbooks/deploy.md` — схема (mongo), миграции, «Переезд на MongoDB» (что делает `retire_postgres`, ручная
  уборка `pgdata` с согласия, ручной возврат на PostgreSQL), «Откат» (граница БД, логин GHCR — R13.1), «Уборка GHCR»
  (`on-bike-*`, R13.2), бэкап `mongodump`/`mongorestore` (Q4), доступ к БД `dc exec mongo mongosh …`; раздел
  «Переезд on-bike → pokatim» — только ручная уборка остатков.
- `docs/runbooks/README.md` — `backup-restore.md`: «ночной дамп MongoDB в S3».
- `docs/tasks/2026-10-22-app-foundation/design.md` (если есть строка F7) — «pokatim перешёл на mongo» — по месту.

# 11. Implementation Context

Уровень — task3 (БД, миграции, безопасность сессий, инфраструктура, CI). Слайсы — по коммиту, проверка после
каждого обязательна. Перед кодом: `pnpm install`, рендер шаблона (§6) в scratch, context7 — драйвер MongoDB Node 7.x
(`withTransaction`, `findOneAndUpdate` с pipeline, write conflicts in-progress транзакций и записей вне транзакций),
MongoDB 8.0 (partial/TTL индексы, `$literal`), образ `mongo` (entrypoint, `--keyFile`, `MONGO_INITDB_ROOT_*`). Q1–Q8 —
по ответу автора (по умолчанию — рекомендации §8.1).

### ENTRY POINTS
- `apps/api/src/{app.module,worker.module}.ts`, `src/db/{index,migrate}.ts`, `src/db/migrations/index.ts`.
- `apps/api/src/modules/identity/identity.repository.ts` (+ `identity.collection.ts`), сервисы identity.
- `apps/api/test/{harness,global-setup,test-env,identity}.ts`.
- `infra/deploy/deploy.sh`, `infra/deploy/docker-compose.yml`, `.github/workflows/ci.yml`.

### Слайсы и проверка после каждого
| # | Что | Проверка |
|---|---|---|
| **S1** | Каркас по дельте рендера + зависимости/lockfile + `.copier-answers.yml` + compose dev; identity: `identity.collection.ts`, миграция `0002_identity`, репозиторий и сервисы/worker на `MongoTransactions`/`MongoOutbox*`; перенос **всех** существующих тестов (unit, int, стенд) с переписанными тестами гонок слайса 3 и очистки (R9) | `pnpm infra:up`; `db:migrate` ×2; `pnpm --filter @pokatim/api test` (unit + int на `pokatim_test` RS, Redis db 1); `pnpm check`; число тестов ≥ прежнего; отрицательные доказательства R4/очистки |
| **S2** (после S1, параллельно S3) | Новые гарантии и тесты: `0003_identity_ttl` (Q2), тест индексов (AC5), гонки — сброс «в процессе» ↔ вход, сброс ↔ ротация в обоих порядках, ротация ↔ выход, регистрация одного адреса (WriteConflict/11000), повтор колбэка регистрации (R12), операторная инъекция → 400, `$literal`; комментарии R1/R3/R6 в репозитории | `pnpm --filter @pokatim/api test`; отрицательные доказательства (§12); `pnpm check` |
| **S3** (после S1, параллельно S2) | CI (`check`, `web` — RS-шаг, env), Dockerfile (миграции `dist/db/migrate.js`), `infra/deploy/*` (mongo RS + auth по Q1, `retire_postgres`, пользователь приложения, `migrate`, smoke), `deploy-dev.yml` (список файлов), удаление legacy on-bike → pokatim (R13.3), `docker-compose.prod.yml`/`infra/.env.example`, `e2e/web.spec.ts` (текст) | прототип auth+RS образа до правок; `docker build --target api` + `node dist/db/migrate.js`; репетиция деплоя AC8 (два прогона); `shellcheck -x deploy.sh bootstrap.sh`; `actionlint`; `pnpm build:web && E2E_API=1 pnpm --filter @pokatim/app e2e:web` (локальный RS); `pnpm check` |
| **S4** | Документы и правила §10 (ADR-0007, rules, runbooks с LOW 1–2), проверка копией `copier update` и `diff -r` с рендером (AC10), `git grep` остатков (AC3) | `pnpm check`; AC10, AC3 — вывод в §12; ссылки в docs живые |

Параллель S2/S3: S2 — только `apps/api/src/**`, `apps/api/test/**`; S3 — `infra/**`, `.github/**`, `apps/app/e2e/**`.
`package.json`/lockfile/`pnpm-workspace.yaml` — только S1.

### FILES TO MODIFY
| Файл | Слайс | Изменение |
|---|---|---|
| `.copier-answers.yml` | S1 | `database: mongo`, удалить `use_postgis` |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | S1 | каталог: `mongodb: ^7.7.0` вместо `drizzle-*`, `pg`, `@types/pg`; `packageExtensions` — как mongo-рендер (`pg`, `drizzle-orm` optional) |
| `package.json` (корень) | S1 | `infra:up` — `--wait` |
| `turbo.json`, `eslint.config.mjs`, `.prettierignore` | S1 | из рендера (`MONGO_URL_TEST`; запрет корней; без `drizzle/meta`, ignores без `apps/api/drizzle/**`) |
| `infra/docker-compose.dev.yml` | S1 | сервис `mongo` (рендер) вместо `postgres`; том `mongodata` |
| `apps/api/package.json` | S1 | deps `mongodb`; без `pg`, `drizzle-orm`, `drizzle-kit`, `@types/pg`; devDeps `tsx`; scripts `db:migrate` = `tsx src/db/migrate.ts`, без `db:generate`/`db:studio` |
| `apps/api/{.env.example,tsconfig.json,vitest.config.mts}` | S1 | рендер (`MONGO_URL`; без `drizzle.config.ts`; комментарий) |
| `apps/api/drizzle/**`, `drizzle.config.ts`, `src/db/schema.ts`, `test/db.ts` | S1 | удалить |
| `apps/api/src/config/env.ts` (+ test) | S1 | рендер + переменные проекта; тест `MONGO_URL` (обязателен, без имени БД — ошибка, multi-host, значение не в сообщении) |
| `apps/api/src/db/{index,migrate,migrate-error(.test)}.ts`, `src/db/migrations/{index,0001_outbox}.ts` | S1 | рендер |
| `apps/api/src/db/migrations/0002_identity.ts` | S1 | коллекции и индексы §7 |
| `apps/api/src/db/migrations/0003_identity_ttl.ts` | S2 | TTL (Q2) |
| `apps/api/src/{app.module,worker.module,main,http-app(.test),error-messages(.test)}.ts` | S1 | импорты `/core`/`/mongo`, `MongoModule`, `MongoOutboxModule`, `MongoOutboxPublisherModule.forRoot({ routes: { ...identityOutboxRoutes } })`; модули проекта — как были |
| `apps/api/src/modules/health/{health.service,health.controller.test}.ts` | S1 | рендер |
| `apps/api/src/modules/identity/identity.schema.ts` → `identity.collection.ts` | S1 | коллекции, документы, `SESSION_REVOKED_REASONS`, `identityCollections(db)` |
| `apps/api/src/modules/identity/identity.repository.ts` | S1 (S2 — комментарии/доп. методы) | §7, R1, R3, R4, R6; `MONGO_DB`; `session?: DbSession`; без `nextId`, `db`-поля для сервисов |
| `apps/api/src/modules/identity/{registration,verification,sign-in,password-reset,session}.service.ts` | S1 | `MongoTransactions.run`, `uuidv7()`, `MongoOutboxWriter`, `isDuplicateKey`, `/core`-импорты; poll — условие подтверждения из `lockUser` |
| `apps/api/src/modules/identity/jobs/{link-email.handler,password-changed-email.handler,cleanup-unverified.processor,identity-email.processor}.ts` | S1 | `MongoOutboxReader`, `/core`-импорты, очистка — R4 |
| `apps/api/src/modules/identity/identity.module.ts` | S1 | провайдеры — без изменений смысла (`MongoTransactions`, `MONGO_DB` — глобальный `MongoModule` базы экспортирует) |
| `apps/api/src/modules/identity/*.int.test.ts`, `jobs/*.int.test.ts`, `identity.repository.int.test.ts` | S1, S2 | перенос на `identityCollections(h.db)`; гонки — R9 |
| `apps/api/test/{global-setup,harness,harness.int.test,test-env,identity}.ts` | S1 | рендер + project (регистрация в тесте стенда, без PostGIS); помощники гонок R9 в `identity.ts` |
| `apps/api/src/modules/tracks/track-processing.processor.ts`, `packages/tracks/src/geo.ts` | S1 | комментарии без PostGIS (R11) |
| `.github/workflows/ci.yml` | S3 | `check`, `web`: RS-шаг рендера, `MONGO_URL_TEST`/`MONGO_URL`, без service `postgres`, комментарий `api dist loads` |
| `infra/docker/Dockerfile` | S3 | без `drizzle-kit`/`drizzle`/`drizzle.config.ts`; комментарии миграций |
| `infra/deploy/docker-compose.yml` | S3 | `mongo` (RS, auth Q1, healthcheck, тома, лимиты, digest), `migrate` — `node dist/db/migrate.js`, `MONGO_URL` в `x-api-env`, `depends_on: mongo`, без `postgres`/`pgdata` |
| `infra/deploy/deploy.sh` | S3 | `retire_postgres`, `mongo` вместо `postgres` в первом `up`, пользователь приложения (Q1), без legacy on-bike; шапка-комментарий |
| `infra/deploy/bootstrap.sh`, `env.template` | S3 | секреты Mongo (`MONGO_ROOT_PASSWORD`, `MONGO_PASSWORD` — `@secret`), keyfile (Q1); без `POSTGRES_PASSWORD` в шаблоне (в `.env` сервера остаётся), без legacy (vhost on-bike, `LEGACY_MAIL_FROM`, `ON_BIKE_TAG`) |
| `.github/workflows/deploy-dev.yml` | S3 | список копируемых файлов (если появится init-скрипт) |
| `infra/docker-compose.prod.yml`, `infra/.env.example` | S3 | MongoDB RS вместо PostgreSQL (заготовка) |
| `apps/app/e2e/web.spec.ts` | S3 | текст пропуска: MongoDB |
| docs, rules, `AGENTS.md`, `CLAUDE.md`, `README.md`, `tools/ai_review/review_contract.md` | S4 | §10 |

### FILES TO READ
`AGENTS.md` §4–§7; `.claude/rules/{db,pokatim-db,backend,pokatim-backend,security,pokatim-security,tests,
pokatim-tests}.md`; ADR-0002, 0005, 0006; `docs/tasks/2026-10-24-app-foundation-mongo/task.md` (§8.1 F4–F10, D4–D8,
§8.2); `docs/tasks/2026-10-25-onboarding-03-password-reset/task.md` (§7 «Гонки», R4, R5, §8.2 ревью pass 1–2);
`docs/tasks/2026-10-25-rename-pokatim/task.md` (переезд стенда, AC6 — образец репетиции); рендер `v0.4.1 mongo`;
исходники `node_modules/@rkarakulov/api-kit/dist/mongo/*`, `test-kit/dist/mongo/*` после `pnpm install`;
`apps/api/src/modules/identity/**` и тесты целиком.

### TYPES & SCHEMAS
```ts
// apps/api/src/modules/identity/identity.collection.ts
export interface UserDoc { _id: string; email: string; passwordHash: string; birthDate: string;
  emailVerifiedAt: Date | null; createdAt: Date; deletedAt: Date | null; version: number }
export interface UserConsentDoc { _id: string; userId: string; kind: 'personal_data' | 'agreement';
  version: string; acceptedAt: Date }
export interface LinkTokenDoc { _id: string; userId: string; tokenHash: string; createdAt: Date; expiresAt: Date;
  usedAt: Date | null; supersededAt: Date | null; sentAt: Date | null; sendClaimedAt: Date | null }
export interface RegistrationTokenDoc { _id: string; userId: string; tokenHash: string; createdAt: Date;
  expiresAt: Date; consumedAt: Date | null }
export const SESSION_REVOKED_REASONS = ['signed_out', 'reuse_detected', 'superseded', 'password_reset'] as const;
export interface SessionDoc { _id: string; userId: string; refreshTokenHash: string;
  previousRefreshTokenHash: string | null; rotatedAt: Date | null; createdAt: Date; expiresAt: Date;
  revokedAt: Date | null; revokedReason: SessionRevokedReason | null }
export const IDENTITY_COLLECTIONS = { users: 'users', userConsents: 'user_consents',
  emailVerificationTokens: 'email_verification_tokens', passwordResetTokens: 'password_reset_tokens',
  registrationTokens: 'registration_tokens', sessions: 'sessions' } as const;
export function identityCollections(db: Db): { users: Collection<UserDoc>; /* … */ };

// identity.repository.ts — сигнатуры (State-типы прежние)
lockUser(session: DbSession, userId: string): Promise<UserState | undefined>;            // $inc version, первая операция
lockUserCredentials(session: DbSession, userId: string): Promise<(UserState & { passwordHash: string }) | undefined>;
rotateSession(rotation: { tokenHash; nextTokenHash; now; graceMs; ttlMs; absoluteTtlMs }):
  Promise<{ id: string; userId: string; expiresAt: Date } | undefined>;                  // вне транзакции, pipeline + $literal
revokeAllSessions(session: DbSession, userId: string, at: Date, reason: SessionRevokedReason): Promise<number>;
consumeRegistrationToken(session: DbSession, tokenHash: string, now: Date): Promise<string | undefined>;
deleteUnverifiedBatch(createdBefore: Date, limit: number): Promise<number>;              // транзакция на аккаунт, каскад
// прочие методы — прежние имена; первый параметр DbExecutor → `session?: DbSession` (в транзакции — обязателен)
```
Контракты (`packages/contracts`), `api-client`, `HealthResponse`, `OutboxJobData`, события outbox — без изменений.
`MONGO_URL` dev — `mongodb://127.0.0.1:27017/pokatim?directConnection=true`; тест — `…/pokatim_test?…`; сервер —
`mongodb://pokatim:${MONGO_PASSWORD}@mongo:27017/pokatim?replicaSet=rs0&authSource=pokatim` (по Q1; `authSource` —
БД, где создан пользователь).

### TESTS
- **Unit:** env (`MONGO_URL` по рендеру), health (рендер), `migrate-error` (рендер); прежние unit identity (токены,
  письма, cookie, контроллер, `session.service.test`) — без изменений.
- **Int — стенд:** `harness.int.test.ts` по рендеру + регистрация: `reset()` чистит `users`/`outbox`, `_migrations`
  и индексы остаются; индекс `outbox_unpublished_idx` есть.
- **Int — миграции (AC5):** все индексы §7 с опциями; TTL (Q2) — `expireAfterSeconds`; повторный прогон миграций —
  без изменений; вторая активная ссылка — `11000` по имени индекса.
- **Int — перенос (S1):** `registration`, `verification`, `poll`, `sign-in`, `session`, `password-reset`,
  `identity-email.processor`, `cleanup-unverified.processor`, `identity.repository`, `trust-proxy` — те же сценарии и
  ожидания; проверки строк — через `identityCollections(h.db)` (`_id` вместо `id`); «CHECK e-mail в нижнем регистре»
  → «e-mail сохранён нормализованным» (R5); «частичный UNIQUE» → `isDuplicateKey(…, '…_active_unique')`.
- **Int — гонки (R9):** вход ↔ сброс: (а) ворота — сброс завершён между проверкой пароля и `lockUserCredentials` →
  401, сессий нет; (б) удерживаемая транзакция «сброса» (новый хеш, `$inc`) → вход повторяется (spy ≥ 2) → коммит →
  401; poll ↔ сброс (ворота, как слайс 3) → 401; confirm, ждавший, пока ссылка истекла (удерживаемая транзакция
  аккаунта + сдвиг часов) → 410, пароль и сессии прежние; два confirm параллельно → 200 + 410, одно событие «Пароль
  изменён»; сброс ↔ ротация: (а) удерживаемая транзакция сброса отозвала сессии → refresh ждёт/повторяется → 401;
  (б) ворота после `lockUser` сброса → refresh проходит (новый токен) → ворота открыты → сброс повторяется →
  сессия отозвана, новый токен → 401, `revokedReason: password_reset`; 5 refresh одним токеном → ровно два 200;
  выход предыдущим токеном ↔ ротация → сессия отозвана; очистка ↔ подтверждение (удерживаемая транзакция
  подтверждения) → 0 удалённых, аккаунт на месте; очистка удаляет связанные документы всех 5 коллекций (каскад R4);
  регистрация одного адреса ×5 параллельно → один 201, остальные 409 `EMAIL_TAKEN`; повтор колбэка регистрации
  (spy вызывает `WriteConflict`-подобный транзиентный отказ один раз) → 201, ключ лимита по новому id (R12).
- **Int — инъекция:** refresh/confirm/poll с объектами (`{ $ne: null }`, `{ $gt: '' }`) вместо строк → 400
  `VALIDATION_FAILED`, ни одна сессия/ссылка не изменена; GET ссылки с `%24ne` в пути → 404 до БД.
- **Отрицательные доказательства (§12):** убрать сверку хеша во входе → тест (а)/(б) красный; убрать `lockUser`
  из confirm сброса → «два confirm» красный; убрать условие в `findOneAndDelete` очистки → «очистка ↔ подтверждение»
  красный; убрать `revokedAt: null` из фильтра ротации → «сброс ↔ ротация (а)» красный.
- **CI/деплой:** job `check`, `web` (`E2E_API=1`); репетиция AC8; `shellcheck`, `actionlint`.
- **Ручной смоук (человек, NOT VERIFIED если не делался):** после деплоя — регистрация, письмо, вход, сброс пароля на
  `https://<хост>`; `docker volume ls` — `pokatim-dev_pgdata` на месте.

### OUT OF SCOPE
§4. Плюс: перенос данных, удаление `pgdata`/пакетов GHCR (человек), геофункции, автоматический бэкап, изменения
app-foundation (follow-ups: помощник «удерживаемая транзакция» в test-kit, TTL `outbox`, identity F6), удаление шага
`retire_postgres` (follow-up после первого успешного деплоя).

# 12. Outcome

Ответы Q1–Q8 и отклонения — §8.2. Ветка `feature/pokatim-mongo` от `origin/develop` (`64bf48d`).

**Коммиты:** `924b28d` спецификация и Q1–Q8; `892ea99` S1 каркас и identity; `ed75457` S2 TTL и гонки;
`dd6ff32` S3 CI, образ, деплой; `0ea572c` S4 документы и ADR-0007; затем — этот Outcome.

**Проверки** (инфраструктура агента — нативные mongod 8.2.7 RS `:27118`, redis `:6391`, mailpit; Docker недоступен):

| Проверка | Результат |
|---|---|
| `pnpm check` (format, lint, arch, typecheck, test) | EXIT 0; api — 28 файлов, **198 тестов** (было 176 на `64bf48d`), app — 209 |
| `db:migrate` (tsx) ×2 | «миграции применены: 0001_outbox, 0002_identity, 0003_identity_ttl» → «новых миграций нет» |
| `node dist/db/migrate.js` ×2 | то же; `MONGO_URL` без имени БД — код 1, сообщение без значения URL |
| `api dist loads` | ok |
| `pnpm e2e:web` без API | 10 passed, 1 skipped |
| `pnpm build:web` + `E2E_API=1 pnpm e2e:web` (API/worker из dist на MongoDB) | 11 passed (регистрация → письмо → подтверждение → вход → refresh → выход → сброс пароля) |
| `expo export -p android` | ок |
| `shellcheck -x deploy.sh bootstrap.sh` (shellcheck-py) | 0 замечаний |
| `actionlint` (actionlint-py + shellcheck) | 0 замечаний |
| `copier update --vcs-ref v0.4.1 --defaults` в копии ветки (AC10) | дифф — только 5 PNG иконок (как AC7 переименования), `*.rej` нет |
| `diff -r` с рендером `v0.4.1 mongo` | project-дельты прежние (как `develop` ↔ рендер postgres) плюс: `apps/api/src/db/migrations/index.ts` (миграции identity), `tools/ai_review/review_contract.md` (строка R1 — HIGH); размер дельт `ci.yml`, `AGENTS.md`, `harness.int.test.ts`, `web.spec.ts`, `local-dev.md` — в пределах project-частей |
| Ссылки в изменённых документах | живые (проверка относительных ссылок) |

**Отрицательные доказательства** (механизм убран → тест красный по результату, затем возвращён):

| Убрано | Тест | Результат |
|---|---|---|
| сверка хеша под `lockUserCredentials` во входе | вход ↔ сброс «в процессе» (удерживаемая транзакция); вход ↔ сброс (ворота) | `expected 200 to be 401` в обоих |
| `$inc version` в `lockUserCredentials` (простое чтение) | вход ↔ сброс «в процессе» | `expected 200 to be 401` (R1) |
| условия `findOneAndDelete` очистки | очистка ↔ подтверждение «в процессе» | `expected 1 to be +0` (аккаунт удалён) |
| `revokedAt: null` в фильтре ротации | сброс «в процессе» ↔ ротация (а) | `expected 200 to be 401` |
| отзыв ротированной сессии (фильтр `rotatedAt: null` в `revokeAllSessions`) | сброс ↔ ротация (б), ротация между снимком и отзывом | `expected 200 to be 401` |
| `lockUser` в confirm сброса | «два confirm», «confirm ждал, ссылка истекла» | «два confirm» — **зелёный** (сериализует запись `passwordHash`/ссылки), второй — красный по ожиданию spy; см. §8.2 |

**Остатки `git grep -i -E 'drizzle|postgis|postgres|pg_|FOR UPDATE'`** (кроме `docs/tasks/*`): ADR-история
(`docs/adr/0001`–`0003`, `0005`–`0007`, `README.md`), `docs/proposal-stack-architecture.md` (исторический, с пометкой);
рендер шаблона — `.ai/dev-kit` и `.agents/skills` (`backend-nest` про обе БД), `.dependency-cruiser.cjs`
(`drizzle/meta`), `eslint.config.mjs` и `.claude/rules/db.md`, `AGENTS.md` (корни пакетов — PostgreSQL),
`pnpm-workspace.yaml` (`packageExtensions`), `pnpm-lock.yaml` (метаданные peer `api-kit`/`test-kit`; пакетов
`pg`/`drizzle-*` в lockfile нет); `apps/api/src/config/env.test.ts` (рендер: `postgres://` отвергается);
переезд — `infra/deploy/deploy.sh` (`retire_postgres`), `docs/runbooks/{deploy,local-dev}.md`; комментарии
`0002_identity.ts` (имена индексов из PG) и `identity-races.int.test.ts`.

**Фиксы ревью pass 1:** `pnpm check` — EXIT 0, api — **199 тестов** (тест «ротация ↔ выход» разделён на два
детерминированных); отрицательное доказательство нового теста — без `revokedAt: null` в ротации `expected 200 to be
401`; shellcheck `rehearsal.sh`, actionlint — 0 замечаний. Job `deploy-rehearsal` (AC7/AC8 в Docker) — **прогон на
PR**, локально не запускался.

**NOT VERIFIED (Docker Desktop недоступен: диск хоста заполнен, VM не стартует; контейнеры `pokatim-dev-*` /
`on-bike-dev-*` не трогались, Docker не перезапускался):**

- `docker build --target api` и `node dist/db/migrate.js` в контейнере (AC7) — проверено только на хосте из `dist`.
- Репетиция деплоя AC8 (стек `pokatim-dev` из `origin/develop` → новый `deploy.sh`, `retire_postgres`, повторный
  деплой) — проверены только `bash -n`, shellcheck и логика `mongo-init.js` на нативном mongod.
- Поведение entrypoint `mongo:8.0` с обёрткой keyfile; healthcheck `hello` в контейнере.
- Тесты на `mongo:8.0` (локально — mongod 8.2.7; CI запустит `mongo:8.0`), CI GitHub Actions (не запускался — push
  без PR).
- Ручной смоук стенда после деплоя (человек): регистрация, письмо, вход, сброс; `docker volume ls` —
  `pokatim-dev_pgdata` удалён, `pokatim-dev_mongodata` на месте.
