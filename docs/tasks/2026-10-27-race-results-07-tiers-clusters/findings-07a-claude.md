# Findings — race-results-07a — pass 1 — reviewer: claude
base: origin/develop   commits: 3bcb936 (origin/develop..HEAD, рабочее дерево чистое)
verdict: APPROVE

Тесты не запускались (по поручению оркестратора); выводы — по diff, вызовам и тестам как коду.

Проверено без замечаний: матрица `planEntryChange` (RC-1…RC-3) и порядок шагов `EntriesService.enter`
(`admitEntry` → `lockEntryOf` → `lockForEntry` → план; ошибка плана откатывает фиксацию анкеты); повышение
START → Verified (`setEntryTier` с фильтром `tier: 'start'` + `refreshEntry` под тем же замком; worker берёт свежую
заявку из `lockEntry` — конфликт записи); гонка «первая Verified-заявка ↔ PUT анкеты» (запись документа анкеты в
транзакции + условие `$or` в фильтре `PUT`, тест с удержанием и отрицательные доказательства); панельная правка
(первая операция — условная запись, журнал только `changedFields`, лог без значений и `userId` райдера, право только
admin, обход `admin-routes.test.ts` автоматический); места по группе — одинаковые фильтры (`rankedFilter`) у
публичной таблицы, «моего участия», `entryResult` споров; «Участники» панели и протокол — один `buildProtocol`
(`order` сквозной, DQ в конце группы, `SPEED_CLUSTER_HIGH` вычищается из датчиков DQ-ревизии и считается заново);
`resultStatus` `finisher`/`unrankedOf`; старые строки протокола (`groupKey` нет → `$in: ['overall', null]`, курсор,
`protocolGroups` `$ifNull`); миграция `0025` (идемпотентные `updateMany`, явный `null` схемы + `$ifNull`/`$cond` в
`admitEntry` и `toRace` закрывают RC-7 для гонок, новые индексы до `dropIndex`, `indexExists`); ответы приложения
собираются явным списком полей (флагов/датчиков в публичных ответах и «моём участии» нет); `RaceEntryRequest`
принимает `{}`/отсутствие тела, новые поля ответов — `.default`, `finisher` и новые группы — `tolerantEnum`; споры
(`not_ranked`, `target_not_counted` для START/без пульса/другой группы); стирание анкеты в `ProfileErasure`
(повторяемо); `sensor-flags.ts` — только стираемый TS (поток разбора), без значений пульса/мощности в результате,
окна O(n). Циклов модулей нет (`profile → identity` через `IdentityAccountsModule`).

### [MEDIUM] AC9-тест ключей для финишёров и «моего участия» — тавтология (ответ уже прогнан через zod)
- **file:** apps/api/src/modules/results/results-tiers.int.test.ts
- **location:** 379–385 (`for (const body of [res.body, women, finishers])`, `keysOf(await myEntry(...))`)
- **problem:** `women` и `finishers` — результаты `RaceResultsPage.parse` / `RaceFinishersPage.parse`, `myEntry` из
  `apps/api/test/results.ts:240` возвращает `MyRaceEntry.parse(res.body)`. `z.object` отбрасывает незнакомые ключи,
  поэтому `flags`/`sensors`/`tier` в сыром ответе этих эндпоинтов тест не увидит никогда. Честно проверен только
  `res.body` первой публичной таблицы.
- **why_it_matters:** AC9 («флаги видны только в панели; публичные ответы и „моё участие“ флагов не содержат — тест
  ключей ответа») для `GET /v1/races/:id/finishers` и `GET /v1/races/:id/entry` не доказан: регрессия вида
  `...row` / `...attempt` в маппинге пройдёт зелёной (правило tests.md: тест проверяет поведение, тавтологии —
  дефект). Сейчас утечки нет — ответы собраны явным списком полей (`results-read.service.ts` `finishers`,
  `myAttempt`), но сторожа у них нет.
- **evidence:** `const finishers = RaceFinishersPage.parse((await call(...)).body)`; `myEntry` → `MyRaceEntry.parse`.
- **recommended_fix:** проверять `keysOf` по сырому `.body` ответов `call(h, 'GET', …/finishers)`,
  `…/results?group=w_u40` и `call(h, 'GET', entryUrl(raceId), undefined, auth)` (не через `parse`).

### [LOW] Golden флагов датчиков не содержит ни одного сработавшего флага
- **file:** packages/tracks/src/__fixtures__/sensor-flags-golden.json
- **location:** весь файл (`"flags": []` у всех 4 треков)
- **problem:** golden по реальным трекам фиксирует только `sensors`; ни одна метрика `HR_GAPS`/`HR_POWER_DECOUPLED`
  на реальных данных не проверяется — изменение расчёта метрик/порогов, не меняющее «есть/нет флага» на этих треках,
  golden не поймает (держат только синтетические unit-тесты).
- **why_it_matters:** сторож `FLAGS_VERSION` (R3) на реальных данных слабее, чем у коридора.
- **recommended_fix:** добавить в golden хотя бы одну производную реальную фикстуру с флагом (например, трек с
  вырезанным участком `hr`), или зафиксировать в golden сырые доли/проценты (`share`, `pct`) до сравнения с порогом.

