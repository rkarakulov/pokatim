# Достижения: карточка сторис для сезонных

Задача — `docs/tasks/2026-10-31-achievement-season-story-card/task.md` (C1–C5, RC-1…RC-11 приняты по рекомендации
архитектора). Follow-up `achievements-seasonal` (S7).

## Что сделано

- **Контракты:** `AchievementStoryCardQuery` (`template` + `seasonId?: Uuid`, `strictObject`) для
  `GET /v1/achievements/:code/story-card`; общий `StoryCardQuery` гонки, райда и маршрута не расширен. Ответ и коды
  ошибок прежние.
- **API:** сверка «код ↔ `seasonId`» до лимита: сезонный без `seasonId` — 400 `seasonId:REQUIRED`, несезонный с ним —
  `seasonId:INVALID`. Порт `ACHIEVEMENTS_FOR_SHARING.cardFacts(userId, ref)` принимает адрес `AchievementCardRef`
  (`cardRef` — одна функция для HTTP и worker). Сезонная ветка: выдача `(userId, code, seasonId)` не отозвана, исход
  сезона — `RIDER_SEASON_STANDINGS.outcomesOf` напрямую; ручная выдача — при любом исходе, иначе только `final` и
  заработана сейчас. `pending` без ручной, чужой и незнакомый сезон — 409. Сбой порта сезонов — 500 (worker — ретрай),
  не 409. `manuallyGranted` вынесен в `achievements.policy.ts`.
- **Граф модулей (RC-1):** `AchievementsReadModule` += `StandingsCoreModule`; `sharing` по-прежнему получает только
  `AchievementsReadModule`. Циклов нет.
- **Рендер:** значки трёх сезонных кодов (`calendar_month`, `military_tech`, `emoji_events` — зеркало каталога
  приложения), `ACHIEVEMENT_BADGE_ICONS: Record<AchievementCode, …>`; условие «Сезона в зачёте» — с
  `SEASON_REGULAR_MIN_RACES`. Хэш входов не менялся: сезон уже в нём (`object.id`, название), несезонные карточки не
  перерисовываются. `renderVersion` остался 3. Задача `achievement-card.render` += `seasonId` (без поля → `null`).
- **api-client:** `getAchievementCard(token, code, AchievementStoryCardQuery)`.
- **Приложение:** сезонные `storyCard: true`; «Поделиться» на экране и во вспышке (перед «К сезону») →
  `/achievements/story/<code>?season=<id>`; ключ статуса `['achievements','story',code,seasonId,template]`;
  сезонный код без валидного `season` — «Карточки нет» без запроса, у несезонного `season` игнорируется.
- **Документы:** `profile.md` (S7, RC-2), ADR-0018 и ADR-0020 (дополнения),
  `.claude/rules/pokatim-{backend,security,contracts,app}.md`.

## Миграции, env, выкладка

Миграций, коллекций, очередей и env нет. Старые сборки шлют только `template` — несезонные запросы валидны как раньше.
Новый web + старый API: сезонная карточка получит 400 до выкладки API (на dev выкатываются вместе, RC-11).

## Проверки

- `pnpm check` (Mongo/Redis тестового стенда) — зелёный.
- Превью `pnpm --filter @pokatim/api preview:story-cards <каталог>` — три сезонных значка в обоих шаблонах.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
