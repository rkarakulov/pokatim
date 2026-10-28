# Findings — race-results-08a-season-standings — pass 1 — reviewer: claude
base: origin/develop   commits: cd19a21..d2efb00 (working tree clean)
verdict: APPROVE

Скоуп — только 08a (contracts, api-client, `apps/api`, миграция, правила). Панель (08b) и приложение (08c) не
ревьюились — их отсутствие не замечание.

## Проверено (evidence)

- Прогон: `vitest run src/modules/standings src/db/migrations/migrations.int.test.ts src/admin-routes.test.ts`
  (своя БД `pokatim_rev08a_test` на replica set `127.0.0.1:27117`, Redis db 13) — `Test Files 6 passed`,
  `Tests 64 passed`; unit `standings.policy`, `standings-schedules`, `admin-routes` — `20 passed`.
- Формула (`standings.policy.ts`): Ф1 (`pointsForPlace`, 11→36, 28→2, 29+→1), `N = M − ⌊M/3⌋`, `cellOf` (dq → 0,
  `none` → 0), `selectCounted` — DQ занимают слоты первыми, затем placed по `(points desc, place asc, индекс)`
  (RC-10), `none` никогда не `counted`; `tieKey`/`compareRiders` — лексикографически, отсутствие = +∞; места серии
  «=N» = `start + 1`, следующее — `N + число равных`; M — гонки класса, чья схема даёт группу (гонка без строк
  группы — в M), `overall` отдельно. Golden спайка §4.1 пересчитан вручную — совпадает (Дима: Г2 `dq counted`,
  Г1 `counted: false`, 75).
- RC-5: `claimSeason` — первая операция транзакции, фильтр `$or` по `formulaVersion`/`sourceVersion`, upsert →
  `_id_` duplicate → `stale`, транзакция откатывается; int-тест с воротами + постоянное отрицательное доказательство
  + первый upsert двумя транзакциями. `sourceVersion` монотонна по RC-1 — проверил `races.policy.ts`: фаза `final`
  (`protocolPublished`) разрешает только `description` (`FINAL_FIELDS`), отмена после протокола запрещена,
  `deleteDraft` — только черновики.
- Регламент: `* * * * *` Минск, `upsertJobScheduler` + boot-задача с `jobId`; без изменений — `claimSeason` не
  вызывается; отказ сезона — `failed++`, остальные идут, затем `throw standings.sync_failed` (тест).
- Порты: `standings` читает только `SEASON_RACES` / `RESULTS_FOR_STANDINGS` / `RIDER_NAMES` через `index.ts`;
  `races`/`results` о `standings` не знают. Запрос `listProtocolRaces` содержит ровно `protocolPublishedAt:
  { $type: 'date' }` (частичный индекс применим). `currentRevisions` — один `aggregate` с `revision: { $type:
  'number' }`.
- Публичные ответы: ключи строк проверены тестом, `userId` нет; имя — `publicNames` (согласие); `/me` — `AuthGuard`,
  `no-store`, пользователь из access; панель — `PanelGuard` + `races.read`, `userId` только при `!ownScope`
  (organizer → `null`, тест). 404 до разбора курсора, курсор чужого сезона — 400.
- Миграция `0030_standings` — expand-only, `ensureCollection` + `createIndex`, повторный `up` в тесте, опции
  (`unique`, `partialFilterExpression`) сверены.
- Documentation Sync (§10): `pokatim-backend/db/security/contracts.md`, ADR-0017 п. 5, `notifications.md`,
  `races-and-seasons.md` (серверная часть), `epic.md` — обновлены; исключение из правила порта стирания (RC-6)
  записано в `pokatim-db.md`.

CRITICAL / HIGH — нет.

### [LOW] Вечный цикл «пересчёт → stale» при несовпавшем отпечатке и не-большей версии
- **file:** apps/api/src/modules/standings/standings-recalc.ts
- **location:** `sync`, строка 43 (сравнение только `fingerprint`); `standings.repository.ts:57-63` (`fingerprints`
  проецирует только `_id, fingerprint`)
- **problem:** регламент решает «пересчитывать» только по неравенству отпечатков. Если сохранённый заголовок не старше
  (`formulaVersion` больше — откат деплоя; или та же формула и та же `sourceVersion`, но другой отпечаток — например,
  поменяли маппинг схемы в порте `SeasonRaces`/RC-2 без подъёма `STANDINGS_FORMULA_VERSION`), каждый прогон раз в
  минуту полностью пересчитывает такие сезоны (чтение всех строк протоколов), получает `stale` и пишет `warn`; в
  панели `sync: 'pending'` навсегда, снимок не обновится никогда (во втором случае — молча неверная таблица).
- **why_it_matters:** откат деплоя RC-5 принял («только лог»), но цена — полный пересчёт всех сезонов каждую минуту;
  второй сценарий — тихое расхождение, отличимое от нормальной гонки двух worker только по частоте логов.
- **evidence:** `if (fingerprints.get(seasonId) === source.fingerprint) continue;` → `recompute` → `writeSnapshot`
  → `stale`; повторяется на каждом тике, условие выхода нет.
- **recommended_fix:** проецировать в `fingerprints()` также `formulaVersion, sourceVersion` и не пересчитывать,
  если сохранённый заголовок не старше источника (`stored.formulaVersion > F` или `= F && stored.sourceVersion >=
  source.sourceVersion`), логируя отдельным кодом `standings.version_conflict season=<id>` (для равной версии с
  другим отпечатком — `error`); в `pokatim-backend.md` — правило «изменение входа отпечатка → поднять
  `STANDINGS_FORMULA_VERSION`».

### [LOW] Курсор таблицы не привязан к снимку
- **file:** apps/api/src/modules/standings/standings-read.service.ts
- **location:** `table`/`panelTable` (`nextCursor`, строки 93, 169), `page` (строки 197-202)
- **problem:** курсор — только `order` + `seasonId`. Если между страницами регламент записал новый снимок, следующая
  страница читается из нового снимка по позиции старого — строки могут задублироваться или пропасть, места на
  соседних страницах из разных пересчётов.
- **why_it_matters:** таблица сезона растёт по ходу сезона, пересчёт до раза в минуту; при «Показать ещё» (08c) или в
  панели (08b) возможна несогласованная склейка. Контракт уже отдаёт `computedAt` в каждой странице — обнаружить
  можно, но 08a этого никак не оговаривает.
- **evidence:** `encodeCursor(String(rows.at(-1)!.order), seasonId)`; в `page` версия снимка из курсора не
  сверяется.
- **recommended_fix:** минимум — зафиксировать в task.md / `pokatim-contracts.md` для 08b/08c: при смене
  `computedAt` между страницами сбрасывать подгруженные страницы и грузить с начала (как RC-11 для «Вы»).
  Альтернатива — включить `sourceVersion` в ключ курсора и при несовпадении отвечать `400 cursor:INVALID`.

## Вердикт

APPROVE — CRITICAL/HIGH нет; две LOW — по желанию (первую разумно сделать до выката, она дешёвая).
