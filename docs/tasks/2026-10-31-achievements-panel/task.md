# Достижения: ручная выдача и отзыв в панели «Протокол»


> Решения оркестратора: RC-1…RC-14 приняты по рекомендации архитектора; разбиение — **PR A** (контракты, API,
> api-client, правила, документы) и **PR B** (экраны панели).
Уровень: task3 (панель, права, аудит, сверка, гонки). Follow-up серии достижений (уровни, сезонные, push N1/N2).
Out of Scope v1: «Панель: ручная выдача/отзыв, статистика достижений».

## 1. Title

Блок «Достижения» в карточке райдера панели: ручная выдача, ручной отзыв и снятие ручного решения — с обязательной
причиной в журнале действий.

## 2. Goal

Команда платформы исправляет выдачу, когда факты не отражают реальность: технический сбой (заезд не засчитался,
хотя был) — выдать; нечестный результат, который нельзя снять через протокол, — отозвать. Каждое действие — с
причиной в append-only журнале.

### Решения M1–M8 (автор — сессия follow-up, 2026-10-31)

- **M1 — право** `achievements.manage` — только admin (в конец `PERMISSIONS`, `ROLE_PERMISSIONS`).
- **M2 — где.** Карточка райдера в панели «Модерация» → «Профили райдеров» → карточка (`/rider-profiles/<userId>`) —
  блок «Достижения» (виден при `achievements.manage`): все выдачи райдера — несезонные и сезонные — со статусом
  («выдано», «отозвано сверкой», «отозвано вручную», «выдано вручную»), объектом, уровнем, датой факта; ручные — с
  датой и сотрудником решения.
- **M3 — выдать вручную:** код (несезонный: объект — id гонки/маршрута/райда по виду кода; сезонный: сезон) + причина
  (`ActionReason`, обязательна). Объект должен существовать и подходить виду кода (проверка портом владельца); дата
  факта — дата объекта; уровень счётного кода — выбирает admin (по умолчанию бронза). Если у райдера уже есть видимая
  выдача кода (того же сезона) — 409. Ручная выдача не отзывается сверкой и не меняется ею (объект, уровень), пока
  её не снимут (M5). Райдер получает вспышку и уведомление (push — механизм PR push).
- **M4 — отозвать вручную:** любая видимая выдача (фактовая или ручная) + причина. Сверка её не восстанавливает,
  пока ручное решение не снимут. Райдер видит молча (как A4), без уведомления.
- **M5 — снять ручное решение** («Вернуть автоматике») + причина: выдача снова подчиняется сверке (следующая сверка
  выдаст/отзовёт по фактам).
- **M6 — модалка** с обязательной причиной (как у других деструктивных действий панели: предупреждение «причина
  видна команде»), запись `PanelAudit.append` в транзакции действия: `achievement.granted_manually` /
  `achievement.revoked_manually` / `achievement.override_cleared`, subject `rider` (`Участник ·<id>`), details — код,
  вид объекта, id объекта, уровень; без имён. Логи — id сотрудника и исход.
- **M7 — райдер** не видит, что выдача ручная (ответы приложения прежние).
- **M8 — гонки.** Ручное действие и параллельная сверка одного райдера (GET или серверная): ручное решение — первым
  условием записи (сверка пишет только документы без ручного флага), транзакция ручного действия — с замком выдачи
  первым действием; тест-ворота + отрицательное доказательство.

## 4. Out of Scope

- Статистика достижений, массовые операции, поиск райдеров без жалоб (вход — существующая карточка райдера).
- Ручная выдача несуществующих (новых) кодов, произвольный текст достижения.

## 5. Architecture Context

Архитектор, 2026-10-31. Основа — ADR-0020 («выдача сверкой при чтении» + дополнения уровни / сезонные / push N1 / N2),
код ветки `feature/achievements-panel` поверх PR #155 (N2). Ручное решение — **дополнение** модели сверки, не
второй источник выдач: документ выдачи остаётся один на `(userId, code)` / `(userId, code, seasonId)`.

### 5.A Хранение ручного решения — поле на документе выдачи (выбрано)

`override?: { decision: 'granted' | 'revoked'; at: Date; byUserId: string } | null` — в **обеих** коллекциях
(`achievement_grants`, `achievement_season_grants`). Новые документы пишут явный `null`; у старых поля нет — фильтр
`{ override: null }` совпадает и с отсутствующим полем (`pokatim-db.md`, «Документы»). **Миграции нет** (0045 не
нужна): индексы прежние, чтения — по префиксу `userId` уникальных индексов.

Почему не отдельная коллекция `achievement_overrides`:

- «сверка не трогает ручное» стало бы условием по **другому** документу — write skew (snapshot isolation его не
  ловит, `db.md`): каждой записи сверки понадобился бы замок или транзакция с чтением второй коллекции. Поле на том
  же документе делает условие частью фильтра той же атомарной операции (RC-2 ADR-0020 сохраняется: одна условная
  операция на код);
- уникальный индекс выдачи уже сериализует «одна выдача на код» — ручная выдача без документа конфликтует со вставкой
  сверки через `isDuplicateKey`;
- стирание аккаунта (`deleteMany({ userId })`) уносит решения без нового шага; история — в `panel_audit`.

Семантика полей при ручном решении:

| Действие | Условие (первая операция транзакции) | Запись |
|---|---|---|
| Выдать, документа нет | `insertOne` (уникальный индекс) | документ: `object`, `factAt`, `level` из порта/формы, `seenAt: null`, `seenLevel: null`, `notifiedLevel = level`, `revokedAt: null`, `override: granted` |
| Выдать, документ отозван (сверкой или вручную) | `findOneAndUpdate({ userId, code, revokedAt: { $ne: null } })`, pipeline, `returnDocument: 'before'` | те же поля; `_id` прежний; `seenAt`/`seenLevel` → `null` (новая выдача вспыхивает — AC3; отличие от A4 осознанно, RC-13); `notifiedLevel = $max(прежний, level)` |
| Выдать, есть видимая | промах `findOneAndUpdate` → `insertOne` → дубль индекса (ловится **снаружи** `run`) | `409 ACHIEVEMENT_INVALID_STATE { reason: 'already_granted' }` |
| Отозвать | `findOneAndUpdate({ userId, code[, seasonId], revokedAt: null })`, `returnDocument: 'before'` | `revokedAt = now`, `override: revoked` (объект, уровень, `seenAt` не трогаются); промах — `409 { reason: 'not_granted' }` |
| Вернуть автоматике | `findOneAndUpdate({ …ключ, override: { $ne: null } })`, `returnDocument: 'before'` | `override: null`; промах — `{ cleared: false }` без журнала (идемпотентно) |

