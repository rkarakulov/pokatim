# task.md — route-rides-05: участки маршрута

Уровень: task3. Шаг 3 из 3 этапа 2 (после route-rides-03 и -04). Продуктовые решения — `docs/product/routes.md`,
«Этап 2» (U1–U4). Два PR (architect): **A** — `packages/tracks` + контракты + API; **B** — приложение и i18n.
Ветка PR A: `feature/route-rides-sections-api` от `origin/develop` **после merge route-rides-04 PR A** (общие файлы:
`route-ride.schema.ts`, `route-rides.policy.ts` — `compareRides`, `route-rides.repository.ts`).

## 1. Title

Автоматические участки маршрута (~10 км): время по каждому участку заезда, зачёт участка при непройденном маршруте,
сравнение по участкам со своими заездами.

## 2. Goal

Сейчас частичный проезд не засчитывается (R3): проехал 70 из 90 км — «Не пройден» без цифр. Участки дают райдеру
время на каждом пройденном куске и прогресс от заезда к заезду.

## 3. Scope (решения architect первой версии, `[ASSUMPTION]`)

1. **U1 — разбиение** (RC-2: вариант `routes.md`): чистая функция `routeSections` в
   `packages/tracks/src/corridor/sections.ts` (экспорт только серверным входом), `ROUTE_SECTIONS_VERSION = 1`. Границы
   через каждые 10 км по chainage линии сверки; хвост < 5 км сливается с последним участком. Маршрут < 15 км — участков
   нет; > 30 участков — участков нет.
2. **RC-3 (дефект спеки):** у линейного подкоридора с концами ближе 2R (≈ 100 м) `prepareCorridor` бросает
   `CorridorError` (маршрут «туда-обратно», участок захватывает разворот) — такой участок сливается с соседним.
3. **U2 — сверка:** N прогонов неизменённых `prepareCorridor`/`matchCorridor` на подкоридорах (`isLoop: false`) в одном
   потоке новой функцией `analyzeSections` (белый список `parse-thread`), файл разбирается один раз; отдельный вызов
   после основной сверки — таймаут участков не ломает вердикт маршрута. Один проход по chainage — отвергнут (логика
   ворот/покрытия внутри `Engine`, риск golden). `match.ts`, `prepare.ts`, `project.ts`, `policy.ts`, golden и
   `CORRIDOR_ENGINE_VERSION` не меняются.
4. **Хранение:** `route_rides.sections` (`{ version, failure, items }`), без миграции; `requeue` сбрасывает в `null`.
5. **U3 — сравнение:** `sectionsOf` в `route-rides.policy.ts` — только участки с теми же `fromM`/`toM` и версией, среди
   своих видимых заездов, порядок как `bestOf`.
6. **Контракт:** `RouteRideDetail.sections` `.default([])`, статус участка — `tolerantEnum`.
7. **Автопроверка (03)** считает участки только после «Пройден»; ручная — всегда.
8. **Бэкфилла нет, подписи у старых заездов нет** (проверенный заезд повторно не проверяется; заезды есть пока только
   на dev). Метки км на карте — вне задачи (нет слоя точек, две реализации).
9. **U4 — экран (PR B):** блок «Участки» в `RideView` после сравнения: км от–до, время или «Не пройден», «Лучший»,
   «К лучшему +0:12»; нет участков — блока нет.

## 4. Out of Scope

Участки в «Других», рейтинги участков, ручная разметка, подъёмы; изменение вердикта маршрута, движка, golden; бэкфилл.

## 5. Architecture Context

- Модуль `apps/api/src/modules/route-rides/` (route-rides-01…04): `RouteRideEvaluator` (общая сверка ручной и
  автопроверки, 03), `RouteRideCheckProcessor` (очередь `route-ride-check`), `RouteRideAutoProcessor` (`route-ride-auto`),
  `RouteRidesReadService.detail`, `route-rides.policy.ts` (`bestOf`/`comparisonOf`, `compareRides` из 04).
- Движок коридора — `packages/tracks/src/corridor/*` (ADR-0012: только worker, `worker_threads`, `runParseThread`,
  семафор `PARSE_THREADS_MAX = 1`, лимиты 160/32 МБ, 30 с). Линия сверки маршрута — `route_geometries.matchLine`
  (≤ 20 000 точек, упрощение 1 м), готовый маршрут неизменяем (`matchLine` бэкфиллом `deriveRoute` не пересчитывается).
- Ворота: `corridorGateRadiusM(widthM) = max(widthM, 30)` → при `ROUTE_RIDE_POLICY.corridorWidthM = 50` радиус 50 м;
  `prepareCorridor` у линейного коридора требует `ends > 2R` (100 м) и ≤ 32 отрезков в ячейке сетки 200 м.
- Порты: `RouteRideRoutes.matchGeometry` (`routes`), `ActivitySource.readSource/trackLine/liveActivities` (`tracks`).

## 5.1 Placement & Reuse Gate (обязательно)

