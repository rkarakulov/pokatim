# 1. Title

Приложение, блок 02: Главный экран — лента разделов «Гонки» и «Календарь стартов» на read-модели admin-02,
персонализация порядка по опросу «Что вас привело?», состояния загрузки/пусто/ошибка/офлайн, обновление

# 2. Goal

Вошедший райдер «Покатим» (iOS, Android, web/PWA) после онбординга видит на вкладке «Главная» не заготовку, а ленту
разделов в одном спокойном ритме: на каждый раздел — шапка (кикер + заголовок), одна главная карточка (герой) и
ссылка «Все …» в свою вкладку. Разделы, отмеченные в опросе, стоят первыми с пометкой «по вашему выбору». Данные —
только опубликованное, через публичную read-модель admin-02; пока данных нет (dev, начало сезона) — пустые
герои разделов, а не пустой экран.

Источники: прототип «02 Главный экран» (`key-home`, конфиденциален — краткая карта в Приложении A), смежные
`key-races` (03), `key-rides` (05), `key-calendar` (09); `docs/product/onboarding.md` (коды `RideReason`);
`AGENTS.md` §1, §4.1, §4.7, §4.11–4.13; `.claude/rules/{app,pokatim-app,contracts,pokatim-contracts}.md`;
ADR-0003, ADR-0008; **`docs/tasks/2026-10-26-admin-02-seasons-races/task.md`** — модель сезонов, гонок, стартов
календаря, публичные `GET`, `tolerantEnum`, `contracts/src/time.ts` и §13 «Для блока 02» (зона того задания).

# 3. Scope

**Главная (`apps/app`, все платформы)**
- Экран `(tabs)/index.tsx`: верхняя панель (словесный знак «Покатим»), лента разделов, внизу — временные «Выйти» и
  dev-ссылка на витрину (как сейчас, до экрана профиля — Q8). `ScrollView` с pull-to-refresh (native), `DocumentTitle`.
- Реестр разделов `features/home/sections.ts`: `races` («Гонки»), `calendar` («Календарь стартов»); `rides` и
  `routes` в реестре **отсутствуют** до своих блоков (Q1, Q2). Порядок — чистая функция
  `orderHomeSections(available, reasons)` (R4).
- **Раздел «Гонки»** (`api.listRaces({ scope: 'current', limit: 1 })`): шапка `SectionHeader` (кикер «Гонки», тег
  «по вашему выбору» при подъёме, заголовок «Ближайшие гонки»); герой — кикер «Окно гонки», даты окна крупно
  («4–12 октября»), название, мета «{distanceKm} км · {покрытия}», строка жизненного цикла по `phase`
  (§7) в Europe/Minsk; «Все гонки» → вкладка «Гонки». Пусто — пустой герой «Пока нет открытых гонок» + действие
  «Календарь стартов» → вкладка «Календарь».
- **Раздел «Календарь стартов»** (`api.listCalendar({ limit: 1 })`, `from` — сервер, сегодня по Минску): кикер
  «Календарь», заголовок «Ближайшие старты»; герой — кикер «Ближайший старт», дата крупно («14 июня 2027», многодневный
  — «26–27 июня»), название, мета «{дистанции} · {дисциплина} · {город}» («80 и 120 км»), строка «До старта N дн.»
  и, если есть `registrationUrl`, «Регистрация у организатора» (текстом, без перехода — Q6); «Все старты» → вкладка
  «Календарь». Пусто — «Пока нет стартов в календаре» [ASSUMPTION].
- Состояния (§4.12): шапки разделов видны сразу, скелетон — только на месте героя (`SkeletonHeroCard`); ошибка без
  данных — «Нет соединения» / «Не удалось загрузить» + «Повторить» **в слоте раздела** (остальные работают); ошибка
  обновления при данных — баннер `AsyncContent` над героем; пусто — пустой герой раздела.
- Обновление: pull-to-refresh (native) — `refetch` запросов Главной; фокус вкладки браузера / возврат приложения из
  фона — `refetchOnWindowFocus` (web — штатно, native — `focusManager` на `AppState`, R7); `staleTime` 60 с
  (сервер отдаёт `public, max-age=60`).
- Персонализация: ответы опроса — новый `GET /v1/profile` (под `AuthGuard`); не загрузились — базовый порядок без
  ошибки на экране (R4).

**Read-API — покрывает admin-02 (S1 контракты + `createApiClient`, S7 эндпоинты), здесь не реализуется**
- `GET /v1/races?scope=current&limit=1` → `RacePage` (`RaceCard`), `GET /v1/calendar?limit=1` → `CalendarPage`
  (`CalendarStartCard`), `GET /v1/seasons/current` (Главной не нужен — Q3). Сверка требований — §7, таблица.

**Профиль (`apps/api` модуль `profile`, contracts, api-client)**
- `GET /v1/profile` → `ProfileView { rideReasons }` — под `AuthGuard`, `no-store`; терпим к новым кодам (R5).
- `api.getProfile(accessToken)`; в app — `useRideReasons()` через `withAccessToken`.

**E2E/docs** — шаг смоука web с API (Главная после онбординга: шапки разделов и пустые герои; с опубликованной гонкой
и стартом — герои), §10.

# 4. Out of Scope

Будущие блоки прототипа Главной — скрыть, без заглушек «скоро» (Q1, Q2):
- раздел «Маршруты» (герой route-line, полоса покрытия с легендой, «старт в N км от вас», «Все маршруты») — блок
  маршрутов;
- раздел «Кофе-райды» (фото организатора, стопка аватаров «идут N», «Я иду», «Все райды») — блок 05, модуль `rides`;
- колокольчик со счётчиком (in-app уведомления) — блок уведомлений;
- аватар «Личная линия» → профиль — блок профиля (до него «Выйти» внизу Главной, Q8);
- «Участвовать» на герое гонки, переход в карточку гонки/старта, кнопка-ссылка на регистрацию у организатора —
  блоки 03/09 (Q6);
