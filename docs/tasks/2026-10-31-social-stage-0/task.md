# «Свои», этап 0 — эпик и P0 (каркас)

Уровень: task3. Эпик из восьми PR (P0–P7, таблица в п. 3.2); этот task.md — общий спек эпика и полный спек P0.
Каждый следующий PR получает свой `docs/tasks/<дата>-social-p<N>-<slug>/task.md` со ссылкой сюда.

## 1. Title

Социальный слой «Свои», этап 0: связи райдеров из совместной езды и приглашений, явка на райде, благодарности и
респекты, уведомления группы «Свои», секция на Главной, журнал продуктовых событий.

## 2. Goal

Сохранять связи, которые продукт уже создаёт (совместный райд, приглашение), и показывать их внутри существующих
экранов — к закрытому тесту на 10–20 человек (конец ноября 2026) с метриками с первого дня.
Продукт — `docs/product/social.md` (K1–K14), архитектура — ADR-0027. Источник — предложение от 2026-10-29
(S-01…S-13) и ответы автора 2026-10-30/31.

## 3. Scope

### 3.1 P0 — этот PR

1. **Документы:** `docs/product/social.md`, ADR-0027; правки `profile.md` (R8 — явка, R9 — строки K6, подсказка K3),
   `rides.md` (K4, K5), `notifications.md` (N3 — события группы «Свои», N4 — шестая группа, N12 — исключение), `home.md`
   (K7, K3), `docs/product/README.md`; правила `pokatim-backend.md` / `pokatim-db.md` — модуль `social`,
   исключение «текст — снимок» для группы «Свои», исключение append-only `product_events` для стирания.
2. **Миграция `0043_social`** (expand): коллекции `rider_connections`, `ride_attendance`, `social_reactions`,
   `invite_codes`, `product_events` и индексы (ADR-0027 п. 2).
3. **Модуль `product-events`** (листовой): коллекция, `PRODUCT_EVENTS.record(event)` (тип события — закрытый
   справочник K12, `userId`, `props`, `at`), стирание по `userId`, шаг `product-events` в оркестраторе удаления.
4. **Модуль `social`** — доменное ядро без HTTP и экранов:
   - `SocialCoreModule`, `SocialWorkerModule` (пока без процессоров), регистрация в `app.module.ts`,
     `worker.module.ts`, имена очередей `social-intake`, `social-maintenance` в `queues.ts`;
   - репозитории коллекций; сервис связей: ручное добавление (лимит 30/24 ч, нельзя себя, только публичный
     профиль другого), тихое удаление (`removedAt`), пересчёт связей `ride` по райду из явки (идемпотентно, уважает
     `removedAt`), связь `invite` в обе стороны, список «своих» владельца, «вместе ехали» для пары;
   - сервис явки: отметить / снять (ручная — от старта до +7 дней, только «Иду» и организатор, не отменён, не скрыт),
     отметка `track` (без окна ручной правки), пересчёт связей после изменения;
   - сервис реакций: `thanks` (только между явившимися на одном райде), `respect` (результат гонки, райдерский
     маршрут), переключение, нельзя себе; счётчик по цели;
   - порты-интерфейсы, которые реализуют производители в следующих PR: `RIDES_FOR_SOCIAL` (участники, фаза, точный
     старт), `RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL`, `ACTIVITY_STARTS` — в P0 только `RIDES_FOR_SOCIAL` с
     реализацией в `rides` (нужен ядру явки), остальные объявляются в своих PR;
   - `SocialErasure`: шаг `social` до `notifications` и `identity` в `account-erasure.service.ts`, значения
     `social` и `product-events` в `ERASURE_STEPS` (в конец), подписи в `packages/i18n/src/ru.ts`.
5. **Contracts:** `packages/contracts/src/social/` — общие схемы (`ConnectionSource`, `ProductEventType`,
   `ReactionKind`, `ReactionTargetType`), экспорт из корня один раз. Эндпоинты и их DTO — в своих PR.

### 3.2 Декомпозиция эпика

| PR | Что | Зависит | Параллельно |
|---|---|---|---|
| P0 | Каркас (п. 3.1) | — | — |
| P1 | Уведомления: группа `social`, `settings/social`, `actors` + имена при чтении (список и push), схлопывание с `$addToSet`, новые `kind` и цели в конец, экран настроек, копия целей в service worker | P0 | P2, P3, P6 |
| P2 | Райд: `GET rides/:id/participants`, «Я был / Меня не было», карточка прошедшего райда (K4, K5 без «спасибо»), источник «Иду» в `join` → `product_events` | P0 | P1, P3, P6 |
| P3 | Профиль: `GET riders/:publicId/social`, «В свои» / «В своих», экран «Свои», строка «Свои · N» в своём профиле, подсказка имени K3 (профиль, Главная) | P0 | P1, P2, P6 |
| P4 | Реакции: «Спасибо за компанию» на карточке райда, «Респект» на экране соперника и после «Маршрут пройден» (`RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL`) | P0, P2 | P5, P6 |
| P5 | Автоявка: `tracks.activity-recorded` → `social-intake`, порт `ACTIVITY_STARTS`, сверка K2; регламент «Как прошёл райд?» | P0, P2 | P4, P6 |
| P6 | Приглашения: личный код, параметр в ссылках шеринга, хранение 7 дней на клиенте, `RegisterRequest.invite`, `identity.account-confirmed` → связь `invite` | P0 | P1–P5 |
| P7 | Главная «Свои» (`GET social/home`, порядок K7) и привязка всех уведомлений K10 к intake; активный день в `product_events` | P1–P6 | — |

Правило для параллельных PR: правки `notification-intake.ts`, `notification-texts.ts`, `notifications.policy.ts` —
только в P1 (инфраструктура) и P7 (привязка). Добавления в общие файлы (`contracts/src/index.ts`,
`api-client/src/index.ts`, `i18n/src/ru.ts`, `migrations/index.ts`, `app.module.ts`, `worker.module.ts`) — только в
конец списков. Новых миграций после P0 — с номером по факту слияния.

## 4. Out of Scope

Всё из «Не входят» и K14 `social.md`: S-06, S-08 (Telegram), S-09, S-10, S-13; чат, комментарии, лента, заявки в
друзья, сегменты. Фича-флаг (решение автора — без флага). В P0 — никаких эндпоинтов и экранов.

