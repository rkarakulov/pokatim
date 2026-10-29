# Findings — guest-landing — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..4c900ca (working tree clean)
verdict: APPROVE

Проверено: гарды `_layout.tsx` (новый гость → `/welcome`, `returning` → `/sign-in`, `resumeOnLaunch` → `/register`,
вошедший на `/welcome` → `/`); `welcome.tsx` (loader не бросает, `generateMetadata`), мета `/` = `landingMetadata`;
SSR/гидрация — `now = useMinskClockAfterMount`, `RaceHero`/`CalendarStartHero` с `now: null`, `useId` в затронутых
компонентах нет; ключи TanStack Query (`['races','list',NEXT_RACE]`, `['calendar','list',{limit:1}]`,
`['seasons','current']`, `['routes','list',{author:['team'],limit:3}]`) — совпадают с Главной/шапкой по форме
данных, с infinite-ключами вкладок (`[…,'pages']`) не пересекаются; маршруты — только `author=team` (клиент и SSR-путь
`/v1/routes?author=team&limit=3`); только роли темы и токены; все строки — `t()`; docs (§10) синхронны.
Прогон: `jest landing auth-guard public-metadata app-routes-manifest check-email` → 5 suites, 77 passed.
NOT VERIFIED: web-смоук с API (`E2E_API=1`), iOS/Android вживую, 7 тем × светлая/тёмная на 375 px.

### [MEDIUM] Гонка гидрации сторов: живая регистрация может уйти на лендинг вместо «Регистрации»
- **file:** apps/app/src/app/_layout.tsx
- **location:** 55, 126-142 (`guard`/`redirectTo` вкладок); 61-62 (параллельный `hydrate()` двух сторов)
- **problem:** гард вкладок ждёт только сессию (`isSessionPending(sessionStatus)`), а `resumeRegistration` читается
  из `useRegistrationStore`, который гидрируется отдельно и асинхронно. Если `session.hydrate()` (native — одно чтение
  SecureStore, вызвано первым) завершится раньше `registration.hydrate()`, гард сработает при
  `resumeOnLaunch === false` и уведёт на `/welcome`; когда флаг станет `true`, повторного редиректа не будет
  (`Stack.Protected` редиректит только при выпадении текущего маршрута), а эффект продолжения живёт в `register.tsx`.
- **why_it_matters:** отступление 8.2 («живая регистрация → `/register` → «Подтвердите e-mail»») становится
  недетерминированным на устройстве: гость с живым токеном видит лендинг и попадает на «Подтвердите e-mail» только
  после нажатия «Зарегистрироваться». До изменения порядок гидрации не имел значения (всегда `/register`).
  Тест `auth-guard.test.tsx:118` зелёный за счёт порядка микрозадач in-memory мока, порядок он не фиксирует.
- **evidence:** `const hydrated = sessionStatus !== 'unknown' && registrationHydrated;` (стр. 56) в гард не входит;
  `guard={isSessionPending(sessionStatus) || (signedIn && …)}`; `registration-store.ts:64-76` — `resumeOnLaunch`
  выставляется только после `await readJson`.
- **recommended_fix:** держать гард вкладок открытым, пока гость и стор регистрации не гидрирован
  (`… || (!signedIn && !registrationHydrated)`), либо в `LandingScreen` при `resumeOnLaunch` делать
  `router.replace('/register')`; добавить тест, где `registration.hydrate` резолвится позже сессии.

### [LOW] Посев SSR помечается свежим на клиенте без учёта возраста кэша процесса
- **file:** apps/app/src/features/landing/queries.ts, apps/app/src/features/home/queries.ts, apps/app/src/features/races/queries.ts
- **location:** `initialData: seed` (без `initialDataUpdatedAt`)
- **problem:** `fetchPublicForSsr` кэширует ответ до 60 с, клиент считает посев свежим ещё 60 с — до ~2 мин без
  перезапроса.
- **why_it_matters:** незначительно (публичные списки, `max-age=60`); паттерн уже принят в проекте — не блокер.
- **evidence:** `public-ssr.ts` TTL_MS = 60_000; `PUBLIC_LIST_STALE_MS = 60_000`.
- **recommended_fix:** по желанию — оставить как есть (консистентно с другими экранами).

Примечание (не finding): 5 падений смоука без API («Не удалось загрузить» вместо «Нет соединения» у `/rides/report`,
`/rides/invite`, `/rides/route-pick`, `/routes/pick`, `/routes/rides`) — утверждения этих веток diff не трогает
(менялась только ветка `WITH_API`); на базе не перепроверено.

## Исправления после прохода 1

- MEDIUM (гонка гидрации стора регистрации) — исправлено: `src/app/welcome.tsx` при `resumeOnLaunch` делает
  `<Redirect href="/register" />` (SSR: стор пуст — лендинг). Тест `auth-guard.test.tsx` «живая регистрация, гость уже
  на лендинге…» — красный до правки, зелёный после.
- LOW (`initialDataUpdatedAt`) — не меняем: как у остальных публичных экранов.

# Findings — guest-landing — pass 2 — reviewer: claude
base: origin/develop   commits: origin/develop..c26706f (re-review фикса 4c900ca..c26706f; working tree clean)
verdict: APPROVE

Проверено: `welcome.tsx` — хуки до условного `<Redirect href="/register" />` (порядок хуков стабилен); SSR —
`resumeOnLaunch: false` по умолчанию, `hydrate()` только в эффекте `RootShell` → сервер и первый клиентский рендер
отдают лендинг, расхождения гидрации нет; цикла нет — `(onboarding)/register.tsx:93-95` вызывает `consumeResume()`
и уводит на «Подтвердите e-mail», после чего `/welcome` снова рисует лендинг; вошедший на `/welcome` по-прежнему
уходит на `/` гардом `!signedIn`; гард вкладок (`returning` → `/sign-in` раньше `resumeRegistration`) не тронут.
Новый тест честный (стартует с `/welcome` при живой регистрации, проверяет итоговый путь `/check-email`).
Правило `.claude/rules/pokatim-app.md` синхронизировано. Остальной diff `origin/develop...HEAD` с прохода 1 не менялся.
Прогон: `jest auth-guard landing check-email` → 3 suites, 41 passed.
NOT VERIFIED: web-смоук с API, iOS/Android вживую.

Findings: нет. MEDIUM прохода 1 закрыт; LOW (`initialDataUpdatedAt`) — принят автором как есть, не блокер.
