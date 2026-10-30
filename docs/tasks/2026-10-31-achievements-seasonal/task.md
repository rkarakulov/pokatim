# Достижения: сезонные

Уровень: task3 (контракт, коллекция/индекс, сверка, приложение). Follow-up 2/3 серии
(`docs/tasks/2026-10-30-achievements-levels` — уровни; дальше — push и ручная выдача в панели). Out of Scope v1:
«Сезонные достижения (победитель сезона и т. п.)».

## 1. Title

Сезонные достижения по итогам рейтинга завершённого сезона: «Чемпион сезона», «Призёр сезона», «Сезон в зачёте».

## 2. Goal

По итогам завершённого сезона райдер получает достижения за место в таблице сезона и за регулярное участие — по
одному за каждый сезон; они видны в профиле (и публично — это протоколы) и вспыхивают как обычные.

### Решения S1–S8 (автор — сессия follow-up, 2026-10-31; спеки сезонных в `docs/product` не было)

- **S1 — каталог** (новые коды в конец `ACHIEVEMENT_CODES`, без уровней):

  | Код | Название | Условие |
  |---|---|---|
  | `season_champion` | Чемпион сезона | место 1 (ничья `=1` — тоже) в любой таблице «класс × группа» сезона |
  | `season_podium` | Призёр сезона | место 1–3 в любой таблице сезона |
  | `season_regular` | Сезон в зачёте | ≥ 3 гонок «в зачёте» сезона (ячейки строки с местом, не DQ) в одной таблице |

  Чемпион получает и «Призёра» (как «Победа» + «Подиум» в v1).
- **S2 — только завершённый сезон** (фаза «Завершён»: последний день сезона по Минску прошёл) и только по актуальному
  снимку рейтинга (не «ждёт пересчёта»: снимок устарел — сезонные этого сезона в сверке не меняются, ни выдача, ни
  отзыв). Источник — снимок `standings` через порт, не пересчёт.
- **S3 — по одному за сезон.** Одинаковый код за разные сезоны — разные выдачи. Объект — сезон
  (`{ kind: 'season', id, title }`, название — текущее), дата факта — последний день сезона.
- **S4 — отзыв и возврат** — как A4: новая ревизия протокола после пересчёта снимка изменила место — достижение
  пропадает/появляется молча; уже показанное не вспыхивает снова.
- **S5 — первая сверка тихая** (A3). У райдеров, уже прошедших сверку, при выкладке сезонные за прошлые сезоны
  вспыхнут — по одной на сезон и код (сезонов мало; принимается, как новый код в ADR-0020).
- **S6 — видимость:** свои — в профиле; публичный профиль — тоже (это результаты протоколов, R9), при тех же
  условиях публичности.
- **S7 — экран и шеринг:** на экране достижения и во вспышке — сезон («Сезон «Сезон 2026»»), кнопка «К сезону» →
  `/seasons/<id>`. Карточка для сторис для сезонных — не в этом PR (кнопки «Поделиться» у них нет).
- **S8 — прогресс** (L4) сезонных не показывает.

## 3. Scope

### API
1. Порт `standings` → `achievements`: итоговые строки райдера по завершённым сезонам с актуальным снимком (место,
   число зачётных гонок, сезон, дата окончания) — реализация в модуле-владельце, `achievements` чужих коллекций не
   читает. Названия сезонов — через порт.
2. Политика: правила сезонных кодов — чистые функции, результат — набор `(code, seasonId)`; сверка плана с
   выдачами по ключу `(code, scope)`; сезоны со снимком «ждёт пересчёта» — выдачи не трогаются.
3. Коллекция: выдача сезонного кода — отдельный документ на `(userId, code, seasonId)`; уникальный индекс
   расширяется (миграция — номер сверить с develop), документы v1 остаются валидными.
4. `POST /v1/achievements/seen`: адресация сезонной выдачи (код + сезон) с сохранением совместимости старых сборок
   (`{ codes }` продолжает работать для несезонных).
5. Контракты: коды, вид объекта `season` (через `tolerantEnum`), схема `seen`; публичный список — с сезонными;
   `api-client`.
6. Стирание аккаунта — уже `deleteMany` по `userId` (проверить тестом).

### Приложение
1. Каталог: три кода, иконки (существующие), тексты; ключи React/вспышки/`seen` — `code` + объект для сезонных.
2. Экран достижения и вспышка — «К сезону»; без «Поделиться» для сезонных.
3. Публичный профиль — сезонные в блоке.
4. i18n.

## 4. Out of Scope

- Карточка сторис сезонного достижения, push (PR P), ручная выдача (PR P).
- Сезонные для START/без места; достижения за «Таблицу сезона» в незавершённом сезоне.

## 5. Architecture Context

Architecture Review (architect, 2026-10-31; пересмотрен по решениям оркестратора) — **Status: CONCERNS** (блокеров нет).
- RC-S1…RC-S4 и RC-S7 приняты по рекомендации, остальные RC тоже приняты.
- По HG-S1 выбрана отдельная коллекция сезонных выдач: деструктивных операций нет.

- **Модель ADR-0020 не меняется.** Выдача — проекция фактов, сверка при `GET /v1/achievements`. Каждая запись — одна
  условная операция над одним документом без транзакций. Маркер первой сверки (`achievement_syncs`) общий и ставится
  **после** выдач обеих коллекций.
- **Сезонные выдачи — отдельная коллекция `achievement_season_grants`.** Один документ на `(userId, code, seasonId)`,
  уникальный индекс `achievement_season_grants_user_code_season_unique`. Единственный писатель — тот же
  `AchievementsRepository`.
  - `achievement_grants`, его индекс `achievement_grants_user_code_unique` и документы v1 не меняются (AC6 —
    по построению).
  - Миграция `0043_achievements_seasonal` — только expand. Номер свободен: в `origin/develop` последняя —
    `0042_profile_report_reasons`. Перед мержем проверить ещё раз.
  - Удаления индекса и HG нет.
- **Источник — снимок `standings` через порт, не пересчёт.** `achievements` не читает чужие коллекции
  (`season_standing_rows`, `season_standings`, `seasons`, `races`).
  - Новый порт **`RIDER_SEASON_STANDINGS`** — в модуле-владельце снимка `standings` (`StandingsCoreModule`).
  - Сезоны и «ждущие протокола» порт берёт у `races` через `SEASON_RACES`; это ребро уже есть.
  - Новое ребро — только `achievements → standings` (через `standings/index.ts`), только в `AchievementsModule`
    (HTTP). `standings`, `races` и `results` об `achievements` не знают — циклов нет.
  - `AchievementsReadModule` и `sharing` порт не получают: у сезонных нет карточки (S7).
- **«Завершён» и «актуальный снимок» определяет порт, решения о кодах — `achievements`.**
  - Порт отдаёт по каждому нужному завершённому сезону статус `final | pending` и строки райдера: место, ничья, число
    ячеек «с местом».
  - Пороги (место 1, места 1–3, ≥ 3 гонки, RC-S1) — чистые функции `achievements.policy.ts`.
  - Сезон `final`, когда выполнены все три условия:
    1. последний день по Минску прошёл (`endsBefore ≤ now`);
    2. у сезона нет опубликованной гонки с коридором без протокола (RC-S2);
    3. заголовок снимка есть, и его `fingerprint` равен отпечатку источника (`StandingsSource` — тот же расчёт, что у
       регламента и у `sync: pending` панели).
  - Иначе сезон `pending`, и сезонные выдачи этого сезона сверка не трогает — ни вставки, ни отзыва (S2).