- фото-обложки (нет `media`, в `RaceCard` поля нет) — всегда типографский герой;
- баннер «Включите геопозицию, чтобы видеть райды рядом» и любые «рядом» — с фичей «рядом» (`onboarding.md`);
- сезон, таблица сезона, рейтинг, достижения (Q3); плашка «Verified — ждём трек» (нет участия);
- гостевая Главная и SSR с данными (R6); предустановка класса из профиля (OQ40 `key-races`);
- модель, запись и публичное чтение сезонов/гонок/календаря — admin-02; изменения app-foundation (кандидаты — §5.1).

# 5. Architecture Context

- **app:** экран `src/app/(tabs)/index.tsx`; фича `src/features/home/` — `sections.ts` (реестр, порядок),
  `queries.ts` (`useNextRace`, `useNextCalendarStart`, `useRideReasons`), `format.ts` (подписи окна и дат через
  `utcToMinskWallTime`/`minskToday` из contracts admin-02); продуктовые компоненты
  `src/components/{top-bar,section-hero}.tsx`; `src/lib/focus-manager(.web).ts` (R7), подключение рядом с
  `connectOnlineManager()` в корневом `_layout.tsx`. Гарды не меняются: Главная — внутри `(tabs)`, запросы — только из
  смонтированного экрана (сессия есть, онбординг пройден).
- **api, profile:** `profile.controller.ts` (`@Controller('profile')`, `@UseGuards(AuthGuard)`, `GET`) →
  `ProfileService.view(userId)` → `ProfileRepository.findReasons(userId)` (projection `rideReasons`). Миграций нет.
- **api, races / calendar:** владеет admin-02 (`modules/races`, `modules/calendar`, публичные контроллеры). Эта задача
  их код не трогает. Агрегата `GET /v1/home` нет (R3).
- **contracts:** новый `src/profile/profile.schema.ts` (`ProfileView`). Схемы гонок/календаря, `tolerantEnum`,
  `time.ts` — admin-02 S1 (потребляем). Только добавления.
- **Очереди/outbox:** нет. **Миграции:** нет (номера 0006–0008 заняты admin-02, R13 там).
- **Порядок слияния:** S1–S3 этой задачи независимы от admin-02; S4 — после слияния admin-02 S1 (контракты, клиент,
  `time.ts`, строки `domain.*`) и S7 (эндпоинты) в `develop`.

# 5.1 Placement & Reuse Gate

- **Переиспользуем:** admin-02 — `createApiClient.listRaces`/`listCalendar`, `RaceCard`/`RacePage`/
  `CalendarStartCard`/`CalendarPage`, `tolerantEnum` (значение `'unknown'`), `utcToMinskWallTime`, `minskToday`,
  `PLATFORM_TIME_ZONE`, строки `domain.surface.*`/`domain.discipline.*`/`domain.bikeClass.*` (`ru.ts`, admin-02 S8);
  `@rkarakulov/ui` 0.4.1 — `SectionHeader` (`kickerTag` «по вашему выбору»), `Kicker`, `EmptyState`, `AsyncContent`,
  `SkeletonGroup`/`SkeletonHeroCard`, `TextAction`, `Banner`, `textStyle` (`displayBar` — словесный знак,
  `displayNumeralDate` — дата героя, `displaySm` — название, `meta`), токены `size.heroHeight`, `size.topBarHeight`,
  `stroke.hairline`, `space`/`inset`; app — `withAccessToken`, `DocumentTitle`, `createQueryClient`/`shouldRetry`,
  `online-manager` (образец), `useSignOut`, `useSubmitSurvey`; API — `AuthGuard`/`CurrentUser`/`AuthUser`,
  `ProfileRepository`; contracts — `RideReason`/`RIDE_REASONS`.
- **Новых компонентов базы для v1 не нужно:** герой — только типографский (кикер → дата → название → мета → 1 px
  линия), из токенов. **Кандидаты в app-foundation (follow-up, R8):** `HeroCard` (типографский + фото со скримом —
  пара к существующему `SkeletonHeroCard`), `TopBar` (токены `topBarHeight`/`avatarTopBar` в базе уже есть),
  `focus-manager(.web)` — в шаблон рядом с `online-manager`.
- **Запрещённые дубли:** свои схемы/DTO гонки или старта в приложении (нужен другой срез — правка контракта admin-02,
  его §13); свой перевод UTC ↔ Минск (только `contracts/src/time.ts`); вычисление фазы окна на клиенте (фаза — с
  сервера; клиент форматирует даты и «через N дн.»); чтение `races`/`calendar_starts`/`profiles` вне их модулей;
  свой `fetch`; `Platform.OS` в экране; hex/px/свои шрифты; строки вне `@pokatim/i18n`; модуль «home»/BFF в API.
- **Тонкий контроллер** профиля: `@CurrentUser()`, `no-store`, вызов сервиса. **Пакеты:** новых нет.

# 6. Relevant Files

- `apps/app/src/app/(tabs)/{index,_layout}.tsx` — Главная (заготовка) и гард/скелетон вкладок.
- `apps/app/src/app/_layout.tsx` — `connectOnlineManager()`, `queryClient.clear()` при выходе.
- `apps/app/src/components/{screen-placeholder,shell-skeleton,tab-bar,document-title}.tsx` — образцы.
- `apps/app/src/features/auth/authorized.ts`, `features/onboarding/queries.ts` — авторизованный запрос, мутация опроса.
- `apps/app/src/lib/{query-client,online-manager,online-manager.web,api}.ts`.
- `apps/app/src/__tests__/{tabs.test.tsx,app-routes.ts,auth-fixtures.ts,query-wrapper.tsx}`, `apps/app/e2e/{web.spec,project}.ts`.
- `apps/api/src/modules/profile/*`, `apps/api/src/modules/identity/index.ts`.
- `packages/contracts/src/profile/onboarding.schema.ts`; admin-02: `src/{time,common}.ts`, `src/races/race-public.schema.ts`,
  `src/calendar/calendar-public.schema.ts`.
