# Findings — achievements-panel (PR A) — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..1b7d9df8 (working tree clean)
verdict: APPROVE

Объём: PR A по task.md §5.H (контракты, API `admin/rider-achievements/:userId`, поле `override`, сверка, порты
владельцев, ответы райдера, публичный список/карточка, уведомление, api-client, документы). Экраны панели — PR B, не
дефект; D1 (подписи действий журнала в `ru.ts`) — проверено, обосновано (`tsc` панели зелёный).

Проверено самостоятельно (своя БД `rv_achpanel_test` на replica set :27117, Redis db 13, после прогона удалены):
- `vitest run src/modules/achievements src/admin-routes.test.ts src/modules/panel/permissions.test.ts
  rider-rides.int rider-route-rides.int rider-season-standings.int` — 13 файлов, 175 тестов, все зелёные
  (в т. ч. `achievements-panel.int.test.ts`, `achievements-panel-locks.int.test.ts`, `achievements-notices.int.test.ts`).
- contracts (`src/achievements`, `src/admin`, `common.test.ts`) — 76 зелёных; api-client `admin.test.ts` — 29 зелёных;
  `tsc --noEmit` apps/admin — exit 0. Полный `pnpm check` — NOT VERIFIED (не запускал; отчёт coder — exit 0).

## Измерения

- **Авторизация:** `@UseGuards(PanelGuard)` + `@RequirePermission('achievements.manage')` на классе (гард читает
  `getAllAndOverride` handler+class); актор — только `@CurrentPanelUser()`; `:userId` — `ZodValidationPipe(Uuid)`;
  право — в конце `PERMISSIONS`, только admin (`permissions.test.ts`); сторож `admin-routes.test.ts` обходит модули
  `AppModule` — контроллер попадает автоматически; int-тест: 401 без сессии, 403 moderator/organizer (GET и POST),
  access JWT приложения — 401. Ок.
- **Входные данные:** `strictObject`, `code` — строгий enum, `objectId`/`seasonId` — `Uuid`, `level` — enum + refine
  (только счётный), `seasonId` ⇔ сезонный; в фильтры — только примитивы после zod; `override` собирает сервер; вид
  объекта — `ACHIEVEMENT_OBJECT_KIND_BY_CODE` (`satisfies Record<AchievementCode, …>`), годность/дата — порты владельцев. Ок.
- **Append-only журнал:** `PanelAudit.append(tx, …)` внутри `MongoTransactions.run` после записи выдачи; причина
  обязательна (`ActionReason`); subject `rider` с `riderSubjectLabel`; details — код/вид/id/уровень из записанного
  документа (`returnDocument: 'before'` для отзыва/снятия); промах (409 / `cleared: false`) — без журнала (проверено
  тестом). `AuditDetailsDoc` и контракт `AuditEntry.details` — новые поля `optional()`, чтение журнала отдаёт `details`
  как есть. Ок.
- **Гонки (M8):** первая операция транзакции — запись документа выдачи (`findOneAndUpdate`/`insertOne`), 409 —
  `isDuplicateKey` снаружи `run` (как `insertWithNotice`). Все 4 записи сверки (`revoke`, `restoreOrRefresh` обе ветки,
  `revokeSeasonal`, `restoreSeasonal`) — `...AUTOMATIC` (`override: null`); вставки сверки — уникальный индекс;
  других писателей сверки нет (`markSeen` — по спеке без условия). Планы пропускают код/ключ с `override` (в
  `seasonalPlan` — и для ключей из `earned`, т. к. проверка по `byKey`). Ворота честные: ждут чтения обеих коллекций
  и фактов, отрицательное доказательство подменяет запись прямым вызовом коллекции прежним фильтром и фиксирует
  перезапись по результату. Инварианты `override.granted ⇒ revokedAt = null`, `override.revoked ⇒ revokedAt ≠ null`
  держатся: сверка такие документы не пишет, ручные операции ставят оба поля вместе. Ок.
- **Совместимость ответов приложения (M7):** схемы `AchievementList`/`PublicRiderAchievementList`/карточки не
  менялись; int-тест держит ключи элемента и списка; событие outbox — прежний payload с `origin: 'server'`. Ок.
- **Приватность:** логи `achievements.manual action by outcome`, `override_reconcile_failed by=`,
  `panel_seasons_unavailable` — без `userId` райдера/объекта/причины (int-тест `not.toContain(me.userId / race)`);
  ответ панели — явный список полей (тест ключей, без e-mail, `seenAt`, `seenLevel`, `notifiedLevel`, `_id`). Ок
  (см. LOW-1).
- **Публичный список:** `overridesOf` читается только после `findPublic` (непубличный — 404 до чтения решений);
  добавляются только `race`-объекты и сезоны с исходом; маршруты/райды не выходят (тест). Ок.