- **GET остаётся лёгким.** Шаги порта:
  1. `seasons.find({ endsBefore ≤ now })` — сезонов десятки. Если их нет — выход.
  2. В одной snapshot-сессии:
     - `season_standing_rows.find({ seasonId: { $in: завершённые }, userId })` — существующий индекс
       `season_standing_rows_user_idx (seasonId, userId)`, по одному seek на сезон, **новый индекс не нужен**;
     - заголовки снимков только для «нужных» сезонов. Нужные — сезоны строк ∪ сезоны уже сохранённых сезонных выдач
       (их нужно уметь отозвать, если строки пропали).
     - Если нужных нет — выход. Типичный райдер без сезонных итогов: **2 запроса**.
  3. Только для нужных сезонов: «гонки без протокола» (`races` по префиксу `seasonId`) и источник
     (`protocolRaces({ $in })` по `races_protocol_idx` + один `aggregate` `currentRevisions`) — ещё **3 запроса**.

  Плюс одно чтение `achievement_season_grants` по `userId` в сверке. Итого +3…6 запросов по индексам, без разбора
  треков, пересчёта и записи у источника. Заголовок и строки читаются в одной snapshot-сессии: их пишет одна транзакция
  `claimSeason` + `replaceRows`. Источник читается **после** снимка: пересчёт между чтениями даст расхождение
  отпечатков → `pending` (безопасная сторона).
- **Гонки: замки не нужны (подтверждаю).** Каждая запись — одна условная операция над одним документом:
  - параллельная вставка — уникальный индекс своей коллекции (`isDuplicateKey` → `false`);
  - `restore` — с условием `revokedAt ≠ null`, `revoke` — только видимой выдачи;
  - «показано» — по одной `updateMany` на коллекцию, каждая атомарна на свой документ. Межколлекционной атомарности
    не требуется: каждая выдача помечается независимо.

  Два GET с разными снимками (до и после пересчёта) могут на мгновение разойтись: устаревший отзовёт, свежий вернёт с
  прежним `seenAt` без повторной вспышки (A4/S4). Следующая сверка сводит состояние — это eventual consistency из
  ADR-0020. Маркер ставится после выдач обеих коллекций, поэтому тот, кто увидел маркер, видит и тихие выдачи.
- **Ни очередей, ни outbox, ни регламента, ни append-only.** Регламент `standings.sync` не меняется, задач BullMQ нет.
  Push — в PR P.
- **Совместимость.**
  - Старые сборки: новые коды и вид `season` → `'unknown'` (`tolerantEnum`), `knownItems` их отбрасывает.
  - `{ codes }` работает как прежде и относится только к `achievement_grants`.
  - Новая сборка со старым API: сезонных в ответе нет, поэтому `seasonal` в запросе не уходит (клиент шлёт поле только
    непустым; иначе строгий запрос старого API ответил бы 400).
  - Выкат: миграция только добавляет. Старый процесс API новую коллекцию не видит и не трогает.

## 5.1 Placement & Reuse Gate

| Что | Где | Почему / reuse |
|---|---|---|
| Коды `season_regular`, `season_podium`, `season_champion` (в конец, порядок RC-S4), `SEASONAL_ACHIEVEMENT_CODES`, `SeasonalAchievementCode`, `isSeasonalCode`, `SEASON_REGULAR_MIN_RACES = 3`, вид объекта `season`, `SeasonalAchievementRef`, новая схема `MarkAchievementsSeenRequest` | `packages/contracts/src/achievements/achievement.schema.ts` (+ `src/index.ts`) | ≥ 3 потребителя (политика API, приложение, api-client); порог — одна константа (как `ACHIEVEMENT_LEVEL_TARGETS`, RC-L1) |
| Порт `RIDER_SEASON_STANDINGS` (тип + символ) | новый `apps/api/src/modules/standings/rider-season-standings.port.ts`, экспорт `standings/index.ts` | владелец снимка — `standings`; `achievements` чужих коллекций не читает |
| Реализация порта | новый `apps/api/src/modules/standings/rider-season-standings.ts` (`RiderSeasonStandingsService`), провайдер + экспорт `StandingsCoreModule` | reuse: `StandingsRepository.withSnapshot`, `StandingsSource.load` (тот же отпечаток, что у регламента и панели), `SEASON_RACES` |
| Чтение снимка по нескольким сезонам | `standings.repository.ts`: `rowsOfUserIn(seasonIds, userId, session)`, `headersOf(ids, session)` (проекция `_id`, `fingerprint`) | существующий индекс `(seasonId, userId)`, нового нет |
| Источник по набору сезонов | `standings-source.ts`: `load(seasonIds?: readonly string[])` (вызовы: `recalc.sync()` → `load()`, `panelSummary` → `load([id])`) | второго расчёта отпечатка нет |
| Сезоны и «ждущие протокола» | `races/season-races.port.ts` + `season-races.ts`: `finishedSeasons(now)`, `awaitingProtocol(seasonIds)`, `protocolRaces(seasonIds?: readonly string[])`; `races.repository.ts` | `races` — владелец сезонов; порт уже экспортирован для `standings` |
| Правила сезонных и план сезонной сверки | `apps/api/src/modules/achievements/achievements.policy.ts` (`SEASONAL_RULES`, `seasonalAchievements`, `seasonalPlan`) | чистые функции; `reconcilePlan` несезонных — только по `FactAchievementCode` |
| Коллекция `achievement_season_grants` | `achievements.collection.ts` (`AchievementSeasonGrantDoc`, `ACHIEVEMENTS_COLLECTIONS.seasonGrants`) | данные модуля — его коллекции |
| Запись и чтение сезонных выдач, «показано», стирание обеих | `achievements.repository.ts` — **единственный писатель** обеих коллекций и маркера | второго репозитория нет |
| Сверка и публичный список с сезонными | `achievements.service.ts`, `achievements.module.ts` (+ `StandingsCoreModule`), `achievements.controller.ts` (`seen`) | явный список полей |
| Стирание | `achievement-erasure.ts` (результат + `seasonGrants`) | порт прежний, шаг `achievements` прежний |
| Отказ карточки для сезонных | `achievements-for-sharing.ts` (сезонный код → `null` → 409), `sharing/achievement-card.icons.ts` (`Record<FactAchievementCode, …>`) | `renderVersion` не меняется |
| Миграция (expand-only) | новый `apps/api/src/db/migrations/0043_achievements_seasonal.ts` + `index.ts` + `migrations.int.test.ts` | образец — `0035_achievements` |
| Каталог (3 кода, флаги `storyCard` и `seasonal`, иконки `trophy`/`medal`/`calendar`), `achievementKey`, `flashKey`, путь экрана | `apps/app/src/features/achievements/achievement-catalog.ts` | одна функция ключа для React, вспышки, `seen` и экрана |
| Пометка по адресам | `queries.ts` (`useMarkAchievementsSeen` — цели `{ code, seasonId }`), `packages/api-client/src/index.ts` | — |
| Экран и вспышка: «К сезону», без «Поделиться» | `achievement-screen.tsx`, `achievement-flash-screen.tsx`, `src/app/achievements/[code].tsx` (`?season=`) | `/seasons/<id>` уже есть |
| Ключи плиток и переход | `achievements-block.tsx`, `features/profile/own-profile-screen.tsx` | — |
| Строки | `packages/i18n/src/ru.ts` | en-словаря нет |

