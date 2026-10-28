# Findings — race-results-08b — pass 1 — reviewer: claude
base: 064765e   commits: 064765e..f351664 (working tree clean)
verdict: REQUEST CHANGES (HIGH-1, HIGH-2)

Скоуп — только 08b (`apps/admin`, i18n панели, `.claude/rules/pokatim-web.md`). Приложение (08c) не ревьюилось.

## Проверено (evidence)

- Прогон: `pnpm --filter @pokatim/admin exec vitest run src/features/seasons src/router` — `Test Files 2 passed`,
  `Tests 23 passed`; `tsc --noEmit -p apps/admin` — без ошибок.
- Права: маршрут `seasons/$seasonId` (`router.tsx:195–206`) — `RequirePermission permission="races.read"`, как
  `seasonsRoute`; API сезонов и рейтинга панели — тоже `races.read`, лишних запросов с другим правом нет. Пункт
  навигации `/seasons` подсвечивается и на `/seasons/:id` (`activeOptions.exact` только для `/`).
- RC-8: `seasonRiderLabel` (`results-format.ts:50–53`) показывает id только при `userId !== null` от сервера;
  организатору — имя или «Участник» без id; тест с `ME.organizer` и регуляркой `·[0-9a-f]{6}$`.
- RC-19: вкладок нет, раздел `section` с `h2` «Рейтинг». RC-14: `StatusTag` `success`/`ink` по `summary.sync`.
- RC-12: пустая страница таблицы — `EmptyState` (тест). Переключатели — только таблицы сводки; одиночный выбор
  поверх `ChipGroup` — тот же приём, что `StandingsTable.tsx:286` (07). Смена класса — первая группа класса (тест).
- «Курсор и снимок» (§11.2): `loadMore` после `fetchNextPage` сравнивает `computedAt` страниц, при расхождении —
  `resetQueries` точного ключа таблицы + инвалидация сводки; тест проверяет третий вызов без курсора и отсутствие
  строки второй страницы. Ключ рейтинга под `['admin','seasons']` — `SeasonForm` инвалидирует и рейтинг; иных
  потребителей префикса (setQueryData/getQueriesData) нет.
- Дизайн-система: только `apps/admin/src/ui` и существующие классы (`table__more`, `page-note`, `muted`,
  `visually-hidden`, `section__title`); хардкода цветов/размеров нет. i18n — все строки через `t()`.

## Findings

### [HIGH-1] Ошибка обновления сводки молча скрывается
- **file:** apps/admin/src/features/seasons/SeasonScreen.tsx
- **location:** 82–96 (`if (data) { … }`)
- **problem:** при `summary.data` и `summary.isError` (фоновый refetch, `invalidateQueries` из `loadMore` при смене
  снимка, refetch по фокусу) показывается старая сводка без баннера и повтора.
- **why_it_matters:** AGENTS.md §4.12 «ошибка обновления при уже показанных данных — данные остаются, сверху баннер
  с повтором»; контракт ревью — нарушение §4.12 = HIGH. Сценарий: снимок сменился, `loadMore` инвалидирует сводку,
  запрос падает — на экране «Актуален» и старое «Пересчёт: …» без признака сбоя. Прецедент в той же панели —
  `RaceResultsScreen.tsx:128–140` (`data && summary.isError` → `Banner` с «Повторить»).
- **evidence:** ветка `if (data)` идёт раньше любой проверки `summary.isError`; тестов на ошибку обновления сводки нет.
- **recommended_fix:** над `SnapshotLine` — `Banner tone="warning"` (`state.staleTitle`/`state.staleMessage`,
  кнопка `state.retry` → `summary.refetch()`), как в `RaceResultsScreen`; тест: успешная сводка → refetch с 500 →
  данные на месте, баннер, повтор восстанавливает.

### [HIGH-2] Шапка сезона: нет скелетона на загрузке и состояния ошибки
- **file:** apps/admin/src/features/seasons/SeasonScreen.tsx
- **location:** 46–48, 59–66
- **problem:** пока грузится `seasonsQuery`, `h1` показывает «Сезоны» (заглушка-текст, не скелетон), а при ошибке
  `listSeasons()` — навсегда «Сезоны» без дат, без сообщения и повтора; статус `seasons` не читается вовсе.
