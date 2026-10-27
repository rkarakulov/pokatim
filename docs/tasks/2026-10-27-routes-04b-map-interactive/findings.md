# Findings — routes-04b-map-interactive — pass 1 — reviewer: claude
base: origin/develop   commits: 08d5932 (origin/develop..HEAD, рабочее дерево чистое)
verdict: APPROVE

Проверено: `pnpm exec jest maps routes races route-detail my-routes race-route-map` — 132 suites / 1153 tests зелёные;
`pnpm exec tsc --noEmit` — 0 ошибок; `eslint` по затронутым путям app — чисто; `prettier --check` изменённых файлов —
чисто. Сверено по исходникам `node_modules`: RNGH v3 `eventHandler.ts` (`onDeactivate` только из `ACTIVE` — счётчик
блокировки корректен, лишнего декремента нет), MapLibre RN 11.5 `Camera.tsx` (`jumpTo` = `setStop` duration 0,
`fitBounds` по умолчанию 2000/`fly` — длительность передаётся явно), iOS/Android `initialViewState` применяется один
раз (`_view.initialViewState == nil` / `hasInitialViewState()`) — ре-рендер `RouteMap` на старте/конце жеста камеру
не сбрасывает; `expo-symbols` web/Android — имена `add`/`remove`/`fit_screen` есть в `symbols.json`.

Измерения без замечаний: математика `cameraAfterGesture`/`zoomAround` (инвариант «точка под пальцами» выведен верно,
тест — независимая проекция, не тавтология); стабильные конфиги RNGH (`useMemo` по ref, M1 сохранён в
`scrub-marker.tsx`); RNGH только в native-файле (`map-gestures.ts` импортирует лишь `route-map.tsx`); стор вида — на
экземпляр, подписан только `ScrubLayer`; web-карта не пересоздаётся (`reduce`/`scrub` через ref); SSR — карта и кнопки
только после монтирования, нового `useId`/клиентских значений в SSR-разметке нет; reduce motion (`null` → без
анимации) на обеих платформах; a11y кнопок (роль, подпись, `touchMin`), исключение RC-11 записано в ADR-0014 п. 6;
коридор/трек карты гонки — без изменений слоёв, тесты обновлены; `query-wrapper.tsx` повторяет `GestureRoot` корня,
`jest.match-media.web.ts` — только отсутствующий в jsdom API, ошибки не маскируют; Documentation Sync (§10) — ADR-0014,
`pokatim-app.md`, `routes.md`, `races-and-seasons.md` обновлены; i18n — все строки в `ru.ts`; контракты/сервер/
миграции/очереди не затронуты.

### [MEDIUM] `MAP_MIN_ZOOM = 4` обрезает начальную камеру и «в рамку» у длинных маршрутов по вертикали
- **file:** apps/app/src/features/maps/map-camera.ts
- **location:** `MAP_MIN_ZOOM` (стр. 9); применение — `route-map.web.tsx` `minZoom` + `bounds`/`fitBoundsOptions`, `route-map.tsx` `Camera minZoom` + `initialViewState`/`fitBounds`
- **problem:** обоснование RC-8 («≈ 1100 км по ширине — рамка любого реального маршрута не обрезается») считает только ширину. Карта 3:2 (`MAP_ASPECT_RATIO`): при ширине 360–375 px высота ≈ 240–250 px, минус `MAP_FIT_PADDING` сверху/снизу (≈ 48 + 44) остаётся ≈ 150 px; на zoom 4 (мир 8192 px) на широте 54° это ≈ 4° широты ≈ 430–460 км. Маршрут/коридор протяжённее по север–юг вписывается с зумом < 4, а `minZoom` поднимает его до 4 — старт/финиш уходят за край, и «Показать маршрут целиком» тоже не показывает маршрут целиком. До routes-04b минимального зума не было — это регрессия вписывания.
- **why_it_matters:** реальные данные это допускают: `RACE_DISTANCE_MAX_KM = 1000` (`packages/contracts/src/races/race.schema.ts:90`), Беларусь по вертикали ≈ 560 км, «Мои маршруты» — произвольный GPX (бревеэ 600/1000 км, тур за границей — RC-8 сам отказался от `maxBounds` ради них). Кнопка с подписью «Показать маршрут целиком» в этом случае врёт; MapLibre молча клампит зум (web `transform` по `minZoom`, native `setMinZoomPreference`).
- **evidence:** `export const MAP_MIN_ZOOM = 4;` + `minZoom: MAP_MIN_ZOOM, … bounds: unionBounds(…), fitBoundsOptions: { padding: MAP_FIT_PADDING, animate: false }` (web), `<lib.Camera minZoom={MAP_MIN_ZOOM} … initialViewState={{ bounds, padding: MAP_FIT_PADDING }} />` (native); тест `map-camera.test.ts` проверяет только клампинг, не вписывание длинной рамки.
- **recommended_fix:** опустить минимум до значения, гарантирующего вписывание максимальной реалистичной рамки на узком телефоне (zoom 2–3; на zoom 3 ≈ 900 км по вертикали), либо записать в ADR-0014/§8.2 осознанное ограничение (маршруты > ~450 км по вертикали вписываются обрезанно). Добавить тест: рамка ~6° широты → опции/`fitBounds` не упираются в `MAP_MIN_ZOOM` (или фиксация ограничения).

