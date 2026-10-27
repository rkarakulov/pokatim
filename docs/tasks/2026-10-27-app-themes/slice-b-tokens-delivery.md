# Слайс B — реестр тем, «Классика», провайдер и доставка темы (native + web SSR)

Часть задачи `task.md` этой папки: раздел 3 «Слайс B» **плюс** app-часть «Слайса D» (бывший D2: `useAppearanceQuery`,
кэш native, SSR). Отдельный PR в `develop`, ветка `feature/app-themes-b` от `origin/develop`. Уровень — task3
(несколько пакетов, SSR, бамп базы).

**Предусловия (до старта coder):**

- **P0.** Слайс D1 смержен в `develop`: `APP_THEME_IDS`, `AppThemeId`, `DEFAULT_APP_THEME_ID`, `AppAppearance`
  (`packages/contracts/src/appearance/appearance.schema.ts`), `api.getAppearance()` (`packages/api-client/src/index.ts`).
- **P1.** В слайс A **до релиза** добавлен экспорт системной схемы из `@rkarakulov/ui`:
  `export { useColorScheme, type ColorScheme } from './theme/color-scheme';` (в `packages/ui/src/index.ts`, файлы
  `color-scheme.ts` / `color-scheme.web.ts` уже есть, нужен только экспорт + строка в changeset/README). Причина —
  8.1 F1. Если 0.5.0 уже опубликован без экспорта — патч 0.5.1 базы до B (иначе B блокирован).
- **P2.** `@rkarakulov/*@0.5.0` опубликован в GitHub Packages (R1 `task.md`).

## Architecture Review — app-themes / B

Status: **CONCERNS** — блокеров в коде нет; есть предусловие P1 (правка слайса A до релиза) и отклонения от
`task.md` (8.2): источник темы для SSR — `+middleware.ts` в серверном бандле, а не Express; группа `chart` — в C.

## 5. Architecture Context

- **Пакеты / приложения:** `packages/design-tokens` (реестр тем, роли `profile`, `map.basemap`, форма),
  `apps/app` (провайдер, иконки, шрифты, доставка, SSR), `pnpm-workspace.yaml` (каталог `@rkarakulov/*` → `0.5.0`).
  `apps/api`, `packages/contracts`, `packages/api-client`, `apps/admin` — **не меняются** (admin получает новый
  каталог базы и лишние CSS-переменные `--color-profile-*`, без визуальных изменений).
- **Слои в `apps/app`** (без циклов: `src/theme` не импортирует `features/*`):
  - `src/theme/` — чистая тема: `fonts.ts` (ассеты и семейства по темам), `use-theme-fonts(.web).ts` (загрузка
    шрифтов активной темы), `app-theme-provider.tsx` (`AppThemeProvider` → `ThemeProvider` базы + контекст pokatim),
    `use-app-theme.ts`, `document-theme.ts` (фон документа, `theme-color`, autofill для `+html` и manifest).
  - `src/features/appearance/` — доставка: `theme-id.ts` (разбор id), `appearance-query.ts`
    (`useAppearanceQuery`), `appearance-cache(.web).ts` (SecureStore / no-op), `ssr-theme.ts` (тема процесса SSR),
    `initial-theme-id(.web).ts`, `use-active-theme-id.ts` (склейка: кэш/SSR → запрос → id).
  - `src/components/icon.tsx` — продуктовая обёртка `SymbolView`.
  - `src/app/+middleware.ts` — серверный middleware Expo Router: перед рендером обновляет тему процесса.
  - `src/app/_layout.tsx` — `RootLayout` (только `QueryClientProvider`) → `RootShell` (нынешнее тело + тема).
- **Контракты:** не меняются. Потребляем `AppAppearance` (`themeId: tolerantEnum` → `'unknown'` у будущих тем) и
  `AppThemeId` для разбора id из кэша, `window` и ответа.
- **Данные / очереди / outbox:** нет.
- **Серверный авторитет:** тему выбирает только сервер (T1); клиент читает публичный GET, кэширует и падает в
  «Классику» на всё незнакомое. Кэш — только подсказка до ответа сервера.

### Как тема попадает в SSR (проверено по коду `node_modules`, expo-server 58.0.5, expo-router 58.0.24, expo-font 58.0.9)

- `createRequestHandler` (`expo-server/build/cjs/vendor/express.js`) **не имеет** `getLoadContext`/per-request
  контекста для рендера: параметры — только `beforeResponse`/`beforeHTMLResponse`/… (меняют заголовки ответа, не
  данные рендера). Серверные бандлы (`dist/server/**`) грузятся `require()` **в том же процессе**, но это отдельный
  граф модулей Metro: переменная модуля `server/web-server.ts` бандлу не видна, `globalThis` — виден (так делает сам
  expo-server: `Symbol.for('expoServerRuntime')` в `runtime/scope.js`).
- Per-request канал есть: `requestHeaders()` из `expo-server` (AsyncLocalStorage) работает и в рендере — Express мог
  бы проставлять заголовок. **Но** Express-процесс не может сделать сам запрос темы по правилам проекта: образ `web`
  (`infra/docker/Dockerfile`, стадия `build-web`) кладёт в рантайм только `express` и `expo-server` +
  `server/*.ts` — ни `zod`, ни `@pokatim/contracts`, ни `src/lib/public-ssr.ts` там нет, а `server/` не импортирует
  `src/` (Node strip-types, без алиасов). Копия fetch/таймаута/кэша/списка id в `server/` — дубль `public-ssr.ts` и
  второй список тем.
- **Решение (8.1 F2):** `src/app/+middleware.ts` (Expo Router middleware, SDK 58 — без флага; вызывается в
  `vendor/abstract.js` до рендера и API-маршрутов) внутри серверного бандла: `await refreshSsrTheme()` →
  `fetchPublicForSsr('/v1/appearance', AppAppearance)` (таймаут 2 с, кэш процесса 60 с — уже есть) → тема
  записывается в `globalThis[Symbol.for('pokatim.appTheme')]`. `+html.tsx`, корневой layout и
  `manifest.webmanifest+api.ts` читают её через `ssrThemeId()`. Тема глобальна (R2 `task.md`): одна на процесс, гонка
  при смене — максимум одна страница в прежней теме, после гидрации клиент догонит запросом.
- Шрифты на SSR: `useFonts` в expo-font на сервере = `useStaticFonts` → `loadAsync` → `addServerFont` в
  AsyncLocalStorage-контекст запроса (`serverContext.web.js`); expo-router выводит `<style id="expo-generated-fonts">`
  с `@font-face` и `<link rel="preload" as="font">` **только для зарегистрированных в этом рендере семейств**. Значит
  достаточно на сервере вызвать `Font.loadAsync(ассеты активной темы)` синхронно в рендере — в HTML попадут только её
  шрифты; при гидрации `Font.isLoaded` видит эти `@font-face` → первый клиентский рендер «готов», без мигания.
- **Важно:** клиентский `useFonts` (`useRuntimeFonts`) грузит карту **один раз** (`useEffect(..., [])`, в JSDoc: «fonts
  are not reloaded when you dynamically change the font map»). Для смены темы на лету нужен свой хук
  `useThemeFonts` с зависимостью от темы (8.1 F3).

