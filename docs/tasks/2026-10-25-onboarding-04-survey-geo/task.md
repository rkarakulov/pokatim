# 1. Title

Онбординг, слайс 4: обязательный опрос «Что вас привело?» и pre-permission геопозиции (+ первый авторизованный
эндпоинт: AuthGuard и авто-refresh access)

# 2. Goal

Райдер «Покатим» (`docs/product/brand.md`) после первого входа в аккаунт (подтверждение e-mail с автовходом V-09, вход
по паролю) на любой платформе (iOS, Android, web/PWA) сначала отвечает на короткий обязательный опрос «Что вас
привело?» — ответ сохраняется на сервере в профиле, — затем видит экран-объяснение геопозиции «Разрешить» / «Не
сейчас». «Разрешить» вызывает системный запрос разрешения (native — `expo-location`, web — Geolocation API); любой
исход (разрешено, отказано, «Не сейчас») ведёт на Главную и приложение не блокирует. Экран геопозиции на этом
устройстве больше не показывается автоматически.

Опрос — первый эндпоинт, требующий входа. Вместе с ним закрываются хвосты слайсов 2–3:

- слайс 1, Out of Scope: «Опрос и геопозиция — слайс 4 (после подтверждения — сразу Главная)»; §8.2 слайса 1: «E-mail
  подтверждён» без «Дальше — короткий опрос»;
- слайс 2, Out of Scope: «Авторизация эндпоинтов по access JWT (AuthGuard), авто-refresh access по 401, обновление
  сессии при возврате приложения из фона — с первым авторизованным эндпоинтом»;
- слайс 3, §8 «Access после сброса» и follow-up «проверка `sid` access с первым AuthGuard».

Источники: `AGENTS.md` §1 (рамки MVP), §4; `.claude/rules/pokatim-app.md` («Геолокация — только foreground для
«рядом», после pre-permission экрана («Не сейчас»), при отказе — баннер со ссылкой в настройки ОС»); ADR-0003,
ADR-0005, ADR-0007; прототип `key-onboarding` упомянут в слайсе 1 (кадр Verified: «Дальше — короткий опрос»), но
**в репозитории его нет** (`docs/product/prototypes.md` отсутствует). Варианты ответа, тексты и раскладка экранов —
`[ASSUMPTION]`, вынесены автору (§8.1, Q1–Q9).

# 3. Scope

**Contracts / api-client** (`packages/contracts/src/profile/onboarding.schema.ts` — новый; `packages/api-client`)
- `RideReason` — enum кодов ответа (`[ASSUMPTION]`, Q1): `races`, `group_rides`, `routes`, `calendar`, `exploring`.
  Значения только добавляются в конец, не удаляются (§8.1 R7).
- `SubmitOnboardingSurveyRequest { reasons: RideReason[] }` — мультивыбор, 1…N, без повторов (Q2);
  `z.strictObject`.
- `OnboardingStatus { surveyCompleted: boolean }` — ответ GET и PUT; сами ответы опроса наружу не отдаются.
- Клиент: `getOnboardingStatus(accessToken)`, `submitOnboardingSurvey(accessToken, body)` — access передаётся явно
  заголовком `Authorization: Bearer` только в эти вызовы (§8.1 R2). Новых кодов ошибок нет: `UNAUTHORIZED`,
  `VALIDATION_FAILED` — базовые.

**API — модуль `identity`: авторизация запросов (первая)**
- `AccessTokenVerifier` — проверка access JWT (HS256 только, `iss`/`aud` проекта, `exp` по `CLOCK`, обязательные `sub`
  и `sid` — UUID после zod).
- `AuthGuard` — `Authorization: Bearer <jwt>` → проверка JWT → сессия `sid` принадлежит `sub`, не отозвана и не
  истекла, пользователь не удалён (два чтения по `_id`, §8.1 R1). Любой отказ — один и тот же `401 UNAUTHORIZED`.
  Результат — `AuthUser { userId, sessionId }` в запросе; декоратор `@CurrentUser()`.
- Экспорт через `modules/identity/index.ts`: `AuthGuard`, `CurrentUser`, `type AuthUser`.

**API — новый модуль `profile`**
- Коллекция `profiles` (`_id` = id пользователя): `rideReasons`, `surveyCompletedAt`, `updatedAt`. Миграция
  `0004_profile` — создание коллекции (индексов сверх `_id` нет).
- `GET /v1/profile/onboarding` → `OnboardingStatus` (`surveyCompleted = есть документ с ответом`).
- `PUT /v1/profile/onboarding/survey` → upsert одного документа (идемпотентно: повтор после потерянного ответа даёт
  тот же итог; `surveyCompletedAt` — время первого ответа по `CLOCK`, `updatedAt` — последнего) → `OnboardingStatus`.
- Оба — под `AuthGuard`, `Cache-Control: no-store`. Сервер не блокирует остальные эндпоинты без ответа опроса (§8.1
  R8).

**App (`apps/app`, все платформы)**
- **Авторизованные запросы:** `features/auth/authorized.ts` — `withAccessToken(call)`: access истекает в ближайшие
  60 с → refresh заранее; ответ 401 → один refresh и один повтор; refresh 401 → локальный выход (`returning`), гард
  ведёт на «Вход»; сеть/429/5xx refresh — ошибка запроса (экран показывает её с повтором), не выход. Refresh —
  single-flight, под `withSessionLock`; платформенная развилка — `refreshAccess` в
  `session-persistence(.web).ts` (native — ротация refresh из SecureStore, как `revalidateSession`; web — refresh по
  cookie).
- **Состояние онбординга:** `features/onboarding/onboarding-store.ts` (zustand): опрос `unknown | required | completed
  | unavailable`, геопозиция `unknown | pending | done`; гидрация в эффекте после входа; сброс при любом переходе
  сессии в `signedOut`.
  Источник опроса — сервер (`GET`), кеш «опрос пройден» — в `secureStorage` (`pokatim.onboarding`, привязан к сессии:
  стирается при выходе) — офлайн-старт native не блокируется (§8.1 R4). Источник шага геопозиции — локальный флаг
  устройства (`pokatim.locationPrompt`, переживает выход) + текущее разрешение ОС/браузера.
- **Гарды** корневого layout: вкладки — пока сессия или онбординг неизвестны (скелетон оболочки, ошибка — с
  повтором) или онбординг пройден; группа `(setup)` (`/survey`, `/location`) — только с сессией и незавершённым
  шагом; порядок шагов: опрос → геопозиция → Главная.
- **Экран «Что вас привело?»** (`(setup)/survey.tsx`): варианты — `Checkbox` дизайн-системы, «Продолжить» выключена до
  первого выбора, `Button loading` на время запроса, ошибки — баннер с повтором («Нет соединения» / «Не удалось
  сохранить»); успех → шаг геопозиции или Главная.
- **Экран геопозиции** (`(setup)/location.tsx`): объяснение, «Разрешить» → системный запрос → Главная при любом
  исходе; «Не сейчас» → Главная. Показывается, только если разрешение ещё не определено (native — `undetermined`;
  web — `prompt` или Permissions API недоступен) и флага устройства нет; иначе шаг пропускается молча.
- `features/location/location-permission(.web).ts`: `getLocationPermission()` / `requestLocationPermission()` →
  `granted | denied | undetermined | unavailable`. Native — `expo-location` (`getForegroundPermissionsAsync`,
  `requestForegroundPermissionsAsync`); web — `navigator.permissions` + `navigator.geolocation.getCurrentPosition`
  (координаты сразу отбрасываются). Координаты нигде не читаются, не хранятся и не отправляются (Q6).
- Зависимость `expo-location` (~58.0.x, версия старше суток) + config plugin в `app.json`: русская строка
  `NSLocationWhenInUseUsageDescription`, ключи Always/Motion/FullAccuracy — `false`, фоновая геолокация выключена
  (§8.1 R9).
- «E-mail подтверждён» — строка «Дальше — короткий опрос» (Q9).
- Строки — `packages/i18n/src/ru.ts`; UI — `@rkarakulov/ui` + токены; SSR-безопасность экранов (без `window`,
  `navigator`, сторов и `api` в рендере и на уровне модуля).

**E2E / docs** — шаги смоука `e2e/web.spec.ts` (вход → опрос → геопозиция «Не сейчас» → Главная → перезагрузка →
Главная; с выданным разрешением браузера — шаг геопозиции пропущен); ADR-0008, architecture, rules, product, runbook
(§10).

# 4. Out of Scope

