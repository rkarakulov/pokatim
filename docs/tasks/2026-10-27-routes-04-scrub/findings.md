# Findings — routes-04-scrub — pass 1 — reviewer: claude
base: origin/develop   commits: f120d76 (origin/develop...HEAD; рабочее дерево по задаче чистое)
verdict: APPROVE

Проверено самостоятельно: `apps/app: pnpm exec jest routes maps stat-block route-detail` — 128 suites / 1117 tests
passed; `packages/tracks: vitest run src/scrub.test.ts` — 19/19; `tsc --noEmit` app и tracks — exit 0.
Сверено по исходникам `node_modules`: MapLibre RN 11 (`LngLatBounds` = `[w, s, e, n]`, `onRegionDidChange` —
`NativeSyntheticEvent<ViewStateChangeEvent>` с `bounds`, `getViewState()`), RNGH 3.3.0 (`useGesture`,
`useClonedAndRemappedConfig`, `NativeDetector`), react-native-web 0.21 `ScrollViewBase` (`scrollDisabled`),
react-native-svg 15.16.0 (= `expo/bundledNativeModules.json` для SDK 58), React SSR `<style>` (не экранируется).

Без замечаний по измерениям: геометрия `pointAtFraction` / `elevationAt` / `gradeAt` (окно `max(200, шаг)`, края
внутрь, `−0`) / `gainTo` (на финише = `elevationGainM`) / `stepDistance` (эпсилон, границы); доля профиля ↔ доля
линии согласованы (`scrubReadout` берёт `f × длина профиля` для высоты и `f × distanceM` для км — курсор и подпись
совпадают); web-карта не пересоздаётся (`scrub` вне deps эффекта, тест `new Map` один раз); native `RouteMap`,
`GeoJSONSource` на кадр не перерисовываются (тест spy); экран — два ре-рендера за жест; карта гонки,
`race-route-map.tsx`, `route-map.web.test.tsx` не тронуты; `GestureRoot` — развилка файлами, RNGH не в web/SSR;
SSR slider — детерминирован (`useSyncExternalStore` с initial state, `useId`); a11y — adjustable/slider, озвучка
без стрелок с U+2212, декоративное скрыто; reduce motion — анимаций нет; i18n — ключи `routes.detail.scrub.*`;
контракты/API/миграции/очереди/аудит — не затронуты; безопасность — координаты не логируются.

### [MEDIUM] Конфиг жестов пересоздаётся на каждый кадр скраббинга → `setGestureHandlerConfig` в натив на кадр
- **file:** apps/app/src/features/routes/profile-chart.tsx; apps/app/src/features/maps/scrub-marker.tsx
- **location:** `ScrubbableChart` (стр. 169–201), `ScrubMarker` (стр. 25–48)
- **problem:** оба компонента подписаны на `fraction` и в том же рендере вызывают `usePanGesture({...})` с
  объектом-литералом и новыми колбэками. В RNGH v3 `useClonedAndRemappedConfig` мемоизирует по ссылке `config`,
  а `useGesture` в эффекте по `[config, gesture]` зовёт `NativeProxy.setGestureHandlerConfig` +
  `registerGesture`/`unregisterGesture`. Итог — на каждое движение пальца (каждое изменение доли) повторная
  передача конфига активного обработчика в натив и перерегистрация.
- **why_it_matters:** S7/RC-4 — 60 fps без лишней работы на кадр; пересылка конфига активному handler'у (на
  iOS/Android — `resetConfig` + `setConfig`) — лишний трафик через мост/JSI на каждом кадре и непроверенное поведение
  активного жеста (R1, NOT VERIFIED на устройстве). Тесты jest этого не ловят.
- **evidence:** `node_modules/react-native-gesture-handler/src/v3/hooks/utils/configUtils.ts:190` (`useMemo(..., [config, …])`),
  `src/v3/hooks/useGesture.ts` эффект `[handlerTag, config, type, gesture]` → `setGestureHandlerConfig`.
