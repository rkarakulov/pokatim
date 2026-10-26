# 1. Title

Результат гонки, слайс 06: споры. Новый модуль `disputes`: подача спора участником против чужого засчитанного
результата (категория обязательна, описание, без вложений — A10), ответ участника, отзыв заявителем; отсечка приёма
за 24 ч до плановой публикации (D-44), решение не раньше 12 ч после подачи (D-25), анонимность заявителя (D-51);
решение «Удовлетворить» = DQ результата (D-43) или «Отклонить» с шаблонной причиной для участников и внутренней
заметкой; история — только вставками (`dispute_events`). Блокировки: D-39 (загрузка и отмена участия при открытом
споре по своему результату), строка чек-листа публикации «открытые споры», D-19 (отмена гонки при открытом споре).
Приложение: карточка соперника с «Оспорить результат», форма, статус спора, ответ. Панель: раздел «Споры».

# 2. Goal

Слайс 06 эпика `docs/tasks/2026-10-27-race-results/epic.md` (§3.5, §3.7, §4, §7). Слайсы 03–05 (`develop` @
`e047921`) дали заявки, попытки, места при чтении, UI участия, протокол с публикацией, DQ и пересчётами после
публикации. Здесь:

- участник с засчитанным результатом оспаривает чужой засчитанный результат своей группы зачёта до отсечки D-44;
  его имя, описание видит только команда платформы; участник, чей результат оспорен, видит только категорию и может
  один раз ответить; заявитель может отозвать спор;
- команда платформы видит список споров, разбирает спор и принимает решение не раньше 12 ч после подачи;
  «Удовлетворить» дисквалифицирует результат (вне зачёта, при публикации строка `dq`), «Отклонить» — без изменений;
  участники видят исход и шаблонную причину, внутренняя заметка — только команде;
- пока спор открыт: участник, чей результат оспорен, не загружает новые заезды и не отменяет участие (D-39),
  протокол не публикуется (чек-лист), гонка не отменяется (D-19).

Клиент присылает только намерение (цель, категорию, текст); право подачи, сроки, анонимность и DQ считает сервер
(`AGENTS.md` §4.1).

Источники: `AGENTS.md` §1, §4; ADR-0010, 0011 (R9), 0012 (Proposed, п. 7–8); эпик §3.4, §3.5, §3.7, §4, §6 (A10,
A11); task.md слайсов 03, 04, 05; `.claude/rules/{pokatim-backend,pokatim-db,pokatim-contracts,pokatim-app,
pokatim-web,pokatim-security,pokatim-tests}.md`; прототипы автора (конфиденциальны — только коды и решения):
«Результат после загрузки» (D-39, D-43, D-44, D-51, M1, C1/H2), «Панель — результаты и спор» (D-19, D-25, D-26,
D-43, D-51). Код сверен по `origin/develop` @ `e047921`.

# 3. Scope

**Contracts / api-client / i18n**
- Новый `packages/contracts/src/disputes/` (`disputes.schema.ts`, `disputes-admin.schema.ts`, экспорт из индекса):
  - `DISPUTE_CATEGORIES` (5, канонический список прототипа `[ASSUMPTION]`): `speed_vs_heart_rate` «Скорость не
    соответствует пульсу», `heart_rate_doubtful` «Данные пульса вызывают сомнение», `vehicle_assistance` «Похоже на
    помощь транспорта», `foreign_track` «Чужой трек или чужой датчик», `other` «Другое»;
  - `DISPUTE_STATUSES`: `open`, `withdrawn`, `upheld`, `rejected`;
  - `DISPUTE_DECISION_TEMPLATES` `[ASSUMPTION copy]` — шаблоны причины для участников по исходу (`upheld`:
    `speed_implausible`, `vehicle_assistance`, `foreign_track`, `rules_violation`; `rejected`: `track_confirmed`,
    `insufficient_evidence`, `not_a_violation`) и карта «исход → допустимые шаблоны»;
  - `DISPUTE_FILE_BLOCKS` (почему подать нельзя — для приложения): `not_entered`, `no_counted_result`,
    `disqualified`, `withdrawn`, `cancelled`, `protocol_published`, `filing_closed`, `not_started` (нет засчитанных
    результатов в гонке ещё нет — не показывается); `DISPUTE_ACTION_BLOCKS` (`409 DISPUTE_ACTION_BLOCKED.details.reason`):
    те же + `target_not_counted`, `own_result`, `already_filed`, `open_limit`, `not_open`, `already_responded`,
    `too_early` (D-25, с `details.availableAt`), `race_cancelled`;
  - запросы `DisputeFileRequest { targetEntryId, category, description? }` (описание 0–2000, без управляющих),
    `DisputeResponseRequest { text }` (3–2000), `DisputeDecisionRequest { outcome: 'upheld' | 'rejected', template,
    note? }` (заметка 0–1000; шаблон — из карты исхода, `superRefine`);
  - ответы приложения: `MyRaceDisputes` (§7.2), `MyDispute`, `DisputeAgainstMe`; панели: `PanelDisputeListItem`,
    `PanelDisputePage`, `PanelDispute` (§7.4);
  - коды ошибок в `common.ts` (в конец): `DISPUTE_ACTION_BLOCKED`, `DISPUTE_NOT_FOUND`.
- `results.schema.ts` (в конец): `RACE_ENTRY_BLOCK_REASONS` + `dispute_open` (D-39).
- `race.schema.ts` (в конец): `RACE_EDIT_BLOCK_REASONS` + `disputes_open` (D-19).
- `permissions.schema.ts`: `PERMISSIONS` + `disputes.read`, `disputes.decide`.
- `audit.schema.ts`: `AUDIT_ACTIONS` + `disputes.decided`; `AuditEntry.details` + `disputeId?`.
- `packages/api-client`: приложение — `getMyRaceDisputes`, `fileDispute`, `withdrawDispute`, `respondToDispute`;
  панель — `listDisputes`, `getDispute`, `decideDispute`.
- `packages/i18n/src/ru.ts`: блок `disputes.*` (приложение) и `admin.disputes.*` (панель), категории, статусы,
  шаблоны, причины блокировок, `races.entry.reason.dispute_open`, `admin.races.reason.disputes_open`, ошибки.

**API — новый модуль `disputes`** (`apps/api/src/modules/disputes`)
- Коллекции `disputes` (текущее состояние, `version`) и `dispute_events` (только `insertOne`); миграция
  `0018_disputes`.
- Подача, отзыв, ответ (приложение, `AuthGuard`), список, разбор и решение (панель, `PanelGuard`); чтения «мои споры
  в гонке».
- Провайдеры портов: `results` — `ResultDisputeGate` (открытые споры по заявке и по гонке, D-39 и чек-лист);
  `races` — `RaceCancelGate` (D-19).
- Outbox: `disputes.dispute-filed`, `-withdrawn`, `-responded`, `-decided` (без маршрута — потребитель
  `notifications` позже, A11); журнал панели `disputes.decided`.

**API — `results`**
- Порт `ResultsForDisputes` (§3.7 эпика, через `modules/results/index.ts`): чтение заявок гонки для права подачи
  (заявитель, цель, группа, засчитанный результат, DQ), замок заявки в транзакции спора, `disqualify` (D-43).
- DQ до публикации: поле заявки `disqualified { at, disputeId } | null`; результат `dq`; строка вне мест и таблицы;
  публикация переносит DQ в снимок (строка `dq`), «Применить пересчёт» — тоже (§7.6).
- D-39: `entryActions` + `dispute_open` (отмена и добавление попытки); сервер — отказ при отмене участия и явной
  попытке; автоматические попытки при открытом споре не создаются (§7.7).
- Чек-лист: `open_disputes` — число открытых споров гонки через `ResultDisputeGate` (сейчас заглушка `0`).

**API — `races`**: D-19 — `editable.reasons` + `disputes_open`, `canCancel: false`; отмена — отказ при открытых
спорах (через `RaceCancelGate` в транзакции отмены).

**API — `panel`**: `ROLE_PERMISSIONS`: admin — всё; moderator + `disputes.read`, `disputes.decide`; organizer —
без новых прав (`[ASSUMPTION]`: споры — работа команды платформы).

**Приложение (`apps/app`)**
- Строки таблицы результатов (кроме своей) — нажимаемые: **карточка соперника** (решение размещения — §8.2 DV-1).
- Карточка соперника: место, «Участник», время, статус; «Оспорить результат» + «Споры принимаются до …» или
  выключенное с причиной «Приём споров закрыт — протокол будет опубликован …» (M1: только тем, кто мог подать);
  уже поданный мной спор по этой строке — статус вместо действия.
- Экран подачи спора: оспариваемый результат, выбор категории (обязательно, без неё «Отправить спор» выключено с
  причиной), описание, строка о сроке и о видимости (D-51), без вложений (A10).
- Блок «Споры» на карточке гонки: мои споры (статус, «Отозвать спор» с подтверждением, исход и шаблонная причина);
  спор по моему результату (категория, срок решения, «Ответить» → экран ответа, исход); причины D-39 у «Загрузить
  заезд» и «Отменить участие».

**Панель (`apps/admin`)**
- Пункт навигации «Споры» (`disputes.read`) → `DisputesScreen` (список с фильтром статуса и гонки) и
  `DisputeScreen` (разбор: гонка, оспоренный результат, заявитель, категория, описание, ответ участника, история;
  решение с исходом, шаблоном и заметкой; кнопка неактивна до `availableAt` с причиной D-25).
- Раздел «Результаты»: строка чек-листа «Открытые споры» — живое число со ссылкой «Открыть споры» на список гонки;
  `RaceEditor` — причина `disputes_open`.

**Docs** — ADR-0012 п. 7–8 (уточнение), эпик §3.5/§7 (слайс 06b), `pokatim-db.md`, `pokatim-backend.md`,
`pokatim-security.md`, `pokatim-app.md`, `pokatim-web.md` (§10).

# 4. Out of Scope

- **Ряды пульса и мощности на разборе спора** (worker `dispute-series`, кэш Redis с TTL, график по дистанции,
  ADR-0011 R9) — **слайс 06b** (§8.2 DV-2): раздувает слайс (worker, кэш, график, безопасность биометрии).
  Разбор в 06 — без биометрии.
- Вложения к спору (A10 — с модулем `media`); уведомления о решении (A11 — модуль `notifications` читает события).
- Имена участников (A12): заявитель и участник в панели — `userId` + отображаемое имя сотрудника нет; райдеры —
  «Участник ·xxxxxx» по `entryId` (как в 05). Карточка соперника — без имени, аватара, тренера.
- Кластеры и Verified (слайс 07): группа зачёта одна (`overall`); START без спора — после 07.
- Споры после публикации протокола (приём закрыт — D-44; после публикации только экстренный пересчёт 05).
- Отмена решения по спору (решение окончательно; после публикации DQ снимает «Отменить DQ» слайса 05).
- Модерация текстов споров по жалобам, редактирование описания и ответа.

# 5. Architecture Context

Architect сверил с кодом `develop` @ `e047921`; решения §8.1 (RC-1…RC-18) внесены сюда.

### Модули и зависимости

```
results  ◄── disputes (ResultsForDisputes: заявки, замок заявки, DQ, место цели)  [новый порт results]
races    ◄── disputes (RaceRegistry.get/lockResults — гонка, фаза, срок)          [существующий порт races]
panel    ◄── disputes (PanelGuard, RequirePermission, CurrentPanelUser, PanelAudit, PanelDirectory)
identity ◄── disputes (AuthGuard, CurrentUser)
results  ──► ResultDisputeGate (интерфейс и токен — results, реализация — disputes) [D-39, чек-лист]
races    ──► RaceCancelGate   (интерфейс и токен — races,   реализация — disputes) [D-19]
```

Циклов импортов нет: `disputes` импортирует `results`, `races`, `panel`, `identity` только через `index.ts`; `results` и
`races` о `disputes` не знают — они объявляют интерфейсы гейтов и токены. Реализация гейтов (`DisputeGates`, зависит
только от `DisputesRepository`) живёт в `@Global()` `DisputesCoreModule`. Его импортируют оба корня композиции:
`AppModule` и `WorkerModule` (приёму попыток в worker нужен D-39, RC-1). Инъекция обязательная, без `@Optional`: если
регистрацию забыли, сервис не стартует, а не выключает D-39 молча. Стенд тестов собирает `AppModule`/`WorkerModule`,
поэтому гейты есть везде; без споров они возвращают 0, и тесты `results`/`races` не меняются.

### Модель

- **Спор** — `disputes { _id, raceId, groupKey, complainantUserId, complainantEntryId, targetEntryId,
  targetUserId, category, description | null, status, response: { text, at } | null, decision: { outcome,
  template, note | null, actorUserId, at } | null, filedAt, closedAt | null, version, createdAt, updatedAt }` —
  проекция текущего состояния. Переходы идут только из `open` (RC-8): `updateOne` с фильтром `status: 'open'` (ответ —
  ещё и `response: null`), в `$set` — только `status`/`response`/`decision`/`closedAt`/`updatedAt`, плюс `$inc version`.
  Удаления и замены нет; содержание подачи (`category`, `description`, участники) не меняется.
- **История** — `dispute_events { _id, disputeId, raceId, kind: filed | responded | withdrawn | decided, actor:
  { kind: rider | staff, userId }, at, payload: { outcome?, template? } }` пишется только через `insertOne` (сторож по
  исходнику). Свободного текста в событии нет: описание, ответ и заметка лежат только в документе спора.
- **Срок приёма** (D-44, RC-7): `filingClosesAt = race.disputeFilingClosedAt ?? race.protocolPlannedAt − 24 ч`
  (`DISPUTE_FILING_LEAD_HOURS = 24` в contracts). Поле `races.disputeFilingClosedAt` фиксирует `RacesService.update`.
  Условие: `protocolPlannedAt` меняется, `now ≥ current.protocolPlannedAt − 24 ч` и поле ещё `null`. Тогда в той же
  записи `updateRace` сохраняется `current.protocolPlannedAt − 24 ч`. Перенос плановой даты позже после отсечки
  (V-11) приём больше не открывает. Приём также закрыт навсегда при опубликованном протоколе и при отменённой гонке.
  `RaceForResults` получает поле `disputeFilingClosedAt: Date | null`.
