# Маршруты 04c: карта двигается одним пальцем

## Что

Решение пользователя: «двигать карту 2 пальцами очень неудобно, давай сделаем одним». Поправка routes-04c к
дополнению ADR-0014 (routes-04b).

- **Native** (MapLibre RN 11.5): нативные жесты карты — `dragPan`, `touchZoom`, двойной тап (выкл при reduce
  motion); вращение, наклон, `doubleTapHoldZoom` выключены. Касание карты забирает жест у прокрутки карточки
  (Android `requestDisallowInterceptTouchEvent` в `MLRNMapView.onTouchEvent`), вне карты экран прокручивается.
  Удалены RNGH-оверлей двухпальцевого пана/щипка (`map-gestures.ts`), блокировка прокрутки (`MapGestureLockContext`)
  и математика жестов. Маркер скраббинга по-прежнему тащится одним пальцем по нему самому.
- **Web** (`maplibre-gl` 6): `cooperativeGestures` выключен — мышь и один палец тащат карту; колесо — зум только с
  Ctrl/⌘, без модификатора — прокрутка страницы и подсказка (`map-wheel.web.ts`: слушатель `wheel` в фазе
  перехвата, без `preventDefault`).
- Кнопки «+», «−», «в рамку», зум 2–17, reduce motion кнопок — без изменений.
- docs: ADR-0014 (поправка), `pokatim-app.md`, `docs/product/routes.md`, `races-and-seasons.md`.

## Проверки

- `TURBO_CONCURRENCY=1 pnpm check` (Node 24, изолированные Mongo/Redis) — см. отчёт ветки.

## NOT VERIFIED

- Один палец на карте внутри `ScrollView` на iOS/Android, щипок, двойной тап, перетаскивание маркера — вручную в
  dev-клиенте.
- Мобильный Safari/Chrome (один палец — карта, вне — прокрутка), Ctrl/⌘ + колесо и щипок тачпада — вручную после
  выката.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
