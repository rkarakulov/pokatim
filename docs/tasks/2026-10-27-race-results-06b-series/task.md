# 1. Title

Результат гонки, слайс 06b: ряды пульса и мощности на разборе спора. Панель по кнопке запрашивает ряды оспоренного
результата; worker `dispute-series` строит их из исходника трека (поток разбора), прореживает по дистанции сегмента
старт→финиш и кладёт в кэш Redis с TTL; панель опрашивает «готовится» → рисует графики пульса, мощности и скорости по
дистанции. Биометрия не хранится в БД и не пишется в логи (ADR-0011 п. 9, `pokatim-security`).

# 2. Goal

Эпик `docs/tasks/2026-10-27-race-results/epic.md` §3.5, §4 (очередь `dispute-series`), §7 (строка 06b);
`docs/tasks/2026-10-27-race-results-06-disputes/task.md` §4, §8.2 DV-2 (ряды вынесены сюда). Категории спора
`speed_vs_heart_rate`, `heart_rate_doubtful`, `vehicle_assistance` команда платформы разбирает по рядам заезда: скорость
против пульса и мощности на одном отрезке. Слайс 06 дал разбор без биометрии.

Клиент присылает только id спора; что показывать (лучшая засчитанная попытка цели, сегмент между воротами) и ряды
считает сервер (`AGENTS.md` §4.1).

Источники: `AGENTS.md` §1, §4; ADR-0011 (п. 6, 7, 9), ADR-0012 (п. 8); `.claude/rules/{pokatim-backend,pokatim-db,
pokatim-contracts,pokatim-web,pokatim-security,pokatim-tests}.md`; прототип «Панель — результаты и спор»
(конфиденциален — только решения). Код сверен по `origin/develop` @ `88385e8`.

# 3. Scope

**`packages/tracks`**
- `src/series.ts` — чистая `buildSeries(points, segment, maxBins)`: точки в `[startedAt, finishedAt]` сегмента,
  накопленная дистанция по точкам, ячейки равной дистанции (≤ `SERIES_MAX_BINS` = 400, не уже `SERIES_MIN_BIN_M` = 25 м); в ячейке —
  средний пульс, средняя мощность (по точкам с датчиком), скорость = дистанция пар / время пар ячейки; сводка
  (средние и максимумы). Нет пульса/мощности в сегменте — ряд `null`.
- `parse.ts` — `analyzeSeries(bytes, format, segment, now)`: `loadTrack` → `buildSeries`. Экспорт только из
  серверного входа `@pokatim/tracks/parse`.

**Contracts / api-client / i18n**
- `disputes-admin.schema.ts` (в конец): `DISPUTE_SERIES_UNAVAILABLE` (`no_result`, `no_source`, `failed`),
  `PanelDisputeSeriesData`, `PanelDisputeSeries` = `{ state: 'preparing' } | { state: 'ready', series } |
  { state: 'unavailable', reason }` (§7.1).
- `audit.schema.ts`: `AUDIT_ACTIONS` + `disputes.series_viewed` (в конец).
- `packages/api-client`: `getDisputeSeries(disputeId)`.
- `ru.ts`: блок `admin.disputes.series.*`, `admin.audit.action.disputes.series_viewed` (если карта действий журнала есть).

**API — `results`**: порт `ResultsForDisputes.bestSegment(entryId)` → `{ attemptId, activityId, checkRevision,
startedAt, finishedAt } | null` (лучшая попытка заявки, `counted`, с сегментом).

**API — `disputes`**
- `GET /v1/admin/disputes/:disputeId/series` — `disputes.read` → `PanelDisputeSeries` (`DisputeSeriesService`).
- `DisputeSeriesCache` (Redis): готовые ряды `dispute-series:ready:<attemptId>:<rev>` TTL 15 мин, отказ
  `dispute-series:failed:<attemptId>:<rev>` TTL 2 мин, постановка `dispute-series:pending:<attemptId>:<rev>` (NX, 120 с).
- Очередь `dispute-series` (`QUEUE.disputeSeries`), `DisputeSeriesProcessor` в `DisputesWorkerModule`
  (`WorkerModule`): задача `{ entryId, attemptId, checkRevision }` → сверка, что лучшая попытка та же → исходник через
  `ActivitySource.readSource` (`modules/tracks/index.ts`) → `runParseThread('analyzeSeries')` (белый список, семафор
  `PARSE_THREADS_MAX`, `DEFAULT_PARSE_LIMITS`) → кэш.
