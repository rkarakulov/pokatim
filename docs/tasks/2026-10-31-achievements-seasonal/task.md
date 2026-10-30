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

Architecture Review (architect, 2026-10-31) — **Status: CONCERNS** (блокеров для кода нет; **HG-S1** — подтверждение
человека на удаление старого уникального индекса до мержа и деплоя; RC-S1…RC-S3 — уточнения S1/S2 с причинами, на
подтверждение человеку, по умолчанию берётся рекомендация; остальные RC — обязательные правки реализации).

- **Модель ADR-0020 не меняется.** Сезонная выдача — та же проекция фактов, сверка при `GET /v1/achievements`, каждая
  запись — одна условная операция над одним документом без транзакций, маркер первой сверки — после выдач. Меняется
  **ключ выдачи**: `(userId, code)` → `(userId, code, seasonId)`. У несезонных `seasonId: null` (у документов v1 поля
  нет — для фильтра `{ seasonId: null }` и для уникального индекса это одно и то же).
- **Источник — снимок `standings` через порт, не пересчёт.** `achievements` не читает чужие коллекции
  (`season_standing_rows`, `season_standings`, `seasons`, `races`). Новый порт **`RIDER_SEASON_STANDINGS`** живёт в
  модуле-владельце снимка `standings` (`StandingsCoreModule`), сезоны и «ждущие протокола» он берёт у `races` через
  `SEASON_RACES` (это ребро уже есть). Новое ребро — только `achievements → standings` (через `standings/index.ts`).
  `standings`, `races`, `results` об `achievements` не знают, поэтому циклов нет. Порт подключается только в
  `AchievementsModule` (HTTP). `AchievementsReadModule` и `sharing` его не получают: у сезонных карточки нет (S7).
- **«Завершён» и «актуальный снимок» решает порт, решения о кодах — `achievements`.** Порт отдаёт по каждому нужному
  завершённому сезону статус `final | pending` и строки райдера (место, ничья, число ячеек «с местом»). Пороги (место 1,
  1–3, ≥ 3 гонки) — чистые функции `achievements.policy.ts`. Сезон считается `final`, когда выполнены все условия:
  (1) последний день по Минску прошёл (`endsBefore ≤ now`); (2) у сезона нет опубликованной гонки с коридором и без
  протокола (RC-S2); (3) заголовок снимка есть, и его `fingerprint` равен отпечатку источника (`StandingsSource`, тот же
  расчёт, что у регламента и у `sync: pending` панели). Иначе — `pending`, и сезонные выдачи этого сезона сверка не
  трогает: ни вставки, ни отзыва (S2).
- **GET остаётся лёгким.** Сколько запросов добавляет порт:
  1. `seasons.find({ endsBefore ≤ now })` — сезонов десятки. Завершённых нет — выход.
  2. В одной snapshot-сессии: `season_standing_rows.find({ seasonId: { $in: завершённые }, userId })` (существующий
     индекс `season_standing_rows_user_idx (seasonId, userId)`, по одному seek на сезон, **новый индекс не нужен**) и
     заголовки снимков только «нужных» сезонов. Нужные — сезоны строк ∪ сезоны уже сохранённых сезонных выдач:
     последние нужны для отзыва, если строки райдера пропали. Нужных нет — выход (типичный райдер без сезонных итогов:
     **2 запроса**).
  3. Только для нужных: гонки без протокола (`races` по префиксу `seasonId`) и источник (`protocolRaces({ $in })` по
     `races_protocol_idx` + один `aggregate` `currentRevisions`) — ещё **3 запроса**.

  Итого +2…5 запросов по индексам, без разбора треков, без пересчёта и без записи у источника. Заголовок и строки
  читаются в одной snapshot-сессии (их пишет одна транзакция `claimSeason` + `replaceRows`), источник — **после**
  снимка: пересчёт, случившийся между чтениями, даст расхождение отпечатков, то есть `pending` (безопасная сторона).
- **Гонки — замки не нужны (подтверждаю).** Каждая запись — одна условная операция над одним документом по
  `{ userId, code, seasonId, … }`. Параллельная вставка ловится новым уникальным индексом (`isDuplicateKey` → `false`).
  `restore` и `refresh` идут с условием на `revokedAt`, `revoke` — только видимой выдачи, `markSeen` — `updateMany`
  pipeline, атомарный на каждый документ. Два GET с разными снимками (до и после пересчёта) могут на мгновение
  разойтись: устаревший отзовёт, свежий вернёт с прежним `seenAt` — без повторной вспышки (A4/S4). Следующая сверка
  сводит состояние. Это та же eventual consistency, что принята в ADR-0020. Транзакция или Redis-замок ничего не дадут:
  исход один.
