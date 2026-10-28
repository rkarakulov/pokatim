# story-cards: карточки для сторис из своего результата гонки

Задача: `docs/tasks/2026-10-28-story-cards/task.md`, ADR-0018.

## Что меняется

- **Приложение:** «Поделиться в сторис» в блоке «Ваше участие» и на экране «Ваш результат». Свою строку таблицы
  теперь можно нажать, переход сохраняет группу вкладки. Новый экран `races/story/[id]`:
  - шаблоны «Линия» и «Ночь»;
  - скелетон, пока карточка готовится (опрос раз в 1 с, не дольше 30 с), ошибка с повтором, пустое состояние на 409;
  - шаринг: native — `expo-sharing` (системный лист: сохранение в фото, Instagram Stories), web — Web Share API
    с файлом, иначе скачивание PNG.
- **API:**
  - новый модуль `sharing`: `GET /v1/races/:raceId/entry/story-card?template=line|night` отвечает
    `pending | ready{token} | failed`; `GET /v1/story-cards/<token>.png` — capability-URL, PNG живёт в Redis 24 ч;
  - рендер — satori + resvg в worker, очередь `story-card`; цвета и гарнитуры берутся из активной темы.
- **Приватность:** имя на карточке — только с согласием (`RIDER_NAMES`). Линия — только отрезок своей попытки между
  воротами гонки или публичная линия маршрута; точек до старта нет.
- **Контракты:** новая схема `story-card`, поле `MyRaceEntry.actions.canShareStory` (`.default(false)`), код ошибки
  `STORY_CARD_UNAVAILABLE` в конце `ErrorCode`.
- **Общий код без дублей:** форматтеры перенесены в `@pokatim/i18n`, геометрия линии — в `@pokatim/route-view`,
  начертания и токены `storyCard` — в `@pokatim/design-tokens`.

## Деплой

- Миграций нет, env не меняются. В образе api новые зависимости: `@resvg/resvg-js` (prebuilt linux-x64-gnu) и TTF
  `@expo-google-fonts/*`, около +35 МБ.
- В worker появилась очередь `story-card`, процесс тот же.
- Лимиты: статус — 120 запросов в минуту на пользователя, новый рендер — 30 в час, картинка — 120 в минуту на IP.

## Native

Новый нативный модуль `expo-sharing` — **нужна новая dev-сборка iOS/Android.** В старом клиенте без модуля вместо
листа предлагается скачивание.

## Не проверено

- Шаринг на iOS и Android (нужна dev-сборка), Instagram Stories в листе на Android, Web Share в мобильных браузерах.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
