# 1. Title

Карточка-приглашение на кофе-райд (4a/4b): PNG 1080×1920 для сторис на серверном рендере карточек (ADR-0018).

# 2. Goal

Организатор или любой вошедший, кому виден райд, зовёт друзей картинкой 9:16 для сторис: «Кофе-райд», название,
дата, время и место старта, линия маршрута с точкой старта, дистанция и темп, бренд. Ссылка остаётся отдельным
действием («Поделиться» на детали райда).

Источники: прототип «Кофе-райды», раздел (d) «Карточка-приглашение · Stories 9:16 · 4a / 4b» (конфиденциальный,
в репо не копируется) — 4b «карточка-линия» (белый лист, три яруса, колонтитул), 4a «фото организатора»
(мастхед + нижний блок с плиткой маршрута); подписи Q7 — без имени организатора, числа участников и мест.
ADR-0018 (рендер satori + resvg в worker, PNG в Redis по капабилити-токену), ADR-0013 (райды), 05c (маршрут райда:
`private` виден только организатору). Код сверен по `origin/develop` @ `aa857ba`.

# 3. Scope

Уровень **task2** (новый эндпоинт и шаблон на готовом рендере, без новых коллекций, очередей и зависимостей).
Один PR в `develop`: design-tokens + i18n + api-client + api (`rides`, `routes`, `sharing`) + app + доки.

## 3.1 Решения

- **R1. Тот же конвейер, что у story-cards.** Очередь `story-card` (новое имя задачи `ride-invite.render`),
  `StoryCardCache` (ключи — хэш входов и токен; хэш включает вид карточки), `GET /v1/story-cards/:file`, лимиты
  `story-card-read`/`story-card-render` пользователя — общие. Контракт статуса — `StoryCardStatus`, query —
  `StoryCardQuery` (`template=line|night`). Новых очередей, коллекций, контрактов ответа нет.
- **R2. Эндпоинт** `GET /v1/rides/:rideId/invite-card?template=line|night` — `AuthGuard`, `no-store`. Райда нет или
  он скрыт (`visibleTo` — первой проверкой; скрытый и организатору) — `404 NOT_FOUND`; райд не «будущий
  опубликованный» (отменён, прошёл, скрыт у организатора) — `409 STORY_CARD_UNAVAILABLE`. Право — любой вошедший,
  кому виден райд (как «Поделиться» ссылкой на детали — её видит любой зритель будущего райда).
- **R3. Содержимое не зависит от зрителя** (кэш общий на райд, шаблон и тему): метка «Кофе-райд», название (≤ 3
  строк), дата «4 октября» (Минск, без года — райд будущий), «Воскресенье, 10:00», «Старт: <место>», пара
  «Дистанция 42 км · Темп 22–24 км/ч», бренд. Без организатора (подписи и id), участников, лимита, описания, города
  в координатах.
- **R4. Линия маршрута — только публичная.** Маршрут прикреплён и **сейчас в каталоге** (`RideRoutes.visible(…,
  null)` → `public`) — линия показа; `private` (свой маршрут организатора) — линии нет даже у организатора: картинка
  уходит наружу. Без маршрута ярус линии пуст, старт — текстом. Worker перечитывает факты (сверка хэша) и линию через
  новый метод порта `RideRoutes.catalogLine(routeId)` (только `IN_CATALOG`, без кэша): снятый с каталога маршрут
  между HTTP и worker — `skipped`/без линии, а не утечка.
- **R5. Шаблоны** — те же имена, что у story-cards: `line` = 4b (светлая схема темы; ярус 1 — метка с
  подчёркиванием, название, дата, время, старт; ярус 2 — линия; ярус 3 — пара; колонтитул), `night` = 4a **без
  фото** (тёмная схема; мастхед, нижний блок: метка, название, дата, время, старт, плитка линии 252 px, пара).
  Цвета и гарнитуры — активной темы (как story-cards; прототип рисует `card-*`, проект — роли темы, ADR-0018 п. 7).
- **R6. Данные райда — порт `rides`** `RIDES_FOR_SHARING` (`RidesForSharing.inviteFacts(userId, rideId)`,
  `inviteLine(routeId)`), реализация в `RidesCoreModule`; `sharing` коллекцию `rides` и `routes` не читает.
- **R7. Приложение:** экран `/rides/invite/[id]` (внутри `Stack.Protected` для вошедших, как `races/story/[id]`):
  чипы «Линия»/«Ночь», превью 9:16, «Поделиться» (native — `expo-sharing`, web — Web Share с файлом, иначе «Скачать
  PNG»). Кнопка «Карточка-приглашение» на детали райда — вошедшему, райд будущий (`phase === 'upcoming'`), рядом со
  ссылкой. Общая часть экрана (превью, подготовка файла, «Поделиться», опрос статуса) выносится из
  `features/races/story` в `features/sharing` и переиспользуется экраном гонки без смены поведения.

## 3.2 Слои

- `packages/design-tokens`: токены `storyCard.text` для приглашения (`inviteDate`, `inviteTime`, `inviteStart`,
  `inviteStartNight`, `statUnit`) и `storyCard.invite` (плитка `night`).
