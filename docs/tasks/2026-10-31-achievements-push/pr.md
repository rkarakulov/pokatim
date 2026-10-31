## Достижения: серверная сверка в worker (push без открытия приложения, часть N2)

Task: `docs/tasks/2026-10-31-achievements-push/task.md` (решения P1–P6, RC-P1…RC-P10, раздел 5.D). N1 (событие
`achievements.grant-noticed`, группа «Достижения», канал `origin`) — уже в `develop`. Этот PR — **N2**: worker сам
находит новые выдачи и шлёт push (AC3, AC5).

### Деплой
1. **Миграция `0044_route_rides_passed_idx`** — `pnpm db:migrate` **до** выката API/worker. Только expand:
   частичный индекс `route_rides_passed_updated_idx { updatedAt, _id }` по `status: 'passed'`, идемпотентный
   `createIndex`, без бэкфилла и транзакции.
2. Выкат API и worker. Новая очередь BullMQ **`achievements-sync`** создаётся сама; расписание
   `achievements.sweep` (`* * * * *`, `Europe/Minsk`) — `upsertJobScheduler` при старте worker, плюс разовый
   `achievements.sweep.boot`. Новых переменных окружения нет.
3. Первый прогон без курсоров читает окно `until − 10 мин`: старые факты push не будят (RC-P9).

### Что
- **Регламент `achievements.sweep`** (`AchievementsWorkerModule` в `WorkerModule`): курсоры Redis
  `achievements:cursor:<source>`, окно `(курсор, now − 2 мин]`, ≤ 500 строк на источник. Источники — по одному методу
  портов владельцев (`changed-since.ts`):
  - ревизии протоколов `RIDER_RESULTS.revisedRidersAfter` — журнал по uuidv7 `_id`, получатели страницы одним
    запросом;
  - прошедшие райды `RIDER_RIDES.startedRidersAfter` — `until = now − 3 ч`, push после поездки;
  - засчитанные заезды `RIDER_ROUTE_RIDES.passedRidersAfter` — по моменту записи итога (`updatedAt`);
  - итоги сезонов `RIDER_SEASON_STANDINGS.settledRidersAfter` — пересчёт снимка, конец сезона или отмена гонки, которая
    ждала протокола (`SEASON_RACES.lastCancelledAt`).
- **Кого сверять:** живые аккаунты ∩ с маркером первой сверки — первая сверка остаётся тихой при открытии приложения.
  Задачи `achievements.rider` → `reconcile(uid, 'server')`: центр и push. 3 попытки, на последней — лог
  `achievements.server_sync_failed`.
- **Один прогон за раз:** замок-аренда Redis. Продление своим токеном перед каждым шагом; курсоры пишет только
  владелец (проверка токена и запись одним Lua). Аренда потеряна — `achievements.sweep_lease_lost`, курсоры не
  пишутся. Курсоры двигаются после постановки задач. Сбой источника — его курсор стоит, остальные идут, прогон падает.
- **Push — «не больше одного»:** при сбое push может не прийти, запись в центре появится при следующем GET.
- Документы: ADR-0020 «Дополнение: серверная сверка», `profile.md`, `.claude/rules/pokatim-backend.md`,
  `.claude/rules/pokatim-db.md`.

### Проверки
- `TURBO_CONCURRENCY=1 pnpm check` — зелёный (изолированные Mongo RS и Redis).
- Int: AC5 — ставятся только райдеры с маркером, живым аккаунтом и фактом в окне. AC3 — протокол → прогон из очереди
  → задача райдера → событие `origin: 'server'` → уведомление → push в фейковом Expo. Сезон `pending → final`
  отменой гонки → сезонная выдача и push без GET. Источники: окно, страница, продолжение; поздняя запись итога заезда;
  бюджет запросов ревизий (4 ревизии → 2 чтения). Аренда: истекла посреди прогона — курсоры второго прогона целы.
- Ревью N2: Claude — APPROVE (1 MEDIUM, 4 LOW); Codex — APPROVE (3 MEDIUM, 1 LOW). Все находки исправлены
  (task.md, «Фиксы ревью N2»).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
