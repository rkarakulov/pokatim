---
paths:
  - "apps/admin/**"
---

# pokatim — веб-панель «Протокол» (дополняет `web.md`)

Процесс — скил `app-dev-kit:web-ui`. Гостевой веб — не здесь: это то же приложение `apps/app` (ADR-0003,
`pokatim-app.md`).

## admin — панель «Протокол» (тема `panel`)

- Desktop 1440, только светлая тема, плотные таблицы (TanStack Table): сортировка, фильтры, вкладки кластеров,
  фиксированная шапка.
- Доступ по роли (организатор / модератор / админ); без роли — экран «Нет доступа».
- Формы — react-hook-form + zod; данные — `@pokatim/api-client`. Исключения (`useState`) — панель решения спора (радио
  и необязательная заметка; тело проверяет схема контракта на сервере) и окно пола и года
  (`VerifiedDemographicsDialog`; тело проверяет `UpdateVerifiedDemographicsRequest` до отправки).
- Деструктивные и необратимые действия (исключение трека, пересчёт, публикация протокола) — модалка с обязательной
  причиной; причина уходит в append-only аудит на сервере. Решение спора — обязательный шаблон исхода в форме и
  `Dialog` подтверждения без свободной причины (журнал пишет заметку или код шаблона, раздел «Споры»).
- Чек-лист публикации протокола блокирует кнопку и объясняет почему.
- Флаги правдоподобия видны только команде платформы и не блокируют публикацию.
- Биометрия (пульс, мощность, FTP, вес) — только в разборе спора: блок `DisputeSeries` (06b) — запрос по кнопке,
  опрос `preparing` каждые 2 с не дольше 3 мин, `gcTime: 0`; графики — `SeriesChart` (inline SVG, без библиотеки
  графиков: один ряд на график, общая ось дистанции, шкала Y — мин/макс текстом, перекрестие мышью; картинка без
  фокуса), клавиатурный и экранный доступ к значениям — таблица в `<details>`.

## Каркас, сессия и права (admin-01, ADR-0009)

- Роутер — TanStack Router (`src/router.tsx`, `basepath` из `import.meta.env.BASE_URL`); защищённая ветка —
  `beforeLoad` с `ensureQueryData(meQuery)`; «кто я» — `src/session/me.ts`. Запросы не перечитываются по фокусу
  окна (`refetchOnWindowFocus: false`, иначе второй GET на экране), заход на экран — свежий запрос (так виден 401
  погасшей сессии); после действия — инвалидация ключа.
  Глобальные 401/403 — `createQueryClient` (`src/session/query-client.ts`): 401 после входа — «Вход» с «Сессия истекла» и `next` (только путь внутри панели —
  `safeNext`), 403 — «Нет доступа к разделу». Мутация, сама обрабатывающая 401 (вход), — `meta.ownsUnauthorized`.
- Права в UI — только отображение: `Can` / `useCan(permission)`; раздел с правом — `RequirePermission` в маршруте
  (прямой URL без права — «Нет доступа к разделу» внутри каркаса). Источник истины — `PanelGuard` сервера.
- Навигация — один файл `src/navigation.ts` (`{ to, labelKey, permission?, anyPermission?, sections?, group }`):
  `anyPermission` — пункт виден при любом из прав, `sections` — пути, на которых (и на вложенных) пункт подсвечен.
- «Модерация» (admin-moderation-hub) — `features/moderation/*`: один пункт сайдбара (группа `bottom`, после «Журнала
  действий») при любом из `routes.moderate` / `profiles.moderate` / `rides.moderate`; очереди — вкладки
  `ModerationTabs` под `PageHeader` списков (`MODERATION_TABS`: «Маршруты райдеров», «Профили райдеров», «Кофе-райды»;
  только с правом, текущая — `aria-current`), число — из `overviewQuery` (загрузка, ошибка, ноль — без числа). Адреса
  очередей прежние; `/moderation` — `redirect` на первую доступную вкладку, без прав — «Нет доступа к разделу».
- Новые экраны — только из `src/ui` (`AppShell`, `PageHeader`, `DataTable`, `Dialog`, `ReasonDialog`, поля, `Button`,
  `Banner`, `StatusTag`, `AuthCard`, `EmptyState`, `ErrorState`): без доменных импортов, кандидаты в
  `@rkarakulov/admin-kit` (F6, явное исключение `AGENTS.md` §4.11 до выноса). Размеры раскладки панели, которых нет в
  базе, — `src/panel-tokens.ts` (`--panel-*`, временно до токенов базы, Q17).