`grantedAt` ручной выдачи на отозванном документе не меняется (наружу не выходит; панель показывает дату решения из
`override.at`).

### 5.B Сверка (GET и серверная) не трогает ручные решения — два рубежа

1. **План** (чистые функции): `StoredGrant`/`StoredSeasonGrant` получают `override`; `reconcilePlan` и `seasonalPlan`
   пропускают код/ключ с `override != null` целиком (ни insert, ни refresh/restore/revoke) — без шума дублей и пустых
   транзакций.
2. **Фильтр каждой записи сверки** (защита от устаревшего плана, M8): `revoke`, `restoreOrRefresh` (обе ветки, с `tx`
   и без), `revokeSeasonal`, `restoreSeasonal` — `override: null` в фильтре. Вставки сверки (`insertGrant`,
   `insert*InTx`, `insertSeasonal`) защищены уникальным индексом (документ ручной выдачи уже есть → дубль → `false`).
   `markSeen` условие не получает (показ ручной выдачи — тот же путь).

Гонки (M8): транзакция ручного действия **первой операцией пишет сам документ выдачи** (это и есть «замок выдачи»:
отдельного `$inc version` не нужно — та же схема, что `restoreOrRefresh` в N1, первой операцией без чтения-проверки).
Нетранзакционная запись сверки, встретившая незакоммиченную транзакцию по тому же документу, ждёт её коммита и
вычисляет фильтр по новому состоянию → `override` уже не `null` → промах. Транзакционная запись сверки
(`restoreOrRefresh` с событием) получает `WriteConflict` → повтор колбэка → промах фильтра → события нет. Обратный
порядок (сверка закоммитила первой) — ручная транзакция видит новое состояние: выдача стала видимой → 409
`already_granted`; отозвана → отзыв вручную `not_granted` (409). Доказательство — тест-ворота §7.6.

### 5.C Объект и дата ручной выдачи — порты владельцев

Вид объекта **выводит сервер из кода** (клиент шлёт только `objectId`): новая таблица контракта
`ACHIEVEMENT_OBJECT_KIND_BY_CODE satisfies Record<AchievementCode, AchievementObjectKind>` (`race_*`, `races_5` →
`race`; `route_first`, `routes_5` → `route`; `ride_*`, `rides_10` → `ride`; `season_*` → `season`). «Объект чужого
вида» = id не найден среди объектов вида кода → один ответ `400 VALIDATION_FAILED { fields: [{ path: 'objectId',
code: 'INVALID' }] }` (одна ошибка поля формы; различать «нет» и «не тот вид» панели не нужно).

| Вид | Порт (через `index.ts` владельца) | Годен | Дата факта | Название в ответах |
|---|---|---|---|---|
| race | `RIDER_RESULTS.racesOf([id])` (есть) | опубликована или отменена (черновик/неизвестная — нет в карте) | `windowStartsAt` | `racesOf` |
| route | **новый** `RIDER_ROUTE_RIDES.routeTitles(userId, ids)` → `RouteRideRoutes.rideableTitles` (каталог или свой готовый — та же видимость, что «Заезды по маршруту», RC-4) | виден райдеру сейчас | момент решения (`now`) — у маршрута нет даты события (RC-2) | тот же метод при каждом ответе; стал невидим — выдача не в ответе (как RC-4) |
| ride | **новый** `RIDER_RIDES.ridesOf(ids)` → `RidesRepository` (условие рядом с `pastFactsOf`: `status: 'published'`, `startsAt < now`; скрытый и отменённый — нет) | опубликован, старт прошёл | `startsAt` | тот же метод |
| season | `RIDER_SEASON_STANDINGS.outcomesOf(userId, [id], now)` (есть) | завершённый известный сезон (`final` или `pending`) | `endsBefore − 1 мс` (как S3); у `pending` порт **добавляет** `endsBefore` (сейчас его нет) | название исхода (как сейчас) |

Уровень: счётный код (`isLeveledCode`) — `level` формы, по умолчанию `bronze` (ранг 1); разовый и сезонный —
`level` в теле запрещён (400 на поле `level`), хранится `null`.

Сборка: `AchievementObjects` (`AchievementsReadModule`, только race/route/ride — `ResultsCoreModule`, `RidesCoreModule`,
`RouteRidesCoreModule` уже импортированы) — `resolve(userId, ref, now) → { title, factAt } | null` (проверка ручной
выдачи) и `titles(userId, refs) → Map<"kind:id", string>` (одна пачка на ответ). Сезоны — порт `standings`, его
`AchievementsReadModule` не получает (`sharing`), поэтому сезонная ветка — в сервисах `AchievementsSyncModule` /
`AchievementsModule`, которые уже держат `RIDER_SEASON_STANDINGS` через `AchievementsReconciler.seasonOutcomes`.

### 5.D Ручная выдача в ответах райдера (M7 — ответ неотличим)

- `GET /v1/achievements` (`AchievementsService.sync`): после сверки — видимые документы делятся на фактовые
  (`override == null` → прежний путь «титулованные факты ∩ видимые») и ручные (`override.decision === 'granted'` →
  объект, `factAt`, `level` **из документа**, название — `AchievementObjects.titles`; нет названия — элемент не
  отдаётся, лог `achievements.manual_object_missing uid=`). Для ручного кода факт этого кода в ответ **не** идёт
  (иначе другой объект/уровень). `seen = isSeen(doc, doc.level)`. `progress` — по фактам, но строка счётного кода с
  ручной выдачей ранга ≥ `progress.level` выкидывается (RC-9). Сезонные: `visibleSeasonal` — ручная видимая
  показывается при наличии исхода сезона (`final` или `pending`, название из исхода) независимо от `earned`; сбой
  порта сезонов — как сейчас (сезонных нет в ответе).
- Публичный список `GET /v1/riders/:publicId/achievements` (RC-1): читает **только** ручные решения райдера
  (`overridesOf(userId)` — обе коллекции, `override: { $ne: null }`, префикс `userId`): отозванный вручную гоночный
  код / сезонный ключ — убирается; выданный вручную `race_*` / `season_*` — добавляется (название — `racesOf` /
  исход сезона, `alsoSeasonIds` — сезоны ручных выдач). Маршруты и райды публично по-прежнему не показываются (A7).
  Отклонение от RC-S5 («без чтения выдач») — только чтение решений, записи нет.
- Карточка сторис (`ACHIEVEMENTS_FOR_SHARING.cardFacts`, RC-1): ручная выдача — объект/дата/уровень из документа,
  название — `AchievementObjects` (маршрут `sharing` всё равно берёт из каталога); ручной отзыв — `revokedAt` → `null`
  (409, как сейчас); фактовая — без изменений.
