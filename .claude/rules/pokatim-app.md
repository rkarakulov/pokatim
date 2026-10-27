---
paths:
  - 'apps/app/**'
---

# pokatim — приложение райдера (дополняет `app.md`)

Процесс — скил `app-dev-kit:mobile-expo`; начинай с рамок MVP.

## Рамки MVP (не расширять без ADR)

- Нет записи GPS, нет фоновой геолокации, нет BLE-датчиков, нет push, нет Strava API, нет биометрического
  входа. Garmin и Wahoo — только импорт велозаездов через агрегатор (ADR-0011). Задача требует что-то из этого —
  стоп: продуктовое решение и ADR, а не реализация.
- Геолокация — только foreground для «рядом», после pre-permission экрана («Не сейчас»), при отказе — баннер со
  ссылкой в настройки ОС.
  Сейчас (слайс 4): один pre-permission экран в онбординге (`(setup)/location`), координаты не читаются, не хранятся и
  не отправляются до фичи «рядом»; развилка — `features/location/location-permission(.web).ts` (`expo-location` —
  только в native-файле, web — Geolocation API); «экран показан» — флаг устройства `pokatim.locationPrompt`
  (`features/onboarding/device-flags(.web).ts`). Перед сторами — `LOCATION_STEP_ENABLED` (release-чеклист).
- Заезды и маршруты — импорт файла через системный picker (заезд: FIT/GPX, TCX — нет, ADR-0011; маршрут: GPX/KML).
- Треки и устройства (ADR-0011): шаг онбординга `(setup)/devices` после геопозиции (флаг аккаунта на сервере
  `OnboardingStatus.devicesStepCompleted`; поля нет — старый API — шаг пропускается); экран «Устройства»
  `settings/devices` (вход — иконка верхней панели); возврат авторизации `devices/return` — вне гардов. Развилки —
  файлами: `features/devices/connect-flow(.web).ts`, `pick-track-file(.web).ts`, `upload-track(.web).ts`.
- Уведомления — in-app центр, обновление polling'ом (`refetchInterval`, не сокеты); статусы обработки — так же.

## Правила pokatim

- Deep links / universal links для 5 типов объектов (заезд, маршрут, календарь, результат, карточка) — через
  Router; возврат к объекту после регистрации.
- Локальное состояние — минимальный zustand (сессия, регистрация); формы — react-hook-form + zod-схема из contracts.
- Строки — формальное «вы».
- Темы: светлая Jersey Aura, тёмная Night Ride, системная.
- Доступность: `accessibilityActions` вместо единственного drag-жеста; reduce motion — упрощённая анимация
  (вспышка достижения без мерцания).
- Публичные ключи в бандле — только такие, как Sentry DSN и ключ тайлов.

## Типовые возможности

- **Карта:** MapLibre — линия маршрута, старт, коридор, трек пользователя, подсветка вне коридора; тема карты
  следует теме приложения.
- **Файлы:** системный picker; pre-check расширения, размера и пустого файла (`@pokatim/tracks`, лёгкий вход —
  парсеры `@pokatim/tracks/parse` в приложение не попадают); resumable upload с процентом, отменой и паузой без сети;
  очередь загрузок переживает перезапуск, очищается при выходе. **v1 (ADR-0011, §8.2 tracks-devices):** одна
  попытка с прогрессом и «Отменить», без resumable и очереди — до больших файлов и загрузки в фоне.
- **Шеринг:** системный share sheet и копирование ссылки; карточку рендерит сервер.
- **Удаление аккаунта:** нативный alert с последствиями.

## Публичные экраны по ссылкам (web, ADR-0003)

- Экран на каждый тип ссылки (заезд, маршрут, календарь, результат, карточка) открывается без входа и без
  установки; SSR + OG-мета (`generateMetadata`) без персональных данных; состояния: недоступно, карточка
  отозвана, гонка отменена.
- Публичное удаление аккаунта: только e-mail, нейтральный ответ, подтверждение по ссылке, действие — POST по кнопке.
- Мета — `publicPageMetadata` (`src/lib/page-metadata.ts`) в `generateMetadata`: без e-mail и других ПДн; путь с
  токеном (ссылки писем) — без `og:url`; `loader` — только для публичных данных (e-mail в HTML не попадает).
  Образцы — `register`, `auth/verify/[token]`. Новый публичный экран — шаг смоука `e2e/web.spec.ts`.

