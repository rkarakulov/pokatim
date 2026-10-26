# Review pass 1

# Findings — 2026-10-27-app-05b-rides-moderation — pass 1 — reviewer: claude (independent-reviewer)
base: origin/develop   commits: 6e3509a..4d68f21 (git diff origin/develop...HEAD; рабочее дерево чистое)
verdict: APPROVE

## Проверено (по измерениям контракта)

- **Корректность / видимость `hidden`:** `findPublic` фильтрует `status ∈ {published, cancelled}`; лента и `cities`
  (`visible()`) — только `published` / `cancelled + участник`; `me` — `visibleTo` → 404 чужому и участнику, организатору
  `phase: 'hidden'` и всё `false`; `join` (обе ветки, включая квоту) и `leave` — `assertVisible` до идемпотентных веток;
  `update`/`cancel` — фильтр `status: 'published'` + `ownRide`. `PUBLIC_PROJECTION` исключает поля модерации; `rideDetailOf`
  собирает ответ явным списком, поэтому `openReportCount`/`hiddenAt` не уходят даже организатору. Карточка модерации — без
  `reporterUserId`/`organizerUserId`/e-mail.
- **Транзакции и гонки:** жалоба — `recordReport` (условная запись райда) первой, затем `insertOne`; модерация — чтение,
  затем условная запись райда (`version` + статус в фильтре), `closeOpen`, `PanelAudit.append` в той же сессии. Конкурентные
  жалоба/«Скрыть» конфликтуют по документу райда (WriteConflict → повтор `withTransaction`); `$max lastReportAt`.
  Конкурентная повторная жалоба того же пользователя тоже упорядочивается по райду, вторая получает E11000 → откат →
  идемпотентный успех (`MongoTransactions.run` = `session.withTransaction`, ошибка не transient — пробрасывается).
  Порядок проверок D4 соблюдён; «Отклонить» без `lastReportAt` у райда → `RIDE_INVALID_STATE` (отклонение 8.2 записано).
- **Права / безопасность:** `PanelGuard` + `@RequirePermission('rides.moderate')` на классе; moderator получил право,
  organizer — нет; запросы — `strictObject`, id — `Uuid`, причина — `ActionReason`; значения фильтров — примитивы после zod
  (операторной инъекции нет). Лог жалобы без комментария. `lockUser` не нужен (не документы аккаунта, R1).
- **Миграция:** `0017_ride_reports` expand-only, идемпотентна (`createIndex` с теми же опциями, бэкфилл по `$exists: false`),
  запросы очереди содержат условия частичных индексов.
- **Контракты:** всё в конец справочников; `RideViewer.reported/canReport` с `default(false)`; `phase` ответа приложения —
  `tolerantEnum` (старый клиент получит `unknown`); новых кодов ошибок нет.
- **Append-only:** `ride_reports` — только `insertOne` и `updateMany` по `resolvedAt: null` (сторож есть), правило в
  `pokatim-db.md`; журнал — `PanelAudit.append` в транзакции (тест отката есть).
- **UI / i18n / состояния:** приложение — кнопка по `canReport`, строка по `reported`, баннер скрытого, экран жалобы со
  скелетоном, 404, ошибками и состоянием кнопки; панель — скелетон, ошибка с повтором, пусто, `ReasonDialog`, 409 →
  `ConflictBanner`. Строки — `@pokatim/i18n`, без hex/px. Развилок платформ нет; шаг смоука web добавлен.
- **Documentation Sync (§10):** `rides.md`, ADR-0013, `deploy.md`, `admin-panel.md`, `pokatim-{db,security,app,web}.md` —
  обновлены.
- **Прогнано ревьюером:** `pnpm --filter @pokatim/{api,admin,app} typecheck` — pass; vitest api
  (`rides.policy`, `ride-reports.repository`, `permissions`, `admin-routes`) — 31 pass; vitest admin (`rides-moderation`,
  `audit`) — 18 pass; jest app (`ride-report`, `ride-detail`) — 30 pass.
  **NOT VERIFIED:** int-тесты API (`*.int.test.ts`, миграции, гонка) — Docker/MongoDB недоступны в окружении ревьюера;
  опираюсь на чтение кода тестов и отчёт coder (§12). `pnpm e2e:web` / `e2e:admin` — не запускались.

## Findings