- Статистика профиля (`riders.summarize`) и прогресс — только факты (ручное решение их не меняет).

### 5.E Уведомление о ручной выдаче

- Ручная выдача пишет в своей транзакции outbox `achievements.grant-noticed { grant, grantId, level, origin: 'server' }`
  (RC-4: новый `origin` не вводим — enum разбирает worker `notifications`, смена схемы ломала бы порядок выката;
  семантика «райдер не в приложении → push» совпадает с серверной сверкой). Ручной отзыв и снятие — без события.
- Порт `ACHIEVEMENT_NOTICES` (`AchievementNoticesService.notice`): `findGrant` дополнительно отдаёт `override`,
  `object`, `level`. Несезонная с `override.decision === 'granted'` — **без перепроверки фактами**: ранг события ≤
  `storedRank`, название — `AchievementObjects.titles` (нет названия — `state`). Сезонная ручная — исход сезона любого
  статуса (`final`/`pending`) → название; нет исхода — `state`. Отозванная (в т. ч. вручную) — `state`, как сейчас.
  Документ, у которого решение сняли до доставки, — прежняя проверка фактами.
- Схлопывание `achievement:<grantId>` по рангу (`notifications`): повторная ручная выдача на **прежнем** документе того
  же ранга в окне TTL уведомления (90 дн.) не создаёт второго push — вспышка в приложении есть (RC-3, принять).
- Райдер без маркера первой сверки получает уведомление (это явное решение команды, не «ретро»); его первая сверка
  ручной документ не трогает (план пропускает код).

### 5.F «Вернуть автоматике» и немедленная сверка (RC-5)

После коммита снятия — `AchievementsReconciler.reconcile(userId, 'server')` вне транзакции, **только если у райдера
есть маркер первой сверки** (иначе первую сверку оставляем приложению, A3). Сбой (в т. ч. порта сезонов — `server`
его не глотает) — лог `achievements.override_reconcile_failed by=<actor>`, ответ `{ cleared: true, reconciled: false }`
— досверит следующий GET или регламент. Так статус в панели сразу отражает факты; M5 («следующая сверка») выполняется
немедленно, а не «когда-нибудь» (регламент N2 берёт только райдеров изменившихся источников).

### 5.G Панель — API

`AchievementsAdminController` (`@Controller('admin/rider-achievements')`, `@UseGuards(PanelGuard)`,
`@RequirePermission('achievements.manage')` на классе; `no-store` ставит `PanelGuard`) → `AchievementsPanelService`:

| Метод | Путь | Тело / ответ |
|---|---|---|
| GET | `:userId` | `RiderAchievementsAdmin` |
| POST | `:userId/grant` | `GrantRiderAchievementRequest` → `204` |
| POST | `:userId/revoke` | `RevokeRiderAchievementRequest` → `204` |
| POST | `:userId/clear` | `ClearRiderAchievementOverrideRequest` → `200 ClearRiderAchievementOverrideResult { cleared, reconciled }` |

Порядок мутации: лимит `achievements-panel:<actorUid>` 60/ч (`consumeUserLimit`, `src/user-limit.ts`) → живой
аккаунт (`IdentityAccounts.liveUserIds([userId])`, нет — `404 NOT_FOUND`) → (выдача) объект через порт (5.C, вне
транзакции) → `MongoTransactions.run`: **запись выдачи первой** → (выдача) outbox → `PanelAudit.append` → после `run`:
`isDuplicateKey(…, уникальный индекс)` → 409; лог `achievements.manual action=<granted|revoked|cleared> by=<actor>
outcome=<…>` (без `userId` райдера, кода объекта, причины). Колбэк — без логов/Redis/HTTP (повторяется).

GET: обе коллекции (все документы, включая отозванные) + названия (`AchievementObjects` + исходы сезонов
`reconciler.seasonOutcomes`, мягко: сбой → названия сезонов `null`, `seasonsAvailable: false`) + имена сотрудников
решений (`PanelDirectory.displayNames`) + «по фактам» (`facts.evaluate` — уровень или «не заработано»; сезон — по
`final`-исходу, `pending`/сбой — `unknown`) (RC-6). Без записи, без сверки. Статус — чистая `adminStatus(doc)`:
`revokedAt == null` → `granted_manually` | `granted`; иначе `revoked_manually` | `revoked`.

Журнал (M6): `achievement.granted_manually` / `achievement.revoked_manually` / `achievement.override_cleared`, subject
`{ kind: 'rider', id: userId, label: riderSubjectLabel(userId) }` (`profile/index.ts`), `reason`, `details` —
`achievementCode`, `objectKind`, `objectId` (сезонной — `seasonId`), `achievementLevel` (если есть); значения — из
записанного документа (`returnDocument: 'before'` для отзыва и снятия). Без имён и названий объектов.

### 5.H Объём и разбиение

Объём велик (контракты, 4 эндпоинта, сверка, 3 порта владельцев, уведомления, публичный список, карточка, панель).
Рекомендуемое разбиение одной задачи на два PR (стек на `feature/achievements-panel`):

- **PR A — API:** контракты, `api-client`, модуль `achievements` (+ правки портов `results`/`rides`/`route-rides`/
  `standings`), правила и документы. Готов сам по себе (эндпоинты под правом, без UI).
- **PR B — панель:** блок «Достижения» в карточке, диалоги, i18n, журнал панели (подписи действий и деталей).

## 5.1 Placement & Reuse Gate