**Запрещённые дубли:**
- второй расчёт отпечатка источника или мест сезона в `achievements` — только порт → `StandingsSource` и снимок;
- чтение `season_standing_rows` / `season_standings` / `seasons` / `races` из `achievements`;
- новый индекс `season_standing_rows` по `userId`;
- второй писатель `achievement_season_grants` или второй маркер первой сверки;
- поле `seasonId` в `achievement_grants`;
- копия порога «3 гонки» в приложении — только `SEASON_REGULAR_MIN_RACES`;
- ключи React и `seen` по голому `code` в приложении.

## 6. Relevant Files

API / контракты:
- `packages/contracts/src/achievements/achievement.schema.ts`, `.test.ts`; `packages/contracts/src/index.ts`;
  `packages/contracts/src/common.ts` (`tolerantEnum`, не менять).
- `packages/api-client/src/index.ts` (`markAchievementsSeen`), `packages/api-client/src/achievements.test.ts`.
- `apps/api/src/modules/standings/`: `index.ts`, `standings.module.ts`, `standings.repository.ts`, `standings-source.ts`,
  `standings-read.service.ts` (`panelSummary` → `load([id])`), `standings-recalc.ts` (`load()`), новые
  `rider-season-standings.port.ts`, `rider-season-standings.ts`, `rider-season-standings.int.test.ts`. Читать:
  `standings.collection.ts`, `standings.policy.ts` (`sourceFingerprint`, `cellOf`: `outcome: 'placed' | 'dq' | 'none'`).
- `apps/api/src/modules/races/`: `season-races.port.ts`, `season-races.ts`, `races.repository.ts`
  (`listProtocolRaces`, новый запрос «ждут протокола»), `races.policy.ts` (`seasonPhase` — образец условия «завершён»).
- `apps/api/src/modules/achievements/`: `achievements.policy.ts`, `.policy.test.ts`, `achievements.collection.ts`,
  `achievements.repository.ts`, `achievements.service.ts`, `achievements.controller.ts`, `achievements.module.ts`,
  `achievements-for-sharing.ts`, `achievements.int.test.ts`; `apps/api/src/modules/sharing/achievement-card.icons.ts`,
  `achievement-card.int.test.ts` (сезонный код → 409).
- `apps/api/src/db/migrations/0043_achievements_seasonal.ts` (новая, только expand), `index.ts`,
  `migrations.int.test.ts`; образец — `0035_achievements.ts`.
- Тестовые хелперы: `apps/api/test/standings.ts` (`seedSeason` — добавить даты, `seedProtocolRace`, `addRevision`,
  `syncStandings`), `apps/api/test/achievements.ts`.
- Стирание: `apps/api/src/modules/achievements/achievement-erasure.ts` (счётчик `seasonGrants`, тест).

Приложение:
- `apps/app/src/features/achievements/achievement-catalog.ts`, `.test.ts`, `queries.ts`, `queries.test.tsx`,
  `flash-session.test.ts`, `achievement-flash-screen.tsx`, `achievement-screen.tsx`, `achievement-card.tsx`
  (`.test.tsx`), `achievements-block.tsx`; `apps/app/src/app/achievements/[code].tsx`;
  `apps/app/src/features/profile/own-profile-screen.tsx`; `apps/app/src/__tests__/achievements-blocks.test.tsx`;
  `apps/app/src/features/achievements/story/achievement-story-screen.tsx` (сезонный код по прямому адресу —
  состояние «нет карточки», без запроса).
- `packages/i18n/src/ru.ts` (блок `achievements.*`).

Документы: `docs/product/profile.md`, `docs/product/races-and-seasons.md` (раздел рейтинга сезона — ссылка),
`docs/adr/0020-achievements-reconcile-on-read.md`, `.claude/rules/pokatim-{backend,db,contracts,security,app}.md`.

## 7. Implementation Notes

### 7.1 Контракты

```ts
export const ACHIEVEMENT_CODES = [
  /* …9 прежних… */
  'season_regular',
  'season_podium',
  'season_champion',
] as const;

/** Сезонные коды (S1): выдача — на сезон, объект — сезон; уровней нет. */
export const SEASONAL_ACHIEVEMENT_CODES = ['season_regular', 'season_podium', 'season_champion'] as const satisfies readonly AchievementCode[];
export type SeasonalAchievementCode = (typeof SEASONAL_ACHIEVEMENT_CODES)[number];
export const isSeasonalCode = (code: AchievementCode): code is SeasonalAchievementCode =>
  (SEASONAL_ACHIEVEMENT_CODES as readonly string[]).includes(code);
/** «Сезон в зачёте» (S1): гонок с местом в одной таблице сезона. Выпущенное значение не меняется. */
export const SEASON_REGULAR_MIN_RACES = 3;

export const ACHIEVEMENT_OBJECT_KINDS = ['race', 'route', 'ride', 'season'] as const;

/** Адрес сезонной выдачи в `POST seen`. */
export const SeasonalAchievementRef = z.strictObject({
  code: z.enum(SEASONAL_ACHIEVEMENT_CODES),
  seasonId: Uuid,
});
export const SEASONAL_SEEN_MAX = 30;

/**
 * `POST /v1/achievements/seen`: `codes` — несезонные (сезонный код в `codes` — без записи, как незнакомый); `seasonal` —
 * сезонные по `(code, seasonId)`. Хотя бы один адрес; без повторов. Старые сборки шлют `{ codes }` (1–N) — валидно.
 */
export const MarkAchievementsSeenRequest = z
  .strictObject({
    codes: z.array(AchievementCode).max(ACHIEVEMENT_CODES.length).refine(unique, …).default([]),
    seasonal: z.array(SeasonalAchievementRef).max(SEASONAL_SEEN_MAX).refine(uniqueByCodeSeason, …).default([]),
  })
  .refine((b) => b.codes.length + b.seasonal.length > 0, { error: fieldError('REQUIRED'), path: ['codes'] });
```

- В `Achievement` и `PublicRiderAchievement` **нового поля нет**: сезон адресуется объектом
  `{ kind: 'season', id: seasonId, title: название }`, `level: null`. Ключ элемента в клиенте — `code` + `object.id`
  для `kind === 'season'`.
- Тест схемы: `{ codes: [...] }` без `seasonal` валиден (как в v1); `{}` и `{ codes: [] }` → 400; лишний ключ → 400;
  `seasonal` с несезонным кодом → 400; `object.kind: 'season'` разбирается, а `'planet'` даёт `'unknown'`; ответ v1
  разбирается.
- Комментарий каталога («каждое — один раз на райдера») поправить: сезонные — один раз на сезон.

### 7.2 Порт `standings` → `achievements`

