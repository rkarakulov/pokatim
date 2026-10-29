## Карта гонки с коридором в панели (panel-race-map)

Follow-up `docs/product/routes.md`: на странице гонки с сохранённым коридором (черновик, опубликованная, отменённая) —
секция «Карта гонки» под формой: карта MapLibre с линией и коридором ±допуск (слой `routeLayers` из
`@pokatim/route-view`, как в приложении), цифры и профиль высоты со скраббингом.

- `RouteMap` — проп `corridorWidthM` (слой коридора; смена допуска пересоздаёт карту); без него — как раньше.
- `RouteLine` / `RouteReadyView` — проброс коридора, подпись карты с допуском, `headingLevel`; копий блока нет.
- `features/races/RaceCorridorMap.tsx` — состояния: скелетон, ошибка с повтором, баннер ошибки обновления; без env
  стиля — `LinePreview`. `OpenRouteLink` вынесен из `RoutePreview`.
- i18n `admin.races.map.*`; доки: `pokatim-web.md`, `admin-panel.md`, `routes.md`; task: `docs/tasks/2026-10-29-panel-race-map/`.
- Тесты: `RouteMap.test.tsx` (слой коридора), `RaceEditor.map.test.tsx` (блок и состояния), e2e `races.spec.ts`
  (карта гонки после создания).

Миграций, env, контрактов, CSP — нет.

Проверки: `pnpm check` — зелёный; `ADMIN_BASE=/admin/ pnpm --filter @pokatim/admin build` — проходит. Ревью: Codex
APPROVE, Claude — HIGH-1 исправлен (findings.md).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