- **recommended_fix:** вынести подписку на `fraction` в дочерний компонент (курсор / точка маркера), а
  `GestureDetector` + `usePanGesture` держать в компоненте без подписки на долю; колбэки читать стор через
  `getState()` (уже так), значения `points`/`cumulative`/`tolerance` — через ref; либо `useMemo` конфига с
  зависимостями только от `points/cumulative/tolerance`. Тест: счётчик вызовов `setGestureHandlerConfig` (мок
  `NativeProxy`) не растёт при `store.setState({ fraction })`.

### [MEDIUM] Web: блокировка прокрутки экрана по `dragging` ломает вертикальный свайп с профиля (touch) и сдвигает раскладку на десктопе
- **file:** apps/app/src/features/routes/route-detail.tsx; apps/app/src/features/routes/profile-chart.web.tsx
- **location:** route-detail.tsx `scrollEnabled={scrollEnabled}` (≈ стр. 272, 288); profile-chart.web.tsx
  `onPointerDown` (стр. 139–146); scrub-marker.web.tsx `onPointerDown` (стр. 24–29)
- **problem:** на web `scrollEnabled={false}` в RN-web — это `overflowX/Y: hidden` + `touch-action: none` на
  `ScrollView`, а `ScrollViewStyleReset` (`+html.tsx`) делает `ScrollView` единственным скроллером страницы.
  (1) Касание профиля пальцем сразу ставит `dragging: 'profile'` (на web нет удержания 250 мс) → синхронный
  ре-рендер → скроллер получает `overflow: hidden` до того, как браузер начнёт панорамирование `pan-y`. Вертикальный
  свайп, начатый на профиле, не прокручивает страницу и превращается в скраббинг — вопреки RC-13 («`touch-action:
  pan-y` у графика — вертикальная прокрутка пальцем сохраняется»). (2) Перетаскивание маркера мышью ставит
  `dragging: 'map'` → у скроллера пропадает классическая полоса прокрутки (Windows/Linux, macOS «всегда показывать»)
  → ширина колонки меняется на ширину полосы → карта меняет размер (`aspectRatio`), MapLibre шлёт `resize` →
  `reproject` → маркер и всё ниже карты прыгают во время жеста, и обратно на отпускании.
- **why_it_matters:** §4.13/acceptance 1–2: web-поведение прокрутки и перетаскивания расходится с заявленным; на
  мобильном web часть экрана (профиль) перестаёт быть зоной прокрутки. Тест `profile-chart.web.test.tsx` проверяет
  только стор, не стиль скроллера; e2e не запускался (NOT VERIFIED).
- **evidence:** `node_modules/react-native-web/dist/exports/ScrollView/ScrollViewBase.js:127,135`
  (`scrollDisabled: { overflowX: 'hidden', overflowY: 'hidden', touchAction: 'none' }`); `+html.tsx:51`
  `<ScrollViewStyleReset />`.
- **recommended_fix:** на web не выключать прокрутку `ScrollView`: маркер уже `touch-action: none` + pointer
  capture, профиль — `pan-y` (браузер сам разводит горизонтальный скраббинг и вертикальную прокрутку через
  `pointercancel`). Например, флаг блокировки прокрутки — только native (развилка файлом, напр.
  `use-scrub-scroll-lock(.web).ts`), либо на web не писать `dragging` в стор для касания профиля. Тест web: при
  `dragging` стиль `ScrollView` не получает `overflow: hidden`.

### [MEDIUM] Допуск «петли» в метрах на обзорном зуме — доли пикселя: на «туда-обратно» с проходами > 15 м маркер прыгает между проходами
- **file:** packages/tracks/src/scrub.ts; apps/app/src/features/maps/scrub-line.ts
- **location:** `nearestFraction` (стр. 103–115), `scrubTolerance` (scrub-line.ts стр. 33–41)
- **problem:** кандидаты-проходы отбираются по `distances[i] <= best + tolerance`, где `tolerance` =
  15 м в пикселях вида. На статичной обзорной карте (маршрут 20–100 км в ~335 pt) 15 м ≈ 0,05–0,25 px, тогда как два
  прохода по одной дороге после упрощения (5 м) и GPS-разброса легко расходятся на 15–40 м — визуально одна линия
  (< 1 px), но разница расстояний до пальца выходит за допуск. Тогда подсказка не действует, и выбирается проход,
  ближе на доли пикселя: при ведении пальцем вдоль совпадающей линии доля скачет между ~0,2 и ~0,8 (маркер на месте,
  курсор профиля и карточка прыгают через весь график).
