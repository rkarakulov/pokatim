# Findings — app-themes / slice B — pass 1 — reviewer: claude
base: ccad7ec   commits: ccad7ec..400bebc (b4aa61d … 400bebc, B1–B9)
verdict: REQUEST CHANGES (1 HIGH)

Проверено: `pnpm --filter @pokatim/app test` — 152 suites / 1299 tests, EXIT 0 (запуск ревьюера). `pnpm check`,
`build:web`, `e2e:web` ревьюером не запускались — NOT VERIFIED (отчёт coder в §12 Outcome).

Измерения без находок (проверено по коду):
- «Классика» визуально: `profile.*` = прежние `map.corridor` / `border.subtle` (neutral600/neutral100, neutral400/neutral750);
  `basemap` даёт тот же выбор URL, что `theme === themes.dark`; иконки — те же имена SF/Material, `going-stack` —
  `filled` (как прежний `person.fill`), `weight` не передаётся при `regular`; `StatusBar` `dark|light` по схеме = `auto`
  для системной темы; manifest `#FFFFFF`. Ожидания существующих тестов не менялись (удалены только 24 строки мока
  `useFonts`, отклонение задокументировано).
- Гидрация web: `+html` пишет `window.__POKATIM_THEME__` в `<head>` до бандлов; клиент — `toAppThemeId(window…)` =
  серверный `ssrThemeId()`; `useColorScheme` базы — серверный снимок `light`; `Font.isLoaded` на клиенте видит
  `@font-face` из `#expo-generated-fonts` (`ExpoFontLoader.web.js:147`) → первый рендер не `null`. Запрос темы на SSR не
  выполняется (данных нет до гидрации).
- Безопасность inline-скрипта: значение — `appThemes[ssrThemeId()].id`, `ssrThemeId` пишется только через
  `toAppThemeId` (zod enum) → литерал из закрытого списка, `JSON.stringify`; инъекция невозможна. Окно/кэш/ответ —
  только через `AppThemeId.safeParse`.
- Смена темы на лету: `AppThemeProvider` держит `applied`, пока `useThemeFonts(requested)` не `ready`; `ThemeProvider`
  базы получает семейства *применённой* темы (`setActiveFonts` в рендере) — текст не ссылается на незагруженные
  семейства; `key` нет — дерево не перемонтируется (тест с `useState`). `themeFonts` мемоизирован — зависимость
  эффекта стабильна.
- Кэш SecureStore: `readJson` глотает сбои/битое (удаляет) → `null` → «Классика»; сплэш не зависает при сбое
  хранилища. Ответ сервера пишется только при отличии; ошибка запроса сохраняет последнюю известную; `queryClient.clear()`
  при выходе тему не сбрасывает.
- Процессное состояние SSR: тема и шрифты — одна на процесс (R2 принят); `+html` и корень читают `ssrThemeId()` в одном
  проходе рендера.
- Хардкода цветов и сравнений `themes.dark` в `src` нет (сторож `theme-guards.test.ts`, честный grep по исходникам).
- Placement: `src/theme` не импортирует `features/*`; развилки — файлами `.web.ts`; `use-theme-fonts` по `window` —
  задокументированное отклонение, ветвь выбрана один раз на процесс (правила хуков не нарушаются).

### [HIGH] Middleware темы блокирует каждый GET и не ограничивает обращения к API при сбое
- **file:** apps/app/src/app/+middleware.ts, apps/app/src/features/appearance/ssr-theme.ts
- **location:** `+middleware.ts` `unstable_settings` / `middleware()`; `ssr-theme.ts` `refreshSsrTheme`
- **problem:** middleware без `patterns` выполняется на каждый GET веб-сервера (все HTML-страницы, `/_expo/loaders/*`,
  API-маршруты, 404 ботов) и `await`-ит `fetchPublicForSsr('/v1/appearance')`. Кэш `public-ssr.ts` хранит только
  `found` и `404`: «Сбои не кэшируются» (`unavailable` — сеть, таймаут, 429, 5xx, битый JSON). Значит при недоступном,
  медленном или ограничивающем по IP API каждый запрос к любой странице (включая `/sign-in`, `/`, manifest, которые
  раньше API не трогали) делает новый запрос к API и ждёт до `TIMEOUT_MS = 2_000`. Нет и single-flight: при истечении
  60 с все параллельные запросы одновременно уходят в API.