- Журнал `panel_audit`: `disputes.series_viewed` — один раз на (сотрудник, спор) в час.

**Панель (`apps/admin`)**: на разборе спора блок «Пульс и мощность» — кнопка «Показать пульс и мощность» →
опрос (2 с) «Ряды готовятся…» → три графика по дистанции (пульс, мощность, скорость; inline SVG, без новой
зависимости) со сводкой; «нет данных» по ряду; отказ — текст причины и «Повторить».

**Docs** — §10.

# 4. Out of Scope

- Ряды заявителя для сравнения (решение §8 D1); NP, FTP, вес, W/kg (нет профиля с весом и FTP); «Требует внимания»
  (`HR_POWER_DECOUPLED`, слайс 07).
- Каденс, высота, карта трека (карта — отдельный слайс).
- Ряды вне разбора спора (приложение, протокол, публичное) — запрещены R9.
- Предрасчёт рядов при подаче спора — только по запросу панели.
- Пульс и мощность из потока агрегатора: `pokatim.stream.v1` хранит только флаги датчиков (ADR-0011 п. 9) — для
  импортов Garmin/Wahoo будет только скорость.

# 5. Architecture Context

- `packages/tracks` → `apps/api` (worker) → `packages/contracts` → `packages/api-client` → `apps/admin`.
- `disputes` → `results` (порт `ResultsForDisputes`, через `index.ts`), `disputes` → `tracks` (порт
  `ActivitySource.readSource`, через `index.ts`; новая зависимость, циклов нет — `tracks` о `disputes` не знает).
- HTTP только читает кэш и ставит задачу; разбор — только worker (`runParseThread`). Записей в MongoDB нет, кроме
  журнала `panel_audit` (в транзакции); outbox не нужен (событие не доменное: результат — кэш).
- Миграций нет. Контракты — только добавления в конец (enum журнала — в конец).

## 5.1 Placement & Reuse Gate

- Reuse: `loadTrack` (разбор + очистка + правдоподобие), `haversineMeters`, `runParseThread` + `PARSE_FUNCTIONS`,
  `DEFAULT_PARSE_LIMITS`, `ActivitySource.readSource`, `RateLimiter`, `REDIS` из `@rkarakulov/api-kit/core`,
  `PanelAudit.append`, `PanelGuard`/`RequirePermission`, `disputeNotFound`, admin `useQuery`/`panelQueryKey` паттерн
  `disputes-query.ts`, `DisabledReason`/`Button`/`Card` из `@rkarakulov/ui`.
- Дубли запрещены: второй поток разбора, свой парсер FIT/GPX в `disputes`, чтение `race_attempts`/`activities` из
  `disputes`, графическая библиотека ради трёх линий.
- Тонкий контроллер (`DisputesAdminController.series`) → `DisputeSeriesService`; кэш — отдельный класс; чистая
  функция рядов — в пакете.

## 6. Relevant Files

- `packages/tracks/src/series.ts`, `parse.ts` — ряды, вход worker.
- `apps/api/src/parse-thread.ts` — белый список.
- `apps/api/src/queues.ts`, `worker.module.ts` — очередь и модуль worker.
- `apps/api/src/modules/results/results-for-disputes{.port,}.ts` — `bestSegment`.
- `apps/api/src/modules/disputes/dispute-series.{service,cache,processor}.ts`, `disputes-admin.controller.ts`,
  `disputes.module.ts`, `disputes.policy.ts` — эндпоинт, кэш, задача.
- `packages/contracts/src/disputes/disputes-admin.schema.ts`, `audit` — контракт.
- `apps/admin/src/features/disputes/{DisputeSeries,SeriesChart}.tsx`, `DisputeScreen.tsx`, `disputes-query.ts`.

## 7. Implementation Notes

### 7.1 Эндпоинт

`GET /v1/admin/disputes/:disputeId/series` (`PanelGuard`, `disputes.read`, `no-store` от гарда):
1. Спор → `404 DISPUTE_NOT_FOUND`. Журнал `disputes.series_viewed` (Redis NX `dispute-series:audit:<staff>:<id>`
   1 ч → `PanelAudit.append` в транзакции; `subject: race`, `details: { disputeId, entryId }`, `reason: null`).
