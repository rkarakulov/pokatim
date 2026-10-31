Админка: тесты под нагрузкой — общий срок findBy/waitFor 15 с, testTimeout 60 с

## Что

- Причина флаков админки в pre-push (PR #163: `SeasonScreen` ×4 — `Unable to find` за 1 с; `RaceEditor.corridor` —
  `Test timed out in 5000ms`): тесты на заглушках `api`, условия наступают всегда, но сроки RTL (1 с) и Vitest (5 с)
  настенные. Под нагрузкой `pnpm check` тест панели в 10–20 раз медленнее, чем в простое (0,3 → 5–7 с).
- `apps/admin/src/test/setup.ts` — `configure({ asyncUtilTimeout: 15_000 })` (как `CONDITION_WAIT` api, #152);
  `vite.config.ts` — `testTimeout`/`hookTimeout` 60 с.
- Сняты локальные `{ timeout: 3000/4000/5000 }` и `10_000` (check-in, сотрудники, ряды спора); `vi.waitFor` (свой срок
  1 с) → `waitFor` RTL в `OverviewScreen` и `query-client`.
- Правило `pokatim-tests.md` — сроки админки, `vi.waitFor`, `shouldAdvanceTime`.

Причина, замеры до/после: `docs/tasks/2026-10-31-admin-flaky-under-load/task.md`.

## Проверки

- 4 параллельных прогона админки (load 45–65): до — 4/4 красные (2–9 падений); после — 12/12 зелёные (3 раунда).
- `pnpm check` (изолированные Mongo/Redis, `TURBO_CONCURRENCY=4`) — зелёный на финальном HEAD (admin 511, api 2604).
- Ревью: Codex pass 1 — APPROVE без находок; Claude independent-reviewer — APPROVE (MEDIUM `vi.waitFor`, LOW правило —
  исправлены).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
