# «Свои», P7 — Главная «Свои», привязка уведомлений K10, активный день (K7, K10, K12)

Уровень: task3. Эпик — `docs/tasks/2026-10-31-social-stage-0/task.md` (строка P7 таблицы §3.2, RC-12, RC-13, RC-14,
правило параллельных PR), продукт — `docs/product/social.md` K5, K7, K10, K11, K12, `docs/product/home.md` «Свои»,
архитектура — ADR-0027 п. 1, 3, 6, 7. В develop (merge `aaf9da74`): P0 (#158), P1 (#172), P2 (#175), P3 (#176),
P6 (#174), P4 (#183), P5 (#184). P7 закрывает этап 0.

## 1. Title

Секция «Свои» на Главной, отправка шести уведомлений группы «Свои» и событие «активный день» в журнале метрик.

## 2. Goal

Райдер видит на Главной, что делают его «свои» (идут на райд, результат гонки, новый маршрут), и получает push
группы «Свои» на все события K10. Журнал метрик закрытого теста получает «активный день» — последнее событие K12.

## 3. Scope

1. **`GET /v1/social/home`** (`social`, `AuthGuard`, `no-store`, лимит чтения) — до трёх строк K7 и признак «есть ещё»
   (для «Все свои»). Контракт — `packages/contracts/src/social/home.schema.ts`, экспорт из корня в конец. Строки:
   - **ride** — «Катя Л. и ещё 2 идут» → опубликованный неотменённый нескрытый райд со стартом в ближайшие 7 дней, где
     участники «Иду» (или организатор) — мои «свои» с публичным профилем; в строке — карточка райда (как лента, с
     состоянием зрителя для «Я иду»), до N публичных «своих» (имя, аватар, `publicId`) и число остальных «своих»
     в райде;
   - **result** — «Андрей К. · 1:59:40» → результат «своего» в протоколе, опубликованном за последние 7 дней (только
     видимая строка, имя — только при публичном профиле и согласии на показ в результатах, как таблица); если зритель
     в той же гонке и группе — разница «на N быстрее/медленнее вас» (сервер считает, клиент только форматирует);
   - **route** — «Новый маршрут от Сергея К.» → маршрут райдера (`origin: rider`), опубликованный в каталоге за
     последние 7 дней, автор — «свой» с публичным именем и согласием на показ автора.
   «Свои» — исходящие связи зрителя (`ownerId = зритель`, без `removedAt`), только публичные (K3). Нет строк — пустой
   ответ (секция скрыта). Порядок строк внутри секции и отбор трёх из многих — решает architect (8.1), детерминированно.
   Данные чужих модулей — только порты `*_FOR_SOCIAL` (новые методы `RIDES_FOR_SOCIAL`, `RESULTS_FOR_SOCIAL`,
   `ROUTES_FOR_SOCIAL`), коллекции `rides`, `race_entries`, `routes` `social` не читает.
2. **Клиент `apps/app`** — секция «Свои» на Главной в слоте `socialSlotIndex` (`home/sections.ts`, сейчас там
   подсказка имени K3): при «Кофе-райдах» в опросе — первой, иначе после разделов по опросу. Подсказка имени K3
   остаётся (у райдера без публичного имени) — architect решает раскладку «подсказка + секция» в одном слоте.
   Строки ведут на существующие объекты (карточка райда, карточка гонки/результата, карточка маршрута), «Я иду» —
   `joinRide(…, 'social')` (источник K12 «секция Свои»), «Все свои» → `/social`. Ошибка запроса — секция скрыта, без
   ошибки на Главной (`home.md` Q2). i18n — `packages/i18n` (в конец), a11y-подписи, все платформы.
3. **Уведомления K10 → intake** (правки `notification-intake.ts`, `notification-texts.ts`, `notifications.policy.ts`
   разрешены в P7). `social` пишет outbox `social.*` в транзакции действия, `notifications` объявляет маршрут
   (`notificationsOutboxRoutes`) и строит черновик через `socialNoticeDraft` (P1):
   - `social_thanks` — при новой реакции `thanks` (`SocialReactionsService.insert`), получателю, окно — райд;
   - `social_respect` — при новой реакции `respect`, владельцу результата / автору маршрута, окно — цель в сутки;
     название гонки / маршрута — портами при приёме;
   - `social_added` — при ручном «В свои», добавленному; не уведомлять, если тот же владелец уже добавлял этого
     человека вручную за последние `manualRenotifyMs` (30 дн, K11); окно — сутки;
   - `social_invite_registered` — после `linkInvite` в `InviteIntake` (`linked`), пригласившему; окно — сутки;
   - `social_ride_ask` — `RIDE_ASK_DUE.due(tx, …)` (P5) пишет outbox в переданной `tx` вместо заглушки
     `LoggingRideAskDue`; адресаты уже отобраны; окно — райд;
   - `social_riders_going` — из существующего `rides.participant-joined` (уже идёт в `notifications-intake`): аудитория —
     владельцы связей к записавшемуся (`rider_connections_other_idx`: `otherId = записавшийся`, без `removedAt`), кроме
     идущих на этот райд и самого записавшегося; порт аудитории `social` для `notifications` (ADR-0027 п. 6,
     «Последствия»: Nest-импорт `social` в `notifications` появляется в P7). Окно — райд.
   Тексты — `SOCIAL_NOTICE_KINDS` (P1), имена — при чтении. Новые `kind`, цели, группы не заводятся (они есть с P1).
   Неживые получатели и выключенный тумблер `push.social` — как в остальных группах.
4. **Очереди (RC-13).** `BullModule.registerQueue` и процессоры `social-maintenance` / `social-intake` — только в
   `social/*` (`SocialWorkerModule`, одна `registerQueue` с P5). `worker.module.ts` и `app.module.ts` не меняются,
   кроме объединения маршрутов outbox, если новых подписчиков нет — без правок.
5. **Активный день (K12)** — событие `active-day` в `product_events`: первый авторизованный запрос райдера за сутки по
   Минску, дедуп в Redis на сутки (ADR-0027 п. 7). Пишет `identity` (`AuthGuard` / слой сессии) через порт
   `PRODUCT_EVENTS.record`, вне пути ответа: сбой — лог `product_events.record_failed type=active-day`, запрос не
   падает и не ждёт записи дольше разумного. `props` — без чужих userId (RC-12).
6. **RC-14** — новое ребро `identity → product-events`: правка контекста ADR-0027 («identity ни от кого, кроме tokens,
   не зависит»), правило dependency-cruiser (если ограничивает), `.claude/rules/pokatim-backend.md`.
7. **Документы** — ADR-0027 (п. 3 `GET social/home`, п. 6 привязка, п. 7 активный день, контекст RC-14),
   `docs/product/social.md` / `home.md` — только уточнения без смены поведения, правила `.claude/rules/*`
   (`pokatim-backend.md` «Свои» и «Уведомления», `pokatim-app.md` Главная, `pokatim-contracts.md`), записка в §12.

## 4. Out of Scope

Настройка «Выше / Ниже» секции (этап 0 — нет). Новые виды уведомлений, группы, экраны настроек (P1). Изменения
публичных кэшируемых ответов. Telegram, e-mail для группы «Свои» (N4). Ретро-отправка «Как прошёл райд?» для райдов,
захваченных до выката P7 (RC-P5-11). Выгрузка метрик (скрипт — отдельно). Фильтр «Свои» в таблицах (S-06).

## 5. Architecture Context

- `social` остаётся потребителем (ADR-0027 п. 1): `rides`, `results`, `routes`, `races`, `profile`, `identity` о `social`
  не знают. Новое Nest-ребро `notifications → social` (`NotificationsWorkerModule.imports += SocialCoreModule`) —
  разрешено `social-consumers-only`; цикла нет: `social` не импортирует `notifications` ни файлами, ни модулями.
- Уведомления: `social` **пишет** outbox `social.*` в транзакции действия, `notifications` **объявляет** маршрут
  (`notificationsOutboxRoutes`, в конец) и разбирает событие в `NotificationIntake.drafts` через `socialNoticeDraft`
  (P1). Получателей, лиц и состояние «сейчас» `notifications` читает портом `SOCIAL_NOTICES` (новый, `social`),
  названия — существующими портами `RIDE_NOTICES`, `RACE_REGISTRY`, `ROUTE_NOTICES` и одним новым методом
  `RESULTS_NOTICES.entryRace`. «Свои идут» — из существующего `rides.participant-joined` (новой записи в `rides` нет).
- `GET social/home` — HTTP `SocialModule` (там уже `ResultsCoreModule`/`RoutesCoreModule`, RC-P4-12): данные чужих
  модулей — новыми методами `RIDES_FOR_SOCIAL`, `RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL`; ответ — чистая сборка
  `social-home.view.ts`.
- Активный день — `identity` (`AuthGuard` → `ActiveDay`), ребро `identity → product-events` (RC-14):
  `product-events` остаётся листом (правило `product-events-leaf` ограничивает исходящие рёбра, не входящие).
- Очереди: новых очередей и процессоров нет; `RIDE_ASK_DUE` получает реализацию outbox в `SocialWorkerModule`.
  `worker.module.ts`, `app.module.ts`, `outbox-routes.ts` не меняются (маршруты `social.*` — внутри
  `notificationsOutboxRoutes`).

## 5.1 Placement & Reuse Gate

- **Placement.** Бэкенд — `apps/api/src/modules/{social,notifications,identity,rides,results,races,routes}`; контракт
  — `packages/contracts/src/social/home.schema.ts`; клиент — `apps/app/src/features/social/` (секция и её строки) +
  композиция в `app/(tabs)/index.tsx`. Новых пакетов нет (один потребитель). Кандидатов в app-foundation нет.
- **Reuse (обязательно):** `socialNoticeDraft`, `SOCIAL_NOTICE_KINDS`, `planFanout`/`writeNotices` (P1, без правок);
  `MongoOutboxWriter.append(tx, …)` (как `AccountConfirmation`, `RidesService.writeWithEvent`); `rideCardOf` +
  `lookupRoutes` (как `nextRideCard`); `publicTableMode`/`isPublicProtocolRow`/`protocolRevision` (как `publicRow`);
  `IN_CATALOG` + карточка каталога (`toCatalogCard`/`authorOf` в `routes-public.service.ts`); `RIDER_NAMES.publicRiders`;
  `SocialConnectionsService.listOf`; `consumeUserLimit`; `minskToday`/`addLocalDays`/`minskDayStartUtc` (contracts);
  Redis `SET … EX … NX` по образцу `story-card.cache.ts` (`REDIS` из `@rkarakulov/api-kit/core`). Клиент:
  `RideListRow`, `RideGoingAction`, `useRideRsvp(id, 'social_home')`, `GoingStack`, `RouteListCard`, `SectionHeader`,
  `TextAction`, `NameHint`/`useHomeNameHint`, `RideRiderRow` (contracts), `CatalogRouteCard`, `RideCard`.
- **Запрещённые дубли:** второй путь записи уведомлений мимо `writeRecipients`; своя формула окна/дня по Минску; чтение
  `rides`/`race_entries`/`race_protocol_rows`/`routes`/`races` из `social`; второй предикат видимости строки протокола
  или каталога; свои DTO вместо `RideCard`/`CatalogRouteCard`/`RideRiderRow`; своя стопка аватаров и строка райда на
  клиенте; второй `registerQueue` в `social`; Redis-клиент «по месту» вместо `REDIS`.

## 6. Relevant Files

См. §11.6 (FILES TO READ) и §11.2/§11.3.

## 7. Implementation Notes

- Порядок коммитов (один PR): (1) события `social.*` + `SOCIAL_NOTICES` + intake; (2) K11 `manualNoticeAt`;
  (3) `RIDE_ASK_DUE` → outbox; (4) активный день; (5) порты и `GET social/home` + контракт + миграция индекса;
  (6) клиент; (7) доки/правила. Каждый шаг — с тестами своего AC.
- Payload `social.*` — только id (и `userIds` у «Как прошёл райд?»): ни имён, ни названий, ни кодов приглашений.
- Intake читает состояние «сейчас» (реакция снята, связь убрана, райд скрыт — без уведомления), payload — только ключи.
- Все новые запросы — по существующим индексам, кроме `races_protocol_published_idx` (RC-P7-16); каждый — с
  отрицательным доказательством `explain` в int-тесте.
- Изоляция тестов: `MONGO_URL_TEST='mongodb://127.0.0.1:27117/pokatim_social_p7_test?replicaSet=rs0&directConnection=true'`,
  `REDIS_URL_TEST='redis://127.0.0.1:6479/11'`.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` «Свои идут» — только когда записавшийся публичен (непубличный «своим» не виден, K3); push не уходит
  тем, кто уже идёт на райд, и организатору этого райда. Отмена записи уведомление не отзывает.
- `[ASSUMPTION]` Строка ride на Главной показывается и тем, кто уже идёт (кнопка — состояние «Вы идёте»), чтобы секция
  не пропадала после «Я иду»; architect подтверждает в 8.1.
- `[ASSUMPTION]` «Вас добавили» и «Респект» — только при новой записи (повтор / снятие и повторная постановка
  респекта в окне — без нового push, схлопывание P1 копит лиц).
- Риск: «Свои идут» на популярном райде — аудитория = сумма входящих связей; fan-out пачками P1 (`fanoutChunk`).
- Риск: активный день на каждом запросе — один `SET NX` Redis на запрос; architect выбирает место (guard или
  interceptor) так, чтобы не задеть публичные и панельные ручки.
- Риск: результат «своего» и разница со зрителем — места и время только из `results` (без второго расчёта).

## 8.1 Requirements Consistency (заполняет architect)

Статус: **CONCERNS, блокеров нет.** Один продуктовый вопрос к пользователю (RC-P7-1) имеет безопасное значение по
умолчанию и coder не останавливает. Остальное — уточнения спеки по коду с решением.

- **RC-P7-1 `[ASSUMPTION]` (вопрос к пользователю). «Свои идут» обходит правило K6 «Идёт».** На профиле «Идёт» видно,
  только если зритель у райдера в «своих» (связь райдер → зритель, `pairState.inTheirs`, P3). Спека P7 для строки ride
  и push берёт исходящие связи зрителя (зритель → райдер). Ручное «В свои» — без подтверждения (K1), значит любой
  вошедший, добавив публичного райдера, получал бы push с райдом, временем и местом каждый раз, когда тот записался.
  Это то, что K6 закрыл. Райд/приглашение создают связь в обе стороны, разница — только у ручной связи и у убранной
  одной стороной. Варианты: (a) **взаимная связь** для райдов: строка ride и push «Свои идут» — только если
  записавшийся тоже держит связь к зрителю/получателю (не убрана); результаты и маршруты (публичные данные) — по
  исходящей; (b) как в спеке — только исходящая (модель подписки K1), принять риск; (c) исходящая, но только для связей
  с источником `ride`/`invite`. **Рекомендация — (a)**, по умолчанию coder делает (a). Правка K7/K10 в
  `social.md` — одной фразой «райды — при взаимной связи, как „Идёт“ K6» после ответа пользователя.
- **RC-P7-2. `rides.participant-joined` без `userId`.** Payload — `{ rideId, seq }` (RC-3 райдов). Записавшийся
  восстанавливается без правок `rides`: `seq` участника = `noticeSeq` после его «Я иду» = `seq` события
  (`rides.repository.ts` join, `writeWithEvent`). Intake: `ride.participants.find(p => p.seq === event.seq)`; событие
  без `seq` (старое) или участник уже вышел — без «Свои идут». Повторный вход — новый `seq`, лицо уже в `actors` окна
  — без нового push (P1).
- **RC-P7-3. Аудитория «Свои идут».** `SOCIAL_NOTICES.goingAudience(joinerId)` = владельцы связей к записавшемуся
  (`rider_connections_other_idx`, `removedAt: null`) ∩ (по RC-P7-1a) те, к кому записавшийся сам держит связь
  (`owner_other_unique`). Минус организатор, все текущие участники и сам записавшийся — фильтр в intake по
  `RideNotice`. Записавшийся непубличный (`RIDER_NAMES.publicRiders`) — без черновика (§8, K3). Получатели «Новый
  участник» (организатор) и «Свои идут» не пересекаются — уникальный `(sourceEventId, userId)` не конфликтует.
  Неживые и выключенный `push.social` — общий `writeRecipients`. Большая аудитория — `planFanout` P1.
- **RC-P7-4. `drafts` не знает id события.** `socialNoticeDraft` требует `eventId` (окно по времени uuidv7).
  **Решение:** `NotificationIntake.drafts(type, payload, now, eventId)`; процессор передаёт `eventId` (одна строка в
  `notifications-intake.processor.ts`). Другие ветки параметр не используют.
- **RC-P7-5. Схема событий `social.*`** (`social.events.ts`, экспорт из `social/index.ts`, маршруты — только в
  `notificationsOutboxRoutes`, в конец; `socialOutboxRoutes` не меняется — `social` не подписчик своих событий):
  - `social.reaction-created { reactionId }` — в транзакции `SocialReactionsService.insert` (и thanks, и respect).
    Intake читает реакцию портом «сейчас»: снята до приёма — `gone`, без уведомления;
  - `social.connection-added { ownerId, otherId }` — в транзакции `addManual`, только при K11 (RC-P7-7);
  - `social.invite-registered { inviterId, inviteeId }` — в транзакции `linkInvite`, только при `registered = true`
    (`already_linked` — без события, AC4). Пишет `linkInvite`, а не `InviteIntake` после коммита: outbox — в той же
    транзакции (AGENTS §4.5). Комментарий-точку в `invite-intake.ts` убрать;
  - `social.ride-ask-due { rideId, userIds[1..RIDE_MAX_PARTICIPANTS] }` — `OutboxRideAskDue.due(tx, ask)`.
    `userIds` в payload допустимы (id, как `identity.account-confirmed`): адресаты отобраны в транзакции захвата P5.
- **RC-P7-6. Названия при приёме.** Райд — `RIDE_NOTICES.ride(id).title`; маршрут — `ROUTE_NOTICES.publication(id)
  .title` (респект — только маршрутам райдера, они подавались); гонка — `RACE_REGISTRY.get(raceId).title`, но у
  реакции `race_entry` есть только `entryId`. Варианты: (a) `RESULTS_NOTICES.entryRace(entryId) → raceId | null`
  (порт `results` для `notifications`, `findEntryById`); (b) `raceId` в payload — `RespectTarget`/`ReactionKey` его не
  несут, пришлось бы менять ключ реакции; (c) звать `RESULTS_FOR_SOCIAL` из `notifications` — чужой порт.
  **Рекомендация — (a).** Цели: thanks → `ride`, respect гонки → `race` (окно — на гонку в сутки, ключ по `raceId`),
  respect маршрута → `my-route`. Thanks на скрытом/отменённом райде — `state`.
- **RC-P7-7. K11 «повтор в 30 дней» — где дата.** `manualAt` не годится: `remove` ставит `manualAt: null`, а
  «добавил → убрал → добавил» за 30 дней не должен уведомлять. **Решение:** новое поле `rider_connections
  .manualNoticeAt?: Date | null` (нет поля — `null`, без миграции/бэкфилла; `remove`, пересчёт явки и `EMPTY` его не
  трогают; стирание удаляет документ целиком). В транзакции `addManual`: `upsertManual` возвращает состояние **до**
  (`findOneAndUpdate`, `returnDocument: 'before'`) → `connectedBefore = before && before.removedAt === null`; если
  `!connectedBefore` — условный `updateOne({ ...pair, $or: [{ manualNoticeAt: null }, { manualNoticeAt: { $exists:
  false } }, { manualNoticeAt: { $lte: now − manualRenotifyMs } }] }, { $set: { manualNoticeAt: now } })`;
  `modifiedCount = 1` — `outbox.append(social.connection-added)`. Идемпотентный повтор `PUT connected: true` при уже
  активной связи (любой источник) — без уведомления. `[ASSUMPTION]` 30 дней считаются от последнего **уведомления**
  (не от последнего нажатия): не больше одного «Вас добавили» на пару за 30 дн. Intake дополнительно проверяет
  `SOCIAL_NOTICES.connected(owner, other)` — убрал до приёма — `state`, без push.
- **RC-P7-8. «Как прошёл райд?» и заглушка P5.** `LoggingRideAskDue` заменяется `OutboxRideAskDue` (тот же
  `RIDE_ASK_DUE`, `ride-ask.port.ts`), заглушка удаляется. Тесты P5 (`social-ride-ask.int.test.ts`) шпионят за
  `LoggingRideAskDue.due` — переводятся на проверку outbox (`social.ride-ask-due` в той же транзакции; откат захвата при
  сбое `append`). Intake: райд не `published` — `state`; черновик без лица (`seq: 1`, P1).
- **RC-P7-9. `notification-texts.ts` и `notifications.policy.ts`.** Все шесть видов, группа, тексты и `KIND_GROUPS`
  есть с P1. **Решение:** эти два файла не меняются (правка допустима, но не нужна); меняется только
  `notification-intake.ts` (+ одна строка процессора, RC-P7-4).
- **RC-P7-10. Источник «Я иду» — `social_home`, не `'social'`.** `RIDE_JOIN_SOURCES = ['ride_card', 'social_home',
  'notification', 'profile']`. Спека §3.2 пишет `'social'` — опечатка, используем `social_home`. Источник
  `notification` P2 тоже отложил на P7 (`docs/tasks/2026-10-31-social-p2-ride/task.md:551`), K12 его требует.
  **Решение:** цель `ride` уведомления ведёт на `/rides/<id>?from=notification` (`notification-target.ts` и копия целей
  в `scripts/service-worker.ts`); `ride-detail.tsx` при `from === 'notification'` шлёт `source: 'notification'`, иначе
  `ride_card`. Без этого метрика K12 «Я иду из уведомления» не появится никогда.
- **RC-P7-11. «Признак есть ещё» не нужен.** K7: «не больше трёх, затем „Все свои“ → экран „Свои“» — ссылка есть
  всегда при видимой секции и ведёт на список связей, а не на «остальные строки». **Решение:** `SocialHome = { items }`
  без `hasMore` (AGENTS §4.9 «нет на вырост»); отклонение — в 8.2.
- **RC-P7-12. Отбор и порядок ≤ 3 строк (детерминированно).** Кандидаты по видам, каждый вид ≤ 3:
  ride — `startsAt ↑, _id ↑`; result — `protocolPublishedAt ↓, raceId ↑, place ↑, entryId ↑`; route — `catalog
  .publishedAt ↓, _id ↓`. Отбор — по кругу в порядке K7 (ride → result → route): первый каждого вида, затем вторые, …
  до трёх. Показ — сгруппировано в том же порядке видов. `[ASSUMPTION]` — разнообразие важнее «трёх райдов подряд».
  Строка ride показывается и тому, кто уже идёт или организатор (кнопка — состояние `RideGoingAction`), §8 подтверждён.
  В строке ride — до `SOCIAL_HOME_RIDERS_MAX = 3` «своих» (порядок участников райда, организатор первым) и
  `othersCount` — остальные «свои» в райде (только публичные: непубличные «своими» не считаются, K3).
- **RC-P7-13. Результат и разница.** Только опубликованный протокол (`publicTableMode === 'protocol'`,
  `protocolPublishedAt ≥ now − 7 дн`), строка текущей ревизии, `isPublicProtocolRow` (DQ, без места — нет).
  Предварительная таблица — не «протокол» (K7). Разница: строка зрителя той же гонки, той же ревизии и той же
  `groupKey ?? 'overall'`, тоже `isPublicProtocolRow`; `deltaSec = elapsedSec своего − elapsedSec зрителя` (минус —
  «быстрее вас»); иначе `null` (AC2). Время и места — только из строк протокола. Несколько «своих» в одной гонке —
  отдельные кандидаты (отбор RC-P7-12 возьмёт лучшего по месту).
- **RC-P7-14. Маршрут и согласие автора.** `origin: rider`, `IN_CATALOG`, `catalog.publishedAt ≥ now − 7 дн`,
  `publication.showAuthorName === true` (иначе строка раскрыла бы авторство без согласия — нет строки), автор — «свой».
  Маршрут, вернувшийся в каталог «Вернуть», сохраняет прежний `publishedAt` — новым не считается.
- **RC-P7-15. «Свои» зрителя для Главной.** `listOf(viewer)` уже отдаёт только публичных (K3) и не убранных; предел
  `SOCIAL_POLICY.homeConnectionsMax = 500` (порядок `listOf`: недавние совместные райды первыми) — `$in` портов
  ограничен. Связей нет — `{ items: [] }` без вызова портов.
- **RC-P7-16. Индекс «протоколы за 7 дней».** У `races` нет индекса по `protocolPublishedAt` (`races_protocol_idx` —
  `{ seasonId, windowEndsAt, _id }`, нужен `seasonId`). Варианты: (a) миграция `0050_social_home`:
  `races_protocol_published_idx { protocolPublishedAt: -1, _id: -1 }` частичный `{ protocolPublishedAt: { $type:
  'date' } }`, метод `RACE_REGISTRY.protocolsPublishedSince(since, limit)`; (b) COLLSCAN маленькой `races` на каждый
  запрос Главной; (c) идти от строк (`race_protocol_rows_user_idx` × все «свои» × вся история). **Рекомендация —
  (a)**: expand-only, без бэкфилла, номер — по факту слияния (сейчас последняя `0049_route_rides_leaderboard_idx`).
  Строки — один запрос `{ userId: $in (свои ∪ зритель), raceId: $in }` по `race_protocol_rows_user_idx`, ревизию
  отсекает код. Райды — `rides_participant_idx` (`participants.userId $in`, `startsAt` диапазон), маршруты —
  `routes_catalog_idx` (диапазон `publishedAt`). Других индексов нет.
- **RC-P7-17. Скелетон vs «только при наличии строк».** AGENTS §4.12 требует скелетон первой загрузки, K7 — секция
  только при строках, `home.md` Q2 — ошибка скрывает секцию. Скелетон пустой у большинства секции дал бы «прыжок».
  **Решение — прецедент `HomeTickets` (RC-B6) / `LandingSection` (G5):** первой загрузки и ошибки без данных — секции
  нет; ошибка обновления при показанных данных — данные остаются; «Я иду» — состояние кнопки. Записать в
  `pokatim-app.md` как явное исключение блока Главной.
- **RC-P7-18. Слот: подсказка + секция.** Один слот `socialSlotIndex`: сначала секция (если есть строки), под ней
  подсказка K3 (если видима). `[ASSUMPTION]` контент своих важнее призыва. Профиль не пришёл (`reasons === undefined`)
  — слота нет, секция ждёт профиль (без смены позиции после ответа; ошибка профиля — секции нет). Запрос
  `GET social/home` — только вошедшему (`signedIn`), в pull-to-refresh, ключ `['social','home']` (префикс `['social']`
  — инвалидация при уходе с `/social` обновит и секцию). После «Я иду» — `invalidateQueries(['social','home'])`.
- **RC-P7-19. Активный день — где и как.** Варианты: (a) **в `AuthGuard`** после успешной проверки — ровно
  «авторизованный запрос райдера»; панель (`PanelGuard`) и публичные ручки (`PublicReadGuard`) его не проходят;
  (b) глобальный interceptor — нужен фильтр «есть `request.auth`», правка `app.module.ts` (запрещена RC-13);
  (c) только `SessionController` refresh — не «запрос». **Рекомендация — (a)**, провайдер `ActiveDay` в `IdentityModule`
  (экспорт рядом с `AuthGuard`: гард инстанцируется в модуле-потребителе), `IdentityModule.imports +=
  ProductEventsCoreModule`. Алгоритм — §11.5. Ожидание ограничено `ACTIVE_DAY_WAIT_MS = 200` (`Promise.race`, таймер
  `unref`): запрос не ждёт дольше и не падает; один `SET NX` (~1 мс) на каждый запрос, запись журнала — раз в сутки на
  райдера. Ограниченное ожидание (а не fire-and-forget) делает тесты детерминированными. Сбой записи — `DEL` ключа
  (следующий запрос повторит) и лог `product_events.record_failed type=active-day error=<класс>` (без uid в тексте
  ошибки, без e-mail). `props: { day }` (уже в `product-events.types.ts`, RC-12 соблюдён).
- **RC-P7-20. Активный день ломает существующие тесты.** Каждый авторизованный HTTP-запрос теперь пишет
  `active-day`. Тесты с нефильтрованными `events.find()`/`countDocuments()` (`social-attendance`, `social-invites`,
  `social-auto-attendance`, `account-erasure` по `userId`) и `vi.spyOn(events, 'record').mockRejectedValueOnce`
  (`rides-join-source.int.test.ts` — отказ съест `active-day`) станут красными. **Решение:** такие проверки
  фильтруют `type`, моки `record` — по типу события (`mockImplementation(e => e.type === 'ride-joined' ? reject :
  real)`). Coder проходит `rg "events\.(find|countDocuments)\(\)|record'\)\.mock" apps/api` и правит каждое.
- **RC-P7-21. RC-14 — ребро `identity → product-events`.** dependency-cruiser ребро не запрещает
  (`product-events-leaf` — только исходящие из `product-events`; `no-circular` — `product-events` никого не
  импортирует). Правка правила не нужна; меняются текст контекста ADR-0027 («identity зависит только от `tokens` и
  листа `product-events`»), `pokatim-backend.md` (§«Модули», §«Свои»), `pokatim-security.md` (identity).
- **RC-P7-22. `ResultsCoreModule`/`RoutesCoreModule` в worker не нужны.** Главная — HTTP (`SocialModule`), уведомлениям
  достаточно `RESULTS_NOTICES`/`ROUTE_NOTICES` (уже в `NotificationsWorkerModule`). RC-P4-12 сохраняется.
- **RC-P7-23 `[ASSUMPTION]`. «Вас добавили» от непубличного** — уведомление уходит с «Райдер» и без перехода (K10:
  нет имени — «Райдер», цель `rider` — из показанного лица). То же для «По вашей ссылке…».
- **RC-P7-24 `[ASSUMPTION]`. Заголовок секции** — кикер «Свои», заголовок «Что у своих», ссылка «Все свои»;
  прототипа секции нет — тексты в `packages/i18n` (`social.home.*`), на ревью — вопрос автору при расхождении.
- **RC-P7-25. Совместимость.** Новый эндпоинт: старые сборки его не зовут; новая сборка против старого API — `404` →
  секция скрыта (RC-P7-17). Строки — `discriminatedUnion('kind')`, массив разбирается по одной строке, незнакомый
  `kind` отбрасывается (`transform`), а не роняет ответ. `RideCard`/`CatalogRouteCard` — уже терпимые схемы.
  `RideJoinSource` не расширяется. Новые события outbox — новые типы; старый worker их не получит (маршрута нет) —
  выкат API и worker одним релизом (как обычно).

Нарушений инвариантов AGENTS §4 и вредных решений, кроме RC-P7-1, не найдено: результаты/разница/видимость считает
сервер, клиент только форматирует; `rides`/`results`/`routes`/`races`/`identity`/`profile` не импортируют `social`;
очереди — без новых `registerQueue`; одна миграция expand-only.

## 8.2 Deviations from spec

## 8.3 Security checklist

AuthZ `GET social/home` — только свои связи зрителя; в ответе нет `userId`; чужие имена — только публичные с согласием;
`no-store`; лимит чтения; логи без имён и e-mail; `props` событий без чужих id.

## 9. Acceptance Criteria

1. AC1 — `GET social/home`: строки ride / result / route по правилам п. 3.1; не больше трёх; без строк — пустой ответ;
   непубличный «свой», убранная связь (`removedAt`), чужие связи, отменённый/скрытый райд, райд за 7 дн+,
   неопубликованный протокол, DQ/снятая строка, маршрут команды или вне каталога — не попадают; гость — 401.
2. AC2 — разница «быстрее/медленнее вас» — только при зрителе в той же гонке (и группе) с результатом.
3. AC3 — каждое из шести событий K10 создаёт уведомление нужного `kind` нужному получателю с `actors`, повтор события
   (тот же outbox id) — без дублей; схлопывание по окнам P1.
4. AC4 — «Вас добавили»: повторное ручное добавление того же человека в течение 30 дн — без уведомления; после 30 дн —
   с уведомлением. Снятие респекта и `already_linked` — без уведомления.
5. AC5 — «Свои идут»: аудитория — владельцы связей к записавшемуся, без идущих на райд, без убранных связей, без
   самого записавшегося; непубличный записавшийся — без уведомления.
6. AC6 — «Как прошёл райд?»: регламент P5 пишет outbox в транзакции захвата; адресаты получают `social_ride_ask`.
7. AC7 — активный день: первый авторизованный запрос за сутки по Минску пишет одно `active-day`; второй — нет;
   следующие сутки по Минску — снова; сбой записи не роняет запрос.
8. AC8 — `pnpm arch:check`: `rides`, `results`, `routes`, `tracks`, `profile`, `identity` не импортируют `social`;
   `product-events` — лист; ребро `identity → product-events` разрешено и описано; `BullModule.registerQueue` для
   `social-*` — только в `social/*`.
9. AC9 — приложение: секция «Свои» в слоте `socialSlotIndex`, строки ведут на объекты, «Я иду» с источником `social`,
   «Все свои» → `/social`; ошибка — секция скрыта; тесты экрана Главной.

## 10. Documentation Impact

ADR-0027, `docs/product/social.md` / `home.md` (только уточнения), `.claude/rules/pokatim-backend.md`,
`pokatim-app.md`, `pokatim-contracts.md`, `pokatim-db.md` (если меняются индексы/поля). Architect уточняет в 8.1.

Architect (RC-P7-1…25), что меняется:
- **ADR-0027:** контекст — «`identity` зависит только от `tokens` и листа `product-events` (активный день, P7)» (RC-14,
  RC-P7-21); п. 3 — `GET social/home` (`SocialHomeController`, лимит `social-home:<uid>`, состав и отбор строк
  RC-P7-12…15, без `hasMore`); п. 6 — привязка: события `social.reaction-created | connection-added |
  invite-registered | ride-ask-due` (payload — id), маршрут `notificationsOutboxRoutes`, порт `SOCIAL_NOTICES`,
  «Свои идут» из `rides.participant-joined` по `seq` участника (RC-P7-2), взаимная связь для райдов (RC-P7-1 — после
  ответа), K11 — `manualNoticeAt` (RC-P7-7), названия — `RIDE_NOTICES`/`ROUTE_NOTICES`/`RACE_REGISTRY` +
  `RESULTS_NOTICES.entryRace`; п. 7 — активный день в `AuthGuard` (`ActiveDay`, `SET NX` до конца суток по Минску,
  ожидание ≤ 200 мс, `DEL` при сбое записи); «Последствия» — Nest-импорт `social` в `NotificationsWorkerModule`
  появился (P7), индекс `races_protocol_published_idx`.
- **`docs/product/social.md`:** K7 — «райды — при взаимной связи, как „Идёт“ K6», порядок строк по кругу видов
  (после ответа на RC-P7-1); K10 «Свои идут» — та же оговорка; K11 — «30 дней — от последнего уведомления о
  добавлении»; K12 — источник «уведомление» = переход из уведомления на карточку райда. Без смены остального.
- **`docs/product/home.md`:** «Свои» — секция и подсказка K3 в одном слоте (секция выше), без скелетона (как «Ваши
  билеты»), ошибка — скрыта.
- **`.claude/rules/pokatim-backend.md`:** §«Модули» — `identity → product-events`; §«Уведомления» — `social.*` в
  `notificationsOutboxRoutes`, `drafts(…, eventId)`, ветка «Свои идут» в `participant-joined`, порт `SOCIAL_NOTICES`,
  `RESULTS_NOTICES.entryRace`; §«Свои» — события outbox и где пишутся (insert / addManual / linkInvite /
  `OutboxRideAskDue`), K11, `GET social/home` (порты, отбор), `NotificationsWorkerModule → SocialCoreModule`, заглушка
  `LoggingRideAskDue` удалена; §«Очереди» — без новых очередей; активный день (§«Данные и логи» или identity).
- **`.claude/rules/pokatim-db.md` §«Свои»:** `rider_connections.manualNoticeAt?` (без миграции, нет поля — `null`,
  `remove`/пересчёт не трогают); миграция `0050_social_home` (`races_protocol_published_idx`), ключ Redis
  `active-day:<userId>:<YYYY-MM-DD>` (TTL до конца суток по Минску + 1 ч).
- **`.claude/rules/pokatim-contracts.md`:** `src/social/home.schema.ts` (`SocialHome`, строки, пределы), api-client
  `getSocialHome`.
- **`.claude/rules/pokatim-app.md`:** Главная — `SocialHomeSection` в слоте `socialSlotIndex` (секция + подсказка),
  исключение §4.12 (RC-P7-17), ключ `['social','home']`, `useRideRsvp(id, 'social_home')`, `?from=notification` у
  цели `ride` и `source: 'notification'` на карточке райда.
- **`.claude/rules/pokatim-security.md`:** identity — активный день в `AuthGuard` (без ПДн в Redis-ключе, кроме uuid).
- **§12** — итог эпика (этап 0 закрыт), ссылка на ответ по RC-P7-1.

## 11. Implementation Context

Пути API — от `apps/api/src/`. Один PR (P7 закрывает этап 0); объём большой, но связный — делить не нужно.

### 11.1 ENTRY POINTS

1. `GET /v1/social/home` — `SocialHomeController.home` (`@Controller('social')`, `AuthGuard`, `no-store`) →
   `SocialHomeService.homeOf(viewerId)`.
2. `notifications-intake`, задачи с именами `rides.participant-joined` (существует) и `social.reaction-created`,
   `social.connection-added`, `social.invite-registered`, `social.ride-ask-due` (новые) →
   `NotificationsIntakeProcessor.process` → `NotificationIntake.drafts(type, payload, now, eventId)`.
3. Писатели outbox: `SocialReactionsService.insert` (thanks/respect), `SocialConnectionsService.addManual`,
   `SocialConnectionsService.linkInvite`, `OutboxRideAskDue.due` (из `RideAskSweep`, P5).
4. Любой запрос под `AuthGuard` → `ActiveDay.touch(userId, now)`.
5. Приложение: Главная `app/(tabs)/index.tsx` (слот «Свои»); карточка райда `features/rides/ride-detail.tsx`
   (`?from=notification`).

### 11.2 FILES TO CREATE

- `packages/contracts/src/social/home.schema.ts` (+ `home.schema.test.ts`) — 11.4.
- `modules/social/social-notices.port.ts` — `SOCIAL_NOTICES`, `SocialNotices`, `SocialReactionNotice`.
- `modules/social/social-notices.service.ts` — `SocialNoticesService implements SocialNotices` (провайдер и экспорт
  `SocialCoreModule`): `reaction` — `ReactionsRepository.findById`; `goingAudience`, `connected` — `ConnectionsRepository`.
- `modules/social/social-home.service.ts` — `SocialHomeService` (провайдер `SocialModule`), 11.5.
- `modules/social/social-home.view.ts` (+ `social-home.view.test.ts`) — чистые `pickHomeRows`, `rideRowOf`,
  `resultRowOf`, `routeRowOf`.
- `modules/social/social-home.controller.ts` — `SocialHomeController`.
- `modules/social/social-home.int.test.ts`, `modules/social/social-notices.int.test.ts` (сквозные уведомления),
  `modules/identity/active-day.int.test.ts`.
- `modules/identity/active-day.ts` (+ `active-day.test.ts`) — `ActiveDay`, `activeDayKey`, `activeDayTtlSec`.
- `db/migrations/0050_social_home.ts` — `races_protocol_published_idx` (номер — по факту слияния).
- `apps/app/src/features/social/social-home-section.tsx` — `SocialHomeSection` и строки (`SocialRideRow`,
  `SocialResultRow`, `SocialRouteRow`); `social-home-format.ts` (+ `.test.ts`) — кикеры и разница;
  `apps/app/src/__tests__/home-social.test.tsx` — экран Главной.

### 11.3 FILES TO MODIFY

**social**
- `social.events.ts`: константы и zod payload четырёх событий (11.4); `socialOutboxRoutes` **не меняется**.
- `index.ts`: экспорт событий/схем (`SOCIAL_*`, `Social*`), `SOCIAL_NOTICES`, `type SocialNotices`,
  `type SocialReactionNotice` — с комментарием «для `notifications` (K10, P7)».
- `reactions.service.ts`: `insert` — `_id` реакции заранее, в той же `transactions.run` после `events.record` —
  `outbox.append(tx, { type: SOCIAL_REACTION_CREATED, payload: { reactionId } })`. Комментарий «P7 добавят» — убрать.
- `reactions.repository.ts`: `findById(id)`.
- `connections.repository.ts`: `upsertManual` → `{ created, connectedBefore }` (`findOneAndUpdate`, `returnDocument:
  'before'`, `includeResultMetadata` при необходимости); `claimManualNotice(tx, pair, now, renotifyMs): boolean`;
  `ownerIdsOf(otherId, limit?)` (`rider_connections_other_idx`, `removedAt: null`, проекция `ownerId`);
  `otherIdsAmong(ownerId, otherIds)` (`owner_other_unique`, `removedAt: null`); `isConnected(pair)`.
- `connections.service.ts`: `addManual` — K11 по RC-P7-7 и outbox `social.connection-added` (возврат прежний);
  `linkInvite` — при `registered` outbox `social.invite-registered` в той же транзакции; комментарий «(P7)» убрать.
- `social.collection.ts`: `ConnectionDoc.manualNoticeAt?: Date | null` с комментарием (K11, P7, без миграции).
- `invite-intake.ts`: убрать комментарий-точку P7 (поведение без изменений).
- `ride-ask.port.ts`: `LoggingRideAskDue` → `OutboxRideAskDue` (`MongoOutboxWriter`, `append(tx, { type:
  SOCIAL_RIDE_ASK_DUE, payload })`, лог `social.ride_ask_due ride count` остаётся), комментарии.
- `social.module.ts`: `SocialCoreModule.providers/exports += SocialNoticesService, { provide: SOCIAL_NOTICES,
  useExisting }` (в конец); `SocialModule.controllers += SocialHomeController`, `providers += SocialHomeService`;
  `SocialWorkerModule` — `OutboxRideAskDue` вместо заглушки; комментарии модулей.
- `social.policy.ts`: `SOCIAL_POLICY += homeLimit: { limit: 60, windowSec: 60 }, homeWindowMs: 7 * DAY_MS,
  homeConnectionsMax: 500` (в конец), комментарий.
- `social-ride-ask.int.test.ts`: шпион `LoggingRideAskDue` → проверка outbox (RC-P7-8).

**notifications** (правило параллельных PR: P7 — разрешено)
- `notification-intake.ts`: `drafts(type, payload, now, eventId)`; конструктор `+ SOCIAL_NOTICES, RIDER_NAMES`;
  ветка `RIDES_PARTICIPANT_JOINED` → `[rideJoined, ...ridersGoing]`; новые `case` четырёх событий (11.5).
- `notifications-intake.processor.ts`: передать `eventId` в `drafts` (одна строка).
- `notifications.events.ts`: `notificationsOutboxRoutes += [SOCIAL_REACTION_CREATED | SOCIAL_CONNECTION_ADDED |
  SOCIAL_INVITE_REGISTERED | SOCIAL_RIDE_ASK_DUE]: QUEUE.notificationsIntake` (в конец, комментарий «social-p7»).
- `notifications.module.ts`: `NotificationsWorkerModule.imports += SocialCoreModule` (в конец), комментарий.
- `notification-texts.ts`, `notifications.policy.ts` — **без изменений** (RC-P7-9).
- `notification-intake.test.ts`, `notifications-intake.int.test.ts`/`notifications-social.int.test.ts` — новые кейсы.

**results / races / routes / rides** (порты; о `social` не знают)
- `results/results-notices.port.ts` + `results-notices.ts`: `entryRace(entryId): Promise<string | null>` (в конец).
- `results/results-for-social.port.ts` + `results-for-social.ts`: `recentResults` (11.4); реализация — через
  `ResultsReadService` (новый метод рядом с `publicRow`, те же `publicTableMode`/`protocolRevision`/
  `isPublicProtocolRow`) и `RACE_REGISTRY.protocolsPublishedSince`.
- `results/results.repository.ts`: `protocolRowsOfUsers(userIds, raceIds)` (`race_protocol_rows_user_idx`, проекция
  без флагов и попытки).
- `races/race-registry.port.ts` + `race-registry.ts` + `races.repository.ts`: `protocolsPublishedSince(since, limit)`
  (`status: 'published'`, `protocolPublishedAt ≥ since`, `↓, _id ↓`, `races_protocol_published_idx`). Фейки
  `RaceRegistry` в тестах (если есть) — дополнить.
- `routes/routes-for-social.port.ts` + `routes-for-social.ts`: `recentByAuthors` (11.4); `routes.repository.ts` —
  `recentRiderCatalog(authorIds, since, limit)` (`status: 'ready'`, `IN_CATALOG`, `origin: 'rider'`,
  `'publication.showAuthorName': true`, `ownerUserId $in`, `catalog.publishedAt ≥ since`, `↓, _id ↓`,
  `routes_catalog_idx`); `routes-public.service.ts` — экспорт `toCatalogCard` внутри модуля (не из `index.ts`);
  `routes.module.ts` — `RoutesCoreModule.imports += ProfileCoreModule` (у `ProfileCoreModule` нет imports — цикла нет;
  проверить старт приложения и worker), имена — `RIDER_NAMES.attributionNames`.
- `rides/rides-for-social.port.ts` + `rides-for-social.ts`: `upcomingWithRiders` (11.4); `rides.repository.ts` —
  `upcomingWithParticipants(ids, now, until, limit)` (`'participants.userId': $in`, `status: 'published'`, `startsAt
  (now, until]`, `↑, _id ↑`, проекция `VIEWER_FIELDS + 'participants.userId'`, `rides_participant_idx`); карточка —
  `rideCardOf` + `lookupRoutes` + `reportedRideIds`, как `nextRideCard`.

**identity**
- `auth.guard.ts`: после `request.auth = auth` — `await this.activeDay.touch(auth.userId, now)` (никогда не бросает).
- `identity.module.ts`: `IdentityModule.imports += ProductEventsCoreModule`, `providers/exports += ActiveDay`;
  комментарий.

**db**
- `db/migrations/index.ts` (в конец), `migrations.int.test.ts` (индекс есть, опции, идемпотентность).

**contracts / api-client / i18n**
- `packages/contracts/src/index.ts`: `export * from './social/home.schema.ts';` — в конец.
- `packages/api-client/src/index.ts`: `getSocialHome(accessToken)` (`GET /v1/social/home`, `SocialHome`) — в конец
  блока «Свои»; `social.test.ts` — кейс.
- `packages/i18n/src/ru.ts`: `social.home.*` (в конец): `kicker` «Свои», `title` «Что у своих», `all` «Все свои»,
  `goingOne` «{name} идёт», `goingMany` «{name} и ещё {count} идут», `result` «{name} · {time}», `faster` «на {delta}
  быстрее вас», `slower` «на {delta} медленнее вас», `same` «одно время с вами», `route` «Новый маршрут от {name}»,
  a11y-подписи строк (`a11yRide`, `a11yResult`, `a11yRoute`).

**app**
- `app/(tabs)/index.tsx`: `useSocialHome(signedIn)`; слот: `slot = socialSlotIndex(sections, reasons)` (без
  условия подсказки) → элемент слота = `<SocialHomeSection …/>` + `hint` (RC-P7-18); `refetchers += socialHome
  .refetch`. Логику индексов не дублировать — тот же `before`/хвост.
- `features/social/queries.ts`: `socialHomeKey = ['social','home']`, `useSocialHome(enabled)` (`withAccessToken`,
  `DEFAULT_STALE_MS`, `enabled`).
- `features/notifications/notification-target.ts`: `ride` → `/rides/<id>?from=notification` (+ тест);
  `apps/app/scripts/service-worker.ts` — та же цель (копия P1).
- `features/rides/ride-detail.tsx` (или экран `app/rides/[id].tsx`, где читаются параметры): `from === 'notification'`
  → `useRideRsvp(id, 'notification')`, иначе `'ride_card'` (+ тест).
- `features/home/sections.ts`: только комментарий `socialSlotIndex` (секция P7 + подсказка).

### 11.4 TYPES

```ts
// packages/contracts/src/social/home.schema.ts
export const SOCIAL_HOME_ROWS_MAX = 3;
export const SOCIAL_HOME_RIDERS_MAX = 3;
/** «Свой» в строке: только публичный (K3), без userId. */
export const SocialHomeRider = RideRiderRow.extend({ publicId: RiderPublicId });
export const SocialHomeRideRow = z.object({
  kind: z.literal('ride'),
  ride: RideCard,                                   // карточка ленты со зрителем (canJoin, role)
  riders: z.array(SocialHomeRider).max(SOCIAL_HOME_RIDERS_MAX),   // ≥ 1
  othersCount: z.number().int().min(0),             // остальные «свои» в райде
});
export const SocialHomeResultRow = z.object({
  kind: z.literal('result'),
  rider: SocialHomeRider,
  race: z.object({ id: Uuid, title: z.string() }),
  entryId: Uuid,
  place: z.number().int(), tied: z.boolean(), elapsedSec: z.number().int(),
  /** своё − зрителя, сек; минус — «быстрее вас»; зритель не в той же гонке и группе — null */
  deltaSec: z.number().int().nullable().default(null),
});
export const SocialHomeRouteRow = z.object({ kind: z.literal('route'), rider: SocialHomeRider, route: CatalogRouteCard });
export const SocialHomeRow = z.discriminatedUnion('kind', [SocialHomeRideRow, SocialHomeResultRow, SocialHomeRouteRow]);
/** `GET /v1/social/home` (no-store): ≤ 3 строки; незнакомый `kind` отбрасывается (старые сборки). */
export const SocialHome = z.object({
  items: z.array(z.unknown()).transform((rows) => rows.flatMap((row) => {
    const parsed = SocialHomeRow.safeParse(row); return parsed.success ? [parsed.data] : [];
  })),
});
export type SocialHome = z.output<typeof SocialHome>;

// apps/api/src/modules/social/social.events.ts
export const SOCIAL_REACTION_CREATED = 'social.reaction-created';
export const SocialReactionCreated = z.object({ reactionId: z.uuid() });
export const SOCIAL_CONNECTION_ADDED = 'social.connection-added';
export const SocialConnectionAdded = z.object({ ownerId: z.uuid(), otherId: z.uuid() });
export const SOCIAL_INVITE_REGISTERED = 'social.invite-registered';
export const SocialInviteRegistered = z.object({ inviterId: z.uuid(), inviteeId: z.uuid() });
export const SOCIAL_RIDE_ASK_DUE = 'social.ride-ask-due';
export const SocialRideAskDue = z.object({ rideId: z.uuid(), userIds: z.array(z.uuid()).min(1).max(RIDE_MAX_PARTICIPANTS) });

// social/social-notices.port.ts
export const SOCIAL_NOTICES = Symbol('SOCIAL_NOTICES');
export type SocialReactionNotice = Pick<ReactionDoc, 'kind' | 'actorId' | 'recipientId' | 'targetType' | 'targetId'>;
export interface SocialNotices {
  /** Реакция сейчас; снята или стёрта — null. */
  reaction(reactionId: string): Promise<SocialReactionNotice | null>;
  /** Владельцы не убранных связей → rider, к которым rider тоже держит не убранную связь (RC-P7-1a, RC-P7-3). */
  goingAudience(riderId: string): Promise<string[]>;
  /** Связь owner → other есть и не убрана. */
  connected(ownerId: string, otherId: string): Promise<boolean>;
}

// rides/rides-for-social.port.ts (добавление)
export interface SocialUpcomingRide { card: RideCard; participantIds: string[] /* организатор первым */ }
upcomingWithRiders(riderIds: readonly string[], viewerId: string, now: Date, until: Date, limit: number):
  Promise<SocialUpcomingRide[]>;   // published, startsAt ∈ (now, until], ↑

// results/results-for-social.port.ts (добавление)
export interface SocialRaceResult {
  raceId: string; raceTitle: string; publishedAt: Date;
  entryId: string; userId: string;  // userId наружу social не отдаёт
  place: number; tied: boolean; elapsedSec: number;
  viewerElapsedSec: number | null;  // строка зрителя той же ревизии и groupKey, видимая
}
recentResults(userIds: readonly string[], viewerId: string, since: Date, limit: number): Promise<SocialRaceResult[]>;

// routes/routes-for-social.port.ts (добавление)
recentByAuthors(authorIds: readonly string[], since: Date, limit: number):
  Promise<{ card: CatalogRouteCard; authorUserId: string }[]>;

// races/race-registry.port.ts (добавление)
protocolsPublishedSince(since: Date, limit: number): Promise<RaceForResults[]>;   // ≤ 20

// results/results-notices.port.ts (добавление)
entryRace(entryId: string): Promise<string | null>;

// identity/active-day.ts
export const ACTIVE_DAY_WAIT_MS = 200;
export const activeDayKey = (userId: string, day: string) => `active-day:${userId}:${day}`;
export function activeDayTtlSec(now: Date): number; // до начала следующих суток по Минску + 3600
export class ActiveDay { touch(userId: string, now: Date): Promise<void> /* не бросает */ }
```

### 11.5 Алгоритмы

**`SocialHomeService.homeOf(viewerId)`**
1. `consumeUserLimit('social-home:<uid>', homeLimit)` первым; `now = clock.now()`; `since = now − homeWindowMs`,
   `until = now + homeWindowMs`.
2. `mine = (await connections.listOf(viewerId)).filter(publicId !== null).slice(0, homeConnectionsMax)` — карты
   «своих» (имя, `publicId`, аватар). Пусто — `{ items: [] }`.
3. `rideFriends = mine ∩ ownerIdsOf(viewerId)` (RC-P7-1a).
4. Параллельно (`limit = SOCIAL_HOME_ROWS_MAX`): `rides.upcomingWithRiders(rideFriends, viewer, now, until)` (если
   `rideFriends` непуст), `results.recentResults(mine, viewer, since)`, `routes.recentByAuthors(mine, since)`.
5. Строки — `social-home.view.ts`: ride — `riders` = участники ∩ `rideFriends` в порядке участников, первые 3,
   `othersCount` — остальные (райд без «своих» — без строки); result — `deltaSec = viewerElapsedSec === null ? null :
   elapsedSec − viewerElapsedSec`; route — `rider` = автор. Карты — только из шага 2, `userId` в ответ не идёт.
6. `pickHomeRows({ ride, result, route })` — по кругу видов (RC-P7-12), ≤ 3, сгруппировано по виду.

**`ResultsReadService.recentPublicRows(userIds, viewerId, since, limit)`**
`races = registry.protocolsPublishedSince(since, 20).filter(publicTableMode === 'protocol')` → пусто — `[]` →
`withSnapshot`: ревизия каждой (`protocolRevision`) → `protocolRowsOfUsers([...userIds, viewerId], raceIds)` → строки
текущей ревизии, `isPublicProtocolRow` → своя строка зрителя по `(raceId, groupKey ?? 'overall')` → кандидаты
«своих» (кроме зрителя), сортировка RC-P7-12, `limit`.

**`NotificationIntake` (новые ветки; каждая — `socialNoticeDraft({ kind, eventId, actor, recipients, object })`)**
- `participant-joined` (после существующей `ride_joined`, только `status === 'published'`): нет `seq` → без
  черновика; `joiner = ride.participants.find(seq === event.seq)` → нет → без; `names.publicRiders([joiner])` без
  него → без; `audience = social.goingAudience(joiner) − {organizer, participants, joiner}` → пусто → без; иначе
  `social_riders_going`, actor `joiner`, object `{ ride, id, title }`.
- `reaction-created`: `r = social.reaction(id)` → нет — `gone`. `thanks`: `ride = rides.ride(r.targetId)` → нет —
  `gone`, не `published` — `state` → `social_thanks`, recipients `[r.recipientId]`, actor `r.actorId`, object ride.
  `respect` + `race_entry`: `raceId = results.entryRace(r.targetId)`, `title = raceTitle(raceId)` → нет — `gone` →
  object `{ race, raceId, title }`; `respect` + `route`: `routes.publication(r.targetId)` → нет — `gone` → object
  `{ route, id, title }`. Recipients `[r.recipientId]`.
- `connection-added`: `social.connected(owner, other)` нет — `state`; `social_added`, recipients `[other]`, actor
  `owner`, object `null`.
- `invite-registered`: `social_invite_registered`, recipients `[inviter]`, actor `invitee`, object `null`.
- `ride-ask-due`: `ride = rides.ride(rideId)` → нет — `gone`, не `published` — `state`; `social_ride_ask`, actor
  `null`, recipients `userIds`, object ride.
Payload не по схеме — `invalid_payload`, как у остальных.

**K11 в `addManual`** — транзакция: `{ created, connectedBefore } = upsertManual` → событие `connection-created`
(как было, по `created`) → если `!connectedBefore && claimManualNotice(tx, pair, now, manualRenotifyMs)` →
`outbox.append(social.connection-added)`.

**`ActiveDay.touch(userId, now)`** — `Promise.race([work, delay(ACTIVE_DAY_WAIT_MS, unref)])`, `work`:
`day = minskToday(now)`; `ok = await redis.set(activeDayKey, '1', 'EX', activeDayTtlSec(now), 'NX')`; не `'OK'` —
выход; `try { await events.record({ type: 'active-day', userId, props: { day } }) } catch { await redis.del(key)
.catch(noop); log warn product_events.record_failed type=active-day error=<класс> }`. Ошибка Redis — тот же лог,
без записи. Ничего не пробрасывается.

### 11.6 FILES TO READ

`modules/notifications/{social-notices.ts, notification-intake.ts, notifications-intake.processor.ts,
notification-fanout.ts, notifications.events.ts, notifications.module.ts, notifications.repository.ts (writeNotices),
notifications-social.int.test.ts}`; `modules/social/{social.module.ts, social.events.ts, index.ts, reactions.service.ts,
reactions.repository.ts, connections.service.ts, connections.repository.ts, social.collection.ts, social.policy.ts,
invite-intake.ts, ride-ask.port.ts, ride-ask-sweep.ts, rider-social.service.ts, social-connections.controller.ts,
respect.service.ts, social-ride-ask.int.test.ts}`; `modules/rides/{rides-for-social(.port).ts, rides.repository.ts
(VIEWER_FIELDS, nextOfRider, join), rides-feed.service.ts (rideCardOf, lookupRoutes), ride-notices(.port).ts,
rides.events.ts}`; `modules/results/{results-read.service.ts (publicRow, protocolResults), results.policy.ts
(publicTableMode, isPublicProtocolRow), results-for-social(.port).ts, results-notices(.port).ts, results.repository.ts
(protocolRowsOfUser, findEntryById)}`; `modules/races/{race-registry(.port).ts, races.repository.ts}`;
`modules/routes/{routes-for-social(.port).ts, routes.repository.ts (IN_CATALOG, catalog page), routes-public.service.ts
(toCatalogCard, authorOf), route-notices.port.ts, routes.module.ts}`; `modules/identity/{auth.guard.ts,
identity.module.ts, account-confirmation.ts}`; `modules/product-events/*`; `modules/sharing/story-card.cache.ts`
(SET NX EX); `db/migrations/{0045_social.ts, 0049_route_rides_leaderboard_idx.ts, index.ts, migrations.int.test.ts}`;
`packages/contracts/src/social/{rider-social,ride-participants}.schema.ts`, `routes/route-catalog.schema.ts`,
`rides/ride.schema.ts`, `time.ts`; `apps/app/src/{app/(tabs)/index.tsx, features/home/*, features/social/*,
features/tickets/home-tickets.tsx, features/rides/{queries.ts, ride-detail.tsx}, components/{ride-list-row,
ride-going-action, going-stack, route-list-card}.tsx, features/notifications/notification-target.ts}`,
`apps/app/scripts/service-worker.ts`; `test/{social.ts, rides.ts, results.ts, routes.ts, notifications.ts}`;
`.claude/rules/{pokatim-backend,pokatim-db,pokatim-contracts,pokatim-app,pokatim-tests,pokatim-security}.md`.

### 11.7 TESTS

**Unit:** `social-home.view.test.ts` (отбор по кругу: 3 райда + 0 = 3 райда; 2/2/2 → ride, result, route; порядок
внутри вида; `riders` ≤ 3 и `othersCount`; `deltaSec` знак и `null`); `active-day.test.ts` (`activeDayTtlSec` у
полуночи Минска, ключ); `notification-intake.test.ts` (каждая новая ветка: `gone`/`state`/`invalid_payload`, «Свои
идут»: нет `seq`, участник вышел, непубличный, пустая аудитория, исключение организатора/участников); `home.schema
.test.ts` (незнакомый `kind` отброшен, `deltaSec` по умолчанию `null`); api-client `social.test.ts`;
`notification-target` (`?from=notification`); app `social-home-format.test.ts`.

**Интеграционные (реальная БД), по AC:**
- AC1 `social-home.int.test.ts`: строка ride (райд «своего» через 3 дня) / result (протокол вчера) / route (одобрен
  вчера); отрицательные — непубличный «свой», `removedAt`, чужая связь (не зрителя), ручная связь без обратной (RC-P7-1),
  отменённый, скрытый (`hideInDb`), райд через 7 дн + 1 мин, начавшийся; протокол не опубликован (предварительная
  таблица), протокол 7 дн + 1 мин назад, DQ-строка (новая ревизия), снятая; маршрут команды, без `showAuthorName`,
  снятый с каталога, опубликован 8 дн назад; > 3 кандидатов — ровно 3 по RC-P7-12; без строк — `{ items: [] }`;
  гость — 401; в ответе нет `userId` (`JSON.stringify` без uuid «своих»); `Cache-Control: no-store`; лимит — 429.
  `explain` трёх запросов портов — `IXSCAN` (`rides_participant_idx`, `race_protocol_rows_user_idx`,
  `races_protocol_published_idx`, `routes_catalog_idx` или `routes_owner_origin_idx`), без `COLLSCAN`.
- AC2: зритель в той же гонке и группе — `deltaSec` со знаком; другая группа / зритель без строки / DQ — `null`.
- AC3/AC5/AC6 `social-notices.int.test.ts` (outbox → `notifications-intake` через `h.worker.get(NotificationsIntake
  Processor)`, как `notifications-social.int.test.ts`): по одному кейсу на каждый `kind` — получатель, `actors`,
  цель; повтор той же задачи (тот же id события) — без дублей; два «спасибо» одному на райде — одно уведомление, два
  лица; два респекта гонке в одни сутки — одно, на следующие сутки — новое. «Свои идут»: аудитория без идущих, без
  убранных связей, без самого записавшегося, непубличный записавшийся — нет уведомления; аудитория > `fanoutChunk` —
  через пачки (одного кейса достаточно с маленьким `fanoutChunk`, если есть хук, иначе пропустить). «Как прошёл
  райд?»: прогон `RideAskSweep.run` → событие в outbox в той же транзакции (сбой `append` — `askedAt` откатился) →
  адресаты получили `social_ride_ask`. Снятый до приёма респект — `gone`.
- AC4: «В свои» → уведомление; убрать → снова «В свои» через 10 дн — нет; через 30 дн + 1 мин — есть
  (`h.clock.advance`); повторный `PUT connected: true` — нет; связь по райду, затем «В свои» — нет; снятие респекта —
  нет; `already_linked` — нет; `linked` — `social_invite_registered` пригласившему.
- AC7 `active-day.int.test.ts`: первый авторизованный запрос — одно `active-day {day}`; второй — нет; следующий день
  по Минску (`h.clock` через 21:00 UTC) — новое; публичный запрос и запрос панели — нет; `record` бросает — 200, лог
  `product_events.record_failed type=active-day`, ключ снят (следующий запрос пишет); Redis недоступен/завис
  (шпион `set` — вечный промис) — ответ ≤ ~200 мс, 200.
- RC-P7-20: существующие тесты с нефильтрованными событиями и `mockRejectedValueOnce` на `record` — поправлены, зелёные.
- Миграция: `migrations.int.test.ts` — индекс и идемпотентность.
- AC8 (отрицательные доказательства): `pnpm arch:check` зелёный; `rg "from '\.\./social'" apps/api/src/modules/{rides,
  results,routes,races,tracks,profile,identity}` — пусто; `rg "from '\.\./" apps/api/src/modules/product-events` —
  пусто; `rg "registerQueue" apps/api/src/modules/social` — один вызов; `git diff origin/develop --
  apps/api/src/{worker.module,app.module,outbox-routes}.ts` — пусто; `git diff origin/develop --
  apps/api/src/modules/notifications/{notification-texts,notifications.policy}.ts` — пусто; `rg "LoggingRideAskDue"
  apps/api` — пусто.
- **e2e/экран (AC9):** `home-social.test.tsx` — секция в слоте при «Кофе-райдах» (первой) и без (после выбранных);
  секция + подсказка в одном слоте; строки ведут на `/rides/<id>`, `/races/result/<raceId>/<entryId>`,
  `/routes/<id>`; «Я иду» → `joinRide(token, id, 'social_home')`; «Все свои» → `/social`; ошибка запроса и пустой
  ответ — секции нет, остальная Главная цела; гость — запроса нет. `ride-detail` — `?from=notification` →
  `'notification'`. Web-вариант — тот же компонент (без платформенных файлов); `pnpm e2e:web` — смоук Главной не
  ломается.

### 11.8 OUT OF SCOPE

Настройка «Выше / Ниже»; новые виды/группы/тексты уведомлений и экраны настроек; Telegram/e-mail «Своих»; отзыв
«Свои идут» при выходе из райда; ретро-«Как прошёл райд?» для захваченных до выката (RC-P5-11); выгрузка метрик;
фильтр «Свои» в таблицах (S-06); предварительная таблица как источник строки result; изменения публичных кэшируемых
ответов (`GET rides/:id`, `GET riders/:publicId`, каталог); пагинация `GET social/home` и «показать ещё»; кэш ответа
Главной на сервере; правка `ActivitySource`, `tracks`; новые очереди.

## 12. Outcome
