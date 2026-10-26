# 1. Title

Кофе-райды, PR 05b: жалобы и модерация — «Пожаловаться» на карточке райда (приложение), коллекция `ride_reports`,
статус райда `hidden`, раздел панели «Модерация · Райды» (очередь, превью, «Скрыть» / «Вернуть» / «Отклонить жалобы»
с причиной и журналом), право `rides.moderate`. Снимает запрет «не в сторы и не в прод без 05b».

# 2. Goal

Кофе-райд — UGC (ADR-0013): название, место, описание и подпись пишет райдер, карточка открывается по ссылке без
входа. До прода нужна защита: вошедший райдер жалуется на райд, команда платформы в панели «Протокол» видит очередь
райдов с открытыми жалобами, смотрит райд целиком и скрывает его (публично — 404, в ленте нет) или отклоняет жалобы;
ошибочное скрытие возвращается. Каждое решение — с причиной в журнале действий панели.

Источники: `docs/tasks/2026-10-27-app-05-rides/task.md` Приложение C (набросок 05b, ответ автора Q6 — «05b обязателен
до прода»), `docs/product/rides.md`, ADR-0013 (п. 1, 7), ADR-0009 (панель, роли, журнал), `AGENTS.md` §4.10 (журнал
append-only в транзакции действия), `docs/runbooks/deploy.md` (запрет «не в сторы и не в прод без 05b»).

**Human gate:** пропущен — автономный режим (память `autonomous-mode`); продуктовые решения — из Приложения C
(одобрено автором 2026-10-27), новые мелкие решения помечены `[ASSUMPTION]` в §8 и отражены в `docs/product/rides.md`.

# 3. Scope

**API, модуль `rides`:**
- Жалоба: `POST /v1/rides/:id/reports` (`AuthGuard`) — причина из справочника + необязательный комментарий ≤ 500;
  одна жалоба от пользователя на райд (повтор — идемпотентный успех); организатор на свой райд не жалуется; лимит
  частоты. Ответ — `RideView` с `viewer.reported = true`.
- `RideViewer.reported: boolean` — в `GET /rides/:id/me` и в ленте (у карточки).
- Статус `hidden` (в конец `RIDE_STATUSES`), фаза `hidden` (в конец `RIDE_PHASES`): публичная карточка — 404, в ленте
  нет ни у кого, `me` — 404 всем, кроме организатора; организатору `me` отдаёт райд с `phase: 'hidden'` и всеми
  действиями выключенными. «Я иду», «Не иду», правка, отмена, жалоба на скрытый райд — 404 (не организатору) / 409
  `RIDE_INVALID_STATE` (организатору).
- Панель (`PanelGuard`, `rides.moderate`): очередь, карточка модерации, действия «Скрыть», «Вернуть», «Отклонить
  жалобы» — изменение райда, закрытие жалоб и `PanelAudit.append` в одной транзакции.
- Миграция `0017_ride_reports` (expand-only): коллекция `ride_reports` + индексы + бэкфилл полей модерации
  (`0016` занят слайсом «Протокол», 8.1 A1).

**Contracts:** схемы жалобы и модерации, `RIDE_REPORT_REASONS`, `rides.moderate` (в конец `PERMISSIONS`), действия
журнала `ride.hidden`, `ride.restored`, `ride.reports_dismissed` (в конец `AUDIT_ACTIONS`), вид объекта `ride` (в конец
`AUDIT_SUBJECT_KINDS`), коды ошибок — в конец. **api-client:** методы приложения и панели.

**Приложение:** на карточке райда — `TextAction` «Пожаловаться» (вошедшим, не организатору, райд не скрыт,
`viewer.reported = false`); экран `rides/report/[id]` (внутри `Stack.Protected`): причина (выбор одной), комментарий,
«Отправить»; после отправки — карточка с текстом «Жалоба отправлена — команда проверит райд»; если уже жаловался —
вместо действия строка «Вы пожаловались на этот райд». Организатору скрытого райда — баннер «Райд скрыт
модератором. Другие райдеры его не видят», без действий.

**Панель:** раздел «Модерация райдов» (`/rides-moderation`, право `rides.moderate`): фильтр «Открытые жалобы» /
«Скрытые», `DataTable` (райд, город, старт, жалобы, статус), карточка `/rides-moderation/:id` — превью райда целиком
(название, дата и время, город, место, дистанция, темп, лимит, идут, описание, подпись организатора, статус, причина
отмены), список жалоб (причина, комментарий, когда; без автора), действия через `ReasonDialog` (причина обязательна),
`ConflictBanner` при `409 CONFLICT`.

**Роли:** `rides.moderate` — `admin`, `moderator`.

**Docs:** `docs/product/rides.md`, ADR-0013 (п. 7 — реализовано, последствия), `docs/runbooks/deploy.md` (снять запрет).

# 4. Out of Scope

- Жалобы на пользователя, блокировка организатора, бан, лимит райдов для нарушителей — позже (нужен профиль).
- Уведомления организатору и жалобщику (модуль `notifications`).
- Автоскрытие по числу жалоб, фильтр слов, ML-модерация.
- Показ автора жалобы в панели, переписка с жалобщиком, обжалование организатором.
- Удаление райда или жалоб; правка райда модератором.
- Жалобы гостя без входа (кнопка гостю не показывается).
- Общая «Модерация» других сущностей (треки, профили) — раздел только для райдов.

# 5. Architecture Context

- **api, `modules/rides`:** новый `ride-reports.collection.ts` (документ жалобы), `ride-reports.repository.ts`
  (единственный писатель `ride_reports`), `rides-moderation.service.ts` (очередь, карточка, действия — транзакция +
  `PanelAudit`), `rides-moderation.controller.ts` (`/v1/admin/rides…`, `PanelGuard` + `@RequirePermission
  ('rides.moderate')`); жалоба — `ride-reports.service.ts` (8.1 D1);
  `rides.policy.ts` — правила фазы/зрителя для `hidden`, жалобы и переходов модерации. Новая зависимость:
  `modules/panel/index.ts` (`PanelGuard`, `RequirePermission`, `CurrentPanelUser`, `PanelAudit`) — разрешена ADR-0013
  п. 1 («панель — с модерацией (05b)»); `panel` не импортирует `rides` (цикла нет).