- **why_it_matters:** S2 («с предпочтением непрерывности — соседний участок, а не прыжок на другой проход»). Юнит-тесты
  проходят, потому что проходы в них совпадают точно (`[0,0]→[100,0]→[0,0]`) или допуск задан в пикселях с запасом
  (5 px при 400 единицах длины), а не как в рантайме.
- **evidence:** `scrubTolerance` = `SCRUB_LOOP_TOLERANCE_M * length / total`; тест `scrub.test.ts` «туда-обратно»
  с идентичными проходами и `tolerance = 1`; маршрут-тест `route-map-scrub.test.tsx` также с совпадающими проходами.
- **recommended_fix:** нижняя граница допуска в пикселях экрана (порядка радиуса касания/толщины линии, напр.
  `max(15 м в px, stroke.indicator…size.touchMin/4)`), либо выбор прохода по непрерывности (кандидат с долей в
  окне вокруг `hint`, пока он не дальше лучшего на N px). Тест: два почти параллельных прохода на расстоянии 0,5 px
  при допуске в метрах < 0,1 px — с подсказкой остаётся на своём проходе.

### [LOW] §8.2: «Reanimated в проекте не настроен» — неверно; jest проверяет не тот путь RNGH, что на устройстве
- **file:** apps/app/jest.setup.ts; docs/tasks/2026-10-27-routes-04-scrub/task.md
- **location:** jest.setup.ts стр. 38–48 (мок `reanimatedWrapper`); task.md §8.2 «Native: тап по профилю…»
- **problem:** `react-native-reanimated` 4.7.1 и `react-native-worklets` 0.13.0 — в зависимостях `apps/app`
  (babel-preset-expo подключает плагин worklets сам), т. е. на устройстве RNGH видит Reanimated; в jest обёртка
  RNGH принудительно «без Reanimated» (а `isTestEnv()` и так ставит `disableReanimated`). Обоснование отказа от
  `useExclusiveGestures` построено на неверной посылке; поведение «тап = касание без активации» при этом рабочее.
- **why_it_matters:** путь детектора на устройстве (`shouldUseReanimatedDetector` при наличии worklet-колбэков) в
  CI не исполняется — расхождение надо фиксировать как NOT VERIFIED, а не как факт.
- **evidence:** apps/app/package.json:45,50; `react-native-gesture-handler/src/v3/hooks/utils/configUtils.ts:42–83`.
- **recommended_fix:** поправить формулировку §8.2 (Reanimated установлен; композиция не используется ради простоты /
  отсутствия настроенных моков) и добавить проверку жеста профиля на устройстве в §12 NOT VERIFIED.

### [LOW] Documentation Sync: §10/§11 task.md утверждают «новых зависимостей нет, ADR не нужен» при добавленном `react-native-svg`
- **file:** docs/tasks/2026-10-27-routes-04-scrub/task.md
- **location:** §10 (стр. «ADR не нужен (новых зависимостей…)»), §11 («Новых зависимостей нет»), §5.1 запрет
  `react-native-svg`
- **problem:** решение G2 (§15, пользователь) и §8.2 добавили нативную зависимость, но §10/§11 не обновлены; вопрос
  ADR для новой нативной зависимости (AGENTS.md §4.9 «без ADR — не на вырост») не закрыт явно.
- **why_it_matters:** противоречивый task.md — следующий агент (routes-05, 04b) опирается на устаревшую фразу.
- **evidence:** `apps/app/package.json` `"react-native-svg": "15.16.0"`; task.md §10 последняя фраза.
- **recommended_fix:** обновить §10/§11 (зависимость по решению пользователя G2; ADR не требуется / или короткая
  запись в ADR-0014 или новом ADR — по правилу проекта).

