## Что

Четыре follow-up API (task: `docs/tasks/2026-11-01-small-followups-api/task.md`):

1. **`RATE_LIMIT_KEY_SECRET`** — свой HMAC-ключ для всех ключей лимитов в Redis (IP, e-mail, пара, userId 2FA), вместо
   `EMAIL_TOKEN_SECRET`. Обязателен в env-схеме; `env.template` — `@secret` (bootstrap допишет на сервере),
   compose `:?`, `rehearsal.sh`, оба `.env.example` (только имя), CI e2e, доки `local-dev.md`/`deploy.md`.
2. **iOS `NSURLCache` таблицы сезона** — `SeasonStandingsTableQuery` принимает и отбрасывает `_=<цифры>` (метка
   `whatwg-fetch` при `cache: 'no-cache'`); приложение перезапрашивает таблицу с `fresh` на всех платформах,
   `http-cache(.web).ts` удалены.
3. **N8** — `panel reserved-names`: профили, где имя или клуб — служебная подпись («Райдер #N», «Участник», «Вы»),
   сохранённые до запрета. Только чтение: id, поля, путь карточки или «скрыт» (непубличный профиль); значения не
   печатаются. Сброс — модератором (runbook `deploy.md`).
4. **Int-тест одновременных заявок** — 5 параллельных заявок → номера 1…5; ворота на `admitEntry` (вторая ждёт
   коммита первой) и отрицательное доказательство (без записи счётчика — `[1, 1]`).

## Риски

- Первый деплой с новым секретом обнуляет текущие счётчики лимитов (один раз).
- Новая native-сборка со старым API на редком перезапросе RC-11 получит 400 — API деплоится раньше сборок.

## Проверки

- Ревью: Claude independent-reviewer pass 1 — REQUEST CHANGES (HIGH: шпион `admitEntry` не снимался) → исправлено;
  Codex pass 1 — тот же HIGH; Codex pass 2 — APPROVE, MEDIUM (скрытые имена) → исправлено.
- Локально: format, lint, arch, typecheck — зелёные; затронутые тесты (env, sign-in, standings, CLI, заявки, contracts,
  app) — зелёные; полный прогон тестов на перегруженной машине (load avg ~35) упал только по таймаутам в
  незатронутых пакетах (`tracks` отдельно — 409/409). Полный прогон — CI.
- NOT VERIFIED: ручная проверка на iOS-симуляторе.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
