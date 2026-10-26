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

### Модули и зависимости

```
results  ◄── disputes (ResultsForDisputes: заявки, замок заявки, DQ)      [порт results]
races    ◄── disputes (RaceRegistry.get/lockResults — гонка, фаза, срок)  [существующий порт races]
panel    ◄── disputes (PanelGuard, RequirePermission, PanelAudit)
results  ──► ResultDisputeGate (интерфейс в results, провайдер — disputes) [D-39, чек-лист]
races    ──► RaceCancelGate   (интерфейс в races,   провайдер — disputes) [D-19]
```

Циклов импортов нет: `disputes` импортирует `results`, `races`, `panel` через `index.ts`; `results` и `races`
определяют интерфейсы гейтов и токены, `disputes` регистрирует реализацию (инверсия, как предполагал эпик §3.7).
Без модуля `disputes` гейты возвращают 0 (необязательная инъекция) — тесты `results`/`races` без споров не меняются.

### Модель

- **Спор** — `disputes { _id, raceId, groupKey, complainantUserId, complainantEntryId, targetEntryId,
  targetUserId, category, description | null, status, response: { text, at } | null, decision: { outcome,
  template, note | null, actorUserId, at } | null, filedAt, closedAt | null, version, createdAt, updatedAt }`.
  Состояние — проекция; изменения статуса — фильтр `status: 'open'` + `$inc version`.
- **История** — `dispute_events { disputeId, raceId, kind: filed | responded | withdrawn | decided, actor: {
  kind: rider | staff, userId }, at, payload }` — только `insertOne` (сторож по исходнику репозитория).
- **Срок приёма** (D-44): `filingClosesAt = race.protocolPlannedAt − 24 ч`; приём закрыт навсегда при `now ≥
  filingClosesAt`, при опубликованном протоколе и при отменённой гонке (перенос плановой даты позже — V-11 —
  сдвигает срок: правило «не открывается снова» трактуется как «после наступления срока»; §8 R3).
- **Срок решения** (D-25): `decidableAt = filedAt + 12 ч`; раньше — `409 DISPUTE_ACTION_BLOCKED too_early` с
  `details.availableAt`.
- **Право подачи**: заявитель — активная заявка гонки с лучшим засчитанным результатом (`best`), без DQ; цель —
  другая активная заявка той же гонки и группы с `best`, без DQ; гонка `published`, протокол не опубликован, `now <
  filingClosesAt`; один спор на пару (заявитель, цель) за гонку — уникальный индекс `(raceId, complainantUserId,
  targetEntryId)` (повтор после отзыва — нельзя, `[ASSUMPTION]`); не больше 3 открытых споров заявителя в гонке
  (`open_limit`, `[ASSUMPTION]`).
- **DQ до публикации** (D-43) — `race_entries.disqualified { at, disputeId }`: `resultStatus` → `dq`, заявка вне
  мест (`rankedFilter` + `disqualified: null`), вне публичной таблицы; публикация строит строку со статусом `dq`;
  запись `race_recalculations { kind: 'disqualified', revision: null, entryId, reason: 'dispute:<id>' }` —
  единый источник «действующих DQ» (DV-13 слайса 05). Отмена DQ до публикации — нет; после публикации — «Отменить
  DQ» 05 (снимает и `disqualified` заявки — §7.6).

### Транзакции (`MongoTransactions.run`, колбэк без логов/очередей)

| Действие | Транзакция |
|---|---|
| Подать | `RaceRegistry.lockResults(raceId)` (конфликт с публикацией и отменой) → проверки гонки и срока → `ResultsForDisputes.lockEntry(target)` (конфликт с отменой участия и новой попыткой цели) → чтение заявителя и цели → лимиты → `insertOne disputes` → событие `filed` → outbox `disputes.dispute-filed` |
| Отозвать | спор `open` и заявитель — `updateOne({ status: 'open' })` → событие → outbox |
| Ответить | спор `open`, участник-цель, `response: null` → `updateOne` → событие → outbox |
| Решить | `lockResults` → не `final`, не отменена → `lockEntry(target)` → спор `open`, `now ≥ decidableAt` → `updateOne({ status: 'open' })` → при `upheld` — `ResultsForDisputes.disqualify(tx, …)` (заявка `disqualified`, `refreshEntry`, запись `race_recalculations`) → событие → outbox `disputes.dispute-decided` → `PanelAudit.append` |
| Отменить участие / явная попытка (results) | существующая транзакция под `lockEntry` + `ResultDisputeGate.openAgainst(tx, entryId) > 0` → отказ |
| Публикация (results) | чек-лист в той же транзакции: `open_disputes = ResultDisputeGate.openInRace(tx, raceId)` |
| Отмена гонки (races) | транзакция отмены + `RaceCancelGate.openDisputes(tx, raceId) > 0` → отказ (подача пишет документ гонки — конфликт) |