| Что | Где | Почему / reuse |
|---|---|---|
| Право `achievements.manage` | `packages/contracts/src/admin/permissions.schema.ts` (в конец) + `ROLE_PERMISSIONS` admin (`PERMISSIONS` целиком — новое право admin получает автоматически; moderator/organizer — не добавлять) | M1 |
| Действия и детали журнала | `admin/audit.schema.ts` (`AUDIT_ACTIONS` в конец; `AuditEntry.details` + 4 поля), `panel/panel.collection.ts` (`AuditDetailsDoc`) | append-only журнал `PanelAudit` — reuse |
| Схемы панели, `ACHIEVEMENT_OBJECT_KIND_BY_CODE` | `packages/contracts/src/achievements/achievement-admin.schema.ts` (новый) + `achievement.schema.ts` (таблица видов) | contracts-first; таблица нужна API и панели (≥2 потребителя) |
| Код ошибки | `common.ts` `ErrorCode` + `ACHIEVEMENT_INVALID_STATE` (в конец) | только панель |
| Контроллер / сервис панели | `apps/api/src/modules/achievements/achievements-admin.controller.ts`, `achievements-panel.service.ts` в `AchievementsModule` | владелец выдач — `achievements` (единственный писатель); `profile` выдач не пишет |
| Политика | `achievements.policy.ts`: пропуск `override` в планах, `adminStatus`, фильтр `progress`; таблица видов — из контрактов | чистые функции, рядом с `reconcilePlan` |
| Объекты | `achievement-objects.ts` (`AchievementObjects`, `AchievementsReadModule`) | одна точка названий ручных выдач для GET, карточки, уведомлений, панели |
| Запись | `achievements.repository.ts` (`manualGrantInTx`, `insertManualGrantInTx`, `manualRevokeInTx`, `clearOverrideInTx` + сезонные, `listForPanel`, `overridesOf`; `override: null` в фильтрах сверки) | единственный писатель |
| Порты владельцев | `rides`: `RIDER_RIDES.ridesOf` (условие — `RidesRepository`, рядом с `pastFactsOf`); `route-rides`: `RIDER_ROUTE_RIDES.routeTitles` (делегирует `RouteRideRoutes.rideableTitles` — `RouteCatalog` не расширяется); `standings`: `endsBefore` в `pending`-исходе | новый метод порта владельца, не чтение чужой коллекции |
| Граф модулей | `AchievementsModule` + `PanelModule`, `IdentityAccountsModule` (новые рёбра `achievements → panel`, `identity` уже есть); циклов нет (`panel` о `achievements` не знает) | `PanelGuard`, `PanelAudit`, `PanelDirectory`, `CurrentPanelUser` — из `panel/index.ts` |
| api-client | `packages/api-client/src/admin.ts` (4 метода) | reuse `get`/`post` |
| Панель | `apps/admin/src/features/rider-profiles/RiderAchievementsSection.tsx`, `GrantAchievementDialog.tsx`, `rider-achievements-query.ts`, `rider-achievements-format.ts` | рядом с карточкой (M2); `ReasonDialog`, `DataTable`, `StatusTag`, `SelectField`, `TextField`, `Banner`, `EmptyState`, `ErrorState`, `useCan` — reuse |
| `ReasonDialog` | + необязательный `confirmDisabled` (форма выдачи: валидный UUID объекта) | компонент проекта `apps/admin/src/ui`, с тестом; не `@rkarakulov/ui` |
| Тексты | `packages/i18n/src/ru.ts`: `admin.riderAchievements.*`, `admin.audit.action.achievement.*`, `admin.audit.details.achievement`; имена кодов и уровней — существующие `achievements.<code>.title`, `achievements.level.*` | без второго каталога |

Запрещённые дубли: второй расчёт «заработано» в панели (только `facts.evaluate`/`seasonalAchievements`); чтение
`races`/`rides`/`routes`/`season_*` коллекций из `achievements`; копия `riderSubjectLabel`; свой диалог причины вместо
`ReasonDialog`; своя карта «код → вид» в панели.

## 6. Relevant Files

API (читать и менять):

- `apps/api/src/modules/achievements/{achievements.collection.ts, achievements.repository.ts, achievements.policy.ts,
  achievements-reconciler.ts, achievements.service.ts, achievement-notices.ts, achievements-for-sharing.ts,
  achievement-facts.reader.ts, achievements.module.ts, index.ts}`; новые — `achievements-admin.controller.ts`,
  `achievements-panel.service.ts`, `achievement-objects.ts`.
- `apps/api/src/modules/rides/{rider-rides.port.ts, rider-rides.ts, rides.repository.ts}`;
  `apps/api/src/modules/route-rides/{rider-route-rides.port.ts, rider-route-rides.ts}`;
  `apps/api/src/modules/standings/{rider-season-standings.port.ts, rider-season-standings.ts}`.
- `apps/api/src/modules/panel/{panel.collection.ts, permissions.ts}`; `apps/api/src/admin-routes.test.ts` (сторож —
  новый контроллер попадает сам).
- Образцы: `profile/rider-profiles-moderation.controller.ts`, `profile/profile-moderation.service.ts`
  (`unblockAvatar` — транзакция → журнал → лог после), `account/account-erasures-admin.service.ts` (лимит
  сотрудника), `achievements-reconciler.ts` (`insertWithNotice` — дубль снаружи `run`).

Контракты / клиент: `packages/contracts/src/{common.ts, achievements/achievement.schema.ts, admin/permissions.schema.ts,
admin/audit.schema.ts}`, новый `achievements/achievement-admin.schema.ts`, `packages/contracts/src/index.ts`;
`packages/api-client/src/admin.ts`.

Панель: `apps/admin/src/features/rider-profiles/RiderProfileScreen.tsx`, `apps/admin/src/ui/ReasonDialog.tsx`,
`apps/admin/src/features/audit/AuditScreen.tsx`, `apps/admin/src/session/can.tsx`, `packages/i18n/src/ru.ts`.

## 7. Implementation Notes

### 7.1 Контракты (обратная совместимость)

- Ответы приложения (`AchievementList`, `PublicRiderAchievementList`, карточка) — **без изменений схемы** (M7): старые
  сборки не замечают ручных выдач.
- `PERMISSIONS`, `AUDIT_ACTIONS`, `ErrorCode` — только в конец. `AuditEntry.details` — новые поля `optional()`.
- `ACHIEVEMENT_OBJECT_KIND_BY_CODE` — `satisfies Record<AchievementCode, AchievementObjectKind>`: новый код без вида не
  скомпилируется; тест политики сверяет с видом `Earned.object.kind` каждого правила (`ACHIEVEMENT_RULES`).
- `GrantRiderAchievementRequest = strictObject({ code: AchievementCode, objectId: Uuid, level:
  z.enum(ACHIEVEMENT_LEVELS).optional(), reason: ActionReason })` + refine: `level` только у `isLeveledCode` (иначе поле
  `level` `INVALID`). `RevokeRiderAchievementRequest` / `ClearRiderAchievementOverrideRequest` = `strictObject({ code,
  seasonId: Uuid.optional(), reason: ActionReason })` + refine: `seasonId` ⇔ `isSeasonalCode(code)` (поле `seasonId`
  `REQUIRED`/`INVALID`).
- `RiderAchievementsAdmin = { items: RiderAchievementAdminItem[], seasonsAvailable: boolean }`;
  `RiderAchievementAdminItem = { code: AchievementCode, object: { kind, id: Uuid, title: string | null }, level:
  AchievementLevel | null, factDate: LocalDate, status: 'granted' | 'granted_manually' | 'revoked' |
  'revoked_manually', grantedAt: iso, revokedAt: iso | null, override: { decision, at: iso, by: { userId, displayName
  } } | null, byFacts: { state: 'earned' | 'not_earned' | 'unknown', level: AchievementLevel | null } }`. Строгие enum
  допустимы — панель выкатывается одним деплоем с API (R6). Порядок — `sortForList` (факт ↓).