- **Миграция:** `0043_achievements_seasonal` (последняя в `origin/develop` — `0042_profile_report_reasons`, PR #150
  миграций не добавлял; перед мержем проверить, не занял ли 0043 другой PR). Шаги: новый уникальный
  `achievement_grants_user_code_season_unique { userId, code, seasonId }`, затем удаление старого
  `achievement_grants_user_code_unique` — **HG-S1** (образец — `0021_routes_rider`, HG-1). Индексы `standings` не
  меняются. Бэкфилла нет.
- **Ни очередей, ни outbox, ни регламента, ни append-only.** Регламент `standings.sync` не меняется. Задач BullMQ
  нет. Push — PR P.
- **Совместимость.** Старые сборки: новые коды и вид `season` → `'unknown'` (`tolerantEnum`), `knownItems` их
  отбрасывает (ключи React, вспышка, `seen` старых сборок сезонных не видят). `{ codes }` работает как прежде и
  относится только к несезонным. Новая сборка со старым API: сезонных в ответе нет, и `seasonal` в запросе не уходит
  (клиент шлёт поле только непустым). Иначе строгий запрос старого API ответил бы 400.

## 5.1 Placement & Reuse Gate

| Что | Где | Почему / reuse |
|---|---|---|
| Коды `season_regular`, `season_podium`, `season_champion` (в конец, порядок — RC-S4), `SEASONAL_ACHIEVEMENT_CODES`, `SeasonalAchievementCode`, `isSeasonalCode`, `SEASON_REGULAR_MIN_RACES = 3`, вид объекта `season`, `SeasonalAchievementRef`, новая схема `MarkAchievementsSeenRequest` | `packages/contracts/src/achievements/achievement.schema.ts` (+ `src/index.ts`) | ≥ 3 потребителя (политика API, приложение, api-client); порог — одна константа (как `ACHIEVEMENT_LEVEL_TARGETS`, RC-L1) |
| Порт `RIDER_SEASON_STANDINGS` (тип + символ) | новый `apps/api/src/modules/standings/rider-season-standings.port.ts`, экспорт `standings/index.ts` | владелец снимка — `standings`; `achievements` чужих коллекций не читает |
| Реализация порта | новый `apps/api/src/modules/standings/rider-season-standings.ts` (`RiderSeasonStandingsService`), провайдер + экспорт `StandingsCoreModule` | reuse: `StandingsRepository.withSnapshot`, `StandingsSource.load` (тот же отпечаток, что регламент и панель), `SEASON_RACES` |
| Чтения снимка по нескольким сезонам | `standings.repository.ts`: `rowsOfUserIn(seasonIds, userId, session)`, `headersOf(ids, session)` (проекция `_id`, `fingerprint`) | существующий индекс `(seasonId, userId)`; нового индекса нет |
| Источник по набору сезонов | `standings-source.ts`: `load(seasonIds?: readonly string[])` (вызовы `recalc.sync()` → `load()`, `panelSummary` → `load([id])`) | второго расчёта отпечатка нет |
| Сезоны и «ждущие протокола» | `races/season-races.port.ts` + `season-races.ts`: `finishedSeasons(now)`, `awaitingProtocol(seasonIds)`, `protocolRaces(seasonIds?: readonly string[])`; `races.repository.ts` | `races` — владелец сезонов; порт уже экспортирован для `standings` |
| Правила сезонных, ключ выдачи, план по ключу | `apps/api/src/modules/achievements/achievements.policy.ts` | чистые функции рядом с `ACHIEVEMENT_RULES`; `reconcilePlan` один для обоих видов |
| Поле `seasonId`, фильтры по ключу, `markSeen` с адресами | `achievements.collection.ts`, `achievements.repository.ts` | единственный писатель |
| Сверка и публичный список с сезонными | `achievements.service.ts`, `achievements.module.ts` (+ `StandingsCoreModule`), `achievements.controller.ts` (`seen`) | явный список полей |
| Отказ карточки для сезонных | `achievements-for-sharing.ts` (сезонный код → `null` → 409), `sharing/achievement-card.icons.ts` (`Record<FactAchievementCode, …>`) | `renderVersion` не меняется: вёрстка и тексты прежние |
| Миграция | новый `apps/api/src/db/migrations/0043_achievements_seasonal.ts` + `index.ts` + `migrations.int.test.ts` | — |
| Каталог (3 кода, флаги `storyCard`/`seasonal`, иконки `trophy`/`medal`/`calendar`), `achievementKey`, `flashKey`, путь экрана | `apps/app/src/features/achievements/achievement-catalog.ts` | одна функция ключа для React, вспышки, `seen`, экрана |
| Пометка по адресам | `queries.ts` (`useMarkAchievementsSeen` — цели `{ code, seasonId }`), `packages/api-client/src/index.ts` | — |
| Экран и вспышка: «К сезону», без «Поделиться» | `achievement-screen.tsx`, `achievement-flash-screen.tsx`, `src/app/achievements/[code].tsx` (`?season=`) | `/seasons/<id>` уже есть |
| Ключи плиток и переход | `achievements-block.tsx`, `features/profile/own-profile-screen.tsx` | — |
| Строки | `packages/i18n/src/ru.ts` | en-словаря нет |

