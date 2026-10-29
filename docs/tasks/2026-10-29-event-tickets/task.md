# task.md — Билеты на мероприятия (event-tickets)

Уровень: task3. Base: `origin/develop` @ 6fe3a767. Ветки — по PR (§3.1), каждая от свежего `origin/develop`.

## 1. Title

Билеты на мероприятия: регистрация → персональный билет с QR → письмо → напоминание → check-in организатором;
материалы участникам; Apple/Google Wallet по конфигурации.

## 2. Goal

Райдер, зарегистрированный на гонку с очным стартом или старт календаря с регистрацией в «Покатим», получает
персональный билет. Билет открывается в приложении (iOS, Android, PWA, десктоп) и по ссылке из письма, работает при
плохой сети. Организатор сканирует QR в панели и отмечает участника. UX-ориентир — Timepad, дизайн — наша система.

## 3. Scope

### 3.0 Решения автора (2026-10-29, human gate)

| # | Развилка | Решение |
|---|---|---|
| T1 | Какие события получают билеты | **Гонки с очным стартом** (организатор включает билет, задаёт старт и место) и **старты календаря** с режимом «Регистрация в Покатим». Кофе-райды — без билетов (v1). |
| T2 | Ссылка «Открыть билет» из письма | **Только после входа**: `https://<web>/tickets/<код>`; не владельцу — «Не найдено»; гостю — вход с возвратом. |
| T3 | Каналы напоминаний | **Центр + push + e-mail**, новая группа настроек «Мероприятия» (push и e-mail тумблеры). Web Push — когда параллельная сессия смержит канал. |
| T4 | Материалы | **Ссылки, текст и PDF** (PDF ≤ 10 МБ в Mongo, отдача по негадаемому id без входа, как аватары ADR-0019). |

### 3.1 Разбиение на PR

| PR | Ветка | Содержание |
|---|---|---|
| A | `feature/event-tickets-api` | модуль `tickets`: настройки билетов события, регистрация на старт календаря, выпуск/статусы билетов, чтение владельцем, check-in API, письмо «Вы зарегистрированы», миграция, env `APP_WEB_ORIGIN`, право `tickets.checkin`, ADR-0023, `docs/product/tickets.md` |
| B | `feature/event-tickets-app` | экран билета `/tickets/[code]` (QR, офлайн-копия), «Открыть билет» в «Ваше участие» гонки, регистрация на старт календаря, блок «Ваши билеты» на Главной |
| C | `feature/event-tickets-panel` | API + панель: блок «Билеты» в гонке и старте календаря, «Материалы» (CRUD, PDF), экран «Check-in» (камера + ввод кода); материалы на билете и в карточке события (приложение) |
| D | `feature/event-tickets-reminders` | напоминания: настройка у события (панель), регламент worker, уведомление `event_reminder` (центр/push/e-mail), группа «Мероприятия» в настройках приложения |
| E | `feature/event-tickets-wallet` | Apple Wallet `.pkpass` и Google Wallet save-link — сервер по env, кнопка только при конфигурации |

## 4. Out of Scope

- Билеты кофе-райдов (T1), платные билеты, лист ожидания, перенос билета другому человеку.
- Push-обновление Wallet-пассов (APNs pass updates, Google object PATCH) — после реальных сертификатов.
- Сканер в приложении райдера (камера — только панель, web).
- Отдельный раздел «Мои билеты» в табах — вход с карточки события и Главной (запрет «новый раздел без нужды»).
- QR в письме.

## 5. Architecture Context

### 5.0 Что было (анализ 2026-10-29)

- Гонка (`races`) — виртуальная: окно + коридор; времени и места старта нет (Q8). Заявка — `race_entries`
  (`results`): `active|withdrawn`, `tier`, `groupKey`, повторной заявки нет; отменить можно, пока окно открыто.
  Отмена гонки — `status: cancelled`.
- Старт календаря (`calendar_starts`) — внешний анонс: даты, `startTime`, город, `place`, `distancesKm` (1–5),
  внешняя `registrationUrl`; ведёт admin (`calendar.manage`); снятие с публикации — `status`.
- Кофе-райд — «Я иду» внутри документа райда; организатор — райдер без панели.
- Почта: outbox → очередь модуля → `MAILER` (`identity/mail/*`, `notifications/notification-email.ts`); https-базы
  приложения в env нет (`APP_LINK_BASE` = `pokatim://`), письма уведомлений без ссылок.
- Уведомления: outbox `тип → одна очередь`, intake читает получателей через порт источника; e-mail — белый список
  kinds; регламенты — `upsertJobScheduler`.
- Файлы: аватары в Mongo (`Binary`, id = случайный токен, публично, CSP sandbox). QR-библиотек нет.
- PWA: SW кеширует только статику; офлайн-данных нет.

### 5.1 Модуль `tickets` (новый, `apps/api/src/modules/tickets`)

Потребитель: импортирует `races`, `calendar`, `results` (новый порт `RESULTS_FOR_TICKETS`: активная/снятая заявка
райдера, заявки гонки пачкой), `profile` (имя для check-in), `identity` (e-mail, `randomToken`/`sha256`), `panel`
(guard, аудит). Производители о `tickets` не знают (как `sharing`, `standings`). `notifications` (PR D) читает
напоминания через порт `TICKET_NOTICES`.

**Почему не хук в транзакции заявки:** `results.entry-created` уже маршрутизирован в `results-intake` (outbox — тип в
одну очередь), а зависимость `results → tickets` дала бы цикл. Поэтому билет гонки выпускается **сверкой**:
(1) лениво при чтении (`GET /v1/races/:id/ticket` — приложение зовёт его сразу после «Участвовать»), (2) регламентом
worker раз в минуту (ADR-0020 — прецедент reconcile-on-read). Письмо уходит из той транзакции, что выпустила билет
(outbox `tickets.issued` → очередь `tickets`).

### 5.2 Данные (миграция `0038_tickets`, номер сверить перед мержем)

- `event_ticketing` — настройки билетов события, `_id = "<kind>:<eventId>"`:
  `kind: 'race'|'calendar'`, `eventId`, `enabled`, `startsAt` (race — обязателен, внутри окна; calendar — из старта
  календаря), `endsAt|null`, `place` (race; calendar — из старта), `address|null`, `instructions|null` (≤ 2000),
  `capacity|null` (только calendar; null — без лимита), `registeredCount` (calendar), `reminders[]` (PR D),
  `version`, `updatedAt`, `updatedBy`.
- `event_registrations` — регистрация на старт календаря: `eventId`, `userId`, `distanceKm|null`,
  `status: active|cancelled`, `createdAt`, `cancelledAt`. Частичный уникальный `(eventId,userId)` при `active`.
  Повторная регистрация после отмены — новая запись и новый билет.
- `tickets`: `_id` uuidv7, `code` (уник., 10 символов Crockford base32 = 50 бит, показ `XXXXX-XXXXX`),
  `qrHash` (уник., sha256 QR-токена), `kind`, `eventId`, `registrationId` (уник.: id `race_entries` или
  `event_registrations`), `userId`, `category` (`{tier, groupKey}` | `{distanceKm}` | null), `status:
  active|checked_in|cancelled`, `checkedInAt`, `checkedInBy`, `cancelledAt`, `emailedAt`, `remindersSent[]` (PR D),
  `createdAt`, `version`. Индексы: `(userId, createdAt)`, `(kind, eventId, status)`.
- Статус `event_cancelled` **не хранится**: вычисляется при чтении из статуса события (гонка `cancelled`, старт
  снят с публикации или настройки выключены). Отменённый/снятый билет QR не проходит.
- `event_materials` (PR C): `kind`, `eventId`, `type`, `title` (≤ 120), `description|null` (≤ 1000),
  `url|null` (https), `fileId|null`, `order`, `createdAt`; `event_material_files`: `_id` = `randomToken`, `bytes`
  (Binary ≤ 10 МБ, сигнатура `%PDF-`), `contentType`, `fileName`, `size`.

### 5.3 Токены и безопасность

- **QR-токен** = `HMAC-SHA256(EMAIL_TOKEN_SECRET, "ticket-qr:" + ticketId)` base64url (43 символа), в БД — только
  `qrHash` для поиска; владельцу токен пересчитывается при чтении (паттерн `deriveLinkToken`, ADR-0002). Утечка БД
  не раскрывает токены. Содержимое QR: `PKT1.<token>` — ни user, ни event id.
