# task.md — route-rides-04 (B): таблица «Другие» в приложении

Уровень: task3 (шаг 2 из 3 этапа 2, вторая половина). Продукт — `docs/product/routes.md` («Этап 2», O1–O5),
`docs/product/profile.md` («Показ заездов в таблицах маршрутов»). PR A (контракты, API, индекс, api-client) —
`feature/route-rides-others-api`, PR #171, task — `docs/tasks/2026-10-31-route-rides-04-others/task.md`.
Этот PR — **B**, ветка `feature/route-rides-others-app` от `develop` **после слияния и выкладки PR A на dev**
(RC-1 PR A: `UpdateProfileRequest` — `strictObject`, форма профиля шлёт все поля — до API каждое сохранение 400).
Файл задачи в репозитории — `docs/tasks/2026-10-31-route-rides-04-others/task-b.md`.

## 1. Title

«Другие на маршруте»: таблица лучших заездов райдеров с согласием на карточке маршрута каталога, полный список и
переключатель согласия в профиле.

## 2. Goal

API таблицы «Другие» готов (PR A), но райдер его не видит и не может дать согласие. Нужно показать таблицу на
карточке маршрута каталога, полный список и дать включить/выключить показ своих заездов — с понятным пояснением, что
увидят другие.

## 3. Scope

Решения прежней архитектуры (`[ASSUMPTION]`, подтверждены кодом — §5.1, уточнения — §8.1):

1. **Переключатель согласия.** В форме «Редактировать профиль» (`/settings/profile`, `ProfileFormView`) сразу под
   блоком «Показывать имя в таблицах результатов» — `Toggle` «Показывать мои заезды в таблицах маршрутов» и
   пояснение: «Другие райдеры увидят ваше время и день заезда на маршрутах каталога. Имя и фото — только если включён
   показ имени.» Сохраняется той же кнопкой «Сохранить» (форма шлёт все поля, теперь и `showRouteRides`); значение
   по умолчанию — из `ProfileView.showRouteRides`.
2. **Блок «Другие на маршруте»** на карточке маршрута каталога (`/routes/<id>`) сразу после «Мои заезды», до «Гонок на
   маршруте». Только вошедшему и только на клиенте (как «Мои заезды»: SSR, гость, сессия неизвестна — блока и
   запроса нет). Запрос `limit=5`. Строки — место, кто (аватар + имя / «Участник» / «Вы»), время, день заезда.
3. **Своя строка.** Если своя строка в первых 5 (`rows[i].rideId !== null`) — она в списке («Вы», выделение как в
   таблице результатов). Если нет, а `me !== null` — отдельной строкой под списком (с разделителем), место — `me.place`.
   Без согласия (`shared: false`) у своей строки — подпись «Видно только вам» и действие «Включить показ» → переход
   на `/settings/profile`. Нажатие на свою строку — результат своего заезда (`routeRidePath(routeId, rideId, false)`);
   чужая публичная строка — профиль райдера (`/riders/<publicId>`), «Участник» — без нажатия.
4. **Полный список** — экран `/routes/others/<routeId>` (в `Stack.Protected`, без таб-бара, как
   `routes/pick/[routeId]`): `limit=100` (`ROUTE_RIDE_LEADERBOARD_MAX`), та же строка, своя строка отдельно, если вне
   100; при `total > rows.length` — сноска «Показаны лучшие {shown} из {count}». Вход — «Все ({total})» в блоке, когда
   `total > rows.length` блока.
5. **Состояния (AGENTS §4.12).** Первая загрузка — скелетон строк; ошибка без данных (и пауза без сети) — баннер с
   повтором; ошибка обновления при данных — строки + баннер «устарело» с повтором; пусто (`rows` пусты и `me === null`)
   — текст «Пока никто не поделился заездами на этом маршруте»; `404` (маршрут не каталога / стал невидим / без длины)
   — блока нет (карточка), экран — «Маршрут недоступен» + «Все маршруты».
6. **Свежесть.** Таблица перезапрашивается: pull-to-refresh карточки и экрана; после сохранения профиля (сменились
   `shared` и имя своей строки); после новой проверки своего заезда и смены его статуса на финальный.
7. **Все платформы (§4.13)** — iOS, Android, web/PWA; платформенных развилок нет. **i18n** — ключи в `packages/i18n`.

## 4. Out of Scope

- Изменения API/контрактов/api-client (PR A). Если в PR B понадобится правка контракта — стоп, отдельным PR A-fix.
- Таблица у «Моих маршрутов» (`my-route-detail.tsx`), гостевой доступ, SSR и OG таблицы, курсор, фильтры, участки
  (route-rides-05), уведомления, трек/карта чужого заезда, жалобы на строки, «Включить» одной кнопкой без перехода в
  профиль (RC-B4).
- Подсказка согласия на имя (`name-consent-prompt`) — параллельная задача (риск конфликта — §8).

## 5. Architecture Context

Всё — `apps/app` (+ ключи `packages/i18n`, доки/правила). Зависимости фич односторонние (правило
`pokatim-app.md`, «Заезд по маршруту»): `routes/route-detail.tsx` → `route-rides/*`; `route-rides/*` → `routes/{…}`,
`races/{table-row,results-table,participation-format}`; `profile/queries.ts` → `route-rides/queries.ts` (только
инвалидация, RC-B6). Данные — только сервер (§4.1): места, `total`, `me`, `shared`, имя/фото — из ответа; клиент
ничего не ранжирует и не фильтрует по согласию.

