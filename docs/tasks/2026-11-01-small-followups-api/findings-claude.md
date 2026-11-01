# Findings — small-followups-api — pass 1 — reviewer: claude
base: origin/develop   commits: 3cbebb8b (origin/develop...HEAD), working tree clean
verdict: REQUEST CHANGES (HIGH-1)

Тесты не запускались (по просьбе: параллельно идёт полный `pnpm check` на той же БД) — выводы по коду и исходникам
`@vitest/spy` 5.0.5.

### [HIGH] HIGH-1 — шпион `admitEntry` с постоянной реализацией не снимается и «протекает» в следующие тесты файла
- **file:** apps/api/src/modules/results/results-entries.int.test.ts
- **location:** 141–177 (`racedEntries`, `vi.spyOn(races, 'admitEntry').mockImplementation(...)`); затронуты тесты 180–302
- **problem:** `vi.spyOn(...).mockImplementation(...)` (не `Once`) на синглтоне `RacesRepository` стенда (`h` создаётся
  один раз в `beforeAll`, `h.reset()` чистит только данные). В файле нет `afterEach(() => vi.restoreAllMocks())`, в
  `vitest.config.mts` нет `restoreMocks`, в `harness`/test-kit сброса шпионов нет. После теста «отрицательное
  доказательство» на `races.admitEntry` остаётся реализация с `readOnly = true`: счётчик и `lockedAt`/`groupScheme`
  больше не пишутся. Повторный `vi.spyOn` в последующих тестах (строки 258, 286) возвращает **тот же** мок вместе с
  реализацией и накопленным `mock.calls`.
- **why_it_matters:** следующие тесты файла идут через подменённый `admitEntry`: «после первой заявки панель видит
  entries_locked» (201) — `lockedAt` не записан; «заявка ↔ отмена гонки» (254) и «вторая заявка ↔ отмена» (281) —
  нет записи в документ гонки, конфликта с удерживаемой транзакцией нет, `retried(admitSpy)` сразу true (calls ≥ 2 от
  прошлых тестов) → заявка проходит на отменённую гонку вместо 409; `entryAdmissions` не растёт. Итог — падение
  (или, хуже, ложнозелёный прогон, если порядок изменится) существующих тестов V-12/M1. Зависимость результата от
  порядка тестов нарушает изоляцию (pokatim-tests.md, «Test isolation»).
- **evidence:** `node_modules/@vitest/spy/dist/index.js:286` — `if (isMockFunction(originalImplementation)) return
  originalImplementation;` (повторный spyOn не сбрасывает реализацию); `grep restoreAllMocks apps/api/test` — пусто,
  в файле — нет; ср. `tickets-*.int.test.ts:34` — там `afterEach(vi.restoreAllMocks)`. Кроме того, во втором вызове
  `racedEntries` `const original = races.admitEntry.bind(races)` связывает уже мок, а не исходный метод (сейчас не
  выстреливает только потому, что readOnly-ветка `original` не вызывает).
- **recommended_fix:** `afterEach(() => vi.restoreAllMocks())` в файле (или `try/finally { spy.mockRestore() }` в
  `racedEntries`); `original` брать до шпиона из прототипа/после `restore`. Прогнать весь файл целиком (не `-t`).

### [LOW] LOW-1 — JSDoc `countReportQueue` оторван от метода
- **file:** apps/api/src/modules/profile/profile.repository.ts
- **location:** ~590–606 (`linesPage`)
- **problem:** новый `linesPage` с комментарием вставлен между JSDoc «Размер очереди жалоб…» и `countReportQueue`:
  у `linesPage` теперь два блока, у `countReportQueue` — ни одного.
- **why_it_matters:** вводящая в заблуждение документация в IDE/ревью.
- **evidence:** diff `profile.repository.ts @@ -588,6 +588,22 @@` — `/** Размер очереди жалоб … */` идёт сразу над
  `/** Страница профилей … */ linesPage(...)`.
- **recommended_fix:** перенести `linesPage` выше JSDoc `countReportQueue`.