- `packages/i18n`: `rideInvite.*` (метка, «Старт: {place}», подписи пары, экран).
- `packages/api-client`: `getRideInviteCard(accessToken, rideId, query)`.
- `apps/api`: `routes` — `RideRoutes.catalogLine`; `rides` — порт `RIDES_FOR_SHARING`; `sharing` —
  `RideInviteController`, `RideInviteInputs` (+ хэш), тексты, разметка `rideInviteTree`, ветка процессора, общий
  поток статуса `CardRequests`, `renderVersion` не меняется (story-cards не трогаем по содержимому).
- `apps/app`: `features/sharing/*`, `features/rides/invite/*`, маршрут `app/rides/invite/[id].tsx`, кнопка.

# 4. Out of Scope

- Фото организатора на 4a (загрузка, хранение, затемнение) — модуль `media`, follow-up.
- Шит «Райд опубликован» сразу после создания (два пути: карточка / ссылка) — follow-up.
- OG-картинка райда тем же рендером — следующий слайс ADR-0018.
- «Скопировать ссылку» на экране карточки — ссылка уже есть на детали райда.

# 5. Architecture Context

`sharing → rides, routes(через rides), appearance, results, profile, identity` — только `index.ts`; на `sharing`
не ссылается никто. `rides → routes` — порт `RIDE_ROUTES` (расширяется `catalogLine`). Циклов нет: `rides` о
`sharing` не знает.

## 5.1 Placement & Reuse Gate

| Что | Где | Reuse |
|---|---|---|
| статус/постановка рендера | `sharing/card-requests.ts` (вынос из `StoryCardService`) | оба сервиса карточек |
| кэш, PNG-эндпоинт, очередь | `StoryCardCache`, `StoryCardImageController`, `QUEUE.storyCard` | без изменений |
| узлы satori, линия | `story-card.render.ts` (экспорт `node/box/text/title/trackSvg/page`), `storyCardTrack` | шаблоны приглашения |
| дата/время Минска | `minskDateTime` `@pokatim/i18n`, `utcToMinskWallTime` | тексты приглашения |
| факты райда | порт `RIDES_FOR_SHARING` (`rides`) | — |
| линия каталога | `RideRoutes.catalogLine` (`routes`, `IN_CATALOG`) | — |
| экран превью/шаринга | `features/sharing` (вынос из `features/races/story`) | гонка и райд |

# 6. Relevant Files

`apps/api/src/modules/sharing/*`, `apps/api/src/modules/rides/{rides.module,rides.policy,rides.repository,index}.ts`,
`apps/api/src/modules/routes/{ride-routes.port,ride-routes,index}.ts`, `packages/design-tokens/src/story-card.ts`,
`packages/i18n/src/ru.ts`, `packages/api-client/src/index.ts`, `apps/app/src/features/races/story/*`,
`apps/app/src/features/rides/ride-detail.tsx`, `apps/app/src/app/_layout.tsx`.

# 7. Implementation Notes

- Хэш приглашения: `['ride-invite', renderVersion, template, themeId, rideId, title, startsAt, place, distanceKm,
  paceMin, paceMax, publicRouteId]` — смена любого поля, темы или публикации маршрута → новая картинка.
- Задача: `{ kind: 'ride-invite', userId, rideId, template, hash }` под именем `ride-invite.render`; `jobId`
  `ride-invite-<hash>`. Лог worker — id райда, шаблон, итог, байты, мс (без `userId`, названия, места, токена).

# 8. Risks / Assumptions / Open Questions

- [ASSUMPTION] Карточку может сделать любой вошедший зритель будущего райда (не только организатор) — как ссылку.
- [ASSUMPTION] Дата без года: райд всегда будущий (≤ горизонта создания).
- [ASSUMPTION] `night` без фото вместо 4a — как 3a у story-cards; фото — follow-up.
- Риск: лимиты карточек общие для гонок и райдов (120/мин чтения, 30/ч рендера) — достаточно.

## 8.3 Security checklist

- **AuthN/AuthZ:** статус — `AuthGuard`, пользователь — `@CurrentUser()`; скрытый и неизвестный — 404 всем, включая
  организатора; право — будущий опубликованный райд (иначе 409).
- **Входные данные:** `rideId` — `Uuid` pipe, query — `StoryCardQuery` (`strictObject`), job data — zod.
- **Данные наружу:** ответ — только `StoryCardStatus`. Картинка — публичные поля райда (как публичная карточка
  `GET /v1/rides/:id`) и линия только маршрута каталога; `private`-маршрут организатора, описание, подпись
  организатора, участники — не попадают (int-тест: приватный маршрут → нет линии, `catalogLine` → `null`).
- **Злоупотребления:** общие лимиты `story-card-read:<uid>` 120/мин, `story-card-render:<uid>` 30/ч (только при
  захвате ключа постановки), IP `story-card-image`; PNG ≤ 2 МБ; дедупликация NX по хэшу.
