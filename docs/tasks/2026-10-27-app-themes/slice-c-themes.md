# app-themes — слайс C: шесть тем (палитры, шрифты, форма, варианты раскладки)

Уровень: task3. Ветка `feature/app-themes` (поверх слайсов D1 и B). Общая спецификация: `task.md` (раздел «Слайс C»),
решения пользователя: `decisions.md` (T3, T4), ADR-0016. Референс приватный: в репозиторий его не кладём и путь к нему не
упоминаем. Характер тем ниже описан своими словами.

Слайс делится на две подзадачи. Их выполняют строго по порядку, у каждой свой PR-коммит и свой `pnpm check`:

- **C1 — токены.** Палитры 6 тем × схемы, группа ролей `tabBar`, шрифты, форма, плотность, иконки, подложка карты,
  превью тем в панели. Раскладка у всех тем остаётся «Классикой». Слайс можно выкатывать отдельно: темы отличаются
  цветом, гарнитурой и формой.
- **C2 — варианты раскладки.** Варианты главной, цифр маршрута, заливки профиля, таб-бара и карточки списка, а также
  контур маршрута.

## Architecture Review — app-themes-c

Status: **CONCERNS**. Блокеров нет, coder можно запускать. Решения F1–F8 приняты рекомендацией architect (раздел 8.1).
F1 и F8 человек подтверждает на ревью PR.

## 5. Architecture Context

- Пакеты: `@pokatim/design-tokens` (палитры, реестр, контраст), `apps/app` (шрифты, иконки, варианты, форма в
  собственных компонентах), `apps/admin` (превью). `@pokatim/i18n`: одна новая строка панели, одна удаляется.
- API, contracts, БД, BullMQ и outbox не меняются. Новых эндпоинтов нет. Контур маршрута на главной использует
  существующий публичный `GET /v1/routes/:id/map` (`RouteMapGeometry`), ключ `['routes','map',id]` уже есть.
- Новых пакетов нет. База `@rkarakulov/*` 0.5.0 используется как есть: `shapeOf`, `ShapeRoles`, `fontWeights`,
  `textStyle`, `ThemeProvider`, `radius.pill`. Релиз базы не нужен (см. F3: крупная цифра — follow-up в базу).
- Совместимость: состав id тем не меняется (`APP_THEME_IDS`). Старые клиенты с незнакомым id откатываются на «Классику»
  (это сделано в B), поэтому новые темы безопасны для старых сборок.

## 5.1 Placement & Reuse Gate

| Что | Где | Почему |
|---|---|---|
| Палитры 6 тем (hex) | новый `packages/design-tokens/src/app-theme-palettes.ts` (не экспортируется из `index.ts`) | Палитра живёт только внутри design-tokens (инвариант 11). `brand.ts` не раздувается |
| Группа ролей `tabBar` | `PokatimRoleGroups` в `brand.ts`. У «Классики» значения равны нынешним ролям | Цвет вкладки разный у тем (у Хронометра активная оранжевая). Цвет — роль, а не вариант раскладки (F5) |
| Реестр: шрифты, форма, плотность, иконки, раскладка | `app-themes.ts` | Единственный реестр (ADR-0016) |
| Плотность → отступы | `app-themes.ts`: `appDensity: Record<AppDensity, { cardPadding; listGap }>` из `space` | Сейчас `density` никто не читает. Токен даёт значение без литералов в приложении |
| Начертания гарнитур | `apps/app/src/theme/fonts.ts` (`fontAssets`, `FACES`) | Единственная карта файлов (B5) |
| Иконки вкладок, стрелка, шеврон | реестр `ICONS` в `components/icon.tsx`, вес `semibold` — в `WEIGHT_FONTS` | Единственный вход `expo-symbols` |
| Путь контура маршрута | новый `features/routes/route-contour-path.ts` (чистая функция) на `localProjection` из `@pokatim/tracks` | Проекция уже есть, второй не пишем |
| Контур (SVG) | `features/routes/route-contour.tsx` (native, ленивый `react-native-svg`) + `route-contour.web.tsx` (inline SVG) | Развилка файлами, как у `profile-chart` |
| Ленивая загрузка SVG на native | вынести `useSvgLib` из `profile-chart.tsx` в `features/routes/use-svg-native.ts` | Нужна профилю и контуру. **Копировать запрещено** |
| Варианты героя маршрута | `features/home/heroes.tsx`: `RouteHero` выбирает компонент из `ROUTE_HERO[layout.home]` | Герой уже здесь |
| Варианты цифр маршрута | `components/stat-block.tsx`: `variant` расширяется на `'tiles' \| 'numeral'`; `route-detail.tsx` → `STATS_VARIANT[layout.routeStats]` | `StatBlock` уже держит `default \| compact`, вторую сетку не пишем |
| Заливка профиля | `features/routes/profile-style.ts`: `PROFILE_FILL: Record<ProfileFill, …>`, читают оба `profile-chart(.web)` | Прозрачности заливки уже лежат здесь |
| Таб-бар | `components/tab-bar.tsx`: `TAB_ITEM[layout.tabBar]`, иконки — `TAB_ICONS: Record<имя вкладки, IconName>` | Один таб-бар, без второго файла |
| Карточка списка | `components/route-list-card.tsx`: `RouteCardFrame` выбирает тело по `layout.routeCard` | Общая рамка с `MyRouteListCard` |
| Превью панели | `apps/admin/src/features/appearance/theme-previews.ts` → `previewOf(def)` из `appThemes` | Шов D1 закрывается |

**Запрещено:**

- hex и `color.*` вне design-tokens.
- Ветвление по id темы (`id === 'atlas'`) и по значению варианта (`layout.home === …`) в компонентах. Вариант
  выбирается из таблицы `Record<Вариант, Компонент | значение>`, и полноту таблицы проверяет тип. Тест-сторож — 9.1.
- Второй `useSvgLib`, вторая проекция lon/lat, вторая сетка цифр помимо `StatBlock`, свой таб-бар на тему.
- `useFonts`, импорт корня `@expo-google-fonts/<f>`. Тянуть только `/<вес>`.
- Группа `chart` (F4).

## 6. Relevant Files

