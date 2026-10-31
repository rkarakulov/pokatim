# Findings — achievements-seasonal — pass 1 — reviewer: claude
base: origin/develop   commits: aeb5066f..66e6d868 (рабочее дерево чистое)
verdict: APPROVE

Проверено независимо (не по отчёту coder):
- unit: `achievements.policy.test.ts` 47/47, contracts `src/achievements` 9/9;
- int на изолированной БД (`pokatim_review_seasonal_test`, Redis db 11): `src/modules/achievements/**`,
  `rider-season-standings.int.test.ts`, `migrations.int.test.ts`, `achievement-card.int.test.ts`,
  `account-erasure.int.test.ts` — 6 файлов, 158/158;
- app jest: `features/achievements`, `__tests__/achievement*` — 8 наборов, 99/99.
- `pnpm check` целиком не запускал (NOT VERIFIED мной; coder заявляет 15/15).

Покрытые измерения без находок:
- **Гонки параллельных сверок:** каждая запись — одна условная операция над одним документом; вставка —
  `isDuplicateKey(…, 'achievement_season_grants_user_code_season_unique')` → `false`; restore — `revokedAt: {$ne:null}`,
  revoke — `revokedAt: null`; маркер ставится после обоих планов. Порт читает снимок (строки + заголовки) в одной
  snapshot-сессии, источник — после: пересчёт между чтениями даёт `pending` (безопасная сторона). Окно «устаревший GET
  отозвал/вставил после свежего» существует, но это та же eventual consistency, что задокументирована в task §5 и ADR-0020;
  ответ показывает только видимые ∩ заработанные в этом запросе. AC4 (×5) зелёный.
- **Совместимость:** старые сборки — новые коды/вид `season` → `unknown` (`tolerantEnum`), `knownItems` отбрасывает;
  `{ codes: [...] }` валиден (тест), сезонные в `codes` отфильтровываются до pipeline; новая сборка шлёт `seasonal`
  только непустым, а несезонные цели всегда дают непустой `codes` → старый API (min 1) не получает 400. Документы v1
  `achievement_grants` и их индекс не тронуты (тест AC6).
- **Границы модулей:** `achievements → standings` только через `standings/index.ts`, только в `AchievementsModule`;
  `AchievementsReadModule`/`sharing` порт не получают; `standings → races` через существующий `SEASON_RACES`; чтений
  чужих коллекций из `achievements` нет; циклов нет.
- **Миграция 0043:** только expand (`ensureCollection` + `createIndex`), идемпотентна, без транзакции/бэкфилла, в конце
  `migrations`; не запускается при старте (общий `db:migrate`). Номер свободен относительно локального ref
  `origin/develop` (последняя — `0042_profile_report_reasons`); свежий fetch не делал — перепроверить перед merge.
- **Приватность публичного списка:** `findPublic` до любых чтений (иначе 404), сезонные — только `final`, без чтения
  выдач и без записи; наружу — `code`, `object{kind:'season',id,title}`, `factDate`, `level:null` — мест, очков,
  `userId`, `_id` нет; id сезона публичен (`/seasons/:id`), таблица сезона и так публична. Логи — только счётчики.
- **Безопасность `seen`:** `strictObject`, `seasonal` ≤ 30, `Uuid` + строгий enum, `$or` из примитивов, `userId` в
  фильтре. Карточка сезонного → `null` → 409 (тест).
- Серверный авторитет, append-only (не задействован), BullMQ (нет задач), дизайн-система (кнопки `@rkarakulov/ui`),
  состояния данных (экран/вспышка — прежние `AsyncContent`/пустое состояние), все платформы (развилок нет), i18n (ru),
  Documentation Sync (profile.md, ADR-0020, races-and-seasons.md, 5 файлов rules — есть; `pr.md` — см. LOW).

### [MEDIUM] Сбой порта `standings` роняет весь список достижений и публичный профиль
- **file:** apps/api/src/modules/achievements/achievements.service.ts
- **location:** `sync` (вызов `this.standings.outcomesOf` во втором `Promise.all`), `publicList` (`Promise.all` с `outcomesOf`)
- **problem:** исключение порта (snapshot-сессия — `SnapshotTooOld`/транзиентная ошибка, сбой `aggregate`
  `currentRevisions`, `seasons.find`) не перехватывается: `GET /v1/achievements` и
  `GET /v1/riders/:publicId/achievements` отвечают 500 целиком, включая несезонные достижения и прогресс. До PR
  достижения от `standings` не зависели. Task 7.2 предусматривал «логи порта — только при сбое», но ни порт, ни сервис
  сбой не обрабатывают; у первой сверки при этом не ставится маркер, пока сбой не уйдёт.
