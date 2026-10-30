Карточка маршрута для сторис и выбор «Карточка / Ссылка» в «Поделиться»

## Что

- Story-карточка 9:16 (1080×1920) маршрута каталога: «Маршрут», название, «Город · Круговой», линия маршрута, дистанция и набор, бренд. Шаблоны «Линия» и «Ночь», тема — того, кто создаёт. Без автора; линия — только каталожная (`catalogLine`).
- API: `GET /v1/routes/:routeId/story-card?template=line|night` (`AuthGuard`, `no-store`) → `StoryCardStatus`; только `IN_CATALOG`, иначе `404`. Тот же конвейер (`CardRequests`, очередь `story-card`, задача `route-card.render`, лимиты, `GET /v1/story-cards/:file`). Контракты, миграции и env без изменений.
- Приложение: «Поделиться» на маршруте и кофе-райде открывает шит «Карточка для сторис / Ссылка» (общий `ShareChoiceSheet`). Гостю — сразу ссылка, без origin — сразу карточка. Отдельная кнопка «Карточка-приглашение» на детали райда убрана, «Райд опубликован» — на общем шите. Новый экран `/routes/story/<id>` (под входом, `SEO_DISALLOW`).
- Рендер: `statRow`/`cardTrackView` вынесены из приглашения в `story-card.render.ts`; картинка приглашения байт-в-байт прежняя (снимок sha256 дерева; ревьюер сверил со старым кодом), `renderVersion` прежних карточек не тронут.

Задача: `docs/tasks/2026-10-30-route-story-card/task.md`.

## Проверки

- `pnpm check` (изолированные Mongo/Redis): всё зелёное, кроме флака `tracks/track-uploads.int.test.ts` (отдельно 34/34). sharing — 200/200.
- Ревью: Claude independent-reviewer — APPROVE (3 LOW: два исправлены, третий — правила ниже); Codex — APPROVE (2 MEDIUM — см. follow-up).
- Не проверено: `pnpm e2e:web` локально (в CI), iOS/Android.

## Follow-up

- Нужен OK пользователя: `.claude/rules/pokatim-app.md:326-327` (кнопка «Карточка-приглашение» устарела), `pokatim-backend.md`/`pokatim-security.md` — карточка маршрута в разделе story-cards.
- Все экраны карточек (`/rides/invite`, `/achievements/story`, `/races/story`, `/routes/story`): ключ запроса без темы (после смены темы до 10 с может показать PNG прежней темы); нет `robots: noindex` в мете (только `Disallow`). Общий паттерн, чинить вместе.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
