# PLAN — PR B «Профиль райдера»: приложение (`apps/app`, `packages/i18n`)

Задача: `task.md` (разделы 3 «PR B», 9 AC 12–16). Шаг PLAN архитектора, 2026-10-28, проверено по
`feature/rider-profile` (c7ace06 + незакоммиченный PR A). **Зависимость:** PR B начинается после слияния PR A. Имена
схем и методов api-client ниже взяты из task.md 11.5; перед кодом сверить с фактическим `packages/contracts` и
`packages/api-client` (п. 0).

Status: **CONCERNS**. Блокеров нет. Есть 4 решения для человека (раздел 9), coder идёт по рекомендациям.

---

## 0. Предусловия и сверка с PR A

- Контракты: `ProfileView.{club, avatar, publicId}` (с `.default`), `UpdateProfileRequest.club`, `RiderClub`,
  `RIDER_CLUB_MAX`, `AVATAR_MAX_BYTES`, `AVATAR_MIN_CROP_PX`, `AvatarCropQuery`, `RiderPublicId`, `AvatarId`,
  `RiderStats`, `RiderRaceHistoryItem/Page`, `RiderRideHistoryItem/Page`, `PublicRiderProfile`, `PublicRiderRace/Page`,
  коды `AVATAR_FORMAT_UNSUPPORTED | AVATAR_TOO_LARGE | AVATAR_INVALID` в `ErrorCode`.
- api-client: `uploadAvatar(token, body, crop?)`, `deleteAvatar(token)` (RC-A5: `POST /v1/profile/avatar/delete`),
  `avatarUrl(id)`, `getProfileStats`, `listProfileRaces`, `listProfileRides`, `getRider(publicId)`,
  `listRiderRaces(publicId, params)`. `avatarUploadRequest` в PR B **не нужен** (см. 4.3).
- Любое расхождение имён — правка плана в отчёте, не копия DTO в приложении (AGENTS §4.2).

## 1. Placement

| Что | Где | Почему |
|---|---|---|
| Маршрут своего профиля | `apps/app/src/app/profile.tsx` (тонкий: `useSettingsShell()` → `OwnProfileScreen`) | как `notifications.tsx`: корневой сегмент внутри `Stack.Protected` |
| Экран своего профиля | `apps/app/src/features/profile/own-profile-screen.tsx` | фича `profile` уже есть (`queries.ts`, `profile-form.tsx`) |
| Шапка профиля `.phead` + личная линия `.prule` | `features/profile/profile-head.tsx` (`ProfileHead`, `ProfileHeadSkeleton`) | общая для своего и публичного экрана |
| Статистика | `features/profile/profile-stats.tsx` (на `StatBlock`) + форматтеры в `features/profile/profile-format.ts` | чистые функции, unit |
| История «Гонки / Райды» | `features/profile/profile-history.tsx` (свой), строки — `features/profile/history-rows.tsx` (`RaceHistoryRow`, `RideHistoryRow`, `HistoryRowsSkeleton`) | строки общие с публичным экраном |
| Аватар (фото / пусто) | `apps/app/src/components/rider-avatar.tsx` (`RiderAvatar`) | продуктовый компонент (AGENTS §4.11), его используют TopBar, шапка, форма |
| Выбор фото native | `features/profile/pick-avatar.ts`, `image-picker-support.ts` (+ `.web.ts`), `load-image-picker.ts` | развилка файлами, ленивый нативный модуль |
| Выбор и обрезка web | `features/profile/pick-avatar.web.ts`, `avatar-crop.web.tsx`, чистая математика `avatar-crop-math.ts` | DOM и pointer events только в `.web` |
| Блок «Фото» формы | `features/profile/avatar-editor.tsx` + `avatar-editor.web.tsx` | экран не знает о платформе (AGENTS §4.13) |
| Мутации и запросы | `features/profile/queries.ts` (расширить) | ключи `['profile', …]` |
| Тексты ошибок фото | `features/profile/avatar-errors.ts` | образец `features/devices/error-messages.ts` |
| Публичный маршрут | `apps/app/src/app/riders/[id].tsx` (`loader`, `generateMetadata`, экран) | как `rides/[id].tsx` |
| Публичный экран и запросы | `apps/app/src/features/riders/{rider-screen.tsx,queries.ts}` | новая фича: свой ключ `['riders', …]` |
| SSR-путь по непрозрачному токену | `apps/app/src/lib/public-ssr.ts` — расширить `publicPath` | сейчас там жёстко `Uuid`, а `publicId` — 43 символа base64url (**находка**, 3.4) |
| Токен 56 px | `packages/design-tokens/src/index.ts` → `layout.avatarProfile: 56` | в базе `size` есть только 32/30/24 (3.6) |

Новых пакетов нет. В app-foundation — follow-up (раздел 10): `Avatar` с плейсхолдером и `size.avatarLg`.

## 2. Reuse / запрещённые дубли

- `@rkarakulov/ui`: `AsyncContent`, `SkeletonGroup`/`SkeletonText`/`SkeletonListRow`, `SegmentedControl`, `TextAction`,
  `Button`, `Banner`, `EmptyState`, `Pill`, `TextField`, `Toggle`. Базовый `Avatar` (RN `Image`, пусто — пустой
  квадрат без иконки) **не подходит**: нужны `expo-image` и иконка человека как в `GoingStack`. Поэтому делаем
  продуктовый `RiderAvatar` и ставим follow-up в базу. Свою рамку `.ava` не изобретать: те же роли, что в базе и
  `GoingStack` (`borderColor: text.primary`, `stroke.hairline`, фон `surface.raised`, в шапке — `surface.default`
  по прототипу `.phead-name .ava{background:var(--bg)}`).
- Приложение: `StatBlock` (`components/stat-block.tsx`), `DetailHeader`, `DocumentTitle`, `OfflineBanner`, `Icon`
  (`person`, `zoomIn`, `zoomOut` уже в реестре), `useSettingsShell`, `usePullToRefresh`, `useMinskClockAfterMount`,
  `useMounted`, `public-ssr.ts`, `useLoaderSeed`, `publicPageMetadata`.
- Форматтеры, только чтение и импорт:
  - `features/races/format.ts` — `formatElapsed`, `formatRaceWindow`;
  - `features/races/participation-format.ts` — `resultPill(status)` (плашка: `final`/`revised`/`dq` входят в
    `RESULT_TONES`, годится и для публичных строк), `resultElapsed`, `groupLabel`, `tierLabel`;
  - `features/standings/standings-format.ts` — `placeView(place, tied)` (текст «=6» и a11y);
  - `lib/minsk-format.ts` — `formatMinskDateTime`, `meta`; `features/rides/format.ts` — `distanceText`.