## 5.1 Placement & Reuse Gate

**Переиспользуем (без копий):**

- База 0.5.0: `ThemeProvider` (`theme`, `fonts`), `useTheme`, `textStyle`, `fontFamilyFor`, `useColorScheme` (P1),
  `configureDesignSystem` (остаётся: фолбэк без провайдера = «Классика», тесты компонентов без корня);
  `@rkarakulov/design-tokens`: `ShapeRoles`, `defaultShape`, `shapeOf`, `Theme`, `FontStack`, `contrastPair`,
  `contrastPairs`, `designSystemCss`, `autofillCss`.
- `@pokatim/design-tokens`: нынешние `light`/`dark` — это и есть схемы «Классики» (те же объекты, см. 7).
- Контракты D1: `AppThemeId` (zod), `AppAppearance`, `DEFAULT_APP_THEME_ID`; api-client: `api.getAppearance()`.
- `src/lib/public-ssr.ts` — `fetchPublicForSsr` (таймаут, кэш 60 с, `unavailable`); свой `fetch` в middleware — нет.
- `src/features/auth/secure-storage.ts` (`secureStorage`, `SecureKey`) + `read-json.ts` (`readJson`) — кэш native,
  как `features/onboarding/device-flags.ts`.
- `src/lib/focus-manager.ts` (AppState) и встроенный `visibilitychange` TanStack — refetch при возврате (T2);
  `DEFAULT_STALE_MS` (`src/lib/query-client.ts`).
- `expo-font` (`loadAsync`, `isLoaded`), `expo-symbols` (`SymbolView`, `expo-symbols/androidWeights/*`).

**Новое (обосновано):**

- `packages/design-tokens/src/app-themes.ts` — реестр `appThemes` (≥2 потребителя: app; admin-превью в C/D2).
- `apps/app/src/components/icon.tsx` — продуктовая обёртка иконок (вес/заливка темы, реестр имён); общий компонент
  базы не нужен (expo-symbols — зависимость приложения, у базы нет).
- `apps/app/src/theme/use-theme-fonts(.web).ts` — `useFonts` expo-font не перезагружает карту (5, F3).
- `apps/app/src/app/+middleware.ts` + `features/appearance/ssr-theme.ts` — канал темы в SSR (F2).

**Запрещено:**

- Второй список id тем в `apps/app`: источник — `APP_THEME_IDS` контрактов; `design-tokens` объявляет тот же состав
  (тип `AppThemeId` + ключи реестра), равенство сторожит тест в app (F6 D1).
- `@pokatim/contracts` в зависимостях `@pokatim/design-tokens` (палитра не знает о транспорте).
- Свой `fetch`/кэш темы в `server/web-server.ts`; правка Dockerfile ради зависимостей в рантайме web.
- Копия `useColorScheme` в проекте (есть в базе — P1); копия `useFonts` целиком (свой хук — только загрузка по смене
  темы поверх `loadAsync`/`isLoaded`).
- `theme === themes.dark` / `themes.light|dark` в production-коде `apps/app/src` (кроме `+html`/manifest через
  `document-theme.ts`, которые берут активную тему из реестра). Hex, имена шрифтов, `Platform.OS` в экранах.
- `designSystemCss` для тем приложения (потребителя нет — 8.1 F5); тема `panel` — без изменений значений.

## 6. Relevant Files

| Путь | Роль |
|---|---|
| `packages/design-tokens/src/{brand.ts,contrast.ts,css.ts,index.ts,design-tokens.test.ts}` | палитра, контраст, CSS, экспорт |
| `apps/app/src/theme/{design-system.ts,fonts.ts,fonts.test.ts}` | настройка базы, шрифты |
| `apps/app/src/app/{_layout.tsx,+html.tsx,manifest.webmanifest+api.ts}` | корень, документ, manifest |
| `apps/app/src/features/maps/{use-map-style.ts,attribution.web.ts,map-style.ts,map-controls.tsx}` | `theme === themes.dark`, иконки карты |
| `apps/app/src/features/races/race-route-map.tsx` | `theme === themes.dark` |
| `apps/app/src/features/routes/{profile-chart.tsx,profile-chart.web.tsx,profile-style.ts,elevation-profile.tsx}` | профиль высоты |
| `apps/app/src/components/{top-bar.tsx,going-stack.tsx}` | `SymbolView` |
| `apps/app/src/lib/{public-ssr.ts,query-client.ts,focus-manager.ts}` | SSR-чтение, запросы, фокус |
| `apps/app/src/features/auth/{secure-storage.ts,read-json.ts}`, `features/onboarding/device-flags.ts` | кэш native (образец) |
| `apps/app/src/__tests__/{root-layout.test.tsx,app-routes.ts,tabs.test.tsx,design-system-setup.test.ts}` | тесты корня |
| `apps/app/server/{main.ts,web-server.ts}`, `infra/docker/Dockerfile` (стадии `build-web`, `web`) | почему не Express (5) |
| `apps/app/e2e/web.spec.ts` (PWA: `theme_color: '#FFFFFF'`) | смоук |
| `node_modules/expo-server/build/cjs/{vendor/express.js,vendor/abstract.js,runtime/scope.js}` | middleware, scope |
| `node_modules/expo-font/build/{FontHooks.js,ExpoFontLoader.web.js,serverContext.web.js}` | шрифты SSR/клиент |
| `node_modules/expo-symbols/build/{SymbolView.js,utils.js,SymbolModule.types.d.ts}` | вес иконок Android/web |
| `/Users/romankarakulov/PROJECTS/app-foundation-wt-themes/packages/{ui/src/theme/*,design-tokens/src/{themes,css}.ts}` | API слайса A |
| `pnpm-workspace.yaml` (каталог `@rkarakulov/*`) | бамп до 0.5.0 |

## 7. Implementation Notes

### 7.1 `@pokatim/design-tokens`

**Группы ролей (`brand.ts`)** — дополнить `PokatimRoleGroups`:

```ts
export type Basemap = 'light' | 'dark';

export interface PokatimRoleGroups {
  map: {
    /** подложка MapLibre для схемы: URL — EXPO_PUBLIC_MAP_STYLE_LIGHT/DARK (ADR-0014). Не цвет: в CSS не выводится */
    basemap: Basemap;
    background: string; line: string; route: string; corridor: string; track: string; offCorridor: string;
  };
  surfaceBar: { asphalt: string; gravel: string; gravelHatch: string; outline: string };
  /** профиль высоты (routes-03/04): линия, градиент заливки (прозрачность — PROFILE_FILL_OPACITY), базовая линия */
  profile: { line: string; fillTop: string; fillBottom: string; grid: string };
}

/** Разрешённая схема темы приложения: роли базы + группы pokatim + форма. `useTheme<AppTheme>()`. */
export type AppTheme = Theme<PokatimRoleGroups> & { shape: ShapeRoles };
```

