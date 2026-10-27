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
