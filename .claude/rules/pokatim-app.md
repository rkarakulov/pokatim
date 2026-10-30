---
paths:
  - 'apps/app/**'
---

# pokatim — приложение райдера (дополняет `app.md`)

Процесс — скил `app-dev-kit:mobile-expo`; начинай с рамок MVP.

## Рамки MVP (не расширять без ADR)

- Нет записи GPS, нет фоновой геолокации, нет BLE-датчиков, нет Strava API, нет биометрического входа. Push на iOS и
  Android — только через Expo (ADR-0017), в PWA — Web Push тем же каналом (ADR-0022). Garmin и Wahoo — только импорт велозаездов через
  агрегатор (ADR-0011). Задача требует что-то из этого — стоп: продуктовое решение и ADR, а не реализация.
- Геолокация — только foreground для «рядом», после pre-permission экрана («Не сейчас»), при отказе — баннер со
  ссылкой в настройки ОС.
  Сейчас (слайс 4): один pre-permission экран в онбординге (`(setup)/location`), координаты не читаются, не хранятся и
  не отправляются до фичи «рядом»; развилка — `features/location/location-permission(.web).ts` (`expo-location` —
  только в native-файле, web — Geolocation API); «экран показан» — флаг устройства `pokatim.locationPrompt`
  (`features/onboarding/device-flags(.web).ts`). Перед сторами — `LOCATION_STEP_ENABLED` (release-чеклист).
  Исключение (routes-04d, поправка ADR-0014, G2): кнопка «Моё местоположение» на карте — одно foreground-чтение по
  нажатию (`features/location/current-position(.web).ts`, без `watch`), координаты — только в памяти (стор карты без
  persist; не в TanStack Query, `console.*`, URL, подписях a11y и запросах); отказ — сообщение над картой со ссылкой
  в настройки ОС (`location-settings(.web).ts`; web — текстом).
- Заезды и маршруты — импорт файла через системный picker (заезд: FIT/GPX, TCX — нет, ADR-0011; маршрут: GPX/KML/KMZ/TCX).
- Треки и устройства (ADR-0011): шаг онбординга `(setup)/devices` после геопозиции (флаг аккаунта на сервере
  `OnboardingStatus.devicesStepCompleted`; поля нет — старый API — шаг пропускается); экран «Устройства»
  `settings/devices` (вход — иконка верхней панели); возврат авторизации `devices/return` — вне гардов. Развилки —
  файлами: `features/devices/connect-flow(.web).ts`, `pick-track-file(.web).ts`, `upload-track(.web).ts`.
- Уведомления (ADR-0017, `docs/product/notifications.md`) — центр `/notifications` и настройки
  `settings/notifications` внутри `Stack.Protected` вкладок (оболочка `useSettingsShell`), колокольчик в `TopBar`
  Главной (`components/notification-bell.tsx`, «99+»); всё — `features/notifications/` (ключи `['notifications', …]`,
  счётчик — polling `refetchInterval` 60 с, не сокеты; статусы обработки — так же). Переход по цели — только
  `notification-target.ts` (белый список типов с `Uuid`; незнакомое — без перехода, из push — центр). Push — развилка
  `push(.web).ts` (`expo-notifications` только в native-файле; web — Web Push, ADR-0022: подписка `PushManager` с
  VAPID-ключом из `GET /v1/notifications/web-push`, поддержка — SW + Push API + Notification, iOS/iPadOS — только
  standalone (детект — `features/pwa-install/install-platform.ts`); отправка регистрации и снятия — `sendPushRegistration`
  / `sendPushRevoke` шва; `usePushSupported()` — `null` до монтирования (SSR), без поддержки в настройках только письма
  — без push-тумблеров, тихих часов и группы без писем; строка `PushPermissionRow` — реальное состояние web:
  `missing`/`expired` подписывает тихо, отказ — текст «включите в настройках браузера/системы»; на экране настроек
  строка и push-тумблеры групп делят одно состояние `usePushPermission` (`push-permission-row.tsx`): включение тумблера
  при `undetermined` — системный запрос первым, в том же нажатии (Safari), затем сохранение; при `missing`/`expired` —
  тихая подписка; включённый тумблер без доставки (`delivers === false`) — подпись `notifications.settings.pushBlocked`; группа
  «Мероприятия» (PR D) — свой подресурс (`useEventNotificationSettings`, ключ `['notifications','settings','events']`, своё
  сохранение и баннер; 404 старого API — группы нет, `isSettingsResourceMissing`), её push-тумблер — с тем же
  `usePushPermission`; группа «Маршруты» — так же (`useRouteNotificationSettings({ enabled: push })`, ключ
  `['notifications','settings','routes']`), только push, после «Райдов»; без push — блока и запроса нет; после
  `PUT settings` её запрос инвалидируется (нет своего тумблера — сервер отдаёт значение «Райдов»); цель `ticket` → `/tickets/<код>` (и в SW); выход — снятие на
  сервере и `unsubscribe()` в браузере; нажатие на уведомление — сообщение SW `pokatim:open` → `onOpen(target)`): разрешение — только по нажатию строки
  «Включить push-уведомления» (N5), токен — при наличии `extra.eas.projectId` и на устройстве, регистрация —
  `PushNotifications` рядом со `Stack` корневого layout после входа и онбординга, снятие — `useSignOut` до отзыва сессии (кроме
  `serverEnded`: токены снял сервер), последний токен — `secureStorage` `pokatim.pushToken`.
  Подсказка в момент пользы (N5, 2026-10-30) — `PushSoftPrompt` (`push-soft-prompt.tsx`): предложение —
  `offerPushSoftPrompt(context, id)` (`push-soft-prompt-store.ts`) только из `onSuccess` хуков мутаций (`useRideRsvp`
  «Я иду», `useEnterRace` — новая активная заявка, не повышение), не из `mutate(…, { onSuccess })`: форма к ответу
  размонтирована; «Не иду» — `closePushSoftPromptFor`. Место — `<PushSoftPrompt>` с тем же id под действием; показ
  закреплён за первым местом на сфокусированном экране (`useIsFocused` expo-router: лента и Главная под карточкой
  показ не забирают), фазы (`checking`/`offer`/`denied`/`closed`) — в сторе; владелец размонтирован или потерял фокус
  — закрыта до перезапуска (до решения — как не предлагали); предложение без захвата за `SOFT_PROMPT_CLAIM_MS` (3 с)
  снимается — показ не потрачен, открытие объекта позже её не покажет. «Включить» — `usePushPermission().press` строки, отказ — `deniedRow()` +
  `announceForAccessibility`; показ — чистая `softPromptVisible` (`push-soft-prompt-state.ts`), «Не сейчас» —
  `pokatim.pushSoftPrompt` на 30 дней (`push-soft-prompt-storage(.web).ts`: SecureStore / `localStorage`).
  Service worker (`scripts/service-worker.ts`, ADR-0022): `push` — уведомление по payload сервера и сигнал окнам
  `pokatim:push`; `notificationclick` — фокус открытого окна и цель приложению или новое окно по пути цели (копия
  белого списка в SW — паритет с `notification-target.ts` держит тест, песочница — `scripts/service-worker-harness.ts`).