- `AchievementInvalidStateDetails = { reason: 'already_granted' | 'not_granted' }`.
- `AchievementsGrantNoticed` (внутреннее событие) — без изменений (`origin: 'server'`).

### 7.2 Данные

- `AchievementGrantDoc.override?` / `AchievementSeasonGrantDoc.override?` — `AchievementOverrideDoc | null`;
  `grantDoc`/`seasonGrantDoc` сверки пишут `override: null`. Проекции `listOf`/`listSeasonalOf` + `override`;
  `findGrant` + `override`, `object`, `level` (несезонная).
- Ручная выдача на отозванном документе — pipeline, все значения через `$literal` (`pokatim-db.md`).
- Никаких `update` в `panel_audit`; сторож `panel.repository.test.ts` не меняется.
- Стирание аккаунта — без изменений (решения уходят с документами). Гонка «проверка живости → ручная запись ↔
  стирание» принята (как R7 панели): поздняя ручная выдача удалённому оставит документ без владельца-сессии;
  комментарий в репозитории; повторный проход стирания (`achievements` идемпотентен) его уберёт.
- Миграции нет; `migrations/index.ts` не меняется.

### 7.3 Сверка и чтения — порядок правок

1. `reconcilePlan`/`seasonalPlan` — пропуск `override` (unit).
2. Фильтры `override: null` в 4 методах записи сверки (int: устаревший план не пишет).
3. `sync` — ручные элементы + фильтр `progress`; `visibleSeasonal` — ручные.
4. `publicList` — `overridesOf`; `cardFacts` — ручные.
5. `AchievementNoticesService` — ручная ветка.

### 7.4 Панель (UI-план, скил `app-dev-kit:web-ui`)

- **Роль и доступ:** блок рендерится в `RiderProfileScreen` под жалобами только при `useCan('achievements.manage')`
  (moderator — блока нет, запроса нет; AC1). 403 запроса блока — блок не показывается (карточка остаётся).
- **Данные:** отдельный запрос `['admin', 'rider-achievements', userId]` (`queryOptions`), не зависит от карточки
  профиля; после мутации — `invalidateQueries` блока и `['admin', 'audit']`.
- **Раскладка:** `h2` «Достижения» + кнопка «Выдать вручную» (сразу видны, AGENTS §4.12) → при
  `seasonsAvailable: false` — `Banner tone="warning"` «Сезонные достижения временно недоступны» → `DataTable` (caption):
  «Достижение» (название кода + уровень), «Объект» (вид + название; `null` — «Объект недоступен» + короткий id),
  «Дата факта» (день по Минску), «Статус» (`StatusTag`: выдано — success, выдано вручную — info, отозвано сверкой —
  neutral, отозвано вручную — warning), «Решение» (сотрудник · дата-время по Минску; нет — «—»), «По фактам»
  («заработано · Серебро» / «не заработано» / «неизвестно»), действия строки: «Отозвать» (видимая), «Вернуть
  автоматике» (`override != null`). Действия — кнопки `size="sm"` с `aria-label`, включающим название достижения.
- **Состояния:** первая загрузка — скелетон строк `DataTable`; ошибка без данных — `ErrorState` (сеть/сервер) с
  повтором; ошибка обновления при данных — `RefreshFailedBanner`; пусто — `EmptyState` «Достижений нет»; мутации —
  `busy` кнопки диалога.
- **Выдать вручную** (`GrantAchievementDialog` = `ReasonDialog` с `extraFields`): `SelectField` «Достижение» (12 кодов
  каталога; несезонный с видимой выдачей — `disabled` с пояснением), `TextField` «ID гонки / маршрута / кофе-райда /
  сезона» (подпись по `ACHIEVEMENT_OBJECT_KIND_BY_CODE`; подсказка, где взять id), `SelectField` «Уровень» — только
  для счётного (по умолчанию «Бронза»); `Banner tone="warning"` «Причина видна команде»; `confirmDisabled`, пока id не
  UUID. Последствия: «Райдер увидит достижение и получит уведомление. Автоматика не отзовёт его, пока решение не
  снимут».
- **Отозвать** — `ReasonDialog destructive`: «Достижение пропадёт у райдера без уведомления. Автоматика не вернёт его,
  пока решение не снимут». **Вернуть автоматике** — не деструктивный: «Решение снимется, выдачу пересчитают по фактам
  сразу». `reconciled: false` — `Banner` «Пересчёт по фактам выполнится при следующем входе райдера».
- **Ошибки в диалоге (`errorText`):** 409 `already_granted` / `not_granted` — текст + перечитывание блока; 400
  `objectId` — «Объект не найден или не подходит этому достижению»; 400 `level`/`seasonId` — «Проверьте поля»; 404 —
  «Райдер не найден»; 429 — общий текст лимита.
- **Доступность:** таблица с caption и `scope` заголовков (`DataTable`), фокус возвращается на кнопку после закрытия
  `Dialog`, поля с `label`, ошибка — `role="alert"`, неактивные варианты — с текстовой причиной.
- **i18n / дизайн-система:** все строки — `@pokatim/i18n`; только компоненты `apps/admin/src/ui` и классы/токены
  `@pokatim/design-tokens` (тема panel, светлая); hex/px нет; новых токенов не требуется.

### 7.5 Security checklist (зона — панель, права, журнал: `pokatim-security.md`)

- **AuthN/AuthZ:** каждый маршрут `admin/rider-achievements/*` — `PanelGuard` + `@RequirePermission(
  'achievements.manage')` на классе (сторож `admin-routes.test.ts`); право — только admin (`permissions.test.ts`:
  moderator/organizer без него); актор — только `@CurrentPanelUser()`; `userId` пути — pipe `Uuid`. Access JWT
  приложения панель не принимает (прежнее поведение гарда).
- **Входные данные:** тела — `strictObject`; `code` — строгий `z.enum`; `objectId`/`seasonId` — `Uuid`; `level` — enum;
  в фильтры — только примитивы после zod; вид объекта выводит сервер из кода; существование и годность объекта —
  порт владельца, дата — сервер; клиент не влияет на `factAt`, `seenAt`, `notifiedLevel`.