- **db:** `rides` — новые поля `hiddenAt`, `hiddenFromStatus` (`'published' | 'cancelled'`, для «Вернуть»),
  `openReportCount`, `lastReportAt` (очередь без агрегации по жалобам) — без миграции данных (отсутствие = `null`/0
  читается репозиторием; миграция бэкфиллит явные значения, 8.1 D8). `ride_reports`: `{ _id, rideId, reporterUserId, reason, comment|null, createdAt,
  resolvedAt|null, resolution: 'hidden'|'dismissed'|null, resolvedBy|null }`; содержание жалобы неизменно, единственный
  переход — закрытие (`resolvedAt` ставится один раз). Индексы: уникальный `{ rideId, reporterUserId }`; `{ rideId: 1,
  _id: -1 }` (8.1 D7). Очередь — по `rides`: частичный индекс `{ lastReportAt: -1, _id: -1 }` при `openReportCount > 0`;
  «Скрытые» — частичный `{ hiddenAt: -1, _id: -1 }` при `status: 'hidden'`. Миграция `0017_ride_reports` (`0016`
  занят «Протоколом»; если 05b мержится первым — перенумеровать в `0016` при sync, 8.1 A1).
- **Транзакции:** жалоба — транзакция (**первой** — условная запись райда `$inc openReportCount`, `$max lastReportAt`;
  затем `insert` жалобы; дубль по уникальному индексу → откат и идемпотентный успех). Действия модерации —
  транзакция: **первым** условный `findOneAndUpdate` райда (по `version`) + `updateMany` открытых жалоб +
  `PanelAudit.append` (порядок — 8.1 D2). Участие/правка организатора — без
  изменений (одна атомарная операция; фильтр `status: 'published'` уже исключает `hidden`).
- **contracts:** `src/rides/ride-report.schema.ts`, `src/rides/ride-moderation.schema.ts`; правки
  `ride.schema.ts` (статус, фаза, `reported`, `canReport`), `admin/permissions.schema.ts`, `admin/audit.schema.ts`
  (+ `details.reportCount`); `common.ts` не меняется — новых кодов нет (8.1 D10). Ответы — `z.object` без `strict`, enum-ы ответов — `tolerantEnum`; `RideViewer.reported`
  — с `default(false)` (старый ответ валиден); запросы — `z.strictObject`.
- **app:** фича `src/features/rides/` (жалоба: форма, мутация, отображение `reported`/`hidden`), маршрут
  `src/app/rides/report/[id].tsx` в `Stack.Protected` рядом с `rides/cancel/[id]`.
- **admin:** фича `src/features/rides-moderation/`, маршруты в `router.tsx`, пункт в `navigation.ts` (в конец массива,
  `group: 'bottom'`, 8.1 A8).
- **Очереди/outbox:** нет (уведомлений нет). **Аудит:** да — три действия, объект `ride` со снимком названия.

# 5.1 Placement & Reuse Gate

- **Переиспользуем:** `AuthGuard`/`CurrentUser` (identity index); `PanelGuard`, `RequirePermission`,
  `CurrentPanelUser`, `PanelAudit` (panel index); `MongoTransactions.run`/`DbSession` из `src/db` (как в `calendar`), `isDuplicateKey`;
  `RateLimiter`, `CLOCK`, `uuidv7`, `domainError`, `page-cursor.ts`, `error-messages.ts`; схемы `Uuid`, `Version`,
  `MULTI_LINE`, `PageQuery`, `tolerantEnum`, `ActionReason` (`admin/members.schema.ts`, 3–500, как у
  `calendar.unpublished`), `optionalText`, `PageCursor`; app — карточка райда и форма отмены 05a (`rides/cancel/[id]` — образец экрана с выбором
  причины), `RadioGroup`/`Chip`, `TextField` multiline, `Banner`, `TextAction`, `apiErrorOf`; admin — `DataTable`,
  `ChipGroup`, `ReasonDialog`, `ConflictBanner`, `StatusTag`, `PageHeader`, `states.tsx`, образцы
  `features/calendar` и `features/races` (список + карточка + действие с причиной).
- **Запрещённые дубли:** своя проверка прав в панели (только `RequirePermission`); запись журнала мимо
  `PanelAudit.append`; запись `rides`/`ride_reports` вне их репозиториев; вычисление на клиенте «можно пожаловаться /
  скрыт» (только `viewer` и `phase` сервера); второй список причин; строки вне `@pokatim/i18n`; hex/px.
- **Тонкие контроллеры:** pipe (zod), `@CurrentUser()` / `@CurrentPanelUser()`, вызов сервиса, `no-store`.
- **Пакеты:** новых нет.

# 6. Relevant Files

- `apps/api/src/modules/rides/*` — модуль 05a (репозиторий, политика, сервисы, контроллеры, int-тесты).
- `apps/api/src/modules/calendar/calendar.service.ts` — образец: действие панели в транзакции + `PanelAudit.append`.
- `apps/api/src/modules/races/races-admin.controller.ts` — образец панельного контроллера с `RequirePermission`.
- `apps/api/src/modules/panel/{index,panel-audit,permissions}.ts` — журнал, карта ролей.
- `apps/api/src/db/{index.ts,migrations/index.ts,migrations/0014_rides.ts,migrations/0015_results.ts}`.
- `packages/contracts/src/{rides/ride.schema.ts,admin/permissions.schema.ts,admin/audit.schema.ts,common.ts}`.
- `packages/api-client/src/index.ts`; `packages/i18n/src/ru.ts`.
- `apps/app/src/app/rides/{[id].tsx,cancel/[id].tsx}`, `apps/app/src/features/rides/*`.
- `apps/admin/src/{router.tsx,navigation.ts}`, `apps/admin/src/features/calendar/*`, `apps/admin/src/ui/*`.

# 7. Implementation Notes

## Правила (`rides.policy.ts`)

- `ridePhase`: `hidden` (статус) → `cancelled` → `past` → `upcoming`.
- `rideViewer` для `hidden`: всё `false`, `canReport = false`. `canReport = вошедший && role !== 'organizer' && !reported &&
  status ≠ hidden` (фаза любая — оскорбительный текст бывает и у прошедшего/отменённого райда).
- Переходы модерации: «Скрыть» — из `published` или `cancelled` (запоминаем `hiddenFromStatus`), закрывает открытые
  жалобы (`resolution: 'hidden'`); «Вернуть» — только из `hidden` в `hiddenFromStatus`, жалобы не трогает; «Отклонить
  жалобы» — только при `openReportCount > 0` и статусе ≠ `hidden`, закрывает открытые (`'dismissed'`), райд не меняет
  (кроме `openReportCount = 0`). Недопустимый переход — 409 `RIDE_INVALID_STATE`.
- Все действия модерации — с `version` райда (оптимистичная блокировка, 409 `CONFLICT`) и причиной (`ActionReason` 3–500,
  8.1 A3); «Отклонить жалобы» — ещё `lastReportAt` из карточки (не совпал — 409 `CONFLICT`, 8.1 D3; порядок — D4). «Скрыть»/«Вернуть» увеличивают `version` (открытая форма правки организатора получит
  409); «Отклонить жалобы» `version` не меняет.

## Жалоба