- Время — `src/format.ts` (`Intl` ru-RU, Europe/Minsk); тесты admin — `TZ=Europe/Minsk` (`vite.config.ts`).
- CSP панели — `infra/docker/admin-nginx.conf`: inline-скриптов нет, inline — только `<style>` дизайн-системы. CSP web
  приложения — отдельный, с nonce (`apps/app/server/web-server.ts`, ADR-0025); origin карт — там же `MAP_ORIGINS`.
- Ввод даты и времени — `DateTimeField`/`DateField` (`src/ui`): значение — настенное время Europe/Minsk, в запрос —
  `minskWallTimeToUtc` контрактов (не `new Date(value)`); показ — `src/format.ts`.
- Что можно менять в записи — `editable` сервера (`PanelRace.editable`): зафиксированные поля — с замком, причина
  недоступности — `DisabledReason` под кнопкой (`aria-disabled` + `aria-describedby`). Правила (48 ч, «только позже»,
  пересечение сезонов) в UI — только подсказка.
- Поле «Эталонный коридор» (race-results-01) — `features/races/CorridorField.tsx`: готовые маршруты
  (`readyRoutesQuery` — все страницы курсора без предела; повтор курсора — ошибка, не «полный» список), «Загрузить GPX» — `FileButton` → окно «Новый маршрут» (без вложенной
  `<form>`: окно внутри формы гонки) → опрос `routeQuery` каждые 2 с, пока `processing`, не дольше 5 мин по часам — и при сплошных ошибках запросов (дальше —
  «проверьте позже»; статус — `role="status"`, без спиннера; три сбоя подряд — баннер), отказ — причина под полем.
  Ошибка обновления превью при показанной линии — баннер с повтором.
  Превью — `RoutePreview` (компактная карта, без env стиля — `LinePreview`: SVG без карты, `--color-map-route`,
  `--stroke-indicator`). С коридором дистанция — только
  чтение («… — по маршруту»), допуск — поле с подсказкой «Коридор: ±N м от маршрута». Ошибки сервера
  `corridor.routeId` / `corridor.widthM` — под своими полями формы.
- «Маршруты» (routes-01) — `features/routes/`, маршрут `/routes` под `RequirePermission permission="races.read"`,
  пункт навигации — группа `main` после «Календаря». Загрузка GPX — общий `useRouteUpload` + `RouteUploadDialog`
  (`route-upload.tsx`), превью — `RoutePreview`; `CorridorField` и экран «Маршруты» используют их (копии нет).
  Таблица с колонкой «В каталоге»; действия готового маршрута (`races.manage`): «Опубликовать в каталоге» / «Изменить»
  — `RouteCatalogDialog` (линия и предупреждение RC-11, город — `SelectField` справочника, покрытие — `ChipGroup`,
  ошибки под полями, `409 ROUTE_INVALID_STATE` — баннер), «Снять с публикации» — `Dialog` подтверждения без причины.
- Страница маршрута и карта (routes-05, ADR-0014 поправка routes-05): `/routes/$routeId` (`races.read`) —
  `features/routes/RouteScreen.tsx` (состояния как у гонки; `processing` — опрос `ROUTE_POLL_MS` не дольше
  `ROUTE_POLL_MAX_MS`, затем «проверьте позже» с «Обновить»; `failed` — причина), название в «Маршрутах» — ссылка.
  Карта — `features/maps/` панели: `RouteMap` (DOM поверх чистых функций `@pokatim/route-view`: `interactiveMapOptions`,
  `guardWheelZoom`, слои `routeLayers(themes.panel …)` без коридора, линия `ROUTE_CATALOG_LINE_WIDTH`), `ScrubMarker`,
  `MapControls`; `maplibre-gl` и CSS — только через `loadMaplibre` (async-чанк, воркер — `maplibre-gl-worker.mjs?url`
  + `setWorkerUrl`). Стиль — `VITE_MAP_STYLE_LIGHT` (`map-style.ts`); не задан — `LinePreview`. Смоук
  (`e2e/project.ts`) собирает панель со стилем своего origin (`MAP_STYLE_URL`), ответ — пустой стиль через
  `context.route`: карта, чанк, воркер и CSP проверяются в CI без сети. nginx отдаёт воркер `.mjs` как
  `application/javascript` (модульный воркер, `nosniff`).
  Профиль — `ElevationProfile` (inline SVG, `role="slider"`, клавиши `scrubKeyTarget`, стор скраббинга —
  `createScrubStore` на экземпляр страницы, `useStore` из `zustand`); подписи — `route-detail-format.ts`. CSP
  (`admin-nginx.conf`): origin провайдера в `connect-src`, `worker-src 'self' blob:`, `img-src blob:`; сторож —
  `src/csp.test.ts` (origin стиля из `deploy-dev.yml`). Превью (`RoutePreview`): компактная карта и «Открыть
  маршрут» — из поля коридора новая вкладка (`openLink="new-tab"`), из окна публикации — та же, на странице маршрута —
  без ссылки (`openLink={false}`).
