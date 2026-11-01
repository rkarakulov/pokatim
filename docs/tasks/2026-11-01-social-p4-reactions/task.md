# «Свои», P4 — реакции: «Спасибо за компанию» и «Респект»

Уровень: task3. Эпик — [`docs/tasks/2026-10-31-social-stage-0/task.md`](../2026-10-31-social-stage-0/task.md)
(строка P4 таблицы §3.2 и правило параллельных PR под ней). Продукт — `docs/product/social.md` K5, K8, K14;
архитектура — ADR-0027 п. 1–3. В develop: P0 (`SocialReactionsService`, `social_reactions`, RC-1, RC-4, RC-5), P1
(уведомления), P2 (участники и явка райда), P3 (профиль, «В свои»), P6 (приглашения). Параллельно идёт P5.

## 1. Title

«Спасибо за компанию» и «Поблагодарить всех» на карточке прошедшего райда; «Респект» на карточке строки результата
гонки и «Респект автору» после «Маршрут пройден»; порты `RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL`.

## 2. Goal

Явившийся на райд благодарит тех, с кем ехал; райдер отмечает чужой результат гонки и райдерский маршрут, который
прошёл. Получатель видит, кто отметил его результат. Уведомления о реакциях — P7 (здесь только точка привязки).

## 3. Scope

1. **«Спасибо за компанию» (K5, RC-4) — API `social`:**
   - `POST /v1/rides/:id/thanks` (`AuthGuard`, `no-store`, 200), тело `{ publicId? }`: с `publicId` — одному
     явившемуся публичному; без — «Поблагодарить всех»: **всем явившимся**, включая непубличных («и ещё N»), кроме
     себя (решение автора 2026-11-01, Q1). Повтор — no-op. Ответ — свежий `RideParticipants` (как у явки P2).
   - Видимость — как в P2: неизвестный райд и скрытый не организатору — `404` до сервиса. Зритель без явки, получатель
     без явки, себе — `409 SOCIAL_ACTION_BLOCKED` (причины P0). Неизвестный/непубличный `publicId` — `404`.
   - Лимит частоты на пользователя (`consumeUserLimit`, отдельный ключ) — первой проверкой.
   - `RideParticipants`: в строках «Ехали N» — `thanked` (зритель уже сказал спасибо), в `attendance` — `allThanked`
     (зритель поблагодарил всех явившихся, кроме себя; скрытых тоже). Поля — с `.default(false)` (старые сборки).
2. **«Респект» (K8) — порты производителей и API `social`:**
   - `RESULTS_FOR_SOCIAL` (модуль `results`): `entryId` → `{ ownerUserId, raceId, … } | null`. Цель есть, только если
     строка видна в публичной таблице результатов гонки — **и до, и после публикации протокола** (решение автора
     2026-11-01, Q3): гонка не черновик, заявка активна, есть результат, нет DQ (после публикации — строка текущей
     ревизии). Снятые, DQ, финишёры без места — `null`.
   - `ROUTES_FOR_SOCIAL` (модуль `routes`): `routeId` → `{ authorUserId, … } | null`. Только `origin: rider` и
     маршрут в каталоге (`IN_CATALOG`); маршрут команды, скрытый, не прошедший модерацию — `null`.
   - Эндпоинты зрителя (`AuthGuard`, `no-store`; пути — за architect, прецедент ADR п. 3 — префикс чужого ресурса):
     состояние и установка респекта строки результата и маршрута. Состояние: `available` (цель есть и зритель — не
     получатель), `respected`, `count` (все), `own` (зритель — получатель) и `from` — **только получателю**:
     публичные поставившие строками + «и ещё N» (форма `RideRiderGroup`, K3). Установка — идемпотентный `PUT
     { respected }` (повтор не переключает обратно; по образцу `PUT …/social/connection` P3) поверх P0
     `toggleRespect`/`exists` или нового метода `setRespect` в `SocialReactionsService` (не дублировать логику).
     Получатель выводится сервером из цели, от клиента не принимается. Нет цели — `404`, себе — `409 self`.
   - Лимит частоты на пользователя.
3. **Контракты, api-client** — схемы ответа респекта и тела `thanks`, поля `thanked`/`allThanked`; методы клиента.
   Добавления — в конец (`contracts/src/index.ts`, `api-client/src/index.ts`, `i18n/src/ru.ts`).
4. **Приложение (`apps/app`):**
   - Карточка прошедшего райда, «Ехали N» (P2 `RideParticipantsBlock` / `RideRiderList`): у каждой публичной строки,
     кроме себя, — «Спасибо за компанию» / «Вы сказали спасибо» (без отмены); над списком — «Поблагодарить всех»,
     пока `allThanked = false`, затем «Вы поблагодарили всех». Ответ мутации — в кэш участников (как явка). Ошибки —
     баннер под блоком (тексты причин).
   - Карточка строки результата гонки (`races/disputes/rival-card.tsx`, маршрут `/races/result/[id]/[entryId]`):
     открывать **любому вошедшему** (решение автора 2026-11-01, Q2; сейчас — только участникам, `canOpenRival`);
     «Оспорить результат» остаётся только участникам — как сейчас. Над «Оспорить» — «Респект» / «Респект · N»
     (переключение) и «В свои» (переиспользовать `ConnectButton`/`useSetRiderConnection` P3; только при
     `riderPublicId`). Своя строка — «респект N» и имена поставивших (Q4), без кнопки. Гость — как сейчас.
   - Экран заезда по маршруту (`route-rides/route-ride-detail.tsx`) при вердикте «Маршрут пройден»: строка
     «Респект автору» (по `available`; свой маршрут `?mine=1` и маршрут команды — нет). Имена поставивших автору —
     только в уведомлении P7 (Q4).
   - i18n — в конец `ru.ts`. Число респектов — только в карточке, не в таблице (K14).
5. **Точка привязки P7 (без правок `notification-intake.ts`, `notification-texts.ts`, `notifications.policy.ts`):**
   `thank` и установка респекта сообщают «новая реакция» (уже `boolean`) и пишут в транзакции вставки; P7 добавит
   outbox `social.*` туда же. Записка — в §12 и заметка в общей папке сессий.
6. **Документы:** `social.md` (K5, K8 — решения Q1–Q4), `rides.md` («После райда»), `routes.md` (route-rides —
   «Респект автору»), документ результатов гонки/споров, где описана карточка соперника; ADR-0027 п. 1 и 3
   (порты и эндпоинты P4); правила `.claude/rules/pokatim-*.md` при новых портах и эндпоинтах; строка P4 в эпике.

## 4. Out of Scope

Уведомления «Спасибо за компанию» и «Респект» (P7), любые правки `notifications/*` intake/текстов/политики; секция
«Свои» на Главной (P7); автоявка (P5); респект в таблице (счётчики под строками — K14), в шите финишёров, в
«Моих маршрутах» и в карточке маршрута каталога; отмена «спасибо»; миграции (коллекция и индексы — в P0, `0045`).

## 5. Architecture Context

