# Findings — maps-02-own-track — pass 1 — reviewer: claude
base: origin/develop   commits: bcbb85e..cc48cc0 (working tree clean)
verdict: APPROVE

## Pass 1

Проверено: diff `origin/develop...HEAD` целиком (51 файл), вызовы вне diff (`results.policy.ts` `attemptHidden`,
`ResultsReadService.myEntry`, `requeueAttempt`/`recordCheck`, `loadTrack`/`analyzeTrack`/`track-processing`
запись линии, `chordOutside`/`chordCache`, `query-client.ts`, типы `@maplibre/maplibre-react-native` `Map.d.ts`/
`Layer.d.ts`). Запущено: `packages/tracks` vitest `src/corridor src/parse.test.ts` — 134 passed;
`apps/app` jest `features/maps`, `my-track-format.test.ts`, `race-my-track.test.tsx` — 35 passed. Полный
`pnpm check` и int-тесты API — NOT VERIFIED мной (нужны Mongo/Redis), опираюсь на отчёт §12 и чтение тестов.

Измерения без замечаний:
- **Безопасность / ПДн / владение.** `myAttemptTrack`: `race()` (черновик/неизвестная — 404) → `attempt.raceId ===
  raceId && attempt.userId === userId && !attemptHidden` → `trackLine(userId, activityId)` с `userId` в фильтре
  (`findOne({ _id, userId })`). Тот же `attemptHidden`, что в `myEntry` (снятые, скрытые auto, implausible auto).
  Один `notFound()` на все ветки, int-тест сверяет одинаковое тело (чужая/неизвестная/другая гонка/скрытая/снятая/
  линия удалена). `AuthGuard` на контроллере, `no-store`, оба id — `raceIdPipe` (Uuid). Ответ собран по полям, без
  `activityId`/`userId`/времени. Логи не тронуты. Кэш клиента — только CSR, `queryClient.clear()` при выходе.
  Спредов `RaceAttemptDoc` в ответы (панель, споры) нет — `trackMap` наружу не утекает.
- **Движок.** `matchWith`: `match` собирается до `offRunsOf`, поэтому `geometryLimited`/метрики не зависят от
  повторного прохода; `bestCounted` хранит `Evaluated` — выбор тот же. Повтор `offCorridor` детерминирован:
  полные хорды — из `chordCache` (точные кэшируются), оценка за лимитом не кэшируется и при повторе снова оценка
  (счётчик только растёт), доли ворот — точно; значит шаги со `off > 0` совпадают с первым проходом. `span` для
  `lastEarlyEntry` — частичный `scan` (`partialEnd` → `endU`), для `no_finish` — `endU = 1`. Golden,
  `policy.ts`/`CORRIDOR_ENGINE_VERSION` не менялись; тест `match = matchCorridor` на всех фикстурах.
- **`trackMapOf`.** Бинарный поиск: границы `lo = 0`/`lo = n` исключены ранними возвратами; равные времена —
  start: первая, end: последняя; `vertexCum` неубывающий (поиск вершин только вперёд); отрезок нулевой длины — `lo`.
  Линия в `activity_tracks` — те же `points` из `loadTrack` без округления, сопоставление по точному равенству
  корректно. Обрезка сегментом, слияние, `limitRuns` проверены тестами.
- **Сброс `trackMap`.** `requeueAttempt` (перепроверка и `requeue` зависших) — `trackMap: null`; новая попытка —
  `null`; `emptyResult` (провалы, implausible, withdrawn) — `null`; `failAttempt` на `queued/checking` — поле уже
  `null`. Идемпотентность BullMQ — запись в `recordCheck` своей ревизией, без изменений.
- **Кэш трека (RC-4).** Ключ `[...raceEntryKey, 'attempts', id, 'track', status, checkedAt]`: смена статуса/
  `checkedAt` после опроса `setQueryData` даёт новый ключ → перезапрос; 404 → `null` без ретраев.
- **Пропсы карты.** `RouteMapProps` — только `track?`; без `track` web/native ведут себя как раньше (кроме
  B2-отступа — D7). `attributionPosition`, `tintColor`, `Layer.beforeId` есть в типах maplibre-react-native 11.
