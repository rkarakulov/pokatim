# «Свои», P5 — автоявка по заезду и регламент «Как прошёл райд?» (K2, K5, K10)

Уровень: task3. Эпик — `docs/tasks/2026-10-31-social-stage-0/task.md` (строка P5 таблицы §3.2, RC-2a, RC-3a, правило
параллельных PR), продукт — `docs/product/social.md` K2, K5, K10, архитектура — ADR-0027 п. 2, 4. В develop: P0 (#158,
`SocialAttendanceService.markByTrack`, `SOCIAL_POLICY.autoAttendance`/`askAfterMs`, имена очередей), P2 (#175, явка
райда), P6 (#174, процессор `social-intake` с таблицей обработчиков), P1 (#172), P3 (#176). Параллельно — P4; P7 —
после P4 и P5.

## 1. Title

Автоявка на райде по синхронизированному или загруженному велозаезду и отбор адресатов «Как прошёл райд?» через 4 ч
после старта.

## 2. Goal

Участник «Иду», который реально проехал райд с записью трека, получает явку (а с ней связи `ride`, K1) без нажатия
«Я был на райде». Тем, у кого явки нет, через 4 ч после старта готов список адресатов «Как прошёл райд?» — P7
привяжет к нему уведомление.

## 3. Scope

1. **Событие заезда → `social-intake`.** Записанная активность `tracks` попадает в очередь `social-intake` (имя задачи
   = тип события, jobId = id события outbox — как у P6). Обработчик добавляется в таблицу существующего
   `SocialIntakeProcessor` (P6) — новый `registerQueue` и второй процессор не заводятся. ADR-0027 п. 4 называет
   событие `tracks.activity-recorded`; architect сверяет с кодом: outbox уже умеет fan-out (`mergeOutboxRoutes`), и
   подписка `social` на существующее `tracks.activity-ready` может сделать новое событие ненужным — решение и правка
   ADR — в 8.1/8.2.
2. **Порт `ACTIVITY_STARTS`** (`tracks` → `social`): по активности — основная группы дублей (не дубль), владелец,
   вид спорта, время и точка старта. `social` коллекции `tracks` не читает.
3. **Сверка K2.** Заезд `cycling` (основная группы) райдера засчитывается в явку райда, если:
   - райдер — участник «Иду» или организатор; райд не отменён и не скрыт;
   - у райда точный старт (маршрут каталога, `preciseStart ≠ null`);
   - старт заезда в окне `[старт райда − 30 мин; старт райда + 2 ч]` и не дальше 500 м от точки старта райда
     (`SOCIAL_POLICY.autoAttendance`);
   - заезд обработан не позже 7 дней после старта райда (`attendanceWindowMs`);
   - у райдера в этом райде нет `declinedAt` («Меня не было», RC-3a) — это уже держит `markByTrack`.
   Подходящих райдов несколько — явка во всех. Явка ставится `SocialAttendanceService.markByTrack` (P0) — новый путь
   записи явки и пересчёта связей не заводится. Повтор задачи и повторное событие той же группы — без изменений и без
   событий метрик.
4. **Метод `RIDES_FOR_SOCIAL`** «райды участника по окну старта» (ADR-0027: метод P5 добавляется в своём PR).
5. **Регламент `social-maintenance`** (scheduler, раз в 30 минут, ADR-0027 п. 4): райды, у которых прошло 4 ч после
   старта (`askAfterMs`), не отменённые и не скрытые; адресаты — участники «Иду» (и организатор) без записи явки
   (нет ни явки, ни `declinedAt`). Один раз на райд (повтор регламента и пропущенный запуск не дают дублей и не
   теряют райд в разумном окне догона — architect задаёт окно). Отправки в P5 нет: правило параллельных PR —
   `notification-intake.ts`, `notification-texts.ts`, `notifications.policy.ts` не трогаем. P5 оставляет точку
   привязки для P7 (порт/место вызова с `{ rideId, userIds }`) и записку в §12.
6. **Документы:** ADR-0027 п. 4 (уточнение по факту), `docs/product/social.md` только если реализация уточняет K2 /
   K10 без смены поведения; записка для P7 — §12 и общая папка заметок.

## 4. Out of Scope

Само уведомление «Как прошёл райд?» и его текст, kind `social_ride_ask` в intake (P7). Экраны — без изменений
(автоявка видна в существующей карточке прошедшего райда P2). Снятие явки при удалении заезда. «Спасибо» (P4).

## 5. Architecture Context

`social` — потребитель (ADR-0027 п. 1): `tracks` и `rides` о `social` не знают, только порты `*_FOR_SOCIAL` /
`ACTIVITY_STARTS` через `index.ts`. Маршрут события объявляет подписчик (`socialOutboxRoutes`). Явка — один документ
на райд, запись + пересчёт связей — одна транзакция (RC-2a).

## 5.1 Placement & Reuse Gate

- Переиспользуем: `SocialIntakeProcessor` (таблица обработчиков), `SocialAttendanceService.markByTrack`,
  `attendanceCheck`, `SOCIAL_POLICY`, `RIDES_FOR_SOCIAL`, `ActivitySource`-порт `tracks` как образец, scheduler по
  образцу `tickets-maintenance.processor.ts` / `standings-sync.processor.ts`, расстояние — существующая гео-функция
  (`@pokatim/tracks` или `rides`), а не новая формула.
- Запрещено: `social` читает `tracks`/`rides` напрямую; второй процессор `social-intake`; правки трёх файлов
  `notifications` из правила параллельных PR.

## 6. Relevant Files

`apps/api/src/modules/social/{social-intake.processor.ts,social.events.ts,social.module.ts,attendance.service.ts,
attendance.repository.ts,social.policy.ts}`, `apps/api/src/modules/tracks/{tracks.events.ts,activity-source*.ts,
index.ts,tracks.module.ts}`, `apps/api/src/modules/rides/{rides-for-social*.ts,rides.repository.ts}`,
`apps/api/src/outbox-routes.ts`, `apps/api/src/queues.ts`.

## 7. Implementation Notes

- Обработчик читает состояние группы **сейчас**, не payload: порядок и повтор событий не важны.
- Время «обработан не позже 7 дней» — часы `CLOCK` в момент обработки задачи.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION K2]` пороги −30 мин / +2 ч / 500 м — из `SOCIAL_POLICY`, не дублируются.
- `[ASSUMPTION]` удаление заезда явку не снимает (совместная езда — факт; снять — «Меня не было»).
- `[ASSUMPTION]` адресаты «Как прошёл райд?» — без записи явки; нажавшие «Меня не было» не спрашиваются.
- Райд без точного старта — только ручная явка (K2); «Как прошёл райд?» ему всё равно положен.

## 8.1 Requirements Consistency (заполняет architect)

Статус: **CONCERNS, блокеров нет.** Все находки ниже — уточнения с рекомендацией, по ним написан §11. Два вопроса к
пользователю (RC-P5-10, RC-P5-11) имеют безопасное значение по умолчанию и coder не останавливают.

- **RC-P5-1. Событие заезда: `tracks.activity-recorded` (ADR п. 4) или существующее `tracks.activity-ready`.**
  Посылка ADR «одна очередь на тип, поэтому второе событие» устарела: `outbox-routes.ts` собирает маршруты
  `mergeOutboxRoutes` (fan-out, api-kit ≥ 0.6.0), `tracks.activity-removed` уже идёт в две очереди. `activity-ready
  {activityId, uploadId, userId}` пишется в транзакции записи **каждой** активности (основной и дубля, под
  `lockUserActivities`), а подписчик по контракту события читает группу «сейчас». Это ровно то, что нужно автоявке.
  Варианты: (a) `socialOutboxRoutes += { [TRACK_ACTIVITY_READY]: QUEUE.socialIntake }`, в `tracks` меняется только
  порт; (b) новое `tracks.activity-recorded` с тем же payload в той же транзакции — второй писатель outbox в
  `track-processing.processor.ts`, дубль смысла, лишняя запись на каждый заезд; (c) `tracks.activity-group-created` —
  не подходит: поздний дубль, перехвативший основную, его не даёт (см. комментарий в `tracks.events.ts`).
  **Рекомендация — (a).** Следствие: тест `outbox-routes.test.ts` «activity-ready — только results-intake
  (route-rides-03, AC4)» меняется на `['results-intake', 'social-intake']`. Тот AC защищал от подписки `route-rides`
  на `activity-ready`, а не от подписки других модулей: смысл сохраняется, имя теста уточняется. Правка ADR п. 4
  (coder переносит в 8.2 и в ADR): «Автоявка — подписка `social` на `tracks.activity-ready` (fan-out
  `mergeOutboxRoutes`), нового события в `tracks` нет. Группу и старт основной `social` читает портом
  `ACTIVITY_STARTS`, райды — `RIDES_FOR_SOCIAL`. `results-intake` не меняется. Регламент `social-maintenance` раз в
  30 мин отбирает райды через 4 ч после старта: захват `askedAt` в документе явки райда и точка привязки P7
  `RIDE_ASK_DUE` в той же транзакции. Уточнено в P5.» Заодно — комментарий `QUEUE.socialIntake` в `queues.ts`.
- **RC-P5-2. `ACTIVITY_STARTS` — новый порт или расширение `ACTIVITY_SOURCE`.** `ActivitySource.group()` даёт
  членов группы, но `ActivityRef` по контракту «без координат, кроме рамки линии»: у активности с линией `bounds` — рамка,
  а не старт. Если добавить `startPoint` в `ActivityRef`, координаты старта получат все потребители `results` и
  `route-rides`, а `group()` будет читать линии ради одного поля. Варианты: (a) отдельный узкий порт
  `ACTIVITY_STARTS.primaryStart(activityId)`; (b) `startPoint` в `ActivityRef`; (c) новый метод в `ActivitySource`.
  **Рекомендация — (a)**, ADR его так и называет. Реализация читает два документа, без сортировки группы:
  `findActivity(id)` → `root = duplicateOf ?? _id` → `findActivity(root)`. Хранимое `duplicateOf` и есть
  авторитетная основная (`applyGroup`), так что `byPrimaryPriority` и `groupMembers` не нужны и логика группы не
  дублируется. Активность или основная удалена — `null`.
- **RC-P5-3. Кто проверяет окно «обработан ≤ 7 дней после старта» и пороги K2.** Сейчас `attendanceCheck(…, 'track')`
  окна не проверяет (по смыслу P0 — для ручной правки), а `markByTrack` проверяет только участие и фазу. **Решение:**
  чистая функция `autoAttendanceCheck(facts, start, userId, now)` в `social.policy.ts`. Порядок проверок:
  `attendanceCheck(facts, userId, now, 'track')`, затем `phase === 'past'` (RC-P5-4), `preciseStart ≠ null`,
  `now ≤ startsAt + attendanceWindowMs`, `startsAt − beforeMs ≤ startedAt ≤ startsAt + afterMs` (границы
  включительно), `haversineMeters ≤ radiusM`. Результат — причина отказа или `null`. Порог `cycling` и «не дубль»
  проверяет intake по ответу порта: это свойство заезда, а не пары «заезд — райд». `markByTrack` и `attendanceCheck`
  не меняются. Окно 7 дней — по `CLOCK` в момент задачи (§7).
- **RC-P5-4 (уточнение). Райд ещё не начался.** Заезд, начатый за 30 мин до старта и обработанный до старта райда, —
  это не райд: он закончился раньше, чем начался райд. Ручная явка тоже открывается только со старта (K2). Без
  проверки фазы участник мог бы получить явку будущего райда и потом нажать «Не иду». **Рекомендация:** в
  `autoAttendanceCheck` — отказ `attendance_window` при `phase ≠ 'past'`. Поведение K2 не меняется.
- **RC-P5-5. `markByTrack` бросает `409/404`.** Состояние райда может смениться между чтением портом и транзакцией
  (отменён, скрыт, участник вышел). Бросок из обработчика — ретраи публикатора и failed-набор для штатной ситуации.
  **Рекомендация:** intake ловит `isDomainError(error) && (status 404 || 409)` по каждому райду отдельно и
  засчитывает его как `blocked`. Остальные ошибки пробрасываются: повтор идемпотентен, уже поставленные явки дают
  no-op без событий.
- **RC-P5-6. Гонка со стиранием аккаунта.** Шаг `tracks` идёт до `social`, но задача, прочитавшая старт до шага
  `tracks`, может поставить явку после шага `social` — останется запись удалённого. **Рекомендация:** как в P6 —
  `IdentityAccounts.liveUserIds([userId])` до сверки, иначе итог `user_deleted`. Остаточное окно закрывает повторный
  проход стирания (RC-P6-9).
- **RC-P5-7. Лог в catch-ветке `SocialIntakeProcessor`.** Ветка пишет `social.invite_failed` для любого типа.
  **Рекомендация (минимальная):** `social.intake_failed type=<job.name> event=<id>`. Тип уже в строке, тесты эту
  строку не проверяют, упоминание есть только в истории P6 (`docs/tasks/2026-10-31-social-p6-invites/task.md:137`).
  Тип `IntakeOutcome` расширяется union-ом `AutoAttendanceOutcome`.
- **RC-P5-8. Методы `RIDES_FOR_SOCIAL` и индексы — миграции нет.** (1) `ridesOfParticipant(userId, from, to, now)` —
  фильтр `{ 'participants.userId', startsAt: {$gte, $lte} }` идёт по существующему `rides_participant_idx
  { 'participants.userId': 1, startsAt: 1 }` (`0014_rides`; организатор — первый участник), любой статус, фазу
  решает `social`, проекция как у `findForSocial`, `limit` 20. (2) `startedRidesWithin(after, until, limit)` для
  регламента — переиспользует **существующий** `RidesRepository.startedWithin` (только `published`, keyset
  `changedWithin(…, 'startsAt')`, `rides_feed_idx { startsAt, _id }`), так что отменённые и скрытые отсекаются
  запросом. Новых индексов нет, номер миграции у параллельных PR не занимается.
- **RC-P5-9. Где хранить «спрошено» (одно на райд).** Варианты: (a) поле `askedAt: Date | null` в документе
  `ride_attendance` райда (единственный писатель — `AttendanceRepository`, документ и так один на райд); (b) новая
  коллекция `social_ride_asks` — миграция с номером по факту слияния, конфликт с P4/P7; (c) курсор в Redis по образцу
  `achievements.sweep` — замок-аренда и потеря курсора, а гарантия «одно на райд» всё равно не выводится.
  **Рекомендация — (a).** Захват в транзакции: `ensure` (документ без записей) → `updateOne({ _id, askedAt: null },
  { $set: { askedAt: now } })`, `modifiedCount = 0` — уже спрошен. Затем записи явки читаются **в той же транзакции**,
  адресаты = участники − все `entries.userId` (и явка, и `declinedAt`), вызов `RIDE_ASK_DUE.due(tx, { rideId,
  userIds })`. Захват — запись в документ явки, поэтому параллельная отметка явки конфликтует с ним и повторяется
  `MongoTransactions.run` на свежем снимке: адресат, отметившийся в тот же момент, либо попадает в `entries`, либо
  отмечается после захвата. `updatedAt` захват не трогает (это время изменения явки). Нет поля — `null`, миграции и
  бэкфилла нет. `entriesOf`/`attendees`/`pullUser` поле не читают. Райд без адресатов захватывается без вызова
  точки P7.
- **RC-P5-10 (вопрос к пользователю, значение по умолчанию есть). Окно догона.** Отбираются райды со стартом в
  `[now − askAfterMs − askCatchUpMs; now − askAfterMs]`, `askCatchUpMs = 24 ч` (`SOCIAL_POLICY`). Плюс разовый прогон
  при старте worker (образец `TicketsSchedules`). Если worker лежал больше суток, райды старше окна не спрашиваются и
  не захватываются: вопрос через сутки и больше — шум, ручная явка открыта 7 дней. Повтор регламента дублей не даёт
  (захват `askedAt`).
- **RC-P5-11 (вопрос к пользователю, значение по умолчанию есть). Выкат P7 после P5.** В P5 у точки привязки
  `RIDE_ASK_DUE` реализация-заглушка: лог `social.ride_ask_due ride=<id> count=<n>`, без id райдеров. Регламент при этом
  уже захватывает `askedAt`. После выката P7 (P7 только подменяет провайдер `RIDE_ASK_DUE`, например на запись outbox в
  переданной `tx`) старые райды массово не спрашиваются. Но райды, прошедшие между выкатом P5 и P7, вопроса не получат
  никогда. Альтернатива — не захватывать в P5 — нарушает AC5 и даёт при выкате P7 разовый вопрос по райдам за
  последние 24 ч. **Рекомендация:** принять, записка для P7 — в §12.
- **RC-P5-12. Адресаты.** Участники «Иду» с организатором первым (`participantIds`) без записи в `entries`,
  только живые аккаунты (`IdentityAccounts.liveUserIds` до транзакции; прошлые райды стирание не чистит —
  `leaveAllFuture` только будущие). Это согласуется с K10 «участникам „Иду“ без явки» и с `[ASSUMPTION]` §8 о «Меня не
  было». Райд без точного старта отбирается тоже (§8).
- **RC-P5-13. Устаревшие комментарии в общих файлах.** В `queues.ts` у `socialIntake` указано `tracks.activity-recorded`,
  у `socialMaintenance` — «(P7)». В `SocialWorkerModule` — «`social-maintenance` — P7». **Рекомендация:** поправить
  только текст комментариев. `queues.ts` не в списке «только в конец» правила параллельных PR, правка комментария
  возможному тексту P7 не мешает.
- **RC-P5-14 (принятый риск, OUT OF SCOPE).** Основная группы может смениться без `activity-ready`: удаление основной
  повышает дубль (`activity-removed`). Если прежняя основная не прошла сверку (например, файл `unknown`), а новая
  прошла бы, явки не будет — остаётся «Я был на райде». На `activity-removed` P5 не подписывается: удаление заезда
  явку и так не снимает (§8).
- **RC-P5-15. Точка райда.** `rideFacts.preciseStart` берётся из сохранённых `geo` + `startPrecise` (решение P0).
  Флаг поддерживает `resetStartsForRoutes`, когда маршрут уходит из каталога. Чтение маршрута «сейчас»
  (`ridePointNow`) P5 не вводит.
- **RC-P5-16. Гео-функция.** Используется `haversineMeters` из `@pokatim/tracks` (`packages/tracks/src/geo.ts`, метры,
  `{lat, lon}`; API уже зависит от пакета — `routes/route-catalog.ts`). `rides.policy.distanceKm` — модуль-производитель,
  `social` его не импортирует. Новой формулы нет. Разница радиусов Земли (6371 и 6378 км) на 500 м — меньше 1 м.

Нарушений инвариантов `AGENTS.md` §4 и вредных решений не найдено: сервер авторитетен (владелец и старт — из
состояния `tracks`, payload не используется), `tracks`/`rides` о `social` не знают, правки трёх файлов `notifications`
нет, новых очередей, миграций и контрактов API нет.

## 8.2 Deviations from spec

- **ADR-0027 п. 4 (RC-P5-1, принято оркестратором):** вместо нового события `tracks.activity-recorded` — подписка
  `social` на существующее `tracks.activity-ready` (fan-out `mergeOutboxRoutes`). Текст п. 4 и строка «Последствий»
  («новые outbox-события в `tracks`» → только `identity`) исправлены в `docs/adr/0027-social-connections.md`.
  `tracks.events.ts` и `track-processing.processor.ts` не менялись.
- `outbox-routes.test.ts`: тест «activity-ready — только results-intake (route-rides-03, AC4)» теперь ждёт
  `['results-intake', 'social-intake']`; имя уточнено — AC4 route-rides защищал от подписки `route-rides`, не других
  модулей (RC-P5-1).
- `SocialCoreModule.exports += AttendanceRepository` (в конец списка): регламенту `SocialWorkerModule` нужны
  `claimAsk`/`entriesIn`/`askedAmong`, а §11.3 явно этого не называл. Второй экземпляр репозитория в worker-модуле не
  заводился; вне `social` репозиторий не уходит (не в `index.ts`).
- `rides-for-social.port.ts`: константа предела `SOCIAL_PARTICIPANT_RIDES_MAX = 20` (§11.4 — «≤ 20» без имени).
- Значения по умолчанию RC-P5-10/11 приняты: окно догона 24 ч (`SOCIAL_POLICY.askCatchUpMs`), до P7 регламент ставит
  `askedAt`, точка `RIDE_ASK_DUE` — заглушка с логом. Пользователь подтвердил оба значения 2026-11-01 — строка в
  `docs/product/social.md` K5 (догон сутки, райды до выката P7 без вопроса).

## 8.3 Security checklist

- Владение: явка ставится только владельцу заезда (`userId` из состояния `tracks`, не из payload).
- В логах — id событий/райдов и итог, без координат.

## 9. Acceptance Criteria

1. AC1 — велозаезд участника «Иду» в окне и радиусе райда с точным стартом ставит явку `via: track`, связи `ride` с
   другими явившимися пересчитаны, событие `attendance-marked {via: track}` записано один раз.
2. AC2 — не засчитывается: не `cycling`; дубль (основная — другая активность, засчитывается основная); вне окна по
   времени (−30 мин −1 с, +2 ч +1 с); дальше 500 м; райд без точного старта; отменённый/скрытый; не участник;
   обработан позже 7 дней после старта; запись с `declinedAt`.
3. AC3 — повтор задачи и повторное событие той же группы не меняют состояние и не пишут событий.
4. AC4 — неизвестное имя задачи по-прежнему бросает, payload не по схеме — `skipped`; приглашения P6 работают.
5. AC5 — регламент: через 4 ч после старта отбирает участников «Иду» без записи явки; явившиеся и «Меня не было» не
   попадают; отменённый/скрытый райд не попадает; повторный запуск того же райда не отбирает повторно; точка
   привязки P7 вызывается с `{ rideId, userIds }`.
6. AC6 — `pnpm arch:check`: `tracks` и `rides` не импортируют `social`.

## 10. Documentation Impact

ADR-0027 п. 4; `docs/product/rides.md`/`social.md` — только если уточняется поведение; §12 — записка для P7.

Architect (RC-P5-1…16), что меняется:
- ADR-0027 п. 4: текст из RC-P5-1. Подписка на `tracks.activity-ready`, порт `ACTIVITY_STARTS`, захват `askedAt` и
  `RIDE_ASK_DUE`. В «Последствиях» — «новые outbox-события в `tracks`» больше не верно: остаётся только `identity`.
- `.claude/rules/pokatim-backend.md` §«Свои»:
  - `social → tracks` (порт `ACTIVITY_STARTS`) в списке зависимостей;
  - строка автоявки: intake, `autoAttendanceCheck`, ловля 404/409, `liveUserIds`;
  - регламент `social-maintenance`: 30 мин + boot, окно `askCatchUpMs`, захват `askedAt`, `RIDE_ASK_DUE` — заглушка до P7;
  - новые методы `RIDES_FOR_SOCIAL`.
- `.claude/rules/pokatim-backend.md` §«Очереди»: `tracks.activity-ready` → `results-intake` + `social-intake`.
- `.claude/rules/pokatim-db.md` §«Свои»: поле `ride_attendance.askedAt` (захват регламента, без миграции, нет поля —
  `null`, `updatedAt` не трогает).
- `docs/product/social.md` K2/K10: поведение не меняется. Окно догона 24 ч и «не начавшийся райд» (RC-P5-4,
  RC-P5-10): пользователь подтвердил 2026-11-01, строка добавлена в K5.
- §12: записка для P7 — подменить провайдер `RIDE_ASK_DUE` (outbox в переданной `tx`). Райды, захваченные до
  выката P7, не спрашиваются (RC-P5-11). Адресаты уже отфильтрованы по явке и живости.

## 11. Implementation Context

Всё — в `apps/api`. Контракты (`packages/contracts`), приложение, миграции и три файла `notifications` не меняются.

### 11.1 ENTRY POINTS

1. Задача `social-intake`, имя `tracks.activity-ready` (jobId = id события outbox): `SocialIntakeProcessor.process` →
   строка таблицы → `AutoAttendanceIntake.handle(event)`.
2. Задача `social-maintenance`, имя `social.ride-ask`. Ставят `upsertJobScheduler` каждые 30 мин
   (`*/30 * * * *`, `Europe/Minsk`) и разовая задача при старте worker (jobId `social.ride-ask.boot`):
   `SocialMaintenanceProcessor.process` → `RideAskSweep.run()`.

### 11.2 FILES TO CREATE

- `modules/tracks/activity-starts.port.ts`: `ACTIVITY_STARTS = Symbol('ACTIVITY_STARTS')` и типы (11.4).
- `modules/tracks/activity-starts.ts`: `ActivityStartsService implements ActivityStarts`, читает только через
  `TracksRepository.findActivity` (два чтения: активность → `duplicateOf ?? _id` → основная). Возвращает
  `{ activityId: primary._id, userId, sport, startedAt, startPoint: primary.startPoint.coordinates }`; нет любой из
  двух — `null`.
- `modules/social/auto-attendance-intake.ts`: `AutoAttendanceIntake` (провайдер `SocialWorkerModule`, как
  `InviteIntake`).
- `modules/social/ride-ask.port.ts`: `RIDE_ASK_DUE` и `RideAskDue` (точка привязки P7), плюс
  `LoggingRideAskDue implements RideAskDue` — заглушка P5. Пишет только лог
  `social.ride_ask_due ride=<id> count=<n>`, без `userIds`.
- `modules/social/ride-ask-sweep.ts`: `RideAskSweep` (регламент, 11.5).
- `modules/social/social-maintenance.processor.ts`: `SocialMaintenanceProcessor` и `SocialSchedules`
  (`OnApplicationBootstrap`), копия формы `modules/tickets/jobs/tickets-maintenance.processor.ts`
  (`SOCIAL_SCHEDULES`, `ONE_SHOT`). Неизвестное имя — бросок.
- Тесты — 11.7.

### 11.3 FILES TO MODIFY

- `modules/tracks/tracks.module.ts`: провайдер `ActivityStartsService` + `{ provide: ACTIVITY_STARTS, useExisting }`,
  `exports += ACTIVITY_STARTS`, комментарий модуля.
- `modules/tracks/index.ts`: экспорт `ACTIVITY_STARTS`, `type ActivityStart`, `type ActivityStarts` с комментарием
  «порт для `social` (автоявка, ADR-0027 п. 4)». `tracks.events.ts` и `track-processing.processor.ts` **не
  меняются**.
- `modules/rides/rides-for-social.port.ts`: в `RidesForSocial` добавляются `ridesOfParticipant` и
  `startedRidesWithin` (11.4). Из комментария порта убирается «метод P5 добавляется в своём PR».
- `modules/rides/rides-for-social.ts`: общий маппер `socialFactsOf(doc, now)`, его используют `rideFacts` и
  `ridesOfParticipant`. `startedRidesWithin` строится поверх `repository.startedWithin`. Курсор `next` — последний
  прочитанный, `null` при пустой странице (как `RiderRidesService.startedRidersAfter` в `rider-rides.ts`).
- `modules/rides/rides.repository.ts`: `participantRidesBetween(userId, from, to, limit)` — фильтр
  `{ 'participants.userId': userId, startsAt: { $gte: from, $lte: to } }`, проекция как у `findForSocial`, сортировка
  `startsAt ↑, _id ↑`, индекс `rides_participant_idx`. `startedWithin` переиспользуется как есть.
- `modules/social/social.events.ts`: `socialOutboxRoutes += { [TRACK_ACTIVITY_READY]: QUEUE.socialIntake }` в конец,
  с комментарием «автоявка (P5)».
- `modules/social/social-intake.processor.ts`: строка таблицы
  `[TRACK_ACTIVITY_READY]: handler(TrackActivityReady, (e) => autoAttendance.handle(e))`, новый параметр
  конструктора `AutoAttendanceIntake`. `IntakeOutcome = InviteIntakeOutcome | AutoAttendanceOutcome | 'skipped'`.
  В catch-ветке лог меняется на `social.intake_failed` (RC-P5-7). Комментарий класса — «приглашения (P6), автоявка (P5)».
- `modules/social/social.policy.ts`:
  - `SOCIAL_POLICY += askCatchUpMs: 24 * HOUR_MS` (RC-P5-10) и `askPageRows: 500`, в комментарии — «P5»;
  - чистые функции `autoAttendanceCheck` и `rideAskRecipients` (11.4).
  - `haversineMeters` импортируется из `@pokatim/tracks`.
- `modules/social/social.collection.ts`: в `AttendanceDoc` добавляется `askedAt?: Date | null` с комментарием
  «захват „Как прошёл райд?“ (P5), нет поля — `null`».
- `modules/social/attendance.repository.ts`, три метода:
  - `claimAsk(tx, rideId, now): Promise<boolean>` — `ensure` + `updateOne({ _id, askedAt: null }, { $set: { askedAt } })`;
  - `entriesIn(rideId, tx): Promise<AttendanceEntry[]>` — записи в сессии; `attendees` переводится на него;
  - `askedAmong(rideIds): Promise<Set<string>>` — `find({ _id: { $in }, askedAt: { $ne: null } }, { projection: { _id: 1 } })`,
    предфильтр без транзакции.
- `modules/social/social.module.ts`: `SocialWorkerModule.imports += TracksCoreModule, RidesCoreModule`;
  `BullModule.registerQueue({ name: QUEUE.socialIntake }, { name: QUEUE.socialMaintenance })` — **тот же** вызов,
  второй очереди `social-intake` нет. Провайдеры: `AutoAttendanceIntake`, `RideAskSweep`, `LoggingRideAskDue`,
  `{ provide: RIDE_ASK_DUE, useExisting: LoggingRideAskDue }`, `SocialMaintenanceProcessor`, `SocialSchedules`.
  Комментарий модуля: «`social-maintenance` — отбор P5, отправка P7».
- `queues.ts`: только текст комментариев `socialIntake` и `socialMaintenance` (RC-P5-13).
- `outbox-routes.test.ts`: `tracks.activity-ready` → `['results-intake', 'social-intake']`, имя теста уточняется
  (RC-P5-1); новый тест «tracks.activity-ready — и в social-intake (автоявка, P5)».
- `modules/social/social-intake.processor.test.ts`: конструктор с двумя intake, кейсы 11.7.

### 11.4 TYPES

```ts
// tracks/activity-starts.port.ts
export interface ActivityStart {
  /** основная группы дублей (`duplicateOf ?? id`) — не входная активность */
  activityId: string;
  userId: string;
  sport: ActivitySport;
  startedAt: Date;
  /** `[lon, lat]` старта основной; наружу из social не уходит и в логи не пишется */
  startPoint: LonLat;
}
export interface ActivityStarts {
  /** Старт основной группы активности сейчас; активности или основной нет — `null`. */
  primaryStart(activityId: string): Promise<ActivityStart | null>;
}

