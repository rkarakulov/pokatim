# maps-02 — свой трек участника на карте гонки с подсветкой участков вне коридора

Уровень: task3 (контракт, api `results` + `tracks`, движок `packages/tracks`, worker, приложение, ПДн). Ветка
`feature/maps-02-own-track` от `origin/develop`. ADR: 0011 (треки), 0012 (сверка), 0014 (карты). Предыдущий слайс —
[maps-01](../2026-10-27-maps-01-route-corridor/task.md), его §8.2 D1.

## 1. Title

Второй слайс карт: участник видит на карте карточки гонки свой трек поверх маршрута и коридора, участки вне коридора
выделены.

## 2. Goal

Сейчас райдер узнаёт о сходе только цифрами («вне коридора 820 м») и причиной отказа. Ему нужно увидеть, **где** он
сошёл: какой поворот пропустил, где срезал. Карта маршрута с коридором уже есть (maps-01); добавляем поверх неё свой
трек выбранной попытки. Чужие треки не показываются (ПДн, `pokatim-security.md`).

## 3. Scope

### Решение: где считать участки вне коридора (D1 maps-01)

**Считает worker при сверке и сохраняет в попытку**, не чистая функция при чтении.

- Только движок знает, какие шаги трека дали сход (`offCorridor` в `matchCorridor`): точные хорды, недобранный путь
  редкой записи, границы сегмента между воротами. Функция при чтении по упрощённой линии (допуск 5 м) и линии показа
  маршрута (тоже 5 м) — второй источник истины: подсветка расходилась бы с `offCorridorM` попытки, а для причин
  `sparse_recording`/`missed_section` давала бы другое.
- Исходник (сырые точки) есть только в worker; при чтении API — только упрощённая линия `activity_tracks`.
- Результат сверки детерминирован (ADR-0012) — сохранённая разметка не устаревает, пока попытку не перепроверят
  (перепроверка перезаписывает её вместе с вердиктом).

**Как:**

- `matchCorridor` для выбранного сегмента (засчитанный или лучший отказной) отдаёт интервалы схода **по времени
  трека** — `[fromMs, toMs]` для каждого непрерывного выхода (шаг, где `off > 0`, с долями `from`/`to` — как в
  `offCorridor`). Поле не меняет вердикт и метрики; `CORRIDOR_ENGINE_VERSION` не меняется.
- Worker читает **сохранённую** линию показа активности (`activity_tracks`, порт `ActivitySource.trackLine`) и
  передаёт её в `analyzeAttempt` необязательным аргументом (линия в потоке не пересчитывается — §8.2 D1); вершины
  сопоставляются с точками исходника из `loadTrack` последовательно по точному равенству координат. Интервалы
  времени переводятся в **позиции на линии** — дробный индекс `i + t`, `0 ≤ t < 1` (RC-2): момент → путь по
  исходнику (среди точек со временем — бинарный поиск, между соседними — линейно по времени; путь — накопленная
  haversine-длина по всем точкам) → доля пути по отрезку `[i, i+1]` линии. Так же — границы сегмента (выход из
  ворот старта, вход в ворота финиша / конец просмотра). Линии нет, < 2 точек или вершина не найдена — `trackMap:
  null`.
- Из потока наружу — только `trackMap` (позиции и число точек линии), без времени точек и координат.
- Попытка хранит `trackMap: { linePoints, segment: [from, to] | null, offRuns: [from, to][] } | null`
  (позиции округлены до 0,001, `offRuns` — не больше 100: при избытке сливаются ближайшие соседние). `null` — до
  вердикта, провал проверки, `implausible`, нет сегмента (`no_start`), попытки до этого слайса.
- Точность (RC-2): позиция — по пройденному пути, а не по времени вершин; ошибка поперёк ≤ допуска упрощения (5 м,
  при удвоении допуска до 1000 точек — больше), вдоль — несколько метров от несовпадения хорд и отрезков линии;
  стоянки и точки без времени позицию не сдвигают. Подсветка — иллюстрация, итог — `offCorridorM`/`maxExcursionM`
  попытки. Записать в task.md §12 и `pokatim-backend.md`.
- Чтение сверяет `trackMap.linePoints` с числом точек сохранённой линии; не совпало (линия построена другой версией
  упрощения) — разметки нет (`marks: 'unavailable'`), трек показывается.

### API (`results`, порт `tracks`)

- `GET /v1/races/:raceId/entry/attempts/:attemptId/track` — `AuthGuard`, `Cache-Control: no-store`, оба id —
  `Uuid` pipe. Ответ `MyAttemptTrack`: `{ attemptId, line: LonLat[] (≤ 1000), segment: { from, to } | null,
  offRuns: { from, to }[], marks: 'ready' | 'pending' | 'unavailable' }`.
  - `ready` — есть `trackMap` и линия совпала; `pending` — попытка `queued`/`checking`; `unavailable` — остальное
    (провал, `trackMap: null`, несовпадение линии). При `pending`/`unavailable` — `segment: null`, `offRuns: []`.
- Владение проверяет сервер: попытка этой гонки, `userId` = пользователь из access **и** попытка видна ему в «моём
  участии» (тот же фильтр видимости, что `myEntry`: без скрытых автоматических несовпадений и снятых). Иначе — `404
  NOT_FOUND` (один код для «чужая» и «нет такой» — не раскрываем существование).
- Линия — из `activity_tracks` через порт `tracks` (`modules/tracks/index.ts`), с проверкой `userId` активности.
  Линии нет (активность удалена) — `404 NOT_FOUND`.
- В ответе нет `userId`, `activityId`, времени точек, пульса/мощности, координат исходника.
- Логи — без координат.

### contracts / api-client

- Схема `MyAttemptTrack` (+ `TrackMapRun`), `MY_ATTEMPT_TRACK_MAX_POINTS = 1000`; `LonLat` — из maps-01.
- api-client: `getMyAttemptTrack(raceId, attemptId)` (с авторизацией, как `getMyRaceEntry`).

### Приложение (`apps/app`)

- Компонент карты `features/maps/` расширяется **новым необязательным пропсом** `track?: RouteMapTrack`
  (`{ line, segment, offRuns }`), существующие пропсы не меняются (сессия «Маршруты v1» переиспользует компонент).
  С `track` камера охватывает и маршрут, и трек.
