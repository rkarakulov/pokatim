# Findings — routes-01-library — pass 1 — reviewer: claude

## Pass 1 — Claude independent-reviewer

base: origin/develop   commits: origin/develop..bdf9b54 (17 коммитов, рабочее дерево чистое)
verdict: APPROVE

### Проверено (evidence)

- Diff `git diff origin/develop...HEAD` (96 файлов), task.md §2.1–§12, `tools/ai_review/review_contract.md`,
  `AGENTS.md` §4, `.claude/rules/pokatim-*.md`.
- Тесты, запущенные ревьюером:
  - api int (реальный RS `:27117`, своя БД `pokatim_routes01_review_test`, Redis db 13): `routes-public.int.test.ts`,
    `routes-catalog-admin.int.test.ts`, `races-corridor.int.test.ts`, `races-public.int.test.ts`,
    `migrations.int.test.ts` → `Test Files 5 passed, Tests 65 passed`;
  - app jest (route-detail, routes, route-metadata, home, features/routes, features/maps, route-list-card) →
    `11 suites, 71 passed`; admin vitest (features/routes, RaceEditor.corridor) → `24 passed`; contracts → `236 passed`.
  - Полный `pnpm check` ревьюер не запускал (отчёт coder в §12 — exit 0); e2e с API — NOT VERIFIED (нужен стенд).

### Измерения

- **correctness:** курсор каталога `(publishedAt desc, _id desc)` и `$or` диапазонов корзин совпадают с §7; `publish`
  считает `changedFields` сравнением множеств, `publishedAt` при правке прежний, после снятия — новый; повтор и снятие
  неопубликованного — без записи и журнала. Замечаний нет.
- **безопасность:** публичная видимость — одна точка `RoutesRepository.findPublished` (`status: 'ready'` +
  `catalog.publishedAt: {$type:'date'}`) для карточки, карты и (через порт `inCatalog`) гонок маршрута; список и города
  — то же условие. Ответы — явный маппинг `toCatalogCard` / `{line,start,finish,bounds}`; int-тест на ключи и на
  отсутствие `ownerUserId|sha256|status|failure|attempts|matchLine`. В фильтры Mongo попадают только примитивы после
  zod (`queryArray` справочников, курсор — `Uuid` + `z.iso.datetime()`); значения корзин — серверная константа.
  `PublicReadGuard` на обоих контроллерах, `Cache-Control` на каждом методе. Панель — `PanelGuard` + `races.manage`,
  журнал без координат. Логи — id/действие/uid после коммита.
- **placement / границы:** `races` → `routes` только через `modules/routes/index.ts` (порт `RouteCatalog.inCatalog`);
  `routes` о гонках не знает; загрузка GPX вынесена без копии (RC-15); `race-route.schema.ts`, `race-route-map.tsx`
  не тронуты.
- **contracts-first / совместимость:** все публичные эндпоинты новые; новые значения `ErrorCode`/`AUDIT_ACTIONS` — в
  конец; ответы приложения — `tolerantEnum`; `PanelRouteSummary.catalog` обязателен (панель деплоится с API — принято
  в §11).
- **миграции:** `0020_routes_catalog` expand-only, идемпотентна (createIndex + updateMany `$exists:false`), не при
  старте; int-тест на индексы, бэкфилл, повтор.
- **транзакции / аудит:** «чтение (сессия) → `updateOne` того же документа → `PanelAudit.append`», колбэк без логов;
  int-тест отката при сбое журнала. Журнал только вставкой.
- **регрессии карты:** `corridor?: boolean` по умолчанию `true`, существующие пропсы и вызовы не меняются; фильтр слоя
  по `CORRIDOR_LAYER_ID` в native и web; тесты maps-01 зелёные без правок.
- **SSR / гидрация:** `routes/[id]` вне `Stack.Protected`, `loader` + `generateMetadata` (найден / `noindex` /
  недоступен); карта, шеринг, гонки и «сейчас» — только после монтирования, первый клиентский рендер совпадает с SSR.
- **i18n:** все строки через `t()`, свои блоки `routes.*`, `home.routes.*`, `admin.routes.*`; `races.detail.map.*` не
  тронут; локаль одна (`ru`).
- **состояния §4.12:** вкладка — скелетон, пусто с/без фильтров, ошибка с повтором, ошибка догрузки — баннер,
  pull-to-refresh; карточка — скелетон, 404, офлайн; Главная — пусто/ошибка через `HomeSection`. См. MEDIUM-1.
- **платформы:** экраны без `Platform.OS`; карта — `route-map.tsx`/`.web.tsx`; deep link — маршрут Router.
- **Documentation Sync (§10):** `docs/product/routes.md`, `README.md`, `home.md`, эпик, правила
  `pokatim-{security,app,backend,db,contracts,web}.md` — обновлены; `docs/tasks/README.md` индекса не ведёт (DEV-9
  верно); `pr.md` с упоминанием миграции `0020` — фаза finish.

### [MEDIUM] «Показать ещё» гонок маршрута: нет состояния догрузки и ошибки, обрывает pull-to-refresh
- **file:** apps/app/src/features/routes/route-detail.tsx
- **location:** 108–117 (`RouteRaces`, кнопка `routes.detail.racesMore`)
- **problem:** нажатие вызывает `races.fetchNextPage()` без `{ cancelRefetch: false }` и без проверки `isFetching`;
  во время догрузки нет ни скелетона, ни `busy`; при ошибке следующей страницы ничего не показывается (кнопка просто
  остаётся).