- `CreateRideReportRequest = z.strictObject({ reason: z.enum(RIDE_REPORT_REASONS), comment: MULTI_LINE ≤ 500,
  nullable/optional })`. `RIDE_REPORT_REASONS = ['spam', 'offensive', 'dangerous', 'fake', 'other']` (только в конец),
  подписи: «Спам или реклама», «Оскорбления или неприемлемый текст», «Опасно для участников», «Обман: такого райда
  нет», «Другое».
- Порядок: лимит частоты `rides-report` 20 / 24 ч (ключ `uid`, 429 + `retryAfterSec`) → райд (нет / `hidden` у
  чужого — 404) → организатор — 409 `RIDE_INVALID_STATE` → уже жаловался — успех без транзакции → транзакция (запись райда
  первой, затем `insert`); дубль (уникальный индекс,
  `E11000`) — успех без изменений (комментарий второй попытки не сохраняется).
- Логи: `rides.reported ride=<id> uid=<id> reason=<code>` — без комментария (UGC).

## Видимость `hidden`

- Публичный `GET /rides/:id` — 404 (фильтр `status ∈ {published, cancelled}`); лента — тот же фильтр; квота
  организатора (`maxUpcomingOrganized`) **считает** будущие скрытые из `published` (8.1 Q2), квота отметок — нет.
- `GET /rides/:id/me`: организатору — `RideView` с `phase: 'hidden'`; остальным — 404.
- Приложение: карточка при 404 публичного чтения и вошедшем зрителе пробует `me` (организатор видит баннер); SSR
  web для скрытого райда — 404-страница (`noindex` уже есть).

## API панели (`/v1/admin`, `PanelGuard`, `rides.moderate`, `no-store`)

| Метод и путь | Тело / query → ответ |
|---|---|
| `GET /admin/rides?state=open\|hidden&cursor&limit` | → `ModerationRidePage { items: ModerationRideRow[], nextCursor }` |
| `GET /admin/rides/:id` | → `ModerationRideDetail` (райд целиком + `reports[]` + `version`) |
| `POST /admin/rides/:id/hide` | `{ version, reason }` → `ModerationRideDetail` |
| `POST /admin/rides/:id/restore` | `{ version, reason }` → `ModerationRideDetail` |
| `POST /admin/rides/:id/dismiss-reports` | `{ version, reason }` → `ModerationRideDetail` |

- `open` — `openReportCount > 0`, сортировка `lastReportAt` desc; `hidden` — `status: 'hidden'`, `hiddenAt` desc.
  `ModerationRideRow`: `id`, `title`, `city`, `startsAt`, `phase`, `openReportCount`, `topReason` (самая частая
  открытая; можно отдать `reasons: Record<reason, count>` — решает architect), `lastReportAt`, `hiddenAt`.
- `ModerationRideDetail.reports` — до 100 последних, новые сверху: `reason`, `comment`, `createdAt`, `resolution`;
  без `reporterUserId`. Организатор — только подпись `organizerName` (без id/e-mail).
- Журнал: `subject: { kind: 'ride', id, label: title }`, `reason`, `details` — число закрытых жалоб (если схема
  `details` позволяет; иначе без details — решает architect).
- Ошибки: 404 (нет райда), 409 `CONFLICT`, 409 `RIDE_INVALID_STATE`, 400 `VALIDATION_FAILED`, 403 (нет права).

## Панель

- Раздел «Модерация райдов»: `PageHeader`, `ChipGroup` «Открытые жалобы» / «Скрытые», `DataTable` (Райд — название +
  город, Старт, Жалобы — число + главная причина, Статус — `StatusTag`), пустые состояния («Открытых жалоб нет»,
  «Скрытых райдов нет»), загрузка/ошибка — `states.tsx`. Строка → карточка.
- Карточка: превью полей райда, `StatusTag` (опубликован / отменён / скрыт), список жалоб, кнопки по статусу:
  `published|cancelled` + открытые жалобы → «Скрыть», «Отклонить жалобы»; `published|cancelled` без жалоб →
  «Скрыть»; `hidden` → «Вернуть». Каждая — `ReasonDialog` (причина обязательна). Ссылка «Открыть в приложении» не нужна.

# 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` Скрыть можно и отменённый, и прошедший райд; «Вернуть» восстанавливает прежний статус.
- `[ASSUMPTION]` Повторная жалоба того же райдера после «Отклонить» не принимается (одна жалоба на райд навсегда);
  иначе — спам повторных жалоб. Жалоба на скрытый — 404.
- `[ASSUMPTION]` Участники скрытого райда его не видят (404) — как и все, кроме организатора. Их отметки остаются
  (при «Вернуть» участие восстанавливается); квота отметок скрытые не считает, квота организатора — считает
  (пересмотрено architect, 8.1 Q2).
- `[ASSUMPTION]` Причины и подписи жалоб — §7; лимит 20 жалоб / сутки.
- Риск: номер миграции 0016 с параллельным слайсом результатов 05 — при конфликте sync с base и перенумерация.
- Риск: `openReportCount` — счётчик в документе райда; рассинхрон исключён транзакцией (жалоба и закрытие — в
  транзакциях вместе с `$inc`/`$set`).
- Риск: общие файлы со слайсом «Протокол» (`ru.ts`, `common.ts`, `permissions.schema.ts`, `audit.schema.ts`,
  `navigation.ts`, `router.tsx`) — только дописывать в конец.

# 8.1 Requirements Consistency (architect)

Architecture Review — 05b rides moderation. **Status: CONCERNS** (разрешены решениями ниже). **BLOCKERS: нет.**

**Расхождения spec ↔ код / инварианты (исправлено, см. 8.2):**

- **A1. Номер миграции.** `0016` уже занят параллельным слайсом «Протокол» (`0016_protocol` в ветке
  `feature/race-results-05-protocol`). Решение: миграция **`0017_ride_reports`**, в массиве `migrations` — после
  `protocol`. От номера зависят: `migrations.int.test.ts` (список применённых сортируется по `_id` строкой и
  сравнивается с массивом; тест «после предыдущей» по `ids.indexOf`). Если 05b мержится в `develop` раньше
  «Протокола» — при sync перенумеровать в `0016_ride_reports` (и тесты); «Протокол» тогда берёт `0017`. Применённых
  на стендах номеров ещё нет — переименование безопасно до мержа.
- **A2. Транзакции.** В коде нет `withTransaction`: транзакция — `MongoTransactions.run(async (tx) => …)` из
  `src/db` (тип `DbSession`), образец — `CalendarService`/`RoutesService`. Дубль по уникальному индексу внутри
  транзакции — `try { await transactions.run(…) } catch (e) { if (!isDuplicateKey(e, '<index>')) throw e; … }`
  (`@rkarakulov/api-kit/mongo`, образец `EntriesService.enter`).
- **A3. Причина действия панели** — `ActionReason` (`admin/members.schema.ts`): **3–500**, не «2–500», как в §7.
  `ReasonDialog` уже держит минимум `ACTION_REASON_MIN_LENGTH`.