// rides/rides-for-social.port.ts (добавление)
export interface SocialStartedRide { rideId: string; startsAt: Date; participantIds: string[] }
ridesOfParticipant(userId: string, from: Date, to: Date, now: Date): Promise<SocialRideFacts[]>; // любой статус, ≤ 20
startedRidesWithin(after: ChangedCursor, until: Date, limit: number):
  Promise<{ rides: SocialStartedRide[]; next: ChangedCursor | null }>; // только published

// social/ride-ask.port.ts
export const RIDE_ASK_DUE = Symbol('RIDE_ASK_DUE');
export interface RideAsk { rideId: string; userIds: string[] }  // userIds непуст
export interface RideAskDue { due(tx: DbSession, ask: RideAsk): Promise<void> } // в транзакции захвата

// social/social.policy.ts
export type AutoAttendanceReason = SocialBlockReason | 'no_precise_start' | 'too_late' | 'out_of_window' | 'too_far';
export function autoAttendanceCheck(
  facts: SocialRideFacts, start: Pick<ActivityStart, 'startedAt' | 'startPoint'>, userId: string, now: Date,
): AutoAttendanceReason | null;
export function rideAskRecipients(participantIds: readonly string[], entries: readonly { userId: string }[]): string[];

// social/auto-attendance-intake.ts
export type AutoAttendanceOutcome =
  'marked' | 'unchanged' | 'no_activity' | 'not_cycling' | 'user_deleted' | 'no_rides';
