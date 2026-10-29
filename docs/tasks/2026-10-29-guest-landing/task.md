# Гостевой лендинг «Покатим»

## 1. Title

guest-landing — первый экран невошедшего гостя: `/welcome` (web SSR + OG, индексируемый; iOS/Android — тот же экран).

## 2. Goal

Сейчас гость, открывший приложение или `/`, сразу попадает на «Регистрацию» и не видит, что это за сервис. Нужен
лендинг: что умеет «Покатим» (гонки по маршруту с результатами, сезон, кофе-райды, каталог маршрутов, календарь
стартов), живые публичные данные и призыв «Зарегистрироваться» / «Войти». На web — индексируемая страница с HTML и OG
с сервера (ADR-0003 п. 2). Продуктовое решение «Гостевая лента — отдельным решением» (`docs/product/home.md` Q5)
закрывается этой задачей.

## 3. Scope

Решения автора 2026-10-29 (G1–G6):

- **G1 Адрес.** Новый публичный экран `/welcome` (`apps/app`, группа гостя — рядом с «Регистрацией» и «Входом»).
  Гость без сессии с `/` и любого экрана под гардом вкладок уходит на `/welcome` вместо `/register`. Вошедший на
  `/welcome` — на `/` (как сейчас с `/register`).
- **G2 Возврат.** Гость, который на этом устройстве уже входил (`returning`), по-прежнему уходит сразу на `/sign-in`.
  Лендинг — новым гостям. С лендинга «Войти» доступно всегда.
- **G3 Структура (порядок):**
  1. Герой: словесный знак «Покатим», заголовок, лид, «Зарегистрироваться» (основная) и «Войти» (вторичная).
  2. «Гонки по маршруту» — текст + ближайшая гонка (как герой гонки Главной) → карточка `/races/<id>`.
  3. «Сезон» — текст + текущий сезон (название, даты) → `/seasons/<id>`; сезона нет — только текст.
  4. «Кофе-райды» — только текст (G4), без данных.
  5. «Маршруты» — текст + до 3 последних маршрутов каталога (длина, название, город) → `/routes/<id>`.
  6. «Календарь стартов» — текст + ближайший старт → `/calendar/<id>`.
  7. Нижний призыв: заголовок + те же две кнопки.
- **G4 Данные.** Только существующие публичные эндпоинты (`PublicReadGuard`): `GET /v1/races?scope=current&limit=1`,
  `GET /v1/seasons/current`, `GET /v1/routes?limit=3`, `GET /v1/calendar?limit=1`. Кофе-райды — описанием: лента
  райдов под входом, райды — UGC с `noindex`; нового эндпоинта нет.
- **G5 Пусто и ошибки.** Пустой раздел — текст раздела без живого блока (у гонки — «Пока нет открытых гонок», у
  маршрутов — «Маршрутов пока нет», у календаря — «Пока нет стартов в календаре», сезона нет — без строки). Ошибка
  или нет сети — текст раздела остаётся, живой блок не показывается (без экрана ошибки: лендинг читается без API).
- **G6 Web / SEO.** `/welcome` — HTML с сервера: тексты всех разделов и кнопки в разметке до JS; `loader` сеет живые
  данные (что успел получить за таймаут `public-ssr`), `generateMetadata` — `<title>`, description, OG
  (`og:url` = `/welcome`), без `robots`. Мета `/` — та же мета лендинга (превью ссылки на корень сайта), тело `/`
  не меняется. Относительные подписи времени («закрывается сегодня») — только после монтирования
  (`useMinskClockAfterMount`), без `useId` в SSR-разметке.

Тексты (ключи `landing.*` в `packages/i18n/src/ru.ts`; правка формулировок — в ревью автора на dev):

| Ключ | Текст |
|---|---|
| title (документ) | Покатим — гонки, сезон, кофе-райды и маршруты |
| hero.title | Катайтесь вместе и соревнуйтесь на своих маршрутах |
| hero.lead | Гонки по маршруту с результатами, сезонный зачёт, кофе-райды и каталог проверенных маршрутов — в одном приложении. |
| cta.register / cta.signIn | Зарегистрироваться / Войти |
| races.title / text | Гонки по маршруту / Проезжайте маршрут гонки в любой день окна, загружайте трек с устройства — результат и место появятся в протоколе. |
| season.title / text | Сезон / Очки за гонки складываются в общий зачёт сезона — по классам, полу и возрасту. |
| rides.title / text | Кофе-райды / Соберите покатушку с остановкой на кофе или присоединитесь к чужой: время, место, темп и кто едет. |
| routes.title / text | Маршруты / Маршруты команды с картой, профилем высоты и GPX — откройте и поезжайте. |
| calendar.title / text | Календарь стартов / Массовые велостарты в одном календаре: даты, дистанции и ссылка на регистрацию у организатора. |
| footer.title | Поехали? |
| description (мета) | = `app.tagline` |

## 4. Out of Scope