| Путь | Роль |
|---|---|
| `packages/design-tokens/src/app-themes.ts` | реестр: 6 определений, `AppThemeLayout` (союзы C2), `appDensity` |
| `packages/design-tokens/src/brand.ts` | `PokatimRoleGroups.tabBar`, значения `tabBar` у `light`/`dark` «Классики» |
| `packages/design-tokens/src/contrast.ts` | новые пары `contrastPairsOf` |
| `apps/app/src/theme/fonts.ts` | 18 новых файлов начертаний, `FACES` 6 гарнитур |
| `apps/app/src/components/icon.tsx` | новые имена и вес `semibold` |
| `apps/app/src/components/tab-bar.tsx`, `src/app/(tabs)/_layout.tsx` | роли `tabBar`, вариант `icons` |
| `apps/app/src/features/home/heroes.tsx`, `components/section-hero.tsx` | варианты `RouteHero` |
| `apps/app/src/features/routes/route-detail.tsx`, `components/stat-block.tsx` | варианты цифр |
| `apps/app/src/features/routes/profile-chart(.web).tsx`, `profile-style.ts` | варианты заливки |
| `apps/app/src/components/route-list-card.tsx` | варианты карточки |
| `apps/app/src/components/bottom-sheet(.web).tsx`, `features/maps/map-controls.tsx` | форма: радиус шторки и кнопок карты |
| `apps/admin/src/features/appearance/{theme-previews.ts,ThemePreview.tsx}` | превью на реестре |

## 7. Implementation Notes

### 7.1 C1 — палитры (hex, контраст проверен формулой базы)

Все пары `contrastPairsOf` с новыми парами из 7.2 посчитаны функцией `contrastRatio` базы 0.5.0 на значениях ниже.
Провалов 0 из 10 схем. Самые узкие места: `text.accent / surface.default` у Атласа (светлая) — 4.66; `border.input /
surface.default` у Журнала (светлая) — 3.52.

Структурные правила, одинаковые для 10 схем. Их применяет внутренний сборщик `appScheme(palette)` в
`app-theme-palettes.ts`, наружу он не экспортируется:

- `text.placeholder` = `text.secondary`; `text.onPhoto` = `#FFFFFF`; `text.onPrimary` = `action.onPrimary`;
- `surface.sheet` = `surface.raised`;
- `surfaceBar` = { asphalt: `text.primary`, gravel: `border.subtle`, gravelHatch: `text.primary`, outline: `text.secondary` };
- `profile.fillBottom` = `profile.fillTop`; `profile.grid` = `border.subtle`;
- `control.track` = `border.input`; `control.thumb` = `#FFFFFF`; `overlay.scrim` = `#000000`;
- `tabBar.inactive` = `text.secondary`;
- `map.basemap` = `'light'` для светлой схемы и `'dark'` для тёмной; у Хронометра и Навигации — `'dark'`.

Явные значения. Порядок внутри ячейки повторяет порядок ключей группы.

| Роль | Атлас light | Атлас dark | Хронометр (dark) | Планировщик light | Планировщик dark |
|---|---|---|---|---|---|
| text: primary / secondary / accent / disabled | #15171A / #5B616B / #C2410C / #8E939B | #F1F2F4 / #A3A9B2 / #FF8A4C / #6B7079 | #F5F5F5 / #A1A1A6 / #FF6A1A / #636366 | #141412 / #57544D / #B23C0A / #8C887F | #F0EEE8 / #A8A398 / #FF8A4C / #6F6B62 |
| surface: default / raised / disabled / skeleton | #F2F3F5 / #FFFFFF / #E3E5E8 / #E3E5E8 | #111316 / #1C1F23 / #2A2E33 / #1C1F23 | #0B0B0C / #1C1C1E / #2C2C2E / #1C1C1E | #ECEAE4 / #F7F6F2 / #DEDBD3 / #DEDBD3 | #161512 / #211F1B / #2E2B26 / #211F1B |
| border: subtle / strong / input / focus / sheet | #E3E5E8 / #CDD1D6 / #7D838C / #15171A / #E3E5E8 | #2A2E33 / #3A3F45 / #6E747D / #F1F2F4 / #3A3F45 | #2C2C2E / #3A3A3C / #6C6C70 / #FF6A1A / #3A3A3C | #DCD9D1 / #C9C5BB / #7A766F / #141412 / #DCD9D1 | #2E2B26 / #3D3A33 / #76716A / #F0EEE8 / #3D3A33 |
| action: primary / onPrimary | #15171A / #FFFFFF | #F1F2F4 / #111316 | #FF6A1A / #0B0B0C | #141412 / #FFFFFF | #F0EEE8 / #161512 |
| status: success / warning / error / onError / errorTint | #1E7A46 / #866C00 / #B0103A / #FFFFFF / #FBEDEB | #4CC28A / #F0CC3C / #FF5C8A / #111316 / #2A1A1F | #4CC28A / #F0CC3C / #FF5C8A / #0B0B0C / #2A1A1F | #1B6E3F / #6F5900 / #A50E36 / #FFFFFF / #F6E6E3 | #4CC28A / #F0CC3C / #FF5C8A / #161512 / #2A1A1F |
| map: background / line / route / corridor / track / offCorridor | #EEF0F2 / #DADDE1 / #D9480F / #5B616B / #1D6FD8 / #B0103A | #1C1F23 / #2A2E33 / #FF8A4C / #A3A9B2 / #5AA2FF / #FF5C8A | #161618 / #2C2C2E / #FF6A1A / #A1A1A6 / #5AC8FA / #FF5C8A | #E7E4DC / #D3CFC5 / #141412 / #57544D / #B23C0A / #A50E36 | #211F1B / #2E2B26 / #F0EEE8 / #A8A398 / #FF8A4C / #FF5C8A |
| profile: line / fillTop | #D9480F / #F76707 | #FF8A4C / #FF8A4C | #FF6A1A / #FF6A1A | #141412 / #57544D | #F0EEE8 / #A8A398 |
| control: trackOn / thumbOn | #15171A / #FFFFFF | #F1F2F4 / #111316 | #FF6A1A / #0B0B0C | #141412 / #FFFFFF | #F0EEE8 / #161512 |
| tabBar: background / active | #FFFFFF / #15171A | #1C1F23 / #F1F2F4 | #0B0B0C / #FF6A1A | #F7F6F2 / #141412 | #211F1B / #F0EEE8 |