- **why_it_matters:** косметическая настройка становится точкой отказа всего web: при подвисшем API — +2 с к TTFB
  каждой страницы и каждого loader-а; при 429 `public-read` (лимит общий для IP web-сервера) — каждая страница
  добавляет запрос в уже исчерпанное окно, продлевая лимит и для SSR публичных экранов (гонки, маршруты — их мета
  становится «недоступно»). Противоречит §8.3 п.4 плана и ADR-0016 п.5 («SSR — ≤ 1 запрос к API в 60 с на процесс»).
- **evidence:** `expo-server/build/cjs/vendor/abstract.js:67-77` — middleware до матчинга маршрутов, `shouldRunMiddleware`
  без `patterns` → `true` для всех путей метода; `public-ssr.ts`: `if (!response.ok) return UNAVAILABLE;` и
  `catch { return UNAVAILABLE; }` без `remember(...)`, комментарий «Сбои не кэшируются»; `ssr-theme.ts:409-412` —
  каждый вызов идёт в `fetchPublicForSsr`. Тест `ssr-theme.test.ts` «API недоступен — последняя известная» мокает
  `fetchPublicForSsr` и не проверяет число обращений.
- **recommended_fix:** в `ssr-theme.ts` ограничить попытки независимо от исхода: хранить в том же `globalThis`-холдере
  время последней попытки и промис в полёте (single-flight); не обращаться к API чаще раза в 60 с (или с back-off после
  `unavailable`). Желательно не блокировать рендер: при известной теме обновлять в фоне (`void refresh()`), ждать —
  только самого первого обращения процесса (или вовсе не ждать: первая страница — «Классика», клиент догонит). Тест:
  N вызовов `refreshSsrTheme` при `unavailable` и при параллельном вызове → 1 обращение к `fetchPublicForSsr` за окно.

### [LOW] Нет теста на `initialThemeId` (web): разбор `window.__POKATIM_THEME__` и серверная ветка
- **file:** apps/app/src/features/appearance/initial-theme-id.web.ts
- **location:** `initialThemeId`
- **problem:** функция, на которой держится «гидрация без мигания» и п.2 security checklist (недоверенное значение
  `window` → только через `toAppThemeId`), не покрыта ни unit-, ни web-тестом; `use-active-theme-id.test.tsx` — только
  native (там `initialThemeId` всегда `null`). Есть только e2e-шаг с `classic`.
- **why_it_matters:** регрессия (например, прямое `window.__POKATIM_THEME__ as AppThemeId` или чтение до
  `typeof window`) не будет поймана jest; e2e не проверяет мусорное значение.
- **evidence:** `grep initialThemeId|initial-theme-id` по `*.test.*` — совпадений нет.
- **recommended_fix:** `initial-theme-id.web.test.ts` (web-проект): `'atlas'` → `atlas`, `'<script>'`/`undefined` →
  `classic`; серверная ветка — `*.server.test.ts` (без `window` → `ssrThemeId()`). Опционально — web-вариант
  `useActiveThemeId` (не `null` с первого рендера).

### [LOW] `useAppTheme` без провайдера выводит схему из `map.basemap`
- **file:** apps/app/src/theme/use-app-theme.ts
- **location:** строка `return { ...activeAppTheme(DEFAULT_THEME, colors.map.basemap), colors };`
- **problem:** `scheme` (светлая/тёмная схема UI) берётся из роли подложки карты — у «Классики» совпадает, но это две
  разные семантики; в слайсе C тема с тёмной подложкой при светлом UI (или наоборот) даст неверный `scheme` в фолбэке.
- **why_it_matters:** фолбэк используется тестами компонентов и любым потребителем вне корня; расхождение скрыто до C.
- **evidence:** `use-app-theme.ts:719`; `Basemap` в `brand.ts` описан как «подложка MapLibre», не схема.
- **recommended_fix:** в фолбэке брать `useColorScheme()` базы (как провайдер) и `appThemeScheme(DEFAULT_THEME, system)`;
  `colors` — `useTheme()` как сейчас.

NOT VERIFIED: `expo start --web` (middleware в dev, R1), native-симуляторы (сплэш, смена темы на лету), `E2E_API=1`.

# Findings — app-themes / slice B — pass 2 — reviewer: claude
base: ccad7ec   commits: ccad7ec..3b99634 (fix-коммиты 52528e0 … 3b99634; ab2b259 — план C, не ревьюился)
verdict: APPROVE

Проверено: `pnpm --filter @pokatim/app test` — 156 suites / 1325 tests, EXIT 0 (запуск ревьюера; предупреждение jest
«worker failed to exit gracefully» — не падение). `pnpm check`, `build:web`, `e2e:web` — NOT VERIFIED.