- Публичная лента кофе-райдов, гостевые вкладки, «Посмотреть без входа» (приложение без входа).
- `robots.txt`, sitemap, OG-картинка лендинга (follow-up).
- Смена экранов «Регистрация» / «Вход», писем, return-path allowlist (возврат после входа — без изменений).
- Сезонный декор (halloween) на лендинге.

## 5. Architecture Context

- Только `apps/app` и `packages/i18n` (+ `docs/product`). API, contracts, миграции, очереди — не меняются.
- Экран — фича `src/features/landing/` (экран, разделы, запросы), маршрут — тонкий файл `src/app/(onboarding)/welcome.tsx`
  (или иное место, которое обоснует architect, с учётом гардов корня и порядка SSR-манифеста).
- Гард вкладок в `src/app/_layout.tsx`: `redirectTo` гостя `returning ? '/sign-in' : '/register'` → `'/welcome'`
  для нового гостя.

## 5.1 Placement & Reuse Gate

- Переиспользуем: `RaceHero`, `RouteHero`/строки маршрутов, `CalendarStartHero`, `HomeSection` (если подходит без
  флагов «для гостя»), запросы `useNextRace`/`useNextCalendarStart`/`useLatestRoute`-семейство (ключи совместимы со
  списками вкладок), `publicPageMetadata`, `fetchPublicForSsr`, `useLoaderSeed`, `useMinskClockAfterMount`,
  компоненты `@rkarakulov/ui` и токены `@pokatim/design-tokens`, иконки — `components/icon.tsx`.
- Запрещено: дублировать форматирование гонки/старта/маршрута, хардкод цветов и шрифтов (только роли темы — все 7
  тем ADR-0016), строки вне i18n, отдельный HTTP-клиент.

## 6. Relevant Files

- `apps/app/src/app/_layout.tsx` — гарды корня, редирект гостя.
- `apps/app/src/app/(onboarding)/` — группа гостя (`register`, `sign-in`).
- `apps/app/src/app/(tabs)/index.tsx` — Главная: мета `/`, образец ленты.
- `apps/app/src/features/home/{heroes.tsx,home-section.tsx,queries.ts}` — герои и запросы Главной.
- `apps/app/src/app/seasons/[id].tsx`, `routes/[id].tsx` — образцы `loader` + `generateMetadata`.
- `apps/app/src/lib/{public-ssr.ts,page-metadata.ts,loader-seed*.ts,use-minsk-clock.ts}`.
- `apps/app/src/app-routes-manifest.server.test.ts` — сторож порядка SSR-маршрутов.
- `apps/app/e2e/web.spec.ts` — web-смоук (сейчас ждёт `/register` у гостя).
- `packages/i18n/src/ru.ts` — тексты.
- `docs/product/home.md` (Q5), `docs/product/onboarding.md`.

## 7. Implementation Notes

- SSR: сессия на сервере неизвестна → гарды пускают на `/welcome` (как на `/register`); экран не зависит от сессии.
- Мета `/`: `generateMetadata` в `(tabs)/index.tsx` (или layout) — та же функция меты лендинга, без запросов к API.
- Живые данные SSR: один `loader` на экран, запросы параллельно, частичный успех допустим; клиент — TanStack Query
  с `initialData` из посева, ключи — как у Главной/вкладок.
- Native: тот же экран; pull-to-refresh не обязателен.
- 375 px, светлая/тёмная, все темы — проверка на dev.

## 8. Risks / Assumptions / Open Questions

- Все web-смоуки, ждущие `/register` у гостя, переводятся на `/welcome` (гость без `returning`).
- Удаление аккаунта ведёт на «Регистрацию» с сообщением — не меняем.
- `[ASSUMPTION]` Индексируемость dev-стенда — не в scope (решается окружением).

## 8.1 Requirements Consistency (заполняет architect)

Architecture Review — guest-landing. **Status: CONCERNS** (блокеров нет; RC-5 — подтвердить у автора, до ответа coder
берёт рекомендованный вариант и пишет его в 8.2). Пути ниже — от `apps/app/`, если не указано иное.

- **RC-1 Размещение `/welcome` (решение architect).** В группе `(onboarding)` стоит `unstable_settings = {
  initialRouteName: 'register' }` (`src/app/(onboarding)/_layout.tsx:4`). Если положить файл в группу: прямой заход
  или deep link на `/welcome` подложит «Регистрацию» под лендинг (Android «назад» с лендинга уведёт на форму, на web
  форма смонтирована под лендингом). Если сменить initialRouteName на `welcome`, лендинг окажется под каждым
  `/register`, `/sign-in`, `/check-email`, `/forgot-password`: лишние 4 запроса к API и тексты лендинга в их HTML.
  Варианты: **A (рекомендую)** — корневой файл `src/app/welcome.tsx`, `<Stack.Screen name="welcome" />` в
  существующем `<Stack.Protected guard={!signedIn} redirectTo="/">` рядом с `(onboarding)` (`src/app/_layout.tsx:189-191`).
  Гард тот же, что у регистрации и входа (G1 по смыслу), стек `(onboarding)` не трогаем; «Зарегистрироваться» с
  лендинга — `push` → стек `[welcome, (onboarding)/register]`, «назад» возвращает на лендинг. B — в группе +
  `initialRouteName: 'welcome'` (минусы выше). C — в группе без изменений (минусы выше). Манифест SSR: `/welcome` →
  страница `/welcome` (проверено `createRoutesManifest`; ни один динамический маршрут верхнего уровня не перехватывает
  путь). AC5 читать как «`/welcome` → `/welcome`».