| Роль | Журнал light | Журнал dark | Навигация (dark) | Типографика light | Типографика dark |
|---|---|---|---|---|---|
| text: primary / secondary / accent / disabled | #18201A / #525D55 / #22702A / #879086 | #EDF2EA / #9FAA9F / #6CCB7A / #66706A | #F2F4F7 / #A0A7B1 / #5BA8FF / #646B75 | #0D0D0D / #57534E / #B93C0B / #8F8A83 | #F6F4F0 / #A6A19A / #FF7A45 / #6E6A64 |
| surface: default / raised / disabled / skeleton | #EEF2EA / #FAFBF8 / #DDE3D8 / #DDE3D8 | #101511 / #1A211B / #263027 / #1A211B | #0F1215 / #1B1F24 / #2A2F36 / #1B1F24 | #F6F4F0 / #FFFFFF / #E6E2DB / #E6E2DB | #0D0D0D / #1A1918 / #2A2826 / #1A1918 |
| border: subtle / strong / input / focus / sheet | #DDE3D8 / #C8D0C2 / #77827A / #18201A / #DDE3D8 | #263027 / #344036 / #6C786D / #EDF2EA / #344036 | #2A2F36 / #39404A / #6B727C / #5BA8FF / #39404A | #E6E2DB / #D2CDC4 / #827D75 / #0D0D0D / #E6E2DB | #2A2826 / #3A3734 / #716C66 / #F6F4F0 / #3A3734 |
| action: primary / onPrimary | #22702A / #FFFFFF | #6CCB7A / #101511 | #F2F4F7 / #0F1215 | #FF5A1F / #0D0D0D | #FF5A1F / #0D0D0D |
| status: success / warning / error / onError / errorTint | #1B6E3F / #6F5900 / #A50E36 / #FFFFFF / #F6E6E3 | #4CC28A / #F0CC3C / #FF5C8A / #101511 / #2A1A1F | #4CC28A / #F0CC3C / #FF5C8A / #0F1215 / #2A1A1F | #1B6E3F / #7A6200 / #A50E36 / #FFFFFF / #FBEDEB | #4CC28A / #F0CC3C / #FF5C8A / #0D0D0D / #2A1A1F |
| map: background / line / route / corridor / track / offCorridor | #E6ECE1 / #D2DACB / #2E7D32 / #525D55 / #C2410C / #A50E36 | #1A211B / #263027 / #6CCB7A / #9FAA9F / #FF8A4C / #FF5C8A | #161A1E / #2A2F36 / #5BA8FF / #A0A7B1 / #FF8A3D / #FF5C8A | #EFECE6 / #DCD8D0 / #D9480F / #57534E / #1D6FD8 / #A50E36 | #1A1918 / #2A2826 / #FF7A45 / #A6A19A / #5AA2FF / #FF5C8A |
| profile: line / fillTop | #2E7D32 / #43A047 | #6CCB7A / #6CCB7A | #5BA8FF / #5BA8FF | #D9480F / #FF5A1F | #FF7A45 / #FF5A1F |
| control: trackOn / thumbOn | #22702A / #FFFFFF | #6CCB7A / #101511 | #5BA8FF / #0F1215 | #0D0D0D / #FFFFFF | #FF5A1F / #0D0D0D |
| tabBar: background / active | #FAFBF8 / #18201A | #1A211B / #EDF2EA | #0F1215 / #F2F4F7 | #FFFFFF / #0D0D0D | #1A1918 / #F6F4F0 |

Характер палитр:

- **Атлас.** Светло-серый экран и белые карточки. Акцент оранжевый: для текста он затемнён до #C2410C, линия карты и
  профиль — #D9480F/#F76707. Основная кнопка чёрная.
- **Хронометр.** Почти чёрный фон, графитовые карточки, кнопка и активная вкладка ярко-оранжевые. Текст на оранжевом
  тёмный (F6).
- **Планировщик.** Тёплый бежево-серый фон, чёрные линии маршрута и профиля, оранжевый только у трека.
- **Журнал.** Светлый зеленоватый фон, основная кнопка, маршрут и профиль зелёные.
- **Навигация.** Тёмная, синий акцент (маршрут, фокус, тумблер), трек оранжевый, основная кнопка светлая.
- **Типографика.** Тёплый светлый фон, основная кнопка оранжевая с чёрным текстом, акцент текста #B93C0B.

### 7.2 C1 — контраст

`contrastPairsOf` получает 4 новые пары. Они проверяются у всех тем реестра и у `themes.light|dark|panel`. «Классика»
проходит: `text.accent / surface.raised` — 4.70 (light) и 6.73 (dark), `tabBar.inactive` — 6.69 (light).

- `profile.line / surface.sheet` — `WCAG.ui`: профиль рисуется в шторке.
- `text.accent / surface.raised` — `WCAG.text`: акцент на карточках вариантов.
- `tabBar.active / tabBar.background` и `tabBar.inactive / tabBar.background` — `WCAG.text`: подпись вкладки — это текст.

### 7.3 C1 — группа `tabBar`

`PokatimRoleGroups.tabBar: { background; active; inactive }`. «Классика»: light — `#FFFFFF / #111111 / #5C5C5C`, dark —
`#0E0E0E / #F2F2F0 / #A3A3A3`. Это ровно нынешние `surface.default / text.primary / text.secondary`, поэтому визуально
ничего не меняется.

`tab-bar.tsx` читает `tabBar.*` уже в C1. Полоса индикатора берёт `tabBar.active`. Это тот же цвет, что прежний
`text.primary`. В CSS панели появляются переменные `--color-tab-bar-*`. Вреда от них нет, тест CSS проверяет их через
`toContain`.

### 7.4 C1 — шрифты (`@expo-google-fonts/*` 0.4.2, кириллица есть у всех 6)

Подключаются только подпути `/<вес>`. Вес роли базы соответствует файлу так:

| Тема | display 500 / 600 | text 400 / 500 / 600 / 700 | Новые файлы |
|---|---|---|---|
| Атлас | `Manrope_500Medium` / `Manrope_700Bold` | `Manrope_400Regular` / `_500Medium` / `_600SemiBold` / `_700Bold` | 4 |
| Хронометр | `RobotoCondensed_500Medium` / `RobotoCondensed_700Bold` (сжатые цифры плотнее) | Inter (есть) | 2 |
| Планировщик | `Onest_500Medium` / `Onest_600SemiBold` | `Onest_400Regular` … `_700Bold` | 4 |
| Журнал | `GolosText_500Medium` / `GolosText_600SemiBold` | `GolosText_400Regular` … `_700Bold` | 4 |
| Навигация | `InterTight_500Medium` / `InterTight_600SemiBold` | Inter (есть) | 2 |
| Типографика | `Oswald_500Medium` / `Oswald_600SemiBold` | Inter (есть) | 2 |