- Состояния блоков — `TabFailure`, `loading`, `RowsSkeleton`, `MoreAction` из `features/races/results-table.tsx`. Их
  уже импортирует `ProfileSeasonBlock`, это только импорт. Риск: файл правит параллельная сессия (раздел 11).
- «Показать ещё» — по образцу `RouteRaces` (`features/routes/route-detail.tsx`): `fetchNextPage({ cancelRefetch:
  false })`, ошибка следующей страницы — баннер с повтором, догрузка — скелетон строки. Без `onEndReached`.
- Блок «Сезон» — существующий `ProfileSeasonBlock` (`features/standings/profile-season-block.tsx`), переносится
  целиком, без правок.
- Подтверждение удаления — инлайн-панель с локальным `confirming`, как у `my-route-detail.tsx`. Нативный `Alert`
  нельзя (на web не работает). `WithdrawConfirm` из `features/races/participation` не тянуть: зона параллельной
  сессии.
- Ошибки — `apiErrorCode`, `actionErrorMessage`, `retryAfterSec` (`features/auth/error-messages.ts`),
  `formatCountdown` (`lib/countdown.ts`).
- **Запрещено:** свой `fetch` в экранах; копии DTO; свой форматтер места или времени; `Platform.OS`; px-литералы;
  `Alert`; `expo-image-picker` статическим импортом; `onEndReached` для истории.

## 3. Маршруты и экраны

### 3.1 `/profile` — свой профиль (AC12, AC13)

- `src/app/_layout.tsx`: `<Stack.Screen name="profile" />` внутри первого `Stack.Protected`, рядом с
  `settings/profile`. Комментарий: «профиль райдера (rider-profile): вход — аватар верхней панели Главной; гард и
  оболочка — как у „Настроек“».
- `src/__tests__/app-routes.ts`: импорт `OwnProfileRoute from '../app/profile'`, ключ `profile: OwnProfileRoute`.
- **Находка — `/profile` сейчас используется как «неизвестный адрес»:**
  - `apps/app/e2e/project.ts`: `NOT_FOUND_PATHS = ['/profile', '/_sitemap']` → заменить на `'/no-such-page'`;
  - `src/__tests__/not-found.test.tsx`: `initialUrl: '/profile'` → `'/no-such-page'`.
  Без этого после PR B упадут `e2e:web` и jest.
- Раскладка (сверху вниз), `SafeAreaView edges=['top']` → `ScrollView` с `RefreshControl`:
  1. `DetailHeader` (`fallback: '/'`), без названия: имя крупно в шапке. Заголовок документа — `DocumentTitle`
     «Профиль — Покатим».
  2. `ProfileHead` по `ProfileView`: аватар 56, имя `displayTitle` или «Имя не указано» (`text.secondary`), личная
     линия = клуб; клуба нет — линия без текста (`.prule.empty` прототипа: две линии без отступа).
     `AsyncContent(['profile'])` + `ProfileHeadSkeleton`.
  3. Действия `TextAction`: «Редактировать профиль» → `/settings/profile`; «Как вас видят другие» →
     `/riders/<publicId>` при `publicId !== null`. При `null` — `meta`-подсказка «Другие увидят профиль, когда вы
     укажете имя и включите показ в результатах» (ссылка в ней же ведёт в «Редактировать профиль»).
  4. Статистика: `['profile','stats']`, `AsyncContent` со скелетоном той же раскладки (`StatBlock` default или
     `SkeletonText displayStat`). Ячейки: «Заезды» (`activities`), «км» (`distanceM/1000`, одна десятая через
     `number()`), «Набор» м, «В зачёте» (`races`, RC-A3), «Подиумы», «Лучшее место» (`placeView` первого из
     `bestPlaces`; нет — «—»). Нули — это данные, не пустое состояние. Под блоком при `bestPlaces.length > 0` —
     «Лучшие места»: строки `RaceHistoryRow` в компактном виде (место, название), нажатие → `/races/<id>`.
  5. `ProfileSeasonBlock` (перенос из `settings/profile`; без своих строк блок скрыт сам).
  6. «История»: заголовок `displaySm` + `SegmentedControl` `races | rides` (состояние экрана `useState`, не URL).
     Запрос активной вкладки: `enabled` только у выбранной, первая страница «Райдов» — при первом переключении.
     Подробности — 3.3.
  7. Место под достижения — **только комментарий** в коде (`// rider-profile: здесь — «Эмаль» достижений, следующая
     задача`). Никаких заглушек.
- Pull-to-refresh: `usePullToRefresh([profile.refetch, stats.refetch, history.refetch активной вкладки,
  useStandingsRefetch(season.id)])`. Последний — только при известном сезоне, как на экране сезона.
- `focusManager` уже подключён — своего polling нет.

### 3.2 Вход — аватар в `TopBar` (AC12)

- `components/top-bar.tsx`: новые пропсы `onOpenProfile?: () => void` и `avatarId?: string | null`. Кнопка —
  **последней справа**, после «Настроек» (`.topbar .ava` прототипа). `Pressable` `minWidth/minHeight:
  size.touchMin`, `accessibilityRole="button"`, `accessibilityLabel={t('profile.title')}`, внутри
  `RiderAvatar dimension={size.avatarTopBar}` (30 px по прототипу `.topbar .ava{width:30px}`, токен **уже есть**;
  32 из брифа — это `size.avatar` строк таблиц). Нет `onOpenProfile` — кнопки нет: остальные вкладки не меняются.
- Устаревший JSDoc «место будущего аватара „Личная линия“» у `onOpenDevices` — поправить.
- `src/app/(tabs)/index.tsx`: `onOpenProfile={() => router.push('/profile')}`, `avatarId={useOwnAvatarId()}`.
- `useOwnAvatarId()` (`features/profile/queries.ts`): `useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn:
  fetchProfile, staleTime: Infinity, select: (p) => p.avatar?.id ?? null })` — тот же кэш и тот же `staleTime`, что
  `useHomeSectionOrder` (`features/home/queries.ts`): лишнего запроса нет. Пока профиль не пришёл или при ошибке —
  пустой квадрат. Скелетона нет: это навигация, а не данные экрана; ошибки на Главной нет (как порядок разделов).

### 3.3 История (AC13)

- Своя (`features/profile/queries.ts`, всё через `withAccessToken`, `staleTime: DEFAULT_STALE_MS`):
  - `useProfileRaces(enabled)` — `useInfiniteQuery` `['profile','races','pages']`, `limit: 10`;
  - `useProfileRides(enabled)` — `['profile','rides','pages']`;
  - `getNextPageParam: (page) => page.nextCursor`.
