## «Свои», P1: группа уведомлений `social`

Второй PR эпика «Свои» (`docs/tasks/2026-10-31-social-stage-0/task.md`, строка P1). Спек — `docs/tasks/2026-10-31-social-p1-notifications/task.md`. Продукт — `social.md` K10/K13, `notifications.md`; ADR-0027 п. 6. Привязка событий `social.*` к intake — P7.

- **Contracts:** группа `social` (седьмая, после «Достижений»), шесть видов `social_*`, цель `rider` (`/riders/<publicId>`) — в конец перечислений (старые сборки → `unknown`). Подресурс `GET|PUT /v1/notifications/settings/social` (только push, по умолчанию включено, без наследования).
- **API `notifications`:** документ хранит `actors` и `params` (без имён); `title/body` и цель `rider` собираются при чтении списка (один `publicRiders` на страницу) и при отправке push (на момент отправки, в т.ч. после тихих часов); нет публичного профиля / удалён — «Райдер». Схлопывание по K10 (на райд / в сутки по Минску / на цель в сутки) — условный upsert с накоплением лиц (потолок 100), повтор того же лица ничего не меняет, гонка — один документ. Push — только при создании уведомления. Точка входа для P7 — `socialNoticeDraft`. Сбой запроса имён в push — запасной текст «Райдер».
- **Миграций нет** (окно ложится на существующий уникальный индекс схлопывания).
- **Приложение:** строка «Свои» последней в «Настройках уведомлений», цель `rider` → профиль; service worker — цель `rider`.
- **Документы:** `notifications.md` (N3 тексты, N4, N7, N10–N12), ADR-0027, ADR-0017, правила `pokatim-backend/db/contracts/security/app.md`.

### Проверки
- `pnpm check` (`TURBO_CONCURRENCY=4`): format/lint/arch/typecheck зелёные; api 2716, app 2584, admin 520 тестов passed; тайминговые бенчмарки tracks и 3 файла api вне diff краснели только под нагрузкой машины — отдельно зелёные.
- int на Mongo: подресурс, накопление и гонка (отрицательные доказательства без `$ne` и без повтора после дубля), имена при чтении и в push, тихие часы, стирание.
- Ревью: independent-reviewer pass 1 — APPROVE (MEDIUM — сбой имён в push оставлял `sending`, исправлен с тестом); pass 2 — APPROVE.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
