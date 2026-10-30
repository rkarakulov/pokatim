# Findings — og-rider-season-dark — pass 1 — reviewer: claude
base: origin/develop   commits: f65b5260 (origin/develop..HEAD, рабочее дерево чистое)
verdict: APPROVE

## Проверено (evidence)

- Unit: `packages/contracts` `src/sharing` — 16/16; `apps/api` sharing unit (`og-card.{inputs,texts,png,render}.test`,
  `sharing.policy.test`, `story-card.processor.test`, `og-sync.processor.test`) — 51/51; `apps/app` jest
  `og-image.test` + `public-metadata.test` — 48/48.
- `pnpm arch:check` (depcruise) — 0 нарушений (нет цикла `sharing ↔ riders`, `sharing.policy ↔ og-card.inputs`).
- `tsc --noEmit` в `apps/api` и `apps/app` — без ошибок.
- **NOT VERIFIED:** int-тесты (`riders-for-sharing.int`, `races-for-sharing.int`, `og-sync.int`, `og-card.int`) —
  локальный mongod standalone, harness требует replica set. Код тестов прочитан: покрывают AC1/AC2 (404 JSON после
  отзыва согласия на `cards` и `images`, 400 на Uuid у райдера и publicId у сезона), RC-2a (сезон без курсора,
  новая гонка → новая версия следующим прогоном), райдер вне `og.sync`, лог без `publicId`.

## Измерения

- **Приватность райдера:** `RiderOgFacts` = `publicId, races, podiums, bestPlace` (структурно без имени/клуба/фото/
  `userId`); заголовок — `riders.title`, alt — `ogCard.alt.rider` без параметров; хэш — вид, версия, тема, схема,
  `publicId`, статистика. Публичность — только `RIDER_PROFILES.findPublic` (та же проверка, что `publicProfile`);
  `OgCardService.image` → `resolve` → `404` до чтения PNG. Логи: `OgCardService.enqueue` и
  `StoryCardProcessor.buildOgCard` пишут `ogLogId` (8 hex хэша); `job ${job.id}` = `og-card-<hash>`; `og.sync`
  райдеров не трогает. В мете `publicId` — только в URL `og:image` (RC-1a), `noindex`, без `og:url`. Остаточные
  носители `publicId` — Redis `og:obj:rider:<id>` и данные задачи BullMQ (`removeOnComplete/Fail: true`) — приняты
  архитектором (§5 Data).
- **Хэш/версия:** `scheme` входит в `ogCardHash`; `renderVersion` 2 → 3; `canonicalFacts` season/rider — только
  факты вида; комментарий policy «изменил `scheme` — подними `renderVersion`» есть.
- **og.sync сезонов:** `OG_CURSOR_KINDS` (4 вида) — курсоры и `resetCursors`; сезоны — `liveSeasonIds(minskToday(now −
  30 д))` каждый прогон, лимит `syncRenderLimit`, сбой чтения → `failedKinds: ['season']`; `ogPrerenderable` season
  совпадает с выборкой `endsOn ≥ since` (строки `YYYY-MM-DD`).
- **Валидация id по виду:** `OG_CARD_ID` + `superRefine` в `OgCardParams`/`OgImageParams`; незнакомый вид — enum
  обрывает разбор до refinement (тест `{kind:'team'}` → `success:false` без исключения); SSR — `publicPath(..., OG_CARD_ID[kind])`.
  Фильтры Mongo получают только примитивы после zod.
- **Зависимости:** `RidersCoreModule` (ProfileCore + ResultsCore) → импортирует `sharing` (HTTP и worker); сводка —
  тот же `summarize`, `races = finishes` (RC-3a), `bestPlace = bestPlaces[0]?.place` как в `publicProfile`.
- Контракты/совместимость: виды в конец, `OgCardParams` тип прежний; старые клиенты новых видов не запрашивают.
- Миграций, outbox, append-only аудита — не затронуто. Идемпотентность — прежние NX + `jobId og-card-<hash>`.
- i18n — все строки в `ru.ts`, plural `one/few/many/other`. Дизайн-система — цвета только `storyCardColors(theme.schemes[scheme])`.
- Все платформы / состояния данных — изменения только SSR-мета web и API; экраны не менялись (S6 — no-op).