- `RaceHistoryRow` (сетка `.rr`: место · название + дата + плашка · время), всё на `Pressable`
  (`accessibilityRole="button"`), → `/races/<race.id>`:
  - место: `placeView(place, tied).text`, `textStyle('displayXs')` (= `.rr .pl` 600 18/22, display-шрифт темы:
    Playfair у «Классики»), колонка `minWidth: size.skeletonWord`; места нет — «—»;
  - название — `titleSm` (`numberOfLines={1}`);
  - дата — `meta`: дата окна по Минску **с годом** (история — прошлое; `formatMinskDateTime(windowStartsAt, null)`
    или `formatRaceWindow(…, null)`);
  - плашка — `Pill` из `resultPill(result.status)`. `withdrawn` в истории нет (сервер их исключает), `null` — без
    плашки;
  - уровень и группа — во второй строке `meta` (`tierLabel`, `groupLabel`; `'unknown'` — без подписи);
  - время — `textStyle('time')`, `resultElapsed(result)`;
  - a11y одной строкой: «{название}, {дата}, место {placeView.a11y}, {статус}, время {время}».
- `RideHistoryRow`: название `titleSm`, дата и время старта (`formatMinskDateTime(startsAt, null)`), «{N} км»
  (`distanceText`), роль «Организатор» / «Участник» (`'unknown'` — без подписи); → `/rides/<id>`.
- Состояния каждой вкладки (§4.12):
  - первая загрузка — `HistoryRowsSkeleton` (3 строки высотой `size.rowMin`);
  - ошибка без данных — `TabFailure`;
  - пусто — `EmptyState`: «Вы ещё не участвовали в гонках» с действием «Все гонки» → `/races`; «Прошедших райдов
    пока нет» с «Все райды» → `/rides`;
  - ошибка обновления — строки остаются, баннер «Данные могли устареть» с повтором;
  - догрузка — скелетон строки, ошибка — баннер с повтором, «Показать ещё» — `MoreAction` или копия логики
    `RouteRaces` с `disabled` на время запроса.
- Ключ вкладки в `SegmentedControl` — `races | rides`, подписи — «Гонки» / «Райды».

### 3.4 `/riders/[id]` — публичный профиль (AC15)

- `src/app/_layout.tsx`: `<Stack.Screen name="riders/[id]" />` в корневом `Stack` **вне** `Stack.Protected`, рядом с
  `rides/[id]`. Комментарий — как у публичных карточек. `app-routes.ts`: `'riders/[id]': RiderRoute`.
- **Находка — `publicPath` проверяет только `Uuid`** (`lib/public-ssr.ts:63`). Расширить сигнатуру необязательной
  схемой id: `publicPath(prefix, id, suffix = '', idSchema: z.ZodType<string> = Uuid)`. Вызов —
  `publicPath('/v1/riders', params.id, '', RiderPublicId)`. Старые вызовы не меняются. Тест —
  `lib/public-ssr.test.ts`: токен 43 символа проходит, `../x` и 42 символа — `null`. Правило в `pokatim-app.md`
  уточнить: «`Uuid` или схема токена из contracts до запроса».
- `riders/[id].tsx`:
  - `loader` — `ssrData(await riderForSsr(params))`, `fetchPublicForSsr(path, PublicRiderProfile)`;
  - `generateMetadata` — **всегда** нейтральная мета: `publicPageMetadata({ title: t('riders.title') /* «Профиль
    райдера» */, description: t('app.tagline') })` + `robots: 'noindex'`, **без `path`** (без `og:url`);
  - имя, клуб и аватар в мета **не попадают** при любом статусе. Доводы: AC15 «без ПДн в мета»; согласие можно
    отозвать, а превью мессенджеров кэшируются навсегда; `publicId` — отзываемая ссылка, как токен письма.
- `features/riders/queries.ts`:
  - `riderKey = (id) => ['riders','detail',id]`, `useRider(id, seed, enabled)` — `api.getRider`, `initialData: seed`,
    `staleTime: PUBLIC_STALE_MS` (60 с, как у маршрутов);
  - `useRiderRaces(id, enabled)` — `['riders','races',id,'pages']`, `api.listRiderRaces`. Ключи выбраны по образцу
    `['routes','detail',id]` / `['routes','races',id,'pages']` вместо `['riders',id]` из брифа: тот же префикс
    `['riders']` для инвалидации, единый стиль ключей.
- `features/riders/rider-screen.tsx` (`RiderScreen({ id, seed })`):
  - `valid = RiderPublicId.safeParse(id).success`. Невалидный id — «Профиль недоступен» без запроса;
  - `notFound` = невалидный id или (`data === undefined` и `apiErrorOf(error)?.code === 'NOT_FOUND'`) → `EmptyState`
    «Профиль недоступен», текст «Райдер скрыл профиль или ссылка устарела», действие «На главную» → вошедшему `/`,
    гостю `/` (гард решит сам);
  - сеть или сервер — `AsyncContent`; `OfflineBanner` при показанных данных;
  - данные: `ProfileHead` (имя, клуб, аватар), `StatBlock`: «В зачёте», «Подиумы», «Лучшее место» (`stats.bestPlace`
    → `placeView(bestPlace, false)`, `null` → «—»);
  - «Гонки» — `useRiderRaces(id, valid && rider.data !== undefined)`: запрос только после найденного профиля, нет
    двойного 404. Строки — `RaceHistoryRow` в публичном варианте: статус `final | revised | dq`, без уровня;
  - пусто — «Пока нет опубликованных результатов»; «Показать ещё» — как в 3.3;
  - даты всегда с годом (`now = null`): SSR = первый рендер, без рассинхрона гидрации;
  - `DetailHeader fallback="/"`, `DocumentTitle` — нейтральный «Профиль райдера — Покатим»
    (имени нет ни в истории браузера, ни во вкладке);
  - pull-to-refresh: `[rider.refetch, races.refetch]`.
- Публичный экран доступен и вошедшему (свой `publicId` — через «Как вас видят другие»). Своей подсветки нет.

### 3.5 `/settings/profile` → «Редактировать профиль» (AC14)

- Заголовок и `DocumentTitle`: новый ключ `profile.edit.title` «Редактировать профиль». `profile.title` «Профиль»
  остаётся за `/profile`.
- `settings/index.tsx` `ACCOUNT_ROWS`: строка «Профиль» → `href: '/profile'`. Редактирование — с экрана профиля,
  хаб ведёт в сам профиль. Альтернатива — оставить `/settings/profile` (раздел 9, D-B3).