```ts
// apps/api/src/modules/standings/rider-season-standings.port.ts
export const RIDER_SEASON_STANDINGS = Symbol('RIDER_SEASON_STANDINGS');

/** Строка райдера в таблице «класс × группа» итогового снимка сезона. */
export interface RiderSeasonRow {
  bikeClass: BikeClass;
  groupKey: ResultGroupKey;
  /** место в таблице (ничья «=N» — N) */
  place: number;
  tied: boolean;
  /** ячеек с `outcome: 'placed'` (финиш с местом в протоколе; DQ и «нет строки» не считаются) */
  placedRaces: number;
}

export type RiderSeasonOutcome =
  | { seasonId: string; status: 'final'; title: string; endsOn: string; endsBefore: Date; rows: RiderSeasonRow[] }
  | { seasonId: string; status: 'pending'; title: string };

export interface RiderSeasonStandings {
  /**
   * Итоги райдера по **завершённым** сезонам, где у него есть строки снимка, и по сезонам `alsoSeasonIds` (сохранённые
   * выдачи; там строк может уже не быть — тогда `final` с `rows: []`). `final`: последний день прошёл, гонок с
   * коридором без протокола нет, снимок есть и его отпечаток равен источнику. Иначе `pending`. Незавершённые и
   * неизвестные сезоны в ответ не попадают. Только чтение.
   */
  outcomesOf(userId: string, alsoSeasonIds: readonly string[], now: Date): Promise<RiderSeasonOutcome[]>;
}
```

Порядок в реализации (`RiderSeasonStandingsService`, `StandingsCoreModule`):

1. `SEASON_RACES.finishedSeasons(now)` → `{ id, name, endsOn, endsBefore }[]`. Пусто — `[]`.
2. `withSnapshot`: `rowsOfUserIn(finishedIds, userId)`, затем `relevant = сезоны строк ∪ (alsoSeasonIds ∩ finishedIds)`.
   Пусто — `[]`. Затем `headersOf(relevant)`.
3. `SEASON_RACES.awaitingProtocol(relevant)` (`Set` сезонов с опубликованной гонкой: `status: 'published'`,
   `protocolPublishedAt: null`, `corridor: { $ne: null }`) и `StandingsSource.load(relevant)`.
4. `final` ⇔ `!awaiting.has(id) && header && source.get(id)?.fingerprint === header.fingerprint`.
   `placedRaces = row.cells.filter((c) => c.outcome === 'placed').length`.

- Логи порта — только при сбое (без `userId` в тексте; как `standings.*`). Регламент не трогается.
- `protocolRaces(seasonIds?)`: `seasonId: seasonIds ? { $in: [...seasonIds] } : { $type: 'string' }` — условие
  `protocolPublishedAt: { $type: 'date' }` частичного индекса сохраняется (RC-4 race-results-08).

### 7.3 Политика (`achievements.policy.ts`)

```ts
export type FactAchievementCode = Exclude<AchievementCode, SeasonalAchievementCode>;
export const FACT_ACHIEVEMENT_CODES = ACHIEVEMENT_CODES.filter((c): c is FactAchievementCode => !isSeasonalCode(c));
export const ACHIEVEMENT_RULES = { … } satisfies Record<FactAchievementCode, (facts: Sorted) => Earned | null>;
// evaluateAchievements, progressOf, reconcilePlan обходят только FACT_ACHIEVEMENT_CODES (RC-S7)

export const SEASONAL_RULES = {
  season_regular: (rows) => rows.some((r) => r.placedRaces >= SEASON_REGULAR_MIN_RACES),
  season_podium: (rows) => rows.some((r) => r.placedRaces >= 1 && r.place <= PODIUM_MAX),   // RC-S1
  season_champion: (rows) => rows.some((r) => r.placedRaces >= 1 && r.place === 1),         // RC-S1
} satisfies Record<SeasonalAchievementCode, (rows: readonly RiderSeasonRow[]) => boolean>;

export interface SeasonalKey { code: SeasonalAchievementCode; seasonId: string }
export const seasonalKey = (k: SeasonalKey) => `${k.code}:${k.seasonId}`;
export interface SeasonalEarned extends SeasonalKey { factAt: Date; title: string }  // title — название сезона

/** Сезонные (S1–S3): заработанные по `final`-сезонам; `settled` — сезоны, где сверка вправе менять выдачи. */
export function seasonalAchievements(outcomes: readonly RiderSeasonOutcome[]): {
  earned: Map<string, SeasonalEarned>;   // factAt = endsBefore − 1 мс (minskToday → endsOn; RC-S6)
  settled: ReadonlySet<string>;          // seasonId со статусом final
};

export interface StoredSeasonGrant extends SeasonalKey { factAt: Date; seenAt: Date | null; revokedAt: Date | null }
export type SeasonalStep =
  | { type: 'insert'; earned: SeasonalEarned; seenAt: Date | null }   // seenAt = first ? now : null (A3/S5)
  | { type: 'restore'; key: SeasonalKey }                              // seenAt прежний (S4)
  | { type: 'revoke'; key: SeasonalKey };

/** План сезонной сверки: только ключи `settled`-сезонов; несеттлированные — ни вставки, ни отзыва (S2). Чистая. */
export function seasonalPlan(
  stored: readonly StoredSeasonGrant[],
  earned: ReadonlyMap<string, SeasonalEarned>,
  settled: ReadonlySet<string>,
  first: boolean,
  now: Date,
): SeasonalStep[];
```

- Обход — объединение ключей `stored` ∪ `earned` в детерминированном порядке: каталог, затем `seasonId`.
- `refresh` у сезонных нет. Объект — сам сезон, а дата не меняется: у завершённого сезона даты менять нельзя
  (`SEASON_FINISHED`), название не хранится.
- `reconcilePlan` несезонных — прежний, обходит `FACT_ACHIEVEMENT_CODES` (RC-S7: иначе `ACHIEVEMENT_RULES[code]` для
  сезонного кода — ошибка типов и мусорные шаги).
- `sortForList` обобщается до `{ code, factAt }` и сортирует общий список. При порядке RC-S4 в одном сезоне первым
  идёт «Чемпион», во вспышке (обратный порядок) — по нарастающей.

### 7.4 Коллекция, репозиторий, миграция

```ts
// achievements.collection.ts
export const ACHIEVEMENTS_COLLECTIONS = {
  grants: 'achievement_grants',
  seasonGrants: 'achievement_season_grants',
  syncs: 'achievement_syncs',
} as const;

/** Сезонная выдача (S3): один документ на `(userId, code, seasonId)` (уникальный индекс). Не append-only. */
export interface AchievementSeasonGrantDoc {
  _id: string;            // uuidv7
  userId: string;
  code: SeasonalAchievementCode;
  seasonId: string;
  factAt: Date;           // endsBefore − 1 мс
  grantedAt: Date;
  seenAt: Date | null;
  revokedAt: Date | null;
  updatedAt: Date;
}
```

