# 1. Title

Приложение, блок 05: Кофе-райды — модуль API `rides` (создание райда райдером, правка, отмена с причиной, «Я иду» /
«Не иду» с лимитом мест), вкладка «Райды» (герой «Ближайший райд», лента по дням, фильтр «Город»), публичная карточка
райда по ссылке (SSR + OG, `pokatim://rides/<id>`), форма «Новый райд», раздел «Кофе-райды» на Главной. Миграция
`0014_rides`. Блок разбит на два PR: **PR 05a — этот spec целиком**, PR 05b — жалобы и модерация (Приложение C).

# 2. Goal

Райдер «Покатим» (iOS, Android, web/PWA) собирает компанию на покатушку: создаёт кофе-райд (название, дата и время
старта, город и место встречи, дистанция, темп, необязательный лимит участников, описание), делится ссылкой, видит,
сколько человек идёт; другие райдеры находят райд во вкладке «Райды» и на Главной, отмечаются «Я иду» и снимают
отметку «Не иду». Организатор правит райд и отменяет его с причиной — участники видят отмену в ленте и на карточке.
Карточка райда — публичная ссылка: открывается без входа и без установки (web — HTML с сервера, OG без ПДн), гость
записывается после входа и возвращается к райду.

Кофе-райд — третья сущность расписания (ADR-0010 п. 1): владелец — райдер в приложении, не команда платформы; без
окна, протокола, сезона и результата; повторяющихся райдов нет (Q7 races-and-seasons).

Источники: прототип `key-rides` (конфиденциален — краткая карта без данных в Приложении A), для связей `key-home`
(раздел «Кофе-райды») и `key-calendar` (кофе-райдов в календаре нет); `docs/product/races-and-seasons.md` (строка
«Кофе-райд», Q7), `docs/product/home.md` (раздел скрыт «до блока 05»), `docs/product/onboarding.md` (геопозиция:
только foreground, «рядом» — с фичей «рядом»); ADR-0003, 0007 (R11 — геометрия), 0008, 0010 (п. 1, 3, 5, 6, 8);
`docs/tasks/2026-10-27-app-04-calendar/task.md` (образец публичной карточки, ленты, SSR); эпик
`docs/tasks/2026-10-27-race-results/epic.md` (A11 — уведомления отдельным модулем; порядок миграций);
`AGENTS.md` §1, §4.1–4.13; `.claude/rules/{app,pokatim-app,contracts,pokatim-contracts,backend,pokatim-backend,db,
pokatim-db,security,pokatim-security,tests,pokatim-tests}.md`.

# 3. Scope

**API — новый модуль `apps/api/src/modules/rides`** (§7 «API», таблица эндпоинтов)
- Создание райда вошедшим райдером; организатор — первый участник («идёт 1 из 12 · вы»).
- Правка организатором до старта (оптимистичная `version`, 409 `CONFLICT`); лимит не ниже числа идущих.
- Отмена организатором до старта с причиной из справочника (`RIDE_CANCEL_REASONS`, без свободного текста — Q6).
- «Я иду» / «Не иду» — атомарно в одном документе (участники — встроенный массив, §7 «Операции репозитория»), идемпотентно; полный райд —
  `409 RIDE_FULL`; после старта, отменённый — `409 RIDE_INVALID_STATE`; организатор «Не иду» не может.
- Лента для вошедших (`AuthGuard`, `no-store`): будущие опубликованные райды по времени старта + отменённые будущие,
  в которых зритель участвует или которые организует (Q11); фильтр `city[]`; курсор; у каждой карточки — роль зрителя.
- Города ленты (`GET /v1/rides/cities`) — коды справочника, где есть видимые зрителю будущие райды.
- Публичная карточка (`PublicReadGuard`, `public, max-age=60`): опубликованный, отменённый и прошедший райд; без
  организатора, участников и `version`. Состояние зрителя — отдельный `GET /v1/rides/:id/me` (`AuthGuard`, `no-store`).
- Лимиты частоты и квоты (§8.3): создание, правка/отмена, «Я иду»/«Не иду», число будущих райдов организатора и
  будущих отметок райдера.
- Миграция `0014_rides` (коллекция, индексы), коды ошибок и полей — в конец списков contracts.

**Contracts / api-client**
- `packages/contracts/src/rides/ride.schema.ts` (запросы, ответы, справочники, лимиты), `src/geo/city.schema.ts`
  (справочник городов Беларуси `CITY_CODES`, Q3); экспорт в `src/index.ts`; коды ошибок `RIDE_*`.
- api-client: `listRides`, `listRideCities`, `getRide` (публичный), `getRideForViewer`, `createRide`, `updateRide`,
  `cancelRide`, `joinRide`, `leaveRide`.

**Вкладка «Райды» (`(tabs)/rides.tsx`, сейчас `ScreenPlaceholder`; все платформы, только для вошедших)**
- Шапка: кикер «Кофе-райды», заголовок «Ближайшие кофе-райды» (без «рядом с вами» — нет геопозиции, Q1), справа —
  secondary «Создать райд» (→ `/rides/new`). Шапка, кнопка и фильтр видны при любом состоянии данных.
- Фильтр «Город» (`FilterGroup` из `Chip`): чипы — `GET /v1/rides/cities`, ИЛИ внутри группы; до ответа — скелетон
  ряда, ошибка или пусто — группа скрыта; исчезнувший город снимается (`withinAvailable`); «Сбросить фильтры».
- Герой «Ближайший райд» (первая запись): типографский `SectionHero` (кикер, дата «Сб 3 октября, 9:00», название,
  мета «104 км · темп 25–27 км/ч · {город}, {место}»), под ним стопка участников и одна primary-кнопка участия
  (`RideGoingAction`, §7). Нажатие на героя → карточка.
- Список по дням: подпись дня «Воскресенье, 4 октября» (поперёк страниц), строка райда (`RideListRow`): «10:00 ·
  {город}», название, мета «42 км · темп 22–24 км/ч · старт: {место}», стопка «идут 5 из 12» и действие справа:
  secondary «Я иду» / текст «Вы идёте» / «Вы организатор» / «Мест нет» (текст 600 ink, не цвет) / «Райд отменён».
- Пагинация — курсор, `limit: 20`, `FlatList` + `onEndReached`, подвал — скелетон строки / баннер ошибки догрузки.
- Состояния §4.12: скелетон героя и строк; «Нет соединения» / «Не удалось загрузить» + «Повторить»; баннер ошибки
  обновления при данных; `OfflineBanner`; пусто без фильтров — `EmptyState` «Пока нет кофе-райдов — создайте первый»
  + «Выберите время старта, место и темп. Райд увидят велосипедисты Беларуси.» + primary «Создать райд» (secondary в
  шапке скрыта, как в прототипе); пусто с фильтром — «Ничего не найдено» + «Сбросить фильтры».
- Обновление: pull-to-refresh, фокус/возврат из фона, после любой мутации райда — инвалидация `['rides']`.

**Карточка райда (`src/app/rides/[id].tsx`, публичная, вне гардов)**
- `DetailHeader` («Назад»: история — назад, нет — `/rides` вошедшему, `/` гостю) + title bar.
- Типографская шапка без карты (Q2): метка «Кофе-райд» / «Кофе-райд · вы организатор»; название; «Воскресенье,
  4 октября 2026, 10:00» (на публичном экране — с годом); «Старт: {город}, {место}»; `StatBlock` — «42 км ·
  Дистанция», «22–24 км/ч · Темп» (без «Набор» — нет маршрута); стопка «идут 5 из 12» / «… · вы в списке».
- Действия по `viewer` сервера (§7 «Приложение», `RideGoingAction`): гость — primary «Я иду» → «Вход» с возвратом к райду (Q13);
  участник — нейтральный баннер «Вы идёте · {дата}, {время}» + secondary «Не иду»; организатор — secondary
  «Изменить» и `TextAction` «Отменить райд»; полный — баннер «Мест нет — все {limit} мест заняты.» над выключенной
  «Я иду» (`aria-disabled` + описание); всем в будущем райде — secondary «Поделиться» (D-69 прототипа).
- Отменённый: баннер «Райд отменён. Причина: {причина}.», без «Я иду» и «Поделиться»; прошедший: баннер «Райд уже
  прошёл · {дата}», стопка «ехали N» (+ «· вы в списке»), `TextAction` «Все райды» вместо действий.
- Перенос времени/места после записи других (`rescheduledAt`) — строка «Время или место старта изменены {дата}.»
- «Об этом райде» — описание как есть (`Text selectable`, без разметки и автоссылок); нет описания — блока нет.
- Сразу после публикации (`?published=1`) — баннер «Райд опубликован. Пригласите друзей ссылкой.» с «Поделиться».
- Состояния: скелетон; невалидный id / 404 — «Райд не найден» + «Все райды»; сеть / сервер — `AsyncContent`;
  `OfflineBanner`; мутации — состояние кнопки.
- Web SSR: `loader` (посев публичных данных), `generateMetadata` — `<title>` = название, description/OG «{дата с
  годом}, {время} · {город} · {км} км · темп {a–b} км/ч», `og:url` — `WEB_ORIGIN/rides/<id>`, **всегда
  `robots: noindex`** (UGC, Q7); не найден — нейтральная мета + `noindex`; API недоступен — нейтральная мета.
- Deep link `pokatim://rides/<id>` — штатно через Router.

**Форма «Новый райд» / «Изменить райд» (`src/app/rides/new.tsx`, `src/app/rides/edit/[id].tsx`, только вошедшим, без
таб-бара)**
- Поля: «Название», «Дата» (`DateField`), «Время старта» (`TimeField`, S0), «Город» (выбор из справочника — чипы
  или список, §7), «Место старта» (текст, подсказка «Видят все — выберите людное место, не домашний адрес.»),
  «Дистанция, км», «Темп, км/ч» (от — до), «Описание» (многострочное, S0), «Максимум участников (необязательно)»
  (плейсхолдер «Без ограничения»). Кнопка «Опубликовать» / «Сохранить»; под ней «После публикации можно поделиться
  ссылкой.»