**Запрещённые дубли:** второй расчёт отпечатка источника или мест сезона в `achievements` (только порт → `StandingsSource`,
снимок); чтение `season_standing_rows` / `season_standings` / `seasons` / `races` из `achievements`; новый индекс
`season_standing_rows` по `userId` (хватает `$in` по завершённым сезонам); вторая коллекция выдач; копия порога «3 гонки»
в приложении (только `SEASON_REGULAR_MIN_RACES`); ключи React и `seen` по голому `code` в приложении.

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
- `apps/api/src/db/migrations/0043_achievements_seasonal.ts` (новая), `index.ts`, `migrations.int.test.ts`; образцы —
  `0035_achievements.ts`, `0021_routes_rider.ts` (новый индекс → удаление старого).
- Тестовые хелперы: `apps/api/test/standings.ts` (`seedSeason` — добавить даты, `seedProtocolRace`, `addRevision`,
  `syncStandings`), `apps/api/test/achievements.ts`.
- Стирание: `apps/api/src/modules/achievements/achievement-erasure.ts` (без изменений, тест).

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
export const ACHIEVEMENT_RULES = { … } satisfies Record<FactAchievementCode, (facts: Sorted) => Earned | null>;
// evaluateAchievements / progressOf обходят только !isSeasonalCode(code)

export const SEASONAL_RULES = {
  season_regular: (rows) => rows.some((r) => r.placedRaces >= SEASON_REGULAR_MIN_RACES),
  season_podium: (rows) => rows.some((r) => r.placedRaces >= 1 && r.place <= PODIUM_MAX),   // RC-S1
  season_champion: (rows) => rows.some((r) => r.placedRaces >= 1 && r.place === 1),         // RC-S1
} satisfies Record<SeasonalAchievementCode, (rows: readonly RiderSeasonRow[]) => boolean>;

export interface GrantKey { code: AchievementCode; seasonId: string | null }
export const grantKey = (k: GrantKey): string => (k.seasonId === null ? k.code : `${k.code}:${k.seasonId}`);
export type KeyedEarned = Earned & GrantKey;

/** Сезонные (S1–S3): заработанные по `final` сезонам; `settled` — сезоны, где сверка вправе менять выдачи. */
export function seasonalAchievements(outcomes: readonly RiderSeasonOutcome[]): {
  earned: Map<string, KeyedEarned>;   // объект { kind: 'season', id }, title — название, level: null,
                                      // factAt = endsBefore − 1 мс (minskToday → endsOn; RC-S6)
  settled: ReadonlySet<string>;       // seasonId со статусом final
  titles: ReadonlyMap<string, string>;
};

