# 1. Title

Результат гонки, слайс 07: уровни заявки Verified/START, анкета Verified, группы зачёта пол × возраст, места по
группе, START без мест, флаги «Требует внимания» (FR-11).

# 2. Goal

Эпик `docs/tasks/2026-10-27-race-results/epic.md` §7 (строка 07), решения A3; спайк
`docs/tasks/2026-10-27-race-results/spike-07-08.md` §3 и §5 (S1–S8) — **решения автора, не пересматриваются**;
продукт `docs/product/races-and-seasons.md` («Зачёт: Verified/START, группы, сезон»).

Сейчас у заявки одна группа `overall` и `tier: null`, места считаются по всей гонке. После слайса:

- райдер в заявке выбирает **Verified** (анкета + пульс в треке → место в своей группе, спор, позже — очки сезона) или
  **START** (время «Финишёр», без места);
- группа зачёта — пол × возраст (6 групп), считает сервер по анкете, фиксирует в заявке; можно выбрать более
  молодую группу своего пола;
- команда в панели видит протокол по группам и флаги «Требует внимания»; флаги публикацию не блокируют.

Слайс 08 (рейтинг сезона) читает `tier` и `groupKey` из этого слайса — **в 07 не делается**.

Источники: `AGENTS.md` §1, §4; ADR-0011 (R9 — биометрию не храним), ADR-0012, ADR-0015 (удаление аккаунта);
`.claude/rules/{pokatim-backend,pokatim-db,pokatim-contracts,pokatim-security,pokatim-tests,pokatim-app,pokatim-web}.md`.
Код сверен по `origin/develop` @ `841b451`.

# 3. Scope

Поставка — **три PR в `develop` по очереди**, каждый зелёный сам по себе:

- **07a — модель, API, worker** (contracts, api-client, i18n-коды ошибок, `packages/tracks`, `apps/api`, миграция);
- **07b — панель** (`apps/admin`);
- **07c — приложение** (`apps/app`).

## 3.1 Термины и правила (решения спайка)

| Правило | Значение |
|---|---|
| Уровни | `ENTRY_TIERS = ['verified', 'start']` |
| Группы | `RESULT_GROUP_KEYS = ['overall', 'm_u40', 'm_40_49', 'm_50p', 'w_u40', 'w_40_49', 'w_50p']` (новые — в конец) |
| Возраст | `год гонки − birthYear`, где год гонки — год `windowEndsAt` по Минску (возраст на 31 декабря) |
| Полосы | `≤ 39` → `u40`, `40–49` → `40_49`, `≥ 50` → `50p` |
| Выбор группы | своя по анкете (по умолчанию) или **более молодая своего пола**; старшая и чужой пол — `422` |
| Схема гонки | `races.groupScheme: 'overall' \| 'gender_age'`; ставится при первой заявке (вместе с `lockedAt`, V-12) значением `gender_age`; гонки с `lockedAt` до миграции — `overall` |
| Схема `overall` | гонки до 07: группа всегда `overall`, **правило пульса не действует** (места как в v1) |
| В места | заявка `tier: 'verified'`, `status: 'active'`, лучшая засчитанная попытка **с пульсом** (схема `gender_age`) |
| Verified без пульса | лучшая засчитанная без пульса → строка «Без пульса — вне зачёта» среди финишёров, без места |
| START | `groupKey` = `overall`, время и «Финишёр», без места, без спора, флаги считаются, но не мешают |
| Переход | START → Verified — пока окно открыто (`upcoming`/`open`), с анкетой; Verified → START — `409`; после окна уровень и группа не меняются |
| Ничьи | «1, =2, =2, 4» внутри группы (существующий `rankRows`, равенство до секунды) |
| Анкета | `rider_verified_profiles`: пол `m`/`w`, год рождения, вес, рост, FTP (необязательно), согласие |
| Пол и год | райдер правит сам до первой Verified-заявки; потом — только admin в панели (новое право `profiles.verified_edit`), с причиной, журнал без значений |
| Год из регистрации | форма анкеты открывается с годом из `users.birthDate` (подсказка сервера), райдер подтверждает или правит; хранится в анкете (решение автора 2026-10-27) |

## 3.2 07a — contracts, api-client, i18n

- `results.schema.ts` (в конец справочников): `ENTRY_TIERS`, `GROUP_SCHEMES`, `RIDER_GENDERS = ['m', 'w']`, новые
  ключи `RESULT_GROUP_KEYS`, `ATTEMPT_FLAG_CODES = ['SPEED_CLUSTER_HIGH', 'HR_POWER_DECOUPLED', 'HR_GAPS']`; в
  `RACE_RESULT_STATUSES` — `finisher` (START или Verified без пульса со временем); причина вне зачёта
  `RESULT_UNRANKED_REASONS = ['start', 'no_heart_rate']`; в `RACE_ENTRY_BLOCK_REASONS` — что нужно для «повысить до
  Verified» (`verified_profile_required` и т.п. — на усмотрение architect).
- Запрос заявки `POST /v1/races/:raceId/entry`: `RaceEntryRequest = strictObject({ tier?, groupKey? })`. Пустое тело
  (старое приложение) = `{ tier: 'start' }` в схеме `gender_age` и прежнее поведение (`verified`, `overall`) в схеме
  `overall`. Повтор с `tier: 'verified'` на активной START-заявке — повышение. Новые ошибки — в `ERROR_CODES` в конец:
  `VERIFIED_PROFILE_REQUIRED` (409), `RACE_TIER_LOCKED` (409, понижение или окно закрыто), `RESULT_GROUP_NOT_ALLOWED`
  (422), `VERIFIED_DEMOGRAPHICS_LOCKED` (409).
- `MyRaceEntry`: `entry.tier`, `entry.groupKey`, `result.unranked` (причина или `null`), `groupOptions` — разрешённые
  группы для выбора (по анкете и гонке) или `null` без анкеты; `group` — группа заявки.
- Публичная таблица `GET /v1/races/:raceId/results`: query `group` (необязательный; по умолчанию — `overall` в схеме
  `overall`, иначе первая непустая группа по порядку справочника); ответ — `group`, `groups: [{ key, ranked }]`
  (непустые группы гонки для вкладок). Таблица финишёров — отдельный эндпоинт (`GET /v1/races/:raceId/finishers`,
  курсорная страница: время, имя по правилам P1, `unranked`, без места); точная форма — architect.
- Анкета: `GET /v1/profile/verified` → `{ profile | null, demographicsLocked, suggestedBirthYear | null }`;
  `PUT /v1/profile/verified` → `{ gender, birthYear, weightKg, heightCm, ftpW | null, consent: true }` (`no-store`).
  Пределы: вес 30–200 кг, рост 120–220 см, FTP 50–600 Вт (целые), год — от 1920 до `текущий − MIN_AGE_YEARS`.
  Смена пола или года при `demographicsLocked` — `409 VERIFIED_DEMOGRAPHICS_LOCKED`.
- Панель: `PATCH /v1/admin/riders/:userId/verified-demographics` → `{ gender?, birthYear?, reason }` (`ActionReason`),
  право `profiles.verified_edit` (в конец `PERMISSIONS`, только `admin`), журнал `profiles.verified_demographics_changed`
  (subject rider, причина, без значений). Существующие заявки не меняются.
- Панель «Результаты» (`results-admin.schema.ts`): строки протокола и предварительной таблицы — `tier`, `groupKey`,
  `flags: [{ code, metric }]`; фильтры `group` и `attention`; `counts.attention`; попытки — `flags`, `sensors`. Разбор
  спора — флаги цели.
- `packages/api-client`: новые методы; `enterRace(raceId, body)`.
- `packages/i18n`: тексты ошибок и подписи групп/уровней/флагов, нужные 07a (экранные тексты — в 07b/07c).

## 3.3 07a — `packages/tracks`: датчики и флаги

- Чистая функция флагов по точкам сегмента (`sensor-flags.ts`, рядом с `series.ts`): `sensors: { hr, power }`
  (есть ли отсчёты в сегменте старт→финиш), флаги `HR_GAPS`, `HR_POWER_DECOUPLED` с **умеренными** порогами спайка
  §3.3 (константы политики, `FLAGS_VERSION = 1`); метрики — только целые проценты, без уд/мин и ватт.
- `analyzeAttempt` дополнительно отдаёт `sensors` и `flags` (новые поля **вне** `CorridorMatch`: golden коридора и
  `CORRIDOR_ENGINE_VERSION` не меняются).
- Фикстуры: синтетические сегменты (unit) + golden `sensor-flags-golden.json` по реальным трекам с пульсом из
  `__fixtures__` (garmin, strava, FIT), сторож `UPDATE_SENSOR_FLAGS_GOLDEN=1`, версия = `FLAGS_VERSION`.

## 3.4 07a — `apps/api`

- **Миграция `0028_entry_tier`** (идемпотентная): `race_entries.tier: null → 'verified'`; `best.ranked = true` у
  заявок с `best`; `races.groupScheme = 'overall'` у гонок с `lockedAt`; коллекция `rider_verified_profiles`; новый
  частичный индекс мест (`tier: 'verified'`, `best.ranked: true`), затем удаление старого
  `race_entries_ranking_idx` в той же миграции (решение автора 2026-10-27, образец `0021`); индекс строк протокола
  `(raceId, revision, groupKey, order)`. Опубликованные протоколы не меняются; старые строки без `groupKey`
  читаются как `overall`.