- Всего 18 TTF, около 2,1 МБ в native-бандле (R3). На web грузится только набор активной темы (B).
- `AppThemeFonts.display|text` — имена `'Manrope'`, `'Roboto Condensed'`, `'Onest'`, `'Golos Text'`, `'Inter Tight'`,
  `'Oswald'`, `'Inter'`. У гарнитуры с двумя ролями (Manrope, Onest, Golos Text) в `FACES` одна запись с `display` и
  `text`. Набор файлов темы уже без дублей.
- `stack` (CSS-стек): `'<Гарнитура>', <фолбэк>`. Для сжатых: `'Roboto Condensed', 'Arial Narrow', Arial, sans-serif`;
  `Oswald, 'Arial Narrow', Impact, sans-serif`. Для остальных — `system-ui, Arial, sans-serif`. Текст тем на Inter
  получает прежний стек Inter.
- Зависимости — 6 пакетов в `apps/app/package.json` (`^0.4.2`, как `inter`).

### 7.5 C1 — форма, плотность, иконки, подложка

| Тема | shape: button / field / chip / card / sheet / buttonCase | density | icons: weight / filled |
|---|---|---|---|
| Атлас | 14 / 12 / `radius.pill` / 16 / 24 / `none` | comfortable | regular / false |
| Хронометр | 12 / 10 / pill / 12 / 20 / `none` | regular | semibold / true |
| Планировщик | pill / 12 / pill / 14 / 24 / `none` | comfortable | regular / false |
| Журнал | 12 / 10 / pill / 14 / 20 / `none` | comfortable | regular / false |
| Навигация | pill / 12 / pill / 16 / 24 / `none` | regular | semibold / true |
| Типографика | 8 / 4 / 4 / 0 / 16 / `upper` | regular | semibold / false |

- Радиусы — числа внутри объекта `shape` схемы в design-tokens (px, как `defaultShape`). Обе схемы темы ссылаются на
  один объект формы.
- `appDensity`: `regular` — `{ cardPadding: space.s4, listGap: 0 }` (нынешнее); `comfortable` — `{ cardPadding:
  space.s5, listGap: space.s3 }`. Читает `RouteCardFrame` (C1: только отступ; зазор между карточками — тело `tile` в C2).
- Иконки: в `WEIGHT_FONTS` добавляется только `semibold` (`expo-symbols/androidWeights/semiBold`) — один лишний файл
  шрифта. Заливка работает только на iOS (ADR-0016, п. 6).
- Форма в собственных компонентах приложения через `shapeOf(useTheme())`. У «Классики» всё по нулям, отличий нет:
  - шторка `bottom-sheet(.web)` — верхние углы `shape.sheet`;
  - кнопки карты `map-controls` — `shape.button`: у Навигации и Планировщика pill, то есть круг;
  - карточки вариантов C2 — `shape.card`.
- Подложка задаётся `map.basemap` схемы (7.1). URL стиля по-прежнему берётся из env (ADR-0014).

### 7.6 C1 — превью в панели

- `theme-previews.ts` → `previewOf(def)` по схеме `def.schemes.light`. У тёмных тем это тот же объект, что `dark`.
  Поля:
  - `canvas` — `surface.default`, `card` — `surface.raised`;
  - `text` — `text.primary`, `accent` — `action.primary`, `route` — `map.route`;
  - `radius` — `shape.card`, `font` — `def.fonts.display`.
- `THEME_PREVIEWS` = `Object.fromEntries(APP_THEME_IDS.map(id => [id, previewOf(appThemes[id])]))`. `null` и
  `TODO(app-themes D2)` удаляются.
- `ThemePreview` дополняется: `--preview-radius` для карточки и подпись «Шрифт: Manrope» под макетом.
  - Новый ключ `admin.appearance.font` с параметром `{name}`.
  - `admin.appearance.previewPending` удаляется вместе с веткой «Превью появится позже».
- Шрифт превью — шрифт панели (F7). В бандл панели новые `@fontsource` не добавляются.
- Превью «Классики» меняется: canvas/card меняются местами. Это только панель (T6), а приложение не затронуто.

### 7.7 C2 — варианты раскладки

`AppThemeLayout` (союзы):

```ts
home: 'classic' | 'contour' | 'numeral';
routeStats: 'classic' | 'tiles' | 'numeral';
profileFill: 'gradient' | 'solid' | 'line';
tabBar: 'classic' | 'icons';
routeCard: 'classic' | 'tile' | 'numeral';
```

| Тема | home | routeStats | profileFill | tabBar | routeCard |
|---|---|---|---|---|---|
| Классика | classic | classic | gradient | classic | classic |
| Атлас | contour | classic | gradient | icons | tile |
| Хронометр | classic | tiles | gradient | icons | tile |
| Планировщик | contour | classic | solid | icons | classic |
| Журнал | classic | classic | solid | icons | tile |
| Навигация | contour | tiles | line | icons | tile |
| Типографика | numeral | numeral | solid | icons | numeral |

**`home` — только герой раздела «Маршруты»** (`RouteHero`). Герои гонок, райдов и календаря не меняются.

- `classic` — нынешний `SectionHero`.
- `contour` (Атлас, Планировщик, Навигация):
  - вверху панель `map.background` высотой `size.heroHeight` со скруглением `shape.card` и контуром маршрута
    (`map.route`, `stroke.indicator`), точка старта — `text.accent`;
  - ниже название (`displayTitle`) и мета, как в `SectionHero`;
  - в углу круглая кнопка-стрелка `size.buttonHeight` × `radius.pill`: фон `action.primary`, `Icon arrowRight`, цвет
    `action.onPrimary`;
  - весь блок — одна ссылка (как сейчас). Кнопка декоративная, скрыта от скринридера, второй цели нажатия нет.
- `numeral` (Типографика):
  - слева дистанция `displayNumeral` (52, сжатая гарнитура) с единицей `unit`, название `surnameCaps`/`displaySm`
    заглавными, мета;
  - справа диагональный блок `action.primary`: прямоугольник с наклонной кромкой, inline SVG или поворот. Внутри
    контур `action.onPrimary` и стрелка;
  - метка для скринридера та же, что у героя.