export function reconcilePlan(
  stored: readonly StoredGrant[],                 // + seasonId?: string | null (≡ null)
  earned: ReadonlyMap<string, KeyedEarned>,       // несезонные по code + сезонные по code:seasonId
  settled: (key: GrantKey) => boolean,            // несезонные — true; сезонные — settled.has(seasonId)
  first: boolean,
  now: Date,
): ReconcileStep[];                               // шаги несут GrantKey (code + seasonId)
```

- План обходит объединение ключей `stored` ∪ `earned` в детерминированном порядке (каталог, затем `seasonId`).
  Ключ с `!settled(key)` пропускается целиком: ни insert, ни revoke, ни refresh (S2). Остальные ветки — как сейчас
  (`insert` с `seenAt = first ? now : null`; `restore`; `refresh` при другом объекте, дате или ранге; `revoke`).
- **Обязательно (RC-S7):** текущий `byCode = new Map(stored.map(g => [g.code, g]))` схлопнет две выдачи
  `season_podium` разных сезонов, а `ACHIEVEMENT_CODES` в цикле без фильтра отзовёт сезонные (по коду факта нет).
  Индексировать только по `grantKey`.
- `sortForList` — без изменений (дата факта ↓, каталог ↓). При порядке кодов из RC-S4 в одном сезоне сначала
  «Чемпион», потом «Призёр», потом «В зачёте»; во вспышке (обратный порядок) — по нарастающей.

### 7.4 Коллекция, репозиторий, миграция

- `AchievementGrantDoc.seasonId?: string | null` — у сезонных id сезона, у несезонных новых документов явный `null`, у
  v1 поля нет. `listOf` — проекция `+ seasonId: 1`; `StoredGrantDoc` — `+ 'seasonId'`. Комментарий «≤ 9» → «≤ 9 +
  3 × сезонов».
- Фильтр каждой записи — `{ userId, code, seasonId: key.seasonId, … }` (`insertGrant`, `revoke`, `restoreOrRefresh`).
  `{ seasonId: null }` совпадает с документами v1.
- `ACHIEVEMENT_GRANTS_UNIQUE_INDEX = 'achievement_grants_user_code_season_unique'`.
- `markSeen(userId, codes, seasonal, now)` — **одна** `updateMany` pipeline (как сейчас) с фильтром
  `{ userId, revokedAt: null, $expr: …, $or: [ { code: { $in: codes }, seasonId: null }, ...seasonal.map(({ code, seasonId }) => ({ code, seasonId })) ] }`.
  Пустые части в `$or` не попадают. Значения — примитивы после zod (`Uuid`, строгий enum), без объектов из запроса.
- `deleteAllOf` — без изменений (`deleteMany({ userId })` берёт и сезонные; тест).
- `0043_achievements_seasonal` (идемпотентна, без транзакции):
  1. `createIndex({ userId: 1, code: 1, seasonId: 1 }, { name: 'achievement_grants_user_code_season_unique', unique: true })`
     — у v1 и несезонных `seasonId` в индексе равен `null`, поэтому уникальность `(userId, code)` для них сохраняется.
     Дублей в данных нет: старый уникальный индекс их не допускал.
  2. Удалить `achievement_grants_user_code_unique`, если он есть (повторный `up` — без ошибки). **HG-S1.**
  Порядок деплоя: миграции → API (AGENTS §4.6). До удаления старого индекса вставка второго `season_podium`
  падала бы E11000 со старым именем, поэтому код без миграции не выкатывать (в `pr.md`).
- `ACHIEVEMENTS_INDEXES` новой миграции экспортировать для `migrations.int.test.ts` (как в `0035`).

### 7.5 Сервис

- `sync`: `Promise.all([facts.evaluate, repository.listOf, repository.syncedAt])` →
  `standings.outcomesOf(userId, seasonIdsOf(stored), now)` → `seasonalAchievements` → общая карта `earned`
  (несезонные по `code` + сезонные) → `reconcilePlan(stored, earned, settled, first, now)` → шаги → маркер (если
  `first`) → перечитанные видимые по `grantKey` ∩ `titled` → ответ. `titled` для сезонных — название из `Earned.title`
  (сезон не гонка, `racesOf` не нужен). `seen` — `isSeen(grant, null)`.
- `publicList`: к гоночным добавить сезонные по `final` из `outcomesOf(rider.userId, [], now)`, **без записи и без
  чтения выдач**. Сезоны в `pending` в публичном ответе временно не видны (RC-S5).
- `markSeen(userId, { codes, seasonal })` — лимит прежний, одна операция.
- Лог `achievements.sync` — счётчики без кодов и сезонов (как сейчас).

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
      сезона публичен (`/seasons/:id`). Без мест, очков и таблицы в ответе достижений; `userId` и `seasonId` выдачи
      наружу не выходят иначе как `object.id`.
- [ ] Публично — только при `findPublic` (имя + согласие), иначе один 404. Сезонные — из протоколов (R9), без записи.
- [ ] GET пишет ≤ 9 + 3 × сезонов документов (обновить формулировку правила). Логи — `uid` и счётчики; без кодов,
      сезонов, мест.
- [ ] Карточка сторис: сезонный код → 409 (порт `null`), без рендера.

### 7.8 Test matrix

| Уровень | Что | AC |
|---|---|---|
| unit contracts | новые коды в конце; `kind: 'season'`; `'planet'` → `unknown`; `seen`: `{codes}` v1 валиден, `{seasonal}` валиден, `{}`/пустые → 400, лишний ключ → 400, несезонный код в `seasonal` → 400, повтор `(code, seasonId)` → 400, > 30 → 400 | AC6 |
| unit policy | `SEASONAL_RULES`: место 1 / `=1` (tied) / 3 / 4; 2 vs 3 ячейки с местом; DQ не считаются; **строка только из DQ на месте 2 — не призёр** (RC-S1); «чемпион ⇒ призёр»; `seasonalAchievements`: `pending` → нет `earned`, не `settled`; `factAt` → `minskToday = endsOn`; `reconcilePlan`: две выдачи одного кода разных сезонов (не схлопываются); сезон не `settled` → ни insert, ни revoke; сезон `final` без строк → revoke; несезонные без изменений (регресс-набор прежних тестов зелёный) | AC1 |
| int standings (реальная Mongo) | `outcomesOf`: незавершённый сезон — нет в ответе; завершённый + актуальный снимок → `final` с `placedRaces`; новая ревизия без пересчёта → `pending`, после `syncStandings` → `final`; гонка с коридором без протокола → `pending` (RC-S2), гонка-анонс (`corridor: null`) и отменённая не мешают; `alsoSeasonIds` без строк → `final`, `rows: []`; райдер без строк → `[]` (и число запросов: нет чтения источника — через шпион `StandingsSource.load`) | AC1, AC3 |
| int achievements | AC2 целиком (чемпион A + призёр B → 2 × `season_podium`, 1 × `season_champion`; первая сверка тихая; новая после — `seen: false`; `seen` по `(code, seasonId)` помечает только её; `{codes:['season_podium']}` — 0 записей); AC3 (`addRevision` → `syncStandings` → отзыв молча → обратная ревизия → возврат `seen: true`); `pending` между ревизией и пересчётом — выдачи не меняются; AC4 (параллельные GET × 5 при первой выдаче сезонных — без 500 и дублей; `countDocuments` по ключу = 1); AC5 (публичный — сезонные есть, точный список ключей; непубличный — 404); AC6 (документ v1 без `seasonId`, вставленный напрямую, → прежний ответ; `{codes}` помечает его; нет дубля несезонного при параллельных GET после миграции); стирание — сезонные удалены | AC2–AC6 |
| int sharing | `GET /v1/achievements/season_podium/story-card` при выданном → 409 | S7 |
| int migrations | `0043`: новый уникальный есть, старого нет, повторный `up` без ошибки; v1-документ + вставка того же `(userId, code)` с `seasonId: null` → E11000; два `season_podium` разных сезонов вставляются | AC4, AC6 |
| api-client | `markAchievementsSeen(t, codes)` шлёт `{codes}` без `seasonal`; с сезонными — оба поля; ответ с `kind: 'season'` и без сезонных разбирается | AC6, AC7 |
| app unit (jest/RTL) | каталог: `achievementKey`/`flashKey` у сезонных с `object.id`; `flashQueue` — два `season_podium` разных сезонов оба в очереди; `flash-session` по новому ключу; `setSeen` по ключу (помечает только свой сезон, сохраняет `progress`); экран `?season=` находит нужный; вспышка/экран сезонного — «К сезону», без «Поделиться»; плитки без дубля ключей; публичный блок с сезонными; старый ответ без сезонных; ответ с незнакомым кодом не ломает | AC7 |
| e2e web | не обязателен (существующий смоук `/profile`) | — |

## 8. Risks / Assumptions / Open Questions

- Снимок `standings` пересчитывается регламентом — между концом сезона и пересчётом снимок может быть «ждёт
  пересчёта»: выдача появится после пересчёта (при следующей сверке).
- Совместимость `seen` со старыми сборками: старая сборка сезонных кодов не знает (`unknown` отбрасывается) и их не
  отмечает — у неё они остаются непросмотренными до новой сборки (вспышка на новой — ожидаемо).

## 8.1 Requirements Consistency (architect)

Решения S1–S8 сохраняются. RC-S1 и RC-S2 уточняют S1/S2 — причины указаны в пунктах (без уточнения возникают
вредные исходы). Пункты на подтверждение человеку помечены (?), по умолчанию берётся рекомендация.

- **HG-S1 (?) — удаление старого уникального индекса (деструктивная операция с индексом, AGENTS §4.6 / db.md).**
  Ключ `(userId, code, seasonId)` не работает, пока жив `achievement_grants_user_code_unique`: вторая выдача
  `season_podium` упадёт с E11000. Варианты:
  (a) `0043` создаёт новый индекс и удаляет старый в одном релизе. Данные не теряются, индекс восстановим. Образец —
  `0021_routes_rider` (HG-1). Окно выката: старый процесс API ловит дубль по старому имени, поэтому параллельная
  первая сверка в эти секунды может дать 500. Это редко и снимается повтором.
  (b) Отдельная коллекция `achievement_season_grants` с уникальным `(userId, code, seasonId)` — чистый expand без
  удаления. Но тогда второй писатель-метод на каждую операцию, два чтения в `listOf`, два `deleteMany`, а `markSeen`
  перестаёт быть одной операцией.
  (c) Два релиза (сначала индекс, потом удаление и код) — фича ждёт второго релиза, выигрыша нет.
  **Рекомендация: (a)** с явным «да» человека в PR (`pr.md`: «миграция удаляет индекс»).
- **RC-S1 (?) — строка только из DQ получает место (вредный исход S1 «место 1–3 в любой таблице»).** В снимке у
  райдера, у которого все ячейки DQ, тоже есть `place`: его ставит порядок таблицы, `buildSeasonStandings` включает
  строки «только DQ». В таблице из двух-трёх человек он станет «Призёром сезона» без единого финиша. Варианты:
  (a) для «Чемпиона» и «Призёра» нужна хотя бы одна ячейка с местом (`placedRaces ≥ 1`); (b) как написано;
  (c) `points > 0` — то же, что (a), но через очки (ячейка с местом всегда даёт ≥ 1 очка). **Рекомендация: (a).**
- **RC-S2 (?) — «завершён» по датам раньше, чем готовы итоги (вредный исход S2).** Протокол — не раньше конца окна
  + 48 ч (`races-and-seasons.md`), и окно последней гонки может закрыться в последний день сезона. На следующий день
  после конца сезона снимок уже «актуален» (неопубликованные протоколы не входят в источник), хотя таблица неполная.
  «Чемпион» вспыхнет и через пару дней молча исчезнет. Варианты:
  (a) `final` = дата прошла **и** нет опубликованной гонки сезона с коридором без протокола (отменённые и
  гонки-анонсы без коридора не мешают) — один запрос по `races` и только для нужных сезонов. Забытый протокол держит
  сезон в `pending`, но это видно в «Обзоре» панели («ждут протокола»).
  (b) Задержка: `endsBefore + 7 дней`. Число произвольное, `protocolPlannedAt` можно сдвигать позже.
  (c) Как написано, неверную вспышку принять.
  **Рекомендация: (a).** Записать в `profile.md` как уточнение S2.
- **RC-S3 — «в зачёте» в S1 двусмысленно.** В рейтинге сезона «засчитанные» — это `counted` (N из M, сначала DQ). S1
  уточняет: «ячейки строки с местом, не DQ». Реализация — `cell.outcome === 'placed'` независимо от `counted`, порт
  отдаёт число `placedRaces`. Название `counted` в коде порта и политики не использовать.
- **RC-S4 — порядок новых кодов.** `sortForList` при равной дате ставит коды по каталогу ↓. Порядок в
  `ACHIEVEMENT_CODES`: `season_regular`, `season_podium`, `season_champion`. Тогда в профиле первым идёт «Чемпион», а
  во вспышке — по нарастающей, как «Подиум» → «Победа» в v1. S1 («в конец») соблюдено.
- **RC-S5 — публичный профиль в окне `pending`.** Публичный список считается без записи, поэтому сезонные сезона в
  `pending` (обычно ≤ 1 мин после новой ревизии) на это время пропадают из публичного профиля. Варианты:
  (a) принять; (b) в `pending` читать сохранённые выдачи — публичный ответ начнёт зависеть от приватного состояния
  сверки, нужно ещё одно чтение. **Рекомендация: (a).**
- **RC-S6 — дата факта.** `factAt = endsBefore − 1 мс`, тогда `minskToday` даёт `endsOn` (S3). Сезонные встают после
  гонок сезона, `sameFact` стабилен. Отдельного поля даты нет.
- **RC-S7 — обязательная правка плана.** `reconcilePlan` сейчас индексирует выдачи по `code` и обходит все
  `ACHIEVEMENT_CODES`. С сезонными это схлопнет выдачи разных сезонов и отзовёт сезонные: среди фактов несезонных их
  нет. Ключ — `grantKey`, плюс фильтр `settled` (7.3). Регресс-тесты прежнего плана должны остаться зелёными.
- **RC-S8 (?) — «Сезон «Сезон 2026»».** S7 задаёт подпись объекта, но названия сезонов обычно уже содержат слово
  «Сезон». Варианты: (a) как S7, единообразно с «Гонка «…»»; (b) только название; (c) «Сезон: {title}».
  **Рекомендация: (a)** (решение автора S7, без новой логики).
- **RC-S9 (?) — таблица из одного райдера.** Возрастная таблица с одним участником даёт «Чемпиона сезона» за одну
  гонку. Это последовательно с v1 «Победа» (первое место в своей группе, A1). Варианты: (a) принять; (b) порог
  «в таблице ≥ 3 райдеров» — новое правило, порт отдаёт `riders` таблицы. **Рекомендация: (a)**, пересмотреть по
  данным.
- **RC-S10 — первая сверка при `pending`.** Новый райдер, впервые открывший приложение, пока сезон в `pending`,
  получит сезонные позже и со вспышкой (A3 нарушается на секунды-минуты). Принимается и фиксируется в ADR.
- **RC-S11 — стоимость GET.** +2 запроса у райдера без сезонных итогов и +5 у райдера с ними (5). ADR-0020 «≤ ~10» →
  «≤ ~15». Принимается. Новых индексов на `standings` нет.
- **RC-S12 — `codes` в `seen` теперь необязателен.** Схема мягче: `{ codes }` старых сборок валиден, `{}` → 400.
  Сезонный код в `codes` — без записи (как незнакомый), а не «все сезоны кода»: старые сборки сезонных не знают и не
  шлют, новая адресует точно.
- **Без находок:** append-only и аудит не задействованы; новых эндпоинтов, кодов ошибок и лимитов нет; outbox и очереди
  не нужны (регламент `standings` уже пересчитывает снимок, сверка читает его на GET); серверный авторитет соблюдён
  (клиент шлёт только адрес «показано»).

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

- `docs/product/profile.md` — S1–S8 с уточнениями RC-S1 (нужен финиш с местом), RC-S2 (все гонки с коридором с
  протоколом), RC-S3 («с местом» ≠ «засчитанные»); «Где в продукте — достижения» (сезонные в профиле и публично,
  «К сезону», без «Поделиться»); в Out of Scope (~стр. 301) убрать «сезонные достижения».
- `docs/adr/0020-achievements-reconcile-on-read.md` — «Дополнение: сезонные»: ключ выдачи `(userId, code, seasonId)` и
  `0043` (новый индекс → удаление старого, HG-S1); факты — порт `standings` `RIDER_SEASON_STANDINGS` (снимок, без
  пересчёта); `settled`-сезоны (`final`) — только в них сверка меняет сезонные; бюджет запросов ≤ ~15; RC-S10.
- `docs/product/races-and-seasons.md` — в разделе рейтинга сезона ссылка: итоговый снимок даёт сезонные достижения.
- `.claude/rules/pokatim-backend.md` — `achievements → standings` (порт `RIDER_SEASON_STANDINGS`, только
  `AchievementsModule`); `SEASONAL_RULES`, `grantKey`, `settled`; `SeasonRaces.finishedSeasons/awaitingProtocol`,
  `protocolRaces(seasonIds?)`, `StandingsSource.load(seasonIds?)`; карточка — сезонный код → 409.
- `.claude/rules/pokatim-db.md` — `seasonId` выдачи (`null` / нет поля ≡ несезонная), индекс
  `achievement_grants_user_code_season_unique` (`0043`, старый удалён), `markSeen` с `$or` адресов.
- `.claude/rules/pokatim-contracts.md` — сезонные коды и порядок, `kind: 'season'`, `SEASON_REGULAR_MIN_RACES`,
  `MarkAchievementsSeenRequest` `{ codes?, seasonal? }` и правило «`seasonal` клиент шлёт только непустым».
- `.claude/rules/pokatim-security.md` — `seen` (`seasonal` ≤ 30), «GET пишет ≤ 9 + 3 × сезонов», публичные сезонные.
- `.claude/rules/pokatim-app.md` — `achievementKey`/`flashKey` (код + объект для сезонных), `storyCard`, «К сезону»,
  `?season=`.
- `pr.md` — миграция `0043` (удаляет индекс, HG-S1; деплой: миграции до API).

## 11. Implementation Context

ENTRY POINTS: `GET /v1/achievements` (`AchievementsController.list` → `AchievementsService.sync`), `POST
/v1/achievements/seen`, `GET /v1/riders/:publicId/achievements` (`publicList`), `GET /v1/achievements/:code/story-card`
(отказ для сезонных), порт `RIDER_SEASON_STANDINGS.outcomesOf`; app `/profile`, `/achievements/flash`,
`/achievements/<code>?season=`, `/riders/<id>`.

FILES TO MODIFY / READ / TYPES & SCHEMAS — разделы 5.1, 6, 7. TESTS — 7.8.

OUT OF SCOPE — раздел 4, а также: регламент `standings.sync` и формула (`STANDINGS_FORMULA_VERSION` не меняется),
индексы `standings`, `renderVersion` карточек, en-словарь, push, ручная выдача.

Порядок TDD (один PR, коммиты по шагам; в конце `pnpm check` зелёный):

1. **Contracts** — красные тесты схемы (7.1, 7.8) → коды (порядок RC-S4), `SEASONAL_*`, `isSeasonalCode`,
   `SEASON_REGULAR_MIN_RACES`, `kind: 'season'`, `SeasonalAchievementRef`, новый `MarkAchievementsSeenRequest`;
   `index.ts`. Типовые ошибки в `ACHIEVEMENT_RULES`, `ACHIEVEMENT_BADGE_ICONS`, `ACHIEVEMENT_CATALOG` закрыть на шагах 3,
   6, 8 (на этом шаге — минимально, чтобы собиралось).
2. **Races/Standings port** — красный `rider-season-standings.int.test.ts` (7.8) → `SeasonRaces.finishedSeasons`,
   `awaitingProtocol`, `protocolRaces(seasonIds?)`; `StandingsRepository.rowsOfUserIn`, `headersOf`;
   `StandingsSource.load(seasonIds?)` (+ правка вызовов в `standings-recalc.ts`, `standings-read.service.ts`; регресс
   `standings-*.int.test.ts` зелёный); порт и реализация в `StandingsCoreModule`, экспорт `index.ts`.
3. **Policy** — красные тесты (RC-S1, RC-S3, RC-S6, RC-S7) → `FactAchievementCode`, `SEASONAL_RULES`,
   `seasonalAchievements`, `grantKey`, `reconcilePlan` по ключу с `settled`.
4. **Migration** — красный тест `0043` → миграция + `index.ts` (HG-S1 в `pr.md`).
5. **Repository** — `seasonId` в документе и фильтрах, `listOf`, новое имя индекса, `markSeen` с адресами.
6. **Service/Module/Controller** — `AchievementsModule` + `StandingsCoreModule`; `sync`, `publicList`, `markSeen`;
   `achievements-for-sharing` (сезонный → `null`), `achievement-card.icons.ts` (`FactAchievementCode`). Int-тесты AC2–AC6,
   стирание, sharing 409 — сначала красные.
7. **api-client** — `markAchievementsSeen(t, codes, seasonal = [])` + тест.
8. **i18n + App каталог/сессия/queries** — тесты `achievement-catalog.test.ts`, `flash-session.test.ts`,
   `queries.test.tsx` → каталог (3 кода, флаги), `achievementKey`, `flashKey`, `achievementPath`, `seenTarget`,
   мутация по целям.
9. **App UI** — экран (`?season=`, «К сезону»), вспышка (без «Поделиться», «К сезону»), плитки по ключу, профиль
   (переход), публичный блок; сторис-экран с сезонным кодом — «нет карточки». RTL-тесты (AC7).
10. **Документы** — раздел 10; `pnpm check`.