- **why_it_matters:** (1) пользователь потянул pull-to-refresh, затем нажал «Показать ещё» — `fetchNextPage` по
  умолчанию отменяет идущий `refetch` бесконечного запроса; ровно этот дефект уже ловили ревью блока 04 и обошли в
  `season-detail.tsx:252–255` и `features/routes/queries.ts:51–56` (`loadMore`). (2) §4.12 и образец ленты/сезона:
  догрузка — скелетон в подвале, ошибка догрузки — баннер с повтором; здесь нажатие на медленной сети выглядит как
  «ничего не произошло», ошибка — немая. RC-12 «тихо при ошибке» сформулирован для блока целиком (первая страница/404),
  не для догрузки при уже показанных гонках.
- **evidence:** `onPress={() => { if (!races.isFetchingNextPage) void races.fetchNextPage(); }}`; ср.
  `season-detail.tsx:214–229` (баннер + `state.retry`, `RaceListCardSkeleton` в подвале).
- **recommended_fix:** `if (races.hasNextPage && !races.isFetching) void races.fetchNextPage({ cancelRefetch: false })`;
  во время `isFetchingNextPage` — `RaceListCardSkeleton` под списком (или скрыть кнопку); при `isFetchNextPageError` —
  `Banner tone="warning"` + `TextAction state.retry`, как в `season-detail.tsx`. Тест в `route-detail.test.tsx`:
  ошибка второй страницы — баннер с повтором.

### [LOW] Экран «Маршруты» панели не показывает сбой/истечение опроса загрузки
- **file:** apps/admin/src/features/routes/RoutesScreen.tsx
- **location:** 42, 184 (`useRouteUpload()` / `RouteUploadDialog`)
- **problem:** `upload.pollFailed` и `upload.pollExpired` хук отдаёт, `CorridorField` их показывает, экран «Маршруты» —
  нет. Список инвалидируется только при `ready`/`failed` (`route-upload.tsx`, эффект `settled`).
- **why_it_matters:** при сплошных ошибках опроса или зависшей обработке строка остаётся «Обрабатывается» без
  подсказки «проверьте позже»/повтора до ручной перезагрузки страницы.
- **evidence:** `CorridorField.tsx:123–135` использует `upload.pollExpired`/`pollFailed`; в `RoutesScreen.tsx` их нет.
- **recommended_fix:** баннер над таблицей при `pollFailed || pollExpired` (те же тексты `admin.races.corridor.*` или
  свои `admin.routes.*`) с «Обновить» (`pages.refetch`).

### [LOW] e2e-фикстура публикует общий маршрут смоука на стенде
- **file:** apps/app/e2e/schedule-fixture.ts
- **location:** `publishCatalogRoute` (+ `withdraw` в `web.spec.ts` `finally`)
- **problem:** публикуется тот же маршрут «Маршрут смоука», что используют гонки смоука; `withdraw` снимает его
  безусловно. Два параллельных прогона смоука на одном стенде (или будущий засев, опубликовавший этот маршрут)
  мешают друг другу: снятие одним прогоном — 404/пустая вкладка у другого.
- **why_it_matters:** флейки e2e на общем стенде; не продакшен-дефект.
- **evidence:** `const id = await panel.readyRoute('Маршрут смоука'); … withdraw: … /unpublish`.
- **recommended_fix:** допустимо оставить (смоук последовательный); при желании — снимать только если фикстура сама
  опубликовала (`catalog === null` до публикации), либо отдельный GPX для каталога.

### Итог pass 1

CRITICAL: 0 · HIGH: 0 · MEDIUM: 1 · LOW: 2 — **APPROVE** (блокеров нет; MEDIUM-1 рекомендуется исправить до merge).


## Pass 1 — Codex

# Findings — routes-01-library — pass 1 — reviewer: codex
base: origin/develop   commits: origin/develop..HEAD
verdict: REQUEST CHANGES

### [HIGH] У блока «Гонки на маршруте» отсутствуют состояния загрузки и ошибки обновления
- **file:** apps/app/src/features/routes/route-detail.tsx
- **location:** RouteRaces, строки 89–117
- **problem:** До получения первой страницы компонент возвращает `null`, поэтому заголовок и скелетон блока отсутствуют. После получения данных ошибки обновления и догрузки никак не отображаются; во время догрузки интерфейс также не показывает состояние загрузки.
- **why_it_matters:** Нарушен AGENTS.md §4.12: каждый блок с асинхронными данными должен показывать скелетон первой загрузки, а при ошибке обновления — сохранять данные и показывать баннер с повтором. Пользователь не различает отсутствие гонок, незавершённую загрузку и сбой получения следующей страницы.
- **evidence:** `const items = races.data?.pages.flatMap(...) ?? []; if (items.length === 0) return null;`. Далее проверяется только `hasNextPage`; `isFetchingNextPage` используется исключительно для подавления повторного вызова. Обработки `isPending`, `isRefetchError` и `isFetchNextPageError` нет. Тесты `route-detail.test.tsx` проверяют успешную догрузку и ошибку без данных, но эти состояния не покрывают.
- **recommended_fix:** При первой загрузке показывать заголовок и скелетоны карточек гонок. При обновлении сохранять карточки и выводить баннер ошибки с повтором; для догрузки добавить скелетон и ошибку в подвале с повтором `fetchNextPage`. Скрывать блок после подтверждённого пустого ответа; согласованное RC-12 поведение ошибки без данных сохранить. Добавить тесты с незавершённым запросом, ошибкой обновления и ошибкой следующей страницы.

NOT VERIFIED: `pnpm check`, e2e и нативные сборки в рамках этого ревью не запускались. Результаты из отчёта автора независимо не подтверждены.