- `packages/api-client/src/index.ts`, `packages/i18n/src/ru.ts`.

# 7. Implementation Notes

**Read-API: требования Главной ↔ admin-02** (сверено с его §3, §7 «Публичное чтение», §11 TYPES, §13)

| # | Требование Главной | admin-02 | Итог |
|---|---|---|---|
| A1 | Ближайшая гонка: опубликованная, не отменённая, окно не закрылось по часам сервера, по началу окна | `scope=current`: `published` и окно не закрылось (`now < windowEndsAt + 1 мин`, R12), `windowStartsAt` возр.; `limit=1` | покрыто |
| A2 | Поля героя: название, окно (UTC), фаза сервера, дистанция, покрытия, класс | `RaceCard`: `title`, `windowStartsAt/EndsAt`, `phase` (`upcoming`/`open`/…, `tolerantEnum`), `distanceKm`, `surfaces[]`, `bikeClass`, `season` | покрыто |
| A3 | Терпимость старых сборок к новым enum | `tolerantEnum` → `'unknown'` | покрыто; поведение UI — R9 |
| A4 | Публично, без ПДн, кешируемо | без `AuthGuard`, `public, max-age=60`, IP-лимит `public-read` | покрыто |
| A5 | Индекс под A1 | `races_public_current_idx` | покрыто |
| C1 | Ближайший старт календаря: опубликованный, не прошедший (Минск), по дате | `GET /v1/calendar`, `from` по умолчанию — сегодня по Минску, `(startsOn, _id)`; `CalendarStartCard` | покрыто при Q11 admin-02 = «да» |
| S1 | Сезон | `GET /v1/seasons/current` | есть; Главной не нужен (Q3) |
| T1 | Перевод UTC → Минск, «сегодня» Минска | `utcToMinskWallTime`, `minskToday` | покрыто |
| L1 | Подписи справочников | `domain.*` в `ru.ts` (admin-02 S8) | покрыто |
| — | Обложки | нет (`media`) | нет — типографский герой |

**Дополнительных требований к admin-02 нет.** Если Q11 admin-02 решён «календарь отдельно» — раздел «Календарь»
не входит в реестр до его слияния (флаг в `sections.ts`, не заглушка).

**Приложение.**
- **Запросы:** ключи `['races', 'list', { scope: 'current', limit: 1 }]`, `['calendar', 'list', { limit: 1 }]` —
  совместимы с будущими вкладками (тот же префикс); `staleTime: 60_000`. `['profile']` —
  `withAccessToken(api.getProfile)`, `staleTime: Infinity`; после успеха `useSubmitSurvey` —
  `invalidateQueries({ queryKey: ['profile'] })`. Выход — `queryClient.clear()` (есть).
- **Порядок разделов (R4):** `orderHomeSections(available, reasons)` → `{ id, chosen }[]`: базовый порядок — порядок
  вкладок (Гонки, Райды, Маршруты, Календарь); разделы, чей код есть в `reasons`, поднимаются наверх с сохранением
  базового порядка между собой и получают `chosen` (тег «по вашему выбору»); `exploring`, недоступные разделы и
  `reasons === undefined` (pending/ошибка) — без подъёма и тегов. Карта: `races` → `races`, `calendar` → `calendar`,
  `group_rides` → `rides`, `routes` → `routes`. После прихода профиля порядок меняется один раз (Q4).
- **Время (§4.7):** только `contracts/src/time.ts` admin-02 (`utcToMinskWallTime`, `minskToday`) + названия месяцев
  из i18n (родительный падеж). Диапазон окна: один месяц — «4–12 октября», разные месяцы — «28 сентября–3 октября»,
  разные годы — с годами; тире обычное без пробелов (прототип). Год у даты — только если не текущий по Минску
  («14 июня 2027»). Тест в `TZ=UTC` и `TZ=America/New_York`.
- **Строка жизненного цикла гонки** (из `phase` сервера; время — из значений, не константы):
  `upcoming` — «Окно откроется {d}, {t}, закроется {d} в {t}.»; `open` — «Окно открыто до {d}, {t}.», а если до
  закрытия ≤ 1 календарного дня по Минску — «Окно закрывается сегодня в {t}.» / «… завтра в {t}.» [ASSUMPTION, Q7];
  `'unknown'` и прочие — без строки (R9). Счёт дней — после монтирования, не в SSR (Главная и так без SSR-данных).
- **Календарь:** «До старта N дн.» — `startsOn` минус `minskToday(new Date())`, склонение `plural`; 0 — «Старт
  сегодня»; многодневный идущий — «Идёт сейчас» [ASSUMPTION]. `discipline: 'unknown'` — без подписи.
  `distancesKm`: «100 км», «80 и 120 км», «40, 80 и 120 км»; дробные — с запятой.
- **Состояния раздела:** `AsyncContent` на раздел, `empty.when = (page) => page.items.length === 0`,
  скелетон — `SkeletonHeroCard`. Офлайн-старт native: `fetchStatus: 'paused'` → «Нет соединения» сразу, возврат
  сети — `onlineManager` возобновит запросы. Ошибка профиля — не показывается (только порядок по умолчанию).
- **Pull-to-refresh (R7):** `RefreshControl refreshing={refreshingByUser}` — индикатор только на время жеста
  (`Promise.all` refetch разделов и профиля), не на фоновых refetch; данные остаются — это не «спиннер вместо
  контента». Web: жеста у `react-native-web` нет (проверить по `node_modules/react-native-web` в S3) — обновление по
  фокусу вкладки и перезагрузке; HTTP-кеш браузера (`max-age=60`) может отдать прежний ответ — принято (≤ 60 с).
- **SSR web (R6):** Главная не публичная — без `loader`/`generateMetadata`, `DocumentTitle` «Главная — Покатим».
  SSR без сессии — `ShellSkeleton` (как сейчас). Сторы и `api` — не в рендере и не на уровне модуля.