- **Данные наружу:** ответ панели — явный список полей (int-тест ключей): без e-mail, имени райдера, `seenAt`,
  `seenLevel`, `notifiedLevel`, `_id` выдачи; имя сотрудника — `PanelDirectory`; ответы приложения не раскрывают
  ручной характер (M7, int-тест: ключи `AchievementList` прежние).
- **Злоупотребления:** лимит мутаций `achievements-panel:<actorUid>` 60/ч; одна видимая выдача на код (уникальный
  индекс); снятие — идемпотентно; немедленная сверка после снятия ограничена тем же лимитом.
- **Секреты и логи:** логи — id сотрудника, действие, исход (`granted|conflict|…`), без `userId` райдера, кода объекта,
  названий и причины; событие outbox — только id и коды (прежний payload).
- **Аудит:** `PanelAudit.append` в транзакции действия после записи выдачи (откат — нет записи); subject `rider`
  (`Участник ·<id>`), причина обязательна (`ActionReason` 3–500), details без имён; журнал append-only.

### 7.6 Test matrix

| Уровень | Что |
|---|---|
| Unit — контракты | схемы запросов (strict, `level` только у счётных, `seasonId` ⇔ сезонный, причина 3–500); `ACHIEVEMENT_OBJECT_KIND_BY_CODE` полна; `achievements.manage` и действия журнала — в конце списков |
| Unit — политика | `reconcilePlan`/`seasonalPlan` пропускают `override` (выдан/отозван, с фактом и без); `adminStatus`; фильтр `progress` при ручном ранге; вид каждого правила = таблица видов |
| Unit — права | `permissions.test.ts`: `achievements.manage` только у admin |
| Unit — api-client | 4 метода: пути, тела, разбор ответов |
| Int (реальная Mongo) — `achievements-panel.int.test.ts` | 401/403 без сессии, moderator, organizer; 400: без причины, `level` у разового, сезонный без `seasonId`, неизвестная гонка, черновик, скрытый/будущий райд, чужой приватный маршрут, незавершённый сезон; 404 удалённый райдер; выдача без документа → `GET /v1/achievements` (райдер) — элемент с названием, `seen: false`, уровнем формы, ключи ответа прежние; событие outbox `origin: 'server'`, payload без `userId`; выдача на отозванном документе — тот же `_id`, `seen: false`; 409 при видимой; отзыв → GET без элемента; сверка `read` и `server` после выдачи без факта не отзывает, после отзыва с фактом не восстанавливает, уровень/объект ручной не меняет при новых фактах; снятие → немедленная сверка (с маркером) отзывает/восстанавливает по фактам, без маркера — `reconciled: false` и без записи; повторное снятие — `{ cleared: false }` без журнала; журнал: действие, subject, причина, details (код, вид, id, уровень), без имён; лог без `userId` райдера; публичный список: ручной отзыв гоночного убирает, ручная выдача `race_*`/сезонного добавляет, маршрут/райд — нет; карточка: ручная выдача — 200-путь с объектом документа, ручной отзыв — 409; сезонные — все ветки; стирание аккаунта удаляет ручные документы; ключи ответа панели |
| Int — `achievements-notices.int.test.ts` | ручная выдача без факта → уведомление с названием объекта из порта; ручной сезон в `pending` → уведомление; ручной отзыв до доставки → `state`; решение снято и факта нет → `state` |
| Int — гонки `achievements-panel-locks.int.test.ts` (M8, AC4) | **ворота:** сверка (`read` и `server`) читает выдачи и план, ждёт ворот (обёртка над `facts.evaluate`), ручное действие коммитится, ворота открываются: (1) план `revoke` против ручной выдачи — документ видим; (2) план `refresh` против ручного отзыва — `revokedAt` и `override` прежние, события нет; (3) план `restore` в транзакции с событием против ручной выдачи на отозванном — одно событие (ручное), `notifiedLevel` ручной; (4) вставка: ручная первой → вставка сверки `false`, без события; сверка первой → ручная 409; (5) то же для сезонных; (6) параллельные `Promise.all` ручного действия и сверки × N — инварианты. **Отрицательное доказательство:** те же ворота, где запись сверки выполняется фильтром без `override` (прямой вызов коллекции с прежним фильтром из теста) — ручное решение перезаписано: сценарий действительно воспроизводит гонку |
| Int — порты владельцев | `rider-rides.int.test.ts`: `ridesOf` (опубликован/прошёл — да; скрыт, отменён, будущий — нет); `rider-route-rides.int.test.ts`: `routeTitles` (каталог, свой готовый — да; чужой приватный, снятый — нет); `rider-season-standings.int.test.ts`: `endsBefore` у `pending` |
| Unit/RTL — панель | блок скрыт без права (и без запроса); скелетон; ошибка с повтором; баннер ошибки обновления; пусто; статусы и «по фактам»; диалог выдачи: подпись поля по виду, уровень только у счётного (по умолчанию бронза), подтверждение неактивно без UUID и причины, 409/400 тексты; отзыв и снятие; `reconciled: false` баннер; инвалидация журнала; `ReasonDialog.confirmDisabled`; журнал: подписи новых действий и деталей |
| e2e | `pnpm e2e:admin` — существующий смоук должен остаться зелёным; отдельный сценарий не обязателен (данные гонок в стенде смоука отсутствуют) |

## 8.1 Requirements Consistency (architect)

M1–M8 не меняются; ниже — уточнения и недоопределённости с рекомендацией.

- **RC-1 (вредное следствие M4/M7 — HIGH).** Публичный список строится из фактов без чтения выдач (RC-S5), карточка —
  факты ∩ выдача. Ручной отзыв «нечестного результата» остался бы виден на публичном профиле, а ручная выдача гонки
  — не видна и не делилась бы сторис (райдер узнал бы, что она «особенная», M7). Варианты: (a) публичный список читает
  только ручные решения (`overridesOf`), карточка учитывает ручную выдачу — **рекомендация**, входит в задачу (5.D);
  (b) только убрать ручные отзывы из публичного списка, карточку — follow-up; (c) оставить (цель задачи не
  достигнута для публичного профиля).
- **RC-2 (недоопределённость M3: «дата факта — дата объекта» для маршрута).** У маршрута нет даты события. (a) дата
  решения (`now`) — **рекомендация**; (b) `catalog.publishedAt` — есть только у маршрутов каталога, у своих — нет;
  (c) дату вводит admin — лишнее поле и клиентское время в данных.
- **RC-3 (уведомление при повторной выдаче).** Схлопывание `achievement:<grantId>` по рангу: повторная ручная выдача
  на прежнем документе того же ранга в течение 90 дней не даст второго push. (a) принять (вспышка есть, о коде райдер
  уже слышал) — **рекомендация**; (b) счётчик-ревизия выдачи в payload и `collapseSeq` = (ранг, ревизия) — правка
  `notifications` и события; (c) новый `_id` документа — ломает уникальный индекс/историю.