- Настройки (settings-hub): хаб `settings/index` внутри `Stack.Protected` вкладок (оболочка `useSettingsShell`), вход —
  иконка «Настройки» `TopBar` Главной (иконка «Устройства» — быстрый вход рядом); «Выйти» — только здесь. Строки —
  `features/settings/settings-row.tsx`; «О приложении» — `app-info.ts` (версия `expoConfig.version`, ссылки —
  `EXPO_PUBLIC_PRIVACY_URL`/`TERMS_URL`/`SUPPORT_EMAIL`, не заданы — строки нет; открытие — `openExternalUrl`).
  «Тема» (user-theme, ADR-0021) — `settings/theme` в `Stack.Protected` рядом с «Языком»: 7 тем (`APP_THEME_IDS`) строками
  `SettingsRow` с `leading` (превью `features/appearance/theme-preview.tsx` из `View`, цвета — `THEME_PREVIEWS`) и
  `description`; выбор — из `['profile']` (`AsyncContent`), значение строки хаба — активная тема (`useAppTheme().id`).
  Смена — `useSetTheme` (`theme-mutation.ts`: `PUT /v1/profile/theme`, `scope` `profile-theme` — по очереди,
  оптимистично в `['profile']`, ошибка — откат к подтверждённой сервером и баннер). Язык — `settings/language` из `i18n.locales` (имя —
  `localeNames`), выбор — устройства, не аккаунта: `locale-preference(.web).ts` (`pokatim.locale`: native
  SecureStore, web `localStorage`), применяется после монтирования корня (SSR — базовый язык).

## Правила pokatim

- Deep links / universal links для 5 типов объектов (заезд, маршрут, календарь, результат, карточка) — через
  Router; возврат к объекту после регистрации.
- Локальное состояние — минимальный zustand (сессия, регистрация); формы — react-hook-form + zod-схема из contracts.
- Строки — формальное «вы».
- Темы приложения (ADR-0016): реестр `appThemes` (`@pokatim/design-tokens`), активная — `AppThemeProvider` в корне
  (`src/theme/`); компоненты читают `useTheme<AppTheme>()` / `useAppTheme()` (иконки, раскладка, схема). Подложка
  карты — `theme.map.basemap`, профиль высоты — `theme.profile.*`; сравнений с `themes.light|dark` нет. Иконки — только
  `components/icon.tsx` (единственный вход `expo-symbols`), шрифты — только `themeFonts` + `useThemeFonts` (не
  `useFonts`); React Compiler выключен — `textStyle()` читает шрифты темы из модуля, кэш компилятора их не обновил бы; сторож — `__tests__/theme-guards.test.ts`. Тема — личная, в профиле райдера (ADR-0021): единственный
  источник — `useActiveThemeId` (`features/appearance/`): вошёл — `themeId` профиля (`['profile']`), до ответа или при
  ошибке — последняя известная (native — кэш `pokatim.appTheme`, web — SSR); сессия `signedOut` (любой путь) —
  «Классика» и стирание кэша / cookie (в хуке по статусу сессии, не в `useSignOut`). Web: тема профиля — в cookie
  `pokatim_theme` своего origin (`appearance-cache.web.ts`: `Path=/; Max-Age=31536000; SameSite=Lax` + `Secure` на
  https, только в эффекте; «Классика» — стирание); SSR — `ssrThemeId()` (`ssr-theme.ts`: `requestHeaders()` expo-server
  → cookie → закрытый список, вне запроса — «Классика»); `+html.tsx` и корень (`initialThemeId`) читают её, клиент
  гидратируется из `window.__POKATIM_THEME__`. `+middleware.ts` и темы процесса нет; manifest — «Классика». «Классика» = Jersey Aura /
  Night Ride по системе. Варианты раскладки (`layout.*`) — только таблицами `Record<вариант, компонент | значение>`
  (`ROUTE_HERO`, `STATS_VARIANT`, `TAB_ITEM`, `ROUTE_CARD`; профиль высоты — всегда градиент); сравнения с id темы и значением `layout` —
  нет (сторож). Вкладки — роли `tabBar.*`; отступы карточек — `appDensity[density]`; форма — `shapeOf(theme)`.
  `react-native-svg` лениво — только `features/routes/use-svg-native.ts` (профиль, контур `route-contour(.web).tsx`,
  фигуры декора `features/decor/decor-svg(.web).tsx`).
- Сезонный декор (halloween-decor) — слой поверх темы, не тема: `decor` ответа `GET /v1/appearance` (запрос
  `['appearance']`, `useDecorQuery`; `themeId` ответа устарел и не читается), включает и выключает команда в панели без релиза. `features/decor/`: таблица
  `DECOR_LAYER: Record<AppDecorId, слой | null>` (`DecorLayer`), показ — только после монтирования (`useMounted`: SSR
  и гидрация web без декора), кэша на native нет. Слой — `pointerEvents="none"`, скрыт от скринридеров, цвета — роли
  темы (`halloweenColors`), анимации — только при `useReducedMotion() === false` (web — CSS с
  `prefers-reduced-motion`). Опора — область ленты Главной (`View flex: 1` вокруг `ScrollView`), шапка не перекрыта.
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
- **Удаление аккаунта** (A2, A12, ADR-0015): экран `settings/account/delete` за входом на всех платформах —
  последствия, текущий пароль, «Удалить навсегда» (`api.deleteAccount`); ошибки `PASSWORD_INCORRECT` — под полем,
  `ACCOUNT_PANEL_MEMBER`/`RATE_LIMITED` — баннер. Запрос и забывание сессии устройством (`forgetEndedSession`) — одна
  задача `withSessionLock` внутри `withAccessToken` (ответ web стирает cookie); успех — `signOut({ returning: false,
  notice, serverEnded: true })` без запроса sign-out и баннер «Аккаунт удалён» на «Регистрации». Нативный `Alert` не используется (на web не работает).

## Публичные экраны по ссылкам (web, ADR-0003)

- Экран на каждый тип ссылки (заезд, маршрут, календарь, результат, карточка) открывается без входа и без
  установки; SSR + OG-мета (`generateMetadata`) без персональных данных; состояния: недоступно, карточка
  отозвана, гонка отменена.
- Удаление аккаунта из веба — тот же экран `/settings/account/delete` за входом (гость → вход → возврат), без
  публичного удаления по e-mail и ссылке (A12).
- Мета — `publicPageMetadata` (`src/lib/page-metadata.ts`) в `generateMetadata`: без e-mail и других ПДн; путь с
  токеном (ссылки писем) — без `og:url`; `loader` — только для публичных данных (e-mail в HTML не попадает).
  Образцы — `register`, `auth/verify/[token]`. Новый публичный экран — шаг смоука `e2e/web.spec.ts`.
