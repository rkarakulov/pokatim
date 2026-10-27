# Findings — app-themes slice C — pass 1 — reviewer: claude
base: ab2b259   commits: ab2b259..bd5722f (15 коммитов, working tree чистый)
verdict: REQUEST CHANGES

Проверено и замечаний нет:
- «Классика» не изменилась. Удалённые строки в старых тестах — только импорты и перенос хелпера `mine`, ожидания не менялись. Группа `tabBar` у «Классики» равна прежним ролям (есть тест). У `appDensity.regular` отступ s4, `defaultShape` нулевой, поэтому радиусы шторки и кнопок карты по-прежнему 0.
- В `apps/app/src` и `apps/admin/src` нет hex-литералов, и вне тестов нет сравнений с id темы или значением варианта (проверено grep). Все пять вариантов выбираются таблицами `Record` (`ROUTE_HERO`, `STATS_VARIANT` / `STAT_VARIANTS`, `PROFILE_FILL`, `TAB_ITEM`, `ROUTE_CARD` / `ROUTE_CARD_SKELETON`).
- Контраст: цикл по 7 темам × 2 схемам и 4 новым парам зелёный, design-tokens 551/551.
- Шрифты: у всех 18 подключённых TTF в cmap есть кириллица (ЖЁЩЫЭЮЯ, проверено разбором cmap). Подключаются только подпути `/<вес>`. Набор темы без дублей. В SSR попадает только набор активной темы (`useServerThemeFonts` из слайса B).
- Контур: `catalogRouteMapOptions` вызывается только в `ContourPanel` вариантов contour и numeral. Ключ общий с карточкой маршрута. 4xx не повторяется (`shouldRetry`). Пока грузится — скелетон, при ошибке — панель без контура. Классика `/map` не запрашивает (есть тест).
- a11y: герой — одна ссылка, стрелка скрыта. На web иконка `SymbolView` помечена `aria-hidden`, у вкладки остаются `aria-label` и `aria-selected`. Каждая плитка `tiles` и ячейка `numeral` — `accessible` с полной меткой, включая `note`.
- Тесты: `pnpm --filter @pokatim/app test` — 159 наборов и 1376 тестов зелёные.

### [HIGH] Плитки шапки шторки (`tiles`) обрезают значение «В пути» многоточием при обычном размере шрифта
- **file:** apps/app/src/components/stat-block.tsx
- **location:** `TileStats`, `numberOfLines={lines}` у `stat-block-value`, стиль `tile` (`paddingHorizontal: space.s2`)
- **problem:** значение набрано `displayNumeral36` строго в одну строку (`useSingleLine` при `fontScale <= 1`), а ширина плитки — треть ширины шапки. На экране 375 px внутренняя ширина плитки — (375 − 2×20 gutter − 2×12 statGap)/3 − 2×8 ≈ 87.7 px. Ширину строк я измерил по hmtx реальных TTF при 36 px и letterSpacing −0.01 em:
  - «3 ч 35 мин»: 153 px (Roboto Condensed 700, Хронометр) и 171 px (Inter Tight 600, Навигация);
  - «45 мин»: 102 px и 116 px;
  - у Навигации «123,4»: 88.5 px.
  Ячейка «В пути» (`routeDuration`, она есть всегда) у обеих тем превращается в «3 ч 3…». Длинная дистанция у Навигации тоже обрезается. Подпись «ДИСТАНЦИЯ» (Inter 600, 11 px, caps 0.14) — 86.9 px: на 375 она помещается впритык, на 360 px (частый Android) уже обрезается.
- **why_it_matters:** цифры маршрута — главный контент свёрнутой шторки. Зрячий пользователь Хронометра и Навигации не видит время в пути. Это потеря данных на экране, а не мелочь вёрстки. Многоточие на значении `compact` раньше запретило ревью pass 1 (M1), здесь оно появилось снова. В Outcome браузерная проверка Хронометра отмечена, но про значение времени ничего не сказано.
- **evidence:** `routeStatItems` → `routeDuration` = `'{hours} ч {minutes} мин'` (format.ts:92–101). `sheetHeader: { paddingHorizontal: size.gutter }` (route-detail.tsx:415). Метрики шрифтов: `node_modules/@expo-google-fonts/roboto-condensed/700Bold/RobotoCondensed_700Bold.ttf` и `inter-tight/600SemiBold/InterTight_600SemiBold.ttf`. Тест `stat-block.test.tsx` проверяет только `numberOfLines === 1`, а не помещается ли текст.
- **recommended_fix:** значение плитки не обрезать. Варианты: разрешить перенос (`numberOfLines` undefined, как при крупном шрифте); `adjustsFontSizeToFit` с `minimumFontScale` на native плюс перенос на web; в плитке брать стиль меньше (`displayNumeral36` → `titleSm` / `bodyStrong` для нечисловых значений). Подпись — перенос вместо многоточия. Проверить на 360 и 375 px у Хронометра и Навигации на маршруте 3+ часа.