## 5.1 Placement & Reuse Gate

Architect, 2026-10-31 (сверено с кодом ветки `feature/route-rides-others-api` @ `ccff667f`).

**Placement.** Новых пакетов, модулей и фич нет.

| Что | Где | Слой |
|---|---|---|
| Запрос таблицы, ключ, инвалидация | `features/route-rides/queries.ts` (`routeRidesKeys.leaderboard`, `useRouteRideLeaderboard`, `invalidateRouteRideLeaderboards`) | query |
| Формат строки (кто, место, время, день, a11y) | `features/route-rides/route-ride-format.ts` (`leaderboardRowView`, `leaderboardMeView`, `routeRideOthersPath`) | pure |
| Блок карточки | **новый** `features/route-rides/route-ride-others-block.tsx` (`RouteRideOthersBlock`) | component |
| Строки таблицы (общие блоку и экрану) | **новый** `features/route-rides/route-ride-others-rows.tsx` (`OthersRow`, `OthersMeRow`, `OnlyYouNote`) | component |
| Экран полного списка | **новый** `features/route-rides/route-ride-others.tsx` (`RouteRideOthersScreen`) + **новый** маршрут `app/routes/others/[routeId].tsx` | screen |
| Встраивание в карточку | `features/routes/route-detail.tsx` (`RouteSheetBody`, `RouteDetailScreen`) | screen |
| Переключатель | `features/profile/profile-form.tsx` | form |
| Инвалидация после `PATCH` | `features/profile/queries.ts` (`useUpdateProfile.onSuccess`) | query |
| Регистрация адреса | `app/_layout.tsx` (`Stack.Protected`), `lib/seo.ts` (`SEO_DISALLOW`), `__tests__/app-routes.ts`, `app-routes-manifest.server.test.ts` | routing |
| Тексты | `packages/i18n/src/ru.ts` | i18n |

**Reuse (обязательно) / запрещённые дубли.**

- Строки — `TableRow`, `RiderWho` (`note` — «Видно только вам»), `useRowAction` из `features/races/table-row.tsx`;
  стиль строки и полоса своей строки — как `ResultRow` в `features/races/results-table.tsx` (`styles.row`,
  `styles.own` + `theme.border.strong`); скелетон — `RowsSkeleton`, ошибка/пауза без сети — `TabFailure` и
  `loading` оттуда же (экспортированы). Свою копию строки/скелетона не писать.
- «Кто»: `t('races.results.you')` / `riderName ?? t('races.results.rider')`; метка ссылки — `profileWho`
  (`features/races/participation-format.ts`). Время — `formatElapsed` (`@pokatim/i18n`). День — `heroDateText(
  formatLocalRange(rideDate, rideDate, now))` (`lib/minsk-format.ts`: «4 октября», не текущий год или `now = null` —
  с годом); новую функцию даты не заводить.
- Аватар — только через `RiderWho` → `components/rider-avatar.tsx` (`row.riderAvatar?.id ?? null`).
- Пути — рядом с `routeRidePickPath`/`routeRidePath` в `route-ride-format.ts`; результат своего заезда —
  `routeRidePath(routeId, rideId, false)`; профиль — `riderPath` через `useRowAction`; карточка — `routePath`
  (`features/routes/route-detail.tsx`).
- Запрос — `withAccessToken((t) => api.getRouteRideLeaderboard(t, routeId, { limit }))`, 404 → `null` — как
  `useRouteRides` (`isNotFound`); `DEFAULT_STALE_MS`.
- Экран — оболочка `useSettingsShell` и `DetailHeader` (как `routes/pick/[routeId]`), невалидный `Uuid` — без запроса;
  «Маршрут недоступен»/«Все маршруты» — существующие ключи `routes.detail.notFound`/`routes.detail.allRoutes`;
  `EmptyState`, `AsyncContent`, `usePullToRefresh`, `useMinskClockAfterMount` — существующие.
- Форма — та же `ProfileForm` zod-схема (поле `showRouteRides: z.boolean()`), `FIELDS` + `'showRouteRides'`
  (`serverFieldErrors`), `fieldText` (в ветке `name-consent-prompt` переезжает в `profile-field-errors.ts` — §8).
- Запрещено: считать места/ничьи/«лучший» на клиенте, фильтровать строки по согласию, кэшировать таблицу вне
  TanStack Query, показывать дату с временем суток, новый пакет, прямой `fetch`.

## 6. Relevant Files

- Клиент API: `packages/api-client/src/index.ts` (`getRouteRideLeaderboard`, `RouteRideLeaderboardParams`).
- Контракты: `packages/contracts/src/route-rides/route-ride.schema.ts` (`RouteRideLeaderboard`, `…Row`, `…Me`,
  `ROUTE_RIDE_LEADERBOARD_MAX`), `packages/contracts/src/profile/profile.schema.ts` (`ProfileView.showRouteRides`,
  `UpdateProfileRequest`, `ROUTE_RIDES_CONSENT_VERSION`).
