# Review pass 1

# Findings — race-results-05-protocol — pass 1 — reviewer: claude (independent-reviewer)
base: origin/develop   commits: origin/develop..18f80f6 (e2ff676…1a6f643 + merge 18f80f6), working tree clean
verdict: APPROVE

Проверено прогоном (изоляция `pokatim_05review_test`, Redis db 11): `tsc --noEmit` api/admin/contracts — ок;
unit `results.policy`, `results.repository` (сторож append-only), `races.policy`, `permissions` — 66/66;
int `results-protocol`, `results-revisions`, `results-read`, `migrations` — 42/42; RTL `features/results`,
`StatTile`, `RacesScreen` — 37/37. Полный `pnpm check` не повторялся (в §12 есть отчёт coder).
Отрицательное доказательство AC11 (подмена `lockResults` чтением) — **NOT VERIFIED** прогоном: код не правился. По
разбору: без записи в документ гонки транзакция исключения не конфликтует с публикацией (обе пишут разные
документы), снимок публикации зафиксирован до исключения. Механизм верный, тест краснеет по результату (§12).

Покрытые измерения без находок: замок `lockResults` (первая операция во всех 8 транзакциях, `lockEntry` после
него в исключении и возврате; DQ ↔ DQ, исключение ↔ публикация, отмена ↔ публикация — конфликт записи в документ
гонки + фильтр `protocolPublishedAt: null` при отмене); append-only (`race_attempt_reviews`, `race_protocol_rows`,
`race_recalculations` — только `insertOne`/`insertMany`, сторож зелёный); права (`PanelGuard` + `RequirePermission`
на всех 12 маршрутах, organizer — `results.manage` в своих гонках через `findForPanel`, чужая гонка / попытка
другой гонки — 404); контракты (только добавления в конец; приложение — `tolerantEnum` фазы гонки, статусов
попытки, результата и таблицы; панель — строгие `z.enum`); идемпотентность перепроверки (повтор задачи под
`lockEntry` перечитывает `checkedAt < requestedAt`, перепоставленная вердикта не имеет); `buildProtocol` (места —
`rankRows`, DQ в конце без места, статусы final/revised/dq); миграция 0016 (expand-only, идемпотентна, в конец
списка); логи без причины и `userId` райдера; причина исключения не уходит в `MyAttempt`; UI (обязательная причина
через `ReasonDialog`, `aria-disabled` + `DisabledReason` с количеством, права скрывают действия, скелетон/ошибка с
повтором/баннер обновления); Documentation Sync §10 — ADR-0012, `pokatim-{db,backend,security,tests,web}.md`
обновлены.

### [MEDIUM] DQ теряется молча, если участник на одной ревизии выпал из протокола
- **file:** apps/api/src/modules/results/results-protocol.service.ts
- **location:** `applyRecheck`, строки 261–270
- **problem:** перенос DQ берётся только из строк текущей ревизии (`previous.filter(status === 'dq')`), а база —
  только из заявок с `best` сейчас. Участник с DQ, у которого после перепроверки нет `best`, выпадает из ревизии
  N+1 вместе с признаком DQ. Если следующая перепроверка вернёт ему `best` (вердикт `rejected → counted`, напр.
  другая версия движка), ревизия N+2 поставит его с местом и статусом `revised` — DQ снят без записи
  `disqualification_revoked`, без журнала и события.
- **why_it_matters:** решение D-27 (DQ) — судейское, отменяется только явным действием D-28 с причиной
  (append-only история пересчётов). Здесь протокол противоречит журналу: в `race_recalculations` последнее решение
  по участнику — `disqualified`, а в снимке у него место; рейтинг (08) получит `result-revised` с местом.
- **evidence:** `const disqualified = new Set(previous.filter((row) => row.status === 'dq').map((row) => row.entryId));`
  → `ranked.map((entry) => baseOf(entry, disqualified.has(entry._id)))`; `previous` — только строки ревизии
  `current`. Пока участника нет в ревизии, отмена DQ также невозможна (`row_state`).
