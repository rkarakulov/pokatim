# Findings — race-results-08-season-standings — pass 1 — reviewer: codex
base: origin/develop   commits: cd19a21..d2efb00
verdict: APPROVE

### [MEDIUM] Ответы панели наследуют tolerant enum вместо строгих справочников

- **file:** packages/contracts/src/standings/standings.schema.ts
- **location:** 124–136, `PanelSeasonStandingsSummary`, `PanelSeasonStandingRow`, `PanelSeasonStandingsTable`
- **problem:** Схемы панели наследуют `tolerantEnum` для класса, группы и исхода ячейки. Неизвестные значения принимаются и превращаются в `unknown`.
- **why_it_matters:** Нарушено правило `.claude/rules/pokatim-contracts.md`: ответы панели используют строгий `z.enum`. Ошибочный ответ API проходит клиентскую валидацию с потерей исходного значения.
- **evidence:** Прямой вызов схем подтвердил: `future-class`, `future-group`, `future-outcome` успешно разбираются как `unknown`. Тест «панель: строгие справочники» проверяет отклонение только неизвестного `sync`.
- **recommended_fix:** В схемах панели переопределить класс, группу и исход ячейки строгими enum, включая вложенные `tables` и `cells`. Добавить проверки отклонения неизвестных значений; публичные схемы оставить tolerant.

Проверки: contracts — **315/315 passed**; `git diff --check` — успешно. **NOT VERIFIED:** тесты API и api-client остановились при загрузке конфигурации из-за `EPERM` при записи `.vite-temp` в read-only окружении. Полный `pnpm check` и интеграционные тесты независимо не подтверждены.