# task.md — route-rides-05 (B): участки маршрута в приложении

Уровень: task3 (шаг 3 из 3 этапа 2, вторая половина). Продукт — `docs/product/routes.md` («Этап 2», U1–U4). PR A
(разбиение, сверка участков, `sectionsOf`, контракт `RouteRideDetail.sections`) — `feature/route-rides-sections-api`,
task — `docs/tasks/2026-10-31-route-rides-05-segments/task.md` (§3 п. 9 — U4, §8 «сумму не показывать», §8.2 Q1).
Этот PR — **B**, ветка `feature/route-rides-sections-app` от `develop` **после слияния PR A** (типы
`RouteRideSection`, фикстура `sections: []` — D3 PR A). Выкладка PR A на dev до мержа B — желательна для ручной
проверки, но не обязательна: `sections` в контракте `.default([])` → со старым API блока просто нет.
Файл задачи в репозитории — `docs/tasks/2026-10-31-route-rides-05-segments/task-b.md`.

## 1. Title

«Участки» на экране результата заезда по маршруту: время каждого участка, зачёт участков при непройденном маршруте,
сравнение участков со своим лучшим.

## 2. Goal

API отдаёт участки заезда (PR A), но райдер их не видит: проехал 70 из 90 км — на экране только «Не пройден». Нужно
показать участки на экране результата `/routes/rides/<routeId>/<rideId>` (каталог и `?mine=1`): какие пройдены, за
сколько, лучшее ли это время участка и сколько до лучшего — во всех статусах, где участки есть, и на всех платформах.

## 3. Scope

Решения architect (`[ASSUMPTION]`, подтверждены кодом — §5.1, уточнения — §8.1):

1. **Блок «Участки»** в `RideView` (`features/route-rides/route-ride-detail.tsx`) — после строк сравнения
   (`routeRideComparisonLines`) и до «Ваш заезд». Отдельный компонент `RouteRideSections` (новый файл).
2. **Когда виден.** Только `ride.sections.length > 0` и статус не «проверка идёт» (`isPendingCheck`). Пустой массив —
   блока нет, без подписей и пустого состояния: причины «нет участков» (маршрут < 15 км, «туда-обратно» Q1, > 30,
   отказ второго потока, `implausible`, заезд до route-rides-05, старый API, `queued`/`checking`/`failed`) клиенту
   неразличимы и не должны угадываться (RC-1).
3. **Шапка блока.** `Kicker` «Участки»; строка «Пройдено участков: {passed} из {count}» (подсчёт статусов из ответа —
   показ, не вычисление результата); пояснение мелким текстом: «Время участков не складывается во время маршрута:
   края у границ участков не входят ни в один из них.» (RC-2, RC-3).
4. **Строка участка** (по порядку ответа, без сортировки клиентом) — заголовок «Участок {n} · {from}–{to} км» (км с
   десятыми, `n` — позиция в массиве с 1); дальше по статусу:
   - `passed` — время (`textStyle('time')`, `formatElapsed`); `isBest` — `Pill` «Лучший» (accent); иначе при
     `deltaToBestSec !== null` — «К лучшему: +0:12» (`formatDeltaSec`, существующий ключ `toBest`);
   - `not_passed` — «Не пройден» (вторичным цветом, без красной пилюли — RC-4); при `bestElapsedSec !== null` —
     «Лучшее время: 18:04»;
   - `unknown` (сервер новее) — «Статус неизвестен» нейтрально, без времени и сравнения.
   Строки не нажимаются (перехода нет); каждая — один элемент скринридера с меткой из видимых частей.
5. **Запрещено показывать** сумму времён участков, средний темп/скорость участка (время без краёв у границ → длина
   `toM − fromM` не соответствует времени), «прошлый» по участкам, места среди других, км-метки на карте.
6. **`not_passed` с зачтёнными участками** — главный сценарий: вердикт и причина как сейчас, «Лучший: …» маршрута как
   сейчас, ниже блок «Участки» с временем пройденных участков.