- Названия сезона и мест в документе нет: название берётся из порта при каждом ответе (S3), место не нужно.
- `AchievementsRepository` — **единственный писатель** `achievement_grants`, `achievement_season_grants`,
  `achievement_syncs`. Новые методы:
  - `listSeasonalOf(userId)` — проекция без `_id`/`userId`, индекс по префиксу `userId`;
  - `insertSeasonal(userId, earned, seenAt, now)` — дубль `achievement_season_grants_user_code_season_unique` → `false`;
  - `revokeSeasonal(userId, key, now)` — `{ userId, code, seasonId, revokedAt: null }`;
  - `restoreSeasonal(userId, key, now)` — `{ userId, code, seasonId, revokedAt: { $ne: null } }` → `revokedAt: null`;
    `seenAt` и `grantedAt` не трогаются.
  - Прежние методы `achievement_grants` не меняются.
- `markSeen(userId, codes, seasonal, now)` — две независимые атомарные операции:
  - `codes` непуст — прежняя pipeline-`updateMany` по `achievement_grants`;
  - `seasonal` непуст — `updateMany({ userId, revokedAt: null, seenAt: null, $or: seasonal.map(({ code, seasonId }) => ({ code, seasonId })) }, { $set: { seenAt: now, updatedAt: now } })`.
  - Значения в фильтре — примитивы после zod (`Uuid`, строгий enum). Сезонный код в `codes` совпадений в
    `achievement_grants` не найдёт — записи нет.
- `deleteAllOf(userId)` → `{ grants, seasonGrants, syncs }` — `deleteMany({ userId })` обеих коллекций, затем маркер.
  Повтор даёт нули. `AchievementErasure` логирует новый счётчик.
- **`0043_achievements_seasonal`** — только expand, идемпотентна, без транзакции, без бэкфилла:
  `ensureCollection(achievement_season_grants)` + `createIndex({ userId: 1, code: 1, seasonId: 1 }, { name: 'achievement_season_grants_user_code_season_unique', unique: true })`.
  - Префикс `userId` индекса покрывает список, «показано» и стирание.
  - `ACHIEVEMENT_SEASON_INDEXES` экспортировать для `migrations.int.test.ts`, как в `0035`.
  - `achievement_grants` и его индекс не трогаются.

### 7.5 Сервис

- `sync`:
  1. Параллельно: `Promise.all([facts.evaluate, repository.listOf, repository.listSeasonalOf, repository.syncedAt])`.
  2. `standings.outcomesOf(userId, seasonIdsOf(storedSeasonal), now)` → `seasonalAchievements`.
  3. `reconcilePlan(...)` и `seasonalPlan(...)`; шаги выполняются по одному.
  4. **После обеих групп шагов** — маркер, если `first`.
  5. Перечитать обе коллекции (видимые).
  6. Ответ: несезонные — как сейчас; сезонные — видимые ∩ заработанные по `final`-сезонам (S2):
     `{ code, object: { kind: 'season', id: seasonId, title }, factDate: minskToday(factAt), level: null, seen: seenAt !== null }`.
  7. Общая сортировка — `sortForList`.
- Видимая сезонная выдача сезона в `pending` в ответе **есть**. Она не отозвана, название берётся из `title`
  `pending`-исхода порта (порт отдаёт `title` и для `pending`). Иначе она мерцала бы минуту после каждой ревизии.
- `publicList`: к гоночным добавить сезонные по `final` из `outcomesOf(rider.userId, [], now)` **без записи и без
  чтения выдач** (RC-S5: сезоны в `pending` в публичном ответе временно не видны).
- `markSeen(userId, { codes, seasonal })` — лимит прежний.
- Лог `achievements.sync` — счётчики двух планов, без кодов и сезонов (например, `seasonal_granted`,
  `seasonal_revoked`, `seasonal_restored`). Пишется, только если хотя бы один план не пуст.

### 7.6 Приложение

- Каталог: три записи (`season_champion` — `trophy`, `season_podium` — `medal`, `season_regular` — `calendar`).
  У сезонных `shareable: false`, `public: true`, новые флаги `storyCard: false` (у остальных `true`) и
  `seasonal: true`. Условие `season_regular` — `t(…, { count: SEASON_REGULAR_MIN_RACES })`.
- `achievementKey(item) = item.object.kind === 'season' ? \`${item.code}:${item.object.id}\` : item.code`;
  `flashKey(item) = \`${achievementKey(item)}:${item.level ?? ''}\``. Это ключи React (`Tile`, вспышка), поиска на
  экране, сессии вспышки и оптимистичной пометки.
- `seenTarget(item): { code; seasonId: string | null }`. `useMarkAchievementsSeen` принимает `SeenTarget[]`:
  `api.markAchievementsSeen(token, codes, seasonal)`, а `setSeen` и откат идут по `achievementKey`. Сохранять
  `{ ...list, items }` (RC-L3).
- Путь экрана — `achievementPath(item)`: `/achievements/<code>`, у сезонных `?season=<id>`. `[code].tsx` читает
  `season`. `AchievementScreen({ code, season })` ищет по ключу.
- Экран и вспышка: «Поделиться» — только при `catalogEntry(code).storyCard`. У объекта-сезона кнопка «К сезону»
  (`achievements.toSeason`) → `/seasons/<id>`: на экране `push`, во вспышке `replace`, как переход к сторис.
- `achievementObjectText`: `season` → `achievements.object.season` «Сезон «{title}»» (RC-S8).
- `api-client.markAchievementsSeen(accessToken, codes, seasonal = [])` — тело `{ codes, ...(seasonal.length ? { seasonal } : {}) }`.
- i18n: `achievements.season_champion.{title,condition}` «Чемпион сезона» / «Первое место в таблице сезона»;
  `season_podium` «Призёр сезона» / «Место с первого по третье в таблице сезона»; `season_regular` «Сезон в
  зачёте» / «Финиш с местом в {count} гонках одной таблицы сезона»; `achievements.object.season`;
  `achievements.toSeason` «К сезону».
- Публичный профиль: `publicItems` по `public: true` уже берёт сезонные; плитка без перехода. Ключ — `achievementKey`.

### 7.7 Security checklist (зона `achievements/**`, `standings/**` — `pokatim-security.md`)

- [ ] Новых эндпоинтов нет; `AuthGuard`, `no-store`, лимиты, `userId` в каждом фильтре — без изменений; порт берёт
      `userId` только от сервиса (из access).
- [ ] `POST seen`: `strictObject`, `seasonal` ≤ 30, `seasonId` — `Uuid`, код — строгий enum сезонных, без повторов.
      В фильтр — только примитивы. Чужие, отозванные и незнакомые адреса — без записи и без ошибки.
- [ ] Наружу — прежний явный список полей (`code`, `object{kind,id,title}`, `factDate`, `level`, свой — `seen`); id
      сезона публичен (`/seasons/:id`). Без мест, очков и таблицы в ответе достижений; `userId` и `_id` выдачи
      наружу не выходят (сезон — только `object.id`).
- [ ] Публично — только при `findPublic` (имя + согласие), иначе один 404. Сезонные — из протоколов (R9), без записи.
- [ ] GET пишет ≤ 9 документов `achievement_grants` + ≤ 3 `achievement_season_grants` на завершённый сезон райдера (обновить формулировку правила). Логи — `uid` и счётчики; без кодов,
      сезонов, мест.
- [ ] Карточка сторис: сезонный код → 409 (порт `null`), без рендера.

### 7.8 Test matrix

