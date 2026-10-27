# Findings — routes-02-my-routes — pass 1 — reviewer: claude

## Pass 1 — Claude

base: origin/develop (merge-base 53c85f1)   commits: 98d2d49..39754fc (8 commits, рабочее дерево чистое)
verdict: APPROVE

Проверено (evidence):
- Прогнаны тесты: `packages/tracks` (kml, format, analyze-route, gpx) — 64/64; `packages/contracts` routes — 22/22;
  app jest (`my-routes.test.tsx`, `route-list-card.test.tsx`, `features/routes`) — 50/50; API int на изолированной БД
  (`pokatim_routes02_review_test`, Redis db 14): `modules/routes/*`, `races-corridor.int`, `migrations.int`,
  `parse-thread.test` — 94/94 (7 файлов).
- Враждебный KML через `analyzeRoute` (node, без потока): 5 МиБ `<a/>` — `no_track`, 0,7 с; 300 000 уровней вложенности —
  `unreadable`; 5 МиБ мусорных кортежей — `no_track`, 0,4 с; порядок `LineString` → `gx:Track` сохраняется; CDATA в
  `coordinates` разбирается. Лимит потока (160 МБ old gen, 30 с) покрывает остальное.
- Изоляция RC-2 сверена по всем вызывающим `RoutesRepository`: `findReady`/`routesByIds`/`findPublished`/`listCatalog`/
  `catalogCities` (через `IN_CATALOG`)/`listVisible`/`setCatalog`/`clearCatalog` — с `origin: 'platform'`; `visible()` —
  `origin === 'platform'`; `races`/`results` читают маршруты только через порты `RouteCatalog`/`RouteGeometry`
  (`races.service.ts:237`, `races-public.service.ts:96,153`, `attempt-check.processor.ts:142`,
  `attempt-intake.ts:107`) — прямых чтений коллекции `routes` вне модуля нет. LRU-кэш заполняется только через
  `findReady` (platform).
- Гонка удаления с worker: `claim` → `null` / исходника и маршрута нет → `skipped`; `markReady` в транзакции с фильтром
  `status: 'processing'` против `deleteOwn` в транзакции — write conflict по документу `routes`, сирот нет.
- Лимиты до тела: `admit` (райдер 20/ч, IP 60/ч, семафор 4) вызывается до `readLimited`; парсер
  `application/octet-stream` в `http-app.ts` отдаёт поток без чтения; другой тип — 415; > 5 МиБ — 413 + `Connection:
  close`.
- Миграция 0021: новый уникальный ключ — надмножество старого (дублей быть не может), создаётся до удаления старого;
  идемпотентна; не при старте. HG-1 подтверждён человеком.
- Логи: `route <id> (<origin>) queued by <uid>`, `deleted by`, `failed: <code>` — без названий и координат; Fastify
  logger выключен, Caddy без access-логов — `?title=` в логи не попадает.
- i18n: в новых файлах приложения жёстких строк нет; дизайн-система — `SegmentedControl`, `Pill`, `TextField`,
  `AsyncContent`, токены.

### [MEDIUM] Откат API после появления маршрутов райдера раскрывает их панели и коридорам — в pr.md не отражено
- **file:** docs/tasks/2026-10-27-routes-02-my-routes/pr.md
- **location:** раздел «Важно», пункт «Откат кода»
- **problem:** pr.md описывает риск отката только как невозможность пересоздать `routes_owner_sha_unique`. Но старый
  код (до этой ветки) не знает про `origin: 'rider'`: `listVisible` с веткой `{ ownerUserId: viewerUserId }` без
  `origin`, `visible()` = `status === 'ready' || свой`, `findReady` без `origin`. После отката готовые маршруты райдеров
  видны всем с `races.read` в `GET /v1/admin/routes/:id`, публикуются в каталог и выбираются коридором гонки.
- **why_it_matters:** M3 / `pokatim-security.md` «Маршруты райдера» — приватные данные автора. Откат — штатная
  операция деплоя, и в описании PR сейчас нет предупреждения, что после него приватность перестаёт соблюдаться.
- **evidence:** `git show 53c85f1:apps/api/src/modules/routes/routes.repository.ts` — `{ ownerUserId: viewerUserId }`
  без `origin`; `git show 53c85f1:apps/api/src/modules/routes/routes.service.ts` — `visible()` без `origin`; таблица
  §12 task.md («На старом коде»: список содержал 4 маршрута вместо 1, коридор 201 вместо 400).