- **recommended_fix:** выводить действующие DQ гонки из журнала `race_recalculations` (последняя запись
  `disqualified`/`disqualification_revoked` на `entryId`), а не из строк последней ревизии; либо сохранять строку
  DQ в ревизии и без `best` (с временем прошлой ревизии). Int: DQ → перепроверка без best → применение →
  перепроверка с best → применение → строка `dq`.

### [MEDIUM] Исключение трека обходится дублем той же поездки до срока загрузки
- **file:** apps/api/src/modules/results/attempt-intake.ts
- **location:** `syncGroup`, строки 112–140 (с `ensureAttempt`, 165–186)
- **problem:** исключение (D-24) привязано к попытке одной активности. Если в группу дублей приходит более
  приоритетный член (та же поездка с устройства/другого источника) или райдер удаляет исключённую активность при
  живом дубле, представителем группы становится другая активность. Для неё попытки нет — `ensureAttempt` создаёт
  новую `queued`, она засчитывается и даёт `best`. Исключённая остаётся `excluded`, но «ошибочный трек» в зачёте.
- **why_it_matters:** до `uploadClosesAt` райдер может вернуть исключённый результат без участия панели. Чек-лист
  это не ловит: пока новая попытка на проверке, горит `checks_queued`, после вердикта `counted` публикация
  открыта, а в снимок попадает трек, исключённый с причиной.
- **evidence:** `const primary = raceRepresentative(group.members, race)` → `ensureAttempt(tx, entry, race, primary,
  attempts, …)` → `attempts.find((attempt) => attempt.activityId === activity.id)` не находит → новая попытка;
  исключённую цикл `not_primary` не трогает (строки 121–127).
- **recommended_fix:** в рамках scope хватит одного из двух. (a) Не создавать попытку для группы, где у
  заявки есть `excluded`-попытка члена этой группы (исключение действует на поездку). (b) Принять риск явно:
  комментарий в `syncGroup`, запись в §8 task.md / `pokatim-db.md`, int на сценарий дубля. Сейчас поведение не
  описано.

### [LOW] У черновика экран «Результаты» показывает действия, которые сервер отклоняет 404
- **file:** apps/admin/src/features/results/AttemptsTable.tsx
- **location:** строка 110 (`editable`)
- **problem:** `editable = canManage && protocol === null && phase !== 'cancelled'` не исключает `phase === 'draft'`.
  Для черновика `GET …/results` отвечает 200 (DV-8), и кнопка «Перепроверить треки» видна. Мутация отвечает 404,
  окно показывает «Гонка не найдена». Ссылка из `RaceEditor` у черновика скрыта, но маршрут открывается по URL.
- **why_it_matters:** действие, которое не выполнится, нельзя показывать активным (§4.12, кнопки с причиной).
- **evidence:** `lockResults` — фильтр `status ∈ {published, cancelled}`, черновик → `null` → `notFound()`.
- **recommended_fix:** `&& summary.phase !== 'draft'` (или `publish.blockedBy !== 'draft'`) в условии `editable`.

### [LOW] Порог «устаревшего вердикта» зависит от часов двух процессов
- **file:** apps/api/src/modules/results/results.repository.ts
- **location:** `pendingChecks` / `staleVerdictAttempts`, строки 582–635
- **problem:** `requestedAt` ставит часами API, `checkedAt` — часами worker. Если worker отстаёт на δ, вердикт,
  записанный в течение δ после запроса, считается устаревшим. Цикл задачи мог уже пройти эту попытку, и счётчик
  `checks_queued`/`checks_pending` > 0 навсегда, пока не запустят перепроверку снова. Допущение RC-1 (NTP) принято
  в spec.
- **why_it_matters:** публикация и «Применить» будут заблокированы без видимой причины. Выход есть (повторный
  запуск), поэтому это не блокер.
- **evidence:** RC-1 «Допущение: часы API и worker синхронны»; DV-5.
- **recommended_fix:** вне scope можно не делать. Если делать — ставить `checkedAt` вердикта не раньше
  `updatedAt` постановки (`max(now, requeuedAt)`) или писать `requestedAt` в попытку при перепостановке.

# Fix pass 1