- **Срок решения** (D-25): `decidableAt = filedAt + 12 ч`. Решение раньше — `409 DISPUTE_ACTION_BLOCKED too_early` с
  `details.availableAt`.
- **Право подачи.**
  - Заявитель — активная заявка гонки с `best`, без DQ.
  - Цель — другая активная заявка той же гонки и группы с `best`, без DQ.
  - Гонка `published` (не `cancelled`), протокол не опубликован, `now < filingClosesAt`.
  - Один спор на пару (заявитель, цель) за гонку: уникальный `(raceId, complainantUserId, targetEntryId)`; повтор после
    отзыва тоже запрещён (`[ASSUMPTION]` R2).
  - Не больше 3 открытых споров заявителя в гонке (`open_limit`, `[ASSUMPTION]`). Все подачи гонки сериализует
    `lockResults`, поэтому write skew лимита невозможен.
- **DQ до публикации** (D-43, RC-2, RC-3). Поле `race_entries.disqualified: { at, disputeId } | null` — проекция
  «DQ по спору до публикации». Читается **только пока `protocolPublishedAt === null`**:
  - `rankedFilter` + `disqualified: null` — таблица, места, `ranked`, KPI и живые «Участники» без DQ;
  - `resultStatus` → `dq` (ветка `ignoreBest` поле не читает);
  - право подачи и цель (`disqualified` / `target_not_counted`);
  - `entryActions` — причина `disqualified` (RC-6).

  Источник «действующих DQ» для протокола — журнал `race_recalculations` (DV-13 слайса 05). `disqualify` пишет туда
  `{ kind: 'disqualified', revision: null, entryId, reason: 'dispute:<disputeId>' }`. Публикация и «Применить
  пересчёт» строят базу из `protocolBaseEntries` (активные с `best`, **включая** DQ) и `disqualifiedEntries`, так что
  DQ-участник получает строку `dq` без места. После публикации поле не читается и не меняется. «Отменить DQ» слайса 05
  работает по журналу: запись `disqualification_revoked` с ревизией идёт после записи `revision: null`. Код
  `toggleDisqualification` не меняется. Отмены DQ до публикации нет (R4).

### Транзакции (`MongoTransactions.run`, snapshot; колбэк без логов/очередей)

| Действие | Транзакция |
|---|---|
| Подать | `RaceRegistry.lockResults(raceId)` (сериализует подачи гонки; конфликт с публикацией, решением, отменой и правкой гонки) → нет/черновик — 404; `cancelled`, `protocol_published`, `filing_closed` → `ResultsForDisputes.entryOf(raceId, userId, tx)` заявителя (без замка, RC-12) → `ResultsForDisputes.lockEntry(tx, targetEntryId, now)` (конфликт с отменой участия, явной попыткой и приёмом цели) → цель (`own_result`, `target_not_counted`, другая гонка — тоже `target_not_counted`) → `countOpenByComplainant` (`open_limit`) → `insertOne disputes` (E11000 пары → `already_filed`, вне транзакции — как `isDuplicateKey` в `ride-reports.service.ts`) → событие `filed` → outbox `disputes.dispute-filed` |
| Отозвать | `withdraw(tx, id, complainantUserId, now)` (`status: 'open'`) → 0 строк → чтение: чужой — 404, иначе `not_open` → событие → outbox |
| Ответить | `respond(tx, id, targetUserId, text, now)` (`status: 'open'`, `response: null`) → 0 → чужой — 404, закрыт — `not_open`, уже есть ответ — `already_responded` → событие → outbox |
| Решить | `lockResults` → 404 / `cancelled` / `protocol_published` → спор в tx (`not_open`; `now < decidableAt` → `too_early` + `availableAt`) → `ResultsForDisputes.lockEntry(target)` → `decide(tx, …)` (`status: 'open'`) → при `upheld` — `ResultsForDisputes.disqualify(tx, …)` (идемпотентно: заявка уже DQ — `false`, без второй записи журнала) → событие `decided` → outbox `disputes.dispute-decided` → `PanelAudit.append` |
| Отменить участие (`EntriesService.withdraw`) | `lockEntryOf` → статус и фаза (как сейчас) → `entry.disqualified` → `409 RACE_WITHDRAW_CLOSED { reason: 'disqualified' }`; `ResultDisputeGate.openAgainst(entry._id, tx) > 0` → `{ reason: 'dispute_open' }` |
| Явная попытка (`AttemptsService.add`, выбор заезда и «загрузить в гонку») | `lockEntryOf` → `attemptClosedReason` (как сейчас) → `disqualified` / gate → `409 ATTEMPT_UPLOAD_CLOSED { reason: 'disqualified' \| 'dispute_open' }` |
| Приём (`AttemptIntake.syncGroup`, worker) | `lockEntry` → gate > 0 и запроса райдера по загрузкам группы нет → выход без изменений: группа заморожена, `not_primary` не снимается (RC-5). Запрос, принятый до подачи, обрабатывается |
| Публикация (results) | `lockResults` → чек-лист в той же транзакции: `open_disputes = ResultDisputeGate.openInRace(raceId, tx)` → база `protocolBaseEntries` + `disqualifiedEntries` (RC-2) |
| «Применить пересчёт» (results) | как в 05, но база — `protocolBaseEntries` вместо `rankedEntries` (RC-2) |
| Отмена гонки (`RacesService.cancel`) | `manageable` → статус/версия → `RaceCancelGate.openDisputes(id, tx) > 0` → `409 RACE_INVALID_STATE { reason: 'disputes_open' }` → `transition` (запись документа гонки — конфликт с `lockResults` подачи, RC-9) |
| Правка гонки (`RacesService.update`) | + `disputeFilingClosedAt` в той же `updateRace` (RC-7); конфликт с `lockResults` подачи |

### Контракты и совместимость

Только добавления.
- Приложение: новые enum — `tolerantEnum`, старые сборки видят `unknown`. `RACE_ENTRY_BLOCK_REASONS + 'dispute_open',
  'disqualified'`: у старых сборок кнопка выключена, причина `unknown` («Действие недоступно»).
- `RACE_WITHDRAW_CLOSED` получает `details.reason` — новая схема `RaceEntryBlockedDetails`, она же описывает уже
  существующий `ATTEMPT_UPLOAD_CLOSED.details`. Старые сборки покажут прежний текст кода (принято, RC-4).
- Панель деплоится вместе с API, enum строгие: `RACE_EDIT_BLOCK_REASONS + 'disputes_open'`, `RaceInvalidStateDetails`.
- Эндпоинты — новые; существующие ответы получают только новые значения enum.

### Миграция `0018_disputes`

Expand-only, идемпотентна, `ensureCollection` × 2 (образец — `0017_ride_reports.ts`). Индексы (RC-11):
- `disputes_pair_unique` — unique `(raceId, complainantUserId, targetEntryId)`; префиксом обслуживает «мои споры» и
  `open_limit`;
- `disputes_target_idx` — `(targetEntryId, status)`: D-39 и «по моему результату»;
- `disputes_race_idx` — `(raceId, status, filedAt: -1, _id: -1)`: чек-лист, D-19 и список панели по гонке;
- `disputes_queue_idx` — `(status, filedAt: -1, _id: -1)`;
- `disputes_all_idx` — `(filedAt: -1, _id: -1)`;
- `dispute_events_dispute_idx` — `(disputeId, at, _id)`.

Бэкфилл:
`race_entries.updateMany({ disqualified: { $exists: false } }, { $set: { disqualified: null } })`,
`races.updateMany({ disputeFilingClosedAt: { $exists: false } }, { $set: { disputeFilingClosedAt: null } })`.
Чтение всё равно терпит отсутствие поля: равенство `null` в MongoDB совпадает и с отсутствующим полем, плюс `?? null`.
Частичный `race_entries_ranking_idx` остаётся пригодным: запрос содержит его условия, `disqualified` — остаточный
фильтр, DQ единичны. Миграция — в конец `migrations/index.ts`.

# 5.1 Placement & Reuse Gate

- **Размещение:**
  - новый модуль `apps/api/src/modules/disputes`: `DisputesCoreModule` (`@Global`: репозиторий и гейты) и
    `DisputesModule` (HTTP);
  - правки `results`: порты `ResultsForDisputes` / `ResultDisputeGate`, DQ до публикации, D-39, чек-лист;
  - правки `races`: `RaceCancelGate`, D-19, `disputeFilingClosedAt`;
  - правки `panel`: права и `AuditDetailsDoc`.
  Новых пакетов нет.
- **Переиспользуем:**
  - панель: `PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelAudit`, `PanelDirectory.displayNames`;
  - приложение: `AuthGuard`, `CurrentUser`, `AuthUser` из `../identity` (как `race-entry.controller.ts`);
  - `RaceRegistry.{get, lockResults, phase}`;
  - `ResultsRepository.{lockEntry, rankedFilter, disqualifiedEntries}`;
  - место цели — тот же код, что «моё участие»: `ResultsReadService.liveResult` / `protocolResult` выносятся в
    публичный `entryResult(race, entry, now, session)`;
  - `buildProtocol` и `race_recalculations` 05; `RateLimiter.consume` напрямую (как `ride-reports.service.ts`;
    `consumeUserLimit` в `results` не экспортируется — RC-15);
  - `domainError`, `isDuplicateKey`, `uuidv7`, outbox базы, `encodeCursor` / `decodeCursor` (`page-cursor.ts`);
  - контракты: `optionalText`, `MULTI_LINE`, `tolerantEnum`, `fieldError`, `Uuid`, `PageCursor`;
  - образцы — `modules/rides` (`ride-reports.*`, `rides-moderation.*`);
  - UI панели — `src/ui` (`PageHeader`, `DataTable`, `ChipGroup`, `Banner`, `StatusTag`, `DisabledReason`,
    `EmptyState`, `ErrorState`, `Button`, `RadioGroup`, `ChoiceDialog`), экран-образец `features/rides-moderation`;
  - приложение — `@rkarakulov/ui` (`AsyncContent`, `Chip`, `TextField`, `Banner`, `Button`, `TextAction`,
    `Skeleton*`), образец жалобы `features/rides/ride-report.tsx`, `participation/*`, `withdraw-confirm.tsx`.
- **Запрещённые дубли:**
  - второй расчёт мест (только `rankRows` / `entryResult` / `buildProtocol`);
  - чтение `race_entries` / `races` из `disputes` (только порты);
  - чтение `disputes` из `results` / `races` (только гейты);
  - update/delete в `dispute_events`; переходы `disputes` не из `open`;
  - `ReasonDialog` для решения не подходит (обязательная причина 3–500), поэтому решение — форма на экране и
    `ChoiceDialog` для подтверждения; новый диалог не создаётся.
- **Новые зависимости npm:** нет.

# 6. Relevant Files

- `apps/api/src/modules/results/{results.collection,results.repository,results.policy,results-read.service,
  results-panel-read.service,results-protocol.service,entries.service,attempts.service,attempt-intake,
  results.module,index}.ts`.
- `apps/api/src/modules/races/{race-registry.port,races.policy,races.service,races.module,index}.ts`.
- `apps/api/src/modules/panel/permissions.ts`; `apps/api/src/{app.module,worker.module?,error-messages}.ts`;
  `apps/api/src/db/migrations/{0016_protocol,index}.ts`; образцы `modules/rides/{ride-reports*,rides-moderation*}`.
- `packages/contracts/src/{common.ts,index.ts,results/*,races/race.schema.ts,admin/{audit,permissions}.schema.ts}`;
  `packages/api-client/src/{admin,index}.ts`; `packages/i18n/src/ru.ts`.
- `apps/app/src/features/races/{results-table,race-detail,participation/*}.tsx`, `apps/app/src/app/races/*`.
- `apps/admin/src/{router.tsx,layout/nav?,features/results/RaceResultsScreen.tsx,features/races/RaceEditor.tsx}`.

# 7. Implementation Notes

### 7.1 Эндпоинты приложения (`AuthGuard`; ids — `Uuid` pipe)

| Метод и путь | Тело | Ответ |
|---|---|---|
| `GET /v1/races/:raceId/disputes` | — | `MyRaceDisputes` |
| `POST /v1/races/:raceId/disputes` | `DisputeFileRequest` | `201 MyDispute` |
| `POST /v1/disputes/:disputeId/withdraw` | — | `MyDispute` |
| `POST /v1/disputes/:disputeId/response` | `DisputeResponseRequest` | `DisputeAgainstMe` |

Чужой спор (не заявитель и не цель) — `404 DISPUTE_NOT_FOUND` (не раскрываем существование). Лимит мутаций
`disputes-user` 20/ч на пользователя `[ASSUMPTION]`. Нет гонки — 404 как в `results`.

### 7.2 `MyRaceDisputes`

```ts
filing: {
  status: 'open' | 'closed' | 'unavailable',
  closesAt: iso,                      // filingClosesAt (D-44)
  protocolPlannedAt: iso,
  reason: DisputeFileBlock | null,    // почему `unavailable`/`closed`
},
filed: MyDispute[],        // мои как заявителя: id, targetEntryId, category, description, status, filedAt,
                           // decision: { outcome, template, at } | null   (без ответа участника — D-51)
against: DisputeAgainstMe[], // по моему результату: id, category, status, filedAt, decidableBy: protocolPlannedAt,
                           // response: { text, at } | null, canRespond, decision: { outcome, template, at } | null
```

`status: 'open'` — подать можно (по любой чужой засчитанной строке без моего спора); `closed` — мог бы подать, но
срок прошёл / протокол опубликован (M1: показываем выключенное действие с причиной); `unavailable` — не участник с
засчитанным результатом, DQ, отменил участие, гонка отменена (действие скрыто). В `against` — без заявителя и
описания (D-51). Сортировка — новые сверху.

### 7.3 Правила подачи, ответа, отзыва