7. **Терминология.** Текст `routes.rides.track.unavailable` «Разметка участков для этого заезда недоступна» (про
   разметку трека на карте) → «Разметка трека для этого заезда недоступна», чтобы «участки» значили одно (RC-5).
8. **Все платформы (§4.13)** — iOS, Android, web/PWA; общий RN-компонент, без развилок. Крупный шрифт — строки
   переносятся (`flexWrap`, без фиксированных ширин и `numberOfLines` у времени/подписи). **i18n** — `packages/i18n`.

## 4. Out of Scope

- Изменения API/контрактов/api-client (PR A). Если понадобится отличать «нет участков» от «не посчитались» — стоп,
  отдельный PR A-fix (RC-1, вариант b).
- Участки в «Моих заездах» (`RouteRideRow`), в «Других», на карте (метки км, подсветка участка, нажатие на строку →
  карта), рейтинги участков, «к предыдущему» по участкам, бэкфилл/подпись «у старых заездов участков нет», ручная
  разметка, подъёмы, уведомления.
- Новые адреса, запросы и ключи кэша (участки приходят в существующей детали).

## 5. Architecture Context

Всё — `apps/app` (+ ключи `packages/i18n`, доки/правила). Экран результата —
`app/routes/rides/[routeId]/[rideId].tsx` → `RouteRideScreen` → `RideView` (`features/route-rides/route-ride-detail.tsx`).
Деталь — `useRouteRide` (ключ `['route-rides', routeId, 'ride', rideId]`, опрос до финала 3 с / 15 с), `sections` —
поле той же детали: свежесть, pull-to-refresh, офлайн-баннер, ошибки — уже есть. Данные — только сервер (§4.1):
статус участка, время, `isBest`, `bestElapsedSec`, `deltaToBestSec` — из ответа; клиент не сравнивает и не ранжирует.
Зависимости фич не меняются (`route-rides/*` → `routes/format` — уже разрешено правилом).

## 5.1 Placement & Reuse Gate

Architect, 2026-11-01 (сверено с `origin/develop` @ `d9363922` и веткой PR A @ `3a640a4e`).

**Placement.** Новых пакетов, модулей, фич, адресов и запросов нет.

| Что | Где | Слой |
|---|---|---|
| Формат участка (заголовок, км, время/статус, сравнение, a11y), видимость блока, «Пройдено N из M» | `features/route-rides/route-ride-format.ts` (`routeRideSectionsShown`, `routeRideSectionView`, `routeRideSectionsSummary`) | pure |
| Блок «Участки» | **новый** `features/route-rides/route-ride-sections.tsx` (`RouteRideSections`) | component |
| Встраивание | `features/route-rides/route-ride-detail.tsx` (`RideView`) | screen |
| Км с десятыми | `features/routes/format.ts` — экспорт существующего `km` (RC-6) | pure |
| Тексты | `packages/i18n/src/ru.ts` | i18n |
| Фикстура | `__tests__/route-rides-fixtures.ts` (`rideSection`) | test |

**Reuse (обязательно) / запрещённые дубли.**

- Статус участка — `routeRideStatusPill(status).label` / ключи `routes.rides.status.{passed,not_passed,unknown}`
  (подмножество статусов заезда, те же тексты); «Лучший» — `t('races.attempt.best')` в `Pill tone="accent"` (как у
  вердикта и «Моих заездов»).
- Время — `formatElapsed` (`@pokatim/i18n`); дельта — `formatDeltaSec` (`route-ride-format.ts`, знак сервера, U+2212,
  0 → «0:00»); «К лучшему» — существующий ключ `routes.rides.result.toBest`.
- Км — `formatKm` (`@pokatim/i18n`, до одного знака) от `km()` из `features/routes/format.ts` (то же округление до
  0,1 км, что `routeKm` у «Дистанция по маршруту») — свою формулу округления не писать.