- Использование геопозиции: «рядом», карта, получение и отправка координат на сервер, баннер «Геопозиция выключена» со
  ссылкой в настройки ОС — с первой фичей «рядом» (`pokatim-app.md`; AGENTS.md §4.9).
- Фоновая геолокация, запись GPS (рамки MVP, `pokatim-app.md`).
- Редактирование ответов опроса из профиля, экран профиля, персонализация Главной по ответам (персонализация —
  `docs/tasks/2026-10-26-app-02-home/task.md`).
- Аналитика/выгрузка ответов для команды (агрегаты в «Протоколе») — отдельная задача.
- Удаление/анонимизация профиля при удалении аккаунта — в задаче удаления аккаунта (§8 «Удаление аккаунта»).
- `AppState`-обновление сессии при возврате из фона: авто-refresh перед авторизованным запросом его покрывает;
  фоновая ротация по `AppState` — когда понадобится (нет «на вырост»).
- Синхронизация вкладок (BroadcastChannel), мгновенный выход других устройств.
- Изменения app-foundation (кандидаты в базу — §5.1).

# 5. Architecture Context

- **api, identity:** новые `access-token.ts` (`AccessTokenVerifier`), `auth.guard.ts` (`AuthGuard`),
  `current-user.decorator.ts`; `identity.repository.ts` — `findActiveSession(sessionId, userId, now)` (чтение
  `sessions` по `_id` с условиями в фильтре + `users` по `_id`, `deletedAt: null`); `identity.module.ts` — `exports:
  [AuthGuard]` (и его зависимости в providers модуля); `index.ts` — экспорт `AuthGuard`, `CurrentUser`, `AuthUser`.
  Ключ JWT — тот же `JWT_SECRET`, `JWT_ISSUER`/`JWT_AUDIENCE` — из `identity.policy.ts`.
- **api, profile (новый модуль `apps/api/src/modules/profile`):** `profile.collection.ts` (`PROFILE_COLLECTIONS`,
  `ProfileDoc`), `profile.repository.ts` (единственный писатель `profiles`), `onboarding.service.ts`,
  `onboarding.controller.ts` (`@Controller('profile')`, `@UseGuards(AuthGuard)`), `profile.module.ts` (`imports:
  [IdentityModule]`), `index.ts`. `app.module.ts` — `ProfileModule`. Worker не меняется.
- **Миграция `0004_profile`** — `ensureCollection(db, 'profiles')` (функция из `0002_identity`). Expand-only, без
  транзакции, идемпотентна; данных не переносит.
- **Данные:** профиль — отдельная коллекция (ПДн отдельно, `db.md`/`pokatim-db.md`; анонимизация — удалить документ).
  Запись — одна атомарная операция над одним документом (`updateOne({ _id: userId }, …, { upsert: true })`) вне
  транзакции: документы аккаунта identity не меняются, `lockUser` не нужен (R1 касается транзакций, меняющих документы
  аккаунта). Повтор при `isDuplicateKey` гонки двух upsert — один раз (§7).
- **Очереди/outbox:** не нужны — синхронная запись одного документа, событий для других модулей нет.
- **Contracts:** только добавления (новый файл, экспорт). Установленные приложения без опроса продолжают работать —
  сервер опрос не навязывает (R8).
- **App:** `src/app/_layout.tsx` (гарды и `(setup)`), `src/app/(setup)/{_layout,survey,location}.tsx`,
  `(tabs)/_layout.tsx` (скелетон, пока онбординг неизвестен), `features/auth/{authorized,session-persistence(.web),
  session-store,secure-storage,use-sign-out}.ts`, `features/onboarding/*`, `features/location/*`, `app.json`,
  `package.json`, `packages/i18n/src/ru.ts`, `src/__tests__/app-routes.ts`.

# 5.1 Placement & Reuse Gate

- **Переиспользуем:** contracts — `Uuid`, `fieldError`, `FieldErrorCode`, `ErrorCode`; API — `JWT_SECRET` и
  `JWT_ISSUER`/`JWT_AUDIENCE` (`identity.policy.ts`), `jose` (уже зависимость API), `CLOCK`, `domainError`,
  `ZodValidationPipe`, `isDuplicateKey` (`@rkarakulov/api-kit/mongo`), `ensureCollection` (`0002_identity`),
  `@Header('Cache-Control', 'no-store')`; тестовый стенд `createHarness`, `register`/`confirm`/`poll` из
  `apps/api/test/identity.ts`; app — `withSessionLock`, `useSessionStore`, `useSignOut`, `secureStorage`/`readJson`,
  `AuthScreen`/`AuthTitle`/`AuthText`/`AuthActions`, `ShellSkeleton` (с `failure`), `actionErrorMessage`/
  `apiErrorCode` (`features/auth/error-messages.ts`), `DocumentTitle`, `AUTH_MUTATION` (`networkMode: 'always'`),
  компоненты `@rkarakulov/ui` — `Checkbox` (мультивыбор, `accessibilityRole="checkbox"`), `Button` (`loading`),
  `TextAction`, `Banner`, `Kicker`, `AsyncContent`/`Skeleton*`. **Новых компонентов дизайн-системы не нужно.**
- **Запрещённые дубли:** вторая проверка JWT вне `AccessTokenVerifier`; чтение `sessions`/`users` из модуля `profile`
  (только через `AuthGuard` identity); запись `profiles` мимо `ProfileRepository`; второй refresh-механизм в app
  (только `refreshAccess` + `withSessionLock`; без своего `fetch`); глобальный `getAccessToken` в `createApiClient`
  (Bearer ушёл бы во все запросы, включая публичные, и замкнул бы цикл `api` ↔ стор — R2); импорт `expo-location` вне
  `location-permission.ts` (native) — web-бандл его не тянет; `Platform.OS` в экранах; DTO вне contracts; тексты вне
  `@pokatim/i18n`; координаты в сторе/хранилище/запросах.
- **Тонкий контроллер:** pipe контракта, `@CurrentUser()`, `no-store`, вызов `OnboardingService`.
- **Пакеты:** новых нет. Кандидаты в базу app-foundation (follow-up, не в этой задаче): «авторизованный запрос с
  single-flight refresh» в `api-client-core`, `AuthGuard` — вместе с переносом identity в базу (F6); экран
  pre-permission — нет (продуктовый).

# 6. Relevant Files

- `apps/api/src/modules/identity/{session.service,identity.repository,identity.module,identity.policy,identity.collection,index}.ts`.
- `apps/api/src/modules/identity/{session.int.test,identity-races.int.test}.ts`, `apps/api/test/{harness,identity}.ts`.
- `apps/api/src/db/migrations/{0002_identity,0003_identity_ttl,index,migrations.int.test}.ts`, `apps/api/src/app.module.ts`,
  `apps/api/src/http-app.ts` (CORS: заголовок `Authorization` в preflight).
- `packages/contracts/src/{common,index}.ts`, `src/auth/session.schema.ts`; `packages/api-client/src/index.ts`.
- `apps/app/src/app/{_layout.tsx,(tabs)/_layout.tsx,(onboarding)/check-email.tsx,auth/verify/[token].tsx}`.
- `apps/app/src/features/auth/{session-store,session-persistence,session-persistence.web,session-lock,session-lock.web,secure-storage,secure-storage.web,read-json,use-sign-out,queries,error-messages,auth-screen,verification-states}.ts(x)`.
- `apps/app/src/components/shell-skeleton.tsx`, `apps/app/src/lib/{api,api-platform,api-platform.web,query-client}.ts`.
- `apps/app/src/__tests__/{auth-guard,check-email,sign-in,tabs,root-layout}.test.tsx`, `app-routes.ts`, `auth-fixtures.ts`.
- `apps/app/app.json`, `apps/app/package.json`, `apps/app/e2e/{web.spec,project}.ts`, `packages/i18n/src/ru.ts`.

# 7. Implementation Notes

- **Проверка access (`AccessTokenVerifier.verify(token, now)`):** `jwtVerify(token, key, { algorithms: ['HS256'],
  issuer: JWT_ISSUER, audience: JWT_AUDIENCE, currentDate: now, requiredClaims: ['sub', 'sid', 'exp', 'iat'] })`;
  `sub`, `sid` — `Uuid.safeParse` (в фильтр БД — только строки после zod, `db.md`); любая ошибка jose → `undefined`.
  Заголовок: строго `^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`, длина ≤ 2048 — иначе 401 до jose.