- Ошибки: клиент — та же zod-схема (`react-hook-form` + `zodResolver`); «Эта дата уже прошла — выберите дату в
  будущем.» под датой; «Опубликовать» выключена с причиной «Исправьте дату, чтобы опубликовать райд» (Disabled
  action with reason); ошибки полей сервера (`VALIDATION_FAILED.details.fields`) — под полями; 409 `CONFLICT` —
  баннер «Райд изменили — обновите страницу» + «Обновить»; 429 — баннер с `retryAfterSec`; `RIDE_QUOTA_EXCEEDED` —
  баннер «У вас уже {n} будущих райдов. Отмените один, чтобы создать новый.»
- «Отменить райд» (`src/app/rides/cancel/[id].tsx`): выбор причины (обязательно), destructive «Отменить райд»,
  пояснение «Участники увидят отмену и причину в ленте и на карточке.»; после — карточка с баннером отмены.

**Главная (блок 02) — раздел «Кофе-райды»**
- `rides` входит в `AVAILABLE_HOME_SECTIONS` (порядок вкладок: Гонки → Кофе-райды → Маршруты → Календарь; ответ
  опроса `group_rides` поднимает раздел). Шапка «Кофе-райды» / «Ближайшие кофе-райды», герой — первый райд ленты
  (`['rides','list',{limit:1}]`), стопка и `RideGoingAction`, «Все райды» → вкладка; пусто — «Пока нет кофе-райдов»
  + «Создать райд».

**Общее приложения**
- «Поделиться» — `src/lib/share-link(.ts|.web.ts)`: native — системный share sheet (`Share` RN), web —
  `navigator.share`, иначе копирование в буфер + баннер «Ссылка скопирована»; ссылка —
  `{EXPO_PUBLIC_WEB_ORIGIN}/rides/<id>` (новая публичная env, §7 «Шаринг»).
- Возврат к объекту после входа/регистрации (`pokatim-app.md` «Deep links») — `features/auth/return-path.ts` (Q13, §7 «Возврат после входа»).

**E2E/docs** — шаг смоука web (§11 TESTS), документация §10, черновик ADR-0013 (Приложение B).

# 4. Out of Scope

Скрыть без заглушек «скоро» (§4.9 «Нет на вырост»):
- **«рядом» и «в N км от вас»:** у райда нет координат; точка на карте требует MapLibre и поставщика тайлов, адрес →
  точка — геокодер; оба — внешние сервисы (ADR). Лента — по времени и городу; координаты, `2dsphere`, foreground-
  геопозиция и баннер «Включите геопозицию» — блок «Карта и рядом» (Q1). Шаг геопозиции онбординга по-прежнему
  выключается перед сторами (`LOCATION_STEP_ENABLED`, release-чеклист).
- **карта в шапке карточки, маршрут райда, «Набор», «Этот райд в других разделах»:** библиотеки маршрутов для
  райдеров нет (`routes` — только маршруты команды платформы, ADR-0012); поле «Маршрут» формы и подстановка дистанции
  из маршрута — с блоком «Маршруты» (expand: `routeId` nullable).
- **карточка-приглашение 9:16, «Добавить своё фото», фото организатора на герое, карточка «Кофе-райд» прошедшего
  райда (D-65), шит «Райд опубликован»:** модули `sharing` (рендер Skia в worker) и `media`; вместо шита — баннер на
  карточке с «Поделиться».
- **имя организатора («организует Катя Л.»), аватары и список участников:** имени и фото у аккаунта нет (регистрация
  их не спрашивает, `key-home`); стопка — пустые квадраты «Личная линия» по числу, без ПДн (Q4).
- **уведомления участникам** (отмена, перенос): центра уведомлений нет — модуль `notifications` (A11 эпика); в 05a
  отмена видна в ленте участника и на карточке, перенос — строкой на карточке (Q5).
- **жалобы, модерация, скрытие райда командой, роль `rides.moderate`, очередь в панели** — PR 05b (Приложение C).
- **лист ожидания** (OQ5 прототипа закрыт: нет), повторяющиеся райды (Q7 races-and-seasons), удаление райда
  (только отмена), исключение участника организатором, комментарии, «Мои райды» в профиле, прошедшие райды в ленте.
- **universal / app links** (AASA, assetlinks) — слайс 5 онбординга; ссылка «Поделиться» ведёт на web-карточку.
- **удаление аккаунта** — ещё нет; обязательства модуля `rides` фиксируются в `pokatim-db.md` (§10).
- изменения панели «Протокол» (05a не трогает `apps/admin`).

# 5. Architecture Context

- **api, `modules/rides` (новый):** `rides.collection.ts` (документ, имена), `rides.repository.ts` (единственный
  писатель `rides`), `rides.policy.ts` (чистые функции: фаза, действия зрителя, окно времени старта, правила правки,
  лимиты — `RIDES_POLICY`), `rides.service.ts` (создание, правка, отмена, участие, лимиты частоты),
  `rides-feed.service.ts` (лента, города, карточка, `me`), `rides.controller.ts` (`AuthGuard`),
  `rides-public.controller.ts` (`PublicReadGuard`), `rides.module.ts`, `index.ts` (только `RidesModule`).
  Зависимости: `modules/identity/index.ts` (`AuthGuard`, `CurrentUser`, `AuthUser`), `src/public-read.guard.ts`,
  `src/page-cursor.ts`, `src/error-messages.ts`, `RateLimiter`/`CLOCK` из `@rkarakulov/api-kit/core`. Других модулей
  не импортирует; `panel` не нужен (05b). `AppModule` — `RidesModule` после `CalendarModule`.
- **db:** одна коллекция `rides`, участники — встроенный массив `participants` (≤ `RIDE_MAX_PARTICIPANTS` = 100) —
  все инварианты участия держатся атомарной операцией над **одним** документом, без транзакций и замков (
  `pokatim-db.md` «Вне транзакций — только атомарные операции над одним документом»). Миграция `0014_rides`
  (expand-only, идемпотентна, без транзакции). Номер согласован: `0013_routes` — PR #33; **05a мержится после #33**
  (мигратор базы отказывает при «дыре»: применённая `0014` при неприменённой `0013` — ошибка `assertConsistent`).
- **contracts:** `src/rides/ride.schema.ts`, `src/geo/city.schema.ts`; коды ошибок — в конец `defineErrorCodes`
  (`RIDE_FULL`, `RIDE_INVALID_STATE`, `RIDE_QUOTA_EXCEEDED`), коды полей — в конец `defineFieldErrorCodes`
  (`RIDE_START_IN_PAST`, `RIDE_START_TOO_FAR`, `RIDE_PACE_ORDER`, `RIDE_LIMIT_BELOW_GOING`). Ответы — `z.object`
  без `strict`, enum-ы ответов — `tolerantEnum`; запросы — `z.strictObject`, строгие enum-ы. Новых полей в
  существующих схемах нет — совместимость старых сборок не затрагивается. PR #33 тоже дописывает коды в конец
  (`ROUTE_*`) — при слиянии порядок: `ROUTE_*`, затем `RIDE_*`.
- **app:** вкладка `(tabs)/rides.tsx`; публичный `rides/[id].tsx` в корневом `Stack` вне `Stack.Protected` (как
  `calendar/[id]`); `rides/new.tsx`, `rides/edit/[id].tsx`, `rides/cancel/[id].tsx` — внутри `Stack.Protected`
  вкладок (гость → «Вход»/«Регистрация»); фича `src/features/rides/`; общие `src/lib/share-link(.web).ts`,
  `src/features/auth/return-path.ts`; продуктовые компоненты `src/components/{ride-list-row,ride-going-action}.tsx`.
  Статические сегменты `new`, `edit`, `cancel` не пересекаются с `[id]` (проверка — `app-routes.ts` + `build:web`).
- **Очереди/outbox:** нет (05a). Событий для будущих уведомлений не пишем: потребителя нет, неопубликованные
  события без маршрута копились бы в частичном индексе `outbox_unpublished_idx` (Q5). **Аудит:** нет (решения
  организатора о своём райде — состояние документа; модерация и её append-only журнал — 05b).
- **Порядок слайсов:** S0 (app-foundation) ∥ S1 → S2 → S3 → (S4 ∥ S5) → S6 → S7. S2 (API) и S3–S6 (app) не
  пересекаются по файлам; S5 (форма) ждёт релиз S0.

# 5.1 Placement & Reuse Gate

- **Переиспользуем (без копий):** `AuthGuard`/`CurrentUser`/`AuthUser` (identity index), `PublicReadGuard` +
  `PUBLIC_READ_CACHE_CONTROL`, `encodeCursor`/`decodeCursor` (`page-cursor.ts`), `domainError`, `RateLimiter` и
  `CLOCK` базы, `uuidv7`, `ensureCollection` (`0002_identity`), `tolerantEnum`, `queryArray`, `PageQuery`,
  `PageCursor`, `Uuid`, `Version`, `SINGLE_LINE`/`MULTI_LINE`, `RateLimitedDetails`, `ValidationErrorDetails`,
  `time.ts` (`UtcMinute`, `minskWallTimeToUtc`, `utcToMinskWallTime`, `minskToday`, `LocalDate`, `LocalTime`);
  app — `SectionHero`, `DetailHeader`, `StatBlock`, `FilterGroup`/`FilterGroupSkeleton`, `OfflineBanner`,
  `HomeSection`, `public-ssr.ts` (`publicPath`, `fetchPublicForSsr`, `ssrData`), `useLoaderSeed`,
  `publicPageMetadata`, `DocumentTitle`, `minsk-format.ts`, `use-minsk-clock.ts`, `usePullToRefresh`,
  `filter-chips.ts` (`toggle`), `withAccessToken`, `apiErrorOf`, раскладки `calendar-feed.tsx` (плоские элементы
  `FlatList`) и `calendar-detail.tsx`; `@rkarakulov/ui` — `SectionHeader`, `Chip`, `Banner`, `Button`, `TextAction`,
  `EmptyState`, `AsyncContent`, `Skeleton*`, `Kicker`, `Pill`, `AvatarStack` (пустые квадраты без `source`),
  `TextField`, `DateField`, `textStyle`; токены `@pokatim/design-tokens`.
- **Перенос общего кода (без смены поведения):** `cityKeyOf` не нужен (город — код справочника); общая подпись
  «день недели, число месяц[, год], время» — в `src/lib/minsk-format.ts` (`formatMinskDateTime`), если её ещё нет,
  с тестами в TZ ≠ Минск.