- **RC-2 Повтор бренда в `<title>`.** `publicPageMetadata` дописывает ` — Покатим` (`src/lib/page-metadata.ts:22`),
  а `landing.title` уже начинается с «Покатим — …» → «Покатим — гонки… — Покатим». **A (рекомендую):**
  `landingMetadata` = `{ ...publicPageMetadata({ title, description: t('app.tagline'), path: '/welcome' }), title:
  t('landing.title') }`, `og:title` — тоже `landing.title` (общий хелпер не меняется). B — сменить текст ключа на
  «Гонки, сезон, кофе-райды и маршруты» (получится «… — Покатим»; правка формулировки автора). C — опция в
  `publicPageMetadata` (правка общего хелпера ради одного вызова). `DocumentTitle` лендинга — та же строка.
- **RC-3 `og:url` у `/`.** «Та же мета лендинга» — **рекомендую** буквально ту же функцию: `og:url` = `/welcome`
  и на `/` (тело `/` — скелетон оболочки, содержательная страница — `/welcome`; одно превью). Альтернатива — `og:url`
  = `/` (две разные «канонические» точки). `robots` нет на обоих.
- **RC-4 G5 против `AGENTS.md` §4.12** (ошибка без данных — «Нет соединения» / «Не удалось загрузить» с повтором,
  ошибка обновления — баннер). G5 прячет живой блок без сообщения. Прецеденты необязательных блоков, которые
  схлопываются молча, уже есть: карта `race-route-map.tsx`, «Гонки на маршруте» в `routes/[id]`, порядок разделов
  Главной без профиля. Лендинг держится на статичном тексте, поэтому **принимаем G5 как задокументированное
  отступление** (`landing.md` + 8.2). Чего нет в G5, но что обязательно: первая загрузка — скелетон в слоте
  (`SkeletonHeroCard`, `RouteListCardSkeleton`), пока `isPending && fetchStatus === 'fetching'`; `fetchStatus ===
  'paused'` без данных (native офлайн — `onlineManager` на NetInfo) = «нет сети» → блока нет, иначе скелетон висел бы
  вечно. Ошибка обновления при показанных данных — данные остаются, без баннера.
- **RC-5 «Маршруты команды», а список — с UGC (подтвердить у автора).** Текст раздела «Маршруты команды с картой…»,
  но `GET /v1/routes?limit=3` (G4) отдаёт и маршруты райдеров (routes-06): бейдж с именем автора (U3), а их карточки
  — `noindex` как UGC (`src/app/routes/[id].tsx:52`). Индексируемый лендинг вынес бы UGC в выдачу. **A (рекомендую):**
  тот же эндпоинт с фильтром `author=team` (`CatalogRouteQuery.author`, `packages/contracts/src/routes/
  route-catalog.schema.ts:49`): `GET /v1/routes?author=team&limit=3`, ключ `['routes','list',{ author: ['team'], limit: 3 }]`.
  B — как в G4, `RouteListCard` с бейджем автора (текст раздела расходится с данными). C — как в G4 со скрытием автора
  флагом в `RouteListCard` (флаг «для гостя» — против 5.1).
- **RC-6 Знак «Покатим» — не заголовок.** Словесный знак `TopBar` — `accessibilityRole="header"` с именем «Покатим»;
  12 тестовых файлов узнают Главную по `findByRole('header', { name: 'Покатим' })` (`auth-guard.test.tsx:85`,
  `verify-link.test.tsx:93`, `onboarding-guard`, `not-found` …). Если знак лендинга тоже будет таким заголовком,
  гостевые тесты станут ложнозелёными. Решение: знак лендинга (`home.wordmark`, `textStyle('brand')`) без роли
  header, заголовок экрана — `landing.hero.title`.
- **RC-7 `HomeSection` не подходит без флагов:** обязательная ссылка `all` ведёт во вкладку под гардом, `AsyncContent`
  показывает ошибку с повтором (противоречит G5), `SectionHeader` из `@rkarakulov/ui` требует `kicker`, а в G3 его
  нет. Решение: свой `LandingSection` в `features/landing/`: заголовок `Text` с ролью header (`displaySm`/`displayTitle`),
  абзац `body`, слот живого блока; разделитель — `border.subtle`/`stroke.hairline`, как у `HomeSection`. Флагов в
  `HomeSection` нет.