- **`AuthGuard.canActivate`:** заголовок → verify → `repository.findActiveSession(sid, sub, now)`:
  `sessions.findOne({ _id: sid, userId: sub, revokedAt: null, expiresAt: { $gt: now } }, { projection: { _id: 1 } })`
  и `users.findOne({ _id: sub, deletedAt: null }, { projection: { _id: 1 } })` → нет — `domainError('UNAUTHORIZED',
  401)`; есть — `request.auth = { userId, sessionId }`. Тело 401 одинаково для всех причин; лог — нет (частые
  истечения access — норма). Гонка «запрос ↔ отзыв сессии» принята: запрос, прошедший проверку до коммита отзыва,
  завершается (одно чтение профиля/запись своего опроса — безвредно).
- **Опрос (`OnboardingService.submit(userId, reasons, now)`):** `profiles.updateOne({ _id: userId }, { $set: {
  rideReasons: reasons, updatedAt: now }, $setOnInsert: { surveyCompletedAt: now } }, { upsert: true })`. `reasons` —
  массив строк enum после zod (не объект запроса). Гонка двух первых upsert: `isDuplicateKey(error, '_id_')` → один
  повтор (`updateOne` без upsert-вставки найдёт документ). Ответ `{ surveyCompleted: true }`. `status(userId)` —
  `findOne({ _id: userId }, { projection: { _id: 1 } })`.
- **Неподтверждённые аккаунты** сессии не получают (AD-28) — профиля у них нет; `deleteUnverifiedBatch` `profiles` не
  трогает (int-тест фиксирует инвариант: у удаляемого очисткой аккаунта нет документа `profiles`).
- **App — `withAccessToken(call)`:** читает `useSessionStore.getState().session`; нет — `UnauthorizedError`
  (гард уже ведёт на вход). `accessTokenExpiresAt - now < 60 с` → `refreshAccess()`. Вызов `call(accessToken)`; 401 →
  `refreshAccess()` → повтор один раз. `refreshAccess`: single-flight промис; native — под `withSessionLock`
  прочитать сохранённую сессию, `rotate` (как `revalidateSession`), `persistSession`, `useSessionStore` получает новую;
  web — под Web Lock `api.refreshSession()` (cookie), `CookieSession` в стор. 401 refresh → `useSessionStore.signOut`-
  подобный локальный выход без запроса отзыва (сессии на сервере уже нет), `returning: true`, `queryClient.clear()`
  через подписку/хук. Сеть/429/5xx — бросить ошибку запроса (не выход).
- **Гидрация онбординга** (эффект в корневом layout при `signedIn`): опрос — флаг `pokatim.onboarding` есть →
  `completed` (сервер не спрашиваем); нет → `withAccessToken(api.getOnboardingStatus)` → `completed` (флаг пишется) /
  `required`; ошибка → `unavailable` (вкладки — «Нет соединения» / «Не удалось загрузить» + «Повторить»). Геопозиция —
  флаг `pokatim.locationPrompt` есть → `done`; нет → `getLocationPermission()`: `undetermined` → `pending`, иначе
  (`granted`/`denied`/`unavailable`) → `done` (флаг не пишем: решение ОС первично). Переход сессии в `signedOut` →
  `reset()` и удаление `pokatim.onboarding`.
- **Хранилище флагов:** `pokatim.onboarding` — `secureStorage` (native SecureStore; web — `sessionStorage` вкладки:
  web всё равно спрашивает сервер при каждой загрузке). `pokatim.locationPrompt` (`{ decision: 'requested' |
  'dismissed', at }`) — устройство: native — SecureStore (другой KV-зависимости в проекте нет; значение не секретное,
  принято), web — `localStorage` (переживает вкладки и перезапуск); развилка — `features/onboarding/device-flags(.web).ts`.
  Сбой хранилища — не падение: шаг геопозиции покажется ещё раз (принято).
- **Web-запрос разрешения:** `getCurrentPosition(() => granted, (e) => …, { maximumAge: Infinity, timeout: 30_000,
  enableHighAccuracy: false })`; координаты не читаются. Итог — `navigator.permissions.query({ name: 'geolocation' })`,
  если доступен; иначе `PERMISSION_DENIED` → `denied`, успех → `granted`, прочее → `undetermined`. Нет
  `navigator.geolocation` или небезопасный контекст → `unavailable` (шаг пропускается). Почему не `expo-location` на
  web: бросает без Permissions API (старые Safari), при таймауте отдаёт `status: granted, granted: false` (§8.1 R10).
- **Гарды** (`_layout.tsx`): `step = онбординг неизвестен | survey | location | done`. Вкладки: `isSessionPending ||
  (signedIn && (step === 'unknown' || step === 'done'))`, `redirectTo` — без сессии как сейчас, с сессией —
  `/survey` или `/location`. `(setup)`: `signedIn && (step === 'survey' || step === 'location')`, `redirectTo='/'`;
  внутри `(setup)/_layout.tsx` — `Stack.Protected` на каждый экран по шагу. Вкладки при `step === 'unknown'` — `ShellSkeleton`
  (`failure` при `unavailable`). SSR: сессия неизвестна → `/survey` уводит на `/` (скелетон), после гидрации — на шаг.
- **Экран опроса:** react-hook-form + `SubmitOnboardingSurveyRequest` (схема контракта); варианты — в порядке enum;
  мутация с `AUTH_MUTATION`; успех → `onboarding-store.completeSurvey()` (флаг + переход гарда). Ошибка 401 после
  refresh — гард на «Вход».
- **Экран геопозиции:** «Разрешить» — `Button` (`loading`, пока ждём системный диалог) → `requestLocationPermission()`
  → флаг `requested` → `done`; «Не сейчас» — `TextAction` → флаг `dismissed` → `done`. Ошибка запроса разрешения —
  как `unavailable`: Главная.
- **`app.json`:** `["expo-location", { "locationWhenInUsePermission": "<Q7>", "locationAlwaysAndWhenInUsePermission":
  false, "locationAlwaysPermission": false, "motionUsagePermission": false, "locationFullAccuracyPermission": false,
  "isIosBackgroundLocationEnabled": false, "isAndroidBackgroundLocationEnabled": false }]`; Android — только
  `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION` (по умолчанию плагина). Проверка — `npx expo config --type
  introspect` (ключей Always/Motion/Temporary нет, строка русская); EAS агент не запускает.
- **Тексты** — `packages/i18n/src/ru.ts`, формальное «вы»; финальные — по ответу автора (Q1, Q7).

# 8. Risks / Assumptions / Open Questions

- **Запрос геопозиции без потребителя (R6).** Пока «рядом» нет, приложение спрашивает разрешение, которое ничем не
  используется: риск отклонения App Review (Guideline 5.1.1 — доступ только для нужной функции) и недоверия. Сборки
  сейчас только у внутренних тестеров; перед первой публикацией в сторах — либо «рядом» есть, либо шаг выключен
  (release-чеклист, §10).
- **Удаление аккаунта.** Профиль — ПДн; задача удаления обязана удалить документ `profiles` (событие outbox
  `identity.user-deleted` → profile или вызов через `index.ts`). Поздний `PUT` после удаления (прошёл `AuthGuard` до
  отзыва сессий) может воскресить документ — удаление должно быть идемпотентным/повторяемым. Записано в `pokatim-db.md`.
- **Стоимость `AuthGuard`.** Два чтения по `_id` на запрос — для MVP пренебрежимо; при нагрузке — кеш «сессия жива»
  в Redis на ≤ 60 с (пересмотр в ADR-0008).
- **Онбординг офлайн.** Первый запуск после обновления без сети и без флага опроса → вкладки «Нет соединения» с
  повтором (сервер не спросить). Только один раз на устройство.
- **Web без Permissions API** (старые Safari) — шаг геопозиции показывается каждый раз до решения пользователя; флаг
  в `localStorage` это закрывает; приватный режим без хранилища — может показаться снова (принято).
- **CORS dev:** заголовок `Authorization` из web другого origin — preflight; `enableCors` без `allowedHeaders`
  отражает запрошенные заголовки — проверяется int-тестом `OPTIONS` (прод — один origin).
- `[ASSUMPTION]` Раскладка экранов — по образцу экранов онбординга (`AuthScreen`: кикер, заголовок, текст, содержимое,
  действия); кикер — «Знакомство».
- `[ASSUMPTION]` Варианты опроса и тексты (Q1, Q7) — до ответа автора.

# 8.1 Requirements Consistency

