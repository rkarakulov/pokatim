# Модерация профиля, follow-up: очередь жалоб на имя, уведомление о сбросе, запрет загрузки фото

Уровень: task3. Один PR: API (`apps/api`, `packages/contracts`, `packages/api-client`), панель (`apps/admin`),
приложение (`apps/app`), `packages/i18n`. Закрывает follow-up `docs/product/profile.md`: «Жалобы райдеров на имя и
очередь модерации имён», «Уведомление райдеру о сбросе, бан загрузки фото».

## 1. Title

Модерация профиля: фильтр очереди по причине жалобы (имя), уведомление райдеру о сбросе имени/фото/клуба,
автоматический запрет загрузки фото после повторных сбросов.

## 2. Goal

После profile-moderation (S1–S8) жалоба с причиной «Имя» уже попадает в общую очередь «Профили райдеров», а карточка
умеет «Сбросить имя». Не хватает:

- модератору — отдельной очереди жалоб на имя (и на фото, клуб): общая очередь смешивает причины;
- райдеру — знать, что модератор сбросил его имя, фото или клуб (сейчас S7: «Райдер о сбросе не уведомляется»);
- платформе — защиты от повторной загрузки недопустимого фото: после сброса фото райдер сразу загружает его снова.

## 3. Scope

### 3.1 Очередь по причине (имя)

1. `GET /v1/admin/rider-profiles?reason=<ProfileReportReason>&cursor&limit` — необязательный фильтр: только профили,
   у которых есть **открытая** жалоба этой причины; сортировка и курсор — как у общей очереди (последняя жалоба
   профиля сверху). Без `reason` — как сейчас. Неверная причина — 400.
2. Строка очереди получает `openReasons: ProfileReportReason[]` — причины открытых жалоб профиля (порядок
   справочника), чтобы в очереди «Все» было видно, что среди жалоб есть имя.
3. Панель: над таблицей — вкладки-фильтр «Все», «Имя», «Фото», «Клуб», «Другое» (последняя — `impersonation`,
   `spam`, `other` одной вкладкой допустимо **или** только первые четыре — решает architect, см. 8). Фильтр — в
   search-параметре URL (`?reason=name`), «Показать ещё» сохраняет фильтр. Пусто — «Жалоб на имя нет» (свой текст на
   вкладку) / «Жалоб нет».
4. Карточка: «Сбросить имя» доступна и для **скрытого** профиля с жалобой на имя? — нет: имя скрытого профиля
   никому не видно (Q2, R3), жалоба закрывается «Отклонить жалобы». Без изменений; в карточке у жалоб «Имя» — без
   изменений.

### 3.2 Уведомление о сбросе

5. Сбросы модератором (`name-reset`, `avatar-reset`, `club-reset`) с `{ reset: true }` пишут в той же транзакции
   outbox-событие `profile.field-reset` `{ userId, field: 'name' | 'avatar' | 'club', resetAt, avatarBlockedUntil? }`
   (payload — только id, код, время; причина модератора и сброшенное значение — нет). `{ reset: false }` — без события.
6. `notifications` подписывается (`notificationsOutboxRoutes`) и создаёт уведомление райдеру:
   - kinds `profile_name_reset`, `profile_avatar_reset`, `profile_club_reset` (в конец `NOTIFICATION_KINDS`);
   - группа настроек — architect (кандидат: без отключения? В N4 три группы; ближайшее — `rides`, как маршруты —
     см. 8);
   - цель — новый тип `NotificationTarget` `{ type: 'profile-edit' }` (без id — свой профиль) → приложение
     открывает `/settings/profile`; старые сборки — `{ type: 'unknown' }` (уже так разбирается);
   - тексты (снимок сервера, без причины модератора, N12):
     - имя — «Имя в профиле сброшено» / «Модератор сбросил имя после жалоб. Укажите другое имя в профиле.»;
     - фото — «Фото профиля удалено» / «Модератор удалил фото после жалоб. Загрузите другое фото.»; если запрет
       загрузки включён этим сбросом — «Модератор удалил фото после жалоб. Загрузка фото недоступна до <д.м>.»;
     - клуб — «Клуб в профиле сброшен» / «Модератор сбросил клуб после жалоб. Укажите другой клуб в профиле.»
   - повтор события — тот же `sourceEventId` (идемпотентность intake); схлопывание по `profile:<uid>:<field>` (N7).
   - удалённый аккаунт к моменту приёма — skip (`liveUserIds`, как у прочих).
7. Порт чтения для intake (`ProfileNotices` в `ProfileCoreModule`) — нужен ли (payload самодостаточен: получатель —
   `userId`, текст — поле и дата) — решает architect; правило: intake не доверяет payload в части получателя без
   проверки «пользователь жив».

### 3.3 Запрет загрузки фото (бан аватара)

8. Правило: **3-й сброс фото модератором за 180 дней** включает запрет загрузки фото на **30 дней** от момента сброса
   (`PROFILE_POLICY.avatarBan = { resets: 3, windowDays: 180, banDays: 30 }`). Каждый следующий сброс в окне при
   действующем или истёкшем запрете — снова 30 дней от нового сброса. Считает только сервер, в транзакции сброса фото
   (история сбросов — на документе профиля, не из журнала панели).
9. Пока запрет действует: `PUT /v1/profile/avatar` — `409 PROFILE_INVALID_STATE { reason: 'avatar_blocked', until }`
   **до** слота, лимита и чтения тела (байты не читаются); `POST /v1/profile/avatar/delete` разрешён.
   `GET /v1/profile` — `avatarUploadBlockedUntil: string | null` (`.nullable().default(null)`; истёк — `null`).
10. Панель, карточка: строка «Загрузка фото запрещена до <дата>» (или ничего) и счётчик «Сбросов фото за 180 дней: N»;
    действие «Снять запрет» (`POST /v1/admin/rider-profiles/:userId/avatar-unblock`, `{ reason }`, право
    `profiles.moderate`) — `avatarBlockedUntil: null`, история сбросов не очищается; журнал
    `profile.avatar_unblocked` (подпись D3, без ПДн); запрета нет — `{ unblocked: false }` без журнала. Журнал
    `profile.avatar_reset` получает `details.avatarBlockedUntil` (дата или нет), если запрет включён этим сбросом.
11. Приложение, «Редактировать профиль»: при `avatarUploadBlockedUntil` — «Выбрать фото» неактивна, под ней —
    «Загрузка фото недоступна до <дата> после нарушений правил» (текущее фото, если есть, — «Удалить фото» доступно);
    ответ 409 `avatar_blocked` на загрузку (гонка со сбросом) — тот же текст баннером.
12. Удаление аккаунта — поля на документе профиля удаляются вместе с ним (ничего отдельного).

### 3.4 Документы

13. `docs/product/profile.md` — решения T1–T… (очередь по причине, уведомление, запрет), S7 поправить («Райдер о
    сбросе не уведомляется» → уведомляется), Follow-up; `docs/product/notifications.md` (тексты и цель),
    `docs/product/admin-panel.md` (вкладки, «Снять запрет»); `.claude/rules/pokatim-*.md` — **не править без OK
    пользователя** (изменения правил — предложение в pr.md).

## 4. Out of Scope

