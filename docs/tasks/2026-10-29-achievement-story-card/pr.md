# Карточка для сторис «Достижение»

Задача: `docs/tasks/2026-10-29-achievement-story-card/task.md` (task2). ADR-0018 — дополнение «Карточка достижения».

## Что сделано

- **API:** `GET /v1/achievements/:code/story-card?template=line|night` (`AuthGuard`, `no-store`, `StoryCardStatus`) —
  только своё полученное достижение (факт есть и выдача не отозвана), иначе 409 `STORY_CARD_UNAVAILABLE`; код вне
  каталога — 400. Рендер — задача `achievement-card.render` в очереди `story-card` (satori + resvg, PNG 1080×1920 в
  Redis по капабилити-токену, общие лимиты и кэш).
- **Картинка:** метка, значок «Эмаль» (глиф Material Symbols — тот же шрифт, что иконки приложения на Android/web),
  название и условие, объект (гонка и райд по названию, маршрут — только из каталога), дата факта, имя — по согласию;
  шаблоны «Линия»/«Ночь» в теме владельца.
- **achievements:** `AchievementFactsReader` (вынос из `AchievementsService` без смены поведения),
  `AchievementsReadModule`, порт `ACHIEVEMENTS_FOR_SHARING` (только чтение).
- **Приложение:** экран `/achievements/story/<code>` на общем `CardPanel` (iOS/Android/web одним кодом); на экране
  достижения — «Поделиться» (карточка, все коды) и «Сторис результата» (гоночные); во вспышке — «Поделиться» →
  карточка достижения.
- Пакеты: токены `storyCard.achievement*`, `storyCardBadgeColors`; строки `achievementCard.*`; api-client
  `getAchievementCard`.

## Миграции, env, конфиги

- Миграций и env нет. Новая зависимость `apps/api`: `@expo-google-fonts/material-symbols` (шрифт иконок, ~1 МБ в
  образе api).

## Проверки

- `TURBO_CONCURRENCY=1 pnpm check`: format, lint, arch, typecheck, тесты пакетов и приложения — зелёные; api — 2001/2004,
  три падения в не связанных файлах (`track-uploads`, `results-revisions`, `standings-sync`: таймауты/ECONNRESET под
  нагрузкой параллельных сессий), при отдельном прогоне — 75/75 зелёные.
- Ревью: Codex — APPROVE без находок; Claude — APPROVE, три LOW приняты (task.md «Ревью pass 1»).

## Не проверено

- Шеринг на устройствах (iOS/Android системный лист, web Share API) и вид экрана в браузере — NOT VERIFIED (покрыто
  jest-тестами; превью PNG проверены визуально через `preview:story-cards`).