- `light`/`dark` (они же схемы «Классики») объявить как `AppTheme` и дополнить **без смены существующих значений**:
  `map.basemap` (`'light'`/`'dark'`); `profile` — `line = fillTop = fillBottom = <нынешний map.corridor>`
  (`neutral600` / `neutral400`), `grid = <border.subtle>` (`neutral100` / `neutral750`); `shape: defaultShape`.
  `themes = defineThemes({ light, dark, panel: { ...light, nav: panelNav } })` — как сейчас. Итог: `themes.light`
  остаётся тем же объектом, что `appThemes.classic.schemes.light` → 22 теста, которые передают `themes.light|dark`
  пропом или сравнивают значения, проходят без правки.
- `AppTheme` в `index.ts` — заменить нынешнее `ThemeOf<typeof themes>` на тип выше (совместим: `themes.light` им и
  является). `Theme` (любой набор) — без изменений.

**Реестр (`app-themes.ts`, новый):**

```ts
/** Темы приложения. Тот же состав и порядок, что APP_THEME_IDS (@pokatim/contracts) — сторож в apps/app. */
export type AppThemeId = 'classic' | 'atlas' | 'chrono' | 'planner' | 'journal' | 'navigation' | 'typography';
export type AppColorScheme = 'system' | 'dark';
export type AppDensity = 'regular' | 'comfortable';
export type IconWeight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';

/** Гарнитуры темы: семейства ролей (файлы — apps/app/src/theme/fonts.ts) и CSS-стек веба. */
export interface AppThemeFonts { display: string; text: string; stack: FontStack }

/** Варианты раскладки (слайс C расширяет объединения; у «Классики» — нынешние). */
export interface AppThemeLayout {
  home: 'classic'; routeStats: 'classic'; profileFill: 'gradient'; tabBar: 'classic'; routeCard: 'classic';
}

export interface AppThemeDefinition {
  id: AppThemeId;
  /** 'system' — пара по системе; 'dark' — всегда тёмная (у таких schemes.light === schemes.dark) */
  colorScheme: AppColorScheme;
  schemes: { light: AppTheme; dark: AppTheme };
  fonts: AppThemeFonts;
  density: AppDensity;
  icons: { weight: IconWeight; filled: boolean };
  layout: AppThemeLayout;
}

export const appThemes: Readonly<Record<AppThemeId, AppThemeDefinition>>;
export const DEFAULT_THEME: AppThemeDefinition; // appThemes.classic
/** Схема темы: 'dark' — всегда тёмная, иначе — системная. */
export function appThemeScheme(def: AppThemeDefinition, system: 'light' | 'dark'): 'light' | 'dark';
```

- Форма темы живёт **в каждой схеме** (`AppTheme.shape`) — так её видит `shapeOf(useTheme())` базы; отдельного
  `def.shape` нет (один источник). Хелпер `defineAppTheme(input)` внутри файла собирает определение и проверяет
  инвариант `colorScheme === 'dark' ⇒ schemes.light === schemes.dark` (бросает при сборке модуля).
- `classic`: `schemes: { light: themes.light, dark: themes.dark }`, `colorScheme: 'system'`, `fonts: { display: font.display,
  text: font.text, stack: fontStack }`, `density: 'regular'`, `icons: { weight: 'regular', filled: false }`,
  `layout` — значения выше.
- Остальные шесть — `{ ...classic, id }` с комментарием `// TODO(app-themes C): палитра, шрифты, форма, раскладка`.
  Порядок ключей = `APP_THEME_IDS`.
- `contrast.ts`: `contrastPairsOf(theme: Theme<PokatimRoleGroups>)` (тело нынешней функции + пара
  `profile.line / surface.default`, `WCAG.ui`); `contrastPairs(name: ThemeName)` = `contrastPairsOf(themes[name])`
  (сигнатура сохраняется). Экспорт `contrastPairsOf`.
- `css.ts`: `designSystemCss` остаётся для `ThemeName`; перед вызовом базы из тем убирается `map.basemap` (не цвет,
  `--color-map-basemap` в CSS не нужен). `profile` попадает в CSS как `--color-profile-*` (безвредно для панели).
- `index.ts`: экспорт `appThemes`, `DEFAULT_THEME`, `appThemeScheme`, `contrastPairsOf`, типов `AppThemeId`,
  `AppThemeDefinition`, `AppThemeFonts`, `AppThemeLayout`, `AppColorScheme`, `AppDensity`, `IconWeight`, `Basemap`,
  `AppTheme`; реэкспорт `defaultShape`, `shapeOf`, `type ShapeRoles` из базы.

### 7.2 `apps/app` — тема

- **`theme/fonts.ts`:** `fontAssets` (как сейчас, все файлы всех гарнитур — native бандлит всё, R3) +
  ```ts
  type FontFamily = keyof typeof fontAssets;
  export interface ThemeFontSet { families: { [R in FontRole]: Record<FontWeight<R>, FontFamily> };
                                  assets: Partial<Record<FontFamily, FontSource>> }
  /** Гарнитура (`AppThemeFonts.display|text`) → семейства по весам. */
  const FACES: Record<string, { display?: ...; text?: ... }>;
  export function themeFonts(def: AppThemeDefinition): ThemeFontSet; // мемо по def.id
  export const fontFamilies = themeFonts(appThemes.classic).families; // для configureDesignSystem
  ```
  Неизвестная гарнитура в `def.fonts` — ошибка при сборке модуля (тест полноты ловит раньше).
- **`theme/use-theme-fonts.ts`** (native + клиент web) и **`.web.ts`** (сервер + клиент):
  `useThemeFonts(set: ThemeFontSet): { ready: boolean; error: Error | null }`.
  Клиент: `useState(() => keys(set.assets).every(Font.isLoaded))`; `useEffect([set])` → `Font.loadAsync(set.assets)`
  → `ready`; ошибка — `ready` тоже `true` + `error` (как сейчас: системные шрифты, `console.warn` в корне).
  Web-сервер (`typeof window === 'undefined'` внутри `.web.ts`): `Font.loadAsync(set.assets)` синхронно в рендере
  (регистрирует `@font-face` активной темы), `ready: true`.
- **`theme/app-theme-provider.tsx`:**
  ```ts
  export interface ActiveAppTheme {
    id: AppThemeId; scheme: 'light' | 'dark'; colors: AppTheme;
    icons: AppThemeDefinition['icons']; layout: AppThemeLayout; density: AppDensity;
  }
  export function AppThemeProvider(props: { themeId: AppThemeId; children: ReactNode;
                                            onFontError?: (e: Error) => void }): JSX.Element | null;
  ```
  - `requested = appThemes[themeId]`; `applied` — `useState` с последней темой, чьи шрифты готовы; пока шрифты
    `requested` грузятся — рисуется `applied` (смена «после загрузки её шрифтов»). Пока нет ни одной готовой (первый
    запуск) — `null` (корень держит сплэш).
  - `scheme = appThemeScheme(applied, useColorScheme())` (`useColorScheme` базы — P1: на web серверный снимок
    `light`, гидрация без расхождения); `colors = applied.schemes[scheme]`.
  - Рендер: `<ThemeProvider theme={colors} fonts={fontSet.families}>` + `AppThemeContext.Provider` (значение —
    `useMemo`). Дерево детей не пересоздаётся (без `key`), смена — перерисовка потребителей (A).