## 5. Architecture Context

ADR-0027. Затронуто в P0: `apps/api` (новые модули `social`, `product-events`; `rides` — порт; `account` —
шаги стирания; миграция), `packages/contracts` (social, `ERASURE_STEPS`), `packages/i18n`, `apps/admin` (только
подпись шага стирания приходит из i18n — проверить экран журнала удалений). Совместимость: `ERASURE_STEPS` — строгий
`z.enum`, панель деплоится вместе с API (как прежние добавления шагов).

## 5.1 Placement & Reuse Gate

- Переиспользуем: `writeWithEvent`/outbox, `consumeUserLimit` (`apps/api/src/user-limit.ts`), `ensureCollection` +
  `*_INDEXES` (образец `0038_tickets.ts`), образец порта стирания `rides/ride-erasure.ts`, `isPublicProfile` /
  `RIDER_NAMES.publicRiders` (profile), `ridePhase` (rides.policy).
- Запрещено: читать коллекции `rides`, `profiles`, `activities` напрямую из `social` — только порты; писать в
  `product_events` минуя порт; дублировать вычисление фазы райда.
- Тонкие контроллеры (в P0 их нет); логика — в сервисах `social`.
- Architect (2026-10-31): `isPublicProfile` из `profile/index.ts` не экспортирован — публичность через
  `RIDER_NAMES.publicRiders` (RC-16); `ridePhase` вызывается только внутри `rides` (поле `phase` порта
  `RIDES_FOR_SOCIAL`); ошибки — `domainError` (`apps/api/src/error-messages.ts`); `isDuplicateKey`/`uuidv7` —
  `@rkarakulov/api-kit/mongo`. Новый пакет не нужен (один потребитель — `apps/api`).

## 6. Relevant Files

- `apps/api/src/modules/rides/{rides.collection.ts,rides.policy.ts,index.ts,ride-erasure.ts}` — участники, фаза, образец стирания.
- `apps/api/src/modules/account/{account-erasure.service.ts,account.module.ts}` — шаги стирания.
- `apps/api/src/modules/profile/{rider-names.port.ts,profile.policy.ts}` — публичность.
- `apps/api/src/db/migrations/{0038_tickets.ts,index.ts}`, `migrations.int.test.ts` — миграции.
- `apps/api/src/{app.module.ts,worker.module.ts,queues.ts,user-limit.ts}` — регистрация.
- `packages/contracts/src/admin/account-erasures.schema.ts`, `packages/i18n/src/ru.ts`.
- `.claude/rules/pokatim-backend.md`, `.claude/rules/pokatim-db.md`.

## 7. Implementation Notes

- Связь `ride` — производная: пересчёт по райду берёт явившихся, для каждой пары `owner → other` ставит источник
  `ride`, `rideCount` = число общих райдов с явкой обоих, `lastRideAt`. Снятие явки уменьшает. Документ без
  источников удаляется. `removedAt` скрывает связь и не сбрасывается автоматикой; ручное добавление сбрасывает.
- Публичность другого проверяется при чтении, не при записи (K3): связь с непубличным хранится, в выдачах скрыта.
  Исключение — ручное добавление: только к публичному профилю.
