# Findings — achievements-push — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..HEAD (148c2830..c1dbccf7, scope — только N1)
verdict: APPROVE

Объём ревью: N1 — `AchievementsReconciler` (транзакция + outbox), `notifiedLevel`/`noticeDue`, событие
`achievements.grant-noticed`, порт `ACHIEVEMENT_NOTICES` (+ `seasonTitles`), приём в `notifications` (`inApp`,
схлопывание, группа, подресурс настроек), контракты, api-client, приложение (цель, SW, секция настроек), документы.
Отсутствие N2 (worker, sweep, порты источников, `0044`, AC3/AC5) дефектом не считается.

Проверено по измерениям (без находок):

- **Транзакции и outbox / P3.** Вставка не в первой сверке: `id = uuidv7()` до `run`, `insert*InTx` + `append` в одном
  колбэке, `isDuplicateKey` — только снаружи `run` (`insertWithNotice`); транзиентный повтор колбэка переиспользует тот же
  `_id` (вставка откатилась — дубля по `_id` нет). `refresh`/`restore`: первая операция транзакции —
  `findOneAndUpdate` (pipeline, `returnDocument: 'before'`, `notifiedLevel = $max(ifNull(notifiedLevel, ifNull(level,1)),
  L)`), решение `noticeDue(before, L)` по документу до записи; параллельная сверка получает WriteConflict →
  `withTransaction` (api-kit `MongoTransactions.run` = `session.withTransaction`) повторяет колбэк → видит
  закоммиченный `notifiedLevel` → без события. Проверил и окно «первая сверка у A / не первая у B» (B читает `stored` до
  вставок A и `syncedAt` после маркера) — дубль индекса ловится снаружи, лишнего события нет. Значения в pipeline — под
  `$literal` (объект/дата не интерпретируются как выражения).
- **Отрицательные доказательства (а)–(в)** в `achievements-notices.int.test.ts` — честные: механизм убирается подменой,
  нарушение видно по результату (`{grants:1, events:0}`, `NoSuchTransaction`, `events > 1`), не по таймауту; вторая линия
  (схлопывание N7) проверена отдельно.
- **Совместимость старых сборок.** `NotificationSettings` (strict) не менялся, `get()` собирает ответ явным списком
  ключей; `PUT /settings` — `$set` известных путей, `push.achievements` не стирается (int-тест). Группа/вид — в конец,
  `tolerantEnum`; цель — `NotificationTargetView` со структурным fallback `{ type: string } → unknown`. Outbox-публикатор
  api-kit читает только маршрутизированные типы (`types = [...queues.keys()]`) — событие, записанное новым API до
  выката нового worker, ждёт в outbox, очередь не блокирует.
- **Тексты без ПДн.** Заголовок — каталог `@pokatim/i18n` (`achievements.*`, ключи существуют), тело — название своего
  объекта (`titled`: гонка через `racesOf`, маршрут — только видимый, RC-4); `oneLine`. Payload события — id/коды,
  без `userId`; получатель — владелец выдачи из порта, не из payload; `liveUserIds` в intake сохранён.
- **Белый список целей.** Приложение — `NotificationTarget.safeParse` (строгий `AchievementCode`, `Uuid`), путь —
  `achievementPath` (reuse); SW — `SW_ACHIEVEMENT_CODES` + UUID-regex, паритет и равенство с `ACHIEVEMENT_CODES` держит
  тест.
- **Общий код notifications.** Изменения аддитивны: `inApp?` опционален во всех слоях (`NoticeDraft`, `RenderedDraft`,
  `FanoutJobData`), по умолчанию `false`; `initialDelivery` — новый необязательный аргумент; `TITLES` — `Exclude` вида с
  функциональным заголовком; `DeliverySettings.email` исключает группу; `PushDelivery` не трогали (`in_app` — уже
  `skipped`, не захватывается). Другие источники не затронуты.
- **Placement.** `AchievementsSyncModule` (Core + Read + StandingsCore), рёбра `notifications → achievements` через
  `index.ts`, `achievements` о `notifications` не знает; `arch:check` зелёный.
- **Приложение.** Секция «Достижения» — `PushOnlyGroup` (общая разметка с «Маршрутами»), `AsyncContent` + скелетон,
  404 → блока нет, без push — нет ни блока, ни запроса; i18n-строка добавлена.
- **Documentation Sync.** ADR-0017, ADR-0020, `notifications.md`, `profile.md`, `.claude/rules/pokatim-{backend,db,
  contracts,app}.md` — соответствуют коду; части N2 помечены как будущие.

Запуски (evidence):

- `pnpm arch:check && pnpm typecheck` — зелёные (turbo cache).
- api unit: `notification-texts`, `notifications.policy`, `notification-intake`, `achievements.policy` — 138/138.
- contracts `src/notifications` — 52/52. app jest (`features/notifications`, `notifications.test.tsx`,
  `notification-settings-no-push.test.tsx`) — 160/160.
- **NOT VERIFIED:** int-тесты (`achievements*.int`, `notifications-intake.int`, `notifications.int`,
  `rider-season-standings.int`) — локальный mongod на 27017 standalone (api-kit: «нужен replica set»), docker-стенд не
  поднят; PR и CI для ветки ещё нет. Гарантии гонок оценены по коду и тексту тестов, не по прогону.

