# route-rides-06: граница участка в точке разворота

Продолжение route-rides-05. Задача — `docs/tasks/2026-11-01-route-rides-06-turnaround/task.md`.

## Что сделано

- **Участки у «туда-обратно».** Точка разворота по той же дороге (и самая дальняя точка петли с близкими концами)
  становится границей участка; шаг 10 км и хвост раскладываются в каждом плече: 2 × 17 км → 0–10, 10–17, 17–27,
  27–34 км. Разворот ближе 5 км к старту/финишу/другому развороту или граница сверх 30 участков — прежнее слияние.
- **Chainage один раз** в `routeSections` (`sectionLineOn`), ревью LOW-2 route-rides-05.
- **`ROUTE_SECTIONS_VERSION = 2`.** Старые участки (версия 1) не пересчитываются и не сравниваются с новыми.

Движок коридора, golden, `CORRIDOR_ENGINE_VERSION`, API, контракты, приложение — без изменений.

## Миграции / env / конфиги

Нет.

## Проверки

- `@pokatim/tracks` vitest (в т. ч. `analyzeSections` на проезде 2 × 17 км — все участки засчитаны), `@pokatim/api`
  route-rides + parse-thread (111), tsc, eslint, prettier — зелёные.
- Ревью: Claude independent-reviewer — APPROVE (MEDIUM и LOW исправлены), Codex — HIGH исправлен (`findings.md`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