- **`theme/use-app-theme.ts`:** `useAppTheme(): ActiveAppTheme` — контекст; без провайдера (тесты компонентов) —
  «Классика» + `useTheme<AppTheme>()` + схема по `colors.map.basemap`.
- **`theme/document-theme.ts`** (чистые функции, только сервер): `documentCss(def)` — фон `html, body` из
  `surface.default` (system: светлая + `@media (prefers-color-scheme: dark)`; dark: одна тёмная) + `autofillCss`
  (с `darkTheme` только у system); `themeColors(def): { media?: string; color: string }[]`; `manifestColor(def)`
  (`schemes[colorScheme === 'dark' ? 'dark' : 'light'].surface.default`).
- **`theme/design-system.ts`:** без изменений по смыслу (`configureDesignSystem({ themes, fonts: fontFamilies, i18n })`).

### 7.3 `apps/app` — доставка

- **`features/appearance/theme-id.ts`:** `toAppThemeId(value: unknown): AppThemeId` —
  `AppThemeId.safeParse` (контракты) → id, иначе `DEFAULT_APP_THEME_ID` (`'unknown'`, мусор, `undefined`).
- **`appearance-query.ts`:** `appearanceKeys = { current: ['appearance'] as const }`;
  `useAppearanceQuery()` → `useQuery({ queryKey, queryFn: async () => toAppThemeId((await api.getAppearance())?.themeId) })`.
  Данные запроса — уже `AppThemeId` (автомок `api` в тестах даёт `undefined` → `classic` без ошибок TanStack).
  `staleTime` — дефолт `DEFAULT_STALE_MS`; refetch при фокусе/`AppState` — дефолт клиента. Ошибка — без UI.
- **`appearance-cache.ts`** (native): `readCachedThemeId(): Promise<AppThemeId | null>` (`readJson('pokatim.appTheme',
  v => AppThemeId.safeParse(v).data)`), `saveCachedThemeId(id)` (`console.warn` только с именем ошибки).
  `SecureKey` + `'pokatim.appTheme'`. **`.web.ts`** — `null` / no-op (на web источник — SSR).
- **`ssr-theme.ts`:**
  ```ts
  const KEY = Symbol.for('pokatim.appTheme'); // общий для бандлов рендера, middleware и API-маршрутов процесса
  export function ssrThemeId(): AppThemeId;           // нет значения — DEFAULT_APP_THEME_ID
  export async function refreshSsrTheme(): Promise<void>; // fetchPublicForSsr('/v1/appearance', AppAppearance):
                                                          // found → toAppThemeId; иначе — значение не трогаем
  ```
  JSDoc: тема глобальна, исключение из «сторов не на уровне модуля» по тем же причинам, что кэш `public-ssr.ts`.
- **`initial-theme-id.ts`** (native) → `null` (неизвестно до чтения кэша); **`.web.ts`** → сервер: `ssrThemeId()`,
  клиент: `toAppThemeId(window.__POKATIM_THEME__)` (тип — `src/types/window.d.ts`).
- **`use-active-theme-id.ts`:** `useActiveThemeId(): AppThemeId | null` — `useState(initialThemeId)`; эффект: native
  `readCachedThemeId()` → id ?? `classic` (только если ещё `null`); данные запроса → `setId` + `saveCachedThemeId`
  (native, только при отличии). Ошибка запроса — остаётся текущая.
- **`src/app/+middleware.ts`:**
  ```ts
  export const unstable_settings: MiddlewareSettings = { matcher: { methods: ['GET'] } };
  export default async function middleware(): Promise<void> { await refreshSsrTheme(); }
  ```
  Ответов не возвращает, запрос не читает. Статика `/_expo/static` сюда не доходит (Express отдаёт раньше).

### 7.4 `apps/app` — корень и документ

- **`_layout.tsx`:** первый импорт — `'@/theme/design-system'` (сторож `design-system-setup.test.ts`).
  `RootLayout` → `<QueryClientProvider client={queryClient}><RootShell /></QueryClientProvider>`. `RootShell` —
  нынешнее тело (эффекты сессии/онбординга/возврата **без изменений и без задержки**: они не ждут шрифтов, как сейчас) +
  `const themeId = useActiveThemeId()`; `useFonts(fontAssets)` удаляется. Пока `themeId === null` — `null`.
  Разметка: `<AppThemeProvider themeId={themeId} onFontError={warn}>` → `ThemedRoot` (читает `useAppTheme()`:
  фон `GestureRoot`/`contentStyle` — `colors.surface.default`; `StatusBar style` — `scheme === 'dark' ? 'light' : 'dark'`
  — для «Классики» эквивалентно `auto`) → нынешний `Stack`. Сплэш скрывается эффектом в `ThemedRoot` при
  `hydrated` (рендерится только после готовности темы и шрифтов) — условие «шрифты + сессия» сохраняется, добавляется
  «кэш темы прочитан».
- **`+html.tsx`:** `const def = appThemes[ssrThemeId()]`; `<style>` — `documentCss(def)`; `theme-color` — по
  `themeColors(def)`; в `<head>` до `headNodes`:
  `<script dangerouslySetInnerHTML={{ __html: \`window.__POKATIM_THEME__=${JSON.stringify(def.id)}\` }} />`
  (значение — только из закрытого списка). `htmlAttributes` — как есть.
- **`manifest.webmanifest+api.ts`:** `manifestColor(appThemes[ssrThemeId()])` (у «Классики» — `#FFFFFF`, e2e PWA прежний).

### 7.5 `apps/app` — карта, профиль, иконки

- `use-map-style.ts`, `race-route-map.tsx`: `mapStyleUrl(theme.map.basemap === 'dark')`; импорт `themes` удалить.
  `attribution.web.ts`: `const dark = theme.map.basemap === 'dark'`. `map-style.ts` и его тест — без изменений.
- Профиль: `profile-chart.tsx` / `.web.tsx` — `theme.map.corridor` → `theme.profile.line` (кромка),
  `profile.fillTop`/`profile.fillBottom` (стопы градиента, прозрачности — прежние константы `profile-style.ts`),
  фолбэк-столбики — `profile.fillTop`; нижняя линия графика `border.subtle` → `profile.grid`. Значения «Классики»
  совпадают → `elevation-profile.test.tsx`, `profile-chart.web.test.tsx` без правки.