### [MEDIUM] Скелетоны экранов не повторяют варианты шапки шторки и героя (§4.12)
- **file:** apps/app/src/features/routes/route-detail.tsx; apps/app/src/features/home/home-section.tsx
- **location:** `RouteDetailSkeleton` (route-detail.tsx:258–275); `AsyncContent skeleton={<SkeletonHeroCard />}` (home-section.tsx:57)
- **problem:** у карточки списка скелетон по вариантам есть (`ROUTE_CARD_SKELETON`), а в двух других местах нет:
  - скелетон карточки маршрута при любой теме рисует шапку `compact` (`SkeletonText bodyStrong ×2`). Шапки `tiles` (≈ 36 + 16 + 14 + 2×12 ≈ 100 px) и `numeral` (52 px цифра) заметно выше;
  - на Главной скелетон раздела — `SkeletonHeroCard` классического героя. Герой `contour` — это панель `heroHeight` плюс `displayTitle` и мета, герой `numeral` устроен иначе.
- **why_it_matters:** AGENTS.md §4.12 требует скелетон по раскладке. После загрузки шторка Хронометра, Навигации и Типографики прыгает по высоте, а вместе с ней отступ камеры карты. Блокером это не считаю: скелетон есть, но раскладку он не повторяет.
- **evidence:** `RouteDetailSkeleton` не читает `layout.routeStats`. `HomeSection` не знает о `layout.home`.
- **recommended_fix:** таблицы `Record<AppThemeLayout['routeStats'], ComponentType>` для скелетона шапки и `Record<AppThemeLayout['home'], ComponentType>` для скелетона героя маршрутов (передать в `HomeSection` через проп `skeleton`) — так же, как `ROUTE_CARD_SKELETON`.

### [MEDIUM] Плитки списка у тем с `density: 'regular'` (Хронометр, Навигация) стоят вплотную
- **file:** apps/app/src/components/route-list-card.tsx; packages/design-tokens/src/app-themes.ts
- **location:** `useTileStyle` (`marginBottom: listGap`); `appDensity.regular = { cardPadding: space.s4, listGap: 0 }`
- **problem:** у варианта `tile` скруглённый фон `surface.raised` с радиусом `shape.card` (12 и 16), но зазор берётся из плотности. У `regular` он 0, а `route-feed.tsx` / `my-route-feed.tsx` между строками ничего не добавляют (`renderItem` → `<View style={styles.gutter}>`). Получается колонка карточек, которые склеены скруглёнными углами друг к другу. Так в 7.5/7.7 буквально и написано, но при вариантах `tile` + `regular` это визуальный брак. Outcome отмечает карточки списка в браузере как NOT VERIFIED.
- **why_it_matters:** у двух из четырёх тем с плитками список выглядит сломанным. Тесты проверяют только Атлас (`comfortable`, s3).
- **recommended_fix:** зазор плитки не делать нулём: например `tile`-зазор `Math.max(listGap, space.s2)` или отдельное поле `tileGap` в `appDensity`. Добавить тест на `chrono`.