- Слои трека (native и web): линия трека — роль `map.track`; части вне сегмента (до старта, после финиша) — тоньше и
  прозрачнее; участки вне коридора — роль `map.offCorridor`, **пунктир и толще** (различимы без цвета). Новые роли
  `map.track`, `map.offCorridor` в `@pokatim/design-tokens` (pokatim-группа `map`) с проверкой контраста к
  `map.background` во всех темах.
- Блок на карточке `races/[id]` (`race-route-map.tsx`): если пользователь вошёл и в «моём участии» есть попытки с
  активностью — показываем трек выбранной попытки: по умолчанию лучшая (`isBest`), иначе новая. Переключатель
  попыток — `Chip`-ы (радиогруппа) с датой заезда и статусом, если попыток больше одной. Запрос
  `useQuery(['races','entry',raceId,'attempts',attemptId,'track'])`, только клиентский, без SSR; ключ под
  `['races','entry',raceId]` — инвалидация участия обновляет трек.
- Текстовая альтернатива под картой (и в подписи a11y карты):
  - засчитано / отказ с сегментом: «Вне коридора N м, самый длинный выход M м» (из `MyAttempt.segment`); сход 0 —
    «Весь сегмент в коридоре»;
  - отказ: основная причина (существующие строки причин) + «Где сход — пунктиром на карте», если `offRuns` не пуст;
  - проверка идёт (`pending`): «Трек проверяется — участки вне коридора появятся после проверки», без подсветки;
    при открытой карточке опрос как у участия (если он есть) — не добавляем свой;
  - `unavailable`: «Разметка участков для этой попытки недоступна».
- Легенда под картой текстом: «Ваш трек», «Вне коридора — пунктир».
- Ошибка запроса трека — карта маршрута остаётся, строка «Не удалось загрузить трек» с повтором.
- i18n — свой блок `races.detail.myTrack.*`.
- Гостю и не заявленному — как в maps-01 (без трека, без лишних запросов).

### Баги карты maps-01 (ручная проверка dev, дополнение оркестратора)

- **B2** (web, ширина 375): компактная атрибуция MapLibre при старте раскрыта (`maplibregl-compact-show`), две строки
  закрывают ~¼ карты и старт. Нужно: свёрнута при старте (кнопка «i» раскрывает, ADR-0014 п. 3 — атрибуция
  доступна); отступ камеры такой, что старт и финиш не уходят под контролы (угол атрибуции). Native — «i» в том же
  углу, без регрессии.
- **B3**: на обзорном зуме коридор (2 × 50 м, прозрачность 0,3) — 2–4 px под осевой, неотличим. Минимальная ширина
  полосы в px (`max(метры → px, минимум)` выражением зума), тест на выражение ширины в `corridor-style.ts`;
  существующие пропсы не меняются.
- **B4**: тёмная тема — атрибуция остаётся светлой плашкой. Контрол — в цветах темы (роли, не hex).

### docs

- `pokatim-security.md` (свой трек — только владельцу, `no-store`), `pokatim-backend.md` (эндпоинт, `trackMap`,
  точность), `pokatim-contracts.md` (`MyAttemptTrack`), `pokatim-db.md` (поле `trackMap` попытки — без координат),
  `pokatim-app.md` (трек на карте, роли), ADR-0012 — абзац о разметке схода (решение D1).

## 4. Out of Scope

- Чужие треки, треки соперников в споре, трек в панели.
- Пересчёт разметки для попыток до этого слайса (бэкфилл) — они получат её при перепроверке; миграции нет.
- Интерактивная карта на весь экран, профиль высот, ползунок по времени, пульс/мощность на карте.
- Нативная dev-сборка и смоук на устройстве (как D2 maps-01).
- Токены карты в app-foundation (follow-up maps-01 RC-5).

## 5. Architecture Context

- packages/tracks: `corridor/match.ts` (интервалы схода выбранного сегмента), новая чистая функция привязки
  интервалов к упрощённой линии, `parse.ts` `analyzeAttempt` → `CorridorMatch & { trackMap }` (или отдельный тип
  результата — решает architect).
- api `results`: `attempt-check.processor.ts` пишет `trackMap` через `recordCheck`; новый метод чтения в
  `ResultsReadService` + маршрут в `RaceEntryController`. `tracks`: метод порта `ActivitySource` (линия активности
  пользователя). Чужие коллекции — только через `index.ts`.
- contracts: новая схема, новый эндпоинт; старые клиенты не затронуты.
- Миграций и индексов нет (поле попытки необязательное, чтение `?? null`; чтение попытки по `_id`, линии по `_id`).
- Очередей и outbox новых нет.

## 5.1 Placement & Reuse Gate

- Reuse: фильтр видимости попыток `myEntry` (не второй), `AuthGuard`/`@CurrentUser`, `Uuid` pipe, `LonLat` из
  `race-route.schema.ts`, компонент карты и слои maps-01 (`corridor-style.ts`), `Chip`, строки причин отказа
  участия, `useMyRaceEntry`/ключи участия, `simplifyTrack` и константы линии из `parse.ts` (не копия).
- Запрещено: расчёт схода при чтении или на клиенте; координаты или время точек в `race_attempts`; чтение
  `activity_tracks` из `results` напрямую; новый SVG-рендер; смена существующих пропсов карты; координаты в логах.

## 6. Relevant Files

- `packages/tracks/src/corridor/match.ts`, `types.ts`, `parse.ts`, `simplify.ts` — движок, поток.
- `apps/api/src/modules/results/attempt-check.processor.ts`, `results.repository.ts`, `results.collection.ts`,
  `results-read.service.ts`, `race-entry.controller.ts`, `results-check.int.test.ts`, `results-read.int.test.ts`.
- `apps/api/src/modules/tracks/activity-source.port.ts`, `activity-source.ts`, `index.ts`.
- `packages/contracts/src/results/results.schema.ts`, `races/race-route.schema.ts`; `packages/api-client/src/*`.
- `packages/design-tokens/src/brand.ts`.
- `apps/app/src/features/maps/*`, `features/races/race-route-map.tsx`, `queries.ts`, `participation/*`.
- `packages/i18n` — `races.detail.myTrack.*`.