- **`components/icon.tsx`:**
  ```ts
  const ICONS = {
    watch: { ios: 'applewatch', material: 'watch' },
    profile: { ios: 'person.crop.circle', iosFilled: 'person.crop.circle.fill', material: 'account_circle' },
    person: { ios: 'person', iosFilled: 'person.fill', material: 'person' },
    zoomIn: { ios: 'plus', material: 'add' }, zoomOut: { ios: 'minus', material: 'remove' },
    fit: { ios: 'arrow.up.left.and.arrow.down.right', material: 'fit_screen' },
    locate: { ios: 'location', iosFilled: 'location.fill', material: 'my_location' },
  } as const satisfies Record<string, { ios: SFSymbol; iosFilled?: SFSymbol; material: AndroidSymbol }>;
  export type IconName = keyof typeof ICONS;
  export interface IconProps { name: IconName; size: number; color: string; filled?: boolean; testID?: string }
  ```
  `filled = props.filled ?? useAppTheme().icons.filled`; iOS — `iosFilled ?? ios`; Android/web — Material Symbols
  без заливки (статичные шрифты expo-symbols заливки не умеют — R4, задокументировать). Вес: `'regular'` → проп
  `weight` **не передаётся** (как сейчас — пиксель в пиксель); иной вес — `{ ios, android: WEIGHT_FONTS[w] }`, где
  `WEIGHT_FONTS` импортирует `expo-symbols/androidWeights/<w>` только для весов, реально используемых в
  `appThemes` (в B — пусто). `SymbolView` получает `key={weight}`: его загрузка шрифта — `useEffect([])`, без ремонта
  новый вес на Android/web не загрузится. Замены: `top-bar.tsx` (`watch`, `profile`), `going-stack.tsx`
  (`person`, `filled` — явно `true`, как сейчас), `map-controls.tsx` (`zoomIn`, `zoomOut`, `fit`, `locate`;
  поле `icon: IconName`). После — `expo-symbols` импортирует только `icon.tsx` (ESLint `no-restricted-imports` для
  `expo-symbols` вне него — по желанию, иначе сторож-тест grep).

### 7.6 Каталог базы

- `pnpm-workspace.yaml`: все `@rkarakulov/*` → `0.5.0` (группа fixed) → `pnpm install` → lockfile. Проверить, что
  admin и app собираются, а снимки ui/admin не меняются (у `panel` форма по умолчанию; новые CSS-переменные формы —
  только добавление).

### 7.7 Порядок работ (подзадачи coder, TDD)

1. **B0 — спайк (без кода в PR):** `pnpm --filter @pokatim/app build:web:dev`; убедиться, что
   `dist-dev/server/**` содержит бандл `+middleware`; временный `console.log(ssrThemeId())` в `+html` при
   `start:web` с `API_INTERNAL_URL` → видна тема из API. Проверить `expo start --web`: middleware исполняется в dev
   (если нет — R5, фиксируем в pr.md). Результат — строка в pr.md.
2. **B1 — каталог 0.5.0** (7.6) + `pnpm check` зелёный без других правок.
3. **B2 — design-tokens** (7.1): тесты → роли `profile`/`basemap`/`shape` в `light`/`dark` → `app-themes.ts` →
   контраст/CSS. Снимки старых тестов не трогать.
4. **B3 — app: карта и профиль на ролях** (7.5 без иконок): `themes.dark` → `basemap`, профиль → `profile`.
5. **B4 — app: `Icon`** и замена трёх потребителей `SymbolView`.
6. **B5 — app: шрифты по темам** (`fonts.ts`, `use-theme-fonts(.web).ts`) + тест полноты для 7 тем.
7. **B6 — app: `AppThemeProvider`, `useAppTheme`** + тест «смена без потери экрана».
8. **B7 — app: доставка** (`theme-id`, `appearance-query`, `appearance-cache(.web)`, `initial-theme-id(.web)`,
   `use-active-theme-id`) + корень `_layout.tsx` (RootShell, сплэш) + правка мока `expo-font` в `root-layout.test.tsx`.
9. **B8 — web SSR:** `ssr-theme.ts`, `+middleware.ts`, `document-theme.ts`, `+html.tsx`, manifest, `window.d.ts`;
   e2e-проверки.
10. **B9 — документация** (раздел 10), `TURBO_CONCURRENCY=1 pnpm check`, `build:web`, `e2e:web`.

## 8. Risks / Assumptions

- R1. Middleware Expo Router в dev (`expo start`) может не исполняться так же, как в `start:web` — тогда в dev SSR
  всегда «Классика», клиент переключится после запроса (мигание только в dev). Проверка — B0.
- R2. `globalThis`-тема процесса: при нескольких процессах web (масштабирование) — у каждого свой кэш 60 с; темы
  сходятся за ≤ 60 с. Принято (T2).
- R3. `useColorScheme` базы на web: SSR — светлая; для тем `system` поведение как сейчас (фон документа по media).
  Тёмные темы (`dark`) — SSR сразу тёмный.
- R4. Иконки: заливка на Android/web недоступна (статичные Material Symbols); вес на Android/web — +1 файл шрифта
  на каждый используемый вес (~ сотни КБ). В B вес один (`regular`), новых файлов нет.
- R5. Native-сплэш и `userInterfaceStyle` из `app.json` — по системе и цветам «Классики»: у тёмной темы при светлой
  системе нативные пикеры/сплэш светлые. Вне B (C решает, нужен ли `expo-system-ui`).
- R6. Шрифты native: смена темы — `loadAsync` новых файлов (из бандла, мгновенно); web — сеть: до загрузки
  остаётся прежняя тема (T2 допускает задержку).
- A1. D1 даёт `AppAppearance` ровно `{ themeId }` и `Cache-Control: max-age=60`.
- A2. В B все 7 тем визуально = «Классика»; выбор в админке до C не виден в приложении (кроме id в `__POKATIM_THEME__`).

## 8.1 Requirements Consistency

- **F1. Пробел базы:** провайдеру проекта нужна системная схема, а `@rkarakulov/ui` её не экспортирует (`useTheme`
  без провайдера считает её внутри). Альтернативы: (a) **экспорт `useColorScheme` из базы в слайсе A до релиза**
  (P1); (b) `useColorScheme` из `react-native` — на web ломает гидрацию (база документирует это в
  `color-scheme.web.ts`); (c) копия хука в проекте — запрещённый дубль. **Рекомендация — (a).**
- **F2. Конфликт spec ↔ код/инфраструктура:** «Express middleware до render получает тему (`fetchPublicForSsr`)».
  `fetchPublicForSsr` живёт в бандле, Express-процесс его не импортирует, а образ `web` не содержит `zod`/контрактов;
  per-request контекста рендера у `createRequestHandler` нет. Альтернативы: (a) **`src/app/+middleware.ts` в бандле +
  `globalThis`** — переиспользует `public-ssr.ts` и контракты, работает и в `dev` (R1); (b) Express: свой `fetch` +
  заголовок `x-pokatim-theme` → `requestHeaders()` в рендере — per-request, но дубль fetch/таймаута/кэша, список id
  или «доверенная строка» в `server/`, правка рантайма; (c) Express пишет `globalThis` — те же дубли, что (b).
  **Рекомендация — (a).** Отклонение — в 8.2.
- **F3. Недоопределено:** «`useFonts` только активной темы» + «смена без перезапуска» несовместимы с `useFonts`
  expo-font (карта читается один раз). **Решение:** свой `useThemeFonts` поверх `loadAsync`/`isLoaded`
  (7.2); `useFonts` в приложении больше не используется.