### [MEDIUM] Web: любая ошибка тайла при панорамировании навсегда переводит карту в «Карта не загрузилась» и убирает кнопки
- **file:** apps/app/src/features/maps/route-map.web.tsx
- **location:** стр. 134 `created.on('error', () => setFailed(true))`; стр. 171 `{ready && !failed ? <MapControls …/> : null}`
- **problem:** обработчик `error` maplibre-gl получает и ошибки отдельных тайлов (не только стиля). Пока карта была статичной (одна рамка — один набор тайлов), это было «ошибка стиля или тайлов при загрузке». Теперь пользователь двигает и масштабирует карту — каждая новая область и зум догружают тайлы; один сбой сети/таймаут любого тайла (мобильный интернет, потеря соединения на секунду) поднимает `failed` без сброса: поверх живой интерактивной карты висит «Карта не загрузилась», а кнопки «+», «−», «в рамку» исчезают, хотя карта работает (перетаскивание, Ctrl+колесо продолжают действовать).
- **why_it_matters:** интерактивность резко увеличивает частоту этого сценария; состояние ложное и необратимое до перезахода (ADR-0014: «повтор — перезаход на карточку»), пропадает единственный a11y-путь масштаба/возврата (кнопки — основа исключения RC-11). Native так не делает: `onDidFailLoadingMap` — только стиль, т. е. поведение платформ расходится (§4.13).
- **evidence:** `created.on('error', () => setFailed(true));` без фильтра; `failed` сбрасывается только в эффекте создания карты.
- **recommended_fix:** считать фатальной только ошибку до `load`/ошибку стиля (например, `failed` — если `error` пришёл до `load` или у события нет `tile`/`sourceId`), ошибки тайлов после `load` игнорировать (MapLibre сам перезапросит при следующем движении); либо по крайней мере не скрывать кнопки при `failed` после `load`. Тест в `route-map.web.test.tsx`: `error` с `{ tile, sourceId }` после `load` — сообщения нет, кнопки на месте.

### [LOW] Native: скачок камеры при активации пана после щипка (двойной учёт смещения)
- **file:** apps/app/src/features/maps/map-gestures.ts
- **location:** `activate` / `pan.onActivate` (стр. ~86–94, 113–121)
- **problem:** если первым активируется щипок, `focal0` = фокус щипка в момент его активации (уже включает смещение пальцев с начала касания), затем активируется пан и пишет `state.translation = event.translation` — смещение, отсчитанное от начала пана (≈ начала касания). Смещение до активации щипка учитывается дважды → на активации пана камера прыгает на величину до порога активации пана (≈ 8–10 dp). Аналогично на Android, если второй палец лёг после того, как первый уже сдвинулся, `translation` пана включает путь одного пальца (NOT VERIFIED на устройстве — зависит от пересчёта смещения RNGH при `averageTouches`).
- **why_it_matters:** заметный рывок карты в начале жеста двумя пальцами (самый частый порядок — щипок раньше пана при разведении пальцев); тест `route-map-gestures.test.tsx` «пан и щипок одновременно» активирует пан с `translation 0`, сценарий не покрыт.
- **evidence:** `activate([event.focalX, event.focalY])` (щипок) → позже `state.translation = [event.translationX, event.translationY]` (пан, при `state.active > 1` `focal0` не пересчитывается); `apply()` — `focal: focal0 + translation`.
- **recommended_fix:** на активации второго жеста запоминать базу смещения (`translationBase = event.translation`) и применять `translation − translationBase`; или брать `focal0` всегда из пана (`x − translationX`) при его активации, а щипку отдавать только масштаб. Тест: щипок активирован с фокусом, сдвинутым на 6 px, затем пан с `translationX: 10` — `jumpTo` без скачка.