- Убрать `<ProfileSeasonBlock />` (переехал в `/profile`). Ссылки «Анкета зачёта», «Уведомления», «Удалить аккаунт»
  — **оставить** как есть: правило `pokatim-app.md` «Анкета `settings/verified` (ссылка из „Профиля“)»,
  `profile-screen.test` AC8. Минимальный дифф.
- Порядок: «Фото» (`AvatarEditor`, вне `ProfileFormView` — у фото своя мутация) → форма: имя → **клуб** → согласие →
  «Сохранить».
- `profile-form.tsx`:
  - схема `z.object({ publicName: RiderPublicName, club: RiderClub, showNameInResults: z.boolean() })`;
  - `FIELDS` + `'club'`, `valuesOf` + `club: profile.club ?? ''`;
  - поле `TextField` «Клуб», подсказка «Например, Velo Club Minsk. Видно в публичном профиле вместе с именем»;
  - ошибки — `fieldText(code)` с `{ min }` для `TOO_SHORT` клуба: передать `min` из контракта. Сейчас `fieldText`
    подставляет `RIDER_PUBLIC_NAME_MIN` всем полям — сделать параметром.
- `useUpdateProfile.onSuccess`: + `invalidateQueries({ queryKey: ['riders'] })` (публичный профиль: имя, клуб).

## 4. Фото: выбор, обрезка, загрузка (AC14)

### 4.1 Общий контракт развилки

`pick-avatar(.web).ts` и `avatar-editor(.web).tsx` (импорт без расширения):

```ts
// features/profile/picked-avatar.ts
export interface PickedAvatar { body: Blob; crop?: { x: number; y: number; size: number } }
export class AvatarPickerUnavailableError extends Error {} // старый dev-клиент без модуля
```

### 4.2 Native — `pick-avatar.ts`

- `image-picker-support.ts`: `imagePickerSupported = () => requireOptionalNativeModule('ExponentImagePicker') !==
  null` (импорт из `expo`, реэкспорт `expo-modules-core`). Модули Expo — не TurboModule:
  `TurboModuleRegistry.get`, как в `map-support.ts`, их не видит. Имя модуля сверить по исходнику установленного
  `expo-image-picker`. `.web.ts` → `true`.
- `load-image-picker.ts`: `export const loadImagePicker = () => import('expo-image-picker')` — точка подмены в jest.
- `pickAvatar()`:
  1. `!imagePickerSupported()` → `throw new AvatarPickerUnavailableError()` → текст «Чтобы выбрать фото, обновите
     приложение»;
  2. `launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9, exif:
     false, base64: false })`;
  3. `canceled` → `null`;
  4. `asset.fileSize > AVATAR_MAX_BYTES` → ошибка до отправки (тот же текст, что 413);
  5. `body = await (await fetch(asset.uri)).blob()` (как `trackFileBody`), `crop` нет: системная обрезка уже
     квадратная, сервер берёт центр.
- Разрешения: PHPicker (iOS 14+) и Android Photo Picker фото без разрешения отдают. Камеры нет.
- `app.json` `plugins`: `["expo-image-picker", { "photosPermission": "Покатим открывает выбранное вами фото, чтобы
  поставить его на аватар профиля. Фото обрезается и сохраняется без геометок.", "cameraPermission": false,
  "microphonePermission": false }]`. Ключи плагина сверить через context7 (`/expo/expo`, «image-picker config
  plugin»).
- Зависимость: `pnpm --filter @pokatim/app exec expo install expo-image-picker` → `"expo-image-picker": "~58.0.10"`.
  Проверено `npm view`: `latest` = `58.0.10` от 2026-10-01, старше `minimumReleaseAge`. Нужна новая сборка
  dev-клиента и EAS. В pr.md: «старый dev-клиент — „Обновите приложение“, NOT VERIFIED на устройстве».
- **Риск формата (RN-1):** iOS при `quality < 1` или с редактированием отдаёт JPEG, HEIC быть не должно. Android
  (uCrop) — JPEG. HEIC сервер отклонит 415, текст понятный. Проверить на устройстве, в pr.md — NOT VERIFIED.
- `AvatarEditor` (native): `RiderAvatar` 56, «Выбрать фото» (`Button secondary`, `loading` на время выбора и
  загрузки), «Удалить фото» (`TextAction destructive`, только при `avatar !== null`) → инлайн-подтверждение «Удалить
  фото? Его больше не увидят в профиле.» — «Удалить» / «Оставить». Ошибка — `Banner tone="error"` под кнопками.

### 4.3 Загрузка — без XHR и прогресса

- `useUploadAvatar()`:
  - `mutationFn: ({ body, crop }) => withAccessToken((token) => api.uploadAvatar(token, body, crop))`;
  - `networkMode: 'always'`;
  - `onSuccess(view)`: `setQueryData(PROFILE_QUERY_KEY, view)` + `invalidateQueries({ queryKey: ['riders'] })`.
- Почему не `sendFile`/`avatarUploadRequest`:
  - прогресс не нужен (≤ 10 МиБ, обычно сотни КБ);
  - `withAccessToken` повторит запрос после 401 с тем же `Blob`;
  - `sendFile` знает только `method: 'POST'` (`UploadRequest`), расширять его ради PUT незачем;
  - кнопка `disabled`/`loading` на время запроса (§4.12).
- `useDeleteAvatar()` — `api.deleteAvatar(token)`, тот же `onSuccess`.
- **Инвалидации — с `exact` там, где это важно.** `['profile']` — префикс и для `['profile','verified']`,
  `['profile','stats']`, `['profile','races',…]`. Поэтому ответ мутации — только `setQueryData(['profile'])`, без
  `invalidateQueries(['profile'])`. Иначе после смены фото перезапросятся анкета, статистика и история.
- `avatar-errors.ts` → `avatarErrorMessage(error)`:
  - `AVATAR_FORMAT_UNSUPPORTED` (415) → «Выберите фото в формате JPEG, PNG или WebP»;
  - `AVATAR_TOO_LARGE` (413) → «Фото больше 10 МБ — выберите фото поменьше»;
  - `AVATAR_INVALID` (422) → «Не удалось обработать фото — выберите другое»;
  - `RATE_LIMITED` (429) с `retryAfterSec` → «Слишком много загрузок фото. Повторите через {time}» (`formatCountdown`;
    у занятого слота `retryAfterSec: 5` — «через 5 с»);
  - `AvatarPickerUnavailableError` → «Чтобы выбрать фото, обновите приложение»;
  - прочее → `actionErrorMessage` (сеть, сбой).

### 4.4 Web — `pick-avatar.web.ts` + `avatar-crop.web.tsx`