- **Доступность:** герой — `accessible` блок с одной меткой («{кикер}. {название}. {даты}»), «Все …» — `TextAction`;
  крупный шрифт — название переносится, без `numberOfLines`.

# 8. Risks / Assumptions / Open Questions

- **Зависимость от admin-02.** S4 ждёт слияния его S1 и S7; до этого Главная — каркас (S3). Изменение контрактов
  admin-02 после S4 — пересогласовать здесь.
- **Пустая Главная на dev и в начале сезона.** Пока ничего не опубликовано — пустые герои. Данные на dev — через
  панель (admin-02) — runbook (§10); e2e с данными — фикстура через API панели (§11 TESTS).
- **`Intl` + `timeZone` в Hermes.** Функции `time.ts` admin-02 — на `Intl`; на устройстве с поясом ≠ Минск проверить
  на preview-сборке (NOT VERIFIED у агента); jest — `TZ` ≠ Минск.
- **Мигание порядка.** Профиль приходит позже гонок — порядок разделов меняется один раз (Q4).
- **Свежесть.** `max-age=60` + `staleTime` 60 с: отмена/публикация видна на Главной с задержкой ≤ ~2 мин — принято.
- **Конфликт в `packages/contracts/src/index.ts` и `ru.ts`** с параллельным admin-02 S1/S8 — только экспорт/ключи,
  разрешается при rebase/merge оркестратором.
- `[ASSUMPTION]` Тексты пустых состояний, строки жизненного цикла и календаря, заголовки разделов — до ответа автора (Q7).
  Заголовки без «рядом» (геопозицию не используем): «Ближайшие гонки», «Ближайшие старты».

# 8.1 Requirements Consistency

Architecture Review — app-02-home. **Status: CONCERNS** — блокеров нет: read-API полностью покрыт admin-02 (§7
таблица), по вопросам ниже выбраны рекомендации по умолчанию. **Human gate до S3: Q1 (состав v1) и Q2 (разделы без
бэкенда)** — меняют реестр и тексты. S4 — после слияния admin-02 S1 + S7.

- **R1. Владелец read-API.** Покрыт admin-02 (публичные контроллеры в `races`/`calendar`, контракты с
  `tolerantEnum`, `time.ts`). Здесь — только потребление; второго репозитория/схем нет. Если Q11 admin-02 изменится
  (календарь отдельно) — раздел «Календарь» выключен в реестре до слияния календаря.
- **R2. Расхождение нумерации** `admin-panel.md` (календарь — admin-06) и admin-02 (календарь внутри, его C4/Q11) —
  разрешено там; здесь следуем admin-02.
- **R3. Агрегат `GET /v1/home` vs запросы по разделам.** (а) **По разделам через публичные list-эндпоинты доменов**
  (`limit=1`) — общие ключи кеша и эндпоинты с вкладками, раздел падает отдельно, без межмодульного BFF; (б) агрегат —
  один запрос и серверная персонализация, но модуль, читающий чужие домены, и «всё или ничего»; (в) один `useQueries`
  с общим состоянием — сбой одного раздела гасит ленту. **Рекомендую (а).**
- **R4. Персонализация — где.** Порядок разделов — представление, не вычисляемое значение (§4.1 не затронут):
  (а) **клиентская чистая функция по `rideReasons` из `GET /v1/profile`**; (б) сервер отдаёт `sectionOrder` — только с
  R3(б); (в) локальная копия ответов после опроса — теряется на втором устройстве и после переустановки.
  **Рекомендую (а).**
- **R5. Ответы опроса наружу — пересмотр R7 слайса 4** (там ответы не отдавались, чтобы новые коды не ломали старые
  сборки). Теперь `ProfileView.rideReasons` терпим: неизвестные коды **отбрасываются** (не `'unknown'` — порядку
  разделов фиктивный код не нужен). Реализация: если `tolerantEnum` admin-02 уже в `develop` —
  `z.array(tolerantEnum(RIDE_REASONS)).transform((l) => l.filter(isRideReason))`, иначе
  `z.array(z.string()).transform(…filter(isRideReason))` — выход один (`RideReason[]`), тест тот же. Запрос
  `PUT …/survey` остаётся строгим.
- **R6. Гость и SSR.** Вкладки — только для вошедших (гард `(tabs)`). (а) **Главная не публичная: SSR — скелетон
  оболочки, данные — на клиенте**; (б) гостевая Главная с публичной лентой и SSR — меняет гард и онбординг, нужен
  продуктовый ответ (Q5). **Рекомендую (а).** Публичность A1/C1 (Q14 admin-02) пригодится гостевым экранам ссылок.
- **R7. Обновление.** Pull-to-refresh (native) + `refetchOnWindowFocus` (web штатно; native — `focusManager` ↔
  `AppState` в `src/lib/focus-manager(.web).ts` по образцу `online-manager`) + `staleTime` 60 с. Polling — нет
  (данные меняются редко; §1 — polling для статусов). Индикатор жеста — системный, на время ручного обновления:
  трактовка §4.12 — данные остаются на экране, это не загрузка «вместо контента».
- **R8. Компоненты.** Герой и верхняя панель — продуктовые компоненты `apps/app/src/components` (типографский
  вариант, словесный знак) **сейчас**, с тестами; `HeroCard` (фото + скрим) и `TopBar` (аватар, колокольчик) — в
  `@rkarakulov/ui` задачей app-foundation вместе с медиа/профилем/уведомлениями. Альтернатива — сразу в базу (релиз и
  bump каталога до S3) — дольше, без потребителя фото. Решает оркестратор.
- **R9. `'unknown'` в ответах.** admin-02 §13 советует «фаза `unknown` — как `upcoming`». Расхождение: показывать
  «Окно откроется …» для гонки неизвестной (будущей) фазы — может быть неправдой. **Рекомендую нейтрально:** без
  строки жизненного цикла, даты и название — как есть; неизвестные покрытия/дисциплина/класс — без подписи. Это решение
  UI приложения (в зоне этого блока), контракт не меняется.