- **A4. Публичное чтение не фильтрует статус.** `RidesRepository.findPublic` читает `{ _id }` без статуса —
  нужен фильтр `status ∈ {published, cancelled}`. `PUBLIC_PROJECTION` дополнить новыми полями модерации (исключить).
- **A5. Классификация отказов `join`/`leave` раскрывает скрытый райд.** Сейчас после неудачной атомарной операции
  `findForViewer` возвращает документ и: `join` участнику/организатору — «идемпотентный успех» с `RideView`
  (утечка), в ветке квоты — тоже; `leave` не-участнику — успех с `RideView` (утечка), участнику — 409 вместо 404.
  Решение: одна функция политики `visibleTo(doc, userId)` (`status ≠ hidden || organizer`) — первой проверкой после
  `findForViewer` в `me`, `join` (обе ветки), `leave`, жалобе: невидим — 404; организатор скрытого — 409
  `RIDE_INVALID_STATE` **до** идемпотентных веток. `update`/`cancel` уже корректны (`ownRide` → `assertUpcoming` по
  фазе `hidden` → 409; чужой — 404), покрыть тестами.
- **A6. Лента/города/квоты.** `visible()` (лента, `cities`) и `countUpcomingJoined` уже фильтруют
  `status: 'published'` / `cancelled + участник` — `hidden` исключён без правок кода (только тесты).
  `countUpcomingOrganized` — см. Q2.
- **A7. Append-only (`pokatim-db.md`: «модерация — без update/delete в коде»).** Закрытие жалобы — `updateMany`
  по `ride_reports`. Альтернативы: (a) как в spec — разрешённый единственный переход `resolvedAt: null → дата`
  (фильтр `resolvedAt: null`, меняются только `resolvedAt/resolution/resolvedBy`, удаления нет), решения — в
  append-only `panel_audit`; (b) жалобы неизменны, «открытость» — по монотонному `reportSeq` райда и
  `reportsClosedSeq` (без update жалоб, но без `resolution` у жалобы); (c) отдельная коллекция решений по жалобам.
  **Рекомендация — (a)**: жалоба — входящий сигнал, а не решение; решение и причина — в журнале панели. Условия:
  тест-сторож репозитория (только `insertOne` и `updateMany` с `resolvedAt: null` в фильтре и `$set` только трёх
  полей закрытия; `deleteOne/deleteMany/replaceOne` — нет), строка-исключение в `pokatim-db.md`.
- **A8. Навигация панели.** Пункт в конец `NAVIGATION` с `group: 'main'` встал бы после «Сезонов», а комментарий
  (прототип 3c) требует «Сезоны — последним в основной группе». Решение: `group: 'bottom'`, в конец массива (после
  «Журнала действий»); тип `NavItem['to']` дополнить `'/rides-moderation'`.
- **A9. Права.** `admin-panel.md` планировал общее `moderation.decide` (admin-07); `AGENTS.md` §1 — «своя очередь в
  каждом модуле» → `rides.moderate` корректно; обновить таблицу ролей и карту разделов `admin-panel.md`. `admin`
  получает право автоматически (`admin: PERMISSIONS`), `moderator` — дописать в `ROLE_PERMISSIONS`.
- **A10. `version` (`pokatim-db.md`: «version меняют только правки организатора»).** «Скрыть»/«Вернуть» тоже
  `$inc version` — обновить правило.

**Решения, оставленные spec architect'у:**

- **D1. Сервис жалобы** — отдельный `ride-reports.service.ts` (`RideReportsService`), не `rides.service.ts`.
- **D2. Порядок записей в транзакциях (write skew).** И жалоба, и действия модерации **первой записью** пишут
  документ райда (`RidesRepository`, условие в фильтре), затем — `ride_reports`. Две такие транзакции одного райда
  конфликтуют по документу райда (`MongoTransactions.run` повторяет проигравшую) → `openReportCount` = числу
  открытых жалоб; жалоба не «проскочит» скрытие открытой. Жалоба: `recordReport` фильтр `{ _id, status ∈
  {published, cancelled}, organizerUserId ≠ uid }`, `$inc openReportCount: 1`, **`$max`** `lastReportAt: now`
  (поздний коммит не откатит время назад); `null` → откат, классификация по свежему чтению (нет/скрыт чужому — 404,
  организатор — 409). Затем `insertOne` жалобы; `E11000 ride_reports_ride_reporter_unique` → вся транзакция
  откатывается (счётчик тоже) → идемпотентный успех. Порядок сервиса: лимит → `findForViewer` → `visibleTo`
  (404) → организатор (409) → `findReport(rideId, uid)` есть — успех без транзакции → транзакция.
- **D3. «Отклонить жалобы» без смены `version`** (по spec) + защита от «невиденных» жалоб: тело `{ version, reason,
  lastReportAt }` — `lastReportAt` из карточки модерации; не совпал (пришла новая жалоба) — `409 CONFLICT` →
  `ConflictBanner`. Иначе модератор закрыл бы жалобу, которую не видел (повторно пожаловаться нельзя — одна на
  райд). «Скрыть» такой защиты не требует (новая жалоба закрывается как `hidden` — по сути верно).
- **D4. Порядок проверок действия модерации** (в транзакции): нет райда — 404 → `version` ≠ — `409 CONFLICT` →
  (`dismiss`) `lastReportAt` ≠ — `409 CONFLICT` → недопустимый переход — `409 RIDE_INVALID_STATE` → условная запись
  (фильтр повторяет всё) `null` → `409 CONFLICT`. Панель на `RIDE_INVALID_STATE` тоже показывает `ConflictBanner`
  (состояние сменил другой модератор).
- **D5. Строка очереди** — `topReason` (самая частая открытая; ничья — порядок `RIDE_REPORT_REASONS`; нет открытых —
  `null`), не `Record`: одна агрегация `ride_reports` по id страницы (`$match { rideId: $in, resolvedAt: null }`,
  `$group`). Для вкладки «Скрытые» колонка «Жалобы» — «—», вместо неё значим `hiddenAt`.
- **D6. Журнал** — `details.reportCount` (число закрытых этим действием жалоб, `modifiedCount` `updateMany`; у
  `ride.restored` — без details). Поле дописывается в конец `AuditEntry.details` и `AuditDetailsDoc` (слайс
  «Протокол» добавляет туда же `attemptId/entryId/revision` — конфликт слияния тривиален); `AuditScreen.details()`
  показывает «Жалоб: N».
