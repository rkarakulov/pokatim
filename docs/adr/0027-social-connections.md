# 0027. «Свои»: модуль `social`, явка на райде, имена в уведомлениях при чтении, журнал продуктовых событий

- Статус: Proposed
- Дата: 2026-10-31
- Задача: `docs/tasks/2026-10-31-social-stage-0` (P0 — каркас; P1–P7 — по таблице задачи)

## Контекст

Этап 0 социального слоя (`docs/product/social.md`, K1–K14) добавляет связи между райдерами, явку на райде,
благодарности и респекты, атрибуцию приглашений и метрики закрытого теста. Данные берутся из `rides`, `results`,
`routes`, `tracks`, `profile`, `identity`; показываются в их же экранах.

Ограничения кода (develop #147):
- outbox базы отправляет тип события в одну очередь: `rides.participant-joined` уже идёт в `notifications-intake`,
  `tracks.activity-ready` — в `results-intake`;
- публичные `GET rides/:id` и `GET riders/:publicId` кэшируются (`max-age=60`) — данные, зависящие от зрителя, в них
  класть нельзя;
- текст уведомления — снимок при приёме (ADR-0017), N12 запрещает чужие имена;
- `identity` ни от кого, кроме `tokens`, не зависит; с P7 — ещё лист `product-events` (активный день, п. 7, RC-14).

## Решение

1. **Модуль `social` — потребитель.** `social → rides, results, routes, tracks, profile, identity` только через
   `index.ts` и порты `*_FOR_SOCIAL` (по образцу `RESULTS_FOR_TICKETS`). На `social` ссылаются `notifications`
   (порт аудитории и имён для группы «Свои»), `account` (порт стирания), `sharing` (порт `InviteCodes` — адрес
   приглашения `<домен>/i/<код>` на карточках для сторис, P6; только HTTP-модуль, worker берёт адрес из задачи),
   `AppModule`, `WorkerModule`. Производители о `social` не знают; цикла нет — `social` не знает `sharing`. P4:
   `RESULTS_FOR_SOCIAL.respectTarget(entryId)` (`results`: строка публичной таблицы гонки — до публикации живые места,
   после — текущая ревизия; видимость — `ResultsReadService.publicRow` на общих с таблицей предикатах
   `publicTableMode` / `isPublicProtocolRow`) и `ROUTES_FOR_SOCIAL.respectTarget(routeId)` (`routes`: `findInCatalog` +
   `origin: rider`); `ResultsCoreModule` и `RoutesCoreModule` импортирует только HTTP-модуль `SocialModule` — ядро и
   worker порты «Респекта» не используют.
2. **Коллекции** (миграция `0045_social`, только expand; после `0043_achievements_seasonal` и
   `0044_route_rides_passed_idx` из develop):
   - `rider_connections` — направленная связь `ownerId → otherId`, уникальный `{ownerId, otherId}`; источники
     (`ride`, `invite`, `manual`), `rideCount`, `lastRideAt`, `manualAt`, `removedAt` (тихое удаление: связь
     скрыта, автоматические источники её не возвращают, K1);
   - `ride_attendance` — **один документ на райд** (`_id` = rideId, `entries: {userId, via: manual | track, at,
     declinedAt}[]`, запись на райдера, не больше участников райда): изменение явки и пересчёт связей `ride` — одна
     транзакция, первой операцией — условная запись в документ райда. Параллельные отметки одного райда конфликтуют
     по документу и повторяются на свежем снимке; при документе на райдера пары из гонки двух отметок терялись бы
     (write skew, RC-2). «Меня не было» ставит `declinedAt` (снимает любую явку, заезд её больше не ставит, RC-3);
     связи `ride` и их вес — производные от явки, пересчитываются по райду идемпотентно;
   - `social_reactions` — `kind: thanks | respect`, автор, цель (`ride_rider` | `race_entry` | `route`), получатель;
     уникальный `{actorId, kind, targetType, targetId, recipientId}` (RC-1: «спасибо» — одно на пару в райде, у
     `race_entry` и `route` получатель задан целью);
   - `invite_codes` — личный код райдера (случайный, уникальный), выдаётся лениво;
   - `product_events` — журнал метрик (п. 7).
3. **Данные зрителя — отдельные эндпоинты `social` под `AuthGuard`, `no-store`:** `GET rides/:id/participants`
   (участники с публичным профилем и явка), `GET riders/:publicId/social` («вместе ехали», «Идёт», состояние
   «В свои»), `GET social/connections`, `GET social/home`. Контроллеры с префиксом чужого ресурса — прецедент
   `riders/:publicId/me` в `profile`. Публичные кэшируемые ответы не меняются. P2: `RideParticipantsController` —
   `GET rides/:id/participants`, `POST rides/:id/attendance` («Я был на райде»), `POST rides/:id/attendance/decline`
   («Меня не было»; без тела, ответ — тот же `RideParticipants`); скрытый райд не организатору и неизвестный — `404`
   до вызова сервиса явки. «В свои» / «Убрать» (P3) — один
   идемпотентный `PUT riders/:publicId/social/connection { connected }` вместо пары глаголов (DELETE в CORS нет).
   P4: `POST rides/:id/thanks { publicId? }` («Спасибо за компанию» одному явившемуся или без `publicId` — всем
   явившимся, включая непубличных; ответ — `RideParticipants`), `GET|PUT races/:raceId/results/:entryId/respect` и
   `GET|PUT routes/:id/respect` (`SocialRespectController`; `PUT { respected }` идемпотентен, получатель — из цели
   порта, не от клиента; `GET` без цели — нейтральное состояние `200`, `PUT` — `404`, своя цель — `409 self`).
   Лимиты — `social-thanks:<uid>` и `social-respect:<uid>` (60/ч, первой проверкой мутаций).
   P7: `GET social/home` (`SocialHomeController`, лимит `social-home:<uid>` 60/мин) — до трёх строк секции Главной
   (K7): «свои» — исходящие не убранные связи зрителя с публичным профилем (`listOf`, ≤ 500); райд — опубликованный,
   старт в ближайшие 7 дн, участник «Иду» или организатор — «свой» **при взаимной связи** (как «Идёт» K6, RC-P7-1a;
   порт `RIDES_FOR_SOCIAL.upcomingWithRiders`); результат — видимая строка протокола, опубликованного за 7 дн
   (`RESULTS_FOR_SOCIAL.recentResults` на `publicTableMode`/`isPublicProtocolRow`/`protocolRevision`, разница с
   видимой строкой зрителя той же группы — сервер); маршрут — райдера в каталоге за 7 дн с подписью автора
   (`ROUTES_FOR_SOCIAL.recentByAuthors`, карточка каталога). Отбор — по кругу видов ride → result → route, показ —
   сгруппировано (RC-P7-12); признака «есть ещё» нет — «Все свои» ведёт на экран «Свои».
4. **Автоявка — подписка `social` на `tracks.activity-ready`** (fan-out `mergeOutboxRoutes`, api-kit ≥ 0.6.0),
   нового события в `tracks` нет. Группу и старт основной `social` читает портом `ACTIVITY_STARTS`, райды —
   `RIDES_FOR_SOCIAL` (точный старт — только при маршруте каталога). `results-intake` не меняется. Регламент
   `social-maintenance` раз в 30 мин отбирает райды через 4 ч после старта: захват `askedAt` в документе явки райда и
   точка привязки P7 `RIDE_ASK_DUE` в той же транзакции. Уточнено в P5 (2026-11-01).
5. **Атрибуция приглашения — в `identity`.** `RegisterRequest.invite` (необязательное поле, старые сборки
   совместимы; неверный формат отбрасывается, не 400) сохраняется на `users.invite`; при **первом** подтверждении
   e-mail аккаунта **с кодом** — по ссылке из письма или сбросом пароля (общий шаг `AccountConfirmation`, условная
   запись `emailVerifiedAt: null`) — `identity` в той же транзакции пишет `identity.account-confirmed {userId,
   invite}` (`invite` обязателен; аккаунт без кода события не порождает). Маршрут `→ social-intake` объявляет
   подписчик (`socialOutboxRoutes`), `social` разрешает код в пригласившего (`InviteCodes.ownerOf`), проверяет живость
   обоих портом `IdentityAccounts.liveUserIds` и создаёт связь `invite` (`linkInvite`; `invite-registered` — при
   первом `inviteAt` стороны пригласившего). `identity` о `social` не знает. Уточнено в P6 (2026-10-31).
6. **Уведомления группы «Свои» — имена при чтении** (поправка к ADR-0017 «текст — снимок» и N12). `NotificationDoc`
   получает `actors: userId[]` и `params`; для группы `social` `title/body` собираются при чтении списка и при
   отправке push из текущих публичных имён (`RIDER_NAMES.publicRiders`), нет имени — «Райдер». Схлопывание копит
   `actors` вместо замены документа. Остальные группы не меняются. События `social.*` → очередь
   `notifications-intake`; «Свои идут» строится из `rides.participant-joined` портом аудитории `social`.
   **Привязка (social-p7):** `social` пишет outbox в транзакции действия — `social.reaction-created { reactionId }`
   (`SocialReactionsService.insert`), `social.connection-added { ownerId, otherId }` (`addManual`, K11),
   `social.invite-registered { inviterId, inviteeId }` (`linkInvite`, впервые), `social.ride-ask-due { rideId, userIds }`
   (`OutboxRideAskDue` в транзакции захвата P5); payload — только id. Маршрут — `notificationsOutboxRoutes`;
   `NotificationIntake.drafts(…, eventId)` строит черновики `socialNoticeDraft`, состояние «сейчас» — порт
   `SOCIAL_NOTICES` (`reaction`, `connected`, `goingAudience`), названия — `RIDE_NOTICES`, `ROUTE_NOTICES`,
   `RACE_REGISTRY` + `RESULTS_NOTICES.entryRace`. «Свои идут» — записавшийся = участник с `seq` события; только
   публичный; аудитория — взаимные «свои» записавшегося без организатора и участников. K11 — отметка
   `rider_connections.manualNoticeAt`: «Вас добавили» не чаще раза в 30 дн на пару (от последнего уведомления).
   **Уточнение (social-p1):** накопление — условный upsert по окну `(userId, collapseKey)` с `$push` лица при «его ещё
   нет» и «потолок 100 не достигнут» (`$addToSet` без условия снова делал бы прочитанное непрочитанным при повторе
   того же лица); дубль уникального ключа — один повтор без upsert. Создающее событие и доставка — только при вставке:
   push — при создании уведомления, повтор в окне — строка снова непрочитана и наверху, без push. Окно «в сутки» —
   день события outbox по Минску (время uuidv7), не время приёма. Цель `rider` («Вас добавили», «По ссылке») в
   документе не хранится — выводится при чтении из того же лица, чьё имя показано (`publicId` отзываем). В документе
   — запасной текст с «Райдер» (если рендер с именами не смог).
7. **Журнал продуктовых событий — листовой модуль `product-events`** без зависимостей, порт `PRODUCT_EVENTS.record`.
   Пишут `social`, `rides` (источник «Иду» — необязательное тело `join` `{ source }`: событие `ride-joined` — только
   новой записи, после коммита транзакции `join`, сбой — лог без отказа), `identity` (активный день, дедуп в
   Redis на сутки по Минску). **Активный день (P7):** `AuthGuard` после проверки сессии зовёт `ActiveDay.touch` —
   `SET active-day:<uid>:<день> NX EX` до начала следующих суток по Минску + 1 ч, при захвате — `active-day { day }`;
   ожидание ≤ 200 мс, сбой записи — `DEL` ключа и лог `product_events.record_failed type=active-day`, запрос не
   падает. Панель (`PanelGuard`) и публичные ручки его не проходят. Журнал append-only; единственное исключение — удаление записей райдера шагом стирания
   аккаунта (K13). Наружу не уходит, выгрузка — скрипт. Справочник событий и их `props` — zod внутри API
   (`product-events.types.ts`), не в contracts (RC-11); в `props` — только поля-справочники, без id пользователей:
   стирание удаляет события по их `userId` (RC-12, `invite-registered` — с `userId` пригласившего).
8. **Стирание аккаунта** — шаги `social` и `product-events` после `tickets`, до `notifications` и `identity`
   (`ERASURE_STEPS` — в порядке исполнения): явки райдера (первыми), связи в обе стороны, свои реакции и полученные,
   код приглашения; затем события метрик. Связи остальных участников между собой от явки удалённого не зависят и не
   пересчитываются (RC-7).
9. **Лимит** ручного «В свои» — `consumeUserLimit` `social-manual:<uid>`, 30 за 24 ч.

## Последствия

- Новые очереди `social-intake`, `social-maintenance`; новое outbox-событие в `identity` (`tracks` — без новых
  событий, P5).
- `notifications` получает Nest-импорт `profile` (`ProfileCoreModule`, порт `RIDER_NAMES`) в P1 и `social`
  (`NotificationsWorkerModule → SocialCoreModule`, порт `SOCIAL_NOTICES`) — в P7 (правило «текст — снимок» в
  `pokatim-backend.md` и `pokatim-db.md` дополняется исключением для группы «Свои»).
- P7: ребро `identity → product-events` (лист, dependency-cruiser его не ограничивает); `RoutesCoreModule` импортирует
  `ProfileCoreModule` (имя автора для Главной); миграция `0050_social_home` — индекс `races_protocol_published_idx`.
- Имя в тексте push остаётся на устройстве после удаления аккаунта — принятый риск (решение автора 2026-10-31).
- Явка — первый факт «был на райде» (R8); километры райдов в статистику по-прежнему не входят.