- Выбор: `expo-document-picker` (уже зависимость, web-вариант `pick-track-file.web.ts`): `type: ['image/jpeg',
  'image/png', 'image/webp']`, `base64: false` → `asset.file` (`File`). Не `expo-image-picker` web: он отдаёт data
  URI (base64 в памяти), а нам нужен `File`. Пре-чек до обрезки:
  - MIME не из списка (HEIC с iPhone в Safari) → текст 415;
  - `size > AVATAR_MAX_BYTES` → текст 413.
  `pickAvatar()` на web возвращает только файл. Обрезку делает `AvatarEditor.web`.
- `avatar-editor.web.tsx`: после выбора — **инлайн-панель обрезки на месте блока «Фото»**, не модалка (как
  подтверждения; работает и в SSR-разметке, без порталов), «Сохранить фото» / «Отмена».
- `avatar-crop.web.tsx` (`AvatarCrop({ file, onConfirm(crop), onCancel })`):
  - `URL.createObjectURL(file)` — в эффекте, `revokeObjectURL` при размонтировании;
  - `<img>` внутри квадратного окна: `width: '100%'`, `aspectRatio: 1`, `maxWidth: size.heroHeight`, `overflow:
    hidden`, рамка `stroke.indicator` `border.strong`, `touch-action: none`;
  - размеры — `naturalWidth/naturalHeight` после `onLoad`. Браузеры (Chrome 81+, Safari 13.1+, Firefox 77+) по
    умолчанию применяют EXIF-ориентацию (`image-orientation: from-image`), и `natural*` — уже ориентированные
    размеры. Сервер `autoOrient()` режет в той же системе координат, поэтому доли совпадают;
  - перетаскивание — pointer events (`onPointerDown` + `setPointerCapture`, `onPointerMove`, `onPointerUp`), сдвиг в
    пикселях окна → в пиксели изображения через масштаб;
  - масштаб: кнопки «−»/«+» (`Icon zoomOut/zoomIn`, `accessibilityLabel` «Уменьшить»/«Увеличить», `disabled` на
    пределах, минимум `size.touchMin`); колесо **не** использовать (прокрутка страницы, как правило карт);
  - клавиатура на окне (`tabIndex=0`, `role="group"` + `aria-label` «Область фото. Стрелки — сдвиг, плюс и минус —
    масштаб», `aria-describedby` на подсказку): стрелки — сдвиг на шаг (Shift — крупный), `+`/`=` и `-` — масштаб,
    `preventDefault` только для них; `:focus-visible` — рамка `border.strong`;
  - `prefers-reduced-motion` — без переходов (переходов и нет: положение задаётся напрямую).
- `avatar-crop-math.ts` — чистые функции (unit, без DOM):
  - `initialCrop(w, h)` — центральный квадрат `min(w,h)`, масштаб 1;
  - `maxScale(w, h) = min(w, h) / AVATAR_MIN_CROP_PX` (с потолком `MAX_ZOOM = 4`): сервер не ответит 422 из-за
    мелкой обрезки;
  - `zoom(state, factor)` — вокруг центра окна с клэмпом; `pan(state, dx, dy)` — клэмп к рамкам изображения;
  - `toCropQuery(state, w, h) → { x: left/w, y: top/h, size: side/min(w,h) }` — значения в `[0,1]`, `size > 0`.
    Формула совпадает с серверной `cropRect` (task 11.3), сервер дополнительно клэмпит;
  - `min(w,h) < AVATAR_MIN_CROP_PX` → сразу ошибка «Фото слишком маленькое — нужно хотя бы 64 × 64 пикселя», без
    отправки.
- Чем не ограничиваем: не перекодируем на клиенте (canvas). Исходник уходит как есть, EXIF/GPS стирает сервер
  (серверный авторитет, task 8.3). Это прямо сказать в подсказке под фото: «Мы уберём из фото геометки и данные
  камеры».

## 5. `RiderAvatar` и токены (AC16)

- `components/rider-avatar.tsx`: `RiderAvatar({ avatarId, dimension, label, background? })`:
  - рамка — как у базового `Avatar`: `borderWidth: stroke.hairline`, `borderColor: text.primary`, `overflow:
    hidden`, без скругления (квадрат; не `shapeOf`: аватар квадратный во всех темах прототипа);
  - фото: `Image` из `expo-image`, `source={{ uri: api.avatarUrl(avatarId) }}`, `contentFit="cover"`,
    `cachePolicy="memory-disk"` (URL `immutable`, новый id при замене), `transition` нет,
    `accessibilityIgnoresInvertColors`;
  - `onError` → состояние «пусто» (удалённый аватар → 404, сеть);
  - пусто (`avatarId === null` или ошибка): фон `surface.raised`, `Icon name="person" filled` цвета
    `text.secondary`, размер иконки — `size.icon` по центру во всех размерах, как в `GoingStack` (прототип размер не
    задаёт; своих множителей и px нет);
  - a11y: обёртка `accessible`, `accessibilityRole="image"`, `accessibilityLabel` — «Фото профиля» или «Фото не
    выбрано». В `TopBar` кнопка сама несёт метку «Профиль», аватар внутри — `accessible={false}`.
- Размеры: 30 — `size.avatarTopBar`, 32 — `size.avatar` (есть). **56 — токена нет.** Расширить бренд:
  `packages/design-tokens/src/index.ts` `layout` → `{ contentMaxWidth: 640, avatarProfile: 56 }` с комментарием
  «`.phead-name .ava` прототипа; в базе нет — follow-up `size.avatarLg` в app-foundation». Тест —
  `packages/design-tokens/src/design-tokens.test.ts`. `layout` уже служит местом «раскладки приложения, которой нет в
  базе», это прецедент. Альтернатива — сначала релиз базы (дольше, раздел 9 D-B4).
- `expo-image` уже в `dependencies` (`~58.0.0`, установлен 58.0.16), но в коде не используется. В jest:
  `jest-expo` его не мокает целиком; при падении рендера — мок `expo-image` → `Image` из RN в `jest.setup.ts`.
  Web/SSR: `expo-image` на web рисует `<img>`, SSR-безопасен (проверить шагом e2e с API).

## 6. Шапка `.phead` / `.prule` (R-1, нет макета)

- Прототип (`pokatim-private/proto/key-*.html`, CSS):
  - `.phead{height:var(--hero-height);background:var(--surface)}` + контур SVG;
  - `.phead-name{bottom:16px}`;
  - `.ava` 56 на `--bg` с `margin-bottom:10px`;
  - `.prule{margin:0 gutter;padding:8px 0;border-top:1px ink;border-bottom:1px border;13/18 ink-2}`;
  - `.prule.empty{min-height:0;padding:0}`.