- `og:image` (og-images) — `publicPageMetadata({ image })` из `src/lib/og-image.ts`: страница объекта (гонка, райд,
  маршрут, старт) — `Promise.all([данные, ogCardIfOrigin(kind, id)])` → `pageOgImage` (своя; нет версии или API
  недоступен — бренд; страница не найдена — без картинки); остальные публичные страницы —
  `brandOgImage()`. Версию картинки считает только API (`/v1/og/cards/...`), адрес — только от `WEB_ORIGIN`;
  нет `WEB_ORIGIN` — ни запросов, ни картинки. Сезон и профиль райдера — своя картинка через `ownOgImage` (схема id
  по виду — `OG_CARD_ID`); мета райдера — без ПДн, `publicId` только в URL `og:image`. Свой fetch и расчёт версии в приложении — запрещены.
- `robots.txt` и `sitemap.xml` (landing-seo) — API-маршруты `src/app/{robots.txt,sitemap.xml}+api.ts`, правила —
  `src/lib/seo.ts`. **Новый экран в `src/app`** — классифицируй: только вошедшим, онбординг, токен в URL — префикс в
  `SEO_DISALLOW`; публичный — в `PUBLIC` сторожа `__tests__/seo-routes.test.ts`. Страницу с `noindex` в мета не
  закрывай (краулер не увидит `noindex`), кроме ссылок с токеном. `/v1/` не закрывай: Googlebot при рендере
  соблюдает robots и для fetch — публичный экран потеряет данные из API. Новый индексируемый вид объекта — `SITEMAP_KINDS` в contracts и
  `GET /v1/sitemap` (`sharing`, порты владельцев).
- Гостевой лендинг `/welcome` (guest-landing, `docs/product/landing.md`) — корневой `src/app/welcome.tsx` в том же
  `Stack.Protected guard={!signedIn}`, что `(onboarding)` (не в группе: `initialRouteName` группы не трогаем); экран —
  `features/landing/`. `loader` — четыре публичных списка (`loadLandingSeed`, части `null`, не бросает; маршруты —
  `author=team`), посев — `initialData` хуков Главной (`useNextRace`, `useNextCalendarStart`, `useCurrentSeason`) и
  `useLandingRoutes`; мета — `landingMetadata` (`og:url` `/welcome`, без `robots`), она же — мета `/` (`(tabs)/index`).
  Живые блоки — `LandingSection`: скелетон на первой загрузке, ошибка и `paused` без данных — блок скрыт, без
  повтора (отступление от §4.12, G5).

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
- Мутации онбординга — `networkMode: 'always'`: офлайн даёт сетевую ошибку и баннер с повтором, а не вечную паузу. После выхода или отзыва сессии гард ведёт на «Вход» (`returning`); новый гость — на лендинг `/welcome`, живая
  регистрация после перезапуска (`resumeOnLaunch`) — на «Регистрацию» (она продолжает к «Подтвердите e-mail»; стор
  регистрации пришёл позже гарда — `welcome.tsx` уводит туда сам).
- E-mail между экранами (регистрация → вход, ссылка → вход, «Вход» ↔ «Забыли пароль?», ссылка сброса → вход) —
  через черновик в памяти (`registration-store`), не в URL: query-строка попала бы в историю браузера и логи
  web-сервера. Смонтированная форма «Входа» берёт адрес из черновика при фокусе.
- Экраны ссылок из писем (`auth/verify/[token]`, `auth/reset/[token]`) — вне гардов корневого layout (открываются и
  с сессией, и без). Запросы сброса пароля — вне Web Lock (пути вне cookie сессии); после смены пароля сессия этого
  устройства — локальный выход через `useSignOut` (сервер её уже отозвал).
- Сторы и `api` не вызываются в рендере и на уровне модуля (на SSR-сервере сторы — общие синглтоны); гидрация — в
  эффектах. Гарды допускают `unknown` и `unavailable`: вкладки — скелетон оболочки или повтор, не редирект (SSR
  отдаёт HTML). Каждый экран `Stack.Protected` вкладок вне `(tabs)` — за `useSettingsShell` в файле маршрута (иначе
  без сессии он запросит данные и покажет «Не удалось загрузить» с повтором, который сессию не восстановит); новый —
  строка в сторож `__tests__/protected-shell.test.tsx`.

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
- SSR-данные (`loader`, `generateMetadata`) — только `src/lib/public-ssr.ts` (`publicPath` — `Uuid` или схема токена из contracts, например `RiderPublicId`, до запроса,
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
  в git не хранится); слои и GeoJSON — один источник `route-layers.ts` пакета `@pokatim/route-view` (routes-05; коридор — ширина линии 2 × `widthM` в
  метрах выражением зума, роли `map.*`, `CORRIDOR_OPACITY`), рамка — `route-map-frame.tsx` (пропорция
  `MAP_ASPECT_RATIO`, доступное изображение с подписью без координат, сообщение «Карта не загрузилась» поверх). URL
  стилей — только `EXPO_PUBLIC_MAP_STYLE_LIGHT/DARK` (`map-style.ts`, прямое обращение к `process.env`); не заданы —
  карты нет. Интерактивная карта (routes-04b, поправка routes-04c ADR-0014 — одним пальцем): web — без
  `cooperativeGestures` (мышь и один палец тащат карту), колесо — зум только с Ctrl/⌘, без модификатора — прокрутка
  страницы и своя подсказка (`guardWheelZoom` пакета `@pokatim/route-view`: слушатель `wheel` в фазе перехвата, без
  `preventDefault`; опции жестов — `interactiveMapOptions`), подпись холста — `locale` (`mapLocale` пакета), вращение и наклон выключены; native — нативные жесты MapLibre RN
  (`dragPan`, `touchZoom`, `doubleTapZoom` — выкл при reduce motion; `doubleTapHoldZoom`, `touchRotate`,
  `touchPitch` — выкл), прокрутку карточки на время жеста блокирует натив (Android `requestDisallowInterceptTouchEvent`),
  своей блокировки и RNGH-оверлея нет. Зум `MAP_MIN_ZOOM…MAP_MAX_ZOOM` (2–17: рамка 1000 км вписывается), без `maxBounds`; кнопки «+», «−»,
  «в рамку» и «Моё местоположение» (routes-04d) — `map-controls.tsx` сверху справа (`MAP_FIT_PADDING.right` — под
  них; состояние чтения позиции — листовой `map-overlay-controls.tsx` + `use-locate.ts`, сообщение —
  `map-locate-notice.tsx`; точка — `location-style.ts`, native `location-layer.tsx` по `location-store.ts`, web
  императивно, камера — native `easeTo` с `padding`, web — с `offset`), анимация камеры
  `MAP_CAMERA_ANIMATION_MS`, при reduce motion — без анимации (native — длительность всегда явно); начальная камера —
  по рамке без анимации. Сдвиг карты на native — исключение из правила `accessibilityActions` (ADR-0014). Карточка `races/[id]`: блок `race-route-map.tsx` после строки «Коридор» — SSR и первый рендер — место
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
  (`collapseAttribution`/`attributionCss` пакета `@pokatim/route-view`, до первого нажатия «i»), цвета контрола — роли темы в области карты (`data-route-map`);
  routes-04d — «i» в нижнем левом углу на обеих платформах (web — `AttributionControl` в `'bottom-left'`), над шторкой
  — со сдвигом на `bottomInset`; native — `tintColor` темы. Камера — `MAP_FIT_PADDING` (снизу место под «i»), со
  шторкой — `cameraPadding(inset, mapHeight)`. Полоса
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
- Уровни и группы (race-results-07c): выбор Verified / START — только `offersTierChoice` (схема `gender_age` и блок
  `verified` сервера; `overall` и старый API — «Участвовать» без тела, DV-1); группы — готовый `verified.groupOptions`
  (своя по умолчанию), правил групп в клиенте нет (DV-8); анкеты нет — «Заполнить анкету» →
  `settings/verified?race=<id>` (после сохранения — `dismissTo` гонки). «Повысить до Verified» — только по
  `actions.canUpgrade`. Таблица: вкладки — `groups` ответа по умолчанию + «Финишёры» при `finishers > 0`; `group` в
  запросе — только для вкладки не по умолчанию после ответа с `groups` (RC-11), ключ `[…,'pages',group]`, финишёры —
  `[…,'finishers']`; карточка соперника и подача спора получают вкладку `?group=` (`rivalPath`, `groupParam`).
  Анкета `settings/verified` (ссылка из «Редактировать профиль»): пол и год при `demographicsLocked` — только чтение; пределы —
  схемы contracts, текст «Целое число от … до …».