- Карта гонки (panel-race-map) — `features/races/RaceCorridorMap.tsx`: секция «Карта гонки» под формой `RaceEditor` у
  сохранённой гонки с коридором (любой статус; несохранённый выбор — только превью поля). Тот же `RouteReadyView`
  (`corridorWidthM`, подзаголовки `headingLevel={3}`): `RouteMap corridorWidthM` добавляет слой коридора
  `routeLayers` (±`widthM`, как в приложении; линия — `ROUTE_CATALOG_LINE_WIDTH`), смена допуска пересоздаёт карту;
  время в пути — по покрытиям гонки; стор скраббинга — на экземпляр блока (`key` — id маршрута). Данные —
  `routeQuery` (ключ превью поля). Скелетон карты, ошибка без данных — `ErrorState`, ошибка обновления — свой баннер,
  маршрут не `ready` — секции нет; без env стиля — `LinePreview`, допуск — в подписи и строке «Коридор: ±N м от
  маршрута · Открыть маршрут» (новая вкладка, `OpenRouteLink`). CSP — та же карта routes-05.
- 409 `CONFLICT` правки по устаревшей версии — `ConflictBanner` «Запись изменили — обновите страницу» с «Обновить».
- Раздел «Результаты» гонки (race-results-05) — `features/results/` по маршруту `races/$raceId/results`
  (`races.read`), ссылка «Результаты» из `RaceEditor` опубликованной или отменённой гонки. KPI — `StatTile` (`src/ui`).
  Чек-лист публикации — только из `PanelRaceResults.publish` (на клиенте не считается): «Опубликовать протокол»
  неактивна со всеми причинами (`DisabledReason`); условие «да/нет» (`window_open`) — бейдж «Не готово» без счётчика,
  строка при нуле — нейтральный текст `admin.results.check.<code>.ok`. Все действия — `ReasonDialog` с обязательной
  причиной; затем инвалидация ключа гонки (`['admin','races','item',id]` — результаты лежат под ним), 409 — тоже.
  Ошибки `RESULTS_ACTION_BLOCKED` / `RESULTS_PUBLISH_BLOCKED` — текст по `details` (`results-errors.ts`). Действия
  скрывают права `results.manage` / `results.revise`; места, статусы и ревизии — только с сервера.
  Подпись участника — `riderLabel(entryId, riderName)`: «Анна К. ·id» при имени (сервер отдаёт его только с
  согласием), иначе «Участник ·id» (profile-02). «Сбросить имя» в «Участниках» — только с `profiles.moderate` и при
  имени, `ReasonDialog` с предупреждением не писать имя в причину.
  Группы и флаги (race-results-07): вкладки групп — `ChipGroup` по `groups` ответа («Все группы» — без `group`; вкладки
  держатся из последнего ответа при загрузке и ошибке), «Только «Требует внимания»» — `ToggleChip` (`attention=true`);
  фильтры — на сервере, в ключе запроса. Колонки группы, уровня и флагов (`FlagList`: подпись кода и метрика
  подсказкой — отношение к медиане или %; `HR_POWER_DECOUPLED` — нейтральное «Расхождение N %»). Финишёры (`unranked ≠
  null`) — блок «Финишёры — без места» без колонки места, отдельным запросом `finishers=true` с теми же фильтрами (за
  пределом строк «Участников» не теряются; свой баннер предела), виден при `counts.finishers > 0`; баннеры предела
  скрыты при `isPlaceholderData`. KPI «Требует внимания» и «Финишёры» — счётчики сервера. Попытки — «Датчики» и
  флаги. «Пол и год» — только `profiles.verified_edit` и Verified в группе пол × возраст: `VerifiedDemographicsDialog`
  (текущие значения — GET при открытии, `gcTime: 0`; в PATCH — только изменённые поля и причина; вес, рост и FTP
  панель не получает; ошибка фонового обновления — баннер с повтором над формой; Esc и «Отмена» во время сохранения
  заблокированы; «Сохранить» — `aria-disabled` + `DisabledReason`; подсказка у причины — не писать пол и год, журнал
  append-only). Разбор спора — группа, уровень и флаги цели.
