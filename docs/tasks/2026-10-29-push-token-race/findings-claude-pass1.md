# Findings — push-token-race — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..7bb6a7aa (один коммит)
verdict: REQUEST CHANGES

Ревью — по коммиту 7bb6a7aa. Во время ревью рабочее дерево менялось параллельно (незакоммиченные правки
`rides.events.ts`, `rides.service.ts`, `writeNotices` и новый тест «повтор задачи переноса после «Я иду»»), поэтому
прогоны ниже — на смешанном дереве. Как evidence они годятся только для тестов, которых эти правки не касаются.

Проверено: `tsc --noEmit` (api) зелёный. Int-тесты `notifications.int.test.ts`, `web-push.int.test.ts`,
`notifications-intake.int.test.ts` на изолированных Mongo/Redis: новые тесты AC1 (Expo, web) и AC3 зелёные. Красные:
лимиты `notifications-read` / `notifications-push-token` (при параллельных файлах на одном Redis db; по отдельности
зелёные — окружение) и незакоммиченный тест повтора переноса (подтверждает HIGH ниже).
**NOT VERIFIED:** полный `pnpm check`; отрицательные доказательства (§6/§12) не запускал, их проверял по коду:
без `$or sessionId` поздний upsert A перепишет `userId` → AC1 красный; при `sourceEventId $lt` вторая запись
(меньший id) — дубль, потом условная замена без совпадения → `unchanged` вместо `written` → AC3 красный.

Без замечаний по: фильтру `registerToken` (`$or` в фильтре — сервер не повторяет upsert сам, дубль
`push_tokens_token_unique` → один повтор → `false`; вытеснение 11-го — только после записи; `sessionId` стабилен при
`rotate`); `204` без оракула, `token_stale` без токена в логе; гонке первой вставки по `collapseKey` (повтор без upsert
с тем же `collapseSeq $lt`); равному `seq` → `unchanged`; совместимости документов без `noticeSeq` / `collapseSeq`
(`?? 0`, `$ifNull`, `$exists: false`); полноте `$inc noticeSeq` (title/startsAt — `update`; participants/goingCount —
`join`, `leave`, `leaveAllFuture`; `status` в текст не входит, intake отсекает не-`published`: `cancel`/`hide`/`restore`
счётчик могут не трогать); утечкам `noticeSeq` (публичная проекция `noticeSeq: 0`, `VIEWER_FIELDS` без него,
модерация и лента — явные мапперы); маршрутам (`publication.version`, intake сверяет статус и `decidedAt` с событием —
повтор старого решения → `state`); Documentation Sync (`pokatim-db.md`, `pr.md` follow-ups).

### [HIGH] Повтор / позднее событие райда после любого изменения райда заново открывает уведомление и повторно доставляет push
- **file:** apps/api/src/modules/notifications/notifications.repository.ts; apps/api/src/modules/notifications/notification-intake.ts; apps/api/src/modules/rides/rides.repository.ts
- **location:** `writeNotices` (фильтр `collapseSeq $lt`, ~139–151); `NotificationIntake.ride` (`seq: ride.noticeSeq`, 244/252); `rides.repository.ts` 258/277/313/742 (`$inc noticeSeq` в `join`, `leave`, `update`, `leaveAllFuture`)
- **problem:** `seq` берётся из *текущего* состояния райда в момент обработки, а не из события. Один общий `noticeSeq`
  растёт от любой записи: `join`/`leave` и любая правка через `update`, в том числе только описания. Сценарий:
  intake `ride-rescheduled` (seq n) → уведомление прочитано, доставка `sent` → кто-то нажал «Я иду» (n+1) →
  повтор задачи (retry BullMQ, повторная публикация outbox) или позднее параллельное событие переноса (concurrency 4).
  Порт вернёт n+1 > n, и `$set` перезапишет документ: `readAt: null`, новый `createdAt`, `initialDelivery`. Участники
  снова получат push/e-mail о том же переносе, а только что вошедший участник получит уведомление о переносе,
  который был до его входа. Для `ride_joined` так же: повтор старого join после чужого «Не иду» снова поднимает
  уведомление организатора, хотя никто не вошёл. Раньше `sourceEventId $lt` гарантировал, что повтор того же
  события ничего не меняет.
