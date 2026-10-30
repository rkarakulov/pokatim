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
   `rides.md` (K4, K5), `notifications.md` (N3 — события группы «Свои», N4 — пятая группа, N12 — исключение), `home.md`
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

## 8.2 Deviations from spec

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

## 11. Implementation Context

## 12. Outcome
