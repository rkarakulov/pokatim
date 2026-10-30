# Findings — route-story-card — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..c20aec4d (1 commit; working tree clean)
verdict: APPROVE

## Проверено (evidence)

- **Право на карточку.** `RouteCardController` — `@UseGuards(AuthGuard)` на классе, `routeId` — `ZodValidationPipe(Uuid)`,
  query — `StoryCardQuery`, `no-store`. `RouteCardService.status`: `consumeRead(userId)` → `RouteCardInputs.resolve` →
  `ogFacts` (`findInCatalog`: `status: 'ready'` + `IN_CATALOG`) → `null` → один `domainError('NOT_FOUND', 404)`. Лимиты
  render/read и NX-дедупликация — общий `CardRequests`. Int-тест покрывает 401/400/404 по всем статусам (личный — и
  владельцу; одно тело ответа на все 404).
- **Приватность.** `routeCardTexts` берёт только `RouteOgFacts` (без автора/`showAuthorName`, владельца, id);
  линия — `ogLine` → `catalogLine` (перепроверка `inCatalogByIds`, та же линия показа, что `GET /v1/routes/:id/map`).
  Хэш без `userId`; лог — `route <id> <template>`, причина провала — `'name-only'`.
- **Неизменность приглашения.** Вынос `statRow`/`cardTrackView` сверен независимо: старые `ride-invite.{render,png,texts}.ts`
  из `origin/develop` во временном worktree дали те же sha256 дерева для 4 вариантов (line/night × с линией/без), что
  зашиты в новом тесте (`4fdcef5f…`, `20cb2537…`, `4e7fd0f7…`, `81314300…`). `STORY_CARD_POLICY.renderVersion` и
  `OG_CARD_POLICY` не тронуты.
- **Процессор.** `buildRouteCard`: `resolve` → `null` или хэш ≠ — `null` (`skipped`); `ogLine` → `null` — `skipped`;
  сбой — общий `run` (ретрай, `failed` на последней попытке). Диспетчер — новая ветка `ROUTE_CARD_RENDER_JOB`.
- **Клиент (R7).** `useShareChoice`: карточка+ссылка → шит; только ссылка (гость) → `shareLink` синхронно в `press`;
  только карточка (нет origin) → сразу экран; ни одного → `available: false`. В шите «Ссылка» — `shareLink` вызывается
  синхронно в `onPress` (setState до вызова не await'ится). Шит рендерится только после нажатия (после монтирования).
  Райд: отдельная кнопка «Карточка-приглашение» удалена, `canShare = mounted && upcoming`, гостю без origin — кнопки нет.
  `RidePublishedSheet` на `ShareChoiceSheet` — тексты баннеров и пунктов те же значения словаря.
- **Экран.** `app/routes/story/[id].tsx` внутри `Stack.Protected` (`_layout.tsx`), `CardPanel` + `emptyOnNotFound`,
  кривой id — пустое состояние без запроса; `SEO_DISALLOW` + `/routes/story/`; манифест SSR и `app-routes` обновлены;
  web-smoke добавлен.
- **Тесты, прогнанные ревьюером:** api unit `route-card.render`, `ride-invite.render`, `story-card.processor`,
  `story-card.render`, `achievement-card.render` — 57/57; app jest `route-story`, `route-detail`, `ride-detail`,
  `ride-invite`, `features/sharing/*` — 104/104.
- **NOT VERIFIED:** `route-card.int.test.ts` (Docker не запущен — Mongo/Redis недоступны; код теста прочитан, покрытие
  AC1/AC2/AC4 соответствует матрице), `pnpm e2e:web`, `pnpm check` целиком, iOS/Android/dev-стенд.

## Findings

### [LOW] Осиротевшие ключи словаря после переезда на общий шит
- **file:** packages/i18n/src/ru.ts
- **location:** 342–343 (`rides.detail.copied`, `rides.detail.shareFailed`), 354–355 (`rides.published.link`,
  `rides.published.close`), 2053–2054 (`routes.detail.copied`, `routes.detail.shareFailed`)
- **problem:** после замены локальных баннеров/кнопок на `ShareChoiceSheet`/`useShareChoice` (`share.choice.*`) эти шесть
  ключей больше нигде не используются (grep по `apps/*/src`, `packages/*/src` — 0 вхождений вне `ru.ts`).
- **why_it_matters:** мёртвые строки словаря дублируют `share.choice.*` с теми же значениями; правка текста в одном
  месте не дойдёт до другого, ревьюер/переводчик правит не тот ключ.
- **evidence:** `grep -rln "rides.detail.copied" apps/app/src … packages/*/src | grep -v ru.ts` → пусто (аналогично для остальных пяти).
- **recommended_fix:** удалить шесть ключей из `ru.ts` (или оставить, если есть сторож совместимости словаря — тогда
  отметить в `pr.md`).

### [LOW] `RouteCardJob.routeId` — `z.string()`, а не `Uuid`, как записано в task.md §7
- **file:** apps/api/src/modules/sharing/story-card.cache.ts
- **location:** 43–48 (`RouteCardJob`)
- **problem:** §7 task.md: «zod `RouteCardJob`, `routeId: Uuid`»; в коде `routeId: z.string()`.
- **why_it_matters:** практического риска нет (данные задачи ставит только сервер после `Uuid`-pipe; `RideInviteJob`
  тоже `z.string()`), но расхождение spec ↔ код.
- **evidence:** `routeId: z.string(),` (story-card.cache.ts:45).
- **recommended_fix:** либо `routeId: Uuid` из `@pokatim/contracts`, либо поправить формулировку §7/§12.1 task.md.

### [LOW] Правила проекта расходятся с кодом — follow-up должен попасть в pr.md
- **file:** .claude/rules/pokatim-app.md; .claude/rules/pokatim-backend.md
- **location:** pokatim-app.md:326–327 («кнопка «Карточка-приглашение» на детали — вошедшему…»); pokatim-backend.md,
  раздел «Карточки для сторис» (нет абзаца про `RouteCardController`/`route-card.render`)
- **problem:** отдельной кнопки на детали райда больше нет, у `sharing` появился четвёртый вид карточки; правила по
  решению задачи не трогаются, follow-up обещан в `pr.md`, но `pr.md` в каталоге задачи пока нет.
- **why_it_matters:** следующий агент по правилу вернёт отдельную кнопку или пропустит карточку маршрута в
  инвариантах `sharing`.
- **evidence:** task.md §3.1 («`.claude/rules/*` не трогаем — follow-up в `pr.md`»), §10, §12; `ls docs/tasks/2026-10-30-route-story-card/` → только `task.md`.
- **recommended_fix:** на этапе finish-task создать `pr.md` с готовыми абзацами для трёх правил (как в
  `2026-10-28-ride-invite-card/pr.md`).

## Итог

CRITICAL: 0 · HIGH: 0 · MEDIUM: 0 · LOW: 3. Блокеров нет — APPROVE (при условии зелёного `route-card.int.test.ts` и
`pnpm check` в CI — ревьюер их не прогнал, NOT VERIFIED).
