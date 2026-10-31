# Findings — achievement-season-story-card — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..c3e52b80 (1 commit; working tree clean)
verdict: APPROVE

## Проверено (evidence)

- Прогоны ревьюера: api unit (`achievement-card.render`, `story-card.processor`, `achievements-for-sharing.port`,
  `achievements.policy`) — 89/89; int `achievement-card.int.test.ts` на реальных Mongo/Redis (отдельная БД
  `pokatim_rvw_seasoncard_test`, Redis db 13) — 20/20; app jest (`achievement-story`, `achievement-flash`,
  `features/achievements`) — 91/91; contracts `src/sharing` — 19/19. `pnpm check` целиком и e2e web — NOT VERIFIED
  (не запускались ревьюером).
- **Право (C4/AC1):** `AchievementsSharing.seasonalFacts` — выдача по `(userId, code, seasonId)` из `listSeasonalOf`
  (`userId` из access, проекция включает `override`), `revokedAt === null`; исход — `standings.outcomesOf` напрямую;
  ручная (`manuallyGranted`) — при любом статусе; иначе `final` ∧ `seasonalAchievements([outcome]).earned`. `pending`
  без ручной → `null` → 409. Незнакомый сезон отсекается на поиске выдачи (порт не зовётся) — тот же 409, что чужой.
  `manuallyGranted` вынесен в policy без изменения поведения (оба call site в `achievements.service.ts` импортируют его).
- **400 до лимита:** pipe `AchievementStoryCardQuery` (strict, `Uuid`) → `cardRef` → 400 `seasonId:REQUIRED|INVALID`
  до `consumeRead`; int-тест шпионит `consumeRead` и проверяет отсутствие вызова и задач.
- **Хэш несезонных:** `achievementCardHash` в diff не менялся (только комментарий), фикстура `input()` не менялась;
  сторож — фиксированный hex. `renderVersion` = 3.
- **Очередь старого формата:** `AchievementCardJob.seasonId: Uuid.nullable().default(null)`; `routeOf` → `safeParse`;
  unit-тест: задача без поля → `seasonId: null`. Worker собирает тот же `cardRef`, несоответствие — `skipped`.
- **Сбой порта не 409:** исключение из `outcomesOf` не перехватывается (`seasonalFacts`), HTTP — 500 через
  `ApiExceptionFilter` (логирует только исключение, Fastify request-лог выключен); worker — `run` пробрасывает до
  последней попытки (ретрай). Int-тест HTTP 500 без задачи.
- **Картинка — только публичное:** порт отдаёт `object { kind:'season', id, title }`, `factDate`, `level:null`; на дереве
  — «Сезон «…»», дата, глиф; render-тест проверяет отсутствие id сезона; мест/очков порт не отдаёт.
- **Логи:** worker — `achievement <code> <template>`; int-тест проверяет отсутствие `userId`, `seasonId`, названия,
  токена в логах.
- **Приложение:** ключ `['achievements','story',code,seasonId,template]`; запрос с `seasonId` только у сезонного;
  сезонный без/с кривым `season` — `valid = null`, `source = null` → «Карточки нет» без запроса (тест
  `getAchievementCard` not called); несезонный `?season` игнорируется (RC-8); дубль `achievementPath` удалён (RC-9).
- **Совместимость:** старые сборки шлют `{ template }` — валидно; сезонных запросов у них нет (`storyCard:false`).
  Новый web + старый API — 400 (принято RC-11).
- **Граф модулей:** `AchievementsReadModule` += `StandingsCoreModule`; `sharing` standings напрямую не импортирует;
  правило `pokatim-backend.md` переписано.
- **Documentation Sync (§10):** `profile.md`, ADR-0018, ADR-0020, `pokatim-{backend,security,contracts,app}.md` —
  обновлены по списку.

## Findings

### [LOW] Тест «ручная выдача при `pending`» не доказывает, что сезон действительно `pending`
- **file:** apps/api/src/modules/sharing/achievement-card.int.test.ts
- **location:** `it('ручная выдача — карточка, в т. ч. в сезоне `pending`; ручной отзыв — 409')`
- **problem:** после `addRevision(h, race, 2, …)` без `syncStandings` сезон ожидаемо `pending`, но это нигде не
  утверждается; к тому же у `me` нет строк в этом сезоне, так что авто-ветка дала бы `null` и при `final` — тест
  проходит одинаково при любом статусе исхода и не различает «ручная разрешена в `pending`» от «ручная разрешена в
  `final`».
- **why_it_matters:** строка матрицы 7.5 «ручная выдача (в т. ч. при `pending`) — карточка» покрыта слабее, чем
  заявлено; регрессия, ограничивающая ручную ветку `final`-статусом, этот тест не уронит.
- **evidence:** условие в `seasonalFacts`: `!manuallyGranted(grant) && (outcome.status !== 'final' || …)` — тест не
  фиксирует `outcome.status`.
- **recommended_fix:** утвердить статус (`h.app.get(RIDER_SEASON_STANDINGS).outcomesOf(me.userId, [other2024], now)` →
  `status: 'pending'`) перед запросом карточки.

### [LOW] Сезонные карточки без имени у разных райдеров делят хэш, токен и задачу
- **file:** apps/api/src/modules/sharing/achievement-card.inputs.ts
- **location:** `achievementCardHash` (канон без `userId`), `CardRequests.status` (`jobId achievement-card-<hash>`)
- **problem:** «Сезон в зачёте» одного сезона у многих райдеров без согласия на имя и с одной темой даёт одинаковый
  канон → один `pending:<hash>`, одна задача с `userId` первого запросившего, один PNG/токен для всех.
- **why_it_matters:** утечки нет (картинка идентична, без id и `userId`), поведение унаследовано от
  `race_first_finish`; но у сезонных совпадения массовые: если право потеряет именно владелец задачи, рендер `skipped`,
  и остальные перепоставят задачу (лишний расход `story-card-render`). Принять или отметить в ADR-0018.
- **evidence:** канон: `['achievement', renderVersion, template, themeId, code, level, kind, object.id, objectTitle,
  factDate, riderName]`.
- **recommended_fix:** изменений кода не требуется; при желании — одна строка в ADR-0018 «общий PNG для идентичных
  входов разных райдеров — намеренно».

## Вердикт

APPROVE — CRITICAL/HIGH нет.