- Премодерация фото, автоматическое распознавание.
- Шаблонные причины сброса (enum, D11).
- Ручной запрет загрузки модератором без сброса, запрет смены имени или клуба.
- Уведомление жалобщику о решении по жалобе на профиль (у райдов есть `ride_report_resolved`; для профиля — позже).
- Письмо (e-mail) о сбросе — только push и центр уведомлений.

## 5. Architecture Context

ADR-0007 (Mongo), ADR-0009 (панель, журнал), ADR-0017 (уведомления, outbox), ADR-0019 (аватары).
Образцы: событие `routes.publication-decided` + `RouteNotices` + `routePublication` в `notification-intake.ts`;
`ProfileModerationService.reset` (транзакция «профиль → побочное → жалобы → журнал»); очередь
`ProfileRepository.reportQueue`; лимиты и гард `ProfileAvatarService.admit`.

## 5.1 Placement & Reuse Gate

- Всё о профиле — модуль `profile` (единственный писатель `profiles`); событие объявляет `profile/index.ts`,
  маршрут — `notificationsOutboxRoutes` (подписчик). `notifications → profile` — новое ребро? (сейчас `notifications`
  импортирует results, disputes, rides, routes, races) — `profile` не импортирует `notifications`, цикла нет; проверить
  граф (architect).
- Outbox — `@rkarakulov/api-kit` outbox в `MongoTransactions` (как у `routes`).
- Панель — `src/ui` (`ReasonDialog`, `DataTable`, табы — как `ModerationTabs`/фильтры других очередей).
- Общий код уведомлений (texts, policy, intake) — минимальные добавления: параллельная сессия «билеты-напоминания»
  правит те же файлы (конфликты на мерже — разрешаются добавлением в конец списков).

**Architect (2026-10-30), проверено кодом:**

- Граф: `profile → identity, panel` (`profile.module.ts`); ни `identity`, ни `panel` не импортируют `notifications`.
  `ProfileCoreModule` импортируют `ProfileModule`, `ResultsCoreModule`, `RoutesModule`, `riders`, `achievements`,
  `standings`, `sharing`, `account`. `notifications` уже транзитивно зависит от `profile` (через `results`, `routes`).
  Новое ребро `notifications → profile` — **только файловое** (константа `PROFILE_FIELD_RESET` и схема payload из
  `modules/profile/index.ts`), без Nest-импорта `ProfileCoreModule` (порт не нужен — RC-F3). Цикла нет
  (`no-circular` dependency-cruiser — файловый уровень).
- `worker.module.ts` **не меняется**: `notificationsOutboxRoutes` уже подключён; новый тип добавляется в конец этого
  объекта (`notifications.events.ts`). У `profile` своих `profileOutboxRoutes` нет (подписчик один).
- Outbox — `MongoOutboxWriter` (`@rkarakulov/api-kit/mongo`, глобальный `MongoOutboxModule` в `app.module.ts`),
  инжект в `ProfileModerationService` как в `RoutesModerationService` (`outbox.append(tx, { type, payload })` в той же
  транзакции после `PanelAudit.append`).
- Reuse: фильтр-вкладки — `ToggleChip` + `validate…Search` (образец `features/rider-routes/RiderRoutesScreen.tsx`,
  `rider-routes-format.ts`, `router.tsx validateSearch`); `ReasonDialog`; `heldUpload` (`apps/api/test/uploads.ts`) и
  `holdTransaction`/`untilBlocked` (`test/identity.ts`) для гонок; `TestClock` харнесса для «через 30 дней»;
  `notificationsIntake(h).drain()` / `runIntake` (`test/notifications.ts`).
- Новых пакетов нет; база app-foundation не меняется.

## 6. Relevant Files

`apps/api/src/modules/profile/*`, `apps/api/src/modules/notifications/{notifications.events,notification-intake,
notification-texts,notifications.policy}.ts`, `apps/api/src/worker.module.ts`, `apps/api/src/db/migrations/`,
`packages/contracts/src/{profile,notifications,admin}/`, `packages/api-client/src/{index,admin}.ts`,
`apps/admin/src/features/rider-profiles/*`, `apps/app/src/features/notifications/notification-target.ts`,
экран «Редактировать профиль» в `apps/app`, `packages/i18n`.

## 7. Implementation Notes

- Фильтр по причине: денормализация `openReasons` на документе профиля (поддерживается в транзакциях жалобы и
  закрытия) + индекс, или агрегация по `profile_reports` — решает architect; при денормализации — миграция
  (`0041_…`, следующая свободная на мерже) с заполнением по открытым жалобам.
- Запрет: `avatarResetsAt: Date[]` (последние N в окне) и `avatarBlockedUntil: Date | null` на профиле; запись — той же
  условной операцией, что `resetAvatar` (или вторая операция в той же транзакции).
- Гонка «загрузка фото ↔ сброс с запретом»: транзакция замены фото проверяет запрет **в транзакции** (условие записи
  профиля), а не только в гарде до тела.

## 8. Risks / Assumptions / Open Questions

- **T-1. Правило запрета (3 за 180 дней → 30 дней)** — допущение исполнителя (автономный режим, спеки нет);
  константы в `PROFILE_POLICY`, пересмотр — product.
- **T-2. Группа настроек уведомления** — N4 даёт три группы (races, disputes, rides); сброс профиля к ним не относится.
  Кандидаты: (a) `rides` (как решения по маршрутам — «UGC райдера»), (b) новая группа (меняет настройки и экран
  настроек — шире scope). Рекомендация исполнителя — (a).
- **T-3. Вкладки очереди** — «Все / Имя / Фото / Клуб / Другое» (Другое = impersonation, spam, other) vs только
  «Имя». Рекомендация — все пять: тот же код, и модератор разбирает имена отдельно.
- **T-4. Уведомление после сброса имени скрытым профилем** невозможно (сброс имени — только при согласии в панели);
  сброс фото/клуба скрытого профиля — уведомление приходит.
- **T-5. Конфликт с «билеты-напоминания»** — общие списки `NOTIFICATION_KINDS`, `KIND_GROUPS`, `TITLES`,
  `notificationsOutboxRoutes`; при мерже — оба набора в конце.

## 8.1 Requirements Consistency

### Architecture Review (2026-10-30)

Status: **CONCERNS** — блокеров нет. RC-F1…RC-F14 — рекомендации architect; coder идёт по рекомендациям (автономный
режим), отклонения — в 8.2 / Outcome.

- **RC-F1. Фильтр очереди по причине.** Сейчас очередь — `ProfileRepository.reportQueue` по частичному индексу
  `profiles_report_queue_idx { lastReportAt: -1, _id: -1 }` (`openReportCount > 0`) с `hint`; причины есть только в
  `profile_reports` (`topReasons` — агрегация по странице). Варианты: (a) **денормализация `profiles.openReasons:
  ProfileReportReason[]`** — `$addToSet` в той же операции `recordReport`, `openReasons: []` во всех операциях, обнуляющих
  `openReportCount` (`resetPublicName`, `resetAvatar`, `resetClub`, `clearReports` — все закрывают **все** открытые
  жалобы, поэтому «пусто» верно всегда); новый частичный индекс `profiles_report_reason_queue_idx { openReasons: 1,
  lastReportAt: -1, _id: -1 }` (`openReportCount > 0`), запрос — с условием и `hint`, keyset как у общей очереди;
  миграция `0041` с бэкфиллом из открытых жалоб; (b) агрегация по `profile_reports` (`$match { reason, resolvedAt:
  null }` → `$group` → `$lookup profiles`) — keyset по полю чужой коллекции, новый индекс на `profile_reports`, сортировка
  в памяти; (c) фильтр страницы общей очереди в коде — ломает `limit`/курсор. **Рекомендация — (a).** `openReasons` в
  строке — из документа, упорядочить по `PROFILE_REPORT_REASONS` в сервисе (`$addToSet` порядок не держит). Индекс
  multikey по первому полю + сортировка по скалярным — проверить в int-тесте `explain` (нет стадии `SORT`).