2. `bestSegment(targetEntryId)` → `null` — `{ state: 'unavailable', reason: 'no_result' }`.
3. Кэш `ready` → `{ state: 'ready', series }`; `failed` → `{ state: 'unavailable', reason }`.
4. Иначе `SET pending NX EX 120`: удалось — лимит `dispute-series-user` 30/ч на сотрудника (отказ — снять pending,
   `429 RATE_LIMITED`), `queue.add('dispute-series.build', { entryId, attemptId, checkRevision }, { attempts: 2,
   backoff, removeOnComplete, removeOnFail })`; ответ `{ state: 'preparing' }` (опрос не тратит лимит).

`series`: `{ segmentDistanceM, distanceM: number[], heartRate: (number|null)[] | null, power: (number|null)[] |
null, speedKmh: (number|null)[], summary: { avgHeartRate, maxHeartRate, avgPower, maxPower, avgSpeedKmh } }`
(целые bpm/Вт, скорость — 0,1 км/ч; длины массивов равны, ≤ 400). Без координат и времени точек.

### 7.2 Worker

`DisputeSeriesProcessor` (`concurrency: 1`): `bestSegment(entryId)` — нет или другая попытка/ревизия → снять pending,
`skipped`. `readSource(activityId)` → `null` — кэш `failed: no_source`. Поток: `ok` → `ready`; код (`timeout`,
`unreadable`, `implausible`, …) → `failed: failed`. Сбой окружения — исключение (ретрай BullMQ), на последней попытке
— `failed: failed`. Pending снимается в конце всегда. Лог: `attempt`, `rev`, итог, код, число ячеек, мс — без значений.

### 7.3 Ряды (`buildSeries`)

Точки с `time` в `[startedAt, finishedAt]`; дистанция — сумма haversine пар; ячейка `k = min(floor(d / bin), n-1)`,
`n = max(1, min(400, floor(D / 25)))`, `bin = D / n`; пара (i-1, i) относится к ячейке точки i (её дистанция и dt —
в скорость ячейки); пульс/мощность — среднее значений точек ячейки, `null` — нет значений. `distanceM[k]` — конец
ячейки (м, целое). Меньше 2 точек в сегменте — пустые ряды, `segmentDistanceM: 0`.

### 7.4 Панель

`DisputeScreen` → блок под результатом: `Card` «Пульс и мощность» + текст «Видит только команда платформы, не
сохраняется» + кнопка. `DisputeSeries`: `useQuery(['panel','disputes',id,'series'])`, `refetchInterval` 2000 пока
`preparing` (не дольше 3 мин — затем «Не удалось подготовить ряды» и «Повторить»); `gcTime` 0 — биометрия не
задерживается в кэше клиента после ухода с экрана. `SeriesChart` — SVG-линия по дистанции (ось X — км, общая для
трёх графиков), подпись оси Y (мин/макс), сводка текстом; `role="img"` + `aria-label` со сводкой; разрывы — `null`.

# 8. Risks / Assumptions / Open Questions

- D1 **Только оспоренный результат.** Ряды заявителя не нужны для категорий спора (они о треке цели) и расширили бы
  обработку биометрии второго человека — минимизация (R9). Сравнение — follow-up по запросу команды.
- D2 **Право** — `disputes.read` (admin, moderator), отдельного права нет: разбор спора и есть «право на споры».
  Ряды доступны и после решения спора (тот же экран разбора), `[ASSUMPTION]`.
- D3 **Кэш в Redis** — биометрия в памяти Redis до 15 мин; при включённом RDB/AOF может попасть в снимок на диск до
  истечения TTL — принято (эпик §4 «кэш Redis с TTL»); ключи — только id.
- D4 Поток агрегатора без пульса/мощности (ADR-0011 п. 9) — для импортов только скорость; текст «нет данных пульса».
- D5 Мощность 0 в FIT пакет отбрасывает (`positiveNumber`) — средняя мощность ячейки без накатов; приемлемо для
  разбора (видны пики и провалы), не для NP.
- R1 Нагрузка: один поток разбора на процесс (семафор) — ряды встают в очередь за сверкой попыток; лимит 30/ч.

## 8.1 Requirements Consistency

Самопроверка автора (task2, без architect): противоречий нет. «Результат заявителя, если нужно для сравнения» — решено
D1. «NP, FTP, вес» эпика §3.5 — вне слайса (§4): FTP и веса в системе нет.