- Подача: `targetEntryId` ≠ своя заявка (`own_result`), цель в гонке с `best` и без DQ (`target_not_counted`),
  заявитель годен (`not_entered`/`withdrawn`/`no_counted_result`/`disqualified`), срок (`filing_closed`),
  протокол (`protocol_published`), отмена (`race_cancelled`), дубль (`already_filed` — и при E11000 уникального
  индекса), лимит (`open_limit`). Ответ — `201 MyDispute`.
- Ответ: только участник-цель, спор `open`, ответа ещё нет (`already_responded`), текст 3–2000.
- Отзыв: только заявитель, спор `open` (`not_open`); `closedAt = now`. Подтверждение — на клиенте.
- Ответ участника и описание — свободный текст: в логи и события outbox не пишутся (события — только id и коды).

### 7.4 Панель (`PanelGuard`)

| Метод и путь | Право | Ответ |
|---|---|---|
| `GET /v1/admin/disputes?status=&raceId=&cursor=&limit=` | `disputes.read` | `PanelDisputePage` (по `filedAt` убыв., курсор) |
| `GET /v1/admin/disputes/:disputeId` | `disputes.read` | `PanelDispute` |
| `POST /v1/admin/disputes/:disputeId/decision` | `disputes.decide` | `PanelDispute` |

`PanelDisputeListItem`: `id, race { id, title }, status, category, targetEntryId, complainantEntryId, filedAt,
decidableAt, responded: boolean`. `PanelDispute`: + `description, response { text, at } | null, target { entryId,
userId, resultStatus, place | null, tied, elapsedSec | null }, complainant { entryId, userId }, decision { outcome,
template, note, actor { userId, name }, at } | null, events: { kind, actorKind, at }[], filingClosesAt,
protocolPlannedAt, canDecide, decideBlockedBy: 'too_early' | 'not_open' | 'protocol_published' | null`. Видимость:
модератор и admin — все гонки (споры — работа команды платформы). Мутации — лимит `disputes-panel-user` 60/ч.
Решение: `409 DISPUTE_ACTION_BLOCKED` (`too_early` + `availableAt`, `not_open`, `protocol_published`,
`race_cancelled`). Журнал: `disputes.decided`, `subject: { kind: 'race', id, label }`, `reason` — заметка или код
шаблона, `details: { disputeId, entryId }`.

### 7.5 Ошибки

| Код | HTTP | Когда |
|---|---|---|
| `DISPUTE_ACTION_BLOCKED` | 409 | `details: { reason: DisputeActionBlock, availableAt? }` |
| `DISPUTE_NOT_FOUND` | 404 | нет спора или он не виден этому пользователю |
| `ATTEMPT_UPLOAD_CLOSED` (есть) | 409 | `details.reason: 'dispute_open'` — явная попытка при открытом споре по своему результату |
| (код отмены участия, есть) | 409 | `reason: 'dispute_open'` |
| `RACE_INVALID_STATE` (есть) | 409 | отмена гонки при открытых спорах, `details.reason: 'disputes_open'` |

### 7.6 DQ до публикации и протокол

- `ResultsForDisputes.disqualify(tx, { raceId, entryId, disputeId, actorUserId, at })`: заявка активна, `disqualified:
  null` → `{ at, disputeId }`, `$inc version`; запись `race_recalculations { kind: 'disqualified', revision: null,
  entryId, reason: 'dispute', actorUserId, at }`.
- `resultStatus`: `disqualified` → `dq` (раньше `provisional`). Публичная таблица, места, `ranked`, панель
  «Участники» до публикации — без DQ (`rankedFilter`), DQ-строки — `resultStatus: 'dq'` в «прочих».
- Публикация: `base` из заявок с `best`, включая DQ, `dq: disqualified !== null` → `buildProtocol` даёт `dq` без места.
- «Применить пересчёт»: DQ по-прежнему из `race_recalculations` (DV-13 05) — теперь включая `revision: null`
  записи спора. «Отменить DQ» после публикации снимает и `disqualified` заявки.
- Право подачи и цель — DQ исключает (`disqualified`/`target_not_counted`).

### 7.7 D-39

- `entryActions(…, openDisputeAgainst: boolean)`: при открытом споре по своей заявке — `canWithdraw: false`,
  `canAddAttempt: false`, причина `dispute_open` (одна).
- Сервер: отмена участия и явная попытка (выбор заезда и загрузка с контекстом гонки — точка приёма) —
  `ResultDisputeGate.openAgainst(tx, entryId) > 0` → отказ с `dispute_open` в транзакции под `lockEntry` (подача
  спора тоже берёт `lockEntry` цели — конфликт записи).
- Автоматические попытки (импорт) при открытом споре по заявке — не создаются (приём пропускает; после решения
  райдер может выбрать заезд явно). Попытки, созданные до подачи, проверяются как обычно.

### 7.8 Приложение

- Карточка гонки: если у меня есть заявка — запрос `useMyRaceDisputes(raceId)` (polling как участие, только при
  открытом споре). Строка таблицы ≠ своя → `Pressable` (`accessibilityRole="button"`, подпись «Участник, N место,
  время. Открыть карточку») → маршрут `races/[id]/result/[entryId]` (карточка соперника, модальный экран).
- Карточка соперника: kicker «N место», «Участник», время, статус «Предварительный»; действие по `filing`:
  `open` и спора по строке нет — «Оспорить результат» (secondary) + «Споры принимаются до {дата}» → экран
  `races/[id]/dispute/[entryId]`; `closed` — выключенное + «Приём споров закрыт — протокол будет опубликован
  {дата}»; `unavailable` — ничего; мой спор по строке — статус спора.
- Экран подачи: оспариваемый результат, категория (список строк-вариантов из системы, выбор обязателен; без неё
  «Отправить спор» выключено + «Выберите категорию»), описание (необязательно, ≤ 2000), строка о сроке и D-51,
  ошибки 409 — текст по `details.reason`; успех — возврат к карточке гонки, инвалидация запросов.
- Блок «Споры» на карточке гонки: мои споры («На рассмотрении», «Удовлетворён», «Отклонён» + шаблон, «Отозван»;
  «Отозвать спор» → подтверждение); по моему результату — баннер warning «По вашему результату открыт спор:
  {категория}. Решение — до публикации протокола {дата}» + «Ответить» (экран `races/[id]/dispute-response/[disputeId]`)
  или «Ваш ответ отправлен»; после решения — исход. D-39 — тексты причин у выключенных «Загрузить заезд» и
  «Отменить участие».
- Все тексты — i18n, все цвета/отступы — токены; iOS, Android, web.

### 7.9 Панель

- Навигация «Споры» (`Can disputes.read`); маршруты `disputes` → `DisputesScreen`, `disputes/$disputeId` →
  `DisputeScreen`. Список: `ChipGroup` статуса (по умолчанию «На рассмотрении»), фильтр гонки из query
  (`?raceId=` — со ссылки чек-листа), `DataTable` (гонка, участник ·xxxxxx, категория, подан, решение с, ответ,
  статус), пагинация курсором.
- Разбор: шапка (крошки «Споры › {гонка}», статус), блок результата (место, время, статус), заявление (заявитель
  ·xxxxxx, «Скрыт от участника», категория, описание), ответ участника (или «Ответа нет»), история событий;
  панель решения (`disputes.decide`, спор открыт): исход (радио «Удовлетворить» / «Отклонить» с последствием для
  «Удовлетворить» — DQ), шаблон причины (выбор из шаблонов исхода, обязателен), внутренняя заметка; кнопка
  `aria-disabled` + `DisabledReason` «Решение можно принять не раньше {дата}» (D-25); подтверждение. Решённый —
  исход, шаблон, заметка, автор, время.
- «Результаты»: строка чек-листа `open_disputes` — ссылка «Открыть споры» (`/disputes?raceId=`) при `count > 0`
  и `disputes.read`. `RaceEditor`: текст причины `disputes_open`.

### 7.10 i18n `[ASSUMPTION copy]`

Категории и шаблоны — §3; статусы спора: «На рассмотрении», «Отозван», «Удовлетворён», «Отклонён»;
«Оспорить результат», «Споры принимаются до {date}», «Приём споров закрыт — протокол будет опубликован {date}»,
«Выберите категорию», «Участник увидит только категорию — ваше имя и описание видит только команда платформы.»,
«Отозвать спор», подтверждение «Отозвать спор? Подать его снова будет нельзя.», D-39: «По результату открыт спор —
новые заезды можно загрузить после решения», «Отменить участие можно после решения по спору»; D-19 панели:
«По гонке есть открытые споры — отмена недоступна (D-19).»; ошибки `DISPUTE_*` по причинам.

### 7.11 Логи

После коммита: `disputeId`, `raceId`, действие, исход; без описания, ответа, заметки, `userId` райдеров.

# 8. Risks / Assumptions / Open Questions

- R1 `[ASSUMPTION]` права: `disputes.read`/`disputes.decide` — admin и moderator; organizer — нет.
- R2 `[ASSUMPTION]` один спор на пару (заявитель, цель) за гонку, повтор после отзыва — нельзя; ≤ 3 открытых на
  заявителя в гонке; описание необязательно.
- R3 Перенос плановой даты протокола позже (V-11) сдвигает отсечку D-44: если срок уже наступил, приём «открылся бы
  снова». Решение: `filingClosesAt` фиксируется в момент первого наступления? — v1 считает от текущей плановой даты;
  V-11 запрещает перенос раньше, перенос позже после отсечки — `[ASSUMPTION]` редкий случай, приём откроется
  снова (зафиксировать в §8.1 после проверки architect: возможно ли хранить `disputesClosedAt` в гонке дешево).
- R4 Решение до публикации — единственный путь DQ до публикации; отмены DQ до публикации нет (решение окончательно).
- R5 Автоматические попытки при открытом споре не создаются (D-39) — импорт Garmin/Wahoo в это время теряется для
  гонки, райдер может выбрать заезд явно после решения.
- R6 Ряды биометрии — слайс 06b (§4).
- R7 Карточка соперника без имени (A12) — отличается от прототипа (имя, тренер) до слайса профиля.

# 8.1 Requirements Consistency

Architect, сверено с кодом `develop` @ `e047921`. Ниже 18 находок, по каждой вынесено решение. Блокеров нет:
D-коды и права R1 не меняются, уточнена механика; `[ASSUMPTION]` — RC-6, RC-14. По правилам роли architect правит
только §5, §5.1, §8.1, §10, §11. Где решение расходится с текстом §3, §7 или §9, действует §8.1, а §5 уже приведён
в соответствие.

**RC-1 [HIGH, недоопределённость → тихий отказ D-39] Регистрация гейтов.**
- Проблема. «Необязательная инъекция, без `disputes` — 0» (§5 spec) в NestJS при импорте `disputes → results` не
  собрать: `ResultsCoreModule` не может импортировать модуль `disputes` (цикл). С `@Optional` приём попыток в worker
  получит `undefined` и молча начнёт создавать попытки при открытом споре.
- Варианты: (a) `@Global() DisputesCoreModule` с провайдерами токенов `RESULT_DISPUTE_GATE` / `RACE_CANCEL_GATE`;
  (b) реестр-держатель в `results`, куда `disputes` регистрируется в `onModuleInit` (изменяемое состояние, порядок
  инициализации); (c) запросы к `disputes` прямо из `results` (нарушает границы).
- Решение: (a). `DisputeGates` зависит только от `DisputesRepository`. `DisputesCoreModule` импортируют `AppModule` и
  `WorkerModule`, инъекция обязательная. §5 поправлен.

**RC-2 [HIGH, пропущенное место] `rankedFilter` + `disqualified: null` выкидывает DQ из протокола.**
- Проблема. Публикация (`results-protocol.service.ts publish`) и «Применить пересчёт» (`applyRecheck`) берут базу из
  `rankedEntries` (фильтр `rankedFilter`). С новым фильтром DQ-участник по спору выпал бы из снимка, хотя §7.6 требует
  строку `dq`. После публикации `applyRecheck` тоже потерял бы его строку.
- Решение. Новый `ResultsRepository.protocolBaseEntries(raceId, session)`: активные заявки с `best` без фильтра DQ, в
  порядке `(best.elapsedSec, best.startedAt, _id)`. Признак DQ берётся из `disqualifiedEntries(raceId, tx)`, единого
  источника (DV-13 05), в обоих местах. `publish` перестаёт передавать `baseOf(entry, false)`. `liveHead` (панель,
  «Участники») остаётся на `rankedEntries`: DQ-заявка уходит в «прочие» со статусом `dq`. `disqualifiedEntries`
  сортирует по `{ revision: 1, at: 1, _id: 1 }`: записи `revision: null` (DQ по спору до публикации) идут первыми.

**RC-3 [MEDIUM, вредное решение в spec] «Отменить DQ после публикации снимает и `disqualified` заявки» (§7.6).**
- Проблема. Чтобы снять поле, `toggleDisqualification` должен брать `lockEntry` и писать заявку. DQ после публикации
  (05) при этом поле не ставит, то есть механика асимметрична. Расходятся два источника «DQ ли участник».
- Варианты: (a) как в spec; (b) симметрично ставить и снимать поле и в 05; (c) **поле — проекция только до
  публикации**.
- Решение: (c). Поле `disqualified` читается только при `protocolPublishedAt === null` (список мест — §5 «DQ до
  публикации»). После публикации истина — журнал и снимок. Код 05 (`toggleDisqualification`) не меняется. AC5 и AC8
  остаются в силе; в int-тест добавляется «DQ по спору → публикация → Отменить DQ → строка `revised` с местом».

**RC-4 [HIGH, неверные имена] D-39: реальные коды и точки.**
- Отмена участия — `RACE_WITHDRAW_CLOSED`, сейчас без `details`. Решение: `details: RaceEntryBlockedDetails = { reason:
  tolerantEnum(RACE_ENTRY_BLOCK_REASONS) }`. Та же схема описывает уже существующий `ATTEMPT_UPLOAD_CLOSED.details`
  (сейчас он без схемы, `attempts.service.ts:58`).
- Точки проверки:
  - `EntriesService.withdraw` — после `lockEntryOf`, статуса и фазы;
  - `AttemptsService.add` — после `attemptClosedReason`, для обоих видов тела (`activityId` и `uploadId`, «загрузка с
    контекстом гонки»).
  Файл, загруженный через `POST /v1/tracks/uploads` до отказа, остаётся заездом пользователя. Приём его не возьмёт в
  гонку (RC-5).