- **why_it_matters:** §4.12 — первая загрузка блока — скелетон по раскладке, ошибка — с повтором (контракт: HIGH).
  `h1` «Сезоны» на экране сезона вводит в заблуждение (то же имя, что у списка) и мигает при каждом открытии
  с холодным кэшем. Прецедент — `RaceResultsScreen.tsx:93`: `title ?? (isError ? fallback : <span className="skeleton"> </span>)`.
- **evidence:** используется только `seasons.data?.find(...)`; тест «шапка» ждёт итогового названия, промежуточное
  состояние и отказ `listSeasons` не проверяются.
- **recommended_fix:** заголовок — `.skeleton` до ответа; при `seasons.isError` без данных — fallback-название плюс
  `Banner`/`ErrorState` с `seasons.refetch()` (ошибка шапки не должна прятать рейтинг); сезон не найден в списке при
  успешной сводке — fallback без дат. Тесты: загрузка шапки — скелетон; отказ `listSeasons` при успешной сводке —
  сообщение и повтор.

### [MEDIUM-1] Подпись таблицы берётся из сводки, а строки и колонки — из страницы таблицы
- **file:** apps/admin/src/features/seasons/SeasonStandingsTable.tsx
- **location:** 166–174 (`tableMeta` из `selected`), 106–110 (колонки из `loaded[0].races`)
- **problem:** «лучшие N из M гонок · участников: K» — из `PanelSeasonStandingsTableRef` сводки, а колонки гонок и
  строки — из ответа таблицы, у которого свои `racesTotal/racesCounted/riders/computedAt`. Сводка и таблица — разные
  запросы, рефетчатся независимо (фокус окна, инвалидация из `loadMore`); после пересчёта подпись может говорить
  «из 4 гонок» при трёх колонках, а для RC-12 — «участников: 2» над пустым состоянием.
- **why_it_matters:** таблица сама себе противоречит ровно в сценариях, ради которых введены RC-12 и «Курсор и снимок».
- **evidence:** контракт `PanelSeasonStandingsTable` несёт `racesTotal`, `racesCounted`, `riders` — в UI не используются.
- **recommended_fix:** числа подписи — из `loaded?.[0]` (пока таблица грузится — из `selected`); при расхождении
  `computedAt` таблицы и сводки — инвалидировать сводку (по аналогии с RC-11).

### [LOW-1] RC-12: текст пустого состояния неверен для существующей в сводке таблицы
- **file:** apps/admin/src/features/seasons/SeasonStandingsTable.tsx
- **location:** 143–145
- **problem:** пустая страница таблицы, которая есть в сводке, показывает «Таблиц сезона пока нет · Таблицы появятся
  после публикации первого протокола…» — при видимых переключателях и подписи этой таблицы.
- **recommended_fix:** отдельный ключ («В таблице пока нет участников») и, по желанию, инвалидация сводки.

### [LOW-2] Смешанные снимки на мгновение показываются, а при рефетче всех страниц не ловятся
- **file:** apps/admin/src/features/seasons/SeasonStandingsTable.tsx
- **location:** 125–135
- **problem:** проверка идёт после `await fetchNextPage()` — строки второго снимка рендерятся один кадр до
  `resetQueries`; рефетч загруженных страниц (фокус окна, инвалидация `SeasonForm`) снимки не сверяет вовсе.
- **recommended_fix:** сверять в `select` / эффекте по `pages.data` (любое расхождение `computedAt` страниц → скрыть
  хвост и `resetQueries`), а не только в обработчике кнопки.

### [LOW-3] Род и падеж в `admin.standings.tableMeta`
- **file:** packages/i18n/src/ru.ts
- **location:** 887–888
- **problem:** при M = 1 — «лучшие 1 из 1 гонок» (сезон с одной гонкой — частый случай в начале сезона; в тестовых
  данных таблица `gravel/overall` ровно такая). В i18n есть плюральные формы (`rides.going.limited`).
- **recommended_fix:** плюральный ключ по `total` («из 1 гонки» / «из 3 гонок») или формулировка без согласования
  («в зачёте: 1 из 1»).

### [LOW-4] Нет теста 403 экрана сезона
- **file:** apps/admin/src/features/seasons/SeasonScreen.test.tsx
- **problem:** ветка `isForbidden → NoAccessScreen` (`SeasonScreen.tsx:50`) не покрыта; ролями она сейчас
  недостижима (RC-9), но код есть — должен быть и тест (или ветку убрать).

CRITICAL — нет. HIGH — HIGH-1, HIGH-2 (оба — §4.12, совпадают с находками Codex 08b).