- Экран сезона (race-results-08b) — `features/seasons/SeasonScreen.tsx`, маршрут `/seasons/$seasonId` под
  `RequirePermission permission="races.read"`, вход — название сезона ссылкой в «Сезонах». Раздел «Рейтинг» без
  компонента вкладок (RC-19), только чтение: сводка (`StatusTag` «Актуален» / «Ждёт пересчёта», время пересчёта,
  версия формулы), `ChipGroup` класса и группы — только таблицы сводки, `DataTable` (место `placeLabel`, участник —
  `seasonRiderLabel`: без `userId` у организатора — имя или «Участник» без id; ячейки гонок «1 · 100» / «=2 · 85» /
  «DQ · 0» / «—», не в зачёте — приглушена с текстом для скринридера), «Показать ещё» по курсору. Курсор не привязан
  к снимку: другая `computedAt` следующей страницы — `resetQueries` таблицы (заново с первой страницы).
  Подпись «N гонок, в зачёте K · M участников» — из ответа таблицы (плюрали). Шапка — скелетон до `seasonsQuery`,
  отказ или нет сети — баннер с повтором (рейтинг виден); ошибка обновления шапки или сводки — баннер с повтором
  над прежними данными.
- «Модерация райдов» (05b) — `features/rides-moderation/*`, маршруты `/rides-moderation` (`?state=hidden` — в URL) и
  `/rides-moderation/$rideId` под `RequirePermission permission="rides.moderate"`, вкладка «Кофе-райды» раздела
  «Модерация». Действия — `ReasonDialog`; 409 `CONFLICT` и `RIDE_INVALID_STATE` — `ConflictBanner` с перечитыванием
  карточки; «Отклонить жалобы» отправляет `lastReportAt` карточки.
- «Маршруты райдеров» (routes-06) — `features/rider-routes/*`, маршруты `/rider-routes` (`?tab=reported|hidden` — в
  URL, по умолчанию «На проверке») и `/rider-routes/$routeId` под `RequirePermission permission="routes.moderate"`,
  вкладка «Маршруты райдеров» раздела «Модерация». Автор — только `Райдер ·<хвост id>` (`riderRouteAuthor`), имени нет (N8);
  жалобы — без автора. Карта, цифры и профиль — общий `features/routes/RouteReadyView.tsx` (тот же блок, что на
  странице маршрута routes-05; копий нет). «Одобрить» — окно с городом (`SelectField`) и покрытием (`ChipGroup`) из
  заявки, «Отклонить» — справочник причин (`RadioGroup`, подтверждение неактивно до выбора) и комментарий автору
  ≤ 500; «Скрыть» / «Вернуть» / «Отклонить жалобы» — `ReasonDialog` («Отклонить жалобы» шлёт `reportRevision`
  карточки — ревизию жалоб, не время). 409 `CONFLICT` / `ROUTE_INVALID_STATE` и 404 (автор отозвал, RC-10) —
  `ConflictBanner` «Заявку уже изменили — обновите страницу» с перечитыванием; баннер снимается только после
  успешного перечитывания. Ошибка перечитывания при показанной заявке: 404 — «Заявка не найдена» без линии и
  действий, 403 — «Нет доступа», прочее — баннер «Не удалось обновить данные» с повтором поверх последних данных.
- «Профили райдеров» (profile-moderation) — `features/rider-profiles/*`, маршруты `/rider-profiles` (одна очередь
  открытых жалоб, «Показать ещё» по курсору) и `/rider-profiles/$userId` под `RequirePermission
  permission="profiles.moderate"`, вкладка «Профили райдеров» раздела «Модерация». Подпись — `riderLabel(userId, name)` из
  `features/results/results-format.ts` (имя сервер отдаёт только при согласии, Q2); жалобы — без автора. Фото —
  `<img src={api.riderAvatarUrl(id)}>` (тот же origin, `img-src 'self'` — сторож `csp.test.ts`) в квадрате
  `.avatar-preview` (`--panel-avatar-preview`, `panel-tokens.ts`), без фото — пустой квадрат той же раскладки.
  «Сбросить фото / клуб / имя» — `disabled` + `DisabledReason`, когда сбрасывать нечего (по карточке); «Отклонить
  жалобы» — при `openReportCount > 0`, шлёт `reportRevision`. Все четыре — `ReasonDialog` с предупреждением «Не
  повторяйте имя или клуб в причине» (`extraFields`); 409 `CONFLICT` — `ConflictBanner` «Пришли новые жалобы,
  обновите карточку», снимается после успешного перечитывания; 404 на действие — перечитывание карточки; после
  действия — инвалидация `['admin','rider-profiles']` и журнала. Ошибка перечитывания при показанной карточке: 404 —
  «Профиль не найден» без действий, 403 — «Нет доступа», прочее — баннер «Не удалось обновить данные» с повтором.
