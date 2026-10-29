# Findings — achievement-story-card — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..7a89f254 (1 commit; working tree clean)
verdict: APPROVE

Проверено по измерениям контракта: correctness (сверка «получено» = факт сейчас ∩ выдача `revokedAt === null`, та же
семантика, что фильтр списка в `AchievementsService.sync`); рефакторинг `AchievementsService` — `earned`/`titled`
перенесены дословно, вызовы `sync`/`publicList` эквивалентны, лишние импорты `RidesCoreModule`/`RouteRidesCoreModule`
из `AchievementsModule` сняты корректно (сервис их больше не инжектит); границы — `sharing → achievements` только через
`index.ts`, `achievements` о `sharing` не знает, `AchievementsReadModule` импортирует только core-модули (в worker
`RouteRidesCoreModule` уже собирается `RouteRidesWorkerModule`); безопасность — `AuthGuard`, userId только из access,
код — `z.enum` (без `.catch`, 400 на незнакомый), query `strictObject`, job — zod, лимит чтения до входов, ответ —
только `StoryCardStatus`; приватность — маршрут на картинке только через `ROUTES_FOR_SHARING.ogFacts` (каталог),
приватное название из фактов в тексты и в хэш не попадает, id объектов на картинке нет, имя — `RIDER_NAMES`; райды —
`status: 'published'` (как публичная деталь); идемпотентность — NX + `jobId achievement-card-<hash>`, worker
перечитывает входы и сверяет хэш; лог worker — `achievement <code> <template>`, причина — `name-only`; глифы —
кодовые точки сверены с `expo-symbols/build/android/symbols.json` (sports_score f06e, map e55b, local_cafe e541,
military_tech ea3f, emoji_events ea23, person e7fd) и с `components/icon.tsx`; зависимость шрифта — в
`dependencies`; приложение — экран в `Stack.Protected`, `CardPanel` (скелетон, ошибка с повтором, 409 → пусто),
незнакомый код без запроса, вспышка не открывается поверх `/achievements/story/*` (префикс `/achievements` в
`achievement-flash-host.tsx`), web-smoke и SSR-манифест; i18n — все строки в `ru.ts`; Documentation Sync — ADR-0018,
`profile.md` A6, `pokatim-backend.md`/`pokatim-security.md`/`pokatim-app.md` (в §10 task.md названы `onbike-*.md` —
фактические файлы `pokatim-*.md`, обновлены они). Миграций, коллекций, аудита нет — не применимо.

NOT VERIFIED: `pnpm check` / тесты не запускались (по поручению — запускаются отдельно); визуальная вёрстка PNG.

### [LOW] Путь worker'а карточки может писать `uid` в лог через переиспользуемые чтения фактов
- **file:** apps/api/src/modules/achievements/achievement-facts.reader.ts
- **location:** `AchievementFactsReader.titled` (`this.logger.warn(\`achievements.race_missing uid=${userId}\`)`); также `apps/api/src/modules/rides/rider-rides.ts` `pastOf` (`achievements.rides_truncated uid=...`)
- **problem:** `AchievementsSharing.cardFacts` вызывается и из `StoryCardProcessor.buildAchievementCard` (worker), и из HTTP статуса карточки; оба переиспользованных чтения при редких условиях (гонка пропала из `racesOf`, усечение райдов) логируют `uid`.
- **why_it_matters:** task.md §7 и §8.3 и новая строка `pokatim-security.md` («Логи — код, шаблон, итог») обещают логи карточки без `userId`; AC4 заявляет «логи без userId». Тест «логи рендера — без userId» эти ветки не покрывает. Само по себе `uid` в логах достижений проектом допускается, поэтому severity низкая.
- **evidence:** task.md §7: «Лог worker — код, шаблон, итог, байты, мс (без `userId` …)»; `achievement-facts.reader.ts:56`.
- **recommended_fix:** либо дать `titled` флаг/вариант без лога для порта карточки (лог `race_missing` оставить только в `sync`), либо явно зафиксировать в task.md/`pokatim-security.md`, что служебные предупреждения источников фактов с `uid` допустимы и в пути карточки.

### [LOW] Каждый опрос статуса и каждый рендер пересчитывает все три источника фактов
- **file:** apps/api/src/modules/achievements/achievements-for-sharing.ts
- **location:** `cardFacts` — `this.facts.earned(userId)` + `this.repository.listOf(userId)`
- **problem:** для одного кода читаются `publishedRows`, `passedOf` (с `ActivitySource.liveActivities` и `rideableTitles`) и `pastOf` целиком, плюс все выдачи; это повторяется на каждом поллинге `pending` (лимит 120/мин) и в worker.
- **why_it_matters:** лишняя нагрузка на Mongo/источники активностей при поллинге; на корректность не влияет.
- **evidence:** `achievements-for-sharing.ts:17-20`; `CardRequests.consumeRead` 120/мин.
- **recommended_fix:** по желанию — читать только источник семейства кода (`race_*` → результаты, `route*` → `passedOf`, `ride*` → `pastOf`) и одну выдачу по `{ userId, code }`; либо оставить, отметив в Outcome как принятое.

### [LOW] Тест глифов доказывает «что-то нарисовано», а не «нарисована та же иконка, что в приложении»
- **file:** apps/api/src/modules/sharing/achievement-card.render.test.ts
- **location:** `иконки значка` → `у каждого кода каталога есть глиф в шрифте Material Symbols`
- **problem:** проверяется только наличие `<path d="M…">` в SVG для каждой кодовой точки; соответствие кода иконке приложения (`ACHIEVEMENT_CATALOG.icon` → `icon.tsx material`) держится на комментарии-«зеркале». Ошибочная, но существующая кодовая точка тест пройдёт.
- **why_it_matters:** расхождение значка на карточке и в приложении не будет поймано CI (сейчас точки верны — сверено вручную).
- **evidence:** тест строк 164-175; `achievement-card.icons.ts` комментарий «Зеркало иконок `ACHIEVEMENT_CATALOG`».
- **recommended_fix:** по желанию — хранить в `achievement-card.icons.ts` имя Material (`'sports_score'` …) и в тесте сверять кодовую точку с `expo-symbols/build/android/symbols.json` (или наоборот — резолвить точку по имени), чтобы опечатка в hex ловилась.

## Вердикт
APPROVE — CRITICAL/HIGH нет.