- **Секреты и логи:** токен — `randomBytes(16)`; логи без `userId`, названий, мест, токена.
- **Аудит:** не требуется (чтение, без мутаций доменных данных).

# 9. Acceptance Criteria

- AC1. Гость — 401; кривой `rideId`/шаблон/лишний ключ — 400; неизвестный и скрытый (и организатору) — 404;
  отменённый и прошедший — 409 `STORY_CARD_UNAVAILABLE`.
- AC2. Будущий райд: `pending` → задача `ride-invite.render` → `ready` + токен; PNG 1080×1920 по
  `/v1/story-cards/<token>.png`; повтор того же запроса — тот же токен; правка райда — новый хэш.
- AC3. Маршрут в каталоге — линия есть; `private` (у организатора) и снятый с каталога — линии нет; разметка без
  подписи организатора и описания.
- AC4. Worker: факты изменились (правка, отмена) — `skipped`; провал на последней попытке — `failed` один раз.
- AC5. Приложение: кнопка «Карточка-приглашение» у вошедшего на будущем райде; экран — чипы, превью, «Поделиться»;
  409 и 404 — «Приглашение недоступно» и «К райду»; экран гонки работает как раньше (404 там — ошибка с повтором).
- AC6. `TURBO_CONCURRENCY=1 pnpm check` зелёный; картинка проверена на dev.

# 10. Documentation Impact

ADR-0018 — абзац «Карточка-приглашение райда»; `.claude/rules/pokatim-backend.md` и `pokatim-security.md` — раздел
story-cards дополняется приглашением; `docs/product/rides.md` (если есть раздел шаринга) — экран.

# 12. Outcome (заполняет coder)

## Changes

- API: `GET /v1/rides/:rideId/invite-card` (`RideInviteController` → `RideInviteService` → `RideInviteInputs`), общий
  поток статуса `CardRequests` (вынесен из `StoryCardService` без смены поведения), задача `ride-invite.render` в
  очереди `story-card` (`StoryCardProcessor.process` — диспетчер по имени, `buildRideInvite`), разметка
  `rideInviteTree` (4b `line`, 4a `night` без фото), тексты по Минску. Порт `rides` `RIDES_FOR_SHARING`, метод порта
  `routes` `RideRoutes.catalogLine` (только `IN_CATALOG`).
- Пакеты: токены `storyCard.text.invite*`/`statUnit`, `storyCard.invite`; строки `rideInvite.*`; api-client
  `getRideInviteCard`.
- Приложение: `features/sharing` (`useCardStatus`, `useCardFile`, `CardPanel`) — общая часть экранов карточек; экран
  гонки на ней без смены поведения (404 — ошибка с повтором, тест); экран `rides/invite/[id]` (404/409 — «Приглашение
  недоступно»), кнопка «Карточка-приглашение» на детали будущего райда; web-smoke маршрута.
- Превью: `pnpm --filter @pokatim/api preview:story-cards <каталог>` рисует и приглашения (`*-invite-*.png`).

## Tests

- api unit: `ride-invite.render.test.ts` (тексты, хэш, разметка, satori), `story-card.processor.test.ts` (диспетчер:
  обе задачи, чужая схема — `skipped`, незнакомое имя — ошибка).
- api int: `ride-invite.int.test.ts` — AC1 (401/400/404 скрытого и организатору/409), AC2 (одна задача, общий токен
  для зрителей, PNG 1080×1920), AC3 (каталог команды и райдера — линия; `private` у организатора и снятый с каталога —
  нет, `catalogLine` → `null`), AC4 (правка → `skipped`, скрытие → `skipped`, `failed` один раз), логи без ПДн.
- app: `ride-invite.test.tsx` (кнопка, pending → ready → «Поделиться», «Ночь», 409/404, кривой id),
  `story-card.test.tsx` (+404 — повтор).

## Фиксы ревью pass 1

- Claude (APPROVE, `findings-claude.md`): M1 — 404 → пустое состояние только у приглашения (`emptyOnNotFound`), тест
  экрана гонки; M2 — unit-тест диспетчера; L — текст §8.3 и AC5, `isDomainError`, отметка `failed` общая — в ADR.
- Codex (REQUEST CHANGES, `findings-codex.md`): HIGH — отступ единицы — токен `storyCard.invite.unitGap`; M — «К
  райду» — `dismissTo` детали; M — шаг web-smoke `/rides/invite/<id>` без сессии.

## Фиксы ревью pass 2

- Codex (APPROVE, `findings-codex-pass2.md`): M — сообщение ошибки рендера могло процитировать название и место в
  логе worker — у приглашения в лог только тип ошибки (`ReasonDetail = 'name-only'`), int-тест; отрицательное
  доказательство: с `'clipped'` тест красный (название в `warn`).

## Open follow-ups

- Фото организатора на 4a (модуль `media`), шит «Райд опубликован» после создания, OG-картинка райда тем же рендером.
- Флак `apps/app/src/components/bottom-sheet.test.tsx` (L1, «шторку схватили посреди снапа») — ~1 из 3 прогонов
  на develop без изменений этой задачи; не трогался.