- **app-foundation (S0, задачей и релизом базы, §4.11):** `TextField` — многострочный режим (`multiline`,
  `numberOfLines`, `maxLength`, высота по токену) и суффикс единиц (`suffix`: «км», «км/ч»); `TimeField` (native —
  `@react-native-community/datetimepicker` `mode="time"`, web — `<input type="time">`, значение `HH:mm`) рядом с
  `DateField`; пример на витрине `UiKit`, тесты. Релиз `@rkarakulov/ui` 0.4.2 → каталог pokatim. **Фолбэк** (если
  релиз не успевает к S5 — решение оркестратора, отражается в §8.2): время — `TextField` с маской `ЧЧ:ММ` и
  `LocalTime`, описание — однострочное до релиза; суффиксы — в подписи поля («Дистанция, км»).
- **Новые продуктовые компоненты** (`apps/app/src/components`, только токены и компоненты системы, с тестами):
  `RideListRow` (строка ленты; `minHeight: size.rowMin`, hairline сверху), `RideGoingAction` (кнопка/текст участия
  по `viewer` и `full`, причина выключения — `accessibilityHint` + видимый текст). Кандидаты в базу (follow-up):
  `DisabledReason` для приложения (в панели есть в `src/ui`), `Sheet`, `HeroCard` с фото.
- **Запрещённые дубли:** свои DTO/схемы райда в приложении; вычисление на клиенте «полон / можно записаться /
  можно править / фаза» (только `viewer`, `full`, `phase` сервера; клиент — отображение); перевод времени вне
  `time.ts`; второй справочник городов (только `CITY_CODES` + `domain.city.*`); запись в `rides` вне
  `RidesRepository`; транзакции для участия (одна атомарная операция); свой `fetch` в экранах (SSR —
  `public-ssr.ts`); `Platform.OS` в экранах (шаринг — файлами `share-link(.web).ts`); `Share`/`navigator.share`/
  `Clipboard` вне `share-link`; hex/px; строки вне `@pokatim/i18n`; ручные копии `withAccessToken`.
- **Пакеты:** новых нет. `packages/*` не трогаются, кроме contracts / api-client / i18n. Модуль API — папка.
- **Тонкие контроллеры:** pipe (zod), `@CurrentUser()`, вызов сервиса, заголовок кэша; правила — `rides.policy.ts`,
  оркестрация — сервисы.

# 6. Relevant Files

- `apps/api/src/modules/calendar/*` — образец: публичный контроллер, сервис, репозиторий, курсор, int-тесты.
- `apps/api/src/modules/profile/profile.controller.ts` — образец `AuthGuard` + `no-store`.
- `apps/api/src/modules/devices/devices.service.ts` (`rateLimiter.consume` → `RATE_LIMITED` + `retryAfterSec`).
- `apps/api/src/{app.module,public-read.guard,page-cursor,error-messages}.ts`,
  `apps/api/src/db/migrations/{index,0002_identity,0008_calendar,migrations.int.test}.ts`.
- `apps/api/test/{harness,identity}.ts` — стенд, вошедший пользователь.
- `packages/contracts/src/{common,time,index}.ts`, `src/calendar/calendar-public.schema.ts` (образец ответа).
- `packages/api-client/src/index.ts` (+ тесты рядом).
- `apps/app/src/app/{_layout.tsx,(tabs)/rides.tsx,(tabs)/index.tsx,calendar/[id].tsx}`.
- `apps/app/src/features/{calendar,home}/*`, `src/features/auth/{authorized,registration-store,session-store}.ts`,
  `src/features/onboarding/onboarding-store.ts`.
- `apps/app/src/components/{section-hero,detail-header,stat-block,filter-group,offline-banner}.tsx`,
  `src/lib/{public-ssr,page-metadata,minsk-format,use-minsk-clock,open-external-url}.ts`.
- `apps/app/e2e/{web.spec,schedule-fixture,urls}.ts`; `packages/i18n/src/ru.ts`.

# 7. Implementation Notes

## Модель данных (`rides`, миграция `0014_rides`)

```ts
interface RideDoc {
  _id: string;                       // uuidv7
  status: 'published' | 'cancelled';  // RIDE_STATUSES; 'hidden' добавит 05b — в конец
  organizerUserId: string;
  title: string;                     // 3–80, SINGLE_LINE, trim
  description: string | null;        // ≤ 1000, MULTI_LINE; пусто → null
  startsAt: Date;                    // UTC, минута
  cityCode: CityCode;                // справочник
  place: string;                     // 3–120, SINGLE_LINE
  distanceKm: number;                // целое 5–300
  paceMinKmh: number; paceMaxKmh: number; // целые 10–45, min ≤ max
  limit: number | null;              // 2–100 (включая организатора); null — «без ограничения» (потолок 100)
  participants: { userId: string; joinedAt: Date }[]; // организатор — первый
  goingCount: number;                // = participants.length (держит та же операция)
  cancelReason: RideCancelReason | null; cancelledAt: Date | null;
  rescheduledAt: Date | null;        // время/город/место изменены при goingCount > 1
  createdAt: Date; updatedAt: Date;
  version: number;                   // только правки организатора; участие version не трогает
}
```

Индексы (`0014_rides`): `rides_feed_idx { startsAt: 1, _id: 1 }`; `rides_city_feed_idx { cityCode: 1, startsAt: 1,
_id: 1 }`; `rides_participant_idx { 'participants.userId': 1, startsAt: 1 }` (multikey: отменённые зрителя в ленте,
квота отметок, будущее удаление аккаунта); `rides_organizer_idx { organizerUserId: 1, startsAt: -1 }` (квота,
удаление аккаунта). Валидация документа — типы + int-тесты (R5 `pokatim-db.md`), `$jsonSchema` нет.

## Операции репозитория (один документ, без транзакций)

- **Создание:** `insertOne` с `participants: [{ organizer }]`, `goingCount: 1`, `version: 0`.
- **«Я иду»:** `findOneAndUpdate({ _id, status: 'published', startsAt: { $gt: now }, 'participants.userId':
  { $ne: uid }, $expr: { $lt: ['$goingCount', { $ifNull: ['$limit', RIDE_MAX_PARTICIPANTS] }] } }, { $push:
  { participants: { userId: uid, joinedAt: now } }, $inc: { goingCount: 1 }, $set: { updatedAt: now } })`. `null` →
  чтение документа и классификация: нет/скрыт — 404; уже участник — идемпотентный успех (200, текущее состояние);
  отменён или `startsAt ≤ now` — 409 `RIDE_INVALID_STATE`; полон — 409 `RIDE_FULL`.
- **«Не иду»:** `findOneAndUpdate({ _id, status: 'published', startsAt: { $gt: now }, organizerUserId: { $ne: uid },
  'participants.userId': uid }, { $pull: { participants: { userId: uid } }, $inc: { goingCount: -1 } })`. `null` →
  не участник — идемпотентный успех; организатор, отменён, после старта — 409 `RIDE_INVALID_STATE`.
- **Правка:** `findOneAndUpdate({ _id, organizerUserId: uid, version, status: 'published', startsAt: { $gt: now },
  ...(limit !== null ? { goingCount: { $lte: limit } } : {}) }, { $set, $inc: { version: 1 } })`; `null` →
  классификация: чужой/нет — 404 (не 403, как владение гонкой); `version` устарела — 409 `CONFLICT`; отменён/после
  старта — 409 `RIDE_INVALID_STATE`; лимит ниже идущих — 400 `VALIDATION_FAILED` поле `limit`
  `RIDE_LIMIT_BELOW_GOING`. Гонка «правка лимита ↔ запись» закрыта тем, что обе — атомарные операции одного
  документа с условием в фильтре.
- **Отмена:** `findOneAndUpdate({ _id, organizerUserId: uid, status: 'published', startsAt: { $gt: now } }, { $set:
  { status: 'cancelled', cancelReason, cancelledAt: now }, $inc: { version: 1 } })`; уже отменён — идемпотентный
  успех; чужой — 404; после старта — 409 `RIDE_INVALID_STATE`.
- **Квоты** (`RIDES_POLICY.maxUpcomingOrganized = 5`, `maxUpcomingJoined = 20`): `countDocuments` до операции;
  условие по другим документам — **принятая гонка** (превышение на единицу при параллельных запросах безвредно,
  основной барьер — лимит частоты Redis), комментарий в репозитории (`pokatim-db.md` «принятая гонка с
  комментарием»).
- **Проекции:** публичные чтения исключают `participants`, `organizerUserId`, `version`; роль зрителя — проекция
  `participants: { $elemMatch: { userId: uid } }` + сравнение `organizerUserId` в сервисе (чужие id не читаются в
  ответ). Ответы собирает сервис из явного списка полей (не `...doc`).

## Правила (`rides.policy.ts`, `RIDES_POLICY`, `[ASSUMPTION]` — Q8)

- Время старта: при создании и при изменении `startsAt` — `≥ now + 30 мин` (`RIDE_START_IN_PAST`, текст «Эта дата
  уже прошла — выберите дату в будущем.» / «Старт — не раньше чем через 30 минут.» по случаю) и `≤ now + 60 дней`
  (`RIDE_START_TOO_FAR`). Неизменённое `startsAt` при правке не проверяется (правка описания за 10 минут до старта —
  можно).
- `ridePhase(doc, now)`: `cancelled` (статус) → `past` (`now ≥ startsAt`) → `upcoming`. «Я иду», «Не иду», правка,
  отмена — только `upcoming`.
- `rideViewer(doc, uid | null, now)` → `{ role: 'organizer' | 'participant' | 'none', canJoin, canLeave, canManage }`
  (сервер — источник прав, клиент только отображает). `full = goingCount ≥ (limit ?? RIDE_MAX_PARTICIPANTS)`.
- `rescheduledAt`: ставится правкой, меняющей `startsAt`, `cityCode` или `place`, если `goingCount > 1`.

## API (`/v1`)

| Метод и путь | Гард | Кэш | Тело / query → ответ |
|---|---|---|---|
| `GET /rides?city&cursor&limit` | `AuthGuard` | `no-store` | `RideListQuery` → `RidePage { items: RideCard[], nextCursor }` |
| `GET /rides/cities` | `AuthGuard` | `no-store` | → `RideCities { cities: CityCode[] }` (по алфавиту подписи — клиент) |
| `GET /rides/:id` | `PublicReadGuard` | `public, max-age=60` | → `RideDetail` (без зрителя); 404 — нет |
| `GET /rides/:id/me` | `AuthGuard` | `no-store` | → `RideView { ride: RideDetail, viewer: RideViewer }` |
| `POST /rides` | `AuthGuard` | — | `CreateRideRequest` → 201 `RideView` |
| `POST /rides/:id` | `AuthGuard` | — | `UpdateRideRequest` (+ `version`) → `RideView` |
| `POST /rides/:id/cancel` | `AuthGuard` | — | `CancelRideRequest { reason }` → `RideView` |
| `POST /rides/:id/join` | `AuthGuard` | — | `{}` → `RideView` |
| `POST /rides/:id/leave` | `AuthGuard` | — | `{}` → `RideView` |