- Заезд по маршруту: `apps/app/src/features/route-rides/{queries.ts,route-ride-format.ts,route-rides-block.tsx,route-ride-pick.tsx}`,
  `apps/app/src/app/routes/pick/[routeId].tsx` (образец экрана).
- Карточка: `apps/app/src/features/routes/route-detail.tsx`.
- Таблицы гонок: `apps/app/src/features/races/{table-row.tsx,results-table.tsx,participation-format.ts}`.
- Профиль: `apps/app/src/features/profile/{profile-form.tsx,queries.ts}`, `apps/app/src/app/settings/profile.tsx`.
- Маршрутизация/SEO: `apps/app/src/app/_layout.tsx`, `apps/app/src/lib/seo.ts`,
  `apps/app/src/app-routes-manifest.server.test.ts`, `apps/app/src/__tests__/{app-routes.ts,seo-routes.test.ts}`.
- Даты: `apps/app/src/lib/minsk-format.ts`, `packages/i18n/src/format.ts`.
- Тесты-образцы: `apps/app/src/__tests__/{route-rides-block.test.tsx,route-detail.test.tsx,route-ride-pick.test.tsx,profile-screen.test.tsx,route-rides-fixtures.ts}`,
  `apps/app/e2e/web.spec.ts` (route-rides-02: строки ~646 и ~1230–1342).
- Правила/доки: `.claude/rules/pokatim-app.md` («Заезд по маршруту», «Профиль райдера»), `pokatim-tests.md`,
  `docs/product/{routes,profile}.md`.

## 7. Implementation Notes