- Окна явки и пороги автоявки — константы политики модуля (`social.policy.ts`), чтобы P5 их не дублировал.
- `product_events.props` — только перечисленные в схеме поля, без свободного JSON с ПДн.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` пороги K2 (−30 мин / +2 ч / 500 м), 7 дней хранения кода приглашения, «Не сейчас» на 14 дней.
- Пересчёт связей на райд до 100 участников — до ~10 000 пар на upsert: делать `bulkWrite` пачками; при
  практических 5–12 участниках не проблема.
- Гонки «отметил явку ↔ удалил аккаунт» — пересчёт идемпотентный, повторный проход стирания исправляет.
- Имя в push остаётся на устройстве — принятый риск (K10).

## 8.1 Requirements Consistency (заполняет architect)

Architect, 2026-10-31. Сверка с кодом: ветка `feature/social-stage-0` (3f9e11a2) против `origin/develop` (47c1b9d8,
#148–#151 уже слиты); слияние develop сейчас проходит без конфликтов (в ветке только новые файлы).
Статус ревью — **BLOCKERS** (RC-1, RC-2): у обоих есть рекомендация, и оркестратор может снять их, приняв её. Правка
ADR-0027 п. 2 — в этом же PR, отклонения — в 8.2.

**Блокеры (решить до запуска coder):**

- **RC-1. Уникальный индекс реакций противоречит K5.** ADR п. 2: `{kind, actorId, targetType, targetId}`. Цель
  `ride_rider` — райд, поэтому выходит одно «спасибо» на автора в райде, а K5 требует одно на пару в райде
  («Поблагодарить всех»). Варианты: (a) включить получателя в ключ: `{actorId, kind, targetType, targetId,
  recipientId}`; (b) составной `targetId = <rideId>:<userId>` для `ride_rider`; (c) отдельная коллекция для «спасибо».
  **Рекомендация (a):** у `race_entry` и `route` получатель однозначно задан целью, ключ ничего не ослабляет;
  `actorId` первым даёт префикс для «кого я уже поблагодарил» и для стирания.
- **RC-2. Пересчёт связей по явке на документах «один райдер — один документ» допускает write skew.** Пусть две явки
  одного райда пишутся параллельно: две ручные или две автоявки в `social-intake` (P5). Каждая операция пишет свой
  документ `{rideId, userId}` и читает список явившихся по снимку, где чужой записи ещё нет. Тогда пара A↔B не
  создаётся никогда. Снятие явки параллельно с отметкой оставляет висячую пару. Транзакция не спасает: документы
  разные, конфликта записи нет. Варианты:
  (a) **явка райда — один документ на райд**: `ride_attendance { _id: rideId, entries[] }`, не больше
  `RIDE_MAX_PARTICIPANTS` = 100 (образец — `rides.participants`). Изменение явки и пересчёт связей идут одной
  транзакцией. Конфликт записи на документе райда сериализует пересчёты, повтор `withTransaction` видит свежий набор;
  (b) документы по райдеру + коллекция-замок райда (шестая коллекция, запись в неё первой в транзакции);
  (c) документы по райдеру + отложенная сверка райда регламентом `social-maintenance`: итог согласуется позже, а до
  тех пор возможны неверные связи и уведомления.
  **Рекомендация (a):** меньше сущностей, все инварианты явки держит один документ — так же, как у участия. Это
  отклонение от ADR п. 2 («`{rideId, userId}` уникально»). Нужно отрицательное доказательство (см. п. 11, TESTS).

**Уточнения (coder идёт по рекомендации, если автор не возразит):**

- **RC-3. «Меня не было» и автоявка.** По K2 «Меня не было» отменяет только ручную явку. Ложную автоявку (райдер ехал
  рядом, но не с группой) тогда отменить нельзя, и связи из неё остаются навсегда. Варианты:
  (a) «Меня не было» снимает любую явку в окне 7 дней и ставит в записи `declinedAt`; P5 по такой записи не ставит
  автоявку повторно, а ручное «Я был» отметку сбрасывает;
  (b) как в K2 — снимается только ручная;
  (c) снимается любая, но без отметки — P5 вернёт явку при повторной синхронизации.
  **Рекомендация (a);** поле `declinedAt` закладывается в P0.
- **RC-4. Повтор «спасибо».** Спек P0 говорит «переключение» для всех реакций, K5 — «Вы сказали спасибо» (без отмены),
  K8 — повтор снимает респект. **Решение:** `thanks` идемпотентно (повтор — no-op), `respect` переключается.
- **RC-5. `respect` в P0 без портов.** Проверка цели (результат гонки, райдерский маршрут `origin: rider`, владелец)
  требует `RESULTS_FOR_SOCIAL` и `ROUTES_FOR_SOCIAL`, а они появятся только в P4. **Решение:** в P0 — общий
  `toggleRespect(actorId, target)` с уже разрешённой целью `{ targetType, targetId, recipientId }`: «не себе»,
  уникальность, счётчик. Разрешение цели через порты — P4. AC4 для респекта проверяется на заданной цели.
- **RC-6. Тихое удаление против «документ без источников удаляется».** Если удалить документ с `removedAt`, следующий
  совместный райд создаст связь заново, а это нарушает K1. **Решение:** документ с `removedAt` не удаляется (это
  надгробие). Удаляется только документ с `removedAt: null` и без источников.
- **RC-7. AC5 «связи других участников райда пересчитаны».** `rideCount` пары B↔C не зависит от явки A, пересчитывать
  нечего. **Уточнение AC5:** стирание удаляет связи A в обе стороны и все записи A в явке; связи остальных между собой
  не меняются. Int-тест проверяет, что B↔C до и после совпадают.
- **RC-8. Номер миграции.** `0043` свободен на `origin/develop`, но уже занят в готовой локальной ветке
  `feature/achievements-seasonal` (`0043_achievements_seasonal`, Codex APPROVE 2026-10-31, worktree
  `achievements-seasonal-levels-d4bfd8`). **Решение:** номер — по факту слияния, как в п. 3.2. Ожидаемо
  `0044_social`; в тесте порядка — «сразу после предыдущей».
- **RC-9. Ветка отстаёт от develop.** В #148–#151 изменены `notifications.md`, `profile.md`, правила `pokatim-*.md`,
  `ru.ts` и модуль `notifications` (fanout). В N4 теперь **пять** групп (добавлены «Маршруты», `NOTIFICATION_GROUPS`
  = `races, disputes, rides, events, routes`). Поэтому сначала `merge origin/develop`, потом правки документов P0.
  «Пятая группа» в K10, п. 3.1.1 и N4 превращается в **шестую**: `social` — последней в `NOTIFICATION_GROUPS` (P1).
- **RC-10. Порядок `ERASURE_STEPS`.** Спек говорит «в конец», а код и комментарий схемы держат порядок исполнения
  (`tickets` вставлен перед `notifications`). Совместимость порядок не затрагивает: `z.enum`, панель деплоится вместе
  с API. **Решение:** вставлять в порядке исполнения: `…, 'tickets', 'social', 'product-events', 'notifications',
  'identity'`.
- **RC-11. `ProductEventType` в contracts.** Журнал не выходит наружу (K12), API его не отдаёт, а contracts — это
  схемы API. **Решение:** справочник событий и их `props` — в `modules/product-events/product-events.types.ts`
  (zod внутри API). В contracts — только то, что пойдёт по API в P2–P6: `ConnectionSource`, `ReactionKind`,
  `ReactionTargetType`, `AttendanceVia`, `RideJoinSource`, `SocialBlockReason`.
- **RC-12. В `props` нет чужих `userId`.** Стирание удаляет события только по их `userId`; id другого райдера внутри
  `props` пережил бы удаление его аккаунта (K13). **Правило:** в `props` — только поля-справочники схемы, без id
  пользователей. `invite-registered` пишется с `userId` пригласившего и без id приглашённого.
- **RC-13. Пустые `SocialWorkerModule` и имена очередей в P0** (§4.9). Принимается как якорь композиции для
  параллельных P1–P7: дальше правки идут только в `social/*`, не в `worker.module.ts` и `app.module.ts`. Имена в
  `queues.ts` — в P0; `BullModule.registerQueue` и процессоры — в P5 и P7.
- **RC-14 (P7, не P0).** Контекст ADR говорит «identity ни от кого, кроме tokens, не зависит», а п. 7 — «identity
  пишет активный день». Появится новое ребро `identity → product-events`. Модуль листовой, цикла нет; формулировку
  ADR и правила поправить в P7.
- **RC-15. Райд скрыт модератором после явки.** Случай не определён. **Предположение:** новые отметки и снятие
  закрыты (`ride_unavailable`); уже созданные явки и связи остаются (совместная езда — факт). После «Вернуть» действия
  снова доступны в окне 7 дней.
- **RC-16. Проверка публичности.** `isPublicProfile` не экспортирован из `profile/index.ts`. Ручное добавление
  проверяет то же условие через `RIDER_NAMES.publicRiders([otherId]).has(otherId)`. Неизвестный, непубличный и
  удалённый аккаунт дают одинаковый `404 NOT_FOUND`, чтобы не раскрывать существование аккаунта (K3).

**Решения оркестратора (2026-10-31):** RC-1 (a) и RC-2 (a) приняты — блокеры сняты; RC-3…RC-16 — по рекомендациям
architect, кроме RC-8: номер миграции — **`0043_social`** (на develop свободен; если `feature/achievements-seasonal`
сольётся раньше — перенумеровать при слиянии). «Свои» — шестая группа уведомлений (RC-9): правки K10, N4, п. 3.1.1 —
в этом PR. Отклонения перенесены в 8.2.

## 8.2 Deviations from spec

Приняты оркестратором 2026-10-31 (ADR-0027 п. 2, 7, 8 поправлен в этом PR):

- **RC-1** — уникальный ключ реакций `{actorId, kind, targetType, targetId, recipientId}` (в ADR было без получателя).
- **RC-2a** — `ride_attendance` — один документ на райд `{_id: rideId, entries[]}`; отметка и пересчёт связей —
  одна транзакция (в ADR было `{rideId, userId}` уникально).
- **RC-3a** — «Меня не было» снимает любую явку и ставит `declinedAt`; явка по треку такую запись не перекрывает,
  ручное «Я был» сбрасывает (в K2 было — только ручную).
- **RC-8** — миграция `0043_social` (architect предлагал `0044` из-за локальной ветки achievements-seasonal).
- **RC-10** — `ERASURE_STEPS` в порядке исполнения: `…, 'tickets', 'social', 'product-events', 'notifications',
  'identity'` (в спеке — «в конец»).
- **RC-11** — справочник продуктовых событий — `apps/api/src/modules/product-events/product-events.types.ts`, в
  contracts только `ConnectionSource`, `ReactionKind`, `ReactionTargetType`, `AttendanceVia`, `RideJoinSource`,
  `SocialBlockReason` (в п. 3.1.5 был `ProductEventType`).

Уточнения реализации (coder, в рамках рекомендаций; на ревью):

- `unmark` без записи явки пишет запись с `declinedAt` (явки не было — связи не меняются, событий нет): поздний трек
  после «Меня не было» явку не ставит (логика RC-3a).
- В contracts добавлена схема `SocialActionBlockedDetails` (`details` у `409 SOCIAL_ACTION_BLOCKED`, `tolerantEnum` —
  как `DisputeActionBlockedDetails`).
- `togetherOf` отдаёт общие райды и после «Убрать из своих» (факт совместной езды, K6 — относительно смотрящего);
  `listOf` — без пагинации (эндпоинт и страница — P3).
- Методы сервисов возвращают `boolean` «изменилось» (`addManual` — связь создана, `markManual`/`unmark`/`markByTrack` —
  явка изменилась, `thank` — новое «спасибо», `toggleRespect` — респект поставлен).
- Известное допущение (ревью pass 1, LOW): `addManual` повторяет операцию при `isDuplicateKey` пары, upsert пары в
  пересчёте явки — нет (в транзакции конфликт ожидается как `WriteConflict`). Проверка воротами — в P3, вместе с
  эндпоинтом «В свои».

## 8.3 Security checklist

Затронуто: удаление аккаунта (`pokatim-security.md`), ПДн в новых коллекциях. AuthZ — в P1–P7 (эндпоинты).
Злоупотребления — лимит K11. Логи — без имён и e-mail.

## 9. Acceptance Criteria (P0)

1. Миграция создаёт пять коллекций с индексами; сторож индексов в `migrations.int.test.ts` зелёный; повторный запуск
   миграции — без ошибок.
2. Ядро связей (int-тесты на Mongo): ручное добавление и лимит 30/24 ч (31-е — `RATE_LIMITED`), нельзя себя и
   непубличного; тихое удаление скрывает и не возвращается пересчётом; ручное после удаления возвращает.
3. Явка: ручная только у «Иду»/организатора, от старта до +7 дней, не у отменённого и скрытого — иначе ошибки домена;
   снятие явки пересчитывает `rideCount` у всех пар; повтор операций идемпотентен.
4. Реакции: `thanks` только между явившимися, `respect` себе — нельзя, повтор снимает; уникальный индекс держит гонку.
5. Стирание: шаги `social` и `product-events` удаляют всё по `userId`, связи других участников райда пересчитаны;
   повторный проход — без ошибок; `ERASURE_STEPS` и подписи на месте.
6. `PRODUCT_EVENTS.record` пишет только типы справочника; `pnpm arch:check` — `product-events` без зависимостей,
   `social` зависит от `rides` только через `index.ts`.
7. `pnpm check` зелёный.

## 10. Documentation Impact

П. 3.1.1: `social.md`, ADR-0027 (+ индекс), `profile.md`, `rides.md`, `notifications.md`, `home.md`,
`docs/product/README.md`, `pokatim-backend.md`, `pokatim-db.md`.

Architect (2026-10-31), дополнительно:
- ADR-0027 п. 2: ключ `social_reactions` с `recipientId` (RC-1), форма `ride_attendance` (RC-2) и `declinedAt` (RC-3),
  номер миграции по факту слияния (RC-8); п. 8 — без «пересчёта связей других» (RC-7); п. 7 — справочник событий в
  API, `props` без id пользователей (RC-11, RC-12).
- `social.md` K10, п. 3.1.1 и `notifications.md` N4 — группа «Свои» **шестая** (после слияния develop, RC-9);
  K2 — «Меня не было» по RC-3; K5 — повтор «спасибо» no-op (RC-4).
- `pokatim-backend.md`: модули `social` и `product-events` (зависимости, порты `RIDES_FOR_SOCIAL`, `PRODUCT_EVENTS`,
  `SocialErasure`, `ProductEventErasure`); список зависимостей `account → …, social, product-events`.
- `pokatim-db.md`: пять коллекций и индексы; порядок шагов стирания `… → билеты → свои → события метрик →
  уведомления → identity`; исключение append-only для `product_events`.
- `pokatim-contracts.md`: `src/social/social.schema.ts`, код `SOCIAL_ACTION_BLOCKED`.
- `.dependency-cruiser.cjs` — правила `product-events-leaf`, `social-consumers-only` (комментарии в файле).
- `pr.md`: миграция (expand, номер), новые шаги стирания, совместимость `ERASURE_STEPS` (панель деплоится с API).

## 11. Implementation Context

Architect, 2026-10-31. Описывает вариант RC-2a. При выборе (b) или (c) меняется только раздел `ride_attendance`.

**ENTRY POINTS** (в P0 их вызывают только int-тесты и стирание):
- `SocialConnectionsService`: `addManual`, `remove`, `linkInvite`, `listOf`, `togetherOf`;
  `SocialAttendanceService`: `markManual`, `unmark`, `markByTrack`; `SocialReactionsService`: `thank`,
  `toggleRespect`, `countFor`.
- `PRODUCT_EVENTS.record` и шаги `social`, `product-events` в `AccountErasureService.run`.

**FILES TO CREATE**
- `apps/api/src/db/migrations/0044_social.ts` (номер — RC-8; по решению оркестратора — `0043_social.ts`). Образец — `0038_tickets.ts`: экспорт `SOCIAL_INDEXES`
  (`satisfies Record<string, readonly IndexDef[]>`) и `social: MongoMigration` (`ensureCollection` из
  `0002_identity`, затем `createIndex` по списку). Только expand, без транзакции и бэкфилла, идемпотентна.
- `apps/api/src/modules/product-events/`:
  - `index.ts`;
  - `product-events.module.ts` — `ProductEventsCoreModule` без imports (`MONGO_DB`, `CLOCK` глобальные): провайдеры
    `ProductEventsRepository`, `ProductEventsService` + `{ provide: PRODUCT_EVENTS, useExisting }`,
    `ProductEventErasure`; exports — `PRODUCT_EVENTS`, `ProductEventErasure`;
  - `product-events.collection.ts`, `product-events.types.ts`, `product-events.port.ts`,
    `product-events.repository.ts`, `product-events.service.ts`, `product-event-erasure.ts`;
  - тесты: `product-events.types.test.ts`, `product-events.int.test.ts`.
- `apps/api/src/modules/social/`:
  - `index.ts` — экспортирует `SocialCoreModule`, `SocialModule`, `SocialWorkerModule`, `SocialErasure`;
  - `social.module.ts`:
    - `SocialCoreModule` — imports `RidesCoreModule`, `ProfileCoreModule`, `ProductEventsCoreModule`; репозитории,
      три сервиса, `SocialErasure`;
    - `SocialModule` — imports `SocialCoreModule`, `controllers: []` (контроллеры P2–P4, P7);
    - `SocialWorkerModule` — imports `SocialCoreModule`, `providers: []` (P5, P7);
  - `social.collection.ts` — `SOCIAL_COLLECTIONS`, документы, `socialCollections(db)`;
  - `social.policy.ts` + `social.policy.test.ts`;
  - репозитории: `connections.repository.ts`, `attendance.repository.ts`, `reactions.repository.ts`,
    `invite-codes.repository.ts` (в P0 только стирание);
  - сервисы: `connections.service.ts`, `attendance.service.ts`, `reactions.service.ts`;
  - `social-erasure.ts`;
  - int-тесты: `social-connections.int.test.ts`, `social-attendance.int.test.ts`, `social-reactions.int.test.ts`.
- `apps/api/src/modules/rides/rides-for-social.port.ts`, `rides-for-social.ts` (реализация),
  `rides-for-social.int.test.ts`.
- `apps/api/test/social.ts` — хелперы стенда: прошедший райд с участниками (`createRide` + `join` из `test/rides.ts`,
  затем сдвиг часов `h.clock` за старт), `socialDb(h)`, сервисы через `h.worker.get(...)`.
- `packages/contracts/src/social/social.schema.ts` + `social.schema.test.ts`.

**FILES TO MODIFY** (в общих файлах — только добавление в конец списков)
- `apps/api/src/db/migrations/index.ts` — import и `social` в конец массива.
- `migrations.int.test.ts` — id в списке «применены по порядку»; новый `it('0044_social: …')` по образцу `0038_tickets`;
  у `0042_profile_report_reasons` убрать `expect(ids.at(-1))`.
- `rides/rides.repository.ts` — `findForSocial(id)` с проекцией `_id, status, startsAt, organizerUserId,
  participants.userId, geo, startPrecise`.
- `rides/rides.module.ts` — провайдер, `{ provide: RIDES_FOR_SOCIAL, useExisting: RidesForSocialService }`, export.
- `rides/index.ts` — экспорт порта и типов.
- `account/account.module.ts` — `AccountWorkerModule.imports` += `SocialCoreModule`, `ProductEventsCoreModule`.
- `account/account-erasure.service.ts` — два шага после `tickets`, до `notifications`.
- `account/account-erasure.int.test.ts` — список шагов в тесте логов и новый `describe`.
- `app.module.ts` += `SocialModule` (в конец); `worker.module.ts` += `SocialWorkerModule` (в конец).
- `queues.ts` += `socialIntake: 'social-intake'`, `socialMaintenance: 'social-maintenance'` (в конец, с комментариями
  jobId: P5 — id события outbox, P7 — регламент).
- `packages/contracts/src/index.ts` += `export * from './social/social.schema.ts';` (один раз, в конец).
- `packages/contracts/src/common.ts` — `'SOCIAL_ACTION_BLOCKED'` в конец `defineErrorCodes` с комментарием;
  `common.test.ts` — список порядка кодов.
- `packages/contracts/src/admin/account-erasures.schema.ts` — `ERASURE_STEPS` (RC-10).
- `apps/api/src/error-messages.ts` — `SOCIAL_ACTION_BLOCKED: 'Действие сейчас недоступно'`.
- `packages/i18n/src/ru.ts` — после `step.tickets`: `'admin.accountErasures.step.social': 'Связи «Свои»'`,
  `'admin.accountErasures.step.product-events': 'События метрик'`. Без подписи не пройдёт typecheck: ключ в
  `AccountErasuresScreen.tsx` шаблонный от `ErasureStep`.
- `.dependency-cruiser.cjs` — два правила (ниже).

**FILES TO READ (образцы)**
- `db/migrations/0038_tickets.ts` — миграция с `*_INDEXES`.
- `rides/ride-erasure.ts`, `tickets/ticket-erasure.ts` — порт стирания: класс в Core-модуле, сводка-счётчики,
  повторяемость.
- `results/results-for-tickets.port.ts` + `results.module.ts:72` — порт `Symbol` + `useExisting`.
- `rides/rider-rides.port.ts` + `rider-rides.ts` — порт `rides` для другого модуля.
- `user-limit.ts` — `consumeUserLimit(rateLimiter, 'social-manual:<uid>', rule, now)`; `RateLimiter` из
  `@rkarakulov/api-kit/core` инжектится как в `rides.service.ts:74`.
- `achievements/achievements.repository.ts` — `isDuplicateKey(error, '<index>')`, `uuidv7()`.
- `profile/rider-names.port.ts` — `publicRiders`.
- `rides/rides.policy.ts` — `ridePhase`, `RIDES_POLICY` (образец `SOCIAL_POLICY`).
- `.claude/rules/pokatim-db.md` — «Документы»: явный `null`, pipeline-update только с `$literal`.

**TYPES & SCHEMAS**

Contracts (`social.schema.ts`, справочники — только в конец):
```ts
export const CONNECTION_SOURCES = ['ride', 'invite', 'manual'] as const;
export const REACTION_KINDS = ['thanks', 'respect'] as const;
export const REACTION_TARGET_TYPES = ['ride_rider', 'race_entry', 'route'] as const;
export const ATTENDANCE_VIA = ['manual', 'track'] as const;
export const RIDE_JOIN_SOURCES = ['ride_card', 'social_home', 'notification', 'profile'] as const;
export const SOCIAL_BLOCK_REASONS = ['self', 'not_participant', 'attendance_window', 'ride_unavailable', 'not_attended'] as const;
// + z.enum(...) и типы; в ответах P2–P7 — tolerantEnum(...)
```

Порт `rides` (`rides-for-social.port.ts`):
```ts
export const RIDES_FOR_SOCIAL = Symbol('RIDES_FOR_SOCIAL');
export interface SocialRideFacts {
  rideId: string;
  /** ridePhase(doc, now) — считает rides; social фазу не вычисляет */
  phase: RidePhase;
  startsAt: Date;
  organizerUserId: string;
  /** «Иду», организатор первым */
  participantIds: string[];
  /** geo при startPrecise (маршрут каталога), иначе null — только ручная явка (K2) */
  preciseStart: LonLat | null;
}
export interface RidesForSocial {
  /** Нет райда — null; скрытый и отменённый отдаются с фазой — решает social. */
  rideFacts(rideId: string, now: Date): Promise<SocialRideFacts | null>;
}
```
Методы P2 и P5 (участники пачкой, райды по окну старта) добавляются в свои PR.

Порт `product-events`:
```ts
export const PRODUCT_EVENTS = Symbol('PRODUCT_EVENTS');
// product-events.types.ts: z.discriminatedUnion('type', [...]) с z.strictObject props
export type ProductEventInput =
  | { type: 'connection-created'; userId: string; props: { source: ConnectionSource } }
  | { type: 'ride-joined'; userId: string; props: { source: RideJoinSource } }
  | { type: 'attendance-marked'; userId: string; props: { via: AttendanceVia } }
  | { type: 'thanks-sent'; userId: string; props: Record<string, never> }
  | { type: 'respect-sent'; userId: string; props: { targetType: 'race_entry' | 'route' } }
  | { type: 'invite-registered'; userId: string; props: Record<string, never> } // userId — пригласивший
  | { type: 'name-published'; userId: string; props: Record<string, never> }
  | { type: 'active-day'; userId: string; props: { day: LocalDate } };