## Сессия в вебе (ADR-0003 п. 4, правила сервера — `pokatim-security.md`)

- Развилка платформ — файлами: `features/auth/session-persistence(.web).ts`, `secure-storage(.web).ts`,
  `lib/api-platform(.web).ts`. Web: access — только в памяти стора, refresh — httpOnly cookie (JS его не видит и не
  хранит), восстановление — `api.refreshSession()`; токен регистрации — `sessionStorage` вкладки. Native —
  SecureStore, как было.
- Всё, что меняет cookie сессии (вход, refresh, poll регистрации, выход), — под одним Web Lock
  `pokatim.session-refresh` (`withSessionLock`, `features/auth/session-lock(.web).ts`): ответ одной операции не
  приходит поверх результата другой. Native — тот же `withSessionLock`, замок в памяти процесса (одна сессионная
  операция за раз: выход ждёт фоновую ротацию).
- Признак «сессии нет» `pokatim.noSession` (`localStorage`, только под Web Lock): ставят 401 восстановления и
  обновления access и подтверждённый отзыв, снимают вход и poll (`persistSession`); с признаком запуск не зовёт refresh
  (гость без 401 на каждой загрузке). Положительного признака нет — после входа хранилища браузера пусты; нет признака
  (старые сессии, хранилище недоступно) — refresh как раньше; незавершённый выход повторяет отзыв при любом признаке.
- Восстановление: 401 — «не вошёл»; 429, сеть, сбой API — не выход: повторы (429 — через `retryAfterSec`), затем
  статус `unavailable` — вкладки показывают «Нет соединения» / «Не удалось загрузить» с повтором (`AsyncContent`).
- Native (ADR-0005): сессия восстанавливается из SecureStore без сети (офлайн-старт — в аккаунте), затем фоновая
  ротация `revalidateSession`: 401 — локальный выход и «Вход»; сеть (одна немедленная повторная попытка), 429,
  5xx — остаёмся. Сбой записи SecureStore — `console.warn` только с именем ошибки.
- Вход и poll сохраняют сессию в той же операции под замком, что и запрос (`requestSignIn`,
  `fetchRegistrationPoll`); `useSessionStore.signIn` — только память (без refresh).
- Выход — `useSignOut`: сервер (native — refresh из SecureStore) + очистка хранилища, `queryClient.clear()` и
  регистрации; офлайн — локально всё равно. Web: отзыв не подтверждён (сеть, 5xx) — признак
  `pokatim.signOutPending` в `localStorage`: запуск не восстанавливает аккаунт по cookie и повторяет отзыв; снимается
  подтверждённым отзывом или явным входом. Признак ставится, проверяется и снимается только под Web Lock — внутри
  операций выхода, восстановления и входа/poll (выход, вставший в очередь позже входа, побеждает).
- Онбординг после входа (слайс 4): шаги — группа `(setup)` (`/survey` → `/location` → Главная), гард корневого
  layout по `onboardingStep` (`features/onboarding/onboarding-store.ts`); пока сессия или шаг неизвестны — скелетон
  оболочки (вкладки и `(setup)`), ошибка статуса опроса — «Нет соединения» / «Не удалось загрузить» с повтором.
  Источник опроса — сервер, кеш «пройден» — `pokatim.onboarding` (`secureStorage`, стирается при выходе).
- Запросы, требующие входа, — только `withAccessToken(call)` (`features/auth/authorized.ts`, ADR-0008): access за
  60 с до истечения обновляется заранее, 401 — один refresh и один повтор, single-flight через `refreshAccess`
  (`session-persistence(.web).ts`) под замком сессии; refresh 401 — локальный выход; сеть/429/5xx — ошибка запроса.
- Мутации онбординга — `networkMode: 'always'`: офлайн даёт сетевую ошибку и баннер с повтором, а не вечную паузу. После выхода или отзыва сессии гард ведёт на «Вход» (`returning`).
- E-mail между экранами (регистрация → вход, ссылка → вход, «Вход» ↔ «Забыли пароль?», ссылка сброса → вход) —
  через черновик в памяти (`registration-store`), не в URL: query-строка попала бы в историю браузера и логи
  web-сервера. Смонтированная форма «Входа» берёт адрес из черновика при фокусе.
