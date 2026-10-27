# routes-04 — скраббинг профиля высоты и карты на карточке маршрута

Уровень: task3. Ветка `feature/routes-04-scrub` от `origin/develop` (после routes-03, PR #54). Связано: routes-03
(`docs/tasks/2026-10-27-routes-03-card/task.md`), ADR-0014 (карты), maps-01/02, `.claude/rules/pokatim-app.md`
(«`accessibilityActions` вместо единственного drag-жеста», reduce motion).

## 1. Title

Синхронный «скраббинг» профиля высоты и карты (как в komoot/Strava) + визуальный долг профиля и стат-блока routes-03.

## 2. Goal

Райдер ведёт пальцем или курсором по профилю — на карте движется точка по линии маршрута, во всплывающей карточке
видно «км от старта · высота · уклон %». И обратно: тащит точку по линии на карте — она липнет к маршруту, на профиле
двигается вертикальная линия. Доступно без жеста: профиль — `adjustable`, шаг 1 км.

## 2.1 Продуктовые решения (задача пользователя от 2026-10-27; автономный режим — решения сессии)

| # | Вопрос | Решение |
|---|---|---|
| S1 | Профиль → карта | web — hover мышью и перетаскивание; native — long-press (≈ 250 мс) и перетаскивание; отпустили — курсор остаётся до тапа вне профиля / ухода мыши (web) |
| S2 | Карта → профиль | перетаскивание маркера по карте: позиция — ближайшая точка линии маршрута (с предпочтением непрерывности — соседний участок, а не «прыжок» на другой проход петли); на профиле — вертикальная линия. Карта по-прежнему статична (панорамирования нет, ADR-0014 RC-4); жест — только от маркера |
| S3 | Всплывающая карточка | «12,4 км · 231 м · ↗ 4 %» (+ «набор 180 м» от старта); уклон — по окну ±100 м (200 м) вокруг точки, округление до целого %, `−` — спуск; в a11y — словами без стрелок |
| S4 | Доступность | профиль — `accessibilityRole="adjustable"`, `accessibilityActions` increment/decrement — шаг 1 км; `accessibilityValue.text` — «12,4 км, высота 231 м, уклон 4 %»; web — `role="slider"`, стрелки ←/→ (1 км), Home/End; фокус виден. Без жеста функциональность та же (кроме перетаскивания маркера на карте) |
| S5 | Reduce motion | маркер и линия — без анимации перехода (мгновенно); с reduce motion карточка без fade |
| S6 | Данные | **без смены API и бэкфилла**: позиция на карте — интерполяция по доле дистанции вдоль линии показа (`/map`, ≤ 1000 точек, допуск упрощения 5 м); профиль — `[d, e]` routes-03. Расхождение длины линии показа и `distanceM` компенсируется долей (`d / distanceM` → та же доля длины линии). Обоснование: ошибка ≤ допуска упрощения (5 м) — меньше пикселя на обзорном зуме; смена контракта `profile` (кортеж → 4 элемента) сломала бы старые клиенты (`z.tuple` строг), а бэкфилл ради точности в 5 м не окупается. Альтернатива — `[d, e, lon, lat]` с ростом `ROUTE_DERIVED_VERSION` — §8.1, если architect найдёт блокер |
| S7 | Производительность | 60 fps: движение маркера — без ре-рендера `RouteMap` (web — `GeoJSONSource.setData` по ref; native — отдельный источник маркера с минимальным обновлением или `MarkerView`/`PointAnnotation` — решает architect по докам MapLibre RN 11); курсор профиля — `react-native-reanimated` shared value (уже в зависимостях) на native, CSS transform на web |
| S8 | Визуальный долг routes-03 | профиль — сплошная площадь без зазоров (сейчас 96 столбиков с видимыми щелями на web); стат-блок на 375 px — три колонки в ряд (сейчас 2 + 1) |
| S9 | Карта гонки | не меняется; компонент скраббинга проектировать переиспользуемым (профиль + маркер), переиспользование на карте гонки — follow-up §8.2 |

## 3. Scope

- **app (`features/routes`, `features/maps`):**
  - чистые функции (`features/routes/scrub.ts` или аналог): кумулятивная длина линии показа, точка на линии по доле,
    ближайшая точка линии к координате (с подсказкой предыдущей доли для непрерывности), высота и уклон по дистанции
    (окно ±100 м, интерполяция профиля), набор от старта до дистанции, шаг adjustable (1 км, границы 0 и `distanceM`);
  - профиль: сплошная площадь (решает architect: web — inline SVG в `.web.tsx`, native — `View`-столбики без зазоров
    или иное без новой нативной зависимости), курсор (вертикальная линия), всплывающая карточка, жесты (web —
    pointer events; native — `react-native-gesture-handler` `Gesture.Pan().activateAfterLongPress`, не ломая
    вертикальную прокрутку `ScrollView`), `adjustable`/slider;
  - карта: новый необязательный пропс маркера скраббинга у `RouteMap`/`RouteLineMap` (позиция + колбэк перетаскивания),
    карта гонки и существующие пропсы — без изменений;
  - карточка `route-detail.tsx`: общий стейт позиции (доля / дистанция) между профилем и картой;
  - стат-блок: три колонки на 375 px (`StatBlock` — компонент `src/components`, правка без поломки других экранов).
- **i18n:** свои ключи `routes.detail.scrub.*`.
- **docs:** `docs/product/routes.md` (скраббинг), `.claude/rules/pokatim-app.md` (маршруты: скраббинг, развилки файлов).

## 4. Out of Scope

- Смена API, данных, бэкфилл (S6).
- Скраббинг на карте гонки (коридор, трек участника) — follow-up.
- Панорамирование и зум карты, полноэкранная карта.
- Уклоны цветом, участки покрытия, точки интереса.

## 5. Architecture Context

- Карта статична (ADR-0014 RC-4, жесты выключены пропсами); маркер скраббинга — единственный интерактивный элемент.
- MapLibre: web — `maplibre-gl` 6 (`route-map.web.tsx`, динамический импорт), native — `@maplibre/maplibre-react-native`
  11 (`route-map.tsx`, ленивая загрузка). Слои — `corridor-style.ts`.
- Профиль — SSR-рендер на web (routes-03, без `onLayout`); интерактив — после монтирования.

## 5.1 Placement & Reuse Gate

- Reuse: `features/maps/*` (`routeFeatures`, слои, `MAP_FIT_PADDING`), `features/routes/format.ts` (подписи профиля,
  `profileTicks`), `ElevationProfile`, `StatBlock`, `react-native-gesture-handler`, `react-native-reanimated`,
  `haversineMeters`/`trackLengthMeters` из `@pokatim/tracks` (лёгкий вход), токены и роли темы `map.*`.
- Запрещено: новая нативная зависимость без решения architect (SVG/Skia); `Platform.OS` в компонентах (развилка —
  файлами); ре-рендер всей карты на каждом движении; смена существующих пропсов `RouteMap`; координаты в логах.
- Architect (RC-2…RC-6, RC-11): reuse — `zustand/vanilla` (стор скраббинга на экран), `haversineMeters` (`@pokatim/tracks`),
  `profileBars`/`profileBarHeights`/`profileSummary`/`profileTicks` (`format.ts`), `RouteMapFrame`, `attributionCss`-образец
  scoped `<style>` для `:focus-visible`, `usePanGesture`/`useTapGesture`/`GestureDetector` RNGH v3, `fireGestureHandler`
  в jest. Новое в `features/maps/` (переиспользуемо картой гонки, S9): `scrub-store.ts`, `scrub-line.ts`,
  `scrub-marker(.web).tsx`; в `features/routes/`: `scrub.ts`, `profile-chart(.web).tsx`, `scrub-readout.tsx`; в
  `components/`: `gesture-root(.web).tsx`, `StatBlock.equalColumns`. Запрещено дополнительно: `react-native-svg`/Skia,
  MapLibre `ViewAnnotation draggable`, импорт RNGH в web-файлы и `_layout.tsx` напрямую, `scrub` в зависимостях
  эффекта создания web-карты.

## 6. Relevant Files

- `apps/app/src/features/routes/{elevation-profile.tsx,route-detail.tsx,catalog-route-map.tsx,route-line-map.tsx,format.ts}`
- `apps/app/src/features/maps/{route-map.tsx,route-map.web.tsx,route-map-props.ts,corridor-style.ts}`
- `apps/app/src/components/stat-block.tsx`, `packages/tracks/src/geo.ts`, `packages/i18n/src/ru.ts`
- тесты: `apps/app/src/__tests__/route-detail.test.tsx`, `features/routes/*.test.ts(x)`, `features/maps/*.test.ts(x)`,
  `e2e/web.spec.ts`

## 7. Implementation Notes

- Доля → точка: кумулятивные длины сегментов линии (haversine), бинарный поиск сегмента, линейная интерполяция.
- Ближайшая точка: проекция на сегменты в локальной равнопромежуточной проекции (cos широты); для петли — при
  равных расстояниях (± 15 м) выбрать сегмент ближе к предыдущей доле.
- Уклон: `(e(d+100) − e(d−100)) / 200 м`, у краёв окно сдвигается внутрь; профиль с шагом > 200 м — окно = шаг.

## 8. Risks / Assumptions / Open Questions

- R1: жест long-press + pan внутри `ScrollView` на iOS/Android — проверка на устройстве не в CI (NOT VERIFIED).
- R2: перетаскивание маркера на статичной карте native (MapLibre RN 11) — API маркера уточнить по докам.
- A1: шаг adjustable 1 км; окно уклона 200 м.

## 8.1 Requirements Consistency (заполняет architect)

Architect, 2026-10-27. Сверено по коду ветки и исходникам `node_modules` (context7 в сессии недоступен):
`react-native-gesture-handler` 3.3.0 (`src/v3`, `jestUtils`), `@maplibre/maplibre-react-native` 11.5.0
(`ViewAnnotation`, `Marker`, `MapRef`, `ViewStateChangeEvent`), `maplibre-gl` 6.16. Блокеров нет; S1–S9 в силе, кроме
уточнений ниже (RC-3, RC-4, RC-6 — отклонения от формулировок §2.1/§3, coder заносит их в §8.2).

- **RC-1 · S6 подтверждён, обоснование уточнено.** Без смены API: доля `f = d / distanceM` ↔ та же доля длины линии
  показа. Оговорка: ошибка — не «≤ 5 м»: упрощение срезает длину неравномерно (извилистые участки короче), локальный
  сдвиг на длинном извилистом маршруте — до десятков метров. На обзорном зуме статичной карты (маршрут 10–100 км в
  ~335 pt) это 1–3 pt, концы совпадают точно (доля 0 и 1), прямое и обратное преобразование — одна функция (нет
  дрейфа при «профиль → карта → профиль»). Альтернатива `[d, e, lon, lat]` + рост `ROUTE_DERIVED_VERSION` — смена
  `z.tuple` ломает старые клиенты и требует бэкфилла; не окупается. **Решение: S6 как есть.**
- **RC-2 · Маркер на карте и его перетаскивание (R2, S7).** Проверено по исходникам MapLibre RN 11: `Marker` —
  без перетаскивания; `ViewAnnotation draggable` — свободное перетаскивание с нативной позицией (не липнет к линии
  во время жеста, на iOS — сначала выбор аннотации, на Android — растровый снимок вида), «прилипание» — только
  прыжком после отпускания; источник `GeoJSONSource` с одной точкой — `data` сериализуется на каждом рендере,
  обновление источника асинхронно, а для захвата пальцем всё равно нужна проекция. Альтернативы: (a) **оверлей поверх
  карты на обеих платформах**: маркер — свой вид в `RouteMapFrame` над холстом, позиция в пикселях из проекции линии
  показа, вычисленной один раз после загрузки (web — `map.project` по точкам линии после `load` и на `resize`;
  native — Web Mercator по `ViewState.bounds` из `onRegionDidChange` и `mapRef.getViewState()` после
  `onDidFinishLoadingMap` + размер из `onLayout` оверлея; карта статична — проекция не меняется); профиль → маркер и
  маркер → доля — синхронная математика в пикселях (`scrub-line.ts`); перетаскивание — жест на самом маркере (область
  касания `size.touchMin`), карта не панорамируется (ADR-0014 RC-4 цел); (b) web — `GeoJSONSource.setData` + отдельный
  hit-test, native — `ViewAnnotation draggable` с прыжком после отпускания — две разные модели, на native нет
  «прилипания» во время жеста; (c) native — без перетаскивания маркера (только профиль → карта) — урезание S2.
  **Рекомендация: (a).** Урезание (c) — запасной вариант, если проверка на устройстве покажет неверную проекцию
  (`ViewState.bounds` при `MAP_FIT_PADDING` — видимая область целиком; NOT VERIFIED в CI). Маркер — декоративный
  (скрыт от скринридера), без жеста функциональность та же (S4).
- **RC-3 · Корень жестов и `ScrollView` (R1; уточнение S1).** `GestureHandlerRootView` в проекте нет (RNGH и
  reanimated в зависимостях, в `src` не используются), а `GestureDetector` v3 в `__DEV__` на native бросает без него
  (`useEnsureGestureHandlerRootView`). Альтернативы корня: (a) **`components/gesture-root.tsx` (native —
  `GestureHandlerRootView`) + `gesture-root.web.tsx` (обычный `View`)** вместо внешнего `View style={styles.root}` в
  `app/_layout.tsx` — RNGH не попадает в web-бандл и SSR, DOM web не меняется; (b) локальный root вокруг профиля и
  маркера — два корня внутри `ScrollView`, нестандартно; (c) прямой импорт RNGH в `_layout` — модуль RNGH (web-обработчики,
  `initialize()`) в SSR. **Рекомендация: (a).** Прокрутка: профиль — `usePanGesture({ activateAfterLongPress: 250,
  runOnJS: true })` (до 250 мс палец неподвижен — прокрутка не начата); на активации стор ставит `dragging`, экран
  отключает прокрутку (`scrollEnabled={dragging === null}`; на iOS это же гасит pull-to-refresh), на `onFinalize` —
  возвращает. Маркер карты — блокировка уже на `onBegin` (касание маркера не должно прокручивать экран). Альтернативы:
  `ScrollView`/`RefreshControl` из RNGH v3 с отношениями жестов — меняет общий экран и pull-to-refresh, на CI не
  проверяется; отношения `simultaneous`/`blocks` с нативным `UIScrollView` — неопределённо. Проверка на устройстве —
  NOT VERIFIED (R1).
- **RC-4 · Модель производительности (уточнение S7).** S7 предлагает reanimated shared value для курсора. Но подпись
  (км · м · %) и маркер на карте всё равно живут в JS; reanimated в `src` и jest не настроен (новые моки/`setUpTests`).
  Альтернативы: (a) **колбэки жестов на JS (`runOnJS: true`) → стор на экран → перерисовываются только подписчики**
  (курсор + подпись профиля, вид маркера); `RouteMap`, `GeoJSONSource`, профиль-площадь не перерисовываются (тест);
  (b) reanimated: курсор и маркер на UI-потоке по общему shared value + таблица «доля → пиксель», подпись — `runOnJS`
  с прореживанием; (c) состояние в `route-detail` через `useState` — ре-рендер карты на каждом кадре, запрещено §5.1.
  **Рекомендация: (a)** для этой задачи; (b) — follow-up только при подтверждённых рывках на устройстве (стор
  изолирует замену). 60 fps на устройстве — NOT VERIFIED.
- **RC-5 · Где живёт общий стейт и форма пропса карты.** Пропс «позиция + колбэк» (`position`, `onDrag`) заставил бы
  перерисовывать `RouteLineMap` → `RouteMap` на каждом кадре. Альтернативы: (a) **стор на экземпляр экрана**
  (`zustand/vanilla` `createStore` — zustand уже в зависимостях; чтение `useStore(store, selector)`, SSR —
  начальное состояние) в `features/maps/scrub-store.ts`; состояние `{ fraction 0…1 доли длины линии, active,
  dragging: 'profile' | 'map' | null }`; карта получает **один необязательный пропс `scrub?: ScrubStore`** (читает
  долю, пишет долю при перетаскивании — это и «позиция», и «колбэк»), домен — доля линии, не метры маршрута → карта
  не знает о профиле (переиспользование на карте гонки, S9); (b) React context — тот же ре-рендер потребителей
  контекста без селекторов; (c) свой мини-стор на `useSyncExternalStore` — дубль zustand. **Рекомендация: (a).**
  Стор создаёт `RouteDetailView` (`useState(createScrubStore)`); профиль переводит долю в метры (`f × distanceM`).
  Существующие пропсы `RouteMap`/`RouteLineMap` и `race-route-map.tsx` не меняются; `scrub` не входит в зависимости
  эффекта создания web-карты (иначе пересоздание карты).
- **RC-6 · Сплошная площадь и курсор без новой нативной зависимости (S8).** Щели — артефакт дробной ширины
  `flex: 1` в браузере; Yoga на native округляет к пиксельной сетке (соседние края совпадают). Альтернативы: (a)
  **web — inline SVG в `profile-chart.web.tsx`** (`viewBox` в условных единицах, `preserveAspectRatio="none"`, путь по
  всем точкам профиля ≤ 300, заливка `theme.map.route`; разметка зависит только от данных — SSR = первый рендер);
  **native — прежние столбики `View`** (96, без зазоров за счёт округления Yoga; запасной ход при видимых швах на
  устройстве — нахлёст столбиков на `stroke.hairline`); курсор — абсолютная вертикальная линия `left: f×100%`
  (проценты — раскладка); (b) `react-native-svg` / Skia — новая нативная зависимость, пересборка dev-клиента, без ADR —
  запрещено §5.1; (c) web — `clip-path: polygon(...)` на `div` — тоже SSR-безопасно, но хуже читается и тестируется.
  **Рекомендация: (a).**
- **RC-7 · «Всплывающая карточка» — где (уточнение S3).** Плавающая карточка над курсором на native перекрыта пальцем,
  а удержание в границах графика требует ширины (`onLayout`, на web — расхождение SSR). Альтернативы: (a) **карточка
  в строке заголовка профиля справа, вместо диапазона «191–267 м», пока курсор активен** (`surface.raised`,
  `border.subtle`, `textStyle('label')`), без анимации; (b) плавающая над курсором с ограничением краями — только web
  (мышь не перекрывает), native — (a); (c) строка под графиком — сдвигает раскладку при появлении. **Рекомендация:
  (a)** — одинаково на всех платформах, без расчёта позиции, без скачка раскладки (высота строки заголовка не
  меняется — одна строка `label`).
- **RC-8 · Недоопределено: когда виден маркер и когда скрыт курсор.** S2 требует тащить точку на карте — значит,
  маркер виден и без скраббинга. Альтернативы: (a) **маркер виден всегда** (начально — доля 0, на старте, поверх
  точки старта; дальше — последняя позиция), **курсор и карточка — только при `active`**; деактивация: web-мышь —
  `pointerleave` профиля; web-касание — `pointerdown` вне профиля и маркера (слушатель `document` в эффекте
  `.web`-файла); native — касание (tap) профиля при активном курсоре или начало прокрутки (`onScrollBeginDrag`);
  (b) маркер скрыт до скраббинга профиля — «карта → профиль» недоступна, пока не тронули профиль; (c) после
  деактивации маркер возвращается на старт — скачок. **Рекомендация: (a).** Маркер отличим от старта и финиша без
  цвета: крупнее (`size.icon`), заливка `action.primary`, обводка `map.background` толщиной `stroke.indicator`.
- **RC-9 · Противоречие: «набор от старта» на финише ≠ «Набор» стат-блока.** Набор по профилю (шаг ≥ 25 м, ≤ 300
  точек) теряет мелкие подъёмы — на финише меньше `elevationGainM` сервера. Альтернативы: (a) **масштабировать
  накопленный набор профиля так, чтобы на финише он равнялся `elevationGainM`** (`raw(d) × gainM / raw(total)`; `gainM`
  `null` или `raw(total) = 0` — сырой); (b) показывать сырой (расхождение на финише заметно); (c) не показывать набор.
  **Рекомендация: (a).** Сервер считает итог, клиент лишь распределяет его вдоль маршрута (инвариант §4.1 не задет).
- **RC-10 · Шаг adjustable и уклон — граничные правила (A1).** Increment — к следующему целому километру
  (`floor(d / 1000) + 1` км), decrement — к предыдущему (`ceil(d / 1000) − 1`), границы 0 и `distanceM` (последний
  шаг — до `distanceM`, не целого км); action/клавиша делает курсор активным. Web: ←/↓ и →/↑ — ±1 км, Home/End — 0 и
  `distanceM`. Уклон — `Math.round`, `−0` → `0`; окно `max(200 м, шаг профиля)`, у краёв сдвигается внутрь.
  Значение для скринридера: «12,4 км, высота 231 м, уклон 4 %» / «… уклон −3 %» (минус — знак U+2212, без стрелок).
- **RC-11 · Стат-блок: три колонки на 375 px без поломки других экранов (S8).** Ячейка сейчас `flexBasis: 'auto'`,
  `flexShrink: 0` — сумма ширин содержимого больше 335 pt → перенос третьей. Альтернативы: (a) **необязательный пропс
  `equalColumns`** (ячейки `flexBasis: 0`, `flexGrow: 1`, `flexShrink: 1`, `minWidth: size.rowMin`; перенос текста
  внутри ячейки, «км» уходит под значение при крупном шрифте); включает только карточка маршрута; календарь и
  кофе-райд — без изменений; (b) поменять правило для всех — меняется раскладка `calendar-detail`/`ride-detail`;
  (c) уменьшить отступы `statGap` — токен базы, затронет всё. **Рекомендация: (a).**
- **RC-12 · Reduce motion (S5).** Анимаций переходов нет вообще: маркер, курсор и карточка ставятся мгновенно, без
  `Animated`, CSS `transition` и fade. S5 выполняется независимо от настройки; `useReducedMotion` не нужен (если
  coder добавит хоть одну анимацию — обязан ветвить по `useReducedMotion` из `@rkarakulov/ui`).
- **RC-13 · Web-доступность slider и SSR.** RN-web не поддерживает `accessibilityActions`/`onAccessibilityAction`,
  поэтому web-вариант — отдельный файл: `div role="slider" tabIndex={0}` с `aria-label` (текстовая альтернатива P4 —
  «Профиль высоты: от … до … м, набор … м»), `aria-valuemin=0`, `aria-valuemax=distanceM`, `aria-valuenow`,
  `aria-valuetext` (RC-10), `onKeyDown` с `preventDefault`; видимый фокус — `:focus-visible` в scoped `<style>`
  (образец `attributionCss` + `useId`), обводка `border.focus` толщиной `stroke.indicator`. SSR: стор стартует
  `{ fraction: 0, active: false }` — `aria-valuenow="0"` и текст для 0 км одинаковы на сервере и клиенте; `document`
  — только в эффектах. `touch-action: pan-y` у графика (вертикальная прокрутка пальцем сохраняется), `none` у маркера.
  Роль графика меняется: native `image` → `adjustable`, web `img` → `slider` (тесты и e2e обновляются).

## 8.2 Deviations from spec

- S9: скраббинг на карте гонки — follow-up (компонент проектируется переиспользуемым).
- §14 (оркестратор): чистая логика скраббинга — не `apps/app/features/routes/scrub.ts` + `features/maps/scrub-line.ts`
  (§11), а `@pokatim/tracks` `src/scrub.ts` (лёгкий вход): `cumulativeMeters`, `pointAtFraction`, `nearestFraction`,
  `elevationAt`, `gradeAt`, `gainTo`, `stepDistance`, `profileHeights`/`profilePoints` (перенесены из `format.ts`,
  там — реэкспорт). В приложении — только i18n-подписи (`features/routes/scrub.ts`: `scrubReadout`, `scrubStep`) и
  проекция оверлея (`features/maps/scrub-line.ts`: `mercatorProjector`, `scrubTolerance`, `projectLine`).
- S8 / RC-6 «сплошная площадь» уже выполнены fix'ом профиля (PR #57, `ProfileChart`): вид профиля не переделывался —
  курсор, жесты и slider/adjustable построены поверх него; RC-11 (стат-блок в три колонки) — сделано
  (`StatBlock equalColumns`).
- G1/G2 (§15, решения пользователя): заливка — вертикальный градиент; native-профиль — `react-native-svg` 15.16.0
  (`expo install`, SDK 58) лениво после `svgSupported()` (`load-svg-native.ts`), старый dev-клиент — столбики
  routes-03. Отменяет запрет `react-native-svg` из §5.1 и RC-6 (b). **Web оставлен на inline SVG** (не
  `react-native-svg`): разметка детерминирована для SSR, пакет не попадает в web-бандл; пути и градиент — общие
  (`profile-path.ts`). Курсор native — вертикальная линия-`View` поверх SVG (одинаково с фолбэком).
- `ScrubReadout.gain` — всегда строка (не `string | null`, §11): при `gainM === null` показывается сырой набор
  профиля (RC-9 a).
- Native: тап по профилю — не отдельный `useTapGesture` в `useExclusiveGestures` (§11), а «касание без активации
  pan» (`onFinalize` без `onActivate`) — проще и без композиции. Reanimated 4.7.1 и worklets 0.13 в зависимостях
  есть (на устройстве RNGH их видит), но в jest композиция падает на неполном моке Reanimated
  (`useComposedEventHandler`). Поведение то же; начало прокрутки при касании профиля тоже скрывает курсор (RC-8).
- Jest: кроме `react-native-gesture-handler/jestSetup` — мок обёртки RNGH `reanimatedWrapper` («Reanimated не
  установлен», пути `src` и `lib/module`; в jest RNGH резолвится в `lib/module`): mock Reanimated 4.7 падает на
  `setCSSEventHandler`, `expo-router/testing-library` подменяет пакет пустым объектом, и RNGH v3 падает на
  `isSharedValue`. Значит, jest исполняет путь RNGH «без Reanimated», а на устройстве — с Reanimated: **путь
  детектора жестов на устройстве — NOT VERIFIED** (§12). Конфиги жестов — переменные из `useMemo`, не литералы в
  вызове хука: плагин worklets не превращает колбэки в worklet'ы, с `runOnJS: true` они исполняются на JS.
  Мок `react-native-svg` и `load-svg-native`.
- Экран: стор — `useState(createScrubStore)` + сброс состояния эффектом по `id` (не `useMemo(…, [id])` — lint
  `exhaustive-deps`).
- Готово к интерактивной карте (routes-04b): пересчёт пикселей линии — одна функция `projectLine` на любое изменение
  камеры (web — список `SCRUB_REPROJECT_EVENTS`, native — `viewBounds`/`viewSize` → `useMemo`); пропсы статичности и
  ADR-0014 не менялись.

## 9. Acceptance Criteria

1. Web: hover по профилю — маркер на карте и карточка «км · м · %»; перетаскивание маркера по карте — линия на
   профиле и та же карточка; мышь ушла — курсор скрыт.
2. Native: long-press + перетаскивание по профилю работает, вертикальная прокрутка экрана не ломается.
3. Профиль — `adjustable` (native) / `slider` (web): increment/decrement и ←/→ двигают на 1 км, озвучка
   «12,4 км, высота 231 м, уклон 4 %».
4. Reduce motion — без анимаций переходов.
5. Профиль — сплошная площадь без щелей; стат-блок на 375 px — три колонки.
6. Карта гонки и её тесты — без изменений; SSR карточки без ошибок гидрации.
7. `TURBO_CONCURRENCY=1 pnpm check` зелёный.

## 10. Documentation Impact

`docs/product/routes.md` (раздел «Приложение» — скраббинг профиля и карты, карточка, доступность; из «Что не входит»
убрать «интерактивный профиль»), `.claude/rules/pokatim-app.md` (маршруты: стор скраббинга, `RouteMap.scrub?` —
дополнить строку «единственные изменения карты для каталога», оверлей маркера, `gesture-root(.web)`, развилка
`profile-chart(.web)`, `StatBlock.equalColumns`; jest — `react-native-gesture-handler/jestSetup`). Новая нативная зависимость —
`react-native-svg` 15.16.0 (G2, решение пользователя). ADR не нужен: библиотека отрисовки в рамках уже принятых
решений (не сервис, не хранение данных, не смена архитектуры; версия — из `expo install` под SDK 58, фолбэк без
модуля есть); ADR-0014 RC-4 «статичная карта» сохраняется.

## 11. Implementation Context

Architect, 2026-10-27. Решения — §8.1 (RC-1…RC-13). Только `apps/app`, `packages/i18n`, docs; API, контракты,
`race-route-map.tsx`, `my-route-detail.tsx` — без изменений. Новых зависимостей нет (после §15 G2 —
`react-native-svg` 15.16.0, см. §8.2 и §10).

### ENTRY POINTS

- `apps/app/src/features/routes/route-detail.tsx` — `RouteDetailScreen` создаёт стор (там же `ScrollView`:
  блокировка прокрутки по `dragging`), `RouteDetailView` передаёт его профилю и карте.
- `apps/app/src/features/maps/route-map(.web).tsx` — оверлей маркера при `scrub`.
- `apps/app/src/features/routes/elevation-profile.tsx` — оболочка (заголовок, диапазон/карточка, ось) + `ProfileChart`.

### FILES TO CREATE

- `features/maps/scrub-store.ts` — стор (RC-5):
  ```ts
  export type ScrubDragging = 'profile' | 'map' | null;
  export interface ScrubState { fraction: number; active: boolean; dragging: ScrubDragging }
  export type ScrubStore = StoreApi<ScrubState>; // zustand/vanilla
  export function createScrubStore(): ScrubStore; // { fraction: 0, active: false, dragging: null }
  export function useScrub<T>(store: ScrubStore, select: (state: ScrubState) => T): T; // useStore(store, select)
  ```
- `features/maps/scrub-line.ts` — чистая геометрия линии (переиспользуема картой гонки, S9):
  ```ts
  export type Planar = readonly [x: number, y: number];
  export const SCRUB_LOOP_TOLERANCE_M = 15;
  export function cumulativeMeters(line: readonly (readonly [number, number])[]): number[]; // haversineMeters из @pokatim/tracks, [0 … total]
  export function pointAtFraction(points: readonly Planar[], cumulative: readonly number[], fraction: number): Planar; // бинарный поиск, линейная интерполяция; total 0 → points[0]
  export function nearestFraction(points: readonly Planar[], cumulative: readonly number[], target: Planar, hint: number | null, tolerance: number): number; // проекция на сегменты; кандидаты в пределах best + tolerance → ближайший по доле к hint
  export function mercatorProjector(bounds: readonly [w: number, s: number, e: number, n: number], width: number, height: number): (lonLat: readonly [number, number]) => Planar; // native
  ```
  Допуск петли в пикселях — `SCRUB_LOOP_TOLERANCE_M × (длина линии в px / total м)`.
- `features/maps/scrub-marker.tsx` (native) — `ScrubMarker({ store, points, cumulative, theme })`: подписчик стора
  (`useScrub(store, s => s.fraction)`), абсолютный `View` в пикселях (`size.touchMin` — область касания, внутри круг
  `size.icon`, RC-8), `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`;
  `usePanGesture({ runOnJS: true, onBegin → dragging 'map' + active, onUpdate → nearestFraction(start + translation,
  hint = текущая доля), onFinalize → dragging null })` в `GestureDetector`. Контейнер оверлея — `pointerEvents="box-none"`
  (атрибуция «i» нажимается).
- `features/maps/scrub-marker.web.tsx` — то же на DOM: `div` маркера с `transform: translate(...)`, обновление
  подпиской на стор через ref (без React-рендера на кадр — допустим и рендер одного `div`), pointer events +
  `setPointerCapture`, `touch-action: none`; `aria-hidden`.
- `features/routes/scrub.ts` — чистые функции профиля:
  ```ts
  export const SCRUB_STEP_M = 1000;
  export const GRADE_WINDOW_M = 200;
  export function elevationAt(profile: Profile, d: number): number;          // интерполяция
  export function gradeAt(profile: Profile, d: number): number;              // целый %, окно max(200, шаг), края внутрь, −0 → 0
  export function gainTo(profile: Profile, d: number, totalGainM: number | null): number; // RC-9, целые м
  export function stepDistance(d: number, distanceM: number, direction: 1 | -1): number;  // RC-10
  export function profileAreaPath(elevation: CatalogRouteElevation, distanceM: number, width: number): string; // web SVG, пол — PROFILE_BAR_FLOOR (общий с profileBarHeights)
  export interface ScrubReadout { distance: string; elevation: string; grade: string; gain: string | null; valueText: string }
  export function scrubReadout(elevation: CatalogRouteElevation, distanceM: number, gainM: number | null, d: number): ScrubReadout;
  ```
  `Profile = CatalogRouteElevation['profile']`; числа — `i18n.formatNumber` (запятая, базовая локаль SSR).
- `features/routes/profile-chart.tsx` (native) — столбики (как сейчас) + курсор + `adjustable`:
  `accessibilityRole="adjustable"`, `accessibilityLabel` = `profileSummary`, `accessibilityValue={{ text }}`,
  `accessibilityActions` increment/decrement → `stepDistance`; `usePanGesture({ activateAfterLongPress: 250,
  runOnJS: true, onActivate → dragging 'profile', onUpdate → fraction = x / ширина, onFinalize → dragging null })` +
  `useTapGesture` (снять `active`), композиция `useExclusiveGestures`; ширина — `onLayout` (только native-файл;
  до `onLayout` жест игнорируется). Без `scrub` — статичное изображение, как в routes-03.
- `features/routes/profile-chart.web.tsx` — SVG-площадь (RC-6) + курсор + slider (RC-13): `pointermove` (мышь —
  hover; касание — после `pointerdown`), `pointerleave` (мышь) → `active: false`, `pointerdown` вне — слушатель
  `document` в `useEffect`; `onKeyDown` ←/↓/→/↑/Home/End.
- `features/routes/scrub-readout.tsx` — карточка «12,4 км · 231 м · ↗ 4 % · набор 180 м» (RC-7), общая для платформ,
  скрыта от скринридера (значение озвучивает график).
- `components/gesture-root.tsx` (`GestureHandlerRootView`) и `components/gesture-root.web.tsx` (`View`), пропсы
  `{ style, children }` (RC-3).

### FILES TO MODIFY

- `features/maps/route-map-props.ts` — `scrub?: ScrubStore` с JSDoc (routes-04; нет — маркера нет, карта гонки).
- `features/maps/route-map.tsx` — `onDidFinishLoadingMap` → `mapRef.current?.getViewState()` + `onRegionDidChange`
  (bounds) + `onLayout` оверлея → `mercatorProjector` → пиксели линии (`useMemo` по bounds/размеру) → `<ScrubMarker>`
  после `lib.Map` внутри `RouteMapFrame`, только при `scrub`. `features`/`layers` — по-прежнему `useMemo`;
  `RouteMap` не подписан на стор.
- `features/maps/route-map.web.tsx` — после `load` и на `resize`: `created.project` по точкам `map.line` → state
  пикселей (`setState` раз на загрузку/ресайз) → `<ScrubMarker>` (web) сиблингом холста; **`scrub` не в массиве
  зависимостей эффекта создания карты** (стор стабилен, читать через ref).
- `features/routes/route-line-map.tsx` — `scrub?: ScrubStore` в `RouteLineMapProps` → `LineMap` → `RouteMap`.
- `features/routes/catalog-route-map.tsx` — `{ route, scrub? }` → `RouteLineMap`.
- `features/routes/elevation-profile.tsx` — `scrub?: ScrubStore`; заголовок: диапазон или `ScrubReadout` при
  `active` (подписка — только этот подкомпонент); график — `ProfileChart`. `PROFILE_BARS`, `PROFILE_ASPECT_RATIO`
  остаются экспортом.
- `features/routes/format.ts` — экспорт `PROFILE_BAR_FLOOR` (или функция высоты-доли), чтобы SVG и столбики имели
  один масштаб.
- `features/routes/route-detail.tsx` — `RouteDetailScreen`: стор на `id` (`useMemo(createScrubStore, [id])`),
  `scrollEnabled={useScrub(scrub, s => s.dragging === null)}`, `onScrollBeginDrag` → `active: false` (RC-3, RC-8);
  ре-рендер экрана — дважды за жест (начало/конец), не на кадр. `RouteDetailView` получает `scrub`:
  `<CatalogRouteMap route scrub={route.elevation ? scrub : undefined}>` (нет профиля — нет маркера: синхронизировать
  нечего), `<ElevationProfile … scrub>`, `<StatBlock equalColumns …>`.
- `components/stat-block.tsx` — `equalColumns?: boolean` (RC-11); по умолчанию поведение прежнее.
- `app/_layout.tsx` — внешний `View style={[styles.root, …]}` → `GestureRoot` с тем же стилем.
- `jest.setup.ts` — `import 'react-native-gesture-handler/jestSetup'`; мок MapLibre — без новых компонентов (маркер
  — свой вид), при необходимости `getViewState` в стабе `Map` не нужен: тест шлёт `onRegionDidChange`.
- `packages/i18n/src/ru.ts` — `routes.detail.scrub.*`: `distance` («{km} км»), `elevation` («{m} м»), `gradeUp`
  («↗ {grade} %»), `gradeDown` («↘ {grade} %»), `gradeFlat` («→ 0 %»), `gain` («набор {gain} м»), `value` («{km} км,
  высота {m} м, уклон {grade} %»).
- `e2e/web.spec.ts` — шаг маршрута (блок `E2E_API`): `getByRole('img', …)` → `getByRole('slider', { name: /^Профиль
  высоты: от / })`; фокус + `ArrowRight` → `aria-valuetext` `/^1 км, высота \d+ м, уклон −?\d+ %$/`; hover по графику →
  видна карточка `/км · \d+ м/`; `mouse.move` за пределы → карточка скрыта; консоль без ошибок гидрации.

### FILES TO READ

`features/maps/{corridor-style.ts,route-map-frame.tsx,attribution.web.ts,track-style.ts}`,
`features/maps/route-map.web.test.tsx` (FakeMap: добавить `project`, `on('resize')`), `features/routes/format.ts`
(`profileBars`, `profileBarHeights`, `profileSummary`, `profileTicks`), `lib/use-minsk-clock.ts` (`useMounted`),
`packages/tracks/src/geo.ts`, `node_modules/react-native-gesture-handler/src/v3/hooks/gestures/pan/PanTypes.ts`,
`node_modules/react-native-gesture-handler/src/jestUtils/jestUtils.ts` (`fireGestureHandler`, `getByGestureTestId`),
`node_modules/@maplibre/maplibre-react-native/src/components/map/Map.tsx` (`ViewStateChangeEvent`, `MapRef`).

### TYPES & SCHEMAS

Контракты не меняются: `CatalogRouteElevation.profile` (`[d, e]`, ≤ 300), `RouteMapGeometry.line` (≤ 1000 `[lon,
lat]`), `CatalogRouteDetail.distanceM`, `elevationGainM`. Новые типы — только в приложении (`ScrubStore`,
`ScrubState`, `Planar`, `ScrubReadout`).

### TDD — порядок

1. `scrub.ts` + `scrub.test.ts` (чистые функции, RC-9/RC-10).
2. `scrub-line.ts` + `scrub-line.test.ts`.
3. `scrub-store.ts` + тест.
4. `StatBlock equalColumns` + `stat-block.test.tsx`.
5. `profile-chart.web.tsx` + `profile-chart.web.test.tsx` (SSR, slider, pointer, клавиши).
6. `jest.setup.ts` (RNGH) → `profile-chart.tsx` + обновление `elevation-profile.test.tsx`.
7. `gesture-root(.web).tsx` + `_layout.tsx` (тесты маршрутов зелёные).
8. `route-map.web.tsx` + `route-map-scrub.web.test.tsx`; 9. `route-map.tsx` + `route-map-scrub.test.tsx`.
10. `route-line-map`/`catalog-route-map`/`route-detail` + `route-detail.test.tsx`.
11. i18n → e2e → docs → `TURBO_CONCURRENCY=1 pnpm check`.

### TESTS (матрица)

| Уровень | Файл | Что |
|---|---|---|
| unit (native jest) | `features/routes/scrub.test.ts` | интерполяция высоты; уклон: окно ±100 м, края внутрь, шаг > 200 м → окно = шаг, округление, `−0`; набор: масштаб к `gainM`, `null`/0 — сырой, монотонность; шаг: целые км, границы 0 и `distanceM`, decrement с нецелого; подписи: запятая, знак U+2212, ↗/↘/→; `profileAreaPath` — замкнутый путь, ровный профиль — середина |
| unit | `features/maps/scrub-line.test.ts` | кумулятивная длина; доля 0/1/середина, вырожденная линия; ближайшая точка на прямой, out-and-back и петле (старт = финиш) с `hint` — выбор соседнего участка; без `hint` — глобальный минимум; `mercatorProjector` — углы рамки → углы вида, центр по широте не линейно |
| unit | `features/maps/scrub-store.test.ts` | начальное состояние, `setState` слияние, селектор |
| component native | `components/stat-block.test.tsx` | `equalColumns` — `flexBasis: 0`, `flexShrink: 1`; без пропса стиль прежний (календарь/райд) |
| component native | `features/routes/elevation-profile.test.tsx` | роль `adjustable`, label = сводка P4, `accessibilityValue.text`; `accessibilityAction` increment/decrement → стор и текст; long-press-pan через `fireGestureHandler(getByGestureTestId(...))` → `dragging`, курсор, карточка; tap → скрыто; без `scrub` — прежнее изображение |
| component native | `features/maps/route-map-scrub.test.tsx` | без `scrub` — маркера нет, дерево как раньше (карта гонки); с `scrub` после `onRegionDidChange` + `onLayout` — маркер в пикселях; `store.setState` × N → `GeoJSONSource` не перерисован (`jest.spyOn` на мок компонента) ; pan маркера → доля прилипает к линии, `dragging` 'map' на `onBegin` |
| component web | `features/routes/profile-chart.web.test.tsx` | `renderToString` = первый клиентский рендер (SSR); `<svg><path>` вместо столбиков; `role="slider"`, `aria-*`; ←/→/Home/End; `pointermove` → доля; `pointerleave` → `active: false`; `pointerdown` вне → скрыто |
| component web | `features/maps/route-map-scrub.web.test.tsx` | `project` после `load`; обновление стора двигает маркер, `new Map` вызван один раз, `addSource` не повторён; `resize` пересчитывает; pointer-drag маркера → доля |
| screen native | `__tests__/route-detail.test.tsx` | `getByRole('adjustable', { name: /^Профиль высоты/ })`; increment показывает карточку «1 км · …»; `dragging` → `ScrollView scrollEnabled={false}`; стат-блок `equalColumns`; API без `elevation` — без профиля и без маркера |
| неизменность | `race-route-map` тесты, `route-map.web.test.tsx`, `route-map-corridor.web.test.tsx`, `my-route-*` | без правок (кроме FakeMap: `project`/`resize` при необходимости) |
| e2e web (`E2E_API=1`) | `e2e/web.spec.ts` | slider, клавиши, hover-карточка, уход мыши; гидрация без ошибок. Карта в e2e не грузится (env стиля не задан) — маркер e2e не покрыт, только jest |
| устройство | — | R1 (long-press-pan в `ScrollView` iOS/Android), R2 (проекция маркера, `ViewState.bounds`), 60 fps, швы столбиков — NOT VERIFIED в CI, фиксировать в §12 |

### OUT OF SCOPE

API/контракты/бэкфилл; карта гонки и `race-route-map.tsx`; `my-route-detail.tsx` (у своих маршрутов нет профиля);
reanimated (RC-4 b — follow-up); панорамирование/зум; уклоны цветом; плавающая карточка у курсора (RC-7 b).

## 12. Outcome (заполняет coder)

Coder, 2026-10-27. Не закоммичено (коммит и push — оркестратор).

- **Пакет `@pokatim/tracks`:** `src/scrub.ts` (лёгкий вход, экспорт из `index.ts`) — доля ↔ точка, ближайшая точка с
  подсказкой (локальные минимумы вдоль линии в пределах допуска → ближний к подсказке; петля и «туда-обратно» не
  прыгают), высота/уклон (окно `max(200 м, шаг)`, края внутрь, `−0` → 0)/набор (масштаб к `gainM`), шаг 1 км,
  `profileHeights`/`profilePoints` (из `format.ts`, там реэкспорт).
- **app:** стор `features/maps/scrub-store.ts`; оверлей маркера `scrub-marker(.web).tsx` + `scrub-line.ts`
  (`mercatorProjector`, `scrubTolerance`, `projectLine`); `RouteMap.scrub?` (native — рамка камеры + `onLayout`,
  web — `map.project` на `load`/`resize`, карта не пересоздаётся); `ProfileChart` (web — inline SVG c градиентом,
  `slider`, pointer/клавиши/`:focus-visible`; native — `react-native-svg` лениво, фолбэк — столбики, `adjustable`,
  long-press-pan RNGH v3); карточка курсора `scrub-readout.tsx` на месте диапазона; `GestureRoot` в `_layout`;
  `StatBlock equalColumns`; экран — стор, `scrollEnabled` по `dragging`, `onScrollBeginDrag`; i18n
  `routes.detail.scrub.*`; e2e — slider/клавиши/hover/уход мыши.
- **Зависимость:** `react-native-svg` 15.16.0 (`npx expo install`, `pnpm-lock.yaml`) — нужна новая dev-сборка
  (старая — фолбэк на столбики).
- **Docs:** `docs/product/routes.md` (скраббинг, «Что не входит»), `.claude/rules/pokatim-app.md` (скраббинг, профиль,
  `RouteMap.scrub?`, jest).
- **Проверки:** `MONGO_URL_TEST=… REDIS_URL_TEST=… TURBO_CONCURRENCY=1 pnpm check` (Node 24.22.1) — exit 0: format,
  lint, arch (`no dependency violations`), typecheck 8/8, тесты 13/13 задач (app: 128 suites / 1117 tests; tracks 21
  файлов; api 105; admin 26).
- **NOT VERIFIED:** путь RNGH v3 с Reanimated на устройстве (jest — без Reanimated, §8.2); e2e `pnpm e2e:web` (нужен стенд API, `E2E_API=1`) — шаг написан, не запускался; web-сборка и
  гидрация в браузере; устройство: R1 (long-press-pan в `ScrollView` iOS/Android, pull-to-refresh при жесте), R2
  (проекция маркера по `ViewState.bounds` при `MAP_FIT_PADDING`, перетаскивание маркера), 60 fps, вид
  `react-native-svg` (градиент, `vectorEffect`) и фолбэк в старом dev-клиенте, 3 колонки стат-блока на 375 pt при
  крупном шрифте, перенос карточки курсора в заголовке на 375 pt.

## 14. Вход для routes-05 (панель)

Пользователь 2026-10-27: в панели при просмотре маршрута — настоящая карта MapLibre GL JS, толстая линия, профиль высоты
с цифрами и тот же связанный скраббинг. Поэтому чистая логика скраббинга (точка по доле, ближайшая точка линии,
высота/уклон/набор по дистанции, шаг) и `profilePoints` — в общем пакете (лёгкий вход `@pokatim/tracks` без парсеров,
файл `src/scrub.ts`), а не в `apps/app`; приложение и панель импортируют её оттуда. UI панели — routes-05.

## 15. Дополнения пользователя по ходу (2026-10-27)

- **G1 — градиент заливки профиля:** заливка под линией — вертикальный градиент от линии (насыщеннее) к низу
  (прозрачно), цвет — роль темы (`map.corridor`), обе темы.
- **G2 — react-native-svg (решение пользователя: «Да, добавить»):** новая нативная зависимость через `expo install`
  (версия под SDK 58); профиль на native — тот же SVG (плавная линия + градиент + курсор скраббинга), один код с web
  через `react-native-svg` (на web он рендерит `<svg>`; или оставить inline SVG на web — решает coder по SSR).
  Старая dev-сборка без модуля — безопасный фолбэк на нынешний силуэт из столбиков (детект нативного модуля, как
  `map-support.ts` у MapLibre); в jest — мок. Нужна новая dev-сборка — в pr.md как NOT VERIFIED на устройстве.
