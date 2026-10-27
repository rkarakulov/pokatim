# routes-04c — карта одним пальцем

Уровень: task2. Ветка `feature/routes-04c-one-finger` от `develop` (после routes-04b, PR #59).

## Цель

Решение пользователя 2026-10-27: «двигать карту 2 пальцами очень неудобно, давай сделаем одним». Интерактивная карта
(`RouteMap`: карточка маршрута, «Мой маршрут», карта гонки) двигается одним пальцем на native и web; прокрутка
страницы вне карты остаётся.

## Решение

- **Native** — нативные жесты MapLibre RN 11.5 вместо RNGH-оверлея: `dragPan`, `touchZoom`, `doubleTapZoom` (при
  reduce motion выключен — анимация нативная), `doubleTapHoldZoom`/`touchRotate`/`touchPitch` выключены; зум 2–17 —
  `Camera` `minZoom`/`maxZoom` (ограничивает и жесты). Проверено по исходникам `node_modules`:
  `MLRNMapView.onTouchEvent` (Android) при `dragPan` зовёт `requestDisallowInterceptTouchEvent(true)` — `ScrollView`
  не перехватывает жест, начатый на карте; вне карты экран прокручивается. iOS — `scrollEnabled`/`zoomEnabled`
  `MLNMapView`, распознаватели карты глубже `UIScrollView`. Камера для маркера скраббинга — по-прежнему
  `onRegionIsChanging`/`onRegionDidChange`. Маркер — вид над картой: касание маркера — его RNGH-жест, мимо
  (`box-none`) — карте.
- **Удалено:** `map-gestures.ts` (пан/щипок двумя пальцами, двойной тап RNGH), `map-gesture-lock.tsx`
  (`MapGestureLockContext`, `useMapGestureLock`) и их использование на трёх экранах — блокировку прокрутки на время
  жеста карты делает натив; математика жестов `cameraAfterGesture`/`zoomAround` (`map-camera.ts`); `cameraCall` и
  `MapViewSnapshot` перенесены в `map-camera.ts`; i18n `maps.gestures.touch`. Прокрутку `route-detail` по-прежнему
  выключает скраббинг (`useScrubScrollEnabled`).
- **Web** — `cooperativeGestures: false`, `dragPan: true`: мышь и один палец тащат карту. maplibre-gl 6 связывает
  колесо с тачем в кооперативном режиме (`touch_pan`: `minTouches = 2`, пока режим включён), поэтому — свой минимальный
  обработчик (`map-wheel.web.ts`, `guardWheelZoom`): `wheel` в фазе перехвата на контейнере карты, без Ctrl/⌘ —
  `stopPropagation` (до `scrollZoom` не доходит), без `preventDefault` (страница прокручивается) и подсказка «Чтобы
  изменить масштаб, крутите колесо с Ctrl» (⌘ на Mac) на `WHEEL_HINT_MS` = 1,5 с; с Ctrl/⌘ — штатный `scrollZoom`
  вокруг курсора. Блокировки прокрутки на web нет.
- Без изменений: кнопки «+», «−», «в рамку», зум 2–17, reduce motion кнопок, вращение/наклон выключены.

## Изменения

- `apps/app/src/features/maps/route-map.tsx`, `route-map.web.tsx`, `map-camera.ts`, `map-locale.web.ts`,
  новый `map-wheel.web.ts`; удалены `map-gestures.ts`, `map-gesture-lock.tsx`.
- Экраны: `races/race-detail.tsx`, `routes/route-detail.tsx`, `routes/my-route-detail.tsx`.
- `packages/i18n/src/ru.ts` — удалён `maps.gestures.touch`.
- Тесты: `route-map-gestures.test.tsx` (нативные пропсы, без RNGH-оверлея, камера от `regionIsChanging`, reduce
  motion), `route-map-scrub.test.tsx` (маркер перетаскивается одним пальцем — без изменений сценария),
  `route-map.web.test.tsx` (без кооперативного режима; колесо без модификатора / с Ctrl / с ⌘; подсказка гаснет;
  снятие слушателя), `map-camera.test.ts`, экранные `race-route-map`, `route-detail`, `my-routes`.
- Документация: ADR-0014 (поправка routes-04c), `.claude/rules/pokatim-app.md`, `docs/product/routes.md`,
  `docs/product/races-and-seasons.md`.

## Проверки

- `pnpm check` (Node 24, изолированные Mongo/Redis, `TURBO_CONCURRENCY=1`) — результат в `pr.md`.

## NOT VERIFIED

- Поведение на устройстве: один палец на карте внутри `ScrollView` двигает карту (iOS, Android), вне карты —
  прокрутка; щипок и двойной тап; перетаскивание маркера скраббинга поверх карты — вручную в dev-клиенте.
- Мобильный браузер (Safari/Chrome): один палец двигает карту, вне карты — прокрутка; Ctrl/⌘ + колесо и щипок
  тачпада на десктопе — вручную после выката (в CI карты нет: стиля в смоуке нет).
- Двойной тап на native при reduce motion выключен (анимацией нативного двойного тапа не управлять) — продуктовое
  допущение; приближение — кнопкой «+».