- i18n (реальные префиксы, а не `races.entry.reason.*` из §3): причины у кнопок — `races.block.dispute_open` («По
  результату открыт спор — новые заезды можно загрузить после решения»), `races.block.disqualified`; причина отмены
  участия — новый блок `races.withdrawBlock.{dispute_open, disqualified}` («Отменить участие можно после решения по
  спору»). Текст 409: `raceActionErrorText` читает `details.reason` — у отмены `races.withdrawBlock.<reason>`, у
  попытки `races.block.<reason>`, иначе прежний `races.error.<код>`. Старые сборки покажут прежний текст кода — принято
  (кнопка у них выключена по `canWithdraw`/`canAddAttempt`).
- `entryActions(race, phase, entry, now, { openDisputes })`: причины спора добавляются, только когда действие было бы
  доступно, — если `canWithdraw`/`canAddAttempt` после прежних правил ещё `true`, то DQ (до публикации) →
  `block('disqualified')`, иначе `openDisputes > 0` → `block('dispute_open')`. Закрытое окно по-прежнему объясняется
  своей причиной. Приложение: `ATTEMPT_REASONS + dispute_open, disqualified`; новый `WITHDRAW_REASONS =
  ['dispute_open', 'disqualified']` с текстом под блоком действий (сейчас при `canWithdraw: false` кнопка просто
  скрыта).

**RC-5 [HIGH, вредная реализация «авто-попытка не создаётся»] Приём при открытом споре.**
- Проблема. Если в `syncGroup` пропускать только `ensureAttempt`, цикл `not_primary` всё равно снимет попытку прежней
  основной, когда придёт дубль с более высоким приоритетом (Garmin после ручной загрузки). Цель потеряет `best` без
  своего действия, а заодно и оспоренный результат.
- Решение. В `syncGroup` после `lockEntry`, если `gate.openAgainst(entry._id, tx) > 0` и среди `entry.requests` нет
  загрузки группы, — выход без изменений попыток и запросов (записан только замок): группа заморожена целиком. Запрос «загрузить в гонку», принятый до подачи спора,
  обрабатывается как явное намерение. `activityRemoved` не меняется: удаление заезда — действие владельца, попытка
  снимается, новая основная группы заморожена до решения. Это принятый риск, дополнение к R5. После решения или отзыва
  авто-попытки для замороженной группы сами не появятся; райдер выберет заезд явно. Комментарий в коде.

**RC-6 [MEDIUM, `[ASSUMPTION]`] DQ-участник может отменить участие — DQ исчезает из протокола.**
- Проблема. `resultStatus` ставит `withdrawn` выше всего. База публикации (активные заявки) не возьмёт отменённую,
  поэтому строки `dq` не будет: участник «ушёл от DQ».
- Решение. Новая причина `RACE_ENTRY_BLOCK_REASONS + 'disqualified'` (в конец, после `dispute_open`). До публикации у
  DQ-заявки `canWithdraw: false` и `canAddAttempt: false`. Сервер отвечает `RACE_WITHDRAW_CLOSED` и
  `ATTEMPT_UPLOAD_CLOSED` с `reason: 'disqualified'`. Авто-приём не блокируется: он безвреден, заявка вне мест. Текст:
  «Результат дисквалифицирован по решению команды платформы».

**RC-7 [MEDIUM, R3] D-44 «не открывается снова» при переносе плановой даты позже.**
- Проблема. Минимальная задержка протокола 48 ч (`RACE_PROTOCOL_MIN_DELAY_HOURS`), поэтому отсечка `planned − 24 ч`
  наступает только в фазе `closed`. Там V-11 разрешает перенос лишь позже, а значит, после отсечки приём «открылся бы
  снова».
- Варианты: (a) как в spec — открывается (нарушает D-44); (b) ленивая запись момента закрытия при чтении (запись на
  GET, и тот, кто не читал, всё равно увидит переоткрытие); (c) **`races.disputeFilingClosedAt` — фиксация при
  переносе**.
- Решение: (c), запись дешёвая и пишется одним полем в уже существующей `updateRace`. Правило — в §5 «Срок приёма»,
  чистая функция `disputeFilingFreeze(current, next, now)` в `races.policy.ts` (unit). Константа
  `DISPUTE_FILING_LEAD_HOURS = 24` лежит в contracts, её используют и `races`, и `disputes`. R3 закрыт.

**RC-8 [MEDIUM, конфликт с инвариантом] «Споры — append-only» (`AGENTS.md` §4.10, `pokatim-db.md`,
`pokatim-backend.md`) и изменяемый `disputes`.**
- Варианты: (a) только события, состояние — агрегацией (уникальность пары, лимит и гейты по событиям дороги и
  хрупки); (b) **проекция с переходами только из `open` + история в `dispute_events`**, как `ride_reports` 05b.
- Решение: (b). Инвариант §4.10 говорит об истории решений, и она append-only (`dispute_events`). Сторож
  `disputes.repository.test.ts`:
  - над `events` — только `insertOne` / `find` / `findOne`;
  - над `disputes` — `insertOne` / `updateOne` / `findOne` / `find` / `countDocuments` / `aggregate`;
  - каждый `updateOne` с фильтром `status: 'open'` (unit с поддельной коллекцией);
  - нет `delete` / `replace` / `updateMany` / `findOneAndUpdate` / `bulkWrite`.
  Формулировки правил уточняются (§10).

**RC-9 [MEDIUM, пропущенное место] D-19 в списке гонок и код ошибки.**
- `raceEditable` вызывается в `RacesService.present` для списков, поэтому нужен пакетный
  `RaceCancelGate.openDisputesByRace(raceIds)` (одна агрегация по `disputes_race_idx`). `raceEditable(race, now, {
  canManage, seasonFound, openDisputes })`: в фазах `upcoming`/`open`/`closed` при `openDisputes > 0` — `canCancel:
  false` и причина `disputes_open` в конце.
- Отмена: проверка гейта в транзакции после `manageable` и проверки версии →
  `RACE_INVALID_STATE` + новая `RaceInvalidStateDetails { reason: z.enum(RACE_EDIT_BLOCK_REASONS) }`.
- Второго рубежа в фильтре `updateRace` нет: счёт чужой коллекции. Гонку «подача ↔ отмена» закрывает конфликт записи:
  подача пишет `resultsVersion`, отмена — документ гонки.
- `RaceEditor` показывает `disputes_open` в `editReasons`, а 409 — текстом по `details.reason`.

**RC-10 [LOW, противоречие в enum] Причины `DISPUTE_FILE_BLOCKS` / `DISPUTE_ACTION_BLOCKS`.**
- `not_started` недостижим: у заявителя с `best` результаты в гонке уже есть — убрать.
- `cancelled` и `race_cancelled` — дубль; остаётся `cancelled`.
- `open_limit` добавляется в `FILE_BLOCKS`: `filing.status: 'closed'`, выключенное действие с причиной.
- Итог:
  - `FILE_BLOCKS = ['not_entered', 'withdrawn', 'no_counted_result', 'disqualified', 'cancelled',
    'protocol_published', 'filing_closed', 'open_limit']`;
  - `ACTION_BLOCKS = [...FILE_BLOCKS, 'own_result', 'target_not_counted', 'already_filed', 'not_open',
    'already_responded', 'too_early']`;
  - `decideBlockedBy ∈ DISPUTE_DECIDE_BLOCKS = ['too_early', 'not_open', 'protocol_published', 'cancelled']`.
- `filing.status`: `open` — блока нет; `closed` — `filing_closed | protocol_published | open_limit` (M1); иначе
  `unavailable`.

**RC-11 [LOW, индексы] Лишний и недостающие индексы §5 spec.**
- `(complainantUserId, raceId)` покрыт префиксом уникального `(raceId, complainantUserId, …)` — не нужен.
- Нужен `(raceId, status, filedAt, _id)`: чек-лист, D-19 и список по гонке.
- Нужен `(filedAt, _id)`: список «все статусы».
- История упорядочивается по `(disputeId, at, _id)`: `uuidv7` не монотонен внутри миллисекунды (DV-5 05).
- Курсор панели — `id` последней строки; позицию `(filedAt, _id)` сервер читает из самого спора, как курсор таблицы.

**RC-12 [LOW, принятые гонки] Что не закрывается замками.**
- Заявитель читается без замка. Параллельная отмена своего участия или исключение своего лучшего результата
  пропускает спор «уже не участника» — безвредно, спор разбирает команда.
- Цель после подачи может сменить `best` (вердикты попыток, поставленных до подачи; исключение панелью) — спор
  остаётся открытым.
- После `upheld` прочие открытые споры против той же цели остаются открытыми: закрыть их автоматически нельзя из-за
  D-25 (≥ 12 ч у каждого). Решаются по одному; `disqualify` идемпотентен.
- Отзыв и ответ не берут `lockResults`. Гонка «отзыв ↔ публикация / отмена» лишь лишний раз блокирует публикацию или
  отмену — безопасно.

**RC-13 [LOW, противоречие §5/§7.6] Причина записи `race_recalculations`.**
- Решение: `reason: 'dispute:<disputeId>'`. `RecalculationsList` панели показывает такие записи текстом «Решение по
  спору ·xxxxxx» со ссылкой на `/disputes/<id>` (`admin.results.recalc.disputeReason`). `actorUserId` — сотрудник,
  принявший решение.

**RC-14 [MEDIUM, `[ASSUMPTION]` UX, маршруты] Приложение: маршруты и данные карточки соперника.**
- `app/races/[id].tsx` — файл публичной карточки вне гарда. Новые экраны следуют конвенции проекта «статический
  сегмент первым» (`races/pick/[id]`, `rides/report/[id]`) и лежат внутри `Stack.Protected`:
  - `app/races/result/[id]/[entryId].tsx` — карточка соперника;
  - `app/races/dispute/[id]/[entryId].tsx` — подача;
  - `app/races/dispute-response/[id]/[disputeId].tsx` — ответ.
  Все три — в `app/_layout.tsx` и `__tests__/app-routes.ts`.
- Строки таблицы нажимаемы только у вошедшего участника, когда карточке есть что показать: `filing.status !==
  'unavailable'` или есть мой спор по строке. Гостю и неучастнику таблица не меняется: карточка без действия была бы
  пустым шагом, а для гостя ещё и экраном вне гарда.
- Место и время на карточке берутся из кэша `useRaceResults(raceId)`. Нет строки (холодный старт по ссылке, строка на
  незагруженной странице) — `EmptyState` «Результат не найден» и «К гонке». Сервер проверяет цель сам.
- `useMyRaceDisputes(raceId)` — только у вошедшего с заявкой. Опрос раз в `ENTRY_POLL_MS`, пока есть открытый спор в
  `filed` или `against`. Мутация споров инвалидирует и `raceEntryKey` (D-39 меняет `actions`).

**RC-15 [LOW, границы модулей] Образцы и импорты.**
- `consumeUserLimit` не экспортирован из `results` — `disputes` вызывает `RateLimiter.consume` сам.
- `AuthGuard` / `CurrentUser` / `AuthUser` берутся из `../identity`.
- Название гонки в списке панели — `RaceRegistry.get` по различным `raceId` страницы (≤ 50, обычно 1–3) — принято.
- Организатор прав на споры не имеет (R1), поэтому `findForPanel` не нужен. Если права появятся, переход на
  `findForPanel` обязателен.
- Контроллер приложения — `@Controller()` с полными путями `races/:raceId/disputes` и `disputes/:disputeId/...`;
  `admin-routes.test.ts` его не затрагивает. Контроллер панели — `@Controller('admin/disputes')`, право — на каждом
  методе (`disputes.read` / `disputes.decide`).

**RC-16 [LOW, недоопределённость] «Моё участие» DQ до публикации и место цели в панели.**
- `liveResult` при `disqualified`: `status: 'dq'`, `place: null`, `tied: false`, `elapsedSec: best.elapsedSec`
  (время показывается — как у строки `dq` 05).
- `PanelDispute.target`: `{ resultStatus, place, tied, elapsedSec }` через `ResultsForDisputes.standing(race,
  entryId)` → `ResultsReadService.entryResult` (вынос `liveResult` / `protocolResult`, без второго расчёта мест).

**RC-17 [INFO] Отрицательные доказательства AC10 выполнимы при snapshot-изоляции (`TRANSACTION_OPTIONS` базы).**
- Без `lockEntry(target)` подача только читает цель, а отмена читает гейт до коммита подачи. Конфликта записи нет,
  обе коммитятся.
- Без `lockResults` подача не пишет документ гонки, а публикация читает `open_disputes = 0` до коммита подачи. Обе
  коммитятся.
- Механика тестов — `gate()` и `untilBlocked` из `apps/api/test/identity.ts`, подмена замка чтением через
  `vi.spyOn` (§11 TESTS).

**RC-18 [LOW, пробел reuse] Журнал и права в БД.**
- `AuditDetailsDoc` (`panel.collection.ts`) + `disputeId?`, как RC-11 05.
- `reason` журнала — заметка, если она есть, иначе код шаблона.
- `details: { disputeId, entryId }`; `subject: { kind: 'race' }`.
- Тестовый `ME` панели (`src/test/app.tsx`) получает права R1.
- Пункт «Споры» стоит в группе `main` сразу после «Гонок»: «Сезоны» остаются последними, как требует 8.1 A8 05b.

# 8.2 Deviations from spec

- DV-1 (spec) **Размещение «Оспорить результат»:** слайс 04 отложил карточку соперника, строки анонимны (A12).
  Решение: строки таблицы результатов (кроме своей) нажимаемые и открывают модальный экран «карточка соперника»
  (место, «Участник», время, статус) с «Оспорить результат» и сроком — анатомия шита прототипа без имени, аватара и
  тренера. Отдельный экран, а не bottom sheet: одинаково на iOS/Android/web, deep link, без новой зависимости.