- **`profile`**: коллекция и репозиторий `rider_verified_profiles` (`{ _id: userId, gender, birthYear, weightKg,
  heightCm, ftpW, consentAt, demographicsLockedAt, updatedAt, version }`), сервис и контроллер анкеты, панельная
  правка пола и года (транзакция: условная запись + `PanelAudit`), порт для `results` (чтение анкеты и фиксация
  пола/года в транзакции заявки), стирание анкеты в `ProfileErasure` (удаление аккаунта, PR #62). Значения анкеты —
  не в логах, не в outbox, не в журнале.
- **`races`**: `groupScheme` в документе и в `RaceForResults`; `admitEntry` ставит `gender_age`, если схемы нет.
- **`results`**:
  - заявка: уровень, группа (проверка «свой пол, не старше своей»), фиксация в заявке; повышение START → Verified;
    первая Verified-заявка фиксирует пол и год анкеты (`demographicsLockedAt`) **в той же транзакции**, гонка с правкой
    анкеты — конфликт записи;
  - `best.ranked`: в схеме `gender_age` у Verified — лучшая засчитанная **с пульсом**, если такая есть (иначе лучшая
    засчитанная, `ranked: false`); у START — лучшая засчитанная, `ranked: false`; в схеме `overall` — `ranked: true`;
  - чтение мест, «моё участие», публичная таблица и счётчики — по группе заявки и частичному фильтру
    `tier: 'verified', best.ranked: true`; таблица финишёров — START и Verified без пульса;
  - попытка: `sensors`, `flags`, `flagsVersion` пишет worker вместе с вердиктом;
  - `SPEED_CLUSTER_HIGH` — при чтении панели по правилам спайка §3.3 (а)/(б), метрика — отношение к медиане группы
    (до 0,001);
  - протокол: места по группам, START и без пульса — не в снимке; в строке снимка — `groupKey` и `flags` (снимок
    флагов цели, включая `SPEED_CLUSTER_HIGH`, на момент ревизии);
  - порт для споров: `tier` и `ranked` заявки.
- **`disputes`**: подать спор и быть целью — только Verified с местом в той же группе (`targetBlock`, `fileBlock`).
- **outbox**: новое событие не добавляется (§8, R4).

## 3.5 07b — панель «Протокол»

- «Результаты» гонки: вкладки/фильтр групп, колонка уровня, колонка и фильтр «Требует внимания» (коды флагов —
  подписи, метрика — подсказкой), KPI-плитка «Требует внимания» (`counts.attention`), флаги в таблице попыток.
- Таблица финишёров (START, без пульса) — отдельным блоком без мест.
- Разбор спора: флаги цели.
- Правка пола и года рождения райдера (admin, `profiles.verified_edit`): диалог с причиной, без показа веса/роста/FTP.

## 3.6 07c — приложение

- Заявка: выбор уровня (Verified / START, короткое объяснение) → для Verified без анкеты — анкета → выбор группы
  (своя по умолчанию, младшие своего пола). «Повысить до Verified» в «моём участии», пока окно открыто.
- «Анкета зачёта» в настройках профиля: вес, рост, FTP — правка всегда; пол и год — только до первой Verified-заявки
  (потом — только чтение с пояснением «меняет команда»); согласие на обработку.
- Моё участие: группа, место в группе или «Финишёр» / «Без пульса — вне зачёта».
- Таблица результатов: вкладки групп (`groups`), вкладка «Финишёры».
- Все платформы (iOS, Android, web SSR), компоненты и токены дизайн-системы, скелетоны (`AGENTS.md` §4.11–4.13).

# 4. Out of Scope

- Слайс 08: рейтинг сезона, модуль `standings`, очки, маршрут outbox для `results.*`.
- Показ веса, роста и FTP в панели; подтверждение веса медиа (V3); отзыв согласия на анкету без удаления аккаунта
  (follow-up).
- Индекс силы K1, история отношений райдера, кластеры по Вт/кг.
- Перерасчёт опубликованных протоколов гонок до 07.
- Уведомления о смене места/группы (модуля `notifications` на develop нет; сессия «Центр уведомлений» —
  отдельно).
- Новые темы и переделка экранов (сессия «Темы приложения»): 07c только добавляет элементы на существующие экраны.

# 5. Architecture Context

- Приложения/пакеты: `contracts`, `api-client`, `i18n`, `tracks`, `api` (`profile`, `races`, `results`, `disputes`,
  миграции), `admin`, `app`.
- Contracts: tolerant enum, новые значения — только в конец; старое приложение шлёт `{}` в заявку — работает.
- Миграция: expand + удаление старого индекса мест в одной миграции (решение автора); бэкфилл через `$exists`/`null`.
- Транзакции: заявка — `admitEntry` первой операцией; фиксация анкеты — запись документа анкеты в той же транзакции.
- Worker: флаги считаются в потоке разбора `analyzeAttempt` (белый список, семафор), без новых очередей.

## 5.1 Placement & Reuse Gate

- Переиспользуем: `rankRows`/`buildProtocol` (по группе), `admitEntry`, `lockEntry`, `PanelAudit`, `ActionReason`,
  `ProfileErasure`, `runParseThread`, `buildSeries`-подход к точкам сегмента, `minskToday`/`MINSK_PARTS`, `rideGpx`
  с `heartRate`, `tolerantEnum`, компоненты `@rkarakulov/ui`.
- Анкета — модуль `profile` (данные о человеке); `results` читает её только через порт из `profile/index.ts`.
- Группа и возраст — чистая политика (функция в `results.policy.ts` или contracts, если нужна клиенту для подписи
  «ваша группа»: решает architect; сервер — источник правды).
- Запрещено: копии DTO, хранение рядов пульса/мощности или значений в флагах, значения анкеты в логах/outbox/журнале,
  `Platform.OS` в экранах, хардкод стилей.

# 6. Relevant Files

- `packages/contracts/src/results/{results.schema,results-admin.schema}.ts`, `admin/{permissions,audit}.schema.ts`
- `packages/tracks/src/{parse,series}.ts`, `track.ts` — точки с `hr`/`power`
- `apps/api/src/modules/results/{results.policy,results.repository,results-read.service,entries.service,results-protocol.service,results-panel-read.service,attempt-check.processor,results.collection,results-for-disputes}.ts`
- `apps/api/src/modules/profile/{profile.module,profile-admin.controller,profile-moderation.service,profile-erasure}.ts`
- `apps/api/src/modules/races/{race-registry.port,races.repository,races.collection}.ts`
- `apps/api/src/modules/disputes/disputes.policy.ts`
- `apps/api/src/db/migrations/{0015_results,0021_routes_rider,0028_entry_tier}.ts`
- `apps/admin/src/features/results/*`, `features/disputes/*`
- `apps/app/src/features/races/{results-table,participation/*}.tsx`, `features/profile/*`

# 7. Implementation Notes

- `best` остаётся одним полем: выбор с учётом пульса и `ranked` — в `pickBest`. Повышение START → Verified и
  перепроверка пересчитывают `best` под `lockEntry`.
- Возраст: год гонки из `windowEndsAt` по Минску; групповые подписи — i18n.
- `SPEED_CLUSTER_HIGH` (а): в группе ≥ 5 ранжированных и `time < 0,80 × медиана группы`; (б): в гонке ≥ 5
  ранжированных и абсолютно лучшее время — у заявки не из `m_u40` (мужчины) или у женщины. Медиана — по
  ранжированным строкам группы.
- `HR_GAPS`: канал пульса есть; без пульса > 10 % времени сегмента или один пропуск > 120 с. `HR_POWER_DECOUPLED`:
  оба канала, сегмент ≥ 20 мин, ≥ 80 % отсчётов; Pw:HR половин > 15 % или пульс не отвечает (≥ 5 рывков мощности
  > 150 % средней за 60 с, в > 70 % нет роста пульса ≥ 5 уд/мин за 90 с).
- Попытки до 07 без `sensors` в схеме `overall` не нужны (правило пульса там не действует); в схеме `gender_age`
  попыток до 07 нет (гонка без заявок).

# 8. Risks / Assumptions / Open Questions

- R1. Удаление старого индекса мест: код после выката читает только новый; откат — повторное создание старого.
- R2. Самодекларация пола/года: подделка влияет на группу; ловит `SPEED_CLUSTER_HIGH` (б) и споры.
- R3. Пороги флагов начальные; смена — `FLAGS_VERSION`.
- R4. Новое событие outbox не добавляем: модуля уведомлений нет, предварительные места меняются при каждом чтении;
  для 08 хватает `protocol-published`/`result-revised`. Если «Центр уведомлений» попросит — отдельной задачей.
- A1. Старое приложение (пустое тело заявки) в новой гонке получает START — места не теряет, т.к. Verified без
  анкеты невозможен.
- Решения автора 2026-10-27 (вне спайка): год — анкета с подстановкой из регистрации; старый индекс удаляется в 0028;
  правка пола/года — новое право, только admin.

## 8.1 Requirements Consistency (заполняет architect)

Architecture Review — race-results-07 (07a): **CONCERNS (не блокирующие)**. Блокеров нет; решения ниже приняты
architect и действуют, пока автор не скажет иначе (пометка «нужно подтверждение» — только у RC-3).

- **RC-1. Схема `overall` и `tier: 'start'` не определены.** §3.1 описывает только пустое тело. Решение: в схеме
  `overall` уровень не выбирается — заявка всегда `verified`/`overall` без анкеты (как v1), ключ `tier` игнорируется;
  `groupKey` ≠ `overall` — `422 RESULT_GROUP_NOT_ALLOWED`. Альтернативы: `tier: 'start'` → START без места (третья
  ветка правил и тестов ради считаных гонок dev); `422` на любой `tier` (ломает новое приложение на старой гонке).
  Приложение узнаёт схему из `MyRaceEntry.groupScheme` и не показывает выбор.
- **RC-2. «Пустое тело = START» на существующей заявке** дало бы `409` (понижение) на повтор POST старого приложения
  после сетевого сбоя. Решение: на существующей активной заявке отсутствие `tier` = «без изменений» (`200`); правило
  «пустое тело = START» — только для новой заявки.
- **RC-3. Смена группы у существующей Verified-заявки в открытом окне не определена** (§3.1 говорит только «после окна
  не меняются»). Решение по умолчанию: группа фиксируется при переходе в Verified, смена — `409 RACE_TIER_LOCKED`;
  повтор с той же группой — `200`. Альтернатива (рекомендуемая к обсуждению с автором, если нужна исправимость
  ошибки выбора): смена разрешена только в фазе `upcoming` (попыток ещё нет, таблицы не видны). **Подтверждено
  оркестратором по спайку S4: группа фиксируется в заявке, смена — `409 RACE_TIER_LOCKED`.**
- **RC-4. Новые причины `RACE_ENTRY_BLOCK_REASONS` не нужны.** Причина «нужна анкета» в общем массиве `reasons` при
  `canEnter: true` (START доступен) запутала бы старые сборки (`unknown`). Решение: `actions.canUpgrade` +
  `verified.groupOptions: null` (анкеты нет) объясняют всё; закрытое окно — уже существующий `window_closed`.
- **RC-5. Путь и имя действия журнала расходятся с кодом.** Существующая панель профилей — `/v1/admin/profiles/:userId/*`,
  действия журнала — `profile.*` (`profile.name_reset`). Решение: `PATCH /v1/admin/profiles/:userId/verified-demographics`
  и действие `profile.verified_demographics_changed` (вместо `admin/riders/…` и `profiles.…`).
- **RC-6. Диалогу правки admin нужно текущее значение** — иначе правка вслепую. Решение: `GET
  /v1/admin/profiles/:userId/verified-demographics` → `{ gender, birthYear, demographicsLocked }` (только
  `profiles.verified_edit`, без веса/роста/FTP, без журнала — не биометрия). Минимум, оговорённый §8.3.
- **RC-7. Окно деплоя «миграция → перезапуск API/worker».** Старый API за эти секунды создаст заявку с `tier: null`,
  старый worker запишет `best` без `ranked` и попытку без `sensors` — такие строки не попадут в новый частичный
  индекс мест / будут «без пульса». Меры: `admitEntry` ставит схему по факту `lockedAt` до записи (`$cond`, гонка,
  получившая первую заявку от старого API, станет `overall`); чтения терпят `tier ?? 'verified'`, `best.ranked ?? true`;
  в `pr.md` — проверочный запрос после деплоя (`race_entries.countDocuments({ tier: null })`,
  `{ best: { $type: 'object' }, 'best.ranked': { $exists: false } }`) и действие при ненуле (перепроверка гонки
  панелью / повтор шагов 1–2 новой миграцией). Принятый риск (dev).
- **RC-8. Старые строки протокола без `groupKey`** (`race_protocol_rows` — append-only, бэкфилла нет): чтение группы
  `overall` — фильтр `groupKey: { $in: ['overall', null] }` (по новому индексу — две точки), `flags ?? []`.
- **RC-9. `order` строки протокола остаётся сквозным по ревизии** (уникальный `race_protocol_rows_order_unique` не
  меняется): группы по порядку `RESULT_GROUP_KEYS`, внутри группы — места, затем DQ группы. Страница группы — по
  `(raceId, revision, groupKey, order)`.
- **RC-10. Публичная таблица без `group` в схеме `gender_age` без единой строки** — «первая непустая» не существует.
  Решение: первая группа схемы (`m_u40`), `items: []`. Старое приложение видит только группу по умолчанию (первую
  непустую) с подписью `unknown` — принятая совместимость.
- **RC-11. Новый клиент ↔ старый API:** `RaceResultsQuery` строгий — `?group=` на старом сервере даст `400`. Решение:
  07c шлёт `group` только если ответ содержал непустой `groups` (обнаружение возможности); новые поля ответов
  приложения — с `.default(…)`.
- **RC-12. `SPEED_CLUSTER_HIGH`** — только для ранжированных строк (START и «без пульса» в медиану не входят и флаг
  скорости не получают, только флаги датчиков); (а) — в любой группе, включая `overall`; (б) — только группы
  `gender_age` (в `overall` пол неизвестен). Оба правила дают один флаг, метрика — отношение к медиане своей группы.
- **RC-13. Пороги датчиков недоопределены операционно** (что такое «пропуск», «рывок», «рост пульса»). Решение —
  точные определения в §11 «Флаги датчиков»; константы — `SENSOR_FLAGS_POLICY`, смена — `FLAGS_VERSION`.
- **RC-14. «С пульсом» = хотя бы один отсчёт пульса в сегменте.** Один отсчёт формально даёт место; ловит `HR_GAPS`
  (спайк: пропуски — сигнал, не DQ). Альтернатива — минимальное покрытие (≥ 50 %) как условие места — меняет продукт,
  не делаем без автора.
- **RC-15. Согласие на анкету без версии текста** — в отличие от `PUBLIC_NAME_CONSENT_VERSION`. Решение:
  `VERIFIED_PROFILE_CONSENT_VERSION` в contracts, `consentVersion` в документе анкеты (пишет сервер).
- **RC-16. Спор: заявитель START / без пульса** — существующих кодов `DISPUTE_FILE_BLOCKS` не хватает (`no_counted_result`
  неверен — результат засчитан). Решение: `'not_ranked'` в конец `DISPUTE_FILE_BLOCKS`; цель без места —
  существующий `target_not_counted`.
- **RC-17. Индекс с тем же ключом и другим частичным фильтром** (новый `race_entries_ranked_idx` рядом со старым до
  удаления) допустим в MongoDB ≥ 5.0 (у нас 8.0); доказательство — `migrations.int.test.ts` (повтор `0015` воссоздаёт
  старый, `0028` снова удаляет).
- Конфликтов с инвариантами §4 нет: группа, уровень-правило, место и флаги считает сервер; клиент шлёт намерение
  (`tier`, `groupKey`); биометрия не хранится (только `sensors` — наличие канала, метрики — проценты/отношения).

## 8.2 Deviations from spec

Отклонения, принятые architect (07a):

- DV-1 (RC-1): схема `overall` — уровень не выбирается, всегда `verified`/`overall`.
- DV-2 (RC-2): отсутствие `tier` на существующей заявке — без изменений.
- DV-3 (RC-4): новых `RACE_ENTRY_BLOCK_REASONS` нет; `actions.canUpgrade` + `verified` в `MyRaceEntry`.
- DV-4 (RC-5): `PATCH /v1/admin/profiles/:userId/verified-demographics`, действие `profile.verified_demographics_changed`.
- DV-5 (RC-6): добавлен `GET /v1/admin/profiles/:userId/verified-demographics` (admin).
- DV-6 (RC-15): `VERIFIED_PROFILE_CONSENT_VERSION` и `consentVersion` анкеты.
- DV-7 (RC-16): `DISPUTE_FILE_BLOCKS` + `not_ranked`.
- DV-8: функция группы — сервер (`results.policy.ts`), не contracts: клиент получает `verified.ownGroup` и
  `groupOptions` готовыми (единственный источник правды, без дубля в клиенте).
- DV-9: флаги лучшей попытки денормализованы в `race_entries.best.flags` (пишет `refreshEntry` под `lockEntry`):
  протокол, панель и счётчик «Требует внимания» не читают попытки.
- DV-10: таблица финишёров читается из заявок и после публикации (в снимок START/«без пульса» не входят).
- DV-11 (ревью pass 2, решение автора 2026-10-27): пульс импорта — по признаку тренировки. Попытка из потока
  агрегатора (`pokatim.stream.v1`, рядов нет — ADR-0011): `sensors = { hr: hasHeartRate, power: hasPower,
  source: 'declared' }` из самого потока, `flags: []` (`HR_*` не считаются). Файл FIT/GPX — `source: 'samples'`.
  Признак — тренировки целиком, не сегмента: принятое ослабление правила пульса для импорта.
- DV-12 (ревью Claude pass 2, оркестратор): мощность 0 (накат) — отсчёт в точках, но `hasPower` файла — только при
  мощности > 0: канал из одних нулей не обгоняет дубль с пульсом при выборе основной активности. Ряды 06b на разборе
  спора: средняя мощность теперь включает накат (корректнее); файл из одних нулей даёт ряд нулей вместо `null` —
  принято, версия рядов не вводится (кэш Redis 15 мин).

## 8.3 Security checklist

AuthN/AuthZ: анкета — только своя (`userId` из сессии); панель — `PanelGuard` + `profiles.verified_edit` (admin).
Входные данные: строгие zod-схемы, пределы. Наружу: вес/рост/FTP — только владельцу, в панель не уходят; пол и год —
в панели только в диалоге правки admin (на усмотрение architect — минимально). Флаги — только панели (`results.*`
права), не в публичных ответах и не райдеру. Логи/outbox/журнал — без значений анкеты и метрик пульса. Стирание
анкеты — с аккаунтом. Злоупотребления: лимит частоты `PUT` анкеты.

# 9. Acceptance Criteria

07a:
1. Заявка Verified без анкеты → `409 VERIFIED_PROFILE_REQUIRED`; с анкетой — группа по полу и возрасту на 31.12 года
   гонки (граничные возрасты 39/40, 49/50, переход года — тест).
2. Выбор младшей группы своего пола — ок; старшей или чужого пола — `422 RESULT_GROUP_NOT_ALLOWED`.
3. START → Verified в открытом окне — ок, места пересчитаны; Verified → START и любая смена после окна — `409`.
4. Пустое тело заявки — START в `gender_age`, прежнее поведение в `overall`.
5. Места внутри группы «1, =2, =2, 4»; START и Verified без пульса — без места, в таблице финишёров; публичная
   таблица и «моё участие» согласованы (одинаковое место).
6. Протокол: места по группам, START/без пульса не в снимке, `groupKey` и `flags` в строке; старые ревизии читаются.
7. Worker пишет `sensors`, `flags`, `flagsVersion`; golden флагов совпадает; метрики — проценты/отношения.
8. `SPEED_CLUSTER_HIGH` (а) и (б) — тесты на границах (5 финишёров, 0,80).
9. Флаги видны только в панели; публичные ответы и «моё участие» флагов не содержат (тест ключей ответа).
10. Пол/год после первой Verified-заявки: `PUT` от райдера → `409`; панель admin — меняет, журнал без значений;
    moderator → `403`. Гонка первой Verified-заявки и правки анкеты — одна побеждает (отрицательное доказательство).
11. Удаление аккаунта стирает анкету.
12. Спор: START или без пульса — нельзя подать и нельзя быть целью; другая группа — нельзя.
13. Миграция идемпотентна (повторный прогон), бэкфилл, новый индекс есть, старого нет (`migrations.int.test.ts`).
14. Значения анкеты не в логах (тест логгера на сервисе анкеты).

07b: вкладки групп, колонка и фильтр «Требует внимания», KPI, финишёры, флаги на разборе спора, диалог правки пола и
года (admin), состояния загрузки по §4.12; тесты компонентов.

07c: выбор уровня и группы при заявке, анкета (блокировка пола/года), «Повысить до Verified», группы и финишёры в
таблице; iOS/Android/web; тесты компонентов; скелетоны.

Все: `TURBO_CONCURRENCY=1 pnpm check` зелёный; два независимых ревью (Claude, Codex) — APPROVE.

# 10. Documentation Impact

- `docs/product/races-and-seasons.md` — уточнения (пустое тело → START, финишёры).
- `.claude/rules/pokatim-db.md` — `rider_verified_profiles`, `race_entries.tier/best.ranked`, `races.groupScheme`,
  флаги попытки; `pokatim-security.md` — анкета и флаги; `pokatim-tests.md` — golden флагов.
- `epic.md` — статус слайса 07.
- `.claude/rules/pokatim-backend.md` — анкета (`profile`: `VerifiedProfileController`, панель `profiles.verified_edit`,
  порт `VERIFIED_PROFILES` для `results`), публичный `GET /v1/races/:id/finishers`, `identity.IdentityAccounts.birthYearOf`;
  `pokatim-contracts.md` — `RaceEntryRequest`, `MyRaceEntry.verified/canUpgrade`, `groups`/`finishers`, анкета,
  `VERIFIED_PROFILE_CONSENT_VERSION`, правило «`group` в запросе — только при `groups` в ответе» (RC-11).
- `pr.md` 07a — миграция `0028` (удаляет индекс — решение автора), порядок деплоя «миграция → API+worker», проверочные
  запросы RC-7 после деплоя.

# 11. Implementation Context (заполняет architect)

## 11.1 07a — модель, API, worker

### ENTRY POINTS

- `POST /v1/races/:raceId/entry` (`RaceEntryController.enter` → `EntriesService.enter`) — тело `RaceEntryRequest`.
- `GET /v1/races/:raceId/entry` (`ResultsReadService.myEntry`) — новые поля `MyRaceEntry`.
- `GET /v1/races/:raceId/results?group&limit&cursor` (`ResultsPublicController` → `publicResults`).
- `GET /v1/races/:raceId/finishers?limit&cursor` — новый, `ResultsPublicController` (тот же гард и кэш).
- `GET|PUT /v1/profile/verified` — новый `VerifiedProfileController` (`profile`, `AuthGuard`, `no-store`).
- `GET|PATCH /v1/admin/profiles/:userId/verified-demographics` — новый `ProfileVerifiedAdminController`
  (`PanelGuard` + `profiles.verified_edit` на классе; отдельный класс — у `ProfileAdminController` на классе
  `profiles.moderate`).
- `GET /v1/admin/races/:raceId/{results,attempts,standings}` — новые поля; `standings` получает query.
- Worker: `AttemptCheckProcessor.check` → `runParseThread('analyzeAttempt')` (новые поля результата).
- `POST /v1/admin/races/:raceId/protocol/{publish,disqualify,revoke-disqualification,recheck/apply}` — `buildProtocol`
  по группам, снимок `groupKey`/`flags`.
- Миграция `0028_entry_tier` (`db:migrate`).

### TYPES & SCHEMAS (точные формы)

`packages/contracts/src/results/results.schema.ts` — справочники в конец файла справочников (порядок значений —
контракт, только в конец):

```ts
export const ENTRY_TIERS = ['verified', 'start'] as const;
export const GROUP_SCHEMES = ['overall', 'gender_age'] as const;
export const RIDER_GENDERS = ['m', 'w'] as const;            // можно в profile/verified-profile.schema.ts и реэкспорт
export const RESULT_GROUP_KEYS = ['overall', 'm_u40', 'm_40_49', 'm_50p', 'w_u40', 'w_40_49', 'w_50p'] as const;
export const ATTEMPT_FLAG_CODES = ['SPEED_CLUSTER_HIGH', 'HR_POWER_DECOUPLED', 'HR_GAPS'] as const;
export const RESULT_UNRANKED_REASONS = ['start', 'no_heart_rate'] as const;
// RACE_RESULT_STATUSES: + 'finisher' в конец
```

```ts
/** POST /v1/races/:raceId/entry. Пусто/нет тела — новая заявка START в gender_age (v1-поведение в overall). */
export const RaceEntryRequest = z
  .strictObject({ tier: z.enum(ENTRY_TIERS).optional(), groupKey: z.enum(RESULT_GROUP_KEYS).optional() })
  .optional();

/** Блок «Verified» участия: null — схема overall. */
const MyVerifiedState = z.object({
  /** анкета заполнена (и согласие дано) */
  profileReady: z.boolean(),
  /** своя группа по анкете для этой гонки; null — анкеты нет */
  ownGroup: tolerantEnum(RESULT_GROUP_KEYS).nullable(),
  /** разрешённые группы: своя первой, затем младшие своего пола; null — анкеты нет */
  groupOptions: z.array(tolerantEnum(RESULT_GROUP_KEYS)).nullable(),
});

MyRaceEntry = z.object({
  raceId, // как было
  /** схема гонки; гонка без заявок — 'gender_age' (её получит первая заявка) */
  groupScheme: tolerantEnum(GROUP_SCHEMES).default('overall'),
  entry: z.object({
    id, status, createdAt, withdrawnAt,                       // как было
    tier: tolerantEnum(ENTRY_TIERS).nullable().default(null),
    groupKey: tolerantEnum(RESULT_GROUP_KEYS).nullable().default(null),
  }).nullable(),
  result: z.object({
    status, elapsedSec, place, tied, ranked, group,            // как было; group = группа заявки (нет заявки — overall)
    unranked: tolerantEnum(RESULT_UNRANKED_REASONS).nullable().default(null),
  }),
  verified: MyVerifiedState.nullable().default(null),
  attempts, pendingUploads, uploadClosesAt,                    // как было (без флагов и датчиков!)
  actions: z.object({
    canEnter, canWithdraw, canAddAttempt, reasons,             // как было
    /** START → Verified: активная START-заявка, окно upcoming|open, гонка gender_age (анкета — отдельно: verified) */
    canUpgrade: z.boolean().default(false),
  }),
});

export const RaceResultsQuery = z.strictObject({
  limit, cursor,                                               // как было
  group: z.enum(RESULT_GROUP_KEYS).optional(),
});
export const RaceResultsPage = z.object({
  group, status, ranked, entries, items, nextCursor,           // как было; ranked — строк выбранной группы
  /** непустые группы гонки по порядку справочника (вкладки) */
  groups: z.array(z.object({ key: tolerantEnum(RESULT_GROUP_KEYS), ranked: z.number().int() })).default([]),
  /** строк таблицы финишёров (вкладка видна при > 0) */
  finishers: z.number().int().default(0),
});

export const RaceFinishersQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(RACE_RESULTS_PAGE_MAX).default(50),
  cursor: PageCursor.optional(),
});
export const RaceFinisherRow = z.object({
  entryId: Uuid,
  elapsedSec: z.number().int(),
  riderName: z.string().nullable().default(null),
  unranked: tolerantEnum(RESULT_UNRANKED_REASONS),
});
export const RaceFinishersPage = z.object({
  total: z.number().int(),
  items: z.array(RaceFinisherRow),
  nextCursor: z.string().nullable(),
});
```

`packages/contracts/src/profile/verified-profile.schema.ts` (новый):

```ts
export const VERIFIED_PROFILE_CONSENT_VERSION = '2026-10-27';   // версия текста согласия (i18n), поднимать при смене
export const VERIFIED_LIMITS = { weightKg: [30, 200], heightCm: [120, 220], ftpW: [50, 600], birthYearMin: 1920 };
export const VerifiedBirthYear = z.number({ error: fieldError('INVALID') }).int().min(1920, { error: 'INVALID' })
  .refine((y) => y <= Number(minskToday().slice(0, 4)) - MIN_AGE_YEARS, { error: 'AGE_BELOW_18' });
export const UpdateVerifiedProfileRequest = z.strictObject({
  gender: z.enum(RIDER_GENDERS, { error: fieldError('REQUIRED') }),
  birthYear: VerifiedBirthYear,
  weightKg: z.number().int().min(30).max(200),
  heightCm: z.number().int().min(120).max(220),
  ftpW: z.number().int().min(50).max(600).nullable(),
  consent: z.literal(true, { error: fieldError('CONSENT_REQUIRED') }),
});
export const VerifiedProfileView = z.object({
  profile: z.object({
    gender: tolerantEnum(RIDER_GENDERS), birthYear: z.number().int(),
    weightKg: z.number().int(), heightCm: z.number().int(), ftpW: z.number().int().nullable(),
    consentAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  }).nullable(),
  /** пол и год зафиксированы первой Verified-заявкой — меняет только команда */
  demographicsLocked: z.boolean(),
  /** год из регистрации — только при profile: null; иначе null */
  suggestedBirthYear: z.number().int().nullable(),
});
```

`packages/contracts/src/profile/profile-admin.schema.ts` (дополнить):

```ts
export const PanelVerifiedDemographics = z.object({
  gender: z.enum(RIDER_GENDERS), birthYear: z.number().int(), demographicsLocked: z.boolean(),
});
export const UpdateVerifiedDemographicsRequest = z.strictObject({
  gender: z.enum(RIDER_GENDERS).optional(), birthYear: VerifiedBirthYear.optional(), reason: ActionReason,
}).refine((b) => b.gender !== undefined || b.birthYear !== undefined, { error: 'REQUIRED' });
export const VerifiedDemographicsResult = PanelVerifiedDemographics.extend({ changed: z.boolean() });
```

`packages/contracts/src/results/results-admin.schema.ts` (строгие `z.enum`, поля обязательные — панель деплоится с API):

```ts
export const PanelAttemptFlag = z.object({ code: z.enum(ATTEMPT_FLAG_CODES), metric: z.number() });
export const AttemptSensors = z.object({ hr: z.boolean(), power: z.boolean() });
PanelRaceAttempt += { sensors: AttemptSensors.nullable(), flags: z.array(PanelAttemptFlag), flagsVersion: z.number().int().nullable() };
PanelStandingRow += {
  tier: z.enum(ENTRY_TIERS), groupKey: z.enum(RESULT_GROUP_KEYS),
  unranked: z.enum(RESULT_UNRANKED_REASONS).nullable(), flags: z.array(PanelAttemptFlag),
};
export const PanelRaceStandingsQuery = z.strictObject({
  group: z.enum(RESULT_GROUP_KEYS).optional(),
  /** только строки с флагами */
  attention: z.enum(['true']).optional(),
});
PanelRaceStandings += { groupScheme: z.enum(GROUP_SCHEMES).nullable(), groups: z.array(z.object({ key: z.enum(RESULT_GROUP_KEYS), ranked: z.number().int() })) };
PanelRaceResults += { groupScheme: z.enum(GROUP_SCHEMES).nullable() }; PanelRaceResults.counts += { attention: z.number().int(), finishers: z.number().int() };
```

`disputes-admin.schema.ts`: `PanelDispute.target += { tier: z.enum(ENTRY_TIERS), groupKey: z.enum(RESULT_GROUP_KEYS), flags: z.array(PanelAttemptFlag) }`.
`disputes.schema.ts`: `DISPUTE_FILE_BLOCKS` + `'not_ranked'` в конец (тест порядка `DISPUTE_ACTION_BLOCKS` обновить).
`admin/permissions.schema.ts`: `PERMISSIONS` + `'profiles.verified_edit'` в конец; `ROLE_PERMISSIONS.admin` — только admin.
`admin/audit.schema.ts`: `AUDIT_ACTIONS` + `'profile.verified_demographics_changed'` в конец; детали —
существующее `changedFields: ['gender' | 'birthYear']` (имена без значений).
`common.ts` `ERROR_CODES` в конец: `VERIFIED_PROFILE_REQUIRED` (409), `RACE_TIER_LOCKED` (409),
`RESULT_GROUP_NOT_ALLOWED` (422), `VERIFIED_DEMOGRAPHICS_LOCKED` (409); тексты — `apps/api/src/error-messages.ts`.

Документы (`*.collection.ts`):

```ts
// results.collection.ts
type EntryTier = 'verified' | 'start';
RaceEntryDoc.tier: EntryTier;                 // было null; чтение `tier ?? 'verified'` (RC-7)
RaceEntryDoc.groupKey: ResultGroupKey;        // как было, теперь 7 значений
EntryBest += { ranked: boolean; flags: AttemptFlagDoc[] };   // чтение `ranked ?? true`, `flags ?? []`
interface AttemptFlagDoc { code: 'HR_POWER_DECOUPLED' | 'HR_GAPS' | 'SPEED_CLUSTER_HIGH'; metric: number }
RaceAttemptDoc += {
  sensors?: { hr: boolean; power: boolean } | null;  // null — до вердикта, провал, нет сегмента; до 07 — нет поля
  flags?: AttemptFlagDoc[];                          // только датчики; до 07 — нет поля → []
  flagsVersion?: number | null;
};
RaceProtocolRowDoc += { groupKey?: ResultGroupKey; flags?: AttemptFlagDoc[] };  // старые ревизии — нет полей
// races.collection.ts
RaceDoc.groupScheme?: 'overall' | 'gender_age' | null;   // пишет только admitEntry; новые гонки — null
// profile: verified-profile.collection.ts (коллекция `rider_verified_profiles`, `PROFILE_COLLECTIONS.verified`)
interface RiderVerifiedProfileDoc {
  _id: string;               // userId
  gender: 'm' | 'w'; birthYear: number; weightKg: number; heightCm: number; ftpW: number | null;
  consentAt: Date; consentVersion: string;
  demographicsLockedAt: Date | null;
  updatedAt: Date; version: number;
}
```

`RaceForResults += { groupScheme: GroupScheme | null }` — маппинг `doc.groupScheme ?? (doc.lockedAt ? 'overall' : null)`.
`DisputeEntry += { tier: EntryTier; ranked: boolean }`; `DisputeStanding += { tier, groupKey, flags }`.
`packages/tracks`: `AttemptAnalysis = CorridorMatch & { trackMap; sensors: SensorPresence | null; flags: SensorFlag[]; flagsVersion: number }`.

### Политика групп (`results.policy.ts`, чистые функции, unit)

- `raceYear(race) = Number(minskToday(race.windowEndsAt).slice(0, 4))` (дата Минска конца окна).
- `ownGroup(gender, birthYear, race)`: `age = raceYear − birthYear`; `≤ 39 → u40`, `40–49 → 40_49`, `≥ 50 → 50p`;
  ключ `${gender}_${band}`.
- `allowedGroups(own)`: своя первой, затем младшие того же пола (`m_50p → [m_50p, m_40_49, m_u40]`).
- `planEntryChange({ scheme, phase, existing, request, profile })` → `{ kind: 'create' | 'upgrade' | 'noop', tier,
  groupKey } | DomainError` — вся матрица заявки в одной чистой функции:
  - `overall`: `groupKey` ∉ {нет, `overall`} → `RESULT_GROUP_NOT_ALLOWED`; новая — `verified/overall`; существующая —
    `noop`.
  - `gender_age`, новая: `tier` нет или `start` → `start/overall` (`groupKey` ∉ {нет, `overall`} → 422); `verified` →
    профиля нет — `VERIFIED_PROFILE_REQUIRED`; `groupKey` нет → своя; не из `allowedGroups` → 422.
  - `gender_age`, существующая активная: `tier` нет → `noop` (RC-2); тот же уровень и группа (или `groupKey` нет у
    Verified) → `noop`; `start` у Verified → `RACE_TIER_LOCKED`; START → `verified` → окно не `upcoming|open` —
    `RACE_TIER_LOCKED`, иначе как новая Verified (анкета, группа) → `upgrade`; смена группы Verified →
    `RACE_TIER_LOCKED` (RC-3).
- `rankRule(entry)`: `tier === 'start'` → `none`; `groupKey === 'overall'` → `all`; иначе `heart_rate`.
  Инвариант: Verified в `gender_age` никогда не `overall` (держит `allowedGroups`) — поэтому правило выводится из
  заявки без чтения гонки в `refreshEntry`.

### `pickBest` и `best.ranked`

```
pickBest(attempts, rule):
  counted = attempts.filter(status === 'counted' && segment)       // как было
  min(xs) = минимум по compareCounted (elapsedSec, segment.startedAt, _id)   // как было
  rule 'all'        → b = min(counted),                    ranked = true
  rule 'none'       → b = min(counted),                    ranked = false
  rule 'heart_rate' → h = min(counted.filter(a => a.sensors?.hr === true))
                      h ? (b = h, ranked = true) : (b = min(counted), ranked = false)
  нет b → null
  → { attemptId, elapsedSec, startedAt, finishedAt, ranked, flags: b.flags ?? [] }
```

`refreshEntry(tx, entry)` — `Pick<RaceEntryDoc, '_id' | 'best' | 'summary' | 'tier' | 'groupKey'>`, правило —
`rankRule(entry)`. Повышение START → Verified: сначала `setEntryTier` (новые `tier`, `groupKey` в том же документе),
затем `refreshEntry` с обновлённой заявкой — под тем же `lockEntryOf`.

`resultStatus`: после `withdrawn`/`dq` — `best && best.ranked === false` → `'finisher'` (до и после публикации, без
`ignoreBest`); иначе как было. `unranked` («моё участие», финишёры, панель): `best` есть и `ranked === false` →
`tier === 'start' ? 'start' : 'no_heart_rate'`, иначе `null`.

### Заявка, повышение, анкета — транзакции и замки

`EntriesService.enter(userId, raceId, body)` — `MongoTransactions.run`:

1. `RaceRegistry.admitEntry` (запись в гонку — первой, как было). Pipeline дополнительно:
   `groupScheme: { $ifNull: ['$groupScheme', { $cond: [{ $eq: [{ $ifNull: ['$lockedAt', null] }, null] },
   { $literal: 'gender_age' }, { $literal: 'overall' }] }] }` (выражения стадии видят документ до записи; RC-7).
2. `existing = lockEntryOf(raceId, userId)` (запись в заявку, если есть; иначе `null`). Отозванная — как было.
3. Гонка/фаза/коридор — как было (для `upgrade` фаза проверяется в `planEntryChange`).
4. Если план требует Verified в `gender_age`: `profile = VerifiedProfiles.lockForEntry(tx, userId, now)` —
   `findOneAndUpdate({ _id: userId }, [{ $set: { demographicsLockedAt: { $ifNull: ['$demographicsLockedAt',
   { $literal: now }] }, version: { $add: ['$version', 1] } } }], { returnDocument: 'after' })` — **настоящая запись
   всегда** (`version`); `null` → `VERIFIED_PROFILE_REQUIRED`. Группа — из возвращённого (после записи) пола и года.
5. `create` → `insertEntry` (+ outbox `entry-created`, как было); `upgrade` → `setEntryTier(tx, id, { tier:
   'verified', groupKey })` с фильтром `{ _id, status: 'active', tier: 'start' }` → `refreshEntry`.
6. Ответ — `myEntry` после коммита; `201` только для `create`.

Конфликт «первая Verified-заявка ↔ правка пола/года райдером»: `PUT /v1/profile/verified` — одна атомарная операция
вне транзакции: `updateOne({ _id: userId, $or: [{ demographicsLockedAt: null }, { gender, birthYear }] }, { $set:
{ …все поля, updatedAt }, $inc: { version: 1 } })`; `matchedCount 0` → документ есть — `409
VERIFIED_DEMOGRAPHICS_LOCKED`, нет — `insertOne` (`consentAt`, `consentVersion`, `demographicsLockedAt: null`,
`version: 0`; `isDuplicateKey(_id_)` → один повтор всей операции). Транзакция заявки пишет тот же документ (шаг 4):
одиночная запись, пришедшая во время транзакции, ждёт её коммита и перечитывает фильтр (видит `demographicsLockedAt`
→ 409); запись, закоммиченная после снимка транзакции, даёт ей WriteConflict → повтор на свежей анкете. Побеждает
одна; несогласованной пары «группа заявки ↔ анкета» нет.
Отрицательное доказательство (int, постоянный): (а) `lockForEntry` подменён чтением (`findOne`) → удерживаемая
транзакция заявки и `PUT` с новым полом обе коммитятся, группа заявки ≠ полу анкеты при `demographicsLockedAt` ≠
`null`; (б) из фильтра `PUT` убрано условие `$or` → `PUT` после коммита заявки меняет пол (200 вместо 409).

Панель (`ProfileVerifiedAdminService.update`) — транзакция: первой — `findOneAndUpdate({ _id: userId, $or: [{ gender:
{ $ne: g } }, { birthYear: { $ne: y } }] }, { $set: изменённые, updatedAt }, $inc: { version: 1 })` (только
присланные поля); нет документа — 404; значения те же — `{ changed: false }` без журнала; иначе
`PanelAudit.append({ action: 'profile.verified_demographics_changed', subject: { kind: 'rider', id, label:
riderSubjectLabel(id) }, reason, details: { changedFields } })`. Лог после коммита — id сотрудника и `changed`.

### Флаги датчиков (`packages/tracks/src/sensor-flags.ts`)

```ts
export const FLAGS_VERSION = 1;
export const SENSOR_FLAG_CODES = ['HR_POWER_DECOUPLED', 'HR_GAPS'] as const;   // ⊂ ATTEMPT_FLAG_CODES (сторож в api)
export const SENSOR_FLAGS_POLICY = {
  hrGapShare: 0.10, hrGapMaxMs: 120_000,
  decoupleMinMs: 20 * 60_000, decoupleMinCoverage: 0.80, decouplePct: 15,
  surgeRatio: 1.5, surgeBaseMs: 60_000, surgeAvgMs: 5_000, surgeRefractoryMs: 60_000,
  responseMs: 90_000, responseBpm: 5, minSurges: 5, nonResponseShare: 0.70,
} as const;
export interface SensorPresence { hr: boolean; power: boolean }
export interface SensorFlag { code: (typeof SENSOR_FLAG_CODES)[number]; metric: number }   // целые %
export function sensorFlags(points: readonly ParsedPoint[], window: SeriesWindow):
  { sensors: SensorPresence; flags: SensorFlag[] };
```

- Точки сегмента — со временем в `[startedAt, finishedAt]` (как `buildSeries`). `sensors.hr/power` — есть ли хоть
  один отсчёт.
- `HR_GAPS` (только при `sensors.hr`): «пропуск» — максимальная серия подряд идущих точек сегмента без `hr`; его
  длительность — от последнего отсчёта пульса до серии (или `startedAt`) до первого после неё (или `finishedAt`).
  `share = Σ / (finishedAt − startedAt)`; флаг — `share > 0,10` или любой пропуск `> 120 с`; `metric =
  round(share × 100)`. Разрежённая запись (smart recording) пропуском не считается — только точки без пульса.
- `HR_POWER_DECOUPLED` (оба канала, длительность ≥ 20 мин, доля точек с обоими ≥ 0,80): (а) половины по времени,
  `r = mean(power)/mean(hr)` по точкам с обоими; `pct = |r1 − r2| / r1 × 100`; флаг при `pct > 15`, `metric =
  round(pct)`. (б) рывок — точка, где среднее мощности за 5 с > 1,5 × среднего за предыдущие 60 с; следующий — не
  раньше 60 с после начала прошлого; ответ — `max(hr в (t, t+90 с]) − mean(hr за [t−5 с, t]) ≥ 5`; при `рывков ≥ 5`
  и `доля без ответа > 0,70` — флаг, `metric = round(доля × 100)`. Сработали оба — один флаг с метрикой (а).
- Без значений пульса/мощности в результате; функция — O(n) с двумя указателями окон.

`analyzeAttempt` (parse.ts): после `matchCorridorDetailed` — `const s = match.segment ? sensorFlags(points, segment)
: null`; возвращает `{ ...match, trackMap, sensors: s?.sensors ?? null, flags: s?.flags ?? [], flagsVersion:
FLAGS_VERSION }`. `CorridorMatch`, `corridor-golden.json`, `CORRIDOR_ENGINE_VERSION` — не меняются; тест `match` =
`matchCorridor` остаётся. Экспорт из `@pokatim/tracks/parse` (не из лёгкого входа).

Worker: `CheckResult += sensors, flags, flagsVersion`; `emptyResult` — `null, [], null`; успешная сверка — из
`outcome.result`; `implausible`/провалы — пусто. `requeueAttempt` сбрасывает `sensors: null, flags: [],
flagsVersion: null`. Значения в лог не пишутся (только коды флагов — тоже нет: лог как был).

### `SPEED_CLUSTER_HIGH` и снимок флагов

Чистая функция `speedClusterFlags(rows: { entryId; groupKey; elapsedSec }[]) → Map<entryId, AttemptFlagDoc>` в
`results.policy.ts`; `rows` — **ранжированные** строки гонки без DQ (все группы):

- медиана группы — по `elapsedSec` строк группы (чётное число — среднее двух средних);
- (а) в группе ≥ 5 строк и `elapsedSec / median < 0,80` (строго);
- (б) строк в гонке ≥ 5; строки с минимальным `elapsedSec` гонки, у которых `groupKey ∉ {'m_u40', 'overall'}`;
- метрика — `Math.round(elapsedSec / median × 1000) / 1000` своей группы; (а) или (б) — один флаг.

Где считается: живое чтение панели (`standings`, `summary.counts.attention`, разбор спора через порт) — по
`rankedEntries` всех групп; протокол — внутри `buildProtocol` по строкам ревизии. Флаги строки = `best.flags`
(датчики) + флаг скорости. Снимок: `RaceProtocolRowDoc.flags` на момент ревизии; DQ/отмена DQ пересобирает ревизию
из строк прошлой: датчики — `row.flags` без `SPEED_CLUSTER_HIGH`, скорость — заново по новой ревизии.

`buildProtocol(base, previous)`: `ProtocolBase += { groupKey; flags }` (`flags` — датчики). Группы по порядку
`RESULT_GROUP_KEYS`; внутри — не-DQ по `(elapsedSec, startedAt, entryId)` с `rankRows`, затем DQ группы; `order`
сквозной (RC-9); `statusOf` — как было. Публикация и «Применить пересчёт» — база `protocolBaseEntries` с фильтром
`tier: 'verified', 'best.ranked': true` (все группы); DQ/отмена DQ — строки ревизии (`groupKey ?? 'overall'`).

### Репозиторий результатов: параметр группы вместо `RESULTS_POLICY.groupKey`

- `RESULTS_POLICY.groupKey` удалить; `rankedFilter(raceId, group)` = `{ raceId, groupKey: group, status: 'active',
  best: { $type: 'object' }, tier: 'verified', 'best.ranked': true, disqualified: null }`; `countedFilter(raceId)` (база
  протокола) — те же без `groupKey` и `disqualified`.
- `group` — параметр `rankedPosition`, `countRanked`, `countRankedLess/Equal/UpTo`, `rankedPage`; `rankedEntries(raceId)`
  — все группы (панель); новые `rankedGroups(raceId, session) → { key, ranked }[]` (aggregate `$match` rankedFilter
  без группы → `$group` по `groupKey`), `finishersPage(raceId, after, limit, session)`, `countFinishers`,
  `finisherPosition` — фильтр `{ raceId, status: 'active', best: { $type: 'object' }, 'best.ranked': false,
  disqualified: null }`, порядок `(best.elapsedSec, best.startedAt, _id)`; `setEntryTier`.
- Протокол: `protocolRowsPage(raceId, revision, group, afterOrder, limit)`, `countProtocolRows(raceId, revision,
  group?)`, `protocolGroups(raceId, revision)`; фильтр группы — `groupFilter(group) = group === 'overall' ? { $in:
  ['overall', null] } : group` (RC-8).
- Курсор публичной таблицы: строка из запрошенной группы, иначе `400 cursor` (как было).
- `myEntry`/`liveResult`/`protocolResult`: группа — `entry.groupKey`; `ranked` — строк этой группы. Публичная таблица:
  группа по умолчанию — `overall` в схеме `overall`, иначе первая из `groups`, иначе `m_u40` (RC-10); `groups` и
  `finishers` — в той же snapshot-сессии.

### Миграция `0028_entry_tier` (без транзакции, идемпотентна; образец `0021`)

1. `race_entries.updateMany({ tier: null }, { $set: { tier: 'verified' } })`.
2. `race_entries.updateMany({ best: { $type: 'object' }, 'best.ranked': { $exists: false } }, { $set: { 'best.ranked': true } })`.
3. `races.updateMany({ lockedAt: { $type: 'date' }, groupScheme: { $exists: false } }, { $set: { groupScheme: 'overall' } })`.
4. `races.updateMany({ groupScheme: { $exists: false } }, { $set: { groupScheme: null } })` (явный `null`).
5. `ensureCollection('rider_verified_profiles')` (индексов сверх `_id` нет).
6. `race_entries_ranked_idx` — `{ raceId: 1, groupKey: 1, 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 }`,
   partial `{ status: 'active', best: { $type: 'object' }, tier: 'verified', 'best.ranked': true }`.
7. `race_entries_finishers_idx` — `{ raceId: 1, 'best.elapsedSec': 1, 'best.startedAt': 1, _id: 1 }`, partial
   `{ status: 'active', best: { $type: 'object' }, 'best.ranked': false }`.
8. `race_protocol_rows_group_idx` — `{ raceId: 1, revision: 1, groupKey: 1, order: 1 }`.
9. `if (indexExists('race_entries_ranking_idx')) dropIndex(...)` (решение автора; `LEGACY_RANKING_INDEX` константой).

Новые гонки (`RacesService.create`) пишут `groupScheme: null`. Порядок деплоя: миграция → API и worker вместе (RC-7).

### Споры

`results-for-disputes.ts`: `toEntry` + `tier`, `ranked = best !== null && (tier ?? 'verified') === 'verified' &&
(best.ranked ?? true)`; `standing` + `tier`, `groupKey`, `flags` (живые флаги цели: `best.flags` + скорость по
`rankedEntries`). `disputes.policy.ts`: `fileBlock` — после `no_counted_result`: `!complainant.ranked` → `not_ranked`;
`targetBlock` — `!target.ranked` → `target_not_counted` (вместе с проверкой группы — как было). Подача — те же замки.

### FILES TO MODIFY / CREATE

| Файл | Что |
|---|---|
| `packages/contracts/src/results/results.schema.ts` | справочники, `RaceEntryRequest`, `MyRaceEntry`, `RaceResultsQuery/Page`, финишёры |
| `packages/contracts/src/results/results-admin.schema.ts` | `PanelAttemptFlag`, `AttemptSensors`, поля попыток/строк/сводки, `PanelRaceStandingsQuery` |
| `packages/contracts/src/profile/verified-profile.schema.ts` (новый) + `index.ts` | анкета приложения |
| `packages/contracts/src/profile/profile-admin.schema.ts` | `PanelVerifiedDemographics`, `UpdateVerifiedDemographicsRequest`, результат |
| `packages/contracts/src/{common,admin/permissions,admin/audit,disputes/disputes,disputes/disputes-admin}.schema.ts` / `common.ts` | коды ошибок, право, действие, `not_ranked`, флаги цели |
| `packages/contracts/src/**/*.test.ts` | порядок справочников, строгие/толерантные разборы, `.default` для старого сервера |
| `packages/api-client/src/index.ts` | `enterRace(token, raceId, body = {})`, `getRaceResults` (+`group`), `getRaceFinishers`, `getVerifiedProfile`, `updateVerifiedProfile` |
| `packages/api-client/src/admin.ts` | `getRaceStandings(raceId, params)`, `getVerifiedDemographics(userId)`, `updateVerifiedDemographics(userId, body)` (`PATCH`) |
| `packages/i18n/src/ru.ts` | `races.error.{VERIFIED_PROFILE_REQUIRED,RACE_TIER_LOCKED,RESULT_GROUP_NOT_ALLOWED}`, `profile.verified.error.VERIFIED_DEMOGRAPHICS_LOCKED`, `results.group.*`, `results.tier.*`, `results.unranked.*`, `admin.results.flag.*`, `admin.audit.action.profile.verified_demographics_changed`, `admin.permission.profiles.verified_edit` (если есть такой словарь), текст согласия `profile.verified.consent` (версия — `VERIFIED_PROFILE_CONSENT_VERSION`) |
| `packages/tracks/src/sensor-flags.ts` (новый), `parse.ts` | `sensorFlags`, `AttemptAnalysis` + поля, экспорт |
| `packages/tracks/src/sensor-flags.test.ts`, `__fixtures__/sensor-flags-golden.json` (новые) | unit + golden |
| `apps/api/src/error-messages.ts` | тексты 4 кодов |
| `apps/api/src/modules/panel/permissions.ts` (`ROLE_PERMISSIONS`) + тест | `profiles.verified_edit` — admin |
| `apps/api/src/modules/identity/identity-accounts.ts` | `birthYearOf(userId): Promise<number \| null>` (удалённый/стёртый — `null`) |
| `apps/api/src/modules/profile/verified-profile.collection.ts`, `verified-profile.repository.ts` (новые; единственный писатель) | документ, `find`, `upsertOwn`, `lockForEntry`, `updateDemographics`, `delete` |
| `apps/api/src/modules/profile/verified-profile.service.ts`, `verified-profile.controller.ts` (новые) | `GET/PUT`, лимит `profile-verified-update:<uid>` 30/ч, лог без значений |
| `apps/api/src/modules/profile/profile-verified-admin.{controller,service}.ts` (новые) | `GET/PATCH` панели |
| `apps/api/src/modules/profile/verified-profiles.port.ts` (новый) + `index.ts`, `profile.module.ts` | порт `VERIFIED_PROFILES` `{ demographicsOf(userId) ; lockForEntry(tx, userId, now) }` в `ProfileCoreModule`; `ProfileModule` — контроллеры |
| `apps/api/src/modules/profile/profile-erasure.ts` | стирает и `rider_verified_profiles` (идемпотентно) |
| `apps/api/src/modules/races/{races.collection,race-registry.port,race-registry,races.repository,races.service}.ts` | `groupScheme`, `admitEntry` pipeline, `null` при создании |
| `apps/api/src/modules/results/results.collection.ts` | поля выше |
| `apps/api/src/modules/results/results.policy.ts` | группы, `planEntryChange`, `rankRule`, `pickBest`, `resultStatus`, `unrankedOf`, `entryActions` (`canUpgrade`), `speedClusterFlags`, `buildProtocol`; удалить `groupKey` |
| `apps/api/src/modules/results/results.repository.ts` | фильтры с группой, финишёры, группы, `setEntryTier`, протокол по группе, `requeueAttempt` |
| `apps/api/src/modules/results/{entries.service,race-entry.controller}.ts` | тело, план, повышение, анкета в транзакции |
| `apps/api/src/modules/results/results-read.service.ts`, `results-public.controller.ts` | «моё участие», таблица по группе, финишёры |
| `apps/api/src/modules/results/results-panel-read.service.ts`, `results-admin.controller.ts` | флаги, уровень, группы, фильтры, `attention` |
| `apps/api/src/modules/results/results-protocol.service.ts` | база с `groupKey`/`flags`, DQ-ревизии |
| `apps/api/src/modules/results/attempt-check.processor.ts` | поля вердикта |
| `apps/api/src/modules/results/results-for-disputes{,.port}.ts`, `results.module.ts` | порт споров, импорт порта анкеты |
| `apps/api/src/modules/disputes/{disputes.policy,disputes-panel.service}.ts` | `not_ranked`, флаги цели |
| `apps/api/src/db/migrations/0028_entry_tier.ts` (новый), `index.ts`, `migrations.int.test.ts` | миграция |
| `apps/api/test/results.ts` | хелперы: анкета (`seedVerifiedProfile`), заявка с телом |

### FILES TO READ

`results.policy.ts` (весь), `results.repository.ts` (таблица, протокол), `results-read.service.ts`,
`results-protocol.service.ts` (`publish`, `applyRecheck`, `toggleDisqualification`), `results-panel-read.service.ts`
(`standings`, `liveHead`), `entries.service.ts`, `attempt-check.processor.ts`, `races.repository.ts#admitEntry`,
`profile-moderation.service.ts` (образец транзакции с журналом), `profile.repository.ts` (upsert и `isDuplicateKey`),
`packages/tracks/src/{parse,series}.ts`, `corridor/fixtures.test.ts` (образец golden), `0021_routes_rider.ts`,
`migrations.int.test.ts`, `apps/api/test/{results,identity}.ts` (`rideGpx`, `gate`, `holdTransaction`),
`.claude/rules/{pokatim-db,pokatim-tests,pokatim-security}.md`.

### TEST MATRIX

| Уровень | Что | Где |
|---|---|---|
| contracts unit | порядок справочников (только в конец), `RaceEntryRequest` (пусто/undefined/лишний ключ 400), `MyRaceEntry` старого сервера → `default`, `UpdateVerifiedProfileRequest` пределы (29/30, 200/201, 119/120, 220/221, 49/50, 600/601, 1919/1920, год `текущий − 17` → `AGE_BELOW_18`, `consent: false`), `UpdateVerifiedDemographicsRequest` без полей → `REQUIRED` | `results.schema.test.ts`, `verified-profile.schema.test.ts`, `profile-admin`, `permissions`, `audit`, `disputes` |
| tracks unit | `sensorFlags`: нет пульса → `hr:false`, флагов нет; пропуск 121 с / 119 с; доля 10 % / 11 %; разрежённая запись без серий без пульса — не пропуск; развязка 14/16 %; < 20 мин и покрытие 79 % — не считается; рывки: 5 без ответа (флаг), 4 (нет), доля 70 % (нет) / 71 % (флаг); метрики целые | `sensor-flags.test.ts` |
| tracks golden | все фикстуры с пульсом (`garmin-connect.gpx`, `strava.gpx`, `garmin-edge-ride.fit`, `wahoo-elemnt-ride.fit`, поток `ow-stream.json` если есть пульс) по окну всего трека → `{ version: FLAGS_VERSION, sensors, flags }`; сторож `UPDATE_SENSOR_FLAGS_GOLDEN=1`; версия в файле = `FLAGS_VERSION`; `corridor-golden.json` не тронут (`git diff` пуст) | `sensor-flags.test.ts` |
| tracks unit | `analyzeAttempt` отдаёт `sensors/flags/flagsVersion`; ключи `CorridorMatch` не изменились (AC16) | `parse.test.ts` |
| api unit | `ownGroup` границы 39/40, 49/50, переход года (окно кончается 31.12 23:59 Минска = 20:59 UTC → год гонки; 01.01 00:30 Минска → следующий); `allowedGroups`; `planEntryChange` — вся матрица RC-1…RC-3; `rankRule`; `pickBest` (с пульсом медленнее — выбран, `ranked: true`; без пульса — `ranked: false`; START; overall); `resultStatus` `finisher`; `speedClusterFlags` — 4/5 строк, 0,80 ровно/0,799, (б) женщина/`m_40_49`/`m_u40`, ничья лучших; `buildProtocol` по группам (`order` сквозной, DQ в конце группы, флаги в строке); `entryActions.canUpgrade`; сторож `SENSOR_FLAG_CODES ⊂ ATTEMPT_FLAG_CODES` | `results.policy.test.ts` |
| api unit | сторож append-only (новых `update` у `race_protocol_rows` нет); `rider_verified_profiles` — писатель только репозиторий | `results.repository.test.ts` |
| int (MongoDB) | заявка: Verified без анкеты → 409; группа по анкете; младшая — ок; старшая/чужой пол/`overall` → 422; пустое тело → START (`gender_age`), `verified/overall` (`overall`); повтор без `tier` → 200 без изменений; START → Verified в окне — места пересчитаны (`best.ranked`), после окна → 409, Verified → START → 409 | `results-entries.int.test.ts` |
| int | места «1, =2, =2, 4» в группе; START и без пульса — в финишёрах, не в местах; «моё участие» = публичная строка (место, `ranked`); `groups`, `finishers`, курсор чужой группы → 400; протокол: группы, START не в снимке, `groupKey`/`flags` в строке; старая ревизия без `groupKey` читается как `overall`; DQ-ревизия сохраняет флаги датчиков | `results-read.int.test.ts`, `results-protocol.int.test.ts`, `results-revisions.int.test.ts` |
| int | worker: `rideGpx(…, { heartRate, power })` → `sensors.hr`, `flags`, `flagsVersion = 1`; без пульса → Verified `ranked: false`; перепостановка сбрасывает поля | `results-check.int.test.ts` |
| int | AC9: ключи публичной таблицы, финишёров и «моего участия» — без `flags`, `sensors`, `tier` чужих (рекурсивный обход ключей) | `results-read.int.test.ts` |
| int | анкета: `GET` пусто + `suggestedBirthYear`; `PUT` создаёт/меняет вес; пол после первой Verified → 409; вес после — 200; лимит 30/ч → 429; лог-сторож (AC14: spy `Logger.prototype.log/warn` — нет веса, роста, FTP, года) | `verified-profile.int.test.ts` (новый) |
| int — гонка (отрицательное доказательство) | `holdTransaction`/`gate`: заявка Verified ↔ `PUT` нового пола — побеждает одна; без записи в `lockForEntry` (подмена чтением) — обе коммитятся, группа ≠ анкете (красный по результату); без `$or` в фильтре `PUT` — 200 вместо 409 | `verified-profile-locks.int.test.ts` (новый) |
| int | панель: admin `GET/PATCH` — меняет, журнал `profile.verified_demographics_changed` с `changedFields`, без значений (поиск значений в документе журнала); те же значения — `changed: false`, без журнала; moderator/organizer → 403; неизвестный → 404 | `profile-verified-admin.int.test.ts` (новый); `admin-routes.test.ts` обходит новые маршруты |
| int | удаление аккаунта стирает анкету (`ProfileErasure`), повтор — идемпотентно | `profile.int.test.ts` / account-тест |
| int | споры: START/без пульса — `not_ranked` подать нельзя, цель — `target_not_counted`; другая группа — нельзя; разбор показывает флаги цели | `results-disputes.int.test.ts`, `disputes-panel.int.test.ts` |
| int | панель: `standings?group&attention`, `counts.attention`, флаги скорости (а)/(б) на живом чтении | `results-protocol.int.test.ts` или новый `results-panel-flags.int.test.ts` |
| int | миграция: бэкфилл `tier`, `best.ranked`, `groupScheme` (`overall` / `null`), коллекция, новые индексы, старого нет; повторный `up` — без изменений; повтор `0015` → `0028` снова удаляет | `migrations.int.test.ts` |
| int | `admitEntry`: первая заявка — `gender_age`; гонка с `lockedAt` без схемы — `overall` (RC-7); отрицательное доказательство «запись без счётчика» — как было | `results-entries.int.test.ts` |

### Порядок реализации (TDD)

1. contracts + тесты схем; `api-client` + тесты; i18n-ключи (сборка зелёная, сервер ещё старый — новые поля `default`).
2. `packages/tracks`: `sensor-flags.test.ts` (синтетика, красный) → `sensorFlags` → golden (`UPDATE_SENSOR_FLAGS_GOLDEN=1`
   один раз, проверить руками метрики) → `analyzeAttempt` + `parse.test.ts`.
3. Миграция `0028` + `migrations.int.test.ts` (красный → зелёный).
4. `races`: `groupScheme` в документе/порте, `admitEntry` (int).
5. `profile`: коллекция, репозиторий, порт, сервис/контроллер анкеты (int + лог-сторож), `ProfileErasure`; identity
   `birthYearOf`.
6. `results.policy.ts` unit: группы → `planEntryChange` → `rankRule`/`pickBest` → `resultStatus`/`unranked` →
   `speedClusterFlags` → `buildProtocol`.
7. Репозиторий: фильтры с группой (удалить `RESULTS_POLICY.groupKey` — компилятор покажет все места), финишёры,
   протокол по группе.
8. `EntriesService` + контроллер (int заявок), затем гонка с анкетой (отрицательные доказательства).
9. Worker (`CheckResult`, `requeueAttempt`) — int проверки.
10. Чтение приложения: «моё участие», таблица, финишёры (int + ключи ответа).
11. Протокол и панель: `protocolBaseEntries`, ревизии, `standings`/`summary`/`attempts` (int).
12. Право и панельная правка анкеты (int + `admin-routes.test.ts`).
13. Споры (unit политики + int).
14. Документация §10, `TURBO_CONCURRENCY=1 pnpm check`.

### OUT OF SCOPE (07a)

Экраны панели и приложения (07b/07c); рейтинг сезона и маршрут outbox (08); новые события outbox; перерасчёт
опубликованных протоколов до 07; флаги по Вт/кг и истории; показ веса/роста/FTP где-либо, кроме владельцу;
журнал просмотра демографии в панели; смена группы Verified-заявки (RC-3: группа фиксируется в заявке); отзыв согласия без
удаления аккаунта.

## 11.2 07b — панель (потребляет 07a)

- Файлы: `apps/admin/src/features/results/{RaceResultsScreen,StandingsTable,AttemptsTable,results-query,results-format}.tsx|ts`
  (+ тесты), новый `VerifiedDemographicsDialog.tsx` (+ тест), `features/disputes/{DisputeScreen,disputes-format}.tsx|ts`.
- Эндпоинты: `getRaceResultsSummary` (`groupScheme`, `counts.attention`, `counts.finishers` — KPI), `getRaceStandings(raceId,
  { group, attention })` (`groups` — вкладки; строки `tier`, `groupKey`, `unranked`, `flags`; блок финишёров — строки
  с `unranked ≠ null`), `listRaceAttempts` (`sensors`, `flags`), `getDispute` (`target.flags/tier/groupKey`),
  `getVerifiedDemographics`/`updateVerifiedDemographics` (кнопка только при праве `profiles.verified_edit` из `PanelMe`).
- Подписи: `admin.results.flag.*` (метрика — подсказкой: «×0,78 медианы группы», «18 %»), `results.group.*`,
  `results.tier.*`. Ошибки — `results-errors.ts`. Скелетоны §4.12; только светлая тема «Протокол».

## 11.3 07c — приложение (потребляет 07a)

- Файлы: `apps/app/src/features/races/participation/{race-participation,entry-actions,entry-result}.tsx`, новые
  `tier-picker.tsx`, `group-picker.tsx`; `features/races/{results-table,queries,participation-format}.ts(x)` (вкладки
  групп + «Финишёры»); `features/profile/verified-profile-form.tsx` + `queries.ts`; экран `app/settings/verified.tsx`
  (или раздел в `settings/profile.tsx`) — все с тестами, iOS/Android/web, скелетоны.
- Эндпоинты: `enterRace(token, raceId, { tier, groupKey })`; `getMyRaceEntry` (`groupScheme`, `entry.tier/groupKey`,
  `result.unranked`, `verified.{profileReady, ownGroup, groupOptions}`, `actions.canUpgrade`); `getRaceResults(raceId,
  { group })` — `group` только если прошлый ответ дал `groups` (RC-11); `getRaceFinishers`; `getVerifiedProfile` /
  `updateVerifiedProfile` (`demographicsLocked` → пол и год только чтение, «меняет команда»; `suggestedBirthYear` —
  подстановка при `profile: null`).
- Ошибки: `VERIFIED_PROFILE_REQUIRED` → переход к анкете; `RESULT_GROUP_NOT_ALLOWED`, `RACE_TIER_LOCKED`,
  `VERIFIED_DEMOGRAPHICS_LOCKED` — тексты i18n из 07a. Схема `overall` — выбор уровня не показывается.

# 12. Outcome (заполняет coder)

## 12.1 07a — модель, API, worker

### Changes

- **contracts**: `ENTRY_TIERS`, `GROUP_SCHEMES`, `RIDER_GENDERS`, `RESULT_GROUP_KEYS` (+6 групп), `ATTEMPT_FLAG_CODES`,
  `RESULT_UNRANKED_REASONS`, `RACE_RESULT_STATUSES` + `finisher`, `DISPUTE_FILE_BLOCKS` + `not_ranked` (всё в конец);
  `RaceEntryRequest`, `MyRaceEntry` (`groupScheme`, `entry.tier/groupKey`, `result.unranked`, `verified`,
  `actions.canUpgrade` — с `.default`), `RaceResultsQuery.group`, `RaceResultsPage.groups/finishers`,
  `RaceFinishers{Query,Row,Page}`; анкета `profile/verified-profile.schema.ts` (+ `VERIFIED_PROFILE_CONSENT_VERSION`,
  RC-15), панель — `PanelVerifiedDemographics`, `UpdateVerifiedDemographicsRequest`, `VerifiedDemographicsResult`,
  `PanelAttemptFlag`, `AttemptSensors`, `PanelResultGroup`, `PanelRaceStandingsQuery`, новые поля
  `PanelRaceAttempt/PanelStandingRow/PanelRaceStandings/PanelRaceResults`, `PanelDispute.target.{tier,groupKey,flags}`;
  4 кода ошибок, право `profiles.verified_edit`, действие `profile.verified_demographics_changed`.
- **api-client**: `enterRace(token, raceId, body = {})`, `getRaceResults(…, { group })`, `getRaceFinishers`,
  `getVerifiedProfile`/`updateVerifiedProfile`; панель — `getRaceStandings(raceId, params)`,
  `getVerifiedDemographics`/`updateVerifiedDemographics` (`PATCH`).
- **i18n**: тексты 4 ошибок, `results.group.*`, `results.tier.*`, `results.unranked.*`, `admin.results.flag.*`,
  статус `finisher`, действие журнала, `disputes.*.not_ranked`, текст согласия `profile.verified.consent`.
- **tracks**: `sensor-flags.ts` (`sensorFlags`, `SENSOR_FLAGS_POLICY`, `FLAGS_VERSION = 1`, определения RC-13: пропуск
  — серия точек без пульса; рывок — среднее за 5 с > 1,5 × 60 с; окна O(n) монотонными указателями);
  `analyzeAttempt` → `sensors/flags/flagsVersion` (вне `CorridorMatch`). Синтаксис — только стираемый TS (поток
  разбора грузит исходник type stripping).
- **api / races**: `groupScheme` в документе и `RaceForResults` (`?? (lockedAt ? 'overall' : null)`), `admitEntry`
  ставит схему pipeline-ом (RC-7), новые гонки — `null`.
- **api / profile**: `rider_verified_profiles` (коллекция, `VerifiedProfileRepository` — единственный писатель),
  `VerifiedProfileService/Controller` (`GET|PUT /v1/profile/verified`, лимит 30/ч, подсказка года —
  `IdentityAccounts.birthYearOf`), `ProfileVerifiedAdminService/Controller` (`GET|PATCH
  /v1/admin/profiles/:userId/verified-demographics`, admin), порт `VERIFIED_PROFILES`, стирание в `ProfileErasure`.
- **api / results**: `results.policy.ts` — `raceYear`, `ownGroup`, `allowedGroups`, `needsVerifiedProfile`,
  `planEntryChange` (вся матрица RC-1…RC-3), `rankRule`, `pickBest(attempts, rule)`, `resultStatus` (`finisher`),
  `unrankedOf`, `entryActions.canUpgrade`, `speedClusterFlags`, `rowFlags`, `buildProtocol` по группам (флаг
  скорости — по строкам ревизии); `RESULTS_POLICY.groupKey` удалён. Репозиторий — фильтры с группой и
  `tier/best.ranked`, финишёры, группы, `setEntryTier`, протокол по группе (RC-8), `requeueAttempt` сбрасывает
  датчики. `EntriesService.enter` — тело, план, анкета в транзакции, повышение. Чтения — «моё участие», таблица по
  группе, `GET /v1/races/:raceId/finishers`; панель — `standings?group&attention`, `counts.attention/finishers`,
  флаги попыток; worker пишет `sensors/flags/flagsVersion`; порт споров — `tier/ranked`, флаги цели.
- **api / disputes**: `fileBlock` → `not_ranked`, `targetBlock` → без места — `target_not_counted`.
- **Миграция `0028_entry_tier`**: бэкфилл `tier`, `best.ranked`, `groupScheme`; коллекция анкет; индексы
  `race_entries_ranked_idx`, `race_entries_finishers_idx`, `race_protocol_rows_group_idx`; удаление
  `race_entries_ranking_idx`.
- **apps/admin, apps/app** (минимально, чтобы typecheck был зелёным после contracts): тон статуса `finisher` в
  `RESULT_TONE` (admin `results-format.ts`) и `RESULT_TONES` (app `participation-format.ts`) — `neutral`; фикстуры
  тестов с новыми обязательными полями. Экранов 07b/07c нет.

### Files touched

contracts: `packages/contracts/src/{common.ts,common.test.ts,index.ts}`,
`results/{results.schema.ts,results-admin.schema.ts,results.schema.test.ts,tiers.schema.test.ts}`,
`profile/{verified-profile.schema.ts,verified-profile.schema.test.ts,profile-admin.schema.ts}`,
`admin/{permissions.schema.ts,permissions.schema.test.ts,audit.schema.ts,audit.schema.test.ts}`,
`disputes/{disputes.schema.ts,disputes.schema.test.ts,disputes-admin.schema.ts}`.
api-client: `packages/api-client/src/{index.ts,admin.ts,tiers.test.ts,admin.test.ts,results.test.ts,disputes.test.ts}`.
i18n: `packages/i18n/src/ru.ts`. tracks: `packages/tracks/src/{sensor-flags.ts,sensor-flags.test.ts,parse.ts,
parse.test.ts,__fixtures__/sensor-flags-golden.json}`.
api: `src/error-messages.ts`, `src/db/migrations/{0028_entry_tier.ts,index.ts,migrations.int.test.ts}`,
`modules/identity/{identity.repository.ts,identity-accounts.ts}`, `modules/panel/{permissions.ts,permissions.test.ts,
panel-session.int.test.ts}`, `modules/races/{races.collection.ts,race-registry.port.ts,race-registry.ts,
races.repository.ts,races.service.ts}`, `modules/profile/{profile.collection.ts,profile.module.ts,index.ts,
profile.policy.ts,profile-erasure.ts,profile.repository.test.ts,verified-profile.collection.ts,
verified-profile.repository.ts,verified-profiles.port.ts,verified-profiles.ts,verified-profile.service.ts,
verified-profile.controller.ts,profile-verified-admin.service.ts,profile-verified-admin.controller.ts,
verified-profile.int.test.ts,verified-profile-locks.int.test.ts,profile-verified-admin.int.test.ts}`,
`modules/results/{results.collection.ts,results.policy.ts,results.repository.ts,entries.service.ts,
race-entry.controller.ts,results-read.service.ts,results-public.controller.ts,results-panel-read.service.ts,
results-admin.controller.ts,results-protocol.service.ts,attempt-check.processor.ts,results-for-disputes.ts,
results-for-disputes.port.ts,results.policy.test.ts,results-tiers.policy.test.ts,results.repository.test.ts,
results-tiers.int.test.ts,results-check.int.test.ts,results-read.int.test.ts,results-entries.int.test.ts,
results-disputes.int.test.ts}`, `modules/disputes/{disputes.policy.ts,disputes.policy.test.ts,
disputes-panel.service.ts}`, `test/{results.ts,panel.ts}`.
admin: `src/features/results/{results-format.ts,RaceResultsScreen.test.tsx}`,
`src/features/disputes/{DisputeScreen.test.tsx,DisputeSeries.test.tsx}`. app: `src/features/races/participation-format.ts`,
`src/__tests__/races-fixtures.ts`.

### Docs updated

`docs/product/races-and-seasons.md` (уточнения 07a), `docs/tasks/2026-10-27-race-results/epic.md` (строка 07),
`.claude/rules/{pokatim-db,pokatim-security,pokatim-tests,pokatim-backend,pokatim-contracts}.md`,
`docs/tasks/2026-10-27-race-results-07-tiers-clusters/pr.md` (миграция, порядок деплоя, проверочные запросы RC-7).

### Tests

Добавлено: contracts `tiers.schema.test.ts`, `verified-profile.schema.test.ts`; api-client `tiers.test.ts`; tracks
`sensor-flags.test.ts` (синтетика границ: 119/121 с, 10/11 %, разрежённая запись, 14/16 %, < 20 мин, покрытие
79/81 %, 4/5 рывков, 70/71 %, оба правила) + golden 4 реальных треков (`ow-stream.json` значений датчиков не несёт —
проверено в тесте) + `parse.test.ts` (поля `analyzeAttempt`, ключи `CorridorMatch`); api unit
`results-tiers.policy.test.ts` (группы и переход года, матрица заявки, `rankRule`, `pickBest`, `finisher`,
`unrankedOf`, `canUpgrade`, `SPEED_CLUSTER_HIGH` (а)/(б) на границах 4/5 строк и 0,80/0,799, ничья лучших, протокол
по группам, сторож `SENSOR_FLAG_CODES ⊂ ATTEMPT_FLAG_CODES`), сторож анкет в `profile.repository.test.ts`; int —
`results-tiers.int.test.ts` (AC1–AC6, AC8, AC9, AC12), `results-check.int.test.ts` (AC7), `verified-profile.int.test.ts`
(AC10, AC11, AC14), `verified-profile-locks.int.test.ts` (AC10, отрицательные доказательства),
`profile-verified-admin.int.test.ts` (AC10), `migrations.int.test.ts` (AC13).

`TURBO_CONCURRENCY=1 pnpm check` (MONGO `pokatim_r07_test`, Redis db 11), хвост:

```
@pokatim/contracts:test:       Tests  276 passed (276)
@pokatim/tracks:test:       Tests  302 passed (302)
@pokatim/api:test:       Tests  1166 passed (1166)
@pokatim/api-client:test:       Tests  98 passed (98)
@pokatim/admin:test:       Tests  282 passed (282)
@pokatim/app:test: Tests:       1208 passed, 1208 total
 Tasks:    15 successful, 15 total
exit=0
```

Первый прогон `pnpm check` упал только в `@pokatim/app#test` по таймаутам jest под нагрузкой машины (load average
~29, параллельные агенты; затем 1 флак `bottom-sheet.test.tsx` — тайминг жеста, файл не тронут). Отдельно `jest`
этого файла — 7/7, повторный `pnpm check` — зелёный (выше).

Отрицательные доказательства (временная правка `verified-profile.repository.ts`, затем возврат; файл сверен с копией):

- без `$or` (условия фиксации) в фильтре `PUT`: `verified-profile.int.test.ts` «после первой Verified-заявки…» и
  `verified-profile-locks.int.test.ts` «с записью анкеты…» — красные по результату: `expected [ 200, undefined ] to
  deeply equal [ 409, 'VERIFIED_DEMOGRAPHICS_LOCKED' ]`;
- `lockForEntry` = `findOne` (чтение без записи): «с записью анкеты в транзакции заявки…» — красный тем же
  результатом (`PUT` закоммитился, пол анкеты ≠ группе заявки).
- Постоянные тесты (а)/(б) в `verified-profile-locks.int.test.ts` фиксируют сломанный исход с подменой механизма.

### Open follow-ups

- Int-тесты v1-правил (результаты, протокол, споры) идут на гонке схемы `overall` (`corridorRace` по умолчанию
  ставит `groupScheme: 'overall'`, как гонки до 07); правила `gender_age` покрыты новыми тестами.
- `counts.attention` читает все строки с местом (живые — `buildProtocol`, для флагов скорости) и `_id` финишёров с
  флагами; при росте гонок — денормализованный счётчик.
- Golden флагов датчиков на реальных треках флагов не содержит (`"flags": []` у всех 4): калибровка порогов и golden
  с сработавшими флагами — на реальных заездах с пульсом после сбора данных на dev.
- Публичная таблица: группа, не относящаяся к схеме гонки (`?group=m_u40` в `overall`), — пустая страница, не 400.
- 07b (панель) и 07c (приложение) — по §11.2, §11.3.

### Фиксы ревью pass 1

По `findings-07a-codex.md` и `findings-07a-claude.md`:

- **[HIGH] фильтры панели до предела.** `ResultsPanelReadService.standingItems` фильтрует строки с местом (полный
  набор: места и `SPEED_CLUSTER_HIGH` — по всем ранжированным) и прочие заявки (`entriesForStandings` с фильтром
  `group`/`attention` в запросе) до `standingsMax`; `truncated` — по отфильтрованному набору. `counts.attention` —
  `attentionCount`: строки с местом и флагами + `attentionEntryIds` (финишёры с флагами) без предела и без сборки
  «Участников». Тест: `results-tiers.int.test.ts` «group/attention фильтруют до предела…» (1000 строк `m_u40`,
  женщина `w_u40` и START с флагами за пределом; был красным: `truncated` / пустая группа).
- **[MEDIUM] AC9 по сырому телу.** Ключи проверяются у `res.body` публичной таблицы (обе группы), финишёров и
  `GET /v1/races/:id/entry` (без `parse`): нет `flags`, `sensors`, `tier` (публичные), значений анкеты.
- **[LOW] `speedClusterFlags`:** времена группы — `push` одним проходом, медиана — раз на группу, минимум — `reduce`.
- **[LOW] база рывка:** `surgeNonResponseShare` оценивает рывок только при полном окне базы 60 с в сегменте
  (`t − 65 с ≥ startedAt`); тест «база рывка — только полные 60 с сегмента» (был красным). Golden не изменился —
  `FLAGS_VERSION` остаётся 1.
- **[LOW] курсор без `group`:** группа — у строки курсора (`entryGroupKey` живой таблицы, `groupKey` строки
  протокола), а не пересчитанное умолчание; тест «курсор без group — группа строки курсора…» (был `400`).
- **[LOW] pr.md:** запрос по `groupScheme: null` (информативно), агрегат попыток `counted` без `sensors` после
  миграции по гонкам и действие — «Перепроверить треки».
- **RC-3** — решение автора: спайк §3.2 «Группу ... фиксирует в заявке» и §5 S4 «группа фиксируется в заявке» (§8.1); golden флагов на реальных треках — в Open follow-ups.


`TURBO_CONCURRENCY=1 pnpm check` (MONGO `pokatim_r07_test`, Redis db 11) — `exit=0`, хвост:

```
@pokatim/tracks:test:       Tests  303 passed (303)
@pokatim/contracts:test:       Tests  276 passed (276)
@pokatim/api:test:       Tests  1168 passed (1168)
@pokatim/admin:test:       Tests  282 passed (282)
@pokatim/app:test: Tests:       1208 passed, 1208 total
 Tasks:    15 successful, 15 total
```

Предыдущий прогон упал на нетронутом `track-uploads.int.test.ts` «MEDIUM-6: > 16 МиБ через настоящий сокет»
(`fetch failed`, флак сокета под нагрузкой). Отдельно файл прошёл дважды (34/34), повторный `pnpm check` зелёный.

### Фиксы ревью pass 2

По `findings-07a-codex-pass2.md`:

- **[HIGH] импорт Garmin/Wahoo без пульса** (DV-11, решение автора 2026-10-27). `analyzeAttempt`: исходник
  `stream` — `sensors = { hr: hasHeartRate, power: hasPower, source: 'declared' }` из самого потока (граница модулей
  не нарушается: признак уже в `pokatim.stream.v1`), `flags: []`; файл — `source: 'samples'` и флаги как раньше.
  `SENSOR_SOURCES` (tracks) = `ATTEMPT_SENSOR_SOURCES` (contracts, сторож в `results-tiers.policy.test.ts`);
  `AttemptSensors.source` — `.default('samples')`; документ попытки `source?`, панель отдаёт `?? 'samples'`.
  Тесты: `parse.test.ts` «поток агрегатора…» (был красным), int `results-check.int.test.ts` «импорт Garmin/Wahoo…»:
  `hasHeartRate: true` → место 1 в `m_u40`, панель `source: 'declared'`; `false` → finisher `no_heart_rate`
  (оба были красными без фикса tracks), `tiers.schema.test.ts` — источник и default.
- **[MEDIUM] мощность 0.** `gpx.ts`/`fit.ts` сохраняют конечную неотрицательную мощность (пульс 0 — по-прежнему не
  отсчёт; TCX-парсера нет). Тесты: `gpx.test.ts`, `fit.test.ts` (FIT собран `Encoder` SDK), `sensor-flags.test.ts`
  «через разбор GPX: мощность 0…» (40 мин, 200 Вт → 0/100 Вт ⇒ `HR_POWER_DECOUPLED` 75; был красным). Golden флагов,
  рядов 06b (`series`) и `expected.json` не изменились — `FLAGS_VERSION` остаётся 1. Побочно: файл только с нулевой
  мощностью теперь `hasPower: true` (приоритет основной в группе дублей).
- Фикстура ответа `packages/api-client/src/admin.test.ts`: `sensors.source: 'samples'` (сервер отдаёт поле всегда).
- Документы: §8.2 DV-11, `pokatim-db.md` (попытка `sensors.source`), `races-and-seasons.md` (строка про импорт).

`TURBO_CONCURRENCY=1 pnpm check` (MONGO `pokatim_r07_test`, Redis db 11) — `exit=0`, `Tasks: 15 successful, 15 total`
(tracks 307, contracts 277, api 1171, api-client 98, admin 282, app 1208). Первый прогон упал только на фикстуре api-client.

## 12.2 07b — панель «Протокол»

### Changes

- «Результаты» гонки: KPI «Требует внимания» (`counts.attention`) и «Финишёры» (`counts.finishers`) — восемь плиток
  (`.stat-tiles--8`). «Участники»: вкладки групп — `ChipGroup` по `groups` ответа («Все группы» — запрос без `group`),
  «Только «Требует внимания»» — `ToggleChip` (`attention=true`); фильтры — на сервере и в ключе запроса
  (`standingsQuery(raceId, filter)`, `keepPreviousData`: при смене фильтра таблицы — скелетон, вкладки остаются и при
  ошибке, повтор — «Повторить» в таблице). Колонки «Группа», «Уровень», «Требует внимания» (`FlagList`: подпись кода из
  `admin.results.flag.*`, метрика подсказкой — «Время ×0,782 медианы группы», «18 % сегмента без пульса»). Пустой
  результат фильтра — «Нет участников по выбранным фильтрам».
- Финишёры: строки ответа с `unranked ≠ null` — отдельный блок «Финишёры — без места» (без колонки места, причина
  `results.unranked.*`), виден при `counts.finishers > 0`. Источник — тот же `getRaceStandings` (07a отдаёт финишёров в
  «Участниках»; отдельного панельного эндпоинта нет — §11.2). START-финишёры (`groupKey: overall`) видны во вкладке
  «Все группы», во вкладке группы — только Verified без пульса этой группы (фильтр `group` сервера).
- «Попытки»: колонки «Датчики» («Пульс, мощность» / «Пульс» / «Мощность» / «Нет» / «—») и «Требует внимания».
- «Попытки», DV-11 (после слияния 07a): импорт Garmin/Wahoo (`sensors.source: 'declared'`) — «Датчики» с пометкой
  «(заявлено импортом)», например «Пульс (заявлено импортом)» (`admin.results.sensors.declared`); флагов у таких
  попыток нет (`flags: []` от сервера), колонка «Требует внимания» пустая.
- Разбор спора: «Группа», «Уровень», «Требует внимания» цели (`target.groupKey/tier/flags`).
- «Пол и год» (`VerifiedDemographicsDialog`): кнопка только с `profiles.verified_edit` и у Verified в группе пол × возраст
  (у них анкета зафиксирована заявкой); GET текущих значений при открытии (`gcTime: 0`, скелетон полей, 404 — «Анкета
  Verified не заполнена», сеть/5xx — `ErrorState` с повтором); радио пола, год (проверка `VerifiedBirthYear` контракта,
  ошибка под полем), причина; «Сохранить» неактивна без изменений (`DisabledReason`), с неверным годом и без причины;
  PATCH — только изменённые поля + причина (`useMutation`: глобальные 401/403); ошибки в окне — 409 «Анкету изменили
  одновременно…», 403 «Нет доступа к этому действию.», 404, 400/422, 429. Вес, рост, FTP — не запрашиваются и не
  показываются. После сохранения — инвалидация журнала.
- i18n (`packages/i18n/src/ru.ts`, блоки `admin.results.*`, `admin.disputes.result.*`); правило
  `.claude/rules/pokatim-web.md` — абзац «Группы и флаги».
- Отклонение от `pokatim-web.md` «Формы — react-hook-form + zod»: окно пола и года — `useState` по образцу `ReasonDialog`
  / смены роли (`MembersScreen`), тело проверяет схема контракта `UpdateVerifiedDemographicsRequest` до отправки.

### Files touched

- `apps/admin/src/features/results/{RaceResultsScreen,StandingsTable,AttemptsTable}.tsx`,
  `results-{format,query,errors}.ts`; новые `FlagList.tsx`, `VerifiedDemographicsDialog.tsx`.
- `apps/admin/src/features/disputes/DisputeScreen.tsx`.
- `apps/admin/src/index.css` (`.stat-tiles--8`, `.flag-list` — только переменные дизайн-системы).
- `apps/admin/src/test/app.tsx` (`ME.admin` + `profiles.verified_edit`, как `ROLE_PERMISSIONS.admin`).
- `packages/i18n/src/ru.ts`; `.claude/rules/pokatim-web.md`.

### Tests

- `RaceResultsScreen.test.tsx` (+8 в describe «группы, уровни, «Требует внимания»»): KPI attention/finishers; строка с
  местом — группа, уровень, флаги с метрикой; финишёр — отдельный блок без места; вкладки и фильтр → запросы `{}` →
  `{ group }` → `{ group, attention }` → `{ attention }`; пустой фильтр; ошибка при смене фильтра — повтор, вкладки
  видны; схема `overall` — без вкладок и финишёров; попытки — датчики и флаги; «Пол и год» — у admin (Verified группы),
  нет у финишёра START и у модератора. Обновлены: скелетоны KPI 6 → 8, состав ячеек строки.
- `VerifiedDemographicsDialog.test.tsx` (6): загрузка — скелетон, затем пол/год/фиксация, без кг/см/Вт; без изменений —
  неактивна, PATCH только с `birthYear`; смена пола — только `gender`, год вне пределов — ошибка под полем; 409 и 403 —
  текст в окне; 404 — «Анкета Verified не заполнена»; нет сети — повтор.
- `DisputeScreen.test.tsx` (+1): группа, уровень, флаги цели с метрикой; без флагов — нет подписи.
- После слияния 07a: фикстуры `sensors` в `RaceResultsScreen.test.tsx` дополнены `source` (typecheck падал на
  обязательном поле); тест «попытки: датчики…» — третья попытка `source: 'declared'` → «Пульс (заявлено импортом)».

`pnpm --filter @pokatim/admin test` — 34 файла, 297 тестов; `typecheck`, `eslint`, `build` — зелёные.
После слияния 07a и DV-11: `pnpm --filter @pokatim/admin test` — 35 файлов, 300 тестов; `typecheck`, `eslint
--max-warnings=0` (results, i18n), `prettier --check` изменённых файлов — зелёные; полный `pnpm check` не прогонялся.
`TURBO_CONCURRENCY=1 pnpm check` (MONGO `pokatim_r07b_test`, Redis db 12) — `exit=0`, `Tasks: 15 successful, 15 total`.