- **D7. Индексы** `ride_reports`: `ride_reports_ride_reporter_unique { rideId: 1, reporterUserId: 1 }` (дубль,
  `reported` зрителя и ленты — `$in` по `rideId`); `ride_reports_ride_idx { rideId: 1, _id: -1 }` (карточка — 100
  новых по `_id` uuidv7, закрытие и агрегация причин — префикс `rideId`). Индекс `{ rideId, resolvedAt }` из §5 не
  нужен. `rides`: `rides_report_queue_idx { lastReportAt: -1, _id: -1 }` partial `{ openReportCount: { $gt: 0 } }`
  (запрос **обязан** содержать `openReportCount: { $gt: 0 }`); `rides_hidden_queue_idx { hiddenAt: -1, _id: -1 }`
  partial `{ status: 'hidden' }` (вместо `{ status, hiddenAt, _id }`).
- **D8. Бэкфилл** (по прецеденту `0015`/`0016`): миграция ставит `openReportCount: 0, lastReportAt: null, hiddenAt:
  null, hiddenFromStatus: null` документам без поля (`$exists: false`, идемпотентно); новые райды пишут поля явно;
  чтение всё равно терпит отсутствие (`?? 0`/`?? null`).
- **D9. `RideViewer`** — два поля: `reported` и `canReport` (оба `z.boolean().default(false)`): кнопку клиент
  показывает только по `canReport` сервера (запрет вычисления на клиенте). Заполняются везде, где строится зритель:
  `me`, мутации (`join/leave` — `findReport`; `create/update/cancel` — организатор, `false`), лента — один батч
  `reportedRideIds(uid, ids)` на страницу.
- **D10. Новых кодов ошибок нет**: 404 `NOT_FOUND`, 409 `RIDE_INVALID_STATE` / `CONFLICT`, 429 `RATE_LIMITED`,
  400 `VALIDATION_FAILED` — существующие. `common.ts` и `error-messages.ts` не меняются.
- **D11. Приложение после отправки**: экран жалобы сам показывает успех (`Banner` «Жалоба отправлена — команда
  проверит райд» + `TextAction` «К райду»), без параметров навигации; карточка по `viewer.reported` — строка «Вы
  пожаловались на этот райд».

**Продуктовые `[ASSUMPTION]` (§8) — пересмотр:**

- **Q2 (вредное решение): квота организатора и скрытые.** Spec: скрытые не считаются → нарушитель, чей райд скрыт,
  сразу создаёт новый (квота 5 освобождается). Альтернативы: (a) не считать (spec); (b) считать будущие скрытые,
  скрытые из `published` (`status: 'hidden', hiddenFromStatus: 'published'`) — слот занят до даты старта, отменить
  скрытый организатор не может; (c) отдельный бан — out of scope. **Принято (b)**: `countUpcomingOrganized` —
  `$or [{ status: 'published' }, { status: 'hidden', hiddenFromStatus: 'published' }]`; «Вернуть» тогда не
  переполняет квоту. Квота отметок участника скрытые **не** считает (участник не может снять отметку со скрытого) —
  после «Вернуть» возможно превышение 20 — принятая мягкая квота.
- Остальные `[ASSUMPTION]` §8 непротиворечивы и принимаются.

**Принятые риски:** публичная карточка кэшируется 60 с (`PUBLIC_READ_CACHE_CONTROL` и кэш процесса SSR) — скрытый
райд по ссылке может быть виден до 60 с; лимит жалоб списывается и на идемпотентный повтор; `canReport` у
прошедшего/отменённого райда — `true` (по spec).

# 8.2 Deviations from spec

- Приложение C: «`ride_reports` (append-only)» → жалоба неизменна по содержанию, но закрывается (`resolvedAt`,
  `resolution`) — иначе очередь «открытых» не построить без отдельного журнала; история решений — в журнале панели.
  Принято оркестратором при написании spec; architect подтвердил с условиями (8.1 A7: сторож репозитория, строка в
  `pokatim-db.md`).
- Миграция `0016_ride_reports` → `0017_ride_reports` (8.1 A1).
- Причина действия модерации 2–500 → `ActionReason` 3–500 (8.1 A3).
- Квота организатора считает будущие скрытые из `published` (было `[ASSUMPTION]` «не считает», 8.1 Q2).
- «Отклонить жалобы» несёт `lastReportAt` (8.1 D3); `RideViewer` + `canReport` (8.1 D9); индексы — 8.1 D7;
  пункт панели — группа `bottom` (8.1 A8); новых кодов ошибок нет (8.1 D10).

# 8.3 Security checklist

- **AuthN/AuthZ:** жалоба — `AuthGuard`; панель — `PanelGuard` + `rides.moderate` на каждом маршруте (int-тест: без
  права — 403, без сессии — 401); организатор не жалуется на свой.
- **Входные данные:** `z.strictObject`, enum причины, комментарий `MULTI_LINE` ≤ 500, `Uuid` в пути.
- **Данные наружу:** приложению — только `reported`; панели — без `reporterUserId`, e-mail, id организатора;
  комментарий жалобы виден только команде.
- **Злоупотребления:** одна жалоба на райд от пользователя (уникальный индекс), лимит частоты, кнопка скрыта от
  организатора.
- **Логи:** без комментариев, названий и мест.
- **Аудит:** три действия модерации — `PanelAudit.append` в транзакции действия, причина обязательна.

# 9. Acceptance Criteria

**Функциональные**
1. Вошедший не-организатор отправляет жалобу с причиной (и комментарием) → 200, `viewer.reported = true`; повтор — 200
   без второй записи; в панели у райда `openReportCount` = числу уникальных жалобщиков.
2. Организатор на свой райд — 409 `RIDE_INVALID_STATE`; гость — 401; лимит частоты — 429 + `retryAfterSec`.
3. Очередь «Открытые жалобы» показывает райды с открытыми жалобами, новые сверху; «Скрытые» — скрытые.
4. «Скрыть» → публичная карточка 404, в ленте нет (никому), `me` — 404 участнику и 200 c `phase: 'hidden'`
   организатору; открытые жалобы закрыты; запись `ride.hidden` с причиной и названием в журнале.
5. «Вернуть» → прежний статус (`published`/`cancelled`), карточка и лента как до скрытия; `ride.restored` в журнале.
6. «Отклонить жалобы» → жалобы закрыты, райд в очереди больше не виден, видимость не изменилась;
   `ride.reports_dismissed` в журнале.
7. Приложение: «Пожаловаться» видно только вошедшему не-организатору нескрытого райда без своей жалобы; экран
   жалобы отправляет причину и комментарий; после — строка «Вы пожаловались на этот райд»; организатор скрытого —
   баннер без действий.
8. Панель: раздел виден `admin` и `moderator`, скрыт у `organizer`; действия через `ReasonDialog`; `409 CONFLICT` —
   `ConflictBanner` с обновлением.

