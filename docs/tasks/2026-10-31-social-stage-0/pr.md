## «Свои», этап 0 — P0: каркас социального слоя

Первый PR эпика из восьми (`docs/tasks/2026-10-31-social-stage-0/task.md`, таблица P0–P7). Продукт — `docs/product/social.md` (K1–K14), архитектура — ADR-0027. Эндпоинтов и экранов нет.

- **Миграция `0045_social`** (expand-only): `rider_connections`, `ride_attendance`, `social_reactions`, `invite_codes`, `product_events` и индексы. Номер `0045` — после `0043_achievements_seasonal` и `0044_route_rides_passed_idx` из develop (перенумерована при слиянии develop).
- **Модуль `product-events`** (листовой): `PRODUCT_EVENTS.record`, закрытый справочник K12, `props` без id пользователей; шаг стирания `product-events`.
- **Модуль `social`** (ядро): связи (ручные с лимитом 30/24 ч, тихое удаление-надгробие, `invite`), явка (документ на райд, отметка и пересчёт связей в одной транзакции), реакции (`thanks`, `respect`), `SocialErasure`. Очереди `social-intake`, `social-maintenance` — только имена.
- **`rides`**: порт `RIDES_FOR_SOCIAL.rideFacts`.
- **Удаление аккаунта**: шаги `social` и `product-events` после `tickets`, до `notifications`. `ERASURE_STEPS` — строгий `z.enum`: панель деплоится вместе с API.
- **Документы**: ADR-0027, `profile.md`, `rides.md`, `notifications.md` («Свои» — седьмая группа, после «Достижений»), `home.md`, правила `pokatim-backend/db/contracts.md`, dependency-cruiser (`product-events-leaf`, `social-consumers-only`).

### Проверки
- `TURBO_CONCURRENCY=1 pnpm check` — зелёный (api 2450 тестов, admin 489).
- int: миграция, связи, явка (гонка двух отметок — отрицательное доказательство «документ на райдера»), реакции, стирание; `arch:check` — отрицательные доказательства трёх запрещённых импортов.
- Ревью: Claude independent-reviewer pass 1 — APPROVE; MEDIUM (надгробие при гонке «Убрать» ↔ снятие явки) исправлен с тестом и отрицательным доказательством.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