- Склейка a11y — `meta` (`lib/minsk-format.ts`), как `routeRideRowView`.
- Раскладка строки — как `RouteRideRowItem` в `route-rides-block.tsx` (`borderTopColor: theme.border.subtle`,
  `stroke`, `space`), тексты — `textStyle('label' | 'time' | 'body' | 'meta')`, цвета — `theme.text.{primary,secondary}`.
  `TableRow` из `races/table-row.tsx` не нужен (строка без действия и без «кто») — достаточно `View accessible`.
- `Kicker`, `Pill` — `@rkarakulov/ui`. Новых компонентов/токенов дизайн-системы не нужно.
- Запрещено: сумма/темп/скорость участков, сравнение/сортировка/«лучший» на клиенте, эвристика «участков нет, хотя
  маршрут ≥ 15 км» по `routeDistanceM` (дубль политики U1 на клиенте), новый запрос/ключ, `Platform.OS`, hex/px.

## 6. Relevant Files

- Контракт: `packages/contracts/src/route-rides/route-ride.schema.ts` (`RouteRideSection`,
  `ROUTE_RIDE_SECTION_STATUSES`, `ROUTE_RIDE_SECTIONS_MAX`, `RouteRideDetail.sections`).
- Экран: `apps/app/src/features/route-rides/{route-ride-detail.tsx,route-ride-format.ts,route-ride-format.test.ts,
  route-rides-block.tsx,queries.ts}`, `apps/app/src/app/routes/rides/[routeId]/[rideId].tsx`.
- Форматы: `apps/app/src/features/routes/format.ts` (`km`, `routeKm`), `packages/i18n/src/format.ts` (`formatKm`),
  `apps/app/src/lib/minsk-format.ts` (`meta`), `apps/app/src/lib/countdown.ts`.
- Тесты-образцы: `apps/app/src/__tests__/{route-ride.test.tsx,route-rides-fixtures.ts}`.
- Правила/доки: `.claude/rules/{app.md,pokatim-app.md}` («Заезд по маршруту»), `pokatim-tests.md`,
  `docs/product/routes.md` (U1–U4).

## 7. Implementation Notes

