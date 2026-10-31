# Findings — route-rides-04-others-app (PR B) — разбор ревью

base: origin/develop   commits: 03d7eaa8..9477b7b7   ревьюеры: codex (`codex-findings-b.md`), claude
Исправлено в `a84a650a`; CRITICAL/HIGH нет.

| ID | Источник | Суть | Решение |
|---|---|---|---|
| M1 | codex, claude | `useBestRideChange`: «не загружено» и «лучшего нет» — оба `undefined`; первый пройденный заезд (`best: null → {id}`) не инвалидировал таблицу «Другие» на карточке (RC-B6) | Исправлено: `undefined` — только не загружено, `null` — нет лучшего или 404; инвалидация `leaderboardAll` при `null → id`, `id → null`, `id → id'`; первая загрузка — не смена |
| M2 | claude | Нет теста смены лучшего опросом на карточке | Исправлено: тест «опрос `best: null → {id}` → перезапрос `limit 5`» и «первая загрузка с лучшим — без перезапроса» (`route-ride-others.test.tsx`) |
| M (focus) | codex | `useRouteRideLeaderboard` без `subscribed`: возврат на экран (стек, профиль райдера) не обновлял устаревшую таблицу — `focusManager` следит только за `AppState` | Исправлено: `subscribed: useIsFocused()`, как `useRouteRides`; JSDoc. Тест: полный список → профиль → `DEFAULT_STALE_MS` → назад → второй запрос (без `subscribed` — красный) |
| L1 | claude | `task-b.md`: пути task/pr указывали на несуществующую `…-others-app/` | Исправлено: `docs/tasks/2026-10-31-route-rides-04-others/{task-b.md,pr-b.md}` |
| L2 | claude | Сноска «Показаны лучшие N из M» — N без своей строки, показанной отдельно, а `othersTruncated` её учитывает | Исправлено: `othersShown` (строки + своя вне `rows`) — N сноски и основа `othersTruncated`; тесты формата и экрана (101 из 240 / 100 из 240) |

Проверки: typecheck `@pokatim/app` — 0; jest 7 наборов (route-ride-others, route-detail, profile-screen,
route-rides-block, route-ride, features/route-rides) — 171 тест, зелёные; eslint, prettier изменённых — чисто.
NOT VERIFIED: полный `pnpm check`, e2e, устройства.
