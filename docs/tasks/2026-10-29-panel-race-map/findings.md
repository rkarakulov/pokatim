# Findings — panel-race-map

## pass 1 — Claude independent-reviewer — REQUEST CHANGES

| # | Уровень | Где | Суть | Статус |
|---|---|---|---|---|
| HIGH-1 | HIGH | `RaceEditor.map.test.tsx:113` | буквальный неразрывный пробел в регулярке — `no-irregular-whitespace`, `pnpm check` красный | исправлено (` `) |
| LOW-1 | LOW | `RaceEditor.map.test.tsx` | тест блока не проверяет маркер карты при скраббинге | принято без теста: маркер по стору — `RouteMap.test.tsx`, у блока один стор |
| LOW-2 | LOW | `RaceCorridorMap.tsx` | одна ошибка обновления — два баннера (поле и блок) | решение D7 в task.md §8.2 |

## pass 1 — Codex — APPROVE

Подтверждённых находок нет (`codex-findings.md`).