- **R10. «Участвовать» и переходы из героя.** Участия и карточек гонки/старта нет — кнопка скрыта, герой не
  нажимается; «Все гонки»/«Все старты» и действие пустого героя ведут во вкладки (пока заготовки) — Q6.
- **Конфликтов с инвариантами `AGENTS.md` §4 нет:** контракты первыми (§4.2), чтение коллекций — только их модулями
  (§4.3), без пакетов (§4.4), фаза — сервер (§4.1), UTC в API / Минск на экране через одну реализацию (§4.7), UI из
  системы (§4.11), скелетон на месте героя (§4.12), все платформы без `Platform.OS` (§4.13), без polling/push (§4.9).

### Вопросы автору (human gate)

| # | Вопрос | Рекомендация (по умолчанию) |
|---|---|---|
| Q1 | **Состав Главной v1** — до S3 | **«Гонки» и «Календарь стартов»** (данные есть с admin-02). Без сезона, рейтинга, достижений, уведомлений, маршрутов и кофе-райдов |
| Q2 | Разделы без бэкенда (Маршруты, Кофе-райды) | **Скрыть** (нет «на вырост», не обещаем сроков). Альтернатива — пустой герой «Раздел появится в одной из ближайших версий» с переходом во вкладку-заготовку |
| Q3 | Сезон на Главной | **Нет** (в прототипе Главной его нет; таблица и место — вкладка «Гонки», блок 03). Альтернатива — подпись «Сезон 2026» в мете героя гонки (`RaceCard.season.name`, без запроса сезона) |
| Q4 | Персонализация | **Отмеченные разделы — первыми, в порядке вкладок, у каждого тег «по вашему выбору»**; «Пока просто смотрю» — базовый порядок; профиль пришёл позже — один перестрой (альтернатива — скелетон всей ленты до профиля, медленнее) |
| Q5 | Гость (без входа) | **Главная только для вошедших** (как сейчас). Гостевая лента — отдельным решением вместе с публичными экранами |
| Q6 | Нажатие на героя, «Участвовать», регистрация у организатора | **Герой не нажимается, «Участвовать» скрыта, ссылка на регистрацию — только текстом «Регистрация у организатора»** до карточек гонки/старта (блоки 03/09). Альтернатива — кнопка «Регистрация» → внешний сайт уже сейчас (`expo-web-browser`/`Linking`, проверка `https`) |
| Q7 | Тексты `[ASSUMPTION]` | Кикеры «Гонки», «Календарь»; заголовки «Ближайшие гонки», «Ближайшие старты»; тег «по вашему выбору»; герой: «Окно гонки», «Ближайший старт»; «Все гонки», «Все старты»; пусто: «Пока нет открытых гонок» (+ «Календарь стартов»), «Пока нет стартов в календаре»; «Окно откроется {d}, {t}, закроется {d} в {t}.», «Окно открыто до {d}, {t}.», «Окно закрывается сегодня/завтра в {t}.», «До старта {n} дн.» (склонение), «Старт сегодня», «Идёт сейчас», «Регистрация у организатора» |
| Q8 | «Выйти» и витрина, пока нет профиля | **Оставить внизу Главной**; уйдут в профиль. Альтернатива — аватар в верхней панели с меню «Выйти» (заготовка профиля без профиля) |
| Q9 | Всё пусто (ничего не опубликовано) | Пустые герои разделов, без общего пустого экрана. Альтернатива — один общий «Сезон скоро начнётся» |

# 8.2 Deviations from spec

**Human gate (2026-10-26).** Автор — Q1: v1 = «Гонки» + «Календарь стартов». Остальные — рекомендации
архитектора: Q2 — разделы без бэкенда скрыты; Q3 — без сезона; Q4 — отмеченные в опросе разделы первыми с тегом
«по вашему выбору», один перестрой после профиля; Q5 — Главная только для вошедших; Q6 — герой не нажимается,
«Участвовать» скрыта, регистрация — только текстом; Q7 — тексты по таблице Q7; Q8 — «Выйти» и витрина внизу
Главной; Q9 — пустые герои разделов. R3(а), R4(а), R6(а), R8 — продуктовые компоненты в `apps/app`; R9 — фаза
`'unknown'` — нейтральный вариант (без строки жизненного цикла).

**Реализация (coder, S1–S3).**
- Словесный знак верхней панели — `textStyle('brand')` (600 15, разрядка .18 — `.brand` прототипа), а не
  `displayBar` из §5.1 (`displayBar` — 500 20/24, заголовок `.titlebar`). Текст — ключ `home.wordmark`, метка для
  скринридера — `app.name`.
- Каркас раздела (шапка, слот `AsyncContent` со `SkeletonHeroCard`, «Все …») — `features/home/home-section.tsx`
  (в §11 не назван; продуктовый, не кандидат в базу). Герой (`components/section-hero.tsx`) — дата героя
  `{ value, unit }` («4–12» + «октября», «14» + «июня 2027» — как `.fb-date .u` прототипа); `format.ts` (S4)
  отдаёт эту пару.
- S3 отдельно не сливается: до S4 слоты разделов — скелетон героя (данных нет до admin-02 S1+S7).
- `DocumentTitle` Главной в jest-web не проверить без дерева expo-router (`Head` требует focus-контекст) —
  `<title>` проверяет смоук S5 (AC8); компонент покрыт `document-title.web.test.tsx`.

# 8.3 Security checklist

Затронуто: новый авторизованный эндпоинт `GET /v1/profile` (ADR-0008); потребление публичных эндпоинтов admin-02
(их checklist — там). `security.md`, `pokatim-security.md`.

1. **AuthN/AuthZ.** `GET /v1/profile` — только `AuthGuard` identity; пользователь — `@CurrentUser()`, пути с id нет —
   чужой профиль недостижим; отказ — один `401`. Клиент: `withAccessToken`, Bearer только в `getProfile`; публичные
   `listRaces`/`listCalendar` — без Bearer (тест api-client admin-02 + тест экрана: вызов без токена).