- **RC-8 `now` у героев.** `RaceHero` (`src/features/home/heroes.tsx:30`) и `CalendarStartHero`
  (`src/features/calendar/calendar-hero.tsx:22`) принимают только `now: Date`. Форматтеры принимают `null`, кроме
  `calendarStatusLine(card, now: Date)` (`src/features/calendar/format.ts:54`). Расширить пропсы до `Date | null`
  (Главная не меняется); у старта строка «До старта N дней» — только при `now !== null`. На лендинге
  `now = useMinskClockAfterMount([...dataUpdatedAt])`: SSR и гидрация — даты с годом, без «сегодня / завтра».
- **RC-9 Строки без дублей.** Пустые состояния уже есть: `home.races.empty`, `home.routes.empty`, `calendar.empty`.
  Знак — `home.wordmark`. Новые `landing.*.empty` не заводить. `landing.cta.*` совпадают по тексту с
  `auth.register.submit` / `auth.signIn.action`, но по смыслу это другое (призыв, а не отправка формы) — отдельные
  ключи по таблице G3 допустимы. `description` = `app.tagline` (без нового ключа).
- **RC-10 Сезон.** `currentSeasonQuery` (`src/features/races/queries.ts:165-169`) не экспортирован. Нужен
  `useCurrentSeason(seed?)` на том же ключе `['seasons','current']`, что у `useHeaderSeason` (кэш общий). Между
  сезонами (`season: null`) на лендинге — только текст, без подбора `pickSeason` по списку (как G3; кнопка вкладки
  «Гонки» ведёт себя иначе — так и задумано).
- **RC-11 Loader на клиентской навигации (web).** Гард уводит с `/` на `/welcome` клиентски → `useLoaderData`
  тянет `/_expo/loaders/welcome` и приостанавливает экран до ответа (до ~2 с при медленном API). `loader` обязан всегда
  вернуть объект (`Promise.all` четырёх `fetchPublicForSsr` + `ssrData`, части — `null`) и не бросать.
  Офлайн-кейса нет: без сети восстановление сессии даёт `unavailable`, а не редирект.
- **RC-12 Тестовый объём.** Не противоречие, а объём: 11 юнит-файлов и 8 мест web-смоука ждут `/register` у гостя
  через гард (список — §11 TESTS). На лендинге по две кнопки «Зарегистрироваться» и «Войти» — в тестах
  `getAllByRole(...)[0]` / `.first()`.

## 8.2 Deviations from spec

- **RC-5 → только маршруты команды:** живой блок «Маршруты» — `GET /v1/routes?author=team&limit=3` (G4 говорил
  `?limit=3`). Причина: утверждённый текст раздела — «Маршруты команды…», маршруты райдеров — UGC с `noindex`, а
  лендинг индексируется. Решено оркестратором 2026-10-29 в духе утверждённых текстов; отражено в G4-реализации,
  `docs/product/landing.md`.
- **RC-4 → G5 против AGENTS §4.12:** ошибка живого блока — блок скрыт, без повтора (скелетон на первой загрузке,
  `paused` без данных — скрыт). Решение автора G5; отражено в `docs/product/landing.md`.
- **Живая регистрация после перезапуска (coder, 2026-10-29):** гард вкладок ведёт нового гостя на `/welcome`, но при
  `resumeOnLaunch` (токен регистрации жив) — на `/register`, как раньше. Причина: продолжение к «Подтвердите e-mail»
  запускает экран «Регистрация» (`register.tsx`, эффект `resumeOnLaunch`); с редиректом на лендинг 9 тестов
  `check-email.test.tsx` и `auth-guard` «живая регистрация после перезапуска» краснели — регрессия, экраны
  «Регистрация» менять нельзя (§11 OUT OF SCOPE). Подтвердить у автора.

## 8.3 Security checklist

Только публичные эндпоинты с `PublicReadGuard`; ПДн нет; данных наружу больше не становится. SSR-запросы — через
`fetchPublicForSsr` (кэш процесса, таймаут). Return-path allowlist не меняется. Security boundary не расширяется.

## 9. Acceptance Criteria

1. Гость (без сессии, не `returning`) на native и web с `/` попадает на `/welcome`; `returning` — на `/sign-in`;
   вошедший на `/welcome` — на `/`.
2. `/welcome`: семь блоков в порядке G3, тексты из таблицы, кнопки ведут на `/register` и `/sign-in`.
3. Живые данные G4 показываются и ведут на карточки; пусто/ошибка — по G5, без экрана ошибки.
4. Web: `GET /welcome` → 200, в HTML до JS — заголовок героя, тексты разделов, кнопки, `<title>`, description, OG
   с `og:url` `/welcome`, без `noindex`; гидрация без ошибок в консоли (смоук). `GET /` — мета лендинга.
5. Сторож SSR-манифеста: `/welcome` → `/(onboarding)/welcome` (или выбранная страница).
6. Темы: только роли темы; светлая/тёмная на 375 px без горизонтального скролла.
7. Тесты: юнит/компонентные на экран (данные, пусто, ошибка), на редирект гостя; web-смоук обновлён; `pnpm check`
   зелёный.

## 10. Documentation Impact