### [LOW] Комментарий `load-svg-native.ts` неточен о причине падения
- **file:** apps/app/src/features/routes/load-svg-native.ts
- **location:** стр. 1–5
- **problem:** `react-native-svg` 15.16 не зовёт `TurboModuleRegistry.getEnforcing` при импорте — модули
  `RNSVG*Module` грузятся лениво `require` внутри методов (`elements/Shape.tsx`, `css/LocalSvg.tsx`); в старом
  dev-клиенте реальный сбой — рендер нерегистрированных Fabric-компонентов `RNSVG*`. Детект по TurboModules — разумный
  прокси, но комментарий вводит в заблуждение при будущей правке (например, «статический импорт безопасен»).
- **why_it_matters:** сопровождаемость фолбэка G2.
- **evidence:** `node_modules/react-native-svg/src/elements/Shape.tsx:295`, `src/fabric/NativeSvgViewModule.ts:14`.
- **recommended_fix:** переформулировать: «без нативной части пакет падает при рендере / вызове модуля; ленивый импорт
  после `svgSupported()` — чтобы фолбэк не зависел от деталей пакета».

## NOT VERIFIED
- Устройство iOS/Android: long-press-pan профиля в `ScrollView` и pull-to-refresh (R1), проекция маркера по
  `ViewState.bounds` при `MAP_FIT_PADDING` и его перетаскивание (R2), 60 fps, вид `react-native-svg` и фолбэк в
  старом dev-клиенте — нет устройства в сессии.
- Web в браузере: e2e `E2E_API=1`, гидрация, поведение touch-скролла (finding MEDIUM 2 — по коду RN-web, не в браузере).

## Фиксы после pass 1 (coder, 2026-10-27; поверх f120d76, не закоммичено)

- **M1 — конфиг жестов на кадр.** `profile-chart.tsx`: `ScrubbableChart` — носитель `GestureDetector` без подписки на
  долю, конфиг `usePanGesture` — `useMemo` по стору (колбэки читают `getState`, ширина и «активирован» — ref);
  подписчик доли — `ScrubbableBody` (значение `adjustable`, курсор). `scrub-marker.tsx`: конфиг — `useMemo` по
  `store/points/cumulative` (меняется только при пересчёте проекции), подписчик — `MarkerDot`. Тесты
  (`elevation-profile.test.tsx`, `route-map-scrub.test.tsx` «M1»): шпион `NativeProxy.setGestureHandlerConfig`
  (в jest RNGH резолвится в `lib/module`) — число вызовов не растёт при `store.setState({ fraction })` × N.
  Отрицательное доказательство: конфиг маркера, пересоздаваемый по доле, — тест красный (`Expected: 1, Received: 4`).
  Попутно: литерал-конфиг в вызове хука плагин worklets превращал в worklet'ы — теперь переменная, колбэки на JS
  (`runOnJS: true`).
- **M2 — web-прокрутка.** Блокировка прокрутки по `dragging` — только native: `use-scrub-scroll-lock.ts`
  (`dragging === null`) / `use-scrub-scroll-lock.web.ts` (всегда `true`); `route-detail.tsx` берёт
  `useScrubScrollEnabled`. Web: график — `touch-action: pan-y`, маркер — `none` + захват указателя (без изменений).
  Тест `use-scrub-scroll-lock.web.test.tsx`: RN-web `ScrollView` при `dragging` 'profile'/'map' не получает
  `overflow: hidden` и смену `touch-action`; отрицательное доказательство — с native-реализацией красный
  (`Expected: "auto", Received: "hidden"`). Native-тест `route-detail` (жест выключает прокрутку) — без изменений.
- **M3 — допуск петли.** `scrub-line.ts`: `SCRUB_TOLERANCE_MIN_PX = 12`, `scrubTolerance` = `max(15 м в px, 12 px)`
  (обе платформы, вход `nearestFraction` не менялся). Тест `scrub-line.test.ts`: «туда-обратно» 30 км в 335 px с
  проходами в 30 м (≈ 0,33 px), палец ближе к обратному проходу — доля идёт по своему проходу на 4 шагах; с допуском
  только в метрах — прыжок (> 0,5).
