# Findings — route-rides-05 (PR A) — разбор ревью pass 1

Ревьюеры: Codex (`codex-findings.md`) и Claude independent-reviewer — оба APPROVE, блокирующих находок нет. LOW
исправлены, кроме LOW-2 (записан follow-up).

| # | Источник | Находка | Что сделано |
|---|---|---|---|
| 1 | Codex LOW | Документация обещала «у туда-обратно участков нет», а разворот ровно на границе участка (2 × 20 км) даёт 4 участка | Тест `sections.test.ts` «2 × 20 км: разворот на границе — 4 участка, ни один не проходит у своих ворот» фиксирует поведение. Формулировка уточнена в `docs/product/routes.md`, task.md §8.2 Q1, `pr.md`, JSDoc `routeSections`, `pokatim-backend.md`: участков нет, только если последовательные слияния оставляют меньше двух; разворот на границе — участки есть |
| 2 | Claude LOW-1 | JSDoc версии не говорил, что смена ширины коридора заезда меняет границы | JSDoc `ROUTE_SECTIONS_VERSION` и `ROUTE_SECTION_POLICY`: смена `ROUTE_RIDE_POLICY.corridorWidthM` → +1 версии |
| 3 | Claude LOW-2 | Повторный расчёт chainage в `ungated`/`sectionLine` | Не исправлялось (по решению оркестратора): follow-up в task.md §12 |
| 4 | Claude LOW-3 | Бенч на 20 участках, не на пределе 30 | Бенч — 300 км (30 участков) × 50 000 точек, замер 527–561 мс, бюджет 8 с = `ADVERSARIAL_TIME_LIMIT_MS` (1100/5000 мс флакали под конкуренцией полного `pnpm check`); task.md §8.2 D2 |

Проверки после правок — task.md §12.