Architecture Review — onboarding-04-survey-geo. **Status: CONCERNS** — блокеров нет. **Q1 (варианты опроса) — human
gate до S1**: enum уходит в контракт; остальные Q — по умолчанию рекомендации. R1–R12 — решения архитектора,
оркестратор может переиграть.

- **R1. Первый авторизованный эндпоинт: как проверять access.** Слайс 3 оставил выбор «с первым AuthGuard».
  (а) **JWT + сессия `sid` жива и принадлежит `sub` + пользователь не удалён** (два чтения по `_id`): выход, сброс
  пароля, reuse detection и будущее удаление аккаунта действуют сразу, а не через ≤ 15 мин; (б) только JWT (stateless) —
  быстрее, но отозванная сессия ещё до 15 мин читает/пишет профиль; (в) JWT + кеш в Redis — оптимизация без нагрузки.
  **Рекомендую (а)**; фиксируется ADR-0008.
- **R2. Access в клиенте.** (а) **Явный `accessToken` в методах API, требующих входа, + `withAccessToken` в app**
  (proactive refresh, 401 → один refresh и повтор, single-flight под замком сессии) — Bearer только там, где нужен,
  `lib/api.ts` не зависит от стора; (б) `getAccessToken` в `createApiClient` — Bearer уходит и в публичные/cookie-
  эндпоинты, цикл импорта `api` ↔ `session-store`, refresh всё равно нужен сверху. **Рекомендую (а).**
- **R3. Где хранить ответ.** (а) **Новый модуль `profile`, коллекция `profiles` (`_id` = userId)** — контекст из
  `pokatim-backend.md`, ПДн отдельно, запись одним документом без `lockUser`; (б) поле в `users` (identity) — смешивает
  учётку и профиль, каждая запись — в зоне R1; (в) append-only история ответов — нет потребителя (§4.9).
  **Рекомендую (а).**
- **R4. Источник «опрос пройден».** (а) **Сервер + кеш флага на устройстве, привязанный к сессии** — офлайн-старт
  native не ломается (ADR-0005), новый вход на другом устройстве не спрашивает повторно; (б) только сервер — каждый
  старт ждёт сеть, офлайн-старт показывает ошибку; (в) только устройство — переустановка/второе устройство спрашивают
  снова, сервер не знает ответа. **Рекомендую (а).**
- **R5. Геопозиция — без данных.** Координаты не запрашиваются (native) и отбрасываются сразу (web: единственный
  способ вызвать запрос — `getCurrentPosition`); на сервер не уходит ни координата, ни статус разрешения. Состояние
  шага — локальный флаг устройства. Альтернатива «хранить статус разрешения на сервере» — нет потребителя, ПДн без цели.
- **R6. Запрос разрешения до фичи «рядом» — конфликт с AGENTS.md §4.9 и App Review 5.1.1.** Продуктовая рамка
  (`pokatim-app.md`) задаёт pre-permission в онбординге. (а) **Делаем по рамке сейчас; перед публикацией в сторах —
  проверка: «рядом» есть, иначе шаг выключается** (одна строка в гарде) — release-чеклист в runbook; (б) экран и
  инфраструктура сейчас, шаг включается с первой фичей «рядом» — меньше риска, но «рядом» потом встраивает шаг в уже
  прошедший онбординг; (в) контекстный запрос только при первом «рядом» (без шага онбординга) — расходится с рамкой.
  **Рекомендую (а)**; автор может выбрать (в) — тогда в scope остаётся только опрос (Q5).
- **R7. Совместимость enum.** `RideReason` — значения только добавляются (в конец), не удаляются и не переименовываются:
  старые сборки шлют известные им значения. Ответы GET/PUT не содержат `reasons` — новые значения не ломают разбор
  ответа старыми клиентами. Убрать вариант из UI — скрыть в app, enum не трогать. Пересмотрено в блоке 02
  (`docs/tasks/2026-10-26-app-02-home/task.md`, R5): ответы отдаёт `GET /v1/profile`, клиент отбрасывает неизвестные коды.
- **R8. Опрос не навязывается сервером.** Это UX, не безопасность и не вычисляемое значение (§4.1 не затронут):
  другие эндпоинты не требуют ответа, установленные сборки без опроса работают. Альтернатива — `403 SURVEY_REQUIRED`
  на всех авторизованных эндпоинтах — ломает старые сборки и усложняет каждый guard. Нет.
- **R9. Конфигурация `expo-location`.** Плагин по умолчанию добавляет английские строки Always/Motion/Temporary Full
  Accuracy — лишние разрешения и англоязычный текст (UI на русском). Явно `false` для неиспользуемых, русская строка
  When-In-Use (Q7); фоновая — выключена (рамка MVP). Нужна новая EAS preview-сборка (нативный модуль); Expo Go модуль
  уже содержит.
- **R10. Web — свой файл, не `expo-location` web.** `ExpoLocation.web.js` (58.0.19): без `navigator.permissions` —
  `UnavailabilityError`; на таймаут запроса — `{ status: 'granted', granted: false }`; `canAskAgain` всегда `true`.
  Свой `location-permission.web.ts` (~40 строк) даёт точный итог и не тянет модуль в web-бандл.
- **R11. Гард и SSR.** Шаги — отдельная группа `(setup)` вне `(onboarding)` (та — только без сессии) и вне `(tabs)`
  (без таб-бара); пока шаг неизвестен — скелетон оболочки вкладок, не экран опроса (без мигания у тех, кто уже
  ответил). Экраны `(setup)` не публичные: без `generateMetadata`/`loader`, только `DocumentTitle`.
- **R12. Upsert-гонка.** Два первых `PUT` одновременно (двойное нажатие, два устройства) — duplicate key на `_id`
  возможен; один повтор без upsert-вставки. Int-тест параллельными запросами.
- **Конфликтов с инвариантами AGENTS.md §4 нет** при R6(а) с release-проверкой: контракт первым (§4.2), границы
  модулей — `profile` → `identity/index.ts` (§4.3), без пакетов (§4.4), миграция отдельным шагом (§4.6), UI из
  системы без новых компонентов (§4.11), скелетон на месте данных (§4.12), все платформы, развилки файлами (§4.13),
  внешних сервисов нет (§4.9).

### Вопросы автору (human gate)

| # | Вопрос | Рекомендация (по умолчанию) |
|---|---|---|
| Q1 | Варианты ответа и их тексты (прототипа в репозитории нет) — **нужен ответ до S1** | `[ASSUMPTION]` из рамок §1: `races` «Гонки и результаты», `group_rides` «Кофе-райды и катание в компании», `routes` «Новые маршруты», `calendar` «Календарь стартов», `exploring` «Пока просто смотрю». Без «Другое» со свободным текстом (ПДн, модерация) |
| Q2 | Один или несколько ответов | **Несколько, минимум один** (`Checkbox`). Альтернатива — один (`SegmentedControl`/радио), теряет информацию |
| Q3 | Можно ли пропустить опрос | **Нет** (по постановке: обязательный). Альтернатива — «Пропустить» с записью `skipped` (меньше трения, данных меньше) |
| Q4 | Уже зарегистрированные аккаунты (внутренние тестеры) | **Тоже проходят опрос** при следующем запуске (гард). Альтернатива — миграция данных «пройден» — нет: ответа у них нет |
| Q5 | Когда повторно предлагать геопозицию | **Автоматически — никогда:** экран онбординга один раз на устройство; дальше — только в момент использования «рядом» (с баннером «в настройки» при отказе — `pokatim-app.md`), отдельной задачей. Альтернатива — повтор через N дней/запусков — навязчиво. См. R6: вариант (в) — без шага в онбординге |
| Q6 | Храним ли координаты сейчас | **Нет:** ни координат, ни статуса разрешения на сервере; в приложении — только флаг «экран показан» (R5) |
| Q7 | Тексты экранов и системной строки | Опрос: кикер «Знакомство»; «Что вас привело?»; «Отметьте всё, что подходит. Ответ поможет сделать «Покатим» удобнее для вас.»; «Продолжить»; ошибка — «Не удалось сохранить ответ. Повторите.». Гео: «Покажем, что рядом»; «Разрешите доступ к геопозиции — найдём кофе-райды, маршруты и старты недалеко от вас. Мы не записываем поездки и не храним вашу геопозицию.»; «Разрешить», «Не сейчас». iOS (`NSLocationWhenInUseUsageDescription`): «Геопозиция нужна, чтобы показать заезды, маршруты и старты рядом с вами. Покатим её не записывает и не хранит.» |
| Q8 | Точность геопозиции | **Системный выбор пользователя** (iOS 14+ / Android 12+ «точно/приблизительно»), без принудительного reduced accuracy: «рядом» работает и с приблизительной; точная не требуется. Альтернатива — приблизительная по умолчанию (`isIosReducedAccuracyByDefault`, только COARSE на Android) — решать с фичей «рядом» |
| Q9 | Строка «Дальше — короткий опрос» на «E-mail подтверждён» (кадр Verified прототипа, снята в слайсе 1) | **Вернуть** — теперь опрос есть |
| Q10 | Изменить ответ позже (профиль) | Не в этом слайсе; `PUT` уже идемпотентно перезаписывает — экран профиля добавит только UI |