- **B3.** Выражение ширины: на `[zMin, 22]` `exponential 2` от `min` до `metric(22)` даёт ровно `min·2^(z−zMin)` =
  метрическая ширина; опоры строго возрастают; крайние случаи `zMin ≤ 0`/`≥ 22` обработаны.
- **Миграции/индексы/очереди** — нет (поле необязательное, чтение `?? null`, запросы по `_id`). **Contracts-first** —
  новая схема и эндпоинт, `marks` — `tolerantEnum`. **i18n** — блок `races.detail.myTrack.*`. **Дизайн-система** —
  роли `map.track`/`map.offCorridor` с контрастом, `Chip`/`TextAction`/`SkeletonGroup`, CSS атрибуции из ролей.
  **Платформы** — native и web, развилка `.web.ts`. **Documentation Sync** — все пункты §3 docs и §10 есть в diff.

### [MEDIUM] Смена попытки чипом убирает весь блок вместе с чипами (потеря фокуса, скачок раскладки)
- **file:** apps/app/src/features/races/race-route-map.tsx
- **location:** `if (!map || styleUrl === null || trackQuery.isLoading) return <SkeletonGroup>…`
- **problem:** скелетон по `trackQuery.isLoading` ставится не только на первый показ (RC-5), но и при каждом новом
  ключе трека — нажатие чипа другой попытки (и каждая смена `status`/`checkedAt` во время опроса) заменяет карту,
  легенду, строки **и группу чипов** скелетоном. При сетевой ошибке скелетон держится всё время ретраев
  (`shouldRetry`), хотя карта маршрута готова.
- **why_it_matters:** нажатый чип исчезает из дерева — фокус клавиатуры/скринридера (web, VoiceOver/TalkBack)
  теряется, выбор нельзя подтвердить; блок схлопывается и снова раскрывается (скачок раскладки). §4.12 — данные
  (карта маршрута) прячутся на время загрузки зависимого запроса.
- **evidence:** `const trackQuery = useMyAttemptTrack(race.id, attempt, …)`; ключ содержит `attempt.id, status,
  checkedAt`; ветка скелетона возвращается до рендера `my-track-attempts`.
- **recommended_fix:** скелетон — только пока трека ещё не было (например, `isLoading && !hasShownOnce` или
  `placeholderData: keepPreviousData` с `key` карты по данным); группу чипов рендерить вне ветки скелетона
  (под местом карты), чтобы выбранный чип оставался в дереве.

### [LOW] Нет теста перезапроса трека после вердикта (RC-4)
- **file:** apps/app/src/__tests__/race-my-track.test.tsx
- **location:** кейс «проверка идёт — трек без подсветки и «проверяется» (AC7)»
- **problem:** проверяется только состояние `pending`; переход `queued → counted/rejected` через обновление
  участия (новый `status`/`checkedAt` в ключе) и последующий запрос с `marks: 'ready'` не покрыт.
- **why_it_matters:** это ровно сбой, ради которого RC-4 ввёл маркер ревизии в ключ; регрессия ключа (например,
  удаление `checkedAt`) пройдёт тесты незамеченной.
- **evidence:** нет `setQueryData(raceEntryKey…)`/повторного ответа `getMyRaceEntry` с новым статусом в тесте.
- **recommended_fix:** тест: участие с `queued` → трек `pending`; обновить кеш участия на `rejected` с `checkedAt`
  → ожидать второй вызов `getMyAttemptTrack` и строку «Где сход — пунктиром».

### [LOW] Легенда «Вне коридора — пунктир» показывается, когда пунктира нет
- **file:** apps/app/src/features/races/race-route-map.tsx
- **location:** `{track ? <Text>{legendTrack · legendOff}</Text> : null}`
- **problem:** легенда схода выводится при `marks: 'pending' | 'unavailable'` и при `offRuns: []`.
- **why_it_matters:** текстовая альтернатива противоречит строке «Трек проверяется — участки … появятся после
  проверки» / «Весь сегмент в коридоре».
- **evidence:** условие зависит только от `track`.
- **recommended_fix:** вторую часть легенды — только при `marks === 'ready' && offRuns.length > 0`.