- Разметки экрана в прототипах нет, только CSS (R-1). Контура «Личной линии» в данных нет: личной линии
  (агрегированного трека) нет, рисовать нечего. Рекомендация (раздел 9, D-B1): высота шапки **по содержимому**,
  без `size.heroHeight`. Пустые 300 px без контура — та самая «заглушка», которую запрещает правило. Раскладка:
  - поверхность `surface.raised`, отступы `size.gutter` / `space.s4`;
  - аватар `layout.avatarProfile` на `surface.default`, отступ снизу `space.s3`;
  - имя `displayTitle`;
  - `.prule` — `marginHorizontal: size.gutter`, `paddingVertical: space.s2`, `borderTopWidth: stroke.hairline`
    `text.primary`, `borderBottomWidth: stroke.hairline` `border.subtle`, `textStyle('meta')` `text.secondary`;
    пусто — `paddingVertical: 0`.
- Темы: роли и `useTheme()`, без сравнения с id темы. Разные варианты шапки у тем — не в этой задаче.

## 7. i18n (`packages/i18n/src/ru.ts`), формальное «вы»

Новые ключи (тест полноты i18n — `packages/i18n/src/index.test.ts`):

- `profile.edit.title` «Редактировать профиль»; `profile.edit` (ссылка) «Редактировать профиль»;
  `profile.noName` «Имя не указано»; `profile.publicLink` «Как вас видят другие»; `profile.publicHint` «Другие
  увидят профиль, когда вы укажете имя и включите показ в результатах»;
- `profile.club.label` «Клуб»; `profile.club.hint` «Например, Velo Club Minsk. Виден в публичном профиле вместе с
  именем»;
- `profile.avatar.title` «Фото»; `.pick` «Выбрать фото»; `.delete` «Удалить фото»; `.deleteTitle` «Удалить фото?»;
  `.deleteBody` «Фото исчезнет из профиля»; `.deleteConfirm` «Удалить»; `.keep` «Оставить»; `.hint` «Мы уберём из
  фото геометки и данные камеры»; `.a11y` «Фото профиля»; `.empty` «Фото не выбрано»;
- `.crop.title` «Выберите область»; `.crop.area` «Область фото. Стрелки — сдвиг, плюс и минус — масштаб»;
  `.crop.zoomIn` «Увеличить»; `.crop.zoomOut` «Уменьшить»; `.crop.save` «Сохранить фото»; `.crop.cancel` «Отмена»;
- ошибки: `profile.avatar.error.AVATAR_FORMAT_UNSUPPORTED`, `.AVATAR_TOO_LARGE`, `.AVATAR_INVALID`, `.tooSmall`,
  `.rateLimited` («…повторите через {time}»), `.updateApp` «Чтобы выбрать фото, обновите приложение»;
- `profile.stats.activities` «Заезды», `.distance` «Дистанция», `.elevation` «Набор», `.races` «В зачёте»,
  `.podiums` «Подиумы», `.bestPlace` «Лучшее место», `.bestPlaces` «Лучшие места», `.none` «—»;
- `profile.history.title` «История»; `.races` «Гонки»; `.rides` «Райды»; `.more` «Показать ещё»; `.racesEmpty`
  «Вы ещё не участвовали в гонках»; `.ridesEmpty` «Прошедших райдов пока нет»; `.allRaces` «Все гонки»;
  `.allRides` «Все райды»; `.role.organizer` «Организатор»; `.role.participant` «Участник»; `.raceA11y`,
  `.rideA11y`;
- `riders.title` «Профиль райдера»; `riders.notFound` «Профиль недоступен»; `riders.notFoundBody` «Райдер скрыл
  профиль или ссылка устарела»; `riders.home` «На главную»; `riders.racesEmpty` «Пока нет опубликованных
  результатов»; `riders.races` «Гонки».
- Тексты ошибок API: сервер отдаёт свои `message` (`error-messages.ts` PR A), приложение — свои ключи по `code`.

## 8. Тест-матрица

| AC | Тест | Файл |
|---|---|---|
| 12 | `TopBar`: аватар последним, метка «Профиль», нажатие; без `onOpenProfile` кнопки нет; фото/пусто | `apps/app/src/components/top-bar.test.tsx` |
| 12 | `RiderAvatar`: `avatarId` → `expo-image` с `api.avatarUrl`; `null` и `onError` → иконка человека; a11y | `apps/app/src/components/rider-avatar.test.tsx` |
| 12 | Главная: аватар из кэша `['profile']` (без второго запроса `getProfile`), нажатие → `/profile` | `apps/app/src/__tests__/home.test.tsx` |
| 12–13 | `/profile`: скелетон шапки и статистики; «Нет соединения» / «Не удалось загрузить» с повтором; «Имя не указано»; клуб в линии; «Как вас видят другие» / подсказка; статистика; «Сезон» на месте; «Гонки»: скелетон, пусто, строки (место «=6», плашка, время), «Показать ещё», нажатие → `/races/<id>`; «Райды» — запрос только после переключения, → `/rides/<id>`; ошибка догрузки — баннер | `apps/app/src/__tests__/own-profile.test.tsx` (новый) |
| 12 | Блок «Сезон» — теперь на `/profile` (перенос существующих кейсов) | `apps/app/src/__tests__/profile-season-block.test.tsx` |
| 12 | гард: гость на `/profile` → «Регистрация»/«Вход»; пока сессия неизвестна — скелетон оболочки | `apps/app/src/__tests__/auth-guard.test.tsx` (кейс) |
| 14 | «Редактировать профиль»: заголовок; клуб (2–60, ошибки сервера под полем, `null` при пустом); выбор фото native (мок `loadImagePicker`, `imagePickerSupported`): отмена — без запроса, успех — `uploadAvatar` без `crop`, кэш `['profile']` обновлён; старый клиент — «Обновите приложение»; удаление с подтверждением; 413/415/422/429 — тексты | `apps/app/src/__tests__/profile-screen.test.tsx` |
| 14 | математика обрезки: центр, клэмп, зум к пределу 64 px, доли = серверная формула, мелкое фото | `apps/app/src/features/profile/avatar-crop-math.test.ts` |
| 14 | web: обрезка — роль и метка, стрелки/`+`/`-`, pointer drag, кнопки на пределах `disabled`, `onConfirm` с долями; `revokeObjectURL` | `apps/app/src/features/profile/avatar-crop.web.test.tsx` |
| 14 | web: `pickAvatar` — фильтр MIME, пре-чек 10 МиБ и HEIC; native: опции `launchImageLibraryAsync`, отмена, размер | `features/profile/pick-avatar.web.test.ts`, `features/profile/pick-avatar.test.ts` |
| 14 | тексты ошибок по коду и `retryAfterSec` | `apps/app/src/features/profile/avatar-errors.test.ts` |
| 15 | `/riders/[id]`: невалидный id — «Профиль недоступен» без запроса; 404; посев `seed` без запроса; гонки только после профиля; «Показать ещё»; нет `userId`/км в разметке | `apps/app/src/__tests__/rider-profile.test.tsx` (новый) |
| 15 | `generateMetadata`: всегда нейтрально + `noindex`, без `og:url`, без имени при `found` | `apps/app/src/__tests__/public-metadata.test.ts` (кейс) |
| 15 | `publicPath` со схемой токена | `apps/app/src/lib/public-ssr.test.ts` |
| — | неизвестный адрес — новый путь вместо `/profile` | `apps/app/src/__tests__/not-found.test.tsx` |
| — | хаб «Настроек»: «Профиль» → `/profile` | `apps/app/src/__tests__/settings-screen.test.tsx` |
| 16 | `layout.avatarProfile` | `packages/design-tokens/src/design-tokens.test.ts` |
| 15–16 | e2e (ниже) | `apps/app/e2e/web.spec.ts`, `apps/app/e2e/project.ts` |