Contracts-first выполнен (PR A). TDD, отдельный коммит на шаг. Jest — только затронутые наборы; полный `pnpm check`
(`TURBO_CONCURRENCY=4`) — перед PR (по правилу группы задач). Ветка — от `develop` после слияния PR A.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` Место блока (после сравнения, до «Ваш заезд»), строка «Пройдено участков», текст пояснения,
  «Не пройден» без пилюли, «Лучшее время» у непройденного, переименование текста разметки трека.
- Неразличимость «нет участков» / «не посчитались» / «старый заезд» — принята (RC-1); если продукт захочет подпись
  для старых заездов — PR A-fix с полем состояния.
- Длинный список (до 30 строк) в `ScrollView` экрана — статичный, без виртуализации; карта после блока уходит ниже
  (RC-7).
- Конфликтов с параллельными ветками в `route-ride-detail.tsx` не видно (04 B его не трогал); `ru.ts` и
  `pokatim-app.md` — общие, конфликт текстовый, низкий.

## 8.1 Requirements Consistency (заполняет architect)

Блокеров нет. Конфликтов с инвариантами AGENTS §4 нет (серверный авторитет, §4.11–4.13). Уточнения по коду
(рекомендация — (a), по умолчанию coder идёт по ней):

- **RC-1 — «нет участков», «failure», старые заезды.** Контракт отдаёт только `sections: []` во всех случаях
  (`failure` участков наружу не выходит — 8.3 PR A; `queued/checking/failed` → `[]`; заезд до 05 и старый API →
  `.default([])`). (a) **рекомендация:** пустой массив → блока нет, без текста (U4 «нет участков — блока нет»);
  (b) PR A-fix: `sectionsState: 'none' | 'unavailable'` в детали и подпись «Участки для этого заезда не посчитались» —
  отдельная задача, если продукт попросит; (c) угадывать по `routeDistanceM ≥ 15 км` и показывать «Участков нет» —
  отклонено: дубль политики U1 на клиенте, ложь для «туда-обратно» (Q1) и > 30 участков.
- **RC-2 — сумма времён.** У границ ≈ 100 м ворот не входят ни в один участок (PR A §8). (a) **рекомендация:** суммы
  нет нигде (ни строкой, ни в a11y), плюс короткое пояснение под заголовком, чтобы райдер не складывал сам и не
  считал расхождение ошибкой; (b) без пояснения — вопросы «почему не сходится»; (c) пояснение по кнопке «i» —
  нужен шит/тултип, которого нет в системе. Тот же довод запрещает темп/скорость участка.
- **RC-3 — «Пройдено участков: N из M».** Подсчёт `status === 'passed'` по ответу — представление, не результат
  (§4.1 соблюдён). (a) **рекомендация:** показывать всегда, когда блок виден (для `not_passed` — ключевая цифра
  прогресса, для `passed` — стабильная раскладка; «из M» — без склонений); (b) только у `not_passed`; (c) не
  показывать — у 20 участков прогресс не считывается глазом.
- **RC-4 — вид непройденного участка.** У `not_passed`-заезда могут быть до 29 непройденных строк. (a)
  **рекомендация:** «Не пройден» текстом `theme.text.secondary`, без `Pill tone="error"` (пилюля вердикта уже красная;
  стена красных пилюль прячет пройденные); пройденный — время крупно (`textStyle('time')`); (b) пилюли
  «Пройден»/«Не пройден» у каждой строки, как в «Моих заездах» — шумно; (c) скрывать непройденные — теряется
  `bestElapsedSec` и картина маршрута.
- **RC-5 — коллизия слова «участок».** Сейчас `routes.rides.track.unavailable` = «Разметка участков для этого заезда
  недоступна» (разметка сегмента/схода на карте), а причина гонок `missed_section` = «Пропущен участок маршрута».
  (a) **рекомендация:** переименовать только `routes.rides.track.unavailable` → «Разметка трека для этого заезда
  недоступна» (ключ только заездов по маршруту, правка ожидания в `route-ride-format.test.ts`); причину гонок и гоночный
  `races.detail.myTrack.unavailable` («…для этой попытки») не трогать (экран гонки, участков там нет); (b) ничего не менять — две разные «разметки
  участков» на одном экране; (c) переименовать и причину — задевает гонки, вне задачи.
- **RC-6 — км участка.** `fromM/toM` — целые метры; 24 999 → «25», 15 000 → «15». (a) **рекомендация:** экспорт
  существующего `const km` из `features/routes/format.ts` (переименовать при экспорте не нужно; JSDoc «метры → км с
  десятыми») + `formatKm` из `@pokatim/i18n`, ключ `'{from}–{to} км'` (en dash, как в диапазонах дат); (b) локальная
  копия `Math.round(m / 100) / 10` — дубль; (c) `routeKm` дважды («0 км–10 км») — неестественно.
- **RC-7 — место блока и длина.** (a) **рекомендация:** после сравнения, до «Ваш заезд» и карты (U4 «после
  сравнения»; участки — часть результата, данные трека — справка); до 30 строк — обычный `View` в `ScrollView`
  экрана; (b) после карты — участки, главный новый результат `not_passed`, уходят за экран; (c) сворачивать после
  N строк («Показать все») — лишнее состояние при ≤ 30 коротких строк.
- **RC-8 — нумерация.** В контракте номера нет. (a) **рекомендация:** `n = index + 1` в порядке ответа (сервер отдаёт
  по `fromM`); клиент не сортирует; (b) сортировать по `fromM` — «чинит» сервер, не нужно.
- **RC-9 — `isBest` vs `deltaToBestSec === 0`.** Ничья по времени: лучший — более ранний заезд (`compareRides`), у
  этого `isBest: false`, `delta 0`. (a) **рекомендация:** «Лучший» только по `isBest`; иначе «К лучшему: 0:00» — как
  у маршрута (`routeRideComparisonLines`); (b) считать `delta === 0` лучшим — клиент решает за сервер.
- **RC-10 — e2e.** Нового адреса нет; e2e-стек не создаёт маршрутов ≥ 15 км и проверенных заездов (фикстуры 8 км),
  поэтому деталь в смоуке — `sections: []`. (a) **рекомендация:** без новых e2e-шагов (существующий шаг «результат
  заезда без сессии — гард» остаётся); покрытие — компонентные тесты + ручная проверка на dev после выкладки PR A
  (маршрут каталога ≥ 15 км, заезд с остановкой посередине); (b) засеять в e2e длинный маршрут и заезд через worker —
  тяжело и медленно, ценность низкая для чисто презентационного блока.

## 8.2 Deviations from spec

Все `[ASSUMPTION]` §8 и RC-1…RC-10 — по рекомендациям (a) (решение оркестратора). Отклонения — только в примерах:

- **Время — «0:18:04», не «18:04».** Обязательный reuse `formatElapsed` (`@pokatim/i18n`) всегда даёт `ч:мм:сс`; так же
  выглядит время маршрута и «Лучший: 2:04:37». Свой формат «мм:сс» для участков не заводился. Дельта
  (`formatDeltaSec`) — «+0:12», как в спеке.
- **`failed` с непустым `sections`** — по формуле §11 (`sections.length > 0 && !isPendingCheck`) блок был бы показан;
  сервер у `failed` отдаёт `[]` (PR A), поэтому компонентный тест «сбой — блока нет» использует ответ сервера, а не
  искусственный `failed` с участками. Видимость по статусу `failed` клиент не дублирует.

## 8.3 Security checklist

Зона — `pokatim-security.md` «Заезд по маршруту»: новых данных, запросов, входов и логов нет — чек-лист короткий.

- **AuthN/AuthZ.** Экран уже в `Stack.Protected`, деталь — `withAccessToken`, только свой заезд (сервер); участки
  сравниваются только со своими заездами (сервер, PR A 8.3).
- **Данные наружу.** Показываются только поля `RouteRideSection` (метры по маршруту, статус, время, сравнение) — без
  координат; ничего из участков — в `console.*`, Sentry-контекст, URL, `localStorage`, `DocumentTitle`.
- **Кэш.** Та же деталь в TanStack Query под `['route-rides', …]` (стирается при выходе), без persist.
- **Серверный авторитет.** Клиент ничего не присылает и не вычисляет (кроме подсчёта статусов для подписи).

## 9. Acceptance Criteria

1. Заезд с участками (`passed` или `not_passed`): на экране результата после строк сравнения — блок «Участки»:
   «Пройдено участков: N из M», пояснение, строки «Участок n · a–b км» по порядку ответа.
2. Пройденный участок — время; лучший — «Лучший»; не лучший — «К лучшему: +m:ss» из `deltaToBestSec` сервера.
3. Непройденный участок — «Не пройден» и, если сервер отдал, «Лучшее время: …»; незнакомый статус — «Статус
   неизвестен».
4. `not_passed` с зачтёнными участками — вердикт и причина как раньше, ниже участки с временем пройденных.
5. `sections: []`, проверка идёт, `failed`, старый API — блока нет, остальное экрана без изменений.
6. Суммы времён участков, темпа и скорости участка нет нигде (включая подписи a11y).
7. Каждая строка — один элемент скринридера с меткой из видимых частей; крупный шрифт — без обрезки; тема светлая и
   тёмная — только роли.
8. «Разметка трека для этого заезда недоступна» вместо «Разметка участков…».
9. iOS, Android, web/PWA; тесты, lint, typecheck, сторож тем зелёные; CI зелёный.

## 10. Documentation Impact

- `docs/product/routes.md` — U1–U4: «Приложение — PR B» → сделано (блок «Участки» на экране результата: время,
  «Лучший», «К лучшему», «Пройдено N из M», пояснение про сумму; пустой список — блока нет).
- `.claude/rules/pokatim-app.md` — «Заезд по маршруту», абзац route-rides-05 (PR B): блок `route-ride-sections.tsx`
  в `RideView` после сравнения; виден только при `sections.length > 0` и не во время проверки; суммы/темпа нет;
  «лучший»/дельта — только сервер; без нового запроса.
- `docs/tasks/2026-10-31-route-rides-05-segments/task-b.md` (этот файл, §8.2/§12), `pr-b.md`.
- ADR не нужен.

## 11. Implementation Context (заполняет architect)

Status: **APPROVED** (уточнения — §8.1 RC-1…RC-10; блокеров нет; условие старта — PR A в `develop`).

### ENTRY POINTS

- `/routes/rides/<routeId>/<rideId>[?mine=1]` → `RouteRideRoute` → `RouteRideScreen` → `AsyncContent` → `RideView` →
  `RouteRideSections` (после `routeRideComparisonLines`, до `Kicker` «Ваш заезд»).
- Данные — `useRouteRide(routeId, rideId, valid).data.sections` (без новых запросов).

### FILES TO MODIFY

- `packages/i18n/src/ru.ts` — в группе `routes.rides.result.*` (комментарий `// route-rides-05: участки`):
  `routes.rides.result.sections` «Участки»; `routes.rides.result.sectionsPassed` «Пройдено участков: {passed} из
  {count}»; `routes.rides.result.sectionsHint` «Время участков не складывается во время маршрута: края у границ
  участков не входят ни в один из них.»; `routes.rides.result.section` «Участок {n} · {from}–{to} км»;
  `routes.rides.result.sectionBest` «Лучшее время: {time}». Правка: `routes.rides.track.unavailable` → «Разметка
  трека для этого заезда недоступна».