- **LOW.** task.md §8.2 — Reanimated 4.7.1 в зависимостях есть, композиция не используется ради простоты; jest — путь
  RNGH «без Reanimated» → в §12 NOT VERIFIED «путь RNGH v3 с Reanimated на устройстве»; §10/§11 — `react-native-svg`
  15.16.0 как новая зависимость и почему ADR не нужен; комментарий `load-svg-native.ts` — причина падения (рендер
  `RNSVG*` / вызовы модулей без нативной части). `.claude/rules/pokatim-app.md` — блокировка прокрутки только native,
  нижняя граница допуска, стабильный конфиг жеста, путь RNGH в jest.

Проверка: `PATH=~/.nvm/versions/node/v24.22.1/bin:$PATH MONGO_URL_TEST=… REDIS_URL_TEST=… TURBO_CONCURRENCY=1 pnpm check`
— exit 0 (format, lint, arch, typecheck, тесты 13/13; app: 129 suites / 1121 tests). Устройство и браузер — NOT
VERIFIED, как в §12.

---

# Findings — routes-04-scrub — pass 2 — reviewer: claude
base: origin/develop   commits: f120d76, fb8c671 (фиксы pass 1); рабочее дерево по задаче чистое
verdict: APPROVE

Проверено самостоятельно: `apps/app: pnpm exec jest routes maps route-detail use-scrub` — 129 suites / 1121 tests
passed (native + web + server проекты); `tsc --noEmit -p apps/app` — exit 0.

Сверка фиксов pass 1:
- **M1 — исправлено.** `ScrubbableChart` (profile-chart.tsx) и `ScrubMarker` (scrub-marker.tsx) больше не подписаны на
  долю; конфиг `usePanGesture` — `useMemo` по `[scrub]` / `[store, points, cumulative]`, колбэки читают стор через
  `getState`, ширина и «активирован» — ref. Подписчики доли — `ScrubbableBody` / `MarkerDot` (дети `GestureDetector`).
  `linePoints`/`cumulative` в `route-map.tsx` — `useMemo` по `viewBounds/viewSize` и `map`: на статичной карте конфиг
  маркера не меняется во время жеста. RNGH `lib/module/v3/hooks/useGesture.js:49–59` — `setGestureHandlerConfig` в
  эффекте по `[handlerTag, config, type, gesture]`, т. е. шпион теста бьёт ровно в механизм из M1; `ProfileChart` и
  `ElevationProfile` на долю не подписаны (ре-рендер носителя жеста на кадр не возникает выше по дереву).
- **M2 — исправлено.** `use-scrub-scroll-lock.ts` (native: `dragging === null`) / `.web.ts` (всегда `true`) — развилка
  файлами по правилу проекта; `route-detail.tsx` — единственный потребитель. Web-тест в проекте `web` (jest-expo/web
  резолвит `.web.ts`) рендерит настоящий RN-web `ScrollView` и проверяет computed `overflowY`/`touchAction` — ловит
  ровно регрессию из M2. Native-тест блокировки прокрутки не тронут и зелёный.
- **M3 — исправлено.** `scrubTolerance = max(15 м в px, SCRUB_TOLERANCE_MIN_PX = 12)`, вход `nearestFraction` не
  менялся, обе платформы берут `scrubTolerance`. Тест `scrub-line.test.ts` — проходы в ≈ 0,33 px, палец ближе к
  обратному; с нижней границей — 4 шага по своему проходу, с допуском только в метрах — прыжок `> 0,5` (отрицательная
  проверка внутри теста). Побочный эффект «липкости» в пределах 12 px (серпантин на обзорном зуме: маркер остаётся на
  текущей ветке, пока соседняя не ближе на 12 px) — это и есть требуемая S2 непрерывность; 12 px < половины маркера.
- **LOW 1–3 — исправлены.** §8.2 (Reanimated есть, композиция не используется, путь RNGH с Reanimated — NOT VERIFIED
  в §12), §10/§11 (`react-native-svg` 15.16.0 по G2, обоснование без ADR), комментарий `load-svg-native.ts`;
  `.claude/rules/pokatim-app.md` синхронизирован (блокировка только native, нижняя граница допуска).

Без замечаний по измерениям: контракты/API/миграции/очереди/аудит/безопасность — не затронуты; i18n — новых строк нет;
дизайн-система — без изменений вида; placement — новые файлы в `features/routes`, развилка `.web` по правилу.

