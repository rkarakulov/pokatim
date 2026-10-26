# Ревью: fix-app-smoke-2026-10-27

## Проход 1 — claude independent-reviewer (коммит 3b7867c): REQUEST CHANGES

| # | Уровень | Находка | Решение |
|---|---|---|---|
| H1 | HIGH | B13: явный `staleTime: 0` в участии, кандидатах, спорах и `me` райда перекрывает `defaultOptions` — фокус по-прежнему перезапрашивал их; тест проверял только `createQueryClient` | Исправлено: `DEFAULT_STALE_MS` в этих хуках; тест AC8 на экране `races/[id]` (`focusManager`), падает без фикса. Список устройств — явно `staleTime: 0` (возврат из окна авторизации) |
| M1 | MEDIUM | B5: скелетон гостю на `closed`/`final`, где блока у гостя не будет — сдвиг вверх | Исправлено: скелетон только при `guestCanSeeEnter`; тест «закрыта — без скелетона» |
| L1 | LOW | `/ui-kit` в production — 200 с экраном «не найдено» (soft-404) | Принято, task.md §8.1 D-LOW |
| L2 | LOW | `pokatim.noSession` без срока: потерянный ответ входа после выдачи cookie — перезагрузка покажет гостя | Принято, task.md §8.1 D-LOW (повторный вход заменит cookie) |

Также вне ревью: `+not-found` получил `generateMetadata` (заголовок вкладки и `noindex`) — найдено проверкой production-сборки.

## Проход 2 — claude independent-reviewer (коммит c0d9ea1): APPROVE

H1 и M1 закрыты, решения по LOW обоснованы, новых находок нет. Ревьюер прогнал jest всего `apps/app` (947 тестов),
`tsc` и `eslint` по изменённым файлам. Наблюдение без дефекта: `DEFAULT_STALE_MS` распространяется и на `['health']`
экрана `/status` — посев SSR 10 с считается свежим.