- **Удалённый аккаунт:** мутации — `liveUserIds` → 404 (тест); GET без проверки — D3; стирание уносит ручные
  документы (тест); гонка «живость ↔ стирание» — принята, комментарий в репозитории. Ок.
- **Порты владельцев / placement:** `ridesOf` → `RidesRepository.pastByIds` (`published`, `startsAt < now`),
  `routeTitles` → `RouteRideRoutes.rideableTitles`, `endsBefore` у `pending`; чужих коллекций `achievements` не читает;
  рёбра `achievements → panel, identity, standings` без циклов. D2 обосновано. Ок.
- **Миграции:** нет, индексы прежние; старые документы без поля совпадают с `{ override: null }`. Ок.
- **Карточка:** ручная — из документа; маршрут на картинке всё равно берётся из каталога (`AchievementCardInputs`
  → `ROUTES_FOR_SHARING.ogFacts`), приватный маршрут не утекает. Ок.
- **Documentation Sync (§10):** ADR-0020 (дополнение), `admin-panel.md`, `profile.md`, `notifications.md`,
  `pokatim-backend.md`/`pokatim-db.md`/`pokatim-security.md`/`pokatim-contracts.md`, `pr.md` — есть;
  `pokatim-web.md` (блок карточки) — относится к UI, PR B.
- **Дизайн-система / состояния / платформы:** UI в PR A нет — неприменимо.
- **Идемпотентность очередей:** новых задач нет; событие outbox — через существующий путь `ACHIEVEMENT_NOTICES`. Ок.

## Findings

### [MEDIUM] Лимит мутаций сотрудника не покрыт тестом, хотя название теста это утверждает
- **file:** apps/api/src/modules/achievements/achievements-panel.int.test.ts
- **location:** строки 205–222, `it('404 — удалённый и неизвестный райдер; 429 — лимит сотрудника', …)`
- **problem:** тело теста проверяет только два 404; ни одного запроса до исчерпания `ACHIEVEMENTS_PANEL_LIMIT` и
  ни одной проверки 429 нет. Других тестов на `achievements-panel:<actor>` в репозитории тоже нет
  (`grep 429|ACHIEVEMENTS_PANEL_LIMIT` — только этот заголовок).
- **why_it_matters:** security checklist §7.5 («Злоупотребления: лимит мутаций 60/ч») и правило честных тестов:
  заголовок создаёт ложное впечатление покрытия; удаление `consumeUserLimit` из `admit` или смена ключа (например, на
  `userId` райдера) не уронит ни одного теста.
- **evidence:** `expect(…grant…).status).toBe(404); expect(…revoke…).status).toBe(404);` — и конец теста; в сервисе
  лимит — `consumeUserLimit(this.rateLimiter, \`achievements-panel:${actorUserId}\`, ACHIEVEMENTS_PANEL_LIMIT, now)`.
- **recommended_fix:** дописать в тест исчерпание лимита (например, `vi.spyOn(RateLimiter.prototype,'consume')`
  с отказом или 60 запросов `clear` с `cleared: false`) и проверить `429 RATE_LIMITED` + что ключ — по сотруднику (у
  второго админа запрос проходит); либо убрать «429» из названия и добавить отдельный тест.

### [LOW] Немедленная сверка после снятия пишет в лог `uid` райдера рядом с логом действия сотрудника
- **file:** apps/api/src/modules/achievements/achievements-panel.service.ts
- **location:** `clear` (строки 348–359) → `AchievementsReconciler.reconcile` → `logSync`
  (`achievements-reconciler.ts:236`)
- **problem:** при непустом плане `reconcile(userId, 'server')` логирует `achievements.sync uid=<rider> … origin=server`
  в том же запросе, сразу перед `achievements.manual action=cleared by=<actor>`. По соседним строкам (тот же
  request-id/время) лог связывает сотрудника с райдером, что §7.5 для логов панели исключает.
- **why_it_matters:** низкий риск (лог `achievements.sync uid=` — существующая практика сверки, связь сотрудник ↔
  райдер есть в журнале), но формально противоречит «логи — без `userId` райдера» для действия панели.
- **evidence:** `this.logger.log(\`achievements.sync uid=${userId} first=… origin=${origin} noticed=…\`)`.
- **recommended_fix:** по желанию — принять явно (строка в §7.5 / `pokatim-security.md`: «немедленная сверка пишет
  стандартный лог сверки с `uid`»), либо не логировать request-контекст; код менять не обязательно.

## Вердикт

APPROVE — CRITICAL/HIGH нет. MEDIUM-1 (тест лимита) рекомендуется закрыть до merge; LOW-1 — по желанию.