- DV-2 (spec) **Ряды пульса и мощности** вынесены в слайс 06b (эпик §7 — строка добавлена).
- DV-3 (coder) **Порядок `decideBlock`:** `not_open` → `cancelled` → `protocol_published` → `too_early`. Для открытого
  спора результат тот же, что в таблице транзакций §5 (`lockResults` первым, затем проверки). Отличие: у решённого
  спора разбор показывает `decideBlockedBy: 'not_open'`, а не состояние гонки.
- DV-4 (coder) **`raceEditable(…, { openDisputes })` — параметр необязательный** (по умолчанию `0`). Прежние unit-тесты
  `races.policy` не меняются. Единственный вызов в коде, `RacesService.present`, передаёт число всегда (одна агрегация
  `openDisputesByRace`). `entryActions` получает `{ openDisputes }` обязательно.
- DV-5 (coder) **Размещение int-тестов точки B.** D-39, RC-5, RC-6 и строка чек-листа проверяются в новом
  `results/results-disputes.int.test.ts`, а не в `results-entries` / `results-attempts`. Споры в нём вставляются
  напрямую (`test/disputes.ts: seedDispute`). AC9 и RC-7 — в `races-admin.int.test.ts`. RC-7 через API подачи
  проверяется ещё и в `disputes.int.test.ts`.
- DV-6 (coder) **Чужая сторона спора.** Отзыв от цели и ответ от заявителя возвращают `404 DISPUTE_NOT_FOUND`, как у
  постороннего. Действие доступно только своей стороне, существование спора не раскрывается.
- DV-7 (coder) **`RACE_WITHDRAW_CLOSED` при закрытом окне** остаётся без `details`, как в 05. `details.reason`
  (`RaceEntryBlockedDetails`) приходит только с причинами `dispute_open` / `disqualified`. `ATTEMPT_UPLOAD_CLOSED`
  отдаёт `details.reason` для всех причин, как и раньше.
- DV-8 (coder) **Тип `EntryResult`.** `ResultsReadService.entryResult` возвращает статус `RaceResultStatus`, а не
  ответный `tolerantEnum` с `'unknown'`. Это нужно порту `DisputeStanding`, форма ответа «моего участия» не меняется.
- DV-9 (coder) **Отрицательные доказательства AC10 — постоянные тесты.** В `disputes-locks.int.test.ts` замок подменён
  чтением (`ResultsForDisputes.lockEntry` → `entry`, `RacesRepository.lockResults` → `findRace`). Тест ожидает
  нарушенный инвариант: прогон повторяем, а без механизма тест краснеет по результату.
- DV-10 (coder) **Приложение и панель без правок.** Typecheck `apps/app` и `apps/admin` с новыми значениями enum
  зелёный: карты текстов строятся по ключам i18n, а ключи добавлены в точке A. Правка в духе DV-11 слайса 05 не
  понадобилась. Точки D, E, F не выполнялись (вне поручения).

# 8.3 Security checklist

- AuthZ: приложение — только заявитель или цель видят спор (иначе 404); панель — `PanelGuard` + права.
- D-51: в ответах приложения цели нет заявителя, описания; заявителю — нет ответа участника; публично — ничего.
- Вход: `strictObject`, тексты — длины и без управляющих символов; enum — строгие; ids — `Uuid`.
- Злоупотребления: лимиты подачи/мутаций, уникальный спор на пару, ≤ 3 открытых, срок D-44.
- Логи и outbox: без свободного текста и `userId` райдеров; аудит — append-only в транзакции решения.
- Биометрии в 06 нет (06b).

# 9. Acceptance Criteria

- AC1 Участник с засчитанным результатом подаёт спор против чужого засчитанного результата той же гонки: `201`,
  документ `disputes` (`open`), событие `filed` в `dispute_events`, outbox `disputes.dispute-filed` без текста.
- AC2 Подача отклоняется `409 DISPUTE_ACTION_BLOCKED` с причиной: своя заявка, цель без засчитанного или DQ,
  заявитель без засчитанного / отменил / DQ, после `protocolPlannedAt − 24 ч`, после публикации, отменённая гонка,
  повторный спор на ту же цель (и после отзыва), четвёртый открытый.
- AC3 D-51: цель видит в `against` только категорию, статус, срок, свой ответ, исход; заявитель — свой спор без
  ответа участника; посторонний `POST …/withdraw|response` — 404.
- AC4 Ответ: цель отвечает один раз (`already_responded`), не после закрытия (`not_open`); отзыв — только заявитель
  и только открытого.
- AC5 Решение раньше `filedAt + 12 ч` — `409 too_early` с `availableAt`; после — `upheld`: заявка `disqualified`,
  результат `dq`, исчез из таблицы и мест (места пересчитаны), `race_recalculations` `disqualified`; `rejected` —
  результат без изменений; оба — событие `decided`, outbox, журнал `disputes.decided`; повтор — `not_open`.
- AC6 Без `disputes.decide` — 403; organizer — 403 на список.
- AC7 D-39: при открытом споре по заявке `MyRaceEntry.actions` — `canWithdraw/canAddAttempt: false`,
  `dispute_open`; `POST` отмены участия и явной попытки — 409 `dispute_open`; авто-попытка не создаётся; после
  решения/отзыва — снова можно.
- AC8 Чек-лист: `open_disputes` = число открытых споров гонки; публикация с открытым спором — `409
  RESULTS_PUBLISH_BLOCKED`; после решения — публикуется, строка DQ-участника — `dq` без места.
- AC9 D-19: при открытом споре `editable.canCancel = false`, причина `disputes_open`; `POST …/cancel` — 409.
- AC10 Конкурентность (int, отрицательные доказательства): подача ↔ отмена участия цели — побеждает одно (без
  `lockEntry` в подаче — обе проходят); подача ↔ публикация — без `lockResults` в подаче спор открыт при
  опубликованном протоколе; решение ↔ решение — одно `not_open`.
- AC11 Append-only: `dispute_events` — только `insertOne` (сторож по исходнику).
- AC12 Приложение: карточка соперника с действием / выключенным действием с причиной / без действия по `filing`;
  форма с обязательной категорией; блок «Споры» (мои, по моему результату, ответ, отзыв с подтверждением); D-39
  тексты; RTL-тесты.
- AC13 Панель: список с фильтром, разбор, решение с шаблоном, неактивная кнопка до 12 ч с причиной, права;
  чек-лист — ссылка на споры; RTL-тесты.
- AC14 `pnpm check` зелёный; миграция `0018_disputes` идемпотентна.

# 10. Documentation Impact

- `docs/adr/0012-race-results.md` — раздел «Реализация п. 7–8 (слайс 06)»:
  - споры — проекция с переходами только из `open` и история `dispute_events` только вставками (RC-8);
  - решение «Удовлетворить» = DQ; DQ до публикации — проекция заявки, источник «действующих DQ» — журнал пересчётов
    (RC-2, RC-3);
  - отсечка D-44 фиксируется полем `races.disputeFilingClosedAt` (RC-7);
  - п. 8 — ряды биометрии в слайсе 06b.
- `docs/tasks/2026-10-27-race-results/epic.md` — §7: строка 06 без рядов пульса и мощности, добавлена строка 06b.
- `.claude/rules/pokatim-db.md` — раздел «Споры (race-results-06)»:
  - коллекции, индексы, замки (`lockResults` → `lockEntry` цели);
  - append-only: формулировку «споры — без update/delete» заменить на «история споров (`dispute_events`) — только
    вставки; `disputes` — проекция, переходы только из `open` (сторож)»;
  - `race_entries.disqualified` читается только до публикации;
  - `races.disputeFilingClosedAt`.
- `.claude/rules/pokatim-backend.md`:
  - модуль `disputes`; гейты `ResultDisputeGate` / `RaceCancelGate` — `@Global DisputesCoreModule` в `AppModule` и
    `WorkerModule`, инъекция обязательная (RC-1);
  - D-39 в `syncGroup` — заморозка группы (RC-5);
  - события `disputes.*` без маршрута до `notifications`;
  - строку «Append-only (только INSERT): споры…» уточнить так же, как в `pokatim-db.md`.
- `.claude/rules/pokatim-security.md` — «Споры (race-results-06)»:
  - D-51 — состав ответов приложения;
  - права `disputes.read` / `disputes.decide`;
  - лимиты `disputes-user` / `disputes-panel-user`;
  - логи и события без описания, ответа, заметки и `userId` райдеров;
  - чужой спор — 404.
- `.claude/rules/pokatim-tests.md` — отрицательные доказательства подачи: `lockEntry` цели (подача ↔ отмена участия)
  и `lockResults` (подача ↔ публикация).
- `.claude/rules/pokatim-app.md` — карточка соперника, экраны спора и ответа (маршруты RC-14), причины D-39.
- `.claude/rules/pokatim-web.md` — раздел «Споры» (список, разбор, решение без `ReasonDialog`), ссылка из чек-листа.
- `AGENTS.md` не меняется: §4.10 говорит об истории решений, а она append-only.

# 11. Implementation Context

Architect: Status **CONCERNS → решены в §8.1** (RC-1…RC-18), блокеров нет. `[ASSUMPTION]` для подтверждения
человеком: RC-6 (DQ-участник не отменяет участие) и RC-14 (строки таблицы нажимаемы только при доступном действии).
Пути — от корня репозитория.

### ENTRY POINTS

- HTTP приложения: `apps/api/src/modules/disputes/disputes.controller.ts` (`AuthGuard`) → `DisputesService`
  (`GET`/`POST /v1/races/:raceId/disputes`, `POST /v1/disputes/:disputeId/{withdraw,response}`).
- HTTP панели: `apps/api/src/modules/disputes/disputes-admin.controller.ts` (`PanelGuard`) → `DisputesPanelService`
  (`GET /v1/admin/disputes`, `GET …/:disputeId`, `POST …/:disputeId/decision`).
- Гейты: `DisputeGates` (`DisputesCoreModule`, `@Global`) ← `results`: `ResultsReadService.myEntry`,
  `EntriesService.withdraw`, `AttemptsService.add`, `AttemptIntake.syncGroup`, `ResultsPanelReadService.checks`;
  ← `races`: `RacesService.{cancel, present}`.
- Порт `ResultsForDisputes` (`results`) ← `DisputesService` / `DisputesPanelService`.
- `RacesService.update` — фиксация `disputeFilingClosedAt` (RC-7).
- Приложение: строки `features/races/results-table.tsx` → `app/races/result/[id]/[entryId].tsx` →
  `app/races/dispute/[id]/[entryId].tsx`; блок «Споры» в `features/races/race-detail.tsx` →
  `app/races/dispute-response/[id]/[disputeId].tsx`.
- Панель: `apps/admin/src/navigation.ts` («Споры») → маршруты `disputes`, `disputes/$disputeId` в
  `apps/admin/src/router.tsx`; ссылка из `features/results/PublishBlock.tsx`.

### FILES TO MODIFY

**Contracts / клиенты / i18n**
- `packages/contracts/src/disputes/disputes.schema.ts` (новый): константы, справочники, запросы и ответы приложения,
  `DisputeActionBlockedDetails` (TYPES).
- `packages/contracts/src/disputes/disputes-admin.schema.ts` (новый): `DisputeDecisionRequest`, `PanelDisputeQuery`,
  `PanelDisputeListItem`, `PanelDisputePage`, `PanelDispute`, `DISPUTE_DECIDE_BLOCKS`.
- `packages/contracts/src/index.ts` — экспорт обоих файлов.
- `packages/contracts/src/results/results.schema.ts` — `RACE_ENTRY_BLOCK_REASONS + 'dispute_open', 'disqualified'` в
  конец; `RaceEntryBlockedDetails`.
- `packages/contracts/src/races/race.schema.ts` — `RACE_EDIT_BLOCK_REASONS + 'disputes_open'`;
  `RaceInvalidStateDetails`.
- `packages/contracts/src/admin/permissions.schema.ts` — `+ 'disputes.read', 'disputes.decide'`.
- `packages/contracts/src/admin/audit.schema.ts` — `+ 'disputes.decided'`; `details.disputeId`.
- `packages/contracts/src/common.ts` — `'DISPUTE_ACTION_BLOCKED', 'DISPUTE_NOT_FOUND'` в конец `ErrorCode`.
- Тесты контрактов: `disputes/disputes.schema.test.ts` (новый); `results.schema.test.ts`, `race.schema.test.ts`,
  `audit.schema.test.ts`, `permissions.schema.test.ts`, `common.test.ts`.
- `packages/api-client/src/index.ts`: `getMyRaceDisputes`, `fileDispute`, `withdrawDispute`, `respondToDispute`
  (`accessToken` первым, как `withdrawFromRace`) + `races.test.ts` или новый `disputes.test.ts`.
- `packages/api-client/src/admin.ts`: `listDisputes(params)`, `getDispute(id)`, `decideDispute(id, body)` +
  `admin.test.ts`.
- `packages/i18n/src/ru.ts`:
  - приложение `disputes.*`: категории, статусы, шаблоны, `filing.*`, форма, подтверждение отзыва, ответ, D-51,
    ошибки `DISPUTE_ACTION_BLOCKED.<reason>`, `DISPUTE_NOT_FOUND`;
  - `races.block.{dispute_open, disqualified}`, `races.withdrawBlock.{dispute_open, disqualified}` (RC-4/RC-6);
  - панель `admin.disputes.*`; `admin.nav.disputes`; `admin.races.reason.disputes_open`;
    `admin.audit.action.disputes.decided`; `admin.results.check.open_disputes.link`;
    `admin.results.recalc.disputeReason` (RC-13).

**API — races**
- `races.collection.ts`: `RaceDoc.disputeFilingClosedAt: Date | null` (с комментарием как у `protocolPublishedAt`).
- `races.policy.ts`:
  - `raceEditable(…, { canManage, seasonFound, openDisputes })` — `disputes_open`, `canCancel: false` (RC-9);
  - чистая `disputeFilingFreeze(current, next, now): Date | null` (RC-7).
- `races.service.ts`:
  - `create` → `disputeFilingClosedAt: null`;
  - `update` → фиксация в `next`;
  - `cancel` → гейт + `RaceInvalidStateDetails`;
  - `present` → `openDisputesByRace`;
  - инжект `@Inject(RACE_CANCEL_GATE)`.