- **RC-4 (origin события).** (a) `origin: 'server'` — **рекомендация** (push как у серверной сверки, схема события не
  меняется, порядок выката API/worker не важен); (b) новый `'panel'` в enum — worker со старой схемой отбросит событие
  до выката (`invalid_payload`), выгоды нет.
- **RC-5 (M5: когда «следующая сверка»).** Регламент N2 берёт только райдеров с изменившимися источниками — после
  снятия статус мог бы висеть неопределённо долго. (a) немедленная `reconcile(userId, 'server')` после коммита, если
  есть маркер первой сверки — **рекомендация** (5.F); (b) ждать GET райдера (панель покажет устаревший статус); (c)
  поставить задачу `achievements.rider` в очередь из API (нужен producer в API — лишняя связность).
- **RC-6 (M3: уровень заморожен).** Ручная бронза не станет золотом, даже когда факты дадут золото, пока решение не
  снимут. Оставить M3 и показывать в панели колонку «По фактам» (уровень/не заработано) — **рекомендация**;
  альтернатива — ручной уровень как «пол» (сверка повышает) — противоречит M3, нужна явная смена решения человеком.
- **RC-7 (выбор объекта).** M3 даёт только id. (a) поле UUID + проверка портом, подсказка, где взять id — **рекомендация
  v1**; (b) список кандидатов райдера (его гонки, райды, маршруты, сезоны) — отдельный эндпоинт, follow-up.
- **RC-8 (вход — карточка профиля).** Карточка отвечает 404, если у райдера нет документа `profiles`; такому райдеру
  выдать вручную нельзя. (a) принять для v1 (райдер с результатами почти всегда прошёл онбординг) — **рекомендация**;
  (b) показывать блок «Достижения» и в ветке «Профиль не найден» при живом аккаунте.
- **RC-9 (прогресс vs ручной уровень).** «Следующая цель: Серебро 7/15» при ручном золоте противоречива. Выкидывать
  строку `progress` счётного кода, если ручной ранг ≥ уровня строки — **рекомендация** (ответ неотличим, M7).
- **RC-10 (годность объекта).** Гонка — опубликована или отменена (`racesOf`; отменённая допустима — сбой мог быть до
  отмены); райд — опубликован, старт прошёл (скрытый — нет: его название скрыто модерацией); маршрут — виден райдеру;
  сезон — завершён (`final` или `pending`). Связь райдера с объектом (заявка, участие) не проверяется — M3 покрывает и
  случай «заезд не засчитался». Рекомендация — так.
- **RC-11 (сезонный `pending` без даты).** Порт отдаёт `endsBefore` только у `final`. Добавить `endsBefore` в
  `pending`-исход (одна строка в `standings`) — **рекомендация**; альтернатива — запрет ручной выдачи в `pending`
  (лишнее ограничение).
- **RC-12 (статус «видимая выдача» M3/M4).** Видимая = `revokedAt == null` в документе (а не «есть в ответе райдера»:
  ответ ещё фильтрует факты и названия). Так 409/отзыв детерминированы. Рекомендация — так; панель показывает статус
  документа и «По фактам».
- **RC-13 (вспышка при выдаче поверх отозванного).** A4 «восстановление не сбрасывает `seen`» относится к сверке;
  ручная выдача — новое решение (AC3 требует `seen: false`) → `seenAt`/`seenLevel` сбрасываются. Рекомендация — так.
- **RC-14 (лимит панели).** M-решения лимита не задают; `achievements-panel:<actorUid>` 60/ч (как
  `results-panel-user`) — рекомендация.

## 8.2 Отклонения при реализации (PR A, coder)

- **D1 — подписи действий журнала в PR A.** `admin.audit.action.achievement.{granted_manually,revoked_manually,
  override_cleared}` (`packages/i18n/src/ru.ts`) добавлены уже в PR A: `AuditScreen` панели строит ключ по каждому
  `AuditAction`, без подписей `pnpm typecheck` панели красный. Подписи деталей и экраны — PR B.
- **D2 — порт сезонов в `AchievementsPanelService` напрямую.** `AchievementsModule` импортирует `StandingsCoreModule`
  (ребро `achievements → standings` уже есть), сервис панели держит `RIDER_SEASON_STANDINGS`: ручной выдаче нужен
  отказ при сбое порта (а не «сезона нет» → 400), GET панели — отличить сбой (`seasonsAvailable: false`) от «сезонов
  нет»; `reconciler.seasonOutcomes` сбой глотает. Публичный список — по-прежнему `seasonOutcomes` (мягко).
- **D3 — GET панели без проверки живости аккаунта** (5.G её не требует): удалённому райдеру — пустой или остаточный
  список; мутации — 404.
- **D4 — `progressBeyondManual`** — имя чистой функции фильтра `progress` (RC-9) в `achievements.policy.ts`.

## 9. Acceptance Criteria

- AC1. Без `achievements.manage` — 403 (сторож `admin-routes.test.ts`); moderator — блока нет.
- AC2. Выдача/отзыв/снятие без причины — 400; с причиной — запись в журнале с нужными details; объект чужого вида или
  несуществующий — 400/404; уже видимая выдача — 409.
- AC3. Ручная выдача: в списке райдера, `seen: false` (вспышка), уведомление; сверка (GET и серверная) не отзывает и
  не меняет её. Ручной отзыв: из списка пропадает, сверка не восстанавливает. Снятие — следующая сверка по фактам.
- AC4. Гонка ручного действия и сверки — ворота и отрицательное доказательство.
- AC5. Панель: блок, статусы, модалки с причиной, состояния загрузки/ошибки/пусто, i18n, доступность.
- AC6. `pnpm check` зелёный; документы: `profile.md`, `admin-panel.md` (право, раздел), ADR-0020 (ручные решения),
  `.claude/rules`.

## 10. Documentation Impact

- `docs/adr/0020-achievements-reconcile-on-read.md` — «Дополнение: ручные решения (achievements-panel)»: поле
  `override` на документах обеих коллекций (почему не коллекция), два рубежа (план + фильтр `override: null`),
  замок = первая запись документа выдачи, ответы (M7, RC-1 — публичный список читает решения), уведомление
  `origin: 'server'`, немедленная сверка после снятия.
- `docs/product/admin-panel.md` — право `achievements.manage` (admin), блок «Достижения» карточки райдера, действия и
  журнал (`achievement.*`).
