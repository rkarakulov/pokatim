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
| A | `feature/event-tickets-api` | модуль `tickets`: настройки билетов события, регистрация на старт календаря, выпуск/статусы билетов, чтение владельцем, check-in API, письмо «Вы зарегистрированы», миграция, env `APP_WEB_ORIGIN`, право `tickets.checkin`, ADR-0021, `docs/product/tickets.md` |
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

### 5.2 Данные (миграция `0037_tickets`, номер сверить перед мержем)

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

## 8.2 Deviations from spec

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

ADR-0021 «Билеты и check-in»; `docs/product/tickets.md`; `admin-panel.md` (право, разделы, журнал);
`notifications.md` (группа «Мероприятия», событие); runbook: env `APP_WEB_ORIGIN`, Wallet-сертификаты.

## 11. Implementation Context

## 12. Outcome