- Рейтинг сезона (race-results-08c) — `features/standings/*`: блок `season-standings.tsx` в шапке списка экрана
  сезона (RC-17; подгрузка — «Показать ещё», не `onEndReached`), блок «Сезон» своего профиля `/profile` (`profile-season-block.tsx`,
  сезон — `useHeaderSeason`, RC-18), действие «Таблица сезона» вкладки «Гонки». Ключи под `['seasons','standings',id]`
  (`summary`, `table`+класс+группа, `me` — только вошедшему); pull-to-refresh экрана — `useStandingsRefetch`. Логика
  показа — только `standings-format.ts` (выбор таблицы: своя из `/me`, иначе первая сводки; `'unknown'` — не
  показывается). «Вы» — по `order` из `/me` только при равном `computedAt` (RC-11; иначе один перезапрос более
  старого ответа); страница другого снимка — подгруженное сбрасывается (`resetQueries`), таблица — с первой страницы.
  Очки, места, N из M и «в зачёте» — только с сервера. Перезапрос после расхождения снимков (RC-11 и сброс) —
  `refetchFresh` / `getSeasonStandingsTable(…, { fresh: true })` только при `BYPASS_HTTP_CACHE`
  (`features/standings/http-cache(.web).ts`: web — да, native — нет). На native `cache: 'no-cache'` нельзя:
  `fetch` RN — `whatwg-fetch`, он дописывает `_=` в URL, и строгий query (`strictObject`) отвечает 400 — только на
  iOS/Android, jest (замоканный `api`) этого не поймает. Ошибка `/me` — свой `TabFailure` над таблицей (публичная
  таблица остаётся). Блок «Профиля» — `useHeaderSeasonState` (тот же кэш, что `useHeaderSeason`, с состояниями):
  ошибки определения сезона и `/me` — баннеры с повтором, данные при ошибке обновления остаются; скрыт только без
  ошибок (сезона нет или своих строк нет).

- Карточка для сторис (story-cards, ADR-0018) — `features/races/story/*`: экран `races/story/[id]` внутри
  `Stack.Protected` (рядом с `races/result/[id]/[entryId]`; в `app/_layout.tsx` и `__tests__/app-routes.ts`). Входы —
  `ShareStoryButton` только по `actions.canShareStory` сервера: «Ваше участие» и своя строка таблицы
  (`ownRowAction` → `rivalPath` своей заявки: «Ваш результат», без подачи спора). Статус — `useCardStatus` (`raceStorySource`)
  (`['races','story',raceId,template]`, опрос 1 с, не дольше 30 с от первого `pending`, `failed`/таймаут — ошибка с
  повтором, 409 — «Карточки пока нет»); PNG — `useCardFile` заранее (RC-13). Шаринг — только
  `src/lib/share-story(.web).ts`: native — `expo-file-system` (кэш) + `expo-sharing` лениво (`load-expo-sharing.ts`;
  нет `ExpoSharing` — «Скачать PNG» через `downloadFile`), web — `navigator.share({ files })`, иначе `<a download>`.
- Общая часть экранов карточек — `features/sharing/` (`card-status.ts`: `useCardStatus` по `CardSource` — ключ и
  запрос статуса, `useCardFile`; `card-panel.tsx`: `CardPanel` — чипы, превью, «Поделиться», пустое состояние на
  409/404). Приглашение кофе-райда — `features/rides/invite/*`, экран `rides/invite/[id]` внутри `Stack.Protected`
  (ключ `['rides','invite',rideId,template]`); вход — «Поделиться» на детали (шит «Карточка / Ссылка»), карточка —
  вошедшему, `phase === 'upcoming'` (право — сервер: 409 → «Приглашение недоступно»). Карточка маршрута —
  `features/routes/story/*`, экран `routes/story/[id]` внутри `Stack.Protected` (ключ
  `['routes','story',routeId,template]`, 404 — «Карточка недоступна» и «К маршруту»). Выбор «Карточка / Ссылка» —
  общий `ShareChoiceSheet` + `useShareChoice` (`features/sharing/share-choice-sheet.tsx`): оба пути — шит; гость —
  сразу ссылка; нет origin — сразу карточка; `shareLink` — синхронно в обработчике. Карточка достижения — `features/achievements/story/*`,
  экран `achievements/story/[code]` внутри `Stack.Protected` (ключ `['achievements','story',code,template]`; 409 и
  незнакомый код — «Карточки нет» и «К достижению»).

## Профиль райдера (rider-profile, `docs/product/profile.md`)

- Маршруты: `/profile` — свой профиль в первом `Stack.Protected` (`useSettingsShell`; вход — аватар последним справа
  в `TopBar` Главной, `useOwnAvatarId` — тот же кэш `['profile']`, что порядок разделов, без второго запроса);
  `/settings/profile` — «Редактировать профиль» (фото, имя, клуб, согласие); строка «Профиль» хаба «Настроек» ведёт в
  `/profile`. `/riders/[id]` — публичный, в корневом `Stack` вне гардов: SSR (`loader` — посев), мета **всегда**
  нейтральная «Профиль райдера» + `noindex`, без `og:url` и без имени/клуба/фото (и в `DocumentTitle`); невалидный id —
  «Профиль недоступен» без запроса, 404 — то же; «Гонки» запрашиваются только после найденного профиля.