- Контур на главной:
  - `useQuery(catalogRouteMapOptions(route.id))` — только при вариантах `contour`/`numeral`. Хук вызывается в
    компоненте варианта, не по условию;
  - пока геометрия грузится — на месте панели блок `surface.skeleton` того же размера (инвариант 12);
  - ошибка или 404 — панель без контура, тихо (как карта в карточке маршрута);
  - один запрос на главную, кэш общий с карточкой маршрута.
- `route-contour-path.ts`: `contourPath(line, bounds, viewBox)`:
  - `localProjection(центр широты)`, вписывание с сохранением пропорций и полями;
  - возвращает путь `M…L…`, старт и `null` для вырожденной рамки.
- `RouteContour`:
  - native — ленивый `react-native-svg` через `use-svg-native.ts`; модуля нет — панель без контура;
  - web — inline `<svg>`, SSR совпадает с первым рендером (главная без SSR-данных: контур появится на клиенте).

**`routeStats` — шапка шторки карточки маршрута** (`RouteSheetHeader`). Сопоставление — `STATS_VARIANT = { classic:
'compact', tiles: 'tiles', numeral: 'numeral' }` в `StatBlock`.

- `tiles` (Хронометр, Навигация): три равные плитки `surface.raised` с радиусом `shape.card`. Значение
  `displayNumeral36` (одна строка, при крупном шрифте — перенос), под ним единица и подпись `label`. Метка ячейки —
  как у `compact`.
- `numeral` (Типографика): первая ячейка (дистанция) — `displayNumeral`, остальные — строкой `compact` справа или под
  ней, если не помещаются.
- `note` во всех вариантах шапки не показывается, но остаётся в метке (как `compact`). Высоту шапки шторка уже
  измеряет (`onVisibleHeightChange`), отступ камеры следует сам.

**`profileFill`** — `PROFILE_FILL: Record<ProfileFill, { top: number; bottom: number } | null>` в `profile-style.ts`:

- `gradient` — `{ PROFILE_FILL_OPACITY, 0 }` (нынешнее);
- `solid` — `{ PROFILE_SOLID_OPACITY, PROFILE_SOLID_OPACITY }`, новая константа 0.45 рядом с прежними;
- `line` — `null`, путь площади не рисуется.

Оба `profile-chart(.web)` берут стопы из таблицы. Фолбэк-столбики native не меняются.

**`tabBar`:**

- `classic` — нынешняя вкладка: полоса сверху и подпись.
- `icons` (все 6 новых): `Icon` (`size.icon`) над подписью, активная — `tabBar.active`, неактивная — `tabBar.inactive`,
  полосы нет. Активная получает `filled` (iOS).
- `TAB_ICONS`:
  - `index` → `home` (`house` / `house.fill` / `home`);
  - `races` → `races` (`flag.checkered` / — / `sports_score`);
  - `rides` → `rides` (`cup.and.saucer` / `cup.and.saucer.fill` / `local_cafe`);
  - `routes` → `routes` (`map` / `map.fill` / `map`);
  - `calendar` → `calendar` (`calendar` / — / `calendar_month`).
- Ещё два имени: `arrowRight` (`arrow.right` / `arrow_forward`) и `chevronRight` (`chevron.right` / `chevron_right`).
- Точные имена проверяет typecheck (`SFSymbol` / `AndroidSymbol`). Иконки декоративные, метка вкладки прежняя.

**`routeCard`** — тело `RouteCardFrame`. Прежние пропсы, плюс необязательный `numeral: { value; unit } | null`.

- `classic` — нынешнее: hairline сверху.
- `tile` (Атлас, Хронометр, Журнал, Навигация): карточка `surface.raised` с радиусом `shape.card` и отступом
  `appDensity[density].cardPadding`. Между карточками `listGap`. Справа `Icon chevronRight` (`text.secondary`).
- `numeral` (Типографика):
  - слева дистанция `displayNumeral44` + `unit`, справа название заглавными, мета и шеврон;
  - если `numeral` нет (у своего маршрута в обработке или с отказом дистанции нет), тело берётся как у `tile`. Это
    развилка по данным, а не по теме.
- Скелетон карточки повторяет раскладку варианта (`ROUTE_CARD_SKELETON[variant]`).
- Контура в карточке списка нет (F2).

**Сторож**, `__tests__/theme-guards.test.ts`:

- `/\bid\s*===\s*'(classic|atlas|chrono|planner|journal|navigation|typography)'/` и
  `/layout\.\w+\s*[!=]==/` в `src` (кроме тестов) запрещены;
- исключение — только `features/appearance/*`, если понадобится.

### 7.8 Порядок коммитов

- **C1:**
  - `app-theme-palettes.ts` + `tabBar` + контраст;
  - реестр (палитры, shape, density, icons, fonts-имена);
  - `fonts.ts` + зависимости;
  - `icon.tsx` (`semibold`, новые имена);
  - форма в шторке и кнопках карты, `tab-bar` на ролях `tabBar`;
  - превью панели.
- **C2:**
  - союзы `AppThemeLayout` + назначения;
  - `use-svg-native` (вынос) + `route-contour*`;
  - герои;
  - `StatBlock` и шапка шторки;
  - профиль;
  - таб-бар;
  - карточка списка;
  - сторож.

## 8. Risks / Assumptions / Open Questions

- R1. Бандл native растёт примерно на 2,1 МБ TTF плюс один файл веса Material Symbols. Принято (task R3).
- R2. Сжатые гарнитуры (Oswald, Roboto Condensed) с `letterSpacing` токенов базы (−0.01 em) могут выглядеть тесно. Это
  проверка глазами на dev. Правка — только токеном, не по месту.
- R3. Первая загрузка главной в темах с контуром делает лишний запрос `/map` (≤ 1000 точек, публичный, кэш 60 с).
- R4. Шапка шторки с плитками или крупной цифрой выше `compact`: в свёрнутом виде карты видно меньше. Отступ камеры
  считается от измеренной высоты (уже есть).
- R5. Палитры — интерпретация референса (F8). Конкретные hex подтверждает человек на ревью PR.
- R6. Скриншотного регресса в e2e нет (`toHaveScreenshot` не используется). Визуальная проверка — dev, AC8 общей
  задачи.

## 8.1 Requirements Consistency

