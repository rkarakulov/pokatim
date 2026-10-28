# Findings — race-results-08b — pass 2 — reviewer: claude
base: 064765e   commits: 064765e..d7e7860 (f351664, d7e7860; working tree clean)
verdict: APPROVE

Скоуп — 08b (`apps/admin/src/features/seasons/*`, `results-format.ts`, `router.tsx`, i18n панели,
`.claude/rules/pokatim-web.md`). Проверка закрытия findings pass 1 (Claude, Codex) и новых регрессий фикса d7e7860.

## Проверено (evidence)

- Прогон: `pnpm --filter @pokatim/admin exec vitest run src/features/seasons` — `Test Files 2 passed`,
  `Tests 28 passed (28)`; `tsc --noEmit` в `@pokatim/admin` — без ошибок.
- HIGH-1 (Claude) / HIGH (Codex), ошибка обновления сводки — закрыт. `SeasonScreen.tsx:111–125`: при `data` и
  `summary.isError` — `Banner tone="error" role="alert"` «Не удалось обновить рейтинг» + `admin.refreshFailedMessage`,
  «Повторить» → `summary.refetch()`; прежняя сводка остаётся. Один в один с прецедентом `RaceResultsScreen.tsx:129–140`.
  Тест «ошибка обновления сводки…» честный: реальный путь через смену `computedAt` в `loadMore` → инвалидация → 500 →
  «Актуален» на месте, баннер → повтор → «Ждёт пересчёта», баннер ушёл.
- HIGH-2 (Claude) / HIGH (Codex), шапка — закрыт. `SeasonScreen.tsx:60–68`: `.skeleton` в `h1`, пока нет данных и
  ошибки (и не `paused`); `81–91`: `seasons.isError` — `Banner tone="warning"` с повтором `seasons.refetch()`, рейтинг
  рендерится и на 404 сводки (`98`). Тесты: скелетон заголовка при висящем `listSeasons` (рейтинг уже виден); отказ
  `listSeasons` → баннер → повтор → `h1` «Сезон 2026», баннер исчез.
- MEDIUM-1 — закрыт: `SeasonStandingsTable.tsx:102` `counts = loaded?.[0] ?? selected`; тест подписи из ответа
  таблицы (1 гонка / 5 участников при другой сводке).
- LOW-1 — закрыт (`admin.standings.tableEmpty`, тест RC-12 проверяет и отсутствие «Таблиц сезона пока нет»).
- LOW-3 — закрыт: плюрали `admin.standings.{races,riders}` с формами one/few/many/other; тесты «1 гонка»,
  «3 гонки», «0 гонок», «2 участника», «5 участников», «0 участников».
- LOW-4 — закрыт: тест 403 → «Нет доступа к разделу».
- LOW-2 — принят оркестратором осознанно, не переоткрывается.
- Регрессии: компоненты только из `apps/admin/src/ui` (`Banner` поддерживает `tone`/`role`), новые строки — через
  `t()`, ключи добавлены в `ru.ts`; права маршрута (`races.read`) и ключи запросов не менялись; серверный авторитет
  мест/очков не затронут. Documentation Sync: §12.2 «Фиксы ревью 08b pass 1» и `.claude/rules/pokatim-web.md`
  соответствуют diff.

## Findings

### [LOW-1] Баннер шапки при ошибке фонового обновления сезонов противоречит видимому названию
- **file:** apps/admin/src/features/seasons/SeasonScreen.tsx
- **location:** 81–91
- **problem:** `seasonsBanner` показывается при любом `seasons.isError`, в том числе когда `seasons.data` уже есть
  (упал refetch по фокусу или после `SeasonForm`) — над корректными названием и датами висит «Не удалось загрузить
  название и даты сезона».
- **why_it_matters:** формулировка вводит в заблуждение; по §4.12 для ошибки обновления при показанных данных уместнее
  текст «не удалось обновить» (как `admin.refreshFailedMessage`). Функционально данные и повтор есть — не HIGH.
- **evidence:** условие `seasons.isError ? <Banner …/> : null` не смотрит на `seasons.data`.
- **recommended_fix:** при `seasons.data` — либо не показывать баннер шапки (данные уже есть), либо дать текст
  обновления; при желании — тест «refetch сезонов падает → название на месте».

CRITICAL — нет. HIGH — нет. Все CRITICAL/HIGH pass 1 закрыты, новых не появилось.