### [LOW] Проверочные запросы pr.md (RC-7) не ловят все последствия окна деплоя
- **file:** docs/tasks/2026-10-27-race-results-07-tiers-clusters/pr.md
- **location:** «Порядок деплоя», третий запрос
- **problem:** (1) миграция ставит `groupScheme: null` всем гонкам без `lockedAt`, поэтому запрос
  `{ lockedAt: { $type: 'date' }, groupScheme: { $exists: false } }` после миграции всегда 0 — гонку, получившую
  первую заявку от старого API, он не покажет (чтение при этом корректно: `toRace`/`$ifNull` дают `overall`);
  (2) попытки, проверенные старым worker в новой `gender_age`-гонке, не имеют `sensors` → Verified-заявка станет «Без
  пульса» (`pickBest` `heart_rate`), запросов на это нет.
- **why_it_matters:** принятый риск RC-7 описан неполно; оператор не увидит заявки, потерявшие место.
- **recommended_fix:** заменить запрос 3 на `{ lockedAt: { $type: 'date' }, groupScheme: null }` (информативно) и
  добавить `db.race_attempts.countDocuments({ status: 'counted', sensors: { $exists: false }, checkedAt: { $gte:
  <время миграции> } })` с действием «Перепроверить треки».

### [LOW] Группа по умолчанию пересчитывается на каждой странице — курсор старого клиента может стать 400
- **file:** apps/api/src/modules/results/results-read.service.ts
- **location:** 351, 482 (`query.group ?? defaultGroup(race, groups)`)
- **problem:** старое приложение листает без `group`; если между страницами в более раннюю по справочнику группу
  пришла первая строка (например, `m_u40` стала непустой), группа по умолчанию меняется и курсор строки прежней
  группы даёт `400 cursor`.
- **why_it_matters:** редкий сбой пагинации у старых клиентов на живой таблице (RC-10 принимает показ одной группы,
  но не обрыв листания).
- **recommended_fix:** без `group` в запросе, но с курсором — брать группу строки курсора (`entry.groupKey` /
  `row.groupKey ?? 'overall'`), а не пересчитывать умолчание.

### [LOW] Сводка панели строит все «Участники» ради счётчика `attention`
- **file:** apps/api/src/modules/results/results-panel-read.service.ts; apps/api/src/modules/results/results.policy.ts
- **location:** results-panel-read.service.ts:190 (`standingItems` в `summary`); results.policy.ts:676
  (`byGroup.set(…, [...spread])`)
- **problem:** каждый `GET …/results` теперь читает до ~2000 заявок и гоняет `buildProtocol`; `speedClusterFlags`
  копирует массив группы на каждой строке (O(n²) на группу). Предел 1000 строк держит это в разумных рамках, в
  follow-up отмечено.
- **why_it_matters:** нагрузка на частый запрос панели растёт с размером гонки.
- **recommended_fix:** `byGroup.get(...)?.push(...)` вместо копирования; счётчик — отдельной лёгкой выборкой при
  росте гонок (как в follow-up).

### [LOW] Окно базы рывка в начале сегмента короче 60 с
- **file:** packages/tracks/src/sensor-flags.ts
- **location:** 164–167
- **problem:** база рывка — отсчёты в `[t − 65 с, t − 5 с)` только внутри сегмента; в первые ~65 с сегмента база
  строится по нескольким отсчётам (достаточно одного), что даёт ложные «рывки» на старте (разгон со старта почти
  всегда > 1,5× от пары секунд до него). Спайк: «среднее за предыдущие 60 с».
- **why_it_matters:** завышает `surges` и долю «без ответа» в (б) `HR_POWER_DECOUPLED` на коротких сегментах ≥ 20 мин.
- **recommended_fix:** требовать `t − 65 с ≥ startedAt` (полное окно базы) или минимальное покрытие окна базы;
  граничный unit-тест; смена — `FLAGS_VERSION`.

### [LOW] RC-3 (смена группы Verified в открытом окне) ждёт подтверждения автора
- **file:** docs/tasks/2026-10-27-race-results-07-tiers-clusters/task.md
- **location:** §8.1 RC-3
- **problem:** architect пометил «нужно подтверждение автора»; в task.md подтверждения нет, реализовано решение по
  умолчанию (`409 RACE_TIER_LOCKED`).
- **why_it_matters:** продуктовое решение без подписи; 07c построит UI на этом поведении.
- **recommended_fix:** получить и записать решение автора до 07c (код меняется одной веткой `planEntryChange`).

Измерения без находок: безопасность (AuthN/AuthZ, `no-store`, лимит `PUT` 30/ч, фильтры — примитивы после zod,
вес/рост/FTP только владельцу), placement (анкета в `profile`, `results` — только порт `VERIFIED_PROFILES`),
серверный авторитет (группа, правило мест, флаги — сервер), append-only (`race_protocol_rows` только вставки,
журнал `panel_audit`), outbox (новых событий нет, R4), идемпотентность worker (вердикт своей ревизией, перепостановка
сбрасывает датчики), i18n (коды ошибок, группы, уровни, флаги, `finisher`, `not_ranked`), Documentation Sync (§10:
rules, product, epic, pr.md — обновлены), дизайн-система/состояния/платформы — UI в 07a нет (только тон `finisher` и
фикстуры).