# 8.2 Deviations from spec

**Решения human gate (2026-10-25):**

- Автор: **Q1** — варианты как предложено (`races`, `group_rides`, `routes`, `calendar`, `exploring`; без «Другое»);
  **Q3** — опрос обязателен; **R6** — экран геопозиции делаем сейчас, перед публикацией в сторах шаг выключается,
  если «рядом» не готово (флаг + release-чеклист в runbook).
- Оркестратор (по рекомендациям §8.1): **Q2** — мультивыбор, минимум один; **Q4** — уже зарегистрированные тоже
  проходят опрос; **Q5** — геопозицию автоматически больше не предлагаем; **Q6** — координаты не храним и не читаем;
  **Q7** — тексты из таблицы §8.1; **Q8** — точность — системный диалог; **Q9** — вернуть «Дальше — короткий опрос»;
  **Q10** — редактирование ответа — не сейчас. **R1** (AuthGuard: JWT + живая сессия `sid` того же `sub`,
  пользователь не удалён) и **R2** (`withAccessToken`: заблаговременный refresh, на 401 один refresh + один повтор,
  общий refresh под замком сессии) — в scope, ADR-0008.

**Отклонения при реализации (coder, 2026-10-25):**

1. **CORS: `methods` явно (`GET, HEAD, POST, PUT`)** в `http-app.ts` — по умолчанию `@fastify/cors` разрешает только
   GET/HEAD/POST, preflight `PUT …/survey` из dev web другого origin падал (int-тест `OPTIONS` это поймал); §8 говорил
   только о заголовке `Authorization` (он отражается и так).
2. **`IdentityModule.exports` = `AuthGuard`, `AccessTokenVerifier`, `IdentityRepository`** — Nest создаёт гард из
   `@UseGuards` в модуле-потребителе, ему нужны зависимости гарда. Из `index.ts` наружу — только `AuthGuard`,
   `CurrentUser`, `AuthUser`: импортировать репозиторий identity другие модули не могут (arch:check).
3. **`refreshAccess(now)` платформы возвращает `{ status: 'rotated', session } | { status: 'signedOut' }`**
   (`AccessRefresh`), а не строку: сессию в стор кладёт `withAccessToken` (single-flight) через
   `useSessionStore.applyAccessRefresh` — тот же переход, что у `revalidate`. Native без сохранённой сессии (сбой
   SecureStore) — `signedOut`.
4. **Гард `(setup)` открыт и пока сессия/шаг неизвестны** (`isSessionPending || (signedIn && step !== 'done')`),
   `(setup)/_layout` в этом состоянии рисует скелетон оболочки (или ошибку с повтором). С условием §7 (`signedIn &&
   step ∈ {survey, location}`) SSR `/survey` отдавал пустой `<body>` (редирект Router на сервере не рендерит) — AC9
   требует HTML скелетона. Общая логика ошибки — `features/onboarding/use-shell-failure.ts`.
5. **Сброс онбординга (стор + кеш `pokatim.onboarding`) — только на переходе `signedIn → signedOut`**, не на запуске
   без сессии (`unknown → signedOut`): иначе первый запуск стирал бы кеш и чистил кеш запросов зря (ловил тест
   ссылки: повторный GET). Повтор после ошибки статуса — `retry()` (шаг снова `unknown`, гидрацию запускает эффект
   корневого layout — без двойного запроса).
6. **Инвариант «у удаляемого очисткой аккаунта нет `profiles`»** — `apps/api/test/profile-cleanup.int.test.ts`
   (межмодульный тест вне `src/modules`: из `profile` нельзя импортировать внутренности identity). Int-тесты гарда
   (`auth-guard.int.test.ts`) — в коммите S3: проверяются через первый авторизованный эндпоинт.
7. **Флаг R6** — константа `LOCATION_STEP_ENABLED` в `onboarding-store.ts` (+ release-чеклист в
   `docs/runbooks/deploy.md`). Схема флага устройства — отдельный `features/onboarding/location-prompt.ts` (общая для
   `device-flags.ts` и `.web.ts`: `.web` не может импортировать `./device-flags` — бандлер вернул бы его самого).
8. **Ошибка сохранения опроса:** сеть — общий текст «Нет соединения. Проверьте подключение…» (`auth.error.network`),
   прочее — «Не удалось сохранить ответ. Повторите.» (Q7); повтор — той же кнопкой «Продолжить».
10. **Фиксы ревью pass 1 (Codex REQUEST CHANGES + Claude):** кеш `pokatim.onboarding` привязан к владельцу
    (`{ surveyCompleted, userId }`, `userId` = `sub` access), запись/применение — только при актуальных поколении и
    владельце; `withAccessToken` фиксирует сессию (`sub` + `sid` из payload access, без проверки подписи —
    `features/auth/session-identity.ts`) и сверяет её после каждого ожидания; ротация с другим `sub` (web: cookie
    другой вкладки) — локальный выход; заблаговременный refresh — по `exp − iat` сервера от момента получения
    сессии (`sessionReceivedAt`); web-запрос геопозиции — свой таймер 45 с, «Не сейчас» доступна во время запроса.
    Находки и статусы — `findings.md` (в отчёте оркестратору).
9. **«Экраны `(setup)` рендерятся без `window`»** — проверено SSR (`build:web` + `curl /survey`, e2e AC9), отдельного
   jest-web теста нет.

# 8.3 Security checklist

Затронуты аутентификация (первый `AuthGuard`, авто-refresh в клиенте), персональные данные (ответы опроса — профиль;
геопозиция — чувствительная, не собирается) — `security.md`, `pokatim-security.md`.

1. **AuthN/AuthZ.** Оба эндпоинта профиля — только под `AuthGuard`: подпись HS256 (алгоритм зафиксирован — `none` и
   RS/ES отвергаются), `iss`/`aud`, `exp` по `CLOCK`, сессия `sid` принадлежит `sub`, не отозвана, не истекла,
   пользователь не удалён (R1). Пользователь — только из access (`@CurrentUser()`), не из тела/пути: чужой профиль
   недостижим. Отказ — один `401 UNAUTHORIZED`. CSRF: Bearer в заголовке браузер сам не подставляет; глобальный
   `enableCsrfProtection` остаётся. Клиент: refresh — только `refreshAccess` под замком сессии; 401 refresh — выход.
2. **Входные данные.** `z.strictObject`, `reasons` — массив enum 1…N без повторов (лишние ключи, неизвестное значение,
   пустой массив, объект-оператор `{ $ne: null }` — 400 до БД); в фильтр Mongo — только `userId` из проверенного
   токена (`Uuid`) — без операторной инъекции (`db.md`). Заголовок `Authorization` — формат и длина до jose. Лимит тела
   Fastify — общий (64 KiB).
3. **Данные наружу.** Ответ — только `{ surveyCompleted }`; ответы опроса, id, время наружу не отдаются;
   `Cache-Control: no-store`. Экраны `(setup)` не публичные — без SSR-данных и мета с ПДн. Координаты не читаются,
   не хранятся, не отправляются (Q6); статус разрешения на сервер не уходит.
4. **Злоупотребления.** Эндпоинты только для вошедших; запись — один документ на пользователя (upsert по `_id`),
   рост данных ограничен; отдельный лимитер не нужен (refresh уже ограничен по IP). Повторный refresh клиента —
   single-flight, без шторма ротаций.
5. **Секреты и логи.** Access/refresh не логируются ни сервером, ни клиентом (`console.warn` — только имя ошибки);
   отказы `AuthGuard` не логируются (норма); ответы опроса — не в логах. Новых секретов/env нет (`JWT_SECRET` —
   прежний).
6. **Аудит.** Чувствительных действий нет: `surveyCompletedAt`/`updatedAt` в документе; append-only коллекции не
   затронуты. Профиль — ПДн: отдельная коллекция, удаление с аккаунтом — задача удаления (§8).