- `docs/product/home.md` — Q5: гость видит лендинг (ссылка на новый раздел).
- Новый `docs/product/landing.md` — решения G1–G6; `docs/product/README.md` — индекс.
- `.claude/rules/pokatim-app.md` — строка про `/welcome` (публичный экран гостя, SSR, мета `/`).
- ADR не требуется: в рамках ADR-0003 п. 2.

## 11. Implementation Context

Пути — от `apps/app/`, если не указано иное. API, contracts, миграции, очереди не меняются.

**ENTRY POINTS**

- `src/app/welcome.tsx` (новый, RC-1) — тонкий маршрут: `export const loader: LoaderFunction<LandingSeed> = () =>
  loadLandingSeed()`, `export const generateMetadata = landingMetadata`, по умолчанию
  `<LandingScreen seed={useLoaderSeed<LandingSeed>()} />`.
- `src/app/_layout.tsx:127-137` — `redirectTo` гостя: `returning ? '/sign-in' : '/welcome'`; `:189-191` —
  `<Stack.Screen name="welcome" />` в тот же `Stack.Protected guard={!signedIn} redirectTo="/"`, что и `(onboarding)`
  (вошедший на `/welcome` → `/`; пока сессия неизвестна — экран открыт, SSR отдаёт HTML).
- `src/app/(tabs)/index.tsx` — `export const generateMetadata = landingMetadata` (без запросов к API); тело
  Главной не меняется. На SSR `/` Главная не рендерится (`(tabs)/_layout.tsx:20` — `ShellSkeleton`), поэтому её
  `DocumentTitle` с метой не конфликтует.

**FILES TO MODIFY / CREATE**

Новые (`src/features/landing/`):
- `landing-screen.tsx` — `LandingScreen({ seed })`: `SafeAreaView` + `ScrollView`, `DocumentTitle(t('landing.title'))`.
  Блоки G3 по порядку: герой (знак `home.wordmark` без роли header — RC-6, заголовок `landing.hero.title` с ролью
  header, лид, `Button` primary «Зарегистрироваться» → `router.push('/register')`, `Button variant="secondary"`
  «Войти» → `router.push('/sign-in')`), гонки, сезон, кофе-райды (только текст), маршруты, календарь, нижний
  призыв (`landing.footer.title` + те же кнопки). `now = useMinskClockAfterMount([...dataUpdatedAt])`. Без
  pull-to-refresh, `TopBar`, `DecorLayer`, `OfflineBanner`.
- `landing-section.tsx` — `LandingSection` (RC-7): заголовок, текст, слот. Слот рендерит детей только при
  `data !== undefined`; при `isPending && fetchStatus === 'fetching'` — скелетон; иначе (ошибка, `paused`) — ничего (RC-4).
- `ssr.ts` — `LandingSeed = { races: RacePage | null; season: CurrentSeasonResponse | null; routes: CatalogRoutePage |
  null; calendar: CalendarPage | null }`, `loadLandingSeed()`: `Promise.all` четырёх `fetchPublicForSsr(path, Schema)`
  → `ssrData`, никогда не бросает. Пути — константы из тех же параметров, что у клиентских хуков (`URLSearchParams`
  от экспортированных `NEXT_RACE` / `NEXT_CALENDAR_START` / `LANDING_ROUTES`): `/v1/races?scope=current&limit=1`,
  `/v1/seasons/current`, `/v1/routes?author=team&limit=3` (RC-5; без него — `?limit=3`), `/v1/calendar?limit=1`.
- `metadata.ts` — `landingMetadata: GenerateMetadataFunction` (RC-2, RC-3): `publicPageMetadata({ title:
  t('landing.title'), description: t('app.tagline'), path: '/welcome' })` с заменой `title` и `openGraph.title` на
  `t('landing.title')`; без `robots`.
- `queries.ts` — `LANDING_ROUTES = { author: ['team'], limit: 3 } as const` и `useLandingRoutes(seed)`: ключ
  `['routes','list',LANDING_ROUTES]`, `api.listCatalogRoutes(LANDING_ROUTES)`, `staleTime` 60 с, `initialData: seed`.
  С ключом `useLatestRoute` (`{limit:1}`) и с ключом вкладки (`[..., 'pages']`) не пересекается; общий префикс
  `['routes','list']` для инвалидации — как задумано.

Изменения:
- `src/features/home/queries.ts:10-33` — экспорт `NEXT_RACE`, `NEXT_CALENDAR_START`; `useNextRace(seed?: RacePage)`,
  `useNextCalendarStart(seed?: CalendarPage)` → `initialData: seed` (Главная зовёт без аргумента — поведение то же).
- `src/features/races/queries.ts:165-169` — `export function useCurrentSeason(seed?: CurrentSeasonResponse)` поверх
  `currentSeasonQuery` (`initialData: seed`); `useHeaderSeason*` не меняются.