## 8.2 Deviations from spec

- DV-1 (spec) Human gate плана пройден в автономном режиме (поручение сессии-родителя: автономная работа, push/PR/merge
  без вопросов); продуктовые решения D1–D2 зафиксированы здесь.
- DV-2 (coder) Минимальная ячейка — 25 м, а не 10 м (§7.3 исходной редакции): при записи раз в секунду на 40 км/ч
  (≈ 11 м между точками) ячейки по 10 м через одну пустые — график рвётся. 25 м — 2–3 точки на ячейку.
- DV-3 (coder) Действие журнала — `disputes.series_viewed` (snake_case суффикса, как `results.attempt_excluded`), не
  `disputes.series-viewed` (исходная редакция).
- DV-4 (coder) Ключи Redis: `dispute-series:{ready|failed|pending}:<attemptId>:<rev>` и
  `dispute-series:viewed:<staffId>:<disputeId>` (отметка журнала). Задача ставится без jobId: дедупликация — ключ
  pending (NX); процессор пропускает задачу, если ряды этой ревизии уже готовы.
- DV-5 (coder) Отказ разбора `failed` в панели предлагает «Повторить» (через 2 мин отказ истекает, запрос поставит
  задачу снова); `no_result` и `no_source` — без повтора.

## 8.3 Security checklist

- AuthN/AuthZ: `PanelGuard` + `RequirePermission('disputes.read')`; приложение и публичные маршруты рядов не имеют;
  тест обхода `admin-routes.test.ts` покрывает новый маршрут.
- Вход: только `disputeId` (`Uuid` pipe); что считать — сервер (лучшая попытка цели).
- Данные наружу: прореженные ряды (≤ 400) только в ответе этого эндпоинта; без координат, времени точек, id
  активности и загрузки; `no-store`; клиент — `gcTime: 0`.
- Хранение: в MongoDB — ничего (кроме журнала доступа без значений); Redis — TTL 15 мин / 2 мин; в job data — только id.
- Логи: id, ревизия, коды, счётчики — без значений пульса/мощности/скорости.
- Злоупотребления: лимит постановки 30/ч на сотрудника, дедупликация по pending, семафор потоков, лимиты потока
  160/32 МБ и 30 с.
- Аудит: `disputes.series_viewed` в `panel_audit` (append-only), раз в час на сотрудника и спор.

# 9. Acceptance Criteria

- AC1 `buildSeries`: ячейки по дистанции ≤ 400, только точки сегмента; средние пульса/мощности, скорость по парам;
  ряд без датчика — `null`; < 2 точек — пусто (unit, фикстура GPX с пульсом и мощностью).
- AC2 `analyzeSeries` разрешён в `PARSE_FUNCTIONS`, работает в настоящем потоке (int).
- AC3 Первый GET — `preparing` и одна задача; повторный GET до готовности — `preparing` без новой задачи и без лимита.
- AC4 После задачи — `ready` с рядами (пульс и мощность фикстуры, скорость), в Mongo ничего нового, кроме одной записи
  журнала `disputes.series_viewed`.
- AC5 Нет лучшей попытки у цели — `unavailable: no_result`; исходника нет — `unavailable: no_source`; поток вернул
  отказ — `unavailable: failed`.
- AC6 Перепроверка (новая ревизия) — старый кэш не отдаётся; задача со старой ревизией — `skipped`, кэш не пишет.
- AC7 Права: без `disputes.read` (organizer) — 403; без сессии — 401; неизвестный спор — 404.
- AC8 Лимит: 31-я постановка за час — 429, pending снят.
- AC9 Лог задачи и сервиса не содержит значений рядов (проверка spy логгера); ни одна коллекция MongoDB не содержит
  рядов после построения.
- AC10 Панель: кнопка → «готовится» → графики (три `role="img"` со сводкой); нет пульса — «Нет данных пульса»;
  `unavailable` — текст причины; organizer без `disputes.read` экрана не видит (уже 06).
- AC11 Архитектура: разбор только через `runParseThread`; `disputes` не читает коллекции `results`/`tracks`.

# 10. Documentation Impact

