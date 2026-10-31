# «Свои», P3 — профиль: «В свои», экран «Свои», «Свои · N», подсказка имени

Уровень: task3. Эпик — [`docs/tasks/2026-10-31-social-stage-0/task.md`](../2026-10-31-social-stage-0/task.md)
(строка P3 таблицы §3.2). Продукт — `docs/product/social.md` K1, K3, K6, K11; архитектура — ADR-0027 п. 3, 9.
P0 (ядро `social`, `SocialConnectionsService`) — в develop (#158). Параллельно идут P1, P2, P6.

## 1. Title

Профиль райдера «Свои»: `GET riders/:publicId/social`, «В свои» / «В своих», экран «Свои», «Свои · N» в своём
профиле, подсказка имени K3 в профиле и на Главной.

## 2. Goal

Райдер видит на чужом профиле, сколько раз ехал с ним и куда тот едет, добавляет его в «свои» и убирает; в своём
профиле видит «Свои · N» и список; без публичного профиля получает подсказку «Добавьте имя — свои увидят вас».

## 3. Scope

1. **API (`social`, под `AuthGuard`, `no-store`):**
   - `GET /v1/riders/:publicId/social` — для вошедшего зрителя: `together { rideCount, lastRideAt }` (K6, относительно
     зрителя), `going` — ближайший будущий райд райдера (организатор или «Иду», не отменён, не скрыт) только если
     зритель у райдера в «своих» (связь `rider → viewer` не убрана), иначе `null`; `connected` — зритель держит связь
     `viewer → rider` (не убрана), `self` — свой профиль. Неизвестный и непубличный `publicId` — `404 NOT_FOUND`.
   - `PUT /v1/riders/:publicId/social/connection` — «В свои» (`addManual`, лимит 30/24 ч K11 → `429 RATE_LIMITED`, себе
     → `409 SOCIAL_ACTION_BLOCKED {reason: self}`, непубличный → `404`); `DELETE …/connection` — «Убрать из своих»
     (тихо, K1; идемпотентно). Точная форма путей — за architect.
   - `GET /v1/social/connections` — «Свои» вошедшего: публичные профили (аватар, имя, `publicId`), `rideCount`,
     `lastRideAt`, источники («вместе N раз · последний — дата» или «добавлены вами»); `count` для «Свои · N» —
     из этого же списка (в счётчик входят только публичные, K6).
2. **Контракты** (`packages/contracts/src/social/`), **api-client** — схемы ответов (`tolerantEnum` для источников),
   методы клиента.
3. **Приложение (`apps/app`):**
   - Профиль другого райдера (`riders/[id]`): строка «Вместе ехали N раз · последний — 10 октября» (N > 0), строка
     «Идёт: <райд>» с «Я иду» / «Вы идёте» (ведёт на райд; источник «Иду» `profile` — если параметр `join` из P2 уже в
     develop к FINISH, иначе follow-up), кнопка «В свои» / «В своих» (повтор убирает); себе — ничего. Гость — «В свои»
     ведёт на вход (как «Пожаловаться»), остальных строк нет.
   - Свой профиль: строка «Свои · N» (видна и при N = 0) → экран «Свои».
   - Экран «Свои»: строки — аватар, имя, «вместе N раз · последний — дата» или «добавлены вами», кнопка «В своих»;
     нажатие убирает, строка остаётся до ухода с экрана с кнопкой «В свои» (можно вернуть), без подтверждения;
     пусто — «Пока никого. Свои появятся после совместного райда или когда вы добавите кого-то из профиля».
     Строка ведёт на профиль райдера.
   - Подсказка K3 «Добавьте имя — свои увидят вас» → «Редактировать профиль», только у вошедшего без публичного
     профиля: в своём профиле (всегда) и на Главной — на месте будущей секции «Свои» (порядок K7: первой, если в
     опросе выбраны «Кофе-райды», иначе после разделов по опросу), «Не сейчас» скрывает на 14 дней (на устройстве).
   - i18n — `packages/i18n/src/ru.ts` (в конец).
4. **LOW из ревью P0 (§8.2 эпика):** повтор при `isDuplicateKey(rider_connections_owner_other_unique)` в пересчёте
   связей явки vs `addManual` — выбрать одно поведение, доказать int-тестом воротами.
5. **Документы:** `profile.md`/`home.md` — уточнения из ответов автора (см. §8), правила `.claude/rules/pokatim-*.md`
   при новых эндпоинтах; отметка в эпике.

## 4. Out of Scope

Уведомление «Вас добавили в свои» (P1/P7); секция «Свои» на Главной (P7); участники и явка на райде (P2);
реакции (P4); приглашения (P6); пагинация списка «Свои» (этап 0 — до сотен строк).

## 5. Architecture Context

ADR-0027 п. 3: данные зрителя — отдельные эндпоинты `social` под `AuthGuard`, `no-store`; публичный кэшируемый
`GET riders/:publicId` не меняется. Прецедент пути под чужим ресурсом — `riders/:publicId/me` в `profile`.
`social` читает чужие данные только через порты (`RIDER_NAMES`, `RIDES_FOR_SOCIAL`).

## 5.1 Placement & Reuse Gate

Architect, 2026-10-31. Сверка с кодом `origin/develop` beca1db2.

- **Placement.** API — только `apps/api/src/modules/social/` (новые контроллеры, сервис представления) и один метод
  порта в `rides` (`RIDES_FOR_SOCIAL.nextRideCard`, RC-P3-3). Контракты — новый файл
  `packages/contracts/src/social/rider-social.schema.ts` (P2 кладёт свои в `ride-participants.schema.ts`, общий
  `social.schema.ts` не правим). Приложение — `apps/app/src/features/social/` (экран «Свои», подсказка K3, запросы),
  маршрут `apps/app/src/app/social.tsx` (`/social`, RC-P3-10), правки `riders/rider-screen.tsx`,
  `profile/own-profile-screen.tsx`, `(tabs)/index.tsx`, `home/sections.ts`. Новый пакет не нужен (один потребитель
  на слой). Миграций нет: коллекции и индексы — P0 (`rider_connections_owner_other_unique` покрывает пару и список
  владельца, `rides_participant_idx {participants.userId, startsAt}` — «Идёт»).
- **Переиспользуем (запрещены дубли):**
  - `SocialConnectionsService.addManual / remove / listOf / togetherOf` — логику связей, лимит K11, проверку
    публичности (RC-16) в контроллере и новом сервисе не повторять;
  - `RIDER_PROFILES.findPublic(publicId)` — разрешение `publicId → userId` с тем же условием публичности, что у
    `GET riders/:publicId` (неизвестный и непубличный — одинаковый `404`); `RIDER_NAMES.publicRiders` — карточки
    списка (уже внутри `listOf`);
  - `rides`: `viewerProjection(userId)`, `rideViewer`, `rideFull`, `ridePhase`, `summaryOf`, `lookupRoutes`,
    `reportedRideIds` — карточку «Идёт» собирает `rides` теми же функциями, что ленту (`RideCard`), `social` фазу и
    права не считает;
  - контракты: `RideCard` (`rides/ride.schema.ts`), `RiderPublicId`, `AvatarId` (`profile/rider-avatar.schema.ts`),
    `CONNECTION_SOURCES` + `tolerantEnum`;
  - приложение: `RideListRow` + `RideGoingAction` / `useRideRsvp` (роль, «Я иду» / «Вы идёте» / «Вы организатор»,
    push-подсказка), `rememberReturnPath` + `/sign-in` (как «Пожаловаться» гостя), `withAccessToken`, `AsyncContent`,
    `Skeleton*`, `EmptyState`, `Button`, `TextAction`, `Banner`, `RiderAvatar`, `useSettingsShell` (гард `/social`),
    паттерн отложки «Не сейчас» `push-soft-prompt-{state,storage,storage.web}.ts` (SecureStore / `localStorage`);
  - `gate`, `retried`, `untilBlocked` (`apps/api/test/identity.ts`), `pastRide`, `riders`, `socialServices`,
    `publicRider`, `patchProfile` — стенд int-тестов.
- **Запрещено:** читать `rides` / `profiles` из `social` напрямую; класть данные зрителя в кэшируемый
  `GET riders/:publicId`; вычислять на клиенте «в своих ли зритель у райдера», фазу или право записаться; второй
  экземпляр карточки райда в `social`; новый HTTP-глагол `DELETE` (RC-P3-1); общий KV-хелпер «на вырост» (P6 тоже
  хранит флаг — каждый в своей фиче по образцу push-подсказки).

## 6. Relevant Files

- `apps/api/src/modules/social/{connections.service.ts,connections.repository.ts,attendance.service.ts,social.module.ts,index.ts,social-connections.int.test.ts,social-attendance.int.test.ts}`.
- `apps/api/src/modules/profile/{rider-reports.controller.ts,rider-profiles.port.ts,rider-names.port.ts,profile.policy.ts}` — прецедент `riders/:publicId/me`, `findPublic`, `publicId` наружу только при публичности.
- `apps/api/src/modules/rides/{rides-for-social.port.ts,rides-for-social.ts,rides-feed.service.ts,rides.repository.ts,rides.policy.ts,rides-for-social.int.test.ts}`.
- `apps/api/src/http-app.ts:29` — CORS `methods: GET, HEAD, POST, PUT, PATCH` (DELETE нет — RC-P3-1).
- `apps/api/test/{harness.ts,identity.ts,social.ts,profiles.ts,rides.ts}`.
- `packages/contracts/src/{social/social.schema.ts,rides/ride.schema.ts,profile/rider-avatar.schema.ts,index.ts}`, `packages/api-client/src/{index.ts,rider-profile.test.ts}`.
- `apps/app/src/features/riders/{rider-screen.tsx,queries.ts}`, `features/profile/{own-profile-screen.tsx,queries.ts}`, `app/(tabs)/index.tsx`, `features/home/{sections.ts,sections.test.ts}`, `components/{ride-list-row.tsx,ride-going-action.tsx,rider-avatar.tsx}`, `features/rides/{queries.ts,going-action.tsx}`.
- `apps/app/src/features/notifications/push-soft-prompt-{state,storage,storage.web}.ts`, `features/auth/secure-storage.ts` (`SecureKey`).
- `apps/app/src/app/{profile.tsx,_layout.tsx}`, `lib/seo.ts` + `__tests__/seo-routes.test.ts`, `__tests__/{rider-profile,own-profile,home,auth-guard}.test.tsx`, `e2e/web.spec.ts`.

## 7. Implementation Notes

- **Серверный авторитет.** `self`, `connected`, `together`, `going` (и `going.viewer`) считает сервер; клиент только
  показывает. Видимость «Идёт» — связь `rider → viewer` с `removedAt: null` (сервер), не флаг клиента.
- **Порядок проверок `PUT …/social/connection`:** `publicId` → `findPublic` (нет — `404`) → себе — `409 self` (и для
  `connected: false`: иначе `remove(self, self)` создал бы надгробие `owner = other`) → `connected: true` —
  `addManual` (лимит K11 первым внутри, RC-16), `false` — `remove` (тихо, идемпотентно, лимита нет). Ответ — свежий
  `RiderSocial` (как `reportRider` → `RiderProfileViewer`). Лимит считается после разрешения `publicId`: перебор
  32-байтных `publicId` неосуществим, двойного списания нет.
- **«Идёт»:** ближайший опубликованный (не отменён, не скрыт) райд со `startsAt > now`, где райдер — участник «Иду»
  (организатор — первый участник, отдельного условия не нужно), сортировка `startsAt ↑, _id ↑`, `limit 1`. Карточка —
  `RideCard` со зрителем (`viewerProjection(viewerId)`, маршрут — `lookupRoutes` с этим зрителем, чужой
  непубличный маршрут — `null`).
- **Список «Свои»:** `listOf` (не убранные, только публичные, K3). Порядок — как в репозитории: `lastRideAt ↓` (без
  совместных — в конце), затем `updatedAt ↓`, `_id ↓` (RC-P3-11). Строки без `publicId` (теоретически, 0033 —
  бэкфилл) исключаются из `items` и `count` (RC-P3-9). `count = items.length` на сервере — смысл сохранится при
  будущей пагинации. В ответе нет `userId`.
- **Тексты строк (клиент по полям сервера):** `rideCount > 0` — «Вместе N раз · последний — 10 октября» (плюрал
  i18n; дата по Минску, год — если не текущий); иначе `manual` — «Добавлены вами»; иначе `invite` — «По приглашению»
  (RC-P3-5); `'unknown'` — без подписи.
- **Экран «Свои»:** «В своих» → `PUT {connected:false}`, строка остаётся с «В свои» (локальное состояние экрана по
  `publicId`), повтор → `PUT {connected:true}` (лимит K11, `429` — текст у кнопки); без подтверждения. Уход с экрана
  (blur / unmount) — `invalidateQueries(['social'])`; «Свои · N» обновится. Мутации — состояние кнопки (§4.12).
- **Профиль другого:** запрос `['social','rider',publicId]` только вошедшему и после найденного профиля (как
  `useRiderViewer`); `404` — блок молчит. Порядок блока — под шапкой профиля, над статистикой: «Вместе ехали…»
  (N > 0), «Идёт» (`RideListRow` с `RideGoingAction variant="row"`, нажатие — `/rides/<id>`), «В свои» / «В своих».
  «Я иду» — `useRideRsvp(ride.id).mutate('join', { onSuccess: invalidate(['social','rider',id]) })` (кэш `['rides']`
  обновляет сам хук; `rides/queries.ts` не трогаем — его меняет P2). Гость — только «В свои» → `rememberReturnPath` +
  `/sign-in`. `self` — ничего.
- **Подсказка K3** — компонент `features/social/name-hint.tsx` (`NameHint { onLater?: () => void }`): текст
  `social.nameHint.title`, действие `social.nameHint.action` → `/settings/profile`, «Не сейчас» —
  `social.nameHint.later` (только на Главной). Условие показа — `profile.publicId === null` из `['profile']`
  (сервер отдаёт `publicId` только при имени и согласии) — без нового запроса. Ключи i18n и компонент общие с P2
  (подсказка после райда, K5): кто сливается первым, тот добавляет; второй при слиянии develop берёт готовые, без
  дублей (RC-P3-12).
- **Главная:** чистая `socialSlotIndex(sections, reasons)` в `home/sections.ts` — `group_rides` выбран → `0`, иначе
  число выбранных разделов; `reasons === undefined` — подсказки нет. P7 ставит секцию «Свои» в тот же слот.
  Подсказка — вошедшему, профиль загружен, `publicId === null`, отложка прочитана и старше 14 дней (`undefined` — пока
  читается — не показываем, без мигания, как `softPromptVisible`).
- **Отложка «Не сейчас»:** `features/social/name-hint-{state,storage,storage.web}.ts` по образцу push-подсказки;
  ключ `pokatim.nameHint` в конец `SecureKey`; `NAME_HINT_SNOOZE_MS = 14 * MS_IN_DAY`. Сбой хранилища — не падение,
  в этой сессии подсказка скрыта.
- **Security (чек-лист нужен — да, короткий):** AuthN — `AuthGuard` на трёх эндпоинтах, `no-store`; AuthZ —
  владелец связи только из access-токена, `publicId` чужого — только через `findPublic`; данные наружу — только
  публичные карточки, без `userId`; «Идёт» — только при связи `rider → viewer` (K6); злоупотребления — K11 30/24 ч;
  логи — без имён и `publicId`; правка `SecureKey` — зона `pokatim-security.md` (`features/auth/**`), только
  добавление нечувствительного ключа (прецедент `pokatim.pushSoftPrompt`).

## 8. Risks / Assumptions / Open Questions

Ответы автора (2026-10-31):
- «Свои · 0» показывается, экран «Свои» пустой с пояснением.
- Подсказка на Главной — на месте секции «Свои» (порядок K7).
- «В своих» на экране «Свои» убирает без подтверждения; строка остаётся до ухода с кнопкой «В свои».

`[ASSUMPTION]`:
- Гость на профиле — «В свои» ведёт на вход; «вместе ехали» и «Идёт» гостю не показываются.
- «Не сейчас» хранится на устройстве (14 дней), не на сервере.
- Подсказка в своём профиле не скрывается.
- Параллельный P2 тоже расширяет `RIDES_FOR_SOCIAL` — конфликт порта решается при слиянии develop.

## 8.1 Requirements Consistency (заполняет architect)

Architect, 2026-10-31. **Статус — без BLOCKERS.** Уточнения ниже — coder идёт по рекомендациям, если автор или
оркестратор не возразят; отклонения от спека — в 8.2 на шаге реализации.

- **RC-P3-1. `DELETE …/connection` — нового глагола в API нет.** CORS (`apps/api/src/http-app.ts:29`) разрешает
  `GET, HEAD, POST, PUT, PATCH`, `@Delete` и DELETE-хелпера в api-client нет; добавление — правка зоны `security.md`.
  Варианты: (a) один идемпотентный `PUT /v1/riders/:publicId/social/connection` с телом `{ connected: boolean }`
  (прецедент `PUT /v1/profile/theme`); (b) `PUT` + `DELETE` с правкой CORS и теста `http-app.test.ts`;
  (c) `POST …/add` и `POST …/remove` (как `join` / `leave`). **Рекомендация (a):** одно состояние «хочу / не хочу»,
  повтор безопасен, зона безопасности не трогается.
- **RC-P3-2. LOW P0: повтор при `isDuplicateKey(rider_connections_owner_other_unique)` (п. 4 спека).** Проверено на
  стенде (MongoDB 8.0 replica set, `127.0.0.1:27117`, отдельная БД, скрипт architect): upsert пары внутри транзакции
  после установленного снимка против закоммиченной параллельной вставки (из транзакции и без неё) даёт `112
  WriteConflict` с меткой `TransientTransactionError`, а не `E11000`. `session.withTransaction`
  (`MongoTransactions.run`, api-kit 0.5) повторяет попытку; вторая видит документ и сливает поля. 1200 параллельных
  upsert одной пары (в транзакции и без) — 646 `WriteConflict`, 0 `DuplicateKey`. Значит повтор в `addManual` —
  мёртвый код, а пересчёт явки защищён тем же механизмом. Варианты: (a) **одно поведение — повтор транзакции
  `withTransaction` по `WriteConflict`; повтор по `isDuplicateKey` из `addManual` убрать** (и не добавлять в
  `linkInvite` / `applyRideDiff`), комментарий у `CONNECTIONS_UNIQUE_INDEX` поправить; (b) общий обработчик
  дубля для всех трёх транзакционных путей — недоказуемый код (красного без него не получить); (c) оставить как
  есть с комментарием — два разных допущения в одном модуле. **Рекомендация (a).** Обработку дубля в `remove`
  (вне транзакции, «уже убран» — не гонка) не трогать. Тесты и отрицательное доказательство — п. 11, TESTS.
- **RC-P3-3. Порт «Идёт» и параллельный P2.** Варианты: (a) метод `nextRideCard` в `RIDES_FOR_SOCIAL`
  (ADR-0027 п. 1: `social → rides` — порты `*_FOR_SOCIAL`); (b) расширить `RIDER_RIDES` (порт `achievements`) — без
  конфликта с P2, но против правила портов и с двумя потребителями одного порта; (c) новый символ
  `RIDES_AHEAD_FOR_SOCIAL` — лишняя сущность. **Рекомендация (a)** с минимальным конфликтом: метод — сразу после
  `rideFacts` в интерфейсе и классе; метод репозитория — рядом с `pastFactsOf` (не в конце файла); сборка карточки —
  новая экспортируемая `rideCardOf` в `rides-feed.service.ts` (её же использует `list`, без копии). Если P2 тоже
  расширит порт — при слиянии оставить оба метода (только добавления).
- **RC-P3-4. Источник «Иду» `profile`.** В `origin/develop` (beca1db2) `POST rides/:id/join` без тела-источника,
  `api.joinRide(token, id)`; у P2 ещё нет коммитов. P2 вводит `JoinRideRequest { source? }` и
  `joinRide(accessToken, id, source?)`. **Решение:** P3 вызывает «Я иду» через `useRideRsvp` как есть. На FINISH —
  `merge origin/develop`: если P2 уже там — передать `source: 'profile'` из строки «Идёт» (одна правка вызова +
  jest-проверка тела `{ source: 'profile' }`); иначе — follow-up строкой в эпике §3.2 (вместе с `social_home` в P7).
  Событие `ride-joined` пишет `rides` (P2), не P3.
- **RC-P3-5. Строка связи только по приглашению.** В спеке два текста («вместе N раз…» / «добавлены вами»), а связь
  `invite` (P6) без райдов и без `manual` тоже попадёт в список. Варианты: (a) «По приглашению»; (b) «Добавлены вами»
  (неверно для приглашённого); (c) без подписи. **Рекомендация (a)**, приоритет текстов: райды → `manual` → `invite`.
- **RC-P3-6. Две подсказки в своём профиле.** Сейчас при `publicId === null` под «Редактировать профиль» стоит
  `profile.publicHint` («Другие увидят профиль, когда вы укажете имя и включите показ в результатах»). K3 добавляет
  вторую. Варианты: (a) заменить строку `profile.publicHint` блоком `NameHint` (без «Не сейчас»), ключ
  `profile.publicHint` удалить; (b) оставить обе; (c) оставить старую, K3 только на Главной (против K3).
  **Рекомендация (a).** Текст K3 «Добавьте имя» неточен, когда имя есть, а показ выключен — принятая формулировка K3.
  Действие ведёт в «Редактировать профиль», там есть и имя, и согласие.
- **RC-P3-7. Слот подсказки на Главной.** «После разделов по опросу» — значит после выбранных в опросе разделов и до
  невыбранных. При `group_rides` — первой, над всеми разделами (под «Вашими билетами» — они не раздел). Чистая
  функция `socialSlotIndex` (п. 7) — тот же слот получит секция P7.
- **RC-P3-8. «Идёт» непубличному зрителю.** K6 требует только, чтобы зритель был в «своих» у райдера. Непубличный
  зритель увидит планы публичного райдера, хотя сам в его списке не виден. Это соответствует K6, принимается. Косвенно
  раскрывается «он добавил меня» — K10 всё равно уведомляет об этом.
- **RC-P3-9. Строка без `publicId`.** На неё нельзя сослаться и её нельзя убрать по пути с `publicId`. Решение:
  исключить из `items` и `count` (`publicId` выдаётся при первом «имя + согласие», 0033 — бэкфилл). Убрать
  непубличного райдера тоже нельзя: `404`. Он и так скрыт; станет публичным — появится, тогда можно убрать.
- **RC-P3-10. Адрес экрана «Свои».** Варианты: (a) `/social` (новый `app/social.tsx`, гард `useSettingsShell`,
  `SEO_DISALLOW += '/social'`); (b) `/profile/social` — пришлось бы переносить `app/profile.tsx` в
  `app/profile/index.tsx`. **Рекомендация (a);** «Все свои» P7 ведёт туда же.
- **RC-P3-11. Порядок `GET social/connections` (AC3):** `lastRideAt ↓` (без райдов — в конце), `updatedAt ↓`,
  `_id ↓` — как в `ConnectionsRepository.listOf`, без нового индекса (до сотен строк).
- **RC-P3-12. Общие с P2 ключи и компонент подсказки** (сообщение P2): `social.nameHint.title` «Добавьте имя — свои
  увидят вас», `social.nameHint.action` «Добавить имя», `social.nameHint.later` «Не сейчас». Спек P3 называет
  действие «Редактировать профиль» — это **переход** (`/settings/profile`), подпись кнопки — общий ключ «Добавить
  имя». Кто сливается первым, тот добавляет ключи (в конец `ru.ts`) и `features/social/name-hint.tsx`; второй при
  слиянии develop удаляет свои копии. Дубль ключа в объекте `ru.ts` поймает typecheck/lint.

## 8.2 Deviations from spec

Coder, 2026-10-31. Решения оркестратора: RC-P3-1a и RC-P3-2a приняты, остальные RC-P3-* — по рекомендациям architect.
- RC-P3-1a: вместо пары `PUT` + `DELETE` — один `PUT /v1/riders/:publicId/social/connection { connected }` (CORS и
  глагол `DELETE` не трогаются).
- RC-P3-4: «Я иду» из строки «Идёт» — `useRideRsvp` как есть, без `source: 'profile'` (P2 ещё не в develop; решение —
  на FINISH, follow-up отмечен в эпике §3.2).
- RC-P3-12: ключи `social.nameHint.{title,action,later}` и `features/social/name-hint.tsx` добавлены в P3 (в конец
  `ru.ts`); P2 добавляет такие же — дубли убираются при слиянии develop.
- Сверх списка §11: `social.row.together` (подпись строки экрана «Свои» — «Вместе N раз · последний — дата», в
  профиле — `social.together` «Вместе ехали…»), `social.error.unknown` (прочие отказы «В свои»); хуки
  `useNameMissing` (`features/social/queries.ts`, кэш `['profile']`) и `useHomeNameHint` (`name-hint.tsx`); строка
  `/social` в сторожах `__tests__/protected-shell.test.tsx` и `__tests__/app-routes.ts` (правило `pokatim-app.md`).
- Пустое состояние экрана «Свои»: заголовок `social.empty.title` «Пока никого», текст `social.empty.message` «Свои
  появятся после совместного райда или когда вы добавите кого-то из профиля».

## 9. Acceptance Criteria

1. `GET riders/:publicId/social`: `together`, `going` (только при связи `rider → viewer`, не убранной; только будущий,
   не отменённый, не скрытый), `connected`, `self`; `404` для непубличного; `no-store`; без входа — `401`.
2. «В свои» / «Убрать»: лимит 30/24 ч → 429, себе → 409 `self`, непубличный → 404; удаление тихое и идемпотентное;
   связь, убранная вручную, не возвращается пересчётом явки (K1).
3. `GET social/connections`: только публичные и не убранные; источники и «вместе N»; порядок — architect.
4. Приложение: строки K6 на чужом профиле, «Свои · N» и экран «Свои», подсказка K3 в профиле и на Главной с «Не
   сейчас» 14 дней — по jest-тестам экранов; гость — переход на вход.
5. Дубль ключа пары в пересчёте явки — одно поведение для обоих путей, int-тест воротами.
6. `pnpm check` зелёный.

## 10. Documentation Impact

Architect, 2026-10-31:
- `docs/product/profile.md` — R9: раскладка строк K6, гость (только «В свои» → вход), «Свои · N» (видна и при 0),
  экран «Свои» (тексты строк, RC-P3-5; убрать без подтверждения, строка остаётся до ухода), подсказка K3 заменяет
  `profile.publicHint` (RC-P3-6); «Где в продукте — профиль (API)»: `GET /v1/riders/:publicId/social`,
  `PUT /v1/riders/:publicId/social/connection {connected}`, `GET /v1/social/connections`.
- `docs/product/home.md` — подсказка K3 на месте секции «Свои» (слот RC-P3-7), «Не сейчас» — 14 дней на устройстве.
- `docs/product/social.md` — K6: строка «По приглашению» (RC-P3-5); экран — `/social`.
- ADR-0027 п. 3 — форма «В свои»: `PUT …/social/connection {connected}` вместо пары глаголов (RC-P3-1).
- `.claude/rules/pokatim-backend.md` («Свои»): `social → identity` (`AuthGuard`); контроллеры
  `RiderSocialController` (`riders/:publicId/social*`), `SocialConnectionsController` (`social/connections`);
  `RIDES_FOR_SOCIAL.nextRideCard`; RC-P3-2 — «дубль пары в транзакции приходит как `WriteConflict` и повторяется
  `withTransaction`; повторов по `isDuplicateKey` в транзакционных путях нет»; в разделе «Профиль» —
  `riders/:publicId/social*` модуля `social`.
- `.claude/rules/pokatim-contracts.md` — `src/social/rider-social.schema.ts`.
- `.claude/rules/pokatim-app.md` — `/social`, `features/social/`, ключ `pokatim.nameHint`, `socialSlotIndex`.
- Эпик `docs/tasks/2026-10-31-social-stage-0/task.md` — §8.2: LOW P0 закрыт решением RC-P3-2; §3.2: отметка P3,
  follow-up `source: 'profile'` (если P2 не успел, RC-P3-4).
- `pr.md` — новые эндпоинты, совместимость (только новые эндпоинты и поля, миграций нет), правка `SecureKey`.

## 11. Implementation Context

Architect, 2026-10-31 (варианты RC-P3-1a, 2a, 3a, 10a).

**ENTRY POINTS**
- `GET /v1/riders/:publicId/social` → `RiderSocial`; `PUT /v1/riders/:publicId/social/connection` (`200`, тело
  `SetRiderConnectionRequest`) → `RiderSocial`; `GET /v1/social/connections` → `SocialConnections`. Все — `AuthGuard`,
  `Cache-Control: no-store`, `publicId` — `ZodValidationPipe(RiderPublicId, FieldErrorCode)`.
- Приложение: `/riders/<publicId>` (блок K6), `/profile` («Свои · N», K3), `/social` (экран «Свои»), `/` (K3).

**FILES TO CREATE**
- `apps/api/src/modules/social/rider-social.controller.ts` — `@Controller('riders') @UseGuards(AuthGuard)`:
  `GET :publicId/social`, `PUT :publicId/social/connection` (`@HttpCode(200)`). Свой файл (P2 — свой).
- `apps/api/src/modules/social/social-connections.controller.ts` — `@Controller('social') @UseGuards(AuthGuard)`:
  `GET connections`.
- `apps/api/src/modules/social/rider-social.service.ts` — `RiderSocialService`: `view(viewerId, publicId)`,
  `setConnection(viewerId, publicId, connected)`, `connections(ownerId)`; маппинг в DTO явным списком полей (без
  `userId`). Зависимости: `SocialConnectionsService`, `RIDER_PROFILES`, `RIDES_FOR_SOCIAL`, `CLOCK`.
- `apps/api/src/modules/social/rider-social.int.test.ts` — HTTP (см. TESTS).
- `packages/contracts/src/social/rider-social.schema.ts` + `rider-social.schema.test.ts`.
- `packages/api-client/src/social.test.ts`.
- `apps/app/src/app/social.tsx` — `useSettingsShell() ?? <SocialScreen />`.
- `apps/app/src/features/social/{queries.ts,social-screen.tsx,name-hint.tsx,name-hint-state.ts,name-hint-storage.ts,name-hint-storage.web.ts,social-format.ts,rider-social-block.tsx}`
  (+ `name-hint-state.test.ts`, `name-hint-storage.web.test.ts`, `social-format.test.ts`).
- `apps/app/src/__tests__/social-screen.test.tsx`.

**FILES TO MODIFY** (в общих файлах — только добавления в конец списков)
- `social/social.module.ts` — `SocialModule`: `imports += IdentityModule`, `controllers += [RiderSocialController,
  SocialConnectionsController]`, `providers += [RiderSocialService]` (P2 добавляет рядом свой — при слиянии оставить
  оба). `SocialCoreModule` не меняется.
- `social/connections.service.ts` — убрать повтор `isDuplicateKey` из `addManual` (RC-P3-2a); добавить
  `pairState(viewerId, otherId): Promise<{ connected: boolean; together: Together; inTheirs: boolean }>` (две
  `findPair`; `connected` / `inTheirs` — документ есть и `removedAt === null`). `togetherOf` оставить.
- `social/connections.repository.ts` — комментарий `CONNECTIONS_UNIQUE_INDEX` (дубль в транзакции — `WriteConflict`);
  импорт `isDuplicateKey` остаётся для `remove`.
- `rides/rides-for-social.port.ts` — `nextRideCard` сразу после `rideFacts` (RC-P3-3); `rides/rides-for-social.ts` —
  реализация (инжект `RIDE_ROUTES`, `RideReportsRepository`, `CLOCK` не нужен — `now` параметром);
  `rides/rides.repository.ts` — `nextOfRider(riderId, viewerId, now)` рядом с `pastFactsOf`;
  `rides/rides-feed.service.ts` — экспорт `rideCardOf(doc, userId, now, routes, reported): RideCard` и его
  использование в `list` (без копии `summaryOf + viewerOf`).
- `packages/contracts/src/index.ts` += `export * from './social/rider-social.schema.ts';` (в конец).
- `packages/api-client/src/index.ts` — в конец объекта клиента: `getRiderSocial(token, publicId)`,
  `setRiderConnection(token, publicId, body)` (`PUT`, как `completeDevicesStep`), `listSocialConnections(token)`.
- `packages/i18n/src/ru.ts` — в конец: `social.nameHint.{title,action,later}` (если ещё нет, RC-P3-12),
  `social.together` (плюрал `{count}` раз, `{date}`), `social.going.kicker` «Идёт», `social.connect` «В свои»,
  `social.connected` «В своих», `social.count` «Свои · {count}», `social.title` «Свои», `social.row.manual`
  «Добавлены вами», `social.row.invite` «По приглашению», `social.empty.title` / `social.empty.message`
  («Пока никого. Свои появятся после совместного райда или когда вы добавите кого-то из профиля»),
  `social.failed`, `social.error.RATE_LIMITED` «Слишком много действий, попробуйте позже». Удалить
  `profile.publicHint` (RC-P3-6).
- `apps/app/src/features/riders/rider-screen.tsx` — `RiderSocialBlock` в `RiderBody` под шапкой (props: `id`,
  `session`), refetch в `refetchers` при `viewerEnabled`.
- `apps/app/src/features/profile/own-profile-screen.tsx` — строка «Свои · N» (`AsyncContent` по
  `useSocialConnections`, нажатие → `/social`), `NameHint` вместо `profile.publicHint`, refetch.
- `apps/app/src/app/(tabs)/index.tsx` — `NameHint` с «Не сейчас» в слоте `socialSlotIndex` при условиях п. 7.
- `apps/app/src/features/home/sections.ts` (+ `sections.test.ts`) — `socialSlotIndex`.
- `apps/app/src/features/auth/secure-storage.ts` — `'pokatim.nameHint'` в конец `SecureKey` (комментарий как у
  `pushSoftPrompt`).
- `apps/app/src/app/_layout.tsx` — `<Stack.Screen name="social" />` рядом с `profile`.
- `apps/app/src/lib/seo.ts` — `'/social'` в группу «только вошедшим»; `__tests__/seo-routes.test.ts` — по факту.
- `apps/app/src/__tests__/{rider-profile,own-profile,home,auth-guard}.test.tsx`, `apps/app/e2e/web.spec.ts`.

**FILES TO READ (образцы)**
- `profile/rider-reports.controller.ts` — путь под чужим ресурсом, pipe `publicId`, `no-store`.
- `rides/rider-rides.ts` + `rides.repository.ts:pastFactsOf` — выборка райдов райдера по `rides_participant_idx`.
- `rides/rides-feed.service.ts:list` — сборка `RideCard` (маршрут, `reported`, зритель).
- `features/riders/queries.ts:useRiderViewer` / `useReportRider` — запрос зрителя и `setQueryData` из ответа мутации.
- `features/notifications/push-soft-prompt-*.ts` — отложка «Не сейчас» на устройстве.
- `social/social-attendance.int.test.ts` («гонка двух отметок») — ворота `gate` / `retried` / `untilBlocked`.

**TYPES & SCHEMAS** (`packages/contracts/src/social/rider-social.schema.ts`)
```ts
import { RideCard } from '../rides/ride.schema.ts';
import { AvatarId, RiderPublicId } from '../profile/rider-avatar.schema.ts';
import { CONNECTION_SOURCES } from './social.schema.ts';

/** «Вместе ехали» относительно зрителя (K6): 0 и null — не ехали. */
export const RiderTogether = z.object({
  rideCount: z.number().int(),
  lastRideAt: z.iso.datetime().nullable(),
});
/** `GET /v1/riders/:publicId/social` и ответ `PUT …/connection` (вошедший зритель, no-store). */
export const RiderSocial = z.object({
  self: z.boolean(),
  /** зритель держит связь viewer → rider (не убрана) */
  connected: z.boolean(),
  together: RiderTogether,
  /** ближайший будущий райд райдера — только если зритель у него в «своих»; иначе null */
  going: RideCard.nullable().default(null),
});
/** `PUT /v1/riders/:publicId/social/connection` — «В свои» (true) / «Убрать из своих» (false); лишние ключи — 400. */
export const SetRiderConnectionRequest = z.strictObject({ connected: z.boolean() });
/** Строка «Свои» (K6): только публичные профили, без userId. */
export const SocialConnectionRow = z.object({
  publicId: RiderPublicId,
  name: z.string(),
  avatar: z.object({ id: AvatarId }).nullable(),
  rideCount: z.number().int(),
  lastRideAt: z.iso.datetime().nullable(),
  sources: z.array(tolerantEnum(CONNECTION_SOURCES)),
});
/** `GET /v1/social/connections`: порядок — RC-P3-11; count = items.length (этап 0 без пагинации). */
export const SocialConnections = z.object({
  items: z.array(SocialConnectionRow),
  count: z.number().int(),
});
// + типы z.infer
```

Порт `rides` (добавление в `RidesForSocial`, сразу после `rideFacts`):
```ts
/**
 * «Идёт» (K6, P3): ближайший опубликованный райд со стартом позже `now`, где `riderId` — участник «Иду» (организатор —
 * первый участник), `startsAt ↑, _id ↑`; карточка со зрителем `viewerId` (роль, canJoin — `rideViewer`). Нет — null.
 */
nextRideCard(riderId: string, viewerId: string, now: Date): Promise<RideCard | null>;
```
Репозиторий: `findOne({ 'participants.userId': riderId, status: 'published', startsAt: { $gt: now } },
{ projection: viewerProjection(viewerId), sort: { startsAt: 1, _id: 1 } })` — индекс `rides_participant_idx`.

Сервис `RiderSocialService.view`: `findPublic(publicId)` (нет — `404 NOT_FOUND`) → `self` (`target.userId ===
viewerId` — `{ self: true, connected: false, together: {0, null}, going: null }`) → `pairState(viewer, rider)` →
`going = inTheirs ? nextRideCard(rider, viewer, now) : null`.

**TESTS**

Unit:
- `rider-social.schema.test.ts` — `RiderSocial` без `going` → `null`; незнакомый источник → `'unknown'`;
  `SetRiderConnectionRequest`: `{}` и лишний ключ — отказ.
- `api-client/src/social.test.ts` — URL (`publicId` кодируется), метод, Bearer, тело `PUT`, разбор ответа.
- `features/home/sections.test.ts` — `socialSlotIndex`: `group_rides` → 0; `races` + `routes` → 2; ничего → 0;
  `reasons undefined` → null / нет слота.
- `name-hint-state.test.ts` — видимость: не откладывали; отложка −14 дн +1 мс (скрыта) и ровно 14 дн (видна); битое
  значение — отложки нет; `undefined` (читается) — скрыта. `name-hint-storage.web.test.ts` — как у push-подсказки.
- `social-format.test.ts` — плюралы «1 раз / 2 раза / 5 раз», дата по Минску (с годом и без), приоритет текстов
  RC-P3-5.

Int на реальном MongoDB (`createHarness()`, HTTP через стенд, как `profile-reports.int.test.ts`):
- `rider-social.int.test.ts`:
  - без токена — `401` на все три; заголовок `no-store` на всех ответах (и `200`, и `404`);
  - неизвестный `publicId` и профиль, где согласие отозвано после выдачи `publicId`, — одинаковый `404` (GET и PUT),
    документа связи нет;
  - свой `publicId` — `self: true`, остальное пустое; `PUT {connected: true|false}` себе → `409
    SOCIAL_ACTION_BLOCKED {reason: 'self'}`, документов нет;
  - `together` — после общего райда с явкой обоих (`pastRide` + `markManual` ×2): `rideCount 1`, `lastRideAt` = старт;
    после «Убрать» — `together` тот же, `connected: false`;
  - `going`: у райдера два будущих райда (ранний — участник, поздний — организатор) + отменённый и скрытый раньше
    них + прошедший → ранний; без связи `rider → viewer` — `null`; райдер добавил зрителя — карточка; райдер убрал —
    `null`; только `viewer → rider` — `null`; зритель записан — `viewer.role: 'participant'`, `canJoin: false`;
    ответ проходит `RiderSocial.strict`-проверку полей (нет `participants`, `userId`);
  - `PUT {connected:true}` → `connected: true`; повтор — `200` без второго события `connection-created`; 31-я попытка
    за сутки — `429 RATE_LIMITED`; `{connected:false}` → `false`, повтор — `200`; после «Убрать» снятие и повторная
    отметка явки на общем райде связь не возвращают (K1);
  - тело `{}` / `{connected:'yes'}` / лишний ключ — `400`;
  - `GET social/connections`: порядок RC-P3-11 (два райда разной даты, ручная без райдов — в конце); непубличный
    другой и убранная связь — не в `items` и не в `count`; `sources` (`['ride','manual']`, `['invite']`);
    в JSON ответа нет ни одного `userId` стенда.
- `social-connections.int.test.ts`, `describe('дубль пары в транзакции (RC-P3-2)')`:
  - **ворота в пересчёте явки:** прошедший райд R с A и B, явка A уже отмечена; `markManual(B, R)` —
    `vi.spyOn(ConnectionsRepository, 'applyRideDiff')`: первый вызов ждёт `gate()` (снимок транзакции B уже установлен: явка записана, `pairsOfRide`
    прочитаны); пока он стоит, `addManual(A, B)` коммитит документ A→B (`true`); `hold.open()` → отметка B
    завершается `true`. Проверки: `applyRideDiff` вызван ≥ 2 раз (повтор `withTransaction`), документ A→B один:
    `manualAt ≠ null`, `rideCount 1`, `rides = [R]`; B→A `rideCount 1`; событий `connection-created`: `manual` — 1,
    `ride` — 1 (только B→A);
  - **ворота в `addManual`:** `vi.spyOn(ConnectionsRepository, 'upsertManual')` — первый вызов выполняет запись и
    ждёт ворот до коммита; второй `addManual(A, B)` упирается в незакоммиченную запись (`untilBlocked` + `retried`);
    открыть → `[true, false]` (порядок по завершению), один документ, одно событие `manual`.
  - **Отрицательное доказательство (временно, не коммитить; результат — в §12):** заменить в
    `attendance.service.ts` / `connections.service.ts` `transactions.run` на одну попытку без повтора
    (`client.withSession(s => { s.startTransaction(); …; s.commitTransaction() })`) — оба теста красные с `code 112
    WriteConflict` за доли секунды, не таймаут; откат — зелёные. Отдельно: удаление повтора `isDuplicateKey` из
    `addManual` при обычном `run` — тесты остаются зелёными (повтор был мёртвым кодом).
- `rides-for-social.int.test.ts` += `nextRideCard`: ранний будущий из участия и организации; отменённый, скрытый,
  прошедший пропущены; роль зрителя (`none` / `participant` / `organizer`); чужой непубличный маршрут — `route:
  null`; нет райдов — `null`.

Jest экранов (`apps/app/src/__tests__/`):
- `rider-profile.test.tsx` += K6: «Вместе ехали 3 раза · последний — 10 октября» при N > 0, нет строки при 0;
  «Идёт» со строкой райда и «Я иду» → `POST …/join`, затем «Вы идёте» (перезапрос `social`); «В свои» →
  `PUT {connected:true}` → «В своих», повтор → `{connected:false}`; `429` — текст у кнопки; `self` — блока нет;
  гость — только «В свои» → `/sign-in` с возвратом на профиль, запроса `social` нет; скелетон на месте блока; ошибка
  блока — баннер с повтором, профиль виден.
- `own-profile.test.tsx` += «Свои · 0» видна и ведёт на `/social`; «Свои · 2»; подсказка K3 при `publicId: null` с
  переходом в `/settings/profile`, без «Не сейчас»; публичному — нет; старой `profile.publicHint` нет.
- `social-screen.test.tsx` — строки трёх видов текста; нажатие строки → `/riders/<publicId>`; «В своих» → `PUT
  false`, строка остаётся с «В свои», повтор → `PUT true`; пусто — текст пустого состояния; скелетон; ошибка с
  повтором; уход с экрана инвалидирует `['social']`.
- `home.test.tsx` += подсказка: при `group_rides` — до первого раздела; при `races` — после «Гонок», до остальных;
  публичному и гостю — нет; «Не сейчас» скрывает и пишет отложку; отложка 13 дней назад — скрыта, 15 — видна.
- `auth-guard.test.tsx` += `/social` без сессии — лендинг.

e2e: `apps/app/e2e/web.spec.ts` += «`/social` без сессии: HTML без данных и OG, после гидрации — гард входа» (как
блок достижений; без API — «Нет соединения»). Сценария «с API» не нужно.

Изоляция: свой MongoDB и Redis db (`MONGO_URL_TEST=…/pokatim_social_p3_test…`, `REDIS_URL_TEST=…/<N>`), int-тесты
лимита — ключи `social-manual:<uid>` по `uid` теста.

**OUT OF SCOPE (P3):** уведомление «Вас добавили в свои» и «не уведомлять повторно 30 дней» (P1/P7); секция «Свои» на
Главной и `GET social/home` (P7); участники, явка, `JoinRideRequest.source` (P2 — P3 только передаёт `'profile'`,
RC-P3-4); реакции (P4); приглашения и код (P6); пагинация списка; `DELETE`-глагол и правка CORS; серверное хранение
«Не сейчас»; новые индексы и миграции.

## 12. Outcome

Coder, 2026-10-31 (P3). Не закоммичено. Полный `pnpm check` не запускался (по указанию оркестратора — один раз на
FINISH).

**Сделано по AC:**
- AC1–AC3 (API, `social`): `RiderSocialController` (`GET riders/:publicId/social`, `PUT …/social/connection
  {connected}`), `SocialConnectionsController` (`GET social/connections`), `RiderSocialService`; `SocialModule` +
  `IdentityModule`, `ProfileCoreModule`, `RidesCoreModule`. `SocialConnectionsService.pairState`. Порт
  `RIDES_FOR_SOCIAL.nextRideCard` (после `rideFacts`) → `RidesRepository.nextOfRider` (рядом с `pastFactsOf`) →
  `rideCardOf` (экспорт `rides-feed.service.ts`, им же собирает карточки `list`).
- Контракты: `src/social/rider-social.schema.ts` (+ тест), экспорт в конце `index.ts`; api-client —
  `getRiderSocial`, `setRiderConnection` (`PUT`), `listSocialConnections` (+ `social.test.ts`).
- AC4 (приложение): блок K6 `features/social/rider-social-block.tsx` на `/riders/[id]`; «Свои · N» и подсказка K3
  (вместо `profile.publicHint`, ключ удалён) в `/profile`; экран `/social` (`app/social.tsx`, `_layout`,
  `SEO_DISALLOW`); подсказка на Главной в слоте `socialSlotIndex` с «Не сейчас» 14 дней (`pokatim.nameHint`,
  `name-hint-{state,storage,storage.web}.ts`); i18n — в конце `ru.ts`.
- AC5 (RC-P3-2a): повтор по `isDuplicateKey` из `addManual` убран, комментарий `CONNECTIONS_UNIQUE_INDEX`
  исправлен; два int-теста воротами в `social-connections.int.test.ts` (`дубль пары в транзакции (RC-P3-2)`).
- Документы: `profile.md` (R9, API), `home.md`, `social.md` (K6), ADR-0027 п. 3, `.claude/rules/pokatim-{backend,
  contracts,app}.md`, эпик (§8.2 — LOW закрыт, §3.2 — отметка P3 и follow-up `source: 'profile'`).

**Проверки (изоляция: `pokatim_social_p3_test`, Redis db 10):**
- `vitest run src/modules/social src/modules/rides` (api) → `Test Files 20 passed (20)`, `Tests 209 passed (209)`;
  отдельно `rider-social.int.test.ts` → 11 passed, `rides-for-social.int.test.ts` → 8 passed,
  `social-connections.int.test.ts` → 10 passed.
- `pnpm --filter @pokatim/contracts test` → `54 passed`, `497 passed`; `api-client test` → `24 passed`, `180 passed`;
  `i18n test` → `2 passed`, `16 passed`.
- jest (app): rider-profile, own-profile, home, social-screen, auth-guard, protected-shell, seo-routes, rides,
  rider-links, `features/{social,home,notifications}` → `Test Suites: 24 passed`, `Tests: 337 passed`.
- `tsc --noEmit`: contracts, api-client, i18n, api, app — без ошибок. `eslint --max-warnings=0` по изменённым файлам —
  0 проблем; `prettier --check` — чисто; `pnpm arch:check` → `no dependency violations found (2403 modules, 9605
  dependencies cruised)`.
- e2e `/social` без сессии (`e2e/web.spec.ts`) — добавлен, **NOT VERIFIED** (нужен `build:web` + браузер).
- Ручная проверка на симуляторе и в браузере — **NOT VERIFIED**.

**Отрицательные доказательства:**
- `rider-social.int.test.ts`: `going` без проверки `inTheirs` и без ветки `self` → 2 теста красные («свой publicId…»,
  «ближайший будущий райд…»); откат — зелёные.
- RC-P3-2: `transactions.run` в `attendance.service.ts` и `connections.service.ts` заменён на одну попытку
  (`client.withSession` + `startTransaction` / `commitTransaction`) → оба теста ворот красные за доли секунды
  (622 мс на файл), ошибка `112 WriteConflict` с меткой `TransientTransactionError` (лог ошибки в обоих путях), не
  таймаут; откат — зелёные. Повтор `isDuplicateKey` в `addManual` удалён при обычном `run` — тесты зелёные (повтор был
  мёртвым кодом).

**Наблюдение:** `auth-guard.test.tsx` «без сессии новый гость видит лендинг» один раз упал при параллельном прогоне
восьми наборов (нагрузка), два повторных одиночных прогона — 15/15; код теста P3 не трогает.
