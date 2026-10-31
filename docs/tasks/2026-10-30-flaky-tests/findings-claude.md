# Findings — flaky-tests — pass 1 — reviewer: claude
base: origin/develop   commits: 52b73b07..ffd634dc (включая правки Codex pass 1)
verdict: APPROVE

Проверено вручную:
- `lingerOnClose` против исходников Node v22.22.2: `destroySoon` вызывает только `resOnFinish` (`_http_server` стр. 1035–1036)
  при `res._last` (ответ с `Connection: close`). Все пять вызовов `readLimited` (заезды, мои маршруты, маршруты
  панели, аватар, PDF материалов) ставят `Connection: close` при отказе. Переопределение на экземпляре сокета;
  таймер создаётся только внутри `destroySoon`, `unref`, снимается по `close`. Слушатели `once` уходят вместе
  с уничтоженным сокетом, утечек нет. Keep-alive-ответ `destroySoon` не вызывает, значит нет и таймера.
  `inject` (MockSocket не наследует `net.Socket`) пропускается. Удержание ограничено `LINGER_MS` после `finish` ответа.
  Слоты освобождаются в `finally` обработчика, до закрытия сокета. Статусы 413/408 не меняются.
- `raw-body.test.ts` — 5/5 прогонов зелёные при load ≈ 19–30 (64 МиБ сливаются за 0,1–0,2 с, запас до `LINGER_MS`
  большой). `bottom-sheet.test.tsx`, `SignInScreen.test.tsx`, `expo-push.sender.test.ts`, `parse-thread.test.ts`
  зелёные. Обе MEDIUM-находки Codex pass 1 (таймаут Expo; `vi.waitFor` двигает фейковые часы — подтверждено по
  `vitest@5.0.5`, `if (vi.isFakeTimers()) vi.advanceTimersByTime(interval)`) исправлены в ffd634dc.
- Рост таймаутов обоснован замерами task.md §4.4: int `testTimeout` 60 с при наблюдённых 35 с; `CONDITION_WAIT`
  15 с < 60 с; `parse-thread` 20 с при 6,4 с. Проверки не ослаблены: в bottom-sheet и SignInScreen добавлены
  ассерты (`onChange` не вызван; за секунду до конца паузы — ещё закрыто).
- `pnpm check` целиком не запускал (NOT VERIFIED): нужны отдельные Mongo/Redis db. Полагаюсь на отчёт в task.md §5.

### [MEDIUM] Мок `AbortSignal.timeout` не снят: проверка «сеть — unavailable» теперь идёт по ветке таймаута
- **file:** apps/api/src/modules/notifications/expo-push.sender.test.ts
- **location:** 112–132 («таймаут и сеть — unavailable»)
- **problem:** `vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)` действует до `afterEach`
  (`restoreAllMocks`). Второй отправитель того же теста (`apiUrl: 'http://127.0.0.1:1/...'`) тоже получает уже
  отменённый сигнал. `fetch` отклоняется сразу с `TimeoutError` и до соединения не доходит. Ошибка — `message:
  'push service timeout'`, а не `network`.
- **why_it_matters:** Ветка «сеть» (`reason=network`, отказ соединения) больше не проверяется. Ассерт
  `.kind === 'unavailable'` проходит по ветке таймаута, и часть теста про сеть стала тавтологией (tests.md: тест
  проверяет поведение). Если сломать классификацию сетевой ошибки, тест останется зелёным.
- **evidence:** `node -e` с отменённым `AbortController` (`reason` — `DOMException('…','TimeoutError')`):
  `fetch('http://127.0.0.1:1/x', { signal })` даёт `TimeoutError timed out`. В `expo-push.sender.ts:118-131`
  `error.name === 'TimeoutError' ? 'timeout' : 'network'`.
- **recommended_fix:** `mockReturnValueOnce` или `timeoutSpy.mockRestore()` сразу после `await sending`. Для
  закрытого порта проверять и `message: 'push service network'`.

### [LOW] SignInScreen: запас «ещё закрыто» — 1 с реального времени при `shouldAdvanceTime`, комментарий говорит «2 с»
- **file:** apps/admin/src/features/sign-in/SignInScreen.test.tsx
- **location:** 154–159
- **problem:** `lockedUntil` фиксируется при 429 (`syncNow() + 900 000`). Затем `setSystemTime(Date.now() + 898_000)`
  и `advanceTimersByTimeAsync(1_000)`: до конца паузы остаётся 1 с минус реальное время, прошедшее с 429
  (`shouldAdvanceTime: true` переносит его в фейковые часы). В комментарии написано «за 2 с до конца».
- **why_it_matters:** Сейчас запас примерно в 20 раз больше типичной задержки, поэтому флака нет, но граница
  зависит от реального времени — то же, что устраняла задача. Комментарий не совпадает с кодом.
- **evidence:** `SignInScreen.tsx:89` `setLockedUntil(syncNow() + seconds * 1000)`; тест — `vi.useFakeTimers({
  shouldAdvanceTime: true })`.
- **recommended_fix:** Прыгать на `Date.now() + 897_000` (реальные 2–3 с запаса) или поправить комментарий на «за 1 с».
  Для «ещё закрыто» точнее проверять `email()` (чистый `locked`), а не `submit()` (`disabled || password.length === 0`).

### [LOW] task.md §4.4 п. 1: устаревшее «меньше `testTimeout` 20 с»
- **file:** docs/tasks/2026-10-30-flaky-tests/task.md
- **location:** 76
- **problem:** После п. 3 (`testTimeout` int = 60 с) в тексте осталось «`CONDITION_WAIT` 15 с (меньше `testTimeout`
  20 с …)». Кроме того, §4.6 стоит перед §4.5.
- **why_it_matters:** Документ задачи противоречит конфигу и комментарию `test/wait.ts` (60 с).
- **recommended_fix:** «меньше `testTimeout` 60 с»; поменять §4.5 и §4.6 местами.

### [LOW] pokatim-security.md: «все три загрузки» — вызовов `readLimited` пять
- **file:** .claude/rules/pokatim-security.md
- **location:** 284
- **problem:** В абзаце, который дополнен в этом diff, по-прежнему «все три загрузки, включая панель». Вызовов
  `readLimited` пять: track-uploads, routes-mine, routes-admin, profile-avatars, materials-admin; сама task.md §4.2
  тоже перечисляет пять. Неточность была и раньше, diff её не исправил.
- **why_it_matters:** Правило должно перечислять, на кого распространяется lingering close.
- **recommended_fix:** «все загрузки на `readLimited` (заезды, мои маршруты, маршруты панели, аватар, PDF материалов)».

Вердикт: APPROVE — CRITICAL/HIGH нет.
