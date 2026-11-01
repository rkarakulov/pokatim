# Панель: «Упавшие задачи» (BullMQ failed + застрявший outbox)

Уровень: task2 (образец — «Сбои удаления аккаунтов», erasure-failures).

## 1. Title

Экран админа со списком упавших задач фоновых очередей, «Повторить» и «Удалить» с журналом панели.

## 2. Goal

Финальный провал задачи виден команде и исправим без доступа к Redis (`pokatim-backend.md`: «финальный провал — видимое
действие в панели, а не тишина»).

## 3. Scope

- API, новый модуль `modules/jobs` (композиция: своих коллекций нет; `jobs → panel` только через `index.ts`; импортирует
  его только `AppModule`):
  - `GET /v1/admin/failed-jobs?queue&limit` — `PanelGuard` + `platform.stats` (только admin). Ответ: счётчики failed по
    всем очередям `QUEUE`, строки failed выбранной очереди или всех (новые сверху, ≤ `limit` ≤ 100), блок outbox —
    число событий, не опубликованных дольше 10 мин, самое давнее и до 20 строк (id, тип, время).
  - `POST /v1/admin/failed-jobs/:queue/:jobId/retry` и `…/delete`, тело `{ reason }` (`ActionReason`): задача должна
    быть в failed (иначе `409 CONFLICT`), нет очереди или задачи — `404`. Повтор — `job.retry('failed',
    { resetAttemptsMade, resetAttemptsStarted })`, удаление — `job.remove()`. Журнал `jobs.failed_retried` /
    `jobs.failed_removed` (subject `platform`, nil UUID, label «<очередь> · <jobId>», details `queue`, `jobName`) —
    транзакция { журнал → операция BullMQ последней }: сбой операции откатывает журнал. Лимит
    `failed-jobs-panel:<actor>` 120/ч.
  - Очереди — один `Queue` на имя поверх общего клиента `REDIS` api-kit (BullMQ помечает переданный клиент `shared` и
    не закрывает его) — без 30 своих соединений.
- Строка задачи — явный список полей: очередь, `jobId`, имя (тип события), попытки (`attemptsMade` / `opts.attempts`),
  время создания и провала, `outboxEventId` (если в данных задачи есть uuid), ошибка — первая строка `failedReason`,
  e-mail заменены на «[e-mail]», ≤ 300 символов. Данные задачи (`data`) наружу не уходят.
- Контракты: `src/admin/failed-jobs.schema.ts` (строгие схемы панели), `AUDIT_ACTIONS` + 2 действия, `AuditEntry.details`
  + `queue`, `jobName` (optional). api-client панели — `listFailedJobs`, `retryFailedJob`, `deleteFailedJob`.
- Admin UI (`app-dev-kit:web-ui`): маршрут `failed-jobs`, вход — из навигации для `platform.stats`; фильтр очереди
  (счётчики), таблица, «Повторить» / «Удалить» через `ReasonDialog`, состояния: загрузка, пусто, ошибка, 403, 404/409 —
  баннер «Задача уже обработана» и перечитывание. Блок outbox — только чтение.
- Документы: `docs/product/admin-panel.md`, `.claude/rules/pokatim-backend.md`, i18n admin.

## 4. Out of Scope

Действия над outbox (публикатор повторяет сам; застрявшее событие — сигнал, что публикатор стоит), просмотр `data`
задачи, задачи `delayed`/`waiting`, массовые действия.

## 8. Risks / Assumptions

- `[ASSUMPTION]` Роль — admin через существующее право `platform.stats` (как «Сбои удаления аккаунтов»), нового права нет.
- `[ASSUMPTION]` «Dead outbox» — событие без `publishedAt` старше 10 мин: у outbox api-kit нет своего dead-состояния.
- Текст ошибки может нести ПДн (e-mail в ошибке SMTP) — маскирование и обрезка; данные задачи не показываем.
- Повтор транзакции Mongo может вызвать операцию BullMQ второй раз — вторая вернёт «не failed», транзакция откатится
  (журнал потерян при выполненной операции). Окно — только транзиентная ошибка коммита; принято.

## 8.3 Security checklist

- AuthN/AuthZ: `PanelGuard` + `platform.stats` на классе; сторож `admin-routes.test.ts`.
- Вход: `queue` — `^[a-z0-9-]{1,64}$` и членство в `QUEUE`; `jobId` — `^[A-Za-z0-9._:-]{1,200}$`; тело — `strictObject`.
- Данные наружу: без `data`, стека, e-mail; ошибка — маскированная первая строка.
- Злоупотребления: лимит мутаций на сотрудника; список ≤ 100.
- Логи: `jobs.failed_<action> queue job by` — без текста ошибки.
- Аудит: оба действия с причиной в журнал панели, в транзакции.

## 9. Acceptance Criteria

1. Admin видит упавшие задачи всех очередей со счётчиками и фильтром очереди; организатор и модератор — 403.
2. «Повторить» возвращает задачу в ожидание с полными попытками, «Удалить» — удаляет; каждое — запись журнала с причиной.
3. Повтор/удаление не-failed задачи — 409, неизвестной — 404, журнала нет.
4. Ошибка без e-mail и не длиннее 300 символов; `data` нет в ответе.
5. Блок outbox показывает число и самое давнее событие старше 10 мин.
6. UI: загрузка, пусто, ошибка, 403, устаревшая строка.

## 10. Documentation Sync

`docs/product/admin-panel.md` (права, журнал, раздел «Упавшие задачи»), `.claude/rules/pokatim-backend.md` (модуль
`jobs`), `.claude/rules/pokatim-security.md`, i18n `admin.failedJobs.*`, `admin.audit.action.jobs.*`.

## 12. Outcome

### Changes

- contracts: `admin/failed-jobs.schema.ts`; `AUDIT_ACTIONS` + `jobs.failed_retried`, `jobs.failed_removed`;
  `AuditEntry.details.queue/jobName`. api-client: `listFailedJobs`, `retryFailedJob`, `deleteFailedJob`.
- API: модуль `jobs` (`FailedJobQueues`, `FailedJobsAdminService`, `FailedJobsAdminController`, `jobs.policy.ts`).
- admin: `features/failed-jobs/FailedJobsScreen.tsx`, маршрут `/failed-jobs`, пункт навигации (нижняя группа).

### Tests

- unit: `jobs.policy.test.ts` (маска e-mail, обрезка, `outboxEventIdOf`, состав очередей); контракты; api-client.
- int: `failed-jobs-admin.int.test.ts` — права (403/401), строка без `data` и e-mail, фильтр (404/400), outbox, повтор
  (полные попытки, журнал, второй — 409), удаление, 404/400 без журнала, откат журнала при сбое BullMQ, ворота
  «повторили между проверкой и удалением» → 409. Отрицательное доказательство: без перепроверки `isFailed` перед
  `remove` ворота дают 204 (тест красный).
- admin: состояния (загрузка, пусто, нет сети, 403 сервера и без права), действия, 409, ошибка в окне, «показаны N из
  M», навигация по ролям.

### Review

Codex — недоступен (лимит расходов workspace), фолбэк — Claude `independent-reviewer`: APPROVE, MEDIUM — неатомарное
удаление (исправлено: перепроверка + ворота), LOW исправлены: 403 сервера, `keepPreviousData` фильтра, слушатель
`error` очередей, «показаны N из M». Не сделано: чтение только нужных полей вместо `getFailed` (≤ 30×100 hash на GET —
допустимо для админского экрана), «10 000+» у счётчика outbox.