- Ключи: свои — `['profile','stats']`, `['profile','races'|'rides','pages']` (запрос — только у выбранной вкладки
  «Истории»); публичные — `['riders','detail',id]`, `['riders','races',id,'pages']`. Мутации фото — только
  `setQueryData(['profile'])` (без префиксной инвалидации `['profile']`: перезапросились бы анкета, статистика и
  история) + `invalidateQueries(['riders'])`; `PATCH /v1/profile` — тоже `['riders']`. «Показать ещё» — без
  `onEndReached`; состояния истории — `HistoryList` (`features/profile/history-rows.tsx`). Публичная история: 400 на
  курсор (строка выпала из новой ревизии протокола) — `resetQueries` к первой странице, не вечная ошибка догрузки.
- Аватар — только `components/rider-avatar.tsx` (`expo-image`, `cachePolicy: memory-disk` — URL `immutable`; нет фото
  или ошибка — иконка человека); размер шапки — `layout.avatarProfile` (`@pokatim/design-tokens`, follow-up
  `size.avatarLg` в базе), верхней панели — `size.avatarTopBar`.
- Выбор фото — развилка `features/profile/pick-avatar(.web).ts`: native — `expo-image-picker` лениво
  (`load-image-picker.ts`) после `imagePickerSupported()` (`requireOptionalNativeModule('ExponentImagePicker')`; нет —
  «Обновите приложение»), системная обрезка 1:1, без `crop`; web — `expo-document-picker` (JPEG/PNG/WebP, пре-чек
  формата и 10 МиБ) + `avatar-crop.web.tsx` (pointer events, кнопки и клавиши масштаба, без колеса; доли `x, y, size` в
  ориентированном изображении — `avatar-crop-math.ts`). Блок «Фото» — `avatar-editor(.web).tsx` поверх
  `avatar-section.tsx`; удаление — инлайн-подтверждение. Загрузка — `api.uploadAvatar` в `withAccessToken`, без XHR и
  прогресса; тексты 413/415/422/429 — `avatar-errors.ts` (429 загрузки с паузой занятой обработки, 5 с, — «через
  минуту»; удаление — общий текст; файл, который браузер не декодировал, — текст 422). Исходник не перекодируется и не
  уменьшается (JPEG/WebP до 100 Мп, PNG до 25 Мп — решает сервер, ADR-0019): EXIF/GPS стирает сервер.
- Запрет загрузки фото (profile-moderation-followups) — по `ProfileView.avatarUploadBlockedUntil`: «Выбрать фото»
  `disabled`, сразу под ней «Загрузка фото недоступна до <дата, время> после нарушений правил» (с годом — не зависит от
  «сейчас», SSR), «Удалить фото» доступна. 409 `avatar_blocked` на загрузке — тот же текст баннером и
  `invalidateQueries(['profile'])` (`useUploadAvatar.onError`). Срок истёк при открытом экране —
  `useAvatarBlockExpiry` (`avatar-block-expiry.ts`): таймер на момент окончания → перечитывание `['profile']`, кнопку
  разблокирует только ответ сервера (задержка ≤ 2^31-1 мс цепочкой; тот же срок в ответе — повтор через 30 с).
  Уведомления о сбросе — цель `profile-edit` → `/settings/profile` (`notification-target.ts` и копия в service worker).
- Жалоба на профиль (profile-report-app): `RiderReportAction` в конце `/riders/[id]` — вошедшему по
  `canReport`/`reported` сервера (`['riders','viewer',id]`, `GET /v1/riders/:publicId/me`, только после найденного
  профиля), гостю (`signedOut`) — вход с возвратом (allowlist — `/riders/<RiderPublicId>`), сессия неизвестна — ничего.
  Экран `riders/report/[id]` (`rider-report.tsx`, образец — жалоба на маршрут) — внутри `Stack.Protected`, без имени,
  клуба и фото; ответ жалобы — в кеш зрителя.

## Достижения (achievements, `docs/product/profile.md` A1–A8, ADR-0020)

- Всё — `features/achievements/`. Ключи: свои — `['achievements']` (`useAchievements`, `withAccessToken`, `staleTime`
  60 с; сервер сверяет выдачи на каждом GET — чаще не запрашивать), публичные — `['riders','achievements',id]`
  (`useRiderAchievements`, только клиент — RC-5, только после найденного профиля; 404 — блока нет).
- Каталог — `achievement-catalog.ts` (`ACHIEVEMENT_CATALOG satisfies Record<AchievementCode, …>`: ключи i18n, иконка,
  число на значке, `shareable` — «Сторис результата», только `race_*`). Незнакомый код (`'unknown'`, RC-8) — `knownItems`
  отбрасывает везде (список, вспышка, публичный блок); «Поделиться» — карточка достижения у любого известного кода;
  незнакомый вид объекта — без «Сторис результата» (`shareRaceId`). Иконка кода — зеркало в
  `apps/api/.../achievement-card.icons.ts` (сменил — поменяй там). Дата — только
  `factDate` (день по Минску, RC-7), всегда с годом (`factDateText`).
- Вспышка: хост `AchievementFlashHost` рядом со `Stack` корневого layout с тем же `ready`, что у push; маршрут
  `achievements/flash` (`presentation: 'fullScreenModal'`) и `achievements/[code]` — внутри `Stack.Protected`
  вкладок. Очередь — `flashQueue` (неувиденные, от старых к новым) минус `hiddenCodes(dataUpdatedAt)`
  (`flash-session.ts`: показанные в этом запуске — сбой `seen` не зацикливает вспышку; вся очередь вспышки — пока
  экран открыт, всегда (`openPresented`), после ухода — до ответа сервера новее последнего на момент ухода
  (`closePresented`): «назад» или «Поделиться» посреди очереди не открывают её сразу снова);
  снимок — при открытии экрана; правки кэша (`seen`) `dataUpdatedAt` не меняют (`updatedAt` в `setQueryData`).
  Открыта по адресу без данных — `AsyncContent` (скелетон карточки, ошибка/офлайн с повтором) и «Закрыть».
  Маршруты `achievements/*` — за `useSettingsShell` (как `/profile`): до восстановления сессии — скелетон или ошибка
  с повтором `hydrate()`, запроса достижений нет. Смоук без сессии — гард ведёт гостя на `/welcome`.
  Показанное помечается сразу (`useMarkAchievementsSeen`, оптимистично, откат — только своих кодов). Поверх
  `/achievements`, `/races/story/`, ссылок писем, `devices/return`, удаления аккаунта — не открывается. Ошибка запроса
  хоста — тишина. «Поделиться» — `replace(achievementStoryPath(code))`.
