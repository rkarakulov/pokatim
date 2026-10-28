# 1. Title

Результат гонки, слайс 08: рейтинг сезона — модуль `standings`, таблицы «класс × группа», очки за место, место в
профиле.

# 2. Goal

Эпик `docs/tasks/2026-10-27-race-results/epic.md` §3.6 и §7 (строка 08), решение A9; спайк
`docs/tasks/2026-10-27-race-results/spike-07-08.md` §4 и §5 (S9–S13) — **решения автора, не пересматриваются**;
продукт `docs/product/races-and-seasons.md` («Рейтинг сезона»).

Сейчас экран сезона показывает только гонки; таблицы сезона и места нет (Q1/Q2 блока app-03 — «скрыто до FR-4»).
После слайса:

- сервер считает таблицы сезона по опубликованным протоколам (только Verified-строки снимка) и хранит снимок
  пересчёта;
- приложение показывает таблицу сезона (класс × группа), свою строку «Вы» и блок «Сезон» в профиле;
- панель видит таблицы сезона и время последнего пересчёта.

Слайс 07 (уровни, группы, `race_protocol_rows.groupKey`) уже в `develop` (PR #73, #75, #76) — 08 читает его данные.

Источники: `AGENTS.md` §1, §4; ADR-0010 (сезоны), ADR-0012 (результаты), ADR-0015 (удаление аккаунта), ADR-0017 п. 5
(fan-out outbox); `.claude/rules/{pokatim-backend,pokatim-db,pokatim-contracts,pokatim-security,pokatim-tests,pokatim-app,pokatim-web}.md`.
Код сверен по `origin/develop` @ `8ed9d9b` (ветка `feature/race-results-08`).

# 3. Scope

Поставка — **три PR в `develop` по очереди**, каждый зелёный сам по себе:

- **08a — модель, API, worker** (contracts, api-client, i18n, `apps/api`, миграция);
- **08b — панель** (`apps/admin`);
- **08c — приложение** (`apps/app`).

## 3.1 Правила зачёта (решения автора, S9–S13)

| Правило | Значение |
|---|---|
| Очки за место (Ф1) | 1 → 100, 2 → 85, 3 → 75, 4 → 67, 5 → 60, 6 → 54, 7 → 49, 8 → 45, 9 → 41, 10 → 38, далее −2 за место (11 → 36 … 28 → 2), 29-е и ниже → 1 |
| Ничья в гонке | «=N» — каждому очки места N (место берётся из строки протокола как есть) |
| Таблица | ключ `(seasonId, bikeClass гонки, groupKey строки протокола)`; в зачёт — только строки снимка протокола (Verified; START и «без пульса» в снимок не входят) |
| M | число гонок таблицы с **опубликованным** протоколом: гонки сезона того же класса, схема групп которых даёт этот `groupKey` (`gender_age` — шесть групп, `overall` — `overall`). Гонка без строк в группе всё равно входит в M этой группы. Отменённые не входят (у них нет протокола, D-19) |
| N | `N = M − ⌊M/3⌋` (M = 1–2 → все, 3–5 → минус 1, 6–8 → минус 2) |
| Результаты райдера в гонке | `final`/`revised` с местом → очки места; `dq` → 0, **не выбрасывается**; нет строки (dns, снят, START, не в группе) → 0, выбрасывается как пропуск |
| Сумма | DQ-нули занимают слоты первыми (не выбрасываются), остальные слоты (до N) — лучшие очки остальных гонок |
| Ничья в сезоне | равные суммы → больше лучших мест среди засчитанных (сравнение отсортированных мест засчитанных гонок: больше первых, затем вторых …; «=2» считается 2-м, DQ — без места); не разбилось → общее «=N» |
| Кто в таблице | у кого есть хотя бы одна строка снимка в этом классе и группе (в т. ч. только DQ — 0 очков) |
| Порядок строк | место, затем стабильно по `userId` (внутри «=N») |
| Минимум участия | нет (решение по рекомендации) |
| Формула | константа сервера `STANDINGS_FORMULA_VERSION = 1` в снимке; смена версии — полный пересчёт всех сезонов |

Проверка формулы — пример спайка §4.1–4.2 (Аня/Боря/Вера «=1» по 185, Гена 4-й 160, Дима 5-й 75) как golden-тест.

## 3.2 Пересчёт: как узнаём об изменениях (решение автора сессии, DV-1)

Outbox базы (`@rkarakulov/api-kit` 0.5.0, `OutboxRoutes = Record<string, string>`) ведёт тип события в **одну**
очередь; `results.protocol-published` и `results.result-revised` уже уходят в `notifications-intake` (ADR-0017 п. 5).
Fan-out — задача в app-foundation (отдельный репозиторий, релиз и `copier update`) — **в 08 не делается**.

Решение 08: **сверка по регламенту** вместо событий — worker `standings` каждую минуту (и разово при старте)
сравнивает «отпечаток» источника сезона (гонки сезона с опубликованным протоколом, их текущие ревизии, класс, схема,
версия формулы) с отпечатком последнего снимка и пересчитывает только изменившиеся сезоны **полностью**. Задержка
таблицы после публикации или пересчёта протокола — до ~1 минуты. Плюсы: `results` и его транзакции не меняются,
накопленные до выката протоколы попадают в таблицу без отдельного бэкфилла, пропущенный пересчёт лечится сам. Когда
fan-out появится в базе, регламент можно заменить подпиской на события (follow-up).

Альтернатива ADR-0017 «второе событие из `results`» отклонена для 08: дублирует источник и всё равно требует бэкфилла.

## 3.3 08a — contracts, api-client, i18n

- `packages/contracts/src/standings/*` (новый раздел): схемы ответов (ниже), `STANDINGS_PAGE_SIZE`, коды. Группы —
  `RESULT_GROUP_KEYS`, классы — `BIKE_CLASSES` (tolerant enum в ответах).
- Публичные (без входа, `PublicReadGuard`, `public, max-age=60`):
  - `GET /v1/seasons/:id/standings` — сводка: `computedAt | null`, список таблиц `{ bikeClass, groupKey, riders,
    racesTotal (M), racesCounted (N) }`; опубликованный сезон без протоколов — пустой список; неизвестный сезон — `404`.
  - `GET /v1/seasons/:id/standings/table?bikeClass=&group=&cursor=` — заголовок (гонки таблицы по концу окна: id,
    название, `windowEndsAt`), M, N, `computedAt`, строки страницы: `order`, `place`, `tied`, `riderName | null`
    (порт `RIDER_NAMES`, только с согласием — как публичная таблица гонки), `points`, ячейки по гонкам `{ raceId,
    place | null, tied, outcome: 'placed' | 'dq' | 'none', points, counted }`. Без `userId`. Курсор — `src/page-cursor.ts`.
- Приложение (`AuthGuard`, `no-store`): `GET /v1/seasons/:id/standings/me` — свои строки во всех таблицах сезона:
  `{ bikeClass, groupKey, order, place, tied, points, riders, racesTotal, racesCounted, cells }` (для «Вы» в таблице и
  блока профиля). Нет строк — пустой список.
- Панель (`PanelGuard` + `races.read`): `GET /v1/admin/seasons/:id/standings/table?bikeClass=&group=&cursor=` — то же,
  что публичная таблица, плюс `userId` строки и имя по тем же правилам, что «Участники» панели; сводка — с
  `computedAt`, `formulaVersion`, отпечатком «актуален / ждёт пересчёта».
- `packages/api-client` — методы; `packages/i18n` — подписи групп уже есть (07), новые строки экранов.

## 3.4 08a — `apps/api`

- Новый модуль `src/modules/standings/` (контекст «рейтинг сезона», epic §3.7 `results ──► standings`):
  - чистая политика `standings.policy.ts` (очки, N, сумма, ничьи) — unit-тесты, golden — пример спайка;
  - коллекции снимка (`season_standings*`, форма — architect: на таблицу или на сезон; снимок пишется целиком;
    устаревший пересчёт не перезаписывает более новый — условие в фильтре или замок);
  - регламент `standings.sync` (BullMQ, очередь `standings-recalc`), `StandingsWorkerModule` в `WorkerModule`;
  - публичный и панельный контроллеры, сервис чтения; имена — порт `profile` `RIDER_NAMES` (как `results`).
- Порты (только через `index.ts`, без чтения чужих коллекций):
  - `races` → сезоны и гонки сезона с опубликованным протоколом (`seasonId`, `bikeClass`, `groupScheme`, название,
    `windowEndsAt`, `protocolPublishedAt`) — расширение существующего порта или новый `SeasonRaces`;
  - `results` → текущая ревизия протоколов гонок и строки снимка этой ревизии (`userId`, `place`, `tied`, `status`,
    `groupKey ?? 'overall'`) — новый порт `ResultsForStandings`.
- Миграция (номер — следующий свободный на момент слияния): коллекции и индексы снимка.
- Удаление аккаунта: снимок хранит только псевдонимный `userId` и числа, как `race_protocol_rows` (A9: протоколы
  остаются); имя читается при каждом запросе — удалённый становится «Участник». Порт стирания **не нужен** — architect
  подтверждает в §8.1 (правило «новый модуль с данными пользователя → порт стирания»).

## 3.5 08b — панель «Протокол»

- В разделе «Сезоны» — экран сезона с вкладкой «Рейтинг»: переключатели класса и группы (только существующие
  таблицы), таблица (место, участник — имя или `Участник ·<id>`, очки, ячейки гонок с DQ), время пересчёта и
  «Ждёт пересчёта», пустое состояние, скелетон, ошибка с повтором. Только чтение (`races.read`).

## 3.6 08c — приложение

- Экран сезона `/seasons/<id>` — раздел «Таблица сезона» (сейчас скрыт, Q2 app-03): подзаголовок «{даты} · по
  последнему пересчёту»; два сегментных переключателя — класс и группа (только существующие таблицы; открыт на своей
  таблице вошедшего, иначе на первой); заметка «В зачёт идут финальные результаты Verified: лучшие N из M гонок. DQ —
  0 очков и не выбрасывается.»; «{группа} · {класс} · N участников»; строки: место («=6»), имя или «Участник», очки;
  своя строка — «Вы» (по `order` из `/me`), подгрузка страниц. Пусто — «Сезон только начался» + «Результаты появятся
  после первого протокола.» + «К гонкам».
- Вкладка «Гонки» — действие «Таблица сезона» → экран текущего сезона (если сезон есть).
- «Профиль» — блок «Сезон {название}»: своя строка (место, очки, «{группа} · {класс}»), «Вся таблица» → экран
  сезона; список гонок своей таблицы: место, очки, «в зачёте» / «не в зачёте» / DQ. Нет строк — блок скрыт.
- Только дизайн-система `@rkarakulov/ui` и токены темы (7 тем, ADR-0016), без хардкода цветов; i18n; a11y
  (место «=6» — «шестое место, ничья»); iOS, Android, web (SSR экрана сезона — публичные данные).

# 4. Out of Scope

- Fan-out outbox в app-foundation и подписка `standings` на события протокола (follow-up, §3.2).
- Уведомления о смене места в сезоне.
- Ручной «Пересчитать» в панели (регламент пересчитывает сам; смена формулы — версией).
- Индекс силы K1, деление групп по силе, тренеры и аватары в строках (в прототипе есть — данных нет).
- Шаринг и OG-картинка таблицы.
- Минимум участия, настройки N в панели.

# 5. Architecture Context

- Приложения/пакеты: `contracts`, `api-client`, `i18n`, `api` (`standings` — новый, `races`, `results`, `profile`
  порты, миграция), `admin`, `app`.
- Зависимости: `standings → races, results, profile, panel` только через `index.ts`; `results`/`races` о `standings`
  не знают (циклов нет).
- Тяжёлая работа — только worker (пересчёт); HTTP читает снимок.
- Contracts: tolerant enum в ответах, новые значения — в конец.
- (architect) Модули Nest: `StandingsCoreModule` (репозиторий, источник, пересчёт; imports `RacesCoreModule`,
  `ResultsCoreModule`), `StandingsModule` (API: + `IdentityModule`, `PanelModule`, `ProfileCoreModule`),
  `StandingsWorkerModule` (очередь `standings-recalc`). Новые порты: `SEASON_RACES` (`races`), `RESULTS_FOR_STANDINGS`
  (`results`); `standings` также импортирует `identity` (`AuthGuard`) — только через `index.ts`.
- (architect) Новый пакет не нужен (потребитель контрактов — уже существующие пакеты); кандидатов в app-foundation нет.

## 5.1 Placement & Reuse Gate

- Переиспользуем: `PublicReadGuard`, `PUBLIC_READ_CACHE_CONTROL`, `page-cursor.ts`, порт `RIDER_NAMES`,
  `PanelGuard`/`RequirePermission`, расписания BullMQ как в `routes-maintenance`/`notifications-maintenance`,
  `MongoTransactions`, `@rkarakulov/ui` (`SegmentedControl`, строки таблиц, `AsyncContent`, скелетоны), формат мест
  `=N` из таблицы гонки (`results-table.tsx`, `participation-format.ts` `resultRow`), подписи групп и классов из i18n.
- (architect) Ещё переиспользуем: `ResultsRepository.withSnapshot`-подход (снимок чтения), `isDuplicateKey`,
  `ensureCollection`, `useHeaderSeason` (сезон кнопки «Гонки» и блока профиля), `riderLabel`/`placeLabel` панели,
  `ChipGroup`/`DataTable`/`StatusTag`/`EmptyState`/`ErrorState` из `apps/admin/src/ui`, ключи
  `races.results.{you,rider,more,tiePlace,tiedA11y}`. Имена контрактов `PanelRaceStandings*` заняты (RC-15).
- Политика — чистые функции модуля `standings` (сервер — источник правды); клиент ничего не считает.
- Запрещено: чтение `race_protocol_rows`/`races` из `standings` напрямую, копии DTO, `userId` в публичных ответах,
  хардкод цветов, `Platform.OS` в экранах.

# 6. Relevant Files

- `packages/contracts/src/{results/results.schema,races/race.schema,admin/permissions.schema}.ts`, `index.ts`
- `apps/api/src/modules/results/{results.collection,results.repository,results-read.service,index}.ts`
- `apps/api/src/modules/races/{race-registry.port,race-registry,races.repository,races.collection,races-public.controller,index}.ts`
- `apps/api/src/modules/profile/{rider-names.port,index}.ts`
- `apps/api/src/modules/notifications/notifications-maintenance.processor.ts`, `routes` — образцы регламента
- `apps/api/src/{worker.module,app.module,queues,page-cursor,public-read.guard}.ts`, `db/migrations/*`
- `apps/admin/src/features/seasons/*`, `features/results/*`
- `apps/app/src/app/seasons/[id].tsx`, `features/races/{season-detail,results-table,format,queries}.tsx`,
  `app/(tabs)/races.tsx`, `app/settings/profile.tsx`

# 7. Implementation Notes

- Отпечаток сезона — детерминированная строка/хеш по отсортированным `(raceId, revision, bikeClass, groupScheme)` и
  `STANDINGS_FORMULA_VERSION`; совпал — пересчёта нет.
- Текущая ревизия протокола — максимальная `revision` журнала `race_recalculations` гонки (как в `results`).
- Пересчёт сезона — один проход: строки текущих ревизий всех гонок сезона → таблицы → запись снимка целиком.
- Две задачи пересчёта одного сезона (два worker) не должны откатить снимок к старому: условие на отпечаток/версию
  в записи (architect).

# 8. Risks / Assumptions / Open Questions

- R1. Задержка таблицы до ~1 мин после публикации (регламент вместо событий, DV-1). Приемлемо для сезонного зачёта.
- R2. Регламент раз в минуту читает гонки с протоколами и журнал ревизий — нужен индекс/проекция (architect), при
  сотнях гонок — дёшево.
- R3. Гонки сезона с обеими схемами (`overall` до 07 и `gender_age`) — `overall` отдельной таблицей (спайк §4.3).
- A1. Сезон и класс опубликованной гонки после первой заявки не меняются (V-12) — architect проверяет; если меняются,
  отпечаток их учитывает (уже включены).
- A2. Прототип: «DQ не входят в сумму, пометки нет» — устарел, действует решение S11 (0 и не выбрасывается); DQ
  показывается в ячейке/списке гонок как «DQ · 0».
- DV-1. Пересчёт по регламенту, а не по событиям (§3.2) — решение сессии в рамках ADR-0017 п. 5.

## 8.1 Requirements Consistency (заполняет architect)

Architecture Review — race-results-08 (08a): **CONCERNS (не блокирующие)**. Блокеров нет; решения ниже приняты
architect по коду `origin/develop` @ `8ed9d9b` и действуют, пока автор не скажет иначе. DV-1 (регламент вместо
событий) и правила §3.1 не пересматривались — по коду противоречий с ними нет.

- **RC-1. A1 подтверждено кодом: источник гонки с протоколом неизменен.** `seasonId` пишет только публикация и
  `RacesService.update` при смене `windowEndsAt` (`seasonFor`), а `windowEndsAt` и `bikeClass` входят в
  `LOCKED_BY_ENTRIES` (`races.policy.ts`), фаза `final` разрешает только `description` (`FINAL_FIELDS`); сжатие сезона
  не выбрасывает гонки (`racesOutside`); отмена после протокола запрещена (D-19, фильтр `protocolPublishedAt: null`);
  `groupScheme` пишет только `admitEntry` (первая заявка, после окна заявок нет). Название тоже неизменно в `final` —
  снимок хранит `title`, на чтении гонки не дочитываются. Отпечаток всё равно включает класс и схему (страховка).
  Следствие: набор гонок сезона с протоколом только растёт, ревизии только растут — это даёт монотонную версию
  источника (RC-5).
- **RC-2. Гонка с протоколом без заявок — `groupScheme: null`** (`toRace`: `?? (lockedAt ? 'overall' : null)`;
  пустой протокол публикуется без строк). Решение: в порте `SeasonRaces` такая гонка — `gender_age` (её получила бы
  первая заявка, как `MyRaceEntry.groupScheme`); она входит в M шести групп своего класса — по правилу §3.1 «гонка без
  строк в группе всё равно входит в M». Альтернативы: (б) не входит ни в одну M (протокол есть, а в зачёте её нет —
  расходится с правилом); (в) `overall` (создаёт «общую» M у класса без overall-гонок). Рекомендация — (а).
- **RC-3. Текущая ревизия и её строки.** Текущая ревизия — максимальная числовая `revision` журнала
  `race_recalculations` (`ResultsRepository.currentRevision`, не строк); строки ревизии и запись журнала вставляются
  в одной транзакции (`writeRevision`), публикация — там же с `markProtocolPublished`. Для регламента — пакетный
  метод: один `aggregate` `{ $match: { raceId: { $in }, revision: { $type: 'number' } } }` → `$group $max` (предикат
  совпадает с частичным фильтром `race_recalculations_revision_unique (raceId, revision)` — индекс пригоден); строки —
  `find({ raceId, revision })` по `race_protocol_rows_order_unique` с проекцией `userId, place, tied, status,
  groupKey` (`groupKey ?? 'overall'`, RC-8 07). Гонка с протоколом без ревизии (быть не должно) — исключается из
  прогона с логом `standings.revision_missing race=<id>`. Порт — `ResultsForStandings` (§11.1).
- **RC-4. Индекс для выборки гонок с протоколом — нужен.** `protocolPublishedAt` не индексирован; есть
  `races_season_public_idx (seasonId, windowEndsAt, _id)` и `races_season_idx`. Регламент раз в минуту читает **все**
  гонки с протоколом по всем сезонам — без индекса это полный проход `races` каждую минуту. Решение: частичный
  `races_protocol_idx { seasonId: 1, windowEndsAt: 1, _id: 1 }`, `partialFilterExpression: { protocolPublishedAt:
  { $type: 'date' } }` (миграция 08a); запрос порта обязан содержать ровно `protocolPublishedAt: { $type: 'date' }`.
  Журнал ревизий — существующий частичный индекс (RC-3); строки — существующий уникальный индекс.
- **RC-5. Защита снимка от отката двумя параллельными пересчётами.** Повтор задачи, разовый прогон при старте и
  несколько worker дают параллельные пересчёты одного сезона; «прочитать заголовок → сравнить → записать» — гонка.
  Решение: монотонная версия источника `sourceVersion = Σ текущих ревизий гонок сезона` (по RC-1 любое изменение её
  строго увеличивает: новая гонка — ≥ +1, новая ревизия — ≥ +1) и `formulaVersion`. Запись снимка — одна транзакция
  `MongoTransactions.run`: **первая** операция — условный upsert заголовка `season_standings` (`_id = seasonId`,
  фильтр `$or: [{ formulaVersion: { $lt: f } }, { formulaVersion: f, sourceVersion: { $lt: s } }]`), затем
  `deleteMany` строк сезона и `insertMany` новых. Существующий более новый (или равный) заголовок → фильтр не
  совпал → вставка с тем же `_id` → `isDuplicateKey(error, '_id_')` → итог `stale`, транзакция откатывается целиком
  (строки не тронуты). Две транзакции одновременно — конфликт записи заголовка, повтор проигравшей видит новую
  версию → `stale`. Альтернативы: (б) замок Redis на сезон (не защищает от задачи, начатой раньше и закончившей
  позже — устаревший результат всё равно перезапишет); (в) поколения строк без транзакции (сложнее: чтение должно
  выбирать поколение, уборка поколений — своя гонка). Рекомендация — (а). Отрицательное доказательство — int-тест
  (§11.1 TEST MATRIX). Откат деплоя к меньшей `formulaVersion` — старый worker получает `stale` на каждом прогоне
  (только лог), снимок не портится.
- **RC-6. Порт стирания для `standings` не нужен — подтверждаю.** Снимок — производная проекция `race_protocol_rows`
  (A9: строки протокола с псевдонимным `userId` остаются после удаления аккаунта, `pokatim-db.md` «Удаление
  аккаунта»); в снимке нет имён, e-mail, биометрии — только `userId`, места, очки. Имя читается при каждом запросе
  через `RIDER_NAMES` — после `ProfileErasure` (удаление `profiles`) строка становится «Участник». Стирание снимка
  противоречило бы протоколу (таблица разошлась бы с протоколами, а следующий пересчёт вернул бы строки). Правило
  «новый модуль с данными пользователя → порт стирания» — формально задевает; решение: явное исключение в
  `pokatim-db.md` (как `platform_settings`: «порт стирания не нужен» с обоснованием), шага в `AccountErasureService`
  нет. Альтернатива — порт-no-op ради правила (мёртвый код) — не делаем.
- **RC-7. «Черновой сезон» не существует — AC-8 поправлен.** У сезона нет статуса публикации (Q5 admin-02,
  `RacesPublicService.getSeason`: любой существующий сезон — `200`, неизвестный — `404`). Видимость `standings` — та
  же: порт `SeasonRaces.seasonExists(id)` (через `RacesRepository.findSeason`), неизвестный — `404 NOT_FOUND` до
  разбора курсора (как `listSeasonRaces`); невалидный `:id` — `400` (`Uuid` pipe). Формулировка AC-8 «черновой/неизвестный
  сезон — 404» → «неизвестный сезон — 404» (DV-2).
- **RC-8. Имена и `userId` в панели.** «Участники» панели берут имя через `RIDER_NAMES.publicNames` (только с
  согласием, `ResultsPanelReadService`), подпись без имени — `Участник ·<последние 6 символов>` (`riderLabel`,
  `admin.results.rider`; там — `entryId`). В рейтинге сезона заявки нет — подпись по `userId`. Но сезон — сквозной по
  гонкам разных организаторов, а организатор (`races.manage` без `races.manage_any`, `ownScope`) в панели видит
  только свои гонки (`pokatim-security.md`: «чужая гонка организатора — 404», наружу `userId` — только своей гонки).
  Решение: `userId` в строках панели — только сотруднику, видящему все гонки (`!ownScope`: admin, moderator); организатору
  — `userId: null`, подпись «Участник» без id (имя — по тем же правилам согласия). Проверка — метод порта
  `SeasonRaces.seesAllRaces(principal)` (политика `ownScope` остаётся в `races`). Альтернативы: (б) отдавать `userId`
  всем с `races.read` (псевдоним, но обходит видимость гонок организатора); (в) таблица сезона в панели только с
  `races.manage_any` (организатор теряет рейтинг совсем). Рекомендация — (а).
- **RC-9. AC-10 «без права — 403» недостижим текущими ролями**: `races.read` есть у admin, moderator и organizer
  (`ROLE_PERMISSIONS`). Проверяется: без сессии панели — `401`, access-токен райдера вместо сессии панели — `401`,
  три роли — `200` (organizer — `userId: null`), маршрут под `PanelGuard` + `RequirePermission('races.read')` —
  тест `admin-routes`. 403 — только метаданными (`RequirePermission`), отдельного теста роли нет (DV-3).
- **RC-10. Выбор засчитанных гонок при равных очках недоопределён и влияет на разбивку ничьей.** Места 29+ дают одно
  и то же очко (1), а разбивка (S12) сравнивает места засчитанных. Решение: кандидаты в слоты сортируются: DQ первыми
  (по порядку гонок), затем «с местом» по `(points desc, place asc, windowEndsAt asc, raceId asc)`; в зачёт — первые
  N среди DQ и «с местом»; «нет строки» (`none`) никогда не `counted` (0 очков, «не в зачёте»), лишние DQ сверх N —
  `counted: false` (сумма та же — 0). Разбивка ничьей — по отсортированному по возрастанию списку мест засчитанных
  гонок «с местом» (DQ мест не имеет), лексикографически, отсутствующая позиция = +∞ — это ровно «больше первых,
  затем вторых …» (и «больше мест» при равенстве префикса).
- **RC-11. «Вы» по `order` из `/me` при разном кэше.** Публичная таблица — `public, max-age=60`, `/me` — `no-store`:
  ответы могут быть от разных снимков, и `order` укажет на чужую строку. Решение: оба ответа несут `computedAt`;
  приложение метит «Вы» только при совпадении `computedAt` таблицы и `/me` (иначе — без метки и `refetch` таблицы).
  Альтернатива — `userId`-хеш в публичной строке (ломает правило «без `userId` в публичных ответах») — нет.
- **RC-12. Таблица, которой нет в снимке** (`?bikeClass=&group=` не из сводки — например, единственная строка группы
  ушла из протокола новой ревизией, а сводка в кэше). Решение: `200` с пустой страницей (`riders: 0`, `racesTotal: 0`,
  `racesCounted: 0`, `races: []`, `items: []`, `computedAt` снимка), не `404` — приложение не уходит в «Не удалось
  загрузить» из-за минутного расхождения кэшей.
- **RC-13. Как регламент находит изменения.** Каждую минуту: гонки с протоколом (порт `races`, индекс RC-4) →
  текущие ревизии одним `aggregate` (RC-3) → отпечаток по сезону → проекция заголовков снимка (`_id`, `fingerprint`)
  → пересчёт только сезонов с другим отпечатком. Сезон без гонок с протоколом снимка не получает (сводка —
  `computedAt: null`, пустой список). Отказ одного сезона не останавливает остальные; после прохода при отказах
  задача падает (`standings.sync_failed failed=<n>` в логе и failed-набор BullMQ), следующий прогон через минуту
  повторяет. Задача идемпотентна: повтор без изменений — без записи; с изменениями — тот же итог (RC-5).
- **RC-14. «Ждёт пересчёта» в панели** — сводка панели считает отпечаток источника сезона тем же кодом, что
  регламент (`StandingsSource.seasonSource`), и сравнивает с заголовком: `sync: 'current' | 'pending'` (`pending` —
  есть гонки с протоколом, а снимка нет или отпечаток другой). Панель — `no-store`.
- **RC-15. Имена контрактов заняты:** `PanelRaceStandings`, `PanelStandingRow`, `PanelRaceStandingsQuery` — это
  «Участники» гонки (07), в `ResultsRepository` есть `entriesForStandings`/`StandingsFilter`. Решение: новые схемы —
  префикс `SeasonStandings*` / `PanelSeasonStandings*` / `MySeasonStandings`, раздел `packages/contracts/src/standings/`.
- **RC-16. Объём.** Строка таблицы несёт ячейку на каждую гонку таблицы (M), страница ≤ 100 строк; снимок сезона
  пишется одной транзакцией (`deleteMany` + `insertMany` всех строк сезона: райдеры × таблицы, на dev — единицы
  сотен). Принято; лог `rows=<n>` и follow-up, если сезон превысит ~10 000 строк (тогда — пакетная запись поколений).
- **RC-17. Экран сезона в приложении — два списка с подгрузкой.** Гонки сезона уже грузятся по `onEndReached`
  `FlatList`. Таблица сезона — блок в шапке списка над «Гонками сезона» с «Показать ещё» (`races.results.more`,
  как таблица гонки), не по `onEndReached`.
- **RC-18. Какой сезон в «Профиле».** Решение: тот же, что кнопка сезона вкладки «Гонки» — `useHeaderSeason`
  (текущий; между сезонами — ближайший предстоящий, иначе последний завершённый); своих строк нет — блок скрыт.
  «Профиль» — экран `/settings/profile` (вход — иконка Главной, `docs/product/profile.md`).
- **RC-19. Вкладки в панели.** Компонента вкладок в `apps/admin/src/ui` нет, а вкладка одна. Решение: экран сезона
  `/seasons/$seasonId` с разделом «Рейтинг» без компонента вкладок (нет «на вырост», §4.9); вкладки — когда появится
  второй раздел. Вход — ссылка-название в таблице «Сезоны».
- Конфликтов с инвариантами §4 нет: очки, N, ничьи и места считает только сервер (`standings.policy.ts`), клиент
  шлёт только выбор таблицы и курсор; тяжёлая работа — worker; модули — через `index.ts`, `results`/`races` о
  `standings` не знают; миграция expand-only.

## 8.2 Deviations from spec

Отклонения, принятые architect (08a):

- DV-1 — §3.2 (решение сессии, не пересматривается).
- DV-2 (RC-7): AC-8 — «неизвестный сезон — 404» (черновых сезонов нет).
- DV-3 (RC-9): AC-10 — вместо «без права — 403» проверяются `401` без сессии панели / с токеном райдера, `200` трёх
  ролей и метаданные гарда (`admin-routes`).
- DV-4 (RC-8): `userId` в строках панели — только при `!ownScope` (admin, moderator); организатору — `null`.
- DV-5 (RC-2): гонка с протоколом без заявок (`groupScheme: null`) считается `gender_age`.
- DV-6 (RC-12): таблица не из снимка — `200` с пустой страницей, не `404`.
- DV-7 (RC-19): в панели — экран сезона с разделом «Рейтинг» без компонента вкладок.
- DV-8 (RC-4): новый частичный индекс `races_protocol_idx` в коллекции модуля `races` (миграция 08a).

## 8.3 Security checklist

AuthN/AuthZ: публичные чтения — только опубликованный сезон (как `GET /v1/seasons/:id`), `PublicReadGuard`;
`/me` — `AuthGuard`, пользователь из access; панель — `PanelGuard` + `races.read`. Входные данные: `Uuid` пути, enum
класса и группы, курсор — `page-cursor.ts`, строгие схемы. Наружу: без `userId` в публичных ответах, имя — только с
согласием (`RIDER_NAMES`); без биометрии, без флагов «Требует внимания». Злоупотребления: IP-лимит `public-read`,
пределы страницы. Логи — id сезона, число таблиц, длительность; без имён. Аудит — действий записи нет.

# 9. Acceptance Criteria

08a:
1. Golden: пример спайка §4.1 → Аня/Боря/Вера «=1» 185, Гена 4 — 160, Дима 5 — 75 (DQ не выброшен).
2. Таблица очков: 1…10, 11 → 36, 28 → 2, 29 → 1, 100 → 1; ничья «=2» → очки 2-го.
3. N из M: M = 1, 2, 3, 5, 6, 8, 9 → N = 1, 2, 2, 4, 4, 6, 6.
4. DQ при M = 3: занимает слот; два DQ при N = 2 → сумма 0; dns выбрасывается.
5. Ничья в сезоне: разбивается по лучшим местам; не разбилась — «=N», следующее место — N + число равных.
6. Разделение: класс × группа; гонка `overall` → таблица `overall`; гонка другого класса в M не входит; гонка без
   строк группы входит в M группы.
7. Регламент: публикация протокола → снимок появляется после прогона; DQ после публикации (новая ревизия) →
   снимок обновлён; без изменений — запись не делается (отпечаток); две параллельные задачи — снимок не откатывается
   (int-тест).
8. Публичные ответы — без `userId`, имя только с согласием; черновой/неизвестный сезон — `404`; ключи ответа — тест.
9. `/me` — только свои строки; без входа — `401`.
10. Панель: `races.read` — ок; без права — `403`; маршрут под `PanelGuard` (тест `admin-routes`).
11. Миграция идемпотентна (`migrations.int.test.ts`).

08b: вкладка «Рейтинг» сезона, переключатели, таблица, пусто/загрузка/ошибка; тесты компонентов.

08c: таблица сезона на экране сезона (переключатели, «=N», «Вы», подгрузка, пустой сезон), действие «Таблица сезона»
во вкладке «Гонки», блок «Сезон» в профиле; 7 тем без хардкода; iOS/Android/web; тесты компонентов.

Все: `TURBO_CONCURRENCY=1 pnpm check` зелёный; два независимых ревью (Claude, Codex) — APPROVE; выкат на dev и
проверка на синтетических аккаунтах.

# 10. Documentation Impact

- `docs/product/races-and-seasons.md` — экран сезона с таблицей, блок профиля (убрать «скрыто до FR-4»).
- `.claude/rules/pokatim-backend.md` — модуль `standings`, порты, регламент; `pokatim-db.md` — коллекции снимка;
  `pokatim-security.md` — публичные чтения таблицы; `pokatim-contracts.md` — схемы `standings`.
- `docs/product/notifications.md` / ADR-0017 — отметка: 08 обошёлся регламентом, fan-out — follow-up.
- `epic.md` — статус слайса 08.
- (architect) `pokatim-db.md`: `season_standings` / `season_standing_rows` — проекция, заменяется целиком в одной
  транзакции под условием версии (RC-5), не append-only; **исключение из правила порта стирания** с обоснованием
  (RC-6); индекс `races_protocol_idx` и миграция `0030_standings`.
- (architect) `pokatim-security.md`: публичные таблицы сезона без `userId`, `/me` — `AuthGuard`, панель — `userId`
  только при `!ownScope` (RC-8). `pokatim-backend.md`: регламент `standings-recalc` каждую минуту + boot-задача,
  порты `SEASON_RACES`, `RESULTS_FOR_STANDINGS`. `pokatim-contracts.md`: раздел `standings`, курсор `order`.

# 11. Implementation Context (заполняет architect)

## 11.1 08a — модель, API, worker

### ENTRY POINTS

- Worker: расписание `standings.sync` (`* * * * *`, `Europe/Minsk`) и разовая `standings.sync.boot` при старте →
  `StandingsSyncProcessor` (очередь `standings-recalc`) → `StandingsRecalc.sync()`.
- HTTP (префикс `/v1`):
  - `GET seasons/:id/standings` — `StandingsPublicController.summary` (`PublicReadGuard`, `public, max-age=60`);
  - `GET seasons/:id/standings/table` — `StandingsPublicController.table` (то же);
  - `GET seasons/:id/standings/me` — `StandingsMeController.mine` (`AuthGuard`, `no-store`);
  - `GET admin/seasons/:id/standings` и `GET admin/seasons/:id/standings/table` — `StandingsAdminController`
    (`PanelGuard` + `RequirePermission('races.read')`, `no-store`).
- Порядок маршрутов: публичный контроллер `@Controller('seasons/:id/standings')` — `@Get()` и `@Get('table')`;
  `me` — отдельный контроллер (гард класса другой) `@Controller('seasons/:id/standings')` с `@Get('me')`. Все сегменты
  после `standings` статические, параметрических соседей нет; с `RacesPublicController` (`seasons/current`,
  `seasons/:id`, `seasons/:id/races`) не пересекаются (другая длина пути). Панельный —
  `@Controller('admin/seasons/:id/standings')`, рядом с `SeasonsAdminController` (`admin/seasons`, `admin/seasons/:id`)
  конфликта нет. Если всё же объединять в один класс — статические (`table`, `me`) объявлять до любых `:param`.

### TYPES & SCHEMAS (точные формы)

`packages/contracts/src/standings/standings.schema.ts` (экспорт из `src/index.ts`; ответы приложения — `tolerantEnum`,
справочники — только в конец):

```ts
export const STANDINGS_PAGE_SIZE = 50;
export const STANDINGS_PAGE_MAX = 100;
/** Итог райдера в гонке таблицы: место / DQ (0, не выбрасывается) / нет строки (0, выбрасывается). */
export const STANDING_OUTCOMES = ['placed', 'dq', 'none'] as const;
export type StandingOutcome = (typeof STANDING_OUTCOMES)[number];
/** Свежесть снимка для панели (RC-14). */
export const STANDINGS_SYNC_STATES = ['current', 'pending'] as const;

export const SeasonStandingsTableRef = z.object({
  bikeClass: tolerantEnum(BIKE_CLASSES),
  groupKey: tolerantEnum(RESULT_GROUP_KEYS),
  riders: z.number().int(),
  racesTotal: z.number().int(),   // M
  racesCounted: z.number().int(), // N
});
/** `GET /v1/seasons/:id/standings`; таблицы — порядок BIKE_CLASSES, затем RESULT_GROUP_KEYS. */
export const SeasonStandingsSummary = z.object({
  seasonId: Uuid,
  computedAt: z.iso.datetime().nullable(),
  tables: z.array(SeasonStandingsTableRef),
});

export const SeasonStandingsTableQuery = z.strictObject({
  bikeClass: BikeClass,
  group: z.enum(RESULT_GROUP_KEYS),
  limit: z.coerce.number().int().min(1).max(STANDINGS_PAGE_MAX).default(STANDINGS_PAGE_SIZE),
  cursor: PageCursor.optional(),
});

export const SeasonStandingsRace = z.object({ id: Uuid, title: z.string(), windowEndsAt: z.iso.datetime() });
export const SeasonStandingCell = z.object({
  raceId: Uuid,
  place: z.number().int().nullable(),
  tied: z.boolean(),
  outcome: tolerantEnum(STANDING_OUTCOMES),
  points: z.number().int(),
  counted: z.boolean(),
});
export const SeasonStandingRow = z.object({
  order: z.number().int(),
  place: z.number().int(),
  tied: z.boolean(),
  riderName: z.string().nullable(),
  points: z.number().int(),
  cells: z.array(SeasonStandingCell), // по порядку `races`
});
/** `GET /v1/seasons/:id/standings/table` — без `userId`. */
export const SeasonStandingsTable = z.object({
  bikeClass: tolerantEnum(BIKE_CLASSES),
  groupKey: tolerantEnum(RESULT_GROUP_KEYS),
  computedAt: z.iso.datetime().nullable(),
  racesTotal: z.number().int(),
  racesCounted: z.number().int(),
  riders: z.number().int(),
  races: z.array(SeasonStandingsRace), // по (windowEndsAt, id)
  items: z.array(SeasonStandingRow),
  nextCursor: z.string().nullable(),
});

export const MySeasonStanding = z.object({
  bikeClass: tolerantEnum(BIKE_CLASSES),
  groupKey: tolerantEnum(RESULT_GROUP_KEYS),
  order: z.number().int(),
  place: z.number().int(),
  tied: z.boolean(),
  points: z.number().int(),
  riders: z.number().int(),
  racesTotal: z.number().int(),
  racesCounted: z.number().int(),
  raceIds: z.array(Uuid),            // гонки этой таблицы по порядку ячеек
  cells: z.array(SeasonStandingCell),
});
/** `GET /v1/seasons/:id/standings/me` (`no-store`); `races` — все гонки, встречающиеся в `items`. */
export const MySeasonStandings = z.object({
  seasonId: Uuid,
  computedAt: z.iso.datetime().nullable(),
  races: z.array(SeasonStandingsRace),
  items: z.array(MySeasonStanding),
});

// панель (SPA и API деплоятся вместе — `z.enum` допустим, как в results-admin)
export const PanelSeasonStandingsSummary = SeasonStandingsSummary.extend({
  formulaVersion: z.number().int().nullable(),
  sync: z.enum(STANDINGS_SYNC_STATES),
});
export const PanelSeasonStandingRow = SeasonStandingRow.extend({ userId: Uuid.nullable() }); // RC-8
export const PanelSeasonStandingsTable = SeasonStandingsTable.extend({ items: z.array(PanelSeasonStandingRow) });
// + type-экспорты всех схем
```

Курсор таблицы — `src/page-cursor.ts`: `encodeCursor(String(order), seasonId)`; разбор
`decodeCursor(raw, z.string().regex(/^\d{1,7}$/))`, `id !== seasonId` → `400 VALIDATION_FAILED` (поле `cursor`);
выборка `order > k`. Новых кодов ошибок нет (`NOT_FOUND`, `VALIDATION_FAILED`, `UNAUTHORIZED`).

Документы — `apps/api/src/modules/standings/standings.collection.ts`:

```ts
export const STANDINGS_COLLECTIONS = { seasons: 'season_standings', rows: 'season_standing_rows' } as const;

/** Заголовок снимка сезона: `_id` = seasonId; пишет только `StandingsRepository.claimSeason` (RC-5). */
export interface SeasonStandingsDoc {
  _id: string;
  formulaVersion: number;
  /** Σ текущих ревизий гонок сезона с протоколом — монотонна (RC-1, RC-5) */
  sourceVersion: number;
  /** sha256 hex `sourceFingerprint` */
  fingerprint: string;
  computedAt: Date;
  races: { raceId: string; title: string; windowEndsAt: Date; bikeClass: BikeClass;
           groupScheme: GroupScheme; revision: number }[];      // по (windowEndsAt, raceId)
  tables: { bikeClass: BikeClass; groupKey: ResultGroupKey; raceIds: string[];
            racesTotal: number; racesCounted: number; riders: number }[];
}

/** Строка таблицы снимка; набор строк сезона заменяется целиком в транзакции с заголовком (не append-only). */
export interface SeasonStandingRowDoc {
  _id: string;            // uuidv7
  seasonId: string;
  bikeClass: BikeClass;
  groupKey: ResultGroupKey;
  order: number;          // 0.. в таблице
  userId: string;
  place: number;
  tied: boolean;
  points: number;
  cells: { raceId: string; place: number | null; tied: boolean; outcome: StandingOutcome;
           points: number; counted: boolean }[];
}
```

Порты (только через `index.ts`):

```ts
// modules/races/season-races.port.ts — реализация SeasonRacesService (RacesCoreModule), экспорт SEASON_RACES
export const SEASON_RACES = Symbol('SEASON_RACES');
export interface SeasonRaceForStandings {
  id: string; seasonId: string; bikeClass: BikeClass;
  /** doc.groupScheme ?? (lockedAt ? 'overall' : 'gender_age') — RC-2 */
  groupScheme: GroupScheme;
  title: string; windowEndsAt: Date;
}
export interface SeasonRaces {
  /** status 'published', protocolPublishedAt: { $type: 'date' }, seasonId: string; без seasonId — все сезоны
   *  (индекс races_protocol_idx); сортировка (seasonId, windowEndsAt, _id) */
  protocolRaces(seasonId?: string): Promise<SeasonRaceForStandings[]>;
  /** сезон существует (видимость как GET /v1/seasons/:id, RC-7) */
  seasonExists(seasonId: string): Promise<boolean>;
  /** сотрудник видит все гонки (`!ownScope`, RC-8) */
  seesAllRaces(principal: Pick<PanelPrincipal, 'permissions'>): boolean;
}
// RacesRepository: + listProtocolRaces(seasonId?: string): Promise<RaceDoc[]> (проекция нужных полей)

// modules/results/results-for-standings.port.ts — ResultsForStandingsService (ResultsCoreModule), экспорт RESULTS_FOR_STANDINGS
export const RESULTS_FOR_STANDINGS = Symbol('RESULTS_FOR_STANDINGS');
export interface StandingsSourceRow {
  userId: string; place: number | null; tied: boolean;
  status: ProtocolRowStatus;  // 'final' | 'revised' | 'dq'
  groupKey: ResultGroupKey;   // ?? 'overall'
}
export interface ResultsForStandings {
  /** текущая ревизия по гонкам (max числовой revision журнала, один aggregate, RC-3); нет ревизии — нет ключа */
  currentRevisions(raceIds: readonly string[]): Promise<Map<string, number>>;
  /** строки снимка ревизии, все группы, с DQ (START и «без пульса» в снимок не входят по построению) */
  protocolRows(raceId: string, revision: number): Promise<StandingsSourceRow[]>;
}
// ResultsRepository: + currentRevisions(raceIds) (aggregate), + standingsRows(raceId, revision) (find с проекцией)
```

Имена — существующий `RIDER_NAMES.publicNames` (`ProfileCoreModule`).

### Политика `standings.policy.ts` (чистые функции, unit)

```ts
export const STANDINGS_FORMULA_VERSION = 1;
const TOP_POINTS = [100, 85, 75, 67, 60, 54, 49, 45, 41, 38] as const;

/** Ф1: 1..10 — таблица; далее −2 за место (11 → 36 … 28 → 2); 29+ → 1. */
export function pointsForPlace(place: number): number {
  return place <= 10 ? TOP_POINTS[place - 1]! : Math.max(1, 38 - 2 * (place - 10));
}
/** N = M − ⌊M/3⌋ (M = 0 → 0). */
export const racesCounted = (m: number): number => m - Math.floor(m / 3);
/** Группы, которые даёт схема: overall → ['overall'], gender_age → шесть групп RESULT_GROUP_KEYS без overall. */
export function schemeGroups(scheme: GroupScheme): readonly ResultGroupKey[];

export interface StandingsRaceInput extends SeasonRaceForStandings { revision: number; rows: StandingsSourceRow[] }
export interface StandingCell { raceId: string; place: number | null; tied: boolean;
                                outcome: StandingOutcome; points: number; counted: boolean }
export interface StandingRow { userId: string; order: number; place: number; tied: boolean;
                               points: number; cells: StandingCell[] }
export interface SeasonTable { bikeClass: BikeClass; groupKey: ResultGroupKey; raceIds: string[];
                               racesTotal: number; racesCounted: number; rows: StandingRow[] }

export function cellOf(raceId: string, row: StandingsSourceRow | undefined): Omit<StandingCell, 'counted'>;
//   нет строки → { place: null, tied: false, outcome: 'none', points: 0 }
//   status 'dq' → { place: null, tied: false, outcome: 'dq', points: 0 }
//   иначе       → { place, tied, outcome: 'placed', points: pointsForPlace(place) }

export function selectCounted(cells: Omit<StandingCell, 'counted'>[], n: number): StandingCell[];
//   кандидаты: сначала dq (по порядку гонок), затем placed по (points desc, place asc, индекс гонки asc) — RC-10;
//   первые n кандидатов → counted: true; none — всегда false; порядок ячеек на выходе — порядок гонок.

export function tieKey(cells: StandingCell[]): number[];   // места counted && placed, по возрастанию
export function compareRiders(a, b): number;
//   points desc → tieKey лексикографически (a[i] ?? +∞ vs b[i] ?? +∞, меньше — лучше) → 0 (равны по месту)

export function buildSeasonStandings(races: readonly StandingsRaceInput[]): SeasonTable[];
/* псевдокод:
   races ← sort (windowEndsAt, id)
   tables ← Map<`${bikeClass}:${groupKey}`, { races: [], byUser: Map<userId, Map<raceId, row>> }>
   for race in races:
     for g in schemeGroups(race.groupScheme): table(race.bikeClass, g).races.push(race)
     for row in race.rows:
       t ← table(race.bikeClass, row.groupKey)          // группа не из схемы (не должно быть) — гонка добавляется в M этой таблицы
       if race ∉ t.races: t.races.push(race) (с сохранением порядка)
       t.byUser[row.userId][race.id] ← row
   result ← []
   for t in tables (порядок BIKE_CLASSES, затем RESULT_GROUP_KEYS), где byUser не пуст:
     M ← t.races.length; N ← racesCounted(M)
     riders ← for (userId, rows) in t.byUser:
       cells ← selectCounted(t.races.map(r => cellOf(r.id, rows.get(r.id))), N)
       { userId, cells, points: Σ cells.filter(counted).points, key: tieKey(cells) }
     sort riders by compareRiders, затем userId asc
     for i, r in riders:
       place ← i > 0 && compareRiders(riders[i-1], r) === 0 ? riders[i-1].place : i + 1
       tied ← число равных (compareRiders === 0) с r ≥ 2
       order ← i
     result.push({ bikeClass, groupKey, raceIds, racesTotal: M, racesCounted: N, rows })
   return result */

/** Отпечаток источника: sha256 hex JSON [formulaVersion, races по id → [id, revision, bikeClass, groupScheme]]. */
export function sourceFingerprint(races: readonly Pick<StandingsRaceInput,'id'|'revision'|'bikeClass'|'groupScheme'>[],
                                  formulaVersion = STANDINGS_FORMULA_VERSION): string;
export const sourceVersion = (races: readonly { revision: number }[]): number;   // Σ revision
```

Golden (`standings.policy.test.ts`): спайк §4.1 — M = 3, N = 2 → Аня/Боря/Вера `place 1, tied` 185 (ключ `[1, 2]` у
всех), Гена 4 — 160, Дима 5 — 75 (ячейка Г2 `dq` `counted: true`, Г1 `counted: false`).

### Регламент и пересчёт

- `queues.ts`: `standingsRecalc: 'standings-recalc'` (комментарий: регламент сверки отпечатков, без событий, DV-1).
- `standings-sync.processor.ts` (образец `routes-maintenance.processor.ts`):
  `STANDINGS_SYNC_JOB = 'sync'`; `STANDINGS_SCHEDULES = [{ id: 'standings.sync', repeat: { pattern: '* * * * *',
  tz: 'Europe/Minsk' }, job: { name: STANDINGS_SYNC_JOB } }]`; `StandingsSchedules.onApplicationBootstrap` —
  `upsertJobScheduler` + `queue.add(STANDINGS_SYNC_JOB, {}, { jobId: 'standings.sync.boot', removeOnComplete: true,
  removeOnFail: true })`; `StandingsSyncProcessor.process` — неизвестное имя → `throw`.
- `StandingsSource` (`standings-source.ts`): `load(seasonId?)` → гонки (`SEASON_RACES.protocolRaces`) +
  `currentRevisions` → `Map<seasonId, { races: (SeasonRaceForStandings & { revision })[]; fingerprint;
  sourceVersion }>`; гонка без ревизии — исключается с логом `standings.revision_missing race=<id>`. Им же пользуется
  сводка панели (RC-14).
- `StandingsRecalc.sync(): Promise<{ seasons: number; recomputed: number; stale: number; failed: number }>`:
  `source.load()` → `repository.fingerprints(seasonIds)` (проекция `_id, fingerprint`) → для сезонов с другим
  отпечатком по одному `recompute(seasonId, source)` в `try/catch` (лог `standings.recompute_failed season=<id>`,
  `failed++`); после цикла `failed > 0` → `throw new Error('standings.sync_failed')` (failed-набор BullMQ). Лог
  успеха — `standings.recomputed season=<id> tables=<n> rows=<n> ms=<d>`; без имён и `userId`.
- `recompute`: строки каждой гонки (`protocolRows(raceId, revision)`, последовательно) → `buildSeasonStandings` →
  документы (`computedAt = CLOCK.now()`, `_id` строк — `uuidv7()`) → `writeSnapshot(header, rows)`.
- `writeSnapshot` (RC-5): `transactions.run(async (tx) => { await repository.claimSeason(tx, header);
  await repository.replaceRows(tx, seasonId, rows); })`; `isDuplicateKey(error, '_id_')` → `'stale'` (лог
  `standings.stale season=<id>`), иначе пробросить. Внутри колбэка — без побочных эффектов.
- `StandingsRepository` (единственный писатель обеих коллекций):
  - `claimSeason(tx, header)` — `updateOne({ _id, $or: [{ formulaVersion: { $lt: f } }, { formulaVersion: f,
    sourceVersion: { $lt: s } }] }, { $set: <header без _id> }, { session: tx, upsert: true })` — **первая**
    операция транзакции;
  - `replaceRows(tx, seasonId, rows)` — `deleteMany({ seasonId })`, `insertMany(rows)` (пусто — без вставки);
  - `fingerprints(ids?)`, `header(seasonId, session?)`, `rowsPage(seasonId, bikeClass, groupKey, afterOrder,
    limit, session)` (сортировка `order`, `limit + 1`), `rowsOfUser(seasonId, userId, session)`,
    `withSnapshot(fn)` (как `ResultsRepository.withSnapshot`, `MONGO_CLIENT`).

### Чтение (`StandingsReadService`)

- `summary(seasonId)`: `seasonExists` → иначе `404`; заголовок нет → `{ seasonId, computedAt: null, tables: [] }`.
- `table(seasonId, query)`: `404` → курсор (`400`) → в `withSnapshot`: заголовок, таблица по `(bikeClass, group)`
  (нет — пустая страница, RC-12), `rowsPage(limit + 1)` → имена `publicNames(userIds)` вне сессии → строки без
  `userId`; `races` — из `header.races` по `table.raceIds`.
- `mine(seasonId, userId)`: `404` → `withSnapshot`: заголовок + `rowsOfUser` → `items` по порядку таблиц.
- `panelSummary(principal, seasonId)`: как `summary` + `formulaVersion` + `sync` (`StandingsSource.load(seasonId)`,
  RC-14). `panelTable(principal, seasonId, query)`: как `table` + `userId: seesAllRaces(principal) ? userId : null`.

### Модули

- `StandingsCoreModule` — imports `RacesCoreModule`, `ResultsCoreModule`; providers `StandingsRepository`,
  `StandingsSource`, `StandingsRecalc`; exports их.
- `StandingsModule` (API, в `AppModule`) — imports `IdentityModule` (`AuthGuard`), `PanelModule`, `ProfileCoreModule`
  (`RIDER_NAMES`), `StandingsCoreModule`; controllers — три; providers `StandingsReadService`, `PublicReadGuard`.
- `StandingsWorkerModule` (в `WorkerModule`) — imports `StandingsCoreModule`, `BullModule.registerQueue({ name:
  QUEUE.standingsRecalc })`; providers `StandingsSyncProcessor`, `StandingsSchedules`. Маршрутов outbox нет (DV-1).
- `ResultsCoreModule` в worker требует `@Global DisputesCoreModule` — он уже в `WorkerModule` и `AppModule`.

### Миграция `0030_standings` (expand-only, без транзакции, идемпотентна; последний сейчас — `0029_routes_publication`)

- `ensureCollection` `season_standings`, `season_standing_rows`;
- `season_standing_rows`: `{ seasonId: 1, bikeClass: 1, groupKey: 1, order: 1 }` unique —
  `season_standing_rows_order_unique` (страница и `deleteMany` по префиксу); `{ seasonId: 1, userId: 1 }` —
  `season_standing_rows_user_idx` (`/me`);
- `races`: `races_protocol_idx` `{ seasonId: 1, windowEndsAt: 1, _id: 1 }`, `partialFilterExpression:
  { protocolPublishedAt: { $type: 'date' } }` (RC-4).
- `STANDINGS_INDEXES` экспортируется для `migrations.int.test.ts`; если к слиянию номер занят — следующий свободный.
  Бэкфилла нет: первый прогон регламента после выката строит снимки всех сезонов с протоколами.

### FILES TO MODIFY / CREATE

Создать:
- `packages/contracts/src/standings/standings.schema.ts`, `standings.schema.test.ts`
- `apps/api/src/modules/standings/{index,standings.module,standings.collection,standings.repository,standings.policy,
  standings.policy.test,standings-source,standings-recalc,standings-sync.processor,standings-schedules.test,
  standings-read.service,standings-public.controller,standings-me.controller,standings-admin.controller}.ts`
- `apps/api/src/modules/standings/{standings-sync.int,standings-locks.int,standings-read.int}.test.ts`
- `apps/api/src/modules/races/{season-races.port,season-races}.ts`
- `apps/api/src/modules/results/{results-for-standings.port,results-for-standings}.ts`
- `apps/api/src/db/migrations/0030_standings.ts`
- `apps/api/test/standings.ts` (хелперы: опубликовать протокол гонки сезона, прогон `StandingsRecalc.sync`)

Изменить:
- `packages/contracts/src/index.ts`; `packages/api-client/src/index.ts` (+ `getSeasonStandings`,
  `getSeasonStandingsTable`, `getMySeasonStandings`), `admin.ts` (+ `getSeasonStandings`,
  `getSeasonStandingsTable`) и их тесты; `packages/i18n/src/ru.ts` (строки 08b/08c можно добавить в своих PR)
- `apps/api/src/modules/races/{index,races.module,races.repository}.ts`
- `apps/api/src/modules/results/{index,results.module,results.repository}.ts` (+ `results.repository.test.ts`, если
  сторож перечисляет методы)
- `apps/api/src/{queues,app.module,worker.module}.ts`, `src/db/migrations/{index,migrations.int.test}.ts`
- `.claude/rules/{pokatim-backend,pokatim-db,pokatim-security,pokatim-contracts}.md` (§10)

### FILES TO READ

- `apps/api/src/modules/results/{results.repository (protocolRows, currentRevision, withSnapshot),
  results-protocol.service (writeRevision), results-read.service (курсор, snapshot), results-panel-read.service (имена)}.ts`
- `apps/api/src/modules/races/{race-registry,races.repository,races-public.service,races.policy (ownScope, LOCKED_BY_ENTRIES)}.ts`
- `apps/api/src/modules/routes/{routes-maintenance.processor,routes-schedules.test}.ts`
- `apps/api/src/{page-cursor,public-read.guard,admin-routes.test}.ts`, `src/db/migrations/{0016_protocol,0028_entry_tier}.ts`
- `apps/api/test/{results,panel,races}.ts` (`protocolRace`, `protocolAction`, `corridorRace({ scheme })`)
- `packages/contracts/src/results/{results.schema,results-admin.schema}.ts`

### TEST MATRIX

| Уровень | Файл | Что доказывает (AC) |
|---|---|---|
| unit | `standings.policy.test.ts` | golden спайка (1); `pointsForPlace` 1…10, 11, 28, 29, 100, «=2» (2); `racesCounted` M = 0,1,2,3,5,6,8,9 (3); DQ занимает слот, два DQ при N = 2 → 0, dns выброшен (4); разбивка по местам, неразбитая «=N», следующее место (5); класс × группа, overall-гонка → `overall`, чужой класс не в M, гонка без строк группы в M, `groupScheme` `gender_age` без строк (6, RC-2); RC-10 — места 29 и 35 при равных очках: засчитана 29-я; отпечаток не зависит от порядка входа и меняется с `formulaVersion`; `sourceVersion` |
| unit | `standings-schedules.test.ts` | `* * * * *` Минск, upsert, разовая `standings.sync.boot` |
| unit | `standings.schema.test.ts` | `tolerantEnum` → `unknown`, строгий query (лишний ключ — ошибка), `limit` |
| int | `standings-sync.int.test.ts` | публикация → после `sync()` снимок; DQ после публикации (новая ревизия) → обновлён; повтор без изменений — без записи (`computedAt` тот же, `claimSeason` не вызван); две гонки разных схем; гонка без ревизии пропущена; отказ одного сезона не блокирует другой, задача падает (7) |
| int | `standings-locks.int.test.ts` | две параллельные записи (`sourceVersion` 2 коммитится раньше 1 — удерживаемая транзакция / ворота) → итог 2, проигравший — `stale`, строки старой версии не появились; **отрицательное доказательство**: условие версии убрано из фильтра `claimSeason` → итог 1 (тест краснеет по результату); первый upsert двумя транзакциями → один победитель (7) |
| int | `standings-read.int.test.ts` | ключи публичных ответов (без `userId`), имя только с согласием, `Cache-Control`; неизвестный сезон `404`, невалидный id/курсор `400`; пустой сезон; страницы по курсору; таблица не из снимка — пустая (RC-12); `/me` без входа `401`, только свои строки; панель: без сессии `401`, токен райдера `401`, admin/moderator — `userId`, organizer — `userId: null`, `sync: pending → current` (8–10) |
| int | `migrations.int.test.ts` | `0030` повторно — без ошибки, индексы с опциями (`unique`, `partialFilterExpression`) (11) |
| unit | `admin-routes.test.ts` (существующий) | новые `admin/*` маршруты под `PanelGuard` + право (10) |
| unit | `packages/api-client` тесты | пути, `encodeURIComponent`, схемы ответов, `/me` с токеном |

### Порядок реализации (TDD)

1. Контракты + тест; `pnpm --filter @pokatim/contracts test`.
2. `standings.policy.ts` — сначала golden и AC 2–6 (красные), затем код.
3. Миграция `0030` + `migrations.int.test`.
4. Порты `SeasonRaces`, `ResultsForStandings` (+ методы репозиториев) — int через `standings-sync`.
5. `StandingsRepository` + `writeSnapshot` — сначала `standings-locks.int` (включая отрицательное доказательство,
   результат — в §12).
6. `StandingsSource`, `StandingsRecalc`, процессор и расписание — `standings-sync.int`, `standings-schedules.test`.
7. `StandingsReadService` + контроллеры + модули — `standings-read.int`, `admin-routes`.
8. `api-client`, i18n; правила `.claude/rules/*` (§10); `TURBO_CONCURRENCY=1 pnpm check`.

### OUT OF SCOPE (08a)

Подписка на события outbox и fan-out (DV-1); ручной пересчёт; уведомления о месте; бэкфилл-скрипт (его заменяет
первый прогон); шаг стирания (RC-6).

## 11.2 08b — панель (потребляет 08a)

- **Курсор и снимок (ревью 08a LOW-2):** курсор не привязан к снимку — если `computedAt` следующей страницы отличается от первой, подгруженные строки сбрасываются и таблица грузится заново с первой страницы.

- API: `getSeasonStandings(id)` → `PanelSeasonStandingsSummary`, `getSeasonStandingsTable(id, { bikeClass, group,
  cursor })` → `PanelSeasonStandingsTable` (`packages/api-client/src/admin.ts`).
- Маршрут `seasons/$seasonId` в `apps/admin/src/router.tsx` под `RequirePermission permission="races.read"`;
  `features/seasons/SeasonScreen.tsx` (шапка — `PageHeader`: название и даты из `seasonsQuery`; раздел «Рейтинг», без
  компонента вкладок — RC-19), `SeasonStandingsTable.tsx`, `standings-query.ts` (`queryOptions` / infinite по
  курсору). Вход — название сезона ссылкой в `SeasonsScreen`.
- Компоненты — только `apps/admin/src/ui`: `ChipGroup` (класс, группа — только таблицы из сводки), `DataTable`
  (место «=N» — `placeLabel`, участник — имя или `Участник ·<6 символов userId>` через общий форматтер рядом с
  `riderLabel`; `userId: null` — «Участник», очки, колонка на гонку: «1 · 100», «=2 · 85», «DQ · 0», «—»;
  незасчитанная ячейка — приглушённая с подписью для скринридера), `StatusTag` («Актуален» / «Ждёт пересчёта»),
  `EmptyState`, `ErrorState` с повтором, скелетон `DataTable`.
- i18n: `admin.seasons.open`, `admin.standings.{title,computedAt,formula,sync.current,sync.pending,empty,emptyHint,
  column.place,column.rider,column.points,cell,cellDq,cellNone,notCounted,more}`; группы — `results.group.*`,
  классы — `domain.bikeClass.*`.
- Тесты: `SeasonScreen.test.tsx` — переключатели (только существующие таблицы), строки и ячейки (DQ, не в зачёте),
  «Ждёт пересчёта», пусто / скелетон / ошибка с повтором, organizer без id; ссылка из `SeasonsScreen.test.tsx`.

## 11.3 08c — приложение (потребляет 08a)

- **Курсор и снимок (ревью 08a LOW-2):** курсор не привязан к снимку — если `computedAt` следующей страницы отличается от первой, подгруженные строки сбрасываются и таблица грузится заново с первой страницы.

- API: `getSeasonStandings`, `getSeasonStandingsTable` (публичные, `PUBLIC_STALE_MS`), `getMySeasonStandings`
  (`withAccessToken`, только вошедшему, кэш очищается при выходе — как «моё участие»).
- `features/standings/queries.ts` (`useSeasonStandings`, `useSeasonStandingsTable` — infinite по курсору,
  `useMySeasonStandings`), `standings-format.ts` (место «=N» и a11y — переиспользовать `races.results.tiePlace`,
  `races.results.tiedA11y`; подпись таблицы; выбор таблицы по умолчанию: своя из `/me`, иначе первая сводки; «Вы» —
  только при равном `computedAt`, RC-11), `season-standings.tsx` (блок экрана сезона), `profile-season-block.tsx`.
- Экран сезона (`features/races/season-detail.tsx`): блок «Таблица сезона» в `ListHeaderComponent` между шапкой и
  «Гонками сезона» (RC-17): `AsyncContent` + скелетон строк; `SegmentedControl` класса и группы (в горизонтальном
  `ScrollView`, как `results-table.tsx`); заметка с N из M; «{группа} · {класс} · N участников»; строки (место, имя /
  «Участник» / «Вы» с полосой, очки); «Показать ещё» (`races.results.more`); пусто — `EmptyState` «Сезон только
  начался» + действие «К гонкам». Обновление pull-to-refresh — добавить refetch таблицы и `/me` в `refetchers`.
- Вкладка «Гонки» (`app/(tabs)/races.tsx`): действие «Таблица сезона» → `/seasons/<id>` для `useHeaderSeason`.
- «Профиль» (`app/settings/profile.tsx`): блок «Сезон {название}» для `useHeaderSeason` (RC-18): своя строка (место,
  очки, «{группа} · {класс}»), «Вся таблица» → экран сезона, список гонок таблицы (название, место, очки, «в зачёте» /
  «не в зачёте» / «DQ · 0»); нет строк или ошибка без данных — блок скрыт / компактная ошибка с повтором по §4.12.
- i18n: `season.standings.{title,subtitle,note(plural по M),caption(plural участников),classes,groups,points(plural),
  rowA11y,emptyTitle,emptyMessage,toRaces}`, `races.seasonTable`, `profile.season.{title,all,line,counted,notCounted,
  dq,none}`; переиспользуются `races.results.{you,rider,more,tiePlace,tiedA11y}`, `results.group.*`,
  `domain.bikeClass.*`.
- Только `@rkarakulov/ui` и токены (7 тем), без `Platform.OS`; web — тот же экран (SSR сезона без изменений, таблица
  — клиентский запрос; `loader` можно не расширять).
- Тесты (jest): `season-standings.test.tsx` — переключатели, «=N» и a11y, «Вы» (и без метки при разном `computedAt`),
  подгрузка, пусто, ошибка; `profile-season-block.test.tsx` — строка, гонки, скрыт без строк; `races.tsx` — действие;
  `standings-format.test.ts`.

# 12. Outcome (заполняет coder)

## 12.1 08a — модель, API, worker

### Changes

- Контракты `packages/contracts/src/standings/standings.schema.ts` — формы §11.1 без изменений (ответы приложения —
  `tolerantEnum`, панель — строгие, `SeasonStandingsTableQuery` — `strictObject`).
- `apps/api`: новый модуль `standings` — политика `standings.policy.ts` (Ф1, N из M, DQ-слоты, RC-10, разбивка ничьей,
  отпечаток и `sourceVersion`), коллекции снимка `season_standings` / `season_standing_rows`, `StandingsRepository`
  (`claimSeason` — условный upsert первой операцией транзакции, RC-5), `StandingsSource`, `StandingsRecalc` (`sync`,
  `recompute`, `writeSnapshot` → `written | stale`), регламент `standings-recalc` (`* * * * *` Минск +
  `standings.sync.boot`), `StandingsReadService` и три контроллера (публичный, `/me`, панель).
- Порты: `races` — `SEASON_RACES` (`SeasonRacesService`, `RacesRepository.listProtocolRaces` с условием частичного
  индекса, RC-2: `groupScheme: null` → `gender_age`); `results` — `RESULTS_FOR_STANDINGS` (`currentRevisions` одним
  `aggregate` с предикатом `revision: { $type: 'number' }`, `standingsRows` с проекцией). `races`/`results` о
  `standings` не знают.
- Миграция `0030_standings` (expand-only, идемпотентна, без бэкфилла); `QUEUE.standingsRecalc`; `StandingsModule` в
  `AppModule`, `StandingsWorkerModule` в `WorkerModule`.
- `packages/api-client`: `getSeasonStandings`, `getSeasonStandingsTable`, `getMySeasonStandings`; панель —
  `getSeasonStandings`, `getSeasonStandingsTable`; тип `SeasonStandingsTableParams`.
- `packages/i18n` — без изменений: серверу строки не нужны, строки экранов — в PR 08b/08c (§11.1 «FILES TO MODIFY»).

### Files touched

- Создано: `packages/contracts/src/standings/{standings.schema,standings.schema.test}.ts`;
  `apps/api/src/modules/standings/{index,standings.module,standings.collection,standings.repository,standings.policy,
  standings.policy.test,standings-source,standings-recalc,standings-sync.processor,standings-schedules.test,
  standings-read.service,standings-public.controller,standings-me.controller,standings-admin.controller,
  standings-sync.int.test,standings-locks.int.test,standings-read.int.test}.ts`;
  `apps/api/src/modules/races/{season-races.port,season-races}.ts`;
  `apps/api/src/modules/results/{results-for-standings.port,results-for-standings}.ts`;
  `apps/api/src/db/migrations/0030_standings.ts`; `apps/api/test/standings.ts`; `packages/api-client/src/standings.test.ts`.
- Изменено: `packages/contracts/src/index.ts`; `packages/api-client/src/{index,admin}.ts`;
  `apps/api/src/modules/races/{index,races.module,races.repository}.ts`;
  `apps/api/src/modules/results/{index,results.module,results.repository}.ts`;
  `apps/api/src/{queues,app.module,worker.module}.ts`; `apps/api/src/db/migrations/{index,migrations.int.test}.ts`.

### Docs updated

- `.claude/rules/pokatim-backend.md` (раздел «Рейтинг сезона», отметка о fan-out в «Протоколе»), `pokatim-db.md`
  (коллекции снимка, RC-5, `0030_standings`, исключение из правила порта стирания — RC-6), `pokatim-security.md`
  (публичные таблицы без `userId`, `/me`, `userId` в панели только при `!ownScope`), `pokatim-contracts.md`
  (раздел `standings`).
- `docs/product/races-and-seasons.md` — серверные правила 08a (экран и «скрыто до FR-4» — 08c);
  `docs/product/notifications.md`, `docs/adr/0017-notifications-and-push.md` п. 5 — отметка: 08 — регламент, fan-out
  — follow-up; `docs/tasks/2026-10-27-race-results/epic.md` — статус слайса 08 и очередь `standings-recalc`.

### Tests

- unit: `standings.policy.test.ts` (14: golden спайка §4.1, AC2–AC6, RC-2, RC-10, отпечаток, `sourceVersion`),
  `standings-schedules.test.ts` (2), `standings.schema.test.ts` (4), `api-client/src/standings.test.ts` (3);
  `admin-routes.test.ts` (существующий) покрывает новые `admin/seasons/:id/standings*` автоматически.
- int: `standings-sync.int.test.ts` (4: публикация → снимок, DQ → ревизия 2 → обновлён, повтор — `claimSeason` не
  вызван и `computedAt` тот же; две схемы и RC-2; гонка без ревизии и сезон без протоколов; отказ сезона не блокирует
  другой, задача падает), `standings-locks.int.test.ts` (5), `standings-read.int.test.ts` (9: ключи ответов без
  `userId`, имя по согласию, `Cache-Control`, 404/400, курсор, RC-12, `/me` 401 и свои строки, панель 401 без сессии и
  с токеном райдера, admin/moderator — `userId`, organizer — `null`, `sync: pending → current`), `migrations.int.test.ts`
  (`0030` повторно, индексы с `unique` / `partialFilterExpression`).
- Отрицательное доказательство RC-5 (постоянный тест «без условия версии … откатывается к 1» + ручной прогон): условие
  `$or` убрано из фильтра `claimSeason` → `standings-locks.int.test.ts`: `Tests 3 failed | 2 passed (5)` —
  «версия 2 коммитится раньше … версии 1» — `expected 'written' to be 'stale'`; «первый снимок двумя транзакциями» —
  `expected [ 'written', 'written' ] to deeply equal [ 'stale', 'written' ]`; «повтор той же версии» — `expected
  'written' to be 'stale'`. Условие возвращено — `Tests 5 passed (5)`.
- `TURBO_CONCURRENCY=1 MONGO_URL_TEST=…/pokatim_s08_test REDIS_URL_TEST=…/14 pnpm check` → `EXIT=0`:
  `All matched files use Prettier code style!`, `✔ no dependency violations found (1484 modules, 5477 dependencies
  cruised)`, typecheck `Tasks: 9 successful, 9 total`; тесты — contracts `315 passed`, api-client `110 passed`, api
  `Test Files 134 passed (134)`, `Tests 1430 passed (1430)`, admin `327 passed`, app `Tests: 1573 passed`,
  `Tasks: 15 successful, 15 total`.
- Первый прогон `pnpm check` был красным: сторож `results.repository.test.ts` (коллекции протокола по имени) поймал
  имя `race_protocol_rows` в комментарии `standings.collection.ts` — комментарий переписан, сторож не менялся.

### Open follow-ups

- Fan-out outbox в app-foundation и подписка `standings` на события протокола вместо регламента (DV-1).
- Пакетная запись поколений снимка, если сезон превысит ~10 000 строк (RC-16; сейчас лог `rows=<n>`).
- 08b (панель) и 08c (приложение) — отдельными PR; i18n-строки экранов — там же.
- Номер миграции `0030` свободен в `origin/develop` на момент коммита; при слиянии после чужой `0030` — перенумеровать.

### Фиксы ревью 08a pass 1

Ревью: Claude — APPROVE (LOW-1, LOW-2), Codex — APPROVE (MEDIUM-1). Findings — `findings-08a-claude.md`,
`findings-08a-codex.md`.

- MEDIUM-1 (Codex): схемы панели — строгие `z.enum` класса, группы (сводка и таблица) и исхода ячейки
  (`PanelSeasonStandingsTableRef`, `PanelSeasonStandingCell`); тест отказа неизвестных значений в
  `standings.schema.test.ts`. Публичные схемы — tolerant, как были.
- LOW-1 (Claude): регламент читает `snapshotStates` (отпечаток + `formulaVersion` + `sourceVersion`); снимок не старше
  источника при другом отпечатке — пропуск (`conflicts`, лог `standings.version_conflict`) вместо пересчёта каждую
  минуту с итогом `stale`. Int-тест в `standings-sync.int.test.ts` (без пропуска — `claimSeason` вызывается, итог
  `stale: 1`). Правило «изменил вход отпечатка — подними `STANDINGS_FORMULA_VERSION`» — `pokatim-backend.md`.
- LOW-2 (Claude): курсор не привязан к снимку — правило для клиентов 08b/08c (§11.2, §11.3): при смене `computedAt`
  между страницами подгруженное сбрасывается и таблица грузится с первой страницы.
- Проверка: `vitest run src/standings` (contracts) — 4 passed; `vitest run src/modules/standings` (api) — 35 passed;
  полный `pnpm check` — перед PR.

## 12.2 08b — панель

### Changes

- Экран сезона `/seasons/$seasonId` (`RequirePermission permission="races.read"`): `SeasonScreen` — шапка
  `PageHeader` (крошка «Сезоны», название и даты из `seasonsQuery`), раздел «Рейтинг» без компонента вкладок (RC-19);
  403 — «Нет доступа», 404 — «Сезон не найден», ошибка сводки — `ErrorState` с повтором, загрузка — скелетон
  `DataTable`, таблиц нет — `EmptyState` с подсказкой.
- Строка снимка: `StatusTag` «Актуален» / «Ждёт пересчёта» (RC-14), «Пересчёт: {дата Минска}» / «Пересчёта ещё не
  было», «Формула v{N}».
- `SeasonStandingsTable`: `ChipGroup` класса и группы — только таблицы сводки (по умолчанию первая; смена класса —
  первая группа класса), подпись «{группа} · {класс}: лучшие N из M гонок · участников: K», `DataTable` (место
  `placeLabel` «=N», участник, очки, колонка на гонку: «1 · 100», «=2 · 85», «DQ · 0», «—»; незасчитанная ячейка —
  `.muted` + `visually-hidden` «, не в зачёте»), «Показать ещё» по курсору (`useInfiniteQuery`), RC-12 — пустое
  состояние.
- Курсор и снимок (§11.2): после подгрузки, если `computedAt` страниц различается, — `resetQueries` таблицы (заново
  с первой страницы) и инвалидация сводки.
- Подпись участника — `seasonRiderLabel(userId, riderName)` рядом с `riderLabel` (`results-format.ts`): с `userId`
  — «Анна К. ·a1b2c3» / «Участник ·a1b2c3», без (организатор, RC-8) — имя или «Участник».
- `SeasonsScreen` — название сезона ссылкой на экран сезона.
- i18n: `admin.seasons.notFound`, `admin.standings.*`.

### Files touched

- Создано: `apps/admin/src/features/seasons/{SeasonScreen,SeasonStandingsTable}.tsx`,
  `apps/admin/src/features/seasons/standings-query.ts`, `apps/admin/src/features/seasons/SeasonScreen.test.tsx`.
- Изменено: `apps/admin/src/router.tsx`, `apps/admin/src/features/seasons/{SeasonsScreen.tsx,SeasonsScreen.test.tsx}`,
  `apps/admin/src/features/results/results-format.ts`, `packages/i18n/src/ru.ts`, `.claude/rules/pokatim-web.md`.
- Сервер, приложение, api-client — без изменений.

### Отклонения от §11.2

- «Показать ещё» — существующий `admin.more` (вместо нового `admin.standings.more` с тем же текстом).
- `admin.seasons.open` не добавлен: ссылка — само название сезона (доступное имя = видимый текст, существующие
  проверки строк «Сезонов» не меняются).
- Добавлены ключи, которых не было в списке: `admin.standings.{neverComputed,classFilter,groupFilter,tableMeta,rider}`,
  `admin.seasons.notFound`.

### Tests

- `SeasonScreen.test.tsx` (15): шапка, время пересчёта, формула, «Актуален»; переключатели — только таблицы сводки,
  смена группы и класса — запрос с новым ключом; строки и ячейки (`=2 · 85`, DQ, «—», не в зачёте — `.muted` и
  скрытый текст); ничья «=1»; организатор без id; «Ждёт пересчёта»; пусто (нет таблиц; RC-12); скелетон сводки и
  таблицы; ошибка сводки и таблицы с повтором; 404; «Показать ещё» по курсору; смена `computedAt` между страницами —
  таблица заново с первой страницы.
- `SeasonsScreen.test.tsx` (+1): название — ссылка `/admin/seasons/<id>`.
- Отрицательная проверка правила курсора: условие сброса заменено на `false` → `Tests 1 failed | 14 passed (15)`
  («курсор и снимок …»); возвращено → `15 passed (15)`.
- `TURBO_CONCURRENCY=1 MONGO_URL_TEST=…/pokatim_s08b_test REDIS_URL_TEST=…/15 pnpm check` → `EXIT=0`:
  `All matched files use Prettier code style!`, `✔ no dependency violations found (1491 modules, 5515 dependencies
  cruised)`, typecheck `Tasks: 9 successful, 9 total`; тесты — admin `Test Files 38 passed (38)`, `Tests 343 passed
  (343)`, api `1453 passed`, app `1582 passed`, contracts `315 passed`, api-client `110 passed`, i18n `6 passed`,
  `Tasks: 15 successful, 15 total`.

### Фиксы ревью 08b pass 1

Ревью: Claude и Codex — REQUEST CHANGES. Findings — `findings-08b-claude.md`, `findings-08b-codex.md`. LOW-2
(Claude) принят без правки (решение оркестратора).

- HIGH-1: ошибка обновления сводки при показанных данных — данные остаются, сверху `Banner` (`role="alert"`,
  «Не удалось обновить рейтинг») с «Повторить» → `summary.refetch()`, как `RaceResultsScreen`.
- HIGH-2: шапка — `.skeleton` заголовка, пока грузится `seasonsQuery`; отказ — `Banner` «Не удалось загрузить
  название и даты сезона» с повтором `seasons.refetch()`, рейтинг показывается (и на 404 сводки); ответ без сезона —
  общее название.
- MEDIUM-1: «N гонок, в зачёте K · M участников» — из ответа таблицы (`pages[0]`), пока она грузится — из сводки.
- LOW-1: пустая таблица из сводки (RC-12) — «В таблице пока нет участников».
- LOW-3: `admin.standings.tableMeta` = `{group} · {bikeClass} · {races} · {riders}`, плюрали `admin.standings.races`
  («1 гонка / 3 гонки / 5 гонок, в зачёте K») и `admin.standings.riders` («1 участник / 2 участника / 5 участников»).
- LOW-4: тест 403 → «Нет доступа к разделу».
- Тесты (до кода, были красными: `Tests 6 failed | 14 passed (20)`; тест 403 сразу зелёный — ветка уже была):
  `SeasonScreen.test.tsx` +5 — ошибка обновления сводки → баннер → повтор; скелетон заголовка; отказ сезонов →
  баннер → повтор; подпись из ответа таблицы и плюрали; 403. Обновлены: подпись в тесте переключателей, RC-12.
  `vitest run src/features/seasons` → `Tests 28 passed (28)`.
- `TURBO_CONCURRENCY=1 MONGO_URL_TEST=…/pokatim_s08b_test REDIS_URL_TEST=…/15 pnpm check` → `EXIT=0`:
  `All matched files use Prettier code style!`, `✔ no dependency violations found (1491 modules, 5515 dependencies
  cruised)`, typecheck `Tasks: 9 successful, 9 total`; тесты — admin `Tests 348 passed (348)`, api `1453 passed`
  (кэш turbo: входы api не менялись с прогона выше), app `1582 passed`, contracts `315 passed`, api-client
  `110 passed`, i18n `6 passed`, `Tasks: 15 successful, 15 total`.
