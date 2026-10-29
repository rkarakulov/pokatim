# 1. Title

Карточка для сторис «Достижение»: PNG 1080×1920 своего полученного достижения на серверном рендере карточек
(ADR-0018) и экран «Поделиться» в приложении.

# 2. Goal

Райдер со своего достижения (экран `/achievements/<code>` и вспышка `/achievements/flash`) делится картинкой 9:16:
значок «Эмаль», название и условие достижения, объект (гонка, маршрут каталога, райд), дата факта, имя — по согласию,
бренд. Картинка — в теме райдера (user-theme, ADR-0021), шаблоны «Линия»/«Ночь».

Источники: ADR-0018 (рендер satori + resvg в worker, PNG в Redis по капабилити-токену, `CardRequests`), ADR-0020 и
`docs/product/profile.md` A1–A8 (достижения), ride-invite-card (#96) — образец второго вида карточки. Прототипа
карточки достижения нет (прототипы — только «Результат гонки» и «Карточка-приглашение»): раскладка — по образцу 3a/3b
и 4a/4b, значок — `achievement-badge.tsx` приложения. Код сверен по `origin/develop` @ `0d804e6`.

# 3. Scope

Уровень **task2**: новый эндпоинт и шаблон на готовом рендере, новый порт `achievements`; без новых коллекций,
очередей, миграций, контрактов ответа. Один PR в `develop`.

## 3.1 Решения

- **R1. Тот же конвейер:** очередь `story-card` (новая задача `achievement-card.render`), `StoryCardCache`,
  `GET /v1/story-cards/:file`, общие лимиты `story-card-read`/`story-card-render`, контракт `StoryCardStatus`, query
  `StoryCardQuery`, общий поток `CardRequests`.
- **R2. Эндпоинт** `GET /v1/achievements/:code/story-card?template=line|night` — `AuthGuard`, `no-store`, только своё:
  пользователь — из access, в пути только код. Код вне каталога — 400 (pipe `AchievementCode`); достижение не
  получено, отозвано (факт пропал) или ещё не выдано сверкой — `409 STORY_CARD_UNAVAILABLE`. Чужого достижения
  запросить нельзя по построению (нет id пользователя в запросе).
- **R3. «Полученное» = видимое в своём списке:** факт есть сейчас (те же правила `earnedAchievements`) **и** выдача
  записана и не отозвана. Порт `achievements` `ACHIEVEMENTS_FOR_SHARING.cardFacts(userId, code)` — только чтение (без
  сверки и записи: выдачу пишет `GET /v1/achievements`, экран достижения открывается из списка).
- **R4. Содержимое:** метка «Достижение», значок (иконка и число кода — как в приложении), название, условие, объект
  («Гонка «…»», «Маршрут «…»», «Кофе-райд «…»»), имя (`RIDER_NAMES` — только с согласием), дата факта с годом
  (день по Минску), бренд.
- **R5. Приватность объекта:** гонка — название (публичный протокол), райд — название (как публичная деталь и OG
  райда); маршрут — **только если он сейчас в каталоге** (`ROUTES_FOR_SHARING.ogFacts` → название каталога). Свой
  приватный маршрут, заявка, снятый — строки объекта нет. Ни id объектов, ни места, ни времени на картинке.
- **R6. Иконка значка на сервере** — глиф шрифта Material Symbols (тот же `@expo-google-fonts/material-symbols`, что
  рисует иконки приложения на Android/web через `expo-symbols`) по кодовой точке; таблица код → точка —
  `achievement-card.icons.ts` (зеркало `ACHIEVEMENT_CATALOG` приложения; тест — у каждого кода есть глиф).
- **R7. Шаблоны:** `line` (светлая схема) — метка с подчёркиванием; ярус 2 — крупный значок по центру; ярус 3 (линия
  ink) — название, условие, объект, имя, дата; колонтитул. `night` (тёмная) — мастхед, значок, нижний блок: метка,
  название, условие, объект, имя, дата. Геометрия — токены `storyCard.achievement` и `storyCard.text.achievement*`,
  цвета значка — роли темы (`storyCardBadgeColors`: диск `action.primary`, иконка `action.onPrimary`).
- **R8. Приложение:** экран `/achievements/story/[code]` (внутри `Stack.Protected`) — общий `CardPanel` (чипы,
  превью, «Поделиться» / «Скачать PNG» одним кодом для iOS/Android/web); 409 — «Карточки нет» + «К достижению».
  Экран достижения: primary «Поделиться» → карточка достижения у **всех** кодов; у гоночных дополнительно secondary
  «Сторис результата» → `/races/story/<raceId>` (A6 расширяется). Вспышка: «Поделиться» → карточка достижения
  (`replace`, как было со сторис гонки) у всех кодов.

## 3.2 Слои

- `packages/design-tokens`: `storyCard.achievement`, `storyCard.text.achievementTitle|achievementCondition|
  achievementObject|badgeCount`, `storyCardBadgeColors`.
- `packages/i18n`: `achievementCard.*` (метка, экран, пустое состояние, подсказка), `achievements.shareResult`.
- `packages/api-client`: `getAchievementCard(accessToken, code, query)`.
- `apps/api`: `achievements` — `AchievementFactsReader` (вынос `earned`/`titled` из сервиса без смены поведения),
  `AchievementsReadModule`, порт `ACHIEVEMENTS_FOR_SHARING`; `sharing` — `AchievementCardController/Service/Inputs`,
  тексты, разметка, PNG, глиф, ветка процессора; зависимость `@expo-google-fonts/material-symbols`.
- `apps/app`: `features/achievements/story/*`, маршрут `app/achievements/story/[code].tsx`, кнопки экрана и вспышки.

# 4. Out of Scope

- Сверка выдач на запросе карточки (пишет только `GET /v1/achievements`).
- Публичная (чужая) карточка достижения из публичного профиля.
- OG-картинка достижения.

# 5. Architecture Context

`sharing → achievements` (новое, через `index.ts`: `AchievementsReadModule`, `ACHIEVEMENTS_FOR_SHARING`); `achievements`
о `sharing` не знает — циклов нет. `AchievementsReadModule` импортирует только core-модули `results`, `route-rides`,
`rides` и `AchievementsCoreModule` — пригоден для worker. `AchievementsCoreModule` (стирание в `account` worker) не
меняется.

## 5.1 Placement & Reuse Gate

| Что | Где | Reuse |
|---|---|---|
| факты «получено» | `achievements/achievement-facts.reader.ts` | `AchievementsService` и порт |
| статус/постановка | `CardRequests` | без изменений |
| кэш, PNG-эндпоинт, очередь | `StoryCardCache`, `StoryCardImageController`, `QUEUE.storyCard` | без изменений |
| узлы satori | `story-card.render.ts` (`node/box/text/page`) | шаблоны достижения |
| публичное название маршрута | `ROUTES_FOR_SHARING.ogFacts` | как OG маршрута |
| экран превью/шаринга | `features/sharing/CardPanel` | гонка, райд, достижение |

# 7. Implementation Notes

- Хэш: `['achievement', renderVersion, template, themeId, code, object.kind, object.id, objectText, factDate,
  riderName]` — смена объекта, имени, темы, публикации маршрута → новая картинка.
- Задача `{ userId, code, template, hash }`, имя `achievement-card.render`, `jobId` `achievement-card-<hash>`. Лог
  worker — код, шаблон, итог, байты, мс (без `userId`, имени, названия объекта, токена; причина провала — только тип).

# 8. Risks / Assumptions / Open Questions

## 8.2 Продуктовые решения, принятые в задаче (прототипа нет)

- [ASSUMPTION] Делиться можно **любым** своим достижением (не только гоночным): картинку отправляет сам райдер — его
  выбор; A7 (маршруты и райды — личные) касается публичного профиля, не картинки, которой райдер делится сам.
- [ASSUMPTION] Объект «маршрут» — только маршрут каталога; свой приватный — без строки объекта (картинка уходит наружу).
- [ASSUMPTION] Дата — дата факта с годом («2 мая 2026», как на экране достижения).
- [ASSUMPTION] У гоночных остаётся вход в сторис результата — secondary «Сторис результата».
- [ASSUMPTION] Раскладка — по образцу 3a/3b (метка, ярусы, колонтитул/мастхед); значок — центр яруса 2 (`line`) и над
  нижним блоком (`night`).

## 8.3 Security checklist

- **AuthN/AuthZ:** `AuthGuard`, пользователь — `@CurrentUser()`; в пути только код — чужое недостижимо; не получено /
  отозвано — 409.
- **Входные данные:** код — `AchievementCode` pipe, query — `StoryCardQuery` (`strictObject`), job data — zod.
- **Данные наружу:** ответ — только `StoryCardStatus`; картинка — каталог (название, условие), название публичного
  объекта, дата факта, имя с согласием; без id, мест, времени, приватного маршрута.
- **Злоупотребления:** общие лимиты `story-card-read:<uid>` 120/мин, `story-card-render:<uid>` 30/ч, IP
  `story-card-image`; PNG ≤ 2 МБ; дедупликация NX по хэшу.
- **Секреты и логи:** логи без `userId`, имени, названия; причина провала — только тип ошибки.
- **Аудит:** не требуется.

# 9. Acceptance Criteria

- AC1. Гость — 401; кривой код / шаблон / лишний ключ — 400; не полученное и отозванное — 409.
- AC2. Полученное: `pending` → `achievement-card.render` → `ready` + токен; PNG 1080×1920; повтор — тот же токен.
- AC3. Объект: гонка и райд — название; маршрут каталога — название; приватный маршрут — без строки объекта; имя —
  только с согласием.
- AC4. Worker: факт пропал или вход изменился — `skipped`; провал на последней попытке — `failed` один раз, в логе без
  названия.
- AC5. Приложение: «Поделиться» на экране достижения и во вспышке у всех кодов → экран карточки; у гоночных — ещё
  «Сторис результата»; экран: чипы, превью, «Поделиться»; 409 — «Карточки нет» и «К достижению».
- AC6. `TURBO_CONCURRENCY=1 pnpm check` зелёный.

# 10. Documentation Impact

ADR-0018 — «Дополнение: карточка достижения»; `docs/product/profile.md` — A6; `.claude/rules/pokatim-backend.md` /
`pokatim-security.md` — раздел карточек (если перечисляет виды).

# 12. Outcome (заполняет coder)

## Changes

- API: `GET /v1/achievements/:code/story-card` (`AchievementCardController` → `AchievementCardService` →
  `AchievementCardInputs`), задача `achievement-card.render` (`StoryCardProcessor.buildAchievementCard`), разметка
  `achievementCardTree` (значок «Эмаль», глиф Material Symbols — `achievement-card.icons.ts`), тексты, PNG. Шрифт
  иконок — `symbolsFont()` (`story-card.fonts.ts`), зависимость `@expo-google-fonts/material-symbols`.
- `achievements`: `AchievementFactsReader` (вынос `earned`/`titled` из `AchievementsService` без смены поведения),
  `AchievementsReadModule`, порт `ACHIEVEMENTS_FOR_SHARING` (`AchievementsSharing.cardFacts` — факты ∩ не отозванная
  выдача, только чтение).
- Пакеты: токены `storyCard.achievement`, `storyCard.text.{achievementTitle,achievementCondition,achievementObject,
  badgeCount}`, `storyCardBadgeColors`; строки `achievementCard.*`, `achievements.shareResult`; api-client
  `getAchievementCard`.
- Приложение: экран `achievements/story/[code]` (`CardPanel`); экран достижения — «Поделиться» (карточка, все коды)
  и «Сторис результата» (гоночные); вспышка — «Поделиться» → карточка достижения (`replace`).
- Превью: `pnpm --filter @pokatim/api preview:story-cards <каталог>` рисует и `*-achievement-*.png`.
- Миграций, env, новых очередей и коллекций нет.

## Tests

- api unit: `achievement-card.render.test.ts` (тексты, хэш, разметка обоих шаблонов, приватный маршрут без названия,
  глиф у каждого кода, satori SVG), `story-card.processor.test.ts` (диспетчер `achievement-card.render`).
- api int: `achievement-card.int.test.ts` — AC1 (401/400/409: не получено, чужое, без сверки, отозвано), AC2 (одна
  задача, тот же токен, PNG 1080×1920), AC3 (гонка/райд — название, имя только с согласием, маршрут каталога —
  название, свой приватный — `null`), AC4 (отзыв и смена входа — `skipped`, `failed` один раз без названия в логе, логи
  без `userId`/названия/токена). Отрицательное доказательство AC3: `publicTitle` без проверки каталога → тест
  «маршрут каталога — название; свой приватный — без строки объекта» красный.
- app: `achievement-story.test.tsx` (входы с экрана достижения, pending → ready → «Поделиться», «Ночь», 409, 500 с
  повтором, незнакомый код), `achievement-flash.test.tsx` (обновлён: «Поделиться» → карточка у всех кодов),
  манифест SSR и web-smoke `/achievements/story/race_win`.

## 8.2 (дополнение при реализации)

- [ASSUMPTION] Во вспышке — только «Поделиться» карточкой достижения; «Сторис результата» — на экране достижения.
- [ASSUMPTION] Карточка доступна и при незнакомом виде объекта в ответе старой сборки — код известен, объект решает
  сервер.

## Ревью pass 1

- Codex (`findings-codex.md`): APPROVE, находок нет.
- Claude (`findings-claude.md`): APPROVE, три LOW — приняты без правок кода:
  - L1: общие чтения фактов (`achievements.race_missing`, `achievements.rides_truncated`) в редких ветках пишут `uid`
    — как и в `GET /v1/achievements`; логи самой карточки (HTTP и worker) — без `userId`. Принято.
  - L2: `cardFacts` читает все три источника фактов ради одного кода — на корректность не влияет, follow-up при росте
    нагрузки.
  - L3: тест глифов проверяет наличие глифа, не совпадение с иконкой приложения — точки сверены вручную ревьюером;
    follow-up — хранить имя Material и сверять с `symbols.json`.