Architecture Review — route-rides-05 (PR A). **Status: APPROVED** (блокеров нет; RC-4…RC-12 — уточнения по коду с
рекомендацией, по умолчанию coder идёт по ним; вопросов человеку нет).

**Placement.**
- `packages/tracks/src/corridor/sections.ts` — **новый**: `ROUTE_SECTIONS_VERSION = 1`, `ROUTE_SECTION_POLICY`,
  `routeSections(line, widthM)` (чистая, детерминированная), `sectionLine(line, fromM, toM)` (подлиния с
  интерполированными концами). Код рядом с движком, но движок не трогает: только `haversineMeters`,
  `corridorGateRadiusM`.
- `packages/tracks/src/parse.ts` — **новая** `analyzeSections(bytes, format, corridor, window, now)`: `routeSections` →
  участков нет — возврат до разбора файла; иначе `loadTrack` один раз → по участку `prepareCorridor(sectionLine,
  isLoop: false)` → `matchCorridor` (неизменённые). Экспорт `routeSections`, `ROUTE_SECTIONS_VERSION`,
  `ROUTE_SECTION_POLICY`, типов — только из `parse.ts` (лёгкий вход `index.ts` не меняется).
- `apps/api/src/parse-thread.ts` — `'analyzeSections'` в конец `PARSE_FUNCTIONS`.
- `apps/api/src/modules/route-rides/` (папка, не пакет): `route-ride-evaluator.ts` (второй вызов потока),
  `route-rides.collection.ts` (`RouteRideSectionsDoc`), `route-rides.repository.ts` (`cleared` +`sections: null`),
  `route-rides.policy.ts` (`sectionsOf`), `route-rides-read.service.ts` (`detail.sections`),
  `route-ride-check.processor.ts`/`route-ride-auto.processor.ts` (режим участков).
- Контракты: `packages/contracts/src/route-rides/route-ride.schema.ts` — аддитивно.
- Нового пакета нет; кода для app-foundation нет.

**Reuse / запрещённые дубли.**
- Сверка участка — только `prepareCorridor` + `matchCorridor` (`corridor/*`) как есть. **Запрещено**: копия/форк
  логики ворот, покрытия, привязки; правка `match.ts`, `prepare.ts`, `project.ts`, `policy.ts`, `types.ts`,
  `corridor-golden.json`, `corridor-expected.json`, `CORRIDOR_ENGINE_VERSION`.
- Разбор файла — `loadTrack` (тот же, что `analyzeAttempt`), один раз на вызов.
- Поток — `runParseThread` + `RouteRideEvaluator.parseLimits`; коды отказа потока — тот же маппинг `THREAD_FAILURES`
  эвалюатора (не второй список).
- Геометрия, исходник, линия — уже прочитанные в `RouteRideEvaluator.evaluate` (`matchGeometry`, `readSource`) —
  второй раз не читать.
- Окно — `matchWindowOf(ride.activity)`; ширина — `ride.corridorWidthM`.
- Порядок «лучшего» — `compareRides` (04, ключ `bestOf`: время → дата заезда → `_id`); не третья копия компаратора.
- Видимые заезды — `RouteRidesReadService.visible` (живые активности, `effectiveStatus`).
- Константы: `ROUTE_SECTION_POLICY.maxSections` (tracks) = `ROUTE_RIDE_SECTIONS_MAX` (contracts) — контракты не зависят от
  `@pokatim/tracks`, равенство сторожит unit-тест API, не импорт.

## 6. Relevant Files

- `packages/tracks/src/corridor/{prepare,match,types,policy}.ts`, `__testing__/synthetic.ts`, `bench.test.ts`,
  `fixtures.test.ts`; `packages/tracks/src/parse.ts` (`analyzeAttempt`, `loadTrack`), `geo.ts`, `track.ts`.
- `apps/api/src/parse-thread.ts` (+ test).
- `apps/api/src/modules/route-rides/{route-ride-evaluator,route-ride-check.processor,route-ride-auto.processor,
  route-rides.collection,route-rides.repository,route-rides.policy,route-rides-read.service}.ts` и их тесты;
  `apps/api/test/route-rides.ts`, `apps/api/test/results.ts` (`corridorRoute`, `rideGpx`).
- `packages/contracts/src/route-rides/route-ride.schema.ts` (+ test), `packages/api-client/src/route-rides.test.ts`.
- Соседняя задача: `docs/tasks/2026-10-31-route-rides-04-others/task.md` (`compareRides`, leaderboard-агрегат по
  `route_rides` — `sections` не читает).

## 7. Implementation Notes