### [LOW] JSDoc `trackLines` съехал на новый метод
- **file:** apps/api/src/modules/tracks/tracks.repository.ts
- **location:** перед `ownTrackLine` / `trackLines`
- **problem:** новый метод вставлен между JSDoc «Линии показа активностей по id…» и `trackLines`: у `ownTrackLine`
  два блока комментариев, у `trackLines` — ни одного.
- **why_it_matters:** вводит в заблуждение при чтении порта.
- **evidence:** diff `@@ -270,6 +270,12 @@` — `/** Линии показа активностей по id … */` над `/** Линия показа
  своей активности … */ async ownTrackLine`.
- **recommended_fix:** перенести `ownTrackLine` выше старого комментария (или ниже `trackLines`).

### [LOW] AC9 «тесты maps-01 без правок» формально нарушен (D7)
- **file:** apps/app/src/features/maps/corridor-style.test.ts, apps/app/src/features/maps/route-map.web.test.tsx
- **location:** тест ширины коридора; ожидание `padding`
- **problem:** правки тестов maps-01 из-за B2/B3 (принято оркестратором, записано в §8.2 D7).
- **why_it_matters:** только трассировка acceptance — существующие пропсы при этом действительно не менялись.
- **evidence:** task.md §8.2 D7.
- **recommended_fix:** ничего в коде; при закрытии задачи отметить AC9 как выполненный с отклонением D7.

**Итог pass 1:** CRITICAL — 0, HIGH — 0, MEDIUM — 1, LOW — 4. APPROVE.

## Fix после pass 1 (оркестратор)

- MEDIUM скелетон — исправлено: скелетон только на месте карты и только до первого ответа/первой ошибки
  (`failureCount === 0`); чипы, строки и ошибка остаются смонтированными. Тест AC6 проверяет чипы и отсутствие карты
  во время загрузки другой попытки.
- LOW 1 — тест «вердикт после „проверяется“» (`race-my-track.test.tsx`, RC-4); отрицательное доказательство: без
  `status`/`checkedAt` в ключе тест красный (1 failed).
- LOW 2 — легенда «пунктир» только при `marks: 'ready'` и непустых `offRuns`.
- LOW 3 — JSDoc `trackLines` возвращён на место.
- LOW 4 — без изменений (D7).

## Pass 2

# Findings — maps-02-own-track — pass 2 — reviewer: claude
base: origin/develop   scope: незакоммиченные исправления (`git diff HEAD`: `race-route-map.tsx`,
`race-my-track.test.tsx`, `tracks.repository.ts`, `.claude/rules/pokatim-app.md`)
verdict: APPROVE

Проверено: полный текст `race-route-map.tsx` после правки, `useMyAttemptTrack` (`queries.ts`), `createQueryClient`
(`retry: shouldRetry`), `@tanstack/query-core` 5.104.5 `query.js` `fetchState` / `queryObserver.js` (`failureCount`,
`errorUpdateCount`). Запущено: `apps/app` jest `race-my-track.test.tsx race-route-map.test.tsx` — 2 suites, 18 passed.
`pnpm check` не запускал (по поручению).

Статус замечаний pass 1:
- **MEDIUM (скелетон при смене попытки) — закрыт.** Скелетон теперь только вместо `RouteMap`; группа чипов
  `my-track-attempts`, строки и ошибка рендерятся вне ветки — нажатый чип остаётся в дереве. Тест AC6 держит промис
  трека другой попытки неразрешённым и проверяет: чипы на экране, `maplibre-Map` нет; после разрешения — строка схода.
  Во время автоповторов после первой ошибки (`failureCount > 0`) — карта маршрута без трека, как требует §4.12.
- **LOW 1 (тест RC-4) — закрыт.** Тест «вердикт после „проверяется“»: `checking` → `pending`; опрос участия
  (5 с) приносит `rejected` с `checkedAt` → второй вызов `getMyAttemptTrack`, строка схода и `kind: 'off'` в источнике.
  Отрицательное доказательство (без `status`/`checkedAt` в ключе — красный) заявлено оркестратором, мной не
  повторялось.
- **LOW 2 (легенда «пунктир») — закрыт.** `legendOff` только при `marks === 'ready' && offRuns.length > 0`; тест AC6
  проверяет точный текст «Ваш трек» при `offRuns: []`.
- **LOW 3 (JSDoc) — закрыт.** Комментарий вернулся к `trackLines`, у `ownTrackLine` один блок.
- **LOW 4 (D7)** — без изменений, как и предлагалось.