- `src/features/home/heroes.tsx:24-43` — `RaceHero.now: Date | null` (RC-8).
- `src/features/calendar/calendar-hero.tsx:15-38` — `now: Date | null`, `calendarStatusLine` только при `now`.
- `src/features/races/season-detail.tsx:110-136` — вынести строку сезона (название; даты `seasonDates` · фаза; роль
  link) в экспортируемый `SeasonLinkRow` (например, `src/features/races/season-row.tsx`). `OtherSeasonRows` и лендинг
  используют его; второй копии разметки нет.
- `packages/i18n/src/ru.ts` — ключи `landing.title`, `landing.hero.title`, `landing.hero.lead`, `landing.cta.register`,
  `landing.cta.signIn`, `landing.{races,season,rides,routes,calendar}.{title,text}`, `landing.footer.title`
  (тексты — таблица §3). Пустые — существующие ключи (RC-9).
- Живые блоки: гонка — `RaceHero` → `/races/<id>`, пусто — `home.races.empty` (без кнопки «Календарь стартов»: вкладка
  под гардом); сезон — `SeasonLinkRow` → `/seasons/<id>`, `season: null` — ничего; маршруты — до 3 `RouteListCard`
  (`src/components/route-list-card.tsx:202`, варианты темы без запросов карты) → `/routes/<id>`, пусто —
  `home.routes.empty`; календарь — `CalendarStartHero` → `/calendar/<id>`, пусто — `calendar.empty`. Пустое —
  `EmptyState` без `action` или строка `meta`.

**FILES TO READ**

`src/app/_layout.tsx`, `src/app/(onboarding)/_layout.tsx`, `src/app/(onboarding)/register.tsx`,
`src/app/seasons/[id].tsx`, `src/app/routes/[id].tsx` (образцы loader / мета), `src/app/(tabs)/index.tsx`,
`src/app/(tabs)/_layout.tsx`, `src/features/home/{heroes,home-section,queries}.tsx|ts`,
`src/features/calendar/{calendar-hero,format}.ts(x)`, `src/features/races/{queries.ts,season-detail.tsx,format.ts}`,
`src/components/{section-hero,route-list-card,document-title.web}.tsx`, `src/features/auth/auth-screen.tsx`
(образец раскладки), `src/components/top-bar.tsx` (знак), `src/lib/{public-ssr,page-metadata,loader-seed,loader-seed.web,use-minsk-clock}.ts`,
`src/features/routes/profile-chart.web.tsx:43-53` (урок: постоянный id вместо `useId` в SSR),
`src/__tests__/{app-routes.ts,auth-guard.test.tsx,public-metadata.test.ts}`, `src/app-routes-manifest.server.test.ts`,
`e2e/{web.spec.ts,project.ts,fixtures.ts}`, `.claude/rules/{app,pokatim-app,pokatim-tests,tests}.md`.

**TYPES & SCHEMAS** — только чтение `@pokatim/contracts`: `RacePage`/`RaceCard`, `CurrentSeasonResponse`/`SeasonCard`,
`CatalogRoutePage`/`CatalogRouteCard` (+ `CatalogRouteQuery.author`), `CalendarPage`/`CalendarStartCard`.
`@pokatim/api-client`: `listRaces`, `getCurrentSeason`, `listCatalogRoutes`, `listCalendar` — уже есть. `expo-router/server`:
`LoaderFunction`, `GenerateMetadataFunction`, `Metadata`. Новый тип — `LandingSeed` (локальный, в contracts не нужен).

**TESTS**

- Новый `src/__tests__/landing.test.tsx` (`renderRouter(appRoutes)`, `jest.mock('@/lib/api')`): 7 блоков в порядке
  G3 и тексты таблицы. Данные: герой гонки, строка сезона, ≤3 маршрута, герой старта ведут на карточки. Пусто по каждому
  разделу. Ошибки `ApiHttpError(500)` и `ApiNetworkError`: тексты на месте, нет «Не удалось загрузить» / «Повторить»,
  живого блока нет. Офлайн (`onlineManager.setOnline(false)`) без данных — без вечного скелетона. `season: null` —
  без строки. Кнопки → `/register`, `/sign-in`. Вошедший на `/welcome` → `/`. Посев:
  `LandingScreen seed={…}` — данные с первого рендера, без ожидания запроса. Маршруты запрошены с `author: ['team'],
  limit: 3`. Свою SSR-разметку `react-dom/server` здесь не строить; совпадение гидрации проверяет смоук.
- `src/__tests__/app-routes.ts` — `welcome: WelcomeRoute`.
- `src/app-routes-manifest.server.test.ts` — `['/welcome', '/welcome']`, `['/', '/(tabs)/index']`.
- `src/__tests__/public-metadata.test.ts` — мета `/welcome` (точный `<title>` без повтора бренда, description =
  `app.tagline`, `og:url` = `WEB_ORIGIN/welcome`, без `robots`); мета `(tabs)/index` = мета лендинга. `loader`:
  4 пути на `API_INTERNAL_URL`, частичный сбой → `null` только у своей части, без `API_INTERNAL_URL` → все `null`,
  не бросает.