2. **Входные данные.** `GET /v1/profile` без параметров; фильтр Mongo — только `userId` из проверенного access.
   Публичные запросы — строгие схемы admin-02 (`limit` ≤ 50); клиент не шлёт «сейчас»/«сегодня» — их берёт сервер.
3. **Данные наружу.** `ProfileView` — только `rideReasons` своего пользователя, `no-store`. Публичные карточки — без
   владельца и служебных полей (admin-02). На экране и в логах — без ПДн.
4. **Злоупотребления.** Главная — 3 запроса на открытие, обновление только по жесту/фокусу (без polling); публичный
   IP-лимит admin-02 (300/мин) с запасом.
5. **Секреты и логи.** Access не логируется; ответы опроса — не в логах. Новых env/секретов нет.
6. **Аудит.** Чтение — без аудита; append-only не затронут.

# 9. Acceptance Criteria

1. `ProfileView`: известные коды проходят, неизвестный отбрасывается без ошибки разбора, не-массив — ошибка.
2. `GET /v1/profile`: живой access → `{ rideReasons }` своего пользователя (после опроса) или `{ rideReasons: [] }`
   (документа нет); `no-store`; без access / с отозванной сессией → `401 UNAUTHORIZED`.
3. Главная (iOS, Android, web): шапки разделов видны сразу, на месте героев — скелетоны; гонка есть → герой с датами
   окна по Минску (тест в TZ ≠ Минск), названием, метой, строкой по `phase`; гонок нет → «Пока нет открытых гонок» +
   «Календарь стартов» → вкладка «Календарь»; «Все гонки» → вкладка «Гонки». Аналогично «Календарь стартов» (дата,
   многодневный диапазон, дистанции, «До старта N дн.», «Регистрация у организатора» только при ссылке).
4. Персонализация: `['calendar']` → «Календарь стартов» первым с тегом; `['races','calendar']` — оба с тегом, порядок
   вкладок; `['exploring']`, `['routes']`, профиль в ожидании/с ошибкой → базовый порядок без тегов и без ошибки.
5. Состояния: ошибка сервера одного раздела → «Не удалось загрузить» + «Повторить» в его слоте, другой раздел
   показан; офлайн-старт native → «Нет соединения» сразу, возврат сети — данные без действий; ошибка фонового
   обновления при данных → данные + баннер с повтором. `phase`/`discipline`/`surfaces` = `'unknown'` → герой без
   строки/подписи, экран не падает.
6. Обновление: pull-to-refresh (native) перезапрашивает разделы и профиль, индикатор — только на время жеста;
   фокус/возврат из фона после `staleTime` — перезапрос.
7. Скрыто: «Маршруты», «Кофе-райды», колокольчик, аватар, «Участвовать», баннер геопозиции, обложки; «Выйти» и
   dev-витрина — внизу Главной.
8. Web: `/` без сессии → HTML скелетона оболочки, без ошибок гидрации; после входа — `<title>` «Главная — Покатим»;
   смоук с API: онбординг → Главная → пустые герои; после публикации гонки и старта (фикстура через API панели) —
   герои с названиями.
9. Архитектура: DTO — только contracts; свой перевод времени — нет; коллекции чужих модулей не читаются; без
   `Platform.OS` в экранах; без hex/px; строки — `@pokatim/i18n`; `pnpm check` зелёный; int — реальный MongoDB RS.

# 10. Documentation Impact

- `docs/product/home.md` (новый) — решения по Q1–Q9: состав v1, правило персонализации, что скрыто и до каких блоков,
  тексты; строка в `docs/product/README.md`.
- `docs/architecture/README.md` — Главная: разделы → публичные list-эндпоинты `races`/`calendar`, персонализация на
  клиенте по `GET /v1/profile`, обновление (pull-to-refresh, фокус).
- `.claude/rules/pokatim-app.md` — Главная: реестр разделов (раздел — только с живым read-API), `focus-manager(.web)`,
  pull-to-refresh, время — только `contracts/src/time.ts`, `'unknown'` — нейтрально (R9).
- `.claude/rules/pokatim-backend.md` — `profile`: `GET /v1/profile`.
- `.claude/rules/pokatim-contracts.md` — терпимые массивы кодов в ответах: отбрасывать неизвестные, где фиктивное
  `'unknown'` не нужно (R5) — рядом с правилом `tolerantEnum` admin-02.
- `docs/tasks/2026-10-25-onboarding-04-survey-geo/task.md` §4 «персонализация Главной» и R7 — ссылка сюда (пересмотр R5).
- `docs/runbooks/local-dev.md` — как увидеть Главную с данными на dev (сезон → гонка → публикация, старт календаря
  через панель).
- ADR не нужен (в рамках ADR-0003/0008); при выборе R3(б) — ADR.

# 11. Implementation Context

Уровень — task3 (контракты, API, все платформы, зависимость от параллельной задачи). Слайсы — по коммиту, проверка
после каждого. Q1–Q2 — до S3; S4 — после слияния admin-02 S1 и S7.

### ENTRY POINTS
- API: `GET /v1/profile` — `profile.controller.ts` → `ProfileService.view`.
- App: `src/app/(tabs)/index.tsx`, `src/features/home/{sections,queries,format}.ts`.