### [MEDIUM] Сезонное уведомление не перепроверяет, что достижение ещё заработано (согласен с codex pass 1)
- **file:** apps/api/src/modules/achievements/achievement-notices.ts
- **location:** `AchievementNoticesService.notice`, ветка `grant.grant === 'season'` (стр. ~30–40)
- **problem:** Для сезонной выдачи проверяются только `revokedAt === null` и наличие сезона среди завершённых
  (`seasonTitles` → `SEASON_RACES.finishedSeasons`). Пересчёт снимка сезона (`standings.sync`) выдачу не отзывает —
  отзывает только следующая сверка достижений. Событие, обработанное после пересчёта, который отнял место, даёт
  «Новое достижение: Чемпион сезона».
- **why_it_matters:** 5.B task.md: «… или код больше не заработан по фактам — `state`»; несезонная ветка это делает
  (`facts.evaluate`), сезонная — нет. В N1 (`origin: 'read'`) окно мало (событие обрабатывается сразу после GET), но в
  N2 (`server` → push) и при задержке intake это ложный push; переход на экран затем покажет отозванное.
- **evidence:** `if (title === undefined) return 'state'; return { … }` — без `outcomesOf`/`seasonalAchievements`;
  отклонение в 8.2 («сезонная — `state`, если сезона нет среди завершённых») это сужение не обосновывает.
- **recommended_fix:** В сезонной ветке взять `standings.outcomesOf(userId, [seasonId], now)` → `seasonalAchievements`
  и требовать ключ `code:seasonId` в `earned` и сезон в `settled` (иначе `state`); название — из исхода. Int-тест:
  событие → пересчёт с потерей места → intake без промежуточного GET → `skipped`. Допустимо закрыть в N2 (до
  включения `server`), если зафиксировать в task.md.

### [LOW] Передача `inApp` через пачки fan-out без теста
- **file:** apps/api/src/modules/notifications/notification-fanout.ts, notifications.events.ts, notifications-intake.processor.ts
- **location:** `renderDraft`/`planFanout` (`inApp`), `FanoutJobData.inApp`, обработка пачки (~стр. 156)
- **problem:** Флаг протянут через план пачек и данные задачи `notifications.fanout`, но ни один тест не проверяет, что
  пачка сохраняет `inApp` (`grep inApp *.test.ts` — только `notification-intake.test.ts` и `notifications.policy.test.ts`).
  Сейчас путь недостижим (у черновика достижения один получатель < `fanoutChunk`), но при будущем источнике с `inApp`
  регрессия (потеря флага → лишний push) пройдёт незамеченной.
- **why_it_matters:** `tests.md`: новое поведение — с тестом; изменён общий код notifications.
- **evidence:** `...(rendered.inApp ? { inApp: true } : {})` в `planFanout`; `inApp: z.boolean().optional()` в `FanoutJobData`.
- **recommended_fix:** Unit на `planFanout`/`renderDraft` с `inApp: true` (флаг в каждой пачке) — или не протягивать флаг
  в fan-out до появления многополучательного источника.

### [LOW] Тест «старая сборка» не проверяет цель (согласен с codex pass 1)
- **file:** packages/contracts/src/notifications/notification.schema.test.ts
- **location:** «группа achievements и вид achievement_granted в сборке без них — unknown»
- **problem:** Имитация старой сборки переопределяет только `group`/`kind`; `target` разбирается текущей схемой, где
  `achievement` уже известен; `parsed.target` не проверяется. Фактическая совместимость обеспечена структурным fallback
  `NotificationTargetView` (`{ type: string } → unknown`), но тест её для старой сборки не доказывает.
- **why_it_matters:** AC6 / 7.1 «есть тест контракта на новая группа/вид/цель → unknown у старого разбора».
- **evidence:** `NotificationView.extend({ group: …, kind: … })`, нет `expect(parsed.target)`.
- **recommended_fix:** В «старой» схеме подменить и `target` на union без варианта `achievement` + тот же fallback, и
  проверить `parsed.target` → `{ type: 'unknown' }`.

### [LOW] `pokatim-security.md` («Достижения») не упоминает запись outbox из GET
- **file:** .claude/rules/pokatim-security.md
- **location:** раздел «Достижения (achievements, ADR-0020 Proposed)», фраза «GET пишет ≤ 9 документов …»
- **problem:** GET теперь пишет и события `achievements.grant-noticed` (≤ числа новых выдач/уровней); бюджет записи и
  состав данных наружу (payload — id и коды) в правиле безопасности не отражены. Раздела нет в 10 task.md, но правило
  описывает именно бюджет записей GET.
- **why_it_matters:** Documentation Sync; правило читается при следующих правках зоны.
- **evidence:** diff не трогает `pokatim-security.md`; `AchievementsReconciler.notice` — `outbox.append` в GET.
- **recommended_fix:** Дописать: «+ по событию outbox на новую выдачу/уровень (payload — id и коды, без `userId`)».

Вердикт: **APPROVE** — CRITICAL/HIGH нет. MEDIUM (сезонная перепроверка) желательно закрыть до N2 (включение push).