- **why_it_matters:** нарушен инвариант процессора («повтор задачи и повторная публикация не создают дублей»),
  AGENTS.md §4.5 (идемпотентность BullMQ) и AC3 («повтор задачи ничего не меняет»). Повторный push и письмо — это
  дубль доставки (уровень HIGH по `pokatim-db.md`). Новый тест повторяет задачи только при неизменном райде, поэтому
  дыру не ловит.
- **evidence:** `writeDraft` передаёт `readAt: null`, `createdAt: now`, `...delivery`, и `writeNotices` пишет их через
  `$set` при любом `collapseSeq < seq`. `update` поднимает `noticeSeq` на любой патч
  (`set.noticeSeq = { $add: [...] }` без условия). Незакоммиченный тест рабочего дерева «повтор задачи переноса после
  «Я иду»…» красный.
- **recommended_fix:** заменять уведомление, только если состояние новее И *событие* не старее уже применённого.
  Варианты: (а) номер состояния в payload события (`noticeSeq` после записи, в той же транзакции) и
  сравнение по нему, а текст брать из текущего снимка; (б) отдельные счётчики по ключу: `rescheduleSeq` растёт только
  при смене `startsAt`/`title`, `joinSeq` — только в `join`, и событие несёт свой номер; (в) хотя бы
  `sourceEventId: { $ne: eventId }` плюс замена без сброса `readAt`/доставки, если текст не изменился. Нужен тест:
  перенос → intake → прочтение → join → повтор исходного intake: `unchanged`, `readAt` и доставка прежние.

### [MEDIUM] Нет тестов, что `leave` / `update` / `leaveAllFuture` поднимают `noticeSeq` (строка матрицы §6 не выполнена)
- **file:** apps/api/src/modules/notifications/notifications-intake.int.test.ts
- **location:** матрица §6 task.md, строка «`noticeSeq` — через порт и HTTP райдов»
- **problem:** новый тест проверяет только `join` (две записи «Я иду»). Если убрать `noticeSeq` из `$inc` в `leave`,
  `leaveAllFuture` или из pipeline `update`, ни один тест не упадёт, а схлопывание после «Не иду» / переименования
  снова начнёт зависеть от порядка (равный seq → `unchanged`, текст устаревший).
- **why_it_matters:** `pokatim-db.md` теперь требует: «новое поле текста… обязано его поднимать». Без теста на
  каждую запись это правило ничем не защищено, а пункт матрицы заявлен как покрытый.
- **evidence:** `git diff origin/develop...HEAD -- '*test*'`: про `noticeSeq` есть только сценарий с двумя `join`.
- **recommended_fix:** int-тест через порт `RideNotices.ride` или напрямую по документу: `noticeSeq` строго растёт после
  HTTP `leave`, `PATCH` (title/startsAt) и `RideErasure`/`leaveAllFuture`. Плюс сценарий «join → leave в обратном
  порядке id» на текст «участников — N».

### [LOW] §12 Outcome в task.md не заполнен: нет результатов отрицательных доказательств и `pnpm check`
- **file:** docs/tasks/2026-10-29-push-token-race/task.md
- **location:** §12
- **problem:** §6 обещает, что «убрать условие → AC1/AC3 красные по результату (§12)», но §12 содержит только «(заполняется по итогам)».
- **why_it_matters:** гарантия «тест падает без фикса» не задокументирована (review_contract: честные тесты, evidence).
- **evidence:** task.md, последняя строка.
- **recommended_fix:** записать в §12 прогоны с откатанным условием и итог `pnpm check`.