- `apps/app/src/features/routes/format.ts` — `export const km` (+ JSDoc).
- `apps/app/src/features/route-rides/route-ride-format.ts` — `routeRideSectionsShown(detail)` (`sections.length > 0
  && !isPendingCheck(status)`); `routeRideSectionsSummary(sections)` → строка `sectionsPassed`;
  `routeRideSectionView(section, index)` → `RouteRideSectionView`.
- **новый** `apps/app/src/features/route-rides/route-ride-sections.tsx` — `RouteRideSections({ sections })`:
  `View testID="route-ride-sections"` (`gap: space.s3`) → `Kicker` `sections` → сводка (`textStyle('body')`, primary) →
  пояснение (`textStyle('meta')`, secondary) → строки: `View accessible accessibilityLabel={view.a11y}
  testID={\`route-ride-section-${n}\`}` (`borderTopWidth: stroke.*`, `borderTopColor: theme.border.subtle`,
  `paddingTop`/`gap` — `space`), внутри: заголовок (`label`), ряд `flexDirection: 'row', flexWrap: 'wrap'` — время
  (`time`) или статус (`body`, secondary) + `Pill` «Лучший»; строка сравнения (`meta`, secondary). JSDoc: «сумма времён
  не показывается (ворота у границ), «лучший» и дельта — только сервер».