- **RC-F2. Вкладки (T-3).** Контракт API — одна причина (`reason=<code>`); «Другое» = 3 причины требует `$in` по
  multikey-префиксу (сортировка индексом не гарантирована, дубли страниц) или групповой код вне справочника. Варианты:
  (a) **четыре вкладки «Все / Имя / Фото / Клуб»** — 1:1 с действиями сброса; `impersonation`/`spam`/`other` видны во
  «Все» по `openReasons` строки; (b) пять вкладок с групповым параметром `reason=other_group` (новое значение вне
  `ProfileReportReason` — ещё один enum контракта); (c) семь вкладок — по причине. **Рекомендация — (a).**
- **RC-F3. Порт `ProfileNotices` (п. 7).** Payload самодостаточен: получатель — `userId`, текст — поле и дата; живость
  получателя уже проверяет `NotificationsIntakeProcessor.writeDraft` (`IdentityAccounts.liveUserIds`), событие > 72 ч —
  `stale`. Варианты: (a) **без порта** — intake разбирает payload схемой из `profile/index.ts`; нет Nest-импорта
  `ProfileCoreModule` в `NotificationsWorkerModule`, нет новой инъекции в конструктор `NotificationIntake` (меньше
  конфликтов с параллельной сессией); (b) порт `findForNotice(userId)` в `ProfileCoreModule` — проверка «поле всё ещё
  пустое» (райдер успел вписать новое имя — уведомление всё равно правдиво: сброс был). **Рекомендация — (a).** Принятый
  риск: «Снять запрет» до приёма события → текст «недоступна до …» устарел (секунды; в приложении — актуальное поле).
- **RC-F4. Группа настроек (T-2).** `NotificationSettings` — `strictObject` с тремя ключами (`push`/`email`), новая
  группа меняет запрос настроек и экран (старые сборки шлют `PUT` без ключа — 400). Варианты: (a) **`rides`** (как
  `route_published/route_rejected`, `[ASSUMPTION]` в `notifications.policy.ts`); (b) новая группа `profile`
  (контракт настроек, экран, миграция умолчаний — вне scope); (c) неотключаемое служебное уведомление (исключение в
  `initialDelivery` — новая ветка политики). **Рекомендация — (a)**, `[ASSUMPTION]`-комментарий в `KIND_GROUPS` и N4.
- **RC-F5. `avatarUploadBlockedUntil` — во всех ответах `ProfileView`, не только `GET`.** Приложение кладёт ответ
  мутаций в кэш целиком (`apps/app/src/features/profile/queries.ts`: `setQueryData(PROFILE_QUERY_KEY, view)` после
  фото и `PATCH`): если `PATCH`/`PUT theme`/`POST avatar/delete` вернут `null`, кнопка разблокируется до перезагрузки.
  **Решение (без альтернатив):** `profileViewOf(doc, now)` — поле из `doc.avatarBlockedUntil > now`, `VIEW_PROJECTION`
  + `avatarBlockedUntil`; все вызовы (`profile.service.ts` ×5, `profile-avatar.service.ts` ×2) передают `now` `CLOCK`.
- **RC-F6. Проверка запрета в транзакции замены фото.** `setAvatar` — **upsert** по `_id`: условие запрета в фильтре
  при действующем запрете не совпадёт → upsert попытается вставить `_id` = userId → `E11000 _id_` → существующий повтор
  `write()` → снова дубль → 500. Варианты: (a) **проверка по `before`** (`findProfile(userId, tx)` уже читается первой в
  `write()`, проекция + `avatarBlockedUntil`): запрет действует → `409 avatar_blocked` до `avatars.insert`; гарантия от
  гонки — write conflict по документу профиля (`setAvatar` пишет тот же документ, что и сброс; транзакция со старым
  снимком падает на записи и повторяется на свежем); (b) условие в фильтре + перевод `E11000 _id_` при существующем
  документе в 409 — неочевидно и ломает текущий повтор гонки первых upsert. **Рекомендация — (a).** Отрицательное
  доказательство — RC-F14.
- **RC-F7. Счёт сбросов (T-1).** Варианты: (a) **две операции профиля в транзакции сброса фото**: `resetAvatar`
  (первая, условная, `returnDocument: 'before'`, проекция + `avatarResetsAt`) → чистая функция
  `avatarResetBan(prevResets, now, PROFILE_POLICY.avatarBan)` (`profile.policy.ts`: оставить сбросы в окне 180 дн. +
  `now`; ≥ 3 → `blockedUntil = now + 30 дн.`, иначе прежнее значение) → `recordAvatarReset(tx, userId, resets,
  blockedUntil)`; документ уже записан этой транзакцией — чужая запись между операциями невозможна; (b) одна pipeline-
  операция с `$filter`/`$cond` — логика в агрегатных выражениях без unit-теста, а нужен ещё прежний `avatarId` (`before`)
  и новый `blockedUntil` (`after`). **Рекомендация — (a).** Хранить все сбросы в окне (обрезка окном при каждом сбросе;
  естественная граница — после 3-го загрузка закрыта на 30 дн., ≤ ~8 за 180 дн.; страховка `$slice` не нужна).
  «Сбросов за 180 дней: N» — счёт по `now` при чтении карточки. Следствие правила: после «Снять запрет» следующий сброс
  в окне снова включает запрет (история не очищается, п. 10) — принято, отразить в `profile.md`.
- **RC-F8. Service worker — копия `notificationTargetPath`.** `apps/app/scripts/service-worker.ts` (`targetPath`,
  Web Push) — ручная копия белого списка целей с тестом паритета (`service-worker.test.ts`). **Решение:** `case
  'profile-edit': return '/settings/profile'` в оба места; иначе push в PWA ведёт в центр.
- **RC-F9. Дата в текстах.** Запрет кончается в момент `сброс + 30 дн.`, не в полночь; «до 29.11» читается как «включая
  29-е». Варианты: (a) **дата и время по Минску** — уведомление `dayTime()` из `notification-texts.ts` («до 29 ноября,
  14:05»), приложение и панель — форматтеры даты-времени (`formatDateTimeLong` панели, форматтер приложения); (b) только
  дата `day()` («до 29 ноября») — как в спецификации; (c) `<д.м>` цифрами — нового формата в текстах нет.
  **Рекомендация — (a)**; тексты в `profile.md`/`notifications.md` — с «<дата, время>».
- **RC-F10. Контракт `409 PROFILE_INVALID_STATE`.** `ProfileStateDetails = { reason: tolerantEnum(['own_profile']) }`.
  **Решение:** `'avatar_blocked'` — в конец `PROFILE_STATE_REASONS`; `until: z.iso.datetime().nullable().default(null)`
  (у `own_profile` — `null`; старые сборки видят `reason: unknown`, общий текст ошибки). Правило
  `pokatim-contracts.md` («details — только `own_profile`») устаревает — предложение правки в `pr.md`, правило не
  правим.