**Негативные**
9. Скрытый райд: «Я иду», «Не иду», правка, отмена, жалоба — 404 чужому, 409 организатору.
10. Модерация с устаревшей `version` — 409 `CONFLICT`, без записи в журнал; «Вернуть» нескрытый — 409
    `RIDE_INVALID_STATE`; «Отклонить» без открытых жалоб — 409 `RIDE_INVALID_STATE`.
11. Сбой внутри транзакции действия → ни изменения райда, ни записи журнала (int-тест на откат, как в calendar).
12. Без `rides.moderate` — 403; лишние поля тела — 400.

**Технические / архитектурные**
13. Миграция `0016_ride_reports` идемпотентна, проходит `migrations.int.test.ts`; индексы по §5.
14. Справочники и коды — только в конец; старые клиенты разбирают ответы (`tolerantEnum`, `reported` с default).
15. `rides` не импортирует чужие модули мимо `index.ts`; запись — только репозитории; `TURBO_CONCURRENCY=1 pnpm check`
    зелёный.

# 10. Documentation Impact

- `docs/product/rides.md` — раздел «Жалобы и модерация», строка таблицы «Скрыто» → сделано.
- `docs/adr/0013-coffee-rides.md` — п. 7 и «Последствия»: модерация реализована (без нового ADR).
- `docs/runbooks/deploy.md` — снять запрет «не в сторы и не в прод без 05b».
- `docs/product/admin-panel.md` — строка `rides.moderate` в таблице ролей (admin, moderator), журнал (три действия),
  карта разделов «Модерация райдов — 05b» (план `moderation.decide`/admin-07 — уточнить: очередь своя в модуле).
- Правила (`.claude/rules/`, дописать в разделы «Кофе-райды»): `pokatim-db.md` — `ride_reports` (писатель
  `RideReportsRepository`, исключение append-only: только закрытие `resolvedAt: null → дата`, без delete), порядок
  «запись райда первой» в транзакциях жалобы/модерации, `version` меняют и «Скрыть»/«Вернуть», будущее удаление
  аккаунта — жалобы пользователя; `pokatim-security.md` — жалоба (`AuthGuard`, лимит 20/сут), модерация
  (`PanelGuard` + `rides.moderate`), наружу без автора жалобы, снять строку «Выпуск … только вместе с 05b»;
  `pokatim-app.md` — экран `rides/report/[id]`, `canReport`/`reported`, баннер скрытого; `pokatim-web.md` — раздел
  «Модерация райдов».

# 11. Implementation Context

**Порядок слайсов для coder** (каждый — зелёный `pnpm --filter <pkg> test/typecheck`, в конце —
`TURBO_CONCURRENCY=1 pnpm check`; общие файлы — только дописывать в конец, кроме отмеченных точечных правок):

1. **Contracts + api-client.** `ride.schema.ts`: `'hidden'` в конец `RIDE_STATUSES` и `RIDE_PHASES`;
   `RideViewer` + `reported`, `canReport` (`z.boolean().default(false)`). Новые `ride-report.schema.ts`,
   `ride-moderation.schema.ts`; экспорт в конец `index.ts`. `PERMISSIONS` + `'rides.moderate'`; `AUDIT_ACTIONS` +
   `'ride.hidden'`, `'ride.restored'`, `'ride.reports_dismissed'`; `AUDIT_SUBJECT_KINDS` + `'ride'`;
   `AuditEntry.details` + `reportCount`. api-client: `reportRide` (index.ts, после `leaveRide`), админ-методы — в
   конец объекта `createAdminApiClient`. Тесты схем и клиента.
2. **API: данные и видимость.** `rides.collection.ts` (поля модерации), `ride-reports.collection.ts`, миграция
   `0017_ride_reports` (+ `index.ts`, `migrations.int.test.ts`), `rides.policy.ts` (`hidden`, `visibleTo`,
   `canReport`, переходы), `rides.repository.ts` (`findPublic` со статусом, проекции, `countUpcomingOrganized`,
   `recordReport`, `hide`, `restore`, `clearReports`, чтения очереди), `ride-reports.repository.ts`; исправление
   классификации `join/leave/me` (A5); `reported` в ленте/`me`/мутациях. Int-тесты видимости.
3. **API: жалоба.** `ride-reports.service.ts`, маршрут `POST /v1/rides/:id/reports` в `RidesController`
   (`@HttpCode(200)`). Int-тесты.
4. **API: модерация.** `rides-moderation.service.ts`, `rides-moderation.controller.ts` (`admin/rides`),
   `RidesModule` импортирует `PanelModule`; `permissions.ts` (moderator). Int-тесты + откат транзакции.
5. **Приложение.** Карточка (кнопка/строка/баннер), экран и маршрут жалобы, `Stack.Screen`, i18n. Jest-тесты.
6. **Панель.** `features/rides-moderation/*`, `router.tsx`, `navigation.ts`, `AuditScreen` (`reportCount`), i18n.
   Vitest.
7. **Docs** (§10) и правила.

**ENTRY POINTS**

- API приложения: `RidesController` (`apps/api/src/modules/rides/rides.controller.ts`) — новый
  `@Post(':id/reports')`; `RidesFeedService.me/list/get`, `RidesService.join/leave` (видимость).
- API панели: новый `RidesModerationController` `@Controller('admin/rides')`, `@UseGuards(PanelGuard)`,
  `@RequirePermission('rides.moderate')` на классе: `GET /`, `GET /:id`, `POST /:id/hide`, `POST /:id/restore`,
  `POST /:id/dismiss-reports` (`@HttpCode(200)`); пользователь — `@CurrentPanelUser()`. `no-store` ставит
  `PanelGuard` (сторож — `src/admin-routes.test.ts` подхватит контроллер автоматически).
- Приложение: `apps/app/src/app/rides/[id].tsx` → `RideDetailScreen`; новый `apps/app/src/app/rides/report/[id].tsx`.
- Панель: `apps/admin/src/router.tsx` — `ridesModerationRoute` (`path: 'rides-moderation'`, `validateSearch` для
  `state=open|hidden`), `rideModerationRoute` (`rides-moderation/$rideId`), оба в `RequirePermission
  permission="rides.moderate"`, дописать в `appRoute.addChildren` перед `notFoundRoute`.

**FILES TO MODIFY**

- `packages/contracts/src/rides/ride.schema.ts` (+ `.test.ts`: порядок справочников, `hidden` → не `unknown`,
  старый ответ без `reported/canReport` валиден с `false`).
- `packages/contracts/src/admin/{permissions.schema.ts,audit.schema.ts}` (+ тесты порядка) — **в конец** (слайс
  «Протокол» дописывает туда же: `results.manage/results.revise`, 7 действий `results.*`, details
  `attemptId/entryId/revision`; при sync — свои строки после чужих).