- `apps/app/src/features/route-rides/route-ride-detail.tsx` — в `RideView`: `{routeRideSectionsShown(ride) ?
  <RouteRideSections sections={ride.sections} /> : null}` после строк сравнения; doc-комментарий `RouteRideScreen`
  (+ «участки, route-rides-05»).
- `apps/app/src/__tests__/route-rides-fixtures.ts` — `rideSection(overrides)` (по умолчанию `{ fromM: 0, toM:
  10_000, status: 'passed', elapsedSec: 1_084, isBest: true, bestElapsedSec: 1_084, deltaToBestSec: 0 }`);
  `rideDetail` — `sections: []` уже есть (D3 PR A).
- Доки/правила — §10 (последний коммит).

### FILES TO READ

`AGENTS.md` §4 (1, 11–13); `.claude/rules/{app.md,pokatim-app.md}` («Заезд по маршруту»), `pokatim-tests.md`;
`features/route-rides/{route-ride-detail.tsx,route-ride-format.ts,route-rides-block.tsx}`; `features/routes/format.ts`;
`__tests__/route-ride.test.tsx`; PR A task §3 п. 9, §8 (сумма), §8.2 Q1, §11 TYPES; контракт `RouteRideSection`.

### TYPES & SCHEMAS

Только существующие (PR A): `RouteRideSection { fromM, toM, status: 'passed'|'not_passed'|'unknown', elapsedSec,
isBest, bestElapsedSec, deltaToBestSec }`, `RouteRideDetail.sections` (≤ `ROUTE_RIDE_SECTIONS_MAX`). Новых схем нет.