export interface ProductEvents {
  /** Разбор схемой (неизвестный тип или лишнее поле — throw); `at` — CLOCK; с `session` — в транзакции вызывающего. */
  record(event: ProductEventInput, session?: DbSession): Promise<void>;
}
```
`social` пишет события только в своей транзакции. Вызывающий вне транзакции (P2 `join` — одна атомарная операция)
пишет после основной записи и логирует сбой без отказа: `product_events.record_failed type=<t>`.

Коллекции и индексы (`SOCIAL_INDEXES`; `_id` — uuidv7, если не указано иное; nullable — явный `null`):

| Коллекция | Документ | Индексы |
|---|---|---|
| `rider_connections` | `ownerId, otherId, rides: {rideId, at}[]` (общие райды с явкой обоих; `at` — старт райда), `rideCount` (= длина `rides`), `lastRideAt \| null` (max `rides.at`), `inviteAt \| null`, `manualAt \| null`, `removedAt \| null`, `createdAt`, `updatedAt`. Источники не хранятся — `connectionSources(doc)` в политике | `rider_connections_owner_other_unique {ownerId:1, otherId:1}` unique — список владельца, K6, стирание «мои»; `rider_connections_other_idx {otherId:1, ownerId:1}` — стирание «ко мне», аудитория «Свои идут» (P7); `rider_connections_ride_idx {'rides.rideId':1}` — существующие пары райда при пересчёте |
| `ride_attendance` (RC-2a) | `_id` = rideId, `entries: {userId, via, at, declinedAt \| null}[]` (одна запись на userId, явка — `declinedAt: null`), `updatedAt` | `ride_attendance_user_idx {'entries.userId':1}` — стирание, «мои явки» (P5, P7) |
| `social_reactions` | `kind, actorId, targetType, targetId` (для `ride_rider` — rideId), `recipientId`, `createdAt` | `social_reactions_unique {actorId:1, kind:1, targetType:1, targetId:1, recipientId:1}` unique (RC-1); `social_reactions_target_idx {targetType:1, targetId:1, kind:1}` — счётчик `countDocuments`, без денормализации; `social_reactions_recipient_idx {recipientId:1, kind:1, createdAt:-1}` — имена получателю, стирание полученных |
| `invite_codes` | `_id` = userId, `code`, `createdAt` (выдача лениво — P6: upsert по `_id`, дубль `code` — новый код) | `invite_codes_code_unique {code:1}` unique |
| `product_events` | `type, userId, props, at` | `product_events_user_idx {userId:1}` — стирание; `product_events_type_at_idx {type:1, at:1}` — скрипт выгрузки |

Политика (`SOCIAL_POLICY` в `social.policy.ts`): `manualLimit { limit: 30, windowSec: 86_400 }`,
`attendanceWindowMs: 7 * DAY`, `autoAttendance { beforeMs: 30 * MIN, afterMs: 2 * HOUR, radiusM: 500 }`
(использует P5), `askAfterMs: 4 * HOUR` (P7), `manualRenotifyMs: 30 * DAY` (P7), `bulkBatch: 1000`. Чистые функции:
`connectionSources(doc)`, `attendanceCheck(facts, userId, now) → null | SocialBlockReason`,
`rideConnectionDiff(attendees, existingPairs) → { add, remove }`.

Алгоритмы:
- **Ручное добавление:** порядок проверок — `consumeUserLimit` (на каждую попытку, до остальных проверок, против
  перебора профилей) → себя нельзя (`self`) → `RIDER_NAMES.publicRiders` (иначе `NOT_FOUND`) → upsert
  `{ownerId, otherId}`: `manualAt = now`, `removedAt = null`. При дубле уникального индекса — один повтор. Новый
  документ пишет событие `connection-created {source: 'manual'}`.
- **Удаление:** `removedAt = now`, `manualAt = null`; документ остаётся (RC-6).
- **Связь `invite`:** upsert в обе стороны с `inviteAt = now`; `removedAt` не трогается.
- **Явка (`markManual`, `unmark`, `markByTrack`) — одна транзакция `MongoTransactions.run`:**
  1. условная запись в документ `ride_attendance` райда (конфликт сериализует);
  2. чтение явившихся;
  3. `rideConnectionDiff` с существующими парами (`rides.rideId`);
  4. `bulkWrite` пачками по `bulkBatch`: pipeline-upsert с `$literal`, где `rides` — без этого `rideId` плюс новая
     запись, `rideCount = $size`, `lastRideAt = $max` (снятие — то же без добавления);
  5. `deleteMany` по `{removedAt: null, rides: {$size: 0}, inviteAt: null, manualAt: null}` только для затронутых
     пар;
  6. события `attendance-marked` и `connection-created {source: 'ride'}` по созданным документам — в той же
     транзакции.

  Повтор той же операции не меняет состояние и событий не пишет. `removedAt` пересчёт не трогает.
- **Проверки явки:** райда нет → `NOT_FOUND`; не в `participantIds` → `not_participant`; фаза `hidden` или
  `cancelled` → `ride_unavailable`; `upcoming` или `now > startsAt + 7 дн` → `attendance_window` (окно — только для
  ручной). `markByTrack` окна не проверяет и не перекрывает запись с `declinedAt` (RC-3a).
- **`thank(actor, rideId, recipient)`:** себя нельзя (`self`); оба в явке райда (`not_attended`); вставка, при дубле
  — no-op (RC-4); при вставке — событие `thanks-sent`.
- **`toggleRespect`:** себя нельзя (`self`); есть — удалить, нет — вставить (+ событие `respect-sent`). Гонку двух
  нажатий держит уникальный индекс: при дубле — перечитать состояние.

Коды ошибок: `SOCIAL_ACTION_BLOCKED` (409, `details: { reason: SocialBlockReason }`, как у
`DISPUTE_ACTION_BLOCKED`) — через `domainError` из `error-messages.ts`. Остальное — коды базы: `NOT_FOUND` (404),
`RATE_LIMITED` (429, `consumeUserLimit`).

Стирание (`AccountErasureService.run`, после `tickets`, до `notifications`):
1. `step=social` — `SocialErasure.erase(userId)` без транзакции, идемпотентно, порядок:
   - явка: `updateMany({'entries.userId': U}, {$pull: {entries: {userId: U}}})` — первым, чтобы параллельный пересчёт
     других уже не видел U;
   - связи: `deleteMany({ownerId: U})` + `deleteMany({otherId: U})`;
   - реакции: `deleteMany({actorId: U})` + `deleteMany({recipientId: U})` — счётчики считаются на чтении;
   - код приглашения: `deleteOne({_id: U})`.

   Лог: `connections=N attendance=N reactions=N codes=N`. Поздние записи убирает повторный проход (sweep).
2. `step=product-events` — `ProductEventErasure.erase(userId)` → `deleteMany({userId})`, лог `deleted=N`. Это
   единственное исключение из append-only `product_events`.

dependency-cruiser (`.dependency-cruiser.cjs`, `severity: 'error'`):
```js
{ name: 'product-events-leaf',
  comment: 'product-events — листовой модуль (ADR-0027 п. 7): другие модули API не импортирует',
  from: { path: '^apps/api/src/modules/product-events/' },
  to: { path: '^apps/api/src/modules/(?!product-events/)' } },
{ name: 'social-consumers-only',
  comment: 'Производители не знают о social (ADR-0027 п. 1): ссылаются только notifications и account',
  from: { path: '^apps/api/src/modules/', pathNot: '^apps/api/src/modules/(social|notifications|account)/' },
  to: { path: '^apps/api/src/modules/social/' } },