| Уровень | Что | AC |
|---|---|---|
| unit contracts | новые коды в конце (порядок RC-S4); `kind: 'season'`; `'planet'` → `unknown`; `seen`: `{codes}` v1 валиден, `{seasonal}` валиден, `{}` и пустые массивы → 400, лишний ключ → 400, несезонный код в `seasonal` → 400, повтор `(code, seasonId)` → 400, > 30 → 400 | AC6 |
| unit policy | `SEASONAL_RULES`: место 1 / `=1` (tied) / 3 / 4; 2 vs 3 ячейки с местом; DQ не считаются; **строка только из DQ на месте 2 — не призёр** (RC-S1); чемпион ⇒ призёр. `seasonalAchievements`: `pending` → нет `earned`, сезон не `settled`; `factAt` → `minskToday = endsOn`. `seasonalPlan`: два ключа одного кода разных сезонов; сезон не `settled` → ни insert, ни revoke; `final` без строк → revoke; возврат → restore; первая сверка → insert с `seenAt`. `reconcilePlan` обходит только `FACT_ACHIEVEMENT_CODES` (регресс-набор прежних тестов зелёный) | AC1 |
| int standings (реальная Mongo) | `outcomesOf`: незавершённый сезон — нет в ответе; завершённый + актуальный снимок → `final` с `placedRaces`; новая ревизия без пересчёта → `pending`, после `syncStandings` → `final`; гонка с коридором без протокола → `pending` (RC-S2), гонка-анонс (`corridor: null`) и отменённая не мешают; `alsoSeasonIds` без строк → `final`, `rows: []`; райдер без строк → `[]`, `StandingsSource.load` не вызывается (шпион) | AC1, AC3 |
| int achievements | **AC2:** чемпион A + призёр B → 2 документа `season_podium` и 1 `season_champion` в `achievement_season_grants`; первая сверка тихая (маркер общий: тихо и для несезонных, и для сезонных); новая выдача после — `seen: false`; `seen` по `(code, seasonId)` помечает только её; `{codes:['season_podium']}` — 0 записей. **AC3:** `addRevision` → `syncStandings` → отзыв молча → обратная ревизия → возврат `seen: true`. `pending` между ревизией и пересчётом — выдачи не меняются, видимая остаётся в ответе. **AC4:** параллельные GET × 5 при первой выдаче — без 500 и дублей, `countDocuments` по ключу = 1. **AC5:** публичный — сезонные есть, точный список ключей; непубличный — 404. **AC6:** документ v1 `achievement_grants` → прежний ответ, `{codes}` работает, `achievement_grants` не получает сезонных документов. Стирание — обе коллекции и маркер (повтор → нули) | AC2–AC6 |
| int sharing | `GET /v1/achievements/season_podium/story-card` при выданном → 409 | S7 |
| int migrations | `0043`: коллекция и уникальный индекс есть; повторный `up` без ошибки; индексы `achievement_grants` не изменились; дубль `(userId, code, seasonId)` → E11000; два `season_podium` разных сезонов вставляются | AC4, AC6 |
| api-client | `markAchievementsSeen(t, codes)` шлёт `{codes}` без `seasonal`; с сезонными — оба поля; ответ с `kind: 'season'` и без сезонных разбирается | AC6, AC7 |
| app unit (jest/RTL) | каталог: `achievementKey`/`flashKey` у сезонных с `object.id`; `flashQueue` — два `season_podium` разных сезонов оба в очереди; `flash-session` по новому ключу; `setSeen` по ключу (помечает только свой сезон, сохраняет `progress`); экран `?season=` находит нужный; вспышка и экран сезонного — «К сезону», без «Поделиться»; плитки без дубля ключей; публичный блок с сезонными; старый ответ без сезонных; незнакомый код не ломает экран | AC7 |
| e2e web | не обязателен (существующий смоук `/profile`) | — |

## 8. Risks / Assumptions / Open Questions

- Снимок `standings` пересчитывается регламентом — между концом сезона и пересчётом снимок может быть «ждёт
  пересчёта»: выдача появится после пересчёта (при следующей сверке).
- Совместимость `seen` со старыми сборками: старая сборка сезонных кодов не знает (`unknown` отбрасывается) и их не
  отмечает — у неё они остаются непросмотренными до новой сборки (вспышка на новой — ожидаемо).

## 8.1 Requirements Consistency (architect)

Решения S1–S8 сохраняются. RC-S1 и RC-S2 уточняют S1/S2: без уточнения возникают вредные исходы. **Решения
оркестратора (2026-10-31): HG-S1 — отдельная коллекция; RC-S1…RC-S4, RC-S7 — по рекомендации; остальные RC —
приняты.**

- **HG-S1 — ключ выдачи с сезоном → решено: отдельная коллекция `achievement_season_grants`** (уточняет Scope API.3
  «уникальный индекс расширяется»).
  - Расширение индекса `achievement_grants` потребовало бы удалить `achievement_grants_user_code_unique` — это
    деструктивная операция (AGENTS §4.6).
  - Новая коллекция с уникальным `(userId, code, seasonId)` — чистый expand (`0043`). Документы v1 и индекс не
    меняются.
  - Цена — вторые методы репозитория, второе чтение в сверке, две операции в «показано» и `deleteMany` в стирании.
    Писатель тот же, маркер общий.
- **RC-S1 — принято: «Чемпион» и «Призёр» требуют финиша с местом** (`placedRaces ≥ 1`). В снимке у строки «только
  DQ» тоже есть `place` — его ставит порядок таблицы. Без условия в маленькой таблице можно стать «Призёром сезона»
  без единого финиша.
- **RC-S2 — принято: `final` = дата прошла и нет опубликованной гонки сезона с коридором без протокола.**
  Отменённые гонки и гонки-анонсы без коридора не мешают.
  - Причина: протокол публикуется не раньше конца окна + 48 ч. По одной дате таблица на следующий день после конца
    сезона была бы неполной — «Чемпион» вспыхнул бы и молча пропал.
  - Забытый протокол держит сезон в `pending`. Это видно в «Обзоре» панели («ждут протокола»).
- **RC-S3 — принято: «в зачёте» = ячейки с `outcome: 'placed'`**, независимо от `counted` (N из M). Порт отдаёт
  `placedRaces`. Имя `counted` в коде порта и политики не использовать.
- **RC-S4 — принято: порядок кодов `season_regular`, `season_podium`, `season_champion`** (в конец каталога). В
  профиле первым идёт «Чемпион», во вспышке — по нарастающей.
- **RC-S5 — принято: публичный профиль в окне `pending`.** Публичный список считается без записи и без чтения
  выдач. Сезонные сезона в `pending` (обычно ≤ 1 мин после ревизии) на это время не видны публично. В своём списке
  видимая выдача остаётся (7.5).
- **RC-S6 — принято: `factAt = endsBefore − 1 мс`** (`minskToday` → `endsOn`, S3). Отдельного поля даты нет.
- **RC-S7 — принято (обязательная правка): `reconcilePlan` и правила обходят только `FACT_ACHIEVEMENT_CODES`.**
  Сезонные сверяются отдельным `seasonalPlan` по ключу `(code, seasonId)`. Регресс-тесты прежнего плана остаются
  зелёными.