- Глаголы — как у панели гонок (`POST :id`, `POST :id/cancel`). `rides.controller.ts` (вся авторизованная часть,
  включая `GET rides/cities`) регистрируется **до** `rides-public.controller.ts`; int-тест: `/v1/rides/cities` без
  входа — 401 (не 400 от pipe `Uuid`), с входом — 200.
- Лента: `startsAt > now` и (`status: 'published'` или `status: 'cancelled'` и `participants.userId = uid`), фильтр
  `cityCode ∈ city[]` (≤ 12), сортировка `(startsAt, _id)`, курсор `encodeCursor(startsAt ISO, _id)`, `limit`
  1–50 (по умолчанию 20). `RideCard.viewer` — у каждой карточки.
- `RideCard`: `id`, `title`, `startsAt` (ISO UTC), `city: tolerantEnum(CITY_CODES)`, `place`, `distanceKm`,
  `paceMinKmh`, `paceMaxKmh`, `limit`, `goingCount`, `full`, `phase: tolerantEnum(RIDE_PHASES)`, `cancelReason:
  tolerantEnum(RIDE_CANCEL_REASONS).nullable()`, `rescheduledAt` (ISO | null), в ленте — `viewer`. `RideDetail` —
  то же + `description`. Наружу нет: `organizerUserId`, участники, `version`, `createdAt`. `RideView.ride` для
  организатора добавляет `version` (`RideDetailForOrganizer`) — нужна форме правки.
- Справочники (только в конец): `RIDE_PHASES = ['upcoming', 'past', 'cancelled']`; `RIDE_CANCEL_REASONS =
  ['weather', 'organizer_unavailable', 'low_turnout', 'road_conditions', 'other']` (подписи: «плохая погода»,
  «организатор не может», «мало участников», «состояние дороги», «другое»); `CITY_CODES` — Q3.
- Лимиты частоты (`RateLimiter` базы, ключ — `uid`; 429 + `retryAfterSec`): `rides-create` 10 / 24 ч,
  `rides-manage` (правка, отмена) 30 / ч, `rides-rsvp` (join + leave) 60 / ч. Публичная карточка — `public-read`.
- Ошибки: `404 NOT_FOUND`, `409 CONFLICT`, `409 RIDE_FULL`, `409 RIDE_INVALID_STATE`, `409 RIDE_QUOTA_EXCEEDED`,
  `400 VALIDATION_FAILED` (поля), `429 RATE_LIMITED`, `401 UNAUTHORIZED`. Тексты — `error-messages.ts`.
- Логи: `rides.created|updated|cancelled ride=<id> uid=<id>`; без названий, описаний, мест (UGC) и e-mail.

## Приложение

- **Ключи запросов:** `['rides','list',{ city, limit: 20 },'pages']` (`useInfiniteQuery`, города отсортированы),
  Главная — `['rides','list',{ limit: 1 }]`; `['rides','cities']`; публичная карточка `['rides','detail',id]`, зритель
  `['rides','detail',id,'me']` (только вошедшим, `enabled: signedIn`; `placeholderData` — публичные данные/посев).
  Все запросы ленты и `me` — через `withAccessToken`. `staleTime` ленты 30 с (данные зрителя меняются), без polling.
- **Мутации** (`networkMode: 'always'`): ответ `RideView` → `setQueryData(['rides','detail',id,'me'])`, затем
  `invalidateQueries(['rides'])` (лента, Главная, города, публичная карточка). Кнопка на время запроса — disabled с
  индикатором; ошибки — баннер у действия: `RIDE_FULL` — «Мест нет — все {limit} мест заняты.», `RIDE_INVALID_STATE`
  — «Райд уже начался или отменён.», 429 — «Слишком часто. Повторите через {n} с.», сеть — «Нет соединения».
- **`RideGoingAction`** (лента, герой, Главная, карточка) — по `viewer` + `full` + `phase`: `canJoin` → «Я иду»;
  `role === 'participant'` → «Вы идёте» (в ленте — текст; на карточке — баннер + «Не иду»); `organizer` → «Вы
  организатор» (текст); `full && !canJoin` → «Мест нет» (лента) / выключенная «Я иду» с причиной (карточка);
  `cancelled` → «Райд отменён»; `'unknown'` роль/фаза — без действия (нейтрально).
- **Стопка:** `AvatarStack` с `min(goingCount, 4)` пустыми квадратами; подпись — `rides.going.*` с плюралами:
  «идёт 1 из 12 · вы», «идут 5 из 12», «идут 7» (без лимита), «· вы в списке», прошедший — «ехали 9».
- **Даты:** вкладка — «Сб 3 октября, 9:00» (год — если не текущий), подписи дней — «Воскресенье, 4 октября»; публичная
  карточка — всегда с годом (`now = null`), «сегодня/завтра» — после монтирования (как блок 03); темп — «22–24 км/ч»
  (обычное тире без пробелов; `min === max` — «25 км/ч»).
- **Форма:** `react-hook-form` + `zodResolver(CreateRideForm)` — схема contracts для полей формы (`date: LocalDate`,
  `time: LocalTime` + общие поля); в запрос — `startsAt = minskWallTimeToUtc(`${date}T${time}`)`, ошибки сервера
  поля `startsAt` → под «Дата». Город — `FilterGroup`-подобный одиночный выбор из `CITY_CODES` (подписи
  `domain.city.*`, по алфавиту; список длинный — свёрнут до 8 + «Все города», [ASSUMPTION] до компонента `Picker`
  базы). Правка — те же поля из `RideView.ride` + `version`. Выход с несохранёнными изменениями — без подтверждения
  (как формы онбординга) [ASSUMPTION].
- **Возврат после входа (Q13):** `features/auth/return-path.ts` — память процесса (web — ещё `sessionStorage`
  вкладки), значение — только путь, проходящий allowlist `^/(rides|races|calendar)/<uuid>$`; ставит карточка райда
  при «Я иду» гостя, читает и снимает корневой layout один раз, когда `signedIn && step === 'done'` (`router.replace`).
  Действие «Я иду» после возврата не выполняется автоматически — райдер нажимает сам [ASSUMPTION: явное действие
  лучше неожиданной записи].
- **Шаринг:** текст сообщения — «{название} — {дата}, {время}, {город}» + ссылка; `EXPO_PUBLIC_WEB_ORIGIN` не задан
  (dev native) — кнопки «Поделиться» нет; web — `window.location.origin`.

# 8. Risks / Assumptions / Open Questions

Все Q — с решением по умолчанию (рекомендация архитектора); блокирующих нет. Продуктовые — продублированы в «Вопросы
автору» в конце файла.

| # | Вопрос | Решение по умолчанию |
|---|---|---|
| Q1 | «Рядом» без геопозиции и координат | Лента по времени + фильтр «Город»; «рядом», «в N км», баннер геопозиции — блок «Карта и рядом» (ADR про тайлы/геокодер). Заголовки без «рядом с вами». |
| Q2 | Место старта: точка на карте или адрес | Город из справочника + место текстом; карта/точка — с блоком «Карта и рядом». |
| Q3 | Город: свободный текст или справочник | Справочник `CITY_CODES` (коды латиницей, подписи в i18n): Минск, Брест, Витебск, Гомель, Гродно, Могилёв, Барановичи, Бобруйск, Борисов, Пинск, Орша, Мозырь, Солигорск, Новополоцк, Лида, Молодечно, Полоцк, Жлобин, Светлогорск, Речица, Слуцк, Жодино, Кобрин, Слоним, Волковыск [ASSUMPTION]; поле «Ближайший город». Свободный текст загрязнял бы чипы фильтра всем (UGC). Только в конец. |
| Q4 | Имя организатора, список участников | Нет (у аккаунта нет имени): метка «Кофе-райд» / «… · вы организатор», стопка — пустые квадраты по числу. |
| Q5 | Уведомление участников об отмене/переносе | Центра уведомлений нет: отменённый райд остаётся в ленте участника с «Райд отменён», карточка — баннер с причиной; перенос — строка на карточке. Outbox-событий не пишем (нет потребителя). |
| Q6 | Причина отмены: текст или справочник | Справочник `RIDE_CANCEL_REASONS` (обязателен) — без модерации свободного текста; «другое» без комментария. |
| Q7 | Индексация публичных карточек | Всегда `robots: noindex` (UGC, место встречи); ссылка работает для шеринга. |
| Q8 | Ограничения полей и квоты | Название 3–80, место 3–120, описание ≤ 1000, дистанция 5–300 км, темп 10–45 км/ч, лимит 2–100 (с организатором), старт ≥ +30 мин и ≤ +60 дней; ≤ 5 будущих своих райдов, ≤ 20 будущих отметок; частота — §7 [ASSUMPTION]. |
| Q9 | Лист ожидания | Нет (OQ5 прототипа закрыт): «Мест нет», отменённая отметка освобождает место. |
| Q10 | Когда райд «прошёл» | С момента старта (`now ≥ startsAt`): запись, правка и отмена закрываются; баннер «Райд уже прошёл». |
| Q11 | Лента: прошедшие и отменённые | Прошедших нет; отменённые будущие — только участникам и организатору (§7 «API», лента). |
| Q12 | Правка после записи участников | Можно всё до старта; лимит не ниже идущих; перенос времени/места — `rescheduledAt` и строка на карточке. |
| Q13 | Гость нажимает «Я иду» | «Вход» с возвратом к райду (Q13); запись — повторным нажатием. |
| Q14 | Модерация | 05b до прода: жалобы из приложения, очередь в панели, скрытие (Приложение C); 05a не выпускается в сторы/прод без 05b (release-чеклист). |
| Q15 | Время старта в форме: шаг | Любые минуты (`TimeField`), без сетки 15 мин [ASSUMPTION]. |
| Q16 | Число мест «без ограничения» | Технический потолок 100 (`RIDE_MAX_PARTICIPANTS`), подпись «идут N» без «из». |