**e2e (`e2e/web.spec.ts`, `e2e/project.ts`):**

1. `project.ts`:
   - `UNKNOWN_RIDER_ID` — 43 символа `[A-Za-z0-9_-]` (например `'unknownRider' + '0'.repeat(31)`);
   - в `expectedResourceErrors`: `{ url: \`${API_URL}/v1/riders/${UNKNOWN_RIDER_ID}\`, status: 404 }` (запрос
     гонок после 404 не уходит);
   - `NOT_FOUND_PATHS`: `'/profile'` → `'/no-such-page'`.
2. Шаг «публичный профиль неизвестного райдера»: HTML 200, `og:title` «Профиль райдера», `robots noindex`
   **всегда**, нет `og:url`. После гидрации с API — «Профиль недоступен» и «На главную», без API — «Нет
   соединения». URL не меняется (вне гардов).
3. Шаг «`/profile` без сессии»: HTML без данных профиля и без OG; после гидрации — гард (как `rides/route-pick`).
4. С API (внутри сценария регистрации или фикстурой входа): `PATCH /v1/profile { publicName, showNameInResults:
   true, club }` → `publicId` → гость открывает `/riders/<publicId>`. Имя видно на странице, но **не** в
   `<title>`/`og:*`. Загрузка фото в e2e не обязательна (покрыта int PR A и jest).

`pnpm check` + `pnpm --filter @pokatim/app test` + `pnpm e2e:web` (с `E2E_API=1` локально). Ручная проверка
iOS/Android (системная обрезка, старый dev-клиент) — в pr.md `NOT VERIFIED`, если не делалась.

## 9. Requirements Consistency (решения для человека; coder — по рекомендации)

- **D-B1. Высота шапки `.phead` = `--hero-height` (300) с контуром vs данных для контура нет.**
  - (a) **по содержимому**, без контура — рекомендация;
  - (b) `size.heroHeight` пустой поверхностью — визуально «заглушка» на пол-экрана;
  - (c) контур последнего заезда (`activity_tracks`) — нового API нет, вне scope.
- **D-B2. Мета публичного профиля.** Бриф: «noindex, без ПДн в мета».
  - (a) **всегда нейтральная**, без `og:url`, `DocumentTitle` тоже нейтральный — рекомендация;
  - (b) имя в `<title>` при согласии — удобнее превью, но превью мессенджеров переживают отзыв согласия.
- **D-B3. Куда ведёт строка «Профиль» хаба «Настроек».**
  - (a) **`/profile`** — рекомендация (единая точка, редактирование — оттуда);
  - (b) оставить `/settings/profile` с подписью «Редактировать профиль».
- **D-B4. Токен 56 px.**
  - (a) **`layout.avatarProfile` в `@pokatim/design-tokens`** + follow-up `size.avatarLg` в базе — рекомендация;
  - (b) сначала релиз app-foundation (дольше, блокирует PR B).
- **Прочее (без решения):**
  - «Поделиться профилем» в scope нет (5.1 упоминает `share-link`, AC — нет) — не добавляем, follow-up;
  - аватары в строках таблиц — out of scope (раздел 4 task);
  - на web свежее фото/клуб в «Как вас видят другие» видно не позже чем через 60 с (HTTP-кэш `max-age=60`, R-4) —
    принято, без обхода кэша.
- **Без находок:** серверный авторитет (клиент шлёт файл и намерение обрезки, статусы, места и права — с сервера);
  контракты — только чтение схем PR A; старый API без новых полей → дефолты `ProfileView` (аватара и ссылки нет),
  `stats`/история на старом API → 404 → «Не удалось загрузить» в блоке (деплой API раньше приложения).

## 10. Security (чек-лист нужен: да — загрузка файлов, публичная ссылка, ПДн; дополняет task 8.3)

- AuthN/AuthZ: `/profile` и «Редактировать профиль» — под гардом; запросы своих данных — только `withAccessToken`.
  `/riders/[id]` — публичный, сервер решает 404.
- Входные данные: пре-чек размера и типа на клиенте — UX; авторитет — сервер (сигнатура, лимиты). Доли обрезки —
  намерение.
- Данные наружу: имя/клуб не в мета, не в `DocumentTitle`, не в URL; `publicId` — только в пути. В `console.*` — ни
  имени, ни клуба, ни URL фото, ни байтов. Аватар — URL без токена (`immutable`). Дисковый кэш `expo-image` при выходе
  `queryClient.clear()` не чистит: на общем устройстве фото прежнего аккаунта остаётся в кэше приложения.
  Принято (фото публично по ссылке и так, R-4); при желании — `Image.clearDiskCache()` в `useSignOut`, follow-up.
- Злоупотребления: кнопка `disabled` на время запроса; 429 — понятный текст с временем.
- Секреты: нет.

## 11. Риски и параллельные сессии

- **RN-1** формат native-фото (HEIC) — п. 4.2, проверка на устройстве.
- **RN-2** старые dev-клиенты без `ExponentImagePicker` — «Обновите приложение»; нужна пересборка dev-клиента и EAS.
- **RN-3** `naturalWidth` и EXIF в старых браузерах (до 2020) — обрезка может «съехать». Принято: сервер клэмпит,
  результат — квадрат из фото.
