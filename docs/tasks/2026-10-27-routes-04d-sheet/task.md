# routes-04d — карточка маршрута: карта на весь экран, шторка, «Моё местоположение»

Уровень: task3. Ветка `feature/routes-04d-sheet` от `origin/develop` (после routes-04c, PR #60). Решения — `decisions.md`
этой папки (L1–L6 раскладка и шторка, G1–G4 «Моё местоположение»). Связано: routes-03/04/04b/04c, ADR-0014,
`.claude/rules/pokatim-app.md` (рамки MVP: геолокация).

## 1. Title

Карточка маршрута как в «Картах» iOS: карта на весь экран под шапкой, сворачиваемая шторка с компактными цифрами,
профилем и кнопками в строку; кнопка «Моё местоположение» на карте.

## 2. Goal

Пользователь: карта маленькая; название дублируется; данные громоздкие; заголовок «Профиль высоты» лишний; кнопки — в
одну строку; панель должна сворачиваться, как шторка в iOS с «чёрточкой»; нужна кнопка позиционирования карты на свои
координаты.

## 3. Scope

- **app (`features/routes`, `features/maps`, `components`):**
  - экран `route-detail.tsx`: карта (общий `RouteMap` через `CatalogRouteMap`) на всю высоту под `DetailHeader`; шторка
    поверх (L2): компонент шторки (`components/bottom-sheet(.web).tsx` или в `features/routes` — решает architect) с
    «чёрточкой», два положения, перетаскивание (native — RNGH/reanimated, web — pointer events), тап по чёрточке;
    содержимое (L3): компактная строка цифр (новый вид стат-блока или `StatBlock` с вариантом `compact`), чипы,
    профиль без заголовка (диапазон и карточка курсора — мелкой строкой), «Поделиться» и «Скачать GPX» в строку,
    «Гонки на маршруте» — прокрутка внутри шторки; камера карты учитывает высоту шторки (padding/`MAP_FIT_PADDING`);
    скраббинг routes-04 работает (профиль в шторке ↔ маркер на карте), состояния §4.12 (скелетон, 404, ошибка, офлайн);
    pull-to-refresh — внутри шторки;
  - «Моё местоположение» (G1–G4): кнопка в `MapControls`, разрешение и одно чтение позиции (`features/location/*`,
    развилка файлами), точка позиции на карте (слой/оверлей; отличима без цвета), камера — на позицию; отказ — сообщение
    со ссылкой в настройки; координаты — только в памяти, без логов и отправки;
  - «Мой маршрут» (`my-route-detail.tsx`) — та же раскладка, если переиспользование без раздувания (L5), иначе §8.2.
- **i18n:** `routes.detail.sheet.*`, `maps.controls.locate`, `maps.location.*`.
- **docs:** ADR-0014 (поправка: «Моё местоположение»), `pokatim-app.md` (рамки MVP — исключение G2; раскладка карточки),
  `docs/product/routes.md`.

## 4. Out of Scope

- Слежение за позицией, навигация, запись трека, «рядом».
- Шторка на карточке гонки (карта гонки получает только кнопку «Моё местоположение» через общий `RouteMap`).
- Панель (routes-05).

## 5.1 Placement & Reuse Gate

- Reuse: `RouteMap`/`MapControls`/`map-camera.ts` (routes-04b/04c), скраббинг routes-04, `StatBlock`, `Pill`, `Button`,
  `ElevationProfile`, `DetailHeader`, `features/location/location-permission(.web).ts` (онбординг), RNGH +
  reanimated (в зависимостях), `useReducedMotion`.
- Запрещено: новая нативная зависимость без решения architect (готовой шторки нет — своя на RNGH/reanimated или
  обоснование библиотеки); `useId`/измерения в SSR-разметке; координаты в логах/запросах/хранилище; `Platform.OS` в
  компонентах.

Architect (2026-10-27) — вердикт по placement:

- Шторка — продуктовый компонент `apps/app/src/components/bottom-sheet(.web).tsx` (инвариант 11; в `@rkarakulov/ui` шторки
  нет — кандидат в app-foundation, follow-up), чистая логика снапа — `components/bottom-sheet-snap.ts` (обе платформы).
  Без новой зависимости: native — RNGH v3 `usePanGesture` + `Animated` из `react-native` (не Reanimated, RC-1), web —
  pointer events RN-web. Тело шторки (`ScrollView` с `RefreshControl`) передаёт экран — шторка о данных не знает.
- Карта: только расширение `RouteMap` необязательными пропсами `fill?`, `bottomInset?` (RC-5) и общей кнопкой
  «Моё местоположение» в `MapControls` (`onLocate?`); новые файлы — `features/maps/location-store.ts`,
  `location-layer.tsx` (native), `use-locate.ts`, `map-locate-notice.tsx`. `race-route-map.tsx` не меняется.
- Чтение позиции — `features/location/current-position(.web).ts` и `location-settings(.web).ts` рядом с
  `location-permission(.web).ts`; `expo-location` — только в native-файлах `features/location/`.
- Компактные цифры — `StatBlock variant="compact"` (не новый компонент, RC-9); профиль — `ElevationProfile` без
  заголовка (RC-10); действия — `RouteActions` в `route-detail.tsx` (RC-11).
- Новый пакет не нужен (один потребитель). Контрактов, API, БД, очередей задача не касается.

## 8. Risks / Assumptions

- R1: жесты шторки и карты одним пальцем (04c) и скраббинга — конфликты на устройстве (NOT VERIFIED в CI).
- R2: SSR — шторка развёрнута, карта — место под карту; гидрация без #418.
- A1: точка позиции не обновляется (одно чтение); повторное нажатие — новое чтение.

## 8.1 Requirements Consistency (заполняет architect)

Architect, 2026-10-27. Блокеров нет. RC-6, RC-7, RC-15 (копия строки iOS) требуют подтверждения оркестратора — без
ответа действует рекомендация.

- **RC-1 Шторка без новой зависимости; native — без Reanimated.** В `src` Reanimated/worklets не используются ни разу,
  а `jest.setup.ts` намеренно выключает Reanimated для RNGH (мок 4.7 падает на `setCSSEventHandler`,
  `expo-router/testing-library` подменяет пакет пустым объектом). Шторка на `useSharedValue`/`useAnimatedStyle`
  сломала бы native-тесты экрана. Варианты: (a) **RNGH v3 `usePanGesture({ runOnJS: true, activeOffsetY, failOffsetX })`
  + `Animated.Value` translateY из `react-native` (`useNativeDriver: true` для снапа, `setValue` во время жеста)** —
  как скраббинг routes-04, тестируется `createGestureController`; (b) Reanimated-worklets — плавнее при занятом
  JS-потоке, но правка jest-окружения и первый потребитель worklets в проекте; (c) `@gorhom/bottom-sheet` — новая
  зависимость поверх Reanimated, без web SSR. **Рекомендация (a).** Конфиг жеста — из `useMemo` (как `usePanGesture`
  профиля). Web — `bottom-sheet.web.tsx`: `onPointerDown/Move/Up` RN-web (пропсы пробрасываются, проверено в
  `react-native-web/dist/modules/forwardedProps`), `setPointerCapture`, `touchAction: 'none'` только на шапке, снап —
  CSS `transition: transform` (reduce motion — без неё); RNGH в web-бандл не попадает (как `gesture-root.web.tsx`).
- **RC-2 Модель состояния и SSR (L6).** Источник правды — `expanded` в экране (`useState(true)`): SSR и первый рендер
  — развёрнута. Шторка — `position: absolute; bottom: 0`, `maxHeight: SHEET_MAX_HEIGHT` (процент области карты, напр.
  `'60%'`, — раскладка, не измерение). Свёрнута — тело `display: 'none'` (вне дерева a11y и Tab-порядка), видна шапка
  (чёрточка + строка цифр); во время перетаскивания и анимации тело видно. Высоты шапки и тела — `onLayout` после
  монтирования; до измерения перетаскивание выключено, тап переключает без анимации. Снап — чистая функция
  `snapExpanded(offset, velocity, range)` (половина хода или скорость выше `SHEET_FLING_VELOCITY`). Без `useId`,
  `Platform.OS`, `window` в рендере.
- **RC-3 Жесты не пересекаются по площади (R1).** Перетаскивание шторки — только шапка (L2); карта — вне шторки
  (шторка — непрозрачный сосед поверх, касание до карты не доходит); скраббинг профиля (`activateAfterLongPress: 250`)
  и прокрутка — в теле шторки; маркер — на карте. Карта больше не внутри `ScrollView`, поэтому `useScrubScrollEnabled` и
  `onScrollBeginDrag` переходят на `ScrollView` тела шторки, а тест routes-04c «прокрутку выключает только
  скраббинг» переписывается под тело шторки. Тап по чёрточке — `Pressable` внутри детектора; активация pan отменяет
  JS-responder (`cancelsJSResponder` по умолчанию) — тап не срабатывает после перетаскивания. Pull-to-refresh —
  `RefreshControl` тела (с шапкой не конфликтует). Проверка на устройстве — NOT VERIFIED в CI.
- **RC-4 Раскладка.** Экран: `SafeAreaView edges={['top']}` → `DetailHeader` (название — только здесь) →
  `OfflineBanner` в потоке → область карты `flex: 1` с `RouteMap fill` (absolute) и шторкой (absolute). Нижний
  inset — `SafeAreaView edges={['bottom']}` внутри шторки (тот же паттерн, что top; на web — после монтирования, как
  сейчас). Web: колонка `layout.contentMaxWidth` (640) остаётся — карта на всю высоту окна в колонке, `ScrollViewStyleReset`
  уже не даёт прокручиваться документу; full-bleed на десктопе — вне рамок (корневой layout).
- **RC-5 Камера и высота шторки.** `RouteMapProps`: `fill?: boolean` (рамка `flex: 1` вместо `MAP_ASPECT_RATIO`,
  тот же флаг у места-скелетона `RouteLineMap`) и `bottomInset?: number` (видимая высота шторки, px; обновляется в
  конце снапа, не на кадр). Отступ — чистая `cameraPadding(insetBottom, mapHeight)` в `map-camera.ts`: `MAP_FIT_PADDING`
  + inset снизу с ограничением по высоте карты. Без ограничения `fitBounds` maplibre-gl предупреждает и не двигает
  камеру, когда отступы больше холста. Начальная камера — по inset развёрнутой шторки: в режиме `fill` карта
  монтируется, когда inset известен (до этого — место карты; на SSR и до монтирования карты всё равно нет). При снапе
  камера не двигается (как «Карты» iOS); «в рамку» и «моё местоположение» берут текущий inset. Web: inset — через ref,
  эффект создания карты от него не зависит. **Ловушка web:** `easeTo({ padding })` в maplibre-gl делает padding
  постоянным (`tr.padding`), а `fitBounds` прибавляет его к своему (`src/ui/camera.ts`, `_cameraForBoxAndBearing`:
  `mapPadding = tr.padding`) — для позиции на web нужен `offset: [0, -inset/2]`, а не `padding`; native — явный
  `padding` в каждом вызове камеры (`fitBounds`, `easeTo`).
- **RC-6 Четвёртая кнопка и атрибуция (нужно OK).** На карте гонки 3:2 при ширине экрана 375 холст 335×223; колонка из
  4 кнопок — 8 + 4×44 + 3×4 = 196 px, а «i» атрибуции внизу справа занимает ≈ 191–215 px той же колонки: пересечение.
  В режиме `fill` «i» внизу закрыта шторкой — это нарушение атрибуции OSM/OpenFreeMap (ADR-0014 п. 3). Варианты:
  (a) **атрибуция — в левый нижний угол на всех картах (native `attributionPosition { bottom, left }`, web
  `attributionControl: false` + `new AttributionControl({ compact: true })` в `'bottom-left'`), в `fill` — со сдвигом
  на `bottomInset`; «Моё местоположение» — 4-й в правой колонке (G1 без изменений)**; (b) кнопка позиции отдельно
  слева внизу (отход от G1), атрибуция всё равно сдвигается на inset; (c) 4-я кнопка только в `fill` — две раскладки.
  **Рекомендация (a).** `collapseAttribution` и цвета (`attributionCss`) работают по классам — позиция их не
  затрагивает. На экране шириной 320 колонка с 4 кнопками всё равно впритык — принято.
- **RC-7 Колесо мыши на полноэкранной web-карте (нужно OK).** Защита колеса routes-04c (без Ctrl/⌘ — прокрутка
  страницы и подсказка) в `fill` теряет смысл: страница не прокручивается, колесо только показывает подсказку.
  Варианты: (a) **в `fill` колесо масштабирует без модификатора (`guardWheelZoom` не подключается, `scrollZoom` по
  умолчанию)**; (b) оставить как в 04c — единообразно, но полноэкранная карта не масштабируется колесом. **Рекомендация
  (a)**, записать в поправку ADR-0014; карта гонки (3:2 в прокрутке) — без изменений.
- **RC-8 Нет карты в режиме `fill`.** Env не задан, нет нативного модуля (Expo Go, старый dev-клиент) или геометрия
  404 → `RouteLineMap` сейчас возвращает `null`, и область под шапкой пустеет. Варианты: (a) **в `fill` вместо `null`
  — ровный фон `map.background` (без пульса, без текста), шторка работает как обычно**; (b) шторка становится
  страницей — нужен сигнал наличия карты наверх. **Рекомендация (a)** (редкий случай, без новой связи). Ошибка без
  данных — `AsyncContent` с повтором, как сейчас, в рамке `fill`.
- **RC-9 Компактная строка цифр.** `displayStat` (22 px) «2 ч 30 мин» ≈ 110 px при колонке ≈ 100 px на 375 —
  переносится. **Решение:** `StatBlock variant="compact"`: один ряд равных колонок, без ink-линии, подпись `label`
  над значением, значение `bodyStrong` + `unit`, `numberOfLines={1}`, `note` не показывается (кольцо — в чипах,
  максимум — в диапазоне профиля), но остаётся в `accessibilityLabel`. Альтернатива — новый компонент (дубль ячейки и
  a11y — отклонено). Проверка «без переноса на 375» — e2e (одна строка по высоте), jest измерить не может.
- **RC-10 Профиль без заголовка.** Единственный потребитель `ElevationProfile` — карточка, поэтому заголовок
  «Профиль высоты» удаляется из компонента (без флага). `ProfileHeadValue` (диапазон / карточка курсора) — строка над
  графиком справа. Текстовая альтернатива графика «Профиль высоты: от … до … м» остаётся — e2e-проверка SSR-HTML на
  «Профиль высоты» продолжает проходить через aria-label. Ключ `routes.detail.profile.title` удаляется, если больше не
  используется.
- **RC-11 Кнопки в строку.** `RouteActions`: ряд, кнопки по `flex: 1`; одна кнопка — во всю ширину; уведомления
  («Ссылка скопирована», ошибки) — во всю ширину под рядом (состояние поднимается из `ShareAction`/`GpxAction`).
  «Поделиться» появляется после монтирования (`canShare`) — сдвиг раскладки ряда, как и раньше. Uppercase-подписи в
  ≈ 157 px — проверка e2e на 375 (обе кнопки на одной высоте).
- **RC-12 Чтение позиции (G1, G4).** `features/location/current-position(.web).ts`:
  `readCurrentPosition(): Promise<PositionResult>`, где
  `PositionResult = { status: 'ok'; lngLat: readonly [number, number] } | { status: 'denied'; canOpenSettings: boolean } | { status: 'unavailable' }`.
  Не бросает. Native: `getForegroundPermissionsAsync` → не `granted` и `canAskAgain` → `requestForegroundPermissionsAsync`
  → `getCurrentPositionAsync({ accuracy: Accuracy.Balanced })` со своим таймером `LOCATE_TIMEOUT_MS` (у API таймаута
  нет), `denied` без `canAskAgain` → `canOpenSettings: true`. Web: `navigator.geolocation.getCurrentPosition` —
  **синхронно первым действием функции** (до любого `await`; Permissions API не опрашивать до вызова),
  `{ enableHighAccuracy: false, maximumAge: LOCATE_MAX_AGE_MS, timeout }` + свой таймер ожидания ответа пользователя
  (как `PROMPT_WAIT_MS`); `PERMISSION_DENIED` → `denied` (`canOpenSettings: false`); нет API или небезопасный контекст —
  `unavailable`. Настройки — `features/location/location-settings(.web).ts` (`openLocationSettings()` — native
  `Linking.openSettings()`; web — нет ссылки, текст «в настройках браузера»), без `Platform.OS`.
- **RC-13 Точка позиции без ре-рендера карты.** Стор на экземпляр `RouteMap` (`location-store.ts`, `zustand/vanilla`,
  `{ lngLat | null }`, только память, без persist) + хук `useLocate` (состояния `idle | pending | denied | unavailable`;
  повторное нажатие во время чтения игнорируется; после размонтирования результат отбрасывается). Native —
  `LocationLayer` внутри `lib.Map` подписан на стор (`GeoJSONSource` + слои `circle`: ореол и точка с толстой обводкой
  `surface` — отличается от старта и финиша размером и ореолом, не только цветом); `RouteMap` при новой точке не
  перерисовывается. Web — императивно в обработчике: `addSource`/`addLayer` при первой точке, дальше `setData`;
  пересоздание карты (тема) — точки нет до следующего нажатия. Камера: native `easeTo({ center, zoom: LOCATE_ZOOM,
  padding, duration })`, web `easeTo({ center, zoom, offset, animate })`; reduce motion — без анимации. Кнопка —
  `accessibilityLabel` «Моё местоположение», во время чтения `disabled` + `accessibilityState.busy`. Слоя
  `UserLocation` MapLibre не использовать: он следит за позицией (watch) — против G1.
- **RC-14 Отказ и ошибка.** Сообщение — над картой сверху слева (не под шторкой и не под колонкой кнопок), `Banner
  tone="warning"`; на native при `denied` + `canOpenSettings` — `Banner onPress` открывает настройки ОС («весь баннер —
  ссылка» — готовый паттерн базы); web `denied` — без ссылки; `unavailable` — «Не удалось определить
  местоположение». Скрывается при следующем нажатии или успехе. Озвучка — `accessibilityLiveRegion="polite"` / роль
  alert (без координат).
- **RC-15 Приватность и документы (G2; нужно OK на копию).** Гость на web не видел pre-permission онбординга —
  явное нажатие кнопки считается намерением (G2 принят); это правка правила рамок MVP в `pokatim-app.md` и поправка
  ADR-0014. Строка iOS `locationWhenInUsePermission` в `app.json` говорит только о «рядом» и устареет (App Review 5.1.1).
  Обновить на текст, включающий показ на карте [ASSUMPTION copy: «Геопозиция нужна, чтобы показать вас на карте
  маршрута и найти старты рядом. Покатим её не записывает и не хранит.»]: зона `security.md` (app.json), действует
  после новой нативной сборки (не OTA). `docs/product/onboarding.md` (Q6 «координаты не читаются», R6 —
  `LOCATION_STEP_ENABLED` «только при живой фиче „рядом“») — обновить: у разрешения теперь есть потребитель.
  Координаты не попадают в TanStack Query, сторы с persist, `console.*`, URL (`hash` maplibre-gl выключен по
  умолчанию — не включать), подписи a11y, запросы к API.
- **RC-16 «Мой маршрут» — follow-up (L5, §8.2).** На карточке `routes/mine/<id>` — переименование (поле ввода и
  клавиатура), удаление с подтверждением, статус «Обрабатывается» без карты, нет профиля и скраббинга. Перенос в
  шторку поверх карты — отдельная задача (клавиатура над шторкой, раскладка без карты). Сейчас «Мой маршрут» и
  карта гонки получают только кнопку «Моё местоположение» и атрибуцию слева через общий `RouteMap` (G3).
- **RC-17 Доступность шторки (L4).** Чёрточка — `Pressable` (`accessibilityRole="button"`, подпись «Свернуть
  панель» / «Развернуть панель», `accessibilityState.expanded` → web `aria-expanded`), цель ≥ `size.touchMin`,
  визуально — полоса `size.touchMin × stroke.bannerError` без скругления (квадратная эстетика). Web: Enter и Space —
  поведение `Pressable` RN-web для роли button, покрыть тестом. При сворачивании фокус внутри тела переходит на
  чёрточку. Тап — альтернатива перетаскиванию (правило `accessibilityActions` выполнено). Reduce motion (`null` —
  как «уменьшить») — снап без анимации, перетаскивание пальцем остаётся. Токена длительности нет —
  `SHEET_ANIMATION_MS` = `MAP_CAMERA_ANIMATION_MS` (тот же follow-up в app-foundation); граница — hairline
  `border.subtle` сверху, фон — роль поверхности темы.
- **RC-18 Состояния §4.12.** Загрузка — место карты (`fill`) + шторка-скелетон (строка цифр, место профиля); 404,
  невалидный id, ошибка без данных — экран без карты и шторки (`EmptyState` / `AsyncContent` с повтором в `ScrollView`
  с pull-to-refresh, как сейчас); офлайн-баннер — в потоке под шапкой; ошибки гонок — в теле шторки, как сейчас.

## 8.2 Deviations from spec

Coder, 2026-10-27 (по подтверждённым оркестратором RC-6, RC-7, RC-15, RC-16):

- D1. Тип `PositionResult` и сроки `LOCATE_TIMEOUT_MS`/`LOCATE_MAX_AGE_MS` — в `features/location/position.ts` (без
  импортов), а не в native-файле: константы нужны обеим платформам, импорт значений из `current-position.ts` втащил бы
  `expo-location` в web-бандл. Native-файл реэкспортирует тип.
- D2. Состояние чтения позиции — в листовом `features/maps/map-overlay-controls.tsx` (кнопки + сообщение +
  `useLocate`), а не в `RouteMap`: иначе «ожидание»/отказ перерисовывали бы карту (RC-13 «счётчик рендеров не растёт»).
- D3. `BottomSheet` — подписи «чёрточки» пропсами `collapseLabel`/`expandLabel` (компонент общий, ключи
  `routes.detail.sheet.*` передаёт экран).
- D4. В `fill` место карты (загрузка, до измерения шторки) — ровный блок `surface.skeleton` без пульса:
  `SkeletonGroup` базы не растягивается на область (нет `style`), пульс на весь экран — отвлекает. Шторка-скелетон
  пульсирует.
- D5. Web-клавиатура «чёрточки»: RN-web рендерит `Pressable` с ролью button как нативную `<button>` — Enter/Space
  даёт click браузер; jest проверяет `<button type="button">` в Tab-порядке и click (jsdom keydown → click не
  синтезирует).
- D6. Перенос фокуса на «чёрточку» при сворачивании — web (фокус в теле → кнопка). Native: сворачивание со скринридером
  — тапом по «чёрточке», фокус уже на ней; перетаскивание со скринридером не используется.
- D7. Строка iOS — без части про «рядом» («рядом» не реализовано) и без хвоста «без вашего действия» (координаты не отправляются никогда): «…Координаты не сохраняются и не отправляются.»
- D8. RC-16 — «Мой маршрут» остаётся в прежней раскладке (получает кнопку позиции и атрибуцию слева через общий
  `RouteMap`); шторка — follow-up (`docs/product/routes.md`, «Что не входит»).

## 9. Acceptance Criteria

1. Карта занимает экран под шапкой; названия под картой нет; шторка с «чёрточкой» сворачивается и разворачивается
   (перетаскивание и тап), свёрнутая — только строка цифр.
2. Содержимое шторки: компактные цифры в одну строку (без переноса «2 ч 30 мин» на 375 px), чипы, профиль без заголовка
   со скраббингом, кнопки в одну строку, «Гонки на маршруте».
3. «Моё местоположение»: при разрешении — камера на позицию и точка; отказ — сообщение со ссылкой в настройки; на web —
   Geolocation API; координаты нигде не сохраняются и не отправляются.
4. Доступность: чёрточка — кнопка «Свернуть/Развернуть» с состоянием; кнопка позиции с подписью; reduce motion.
5. SSR и гидрация — без ошибок (смоук web зелёный); `TURBO_CONCURRENCY=1 pnpm check` зелёный.

## 10. Documentation Impact

ADR-0014, `.claude/rules/pokatim-app.md`, `docs/product/routes.md`.

Architect (2026-10-27):

- `docs/adr/0014-maps-and-tiles.md` — «Поправка 2026-10-27 (routes-04d)»: карта на весь экран (`fill`, `bottomInset`,
  `cameraPadding`), атрибуция слева внизу со сдвигом на inset (RC-6), колесо в `fill` (RC-7), «Моё местоположение»
  (одно foreground-чтение по нажатию, без watch и `UserLocation`, координаты только в памяти, отказ — настройки,
  web — Geolocation в `.web`, RC-12…RC-15).
- `.claude/rules/pokatim-app.md` — рамки MVP: геолокация (исключение G2 рядом с «рядом»); раздел «Маршруты»: раскладка
  карточки (шторка, `StatBlock variant="compact"`, профиль без заголовка, `RouteActions`, скраббинг в теле шторки);
  раздел карты — `fill`/`bottomInset`, атрибуция, кнопка позиции, `location-store`/`LocationLayer`; Jest — мок
  `getCurrentPositionAsync` больше не «сторож».
- `docs/product/routes.md` — карточка: шторка, компактные цифры, «Моё местоположение»; follow-up «Мой маршрут».
- `docs/product/onboarding.md` — Q6/R6 и системная строка iOS (RC-15).
- `apps/app/app.json` — `locationWhenInUsePermission` (копия — RC-15), отметить в `pr.md` (нужна нативная сборка).

## 11. Implementation Context

Architect (2026-10-27). Контракты, API, БД, очереди, outbox не затрагиваются. Пути — от `apps/app/src/`.

**ENTRY POINTS**

- `features/routes/route-detail.tsx` — `RouteDetailScreen` (новая раскладка RC-4, RC-18), `RouteDetailView` →
  содержимое шторки, `RouteActions` (RC-11), `RouteDetailSkeleton` (RC-18).
- `features/maps/route-map.tsx` / `route-map.web.tsx` — `fill`, `bottomInset`, атрибуция (RC-6), колесо (RC-7),
  кнопка позиции (RC-13).

**FILES TO CREATE**

- `components/bottom-sheet.tsx` (native: RNGH v3 + `Animated`), `components/bottom-sheet.web.tsx` (pointer events),
  `components/bottom-sheet-props.ts`, `components/bottom-sheet-snap.ts`:
  ```ts
  export interface BottomSheetProps {
    expanded: boolean;
    onExpandedChange: (expanded: boolean) => void;
    /** шапка: видна и в свёрнутом виде (строка цифр); за неё и чёрточку тянут */
    header: ReactNode;
    /** тело (экран передаёт ScrollView с RefreshControl); свёрнута — display: none */
    children: ReactNode;
    /** видимая высота шторки, px — после измерения и в конце снапа (не на кадр) */
    onVisibleHeightChange?: (height: number) => void;
    testID?: string;
  }
  export const SHEET_MAX_HEIGHT: `${number}%`;      // доля области карты
  export const SHEET_ANIMATION_MS: number;          // = MAP_CAMERA_ANIMATION_MS
  export const SHEET_FLING_VELOCITY: number;
  export function snapExpanded(offset: number, velocity: number, range: number): boolean;
  ```
- `features/location/current-position.ts` / `current-position.web.ts` — `readCurrentPosition(): Promise<PositionResult>`,
  `LOCATE_TIMEOUT_MS`, `LOCATE_MAX_AGE_MS` (RC-12); тип `PositionResult` — в native-файле, web импортирует тип (как
  `LocationPermission`).
- `features/location/location-settings.ts` / `.web.ts` — `openLocationSettings(): Promise<void>` (native
  `Linking.openSettings()`, web — нет вызова).
- `features/maps/location-store.ts` — `createLocationStore()`, `useLocation(store, selector)` (как `scrub-store.ts`).
- `features/maps/use-locate.ts` — `useLocate(onPosition: (lngLat) => void): { state; locate: () => void; dismiss }`
  (`locate` вызывает `readCurrentPosition` синхронно — без `await` до вызова, RC-12).
- `features/maps/location-layer.tsx` (native, дочерний `lib.Map`), `features/maps/location-style.ts` (общие
  `LOCATION_SOURCE_ID`, `locationLayers(theme)`, `locationFeature(lngLat)`, `LOCATE_ZOOM`).
- `features/maps/map-locate-notice.tsx` — сообщение отказа/ошибки (RC-14).

**FILES TO MODIFY**

- `features/maps/route-map-props.ts` — `fill?: boolean`, `bottomInset?: number` (документировать: обновлять в конце
  снапа).
- `features/maps/route-map-frame.tsx` — `fill` (рамка `flex: 1`), отступ снизу для сообщения «Карта не загрузилась».
- `features/maps/map-camera.ts` — `cameraPadding(insetBottom: number, mapHeight: number | null): ViewPadding`.
- `features/maps/map-controls.tsx` — `onLocate?: () => void`, `locating?: boolean` (4-я кнопка, иконка SF
  `location` / Material `my_location`).
- `features/maps/corridor-style.ts` — `MAP_FIT_PADDING`: комментарий про «i» слева; при необходимости bottom.
- `features/maps/attribution.web.ts` — без логики позиции (классы); контрол добавляется в `'bottom-left'` в
  `route-map.web.tsx`; CSS-сдвиг `.maplibregl-ctrl-bottom-left` на inset в области `data-route-map`.
- `features/routes/route-line-map.tsx`, `catalog-route-map.tsx` — проброс `fill`, `bottomInset`; в `fill` карта ждёт
  inset (RC-5), `null` → фон (RC-8).
- `components/stat-block.tsx` — `variant?: 'default' | 'compact'` (RC-9).
- `features/routes/elevation-profile.tsx` — без заголовка (RC-10).
- `features/routes/use-scrub-scroll-lock(.web).ts` — без изменений API; применяется к `ScrollView` тела шторки.
- `packages/i18n/src/ru.ts` — `routes.detail.sheet.expand`, `routes.detail.sheet.collapse`, `maps.controls.locate`,
  `maps.location.denied`, `maps.location.deniedSettings`, `maps.location.deniedBrowser`, `maps.location.unavailable`
  [ASSUMPTION copy]; удалить `routes.detail.profile.title`, если не используется.
- `features/location/location-permission.ts` — комментарий «единственный импорт / координаты не читаются» →
  актуальный; `jest.setup.ts` — комментарий к `getCurrentPositionAsync`.
- `app.json` — `locationWhenInUsePermission` (RC-15).
- Документы — §10.

**FILES TO READ**

`features/maps/scrub-store.ts`, `scrub-layer.tsx`, `scrub-marker.tsx` (паттерн стор + подписчик, `usePanGesture` из
`useMemo`), `features/routes/profile-chart.tsx` (RNGH v3, `runOnJS`), `route-map.web.test.tsx` и `jest.setup.ts`
(моки MapLibre: `__camera.easeTo`), `src/__tests__/route-detail.test.tsx`, `src/__tests__/location.test.tsx`,
`features/location/location-permission.web.ts` (таймер ожидания, небезопасный контекст),
`node_modules/maplibre-gl/src/ui/camera.ts` (padding vs offset, RC-5),
`node_modules/@maplibre/maplibre-react-native/lib/typescript/module/components/camera/Camera.d.ts` (`easeTo`,
`ViewPadding`), `node_modules/react-native-gesture-handler/lib/typescript/v3/hooks/gestures/pan/PanTypes.d.ts`,
`node_modules/expo-location/build/Location.d.ts`.

**TYPES & SCHEMAS** — только клиентские типы выше; `@pokatim/contracts` не меняется.

**Порядок TDD**

1. Чистые функции: `snapExpanded`, `cameraPadding` (ограничение по высоте, `null` высоты — без inset сверх базы).
2. `current-position(.web)` и `location-settings(.web)` — тесты на ветки разрешений, таймер, синхронный вызов на web.
3. `location-store` + `useLocate` → `MapControls onLocate` → `RouteMap` native/web: кнопка, камера, точка, сообщение,
   атрибуция слева, `fill`/`bottomInset`, колесо в `fill`.
4. `StatBlock variant="compact"`, `ElevationProfile` без заголовка.
5. `BottomSheet` native/web.
6. `RouteLineMap`/`CatalogRouteMap` (`fill`, ожидание inset, фон без карты) → экран `route-detail.tsx`.
7. i18n, `app.json`, документы, e2e.

**TESTS (матрица)**

| Уровень | Что |
|---|---|
| unit (native-проект jest) | `bottom-sheet-snap.test.ts` (порог хода, скорость, границы); `map-camera.test.ts` (`cameraPadding`); `location-store.test.ts` |
| native jest | `current-position.test.ts`: granted → `getCurrentPositionAsync`; undetermined → request → read; denied + `canAskAgain:false` → `canOpenSettings:true`; denied + `canAskAgain:true` → request; бросок/таймер → `unavailable`. `bottom-sheet.test.tsx`: тап меняет `expanded`, `accessibilityState.expanded` и подпись, свёрнута — тело скрыто от a11y; жест `createGestureController` → снап; reduce motion — без анимации. `route-map-locate.test.tsx`: нажатие → `readCurrentPosition` → `__camera.easeTo` с `padding` из `cameraPadding`, `LocationLayer` получает точку, счётчик рендеров `RouteMap` не растёт; denied → баннер → `Linking.openSettings`; повторное нажатие во время чтения игнорируется; `attributionPosition` слева и со сдвигом в `fill`. `stat-block.test.tsx` (compact: без note, a11y-метка с note). `elevation-profile.test.tsx` (нет заголовка, диапазон есть). `src/__tests__/route-detail.test.tsx`: названия под картой нет (только в шапке); строка цифр, чипы, профиль, кнопки в шторке; «Гонки на маршруте» в теле; скраббинг выключает прокрутку тела шторки; 04c-тест переписан; скелетон, 404, офлайн, pull-to-refresh тела. `location.test.tsx` (онбординг не читает координаты) — без изменений, зелёный |
| web jest (`*.web.test.*`) | `current-position.web.test.ts`: `getCurrentPosition` вызван синхронно (до первого микротаска), denied, insecure/нет API → `unavailable`, таймер ожидания. `bottom-sheet.web.test.tsx`: `renderToString` — развёрнута, без измерений; pointer-перетаскивание → снап; клик и Enter/Space переключают; `aria-expanded`. `route-map.web.test.tsx`: кнопка позиции → `addSource`/`setData` точки, `easeTo` с `offset` и без `padding`, `setPadding` не вызывается; `AttributionControl` в `'bottom-left'`; в `fill` колесо без защиты. Координаты не уходят в `console.*`, `fetch`, хранилище — шпионы |
| e2e (Playwright, смоук) | `/routes/<id>`: гидрация без ошибок консоли (`console-errors.ts`); кнопка «Свернуть панель» — `aria-expanded` меняется, слайдер профиля скрыт и снова виден; на 375 px значения строки цифр — одна строка, «Поделиться» и «Скачать GPX» — на одной высоте; существующие проверки SSR (OG, профиль через aria-label, GPX). Карты в CI нет (env стиля не задан) — кнопка позиции и камера в e2e не проверяются |
| вручную (NOT VERIFIED в CI) | iOS/Android: шторка vs карта одним пальцем vs скраббинг (R1); диалог разрешения, отказ → настройки; «i» видна над шторкой; web Safari/Chrome: Geolocation по HTTPS, колесо в `fill` |

**OUT OF SCOPE** — слежение, «рядом», шторка «Моего маршрута» (RC-16, follow-up) и карточки гонки, full-bleed на
десктопе, Reanimated, `IconButton`/шторка/токен длительности в app-foundation (follow-up), панель (routes-05).

## 12. Outcome (заполняет coder)

Coder, 2026-10-27. Статус: реализовано по §11; `TURBO_CONCURRENCY=1 pnpm check` (Node 24, изолированные Mongo/Redis) — EXIT 0 (format, lint, arch, typecheck, test: `Tasks: 13 successful, 13 total`); не закоммичено.

- **Шторка:** `components/bottom-sheet(.web).tsx`, `bottom-sheet-props.ts`, `bottom-sheet-snap.ts` (`snapExpanded`,
  `clampSheetOffset`, `SHEET_MAX_HEIGHT` 60 %, `SHEET_ANIMATION_MS` = `MAP_CAMERA_ANIMATION_MS`,
  `SHEET_FLING_VELOCITY` 500 px/с). Native — RNGH v3 `usePanGesture` (конфиг в `useMemo`) + `Animated` RN; web —
  pointer events на шапке (`touch-action: none`), CSS-переход, `ResizeObserver` для видимой высоты.
- **Экран:** `route-detail.tsx` — карта `fill` на всю область, шторка (шапка — `StatBlock variant="compact"`, тело —
  `ScrollView` с pull-to-refresh и блокировкой на скраббинг: чипы, профиль без заголовка, `RouteActions` в строку,
  гонки); скелетон — место карты + шторка-скелетон; 404 / ошибка без данных — без карты и шторки; офлайн-баннер — под
  шапкой.
- **Карта:** `RouteMap` `fill`/`bottomInset` (обе платформы), `cameraPadding`, атрибуция слева внизу (+ inset),
  колесо в `fill` без модификатора (web), «Моё местоположение» (`MapControls onLocate`, `MapOverlayControls`,
  `useLocate`, `MapLocateNotice`, `location-store`/`location-style`/`location-layer`), `RouteLineMap`/`CatalogRouteMap`
  — `fill` (ожидание inset, фон без карты).
- **Позиция:** `features/location/{position,current-position(.web),location-settings(.web)}.ts`.
- **Тексты/конфиг/доки:** i18n (`maps.controls.locate`, `maps.location.*`, `routes.detail.sheet.*`; удалён
  `routes.detail.profile.title`), `app.json` (строка iOS — нужна новая нативная сборка), ADR-0014 (поправка
  routes-04d), `pokatim-app.md`, `docs/product/routes.md`, `docs/product/onboarding.md`, e2e-шаг шторки.
- **Тесты:** `bottom-sheet-snap`, `bottom-sheet`, `bottom-sheet.web`, `map-camera` (`cameraPadding`), `location-store`,
  `current-position(.web)`, `map-controls`, `route-map-locate` (native), `route-map.web` (локация, fill, атрибуция),
  `stat-block` (compact), `elevation-profile` (без заголовка), `route-detail` (раскладка, шторка, офлайн, фон без
  карты, переписан 04c-тест).
- **NOT VERIFIED:** e2e Playwright (смоук web) — локально не запускался; устройства iOS/Android (жесты шторки vs карта
  vs скраббинг, диалог разрешения, отказ → настройки, «i» над шторкой); web Safari/Chrome — Geolocation по HTTPS,
  колесо в `fill`, анимация шторки.
