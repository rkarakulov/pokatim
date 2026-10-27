# Findings — routes-04d-sheet — pass 1 — reviewer: claude
base: origin/develop   commits: a9c53a2 (origin/develop...HEAD), working tree чистый (кроме чужой папки routes-05)
verdict: APPROVE

Проверено самостоятельно (Node 24): `pnpm exec jest maps routes location components route-detail race my-routes` —
139 suites / 1203 tests passed; `pnpm exec tsc --noEmit` — EXIT 0; `eslint` по изменённым ts/tsx — EXIT 0.

Покрытые измерения: correctness, регрессии (карта гонки, «Мой маршрут», `race-my-track` — атрибуция слева, кнопка
позиции через общий `RouteMap`), безопасность/приватность, placement (шторка — `components/`, позиция —
`features/location/*` развилкой файлами, `expo-location` только в native-файле, `Platform.OS` нет), i18n (все строки —
`t()`, удалён неиспользуемый `routes.detail.profile.title`), дизайн-система (роли темы, токены `size`/`stroke`/`space`),
состояния §4.12 (скелетон той же раскладки, 404/ошибка без карты и шторки, офлайн под шапкой, pull-to-refresh в теле),
все платформы (native + `.web` для шторки, позиции, настроек), Documentation Sync (ADR-0014, `pokatim-app.md`,
`docs/product/routes.md`, `onboarding.md`, `app.json` — по §10). Контракты/API/БД/очереди/аудит/миграции — не затронуты.

Подтверждено по коду:
- Приватность (G2): координаты идут только `readCurrentPosition` → `useLocate` (в состояние хука не попадают) →
  `onPosition` → `location-store` (zustand/vanilla без persist/devtools, на экземпляр) / источник maplibre; в
  `console.*`, TanStack Query, URL (`hash` не включён), подписи a11y и запросы не попадают; web-тест со шпионами
  console/fetch/storage есть. Разрешение — при первом нажатии; отказ навсегда — `Banner onPress` → `Linking.openSettings`.
- Web: `navigator.geolocation.getCurrentPosition` вызывается синхронно (`useLocate.locate` → `readCurrentPosition` до
  любого `await`; тест «до первого микротаска»); небезопасный контекст/нет API — `unavailable`.
- SSR шторки: развёрнута, без `useId`, измерения только в эффектах (`ResizeObserver`/`offsetHeight`), `instant=true` —
  `transition`/`transform` в разметке не зависят от `useReducedMotion`; карта в `fill` не монтируется до `bottomInset`.
- Камера: native — явный `padding: cameraPadding(...)` во всех вызовах; web — `easeTo({ offset: [0, -inset/2] })`,
  `fitBounds` с padding (maplibre-gl `_fitInternal` удаляет `padding` перед `easeTo` — постоянным `tr.padding` не
  становится); `cameraPadding` ограничен высотой карты.
- Атрибуция: native `attributionPosition {bottom: s2+inset, left}`, web `AttributionControl` в `'bottom-left'` +
  CSS-сдвиг на inset; колесо в `fill` — без `guardWheelZoom`.
- Ре-рендер карты: высота шторки уходит наружу только вне движения (конец снапа/раскладка); состояние чтения позиции —
  в листовом `MapOverlayControls`; тест-счётчик рендеров `Map` честный (подмена компонента мока).
- Жесты: перетаскивание — только шапка (RNGH v3 `usePanGesture`, конфиг в `useMemo`, `runOnJS`); карта — сосед вне
  `ScrollView`; скраббинг блокирует прокрутку тела шторки (тест 04c переписан и проверяет это).

### [MEDIUM] Компактная строка цифр обрезается многоточием при крупном шрифте
- **file:** apps/app/src/components/stat-block.tsx
- **location:** `CompactStats` (Text с `numberOfLines={1}`, стиль `compactCell` с `minWidth: 0`)
- **problem:** в `variant="compact"` подпись и значение жёстко в одну строку с обрезкой. Три равные колонки ≈ 100 px
  на 375; при системном крупном шрифте (Dynamic Type / font scale ≥ ~1.3) «2 ч 30 мин» превращается в «2 ч 3…»,
  «Дистанция» — в «Дистан…».
- **why_it_matters:** `.claude/rules/app.md` (доступность: «крупный шрифт»); зрячий пользователь с увеличенным
  шрифтом теряет данные — полное значение есть только в `accessibilityLabel` (скринридер). Для обычного варианта
  компонент явно делает обратное («„км“ при крупном шрифте переносится под значение, а не обрезается»). Это единственное
  место, где цифры видны в свёрнутой шторке.
- **evidence:** `<Text testID="stat-block-value" numberOfLines={1} ...>{item.value}{unit}</Text>`; комментарий стиля:
  «узко — значение обрезается многоточием, а не переносится». e2e проверяет только 375 px при масштабе 1.
- **recommended_fix:** при крупном шрифте допускать перенос значения (например, `numberOfLines` только при
  `fontScale <= 1` через `useWindowDimensions().fontScale`, иначе без ограничения; или `maxFontSizeMultiplier` на
  значении с осознанным пределом), плюс тест компонента на поведение при увеличенном `fontScale`.

### [LOW] Native-шторка: снап, прерванный жестом, вызывает `finish` как завершённый
- **file:** apps/app/src/components/bottom-sheet.tsx
- **location:** `settle` (`Animated.timing(...).start(finish)`), `config.onActivate` (`translate.stopAnimation()`,
  `offset.current = live.current.expanded ? 0 : range.current`)