# 9. Acceptance Criteria

1. Контракт: `SubmitOnboardingSurveyRequest` принимает 1…N разных значений `RideReason`; пустой массив — `REQUIRED`,
   неизвестное значение, повтор, лишний ключ, не-массив — 400 `VALIDATION_FAILED`. `OnboardingStatus` —
   `{ surveyCompleted: boolean }`.
2. `AuthGuard`: без заголовка, `Basic …`, мусор, `alg: none`, чужой ключ, чужие `iss`/`aud`, истёкший (CLOCK + 15 мин),
   `sid` отозванной сессии (выход, сброс пароля, reuse), истёкшей сессии, `sid` другого пользователя, удалённого
   пользователя → `401 UNAUTHORIZED` с побайтно одинаковым телом; живой access → 200.
3. `GET /v1/profile/onboarding` нового пользователя → `{ surveyCompleted: false }`; после `PUT` → `true`; документ
   `profiles` (`_id` = userId) содержит ответы, `surveyCompletedAt`, `updatedAt` по `CLOCK`. Повтор `PUT` с другим
   набором — ответы заменены, `surveyCompletedAt` прежний. Два параллельных первых `PUT` → оба 200, документ один.
   Ответы `no-store`.
4. Миграция `0004_profile` на чистой БД и повторно — без ошибок; коллекция `profiles` есть.
5. App — авторизованные запросы: access, истекающий через < 60 с, обновляется до запроса; 401 → один refresh и
   повтор; два параллельных запроса → один refresh; refresh 401 → выход и «Вход»; refresh без сети → ошибка запроса с
   повтором, сессия остаётся.
6. App — гард (iOS, Android, web): после автовхода (V-09) и входа по паролю без ответа → «Что вас привело?»;
   «Продолжить» выключена без выбора; сохранение → экран геопозиции (разрешение не определено) или Главная; вкладки и
   опрос недоступны вне своего шага (`/survey` после ответа → Главная; `/` без ответа → опрос). Пока онбординг
   неизвестен — скелетон оболочки; ошибка — «Нет соединения» / «Не удалось загрузить» с повтором. Native офлайн-старт
   с флагом опроса — сразу Главная.
7. Геопозиция: «Разрешить» → системный запрос → Главная при любом исходе; «Не сейчас» → Главная; повторный запуск
   этого устройства экран не показывает; разрешение уже `granted`/`denied` — экран пропускается; web без Geolocation —
   пропускается. Координаты не читаются (тест: `getCurrentPositionAsync` native не вызывается; web — колбэк успеха
   не трогает `coords`), запросов с координатами нет.
8. Выход → вход другим аккаунтом на том же устройстве: опрос — по ответу сервера для нового аккаунта (флаг прежнего
   стёрт); экран геопозиции не повторяется (флаг устройства).
9. Web SSR: `/survey`, `/location` без сессии → HTML скелетона оболочки, без ошибок гидрации; смоук с API: вход →
   опрос → «Не сейчас» → Главная → перезагрузка → Главная; с выданным браузеру разрешением — шаг геопозиции пропущен.
10. `app.json` после `expo config --type introspect`: русская `NSLocationWhenInUseUsageDescription`, нет ключей
    Always/Motion/Temporary Full Accuracy, нет `ACCESS_BACKGROUND_LOCATION`.
11. Архитектура: контракты первыми; `profile` импортирует identity только через `index.ts`; DTO только из contracts;
    без `Platform.OS` в экранах; `expo-location` только в `location-permission.ts`; `pnpm check` зелёный; int-тесты на
    реальном MongoDB replica set + Redis.

# 10. Documentation Impact

- **ADR-0008** «Авторизация запросов: access JWT + проверка сессии; авто-refresh в приложении» (R1, R2, стоимость и
  пересмотр — Redis-кеш) + строка в `docs/adr/README.md`; ADR-0005 — «Пересмотр (слайс 4)»: отзыв сессии действует на
  авторизованные запросы сразу.
- `docs/architecture/README.md` — модуль `profile` (коллекция `profiles`), поток «вход → онбординг (опрос → гео) →
  Главная», `AuthGuard` в разделе «Сессия».
- `docs/product/onboarding.md` (новый) — решения автора по Q1–Q10 (варианты опроса, обязательность, политика
  геопозиции: один pre-permission экран, без координат) + строка в `docs/product/README.md`.
- `.claude/rules/pokatim-security.md` — авторизованные эндпоинты: только `AuthGuard` identity, пользователь — из
  access, один 401; клиент — `withAccessToken`, Bearer только в методах, требующих входа.
- `.claude/rules/pokatim-app.md` — шаги онбординга `(setup)` и гард; `withAccessToken`; геопозиция: развилка
  `location-permission(.web).ts`, координаты не собираются до фичи «рядом», флаг устройства.
- `.claude/rules/pokatim-db.md` — `profiles` (`_id` = userId), удаление с аккаунтом; запись одного документа без
  `lockUser`.
- `.claude/rules/pokatim-backend.md` — контекст `profile` появился.
- `docs/runbooks/local-dev.md` — сброс шага геопозиции в dev (`localStorage` `pokatim.locationPrompt`, на native —
  переустановка/«Стереть данные»), шаг смоука; `docs/runbooks/deploy.md` — миграция `0004_profile`; release-чеклист
  сторов: «шаг геопозиции — только при живой фиче „рядом“» (R6).
- `docs/tasks/2026-10-24-onboarding-02-sign-in/task.md` §4 и `2026-10-25-onboarding-03-password-reset/task.md` §12 —
  follow-up «AuthGuard / проверка `sid`» отмечен ссылкой на эту задачу.

# 11. Implementation Context

Уровень — task3 (контракты, новый модуль и миграция, аутентификация, все платформы). Слайсы — по коммиту, проверка
после каждого обязательна. Q1 — до S1; остальные Q — по умолчанию рекомендации §8.1.

### ENTRY POINTS
- API: `GET /v1/profile/onboarding`, `PUT /v1/profile/onboarding/survey` — `onboarding.controller.ts` →
  `OnboardingService`; `AuthGuard` из `modules/identity/index.ts`.
- App: `src/app/_layout.tsx` (гарды), `src/app/(setup)/{survey,location}.tsx`, `features/auth/authorized.ts`.

### Слайсы и проверка после каждого
| # | Что | Проверка |
|---|---|---|
| **S1** | Contracts + api-client: `profile/onboarding.schema.ts` (+ test), экспорт; `getOnboardingStatus(accessToken)`, `submitOnboardingSurvey(accessToken, body)` (`request` с `method: 'PUT'` и `authorization`) | TDD; `pnpm --filter @pokatim/contracts test`, `--filter @pokatim/api-client test`, `pnpm typecheck` |
| **S2** (после S1) | API identity: `AccessTokenVerifier`, `AuthGuard`, `@CurrentUser`, `findActiveSession`, экспорт через `index.ts`, `IdentityModule.exports` | `pnpm --filter @pokatim/api test` (unit verifier + int guard на тестовом контроллере стенда или через S3); Security п. 1, 2, 5 — тестами; `pnpm arch:check` |
| **S3** (после S2) | API profile: модуль, коллекция, репозиторий, сервис, контроллер, миграция `0004_profile`, `AppModule` | `pnpm --filter @pokatim/api test` (int на `*_test` MongoDB RS + Redis db 1); `db:migrate` на чистой БД и повторно; CORS preflight `Authorization`; `pnpm check` |
| **S4** (после S1, параллельно S2–S3) | App: `withAccessToken` + `refreshAccess(.web)`, `onboarding-store`, флаги (`secureStorage`, `device-flags(.web)`), гарды `_layout.tsx`, `(setup)/_layout.tsx`, экран опроса, скелетон вкладок, строка Q9, строки `ru.ts`, `app-routes.ts` | `pnpm --filter @pokatim/app test` (native + web); `typecheck`; `build:web` + `start:web` + `curl /survey` (HTML скелетона, без ошибок) |
| **S5** (после S4) | App: `expo-location` (зависимость, плагин `app.json`), `location-permission(.web).ts`, экран геопозиции, шаг в сторе/гарде | `pnpm --filter @pokatim/app test`; `npx expo config --type introspect` (AC10); `expo export -p android`, `-p ios`; `build:web` — `expo-location` не в web-бандле (поиск по `dist`) |
| **S6** | E2E + docs: шаги `e2e/web.spec.ts` (AC9; существующие сценарии с входом проходят опрос), §10 | `pnpm build:web && E2E_API=1 pnpm --filter @pokatim/app e2e:web` — зелёный; без API — `skip`; `pnpm check` |