```

`AutoAttendanceReason` остаётся внутренним типом API (в contracts не идёт, наружу не отдаётся). `LonLat` — из
`@pokatim/contracts` (как в `rides-for-social.port.ts`).

### 11.5 Алгоритмы

**Автоявка — `AutoAttendanceIntake.handle({ activityId })`.** Читает только состояние, `userId` из payload не
используется.
1. `start = activityStarts.primaryStart(activityId)`. Нет — `no_activity`.
2. `start.sport !== 'cycling'` — `not_cycling`. Сюда попадают `cycling_indoor`, `other` и `unknown`.
3. `liveUserIds([start.userId])` не содержит владельца — `user_deleted` (RC-P5-6).
4. `now = clock.now()`; `rides = ridesOfParticipant(start.userId, startedAt − afterMs, startedAt + beforeMs, now)`.
   Это то же условие, что «старт заезда ∈ [старт райда − 30 мин; + 2 ч]», переписанное как окно по старту райда.
   Пусто — `no_rides`.
5. Для каждого райда с `autoAttendanceCheck(...) === null`, последовательно:
   `attendance.markByTrack(start.userId, ride.rideId)`. `true` — `marked += 1`. `false` — no-op: явка уже была, или
   запись с `declinedAt`. `isDomainError` со статусом 404 или 409 — `blocked` (RC-P5-5). Остальное пробрасывается.
6. Итог: `marked`, если хоть один райд дал `true`, иначе `unchanged`. Попадают сюда и случаи «все райды не прошли
   сверку», и «все — no-op». Лог процессора: `social.intake type=… event=… outcome=…`. Координат и id райдов в
   логе нет.

**`autoAttendanceCheck`, порядок проверок** (первая сработавшая — причина):
1. `attendanceCheck(facts, userId, now, 'track')` — `not_participant` / `ride_unavailable`;
2. `facts.phase !== 'past'` — `attendance_window` (RC-P5-4);
3. `preciseStart === null` — `no_precise_start`;
4. `now > startsAt + attendanceWindowMs` — `too_late`;
5. `startedAt < startsAt − beforeMs || startedAt > startsAt + afterMs` — `out_of_window`;
6. `haversineMeters({lon,lat} старта, {lon,lat} preciseStart) > radiusM` — `too_far`.

**Регламент — `RideAskSweep.run()`.**
1. `now = clock.now()`; `until = now − askAfterMs`; `from = until − askCatchUpMs`; курсор `{ at: from, id: '' }`.
2. Цикл страниц `rides.startedRidesWithin(cursor, until, askPageRows)`, пока `next ≠ null` и страница полная. Полный
   проход окна за прогон, курсор в Redis не хранится: идемпотентность держит `askedAt`.
3. На странице `asked = attendance.askedAmong(ids)` — уже спрошенные пропускаются без транзакции.
4. Для каждого оставшегося райда: `live = liveUserIds(participantIds)`, затем
   `transactions.run(tx => { if (!claimAsk(tx, rideId, now)) return null; recipients =
   rideAskRecipients(participantIds ∩ live, entriesIn(rideId, tx)); if (recipients.length) await askDue.due(tx,
   { rideId, userIds: recipients }); return recipients.length; })`.
5. Сбой райда — лог `social.ride_ask_failed ride=<id>`, остальные идут дальше. В конце — исключение, если были сбои
   (failed-набор), как в `TicketReminders.dispatchDue`. Итог `{ rides, asked, recipients, failed }`.
   Параллельные прогоны (два worker, boot + cron) безопасны: второй захват — `modifiedCount = 0` или write
   conflict → повтор → `false`.

### 11.6 FILES TO READ

`modules/social/{social-intake.processor.ts, invite-intake.ts, attendance.service.ts, attendance.repository.ts,
social.policy.ts, social.collection.ts, social.module.ts}`, `modules/tracks/{activity-source.ts,
activity-source.port.ts, tracks.events.ts, tracks.repository.ts (findActivity), tracks.collection.ts (ActivityDoc)}`,
`modules/rides/{rides-for-social.ts, rides-for-social.port.ts, rider-rides.ts (startedRidersAfter), rides.repository.ts
(findForSocial, startedWithin, pastOf)}`, `changed-since.ts`, `modules/tickets/jobs/tickets-maintenance.processor.ts`
(+ `.test.ts`), `modules/tickets/ticket-reminders.ts` (захват в транзакции + точка отправки),
`modules/standings/standings-sync.processor.ts`, `outbox-routes.ts` (+ `.test.ts`), `packages/tracks/src/geo.ts`,
`.claude/rules/pokatim-backend.md` §«Свои» и §«Очереди», `pokatim-db.md` §«Свои», `pokatim-tests.md`.

### 11.7 TESTS

Изоляция: `MONGO_URL_TEST='mongodb://127.0.0.1:27117/pokatim_social_p5_test?replicaSet=rs0&directConnection=true'`,
`REDIS_URL_TEST='redis://127.0.0.1:6479/9'`.

Готовые хелперы:
- `test/social.ts`: `riders`, `ridesAhead`, `pastRide`, `travelPast`, `socialDb`, `socialServices`;
- `test/rides.ts`: `createRide(h, organizer, { routeId })`, `join`, `hideInDb`, `ridesDb`, `setRouteStart`,
  `seedTeamRoute`;
- `test/route-rides.ts`: `catalogCorridorRoute(h, ownerId)` — маршрут каталога со стартом `CORRIDOR.line[0]`, это старт
  `clean.gpx`; `outboxJob`;
- `test/results.ts`: `rideGpx('clean.gpx', startAt, { type, power, heartRate })` — сдвиг времени; `type: 'running'` →
  не `cycling`, `power: true` — основная группы; `uploadRide(h, auth, bytes)` — загрузка и разбор; `importRide(h, userId,
  gpx, …)` — тот же заезд от Garmin, то есть дубль;
- `outboxEvents(h)` — как в `social-invites.int.test.ts`; там же форма `job(name, id)`, по ней прогоняются события
  `tracks.activity-ready` через `h.worker.get(SocialIntakeProcessor)`.

Порядок в тесте: райд создаётся в будущем (`createRide` с `routeId`), затем `travelPast`, затем загрузка.

**Unit (без БД):**
- `social.policy.test.ts`, `autoAttendanceCheck`. Каждая причина и граница: старт ровно `−30 мин` и `+2 ч` — `null`,
  `−30 мин −1 с` и `+2 ч +1 с` — `out_of_window`. Точка сдвинута на ~499 м — проходит, на ~501 м — `too_far`
  (сдвиг по широте `м / 111 195`). `now = startsAt + 7 дн` — проходит, `+1 мс` — `too_late`. `preciseStart: null`,
  `upcoming`, `cancelled`, `hidden`, не участник. `rideAskRecipients`: исключает явку, `declinedAt` и via `track`;
  порядок участников сохраняется.
- `social-intake.processor.test.ts`. `tracks.activity-ready` с валидным payload уходит в `AutoAttendanceIntake`;
  `InviteIntake` не вызван. Payload не по схеме — `skipped`, обработчики не вызваны. Неизвестное имя и `toString` —
  бросок (AC4). Бросок обработчика — лог `social.intake_failed` и проброс.
- `social-maintenance.processor.test.ts` (форма `tickets-maintenance.processor.test.ts`): `upsertJobScheduler('social.ride-ask',
  { pattern: '*/30 * * * *', tz: 'Europe/Minsk' }, …)` + boot-задача с `jobId`. Процессор: незнакомое имя — бросок.
- `outbox-routes.test.ts`: `activity-ready` → `results-intake` и `social-intake`. `identity.account-confirmed` — без
  изменений.

**Интеграционные (реальная БД):**
- `tracks/activity-starts.int.test.ts`. Одиночная активность — свой старт. Дубль (Garmin без датчиков после файла
  с `power`) — по id дубля возвращается основная. Удалённая загрузка — `null`. У порта нет параметра `userId`:
  проверить, что `userId` ответа — владелец активности.
- `rides/rides-for-social.int.test.ts` (дополнить). `ridesOfParticipant`: границы окна включительно; организатор и
  «Иду» — да, не участник — нет; отменённый и скрытый возвращаются с фазой. `startedRidesWithin`: только `published`,
  keyset по `(startsAt, _id)` (два райда с одним стартом на границе страницы), `next = null` на пустой странице.
  Отрицательное доказательство индекса: `explain('queryPlanner')` у фильтра `participantRidesBetween` — `IXSCAN`
  `rides_participant_idx`, без `COLLSCAN`.
- `social/social-auto-attendance.int.test.ts` (новый):
  - AC1: двое «Иду» на райде маршрута каталога загружают `clean.gpx` в окне. Явка обоих `via: track`, пары `ride` в
    обе стороны, `attendance-marked {via: track}` — ровно по одному на райдера.
  - AC2: по кейсу на причину. Не `cycling` (`type: 'running'`). Дубль: по событию дубля засчитывается основная, итог
    один. Вне окна: `rideGpx` со стартом `−31 мин`, `+2 ч 1 мин`. Дальше 500 м: `setRouteStart` сдвинут на ~600 м до
    создания райда. Райд без маршрута. Отменённый, скрытый (`hideInDb`). Не участник. Задача после `startsAt + 7 дн +
    1 мин` — `h.clock.advance` между загрузкой и прогоном intake. «Меня не было» до загрузки
    (`socialServices(h).attendance.unmark`). В каждом кейсе записей явки и событий `attendance-marked` нет.
  - Два подходящих райда (стартуют с разницей 1 ч, оба в окне) — явка в обоих.
  - AC3: повтор той же задачи (тот же `outboxEventId`) и новое событие той же группы (импорт дубля) — `entries`,
    связи и `product_events` не меняются.
  - RC-P5-5: райд отменён между чтением и записью. Порт подменяется `vi.spyOn(rides, 'ridesOfParticipant')` →
    устаревшие факты. Итог без броска, явки нет.
  - RC-P5-6: владелец с `deletedAt` — `user_deleted`, записи нет.
  - AC4: в том же файле или в `social-invites.int.test.ts` — приглашение P6 после изменений по-прежнему `linked`.
- `social/social-ride-ask.int.test.ts` (новый). Шпион — `vi.spyOn(h.worker.get(LoggingRideAskDue), 'due')`.
  - AC5: райд из 4 участников: явка у одного, «Меня не было» у другого, двое без записи. В `+4 ч −1 мин` вызова нет.
    В `+4 ч` — один вызов `{ rideId, userIds: [двое без записи] }`, в документе стоит `askedAt`.
  - Повтор `run()` — вызовов нет. Две `run()` параллельно (`Promise.all`) — один вызов.
  - Отменённый и скрытый — нет вызова и нет `askedAt`.
  - Догон: прогон в `+4 ч + 23 ч` — вызов. Прогон в `+4 ч + 24 ч + 1 мин` — вызова нет, `askedAt` не ставится.
  - Все явились — `askedAt` стоит, вызова нет.
  - Удалённый аккаунт (`deletedAt`) в адресаты не попадает.
  - Райд без точного старта — отбирается.
  - Явка, отмеченная после захвата, адресатов захваченного райда не меняет; ручная отметка работает как раньше
    (поле `askedAt` её не ломает).

**Отрицательные доказательства (команды в §12):**
- `pnpm arch:check` — зелёный, `social-consumers-only` не нарушен (AC6). В `modules/tracks/` и `modules/rides/` нет
  импорта `../social`: `rg "from '\.\./social" apps/api/src/modules/{tracks,rides}` — пусто.
- `git diff --stat origin/develop -- apps/api/src/modules/notifications/{notification-intake,notification-texts,notifications.policy}.ts`
  — пусто.
- `git diff --stat origin/develop -- apps/api/src/db/migrations packages/contracts apps/app` — пусто: миграций,
  контрактов и экранов нет.
- `rg "registerQueue" apps/api/src/modules/social` — один вызов. `rg "@Processor\(QUEUE.socialIntake" apps/api/src` —
  один процессор.
- `git diff origin/develop -- apps/api/src/modules/tracks/{tracks.events.ts,track-processing.processor.ts}` — пусто:
  нового события в `tracks` нет.
- `rg "haversine|asin\(" apps/api/src/modules/social` — только импорт `haversineMeters`, своей формулы нет.

### 11.8 OUT OF SCOPE

Текст и kind уведомления `social_ride_ask`, маршрут в `notifications-intake`, реальная реализация `RIDE_ASK_DUE` —
всё это P7. Снятие явки при удалении заезда и подписка на `tracks.activity-removed` (RC-P5-14). Экраны и контракты
API. Новое событие `tracks.activity-recorded`. Новые индексы и миграции. Редактирование `ActivitySource`/`ActivityRef`.
Курсор регламента в Redis. «Спасибо» (P4).

## 12. Outcome

Статус: реализовано, проверки по затронутому — зелёные; полный `pnpm check` — за оркестратором. Не закоммичено.

**Что сделано**
- `tracks`: порт `ACTIVITY_STARTS` (`activity-starts.port.ts`, `ActivityStartsService` — два чтения
  `findActivity`: активность → `duplicateOf ?? _id`), провайдер и экспорт в `TracksCoreModule`, экспорт в `index.ts`.
- `rides`: `RidesForSocial.ridesOfParticipant` (`RidesRepository.participantRidesBetween`, `rides_participant_idx`,
  ≤ 20, любой статус) и `startedRidesWithin` (поверх `startedWithin`, только `published`); общий маппер
  `socialFactsOf`.
- `social`: `socialOutboxRoutes += tracks.activity-ready`; строка таблицы `SocialIntakeProcessor` →
  `AutoAttendanceIntake`; `autoAttendanceCheck`/`rideAskRecipients` и `askCatchUpMs`/`askPageRows` в
  `social.policy.ts`; `AttendanceDoc.askedAt?`; `AttendanceRepository.claimAsk/entriesIn/askedAmong`;
  `RideAskSweep`, `SocialMaintenanceProcessor` + `SocialSchedules` (`social.ride-ask` `*/30` Минск + boot), точка
  `RIDE_ASK_DUE` с заглушкой `LoggingRideAskDue`; лог отказа intake — `social.intake_failed`.
- Комментарии `queues.ts` (RC-P5-13), ADR-0027 п. 4, `.claude/rules/pokatim-backend.md` (§«Свои», §«Очереди»),
  `.claude/rules/pokatim-db.md` (§«Свои»: `askedAt`).

**Evidence** (изоляция `pokatim_social_p5_test`, Redis db 9)
- `pnpm --filter @pokatim/api typecheck` → OK; `eslint --max-warnings=0 apps/api` → 0; `prettier --check` по
  изменённым файлам → OK.
- `pnpm arch:check` → `no dependency violations found (2489 modules, 10023 dependencies cruised)` (AC6).
- `vitest run --project unit` (apps/api) → 109 files, 1033 tests passed.
- Int + unit затронутого: `vitest run src/modules/social src/modules/tracks/activity-source.int.test.ts
  src/modules/tracks/activity-starts.int.test.ts src/modules/tracks/tracks.policy.test.ts
  src/modules/rides/rides-for-social.int.test.ts src/modules/rides/rides.policy.test.ts src/outbox-routes.test.ts
  test/harness.int.test.ts` → 19 files, 189 tests passed. В том числе: `social-auto-attendance.int.test.ts` 15 (AC1–AC3,
  RC-P5-5, RC-P5-6), `social-ride-ask.int.test.ts` 9 (AC5), `activity-starts.int.test.ts` 4,
  `rides-for-social.int.test.ts` 12 (+4: окна, фазы, keyset, explain `IXSCAN rides_participant_idx` без `COLLSCAN`),
  `social-invites.int.test.ts` — без изменений, `linked` (AC4).

**Отрицательные доказательства**
- Захват `askedAt`: условие `{ _id, askedAt: null }` заменено на `{ _id }` → тест «захват держит „один раз“ и без
  предфильтра askedAmong» красный (`expected { rides: 1, asked: 1 … } to deeply equal { rides: 0 … }`); возвращено.
- Радиус: порог `radiusM * 100` → int «дальше 500 м (~600 м)» красный; возвращено.
- `rg "from '\.\./social" apps/api/src/modules/{tracks,rides}` → пусто.
- `git diff --stat origin/develop -- …/notifications/{notification-intake,notification-texts,notifications.policy}.ts` →
  пусто.
- `git diff --stat origin/develop -- apps/api/src/db/migrations packages/contracts apps/app` → пусто.
- `rg "registerQueue" apps/api/src/modules/social` → один вызов (`{ socialIntake }, { socialMaintenance }`);
  `rg "@Processor\(QUEUE.socialIntake" apps/api/src` → один процессор.
- `git diff origin/develop -- apps/api/src/modules/tracks/{tracks.events.ts,track-processing.processor.ts}` → пусто.
- `rg "haversine|asin\(" apps/api/src/modules/social` → только импорт `haversineMeters` из `@pokatim/tracks` (и
  комментарий теста).

**Записка для P7**
- Точка привязки — `RIDE_ASK_DUE` (`apps/api/src/modules/social/ride-ask.port.ts`): `due(tx, { rideId, userIds })`
  вызывается из `RideAskSweep.ask` **в транзакции захвата** `askedAt`; `userIds` непуст, уже без явки/«Меня не было»
  и только живые аккаунты, порядок — организатор первым.
- Подменить: провайдер в `SocialWorkerModule` — `{ provide: RIDE_ASK_DUE, useExisting: LoggingRideAskDue }` на свою
  реализацию (например, outbox-событие в переданной `tx` → `notifications-intake`, kind `social_ride_ask`).
  `LoggingRideAskDue` после этого можно удалить. Сбой `due` откатывает захват — следующий прогон повторит.
- `askedAt` в P5 уже ставится: райды, прошедшие между выкатом P5 и P7, вопроса не получат (RC-P5-11, принято).
  Повтор/параллельные прогоны дублей не дают; окно догона — `SOCIAL_POLICY.askCatchUpMs` (24 ч).
- Автоявка: `social` подписан на `tracks.activity-ready` (fan-out с `results-intake`), нового события в `tracks` нет.
