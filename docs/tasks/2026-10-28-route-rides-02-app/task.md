# task.md — route-rides-02: заезд по маршруту — экран приложения

Уровень: task3. Ветка: `feature/route-rides-app` от `origin/develop`. PR 2 из 2 (PR 1 — API и worker,
`docs/tasks/2026-10-28-route-rides-01-api/`, смержен PR #95). Панель не нужна.

## 1. Title

Заезд по маршруту вне гонки в приложении: блок «Мои заезды» на карточке маршрута, выбор своего заезда, результат
проверки со сравнением со своими прошлыми заездами.

## 2. Goal

Вошедший райдер на карточке маршрута (каталог — `/routes/<id>`, свой готовый — `/routes/mine/<id>`) видит свои заезды
по этому маршруту и сводку «Заездов: N · лучший 2:04:37», выбирает свой заезд (импорт или загрузка файла) и получает
экран результата: «Пройден» со временем или «Не пройден» с причиной, разница с лучшим и с предыдущим, свой трек на
карте маршрута с участками схода.

## 3. Scope

Решения автора (PR 1): **R1** экрана в прототипе нет — по аналогии с блоком «Ваше участие · Ваши заезды: N · лучший
2:04:37» гонки (`races/[id]`, прототип `key-race-result`) и экраном выбора `races/pick`; копии — `[ASSUMPTION]`;
**R2** сравнение только со своими; **R3** частичный проезд не засчитывается; **R4** проверка — только явным выбором.

Решения этой задачи (brainstorming, автономный режим; все — `[ASSUMPTION]`, автор может поправить после dev):
- **A1. Раскладка — подход (a):** блок «Мои заезды» на карточке маршрута + отдельные экраны «Выбрать свой заезд» и
  «Заезд по маршруту». Отвергнуты: (b) один экран «Мои заезды» со списком и деталью — лишний переход с карточки и нет
  аналога в приложении; (c) всё в шторке карточки — результат с картой трека не помещается в шторку поверх карты.
- **A2. Блок «Мои заезды»** (только вошедшему, только клиент; гостю и в SSR — ничего, место — скелетон только при
  известной сессии): заголовок-кикер, сводка (`count`, лучший), кнопка «Проверить свой заезд» → выбор; строки —
  новые сверху (статус-пилюля, «Лучший», время у пройденного, дата и источник); показываем 5, «Показать все (N)»
  раскрывает на месте. Нет заездов — строка-подсказка «Проверьте свой заезд — покажем, пройден ли маршрут и за
  сколько». На каталоге — в теле шторки после действий; на «Моём маршруте» — только у `ready`, после строк деталей.
  404 списка (маршрут стал невидим) — блока нет; ошибка — баннер с повтором (§4.12).
- **A3. Выбор** `/routes/rides/pick/<routeId>`: кандидаты сервера (≤ 30); строка — дата, источник, дистанция, время;
  уже проверенный (`rideId`) — подпись «Уже проверен», нажатие открывает его результат. Нажатие на кандидата — POST
  `{ activityId }` → `replace` на результат (201 и 200 одинаково). Пусто — «Подходящих заездов нет» + «Загрузить
  заезд». «Загрузить заезд» доступен и над непустым списком (TextAction). Загрузка — `useTrackFileUpload` → POST
  `{ uploadId }`; `409 ROUTE_RIDE_NOT_READY` — повтор POST каждые 2 с до 60 с с текстом «Обрабатываем файл…», дольше —
  баннер «Файл ещё обрабатывается — откройте выбор позже»; уход с экрана — повторы прекращаются.
- **A4. Результат** `/routes/rides/<routeId>/<rideId>`: шапка — название маршрута (`route.title` ответа);
  - `queued | checking` — «Проверяем заезд…» и опрос детали каждые 3 с, пока статус такой (экран в фокусе);
  - `passed` — крупное время (`elapsedSec`), пилюли «Пройден» и «Лучший» (если `isBest`), дистанция по маршруту;
  - `not_passed` — «Не пройден» и причина (тексты причин гонок `races.attempt.reason.*`), времени нет;
  - `failed` — «Не удалось проверить» + текст кода и «Проверить снова»: ищем среди кандидатов строку с
    `rideId === id` → POST `{ activityId }`; не нашли — подсказка «Загрузите файл заезда ещё раз»;
  - `unknown` (новый статус старым клиентом) — нейтрально «Статус неизвестен», без действий.
  Сравнение (R2, только сервер): у `passed` — «Это ваш лучший заезд» либо «К лучшему: +0:42» (знак как у сервера,
  отрицательная — быстрее); «К предыдущему: −1:05 · 12 окт»; у не-`passed` — строка «Лучший: 2:04:37 · 12 окт», если
  `best` есть. Данные заезда — дата, источник, общая дистанция и время. Карта — линия маршрута (`mine=1` в адресе —
  `getMyRouteMap`, иначе `getCatalogRouteMap`) + свой трек `/track` (сегмент, участки схода пунктиром) по образцу
  `RaceRouteMap`/`my-track-format`; нет модуля карты, env, геометрии или 404 — блок карты схлопывается, текстовая
  альтернатива остаётся. Невалидный id или 404 — «Заезд не найден» + «К маршруту».
- **A5. Признак «свой маршрут»** передаётся в адрес выбора и результата параметром `?mine=1` (карточка «Моего»
  знает вид); нужен только для геометрии карты и ссылки «назад/к маршруту». Без параметра — каталог.
- **A6. Кэш:** ключи `['route-rides', routeId, …]`; после успешного POST — инвалидация списка маршрута и кандидатов,
  деталь кладётся в кэш ответом POST. Опрос детали — `refetchInterval` по статусу.
- Новые экраны — внутри `Stack.Protected` вошедших (как `races/pick/[id]`), без SSR-данных и OG.
- Тексты — `packages/i18n` (`routes.rides.*`), только токены темы (`@pokatim/design-tokens`, `@rkarakulov/ui`), все
  платформы (iOS, Android, web/PWA) из одного кода.

## 4. Out of Scope

- API, контракты, api-client (готовы в PR 1) — без изменений; если чего-то не хватает — отклонение в 8.2, не правка.
- Экраны профиля (`/profile`, `/settings/profile`, `/riders/*`, TopBar Главной) — делает другая сессия, не трогать.
- Удаление отдельного заезда, таблица других райдеров, автопроверка, уведомления, сторис — позже.
- Шторка на «Моём маршруте» (routes-04d RC-16) — follow-up.

## 5. Architecture Context

- ADR-0014 (карты MapLibre, OpenFreeMap), ADR-0016 (темы приложения), AGENTS.md §4.12 (состояния экранов).
- Образцы: `features/races/participation/*` (блок «Ваше участие»), `features/races/race-pick.tsx` (выбор),
  `features/races/race-route-map.tsx` + `my-track-format.ts` (свой трек), `features/routes/route-detail.tsx`
  (шторка каталога), `features/routes/my-route-detail.tsx`.

## 5.1 Placement & Reuse Gate

Architecture Review — route-rides-02-app. **Status: APPROVED** (блокеров нет; решения RC-1…RC-12 — в 8.1, приняты
по умолчанию в автономном режиме).

**Placement.** Только `apps/app` и `packages/i18n`; API, контракты, api-client — без изменений (§4). Новый пакет не
нужен (один потребитель).
- Папка — **`apps/app/src/features/route-rides/`**, не `features/routes/rides/`. Причина: отдельный bounded context
  с API-модулем `route-rides`, контрактами `contracts/src/route-rides/` и своим префиксом кэша `['route-rides', …]`;
  `features/routes/` уже ~45 файлов. Зависимость односторонняя: `routes/route-detail.tsx`, `routes/my-route-detail.tsx`
  → `route-rides/route-rides-block.tsx`; `route-rides/*` → `routes/{route-line-map,queries,my-routes-queries,format,
  detail-row}`. Ни один файл `features/routes/*`, который импортирует `route-rides`, сам не импортируется из
  `route-rides` — цикла (`no-circular` depcruise) нет.
- Маршруты Expo Router: `src/app/routes/rides/pick/[routeId].tsx` и `src/app/routes/rides/[routeId]/[rideId].tsx`.
  Конфликтов нет (проверено по `expo-router` 58, `build/fork/getStateFromPath-forks.js`: при равной длине побеждает
  статический сегмент в первой отличающейся позиции): `/routes/rides/pick/<uuid>` → выбор (`pick` > `:routeId`);
  `/routes/rides/<uuid>/<uuid>` → результат; `/routes/[id]` — один сегмент, `/routes/mine/*`, `/routes/report/*` —
  другие статические сегменты. Образец той же схемы — `races/[id]` + `races/pick/[id]`. Сторож — тест RC-3.
- Регистрация: два `Stack.Screen` внутри первого `Stack.Protected` в `src/app/_layout.tsx` рядом с
  `routes/report/[id]` (гость → «Регистрация»/«Вход»), и в `src/__tests__/app-routes.ts`.

**Reuse (обязательно) / запрещённые дубли.**
- Карта: `RouteLineMap` (`features/routes/route-line-map.tsx`) + `catalogRouteMapOptions(routeId)` /
  `myRouteMapOptions(routeId)` (те же ключи `['routes','map',id]` / `['routes','mine','map',id]` — кэш общий с
  карточкой). Единственная правка — **необязательный пропс `track?: RouteMapTrack`**, проброшенный в `LineMap` →
  `RouteMap` (у `RouteMap` пропс есть с maps-02). Вызовы каталога и «Моего» не меняются. Свою `RouteMap`-обвязку
  (`useMapStyle` + `useQuery` + 404) не писать. `RouteRideTrack` структурно совместим с `RouteMapTrack`.
- Подпись a11y карты — `myTrackMapLabel` (`features/races/my-track-format.ts`, чистая). `myTrackLines` **не**
  переиспользуется: он типизирован `MyAttempt` и метры схода берёт из `attempt.segment`, которого в `RouteRideDetail`
  нет — своя `routeRideTrackLines` (RC-9).
- Загрузка файла: `useTrackFileUpload({ onUploaded })` + `UploadProgress` (`features/devices`), статус файла —
  `uploadStatus(upload).label`, `isUploadInProgress` (`features/devices/format.ts`).
- Подписи: `formatElapsed` (`@pokatim/i18n`), `formatKm`, `formatMinskDateTime(iso, now)` (`features/devices/format.ts`
  — «14 октября, 09:30»), `minskDateTime(iso, now).date` (`@pokatim/i18n` — дата без времени для строк сравнения),
  `meta` (`src/lib/minsk-format.ts`), `formatCountdown` (`src/lib/countdown.ts` — «0:42», «1:05», «1:02:05» для
  дельт), `routeKm` (`features/routes/format.ts`), `DetailRow` (`features/routes/detail-row.tsx`).
- Ошибки: `apiErrorCode`, `actionErrorMessage`, `retryAfterSec` (`features/auth/error-messages.ts`),
  `isNetworkError`/`apiErrorOf` (`@pokatim/api-client`). Механизм приложения — **свой маппер на домен** (как
  `myRouteErrorMessage`, `raceActionErrorText`): `routeRideErrorMessage` в `features/route-rides/error-messages.ts`
  со `switch` по коду → ключи `routes.rides.error.*`; тексты сервера (`PROJECT_ERROR_MESSAGES`) приложение не
  показывает. Коды `ROUTE_RIDE_*` в `ErrorCode` уже есть (PR 1) — правка контрактов не нужна.
- Компоненты базы: `AsyncContent`, `Kicker`, `Pill`, `Button`, `TextAction`, `Banner`, `EmptyState`, `SkeletonGroup`,
  `SkeletonText`, `SkeletonListRow`, `textStyle`, `useTheme` (`@rkarakulov/ui`); приложения — `DetailHeader`,
  `DocumentTitle`, `OfflineBanner`, `usePullToRefresh`, `useMounted`/`useMinskClock`/`useMinskClockAfterMount`.
- i18n — переиспользуются только доменные тексты с тем же смыслом: `races.attempt.reason.*` (кроме `unknown`, RC-8),
  `races.attempt.best`, `tracks.source.*`, `races.detail.myTrack.{legendTrack,legendOff,whereOff,pending,failed,
  mapLabel}`, `routes.detail.map.{label,failed}`, `routes.mine.detail.map.{label,failed}`, `state.retry`,
  `auth.error.network`. Экранные копии — новые `routes.rides.*` (§11).
- **Малый рефактор (делаем):** строка кандидата `CandidateRow` из `features/races/race-pick.tsx` выносится в
  `src/components/activity-pick-row.tsx` (`ActivityPickRow` — чисто презентационная: заголовок-дата, мета, примечание,
  `disabled`/`busy`, `onPress`, подпись a11y). `race-pick.tsx` собирает пропсы как сейчас (поведение и подписи —
  без изменений, сторож — существующий `race-pick.test.tsx`). Иначе — вторая копия той же разметки.
- **Малая копия (обоснованно):** строка заезда в блоке — свой `RouteRideRowItem`, не `AttemptRow`: `AttemptRow`
  непрессабельный, принимает `MyAttempt` (`origin`, `segment`, статусы гонки) и показывает причину/подсказку сбоя;
  обобщение затронуло бы карточку гонки ради ~25 строк разметки.
- Новых токенов, компонентов базы и вариантов раскладки темы (`layout.*`) не нужно.

## 6. Relevant Files

- `apps/app/src/app/_layout.tsx` (+ экраны в `Stack.Protected`), новые `apps/app/src/app/routes/rides/pick/[routeId].tsx`,
  `apps/app/src/app/routes/rides/[routeId]/[rideId].tsx`.
- `apps/app/src/features/routes/route-detail.tsx`, `my-route-detail.tsx` (+ блок), новая папка
  `apps/app/src/features/route-rides/` (или `features/routes/rides/` — решит architect).
- `packages/i18n/src/ru.ts` (+ `routes.rides.*`).
- `apps/app/e2e/web.spec.ts`.
- API: `packages/api-client/src/index.ts` (`listRouteRides`, `listRouteRideCandidates`, `checkRouteRide`, `getRouteRide`,
  `getRouteRideTrack`), `packages/contracts/src/route-rides/route-ride.schema.ts`.

## 7. Implementation Notes

TDD: чистая логика показа (`route-ride-format.ts`: статус → пилюля/тон, текст причины/сбоя, сводка, дельты со знаком,
строка сравнения) — unit-тесты первыми; компоненты — тесты RN Testing Library (состояния: скелетон, пусто, ошибка,
статусы, опрос, повтор NOT_READY, «Проверить снова»); e2e web — гард входа на новых адресах.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` все копии и раскладка A1–A6.
- Повтор POST на `NOT_READY` расходует лимит 30/ч: 30 повторов за минуту — на грани. Architect: интервал/предел или
  опрос `getTrackUpload` вместо повторов POST.
- Карта на native — требует dev-сборку с MapLibre (уже есть с maps-01); на устройстве агент не проверит.

## 8.1 Requirements Consistency (заполняет architect)

Решения приняты по умолчанию (автономный режим); каждое — `[ASSUMPTION]`, автор может поправить после dev.

- **RC-1 (вредное решение A3: повторы POST на `ROUTE_RIDE_NOT_READY`).** Лимит `route-rides-user:<uid>` 30/ч
  списывается **до** проверки готовности (`RouteRidesService.check`: `limit()` → `route()` → `primaryOf()` →
  `notReady`), поэтому A3 (POST каждые 2 с до 60 с) сжигает до 30 попыток часового лимита одним файлом и потом
  блокирует и «Проверить снова». Альтернативы: (a) реже POST (каждые 10 с, ≤ 6 раз) — всё равно 6 из 30;
  (b) **опрос `GET /v1/tracks/uploads/:id` (`api.getTrackUpload`, без лимитера) каждые 2 с до финального статуса
  (`TRACK_UPLOAD_FINAL_STATUSES`), не дольше 60 с от отправки; затем один POST `{ uploadId }`**; (c) поправить API
  (лимит после проверки готовности) — вне рамок §4. **Решение — (b)**: `ready`/`duplicate` → POST; `failed`/`skipped` →
  без POST, баннер «Файл не принят: <причина>» (`uploadStatus(upload).label`); 60 с без финала — баннер
  «Файл ещё обрабатывается — откройте выбор позже» (заезд позже появится в кандидатах). Если POST всё же ответил
  `NOT_READY` (гонка статусов, `duplicate` без активности) — **один** повтор через 2 с, затем тот же баннер. Итог: ≤ 2
  POST на файл. Ответ загрузки `200` (тот же файл уже есть, статус финальный) — POST сразу. Уход с экрана — опрос и
  таймеры прекращаются (наблюдатель запроса снят, таймер — в cleanup эффекта). A3 в части повторов заменяется этим.
- **RC-2 (недоопределённость «Проверить снова»).** В `RouteRideDetail` нет `activityId`; повтор возможен только через
  кандидатов (365 дней, рамка у маршрута, ≤ 30) — у старого или далёкого заезда строки не будет. Альтернативы:
  (a) как в A4 + подсказка; (b) поле `activityId` в деталь (аддитивно, API) — вне рамок §4; (c) скрыть кнопку.
  **Решение — (a)**: по нажатию `queryClient.fetchQuery(candidatesOptions)` (без запроса до нажатия) → строка с
  `rideId === id` → POST `{ activityId }`; нет строки — «Заезда нет среди доступных — загрузите файл заезда ещё раз».
  Follow-up (в `pr.md`): `activityId` в `RouteRideDetail`.
- **RC-3 (риск маршрутизации).** `routes/rides/pick/[routeId]` и `routes/rides/[routeId]/[rideId]` одной глубины:
  `/routes/rides/pick/<uuid>` формально подходит обоим. Expo Router 58 ранжирует статический сегмент выше
  динамического (см. 5.1), web-сервер — тот же манифест. **Решение:** оставить адреса A3/A4; сторож — jest
  `renderRouter` с `initialUrl: /routes/rides/pick/<uuid>` (экран выбора, не «Заезд не найден») и e2e гард обоих
  адресов. `/routes/rides` без id — `routes/[id]` с невалидным id → «Маршрут недоступен» (как сейчас для любых строк).
- **RC-4 (`?mine=1` — подсказка клиента).** Параметр выбирает только эндпоинт геометрии и ссылку назад; права решает
  сервер (`getMyRouteMap` чужого — 404 → карта схлопывается; детали заезда это не меняет). Серверный авторитет не
  затронут. Подмена параметра пользователем — не уязвимость. Находки нет, фиксируем семантику.
- **RC-5 (недоопределённость: устаревание списка).** Список после проверки показывает `queued`, а детали не знают о
  блоке. **Решение:** список опрашивается раз в 3 с, пока есть строки `queued|checking` (`refetchInterval` по данным,
  как `needsPolling` гонок); экран результата при смене статуса на финальный инвалидирует
  `['route-rides', routeId, 'list']`. После POST — `setQueryData` детали ответом и инвалидация списка и кандидатов.
- **RC-6 (вредный бесконечный опрос).** `queued` может «зависнуть» до 2 ч (`stuckQueuedMs`), опрос раз в 3 с всё
  время открытого экрана — лишняя нагрузка. **Решение:** `refetchInterval` детали: 3 с первые 2 мин от первого
  показа незавершённого статуса, затем 15 с; в фоне не опрашивается (`refetchIntervalInBackground: false`, web —
  `visibilitychange`, native — `focusManager`). Отдельной кнопки нет — pull-to-refresh.
- **RC-7 (формат дельт).** Время заезда — `formatElapsed` («2:04:37»), дельты — `formatCountdown(|Δ|)` со знаком
  («+0:42», «−1:05», U+2212), `0` — «0:00» без знака (ничья с более ранним лучшим: `isBest = false`, `Δ = 0`). Знак —
  как у сервера, клиент разницу не считает.
- **RC-8 (тексты причин).** `races.attempt.reason.*` переиспользуются (A4). `outside_window` для заездов по маршруту
  сервер не выдаёт (PR 1, RC-4), `off_corridor` — тот же движок и пороги. `races.attempt.reason.unknown` = «Не
  засчитано» дублирует пилюлю «Не пройден» — **решение:** `reason === 'unknown' | null` → строки причины нет.
- **RC-9 (текстовая альтернатива трека).** `RouteRideDetail` не несёт метров схода — строки: `marks === 'pending'` или
  статус `queued|checking` → `races.detail.myTrack.pending`; `not_passed` → причина и, при `marks === 'ready'` и
  `offRuns > 0`, `whereOff`; `marks === 'unavailable'` → `routes.rides.track.unavailable`. Трек запрашивается при
  любом статусе (как у гонок), ключ — с `status` и `checkedAt` (новая ревизия — новый запрос и новая карта). 404 трека
  — карта маршрута без трека и без строки; сеть/5xx — «Не удалось загрузить трек» + «Повторить».
- **RC-10 (429).** `retryAfterSec` у часового лимита — до 3600 с; «через 2400 с» нечитаемо. **Решение:** «Слишком
  много проверок за час. Попробуйте через {minutes} мин.», `minutes = max(1, ceil(sec / 60))`, нет деталей — 60 мин.
- **RC-11 (место блока, A2).** Каталог: в `RouteSheetBody` после `RouteActions` и «Пожаловаться», до «Гонок на
  маршруте». «Мой маршрут»: внутри `MyRouteView` только при `status === 'ready'` — после строки «Загружен», до
  «Публикации в каталоге». Запрос списка поднимается в экран (как `viewer`): иначе pull-to-refresh его не обновит.
- **RC-12 (регрессия тестов).** `jest.mock('@/lib/api')` — автомок: у вошедшего на карточке новые методы вернут
  `undefined` → ошибка запроса и лишний баннер. В `route-detail.test.tsx` (вошедший) и `my-routes.test.tsx` — дефолт
  `listRouteRides.mockResolvedValue(emptyPage)` в `beforeEach`.

Противоречий с инвариантами AGENTS.md §4 нет: вердикт, время, «лучший» и дельты — только сервер (§4.1); скелетон/
ошибки/пусто — §4.12; одна кодовая база для iOS/Android/web, без развилок `Platform.OS` (§4.13); токены темы (§4.11).

## 8.2 Deviations from spec

- **RC-3 опровергнут на web-сервере → адрес выбора изменён (решение оркестратора, вариант (a)).** Клиентский роутер
  (`getStateFromPath`) ставит `routes/rides/pick/[routeId]` выше `routes/rides/[routeId]/[rideId]`, но серверный
  манифест SSR (`@expo/router-server` `getServerManifest`: `sortRoutes(b, a)` + `reverse` — маршрут с бо́льшим числом
  динамических сегментов раньше) ставил `[routeId]/[rideId]` первым, а `expo-server` берёт первое совпадение: SSR
  `/routes/rides/pick/<uuid>` отдавал экран результата. Решение: выбор — **`/routes/pick/<routeId>[?mine=1]`**
  (`src/app/routes/pick/[routeId].tsx`, как `routes/report/[id]`), результат — без изменений
  `/routes/rides/<routeId>/<rideId>`. A3, §5.1, §11 (адрес выбора) читать с этой поправкой. Сторож —
  `src/app-routes-manifest.server.test.ts` (jest `server`): манифест той же функцией, что у `expo export`
  (`createRoutesManifest` по файлам `src/app`), первое совпадение для адресов выбора, результата, `routes/[id]`,
  `routes/mine/[id]`, `routes/report/[id]`, `races/pick/[id]`; до переноса — красный.
- RC-2 follow-up (`activityId` в `RouteRideDetail`) — в `pr.md` на шаге FINISH (pr.md этой задачей не создавался).
- Коммиты по шагам §11 слиты: «`RouteLineMap.track` + `RouteRideMap`» и «экраны выбора и результата + `_layout`» —
  один коммит (тест карты открывает экран результата).

## 8.3 Security checklist

Данные только свои (API под `AuthGuard`); экраны в `Stack.Protected`; без SSR и OG; координаты — только своя линия на
карте; в логах/аналитике ничего о треке.

## 9. Acceptance Criteria

1. Вошедший на карточке маршрута каталога и своего готового маршрута видит «Мои заезды»: сводку, строки, «Проверить
   свой заезд»; гость — нет; SSR-HTML карточки без блока.
2. Выбор: кандидаты сервера, проверенный ведёт к результату; нажатие — POST и переход на результат; пусто —
   «Загрузить заезд»; загрузка файла доводит до результата (в т. ч. после `ROUTE_RIDE_NOT_READY`).
3. Результат: все пять статусов + `unknown`; опрос до финального статуса; сравнение по ответу сервера; «Проверить
   снова» у `failed`; 404/невалидный id — «Заезд не найден».
4. Карта с треком и участками схода, текстовая альтернатива; без карты экран цел.
5. Ошибки API — тексты `error-messages` (429 с временем, 409 коды PR 1).
6. Только токены темы, все 7 тем; a11y: роли, подписи, порядок фокуса; 375 px без переносов цифр.
7. `TURBO_CONCURRENCY=1 pnpm check` и `pnpm --filter @pokatim/app e2e:web` зелёные; проверено на dev.

## 10. Documentation Impact

`docs/product/routes.md` (раздел «Заезд по маршруту» — экран), `pr.md`.
Architect: + `.claude/rules/pokatim-app.md` — пункт «Заезд по маршруту (route-rides-02)» в разделе «Маршруты»
(`features/route-rides/`, ключи `['route-rides', routeId, …]`, адреса и `?mine=1`, опрос готовности загрузки вместо
повторов POST — RC-1, `RouteLineMap.track`, `ActivityPickRow`); follow-up `activityId` в `RouteRideDetail` (RC-2) — в `pr.md`.

## 11. Implementation Context (заполняет architect)

**ENTRY POINTS**
- `src/app/routes/rides/pick/[routeId].tsx` — `RouteRidePickRoute`: `useLocalSearchParams<{ routeId: string; mine?:
  string }>()` → `<RouteRidePickScreen routeId={String(routeId)} mine={mine === '1'} />`. Без `loader`,
  `generateMetadata`, OG (комментарий — как у `races/pick/[id].tsx`).
- `src/app/routes/rides/[routeId]/[rideId].tsx` — `RouteRideRoute` → `<RouteRideScreen routeId rideId mine />`.
- `src/app/_layout.tsx` — в первом `Stack.Protected` после `routes/report/[id]`:
  `{/* заезд по маршруту (route-rides-02): выбор и результат — только вошедшим */}`
  `<Stack.Screen name="routes/rides/pick/[routeId]" />`, `<Stack.Screen name="routes/rides/[routeId]/[rideId]" />`.
- Карточки: `RouteRidesBlock` в `features/routes/route-detail.tsx` (`RouteSheetBody`) и
  `features/routes/my-route-detail.tsx` (`MyRouteView`) — место RC-11.

**FILES TO CREATE** (`apps/app/src/…`)
- `features/route-rides/queries.ts` — ключи и хуки (ниже).
- `features/route-rides/route-ride-format.ts` + `route-ride-format.test.ts` — чистые функции (ниже).
- `features/route-rides/error-messages.ts` + `error-messages.test.ts` — `routeRideErrorMessage`.
- `features/route-rides/use-route-ride-upload.ts` — загрузка → опрос готовности → один POST (RC-1).
- `features/route-rides/route-rides-block.tsx` — блок «Мои заезды».
- `features/route-rides/route-ride-pick.tsx` — экран выбора `RouteRidePickScreen`.
- `features/route-rides/route-ride-detail.tsx` — экран результата `RouteRideScreen`.
- `features/route-rides/route-ride-map.tsx` — карта маршрута + свой трек.
- `components/activity-pick-row.tsx` + `components/activity-pick-row.test.tsx` — вынесенная строка кандидата.
- `app/routes/rides/pick/[routeId].tsx`, `app/routes/rides/[routeId]/[rideId].tsx`.
- Тесты: `__tests__/route-rides-fixtures.ts`, `__tests__/route-rides-block.test.tsx`,
  `__tests__/route-ride-pick.test.tsx`, `__tests__/route-ride.test.tsx`, `__tests__/route-ride-map.test.tsx`.

**FILES TO MODIFY**
- `src/app/_layout.tsx`, `src/__tests__/app-routes.ts` (+ 2 маршрута в `appRoutes`).
- `features/routes/route-line-map.tsx` — `RouteLineMapProps.track?: RouteMapTrack` → `LineMap` → `RouteMap track`.
  Ключ `LineMap` не меняется (ревизию трека задаёт `key` родителя `RouteRideMap`).
- `features/routes/route-detail.tsx` — `useRouteRides(id, valid && signedIn && hasRoute)` в `RouteDetailScreen`,
  `list.refetch` в `refetchers` (при `hasRoute && signedIn`), проп `rides` в `RouteSheetBody` (гостю/SSR — `null`).
- `features/routes/my-route-detail.tsx` — `useRouteRides(id, valid && route.data?.status === 'ready')`, `refetch` в
  `refetchers`, блок с `mine` в `MyRouteView` (проп `rides`).
- `features/races/race-pick.tsx` — `CandidateRow` → `ActivityPickRow` (поведение и подписи те же).
- `packages/i18n/src/ru.ts` — ключи ниже (блок `// route-rides-02` после `routes.report.*`).
- `src/__tests__/route-detail.test.tsx`, `my-routes.test.tsx` — дефолт `listRouteRides` (RC-12) + кейсы блока.
- `apps/app/e2e/web.spec.ts`, `apps/app/e2e/project.ts` (ожидаемый 404 при необходимости).
- Документы — §10.

**FILES TO READ** — §5, §6; `features/races/race-pick.tsx`, `features/races/race-route-map.tsx`,
`features/races/participation/race-participation.tsx` (блок: `Kicker`, скелетон, баннер ошибки с повтором),
`features/routes/route-line-map.tsx`, `features/devices/use-track-file-upload.ts`, `features/routes/error-messages.ts`,
`__tests__/race-pick.test.tsx`, `__tests__/race-my-track.test.tsx`, `__tests__/route-detail.test.tsx`.

**TYPES & SCHEMAS** — только из `@pokatim/contracts` (новых нет): `RouteRidePage`, `RouteRideRow`,
`RouteRideCandidates`, `RouteRideCandidate`, `RouteRideDetail`, `RouteRideTrack`, `RouteRideRequest`, `RouteRideStatus`,
`ROUTE_RIDE_MAX_PER_ROUTE`, `TrackUpload`, `TRACK_UPLOAD_FINAL_STATUSES`, `Uuid`.

**Запросы (`features/route-rides/queries.ts`)** — всё через `withAccessToken`, только клиент:
```ts
export const routeRidesKeys = {
  all: (routeId: string) => ['route-rides', routeId] as const,
  list: (routeId: string) => ['route-rides', routeId, 'list'] as const,
  candidates: (routeId: string) => ['route-rides', routeId, 'candidates'] as const,
  detail: (routeId: string, rideId: string) => ['route-rides', routeId, 'ride', rideId] as const,
  // отдельная ветка: инвалидация детали не задевает трек
  track: (routeId: string, rideId: string, status: string, checkedAt: string | null) =>
    ['route-rides', routeId, 'track', rideId, status, checkedAt] as const,
  upload: (routeId: string, uploadId: string) => ['route-rides', routeId, 'upload', uploadId] as const,
};
export const ROUTE_RIDE_POLL_MS = 3000;        // список и деталь, пока queued|checking
export const ROUTE_RIDE_SLOW_POLL_MS = 15_000; // деталь после ROUTE_RIDE_FAST_POLL_FOR_MS (RC-6)
export const ROUTE_RIDE_FAST_POLL_FOR_MS = 120_000;
export const UPLOAD_READY_POLL_MS = 2000;      // RC-1
export const UPLOAD_READY_TIMEOUT_MS = 60_000;

useRouteRides(routeId, enabled): UseQueryResult<RouteRidePage | null>
  // NOT_FOUND → null (блока нет); refetchInterval: (q) => isPendingCheck по items ? ROUTE_RIDE_POLL_MS : false;
  // staleTime DEFAULT_STALE_MS
routeRideCandidatesOptions(routeId) // queryOptions для useQuery и fetchQuery («Проверить снова»), DEFAULT_STALE_MS
useRouteRideCandidates(routeId, enabled)
useRouteRide(routeId, rideId, enabled)
  // NOT_FOUND — ошибка (экран «Заезд не найден»); refetchInterval по статусу и времени (RC-6);
  // эффект: статус стал финальным — invalidate list(routeId)
useRouteRideTrack(routeId, ride: RouteRideDetail | undefined, enabled): UseQueryResult<RouteRideTrack | null>
  // NOT_FOUND → null; staleTime: Infinity; ключ track(routeId, ride.id, ride.status, ride.checkedAt)
useCheckRouteRide(routeId) // useMutation<RouteRideDetail, Error, RouteRideRequest>;
  // onSuccess: cancelQueries+setQueryData(detail(routeId, ride.id), ride); invalidate list и candidates
```

**Чистые функции (`route-ride-format.ts`)** — `t` и форматтеры, без React; тесты первыми (TDD):
```ts
isPendingCheck(status): boolean                                // queued | checking
routeRideStatusPill(status): { label: string; tone: PillTone } // queued neutral «В очереди», checking warning
  // «Проверяем», passed success «Пройден», not_passed error «Не пройден», failed error «Не удалось проверить»,
  // unknown neutral «Статус неизвестен»
routeRideReasonText(reason): string | null                     // races.attempt.reason.<r>; null | 'unknown' → null (RC-8)
routeRideFailureText(failure): string                          // routes.rides.failure.<code>; null/unknown → .unknown
routeRideSourceLabel(source): string                           // tracks.source.*, unknown → upload
routeRidesSummary(summary): string | null                      // count 0 → null; best → «Заездов: N · лучший 2:04:37»,
                                                               // иначе «Заездов: N»
routeRideRowView(row, now: Date | null): { pill; best: boolean; time: string | null; meta: string; a11y: string }
  // best — только passed && isBest; time — только passed && elapsedSec !== null; meta — дата (now ≠ null) · источник
formatDeltaSec(sec: number): string                            // «+0:42», «−1:05» (U+2212), 0 → «0:00» (RC-7)
routeRideComparisonLines(detail, now: Date | null): string[]
  // passed: isBest → «Это ваш лучший заезд», иначе deltaToBestSec !== null → «К лучшему: +0:42»;
  //         previous && deltaToPreviousSec !== null → «К предыдущему: −1:05 · 12 октября»
  // не-passed: best → «Лучший: 2:04:37 · 12 октября»; иначе []
routeRideTrackLines(detail, marks, offRuns: number): string[]  // RC-9
routeRidePickPath(routeId, mine): Href                         // /routes/rides/pick/<id>[?mine=1]
routeRidePath(routeId, rideId, mine): Href                     // /routes/rides/<id>/<rideId>[?mine=1]
routeCardPath(routeId, mine): Href                             // /routes/mine/<id> | /routes/<id>
VISIBLE_ROWS = 5
```
`error-messages.ts`: `routeRideErrorMessage(error: unknown): string` — сеть → `auth.error.network`; `RATE_LIMITED` →
`routes.rides.error.rateLimited` `{ minutes }` (RC-10); `ROUTE_RIDE_NOT_READY` / `ROUTE_RIDE_UPLOAD_FAILED` /
`ROUTE_RIDE_QUOTA_EXCEEDED` (`{ limit: ROUTE_RIDE_MAX_PER_ROUTE }`) / `NOT_FOUND` → `routes.rides.error.<код>`; прочее —
`actionErrorMessage(error)`.

**Хук загрузки (`use-route-ride-upload.ts`, RC-1)**
```ts
type RouteRideUploadPhase =
  | { phase: 'idle' } | { phase: 'uploading'; name: string; progress: number }
  | { phase: 'processing' }            // опрос getTrackUpload
  | { phase: 'checking' }              // POST { uploadId }
  | { phase: 'timeout' }               // 60 с без финала / NOT_READY после повтора
  | { phase: 'failed'; message: string };
useRouteRideUpload(routeId, { onChecked: (ride: RouteRideDetail) => void }):
  { state: RouteRideUploadPhase; choose(): void; cancel(): void; busy: boolean }
```
Внутри: `useTrackFileUpload({ onUploaded })` (прогресс, pre-check, отказ — его `failed`); `uploadId` в state;
`useQuery({ queryKey: routeRidesKeys.upload(routeId, uploadId), queryFn: getTrackUpload, refetchInterval: final ? false
: UPLOAD_READY_POLL_MS, enabled: uploadId !== null && phase === 'processing', initialData: ответ загрузки })`;
эффект на финальный статус → один `useCheckRouteRide().mutate({ uploadId })` (ref-сторож от повтора); `failed`/`skipped`
→ `routes.rides.pick.uploadRejected` с `uploadStatus(upload).label`; таймер 60 с от `sent` → `timeout`. `NOT_READY`
POST → один повтор через 2 с → `timeout`. Прочие ошибки POST → `failed` с `routeRideErrorMessage`. Unmount — cleanup
таймеров; запрос без наблюдателя не опрашивается.

**Компоненты и пропсы**
- `RouteRidesBlock({ routeId, mine, rides, now })` — `rides: UseQueryResult<RouteRidePage | null> | null` (`null` —
  гость/SSR/сессия неизвестна → ничего). `rides.data === undefined`: ошибка → `Banner` (warning, `state.errorTitle`/
  `state.failedTitle` по `isNetworkError`, сообщение `routes.rides.failed`) + `TextAction state.retry`; иначе скелетон
  (`testID="route-rides-skeleton"`: `SkeletonText` 2 строки). `data === null` → ничего (404). Данные: `Kicker
  routes.rides.kicker`; сводка (`textStyle('body')`) или подсказка `routes.rides.emptyHint`; `Button variant="secondary"
  routes.rides.check` → `router.push(routeRidePickPath(routeId, mine))`; строки `RouteRideRowItem` (первые
  `VISIBLE_ROWS`, `TextAction routes.rides.showAll {count}` раскрывает на месте, локальный `useState`). Ошибка обновления
  при данных — `Banner` warning `state.staleTitle`/`state.staleMessage` + повтор (как `RouteRaces`). `testID="route-rides"`.
- `RouteRideRowItem({ row, routeId, mine, now })` — `Pressable accessibilityRole="link"`, подпись `view.a11y`,
  `router.push(routeRidePath(...))`; шапка — `Pill` статуса + `Pill races.attempt.best tone="accent"`; время —
  `textStyle('time')`; мета — `textStyle('meta')`; разделитель `stroke.hairline`, `border.subtle`.
- `ActivityPickRow({ title, details, note?, disabled?, busy?, onPress, accessibilityLabel })` — разметка нынешнего
  `CandidateRow` (цвет заголовка `text.disabled` при `disabled`).
- `RouteRidePickScreen({ routeId, mine })` — `SafeAreaView top` → `DocumentTitle` → `DetailHeader title=
  routes.rides.pick.title fallback=routeCardPath` → `ScrollView` (pull-to-refresh кандидатов): `TextAction
  routes.rides.pick.upload` (над непустым списком; скрыт при `busy`), `UploadProgress` (`uploading`), `Banner`
  `routes.rides.pick.processing` (`processing`/`checking`, `accessibilityLiveRegion="polite"`), `Banner warning
  routes.rides.error.ROUTE_RIDE_NOT_READY` (`timeout`), `Banner error` (`failed`, ошибка POST по строке), `AsyncContent`
  кандидатов: скелетон — 3 `SkeletonListRow`; пусто — `EmptyState routes.rides.pick.empty / emptyHint` с действием
  «Загрузить заезд»; строка — `ActivityPickRow` (title — `formatMinskDateTime`, details — `meta([source, formatKm,
  formatElapsed])`, note — `routes.rides.pick.checked` при `rideId`; нажатие: `rideId` → `router.replace(routeRidePath)`,
  иначе `check.mutate({ activityId }, { onSuccess: (ride) => router.replace(routeRidePath(routeId, ride.id, mine)) })`;
  все строки `busy` на время POST). Невалидный `routeId` — `EmptyState routes.detail.notFound` без запроса.
- `RouteRideScreen({ routeId, rideId, mine })` — `SafeAreaView top` → `DocumentTitle` (название маршрута или
  `routes.rides.result.title`) → `DetailHeader title={data?.route.title} fallback=routeCardPath` → `OfflineBanner` →
  `ScrollView` + `RefreshControl` (деталь и активный трек) → невалидные id или 404 → `EmptyState
  routes.rides.result.notFound` + действие `routes.rides.result.toRoute` (`router.navigate(routeCardPath)`); иначе
  `AsyncContent` (скелетон: `SkeletonHeroCard` + `SkeletonText` 3 строки):
  - шапка: `Kicker routes.rides.result.title`; `queued|checking` — `Pill` + текст `routes.rides.result.checking`
    (`accessibilityLiveRegion="polite"`); `passed` — `elapsedSec` `textStyle('displaySm')` (или `numeral`-стиль из
    `textStyle`, не литерал), `Pill` «Пройден» + «Лучший» при `comparison.isBest`, `DetailRow
    routes.rides.result.routeDistance` (`routeKm(routeDistanceM)`); `not_passed` — `Pill` + причина (RC-8);
    `failed` — `Pill` + `routeRideFailureText` + `Button routes.rides.result.recheck` (RC-2; `loading` на время
    `fetchQuery`+POST; нет кандидата — `Banner routes.rides.result.recheckMissing`; ошибка — `routeRideErrorMessage`;
    успех — `setQueryData`, экран остаётся, опрос продолжается); `unknown` — `Pill` «Статус неизвестен», без действий;
  - сравнение — `routeRideComparisonLines` (каждая строка — `Text body`);
  - «Ваш заезд» (`Kicker routes.rides.result.ride`): `DetailRow` дата (`formatMinskDateTime`), источник,
    дистанция (`formatKm`), время (`formatElapsed(activity.elapsedSec)`);
  - `RouteRideMap`.
- `RouteRideMap({ routeId, ride, mine })` — `useMapStyle()`; трек — `useRouteRideTrack(routeId, ride, styleUrl !==
  null)`; пока трек грузится впервые — скелетон места карты (`MAP_ASPECT_RATIO`, `testID="route-ride-map-skeleton"`;
  карта не монтируется дважды); затем `RouteLineMap key={`${ride.id}|${ride.status}|${ride.checkedAt ?? ''}`}
  mapQuery={mine ? myRouteMapOptions(routeId) : catalogRouteMapOptions(routeId)} track={...}
  accessibilityLabel={lines.length ? myTrackMapLabel(base, lines) : base}` (`base` — `routes.mine.detail.map.label` /
  `routes.detail.map.label` с `routeKm(ride.route.distanceM)`), `lineWidth` — `ROUTE_CATALOG_LINE_WIDTH` для каталога;
  под картой — легенда (`legendTrack` [· `legendOff` при `marks === 'ready' && offRuns.length > 0`]), строки
  `routeRideTrackLines`, ошибка трека без данных — `races.detail.myTrack.failed` + `TextAction state.retry`
  (`testID="route-ride-track-error"`). Нет env/модуля/геометрии/404 — `RouteLineMap` схлопывает себя, строки текста
  остаются.

**SSR / сессия / темы.** Блок — только при `signedIn` (`useSessionStore(isSignedIn)`); при `unknown|unavailable` и
у гостя — `null` (SSR-HTML карточки без блока: сессия на сервере всегда `unknown`). Экраны выбора/результата — под
гардом, SSR отдаёт скелетон оболочки. Даты строк — `now` из `useMinskClockAfterMount` карточки (каталог) /
`useMinskClock` (защищённые экраны). Темы (ADR-0016): только роли `useTheme`/`useTheme<AppTheme>()` (`theme.map.*` —
внутри `RouteLineMap`), `textStyle`, `space`/`size`/`stroke`; вариантов `layout.*` нет, сравнений id темы нет — сторож
`theme-guards.test.ts` проходит без правок. Иконки не нужны.

**i18n (`packages/i18n/src/ru.ts`, новые)**
```
'routes.rides.kicker': 'Мои заезды',
'routes.rides.summary': 'Заездов: {count} · лучший {time}',
'routes.rides.summaryNoBest': 'Заездов: {count}',
'routes.rides.emptyHint': 'Проверьте свой заезд — покажем, пройден ли маршрут и за сколько',
'routes.rides.check': 'Проверить свой заезд',
'routes.rides.showAll': 'Показать все ({count})',
'routes.rides.failed': 'Не удалось загрузить ваши заезды',
'routes.rides.status.queued': 'В очереди',
'routes.rides.status.checking': 'Проверяем',
'routes.rides.status.passed': 'Пройден',
'routes.rides.status.not_passed': 'Не пройден',
'routes.rides.status.failed': 'Не удалось проверить',
'routes.rides.status.unknown': 'Статус неизвестен',
'routes.rides.failure.storage': 'Трек временно недоступен',
'routes.rides.failure.timeout': 'Проверка не уложилась во время',
'routes.rides.failure.unreadable': 'Трек не читается',
'routes.rides.failure.corridor_invalid': 'Линию маршрута не удалось подготовить к проверке',
'routes.rides.failure.error': 'Ошибка проверки',
'routes.rides.failure.unknown': 'Ошибка проверки',
'routes.rides.pick.title': 'Выбрать свой заезд',
'routes.rides.pick.empty': 'Подходящих заездов нет',
'routes.rides.pick.emptyHint': 'Показываем заезды за последний год рядом с маршрутом. Загрузите файл заезда или дождитесь импорта Garmin/Wahoo.',
'routes.rides.pick.upload': 'Загрузить заезд',
'routes.rides.pick.checked': 'Уже проверен',
'routes.rides.pick.processing': 'Обрабатываем файл…',
'routes.rides.pick.uploadRejected': 'Файл не принят: {reason}',
'routes.rides.result.title': 'Заезд по маршруту',
'routes.rides.result.checking': 'Проверяем заезд…',
'routes.rides.result.notFound': 'Заезд не найден',
'routes.rides.result.toRoute': 'К маршруту',
'routes.rides.result.routeDistance': 'Дистанция по маршруту',
'routes.rides.result.isBest': 'Это ваш лучший заезд',
'routes.rides.result.toBest': 'К лучшему: {delta}',
'routes.rides.result.toPrevious': 'К предыдущему: {delta} · {date}',
'routes.rides.result.best': 'Лучший: {time} · {date}',
'routes.rides.result.ride': 'Ваш заезд',
'routes.rides.result.date': 'Дата',
'routes.rides.result.source': 'Источник',
'routes.rides.result.distance': 'Дистанция',
'routes.rides.result.elapsed': 'Время',
'routes.rides.result.recheck': 'Проверить снова',
'routes.rides.result.recheckMissing': 'Заезда нет среди доступных — загрузите файл заезда ещё раз',
'routes.rides.track.unavailable': 'Разметка участков для этого заезда недоступна',
'routes.rides.error.rateLimited': 'Слишком много проверок за час. Попробуйте через {minutes} мин.',
'routes.rides.error.ROUTE_RIDE_NOT_READY': 'Файл ещё обрабатывается — откройте выбор позже',
'routes.rides.error.ROUTE_RIDE_UPLOAD_FAILED': 'Файл заезда не удалось обработать',
'routes.rides.error.ROUTE_RIDE_QUOTA_EXCEEDED': 'По этому маршруту уже {limit} заездов — это предел',
'routes.rides.error.NOT_FOUND': 'Маршрут или заезд недоступен',
```
Переиспользуются (без правок): `races.attempt.reason.*`, `races.attempt.best`, `tracks.source.*`,
`races.detail.myTrack.{legendTrack,legendOff,whereOff,pending,failed,mapLabel}`, `routes.detail.map.{label,failed}`,
`routes.mine.detail.map.{label,failed}`, `routes.detail.notFound`, `state.*`, `auth.error.network`.

**TESTS** (TDD: сначала `route-ride-format.test.ts`, `error-messages.test.ts`; тесты в TZ ≠ Минск, фейковые таймеры)
- Unit — `route-ride-format.test.ts`: пилюля всех 5 статусов + `unknown`; причина (`unknown`/`null` → `null`); сбой
  (5 кодов + `null`/`unknown`); сводка (0 → `null`, с лучшим, без лучшего); строка (время только у `passed`, «Лучший»
  только `passed && isBest`, `now = null` без даты, источник `unknown` → «Файл»); `formatDeltaSec` (+, −, 0, ≥ 1 ч);
  сравнение (лучший сам, к лучшему + к предыдущему, без предыдущего, не-`passed` с `best`/без); строки трека (RC-9);
  пути с/без `mine`. `error-messages.test.ts`: сеть, 429 (`retryAfterSec` 2400 → 40 мин, 30 → 1 мин, без деталей →
  60), три кода 409, 404, прочее → общий текст.
- Component (RNTL, `jest.mock('@/lib/api')`, фикстуры `route-rides-fixtures.ts`):
  - `route-rides-block.test.tsx`: гость и `unknown` сессия — без блока и без запроса; вошедший — скелетон → сводка,
    строки, «Лучший», время; > 5 строк — «Показать все (7)» раскрывает; пусто — подсказка + «Проверить свой заезд»
    (переход на `/routes/rides/pick/<id>`, на «Моём» — с `?mine=1`); 404 — ничего; ошибка — баннер с повтором (повтор
    зовёт API); строка `queued` — опрос 3 с, после `passed` опрос стоп; pull-to-refresh карточки перезапрашивает список.
  - `route-detail.test.tsx` / `my-routes.test.tsx`: блок в шторке каталога после действий; на «Моём» только у `ready`
    (у `processing` — нет запроса); дефолт `listRouteRides` (RC-12).
  - `route-ride-pick.test.tsx`: скелетон → строки (подписи a11y), «Уже проверен» → `replace` на результат без POST;
    кандидат → POST `{ activityId }` → `replace` на результат, деталь в кэше (без повторного GET), инвалидация
    списка; строки `busy` во время POST; 409 квоты / 429 — баннер с текстом; пусто — «Подходящих заездов нет» +
    «Загрузить заезд»; загрузка: ответ `ready` → сразу POST `{ uploadId }`; `processing` → опрос `getTrackUpload`
    раз в 2 с → `ready` → ровно один POST; `failed` → «Файл не принят: …» без POST; 60 с без финала → баннер, POST не
    вызывался; POST `NOT_READY` → один повтор через 2 с → баннер (всего 2 POST); unmount во время опроса — запросов
    больше нет; невалидный `routeId` — без запросов; **RC-3** — `initialUrl: /routes/rides/pick/<uuid>` открывает выбор.
  - `route-ride.test.tsx`: невалидные id и 404 — «Заезд не найден» + «К маршруту» (каталог / `mine`); `queued` →
    «Проверяем заезд…» и опрос 3 с, через 2 мин — 15 с; переход в `passed` — время, «Пройден», «Лучший», «Это ваш
    лучший заезд» / «К лучшему: +0:42», «К предыдущему: −1:05 · …», инвалидация списка; `not_passed` — причина, без
    времени, «Лучший: …»; `failed` — текст сбоя, «Проверить снова»: кандидат найден → POST `{ activityId }`, нет —
    подсказка; `unknown` — «Статус неизвестен» без кнопок; данные заезда; заголовок — `route.title`.
  - `route-ride-map.test.tsx`: каталог → `getCatalogRouteMap`, `mine` → `getMyRouteMap`; трек передан в `RouteMap`
    (мок MapLibre из `jest.setup.ts`), легенда «пунктир» только при `offRuns`; 404 трека — карта без трека и строки;
    ошибка трека — строка + повтор; env не задан — блока карты нет, текст экрана цел; подпись a11y с текстом трека.
  - `activity-pick-row.test.tsx` (disabled/busy/подпись) + `race-pick.test.tsx` без изменений — зелёный (итого по затронутым набором — 87 passed).
  - `route-line-map` (существующие тесты) — без `track` поведение то же.
- e2e web (`apps/app/e2e/web.spec.ts`):
  - без API и с API — гард входа на новых адресах (как `/rides/route-pick`): `/routes/rides/pick/${UNKNOWN_ROUTE_ID}`
    и `/routes/rides/${UNKNOWN_ROUTE_ID}/${UNKNOWN_ROUTE_ID}` — HTML 200 без «Мои заезды»/«Выбрать свой заезд» и без
    `og:title`; после гидрации — `/register` (с API) или «Нет соединения» (без API).
  - «с API», в существующем тесте «Маршруты»: SSR-HTML карточки не содержит «Мои заезды»; гость — блока нет; после
    входа на карточке маршрута прогона — «Мои заезды», подсказка, «Проверить свой заезд» → `/routes/rides/pick/<id>`
    → «Подходящих заездов нет» и «Загрузить заезд» (новый райдер без заездов). Полный поток загрузка → проверка в e2e
    нереалистичен (нужен GPX по линии маршрута и worker) — покрыт jest и проверкой на dev (AC7).
- Проверки: `TURBO_CONCURRENCY=1 pnpm check`, `pnpm --filter @pokatim/app e2e:web` (и `E2E_API=1` по runbook).

**OUT OF SCOPE** — §4; плюс: изменения API/контрактов/api-client (отклонения — 8.2); `activityId` в детали (RC-2,
follow-up); шторка «Моего маршрута»; обобщение `AttemptRow`; правки `myTrackLines`/`race-route-map.tsx`; экраны
профиля, TopBar Главной.

**Объём PR.** ≈ 1,8–2,3 тыс. строк с тестами. Коммиты: i18n + format + error-messages (TDD) → queries + upload-хук →
`ActivityPickRow` (рефактор race-pick) → `RouteLineMap.track` + `RouteRideMap` → экраны выбора и результата +
`_layout` → блок на карточках → e2e → документы.

## 12. Outcome (заполняет coder)

**Статус: реализовано по §11 с поправкой RC-3 (§8.2: выбор — `/routes/pick/<routeId>`); `pnpm check` зелёный.**

Сделано (ветка `feature/route-rides-app`, коммиты 7110677…):
- `packages/i18n` — ключи `routes.rides.*` (§11).
- `features/route-rides/`: `route-ride-format.ts` (пилюли, причины RC-8, сбои, сводка, строки, дельты RC-7, сравнение,
  строки трека RC-9, адреса с `?mine=1`), `error-messages.ts` (`routeRideErrorMessage`, 429 в минутах RC-10),
  `queries.ts` (ключи `['route-rides', routeId, …]`, опрос списка RC-5, опрос детали 3 с → 15 с RC-6, инвалидация
  списка на финале, трек с ревизией, POST → `setQueryData` + инвалидация), `use-route-ride-upload.ts` (RC-1: опрос
  `getTrackUpload` 2 с до финала ≤ 60 с → один POST `{ uploadId }`, `failed/skipped` без POST, `NOT_READY` — один
  повтор), `route-rides-block.tsx`, `route-ride-pick.tsx`, `route-ride-detail.tsx` («Проверить снова» RC-2),
  `route-ride-map.tsx`.
- `components/activity-pick-row.tsx` (вынесена из `race-pick.tsx`, поведение гонки без изменений).
- `features/routes/route-line-map.tsx` — необязательный `track`; блок на карточках каталога (шторка, после
  действий/«Пожаловаться», до «Гонок») и своего готового маршрута (после «Загружен»), запрос списка — в экранах
  (pull-to-refresh).
- Экраны `app/routes/pick/[routeId].tsx`, `app/routes/rides/[routeId]/[rideId].tsx` в `Stack.Protected`; сторож
  порядка манифеста SSR — `src/app-routes-manifest.server.test.ts` (до переноса адреса выбора — красный).
- e2e: гард входа на обоих адресах (SSR отдаёт свой экран: у выбора — шапка «Выбрать свой заезд», без данных и OG),
  SSR карточки без «Мои заезды», гость без блока, после входа — блок → выбор → пусто.
- Документы: `docs/product/routes.md` («Экран в приложении (route-rides-02)»), `.claude/rules/pokatim-app.md`.

Тесты (jest): `route-ride-format.test.ts` (17), `error-messages.test.ts` (7), `activity-pick-row.test.tsx` (2),
`route-rides-block.test.tsx` (14), `route-ride-pick.test.tsx` (18, вкл. RC-1 и RC-3 клиента), `route-ride.test.tsx`
(12, вкл. RC-6), `route-ride-map.test.tsx` (6), `app-routes-manifest.server.test.ts` (6, RC-3 сервера);
`route-detail.test.tsx`, `my-routes.test.tsx` — дефолт `listRouteRides` (RC-12); `race-pick.test.tsx` без изменений —
зелёный.

Проверки:
- `TURBO_CONCURRENCY=1 pnpm check` (env `MONGO_URL_TEST`/`REDIS_URL_TEST` изолированные) — `Tasks: 15 successful, 15
  total`, EXIT 0 (`@pokatim/app:test: Tests: 1831 passed`, `@pokatim/api:test: Test Files 152 passed`). Флаки по
  дороге: 1-й прогон — `not-found.test.tsx` (таймаут 5 с под нагрузкой; отдельно 3/3), 2-й — интеграционные API на
  лимитерах Redis (429/200; `pnpm --filter @pokatim/api test` отдельно — 152/152, 1643 tests); 3-й прогон — зелёный
  (app-тесты — из кэша turbo 2-го прогона, где они прошли).
- `pnpm e2e:web` без API (CI такого шага нет: job `web` всегда `E2E_API=1`; локально — `EXPO_PUBLIC_API_URL=
  http://127.0.0.1:3000` без сервера API): 17 passed, 7 skipped, 4 failed — шаги гарда `/rides/report/<id>`,
  `/rides/route-pick` и два новых route-rides-02 падают одинаково: без API экран показывает «Не удалось загрузить»
  вместо «Нет соединения». Старые два шага так же красные на `origin/develop` (aa857ba, отдельная сборка) — не
  регрессия; HTML-проверки новых шагов (в т. ч. RC-3: SSR выбора — свой экран) проходят.
- Режим CI (`E2E_API=1`: API + worker + MongoDB + Mailpit) — NOT VERIFIED локально.
- Проверка на dev, устройстве (native-карта), 7 темах и 375 px вручную — NOT VERIFIED.
