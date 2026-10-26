# 1. Title

Результат гонки, слайс 03: заявки и попытки в API. Модуль `results`: заявка и отмена участия с фиксацией полей гонки
с первой заявки (V-12); попытки — явные («загрузить в гонку», «выбрать свой заезд») и автоматические по событиям
`tracks`; очередь `attempt-check` (`analyzeAttempt` в потоке разбора); лучший результат участника; места
«1, =2, =2, 4» при чтении; read-API приложения, публичной таблицы и панели (только чтение)

# 2. Goal

Слайс 03 эпика `docs/tasks/2026-10-27-race-results/epic.md` (§3.2, §3.4, §4, §7). Слайсы 01 (маршрут и коридор, PR #33)
и 02 (движок сверки `matchCorridor` / `analyzeAttempt`, PR #32) смержены в `develop`. Здесь движок впервые получает
настоящие заезды:

- райдер нажимает «Участвовать» — появляется **заявка**; первая заявка гонки **фиксирует** коридор, окно, класс и
  покрытия (V-12);
- каждый заезд заявленного райдера в окне и в рамке маршрута становится **попыткой** — автоматически (импорт
  Garmin/Wahoo и ручная загрузка, эпик A8) или явно («загрузить в гонку», «выбрать свой заезд»);
- worker сверяет попытку **по исходнику** (`analyzeAttempt` в `worker_threads`), пишет вердикт, время между воротами,
  причину отказа и версию движка;
- **лучшая засчитанная** попытка — результат участника; **места** считаются при чтении: ничья до секунды — «=N»,
  следующее место пропускает разделённые (A7);
- API отдаёт приложению «моё участие» (заявка, попытки, статус, причина отказа, доступные действия), всем —
  предварительную таблицу гонки без персональных данных, панели — сводку и попытки, включая финальные провалы
  проверки (dead-letter).

Клиент присылает только намерение («участвую», «этот заезд», «отменяю»); время, место, вердикт и статус считает
сервер (`AGENTS.md` §4.1). UI — слайсы 04 (приложение) и 05 (панель); здесь — контракты, ключи i18n и API.

Решения автора, которые здесь становятся кодом (эпик §6 и постановка блока):
- время — между воротами (A4, движок 02); не засчитано, если вне коридора > 2 % или один выход > 500 м, недобранный
  путь — тоже сход (A6, движок 02);
- загрузка — до закрытия окна + 24 ч (A5);
- ничья — «1, =2, =2, 4», равенство до секунды (A7);
- попытки — автоматически по заявке плюс явный выбор заезда (A8);
- одна заявка на гонку; в зачёт идёт лучшая засчитанная попытка.

Источники: `AGENTS.md` §1, §4; ADR-0007, 0009, 0010, 0011, 0012 (Proposed); эпик §3.2–§3.7, §4, §6–§8; spec и §8.2
слайсов 01 и 02; `docs/product/races-and-seasons.md`, `docs/product/tracks-and-devices.md`; `.claude/rules/{backend,
pokatim-backend,db,pokatim-db,contracts,pokatim-contracts,security,pokatim-security,tests,pokatim-tests}.md`; прототипы
автора (конфиденциальны, в репозиторий не копируются — ниже только решения и коды): «Результат после загрузки»
(D-37, D-39, D-44, C1/H2, D-06, D-43), «Гонки» («Участвовать», «Verified — ждём трек»). Код сверен по `origin/develop`
@ `a7ec7ad`.

# 3. Scope

**Contracts / api-client / i18n**
- Новое `packages/contracts/src/results/results.schema.ts` (приложение и публичное, `tolerantEnum` в ответах):
  статусы заявки, попытки и результата, коды отказа и сбоя, причины недоступности действий, `MyRaceEntry`,
  `MyAttempt`, `AttemptRequest`, `AttemptCandidates`, `RaceResultsQuery`, `RaceResultsPage`.
- Новое `results/results-admin.schema.ts` (панель, строгие `z.enum`): `PanelRaceResults`, `PanelRaceAttempt`,
  `PanelRaceAttemptQuery`, `PanelRaceAttemptPage`.
- `races/race.schema.ts`: `RACE_EDIT_BLOCK_REASONS` + `'entries_locked'` (в конец).
- `common.ts`: коды ошибок `RACE_ENTRY_CLOSED`, `RACE_ENTRY_WITHDRAWN`, `RACE_ENTRY_REQUIRED`, `RACE_WITHDRAW_CLOSED`,
  `ATTEMPT_UPLOAD_CLOSED`, `ATTEMPT_LIMIT`, `ATTEMPT_SOURCE_INVALID` и код поля `CORRIDOR_GATES_OVERLAP` — в конец.
- `packages/api-client`: приложение — `getRaceResults`, `getMyRaceEntry`, `enterRace`, `withdrawFromRace`,
  `addRaceAttempt`, `listAttemptCandidates`; панель — `getRaceResultsSummary`, `listRaceAttempts`.
- `packages/i18n/src/ru.ts`: ключи слайса 04 (участие, попытки, причины, результат, таблица, ошибки) и панели
  (`admin.races.reason.entries_locked`, поле `CORRIDOR_GATES_OVERLAP`) — §7.10.

**`packages/tracks`** (golden движка не меняется)
- `CorridorError` — класс ошибки инварианта коридора (`prepare.ts` `assert` бросает его вместо `Error`), экспорт из
  `@pokatim/tracks/parse`: поток разбора отличает «коридор негоден» от «файл не читается».
- `track.ts` (лёгкий вход): `corridorGateRadiusM(widthM)` — единственный источник радиуса ворот; `CORRIDOR_POLICY
  .gateRadius` ссылается на неё (значение то же).
- `geo.ts` (лёгкий вход): `Bounds`, `boundsOf(coords)`, `boundsNear(a, b, marginM)` — рамка для предфильтра
  автоматических попыток.

**API — общий код**
- `src/parse-thread.ts`: `'analyzeAttempt'` в белом списке; `CorridorError` → код `corridor_invalid`; общий на процесс
  семафор потоков разбора `PARSE_THREADS_MAX = 1` (track-processing, route-processing и attempt-check не держат
  несколько потоков по 192 МБ в worker с лимитом 512 МиБ — §8 R4).
- `src/queues.ts`: `resultsIntake: 'results-intake'`, `attemptCheck: 'attempt-check'`,
  `resultsMaintenance: 'results-maintenance'`.

**API — `tracks`** (поведение загрузок не меняется)
- События outbox: `tracks.activity-ready` (в транзакции записи активности — основной или дубля) и
  `tracks.activity-removed` (в транзакции удаления загрузки с активностью, с новой основной группы).
- Порт `ActivitySource` (`modules/tracks/index.ts`): состояние группы дублей, своя загрузка/активность по id, свои
  основные активности в интервале, чтение исходника для worker. `results` коллекции `tracks` не читает.

**API — `routes`**
- Порт `RouteGeometry`: линия сверки готового маршрута (`CorridorGeometry` без `widthM`) и рамка (`Bounds`);
  кэш в процессе (готовый маршрут неизменяем).
- `ReadyRoute` (порт `RouteCatalog`) + `isLoop`, `endsDistanceM` — для проверки ворот при выборе коридора.

**API — `races`**
- `RaceDoc.lockedAt: Date | null` — момент первой заявки; пишет только `RacesRepository` через порт.
- Политика V-12: при `lockedAt` поля `corridor`, `windowStartsAt`, `windowEndsAt`, `bikeClass`, `surfaces` — вне
  `editable.fields`, их изменение — `FIELD_LOCKED`; причина `entries_locked`. Отмена гонки — как сейчас (D-19 — 05/06).
- Проверка ворот при выборе коридора: линейный маршрут с концами ближе `2 · corridorGateRadiusM(widthM)` — поле
  `corridor.routeId` код `CORRIDOR_GATES_OVERLAP`.
- `RacesCoreModule` (репозиторий + порт) и порт `RaceRegistry` для `results` (через `modules/races/index.ts`).

**API — новый модуль `apps/api/src/modules/results`**
- Коллекции `race_entries`, `race_attempts`; миграция `0015_results` (индексы + бэкфилл `races.lockedAt = null`).
- Заявка, отмена, моё участие, явная попытка, кандидаты «своих заездов» — приложение (`AuthGuard`).
- Публичная предварительная таблица гонки (`PublicReadGuard`, кэш 60 с) — анонимные строки.
- Панель (только чтение): сводка результатов гонки и список попыток с фильтром по статусу (`PanelGuard` +
  `races.read`, видимость гонки — как в `races`).
- Worker: `results-intake` (события `tracks` и своя «заявка создана» → попытки), `attempt-check` (сверка),
  `results-maintenance` (повторная постановка зависших проверок). Механизм «перепроверить гонку» (новая
  `checkRevision`) — сервис для слайса 05.

**Панель (`apps/admin`)** — только причина `entries_locked` в карте причин `RaceEditor` и текст ошибки поля
`CORRIDOR_GATES_OVERLAP` (строгий enum контракта требует). Новых экранов нет.

**Docs** — §10 (ADR-0012: п. 3, 4, 6 — реализация слайса 03).

# 4. Out of Scope

- UI приложения (кнопки, экраны, таблица, polling) — слайс 04; UI панели «Результаты», исключение/«Вернуть в
  обработку», чек-лист и публикация протокола, фаза `final`, снимок `race_protocol_rows`, экстренный пересчёт и
  `race_recalculations`, запуск «перепроверить гонку» — слайс 05.
- Споры и их блокировки (D-39: загрузка и отмена участия при открытом споре; D-19 — блокировка отмены гонки;
  D-44) — слайсы 05–06. Здесь нет точек расширения «на вырост»: условие добавит слайс 06 в `entryActions`.
- Verified/START, данные Verified (D-06), кластеры, места по кластеру, «Требует внимания» — слайс 07 (модель держит
  `groupKey: 'overall'` и `tier: null`, A3).
- Имена райдеров, клубы, тренеры в таблице — модели имени нет (§8.1, вопрос автору A12); строки анонимны.
- Пакетный «мой статус» для списка гонок («Verified — ждём трек» на карточках) и «Мои дела» — по потребности слайса 04.
- Уведомления (A11), события `results.*` для других модулей (`protocol-published`, `result-revised` — 05).
- Проверка плотности линии маршрута при разборе маршрута (`line too dense`) — follow-up `routes`; здесь такой коридор
  даёт попытке `failed: corridor_invalid`, видимый в панели.

# 5. Architecture Context

### Модули и зависимости

```
identity ◄── results (AuthGuard, CurrentUser)
panel    ◄── results (PanelGuard, RequirePermission races.read)
races    ◄── results (порт RaceRegistry: гонка, окно, коридор, фиксация V-12, видимость в панели)
routes   ◄── results (порт RouteGeometry: линия сверки, рамка маршрута)
tracks   ◄── results (порт ActivitySource; события tracks.activity-ready / tracks.activity-removed через outbox)
races    ──► routes (как в 01: RouteCatalog + isLoop/endsDistanceM для проверки ворот)
```

- Всё — через `modules/<x>/index.ts`; `races`, `routes`, `tracks` о `results` не знают (циклов нет). Фиксация V-12 —
  порт `races`, который `results` вызывает **внутри своей транзакции** (эпик §3.7).
- **Outbox: тип события → одна очередь** (`MongoOutboxPublisherModule.forRoot({ routes })` — объект «тип → очередь»,
  без раздачи нескольким подписчикам). Поэтому у `results` — свои типы событий `tracks` (`activity-ready`,
  `activity-removed`), не `tracks.upload-deleted` (его слушает `devices`). Маршруты событий `tracks` для `results`
  задаёт подписчик (`resultsOutboxRoutes`), как `devicesOutboxRoutes` для `tracks.upload-deleted`.
- Слои `results`: контроллеры (тонкие: гард, контракт, лимит) → сервисы (`entries.service.ts`,
  `attempts.service.ts`, `results-read.service.ts`) → `results.repository.ts` (единственный писатель
  `race_entries`/`race_attempts`) → процессоры worker (`results-intake`, `attempt-check`, `results-maintenance`).
  Правила — чистые функции `results.policy.ts` (unit).

### Модель

- **Заявка** `race_entries` — одна на (гонка, райдер), `active | withdrawn`. Документ заявки — **замок участника**:
  любая транзакция, меняющая попытки заявки или её лучший результат, **первой** операцией пишет `version`
  (`lockEntry`, `$inc`). Лучший результат и сводка попыток хранятся **в самой заявке** (`best`, `summary`) —
  отдельной коллекции `race_results` до снимка протокола (05) нет (§8.1, Q8).
- **Попытка** `race_attempts` — (гонка, основная активность) уникальна; `origin: auto | explicit`; статус
  `queued → checking → counted | rejected | failed`, `withdrawn` (активность удалена или перестала быть основной).
  `checkRevision` — номер проверки: каждая постановка на проверку — новая ревизия; вердикт пишется только своей
  ревизией (поздний повтор — no-op). `engineVersion` — версия движка последней проверки.
- **Запросы райдера** `race_entries.requests[]` — явное намерение по загрузке или активности
  (`{ uploadId, activityId | null, requestedAt, attemptId | null }`, ≤ 30): «загрузить в гонку» до окончания разбора
  файла хранится здесь и разрешается в попытку, когда активность готова; попытка, к группе которой относится
  запрос, — `explicit`.
- **Видимость отказа (A8):** автоматическая попытка без полного сегмента старт→финиш скрыта от райдера
  («не совпала», не отказ) — §7.4. Явная — всегда видна с причиной. Панель видит всё (`hidden: true`).

### Потоки

**Заявка** `POST /v1/races/:raceId/entry`:
`AuthGuard` → лимит → транзакция { `RaceRegistry.admitEntry(tx, raceId, now)` — **запись** в документ гонки
(`lockedAt ??= now`, только `published`) и возврат гонки → проверка: коридор есть, фаза `upcoming|open` → вставка
заявки (уникальный `(raceId, userId)`) → outbox `results.entry-created { entryId }` } → `201`. Повтор при активной
заявке — `200` с ней; заявка `withdrawn` — `409 RACE_ENTRY_WITHDRAWN`. Гонка двух первых заявок / заявки и правки
гонки панелью — конфликт записи в документ гонки, `MongoTransactions.run` повторяет проигравшую (§7.6).

**Отмена** `POST /v1/races/:raceId/entry/withdraw`: транзакция { `lockEntry` (условие `status: 'active'`) → фаза
`upcoming|open`, иначе `409 RACE_WITHDRAW_CLOSED` → `withdrawn`, `withdrawnAt` }. Попытки и треки остаются (C1/H2),
результат вне таблицы, повторная заявка невозможна.

**Явная попытка** `POST /v1/races/:raceId/attempts` `{ activityId }` или `{ uploadId }`:
транзакция { `lockEntry` (активна) → `RaceRegistry.get` → фаза `open|closed` и `now < uploadClosesAt` → источник через
`ActivitySource` (своя; чужая/неизвестная — 404): загрузка `failed|skipped` или активность-дубль/не своя группа —
`409 ATTEMPT_SOURCE_INVALID`; загрузка `queued|processing` — запрос `{ uploadId, attemptId: null }`; готовая —
основная активность группы → попытка `explicit` (существующая `auto` → `explicit`; нет — вставка `queued`, outbox
`results.attempt-check-requested`) → запрос с `attemptId` → `refreshEntry` } → `200 MyRaceEntry`.

**Автоматические попытки** (`results-intake`, событие → `syncGroup`):
- `tracks.activity-ready { activityId, uploadId, userId }` → `ActivitySource.group(activityId)` (состояние **сейчас**, не
  из payload — порядок и повтор событий не важны) → активные заявки пользователя (индекс `(userId, status)`, единицы)
  → для каждой — транзакция под `lockEntry`: основная активность группы проходит предфильтр (§7.3) или к группе
  относится запрос райдера → попытка есть/создаётся (`queued`, outbox проверки), `withdrawn: not_primary` той же
  активности — оживает новой ревизией; попытки прочих членов группы → `withdrawn: not_primary`; запросы по загрузкам
  группы получают `attemptId`; `refreshEntry`.
- `tracks.activity-removed { activityId, uploadId, userId, primaryActivityId }` → попытки удалённой активности →
  `withdrawn: activity_removed` (под замком каждой заявки) → если в группе новая основная — `syncGroup` для неё.
- `results.entry-created { entryId }` → основные активности райдера в интервале окна (`ActivitySource.listInRange`,
  ≤ 50) → `syncGroup` каждой (заявка, поданная после заезда, тоже получает попытки — «проехал и забыл», Q3).

**Проверка** (`attempt-check`, `jobId` = id события outbox `results.attempt-check-requested { attemptId,
checkRevision }`):
1. Захват `findOneAndUpdate({ _id, checkRevision, status: { $in: ['queued','checking'] } }, { $set: { status:
   'checking' }, $inc: { checkAttempts: 1 } })`; нет — no-op (другая ревизия, итог уже записан, попытка снята).
2. Контекст: `RaceRegistry.get` (окно `startsAt`/`closesAt`, коридор), `RouteGeometry.matchGeometry(routeId)` +
   `widthM` гонки → `CorridorGeometry`; исходник `ActivitySource.readSource(activityId)`.
3. `runParseThread('analyzeAttempt', [bytes, format, corridor, window, now], DEFAULT_PARSE_LIMITS)` (семафор потоков,
   30 с, 160/32 МБ).
4. Итог → транзакция { `lockEntry(entryId)` → попытка `{ _id, checkRevision, status: 'checking' }` → вердикт
   (статус, причины, сегмент, `engineVersion`, `diagnostics`, `matched`, `checkedAt`) → `refreshEntry` (лучшая,
   сводка) }. Попытка за это время снята или перепоставлена — условие не совпало, транзакция ничего не пишет.
5. Ошибки: `implausible` (ошибка файла из движка) → `rejected: ['implausible']`; `timeout`, `unreadable` (OOM),
   `corridor_invalid` → `failed` с кодом (без ретрая — повтор даст то же); исходника нет: активность удалена —
   `withdrawn: activity_removed`, иначе `failed: storage`; сбой окружения (загрузчик потока, БД) — исключение →
   ретрай BullMQ (5 попыток, экспонента 5 с), на последней — `failed: error`. **Финальный провал** виден в панели:
   `GET /v1/admin/races/:raceId/results` (`counts.failed`) и `…/attempts?status=failed` (код, число попыток) — строка
   чек-листа публикации слайса 05 (D-23); райдеру — «Не удалось проверить трек», результат `not_counted`.

**Зависшие** (`results-maintenance`, расписание каждые 10 мин): `checking` дольше 15 мин или `queued` дольше 2 ч без
задачи (потеря Redis, падение до публикации outbox уже исключено) → новая ревизия + событие; после 3 перепостановок —
`failed: error`.

**Перепроверка гонки** (механизм для 05): `ResultsRecheck.requestRace(raceId)` — всем попыткам гонки, кроме
`withdrawn`, новая `checkRevision`, `queued`, событие каждой; лучшие результаты пересчитываются по мере вердиктов.
Коридор после первой заявки не меняется (V-12) — пересчёт «из-за коридора» не нужен; смена `CORRIDOR_ENGINE_VERSION`
результаты молча не трогает (ADR-0012 п. 5) — панель видит `counts.staleEngine`, запуск — слайс 05.

### Лучший результат и места

- `refreshEntry(tx, entryId)` — в любой транзакции, меняющей попытки заявки, после `lockEntry`: читает попытки заявки
  (≤ 30), `best` = засчитанная с минимальным `(elapsedSec, segment.startedAt, _id)`; `summary` = счётчики
  `pending` (`queued|checking`), `counted`, `rejectedShown` (видимые отказы), `failed`, `total`.
- **Места при чтении** (до публикации): строки — активные заявки гонки с `best`, индекс `race_entries_ranking_idx`
  `(raceId, groupKey, best.elapsedSec, best.startedAt, _id)` с частичным фильтром; место строки = `1 + число строк
  группы с меньшим elapsedSec`, `tied` = таких же ≥ 2. Страница ≤ 100: место первой строки — `countDocuments`
  по индексу, дальше — по порядку; ничья на границе страниц сохраняет «=N». Обе выборки — в одной snapshot-сессии
  (`startSession({ snapshot: true })`): таблица согласована.
- Порядок строк внутри ничьей — по `best.startedAt` (раньше проехал — выше), затем `_id`: детерминирован, место одно.

### Фиксация V-12 и гонки записи

| Сценарий | Механизм | Отрицательное доказательство (int) |
|---|---|---|
| Первая заявка ↔ правка коридора/окна панелью | `admitEntry` пишет документ гонки, правка — `updateRace` с `version` в том же документе: конфликт записи, проигравшая повторяется и видит `lockedAt` / новый коридор | `admitEntry` только читает → заявка закоммичена, коридор сменился (`FIELD_LOCKED` не сработал) |
| Заявка ↔ отмена гонки | та же запись в документ гонки (`status: 'published'` в фильтре) | без записи — заявка на отменённой гонке |
| Две заявки одного райдера | уникальный `race_entries_race_user_unique` | — (индекс) |
| Два вердикта попыток одной заявки | `lockEntry` первой операцией | без замка — `best` = худшая из двух (write skew) |
| Явный запрос по загрузке ↔ `activity-ready` | обе транзакции под `lockEntry` | без замка — запрос навсегда «ждёт файл», попытка `auto` скрыта |
| Поздний повтор проверки старой ревизии | `checkRevision` в фильтре захвата и записи | без условия — старый вердикт затирает новый |
| Отмена участия ↔ вердикт | `lockEntry` в обеих | — (вердикт записан, заявка `withdrawn`, строки в таблице нет) |

### Контракты и совместимость

- Только добавления. Ответы приложения — `tolerantEnum` (статусы, причины, коды); новые эндпоинты — старые сборки их
  не вызывают; новая сборка со старым API получает 404 на `/entry` и `/results` — слайс 04 прячет участие.
- `RaceDetail` не меняется: доступность «Участвовать» приложение берёт из `MyRaceEntry.actions` (вошедший) и из
  `corridor` + `phase` (гость — «Войти, чтобы участвовать»).
- Панель деплоится с API: `RACE_EDIT_BLOCK_REASONS` + `entries_locked`, `SCHEDULE_FIELD_ERROR_CODES` +
  `CORRIDOR_GATES_OVERLAP` — строгие enum-ы, карта текстов `RaceEditor` обновляется в этом же PR.
- Коды отказа попытки (`ATTEMPT_REJECTIONS`) = `CORRIDOR_REJECTIONS` движка + `implausible` в конец; тест-сторож
  сравнивает с движком (§11 TESTS).

### Миграция `0015_results`

Expand-only, идемпотентна, без транзакции: `race_entries`, `race_attempts` + индексы (§11); `races.updateMany({ lockedAt:
{ $exists: false } }, { $set: { lockedAt: null } })` (чтение терпит отсутствие поля — `?? null`). Номер — `0015`
(на develop последняя `0013_routes`, `0014` занимает PR кофе-райдов): в `migrations/index.ts` — в конец списка; если
`0015` сольётся раньше `0014`, порядок применения на dev — `0013 → 0015 → 0014` (коллекции не пересекаются, §8 R7).

### Время

Всё в UTC из `CLOCK`; `closesAt = windowEndsAt + 1 мин` (R12 ADR-0010) считает `races` (`RaceRegistry`), `results` его
не дублирует; `uploadClosesAt = closesAt + 24 ч` (A5) — `RESULTS_POLICY`. Показ — Europe/Minsk на клиенте.

# 5.1 Placement & Reuse Gate

- **Размещение:** новый модуль `apps/api/src/modules/results` (контекст из списка `pokatim-backend.md`); новых пакетов
  нет (потребитель API один). Геометрия рамок — `packages/tracks` (`geo.ts`), не в модуле.
- **Переиспользуем:** `AuthGuard`, `CurrentUser` (`modules/identity/index.ts`); `PanelGuard`, `RequirePermission`,
  `CurrentPanelUser` (`modules/panel/index.ts`); `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`, `page-cursor.ts`,
  `domainError`, `ZodValidationPipe`; `MongoTransactions`, `MongoOutboxWriter`/`MongoOutboxReader`, `uuidv7`,
  `isDuplicateKey`, `RateLimiter`, `CLOCK`, `QueueModule` (5 попыток, экспонента) (`@rkarakulov/api-kit`);
  `runParseThread`, `DEFAULT_PARSE_LIMITS` (`src/parse-thread.ts`); `analyzeAttempt`, `CORRIDOR_ENGINE_VERSION`,
  `CORRIDOR_REJECTIONS` (`@pokatim/tracks/parse` — только worker); `racePhase`, `RACE_POLICY.windowEndGraceMs`,
  видимость гонок панели (`races.service.ts` → в порт, без копии); паттерны `finalAttempt` и захвата по статусу
  (`track-processing.processor.ts`), расписаний (`TracksSchedules`); тестовый стенд `apps/api/test/{harness,identity
  (holdTransaction, untilBlocked),panel,races,routes,tracks}.ts`, фикстуры `packages/tracks/src/__fixtures__/corridor/`
  (`corridor-expected.json` — линии и окна).
- **Запрещённые дубли:** чтение коллекций `tracks`/`routes`/`races` из `results` (только порты); второй поток
  разбора; правило «минута окна» или видимость гонок панели в `results`; расчёт мест/лучшей на клиенте; DTO вне
  contracts; копия порогов или кодов движка (коды — из `CORRIDOR_REJECTIONS` + сторож); радиус ворот вне
  `corridorGateRadiusM`.
- **Новые зависимости npm:** нет.
- **Кандидаты в базу (follow-up):** семафор потоков в `parse-thread` — вместе с `parse-thread` (F6, слайс 01).

# 6. Relevant Files

- `apps/api/src/modules/tracks/{track-processing.processor,track-uploads.service,activity-groups,tracks.repository,
  tracks.collection,tracks.events,tracks.module,index}.ts` — точки событий, группы дублей, удаление, порт.
- `apps/api/src/modules/routes/{route-catalog.port,route-catalog,routes.collection,routes.repository,routes.module,
  index}.ts` — порты маршрутов.
- `apps/api/src/modules/races/{races.collection,races.policy,races.service,races.repository,races.module,index}.ts` —
  `lockedAt`, V-12, порт, видимость.
- `apps/api/src/{parse-thread,queues,worker.module,app.module,error-messages,public-read.guard,page-cursor}.ts`.
- `apps/api/src/db/migrations/{0013_routes,index}.ts`, `migrations.int.test.ts`.
- `packages/tracks/src/{parse,track,geo}.ts`, `corridor/{prepare,policy,types}.ts`.
- `packages/contracts/src/{common.ts,index.ts,races/race.schema.ts,races/race-public.schema.ts,tracks/track-upload
  .schema.ts}`.
- `packages/api-client/src/{index,admin}.ts`; `packages/i18n/src/ru.ts`.
- `apps/admin/src/features/races/RaceEditor.tsx` — карта причин и ошибок поля.

# 7. Implementation Notes

### 7.1 Эндпоинты

| Метод и путь | Гард | Тело / query | Ответ |
|---|---|---|---|
| `GET /v1/races/:raceId/results` | `PublicReadGuard`, `Cache-Control: public, max-age=60` | `RaceResultsQuery` (`cursor`, `limit` 1–100, по умолчанию 50) | `RaceResultsPage`; черновик/неизвестная — 404; отменённая или без коридора — `items: []` |
| `GET /v1/races/:raceId/entry` | `AuthGuard`, `no-store` | — | `MyRaceEntry` (`entry: null`, если не заявлен) |
| `POST /v1/races/:raceId/entry` | `AuthGuard`, лимит `results-entry-user` | пустое тело (`z.strictObject({})` или без тела) | `201` / `200` (уже активна) `MyRaceEntry` |
| `POST /v1/races/:raceId/entry/withdraw` | `AuthGuard`, лимит `results-entry-user` | — | `200 MyRaceEntry`; уже `withdrawn` — `200` (идемпотентно) |
| `POST /v1/races/:raceId/attempts` | `AuthGuard`, лимит `results-attempt-user` | `AttemptRequest`: `{ activityId }` **или** `{ uploadId }` | `200 MyRaceEntry` |
| `GET /v1/races/:raceId/attempt-candidates` | `AuthGuard`, `no-store` | — | `AttemptCandidates` (≤ 50 основных активностей, пересекающих окно, с флагом `attempted`) |
| `GET /v1/admin/races/:raceId/results` | `PanelGuard` + `races.read`; чужая гонка организатора — 404 | — | `PanelRaceResults` (сводка) |
| `GET /v1/admin/races/:raceId/attempts` | то же | `PanelRaceAttemptQuery` (`status?`, `cursor`, `limit` ≤ 100) | `PanelRaceAttemptPage` |

Параметр `:raceId` — `Uuid` (pipe), иначе `400`. Контроллеры `results` объявляют пути с префиксом `races` / `admin/races`
отдельно от `races` (статических сегментов-конфликтов с `races/:id` нет). `src/admin-routes.test.ts` обходит новый
админ-контроллер.

| Код | HTTP | Когда |
|---|---|---|
| `NOT_FOUND` | 404 | гонка черновик/неизвестна; чужая/неизвестная загрузка или активность |
| `RACE_ENTRY_CLOSED` | 409 | нет коридора, фаза `closed`, гонка отменена (`details.reason` — `RaceEntryBlockReason`) |
| `RACE_ENTRY_WITHDRAWN` | 409 | заявка была отменена (повторная заявка на эту гонку невозможна, C1/H2) |
| `RACE_ENTRY_REQUIRED` | 409 | попытка без активной заявки |
| `RACE_WITHDRAW_CLOSED` | 409 | отмена участия после закрытия окна |
| `ATTEMPT_UPLOAD_CLOSED` | 409 | окно ещё не открыто (`details.reason: window_not_open`) или `now ≥ uploadClosesAt` (A5, `upload_closed`) |
| `ATTEMPT_LIMIT` | 409 | попыток заявки ≥ 30 или запросов ≥ 30 |
| `ATTEMPT_SOURCE_INVALID` | 409 | загрузка `failed`/`skipped`; активность — дубль группы; `uploadCreatedAt ≥ uploadClosesAt` |
| `RATE_LIMITED` | 429 | лимиты §7.2 |

### 7.2 Политика `RESULTS_POLICY` (`results.policy.ts`, `[ASSUMPTION]` кроме A5)

```ts
export const RESULTS_POLICY = {
  uploadGraceMs: 24 * 3_600_000,          // A5: загрузка до closesAt + 24 ч
  maxAttemptsPerEntry: 30,                // auto + explicit; сверх — auto пропускается (лог), explicit — ATTEMPT_LIMIT
  maxRequestsPerEntry: 30,
  entryUserLimit: { limit: 20, windowSec: 3600 },   // заявка + отмена
  attemptUserLimit: { limit: 30, windowSec: 3600 }, // явные попытки (загрузки ограничены ещё и tracks: 30/ч)
  candidatesLimit: 50,                    // кандидаты «своих заездов», entry-created скан
  boundsMarginM: 600,                     // ≥ searchRadius(200 м) = 600: рамка трека ↔ рамка маршрута
  stuckCheckingMs: 15 * 60_000,
  stuckQueuedMs: 2 * 3_600_000,
  maxRequeues: 3,
  resultsPageDefault: 50, resultsPageMax: 100,
  groupKey: 'overall',                    // A3: одна группа зачёта v1
} as const;
```

### 7.3 Предфильтр автоматической попытки (`mayMatch`, чистая функция)

Активность — основная в группе (`isPrimary`), вид спорта ≠ `cycling_indoor`; интервал `[startedAt, endedAt]` пересекает
`[windowStartsAt, closesAt)`; `uploadCreatedAt < uploadClosesAt` (время приёма файла сервером — не клиента, не очередь
разбора); `boundsNear(activity.bounds, route.bounds, boundsMarginM)`. Рамка активности — из линии показа
`activity_tracks` (≤ 1000 точек, упрощение ≤ 5 м — запас в марже); нет линии — точка старта. Запрос райдера (явное
намерение) предфильтр **не** требует — судит движок.

### 7.4 Статусы: попытка, видимость, результат

- **Вердикт → статус попытки:** `counted` → `counted`; `rejected` → `rejected` (`reasons` из движка); `matched =
  touchedCorridor && segment !== null && !['no_start','no_finish'].includes(reasons[0])`.
- **Скрыта от райдера** (`hidden`): `origin = 'auto'` и (`rejected` и `!matched`, либо `reasons[0] = 'implausible'`), а также
  любые `withdrawn`. Панель видит всё с флагом.
- **Результат участника** (`resultStatus(entry, race, now)`, по порядку): `withdrawn` (заявка отменена) → `provisional`
  (`best` есть; `final`/`dq`/`revised` — слайс 05) → `pending` (`summary.pending > 0`) → `not_counted`
  (`rejectedShown + failed > 0`) → `dns` (`now ≥ uploadClosesAt`, видимых попыток нет) → `none` (ещё нет попыток).
  Не хранится — считается при чтении из `entry.best`/`entry.summary` и времени.
- **Действия** (`entryActions`, D-37/C1/H2; споры D-39 добавит 06):
  - `canEnter` — заявки нет, гонка `published`, коридор есть, фаза `upcoming|open`; иначе причина `no_corridor` /
    `cancelled` / `entries_closed` / `withdrawn`;
  - `canWithdraw` — заявка `active`, фаза `upcoming|open`; иначе `not_entered` / `window_closed`;
  - `canAddAttempt` — заявка `active`, фаза `open|closed`, `now < uploadClosesAt`, попыток < 30; иначе `not_entered` /
    `window_not_open` / `upload_closed` / `attempt_limit`.

### 7.5 Итог проверки → запись

| Итог потока / сбой | Статус попытки | Ретрай BullMQ | Виден |
|---|---|---|---|
| `CorridorMatch`, `counted` | `counted` + сегмент, `engineVersion`, `diagnostics` | — | райдер, таблица, панель |
| `CorridorMatch`, `rejected` | `rejected` + `reasons`, сегмент кандидата | — | райдер (кроме скрытых), панель |
| `TrackParseError('implausible')` | `rejected: ['implausible']` | — | явная — райдер; панель |
| `timeout`, `unreadable` (OOM), прочие коды файла | `failed` + `failure` | нет | панель (dead-letter), райдер — «не удалось проверить» |
| `CorridorError` → `corridor_invalid` | `failed: corridor_invalid` | нет | панель; лог `raceId`, `routeId` |
| исходника нет, активность удалена | `withdrawn: activity_removed` | — | панель |
| исходника нет, активность есть | `failed: storage` | нет (как `tracks`) | панель |
| исключение (загрузчик потока, БД, хранилище не ENOENT) | `checking` | да, 5 попыток; последняя → `failed: error` | панель |

`now` для `analyzeAttempt` (правдоподобие «в будущем») — `CLOCK` на момент проверки. Сегмент хранится без координат
заезда и без датчиков (`CorridorSegment` + `diagnostics`).

### 7.6 Замки (`pokatim-db.md`, R1-подобно)

- `lockEntry(tx, entryId)` — `findOneAndUpdate({ _id }, { $inc: { version: 1 }, $set: { updatedAt } }, { session })` —
  **первая** операция любой транзакции, меняющей попытки заявки, её `requests`, `best`, `summary` или статус.
  Транзакции не вызывают в колбэке логи, очереди, Redis, HTTP (колбэк повторяется).
- `RaceRegistry.admitEntry(tx, raceId, now)` — **первая** операция транзакции заявки: `findOneAndUpdate({ _id,
  status: 'published' }, [{ $set: { lockedAt: { $ifNull: ['$lockedAt', { $literal: now }] } } }], { session,
  returnDocument: 'after' })` — запись в документ гонки каждой заявкой (конфликт с правкой/отменой гонки); `version`
  гонки не меняется (открытая форма панели не получает лишний 409 — поля заблокирует политика). Повторы
  `MongoTransactions.run` при сотнях заявок — приемлемо (§8 R5).
- Вердикт, `syncGroup`, отмена, явная попытка — транзакции под `lockEntry` **каждой** затронутой заявки по одной
  (у пользователя несколько заявок — несколько транзакций; общий замок не нужен: инвариант — внутри заявки).

### 7.7 `races`

- `RaceDoc.lockedAt: Date | null` (документы до `0015` — `?? null`).
- `races.policy.ts`: `RaceLockOptions.locked` ← `race.lockedAt !== null` (сервис больше не передаёт `false`):
  `LOCKED_BY_ENTRIES = ['corridor', 'windowStartsAt', 'windowEndsAt', 'bikeClass', 'surfaces']` вне `editable.fields`,
  изменение — `FIELD_LOCKED`; `editable.reasons` + `entries_locked` (опубликованная с `lockedAt`). `distanceKm` с
  коридором и так вне `fields`. Название, описание, плановая дата протокола — как V-11.
- Проверка ворот (`validateCorridorRoute(route, widthM)` в `races.policy.ts`): `!route.isLoop && route.endsDistanceM ≤
  2 · corridorGateRadiusM(widthM)` → поле `corridor.routeId` код `CORRIDOR_GATES_OVERLAP` (то же, что `assert`
  движка `gates overlap` — до первой заявки, а не в каждой попытке). Только при смене коридора (зафиксированный не
  проверяется).
- Порт `RaceRegistry` (`race-registry.port.ts` + `race-registry.ts`): `admitEntry`, `get(raceId, tx?)`,
  `findForPanel(principal, raceId)` (видимость — та же функция, что в `RacesService`: вынести `visible`/`ownScope` в
  `races.policy.ts`, без копии). Представление `RaceForResults` — §11.
- `RacesCoreModule` (`RacesRepository` + `RACE_REGISTRY`), `RacesModule` импортирует его; worker импортирует
  `RacesCoreModule` (без контроллеров).

### 7.8 `tracks`

- `tracks.events.ts`: `TRACK_ACTIVITY_READY = 'tracks.activity-ready'` `{ activityId, uploadId, userId }` и
  `TRACK_ACTIVITY_REMOVED = 'tracks.activity-removed'` `{ activityId, uploadId, userId, primaryActivityId: uuid | null }`
  — zod, экспорт из `index.ts`; маршрут очереди задаёт подписчик (`resultsOutboxRoutes`).
- `TrackProcessingProcessor.record`: в той же транзакции после `insertGrouped` — `outbox.append(activity-ready)` (и для
  дубля: состав группы мог смениться). `TrackUploadsService.remove`: если удалена активность —
  `outbox.append(activity-removed)` с id новой основной (результат `regroupAfterDelete` — вернуть id). Приём потока
  `devices` идёт тем же `record` — событие есть.
- Порт `ActivitySource` (`activity-source.port.ts` + `activity-source.ts`, через `TracksCoreModule`):
  `group`, `activity`, `uploadState`, `uploadStates`, `listInRange`, `readSource` (§11). Владение — по `userId`
  вызывающего (не из payload клиента). `readSource` — только worker: `storageKey` → `TrackFileStore.get`; `ENOENT` /
  `storageKey = null` → `null`. Рамка — `boundsOf(activity_tracks.line)`.
- Поведение загрузок, ответы и тесты `tracks` не меняются (кроме новых событий в outbox).

### 7.9 `routes` и `parse-thread`

- `RouteGeometry` (`route-geometry.port.ts`, реализация в `route-catalog.ts`): `matchGeometry(routeId)` → `{ line:
  matchLine, isLoop, distanceM } | null` (только `ready`), `bounds(routeId)` → `Bounds | null` (из линии показа).
  Кэш в процессе (≤ 32 маршрута, LRU) — безопасен: готовый маршрут неизменяем, удаления нет.
- `ReadyRoute` + `isLoop`, `endsDistanceM` (haversine `start`↔`finish` документа маршрута).
- `parse-thread.ts`: `PARSE_FUNCTIONS = ['analyzeTrack', 'analyzeRoute', 'analyzeAttempt']`; в коде потока
  `error instanceof tracks.CorridorError ? 'corridor_invalid' : …`; семафор `PARSE_THREADS_MAX = 1` (FIFO, ожидание не
  входит в таймаут 30 с). Тесты `tracks`/`routes` зелёные без правок ожиданий.

### 7.10 i18n (`packages/i18n/src/ru.ts`, формальное «вы», `[ASSUMPTION copy]` кроме цитат прототипа)

Приложение (слайс 04):
- `races.entry.enter` «Участвовать»; `races.entry.signIn` «Войдите, чтобы участвовать»; `races.entry.title` «Ваше
  участие»; `races.entry.attemptsSummary` «Ваши заезды: {count} · лучший {time}»; `races.entry.upload` «Загрузить
  заезд»; `races.entry.uploadMore` «Загрузить ещё заезд»; `races.entry.pickRide` «Выбрать свой заезд»;
  `races.entry.uploadUntil` «Загрузить заезд можно до {date}, {time}»; `races.entry.withdraw` «Отменить участие»;
  `races.entry.withdrawTitle` «Отменить участие?»; `races.entry.withdrawBody` «Ваш результат уйдёт из зачёта, места
  других участников пересчитаются. Заявиться на эту гонку снова будет нельзя.» (прототип C1/H2);
  `races.entry.withdrawConfirm` «Отменить участие»; `races.entry.keep` «Оставить участие».
- `races.result.yourTime` «Ваше время»; `races.result.checking` «Проверка трека»; `races.result.placeLater` «Место
  появится после проверки.» (D-37); `races.result.provisional` «Предварительный»; `races.result.provisionalNote`
  «Результат предварительный до публикации протокола {date}.»; `races.result.place` «Предварительно {place}-е место
  до публикации протокола {date}.»; `races.result.placeTied` «Предварительно {place}-е место (поровну с другими) до
  публикации протокола {date}.»; `races.result.status.{none,pending,provisional,not_counted,dns,withdrawn,unknown}` —
  «Нет заездов», «Проверка трека», «Предварительный», «Не засчитано», «Не стартовал», «Участие отменено», «—».
- `races.attempt.status.{queued,checking,counted,rejected,failed,withdrawn,unknown}` — «В очереди на проверку»,
  «Проверка трека», «Засчитано», «Не засчитано», «Не удалось проверить», «Снят», «—»;
  `races.attempt.failedHint` «Не удалось проверить трек — команда платформы разберётся.»;
  `races.attempt.uploadPending` «Файл обрабатывается…»; `races.attempt.uploadFailed` «Файл не принят: {reason}»
  (причина — `tracks.failure.*`); `races.attempt.origin.auto` «Из импорта»; `races.attempt.origin.explicit` «Загружен
  в гонку».
- `races.attempt.reason.{no_start,no_finish,wrong_direction,missed_section,gps_gap,off_corridor,outside_window,
  sparse_recording,implausible,unknown}` — «Нет старта: трек не выходит из ворот старта», «Нет финиша: трек не входит в
  ворота финиша», «Обратное направление», «Пропущен участок маршрута», «Разрыв записи GPS», «Сход с коридора: больше
  2 % вне коридора или выход длиннее 500 м», «Заезд вне окна гонки», «Запись слишком редкая: путь между точками не
  проверить», «Трек неправдоподобен», «Не засчитано» (`docs/product/races-and-seasons.md`, «Отказ с причиной»).
- `races.block.{no_corridor,cancelled,entries_closed,withdrawn,not_entered,window_not_open,window_closed,
  upload_closed,attempt_limit,unknown}` — «Участие откроется, когда у гонки будет коридор», «Гонка отменена», «Приём
  заявок закрыт», «Вы отменили участие в этой гонке», «Сначала заявитесь на гонку», «Окно ещё не открылось», «Окно
  закрыто», «Срок загрузки заездов истёк», «Достигнут предел заездов для гонки», «Действие недоступно».
- `races.results.title` «Результаты»; `races.results.rider` «Участник»; `races.results.you` «Вы»;
  `races.results.tiePlace` «={place}»; `races.results.empty` «Пока нет засчитанных результатов»;
  `races.results.count` «Засчитано: {count}».
- `races.error.{RACE_ENTRY_CLOSED,RACE_ENTRY_WITHDRAWN,RACE_ENTRY_REQUIRED,RACE_WITHDRAW_CLOSED,ATTEMPT_UPLOAD_CLOSED,
  ATTEMPT_LIMIT,ATTEMPT_SOURCE_INVALID}` — тексты как у сервера (`error-messages.ts`).

Панель: `admin.races.reason.entries_locked` «Есть заявки участников: коридор, окно, класс и покрытия
зафиксированы.»; ошибка поля `CORRIDOR_GATES_OVERLAP` «Старт и финиш маршрута слишком близко для такого допуска —
выберите круговой маршрут или уменьшите допуск».

Сервер (`error-messages.ts`): `RACE_ENTRY_CLOSED` «Приём заявок на гонку закрыт», `RACE_ENTRY_WITHDRAWN` «Участие в
этой гонке уже отменено», `RACE_ENTRY_REQUIRED` «Сначала заявитесь на гонку», `RACE_WITHDRAW_CLOSED` «Отменить участие
можно, пока окно открыто», `ATTEMPT_UPLOAD_CLOSED` «Срок загрузки заездов истёк», `ATTEMPT_LIMIT` «Достигнут предел
заездов для гонки», `ATTEMPT_SOURCE_INVALID` «Этот заезд нельзя добавить в гонку».

### 7.11 Логи

Только id (`raceId`, `entryId`, `attemptId`, `activityId`, `uid`), статус, коды, длительность проверки, число событий;
без координат, времени заезда, e-mail, датчиков. Пропуск автоматической попытки из-за предела — `warn` со счётчиком.

# 8. Risks / Assumptions / Open Questions

- **R1. Последний вечер окна** — сотни проверок подряд (0,2–0,5 с честный трек, до 8 с искусственный худший):
  очередь `attempt-check` (параллелизм 1), райдер видит «проверка трека», место появляется тихо (D-37). Семафор
  потоков (R4) ставит разбор загрузок в ту же очередь ожидания — разбор файла может ждать проверку; приемлемо при
  ≤ 8 с на задачу. Метрика — время в очереди в логе проверки.
- **R2. Исходник на томе dev** (ADR-0011): потеря тома — попытки `failed: storage`, пересчёт невозможен. До прода —
  S3-адаптер `TrackFileStore` (ADR-0012, последствия).
- **R3. Удаление заезда участником** снимает попытку (лучший результат падает на следующую). До публикации протокола
  это право райдера; после публикации — снимок протокола (05) и споры (06) решают, что делать.
- **R4. Память worker** — лимит контейнера 512 МиБ, поток разбора — до 160 + 32 МБ. Сейчас `track-processing` и
  `route-processing` уже могут держать два потока одновременно; третий (`attempt-check`) — риск OOM контейнера. Семафор
  `PARSE_THREADS_MAX = 1` на процесс (Q12). Поднять до 2 — вместе с лимитом worker ≥ 768 МиБ (`infra/deploy`).
- **R5. Горячий документ гонки:** каждая заявка пишет документ гонки (`admitEntry`) — конфликты записи при
  одновременных заявках, повтор транзакции. Сотни заявок за дни окна — редкие конфликты. Альтернатива (счётчик заявок
  в своём документе) не защищает от правки/отмены гонки (§5.5).
- **R6. Автоматические попытки по чужим поездкам** — коммьют через участок маршрута в окне ставится на проверку и
  скрывается (`matched = false`). Стоимость — проверка (обычно < 0,5 с); предел 30 попыток на заявку.
- **R7. Порядок миграций:** `0015` может слиться раньше `0014` (кофе-райды). Миграции независимы (разные коллекции);
  `index.ts` — в конец списка в момент слияния, применённые не переупорядочиваются.
- **R8. Финальный провал до слайса 05** виден только через API панели и логи — UI раздела «Результаты» — слайс 05.
  До открытия первой настоящей гонки 05 должен быть слит (чек-лист публикации).
- **A. Допущения** `[ASSUMPTION]`: значения `RESULTS_POLICY` (§7.2), тексты §7.10, предфильтр по рамкам с запасом
  600 м, видимость автоматических отказов (§7.4), пороги зависших проверок.

# 8.1 Requirements Consistency

- **Расхождение эпик ↔ здесь (модель результата):** эпик §3.4 — отдельная коллекция `race_results` «по одному на
  заявку, материализован», статусы `pending/provisional/final/dq/revised/not_counted/dns/withdrawn`. → **Решение:**
  лучший результат и сводка попыток — поля заявки (`best`, `summary`), статус результата считается при чтении;
  `dns` не пишется задачей. Причины: тот же документ — замок участника (одна запись вместо двух), нет задачи
  «перевести в dns», нет второго источника правды. `final`/`dq`/`revised` и снимок строк — слайс 05 (`race_protocol_rows`
  + поля DQ заявки). Альтернативы: (1) `race_results` как в эпике — лишний документ и синхронизация; (2) только
  вычисление по попыткам при чтении — места требуют агрегации по всем попыткам гонки на каждый запрос. Рекомендация —
  поля заявки. Эпик §3.4 и §4 уточняются (§10).
- **Расхождение эпик ↔ здесь (`jobId`):** эпик §4 — `jobId = attempt-check:<attemptId>:<checkRevision>`. → Постановка
  через outbox (`jobId` = id события, атомарно с созданием попытки, как во всём проекте); идемпотентность — условие
  `checkRevision` в захвате и записи. Тот же эффект, без постановки в очередь из транзакции.
- **Расхождение эпик ↔ здесь (`not_matched` как статус):** эпик — статус попытки. → Хранится вердикт `rejected` и
  `matched`; «скрыта» — вычисление по `origin` (§7.4). Явный запрос по той же активности позже делает отказ видимым
  без перепроверки.
- **Недоопределено → решено (V-12 «окно»):** «первая заявка фиксирует окно» противоречит V-11 («в открытом окне конец
  окна можно продлить»). → V-12 строже и применяется поверх V-11: с первой заявки окно не меняется целиком (продление
  тоже) — честность для заявившихся. Название, описание, плановая дата протокола — по V-11. Вопрос автору — A14.
- **Недоопределено → решено (A5 «загрузка + 24 ч» для импорта):** граница — время **приёма** файла сервером
  (`track_uploads.createdAt`), не время разбора и не время запроса: очередь разбора не лишает попытки, а клиентское
  время не участвует.
- **Недоопределено → решено (A8):** «авто-несовпадение не показывается как отказ» — скрываются автоматические
  попытки без полного сегмента старт→финиш (`no_start`, `no_finish`, без касания коридора) и `implausible`; отказ при
  полном сегменте (сход, пропуск участка, окно, разрыв, редкая запись) — виден: райдер проехал гонку и должен знать
  причину.
- **Недоопределено → решено (коридор, негодный для движка):** `prepareCorridor` отвергает линейный маршрут с
  пересекающимися воротами и линию плотнее 32 отрезков в ячейке — сейчас это обнаружилось бы только на попытках
  после фиксации коридора. → Ворота проверяются при выборе коридора (`CORRIDOR_GATES_OVERLAP`), плотность — попытка
  `failed: corridor_invalid` (видна в панели) + follow-up проверки при разборе маршрута.
- **Конфликт с кодом (outbox):** событие одного типа уходит в одну очередь — `tracks.upload-deleted` уже у `devices`.
  → Свои типы `tracks.activity-ready` / `tracks.activity-removed`. Ограничение базы фиксируется в ADR-0012 (последствия)
  — слайсам 05/08 (`standings`) нужен свой тип на подписчика.
- **Конфликт с инфраструктурой:** третий поток разбора в worker 512 МиБ (R4) → семафор.
- **Пробел модели (имена в таблице):** прототип показывает имя, клуб/тренера и «Участник» без имени; в продукте нет
  имени райдера (identity — e-mail и дата рождения, профиль — опрос). → Строки анонимны («Участник», своя — «Вы» по
  `entryId`); контракт строки расширяемый (поле `rider` добавится необязательным). Решение автора — A12.
- **Публичная таблица: 03 или 04?** → **03 (API), 04 (UI).** Места «при чтении» — главная гарантия слайса; их
  int-тесты (ничья, граница страниц, отмена участия, отрицательное доказательство замка) должны проверять тот же
  код, который отдаёт таблицу. В 04 остаётся только экран. Без ПДн: строка = `entryId`, место, `tied`, время сегмента
  (без времени суток заезда, `userId`, активности).
- **Вредное решение:** нет находок.

### Вопросы (по умолчанию — рекомендация; блокирующих нет)

| № | Вопрос | Варианты | По умолчанию |
|---|---|---|---|
| Q1 | Публичная предварительная таблица | 03 (API) + 04 (UI) / всё в 04 | **03 + 04** (§8.1) |
| Q2 | «Загрузить в гонку» | (1) два шага: `POST /tracks/uploads` → `POST /races/:id/attempts { uploadId }`; (2) свой эндпоинт загрузки в `results`; (3) `?raceId` на загрузке `tracks` | **(1)** — одна точка приёма файлов (лимиты, семафор, сигнатура), `tracks` о гонках не знает; сбой между шагами покрывает автоматическая попытка |
| Q3 | Заявка после заезда: подхватывать прошлые заезды в окне | да (событие `entry-created`) / только «выбрать свой заезд» | **да** («проехал и забыл», A8) |
| Q4 | Какие автоматические отказы скрывать | без сегмента и `implausible` / все / никакие | **без сегмента и `implausible`** (§8.1) |
| Q5 | Повторная заявка после отмены | никогда / до открытия окна | **никогда** (прототип C1/H2) — автору A13 |
| Q6 | Когда можно отменить участие | `upcoming|open` / до срока загрузки | **`upcoming|open`** (прототип: «пока окно открыто») |
| Q7 | Предел попыток на заявку | 30 / без предела | **30** |
| Q8 | Где лучший результат | поля заявки / `race_results` | **поля заявки** (§8.1) |
| Q9 | Граница A5 для импорта | приём файла / разбор / запрос | **приём файла** (`track_uploads.createdAt`) |
| Q10 | Поля V-12 | коридор, окно, класс, покрытия / + название | **коридор, окно (оба конца), класс, покрытия** (эпик §3.2) |
| Q11 | Негодный коридор | проверка ворот при выборе + `failed` на попытке / только `failed` | **проверка ворот + `failed: corridor_invalid`** |
| Q12 | Потоков разбора на процесс worker | 1 / 2 + 768 МиБ | **1** (без смены инфраструктуры) |
| Q13 | Панель в 03 | API только чтения / + экран | **API**, экран — 05 |
| Q14 | Перепроверка гонки | механизм в 03, запуск и журнал — 05 / CLI в 03 | **механизм в 03** (журнал пересчётов append-only — 05) |
| Q15 | Сотрудник-организатор участвует в своей гонке | можно / нельзя | **можно** (правила нет в прототипе; споры — 06) |
| Q16 | Автоматическая попытка в очереди видна райдеру | да («проверка трека») / только после совпадения | **да**: после проверки несовпавшая исчезает |

### Требует решения автора (с рекомендацией)

- **A12 — имена в таблице результатов.** Модели имени райдера нет. Рекомендация: в 03–04 строки анонимные
  («Участник», своя — «Вы»), имя/клуб и настройка «скрывать имя в протоколах» — отдельный слайс профиля до первой
  настоящей гонки.
- **A13 — повторная заявка после отмены.** Прототип: никогда. Рекомендация: так и оставить (иначе «отменил — заявился
  заново» обнуляет смысл отмены после неудачных попыток).
- **A14 — окно после первой заявки.** V-12 фиксирует окно целиком — продлить окно из-за погоды нельзя. Рекомендация:
  оставить (честность для уже заявившихся); при необходимости — отмена гонки и новая.

# 8.2 Deviations from spec

**Решения (оркестратор, по рекомендации архитектора; автор может пересмотреть):**
- Q1–Q16 — приняты варианты «По умолчанию» из таблицы §8.1.
- A12 — строки таблицы анонимные: «Участник», своя — «Вы»; имена — позже, слайсом профиля.
- A13 — повторной заявки после отмены нет.
- A14 — V-12 фиксирует окно целиком (продление тоже запрещено).

**Отклонения реализации:** _дополняются по ходу._

# 8.3 Security checklist

Зона: `pokatim-security.md` (`modules/races/**`, `modules/tracks/**`, `modules/routes/**`, `packages/tracks/src/parse*`,
`src/parse-thread.ts`, `src/public-read.guard.ts`) + новый `modules/results/**` (добавить в `paths:`, §10).

- **AuthN/AuthZ:** приложение — только `AuthGuard` (`modules/identity/index.ts`), пользователь — `@CurrentUser()`;
  заявка — своя по `(raceId, userId из access)`; загрузка/активность — порт `ActivitySource` с `userId` вызывающего,
  чужая и неизвестная — один `404 NOT_FOUND`. Публичная таблица — `PublicReadGuard`, только опубликованные гонки.
  Панель — `PanelGuard` + `@RequirePermission('races.read')` + видимость гонки как в `races` (организатор — только свои,
  чужая — 404); `src/admin-routes.test.ts` обходит новый контроллер. Статусы, вердикты, время, места, `lockedAt`,
  `origin` — только сервер; клиент присылает id и намерение.
- **Входные данные:** `:raceId` — `Uuid`-pipe; тела — `strictObject` (`AttemptRequest` — ровно один из `uploadId` /
  `activityId`, `Uuid`); query — `strictObject`, `limit` в пределах, курсор — `page-cursor.ts` (ключ — схема,
  `id` — `Uuid`); в фильтры MongoDB — только примитивы после zod. Исходник — только из `TrackFileStore` по ключу
  документа (`STORAGE_KEY`), разбор — `runParseThread` (белый список функций, лимиты памяти/времени).
- **Данные наружу:** публично — `entryId`, место, `tied`, `elapsedSec`, счётчики; без `userId`, e-mail, активности,
  времени суток заезда, координат, датчиков. «Моё участие» — только свои попытки: сводка активности (дата, источник,
  длительность, дистанция), вердикт, метрики сегмента (без координат). Панель — `userId`, id активности и попытки,
  коды, метрики, `diagnostics`; без e-mail, координат, биометрии. `entryId` — UUID v7 (время заявки), не ПДн.
- **Злоупотребления:** лимиты `results-entry-user` 20/ч и `results-attempt-user` 30/ч (`RateLimiter`, ключ —
  `userId`); загрузки — существующие лимиты `tracks`; ≤ 30 попыток и ≤ 30 запросов на заявку; кандидаты ≤ 50;
  публичная таблица — IP-лимит `public-read` и кэш 60 с, страница ≤ 100; проверка — параллелизм 1, семафор потоков,
  30 с и 160/32 МБ на поток.
- **Секреты и логи:** логи — id, статусы, коды (§7.11); без координат, e-mail, датчиков, имён файлов.
- **Аудит:** заявка и отмена — действия райдера (статус заявки, `createdAt`/`withdrawnAt`), не журнал панели. Попытка
  хранит **текущий** вердикт (новая ревизия заменяет прежний); запись о пересчёте, исключения и споры — append-only
  (`race_recalculations`, `dispute_events`) в слайсах 05/06, которые и запускают перепроверку. `panel_audit` в 03 не
  пишется (панель только читает).

# 9. Acceptance Criteria

**Заявка и V-12**
- AC1. Вошедший райдер заявляется на опубликованную гонку с коридором в фазе `upcoming` или `open` → `201`,
  `MyRaceEntry.entry.status = active`; повтор → `200` с той же заявкой. Без коридора, `closed`, `cancelled` →
  `409 RACE_ENTRY_CLOSED` (`details.reason`); черновик/неизвестная → 404; без входа → 401.
- AC2. Первая заявка пишет `races.lockedAt`; после неё у гонки `editable.fields` без `corridor`, `windowStartsAt`,
  `windowEndsAt`, `bikeClass`, `surfaces`, `reasons` содержит `entries_locked`; их изменение → `400 FIELD_LOCKED`;
  название, описание, плановая дата протокола меняются как раньше.
- AC3. Параллельно первая заявка и смена коридора панелью: итог — либо заявка с новым коридором, либо `FIELD_LOCKED`
  для панели; никогда «заявка есть, коридор сменился после неё» (int, `holdTransaction`; отрицательное доказательство —
  `admitEntry` без записи).
- AC4. Отмена участия в `upcoming|open` → `withdrawn`, попытки сохранены, строки в таблице нет, места остальных
  сдвинулись; после закрытия окна → `409 RACE_WITHDRAW_CLOSED`; повторная заявка → `409 RACE_ENTRY_WITHDRAWN`.
- AC5. Коридор с линейным маршрутом, концы которого ближе `2·max(widthM, 30)` → поле `corridor.routeId`
  `CORRIDOR_GATES_OVERLAP`; круговой маршрут — без ошибки.

**Попытки**
- AC6. Импорт/загрузка заезда заявленного райдера, пересекающего окно и рамку маршрута, → попытка `auto` `queued` →
  `counted`/`rejected` без действий райдера; заезд вне окна, вне рамки, `cycling_indoor`, без заявки, с заявкой
  `withdrawn`, принятый после `closesAt + 24 ч` → попытки нет.
- AC7. Заявка, поданная после заезда в окне, → попытка по этому заезду (событие `entry-created`).
- AC8. «Выбрать свой заезд» (`{ activityId }`) → попытка `explicit`; существующая `auto` по той же активности
  становится `explicit` (скрытый отказ — виден). Чужая/неизвестная → 404; дубль группы → `409 ATTEMPT_SOURCE_INVALID`.
- AC9. «Загрузить в гонку» (`{ uploadId }`) до окончания разбора → запрос ждёт файл (`pendingUploads`), по готовности —
  попытка `explicit`; загрузка `failed` → в `pendingUploads` статус и причина; гонка запроса и `activity-ready` —
  без потерянного запроса (int, отрицательное доказательство без `lockEntry`).
- AC10. Дубли: в гонку идёт только основная активность группы; новая основная (FIT с мощностью после импорта Garmin)
  → попытка прежней — `withdrawn: not_primary`, новая проверяется; запрос по загрузке-дублю относится к основной.
- AC11. Удаление заезда → попытка `withdrawn: activity_removed`, лучший результат пересчитан; дубль, ставший основной,
  → новая попытка.
- AC12. После `uploadClosesAt` явная попытка → `409 ATTEMPT_UPLOAD_CLOSED`; до открытия окна — то же с причиной
  `window_not_open`; 31-я попытка → `409 ATTEMPT_LIMIT` (автоматическая — пропуск с логом).

**Проверка**
- AC13. `attempt-check` на фикстурах коридора (`clean.gpx` → `counted`, `elapsedSec` = эталон; `wobble-3pct.gpx` →
  `off_corridor`; `far-away.gpx` → скрытая для `auto`, видимая `no_start` для `explicit`) — значения совпадают с
  `corridor-expected.json`; `engineVersion = CORRIDOR_ENGINE_VERSION`, `checkedAt`, `diagnostics` записаны.
- AC14. Повтор задачи после итога и поздняя задача старой ревизии — no-op (int, отрицательное доказательство без
  `checkRevision` в фильтре).
- AC15. Сбой окружения → ретрай; последняя попытка → `failed: error`; таймаут потока → `failed: timeout` без ретрая;
  негодный коридор → `failed: corridor_invalid`; исходника нет → `failed: storage` (активность есть) /
  `withdrawn: activity_removed` (удалена). Панель: `counts.failed` и `attempts?status=failed` с кодом.
- AC16. Зависшая `checking` (> 15 мин) → `results-maintenance` ставит новую ревизию; после 3 — `failed: error`.

**Лучший результат и места**
- AC17. Лучшая — засчитанная попытка с минимальным `elapsedSec`; две параллельные проверки попыток одной заявки дают
  верный `best` (int, отрицательное доказательство без `lockEntry` — `best` худшая).
- AC18. Таблица: время 3600, 3700, 3700, 3800 → места «1, =2, =2, 4» (`tied`); равенство — по целым секундам
  (`Math.round` движка); ничья на границе страниц сохраняет место и `tied`; отменившие и без засчитанных — без строки.
- AC19. Статус результата по §7.4 (`none` → `pending` → `provisional` / `not_counted` → `dns` после срока).

**API и данные наружу**
- AC20. `GET /v1/races/:raceId/entry` — заявка, видимые попытки (без скрытых `auto` и `withdrawn`), результат с местом,
  `pendingUploads`, `uploadClosesAt`, действия с причинами; без заявки — `entry: null` и `canEnter`.
- AC21. Публичная таблица — без `userId`, активности, времени суток, координат (тест по ключам ответа); кэш 60 с;
  черновик — 404.
- AC22. Панель: модератор (`races.read`) читает сводку и попытки любой гонки; организатор — только своих (чужая —
  404); без сессии — 401; access JWT приложения — 401.
- AC23. Лимиты: 21-я заявка/отмена за час → 429; 31-я явная попытка за час → 429.

**Технические и архитектурные**
- AC24. Миграция `0015_results`: коллекции, индексы, бэкфилл `lockedAt: null`; повторный прогон — без изменений.
- AC25. `results` импортирует `races`, `routes`, `tracks`, `identity`, `panel` только через `index.ts`; обратных
  импортов нет; `pnpm arch:check` зелёный. Единственные писатели: `ResultsRepository` (`race_entries`,
  `race_attempts`), `RacesRepository` (`races.lockedAt`), `TracksRepository`.
- AC26. Поведение `tracks` (загрузки, дубли, удаление) и `routes` — тесты без изменений ожиданий; golden движка не
  изменился; `analyzeAttempt` вызывается только в worker через `runParseThread`; одновременно в процессе — один поток
  разбора (тест семафора).
- AC27. Контракты: коды `ATTEMPT_REJECTIONS` ⊇ `CORRIDOR_REJECTIONS` в том же порядке + `implausible` (тест-сторож);
  ответы приложения разбирают незнакомые значения как `unknown`.

# 10. Documentation Impact

- **`docs/adr/0012-race-results.md`** — раздел «Реализация п. 3–4, 6 (слайс 03)»:
  - заявка `race_entries` (одна на гонку и райдера, отмена мягкая, без повторной); первая заявка пишет `races.lockedAt`
    в транзакции заявки (порт `RaceRegistry.admitEntry` — запись в документ гонки каждой заявкой); V-12 — коридор,
    окно, класс, покрытия;
  - попытка `race_attempts` (гонка, основная активность) — `auto` по событиям `tracks.activity-ready/-removed` и
    заявке, `explicit` по запросу райдера; предфильтр — окно, рамка, время приёма файла < `closesAt + 24 ч`;
  - проверка `attempt-check`: outbox → `analyzeAttempt` в `runParseThread` (семафор 1) → вердикт ревизией
    `checkRevision` под `lockEntry`; финальный провал — `failed` с кодом, видим в панели;
  - лучший результат и сводка — поля заявки; места — при чтении, «1, =2, =2, 4» по целым секундам; публичная таблица
    анонимна;
  - последствия: тип события outbox → одна очередь (подписчикам — свои типы); коридор, негодный для движка, ловится
    при выборе (ворота) или попыткой `failed: corridor_invalid` (плотность).
  Строка реестра `docs/adr/README.md` — без изменений статуса (Accepted — по решению эпика после слайса 02, если ещё
  не переведён).
- **`docs/tasks/2026-10-27-race-results/epic.md`** — §3.4/§4: результат — поля заявки (без `race_results` до 05),
  `jobId` — id события outbox, `not_matched` — вычисляемая видимость, `results-intake`; §3.7 — порт `RouteGeometry`.
- **`docs/product/races-and-seasons.md`** — раздел «Участие и результат (слайс 03)»: кто и когда заявляется и
  отменяет, V-12, загрузка до окна + 24 ч, автоматические и явные попытки, скрытые несовпадения, лучшая попытка, места
  и ничья, таблица без имён (до A12); «Открыто» — убрать V-12.
- **`docs/product/tracks-and-devices.md`** — строка: заезд в окне гонки с заявкой становится попыткой автоматически;
  удаление заезда снимает попытку.
- **`docs/architecture/README.md`** — модуль `results` в «Есть», поток «Участие» (заявка → `admitEntry` → события
  `tracks` → `results-intake` → `attempt-check` → поток разбора → `race_attempts`/`race_entries`), очереди и семафор.
- **`.claude/rules/pokatim-backend.md`** — `results`: порты `RaceRegistry`, `RouteGeometry`, `ActivitySource`;
  события `tracks.activity-ready/-removed` (тип → одна очередь); `runParseThread` + `analyzeAttempt` + семафор.
- **`.claude/rules/pokatim-db.md`** — «Заявки и попытки»: единственный писатель `ResultsRepository`, `lockEntry`
  первой операцией (без него — HIGH), `admitEntry` — запись в документ гонки, `checkRevision` в фильтре, лучший
  результат в заявке, места при чтении в snapshot-сессии; `races.lockedAt` пишет только `RacesRepository`.
- **`.claude/rules/pokatim-contracts.md`** — `results/results.schema.ts` (`tolerantEnum`, `ATTEMPT_REJECTIONS` =
  движок + `implausible`), `results-admin.schema.ts` (строгие), публичная строка без ПДн.
- **`.claude/rules/pokatim-security.md`** — `paths:` + `apps/api/src/modules/results/**`; абзац «Участие и
  результаты» (владение по `userId`, анонимная таблица, лимиты, панель — видимость гонки).
- **`.claude/rules/pokatim-tests.md`** — int-тесты результатов: фикстуры коридора через `corridor-expected.json`
  (маршрут — `route_geometries` из эталона), отрицательные доказательства §5.5.
- `AGENTS.md`, `docs/runbooks` — без изменений (новых env и сервисов нет; лимит worker не меняется — Q12).

# 11. Implementation Context

### ENTRY POINTS
- API: `apps/api/src/modules/results/{race-entry.controller,results-public.controller,results-admin.controller}.ts`
  (новые).
- Worker: `apps/api/src/modules/results/{results-intake.processor,attempt-check.processor,
  results-maintenance.processor}.ts` (новые), `apps/api/src/worker.module.ts`.
- Порты: `modules/races/race-registry.port.ts`, `modules/routes/route-geometry.port.ts`,
  `modules/tracks/activity-source.port.ts` (новые).

### Порядок (каждый шаг — зелёные тесты своего пакета; один PR, три контрольные точки)

**A. Основа**
1. `packages/tracks`: `CorridorError`, `corridorGateRadiusM`, `boundsOf`/`boundsNear` + unit; golden без изменений.
2. Contracts + api-client + i18n (§7.10) + тесты схем (сторож `ATTEMPT_REJECTIONS`).
3. `parse-thread.ts`: `analyzeAttempt`, `corridor_invalid`, семафор + unit.
4. `routes`: `RouteGeometry`, `ReadyRoute.isLoop/endsDistanceM`; `races`: `lockedAt`, V-12, `CORRIDOR_GATES_OVERLAP`,
   `RacesCoreModule`, `RaceRegistry`; панель — причина и ошибка поля; unit + int (правка гонки с `lockedAt`).
5. `tracks`: события в `record`/`remove`, `ActivitySource`; int (события в outbox, порт, владение).

**B. Заявки и попытки**
6. `results`: коллекции, миграция `0015_results`, репозиторий (`lockEntry`, `refreshEntry`), политика + unit.
7. Заявка/отмена/моё участие, явные попытки, кандидаты; int (AC1–AC5, AC8, AC9, AC12, AC20, AC23).
8. `results-intake` (`syncGroup`, `entry-created`), `resultsOutboxRoutes`; int (AC6, AC7, AC10, AC11).

**C. Проверка, места, чтение**
9. `attempt-check` + `results-maintenance` + `ResultsRecheck`; int (AC13–AC17).
10. Публичная таблица и панель; int (AC18, AC19, AC21, AC22).
11. Документация §10; `pnpm check`; отрицательные доказательства §5.5 — результат в §12.

### FILES TO MODIFY
- `packages/tracks/src/{track.ts,geo.ts,parse.ts}`, `corridor/{prepare.ts,policy.ts}` (+ `geo.test.ts`,
  `prepare.test.ts`).
- `packages/contracts/src/{common.ts,index.ts,races/race.schema.ts}`, новые `results/{results.schema.ts,
  results-admin.schema.ts}` (+ тесты).
- `packages/api-client/src/{index.ts,admin.ts}` (+ `races.test.ts`, `admin.test.ts`).
- `packages/i18n/src/ru.ts`.
- `apps/api/src/{parse-thread.ts,queues.ts,worker.module.ts,app.module.ts,error-messages.ts}` (+ `parse-thread.test.ts`).
- `apps/api/src/modules/tracks/{tracks.events.ts,track-processing.processor.ts,track-uploads.service.ts,
  activity-groups.ts,tracks.module.ts,index.ts}`, новые `activity-source.port.ts`, `activity-source.ts`.
- `apps/api/src/modules/routes/{route-catalog.port.ts,route-catalog.ts,routes.module.ts,index.ts}`, новый
  `route-geometry.port.ts`.
- `apps/api/src/modules/races/{races.collection.ts,races.policy.ts,races.service.ts,races.repository.ts,races.module.ts,
  index.ts}`, новые `race-registry.port.ts`, `race-registry.ts`.
- Новый `apps/api/src/modules/results/{index.ts,results.module.ts,results.collection.ts,results.repository.ts,
  results.policy.ts,results.events.ts,entries.service.ts,attempts.service.ts,results-read.service.ts,attempt-intake.ts,
  results-recheck.ts,race-entry.controller.ts,results-public.controller.ts,results-admin.controller.ts,
  results-intake.processor.ts,attempt-check.processor.ts,results-maintenance.processor.ts}`.
- `apps/api/src/db/migrations/{0015_results.ts (новый),index.ts}`.
- `apps/api/test/{results.ts (новый: гонка с коридором из `corridor-expected.json`, заявка, загрузка фикстуры, прогон
  intake и проверки напрямую),races.ts,tracks.ts}`.
- `apps/admin/src/features/races/RaceEditor.tsx` (+ тест причины `entries_locked`).
- Документы §10.

### FILES TO READ
- `apps/api/src/modules/tracks/{track-processing.processor,track-uploads.service,activity-groups,tracks.repository}.ts`
  — запись активности, группы, удаление, захват и `finalAttempt`.
- `apps/api/src/modules/routes/{route-processing.processor,route-catalog}.ts` — порт и процессор с потоком.
- `apps/api/src/modules/races/{races.service,races.policy,races.repository}.ts`, `races-corridor.int.test.ts`.
- `apps/api/src/modules/devices/devices.events.ts` — подписка на чужое событие (маршрут у подписчика).
- `apps/api/test/{harness,identity,panel,races,routes,tracks}.ts` — `holdTransaction`, `untilBlocked`, сотрудник, гонка.
- `packages/tracks/src/__fixtures__/corridor/corridor-expected.json`, `src/parse.ts` (`analyzeAttempt`).
- Spec слайсов 01 (§5, §11) и 02 (§8.2, §11), эпик §3.2–§3.4, §4.

### TYPES & SCHEMAS

```ts
// packages/contracts/src/results/results.schema.ts — приложение и публичное
// contracts не зависит от @pokatim/tracks: коды движка повторены дословно, совпадение держит тест-сторож в apps/api
export const RACE_ENTRY_STATUSES = ['active', 'withdrawn'] as const;
export const ATTEMPT_ORIGINS = ['auto', 'explicit'] as const;
export const ATTEMPT_STATUSES = ['queued', 'checking', 'counted', 'rejected', 'failed', 'withdrawn'] as const;
export const ATTEMPT_REJECTIONS = [
  'no_start', 'no_finish', 'wrong_direction', 'missed_section', 'gps_gap', 'off_corridor', 'outside_window',
  'sparse_recording', 'implausible',
] as const;                                                    // = CORRIDOR_REJECTIONS + 'implausible'; только в конец
export const ATTEMPT_FAILURES = ['storage', 'timeout', 'unreadable', 'corridor_invalid', 'error'] as const;
export const ATTEMPT_WITHDRAW_REASONS = ['activity_removed', 'not_primary'] as const;
export const RACE_RESULT_STATUSES =
  ['none', 'pending', 'provisional', 'not_counted', 'dns', 'withdrawn'] as const;  // 05: + final, dq, revised
export const RACE_ENTRY_BLOCK_REASONS = [
  'no_corridor', 'cancelled', 'entries_closed', 'withdrawn', 'not_entered', 'window_not_open', 'window_closed',
  'upload_closed', 'attempt_limit',
] as const;
export const RESULT_GROUP_KEYS = ['overall'] as const;         // 07: кластеры

export const AttemptRequest = z.union([
  z.strictObject({ activityId: Uuid }),
  z.strictObject({ uploadId: Uuid }),
]);

export const AttemptSegment = z.object({
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), elapsedSec: z.number().int(),
  distanceM: z.number().int(), offCorridorM: z.number().int(), offCorridorShare: z.number(),
  maxExcursionM: z.number().int(), coverage: z.number(),
});
export const MyAttempt = z.object({
  id: Uuid,
  origin: tolerantEnum(ATTEMPT_ORIGINS),
  status: tolerantEnum(ATTEMPT_STATUSES),
  reasons: z.array(tolerantEnum(ATTEMPT_REJECTIONS)),          // [] у counted; первый — основной
  segment: AttemptSegment.nullable(),
  isBest: z.boolean(),
  activity: z.object({
    id: Uuid, startedAt: z.iso.datetime(), source: tolerantEnum(TRACK_SOURCES),
    elapsedSec: z.number().int(), distanceM: z.number().int(),
  }),
  createdAt: z.iso.datetime(), checkedAt: z.iso.datetime().nullable(),
});
export const PendingUpload = z.object({
  uploadId: Uuid, status: tolerantEnum(TRACK_UPLOAD_STATUSES), failure: tolerantEnum(TRACK_FAILURE_CODES).nullable(),
});
export const MyRaceEntry = z.object({
  raceId: Uuid,
  entry: z.object({
    id: Uuid, status: tolerantEnum(RACE_ENTRY_STATUSES),
    createdAt: z.iso.datetime(), withdrawnAt: z.iso.datetime().nullable(),
  }).nullable(),
  result: z.object({
    status: tolerantEnum(RACE_RESULT_STATUSES),
    elapsedSec: z.number().int().nullable(),
    place: z.number().int().nullable(), tied: z.boolean(),
    ranked: z.number().int(),                                   // строк в группе
    group: tolerantEnum(RESULT_GROUP_KEYS),
  }),
  attempts: z.array(MyAttempt),                                 // видимые, новые сверху, ≤ 30
  pendingUploads: z.array(PendingUpload),
  uploadClosesAt: z.iso.datetime(),
  actions: z.object({
    canEnter: z.boolean(), canWithdraw: z.boolean(), canAddAttempt: z.boolean(),
    reasons: z.array(tolerantEnum(RACE_ENTRY_BLOCK_REASONS)),
  }),
});
export const AttemptCandidates = z.object({
  items: z.array(z.object({
    activityId: Uuid, startedAt: z.iso.datetime(), source: tolerantEnum(TRACK_SOURCES),
    elapsedSec: z.number().int(), distanceM: z.number().int(), attempted: z.boolean(),
  })),
});
export const RaceResultsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: PageCursor.optional(),
});
export const RaceResultRow = z.object({
  entryId: Uuid, place: z.number().int(), tied: z.boolean(), elapsedSec: z.number().int(),
});
export const RaceResultsPage = z.object({
  group: tolerantEnum(RESULT_GROUP_KEYS),
  status: tolerantEnum(['provisional'] as const),               // 05: + final
  ranked: z.number().int(), entries: z.number().int(),
  items: z.array(RaceResultRow), nextCursor: z.string().nullable(),
});

// results-admin.schema.ts — панель, строгие enum
export const PanelRaceResults = z.object({
  raceId: Uuid, lockedAt: z.iso.datetime().nullable(), engineVersion: z.number().int(),   // текущая версия движка
  counts: z.object({
    entries: z.number().int(), active: z.number().int(), withdrawn: z.number().int(), ranked: z.number().int(),
    attempts: z.record(z.enum(ATTEMPT_STATUSES), z.number().int()),
    hidden: z.number().int(), failed: z.number().int(), staleEngine: z.number().int(),
  }),
});
export const PanelRaceAttempt = z.object({
  id: Uuid, entryId: Uuid, userId: Uuid, activityId: Uuid, origin: z.enum(ATTEMPT_ORIGINS),
  status: z.enum(ATTEMPT_STATUSES), hidden: z.boolean(), reasons: z.array(z.enum(ATTEMPT_REJECTIONS)),
  failure: z.enum(ATTEMPT_FAILURES).nullable(), withdrawReason: z.enum(ATTEMPT_WITHDRAW_REASONS).nullable(),
  segment: AttemptSegment.nullable(), engineVersion: z.number().int().nullable(),
  checkRevision: z.number().int(), checkAttempts: z.number().int(),
  diagnostics: z.object({ corridorLengthM: z.number().int(), declaredDistanceM: z.number().int(),
    geometryLimited: z.boolean() }).nullable(),
  createdAt: z.iso.datetime(), checkedAt: z.iso.datetime().nullable(),
});
export const PanelRaceAttemptQuery = z.strictObject({
  status: z.enum(ATTEMPT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: PageCursor.optional(),
});
export const PanelRaceAttemptPage = z.object({ items: z.array(PanelRaceAttempt), nextCursor: z.string().nullable() });

// common.ts: ErrorCode += 'RACE_ENTRY_CLOSED','RACE_ENTRY_WITHDRAWN','RACE_ENTRY_REQUIRED','RACE_WITHDRAW_CLOSED',
//   'ATTEMPT_UPLOAD_CLOSED','ATTEMPT_LIMIT','ATTEMPT_SOURCE_INVALID'; SCHEDULE_FIELD_ERROR_CODES += 'CORRIDOR_GATES_OVERLAP'
// race.schema.ts: RACE_EDIT_BLOCK_REASONS += 'entries_locked'
```

```ts
// apps/api/src/modules/results/results.collection.ts
export const RESULTS_COLLECTIONS = { entries: 'race_entries', attempts: 'race_attempts' } as const;

export interface RaceEntryDoc {
  _id: string; raceId: string; userId: string;
  status: 'active' | 'withdrawn';
  groupKey: 'overall'; tier: null;                       // A3: 07 — кластеры и уровень
  requests: { uploadId: string; activityId: string | null; requestedAt: Date; attemptId: string | null }[];
  best: { attemptId: string; elapsedSec: number; startedAt: Date; finishedAt: Date } | null;
  summary: { total: number; pending: number; counted: number; rejectedShown: number; failed: number };
  createdAt: Date; updatedAt: Date; withdrawnAt: Date | null;
  version: number;                                        // lockEntry
}

export interface RaceAttemptDoc {
  _id: string; raceId: string; entryId: string; userId: string;
  activityId: string; uploadId: string;
  origin: 'auto' | 'explicit';
  status: 'queued' | 'checking' | 'counted' | 'rejected' | 'failed' | 'withdrawn';
  matched: boolean | null;                                // полный сегмент старт→финиш (видимость auto)
  reasons: AttemptRejection[];
  failure: AttemptFailure | null;
  withdrawReason: 'activity_removed' | 'not_primary' | null;
  segment: CorridorSegment | null;                        // как в движке (Date, целые метры); без координат и датчиков
  touchedCorridor: boolean | null; candidates: number | null;
  diagnostics: { corridorLengthM: number; declaredDistanceM: number; geometryLimited: boolean } | null;
  engineVersion: number | null;
  corridor: { routeId: string; widthM: number };          // снимок на момент создания (V-12 — не меняется)
  checkRevision: number; checkAttempts: number; requeues: number;
  createdAt: Date; updatedAt: Date; checkedAt: Date | null;
}

// results.events.ts
export const RESULTS_ENTRY_CREATED = 'results.entry-created';            // { entryId }
export const RESULTS_ATTEMPT_CHECK_REQUESTED = 'results.attempt-check-requested'; // { attemptId, checkRevision }
export const resultsOutboxRoutes = {
  [TRACK_ACTIVITY_READY]: QUEUE.resultsIntake,
  [TRACK_ACTIVITY_REMOVED]: QUEUE.resultsIntake,
  [RESULTS_ENTRY_CREATED]: QUEUE.resultsIntake,
  [RESULTS_ATTEMPT_CHECK_REQUESTED]: QUEUE.attemptCheck,
} as const;
```

```ts
// modules/races/race-registry.port.ts
export const RACE_REGISTRY = Symbol('RACE_REGISTRY');
export interface RaceForResults {
  id: string; ownerUserId: string; status: RaceStatus; title: string;
  windowStartsAt: Date; windowEndsAt: Date; closesAt: Date;    // closesAt = windowEndsAt + 1 мин (R12)
  protocolPlannedAt: Date; corridor: RaceCorridor | null; lockedAt: Date | null;
}
export interface RaceRegistry {
  /** Первая операция транзакции заявки: запись lockedAt ??= now в документ опубликованной гонки. */
  admitEntry(tx: DbSession, raceId: string, now: Date): Promise<RaceForResults | null>;
  get(raceId: string, tx?: DbSession): Promise<RaceForResults | null>;   // только published | cancelled
  findForPanel(principal: PanelPrincipal, raceId: string): Promise<RaceForResults | null>;
  phase(race: RaceForResults, now: Date): RacePhase;                    // racePhase из races.policy
}

// modules/routes/route-geometry.port.ts
export const ROUTE_GEOMETRY = Symbol('ROUTE_GEOMETRY');
export interface RouteGeometry {
  matchGeometry(routeId: string): Promise<Omit<CorridorGeometry, 'widthM'> | null>;   // только ready
  bounds(routeId: string): Promise<Bounds | null>;
}
// ReadyRoute += isLoop: boolean; endsDistanceM: number

// modules/tracks/activity-source.port.ts
export const ACTIVITY_SOURCE = Symbol('ACTIVITY_SOURCE');
export interface ActivityRef {
  id: string; userId: string; uploadId: string; uploadCreatedAt: Date;
  isPrimary: boolean; primaryId: string;                 // primaryId = duplicateOf ?? id
  sport: ActivitySport; source: TrackSource;
  startedAt: Date; endedAt: Date; elapsedSec: number; distanceM: number;
  bounds: Bounds;
}
export interface ActivitySource {
  group(activityId: string, tx?: DbSession): Promise<{ userId: string; members: ActivityRef[] } | null>;
  activity(userId: string, activityId: string, tx?: DbSession): Promise<ActivityRef | null>;
  uploadState(userId: string, uploadId: string, tx?: DbSession): Promise<{
    status: TrackUploadStatus; failure: TrackFailureCode | null; createdAt: Date; activity: ActivityRef | null;
  } | null>;
  uploadStates(userId: string, uploadIds: readonly string[]): Promise<Map<string,
    { status: TrackUploadStatus; failure: TrackFailureCode | null }>>;
  listInRange(userId: string, from: Date, to: Date, limit: number): Promise<ActivityRef[]>;   // основные
  readSource(activityId: string): Promise<{ bytes: Uint8Array; format: TrackFormat } | null>;  // worker
}

// tracks.events.ts
export const TRACK_ACTIVITY_READY = 'tracks.activity-ready';
export const TrackActivityReady = z.object({ activityId: z.uuid(), uploadId: z.uuid(), userId: z.uuid() });
export const TRACK_ACTIVITY_REMOVED = 'tracks.activity-removed';
export const TrackActivityRemoved = z.object({
  activityId: z.uuid(), uploadId: z.uuid(), userId: z.uuid(), primaryActivityId: z.uuid().nullable(),
});

// packages/tracks
export class CorridorError extends Error {}                       // corridor/prepare.ts; экспорт из ./parse
export const corridorGateRadiusM = (widthM: number) => Math.max(widthM, 30);   // track.ts (лёгкий вход)
export type Bounds = [minLon: number, minLat: number, maxLon: number, maxLat: number];
export function boundsOf(coords: readonly [number, number][]): Bounds | null;  // geo.ts
export function boundsNear(a: Bounds, b: Bounds, marginM: number): boolean;

// parse-thread.ts
export const PARSE_FUNCTIONS = ['analyzeTrack', 'analyzeRoute', 'analyzeAttempt'] as const;
export const PARSE_THREADS_MAX = 1;
```

Индексы `0015_results`:
- `race_entries`: `race_entries_race_user_unique { raceId: 1, userId: 1 }` unique; `race_entries_user_idx { userId: 1,
  status: 1 }`; `race_entries_ranking_idx { raceId: 1, groupKey: 1, 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 }`
  partial `{ status: 'active', best: { $type: 'object' } }`; `race_entries_race_idx { raceId: 1, status: 1 }` (счётчики).
- `race_attempts`: `race_attempts_race_activity_unique { raceId: 1, activityId: 1 }` unique;
  `race_attempts_entry_idx { entryId: 1, _id: -1 }`; `race_attempts_activity_idx { activityId: 1 }`;
  `race_attempts_race_status_idx { raceId: 1, status: 1, _id: -1 }` (панель); `race_attempts_stuck_idx { status: 1,
  updatedAt: 1 }` partial `{ status: { $in: ['queued', 'checking'] } }`.
- `races`: бэкфилл `lockedAt: null`; новых индексов нет.

Очереди: `QUEUE.resultsIntake = 'results-intake'` (параллелизм 2), `QUEUE.attemptCheck = 'attempt-check'`
(параллелизм 1), `QUEUE.resultsMaintenance = 'results-maintenance'` (расписание `results.maintenance` `*/10 * * * *`,
`Europe/Minsk`, upsert как `TRACKS_SCHEDULES`).

### TESTS

| Уровень | Что |
|---|---|
| unit `packages/tracks` | `boundsOf`/`boundsNear` (антимеридиан не нужен — Беларусь; пустой вход; маржа в метрах по широте); `CorridorError` на `gates overlap`/`line too dense`; `corridorGateRadiusM` = `CORRIDOR_POLICY.gateRadius`; golden без изменений |
| unit contracts | `AttemptRequest` (ровно одно поле, лишние ключи — ошибка); `MyRaceEntry`/`RaceResultsPage` с незнакомыми значениями → `unknown`; строгие панельные; сторож: `ATTEMPT_REJECTIONS.slice(0, -1)` = значения `CORRIDOR_REJECTIONS` (тест в `apps/api`, где доступны оба) |
| unit API | `results.policy`: `entryActions` по фазам и статусам; `uploadClosesAt`; `mayMatch` (окно границы `closesAt`, рамка, indoor, время приёма); `pickBest` (равенство → раньше старт → `_id`); `rank` «1,=2,=2,4», граница страницы; `resultStatus` по §7.4; `hidden`; `races.policy`: `LOCKED_BY_ENTRIES`, `entries_locked`, `CORRIDOR_GATES_OVERLAP`; `parse-thread`: белый список, `corridor_invalid`, семафор (второй вызов ждёт первый) |
| int API (реальный MongoDB) — заявки | AC1–AC5, AC23; первая заявка ↔ правка коридора/окна и ↔ отмена гонки (`holdTransaction`), отрицательное доказательство `admitEntry` без записи; две одновременные заявки — одна |
| int — попытки | AC6–AC12: события `activity-ready`/`removed` в outbox при загрузке, импорте потока и удалении; `syncGroup` при смене основной; запрос по загрузке до/после разбора; гонка запроса и `activity-ready` (отрицательное доказательство без `lockEntry`); граница A5 по `track_uploads.createdAt`; чужие id — 404 |
| int — проверка | AC13–AC16 через `AttemptCheckProcessor.check(attemptId, revision, { finalAttempt })` напрямую (как `processUpload`): фикстуры `clean`/`wobble-3pct`/`far-away` с коридором из `corridor-expected.json`; повтор и старая ревизия (отрицательное доказательство); подмена `analyze` для `timeout`/исключения/`corridor_invalid`; нет файла; maintenance |
| int — места и чтение | AC17 (параллельные вердикты под `holdTransaction`, отрицательное доказательство без `lockEntry`); AC18–AC22: таблица с ничьими и страницами (limit 2), отмена участия сдвигает места, ключи публичного ответа без ПДн, `Cache-Control`, панель 401/404/права, `counts` и `status=failed`; `src/admin-routes.test.ts` видит контроллер |
| int — миграция | `0015_results`: индексы, бэкфилл, повторный прогон без изменений |
| int — регрессия | `track-uploads.int.test.ts`, `devices-sync.int.test.ts`, `routes-admin.int.test.ts`, `races-*.int.test.ts` без изменений ожиданий (кроме новых случаев `lockedAt`) |
| unit admin (RTL) | `RaceEditor`: причина `entries_locked` под формой, поля с замком; ошибка поля `CORRIDOR_GATES_OVERLAP` |
| e2e | нет новых (UI — 04/05); существующие `pnpm e2e:admin`/`e2e:web` зелёные |

Отрицательные доказательства (`pokatim-tests.md`), результат — в §12: (1) `admitEntry` без записи — AC3 красный;
(2) без `lockEntry` в вердикте — AC17 красный; (3) без `lockEntry` в запросе по загрузке — AC9 красный; (4) без
`checkRevision` в фильтре — AC14 красный; (5) без семафора — тест семафора красный.

### OUT OF SCOPE
§4.

# 12. Outcome

_Заполняет реализация._
