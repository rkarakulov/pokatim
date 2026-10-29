# Findings — route-rides-02-app — pass 1 — reviewer: claude
base: origin/develop   commits: a82cf81..2d154c6 (11 коммитов; рабочее дерево чистое)
verdict: APPROVE

Проверено самостоятельно: таргетные jest (`route-ride*`, `route-rides-block`, `features/route-rides`,
`activity-pick-row`, `race-pick`, `route-detail`, `my-routes`, `app-routes-manifest.server`) — 11 suites, 158 passed;
`pnpm --filter @pokatim/app typecheck` — без ошибок; eslint и prettier по всем изменённым `.ts/.tsx` — чисто.
Сверено с API (`apps/api/src/modules/route-rides/route-rides.service.ts`): повторная проверка `failed` перепоставляет
тот же заезд (`requeued`, тот же `_id`), так что `setQueryData(detail(routeId, ride.id))` в «Проверить снова» попадает в
ключ открытого экрана — RC-2 корректен. Список заездов без пагинации (`items.max(100)`), «Показать все (N)» честен.

Измерения без находок: серверный авторитет (вердикт, лучший, дельты — только из ответа; `formatDeltaSec` лишь
форматирует знак сервера); contracts-first (контракты и api-client не тронуты); границы модулей (односторонняя
зависимость `routes → route-rides`, `arch` не нарушен); безопасность (свои данные под `withAccessToken`, экраны в
`Stack.Protected`, без SSR-данных и OG, ничего в логах; `?mine=1` — только выбор эндпоинта геометрии, права — сервер);
миграции/очереди/аудит — не затронуты; RC-1 (опрос `getTrackUpload`, ровно один POST, один повтор на `NOT_READY`,
таймер 60 с, cleanup при уходе) — реализован и покрыт тестами; RC-3 — адрес выбора перенесён на `/routes/pick/<id>`,
сторож манифеста SSR есть; RC-5/RC-6 — опрос детали 3 с → 15 с, в фоне нет (`focusManager` web/native), инвалидация
списка на финале; кэш — `cancelQueries` + `setQueryData` + инвалидация списка и кандидатов; SSR/гидрация — блок
только при `signedIn` (сессия на сервере и на первом клиентском рендере `unknown`), даты — `useMinskClockAfterMount`;
дизайн-система — только `useTheme`/`textStyle`/`space`/`size`/`stroke`/`motion`, без hex и px-литералов;
§4.12 — скелетоны по раскладке, ошибки с повтором, stale-баннер, пусто, кнопки с `loading`/`busy`; i18n — все
строки из `routes.rides.*` и переиспользуемых ключей; Documentation Sync — `docs/product/routes.md`,
`.claude/rules/pokatim-app.md` обновлены, адрес выбора в документах актуальный (`/routes/pick`), `pr.md` — на FINISH
(§8.2); рефактор `race-pick` → `ActivityPickRow` сохраняет поведение (disabled/busy/цвет заголовка/подпись).

### [MEDIUM] Опрос списка «Мои заезды» без предела и без учёта фокуса экрана
- **file:** apps/app/src/features/route-rides/queries.ts
- **location:** 61–64 (`useRouteRides.refetchInterval`)
- **problem:** список опрашивается раз в 3 с всё время, пока в нём есть строка `queued|checking`, без замедления, которое
  RC-6 ввёл для детали. На native карточка маршрута остаётся смонтированной под экраном результата в стеке, поэтому
  при открытом результате идут два опроса раз в 3 с (список + деталь), а зависший `queued` (до 2 ч, `stuckQueuedMs`)
  держит опрос списка всё время открытой карточки.
- **why_it_matters:** та же лишняя нагрузка/батарея, которую RC-6 признал вредной для детали; `refetchIntervalInBackground`
  отключает только фон приложения, не скрытый экран стека.
- **evidence:** `refetchInterval: (query) => query.state.data?.items.some((row) => isPendingCheck(row.status)) ?
  ROUTE_RIDE_POLL_MS : false`; экран результата при этом сам инвалидирует список на финальном статусе (`useRouteRide`,
  строки 107–120), так что опрос списка под ним избыточен.
- **recommended_fix:** применить к списку ту же схему RC-6 (3 с первые 2 мин, затем 15 с) и/или отключать опрос, когда
  экран карточки не в фокусе (`useIsFocused`/`subscribed` у `useQuery`), — инвалидация из экрана результата уже
  обновит список при возврате.

