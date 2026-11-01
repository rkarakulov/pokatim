# 1. Title

Мелкие follow-up API: свой секрет ключей лимитов, обход `NSURLCache` таблицы сезона, выборка служебных имён N8,
int-тест одновременных заявок (small-followups-api)

# 2. Goal

Закрыть четыре follow-up из прошлых задач:

1. **Секрет лимитов** (onboarding-01 `pr.md`, findings LOW): HMAC ключей лимитов в Redis — свой ключ
   `RATE_LIMIT_KEY_SECRET`, не `EMAIL_TOKEN_SECRET` (утечка одного не раскрывает другой).
2. **iOS `NSURLCache`** (race-results-08c §12.3 follow-ups): перезапрос таблицы сезона после расхождения снимков на
   native шёл обычным GET и мог вернуть ответ `max-age=60` из кэша. `whatwg-fetch` RN при `cache: 'no-cache'` дописывает
   `_=<время>`, а query таблицы был строгим (400). Вариант из follow-up — «разрешить `_` в query на сервере».
3. **N8** (name-consent-prompt, `profile.md`): имена и клубы «Райдер #N» / «Участник» / «Вы», сохранённые до запрета, —
   «выборка по `profiles` и сброс модератором (Q3) — до прода».
4. **Int-тест одновременных заявок разных райдеров** (name-consent-prompt §12 «Не сделано»): номера `entryNo`
   уникальны.

Уровень — task2.

# 3. Scope

- api: `config/env.ts` — `RATE_LIMIT_KEY_SECRET: Secret` (обязателен); все ключи лимитов (`rateLimitKeyForIp`,
  `signInLimitKeys`, `passwordResetLimitKeys`, `panel-totp-*`, `PublicReadGuard`, `IpRateLimitGuard`) — от него.
  Инфра: `infra/deploy/env.template` (`@secret` — bootstrap допишет на сервере), `docker-compose.yml` (`:?`),
  `rehearsal.sh`, `infra/.env.example`, `apps/api/.env.example`, CI e2e env, `test-env.ts`; доки — `local-dev.md`,
  `deploy.md`, `pokatim-security.md`.
- contracts: `SeasonStandingsTableQuery` — `_` (цифры, ≤ 20) принимается и отбрасывается; app: обход HTTP-кэша
  (`fresh`) на всех платформах, `http-cache(.web).ts` удалены; правило `pokatim-app.md`.
- contracts: экспорт `isReservedRiderLine`; profile: `ReservedRiderLines` (чтение страниц `profiles` по `_id`, фильтр
  правилом контракта); CLI `panel reserved-names` — id, поля, путь карточки панели; значения не печатаются; сброс —
  модератор в панели (существующие «Сбросить имя/клуб» с журналом). Доки — `profile.md` N8, `deploy.md`.
- api tests: одновременные заявки (5 параллельных; ворота на `admitEntry` + отрицательное доказательство без записи
  счётчика).

# 4. Out of Scope

- Авто-сброс служебных имён скриптом (решение N8 — сброс модератором).
- Смена ключей ссылок/билетов/маркеров (`EMAIL_TOKEN_SECRET` прежний).

# 8.1 Риски

- Первый деплой с `RATE_LIMIT_KEY_SECRET` — новые ключи лимитов: текущие счётчики обнуляются один раз (принято).
- Окно деплоя: новая native-сборка со старым API на перезапросе RC-11 получит 400 (`_`) — только редкий путь
  расхождения снимков; API деплоится раньше сборок.

# 8.3 Security checklist

1. **AuthN/AuthZ:** без изменений; CLI — доступ к серверу (как `grant-admin`), только чтение.
2. **Входные данные:** `_` — только цифры ≤ 20, отбрасывается до сервиса; прочий query по-прежнему строгий.
3. **Данные наружу:** CLI — только id пользователя и названия полей, без значений имени/клуба и e-mail.
4. **Злоупотребления:** лимиты те же, ключи — HMAC отдельным секретом; IP и e-mail в Redis по-прежнему нет.
5. **Секреты и логи:** новый секрет — только env (`@secret` на сервере, в git — `CHANGE_ME`/пусто); значения в логи
   не пишутся.
6. **Аудит:** сброс — существующие действия панели с журналом; CLI ничего не пишет.

# 9. Acceptance Criteria

- AC1: без `RATE_LIMIT_KEY_SECRET` (или короче 32) API не стартует; ключи лимитов входа — HMAC нового секрета, не
  `EMAIL_TOKEN_SECRET` (int).
- AC2: `GET …/standings/table?…&_=<цифры>` — тот же ответ, что без `_`; `_=x` и прочие лишние ключи — 400.
- AC3: приложение перезапрашивает таблицу с `fresh` на всех платформах.
- AC4: `panel reserved-names` — профили со служебной подписью в имени/клубе (id, поля, путь), без значений; профили не
  меняются; пусто — сообщение, код 0.
- AC5: параллельные заявки разных райдеров — номера 1…N; с воротами вторая ждёт коммита первой; без записи счётчика —
  номера совпадают (отрицательное доказательство).

# 10. Documentation Impact

`docs/runbooks/local-dev.md`, `docs/runbooks/deploy.md`, `docs/product/profile.md` (N8), `.claude/rules/pokatim-security.md`,
`.claude/rules/pokatim-app.md`.

# 12. Outcome

- Тесты: env (обязательность), sign-in int (ключи нового секрета), standings int (`_`), contracts (`_`,
  `isReservedRiderLine`), CLI int (`reserved-names`), results-entries int (N7: 5 параллельных, ворота,
  отрицательное доказательство — `[1, 1]` без записи счётчика, тест постоянный), app (кэш таблицы).
- NOT VERIFIED: ручная проверка на iOS-симуляторе (обход `NSURLCache` — по поведению `whatwg-fetch`, сервер проверен
  int-тестом).