- **RC-S8 — принято: «Сезон «Сезон 2026»»** — так в S7, единообразно с «Гонка «…»».
- **RC-S9 — принято: таблица из одного райдера даёт «Чемпиона»** — последовательно с «Победой» v1 (первое место в
  своей группе). Пересмотреть по данным.
- **RC-S10 — принято: первая сверка при `pending`.** Новый райдер получит сезонные этого сезона позже и со вспышкой
  (A3 нарушается на секунды-минуты). Фиксируется в ADR.
- **RC-S11 — принято: стоимость GET** +3…6 запросов по индексам. Бюджет ADR-0020 «≤ ~10» → «≤ ~16». Новых индексов на
  `standings` нет.
- **RC-S12 — принято: `codes` в `seen` необязателен.** Схема мягче: `{ codes }` старых сборок валиден, `{}` → 400.
  Сезонный код в `codes` — без записи, как незнакомый.
- **Без находок:**
  - append-only и аудит не задействованы;
  - новых эндпоинтов, кодов ошибок и лимитов нет;
  - outbox и очереди не нужны: регламент `standings` уже пересчитывает снимок, сверка читает его на GET;
  - деструктивных миграций нет;
  - серверный авторитет соблюдён: клиент шлёт только адрес «показано».

## 8.2 Отклонения при реализации (coder, 2026-10-31)

- **Имя пути экрана:** `achievementItemPath(item)` вместо `achievementPath(item)` (7.6) — имя `achievementPath(code)`
  уже занято в `story/achievement-story.ts` (возврат «К достижению» карточки). Добавлен помощник `seasonOf(item)`
  (сезон объекта для «К сезону»).
- **Типы несезонных:** `AchievementObjectRef.kind` и `AchievementGrantDoc.object.kind` — без `'season'`;
  `AchievementCardFacts.code` порта `ACHIEVEMENTS_FOR_SHARING` — `FactAchievementCode` (экспорт типа из
  `achievements/index.ts` для `achievement-card.icons.ts`). Поведение порта прежнее, сезонный код → `null` (409).
- **`markSeen`:** сезонные коды из `codes` отфильтровываются до pipeline по `achievement_grants` (по типу
  `FactAchievementCode`); итог тот же — без записи.
- **`sync`:** `titled` (названия гонок) и `outcomesOf` идут параллельно вторым шагом после `Promise.all` фактов, выдач и
  маркера (7.5 п. 1–2) — запросов не больше.
- **Тестовые хелперы:** `seedSeason(h, name, { year })` (2025 и раньше — завершённый для часов стенда),
  `seedProtocolRace(…, { status, corridor })`.
- **`pr.md`** (раздел 10, миграция `0043`) — не создан: шаг FINISH оркестратора.

## 9. Acceptance Criteria

- AC1. Юнит: место 1 / `=1` / 3 / 4; 2 vs 3 зачётные гонки; DQ-ячейки не считаются; незавершённый сезон и
  «ждёт пересчёта» — нет изменений.
- AC2. Int: райдер — чемпион сезона A и призёр сезона B → две выдачи `season_podium` (A и B) и одна
  `season_champion`; первая сверка тихая; новая выдача после — `seen: false`; `seen` по коду и сезону помечает только
  её.
- AC3. Пересчёт снимка сместил место — отзыв молча, возврат без вспышки.
- AC4. Параллельные GET — без дублей и 500 (уникальный индекс с сезоном).
- AC5. Публичный список — сезонные включены; непубличный — 404.
- AC6. Старые документы и `{ codes }` без сезона работают как прежде (тест совместимости).
- AC7. Приложение: блок, экран, вспышка («К сезону»), ключи по объекту, публичный профиль; старые ответы без
  сезонных не ломают экран.
- AC8. `pnpm check` зелёный; документы: `docs/product/profile.md` (S1–S8), ADR-0020 (ключ выдачи с сезоном),
  `.claude/rules`.

## 10. Documentation Impact

- `docs/product/profile.md`:
  - S1–S8 с принятыми уточнениями: RC-S1 (нужен финиш с местом), RC-S2 (все гонки с коридором с протоколом), RC-S3
    («с местом» ≠ «засчитанные»), RC-S5;
  - «Где в продукте — достижения»: сезонные в профиле и публично, «К сезону», без «Поделиться»;
  - из Out of Scope (~стр. 301) убрать «сезонные достижения».
- `docs/adr/0020-achievements-reconcile-on-read.md` — «Дополнение: сезонные»:
  - отдельная коллекция `achievement_season_grants` (`(userId, code, seasonId)`, `0043`, только expand; почему не
    расширение индекса — HG-S1);
  - общий маркер ставится после выдач обеих коллекций;
  - факты — порт `standings` `RIDER_SEASON_STANDINGS` (снимок, без пересчёта);
  - только `final`-сезоны меняют выдачи (RC-S2);
  - бюджет запросов ≤ ~16; RC-S10.
- `docs/product/races-and-seasons.md` — в разделе рейтинга сезона ссылка: итоговый снимок даёт сезонные достижения.
- `.claude/rules/pokatim-backend.md`:
  - ребро `achievements → standings` (порт `RIDER_SEASON_STANDINGS`, только `AchievementsModule`);
  - `SEASONAL_RULES`, `seasonalAchievements`, `seasonalPlan`, `FACT_ACHIEVEMENT_CODES`;
  - `SeasonRaces.finishedSeasons/awaitingProtocol`, `protocolRaces(seasonIds?)`, `StandingsSource.load(seasonIds?)`;
  - карточка: сезонный код → 409.
- `.claude/rules/pokatim-db.md`:
  - `achievement_season_grants` (поля, уникальный индекс, `0043`, писатель — `AchievementsRepository`);
  - `markSeen` — две операции;
  - стирание — обе коллекции (раздел «Удаление аккаунта», шаг `achievements`).
- `.claude/rules/pokatim-contracts.md`:
  - сезонные коды и их порядок, `kind: 'season'`, `SEASON_REGULAR_MIN_RACES`;
  - `MarkAchievementsSeenRequest` `{ codes?, seasonal? }` и правило «`seasonal` — только непустым».
- `.claude/rules/pokatim-security.md` — `seen` (`seasonal` ≤ 30); «GET пишет ≤ 9 документов + 3 на завершённый сезон
  райдера»; публичные сезонные.
- `.claude/rules/pokatim-app.md` — `achievementKey`/`flashKey` (код + объект для сезонных), `storyCard`, «К сезону»,
  `?season=`.
- `pr.md` — миграция `0043` (только expand: новая коллекция и индекс; деплой — миграции до API).

## 11. Implementation Context

ENTRY POINTS:
- API: `GET /v1/achievements` (`AchievementsController.list` → `AchievementsService.sync`), `POST
  /v1/achievements/seen`, `GET /v1/riders/:publicId/achievements` (`publicList`), `GET
  /v1/achievements/:code/story-card` (отказ для сезонных), порт `RIDER_SEASON_STANDINGS.outcomesOf`.
- Приложение: `/profile`, `/achievements/flash`, `/achievements/<code>?season=`, `/riders/<id>`.

FILES TO MODIFY / READ / TYPES & SCHEMAS — разделы 5.1, 6, 7. TESTS — 7.8.