- **RC-F11. Окно миграции `0041`.** Миграция — шаг деплоя до новой версии API: жалоба, принятая старым API между
  бэкфиллом и переключением, не попадёт в `openReasons` (фильтр её не покажет до закрытия; «Все» — покажет). Варианты:
  (a) **принять** (dev, единицы жалоб; бэкфилл идемпотентен — повторный `db:migrate` не перезапускает, допускается
  ручной повтор функции бэкфилла) и записать в `pr.md`; (b) fallback-чтение `openReasons ?? агрегация` — двойной путь
  кода. **Рекомендация — (a).**
- **RC-F12. T-4 сформулирован неверно.** API сброса имени (`resetPublicName`) условия публичности не имеет (фильтр —
  `publicName` строка); «только публичный» держит лишь панель (`RiderProfileScreen.tsx`: кнопка при `profile.name !==
  null`, а `name` скрытого — `null`). Уведомление при сбросе имени скрытого профиля через API придёт — безвредно (имя
  было и сброшено). **Рекомендация:** не добавлять серверное условие (вне scope), поправить формулировку T-4.
- **RC-F13. Payload и журнал.** Событие `profile.field-reset` — `z.strictObject({ userId: z.uuid(), field:
  z.enum(['name','avatar','club']), resetAt: z.iso.datetime(), avatarBlockedUntil: z.iso.datetime().nullable() })`
  (явный `null`, не optional — строгая схема как у `RoutePublicationDecided`; не `null` только если запрет включён
  **этим** сбросом: `blockedUntil` новый ≠ прежний). Схлопывание — `collapse: { key: 'profile:<uid>:<field>', seq:
  Date.parse(resetAt) }` (образец `routePublication`). Журнал: `details.avatarBlockedUntil` — новое необязательное поле
  в `AuditDetailsDoc` (`panel/panel.collection.ts`) и `AuditEntry.details` (`contracts/admin/audit.schema.ts`), дата ISO;
  в логе — без даты и причины.
- **RC-F14. Тест-ворота гонки «загрузка ↔ сброс с запретом» (AC7).** Сценарий: `heldUpload` — приём прошёл
  `admit` (запрета ещё нет), тело удержано → третий сброс фото модератором (коммит, запрет) → `finish` тела → **409
  `avatar_blocked`**, в `profile_avatars` нет нового документа, `avatarId` профиля `null`. Отрицательное доказательство:
  убрать проверку `before.avatarBlockedUntil` в `write()` → 200 и фото записано (результат, не таймаут) — в §12.
  Вторая гарантия (снимок транзакции до коммита сброса) — `vi.spyOn(profiles, 'findProfile')` как ворота
  (`gate()`): транзакция замены прочитала `before` без запрета и стоит → сброс коммитится → ворота открыты →
  write conflict → повтор → 409 (без проверки — 200). Замок первым действием не нужен: обе транзакции пишут **один**
  документ профиля (pokatim-db: «конфликт по документу»), write skew нет.

Дополнительно (LOW, без вариантов):

- `409 avatar_blocked` из `admit` — до слота/лимита/тела, как `429` слота; ответ с `Connection: close` (тело клиента не
  дочитано) — повесить заголовок в контроллере для отказов до `readLimited` (сейчас 429 слота его не ставит — тот же
  фикс).
- «Снять запрет»: транзакция — **первой** условная запись профиля `{ _id, avatarBlockedUntil: { $gt: now } }` →
  `avatarBlockedUntil: null` → `PanelAudit.append('profile.avatar_unblocked', details: null)`; не совпало → профиля нет —
  404, иначе `{ unblocked: false }` без журнала (истёкший запрет = нет запрета). Outbox и уведомления нет.
- Порядок записи сброса с outbox: профиль (условная) → `recordAvatarReset` (только фото) → удаление фото / перевыпуск
  id → `closeOpen` → `PanelAudit.append` → `outbox.append` — всё в одной транзакции; `{ reset: false }` — без
  события.
- Панель после «Снять запрет»/сбросов инвалидирует префикс `RIDER_PROFILES_QUERY_KEY` (ключ списка получает `reason`).

## 8.2 Отклонения при реализации (API, coder, 2026-10-30)

- **RC-F1…RC-F14** — приняты рекомендации architect (см. 8.1): денормализация `profiles.openReasons` + индекс
  `profiles_report_reason_queue_idx` + миграция `0041` с бэкфиллом; четыре вкладки (контракт — одна причина);
  уведомление без порта (`ProfileFieldReset` из `profile/index.ts`); группа «Райды»; `avatarUploadBlockedUntil` во всех
  ответах `ProfileView` (`profileViewOf(doc, now)`); проверка запрета по `before` в транзакции замены; две операции
  профиля в транзакции сброса фото (`resetAvatar` → `avatarResetBan` → `recordAvatarReset`); копия цели
  `profile-edit` в service worker; дата и время по Минску; `avatar_blocked` + `until` в `ProfileStateDetails`; окно
  миграции принято; серверного условия публичности для сброса имени нет (RC-F12); payload — строгая схема, журнал —
  `details.avatarBlockedUntil`; ворота гонки RC-F14.
- **`details.avatarBlockedUntil` в `panel_audit`** — строка ISO (как в контракте `AuditEntry`), не `Date`: чтение
  журнала отдаёт `details` как есть.
- **`Connection: close` на всех отказах `admit`** (запрет, слот, лимит) — LOW из 8.1: ставится в контроллере на
  исключение `admit`.
- **Правило окна** — сброс «за 180 дней» = строго моложе 180 суток (сброс ровно 180 суток назад — вне окна);
  граница проверена unit-тестом ±1 мс.
- **Сторож `profile-reports.repository.test.ts`** — в список знающих коллекцию `profile_reports` добавлена миграция
  `0041` (только чтение открытых жалоб для бэкфилла).
- **Тестовая БД** — оркестратор дал `pokatim_profilemod`; стенд `@rkarakulov/test-kit` требует имя `*_test` —
  прогоны на `pokatim_profilemod_test` (тот же сервер, своя БД), Redis db 7.
- **Int-тесты запрета** — после сдвига часов стенда на дни access-токены истекают: тест входит заново (райдер —
  `POST /v1/auth/session/sign-in`, модератор — `panelSession`).
- **Объём этого прохода** — API, контракты, api-client, i18n (только подпись журнала
  `admin.audit.action.profile.avatar_unblocked`), цель `profile-edit` в приложении и service worker; документы —
  `profile.md` (T1–T8, S7, Follow-up, API) и `notifications.md` (N3, N4, N10, тексты). Экраны панели, «Редактировать
  профиль», `admin-panel.md`, `pr.md` — следующий проход. В панели тронуты только фикстуры двух тестов
  (`RiderProfile(s)Screen.test.tsx`: новые поля строки и карточки) — без них не собирается typecheck панели. В
  приложении — фикстуры `ProfileView` 22 тестов (`avatarUploadBlockedUntil: null`, поле с `.default` обязательно в
  выходном типе), поведение экранов не менялось.

### Проход 2 — клиенты (coder, 2026-10-30)