- `social` — потребитель: читает `results` и `routes` только через новые порты (`*_FOR_SOCIAL` по образцу
  `RESULTS_FOR_TICKETS`, `ROUTES_FOR_SHARING`) из `index.ts`; производители о `social` не знают, цикла нет
  (`results`/`routes` не импортируют `social`). `SocialModule` (HTTP) импортирует `ResultsCoreModule`, `RoutesCoreModule`
  (architect, RC-P4-12: порты нужны только HTTP-сервису респекта; ядро и worker не меняются).
- Публичные `GET races/:raceId/results`, `GET routes/:id`, `GET route-rides…` не меняются (кэш `max-age=60`,
  данные зрителя туда нельзя); `userId`/`ownerUserId` наружу не уходят.
- Контракты — совместимые добавления (`.default`, `tolerantEnum`), старые сборки игнорируют новые поля.
- Миграций, очередей, outbox-событий нет.

## 5.1 Placement & Reuse Gate

- Переиспользуем: `SocialReactionsService` (P0 `thank`, `toggleRespect`, `countFor`, `insert`), `ReactionsRepository`
  (добавить чтение актёров цели), `SocialRideParticipantsService.view`/`visibleFacts` и `rideParticipantsView` (P2),
  `RIDER_PROFILES.findPublic` (publicId → райдер, как P3), `RIDER_NAMES.publicRiders`, `consumeUserLimit`,
  `domainError`, `socialBlocked`; в app — `ConnectButton`, `useSetRiderConnection`, `socialActionErrorText` (P3),
  `RideRiderList`, паттерн мутаций `participants-queries.ts`.
- Запрещено: второй писатель `social_reactions`, своя проверка явки в обход P0, прямое чтение `race_entries`/`routes`
  из `social`, копия логики видимости строки протокола вне `results`, копия `IN_CATALOG` вне `routes`.
- Контроллеры тонкие, логика — в сервисах `social`.
- architect: видимость строки — `ResultsReadService.publicRow` на предикатах `publicTableMode` / `isPublicProtocolRow`
  (`results.policy.ts`), общих с `publicResults` (RC-P4-1); строка «Ехали» — `RideAttendedRow` с `self`/`thanked`
  (RC-P4-7); `riderGroup` из `ride-participants.view.ts` экспортируется для `from` респекта; `ConnectButton` P3
  экспортируется (RC-P4-13).

## 6. Relevant Files

- `apps/api/src/modules/social/reactions.service.ts`, `reactions.repository.ts` — ядро реакций P0.
- `apps/api/src/modules/social/ride-participants.{service,view,controller}.ts` — P2, расширяется «спасибо».
- `apps/api/src/modules/social/rider-social.controller.ts` — образец viewer-эндпоинтов и `PUT` P3.
- `apps/api/src/modules/results/results-for-tickets.port.ts`, `results-read.service.ts` (видимость строк),
  `results.repository.ts`, `results.module.ts`, `index.ts` — порт `RESULTS_FOR_SOCIAL`.
- `apps/api/src/modules/routes/routes-for-sharing.port.ts`, `routes.repository.ts` (`IN_CATALOG`), `routes.module.ts`,
  `index.ts` — порт `ROUTES_FOR_SOCIAL`.
- `packages/contracts/src/social/ride-participants.schema.ts`, новые схемы респекта.
- `apps/app/src/features/rides/{ride-participants-block,ride-rider-list,participants-queries}.tsx|ts`.
- `apps/app/src/features/races/disputes/rival-card.tsx`, `dispute-format.ts` (`canOpenRival`),
  `apps/app/src/features/races/race-detail.tsx`.
- `apps/app/src/features/route-rides/route-ride-detail.tsx`; `apps/app/src/features/social/{queries.ts,rider-social-block.tsx}`.

## 7. Implementation Notes

- Видимость строки результата должна совпадать с тем, что отдаёт `publicResults` (до/после публикации) — порт
  реализуется в `results` поверх его же репозитория/правил, без копии в `social`.
- «Поблагодарить всех» — по списку явившихся P0 (`attendance.attendees`), непубличные включены; результат — сколько
  новых. Частичный сбой посреди «всех» — допустим повтор (идемпотентно).
- `allThanked` при единственном явившемся (только зритель) — `true` и кнопки «всех» нет.
- Респект зрителя-получателя: `available = false`, `own = true`, `from` — группа поставивших.
- Карточка строки: сейчас строка ищется в кэше таблицы (`findRow`) — для не-участника таблица та же публичная.
- architect: «Оспорить» не-участнику после публикации всплыло бы выключенным (`protocol_published` раньше
  `not_entered` в `fileBlock`) — `RivalAction` только при своей заявке (RC-P4-10); своя строка открывается без
  `canShareStory` (RC-P4-11).

## 8. Risks / Assumptions / Open Questions

Решения автора 2026-11-01:
- **Q1** «Поблагодарить всех» — всем явившимся, включая непубличных.
- **Q2** Карточку строки результата и «Респект» — любому вошедшему; «Оспорить» — только участникам.
- **Q3** Респект — любой видимой строке таблицы с результатом, до и после публикации протокола; снятые, DQ,
  финишёры — нет.
- **Q4** Имена поставивших респект — получателю в карточке своей строки результата; автору маршрута — в уведомлении P7.

`[ASSUMPTION]` Респект, поставленный строке, которая потом стала DQ / снята, остаётся в БД; счётчик на чтении не
показывается, т. к. цели нет (`available = false`, `count` — не показываем). Уточнит architect.

## 8.1 Requirements Consistency (заполняет architect)

**Статус: READY** — блокеров нет (architect, 2026-11-01, сверка с `c05641c3`). Решения Q1–Q4 окончательны; ниже —
уточнения спека, которые coder реализует как написано (рекомендация = решение, если человек не скажет иначе).

- **RC-P4-1. Видимость строки результата — одна точка в `results`, без копии.** Проверено кодом: `entryId` строки
  публичной таблицы — `race_entries._id` в обоих режимах (до публикации — `row._id` из `rankedPage`
  (`results-read.service.ts`), после — `RaceProtocolRowDoc.entryId`, ссылка на заявку). Правило таблицы: гонка из
  `RACE_REGISTRY.get` (черновик/неизвестная — `null`); `cancelled` или `corridor === null` — таблица пуста; до
  публикации — `rankedFilter(raceId, entry.groupKey)` (активная, Verified, `best.ranked`, `disqualified: null` —
  финишёры и DQ отпадают сами); после — строка текущей ревизии (`currentRevision ?? 1`) со `status !== 'dq'` и
  `place !== null` (так фильтрует `protocolResults`). **Решение:** (1) в `results.policy.ts` — чистые
  `publicTableMode(race) → 'empty' | 'provisional' | 'protocol'` и `isPublicProtocolRow(row)`; `publicResults` и
  `protocolResults` переводятся на них (рефакторинг без смены поведения); (2) `ResultsReadService.publicRow(entryId)` —
  рядом с `publicResults`, на тех же `rankedPosition` / `protocolRow` / приватном `protocolRevision` в одной
  snapshot-сессии; (3) порт — тонкий адаптер. Альтернативы: (b) логика в `ResultsForSocialService` прямо на
  репозитории — дублирует ветвление `publicResults`; (c) прочитать страницу `publicResults` и искать строку — дорого и
  ломается на пагинации. Рекомендация — (a).