- Экраны ссылок из писем (`auth/verify/[token]`, `auth/reset/[token]`) — вне гардов корневого layout (открываются и
  с сессией, и без). Запросы сброса пароля — вне Web Lock (пути вне cookie сессии); после смены пароля сессия этого
  устройства — локальный выход через `useSignOut` (сервер её уже отозвал).
- Сторы и `api` не вызываются в рендере и на уровне модуля (на SSR-сервере сторы — общие синглтоны); гидрация — в
  эффектах. Гарды допускают `unknown` и `unavailable`: вкладки — скелетон оболочки или повтор, не редирект (SSR
  отдаёт HTML).

## Главная (блок 02, `docs/product/home.md`)

- Реестр разделов — `features/home/sections.ts` (`AVAILABLE_HOME_SECTIONS`): раздел входит только вместе с живым
  read-API своего домена, без заглушек «скоро». Порядок — `orderHomeSections` по `GET /v1/profile`; профиль не
  загрузился — порядок вкладок, без ошибки на экране.
- Данные раздела — list-эндпоинт домена (`limit: 1`; зависящий от зрителя — под `AuthGuard` через `withAccessToken`,
  как «Кофе-райды»), ключ с префиксом вкладки (`['races', 'list', …]`); своего агрегата/BFF и своих DTO нет. Состояния — `HomeSection` (шапка сразу, скелетон и ошибки — в слоте героя).
- Время и даты — только `contracts/src/time.ts` (`utcToMinskWallTime`, `minskToday`, `addLocalDays`) + месяцы
  `date.month.*`; общие подписи дат, дистанций и меты — `src/lib/minsk-format.ts`, подписи гонки —
  `features/races/format.ts`, «сейчас» — `src/lib/use-minsk-clock.ts` (тесты в TZ ≠ Минск). Фаза — с сервера; `'unknown'` в фазе, покрытии,
  дисциплине — нейтрально: без строки и подписи.
- Обновление: pull-to-refresh (`usePullToRefresh`, индикатор только на время жеста) и `focusManager` — native
  `src/lib/focus-manager.ts` (`AppState`), web — встроенный `visibilitychange`. Polling — нет.

## Гонки и сезон (блок 03, `docs/product/races-and-seasons.md`)

- Вкладка «Гонки» — `features/races/race-feed.tsx` (`FlatList`, не `ScrollView` + `map`): `useRaceFeed` — страницы
  `current`, затем `past` (только после исчерпания `current`); ключи `['races','list',{ scope, bikeClass, month,
limit },'pages']` (`useInfiniteQuery`; фильтры отсортированы). Фильтры — состояние экрана (R7), смена — скелетон на
  месте данных. Ошибка догрузки страницы — баннер в подвале (не «Данные могли устареть» над героем).
- Публичные экраны `races/[id]`, `seasons/[id]` — в корневом `Stack` вне `Stack.Protected` (гость и вошедший; на
  native поверх вкладок). «Назад» — `DetailHeader`: история есть — назад, нет — вошедшему вкладка, гостю `/`.
- SSR-данные (`loader`, `generateMetadata`) — только `src/lib/public-ssr.ts` (`publicPath` — `Uuid` до запроса,
  `fetchPublicForSsr` — таймаут, `found` / `notFound` / `unavailable`, кэш процесса публичных данных 60 с, 404 — в
  отдельном пуле); свой `fetch` в экранах нет. Не найдено — нейтральная мета и `robots: noindex` (HTML 200); API
  недоступен — нейтральная мета без `robots`. Без сети при показанных данных — `OfflineBanner`.
- Даты на публичных экранах — всегда с годом (`now = null` в `minsk-format`); «сегодня / завтра» — после монтирования
  (`useMinskClockAfterMount`). Во вкладке (без SSR) — как Главная. Фаза — только с сервера; выбор сезона для кнопки —
  чистая `pickSeason` по фазам сервера.

- Коридор гонки (race-results-01): карточка показывает строку «Коридор — ±N м от маршрута» и дистанцию «… по
  GPS-треку», если `race.corridor` есть; `null` и отсутствие поля (старый API) — как без коридора. SSR-мета не
  меняется.