Закрытие прошлых находок (по коду):
- HIGH pass 1 (middleware без ограничения) — закрыта. `refreshSsrTheme`: single-flight (`inflight` в `globalThis`),
  окно 60 с от завершения попытки (`attemptAt` в `finally`) при любом исходе, включая reject (`.catch`) и `unavailable`;
  ждёт только первая попытка процесса (`settled`), дальше — фон; фоновый промис с `.catch` — unhandled rejection нет.
  Верхняя граница ожидания первой страницы — `AbortSignal.timeout(2 с)` (покрывает и чтение тела). Тесты: параллельные
  вызовы → 1 fetch; сбои подряд → 1 за окно; фон не блокирует; последняя известная при сбое.
- MEDIUM codex pass 2 (два окна) — закрыта: `cache: false` — тема не читает и не кладёт в кэш `public-ssr`;
  `ssr-theme-fetch.test.ts` на настоящем `fetchPublicForSsr` с задержкой ответа — смена видна ≤ 61 с, 2 fetch.
  Остальные вызовы (`rides|calendar|seasons|races|routes/[id].tsx`) передают 2 аргумента → `cache = true`, поведение
  прежнее; тест `public-ssr.test.ts` «cache: false — мимо кэша» + прежние тесты кэша зелёные.
- MEDIUM codex pass 2 (шрифты web ready до скачивания) — закрыта: `allLoaded` = `isLoaded && !isLoading`
  (`expo-font/build/Font.js:37` — `fontFamily in loadPromises`, удаляется в `finally` загрузки); гидрация SSR — без
  загрузки в полёте → готово с первого рендера. Тест «@font-face зарегистрирован, файл скачивается — не готов».
  MEDIUM codex pass 1 (возврат A→B→A) — закрыта, тест есть. Ветка ошибки: `isLoading` снимается в `finally`, состояние
  `{set, ready: true, error}` — тема не зависает.
- LOW (тест `initialThemeId`) — закрыта: `initial-theme-id.web.test.ts` (недоверенные значения → `classic`) и
  `.server.test.ts` (без `window` → `ssrThemeId()`).
- LOW (`useAppTheme` фолбэк по подложке) — закрыта: `appThemeScheme(DEFAULT_THEME, useColorScheme())`, тест с `dark`.

Регрессий не найдено: matcher `GET` + `SSR_THEME_PATHS` исключает manifest (`+api`), `sw.js`, иконки, ассеты; manifest
читает последнюю известную тему (на свежем процессе — «Классика», задокументировано).

### [LOW] Matcher не исключает loader-ы: expo-server проверяет и «эффективный» путь `/_expo/loaders/*`
- **file:** apps/app/src/features/appearance/ssr-theme.ts, apps/app/src/app/+middleware.ts, docs/adr/0016-app-themes.md
- **location:** `SSR_THEME_PATHS`, комментарии «не `/_expo/*`»; ADR-0016 п.5; тест «пути middleware темы»
- **problem:** `shouldRunMiddleware` при несовпадении сырого пути проверяет `effectivePathname` — для
  `/_expo/loaders/races/1` это `/races/1` («so matchers can't be bypassed via /_expo/loaders»), он совпадает с
  `SSR_THEME_PATHS`. Middleware темы выполняется и для loader-ов. Тест проверяет только regex по сырому пути, поэтому
  `'/_expo/loaders/races/1' — нет` зелёный, но не отражает реального поведения.
- **why_it_matters:** нагрузку не меняет (окно 60 с и single-flight общие; ждать может только первый запрос процесса,
  ≤ 2 с), но документация (ADR, комментарии) и тест утверждают неверное — следующий, кто будет полагаться на
  «loader-ы мимо middleware», ошибётся.
- **evidence:** `node_modules/expo-server/build/cjs/vendor/abstract.js:67-71` (`effectivePathname` = путь без
  `LOADER_PREFIX`), `build/cjs/utils/middleware.js` `shouldRunMiddleware`: `if (effectivePathname && effectivePathname
  !== rawPathname) return patterns.some(...)`.
- **recommended_fix:** либо принять и исправить формулировки (ADR п.5, комментарии `SSR_THEME_PATHS`/middleware: «loader-ы
  тоже, без ожидания после первой попытки») и тест на `shouldRunMiddleware` с реальной логикой; либо в `middleware(request)`
  ранний выход по `new URL(request.url).pathname.startsWith('/_expo/')`.

NOT VERIFIED: `expo start --web`/`start:web` с реальным middleware, native-симуляторы, `E2E_API=1`.