## 7. Implementation Notes

- Интервалы схода — в том же проходе, что `offCorridor` (общий код, не копия логики), только для выбранного
  сегмента — не для каждого кандидата старта (стоимость).
- Слияние `offRuns` > 100 — по наименьшему зазору между соседними; соседние/перекрытые — сливаются всегда.
- Подсветка на клиенте: разрезать линию по дробным позициям (чистая функция в `features/maps/` с тестом) → GeoJSON
  `LineString`-ы трека, сегмента и схода.
- Web: слои трека добавляются вместе со слоями маршрута после `load` и при пересоздании по стилю.

## 8. Risks / Assumptions / Open Questions

- R1: линия `activity_tracks` и линия в потоке совпадают, только если упрощение и `loadTrack` не менялись между
  приёмом и проверкой — сверка `linePoints` ловит грубое несовпадение (разные версии), не точечное. Принято: обе
  детерминированы, код общий.
- R2: попытки, проверенные до слайса (в т. ч. засев dev), — без разметки (`unavailable`) до перепроверки.
- R3: ПДн — трек отдаётся только владельцу; ответ `no-store`; кэш query на клиенте очищается при выходе (как
  участие — проверить).
- A1: ответ ≤ 1000 точек ≈ 25–40 КБ — приемлемо.

## 8.1 Requirements Consistency (заполняет architect)

Architecture Review — maps-02-own-track: **CONCERNS** (блокеров нет; RC-1…RC-6 — решения по умолчанию ниже, человек
может переиграть до начала coder). Проверено по коду ветки (`f344e1f`).

- **RC-1 · новое поле в `CorridorMatch` ломает сторожа движка (конфликт с AC «вердикт и метрики не меняются»).**
  `corridor/fixtures.test.ts` AC15 сравнивает полный `CorridorMatch` всех фикстур с `corridor-golden.json` («результат
  изменился — поднять `CORRIDOR_ENGINE_VERSION`»), AC16 — ровно 7 ключей результата. Поле интервалов в `CorridorMatch`
  потребовало бы либо перезаписи эталона без смены версии (сторож теряет смысл), либо подъёма версии (панель покажет
  все попытки «устаревшими», `panelCounts.staleEngine`).
  Альтернативы: (a) `matchCorridor` и `CorridorMatch` не меняются; новая функция серверного входа
  `matchCorridorDetailed(points, corridor, window): { match: CorridorMatch; offRunsMs: [number, number][] }` на том же
  `Engine`, `matchCorridor = matchCorridorDetailed(...).match`; (b) необязательный 4-й параметр `matchCorridor` с
  условным полем — тип результата «плавает», сторожа всё равно надо учить; (c) поле + перезапись эталона.
  **Рекомендация: (a).** Golden и AC16 зелёные без правок; новый тест: `match` из `matchCorridorDetailed` `toEqual`
  `matchCorridor` на всех фикстурах.
- **RC-2 · интерполяция «по времени между вершинами» (§3) неверна для точек без времени и стоянок
  (недоопределённость/вредное решение).** `sanitizePoints` сохраняет точки **без `time`** (участвуют в линии), значит
  вершина упрощённой линии может не иметь времени — «доля по времени» для неё не определена. Стоянка внутри длинного
  отрезка линии (светофор 2 мин посреди прямой 1 км) сдвигает позицию на сотни метров, а `dropConsecutiveDuplicates`
  оставляет у стоянки с одинаковыми координатами время первой точки. Время у исходных точек при этом неубывающее
  (равные — допустимы).
  Альтернативы: (a) **время → дробный индекс исходника → путь**: момент `t` ищется бинарным поиском среди точек
  `points` со временем (равные времена: начало интервала — первая точка с `time ≥ t`, конец — последняя с
  `time ≤ t`), доля между соседними точками со временем — линейно по времени (шаг записи — секунды); затем позиция
  на линии `i + (cum(f) − cum(v_i)) / (cum(v_{i+1}) − cum(v_i))`, `cum` — накопленная haversine-длина по всем
  `points` (с точками без времени), `v_i` — индексы вершин линии в `points` (вершины — те же объекты, проход по
  идентичности за O(n)); нулевая длина отрезка — `t = 0`. Ошибка вдоль — порядка допуска упрощения, а не скорости;
  O(n) в том же потоке. (b) как в §3 — по времени вершин, вершина без времени — по соседям; проще, ошибки стоянок
  остаются. (c) хранить индексы исходника — `activity_tracks` их не знает.
  **Рекомендация: (a)**; формулировку точности в §3 / §12 / `pokatim-backend.md` — «ошибка поперёк ≤ допуска
  упрощения (5 м, при удвоении допуска до 1000 точек — больше), вдоль — несколько метров от несовпадения хорд и
  отрезков линии».
- **RC-3 · как взять интервалы выбранного сегмента без копии логики и без затрат на кандидатов.** `offCorridor`
  вызывается из `scan` для каждого кандидата (и второй раз для частичного просмотра `lastEarlyEntry`); выбранный
  сегмент известен только после цикла. Решение по умолчанию: `Scan` возвращает `endU`; `Evaluated` хранит
  `{ start, endIndex, endU }` просмотра, по которому построен сегмент (для `lastEarlyEntry` — частичный `scan`, для
  `no_finish` — `endIndex = последняя точка, endU = 1`); `offCorridor(start, endIndex, endU, runs?)` — необязательный
  сборщик: при `off > 0` шаг `[k−1, k]` даёт интервал `[t(k−1) + from·Δt, t(k−1) + to·Δt]` (мс, `ProjectedTrack.time`),
  соседние/касающиеся сливаются сразу. После выбора — **один** повторный вызов для выбранного с сборщиком. Повтор
  детерминирован: полные хорды берутся из `chordCache` (точные при первом проходе кэшированы), за лимитом
  `maxChordWork` — та же консервативная оценка (счётчик только растёт), частичные хорды (доли ворот) всегда точные;
  `geometryLimited` уже выставлен. Тест-инвариант: `Math.round(offCorridorM повтора) === segment.offCorridorM`.
  Индексы `ProjectedTrack` ≠ индексам `points` (выкинуты точки без времени и выбросы `noiseTimes`) — поэтому наружу
  из движка только миллисекунды, привязка к линии — отдельной чистой функцией (RC-2). `no_start` — `offRunsMs: []`,
  `segment: null` → `trackMap: null`.