- **RC-P4-2. Путь и форма эндпоинтов респекта.** `GET|PUT /v1/races/:raceId/results/:entryId/respect` и
  `GET|PUT /v1/routes/:id/respect` (`social`, префикс чужого ресурса, ADR п. 3; с публичными `races/:raceId/results`,
  `routes/:id`, `routes/:id/me` и `routes/:routeId/rides` не пересекаются — новый статический сегмент). `raceId` в
  пути обязан совпасть с `target.raceId` порта, иначе `404` (ссылка на чужую гонку). Альтернатива — `race-entries/:id/respect`
  (короче, но новый корень и без гонки в адресе карточки) — не рекомендуется.
- **RC-P4-3. `GET` респекта без цели — `200` нейтральное, `PUT` — `404`.** Чтобы карточка и экран заезда не
  обрабатывали ошибку там, где кнопки просто нет: `GET` при `null` порта (снятая, DQ, финишёр, черновик, маршрут
  команды/скрытый/на модерации) → `{ available: false, respected: false, count: 0, own: false, from: null }` —
  существующие респекты такой цели не видны (подтверждает `[ASSUMPTION]` §8: записи остаются в БД, после отмены DQ снова
  видны). `PUT` без цели — `404` (снять респект с исчезнувшей цели нельзя — принятый риск, она невидима). Альтернатива
  (b) `GET → 404` — клиенту нужна ветка «404 = нет блока» в двух местах. Рекомендация — (a).
- **RC-P4-4. `PUT { respected }` поверх P0 без дубля.** Новый `SocialReactionsService.setRespect(actorId, target,
  respected) → boolean` (изменилось ли): себе — `409 self`; `true` — общий приватный `insert` (дубль
  `social_reactions_unique` → `false`, состояние «поставлен» — RC-1); `false` — `reactions.delete(key)`. Гонка двух
  `PUT true` — одна вставка, второй — дубль; `PUT true` ‖ `PUT false` — последний выигрывает (оба исхода согласованы,
  ответ — свежее чтение). `toggleRespect` остаётся как есть (P0-тесты, `account-erasure.int.test.ts`) — HTTP его не
  вызывает. Повтор «снял → поставил» пишет `respect-sent` ещё раз (как у P0 toggle) — метрика считает нажатия; лимит
  держит частоту. Альтернатива — переписать `toggleRespect` через `setRespect` — лишняя правка P0, не нужно.
- **RC-P4-5. Свой маршрут, маршрут команды и «прошёл ли зритель».** `ROUTES_FOR_SOCIAL.respectTarget` =
  `RoutesRepository.findInCatalog` (`ready` + `IN_CATALOG`) и `origin === 'rider'` → `{ routeId, authorUserId:
  ownerUserId }`; остальное — `null`. Сервер **не** проверяет, что зритель прошёл маршрут: «Респект автору» показывается
  только после «Маршрут пройден», но число нигде не видно (только уведомление P7 автору), злоупотребление ограничено
  лимитом и «одна на райдера». Альтернатива (b) — порт `route-rides` «есть пройденный заезд» (`social → route-rides`,
  новое ребро и запрос) — не рекомендуется в этапе 0.
- **RC-P4-6. `available` для «Респект автору» без правки публичных ответов.** Экран заезда при `status === 'passed'` и
  `!mine` запрашивает `GET routes/:id/respect`; строка — только при `available` (свой маршрут — `own: true`, команды —
  нейтральный ответ RC-P4-3). `RouteRideDetail`, `GET routes/:id` не меняются; при `?mine=1` запроса нет.
- **RC-P4-7. Своя строка в «Ехали N» — нужен флаг `self`.** Строки `RideRiderRow` не знают зрителя; публичный зритель
  есть в «Ехали N», и кнопка «Спасибо» на себе дала бы `409 self`. **Решение:** отдельная строка «Ехали» —
  `RideAttendedRow = RideRiderRow.extend({ self, thanked })` (оба `.default(false)`), `RideAttendance.attended:
  RideAttendedGroup`; список участников `riders` и `from` респекта остаются `RideRiderRow` (без лишних полей).
  Альтернатива (b) — `thanked` прямо в `RideRiderRow` + сравнение `publicId` с профилем на клиенте — лишний запрос и
  поле в списке «Иду» без смысла. Рекомендация — (a).
- **RC-P4-8. Множества «Поблагодарить всех» и `allThanked`.** «Всех» — по P0 `attendance.attendees(rideId)` минус
  актёр (непубличные включены, Q1); `allThanked` — по множеству строки «Ехали N» (`participantIds ∩ явка`, как
  `rideParticipantsView`) минус зритель, пусто → `true`. Первое ⊇ второго, поэтому после «всех» `allThanked = true`
  всегда. Реализация — `SocialReactionsService.thankAll(actorId, rideId) → number` (новых): одно чтение явки, актёр не
  явился → `409 not_attended`; уже поблагодарённые (`ReactionsRepository.recipientsOf`) пропускаются; остальным —
  по одной вставке через тот же `insert` (≤ `RIDE_LIMIT.max` = 100 транзакций; частичный сбой — повтор
  идемпотентен). Не `insertMany`: дубль в транзакции оборвал бы всю пачку, а точка P7 — на каждую реакцию.
- **RC-P4-9. Окно «спасибо».** P0 `thank` проверяет только явку обоих, не окно 7 дней и не фазу (скрытый — `404` до
  сервиса). Принимается: «Ехали N» после окна остаётся с кнопками (K5 окно задаёт только явке). Отменённый райд явки
  не имеет — «спасибо» там невозможно само.
- **RC-P4-10. «Оспорить» не-участнику после публикации (найдено в коде).** `fileBlock` возвращает
  `protocol_published` раньше `not_entered`, `filingStatus` → `closed`, и `rivalAction` даёт выключенное «Оспорить» с
  причиной **любому** зрителю. Сейчас это скрыто гейтом `canOpenRival`, после Q2 — всплывёт. **Решение (app):**
  `RivalAction` рендерится только при своей заявке (`own?.entry != null` в уже существующем `AsyncContent` участия);
  `canOpenRival` удаляется (и его тест), `rowAction` строки — `signedIn ? push : null`. API споров не меняется.
- **RC-P4-11. Своя строка открывается всегда вошедшему с заявкой (Q4).** Сейчас `ownRowAction` — только при
  `actions.canShareStory`; иначе получатель не увидит «респект N» и имена. **Решение:** `ownRowAction = signedIn &&
  entry.data?.entry ? push : null`; в карточке своей строки — блок полученных респектов (`own`) и, как раньше,
  «Поделиться в сторис» по `canShareStory`.