```ts
// route-ride-format.ts
export interface RouteRideSectionView {
  /** «Участок 2 · 10–20 км» */
  title: string;
  /** время — только у `passed` */
  time: string | null;
  /** «Не пройден» / «Статус неизвестен» — когда времени нет */
  status: string | null;
  /** «Лучший» — только по `isBest` сервера */
  best: boolean;
  /** «К лучшему: +0:12» (`passed`, не лучший) или «Лучшее время: 18:04» (`not_passed`) */
  comparison: string | null;
  /** `meta([title, time ?? status, best ? «Лучший» : null, comparison])` */
  a11y: string;
}
export const routeRideSectionsShown = (detail: RouteRideDetail): boolean;
export function routeRideSectionsSummary(sections: readonly RouteRideSection[]): string;
export function routeRideSectionView(section: RouteRideSection, index: number): RouteRideSectionView;
// features/routes/format.ts
export const km: (distanceM: number) => number;
```

### TESTS

Unit (jest) — `features/route-rides/route-ride-format.test.ts`:
- `routeRideSectionView`: `passed` + `isBest` — время, `best: true`, `comparison: null`; `passed`, `delta 12` —
  «К лучшему: +0:12»; `passed`, `isBest false`, `delta 0` — «К лучшему: 0:00», `best: false` (RC-9); `not_passed` с
  `bestElapsedSec` — «Не пройден», «Лучшее время: …», `time: null`; `not_passed` без лучшего — `comparison: null`;
  `unknown` — «Статус неизвестен», без сравнения; заголовок: `0–10 000` → «Участок 1 · 0–10 км», `10 000–24 999` →
  «… 10–25 км», `index` → номер; `a11y` — из видимых частей.
- `routeRideSectionsSummary`: 2 из 3 (`unknown` не считается пройденным); `routeRideSectionsShown`: `[]` → false;
  `queued`/`checking` с участками → false; `passed`/`not_passed` → true.
- `routes/format` — `km(24_999) === 25`, `km(48_612) === 48.6` (если тестов `routeKm` нет рядом — в
  `route-ride-format.test.ts`).

Компонентные (`__tests__/route-ride.test.tsx`, автомок `api`, фикстуры `rideDetail`/`rideSection`):
- `passed` с тремя участками (лучший, `delta 42`, `not_passed` с лучшим временем) — блок «Участки» после «Это ваш
  лучший заезд» и до «Ваш заезд» (порядок по дереву), «Пройдено участков: 2 из 3», пояснение, строки с текстами и
  `accessibilityLabel`; суммы времён двух пройденных (`formatElapsed(a + b)`) на экране нет.
- `not_passed` (причина) с первым пройденным участком — вердикт, причина, «Лучший: …» маршрута и участок 1 со временем,
  участки 2–3 «Не пройден».