Параллель S2–S3 / S4: S2–S3 — только `apps/api/**`; S4–S5 — только `apps/app/**` и `packages/i18n/src/ru.ts`.
`packages/contracts`, `api-client` — только S1; lockfile — только S5.

### FILES TO MODIFY
| Файл | Слайс | Изменение |
|---|---|---|
| `packages/contracts/src/profile/onboarding.schema.ts` (новый, + test), `src/index.ts` | S1 | схемы §TYPES |
| `packages/api-client/src/index.ts` (+ `profile.test.ts`) | S1 | 2 метода, Bearer — параметром |
| `apps/api/src/modules/identity/access-token.ts` (новый, + test) | S2 | `AccessTokenVerifier` |
| `apps/api/src/modules/identity/auth.guard.ts`, `current-user.decorator.ts` (новые, + `auth-guard.int.test.ts`) | S2 | R1 |
| `apps/api/src/modules/identity/identity.repository.ts` | S2 | `findActiveSession` |
| `apps/api/src/modules/identity/identity.module.ts`, `index.ts` | S2 | `exports`, экспорт `AuthGuard`, `CurrentUser`, `AuthUser` |
| `apps/api/src/modules/profile/{profile.collection,profile.repository,onboarding.service,onboarding.controller,profile.module,index}.ts` (новые, + `onboarding.int.test.ts`) | S3 | модуль |
| `apps/api/src/db/migrations/0004_profile.ts` (новый), `index.ts`, `migrations.int.test.ts` | S3 | коллекция `profiles` |
| `apps/api/src/app.module.ts` | S3 | `ProfileModule` |
| `apps/app/src/features/auth/authorized.ts` (новый, + test, + `.web.test`) | S4 | `withAccessToken` |
| `apps/app/src/features/auth/session-persistence(.web).ts`, `session-store.ts` (+ tests) | S4 | `refreshAccess`, обновление access в сторе, локальный выход по 401 refresh |
| `apps/app/src/features/auth/secure-storage.ts` | S4 | ключ `pokatim.onboarding` в `SecureKey` |
| `apps/app/src/features/onboarding/{onboarding-store,queries,device-flags,device-flags.web}.ts` (новые, + tests) | S4–S5 | состояние шагов, мутация опроса, флаги |
| `apps/app/src/app/_layout.tsx`, `(tabs)/_layout.tsx` | S4 | гарды, скелетон при неизвестном онбординге |
| `apps/app/src/app/(setup)/{_layout,survey}.tsx` (новые) | S4 | экран опроса |
| `apps/app/src/app/(setup)/location.tsx` (новый) | S5 | экран геопозиции |
| `apps/app/src/features/location/location-permission(.web).ts` (новые, + tests) | S5 | развилка платформ |
| `apps/app/src/features/auth/verification-states.tsx` / `check-email.tsx` | S4 | «Дальше — короткий опрос» (Q9) |
| `apps/app/app.json`, `apps/app/package.json`, `pnpm-lock.yaml` | S5 | `expo-location` + плагин (R9) |
| `apps/app/src/__tests__/{app-routes.ts,auth-fixtures.ts,auth-guard.test.tsx,onboarding-guard.test.tsx (новый),survey.test.tsx (новый),location.test.tsx (новый),check-email.test.tsx,sign-in.test.tsx}` | S4–S5 | маршруты `(setup)`, мок `getOnboardingStatus` в существующих тестах входа |
| `packages/i18n/src/ru.ts` | S4–S5 | `onboarding.*`, `location.*` (Q7) |
| `apps/app/e2e/web.spec.ts` | S6 | AC9 |
| docs §10 | S6 | — |

### FILES TO READ
`AGENTS.md` §1, §4; `.claude/rules/{security,pokatim-security,backend,pokatim-backend,db,pokatim-db,contracts,pokatim-contracts,app,pokatim-app,tests,pokatim-tests}.md`;
ADR-0003 (п. 3–4), ADR-0005, ADR-0007; `docs/tasks/2026-10-24-onboarding-02-sign-in/task.md` §4, §8.1 (сессия,
Web Lock, `networkMode: 'always'`); `docs/tasks/2026-10-25-onboarding-03-password-reset/task.md` §8 (Access после
сброса); `apps/api/src/modules/identity/session.service.ts` (формат access JWT: `sub`, `sid`, HS256, iss/aud);
`apps/app/src/features/auth/session-persistence(.web).ts` (ротация, замок, `signOutPending`);
`apps/app/src/__tests__/auth-guard.test.tsx` (образец тестов гарда); `expo-location` 58: `build/Location.d.ts`,
`build/ExpoLocation.web.js`, `plugin/build/withLocation.js`; Expo Router `Stack.Protected` (context7 недоступен —
по `node_modules/expo-router`).

### TYPES & SCHEMAS
```ts
// packages/contracts/src/profile/onboarding.schema.ts
/** Коды ответа «Что вас привело?» — только добавлять в конец (R7). [ASSUMPTION] Q1 */
export const RIDE_REASONS = ['races', 'group_rides', 'routes', 'calendar', 'exploring'] as const;
export const RideReason = z.enum(RIDE_REASONS, { error: fieldError('INVALID') });
export const SubmitOnboardingSurveyRequest = z.strictObject({
  reasons: z
    .array(RideReason, { error: fieldError('REQUIRED') })
    .min(1, { error: 'REQUIRED' })
    .max(RIDE_REASONS.length, { error: 'INVALID' })
    .refine((list) => new Set(list).size === list.length, { error: 'INVALID' }),
});
export const OnboardingStatus = z.object({ surveyCompleted: z.boolean() });
// GET /v1/profile/onboarding → OnboardingStatus; PUT /v1/profile/onboarding/survey → OnboardingStatus
// ошибки: 401 UNAUTHORIZED (AuthGuard), 400 VALIDATION_FAILED — коды базы
```

```ts
// apps/api/src/modules/profile/profile.collection.ts
export const PROFILE_COLLECTIONS = { profiles: 'profiles' } as const;
/** Профиль райдера (ПДн — отдельно от учётки identity); `_id` — id пользователя. */
export interface ProfileDoc {
  _id: string;
  rideReasons: RideReason[];
  surveyCompletedAt: Date;
  updatedAt: Date;
}

// apps/api/src/modules/identity/index.ts (+)
export interface AuthUser { userId: string; sessionId: string }
export { AuthGuard } from './auth.guard';
export { CurrentUser } from './current-user.decorator';
```

```ts
// apps/app
type LocationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';
type OnboardingStep = 'unknown' | 'survey' | 'location' | 'done';
withAccessToken<T>(call: (accessToken: string) => Promise<T>): Promise<T>;
refreshAccess(): Promise<'rotated' | 'signedOut'>; // сеть/429/5xx — бросает
// хранилище: 'pokatim.onboarding' → { surveyCompleted: true } (сессия); 'pokatim.locationPrompt' → { decision, at } (устройство)
```

Миграция `0004_profile`: `{ id: '0004_profile', up: (db) => ensureCollection(db, PROFILE_COLLECTIONS.profiles) }` — в
конец `migrations/index.ts`.

### TESTS
- **contracts:** 1, все N и повтор значения; пустой массив `REQUIRED`; неизвестное значение, не-массив, лишний ключ —
  ошибка; `OnboardingStatus` — только boolean.
- **api-client:** пути, методы (`GET`/`PUT`), заголовок `authorization: Bearer <токен>` только у двух методов
  (публичные — без него), ответ по схеме.
- **API unit:** `AccessTokenVerifier` — валидный токен `SessionService.issue`; `alg: none`, HS512/другой ключ, чужие
  `iss`/`aud`, без `sid`/`sub`, `sid` не UUID, истёкший по фиксированному `currentDate` → `undefined`.
- **API int (MongoDB RS `*_test` + Redis db 1, фиксированный CLOCK):** AC2 по пунктам (сессия из `poll` и
  `sign-in`; отзыв через `sign-out`, сброс пароля, reuse; `deletedAt` выставлен напрямую) — одинаковое тело 401;
  AC3 (GET/PUT, перезапись, `surveyCompletedAt` прежний, параллельные первые `PUT` — `Promise.all`, один документ);
  инъекция `{ "reasons": { "$ne": null } }` и `reasons: [{ "$gt": "" }]` → 400, документ не создан; `no-store`;
  `OPTIONS` с `Access-Control-Request-Headers: authorization` от origin из `CORS_ORIGINS` → разрешено; очистка
  неподтверждённых — у удаляемого аккаунта нет `profiles` (инвариант); миграция на чистой БД и повторно.