### [LOW] task.md §12 «Не закоммичено» устарело
- **file:** docs/tasks/2026-10-27-routes-04b-map-interactive/task.md
- **location:** §12 Outcome, «Статус»
- **problem:** изменение закоммичено (08d5932), в Outcome — «Не закоммичено».
- **why_it_matters:** Documentation Sync — task.md вводит в заблуждение следующего читателя.
- **recommended_fix:** обновить статус (коммит, проверки).

NOT VERIFIED (вне CI, как и у автора): жесты двумя пальцами внутри `ScrollView` на iOS/Android (R1: сдвиг страницы до
активации, переключение `scrollEnabled` посреди жеста, Android-перехват прокрутки до второго пальца), кооперативные
жесты в мобильном Safari/Chrome (R2), смоук `pnpm e2e:web` (не запускался — карты в смоуке нет, RC-13), полный
`TURBO_CONCURRENCY=1 pnpm check` (запускались только таргетные jest + tsc + eslint/prettier изменённых файлов).

## Фиксы после pass 1

Поверх 08d5932, не закоммичено. Каждый новый тест проверен отрицательно: без фикса — красный (3 failed), с фиксом — зелёный.

- **M1 — fixed.** `map-camera.ts`: `MAP_MIN_ZOOM = 2` (было 4). На зуме 2 карта 3:2 шириной 320 px вмещает ≈ 13° широты
  на 54° с. ш. (≈ 1400 км) после отступов `MAP_FIT_PADDING`. Тест `map-camera.test.ts` «рамка маршрута 1000 км с севера
  на юг…»: независимый расчёт зума вписывания (как `fitBounds`) для рамки `[27, 47.5, 28, 56.5]` выше `MAP_MIN_ZOOM` и не
  клампится; с минимумом 4 — красный. Обновлены ADR-0014 (дополнение, п. 3), `pokatim-app.md`, `routes.md`, §8.2 D8.
- **M2 — fixed.** `route-map.web.tsx`: `failed` ставит только `error` до `load` (стиль, первые тайлы); ошибки тайлов
  после `load` игнорируются, как на native (`onDidFailLoadingMap`). Тест `route-map.web.test.tsx` «ошибка тайла после
  load — карта и кнопки остаются, сообщения нет». Тест ошибки до `load` остался. ADR-0014 (дополнение, п. 7).
- **L1 — fixed.** `map-gestures.ts`: если пан активируется вторым (щипок уже идёт), его смещение в момент активации
  запоминается (`translationBase`), дальше применяется `translation − base`. Тест `route-map-gestures.test.tsx`
  «щипок раньше пана…»: щипок активирован с фокусом, сдвинутым на 6 px, пан — с `translationX: 10`. После активации пана
  `jumpTo` без сдвига фокуса, после обновления — сдвиг только на путь после активации.
- **L2 — fixed.** task.md §12: статус — коммит 08d5932 + фиксы pass 1 поверх.

Проверка: `TURBO_CONCURRENCY=1 pnpm check` (Mongo :27117, Redis :6479/8, Node 24) — EXIT 0. app 132 suites / 1156 tests,
api 105, admin 26, пакеты — зелёные; format, lint, arch, typecheck — чисто. 12 из 13 задач turbo взяты из кеша (их входы не
менялись с прошлого зелёного прогона); тесты app прогнаны полностью.