- **RC-P4-12. Где подключить порты.** §5 говорит `SocialCoreModule`. Порты нужны только HTTP-сервису респекта, а
  `SocialCoreModule` импортируют `SocialWorkerModule` и `account` (worker). **Решение:** `ResultsCoreModule` и
  `RoutesCoreModule` — в imports `SocialModule` (HTTP), `SocialRespectService` — его провайдер (как
  `RiderSocialService`). P7 (Главная) перенесёт в ядро, если понадобится. §5 поправлен.
- **RC-P4-13. «В свои» на карточке строки.** `ConnectButton` P3 — приватная функция `rider-social-block.tsx` и
  нуждается в `connected`. **Решение:** экспортировать `ConnectButton` (без изменения поведения); карточка при
  `riderPublicId !== null` и не своей строке читает `useRiderSocial(publicId)` (P3 `GET riders/:publicId/social`) и
  рисует кнопку по `connected` (`self` — нет кнопки). Отдельного поля в ответе респекта не добавляем — у связей один
  источник правды.
- **RC-P4-14. Точка P7.** Все новые реакции проходят через приватный `SocialReactionsService.insert` (транзакция
  «вставка + `product_events`»): `thank`, `thankAll` (по реакции), `setRespect(true)`. P7 добавит запись outbox
  `social.*` внутрь этой же `transactions.run` по `ReactionKey` (`kind`, `actorId`, `recipientId`, `targetType`,
  `targetId`); названия гонки/маршрута P7 берёт портами при приёме. `notification-*` и `notifications.policy.ts` не
  трогаются; записка — в §12.
- **RC-P4-15. arch:check.** Новые рёбра `social → results`, `social → routes` — только через `index.ts`
  (`api-module-public-api-only`); `results`/`routes` → `social` запрещает `social-consumers-only`; цикла нет
  (транзитивно `results → identity, panel, profile, races, routes, tracks`, `routes → identity, panel, profile` —
  никто не ведёт в `social`). Новых правил dependency-cruiser не нужно.

## 8.2 Deviations from spec

Coder (2026-11-01), мелкие, без смены поведения спека:
- Тест «строка нажимаема вошедшему не-участнику, гостю — нет» — в `src/__tests__/rival-card.test.tsx` (через экран
  гонки), а не в `race-detail.test.tsx`.
- Ошибка «Респекта» у кнопки: лимит — `socialActionErrorText` (P3), прочее — новый `social.respect.error.unknown`
  (ключ из §11 i18n), а не общий `social.error.unknown`.
- `SocialReactionsService.thank` переведён на общие с `thankAll` `thanksKey`/`thanksEvent` (тот же ключ и событие,
  поведение и P0-тесты не изменились).
- `rideParticipantsView(…, thanked = new Set())` — параметр необязательный (вызовы P2-тестов без изменений).
- Существующие тесты обновлены под новое поведение спека, не ослаблены: P2 int (`ride-participants.int.test.ts`) —
  новые поля по умолчанию в точных сравнениях; app (`race-disputes`, `race-groups`, `race-results`, `story-card`) —
  строки вошедшему нажимаемы (Q2), своя — при заявке (RC-P4-11); `canOpenRival` и его кейсы удалены (RC-P4-10);
  `route-ride`, `route-ride-map` — мок нейтрального `getRouteRespect`.

## 8.3 Security checklist

AuthN — `AuthGuard` на всех новых эндпоинтах. AuthZ — получатель и цель выводятся сервером; явка — P0; видимость
райда — P2. Данные наружу — без `userId`; имена поставивших — только получателю, только публичные (K3). Злоупотребления
— лимиты частоты, уникальный индекс P0. Логи — без имён и e-mail.

## 9. Acceptance Criteria

1. Явившийся благодарит одного явившегося публичного; повтор — no-op; ответ — строка `thanked = true`.
2. «Поблагодарить всех» создаёт «спасибо» всем явившимся, включая непубличных, кроме себя; повтор — ничего;
   `allThanked = true`.
3. Без явки (зритель или получатель), себе — `409`; неизвестный/непубличный `publicId` — `404`; скрытый райд
   не организатору — `404`.
4. Респект строке результата: видимая строка (до и после публикации) — ставится и снимается `PUT`, повтор не
   переключает; снятая/DQ/финишёр/черновик гонки — `PUT 404`, `GET` — нейтральное состояние (RC-P4-3); своя строка — `409 self`; `count` — всем, `from` — только
   получателю, непубличные — числом.
5. Респект маршруту: райдерский в каталоге — да; команды, скрытый, на модерации — `PUT 404` (`GET` нейтральный); свой —
   `409`.
6. Публичные кэшируемые ответы не изменились; `userId` наружу не уходит.
7. App: «Спасибо за компанию» / «Вы сказали спасибо» и «Поблагодарить всех» / «Вы поблагодарили всех» в «Ехали N»;
   карточка строки открывается любому вошедшему, «Оспорить» — только участникам; «Респект» и «В свои» над «Оспорить»;
   своя строка — число и имена; «Респект автору» после «Маршрут пройден» (не на своём маршруте и не у маршрута команды).
8. `pnpm arch:check` — без нарушений; `social` не читает чужие коллекции; файлы `notification-intake.ts`,
   `notification-texts.ts`, `notifications.policy.ts` не изменены.
9. Тесты: int (api) на оба порта и эндпоинты, unit view, contracts, api-client, jest app.

## 10. Documentation Impact

См. §3 п. 6; точный перечень — §11 «Documentation Impact» (architect).

## 11. Implementation Context (заполняет architect)

Architecture Review — social-p4-reactions. **Status: APPROVED (READY)**, решения — §8.1 RC-P4-1…15. Security: зона
`security.md` (конфиг, CI, секреты) не затронута — чек-лист §8.3 (AuthN/AuthZ/данные/лимиты) обязателен как AC.
Миграций, очередей, outbox — нет (индексы P0 `0045_social`: `social_reactions_unique` — префикс `{actorId, kind,
targetType, targetId}` для `recipientsOf` и `exists`; `social_reactions_target_idx` — `count` и `actorsOf`).

**ENTRY POINTS**
- API: `RideParticipantsController` (`rides`) — новый `POST :id/thanks`; новый `SocialRespectController`
  (`@Controller()` без префикса, `AuthGuard`, `no-store`) — `GET|PUT races/:raceId/results/:entryId/respect`,
  `GET|PUT routes/:id/respect`.
- Порты производителей: `RESULTS_FOR_SOCIAL` (`results/index.ts`), `ROUTES_FOR_SOCIAL` (`routes/index.ts`).
- App: `features/rides/ride-participants-block.tsx` («Ехали N»), `features/races/disputes/rival-card.tsx`
  (`/races/result/[id]/[entryId]`), `features/races/race-detail.tsx` (открытие строки),
  `features/route-rides/route-ride-detail.tsx` («Респект автору»).

**Эндпоинты** (все — `AuthGuard`, `Cache-Control: no-store`, `@HttpCode(200)` у мутаций, пути — `idPipe` `Uuid`):