```
Правило `social → rides` только через `index.ts` уже держит `api-module-public-api-only`. Отрицательная проверка —
временный deep import, `pnpm arch:check` должен покраснеть; результат — в §12.

**TESTS**

Unit:
- `social.policy.test.ts` — границы окна (старт −1 мс, старт, +7 дн, +7 дн +1 мс); роли участник и организатор;
  фазы; `rideConnectionDiff` (n явившихся → n(n−1) направленных пар; снятие одного); `connectionSources`.
- `product-events.types.test.ts` — каждый тип K12 проходит; неизвестный тип и лишнее поле в `props` отвергаются.
- `social.schema.test.ts` — состав и порядок справочников; `common.test.ts` — порядок кодов.

Int на реальном MongoDB (`createHarness()`, сервисы — `h.worker.get(...)`):
- `migrations.int.test.ts` — точные индексы пяти коллекций; уникальности: дубль пары связи, дубль реакции, «спасибо»
  разным получателям в одном райде разрешено; повторный `up` ничего не меняет.
- `social-connections` — 30 добавлений, 31-е → `RATE_LIMITED`; себя → `self`; непубличного → `NOT_FOUND`; удалённый
  скрыт, пересчёт его не возвращает, ручное добавление возвращает; `invite` — в обе стороны; непубличный другой есть в
  БД, но скрыт в `listOf`; `togetherOf` (N, последняя дата).
- `social-attendance` — окна, роли, отменённый и скрытый; повтор идемпотентен (нет дублей пар и событий); снятие явки
  пересчитывает `rideCount` и `lastRideAt` у всех пар (3 райдера, 2 райда); `declinedAt` и `markByTrack`.
  **Гонка:** ворота `vi.spyOn(attendanceRepository, …)` останавливают отметку A между записью и чтением, отметка B
  завершается — пара A↔B есть. **Отрицательное доказательство:** запись явки вне документа райда (или без
  транзакции) даёт красный результат (нет пары), не таймаут.
- `social-reactions` — `thanks` только между явившимися; повтор — no-op; `respect` переключается; себе нельзя;
  `Promise.all` двух нажатий оставляет согласованное состояние; `countFor`.
- `product-events.int.test.ts` — `record` пишет; откат транзакции вызывающего — документа нет; стирание удаляет только
  свои события.
- `rides-for-social.int.test.ts` — организатор первым; фазы `hidden`, `cancelled`, `past`; `preciseStart` только при
  `startPrecise`; неизвестный райд → `null`.
- `account-erasure.int.test.ts`:
  - новый `describe('шаги social и product-events')`: данные A в пяти коллекциях стёрты в обе стороны, связь B↔C не
    изменилась, счётчик респектов цели B уменьшился; повтор — нули;
  - список шагов в «логи шагов» += `social`, `product-events`.

e2e — нет (ни эндпоинтов, ни экранов).

Изоляция: свой MongoDB и свой Redis db на агента:
`MONGO_URL_TEST='mongodb://127.0.0.1:27117/pokatim_social_p0_test?replicaSet=rs0&directConnection=true'`,
`REDIS_URL_TEST='redis://127.0.0.1:6479/<N>'`, `TURBO_CONCURRENCY=1 pnpm check`. Файлы int идут по очереди
(`fileParallelism: false`), коллекции модуля каждый файл чистит сам в `beforeEach`. Лимит 30/24 ч в Redis:
`consumeUserLimit` от `h.clock` — ключи по `uid` теста.

**OUT OF SCOPE (P0):** эндпоинты, DTO ответов и экраны; процессоры `social-intake` и `social-maintenance`; события
outbox `tracks.activity-recorded` и `identity.account-confirmed`; `RegisterRequest.invite`; выдача кодов приглашения;
уведомления группы «Свои» (`actors`, `params`, `settings/social`); порты `RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL`,
`ACTIVITY_STARTS`; источник «Иду» в `join`; активный день; скрипт выгрузки `product_events`.

## 12. Outcome

Coder, 2026-10-31 (P0). Не закоммичено.

**Сделано (AC1–AC7):**
- Миграция `0043_social` (`SOCIAL_INDEXES`, пять коллекций, expand-only, идемпотентна); тест в `migrations.int.test.ts`
  (точные индексы, уникальности пары связи и реакции с получателем, повторный `up`).
- `product-events` (листовой): справочник K12 в `product-events.types.ts` (`strictObject`, без id в `props`), порт
  `PRODUCT_EVENTS.record(event, session?)`, `ProductEventErasure`.
- `social`: коллекции, `social.policy.ts` (`SOCIAL_POLICY`, `attendanceCheck`, `rideConnectionDiff`,
  `connectionSources`, `socialBlocked`), репозитории, `SocialConnectionsService` (`addManual`, `remove`, `linkInvite`,
  `listOf`, `togetherOf`), `SocialAttendanceService` (`markManual`, `unmark`, `markByTrack` — одна транзакция с
  пересчётом связей), `SocialReactionsService` (`thank`, `toggleRespect`, `countFor`), `SocialErasure`; модули
  `SocialCoreModule` / `SocialModule` / `SocialWorkerModule` в `app.module.ts` / `worker.module.ts`; очереди
  `social-intake`, `social-maintenance` в `queues.ts` (без регистрации).
- `rides`: порт `RIDES_FOR_SOCIAL` (`rideFacts`), `RidesRepository.findForSocial`.
- `account`: шаги `social` и `product-events` после `tickets`, до `notifications`; `ERASURE_STEPS` и подписи `ru.ts`.
- Contracts: `src/social/social.schema.ts`, `SOCIAL_ACTION_BLOCKED` (+ текст в `error-messages.ts`).
- dependency-cruiser: `product-events-leaf`, `social-consumers-only`.
- Документы: `social.md` (K2 — RC-3, K5 — RC-4, K10 — шестая группа), ADR-0027 пп. 2, 7, 8, `profile.md` (R8, R9, K3),
  `rides.md` (K4, K5), `notifications.md` (N3, N4 — шесть групп, N12 — исключение), `home.md` (K7, K3),
  `docs/product/README.md`, правила `pokatim-backend.md`, `pokatim-db.md`, `pokatim-contracts.md`.

**Проверки:**
- `TURBO_CONCURRENCY=1 pnpm check` (Mongo `pokatim_social_p0_test` на 27117, Redis db 13 на 6479) — зелёный:
  `Tasks: 15 successful, 15 total`; api — `Test Files 224 passed`, `Tests 2450 passed`.
- Отрицательное доказательство гонки явки (RC-2): временно явка «документ на райдера» (`_id = rideId:userId`) —
  тест гонки красный за 222 мс (`expected null to match object { rideCount: 1 }`), не таймаут; откат — зелёный.
- `pnpm arch:check` отрицательно: временный deep import `social → rides/rides.policy` — `api-module-public-api-only`
  красный; `rides → social` и `product-events → social` — `social-consumers-only` и `product-events-leaf` красные;
  откат — `no dependency violations`.
- Первый прогон `pnpm check` поймал недетерминированный тест параллельного «Респекта» (последовательное исполнение
  двух нажатий честно даёт «поставлен → снят»); тест переписан на ворота (оба нажатия проходят «снять» до вставки) —
  проверяет уникальный индекс, 3/3 зелёных.

**Ревью и гейты оркестратора (2026-10-31):**
- Независимое ревью (`independent-reviewer`, pass 1) — **APPROVE**, CRITICAL/HIGH нет; MEDIUM «гонка „Убрать“ ↔
  снятие явки теряет надгробие» исправлен (`remove` — upsert надгробия), тест + отрицательное доказательство
  (`upsert: false` — красный); LOW — `findings.md`.
- Оркестратор: `TURBO_CONCURRENCY=1 pnpm check` (Mongo `pokatim_social_orch_test`, Redis db 12) — `Tasks: 15
  successful, 15 total`, api `2450 passed`, `EXIT=0` (до правки MEDIUM); после правки — `vitest src/modules/social`
  28/28, tsc и eslint чисто; полный `pnpm check` — pre-push.

**Открыто:** `pr.md` — на шаге FINISH.