- `race-cancel-gate.port.ts` (новый): токен и интерфейс.
- `race-registry.port.ts` / `race-registry.ts`: `RaceForResults.disputeFilingClosedAt` (`toRace`: `?? null`).
- `index.ts`: экспорт `RACE_CANCEL_GATE`, `type RaceCancelGate`.

**API — results**
- `results.collection.ts`: `RaceEntryDoc.disqualified: { at: Date; disputeId: string } | null` (комментарий RC-3).
- `results.policy.ts`:
  - `resultStatus` → `dq` при `disqualified`, кроме `ignoreBest`;
  - `entryActions(…, { openDisputes })` (RC-4, RC-6);
  - `entryDisputeBlock(entry, openDisputes, race): 'disqualified' | 'dispute_open' | null` — одна функция для чтения и
    сервера.
- `results.repository.ts`:
  - `rankedFilter` + `disqualified: null`;
  - `protocolBaseEntries`, `disqualifyEntry` (TYPES);
  - `disqualifiedEntries` — сортировка `{ revision: 1, at: 1, _id: 1 }`.
- `results-protocol.service.ts`: `publish` и `applyRecheck` — база `protocolBaseEntries` + `disqualifiedEntries`
  (RC-2).
- `results-read.service.ts`: публичный `entryResult(race, entry, now, session)` (DQ — RC-16); `myEntry` берёт
  `openAgainst` и передаёт в `entryActions`; инжект гейта.
- `results-panel-read.service.ts`: `checks` → `openDisputes: await this.disputes.openInRace(race.id, session)` (убрать
  заглушку `0`); `liveHead` без изменений, статус «прочих» — `dq` через `resultStatus`.
- `entries.service.ts`: `withdraw` — RC-4/RC-6; литерал заявки `disqualified: null`.
- `attempts.service.ts`: `add` — RC-4/RC-6.
- `attempt-intake.ts`: `syncGroup` — заморозка (RC-5), комментарий.
- `result-dispute-gate.port.ts`, `results-for-disputes.port.ts` (новые): токены и интерфейсы;
  `results-for-disputes.ts` (новый): `ResultsForDisputesService` (репозиторий + `ResultsReadService.entryResult`).
- `results.module.ts`: в `ResultsCoreModule` — провайдер `{ provide: RESULTS_FOR_DISPUTES, useExisting:
  ResultsForDisputesService }`, экспорт токена.
- `index.ts`: экспорт `RESULT_DISPUTE_GATE`, `type ResultDisputeGate`, `RESULTS_FOR_DISPUTES`,
  `type ResultsForDisputes`, `type DisputeEntry`, `type DisputeStanding`.

**API — disputes (новый модуль `apps/api/src/modules/disputes`)**
- `disputes.collection.ts`: `DISPUTES_COLLECTIONS`, `DisputeDoc`, `DisputeEventDoc`.
- `disputes.repository.ts`: методы TYPES.
- `disputes.policy.ts`: `DISPUTES_POLICY`, `filingClosesAt`, `decidableAt`, `fileBlock`, `filingStatus`, `targetBlock`,
  `decideBlock`.
- `disputes.events.ts`: `DISPUTES_DISPUTE_{FILED, WITHDRAWN, RESPONDED, DECIDED}` + zod-payload `{ disputeId, raceId }`
  (`decided` + `outcome`), без маршрута.
- `disputes.service.ts`: `myRaceDisputes`, `file`, `withdraw`, `respond`. Лимит `disputes-user:<userId>` 20/ч на
  мутации; лог после коммита — §7.11.
- `disputes-panel.service.ts`: `list`, `get`, `decide`. Лимит `disputes-panel-user:<staffId>` 60/ч; журнал в
  транзакции; имена сотрудников — `PanelDirectory`.
- `disputes.controller.ts`, `disputes-admin.controller.ts` (RC-15).
- `dispute-gates.ts`: `DisputeGates implements ResultDisputeGate, RaceCancelGate`.
- `disputes.module.ts`:
  - `@Global() DisputesCoreModule` — `DisputesRepository`, `DisputeGates`, `{ provide: RESULT_DISPUTE_GATE,
    useExisting: DisputeGates }`, `{ provide: RACE_CANCEL_GATE, useExisting: DisputeGates }`, экспорт токенов и
    репозитория;
  - `DisputesModule` — `imports: [IdentityModule, PanelModule, ResultsCoreModule]`, контроллеры, сервисы.
- `index.ts`: `DisputesCoreModule`, `DisputesModule`.

**API — прочее**
- `apps/api/src/app.module.ts`: `DisputesCoreModule`, `DisputesModule`. `apps/api/src/worker.module.ts`:
  `DisputesCoreModule`.
- `apps/api/src/modules/panel/permissions.ts` (+ `permissions.test.ts`): moderator + `disputes.read`,
  `disputes.decide`; admin — всё; organizer — без изменений.
- `apps/api/src/modules/panel/panel.collection.ts`: `AuditDetailsDoc.disputeId?`.
- `apps/api/src/error-messages.ts` (+ тест): `DISPUTE_ACTION_BLOCKED`, `DISPUTE_NOT_FOUND`.
- `apps/api/src/db/migrations/0018_disputes.ts` (новый) + `index.ts` (в конец).
- `apps/api/test/disputes.ts` (новый): `fileDispute`, `decideDispute`, `disputeRace` (две-три заявки с `seedBest`,
  плановая дата с запасом для публикации до отсечки).

**Приложение (`apps/app/src`)**
- `features/races/disputes/` (новые):
  - `queries.ts`: `useMyRaceDisputes`, `useFileDispute`, `useWithdrawDispute`, `useRespondToDispute`. Ключи
    `['races', 'disputes', raceId]`; мутации инвалидируют споры, `raceEntryKey`, `raceResultsKey`;
  - `dispute-format.ts` (+ `.test.ts`): статус → текст и тон, `filing` → действие карточки, тексты ошибок по
    `details.reason`;
  - `rival-card.tsx`, `dispute-form.tsx`, `dispute-response.tsx`, `race-disputes.tsx` (блок карточки гонки).
- `app/races/result/[id]/[entryId].tsx`, `app/races/dispute/[id]/[entryId].tsx`,
  `app/races/dispute-response/[id]/[disputeId].tsx` (новые); `app/_layout.tsx` — три `Stack.Screen` в
  `Stack.Protected`.
- `features/races/results-table.tsx` — проп `rowAction?: (entryId) => (() => void) | null`: `Pressable` с
  `accessibilityRole="button"` и подписью «… Открыть карточку».
- `features/races/race-detail.tsx` — запрос споров, блок «Споры», `rowAction` (RC-14).
- `features/races/participation-format.ts` — `ATTEMPT_REASONS`, `WITHDRAW_REASONS`, `raceActionErrorText` по
  `details.reason`.
- `features/races/participation/entry-actions.tsx` — текст причины отмены (RC-4).

**Панель (`apps/admin/src`)**
- `navigation.ts`: `to` + `'/disputes'`, пункт `{ to: '/disputes', labelKey: 'admin.nav.disputes', permission:
  'disputes.read', group: 'main' }` после `/races`.
- `router.tsx`: `disputesRoute` (`validateSearch: validateDisputesSearch`, `RequirePermission disputes.read`),
  `disputeRoute` (`disputes/$disputeId`).
- `features/disputes/` (новые): `DisputesScreen.tsx`, `DisputeScreen.tsx`, `DecisionPanel.tsx` (`RadioGroup` исхода,
  выбор шаблона по карте исхода, заметка, `aria-disabled` + `DisabledReason` до `decidableAt`, `ChoiceDialog`);
  `disputes-query.ts` (ключи `['admin', 'disputes', …]`; решение инвалидирует споры и
  `['admin', 'races', 'item', raceId]`); `disputes-format.ts` (search, тексты, ошибки).
- `features/results/PublishBlock.tsx` — ссылка «Открыть споры» (`/disputes?raceId=`) при `count > 0` и
  `useCan('disputes.read')`; `RecalculationsList.tsx` — причина `dispute:<id>` (RC-13).
- `features/races/RaceEditor.tsx` — `editReasons` + `disputes_open`; 409 `RACE_INVALID_STATE` с `details.reason`.
- `test/app.tsx` — `ME`: права R1 для admin и moderator.

**Docs** — по §10.

### FILES TO READ (образцы)

- Модуль жалоб и модерации:
  - `apps/api/src/modules/rides/ride-reports.service.ts` (лимит, транзакция, `isDuplicateKey`, логи без текста);
  - `ride-reports.repository.ts` и сторож `ride-reports.repository.test.ts` (проекция с фильтром перехода, имена
    коллекций);
  - `rides-moderation.service.ts`, `rides-moderation.controller.ts` (панель: курсор, права, журнал);
  - `ride-reports.int.test.ts`, `rides-moderation.int.test.ts`;
  - миграция `apps/api/src/db/migrations/0017_ride_reports.ts`.
- Участие и протокол:
  - `apps/api/src/modules/results/{entries.service, attempts.service, attempt-intake, results-read.service,
    results-panel-read.service, results-protocol.service, results.policy, results.repository}.ts`;
  - `race-entry.controller.ts` (`AuthGuard`, `CurrentUser`, `Uuid` pipe);
  - `results-protocol.controller.ts` (панель, `Uuid` pipe, тела).
- Гонки: `apps/api/src/modules/races/{races.service, races.policy, races.repository, race-registry.port,
  races.module}.ts`.
- Замки и отрицательные доказательства:
  - `apps/api/test/identity.ts` (`gate`, `holdTransaction`, `untilBlocked`);
  - `apps/api/src/modules/results/results-protocol.int.test.ts` (исключение ↔ публикация через подмену
    `lockResults`);
  - `apps/api/test/results.ts` (`corridorRace`, `rider`, `seedBest`, `protocolRace`, `travelTo`, `UPLOAD_CLOSES`).
- Приложение:
  - `apps/app/src/features/rides/ride-report.tsx` и `__tests__/ride-report.test.tsx` (форма с обязательной причиной);
  - `app/rides/report/[id].tsx`, `app/races/pick/[id].tsx` (маршрут), `app/_layout.tsx`;
  - `features/races/{results-table, race-detail, queries, participation-format}.tsx|ts`,
    `participation/{entry-actions, withdraw-confirm}.tsx`;
  - `__tests__/{race-participation, race-results, app-routes, races-fixtures}.ts(x)`.
- Панель:
  - `apps/admin/src/features/rides-moderation/{RidesModerationScreen, RideModerationScreen}.tsx` с тестами,
    `moderation-format.ts`, `rides-moderation-query.ts`;
  - `features/results/{PublishBlock, RecalculationsList}.tsx`, `results-errors.ts`;
  - `src/ui/{RadioGroup, ChoiceDialog, DataTable, ChipGroup, layout-parts}.tsx`, `navigation.ts`, `router.tsx`.

### TYPES & SCHEMAS

**contracts — `disputes/disputes.schema.ts`** (ответы приложения — `tolerantEnum`, запросы — строгие)

```ts
export const DISPUTE_FILING_LEAD_HOURS = 24;          // D-44
export const DISPUTE_DECISION_DELAY_HOURS = 12;       // D-25
export const DISPUTE_OPEN_LIMIT = 3;                  // [ASSUMPTION] R2
export const DISPUTE_DESCRIPTION_MAX = 2000;
export const DISPUTE_RESPONSE_MIN = 3;
export const DISPUTE_RESPONSE_MAX = 2000;
export const DISPUTE_CATEGORIES = ['speed_vs_heart_rate', 'heart_rate_doubtful', 'vehicle_assistance',
  'foreign_track', 'other'] as const;
export const DISPUTE_STATUSES = ['open', 'withdrawn', 'upheld', 'rejected'] as const;
export const DISPUTE_OUTCOMES = ['upheld', 'rejected'] as const;
export const DISPUTE_DECISION_TEMPLATES = ['speed_implausible', 'vehicle_assistance', 'foreign_track',
  'rules_violation', 'track_confirmed', 'insufficient_evidence', 'not_a_violation'] as const;
export const DISPUTE_TEMPLATES_BY_OUTCOME = {
  upheld: ['speed_implausible', 'vehicle_assistance', 'foreign_track', 'rules_violation'],
  rejected: ['track_confirmed', 'insufficient_evidence', 'not_a_violation'],
} as const satisfies Record<DisputeOutcome, readonly DisputeDecisionTemplate[]>;
export const DISPUTE_FILE_BLOCKS = ['not_entered', 'withdrawn', 'no_counted_result', 'disqualified', 'cancelled',
  'protocol_published', 'filing_closed', 'open_limit'] as const;                                    // RC-10
export const DISPUTE_ACTION_BLOCKS = [...DISPUTE_FILE_BLOCKS, 'own_result', 'target_not_counted',
  'already_filed', 'not_open', 'already_responded', 'too_early'] as const;
export const DISPUTE_FILING_STATUSES = ['open', 'closed', 'unavailable'] as const;
export const DISPUTE_EVENT_KINDS = ['filed', 'responded', 'withdrawn', 'decided'] as const;

export const DisputeFileRequest = z.strictObject({
  targetEntryId: Uuid,
  category: z.enum(DISPUTE_CATEGORIES, { error: fieldError('REQUIRED') }),
  description: optionalText(DISPUTE_DESCRIPTION_MAX, MULTI_LINE).optional(),   // пустое → null
});
export const DisputeResponseRequest = z.strictObject({
  text: z.string().trim().min(DISPUTE_RESPONSE_MIN, { error: 'TOO_SHORT' })
    .max(DISPUTE_RESPONSE_MAX, { error: 'TOO_LONG' }).regex(MULTI_LINE, { error: 'INVALID' }),
});
const Decision = z.object({ outcome: tolerantEnum(DISPUTE_OUTCOMES),
  template: tolerantEnum(DISPUTE_DECISION_TEMPLATES), at: z.iso.datetime() });
export const MyDispute = z.object({                     // заявитель: без ответа участника (D-51)
  id: Uuid, raceId: Uuid, targetEntryId: Uuid, category: tolerantEnum(DISPUTE_CATEGORIES),
  description: z.string().nullable(), status: tolerantEnum(DISPUTE_STATUSES),
  filedAt: z.iso.datetime(), closedAt: z.iso.datetime().nullable(), decision: Decision.nullable(),
});
export const DisputeAgainstMe = z.object({              // цель: без заявителя и описания (D-51)
  id: Uuid, raceId: Uuid, category: tolerantEnum(DISPUTE_CATEGORIES), status: tolerantEnum(DISPUTE_STATUSES),
  filedAt: z.iso.datetime(), decidableBy: z.iso.datetime(),            // protocolPlannedAt
  response: z.object({ text: z.string(), at: z.iso.datetime() }).nullable(),
  canRespond: z.boolean(), decision: Decision.nullable(),
});
export const MyRaceDisputes = z.object({
  raceId: Uuid,
  filing: z.object({ status: tolerantEnum(DISPUTE_FILING_STATUSES), closesAt: z.iso.datetime(),
    protocolPlannedAt: z.iso.datetime(), reason: tolerantEnum(DISPUTE_FILE_BLOCKS).nullable() }),
  filed: z.array(MyDispute),          // новые сверху
  against: z.array(DisputeAgainstMe), // новые сверху
});
export const DisputeActionBlockedDetails = z.object({
  reason: tolerantEnum(DISPUTE_ACTION_BLOCKS), availableAt: z.iso.datetime().optional(),
});
```