- Карта (maps-01, ADR-0014): переиспользуемый модуль `features/maps/` — `route-map.tsx` (native,
  `@maplibre/maplibre-react-native` 11: `Map`/`Camera`/`GeoJSONSource`/`Layer`) и `route-map.web.tsx` (`maplibre-gl`
  6 через `load-maplibre.ts` — динамический `import()` после монтирования, в SSR не исполняется; воркер —
  `public/maplibre-gl-worker.mjs` по `setWorkerUrl`, копию кладёт `scripts/copy-map-worker.ts` в `dev`/`build:web`,
  в git не хранится); слои и GeoJSON — один источник `corridor-style.ts` (коридор — ширина линии 2 × `widthM` в
  метрах выражением зума, роли `map.*`, `CORRIDOR_OPACITY`), рамка — `route-map-frame.tsx` (пропорция
  `MAP_ASPECT_RATIO`, доступное изображение с подписью без координат, сообщение «Карта не загрузилась» поверх). URL
  стилей — только `EXPO_PUBLIC_MAP_STYLE_LIGHT/DARK` (`map-style.ts`, прямое обращение к `process.env`); не заданы —
  карты нет. Статичный вид: жесты выключены пропсами (не `pointerEvents` — атрибуция нажимается), камера по рамке
  без анимации. Карточка `races/[id]`: блок `race-route-map.tsx` после строки «Коридор» — SSR и первый рендер — место
  карты (скелетон той же пропорции), после монтирования: env не задан, геометрия 404/ошибка — блок схлопывается
  (строки остаются; ошибка обновления при показанной карте — карта остаётся); запрос `['races','route',id]` — только
  клиент, pull-to-refresh карточки перезапрашивает его, когда коридор есть (`useRaceRouteRefetch`: коридор
  опубликованной гонки до старта правится); ширина коридора на карте — из `race.corridor.widthM` карточки. Native —
  config plugin в `app.json`; пакет MapLibre RN импортируется только лениво (`load-maplibre-native.ts`, `import()`)
  и только при `mapSupported()` (`map-support(.web).ts`: `TurboModuleRegistry.get` модулей `MLRNCameraModule`,
  `MLRNMapViewModule`) — статический импорт бросает `getEnforcing` в Expo Go и старом dev-клиенте; нет модулей —
  блока карты нет, как без env. Jest — мок пакета и загрузчика в `jest.setup.ts` (модули «есть»), web — мок
  `load-maplibre`.
- Свой трек (maps-02): компонент карты расширен только необязательным пропсом `track` (`RouteMapTrack`); весь код
  трека — `features/maps/track-style.ts` (`splitTrackLine` по дробным позициям разметки, `trackFeatures`,
  `trackLayers` — роли `map.track` и `map.offCorridor`: вне сегмента — тоньше и прозрачнее, сход — пунктир и толще;
  `unionBounds` — камера по маршруту и треку); источник `my-track`, слои — под `start` (старт/финиш поверх трека).
  Блок `race-route-map.tsx`: вошедшему с попытками — трек выбранной (по умолчанию лучшая, иначе новая; чипы-
  радиогруппа при нескольких), запрос `['races','entry',raceId,'attempts',attemptId,'track',status,checkedAt]` —
  маркер ревизии попытки в ключе (опрос участия пишет кеш `setQueryData` без каскада), только клиент, свеж
  бессрочно; пока впервые грузится — скелетон на месте карты (карта не монтируется дважды; чипы и строки остаются, после первой ошибки — карта маршрута без трека), смена попытки или ревизии — новая карта (`key`).
  Легенда («пунктир» — только при участках схода) и текстовая альтернатива подсветки (`my-track-format.ts`) — под картой и в подписи a11y; 404 трека — без
  трека и без строки; сеть/5xx — «Не удалось загрузить трек» с повтором. Гостю и не заявленному — без запроса.
- Атрибуция и отступы (B2–B4 maps-02): web — компактная атрибуция свёрнута при старте и после обновлений стиля
  (`attribution.web.ts`, до первого нажатия «i»), цвета контрола — роли темы в области карты (`data-route-map`);
  native — «i» в нижнем правом углу, `tintColor` темы. Камера — `MAP_FIT_PADDING` (снизу место под «i»). Полоса
  коридора не уже `CORRIDOR_MIN_WIDTH_PX` (минимум — опорой выражения зума: `max` с `zoom` MapLibre не допускает).