- **RC-4 · «инвалидация участия обновляет трек» — неверно для опроса (недоопределённость, влияет на AC7).** Опрос
  `useMyRaceEntry` — `refetchInterval` своего ключа, `applyEntry` — `setQueryData`: дочерние ключи
  `['races','entry',id,…]` при этом **не** перезапрашиваются (каскад префикса — только у `invalidateQueries`). Трек
  с `marks: 'pending'` остался бы «проверяется» после вердикта. Решение по умолчанию: ключ трека содержит маркер
  ревизии из `MyAttempt` — `['races','entry',raceId,'attempts',attemptId,'track', attempt.status, attempt.checkedAt]`;
  `staleTime` — бесконечно для `ready`/`unavailable` (меняется только с маркером), опроса своего нет. Префикс
  `['races','entry',raceId]` сохраняется (инвалидация участия тоже накрывает).
- **RC-5 · перемонтирование карты при появлении/смене трека.** Web-эффект `route-map.web.tsx` пересоздаёт карту по
  `[map, styleUrl, theme]`, native-камера применяет `initialViewState` один раз (перемонтирование по `key` в
  `race-route-map.tsx`, maps-01). Альтернативы: (a) рамка камеры = объединение рамки маршрута и `boundsOf(track.line)`
  (`@pokatim/tracks`, лёгкий вход); `key` блока — `styleUrl|рамка|attemptId`; web-эффект — зависимость `track`
  (мемоизирован по `query.data`); чтобы карта не монтировалась дважды при первом показе, `race-route-map.tsx` держит
  скелетон, пока запрос трека включён и в `pending` (ошибка трека — карта без трека); смена попытки — новая карта
  (статичный вид, как maps-01 RC-4); (b) обновление на месте: отдельный источник `setData` + `fitBounds({ animate:
  false })` на web, управляемая камера `bounds/padding/duration: 0` на native — меньше мерцания, но новая логика
  камеры без смоука на устройстве (D2). **Рекомендация: (a)** для v1; (b) — follow-up.
- **RC-6 · параллельная сессия «Маршруты v1» (routes-01) расширяет тот же компонент.** routes-01 добавляет карту без
  коридора новым необязательным пропсом и, вероятно, трогает `RouteMapProps.map`/`corridor-style.ts`. Решение: весь
  код трека — **новый файл** `features/maps/track-style.ts` (источник `TRACK_SOURCE_ID`, `trackFeatures`,
  `trackLayers`, `splitTrackLine`, объединение рамок); в `route-map(.web).tsx` — только пропс `track?`, второй
  источник и слои с `beforeId: 'start'` (старт/финиш поверх трека: web — `addLayer(layer, 'start')`, native —
  `<Layer beforeId="start">`, есть в `@maplibre/maplibre-react-native` 11.5 `Layer.d.ts`); `corridor-style.ts` и
  `routeLayers` не меняются. Кто вливается вторым — ребейз на `develop` и тесты обоих (R1 routes-01).
- **RC-7 · статусы попытки, не описанные в §3.** `excluded` (явная, видна в «моём участии», `attemptHidden`) — трек и
  разметка по `trackMap` как у её вердикта (`ready`), строка — как «отказ с сегментом» без причины; `withdrawn` и
  скрытые auto — `404` (фильтр `attemptHidden`, тот же, что `myEntry`); `rejected: implausible` (явная) —
  `trackMap: null` → `unavailable`, строка — причина. `rejected` с сегментом — обе строки: «Вне коридора N м…» и
  причина + «Где сход — пунктиром на карте» (если `offRuns` не пуст). Сход 0 у отказа — «Весь сегмент в коридоре» +
  причина.
- **RC-8 · совместимость клиента.** `marks` — `tolerantEnum` (неизвестное значение клиент трактует как
  `unavailable`); старый API без эндпоинта (`404` — как `myEntry`, R4 race-results-04) и `404` по удалённой активности
  — клиент показывает карту без трека и без строки ошибки (не «Не удалось загрузить трек»); «Не удалось загрузить» —
  только сеть/5xx/429, с повтором (`TextAction`, `refetch`).
- **RC-9 · переключатель — «радиогруппа».** `Chip` базы даёт только `selected` (`aria-selected`/`aria-pressed`), роли
  `radio` нет. Решение: контейнер `accessibilityRole="radiogroup"` с подписью, `Chip` как есть; роль `radio` у `Chip` —
  задача в app-foundation (не копия компонента). Подпись чипа — дата заезда (`formatMinskDateTime`, после
  монтирования) + статус (`races.attempt.status.*`). Выбранная попытка — локальный `useState(attemptId)`; исчезла из
  списка (снята) — снова по умолчанию (лучшая, иначе `attempts[0]` — сервер отдаёт новые сверху).
- **RC-10 · текст при отсутствии карты.** Карта схлопнута (env не задан, нет нативного модуля, маршрут 404) —
  блока трека нет, как maps-01 (`races.detail.myTrack.*` — подпись под картой); причина отказа и время остаются в
  «Вашем участии». Трек без коридора гонки не запрашивается (карта появляется только при `race.corridor`).
- **RC-11 · пустая линия.** `simplifyTrack` даёт `[]` для вырожденного трека, а `activity_tracks` тогда не пишется
  (`track-processing.processor.ts`: линия только из ≥ 2 точек). В потоке: линия < 2 точек — `trackMap: null`; в API:
  документа линии нет — `404` (как «активность удалена»).

Остальное согласовано: результат сверки детерминирован (ADR-0012) — сохранённая разметка валидна до перепроверки;
выход очищает кэш query (`queryClient.clear()` в `app/_layout.tsx` и `use-sign-out.ts`) — R3 закрыт; новых очередей,
outbox и индексов не нужно (попытка — по `_id`, линия — по `_id` + `userId`).

## 8.2 Deviations from spec

