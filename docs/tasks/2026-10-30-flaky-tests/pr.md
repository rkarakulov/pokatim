Нестабильные тесты под нагрузкой: причины и починка (+ lingering close после 413/408)

## Что

- **Прод-код, `apps/api/src/raw-body.ts`** — lingering close после отказа `readLimited` (413/408): Node после ответа с
  `Connection: close` сразу разрушал сокет, недочитанный хвост тела давал RST, и клиент получал `EPIPE`/`ECONNRESET`
  вместо 413 (флак `track-uploads` MEDIUM-6; затрагивал все загрузки: заезды, мои маршруты, маршруты панели, аватар,
  PDF). Теперь FIN после ответа, приём сливается до конца тела, FIN клиента или `LINGER_MS` (5 с). Unit-тест на голом
  сокете без фикса красный 3/3.
- `bottom-sheet.test.tsx` — захват посреди снапа на фейковых таймерах (снап 300 мс успевал завершиться под нагрузкой).
- `expo-push.sender.test.ts` — удержанный запрос теста таймаута дорабатывает в своём тесте (раньше просыпался в
  следующем и съедал его `expo.fail`); таймаут — по команде теста.
- `SignInScreen.test.tsx` (admin) — пауза 429 прыжком `setSystemTime`, а не 900 секундных тиков.
- `apps/api` int: `test/wait.ts` — `CONDITION_WAIT` 15 с вместо 1 с (`vi.waitFor`) и 5 с (`untilBlocked`);
  `vitest.config.mts` — `integration` после `unit` (`groupOrder`), `testTimeout` int 60 с (замеры: до 35 с при
  load ≈ 50–80); `parse-thread.test.ts` — бюджет 20 с (настоящие `worker_threads`).
- `admin-02-ui` — не воспроизведён (task.md §4.5), без изменений.
- Правила: `pokatim-security.md` (lingering close), `pokatim-tests.md` (устойчивость под нагрузкой).

Задача, замеры до/после: `docs/tasks/2026-10-30-flaky-tests/task.md`.

## Проверки

- `pnpm check` (изолированные Mongo/Redis, `TURBO_CONCURRENCY=1`) — зелёный 3 раза подряд: №1 (до слияния develop) 18,5 мин; №2 на HEAD 18 мин (api 2354, app 2459, admin 489); №3 с `TURBO_FORCE=true` 15 мин — то же.
- Ревью: Claude independent-reviewer — APPROVE (1 MEDIUM, 3 LOW — исправлены); Codex — pass 1 APPROVE (2 MEDIUM —
  исправлены), pass 2 APPROVE без находок.

## Follow-up

- Эпизод «лимит Redis не сработал» в одном окне прогона (task.md §4.6) — не подтверждён, вероятно чужой `FLUSHDB`
  общей db; при повторе — проверить выдачу Redis db между сессиями.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