### [LOW] Жалоба отвечает `reported: true`, хотя запись не создана (условие `recordReport` не выполнилось, а свежее чтение снова «можно»)
- **file:** apps/api/src/modules/rides/ride-reports.service.ts
- **location:** `report()`, ветка после `transactions.run` (`if (!recorded) this.assertReportable(fresh, userId); … return rideViewOf(fresh ?? doc, userId, now, true)`)
- **problem:** если `recordReport` вернул `null` (райд скрыли), а к моменту свежего чтения его уже вернули («Скрыть» → «Вернуть»
  между чтением и транзакцией), `assertReportable(fresh)` проходит, и ответ — 200 с `viewer.reported = true` без записи в
  `ride_reports` и без инкремента счётчика.
- **why_it_matters:** клиент кладёт ответ в кеш `me` и показывает «Вы пожаловались»; до следующего refetch `me` кнопки нет,
  а жалоба фактически потеряна. Окно крайне узкое (две операции модератора внутри одного запроса), поэтому LOW.
- **evidence:** `recorded = await this.transactions.run(async (tx) => { if (!(await this.rides.recordReport(...))) return false; … })`;
  при `!recorded` и успешном `assertReportable` код идёт к `return rideViewOf(fresh ?? doc, userId, now, true)`.
- **recommended_fix:** при `!recorded` после `assertReportable(fresh)` отдавать `reported` по факту
  (`await this.reports.exists(id, userId)`) или повторить попытку один раз; либо бросать 409 `CONFLICT`.

### [LOW] Лог `rides.reported` пишется и на идемпотентном дубле (E11000)
- **file:** apps/api/src/modules/rides/ride-reports.service.ts
- **location:** `catch` с `isDuplicateKey` → `recorded = true` → `this.logger.log('rides.reported …')`
- **problem:** параллельный дубль того же пользователя логируется как новая жалоба (в БД — одна).
- **why_it_matters:** счёт жалоб по логам/метрикам завышен; не влияет на данные.
- **recommended_fix:** отдельный флаг `duplicate` — без лога (или лог `rides.report_duplicate`).

### [LOW] Нет int-теста конкурентного дубля жалобы (ветка `isDuplicateKey`)
- **file:** apps/api/src/modules/rides/ride-reports.int.test.ts
- **location:** тест «повтор — 200 без второй записи» (≈ стр. 73)
- **problem:** повтор проверяется только последовательно — его ловит предварительная `reports.exists`; ветка
  `catch (isDuplicateKey(error, RIDE_REPORTS_UNIQUE_INDEX))` внутри транзакции (два параллельных запроса одного пользователя)
  не исполняется ни одним тестом. Опечатка в имени индекса или изменение формата `errmsg` превратили бы её в 500.
- **why_it_matters:** AC1 «повтор — 200 без второй записи» для гонки (двойное нажатие на медленной сети) не доказан тестом.
- **recommended_fix:** `Promise.all([report(h,a,id), report(h,a,id)])` (или `holdTransaction` на первой) → оба 200,
  `countDocuments` = 1, `openReportCount` = 1.

### [LOW] Ослаблена проверка индексов `0014_rides` (`toEqual` → `toMatchObject`)
- **file:** apps/api/src/db/migrations/migrations.int.test.ts
- **location:** тест `0014_rides` (≈ стр. 174, 183) и `0017_ride_reports` (`toMatchObject(queues)`)
- **problem:** ни один тест больше не проверяет полный набор индексов `rides` — лишний/забытый индекс на `rides` пройдёт
  незамеченным.
- **why_it_matters:** миграционный тест — единственный сторож состава индексов коллекции.
- **recommended_fix:** в тесте `0017` сравнить `indexesOf(rides)` через `toEqual({ ...expected0014, ...queues })`
  (вынести `expected` 0014 в константу модуля теста).

## Вердикт

APPROVE — CRITICAL/HIGH нет. Утечек скрытого райда через публичную карточку, ленту, города, `me`, `join`/`leave`/правку/
отмену/жалобу и проекции не найдено; права панели, журнал в транзакции действия, миграция и совместимость контрактов —
в соответствии со spec и правилами. Четыре LOW — по желанию.

## Решение оркестратора по pass 1

Вердикт APPROVE, CRITICAL/HIGH нет. LOW 1–4 не правятся в этом PR (процесс: FIX — только CRITICAL/HIGH), вынесены в
follow-ups (§12). Int-тесты API (жалобы, модерация, видимость, гонка, миграции) прогнаны оркестратором после merge
develop: `TURBO_CONCURRENCY=1 pnpm check` на `pokatim_rides05b_test` / Redis db 12 — `Tasks: 13 successful, 13 total`.