Coder. TDD: каждый тест сначала красный по результату, затем зелёный.

- **[MEDIUM] DQ теряется при выпадении из ревизии — исправлено.** `ResultsRepository.disqualifiedEntries` выводит
  действующие DQ из журнала `race_recalculations` (последнее `disqualified`/`disqualification_revoked` по `entryId`
  в порядке ревизий); `applyRecheck` берёт DQ отсюда, а не из строк текущей ревизии. Int
  `results-revisions.int.test.ts` «DQ переживает выпадение из ревизии»: DQ → перепроверка без лучшего (участник
  выпал) → перепроверка с лучшим → строка снова `dq` без места. До исправления — место и `revised`.
- **[MEDIUM] Исключение обходится дублем — исправлено (вариант a).** `AttemptIntake.ensureAttempt` получает
  `groupIds` группы дублей: если у заявки есть `excluded`-попытка члена этой группы, новой попытки нет, итог —
  исключённая (запрос райдера привязывается к ней). Передают `syncGroup` и явная попытка (`AttemptsService`, обе
  ветки — `activityId` и `uploadId`). Int `results-protocol.int.test.ts` «исключение действует на поездку»: после
  исключения загружен дубль с мощностью (новая основная) и выбран явно — попытка одна, `excluded`, лучшего нет. До
  исправления — вторая попытка. Остаётся: удаление исключённой активности при живом дубле — `activity-removed`
  снимает исключённую (`withdrawn`, §7.3), и связь с группой теряется; новая основная получит попытку. Принятый
  риск (удаление требует действия райдера, след — `race_attempt_reviews`); закрытие — отдельной задачей.
- **[LOW] Действия у черновика — исправлено.** `AttemptsTable`: `editable` исключает `phase === 'draft'`. RTL
  «черновик (открыт по URL)» — нет «Исключить трек» и «Перепроверить треки».
- **[LOW] Часы двух процессов** — не менялось (вне scope, допущение RC-1).

# Review pass 2

# Findings — race-results-05-protocol — pass 2 — reviewer: claude (independent-reviewer)
base: origin/develop   commits: 208babd, 7fc163e (re-review fix pass 1), working tree clean
verdict: APPROVE

Проверено прогоном (изоляция `pokatim_05review_test`, Redis db 11): `tsc --noEmit` api/admin/app — ок; vitest
`apps/api/src/modules/results` (unit + int) — 104/104; RTL admin `features/results` — 18/18; jest app
`features/races` — 113/113. «Красный до исправления» для двух новых int — **NOT VERIFIED** (код не правился);
по разбору оба теста ловят исходный дефект: в M2 `powered` — основная (явный выбор по `activityId` прошёл
`isPrimary`, 200), без проверки группы `ensureAttempt` создал бы вторую попытку; в M1 строка r2 без журнала была бы
`revised` с местом.

Закрытие находок pass 1:
- **M1 (DQ при выпадении) — закрыто.** `disqualifiedEntries` читает журнал под тем же `lockResults`, что и
  `toggleDisqualification` (DQ ↔ применение сериализованы записью в документ гонки). Порядок — по `revision`
  (уникальный на гонку, `race_recalculations_revision_unique`) — детерминирован; `recheck_started` (`revision:
  null`) отфильтрован по `kind`. Инвариант «строки ревизии = журнал ∩ ranked» сохраняется: DQ/отмена DQ меняют только
  строки и пишут журнал в одной транзакции. Выборка — по `(raceId, _id)` + сортировка в памяти по единицам записей
  ручных действий — производительность не вопрос. Событие `result-revised` и аудит — без изменений.
- **M2 (дубль в обход исключения) — закрыто в заявленном объёме.** Проверка `excluded` по `groupIds` — после
  проверки срока (поздний член не представитель, A5) и до `existing`; все вызовы `ensureAttempt` (`syncGroup`, обе
  ветки `AttemptsService.add`) передают группу; конкурентность — под `lockEntry`, как и исключение
  (`lockResults` → `lockEntry`). Цикл `not_primary` исключённую не трогает. Побочный, но безопасный эффект: «Вернуть в
  обработку» исключённой попытки неосновного члена перепроверяет старый трек, следующий `syncGroup` снимет её
  `not_primary` и создаст попытку основной — публикацию держит `checks_queued`.
