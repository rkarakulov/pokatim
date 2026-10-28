## Карточка-приглашение кофе-райда (4a/4b) — ADR-0018

Задача: `docs/tasks/2026-10-28-ride-invite-card/task.md` (task2).

### Что сделано

- **API** — `GET /v1/rides/:rideId/invite-card?template=line|night`: `AuthGuard`, `no-store`, ответ `StoryCardStatus`.
  - Скрытый или неизвестный райд — 404 (и для организатора). Не будущий — 409 `STORY_CARD_UNAVAILABLE`.
  - Рендер в worker: задача `ride-invite.render` в очереди `story-card`. Кэш, лимиты и PNG по токену
    (`/v1/story-cards/:file`) — общие со сторис гонки. Поток статуса вынесен в `CardRequests`.
- **Данные** — порт `rides` `RIDES_FOR_SHARING`, только публичные поля райда.
  - Линия маршрута рисуется, только если маршрут сейчас в каталоге (`RideRoutes.catalogLine`).
  - Свой маршрут организатора (`private`) на картинку не попадает.
  - Организатора, участников и описания на картинке нет.
- **Шаблоны:** `line` = 4b «карточка-линия», `night` = 4a без фото. Цвета и шрифты — активной темы.
- **Приложение:**
  - экран `rides/invite/[id]` (внутри `Stack.Protected`);
  - кнопка «Карточка-приглашение» на детали будущего райда;
  - общая панель карточки вынесена в `features/sharing` — экран сторис гонки работает на ней без изменений.
- **Документация:** ADR-0018 (дополнение), правила `.claude/rules/pokatim-{backend,security,app}.md`,
  `docs/product/rides.md`.

### Проверки

- `TURBO_CONCURRENCY=1 pnpm check` — зелёный (pre-push).
- int-тесты: `ride-invite.int.test.ts` — права, PNG, линия только из каталога, worker `skipped`/`failed`, логи без ПДн.
- unit: тексты, хэш, разметка, диспетчер процессора.
- app: `ride-invite.test.tsx` и `story-card.test.tsx`; web-smoke маршрута без сессии.
- Ревью:
  - Claude independent — APPROVE;
  - Codex — pass 1 REQUEST CHANGES (исправлено), pass 2 APPROVE (MEDIUM исправлен).
  - Findings — в папке задачи.
- NOT VERIFIED: ручная проверка на симуляторе iOS/Android.

### Follow-ups

- Фото организатора на 4a (`media`).
- Шит «Райд опубликован».
- OG-картинка райда.
- Флаки `bottom-sheet.test.tsx` (L1) и `avatar-image.test.ts` (48 Мп, таймаут 5 с под нагрузкой) — к задаче отношения
  не имеют.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
