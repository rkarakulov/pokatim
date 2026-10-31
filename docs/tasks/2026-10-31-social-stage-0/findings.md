# Findings — social-stage-0 (P0) — pass 1 — reviewer: claude
base: origin/develop   commits: working tree (не закоммичено, ветка feature/social-stage-0 @ 94acc866)
verdict: APPROVE

Пакет: task.md (3.1, 8.1, 8.2, 9, 10, 11), `git diff` + untracked файлы, `tools/ai_review/review_contract.md`,
`.claude/rules/pokatim-{backend,db,contracts,tests}.md`, ADR-0027. Тесты и `pnpm check` не запускались (по заданию
их гоняет оркестратор) — зелёный статус AC7 и отрицательные доказательства §12 приняты из отчёта coder, NOT VERIFIED.

Проверено без замечаний:
- Пересчёт связей при явке: первая запись транзакции — в документ `ride_attendance` райда (`ensure` upsert →
  условный `$push`/`$set`), поэтому две изменяющие отметки одного райда конфликтуют, проигравшая повторяется на
  свежем снимке (RC-2a); no-op-повтор ничего не пишет, пересчёт и события пропускает. `rideConnectionDiff` +
  pipeline-upsert с `$literal` (`rides` без rideId + новая запись, `$size`, `$max`), удаление только затронутых пар
  с `removedAt: null` и без источников — надгробие сохраняется (RC-6). Пары двух разных райдов на одном документе
  связи сериализует конфликт записи по самому документу.
- RC-3a: `decline` ставит `declinedAt` у любой явки или создаёт запись-отказ; `markByTrack` её не перекрывает,
  `markManual` сбрасывает.
- Стирание: `$pull` явки первым; так как первая операция транзакции отметки — запись в тот же документ, `$pull` либо
  виден снимку конкурента, либо ждёт его коммита, после чего связи удаляются `deleteMany` в обе стороны. Реакции
  свои и полученные, код, события по `userId`; повтор — нули (тест). Порядок `… tickets → social → product-events →
  notifications → identity` совпадает в сервисе, `ERASURE_STEPS`, `ru.ts`, правилах (RC-10).
- Индексы миграции совпадают с таблицей п. 11 и `pokatim-db.md`; RC-1 (`recipientId` в уникальном ключе).
- Лимит 30/24 ч — `consumeUserLimit` до проверки «себя» и публичности (RC-16, тест считает и отказы).
- `product_events.props` — `strictObject` из enum/LocalDate, без id пользователей; `userId` — `Uuid`.
- Границы: `social → rides|profile|product-events` только через `index.ts`; `product-events` импортирует только
  `../../db` (тип) и contracts; правила dependency-cruiser соответствуют п. 11. Коллекции `rides`/`profiles` social не
  читает; `ridePhase` вызывается только в `rides`.
- Контракты: справочники и `SOCIAL_ACTION_BLOCKED` — в конец; `ProductEventType` в API (RC-11).
- UI/платформы/дизайн-система/состояния данных — не затронуты (нет экранов); admin получает подписи шагов из i18n.

### [MEDIUM] Гонка «Убрать из своих» ↔ снятие явки теряет надгробие removedAt (K1)
- **file:** apps/api/src/modules/social/connections.repository.ts
- **location:** `remove` (стр. 56–62) против `applyRideDiff` → `deleteMany({...EMPTY, $or})` (стр. 175–178)
- **problem:** `remove` — `updateOne({...pair, removedAt: null}, …)` без upsert. Если связь A→B держится только на
  общем райде R, а A нажимает «Убрать» одновременно с тем, как B (или A) снимает явку на R, транзакция явки может
  закоммитить удаление документа A→B («нет источников, removedAt: null») раньше; тогда `remove` ничего не находит и
  надгробия нет. Следующий совместный райд создаст A→B заново.
- **why_it_matters:** нарушается K1 / RC-6 («тихое удаление не возвращается автоматикой») — ровно то, ради чего
  введено надгробие. Окно узкое, но эндпоинт «Убрать» появится в P3 и будет нажиматься со страницы райда (P2).
- **evidence:** `remove` возвращает `modifiedCount > 0`, отсутствие документа молча = no-op; удаление в
  `applyRideDiff` фильтрует `removedAt: null`, значит удаляет не-надгробие, конкурирующее с ещё не применённым `remove`.
- **recommended_fix:** сделать `remove` upsert'ом надгробия (`$set {removedAt, manualAt: null, updatedAt}`,
  `$setOnInsert` полей `fresh(now)` + `inviteAt: null`), с тем же одним повтором на `isDuplicateKey`, как в
  `addManual`; либо выполнять `remove` в транзакции с той же записью. Добавить тест «remove без документа оставляет
  надгробие, последующий пересчёт не возвращает связь».

### [LOW] Повтор на isDuplicateKey есть в addManual, но не в пересчёте явки — несогласованное допущение
- **file:** apps/api/src/modules/social/connections.service.ts / attendance.service.ts
- **location:** `addManual` (стр. 73–79); `SocialAttendanceService.change`/`recalculate` (стр. 69–104)
- **problem:** `addManual` предполагает, что upsert пары в транзакции может кончиться `E11000`
  (`rider_connections_owner_other_unique`), и повторяет. Тот же upsert пары делает `applyRideDiff` в транзакции явки
  (конкурент — `addManual`/`linkInvite` той же пары), но там дубль не обрабатывается — пользователь получил бы 500.
  Внутри транзакции конфликт с незакоммиченной/закоммиченной после снимка вставкой обычно приходит как
  `WriteConflict` (повторяется `withTransaction`), тогда повтор в `addManual` мёртвый код; если же `E11000` всё-таки
  возможен — пересчёт не защищён. NOT VERIFIED на сервере.
- **why_it_matters:** либо лишний код, либо редкий 500 при первой совместной явке пары, только что добавленной вручную.
- **recommended_fix:** выбрать одно поведение: либо int-тест воротами (upsert пары `addManual` коммитится между
  снимком и bulkWrite пересчёта) и общий обработчик дубля для обоих путей, либо убрать повтор с комментарием, что в
  транзакции дубль ловится как WriteConflict.

### [LOW] Documentation Sync: pr.md ещё не создан
- **file:** docs/tasks/2026-10-31-social-stage-0/pr.md
- **location:** отсутствует
- **problem:** п. 10 task.md требует `pr.md` (миграция `0045_social` expand, новые шаги стирания, совместимость
  строгого `ERASURE_STEPS` — панель деплоится вместе с API, перенумерация при слиянии `feature/achievements-seasonal`).
- **why_it_matters:** без этого деплой-заметки о строгом enum и номере миграции теряются.
- **recommended_fix:** создать на шаге FINISH (так и запланировано в §12 «Открыто»).

Итог: CRITICAL/HIGH нет. AC1–AC6 по коду и тестам покрыты; AC7 (`pnpm check`) — NOT VERIFIED этим ревью.

## Исправления оркестратора после pass 1

- **MEDIUM (надгробие) — исправлено:** `ConnectionsRepository.remove` — upsert надгробия, уже убранная пара —
  `isDuplicateKey` → no-op. Тест «„Убрать“ после того, как пересчёт удалил документ пары…» в
  `social-connections.int.test.ts`; отрицательное доказательство — с `upsert: false` тест красный (по результату).
- **LOW (дубль в пересчёте) — не правится в P0:** зафиксировано в task.md 8.2 как известное допущение, проверка
  воротами — вместе с P3 (ручное «В свои» появляется в API).
- **LOW (pr.md) — делается на шаге FINISH.**