Contracts-first уже выполнен (PR A). TDD; отдельный коммит на шаг. Ветка от `develop` после слияния PR A. Jest —
только затронутые наборы на каждом шаге; полный `pnpm check` (`TURBO_CONCURRENCY=4`) — перед PR.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` Раскладка блока (5 строк + своя отдельно), «Видно только вам» / «Включить показ», адрес
  `/routes/others/<id>`, место переключателя и текст пояснения, `limit` 5/100.
- **Порядок выкладки.** PR B нельзя сливать раньше выкладки PR A на dev: форма шлёт `showRouteRides` → старый API
  `400` на каждое сохранение профиля. Проверка перед мержем: `GET /v1/profile` на dev отдаёт `showRouteRides`.
- **Конфликт с `name-consent-prompt`.** Локальная ветка `claude/name-consent-prompt-e0b1f8` (коммиты `9e830e80`,
  `2219fbcc`, 2026-10-31, в `origin/develop` и в PR ещё нет) правит `features/profile/profile-form.tsx` (импорты,
  вынос `fieldText` в `profile-field-errors.ts`), а также `docs/product/profile.md`, `.claude/rules/pokatim-app.md`,
  `pokatim-contracts.md`, `pokatim-security.md`, `__tests__/profile-screen.test.tsx` и добавляет миграцию `0048`.
  Риск — текстовый конфликт (низкий в коде: правки в разных местах файла; средний в доках/правилах). Митигация:
  перед стартом `git log origin/develop -- apps/app/src/features/profile/` — если она уже в `develop`, начинать от
  неё; правку формы делать точечно (блок `View` после `showNameInResults`, `FIELDS`, схема, `valuesOf`), импорт
  `fieldText` не трогать. Её шит согласия шлёт частичный `PATCH` (`publicName`, `showNameInResults`) — с
  `showRouteRides` не конфликтует; инвалидация таблиц в `useUpdateProfile.onSuccess` (RC-B6) покроет и его.
- Риск ПДн: день заезда + маршрут; клиент показывает только поля ответа, без времени суток, без логов.
- Без согласия у зрителя места остальных сдвинуты на 1 (O4) — ожидаемо, текст «Видно только вам» это объясняет.

## 8.1 Requirements Consistency (заполняет architect)

Блокеров нет. Решения §3 согласованы с API PR A и инвариантами; уточнения по коду (рекомендация — (a), принята в §11):

- **RC-B1 — своя строка в `rows` vs `me`.** API кладёт зрителя и в `rows` (если в `limit`, RC-3 PR A), и в `me`.
  (a) **рекомендация:** своя в `rows` ↔ `rows.some(r => r.rideId !== null)`; отдельная строка `me` — только если её нет
  в `rows` (иначе дубль); (b) всегда рисовать `me` отдельно и выкидывать из `rows` — ломает порядок мест;
  (c) сравнивать по `place` — хрупко.
- **RC-B2 — «Все (N)» и пустой блок.** `total` включает зрителя. (a) **рекомендация:** «Все ({total})» при
  `total > rows.length`; пусто — `rows.length === 0 && me === null` (при `me` без других строк блок показывает одну
  свою строку с «Видно только вам», если `!shared`); (b) скрывать блок при пусто — нарушает §4.12 (нет пустого
  состояния) и прячет фичу.
- **RC-B3 — 404 у маршрута без длины.** `catalogRoute` отдаёт `null` при `distanceM === null` → `404`, хотя карточка
  открыта. (a) **рекомендация:** 404 → `null` → блока нет (как «Мои заезды», `useRouteRides`); (b) показывать ошибку —
  ложный «Не удалось загрузить».
- **RC-B4 — «Включить показ».** Согласие должно быть информированным (текст пояснения рядом с переключателем, версия
  текста в журнале). (a) **рекомендация:** переход на `/settings/profile` (там переключатель с пояснением и
  «Сохранить»); (b) включать прямо из блока `PATCH { showRouteRides: true }` — согласие без показа текста версии,
  отклонено; (c) шит с текстом и кнопкой (как `name-consent-prompt`) — follow-up, если конверсия низкая.
- **RC-B5 — адрес экрана.** `app/routes/others/[routeId].tsx` (параметр `routeId`, как `pick`). Ветка «others» не
  пересекается с `routes/[id]` (2 сегмента против 3), но манифест SSR сортирует иначе, чем клиент — строка
  `[/routes/others/${ID}, '/routes/others/[routeId]']` в сторож обязательна. Побочный эффект: e2e route-rides-02
  проверяет чанк `/[routeId]-<hash>.js` на `/routes/pick/…` — после PR оба экрана дают чанк с таким именем, проверка
  выбора теряет различающую силу; порядок держит jest-сторож манифеста, e2e не менять (отметить в комментарии).
- **RC-B6 — инвалидация таблицы.** Ключ `['route-rides', routeId, 'leaderboard', limit]` (под префиксом
  `route-rides` — стирается при выходе вместе с остальным кэшем). (a) **рекомендация:** экспорт
  `invalidateRouteRideLeaderboards(queryClient)` (предикат `key[0] === 'route-rides' && key[2] === 'leaderboard'`),
  вызов в `useUpdateProfile.onSuccess` (меняются `shared` и имя своей строки) и `routeRidesKeys.leaderboardAll(routeId)`
  рядом с инвалидацией `list` в `useCheckRouteRide.onSuccess` и в эффекте финального статуса `useRouteRide`;
  (b) инвалидировать весь `['route-rides']` — перезапросит списки и детали без нужды; (c) полагаться на
  `staleTime` 10 с — после «Сохранить» и «назад» таблица до 10 с показывает старое `shared`. Опроса у таблицы нет.
  Заезд, ставший пройденным при опросе списка на самой карточке (без экрана результата), обновит таблицу только
  по pull-to-refresh/устареванию — принято (в эффекте карточки при смене `rides.data.summary.best?.id` можно
  инвалидировать — `[ASSUMPTION]`, делать).
- **RC-B7 — `limit` блока.** 5 = `VISIBLE_ROWS` «Моих заездов» по смыслу («строк на карточке»). (a)
  **рекомендация:** отдельная константа `OTHERS_CARD_ROWS = 5` в `route-ride-format.ts` (смыслы разные, менять
  независимо); экран — `ROUTE_RIDE_LEADERBOARD_MAX` из contracts.
- **RC-B8 — версия согласия.** Текст `profile.routeRides.*` = версия `ROUTE_RIDES_CONSENT_VERSION` (`2026-10-31`).
  Тексты §3 п. 1 — ровно те, под которые выпущена версия в PR A; правка текста в ревью → поднять версию в contracts
  (отдельный коммит, как комментарий у `profile.show.*`). В `ru.ts` — такой же комментарий над ключами.
- **RC-B9 — тесты с автомоком `api`.** `jest.mock('@/lib/api')` даёт `getRouteRideLeaderboard → undefined` — во всех
  наборах, рендерящих карточку вошедшему (`route-detail.test.tsx`, `route-rides-block.test.tsx`, …), нужен
  `mockResolvedValue(leaderboard())` в `beforeEach`, иначе TanStack пишет ошибку «data is undefined» в консоль.
  Тела `PATCH` в `profile-screen.test.tsx` получают `showRouteRides`.

Противоречий с инвариантами AGENTS §4 нет: серверный авторитет (места, `me`, `shared`, имена — сервер), §4.12
(скелетон, ошибка/пауза, пусто, устарело), §4.13 (общие RN-компоненты, без развилок), i18n — в пакете.

## 8.2 Deviations from spec

- **«Все (N)» и сноска — `othersTruncated`, не `total > rows.length` (RC-B2).** `total` включает зрителя: при своей
  строке вне `rows` (`me`) все строки уже видны, а `total > rows.length` дал бы ложное «Все (1)» у единственной своей
  строки и сноску на экране. Условие: `total > rows.length + (me отдельно ? 1 : 0)`; unit-тест в
  `route-ride-format.test.ts`. Смысл RC-B2 (показать вход, когда сервер отдал не всех) сохранён.
- **Возврат с экрана — `routeCardPath(routeId, false)`** вместо `routePath` из `routes/route-detail.tsx`: тот же адрес,
  уже есть в `route-ride-format.ts` (как у экрана выбора); импорт экрана карточки ради строки не нужен.
- **Строки — общий `OthersRows`** (своя отдельно + «Включить показ» + пусто) в `route-ride-others-rows.tsx` для блока и
  экрана; `OthersRow`/`OthersMeRow` — один внутренний `OthersRowItem` с флагом `separated`. Подпись «Видно только вам»
  добавлена и в метку кнопки своей строки (скринридер).
- **Вне scope, но нужно для зелёного typecheck:** `__tests__/home.test.tsx` — в фикстуре профиля не хватало
  `showRouteRides` (ошибка TS после слияния PR A в develop); добавлено `showRouteRides: false`.
- Шаги §11 5 и 6 закоммичены раздельно (переключатель; e2e + доки + pr-b.md). Полный `pnpm check` не запускался —
  решение пользователя; вместо него — таргетные проверки (§12).

## 8.3 Security checklist

Зона — `pokatim-security.md` (заезд по маршруту, профиль/согласия) и ПДн чужих райдеров на экране: чек-лист обязателен.

- **AuthN/AuthZ.** Запрос — только `withAccessToken`, только `signedIn` на клиенте; экран `/routes/others/[routeId]` —
  в `Stack.Protected` (гость → гард); права и видимость маршрута — только сервер (404 → блока нет / «Маршрут
  недоступен»).
- **Входные данные.** `routeId` из URL — `Uuid.safeParse` до запроса (невалидный — «Маршрут недоступен» без запроса);
  `limit` — константы (5 / `ROUTE_RIDE_LEADERBOARD_MAX`), не из URL. Форма — схема contracts.
- **Данные наружу / ПДн.** Показываются только поля ответа: имя/фото/ссылка — только если сервер их отдал (P1/R4);
  день — без времени суток; своей `rideId` — только для перехода. Нет SSR, OG и `generateMetadata` у экрана;
  `DocumentTitle` — без имён («Другие на маршруте — Покатим»); подписи a11y — только поля строки. Ничего из строк — в
  `console.*`, Sentry-контекст, URL и `localStorage`.
- **Кэш.** Только TanStack Query под `['route-rides', …]` (стирается `queryClient.clear()` при выходе); без
  persist; ответ сервера — `no-store`.
- **SEO.** `/routes/others/` — в `SEO_DISALLOW` (экран только вошедшим), сторож `seo-routes.test.ts`.
- **Согласие.** Включение — только явным действием пользователя в форме с текстом пояснения (RC-B4); версия —
  сервер; клиент шлёт только флаг. По умолчанию — выключено (значение из `ProfileView`).
- **Злоупотребления.** Нет опроса; запросы — по монтированию/фокусу/pull-to-refresh/инвалидации (лимит сервера 300/ч,
  `429` — общий текст ошибки с повтором).

## 9. Acceptance Criteria

1. В «Редактировать профиль» под «Показывать имя…» есть переключатель «Показывать мои заезды в таблицах маршрутов» с
   пояснением; «Сохранить» шлёт `showRouteRides`; после сохранения значение из ответа сервера.
2. Вошедший на карточке маршрута каталога видит «Другие на маршруте» после «Мои заезды»: до 5 строк (место, кто,
   время, день), своя — «Вы»; своя вне 5 — отдельной строкой со своим местом.
3. Без согласия у своей строки — «Видно только вам» и «Включить показ» → `/settings/profile`; после включения и
   возврата подпись исчезает без ручного обновления.
4. «Все (N)» → `/routes/others/<id>`: до 100 строк, своя вне списка — отдельно, сноска при `total > 100`.
5. Состояния: скелетон, ошибка/нет сети с повтором, устарело, пусто; 404 — блока нет / «Маршрут недоступен»;
   гость и SSR — блока нет, экран — гард входа.
6. Строки публичных райдеров ведут на их профиль, «Участник» не нажимается, своя — на результат своего заезда.
7. iOS, Android, web/PWA; тесты, lint, typecheck, сторожа манифеста и SEO зелёные; CI зелёный.

## 10. Documentation Impact

- `docs/product/routes.md` — O1–O5: «Приложение — PR B» → сделано (блок, экран, переключатель, «Видно только вам»).
- `docs/product/profile.md` — раздел «Показ заездов в таблицах маршрутов»: место переключателя и текст (версия
  `2026-10-31`).
- `.claude/rules/pokatim-app.md` — «Заезд по маршруту»: блок «Другие на маршруте» (только `signedIn`, ключ
  `['route-rides', id, 'leaderboard', limit]`, 404 → нет блока, инвалидация после `PATCH` профиля и проверки), экран
  `routes/others/[routeId]` в `Stack.Protected` + строка сторожа манифеста; строки — `TableRow`/`RiderWho`;
  «Профиль райдера»: переключатель `showRouteRides` (текст = версия согласия).
- `docs/tasks/2026-10-31-route-rides-04-others/pr-b.md`.

## 11. Implementation Context (заполняет architect)

Status: **APPROVED** (уточнения — §8.1 RC-B1…RC-B9; блокеров нет; условие мержа — PR A на dev, риск конфликта с
`name-consent-prompt` — §8).

### ENTRY POINTS

- Карточка `/routes/<id>` → `RouteDetailScreen` → `RouteSheetBody` → `RouteRideOthersBlock` (после `RouteRidesBlock`).
- Экран `/routes/others/<routeId>` → `app/routes/others/[routeId].tsx` → `RouteRideOthersScreen`.
- `/settings/profile` → `ProfileFormView` (переключатель).
- Запрос: `useRouteRideLeaderboard(routeId, limit, enabled)` → `api.getRouteRideLeaderboard`.

### FILES TO MODIFY

- `packages/i18n/src/ru.ts` — ключи (комментарий о версии над `profile.routeRides.*`):
  `profile.routeRides.label` «Показывать мои заезды в таблицах маршрутов»; `profile.routeRides.hint` «Другие райдеры
  увидят ваше время и день заезда на маршрутах каталога. Имя и фото — только если включён показ имени.»;
  `routes.others.kicker`/`routes.others.title` «Другие на маршруте»; `routes.others.empty` «Пока никто не поделился
  заездами на этом маршруте»; `routes.others.failed` «Не удалось загрузить таблицу»; `routes.others.all` «Все
  ({count})»; `routes.others.onlyYou` «Видно только вам»; `routes.others.enable` «Включить показ»;
  `routes.others.truncated` «Показаны лучшие {shown} из {count}»; `routes.others.rowA11y` «{place}, {who}, {time},
  {date}»; `routes.others.profileA11y` «Профиль райдера, {who}, {place}, {time}, {date}»; `routes.others.ownA11y` «Ваш
  заезд, {place}, {time}, {date}».
- `apps/app/src/features/route-rides/queries.ts` — `routeRidesKeys.leaderboardAll(routeId)` =
  `['route-rides', routeId, 'leaderboard']`, `leaderboard(routeId, limit)` = `[...leaderboardAll, limit]`;
  `useRouteRideLeaderboard(routeId, limit, enabled)` (404 → `null`, `DEFAULT_STALE_MS`, без опроса);
  `invalidateRouteRideLeaderboards(queryClient)`; в `useCheckRouteRide.onSuccess` и эффекте финального статуса
  `useRouteRide` — `invalidateQueries({ queryKey: routeRidesKeys.leaderboardAll(routeId) })`.
- `apps/app/src/features/route-rides/route-ride-format.ts` — `OTHERS_CARD_ROWS = 5`; `routeRideOthersPath(routeId)`
  (`/routes/others/<id>`); `rideDayText(rideDate, now)`; `leaderboardRowView(row, now)` → `{ own, place, who, time,
  day, a11y, profileA11y }` (`own = row.rideId !== null`); `leaderboardMeView(me, now)`; `ownInRows(rows)`.
- **новый** `apps/app/src/features/route-rides/route-ride-others-rows.tsx` — `OthersRow` (`TableRow` + место +
  `RiderWho` (`note` = «Видно только вам» у своей при `!shared`) + время/день; действие — `useRowAction(own ?
  { label: ownA11y, onPress: → routeRidePath } : null, row.riderPublicId, profileA11y)`), `OthersMeRow` (своя вне
  списка, разделитель сверху), `EnableShareAction` (`TextAction` «Включить показ» → `router.push('/settings/profile')`).
- **новый** `apps/app/src/features/route-rides/route-ride-others-block.tsx` — `RouteRideOthersBlock({ routeId,
  board, now })`: `board === null` (гость/SSR) или `data === null` (404) — ничего; `Kicker` + `RowsSkeleton` /
  `TabFailure` / баннер «устарело» / пусто / строки / своя отдельно / «Включить показ» / «Все ({total})».
- **новый** `apps/app/src/features/route-rides/route-ride-others.tsx` — `RouteRideOthersScreen({ routeId })`:
  `DetailHeader` (заголовок `routes.others.title`, `fallback` — `routePath(routeId)`), `DocumentTitle`, невалидный id
  / 404 — `EmptyState` «Маршрут недоступен» + «Все маршруты» → `/routes`; `AsyncContent` (скелетон `RowsSkeleton`);
  pull-to-refresh; сноска `truncated`.
- **новый** `apps/app/src/app/routes/others/[routeId].tsx` — как `routes/pick/[routeId].tsx` (`useSettingsShell`).
- `apps/app/src/app/_layout.tsx` — `<Stack.Screen name="routes/others/[routeId]" />` в первом `Stack.Protected`
  рядом с `routes/pick/[routeId]`.
- `apps/app/src/lib/seo.ts` — `'/routes/others/'` в `SEO_DISALLOW`.
- `apps/app/src/features/routes/route-detail.tsx` — `othersEnabled = valid && signedIn && hasRoute`;
  `useRouteRideLeaderboard(id, OTHERS_CARD_ROWS, othersEnabled)`; `dataUpdatedAt` в `useMinskClockAfterMount`;
  `refetch` в `refetchers` (при `hasRoute && signedIn`); проп `others` в `RouteSheetBody` (`null` — без блока);
  эффект: смена `rides.data?.summary.best?.id` → инвалидация `leaderboardAll(id)` (RC-B6); doc-комментарий тела.
- `apps/app/src/features/profile/profile-form.tsx` — схема/`valuesOf`/`FIELDS` + `showRouteRides`; блок `View`
  (`Toggle` `profile.routeRides.label`, пояснение `profile.routeRides.hint`, ошибка поля) сразу после блока
  `showNameInResults`.
- `apps/app/src/features/profile/queries.ts` — `useUpdateProfile.onSuccess` + `invalidateRouteRideLeaderboards`.
- Тесты-сторожа: `apps/app/src/app-routes-manifest.server.test.ts` (`[/routes/others/${ID}, '/routes/others/[routeId]']`),
  `apps/app/src/__tests__/app-routes.ts` (`'routes/others/[routeId]'`).
- Доки/правила — §10 (последний коммит).

### FILES TO READ

`AGENTS.md` §4 (1, 11–13); `.claude/rules/pokatim-app.md` («Заезд по маршруту», «Профиль райдера», «Маршруты»),
`pokatim-tests.md`; `features/route-rides/{route-rides-block.tsx,queries.ts,route-ride-pick.tsx}`;
`features/races/{table-row.tsx,results-table.tsx}` (`ResultRow`, `RowsSkeleton`, `TabFailure`, `loading`);
`features/races/participation-format.ts` (`resultRow`, `profileWho`); `features/routes/route-detail.tsx`;
`__tests__/route-rides-block.test.tsx` (образец рендера карточки вошедшему); PR A task §3, §8.1 (RC-3: своя в `rows`),
§11 TYPES.

### TYPES & SCHEMAS

Только существующие (PR A): `RouteRideLeaderboard { rows, total, me, shared }`, `RouteRideLeaderboardRow { place,
elapsedSec, rideDate: LocalDate, riderName, riderPublicId, riderAvatar, rideId }`, `RouteRideLeaderboardMe { place,
elapsedSec, rideDate, rideId }`, `ProfileView.showRouteRides`, `UpdateProfileRequest.showRouteRides`,
`ROUTE_RIDE_LEADERBOARD_MAX`. Новых схем нет.

```ts
// route-ride-format.ts
export const OTHERS_CARD_ROWS = 5;
export const routeRideOthersPath = (routeId: string): Href =>
  `/routes/others/${encodeURIComponent(routeId)}` as Href;