- **Вкладки очереди** — `ToggleChip` по `RIDER_PROFILE_QUEUE_REASONS = ['name','photo','club']` + «Все».
  `validateRiderProfilesSearch` возвращает ключ `reason` всегда (`undefined` вне вкладок): роутер сливает сырой поиск с
  проверенным, и при `{}` `?reason=spam` доходил до экрана (тест «причина вне вкладок»). У `validateRiderRoutesSearch`
  та же особенность — не трогали (вне scope).
- **`openReasons` в строке** — подпись «Причины: …» под «N · главная причина» только при двух и более причинах (одна —
  совпадает с главной).
- **Карточка** — «Сбросов фото за 180 дней» — `ReadonlyField` (всегда), «Загрузка фото запрещена до <дата, время>» — его
  подсказка (`help`, связана `aria-describedby`) только при запрете; «Снять запрет» — кнопка в шапке только при
  запрете, `ReasonDialog` не деструктивный, с тем же предупреждением D11; ошибки — как у прочих действий (404 —
  перечитывание, 409 — `ConflictBanner`, прочее — в окне). `{ unblocked: false }` — просто перечитывание.
- **Последствия сбросов** в окнах — добавлено «райдер получит уведомление», для фото — правило 3/180/30.
- **Приложение, дата запрета** — всегда с годом (`minskDateTime(until, null)`: «29 ноября 2026, 14:05») — текст не
  зависит от «сейчас» (SSR web). Уведомление — по-прежнему без года (`dayTime()` сервера). Записано в T7.
- **a11y кнопки** — `Button` базы (`@rkarakulov/ui`) не принимает `accessibilityHint`/`aria-describedby`: кнопка
  `disabled` (скринридер — «недоступна»), описание — текст сразу под ней в том же блоке. Правка базы — не делали.
- **409 `avatar_blocked`** — `useUploadAvatar.onError` инвалидирует `['profile']` (кнопка блокируется после гонки);
  текст баннера — `avatarErrorMessage` (без `until` — общий текст действия).
- **Native-тест** — в `src/__tests__/profile-screen.test.tsx` (экран целиком), отдельный `avatar-editor.test.tsx` не
  создавали.

### Исправления ревью, pass 1 (coder, 2026-10-30)

- **MEDIUM (Claude, Codex) — запрет истёк при открытом экране.** `useAvatarBlockExpiry` (`features/profile/
  avatar-block-expiry.ts`, вызов в `AvatarSection` — native и web): при ненулевом `avatarUploadBlockedUntil` таймер на
  момент окончания → `invalidateQueries(['profile'])`; кнопку разблокирует только ответ сервера. Задержка — не больше
  2^31-1 мс (дальше — цепочкой); смена срока и размонтирование отменяют таймер; сервер ответил тем же сроком (часы
  устройства впереди) — повтор через 30 с. Тест — `avatar-block-expiry.test.tsx` (фейковые таймеры, 7 случаев);
  отрицательное доказательство — без ограничения задержки 2 теста красные.
- **MEDIUM (Claude) — журнал.** `AuditScreen.details()`: у записи с `details.avatarBlockedUntil` (сброс фото, включивший
  запрет) — «Жалоб: N · запрет загрузки фото до <дата, время>» (`formatDateTimeLong`, Минск); ключи
  `admin.audit.details.avatarBlockedUntil`, `admin.audit.details.join`; тест экрана журнала. Совпадает с
  `admin-panel.md` (журнал: «дата окончания запрета, если его включил этот сброс»).
- **LOW — explain страницы с курсором.** `rider-profiles-moderation.int.test.ts`: план запроса с фильтром `reason` и
  keyset-условием курсора — `IXSCAN profiles_report_reason_queue_idx`, без `SORT`.

### Исправления ревью, pass 2 (coder, 2026-10-30)

- **MEDIUM (Codex) — порядок уведомлений о сбросе.** `resetAt` берётся до транзакции и не монотонен между
  конкурирующими сбросами. Теперь условная запись каждого сброса (`resetPublicName`, `resetAvatar`, `resetClub`) делает
  `$inc profiles.resetSeq` (ревизия сбросов профиля, общая для трёх полей; нет поля — 0, миграция не нужна) и
  возвращает номер этого сброса (прежний + 1); событие `profile.field-reset` получает обязательное `seq` (целое > 0),
  intake схлопывает `profile:<uid>:<field>` по нему. Событие без `seq` — `invalid_payload`, без fallback на
  `Date.parse(resetAt)`: в одном `collapseSeq` миллисекунды времени всегда «новее» ревизии и сломали бы порядок;
  событие внутреннее, в проде старых нет, на dev необработанные старые события лишь не дадут уведомления.
- **Тест** — `profile-avatar-locks.int.test.ts`: запрос A взял время и стоит перед записью (ворота на
  `ProfileRepository.resetAvatar`) → сброс B (позже по часам) → новое фото → A (3-й сброс, запрет); `resetAt` A < B, `seq`
  A > B; в центре одно уведомление — текст A с запретом. Отрицательное доказательство: intake со `seq:
  Date.parse(resetAt)` — тест красный по результату (в центре текст B «Загрузите другое фото»). Unit intake — `seq` в
  схлопывании, без `seq` / `seq: 0` — `invalid_payload`; int модерации — `seq` 1, 2, 3 по трём полям.

## 9. Acceptance Criteria

1. `GET /v1/admin/rider-profiles?reason=name` — только профили с открытой жалобой «Имя», сортировка и курсор как у
   общей; жалобу закрыли — профиль уходит из фильтра; `reason=bad` — 400; строки содержат `openReasons`.
2. Панель: вкладки фильтра, URL-параметр, пустые состояния по вкладке; тесты экрана.
3. Сброс имени/фото/клуба (`reset: true`) → уведомление райдеру нужного kind с целью `profile-edit`; `reset: false` —
   нет события; удалённый райдер — нет уведомления; повтор задачи intake — одно уведомление (int-тест).
4. Приложение: цель `profile-edit` открывает `/settings/profile` (unit-тест `notification-target`).
5. 3-й сброс фото за 180 дней → `avatarUploadBlockedUntil` = сброс + 30 дн. в `GET /v1/profile`; `PUT avatar` —
   409 `avatar_blocked` с `until`, тело не читается; через 30 дней (часы теста) — загрузка снова работает; 2 сброса или
   3 за > 180 дней — запрета нет; текст уведомления о третьем сбросе — с датой.
6. «Снять запрет» — загрузка работает, журнал `profile.avatar_unblocked`; повтор — `{ unblocked: false }` без журнала;
   без права — 403.
7. Гонка: загрузка фото, начавшаяся до сброса с запретом, не обходит запрет (транзакция замены проверяет его) —
   int-тест с отрицательным доказательством.
8. Приложение: «Редактировать профиль» — кнопка неактивна и подпись с датой при запрете; 409 на загрузке — баннер.
9. `pnpm check` зелёный.

## 10. Documentation Impact

- `docs/product/profile.md` — решения T1–T8 (очередь по причине и вкладки RC-F2, `openReasons`; уведомление о сбросе и
  группа «Райды» RC-F4; запрет 3/180/30 RC-F7 с «после снятия следующий сброс снова запрещает»; «Снять запрет»; дата и
  время RC-F9); S7 — «Райдер о сбросе уведомляется (T…)»; Follow-up — закрыть «Жалобы на имя и очередь имён»,
  «Уведомление о сбросе, бан загрузки фото»; оставить премодерацию, шаблонные причины, уведомление жалобщику.