- `packages/contracts/src/index.ts` — экспорт двух новых файлов в конец.
- `packages/api-client/src/index.ts` (`reportRide`), `packages/api-client/src/admin.ts` (в конец объекта) + тесты.
- `apps/api/src/modules/rides/{rides.collection.ts,rides.policy.ts,rides.repository.ts,rides.service.ts,
  rides-feed.service.ts,rides.controller.ts,rides.module.ts,index.ts(без изменений экспорта)}`.
- `apps/api/src/modules/panel/permissions.ts` — `moderator: ['audit.read', 'races.read', 'rides.moderate']`
  (точечная правка строки; соседняя строка `organizer` меняется «Протоколом» — возможен текстовый конфликт);
  `permissions.test.ts`.
- `apps/api/src/modules/panel/panel.collection.ts` — `AuditDetailsDoc.reportCount?: number` (в конец).
- `apps/api/src/db/migrations/{index.ts,migrations.int.test.ts}`.
- `apps/app/src/app/_layout.tsx` — `<Stack.Screen name="rides/report/[id]" />` в `Stack.Protected` рядом с
  `rides/cancel/[id]`.
- `apps/app/src/features/rides/{ride-detail.tsx,queries.ts,format.ts}` (фаза `hidden` в подписях, если есть
  исчерпывающие switch), `apps/app/src/components/ride-going-action.tsx` — проверить: `phase: 'hidden'` → без
  действия (сейчас `phase !== 'upcoming'` → `null`, правка, вероятно, не нужна — тест).
- `apps/app/e2e/web.spec.ts` — шаг смоука: `/rides/report/<uuid>` гостю → редирект на вход (правило app.md).
- `apps/admin/src/{router.tsx,navigation.ts}`, `apps/admin/src/features/audit/AuditScreen.tsx` (`details()` —
  `reportCount`).
- `packages/i18n/src/ru.ts` — **в конец** блоками: `admin.nav.ridesModeration`, `admin.audit.action.ride.*` (3),
  `admin.ridesModeration.*`, `domain.rideReportReason.*` (5, общие app/admin), `domain.rideStatus.*`/фаза
  `hidden` при необходимости, `rides.report.*`, `rides.detail.report`, `rides.detail.reported`,
  `rides.detail.hidden`.

**Новые файлы**

- `packages/contracts/src/rides/ride-report.schema.ts` (+ `.test.ts`),
  `packages/contracts/src/rides/ride-moderation.schema.ts` (+ `.test.ts`).
- `apps/api/src/modules/rides/{ride-reports.collection.ts,ride-reports.repository.ts,ride-reports.service.ts,
  rides-moderation.service.ts,rides-moderation.controller.ts}` + тесты (ниже).
- `apps/api/src/db/migrations/0017_ride_reports.ts`.
- `apps/app/src/app/rides/report/[id].tsx`, `apps/app/src/features/rides/ride-report.tsx` (+ тесты).
- `apps/admin/src/features/rides-moderation/{RidesModerationScreen.tsx,RideModerationScreen.tsx,
  rides-moderation-query.ts,moderation-format.ts}` + `*.test.tsx`.
- `apps/api/test/rides.ts` — дописать хелперы (`report`, `hideViaPanel` и т. п.); `apps/api/test/panel.ts` —
  только использовать (`memberUser`, `panelSession`, `panelCall`).

**FILES TO READ** (образцы)

- `apps/api/src/modules/calendar/{calendar.service.ts,calendar-admin.controller.ts,calendar-admin.int.test.ts}` —
  действие панели в транзакции + `PanelAudit.append`, проверка 404/409, int-тест отката.
- `apps/api/src/modules/routes/routes.service.ts`, `apps/api/src/modules/results/entries.service.ts` —
  `isDuplicateKey` вокруг `transactions.run`.
- `apps/api/src/modules/panel/{index.ts,panel-audit.ts,panel.module.ts,permissions.ts}`;
  `apps/api/src/admin-routes.test.ts`.
- `apps/api/src/db/{index.ts,migrations/0014_rides.ts,migrations/0002_identity.ts (partial, ensureCollection)}`.
- `apps/api/test/identity.ts` (`holdTransaction`, `untilBlocked`, `retried`) — тест гонки.
- `apps/app/src/features/rides/{ride-detail.tsx,ride-cancel.tsx,ride-manage.tsx,queries.ts}`.
- `apps/admin/src/features/calendar/CalendarScreen.tsx`, `apps/admin/src/features/races/{RacesScreen.tsx,
  RaceScreen.tsx}`, `apps/admin/src/ui/{DataTable,ReasonDialog,ConflictBanner,StatusTag,ChipGroup,states}.tsx`.
- Правила: `pokatim-db.md`, `pokatim-backend.md`, `pokatim-security.md`, `pokatim-web.md`, `pokatim-app.md`,
  `pokatim-tests.md`.

**TYPES & SCHEMAS** (contracts; ответы — `z.object`, enum приложения — `tolerantEnum`, панели и запросы — строгий
`z.enum`/`z.strictObject`)

- `RIDE_STATUSES = ['published', 'cancelled', 'hidden']`, `RIDE_PHASES = ['upcoming', 'past', 'cancelled',
  'hidden']`.
- `RideViewer` + `reported: z.boolean().default(false)`, `canReport: z.boolean().default(false)`.
- `ride-report.schema.ts`: `RIDE_REPORT_REASONS = ['spam','offensive','dangerous','fake','other']`,
  `RideReportReason = z.enum(…, { error: fieldError('REQUIRED') })`, `RIDE_REPORT_COMMENT_MAX = 500`,
  `CreateRideReportRequest = z.strictObject({ reason, comment: optionalText(500, MULTI_LINE).optional() })` →
  ответ `RideView`.
- `ride-moderation.schema.ts`: `RIDE_MODERATION_STATES = ['open','hidden']`; `ModerationRideQuery =
  z.strictObject({ ...PageQuery.shape, state: z.enum(…).default('open'), cursor: PageCursor.optional(), limit
  1–50 default 20 })`; `ModerationRideRow { id, title, city: z.enum(CITY_CODES), startsAt, status: z.enum
  (RIDE_STATUSES), phase: z.enum(RIDE_PHASES), openReportCount, topReason: RideReportReason.nullable(),
  lastReportAt: datetime|null, hiddenAt: datetime|null }`; `ModerationRidePage { items, nextCursor }`;
  `ModerationRideReport { id, reason, comment|null, createdAt, resolution: z.enum(['hidden','dismissed'])|null,
  resolvedAt|null }` (без `reporterUserId`); `ModerationRideDetail` = поля райда (title, organizerName, startsAt,
  city, place, distanceKm, paceMin/Max, limit, goingCount, description, status, phase, cancelReason,
  rescheduledAt) + `hiddenAt`, `openReportCount`, `lastReportAt`, `version`, `reports` (≤ 100, новые сверху) —
  без `organizerUserId`/participants; `HideRideRequest = RestoreRideRequest = z.strictObject({ version: Version,
  reason: ActionReason })`; `DismissRideReportsRequest = z.strictObject({ version, reason: ActionReason,
  lastReportAt: z.iso.datetime() })`.