- **F4. Недоопределено:** группа ролей `chart` в B без потребителя (в приложении нет графиков, кроме профиля).
  Альтернативы: (a) **перенести `chart` в C вместе с вариантом раскладки, который её рисует**; (b) объявить сейчас с
  догадкой о составе — «на вырост» (§4.9), переделка в C. **Рекомендация — (a).** Отклонение — в 8.2.
- **F5. Лишнее:** «`designSystemCss` для всех тем» — у тем приложения нет CSS-потребителя (RN web — инлайн-стили;
  документу нужны только фон, `theme-color`, autofill — `document-theme.ts`). **Решение:** контраст — для всех
  7 × 2 схем; `designSystemCss` — только `ThemeName` (`panel` для админки). Превью админки (D2/C) — `previewOf(def)`.
- **F6. Место `basemap`:** spec — `theme.map.basemap`. Значение не цвет, а группа `map` уходит в CSS панели.
  **Решение:** поле в `map` схемы (тесты/пропсы карты не меняются), `designSystemCss` вырезает его (7.1).
- **F7. Форма темы:** spec — `shape` отдельным полем определения; база читает форму из объекта темы
  (`shapeOf(useTheme())`). **Решение:** форма — в каждой схеме (`AppTheme.shape`), без дубля в определении.
- **F8. Превью админки:** D1 оставил шов `theme-previews.ts` до «D2». В B реестр есть, но 6 тем — алиасы «Классики»
  → превью стали бы одинаковыми. **Решение:** подключение превью к реестру — в C (вместе с палитрами).

## 8.2 Deviations from spec

| Отклонение | Причина | Где |
|---|---|---|
| Источник темы SSR — `+middleware.ts` (бандл) + `globalThis`, не Express | F2 | 5, 7.3 |
| Группа `chart` — в C | F4 | 8.1 |
| `designSystemCss` тем приложения не делаем; контраст — для всех | F5 | 7.1 |
| `shape` — внутри схем, не поле определения | F7 | 7.1 |
| Превью админки на реестре — в C | F8 | 8.1 |
| Слайс D2 (app/SSR) влит в B | решение оркестратора | шапка |
| Предусловие: экспорт `useColorScheme` в базе 0.5.0 | F1 | P1 |

## 8.3 Security checklist

Затронуто: публичное чтение без входа (SSR и клиент), web-сервер (SSR, inline-скрипт), хранилище устройства.

1. **AuthN/AuthZ:** тема — публичная глобальная настройка; запросы без сессии (`getPublic`, SSR — `fetchPublicForSsr`
   без cookie). Ничего персонального.
2. **Входные данные:** id из ответа, SecureStore и `window` — только через `AppThemeId.safeParse` → иначе `classic`;
   в `+html` попадает `JSON.stringify` значения из закрытого enum (XSS невозможна). Middleware не читает запрос.
3. **Данные наружу:** `window.__POKATIM_THEME__` — только id темы.
4. **Злоупотребления:** SSR — ≤ 1 запрос к API в 60 с на процесс (кэш `public-ssr`); клиент — refetch по фокусу
   с `staleTime` 10 с + `max-age=60` HTTP-кэш; IP-лимит `public-read` API.
5. **Секреты и логи:** нет; сбой SecureStore — `console.warn` только с именем ошибки; middleware не логирует URL.
6. **CSP:** `script-src` не задан (`server/web-server.ts`) — inline-скрипт допустим; если CSP ужесточат —
   скрипт темы учесть (строка в правиле web).

## 9. Acceptance Criteria (B)

1. `@pokatim/design-tokens`: `appThemes` — 7 тем одной формы, порядок = `APP_THEME_IDS`; `classic.schemes.light ===
   themes.light`, `.dark === themes.dark`; у тем `colorScheme: 'dark'` схемы совпадают; контраст WCAG — для всех
   7 × 2 схем (включая `profile.line`); у каждой темы гарнитуры разрешаются в подключённые файлы (`fonts.test.ts`).
2. «Классика» визуально не меняется: все существующие тесты app/admin/design-tokens зелёные **без правки ожиданий и
   снимков** (допустима только правка мока `expo-font` в `root-layout.test.tsx`); e2e PWA — `theme_color: '#FFFFFF'`.
3. В `apps/app/src` (кроме тестов): нет `themes.dark`/`themes.light`, нет `=== themes.`, нет `SymbolView` вне
   `components/icon.tsx`, нет `useFonts`; цвета профиля — `theme.profile.*`, подложка карты — `theme.map.basemap`.
4. Смена `themeId` у `AppThemeProvider` перерисовывает экран в новой теме без перемонтирования (состояние
   `useState` ребёнка сохраняется); до загрузки шрифтов новой темы остаётся прежняя (тест).
5. native: при запуске тема из SecureStore (`pokatim.appTheme`) до ответа сервера; сплэш скрыт только после
   чтения кэша, шрифтов темы и сессии; ответ сервера с другой темой — применяется и кэшируется; `'unknown'`,
   битый кэш, сеть — «Классика».
6. web SSR: HTML содержит `window.__POKATIM_THEME__="<id>"` активной темы процесса, `theme-color` и фон документа
   из неё, `@font-face` только её гарнитур; без API — `classic`; после ошибки API — последняя известная. Гидрация без
   ошибок консоли (фикстура `console-errors`).
7. Возврат в приложение (AppState active / фокус вкладки) перезапрашивает `GET /v1/appearance` (старше 10 с).
8. Тёмная тема (`colorScheme: 'dark'`) в провайдере даёт тёмную схему при светлой системе (тест на фикстуре
   определения — в B реальных тёмных тем нет).
9. `TURBO_CONCURRENCY=1 pnpm check`, `pnpm build:web`, `pnpm e2e:web` — зелёные; каталог `@rkarakulov/*` — 0.5.0.

## 9.1 Test matrix