- **F1. Конфликт с продуктовым решением.**
  - Суть: `docs/product/routes.md:83-84` (RC-8 «линии на Главной нет») расходится с T4 и `task.md` (Атлас — «герой
    маршрута с картой»).
  - Решение: T4 новее и явное. RC-8 остаётся правилом «Классики», варианты `contour`/`numeral` — исключение тем.
    Обновить `routes.md` и `home.md`. Подтверждение человеком — на ревью.
- **F2. Недоопределено — данные контуров в списке.**
  - Суть: в `CatalogRouteCard` (`packages/contracts/src/routes/route-catalog.schema.ts:37`) нет геометрии и превью.
    Геометрия есть только в `GET /v1/routes/:id/map` поштучно.
  - Варианты:
    - (a) контура в карточке списка и плиток «Рекомендуемые» с мини-картами нет;
    - (b) N+1 запросов `/map` на карточку (20 на страницу, до 1000 точек каждый) — плохо для сети и батареи;
    - (c) упрощённая линия превью в контракте списка — это изменение API (contracts-first, вычисление в обработке
      маршрута, обратная совместимость `default`). Выходит за «только существующие данные».
  - **Рекомендация (a).** (c) — отдельная задача-follow-up. Контур — только в одном герое главной.
- **F3. Конфликт с инвариантом 11 — огромные цифры.**
  - Суть: самый крупный стиль базы — `displayNumeral` (52 px). Цифры «на треть экрана», как в референсе, потребуют
    нового стиля.
  - Варианты:
    - (a) `displayNumeral` / `displayNumeral44` в сжатой гарнитуре;
    - (b) стиль `displayNumeralXL` в `@rkarakulov/design-tokens` — релиз базы, как в слайсе A;
    - (c) проектный токен плюс своя конвертация em → px — дубль `textStyle` базы.
  - **Рекомендация (a)** в C и (b) follow-up-задачей в app-foundation. (c) запрещено.
- **F4. Вредное решение — группа `chart`.**
  - Суть: `task.md` §3 B и ADR-0016 («`chart` … — там же») заводят группу `chart`. Единственный потребитель —
    недельный график, а он out of scope. Роли без потребителя нарушают «нет на вырост» (инвариант 9).
  - **Рекомендация:** `chart` не добавлять, в ADR-0016 поправить строку последствий.
- **F5. Недоопределено — цвет активной вкладки по теме.**
  - Варианты:
    - (a) группа ролей `tabBar` (фон, активная, неактивная) с контрастом;
    - (b) вариант раскладки `iconsAccent`, где цвет выбирается раскладкой — цвет утекает в раскладку;
    - (c) всегда `text.primary` — Хронометр теряет оранжевую вкладку.
  - **Рекомендация (a)**: «Классика» не меняется (7.3).
- **F6. Вредное решение в референсе — белый текст на ярко-оранжевой кнопке.**
  - Суть: белый на `#FF6A1A` — около 2.9:1, это меньше 4.5 (`action.onPrimary / action.primary`).
  - Варианты:
    - (a) тёмный текст на ярком оранжевом (6.2–6.9:1);
    - (b) затемнить кнопку до #C2410C с белым (5.2:1) — теряется яркость темы;
    - (c) исключение из WCAG — нельзя (AC1).
  - **Рекомендация (a)** для Хронометра и Типографики.
- **F7. Недоопределено — шрифт превью в панели.**
  - Варианты:
    - (a) шрифт панели и подпись с названием гарнитуры;
    - (b) 6 пакетов `@fontsource/*` (по одному начертанию, файл грузится только при показе) — новые зависимости
      панели ради декоративного макета;
    - (c) CSS-стек темы без файлов — у пользователя без установленного шрифта фолбэк, вводит в заблуждение.
  - **Рекомендация (a).** Тему целиком админ видит в приложении в течение минуты.
- **F8. Инвариант 11 «значения из прототипов».** Прототипов шести тем нет, есть приватный референс. Hex в 7.1 —
  интерпретация architect с проверенным контрастом. Нужно подтверждение человеком на ревью PR, правки — только в
  `app-theme-palettes.ts`.
- **Не делается за отсутствием данных:**
  - «полоса покрытия» с долями (Типографика) — в `CatalogRouteCard.surfaces` нет долей;
  - недельные цифры (Хронометр, Журнал) — out of scope.

## 8.2 Deviations from spec

| Отклонение | Причина | Где |
|---|---|---|
| Группа `chart` не добавляется | F4 | ADR-0016, последствия |
| Контура в карточке списка и плиток «Рекомендуемые» нет | F2 | 7.7 |
| Новая группа ролей `tabBar` (её нет в `task.md`) | F5 | 7.3 |
| «Огромные» цифры — `displayNumeral` 52 px | F3 | 7.7 |
| Контур маршрута на Главной у тем `contour`/`numeral`, RC-8 — только у «Классики» | F1 принят (T4), `routes.md`/`home.md` обновлены | 7.7 |
| Хелпер тестов `appThemeWrapper(themeId)` — `ThemeProvider` + контекст темы без `AppThemeProvider` | web-проект jest без мока `expo-font`: провайдер ждал бы загрузку шрифтов; загрузку проверяют тесты провайдера | `src/__tests__/app-theme-wrapper.tsx` |
| `sheetColors` → `sheetSurface` (цвета + радиус верхних углов) | форма шторки — в одном месте для native, web и скелетона карточки | `bottom-sheet-props.ts` |
| Плитки `tiles` шапки шторки — фон `surface.default`, а не `surface.raised` | шторка — `surface.sheet` = `surface.raised` (правило 7.1): на ней плитки `raised` не видны (найдено в браузере, Хронометр); `text.*` / `surface.default` — пары базы | `stat-block.tsx` |
| `packages/design-tokens/README.md` не обновлён | файла нет в пакете; описание — в комментариях `app-theme-palettes.ts`/`brand.ts` и ADR-0016 | — |

Follow-up (вне C, решения оркестратора):

- F2 — превью-линия маршрута в контракте списка (`CatalogRouteCard`) для контура в карточке списка и «Рекомендуемых»:
  изменение API, отдельная задача.
- F3 — стиль цифр крупнее `displayNumeral` (`displayNumeralXL`) в `@rkarakulov/design-tokens`: задача и релиз в
  app-foundation.

## 8.3 Security

Security boundary не затронут: API, права, данные наружу и секреты не меняются. Публичный `GET /v1/routes/:id/map`
уже существует.

## 9. Acceptance Criteria

1. В реестре 6 тем со своими палитрами (7.1) и `colorScheme`: Хронометр и Навигация — `'dark'`, у них `light === dark`;
   остальные — `'system'`.