- **D1 (согласовано оркестратором, вариант A).** §3/§11: `analyzeAttempt` строит упрощённую линию сам
  (`simplifyTrack(points, 5, 1000)`). Замер на AC14 бенча движка («стоянка у края коридора», 190 000 точек
  дрожания ±3 м): `matchCorridor` 155 мс, `matchCorridorDetailed` 148 мс, `trackMapOf` 20 мс, **`simplifyTrack`
  71 473 мс** — Дуглас — Пекер на дрожании O(n²), бюджет AC14 ≤ 8 с красный. Решение: worker читает сохранённую
  линию `activity_tracks` через порт `ActivitySource.trackLine` и передаёт её в `analyzeAttempt` необязательным
  6-м аргументом (по умолчанию `null` → `trackMap: null`); вершины сопоставляются с точками исходника
  последовательно по точному равенству координат; не найдено / нет линии / < 2 точек — `trackMap: null`. Проверка
  `linePoints` при чтении оставлена. R1 (рассинхрон версий упрощения) снимается — позиции считаются по хранимой
  линии. **Follow-up:** O(n²) `simplifyTrack` на дрожании — риск таймаута приёма (`analyzeTrack`, 30 с) на
  длинных стоянках.
- **D2.** RC-3/§11 TESTS называют `sparse-30s` фикстурой с `sparse_recording`; по эталону она засчитана без схода.
  В тестах интервалов — `sparse-winding-30s` (причина `sparse_recording`).
- **D3.** Инвариант RC-3 «`Math.round(offCorridorM повтора) === segment.offCorridorM`» отдельным тестом не
  проверяется (метрики повторного прохода наружу не выходят); покрыто равенством `match` = `matchCorridor` на всех
  фикстурах и синтетикой с точным интервалом схода (`match.test.ts`).
- **D4.** `matchCorridor` — не буквально `matchCorridorDetailed(...).match`, а общая внутренняя `matchWith(…,
  detailed)`: без лишнего прохода для вызовов без интервалов; эквивалентность — тестом на всех фикстурах.
- **D5.** `RaceAttemptDoc.trackMap` — необязательное поле типа (`trackMap?: … | null`): документы до maps-02 его не
  имеют, чтение `?? null`; новые попытки пишут `null`. Тесты, вставляющие документ попытки напрямую, не правились.
- **D6.** Int-тесты эндпоинта — отдельный файл `results-my-track.int.test.ts` (нужны хранилище треков и worker), а
  не `results-read.int.test.ts`.
- **D7 (дополнение оркестратора B2–B4).** AC9 «тесты maps-01 без правок» конфликтует с правкой стиля maps-01: тест
  ширины коридора в `corridor-style.test.ts` переписан под новое выражение (минимум — опорой зума), в
  `route-map.web.test.tsx` ожидание `padding: MAP_PADDING` → `MAP_FIT_PADDING`. Пропсы компонента не менялись.
- **D8.** RC-7 `excluded`: строка схода без причины и без «Где сход — пунктиром» (подсказка привязана к причине
  отказа). Чип попытки до монтирования часов — только статус (дата — после `now`).

## 8.3 Security checklist

- AuthN/AuthZ: `AuthGuard`; владение — сервер (`userId` попытки и активности = пользователь); чужая и
  несуществующая — один `404`.
- Входные данные: `raceId`, `attemptId` — `Uuid` pipe.
- Данные наружу: линия своей активности, позиции разметки, `marks`; без id активности, времени, датчиков.
- Кэш: `no-store`; на клиенте — не в SSR.
- Логи: без координат.
- Аудит: не требуется (владелец читает своё).

## 9. Acceptance Criteria

1. Сверка попытки со сходом пишет `trackMap` с `offRuns`, попадающими на шаги вне коридора (unit-тест движка на
   фикстуре с известным выходом; int-тест worker: поле записано, без координат и времени).
2. Засчитанная попытка без схода — `offRuns: []`, `segment` задан; `no_start` — `trackMap: null`.
3. `GET …/attempts/:attemptId/track` владельца — 200, `no-store`, ключи ответа ровно `attemptId, line, segment,
   offRuns, marks`; чужая, скрытая, снятая, другой гонки, неизвестная — 404 `NOT_FOUND`; без входа — 401;
   невалидный id — 400.
4. `queued`/`checking` — `marks: 'pending'`; провал или попытка без `trackMap` — `'unavailable'`; несовпадение
   `linePoints` — `'unavailable'`.
5. Карточка гонки участника с попыткой показывает трек; участки вне коридора — другим цветом и пунктиром; текстовая
   строка «Вне коридора N м, самый длинный выход M м»; подпись a11y карты включает её.
6. Несколько попыток — переключатель, по умолчанию лучшая; смена попытки меняет трек и строку.
7. Проверка идёт — трек без подсветки и строка «проверяется»; отказ — причина + «Где сход — пунктиром».
8. Гость / не заявлен — запроса трека нет, карта как в maps-01; ошибка трека — карта маршрута остаётся, повтор.
9. Существующие пропсы компонента карты не изменены (тесты maps-01 зелёные без правок).
10. `TURBO_CONCURRENCY=1 pnpm check` зелёный.

## 10. Documentation Impact

См. §3 docs.

Дополнение architect: точность разметки в `pokatim-backend.md` и §12 — по RC-2 (а не «десятки метров вдоль»);
`pokatim-app.md` — `track-style.ts`, ключ трека с маркером ревизии (RC-4), перемонтирование по смене попытки (RC-5);
`pokatim-db.md` — `race_attempts.trackMap` (позиции, без координат/времени; `null` при перепостановке; `?? null`);
`pokatim-tests.md` — сторож golden движка не меняется при новых выходах `matchCorridorDetailed` (RC-1).

## 11. Implementation Context (заполняет architect)

**ENTRY POINTS**

- Worker: `AttemptCheckProcessor.evaluate` (`apps/api/src/modules/results/attempt-check.processor.ts`) →
  `runParseThread<AttemptAnalysis>('analyzeAttempt', …)` (имя функции в `PARSE_FUNCTIONS` не меняется) →
  `analyzeAttempt` (`packages/tracks/src/parse.ts`) → `matchCorridorDetailed` + `trackMapOf`.