| Уровень | Файл | Что проверяет |
|---|---|---|
| tokens unit | `packages/design-tokens/src/app-themes.test.ts` | 7 ключей в порядке; одинаковая форма (ключи групп ролей у всех схем); classic = `themes.light/dark` (идентичность); `dark` ⇒ схемы совпадают; `appThemeScheme`; у `classic` `shape === defaultShape`, `basemap` по схеме, `profile` = прежние цвета |
| tokens unit | `design-tokens.test.ts` (дополнить) | контраст — цикл по `appThemes` × схемы (`contrastPairsOf`); пара `profile.line`; `designSystemCss({ theme: 'panel' })` без `--color-map-basemap`, с `--color-profile-line`; старые проверки — без изменений |
| app unit | `src/theme/app-theme-ids.test.ts` | `Object.keys(appThemes)` = `[...APP_THEME_IDS]` (порядок) + type-level равенство `AppThemeId` контрактов и токенов |
| app unit | `src/theme/fonts.test.ts` (дополнить) | для каждой темы: `themeFonts(def).families` ⊂ ключей `fontAssets`, `assets` содержит ровно их; `textStyle` под `ThemeProvider` с семьями темы разрешается в подключённый файл |
| app unit | `src/theme/use-theme-fonts.test.tsx`, `.web.test.tsx` | загрузка при смене набора; уже загруженные — `ready` сразу; ошибка → `ready` + `error`; web-сервер (`renderToString`) — `loadAsync` вызван синхронно |
| app component | `src/theme/app-theme-provider.test.tsx` | смена `themeId` (фикстура со своими цветами через `jest.mock` реестра) — цвет потребителя меняется, `useState` ребёнка сохранён; ожидание шрифтов — прежняя тема; `colorScheme: 'dark'` при светлой системе; `useAppTheme` без провайдера — classic |
| app unit | `features/appearance/theme-id.test.ts` | 7 id; `'unknown'`, мусор, `undefined` → `classic` |
| app unit | `features/appearance/appearance-cache.test.ts` | чтение/запись `pokatim.appTheme`; битое значение удаляется; сбой записи — `warn` с именем |
| app unit | `features/appearance/ssr-theme.test.ts` | `ssrThemeId()` по умолчанию `classic`; `found` → новая; `unavailable` → прежняя; `'unknown'` → `classic`; ключ — `Symbol.for` (видим через `globalThis`) |
| app component | `features/appearance/use-active-theme-id.test.tsx` | native: кэш → id до ответа; ответ ≠ кэш → смена + запись; ошибка запроса — кэш; без кэша — `classic`; refetch при `focusManager.setFocused(true)` |
| app component | `src/__tests__/root-layout.test.tsx` (мок `expo-font`: `loadAsync`, `isLoaded`) | прежние кейсы сплэша + «кэш темы не прочитан — сплэш держится» |
| app unit | `src/theme/document-theme.test.ts` | classic: фон `#FFFFFF` + media `#0E0E0E`, две `theme-color`, manifest `#FFFFFF`; тёмная фикстура — одна тёмная |
| app component | `components/icon.test.tsx` | iOS-имя / `iosFilled` при `filled`; `regular` — без `weight`; `testID` проброшен; тема с `filled` |
| app regress | все 22 места `themes.light|dark` (maps, profile, tabs, top-bar, section-hero, race-my-track) | без правки — зелёные |
| app web | `e2e/web.spec.ts` (дополнить) | `/`: `window.__POKATIM_THEME__ === 'classic'`, `meta[name=theme-color]` `#FFFFFF`, `#expo-generated-fonts` содержит `Inter_400Regular`; PWA-тест прежний |
| api / contracts | — | не меняются в B |

## 10. Documentation Impact

- **ADR-0016 «Темы приложения»** (новый, `docs/adr/0016-app-themes.md` + индекс `docs/adr/README.md`): глобальная
  тема (T1), реестр в `@pokatim/design-tokens` и источник id — контракты; провайдер поверх `ThemeProvider` базы;
  доставка: публичный GET + кэш native + SSR через `+middleware.ts` и `globalThis` (почему не Express — F2);
  шрифты по темам (`useThemeFonts`); иконки (вес/заливка, ограничения Android/web).
- `.claude/rules/pokatim-app.md`: строку «Темы: светлая Jersey Aura, тёмная Night Ride, системная» заменить на
  раздел «Темы приложения» (`useAppTheme`, `theme.map.basemap`, `theme.profile.*`, `Icon` — единственный вход
  `expo-symbols`, шрифты только через `themeFonts`, `+middleware.ts` — исключение для `fetchPublicForSsr`,
  `window.__POKATIM_THEME__`); строку SSR-данных дополнить middleware.
- `docs/product/` — без изменений в B (раздел админки — D1).
- README design-tokens — файла нет; описание — в ADR-0016 и JSDoc `app-themes.ts` (не создаём README).
- `pr.md`: бамп каталога базы, новый `+middleware.ts` (поведение web-сервера), env не меняется (`API_INTERNAL_URL`
  уже обязателен для SSR), результат спайка B0.

## 11. Implementation Context

ENTRY POINTS
- `apps/app/src/app/_layout.tsx` (`RootLayout` → `RootShell` → `AppThemeProvider`)
- `apps/app/src/app/+middleware.ts` (тема процесса SSR), `apps/app/src/app/+html.tsx`, `manifest.webmanifest+api.ts`
- `packages/design-tokens/src/app-themes.ts` (`appThemes`)

FILES TO CREATE
- `packages/design-tokens/src/{app-themes.ts,app-themes.test.ts}`
- `apps/app/src/theme/{app-theme-provider.tsx,app-theme-provider.test.tsx,use-app-theme.ts,use-theme-fonts.ts,use-theme-fonts.web.ts,use-theme-fonts.test.tsx,use-theme-fonts.web.test.tsx,document-theme.ts,document-theme.test.ts,app-theme-ids.test.ts}`
- `apps/app/src/features/appearance/{theme-id.ts,theme-id.test.ts,appearance-query.ts,appearance-cache.ts,appearance-cache.web.ts,appearance-cache.test.ts,ssr-theme.ts,ssr-theme.test.ts,initial-theme-id.ts,initial-theme-id.web.ts,use-active-theme-id.ts,use-active-theme-id.test.tsx}`
- `apps/app/src/components/{icon.tsx,icon.test.tsx}`; `apps/app/src/app/+middleware.ts`; `apps/app/src/types/window.d.ts`
- `docs/adr/0016-app-themes.md`

FILES TO MODIFY
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `packages/design-tokens/src/{brand.ts,contrast.ts,css.ts,index.ts,design-tokens.test.ts}`
- `apps/app/src/theme/{fonts.ts,fonts.test.ts}` (`design-system.ts` — только импорт `fontFamilies`, если переименуется)
- `apps/app/src/app/{_layout.tsx,+html.tsx,manifest.webmanifest+api.ts}`
- `apps/app/src/features/maps/{use-map-style.ts,attribution.web.ts,map-controls.tsx}`, `features/races/race-route-map.tsx`
- `apps/app/src/features/routes/{profile-chart.tsx,profile-chart.web.tsx}`
- `apps/app/src/components/{top-bar.tsx,going-stack.tsx}`
- `apps/app/src/features/auth/secure-storage.ts` (`SecureKey` + `'pokatim.appTheme'`)
- `apps/app/src/__tests__/root-layout.test.tsx` (только мок `expo-font`), `apps/app/e2e/web.spec.ts`
- `.claude/rules/pokatim-app.md`, `docs/adr/README.md`

FILES TO READ
- `/Users/romankarakulov/PROJECTS/app-foundation-wt-themes/packages/ui/src/theme/{theme-provider.tsx,theme.ts,fonts.ts,color-scheme(.web).ts}`,
  `.../design-tokens/src/{themes.ts,css.ts}` (контракт A)
- `apps/app/src/lib/public-ssr.ts`, `features/onboarding/device-flags.ts`, `features/auth/read-json.ts`
- `node_modules/expo-font/build/{FontHooks.js,ExpoFontLoader.web.js}`, `node_modules/expo-symbols/build/{SymbolView.js,utils.js}`,
  `node_modules/expo-server/build/cjs/{vendor/abstract.js,utils/middleware.js,types.d.ts}` (`MiddlewareSettings`)
- `docs/tasks/2026-10-27-app-themes/slice-d1-api-admin.md` (контракты D1)