- **L3 (действия у черновика) — закрыто**, RTL покрывает.
- **L4 (часы API/worker)** — допущение задокументировано в task.md RC-1 (стр. ~382); достаточно.

`208babd` (приложение): тоны/время/таблица в `final` — ключи `races.result.status.{final,dq,revised}` и
`races.attempt.status.excluded` есть в `@pokatim/i18n`; `Record` по enum контракта — компилятор проверяет полноту;
баннер места для `final|revised|dq` не показывается — в рамках принятого RC-12.

### [MEDIUM] Новая семантика и остаточный риск зафиксированы только в findings.md
- **file:** docs/adr/0012-race-results.md; docs/tasks/2026-10-27-race-results-05-protocol/task.md
- **location:** ADR-0012 «Реализация п. 6–7», пункты «Исключение трека» и «Перепроверка»; task.md §8 / §12
- **problem:** fix pass 1 изменил доменные правила: исключение действует на поездку (группу дублей), DQ при
  «Применить» берётся из журнала `race_recalculations`, а не переносится со строк. ADR по-прежнему пишет «статус
  попытки `excluded`» и «Снимок меняется только при „Применить“ (перенос DQ)». Принятый риск «райдер удаляет
  исключённую активность при живом дубле → `activity_removed` снимает исключённую, новая основная получает попытку и
  может попасть в протокол» записан только в разделе Fix pass 1 findings.md — ни в §8 task.md, ни в ADR /
  `pokatim-db.md`, ни комментарием в `activityRemoved`/`ensureAttempt`. Pass 1 (вариант b) просил именно это.
- **why_it_matters:** Documentation Sync (§10 task.md): следующий слайс (07 «Требует внимания», 08 рейтинг) будет
  опираться на ADR, а не на findings ревью; дыра в D-24 без записи в каноне будет «открыта заново» или закрыта не там.
- **evidence:** `git show --stat 7fc163e` — из docs изменён только `findings.md`; `grep "перенос DQ"
  docs/adr/0012-race-results.md` — стр. 129; `grep "дубл" task.md` — только стр. 180 (запрет дублей кода).
- **recommended_fix:** ADR-0012: «исключение действует на группу дублей заявки (D-24); DQ при „Применить“ —
  действующие по журналу пересчётов»; task.md §8.2 — запись о принятом риске удаления исключённой активности (с
  follow-up); однострочный комментарий в `activityRemoved` о том, что исключённая снимается и связь с группой теряется.

### [LOW] Дубль исключённой поездки выглядит в «Выбрать свой заезд» как доступный, выбор молча привязывается к исключённой
- **file:** apps/api/src/modules/results/attempts.service.ts
- **location:** `candidates`, `attempted` (стр. ~126–131); `add` → `ensureAttempt` (стр. 85)
- **problem:** `attempted` считается по `activityId` попыток. После M2 у основной-дубля (`B`) попытки нет, поэтому
  кандидат `B` показан `attempted: false`; выбор отвечает 200, новой попытки нет, запрос привязан к исключённой
  попытке `A`. Райдер может повторять выбор (расходуя `maxRequestsPerEntry`), не понимая, почему ничего не меняется.
- **why_it_matters:** UX/честность состояния; на зачёт не влияет (защита сервера работает), поэтому не блокер.
- **evidence:** `attempted = new Set(attempts.filter(status !== 'withdrawn').map(a => a.activityId))`; int
  «исключение действует на поездку» — `explicit.status === 200`, попыток 1.
- **recommended_fix:** по желанию: помечать `attempted` для основных, чья группа содержит исключённую попытку заявки
  (или вернуть `ATTEMPT_SOURCE_INVALID`); либо принять и записать вместе с MEDIUM выше.

Итог: CRITICAL/HIGH нет — **APPROVE**. M1, M2, L3 pass 1 закрыты; L4 — принятое и задокументированное допущение.