- Участие и результат (race-results-04): блок «Ваше участие» и таблица «Результаты» на карточке `races/[id]` — только
  клиентские запросы (в SSR не попадают; пока сессия неизвестна — скелетон блока там, где его увидит и гость:
  `guestCanSeeEnter`). Ключи `['races','entry',id]`
  (`no-store`, 404 старого API — `null`), `['races','results',id,'pages']` (публичная, префикс `['races','results',id]`
  для инвалидации), `['races','candidates',id]`. Опрос участия — `needsPolling` раз в 3 с; смена результата —
  тихая инвалидация таблицы (без уведомлений). Права и статусы — только `actions` / `result` сервера; причина
  недоступности — первая из подмножества своего действия (`enterBlockReason` / `addAttemptBlockReason`,
  `features/races/participation-format.ts`), не `reasons[0]`. `races/pick/[id]` — под гардом вкладок; пустой список —
  «Загрузить заезд» тем же путём, что на карточке. Срок загрузки `uploadClosesAt` — исключающая граница: показ —
  последняя включённая минута (`minskLastMinuteBefore`, «до 9 ноября, 23:59»). Загрузка в
  гонку — `useTrackFileUpload({ onUploaded })` + `addRaceAttempt({ uploadId })`; прогресс — общий `UploadProgress`.

- Споры (race-results-06) — `features/races/disputes/*`. Экраны внутри `Stack.Protected` (статический сегмент
  первым): `races/result/[id]/[entryId]` — карточка соперника, `races/dispute/[id]/[entryId]` — подача,
  `races/dispute-response/[id]/[disputeId]` — ответ; все — в `app/_layout.tsx` и `__tests__/app-routes.ts`. Строки
  таблицы (кроме своей) нажимаемы только у участника, когда карточке есть что показать (`filing.status !==
  'unavailable'` или мой спор по строке); гостю и неучастнику таблица не меняется. Карточка соперника — без имени
  (A12): место и время из кэша `useRaceResults`, статус — `page.status` таблицы; нет строки — `EmptyState`.
  `useMyRaceDisputes` (ключ `['races','disputes',id]`) — только у вошедшего с заявкой; опрос `ENTRY_POLL_MS`, пока
  есть открытый спор; мутации инвалидируют споры, участие и таблицу. Право подачи, сроки (D-44, D-25), анонимность
  (D-51) и D-39 — только с сервера (`filing`, `actions`); причина `filing.status: 'closed'` — по `filing.reason`
  («…будет опубликован {date}» только для `filing_closed`). Подача — категория обязательна, без вложений (A10);
  описание и ответ — однострочный `TextField` базы. Отзыв — `WithdrawConfirm` с `texts`. D-39: причины у
  «Загрузить заезд» (`races.block.*`) и «Отменить участие» (`races.withdrawBlock.*` — только `dispute_open` /
  `disqualified`); 409 — текст по `details.reason`.

## Маршруты (routes-01, `docs/product/routes.md`)

- Вкладка «Маршруты» — `features/routes/route-feed.tsx` (`FlatList`): ключ `['routes','list',{ city, distance,
  surface, limit },'pages']`, Главная — `['routes','list',{ limit: 1 }]`, чипы «Город» — `['routes','cities']` (до
  ответа — `FilterGroupSkeleton`, ошибка или пусто — группа скрыта, исчезнувший город снимается); всё публичное, без
  `withAccessToken`, `staleTime` 60 с. Карточка списка — `components/route-list-card.tsx`, подписи —
  `features/routes/format.ts`.
- Карточка `routes/[id]` — в корневом `Stack` вне `Stack.Protected` (гость по ссылке, RC-9), SSR и мета — как
  `races/[id]` (`publicPath`, `fetchPublicForSsr`, 404 — `noindex`). Карта — `catalog-route-map.tsx`: `useMapStyle`
  (`features/maps/use-map-style.ts`), `RouteMap corridor={false}` с `withoutCorridor(geometry)` (слоя коридора нет,
  `widthM` не показывается); ключ `['routes','map',id]` — только клиент. «Гонки на маршруте» — `['routes','races',
  id,'pages']`, `RaceListCard` с датами с годом; пусто, 404, ошибка — блока нет. «Поделиться» — `share-link`.
