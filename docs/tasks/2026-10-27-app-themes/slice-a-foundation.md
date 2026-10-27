# Слайс A — app-foundation: форма темы и ThemeProvider

Репозиторий app-foundation, ветка `feature/theme-shape-provider` от `origin/main`. Задача ведётся здесь (on-bike),
реализация и релиз — в app-foundation (его `AGENTS.md`: TDD, `pnpm check`, changeset, независимое ревью).
Spec — `task.md` этой папки, разделы 2.1 (T5) и 3 «Слайс A».

## Контракт (minor, без ломающих изменений)

### `@rkarakulov/design-tokens`

```ts
export interface ShapeRoles {
  /** радиусы, px */
  button: number;
  field: number;
  chip: number;
  card: number;
  sheet: number;
  /** регистр подписи кнопки */
  buttonCase: 'upper' | 'none';
}
/** Нынешняя геометрия базы: квадрат, подписи кнопок заглавными. */
export const defaultShape: ShapeRoles;
export function shapeOf(theme: Theme): ShapeRoles; // theme.shape ?? defaultShape
export type Theme<Extra> = ColorRoles & Extra & { nav?: NavRoles; shape?: ShapeRoles };
```

- `designSystemCss` дополнительно выводит CSS-переменные формы (`--radius-button` и т. п.) из `shapeOf(theme)`;
  для тем без `shape` — значения по умолчанию (вывод для существующих тем не ломает снимки сверх новых строк).

### `@rkarakulov/ui`

```tsx
export interface ThemeProviderProps {
  /** разрешённая тема (схема уже выбрана проектом) */
  theme: Theme;
  /** шрифты темы; без них — из configureDesignSystem */
  fonts?: FontFamilies;
  children: ReactNode;
}
export function ThemeProvider(props: ThemeProviderProps): JSX.Element;
```

- `useTheme()` — тема из ближайшего `ThemeProvider`, без провайдера — как сейчас (`themeFor(useColorScheme())`).
- Шрифты: `textStyle()`/`fontFamilyFor()` — обычные функции (вызываются на рендере в сотнях мест), поэтому
  провайдер с `fonts` делает их активными для процесса (`setActiveFonts`, синхронно при рендере провайдера, до
  детей; идемпотентно). Без провайдера — `designSystem().fonts`. В JSDoc: тема и шрифты глобальны для приложения
  (один активный набор на процесс, в т. ч. SSR).
- Смена `theme`/`fonts` у провайдера перерисовывает потребителей `useTheme()` без перемонтирования (контекст),
  в том числе за `React.memo`.
- Компоненты берут форму из `shapeOf(useTheme())`: Button (радиус и `buttonCase` → `textTransform`), TextField /
  FieldFrame / DateField (поле), Chip, Pill, SegmentedControl (чип), Banner, Skeleton (карточка), остальное —
  по смыслу. Без `shape` вид пикселем не меняется (существующие тесты и снимки без правки).
- Экспорт из корня пакета: `ThemeProvider`, `ThemeProviderProps`; из design-tokens: `ShapeRoles`, `defaultShape`,
  `shapeOf`.

## Тесты (TDD)

- design-tokens: `shapeOf` с `shape` и без; CSS-переменные формы.
- ui: `useTheme` без провайдера — прежнее поведение; с провайдером — тема провайдера; смена темы перерисовывает
  memo-потребителя без перемонтирования (состояние `useState` сохраняется); `textStyle` берёт шрифты провайдера;
  Button с `shape` (радиус, `buttonCase: 'none'` — без uppercase) и без (как сейчас); web-вариант теста там, где
  есть `.web`-развилка.

## Релиз

`pnpm changeset` (minor, группа `@rkarakulov/*` fixed) → PR в `main` → CI зелёный → merge → Version Packages PR
(`release.yml`) → merge → публикация в GitHub Packages (версия 0.5.0). Пользователь дал «да» на релиз (decisions T5).