**contracts — `disputes/disputes-admin.schema.ts`** (строгие `z.enum`)

```ts
export const DISPUTE_DECIDE_BLOCKS = ['too_early', 'not_open', 'protocol_published', 'cancelled'] as const;
export const DISPUTE_NOTE_MAX = 1000;
export const DisputeDecisionRequest = z.strictObject({
  outcome: z.enum(DISPUTE_OUTCOMES), template: z.enum(DISPUTE_DECISION_TEMPLATES),
  note: optionalText(DISPUTE_NOTE_MAX, MULTI_LINE).optional(),
}).superRefine((v, ctx) => { /* template ∈ DISPUTE_TEMPLATES_BY_OUTCOME[v.outcome], иначе issue path ['template'] */ });
export const PanelDisputeQuery = z.strictObject({
  ...PageQuery.shape, status: z.enum(DISPUTE_STATUSES).optional(), raceId: Uuid.optional(),
  cursor: PageCursor.optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const PanelDisputeListItem = z.object({
  id: Uuid, race: z.object({ id: Uuid, title: z.string() }), status: z.enum(DISPUTE_STATUSES),
  category: z.enum(DISPUTE_CATEGORIES), targetEntryId: Uuid, complainantEntryId: Uuid,
  filedAt: z.iso.datetime(), decidableAt: z.iso.datetime(), responded: z.boolean(),
});
export const PanelDisputePage = z.object({ items: z.array(PanelDisputeListItem), nextCursor: PageCursor.nullable() });
export const PanelDispute = PanelDisputeListItem.extend({
  description: z.string().nullable(),
  response: z.object({ text: z.string(), at: z.iso.datetime() }).nullable(),
  target: z.object({ entryId: Uuid, userId: Uuid, resultStatus: z.enum(RACE_RESULT_STATUSES),
    place: z.number().int().nullable(), tied: z.boolean(), elapsedSec: z.number().int().nullable() }),
  complainant: z.object({ entryId: Uuid, userId: Uuid }),
  decision: z.object({ outcome: z.enum(DISPUTE_OUTCOMES), template: z.enum(DISPUTE_DECISION_TEMPLATES),
    note: z.string().nullable(), actor: z.object({ userId: Uuid, displayName: z.string() }),
    at: z.iso.datetime() }).nullable(),
  events: z.array(z.object({ kind: z.enum(DISPUTE_EVENT_KINDS), actorKind: z.enum(['rider', 'staff']),
    at: z.iso.datetime() })),
  filingClosesAt: z.iso.datetime(), protocolPlannedAt: z.iso.datetime(),
  canDecide: z.boolean(), decideBlockedBy: z.enum(DISPUTE_DECIDE_BLOCKS).nullable(),
});
```

**contracts — прочее**

```ts
RACE_ENTRY_BLOCK_REASONS = [..., 'attempt_limit', 'dispute_open', 'disqualified'];
export const RaceEntryBlockedDetails = z.object({ reason: tolerantEnum(RACE_ENTRY_BLOCK_REASONS) }); // RACE_WITHDRAW_CLOSED, ATTEMPT_UPLOAD_CLOSED
RACE_EDIT_BLOCK_REASONS = [..., 'results_final', 'disputes_open'];
export const RaceInvalidStateDetails = z.object({ reason: z.enum(RACE_EDIT_BLOCK_REASONS) });      // панель
PERMISSIONS = [..., 'rides.moderate', 'disputes.read', 'disputes.decide'];
AUDIT_ACTIONS = [..., 'ride.reports_dismissed', 'disputes.decided']; AuditEntry.details += { disputeId: Uuid.optional() };
ErrorCode += 'DISPUTE_ACTION_BLOCKED', 'DISPUTE_NOT_FOUND';
```

**API — порты**

```ts
// results/result-dispute-gate.port.ts
export const RESULT_DISPUTE_GATE = Symbol('RESULT_DISPUTE_GATE');
export interface ResultDisputeGate {
  /** открытые споры против заявки (D-39); в транзакции вызывающего — после его lockEntry */
  openAgainst(entryId: string, session?: DbSession): Promise<number>;
  /** открытые споры гонки (чек-лист публикации) */
  openInRace(raceId: string, session?: DbSession): Promise<number>;
}
// results/results-for-disputes.port.ts
export const RESULTS_FOR_DISPUTES = Symbol('RESULTS_FOR_DISPUTES');
export interface DisputeEntry { id: string; raceId: string; userId: string; groupKey: ResultGroupKey;
  status: RaceEntryStatus; best: { elapsedSec: number; startedAt: Date } | null; disqualified: boolean }
export interface DisputeStanding { resultStatus: RaceResultStatus; place: number | null; tied: boolean;
  elapsedSec: number | null }
export interface ResultsForDisputes {
  entryOf(raceId: string, userId: string, session?: DbSession): Promise<DisputeEntry | null>;
  entry(entryId: string, session?: DbSession): Promise<DisputeEntry | null>;
  /** замок заявки (ResultsRepository.lockEntry) */
  lockEntry(tx: DbSession, entryId: string, now: Date): Promise<DisputeEntry | null>;
  /** D-43 до публикации: disqualified ← { at, disputeId } + race_recalculations { kind: 'disqualified',
   *  revision: null, reason: `dispute:${disputeId}` }; уже DQ или не активна — false, без записей */
  disqualify(tx: DbSession, input: { raceId: string; entryId: string; disputeId: string; actorUserId: string;
    at: Date }): Promise<boolean>;
  /** место/статус как в «моём участии» (ResultsReadService.entryResult), snapshot-сессия */
  standing(race: RaceForResults, entryId: string): Promise<DisputeStanding | null>;
}
// races/race-cancel-gate.port.ts
export const RACE_CANCEL_GATE = Symbol('RACE_CANCEL_GATE');
export interface RaceCancelGate {
  openDisputes(raceId: string, session?: DbSession): Promise<number>;
  openDisputesByRace(raceIds: readonly string[]): Promise<Map<string, number>>;
}
// RaceForResults += disputeFilingClosedAt: Date | null
```

**API — `results` (новое и изменённое)**

```ts
// ResultsRepository
private rankedFilter(raceId) // + disqualified: null
protocolBaseEntries(raceId: string, session: DbSession): Promise<RankedEntry[]>; // active + best, включая DQ, (elapsedSec, startedAt, _id)
disqualifyEntry(tx: DbSession, raceId: string, entryId: string, mark: { at: Date; disputeId: string }): Promise<boolean>;
  // updateOne({ _id, raceId, status: 'active', disqualified: null }, { $set: { disqualified: mark, updatedAt }, $inc: { version: 1 } })
disqualifiedEntries(raceId, session?) // сортировка { revision: 1, at: 1, _id: 1 }
// results.policy.ts
resultStatus(entry: Pick<RaceEntryDoc, 'status' | 'best' | 'summary' | 'disqualified'> | null, race, now, { ignoreBest })
entryActions(race, phase, entry: Pick<RaceEntryDoc, 'status' | 'summary' | 'disqualified'> | null, now,
  { openDisputes }: { openDisputes: number }): MyRaceEntry['actions'];
entryDisputeBlock(entry: Pick<RaceEntryDoc, 'disqualified'>, openDisputes: number,
  race: Pick<RaceForResults, 'protocolPublishedAt'>): 'disqualified' | 'dispute_open' | null;
// ResultsReadService
entryResult(race: RaceForResults, entry: RaceEntryDoc | null, now: Date, session: DbSession): Promise<Omit<MyRaceEntry['result'], 'group'>>;
// races.policy.ts
disputeFilingFreeze(current: Pick<RaceDoc, 'protocolPlannedAt' | 'disputeFilingClosedAt'>,
  nextPlannedAt: Date, now: Date): Date | null; // уже есть → оно; дата не меняется → null; now ≥ current − 24 ч → current − 24 ч
```

**API — `disputes`**

```ts
export const DISPUTES_COLLECTIONS = { disputes: 'disputes', events: 'dispute_events' } as const;
interface DisputeDoc { _id: string; raceId: string; groupKey: ResultGroupKey; complainantUserId: string;
  complainantEntryId: string; targetEntryId: string; targetUserId: string; category: DisputeCategory;
  description: string | null; status: DisputeStatus; response: { text: string; at: Date } | null;
  decision: { outcome: DisputeOutcome; template: DisputeDecisionTemplate; note: string | null;
    actorUserId: string; at: Date } | null;
  filedAt: Date; closedAt: Date | null; version: number; createdAt: Date; updatedAt: Date }
interface DisputeEventDoc { _id: string; disputeId: string; raceId: string; kind: DisputeEventKind;
  actor: { kind: 'rider' | 'staff'; userId: string }; at: Date;
  payload: { outcome?: DisputeOutcome; template?: DisputeDecisionTemplate } }
// DisputesRepository (переходы — фильтр status: 'open'; сторож RC-8)
insert(tx, doc: DisputeDoc): Promise<void>;                                  // insertOne
withdraw(tx, id, complainantUserId, now): Promise<DisputeDoc | null>;        // updateOne + findOne в tx
respond(tx, id, targetUserId, text, now): Promise<DisputeDoc | null>;        // + response: null в фильтре
decide(tx, id, decision, now): Promise<DisputeDoc | null>;                   // status ← outcome, closedAt
findById(id, session?); listFiledBy(raceId, userId); listAgainst(targetEntryId);
countOpenByComplainant(tx, raceId, userId); countOpenAgainst(entryId, session?); countOpenInRace(raceId, session?);
countOpenByRace(raceIds): Promise<Map<string, number>>;                      // aggregate $match/$group
page(query: { status?; raceId? }, after: { filedAt: Date; id: string } | null, limit): Promise<DisputeDoc[]>;
insertEvent(tx, doc: DisputeEventDoc): Promise<void>;                        // insertOne
events(disputeId): Promise<DisputeEventDoc[]>;                               // (at, _id)
// disputes.policy.ts
export const DISPUTES_POLICY = { filingLeadMs, decisionDelayMs, openLimit: DISPUTE_OPEN_LIMIT,
  userLimit: { limit: 20, windowSec: 3600 }, panelUserLimit: { limit: 60, windowSec: 3600 } } as const;
filingClosesAt(race: Pick<RaceForResults, 'protocolPlannedAt' | 'disputeFilingClosedAt'>): Date;
decidableAt(filedAt: Date): Date;
fileBlock(input: { race: RaceForResults; now: Date; complainant: DisputeEntry | null; openByComplainant: number }): DisputeFileBlock | null;
  // порядок: cancelled → protocol_published → not_entered → withdrawn → disqualified → no_counted_result → filing_closed → open_limit
filingStatus(block: DisputeFileBlock | null): DisputeFilingStatus;           // RC-10
targetBlock(complainant: DisputeEntry, target: DisputeEntry | null, raceId: string): 'own_result' | 'target_not_counted' | null;
decideBlock(dispute: Pick<DisputeDoc, 'status' | 'filedAt'>, race: RaceForResults, now: Date): DisputeDecideBlock | null;
```

**Миграция `0018_disputes`** — индексы и бэкфилл по §5.

### TESTS

**Unit**
- `disputes.policy.test.ts`:
  - `filingClosesAt` с и без `disputeFilingClosedAt`;
  - граница `now = closesAt` (закрыто);
  - `decidableAt` и граница 12 ч;
  - `fileBlock` — порядок причин;
  - `filingStatus` (open / closed для `filing_closed | protocol_published | open_limit` / unavailable);
  - `targetBlock` (своя, чужой гонки, без `best`, DQ, отменённая);
  - `decideBlock`.
- `disputes.repository.test.ts` — сторож RC-8 и AC11:
  - методы над `events` и `disputes` (§8.1 RC-8);
  - каждый `updateOne` с `status: 'open'` в фильтре (поддельная коллекция, как `ride-reports.repository.test.ts`);
  - `respond` — ещё и `response: null`;
  - имена коллекций знают только `disputes.collection.ts`, `disputes.repository.ts`, `0018_disputes.ts`.
- `results.policy.test.ts`:
  - `resultStatus` → `dq` и `ignoreBest` без `dq`;
  - `entryActions`: `dispute_open` (только когда действие было бы доступно), `disqualified`, закрытое окно — прежняя
    причина;
  - `entryDisputeBlock`.
- `races.policy.test.ts`: `raceEditable` + `disputes_open` (`canCancel: false`, в `final` — нет); `disputeFilingFreeze`
  — до отсечки `null`, после — `current − 24 ч`, повторный перенос сохраняет первое значение.
- `permissions.test.ts` (R1); контракты: enum и порядок, `strictObject`, `superRefine` шаблона, `optionalText` →
  `null`, длины, управляющие символы, `tolerantEnum` → `unknown`.