Contracts-first, TDD. Int-тесты — своя БД Mongo (`*_test`) и свой Redis db (`pokatim-tests.md`). Порядок шагов — §11.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` 10 км / хвост < 5 км / маршрут < 15 км / ≤ 30 участков (U1).
- Нагрузка: N ≤ 30 прогонов `matchCorridor` по **всему** треку в одном потоке (до 30 с) после основной сверки; у
  автопроверки — только для `passed` (≤ 20 маршрутов на активность). Бюджет — бенч (§11 TESTS), провал бюджета —
  `sections.failure: 'timeout'`, вердикт маршрута цел.
- Сумма времён участков ≠ время маршрута (ворота: участок — от выхода из ворот старта до входа в ворота финиша,
  ≈ 100 м у каждой границы не входит ни в один участок) — сумму не показывать (PR B).

## 8.1 Requirements Consistency (заполняет architect)

Блокеров нет. Конфликтов с инвариантами AGENTS.md §4 нет: серверный авторитет (участки, время и «лучший» считает
сервер), движок и golden не меняются (ADR-0012), разбор — только в `worker_threads`. Решения §3 (U1–U4, RC-2, RC-3)
подтверждены по коду; ниже — уточнения, найденные в коде.

- **RC-4. Проверка концов участка — в `routeSections`, а не ловлей `CorridorError`.** Подтверждено: `prepare.ts`
  `assert(isLoop || ends > 2 * gateRadiusM)`, `gateRadius = max(widthM, 30)`. Ловить исключение в потоке и сливать
  «по факту» — недетерминированно для сравнения (U3 требует одинаковых границ у всех заездов). Варианты: (a)
  **`routeSections(line, widthM)` сама проверяет `haversine(конец, начало) > 2·corridorGateRadiusM(widthM) +
  gateMarginM` (50 м запаса) и сливает с соседним** (следующим; последний — с предыдущим), повтор до устойчивости;
  (b) ловить `CorridorError` в `analyzeSections` и сливать — разбиение зависит от прогона; (c) делать участки
  `isLoop: true` — меняет семантику развёртки. **Рекомендация — (a).** После слияний < 2 участков — участков нет
  (один участок = маршрут).
- **RC-5. Прочие `CorridorError` участка** (плотность > 32 отрезков в ячейке: сетка подлинии выровнена от её рамки, у
  маршрута — от своей; редкий случай) — весь `sections.failure: 'corridor_invalid'`, `items: []` (детерминировано по
  маршруту; частичный набор участков сломал бы сравнение). Не ретрай.
- **RC-6. `widthM` — вход разбиения.** Граница слияния зависит от радиуса ворот → `routeSections(line, widthM)`;
  ширина — `ride.corridorWidthM` (пишется в документ, RC-15 route-rides-01). Смена ширины политики даёт другие
  `fromM/toM` → `sectionsOf` их не сравнивает (корректно).
- **RC-7. Chainage.** По `matchLine` как она хранится — сумма `haversineMeters` по вершинам (не уплотнённая линия
  `prepareCorridor`: разница — сантиметры, но `routeSections` не должна зависеть от внутренностей движка).
  `fromM`/`toM` — `Math.round`, сравнение U3 — по целым. Порог «< 15 км» — по этой длине.
- **RC-8. Короткий маршрут без потока.** `matchLine` упрощена из исходных точек → её длина ≤ `RouteMatchGeometry
  .distanceM`. Эвалюатор при `geometry.distanceM < ROUTE_SECTION_POLICY.minRouteM` пишет `{ version, failure: null,
  items: [] }` **без** второго потока (не держит семафор у маршрутов < 15 км — все нынешние фикстуры 8 км). Иначе
  решает `routeSections` в потоке (до `loadTrack`).
- **RC-9. Когда считать участки (§3 п. 7, уточнение).** Только при успешной основной сверке потоком
  (`outcome.ok`: `passed` или `not_passed` движка). Нет геометрии/исходника, отказ потока (`timeout`, `unreadable`,
  `corridor_invalid`), `implausible` — `sections: null` (файл тот же, повтор даст то же). Ручная — `mode: 'always'`,
  авто — `'ifPassed'` (не `passed` — второго потока нет).
- **RC-10. Сбой окружения второго потока** (загрузчик, падение потока — исключение `runParseThread`) — **не**
  ретрай задачи: вердикт маршрута уже получен, повтор прогнал бы основную сверку снова. Варианты: (a) **поймать в
  эвалюаторе → лог, `sections: { failure: 'error', items: [] }`**; (b) пробросить (ретрай всей проверки; у
  автопроверки — до 20 маршрутов заново). **Рекомендация — (a)** (§3 п. 3: участки не ломают вердикт). Коды потока
  `timeout|unreadable|corridor_invalid` → `failure` тем же маппингом; иное — `'unreadable'`.
- **RC-11. Хранимый участок — минимум.** `{ fromM, toM, status: 'passed'|'not_passed', elapsedSec: number|null }` —
  без причин, сегментов, координат, датчиков (минимизация). «Лучший» и дельты — на чтении (`sectionsOf`), не храним
  (меняются с новыми заездами).
- **RC-12. Формулировка `routes.md`** «равные участки около 10 км» расходится с U1 §3 («через каждые 10 км, хвост <
  5 км — к последнему»: участки 10 км и последний 5–15 км). Рекомендация — поправить текст `routes.md` под §3 (→ §10),
  решение не меняется.

## 8.2 Deviations from spec

- **D1 (данные теста, намерение то же).** Пример §11 «туда-обратно 2 × 20 км — участок с концами ≤ 150 м слит»
  невоспроизводим: у 2 × 20 км границы 10/20/30 км не попадают на разворот, концов ближе 150 м нет. После решения Q1
  слияние проверено на «шпильке» (линия возвращается к началу участка на 100/200 м, ширина 50/100 — порог 150/250 м),
  «туда-обратно» 2 × 15 км (разворот 15 070/15 080/15 100 м) — участков нет.
- **D2 (бенч).** `analyzeSections` 200 км (20 участков) × 50 000 точек — замер локально 383–405 мс (load ≈ 5);
  бюджет `SECTIONS_TIME_LIMIT_MS = 800` мс (2 × замера по §11), × 3 на CI (`CI_BUDGET_FACTOR`), < 15 с.
- **D3 (фикстура приложения).** `apps/app/src/__tests__/route-rides-fixtures.ts` — `sections: []` в `rideDetail`
  (выход `RouteRideDetail` теперь с обязательным `sections`; иначе typecheck `@pokatim/app` красный). Код приложения не
  менялся (PR B).
- **D4 (типы).** `RouteRideResult` = прежний `Pick` + `Required<Pick<RouteRideDoc, 'sections'>>`: в итоге проверки
  поле обязательно (`null` или набор), в документе — необязательно (заезды до 05).
- **Q1 → `[ASSUMPTION]`, решение оркестратора — вариант (a) (дефект спеки RC-3/RC-4).** Слитый участок с разворотом
  «туда-обратно» по одной дороге проходит через свои ворота: неизменённый движок для линейного коридора завершает
  попытку на повторном входе в ворота старта (сегмент 10 → 15 → 10 км, покрытие 0,49 → `missed_section`) — честный
  проезд не засчитывался бы никогда. Решение: в `routeSections` участок сливается и тогда, когда его линия после
  выхода из радиуса `2·corridorGateRadiusM + gateMarginM` снова подходит к своему началу или концу (расстояние до
  отрезков, `returnsTo`), до устойчивости; < 2 участков — участков нет. У «туда-обратно» по одной дороге участков нет
  (честнее вечного «Не пройден»). `ROUTE_SECTIONS_VERSION` не поднимается (не выкачено). **Follow-up:** граница в
  точке разворота (меняет U1) — отдельное продуктовое решение.

## 8.3 Security checklist

Затронуто: данные пользователя (треки, заезды), worker, ответ API. Чек-лист — обязателен.

- [ ] **AuthZ (API).** `sections` — только своего заезда (деталь с `userId`), сравнение — только среди своих видимых
  заездов (`visible`: `userId` + живые активности); чужие заезды и «Другие» участков не видят (int-тест: заезд другого
  райдера по тому же маршруту не влияет на `isBest`/`bestElapsedSec`).
- [ ] **AuthZ (worker).** Геометрия — `matchGeometry(routeId, userId)` (видимость сейчас), исходник — тот же, что у
  основной сверки; новых чтений нет.
- [ ] **Данные наружу.** `fromM`/`toM` (метры по маршруту, не координаты), статус, время, `isBest`, `bestElapsedSec`,
  `deltaToBestSec`; без координат, `userId`, `engineVersion`, `version`, `failure`. Ключи участка — явный список
  (int-тест ключей).
- [ ] **Злоупотребления / нагрузка.** ≤ 30 участков; один поток с лимитами 160/32 МБ и 30 с; маршрут < 15 км — без
  потока; автопроверка — только `passed`; лимит ручных проверок 30/ч не меняется. Бенч (§11).
- [ ] **Серверный авторитет.** Клиент не присылает участки и не влияет на разбиение/вердикт.
- [ ] **Логи.** Только id и счётчики: `route-ride <id> sections: <n> items, <k> passed[, failure <code>] in <T> ms`;
  без координат и названий.
- [ ] **Удаление аккаунта.** `sections` — поле документа `route_rides`, стирается `RouteRideErasure.deleteAllOf`.
- [ ] **Секреты/конфиг.** Не затронуты.

## 9. Acceptance Criteria

1. Маршрут ≥ 15 км: у нового заезда — участки с временем у пройденных, даже если маршрут «Не пройден».
2. Разбиение детерминировано, unit-тесты (длины, хвост, петля, туда-обратно, короткий, > 30).
3. Сравнение по участкам — только свои заезды, считает сервер.
4. Гонки и golden движка не изменились.
5. Экран результата показывает участки во всех статусах и платформах; нет участков — блока нет.
6. Тесты, lint, typecheck затронутых пакетов зелёные; CI зелёный.

## 10. Documentation Impact

- `docs/product/routes.md` — U1 формулировка (RC-12), «участки туда-обратно сливаются через разворот» (RC-3/RC-4),
  «у заездов до 05 участков нет».
- `.claude/rules/pokatim-backend.md` — раздел route-rides: `analyzeSections` (второй поток после основной сверки,
  режимы `always`/`ifPassed`, RC-8…RC-10), `sectionsOf`; раздел сверки: «участки — неизменённый движок на подлиниях,
  `ROUTE_SECTIONS_VERSION` отдельно от `CORRIDOR_ENGINE_VERSION`».
- `.claude/rules/pokatim-db.md` — `route_rides.sections` (`{ version, failure, items }`, нет поля/`null` — участков
  нет, сброс при `requeue`, без миграции и индексов).
- `.claude/rules/pokatim-contracts.md` — `ROUTE_RIDE_SECTION_STATUSES`, `RouteRideSection`, `RouteRideDetail.sections`
  `.default([])`, `ROUTE_RIDE_SECTIONS_MAX`.
- `.claude/rules/pokatim-tests.md` — тесты разбиения и `analyzeSections` (синтетика `__testing__/synthetic.ts`, бенч,
  сторож «golden не менялся»).
- JSDoc: `sections.ts`, `analyzeSections`, `PARSE_FUNCTIONS`, `RouteRideSectionsDoc`. ADR не нужен (движок не меняется,
  ADR-0012 п. 5 соблюдён). `pr.md` — coder.

## 11. Implementation Context (заполняет architect)

**ENTRY POINTS**
- Worker: `RouteRideCheckProcessor.check` → `RouteRideEvaluator.evaluate(ride, { sections: 'always' })` →
  `runParseThread('analyzeAttempt')` → `runParseThread('analyzeSections')` → `repository.record` (`sections` в `$set`).
- Worker: `RouteRideAutoProcessor.checkRoute` → `evaluate(draft, { sections: 'ifPassed' })` → `insertChecked`.
- API: `GET /v1/routes/:routeId/rides/:rideId` (`RouteRidesReadService.detail`) → `sections`.

**FILES TO MODIFY / CREATE**
- `packages/tracks/src/corridor/sections.ts` (**новый**):
  `ROUTE_SECTIONS_VERSION = 1`; `ROUTE_SECTION_POLICY = { stepM: 10_000, minTailM: 5_000, minRouteM: 15_000,
  maxSections: 30, gateMarginM: 50 } as const`; `interface RouteSection { fromM: number; toM: number }` (целые);
  `routeSections(line: readonly [number, number][], widthM: number): RouteSection[]` — chainage по вершинам
  (`haversineMeters`), `L < minRouteM` → `[]`; границы `k·stepM` (k ≥ 1) пока `L − k·stepM ≥ minTailM`; концы —
  интерполяция по chainage; слияние RC-4 (концы участка ≤ `2·corridorGateRadiusM(widthM) + gateMarginM` → со
  следующим, последний — с предыдущим; до устойчивости); итог < 2 или > `maxSections` → `[]`. `sectionLine(line,
  fromM, toM): [number, number][]` — интерполированные концы + вершины строго между (≥ 2 точки). Работает на
  неокруглённом chainage; округляет только выход.
- `packages/tracks/src/parse.ts` — `interface RouteSectionResult { fromM; toM; verdict: 'counted'|'rejected';
  elapsedSec: number | null }`, `interface RouteSectionsAnalysis { version: number; items: RouteSectionResult[] }`;
  `analyzeSections(bytes, format, corridor: CorridorGeometry, window: MatchWindow, now: Date): RouteSectionsAnalysis` —
  `routeSections(corridor.line, corridor.widthM)` → `[]` → `{ version, items: [] }` без `loadTrack`; иначе `loadTrack`
  один раз, по участку `prepareCorridor({ line: sectionLine(...), widthM, isLoop: false, distanceM: toM − fromM })` →
  `matchCorridor(points, prepared, window)` → `elapsedSec` только при `counted`. Подготовленный коридор участка не
  копится (по одному). `CorridorError` — пробрасывается (поток → `corridor_invalid`, RC-5). Экспорт `routeSections`,
  `sectionLine`, `ROUTE_SECTIONS_VERSION`, `ROUTE_SECTION_POLICY`, типов.
- `apps/api/src/parse-thread.ts` — `'analyzeSections'` в конец `PARSE_FUNCTIONS` (+ JSDoc).
- `packages/contracts/src/route-rides/route-ride.schema.ts` — `ROUTE_RIDE_SECTION_STATUSES = ['passed', 'not_passed']
  as const` (только в конец), `ROUTE_RIDE_SECTIONS_MAX = 30`; `RouteRideSection = z.object({ fromM: int, toM: int,
  status: tolerantEnum(ROUTE_RIDE_SECTION_STATUSES), elapsedSec: int.nullable(), isBest: z.boolean(), bestElapsedSec:
  int.nullable(), deltaToBestSec: int.nullable() })`; в `RouteRideDetail` — `sections: z.array(RouteRideSection)
  .max(ROUTE_RIDE_SECTIONS_MAX).default([])`; экспорт из `src/index.ts`.
- `apps/api/src/modules/route-rides/route-rides.collection.ts` — `RouteRideSectionDoc { fromM; toM; status:
  'passed'|'not_passed'; elapsedSec: number|null }`, `RouteRideSectionsDoc { version: number; failure: AttemptFailure |
  null; items: RouteRideSectionDoc[] }`; `RouteRideDoc.sections?: RouteRideSectionsDoc | null` (JSDoc: нет поля —
  заезд до 05, участков нет); `'sections'` в `RouteRideResult`.
- `apps/api/src/modules/route-rides/route-rides.repository.ts` — `cleared()` + `sections: null` (`requeue`);
  `record`/`insertChecked` — без изменений кода (поле в `result`).
- `apps/api/src/modules/route-rides/route-ride-evaluator.ts` — `emptyResult` + `sections: null`;
  `analyzeSections(bytes, format, corridor, window, now): Promise<ThreadOutcome<RouteSectionsAnalysis>>` (точка
  подмены в тестах, как `analyze`); `evaluate(ride, { sections }: { sections: 'always' | 'ifPassed' })` — после
  основного итога (RC-9): режим и статус подходят → RC-8 (короткий — пусто без потока) → поток → `ok` — `{ version,
  failure: null, items: map(counted → passed + elapsedSec, иначе not_passed + null) }`; отказ — `{ version:
  ROUTE_SECTIONS_VERSION, failure, items: [] }`; исключение — RC-10. Лог (8.3).
- `apps/api/src/modules/route-rides/route-ride-check.processor.ts` — `evaluate(ride, { sections: 'always' })`;
  `failedResult` в `catch` финальной попытки — `sections: null` (через `emptyResult`).
- `apps/api/src/modules/route-rides/route-ride-auto.processor.ts` — `evaluate(draft, { sections: 'ifPassed' })`.
- `apps/api/src/modules/route-rides/route-rides.policy.ts` — `newRideDoc` без `result` → `sections: null`;
  `sectionsOf(rides: readonly RouteRideFacts[], ride: RouteRideFacts): RouteRideSection[]` — `ride.sections?.items`
  нет → `[]`; для участка: пройденные участки с тем же `fromM`/`toM` у заездов с тем же `sections.version` (включая
  этот), лучший — `compareRides` по паре (время участка, дата заезда, `_id`); `isBest`, `bestElapsedSec`,
  `deltaToBestSec` (только у `passed`). Чистая.
- `apps/api/src/modules/route-rides/route-rides-read.service.ts` — `detail.sections = sectionsOf(rides, ride)` только
  при эффективном статусе `passed`/`not_passed`, иначе `[]`.
- `apps/api/test/route-rides.ts` — хелпер `longCorridorRoute(h, ownerUserId, kind)` (`'line' | 'outAndBack'`, ≥ 25 км,
  через `corridorRoute(h, owner, geometry)`) и `longRideGpx(route, startAt, { stopAtM? })` — синтетический GPX по линии
  (точка раз в 5 с, 8 м/с), без фикстур-файлов.

**FILES TO READ**
`docs/product/routes.md` («Этап 2»); task.md route-rides-01 (§8.1 RC-9, RC-15), -03 (§5.1, AC-9), -04 (`compareRides`);
`packages/tracks/src/corridor/{prepare,match,types,policy}.ts`, `__testing__/synthetic.ts`, `bench.test.ts`,
`fixtures.test.ts`; `parse.ts` (`analyzeAttempt`, `loadTrack`), `track.ts` (`corridorGateRadiusM`,
`CorridorGeometry`); `apps/api/src/parse-thread.ts`; `route-ride-evaluator.ts`, `route-ride-check.processor.ts`,
`route-ride-auto.processor.ts`, `route-rides.policy.ts`, `route-rides-read.service.ts`, `route-rides.repository.ts`;
`apps/api/test/{route-rides,results}.ts`; правила `pokatim-backend.md` (route-rides, сверка), `pokatim-db.md`,
`pokatim-contracts.md`, `pokatim-tests.md` (коридор, golden), `pokatim-security.md`; ADR-0012.

**TYPES & SCHEMAS**
`ROUTE_SECTIONS_VERSION`, `ROUTE_SECTION_POLICY`, `RouteSection`, `routeSections`, `sectionLine`, `RouteSectionResult`,
`RouteSectionsAnalysis`, `analyzeSections` (`@pokatim/tracks/parse`); `ROUTE_RIDE_SECTION_STATUSES`,
`ROUTE_RIDE_SECTIONS_MAX`, `RouteRideSection`, `RouteRideDetail.sections` (contracts); `RouteRideSectionDoc`,
`RouteRideSectionsDoc`, `RouteRideDoc.sections?`, `RouteRideResult.sections`; импорт без копий: `CorridorGeometry`,
`MatchWindow`, `corridorGateRadiusM`, `haversineMeters`, `prepareCorridor`, `matchCorridor`, `loadTrack`,
`ThreadOutcome`, `compareRides`, `matchWindowOf`, `ROUTE_RIDE_POLICY.corridorWidthM`.

**TESTS** (int — своя БД Mongo `*_test` и свой Redis db)
- Unit `packages/tracks/src/corridor/sections.test.ts` (`routeSections`, линии из `__testing__/synthetic.ts`):
  14 999 м → `[]`; 15 000 м → `[0–10 000, 10 000–15 000]`; 24 999 м → `[0–10 000, 10 000–24 999]` (хвост 4 999 к
  последнему); 25 000 м → 3 участка (хвост ровно 5 000 — свой); 304 999 м → 30 участков (последний
  290 000–304 999); 305 000 м → `[]` (31 > 30);
  петля 40 км (конец = начало) — 4 участка, последний не сливается (концы далеко); «туда-обратно» 2 × 20 км — участок
  с концами ≤ 150 м слит с соседним, у всех итоговых концы > 150 м; «туда-обратно», где всё сливается в один → `[]`;
  детерминизм (два вызова, копия линии — равны); `fromM`/`toM` целые, `toM` последнего = `round(L)`, без зазоров;
  `widthM 100` → другой порог слияния. `sectionLine`: концы интерполированы (расстояние до точки chainage < 1 м),
  ≥ 2 точки при границе внутри одного отрезка, подлинии соседей стыкуются.
- Unit `packages/tracks/src/corridor/analyze-sections.test.ts` (или в `match.cases.test.ts`-стиле, синтетика `ride`):
  полный проезд 30 км → все участки `counted`, каждое `elapsedSec` ≈ длина/скорость (± ворота), сумма < времени
  маршрута; остановка на 18 км из 30 → 1-й участок `counted`, 2-й и 3-й `rejected`, при этом `analyzeAttempt` всего
  маршрута — `rejected` (AC9.1); объезд в середине 2-го участка → 2-й `rejected`, 1-й и 3-й `counted`; маршрут 8 км →
  `items: []` и файл не разбирается (спай `loadTrack` не вызывался / негодный байтовый вход не бросает); негодный файл
  при ≥ 15 км → `TrackParseError`; результат сериализуем (`structuredClone`).
- **Регрессия движка / golden (AC9.4):** `fixtures.test.ts` и `corridor-golden.json`, `corridor-expected.json`,
  `simplify-golden.json`, `sensor-flags-golden.json` — без изменений файлов и зелёные; `CORRIDOR_ENGINE_VERSION === 1`;
  в PR — `git diff --stat origin/develop -- packages/tracks/src/corridor/{match,prepare,project,policy,types}.ts
  packages/tracks/src/__fixtures__` пуст (проверка в pr.md). Регрессия гонок: int `results` (`attempt-check`) — прежние
  тесты зелёные без правок.
- **Бенч** `bench.test.ts` (+ кейс): маршрут 200 км (20 участков) × трек 50 000 точек — `analyzeSections` ≤ 10 с
  локально (× 3 на CI, как AC14); бюджет coder калибрует замером (≤ 2× замера, но < 15 с), превышение — 8.2 и вопрос.
- Unit `apps/api/src/parse-thread.test.ts` — `analyzeSections` в белом списке, вызывается в потоке (короткий маршрут
  → `{ version: 1, items: [] }`).
- Unit контракта `route-ride.schema.test.ts`: деталь без `sections` → `[]`; `status: 'x'` → `'unknown'`; > 30 → ошибка.
- Unit `route-rides.policy.test.ts` — `sectionsOf`: нет поля/`null` → `[]`; один заезд — `isBest` у `passed`,
  `deltaToBestSec 0`; лучший у другого заезда → `deltaToBestSec > 0`, `bestElapsedSec`; ничья по времени — раньше
  заезд, затем `_id` (`compareRides`); другой `version` или другие `fromM/toM` — не сравниваются; `not_passed` участок
  — `elapsedSec null`, `isBest false`, `bestElapsedSec` есть; участок пройден в заезде с маршрутом «Не пройден»
  участвует в лучшем. Сторож `ROUTE_SECTION_POLICY.maxSections === ROUTE_RIDE_SECTIONS_MAX`.
- Int `route-ride-check.int.test.ts`: длинный маршрут (`longCorridorRoute`), полный проезд → `passed`, `sections.items`
  все `passed`, `version 1`; остановка на 18 км → маршрут `not_passed`, 1-й участок `passed` (AC9.1); маршрут 8 км →
  `sections: { items: [] }` и `analyzeSections` не вызван (спай); `analyzeSections` → `timeout` → `sections.failure
  'timeout'`, вердикт маршрута записан; `analyzeSections` бросает → `failure 'error'`, задача не падает (RC-10);
  основной поток `unreadable` → `sections: null`; `requeue` после `failed` → `sections: null` до нового итога.
- Int `route-ride-auto.int.test.ts`: `passed` по длинному маршруту → у автозаезда `sections`; не пройден → второго
  потока нет (спай), заезда нет; прежние кейсы зелёные.
- Int `route-rides.int.test.ts` (деталь): ключи участка — явный список; два своих заезда → `isBest`/`deltaToBestSec`;
  заезд с удалённой активностью не участвует; заезд **другого райдера** по тому же маршруту не влияет (8.3); старый
  документ без `sections` → `sections: []`; статус `queued`/`failed` → `[]`.
- `pnpm arch:check`; typecheck `@pokatim/tracks`, `@pokatim/contracts`, `@pokatim/api`, `@pokatim/api-client`.

**ПОРЯДОК (TDD, коммиты)**
1. `tracks`: `sections.ts` — тесты разбиения красные → `routeSections`/`sectionLine` → коммит.
2. `tracks`: `analyzeSections` — тесты красные → реализация; бенч; регрессия golden → коммит.
3. API: `PARSE_FUNCTIONS` + `parse-thread.test.ts` → коммит.
4. Контракты: `RouteRideSection`, `RouteRideDetail.sections` + тест схемы (api-client — тест разбора старого ответа) →
   коммит.
5. API данные и эвалюатор: `RouteRideSectionsDoc`, `RouteRideResult.sections`, `cleared`, `newRideDoc`,
   `evaluate(…, { sections })`, процессоры; хелперы `test/route-rides.ts`; int check/auto → коммит. Полный `pnpm check`
   после шага 5 (`TURBO_CONCURRENCY=4`).
6. `sectionsOf` (unit) → `detail.sections` + int деталь → коммит.
7. Документация (§10) → коммит; полный `pnpm check`.

**OUT OF SCOPE**
PR B (приложение: блок «Участки» в `RideView`, форматирование, i18n `routes.rides.result.sections*`, тесты
компонентов); метки км на карте; участки в «Других» и в списке `RouteRideRow`; рейтинги участков; ручная разметка,
подъёмы; бэкфилл/перепроверка старых заездов; изменения движка, `CORRIDOR_ENGINE_VERSION`, golden, `results`;
миграции и индексы; лёгкий вход `@pokatim/tracks` (`index.ts`); `@rkarakulov/*`.

## 12. Outcome (заполняет coder)

PR A реализован (ветка `feature/route-rides-sections-api`, не запушена). Приложение — PR B.

- **tracks:** `corridor/sections.ts` (`ROUTE_SECTIONS_VERSION`, `ROUTE_SECTION_POLICY`, `routeSections`,
  `sectionLine`), `parse.ts` — `analyzeSections`, `RouteSectionResult`, `RouteSectionsAnalysis`, экспорт только из
  серверного входа (сторож лёгкого входа дополнен). Движок, golden, `CORRIDOR_ENGINE_VERSION` — без изменений
  (`git diff --stat origin/develop -- …/{match,prepare,project,policy,types}.ts …/__fixtures__` пуст).
- **API:** `PARSE_FUNCTIONS` + `analyzeSections`; `RouteRideEvaluator.evaluate(ride, { sections })` (+
  `analyzeSections` — точка подмены), процессоры `always`/`ifPassed`; `RouteRideSectionsDoc`,
  `RouteRideResult.sections`, `cleared`/`newRideDoc`/`emptyResult` — `sections: null`; `sectionsOf` и
  `detail.sections`. Хелперы `longCorridorRoute`, `longGeometry`, `longRideGpx` (`apps/api/test/route-rides.ts`).
- **Контракты/api-client:** `ROUTE_RIDE_SECTION_STATUSES`, `ROUTE_RIDE_SECTIONS_MAX`, `RouteRideSection`,
  `RouteRideDetail.sections` `.default([])`; тест разбора старого ответа в api-client.
- **Документация:** `routes.md` (U1, RC-3/RC-4, «до 05 участков нет», ограничение Q1), правила `pokatim-backend`,
  `-db`, `-contracts`, `-tests`; `pr.md`.
- **Отклонения:** §8.2 (D1–D4; Q1 решён вариантом (a) — участок, линия которого возвращается к своим воротам,
  сливается; у «туда-обратно» по одной дороге участков нет).

Проверки (2026-11-01, локально, node 24, Mongo `pokatim_rr05_test`, Redis db 9):

- `@pokatim/tracks` vitest — 29 файлов / 401 тест (после Q1) зелёные (бенч `analyzeSections 200 км × 50k: 383–405 мс`);
  `@pokatim/contracts` — 524; `@pokatim/api-client` — 188.
- `@pokatim/api` vitest: `src/modules/route-rides`, `src/parse-thread.test.ts`, `src/modules/achievements`,
  `src/modules/account`, `results-check.int`, `results-attempts.int` — 22 файла / 348 тестов зелёные.
- typecheck `@pokatim/tracks`, `@pokatim/contracts`, `@pokatim/api-client`, `@pokatim/api`, `@pokatim/app` — 0 ошибок
  (`home.test.tsx` — `showRouteRides: false` в фикстуре профиля, красный typecheck develop; `sections` — D3);
  jest `home.test.tsx` — 46 зелёные; после Q1 `src/modules/route-rides` + `parse-thread` — 8 файлов / 111 тестов. jest приложения по
  файлам с `route-rides-fixtures` — 7 наборов / 155 тестов зелёные.
- `pnpm format:check` — чисто; `eslint` затронутых пакетов `--max-warnings=0` — 0; `pnpm arch:check` — нарушений нет.
- Полный `pnpm check` — не гонялся (решение оркестратора); CI — после push.