- `docs/product/profile.md` — раздел достижений: ручные решения команды (M3–M7), что видит райдер и публичный профиль.
- `docs/product/notifications.md` — уведомление о ручной выдаче, схлопывание при повторной (RC-3).
- `.claude/rules/pokatim-backend.md` («Достижения»: панельный контроллер/сервис, `AchievementObjects`, рёбра
  `achievements → panel, identity (IdentityAccountsModule)`, ветка ручных в `sync`/`publicList`/`cardFacts`/notices,
  немедленная сверка; «Модули и reuse» — модуль панели), `.claude/rules/pokatim-db.md` («Достижения»: `override`,
  фильтры сверки, без миграции), `.claude/rules/pokatim-security.md` («Достижения»: панель, право, журнал, логи),
  `.claude/rules/pokatim-web.md` (если есть раздел карточки райдера — блок и право).
- `docs/tasks/2026-10-31-achievements-panel/pr.md` — без миграций/env; новое право и действия журнала.

## 11. Implementation Context

ENTRY POINTS
- API: `AchievementsAdminController` (`admin/rider-achievements`) → `AchievementsPanelService`.
- Сверка: `AchievementsReconciler.reconcile` (через планы и репозиторий), `AchievementsService.sync`/`publicList`,
  `AchievementsSharing.cardFacts`, `AchievementNoticesService.notice`.
- Панель: `RiderProfileScreen` → `RiderAchievementsSection`.

FILES TO MODIFY — см. §6 и §5.1.

FILES TO READ — ADR-0020 (все дополнения), `docs/tasks/2026-10-31-achievements-push/task.md` (5.A–5.D, 8.2),
`pokatim-backend.md`/`pokatim-db.md`/`pokatim-security.md` «Достижения», образцы из §6.

TYPES & SCHEMAS — `AchievementOverrideDoc`, `StoredGrant.override`, `StoredSeasonGrant.override`, `NoticeGrant`
(+ `override`, `object`, `level`), `RiderSeasonOutcome` (`pending` + `endsBefore`), `RiderRides.ridesOf`,
`RiderRouteRides.routeTitles`; контракты §7.1.

ПОРЯДОК (TDD; contracts-first внутри каждого шага)
1. PR A, контракты: таблица видов, схемы панели, право, действия/детали журнала, код ошибки (unit).
2. PR A, политика: пропуск `override` в планах, `adminStatus`, фильтр `progress` (unit, красные первыми).
3. PR A, порты владельцев: `ridesOf`, `routeTitles`, `endsBefore` в `pending` (int).
4. PR A, репозиторий: `override` в документах и проекциях, фильтры сверки, ручные операции (int).
5. PR A, гонки: `achievements-panel-locks.int.test.ts` — ворота и отрицательное доказательство (красные до фильтров).
6. PR A, сервис/контроллер панели + журнал + лимит + немедленная сверка (int, `admin-routes.test.ts`).
7. PR A, ответы райдера: `sync`, `publicList`, `cardFacts`, notices (int).
8. PR A, `api-client`, правила и документы §10; `pnpm check`.
9. PR B, панель: `ReasonDialog.confirmDisabled` → `RiderAchievementsSection` → `GrantAchievementDialog` → журнал
   (подписи) → i18n (RTL-тесты первыми); `pnpm check`, `pnpm e2e:admin`.

TESTS — §7.6.

OUT OF SCOPE — статистика достижений, массовые операции, выбор объекта из списка (RC-7), поиск райдеров без жалоб,
новые коды и произвольный текст, вход в блок без документа профиля (RC-8), отдельный `origin` события (RC-4).

## 12. Outcome

### PR A (контракты, API, api-client, правила, документы) — 2026-10-31

- **Контракты:** `ACHIEVEMENT_OBJECT_KIND_BY_CODE`, `achievement-admin.schema.ts` (запросы grant/revoke/clear, итог
  снятия, `RiderAchievementsAdmin`, `AchievementInvalidStateDetails`), право `achievements.manage`, три действия и
  четыре детали журнала, `ACHIEVEMENT_INVALID_STATE` — в конце списков. Ответы приложения без изменений.
- **API:** `AchievementsAdminController` → `AchievementsPanelService` (лимит 60/ч, живость, объект портом владельца,
  транзакция «запись выдачи первой → outbox `origin: 'server'` → журнал», 409 снаружи `run`, немедленная сверка после
  снятия при маркере); поле `override` на документах обеих коллекций; планы пропускают ручные; фильтр `override: null` в
  `revoke`/`restoreOrRefresh`/`revokeSeasonal`/`restoreSeasonal`; `AchievementObjects`; ручные ветки в `sync`,
  `publicList` (`overridesOf`), `cardFacts`, `ACHIEVEMENT_NOTICES`; порты `RIDER_RIDES.ridesOf`,
  `RIDER_ROUTE_RIDES.routeTitles`, `endsBefore` у `pending`. Миграции нет.
- **Тесты:** unit — схемы панели, таблица видов, права, политика (пропуск `override`, `adminStatus`,
  `progressBeyondManual`, вид каждого правила); int — `achievements-panel.int.test.ts` (12: доступ, 400/404, выдача и
  ответ райдера, событие, журнал, лог, 409, сверка не трогает ручное, выдача поверх отозванного, снятие с маркером и без,
  маршрут/райд, список панели и деградация сезонов, публичный список и карточка, сезонные, стирание),
  `achievements-panel-locks.int.test.ts` (9), `achievements-notices.int.test.ts` (+2), порты владельцев (+2 и
  `endsBefore`), api-client (+2). Сторож `admin-routes.test.ts` — новый контроллер под `PanelGuard`.
- **Отрицательное доказательство (M8, AC4):** (а) в тесте — запись сверки прежним фильтром без `override` (подмена
  `revoke` и `restoreSeasonal` прямым вызовом коллекции) → ручная выдача стала отозванной / ручной отзыв восстановлен —
  оба теста фиксируют перезапись по результату; (б) прогон ворот с `AUTOMATIC = {}` в репозитории (условие убрано
  целиком) — 5 из 9 тестов `achievements-panel-locks` красные по результату (сценарии 1 read, 1 server, 2, 3, 5),
  зелёные остаются вставка (уникальный индекс), параллельные ×6 и сами отрицательные доказательства.
- **Проверки:** `MONGO_URL_TEST=… REDIS_URL_TEST=… TURBO_CONCURRENCY=1 pnpm check` — exit 0, `Tasks: 15 successful, 15
  total` (api 224 файла / 2534 теста, admin 489, contracts 482, api-client 169).
- **Отклонения:** 8.2 D1–D4.