### [MEDIUM] Точка старта контура не видна у Атласа и Навигации: цвет совпадает с линией маршрута
- **file:** apps/app/src/features/home/heroes.tsx; packages/design-tokens/src/contrast.ts
- **location:** `ContourRouteHero` → `startColor={theme.text.accent}`, `color={theme.map.route}`
- **problem:** контраст `text.accent` / `map.route` (считал `contrastRatio` базы на реестре): Атлас light — 1.20 (#C2410C на #D9480F), Атлас dark — 1.00 (оба #FF8A4C), Навигация — 1.00 (оба #5BA8FF). У Планировщика 3.11 и 2.01. Точка радиусом 5 на линии `stroke.indicator` у двух из трёх тем `contour` неотличима. Пары `text.accent / map.route` (или `… / map.background`) в `contrastPairsOf` нет, поэтому тест это не ловит.
- **why_it_matters:** по спеке 7.7 элемент «точка старта» должен быть виден. Сейчас он рисуется, но фактически невидим. Это графика, нарушения WCAG как блокера нет.
- **recommended_fix:** брать цвет старта из роли, контрастной к линии (например `map.track` — он отличается у всех трёх тем, — или обводка `map.background`), и добавить пару в `contrastPairsOf` с `WCAG.ui`. Либо решением F8 у человека зафиксировать, что старт не выделяется, и убрать точку.

### [LOW] Сторож вариантов ловит только узкую запись
- **file:** apps/app/src/__tests__/theme-guards.test.ts
- **location:** новый `it('варианты раскладки — таблицами Record…')`
- **problem:** регэкспы `\bid\s*===\s*'(…)'` и `layout\.\w+\s*[!=]==` пропускают `themeId === 'atlas'`, `'atlas' === id`, двойные кавычки, `switch (layout.home)` и `=== layout.home`. Сейчас нарушений нет (проверил grep), но сторож слабее, чем заявлено в ADR-0016.
- **recommended_fix:** расширить шаблон: `(===|!==)\s*['"](atlas|chrono|…)['"]|['"](atlas|…)['"]\s*(===|!==)`, `switch\s*\(\s*\w*\.?layout\.`, `[!=]==\s*\w*\.?layout\.`.

### [LOW] `TAB_ICONS` — `Partial<Record<string, IconName>>`, а не таблица по именам вкладок
- **file:** apps/app/src/components/tab-bar.tsx
- **location:** `TAB_ICONS`
- **problem:** в спеке 7.7 — `Record<имя вкладки, IconName>`. Сейчас тип не проверяет полноту: при новой вкладке в `(tabs)/_layout.tsx` вариант `icons` молча покажет её без иконки, и раскладка ряда станет неровной.
- **recommended_fix:** завести союз имён вкладок (`'index' | 'races' | 'rides' | 'routes' | 'calendar'`) и `Record<TabName, IconName>`. Либо тест: каждая `Tabs.Screen` из `_layout` есть в `TAB_ICONS`.

NOT VERIFIED:
- Визуальная проверка на native (iOS и Android) и вёрстка героя `numeral` на узких экранах: запуска устройства не было.
- `pnpm check` целиком и `pnpm --filter @pokatim/admin test` не запускались. Запущены design-tokens (551 passed) и app (1376 passed).

# Findings — app-themes slice C — pass 2 — reviewer: claude
base: origin/develop   commits: origin/develop..784db39 (fix-коммиты af09a2a…784db39, working tree чистый)
verdict: APPROVE

Прошлые находки закрыты (проверено по коду и прогоном тестов):
- HIGH pass 1 «tiles обрезают время». Значение разбито на части `StatItem.parts` («3» «ч», «35» «мин»). Плитки — `flexBasis: 'auto'`, `minWidth: size.rowMin` (64), ряд с `flexWrap`. Ни у значения, ни у подписи нет `numberOfLines`, поэтому многоточия нет. На 360 px (внутренняя ширина 320) у Навигации плитки уходят во второй ряд, а не обрезаются. Это отклонение записано в 8.2.
- HIGH Codex pass 2 «numeral обрезает время». `CompactCells wrap` снимает ограничение строк. `numeralRest` теперь `flexBasis: 'auto'`, `flexShrink: 1`, `flexWrap`, ячейки `contentCell` по содержимому. Если правая группа не помещается рядом с цифрой, она уходит вниз. Считал для сценария Codex: ≈ 130 + 12 + (≈ 64 + 12 + 86) ≈ 304 ≤ 320, то есть группа помещается в ряд, а в худшем случае переносится. «Классика» (`compact`, `wrap=false`) осталась прежней: `compactCell` и одна строка при `fontScale <= 1`, есть тест.
- MEDIUM скелетоны. `STAT_SKELETONS` выбирается по `STATS_VARIANT[layout.routeStats]` в `RouteDetailSkeleton`. `ROUTE_HERO_SKELETON` передаётся через новый проп `HomeSection.skeleton` (`(tabs)/index.tsx:202`). Для «Классики» по-прежнему рисуются `SkeletonText bodyStrong ×2` и `SkeletonHeroCard`.
- MEDIUM listGap. `appDensity.regular.listGap` = s2. `ClassicCard` берёт только `cardPadding`, так что строки «Классики» не меняются. `listGap` больше нигде не читается.
- MEDIUM точка старта. Новая роль `map.start` есть во всех 14 схемах и в `themes.light/dark`. Пара `map.start / map.route` ≥ 3:1 входит в `contrastPairsOf`, цикл тем в тесте зелёный. Кружок с обводкой цвета линии: r = 5 в viewBox 320×200 при масштабе ≈ 1.05, обводка 2 px non-scaling. Заливка видна. «Классика» контур не рисует, поэтому новая роль на неё не влияет.
- LOW сторож. Шаблоны расширены: обратный порядок, двойные кавычки, `switch`, `=== x.layout.y`, плюс самопроверка шаблонов. `TAB_ICONS` теперь `Record<TabName, IconName>`, а тест сверяет `TAB_NAMES` с `Tabs.Screen` в `(tabs)/_layout.tsx`.
- Профиль после переезда в `@pokatim/route-view`. `PROFILE_FILL` лежит в пакете. Для `gradient` (у «Классики») стопы {0.28, 0}, как до слайса. Зависимость `@pokatim/design-tokens` у route-view объявлена. native и web ведут себя одинаково, фолбэк столбиками не изменился.
- Прогоны: design-tokens 568/568, route-view 40/40, admin 285/285, typecheck app/route-view/design-tokens — ок. app: 1367/1367 в трёх прогонах из четырёх, в первом упал 1 тест (см. NOT VERIFIED).

### [LOW] Исправление Codex pass 2 (numeral) не отражено в 8.2 и Outcome
- **file:** docs/tasks/2026-10-27-app-themes/slice-c-themes.md
- **location:** таблица отклонений 8.2; раздел «Исправления по ревью pass 1»
- **problem:** коммит 784db39 меняет раскладку `numeral`: правая группа по содержимому с переносом вниз, значения без ограничения строк. В 8.2 и Outcome про это ни слова, и нет браузерной проверки Типографики на 360 px с «5 ч 10 мин».
- **why_it_matters:** Documentation Sync. Следующий читатель не узнает, что `numeral` больше не «одна строка compact справа» и что Codex pass 2 закрыт.
- **evidence:** `grep -n "pass 2\|правая группа" slice-c-themes.md` ничего не находит.
- **recommended_fix:** добавить строку в 8.2 и пункт в Outcome вместе с итогом проверки в браузере.

### [LOW] Скелетон `tiles` всегда в один ряд, а успешная шапка на узком экране — в два
- **file:** apps/app/src/components/stat-block.tsx
- **location:** `TileSkeleton`
- **problem:** у скелетонных плиток нет содержимого, поэтому три плитки шириной `minWidth` 64 всегда встают в ряд. У Навигации на 360 px реальные плитки переносятся на 2 + 1 (см. Outcome: «5 ч 10 мин» вторым рядом). После загрузки шапка вырастает на ряд плиток, примерно на 80 px.
- **why_it_matters:** §4.12 соблюдён по сути (раскладка плиток повторена), но высота шторки на первой загрузке у Навигации прыгает. Не блокер.
- **recommended_fix:** по желанию задать скелетонным плиткам минимальную ширину под типичное содержимое, чтобы перенос совпадал, или принять отклонение в 8.2.

NOT VERIFIED:
- В первом прогоне `pnpm --filter @pokatim/app test` упал 1 тест из 1367, имя не сохранилось. Три следующих прогона полностью зелёные: похоже на флейк, возможно, из-за параллельной нагрузки. Источник не установлен.
- Фактическая раскладка Yoga и браузера для tiles и numeral: тесты jest проверяют стили, а не геометрию. Ширины я считал по токенам и замерам pass 1. Native (iOS и Android) не запускал.
- `pnpm check` целиком не запускался; запускались выборочно тесты и typecheck, перечисленные выше.
