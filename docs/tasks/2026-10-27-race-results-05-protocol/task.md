# 1. Title

Результат гонки, слайс 05: протокол в панели. Раздел «Результаты» гонки в `apps/admin` (KPI, участники, попытки);
исключение трека и «Вернуть в обработку» до публикации (append-only, D-24), dead-letter → «Исключить трек»; чек-лист
и публикация протокола (D-22, D-23): `races.protocolPublishedAt`, фаза `final`, результаты `final`, снимок
`race_protocol_rows`, событие `results.protocol-published`; D-19 — отмена гонки недоступна при финальном результате;
экстренный пересчёт после публикации (D-27, D-28): DQ, отмена DQ, перепроверка по сохранённым трекам —
`race_recalculations` только вставками + событие `results.result-revised`.

# 2. Goal

Слайс 05 эпика `docs/tasks/2026-10-27-race-results/epic.md` (§3.4, §4, §7). Слайс 03 (PR #39, `develop` @ `0b152c0`)
дал заявки, попытки, проверку в worker, места при чтении и read-API панели. Здесь команда платформы получает рабочее
место протокола:

- видит сводку гонки, участников с местами и все попытки (включая скрытые и финальные провалы проверки);
- до публикации исключает ошибочный трек (причина обязательна, запись только добавлением) и возвращает исключённый в
  обработку; dead-letter (`failed`) снимается тем же «Исключить трек» — без «Повторить» (D-23);
- публикует протокол, когда чек-лист пуст; кнопка неактивна с причиной и количеством (D-23); «Требует внимания»
  не блокирует (D-22, флагов пока нет — слайс 07);
- после публикации время вручную не меняется: только экстренный пересчёт с причиной — DQ результата, отмена DQ,
  перепроверка гонки по сохранённым трекам; каждый пересчёт — новая ревизия снимка и событие для рейтинга (08).

Клиент присылает только намерение и причину; места, статусы, ревизии и чек-лист считает сервер (`AGENTS.md` §4.1).

Источники: `AGENTS.md` §1, §4; ADR-0009, 0010, 0012 (Proposed); эпик §3.4, §3.7, §4, §6–§8; task.md слайса 03
(§5, §7, §11); `.claude/rules/{pokatim-backend,pokatim-db,pokatim-contracts,pokatim-web,pokatim-security,
pokatim-tests}.md`; прототипы автора (конфиденциальны — только коды): «Панель — результаты и спор» (D-19, D-22, D-23,
D-24, D-27, D-28). Код сверен по `origin/develop` @ `0b152c0`.

# 3. Scope

**Contracts / api-client / i18n**
- `results.schema.ts` (только в конец): `ATTEMPT_STATUSES` + `excluded`; `RACE_RESULT_STATUSES` + `final`, `dq`,
  `revised`; `RACE_RESULTS_STATUSES` + `final` (публичная таблица после публикации).
- `results-admin.schema.ts`: расширение `PanelRaceResults` (фаза, срок загрузки, протокол, чек-лист); новые
  `PanelRaceStandings`, `PanelProtocolRecalculation(s)`, запросы действий с `ActionReason`; справочники
  `PUBLISH_CHECKS`, `PUBLISH_STATE_BLOCKS`, `RESULTS_ACTION_BLOCKS`, `RECALCULATION_KINDS`, `PROTOCOL_ROW_STATUSES`.
- `race.schema.ts`: `RACE_PHASES` + `final`; `RACE_EDIT_BLOCK_REASONS` + `results_final` (D-19).
- `permissions.schema.ts`: `PERMISSIONS` + `results.manage`, `results.revise`.
- `audit.schema.ts`: `AUDIT_ACTIONS` + 7 действий (§7.8); `AuditEntry.details` + `attemptId`, `entryId`, `revision`
  (необязательные).
- `common.ts`: коды `RESULTS_ACTION_BLOCKED`, `RESULTS_PUBLISH_BLOCKED` (в конец).
- `packages/api-client/src/admin.ts`: `getRaceStandings`, `excludeAttempt`, `restoreAttempt`, `recheckRaceResults`,
  `publishProtocol`, `disqualifyResult`, `revokeDisqualification`, `recheckProtocol`, `applyProtocolRecheck`,
  `listProtocolRecalculations`.
- `packages/i18n/src/ru.ts`: ключи панели «Результаты» своим блоком `admin.results.*`, `domain.racePhase.final`,
  `admin.races.reason.results_final`, действия журнала, статусы `excluded`/`final`/`dq`/`revised`, ошибки (§7.10).

**API — `races`**
- `RaceDoc.protocolPublishedAt: Date | null` (до `0016` — `?? null`), `RaceDoc.resultsVersion?: number`.
- `racePhase`: опубликованная с `protocolPublishedAt` — `final`. Поля фазы `final` — только `description`.
- D-19: `raceEditable` фазы `final` — `canCancel: false`, причины `window_closed`, `results_final`; `RacesService.cancel`
  и репозиторий — фильтр `protocolPublishedAt: null` (гонка «отмена ↔ публикация» — конфликт записи в документ гонки).
- Порт `RaceRegistry` + `lockResults(tx, raceId, now)` (замок результатов гонки: запись `resultsVersion` в документ
  гонки, первая операция транзакций действий панели), `markProtocolPublished(tx, raceId, at)`;
  `RaceForResults.protocolPublishedAt`.

**API — `tracks`**
- Порт `ActivitySource` + `countUnprocessed(userIds, from, before, tx?)` — загрузки участников в `queued|processing`,
  принятые в `[from, before)` (строка чек-листа «необработанные треки»).

**API — `results`**
- Коллекции `race_attempt_reviews` (исключения/возвраты), `race_protocol_rows` (снимок протокола по ревизиям),
  `race_recalculations` (пересчёты) — только `insertOne`/`insertMany`; миграция `0016_protocol`.
- Статус попытки `excluded`: исключение (до публикации) из `queued|checking|counted|rejected|failed`; возврат —
  новая `checkRevision`, `queued`, событие проверки. `summary.excluded`; результат с одними исключёнными —
  `not_counted`. Приём (`syncGroup`) исключённую не оживляет и не снимает; после публикации новых попыток не создаёт.
- Чек-лист публикации и публикация (§7.3–§7.4); экстренный пересчёт (§7.5); участники панели (§7.6);
  публичная таблица и «моё участие» после публикации — из снимка (§7.7).
- Контроллер `results-protocol.controller.ts` (мутации панели), чтение — расширение `results-admin.controller.ts`.
- Журнал `PanelAudit.append(tx, …)` в транзакции каждого действия; события outbox `results.protocol-published`,
  `results.result-revised` (подписчика пока нет — `standings`, слайс 08; издатель базы отмечает событие
  опубликованным).

**API — `panel`**: `ROLE_PERMISSIONS`: admin — всё; organizer + `results.manage` (свои гонки — видимость гонок
панели); moderator — без новых прав.

**Панель (`apps/admin`)**
- Маршрут `races/$raceId/results` → `RaceResultsScreen` (раздел «Результаты»), ссылка «Результаты» из шапки
  `RaceEditor` опубликованной гонки; `RacesScreen` — тон фазы `final`; `RaceEditor` — причина `results_final`.
- Экран: KPI, чек-лист и публикация, таблица участников (места, статусы, DQ/отмена DQ после публикации), таблица
  попыток с фильтром статуса (исключить / вернуть в обработку), перепроверка до публикации, пересчёт после
  публикации (запуск, применение, история). Все действия — `ReasonDialog` с обязательной причиной.

**Docs** — ADR-0012 п. 6–7 (уточнение), `pokatim-db.md`, `pokatim-backend.md`, `pokatim-web.md` (§10).

# 4. Out of Scope

- Споры (`disputes`, D-39, D-44, D-25, D-51, «Удовлетворить» = DQ) — слайс 06; строка чек-листа «открытые споры»
  есть и всегда `0`; причина D-19 «открытый спор» — 06.
- «Требует внимания» (FR-11), Verified/START, кластеры, места по кластеру — слайс 07.
- Рейтинг сезона и потребитель событий `protocol-published`/`result-revised` — слайс 08.
- UI приложения для `final`/`dq`/`revised` (приложение получает `tolerantEnum`; показ — слайс 04 или его follow-up).
- Имена райдеров в таблицах (A12): строки панели — `userId`/`entryId` (короткий id), имени нет.
- Автоматический запуск «пересчитать гонку» по смене версии движка; уведомления (A11).
- Исключение трека после публикации (только DQ результата целиком — D-27/D-28).

# 5. Architecture Context

### Модули и зависимости

```
panel  ◄── results (PanelGuard, RequirePermission, PanelAudit)
races  ◄── results (RaceRegistry: + lockResults, markProtocolPublished, protocolPublishedAt)
tracks ◄── results (ActivitySource: + countUnprocessed)
```

Циклов нет: `races` о `results` не знает; блокировка отмены D-19 — по собственному полю `protocolPublishedAt`, которое
`races` пишет по вызову порта. `RaceResultsGate` (споры) — слайс 06.

### Модель

- **Замок результатов гонки** — `RaceRegistry.lockResults(tx, raceId)`: `findOneAndUpdate({ _id, status: { $in:
  ['published', 'cancelled'] } }, { $inc: { resultsVersion: 1 } })` → гонка (отменённая — вызывающий отвечает
  `race_cancelled`; нет/черновик — 404; RC-7) — **первая** операция транзакций исключения, возврата, публикации,
  перепроверки и пересчётов. Две такие транзакции одной гонки конфликтуют (повтор `MongoTransactions.run`); с отменой
  и правкой гонки — тоже (запись в тот же документ). `version` гонки не меняется (открытая форма гонки не получает 409).
- **Исключение** — состояние попытки `excluded` + запись `race_attempt_reviews { kind: 'excluded' | 'restored',
  reason, actorUserId, at, attemptId, entryId, raceId }` (только вставка). Вердикт прежней ревизии остаётся в попытке
  (история), `checkRevision` не меняется: поздний вердикт исключённой — no-op (фильтр `status: 'checking'`).
- **Снимок протокола** — `race_protocol_rows`: строка на участника в ревизии `{ raceId, revision, order, entryId,
  userId, attemptId, elapsedSec, startedAt, place | null, tied, status: final | revised | dq, createdAt }`. Ревизия 1 —
  публикация; каждый пересчёт — новая ревизия целиком (старые не меняются). Текущая ревизия — максимальная `revision`
  записей `race_recalculations` гонки (не строк: протокол может быть пустым, RC-2); «протокол есть» —
  `protocolPublishedAt !== null`.
- **Пересчёты** — `race_recalculations { raceId, kind: published | disqualified | disqualification_revoked |
  recheck_started | recheck_applied, entryId | null, revision | null, reason, actorUserId, at }` (только вставка;
  уникальный частичный `(raceId, revision)` — журнал ревизий, RC-2). `recheck_started` пишется и до публикации
  (`revision: null`).
- **Незавершённые проверки** (RC-1) — `queued + checking +` вердикты `counted|rejected|failed` с `checkedAt <`
  последнего `recheck_started.at`: строка чек-листа `checks_queued` и условие «Применить» (`checks_pending`).
- `races.protocolPublishedAt` — момент публикации; фаза `final`.

### Транзакции (всё — `MongoTransactions.run`, колбэк без логов/очередей)

| Действие | Транзакция |
|---|---|
| Исключить попытку | `lockResults` → не `final` → `lockEntry` → `excludeAttempt` (фильтр статуса) → review → `refreshEntry` → audit |
| Вернуть в обработку | `lockResults` → не `final` → `lockEntry` → `requeueAttempt(statusIn: ['excluded'])` → `queueCheck` → review → `refreshEntry` → audit |
| Публикация | `lockResults` → `published`, не `final`, коридор → чек-лист в той же транзакции (пусто, иначе `RESULTS_PUBLISH_BLOCKED`) → строки из заявок (`ranked`) → `insertMany` ревизии 1 → recalculation `published` (rev 1) → `markProtocolPublished` → outbox `protocol-published` → audit |
| DQ / отмена DQ | `lockResults` → `final` → строки текущей ревизии → строка участника (не `dq` / `dq`) → новая ревизия (`buildProtocol`) → recalculation → outbox `result-revised` → audit |
| Перепроверка до публикации | `lockResults` → не `final` → recalculation `recheck_started` (`revision: null`) → outbox `results.race-recheck-requested { raceId, requestedAt }` → audit; worker (`results-intake`) → `ResultsRecheck.requestRace(raceId, requestedAt)` — транзакция на попытку под `lockEntry`, только вердикты с `checkedAt < requestedAt` (идемпотентно, RC-1) |
| Перепроверка после публикации | то же, но `final` |
| Применить перепроверку | `lockResults` → `final` → последний `recheck_started` после публикации новее `recheck_applied` (иначе `recheck_not_started`) → незавершённые проверки = 0 (иначе `checks_pending` с `count`) → строки из заявок с переносом DQ → новая ревизия → recalculation `recheck_applied` → outbox → audit |

Перепроверка — не атомарна по гонке (как в 03), но её незавершённость видна: пока цикл worker не перепоставил все
попытки с вердиктом старше запроса, они считаются «незавершёнными проверками» — публикация и «Применить» закрыты
(RC-1). Повтор задачи пропускает уже перепоставленные; повтор действия — новый `recheck_started`. Снимок не меняется
до «Применить».

События `results.protocol-published` / `results.result-revised` — без маршрута outbox: издатель базы берёт только
типы из маршрутов, события остаются `publishedAt: null` до слайса 08 (его маршрут заберёт накопленные; RC-4).

### Контракты и совместимость

- Только добавления. Приложение: `tolerantEnum` фазы, статусов попытки и результата — старые сборки видят `unknown`
  (нейтрально). Панель деплоится с API — строгие `z.enum`, карты текстов обновляются в этом PR.
- Новых эндпоинтов приложения нет; `GET /v1/races/:raceId/results` и `GET /v1/races/:raceId/entry` после публикации
  отдают данные снимка (`status: 'final'`).

### Миграция `0016_protocol`

Expand-only, идемпотентна: `race_attempt_reviews` (индексы `(raceId, _id)`, `(attemptId, _id)` — RC-10),
`race_protocol_rows` (unique `(raceId, revision, entryId)`, unique `(raceId, revision, order)`), `race_recalculations`
(`(raceId, _id)`, unique partial `(raceId, revision)` при `revision: { $type: 'number' }` — RC-2); `races.updateMany({
protocolPublishedAt: { $exists: false } }, { $set: { protocolPublishedAt: null } })`. В `migrations/index.ts` — в конец.

# 5.1 Placement & Reuse Gate

- **Размещение:** всё в существующих модулях `results` (действия, снимок, чек-лист), `races` (поле, фаза, D-19,
  порт), `tracks` (метод порта), `panel` (права). Новых модулей и пакетов нет.
- **Переиспользуем:** `PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelAudit` (`modules/panel/index.ts`);
  `ActionReason` (contracts, 3–500); `PanelDirectory.displayNames` (актёр истории пересчётов); `consumeUserLimit`
  (`entries.service.ts`); `ResultsRecheck.requestRace` (сигнатура + `requestedAt`), `AttemptIntake.queueCheck`,
  `ResultsRepository.{lockEntry, requeueAttempt, refreshEntry, rankedFilter}`, `rankRows`, `pickBest`, `summarize`;
  `raceVisible` (через `findForPanel`); `domainError`; UI — `src/ui` (`PageHeader`, `DataTable`, `ReasonDialog`,
  `Banner`, `StatusTag`, `ChipGroup`, `EmptyState`, `ErrorState`, `Button`, `DisabledReason`), `Can`/`useCan`,
  `src/format.ts`. Плитки KPI в `src/ui` нет — новый доменно-нейтральный `StatTile` (RC-9).
- **Запрещённые дубли:** второй расчёт мест (только `rankRows`); чтение `races`/`track_uploads` из `results` (порты);
  чек-лист на клиенте (только из `PanelRaceResults.publish`); update/delete в `race_attempt_reviews`,
  `race_protocol_rows`, `race_recalculations`; новый компонент диалога вместо `ReasonDialog`.
- **Новые зависимости npm:** нет.

# 6. Relevant Files

- `apps/api/src/modules/results/{results.collection,results.repository,results.policy,results-read.service,
  results-recheck,attempt-intake,results-admin.controller,results.events,results.module,index}.ts`.
- `apps/api/src/modules/races/{races.collection,races.policy,races.service,races.repository,race-registry.port,
  race-registry}.ts`.
- `apps/api/src/modules/tracks/{activity-source.port,activity-source,tracks.repository}.ts`.
- `apps/api/src/modules/panel/permissions.ts`; `apps/api/src/{error-messages,admin-routes.test}.ts`;
  `apps/api/src/db/migrations/{0015_results,index}.ts`.
- `packages/contracts/src/{common.ts,results/*,races/race.schema.ts,admin/{audit,permissions}.schema.ts}`;
  `packages/api-client/src/admin.ts`; `packages/i18n/src/ru.ts`.
- `apps/admin/src/{router.tsx,features/races/{RaceEditor,RacesScreen,RaceScreen}.tsx,features/audit/AuditScreen.tsx}`;
  тесты-образцы `apps/admin/src/features/races/RacesScreen.test.tsx`, `apps/api/src/modules/results/*.int.test.ts`,
  стенд `apps/api/test/{results,races,panel,harness}.ts`.

# 7. Implementation Notes

### 7.1 Эндпоинты панели (`PanelGuard`, `:raceId`/`:attemptId` — `Uuid` pipe; невидимая гонка — 404)

| Метод и путь | Право | Тело | Ответ |
|---|---|---|---|
| `GET /v1/admin/races/:raceId/results` | `races.read` | — | `PanelRaceResults` (расширен, §7.2) |
| `GET /v1/admin/races/:raceId/attempts` | `races.read` | как в 03 (`status` + `excluded`) | `PanelRaceAttemptPage` |
| `GET /v1/admin/races/:raceId/standings` | `races.read` | — | `PanelRaceStandings` (§7.6) |
| `GET /v1/admin/races/:raceId/protocol/recalculations` | `races.read` | — | `PanelProtocolRecalculations` (новые сверху, ≤ 100) |
| `POST /v1/admin/races/:raceId/attempts/:attemptId/exclude` | `results.manage` | `{ reason }` | `PanelRaceAttempt` |
| `POST /v1/admin/races/:raceId/attempts/:attemptId/restore` | `results.manage` | `{ reason }` | `PanelRaceAttempt` |
| `POST /v1/admin/races/:raceId/results/recheck` | `results.manage` | `{ reason }` | `PanelRaceResults` |
| `POST /v1/admin/races/:raceId/protocol` | `results.manage` | `{ reason }` | `PanelRaceResults` (публикация) |
| `POST /v1/admin/races/:raceId/protocol/disqualify` | `results.revise` | `{ entryId, reason }` | `PanelRaceResults` |
| `POST /v1/admin/races/:raceId/protocol/revoke-disqualification` | `results.revise` | `{ entryId, reason }` | `PanelRaceResults` |
| `POST /v1/admin/races/:raceId/protocol/recheck` | `results.revise` | `{ reason }` | `PanelRaceResults` |
| `POST /v1/admin/races/:raceId/protocol/apply-recheck` | `results.revise` | `{ reason }` | `PanelRaceResults` |

Тела — `z.strictObject` с `reason: ActionReason`. Мутации — лимит `RateLimiter` `results-panel-user` 60/ч на
сотрудника (`[ASSUMPTION]`). Попытка другой гонки — 404.

| Код | HTTP | Когда (`details.reason` — `ResultsActionBlock`) |
|---|---|---|
| `RESULTS_ACTION_BLOCKED` | 409 | `protocol_published` (исключение/возврат/перепроверка 03 после публикации), `protocol_not_published` (пересчёты до публикации), `race_cancelled`, `attempt_state` (статус попытки не подходит), `row_state` (нет строки участника в протоколе / уже DQ / не DQ), `checks_pending` (применить при `queued|checking` > 0), `recheck_not_started` |
| `RESULTS_PUBLISH_BLOCKED` | 409 | чек-лист не пуст или гонка не публикуема: `details: { checklist, blockedBy }` — как в `PanelRaceResults.publish` |

### 7.2 `PanelRaceResults` (дополнения к 03)

```ts
phase: RacePhase,                       // с `final`
uploadClosesAt: iso,                    // A5
protocol: { publishedAt: iso, revision: int, recheckPending: boolean } | null,
publish: {
  canPublish: boolean,
  blockedBy: 'cancelled' | 'no_corridor' | 'published' | null,   // PUBLISH_STATE_BLOCKS
  checklist: { code: PublishCheck, count: int }[],               // всегда все 5, в порядке PUBLISH_CHECKS
},
```

`PUBLISH_CHECKS = ['open_disputes', 'unprocessed_tracks', 'checks_queued', 'checks_failed', 'window_open']`:
- `open_disputes` — 0 (06 заполнит);
- `unprocessed_tracks` — `ActivitySource.countUnprocessed(userIds активных заявок, windowStartsAt, uploadClosesAt)`;
- `checks_queued` — попытки `queued + checking`;
- `checks_failed` — `failed` (dead-letter; снимаются «Исключить трек»);
- `window_open` — `1`, пока `now < uploadClosesAt` (окно + 24 ч на доставку — A5), иначе `0`.
`canPublish` = `blockedBy === null` и все `count === 0`. «Требует внимания» в чек-лист не входит (D-22).
`counts.excluded` появляется автоматически (`attempts` — `Record` по `ATTEMPT_STATUSES`). Чек-лист — чистая функция
`publishChecklist(...)` в `results.policy.ts`; одна функция для чтения и для транзакции публикации.

### 7.3 Исключение и возврат (D-24)

- Исключить: попытка гонки в `queued|checking|counted|rejected|failed` → `excluded` (условие статуса в фильтре
  записи; иначе `RESULTS_ACTION_BLOCKED: attempt_state`). Гонка не `final`, не отменена.
- Вернуть в обработку: `excluded` → `requeueAttempt(statusIn: ['excluded'])` (новая ревизия, вердикт стёрт) +
  `queueCheck`. Гонка не `final`.
- `summarize`: `excluded` — своё поле `summary.excluded`; `resultStatus`: `not_counted` при `rejectedShown + failed +
  excluded > 0`. `attemptHidden`: автоматическая с `matched === false` скрыта и в `excluded` (как в `rejected`).
- `syncGroup`/`ensureAttempt`: исключённая не оживает и не снимается `not_primary` (`withdrawAttempt` —
  `status: { $nin: ['withdrawn', 'excluded'] }` для `not_primary`; `activity_removed` снимает и исключённую).
- `ResultsRecheck.requestRace` исключённые не трогает (как сейчас: `statusIn` без `excluded`).

### 7.4 Публикация (D-22, D-23)

Условия: гонка `published`, коридор есть, не `final` (`blockedBy`), чек-лист пуст. Строки — активные заявки с
`best` (как `rankedFilter`), порядок `(elapsedSec, startedAt, entryId)`, места `rankRows`, статус `final`, ревизия 1.
После коммита — `protocolPublishedAt`, фаза `final`, событие `results.protocol-published { raceId, revision: 1 }`.
Приём попыток после публикации новых попыток не создаёт (`syncGroup`: `race.protocolPublishedAt !== null` → выход).
Остаточная гонка: событие `activity-ready` уже обработанной до публикации загрузки, принятое приёмом после чтения
гонки, — попытка появится в заявке, но не в снимке (снимок — единственный источник протокола). Принято: публикация
возможна только через 24 ч после окна (A5), приём к этому моменту давно завершён.

### 7.5 Экстренный пересчёт (D-27, D-28)

`buildProtocol(base, previous)` — чистая функция (`results.policy.ts`):
- `base` — строки `{ entryId, userId, attemptId, elapsedSec, startedAt, dq }`; не-DQ по `(elapsedSec, startedAt,
  entryId)`, места `rankRows`; DQ — в конце в том же порядке, `place: null`, `tied: false`.
- `previous` (строки прошлой ревизии по `entryId`, `null` при публикации): статус `dq` — DQ; нет прошлой —
  `final` при публикации, иначе `revised`; место, ничья и время те же, что в прошлой, и прошлая не `dq` — статус
  прошлой; иначе `revised` («Пересчитан»).
- DQ / отмена DQ: `base` — строки текущей ревизии (время не меняется), переключается `dq` одной строки.
- Применить перепроверку: `base` — заявки с `best` сейчас (новые вердикты), `dq` переносится из текущей ревизии.
  Участник без `best` после перепроверки выпадает из протокола (его результат — по заявке: `not_counted`).
  `failed` после перепроверки применение не блокирует (число показывается в панели перед подтверждением).
- Каждое действие — запись `race_recalculations` и событие `results.result-revised { raceId, revision, kind,
  entryId | null }` (`recheck_started` — без ревизии и без события).
- `protocol.recheckPending` — последний `recheck_started` новее последнего `recheck_applied`.

### 7.6 Участники панели — `PanelRaceStandings`

`{ source: 'live' | 'protocol', revision: int | null, truncated: boolean, items: PanelStandingRow[] }`, строка:
`entryId, userId, entryStatus, resultStatus (RACE_RESULT_STATUSES), place | null, tied, elapsedSec | null,
bestAttemptId | null, summary { total, pending, counted, rejectedShown, failed, excluded } `.
- До публикации (`live`): все заявки гонки (≤ 1000 — `standingsMax`, `[ASSUMPTION]`; больше — `truncated`), строки с
  местами — по порядку таблицы (`rankRows`), затем прочие по `createdAt`; `resultStatus` — `resultStatus()`.
- После (`protocol`): строки текущей ревизии (`place`, `status`) + прочие заявки (статус по заявке).
Одна snapshot-сессия на чтение.

### 7.7 Приложение после публикации

- `GET /v1/races/:raceId/results`: есть протокол — строки текущей ревизии без `dq`, по `order`, `status: 'final'`,
  курсор — `entryId` строки (позиция — её `order`); `ranked` — число строк без DQ; иначе — как в 03.
- `GET /v1/races/:raceId/entry`: строка участника в текущей ревизии → `result.status` = статус строки, место/время
  из строки (`dq` — `place: null`, время показывается); нет строки — как в 03.

### 7.8 Журнал и события

`AUDIT_ACTIONS` + `results.attempt_excluded`, `results.attempt_restored`, `results.recheck_requested`,
`results.protocol_published`, `results.result_disqualified`, `results.disqualification_revoked`,
`results.recalculation_applied` (перепроверка после публикации — `results.recheck_requested` с `revision`).
`subject: { kind: 'race', id, label: title }`, `reason`, `details: { attemptId?, entryId?, revision? }`. Без
`targetUserId` (райдер — не сотрудник панели). События outbox — `results.events.ts` (zod), без маршрута очереди.

### 7.9 Панель (`apps/admin`)

- `RaceResultsScreen` по маршруту `races/$raceId/results` (`RequirePermission races.read`): шапка — крошки «Гонки ›
  {название}», ссылка назад к форме; запросы — `raceQuery(raceId)` + новые `features/results/results-query.ts`.
- KPI (6 плиток): участники (`active`), в зачёте (`ranked`), на проверке (`queued + checking`), отказы
  (`rejected`), сбои проверки (`failed`), исключено (`excluded`).
- Блок «Публикация протокола»: список чек-листа (✓ / количество + текст причины); кнопка «Опубликовать протокол»
  (`results.manage`) — `aria-disabled` + `DisabledReason` с первой причиной; `ReasonDialog`. После публикации —
  `Banner` «Протокол опубликован {дата}, ревизия N»; с `results.revise` — «Перепроверить треки», «Применить пересчёт»
  (когда `recheckPending`, неактивна при `checks_queued` > 0), история пересчётов.
- «Участники»: `DataTable` (место «=2», участник — «Участник ·{последние 6 символов entryId}», время, статус
  результата, попытки); после публикации с `results.revise` — «Дисквалифицировать» / «Отменить DQ».
- «Попытки»: фильтр статуса (`ChipGroup`), колонки: создана, участник, источник, статус (+ «скрыта»), причина/сбой,
  время сегмента, версия движка; действия (`results.manage`, до публикации): «Исключить трек» (`queued…failed`),
  «Вернуть в обработку» (`excluded`). До публикации — «Перепроверить треки» (подсказка — `staleEngine`).
- Ошибки `RESULTS_ACTION_BLOCKED`/`RESULTS_PUBLISH_BLOCKED` — текст по `details.reason` в баннере, затем
  инвалидация запросов. `RaceEditor` опубликованной гонки — ссылка «Результаты»; `RacesScreen` — тон фазы `final`.

### 7.10 i18n (`packages/i18n/src/ru.ts`, `[ASSUMPTION copy]`, блок `admin.results.*` одним куском)

`domain.racePhase.final` «Протокол опубликован»; `admin.races.reason.results_final` «Протокол опубликован — отмена
гонки недоступна (D-19).»; статусы попытки и результата (`excluded` «Исключена», `final` «Финальный», `dq`
«Дисквалифицирован», `revised` «Пересчитан»); чек-лист (`admin.results.check.<code>`), блокировки
(`admin.results.blocked.<reason>`), действия и диалоги (заголовок, подсказка причины, кнопка), действия журнала
(`admin.audit.action.results.*`), KPI, колонки, пустые состояния, ошибки `RESULTS_*`.

### 7.11 Логи

Действия — `Logger.log` после коммита: `raceId`, действие, ревизия, число строк/попыток; без причины (свободный
текст) и без `userId` райдера.

# 8. Risks / Assumptions / Open Questions

- R1 `[ASSUMPTION]` права: `results.manage` — admin и organizer (свои гонки), `results.revise` — только admin;
  moderator — чтение. Автор может пересмотреть (разбор споров модератором — 06).
- R2 `[ASSUMPTION]` «необработанные треки» = загрузки участников в `queued|processing`, принятые в окне до срока
  загрузки (A5); посторонний заезд участника в обработке тоже блокирует — минуты, зависшие снимает `tracks`.
- R3 Перепроверка после публикации двухшаговая (запуск → «Применить пересчёт»): снимок не меняется, пока идут
  проверки; без автоматического применения.
- R4 Остаточная гонка «приём ↔ публикация» (§7.4) — принята с комментарием в коде.
- R5 Снимок ≤ ~1000 строк в транзакции публикации — в пределах лимитов транзакции MongoDB (16 МБ, 60 с).
- R6 Удаление заезда райдером после публикации меняет заявку, не снимок; войдёт в протокол только при «Применить
  пересчёт».

# 8.1 Requirements Consistency

Architect, сверено с кодом `develop` @ `0b152c0`. Ниже 14 находок, по каждой вынесено решение. Блокеров нет:
продуктовые значения (D-коды, права R1) не меняются, уточнена механика. Где решение меняет §3, §7 или §9, правка
записана здесь и имеет приоритет над исходным текстом (§3, §7, §9 architect не редактирует).

**RC-1 [HIGH, вредное решение] Перепроверка циклом в HTTP; «Применить» и публикация срабатывают посреди цикла.**
- Проблема. По §5 и §7.5 HTTP-обработчик после tx1 вызывает `ResultsRecheck.requestRace`: на каждую попытку своя
  транзакция, на гонку до тысяч. Это нарушает `backend.md` («HTTP-обработчик только ставит задачу»): долгий запрос,
  таймауты, а при обрыве цикл тихо останавливается. Проверка «Применить» (`queued|checking = 0`) и строка чек-листа
  `checks_queued` считают только уже перепоставленные попытки. Если цикл не дошёл до конца (воркер успевает проверять
  быстрее) или упал на середине, «Применить» и публикация проходят на смеси старых и новых вердиктов.
- Варианты.
  (a) Как в spec, плюс `lockResults` в каждой транзакции цикла. Публикацию посреди цикла это не закрывает.
  (b) Все попытки перепоставить одной транзакцией: упирается в лимиты транзакции и конфликтует с воркером.
  (c) **Рекомендация.** Запрос перепроверки — это одна транзакция: `lockResults`, запись `race_recalculations
  { kind: 'recheck_started', revision: null, at }`, outbox `results.race-recheck-requested { raceId, requestedAt }`,
  журнал. Событие идёт в `QUEUE.resultsIntake`, а `ResultsIntakeProcessor` вызывает
  `ResultsRecheck.requestRace(raceId, requestedAt)`. Цикл перепоставляет только попытки `counted|rejected|failed` с
  `checkedAt < requestedAt`, поэтому повтор задачи идемпотентен. **«Незавершённые проверки»** = `queued` + `checking` +
  **устаревшие вердикты** (`counted|rejected|failed` с `checkedAt <` момента последнего `recheck_started`). На этом
  одном счётчике стоят и `checks_queued` чек-листа до публикации, и `checks_pending` при «Применить». Пока цикл не
  дошёл до конца или задача упала, счётчик больше нуля: публикация и «Применить» заблокированы, панель показывает
  число. Повтор действия ставит новую `recheck_started`.
- Решение: (c). Запись `recheck_started` делается и до публикации (`revision: null`). В истории пересчётов панели
  видны все записи. Допущение: часы API и worker синхронны (NTP, один хост на dev); расхождение много меньше времени
  проверки.

**RC-2 [MEDIUM, недоопределённость] Текущая ревизия как `max(revision)` строк ломается на пустом протоколе.**
- Проблема. Если публикуется протокол без строк (0 засчитанных), ревизии 1 нет ни в одной строке. Следующий
  пересчёт снова вычислит ревизию 1, а `protocol.revision` и публичная таблица окажутся без опоры.
- Варианты: (a) хранить ревизию в документе гонки (данные `results` попадают в `races`); (b) отдельный изменяемый
  документ-заголовок; (c) **журнал ревизий в `race_recalculations`**.
- Решение: (c). Новый вид `published` (ревизия 1, пишется в транзакции публикации): `RECALCULATION_KINDS =
  ['published', 'disqualified', 'disqualification_revoked', 'recheck_started', 'recheck_applied']`. Уникальный
  частичный индекс `(raceId, revision)` при `revision: { $type: 'number' }`. Текущая ревизия — максимальная `revision`
  записей гонки. «Протокол есть» определяется по `race.protocolPublishedAt !== null`, а не по строкам. Публикация
  тоже требует причину (`ReasonDialog`), она попадает в эту запись.

**RC-3 [MEDIUM, противоречие в AC11] «Два DQ без замка — ревизия теряется» не воспроизводится детерминированно.**
- Проблема. Уникальный индекс `(raceId, revision, entryId)`, а теперь и `(raceId, revision)` (RC-2), не даёт молча
  потерять ревизию. Без замка исход недетерминирован: `WriteConflict` с повтором (оба DQ применены) или `E11000`
  (500). Тест «краснеет по результату» не получится.
- Решение. AC11 сводится к одному отрицательному доказательству: **исключение ↔ публикация** (п. 1, ворота `gate()`,
  `lockResults` подменён чтением). Для DQ остаются: положительный int «два одновременных DQ разных участников → оба
  200, ревизии N+1 и N+2, в N+2 оба `dq`, 2 записи и 2 события» и int на уникальный индекс `(raceId, revision)`.
  Поведение без замка coder записывает в §12 справочно.

**RC-4 [MEDIUM, факт кода] Издатель outbox не отмечает события без маршрута.**
- Проблема. `MongoOutboxPublisher.publishBatch` берёт только `type ∈ routes`. События `results.protocol-published`
  и `results.result-revised` без маршрута останутся `publishedAt: null`; текст §3 и §5 об этом неверен.
- Решение. Маршрут не добавляется. События лежат неопубликованными до слайса 08: его маршрут заберёт накопленное, и
  `standings` получит историю (это желательно). Объём ничтожный (единицы на гонку). §5 поправлен.

**RC-5 [MEDIUM, недоопределённость] После публикации заявка без строки протокола показывается «как в 03».**
- Проблема. «Как в 03» означает живое место (`countRankedLess`) и статус `provisional`. У заявки, получившей лучший
  результат после снимка (остаточная гонка R4/R6), выйдет живое место рядом с финальным протоколом.
- Решение. При `protocolPublishedAt !== null`:
  - «моё участие» без строки: `place: null`, `tied: false`, `elapsedSec: null`, статус — `resultStatus` с `best`,
    принудительно равным `null` (`pending | not_counted | dns | withdrawn | none`), `ranked` — число строк без `dq`
    текущей ревизии;
  - то же правило для «прочих заявок» в `PanelRaceStandings` (`source: 'protocol'`);
  - KPI «в зачёте» после публикации берётся из `protocol.ranked`.

**RC-6 [LOW, противоречие в тексте] Причина `window_closed` в фазе `final` вводит в заблуждение.**
- Проблема. Текст `admin.races.reason.window_closed` говорит «можно изменить описание и плановую дату протокола», а в
  фазе `final` меняется только описание.
- Решение. `raceEditable` фазы `final` возвращает `reasons: ['results_final']` (плюс `entries_locked`, если есть
  заявки), без `window_closed`. Текст `results_final`: «Протокол опубликован: можно изменить только описание; отмена
  гонки недоступна (D-19).» AC6 читать как «причины содержат `results_final`, не содержат `window_closed`».
  `RaceEditor`: в `editReasons` добавить `results_final`.

**RC-7 [LOW, недоопределённость] Черновик и отменённая гонка в замке и чек-листе.**
- Проблема. `findForPanel` отдаёт и черновики, а в `PUBLISH_STATE_BLOCKS` их нет. Замок с фильтром
  `status: 'published'` не отличает отменённую гонку от несуществующей, хотя §7.1 требует `race_cancelled`.
- Решение.
  - `PUBLISH_STATE_BLOCKS = ['draft', 'cancelled', 'no_corridor', 'published']`, первый подходящий — `blockedBy`.
  - `lockResults` берёт гонку с фильтром `status ∈ {published, cancelled}` и возвращает её; `null` → 404. Решение
    принимает вызывающий: отменена → `race_cancelled`. Мутации над черновиком → 404.

**RC-8 [LOW, недоопределённость] Код ошибки отмены гонки по D-19.**
- Решение. `RacesService.cancel` после чтения: `current.protocolPublishedAt` задан → `409 RACE_INVALID_STATE`, как
  остальные ошибки состояния. Защита в репозитории — `updateRace(…, guard?: { protocolPublishedAt: null })` в фильтре
  перехода `cancel`. Гонку «отмена ↔ публикация» закрывает конфликт записи (`lockResults` и
  `markProtocolPublished` пишут в документ гонки); фильтр нужен как второй рубеж.

**RC-9 [LOW, пробел reuse] В `src/ui` нет плитки KPI.**
- Варианты: (a) `ReadonlyField` в сетке, семантически это не метрика; (b) **новый `src/ui/StatTile.tsx`** (подпись +
  число, без доменных импортов, кандидат в admin-kit); (c) задача в app-foundation (блокирует слайс).
- Решение: (b). Тест рядом, размеры — токены / `panel-tokens.ts`, без px-литералов.

**RC-10 [LOW, пробел] Причина исключения в таблице попыток не видна.**
- Решение. `PanelRaceAttempt.review: { kind, reason, at } | null` — последняя запись `race_attempt_reviews` попытки
  (одна выборка на страницу, индекс `(attemptId, _id)`). Райдеру причина не уходит: в `MyAttempt` поля нет.

**RC-11 [LOW, пробел в Scope] Журнал в БД.**
- Решение. Поля `attemptId`, `entryId`, `revision` добавляются не только в контракт `AuditEntry.details`, но и в
  `AuditDetailsDoc` (`modules/panel/panel.collection.ts`). Литерал `summary` в `EntriesService.enter` получает
  `excluded: 0`. Старые заявки без `summary.excluded` читаются через `?? 0`.

**RC-12 [LOW, принятый риск] Приложение: строка карточки в фазе `final`.**
- `raceCardLine` (`apps/app/src/features/races/format.ts`, `default → null`): у гонки `final` пропадёт строка
  «Протокол — {дата}» / «Протокол ожидается». Регрессии нет: старые сборки видят `unknown` → без строки. Подпись
  «Протокол опубликован» — в слайс 04 / follow-up (UI приложения вне scope, §4). Код приложения не меняется.

**RC-13 [INFO, принятый риск] Остаточные гонки после публикации (дополнение R4).**
- Кроме приёма (`syncGroup`), после снимка в заявку может попасть:
  - явная попытка, чья транзакция взяла `now` до `uploadClosesAt` (окно в миллисекунды);
  - снятие по `activity-removed` (R6).
- Заявку это меняет, снимок — нет: протокол только из снимка (RC-5). В `ResultsRepository` и `AttemptIntake` нужен
  комментарий. Новых замков не требуется.

**RC-14 [INFO] Совместимость `racePhase = 'final'` и `excluded` проверена по коду.**
- `racePhase` (`races`, `RaceRegistry`, `races-public`):
  - `entryActions` / `attemptClosedReason` / `EntriesService`: `final` ≠ `upcoming|open` → `entries_closed`,
    `window_closed`, `upload_closed`;
  - публикация возможна только при `now ≥ uploadClosesAt`, поэтому `upload_closed` выполнено;
  - `publishedFields` / `corridorEditable` / `validateRaceRules`: `final` → `['description']`, коридор закрыт;
  - `RacesScreen.PHASE_TONE` (`Record<RacePhase>`) — ошибка typecheck, пока не добавлен `final` (ожидаемо, в scope);
  - `RaceEditor` (`phase === 'closed'` для подсказок) — у `final` подсказка общая, поле закрыто.
- `ATTEMPT_STATUSES + excluded`:
  - `PanelCounts.attempts` собирается по `ATTEMPT_STATUSES` (ключ появится сам);
  - `z.record(z.enum(...))` исчерпывающий: сервер заполняет все ключи;
  - `switch` по статусу попытки в приложении и панели нет;
  - в i18n нужны `races.attempt.status.excluded` и `races.result.status.{final,dq,revised}`, ключи приложения для 04;
  - фильтры воркера (`claimAttempt`, `recordCheck`, `failAttempt`, `stuckAttempts`) исключённую не трогают;
  - `liveAttemptsOfRace` исключённую возвращает, но `requeueAttempt(statusIn)` её отсекает. После RC-1 выборка
    `staleVerdictAttempts` её не включает.
- Права. `findForPanel` использует `ownScope` по `races.manage`, поэтому организатор с `results.manage` действует
  только в своих гонках. Роль с `results.manage` без `races.manage` (такой нет) видела бы все гонки — так и
  задокументировано.

# 8.2 Deviations from spec

(пока нет)

# 8.3 Security checklist

- AuthZ: каждый новый эндпоинт — `PanelGuard` + `RequirePermission`; видимость гонки — `findForPanel` (организатор
  — свои); попытка/участник — только этой гонки (иначе 404).
- Вход: `strictObject`, `ActionReason` (3–500, без управляющих), id — `Uuid`; значения фильтров — примитивы.
- Наружу: панель — `userId`/`entryId` без e-mail и биометрии; публичная таблица — как в 03 (без `userId`).
- Злоупотребления: лимит мутаций на сотрудника; повторная публикация — `blockedBy: published`.
- Логи: без причины и без `userId` райдера; аудит — append-only в транзакции действия.

# 9. Acceptance Criteria

- AC1 `GET …/results` отдаёт фазу, срок загрузки, протокол и чек-лист из 5 строк с количествами; `canPublish` —
  только при пустом чек-листе и `blockedBy: null`.
- AC2 Исключение до публикации: `excluded`, запись `race_attempt_reviews`, журнал с причиной; лучший результат и
  место пересчитаны; исключение `failed` снимает строку `checks_failed`.
- AC3 «Вернуть в обработку»: `excluded` → `queued` с новой `checkRevision` и событием проверки; вердикт старой
  ревизии — no-op.
- AC4 Исключение/возврат после публикации — `409 RESULTS_ACTION_BLOCKED protocol_published`; без
  `results.manage` — 403; чужая гонка организатора — 404.
- AC5 Публикация при непустом чек-листе — `409 RESULTS_PUBLISH_BLOCKED` с чек-листом; при пустом — фаза `final`,
  `protocolPublishedAt`, строки ревизии 1 со статусом `final` и местами «1, =2, =2, 4», событие
  `results.protocol-published`, запись журнала; повтор — `409` (`blockedBy: published`).
- AC6 D-19: у гонки `final` `editable.canCancel = false`, причины содержат `results_final`; `POST …/cancel` — 409;
  гонка «отмена ↔ публикация» — побеждает одна (int).
- AC7 DQ: новая ревизия, строка `dq` без места, места остальных пересчитаны, изменившиеся — `revised`, прочие —
  `final`; `race_recalculations` + `results.result-revised`; отмена DQ возвращает место (статус `revised`). Без
  `results.revise` — 403; до публикации — 409 `protocol_not_published`.
- AC8 Перепроверка после публикации: попытки — новые ревизии, снимок не меняется до «Применить»; «Применить» при
  `queued|checking` > 0 — 409 `checks_pending`; после — новая ревизия по свежим вердиктам с переносом DQ.
- AC9 Публичная таблица и «моё участие» после публикации — из текущей ревизии (`status: 'final'`, DQ — нет в таблице,
  у участника `result.status = 'dq'`).
- AC10 Append-only: `race_attempt_reviews`, `race_protocol_rows`, `race_recalculations` — только `insertOne`/
  `insertMany` (тест-сторож по исходнику репозитория, как `panel.repository.test.ts`).
- AC11 Отрицательные доказательства (int): без `lockResults` в транзакции исключения — исключение коммитится после
  чтения чек-листа публикации, протокол опубликован при непустом чек-листе / с исключённым лучшим результатом;
  два одновременных DQ без замка — одна ревизия теряется (уникальный индекс → ошибка вместо повтора).
- AC12 Панель: экран «Результаты» с KPI, чек-листом (неактивная кнопка с причиной и количеством), таблицами
  участников и попыток, диалогами с обязательной причиной; права скрывают действия; тесты RTL.
- AC13 `pnpm check` зелёный; миграция `0016_protocol` идемпотентна (`migrations.int.test.ts`).

# 10. Documentation Impact

- `docs/adr/0012-race-results.md` — п. 6–7: снимок по ревизиям, замок результатов гонки, двухшаговая перепроверка.
- `.claude/rules/pokatim-db.md` — раздел «Протокол (race-results-05)»: замок `lockResults`, append-only коллекции.
- `.claude/rules/pokatim-backend.md` — `results` (действия панели, события без маршрута до 08, перепроверка через
  worker и «незавершённые проверки»), `pokatim-web.md` — экран «Результаты» (`StatTile`, чек-лист, `ReasonDialog`).
- `.claude/rules/pokatim-security.md` — «Протокол (race-results-05)»: права `results.manage`/`results.revise`, лимит
  `results-panel-user`, причина исключения/DQ — только панели и журналу (не райдеру), логи без причины.
- `.claude/rules/pokatim-db.md` — также: журнал ревизий в `race_recalculations` (уникальный `(raceId, revision)`),
  D-19 — фильтр `protocolPublishedAt: null` при отмене; `pokatim-tests.md` — отрицательное доказательство
  `lockResults` (исключение ↔ публикация).
- `docs/tasks/2026-10-27-race-results/epic.md` — не меняется.

# 11. Implementation Context

Architect: Status **CONCERNS → решены в §8.1** (RC-1…RC-14). Блокеров нет. Пути — от корня репозитория.

### ENTRY POINTS

- HTTP панели: `apps/api/src/modules/results/results-protocol.controller.ts` (новый, мутации §7.1) и
  `results-admin.controller.ts` (чтение: `results`, `attempts`, `standings`, `protocol/recalculations`).
- HTTP приложения (без новых маршрутов): `results-public.controller.ts` и `race-entry.controller.ts` → ветки
  протокола в `ResultsReadService.publicResults` и `myEntry`.
- Worker: событие `results.race-recheck-requested` → `ResultsIntakeProcessor` → `ResultsRecheck.requestRace`.
- `races`: `RaceRegistry.lockResults` / `markProtocolPublished`; `RacesService.cancel` (D-19).
- Панель: маршрут `races/$raceId/results` в `apps/admin/src/router.tsx` → `features/results/RaceResultsScreen.tsx`.

### FILES TO MODIFY

**Contracts / клиенты / i18n**
- `packages/contracts/src/results/results.schema.ts`: `excluded`; `final | dq | revised`;
  `RACE_RESULTS_STATUSES + final`. Всё — в конец.
- `packages/contracts/src/results/results-admin.schema.ts`: справочники, `PublishChecklist`, расширение
  `PanelRaceResults` и `PanelRaceAttempt.review`, `PanelRaceStandings`, `PanelProtocolRecalculation(s)`, запросы,
  детали ошибок (см. TYPES).
- `packages/contracts/src/races/race.schema.ts`: `RACE_PHASES + 'final'`, `RACE_EDIT_BLOCK_REASONS + 'results_final'`.
- `packages/contracts/src/admin/permissions.schema.ts`: `+ 'results.manage', 'results.revise'`.
- `packages/contracts/src/admin/audit.schema.ts`: 7 действий; `details.{attemptId, entryId, revision}`.
- `packages/contracts/src/common.ts`: `'RESULTS_ACTION_BLOCKED', 'RESULTS_PUBLISH_BLOCKED'` в конец `ErrorCode`.
- Тесты контрактов: `results.schema.test.ts`, `race.schema.test.ts`, `audit.schema.test.ts` (порядок `AUDIT_ACTIONS`),
  `permissions.schema.test.ts`.
- `packages/api-client/src/admin.ts`: 10 методов §3 (тела — типы контрактов, ответы — схемы).
- `packages/i18n/src/ru.ts`:
  - блок `admin.results.*` (KPI, чек-лист `check.<code>`, `blockedBy.<code>`, `blocked.<reason>`, колонки, действия,
    диалоги, пустые состояния, `recalc.kind.<kind>`, `attemptStatus.<status>`, `resultStatus.<status>`,
    `rowStatus.<status>`);
  - `domain.racePhase.final`, `admin.races.reason.results_final` (текст RC-6);
  - `admin.audit.action.results.*` (7), `admin.nav`/ссылка «Результаты»;
  - ошибки `RESULTS_*`;
  - ключи приложения `races.attempt.status.excluded`, `races.result.status.{final,dq,revised}`.

**API — races**
- `races.collection.ts`: `RaceDoc.protocolPublishedAt: Date | null`, `resultsVersion?: number` (с комментариями,
  как у `lockedAt` и `entryAdmissions`).
- `races.policy.ts`:
  - `racePhase(race: Pick<RaceDoc, 'status'|'windowStartsAt'|'windowEndsAt'> & { protocolPublishedAt?: Date | null })`:
    `published` при `protocolPublishedAt != null` → `'final'`;
  - `publishedFields('final') = ['description']`;
  - `raceEditable` для `final`: `canCancel: false`, `reasons: ['results_final', …entries_locked]`.
- `races.repository.ts`: `lockResults`, `markProtocolPublished`; `updateRace(…, guard?)` (RC-8).
- `races.service.ts`: `create` → `protocolPublishedAt: null`; `cancel` → `RACE_INVALID_STATE` при
  `protocolPublishedAt` и `guard` в `transition`.
- `race-registry.port.ts` / `race-registry.ts`: `RaceForResults.protocolPublishedAt` (`toRace`: `?? null`), два метода
  порта.
- `index.ts`: экспорт без изменений (типы уже экспортируются).

**API — tracks**
- `activity-source.port.ts`, `activity-source.ts`: `countUnprocessed`.
- `tracks.repository.ts`: `countUnprocessedUploads(userIds, from, before, session?)`.

**API — results**
- `results.collection.ts`:
  - `EntrySummary.excluded`;
  - документы `RaceAttemptReviewDoc`, `RaceProtocolRowDoc`, `RaceRecalculationDoc`;
  - `RESULTS_COLLECTIONS += { reviews: 'race_attempt_reviews', protocolRows: 'race_protocol_rows', recalculations:
    'race_recalculations' }`.
- `results.policy.ts`:
  - `EXCLUDABLE_STATUSES`;
  - `summarize` (+ `excluded`), `resultStatus` (`excluded` → `not_counted`; параметр `ignoreBest` для RC-5),
    `attemptHidden` (`excluded` + auto + `matched === false`);
  - новые `publishChecklist`, `buildProtocol`, `recheckPending`.
- `results.repository.ts`: методы TYPES; `withdrawAttempt(…, reason)`: для `not_primary` фильтр
  `$nin: ['withdrawn', 'excluded']`; `panelCounts` без изменений логики.
- `attempt-intake.ts`:
  - `syncGroup`: `race.protocolPublishedAt !== null` → выход, с комментарием R4 / RC-13;
  - цикл `not_primary` не трогает `excluded`.
- `results-recheck.ts`: `requestRace(raceId, requestedAt)` по `staleVerdictAttempts`, в транзакции на попытку
  повторно проверяет `checkedAt < requestedAt` под `lockEntry`.
- `results-protocol.service.ts` (новый): `exclude`, `restore`, `requestRecheck`, `publish`, `disqualify`,
  `revokeDisqualification`, `requestProtocolRecheck`, `applyRecheck` (транзакции по §5, лимит `consumeUserLimit` из
  `entries.service.ts` с ключом `results-panel-user:<staffId>`, лог после коммита §7.11).
- `results-protocol.controller.ts` (новый): `@UseGuards(PanelGuard)`, `@RequirePermission`, пайпы `Uuid` и тел.
- `results-read.service.ts`:
  - `panelSummary` (фаза, срок, протокол, чек-лист);
  - `panelAttempts` (`review`), `panelStandings`, `panelRecalculations`;
  - ветки протокола в `publicResults` / `myEntry` (RC-5).
  - Выше ~450 строк — панельные чтения в `results-panel-read.service.ts`.
- `results-admin.controller.ts`: `GET standings`, `GET protocol/recalculations`.
- `results.events.ts`:
  - `RESULTS_PROTOCOL_PUBLISHED`, `RESULTS_RESULT_REVISED` — zod, **без маршрута** (RC-4);
  - `RESULTS_RACE_RECHECK_REQUESTED { raceId, requestedAt }` → `QUEUE.resultsIntake`.
- `results-intake.processor.ts`: ветка `RESULTS_RACE_RECHECK_REQUESTED` (инжект `ResultsRecheck`).
- `results.module.ts`: `ResultsProtocolService`, `ResultsProtocolController`, `RateLimiter` уже доступен (как у
  `AttemptsService`).
- `entries.service.ts`: литерал `summary.excluded: 0`.

**API — panel / прочее**
- `modules/panel/permissions.ts` (+ `permissions.test.ts`): organizer + `results.manage`; admin — всё; moderator без
  изменений.
- `modules/panel/panel.collection.ts`: `AuditDetailsDoc.{attemptId?, entryId?, revision?}`.
- `apps/api/src/error-messages.ts`: тексты `RESULTS_*`.
- `apps/api/src/db/migrations/0016_protocol.ts` (новый) + `index.ts` (в конец).
- `apps/api/test/results.ts` / `races.ts`: хелперы публикации и DQ, `protocolPublishedAt: null` во вставках
  `RaceDoc`, если они есть.

**Панель (`apps/admin`)**
- `src/router.tsx`: `raceResultsRoute` (`races/$raceId/results`, `RequirePermission races.read`).
- `src/features/results/{RaceResultsScreen,PublishBlock,StandingsTable,AttemptsTable,RecalculationsList}.tsx`,
  `results-query.ts` (ключи `['admin','races','item',id,'results'|'standings'|'attempts'|'recalculations']` — под
  `RACES_QUERY_KEY`: инвалидация гонки обновляет и результаты), `results-errors.ts` (текст по `details.reason`).
- `src/ui/StatTile.tsx` + экспорт в `src/ui/index.ts` + тест (RC-9).
- `src/features/races/RaceEditor.tsx`: ссылка «Результаты» (published/cancelled), `editReasons` +
  `results_final`.
- `src/features/races/RacesScreen.tsx`: `PHASE_TONE.final = 'success'`.
- `src/navigation.ts` не меняется: раздел внутри гонки, а не пункт меню.

**Docs** — по §10.

### FILES TO READ (образцы)

- Замки и отрицательные доказательства: `apps/api/src/modules/races/races.repository.ts` (`admitEntry`),
  `apps/api/src/modules/panel/panel-races.int.test.ts` (`gate`, `untilBlocked`),
  `apps/api/src/modules/results/results-entries.int.test.ts` (`admitEntry` без записи), `apps/api/test/identity.ts`
  (`gate`, `holdTransaction`).
- Сторож append-only: `apps/api/src/modules/panel/panel.repository.test.ts`.
- Журнал в транзакции действия: `apps/api/src/modules/races/races.service.ts` (`transition`),
  `modules/calendar/calendar.service.ts` (причина `ActionReason`).
- Стенд результатов: `apps/api/test/results.ts` (`rideGpx`, `resultsWorker`, `AttemptCheckProcessor.check`),
  `results-read.int.test.ts`, `results-check.int.test.ts`.
- Outbox: `node_modules/@rkarakulov/api-kit/dist/mongo/outbox/outbox.publisher.js` (RC-4).
- Панель: `apps/admin/src/features/races/{RaceScreen,RaceEditor,RacesScreen}.tsx`, `RacesScreen.test.tsx`,
  `src/ui/{ReasonDialog,DataTable,ChipGroup,layout-parts}.tsx`, `src/test/app.tsx`, `src/session/errors.ts`.

### TYPES & SCHEMAS

**contracts — `results-admin.schema.ts`** (строгие `z.enum`; `ActionReason` — из `../admin/members.schema.ts`; `RacePhase`
— из `../races/race.schema.ts`)

```ts
export const PUBLISH_CHECKS = ['open_disputes', 'unprocessed_tracks', 'checks_queued', 'checks_failed', 'window_open'] as const;
export const PUBLISH_STATE_BLOCKS = ['draft', 'cancelled', 'no_corridor', 'published'] as const;      // RC-7
export const RESULTS_ACTION_BLOCKS = ['protocol_published', 'protocol_not_published', 'race_cancelled',
  'attempt_state', 'row_state', 'checks_pending', 'recheck_not_started'] as const;
export const RECALCULATION_KINDS = ['published', 'disqualified', 'disqualification_revoked',
  'recheck_started', 'recheck_applied'] as const;                                                    // RC-2
export const PROTOCOL_ROW_STATUSES = ['final', 'revised', 'dq'] as const;
export const ATTEMPT_REVIEW_KINDS = ['excluded', 'restored'] as const;

export const PublishChecklist = z.object({
  canPublish: z.boolean(),
  blockedBy: z.enum(PUBLISH_STATE_BLOCKS).nullable(),
  checklist: z.array(z.object({ code: z.enum(PUBLISH_CHECKS), count: z.number().int() })), // все 5, порядок PUBLISH_CHECKS
});
// PanelRaceResults — к полям 03:
//   phase: RacePhase, uploadClosesAt: z.iso.datetime(),
//   protocol: z.object({ publishedAt: iso, revision: int, ranked: int, disqualified: int,
//     recheckPending: z.boolean() }).nullable(),   // recheckPending — последний recheck_started после публикации новее recheck_applied
//   recheck: z.object({ startedAt: iso, pending: z.number().int() }).nullable(),
//     // последний recheck_started (до или после публикации); pending — «незавершённые проверки» RC-1
//   publish: PublishChecklist,
// PanelRaceAttempt — + review: z.object({ kind: z.enum(ATTEMPT_REVIEW_KINDS), reason: z.string(), at: iso }).nullable()  // RC-10
// PanelRaceAttemptQuery.status — z.enum(ATTEMPT_STATUSES) уже включает excluded

export const PanelStandingRow = z.object({
  entryId: Uuid, userId: Uuid, entryStatus: z.enum(RACE_ENTRY_STATUSES),
  resultStatus: z.enum(RACE_RESULT_STATUSES), place: z.number().int().nullable(), tied: z.boolean(),
  elapsedSec: z.number().int().nullable(), bestAttemptId: Uuid.nullable(),
  summary: z.object({ total: int, pending: int, counted: int, rejectedShown: int, failed: int, excluded: int }),
});
export const PanelRaceStandings = z.object({
  source: z.enum(['live', 'protocol']), revision: z.number().int().nullable(),
  truncated: z.boolean(), items: z.array(PanelStandingRow),
});
export const PanelProtocolRecalculation = z.object({
  id: Uuid, kind: z.enum(RECALCULATION_KINDS), entryId: Uuid.nullable(), revision: z.number().int().nullable(),
  reason: z.string(), actor: z.object({ userId: Uuid, displayName: z.string() }), at: z.iso.datetime(),
});
export const PanelProtocolRecalculations = z.object({ items: z.array(PanelProtocolRecalculation) }); // новые сверху, ≤ 100
export const ResultsActionRequest = z.strictObject({ reason: ActionReason });
export const ProtocolEntryActionRequest = z.strictObject({ entryId: Uuid, reason: ActionReason });
export const ResultsActionBlockedDetails = z.object({ reason: z.enum(RESULTS_ACTION_BLOCKS), count: z.number().int().optional() });
export const ResultsPublishBlockedDetails = PublishChecklist.pick({ blockedBy: true, checklist: true });
```

`checks_queued` = «незавершённые проверки» RC-1 (`queued + checking + stale`), `checks_failed` = `failed`. KPI «на
проверке» = `counts.attempts.queued + checking` (03); `recheck.pending` показывается отдельно.

**contracts — прочее**

```ts
RACE_PHASES = [...,'cancelled','final']; RACE_EDIT_BLOCK_REASONS = [...,'entries_locked','results_final'];
PERMISSIONS = [...,'calendar.manage','results.manage','results.revise'];
AUDIT_ACTIONS += 'results.attempt_excluded','results.attempt_restored','results.recheck_requested',
  'results.protocol_published','results.result_disqualified','results.disqualification_revoked','results.recalculation_applied';
AuditEntry.details += { attemptId: Uuid.optional(), entryId: Uuid.optional(), revision: z.number().int().optional() };
```

**API — документы `results`**

```ts
interface EntrySummary { total; pending; counted; rejectedShown; failed; excluded: number }  // старые — `?? 0`
interface RaceAttemptReviewDoc { _id: string; raceId: string; entryId: string; attemptId: string;
  kind: 'excluded' | 'restored'; reason: string; actorUserId: string; at: Date }
interface RaceProtocolRowDoc { _id: string; raceId: string; revision: number; order: number; entryId: string;
  userId: string; attemptId: string; elapsedSec: number; startedAt: Date; place: number | null; tied: boolean;
  status: ProtocolRowStatus; createdAt: Date }
interface RaceRecalculationDoc { _id: string; raceId: string; kind: RecalculationKind; entryId: string | null;
  revision: number | null; reason: string; actorUserId: string; at: Date }
```

**API — порты**

```ts
// RaceRegistry (races)
/** Замок результатов: findOneAndUpdate({ _id, status: { $in: ['published','cancelled'] } }, { $inc: { resultsVersion: 1 } }),
 *  без version/updatedAt; первая операция транзакций действий §5. null — нет/черновик. */
lockResults(tx: DbSession, raceId: string): Promise<RaceForResults | null>;
/** { _id, status: 'published', protocolPublishedAt: null } → $set { protocolPublishedAt: at }; false — не совпало. */
markProtocolPublished(tx: DbSession, raceId: string, at: Date): Promise<boolean>;
// RaceForResults + protocolPublishedAt: Date | null
// ActivitySource (tracks)
/** Загрузки пользователей в queued|processing с createdAt ∈ [from, before); userIds ≤ числа активных заявок. */
countUnprocessed(userIds: readonly string[], from: Date, before: Date, tx?: DbSession): Promise<number>;
```

**API — `ResultsRepository` (новое; все записи — под замками §5)**

```ts
excludeAttempt(tx, raceId: string, attemptId: string, now: Date): Promise<RaceAttemptDoc | null>; // фильтр { _id, raceId, status ∈ EXCLUDABLE }
withdrawAttempt(tx, id, reason, now)                               // not_primary: status $nin ['withdrawn','excluded']
insertReview(tx, doc: RaceAttemptReviewDoc): Promise<void>;        // insertOne
latestReviews(attemptIds: readonly string[]): Promise<Map<string, RaceAttemptReviewDoc>>;
activeEntryUserIds(raceId, session?): Promise<string[]>;
pendingChecks(raceId, staleBefore: Date | null, session?): Promise<{ queued: number; checking: number; stale: number; failed: number }>;
staleVerdictAttempts(raceId, before: Date): Promise<Pick<RaceAttemptDoc, '_id' | 'entryId'>[]>; // counted|rejected|failed, checkedAt < before
rankedEntries(raceId, session): Promise<RankedEntry[]>;            // rankedFilter, сортировка (elapsedSec, startedAt, _id)
entriesForStandings(raceId, limit, session): Promise<RaceEntryDoc[]>;
insertProtocolRows(tx, rows: RaceProtocolRowDoc[]): Promise<void>; // insertMany
protocolRows(raceId, revision, session?): Promise<RaceProtocolRowDoc[]>;
protocolRow(raceId, revision, entryId, session?): Promise<RaceProtocolRowDoc | undefined>;
protocolRowsPage(raceId, revision, afterOrder: number | null, limit, session): Promise<RaceProtocolRowDoc[]>; // status ≠ dq, order asc
countProtocolRows(raceId, revision, session?): Promise<{ ranked: number; disqualified: number }>;
insertRecalculation(tx, doc: RaceRecalculationDoc): Promise<void>; // insertOne
currentRevision(raceId, session?): Promise<number | null>;         // max revision в race_recalculations
lastRecheck(raceId, session?): Promise<{ startedAt: Date | null; appliedAt: Date | null }>;
listRecalculations(raceId, limit): Promise<RaceRecalculationDoc[]>;
```

**API — политика (`results.policy.ts`, чистые функции)**

```ts
export const EXCLUDABLE_STATUSES = ['queued', 'checking', 'counted', 'rejected', 'failed'] as const;
export function publishChecklist(input: {
  race: Pick<RaceForResults, 'status' | 'corridor' | 'protocolPublishedAt'>; now: Date; uploadClosesAt: Date;
  openDisputes: number; unprocessedTracks: number; pendingChecks: number; failedChecks: number;
}): PublishChecklist;
export interface ProtocolBase { entryId: string; userId: string; attemptId: string; elapsedSec: number; startedAt: Date; dq: boolean }
export function buildProtocol(base: readonly ProtocolBase[],
  previous: ReadonlyMap<string, Pick<RaceProtocolRowDoc, 'place' | 'tied' | 'elapsedSec' | 'status'>> | null,
): Omit<RaceProtocolRowDoc, '_id' | 'raceId' | 'revision' | 'createdAt'>[];  // order 0..n-1; места — rankRows({lessThanFirst:0, firstIndex:0, equalCounts: full})
```

**Миграция `0016_protocol`**: `ensureCollection` × 3; индексы:
- `race_attempt_reviews_race_idx (raceId, _id)`, `race_attempt_reviews_attempt_idx (attemptId, _id)`;
- `race_protocol_rows_unique (raceId, revision, entryId)`, `race_protocol_rows_order_unique (raceId, revision, order)`;
- `race_recalculations_race_idx (raceId, _id)`, `race_recalculations_revision_unique (raceId, revision)` partial
  `{ revision: { $type: 'number' } }`;
- `races.updateMany({ protocolPublishedAt: { $exists: false } }, { $set: { protocolPublishedAt: null } })`.

### TESTS

**Unit**
- `results.policy.test.ts`:
  - `summarize` / `resultStatus` (`excluded`, `ignoreBest`), `attemptHidden(excluded)`;
  - `publishChecklist`: все 5 строк в порядке; `blockedBy` по приоритету `draft > cancelled > no_corridor >
    published`; `canPublish`; `window_open` на границе `uploadClosesAt`;
  - `buildProtocol`: публикация «1, =2, =2, 4» `final`; DQ в конце `place: null`; изменились места → `revised`,
    прочие — статус прошлой; отмена DQ → `revised`; выпавший участник; детерминизм порядка `(elapsedSec,
    startedAt, entryId)`;
  - `recheckPending`.
- `races.policy.test.ts`: `racePhase` → `final` (и `cancelled` важнее); `publishedFields('final')`; `raceEditable`
  `final` (RC-6); `validateRaceRules`: `protocolPlannedAt` в `final` → `FIELD_LOCKED`.
- Сторож append-only `results.repository.test.ts` (по образцу `panel.repository.test.ts`): над `reviews`,
  `protocolRows`, `recalculations` в `ResultsRepository` — только `insertOne`, `insertMany`, `find`, `findOne`,
  `countDocuments`, `aggregate`. Имена коллекций знают только `results.collection.ts`, `results.repository.ts`,
  `0016_protocol.ts`.
- `permissions.test.ts` (матрица R1), контракты (новые enum, порядок, `strictObject`, `ActionReason`).

**Int (реальный MongoDB, стенд `apps/api/test`)**
- `results-protocol.int.test.ts`:
  - AC1 сводка и чек-лист (каждая строка не ноль по своей причине, включая `unprocessed_tracks` через загрузку в
    `processing` и `checks_queued` по устаревшим вердиктам после `recheck_started`);
  - AC2, AC3: исключение и возврат, `race_attempt_reviews`, журнал, `best`, `checks_failed`, поздний вердикт старой
    ревизии — no-op;
  - AC4: 409 / 403 / 404, включая чужую гонку организатора и попытку другой гонки;
  - AC5: публикация «1, =2, =2, 4», событие в `outbox` без публикации маршрута, `race_recalculations.published`,
    повтор — `blockedBy: published`, пустой протокол (RC-2);
  - AC6: `editable`, `POST cancel` → 409, гонка «отмена ↔ публикация» (ворота на чтении чек-листа: побеждает одна,
    обе проверки инварианта);
  - `syncGroup` после публикации не создаёт попыток.
- `results-revisions.int.test.ts`:
  - AC7: DQ и отмена DQ, 403 без `results.revise`, 409 до публикации, `row_state`;
  - два одновременных DQ (RC-3, оба применены);
  - AC8: перепроверка → событие → `requestRace` через `resultsWorker`, снимок неизменен, «Применить» при
    незавершённых (включая непройденный цикл: задача не выполнена) → 409 `checks_pending`, после — новая ревизия с
    переносом DQ;
  - `recheck_not_started`;
  - повтор задачи `race-recheck-requested` идемпотентен.
- `results-read.int.test.ts` (дополнение): AC9 — публичная таблица и «моё участие» из ревизии, DQ не в таблице, у
  участника `dq`, курсор строки DQ → 400; RC-5 — заявка без строки после публикации: `place: null`, не
  `provisional`.
- **Отрицательное доказательство AC11 (RC-3):** `gate()` в `pendingChecks` (или в чтении `rankedEntries`)
  транзакции публикации; параллельно исключение лучшей попытки. С замком исключение упирается в незакоммиченную
  запись публикации и повторяется на `lockResults` (spy ≥ 2 вызова, `untilBlocked`). После открытия ворот:
  публикация 200, исключение 409 `protocol_published`, снимок согласован. Без замка
  (`vi.spyOn(RacesRepository.prototype, 'lockResults')` подменён чтением `findRace`: снимок транзакции фиксируется до
  исключения) обе дают 200, в снимке строка с исключённой попыткой. Тест краснеет по результату, итог — в §12.
- `races-admin.int.test.ts` / `races-public.int.test.ts`: фаза `final` в панели и публично, правка описания в `final`
  — 200, прочих полей — `FIELD_LOCKED`.
- `migrations.int.test.ts`: `0016` идемпотентна, индексы на месте.
- `admin-routes.test.ts` новый контроллер покрывает автоматически: проверить, что зелёный.

**RTL (`apps/admin`, `TZ=Europe/Minsk`)**
- `RaceResultsScreen.test.tsx`:
  - скелетон при видимом заголовке; ошибки «Нет соединения» / «Не удалось загрузить» с повтором; баннер при ошибке
    обновления;
  - KPI;
  - чек-лист: неактивная «Опубликовать протокол» с `aria-disabled` и `DisabledReason` первой причины с количеством;
  - публикация через `ReasonDialog` (причина обязательна) → инвалидация;
  - 409 `RESULTS_PUBLISH_BLOCKED` / `RESULTS_ACTION_BLOCKED` → текст по `details.reason`;
  - права: organizer без `results.revise` не видит DQ / пересчёт, moderator не видит действий;
  - фильтр попыток `excluded`, «Исключить» / «Вернуть в обработку»;
  - после публикации: баннер ревизии, «Применить пересчёт» неактивна при `recheck.pending > 0`, история.
- `RacesScreen.test.tsx`: тон `final`. `RaceEditor`: ссылка «Результаты», причина `results_final`, нет «Отменить
  гонку». `StatTile` — тест в `src/ui`.

### ORDER (контрольные точки, после каждой — `pnpm typecheck` и тесты зоны)

1. **A — contracts / api-client / i18n.** Схемы, тесты контрактов, методы клиента, ключи словаря. `RacesScreen.PHASE_TONE`
   и `AuditScreen` компилируются (ключи добавлены).
2. **B — races и tracks.** `RaceDoc` и политика `final` / D-19, `lockResults` / `markProtocolPublished`, `cancel`,
   `countUnprocessed`, миграция `0016`, unit и int `races`.
3. **C1 — results: модель и политика.** Коллекции, `summarize` / `attemptHidden` / `resultStatus`,
   `publishChecklist`, `buildProtocol`, репозиторий и сторож append-only, приём (`syncGroup`, `withdrawAttempt`).
4. **C2 — results: действия.** Сервис и контроллер протокола, права, журнал, события, `requestRace` через worker
   (RC-1), int AC1–AC8 и отрицательное доказательство AC11.
5. **C3 — results: чтения.** Панель (сводка, участники, попытки с `review`, история), публичная таблица и «моё
   участие» из снимка (RC-5), int AC9.
6. **D — панель.** `StatTile`, маршрут, экран и блоки, `RaceEditor` / `RacesScreen`, RTL.
7. **E — docs и gate.** §10, `pnpm check`, `pnpm --filter @pokatim/admin build`; по возможности `pnpm e2e:admin`
   (иначе `NOT VERIFIED` в pr.md).

### OUT OF SCOPE

Как в §4. Дополнительно:
- маршрут outbox и потребитель `protocol-published` / `result-revised` (08);
- подписи приложения для `final` / `dq` / `revised` / `excluded` (ключи i18n добавляются, экраны — 04);
- пагинация участников панели свыше `standingsMax`;
- уведомления райдеру об исключении или DQ;
- роль MongoDB без update/remove для append-only коллекций (follow-up, как у `panel_audit`).

# 12. Outcome

(заполняет coder)