- Значок «Эмаль» — `achievement-badge.tsx` (роли `surface.default`, `text.primary`, `text.accent`, `action.*`;
  диаметр — `layout.badgeGrid` / `layout.badgeHero`, пропорции — `badgeShape` из `@pokatim/design-tokens`; follow-up
  `size.badge*` в базе). Появление на вспышке — `Animated` только при `useReducedMotion() === false`; пока ответ
  неизвестен — значок скрыт (без мигания), последний ответ процесса кэшируется.
- Блок `AchievementsBlock` — `/profile` (все, нажатие → `/achievements/<code>`) и `/riders/[id]` (без перехода,
  `publicOnly` — только гоночные, `publicItems`, защита от регресса API): пусто
  без ошибки — блока нет; ошибка — `TabFailure` блока, экран не ломается; pull-to-refresh экранов перезапрашивает
  блок.

## Маршруты (routes-01, `docs/product/routes.md`)

- Вкладка «Маршруты» — `features/routes/route-feed.tsx` (`FlatList`): ключ `['routes','list',{ city, distance,
  surface, author, limit },'pages']` (`author` — с routes-06), Главная — `['routes','list',{ limit: 1 }]`, чипы «Город» — `['routes','cities']` (до
  ответа — `FilterGroupSkeleton`, ошибка или пусто — группа скрыта, исчезнувший город снимается); всё публичное, без
  `withAccessToken`, `staleTime` 60 с. Карточка списка — `components/route-list-card.tsx`, подписи —
  `features/routes/format.ts`.
- Карточка `routes/[id]` — в корневом `Stack` вне `Stack.Protected` (гость по ссылке, RC-9), SSR и мета — как
  `races/[id]` (`publicPath`, `fetchPublicForSsr`, 404 — `noindex`). Карта — `catalog-route-map.tsx`: `useMapStyle`
  (`features/maps/use-map-style.ts`), `RouteMap corridor={false}` с `withoutCorridor(geometry)` (слоя коридора нет,
  `widthM` не показывается); ключ `['routes','map',id]` — только клиент. «Гонки на маршруте» — `['routes','races',
  id,'pages']`, `RaceListCard` с датами с годом; пусто, 404, ошибка — блока нет. «Поделиться» — `share-link`.
- Пропсы `RouteMap.corridor?` (по умолчанию `true`), `lineWidth?` (routes-03, по умолчанию `stroke.indicator`;
  каталог — `ROUTE_CATALOG_LINE_WIDTH` = 5) и `scrub?` (routes-04, стор скраббинга; нет — маркера нет) — единственные
  изменения карты для каталога; существующие пропсы и `race-route-map.tsx` не меняются.
- Карточка (routes-03): без `SectionHero`; чипы — `Pill`, стат-блок — `StatBlock` с `note`, подписи и время в пути —
  чистые функции `features/routes/format.ts` (`ROUTE_PACE_KMH`); профиль — `features/routes/elevation-profile.tsx`
  (`ProfileChart`: тонкая линия `profile.line` и заливка-градиент `PROFILE_FILL_OPACITY` `profile.fillTop` → `profile.fillBottom` — web inline
  SVG, native `react-native-svg`, фолбэк — столбики `PROFILE_NATIVE_FILL_OPACITY`; график — `aspectRatio`, разметка
  зависит только от данных: SSR = первый рендер; routes-04 — см. «Скраббинг» ниже); «Скачать» (routes-formats: один формат — «Скачать GPX», несколько — `route-download-sheet.tsx` на
  `ModalSheet`) — только `src/lib/download-file(.web).ts` (native —
  `openExternalUrl`, web — `<a download>` синхронно в обработчике) по `api.catalogRouteExportUrl(id, format)`, форматы —
  `exportFormats` (без поля — по `gpxAvailable`).
- Скраббинг (routes-04): стор на экземпляр экрана — `createScrubStore` пакета `@pokatim/route-view` (`zustand/vanilla`,
  `{ fraction, active, dragging }`, доля длины линии показа; читают только подписчики `useScrub` (`features/maps/use-scrub.ts`) — карта и экран на
  кадр не перерисовываются; экран: native — `scrollEnabled` при `dragging === null` (`use-scrub-scroll-lock(.web).ts`;
  web прокрутку не выключает: RN-web дал бы скроллеру `overflow: hidden`), `onScrollBeginDrag` скрывает курсор).
  Чистая логика (доля ↔ точка, ближайшая точка с подсказкой для петли, высота/уклон/набор, шаг 1 км, точки профиля) —
  `@pokatim/tracks` (`src/scrub.ts`, лёгкий вход); числа карточки, шаг и клавиши slider, тики оси, время в пути —
  `@pokatim/route-view` (`scrubValues`, `scrubStep`, `scrubKeyTarget`, `profileTickValues`, `pace.ts`; общие с
  панелью, routes-05), подписи (i18n) — `features/routes/scrub.ts`, `format.ts`.
  Маркер — оверлей над холстом (`scrub-marker(.web).tsx`), пиксели линии — одна функция `projectLine` на изменение
  камеры (web — `map.project` на `load`/`SCRUB_REPROJECT_EVENTS` = `resize`, `move`; native — `mercatorProjector` по
  `ViewState.bounds` событий региона + `onLayout`) в стор вида карты (`createMapViewStore` пакета, на экземпляр; подписан
  только `ScrubLayer` — `RouteMap` на кадр камеры не перерисовывается); перетаскивание — жест маркера; допуск петли —
  не меньше `SCRUB_TOLERANCE_MIN_PX`. Носитель жеста на долю и на точки камеры не подписан (точки и допуск — из ref),
  конфиг `usePanGesture` — из `useMemo` (не литерал: иначе перенастройка обработчика в натив на кадр); подписчик доли
  — дочерний вид (курсор, точка). Профиль — `ProfileChart` с развилкой файлами
  `profile-chart(.web).tsx`: web — inline SVG (SSR = первый рендер), `role="slider"`, pointer events, клавиши,
  `:focus-visible`; native — `react-native-svg` лениво (`load-svg-native.ts` после `svgSupported()`; старый
  dev-клиент — столбики), `adjustable` с `accessibilityActions`, RNGH v3 `usePanGesture({ activateAfterLongPress:
  250, runOnJS: true })` (касание без удержания — скрыть). Пути и градиент заливки — `profile.ts` пакета `@pokatim/route-view` (G1). Корень
  жестов — `components/gesture-root(.web).tsx` в `_layout` (RNGH не в web-бандле). Стат-блок карточки —
  `StatBlock equalColumns` (routes-04d — `variant="compact"`). Jest (routes-04d): мок `expo-location` — с `Accuracy`,
  ответ `getCurrentPositionAsync` задают тесты «Моё местоположение» (онбординг его не вызывает). Jest: `react-native-gesture-handler/jestSetup`, обёртка RNGH «без Reanimated», мок
  `react-native-svg` и его загрузчика, `Map`/`Camera` MapLibre с `ref` (методы — `__camera`/`__map` мока) в
  `jest.setup.ts`, web — заглушка `matchMedia` (`jest.match-media.web.ts`, `useReducedMotion` в jsdom); шаги жеста — `createGestureController` (у
  `fireGestureHandler` всегда есть ACTIVE; в jest RNGH резолвится в `lib/module` — шпионы и моки по этому пути).