- **Код билета** — случайный, не производный от id; показывается крупно, вводится вручную, если QR не читается;
  поиск по коду — только с правом check-in и лимитом частоты.
- Чтение билета — только владелец (`AuthGuard`, чужой/несуществующий — одинаковый 404). Ответы `no-store`.
- Публичные URL — только код билета (без ПДн, не секрет без входа); страница билета `noindex`.
- Check-in: право `tickets.checkin` (admin, organizer). Гонка — владелец или `races.manage_any`; старт календаря —
  admin (`calendar.manage`). Чужое событие — тот же 404, что «не найдено». Лимит: 120 запросов/мин на сессию.
- Аудит панели: «Участник отмечен» (объект — событие, `Билет ·<код>`), без имени и e-mail.

### 5.4 Жизненный цикл и правила

- Билет гонки: есть `active` заявка + `event_ticketing.enabled` → билет `active`. Заявка `withdrawn` → `cancelled`
  (сверка и ленивое чтение). Включение билетов после заявок — сверка выпускает билеты всем активным заявкам (письма
  тоже).
- Регистрация на старт календаря: только `enabled` + опубликован + до `startsAt`; `capacity` — счётчик в
  транзакции (`409 EVENT_FULL`); отмена — до `startsAt`; билет выпускается в той же транзакции.
- Check-in: токен → билет; `active` → можно отметить (окно: от `startsAt − 24 ч` до `endsAt ?? startsAt + 12 ч`);
  `checked_in` → ответ «уже отмечен» с временем и кем (имя сотрудника); `cancelled`/`event_cancelled` → отказ.
  Отметка — условный update `status: active → checked_in` (повторный параллельный скан — «уже отмечен»).
- Прошедшее событие: билет остаётся в истории со статусом, QR скрыт («Событие завершено»).

### 5.5 API (contracts-first, `packages/contracts/src/tickets`)

PR A:
- `GET /v1/races/:raceId/ticket` (Auth) → `MyTicketRef | null` (ленивый выпуск).
- `GET /v1/calendar/:id/registration` (Auth) → `{ registration, ticket } | null`;
  `POST /v1/calendar/:id/registration` `{ distanceKm? }` → 201; `POST …/registration/cancel`.
- `GET /v1/tickets` (Auth) → предстоящие и недавние билеты (`upcoming|past`, курсор);
  `GET /v1/tickets/:code` (Auth, владелец) → `TicketView` (событие, даты, место, адрес, участник, категория, код,
  `qr`, статус, `instructions`, `materials` (PR C), `wallet` (PR E)).
- Панель: `GET|PUT /v1/admin/events/:kind/:eventId/ticketing` (`races.manage` своих / `calendar.manage`, версия);
  `POST /v1/admin/tickets/lookup` `{ qr } | { code }` → `CheckInView`; `POST /v1/admin/tickets/check-in`
  `{ qr } | { code }` → `CheckInView`; `GET /v1/admin/events/:kind/:eventId/tickets` — список участников со
  статусами (минимальная таблица).

PR C: `GET|POST|PATCH|DELETE /v1/admin/events/:kind/:eventId/materials[/:id]`, `POST …/materials/files` (PDF),
`GET /v1/event-files/:fileId` (публично, `immutable`, `Content-Disposition`, CSP sandbox, nosniff);
`GET /v1/events/:kind/:eventId/materials` (публично — материалы на карточке события).

PR D: `PUT …/ticketing` с `reminders: [{ id, offsetHours (1–168), text (≤ 500) }]` (≤ 3).
PR E: `GET /v1/tickets/:code/wallet/apple` (pkpass), `POST /v1/tickets/:code/wallet/google` → `{ url }`.

### 5.6 Письмо «Вы зарегистрированы» (PR A)

Outbox `tickets.issued {ticketId}` → очередь `tickets` → `ticket-email.ts` (HTML + text, хелперы `htmlEmail`/
`buttonHtml`/`escapeHtml` из `identity`): тема «Вы зарегистрированы: {событие}»; название, дата и время (Минск),
место и адрес, группа/дистанция, код билета, кнопка «Открыть билет» → `${APP_WEB_ORIGIN}/tickets/<код>` (нет env —
без кнопки, с текстом «Билет — в приложении «Покатим»»), инструкции, материалы (PR C — список ссылок). Идемпотентно
по `emailedAt`. Письмо уходит всегда (транзакционное), настройки уведомлений не влияют. Пользователь без e-mail
невозможен (регистрация по e-mail) — письмо пропускается, если адрес стёрт (удаление аккаунта).

### 5.7 Приложение (PR B)

- `/tickets/[code]` в `Stack.Protected`: крупно — событие, тип, дата и время, место/адрес, участник, группа/
  дистанция, код, QR (`qrcode` → матрица → `react-native-svg` Path; SSR-safe); статусы; действия «Маршрут/место»
  (карта/внешние карты по адресу), «О событии» (карточка), «Поделиться» (код и ссылка на событие, без QR),
  материалы (PR C), Wallet (PR E — только при `wallet.*`).
- Офлайн: последний успешный `TicketView` кешируется на устройстве (native — `expo-secure-store` (≤ 2 КБ на ключ —
  иначе файл), web — `localStorage`) под ключом пользователя; показывается при сетевой ошибке с пометкой «Офлайн-
  копия от …»; стирается при выходе. Риск: токен QR на устройстве владельца — допустим (тот же, что показывается
  на экране).
- Вход: «Ваше участие» гонки — «Открыть билет»; карточка старта календаря — «Зарегистрироваться» (выбор
  дистанции) / «Открыть билет» / «Отменить регистрацию»; Главная — блок «Ваши билеты» (только при наличии
  предстоящих).

### 5.8 Wallet (PR E)