- `sections: []` (`passed`) — нет `route-ride-sections` и текста «Участки»; `failed` — нет блока; `checking` с
  участками в ответе — нет блока, после финала (опрос) — появился.
- Незнакомый статус участка (`'x'` через разбор схемы → `'unknown'`) — «Статус неизвестен».
- Старый ответ без поля `sections` (разбор `RouteRideDetail.parse`) — экран без блока, без ошибок.
- `route-ride-format.test.ts` (`routeRideTrackLines`) — ожидание текста «Разметка трека…» (RC-5); гоночный
  `my-track-format.test.ts` не меняется.
- Сторожа: `theme-guards.test.ts` (без hex/примитивов), набор i18n (`pnpm --filter @pokatim/i18n test`).

E2E — без новых шагов (RC-10). Ручная проверка (после выкладки PR A на dev): маршрут каталога ≥ 15 км, свой заезд
полный и с остановкой посередине — iOS (dev client), Android, web мобильный и десктопный; крупный шрифт (iOS Dynamic
Type / Android font scale), VoiceOver/TalkBack — строка читается целиком; тёмная тема.

Порядок шагов (TDD, коммит на шаг; после шага — jest затронутых наборов, typecheck `@pokatim/app`):
1. i18n-ключи + `km` + форматтеры `route-ride-format.ts` (unit, красный → зелёный); RC-5 текст и его тесты.
2. `route-ride-sections.tsx` + встраивание в `RideView` + фикстура `rideSection` (компонентные).
3. Доки/правила (§10), `pr-b.md`; полный `pnpm check` (`TURBO_CONCURRENCY=4`) перед PR.

### OUT OF SCOPE

API/контракты/api-client; поле состояния участков (RC-1 b — PR A-fix по запросу продукта); участки в «Моих
заездах», «Других», на карте; нажатие на участок; «к предыдущему» по участкам; сумма/темп/скорость; рейтинги;
новые адреса, запросы, ключи кэша; e2e-засев длинных маршрутов; `@rkarakulov/*`.

## 12. Outcome (заполняет coder)

Коммиты (ветка `feature/route-rides-sections-app`, от PR A):

1. `route-rides-05 B: форматтеры участков, км с десятыми, тексты; «Разметка трека…» (RC-5)` — ключи
   `routes.rides.result.{sections,sectionsPassed,sectionsHint,section,sectionBest}`, правка
   `routes.rides.track.unavailable`; `export const km` (`routes/format.ts`); `routeRideSectionsShown`,
   `routeRideSectionsSummary`, `routeRideSectionView` (`route-ride-format.ts`); фикстура `rideSection`; unit-тесты.
2. `route-rides-05 B: блок «Участки» на экране результата заезда` — `route-ride-sections.tsx`, встраивание в
   `RideView`; 7 компонентных тестов (`__tests__/route-ride.test.tsx`).
3. Доки: `docs/product/routes.md` (U1–U4 — приложение сделано), `.claude/rules/pokatim-app.md` (абзац route-rides-05
   PR B), этот файл, `pr-b.md`.

Проверки (таргетные, полный `pnpm check` и e2e — не гонялись по решению оркестратора):

- `jest src/__tests__/route-ride src/__tests__/theme-guards src/features/route-rides src/features/routes/format.test.ts
  src/__tests__/i18n` → 9 suites, 163 tests passed; `my-track-format.test.ts` (гонки) — 6 passed, не менялся.
- `tsc --noEmit` (`@pokatim/app`) → OK; `pnpm --filter @pokatim/i18n test` → 16 passed.
- `eslint --max-warnings=0` и `prettier --check` по затронутым файлам → OK; `pnpm arch:check` → no dependency violations.
- Ручная проверка iOS/Android/web, крупный шрифт, VoiceOver/TalkBack, тёмная тема — **NOT VERIFIED** (нужна выкладка
  PR A на dev и маршрут ≥ 15 км).
