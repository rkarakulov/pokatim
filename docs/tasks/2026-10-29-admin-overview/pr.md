# admin-overview: раздел «Обзор» панели

task: `docs/tasks/2026-10-29-admin-overview/task.md`

## Что сделано

- **API** `GET /v1/admin/overview` — модуль-композиция `overview` (как `riders`): контроллер под `PanelGuard` без
  права на маршруте, блоки режет сервис по правам сотрудника; блок без права не отдаётся (поля нет).
  Счётчики — порты-классы модулей-владельцев через `index.ts` (`DisputesOverview`, `RacesOverview`, `ResultsOverview`,
  `RidesOverview`, `RoutesOverview`, `ProfilesOverview`, `IdentityOverview`, `TracksOverview`, `CalendarOverview`),
  фильтры — те же, что у очередей разделов.
- **Право** `platform.stats` (только admin) — KPI и зависшие удаления аккаунтов.
- **Миграция** `0036_overview_indexes` (expand-only): `users_created_at_idx`, `track_uploads_created_at_idx`.
  0035 занят «Достижениями».
- **Панель**: «Требует внимания» (карточки со ссылками в разделы, ноль — «Всё разобрано»), «Сейчас идёт» (гонки с
  открытым окном — участники, попытки; ближайшие старты календаря; организатор — только свои гонки), «Платформа» (KPI
  strip), статус API внизу. Состояния — §4.12.
- Документы: `docs/product/admin-panel.md` (право, описание «Обзора», карта разделов), `.claude/rules/pokatim-backend.md`.

## Проверки

- `pnpm check` — зелёный локально (свой Mongo replset, Redis db 1 на временном redis-server).
- Int `apps/api/test/overview.int.test.ts` — 7 тестов (роли, свои/чужие гонки, фазы, блокеры, очереди, KPI, календарь);
  миграции; экран — 12 тестов.

## Ревью

independent-reviewer: pass 1 — APPROVE (0/0/2/4), фиксы MEDIUM и части LOW; pass 2 — см. `task.md` §12.

## Follow-up

- Экран сбоев удаления аккаунтов (F13) — пока карточка-счётчик без ссылки.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