- Гард: `/` и экраны под гардом вкладок у нового гостя → `/welcome` (заголовок `landing.hero.title`, путь `/welcome`).
  Править: `auth-guard.test.tsx:23-37,51-70,89-94`, `race-pick.test.tsx:83-88`, `route-ride.test.tsx:88-95`,
  `settings-screen.test.tsx:173-179`, `race-detail.test.tsx:138-145,234-240`, `season.test.tsx:307-313`,
  `onboarding-guard.test.tsx:107-111`, `race-disputes.test.tsx:443-450`, `calendar-detail.test.tsx:186-193,223-229`,
  `my-routes.test.tsx:280-286`, `route-ride-pick.test.tsx:110-115`. В этих файлах — моки `listRaces` /
  `getCurrentSeason` / `listCatalogRoutes` / `listCalendar`, если тест иначе ловит лишние вызовы.
- Остаются на `/register` (явный переход, не гард): `sign-in.test.tsx:165-235` (`dismissTo`), `check-email.test.tsx:67-72`
  (`Redirect`), `verify-link.test.tsx:199-211` («К регистрации»), `account-delete.test.tsx:118` (удаление →
  «Регистрация» + «Аккаунт удалён», `settings/account/delete.tsx:36`), `register.test.tsx`. `returning` → `/sign-in` —
  уже покрыт (`onboarding-guard.test.tsx:237`).
- `src/features/calendar/calendar-hero.test.tsx` — `now={null}`: без «До старта N дней»; `RaceHero` с `now={null}` —
  дата с годом. `season.test.tsx` — зелёный после выноса `SeasonLinkRow`.
- `packages/i18n` — новых тестов не нужно (сторож дублей с базой — `src/index.test.ts`).
- `e2e/web.spec.ts`: `expectGuestHome` (`:80-90`) при API → `/welcome` и заголовок героя; `:220,:369,:388,:407,
  :426,:453` → `/welcome`. Сценарий `:535-537`: `/` → `/welcome` → «Зарегистрироваться» (`.first()`) → `/register`.
  Новый шаг: `GET /welcome` → 200, в HTML до JS — заголовок героя, тексты пяти разделов, обе кнопки,
  `<title>Покатим — гонки, сезон, кофе-райды и маршруты</title>`, description, `og:url` `${BASE_URL}/welcome`, нет
  `noindex`; `page.goto('/welcome')` без ошибок гидрации, «Войти» → `/sign-in`. `GET /` — тот же `<title>` и `og:url`.
  С API — после `publishHomeData` название гонки в HTML `/welcome` (посев). Ожидаемых отказов в `e2e/project.ts` не
  добавлять (без API отказ `ERR_CONNECTION_REFUSED` уже допущен в `fixtures.ts`).

**OUT OF SCOPE** — API, contracts, миграции, новые эндпоинты; `robots.txt`, sitemap, OG-картинка; экраны
«Регистрация» и «Вход» и `initialRouteName` группы `(onboarding)`; `DetailHeader` («назад» гостя по-прежнему на `/`,
дальше гард); return-path и allowlist; письма; сезонный декор; правки `HomeSection` и общего `publicPageMetadata`;
индексируемость dev-стенда.

**Documentation Impact** — как §10. Добавить: в `docs/product/landing.md` — отступления RC-4 (G5 и §4.12), решения
RC-1 (корневой `welcome`), RC-3 (`og:url` `/` = `/welcome`), RC-5 (`author=team`, если автор согласен).
`.claude/rules/pokatim-app.md`: строка в «Публичные экраны по ссылкам» (`welcome` — корневой экран в
`Stack.Protected !signedIn`, `loader` из 4 публичных списков, мета `/` = мета лендинга, блоки без ошибок) и правка
«Сессия в вебе»/гардов: новый гость → `/welcome`, `returning` → `/sign-in`.

## 12. Outcome

**Статус:** реализовано, гейты зелёные; web-смоук без API — 20 passed / 5 failed (см. ниже), с API — не прогонялся.
Коммит — в ветке `feature/guest-landing` (не запушен).

**Изменения**

- Новый экран `/welcome` — корневой `src/app/welcome.tsx` (RC-1) в `Stack.Protected guard={!signedIn}` рядом с
  `(onboarding)`; фича `src/features/landing/` — `landing-screen.tsx` (7 блоков G3, знак без роли header — RC-6),
  `landing-section.tsx` (RC-7, слот по RC-4), `ssr.ts` (`loadLandingSeed`, пути из `NEXT_RACE` / `NEXT_CALENDAR_START`
  / `LANDING_ROUTES`), `metadata.ts` (`landingMetadata`, RC-2/RC-3), `queries.ts` (`LANDING_ROUTES`,
  `useLandingRoutes`, RC-5).
- Гард вкладок: новый гость → `/welcome`, `returning` → `/sign-in`, живая регистрация → `/register` (8.2).
- Мета `/` = `landingMetadata` (`(tabs)/index.tsx`), тело Главной не менялось.
- `useNextRace(seed?)`, `useNextCalendarStart(seed?)` (экспорт `NEXT_RACE`, `NEXT_CALENDAR_START`),
  `useCurrentSeason(seed?)` на ключе `['seasons','current']` (RC-10); `RaceHero.now` и `CalendarStartHero.now` —
  `Date | null`, «До старта N дней» только при `now` (RC-8).