export const rideDayText = (rideDate: string, now: Date | null) =>
  heroDateText(formatLocalRange(rideDate, rideDate, now));
export interface OthersRowView {
  own: boolean; place: string; who: string; time: string; day: string;
  a11y: string; profileA11y: string | null; ownA11y: string | null;
}
export function leaderboardRowView(row: RouteRideLeaderboardRow, now: Date | null): OthersRowView;
export function leaderboardMeView(me: RouteRideLeaderboardMe, now: Date | null): OthersRowView;
// queries.ts
export function useRouteRideLeaderboard(routeId: string, limit: number, enabled: boolean):
  UseQueryResult<RouteRideLeaderboard | null>;
export function invalidateRouteRideLeaderboards(queryClient: QueryClient): Promise<void>;
```

### TESTS

Unit (jest):
- `features/route-rides/route-ride-format.test.ts` — `leaderboardRowView`: своя (`rideId`) — «Вы», `ownA11y`,
  `profileA11y` по имени (`profileWho`); чужая с именем и `riderPublicId` — имя и `profileA11y`; без карточки —
  «Участник», `profileA11y: null`; день — «4 октября» в текущем году, с годом в прошлом и при `now = null`;
  `leaderboardMeView`; `routeRideOthersPath` кодирует id; `ownInRows`.

Компонентные (`expo-router/testing-library`, автомок `api`):
- **новый** `__tests__/route-ride-others.test.tsx` — блок на карточке вошедшему: скелетон; 5 строк и «Все (N)» при
  `total > 5`, нет ссылки при `total <= rows.length`; своя в `rows` — без отдельной строки; своя вне `rows` — отдельной
  строкой с `me.place`; `shared: false` — «Видно только вам» + «Включить показ» → `/settings/profile`; `shared: true` —
  без них; пусто — текст; 404 → блока нет; ошибка → баннер + «Повторить» перезапрашивает; ошибка обновления при данных
  — строки + «устарело»; пауза без сети — «Нет соединения» (не вечный скелетон); гость — запроса нет; порядок блоков
  «Мои заезды» → «Другие на маршруте» → «Гонки»; запрос `limit: 5`; нажатие: публичная строка → `/riders/<publicId>`,
  своя → результат заезда, «Участник» — не нажимается (нет роли).
  Экран: `limit: 100`; сноска при `total > rows.length`; невалидный id — «Маршрут недоступен» без запроса; 404 — то
  же; гость — гард; pull-to-refresh перезапрашивает.
- Инвалидация: `useUpdateProfile` успех → `leaderboard` помечен `isInvalidated`, `list` — нет;
  `useCheckRouteRide` успех и финальный статус `useRouteRide` → `leaderboardAll(routeId)` инвалидирован
  (в `route-ride.test.tsx`/`route-ride-pick.test.tsx` рядом с проверками `list`).
- `__tests__/profile-screen.test.tsx` — переключатель под «Показывать имя…», начальное значение из `ProfileView`,
  «Сохранить» шлёт `showRouteRides`, ошибка поля `showRouteRides` (`INVALID`) — под переключателем; обновить точные
  тела `PATCH` (RC-B9).
- `__tests__/route-detail.test.tsx`, `__tests__/route-rides-block.test.tsx` и прочие наборы карточки вошедшему —
  `getRouteRideLeaderboard.mockResolvedValue(...)` в `beforeEach` (RC-B9); фикстуры — `route-rides-fixtures.ts`
  (`leaderboard()`, `leaderboardRow()`).
- Сторожа: `app-routes-manifest.server.test.ts` (новая строка), `seo-routes.test.ts` (проходит с `SEO_DISALLOW`),
  `theme-guards.test.ts` (без сравнений с темой).

E2E (`apps/app/e2e/web.spec.ts`, Playwright):
- `/routes/others/<UNKNOWN_ROUTE_ID>` без сессии — `200`, HTML без данных, после гидрации — гард (строка в цикле
  route-rides-02 с комментарием RC-B5 о неразличимом чанке `[routeId]`).
- Вошедший (`WITH_API`) на карточке маршрута каталога — «Другие на маршруте» видно; гостю и в SSR-HTML — нет.

Порядок шагов (TDD, коммит на шаг; после шага — jest затронутых наборов, typecheck `@pokatim/app`):
1. i18n-ключи + форматтеры `route-ride-format.ts` (unit).
2. `queries.ts`: ключи, `useRouteRideLeaderboard`, инвалидации (тесты инвалидации).
3. Строки + блок + встраивание в карточку (компонентные; моки в старых наборах).
4. Экран + маршрут + `_layout`/`seo`/`app-routes`/сторож манифеста.
5. Переключатель в форме + инвалидация в `useUpdateProfile`.
6. e2e-строки; docs/rules/pr.md; полный `pnpm check` (`TURBO_CONCURRENCY=4`) перед PR.

### OUT OF SCOPE

API/контракты/api-client; таблица у «Моих маршрутов»; гостевой доступ/SSR/OG таблицы; курсор и догрузка сверх 100;
участки (route-rides-05); включение согласия без перехода в профиль (шит — follow-up, RC-B4); уведомления; трек
чужого заезда; жалобы; фильтры.

## 12. Outcome (заполняет coder)

Статус: реализовано по §11, шаги 1–6 (коммиты `61c8fd11`, `b108c18a`, `dfffa85e`, `ce54d912`, `205f53bb` + последний —
e2e, доки, pr-b.md). Отклонения — §8.2.

Файлы: `features/route-rides/{route-ride-format.ts,queries.ts,route-ride-others-rows.tsx,route-ride-others-block.tsx,
route-ride-others.tsx}`, `app/routes/others/[routeId].tsx`, `features/routes/route-detail.tsx`,
`features/profile/{profile-form.tsx,queries.ts}`, `app/_layout.tsx`, `lib/seo.ts`, `packages/i18n/src/ru.ts`; тесты —
`__tests__/route-ride-others.test.tsx` (новый, 26), `route-ride-format.test.ts`, `profile-screen.test.tsx`,
`route-ride(-pick).test.tsx`, `route-detail.test.tsx`, `route-rides-block.test.tsx`, `app-routes.ts`,
`protected-shell.test.tsx`, `app-routes-manifest.server.test.ts`, `home.test.tsx`; e2e — `e2e/web.spec.ts`.

Проверки (2026-11-01):
- `pnpm --filter @pokatim/app typecheck` — 0 ошибок.
- jest затронутых и соседних наборов (карточка, «Мои заезды», результат, выбор, профиль, сторожа манифеста/SEO/оболочки,
  темы, `features/{route-rides,profile,routes}`) — 39 наборов, 515 тестов, зелёные; все наборы на `__tests__/app-routes.ts`
  — 53 набора, 924 теста, зелёные.
- `pnpm --filter @pokatim/i18n test` — 2 файла, 16 тестов, зелёные.
- eslint затронутых путей — 0 замечаний; `pnpm format:check` — чисто; `pnpm arch:check` — 0 нарушений.
- TDD: тесты форматтеров, инвалидаций, блока и формы профиля падали до реализации (красный → зелёный).
- NOT VERIFIED: полный `pnpm check` (решение пользователя; CI — полный), e2e `pnpm e2e:web` (нужны сборка web и API),
  ручная проверка на iOS/Android/web, AC7 «CI зелёный» — после push.

Исправления ревью (2026-11-01, `findings-b.md`; коммит `a84a650a`):
- M1 — `useBestRideChange` получает `undefined` (список не загружен) / `null` (лучшего нет или 404) / `id`; переходы
  `null → id`, `id → null`, `id → id'` инвалидируют `leaderboardAll`, первая загрузка — нет.
- Фокус — `useRouteRideLeaderboard`: `subscribed: useIsFocused()`, как у `useRouteRides`.
- L2 — `othersShown` (строки + своя вне `rows`) — число сноски и основа `othersTruncated`.
- L1 — пути task/pr в шапке и §10.
- Тесты (`route-ride-others.test.tsx` +4, `route-ride-format.test.ts` +1): опрос `best: null → {id}` перезапрашивает
  таблицу `limit 5`; первая загрузка — без перезапроса; возврат на экран после `DEFAULT_STALE_MS` — перезапрос
  (без `subscribed` — красный, проверено); сноска 101 из 240 со своей строкой и 100 из 240 без неё. До исправления
  красные: опрос, сноска, фокус.
- Проверки: `pnpm --filter @pokatim/app typecheck` — 0; jest `route-ride-others`, `route-detail`, `profile-screen`,
  `route-rides-block`, `route-ride`, `features/route-rides` — 7 наборов, 171 тест, зелёные; eslint и prettier
  изменённых файлов — чисто.
