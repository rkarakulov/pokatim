# «Свои», этап 0 — P2: райд (участники, явка, карточка прошедшего райда)

Уровень: task3. Эпик — [`../2026-10-31-social-stage-0/task.md`](../2026-10-31-social-stage-0/task.md) (строка P2 в
§3.2, решения RC-1…RC-16 в §8.1), продукт — `docs/product/social.md` (K2, K3, K4, K5, K12), архитектура — ADR-0027
(п. 3, 7). P0 (PR #158) уже в develop: `SocialAttendanceService` (`markManual`, `unmark`), `RIDES_FOR_SOCIAL`,
`PRODUCT_EVENTS`.

## 1. Title

Участники райда с именами, «Я был на райде» / «Меня не было», карточка прошедшего райда, источник «Иду» в метриках.

## 2. Goal

Вошедший на карточке райда видит, кто идёт (публичные профили — с именем и ссылкой), а участник прошедшего райда
подтверждает или снимает явку и видит «Ехали N». «Я иду» с карточки пишет событие `ride-joined` в журнал метрик.

## 3. Scope

1. **API, модуль `social`** (контроллеры с префиксом чужого ресурса — ADR-0027 п. 3, прецедент `riders/:publicId/me`):
   - `GET /v1/rides/:id/participants` — `AuthGuard`, `Cache-Control: no-store`. Ответ: участники «Иду» (организатор
     первым) — публичные карточкой (имя, `publicId`, аватар), остальные — числом `hiddenCount`; состояние явки
     зрителя-участника и список «Ехали N» (только если у зрителя явка).
   - «Я был на райде» и «Меня не было» — `POST` без тела, ответ — тот же `RideParticipants`. Сервис — P0
     `markManual` / `unmark` (не дублировать), ошибки — `409 SOCIAL_ACTION_BLOCKED {reason}` / `404`.
   - Видимость — как у `GET rides/:id/me`: скрытый райд — только организатору, иначе `404`.
2. **Порт `rides`** — нужные `social` данные для ответа (если `rideFacts` недостаточно — расширить порт, не читать
   коллекцию `rides` из `social`).
3. **Источник «Иду» (K12):** `POST /v1/rides/:id/join` принимает необязательное тело `{ source?: RideJoinSource }`
   (старые сборки шлют `{}` — совместимо). Новая запись с `source` → `PRODUCT_EVENTS.record({type: 'ride-joined'})`
   после основной записи, сбой — лог `product_events.record_failed type=ride-joined` без отказа (§11 эпика). Повтор
   «Я иду» и запись без `source` — без события. Карточка райда шлёт `ride_card`; `social_home`, `notification`,
   `profile` — в P3/P7.
4. **Contracts + api-client:** схемы ответа и запроса, методы клиента (`rideParticipants`, `markRideAttended`,
   `declineRideAttendance`, `joinRide(…, source?)`).
5. **Приложение, карточка райда** (`apps/app/src/features/rides/ride-detail.tsx`), все платформы:
   - **Участники (K4, решение автора 2026-10-31):** вошедшему стопка показывает аватары публичных участников; под
     ней — до 5 строк «аватар · имя → профиль `/riders/<publicId>`», затем «и ещё N» (непубличные) и «Показать всех»
     (раскрывает остальные публичные строки на месте, без нового экрана). Без `publicId` — строка без ссылки. Гость —
     только число, как сейчас.
   - **Прошедший райд для участника «Иду» / организатора (K5, решение автора 2026-10-31 — три состояния),** в окне
     явки (старт … +7 дней), не отменён и не скрыт:
     - нет отметки — баннер «Райд прошёл» с кнопкой «Я был на райде» и ссылкой «Меня не было»;
     - явка есть — блок «Ехали N» (публичные строки как у участников + «и ещё N») и ссылка «Меня не было»;
     - «не был» — строка «Вы отметили, что не были на райде» и кнопка «Я был на райде».
     После окна: явка есть — «Ехали N» без кнопок; иначе — карточка как раньше. На прошедшем райде с явкой «Ехали N»
     заменяет список участников (стопка остаётся). Не-участник — как раньше (D-65).
   - Загрузка — скелетон на месте блока; ошибка — баннер с повтором, остальная карточка видна (AGENTS §4.12);
     мутации — состояние кнопки, ошибка — текст под действием.
   - «Я иду» с карточки → `source: 'ride_card'`.
   - Тексты — `packages/i18n/src/ru.ts`.
6. **Документы:** `rides.md` (раскладка K4, три состояния K5 — решения автора), ADR-0027 п. 3 (если меняется форма
   эндпоинтов), правила `pokatim-backend.md` / `pokatim-contracts.md` / `pokatim-app.md` — по факту.

## 4. Out of Scope

«Спасибо за компанию» и «Поблагодарить всех» (P4); автоявка и «Как прошёл райд?» (P5, P7); «Свои идут» и прочие
уведомления (P1, P7); `GET riders/:publicId/social`, «В свои» (P3); «Поделиться» прошедшим райдом (нет в этапе 0);
лента «Райды» и Главная — «Я иду» оттуда события не пишет (источников нет в K12).

## 5. Architecture Context

- `apps/api`: `social` — новый контроллер, мапперы ответа; `rides` — порт (при необходимости), `join` с источником,
  зависимость `rides → product-events` (листовой, ADR-0027 п. 7); `RidesCoreModule` импортирует
  `ProductEventsCoreModule`.
- `packages/contracts` (`social/`, `rides/`), `packages/api-client`, `packages/i18n`, `apps/app`.
- Совместимость: новые поля ответа — `default`/`tolerantEnum`; тело `join` необязательное. Миграций нет (коллекции и
  индексы — P0: `ride_attendance` — один документ на райд).
- Очередей и outbox-событий нет.
- Architect (2026-10-31): `ProductEventsCoreModule` импортируется в `RidesModule`, а не в `RidesCoreModule`, потому что
  `RidesService` объявлен там (RC-5). Новый сервис `SocialRideParticipantsService` — в `SocialCoreModule`, контроллер — в `SocialModule`
  (+ `IdentityModule`). Порт `RIDES_FOR_SOCIAL` не меняется (RC-4). Новый пакет не нужен: потребитель один (`apps/api`).

## 5.1 Placement & Reuse Gate

- Переиспользуем: `SocialAttendanceService.markManual/unmark`, `attendanceCheck` / `SOCIAL_POLICY.attendanceWindowMs`
  (`social.policy.ts`) — состояние «можно отметить» считает сервер той же функцией; `RIDES_FOR_SOCIAL.rideFacts`
  (фаза — только из `rides`); `RIDER_NAMES.publicRiders` + `PublicRiderCard` (публичность K3); `AttendanceRepository`;
  `PRODUCT_EVENTS.record`; компоненты `GoingStack`, аватар райдера (как в строках таблиц), `Banner`, `Button`,
  `TextAction`, `AsyncContent`, `Skeleton*`.
- Запрещено: читать `rides`/`profiles` из `social` напрямую; вычислять фазу или окно явки на клиенте; дублировать
  логику явки в контроллере; класть данные зрителя в кэшируемый `GET rides/:id`.
- Тонкий контроллер, логика — в сервисе `social`.
- Architect (2026-10-31): лимит отметок — общий `consumeUserLimit` (`src/user-limit.ts`), ключ `social-attendance:<uid>` (RC-2);
  аватар строки — `RiderAvatar` + `riderPath` (как `RiderWho` в `features/races/table-row.tsx`); `GoingStack` — проп
  `avatarIds?`, без копии компонента; схемы ответа — `contracts/src/social/ride-participants.schema.ts` (RC-11).

## 6. Relevant Files

- `apps/api/src/modules/social/{attendance.service.ts,attendance.repository.ts,social.policy.ts,social.module.ts}`.
- `apps/api/src/modules/rides/{rides-for-social.port.ts,rides-for-social.ts,rides.controller.ts,rides.service.ts}`.
- `apps/api/src/modules/profile/rider-names.port.ts` — `publicRiders`.
- `apps/api/src/modules/profile/` — контроллер `riders/:publicId/me` (образец префикса чужого ресурса).
- `packages/contracts/src/{social/social.schema.ts,rides/ride.schema.ts}`, `packages/api-client/src/index.ts`.
- `apps/app/src/features/rides/{ride-detail.tsx,queries.ts}`, `apps/app/src/components/{going-stack.tsx,ride-going-action.tsx}`.
- `apps/app/src/__tests__/ride-detail.test.tsx`.

## 7. Implementation Notes

- `canMark` / `canDecline` — из `attendanceCheck` сервера (окно, роль, фаза); клиент показывает по флагам.
- «Ехали N» — N = все явившиеся (включая непубличных), строки — только публичные.
- Зритель-участник видит себя в списке, если его профиль публичный (как у остальных).
- Ответ мутаций — свежий `RideParticipants`; приложение кладёт его в кэш запроса участников.

## 8. Risks / Assumptions / Open Questions

- `[ASSUMPTION]` Событие `ride-joined` — только при явном `source` и только при новой записи (повтор «Я иду» — без
  события). Лента «Райды» и Главная источник не шлют.
- `[ASSUMPTION]` «Ехали N» и состояние явки видит только сам участник; не-участнику — `attendance: null`.
- `[ASSUMPTION]` На прошедшем райде с явкой «Ехали N» заменяет список участников.
- Райд до 100 участников — `publicRiders` одним запросом; порядок строк — порядок записи (организатор первым).

## 8.1 Requirements Consistency (заполняет architect)

Architect, 2026-10-31. Сверка с кодом ветки `claude/social-p2-ride-a5de72` (develop влит, `beca1db2`): P0 —
`social/{attendance.service,attendance.repository,social.policy}.ts`, `rides/{rides.service,rides.controller,
rides.module,rides-for-social}.ts`, `product-events/*`, приложение — `features/rides/{ride-detail,queries}.tsx`,
`components/{going-stack,ride-going-action,rider-avatar}.tsx`. Статус — **без блокеров**: coder можно запускать по
рекомендациям ниже. Два продуктовых вопроса (Q1, Q2) нужны до финальной вёрстки, начать работу они не мешают.

**Вопросы автору (в `social.md` ответа нет — architect их не решает):**

- **Q1. Подсказка имени K3 «на экране после райда (K5)» не попала ни в один PR.** K3 называет три места: Главная,
  свой профиль и экран после райда. В §3.2 эпика P3 берёт «подсказку имени K3 (профиль, Главная)», а в scope P2 её нет.
  Варианты: (a) в P2: строка «Добавьте имя — свои увидят вас» → «Редактировать профиль» в блоке прошедшего райда,
  когда у зрителя есть блок явки, а свой профиль не публичный. Публичность клиент берёт из своего `['profile']`
  (`publicName` + `showNameInResults`), новое поле сервера не нужно; «Не сейчас» здесь нет (в K3 оно только у Главной);
  (b) отдать в P3 вместе с остальными подсказками; (c) убрать из K3. **Рекомендация (a)**: экран и данные здесь, а
  ключ строки согласовать с P3 (общий `social.nameHint.*`, чтобы не появилось двух текстов).
- **Q2. Два разных «ехали» на одной карточке.** Сейчас подпись стопки прошедшего райда — `rides.going.past`
  («ехали 8 · вы в списке») по `goingCount`, то есть по отметкам «Иду». Новый блок «Ехали N» (K5) считает
  подтвердивших явку. Обе строки окажутся на карточке рядом («стопка остаётся»), и числа будут разные. Варианты:
  (a) подпись стопки прошедшего райда — «записались N» (новый ключ, «вы в списке» остаётся), а «Ехали N» — только
  явка; (b) скрывать подпись стопки, когда виден блок «Ехали N»; (c) оставить как есть. **Рекомендация (a)**: слово
  «ехали» после P2 значит «подтвердили явку» и везде совпадает с числом блока. Пока ответа нет, coder делает (a)
  отдельным ключом, чтобы откат был одной строкой.

**Ответы автора (2026-10-31):** Q1 — (a), подсказка имени в P2 (ключ `social.nameHint.*`, общий с P3); Q2 — (a),
подпись стопки прошедшего райда «записались N».

**Уточнения (coder идёт по рекомендации, если автор не возразит):**

- **RC-1. Видимость скрытого райда в мутациях.** P0 `SocialAttendanceService.change` на скрытом райде отвечает
  `409 ride_unavailable` участнику и `409 not_participant` чужому. Так раскрывается существование скрытого райда, а
  правило rides (`pokatim-security.md`: hidden — 404 всем, кроме организатора) и spec §3.1 требуют `404`. Варианты:
  (a) новый сервис P2 сам проверяет видимость до вызова P0 (`rideFacts` → нет райда, или `phase === 'hidden'` и зритель
  не организатор → `404`), затем вызывает `markManual`/`unmark` без изменений: второе чтение `rideFacts` дешёвое, P0
  и будущий `markByTrack` (P5) не меняются; (b) перенести проверку в `change` P0 — тогда она затронет и путь трека P5;
  (c) оставить 409. **Рекомендация (a).** Организатор скрытого райда по-прежнему получает `409 ride_unavailable`
  (RC-15 эпика).
- **RC-2. Лимит частоты на отметки.** В P0 у `markManual`/`unmark` лимита нет, а каждая отметка — транзакция с
  пересчётом до n(n−1) пар связей (райд до 100 участников). Готового лимитера в `social` нет. Лимит «Я иду» —
  `rides-rsvp:<uid>` 60/ч в приватном `RidesService.limit`. Варианты: (a) свой ключ `social-attendance:<uid>`, 60/ч
  (`SOCIAL_POLICY.attendanceLimit`), общий для «Я был» и «Меня не было», через общий `consumeUserLimit`
  (`src/user-limit.ts`, как `social-manual`). Проверка — первой, на каждую попытку (404 тоже тратит квоту, как у
  `profile-report`); (b) общий бюджет с `rides-rsvp` — `social` писал бы в пространство ключей `rides`, а «Я иду» и
  явка конкурировали бы за одну квоту; (c) без лимита. **Рекомендация (a).** На `GET participants` лимита нет, как и
  на `GET rides/:id/me`.
- **RC-3. Как считаются `canMark` / `canDecline`.** Обе формулы — от одной проверки P0
  `check = attendanceCheck(facts, viewerId, now)` (`via: 'manual'`): `canMark = check === null && state !==
  'attended'`, `canDecline = check === null && state !== 'declined'`. Получается три состояния K5: `none` — обе
  `true` («Я был» и «Меня не было»), `attended` — только «Меня не было», `declined` — только «Я был». До старта, после
  +7 дней, у `cancelled` и `hidden` обе `false`. Клиент окно и фазу не вычисляет. Окно закрылось при открытой
  карточке — сервер ответит 409, клиент перечитает участников (RC-9).
- **RC-4. Порт `RIDES_FOR_SOCIAL` расширять не нужно.** `rideFacts` уже отдаёт фазу, организатора, участников в
  порядке записи (организатор первым) и старт — этого хватает и для ответа, и для видимости. Порядок строк «Ехали N» —
  порядок `participantIds`, отфильтрованный по явке (организатор первым), а не порядок записей явки. Пакетный метод
  портов «участники пачкой» (комментарий порта) в P2 не нужен — убрать упоминание P2 из комментария.
- **RC-5. Где подключать `product-events` в `rides`.** `RidesService` объявлен в `RidesModule`, не в
  `RidesCoreModule`. В Nest импорт не передаётся транзитивно, поэтому вариант spec §5 («`RidesCoreModule` импортирует
  `ProductEventsCoreModule`») заработает, только если ядро ещё и реэкспортирует модуль. **Решение:**
  `RidesModule.imports += ProductEventsCoreModule` (единственный потребитель — `RidesService`), ядро не трогаем.
  dependency-cruiser ребро `rides → product-events` разрешает (`product-events-leaf` ограничивает только исходящие
  из `product-events`; `social-consumers-only` не затронуто).
- **RC-6. Когда писать событие `ride-joined`.** Комментарий P0 §11 («`join` — одна атомарная операция») устарел:
  `join` идёт через `writeWithEvent`, то есть транзакцию с outbox `rides.participant-joined`. Писать событие внутри
  этой транзакции нельзя: сбой журнала откатил бы «Я иду» (нарушение AC4). **Решение:** после коммита, только при
  `joined !== null` (новая запись) и заданном `source`; квотная ветка, идемпотентный повтор и запись без `source` —
  без события. Сбой — `try/catch`, `logger.warn('product_events.record_failed type=ride-joined ride=<id> uid=<uid>
  error=<имя класса>')`, ответ 200. Событие по `rides.participant-joined` через outbox не нужно: `props` маленькие,
  потеря события при падении процесса — принятый риск метрик.
- **RC-7. Тело `join` и совместимость.** Схема запроса — `JoinRideRequest = z.strictObject({ source:
  RideJoinSource.optional() })`, в контроллере — `ZodValidationPipe(JoinRideRequest.optional())`, `body ?? {}` (образец
  — `calendar-registration.controller.ts`). Старые сборки шлют `{}` — проходит; запрос без тела — проходит;
  незнакомый `source` или лишний ключ — `400 VALIDATION_FAILED`: запросы строгие (`pokatim-contracts.md`), а новые
  значения справочника появляются в API раньше клиентов. Новая сборка со старым API: тело старый API игнорирует —
  совместимо. Комментарий контроллера «Я иду / Не иду — без тела» поправить.
- **RC-8. Раскладка «и ещё N» / «Показать всех» (K4) недоопределена.** Порядок по spec: до 5 публичных строк →
  «и ещё N» (непубличные) → «Показать всех». **Решение:** «и ещё N» = `hiddenCount`; строка видна при N > 0 и после
  раскрытия не меняется. Если зритель сам непубличный, он входит в N (K3). «Показать всех» — только при числе
  публичных строк больше 5; нажатие раскрывает остальные строки на месте, и кнопка пропадает. Блок «Ехали N» —
  тот же компонент с тем же сворачиванием; N = `riders.length + hiddenCount`.
- **RC-9. Кэш и инвалидация.** Ключ — `['rides','detail',id,'participants']`, под префиксом `['rides']`: «Я иду» /
  «Не иду» (`applyRideView`) уже инвалидируют `['rides']`, и список участников обновится сам. Мутации явки —
  `setQueryData` ответа без префиксной инвалидации `['rides']` (райд не меняется). Ответ `409
  SOCIAL_ACTION_BLOCKED` или `404` — `invalidateQueries` ключа участников (флаги устарели). Кэш «вместе ехали» в P3
  (`riders/:publicId/social`) — согласовать с P3: инвалидировать его префикс после явки, когда ключ появится.
- **RC-10. Блок явки на клиенте — только при `ride.phase === 'past'`.** Фаза приходит с сервера. У скрытого
  (организатору) и отменённого райда блока явки нет (карточка «без действий», 05b), даже если `state === 'attended'`.
  Список участников организатор скрытого райда видит.
- **RC-11. Конфликты с параллельными PR.** Схемы ответа — отдельным файлом `contracts/src/social/
  ride-participants.schema.ts`: в `social.schema.ts` P3 добавляет свои DTO, и общий файл дал бы конфликт. Новые
  методы api-client и ключи i18n — в конец. `joinRide(…, source?)` меняет существующую сигнатуру. P3 («Я иду» из
  профиля, `source: 'profile'`) должен взять её отсюда, а не добавлять свою — **P3 сливать после P2 или ребейзить на
  P2**.
- **RC-12. «Меня не было» без подтверждения.** Действие обратимо («Я был на райде» в том же окне), поэтому — ссылка
  `TextAction` без диалога, как в spec. Связи пересчитываются сразу (P0).

Противоречий spec с инвариантами `AGENTS.md` §4 не найдено: авторитет сервера (флаги, фаза, окно), `userId` наружу не
выходит, данные зрителя не попадают в кэшируемый `GET rides/:id`, новых коллекций и миграций нет, очередей нет.

## 8.2 Deviations from spec

- Coder (2026-10-31): Q1 — ключи подсказки по согласованию с P3: `social.nameHint.title` / `.action` («Добавить имя»
  → `/settings/profile`) / `.later` (в P2 не используется, добавлен для совпадения набора). Подсказка видна, когда
  у зрителя есть блок явки (в окне — кнопки, после окна — «Ехали N») и `['profile']` загружен и не публичен; пока
  профиль грузится — подсказки нет.
- Coder: ошибка участников без данных — свой `Banner warning` + `TextAction` «Повторить» до `AsyncContent` (как
  `viewerFailed` карточки): `AsyncContent` базы рисует на этом месте полноэкранный `EmptyState`.
- Coder: строка участника всегда с `RiderAvatar` (без фото — иконка), в отличие от `RiderWho`, где аватар только при
  `publicId` — по spec «аватар · имя» у каждой строки.
- Coder: `pr.md` не создан — шаг FINISH оркестратора (совместимость тела `join`, эндпоинты, порядок слияния с P3 —
  в §12).

## 8.3 Security checklist

AuthN — `AuthGuard` на всех трёх эндпоинтах. AuthZ — явка только своя (`userId` из access); видимость скрытого —
организатор. Данные наружу — только публичные карточки (K3), без `userId`; непубличные — числом. Злоупотребления —
лимит частоты на отметки явки (уточнит architect: общий лимитер, как у «Я иду» 60/ч). Логи — без имён.

## 9. Acceptance Criteria

1. `GET rides/:id/participants`: организатор первым; публичные — карточкой, непубличные — в `hiddenCount`; гость —
   `401`; скрытый райд не-организатору и неизвестный — `404`; `no-store`; `userId` в ответе нет.
2. Состояние явки: не-участнику — `null`; участнику — `none | attended | declined`, `canMark`/`canDecline` по окну
   (старт −1 мс, старт, +7 дн, +7 дн +1 мс), фазам `cancelled`/`hidden` — `false`; «Ехали N» — только при явке.
3. «Я был» / «Меня не было» — через P0-сервис; отказы `409 SOCIAL_ACTION_BLOCKED` с причиной; повтор идемпотентен;
   связи `ride` пересчитаны (int-тест: после «Я был» двоих — пара есть, после «Меня не было» — нет).
4. `join` с `source` — одно событие `ride-joined {source}`; повтор, без `source`, сбой журнала — без отказа и без
   второго события; старое тело `{}` работает.
5. Приложение: стопка с аватарами, до 5 строк + «и ещё N» + «Показать всех»; гость — только число; три состояния
   прошедшего райда и «после окна»; ошибки и скелетон; «Я иду» шлёт `ride_card` (тесты `ride-detail.test.tsx`).
6. Contracts/api-client: схемы с тестами, методы клиента с тестами.
7. `pnpm check` зелёный; `pnpm arch:check` — `social` → `rides` только через `index.ts`, производители о `social` не
   знают.

## 10. Documentation Impact

`docs/product/rides.md` (K4, K5 — решения автора 2026-10-31), ADR-0027 п. 3 — по факту, правила зон по факту,
`pr.md` (совместимость тела `join`, новые эндпоинты).

Architect (2026-10-31), дополнительно:
- `docs/product/rides.md` «Участие» / «После райда»: раскладка K4 (стопка с аватарами, 5 строк, «и ещё N», «Показать
  всех» — RC-8), три состояния K5 и «после окна»; подпись стопки прошедшего райда (Q2); подсказка имени (Q1 — по
  ответу); «Ехали N» заменяет список участников.
- `docs/product/social.md` K3 — где показывается подсказка после райда (Q1); K4/K5 — ссылка на раскладку в
  `rides.md`.
- ADR-0027 п. 3: эндпоинты `GET rides/:id/participants`, `POST rides/:id/attendance`, `POST rides/:id/attendance/decline`
  (`social`, `AuthGuard`, `no-store`; скрытый не-организатору — 404, RC-1); п. 7: `rides` пишет `ride-joined` после
  коммита `join`, сбой — лог без отказа (RC-6).
- `.claude/rules/pokatim-backend.md`: «Свои» — `RideParticipantsController` / `SocialRideParticipantsService` (в
  `SocialCoreModule`), лимит `social-attendance:<uid>` 60/ч, видимость до вызова P0 (RC-1); «Кофе-райды» — `join` с
  `JoinRideRequest`, событие `ride-joined`; список зависимостей `rides → identity, routes, media, panel,
  product-events` (RC-5).
- `.claude/rules/pokatim-security.md` «Кофе-райды»: `rides/:id/participants|attendance*` — `AuthGuard`, `no-store`,
  наружу только публичные карточки (`RIDER_NAMES.publicRiders`) и числа, без `userId`; лимит `social-attendance`
  60/ч.
- `.claude/rules/pokatim-contracts.md`: `src/social/ride-participants.schema.ts` (`RIDE_ATTENDANCE_STATES` — только в
  конец, `tolerantEnum`; поля ответа — `.default`), `JoinRideRequest` (`strictObject`, `source?`); api-client —
  `rideParticipants`, `markRideAttended`, `declineRideAttendance`, `joinRide(token, id, source?)`.
- `.claude/rules/pokatim-app.md` «Кофе-райды»: ключ `['rides','detail',id,'participants']` (только вошедшему, только
  клиент), мутации явки — `setQueryData` без инвалидации `['rides']`, 409/404 — перечитать (RC-9); блок явки —
  только `phase === 'past'` и по флагам сервера (RC-10); «Я иду» с карточки — `source: 'ride_card'`, лента и
  Главная — без `source`; строка «Оболочка» про `GoingStack` («имён нет») — аватары публичных участников.
- `pr.md`: новые эндпоинты; совместимость тела `join` (старые сборки `{}` / без тела, новая сборка со старым API —
  тело игнорируется); миграций нет; порядок слияния с P3 (RC-11).

## 11. Implementation Context

Architect, 2026-10-31. Учитывает RC-1…RC-12; если автор ответит на Q1/Q2 иначе, меняются только тексты и строка
подсказки.

**ENTRY POINTS**
- `GET /v1/rides/:id/participants`, `POST /v1/rides/:id/attendance` («Я был на райде»), `POST
  /v1/rides/:id/attendance/decline` («Меня не было») → `RideParticipantsController` (`social`) →
  `SocialRideParticipantsService.{view, mark, decline}`. Пути — конвенция проекта «ресурс + глагол-суффикс POST»
  (`registration` / `registration/cancel`, `photo/delete`); тела нет (как `join`/`leave`), api-client шлёт `{}`.
- `POST /v1/rides/:id/join` → `RidesController.join(user, id, body)` → `RidesService.join(userId, id, source?)`.
- Приложение: `RideDetailView` (`features/rides/ride-detail.tsx`).

**FILES TO CREATE**
- `apps/api/src/modules/social/ride-participants.controller.ts` — `@Controller('rides')`, `@UseGuards(AuthGuard)`
  (из `../identity`), `idPipe = new ZodValidationPipe(Uuid, FieldErrorCode)`. Методы: `@Get(':id/participants')
  @Header('Cache-Control','no-store')`, `@Post(':id/attendance') @HttpCode(200) @Header no-store`,
  `@Post(':id/attendance/decline')` (так же). Контроллер тонкий, пользователь — `@CurrentUser()`. Образцы:
  `profile/rider-reports.controller.ts` (префикс чужого ресурса), `sharing/ride-invite.controller.ts` (`rides`
  из другого модуля). С `rides/:id` (публичный, один сегмент) и `rides/:id/me` пути не пересекаются, поэтому порядок
  регистрации модулей не важен.
- `apps/api/src/modules/social/ride-participants.service.ts` — `SocialRideParticipantsService` (провайдер и export
  `SocialCoreModule`: P4 вернёт тот же ответ после «спасибо»). Зависимости: `RIDES_FOR_SOCIAL`, `RIDER_NAMES`
  (`../profile`), `AttendanceRepository`, `SocialAttendanceService`, `RateLimiter` (`@rkarakulov/api-kit/core`,
  глобальный, как в `rides.service.ts`), `CLOCK`.
  - `view(viewerId, rideId)`: `rideFacts(rideId, now)` → `visible(facts, viewerId)` (нет → `404`) →
    `entriesOf(rideId)` → `publicRiders(participantIds)` (одним вызовом: в карте есть все явившиеся, ведь они
    подмножество участников) → `rideParticipantsView(...)`.
  - `mark` / `decline(viewerId, rideId)`: `consumeUserLimit(rateLimiter, \`social-attendance:${viewerId}\`,
    SOCIAL_POLICY.attendanceLimit, now)` **первым** → `rideFacts` + `visible` (404, RC-1) →
    `attendance.markManual` / `unmark` (P0, ошибки 409 — как есть) → лог `social.attendance action=mark|decline
    ride=<id> uid=<uid> changed=<bool>` → `view(viewerId, rideId)` (свежий ответ).
  - `visible(facts, viewerId)` = `facts !== null && (facts.phase !== 'hidden' || facts.organizerUserId ===
    viewerId)` — как `visibleTo` в `rides.policy`; копировать не нужно, фаза уже в фактах.
- `apps/api/src/modules/social/ride-participants.view.ts` + `ride-participants.view.test.ts` — чистая
  `rideParticipantsView(facts, entries, cards: Map<string, PublicRiderCard>, viewerId, now): RideParticipants`.
  Строки — явный список полей `{ name, publicId, avatar }` из карточки (`avatarId` → `{ id } | null`), `userId` нет.
  `riders` — публичные участники в порядке `participantIds`, `hiddenCount = participantIds.length − riders.length`.
  `attendance = participantIds.includes(viewerId) ? {...} : null`; `state` — по записи зрителя: нет → `none`,
  `declinedAt === null` → `attended`, иначе `declined`; флаги — RC-3 через `attendanceCheck`; `attended` — только при
  `state === 'attended'`: явившиеся (`declinedAt === null`) в порядке `participantIds`, публичные — строками, прочие —
  `hiddenCount`.
- `apps/api/src/modules/social/ride-participants.int.test.ts`; `apps/api/src/modules/rides/rides-join-source.int.test.ts`.
- `packages/contracts/src/social/ride-participants.schema.ts` + `ride-participants.schema.test.ts` (RC-11).
- `apps/app/src/features/rides/participants-queries.ts` — ключ, `useRideParticipants`, `useRideAttendance`,
  `attendanceErrorText`.
- `apps/app/src/features/rides/ride-rider-list.tsx` — `RideRiderList({ group, collapsedRows = 5 })`: строки «аватар ·
  имя», «и ещё N», «Показать всех» (RC-8). Строка с `publicId` — `Pressable` `accessibilityRole="link"` →
  `router.push(riderPath(publicId))` (`features/riders/queries.ts`), без `publicId` — `View`. Аватар — `RiderAvatar`
  (`components/rider-avatar.tsx`) `dimension={size.avatarStack} decorative`. Образец — `RiderWho` / `rowLink` в
  `features/races/table-row.tsx`.
- `apps/app/src/features/rides/ride-participants-block.tsx` — `RideParticipantsBlock({ ride, query, attendance })`:
  `AsyncContent` (скелетон — `SkeletonText` 3 строки на месте блока; ошибка без данных — `Banner tone="warning"` +
  `TextAction` «Повторить», остальная карточка видна, §4.12). Внутри — список участников или «Ехали N» и блок явки:

  | Условие (`ride.phase === 'past'`, `attendance !== null`) | Показ |
  |---|---|
  | `state: none`, `canMark` | список участников; `Banner` «Райд прошёл» + `Button` «Я был на райде» + `TextAction` «Меня не было» |
  | `state: attended` | «Ехали N» (`RideRiderList` по `attendance.attended`) вместо списка; `canDecline` — `TextAction` «Меня не было» |
  | `state: declined`, `canMark` | список участников; строка «Вы отметили, что не были на райде» + `Button` «Я был на райде» |
  | `none`/`declined` без флагов, `'unknown'`, не участник, не `past` | только список участников (как раньше, D-65) |

  Мутация — `loading` у нажатой кнопки, ошибка — текст `Banner` под действием (`attendanceErrorText`). Q1 —
  строка подсказки имени, если автор примет (a).
- App-тесты: см. TESTS.

**FILES TO MODIFY** (в общих файлах — только добавления в конец списков)
- `apps/api/src/modules/social/social.module.ts` — `SocialCoreModule`: `providers`/`exports` +=
  `SocialRideParticipantsService`. `SocialModule`: `imports: [SocialCoreModule, IdentityModule]`, `controllers:
  [RideParticipantsController]`.
- `apps/api/src/modules/social/social.policy.ts` — `SOCIAL_POLICY.attendanceLimit: { limit: 60, windowSec: 3600 }`
  (с комментарием про ключ `social-attendance:<uid>`).
- `apps/api/src/modules/social/attendance.repository.ts` — `entriesOf(rideId): Promise<AttendanceEntry[]>` (чтение
  без сессии, нет документа → `[]`; `declinedAt ?? null`, как в `attendees`).
- `apps/api/src/modules/rides/rides.controller.ts` — `join(@CurrentUser() user, @Param('id', idPipe) id,
  @Body(new ZodValidationPipe(JoinRideRequest.optional(), FieldErrorCode)) body: JoinRideRequest | undefined)` →
  `this.rides.join(user.userId, id, body?.source)`; комментарий класса — «`join` — необязательный `{ source }`
  (K12)».
- `apps/api/src/modules/rides/rides.service.ts` — `join(userId, id, source?: RideJoinSource)`: после
  `if (joined)` и до `return` — `if (source) await this.recordJoined(userId, id, source)`. Приватный `recordJoined`
  оборачивает `events.record({ type: 'ride-joined', userId, props: { source } })` (без `session`) в `try/catch`
  (RC-6). Конструктор — `@Inject(PRODUCT_EVENTS) private readonly events: ProductEvents` (из `../product-events`).
- `apps/api/src/modules/rides/rides.module.ts` — `RidesModule.imports += ProductEventsCoreModule` (RC-5).
- `apps/api/src/modules/rides/rides-for-social.port.ts` — комментарий без «участники пачкой — P2» (RC-4).
- `packages/contracts/src/rides/ride.schema.ts` — `JoinRideRequest` рядом с `CancelRideRequest` (импорт
  `RideJoinSource` из `../social/social.schema.ts`; обратного импорта нет — цикла нет); тест — в
  `ride.schema.test.ts`.
- `packages/contracts/src/index.ts` — `export * from './social/ride-participants.schema.ts';` в конец.
- `packages/api-client/src/index.ts` — `joinRide(accessToken, id, source?: RideJoinSource)` → тело `source ? {
  source } : {}`; новые методы — в конец объекта клиента:
  ```ts
  /** Участники райда (вошедшему, `no-store`): публичные — карточкой, остальные числом; явка зрителя. */
  rideParticipants: (accessToken: string, id: string) =>
    request(`/v1/rides/${encodeURIComponent(id)}/participants`, RideParticipants,
      authorized(accessToken, { method: 'GET', ...withCredentials })),
  /** «Я был на райде» (идемпотентно); отказ — 409 `SOCIAL_ACTION_BLOCKED { reason }`, 404, 429. */
  markRideAttended: (accessToken: string, id: string) =>
    postAuthorized(accessToken, `/v1/rides/${encodeURIComponent(id)}/attendance`, RideParticipants, {}),
  /** «Меня не было» (идемпотентно); отказы — как у `markRideAttended`. */
  declineRideAttendance: (accessToken: string, id: string) =>
    postAuthorized(accessToken, `/v1/rides/${encodeURIComponent(id)}/attendance/decline`, RideParticipants, {}),
  ```
- `apps/app/src/features/rides/queries.ts` — `useRideRsvp(id, source?: RideJoinSource)`: `join` →
  `source ? api.joinRide(token, id, source) : api.joinRide(token, id)`. Лента и Главная (`going-action.tsx`) вызывают
  без `source`, и проверка `home.test.tsx` (`toHaveBeenCalledWith(token, id)`) остаётся.
- `apps/app/src/features/rides/ride-detail.tsx` — `useRideRsvp(ride.id, 'ride_card')`; вошедшему
  `useRideParticipants(ride.id, signedIn && viewer !== undefined)`; `GoingStack` получает `avatarIds` из
  `participants.data?.riders`; под стопкой — `RideParticipantsBlock`. Гость — как сейчас (только число, запроса нет).
  Pull-to-refresh: в `refetchers` вошедшего добавить `participants.refetch`.
- `apps/app/src/components/going-stack.tsx` — необязательный проп `avatarIds?: readonly (string | null)[]`: первые
  квадраты (≤ `MAX_AVATARS`) — `RiderAvatar` (`decorative`, кольцо и нахлёст — как сейчас), остальные — иконка;
  без пропа — как сейчас (лента, Главная). Комментарий «Имён и фото у идущих нет» поправить.
- `apps/app/src/features/rides/format.ts` — подпись прошедшего райда по Q2 (a): новый ключ `rides.going.pastJoined`
  вместо `rides.going.past` в `goingCaption`; старый ключ не удалять до ответа автора.
- `packages/i18n/src/ru.ts` — в конец объекта:
  `rides.participants.more` (plural: «и ещё {count}»), `rides.participants.showAll` «Показать всех»,
  `rides.participants.failed` «Не удалось загрузить участников», `rides.participants.profileA11y` «{name}, профиль
  райдера», `rides.attendance.pastTitle` «Райд прошёл», `rides.attendance.mark` «Я был на райде»,
  `rides.attendance.decline` «Меня не было», `rides.attendance.declined` «Вы отметили, что не были на райде»,
  `rides.attendance.rode` (plural: «Ехал {count}» / «Ехали {count}»), `rides.attendance.error.not_participant`
  «Отметить явку могут только участники райда», `…error.attendance_window` «Отметить явку можно с начала райда и 7
  дней после», `…error.ride_unavailable` «Райд отменён или скрыт — отметка недоступна», `…error.unknown` «Не удалось
  сохранить отметку», `rides.going.pastJoined` (plural: «записался {count}» / «записались {count}», Q2). 429 —
  `rides.error.rateLimited`, сеть — `rides.error.network`, 404 — `rides.detail.notFound`.
- `apps/app/src/__tests__/ride-detail.test.tsx` — в общий `beforeEach` — мок `rideParticipants` по умолчанию
  (пустой ответ: `riders: []`, `hiddenCount` = `goingCount` фикстуры, `attendance: null`), иначе существующие тесты получат
  баннер ошибки; проверку «Я иду» (строка ~220) — на `toHaveBeenCalledWith(token, id, 'ride_card')`.

**FILES TO READ (образцы)**
- `social/attendance.service.ts`, `social/social.policy.ts` (`attendanceCheck`, `socialBlocked`) — P0, не
  дублировать.
- `profile/rider-reports.controller.ts` — `AuthGuard` + `no-store` на префиксе чужого ресурса.
- `tickets/calendar-registration.controller.ts:55` — необязательное тело `Schema.optional()` + `body ?? {}`.
- `rides/rides.service.ts:231` (`join`, `writeWithEvent`), `rides/rides-feed.service.ts` (`me`, `visibleTo`).
- `user-limit.ts`, `social/connections.service.ts` — `consumeUserLimit` в `social`.
- `profile/rider-names.port.ts` (`PublicRiderCard`, `riderRowFields`) — карточки без `userId`.
- `contracts/src/profile/rider-avatar.schema.ts` (`RiderPublicId`, `AvatarId`, `RiderRowLink`),
  `contracts/src/social/social.schema.ts` (`SocialActionBlockedDetails`).
- App: `features/races/table-row.tsx` (строка-ссылка с аватаром), `components/rider-avatar.tsx`,
  `features/rides/queries.ts` (`applyRideView`, `rideActionErrorText`), `features/routes/route-detail.tsx` (блок
  зрителя через `AsyncContent` с повтором).
- Тесты: `apps/api/test/social.ts` (`riders`, `pastRide`, `travelPast`, `socialDb`), `test/profiles.ts`
  (`publicRider`), `test/results.ts:201` (`signIn` — новый access после сдвига часов: токены `rider()` после
  `travelPast` истекают), `social/social-attendance.int.test.ts`.

**TYPES & SCHEMAS**

`packages/contracts/src/social/ride-participants.schema.ts`:
```ts
import { z } from 'zod';

import { tolerantEnum } from '../common.ts';
import { AvatarId, RiderPublicId } from '../profile/rider-avatar.schema.ts';

/** Явка зрителя на райде (K5): нет отметки, был, «Меня не было». Только в конец. */
export const RIDE_ATTENDANCE_STATES = ['none', 'attended', 'declined'] as const;

/** Публичный участник (K3, K4): имя, ссылка на профиль и фото — только при имени и согласии; без `userId`. */
export const RideRiderRow = z.object({
  name: z.string(),
  publicId: RiderPublicId.nullable().default(null),
  avatar: z.object({ id: AvatarId }).nullable().default(null),
});
export type RideRiderRow = z.infer<typeof RideRiderRow>;

/** Публичные строки (порядок сервера, организатор первым) и число непубличных («и ещё N»). */
export const RideRiderGroup = z.object({
  riders: z.array(RideRiderRow),
  hiddenCount: z.number().int().min(0),
});
export type RideRiderGroup = z.infer<typeof RideRiderGroup>;

/** Явка зрителя-участника; флаги — `attendanceCheck` сервера (окно, роль, фаза). `attended` — «Ехали N», только при явке. */
export const RideAttendance = z.object({
  state: tolerantEnum(RIDE_ATTENDANCE_STATES),
  canMark: z.boolean().default(false),
  canDecline: z.boolean().default(false),
  attended: RideRiderGroup.nullable().default(null),
});
export type RideAttendance = z.infer<typeof RideAttendance>;

/** `GET /v1/rides/:id/participants` и ответ «Я был» / «Меня не было». Не участнику — `attendance: null`. */
export const RideParticipants = RideRiderGroup.extend({
  attendance: RideAttendance.nullable().default(null),
});
export type RideParticipants = z.infer<typeof RideParticipants>;
```
`state: 'unknown'` (новый сервер) — клиент показывает только список (нейтрально). N «Ехали» = `attended.riders.length
+ attended.hiddenCount`.

`packages/contracts/src/rides/ride.schema.ts`:
```ts
/** Тело `POST /v1/rides/:id/join` (K12): откуда нажато «Я иду»; старые сборки шлют `{}`. Запрос — строгий. */
export const JoinRideRequest = z.strictObject({ source: RideJoinSource.optional() });
export type JoinRideRequest = z.infer<typeof JoinRideRequest>;
```

Порт `RIDES_FOR_SOCIAL` — **без изменений** (RC-4). `PRODUCT_EVENTS.record` — без изменений (`ride-joined` уже в
справочнике `product-events.types.ts`).

Коды ответов: `401` (гость), `400 VALIDATION_FAILED` (id не `Uuid`; у `join` — незнакомый `source` или лишний ключ),
`404 NOT_FOUND` (нет райда; скрытый — не организатору), `409 SOCIAL_ACTION_BLOCKED { reason: not_participant |
attendance_window | ride_unavailable }`, `429 RATE_LIMITED`. Ответы — `200` с `RideParticipants`.

Алгоритм `join` (без изменения порядка P0): лимит `rides-rsvp` → квота → `writeWithEvent` → `joined` → **`source` есть
— `recordJoined`** → `viewOf`. Квотная и идемпотентная ветки события не пишут.

Кэш приложения (TanStack Query, `participants-queries.ts`):
```ts
export const rideParticipantsKey = (id: string) => ['rides', 'detail', id, 'participants'] as const;
// useQuery: withAccessToken(api.rideParticipants), staleTime: DEFAULT_STALE_MS, enabled — вошедший и `me` загружен
// useMutation('mark' | 'decline'): networkMode 'always'; onSuccess — setQueryData(rideParticipantsKey(id), data);
// onError — SOCIAL_ACTION_BLOCKED / NOT_FOUND → invalidateQueries({ queryKey: rideParticipantsKey(id) })
```
`attendanceErrorText(error)`: сеть → `rides.error.network`; `RATE_LIMITED` → `rides.error.rateLimited` (`retryAfterSec`);
`NOT_FOUND` → `rides.detail.notFound`; `SOCIAL_ACTION_BLOCKED` → `SocialActionBlockedDetails.safeParse(details)` →
`rides.attendance.error.<reason>` (`'unknown'`, `self`, `not_attended` — `…error.unknown`).

**TESTS**

Unit:
- `social/ride-participants.view.test.ts` — организатор первым; публичные строками, прочие в `hiddenCount`; ключи
  строки ровно `name, publicId, avatar` (нет `userId`); строка без `publicId` (`null`); не участник — `attendance: null`;
  матрица `none | attended | declined` × флаги RC-3; окно: старт −1 мс (обе `false`), старт, +7 дн (`true`), +7 дн
  +1 мс (`false`); `cancelled` / `hidden` — `false`; `attended` только при явке; порядок «Ехали» — по участникам, не по
  записям явки; N учитывает непубличных.
- `social.policy.test.ts` — `attendanceLimit` (60/3600).
- Contracts: `ride-participants.schema.test.ts` — старый ответ без `attendance` → `null`; без `publicId`/`avatar` →
  `null`; незнакомый `state` → `'unknown'`; `ride.schema.test.ts` — `JoinRideRequest`: `{}` и `{ source: 'ride_card' }`
  проходят, незнакомый `source` и лишний ключ — нет.
- api-client (`rides.test.ts`): `joinRide` без `source` шлёт `{}`, с `source` — `{ source }`; `rideParticipants`
  (GET, Bearer), `markRideAttended`, `declineRideAttendance` (POST, путь, разбор `RideParticipants`).

Int на реальном MongoDB (`createHarness()`, HTTP через `call`/`authed`; после `travelPast` — новый access через
`signIn`-хелпер, как `test/results.ts:201`):
- `social/ride-participants.int.test.ts`:
  - гость — `401` на всех трёх; невалидный id — `400`; неизвестный — `404`; скрытый: участнику и чужому — `404`
    (GET и оба POST), организатору — `200`, его POST — `409 ride_unavailable`; заголовок `no-store`;
  - публичные (`publicRider`) и непубличные: организатор первым, `hiddenCount`; в JSON ответа нет ни одного `userId`
    (поиск строкой);
  - не участник — `attendance: null`, POST — `409 not_participant`; будущий райд — `409 attendance_window`;
    отменённый — `409 ride_unavailable`; границы окна через `h.clock` (+7 дн — `200`, +7 дн +1 мс — `409`);
  - «Я был» → `state: attended`, `attended` с N; повтор — тот же ответ, событие `attendance-marked` одно; «Меня не
    было» → `declined`, «Я был» снова → `attended`;
  - связи (AC3): «Я был» A и B → пары A→B и B→A есть (`socialDb(h).connections`); «Меня не было» A → пар нет;
  - лимит: 60 нажатий проходят, 61-е → `429` (в сумме `attendance` + `decline`, ключ по `uid`).
- `rides/rides-join-source.int.test.ts`: `{ source: 'ride_card' }` → одно событие `ride-joined { source }`
  (`socialDb(h).events`); повтор — по-прежнему одно; без `source` (`{}` и без тела) — `200`, событий нет; незнакомый
  `source` → `400`; сбой журнала (`vi.spyOn(h.app.get(PRODUCT_EVENTS, { strict: false }), 'record').mockRejectedValueOnce(...)`) — `200`,
  участник записан, в логе `product_events.record_failed type=ride-joined`; квотная ветка (уже участник при
  исчерпанной квоте) — без события.
- `pnpm arch:check` — зелёный; отрицательная проверка (временный deep import `rides → product-events/
  product-events.service`) — красная (`api-module-public-api-only`), результат — в §12.

App (jest, `ride-detail.test.tsx`, новый `describe('участники и явка (P2)')`):
- вошедший: стопка с фото публичных (`rider-avatar-photo`), 5 строк, «и ещё N», «Показать всех» раскрывает
  остальные и пропадает; строка с `publicId` ведёт на `/riders/<id>`, без — не нажимается; гость — без запроса
  `rideParticipants`, только число;
- скелетон пока грузится; ошибка — баннер с «Повторить», остальная карточка (название, «Поделиться») видна;
- прошедший: `none` + `canMark` — «Райд прошёл», «Я был на райде», «Меня не было»; `attended` — «Ехали N» вместо
  списка, «Меня не было» при `canDecline`; `declined` — строка и «Я был на райде»; после окна (`attended`, флаги
  `false`) — «Ехали N» без кнопок; `none` без флагов — как раньше; `hidden`/`cancelled` — без блока явки;
- мутация: `loading` у кнопки; ответ — новый вид без повторного GET; 409 `attendance_window` — текст под действием
  и перезапрос участников; 429 — текст лимита;
- «Я иду» с карточки — `joinRide(token, id, 'ride_card')`; `home.test.tsx` (Главная) — без `source` (как сейчас);
- подпись прошедшего райда — по Q2; подсказка имени — по Q1.

e2e — нет (новых маршрутов и публичных экранов нет; блок только для вошедших, на клиенте).

Изоляция: своя БД и Redis db, например `MONGO_URL_TEST='mongodb://127.0.0.1:27117/pokatim_social_p2_test?replicaSet=rs0&directConnection=true'`,
`REDIS_URL_TEST='redis://127.0.0.1:6479/<N>'`, `TURBO_CONCURRENCY=1 pnpm check`.

**OUT OF SCOPE (P2):** «Спасибо за компанию» и «Поблагодарить всех» (P4 — переиспользует
`SocialRideParticipantsService.view`); автоявка и «Как прошёл райд?» (P5, P7); уведомления, `notification-*` файлы
(P1, P7); `GET riders/:publicId/social`, «В свои», `source: 'profile'` (P3); `social_home`, `notification` (P7);
«Поделиться» прошедшим райдом; источник «Иду» из ленты и Главной; изменения порта `RIDES_FOR_SOCIAL`, миграции,
очереди, outbox-события; правки `SocialAttendanceService` P0.

## 12. Outcome

Coder, 2026-10-31. Не закоммичено, не запушено.

**Сделано (по §3/§11, RC-1…RC-12, Q1/Q2 = (a)):**
- Contracts: `social/ride-participants.schema.ts` (`RIDE_ATTENDANCE_STATES`, `RideRiderRow`, `RideRiderGroup`,
  `RideAttendance`, `RideParticipants`), `JoinRideRequest` в `rides/ride.schema.ts`; экспорт — в конец `index.ts`.
- api-client: `joinRide(token, id, source?)` (без `source` — `{}`), в конец клиента — `rideParticipants`,
  `markRideAttended`, `declineRideAttendance`.
- API `social`: `RideParticipantsController` (`GET :id/participants`, `POST :id/attendance`, `POST
  :id/attendance/decline`, `AuthGuard`, `no-store`), `SocialRideParticipantsService` (`SocialCoreModule`, export),
  чистая `rideParticipantsView`, `AttendanceRepository.entriesOf`, `SOCIAL_POLICY.attendanceLimit` 60/ч; `SocialModule`
  импортирует `IdentityModule`. P0 (`SocialAttendanceService`) и порт `RIDES_FOR_SOCIAL` не менялись (комментарий
  порта — без P2).
- API `rides`: `join` с необязательным телом `JoinRideRequest`, `RidesService.recordJoined` после коммита (RC-6),
  `RidesModule.imports += ProductEventsCoreModule` (RC-5).
- App: `participants-queries.ts`, `ride-rider-list.tsx`, `ride-participants-block.tsx`; `GoingStack` — проп
  `avatarIds`; `ride-detail.tsx` — запрос участников вошедшему после `me`, pull-to-refresh, `useRideRsvp(id,
  'ride_card')`; `useRideRsvp(id, source?)`; подпись прошедшего — `rides.going.pastJoined` («записались N», Q2; старый
  ключ `rides.going.past` оставлен); i18n — ключи в конец `ru.ts` (+ `social.nameHint.*`).
- Документы: `rides.md` (K4, K5, Q1, Q2), `social.md` (K3–K5 ссылки), ADR-0027 п. 3 и 7, правила
  `pokatim-backend.md`, `pokatim-security.md`, `pokatim-contracts.md`, `pokatim-app.md`.

**Для pr.md:** новые эндпоинты `GET /v1/rides/:id/participants`, `POST /v1/rides/:id/attendance`, `POST
/v1/rides/:id/attendance/decline`; тело `join` — необязательное `{ source? }` (старые сборки `{}` / без тела — 200;
новая сборка со старым API — тело игнорируется; незнакомый `source`/лишний ключ — 400); миграций нет; P3 сливать после
P2 или ребейзить (сигнатура `joinRide`, ключи `social.nameHint.*`).

**Проверки (изоляция `pokatim_social_p2_test`, Redis db 9):**
- `vitest run src/modules/social src/modules/rides src/modules/product-events src/modules/sharing/ride-invite.int.test.ts`
  (apps/api) → `Test Files 25 passed (25)`, `Tests 235 passed (235)`; в т. ч. `ride-participants.int.test.ts` 9/9,
  `rides-join-source.int.test.ts` 5/5, `ride-participants.view.test.ts` + `social.policy.test.ts` 16/16.
- `pnpm --filter @pokatim/contracts test` → 54 files / 501 tests passed; `pnpm --filter @pokatim/api-client test` →
  23 / 177 passed; `pnpm --filter @pokatim/i18n test` → 2 / 16 passed.
- `pnpm jest` (apps/app, все проекты) → `Test Suites: 269 passed`, `Tests: 2588 passed`; `ride-detail.test.tsx` — новый
  `describe('участники и явка (P2, K4, K5)')` (15 тестов), «Я иду» → `joinRide(token, id, 'ride_card')`;
  `home.test.tsx` без `source` — зелёный.
- `typecheck` api, app, contracts, api-client → `tsc --noEmit` без ошибок; `eslint --max-warnings=0` и
  `prettier --check` затронутых файлов — чисто.
- `pnpm arch:check` → `no dependency violations found`; отрицательная проверка (временный импорт
  `rides.service.ts` → `../product-events/product-events.port`) → `error api-module-public-api-only … 1 dependency
  violations`, импорт возвращён.
- Полный `pnpm check` — NOT VERIFIED (по поручению — делает оркестратор).
- TDD: unit- и контрактные тесты писались вместе с кодом; int-тесты P2 зелёные с первого прогона (красной фазы для
  них не наблюдалось). Ручная проверка на симуляторе/web — NOT VERIFIED.