- **problem:** колбэк `start` получает `{ finished }`, а `finish` его игнорирует. Сценарий: тап «Свернуть панель» и в
  пределах `SHEET_ANIMATION_MS` схватить шапку → `stopAnimation` синхронно вызывает `finish` → `setMoving(false)` и
  `onExpandedChange(false)` посреди начинающегося жеста; `onActivate` берёт `offset` от устаревшего
  `live.current.expanded` (0), хотя визуально шторка была на середине хода, а после ре-рендера `start` в `onUpdate`
  переключается на `range` — два скачка шторки под пальцем. Аналог на web: перетаскивание во время CSS-перехода
  стартует от `expanded ? 0 : height`, а не от текущего смещения перехода. Итоговое состояние согласуется (снап
  исправляет), это визуальный дефект редкой последовательности. NOT VERIFIED на устройстве.
- **why_it_matters:** рывок шторки под пальцем; лишний вызов `onExpandedChange` (и смена a11y-подписи) посреди жеста.
- **evidence:** `}).start(finish);` при `const finish = () => { setMoving(false); if (toExpanded !== live.current.expanded) live.current.onExpandedChange(toExpanded); }`.
- **recommended_fix:** `start(({ finished }) => { if (finished) finish(); })`; в `onActivate` брать стартовое смещение
  из текущего значения анимации (`translate.stopAnimation((value) => { offset.current = value; })`), а `onUpdate`
  считать от него, а не от `live.current.expanded`.

### [LOW] Web: после перетаскивания, начатого не на «чёрточке», первое нажатие «чёрточки» с клавиатуры игнорируется
- **file:** apps/app/src/components/bottom-sheet.web.tsx
- **location:** `onPointerMove` (`suppressPress.current = true`), `toggle` (сброс флага), `onPointerDown`
- **problem:** флаг `suppressPress` ставится при любом активном перетаскивании шапки, а сбрасывается только в
  `toggle` или следующем `pointerdown`. Если перетаскивание начато на строке цифр (не на `Pressable`), клик после
  жеста до «чёрточки» не доходит (захват указателя на шапке) — флаг остаётся `true`. Затем пользователь Tab-ом
  переходит на «чёрточку» и жмёт Enter/Space — `toggle` съедает нажатие.
- **why_it_matters:** клавиатурное управление шторкой (L4/RC-17) срабатывает со второго раза в смешанном сценарии
  мышь/тач + клавиатура.
- **evidence:** `if (suppressPress.current) { suppressPress.current = false; return; }` — единственное место сброса,
  кроме `onPointerDown`.
- **recommended_fix:** ставить флаг только если `pointerdown` был внутри «чёрточки» (`grabber.current?.contains(event.target)`),
  либо сбрасывать его в `setTimeout(0)` после `pointerup`/в обработчике `click` шапки.

### NOT VERIFIED
- e2e Playwright (смоук web: гидрация без #418, шторка 375 px, кнопки в строку) — локально не запускался ни coder,
  ни ревьюером (нужен API); проверит CI.
- Устройства iOS/Android: конфликт жестов шторка/карта/скраббинг, плавность снапа при занятом JS-потоке, диалог
  разрешения и переход в настройки, видимость «i» над шторкой (на iOS орнаменты MapLibre дополнительно учитывают
  safe area карты — возможен зазор над шторкой, не ошибка); web Safari/Chrome — Geolocation по HTTPS, колесо в `fill`.
- Порядок кадров native при начале перетаскивания из свёрнутой (`onUpdate` до коммита `moving=true` сдвигнул бы
  свёрнутую шапку вниз на кадр) — зависит от того, как RNGH v3 диспатчит `onActivate`/`onUpdate` относительно
  батчинга React; в jest не воспроизводится.

## Фиксы после pass 1 (coder, 2026-10-27)

- **M1** `stat-block.tsx` `CompactStats`: `numberOfLines={1}` у подписи и значения — только при
  `useWindowDimensions().fontScale <= 1`; крупный системный шрифт — перенос внутри колонки, без многоточия. Тест
  `stat-block.test.tsx` «крупный шрифт» (`Dimensions.set` с `fontScale: 1.6`: без `numberOfLines`, текст целиком);
  тест обычного размера явно задаёт `fontScale: 1` (мок Dimensions jest — 2).
- **L1 native** `bottom-sheet.tsx`: `Animated.timing(...).start(({ finished }) => { if (finished) finish(); })` —
  прерванный снап не меняет `expanded` и `moving`; `onActivate` берёт стартовое смещение из
  `translate.stopAnimation(value => …)`, если шторка двигалась (`dragStart`), `onUpdate` считает от него. Тест
  `bottom-sheet.test.tsx` (L1): тап «Свернуть» → захват шапки → `onExpandedChange` не вызван, `setValue(150 + 10)`
  (значение натива — шпион `stopAnimation`; нативный драйвер в jest анимацию не шагает).
- **L1 web** `bottom-sheet.web.tsx`: перетаскивание при незавершённом переходе (таймер снапа активен) отменяет таймер и
  стартует с вычисленного `transform` (`computedOffset`: `matrix(...)`/`translateY`). Тест (L1): переход к 300, вычисленный
  сдвиг 180 → `translateY(170px)` после движения −10, отменённый переход шторку не сворачивает.
- **L2 web**: `suppressPress` ставится только если `pointerdown` был на «чёрточке» (`grabberBox.contains(target)`) и
  сбрасывается `setTimeout(0)` после `pointerup` (клик после жеста приходит раньше). Тесты (L2): жест за строку цифр →
  следующий click «чёрточки» переключает; жест на «чёрточке» без клика → после таймера click переключает; существующий
  тест «клик после жеста — не тап» начинает жест на «чёрточке».