- `docs/product/notifications.md` — N3 (таблица событий: три строки «Имя/Фото/Клуб сброшены» → самому райдеру), N4
  (`[ASSUMPTION]` группа «Райды»), N10 (цель `profile-edit` → «Редактировать профиль»), «Тексты v1» (3 + вариант с
  запретом).
- `docs/product/admin-panel.md` — вкладки очереди «Профили райдеров», строка запрета и счётчик, «Снять запрет»,
  действие журнала `profile.avatar_unblocked`.
- `pr.md` — миграция `0041_profile_report_reasons` (expand + бэкфилл, RC-F11), предложения правок правил (не
  применять без OK): `pokatim-db.md` (поля `openReasons`, `avatarResetsAt`, `avatarBlockedUntil`, индекс, порядок
  записи сброса фото и «Снять запрет»), `pokatim-backend.md` (событие `profile.field-reset`, `notifications → profile`
  без порта, «12 типов» → 13), `pokatim-contracts.md` (`avatar_blocked` + `until`, `profile-edit`,
  `avatarUploadBlockedUntil`, `reason` очереди, `openReasons`), `pokatim-tests.md` (ворота гонки фото RC-F14),
  `pokatim-security.md` (запрет загрузки — до слота и тела).

## 11. Implementation Context

### 11.1 Placement

| Что | Где |
|---|---|
| Фильтр очереди, `openReasons`, запрет, «Снять запрет», событие | `apps/api/src/modules/profile` (единственный писатель `profiles`) |
| Тип события и схема payload | `profile/profile.events.ts` (новый) → экспорт из `profile/index.ts` |
| Подписка и тексты | `notifications/{notifications.events,notification-intake,notification-texts,notifications.policy}.ts` — только добавления **в конец** списков/`switch` |
| Миграция | `apps/api/src/db/migrations/0041_profile_report_reasons.ts` (номер — следующий свободный на мерже) |
| Контракты | `packages/contracts/src/{profile,notifications,admin}/` |
| Панель | `apps/admin/src/features/rider-profiles/*`, `router.tsx` |
| Приложение | `apps/app/src/features/profile/*`, `features/notifications/notification-target.ts`, `scripts/service-worker.ts` |

### 11.2 План по шагам (каждый шаг — зелёные тесты шага)

1. **Контракты** (`packages/contracts`):
   - `profile/profile-moderation.schema.ts`: `RiderProfileModerationQuery.reason: ProfileReportReason.optional()`;
     строка — `openReasons: z.array(ProfileReportReason).default([])`; карточка — `avatarUploadBlockedUntil:
     z.iso.datetime().nullable().default(null)`, `avatarResetCount: z.number().int().nonnegative().default(0)`;
     `UnblockRiderAvatarRequest = ResetRiderNameRequest` (алиас), `RiderAvatarUnblockResult = z.object({ unblocked:
     z.boolean() })`.
   - `profile/profile.schema.ts`: `ProfileView.avatarUploadBlockedUntil: z.iso.datetime().nullable().default(null)`.
   - `profile/profile-report.schema.ts`: `PROFILE_STATE_REASONS` + `'avatar_blocked'` (конец), `ProfileStateDetails.until`
     (RC-F10).
   - `notifications/notification.schema.ts`: `NOTIFICATION_KINDS` + `profile_name_reset`, `profile_avatar_reset`,
     `profile_club_reset` (конец); `NotificationTarget` + `z.object({ type: z.literal('profile-edit') })` (конец).
   - `admin/audit.schema.ts`: `AUDIT_ACTIONS` + `'profile.avatar_unblocked'` (конец), `details.avatarBlockedUntil:
     z.iso.datetime().optional()`.
   - `api-client`: `listRiderProfiles({ reason })`, `unblockRiderAvatar(userId, body)` (`admin.ts`).
2. **Миграция `0041`**: индекс `profiles_report_reason_queue_idx` `{ openReasons: 1, lastReportAt: -1, _id: -1 }`,
   `partialFilterExpression: { openReportCount: { $gt: 0 } }`; бэкфилл — агрегация открытых `profile_reports`
   (`resolvedAt: null`) по `targetUserId` → `$addToSet reason` → `updateOne({ _id, openReportCount: { $gt: 0 } }, { $set:
   { openReasons } })`. Expand-only, идемпотентна, без транзакции. Запись в `migrations/index.ts`, ожидание индекса в
   `migrations.int.test.ts`. Полей запрета миграция не трогает (нет поля — нет запрета).
3. **Профиль — данные** (`profile.collection.ts`, `profile.repository.ts`, `profile.policy.ts`):
   - `ProfileDoc`: `openReasons?: ProfileReportReason[]`, `avatarResetsAt?: Date[]`, `avatarBlockedUntil?: Date | null`
     (чтение `?? [] / ?? null`).
   - `recordReport(tx, publicId, reporter, reason, now)` — `$addToSet: { openReasons: reason }` в той же операции.
   - `resetPublicName`/`resetAvatar`/`resetClub`/`clearReports` — `openReasons: []` рядом с `openReportCount: 0`;
     `resetAvatar` — проекция + `avatarResetsAt`; новый `recordAvatarReset(tx, userId, resets, blockedUntil)`;
     `unblockAvatar(tx, userId, now)` (условие `$gt: now`); `reportQueue(after, limit, reason?)` — с `reason` фильтр
     `openReasons: reason` и `hint('profiles_report_reason_queue_idx')`; `MODERATION_PROJECTION`/`VIEW_PROJECTION` +
     новые поля; `findAvatarBlock(userId)` для `admit`.
   - `PROFILE_POLICY.avatarBan = { resets: 3, windowDays: 180, banDays: 30 }`; чистые `avatarResetBan(prev, now)`,
     `activeBlock(until, now)`, `resetsInWindow(resets, now)`; `profileViewOf(doc, now)` (RC-F5).
4. **Профиль — сервисы**:
   - `ProfileModerationService`: `list` с `reason`, `openReasons` по порядку справочника; `detail` + запрет и счётчик;
     `reset()` получает `field` и после журнала пишет outbox `PROFILE_FIELD_RESET` (только `reset: true`); `resetAvatar`
     — `recordAvatarReset`, `details.avatarBlockedUntil` при включении (RC-F13); `unblockAvatar` (LOW «Снять запрет»).
     Инжект `MongoOutboxWriter`.
   - `RiderProfilesModerationController`: `POST :userId/avatar-unblock` (`PanelGuard` + `profiles.moderate` — на классе).
   - `ProfileAvatarService.admit`: **первым** — `findAvatarBlock` → `409 PROFILE_INVALID_STATE { reason:
     'avatar_blocked', until }`, затем слот и лимит; `replace.write()` — проверка `before` (RC-F6). Контроллер — `Connection:
     close` на отказах до тела.
   - `ProfileService` — `now` в `viewOf` (RC-F5). `error-messages.ts` — без нового кода (код есть).
5. **Уведомления** (только добавления в конец): `notifications.events.ts` — `[PROFILE_FIELD_RESET]:
   QUEUE.notificationsIntake`; `notification-intake.ts` — `case PROFILE_FIELD_RESET: return this.profileFieldReset(payload)`
   (без порта, RC-F3; `invalid_payload` при битой схеме); `notification-texts.ts` — `NoticeText` `{ kind:
   'profile_name_reset' | 'profile_club_reset' } | { kind: 'profile_avatar_reset'; blockedUntil: Date | null }`,
   `TITLES` и `bodyOf` (RC-F9); `notifications.policy.ts` — три kind → `RIDES` (RC-F4).
