# Findings — race-results-08c (приложение) — pass 2 — reviewer: claude
base: origin/develop   commits: 1800958, 48ce00d (+ merge 8a5c9f9)
verdict: APPROVE

Проверено: `git diff origin/develop...HEAD` целиком, фикс-коммит 48ce00d построчно; вызовы `getSeasonStandingsTable`
(единственный — `features/standings/queries.ts`), `TabFailure`/`loading` (`results-table.tsx`), `profile.tsx`,
`jest.config.js` (проект `web` для `*.web.test.*`), контракт `SeasonStandingsTableQuery` (`z.strictObject`),
`Cache-Control` контроллера (`public, max-age=60`), service worker (`scripts/service-worker.ts` — только same-origin
precache, на API не влияет).

Evidence (запущено в этом проходе):
- `jest src/__tests__/season-standings src/__tests__/profile-season-block src/__tests__/season.test
  src/features/standings` → `Test Suites: 7 passed`, `Tests: 59 passed` (оба проекта, native и web).
- `pnpm --filter @pokatim/api-client test` → `Test Files 16 passed`, `Tests 111 passed`.
- `tsc --noEmit` app и api-client — без ошибок; `prettier --check` изменённых файлов — ок.

Закрытие замечаний pass 1:
- HIGH (Codex, ошибка `/me`) — закрыт. `TabFailure query={me}` с `season.standings.meFailed` и повтором `me.refetch`;
  показывается при `isError` и при наличии данных (ошибка обновления — «Вы» и строки остаются). До ответа сводки
  баннера нет, «Нет соединения» — одно (через `AsyncContent`). Тесты: первая ошибка → повтор → «Вы»; ошибка
  pull-to-refresh при данных; вошедший без сети — одно «Нет соединения», без вечного скелетона.
- MEDIUM (Codex, счётчики) — закрыт. `counts = first ?? table`, N/M/участники берутся из первой страницы, сводка
  используется до ответа; `placeholderData` нет, поэтому при смене таблицы чужие счётчики не показываются.
  При RC-12 (M = 0) заметки нет, «0 участников». Тесты с разными счётчиками и RC-12 есть.
- MEDIUM (Claude, HTTP-кэш) — закрыт для web, для native ограничение записано в follow-ups.
  - `api-client`: третий необязательный аргумент `{ fresh }` → `cache: 'no-cache'`. URL и контракт те же, старые
    вызовы не меняются. `getPublic(…, init)` — внутренний помощник.
  - Флаг `fresh` (ref) поднят на всё время `refetch()`/`resetQueries()`. В TanStack v5 промис ждёт все страницы и
    ретраи, значит все они идут fresh. Если параллельно сработает «Показать ещё», запрос тоже пойдёт без кэша, это
    безвредно.
  - Тест `season-standings-cache` проверяет, что первый запрос обычный, а перезапрос RC-11 и сброс снимка идут
    с `{ fresh: true }`.
  - Разделение `http-cache.ts` / `http-cache.web.ts` корректно: Metro берёт `.web.ts` для web-бандла (клиент и SSR),
    jest-проект `web` проверяет `true`, `native` — `false`. Обоснование для native проверено. RN `fetch` — это
    `whatwg-fetch`: при `no-cache`/`no-store` для GET он дописывает `_=<время>`, а
    `SeasonStandingsTableQuery = z.strictObject(...)` ответит 400.
  - В браузере `no-cache` добавляет `Cache-Control: max-age=0` сам; это не CORS-заголовок автора, preflight не
    появляется. CDN перед API нет.
- LOW (Claude) — закрыты: `profile.season.line` удалён; отступ перенесён в `ProfileSeasonBlock` (все `null`-ветки без
  обёртки); тест обратного RC-11 есть (таблица новее → один перезапрос `/me`, таблица — 1 вызов).

Измерения без новых замечаний: correctness, регрессии/call sites, безопасность (`/me` — `withAccessToken`, только
вошедшему), placement (`features/standings`, платформенный файл вместо `Platform.OS`), contracts-first и старые клиенты
(изменение api-client аддитивное), серверный авторитет, i18n (новый ключ `meFailed`), дизайн-система, состояния данных,
платформы. Аудита, миграций и очередей BullMQ в 08c нет.

### [LOW] Правило `pokatim-app.md` не описывает обход HTTP-кэша и ограничение на native
- **file:** .claude/rules/pokatim-app.md
- **location:** раздел «Рейтинг сезона (race-results-08c)»
- **problem:** раздел описывает RC-11 и сброс «Курсор и снимок», но не говорит три вещи:
  - перезапрос идёт с `{ fresh: true }` только при `BYPASS_HTTP_CACHE` (`http-cache(.web).ts`);
  - на native `cache: 'no-cache'` нельзя: `whatwg-fetch` дописывает `_=`, а строгий query отвечает 400;
  - ошибка `/me` показывается отдельным баннером.
  Сейчас это записано только в task.md §12.3 и в JSDoc api-client.
- **why_it_matters:** это неочевидная ловушка, на которой споткнётся следующий агент. Он может добавить `cache:
  'no-cache'` в общий код или в другой публичный GET со `strictObject` и получить 400 только на iOS/Android. Jest
  это не поймает, потому что `api` в тестах замокан.
- **evidence:** `git diff origin/develop...HEAD -- .claude/rules/pokatim-app.md` — только коммит 1800958. В фикс-коммите
  48ce00d rules не менялись.
- **recommended_fix:** добавить в раздел одну-две строки: «перезапрос после расхождения снимков — `refetchFresh` /
  `{ fresh }` только при `BYPASS_HTTP_CACHE` (web); на native `cache: 'no-cache'` нельзя (`whatwg-fetch` → `_=` →
  400 строгого query); ошибка `/me` — свой `TabFailure`».

NOT VERIFIED: ручной прогон на iOS/Android/web и поведение `NSURLCache` на iOS. Сам этот проход их не делал, они
записаны в follow-ups §12.3.