### Слайсы и проверка после каждого
| # | Что | Проверка |
|---|---|---|
| **S1** | Contracts + api-client: `profile/profile.schema.ts` (`ProfileView`, R5), экспорт; `getProfile(accessToken)` | TDD; `pnpm --filter @pokatim/contracts test`, `--filter @pokatim/api-client test`, `pnpm typecheck` |
| **S2** (после S1) | API profile: `ProfileRepository.findReasons`, `ProfileService.view`, `ProfileController` | `pnpm --filter @pokatim/api test` (int: MongoDB RS `*_test` + Redis db 1); Security п. 1–3; `pnpm arch:check` |
| **S3** (после S1; Q1–Q2) | App каркас: `top-bar.tsx`, `section-hero.tsx` (+ тесты), `features/home/sections.ts` (+ тест), `useRideReasons`, `focus-manager(.web).ts`, экран Главной с шапками разделов, скелетонами, pull-to-refresh, временными «Выйти»/витриной, `DocumentTitle`; инвалидация `['profile']` после опроса; строки `home.*` | `pnpm --filter @pokatim/app test` (native + web), `typecheck`; `build:web` + `start:web` + `curl /` (HTML скелетона) |
| **S4** (после S3 и admin-02 S1+S7 в `develop`) | Разделы: `useNextRace`, `useNextCalendarStart`, `format.ts` (+ тесты в `TZ` ≠ Минск), герои/пусто/ошибка, «Все …», R9 | `pnpm --filter @pokatim/app test`; ручной смоук web с API и данными из панели |
| **S5** | E2E + docs (§10) | `pnpm build:web && E2E_API=1 pnpm --filter @pokatim/app e2e:web`; без API — `skip`; `pnpm check` |

Параллель: S2 — `apps/api/**`; S3–S4 — `apps/app/**`, `packages/i18n/src/ru.ts`. Contracts/api-client — только S1.

### FILES TO MODIFY
| Файл | Слайс | Изменение |
|---|---|---|
| `packages/contracts/src/profile/profile.schema.ts` (новый, + test), `src/index.ts` | S1 | `ProfileView` |
| `packages/api-client/src/index.ts` (+ test) | S1 | `getProfile(accessToken)` |
| `apps/api/src/modules/profile/{profile.repository,profile.service (новый),profile.controller (новый),profile.module}.ts`, `profile.int.test.ts` (новый) | S2 | чтение ответов |
| `apps/app/src/app/(tabs)/index.tsx` | S3–S4 | Главная |
| `apps/app/src/features/home/{sections,queries,format}.ts` (новые, + tests) | S3–S4 | реестр/порядок, запросы, подписи |
| `apps/app/src/components/{top-bar,section-hero}.tsx` (новые, + tests) | S3 | продуктовые компоненты (R8) |
| `apps/app/src/lib/focus-manager(.web).ts` (новые, + test), `src/app/_layout.tsx` | S3 | `focusManager` ↔ `AppState` |
| `apps/app/src/features/onboarding/queries.ts` | S3 | `invalidateQueries(['profile'])` |
| `apps/app/src/__tests__/{home.test.tsx (новый),tabs.test.tsx,auth-fixtures.ts}` | S3–S4 | моки `getProfile`/`listRaces`/`listCalendar` |
| `packages/i18n/src/ru.ts` | S3–S4 | `home.*` (Q7) |
| `apps/app/e2e/web.spec.ts`, `e2e/project.ts` | S5 | AC8 (фикстура через API панели) |
| docs §10 | S5 | — |

### FILES TO READ
`AGENTS.md` §1, §4; `.claude/rules/{app,pokatim-app,contracts,pokatim-contracts,backend,pokatim-backend,db,
pokatim-db,security,pokatim-security,tests,pokatim-tests}.md`; ADR-0003, ADR-0008; `docs/product/onboarding.md`;
`docs/tasks/2026-10-25-onboarding-04-survey-geo/task.md` §8.1 R7; `docs/tasks/2026-10-26-admin-02-seasons-races/task.md`
§3, §7 «Публичное чтение», §8.1 R4–R6/R12, §11 TYPES, §13; `@rkarakulov/ui` 0.4.1 — `async-content.tsx`,
`ui/{section-header,kicker,empty-state,skeleton}.tsx`, `design-tokens/src/typography.ts`; TanStack Query v5 —
`focusManager`, `refetch` (context7); `react-native-web` — `RefreshControl` на web.

### TYPES & SCHEMAS
```ts
// packages/contracts/src/profile/profile.schema.ts
const isRideReason = (code: string): code is RideReason => (RIDE_REASONS as readonly string[]).includes(code);
/** GET /v1/profile (AuthGuard, no-store). Неизвестные коды новых версий отбрасываются (R5). */
export const ProfileView = z.object({
  rideReasons: z.array(z.string()).transform((codes) => codes.filter(isRideReason)),
});
export type ProfileView = z.output<typeof ProfileView>;

// admin-02 (потребляем, не дублируем): createApiClient.listRaces(RaceListQuery) → RacePage<RaceCard>;
// listCalendar(CalendarQuery) → CalendarPage<CalendarStartCard>; tolerantEnum → 'unknown';
// time.ts: utcToMinskWallTime(iso) → 'YYYY-MM-DDTHH:mm', minskToday(now) → LocalDate
```
```ts
// apps/app/src/features/home/sections.ts
export type HomeSectionId = 'races' | 'rides' | 'routes' | 'calendar';
export const HOME_SECTION_ORDER: readonly HomeSectionId[] = ['races', 'rides', 'routes', 'calendar'];
/** Разделы с живым read-API; `rides`/`routes` — со своими блоками. */
export const AVAILABLE_HOME_SECTIONS: readonly HomeSectionId[] = ['races', 'calendar'];
export function orderHomeSections(
  available: readonly HomeSectionId[],
  reasons: readonly RideReason[] | undefined,
): { id: HomeSectionId; chosen: boolean }[];

// apps/app/src/features/home/format.ts — чистые функции (now — параметр)
export function formatRaceWindow(startsAt: string, endsAt: string, now: Date): string; // «4–12 октября»
export function raceLifecycleLine(race: RaceCard, now: Date): string | null;           // R9: unknown → null
export function formatCalendarStartDate(card: CalendarStartCard, now: Date): string;   // «14 июня 2027», «26–27 июня»
export function daysUntilStart(startsOn: string, now: Date): number;                    // по minskToday
```