- `PERMISSIONS` + `'rides.moderate'`; `AUDIT_ACTIONS` + `'ride.hidden'`, `'ride.restored'`,
  `'ride.reports_dismissed'`; `AUDIT_SUBJECT_KINDS` + `'ride'`; `AuditEntry.details` + `reportCount:
  z.number().int().nonnegative().optional()`.
- API-документы: `RideDoc` + `hiddenAt: Date|null`, `hiddenFromStatus: 'published'|'cancelled'|null`,
  `openReportCount: number`, `lastReportAt: Date|null` (в `VIEWER_FIELDS` — `satisfies` заставит; в
  `PUBLIC_PROJECTION` и `RidePublicDoc` — исключить); `RideReportDoc { _id, rideId, reporterUserId, reason,
  comment: string|null, createdAt, resolvedAt: Date|null, resolution: 'hidden'|'dismissed'|null, resolvedBy:
  string|null }`; `RIDE_REPORTS_COLLECTIONS = { reports: 'ride_reports' }`.
- Политика: `RIDES_POLICY.reportLimit = { limit: 20, windowSec: 86400 }` (ключ `rides-report:<uid>`);
  `ridePhase`: `hidden` → `cancelled` → `past` → `upcoming`; `rideViewer(ride, viewer, now, reported)` —
  `hidden` → всё `false`; `canReport = viewer && role ≠ organizer && !reported && status ≠ hidden`;
  `visibleTo(doc, userId)`; `moderationTransition(doc, action)` → `ok | 'RIDE_INVALID_STATE'`.

**TESTS — test matrix**

| Уровень | Что |
|---|---|
| unit contracts | порядок справочников (статусы, фазы, причины, права, действия, вид объекта); `hidden` разбирается; `RideViewer` без новых полей → `false`; `CreateRideReportRequest` (лишний ключ, причина вне справочника, комментарий 501, управляющие символы, пустой → `null`); запросы модерации строгие, причина 2 символа → `TOO_SHORT`; `details.reportCount` |
| unit api | `rides.policy.test.ts`: фаза `hidden` приоритетнее `cancelled/past`; `rideViewer` скрытого — всё `false`; `canReport` (организатор, `reported`, прошедший/отменённый — `true`); `visibleTo`; переходы (скрыть из published/cancelled/hidden, вернуть, отклонить без жалоб/скрытого); `ride-reports.repository.test.ts` — сторож: только `insertOne` и `updateMany` с `resolvedAt: null`, без delete/replace; `permissions.test.ts` — moderator имеет `rides.moderate`, organizer — нет |
| int api (реальная MongoDB) `ride-reports.int.test.ts` | жалоба → 200, `viewer.reported/canReport`; повтор → 200, одна запись, `openReportCount` = 1; два райдера → 2; организатор → 409; гость → 401; лимит 21-я → 429 + `retryAfterSec`; лишнее поле → 400; несуществующий/скрытый (чужой) → 404; `me`/лента — `reported` у карточки; лог без комментария |
| int api `rides-moderation.int.test.ts` | без сессии 401; organizer-роль 403; moderator и admin 200; очередь `open` (новые сверху по `lastReportAt`, курсор), `hidden` (по `hiddenAt`); карточка без `reporterUserId`/`organizerUserId`, ≤ 100 жалоб; скрыть → жалобы `hidden`, `openReportCount` 0, `version`+1, журнал `ride.hidden` (subject `ride` + title, reason, `reportCount`); вернуть → прежний статус (`published` и `cancelled`), `ride.restored`; отклонить → `dismissed`, `version` прежняя, `ride.reports_dismissed`; устаревшая `version` → 409 `CONFLICT` без записи журнала; `lastReportAt` устарел → 409 `CONFLICT`; вернуть нескрытый / отклонить без жалоб / отклонить скрытый / скрыть скрытый → 409 `RIDE_INVALID_STATE`; **откат**: сбой `PanelAudit.append` (spy reject) → райд и жалобы не изменены |
| int api видимость (`rides.int.test.ts`/`rides-feed.int.test.ts`/`rides-participation.int.test.ts`) | скрытый: публичный `GET` 404; лента и `cities` — нет ни у кого (включая организатора и участника); `me` — 404 участнику и чужому, 200 `phase: 'hidden'` + всё `false` организатору; `join` — 404 чужому/участнику (в т. ч. ветка квоты), 409 организатору; `leave` — 404 участнику/не-участнику, 409 организатору; `update`/`cancel` — 409 организатору, 404 чужому; квота организатора считает скрытый-из-published, не считает скрытый-из-cancelled; после «Вернуть» — всё как до |
| int гонка (`holdTransaction`/`untilBlocked`) | удерживаемая транзакция «Скрыть» (райд записан, не закоммичено) ↔ жалоба: жалоба повторяется и после коммита получает 404, `openReportCount` = 0 и открытых жалоб 0. **Отрицательное доказательство**: жалоба без записи райда первой (только `insertOne`) → остаётся открытая жалоба при скрытом райде — тест краснеет по результату; итог — в §12 |
| int миграция | `0017_ride_reports`: индексы (unique, partial-фильтры), бэкфилл полей у старого райда, повторный `up` без изменений; место после предыдущей; список применённых |
| app (jest, TZ Минск) | карточка: «Пожаловаться» только при `canReport`; строка «Вы пожаловались…» при `reported`; баннер скрытого организатору без действий; гость — без кнопки; экран жалобы: выбор причины обязателен, комментарий, ошибки (429, 404, сеть), успех — баннер; web-вариант не нужен (без развилок) — проверить рендер в jest web, если экраны rides там тестируются |
| admin (vitest) | раздел скрыт без права и виден с ним; список: вкладки, пустые состояния, скелетон, ошибка; карточка: кнопки по статусу, `ReasonDialog` (причина < 3 — кнопка выключена), 409 `CONFLICT`/`RIDE_INVALID_STATE` → `ConflictBanner` + обновление; `AuditScreen` — подпись действий и «Жалоб: N» |
| e2e | `e2e/web.spec.ts` — `/rides/report/<uuid>` гостю → вход; `pnpm e2e:admin` — не обязательно (NOT VERIFIED допустим с причиной) |

**OUT OF SCOPE** — §4 + : правка `results`, `races`, контрактов результатов, `apps/admin/src/features/results`
(параллельный слайс); новые коды ошибок; уведомления; outbox/BullMQ (очередей нет); показ автора жалобы;
удаление жалоб; изменение `PanelAudit`/`PanelGuard`; общий раздел «Модерация» (admin-07); роль MongoDB без
update для `ride_reports`.

# 12. Outcome (coder)

_(заполняет coder)_
