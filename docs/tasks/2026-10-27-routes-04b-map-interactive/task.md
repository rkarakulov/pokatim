# routes-04b — интерактивная карта: перетаскивание и зум (маршрут и гонка)

Уровень: task3. Ветка `feature/routes-04b-map-interactive` от `origin/develop` (после routes-04, PR #58). Связано:
ADR-0014 (карты; меняется правило статичной карты), routes-04 (`docs/tasks/2026-10-27-routes-04-scrub/task.md` —
маркер скраббинга, `projectLine`, `SCRUB_REPROJECT_EVENTS`), maps-01/02 (карта гонки, коридор, свой трек),
`decisions.md` этой папки (решения пользователя I1, I2).

## 1. Title

Карта маршрута и гонки — интерактивная: перетаскивание и зум без поломки прокрутки страницы и скраббинга.

## 2. Goal

Пользователь: «нужно так же уметь карту двигать, увеличивать и уменьшать (зум)». Сейчас карта статична (ADR-0014
RC-4: жесты выключены пропсами). Райдер хочет рассмотреть участок маршрута, не уходя с карточки.

## 2.1 Продуктовые решения (пользователь, 2026-10-27)

| # | Вопрос | Решение |
|---|---|---|
| I1 | Жесты на телефоне без поломки прокрутки страницы | **двумя пальцами**: одним пальцем — прокрутка страницы (и перетаскивание маркера скраббинга), двумя — перетаскивание, пинч-зум карты; web-мышь — перетаскивание карты, колесо **с Ctrl/⌘** — зум (без модификатора — прокрутка страницы, подсказка «Ctrl + колесо — масштаб» по образцу кооперативных жестов); кнопки «+», «−» и «вернуть маршрут в рамку»; двойной тап/клик — приближение |
| I2 | Карта гонки (коридор, свой трек) | **та же интерактивность** — общий `RouteMap`; скраббинг на карте гонки — по-прежнему follow-up |
| I3 | «Вернуть в рамку» | кнопка видна, когда камера ушла от рамки маршрута (или всегда — решает architect по простоте); возврат — без анимации при reduce motion |
| I4 | Маркер скраббинга | остаётся на линии при любом положении камеры (пересчёт проекции на каждое изменение камеры — routes-04 готов) |

## 3. Scope

- **app (`features/maps`):**
  - `RouteMap` native (`@maplibre/maplibre-react-native` 11) и web (`maplibre-gl` 6): включить перетаскивание и зум по
    I1 (web — `cooperativeGestures` или аналог: проверить опции maplibre-gl 6; native — жесты двумя пальцами: найти
    поддержку в MapLibre RN 11 или обёртку на RNGH поверх карты — решает architect), двойной тап — зум, ограничения
    зума (min — рамка всей Беларуси/маршрута, max — разумный);
  - контролы: «+», «−», «в рамку» — компоненты дизайн-системы (`@rkarakulov/ui`, иконки), доступные (`accessibilityLabel`,
    крупные цели `size.touchMin`), не перекрывают атрибуцию;
  - маркер скраббинга: пересчёт проекции на `move`/`zoom` (web — `SCRUB_REPROJECT_EVENTS`, native — изменение
    камеры/`ViewState`), производительность — без ре-рендера `RouteMap`;
  - карта гонки (`race-route-map.tsx`) — получает поведение автоматически через `RouteMap`; её тесты обновить.
- **i18n:** `maps.controls.*` (подписи кнопок, подсказка кооперативных жестов).
- **docs:** ADR-0014 — дополнение «Интерактивная карта (routes-04b)» вместо RC-4 статичности; `pokatim-app.md`
  (раздел карты), `docs/product/routes.md`, `docs/product/races-and-seasons.md` (карта гонки).

## 4. Out of Scope

- Полноэкранная карта, слои, вращение и наклон (pitch/bearing — выключены).
- Скраббинг на карте гонки.
- Карта в панели (routes-05).

## 5.1 Placement & Reuse Gate

- Reuse: `features/maps/*` (`MAP_FIT_PADDING`, `unionBounds`, `scrub-line.ts projectLine`, `SCRUB_REPROJECT_EVENTS`,
  `route-map-frame.tsx`, атрибуция), `@rkarakulov/ui` (кнопки/иконки), RNGH (корень `GestureRoot` уже есть).
- Запрещено: второй компонент карты; `Platform.OS` в компонентах; новая нативная зависимость без решения architect;
  ре-рендер карты на кадр.
- Architect (2026-10-27): placement — только `apps/app/src/features/maps/*` (+ провайдер блокировки прокрутки в трёх
  экранах, строки `packages/i18n`); новый пакет не нужен. Reuse: `cooperativeGestures` `maplibre-gl` (RC-1), RNGH v3
  (`usePanGesture`/`usePinchGesture`/`useTapGesture`, уже в зависимостях), `CameraRef` MapLibre RN, `projectLine` +
  `mercatorProjector`, `unionBounds`, `MAP_FIT_PADDING`, `useReducedMotion` базы, образец `TopBar` (`Pressable` +
  `SymbolView`). `IconButton` в `@rkarakulov/ui` нет — локальный `MapControls` + follow-up в app-foundation (RC-5).
  Новых нативных зависимостей нет; RNGH — только в native-файлах (web-бандл без RNGH).

## 8. Risks / Assumptions

- R1: жесты двумя пальцами в MapLibre RN 11 внутри `ScrollView` — поведение на устройстве (NOT VERIFIED в CI).
- R2: web `cooperativeGestures` на тач-устройствах (два пальца) — проверить в мобильном браузере.
- A1: вращение и наклон выключены.

## 8.1 Requirements Consistency (заполняет architect)

Architecture review 2026-10-27 (API сверено по исходникам `node_modules`: `maplibre-gl` 6.16.0,
`@maplibre/maplibre-react-native` 11.5.0, `react-native-gesture-handler` 3.3.0, `@rkarakulov/ui` 0.4.1; context7
недоступен). Вердикт — **CONCERNS** (блокеров нет; RC-2, RC-3 проверяются только на устройстве — R1).

**RC-1. Web: штатный `cooperativeGestures` закрывает I1 целиком.** Проверено в `maplibre-gl-dev.mjs`:
`CooperativeGesturesHandler` — колесо без модификатора не обрабатывается картой (`ScrollZoomHandler._shouldBePrevented`:
пропускает `e.ctrlKey || metaKey` на Mac / `ctrlKey` иначе; без них — `notifyGestureBlocked`, `preventDefault` нет →
страница прокручивается); тач — `TouchPanHandler` требует ≥ 2 пальцев, CSS `.maplibregl-cooperative-gestures` ставит
холсту `touch-action: pan-x pan-y` (один палец — прокрутка браузером, щипок двумя — карте); мышь тащит карту без
модификатора; двойной клик/тап — `doubleClickZoom` (по умолчанию). Подсказка — встроенный слой
`maplibregl-cooperative-gesture-screen` (desktop «Ctrl/⌘ + колесо», mobile «два пальца» по `@media (hover:none),
(pointer:coarse)`), строки — опция `locale` (`CooperativeGesturesHandler.WindowsHelpText` / `MacHelpText` /
`MobileHelpText`, плюс `Map.Title` — `aria-label` холста, при `interactive` у него `tabindex=0`).
- (a) `interactive: true` + `cooperativeGestures: true` + `locale` из `@pokatim/i18n` — **рекомендовано**;
- (b) свой обработчик `wheel` с Ctrl и своя подсказка — дубль библиотеки;
- (c) `interactive: true` без кооперативного режима — колесо и палец «съедают» прокрутку страницы (нарушает I1).
Вращение и наклон (A1): `dragRotate: false`, `pitchWithRotate: false`, `touchPitch: false`, `maxPitch: 0`, после
создания — `touchZoomRotate.disableRotation()`, `keyboard.disableRotation()`.

**RC-2. Native: в MapLibre RN 11.5 «только двумя пальцами» нет — жесты карты ведёт RNGH.** Пропсы `dragPan` /
`touchZoom` / `doubleTapZoom` / `doubleTapHoldZoom` — только вкл/выкл; `dragPan` на Android в `onTouchEvent` зовёт
`requestDisallowInterceptTouchEvent(true)` — один палец забирает прокрутку у `ScrollView`. Пропсов `scrollEnabled` /
`zoomEnabled` у v11 нет (есть только эти имена).
- (a) включить нативные `dragPan`/`touchZoom` — один палец двигает карту, прокрутка ломается (нарушает I1);
- (b) **рекомендовано:** нативные жесты карты остаются выключены (как сейчас — тест карты гонки на пропсы остаётся
  верным), `GestureDetector` вокруг обёртки карты: `usePanGesture({ minPointers: 2, maxPointers: 2, averageTouches:
  true })` + `usePinchGesture` + `useTapGesture({ numberOfTaps: 2 })` в `useSimultaneousGestures`, `runOnJS: true`;
  камера — императивно `CameraRef.jumpTo({ center, zoom })` на кадр (без ре-рендера), кнопки и двойной тап —
  `zoomTo`/`fitBounds`; математика — чистая `cameraAfterGesture` (точка под пальцами остаётся под ними, зум ограничен);
  новых нативных зависимостей нет (RNGH и корень `GestureRoot` уже есть, в web-бандл RNGH не попадает — код жестов
  только в native-файлах);
- (c) урезание: только нативный щипок (`touchZoom`) + кнопки, без перетаскивания двумя пальцами — только через §8.2 с
  пользователем, если (b) на устройстве окажется неприемлемым (дёргание камеры).

**RC-3. Native: прокрутка страницы во время жеста двумя пальцами.** RN `ScrollView` о RNGH не знает: iOS-панорама
`UIScrollView` принимает и два пальца — без блокировки страница едет вместе с картой.
- (a) **рекомендовано:** контекст `MapGestureLockContext` (`features/maps/map-gesture-lock.tsx`): `RouteMap` native
  сообщает `true` на активации жеста карты (`onActivate` пана/щипка — не `onBegin`: он приходит и для одного пальца) и
  `false` на `onDeactivate` последнего из активных (счётчик: pan и pinch активны одновременно; `onFinalize` приходит и
  для не активированного жеста); экраны (`race-detail`, `route-detail`, `my-route-detail`) — `useMapGestureLock()` →
  `scrollEnabled = !mapGesture` (на `route-detail` — `&&` с `useScrubScrollEnabled`). Ре-рендер экрана — дважды за жест
  (как routes-04 RC-3). Web контекст не вызывает (браузер разводит жесты сам через `touch-action`), `scrollEnabled` там
  всегда `true` — RN-web не получает `overflow: hidden` (M2 routes-04). Значение по умолчанию контекста — no-op (карта
  вне провайдера работает);
- (b) RNGH v3 `ScrollView` + отношение `block` — замена `ScrollView` и `RefreshControl` на трёх экранах, больше риска;
- (c) проп `onCameraGesture` у `RouteMap` — проброс через `RaceRouteMap`, `CatalogRouteMap`, `RouteLineMap`.
Остаточный риск (R1): пока жест не активирован (порог пана), страница может сдвинуться на несколько пикселей.

**RC-4. Маркер скраббинга при движении камеры — без ре-рендера `RouteMap` (I4).** Сейчас пиксели линии — `useState`
внутри `RouteMap` (web `setLinePoints`, native `viewBounds`/`viewSize`): с `move` это ре-рендер карты на кадр (запрет
§5.1). Решение: стор проекции на экземпляр карты (`createMapViewStore`, `zustand/vanilla`, `{ points: Planar[] |
null }`), подписан только дочерний `ScrubLayer`; web — `SCRUB_REPROJECT_EVENTS = ['resize', 'move']` (`move` приходит и
на зум), native — `onRegionIsChanging` + `onRegionDidChange` (регистрируются всегда — нужны и камере жестов: последний
`ViewState` в ref; первый — `getViewState()` на `onDidFinishLoadingMap`), размер — `onLayout` оверлея в ref; пиксели —
`projectLine(map.line, mercatorProjector(bounds, w, h))`. `ScrubMarker` native: `points` теперь меняются на кадр
камеры — конфиг `usePanGesture` не должен от них зависеть (M1 routes-04): точки и допуск — из ref, читаются в
`onBegin`/`onUpdate`; `MarkerDot` получает точки пропсом (двигается вместе с линией). Альтернатива — оставить
`useState` в `RouteMap` (проще, но ре-рендер карты и пересериализация `GeoJSONSource.data` на native — отвергнуто).

**RC-5. Кнопки «+», «−», «в рамку»: в `@rkarakulov/ui` 0.4.1 нет `IconButton` и иконок** (экспорт: `Button`,
`TextAction`, `Chip`, `Pill`… — `Button` 48 px с заглавной подписью). Прецедент проекта — `TopBar`: `Pressable` +
`SymbolView` (`expo-symbols`, SF Symbols / Material Symbols).
- (a) **рекомендовано:** локальный `MapControls` в `features/maps/` (`Pressable` + `SymbolView`, цель `size.touchMin`,
  `accessibilityRole="button"`, подписи `maps.controls.*`, роли `surface.raised` / `border.*` / `text.primary`, отклик
  `motion.pressedOpacity`) + follow-up в app-foundation: `IconButton` в `@rkarakulov/ui` (второй потребитель —
  `TopBar`, R8 блока 02) — отметить в §8.2 как отклонение от «компоненты `@rkarakulov/ui`»;
- (b) ждать `IconButton` базы — блокирует слайс;
- (c) `Button` базы с «+»/«−» текстом — 48 px, uppercase, не иконка, на карте 220 px не помещается.

**RC-6. Размещение контролов.** Колонка сверху справа (inset `space.s2`, зазор `space.s1`): 8 + 3 × 44 + 8 = 148 px;
атрибуция «i» — снизу справа (B2 maps-02) — не пересекаются даже при ширине карты 280 (высота ≈ 187). Рамка маршрута
не должна уходить под кнопки: `MAP_FIT_PADDING.right` = `size.touchMin + space.s2` (52; было `MAP_PADDING` 36) —
меняется и начальная камера, и «в рамку». Контролы — только когда карта готова (native — `lib`, web — экземпляр
создан) и не при `failed`. Альтернативы: ряд под картой (не перекрывает ничего, но отделён от карты, +44 px высоты
карточки); «в рамку» отдельно слева сверху.

**RC-7. «В рамку» (I3) — видна всегда.** Проще: без подписки контролов на камеру и сравнения с допуском. Альтернатива —
показывать при уходе камеры: подписка на стор вида, сравнение центра/зума, мигание кнопки при щипке у границы.

**RC-8. Ограничения зума — константы `MAP_MIN_ZOOM = 4`, `MAP_MAX_ZOOM = 17`, без `maxBounds`.** Zoom 4 при 375 px
— ≈ 1100 км по ширине (вся Беларусь с запасом; начальная рамка любого реального маршрута не обрезается —
`minZoom` выше зума рамки сломал бы вписывание), 17 — уровень улиц (тайлы OpenFreeMap до 14, выше — overzoom; коридор
— выражение до 22). Web — опции `minZoom`/`maxZoom`, native — пропсы `Camera minZoom`/`maxZoom` + `clampZoom` в
математике жестов. Альтернативы: динамический минимум «зум рамки − k» (на native нет `cameraForBounds`, нужен async
`getZoom` и второй рендер); `maxBounds` по Беларуси — ломает «Мои маршруты» за границей.

**RC-9. Reduce motion.** `useReducedMotion()` базы (`null` — как «уменьшить»): кнопки и двойной тап — без анимации
(web `zoomIn/zoomOut/fitBounds({ animate: false })`, native `duration: 0`); иначе `MAP_CAMERA_ANIMATION_MS` (300; токена
длительности в `motion` нет — константа с follow-up токена). Native `CameraRef.fitBounds` по умолчанию — 2000 мс
`'fly'`: длительность и `easing: 'ease'` передавать всегда. `maplibre-gl` сам гасит `easeTo` и инерцию при
`prefers-reduced-motion` (`browser.prefersReducedMotion`) — опцию карты `reduceMotion` не использовать (меняет
глобальный флаг модуля). Затухание слоя подсказки — `transition: none` под `@media (prefers-reduced-motion: reduce)` в
CSS области карты (`attribution.web.ts`).

**RC-10. Оформление подсказки web.** CSS MapLibre: фон `rgba(0,0,0,.4)`, текст `#fff` — чужой хром, нейтральный в обеих
темах (как затемнение `overlay.scrim`); перекрашивать не нужно. Свои правила (reduce motion) — только в области
`[data-route-map]`. Альтернатива — своя подсказка по `cooperativegestureprevented` — дубль.

**RC-11. Доступность перетаскивания.** Правило `pokatim-app.md`: «`accessibilityActions` вместо единственного
drag-жеста». Зум — есть кнопки; сдвиг карты на native без жеста недоступен. Рекомендация: принять как исключение —
карта не единственный носитель (подпись-альтернатива рамки, `adjustable` профиля, «в рамку»); web — фокус холста
(`Map.Title` = `maps.canvas`) и клавиши стрелок/±. Альтернативы: `accessibilityActions` «сдвинуть на север/юг…» на
слое-изображении — шум для скринридера; кнопки-стрелки — перегруз 220 px. Записать исключение в ADR-0014.

**RC-12. Охват: три экрана, не два.** `RouteMap` общий — интерактивность получают карточка гонки, маршрута каталога и
«Моего маршрута» (`my-route-detail` → `RouteLineMap`). Противоречия с I2 нет; провайдер блокировки (RC-3) — во всех трёх,
`docs/product/routes.md` — и про «Мои маршруты».

**RC-13. Проверка в CI.** В `e2e/project.ts` нет `EXPO_PUBLIC_MAP_STYLE_*` — карта в смоуке не рендерится, жесты в e2e
не проверить без тайлов и WebGL. Рекомендация: jest (web — опции и обработчики `FakeMap`; native — мок `Camera`/`Map`
с ref и `createGestureController` RNGH), смоук гидрации без изменений; устройство и мобильный браузер — ручная проверка
на dev (`deploy-dev.yml` с OpenFreeMap) — NOT VERIFIED (R1, R2). Альтернатива — стиль-заглушка и WebGL в Playwright —
отдельная инфраструктурная задача.

**RC-14. Карта гонки не ломается (I2).** Коридор — `interpolate exponential 2` по `zoom` со стопами 0…22 и минимумом
`CORRIDOR_MIN_WIDTH_PX` — корректен на любом зуме в пределах 4–17; трек (`my-track`) — те же слои; `key` карты (тема,
рамка, попытка) по-прежнему пересоздаёт карту и сбрасывает камеру. Тест `race-route-map.test.tsx` на выключенные
нативные пропсы жестов остаётся (RC-2 b), добавляются `Camera minZoom/maxZoom` и контролы; web-тест
`interactive: false` → новые опции.

**RC-15. Подсказка на native не нужна.** I1 требует подсказку только для колеса web; на телефоне один палец прокручивает
страницу (ожидаемо), второй палец — карта. Рекомендация: без подсказки (меньше шума); вернуться по отзывам.

## 8.2 Deviations from spec

- D1 (RC-5, принято architect): кнопки камеры — локальный `features/maps/map-controls.tsx` (`Pressable` + `SymbolView`),
  а не компонент `@rkarakulov/ui` (§3 «компоненты дизайн-системы»): `IconButton` в базе нет. Follow-up в
  app-foundation — `IconButton` (второй потребитель — `TopBar`) и токен длительности анимации камеры.
- D2 (RC-11, принято architect): сдвиг карты на native без `accessibilityActions` — исключение из правила
  `pokatim-app.md`, записано в ADR-0014 (дополнение routes-04b, п. 6).
- D3: двойной тап на native — `CameraRef.easeTo({ center, zoom, duration, easing: 'ease' })`, а не `zoomTo` (§11): у
  `zoomTo` MapLibre RN 11.5 нет центра (только `CameraOptions`), «вокруг точки» (`zoomAround`) без центра невозможно.
- D4: web-jest — `apps/app/jest.match-media.web.ts` (`setupFiles` web-проекта): в jsdom нет `window.matchMedia`,
  react-native-web тогда возвращает из `AccessibilityInfo.addEventListener` `undefined`, и `useReducedMotion` базы
  падает при размонтировании. В браузере `matchMedia` есть — правка только тестовой среды.
- D5: `__tests__/query-wrapper.tsx` (общий `createQueryWrapper`) — добавлен `GestureHandlerRootView`, как `GestureRoot`
  корневого layout: тесты маршрутов без `_layout` (`my-routes`, `race-my-track`) иначе падают — `RouteMap` native
  теперь всегда держит `GestureDetector`.
- D6: кнопки «+»/«−» native до первого события региона берут зум у карты (`MapRef.getZoom()`), дальше — из последнего
  `ViewState` (§11 — только `ViewState`).
- D7: размер вида native пишут оба `onLayout` — области жестов (`map-gesture-area`, всегда) и оверлея маркера
  (`scrub-overlay`, как в routes-04): одна рамка `absoluteFill`, тесты routes-04 не переписывались.

## 9. Acceptance Criteria

1. Web: перетаскивание мышью двигает карту; колесо без Ctrl — прокрутка страницы и подсказка, с Ctrl/⌘ — зум; «+»,
   «−», «в рамку» работают; двойной клик — приближение.
2. Native: одним пальцем экран прокручивается, двумя — карта двигается и масштабируется; кнопки работают.
3. Маркер скраббинга остаётся на линии маршрута при любом положении камеры; перетаскивание маркера и профиля
   работает как в routes-04.
4. Карта гонки — то же поведение; коридор и свой трек не ломаются.
5. Доступность: кнопки с подписями, фокус, reduce motion — без анимации камеры.
6. `TURBO_CONCURRENCY=1 pnpm check` зелёный; смоук web (гидрация) зелёный.

## 10. Documentation Impact

ADR-0014, `.claude/rules/pokatim-app.md`, `docs/product/routes.md`, `docs/product/races-and-seasons.md`.

Architect: ADR-0014 — раздел «Дополнение 2026-10-27 (routes-04b): интерактивная карта» (п. «Статичный вид» maps-01
заменяется): web — `cooperativeGestures` + `locale`; native — нативные жесты карты выключены, жесты двумя пальцами —
RNGH поверх карты с императивной камерой (почему не пропсы `dragPan`/`touchZoom`: один палец забирает прокрутку,
Android `requestDisallowInterceptTouchEvent`), блокировка прокрутки экрана на время жеста; зум 4–17 без `maxBounds`;
кнопки «+», «−», «в рамку» сверху справа, атрибуция снизу справа; reduce motion; исключение доступности для сдвига
(RC-11); альтернативы RC-1…RC-3. `pokatim-app.md` — абзац «Статичный вид» → интерактивность, `map-gesture-lock`,
стор вида карты, `SCRUB_REPROJECT_EVENTS` с `move`; в «Скраббинг (routes-04)» — «карта статична» убрать.
`docs/product/routes.md` — карточка маршрута и «Мои маршруты»; `docs/product/races-and-seasons.md` — карта гонки.
Follow-up в app-foundation: `IconButton` в `@rkarakulov/ui`, токен длительности анимации камеры.

## 11. Implementation Context

Пути — от `apps/app/src/` (кроме отмеченных). Публичный API `RouteMapProps` не меняется.

### ENTRY POINTS

- `features/maps/route-map.web.tsx` — опции интерактивности, `move` в `SCRUB_REPROJECT_EVENTS`, стор проекции, контролы.
- `features/maps/route-map.tsx` — RNGH-жесты над картой, `CameraRef`, события региона, стор проекции, контролы.

### FILES TO CREATE

- `features/maps/map-camera.ts` (+ `map-camera.test.ts`) — чистая математика, без RN/RNGH:
  `MAP_MIN_ZOOM = 4`, `MAP_MAX_ZOOM = 17`, `MAP_ZOOM_STEP = 1`, `MAP_CAMERA_ANIMATION_MS = 300`;
  `type MapCamera = { center: [lon: number, lat: number]; zoom: number }`; `clampZoom(zoom: number): number`;
  `cameraAfterGesture(start: MapCamera, view: { width: number; height: number }, gesture: { focal0: Planar; focal:
  Planar; scale: number }): MapCamera` — Web Mercator, тайл 512: точка под `focal0` при `start` оказывается под `focal`,
  зум `clampZoom(start.zoom + log2(scale))`; `zoomAround(start, view, point: Planar, delta: number): MapCamera`.
- `features/maps/map-view-store.ts` — `createMapViewStore(): StoreApi<{ points: Planar[] | null }>` (`zustand/vanilla`,
  на экземпляр карты, `useRef`/`useState(create…)`).
- `features/maps/scrub-layer.tsx` — `ScrubLayer({ view, store, cumulative, theme })`: единственный подписчик
  `points`, рендерит `ScrubMarker` (импорт без расширения — платформенный файл). Общий для обеих платформ.
- `features/maps/map-controls.tsx` (+ `map-controls.test.tsx`, web — `map-controls.web.test.tsx` при отличиях) —
  `MapControls({ theme, onZoomIn, onZoomOut, onFit }: MapControlsProps)`: колонка сверху справа, три `Pressable`
  (`accessibilityRole="button"`, `accessibilityLabel` `t('maps.controls.zoomIn' | 'zoomOut' | 'fit')`, `size.touchMin`,
  `SymbolView`: `plus`/`add`, `minus`/`remove`, `arrow.up.left.and.arrow.down.right`/`fit_screen`), testID
  `map-zoom-in` / `map-zoom-out` / `map-fit`. Без RNGH (идёт в web-бандл).
- `features/maps/map-gesture-lock.tsx` — `MapGestureLockContext` (`(active: boolean) => void`, по умолчанию no-op) и
  `useMapGestureLock(): readonly [scrollEnabled: boolean, onMapGesture: (active: boolean) => void]` (экран).
- `features/maps/map-gestures.ts` — только native (RNGH): `useMapGestures({ camera, view, size, reduceMotion,
  onActive }): ComposedGesture` — `usePanGesture({ minPointers: 2, maxPointers: 2, averageTouches: true, runOnJS:
  true })` + `usePinchGesture({ runOnJS: true })` + `useTapGesture({ numberOfTaps: 2, runOnJS: true })` в
  `useSimultaneousGestures`; конфиги — `useMemo` по стабильным ref (не литералы, M1); pan/pinch `onActivate` →
  `onActive(true)` на первом активном (счётчик) и снимок `ViewState` из ref; `onUpdate` → `camera.jumpTo(
  cameraAfterGesture(…))` (focal = центроид пана + смещение, scale — щипка); `onDeactivate` последнего активного →
  `onActive(false)`; двойной тап → `zoomTo` вокруг точки (`zoomAround`) с `duration: reduceMotion ? 0 :
  MAP_CAMERA_ANIMATION_MS`. testID жестов — `map-pan`, `map-pinch`, `map-double-tap`.
- `features/maps/map-locale.web.ts` — `mapLocale(): Record<string, string>` для опции `locale` (`Map.Title`,
  `CooperativeGesturesHandler.WindowsHelpText` / `MacHelpText` / `MobileHelpText`) — вызывается в эффекте (клиент).

### FILES TO MODIFY

- `features/maps/route-map.web.tsx` — `new Map({ interactive: true, cooperativeGestures: true, dragRotate: false,
  pitchWithRotate: false, touchPitch: false, maxPitch: 0, minZoom: MAP_MIN_ZOOM, maxZoom: MAP_MAX_ZOOM, locale:
  mapLocale(), … })`; после создания — `touchZoomRotate.disableRotation()`, `keyboard.disableRotation()`; экземпляр — в
  ref для контролов; `SCRUB_REPROJECT_EVENTS = ['resize', 'move'] as const`; пиксели — в стор вида (не `useState`);
  `MapControls`: `zoomIn/zoomOut({ animate: !reduce })`, `fitBounds(unionBounds(…), { padding: MAP_FIT_PADDING,
  animate: !reduce })`; `reduce` — `useReducedMotion()` через ref (не в зависимостях эффекта создания).
- `features/maps/route-map.tsx` — `Camera ref` + `minZoom`/`maxZoom`; `onRegionIsChanging`/`onRegionDidChange` всегда
  (последний `ViewState` в ref; при `scrub` — пиксели в стор вида; размер оверлея — ref); `GestureDetector` вокруг
  `View` (`StyleSheet.absoluteFill`, `collapsable={false}`) с `lib.Map`; нативные пропсы жестов — без изменений (`false`);
  `useContext(MapGestureLockContext)` → `onActive`; `MapControls`: `zoomTo(clampZoom(z ± MAP_ZOOM_STEP), { duration,
  easing: 'ease' })`, `fitBounds(bounds, { padding: MAP_FIT_PADDING, duration, easing: 'ease' })` (длительность явно —
  по умолчанию 2000 `'fly'`); вызовы камеры — в `try` (до инициализации `setStop` бросает).
- `features/maps/scrub-marker.tsx` — `points`/допуск через ref, конфиг жеста от точек не зависит; комментарий «карта не
  панорамируется» — заменить.
- `features/maps/scrub-marker.web.tsx`, `scrub-line.ts` — комментарии (`move`, интерактивная камера).
- `features/maps/corridor-style.ts` — `MAP_FIT_PADDING.right = size.touchMin + space.s2` (RC-6).
- `features/maps/attribution.web.ts` — `attributionCss`: `transition: none` слоя подсказки при
  `prefers-reduced-motion: reduce` (RC-9).
- `features/races/race-detail.tsx`, `features/routes/route-detail.tsx`, `features/routes/my-route-detail.tsx` —
  `useMapGestureLock()`, `<MapGestureLockContext value={onMapGesture}>` вокруг содержимого, `scrollEnabled`
  (route-detail — вместе с `useScrubScrollEnabled`).
- `apps/app/jest.setup.ts` — мок MapLibre: `Camera` и `Map` с `ref` (`useImperativeHandle`: `jumpTo`, `zoomTo`,
  `fitBounds`, `setStop` / `getViewState`, `getZoom` — `jest.fn`), testID прежние.
- `packages/i18n/src/ru.ts` — `maps.controls.zoomIn` «Приблизить», `maps.controls.zoomOut` «Отдалить»,
  `maps.controls.fit` «Показать маршрут целиком», `maps.gestures.wheel` «Чтобы изменить масштаб, крутите колесо с
  Ctrl», `maps.gestures.wheelMac` «… с ⌘», `maps.gestures.touch` «Двигайте карту двумя пальцами», `maps.canvas`
  «Карта: стрелки — сдвиг, плюс и минус — масштаб» [ASSUMPTION copy].
- Тесты: `route-map.web.test.tsx` (опции вместо `interactive: false`), `route-map-scrub.web.test.tsx`,
  `route-map-scrub.test.tsx` (обработчики региона теперь всегда — тест «без scrub обработчиков нет» переписать на
  «без scrub маркера нет»), `__tests__/race-route-map.test.tsx`, `__tests__/route-detail.test.tsx`,
  `__tests__/my-routes.test.tsx`.

### FILES TO READ

`features/maps/*` целиком; `docs/tasks/2026-10-27-routes-04-scrub/task.md` §8.1–8.2 (RC-2, RC-3, M1, M2);
`node_modules/maplibre-gl/dist/maplibre-gl.d.ts` (`MapOptions`, `CooperativeGesturesHandler`, `locale`);
`node_modules/@maplibre/maplibre-react-native/src/components/map/Map.tsx` (`ViewStateChangeEvent`, `onRegionIsChanging`),
`…/components/camera/Camera.tsx` (`CameraRef`, `minZoom`, `fitBounds` по умолчанию 2000 `'fly'`);
`node_modules/react-native-gesture-handler/src/v3/hooks/gestures/{pan,pinch,tap}` и `composition`;
`components/top-bar.tsx` (образец `Pressable` + `SymbolView`); `apps/app/jest.setup.ts`.

### TYPES & SCHEMAS

Контракты и API не меняются. Новые типы — только в `features/maps`: `MapCamera`, `MapViewState = { points: Planar[]
| null }`, `MapControlsProps`. `RouteMapProps` — без изменений.

### TDD — порядок

1. `map-camera.test.ts` (красный → зелёный): сдвиг без масштаба, щипок вокруг центра (+1 зум, центр тот же),
   инвариант «точка под пальцами» (focal0 → focal) на нескольких зумах и широтах, `clampZoom`, `zoomAround`.
2. `map-view-store` + `ScrubLayer`; web: `move` пересчитывает маркер, `RouteMap` и `addLayer` не перевызываются
   (счётчик рендеров/шпион), обработчики сняты при `remove`.
3. Web-опции (`interactive`, `cooperativeGestures`, вращение/наклон, зум, `locale`, `disableRotation`).
4. `MapControls` (подписи, роли, testID, `onPress`); web: кнопки → `zoomIn`/`zoomOut`/`fitBounds` с `animate` по
   reduce motion.
5. Мок MapLibre с ref; native: события региона → маркер без ре-рендера `Map`/`GeoJSONSource`; `ScrubMarker` —
   конфиг жеста не меняется при новых точках.
6. Native-жесты (`createGestureController`): два пальца pan/pinch → `jumpTo` с ожидаемой камерой; `onActivate`/
   `onDeactivate` → контекст блокировки `true`/`false` (счётчик pan+pinch); один палец (pan не активирован) — `jumpTo` не зовётся; двойной
   тап → `zoomTo` (reduce motion — `duration: 0`); кнопки → `zoomTo`/`fitBounds` с явной длительностью.
7. Экраны: `scrollEnabled` выключается на время жеста карты (native); web — всегда `true`.
8. Карта гонки и «Мои маршруты» — обновить тесты; docs.

### TESTS (матрица)

| Уровень | Где | Что |
|---|---|---|
| unit (jest) | `map-camera.test.ts` | математика камеры, ограничения зума |
| jest web | `route-map.web.test.tsx` | опции карты, `locale`, `disableRotation`, контролы → методы карты, reduce motion |
| jest web | `route-map-scrub.web.test.tsx` | `move`/`resize` → маркер на линии, без пересоздания карты и ре-рендера `RouteMap` |
| jest web | `route-map-corridor.web.test.tsx` | коридор без изменений (регресс) |
| jest native | `route-map-scrub.test.tsx` | `regionIsChanging` → маркер; `Map`/`GeoJSONSource` не перерисовываются; стабильный конфиг маркера |
| jest native | `route-map-gestures.test.tsx` (новый) | pan/pinch/двойной тап → `CameraRef`; блокировка прокрутки; кнопки; reduce motion |
| jest native | `__tests__/race-route-map.test.tsx` | нативные жесты `false`, `Camera minZoom/maxZoom`, контролы, коридор и трек (регресс) |
| jest native | `__tests__/route-detail.test.tsx`, `my-routes.test.tsx` | `scrollEnabled` = скраббинг && нет жеста карты |
| jest | `map-controls.test.tsx` | a11y (роль, подпись), цели `touchMin` |
| e2e web | `e2e/web.spec.ts` | без новых шагов: смоук гидрации зелёный (карты в смоуке нет — RC-13) |
| ручная | dev (`deploy-dev`) + iOS/Android dev-клиент + мобильный Safari/Chrome | R1, R2, AC 1–5 — NOT VERIFIED в CI |

### OUT OF SCOPE

Полноэкранная карта, слои, вращение/наклон; скраббинг на карте гонки; карта в панели (routes-05); `IconButton` в
`@rkarakulov/ui` (follow-up в app-foundation); токен длительности анимации (follow-up); подсказка жестов на native;
e2e с картой (стиль-заглушка + WebGL — отдельная задача).

## 12. Outcome (заполняет coder)

**Статус:** реализовано по §11 (TDD-порядок 1–8), отклонения — §8.2 D1–D7. Не закоммичено.

**Код (`apps/app/src/features/maps/`):**

- новые: `map-camera.ts` (зум 4–17, шаг, 300 мс, `cameraAfterGesture`, `zoomAround` — Web Mercator, тайл 512),
  `map-view-store.ts`, `scrub-layer.tsx`, `map-controls.tsx`, `map-gesture-lock.tsx`, `map-gestures.ts` (только
  native), `map-locale.web.ts`;
- `route-map.web.tsx` — `interactive` + `cooperativeGestures`, вращение/наклон выключены, `minZoom`/`maxZoom`, `locale`,
  `disableRotation`; пиксели маркера — в стор вида, `SCRUB_REPROJECT_EVENTS = ['resize', 'move']`; кнопки после
  создания карты (не при ошибке), `animate` — по `useReducedMotion` через ref;
- `route-map.tsx` — `GestureDetector` (пан и щипок двумя пальцами, двойной тап) над `View` с `lib.Map`, нативные жесты
  `false`, `Camera ref` + `minZoom`/`maxZoom`, события региона всегда (ref + стор вида), кнопки с явной длительностью,
  вызовы камеры — `cameraCall` (try + catch промиса);
- `scrub-marker.tsx` — точки и допуск через ref, конфиг жеста от точек не зависит; `corridor-style.ts` —
  `MAP_FIT_PADDING.right = size.touchMin + space.s2`; `attribution.web.ts` — подсказка без затухания при reduce
  motion; комментарии `scrub-line.ts`, `scrub-marker.web.tsx`;
- экраны `race-detail.tsx`, `route-detail.tsx` (`&&` со скраббингом), `my-route-detail.tsx` — `useMapGestureLock` +
  `MapGestureLockContext`;
- `packages/i18n/src/ru.ts` — `maps.controls.*`, `maps.gestures.*`, `maps.canvas`.

**Тесты:** `map-camera.test.ts` (сдвиг, щипок, инвариант «точка под пальцами» на 5 зумах/широтах, ограничения,
`zoomAround`), `map-controls.test.tsx`, `route-map-gestures.test.tsx` (пан/щипок → `jumpTo`, счётчик блокировки, один
палец без камеры, двойной тап, reduce motion, кнопки, ошибка стиля, бросающая камера), `route-map.web.test.tsx`
(опции, `locale`, кнопки ± reduce motion), `route-map-scrub(.web).test.tsx` (`move`/`regionIsChanging` → маркер без
ре-рендера `RouteMapFrame`/`Map`/`GeoJSONSource`, M1 при движении камеры), `attribution.web.test.ts`, экраны —
`race-route-map`, `route-detail` (щипок + скраббинг), `my-routes`. Инфраструктура: мок MapLibre с `ref`
(`jest.setup.ts`), `jest.match-media.web.ts`, корень жестов в `query-wrapper.tsx`.

**Проверки:** `TURBO_CONCURRENCY=1 pnpm check` (Mongo :27117, Redis :6479/8, Node 24) — EXIT 0: format, lint, arch,
typecheck, тесты (app 132 suites / 1153 tests, api 105 files, admin 26, пакеты — зелёные).

**NOT VERIFIED:** смоук web `pnpm e2e:web` (гидрация; кнопки карты рендерятся только после создания карты на клиенте,
в SSR их нет; в смоуке карты нет — RC-13); устройство iOS/Android (R1: жесты двумя пальцами внутри `ScrollView`,
сдвиг на несколько px до активации пана; центр `ViewState` при `padding` начальной камеры), мобильный Safari/Chrome
(R2), AC 1–5 руками на dev.

**Docs:** ADR-0014 — «Дополнение 2026-10-27 (routes-04b)»; `.claude/rules/pokatim-app.md` (карта, скраббинг, jest);
`docs/product/routes.md`, `docs/product/races-and-seasons.md`.