| Метод и путь | Тело | Ответ | Порядок проверок |
|---|---|---|---|
| `POST /v1/rides/:id/thanks` | `RideThanksRequest.optional()` (`{ publicId? }`, strict; лишнее — 400) | `RideParticipants` (свежий `view`) | лимит `social-thanks:<uid>` → `visibleFacts` (404) → `publicId`: `RIDER_PROFILES.findPublic` (нет/непубличный — 404) → `thank` (409 `self` / `not_attended`); без `publicId` — `thankAll` (409 `not_attended`) → лог → `view` |
| `GET /v1/races/:raceId/results/:entryId/respect` | — | `RespectState` | `RESULTS_FOR_SOCIAL.respectTarget(entryId)`; `null` или `raceId ≠ target.raceId` — нейтральный `RespectState` (RC-P4-3) |
| `PUT /v1/races/:raceId/results/:entryId/respect` | `SetRespectRequest` (`{ respected }`, strict) | `RespectState` | лимит `social-respect:<uid>` → цель (нет/чужая гонка — 404) → `setRespect` (409 `self`) → лог → свежий state |
| `GET /v1/routes/:id/respect` | — | `RespectState` | `ROUTES_FOR_SOCIAL.respectTarget(id)`; `null` — нейтральный |
| `PUT /v1/routes/:id/respect` | `SetRespectRequest` | `RespectState` | лимит `social-respect:<uid>` → цель (404) → `setRespect` (409 `self`) → state |

Лимиты — `SOCIAL_POLICY` (на каждую попытку, первыми): `thanksLimit: { limit: 60, windowSec: 3600 }` (одно «всех» =
одна попытка), `respectLimit: { limit: 60, windowSec: 3600 }` (общий ключ на race_entry и route). `GET` без лимита
(как P2/P3 чтения). Логи: `social.thanks ride=<id> uid=<uid> added=<n>`, `social.respect target=<type>:<id> uid=<uid>
respected=<bool> changed=<bool>` — без имён, `publicId` и e-mail.

**Порты** (образец `results-for-tickets.port.ts`, `routes-for-sharing.port.ts`):

```ts
// apps/api/src/modules/results/results-for-social.port.ts
export const RESULTS_FOR_SOCIAL = Symbol('RESULTS_FOR_SOCIAL');
/** Строка публичной таблицы гонки — цель «Респекта» (K8). Без имён; `ownerUserId` наружу не выходит. */
export interface RaceEntryRespectTarget { entryId: string; raceId: string; ownerUserId: string; }
export interface ResultsForSocial {
  /** Видна в публичной таблице сейчас (до публикации — живые места, после — текущая ревизия, RC-P4-1); иначе `null`. */
  respectTarget(entryId: string): Promise<RaceEntryRespectTarget | null>;
}

// apps/api/src/modules/routes/routes-for-social.port.ts
export const ROUTES_FOR_SOCIAL = Symbol('ROUTES_FOR_SOCIAL');
export interface RouteRespectTarget { routeId: string; authorUserId: string; }
export interface RoutesForSocial {
  /** Готовый маршрут райдера (`origin: 'rider'`) в каталоге (`IN_CATALOG`); команды, заявка, скрытый — `null`. */
  respectTarget(routeId: string): Promise<RouteRespectTarget | null>;
}
```

`ResultsReadService.publicRow(entryId): Promise<{ entryId; raceId; userId } | null>`: `findEntryById` → нет — `null`;
`races.get(entry.raceId)` → `null` — `null`; `publicTableMode(race)`: `empty` — `null`; `provisional` —
`rankedPosition(race.id, entry.groupKey, entryId)` ≠ `null` → `entry.userId`; `protocol` — в `withSnapshot`:
`protocolRevision` → `protocolRow(race.id, revision, entryId)` и `isPublicProtocolRow(row)` → `row.userId`.

**FILES TO CREATE**
- `apps/api/src/modules/results/results-for-social.port.ts`, `results-for-social.ts` (`ResultsForSocialService`
  делегирует `ResultsReadService.publicRow`).
- `apps/api/src/modules/routes/routes-for-social.port.ts`, `routes-for-social.ts` (`RoutesForSocialService`:
  `findInCatalog` + `origin === 'rider'`).
- `apps/api/src/modules/social/respect.service.ts` — `SocialRespectService` (`SocialModule`): `raceEntryState(viewerId,
  raceId, entryId)`, `setRaceEntry(viewerId, raceId, entryId, respected)`, `routeState(viewerId, routeId)`,
  `setRoute(viewerId, routeId, respected)`; общий приватный `stateOf(viewerId, target | null)`.
- `apps/api/src/modules/social/respect.view.ts` — чистая `respectStateView({ target, viewerId, count, respected,
  actorIds, cards })`: `own = viewerId === recipientId`, `available = target !== null && !own`, `from` — только при
  `own` (`riderGroup(actorIds, cards)`, `hiddenCount = count − riders.length`), иначе `null`; нет цели —
  `NEUTRAL_RESPECT`.
- `apps/api/src/modules/social/respect.controller.ts` — `SocialRespectController`.
- `packages/contracts/src/social/reactions.schema.ts` (+ `reactions.schema.test.ts`).
- `apps/app/src/features/social/respect-queries.ts` — ключи `['social','respect','race_entry',raceId,entryId]`,
  `['social','respect','route',routeId]`; `useRaceEntryRespect(raceId, entryId, enabled)`,
  `useSetRaceEntryRespect(...)`, `useRouteRespect(routeId, enabled)`, `useSetRouteRespect(routeId)` — ответ PUT в кэш
  (`setQueryData`), 404 — `invalidateQueries`.
- `apps/app/src/features/social/respect-block.tsx` — `RespectButton` («Респект» / «Респект · N», `variant` по
  `respected`, `loading` мутации, ошибка — `Banner` с `socialActionErrorText`), `RespectReceived` (своя строка:
  «респект N» + `RideRiderList group={from}`; `count = 0` — ничего), `RouteAuthorRespect` (строка «Респект автору» по
  `available`). Состояния — `AsyncContent` + однострочный `SkeletonText`; 404/нейтральный — ничего (как
  `RiderSocialBlock`).

**FILES TO MODIFY** (в общих файлах — только добавления в конец)
- `apps/api/src/modules/results/results.policy.ts` — `publicTableMode`, `isPublicProtocolRow` (+ `results.policy.test.ts`).
- `apps/api/src/modules/results/results-read.service.ts` — `publicResults`/`protocolResults` на новых предикатах,
  метод `publicRow`.
- `apps/api/src/modules/results/results.module.ts` — `ResultsForSocialService` + `{ provide: RESULTS_FOR_SOCIAL,
  useExisting }`, export `RESULTS_FOR_SOCIAL`; комментарий модуля — потребитель `social`.
- `apps/api/src/modules/results/index.ts`, `apps/api/src/modules/routes/index.ts` — экспорт портов (в конец).
- `apps/api/src/modules/routes/routes.module.ts` — `RoutesForSocialService`, `ROUTES_FOR_SOCIAL` в `RoutesCoreModule`.
- `apps/api/src/modules/social/reactions.repository.ts` — `recipientsOf(actorId, kind, targetType, targetId):
  Promise<Set<string>>` (projection `recipientId`), `actorsOf(targetType, targetId, kind, limit): Promise<string[]>`
  (новые сверху, `limit = SOCIAL_POLICY.respectFromMax` = 100). Писатель остаётся один.