### [LOW] Экран выбора: 404 кандидатов (маршрут стал невидим) — общий «Не удалось загрузить» с бесполезным повтором
- **file:** apps/app/src/features/route-rides/route-ride-pick.tsx
- **location:** 138–178 (`AsyncContent query={candidates}`), queries.ts 70–75
- **problem:** для валидного, но невидимого/удалённого маршрута (прямая ссылка, старая вкладка) `listRouteRideCandidates`
  отвечает 404, экран показывает ошибку с «Повторить», который всегда снова даёт 404; невалидный id при этом получает
  «Маршрут недоступен».
- **why_it_matters:** несогласованное состояние «не найдено» между невалидным и удалённым маршрутом; на экране
  результата 404 обработан явно.
- **evidence:** `routeRideCandidatesOptions` не маппит `NOT_FOUND`; ветка `valid ? … : <EmptyState routes.detail.notFound>`
  проверяет только формат id.
- **recommended_fix:** `apiErrorOf(candidates.error)?.code === 'NOT_FOUND'` → тот же `EmptyState routes.detail.notFound`
  + тест.

### [LOW] Причина «Не пройден» дважды на экране результата
- **file:** apps/app/src/features/route-rides/route-ride-map.tsx
- **location:** 49, 79–83 (строки `routeRideTrackLines`); route-ride-detail.tsx 126–133
- **problem:** `RideVerdict` выводит причину под пилюлей, и `routeRideTrackLines` для `not_passed` снова добавляет ту же
  причину под картой (и в подпись a11y карты). Скринридер прочитает её дважды подряд по экрану.
- **why_it_matters:** шум для a11y; формально следует RC-9 (текстовая альтернатива карты), поэтому LOW.
- **evidence:** `if (detail.status === 'not_passed') { const reason = routeRideReasonText(detail.reason); if (reason)
  lines.push(reason); …}` при уже показанном `{reason ? <Text …>{reason}</Text> : null}` в `RideVerdict`.
- **recommended_fix:** оставить причину в подписи a11y карты, но не рендерить её второй `Text` под картой (или наоборот
  убрать из вердикта) — на усмотрение автора/дизайна.

### [LOW] Сторож манифеста импортирует внутренний модуль транзитивной зависимости
- **file:** apps/app/src/app-routes-manifest.server.test.ts
- **location:** 5
- **problem:** `@expo/router-server/build/routes-manifest` не объявлен в `apps/app/package.json`; импорт работает только
  благодаря `nodeLinker: hoisted`, путь `build/…` — внутренний.
- **why_it_matters:** при смене линкера или раскладки пакета Expo сторож RC-3 упадёт на импорте, а не на порядке маршрутов.
- **evidence:** `grep router-server apps/app/package.json` — пусто; `pnpm-workspace.yaml`: `nodeLinker: hoisted`.
- **recommended_fix:** объявить `@expo/router-server` в devDependencies (версия как у `expo-router`) и оставить комментарий
  про внутренний путь.

### [LOW] Пробелы в тестах относительно §11 TESTS
- **file:** apps/app/src/__tests__/route-ride-pick.test.tsx, route-rides-block.test.tsx, route-ride.test.tsx
- **location:** —
- **problem:** нет кейсов: строки выбора `busy` (disabled) во время POST по кандидату (явно в §11); баннер «устарело»
  блока при ошибке обновления с данными; pull-to-refresh экрана результата (деталь + трек).
- **why_it_matters:** состояния §4.12 «мутации — состояние кнопки» и «ошибка обновления при данных» не защищены от
  регрессии.
- **evidence:** список `it(...)` в файлах; кейса с `toBeBusy()`/`toBeDisabled()` для строк кандидатов и `state.staleTitle`
  в блоке нет.
- **recommended_fix:** добавить три кейса (POST на `never()` → строки `toBeDisabled`; второй ответ списка с ошибкой →
  баннер + строки на месте; `pullToRefresh('route-ride')` → повторный `getRouteRide`).

## NOT VERIFIED
- e2e web в режиме CI (`E2E_API=1`) и без API — не запускался ревьюером (нужна сборка `build:web` и стек API).
- AC6/AC7: 7 тем, 375 px, native-карта на устройстве, проверка на dev — не проверялись (автор тоже отмечает NOT VERIFIED).
- Полный `TURBO_CONCURRENCY=1 pnpm check` ревьюером не запускался (только таргетные jest, typecheck app, eslint/prettier
  изменённых файлов).