**Риски**
- **Порядок миграций:** `0014_rides` после `0013_routes` (PR #33). Слияние 05a раньше #33 ломает `db:migrate` на dev
  (дыра в журнале). Снижение: AC-T6, проверка в pr.md, merge-порядок «#33 → 05a».
- **Злоупотребления UGC до 05b:** спам-райды, оскорбительные названия, фейковые места. Снижение: лимиты и квоты,
  `noindex`, нет ссылок/разметки в описании, причины отмены — справочник; выпуск в прод/сторы — только с 05b.
- **Гриферство мест** (накрутка «Я иду» фейковыми аккаунтами): аккаунт требует подтверждённого e-mail, лимиты
  частоты, квота 20 отметок; исключения участников нет (нет имён) — вернуться с профилем/модерацией.
- **Регион без «рядом»:** райдер из Гомеля видит на Главной ближайший по времени райд Минска — до блока «рядом»
  (фильтр «Город» есть во вкладке, на Главной — нет; запоминание города — follow-up).
- **Свежесть числа идущих у гостя:** публичная карточка кэшируется до 60 с (+ SSR-кэш 60 с) — принято; вошедший видит
  `me` без кэша.
- **Зависимость от базы (S0):** без `TimeField` и многострочного поля форма деградирует (фолбэк §5.1).
- **Коды ошибок:** PR #33 и 05a дописывают в конец одних и тех же списков — конфликт слияния тривиален, порядок
  `ROUTE_*` → `RIDE_*`.

# 8.1 Requirements Consistency (architect)

- **Конфликт с рамками MVP / инвариантом §4.9:** прототип — «Кофе-райды рядом с вами», «в 3 км от вас», шапка-карта,
  точка старта. Координаты требуют карты (MapLibre + тайлы) или геокодера — внешние сервисы, ADR; геопозиция —
  только foreground «рядом». → Варианты: (a) **05a без координат, лента по городу и времени, «рядом» — отдельный
  блок с ADR** (рекомендация); (b) «Старт — моя текущая геопозиция» при создании (организатор редко создаёт райд на
  месте старта — неверные точки); (c) ввести MapLibre + MapTiler в этом блоке (внешний сервис, ключ, ADR, рост
  scope вдвое). Принято (a).
- **Противоречие в источнике:** форма прототипа — поле «Маршрут» с подстановкой дистанции и карта маршрута на
  карточке; библиотека маршрутов для райдеров не существует (`routes` v1 — `origin: 'platform'`, ADR-0012). →
  Маршрута в 05a нет, дистанция — ввод; `routeId` — expand-полем с блоком «Маршруты».
- **Недоопределено (не блокирует):** имя организатора и участники в прототипе есть, в модели аккаунта — нет (имя не
  спрашивается, `key-home`). → Q4 (без имён), вопрос автору.
- **Недоопределено:** «уведомление участников» об отмене — центра уведомлений и push нет (§1), A11 эпика — модуль
  `notifications`. → Q5: видимость в ленте/карточке; событие — с модулем уведомлений.
- **Вредное решение (если брать прототип буквально):** публичная карточка с UGC и точным местом встречи индексируется
  и попадает в OG/превью мессенджеров → спам-SEO и приватность места. → (a) **`noindex` всегда, OG без описания,
  подсказка «людное место»** (рекомендация); (b) место только участникам (ломает приглашение: прототип кладёт место
  на карточку-приглашение); (c) индексировать. Принято (a), вопрос автору о (b).
- **Вредное решение:** свободный текст города (как у календаря) — UGC попадает в чипы фильтра всем райдерам. →
  справочник (Q3).
- **Конфликт с правилом `pokatim-app.md` «Главная»:** «Данные раздела — публичный list-эндпоинт домена». Лента райдов
  зависит от зрителя (роль, отменённые свои) → эндпоинт под `AuthGuard`, `no-store`. Правило обновляется (§10):
  «list-эндпоинт домена; зависящий от зрителя — под `AuthGuard`».
- **Конфликт с инвариантом §4.11:** многострочное поле, поле времени и суффикс единиц отсутствуют в `@rkarakulov/ui`
  0.4.1 → S0 в app-foundation (не продуктовый компонент в проекте), фолбэк описан.

# 8.2 Deviations from spec

**Решения автора (2026-10-27)** — ответы на «Вопросы автору»:
- D1 (вопрос 1). Место встречи видно всем (рекомендация): гостям и в публичной карточке; `noindex`, подсказка
  «людное место».
- D2 (вопрос 4, отклонение от Q4). Имя организатора — **необязательное поле «Как вас подписать»** в форме райда
  (`organizerName`, пусто → `null`, на карточке — «Организатор: {подпись}» или «Организатор»). Добавляется в модель (`RideDoc.
  organizerName: string | null`), контракты (`RideFields`, `RideCard`/`RideDetail`), форму и карточку. Ограничения
  символов — как у названия (`SINGLE_LINE`, trim); длина 2–80 (решение оркестратора, ревью pass 1: «Ян»). ПДн сверх введённого самим организатором нет: имя
  аккаунта не читается, e-mail не показывается; в OG/мета имени нет.
- D3 (вопрос 2). «Рядом» и карта — отдельный блок, вне scope (рекомендация, Q1).
- D4 (вопросы 3, 5, 6, 7). По рекомендациям архитектора: справочник ~25 городов (Q3), лимит необязательный без листа
  ожидания (Q9, Q16), 05b (модерация) обязателен до прода (Q14), отмена — причина из справочника (Q6).

**Решения оркестратора**
- O1 (S0). Релиз app-foundation в этом PR не делается: запасной вариант §5.1 — локальные поля в `apps/app`
  (время — `TextField` с маской `ЧЧ:ММ` и `LocalTime`, описание — однострочное до релиза, единицы — в подписи поля).
  Follow-up — §12.
- O2. Миграция — `0014_rides` после `0013_routes` (PR #33 уже в develop).
- O3. Тестовые прогоны — на своих БД (Mongo `pokatim_rides_test`, Redis `/8`; e2e — `pokatim_rides_e2e`, Redis `/9`,
  свой Mailpit): общие `pokatim_test` и Redis `/1` делят параллельные агенты.

**Отклонения реализации (coder)**
- C1. «Я иду» / «Не иду» — без тела запроса (как `devices/:provider/sync`): схема `RideRsvpRequest` из §11 не введена —
  параметр `@Body` без использования запрещает линт, а действие целиком задают путь и access. Клиент шлёт `{}`.
- C2. `RideQuotaDetails { quota: 'organized' | 'joined', limit }` — `details` у `409 RIDE_QUOTA_EXCEEDED` (текст баннера
  «У вас уже {n} будущих райдов» берёт `n` с сервера). `RIDE_FIELD_ERROR_CODES` вынесены константой (как
  `SCHEDULE_FIELD_ERROR_CODES`), порядок кодов полей — прежний + `RIDE_*` в конце.
- C3. `optionalText` перенесён из `calendar.schema.ts` в `common.ts` без смены поведения (переиспользован райдами).
- C4. `apps/app/eas.json` не меняется: `EXPO_PUBLIC_API_URL` там тоже нет — публичные значения сборки задаёт EAS env
  профиля; `EXPO_PUBLIC_WEB_ORIGIN` описан в `docs/runbooks/deploy.md` (release-чеклист) и `.env.example`.
- C5. Подпись дня ленты и дата героя — с годом, только если год не текущий (как блок 03); время — «9:00» без ведущего
  нуля (прототип). Дата героя — одной строкой в `SectionHero.date.value`.
- C6. После отмены и сохранения правки — назад к карточке в стеке (без истории — замена); права экрана управления
  (`canManage`) берутся по первому ответу `me`, иначе собственная отмена закрывала бы экран до перехода.
- C7. Смоук: гость видит отмену после истечения кэша публичной карточки (до 60 с ответа API + 60 с SSR-кэша
  web-сервера, риск §8) — шаг ждёт перезагрузками до 150 с, отмену в API проверяет сразу.
- C8. Город в форме — «Минск» первым (решение оркестратора, ревью pass 1), дальше по алфавиту; свёрнуто до 8 + «Все
  города» (выбранный виден всегда) [ASSUMPTION до `Picker` базы].

**Ревью pass 1 (Codex + Claude, REQUEST CHANGES) — исправления**
- R1. `rescheduledAt` ставит сама запись: pipeline-обновление (значения — `$literal`) с `$cond` по `goingCount` документа
  в момент правки; сервис решает только «меняются ли время, город, место» (`changesStart`).
- R2. Карточка: `me` упал при публичных данных — баннер «Не удалось загрузить» + «Повторить» (`me.refetch`), действия —
  после успешного повтора. Вкладка: ошибка городов — текст и «Повторить» на месте ряда, при показанных чипах — под ними.
- R3. Правка: `me` экранов управления без фонового обновления; форма держит `version` и значения загрузки до явного
  «Обновить», отправляет только изменённые поля; сбой «Обновить» — конфликт и введённое остаются, ошибка с повтором.
- R4. «Я иду» сверх квоты отметок — «У вас уже N будущих отметок…» (`RideQuotaDetails`); форма создания — только квота
  своих райдов. Маска времени: «9:30» → «09:30».
- R5. Путь возврата гостя живёт 30 минут (`{ path, at }`; web — JSON в `sessionStorage`).
- R6 (a11y, отклонение). Роль `radio` и `checked` у `Chip` и подсказка у `Button` — только в базе: `@rkarakulov/ui`
  0.4.1 их не принимает, правка базы на месте запрещена. Сейчас: убрана ложная роль `radiogroup` (выбор — состояние
  `selected` чипа), причина «Мест нет» — видимый баннер над выключенной кнопкой. Follow-up в app-foundation: вариант
  `Chip` с ролью `radio`, `accessibilityHint` у `Button` / `DisabledReason`.

# 8.3 Security checklist

Зона: новый модуль с UGC, публичное чтение, авторизованные мутации — `security.md` + `pokatim-security.md`
обязательны (пути `apps/api/src/modules/rides/**` добавляются в `paths:` `pokatim-security.md`, §10).

- **AuthN/AuthZ:** все мутации, лента, города, `me` — `AuthGuard` (ADR-0008); пользователь — только
  `@CurrentUser()`, не из тела/пути. Владение — фильтр `organizerUserId: uid` в той же атомарной операции; чужой
  райд для правки/отмены — 404 (не 403). Организатор «Не иду» — 409. Публичный `GET /rides/:id` — только чтение.
  `GET /rides/cities` не перехватывается `:id` (int-тест).
- **Входные данные:** `z.strictObject` на всех запросах; строки — `SINGLE_LINE`/`MULTI_LINE`, длины, trim; числа —
  целые с диапазонами; `startsAt` — `UtcMinute` + окно сервера по `CLOCK`; `cityCode`, причина — строгие `z.enum`;
  `id` — `Uuid` pipe; курсор — `decodeCursor` (zod, только примитивы в фильтре); `queryArray(city, 12)`. Никаких
  регулярных выражений из ввода в запросах MongoDB, `$`-строки в pipeline-обновлениях нет.
- **Данные наружу:** ответы без `organizerUserId`, id участников, `version` (кроме организатору), e-mail, координат;
  роль зрителя — из `$elemMatch` своего id. OG/мета — название, дата, город, дистанция, темп; без описания и ПДн;
  `noindex`. Описание показывается как текст: без HTML, без автоссылок (`Text selectable`), SSR экранирует.
- **Злоупотребления:** лимиты частоты `rides-create` / `rides-manage` / `rides-rsvp` (по `uid`), квоты будущих
  райдов (5) и отметок (20) — принятая гонка на единицу; `public-read` на карточке; тело запроса — глобальный лимит
  64 КБ; потолок участников 100 (размер документа). Жалобы и скрытие — 05b до прода.
- **Секреты и логи:** новых секретов нет; `EXPO_PUBLIC_WEB_ORIGIN` — публичное значение (бандл). Логи — id райда и
  `uid`, без UGC-текста и e-mail; отказы гарда — без лога (ADR-0008).
- **Аудит:** решений команды в 05a нет; модерация (05b) — append-only. Отмена организатором — состояние документа
  (`cancelReason`, `cancelledAt`), не журнал.
- **Клиент:** возврат после входа — только allowlist путей `^/(rides|races|calendar)/<uuid>$` (не open redirect);
  шаринг — только собственный origin; `withAccessToken` для всех авторизованных вызовов.

# 9. Acceptance Criteria

**Функциональные**
- AC1. Вошедший райдер создаёт райд со всеми полями; карточка показывает «Кофе-райд · вы организатор», «идёт 1 из N ·
  вы», «Изменить», «Отменить райд», «Поделиться»; после публикации — баннер «Райд опубликован».
- AC2. Другой райдер видит райд во вкладке «Райды» (герой или строка дня) и на Главной; «Я иду» → «Вы идёте»,
  счётчик +1, на карточке — баннер «Вы идёте · …» и «Не иду»; «Не иду» возвращает «Я иду», счётчик −1.
- AC3. Райд с лимитом N при N идущих: в ленте «Мест нет», на карточке выключенная «Я иду» с причиной; запрос
  «Я иду» — 409 `RIDE_FULL`; отметка одного из участников снимается → место освобождается.
- AC4. Организатор правит райд; лимит ниже числа идущих — ошибка под полем; правка по устаревшей версии — 409 и
  баннер «Обновить»; перенос времени при других участниках — строка «Время или место старта изменены …».
- AC5. Организатор отменяет райд с причиной: карточка — «Райд отменён. Причина: …», без «Я иду»/«Поделиться»;
  участник видит отменённый райд в ленте с «Райд отменён»; не участник — не видит в ленте, по ссылке — видит баннер.
- AC6. Прошедший райд по ссылке — «Райд уже прошёл · …», «ехали N», без действий; в ленте его нет.
- AC7. Фильтр «Город»: чипы — только города с видимыми будущими райдами; выбор фильтрует ленту; пусто — «Ничего не
  найдено» + «Сбросить фильтры».
- AC8. Гость по ссылке `/rides/<id>` (web без входа, native до входа) видит карточку; «Я иду» → «Вход»; после входа —
  снова карточка райда. Deep link `pokatim://rides/<id>` открывает карточку.
- AC9. Web: `/rides/<id>` отдаёт HTML с названием, датой и OG (без описания, e-mail, id пользователей), `robots:
  noindex`; неизвестный id — HTML 200 + нейтральная мета + `noindex`, после гидрации — «Райд не найден».
- AC10. Форма: дата в прошлом — «Эта дата уже прошла — выберите дату в будущем.», «Опубликовать» выключена с
  причиной; ошибки полей сервера — под полями; 429 и квота — баннеры с понятным текстом.
- AC11. Все состояния §4.12 на ленте, карточке, разделе Главной (скелетон, сеть, сервер, обновление, пусто, офлайн).
- AC12. iOS, Android, web (мобильный и десктопный браузер) — тот же функционал; «Поделиться» — share sheet / Web
  Share / копирование со «Ссылка скопирована».

**Технические**
- AC-T1. Участие — одна атомарная операция над документом райда: параллельные «Я иду» на последнее место — ровно одна
  успешна (int-тест), **отрицательное доказательство**: убрать `$expr` лимита из фильтра → тест краснеет по
  результату (`goingCount > limit`), результат — в §12.
- AC-T2. Повторное «Я иду» / «Не иду» идемпотентно (200, без двойного счёта); `goingCount === participants.length`
  после любых последовательностей (int-тест-инвариант).
- AC-T3. Ответы `GET /rides/:id`, ленты, `me` не содержат `organizerUserId`, id участников (кроме своей роли),
  `version` (кроме организатору) — int-тест по ключам JSON.
- AC-T4. `GET /v1/rides/:id` — `Cache-Control: public, max-age=60`, IP-лимит `public-read`; лента/`me`/города —
  `no-store`, без входа — 401; `/v1/rides/cities` не уходит в pipe `Uuid`.
- AC-T5. Лимиты частоты отдают 429 + `Retry-After`/`retryAfterSec`; квоты — 409 `RIDE_QUOTA_EXCEEDED`.
- AC-T6. `0014_rides` идёт после `0013_routes` в `migrations/index.ts`; `migrations.int.test.ts` видит индексы;
  миграция повторяема (чистая БД, с develop, повтор).
- AC-T7. Enum-ы ответов — `tolerantEnum`; приложение на `'unknown'` (фаза, роль, город, причина) показывает
  нейтральный вариант без падения (unit).
- AC-T8. `pnpm check` зелёный; `pnpm e2e:web` (с `E2E_API=1`) — новые шаги зелёные; `build:web` + `curl` карточки.

**Архитектурные**
- AC-A1. Модуль `rides` импортирует только `identity` (index), общие `src/*.ts` и базу; `pnpm arch:check` зелёный.
- AC-A2. Нет дублей §5.1 (схемы, время, справочник городов, `Platform.OS`, hex/px, строки вне i18n).
- AC-A3. Новые компоненты базы — только через релиз app-foundation (S0) или зафиксированный фолбэк в §8.2.

# 10. Documentation Impact

- **ADR-0013 «Кофе-райды»** — новый, статус Proposed (черновик — Приложение B); строка в `docs/adr/README.md`.
  Перевод в Accepted — после ревью 05a.
- `docs/product/rides.md` — **новый**: сущность, жизненный цикл (опубликован → отменён; фаза по времени), правила
  участия и лимита, видимость (лента, публичная карточка, noindex), справочники (города, причины отмены), что скрыто и
  до каких блоков, ответы на Q1–Q16 / ответы автора; `docs/product/README.md` — строка.
- `docs/product/home.md` — «Кофе-райды» в составе v1 (шапка, герой, «Я иду», «Все райды»), строка таблицы «скрыто»
  обновить (остаются фото, «рядом»).
- `docs/product/races-and-seasons.md` — строка «Кофе-райд»: ссылка на `rides.md` вместо «не в этом слайсе».
- `docs/architecture/README.md` — `rides` в списке «Есть»; поток «Кофе-райд» (лента/карточка/участие одной операцией).
- `.claude/rules/pokatim-backend.md` — `rides` в «Есть»; публичное чтение `GET /v1/rides/:id`; лента под
  `AuthGuard`; лимиты частоты.
- `.claude/rules/pokatim-db.md` — раздел «Кофе-райды»: встроенные участники, правило «участие — одна атомарная
  операция», квоты — принятая гонка, обязательства удаления аккаунта (отменить будущие свои райды причиной
  `organizer_unavailable`, `$pull` себя из будущих райдов с `$inc goingCount −1`, прошедшие — без изменений).
- `.claude/rules/pokatim-security.md` — `apps/api/src/modules/rides/**`, `apps/app/src/features/rides/**`,
  `apps/app/src/features/auth/return-path.ts` в `paths:`; пункт «Кофе-райды» (UGC, noindex, владение 404, лимиты).
- `.claude/rules/pokatim-app.md` — раздел «Кофе-райды (блок 05)»: ключи, `RideGoingAction`, мутации и инвалидация,
  `share-link(.web).ts`, `return-path.ts`, правка правила Главной про list-эндпоинт.
- `.claude/rules/pokatim-contracts.md` — `src/rides/ride.schema.ts`, `src/geo/city.schema.ts`, справочники только в
  конец.
- `docs/runbooks/local-dev.md` — `EXPO_PUBLIC_WEB_ORIGIN`; `docs/runbooks/deploy.md` — env сборки, release-чеклист:
  «Кофе-райды — не в сторы/прод без 05b (жалобы и модерация)»; `apps/app/.env.example`, `eas.json` (env профилей).
- `docs/tasks/2026-10-27-app-05-rides/{findings.md,pr.md}` — по ходу.

# 11. Implementation Context

**ENTRY POINTS**
- API: `apps/api/src/modules/rides/rides.module.ts` → `AppModule`; миграция `apps/api/src/db/migrations/0014_rides.ts`.
- App: `apps/app/src/app/(tabs)/rides.tsx`, `src/app/rides/{[id],new}.tsx`, `src/app/rides/edit/[id].tsx`,
  `src/app/rides/cancel/[id].tsx`, `src/app/_layout.tsx`, `src/app/(tabs)/index.tsx`.

**FILES TO MODIFY**
- `apps/api/src/app.module.ts`, `src/db/migrations/index.ts`, `src/error-messages.ts`.
- `packages/contracts/src/{common,index}.ts`; `packages/api-client/src/index.ts`; `packages/i18n/src/ru.ts`.
- `apps/app/src/app/{_layout.tsx,(tabs)/rides.tsx,(tabs)/index.tsx}`, `src/features/home/{sections,queries}.ts`,
  `src/lib/minsk-format.ts`, `src/__tests__/{app-routes.ts,home.test.tsx,tabs.test.tsx,public-metadata.test.ts}`.
- `apps/app/e2e/{web.spec.ts,urls.ts}` (+ фикстура райдов), `apps/app/.env.example`, `apps/app/eas.json`.
- Документы §10.

**FILES TO CREATE**
- API: `modules/rides/{index,rides.module,rides.collection,rides.repository,rides.policy,rides.service,
  rides-feed.service,rides.controller,rides-public.controller}.ts`, тесты `rides.policy.test.ts`,
  `rides.int.test.ts` (создание/правка/отмена/квоты/лимиты), `rides-participation.int.test.ts` (участие, гонки),
  `rides-feed.int.test.ts` (лента, города, публичная карточка, `me`, утечки); `apps/api/test/rides.ts` (хелперы).
- Contracts: `src/rides/ride.schema.ts` (+ `.test.ts`), `src/geo/city.schema.ts` (+ `.test.ts`).
- App: `src/features/rides/{queries,format,filters,ride-feed,ride-detail,ride-form,ride-cancel,ride-hero}.ts(x)`,
  `src/components/{ride-list-row,ride-going-action}.tsx` (+ тесты), `src/lib/share-link{,.web}.ts` (+ тесты),
  `src/features/auth/return-path{,.web}.ts` (+ тесты), `src/__tests__/{rides,ride-detail,ride-form}.test.tsx`.

**FILES TO READ**
- `apps/api/src/modules/calendar/*`, `modules/profile/profile.controller.ts`, `modules/devices/devices.service.ts`
  (лимит), `apps/api/test/{harness,identity,races}.ts`, `src/db/migrations/0008_calendar.ts`.
- `apps/app/src/features/calendar/{calendar-feed,calendar-detail,queries,filters,format}.ts(x)`,
  `src/app/calendar/[id].tsx`, `src/features/auth/{authorized,registration-store}.ts`, `src/features/home/*`.
- app-foundation: `packages/ui/src/components/ui/{text-field,date-field,date-field.web,avatar}.tsx`.

**TYPES & SCHEMAS** (`packages/contracts/src/rides/ride.schema.ts`, `src/geo/city.schema.ts`)
- `CITY_CODES`, `CityCode` (`z.enum`), `RIDE_STATUSES`, `RIDE_PHASES`, `RidePhase`, `RIDE_CANCEL_REASONS`,
  `RideCancelReason`, `RIDE_VIEWER_ROLES = ['organizer','participant','none']`.
- Лимиты: `RIDE_TITLE_MAX = 80`, `RIDE_PLACE_MAX = 120`, `RIDE_DESCRIPTION_MAX = 1000`, `RIDE_DISTANCE_KM = {min:5,
  max:300}`, `RIDE_PACE_KMH = {min:10,max:45}`, `RIDE_LIMIT = {min:2,max:100}`, `RIDE_MAX_PARTICIPANTS = 100`,
  `RIDE_LIST_MAX_LIMIT = 50`, `RIDE_START_MIN_LEAD_MIN = 30`, `RIDE_START_MAX_AHEAD_DAYS = 60`.
- Запросы: `RideFields` (общие поля), `CreateRideRequest`, `UpdateRideRequest` (+ `version: Version`),
  `CreateRideForm` (форма: `date`, `time` вместо `startsAt`), `CancelRideRequest`, `RideListQuery`.
- Ответы: `RideViewer { role, canJoin, canLeave, canManage }`, `RideCard`, `RideDetail`, `RideDetailForOrganizer`,
  `RideView { ride, viewer }`, `RidePage`, `RideCities`.
- Ошибки: `RIDE_FULL`, `RIDE_INVALID_STATE`, `RIDE_QUOTA_EXCEEDED` (конец `defineErrorCodes`); поля
  `RIDE_START_IN_PAST`, `RIDE_START_TOO_FAR`, `RIDE_PACE_ORDER`, `RIDE_LIMIT_BELOW_GOING` (конец
  `defineFieldErrorCodes`).
- API: `RideDoc`, `RIDES_COLLECTIONS`, `RIDES_INDEXES`, `RIDES_POLICY`, `ridePhase`, `rideViewer`, `validateStartsAt`.

**TESTS**
- unit (contracts): границы длин и чисел, `RIDE_PACE_ORDER`, `UtcMinute`, строгость запросов (лишний ключ — ошибка),
  `tolerantEnum` ответов (`'unknown'`), `CITY_CODES` уникальны.
- unit (api): `ridePhase` (граница `startsAt` ±1 мс), `rideViewer` (все роли × фазы × full), `validateStartsAt`
  (+30 мин, +60 дней, неизменённое при правке), `rescheduledAt`.
- int (реальный MongoDB, `apps/api/test/harness`): создание (201, организатор участник, квота 409, лимит 429);
  лента (порядок, курсор, город, только будущие, отменённые — только участникам/организатору, роль зрителя без чужих
  id, 401 без входа, `no-store`); города; публичная карточка (опубликованный/отменённый/прошедший, 404, невалидный
  id 400, без служебных полей, `public, max-age=60`, лимит `public-read`); `me`; участие: join/leave идемпотентны,
  `RIDE_FULL`, после старта/отменён — `RIDE_INVALID_STATE`, организатор leave — 409, квота отметок; **гонка**:
  `Promise.all` из K «Я иду» на 1 оставшееся место — одна успешна, `goingCount === participants.length ≤ limit`;
  отрицательное доказательство без `$expr`; правка: 409 `CONFLICT`, чужой — 404, лимит ниже идущих — поле, правка
  не ломается от параллельного join (version не трогается участием); отмена: идемпотентна, чужой 404, после старта
  409; `/v1/rides/cities` vs `:id`; миграция — индексы `0014` (`migrations.int.test.ts`).
- app (jest, TZ Europe/Minsk): лента (скелетон, ошибки, пусто ×2, группы дней поперёк страниц, герой, все варианты
  `RideGoingAction`, фильтр и снятие исчезнувшего города, догрузка); карточка (гость/участник/организатор/полный/
  прошедший/отменённый/не найден/`'unknown'`, баннер «опубликован», `rescheduledAt`); форма (дата в прошлом +
  причина, ошибки сервера под полями, 409, 429, квота, правка с `version`); отмена; Главная (раздел `rides`, порядок по
  `group_rides`, пусто); `format` (темп, плюралы стопки, даты с годом/без); `share-link(.web)`; `return-path(.web)`
  (allowlist, однократность); `app-routes.ts` (новые маршруты); `public-metadata.test.ts` (мета райда, `noindex`).
- e2e web (`E2E_API=1`, `apps/app/e2e/web.spec.ts`): райдер A (фикстура) создаёт райд через форму → видит во вкладке →
  гость открывает `/rides/<id>`: HTML с названием, OG без ПДн, `noindex` → райдер B входит, «Я иду» → «Вы идёте» →
  A отменяет → гость видит «Райд отменён». Без API: неизвестный райд — HTML 200, после гидрации «Нет соединения».
  Райды смоука — в ближайшие +59 дней, после проверки отменяются (видны только участникам смоука).

**OUT OF SCOPE** — §4; Приложение C (05b).

## Слайсы

| # | Слайс | Что | Файлы | Проверка |
|---|---|---|---|---|
| S0 | app-foundation: поля формы | `TextField` (`multiline`, `numberOfLines`, `maxLength`, `suffix`), `TimeField` (native/web), витрина, тесты; релиз `@rkarakulov/ui` 0.4.2; в pokatim — каталог 0.4.2 | репозиторий app-foundation; `pnpm-workspace.yaml` | тесты базы, `pnpm check` pokatim |
| S1 | Контракты | `geo/city.schema.ts`, `rides/ride.schema.ts`, коды ошибок/полей в конец, экспорт; api-client — 9 методов; i18n — `domain.city.*`, `rides.*`, тексты ошибок | contracts, api-client, i18n | unit contracts/api-client |
| S2 | API `rides` + миграция | коллекция, `0014_rides`, репозиторий (атомарные операции), политика, сервисы, 2 контроллера, лимиты, `AppModule`, `error-messages` | `apps/api/src/modules/rides/*`, migrations | unit + int (гонка, отрицательное доказательство) |
| S3 | Вкладка «Райды» | `features/rides/{queries,format,filters,ride-feed,ride-hero}`, `RideListRow`, `RideGoingAction` (лента: join), стопка, фильтр «Город», состояния | app | jest |
| S4 | Карточка райда | `rides/[id].tsx` (SSR, OG, `noindex`, deep link), `ride-detail.tsx`, `me`, join/leave, «Поделиться» (`share-link`), гость → `return-path` + корневой layout | app | jest, `build:web` + `curl` |
| S5 | Форма и отмена | `rides/new`, `rides/edit/[id]`, `rides/cancel/[id]`, `ride-form.tsx` (S0 или фолбэк), ошибки сервера, 409/429/квота, баннер «опубликован» | app | jest |
| S6 | Главная | `rides` в `AVAILABLE_HOME_SECTIONS`, `useNextRide`, герой + `RideGoingAction`, пусто | app | jest home |
| S7 | E2E и документация | шаги смоука, фикстура райдов, §10, ADR-0013 (Proposed), env | app/e2e, docs, rules | `pnpm check`, `pnpm e2e:web` (`E2E_API=1`) |

Порядок: S0 ∥ S1 → S2 → S3 → (S4 ∥ S5) → S6 → S7. Уровень — task3 (новый модуль, миграция, контракты, безопасность).

# 12. Outcome (coder)

**Сделано (PR 05a, ветка `feature/app-05-rides`)** — слайсы S1–S7; S0 (app-foundation) — фолбэк §5.1 (O1).

- S1 контракты: `geo/city.schema.ts` (`CITY_CODES` 25, `CityCode`, `isCityCode`), `rides/ride.schema.ts` (справочники,
  лимиты, `RideFields`/`Create`/`Update`/`Cancel`, `CreateRideForm`, `RideListQuery`, `RideViewer`, `RideCard`,
  `RideDetail`, `RideDetailForOrganizer`, `RideView`, `RidePage`, `RideCities`, `RideQuotaDetails`); коды `RIDE_*` в
  конце; api-client — 9 методов; i18n — города, причины, ошибки полей, строки экранов.
- S2 API `modules/rides` + `0014_rides`: репозиторий (join/leave/update/cancel — одна `findOneAndUpdate` с условиями в
  фильтре), политика, два сервиса, два контроллера (`AuthGuard` — первым), лимиты частоты и квоты, `AppModule`,
  `error-messages`.
- S3 вкладка «Райды»; S4 карточка (SSR, OG, `noindex`, «Поделиться», возврат гостя); S5 форма, правка, отмена; S6
  раздел Главной; S7 смоук web, ADR-0013 (Proposed), `docs/product/rides.md`, правила, runbook-и, `.env.example`.

**Отрицательное доказательство (AC-T1)** — из фильтра `RidesRepository.join` удалён `$expr` лимита: тест «K
параллельных «Я иду» на одно место» (`rides-participation.int.test.ts`) красный по результату — `expected [ …(6) ] to
have a length of 1 but got 6` (все 6 претендентов записались, `goingCount` 8 при `limit` 3); с условием — зелёный.

**Проверки**
- `TURBO_CONCURRENCY=1 pnpm check` (Mongo `pokatim_rides_test`, Redis `/8`) — `EXIT=0`: contracts 172, api 670
  (unit + int), api-client 60, i18n 6, app 711, admin 149; `arch:check` — без нарушений.
- Миграции дважды: БД в состоянии develop (0001–0013) → `db:migrate` — «миграции применены: 0014_rides» → повтор —
  «новых миграций нет»; индексы `rides_feed_idx`, `rides_city_feed_idx`, `rides_participant_idx`,
  `rides_organizer_idx`. Чистая БД и повтор `up` — `migrations.int.test.ts`.
- `build:web` + `curl` карточки (web :8190, API :3190 на e2e-БД): `<title>{название} — Покатим`, description/OG
  «Понедельник, 2 ноября 2026, 10:00 · Минск · 42 км · темп 22–24 км/ч», `og:url` из `WEB_ORIGIN`,
  `<meta name="robots" content="noindex">`; в HTML нет e-mail, `organizerUserId`, `participants`; неизвестный id —
  `noindex`; API — `cache-control: public, max-age=60`.
- `E2E_API=1 pnpm e2e:web` (своя БД, свой Mailpit, Redis `/9`) — 20 passed; без API — 14 passed, 6 skipped.
- `expo export -p android` — бандл собран (4,6 МБ).

**NOT VERIFIED**
- Ручная проверка на симуляторах iOS/Android (share sheet, нативный DateField) — не делалась.
- Прогон с общими `pokatim_test` / Redis `/1` — не делался по указанию оркестратора (параллельные агенты).

**Follow-up**
- S0 в app-foundation: `TextField` (`multiline`, `numberOfLines`, `maxLength`, `suffix`), `TimeField` (native/web),
  витрина и тесты, релиз `@rkarakulov/ui` 0.4.2 → заменить фолбэк формы (маска `ЧЧ:ММ`, однострочное описание,
  единицы в подписи).
- Кандидаты в базу: `Picker` (город), `DisabledReason` для приложения, `Sheet`, `HeroCard` с фото.
- EAS env профилей: `EXPO_PUBLIC_WEB_ORIGIN` (иначе «Поделиться» в native скрыта).
- PR 05b (жалобы и модерация) — до прода и сторов; удаление аккаунта — обязательства `pokatim-db.md`.

---

## Приложение A. Карта прототипа `key-rides` (без данных)

| Кадр прототипа | 05a |
|---|---|
| (a) Лента: кикер, заголовок «рядом с вами», «Создать райд», герой на фото организатора со стопкой и «Я иду», список по дням, «Мест нет» текстом, пустое состояние с «Создать райд» | да, без фото и «рядом»/«в N км» (Q1); фильтр «Город» — добавлен вместо «рядом» |
| (b) Деталь: шапка-карта, метка с организатором, дата/время, старт, стат-блок (км · темп · набор), стопка, «Я иду» / «Не иду», «Поделиться», «Мест нет» с баннером, «Об этом райде», «Этот райд в других разделах» | да, без карты, имени, «Набор», перекрёстных ссылок (§4) |
| (c) Создание: название, маршрут, дистанция из маршрута, дата, время, место, темп, описание, максимум участников; ошибка «дата в прошлом» с причиной под кнопкой | да, без «Маршрута»; место = город + текст (Q2, Q3) |
| (d) Карточка-приглашение 9:16 (фото / линия), шит «Райд опубликован», экран карточки с «Добавить своё фото» | нет — `sharing`/`media`; вместо шита — баннер + «Поделиться» ссылкой |
| (e) Прошедший: баннер, «ехали N · вы в списке», «Поделиться карточкой райда» (только участникам, D-65), «Все райды рядом» | да, без карточки (D-65 — `sharing`) |
| Решения прототипа: D-69 «Поделиться» — любой райдер; OQ5 — без листа ожидания; отмена в меню «…» [ASSUMPTION] | D-69, OQ5 — да; отмена — `TextAction` на карточке (меню нет в системе) |
| `key-home`: раздел «Кофе-райды» — герой с фото, «идут 12», «Я иду», «Все райды»; баннер «Включите геопозицию» | раздел — да (типографский герой); баннер — с «рядом» |

## Приложение B. Черновик ADR-0013 «Кофе-райды»

- Статус: Proposed · Дата: 2026-10-27 · Задача: `docs/tasks/2026-10-27-app-05-rides`

**Контекст.** Кофе-райд — сущность приложения (ADR-0010 п. 1): создаёт райдер, участвуют райдеры, команда
платформы вмешивается только по жалобам. Нужны: запись с лимитом мест без перебора при одновременных нажатиях,
лента, зависящая от зрителя, публичная ссылка для приглашения, защита от UGC-злоупотреблений; координат и карты
нет (MVP §1, ADR-0007 R11 — «рядом» позже).

**Решение.**
1. Модуль `rides` (папка API), зависит только от `identity` (index) и общих `src/*`; панель — с модерацией (05b).
2. Участники — встроенный массив документа райда (≤ 100) + `goingCount`; «Я иду» / «Не иду» / правка лимита — по
   одной атомарной операции `findOneAndUpdate` с условием в фильтре (лимит, статус, время, членство): инварианты в
   одном документе, без транзакций и замков. `version` — только для правок организатора (участие её не меняет).
3. Чтение: лента, города и состояние зрителя — под `AuthGuard`, `no-store` (зависят от зрителя); карточка — публичная
   без зрителя (`public, max-age=60`, `public-read`), состояние — `GET /rides/:id/me`.
4. Место — город из справочника `CITY_CODES` + место текстом; координаты, «рядом» и карта — отдельным решением
   (тайлы/геокодер — внешний сервис). Поле точки добавится expand-миграцией (`startPoint: Point | null` + `2dsphere`).
5. Фаза (`upcoming → past`, `cancelled`) — по `CLOCK`, не хранится; запись, правка, отмена — до старта.
6. Отмена — причина из справочника; отменённый будущий райд — в ленте только участникам и организатору.
7. UGC: публичные карточки `noindex`, OG без описания и ПДн, лимиты частоты и квоты; жалобы и скрытие — до прода.

**Альтернативы.** Коллекция `ride_participants` + транзакция (лимит — условие по другому документу: нужен замок
`$inc version` райда; больше кода, тот же результат) — нет. Публичная лента с кэшем (роль зрителя и отменённые свои
недоступны, после «Я иду» браузер отдаёт старую страницу до 60 с) — нет. Свободный текст города (UGC в чипах
фильтра) — нет. Карта и геокодер сейчас (внешний сервис, ADR, удвоение scope) — нет.

**Последствия.** Число участников ограничено размером документа (100); список участников с именами потребует
профиля (имя, фото) и проекции без чужих id; уведомления — модуль `notifications` (события `rides.*` добавит он);
удаление аккаунта обязано отменить будущие райды организатора и снять его отметки.

## Приложение C. PR 05b — жалобы и модерация (набросок, отдельный spec)

- Приложение: «Пожаловаться» на карточке (вошедшим, не организатору) → причина из справочника (`spam`, `offensive`,
  `dangerous`, `fake`, `other`) + необязательный комментарий ≤ 500 (видит только команда); одна жалоба на райд от
  пользователя; лимит частоты.
- API: `ride_reports` (append-only), `POST /v1/rides/:id/reports`; статус райда `hidden` (в конец `RIDE_STATUSES`):
  публично — 404, в ленте нет, организатору в `me` — «Райд скрыт модератором».
- Панель «Протокол»: раздел «Модерация · Райды» — очередь райдов с открытыми жалобами (`DataTable`), превью, действия
  «Скрыть» / «Вернуть» / «Отклонить жалобы» (`ReasonDialog`, причина обязательна) → `PanelAudit.append` в той же
  операции; право `rides.moderate` (в конец `PERMISSIONS`, роли `moderator`, `admin`).
- Миграция — следующий свободный номер на момент PR (согласовать с эпиком «Результат гонки», слайс 03).
- Release-чеклист: снять запрет «не в сторы/прод без 05b».

## Вопросы автору (коротко, с рекомендацией)

1. **Приватность места встречи.** Рекомендация: место видно всем (это приглашение; прототип кладёт его на
   карточку-приглашение), карточки `noindex`, подсказка «людное место, не домашний адрес». Альтернатива — точное
   место только записавшимся (гостям — только город).
2. **«Рядом» без карты.** Рекомендация: 05a — лента по времени и фильтру «Город»; «рядом», «в N км» и точка на
   карте — отдельный блок с ADR про тайлы/геокодер. Согласны отложить?
3. **Город — справочник.** Рекомендация: фиксированный список ~25 городов Беларуси (Q3), поле «Ближайший город».
   Утвердите список или дайте свой.
4. **Имя организатора.** Рекомендация: в 05a без имени («Кофе-райд», стопка без лиц); имя/фото — с профилем.
   Альтернатива — необязательное «Как вас подписать» в форме райда (ПДн на публичной карточке).
5. **Лимит и лист ожидания.** Рекомендация: лимит необязателен (2–100, с организатором), листа ожидания нет, без
   лимита — потолок 100.
6. **Модерация.** Рекомендация: 05b (жалобы + скрытие командой) обязателен до прода/сторов; 05a живёт только на dev.
7. **Отмена.** Рекомендация: причина из справочника без свободного текста; участники узнают из ленты и карточки,
   уведомления — с модулем уведомлений.