- `apps/api/src/modules/social/reactions.service.ts` — `thankAll(actorId, rideId): Promise<number>`, `setRespect(actorId,
  target, respected): Promise<boolean>`, `respectedBy(actorId, target): Promise<boolean>` (`exists`), `thankedBy(actorId,
  rideId): Promise<Set<string>>`, `respectActors(target, limit)`; `thank`, `toggleRespect`, `countFor`, `insert` —
  без изменений (RC-P4-4, RC-P4-14).
- `apps/api/src/modules/social/ride-participants.service.ts` — `thank(viewerId, rideId, publicId?)`; `view` читает
  `thankedBy` только при явке зрителя; инъекции `SocialReactionsService`, `RIDER_PROFILES`.
- `apps/api/src/modules/social/ride-participants.view.ts` — `export riderGroup`; `rideParticipantsView(..., thanked:
  ReadonlySet<string>)`: строки «Ехали» — `self`, `thanked`; `allThanked` (RC-P4-8).
- `apps/api/src/modules/social/ride-participants.controller.ts` — `POST :id/thanks`.
- `apps/api/src/modules/social/social.policy.ts` — `thanksLimit`, `respectLimit`, `respectFromMax`.
- `apps/api/src/modules/social/social.module.ts` — `SocialModule.imports += ResultsCoreModule, RoutesCoreModule`,
  `controllers += SocialRespectController`, `providers += SocialRespectService` (RC-P4-12); комментарии модулей.
- `packages/contracts/src/social/ride-participants.schema.ts` — `RideAttendedRow`, `RideAttendedGroup`,
  `RideAttendance.attended: RideAttendedGroup`, `allThanked: z.boolean().default(false)`.
- `packages/contracts/src/index.ts` — экспорт `reactions.schema.ts` (в конец).
- `packages/api-client/src/index.ts` — в конец: `thankRideRiders(token, id, publicId?)` (тело `publicId ? { publicId } :
  {}`), `getRaceEntryRespect(token, raceId, entryId)`, `setRaceEntryRespect(token, raceId, entryId, body)`,
  `getRouteRespect(token, routeId)`, `setRouteRespect(token, routeId, body)`.
- `packages/i18n/src/ru.ts` — в конец: `rides.thanks.{one,done,all,allDone,error.not_attended,error.unknown}`
  («Спасибо за компанию», «Вы сказали спасибо», «Поблагодарить всех», «Вы поблагодарили всех»),
  `social.respect.{action,withCount,received,author,error.unknown}` («Респект», «Респект · {{count}}», «респект N» —
  plural-объект, «Респект автору»).
- `apps/app/src/features/rides/participants-queries.ts` — `useRideThanks(id)` (`variables` — `publicId | null`, ответ в
  кэш участников, 409/404 — перечитать), `thanksErrorText(error)` (сеть, лимит, 404, `not_attended`/`self`).
- `apps/app/src/features/rides/ride-rider-list.tsx` — generic `RideRiderList<Row extends RideRiderRow>` с необязательным
  `trailing?: (row: Row) => ReactNode` в строке (раскладка строки не меняется без `trailing`).
- `apps/app/src/features/rides/ride-participants-block.tsx` — в «Ехали N»: над списком «Поблагодарить всех» (нет
  других — ни кнопки, ни текста; `allThanked` — текст «Вы поблагодарили всех»), у строки `!self && publicId` —
  кнопка / «Вы сказали спасибо»; баннер ошибки под блоком.
- `apps/app/src/features/social/rider-social-block.tsx` — `export function ConnectButton` (RC-P4-13).
- `apps/app/src/features/races/disputes/rival-card.tsx` — не своя строка: `RespectButton` и `ConnectButton` (по
  `useRiderSocial`, только при `riderPublicId`) над действием спора; `RivalAction` — только при своей заявке
  (RC-P4-10); своя: `RespectReceived` + «Поделиться в сторис». Комментарий «любому вошедшему (Q2)».
- `apps/app/src/features/races/disputes/dispute-format.ts` — удалить `canOpenRival` (+ кейсы в `dispute-format.test.ts`).
- `apps/app/src/features/races/race-detail.tsx` — `rowAction = signedIn ? push : null`, `ownRowAction = signedIn &&
  entry.data?.entry ? push : null` (RC-P4-11); комментарии RC-14 обновить.
- `apps/app/src/features/route-rides/route-ride-detail.tsx` — `RouteAuthorRespect` в `RideView` при `ride.status ===
  'passed' && !mine`.

**FILES TO READ (образцы)**: `social/rider-social.{controller,service}.ts` (PUT, `findPublic`, 404/409),
`social/ride-participants.*` (видимость, лимит, view), `results/results-for-tickets.*`, `routes/routes-for-sharing.*`,
`results/results-read.service.ts` (`publicResults`, `protocolResults`), `apps/api/test/{social,disputes,routes}.ts`
(`pastRide`, `riders`, `disputeRace`, `seedApprovedRiderRoute`, `seedRiderRoute`), app `rides/participants-queries.ts`,
`social/queries.ts`.

**TYPES & SCHEMAS** (`packages/contracts/src/social/`):

```ts
// ride-participants.schema.ts — в «Ехали N» (RC-P4-7)
export const RideAttendedRow = RideRiderRow.extend({
  self: z.boolean().default(false),     // строка зрителя — без «Спасибо»
  thanked: z.boolean().default(false),  // зритель уже сказал спасибо
});
export const RideAttendedGroup = z.object({ riders: z.array(RideAttendedRow), hiddenCount: z.number().int().min(0) });
// RideAttendance: attended: RideAttendedGroup.nullable().default(null), allThanked: z.boolean().default(false)

// reactions.schema.ts
export const RideThanksRequest = z.strictObject({ publicId: RiderPublicId.optional() });
export const SetRespectRequest = z.strictObject({ respected: z.boolean() });
export const RespectState = z.object({
  available: z.boolean().default(false), // цель есть и зритель — не получатель
  respected: z.boolean().default(false),
  count: z.number().int().min(0).default(0),
  own: z.boolean().default(false),
  from: RideRiderGroup.nullable().default(null), // только получателю, K3
});
```
Совместимость: старые сборки игнорируют `self`/`thanked`/`allThanked`; новые против старого ответа — `false` (кнопка
«всех» появится и получит 404 до деплоя API — API и приложение деплоятся вместе на dev). `userId` в схемах нет.

**TESTS**
- `packages/contracts/src/social/reactions.schema.test.ts` — strict-тела (лишний ключ, неверный `publicId` — ошибка;
  пустое тело `thanks` — ок), `RespectState` по умолчанию, `userId` отбрасывается.
- `packages/contracts/src/social/ride-participants.schema.test.ts` — `self`/`thanked`/`allThanked` по умолчанию `false`,
  старый ответ разбирается.