- Раскладка карточки (routes-04d, ADR-0014): `SafeAreaView top` → `DetailHeader` (название — только здесь) →
  `OfflineBanner` → область `flex: 1` с `CatalogRouteMap fill bottomInset` (карта монтируется после измерения шторки;
  нет карты — фон `map.background`) и шторкой `components/bottom-sheet(.web).tsx` поверх (снап —
  `bottom-sheet-snap.ts`; native — RNGH v3 `usePanGesture` из `useMemo` + `Animated` из `react-native`, без
  Reanimated; web — pointer events, CSS-переход; перетаскивание — только за шапку; SSR — развёрнута; свёрнута — тело
  `display: none`). Шапка шторки — `StatBlock variant="compact"`, тело — `ScrollView` с `RefreshControl`, скраббинг
  выключает прокрутку тела (`useScrubScrollEnabled`): чипы, `ElevationProfile` без заголовка, `RouteActions` в строку,
  «Гонки на маршруте». 404 и ошибка без данных — без карты и шторки. Web: в `fill` колесо масштабирует без Ctrl/⌘.
  «Мой маршрут» — пока прежняя раскладка (follow-up).
- Главная — раздел `routes` (герой `RouteHero` по теме: у «Классики» текстовый, RC-8; у тем с `contour`/`numeral` —
  контур из `catalogRouteMapOptions`, запрос — только в компоненте варианта; пустой каталог — `EmptyState`).
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
- Публикация своих маршрутов (routes-06): бейдж рамки карточки — автор в каталоге (`routeAuthorLabel`: «От райдера» /
  «От райдера · Имя», имя — только с сервера) и статус заявки в «Моих» (`myRoutePublicationStatus`; `'unknown'` — без
  бейджа). Фильтр «Автор» — группа чипов `AUTHOR_CHIPS` в состоянии экрана, ключ ленты `['routes','list',{ city,
  distance, surface, author, limit },'pages']`. Блок «Публикация в каталоге» карточки своего маршрута —
  `my-route-publication.tsx` («Опубликовать» — только по `canPublish` сервера, подачи кончились — пояснение только у
  `rejected` и у `publication: null` с `submissionsExhausted`; «Отозвать заявку» / «Снять с публикации»
  — с подтверждением; переименование в `pending`/`approved` скрыто, A3; удаление `approved` — предупреждение). Экраны
  `routes/mine/publish/[id]` (`my-route-publish.tsx`, город — `CityPicker` формы райда) и `routes/report/[id]`
  (`route-report.tsx`, образец жалобы на райд) — внутри `Stack.Protected`. Мутации публикации и удаление: ответ — в
  кеш «Моих», затем инвалидация всего `['routes', …]`, кроме `['routes','mine']`. Ошибки — `error-messages.ts` по
  `details.reason` / `details.limit`. Карточка каталога маршрута райдера: «Гонки на маршруте» не запрашиваются
  (RC-1); `['routes','viewer',id]` (`GET /v1/routes/:id/me`) — только вошедшему, только клиент; «Пожаловаться» /
  «Вы пожаловались…» — по `canReport`/`reported` (блок — `AsyncContent`: скелетон, ошибка с повтором, баннер; экран
  жалобы — название своим `AsyncContent`); мета — `robots: noindex` (RC-6), OG без имени автора.
- Заезд по маршруту (route-rides-02, `docs/product/routes.md`): всё — `features/route-rides/` (зависимость
  односторонняя: карточки `routes/route-detail.tsx`, `my-route-detail.tsx` → `route-rides-block.tsx`; `route-rides/*` →
  `routes/{route-line-map,queries,my-routes-queries,format,detail-row}`). Ключи `['route-rides', routeId, …]` (`list`,
  `candidates`, `ride`, `track` с ревизией, `upload`) — через `withAccessToken`, только клиент; блок «Мои заезды» —
  только `signedIn` (SSR без блока), запрос списка — в экране карточки (pull-to-refresh). Адреса `routes/pick/
  [routeId]`, `routes/rides/[routeId]/[rideId]` — в `Stack.Protected` (выбор — не под `routes/rides/`: манифест SSR
  ставит маршрут с бо́льшим числом динамических сегментов раньше статического, в отличие от клиента; новый адрес той же
  глубины — строка в сторож `src/app-routes-manifest.server.test.ts`); `?mine=1` — только выбор геометрии карты и
  ссылки «К маршруту» (права — сервер). Загрузка файла — опрос `getTrackUpload` до финала (≤ 60 с) и один POST
  `{ uploadId }` (`use-route-ride-upload.ts`), не повторы POST: лимит 30/ч списывается до проверки готовности (RC-1);
  `NOT_READY` — один повтор; ответ загрузки — в кэш опроса; ошибка опроса — баннер с повтором. Опрос списка и детали —
  3 с первые 2 мин, затем 15 с; список — только в фокусе карточки (`subscribed`). Карта — `RouteLineMap` с пропсом `track` (`RouteMapTrack`); строка кандидата — общий
  `components/activity-pick-row.tsx` (`ActivityPickRow`, и в `races/pick`). Тексты ошибок — `routeRideErrorMessage`.

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
- Маршрут райда и «Рядом» (05c, ADR-0014 поправка 05c):
  - Форма — поле «Маршрут» (строка-кнопка) → `rides/route-pick?form=new|<rideId>` (`ride-route-pick.tsx`, внутри
    `Stack.Protected`): «Каталог / Мои» — `SegmentedControl`, «Без маршрута» сверху, в «Моих» только `ready`, не в
    каталоге — `Pill` «Виден только вам». Выбор — `route-choice-store.ts` (память, `take(form)` один раз), форма
    забирает его в `useFocusEffect`: `routeId` и дистанция `Math.round(distanceM / 1000)` с подсказкой «Из маршрута.
    Можно изменить.»; `RIDE_ROUTE_UNAVAILABLE` — под полем «Маршрут».
  - Карточка — `RideRouteBlock` под шапкой (только `ride.route` сервера): `public` — `RouteLineMap` каталога (3:2 в
    прокрутке) с маркером и `ElevationProfile` (общий `createScrubStore` экрана, `useScrubScrollEnabled` у
    `ScrollView`); `private` (организатор) — карта «Моего маршрута» без профиля (RC-9) и баннер «опубликуйте»; «Набор»
    — в `StatBlock`; ссылка «Маршрут райда» → `/routes/<id>` или `/routes/mine/<id>`.
  - Лента — «Список / Карта» (`SegmentedControl`) и чип «Рядом» — состояние вкладки `(tabs)/rides.tsx` (`useNear`):
    одно чтение позиции через `useLocate`, округление до 0,01° (`near.ts`), координаты — только в памяти экрана и в
    замыкании `queryFn`; в ключах `['rides','list',{ city, limit, near: seq|null },'pages']` и
    `['rides','map',{ city, near: seq|null }]` — счётчик нажатия, не координаты (не в URL, `console.*`, подписях a11y).
    «в N км от вас» — `distanceLabel` (`haversineMeters`) только при `start`. Отказ / ошибка / web без геолокации —
    `NearEmpty` («Открыть настройки» при `canOpenSettings`, иначе «Разрешить»; «Выбрать город» выключает «Рядом»).
  - Карта ленты — `RideMapView` → `RidePointsMap` (`ride-points-map(.web).tsx`, слои и группировка одинакового
    старта — `ride-points-style.ts`, только роли `theme.map.*`); native — `GeoJSONSource onPress`
    (`nativeEvent.features`), web — `on('click', layer)`; выбор точки — `RidePointCard` под картой; «Ещё N райдов без
    точки старта — в списке» → режим «Список». Запрос карты — только в режиме «Карта».
