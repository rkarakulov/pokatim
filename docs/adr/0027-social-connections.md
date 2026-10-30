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
- `identity` ни от кого, кроме `tokens`, не зависит.

## Решение

1. **Модуль `social` — потребитель.** `social → rides, results, routes, tracks, profile, identity` только через
   `index.ts` и порты `*_FOR_SOCIAL` (по образцу `RESULTS_FOR_TICKETS`). На `social` ссылаются `notifications`
   (порт аудитории и имён для группы «Свои»), `account` (порт стирания), `AppModule`, `WorkerModule`. Производители
   о `social` не знают.
2. **Коллекции** (миграция `0043_social`, только expand):
   - `rider_connections` — направленная связь `ownerId → otherId`, уникальный `{ownerId, otherId}`; источники
     (`ride`, `invite`, `manual`), `rideCount`, `lastRideAt`, `manualAt`, `removedAt` (тихое удаление: связь
     скрыта, автоматические источники её не возвращают, K1);
   - `ride_attendance` — явка `{rideId, userId}` уникально, `via: manual | track`, время; связи `ride` и их вес —
     производные от явки, пересчитываются по райду идемпотентно;
   - `social_reactions` — `kind: thanks | respect`, автор, цель (`ride_rider` | `race_entry` | `route`), получатель;
     уникальный `{kind, actorId, targetType, targetId}`;
   - `invite_codes` — личный код райдера (случайный, уникальный), выдаётся лениво;
   - `product_events` — журнал метрик (п. 7).
3. **Данные зрителя — отдельные эндпоинты `social` под `AuthGuard`, `no-store`:** `GET rides/:id/participants`
   (участники с публичным профилем и явка), `GET riders/:publicId/social` («вместе ехали», «Идёт», состояние
   «В свои»), `GET social/connections`, `GET social/home`. Контроллеры с префиксом чужого ресурса — прецедент
   `riders/:publicId/me` в `profile`. Публичные кэшируемые ответы не меняются.
4. **Автоявка — второе событие `tracks`.** После обработки заезда `tracks` в той же транзакции пишет
   `tracks.activity-recorded {activityId, userId}` → очередь `social-intake`. `social` читает старт заезда портом
   `ACTIVITY_STARTS` и точный старт райда портом `RIDES_FOR_SOCIAL` (только при маршруте каталога). `activity-ready`
   и `results-intake` не меняются. Регламент `social-maintenance` раз в 30 минут шлёт «Как прошёл райд?» через 4 ч
   после старта.
5. **Атрибуция приглашения — в `identity`.** `RegisterRequest.invite` (необязательное поле, старые сборки
   совместимы) сохраняется на `users`; при подтверждении e-mail `identity` пишет `identity.account-confirmed
   {userId, invite?}` → `social-intake`, `social` разрешает код в пригласившего и создаёт связь `invite`. `identity`
   о `social` не знает.
6. **Уведомления группы «Свои» — имена при чтении** (поправка к ADR-0017 «текст — снимок» и N12). `NotificationDoc`
   получает `actors: userId[]` и `params`; для группы `social` `title/body` собираются при чтении списка и при
   отправке push из текущих публичных имён (`RIDER_NAMES.publicRiders`), нет имени — «Райдер». Схлопывание копит
   `actors` (`$addToSet`) вместо замены документа. Остальные группы не меняются. События `social.*` → очередь
   `notifications-intake`; «Свои идут» строится из `rides.participant-joined` портом аудитории `social`.
7. **Журнал продуктовых событий — листовой модуль `product-events`** без зависимостей, порт `PRODUCT_EVENTS.record`.
   Пишут `social`, `rides` (источник «Иду» — необязательный параметр `join`), `identity` (активный день, дедуп в
   Redis на сутки по Минску). Журнал append-only; единственное исключение — удаление записей райдера шагом стирания
   аккаунта (K13). Наружу не уходит, выгрузка — скрипт.
8. **Стирание аккаунта** — шаг `social` до `notifications` и `identity` (`ERASURE_STEPS`): связи в обе стороны,
   явки (с пересчётом связей других участников), свои реакции и полученные, коды приглашений; шаг `product-events`.
9. **Лимит** ручного «В свои» — `consumeUserLimit` `social-manual:<uid>`, 30 за 24 ч.

## Последствия

- Новые очереди `social-intake`, `social-maintenance`; новые outbox-события в `tracks` и `identity`.
- `notifications` получает Nest-импорт `social` и `profile` (правило «текст — снимок» в `pokatim-backend.md` и
  `pokatim-db.md` дополняется исключением для группы «Свои»).
- Имя в тексте push остаётся на устройстве после удаления аккаунта — принятый риск (решение автора 2026-10-31).
- Явка — первый факт «был на райде» (R8); километры райдов в статистику по-прежнему не входят.