2. Контраст: все пары `contrastPairsOf` (с новыми из 7.2) — по 2 схемы на каждую из 7 тем, все зелёные.
3. «Классика» не меняется: существующие тесты app, design-tokens и e2e зелёные без правки ожиданий. `classic.layout` —
   все `classic`/`gradient`, `tabBar` «Классики» равен прежним ролям.
4. Шрифты: каждая тема разрешает все стили `typography` в подключённые файлы. Набор темы — ровно её файлы, все 6
   гарнитур с кириллицей.
5. Форма, плотность, иконки и подложка тем — по 7.5. Шторка и кнопки карты берут радиус из `shape`.
6. C2: каждый вариант пяти групп рендерится под темой, у которой он задан. Компоненты не сравнивают id темы и значения
   `layout` (сторож).
7. Контур: загрузка — скелетон панели, ошибка — панель без контура, данные — путь. Запрос `/map` идёт только при
   `contour`/`numeral`.
8. Панель: 7 цветных превью из `appThemes`, ветки «Превью появится позже» нет, ключи превью = `APP_THEME_IDS`.
9. На dev: минимум 3 темы, включая тёмную (Хронометр) и Типографику, в браузере и на одном native-клиенте. Без проверки
   — `NOT VERIFIED` в pr.md.
10. `TURBO_CONCURRENCY=1 pnpm check` зелёный после C1 и после C2.

## 9.1 Test matrix

| Уровень | Что | Где |
|---|---|---|
| unit (vitest) | 6 тем × форма ключей, `colorScheme`, `dark ⇒ light === dark`, `basemap` по схеме, `shape`/`density`/`icons` по 7.5, назначения `layout` по 7.7 | `packages/design-tokens/src/app-themes.test.ts` |
| unit (vitest) | контраст 7 тем × 2 схемы (цикл уже есть) + новые пары в списке имён; `--color-tab-bar-*` в CSS панели | `design-tokens.test.ts` |
| unit (jest) | шрифты всех тем: цикл уже покрывает новые; плюс «Атлас: display 600 → `Manrope_700Bold`», «Хронометр: display 600 → `RobotoCondensed_700Bold`» | `apps/app/src/theme/fonts.test.tsx` |
| unit (jest) | `Icon`: `semibold` → вес Android, ключ по весу; новые имена разрешаются | `components/icon.test.tsx` |
| unit (jest) | `contourPath`: пропорции, вписывание, старт, вырожденная рамка → `null` | `features/routes/route-contour-path.test.ts` |
| component (jest) | `TabBar`: `classic` — полоса, `icons` — 5 иконок, цвета `tabBar.*`, `aria-selected` | `components/tab-bar.test.tsx` (+ web `tab-bar.web.test.tsx`) |
| component (jest) | `StatBlock` `tiles`/`numeral`: метки ячеек, перенос при `fontScale > 1` | `components/stat-block.test.tsx` |
| component (jest) | `RouteListCard`/`MyRouteListCard` × 3 варианта, `numeral` без дистанции → `tile`, скелетоны вариантов | `components/route-list-card.test.tsx` |
| component (jest) | `ProfileChart` native и web: стопы `gradient`/`solid`, `line` — без пути площади | `profile-chart.web.test.tsx`, `elevation-profile.test.tsx` |
| screen (jest) | главная под `AppThemeProvider` (`atlas`, `typography`): герой варианта, скелетон контура, ошибка `/map` → без контура, ссылка в карточку | `__tests__/home.test.tsx` |
| screen (jest) | карточка маршрута под `chrono`/`typography`: шапка шторки варианта | `__tests__/route-detail.test.tsx` |
| guard (jest) | нет `id === '<тема>'` и `layout.x ===` в `src` | `__tests__/theme-guards.test.ts` |
| admin (vitest) | `THEME_PREVIEWS` ключи = `APP_THEME_IDS`, превью = роли `appThemes`, 7 цветных макетов, подпись шрифта | `features/appearance/theme-previews.test.ts`, `AppearanceScreen.test.tsx` |
| e2e | шаг «тема в HTML» остаётся на `classic`. Скриншотных тестов нет: инфраструктуры нет, смоук темы не меняет | `e2e/web.spec.ts` без правок |
| integration (реальная БД) | не требуется: API не меняется | — |

Хелпер тестов: `renderWithAppTheme(ui, themeId)` в `src/__tests__/` — `AppThemeProvider` с общим моком `expo-font` из
`jest.setup.ts`.

## 10. Documentation Impact

- `docs/adr/0016-app-themes.md` — последствия: `chart` не вводится (F4), группа `tabBar`, варианты C2 — таблицы
  выбора без ветвлений, контур героя — `/map` одной записью.
- `.claude/rules/pokatim-app.md`:
  - раздел тем: варианты `layout` → таблицы `Record`, `tabBar.*`, `appDensity`, `use-svg-native`, `route-contour*`;
  - раздел «Маршруты»: герой главной зависит от темы (RC-8 только у «Классики»).
- `docs/product/routes.md:83-84`, `docs/product/home.md` — герой маршрута по теме (F1).
- `docs/product/admin-panel.md` — превью: цветной макет и название шрифта.
- `packages/design-tokens/README.md` — палитры тем в `app-theme-palettes.ts`, группа `tabBar`, новые пары контраста.
- `brand.ts` (комментарий «палитра только внутри этого файла») → «внутри design-tokens: `brand.ts`,
  `app-theme-palettes.ts`».

## 11. Implementation Context

ENTRY POINTS

- `packages/design-tokens/src/app-themes.ts` (реестр), `apps/app/src/theme/fonts.ts`,
  `apps/app/src/components/tab-bar.tsx`, `apps/app/src/features/home/heroes.tsx`,
  `apps/app/src/features/routes/route-detail.tsx`, `apps/admin/src/features/appearance/theme-previews.ts`.

FILES TO MODIFY

- **C1:**
  - `packages/design-tokens/src/{app-themes.ts, brand.ts, contrast.ts, index.ts}`, новый `app-theme-palettes.ts`,
    тесты `app-themes.test.ts`, `design-tokens.test.ts`, `README.md`;
  - `apps/app/package.json` (+6 `@expo-google-fonts/*`), `pnpm-lock.yaml`;
  - `apps/app/src/theme/fonts.ts` (+тест);
  - `apps/app/src/components/{icon.tsx, tab-bar.tsx, route-list-card.tsx, bottom-sheet.tsx, bottom-sheet.web.tsx}`,
    `features/maps/map-controls.tsx`;
  - `apps/admin/src/features/appearance/{theme-previews.ts, ThemePreview.tsx, AppearanceScreen.test.tsx}` (+CSS превью),
    `packages/i18n/src/ru.ts`.