- Шит «Райд опубликован» (ride-published-og): форма создания ведёт на `/rides/<id>?published=1`; шит — только
  организатору (`viewer.role` сервера) будущего райда после монтирования (`components/modal-sheet.tsx` — модальный
  шит `Modal` RN поверх экрана: затемнение, `sheetSurface`, heading, `onRequestClose`; не `BottomSheet` карты).
  `ModalSheet` — единственное модальное окно приложения (шторка или `placement="dialog"`; окно установки PWA —
  обёртка с «×» в `headerAction`); имя окна — `aria-label` самого `Modal` (на web он — `role="dialog"`), панель
  второго dialog не создаёт.
  Действия — общий `ShareChoiceSheet`: «Карточка-приглашение» (`rides/invite/[id]`), «Ссылка» (`shareLink`; нет
  origin — пункта нет), «Закрыть»; закрытие снимает `published` (`router.setParams`).
- Жалоба (05b) — экран `rides/report/[id]` (`features/rides/ride-report.tsx`) внутри `Stack.Protected`: причина —
  `Chip` из `RIDE_REPORT_REASONS`, комментарий — однострочный `TextField` (фолбэк до многострочного поля базы), успех —
  баннер на месте формы. Кнопка «Пожаловаться» и строка «Вы пожаловались…» — только по `viewer.canReport` /
  `viewer.reported` сервера; скрытый райд (`phase: 'hidden'`, видит только организатор через `me`) — баннер без
  действий.

## Билеты (event-tickets, `docs/product/tickets.md`, ADR-0023)

- Экран `/tickets/[code]` — в корневом `Stack` **вне** `Stack.Protected`, гард в самом экране (RC-B1, образец —
  `settings/account/delete`): `unknown` — скелетон оболочки; `unavailable` — офлайн-копия или ошибка с повтором; гость —
  `rememberReturnPath('/tickets/<код>')` → «Вход»; вошёл — билет без онбординга (возврат к билету после входа —
  сразу, не дожидаясь шагов настройки: `skipsOnboarding`). Ответ web-сервера на `/tickets/*` — `Referrer-Policy:
  no-referrer`; запросы web к API — без `Referer` (`fetchImpl` в `lib/api-platform.web.ts`); 404 при обновлении скрывает показанный билет. Код из адреса — `canonicalTicketCode`
  (`TicketCode`); в allowlist возврата — только канонический код. `generateMetadata` — нейтральный `noindex` без кода и
  `og:url`, без `loader`: SSR-разметка одинакова для любого кода и без данных билета.
- Ключи: `['tickets','list'|'detail',code]`, `['races','ticket',id]` (мутации участия инвалидируют его и `['tickets']`),
  `['calendar','ticketing'|'registration',id]`. Хуки — `features/tickets/queries.ts`; мутации регистрации —
  `networkMode: 'always'`, «мест нет» и «закрыта» — только по ответу сервера (`EVENT_FULL`, `EVENT_REGISTRATION_CLOSED`);
  после регистрации, отмены и 409 сводка перезапрашивается в обход HTTP-кэша (`getEventTicketing(…, { fresh: true })`).
  Отмена регистрации и снятие заявки стирают офлайн-копию билета (`forgetCancelledTicket`).
- Офлайн-копии (`features/tickets/offline-store(.web).ts`, модель `offline-model.ts`): пишет каждый успешный `getTicket`
  (и предзагрузка ≤ 3 ближайших на Главной), 404 стирает копию кода; ≤ 10, до суток после события (просроченные
  удаляются и при чтении); владелец — `sub`
  сессии (чужой — стирание). Native: QR — только SecureStore `pokatim.ticketQr`, остальное — файл
  `tickets-offline.json` (кеш приложения, без бэкапа); web — `localStorage['pokatim.ticketsOffline']`. Стирание — `useSignOut` и подписка
  корневого layout на переход в `signedOut` (включая запуск без сессии); web — и признаки выхода соседней вкладки
  (`session-markers.ts`). QR не пишем в логи, URL и подписи a11y.
- Service worker: навигации на `/tickets/<код>` — сеть первой, успешный HTML — в кеш `tickets-shell-<версия>` под
  общим ключом, без сети — оттуда (офлайн-старт PWA); выход удаляет кеш (`clearOfflineTickets` web).
- QR — `features/tickets/qr-matrix.ts` (ядро `qrcode/lib/core/qrcode`, без рендереров canvas/png) → `path`; native —
  `react-native-svg` лениво (`useSvgLib`), web — inline `<svg>`; сторона — `layout.ticketQr`. Цвета — роли `ticket.qrInk`/`ticket.qrPaper`
  (`@pokatim/design-tokens`, светлая «бумага» во всех темах, контраст ≥ 7:1).
- «Поделиться» билетом — только ссылка на событие без кода и QR (RC-B2). «Как добраться» — `maps-link.ts` (поиск по
  адресу системными картами: Android — `geo:`, iOS/iPadOS — Apple Maps, иначе — Яндекс; платформа — развилка
  `maps-platform(.web).ts`, web по `navigator`; открытие — `openExternalUrl`, web `geo:` — в той же вкладке).
- Материалы события (PR C, plan-C §7): представление — `components/event-materials.tsx` (иконка темы, название,
  описание ≤ 2 строк, «PDF · 1,2 МБ» или домен; модель — `features/tickets/materials-format.ts`); ссылка — только после
  `RegistrationUrl.safeParse` → `openExternalUrl`, PDF — `downloadFile(api.eventFileUrl(id))`, текст — раскрытие
  описания. Карточки гонки и старта — `EventMaterialsBlock` (`features/tickets/event-materials-block.tsx`, ключ
  `['events', kind, id, 'materials']`, `staleTime` 60 с; скелетон, пусто/404 — блока нет, ошибка — по месту с повтором);
  билет — `TicketView.materials` без запроса (входит в офлайн-копию).

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