- Пропсы `RouteMap.corridor?` (по умолчанию `true`) и `lineWidth?` (routes-03, по умолчанию `stroke.indicator`;
  каталог — `ROUTE_CATALOG_LINE_WIDTH` = 5) — единственные изменения карты для каталога; существующие пропсы и
  `race-route-map.tsx` не меняются.
- Карточка (routes-03): без `SectionHero`; чипы — `Pill`, стат-блок — `StatBlock` с `note`, подписи и время в пути —
  чистые функции `features/routes/format.ts` (`ROUTE_PACE_KMH`); профиль — `features/routes/elevation-profile.tsx`
  (`ProfileChart`: web — SVG-путь `profile-chart.web.tsx`: тонкая линия и светлая заливка
  `PROFILE_FILL_OPACITY`; native — 160 узких столбиков `View`, только светлый силуэт `PROFILE_NATIVE_FILL_OPACITY`
  (кромка из столбиков ступенчатая); цвет — приглушённый `map.corridor`; график — `aspectRatio`, без `onLayout`: SSR =
  первый рендер; одно
  изображение с текстовой альтернативой); «Скачать GPX» — только `src/lib/download-file(.web).ts` (native —
  `openExternalUrl`, web — `<a download>` синхронно в обработчике) по `api.catalogRouteGpxUrl(id)`, только при
  `gpxAvailable`.
- Главная — раздел `routes` (текстовый герой `RouteHero`, RC-8; пустой каталог — `EmptyState`).
- Мои маршруты (routes-02): переключатель «Каталог / Мои» — `SegmentedControl` в шапке обеих лент, состояние —
  `?view=mine` (`useLocalSearchParams` + `router.setParams`). Лента — `features/routes/my-route-feed.tsx`, ключи
  `['routes','mine','list','pages']` (опрос 3 с, пока есть `processing`), `['routes','mine','detail',id]`,
  `['routes','mine','map',id]` (`staleTime: Infinity`) — всё через `withAccessToken`; инвалидация после мутаций — только
  `['routes','mine']`, при выходе — `queryClient.clear()`. Загрузка — конвейер `features/devices`
  (`pickTrackFile(ROUTE_FILE_EXTENSIONS)`, `trackFileBody`, `sendFile(…, MyRoute, …)`, `UploadProgress`) +
  `precheckRouteFile` и шаг «Название» (`use-my-route-upload.ts`). Карточка `routes/mine/[id]` — внутри
  `Stack.Protected` вкладок (гость — на вход), без `loader`, мета, OG и «Поделиться»; карта — общий `RouteLineMap`
  (`route-line-map.tsx`, им же пользуется `CatalogRouteMap`), строки — `DetailRow`; карточка списка —
  `MyRouteListCard` (общая рамка с `RouteListCard`).

## Календарь стартов (блок 04, `docs/product/races-and-seasons.md`)

- Вкладка «Календарь» — `features/calendar/calendar-feed.tsx` (`FlatList`): одна выдача, ключ
  `['calendar','list',{ discipline, city, month, limit },'pages']` (`useInfiniteQuery`, фильтры отсортированы); чипы
  «Дата» и «Город» — из `GET /v1/calendar/months` / `cities` (`['calendar','months']`, `['calendar','cities']`):
  до ответа — `FilterGroupSkeleton`, ошибка или пусто — группа скрыта, исчезнувшее значение снимается
  (`withinAvailable`). Подписи групп — месяц начала с годом (`groupByMonth`, `monthGroupLabel`).
- Публичная карточка `calendar/[id]` — в корневом `Stack` вне `Stack.Protected` (как `races/[id]`); «Старт прошёл» /
  «Идёт сейчас» — только по `phase` сервера; даты — всегда с годом (`now = null`).
- Внешние ссылки — только `src/lib/open-external-url(.web).ts` (native — `Linking.openURL`, web — `window.open` с
  `noopener,noreferrer` синхронно в обработчике нажатия) и только после `RegistrationUrl.safeParse`
  (`features/calendar/registration.ts`); адрес не логируется; `Linking` / `window.open` в экранах — нет.
- Общие чипы фильтров вкладок (`toggle`, `monthChipLabel`) — `src/lib/filter-chips.ts`; подписи календаря и герой
  старта (Главная и вкладка) — `features/calendar/{format.ts,calendar-hero.tsx}`.