- HTTP: `GET /v1/races/:raceId/entry/attempts/:attemptId/track` — новый метод `RaceEntryController`
  (`race-entry.controller.ts`, уже `@UseGuards(AuthGuard)`; `@Header('Cache-Control', 'no-store')`, оба `@Param` —
  `raceIdPipe` = `ZodValidationPipe(Uuid, FieldErrorCode)`) → `ResultsReadService.myAttemptTrack(userId, raceId,
  attemptId)`.
- App: `RaceRouteMap` (`apps/app/src/features/races/race-route-map.tsx`), вызывается из `race-detail.tsx:133` —
  передать `entry` (уже есть в `RaceDetailView`) и `signedIn` новыми необязательными пропсами.

**FILES TO MODIFY**

- `packages/tracks/src/corridor/match.ts` — `Scan.endU`; `Evaluated.{start,endIndex,endU}`; сборщик интервалов в
  `offCorridor(…, runs?)`; `Engine.offRunsOf(evaluated)`; экспорт `matchCorridorDetailed`; `matchCorridor` — обёртка
  (RC-1, RC-3). Логика метрик не меняется.
- `packages/tracks/src/parse.ts` — `analyzeAttempt` возвращает `AttemptAnalysis` (`CorridorMatch & { trackMap }`):
  `loadTrack` → `matchCorridorDetailed(points, …)` → `simplifyTrack(points, LINE_TOLERANCE_M, LINE_MAX_POINTS)`
  (те же константы, что `analyzeTrack`; копий нет) → `trackMapOf(points, line, segment, offRunsMs)`; экспорт типов
  `AttemptAnalysis`, `TrackMap`, функций `matchCorridorDetailed`, `trackMapOf` — только из серверного входа.
- `packages/tracks/src/parse.test.ts` — список «движок только в серверном входе» + `matchCorridorDetailed`,
  `trackMapOf`; тест `analyzeAttempt` — `trackMap` (структура, structured clone, нет координат/времени).
- `apps/api/src/modules/results/results.collection.ts` — `AttemptTrackMapDoc { linePoints: number; segment: [number,
  number] | null; offRuns: [number, number][] }`; `RaceAttemptDoc.trackMap: AttemptTrackMapDoc | null` (комментарий:
  позиции на линии `activity_tracks`, без координат и времени; документы до maps-02 поля не имеют — чтение `?? null`).
- `apps/api/src/modules/results/results.repository.ts` — `CheckResult` + `'trackMap'`; `requeueAttempt` `$set
  trackMap: null` (перепостановка/перепроверка стирает разметку вместе с вердиктом); `recordCheck` без изменений
  (пишет `...result`); `failAttempt` не трогает (на `queued/checking` поле уже `null`).
- `apps/api/src/modules/results/attempt-intake.ts` — новая попытка `trackMap: null`.
- `apps/api/src/modules/results/attempt-check.processor.ts` — `emptyResult` `trackMap: null` (провалы, `withdrawn`,
  `implausible`); успешная ветка `trackMap: match.trackMap`; тип `analyze(): ThreadOutcome<AttemptAnalysis>`; лог —
  без изменений (без координат).
- `apps/api/src/modules/results/results-read.service.ts` — `myAttemptTrack`: `this.race(raceId)` (черновик/неизвестная
  — 404) → `repository.findAttempt(attemptId)` → `attempt.raceId === raceId && attempt.userId === userId &&
  !attemptHidden(attempt)` иначе `notFound()` → `activities.trackLine(userId, attempt.activityId)` (`null` → 404) →
  `marks`: `queued|checking` → `pending`; `trackMap ?? null` есть и `linePoints === line.length` → `ready`; иначе
  `unavailable` (`segment: null, offRuns: []`). Ответ собирается явно по полям (не spread документа).
- `apps/api/src/modules/results/race-entry.controller.ts` — маршрут `@Get(':raceId/entry/attempts/:attemptId/track')`.
- `apps/api/src/modules/tracks/activity-source.port.ts` + `activity-source.ts` — `trackLine(userId, activityId):
  Promise<[number, number][] | null>` («своя линия показа; чужая и неизвестная — `null`»).
- `apps/api/src/modules/tracks/tracks.repository.ts` — `ownTrackLine(userId, id)`: `findOne({ _id: id, userId },
  { projection: { line: 1 } })` (поле `userId` есть в `ActivityTrackDoc`, один запрос по `_id`).
- `apps/api/src/modules/tracks/index.ts` — экспорт не меняется (тип порта уже экспортирован).
- `packages/contracts/src/results/results.schema.ts` — `MY_ATTEMPT_TRACK_MAX_POINTS = 1000`,
  `MY_ATTEMPT_TRACK_MAX_RUNS = 100`, `TrackMapRun = z.object({ from: z.number().min(0), to: z.number().min(0) })`,
  `ATTEMPT_TRACK_MARKS = ['ready','pending','unavailable']`, `MyAttemptTrack = z.object({ attemptId: Uuid, line:
  z.array(LonLat).min(2).max(1000), segment: TrackMapRun.nullable(), offRuns: z.array(TrackMapRun).max(100), marks:
  tolerantEnum(ATTEMPT_TRACK_MARKS) })`; `LonLat` — импорт из `../races/race-route.schema`. `index.ts` контрактов —
  экспорт, если не через `export *`.
- `packages/api-client/src/index.ts` — `getMyAttemptTrack(accessToken, raceId, attemptId)` по образцу `getMyRaceEntry`
  (`request` + `authorized(... withCredentials)`, `encodeURIComponent` обоих id).
- `packages/design-tokens/src/brand.ts` — `PokatimRoleGroups.map.track`, `map.offCorridor`; light: `orange600` /
  `red700`, dark: `orange400` / `red400` (≥ 3:1 к `map.background` — проверит тест; `panel` = light).
- `packages/design-tokens/src/contrast.ts` — пары `map.track / map.background`, `map.offCorridor / map.background`
  (`WCAG.ui`); `design-tokens.test.ts` — `arrayContaining` + новые имена.
- `apps/app/src/features/maps/route-map-props.ts` — `track?: RouteMapTrack` (`Pick<MyAttemptTrack, 'line' |
  'segment' | 'offRuns'>`), остальные пропсы без изменений.
- `apps/app/src/features/maps/route-map.tsx` — при `track`: второй `GeoJSONSource id={TRACK_SOURCE_ID}`, слои с
  `beforeId="start"`, `Camera initialViewState.bounds` = объединённая рамка.