### TESTS
- **contracts:** `ProfileView` — известные коды, неизвестный отброшен, пустой массив, не-массив — ошибка.
- **api-client:** `getProfile` — `GET /v1/profile`, `authorization: Bearer`.
- **API int (MongoDB RS + Redis, фиксированный CLOCK):** AC2 — после `PUT …/survey` ответ совпадает, без документа —
  `[]`, `no-store`, `401` без access и после `sign-out`.
- **App unit:** `orderHomeSections` — AC4 полностью; `format.ts` — диапазоны (месяц / месяцы / годы, текущий год без
  года), строки фаз (`upcoming`, `open` сегодня/завтра/позже, `unknown` → `null`), «До старта» на границе суток Минска,
  прогон в `TZ=UTC` и `TZ=America/New_York`; `focus-manager` — `AppState` → `focusManager.setFocused`.
- **App screen (jest-expo, native + web):** AC3, AC5 (`fetchStatus: 'paused'`; ошибка одного раздела; баннер при
  данных; `'unknown'`), AC6 (pull-to-refresh зовёт refetch разделов и профиля), AC7, `DocumentTitle` (web), герой —
  одна метка для скринридера; публичные методы вызваны без токена.
- **E2E:** AC8; фикстура — админ CLI → сезон → гонка → публикация, старт календаря через API панели (helpers
  admin-02 e2e, если есть; иначе `fetch` к `/v1/admin/*` в `e2e/project.ts`); `pageerror`/`console.error` пусто.
- **Ручной смоук (человек; NOT VERIFIED, если не делался):** iOS/Android preview — pull-to-refresh, даты по Минску при
  поясе устройства ≠ Минск, крупный шрифт, тёмная тема; Safari iOS web — обновление по фокусу.

### OUT OF SCOPE
§4. Плюс: всё, что admin-02 (модель, панель, публичные эндпоинты); вкладки «Гонки»/«Календарь» с фильтрами (блоки
03/09); изменения app-foundation (кандидаты R8).

# 12. Outcome

**Статус: S1–S3 сделаны, S4–S5 ждут admin-02 S7** (в `origin/feature/admin-02-seasons-races` на момент остановки —
только S1).

- **S1** — `ProfileView` (`profile/profile.schema.ts`: неизвестные коды отбрасываются, R5), `api.getProfile(accessToken)`.
- **S2** — `GET /v1/profile`: `ProfileController` (`AuthGuard`, `@CurrentUser()`, `no-store`) → `ProfileService.view` →
  `ProfileRepository.findReasons` (projection `rideReasons`); документа нет — `[]`. Int-тест: AC2 (после опроса,
  без документа, чужой не виден, `401` без access и после выхода).
- **S3** — Главная-каркас: `TopBar`, `SectionHero` (+ тесты), `features/home/{sections,queries,home-section,
  use-pull-to-refresh}`, `lib/focus-manager(.web)` подключён в корневом `_layout`, инвалидация `['profile']` после
  опроса, строки `home.*`. Тесты: AC4 полностью (порядок/теги, ошибка/ожидание профиля), «Все …» → вкладки,
  pull-to-refresh (профиль перезапрошен, индикатор только на время жеста), AC7 (скрытые разделы, «Выйти» внизу).

**Осталось:** S4 (`useNextRace`, `useNextCalendarStart`, `format.ts` в `TZ` ≠ Минск, герои/пусто/ошибка, R9,
pull-to-refresh разделов), S5 (e2e AC8 с API, docs §10).

**Проверки (S3):** `pnpm check` — 13/13 задач; `build:web`; `pnpm e2e:web` — 11 passed, 1 skipped (шаг с API без
`E2E_API`); `expo export -p android` — ок. NOT VERIFIED: ручной смоук iOS/Android/Safari (pull-to-refresh, фокус).

---

## Приложение A. Карта прототипа «02 Главный экран» (кратко, без данных прототипа)

- **Верхняя панель:** словесный знак продукта; справа колокольчик с квадратным счётчиком и квадратный аватар «Личная
  линия» (имени при регистрации нет — без инициалов).
- **Лента:** четыре раздела в одном ритме — шапка (кикер раздела accent; у выбранного в опросе — нейтральный тег «по
  вашему выбору»; заголовок акцидентным шрифтом), один герой, мета, действие, «Все …» (text-action). Раздел из ответа
  опроса — первым.
- **Маршруты:** обложки нет никогда — герой route-line (линия в верхней части блока, кикер → дистанция → название);
  мета (тип, набор, старт от вас), полоса покрытия с обязательной легендой (гравий — штриховка, не цвет).
- **Гонки:** фото-обложка со скримом (без фото — запасной герой); на фото кикер «Окно гонки», даты окна крупно,
  название; под фото — мета с явным временем открытия и закрытия и одна secondary «Участвовать».
- **Кофе-райды:** фото организатора, дата и время, маршрут, мета (дистанция, темп, старт), стопка аватаров «идут N»,
  единственная primary «Я иду».
- **Календарь:** у старта нет ни обложки, ни геометрии — типографский герой (кикер → дата → название → 1 px линия),
  мета, «Регистрация открыта. До старта N дней.», «Все старты».
- **Геопозиция запрещена:** сверху нейтральный баннер «Включите геопозицию, чтобы видеть райды рядом» (≥ 44 px, ведёт
  в настройки ОС); из копий убраны «рядом»/«от вас», сортировка — по дате.
- **Вкладки:** Главная · Гонки · Райды · Маршруты · Календарь; активная — метка 600 и 2 px полоса text.primary (не
  accent) — уже реализовано (`tab-bar.tsx`).
- **Темы:** светлая и тёмная — простая инверсия, accent только в кикере раздела.
- **Смежные (`key-races`, `key-calendar`):** пустой герой раздела «Пока нет открытых гонок» + одно действие
  «Календарь стартов»; скелетоны повторяют раскладку, заголовок и фильтры видны сразу, глобального спиннера нет;
  «Нет соединения» — в анатомии пустого состояния без тона ошибки; многодневные даты — обычное тире без пробелов.