### [LOW] M1-тесты не проверяют, что шпион вообще видит вызовы — при смене пути резолва RNGH станут тавтологией
- **file:** apps/app/src/features/routes/elevation-profile.test.tsx; apps/app/src/features/maps/route-map-scrub.test.tsx
- **location:** тесты «M1: …» (шпион `NativeProxy.setGestureHandlerConfig` через `jest.requireActual('…/lib/module/v3/NativeProxy')`)
- **problem:** утверждается только `calls.length === before`. Если RNGH в jest начнёт резолвиться в другой вход
  (`lib/commonjs`, `src` — смена `customExportConditions`/версии пакета) или `NativeProxy` окажется замокан
  `jestSetup`, шпион будет висеть на другом экземпляре модуля: `before = 0`, после — `0`, тест зелёный при
  вернувшейся регрессии. Сейчас путь верный (coder показал красный прогон `Expected: 1, Received: 4`), но защита
  держится на неявном факте.
- **why_it_matters:** тесты — единственная автоматическая защита M1 (на устройстве не проверяется).
- **evidence:** тела тестов — нет `expect(before).toBeGreaterThan(0)`; монтирование вызывает
  `setGestureHandlerConfig` (useGesture.js:49–51), т. е. `before ≥ 1` при правильном пути.
- **recommended_fix:** добавить `expect(before).toBeGreaterThan(0)` в оба теста.

### [LOW] Web-касание: вертикальный свайп с профиля теперь прокручивает страницу, но оставляет курсор и карточку активными
- **file:** apps/app/src/features/routes/profile-chart.web.tsx
- **location:** `onPointerDown` (стр. 139–146), `release` по `onPointerCancel` (стр. 150–152)
- **problem:** после M2 свайп с профиля пальцем прокручивает страницу (как и требует RC-13), но `onPointerDown`
  сразу делает `follow` → `active: true` в точке касания, а `pointercancel` (браузер забрал жест в `pan-y`) снимает
  только `dragging`. Итог: страница прокручивается с курсором и карточкой значения, «застрявшими» в случайной точке
  касания, до следующего касания вне профиля. На native то же действие курсор скрывает (§8.2: «начало прокрутки при
  касании профиля тоже скрывает курсор», `onScrollBeginDrag`). RC-8 для web-касания явно требует только
  `pointerdown` вне профиля, поэтому это не нарушение спеки, а расхождение платформ, открытое фиксом M2.
- **why_it_matters:** UX на мобильном web — случайный курсор после обычной прокрутки; паритет с native.
- **evidence:** `release` — `if (dragging === 'profile') setState({ dragging: null })`, `active` не трогается;
  `touchAction: 'pan-y'` на том же `div`.
- **recommended_fix:** на `pointercancel` касания (не мыши) ставить `active: false` (браузер отменяет указатель как раз
  при начале прокрутки), отдельный обработчик вместо общего `release`; web-тест: `pointerdown` (touch) →
  `pointercancel` → курсор скрыт. Можно отложить в routes-04b.

## NOT VERIFIED (pass 2)
- Как в pass 1: устройство (R1, R2, 60 fps, путь RNGH v3 с Reanimated, отсутствие `setGestureHandlerConfig` на кадр
  на реальном натив-модуле), браузер (e2e, touch-прокрутка с профиля, полоса прокрутки при перетаскивании маркера).
- Отрицательные прогоны coder (M1 `Expected: 1, Received: 4`, M2 `Expected: "auto", Received: "hidden"`) не
  воспроизводились (правка кода запрещена ревью); по коду тестов и RNGH они согласуются с механизмом.

## Фиксы после pass 2

- LOW 1: в тестах M1 (`elevation-profile.test.tsx`, `route-map-scrub.test.tsx`) — `expect(before).toBeGreaterThan(0)`:
  шпион на том же экземпляре RNGH, что и компонент.
- LOW 2: web — `pointercancel` касания (браузер начал прокрутку, `pan-y`) скрывает курсор, как native. Тест
  `profile-chart.web.test.tsx`; отрицательное доказательство — с прежним `release` тест красный (1 failed).