TYPES & SCHEMAS
- tokens: `AppThemeId`, `AppThemeDefinition`, `AppTheme` (= `Theme<PokatimRoleGroups> & { shape }`), `AppThemeFonts`,
  `AppThemeLayout`, `AppColorScheme`, `AppDensity`, `IconWeight`, `Basemap`, `PokatimRoleGroups.profile`,
  `PokatimRoleGroups.map.basemap`; `appThemes`, `DEFAULT_THEME`, `appThemeScheme`, `contrastPairsOf`
- app: `ThemeFontSet`, `ActiveAppTheme`, `IconName`, `IconProps`; `SecureKey` + `'pokatim.appTheme'`;
  `Window.__POKATIM_THEME__?: string`
- contracts (D1, только чтение): `AppThemeId`, `APP_THEME_IDS`, `DEFAULT_APP_THEME_ID`, `AppAppearance`

TESTS — раздел 9.1.

OUT OF SCOPE
- Палитры, шрифты, форма, раскладки 6 тем, группа `chart`, варианты `layout`/`density` в компонентах, превью
  админки на реестре — слайс C.
- `apps/api`, `packages/contracts`, `packages/api-client`, `apps/admin` (кроме бампа каталога).
- `server/web-server.ts`, Dockerfile — без изменений.
- Нативный сплэш/`expo-system-ui` по теме (R5), личная тема райдера, push-смена темы.

## 12. Outcome

Ветка `feature/app-themes` (worktree `nice-pasteur-1d135d`), коммиты по подзадачам B1–B9; не запушено.

**Сделано (по 7.7):**

- **B1** — каталог `@rkarakulov/*` → 0.5.0 (все 8 пакетов), lockfile.
- **B2** — `@pokatim/design-tokens`: `PokatimRoleGroups.map.basemap`, группа `profile`, `AppTheme` = `Theme<…> & { shape }`
  (у `light`/`dark` — `defaultShape`, значения прежние); `app-themes.ts` (`appThemes` — 7 тем, 6 — алиасы «Классики» с
  `TODO(app-themes C)`, `DEFAULT_THEME`, `appThemeScheme`, инвариант «dark ⇒ одна схема» при загрузке модуля);
  `contrastPairsOf` (+ `profile.line / surface.default`); `designSystemCss` без `--color-map-basemap`.
- **B3** — карта: `theme.map.basemap === 'dark'` (`use-map-style`, `race-route-map`, `attribution.web`); профиль —
  `profile.line` / `fillTop` / `fillBottom` / `grid` (native и web).
- **B4** — `components/icon.tsx` (реестр 7 имён, заливка iOS, вес из темы, `key` по весу, `WEIGHT_FONTS` пуст);
  замены в `top-bar`, `going-stack` (`filled`), `map-controls` (`icon: IconName`).
- **B5** — `theme/fonts.ts`: `themeFonts(def)` (мемо по id, все темы реестра собираются при загрузке модуля),
  `fontFamilies` = семейства «Классики»; `theme/use-theme-fonts.ts`.
- **B6** — `AppThemeProvider`, `useAppTheme`, `activeAppTheme`.
- **B7** — `features/appearance/*` (`toAppThemeId`, `useAppearanceQuery`, кэш native/web, `initialThemeId`,
  `useActiveThemeId`), `SecureKey` + `pokatim.appTheme`, `_layout.tsx`: `RootLayout` → `RootShell` → `AppThemeProvider` →
  `ThemedRoot` (фон, `StatusBar` по схеме, сплэш).
- **B8** — `ssr-theme.ts`, `src/app/+middleware.ts`, `theme/document-theme.ts`, `+html.tsx` (`documentCss`,
  `theme-color`, `window.__POKATIM_THEME__`), manifest, `types/window.d.ts`; e2e-шаг темы; сторож AC3
  `__tests__/theme-guards.test.ts`.
- **B9** — ADR-0016 + индекс, `.claude/rules/pokatim-app.md` (раздел тем, middleware в строке SSR-данных, профиль).

**B0 (спайк, для pr.md):** `build:web` кладёт middleware в `dist/server/_expo/functions/+middleware.js`. `start:web` с
`API_INTERNAL_URL` на заглушку API (`{ themeId: 'atlas' }`): HTML `/` и `/sign-in` — `window.__POKATIM_THEME__="atlas"`,
заглушка получила 1 запрос на несколько страниц (кэш 60 с); в браузере после гидрации — `atlas`, ошибок гидрации
нет. `expo start --web` (dev) — **NOT VERIFIED** (R1): middleware в dev-сервере не проверялся.

**Проверки:**

- `TURBO_CONCURRENCY=1 pnpm check` (MONGO/REDIS изолированные) — EXIT 0: format, lint, arch (1279 модулей, без
  нарушений), typecheck, test — app 152 suites / 1299 tests, design-tokens 453, admin 253, api 1110, contracts 258,
  api-client 93, tracks 288, i18n 6.
- `pnpm build:web` (`EXPO_PUBLIC_API_URL=http://127.0.0.1:3000`) — успешно (в составе `e2e:web`).
- `pnpm e2e:web` (без API) — 17 passed, 7 skipped (с API), **1 failed**: «жалоба на райд /rides/report/<id> без
  сессии» (ожидает «Нет соединения», экран показывает «Не удалось загрузить»). Падение воспроизводится на базовом
  коммите `ccad7ec` (отдельный worktree, та же сборка и тест) — не связано с B. Новый шаг «тема приложения в HTML» —
  passed; PWA `theme_color: '#FFFFFF'` — passed. `E2E_API=1` — не запускался.

**Отклонения от плана (8.2 дополнить):**

| Отклонение | Причина |
|---|---|
| `use-theme-fonts.ts` один файл с развилкой по `window` (как `useFonts` expo-font), без `.web.ts`; SSR-тест — `use-theme-fonts.server.test.tsx` в проекте jest `server` (+ `src/**/*.server.test.*` в `jest.config.js`) | `.web.ts` не может импортировать общий клиентский хук из `./use-theme-fonts` (Metro разрешил бы его в себя) — пришлось бы дублировать клиентскую ветку; в jsdom `window` неудаляем — SSR-ветку проверить можно только в Node |
| Мок `expo-font` изменён не только в `root-layout.test.tsx`: 24 копии `jest.mock('expo-font', () => ({ useFonts }))` в `src/__tests__/*` удалены, один общий мок (`isLoaded`/`loadAsync`, «уже загружены») — в `jest.setup.ts` | корень больше не вызывает `useFonts`; с прежними моками `isLoaded`/`loadAsync` были бы `undefined`. Ожидания и снимки этих тестов не менялись |
| Порядок коммитов B5 → B6 → B4 | `Icon` читает `useAppTheme()` (B6) |
| `useActiveThemeId`: до чтения кэша native — `null` даже при пришедшем ответе сервера | AC5 «сплэш скрыт только после чтения кэша» |
| `pr.md` не создавался | этап finish-task; результат B0 — выше |

**Риски / не проверено:** dev-сервер (`expo start --web`) и native-симуляторы — NOT VERIFIED; смена темы на лету в
браузере проверена только юнит-тестами (6 тем в B совпадают с «Классикой»); `E2E_API=1` не запускался.