- ADR-0012 п. 8 — «Реализация (слайс 06b)»: эндпоинт, кэш, D1.
- Эпик §3.5/§4 — отметка «сделано в 06b», D1.
- `.claude/rules/pokatim-security.md` (Споры: ряды 06b), `pokatim-backend.md` (Споры: очередь `dispute-series`,
  `disputes → tracks`), `pokatim-web.md` (графики — inline SVG без библиотеки), `pokatim-tests.md` (ряды).

# 11. Implementation Context

ENTRY POINTS: `GET /v1/admin/disputes/:disputeId/series`; задача `dispute-series.build` очереди `dispute-series`;
`DisputeScreen` панели.

FILES TO MODIFY: §6 + `packages/api-client/src/*` (панель споров), `packages/i18n/src/ru.ts`,
`apps/api/src/admin-routes.test.ts` (если перечисляет маршруты), `apps/api/test/disputes.ts`, `test/results.ts`
(`rideGpx` + пульс).

FILES TO READ: `attempt-check.processor.ts` (поток, сбои), `devices-jobs.ts` (Redis, очередь), `disputes-panel.service.ts`
(журнал, лимит), `results-check.int.test.ts` (реальная попытка), `apps/admin/src/features/disputes/*`.

TYPES & SCHEMAS: §7.1.

TESTS: unit `packages/tracks/src/series.test.ts`; `apps/api/src/parse-thread.test.ts` (белый список);
int `apps/api/src/modules/disputes/dispute-series.int.test.ts` (AC3–AC9); admin `DisputeSeries.test.tsx` (AC10).

OUT OF SCOPE: §4.

# 12. Outcome

- **Changes**
  - `packages/tracks`: `series.ts` (`buildSeries`, `SERIES_MAX_BINS` 400, `SERIES_MIN_BIN_M` 25), `analyzeSeries` в
    серверном входе `parse.ts`.
  - contracts: `PanelDisputeSeries`, `PanelDisputeSeriesData`, `DISPUTE_SERIES_UNAVAILABLE`; журнал +
    `disputes.series_viewed`. api-client: `getDisputeSeries`. i18n: `admin.disputes.series.*`, действие журнала.
  - api: `PARSE_FUNCTIONS` + `analyzeSeries`; `QUEUE.disputeSeries`; порт `ResultsForDisputes.bestSegment`;
    `disputes`: `DisputeSeriesCache`, `DisputeSeriesService`, `DisputeSeriesProcessor`, `DisputesWorkerModule`
    (`WorkerModule`), `GET /v1/admin/disputes/:id/series`, `DISPUTE_SERIES_POLICY`.
  - admin: `DisputeSeries` (кнопка → опрос → графики, таблица значений), `SeriesChart` (SVG, шкала мин/макс,
    перекрестие мышью, без фокуса — значения с клавиатуры в таблице), `disputeSeriesQuery` (`gcTime: 0`), стили
    `.series*`.
- **Docs updated**: ADR-0012 «Реализация п. 8», эпик §3.5, `.claude/rules/pokatim-{backend,security,web,tests}.md`.
- **Tests**
  - unit `packages/tracks/src/series.test.ts` 8/8; admin `features/disputes` 24/24; api-client `disputes.test.ts`;
    contracts `audit.schema.test.ts` (порядок действий).
  - int `dispute-series.int.test.ts` 9/9 (реальные MongoDB rs и Redis, настоящий поток разбора).
  - Отрицательные доказательства (прогон с выключенным механизмом, затем возврат):
    - `claim` подменён на «всегда ставить» → AC3 красный (вторая задача в очереди);
    - сверка ревизии в процессоре убрана → AC6 красный (`dispute-series:ready:<id>:2` записан задачей ревизии 2 после
      перехода на ревизию 3). Первая редакция теста AC6 этого не ловила (кэш ревизии 1 маскировал) — тест усилен.
  - `pnpm check` (изолированные `pokatim_06b_test`, Redis db 10, `TURBO_CONCURRENCY=1`) — после слияния
    `origin/develop`, результат — в PR.
- **Ревью pass 1** (independent-reviewer, APPROVE; CRITICAL 0 / HIGH 0 / MEDIUM 3 / LOW 4) — разбор в `findings.md`.
- **Open follow-ups**: визуальная проверка графиков в браузере на dev-стенде не выполнялась (jsdom-тесты и разметка);
  ряды заявителя для сравнения — по запросу команды (D1); остаток лимита при опросе в int-тесте проверен косвенно
  (одна задача).