- `SeasonLinkRow` + `seasonDates` / `seasonPhaseLabel` вынесены в `features/races/season-row.tsx`;
  `OtherSeasonRows` использует его (`seasonDates` реэкспортирован из `season-detail.tsx`).
- i18n: 17 ключей `landing.*` (тексты §3); пустые подписи — существующие ключи (RC-9).

**Файлы** (от `apps/app/`, если не указано): `src/app/welcome.tsx`, `src/app/_layout.tsx`, `src/app/(tabs)/index.tsx`,
`src/features/landing/{landing-screen,landing-section}.tsx`, `src/features/landing/{ssr,metadata,queries}.ts`,
`src/features/home/{queries.ts,heroes.tsx}`, `src/features/calendar/calendar-hero.tsx`,
`src/features/races/{queries.ts,season-detail.tsx,season-row.tsx}`, `e2e/web.spec.ts`, `packages/i18n/src/ru.ts`.

**Docs:** `docs/product/landing.md` (новый: G1–G6, RC-1/3/4/5, живая регистрация), `docs/product/README.md` (индекс),
`docs/product/home.md` (Q5), `.claude/rules/pokatim-app.md` (лендинг в «Публичные экраны», гард нового гостя).

**Тесты**

- Новые: `src/__tests__/landing.test.tsx` (16: порядок блоков и тексты, данные → карточки, `author: ['team'], limit:
  3`, пусто, ошибки 500 / сеть без «Не удалось загрузить» и «Повторить», частичный сбой, скелетоны, офлайн без вечного
  скелетона, посев с первого рендера и частичный посев, кнопки, «назад» на лендинг, `/` → `/welcome`, вошедший → `/`);
  `src/features/home/heroes.test.tsx` (`RaceHero now={null}` — дата с годом); `calendar-hero.test.tsx` (+2, `now={null}`).
- `public-metadata.test.ts` (+8: мета `/welcome`, мета `/` = мета лендинга, loader — 4 пути, частичный сбой по каждой
  части, без `API_INTERNAL_URL`); `app-routes-manifest.server.test.ts` (+2: `/welcome`, `/`); `app-routes.ts`
  (`welcome`).
- Гостевые тесты гарда → `/welcome` и заголовок героя: `auth-guard`, `race-pick`, `route-ride`, `settings-screen`,
  `race-detail`, `season`, `onboarding-guard`, `race-disputes`, `calendar-detail`, `my-routes`, `route-ride-pick`.
- Тесты писались до кода, но красный прогон до реализации не фиксировался (первый прогон — уже после кода, зелёный).

**Проверки (реальные)**

- `pnpm --filter @pokatim/app test` → `Test Suites: 212 passed, 212 total; Tests: 1961 passed, 1961 total`.
- `pnpm --filter @pokatim/app typecheck` → `tsc --noEmit`, exit 0.
- `pnpm --filter @pokatim/i18n test` → `Test Files 2 passed; Tests 14 passed`.
- `pnpm format:check` → `All matched files use Prettier code style!`; `pnpm lint` → exit 0; `pnpm arch:check` →
  `no dependency violations found (1810 modules, 6784 dependencies cruised)`.
- `EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 pnpm build:web` → `Exported: dist`.
- Web-смоук без API (`E2E_PORT=8190`, `playwright test e2e/web.spec.ts`): 20 passed, 8 skipped (блок «с API»),
  5 failed — «гард входа» без API у `/rides/report`, `/rides/invite`, `/rides/route-pick`, `/routes/pick`,
  `/routes/rides`: экран показывает «Не удалось загрузить», а смоук ждёт «Нет соединения» (ветка `else` без API, в CI
  не исполняется — там `E2E_API=1`). Эти экраны и их ветки смоука задача не меняла; на базовой ветке не перепроверено.
  Новые и изменённые шаги (`/`, `/welcome` HTML и мета, «Войти» → `/sign-in`, гидрация без ошибок консоли) — passed.

**NOT VERIFIED:** смоук с API (`E2E_API=1`: `/` → `/welcome` → «Зарегистрироваться» → `/register`, название гонки в HTML
`/welcome` после `publishHomeData`, переходы гарда на `/welcome`) — нет локальных API/Mongo/Redis, прогонит CI;
iOS/Android, 375 px, все 7 тем светлая/тёмная — ручная проверка на dev.

**Follow-ups**

- Подтвердить у автора: RC-5 (`author=team`) и живую регистрацию → `/register` (8.2).
- Ветки смоука «без API» для экранов под гардом с собственным состоянием (5 тестов выше) — разобрать отдельно.
- `robots.txt`, sitemap, OG-картинка лендинга (вне scope).
- В гостевых тестах автомок `api` без ответов даёт в консоли «Query data cannot be undefined» от запросов лендинга —
  на результат не влияет; при желании — моки списков в этих файлах.