Регрессии (измерения):
- **Повторное монтирование карты.** Первая загрузка: скелетон → одна карта с треком (RC-5 сохранён). Смена
  попытки/ревизии без кэша: карта → скелетон → новая карта — так было и раньше (меняется `key`). Возврат к уже
  загруженной попытке — данные из кэша (`staleTime: Infinity`), без скелетона. Ошибка с автоповторами: карта без
  трека → при успехе ретрая `key` меняется (трек появился) — одно лишнее монтирование только на пути ошибки, допустимо.
- **SSR / место до монтирования.** `!map || styleUrl === null` → тот же одиночный скелетон пропорции
  `MAP_ASPECT_RATIO`, без обёртки `block` — как в pass 1; гидратация не затронута.
- **a11y.** Подпись карты, radiogroup чипов, текстовая альтернатива — без изменений; легенда больше не противоречит
  строкам. Остаток — ниже.
- **Документация.** `.claude/rules/pokatim-app.md` и JSDoc компонента соответствуют новому поведению.
- **i18n, дизайн-система, безопасность, API** — затронут только перенос JSDoc; новых строк/ролей нет.

### [LOW] Нажатие «Повторить» после ошибки трека снова прячет карту скелетоном и убирает кнопку из дерева
- **file:** apps/app/src/features/races/race-route-map.tsx
- **location:** `const trackPending = trackQuery.isLoading && trackQuery.failureCount === 0;`
- **problem:** при `refetch()` запроса без данных TanStack Query 5 (`query.js` `fetchState`) сбрасывает
  `fetchFailureCount: 0`, `error: null` и возвращает `status: 'pending'` → `isLoading === true`,
  `failureCount === 0`, `isError === false`. Значит после нажатия «Повторить» карта маршрута (без трека) заменяется
  скелетоном, а строка ошибки с нажатой кнопкой `TextAction` размонтируется. Если повтор снова падает, после первой
  неудачи карта монтируется заново (тот же `key`, но после размонтирования — новая инстанция, повторная загрузка
  стиля/тайлов), а строка ошибки появляется только по исчерпании ретраев.
- **why_it_matters:** тот же класс, что MEDIUM pass 1, но на пути повтора: фокус клавиатуры/скринридера с кнопки
  «Повторить» теряется, карта, которая уже была показана, прячется на время зависимого запроса (§4.12) и мигает.
  Расходится с комментарием в коде («после первой ошибки — карта маршрута без трека») и правилом в
  `pokatim-app.md`. Затрагивает только путь ошибки сети/5xx, данных не искажает — поэтому LOW.
- **evidence:** `node_modules/@tanstack/query-core/build/modern/query.js:548-557` (`fetchState`:
  `fetchFailureCount: 0`, при `data === undefined` — `error: null, status: "pending"`); тест AC8 после нажатия ждёт
  только `trackSource()` и не проверяет промежуточное состояние, поэтому зелёный.
- **recommended_fix:** учитывать прошлые окончательные ошибки, которые `fetchState` не сбрасывает:
  `trackQuery.isLoading && trackQuery.failureCount === 0 && trackQuery.errorUpdateCount === 0` (поле есть в
  `QueryObserverResult`, `queryObserver.js:394`). В тесте AC8 — держать повторный ответ неразрешённым и проверить,
  что `maplibre-Map` остаётся на экране.

**Итог pass 2:** CRITICAL — 0, HIGH — 0, MEDIUM — 0, LOW — 1 новое (повтор после ошибки) + LOW 4 pass 1 (D7,
принято). MEDIUM и LOW 1–3 pass 1 закрыты. APPROVE.

## Fix после pass 2 (оркестратор)

- LOW «Повторить» прячет карту — в условие скелетона добавлено `errorUpdateCount === 0` (по исходнику
  `@tanstack/query-core` `fetchState`: `refetch` без данных сбрасывает `fetchFailureCount` и ставит `pending`). Тест
  AC8 держит ответ повтора неразрешённым и проверяет, что карта на экране. **Оговорка:** в jsdom тест зелёный и без
  правки (во время повтора наблюдатель остаётся в `error`), поэтому правка — защитная, отрицательного доказательства
  нет.