6. **Панель**: `rider-profiles-format.ts` — `validateRiderProfilesSearch` (`reason ∈ name|photo|club`, прочее —
   «Все»); `router.tsx` — `validateSearch` у `rider-profiles`; `RiderProfilesScreen` — `ToggleChip` 4 вкладки, ключ
   запроса `[..., 'list', reason ?? 'all']`, пустое по вкладке, причины строки из `openReasons`; `RiderProfileScreen` —
   строка «Загрузка фото запрещена до <дата, время>», «Сбросов фото за 180 дней: N», действие «Снять запрет» через
   `ReasonDialog` (только при запрете); подписи журнала `admin.audit.action.profile.avatar_unblocked`.
7. **Приложение**: `notification-target.ts` + `scripts/service-worker.ts` — `profile-edit` → `/settings/profile`
   (RC-F8); `avatar-editor.tsx` и `avatar-editor.web.tsx` — проп `blockedUntil`, кнопка `disabled`, подпись под ней;
   `app/settings/profile.tsx` передаёт `data.avatarUploadBlockedUntil`; `avatar-errors.ts` — `PROFILE_INVALID_STATE`
   с `avatar_blocked` → текст с датой из `details.until` + инвалидация `['profile']` (кнопка блокируется после гонки).
8. **i18n** (`packages/i18n/src/ru.ts`): вкладки и пустые состояния (`admin.riderProfiles.filter.*`,
   `admin.riderProfiles.empty.{all,name,photo,club}` — заменить строку `admin.riderProfiles.empty`), строка запрета,
   счётчик, «Снять запрет» (заголовок, последствия), подпись журнала; приложение — `profile.avatar.blocked`
   («Загрузка фото недоступна до {date} после нарушений правил»). Последствия «Сбросить фото/имя/клуб» — «Райдер получит
   уведомление»; для фото — «3-й сброс за 180 дней закрывает загрузку фото на 30 дней».
9. **Документы** — §10.

### 11.3 Test matrix

| AC | Тест | Файл |
|---|---|---|
| 1 | int: `?reason=name` — только профили с открытой «Имя», порядок и курсор (limit 1, две страницы), профиль с «Фото»+«Имя» — в обеих вкладках; после сброса/«Отклонить» — уходит; `reason=bad` — 400; `openReasons` в строках (порядок справочника); `explain` — `IXSCAN` по `profiles_report_reason_queue_idx` без `SORT` | `apps/api/src/modules/profile/rider-profiles-moderation.int.test.ts` |
| 1 | int: жалоба пишет `openReasons` (`$addToSet`, повтор причины — без дубля); сброс/отклонение — `[]` | `apps/api/src/modules/profile/profile-reports.int.test.ts` |
| 1 | int миграции: индекс (`partialFilterExpression`), бэкфилл по открытым жалобам, закрытые не попадают, повтор безопасен | `apps/api/src/db/migrations/migrations.int.test.ts` |
| 3 | int: сброс имени/фото/клуба (`reset: true`) → одно событие `profile.field-reset` (payload — ключи `userId, field, resetAt, avatarBlockedUntil`; нет причины/значений); `reset: false` — событий нет; `drain()` → уведомление kind, `group: 'rides'`, `target: { type: 'profile-edit' }`, `collapseKey`, текст; повтор `runIntake` того же события — одно уведомление (`unchanged`); удалённый аккаунт — нет уведомления; битый payload — `skipped` | `apps/api/src/modules/notifications/notifications-intake.int.test.ts` (блок в конец файла) |
| 3 | unit: тексты трёх kind + вариант с запретом (дата и время по Минску); `groupOf` | `notification-texts.test.ts`, `notifications.policy.test.ts`, `notification-intake.test.ts` |
| 4 | unit: `profile-edit` → `/settings/profile`; паритет service worker | `apps/app/src/features/notifications/notification-target.test.ts`, `apps/app/scripts/service-worker.test.ts` |
| 5 | unit: `avatarResetBan` — 2 сброса — нет; 3 за ≤ 180 дн. — `now + 30`; 3 за > 180 (граница окна ±1 мс); 4-й при действующем/истёкшем — снова `now + 30`; обрезка окна | `apps/api/src/modules/profile/profile.policy.test.ts` |
| 5 | int: 3 сброса (загрузка → сброс, `TestClock`) → `GET /v1/profile.avatarUploadBlockedUntil` = сброс + 30 дн.; `PATCH`/`PUT theme`/`delete` возвращают то же поле (RC-F5); `PUT avatar` — 409 `avatar_blocked` + `until`, тело удержано `heldUpload` и не дочитано, слот и квота не списаны; `+30 дн.` — 200 и поле `null`; журнал `profile.avatar_reset.details.avatarBlockedUntil` только у включившего; событие с `avatarBlockedUntil` → текст «недоступна до …» | `apps/api/src/modules/profile/profile-avatar.int.test.ts`, `rider-profiles-moderation.int.test.ts` |
| 6 | int: «Снять запрет» → загрузка 200, журнал `profile.avatar_unblocked` (подпись D3, без ПДн), история сохранена (следующий сброс — снова запрет, RC-F7); повтор/истёкший — `{ unblocked: false }` без журнала; нет профиля — 404; организатор — 403; без сессии — 401 | `rider-profiles-moderation.int.test.ts` |
| 7 | int **гонка** (RC-F14): `heldUpload` ↔ третий сброс → 409, фото не записано; ворота `findProfile` → write conflict → 409. Отрицательное доказательство — без проверки `before` → 200 (в §12) | `apps/api/src/modules/profile/profile-avatar-locks.int.test.ts` (новый) |
| 8 | jest приложения: кнопка `disabled` и подпись с датой при `avatarUploadBlockedUntil`; «Удалить фото» доступна; 409 `avatar_blocked` → баннер с датой; native и web | `apps/app/src/features/profile/avatar-editor.test.tsx` (новый), `avatar-editor.web.test.tsx`, `avatar-errors.test.ts`, `apps/app/src/__tests__/profile-screen.test.tsx` |
| 2 | vitest панели: вкладки (`?reason=name` в URL, «Показать ещё» с фильтром, пустое по вкладке), причины в строке; карточка: строка запрета, счётчик, «Снять запрет» → `ReasonDialog` → запрос, без запрета — кнопки нет | `apps/admin/src/features/rider-profiles/{RiderProfilesScreen,RiderProfileScreen}.test.tsx` |
| — | contracts: query `reason` (строгий enum), `openReasons` default, `ProfileView` без поля → `null`, `ProfileStateDetails` `until` default, `NotificationTargetView` `profile-edit` + старая форма → `unknown`, порядок `NOTIFICATION_KINDS`/`AUDIT_ACTIONS` (новые — в конце) | `packages/contracts/src/{profile,notifications,admin}/*.schema.test.ts` |
| — | api-client: `listRiderProfiles({ reason })`, `unblockRiderAvatar` | `packages/api-client/src/admin.test.ts` |
| — | сторожа: `profile.repository.test.ts` (писатель `profiles`), `admin-routes.test.ts` (`avatar-unblock` под `PanelGuard`), `pnpm arch:check` (ребро `notifications → profile`, без циклов) | — |