- `apps/app/src/features/maps/route-map.web.tsx` — в `load`: источник трека и `addLayer(layer, 'start')`; `bounds`
  карты — объединённая рамка; зависимость эффекта `track`.
- `apps/app/src/features/races/queries.ts` — `myAttemptTrackKey(raceId, attemptId, status, checkedAt)` под
  `raceEntryKey`; `useMyAttemptTrack(raceId, attempt | null, enabled)` (`withAccessToken`, 404 → `null`, RC-4/RC-8).
- `apps/app/src/features/races/race-route-map.tsx` — выбор попытки, запрос трека, `track` в `RouteMap`, `key` с
  `attemptId` и рамкой, скелетон на время первого запроса трека (RC-5), легенда, строки, ошибка с повтором, `Chip`-и.
- `apps/app/src/features/races/race-detail.tsx` — передать `entry`, `signedIn` в `RaceRouteMap`.
- `packages/i18n/src/ru.ts` — `races.detail.myTrack.*` (легенда «Ваш трек», «Вне коридора — пунктир»; «Вне коридора
  {off} м, самый длинный выход {max} м»; «Весь сегмент в коридоре»; «Где сход — пунктиром на карте»; «Трек
  проверяется — участки вне коридора появятся после проверки»; «Разметка участков для этой попытки недоступна»;
  «Не удалось загрузить трек»; «Повторить»; подпись группы чипов; дополнение a11y-подписи карты).

**FILES TO CREATE**

- `packages/tracks/src/corridor/track-map.ts` (+ `track-map.test.ts`) — чистая `trackMapOf(points, line, segment,
  offRunsMs): TrackMap | null`: RC-2 (время → дробный индекс исходника → позиция на линии), обрезка интервалов
  границами сегмента, округление до 0,001, слияние соседних/перекрытых всегда, при > 100 — пары с наименьшим зазором;
  `null` при `segment === null` или линии < 2 точек. Без координат и времени в результате.
- `apps/app/src/features/maps/track-style.ts` (+ `track-style.test.ts`) — `TRACK_SOURCE_ID`; `splitTrackLine(line,
  segment, offRuns)` → линии «вне сегмента» (до старта, после финиша), «сегмент», «сход» (интерполяция координат в
  дробной позиции; позиции зажимаются в `[0, line.length − 1]`, `from > to` и пустые — отбрасываются);
  `trackFeatures`, `trackLayers(theme)` (вне сегмента — `stroke` тоньше и `line-opacity` как `CORRIDOR_OPACITY`
  или своя константа с комментарием; сегмент — `map.track`; сход — `map.offCorridor`, `line-dasharray`, толще);
  `unionBounds(route.bounds, boundsOf(track.line))`.
- `apps/app/src/features/races/my-track-format.ts` (+ тест) — выбор попытки по умолчанию, текст строки по
  `MyAttempt` + `marks` (RC-7), a11y-подпись.

**FILES TO READ**

- `packages/tracks/src/corridor/{match,project,types,policy}.ts`, `simplify.ts`, `points.ts`, `geo.ts` (`boundsOf`),
  `corridor/fixtures.test.ts` (AC15/AC16), `corridor/bench.test.ts`, `__fixtures__/corridor/corridor-expected.json`.
- `apps/api/src/parse-thread.ts`, `parse-thread.test.ts`; `apps/api/src/modules/results/results.policy.ts`
  (`attemptHidden`, `verdictFields`); `test/results.ts` (хелперы int-тестов).
- `apps/app/src/features/maps/*` (maps-01), `features/races/participation-format.ts` (`attemptView`, `needsPolling`),
  `participation/attempt-list.tsx`, `features/races/disputes/dispute-form.tsx` (образец группы `Chip`).
- `.claude/rules/{pokatim-backend,pokatim-db,pokatim-contracts,pokatim-security,pokatim-app,pokatim-tests}.md`.

**TYPES & SCHEMAS**

- `TrackMap` (tracks) = `AttemptTrackMapDoc` (api) = `{ linePoints: number; segment: [number, number] | null;
  offRuns: [number, number][] }` — позиции `i + t`, `0 ≤ … ≤ linePoints − 1`, кратны 0,001, `offRuns` ≤ 100,
  по возрастанию, внутри `segment`. В `trackMap` у попытки с сегментом `segment` всегда задан (тип допускает `null`
  только ради общей формы; при `segment === null` весь `trackMap: null`).
- `AttemptAnalysis = CorridorMatch & { trackMap: TrackMap | null }` — совместим с `ThreadOutcome<CorridorMatch>` в
  `parse-thread.test.ts` и `bench.test.ts` (правки не нужны).
- Контракт `MyAttemptTrack` — см. выше; кортежи БД → объекты `{ from, to }` наружу.
- Порт: `ActivitySource.trackLine`.

**TESTS**

- Unit `packages/tracks`: `match.test.ts`/`fixtures.test.ts` — `matchCorridorDetailed(...).match` = `matchCorridor`
  на всех фикстурах; `offRunsMs` пусты у `clean`, не пусты у `shortcut-800`/`wobble-3pct`/`outback-turn-7km` и лежат
  внутри `[startedAt, finishedAt]`; сумма длин шагов в интервалах ≈ `offCorridorM` (инвариант RC-3);
  `sparse-30s` (причина `sparse_recording`) — интервалы есть; `mid-start` (`no_start`) — `[]`. `track-map.test.ts` —
  синтетика: вершина без времени, стоянка внутри отрезка, равные времена, интервал на границе вершины, слияние
  > 100, обрезка сегментом, линия < 2 → `null`, округление. `parse.test.ts` — `analyzeAttempt` возвращает
  `trackMap` с `linePoints === analyzeTrack(...).line.length` для того же файла. Golden и AC16 — без правок.