OUT OF SCOPE — раздел 4, а также:
- `achievement_grants` и его индекс;
- регламент `standings.sync` и формула (`STANDINGS_FORMULA_VERSION` не меняется), индексы `standings`;
- `renderVersion` карточек, en-словарь, push, ручная выдача.

Порядок TDD (один PR, коммиты по шагам; в конце `pnpm check` зелёный):

1. **Contracts** — красные тесты схемы (7.1, 7.8) → коды (порядок RC-S4), `SEASONAL_*`, `isSeasonalCode`,
   `SEASON_REGULAR_MIN_RACES`, `kind: 'season'`, `SeasonalAchievementRef`, новый `MarkAchievementsSeenRequest`;
   `index.ts`. Типовые ошибки в `ACHIEVEMENT_RULES`, `ACHIEVEMENT_BADGE_ICONS`, `ACHIEVEMENT_CATALOG` закрываются на
   шагах 3, 6 и 8 (здесь — минимально, чтобы собиралось).
2. **Races/Standings port** — красный `rider-season-standings.int.test.ts` → `SeasonRaces.finishedSeasons`,
   `awaitingProtocol`, `protocolRaces(seasonIds?)`; `StandingsRepository.rowsOfUserIn`, `headersOf`;
   `StandingsSource.load(seasonIds?)` (+ вызовы в `standings-recalc.ts` и `standings-read.service.ts`; регресс
   `standings-*.int.test.ts` зелёный); порт и реализация в `StandingsCoreModule`, экспорт `index.ts`.
3. **Policy** — красные тесты (RC-S1, RC-S3, RC-S6, RC-S7) → `FACT_ACHIEVEMENT_CODES`, `SEASONAL_RULES`,
   `seasonalAchievements`, `seasonalPlan`; `reconcilePlan` и `evaluateAchievements` — только по fact-кодам.
4. **Migration** — красный тест `0043` → миграция только expand (`achievement_season_grants` + уникальный индекс) и
   `index.ts`.
5. **Collection/Repository** — `AchievementSeasonGrantDoc`, `listSeasonalOf`, `insertSeasonal`, `revokeSeasonal`,
   `restoreSeasonal`, `markSeen` с адресами (две операции), `deleteAllOf` обеих коллекций; `AchievementErasure` — новый
   счётчик.
6. **Service/Module/Controller** — `AchievementsModule` + `StandingsCoreModule`; `sync` (маркер после обоих планов),
   `publicList`, `markSeen`; `achievements-for-sharing` (сезонный код → `null`), `achievement-card.icons.ts`
   (`FactAchievementCode`). Int-тесты AC2–AC6, стирание и 409 в sharing — сначала красные.
7. **api-client** — `markAchievementsSeen(t, codes, seasonal = [])` + тест.
8. **i18n + каталог, сессия и queries приложения** — тесты `achievement-catalog.test.ts`, `flash-session.test.ts`,
   `queries.test.tsx` → каталог (3 кода, флаги), `achievementKey`, `flashKey`, `achievementPath`, `seenTarget`,
   мутация по целям.
9. **UI приложения** — экран (`?season=`, «К сезону»), вспышка (без «Поделиться», с «К сезону»), плитки по ключу,
   переход из профиля, публичный блок; экран сторис с сезонным кодом — «нет карточки». RTL-тесты (AC7).
10. **Документы** — раздел 10; `pnpm check`.

## 12. Outcome

- **Статус:** реализовано по разделам 5–7 и 8.1; отклонения — 8.2. `pnpm check` зелёный (15/15 задач turbo; API —
  217 файлов, 2404 теста), локальный Mongo/Redis (27117/6479).
- **Контракты:** коды `season_regular`, `season_podium`, `season_champion` (в конец), `SEASONAL_ACHIEVEMENT_CODES`,
  `isSeasonalCode`, `SEASON_REGULAR_MIN_RACES`, вид `season`, `SeasonalAchievementRef`, `MarkAchievementsSeenRequest
  { codes?, seasonal? }`; api-client `markAchievementsSeen(t, codes, seasonal = [])`.
- **API:** порт `RIDER_SEASON_STANDINGS` (`standings/rider-season-standings*.ts`), `SeasonRaces.finishedSeasons`,
  `awaitingProtocol`, `protocolRaces(seasonIds?)`, `StandingsSource.load(seasonIds?)`, `StandingsRepository
  .rowsOfUserIn/headersOf`; политика `FACT_ACHIEVEMENT_CODES`, `SEASONAL_RULES`, `seasonalAchievements`,
  `seasonalPlan`; коллекция `achievement_season_grants` + миграция `0043_achievements_seasonal` (только expand);
  репозиторий (сезонные методы, `markSeen` двумя операциями, стирание обеих коллекций); сервис (`sync`, `publicList`,
  `markSeen`), карточка — сезонный код → 409.
- **Приложение:** каталог (3 кода, флаги `storyCard`/`seasonal`), `achievementKey`, `flashKey`, `seenTarget`,
  `achievementItemPath`; мутация `seen` по адресам; экран (`?season=`, «К сезону»), вспышка (без «Поделиться», «К
  сезону»), плитки по ключу, публичный блок; карточка сезонного по прямому адресу — «Карточки нет» без запроса; i18n.
- **Тесты:** contracts (схема `seen`, порядок кодов, `season`/`unknown`); policy unit (RC-S1, RC-S3, RC-S6, RC-S7,
  план); int `rider-season-standings` (final/pending, RC-S2, `alsoSeasonIds`, без чтения источника); int achievements
  AC1–AC6 (две выдачи `season_podium` + `season_champion`, тихая первая, `seen` по `(code, seasonId)`, отзыв/возврат,
  `pending` без изменений, параллельные GET ×5, публичный, документ v1); стирание обеих коллекций; sharing 409;
  миграция `0043`; api-client; app — каталог, flash-session, queries, RTL экрана, вспышки, блоков и карточки.
- **Отрицательное доказательство AC4:** без перехвата `isDuplicateKey` в `insertSeasonal` параллельный GET ×5 краснеет
  (500), с перехватом — зелёный.
- **Документы:** `docs/product/profile.md` (S1–S8, «Где в продукте», Follow-up), ADR-0020 «Дополнение: сезонные»,
  `docs/product/races-and-seasons.md`, `.claude/rules/pokatim-{backend,db,contracts,security,app}.md`.
- **Не сделано:** `pr.md` (FINISH); e2e web не запускался (не обязателен).

### Фиксы ревью pass 1 (оркестратор)

- Claude MEDIUM: сбой порта `RIDER_SEASON_STANDINGS` больше не роняет `GET /v1/achievements` и публичный список —
  `seasonOutcomes` ловит, логирует `achievements.seasons_unavailable` (uid, имя класса ошибки) и ведёт себя как «нет
  сезонов» (`settled` пуст — выдачи не трогаются). Int-тест: 500 до правки, 200 после; несезонные на месте, сезонные
  выдачи не отозваны, после восстановления порта — снова в ответе.
- LOW: текст «Сезон в зачёте» — «не меньше чем в {count} гонках»; `pokatim-backend.md` — `FactAchievementCode`,
  `StandingsCoreModule` в импортах. Вечный `pending` при `version_conflict` (LOW) — принят: регламент standings
  сам логирует конфликт, сезонные в окне не отзываются (безопасная сторона).