- **C2:**
  - `app-themes.ts` (союзы и назначения);
  - `apps/app/src/features/home/heroes.tsx`, `components/section-hero.tsx` (только если нужен общий фрагмент меты),
    `components/stat-block.tsx`, `features/routes/{route-detail.tsx, profile-style.ts, profile-chart.tsx,
    profile-chart.web.tsx}`, `components/{tab-bar.tsx, route-list-card.tsx}`;
  - новые: `features/routes/{use-svg-native.ts, route-contour-path.ts, route-contour.tsx, route-contour.web.tsx}`;
  - `__tests__/theme-guards.test.ts`, `__tests__/{home,route-detail}.test.tsx`.

FILES TO READ

- `docs/adr/0016-app-themes.md`, `slice-b-tokens-delivery.md` §12;
- `.claude/rules/pokatim-app.md` (темы, маршруты, скраббинг);
- `apps/app/src/theme/{app-theme-provider.tsx, use-app-theme.ts, use-theme-fonts.ts}`;
- `features/routes/{queries.ts (catalogRouteMapOptions), load-svg-native.ts, svg-support.ts, profile-path.ts}`;
- `packages/tracks/src/geo.ts` (`localProjection`);
- `node_modules/@rkarakulov/design-tokens/dist/{themes,typography,contrast}.d.ts`.

TYPES & SCHEMAS

- `AppTheme`, `PokatimRoleGroups` (+`tabBar`), `AppThemeDefinition`, `AppThemeLayout` (союзы 7.7), `AppDensity` →
  `appDensity`;
- `ShapeRoles`, `FontWeight`, `IconWeight`;
- `RouteMapGeometry` и `CatalogRouteCard` — без изменений.

TESTS

- По 9.1.
- Запуск:
  - `pnpm --filter @pokatim/design-tokens test`;
  - `pnpm --filter @pokatim/app test`;
  - `pnpm --filter @pokatim/admin test`;
  - итог — `TURBO_CONCURRENCY=1 pnpm check` с изолированными MONGO/REDIS.
- Web: `pnpm build:web` + `pnpm e2e:web`.

OUT OF SCOPE

- Изменения API и контрактов (превью-линия списка — follow-up, F2).
- Стиль `displayNumeralXL` в базе (follow-up, F3).
- Группа `chart`, недельный график, «Поехать», запись и навигация заезда.
- Полоса долей покрытия.
- Личный выбор темы и предпросмотр в приложении.
- Native-сплэш по теме.
- Шрифты тем в панели.
- Герои гонок, райдов и календаря, «Мой маршрут» (карточка) — прежние.

## 12. Outcome (заполняет coder)

Статус: C1 и C2 реализованы, `TURBO_CONCURRENCY=1 pnpm check` зелёный после C1 и после C2 (изолированные
`MONGO_URL_TEST` / `REDIS_URL_TEST`). Не запушено.

- **C1:** палитры 6 тем (`app-theme-palettes.ts`, сборщик `appScheme`), группа `tabBar` (у «Классики» = прежние роли),
  4 новые пары контраста — зелёные для 7 тем × 2 схем и `themes.light|dark|panel`; реестр: шрифты, форма, плотность
  (`appDensity`), иконки; 18 начертаний `@expo-google-fonts/*` (6 пакетов `^0.4.2`); `Icon` — вес `semibold`, иконки
  вкладок, стрелка, шеврон; радиус шторки (`sheetSurface`) и кнопок карты из `shapeOf`; отступ карточки списка из
  плотности; таб-бар на ролях `tabBar`; превью панели из `appThemes` (`previewOf`, радиус, подпись «Шрифт: …»;
  `previewPending` удалён).
- **C2:** союзы `AppThemeLayout` и назначения 7.7; `use-svg-native.ts` (вынос), `contourPath` + `RouteContour`
  (native/web); `ROUTE_HERO` (classic / contour / numeral); `StatBlock` `tiles`/`numeral` + `STATS_VARIANT`;
  `PROFILE_FILL`; `TAB_ITEM` + `TAB_ICONS`; `ROUTE_CARD` + `ROUTE_CARD_SKELETON`; сторож id/`layout` в
  `theme-guards.test.ts`.
- «Классика»: существующие тесты app, design-tokens и e2e — без правки ожиданий (правка только в тесте панели D1:
  ветка «Превью появится позже» удалена по 7.6).
- Документы: ADR-0016, `.claude/rules/pokatim-app.md`, `routes.md`, `home.md`, `admin-panel.md`.

Проверки:

- `TURBO_CONCURRENCY=1 pnpm check` → 13/13 tasks successful (app: 1376 тестов), после C1 и после C2 + fix.
- `pnpm build:web` → успешно.
- `start:web` + заглушка `/v1/appearance` (публичная карточка маршрута, 375 × 812): Классика без изменений, Атлас
  (Manrope, скруглённая шторка, оранжевый профиль), Хронометр (тёмная, плитки, Roboto Condensed, оранжевая кнопка с
  тёмным текстом), Типографика (Oswald, крупная дистанция, сплошная заливка, заглавные кнопки); SSR отдаёт
  `__POKATIM_THEME__` и `@font-face` только гарнитуры темы. Найдено и исправлено: плитки `surface.raised` не видны на
  шторке (8.2).
- `pnpm e2e:web` (без API) → 17 passed, 7 skipped, 1 failed: «жалоба на райд … без сессии» — ждёт «Нет соединения»,
  видит «Не удалось загрузить»; на базовом коммите `ab2b259` падает так же (не связано со слайсом).

NOT VERIFIED:

- Главная (герой с контуром / крупной цифрой), таб-бар с иконками и карточки списка в браузере — нужны сессия и данные
  API; покрыты jest-тестами экранов и компонентов.
- Native-клиент (iOS/Android): иконки `semibold`, заливка iOS, шрифты в бандле, контур через `react-native-svg`.
- Панель «Протокол» в браузере (превью) — покрыто vitest.
- Подтверждение палитр человеком (F8) и сжатых гарнитур глазами (R2).