- **why_it_matters:** деградация смежной подсистемы (рейтинг) выключает профиль райдера и вспышки — регресс доступности
  существующей функции ради вторичной.
- **evidence:** `const [titled, outcomes] = await Promise.all([this.facts.titled(earned, userId), this.standings.outcomesOf(userId, seasonIds, now)]);` — без `try/catch`; в `rider-season-standings.ts` обработки ошибок нет.
- **recommended_fix:** в сервисе обернуть `outcomesOf` (лог `achievements.seasonal_unavailable uid=…` без сезонов) и при
  сбое вести себя как при `pending` для всех сохранённых сезонов: сезонный план не строить (ни вставки, ни отзыва),
  видимые сезонные выдачи в этом ответе пропустить (названия сезона нет; записи не трогаются), несезонные — как
  обычно; публичный список — без сезонных. Тест: шпион порта бросает → 200 с несезонными, сезонных записей нет.

### [LOW] Сезон может навсегда остаться `pending` — выдачи не отзываются
- **file:** apps/api/src/modules/standings/rider-season-standings.ts
- **location:** вычисление `final` (`sources.get(season.id)?.fingerprint === fingerprint`)
- **problem:** если у сезона есть заголовок снимка, но `StandingsSource.load` его не вернул (в сезоне не осталось гонок с
  протоколом/ревизией — `standings.revision_missing`) или регламент стоит на `standings.version_conflict`, сезон всегда
  `pending`: регламент такой снимок не трогает, сверка — тоже, сохранённая выдача висит вечно. В `panelSummary` тот же
  случай (`source === undefined`) считается `current`, а не «ждёт пересчёта» — два разных толкования одного состояния.
- **why_it_matters:** редкий, но тихий сценарий: «Чемпион сезона» остаётся у райдера, хотя протоколов уже нет; виден
  только в своём профиле (публично — нет, т. к. не `final`).
- **evidence:** `const final = !awaiting.has(season.id) && fingerprint !== undefined && sources.get(season.id)?.fingerprint === fingerprint;` vs `standings-read.service.ts`: `const pending = source !== undefined && source.fingerprint !== header?.fingerprint;`
- **recommended_fix:** зафиксировать решение в ADR-0020 (принять как известное ограничение) или считать «источника нет и
  гонок, ждущих протокола, нет» как `final` с пустыми строками; минимум — комментарий в порте.

### [LOW] Правила `.claude/rules/pokatim-backend.md` частично не синхронизированы с кодом
- **file:** .claude/rules/pokatim-backend.md
- **location:** раздел «Достижения», пункты про `ACHIEVEMENT_RULES` и состав `AchievementsModule`
- **problem:** осталось «`ACHIEVEMENT_RULES` (`satisfies Record<AchievementCode, …>` — новый код без правила не
  скомпилируется)», хотя теперь `Record<FactAchievementCode, …>` (сезонные — `SEASONAL_RULES`); перечень импортов
  `AchievementsModule` («+ `IdentityModule`, `ProfileCoreModule`, `ResultsCoreModule`, `AchievementsReadModule`») без
  `StandingsCoreModule` (он упомянут только абзацем выше).
- **why_it_matters:** правила — канон для следующих сессий; противоречие с кодом вводит в заблуждение.
- **evidence:** `.claude/rules/pokatim-backend.md:347`; `achievements.policy.ts`: `} satisfies Record<FactAchievementCode, (facts: Sorted) => Earned | null>;`
- **recommended_fix:** поправить два места формулировкой «по несезонным (`FactAchievementCode`)» и добавить
  `StandingsCoreModule` в перечень.

### [LOW] Условие «Сезон в зачёте» читается как «ровно 3»
- **file:** packages/i18n/src/ru.ts
- **location:** `achievements.season_regular.condition`
- **problem:** «Финиш с местом в {count} гонках одной таблицы сезона» → «…в 3 гонках…», правило — `≥ 3`.
- **why_it_matters:** косметика; у райдера с 7 финишами формулировка выглядит неточной.
- **evidence:** `SEASONAL_RULES.season_regular: rows.some((row) => row.placedRaces >= SEASON_REGULAR_MIN_RACES)`
- **recommended_fix:** «Финиш с местом минимум в {count} гонках одной таблицы сезона» (или «{count} и более»).

### [LOW] `pr.md` (раздел 10 task.md) ещё не создан
- **file:** docs/tasks/2026-10-31-achievements-seasonal/
- **location:** —
- **problem:** раздел 10 требует `pr.md` с пометкой о миграции `0043` (только expand, миграции до API); отложено на FINISH
  (task 8.2).
- **why_it_matters:** деплой-нота о миграции обязательна для выката; не блокер ревью кода.
- **recommended_fix:** создать на шаге FINISH, там же перепроверить номер `0043` против свежего `origin/develop`.
