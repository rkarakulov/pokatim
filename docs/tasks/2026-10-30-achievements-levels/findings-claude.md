# Findings — achievements-levels — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..c7f373ce (49578b3a + merge develop), working tree clean
verdict: APPROVE

## Проверено (evidence)

- `pnpm typecheck` (9/9), `pnpm format:check`, `pnpm lint`, `pnpm arch:check` — зелёные (локально, 2026-10-31).
- Unit: api `achievements.policy.test.ts`, `achievement-card.render.test.ts`, `story-card.inputs.test.ts` — 60/60;
  contracts `src/achievements` — 8/8; api-client — 164/164; app jest (`features/achievements`, `progress-bar`,
  `__tests__/achievement*`, `own-profile`, `achievements-blocks`) — 97/97.
- **NOT VERIFIED:** int-тесты `achievements.int.test.ts` и `achievement-card.int.test.ts` — локально нет Mongo/Redis
  (harness падает на `beforeAll`). Код тестов прочитан: AC2 целиком, документ v1, прогресс и точные ключи,
  публичный ответ, `POST seen` повтор, параллельные GET ×5, негатив монотонности `seenLevel`, AC6 (новый хэш →
  `pending`, другой токен) — сценарии соответствуют 7.8. Зелёный прогон нужен в CI.

Измерения: correctness (политика, план, pipeline `markSeen`, `seen` по уровню ответа — RC-L10) — ок; call sites
(`facts.earned` → `evaluate`, `ACHIEVEMENT_BADGE_ICONS.count` удалён, все `AchievementBadge` получают `level`) — ок,
typecheck держит; безопасность (явные списки полей, `progress` только свой, `POST seen` без уровня от клиента, логи без
кодов/уровней) — ок; placement (пороги одной таблицей в contracts, `sharing` не читает коллекции, `ProgressBar` в
`apps/app/src/components` из токенов с тестом — допустимо по AGENTS §4.11) — ок; contracts-first/совместимость
(`level` `.nullable().default(null)`, `progress` `.default([])`, `z.object` у старых сборок, запрос `seen` не менялся)
— ок; серверный авторитет — ок; append-only/миграции/BullMQ — не задействованы (миграции нет, индексы прежние;
`renderVersion` 2→3 и уровень в хэше) — ок; i18n (ru, склонения для 5/10/15/25/30/50) — ок; состояния данных (блок
прогресса скрыт без данных, при ошибке обновления данные остаются, баннер один) — ок; платформы (только RN-примитивы,
a11y-скрытие маппится на web) — ок; Documentation Sync — см. LOW-2, LOW-3.

### [LOW] Устаревший план, записанный до `POST seen`, может дать повторную вспышку того же уровня после перезапуска
- **file:** apps/api/src/modules/achievements/achievements.repository.ts
- **location:** `markSeen` (pipeline `seenLevel: $max(seenLevel, level)`), в связке с `AchievementsService.sync` (`isSeen(…, item.level)`)
- **problem:** `seen` в ответе считается по уровню фактов запроса (RC-L10), а `POST seen` ставит `seenLevel` из уровня
  документа. Если параллельная устаревшая сверка записала меньший `level` (серебро) после свежей (золото) и **до**
  `POST seen`, клиент покажет золото, а `seenLevel` станет 2; следующая сверка вернёт золото с `seen: false`.
- **why_it_matters:** повторная вспышка «Новый уровень» того же уровня (в том же запуске её глушит `flashKey`, после
  перезапуска — нет). Окно требует публикации факта между двумя параллельными GET одного пользователя — крайне редко;
  негативный тест 7.8 покрывает только порядок «устаревший план после `seen`».
- **evidence:** `isSeen(granted.get(item.code)!, item.level)` (service) vs `{ $max: [{ $ifNull: ['$seenLevel', 1] }, { $ifNull: ['$level', 1] }] }` (repository).
- **recommended_fix:** принять и упомянуть в ADR-0020 «Уровни» рядом с окном «повышение между GET и POST seen» (менять
  схему запроса ради этого не стоит — RC-L5).

### [LOW] `profile.md` A1 по-прежнему называет коды старыми названиями
- **file:** docs/product/profile.md
- **location:** стр. ~127–132 (A1: «Пять гонок», «Пять маршрутов», «Десять кофе-райдов»)
- **problem:** новые названия («Гонщик», «Путешественник», «Завсегдатай») есть только в разделе L1; A1 описывает каталог
  старыми именами без пометки.
- **why_it_matters:** продуктовый источник противоречит UI/i18n; читатель A1 не узнает о переименовании.
- **evidence:** `git grep "Пять гонок" docs/product` → profile.md:127, 129, 132.
- **recommended_fix:** в A1 заменить названия на новые (или дописать «— с L1: «Гонщик» …, уровни»).

### [LOW] Follow-up issue `ProgressBar` в `@rkarakulov/ui` не найден
- **file:** docs/tasks/2026-10-30-achievements-levels/task.md
- **location:** §10 «Follow-up issue», §12 Outcome
- **problem:** раздел 10 требует follow-up issue в app-foundation; `gh search issues "ProgressBar" --owner rkarakulov`
  пусто.
- **why_it_matters:** Documentation Sync §10; без issue компонент останется локальной копией вне базы.
- **recommended_fix:** завести issue в app-foundation на этапе finish-task и сослаться на него в task.md/PR.