**Int (реальный MongoDB, стенд `apps/api/test`, изоляция `pokatim_06disputes_test` / своя Redis db)**
- `disputes.int.test.ts`:
  - AC1: 201, документ, событие `filed`, outbox без текста;
  - AC2 — каждая причина: своя заявка, цель без `best`, цель DQ, заявитель без `best` / отменил / DQ, после
    `filingClosesAt`, после публикации, отменённая гонка, повтор пары (и после отзыва), четвёртый открытый;
  - две параллельные подачи одной пары → одна 201, вторая `already_filed`;
  - AC3: форма `against` / `filed` (D-51, нет лишних ключей), посторонний — 404 на `withdraw` / `response`;
  - AC4: ответ один раз, `not_open`, отзыв только заявителем;
  - лимит `disputes-user` → 429;
  - RC-7: перенос `protocolPlannedAt` позже после отсечки → `filing.status: 'closed'`, подача `filing_closed`.
- `disputes-panel.int.test.ts`:
  - AC5: `too_early` + `availableAt`; `upheld` → `disqualified`, `dq` в «моём участии» (время есть, места нет), нет в
    таблице, места остальных пересчитаны, `race_recalculations` (`revision: null`, `dispute:<id>`); `rejected` — без
    изменений; событие, outbox, журнал `disputes.decided`; повтор — `not_open`;
  - два `upheld` против одной цели → одна запись журнала пересчётов;
  - AC6: 403 без `disputes.decide`, organizer 403 на список;
  - список: фильтр `status` / `raceId`, курсор;
  - AC8: чек-лист `open_disputes`, публикация с открытым — 409, после решения — снимок со строкой `dq` без места
    (RC-2);
  - после публикации «Отменить DQ» → строка с местом, `revised` (RC-3);
  - «Применить пересчёт» сохраняет `dq` (RC-2);
  - «Участники» до публикации — DQ в прочих со статусом `dq`.
- `disputes-locks.int.test.ts` (AC10, RC-17):
  1. **Подача ↔ отмена участия цели.** Ворота `gate()` на `DisputesRepository.prototype.countOpenByComplainant` (после
     `lockEntry` цели); параллельно `POST …/entry/withdraw` цели.
     - С замком: отмена повторяется (spy `ResultsRepository.prototype.lockEntryOf` ≥ 2, `untilBlocked`), после
       открытия ворот подача 201, отмена `409 RACE_WITHDRAW_CLOSED dispute_open`.
     - Без замка (`lockEntry` порта подменён чтением `entry`): обе 200/201, открытый спор против отменённой заявки.
       Тест краснеет по результату.
  2. **Подача ↔ публикация.** Плановая дата так, чтобы `uploadClosesAt ≤ now < filingClosesAt`; ворота после
     `lockResults` подачи; параллельно публикация.
     - С замком: публикация повторяется, затем `409 RESULTS_PUBLISH_BLOCKED` (`open_disputes: 1`).
     - Без замка (`RacesRepository.prototype.lockResults` подменён `findRace`): обе успешны — спор открыт при
       опубликованном протоколе.
  3. Решение ↔ решение: одно 200, другое `not_open`.
  4. Подача ↔ отмена гонки: побеждает одна, инварианты проверяются для обоих исходов.
  Итог отрицательных доказательств — в §12.
- `results-entries.int.test.ts` / `results-attempts.int.test.ts` (AC7):
  - `actions` с `dispute_open`;
  - `POST withdraw` / `attempts` (`activityId` и `uploadId`) → 409 `dispute_open`;
  - DQ → `disqualified` (RC-6);
  - после решения или отзыва — снова можно;
  - `syncGroup`: авто-активность при открытом споре попытки не создаёт и не снимает `not_primary` (RC-5);
    «загрузить в гонку», принятая до подачи, после `activity-ready` попытку создаёт.
- `races-admin.int.test.ts` (AC9): `editable.canCancel: false` и `disputes_open` в одиночной гонке и в списке;
  `POST cancel` → 409 `RACE_INVALID_STATE { reason: 'disputes_open' }`; после решения — отмена 200.
- `migrations.int.test.ts`: `0018` идемпотентна, индексы и бэкфилл на месте.
- `admin-routes.test.ts` — новый контроллер панели покрыт автоматически, проверить зелёный.

**RTL приложения (`apps/app`)**
- `__tests__/race-disputes.test.tsx`:
  - строки таблицы нажимаемы только по RC-14;
  - карточка соперника для `open` / `closed` (выключенное действие и причина M1) / моего спора (статус);
  - нет строки в кэше → «Результат не найден»;
  - форма: без категории «Отправить спор» выключено с причиной; описание > 2000 — ошибка поля; 409 по `reason`;
    успех → возврат и инвалидация;
  - блок «Споры»: мои (статусы, отзыв с подтверждением), по моему результату (баннер, «Ответить», «Ваш ответ
    отправлен», исход);
  - скелетон, ошибка с повтором, `unknown`-значения.
- `__tests__/race-participation.test.tsx`: тексты D-39 / DQ у загрузки и отмены; 409 `dispute_open` — текст по
  `details.reason`.
- `features/races/disputes/dispute-format.test.ts`; `__tests__/app-routes.ts` — новые маршруты, проверка гарда.

**RTL панели (`apps/admin`, `TZ=Europe/Minsk`)**
- `features/disputes/DisputesScreen.test.tsx`:
  - скелетон при видимом заголовке и фильтрах;
  - «Нет соединения» / «Не удалось загрузить» с повтором;
  - пусто;
  - `ChipGroup` статуса (по умолчанию «На рассмотрении»), `?raceId=`;
  - курсор;
  - пункт навигации скрыт без `disputes.read`.
- `features/disputes/DisputeScreen.test.tsx`:
  - разбор (заявитель ·xxxxxx, «Скрыт от участника», ответ или «Ответа нет», история);
  - решение: шаблоны по исходу, обязательный шаблон, заметка, `aria-disabled` + `DisabledReason` до `decidableAt`,
    подтверждение, 409 по `reason`, инвалидация;
  - решённый — исход, автор, время;
  - без `disputes.decide` панели решения нет.
- `RaceResultsScreen.test.tsx`: ссылка «Открыть споры» при `count > 0` и праве; история пересчётов с причиной
  `dispute:`.
- `RacesScreen.test.tsx` / RaceEditor: причина `disputes_open`, нет «Отменить гонку».

### ORDER (контрольные точки; после каждой — `pnpm typecheck` и тесты зоны)

1. **A — contracts / api-client / i18n.** Схемы и тесты контрактов, методы клиентов, ключи словаря. Панель и
   приложение компилируются: новые enum попадают в `Record`-карты — `AuditScreen`, `RaceEditor`, тоны.
2. **B — results / races: порты, DQ до публикации, D-39, D-19.**
   - Порты и токены (`ResultDisputeGate`, `ResultsForDisputes`, `RaceCancelGate`).
   - Минимальный `modules/disputes`: `disputes.collection.ts`, `DisputesRepository.count*`, `DisputeGates`,
     `@Global DisputesCoreModule` в `AppModule` и `WorkerModule` — без него приложение не стартует (RC-1).
   - `disqualified`, `rankedFilter`, `protocolBaseEntries` в `publish` / `applyRecheck`, `resultStatus` /
     `entryActions` / `entryResult`; D-39 в `withdraw` / `add` / `syncGroup`; чек-лист из гейта.
   - `races`: `disputeFilingClosedAt`, `raceEditable`, `cancel`, `present`.
   - Unit и int `results` / `races` по B — споры в тестах точки B вставляются напрямую в коллекцию через хелпер.
3. **C — модуль `disputes` и миграция.** Политика, репозиторий и сторож, сервисы, контроллеры, события,
   `ResultsForDisputesService.disqualify` / `standing`, права, журнал, `0018_disputes`. Int AC1–AC11 и отрицательные
   доказательства.
4. **D — приложение.** Запросы, карточка соперника, форма, ответ, блок «Споры», D-39 / DQ тексты, маршруты, RTL.
5. **E — панель.** Навигация, маршруты, `DisputesScreen` / `DisputeScreen` / `DecisionPanel`, ссылка чек-листа,
   `RecalculationsList`, `RaceEditor`, RTL.
6. **F — docs и gate.** §10, `pnpm check`, `pnpm --filter @pokatim/admin build`, по возможности `pnpm e2e:admin` (иначе
   `NOT VERIFIED`).

### OUT OF SCOPE

Как в §4. Дополнительно:
- ряды пульса и мощности, worker `dispute-series` — слайс 06b;
- маршрут outbox и потребитель событий `disputes.*` (`notifications`, A11); push или письмо цели о новом споре: цель
  узнаёт при открытии карточки гонки;
- отмена решения, повторное открытие спора, авто-закрытие других споров против DQ-цели (D-25);
- доступ организатора к спорам своей гонки (R1); при появлении — `findForPanel`;
- KPI «DQ» до публикации на экране «Результаты»;
- роль MongoDB без update/remove для `dispute_events` (follow-up, как у `panel_audit`);
- оживление авто-попыток замороженной группы после решения (RC-5) — райдер выбирает заезд явно.

# 12. Outcome

Coder, точки ORDER A, B, C (D — приложение, E — панель, F — docs: вне поручения).

**Коммиты**
- `0443100` A — контракты (`disputes/*.schema.ts`, enum `results` / `races` / `permissions` / `audit`, коды ошибок),
  api-client (приложение и панель), i18n (`disputes.*`, `admin.disputes.*`, `races.block.*`,
  `races.withdrawBlock.*`), тексты `error-messages`.
- `528b510` B — порты `ResultDisputeGate`, `ResultsForDisputes`, `RaceCancelGate`; `@Global DisputesCoreModule` в
  `AppModule` и `WorkerModule` (RC-1). Сюда же вошли:
  - DQ до публикации: `disqualified`, `rankedFilter`, `protocolBaseEntries` в `publish` / `applyRecheck`, `resultStatus`
    / `entryActions` / `entryDisputeBlock`, `entryResult`;
  - D-39 в `withdraw`, `add` и `syncGroup` (RC-5);
  - чек-лист из гейта;
  - `races.disputeFilingClosedAt` (RC-7), D-19 в `raceEditable`, `present` и `cancel`.
- `4b035b8` C — модуль `disputes`:
  - политика, репозиторий и сторож (RC-8, AC11), события;
  - `DisputesService` / `DisputesPanelService`, контроллеры;
  - `ResultsForDisputesService` (`disqualify`, `standing`);
  - права R1, `AuditDetailsDoc.disputeId`;
  - миграция `0018_disputes`;
  - int AC1–AC10.

**Тесты (новые)**
- Unit:
  - `disputes.policy.test.ts`, `disputes.repository.test.ts` (сторож);
  - `results.policy.test.ts` (dq, `entryDisputeBlock`, `entryActions` споров);
  - `races.policy.test.ts` (`disputes_open`, `disputeFilingFreeze`), `permissions.test.ts`;
  - контракты `disputes.schema.test.ts` и правки соседних, api-client `disputes.test.ts`.
- Int:
  - `disputes.int.test.ts` (14): AC1–AC4, лимит 429, RC-7;
  - `disputes-panel.int.test.ts` (9): AC5, AC6, AC8, RC-2, RC-3, список и курсор, идемпотентный DQ;
  - `disputes-locks.int.test.ts` (6): AC10 и отрицательные доказательства;
  - `results-disputes.int.test.ts` (9): AC7, RC-5, RC-6, RC-16, чек-лист;
  - `races-admin.int.test.ts` (+2): AC9, RC-7;
  - `migrations.int.test.ts` (+1): `0018` идемпотентна.

**Отрицательные доказательства (AC10, RC-17)** — `disputes-locks.int.test.ts`:
1. Подача ↔ отмена участия цели.
   - С `lockEntry` цели: отмена повторяется на замке (`lockEntryOf` ≥ 2), подача — 201, отмена —
     `409 RACE_WITHDRAW_CLOSED dispute_open`, заявка активна.
   - Без замка (`lockEntry` порта подменён чтением `entry`): отмена 200, подача 201, открытый спор против отменённой
     заявки.
2. Подача ↔ публикация.
   - С `lockResults` в подаче: публикация повторяется (`lockResults` ≥ 3 вызовов), подача — 201, публикация —
     `409 RESULTS_PUBLISH_BLOCKED` (`open_disputes: 1`).
   - Без замка (`RacesRepository.lockResults` → `findRace`): публикация 200, подача 201, спор открыт при опубликованном
     протоколе.
3. Решение ↔ решение: одно 200, другое `409 not_open`, одно событие `decided`.
4. Подача ↔ отмена гонки: побеждает одна. При отмене — `cancelled`, открытых споров 0; при подаче —
   `RACE_INVALID_STATE disputes_open`, гонка опубликована.

**Проверки** (изоляция `MONGO_URL_TEST=…/pokatim_06disputes_test`, `REDIS_URL_TEST=…:6479/8`)
- После A: typecheck всех пакетов (turbo, 8/8) зелёный; contracts 210, api-client 71, i18n 6, admin 189, app 838
  тестов зелёные.
- После B: `@pokatim/api` vitest — 860 тестов, одна правка ожидания прав admin в `panel-session.int`, затем зелёный;
  `tsc`, `eslint`, `arch:check` зелёные.
- После C: `@pokatim/api` vitest — 902 теста, две правки (ожидание прав moderator в `panel.guard.test`, уникальный
  индекс в тесте миграции), затем зелёный.
- Финал, первый прогон `TURBO_CONCURRENCY=1 pnpm check` — красный: `arch:check`, `disputes-locks.int.test.ts`
  импортировал `results/results.repository` в обход `index.ts`. Исправлено хелпером стенда
  `test/results.ts: resultsRepository(h)`.
- Финал, повторный прогон `TURBO_CONCURRENCY=1 pnpm check` — **EXIT 0** (7 мин 5 с):
  - format:check, lint, arch:check зелёные (`no dependency violations found`, 943 модуля); typecheck 8/8;
  - тесты 13/13: api 902 (92 файла), app 838 (95 наборов), admin 189, contracts 210, api-client 71, tracks 202,
    design-tokens 114, i18n 6.
- Не проверялось: `pnpm --filter @pokatim/admin build` и `pnpm e2e:admin` — точка F, вне поручения.