Изоляция int-тестов — своя БД Mongo и свой Redis db (`MONGO_URL_TEST`, `REDIS_URL_TEST`).

### 11.4 Security (checklist нужен: да — загрузка медиа, панель, журнал)

Запрет — до слота, лимита и тела; в транзакции — проверка по документу (RC-F6); `avatar-unblock` — `PanelGuard` +
`profiles.moderate`, тело `strictObject` (`ActionReason`); журнал без ПДн (D3/D14), payload outbox — id, код, время;
текст уведомления — без причины модератора и значения поля (N12); логи — `uid`, поле, исход.

### 11.5 Implementation Context (для coder)

- **ENTRY POINTS:** `profile/profile-moderation.service.ts`, `profile/profile-avatar.service.ts`,
  `profile/profile-avatars.controller.ts`, `profile/rider-profiles-moderation.controller.ts`,
  `notifications/notification-intake.ts`, `apps/admin/src/features/rider-profiles/RiderProfilesScreen.tsx`,
  `apps/app/src/app/settings/profile.tsx`.
- **FILES TO MODIFY:** `apps/api/src/modules/profile/{index,profile.collection,profile.repository,profile.policy,
  profile.service,profile-avatar.service,profile-avatars.controller,profile-moderation.service,profile-reports.service,
  rider-profiles-moderation.controller}.ts`; `apps/api/src/modules/panel/panel.collection.ts` (`AuditDetailsDoc`);
  `apps/api/src/modules/notifications/{notifications.events,notification-intake,notification-texts,
  notifications.policy}.ts`; `apps/api/src/db/migrations/{index,migrations.int.test}.ts`; `packages/contracts/src/
  {profile/profile.schema,profile/profile-report.schema,profile/profile-moderation.schema,notifications/
  notification.schema,admin/audit.schema,index}.ts`; `packages/api-client/src/admin.ts`; `packages/i18n/src/ru.ts`;
  `apps/admin/src/{router.tsx,features/rider-profiles/*}`; `apps/app/src/features/profile/{avatar-editor.tsx,avatar-editor.web.tsx,avatar-errors.ts}`, `apps/app/src/features/notifications/notification-target.ts`,
  `apps/app/src/app/settings/profile.tsx`,
  `apps/app/scripts/service-worker.ts`.
- **FILES TO CREATE:** `apps/api/src/modules/profile/profile.events.ts`,
  `apps/api/src/db/migrations/0041_profile_report_reasons.ts`, `profile-avatar-locks.int.test.ts`,
  `apps/app/src/features/profile/avatar-editor.test.tsx` (если нет native-теста).
- **FILES TO READ:** `routes/routes.events.ts`, `routes/routes-moderation.service.ts` (outbox в транзакции),
  `notifications/notification-intake.ts#routePublication` (collapse `seq`), `test/{uploads,identity,notifications,
  profiles}.ts`, `db/migrations/0034_profile_reports.ts`, `features/rider-routes/{RiderRoutesScreen,
  rider-routes-format}.ts(x)`, `apps/app/src/features/profile/queries.ts` (кэш `setQueryData`).
- **TYPES & SCHEMAS:** `ProfileDoc` (+3), `ProfileModerationDoc`/`ProfileViewDoc` (+поля), `ProfileFieldReset`,
  `NoticeText` (+2 ветки), `AuditDetailsDoc.avatarBlockedUntil`, `PROFILE_POLICY.avatarBan`, контракты шага 1.
- **OUT OF SCOPE:** новая группа настроек уведомлений, порт `ProfileNotices`, серверное условие публичности для сброса
  имени (RC-F12), уведомление жалобщику, премодерация, правка `.claude/rules/*` (только предложения в `pr.md`),
  `worker.module.ts`.

## 12. Outcome

### Проход 1 — API и общие пакеты (coder, 2026-10-30)

- **Контракты:** `RiderProfileModerationQuery.reason`, строка `openReasons`, карточка `avatarUploadBlockedUntil` /
  `avatarResetCount`, `UnblockRiderAvatarRequest` / `RiderAvatarUnblockResult`, `ProfileView.avatarUploadBlockedUntil`,
  `PROFILE_STATE_REASONS` + `avatar_blocked`, `ProfileStateDetails.until`, `NOTIFICATION_KINDS` + 3, цель
  `profile-edit`, `AUDIT_ACTIONS` + `profile.avatar_unblocked`, `details.avatarBlockedUntil`. api-client —
  `listRiderProfiles({ reason })`, `unblockRiderAvatar`.
- **API:** миграция `0041_profile_report_reasons`; `profile.events.ts` (`profile.field-reset`); очередь по причине,
  запрет загрузки фото (`admit` — до слота, `write()` — по `before`), «Снять запрет», outbox в транзакции сброса;
  `notifications` — маршрут, разбор payload, тексты, группа «Райды».
- **Приложение (цель):** `notificationTargetPath` и `targetPath` service worker — `profile-edit` → `/settings/profile`.
- **Отрицательное доказательство RC-F14** (`profile-avatar-locks.int.test.ts`): проверка `before.avatarBlockedUntil` в
  `write()` убрана → оба теста красные по результату: `expected 200 to be 409` (удержанное тело ↔ третий сброс; ворота
  `findProfile` ↔ сброс). С проверкой — 409, фото не записано. Проверка возвращена.
- **Проверки:** `TURBO_CONCURRENCY=1 pnpm check` (Mongo `pokatim_profilemod_test`, Redis db 7): format, lint,
  arch:check, typecheck — зелёные; тесты: contracts 448, api-client 159, i18n 15, admin 461, app 2361 — зелёные; api
  2146/2151 — 5 падений по таймауту 20 с под нагрузкой (load average ≈ 16, параллельные сессии) в
  `dispute-series.int.test.ts` и `results-check.int.test.ts`, не связанных с задачей; отдельный перезапуск — 9/9 и
  26/26. Затронутые файлы отдельно: `rider-profiles-moderation` 22, `profile-avatar-locks` 2, `profile-reports`,
  `notifications-intake`, `migrations` — зелёные.

### Проход 2 — клиенты и документы (coder, 2026-10-30)

- **Панель:** вкладки «Все / Имя / Фото / Клуб» (`?reason=`, «Показать ещё» и пустые состояния по вкладке), строка
  «Причины: …»; карточка — счётчик сбросов фото, строка запрета с датой и временем, «Снять запрет» (`ReasonDialog`).
- **Приложение:** «Выбрать фото» неактивна при запрете, подпись с датой; 409 `avatar_blocked` — баннер и
  перечитывание `['profile']` (native и web).
- **Документы:** `admin-panel.md`, `profile.md` (экран, T7), §8.2 (проход 2), черновик `pr.md`.
- **Тесты:** vitest панели +7 (очередь 4, карточка 3), jest приложения +5 (`avatar-errors`, `avatar-editor.web`,
  `profile-screen`) — сначала красные, затем зелёные.
- **Проверки:** `TURBO_CONCURRENCY=1 pnpm check` (Mongo `pokatim_profilemod_test`, Redis db 7) — EXIT 0, 15/15 задач:
  api 2151, admin 468, app 2366, contracts, api-client, i18n — зелёные.