- «Споры» (race-results-06) — `features/disputes/*`, маршруты `/disputes` (`?status=`, `?raceId=` — в URL) и
  `/disputes/$disputeId` под `RequirePermission permission="disputes.read"`; пункт навигации — группа `main` после
  «Гонок». Список: `ChipGroup` статуса (по умолчанию «На рассмотрении»), фильтр гонки — текст «Гонка: {название}» и
  «Все гонки» (выбора гонки нет), курсор. Разбор: категория в заголовке, статус справа; результат, заявление
  («Скрыт от участника»), ответ, история — только с сервера. `DecisionPanel` (`disputes.decide`) — форма на
  `useState` (исход, шаблон из карты исхода — обязателен, заметка), кнопка `aria-disabled` + `DisabledReason` по
  `decideBlockedBy` (D-25 — с датой `availableAt`), подтверждение — `Dialog`; `ReasonDialog` не используется. После
  решения — инвалидация `['admin','disputes']`, ключа гонки и журнала. Чек-лист «Результатов»: строка
  `open_disputes` — ссылка «Открыть споры» (`/disputes?raceId=`) при `count > 0` и `disputes.read`;
  `RecalculationsList` — запись `dispute:<id>` ссылкой на спор; `RaceEditor` — причина `disputes_open` (D-19).
- «Оформление приложения» (app-themes D1; user-theme — только декор) — `features/appearance/*`, маршрут
  `/appearance` под `RequirePermission permission="appearance.manage"`, пункт навигации — группа `bottom` в конце.
  Выбора тем нет: тему каждый райдер выбирает сам в приложении (ADR-0021). Сезонный декор (halloween-decor) — блок
  «Сезонный декор»: состояние текстом и одна кнопка «Включить/Выключить хеллоуинский декор» (тело
  `{ decor, version }`, сразу, без «Сохранить»); 409 — `ConflictBanner` с перечитыванием; после переключения —
  инвалидация журнала. Журнал — названия тем истории `appearance.theme_changed` из общих ключей `theme.<id>.name`.
  Панель остаётся в теме `panel`.
- Билеты (event-tickets C) — `features/tickets/*`: `EventTicketsScreen` (маршруты `races/$raceId/tickets`,
  `calendar/$startId/tickets`; право — по виду события на сервере, 403 — «Нет доступа», 404 — «не найдено»):
  `TicketingSettingsForm` (выключение при билетах — `Dialog` с числом), `MaterialsSection` + `MaterialDialogs`,
  `ParticipantsSection` (`Can tickets.checkin`); блок `TicketingSummary` — на опубликованной гонке (`Can
  races.manage`) и в rail календаря. `CheckboxField` — `src/ui/fields.tsx`.
- «Check-in» — `features/check-in/*`: отдельная защищённая ветка `checkInLayoutRoute` (тот же `requireSession`) **без
  сайдбара** — исключение из desktop 1440 (телефон на старте, от 360 px; две колонки — от 900 px). Камера — только по
  кнопке; `scanner.ts` — выбор декодера (`BarcodeDetector`, иначе `jsqr` динамическим импортом), `parseScan`,
  дедупликация 5 с. Камере нужен `Permissions-Policy: camera=(self)` в `admin-nginx.conf` (каждый `location`) и в
  `vite preview` (`panelHeader` в `vite.config.ts`).
- «Сбои удаления аккаунтов» (erasure-failures) — `features/account-erasures/AccountErasuresScreen.tsx`, маршрут
  `/account-erasures` под `RequirePermission permission="platform.stats"`, без пункта навигации — вход ссылкой
  «Открыть» карточки «Удаления аккаунтов со сбоем» «Обзора». `DataTable` + «Показать ещё» по курсору; аккаунт —
  `riderLabel(userId)` («Участник ·<id>»), шаг — `admin.accountErasures.step.<step>`. «Повторить удаление» —
  `ReasonDialog`; итог — баннер над таблицей (поставлен / уже запрошен), 404/409 — баннер «Удаление уже изменилось»
  без ошибки в окне; затем инвалидация списка, «Обзора» и журнала.

## Проверка

`pnpm --filter @pokatim/admin build` и `pnpm check`; смоук — `pnpm e2e:admin` (`docs/runbooks/local-dev.md`,
«Панель»).