- **Не трогать (параллельные сессии):**
  - экраны результатов гонки, `features/races/*` (только импорт форматтеров и `results-table` helpers),
    `features/standings/*` (только импорт `ProfileSeasonBlock`, `placeView`, `useStandingsRefetch`);
  - модуль `routes` и `features/routes/*` (только чтение образцов);
  - `apps/api`, `packages/contracts`, `packages/api-client` (PR A).
  Если сессия «результаты» переименует `TabFailure`/`MoreAction`/`RowsSkeleton` — копий не делать: при конфликте
  перенести их в `src/components/` отдельным коммитом после её слияния.
- Конфликтные точки (малые правки): `src/app/_layout.tsx`, `src/__tests__/app-routes.ts`, `(tabs)/index.tsx`,
  `e2e/project.ts`, `e2e/web.spec.ts`, `packages/i18n/src/ru.ts`, `app.json`, `apps/app/package.json`,
  `pnpm-lock.yaml`. Перед PR — `git fetch` и ребейз на `develop`.

## 12. Implementation Context (для coder)

- **ENTRY POINTS:** `apps/app/src/app/profile.tsx` (новый), `apps/app/src/app/riders/[id].tsx` (новый),
  `apps/app/src/app/settings/profile.tsx`, `apps/app/src/app/_layout.tsx`, `apps/app/src/app/(tabs)/index.tsx`.
- **FILES TO MODIFY:**
  - `apps/app/src/components/top-bar.tsx`, `apps/app/src/app/settings/index.tsx`;
  - `apps/app/src/features/profile/{queries.ts,profile-form.tsx}`, `apps/app/src/lib/public-ssr.ts`;
  - `apps/app/src/__tests__/{app-routes.ts,not-found.test.tsx,profile-screen.test.tsx,profile-season-block.test.tsx,
    settings-screen.test.tsx,home.test.tsx,public-metadata.test.ts}`;
  - `apps/app/src/components/top-bar.test.tsx`, `apps/app/src/lib/public-ssr.test.ts`, `apps/app/jest.setup.ts`
    (моки `expo-image-picker`, при необходимости `expo-image`);
  - `apps/app/app.json`, `apps/app/package.json`, `pnpm-lock.yaml`;
  - `apps/app/e2e/{project.ts,web.spec.ts}`;
  - `packages/i18n/src/ru.ts`;
  - `packages/design-tokens/src/{index.ts,design-tokens.test.ts}`.
- **FILES TO CREATE:**
  - `apps/app/src/components/rider-avatar.tsx` (+ тест);
  - `apps/app/src/features/profile/{own-profile-screen,profile-head,profile-stats,profile-history,history-rows,
    avatar-editor,avatar-editor.web,avatar-crop.web}.tsx`;
  - `apps/app/src/features/profile/{profile-format,picked-avatar,pick-avatar,pick-avatar.web,image-picker-support,
    image-picker-support.web,load-image-picker,avatar-crop-math,avatar-errors}.ts` (+ тесты);
  - `apps/app/src/features/riders/{rider-screen.tsx,queries.ts}`;
  - `apps/app/src/__tests__/{own-profile,rider-profile}.test.tsx`.
- **FILES TO READ:** `features/routes/route-detail.tsx` (`RouteRaces`, 404, pull-to-refresh),
  `features/routes/queries.ts`, `app/rides/[id].tsx`, `lib/public-ssr.ts`, `lib/page-metadata.ts`,
  `features/standings/profile-season-block.tsx`, `features/races/results-table.tsx` (helpers),
  `features/races/participation-format.ts`, `features/standings/standings-format.ts`,
  `features/devices/{pick-track-file.web.ts,upload-track.ts,error-messages.ts}`, `features/maps/map-support.ts`,
  `features/routes/my-route-detail.tsx` (инлайн-подтверждение), `features/maps/map-controls.tsx` (кнопки зума),
  `components/{going-stack,stat-block,detail-header}.tsx`, `e2e/web.spec.ts` (шаги `rides/[id]`, `route-pick`).
- **TYPES & SCHEMAS (PR A):** `ProfileView`, `UpdateProfileRequest`, `RiderClub`, `RiderPublicId`, `AvatarId`,
  `AVATAR_MAX_BYTES`, `AVATAR_MIN_CROP_PX`, `AvatarCropQuery`, `RiderStats`, `RiderRaceHistoryPage`,
  `RiderRideHistoryPage`, `PublicRiderProfile`, `PublicRiderRacePage`, `ErrorCode`.
- **OUT OF SCOPE:** достижения; аватары и ссылки в таблицах результатов и рейтинга, шит соперника; «Поделиться
  профилем»; модерация; камера; перекодирование на клиенте; изменения `apps/api`, `contracts`, `api-client`.

## 13. Documentation Impact (PR B)

- `.claude/rules/pokatim-app.md` — новый раздел «Профиль райдера (rider-profile)»:
  - маршруты `/profile` (под гардом, `useSettingsShell`, вход — аватар `TopBar` Главной) и `/riders/[id]` (вне
    гардов, SSR, мета всегда нейтральная + `noindex`, без `og:url`);
  - ключи `['profile','stats' | 'races' | 'rides', …]`, `['riders','detail' | 'races', id, …]`; мутации фото —
    `setQueryData(['profile'])` без префиксной инвалидации + `invalidateQueries(['riders'])`;
  - аватар — только `RiderAvatar` (`expo-image`, пусто — иконка человека); выбор фото — развилка `pick-avatar(.web)`,
    `expo-image-picker` лениво после `imagePickerSupported()` (`requireOptionalNativeModule`), web —
    `expo-document-picker` + `avatar-crop.web.tsx` (доли `x, y, size` в ориентированном изображении);
  - загрузка — `api.uploadAvatar` в `withAccessToken`, без XHR.
  - Правка строки «SSR-данные…»: `publicPath` — `Uuid` или схема токена из contracts. Строка «Анкета
    `settings/verified` (ссылка из „Профиля“)» → «из „Редактировать профиль“». Блок «Сезон» «Профиля» — теперь
    `/profile`.
- `docs/product/profile.md` «Где в продукте»: `/profile` (аватар верхней панели), «Редактировать профиль»
  `/settings/profile` (фото, имя, клуб, согласие), публичный `/riders/<id>`. Решения D-B1…D-B4 — в отчёт/раздел
  решений.
- `docs/product/home.md`: строка «Аватар „Личная линия“ | профиль» — реализовано (rider-profile).
- Follow-up в app-foundation: `Avatar` базы — плейсхолдер-иконка и подмена компонента картинки (`expo-image`),
  `size.avatarLg = 56`; после релиза — перевести `RiderAvatar`/`GoingStack` на базу.
