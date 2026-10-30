# 1. Title

Карточка для сторис маршрута каталога (PNG 1080×1920 на серверном рендере карточек, ADR-0018) и выбор «Карточка для
сторис / Ссылка» в кнопке «Поделиться» маршрута и кофе-райда.

# 2. Goal

Из кнопки «Поделиться» на карточке маршрута каталога (`/routes/<id>`) и на детали кофе-райда (`/rides/<id>`) вошедший
райдер получает картинку 9:16 для сторис: у маршрута — новая карточка «Маршрут» (название, линия, дистанция, набор,
город и форма, бренд), у райда — существующая карточка-приглашение (ride-invite-card). Ссылка (с OG-PNG 1200×630,
PR #131) остаётся вторым пунктом того же выбора.

Источники: ADR-0018 (рендер satori + resvg в worker, PNG в Redis по капабилити-токену, `CardRequests`; дополнения
ride-invite, achievement, og-images), `docs/tasks/2026-10-28-ride-invite-card` и `docs/tasks/2026-10-29-achievement-
story-card` (образцы третьего и четвёртого вида карточки), `docs/tasks/2026-10-29-share-with-image` (PR #131,
`useShareImage`), `docs/product/routes.md` (D4/P5 — карточка и действия), `docs/product/rides.md` (строка 99 —
приглашение «сделано»), `docs/product/profile.md` (карточки — в теме того, кто создаёт). Прототипа карточки маршрута
нет: раскладка — по 4b/4a приглашения (без даты и времени). Код сверен по ветке `feature/sharing-story-cards-og`
@ `26098136` (в ней PR1: OG сезона/райдера, `OG_CARD_POLICY.scheme`, `OG_CARD_POLICY.renderVersion = 3`).

## 2.1 Что есть и чего не хватает (находки)

| Где | Сейчас (код) | Не хватает |
|---|---|---|
| Маршрут `/routes/<id>` | `RouteActions` (`features/routes/route-detail.tsx`): «Поделиться» (primary) → `shareLink` с OG-PNG `route` + «Скачать GPX». Сторис-карточки маршрута нет ни в API, ни в приложении. | Эндпоинт, задача рендера, разметка, экран `/routes/story/<id>`, вход из «Поделиться». |
| API для маршрута | Порт `ROUTES_FOR_SHARING` уже даёт `ogFacts(routeId)` (только `IN_CATALOG`) и `ogLine(routeId)` (`catalogLine`, перепроверка каталога, без кэша). | Ничего в `routes` — порт переиспользуется как есть. |
| Райд `/rides/<id>` | `ShareAction` — «Поделиться» (secondary, ссылка + OG `ride`) у всех, когда `mounted && upcoming && shareOrigin()`; **отдельная** кнопка «Карточка-приглашение» (`rideInvite.open`) — вошедшему при `mounted && upcoming` (любой зритель, не только организатор; сервер — 409 не будущему, 404 скрытому). Шит «Райд опубликован» (организатору после создания) уже предлагает «Карточка-приглашение / Ссылка / Закрыть». | Формулировке «из кнопки «Поделиться»» не соответствует: карточка — отдельной кнопкой рядом. Функционально приглашение есть. |
| Экран карточки | `features/sharing/card-panel.tsx` (`CardPanel`, `CardSource`, `emptyOnNotFound`), `card-status.ts` — общие. | Переиспользуются без изменений. |

# 3. Scope

Уровень **task2** (новый эндпоинт и шаблон на готовом конвейере; без коллекций, очередей, миграций, контрактов ответа,
env, зависимостей). Один PR в `develop` (PR2 ветки `feature/sharing-story-cards-og` или отдельная ветка от неё).

## 3.1 Решения (автономный режим; [ASSUMPTION] — поправимы одной строкой)

- **R1. Тот же конвейер.** Очередь `story-card` (новая задача `route-card.render`), `StoryCardCache`,
  `GET /v1/story-cards/:file`, общие лимиты `story-card-read`/`story-card-render`, контракт `StoryCardStatus`, query
  `StoryCardQuery` (`template=line|night`), общий поток `CardRequests`. Новых контрактов, очередей, коллекций нет.
- **R2. Эндпоинт** `GET /v1/routes/:routeId/story-card?template=line|night` — `AuthGuard`, `no-store`, `routeId` —
  `Uuid`. Право — любой вошедший, если маршрут **сейчас в каталоге** (`ROUTES_FOR_SHARING.ogFacts` ≠ `null`: `ready` +
  `IN_CATALOG`; маршрут команды или одобренный маршрут райдера). Иначе (неизвестный, заявка, отклонён, скрыт
  модератором, снят автором, личный) — **один** ответ `404 NOT_FOUND` (как публичная `GET /v1/routes/:id`; 409 у
  маршрута не бывает — у каталога нет «фазы»). [ASSUMPTION] вход обязателен (лимиты — по `uid`, как у всех сторис);
  гость карточку не делает (RC-2).
- **R3. Содержимое не зависит от зрителя** (кэш общий на маршрут, шаблон и тему): метка «Маршрут», название (≤ 3
  строки, `titleText`), строка «Минск · Круговой» / «Минск · В одну сторону» (город каталога + форма; формулировки —
  как чипы карточки маршрута), линия показа маршрута, пара «Дистанция 68 км · Набор 620 м» (набора нет — одна
  цифра), бренд. [ASSUMPTION] Без автора (даже при `showAuthorName`), покрытий, «В пути» (формула P3 — клиентская,
  второй расчёт на сервере не заводим), высот и дат — только поля `RouteOgFacts`; порт не расширяется.
- **R4. Тема — запрашивающего** (`RIDER_THEMES.themeOf(userId)`, user-theme; profile.md «в теме того, кто создаёт»),
  а не «Классика» OG. Хэш: `['route-card', STORY_CARD_POLICY.renderVersion, template, themeId, routeId, title,
  distanceM, elevationGainM, isLoop, city]`. `STORY_CARD_POLICY.renderVersion` **не меняется** (=2): новый вид
  отделён префиксом `route-card`, разметка прежних карточек не меняется (см. R6).
- **R5. Worker** перечитывает входы (`RouteCardInputs.resolve`) и сверяет хэш; маршрут вышел из каталога (`ogFacts` →
  `null`) или вход изменился — `skipped`; линия — `ROUTES_FOR_SHARING.ogLine` (перепроверка каталога, без кэша):
  `null` (снят между чтениями) — тоже `skipped` [ASSUMPTION: карточка маршрута без линии не нужна]. Сбой — ретрай,
  на последней попытке — `failed` один раз (общий `run`). Лог — `route <id> <template>`, итог, байты, мс; причина
  провала — только тип ошибки (`'name-only'`: название маршрута райдера — UGC).
- **R6. Разметка** `routeCardTree` (`route-card.render.ts`) из общих узлов `story-card.render.ts`. `line` (4b-подобный,
  светлая схема): ярус 1 — метка с подчёркиванием, название, строка «город · форма»; ярус 2 — линия на всё место; ярус
  3 — пара; колонтитул. `night` (4a-подобный без фото, тёмная схема): мастхед, нижний блок — метка, название, строка,
  плитка линии, пара. Геометрия — существующие токены `storyCard.line`/`storyCard.night`/`storyCard.invite`
  (`tileHeight`, `unitGap`) и `storyCard.text.{kicker,kickerNight,inviteStart,inviteStartNight,statValue,statUnit,
  statLabel}`; новых токенов не вводим [ASSUMPTION; понадобится своя высота плитки — `storyCard.route.tileHeight`].
  Пара цифр: `stats` из `ride-invite.render.ts` выносится в `story-card.render.ts` как `statRow(items, colors, opts)`
  (1–N цифр, разделитель между соседними); вывод для двух цифр **байт-в-байт прежний** — `renderVersion` не
  поднимается, доказательство — неизменные тесты `ride-invite.render.test.ts`. Вид линии — `rideInviteTrackView`
  переименовать в общий `cardTrackView` (там же) без смены значений.
- **R7. «Поделиться» с выбором** (RC-1, вариант A). Общий шит `features/sharing/share-choice-sheet.tsx`
  (`ModalSheet`): заголовок «Поделиться», «Карточка для сторис» (primary) → экран карточки, «Ссылка» (secondary) →
  `shareLink` синхронно в обработчике (с OG-PNG `image` из `useShareImage`, как сейчас), «Закрыть». Правило кнопки
  «Поделиться» на обоих экранах:
  - доступны **оба** пути (вошедший + ссылка есть) — нажатие открывает шит;
  - доступна только ссылка (гость, или маршрут/райд без права карточки) — нажатие сразу `shareLink` (как сейчас);
  - доступна только карточка (вошедший, нет `shareOrigin()` — dev native) — нажатие сразу на экран карточки;
  - нет ни одного — кнопки нет.
  Маршрут: право карточки — `signedIn && mounted` (маршрут на экране — уже каталог; остальное решает сервер). Райд —
  `signedIn && mounted && phase === 'upcoming'` (как текущая кнопка). На детали райда **отдельная** кнопка
  «Карточка-приглашение» удаляется (путь — через «Поделиться»); шит «Райд опубликован» не меняется
  (`RidePublishedSheet` переходит на общий `ShareChoiceSheet` со своими заголовком и текстом — поведение и тесты
  прежние). [ASSUMPTION] Подпись пункта у райда — «Карточка-приглашение» (как в шите «Райд опубликован»), у маршрута
  — «Карточка для сторис».
- **R8. Экран** `/routes/story/[id]` (внутри `Stack.Protected` для вошедших, как `rides/invite/[id]`): `CardPanel`
  (чипы «Линия»/«Ночь», превью 9:16, «Поделиться»/«Скачать PNG»), `emptyOnNotFound`: 404 и кривой id — «Карточка
  недоступна» / «Маршрута больше нет в каталоге.» / «К маршруту» (`router.dismissTo(routePath(id))`). `noindex`
  (префикс `/routes/story/` в списке закрытых путей `lib/seo.ts`), web-smoke без сессии — гард входа.

- **Выбор (2026-10-30): RC-1 — вариант A, RC-2 — (a).** `.claude/rules/*` не трогаем — follow-up в `pr.md`.

## 3.2 Слои

- `packages/i18n`: `routeCard.*` (метка, «город · форма», подписи и единицы пары, экран, пустое состояние, подсказка,
  подпись превью), `share.choice.*` (заголовок шита, «Карточка для сторис», «Ссылка», «Закрыть»).
- `packages/api-client`: `getRouteStoryCard(accessToken, routeId, query)`.
- `apps/api` (`sharing`): `RouteCardController/Service/Inputs`, `route-card.texts.ts`, `route-card.render.ts`,
  `route-card.png.ts`, задача `route-card.render` (`RouteCardJob`), ветка диспетчера `buildRouteCard`; вынос
  `statRow`/`cardTrackView` в `story-card.render.ts`; превью `scripts/story-card-preview.ts` (+ `*-route-*.png`).
  Модуль `routes` не меняется.
- `apps/app`: `features/routes/story/{route-story.ts,route-story-screen.tsx}`, маршрут `app/routes/story/[id].tsx`,
  `_layout.tsx` (`Stack.Protected`), `features/sharing/share-choice-sheet.tsx`, `RouteActions` и `ShareAction` райда,
  `RidePublishedSheet` на общем шите, `lib/seo.ts`, манифест маршрутов тестов, web-smoke.

# 4. Out of Scope

- Карточка «Моего маршрута» (`/routes/mine/<id>`, личный — наружу не уходит; там нет и «Поделиться»).
- Автор, покрытия, «В пути», профиль высоты на карточке; фото.
- Публичный (гостевой) эндпоинт карточки — вариант RC-2 (c).
- Изменение OG-картинок (`OG_CARD_POLICY` и `og-card.*` не трогаем), изменение разметки прежних сторис.
- «Скопировать ссылку» на экране карточки; текст/подпись при шаринге PNG.
- Правки `.claude/rules/*` — follow-up в `pr.md` (нужен OK человека).

# 5. Architecture Context

`sharing → routes(ROUTES_FOR_SHARING), profile(RIDER_THEMES), identity(AuthGuard)` — только через `index.ts`; на
`sharing` не ссылается никто; `routes` о `sharing` не знает (порт уже есть). Циклов не появляется. Рендер — только
worker (AGENTS §4.5; красный флаг «рендер в HTTP»). Серверный авторитет: право (каталог) и содержимое считает сервер;
клиент шлёт только id и шаблон. Все платформы (§4.13): экран на `CardPanel` уже работает на iOS/Android/web; шит —
`ModalSheet` (RN `Modal`, все платформы); развилок `Platform.OS` в экранах нет.

## 5.1 Placement & Reuse Gate

| Что | Где | Reuse / запрет дублей |
|---|---|---|
| факты и линия маршрута каталога | `ROUTES_FOR_SHARING.ogFacts` / `ogLine` (`routes`) | без изменений; **не** заводить новый порт или чтение коллекции `routes` из `sharing` |
| тема | `RIDER_THEMES.themeOf` (`profile`) | как у приглашения |
| статус/постановка, лимиты | `CardRequests` (`consumeRead`, `status`) | без изменений |
| кэш, PNG-эндпоинт, очередь | `StoryCardCache`, `StoryCardImageController`, `QUEUE.storyCard` | без изменений |
| исход задачи, диспетчер | `StoryCardProcessor.run`, `routeOf` | + ветка `ROUTE_CARD_RENDER_JOB` |
| узлы satori, линия, PNG | `story-card.render.ts` (`page/box/text/titleText/trackSvg`), `storyCardTrack`, `renderCardSvg`, `renderStoryCardPng`, `storyCardFonts` | + вынос `statRow`, `cardTrackView` из `ride-invite.render.ts` (без копии) |
| цвета схемы | `storyCardColors(theme.schemes.light|dark)` | как `rideInviteRenderInput` |
| форматтеры | `i18n.formatNumber`, `t('domain.city.<code>')` | без своих форматтеров |
| экран карточки | `features/sharing/{card-panel,card-status}` | без изменений |
| шит выбора | `features/sharing/share-choice-sheet.tsx` — вынос из `RidePublishedSheet` | одна реализация на три места |
| ссылка + OG-PNG | `lib/share-link(.web)`, `features/sharing/use-share-image` | без изменений |

Новый пакет не нужен; общего для проектов кода (app-foundation) нет.

# 6. Relevant Files

API: `apps/api/src/modules/sharing/{ride-invite.*,achievement-card.controller.ts,card-requests.ts,story-card.cache.ts,
story-card.processor.ts,story-card.render.ts,story-card.png.ts,sharing.module.ts,sharing.policy.ts}`,
`apps/api/src/modules/routes/{routes-for-sharing.port.ts,routes-for-sharing.ts,index.ts}`,
`apps/api/scripts/story-card-preview.ts`, `apps/api/test/routes.ts` (`seedTeamRoute`, `seedApprovedRoute`,
`seedRiderRoute`), `apps/api/src/modules/sharing/ride-invite.int.test.ts` (образец int-теста).
Пакеты: `packages/api-client/src/index.ts` (+ `sharing.test.ts`), `packages/i18n/src/ru.ts`,
`packages/design-tokens/src/story-card.ts` (только чтение).
App: `apps/app/src/features/routes/route-detail.tsx`, `apps/app/src/features/rides/{ride-detail.tsx,
ride-published-sheet.tsx,invite/*}`, `apps/app/src/features/achievements/story/*` (образец),
`apps/app/src/features/sharing/*`, `apps/app/src/app/_layout.tsx`, `apps/app/src/app/rides/invite/[id].tsx`,
`apps/app/src/lib/seo.ts`, `apps/app/src/__tests__/{app-routes.ts,route-detail.test.tsx,ride-detail.test.tsx,
ride-invite.test.tsx}`, `apps/app/e2e/web.spec.ts`, `apps/app/src/components/modal-sheet.tsx`.

# 7. Implementation Notes

- Задача: `{ userId, routeId, template, hash }` (zod `RouteCardJob`, `routeId: Uuid`) под именем
  `route-card.render`; `jobId` `route-card-<hash>` (без `:`). `userId` в данных — только для темы при сверке; в лог не
  пишется.
- Маршрут каталога неизменен по линии (готовый маршрут не меняет линию — `routes.collection.ts`), поэтому в хэше
  линию представляет `routeId`; смена названия/города/формы/набора, публикация заново, смена темы — новый хэш.
- Fastify: `GET /v1/routes/:routeId/story-card` не конфликтует с `routes/mine/:id` (статический сегмент `mine`
  приоритетнее параметра) и `routes/:id/{map,gpx,me}` (другие хвосты).
- Expo Router: `app/routes/story/[id].tsx` — статический сегмент `story` приоритетнее `app/routes/[id].tsx`.
- Web Share: «Ссылка» в шите — синхронный `shareLink` в обработчике нажатия пункта (новый жест пользователя; RC-13);
  `image` готовится заранее в родителе (`useShareImage`) и передаётся в шит пропом.
- Шит монтируется только после монтирования (как `RidePublishedSheet`: закрытый RN-web `Modal` рендерит портал).

# 8. Risks / Assumptions / Open Questions

- [ASSUMPTION] R2 (вход обязателен, 404 одним ответом), R3 (состав), R4 (тема создающего), R5 (без линии — `skipped`),
  R6 (токены приглашения), R7 (шит, удаление отдельной кнопки у райда, подписи), R8.
- Риск: PNG маршрута, снятого с каталога/скрытого модератором, живёт ≤ 24 ч по уже выданному токену — как у
  приглашения (ADR-0018, «Последствия»); новый не выдаётся (404).
- Риск: лишний тап до ссылки у вошедших (шит) — принято ради одного входа «Поделиться» (RC-1).
- Риск: вынос `statRow` незаметно изменит SVG приглашения → картинки без смены `renderVersion`. Митигатор:
  тест SVG/дерева приглашения до и после (снимок дерева `rideInviteTree` для фиксированного входа) — зелёный без правок.
- Отметка провала (`failed:<hash>`) общая для зрителей маршрута с той же темой — как у приглашения (принято в ADR).

## 8.1 Requirements Consistency (architect)

- **RC-1. «Из кнопки «Поделиться»» vs текущая отдельная кнопка райда и «Поделиться»=ссылка у маршрута.**
  (A) шит выбора «Карточка / Ссылка» в «Поделиться» на обоих экранах для вошедших, гостю — сразу ссылка, отдельная
  кнопка райда убирается — **рекомендация** (один вход, единообразно, шит уже есть в продукте — «Райд опубликован»);
  (B) без шита: у маршрута отдельная secondary-кнопка «Карточка для сторис» рядом (третья кнопка в строке действий
  с GPX — тесно на телефоне), райд без изменений; (C) шит только у маршрута, райд как есть (разнобой двух экранов).
  Принято A [ASSUMPTION].
- **RC-2. Гость на публичной карточке маршрута.** Сторис-эндпоинты все под `AuthGuard` (лимиты по `uid`).
  (a) гостю пункта карточки нет — «Поделиться» сразу ссылкой — **рекомендация**; (b) пункт есть и ведёт на вход с
  возвратом (`rememberReturnPath`) — лишний шаг, гостевой путь пока не просили; (c) публичный эндпоинт с IP-лимитом —
  новая поверхность злоупотреблений рендером (CPU worker), против ADR-0018. Принято (a).
- **RC-3. Тема карточки.** OG маршрута — «Классика» (`OG_THEME_ID`), сторис — тема создающего (profile.md). Конфликта
  нет: разные артефакты; следуем profile.md.
- **RC-4. Документ rides.md (строка 99)** говорит «экран с детали будущего райда» — остаётся верным (вход теперь
  через «Поделиться»); строку уточнить в §10.
- Вредных решений и конфликтов с инвариантами §4 не найдено: рендер в worker, право и содержимое — сервер, контракты
  не меняются (новый метод клиента на существующих схемах), миграций нет, все платформы.

## 8.3 Security checklist

- **AuthN/AuthZ:** `AuthGuard`, пользователь — `@CurrentUser()`; право — маршрут сейчас в каталоге (порт
  `ogFacts`), иначе 404 одним ответом (личный маршрут, заявка, скрытый, снятый, неизвестный — неразличимы).
- **Входные данные:** `routeId` — `Uuid` pipe, query — `StoryCardQuery` (`strictObject`), job data — zod
  `RouteCardJob`.
- **Данные наружу:** ответ — только `StoryCardStatus`; картинка — поля публичной карточки каталога (название, город,
  форма, длина, набор) и линия показа, которую и так отдаёт `GET /v1/routes/:id/map`; без автора, владельца, id.
- **Злоупотребления:** общие лимиты `story-card-read:<uid>` 120/мин, `story-card-render:<uid>` 30/ч (при захвате
  NX), IP `story-card-image`; PNG ≤ 2 МБ; дедупликация NX по хэшу + `jobId`.
- **Секреты и логи:** токен — `randomBytes(16)`; логи без `userId`, названия, токена; причина провала — только тип.
- **Аудит:** не требуется (чтение).

# 9. Acceptance Criteria

- AC1. Гость — 401; кривой `routeId` / шаблон / лишний ключ query — 400; неизвестный, личный (и владельцу), заявка,
  отклонённый, скрытый модератором, снятый автором — 404 `NOT_FOUND`.
- AC2. Маршрут каталога (команды и одобренный райдера): `pending` → одна задача `route-card.render` → `ready` +
  токен; PNG 1080×1920 по `/v1/story-cards/<token>.png`; повтор — тот же токен; второй зритель с той же темой — тот же
  токен; переименование/смена города — новый хэш.
- AC3. Разметка: метка «Маршрут», название, «город · форма», линия, пара (без набора — одна цифра); нет автора (даже
  при `showAuthorName`), id и покрытий. Оба шаблона рендерятся satori в SVG.
- AC4. Worker: маршрут снят/скрыт после постановки — `skipped` (PNG не пишется); вход изменился — `skipped`; провал
  на последней попытке — `failed` один раз, в логе только тип ошибки, без названия и `userId`.
- AC5. Прежние карточки не изменились: тесты `ride-invite.render`, `story-card.render`, `achievement-card.render`
  зелёные без правок ожиданий; `STORY_CARD_POLICY.renderVersion === 2`, `OG_CARD_POLICY` не тронут.
- AC6. Приложение, маршрут: вошедший — «Поделиться» открывает шит; «Карточка для сторис» → `/routes/story/<id>`
  (чипы, превью, «Поделиться»); «Ссылка» → `shareLink` с OG-PNG синхронно; гость — «Поделиться» сразу ссылкой, шита
  нет; без origin вошедший — сразу экран карточки. 404 на экране — «Карточка недоступна» + «К маршруту».
- AC7. Приложение, райд: будущий райд, вошедший — шит с «Карточка-приглашение» → `/rides/invite/<id>` и «Ссылка»;
  отдельной кнопки «Карточка-приглашение» нет; гость и не будущий райд — как раньше (ссылка/нет кнопки); шит «Райд
  опубликован» работает как раньше.
- AC8. Web: `/routes/story/<id>` без сессии — HTML без превью и OG, `noindex`, после гидрации — гард входа.
- AC9. `TURBO_CONCURRENCY=1 pnpm check` зелёный; картинки проверены превью-скриптом и на dev.

## 8.1a Test matrix

| Уровень | Файл | Что |
|---|---|---|
| api unit | `sharing/route-card.render.test.ts` | `routeCardTexts` (город · форма, без набора — одна цифра, числа ru), `routeCardHash` (меняется от каждого поля и темы, не зависит от `userId`), `routeCardTree` оба шаблона (нет текста автора), satori → SVG, `cardTrackView` |
| api unit | `sharing/ride-invite.render.test.ts` | без правок ожиданий (регрессия выноса `statRow`); + снимок дерева для фиксированного входа, если его нет |
| api unit | `sharing/story-card.processor.test.ts` | диспетчер: `route-card.render` → `buildRouteCard`; чужая схема — `skipped` |
| api int (реальные Mongo/Redis) | `sharing/route-card.int.test.ts` | AC1 (401/400/404 по всем статусам, личный — и владельцу), AC2 (одна задача в очереди, общий токен, PNG 1080×1920 через `/v1/story-cards`), AC4 (снятие/скрытие → `skipped`, `ogLine` → `null`; `failed` один раз; логи без `userId`/названия/токена — spy `Logger`) |
| api-client | `src/sharing.test.ts` | `getRouteStoryCard` — URL `/v1/routes/<id>/story-card?template=…`, Bearer, схема ответа |
| app | `__tests__/route-story.test.tsx` (новый) | экран: pending → ready → «Поделиться», «Ночь», 404 → пустое состояние и «К маршруту», 500 → повтор, кривой id |
| app | `__tests__/route-detail.test.tsx` | AC6: шит у вошедшего, переход на карточку, «Ссылка» с картинкой, гость — сразу ссылка, без origin — сразу карточка |
| app | `__tests__/ride-detail.test.tsx`, `ride-invite.test.tsx` | AC7: вход в приглашение через шит, отдельной кнопки нет; прежние сценарии приглашения |
| app | `features/sharing/share-choice-sheet.test.tsx` (новый) | пункты, `shareLink` синхронно в обработчике, «Ссылка скопирована», «Закрыть»; тесты `RidePublishedSheet` без изменений поведения |
| app | `__tests__/app-routes.ts`, SSR-манифест | маршрут `routes/story/[id]` |
| e2e web | `e2e/web.spec.ts` | AC8 `/routes/story/<uuid>` без сессии |

# 10. Documentation Impact

- `docs/adr/0018-story-cards.md` — «Дополнение: карточка маршрута» (эндпоинт, право — каталог, 404 одним ответом,
  содержимое без автора, тема создающего, задача `route-card.render`, линия — `ogLine`, без линии — `skipped`).
- `docs/product/routes.md` — «Действия (P5)»: «Поделиться» у вошедшего — выбор «Карточка для сторис / Ссылка»;
  экран `/routes/story/<id>`; таблица «Что не входит» — без изменений.
- `docs/product/rides.md` — строка 99: «экран — из «Поделиться» на детали будущего райда (выбор «Карточка-приглашение
  / Ссылка»)».
- `docs/product/profile.md` — строка 187: «Карточки для сторис (результат, приглашение, достижение, маршрут)».
- `.claude/rules/pokatim-backend.md` и `pokatim-security.md` (разделы story-cards) — абзац про карточку маршрута:
  **follow-up в `pr.md`** (правила не трогаем без OK человека).

# 11. Implementation Context

ENTRY POINTS
- HTTP: `RouteCardController.status` — `GET /v1/routes/:routeId/story-card`.
- Worker: `StoryCardProcessor.routeOf('route-card.render')` → `buildRouteCard`.
- App: `app/routes/story/[id].tsx`; «Поделиться» в `RouteActions` и `ShareAction` райда.

FILES TO CREATE
- `apps/api/src/modules/sharing/route-card.controller.ts`
  `@Controller('routes') @UseGuards(AuthGuard) class RouteCardController { @Get(':routeId/story-card')
  @Header('Cache-Control','no-store') status(@CurrentUser() user, @Param('routeId', Uuid pipe) routeId,
  @Query(StoryCardQuery pipe) query): Promise<StoryCardStatus> }` — копия формы `RideInviteController`.
- `.../route-card.service.ts` — `RouteCardService.status(userId, routeId, template): Promise<StoryCardStatus>`:
  `requests.consumeRead(userId)` → `inputs.resolve(...)`; `null` → `domainError('NOT_FOUND', 404)` →
  `requests.status(userId, { name: ROUTE_CARD_RENDER_JOB, data: { userId, routeId, template, hash }, jobId:
  \`route-card-${hash}\` })`.
- `.../route-card.inputs.ts` — `interface RouteCardInput { template; themeId: AppThemeId; facts: RouteOgFacts }`;
  `routeCardHash(input): string`; `@Injectable() RouteCardInputs { constructor(@Inject(ROUTES_FOR_SHARING) routes,
  @Inject(RIDER_THEMES) themes); resolve(userId, routeId, template): Promise<{ input; hash } | null> }`.
- `.../route-card.texts.ts` — `interface RouteCardTexts { kicker; title; place; stats: CardStat[]; brand }`;
  `routeCardTexts(input): RouteCardTexts` (км — `formatNumber(distanceM/1000, {maximumFractionDigits: 1})`, набор —
  `formatNumber(round(elevationGainM))`, `null` — без второй цифры; город — `t('domain.city.<code>')`).
- `.../route-card.render.ts` — `interface RouteCardRenderInput { template; colors: StoryCardColors; texts:
  RouteCardTexts; track: StoryCardTrack }`; `routeCardTree(input): StoryCardNode`.
- `.../route-card.png.ts` — `routeCardRenderInput(input, line)`, `renderRouteCardSvg(input, fonts)`,
  `renderRouteCard(input, line: readonly LonLat[]): Promise<Buffer>` (как `ride-invite.png.ts`).
- `.../route-card.render.test.ts`, `.../route-card.int.test.ts`.
- `apps/app/src/features/routes/story/route-story.ts` — `routeStoryPath(id) = '/routes/story/<id>'`,
  `routeStoryKey(routeId, template)`, `routeStorySource(routeId): CardSource` (`api.getRouteStoryCard`).
- `apps/app/src/features/routes/story/route-story-screen.tsx` — `RouteStoryScreen({ routeId })` по образцу
  `RideInviteScreen` (`useCatalogRoute` для подписи превью, `CardPanel ... emptyOnNotFound`).
- `apps/app/src/app/routes/story/[id].tsx`.
- `apps/app/src/features/sharing/share-choice-sheet.tsx` — `ShareChoiceSheet({ title, text?, cardLabel, onCard,
  link: { title; text; path; image?: ShareImage } | null, onClose, onShared?, testID })`.
- `apps/app/src/__tests__/route-story.test.tsx`, `apps/app/src/features/sharing/share-choice-sheet.test.tsx`.

FILES TO MODIFY
- `sharing/story-card.cache.ts` — `ROUTE_CARD_RENDER_JOB = 'route-card.render'`, `RouteCardJob = z.object({ userId:
  z.string(), routeId: z.string(), template: StoryCardTemplate, hash: z.string() })`; JSDoc кэша (+ маршрут).
- `sharing/story-card.processor.ts` — ветка в `routeOf`, `buildRouteCard(job, options)` через `run(this.cache, …,
  'name-only', …)`: `resolve` → хэш → `this.routes.ogLine(routeId)` → `null` — `skipped` → `renderRouteCard`;
  конструктор + `RouteCardInputs`.
- `sharing/story-card.render.ts` — экспорт `statRow(items: CardStat[], colors, { padTop, dividerPad, rule })`,
  `CardStat { value; unit; label }`, `cardTrackView(template)`; `ride-invite.render.ts` — использовать их (удалить
  локальные `stats`, `rideInviteTrackView`), `RideInviteStat` = `CardStat`.
- `sharing/sharing.module.ts` — `RouteCardController`, `RouteCardService`, `RouteCardInputs` (HTTP),
  `RouteCardInputs` (worker); JSDoc модулей. `RoutesCoreModule` уже импортирован.
- `apps/api/scripts/story-card-preview.ts` — `*-route-{line,night}.png` (длинное название, без набора).
- `packages/api-client/src/index.ts` — `getRouteStoryCard(accessToken, routeId, query: StoryCardQuery)` →
  `/v1/routes/${encodeURIComponent(routeId)}/story-card${queryString(query)}`, `StoryCardStatus`, `authorized`.
- `packages/i18n/src/ru.ts` — `routeCard.{kicker,place,loop,oneWay,distance,gain,unitKm,unitM,title,open,preview,hint,
  empty.title,empty.message,empty.action}`, `share.choice.{title,link,close}`.
- `apps/app/src/features/routes/route-detail.tsx` — `RouteActions({ route, mounted, signedIn })`: правило R7, шит.
- `apps/app/src/features/rides/ride-detail.tsx` — `ShareAction` с выбором (R7); удалить отдельную кнопку
  `rideInvite.open` (строки ~219–225); `canShare`/`canCard` по R7.
- `apps/app/src/features/rides/ride-published-sheet.tsx` — на `ShareChoiceSheet` без смены поведения.
- `apps/app/src/app/_layout.tsx` — `<Stack.Screen name="routes/story/[id]" />` в `Stack.Protected` вошедших.
- `apps/app/src/lib/seo.ts` — `'/routes/story/'`; `__tests__/app-routes.ts`; `e2e/web.spec.ts`.

FILES TO READ (не менять)
- `sharing/card-requests.ts`, `sharing/story-card.png.ts`, `sharing/ride-invite.{inputs,service,png}.ts`,
  `routes/routes-for-sharing{,.port}.ts`, `routes/ride-routes.ts` (`catalogLine`), `features/sharing/card-panel.tsx`,
  `features/sharing/card-status.ts`, `features/sharing/use-share-image.ts`, `lib/share-link(.web).ts`,
  `features/rides/invite/*`, `features/achievements/story/*`, `apps/api/test/routes.ts`.

TYPES & SCHEMAS
- Контракты: `StoryCardStatus`, `StoryCardQuery`, `StoryCardTemplate`, `Uuid`, `FieldErrorCode` — без изменений.
- Порт: `RouteOgFacts { routeId; title; distanceM; elevationGainM: number | null; isLoop; city: CityCode }` — без
  изменений. Токены `storyCard.*` — без изменений.
- Константы: `STORY_CARD_POLICY.renderVersion` = 2 (не трогать), `OG_CARD_POLICY` — не трогать.

TESTS — см. §8.1a.

OUT OF SCOPE — §4; миграций (последняя `0040_panel_totp`), env, новых очередей/коллекций/зависимостей нет.

# 12. Outcome

Реализовано по §3.1 (RC-1 = A, RC-2 = (a)) и §11; `.claude/rules/*` не тронуты — абзацы про карточку маршрута в
`pokatim-backend.md` / `pokatim-security.md` (story-cards) и `pokatim-app.md` (кнопка «Карточка-приглашение» → выбор
в «Поделиться») — follow-up в `pr.md` (нужен OK человека).

- API (`sharing`): `RouteCardController` (`GET /v1/routes/:routeId/story-card`) → `RouteCardService` →
  `RouteCardInputs` (`ROUTES_FOR_SHARING.ogFacts` + `RIDER_THEMES`, `routeCardHash`) → `CardRequests`; задача
  `route-card.render` (`RouteCardJob`) → `StoryCardProcessor.buildRouteCard` (сверка хэша, `ogLine`, `null` —
  `skipped`, причина провала — только тип). Разметка `routeCardTree` (`route-card.render.ts`), тексты
  `routeCardTexts`, PNG `renderRouteCard`. Общие `statRow`/`CardStat`/`cardTrackView` вынесены в
  `story-card.render.ts`; приглашение на них — дерево байт-в-байт прежнее (sha256 дерева четырёх вариантов
  зафиксирован до выноса и не изменился), `STORY_CARD_POLICY.renderVersion` = 2, `OG_CARD_POLICY` не тронут.
- `api-client`: `getRouteStoryCard`. `i18n`: `routeCard.*`, `share.choice.*`.
- Приложение: `features/sharing/share-choice-sheet.tsx` (`ShareChoiceSheet` + хук `useShareChoice` — правило R7),
  `RouteActions` (+ `signedIn`), `ShareAction` райда (отдельная кнопка «Карточка-приглашение» удалена),
  `RidePublishedSheet` на общем шите; экран `routes/story/[id]` (`RouteStoryScreen`, `CardPanel` + `emptyOnNotFound`),
  `Stack.Protected`, `SEO_DISALLOW` `/routes/story/`, `app-routes`, сторож SSR-манифеста, смоук web.
- Превью: `pnpm preview:story-cards` — `<тема>-<шаблон>-route-{base,long-nogain}.png` (44 файла).
- Документация: ADR-0018 «Дополнение: карточка маршрута каталога», `routes.md` (P5), `rides.md` (строка
  приглашения), `profile.md` (карточки).

## 12.1 Отступления (мелкие, в пределах scope)

- i18n: кроме перечисленных в §11 — `share.choice.copied` / `share.choice.failed` (баннеры общего шита; тексты те же,
  что `rides.detail.copied` / `shareFailed`), `routeCard.open` — подпись пункта «Карточка для сторис».
- `RouteCardRenderInput.track` — `StoryCardTrack | null`: `storyCardTrack` возвращает `null` для вырожденной линии
  (точка); тогда ярус/плитка пусты, как у приглашения. Нет линии вовсе — по-прежнему `skipped` (R5).
- `RouteCardInputs` добавлен в конструктор `StoryCardProcessor` последним параметром (индексы зависимостей в
  существующих unit-тестах не сдвинулись).
- Тест «снимок дерева» приглашения — sha256 JSON дерева (снимков-файлов в репозитории нет).

## 12.2 Проверки

- `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo/Redis): format, lint, arch, typecheck — зелёные; тесты:
  app 2402/2402, admin 461, api-client 158, contracts 444, design-tokens 606, i18n 15, route-view 51, tracks 314;
  api 2175/2176 — упал `tracks/track-uploads.int.test.ts` (MEDIUM-6, 16 МиБ через сокет: `fetch failed`) — файл не
  затронут, повтор отдельно: 34/34 дважды (в одном из прогонов — другой тест того же файла, «уборка»): флак под
  нагрузкой.
- Новые: `route-card.render.test.ts` (14), `route-card.int.test.ts` (10), `story-card.processor.test.ts` (+1),
  `ride-invite.render.test.ts` (+4, снимок), `api-client sharing.test.ts` (+1), `share-choice-sheet.test.tsx` (6),
  `route-story.test.tsx` (5), `route-detail.test.tsx` (+5), `ride-detail.test.tsx` (+3, 3 изменены под шит),
  `ride-invite.test.tsx` (вход через «Поделиться»), сторож SSR-манифеста (+1), смоук web (+1, не запускался —
  `pnpm e2e:web` NOT VERIFIED).
- Не проверено: dev-стенд, симуляторы iOS/Android (NOT VERIFIED).