### Контракты и совместимость

Только добавления. Приложение: новые enum — `tolerantEnum` (старые сборки видят `unknown`), `dispute_open` в
причинах участия — уже `tolerantEnum`. Панель деплоится с API — строгие `z.enum`. Эндпоинты — новые; существующие
ответы получают только новые значения enum.

### Миграция `0018_disputes`

Expand-only, идемпотентна: `disputes` — unique `(raceId, complainantUserId, targetEntryId)`, `(raceId, status)`,
`(targetEntryId, status)`, `(complainantUserId, raceId)`, `(status, filedAt, _id)` (список панели);
`dispute_events` — `(disputeId, _id)`; `race_entries` — `updateMany({ disqualified: { $exists: false } }, { $set:
{ disqualified: null } })`. В `migrations/index.ts` — в конец.

# 5.1 Placement & Reuse Gate

- **Размещение:** новый модуль `apps/api/src/modules/disputes` (эпик §3.5, §3.7); правки `results` (порт, DQ до
  публикации, D-39, чек-лист), `races` (D-19 гейт), `panel` (права). Новых пакетов нет.
- **Переиспользуем:** `PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelAudit`, `PanelDirectory`
  (имя сотрудника-автора решения); `AuthGuard`/текущий пользователь приложения как в `race-entry.controller.ts`;
  `RaceRegistry.{get,lockResults,phase}`; `ResultsRepository.{lockEntry,refreshEntry,rankedFilter}`;
  `race_recalculations` и `buildProtocol` 05; `RateLimiter` (`consumeUserLimit`); `domainError`; outbox базы;
  образец модуля жалоб — `modules/rides` (`ride-reports.*`, `rides-moderation.*`). UI панели — `src/ui`
  (`PageHeader`, `DataTable`, `ChipGroup`, `Banner`, `StatusTag`, `DisabledReason`, `EmptyState`, `ErrorState`,
  `Button`), экран-образец `features/rides-moderation`. Приложение — `@rkarakulov/ui`, экран-образец жалобы райда
  05b, `participation/*`, `withdraw-confirm.tsx`.
- **Запрещённые дубли:** второй расчёт мест; чтение `race_entries`/`races` из `disputes` (только порты);
  update/delete в `dispute_events`; свой диалог причины вместо `ReasonDialog` там, где он подходит.
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

(architect)

# 8.2 Deviations from spec

- DV-1 (spec) **Размещение «Оспорить результат»:** слайс 04 отложил карточку соперника, строки анонимны (A12).
  Решение: строки таблицы результатов (кроме своей) нажимаемые и открывают модальный экран «карточка соперника»
  (место, «Участник», время, статус) с «Оспорить результат» и сроком — анатомия шита прототипа без имени, аватара и
  тренера. Отдельный экран, а не bottom sheet: одинаково на iOS/Android/web, deep link, без новой зависимости.
- DV-2 (spec) **Ряды пульса и мощности** вынесены в слайс 06b (эпик §7 — строка добавлена).

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

- `docs/adr/0012-race-results.md` — п. 7: споры append-only, решение = DQ, DQ до публикации; п. 8 — ряды в 06b.
- `docs/tasks/2026-10-27-race-results/epic.md` — §7: строка 06 уточнена, добавлен 06b (ряды биометрии).
- `.claude/rules/pokatim-db.md` — «Споры (race-results-06)»: коллекции, индексы, append-only, замки.
- `.claude/rules/pokatim-backend.md` — модуль `disputes`, гейты-провайдеры, события без маршрута.
- `.claude/rules/pokatim-security.md` — D-51, права, лимиты, логи без текста.
- `.claude/rules/pokatim-app.md` — карточка соперника, экран спора; `pokatim-web.md` — раздел «Споры».

# 11. Implementation Context

(architect)

# 12. Outcome

(coder)