## Кофе-райды (блок 05, `docs/product/rides.md`)

- Вкладка «Райды» — `features/rides/ride-feed.tsx` (`FlatList`): ключ `['rides','list',{ city, limit },'pages']`
  (`useInfiniteQuery`), Главная — `['rides','list',{ limit: 1 }]`, города — `['rides','cities']`; всё — через
  `withAccessToken`, `staleTime` 30 с, без polling. Подписи дней — по Минску (`groupByDay`, поперёк страниц).
- Карточка `rides/[id]` — в корневом `Stack` вне `Stack.Protected` (как `calendar/[id]`): публичные данные
  `['rides','detail',id]` (посев SSR), вошедшему — ещё `['rides','detail',id,'me']`; мета — всегда `robots: noindex`.
  `rides/new`, `rides/edit/[id]`, `rides/cancel/[id]` — внутри `Stack.Protected` вкладок.
- Участие — `RideGoingAction` (`src/components/ride-going-action.tsx`) только по `viewer`, `full`, `phase` сервера;
  клиент не вычисляет «полон / можно / фаза». Мутации (`networkMode: 'always'`): ответ `RideView` → кеш `me`, затем
  `invalidateQueries(['rides'])`.
- «Поделиться» — только `src/lib/share-link(.web).ts` (native — `Share`, origin — `EXPO_PUBLIC_WEB_ORIGIN`, не задан —
  кнопки нет; web — `navigator.share`, иначе буфер и «Ссылка скопирована»); `Share` / `navigator.share` / `Clipboard`
  в экранах — нет.
- Возврат гостя к объекту после входа — `features/auth/return-path(.web).ts` (память; web — ещё `sessionStorage`
  вкладки): ставит карточка при «Я иду» / «Участвовать» гостя; корневой layout забирает путь сразу после входа, он же —
  `redirectTo` гарда шагов онбординга (иначе редирект на Главную перебивает возврат), переход — один раз при `step === 'done'`;
  действие после возврата не выполняется автоматически.
- Форма — `react-hook-form` + `zodResolver(CreateRideForm)` из contracts; до релиза `TimeField` и многострочного поля
  базы — фолбэк (`TextField` с маской `ЧЧ:ММ`, однострочное описание, единицы в подписи).
- Жалоба (05b) — экран `rides/report/[id]` (`features/rides/ride-report.tsx`) внутри `Stack.Protected`: причина —
  `Chip` из `RIDE_REPORT_REASONS`, комментарий — однострочный `TextField` (фолбэк до многострочного поля базы), успех —
  баннер на месте формы. Кнопка «Пожаловаться» и строка «Вы пожаловались…» — только по `viewer.canReport` /
  `viewer.reported` сервера; скрытый райд (`phase: 'hidden'`, видит только организатор через `me`) — баннер без
  действий.

## Оболочка и неизвестные адреса (смоук dev 2026-10-27)

- Неизвестный адрес — `src/app/+not-found.tsx` (`NotFoundScreen`: «Страница не найдена», «На главную»; SSR — 404).
  Sitemap выключен опцией плагина `expo-router` (`sitemap: false` в `app.json`); dev-маршруты в production
  (`/ui-kit`) — тот же экран, а не редирект.
- Широкий экран: колонка экранов корневого `Stack` — по центру, не шире `layout.contentMaxWidth`
  (`@pokatim/design-tokens`), фон по бокам — тема приложения.
- `staleTime` по умолчанию — `DEFAULT_STALE_MS` (10 с, `src/lib/query-client.ts`): возврат фокуса сразу после ответа
  не повторяет запрос. Данные зрителя без `max-age` (участие, кандидаты, споры, `me` райда) — `DEFAULT_STALE_MS` явно,
  не 0; `staleTime: 0` — только когда свежесть нужна на каждом фокусе (список устройств после окна авторизации).
- Стопка идущих на райд — `GoingStack` (`src/components/going-stack.tsx`): квадраты с иконкой человека, имён нет.

## Проверка

`pnpm --filter @pokatim/app typecheck` и тесты; сборку EAS (`build:*`) агент не запускает. Ручная проверка на
симуляторе — в pr.md как `NOT VERIFIED`, если не делалась.