- `apps/api/src/modules/results/results.policy.test.ts` — `publicTableMode`, `isPublicProtocolRow`.
- `apps/api/src/modules/results/results-for-social.int.test.ts` (реальная БД, `disputeRace`): до публикации — строка с
  местом → цель, снятая, DQ по спору, START/без пульса (финишёр), заявка без лучшего — `null`; черновик/отменённая/без
  коридора — `null`; после публикации — строка ревизии → цель, DQ в новой ревизии — `null`, отмена DQ — снова цель;
  `entryId` совпадает с `entryId` строки `GET races/:raceId/results` в обоих режимах.
- `apps/api/src/modules/routes/routes-for-social.int.test.ts` — одобренный маршрут райдера → `{ authorUserId }`;
  команды, `pending`, `hidden`, снятый/удалённый, неизвестный — `null`.
- `apps/api/src/modules/social/ride-participants.view.test.ts` — `self`, `thanked`, `allThanked` (только зритель →
  `true`, скрытый не поблагодарён → `false`).
- `apps/api/src/modules/social/respect.view.test.ts` — `own`/`available`/`from` (непубличные — числом), нейтральный.
- `apps/api/src/modules/social/social-reactions.int.test.ts` — `thankAll` (непубличные включены, себя нет, повтор — 0,
  без новых событий), `setRespect` (повтор не переключает, параллельные `PUT true` — одна запись).
- `apps/api/src/modules/social/ride-thanks.int.test.ts` (HTTP) — AC1–AC3: один/повтор/все, 409 `self`/`not_attended`
  (зритель и получатель без явки), 404 `publicId` и скрытый райд, 400 лишнее поле, 429 первым, `no-store`, в теле нет
  `userId`.
- `apps/api/src/modules/social/social-respect.int.test.ts` (HTTP) — AC4–AC6: строка до и после публикации, PUT
  поставить/снять/повтор, 404 снятая/DQ/финишёр/черновик/чужая гонка в пути, 409 свой, `count` всем, `from` только
  получателю, маршрут райдера/команды/скрытый/свой, нейтральный GET, лимит; публичные `GET races/:raceId/results` и
  `GET routes/:id` байт-в-байт не изменились (заголовок `max-age=60`, нет полей респекта).
- `packages/api-client/src/social.test.ts` — пять методов (путь, метод, тело `{}` без `publicId`, разбор ответа).
- App jest: `src/__tests__/ride-detail.test.tsx` («Спасибо» у строки, нет у себя, «Вы сказали спасибо», «Поблагодарить
  всех» → «Вы поблагодарили всех», баннер 409); `src/__tests__/race-groups.test.tsx` или новый
  `src/__tests__/rival-card.test.tsx` (не-участник открывает карточку без «Оспорить» и после публикации; участник —
  с «Оспорить»; «Респект · N» переключается; «В свои» только при `riderPublicId`; своя строка — «респект N» и имена без
  кнопки); `src/__tests__/race-detail.test.tsx` (строка нажимаема вошедшему не-участнику, гостю — нет);
  `src/__tests__/route-ride.test.tsx` («Респект автору» при `passed` и `available`; нет при `?mine=1`, `available:
  false`, `not_passed`); `dispute-format.test.ts` без `canOpenRival`.
- Изоляция: своя БД Mongo и Redis db (память `pokatim-test-isolation`); `pnpm arch:check` в отчёте; `git diff --stat`
  по `notification-intake.ts`, `notification-texts.ts`, `notifications.policy.ts` — пусто (AC8).

**OUT OF SCOPE (P4):** уведомления и outbox `social.*` (P7, точка — RC-P4-14), Главная «Свои», автоявка (P5); число
респектов в таблице, шите финишёров, «Моих маршрутах», карточке маршрута каталога (K14); отмена «спасибо»; проверка
«прошёл маршрут» на сервере (RC-P4-5); миграции и индексы; правки API споров и `toggleRespect`.

**Documentation Impact:** `docs/product/social.md` (K5 — «всем явившимся, включая непубличных», без окна; K8 — Q2–Q4,
нейтральное состояние без цели, «прошёл» не проверяется сервером), `docs/product/rides.md` («После райда»),
`docs/product/routes.md` (route-rides — «Респект автору»), `docs/product/races-and-seasons.md` (карточка строки —
любому вошедшему, «Оспорить» — участникам), ADR-0027 п. 1 (порты `RESULTS_FOR_SOCIAL`, `ROUTES_FOR_SOCIAL`, импорт в
`SocialModule`) и п. 3 (эндпоинты P4); `.claude/rules/pokatim-backend.md` (раздел «Свои» + перечни портов `results` и
`routes`), `pokatim-contracts.md` (`reactions.schema.ts`, поля «Ехали»), `pokatim-app.md` (ключи кэша респекта,
открытие карточки строки), `pokatim-security.md` (эндпоинты, лимиты `social-thanks`/`social-respect`), строка P4 в эпике.

## 12. Outcome (заполняет coder)

### Changes
- **API `results`:** чистые `publicTableMode`, `isPublicProtocolRow` (`results.policy.ts`); `publicResults` и
  `protocolResults` переведены на них без смены поведения; `ResultsReadService.publicRow(entryId)`; порт
  `RESULTS_FOR_SOCIAL` (`ResultsForSocialService`, экспорт ядра и `index.ts`).
- **API `routes`:** порт `ROUTES_FOR_SOCIAL` (`RoutesForSocialService`: `findInCatalog` + `origin: 'rider'`).
- **API `social`:** `ReactionsRepository.recipientsOf/actorsOf`; `SocialReactionsService.thankAll/thankedBy/setRespect/
  respectedBy/respectActors` (поверх приватного `insert`); `POST rides/:id/thanks` (`SocialRideParticipantsService.thank`,
  лимит `social-thanks`); «Ехали N» — `self`/`thanked`, `allThanked`; `riderGroup` экспортирован;
  `SocialRespectService` + `SocialRespectController` (`GET|PUT races/:raceId/results/:entryId/respect`,
  `GET|PUT routes/:id/respect`, лимит `social-respect`, нейтральный `GET` без цели, `PUT` — 404, своя — 409 `self`);
  `respectStateView`/`NEUTRAL_RESPECT`; `SOCIAL_POLICY.thanksLimit/respectLimit/respectFromMax`; `SocialModule`
  импортирует `ResultsCoreModule`, `RoutesCoreModule` (RC-P4-12).
- **Контракты / api-client / i18n:** `reactions.schema.ts` (`RideThanksRequest`, `SetRespectRequest`, `RespectState`),
  `RideAttendedRow`/`RideAttendedGroup`/`allThanked`; пять методов клиента; строки `rides.thanks.*`, `social.respect.*`
  (всё — в конец общих файлов).