- **recommended_fix:** в pr.md «Важно» добавить: откат API после первой загрузки в «Моих» раскрывает маршруты
  райдеров панели, каталогу и коридорам; перед откатом нужно скрыть или удалить `routes { origin: 'rider' }` (или
  откатываться только вперёд). Код менять не нужно.

### [MEDIUM] После удаления `router.replace('/routes?view=mine')` из экрана поверх вкладок — вероятный второй экземпляр (tabs) в стеке
- **file:** apps/app/src/features/routes/my-route-detail.tsx
- **location:** `DeleteAction`, строка 120
- **problem:** карточку `routes/mine/[id]` открывают через `router.push` из ленты (корневой Stack: `[(tabs),
  routes/mine/[id]]`). `replace` на маршрут, который уже лежит в стеке ниже, по семантике `StackActions.replace`
  React Navigation заменяет текущий экран **новым** экземпляром `(tabs)` (новый key), а не возвращается к
  существующему. Получается `[(tabs), (tabs)']`: «Назад» на Android / жест iOS со вкладки «Маршруты» ведёт ко второй
  копии вкладок, а на web в истории остаётся лишняя запись. В проекте для этого случая есть образец `dismissTo`
  (`features/races/disputes/dispute-screen.tsx:44`: «она уже в стеке — снять экраны над ней, нет (ссылка) —
  заменить»).
- **why_it_matters:** AGENTS.md §4.13 — одинаковое поведение на iOS, Android и web; навигация после удаления —
  основной путь AC3. Тест `my-routes.test.tsx:342` открывает карточку сразу по `initialUrl` (в стеке только она) и
  проверяет только `pathname` и `view`, поэтому случай `push` из ленты не покрыт.
- **evidence:** `router.replace(MY_ROUTES_HREF)` в `my-route-detail.tsx:120`; образец `router.dismissTo(racePath(...))`
  в `dispute-screen.tsx:44`. NOT VERIFIED на устройстве/симуляторе: вывод сделан из семантики REPLACE в React
  Navigation, в проекте нет теста, который смотрит состояние стека.
- **recommended_fix:** `router.dismissTo(MY_ROUTES_HREF)` (или `canGoBack() ? back() : replace(...)`, как в
  `detail-header.tsx`). Тест: открыть ленту → нажать карточку → удалить → `router` в состоянии с одним `(tabs)`
  (`screen.getRouterState()` из `expo-router/testing-library`).

### [LOW] Переключение «Каталог / Мои» во время отправки молча отменяет загрузку
- **file:** apps/app/src/features/routes/use-my-route-upload.ts
- **location:** строка 36 (`useEffect(() => () => active.current?.abort(), [])`); `app/(tabs)/routes.tsx` — условный
  рендер `MyRouteFeed`
- **problem:** при выборе «Каталог» `MyRouteFeed` размонтируется, хук прерывает XHR, и состояние загрузки пропадает без
  сообщения. Если вернуться в «Мои», маршрута нет, прогресса нет.
- **why_it_matters:** 5 МиБ на мобильной сети: отправка идёт долго, а при переключении пользователь теряет её молча
  (§4.12: состояние мутации должно быть видно).
- **evidence:** `(tabs)/routes.tsx`: `view === 'mine' ? <MyRouteFeed …/> : <RouteFeed …/>`; хук живёт в `MyRouteFeed`.
- **recommended_fix:** поднять `useMyRouteUpload` в `RoutesScreen` (или держать обе ленты смонтированными), либо пока
  идёт отправка, блокировать переключатель или спрашивать подтверждение.

### [LOW] `useMyRoute` сбрасывает кэш списка при каждом открытии готовой или отказанной карточки
- **file:** apps/app/src/features/routes/my-routes-queries.ts
- **location:** строки 74–79
- **problem:** эффект срабатывает на любом статусе, кроме `processing`, включая первую загрузку карточки. Поэтому каждое
  открытие готового маршрута инвалидирует `['routes','mine','list','pages']`, и при возврате лента перезапрашивает все
  загруженные страницы. По §11 задумано иное: обновлять список, когда маршрут «стал готовым».
- **why_it_matters:** лишние запросы (до 5 страниц × 20); на корректность не влияет.
- **evidence:** `if (status !== undefined && status !== 'processing') void queryClient.invalidateQueries(...)`.
- **recommended_fix:** инвалидировать только при переходе `processing → *` (хранить предыдущий статус в `useRef`).

