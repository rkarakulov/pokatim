# Рейтинг сезона: пересчёт по событиям outbox

## 1. Title

`standings` подписан на `results.protocol-published` и `results.result-revised` (fan-out outbox, ADR-0017 п. 5).

## 2. Goal

Таблица сезона обновляется сразу после публикации протокола или новой ревизии, а не через ~1 мин регламента (DV-1
race-results-08). Fan-out есть с `@rkarakulov/api-kit` 0.6.0: тип события уходит в каждую очередь подписчиков
(`mergeOutboxRoutes`, `src/outbox-routes.ts`).

## 3. Scope

- `standingsOutboxRoutes` (`standings.events.ts`, экспорт из `index.ts`): оба типа → `QUEUE.standingsRecalc`;
  подключён в конец `subscriberOutboxRoutes`.
- Процессор `standings-recalc` (`StandingsSyncProcessor`): кроме `sync` — задачи с именем типа события (jobId = id
  события). Payload из outbox (`MongoOutboxReader.payloadOf`), схемы `ResultsProtocolPublished` /
  `ResultsResultRevised` из `results/index.ts`; невалидный payload — пропуск с логом.
- `StandingsRecalc.syncRace(raceId)`: сезон гонки с протоколом (порт `SEASON_RACES.protocolRaceSeason`, новый метод)
  → `sync([seasonId])` — та же сверка отпечатка: снимок совпадает — без записи; старый снимок — пересчёт; конфликт
  версий — пропуск; `claimSeason` не даёт устаревшему снимку перезаписать новый (RC-5). Гонки нет или протокол не
  опубликован — `skipped`. Отказ — исключение, ретраи BullMQ.
- `StandingsRecalc.sync(seasonIds?)` — сверка по сезонам; без аргумента — все (регламент).

### Решение S1: регламент `standings.sync` остаётся страховкой, раз в 15 минут

Решение автора сессии (поведение для пользователя только улучшается: обновление быстрее; страховка — реже).

- Событие — основной путь. Регламент `*/15 * * * *` (Минск) и разовый `standings.sync.boot` при старте worker
  остаются.
- Почему не убираем: (а) задача события могла исчерпать ретраи (сбой Mongo) — без регламента сезон остался бы
  устаревшим до следующего события; (б) смена `STANDINGS_FORMULA_VERSION` или входа отпечатка требует пересчёта всех
  сезонов без событий — это делает boot-прогон; (в) события, опубликованные до выката, в `standings-recalc` не
  приходили — их покрывает boot-прогон, бэкфилл не нужен (ADR-0017 п. 5).
- Почему реже: регламент теперь только страховка; сверка дешёвая, но каждую минуту не нужна. Худшая задержка при
  потере события — 15 мин.

## 4. Out of Scope

- Регламенты `achievements` и сверка `route-rides` (отдельные задачи).
- Сводка панели «ждёт пересчёта» (RC-14) — без изменений (сравнивает отпечатки).
- Смена payload событий `results`.

## 8. Риски и отклонения

- R1. Событие и регламент одного сезона одновременно (несколько worker): оба пересчитывают, `claimSeason` пропускает
  устаревший (`stale`) — как раньше у двух регламентов.
- R2. Событие пришло раньше коммита ревизии? Нет: outbox пишется в транзакции публикации, ревизия видна.
- DV-1 (race-results-08) заменено: события — основной путь, регламент — страховка (S1).

## 8.1 Placement & Reuse

- Новый метод чтения — в порту владельца `races` (`SeasonRaces.protocolRaceSeason`, реализация через
  `RacesRepository`), `standings` коллекций `races` не читает.
- `standings.events.ts` — по образцу `notifications.events.ts` (маршруты объявляет подписчик); процессор — существующий
  `StandingsSyncProcessor`, чтение payload — `MongoOutboxReader` (как `results-intake`).
- Пересчёт — существующий `StandingsRecalc.sync(seasonIds)` и `StandingsSource.load(seasonIds)`, второго расчёта нет.

## 8.2 Requirements Consistency

- ADR-0017 п. 5: подписка через fan-out, маршрут объявляет подписчик — соблюдено; бэкфилл не нужен (boot-прогон).
- `pokatim-backend.md` «Рейтинг сезона» и «Регламенты по курсору без событий» — обновить.

## 8.3 Security checklist

- AuthN/AuthZ: новых эндпоинтов нет; задачи ставит только outbox worker.
- Входные данные: payload outbox — zod-схемы владельца (`ResultsProtocolPublished`, `ResultsResultRevised`), `raceId` —
  uuid; в фильтр Mongo — только примитив. Невалидный payload — пропуск с логом.
- Данные наружу: ничего нового; HTTP читает тот же снимок.
- Злоупотребления: пересчёт идемпотентен (сверка отпечатка), частота ограничена событиями протокола (действия панели).
- Секреты и логи: лог — тип и id события, без ПДн.
- Аудит: не нужен — снимок производный, действия панели уже в журнале.

## 9. Acceptance Criteria

- AC1. `workerOutboxRoutes['results.protocol-published']` и `['results.result-revised']` содержат и
  `notifications-intake`, и `standings-recalc`.
- AC2. Публикация протокола → задача `results.protocol-published` процессора `standings-recalc` строит снимок сезона
  без прогона регламента.
- AC3. Новая ревизия (DQ) → задача `results.result-revised` обновляет снимок; повтор той же задачи — без записи.
- AC4. Задача по гонке без протокола / неизвестной гонке / с невалидным payload — пропуск без исключения.
- AC5. Регламент `standings.sync` — `*/15 * * * *` Europe/Minsk, boot-прогон при старте сохранён.

## 10. Documentation Impact

- ADR-0017 п. 5 — отметка «standings подписан».
- `.claude/rules/pokatim-backend.md` — раздел рейтинга сезона и список регламентов без событий.
- Эпик race-results — строка `standings-recalc`.
- `docs/product/notifications.md` (риски), комментарии `queues.ts` и `results.events.ts`.

## 12. Outcome

- Реализация: `standingsOutboxRoutes`, `StandingsSyncProcessor` по событиям, `StandingsRecalc.syncRace`,
  `SeasonRaces.protocolRaceSeason`, регламент `*/15`.
- Проверки: `tsc --noEmit` (api) — чисто; eslint/prettier по затронутым файлам — чисто; vitest `src/modules/standings/`
  + `outbox-routes.test.ts` — 8 файлов / 48 тестов, после фиксов ревью — 3 файла / 10 тестов, зелёные. Полный
  `pnpm check` — в CI.
- Ревью: Claude independent-reviewer — проход 1 REQUEST CHANGES (HIGH 1, MEDIUM 1, LOW 2, все исправлены), проход 2
  APPROVE.