- **App:** «Спасибо за компанию» / «Вы сказали спасибо» у строк «Ехали N», «Поблагодарить всех» / «Вы поблагодарили
  всех», баннер ошибки (`useRideThanks`, `thanksErrorText`, `RideRiderList<Row>` с `trailing`); карточка строки
  результата — любому вошедшему, «Респект» / «Респект · N» и «В свои» (`ConnectButton` P3 экспортирован) над
  «Оспорить», «Оспорить» — только при своей заявке (RC-P4-10), своя — «респект N» с именами (RC-P4-11);
  `canOpenRival` удалён; «Респект автору» на экране заезда при `passed && !mine` (`respect-queries.ts`,
  `respect-block.tsx`).

### Files touched
- API: `apps/api/src/modules/results/{results.policy.ts,results.policy.test.ts,results-read.service.ts,results.module.ts,
  index.ts,results-for-social.port.ts,results-for-social.ts,results-for-social.int.test.ts}`;
  `apps/api/src/modules/routes/{routes.module.ts,index.ts,routes-for-social.port.ts,routes-for-social.ts,
  routes-for-social.int.test.ts}`; `apps/api/src/modules/social/{reactions.repository.ts,reactions.service.ts,
  ride-participants.{controller,service,view}.ts,ride-participants.view.test.ts,ride-participants.int.test.ts,
  social-reactions.int.test.ts,social.module.ts,social.policy.ts,respect.{controller,service,view}.ts,
  respect.view.test.ts,ride-thanks.int.test.ts,social-respect.int.test.ts}`.
- Пакеты: `packages/contracts/src/{index.ts,social/ride-participants.schema.ts,social/ride-participants.schema.test.ts,
  social/reactions.schema.ts,social/reactions.schema.test.ts}`; `packages/api-client/src/{index.ts,social.test.ts}`;
  `packages/i18n/src/ru.ts`.
- App: `apps/app/src/features/rides/{participants-queries.ts,ride-participants-block.tsx,ride-rider-list.tsx}`,
  `features/social/{rider-social-block.tsx,respect-queries.ts,respect-block.tsx}`,
  `features/races/{race-detail.tsx,disputes/rival-card.tsx,disputes/dispute-format.ts,disputes/dispute-format.test.ts}`,
  `features/route-rides/route-ride-detail.tsx`; тесты `src/__tests__/{ride-detail,rival-card,race-disputes,race-groups,
  race-results,story-card,route-ride,route-ride-map}.test.tsx`.
- Не изменены (AC8): `notification-intake.ts`, `notification-texts.ts`, `notifications.policy.ts` (`git diff --stat` по
  `apps/api/src/modules/notifications/` — пусто). Миграций, очередей, outbox — нет.

### Docs updated
`docs/product/social.md` (K5 — Q1, без окна; K8 — Q2–Q4, невидимая цель, «прошёл» не проверяется),
`docs/product/rides.md` («После райда» — «Спасибо за компанию»), `docs/product/routes.md` («Респект автору»),
`docs/product/races-and-seasons.md` (карточка строки любому вошедшему, «Оспорить» — участникам), ADR-0027 п. 1 (порты,
импорт в `SocialModule`) и п. 3 (эндпоинты, лимиты), `.claude/rules/pokatim-{backend,contracts,app,security}.md`, строка
P4 в эпике `docs/tasks/2026-10-31-social-stage-0/task.md`.

### Tests
Isolation: `MONGO_URL_TEST=…/pokatim_social_p4_test`, `REDIS_URL_TEST=redis://127.0.0.1:6479/8`.
- New: `results.policy.test.ts` (`publicTableMode`, `isPublicProtocolRow`), `results-for-social.int.test.ts` (before/after
  publication, withdrawn/DQ/finisher/no best/draft/cancelled/no corridor, DQ → revoke, `entryId` = row of the public
  table), `routes-for-social.int.test.ts`, `ride-participants.view.test.ts` (`self`/`thanked`/`allThanked`),
  `respect.view.test.ts`, `social-reactions.int.test.ts` (`thankAll`, idempotent `setRespect`, parallel `PUT true`),
  `ride-thanks.int.test.ts` (AC1–AC3, 400/401/404/409/429, no `userId`), `social-respect.int.test.ts` (AC4–AC6, public
  `GET races/:raceId/results` and `GET routes/:id` unchanged byte for byte, `max-age=60`); contracts
  `reactions.schema.test.ts`, `ride-participants.schema.test.ts`; api-client `social.test.ts` (5 methods); app
  `rival-card.test.tsx` (new), `ride-detail.test.tsx` («Спасибо»), `route-ride.test.tsx` («Респект автору»).
- `apps/api`: `vitest run src/modules/{social,results,routes,route-rides}` → **49 files, 599 passed**; `tsc --noEmit`,
  `eslint` (social/results/routes) — clean.
- `packages/contracts` vitest → passed (incl. 24 in `src/social`); `packages/api-client` `social.test.ts` → 10 passed;
  `packages/i18n` → 16 passed; tsc + eslint of all three — clean.
- `apps/app`: full `jest` → **282 suites, 2766 passed**; `tsc --noEmit`, `eslint` of touched folders — clean.
- `pnpm arch:check` → `✔ no dependency violations found (2498 modules, 10048 dependencies cruised)`.
- `prettier --check` of touched files — clean. Full `pnpm check` — NOT RUN (by the orchestrator's instruction).

### Open follow-ups
- P7: уведомления «Спасибо за компанию» и «Респект» — точка привязки ниже; названия гонки/маршрута для текстов —
  портами при приёме (у `*_FOR_SOCIAL` их нет).
- P5 параллельно правит `ride-participants.service.ts`/`social.policy.ts` — возможен текстовый конфликт при слиянии.
- Полный `pnpm check` — за оркестратором.

### Записка для P7 (точка привязки уведомлений к реакциям)
Все новые реакции проходят через приватный `SocialReactionsService.insert`
(`apps/api/src/modules/social/reactions.service.ts`): `thank`, `thankAll` (по одной транзакции на реакцию),
`setRespect(true)` и P0 `toggleRespect`. Внутри — `transactions.run`: вставка `social_reactions` + `product_events`;
P7 добавляет запись outbox `social.*` в эту же транзакцию по `ReactionKey` (`kind`, `actorId`, `recipientId`,
`targetType`, `targetId`) — дубль уникального индекса откатывает и outbox, повтор уведомлений не порождает. Возврат
`insert`/`thank`/`setRespect` (`boolean` «новая реакция») и `thankAll` (число новых) уже есть. `notification-intake.ts`,
`notification-texts.ts`, `notifications.policy.ts` в P4 не тронуты. Порты `RESULTS_FOR_SOCIAL`/`ROUTES_FOR_SOCIAL`
сейчас импортирует только HTTP `SocialModule`; если они нужны в worker — перенести импорт в ядро. Копия заметки —
`side-session-notes/…/p4-reactions.md`.

**Ревью (pass 1, independent-reviewer):** APPROVE, CRITICAL/HIGH — 0, LOW — 3 (`findings.md`). LOW-2 исправлен
оркестратором; follow-ups: (1) свести `isPublicProtocolRow` и `isRankedRow` (`rider-results.port.ts`) в один предикат
`results`; (2) карточка своей строки до загрузки участия — скелетон вместо раскладки соперника (§4.12).