- Int (реальная Mongo, `results-check.int.test.ts`): `wobble-3pct` — `trackMap.offRuns` не пуст, ключи
  `trackMap` ровно три, в документе нет координат/времени точек; `clean` — `offRuns: []`, `segment` задан; `mid-start`
  — `trackMap: null`; провал (таймаут, `implausible`, `storage`) — `null`; перепостановка (`requeueStuck`/перепроверка)
  — `null` до нового вердикта. `results-read.int.test.ts`: эндпоинт — 200 + `no-store` + ключи ровно `attemptId,
  line, segment, offRuns, marks`; `linePoints` ≠ числу точек линии → `unavailable`; `queued` → `pending`; попытка без
  поля (до слайса, `$unset`) → `unavailable`; чужая, скрытая auto, снятая, другой гонки, неизвестная, линия
  удалена — `404 NOT_FOUND` одним телом; без входа — 401; невалидный id (оба) — 400. `activity-source.int.test.ts` —
  `trackLine` своей / чужой / неизвестной.
- Contracts: `results.schema.test.ts` — `MyAttemptTrack` (пределы 1000/100, неизвестный `marks` терпится);
  api-client `results.test.ts` — путь, Bearer, валидация ответа.
- Design-tokens: контраст новых пар во всех темах.
- App (jest): `track-style.test.ts` (разрез линии, слои, рамка); `route-map.web.test.tsx` — без `track` поведение и
  слои maps-01 не меняются (AC9), с `track` — источник и слои трека перед `start`; `my-track-format.test.ts`;
  тест `race-route-map`/карточки: гость и не заявлен — запроса трека нет (AC8), лучшая по умолчанию, переключение,
  `pending`/`unavailable`/ошибка с повтором, a11y-подпись содержит строку. Тесты maps-01 — без правок.
- Итог: `TURBO_CONCURRENCY=1 pnpm check`.

**OUT OF SCOPE**

- Изменение `CORRIDOR_ENGINE_VERSION`, метрик и вердикта; бэкфилл/миграция старых попыток; новые очереди и outbox.
- Обновление трека на карте без перемонтирования (RC-5 b), роль `radio` у `Chip` (app-foundation), токены карты в
  app-foundation; карта в панели; чужие треки; нативный смоук.

## 12. Outcome (заполняет coder)

**Сделано.**

- Движок (`packages/tracks`): `matchCorridorDetailed` — интервалы схода выбранного сегмента по времени трека (сборщик
  в `offCorridor`, один повторный проход; golden и `CORRIDOR_ENGINE_VERSION` без изменений); `trackMapOf`
  (`corridor/track-map.ts`) — RC-2: время → путь по исходнику → позиция на сохранённой линии, обрезка сегментом,
  округление 0,001, слияние соседних, ≤ 100 по наименьшему зазору; `analyzeAttempt(…, line)` → `AttemptAnalysis`.
- API: worker пишет `trackMap` с вердиктом (линия — порт `trackLine`), провалы/перепостановка — `null`;
  `GET /v1/races/:raceId/entry/attempts/:attemptId/track` (`AuthGuard`, `no-store`, `Uuid`, один 404, `marks`).
- Контракты/клиент/токены: `MyAttemptTrack`, `TrackMapRun`, `getMyAttemptTrack`; роли `map.track`
  (`orange600`/`orange400`), `map.offCorridor` (`red700`/`red400`) с контрастом ≥ 3:1 к `map.background`.
- Приложение: `track-style.ts`, пропс `track?` у `RouteMap` (native и web, слои под `start`, рамка — объединение),
  `race-route-map.tsx` — выбор попытки чипами, легенда, строки (`my-track-format.ts`), подпись a11y, ошибка с
  повтором, ключ с маркером ревизии; i18n `races.detail.myTrack.*`.
- Баги maps-01: B2 — атрибуция web свёрнута при старте и после обновлений стиля (`attribution.web.ts`), камера
  `MAP_FIT_PADDING` (снизу место под «i»), native «i» — в нижнем правом углу; B3 — `CORRIDOR_MIN_WIDTH_PX` (12 px)
  опорой выражения зума; B4 — атрибуция web в ролях темы (`data-route-map`), native — `tintColor`.
- Документация: `pokatim-{backend,security,contracts,db,app,tests}.md`, ADR-0012 «Разметка схода».

**Точность разметки** (RC-2): позиция — по пройденному пути; поперёк ≤ допуска упрощения (5 м, больше при удвоении
допуска до 1000 точек), вдоль — метры (хорды ≠ отрезки линии); стоянки и точки без времени позицию не сдвигают.
Подсветка — иллюстрация, итог — `offCorridorM`/`maxExcursionM`.

**Тесты.** tracks: `fixtures.test.ts` (match = matchCorridor на всех фикстурах, интервалы shortcut-800 / wobble-3pct
/ outback-turn-7km / sparse-winding-30s, clean и mid-start — `[]`), `match.test.ts` (точный интервал ответвления),
`track-map.test.ts` (9), `parse.test.ts` (`trackMap` на линии `analyzeTrack`, без линии — `null`). API:
`results-check.int.test.ts` (4: разметка wobble/clean/mid-start, перепостановка и провалы — `null`, нет линии),
`results-my-track.int.test.ts` (4: 200/ключи/no-store, pending/unavailable, 404 одним телом, 401/400),
`activity-source.int.test.ts` (`trackLine`). Contracts/api-client/design-tokens — схема, клиент, контраст. App:
`track-style.test.ts`, `my-track-format.test.ts`, `attribution.web.test.ts`, `race-my-track.test.tsx` (7),
`route-map.web.test.tsx` (+3), `corridor-style.test.ts` (B3).

**Проверки.** `MONGO_URL_TEST=…pokatim_maps02_test… REDIS_URL_TEST=…/13 TURBO_CONCURRENCY=1 pnpm check` → exit 0:
format ✓, eslint ✓, depcruise «no dependency violations found (1028 modules)», typecheck ✓, `Tasks: 13 successful,
13 total`; тесты: tracks 230, contracts 228, design-tokens 120, api-client 77, api 971, admin 223, app 948 — все
passed. Флейк ui-kit (витрина, таймаут под нагрузкой) — один раз в промежуточном прогоне app-jest, отдельно — 2/2
passed; в финальном прогоне не проявился.

**NOT VERIFIED.** Ручная проверка в браузере (ширина 375, тёмная тема) и на устройстве/симуляторе (native, D2
maps-01) — не делалась; поведение атрибуции MapLibre проверено по исходнику `maplibre-gl` 6.16 и jsdom-тестом.
