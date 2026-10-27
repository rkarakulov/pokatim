# Findings — routes-04c-one-finger — pass 1 — reviewer: claude
base: origin/develop   commits: 13e8d49..9ba34ac (working tree чистый)
verdict: APPROVE

## Проверено

- `pnpm exec jest maps routes races route-detail my-routes race-route-map` (Node 24.22.1) — 31 suites, 341 tests passed.
- `pnpm exec tsc --noEmit` (apps/app) — без ошибок.
- Web-колесо (`map-wheel.web.ts`): maplibre-gl 6.16.0 вешает `wheel` (`{passive: false}`) на `getCanvasContainer()`
  (`src/ui/handler_manager.ts:227,276`) — это потомок `container`, поэтому слушатель в фазе перехвата на `container`
  срабатывает раньше и `stopPropagation` не пускает событие к `scrollZoom`; `passive: true` без `preventDefault` —
  страница прокручивается. Ctrl/⌘ (и щипок тачпада Chrome/Firefox — `wheel` с `ctrlKey`) проходит, `scrollZoom`
  сам делает `preventDefault` (браузерный зум не срабатывает). Снятие — `removeEventListener` с тем же `capture`;
  таймер подсказки сбрасывается на каждом событии и чистится при размонтировании. `touch_pan.ts:34` подтверждает
  связку `cooperativeGestures` → `minTouches = 2`.
- SSR: `useId` (`scope`) был и до изменения; подсказка рендерится только после клиентского события `wheel`,
  `isMacPlatform()` вызывается лишь при `wheelHint === true` — клиентских значений в серверной разметке нет.
- Native: `@maplibre/maplibre-react-native` 11.5.0, `MLRNMapView.kt:614–621` — `requestDisallowInterceptTouchEvent(true)`
  при `scrollEnabled` (= `dragPan`) уже на `ACTION_DOWN` — `ScrollView`/`RefreshControl` не перехватят жест, начатый
  на карте. `Camera` `minZoom`/`maxZoom` сохранены.
- Маркер скраббинга: `scrub-overlay` и внутренний вид `ScrubMarker` — `pointerEvents: 'box-none'`, мимо маркера касание
  уходит карте (соседний вид ниже). Web-маркер — `pointerEvents: 'auto'` только у точки.
- Удаление `map-gestures.ts`, `map-gesture-lock.tsx`, `maps.gestures.touch`: ссылок в `apps/`, `packages/`,
  `.claude/` не осталось. `route-detail` — `scrollEnabled = useScrubScrollEnabled(scrub)`; `race-detail` и
  `my-route-detail` — без скраббинга, `scrollEnabled` убран корректно.
- Тесты не тавтологичны: тест снятия слушателя падал бы при утечке (захватывающий `stopPropagation` на старом узле
  `canvas` не дал бы сработать целевому слушателю нового потомка); тест без модификатора проверяет и
  `defaultPrevented === false`, и недоход до внутреннего слушателя.
- Documentation Sync: ADR-0014 (поправка), `.claude/rules/pokatim-app.md`, `docs/product/routes.md`,
  `races-and-seasons.md` соответствуют коду.

## Findings

### [LOW] pr.md: в «Проверки» нет результата `pnpm check`
- **file:** docs/tasks/2026-10-27-routes-04c-one-finger/pr.md
- **location:** раздел «Проверки»
- **problem:** вместо результата стоит «см. отчёт ветки», а task.md («Проверки») обещает «результат в `pr.md`».
- **why_it_matters:** в описании PR нет evidence зелёного `pnpm check`; ревьюер PR не видит, что именно прогонялось.
- **evidence:** `- \`TURBO_CONCURRENCY=1 pnpm check\` (Node 24, изолированные Mongo/Redis) — см. отчёт ветки.`
- **recommended_fix:** перед открытием PR вписать фактический итог (`pnpm check` — passed, числа тестов) в pr.md.

### [LOW] Android: касание карты вторым пальцем во время перетаскивания маркера отменяет жест маркера
- **file:** apps/app/src/features/maps/route-map.tsx
- **location:** `<lib.Map dragPan …>` + `ScrubMarker` (RNGH `usePanGesture`)
- **problem:** `MLRNMapView` при касании зовёт `requestDisallowInterceptTouchEvent(true)`; корень RNGH на Android в
  ответ отменяет активные RNGH-жесты. Если при перетаскивании маркера второй палец ляжет на карту, жест маркера
  прервётся (`onFinalize` снимет `dragging`).
- **why_it_matters:** редкий сценарий, данных не теряет — маркер остаётся в последней позиции; отметка для ручной
  проверки на устройстве.
- **evidence:** `MLRNMapView.kt:617–618`; поведение RNGH root helper — NOT VERIFIED на устройстве.
- **recommended_fix:** ничего в коде; добавить пункт в ручную проверку NOT VERIFIED (маркер + второй палец на карте).

## NOT VERIFIED

- iOS: приоритет распознавателей `MLNMapView` над панорамой `UIScrollView` — по исходникам не проверить, только на
  устройстве (заявлено в task.md).
- Safari macOS: щипок тачпада приходит `gesture*`-событиями, а не `wheel` с `ctrlKey` — зум щипком там может не
  работать (поведение не изменилось относительно routes-04b; ручная проверка после выката).