- **App native (jest-expo, Europe/Minsk):** `withAccessToken` — proactive refresh, 401 → refresh → повтор, single-flight
  (2 вызова → 1 ротация), refresh 401 → выход и `/sign-in`, refresh офлайн → ошибка, сессия остаётся; гард — автовход
  (check-email) → `/survey`, вход по паролю с пройденным опросом → Главная, `/survey` после ответа → `/`, неизвестный
  онбординг → скелетон, ошибка → «Нет соединения»/«Не удалось загрузить» + «Повторить», офлайн-старт с флагом →
  Главная без запроса; опрос — кнопка выключена без выбора, `Checkbox` доступен скринридеру, `loading`, ошибка
  сохранения — баннер с повтором; гео — `undetermined` → экран, «Разрешить» → `requestForegroundPermissionsAsync` →
  Главная, «Не сейчас» → Главная без системного запроса, повторный запуск — экран не показан, `granted`/`denied` —
  пропуск; `getCurrentPositionAsync` не вызывается; выход → флаг опроса стёрт, флаг геопозиции остался (AC8).
- **App web (`*.web.test.ts(x)`):** `location-permission.web` — `prompt` → `undetermined`; нет Permissions API →
  `undetermined`; нет `navigator.geolocation` → `unavailable`; запрос: успех → `granted` без чтения `coords`,
  `PERMISSION_DENIED` → `denied`, таймаут → по Permissions API; `refreshAccess.web` — под Web Lock
  `pokatim.session-refresh`, 401 → выход; `device-flags.web` — `localStorage`, сбой хранилища не бросает; экраны
  `(setup)` рендерятся без `window`.
- **E2E:** AC9; существующие сценарии входа проходят опрос; `pageerror`/`console.error` пусто, кроме согласованных 401
  (`REFRESH_URL`, `SIGN_IN_URL`).
- **Ручной смоук (человек; NOT VERIFIED, если не делался):** iOS/Android preview-сборка — системный диалог с русской
  строкой, «Разрешить»/«Запретить»/«Приблизительно», повторный запуск без экрана; Safari (iOS) web — запрос
  разрешения по кнопке.

### OUT OF SCOPE
§4. Плюс: изменения app-foundation (follow-ups: авторизованный запрос с refresh в `api-client-core`, `AuthGuard` —
с F6); удаление профиля с аккаунтом; Redis-кеш проверки сессии; «рядом» и баннер «в настройки».

# 12. Outcome

**Статус:** реализовано S1–S6, ветка `feature/onboarding-04-survey-geo` (от `origin/develop`). Независимое ревью — за
оркестратором.

**Слайсы (коммиты):** §8.2 решения → S1 контракт + api-client → S2 `AuthGuard` → S3 модуль `profile`, миграция
`0004_profile`, CORS `PUT` → S4 `withAccessToken`, стор онбординга, гарды, экран опроса, Q9 → S5 `expo-location`,
экран геопозиции, флаг устройства → S6 e2e + docs (§10).

**Инфраструктура проверок агента:** Docker недоступен — нативные `mongod 8.2.7 --replSet rs0` (`127.0.0.1:27117`),
`redis-server` (`:6479`), `mailpit` (`:1225`/`:8225`); контейнеры `pokatim-dev-*` не трогались.

**Проверки:**

| Команда | Результат |
|---|---|
| `MONGO_URL_TEST=…27117/pokatim_test REDIS_URL_TEST=…6479/1 pnpm check` | EXIT 0: prettier ✔, eslint ✔, `arch:check` ✔ (303 modules), typecheck 8/8, test 13/13 (contracts 56, api-client 30, api 240 в 32 файлах, app 263, admin 7, design-tokens 114, i18n 6, tracks 2) |
| `db:migrate` на чистой БД (`pokatim_migr`) и повторно | «миграции применены: 0001_outbox, 0002_identity, 0003_identity_ttl, 0004_profile» → «новых миграций нет»; коллекция `profiles` есть |
| `EXPO_PUBLIC_API_URL=… pnpm build:web` + `start:web` + `curl /survey` | 200, HTML со скелетоном (`progressbar`), без содержимого шага; `expo-location` в `dist` не найден (grep `ExpoLocation`/`getForegroundPermissionsAsync` — пусто) |
| `pnpm e2e:web` без API | 11 passed, 1 skipped (сценарий с API) |
| `E2E_API=1 pnpm e2e:web` (API/worker из `dist`, MongoDB RS, Redis, Mailpit) | 12 passed: регистрация → письмо → подтверждение → опрос (PUT с Bearer, 200 `{ surveyCompleted: true }`) → `/location` «Не сейчас» → Главная → перезагрузка → … → сброс пароля → вход в контексте с выданной геопозицией — Главная без шага геопозиции |
| `npx expo export -p android` / `-p ios` | Android Bundled (1608 modules), iOS Bundled (1460 modules), Exported |
| `npx expo config --type introspect` (AC10) | `infoPlist`: только `NSLocationWhenInUseUsageDescription` (русская строка); Always/AlwaysAndWhenInUse/Motion/TemporaryFullAccuracy/`UIBackgroundModes` — нет; Android: `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` (+ прежние), `ACCESS_BACKGROUND_LOCATION` — нет |

**Отрицательные доказательства (`pokatim-tests.md`)** — механизм убран, тест краснеет по результату:

- фильтр сессии `{ _id: sid, userId: sub, revokedAt: null, expiresAt: { $gt: now } }` → `{ _id: sid }`:
  `auth-guard.int.test.ts` — 5 failed («sid сессии, отозванной выходом / сбросом пароля / reuse detection», «истёкшая
  сессия», «sid другого пользователя»): `expected 200 to be 401`;
- условие `deletedAt: null` у `users` убрано: «удалённый пользователь» — `expected 200 to be 401`;
- повтор при `isDuplicateKey(error, '_id_')` убран: «гонка upsert (duplicate key на _id)» — `expected 500 to be 200`
  (дубль-ключ — настоящий E11000 MongoDB). Восемь параллельных первых `PUT` проходят и без повтора: MongoDB 8 сам
  повторяет upsert при конфликте уникального `_id` — тест на 8 параллельных фиксирует итог (один документ, все 200).

**CI `deploy-rehearsal` (PR #21):** падал не из-за слайса — `rehearsal.sh` репетировал переезд PostgreSQL → MongoDB и
ждал PostgreSQL в базовой ветке, а `develop` уже на MongoDB. Отдельным коммитом: `rehearsal.sh` — репетиция
**обновления** (стек базовой ветки + маркер-данные в MongoDB → новый `deploy.sh`: новые миграции применены, smoke,
маркер, пароли MongoDB и секреты `.env` не изменились → повторный деплой идемпотентен → права `pokatim` → битый
`JWT_SECRET`: деплой падает, данные на месте, после восстановления проходит). **`retire_postgres` удалён** из
`deploy.sh` как legacy: переезд на сервере выполнен (runbook «Переезд на MongoDB» и предлагал это follow-up-ом),
шаг был идемпотентен, но держал мёртвый код и ветку репетиции; хосту на PostgreSQL — деплой из коммита до удаления.

**NOT VERIFIED:**

- Ручной смоук на устройствах: iOS/Android preview-сборка (нужна новая EAS-сборка — нативный модуль `expo-location`):
  системный диалог с русской строкой, «Разрешить» / «Запретить» / «Приблизительно», повторный запуск без экрана;
  Safari (iOS) web — запрос разрешения по кнопке. EAS агент не запускает.
- CI GitHub Actions (push сделан, PR не открывался).
- Тесты — на `mongod 8.2.7` (CI — `mongo:8.0`).

**Follow-ups:**

- Удаление аккаунта: удалить документ `profiles` идемпотентно (поздний `PUT` после отзыва — §8, `pokatim-db.md`).
- Перед сторами: `LOCATION_STEP_ENABLED` и строка `NSLocationWhenInUseUsageDescription` в Info.plist остаётся при
  выключенном шаге — решать вместе с фичей «рядом».
- Кандидаты в app-foundation (F6): `AuthGuard`, авторизованный запрос с single-flight refresh в `api-client-core`.
- Redis-кеш «сессия жива» ≤ 60 с — при нагрузке (ADR-0008).