- Apple: `.pkpass` (pass.json eventTicket + manifest SHA-1 + PKCS#7 detached подпись). Env: `APPLE_WALLET_PASS_TYPE_ID`,
  `APPLE_WALLET_TEAM_ID`, `APPLE_WALLET_CERT_P12_BASE64` + пароль, `APPLE_WALLET_WWDR_PEM_BASE64`. Нет env — кнопки нет.
- Google: JWT RS256 (`jose`) с `eventTicketClasses`/`eventTicketObjects` → `https://pay.google.com/gp/v/save/<jwt>`.
  Env: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_WALLET_PRIVATE_KEY_BASE64`.
- Штрихкод в пассе — тот же `PKT1.<token>`.

## 5.1 Placement & Reuse Gate

- Новый модуль `tickets` — отдельный bounded context (регистрация календаря + билеты + check-in + материалы).
  Расширять `results` нельзя (цикл и чужая ответственность), `calendar` — анонсы без участников.
- Reuse: `randomToken`/`sha256`/HMAC-паттерн (`identity`), почтовые хелперы `identity/mail/html.ts`, `PanelGuard`/
  `RequirePermission`/`PanelAudit`, `races.policy` (видимость своих), Mongo Binary-хранение как `profile_avatars`,
  регламенты `upsertJobScheduler`, `notifications` intake + порт источника.
- Новые зависимости: `qrcode` (app, генерация матрицы), `jsqr` (admin, распознавание кадров камеры),
  `passkit`-подпись — `node-forge` (api, PR E). Выбор подтверждает architect.


**Architect (PR A, 2026-10-29) — gate подтверждён с поправками:**

- Граф без циклов (проверено по коду): `tickets → results` (`ResultsCoreModule`, реэкспортирует `RacesCoreModule` —
  порт `RACE_REGISTRY` уже читают `results` и `disputes`), `calendar` (`CalendarCoreModule`, **новый** порт
  `CALENDAR_EVENTS` — сейчас `calendar/index.ts` отдаёт только модули и `CalendarOverview`), `profile`
  (`ProfileCoreModule`, `RIDER_NAMES.attributionNames` — имя профиля без условия согласия, как нужно для check-in),
  `identity` (`IdentityModule` — `AuthGuard`; `IdentityAccountsModule` — `emailsOf`/`liveUserIds` в worker), `panel`
  (`PanelModule`). На `tickets` ссылаются только `AppModule`, `WorkerModule` и `account` (порт стирания, см. 8.1 RC-T1).
  Ни один из импортируемых модулей `tickets` не импортирует.
- Три Nest-модуля по образцу `results`/`route-rides`: `TicketsCoreModule` (репозиторий, `TicketIssuer`,
  `RaceTickets` (сверка), `TicketEvents`, `TicketErasure`), `TicketsModule` (HTTP), `TicketsWorkerModule` (очереди).
- QR-токен — локальная функция `ticket-qr.ts` (HMAC `EMAIL_TOKEN_SECRET`, префикс `ticket-qr:`), не расширение
  `identity.LinkPurpose`: `deriveLinkToken` не экспортируется и обслуживает ссылки писем identity.
- `buttonHtml` из `identity/mail/html.ts` **не экспортирован** из `identity/index.ts` — дописать экспорт (как
  `escapeHtml`/`htmlEmail` для N2).
- `consumeUserLimit` уже скопирован в `results/entries.service.ts` и `notifications/notifications.service.ts` —
  третьей копии не делать: вынести в `src/user-limit.ts` (композиция, как `public-read.guard.ts`) и переключить оба
  места на импорт (механическая правка).
- Зависимостей npm в PR A нет (QR-матрица — PR B, `jsqr` — PR C, `node-forge`/`jose` — PR E: решение — в своих PR).

## 6. Relevant Files

`apps/api/src/modules/{races,results,calendar,notifications,panel,identity,profile}`, `apps/api/src/db/migrations`,
`apps/api/src/config/env.ts`, `packages/contracts/src/{admin,notifications}`, `apps/app/src/features/{races,calendar,home}`,
`apps/app/src/app/{races,calendar}`, `apps/admin/src/{router.tsx,features/races,features/calendar}`.

## 7. Implementation Notes

- Порядок PR: A → B, C → D → E (B и C независимы после A).
- Списки `PERMISSIONS`, `AUDIT_ACTIONS`, `NOTIFICATION_KINDS`, цели уведомлений — только дописывать в конец.
- `APP_WEB_ORIGIN` — optional env (origin https); dev — `https://pokatim-dev.limedolphin.com`.

## 8. Risks / Assumptions / Open Questions

- [ASSUMPTION] Окно check-in: `startsAt − 24 ч` … `endsAt ?? startsAt + 12 ч`.
- [ASSUMPTION] Сверка билетов гонок — раз в минуту; письмо приходит ≤ 1–2 мин после заявки (или сразу, если
  приложение открыло «Ваше участие»).
- [ASSUMPTION] Имя участника в check-in — имя профиля без учёта согласия на публичный показ (служебный просмотр
  с правом); нет имени — «Участник» + маскированный e-mail (`r***@gmail.com`).
- [ASSUMPTION] Регистрация на старт календаря — без анкеты; дистанция обязательна, если у старта их > 1.
- Ротация `EMAIL_TOKEN_SECRET` инвалидирует все QR — описать в runbook.
- Миграции параллельных сессий: номер сверить перед каждым мержем.

## 8.1 Requirements Consistency (заполняет architect)

Status architect: **CONCERNS** (блокеров нет). Каждая находка — с рекомендацией (R), её coder принимает по умолчанию,
если человек не решит иначе. Решения T1–T4 не пересматриваются.

- **RC-T1 Удаление аккаунта (конфликт с правилом `pokatim-backend.md`: «новый модуль с данными пользователя — порт
  стирания и шаг»).** Spec не упоминает. `tickets`/`event_registrations` хранят `userId`. R: в PR A —
  `TicketErasure.erase(userId, now)` (`TicketsCoreModule`): активные регистрации → `cancelled` (с `registeredCount −1`
  и билетом `cancelled` в одной транзакции на регистрацию), активные билеты гонок → `cancelled`; документы остаются
  псевдонимными (как `race_entries`). Шаг `tickets` в `AccountErasureService` **перед** `notifications`; сверка гонок
  не выпускает билеты удалённым (`IdentityAccounts.liveUserIds`) и не «воскрешает» `cancelled` (уникальный
  `registrationId`). Альтернативы: (б) удалять документы — ломает счётчики и журнал check-in; (в) отложить —
  нарушение правила.
- **RC-T2 Старт календаря без времени.** `calendar_starts.startTime` — `HH:mm | null`, а регистрация закрывается «до
  `startsAt`», check-in окно — от `startsAt`. R: `startsAt`/`endsAt`/`place` для календаря **не хранить** в
  `event_ticketing` — вычислять на чтении через порт `CALENDAR_EVENTS` (правка старта не оставляет устаревшую копию;
  `calendar` о билетах не знает): `startsAt = minskWallTimeToUtc(startsOn + startTime)`; включить билеты без
  `startTime` — `409 TICKETING_INVALID_STATE {reason:'start_time_required'}`; если время стёрли позже —
  `minskDayStartUtc(startsOn)` (консервативно); `endsAt` — конец дня `endsOn` (Минск) или `null`. Альтернативы:
  (б) поле `startsAt` в настройках календаря (две правды); (в) полночь без запрета (регистрация закроется раньше дня
  старта — неожиданно).
- **RC-T3 Окно гонки vs очный старт.** Окно гонки правится до первой заявки (V-12); `races` о билетах не знает, после
  правки окна `startsAt` может оказаться вне окна. R: проверка «внутри окна» — только на `PUT` (`422
  VALIDATION_FAILED`, поле `startsAt`); чтение показывает как есть; панель (PR C) — предупреждение. Альтернатива — гейт
  в `races` (зависимость `races → tickets` — цикл), отвергнуто.
- **RC-T4 Выпуск после старта.** Окно гонки бывает длиннее очного старта (заявка после очного старта). R: сверка и
  ленивое чтение выпускают билет (и письмо), пока `now < checkInClosesAt` (`endsAt ?? startsAt + 12 ч`); после — не
  выпускают, событие «прошло». Отмена гонки (`status: cancelled`) — не выпускают.
- **RC-T5 Смена группы заявки после выпуска** (START → Verified меняет `tier/groupKey`). Spec молчит. R: сверка и
  ленивое чтение обновляют `category` активного билета без нового письма и без смены кода.
- **RC-T6 Выключение билетов после выпуска** даёт всем `event_cancelled` (§5.2). Обратимо (статус не хранится) — это
  плюс. R: оставить как в spec; `PUT` отвечает `activeTickets` (число), панель PR C показывает подтверждение с числом.
  Регистрации календаря при выключении не отменяются (включили снова — билеты живы). Уменьшение `capacity` ниже
  `registeredCount` — `409 TICKETING_INVALID_STATE {reason:'capacity_below_registered'}`.
- **RC-T7 Публичная сводка регистрации (gap для PR B).** Карточка старта календаря у гостя и райдера должна знать, что
  «Регистрация в Покатим» включена, сколько мест и до какого момента, а `calendar` о билетах не знает; в §5.5 такого
  чтения нет. R: в PR A — `GET /v1/events/:kind/:eventId/ticketing` (публично, `PublicReadGuard`,
  `PUBLIC_READ_CACHE_CONTROL`) → `EventTicketingPublic { enabled, startsAt, endsAt, place, address, capacity,
  seatsLeft, registrationOpen, distancesKm }`; без включённых билетов — `{ enabled: false }` (не 404 — статус события
  отдаёт `calendar`/`races`). Альтернатива — поле в `CalendarStartDetail` (зависимость `calendar → tickets`, цикл).
- **RC-T8 Список «Мои билеты» с курсором.** Дата события живёт в `races`/`calendar` (не денормализуется — см. RC-T2),
  курсор по дате события без копии невозможен. R: `GET /v1/tickets` → `MyTickets { upcoming, past }` без курсора:
  `upcoming` — все (предел `TICKETS_POLICY.listMax = 50`), `past` — последние 20 по дате события; сортировка на
  сервере после резолва событий пачками (`RaceRegistry.getMany`, `CalendarEvents.getMany`). Отклонение от «курсор» в
  §5.5 — записать в 8.2.
- **RC-T9 Права панели на `:kind`.** `@RequirePermission` — одно право на маршрут, а здесь право зависит от `kind`
  (`races.manage` | `calendar.manage`). R: на маршрутах настроек — `PanelGuard` без права, проверка в сервисе одной
  чистой функцией `eventAccess(principal, kind, purpose)` → `403 FORBIDDEN` (нет права) / `404 NOT_FOUND` (чужая
  гонка — `RaceRegistry.findForPanel`); на check-in и списке участников — `@RequirePermission('tickets.checkin')` +
  та же функция (календарь — ещё `calendar.manage`, иначе 404). Список участников (`GET …/tickets`, ПДн — имена) —
  право `tickets.checkin`, не `races.read` (модератор его не видит). Тесты 403/404 — на каждую ручку.
- **RC-T10 Аудит.** Spec: только «Участник отмечен». Все мутации панели журналируются (правило журнала). R: два
  действия в конец `AUDIT_ACTIONS`: `tickets.settings_updated` (subject — событие, `details.changedFields`) и
  `tickets.checked_in` (subject — событие, label — название события; код — новое поле `details.ticketCode`, без имени
  и e-mail). Subject `calendar_start` уже есть.
- **RC-T11 Идемпотентность письма.** «По `emailedAt`» недостаточно при параллельной доставке. R: как
  `LinkEmailHandler`/`EmailDelivery` — захват `email.state: pending → sending` с `claimedUntil` одним
  `findOneAndUpdate`, `sent` + `sentAt` после SMTP, сбой — `pending` (последняя попытка — `failed` + лог
  `tickets.email_failed ticket=<id>`). Видимость провала: колонка «Письмо» (`emailState`) в списке участников панели.
- **RC-T12 Очереди.** Spec — одна очередь `tickets`. R: две, по образцу `results-intake`/`results-maintenance`:
  `tickets-email` (outbox `tickets.issued`, jobId = id события) и `tickets-maintenance` (регламент
  `tickets.reconcile` `* * * * *` Минск + `tickets.reconcile.boot` при старте) — письма не стоят за сверкой.
- **RC-T13 `APP_WEB_ORIGIN` на dev.** API читает `infra/.env`; его ключи деплоя пишет `infra/deploy/bootstrap.sh`
  (`MANAGED_KEYS`). R: добавить `APP_WEB_ORIGIN=https://${PUBLIC_HOST}` в управляемые ключи (+ комментарий
  `env.template`), прод — тот же механизм. Иначе на dev кнопки в письме не будет.
- **RC-T14 Web Push в T3 vs `AGENTS.md` §1 («web push нет», ADR-0017).** Касается PR D, не A. R: в PR D — только каналы,
  уже существующие на момент PR D; Web Push — после ADR/мержа той сессии. Для PR A — без действий.
- **RC-T15 Модель не блокирует B–E (проверено):** `reminders[]`/`remindersSent[]` — новые поля с чтением `?? []`
  (миграция не нужна); `materials`/`wallet` в `TicketView` — опциональные поля ответа (`tolerant`); PUT настроек в PR
  D — «нет поля `reminders` — не трогать»; Wallet использует тот же `qrPayload`; порт `TICKET_NOTICES` (PR D) читает
  `tickets` через репозиторий модуля.

## 8.2 Deviations from spec

PR A (coder, 2026-10-29). Одобрены architect (§8.1):

- Две очереди вместо одной `tickets`: `tickets-email` (outbox `tickets.issued`) и `tickets-maintenance` (регламент
  `tickets.reconcile`) — RC-T12.
- `GET /v1/tickets` без курсора: `{ upcoming (≤ 50, дата ↑, без отменённых райдером), past (≤ 20, дата ↓) }` из
  последних 200 билетов — RC-T8.
- Индекс `tickets_event_idx (kind, eventId, _id)` вместо `(kind, eventId, status)` из §5.2 (сверка и курсор участников).
- Публичный `GET /v1/events/:kind/:eventId/ticketing` → `EventTicketingPublic` — RC-T7.
- `APP_WEB_ORIGIN` на dev (RC-T13, итог после слияния с `develop`): `infra/deploy/docker-compose.yml` передаёт API
  `APP_WEB_ORIGIN: ${WEB_ORIGIN:?}` (env API — явный список; `WEB_ORIGIN = https://<хост>` выставляет каждый деплой).
  `bootstrap.sh` и `env.template` не менялись (откатаны к `develop`).
- Шаг стирания `tickets` в `account` (перед `notifications`) — RC-T1.

Решения coder в рамках spec (без смены поведения AC):

- `GET /v1/calendar/:id/registration` отвечает `CalendarRegistrationState { registration, ticket }` с обоими `null`
  вместо `null` целиком (одна схема для GET/POST/cancel); `registration` — только активная.
- Правила полей настроек (RC-T3 и др.) — `400 VALIDATION_FAILED` с `details.fields`, как остальные поля панели
  (`OUTSIDE_SEASON`, `DATE_ORDER`), а не `422` из RC-T3.
- Настройки и участники гонки — только для `published|cancelled` гонок (`RACE_REGISTRY.get`); черновик — 404
  (включить билеты — после публикации).
- `normalizeTicketCode`/`formatTicketCode` — в контрактах (`ticket.schema.ts`, общий для приложения и панели), а не в
  `tickets.policy.ts`.
- Имя участника в check-in и списке без имени профиля — «Участник · r***@gmail.com» (§8 ASSUMPTION), удалённый —
  «Участник»; в `TicketView` владельца — «Участник».
- Перед показом и check-in билет гонки сверяется с заявкой (`RaceTickets.refresh`): снятая заявка отменяет билет сразу,
  не дожидаясь регламента (AC3 «QR отклоняется»).
- `TicketErasure.erase(userId)` берёт время из `CLOCK` (без параметра `now`).
- ADR билетов — `docs/adr/0023-event-tickets.md` (номера 0021/0022 заняты в `develop`).

Ревью pass 1 (coder, 2026-10-29):

- Отмена регистрации календаря после отметки — `409 EVENT_REGISTRATION_CLOSED { reason: 'checked_in' }` (новое
  значение в конец `EVENT_REGISTRATION_CLOSED_REASONS`); отмена участия в гонке после отметки — разрешена, билет
  остаётся `checked_in` (ADR-0023 п. 8).
- Check-in сериализуется с отменой замками в транзакции (настройки, заявка — новый метод порта
  `ResultsForTickets.lockEntryForTicket`, регистрация); отмена гонки и снятие старта календаря — остаточный риск
  (ADR-0023 п. 8).
- Очное событие гонки — не дольше 7 суток (`endsAt` — `400 INVALID`); регламент читает гонки со стартом позже
  `now − 7 сут`, индекс `event_ticketing_enabled_idx { kind, enabled, startsAt }` (миграция `0037` ещё не в `develop`).
- Письмо под чужим живым захватом — задача откладывается до конца захвата (`moveToDelayed` + `DelayedError`).

Ревью pass 2 (coder): окно check-in перепроверяется в транзакции по настройкам под замком и `CLOCK`; новый метод порта
`CALENDAR_EVENTS.lockForAdmission` (запись `calendar_starts.admissionLock`) — регистрация, её отмена и check-in
календаря перепроверяют публикацию, момент старта и дистанцию под замком старта; runbook — ротация
`EMAIL_TOKEN_SECRET` (два состояния, процедура с пересчётом `qrHash`). Тесты — пауза перед транзакцией: снятие с
публикации, перенос в прошлое и правка дистанций (регистрация), перенос старта гонки и календаря (check-in).

Ревью pass 3 (coder): check-in гонки захватывает документ гонки (`RACE_REGISTRY.lockResults`) и проверяет
`published` — отмена гонки между проверкой и отметкой даёт `event_cancelled` (остаточного риска нет); регламент
сверяет гонки со стартом позже `now − 61 сут`, выпуск — только в окне check-in, отмены снятых заявок — пока открыто окно
гонки + сутки (заявку можно снять до закрытия окна гонки; сутки — запас на отставание регламента).

PR C (coder, 2026-10-29, ветка `feature/event-tickets-panel`). Решения RC-C1…RC-C9 `plan-C.md` приняты по умолчанию:

- RC-C1 — одна страница «Билеты и материалы» (`/races/:id/tickets`, `/calendar/:id/tickets`: настройки, материалы,
  участники) + компактный блок «Билеты» на опубликованной гонке (`Can races.manage`) и в rail календаря.
- RC-C2 — «Check-in» — отдельная защищённая ветка `checkInLayoutRoute` без сайдбара (тот же `requireSession`), от
  360 px, две колонки от 900 px; пункт сайдбара после «Календаря».
- RC-C3 — PDF отдаётся `attachment` + `default-src 'none'; sandbox` + `nosniff` + `no-referrer`.
- RC-C4 — исключение из «файлы — подписанные URL» записано в ADR-0023 п. 10.
- RC-C5 — тип — тема, содержимое — одно из: ссылка | PDF | только текст; правило — `materialContentIssues` в
  контрактах (форма, `superRefine` схемы и сервер). Дополнение coder: файл у `link`/`gpx`/`text` — `type: INVALID`.
- RC-C6 — `POST …/materials/files` создаёт материал вместе с файлом в одной транзакции (сирот нет).
- RC-C7 — удаление `POST …/materials/:id/delete` (204), порядок `PUT …/materials/order`, правка `PATCH …/:id` —
  вместо `DELETE` из §5.5.
- RC-C8 — `tickets.material_added|updated (changedFields)|removed`, `tickets.materials_reordered` (subject — событие);
  показ `details.ticketCode` («Участник отмечен: Билет ·XXXXX-XXXXX») в «Журнале действий».
- RC-C9 — публичный список — для гонки `published|cancelled` и опубликованного старта независимо от `enabled`; файл
  событие не проверяет.

Отклонения и решения coder (PR C):

- Миграция — `0039_event_materials` (в плане `0038`, занят билетами PR A).
- Индекс `event_materials_event_order_unique { kind, eventId, order }` — **уникальный** (в плане — обычный):
  параллельные добавления конфликтуют, лимиты 20/10 считаются без гонки; перестановка — через временные отрицательные
  позиции. Перестановка версию материалов не меняет (диалог правки не получает ложный 409).
- Кривой id файла `GET /v1/event-files/:id` — тот же 404 (не 400 ZodValidationPipe).
- Чтение материалов для участников — `MaterialsRead` (`TicketsCoreModule`: публичный список, `TicketView`, письмо);
  в письме текстовые материалы — «Название: описание».
- Путь `…/materials/:materialId` — схема `EventMaterialParams` в контрактах.
- Подписи изменённых полей в журнале для действий `tickets.*` — `admin.tickets.field.*` (а не полей гонки/старта).
- **§7 плана (приложение `apps/app`) не сделано**: по указанию оркестратора `apps/app/**` в этой ветке не трогать
  (параллельно PR B). Готово для него: `api.getEventMaterials(kind, id)`, `api.eventFileUrl(fileId)`,
  `TicketView.materials`. Компонент `event-materials`, блок на карточках гонки и календаря и на экране билета —
  в PR B или следующем PR (AC9 «на билете и в карточке события» — серверная часть и письмо готовы, UI приложения нет).

## 8.3 Security checklist

Затронуто: токены (QR), публичные URL, файлы (PDF), права панели, письма со ссылками. См. §5.3.

## 9. Acceptance Criteria

- AC1 Заявка на гонку с включёнными билетами → ровно один `active` билет; повторное чтение/сверка не создаёт второй.
- AC2 Заявка на гонку без билетов → билета нет; включение билетов → билеты всем активным заявкам + письма.
- AC3 Отмена заявки / регистрации → билет `cancelled`, QR отклоняется.
- AC4 Отмена гонки / снятие старта → `event_cancelled` в чтении, QR отклоняется.
- AC5 Чужой билет и несуществующий код — одинаковый 404; гостю — 401.
- AC6 Check-in: без права — 403; организатор чужой гонки — 404; валидный QR → `checked_in` + `checkedInAt/By`;
  повторный — «уже отмечен»; отменённый — отказ; параллельные сканы — одна отметка.
- AC7 Письмо: тема, событие, дата, место, категория, код, кнопка на `/tickets/<код>` (при `APP_WEB_ORIGIN`), без QR
  и без токена; один раз на билет.
- AC8 Регистрация календаря: лимит мест (`EVENT_FULL`), закрыта после старта, повтор после отмены — новый билет.
- AC9 (C) Материалы: CRUD с правом, порядок, PDF только `%PDF-` ≤ 10 МБ, отдача с CSP sandbox; на билете и в
  карточке события.
- AC10 (D) Напоминание уходит один раз на билет и правило; не уходит отменённым и выпущенным после времени
  отправки; текст из настроек события.
- AC11 (E) Без env кнопок Wallet нет; с env — валидный pkpass (подпись проверяется) и JWT.
- AC12 Приложение: билет на iOS/Android/web; офлайн-копия при сетевой ошибке; стирается при выходе.

## 10. Documentation Impact

ADR-0023 «Билеты и check-in»; `docs/product/tickets.md`; `admin-panel.md` (право, разделы, журнал);
`notifications.md` (группа «Мероприятия», событие); runbook: env `APP_WEB_ORIGIN`, Wallet-сертификаты.


Дополнения architect (PR A): `.claude/rules/pokatim-backend.md` — раздел «Билеты (`tickets`)» (граф, порты
`RESULTS_FOR_TICKETS`/`CALENDAR_EVENTS`, сверка, очереди, лимиты); `pokatim-db.md` — коллекции и индексы `0037`;
`pokatim-contracts.md` — `src/tickets/*`; `docs/product/admin-panel.md` — право `tickets.checkin`, действия журнала;
`docs/runbooks/deploy.md` — `APP_WEB_ORIGIN` (bootstrap), ротация `EMAIL_TOKEN_SECRET` → пересчёт `qrHash`;
`docs/runbooks/account-deletion.md` — шаг `tickets`; `docs/adr/README.md` — индекс ADR-0023.

## 11. Implementation Context

Только PR A (`feature/event-tickets-api`). Security checklist (§8.3) — **обязателен** (затронуты `config/env.ts`,
`db/**`, `app.module`/`worker.module`, `error-messages.ts`, `infra/deploy/**`, токены, права панели).

**ENTRY POINTS**

- App (AuthGuard, `no-store`): `GET /v1/races/:raceId/ticket` → `RaceTicketController` → `RaceTickets.myTicket`;
  `GET|POST /v1/calendar/:id/registration`, `POST …/registration/cancel` → `CalendarRegistrationController` →
  `CalendarRegistrationService`; `GET /v1/tickets`, `GET /v1/tickets/:code` → `TicketsController` →
  `TicketsReadService`.
- Публично: `GET /v1/events/:kind/:eventId/ticketing` → `TicketingPublicController` (`PublicReadGuard`, RC-T7).
- Панель (`PanelGuard`): `GET|PUT /v1/admin/events/:kind/:eventId/ticketing`, `GET …/tickets` →
  `TicketingAdminController` → `TicketingAdminService`; `POST /v1/admin/tickets/lookup|check-in` →
  `CheckInController` → `CheckInService`.
- Worker: `TicketsEmailProcessor` (`tickets-email`), `TicketsMaintenanceProcessor` + `TicketsSchedules`
  (`tickets-maintenance`).

**FILES TO CREATE** — `apps/api/src/modules/tickets/`

| Файл | Содержание |
|---|---|
| `index.ts` | `TicketsCoreModule`, `TicketsModule`, `TicketsWorkerModule`, `ticketsOutboxRoutes`, `TicketErasure` |
| `tickets.module.ts` | Core: imports `ResultsCoreModule`, `CalendarCoreModule`, `ProfileCoreModule`, `IdentityAccountsModule`; HTTP: + `IdentityModule`, `PanelModule`, `PublicReadGuard`; Worker: + `BullModule.registerQueue(ticketsEmail, ticketsMaintenance)` |
| `tickets.collection.ts` | `TICKETS_COLLECTIONS = { ticketing: 'event_ticketing', registrations: 'event_registrations', tickets: 'tickets' }`; `EventTicketingDoc`, `EventRegistrationDoc`, `TicketDoc` (+ `email: { state, claimedUntil, sentAt }`), `ticketsCollections(db)` |
| `tickets.repository.ts` | единственный писатель трёх коллекций: `findTicketing`, `upsertTicketing(tx, doc, expectedVersion)`, `enabledRaceTicketings()`, `reserveSeat(tx, eventId)` (условный `$inc` при `capacity: null` или `registeredCount < capacity`), `releaseSeat`, `insertRegistration`, `cancelRegistration(tx, id, now)` (условно `active`), `insertTicket`, `ticketsOfEvent(kind, eventId)`, `cancelTicket`, `setCategory`, `markCheckedIn(tx, id, staffId, now)` (условно `status: active`), `findByCode`, `findByQrHash`, `findOwnByCode(userId, code)`, `ticketsOfUser(userId, max)`, `claimEmail`/`settleEmail`, `eraseUser` |
| `tickets.policy.ts` (+ `.test.ts`) | `TICKETS_POLICY` (лимиты, `codeLength: 10`, `checkInOpensBeforeMs: 24 ч`, `defaultDurationMs: 12 ч`, `listMax: 50`, `pastMax: 20`, `instructionsMax: 2000`, `emailLeaseMs`); `generateTicketCode()` (crypto, Crockford), `normalizeTicketCode(input)` (верхний регистр, `I/L→1`, `O→0`, без `-`), `formatTicketCode`; `ticketStatus(doc, event, now)` → `TicketStatus`; `checkInWindow(event)`; `isPast(event, now)`; `raceReconcilePlan(entries, tickets, event, now)` → `{ issue[], cancel[], recategorize[] }`; `registrationGate(event, ticketing, now)`; `eventAccess(principal, kind, purpose)`; `maskEmail` |
| `ticket-qr.ts` (+ `.test.ts`) | `ticketQrToken(secret, ticketId)` = HMAC-SHA256 base64url `ticket-qr:<id>`; `qrPayload(token)` = `PKT1.<token>`; `parseQrPayload(s)`; `qrHashOf(token)` = `sha256` из `identity` |
| `ticket-events.ts` | `TicketEvents` — `EventFacts { kind, id, title, state: 'scheduled'\|'cancelled', startsAt, endsAt, place, address, city, distancesKm, ownerUserId }` из настроек + `RACE_REGISTRY`/`CALENDAR_EVENTS`; `resolve(kind, id)`, `resolveMany(refs)`; `cancelled` = гонка `cancelled` / старт не `published` / `enabled: false` |
| `tickets.events.ts` | `TICKETS_ISSUED = 'tickets.issued'`, `TicketsIssued = z.object({ ticketId: z.uuid() })`, `ticketsOutboxRoutes = { [TICKETS_ISSUED]: QUEUE.ticketsEmail }` |
| `ticket-issuer.ts` | `TicketIssuer.issue(tx, { kind, eventId, registrationId, userId, category, now })` → `TicketDoc` (uuidv7, код, `qrHash`, outbox `tickets.issued`); повтор при `isDuplicateKey(…, 'tickets_code_unique')` — новая транзакция, ≤ 3 раз |
| `race-tickets.ts` | `RaceTickets` (Core — общий для HTTP и worker): `myTicket(userId, raceId)` (лимит `tickets-read:<uid>` 120/мин → `RACE_REGISTRY.get` (нет — 404) → настройки → `entryOf` → `reconcileOne` → `MyTicketRef \| null`); `reconcileRace(raceId, now)` (пачки `entriesPage` по 500, `liveUserIds`, план, транзакция на билет; дубль `tickets_registration_unique` — пропуск) |
| `calendar-registration.service.ts` | `get`, `register(userId, id, { distanceKm })` (лимит `tickets-register:<uid>` 20/ч → транзакция: `reserveSeat` первым → вставка регистрации → `TicketIssuer.issue`; активная уже есть — `200` с ней), `cancel` (до `startsAt`; транзакция: регистрация → билет → `releaseSeat`) |
| `tickets-read.service.ts` | `list(userId)` → `MyTickets`; `view(userId, code)` → `TicketView` (чужой/нет — один 404; `qr` только при `active` и не `past`/`event_cancelled`; имя — `RIDER_NAMES.attributionNames`, нет — «Участник») |
| `ticketing-admin.service.ts` | `get`, `update` (транзакция: версия → валидация RC-T2/T3/T6 → запись → `PanelAudit` `tickets.settings_updated`), `participants(kind, eventId, cursor)` |
| `check-in.service.ts` | `lookup`/`checkIn(principal, { qr } \| { code })`: лимит `tickets-checkin:<sessionId>` 120/мин → билет (`qrHash`/код) → `eventAccess` (нет — 404) → исход; отметка — транзакция `markCheckedIn` + `PanelAudit` `tickets.checked_in`; проиграл условный update — `already_checked_in` |
| `ticket-erasure.ts` | `TicketErasure.erase(userId, now)` → `{ registrations, tickets }` (RC-T1), повторяемо |
| `race-ticket.controller.ts`, `calendar-registration.controller.ts`, `tickets.controller.ts`, `ticketing-public.controller.ts`, `ticketing-admin.controller.ts`, `check-in.controller.ts` | тонкие; zod-pipe по контрактам; `no-store` (кроме публичного) |
| `jobs/ticket-email.handler.ts`, `jobs/tickets-email.processor.ts` | по образцу `LinkEmailHandler`/`EmailDelivery` (RC-T11); адрес — `emailsOf` в момент отправки, нет — `skipped` |
| `jobs/tickets-maintenance.processor.ts` | `TICKETS_SCHEDULES` (`tickets.reconcile`, `* * * * *`, `tz: Europe/Minsk`), `TicketsSchedules.onApplicationBootstrap` (`upsertJobScheduler` + разовая `tickets.reconcile.boot`); отказ гонки — лог `tickets.reconcile_failed race=<id>`, остальные идут, в конце — исключение (failed-набор) |
| `mail/ticket-email.ts` (+ `.test.ts`) | `renderTicketEmail({ event, code, category, instructions, link \| null })` → `Omit<MailMessage,'to'>`; `htmlEmail`/`buttonHtml`/`escapeHtml` из `identity` |
| `*.int.test.ts` | см. TESTS |

**FILES TO MODIFY**

- `packages/contracts/src/admin/permissions.schema.ts` — `'tickets.checkin'` в конец; `admin/audit.schema.ts` —
  `'tickets.settings_updated'`, `'tickets.checked_in'` в конец, `details.ticketCode` (string, optional); их тесты.
- `packages/contracts/src/common.ts` — коды в конец: `EVENT_FULL` (409), `EVENT_REGISTRATION_CLOSED` (409,
  `details.reason: 'not_enabled' | 'unpublished' | 'started' | 'cancelled'`), `TICKETING_INVALID_STATE` (409,
  `details.reason: 'start_time_required' | 'capacity_below_registered' | 'event_cancelled'`).
- `packages/contracts/src/index.ts` — экспорт `tickets/*`.
- `packages/api-client/src/index.ts`, `admin.ts` (+ тесты) — методы новых ручек.
- `apps/api/src/queues.ts` — `ticketsEmail: 'tickets-email'`, `ticketsMaintenance: 'tickets-maintenance'`.
- `apps/api/src/app.module.ts` — `TicketsModule`; `worker.module.ts` — `...ticketsOutboxRoutes`, `TicketsWorkerModule`.
- `apps/api/src/error-messages.ts` — тексты трёх кодов.
- `apps/api/src/config/env.ts` — `APP_WEB_ORIGIN: optional(z.url({ protocol: /^https$/ }).refine(origin === origin))`
  (как `PUBLIC_API_ORIGIN`); `apps/api/.env.example`; `infra/deploy/bootstrap.sh` (`MANAGED_KEYS` + строка),
  `infra/deploy/env.template` (комментарий) — RC-T13.
- `apps/api/src/db/migrations/0038_tickets.ts` + `index.ts` + `migrations.int.test.ts`.
- `apps/api/src/user-limit.ts` (новый, перенос `consumeUserLimit`) ← `results/entries.service.ts`,
  `notifications/notifications.service.ts` (импорт вместо копии).
- `modules/results`: `results-for-tickets.port.ts`, `results-for-tickets.ts`, `results.module.ts` (provider/export),
  `index.ts`; `results.repository.ts` — `entriesPageOfRace(raceId, afterId, limit)` (проекция без попыток).
- `modules/races`: `race-registry.port.ts` + `race-registry.ts` — `getMany(raceIds)` (только `published|cancelled`).
- `modules/calendar`: `calendar-events.port.ts`, `calendar-events.ts`, `calendar.module.ts` (provide/export в
  `CalendarCoreModule`), `index.ts`; `calendar.repository.ts` — `findMany(ids)`.
- `modules/identity/index.ts` — экспорт `buttonHtml` (и `minskDateTime`, если coder берёт его для даты письма).
- `modules/panel/permissions.ts` — organizer: + `tickets.checkin` (admin — `PERMISSIONS` целиком); `panel.collection.ts`
  — `AuditDetailsDoc.ticketCode`; `permissions.test.ts`.
- `modules/account`: `account-erasure.service.ts` (шаг `tickets` перед `notifications`), `account.module.ts`
  (`AccountWorkerModule` + `TicketsCoreModule`), тип шага; `account-erasure.int.test.ts`.

**TYPES & SCHEMAS** (`packages/contracts/src/tickets/`)

- `ticket.schema.ts`: `TICKET_EVENT_KINDS = ['race','calendar']`, `TicketEventKind`; `TICKET_STATUSES =
  ['active','checked_in','cancelled','event_cancelled']` (только в конец; в ответах — `tolerantEnum`); `TicketCode`
  (ввод: нормализация Crockford, `XXXXX-XXXXX` или 10 символов); `TicketQrPayload` (`/^PKT1\.[A-Za-z0-9_-]{43}$/`);
  `TicketCategory` (`{ kind:'race', tier, groupKey }` | `{ kind:'calendar', distanceKm }` | `null`);
  `TicketEventSummary { kind, id, title, startsAt, endsAt, place, address, city }`; `MyTicketRef { code, status, past,
  event }`; `MyTickets { upcoming, past }`; `TicketView` (`MyTicketRef` + `participantName`, `category`, `qr`
  (`string|null`), `instructions`, `checkedInAt`; `materials`/`wallet` — в PR C/E опционально);
  `CalendarRegistrationRequest = strictObject({ distanceKm: z.number().positive().optional() })`;
  `CalendarRegistrationState { registration: { id, status, distanceKm, createdAt } | null, ticket: MyTicketRef | null }`;
  `EventTicketingPublic` (RC-T7).
- `ticketing-admin.schema.ts`: `AdminEventParams { kind, eventId: Uuid }`; `EventTicketingSettings` (ответ: + `version`,
  `registeredCount`, `activeTickets`, `checkedIn`); `EventTicketingUpdate = strictObject({ enabled, startsAt?, endsAt?,
  place?, address?, instructions?, capacity?, version })` (race: `startsAt`/`place` обязательны при `enabled`;
  calendar: `startsAt`/`place` запрещены, `capacity` допустим); `CheckInRequest = union(strictObject({ qr }),
  strictObject({ code }))`; `CHECK_IN_OUTCOMES = ['ready','checked_in','already_checked_in','cancelled',
  'event_cancelled','outside_window']`; `CheckInView { outcome, ticket: { code, status, participantName, category,
  event, checkedInAt, checkedInBy } }` (бизнес-отказы — `200` с `outcome`; 404/403/429 — ошибки);
  `EventTicketRow { code, status, participantName, category, checkedInAt, emailState }`, `EventTicketsPage` (курсор `_id`).
- Порты: `RESULTS_FOR_TICKETS` → `ResultsForTickets { entryOf(userId, raceId): Promise<TicketEntry|null>;
  entriesPage(raceId, afterId: string|null, limit): Promise<TicketEntry[]> }`, `TicketEntry { entryId, raceId, userId,
  status: RaceEntryStatus, tier: EntryTier, groupKey: ResultGroupKey }` (чтение `tier ?? 'verified'`);
  `CALENDAR_EVENTS` → `CalendarEvents { get(id): Promise<CalendarEventFacts|null>; getMany(ids): Promise<Map<…>> }`,
  `CalendarEventFacts { id, status, title, startsOn, endsOn, startTime, city, place, distancesKm }`;
  `RaceRegistry.getMany(ids): Promise<Map<string, RaceForResults>>`.

**DATA — `0038_tickets`** (expand-only, без транзакции и бэкфилла, идемпотентна; номер сверить с `origin/develop`
перед мержем)

- `tickets`: `tickets_code_unique {code:1}` unique; `tickets_qr_hash_unique {qrHash:1}` unique;
  `tickets_registration_unique {registrationId:1}` unique; `tickets_user_idx {userId:1, createdAt:-1}`;
  `tickets_event_idx {kind:1, eventId:1, _id:1}` (сверка и список участников с курсором — вместо `(kind,eventId,status)`
  из §5.2).
- `event_registrations`: `event_registrations_active_unique {eventId:1, userId:1}` unique, partial `{status:'active'}`;
  `event_registrations_user_idx {userId:1, createdAt:-1}`.
- `event_ticketing`: `event_ticketing_enabled_idx {kind:1, enabled:1, startsAt:1}` (ревью pass 1).
- `_id` настроек — `"<kind>:<eventId>"`; поля календаря `startsAt/endsAt/place` — `null` (RC-T2).

**JOBS & EVENTS**

- outbox `tickets.issued { ticketId }` — в транзакции выпуска (ленивое чтение, сверка, регистрация) → `tickets-email`,
  jobId = id события; повтор — захват письма (RC-T11).
- `tickets-maintenance`: `tickets.reconcile` раз в минуту + при старте; гонки `kind:'race', enabled:true`, не
  `cancelled`, `now < checkInClosesAt`. Без outbox-подписки на `results.*` (тип → одна очередь, цикл).

**TESTS** (int — реальные MongoDB/Redis, `@rkarakulov/test-kit/mongo`, своя БД/Redis db)

| AC | Тест |
|---|---|
| AC1 | `tickets-race.int.test.ts`: заявка + включённые билеты → `GET …/ticket` даёт один `active`; два параллельных GET и сверка после — один билет, одно событие outbox |
| AC2 | там же: без настроек → `null`; включение → `reconcileRace` выпускает всем активным (удалённому — нет), события outbox по числу билетов; после `checkInClosesAt` — не выпускает |
| AC3 | там же + `tickets-calendar.int.test.ts`: отмена заявки/регистрации → `cancelled`, `checkIn` → `outcome: cancelled`; повышение START→Verified → `category` обновлена, второго письма нет |
| AC4 | `tickets-read.int.test.ts`: гонка `cancelled`, старт снят, `enabled:false` → `event_cancelled`, `qr: null`, check-in отказ |
| AC5 | `tickets-read.int.test.ts`: чужой и несуществующий код — одинаковые 404 (тело и заголовки), гость — 401, `no-store` |
| AC6 | `tickets-checkin.int.test.ts`: модератор — 403; организатор чужой гонки и старта календаря — 404; валидный QR → `checked_in`, `checkedInAt/By`, одна запись журнала; повтор — `already_checked_in`; 5 параллельных — одна отметка; вне окна — `outside_window`; код с `-`/строчными — находит; лимит — 429 |
| AC7 | `tickets-email.int.test.ts` (фейк `MAILER`): тема, событие, дата Минск, место, категория, код, кнопка `${APP_WEB_ORIGIN}/tickets/<код>`; без env — текст без кнопки; тело не содержит `PKT1.` и токена; повтор задачи — одно письмо; удалённый — `skipped`. Unit `ticket-email.test.ts` — экранирование |
| AC8 | `tickets-calendar.int.test.ts`: `capacity` = 1 и два параллельных POST → один `EVENT_FULL`; после `startsAt` — `EVENT_REGISTRATION_CLOSED{started}`; повтор после отмены — новый билет и новый код; дистанция обязательна при > 1 |
| — | `tickets-admin.int.test.ts`: права GET/PUT по `kind`, версия → 409 `CONFLICT`, RC-T2/T3/T6, журнал `tickets.settings_updated`; `tickets.policy.test.ts`, `ticket-qr.test.ts`; `migrations.int.test.ts` (индексы); `account-erasure.int.test.ts` (шаг `tickets`); контракты — порядок `PERMISSIONS`/`AUDIT_ACTIONS`/`ErrorCode`; `admin-routes.test.ts` (PanelGuard) — без правок, должен пройти |

**ПОРЯДОК РАБОТ (coder)**

1. Контракты (`tickets/*`, права, журнал, коды) + тесты → api-client.
2. `user-limit.ts` (перенос), порты `results`/`races`/`calendar` + их int-тесты; экспорт `buttonHtml`.
3. Коллекции, миграция `0037`, репозиторий.
4. Policy + QR (unit, TDD) → `TicketEvents` → `TicketIssuer` → `RaceTickets` → регистрация календаря → чтение.
5. Панель: настройки, check-in, участники; права organizer.
6. Worker: письмо, сверка, расписание; `queues.ts`, `worker.module.ts`, `app.module.ts`, env, infra.
7. `TicketErasure` + шаг `account`.
8. ADR-0023, `docs/product/tickets.md`, правки rules/docs (§10) → `pnpm check`.

**OUT OF SCOPE (PR A)**: UI приложения и панели, материалы, напоминания и `TICKET_NOTICES`, Wallet, новые npm-зависимости,
подписка на события `results`, денормализация дат календаря.

## 12. Outcome

### PR A — API (coder, 2026-10-29, ветка `feature/event-tickets-api`, не запушена)

Сделано:

- Контракты `packages/contracts/src/tickets/{ticket,ticketing-admin}.schema.ts` (+ тест), право `tickets.checkin`,
  действия `tickets.settings_updated`/`tickets.checked_in`, `details.ticketCode`, коды `EVENT_FULL`,
  `EVENT_REGISTRATION_CLOSED`, `TICKETING_INVALID_STATE`; api-client — 7 методов приложения, 5 панели (+ тест);
  подписи журнала в `@pokatim/i18n`.
- Модуль `apps/api/src/modules/tickets` (Core/HTTP/Worker): регистрация календаря, ленивый выпуск и сверка билетов
  гонок, чтение владельцем, публичная сводка, настройки и участники в панели, check-in, письмо, регламент, порт
  стирания. Порты `RESULTS_FOR_TICKETS`, `CALENDAR_EVENTS`, `RaceRegistry.getMany`; экспорт `buttonHtml`,
  `minskDateTime` из `identity`; `consumeUserLimit` вынесен в `src/user-limit.ts` (две копии убраны).
- Миграция `0038_tickets`, очереди `tickets-email`/`tickets-maintenance`, env `APP_WEB_ORIGIN` (env.ts, `.env.example`;
  на dev — `docker-compose.yml` из `WEB_ORIGIN`), шаг `tickets` в `account`, organizer + `tickets.checkin`.
- Документы: ADR-0023, `docs/product/tickets.md`, `admin-panel.md`, runbook `deploy.md` (env, ротация секрета → QR,
  миграция), `account-deletion.md`, индексы ADR и продукта, правила `pokatim-{backend,db,contracts}.md`.

Тесты: int `tickets-{race,calendar,read,checkin,email,admin}.int.test.ts` (AC1–AC8, RC-T1…T10), шаг `tickets` в
`account-erasure.int.test.ts`, `0037` в `migrations.int.test.ts`; unit — `tickets.policy.test.ts` (код, окно, статус,
план сверки, доступ), `ticket-qr.test.ts`, `mail/ticket-email.test.ts`, `jobs/tickets-maintenance.processor.test.ts`,
`env.test.ts` (`APP_WEB_ORIGIN`), `permissions.test.ts`.

Отрицательные доказательства (механизм убран временно → тест красный по результату, затем восстановлен):

- `reserveSeat` без условия `capacity`/`registeredCount` → «capacity = 1, два параллельных POST» дал `[201, 201]`
  вместо `[201, 409]`.
- `markCheckedIn` без `status: 'active'` в фильтре → «5 параллельных сканов» дал 5× `checked_in` вместо одного.

Проверки (MONGO_URL_TEST — своя БД `pokatim_tickets_test`, REDIS_URL_TEST — свой redis `:6491/1`: стенд требует БД ≥ 1):

- `TURBO_CONCURRENCY=1 pnpm check` → `Tasks: 15 successful, 15 total`, `EXIT=0`; api — `Test Files 174 passed (174)`,
  `Tests 1833 passed (1833)`; contracts 386, api-client 143, admin 387 passed.
- `pnpm --filter @pokatim/api build` → `BUILD_EXIT=0`.
- Первые прогоны `pnpm check` были красными и исправлены: typecheck admin (нет подписей новых действий журнала в
  `ru.ts`), ожидания прав organizer/admin в `permissions.test.ts` и `panel-session.int.test.ts`.

Не сделано / открыто:

- UI приложения и панели (PR B, C); показ `details.ticketCode` в «Журнале действий» панели — PR C.
- Номер миграции `0037` сверить с `origin/develop` перед мержем.
- `apps/admin/src/test/app.tsx` — фикстура прав organizer без `tickets.checkin` (на тесты не влияет, обновить в PR C).

### PR C — материалы, панель билетов, check-in (coder, 2026-10-29, ветка `feature/event-tickets-panel`)

Сделано (по `plan-C.md`, кроме §7 — см. 8.2):

- Контракты: `src/tickets/materials.schema.ts` (+ тест), `TicketView.materials` (необязательное), коды
  `MATERIAL_FILE_UNSUPPORTED`/`MATERIAL_FILE_TOO_LARGE`, причины `materials_limit`/`files_limit`, 4 действия журнала;
  api-client — `getEventMaterials`, `eventFileUrl` (приложение), 7 методов панели (+ тест `event-materials.test.ts`).
- API (`modules/tickets`): `PanelEvents` (вынос проверки доступа из `TicketingAdminService`), `MaterialsRepository`,
  `MaterialsAdminService`/контроллер (CRUD, порядок, загрузка PDF), `MaterialsRead` + публичный список,
  `EventFilesController`, `materials.policy.ts`; материалы в `TicketView` и письме. Миграция `0039_event_materials`.
- Панель: `features/tickets/*` (страница «Билеты и материалы», `TicketingSettingsForm`, `MaterialsSection`,
  `MaterialDialogs`, `ParticipantsSection`, `TicketingSummary` на гонке и в rail календаря), `features/check-in/*`
  (`CheckInScreen`, `QrScanner`, `scanner.ts`), layout без сайдбара, пункт «Check-in», `CheckboxField`, журнал —
  `ticketCode` и подписи действий/полей, фикстура organizer/admin + `tickets.checkin`; зависимость `jsqr@1.4.0`
  (отдельный чанк `jsQR-*.js`).
- Инфраструктура: `Permissions-Policy` в `admin-nginx.conf` (сервер + все `location`) и `vite preview`, сторож
  `csp.test.ts`.
- Документы: ADR-0023 п. 10–11, `docs/product/tickets.md`, `admin-panel.md`, правила
  `pokatim-{backend,db,contracts,security,web}.md`.

Тесты: int `tickets-materials.int.test.ts` (11: права на каждую ручку, чужое событие, CRUD/порядок/версия/журнал,
RC-C5, лимиты 20/10, загрузка 415/413/429, заголовки файла, 404 файла, публичный список RC-C9), дополнены
`tickets-read`/`tickets-email.int.test.ts`, `migrations.int.test.ts` (`0039`); unit — `materials.policy.test.ts`,
`mail/ticket-email.test.ts`; RTL — `EventTicketsScreen.test.tsx` (12), `CheckInScreen.test.tsx` + `scanner.test.ts`
(10), `CheckboxField.test.tsx`, `AuditScreen`, `AppLayout`, `csp.test.ts`; e2e — `apps/admin/e2e/check-in.spec.ts`.

Отрицательные доказательства (механизм убран временно → красный тест, затем восстановлен): без проверки сигнатуры
`%PDF-` — тест «не PDF — 415» красный; без `kind, eventId` в фильтрах материала — тест «материал чужого события — 404»
красный.

Проверки:

- `TURBO_CONCURRENCY=1 MONGO_URL_TEST=…/pokatim_tc_test REDIS_URL_TEST=…/3 pnpm check` → `Tasks: 15 successful, 15
  total`, `EXIT=0`; api — 193 файла / 1993 теста, admin — 43 / 410, api-client — 149.
- Миграции дважды (своя БД `pokatim_c_e2e`): первый прогон применил `…0038_tickets, 0039_event_materials`, второй —
  «новых миграций нет».
- `ADMIN_BASE=/admin/ pnpm --filter @pokatim/admin build` — собрано, `jsQR` — отдельный чанк.
- `pnpm e2e:admin` (своя БД `pokatim_c_e2e`, Redis db 8, локальный Mailpit, Chrome) → 3 passed (admin, check-in,
  races).

Не сделано / открыто:

- UI приложения (§7 плана: `event-materials`, карточки гонки/календаря, экран билета) — не трогали `apps/app` по
  указанию оркестратора (PR B параллельно); API и клиент готовы.
- Ручная проверка камеры на телефоне (iOS Safari, Android Chrome) и скачивания PDF — не выполнялась.
- Номер миграции `0039` сверить с `origin/develop` перед мержем.