## Findings

### [MEDIUM] Правила проекта противоречат коду; follow-up не зафиксирован артефактом
- **file:** .claude/rules/pokatim-backend.md
- **location:** строка 146 (§Профиль райдера); также §Карточки/OG и `.claude/rules/pokatim-security.md` §Карточки
- **problem:** правило по-прежнему гласит «`riders` не импортирует никто, кроме `AppModule`», а `SharingModule` и
  `SharingWorkerModule` теперь импортируют `RidersCoreModule`; в правилах нет видов `season`/`rider`, `scheme`,
  «курсоры только 4 видов», «логи OG райдера без `publicId`». task.md §3.1 переносит правки в «follow-up в `pr.md`»,
  но `pr.md` в каталоге задачи нет (только `task.md`, `findings-codex.md`).
- **why_it_matters:** правила `.claude/rules/*` — то, что читают агенты при следующих правках `riders`/`sharing`;
  устаревшее «никто не импортирует» подтолкнёт к удалению ребра или к дублю `summarize`; без зафиксированного
  follow-up правка теряется (Documentation Sync, §10 task.md).
- **evidence:** `pokatim-backend.md:146` «`riders` не импортирует никто, кроме `AppModule`»;
  `apps/api/src/modules/sharing/sharing.module.ts` — `RidersCoreModule` в обоих `imports`.
- **recommended_fix:** до merge создать `pr.md` (или issue) с точным текстом правок §10 для `pokatim-backend.md` и
  `pokatim-security.md` и запросить OK пользователя; либо внести правки с его OK в этом PR.

### [LOW] AC4 в task.md остался в старой формулировке («курсор `og:cursor:season`»)
- **file:** docs/tasks/2026-10-30-og-rider-season-dark/task.md
- **location:** §8 Acceptance Criteria, AC4
- **problem:** AC4 требует курсор `og:cursor:season`, а принятое RC-2a и код — без курсора (тест прямо проверяет
  `exists('og:cursor:season') === 0`). Отклонение отмечено только в §12 Outcome.
- **why_it_matters:** проверяющий по AC увидит формальное несоответствие; источник правды раздвоен.
- **evidence:** AC4: «`og.sync` пререндерит сезоны (курсор `og:cursor:season`)»; `og-sync.int.test.ts` — `expect(await h.redis.exists('og:cursor:season')).toBe(0)`.
- **recommended_fix:** переписать AC4 по правке RC-2: «пререндерит живые сезоны полным просмотром без курсора, райдеров — нет».

### [LOW] Шаг сезонов в `og.sync` голодает, пока курсорные виды выбирают `syncRenderLimit`
- **file:** apps/api/src/modules/sharing/og-sync.ts
- **location:** строки 72–110 (цикл `OG_CURSOR_KINDS`, затем `if (enqueued < OG_CARD_POLICY.syncRenderLimit)`)
- **problem:** сезоны идут после всех курсорных видов; при полном проходе (ровно после бампа `renderVersion` 2 → 3
  этим PR) гонки/райды/маршруты/старты могут несколько прогонов подряд выбирать лимит 60, и живые сезоны не ставятся.
- **why_it_matters:** первые краулеры ссылок на сезон в этот период получат бренд-картинку; самолечение по запросу
  это закрывает, поэтому не блокер.
- **evidence:** `for (const kind of OG_CURSOR_KINDS) { if (enqueued >= OG_CARD_POLICY.syncRenderLimit) break; … }` →
  `if (enqueued < OG_CARD_POLICY.syncRenderLimit) { … liveSeasonIds … }`.
- **recommended_fix:** по желанию — ставить шаг сезонов первым (их единицы, дёшево) или резервировать им долю лимита.

## Итог

CRITICAL: 0 · HIGH: 0 · MEDIUM: 1 · LOW: 2. Вердикт — **APPROVE**.