### [LOW] Глобальный семафор приёмов (4 на процесс) можно занять медленной отправкой с одного аккаунта
- **file:** apps/api/src/modules/routes/my-routes.service.ts
- **location:** `admit`, строки 111–132
- **problem:** у семафора нет предела на одного райдера. Один пользователь может открыть 4 загрузки и медленно слать
  тело (до `requestTimeout` Node). Тогда все остальные райдеры получают 429, пока эти соединения не закроются.
- **why_it_matters:** дешёвый DoS загрузки маршрутов. Шаблон взят из `tracks` (`TrackUploadsService.admit`) и для
  v1 принят, но здесь он появляется второй раз.
- **evidence:** `if (this.inFlight >= ROUTE_POLICY.riderMaxConcurrentUploads) throw … 429` без учёта `userId`.
- **recommended_fix:** follow-up вместе с `tracks`: не больше 1 одновременного приёма на `userId` и таймаут чтения
  тела в `readLimited`. В этом PR — по желанию.

Нет находок: correctness приёма/дедупа/квоты; изоляция RC-2 (панель, каталог, публичные `/v1/routes*`, коридор,
results, кэш); безопасность KML (DOCTYPE/ENTITY, лимиты до дерева, обход без рекурсии, поток); миграция 0021
(expand → drop с HG-1); идемпотентность worker'а (удалён в обработке — `skipped` без ретрая); contracts-first
(`ErrorCode`/`ROUTE_ORIGINS` в конец, `tolerantEnum` в ответах приложения, панель/каталог без изменений); аудит
(журнал панели — только `platform`); i18n; дизайн-система; состояния данных ленты и карточки; платформы
(`pickTrackFile` native/web, `sendFile` XHR, `RouteLineMap`); Documentation Sync (§10 — product, rules
security/app/backend/contracts/db, pr.md; `docs/tasks/README.md` список задач не ведёт).

## Pass 1 — Codex

base: origin/develop   commits: 98d2d49..39754fc
verdict: REQUEST CHANGES

### [HIGH] Ошибка загрузки карты скрывается без сообщения и повтора
- **file:** apps/app/src/features/routes/route-line-map.tsx
- **location:** 35–42
- **problem:** При ошибке запроса геометрии без кешированных данных компонент возвращает `null`. При старте офлайн запрос может остаться на паузе, а компонент — показывать скелетон без сообщения.
- **why_it_matters:** Карточка готового своего маршрута теряет карту при сетевом сбое или ответе 5xx. Пользователь не получает причины и возможности повторить загрузку. Это нарушает AGENTS.md §4.12.
- **evidence:** Условие `geometry.isError && !geometry.data` скрывает блок. `failedMessage` передаётся только в `RouteMap`, до которого выполнение не доходит. Pull-to-refresh карточки обновляет только `route.refetch`, а не запрос карты (`my-route-detail.tsx:202`).
- **recommended_fix:** Обрабатывать состояния запроса геометрии через `AsyncContent` или эквивалентный блок: скелетон при загрузке, сообщение о сети/сервере и повтор через `geometry.refetch`. Добавить тесты ошибки и восстановления карты своего маршрута.

### [MEDIUM] Карточка продолжает показывать маршрут после подтверждённого удаления
- **file:** apps/app/src/features/routes/my-route-detail.tsx
- **location:** 204–205
- **problem:** Ответ `NOT_FOUND` переводит экран в «Маршрут недоступен» только при отсутствии ранее загруженных данных.
- **why_it_matters:** Если удалить маршрут на другом устройстве или в другой вкладке, обновление открытой карточки получит 404, но сохранит название, цифры, кешированную карту и действия удалённого маршрута. Это расходится с AC3 и RC-11.
- **evidence:** Условие `route.data === undefined && … === 'NOT_FOUND'` исключает обработку 404 при наличии кеша. Проверка установленного `QueryClient` подтвердила: после неуспешного обновления прежние `data` сохраняются вместе с ошибкой.
- **recommended_fix:** Обрабатывать `NOT_FOUND` независимо от наличия кешированных данных, скрывать карточку и удалять кеш её геометрии. Добавить сценарий: успешное чтение → удаление извне → обновление с 404 → «Маршрут недоступен».

## Проверки

- Проверены diff, связанные вызовы, правила, фильтры приватности, транзакция удаления, обработчик очереди, контракты и платформенные реализации.
- `git diff --check origin/develop...HEAD` — без ошибок.
- `pnpm check`, интеграционные тесты и e2e — **NOT VERIFIED**: повторно не запускались в среде с файловой системой только для чтения. Заявленный результат автора независимо не подтверждён.