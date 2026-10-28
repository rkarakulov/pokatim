# Findings — ride-invite-card — pass 1 — reviewer: claude
base: origin/develop   commits: aa857ba..0ddd4d0 (0ddd4d0)
verdict: APPROVE

Проверено (без замечаний): приватность линии (`inviteFacts` → `RideRoutes.visible(…, null)` отдаёт только `public`;
worker перечитывает факты, сверяет хэш, затем `catalogLine` повторно проверяет `IN_CATALOG`; `private` и висячий
`routeId` → `null`, линия не запрашивается); содержимое картинки (только title/startsAt/place/distance/pace, без
организатора, участников, описания); скрытый райд — 404 всем до фазы, в worker 404 → `skipped` без ретрая; хэш
(префикс `ride-invite`, renderVersion, шаблон, тема, все поля на картинке, публичный routeId; геометрия готового
маршрута неизменна — pokatim-db.md, поэтому routeId достаточно); jobId/имя задачи, zod job data, NX-дедупликация,
лимиты общие; логи — только rideId/шаблон/итог/байты/мс; регрессии story-cards API (`CardRequests` — перенос
1:1, jobId `story-card-<hash>` сохранён, `build()` сохранил сигнатуру и логи; `storyCardTrack` — оба вызова
обновлены; renderVersion не нужен — разметка сторис не менялась); границы модулей (`sharing → rides` через
`index.ts`, `rides` о `sharing` не знает); app — экран внутри `Stack.Protected`, web/native через
`share-story(.web)`, скелетон, ошибка с повтором, i18n; Documentation Sync §10 — ADR-0018, backend, security,
app-правило, product/rides.md обновлены. Тесты не запускались (по просьбе автора).

### [MEDIUM] Экран сторис гонки сменил поведение на 404
- **file:** apps/app/src/features/sharing/card-panel.tsx, apps/app/src/features/sharing/card-status.ts
- **location:** `CardPanel` — `card.unavailable || card.notFound ? empty : …`; `useCardStatus` — `notFound: code === 'NOT_FOUND'`
- **problem:** общий `CardPanel` показывает `empty` и на `404 NOT_FOUND`. Раньше экран гонки (`useStoryCard`)
  считал пустым только `409 STORY_CARD_UNAVAILABLE`, а 404 (гонка неизвестна/скрыта) шёл в `AsyncContent` как
  ошибка с повтором. Теперь на экране гонки 404 — «Карточки пока нет / К гонке».
- **why_it_matters:** R7 task.md: общая часть «переиспользуется экраном гонки без смены поведения». Изменение
  не задокументировано и не покрыто тестом `story-card.test.tsx`.
- **evidence:** удалённый `queries.ts`: `unavailable: apiErrorCode(query.error) === 'STORY_CARD_UNAVAILABLE'` (без 404);
  новый `card-panel.tsx`: `{card.unavailable || card.notFound ? (empty) : …}`.
- **recommended_fix:** либо сделать обработку 404 опцией `CardPanel` (например, `emptyOn: ['STORY_CARD_UNAVAILABLE',
  'NOT_FOUND']` только у приглашения), либо явно принять новое поведение для гонки — запись в task.md/pokatim-app.md
  и тест 404 в `story-card.test.tsx`.

### [MEDIUM] Диспетчер `StoryCardProcessor.process` не покрыт тестом
- **file:** apps/api/src/modules/sharing/story-card.processor.ts
- **location:** `process()` — выбор схемы по `job.name` и ветвление `'raceId' in data.data`
- **problem:** новая маршрутизация двух видов задач в единственной production-точке входа worker не исполняется ни
  одним тестом: int-тесты вызывают `build()`/`buildRideInvite()` напрямую (`ride-invite.int.test.ts` `runJob`),
  `.process(` в тестах sharing не встречается.
- **why_it_matters:** ошибка в выборе схемы/ветки (например, перепутанные схемы или strip ключей zod) сломает
  обе карточки в проде при зелёном CI: `pending` до таймаута 30 с у клиента.
- **evidence:** `grep -rn "\.process(" apps/api/src/modules/sharing/*.test.ts` — пусто; `takeJob()` + `processor().buildRideInvite(...)`.
- **recommended_fix:** в int-тесте прогнать снятую из очереди задачу через `processor().process(job)` для обоих
  имён (`story-card.render`, `ride-invite.render`) и неизвестное имя → throw; невалидные data → `skipped`.

### [LOW] task.md §8.3 противоречит R2/AC1 по скрытому райду организатора
- **file:** docs/tasks/2026-10-28-ride-invite-card/task.md
- **location:** §8.3 AuthN/AuthZ
- **problem:** «скрытый — 404 всем, и организатору — 409 после видимости» против R2/AC1 «скрытый (и организатору) — 404».
  Код, тест и ADR — 404 всем.
- **why_it_matters:** спека расходится с реализацией и ADR; следующий читатель может «починить» код под §8.3.
- **evidence:** `rides-for-sharing.ts`: `if (!doc || doc.status === 'hidden') throw domainError('NOT_FOUND', 404)`; тест «скрытый — 404 всем, и организатору».
- **recommended_fix:** поправить формулировку §8.3 на «скрытый — 404 всем, включая организатора».

### [LOW] AC5 — текст пустого состояния расходится с реализацией
- **file:** docs/tasks/2026-10-28-ride-invite-card/task.md / packages/i18n/src/ru.ts
- **location:** AC5; `rideInvite.empty.title`
- **problem:** AC5: «409 — „Карточки пока нет“ и „К райду“»; реализовано «Приглашение недоступно» (так же в pokatim-app.md).
- **why_it_matters:** формальное несоответствие acceptance.
- **evidence:** `'rideInvite.empty.title': 'Приглашение недоступно'`; тест ожидает «Приглашение недоступно».
- **recommended_fix:** обновить AC5 под принятый текст (или текст под AC5).

### [LOW] Отметка `failed` общая для всех зрителей приглашения
- **file:** apps/api/src/modules/sharing/card-requests.ts
- **location:** `status()` — `takeFailed(hash)` (GETDEL)
- **problem:** у сторис хэш личный, у приглашения — общий на райд/шаблон/тему. Отметку провала «съедает» первый
  опросивший зритель; тот, чья задача упала, увидит `pending`, переставит задачу и потратит свой `story-card-render`.
- **why_it_matters:** только UX/лимит в редком случае провала рендера; утечки нет.
- **evidence:** `if (await this.cache.takeFailed(hash)) return { status: 'failed' };` при `rideInviteHash` без зрителя.
- **recommended_fix:** принять и упомянуть в ADR-0018 (достаточно), либо хранить `failed` с TTL без GETDEL.

### [LOW] `isNotFound` через `instanceof` вместо `isDomainError`
- **file:** apps/api/src/modules/sharing/story-card.processor.ts
- **location:** `const isNotFound = (error) => error instanceof DomainError && error.status === 404`
- **problem:** api-kit экспортирует бренд-проверку `isDomainError` (символ `DOMAIN_ERROR`), устойчивую к дублю пакета; `instanceof` — нет.
- **why_it_matters:** при двух копиях api-kit скрытый райд в worker уйдёт в ретраи и `failed` вместо `skipped`.
- **evidence:** `node_modules/@rkarakulov/api-kit/dist/errors/domain-error.d.ts`: `export declare const isDomainError`.
- **recommended_fix:** `isDomainError(error) && error.status === 404`.