### [LOW] LOW-2 — длинная строка JSDoc `ProfileCoreModule`
- **file:** apps/api/src/modules/profile/profile.module.ts
- **location:** 45
- **problem:** строка комментария ~160 символов (вне ширины prettier проекта; prettier JSDoc не переносит).
- **why_it_matters:** стиль; не блокер.
- **evidence:** diff, строка `(ProfilesOverview, admin-overview), разовая выборка служебных подписей … Репозитории объявлены только здесь (один`.
- **recommended_fix:** перенести по ширине 120.

## Проверено без замечаний

- **RATE_LIMIT_KEY_SECRET:** все места ключей лимитов переведены — `rateLimitKeyForIp` (registration, session refresh,
  devices webhook, routes/tracks upload, `consumeIpLimit` в `PublicReadGuard`/`IpRateLimitGuard`), `signInLimitKeys`,
  `passwordResetLimitKeys`, `panel-totp-user/ip`. `EMAIL_TOKEN_SECRET` остался только у токенов ссылок, приглашений,
  QR билетов, `erasedEmailMarker`, `credentialsStamp` — вне scope, не задеты. `Pick<Env,…>` сужены (TS ловит остатки).
  `cliEnv` нового секрета не требует — верно (CLI лимиты не использует).
- **Инфра:** `env.template` (`@secret`; bootstrap дописывает недостающие ключи на каждом деплое), compose `:?`,
  `rehearsal.sh` (новый секрет проверяется в ветке «новые секреты сгенерированы», не в `KEPT_SECRETS`),
  `infra/.env.example`, `apps/api/.env.example`, `test-env.ts`, CI env e2e-джобы (общая для `e2e:web` и `e2e:admin`;
  оба Playwright-конфига берут `process.env`, `e2e:web` — `--env-mode=loose`). Других мест запуска API с env нет.
- **`_` в `SeasonStandingsTableQuery`:** `strictObject` + `_` `^\d{1,20}$` optional + transform без `_`; прочие ключи и
  `_=x`/повтор `_` (массив) — 400. Оба контроллера (публичный и панели) через `ZodValidationPipe` — `_` до сервиса не
  доходит. Выходной тип (нормализация union → `cursor?: undefined | string`) совместим с `SeasonStandingsTableParams`
  (`Pick<…,'cursor'>`) в api-client/admin; `.shape`/`.extend` схемы нигде не используется. Int-тест сравнивает тело с
  `_` и без.
- **App:** `http-cache(.ts|.web.ts)` и их тесты удалены, ссылок не осталось; `queries.ts` — `fresh` на всех
  платформах; тест кэша проверяет `{ fresh: true }`. Старые клиенты не затронуты (не шлют `_`); новая сборка со старым
  API — риск §8.1 описан.
- **CLI reserved-names:** импорт через `modules/profile/index.ts`; `ProfileCoreModule` без импортов, провайдеры
  зависят только от `MONGO_DB` — контекст CLI собирается; вывод — id, названия полей, путь
  `/admin/rider-profiles/<id>` (маршрут есть в `apps/admin/src/router.tsx:385`), значений и e-mail нет; только чтение;
  пагинация по `_id` с `$gt` корректна; лишние аргументы — 2.
- **Ворота N7 (логика):** первая заявка записывает счётчик и стоит на воротах, вторая конфликтует и повторяется
  (`calls >= 3`), после коммита — `[1, 2]`; отрицательное доказательство без записи — `[1, 1]` (уникального индекса на
  `entryNo` нет, вторая не блокируется, `untilBlocked` выходит по `settled`). Сам механизм доказан корректно; проблема
  только в изоляции (HIGH-1).
- **Documentation Sync (§10):** `local-dev.md`, `deploy.md`, `profile.md` N8, `pokatim-security.md`, `pokatim-app.md` —
  обновлены и соответствуют коду.
- Миграций, задач BullMQ, аудита, UI/i18n/дизайн-системы изменение не касается.

NOT VERIFIED: фактический прогон `results-entries.int.test.ts` целиком (тесты не запускались по просьбе) — HIGH-1
выведен из исходников vitest и отсутствия restore; подтвердится/опровергнется текущим полным `pnpm check`.
