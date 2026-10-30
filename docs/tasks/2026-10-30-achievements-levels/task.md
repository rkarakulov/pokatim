# Достижения: уровни и прогресс к следующей цели

Уровень: task3 (контракт, коллекция, сверка, приложение). Follow-up `docs/tasks/2026-10-29-achievements` (Out of
Scope: уровни, прогресс). Серия follow-up из трёх PR: **этот (L)** — уровни и прогресс; **S** — сезонные
достижения; **P** — push о новом достижении и ручная выдача/отзыв в панели.

## 1. Title

Уровни «Бронза / Серебро / Золото» у счётных достижений и прогресс к следующему уровню в профиле.

## 2. Goal

Счётные достижения («Пять гонок», «Пять маршрутов», «Десять кофе-райдов») перестают быть «потолком»: у них три
уровня, новый уровень вспыхивает как новое достижение, а в профиле видно, сколько осталось до следующего.

### Решения L1–L7 (автор — сессия follow-up, 2026-10-30; спеки уровней в `docs/product` не было)

- **L1 — уровни у трёх счётных кодов** (коды не меняются — установленные сборки их знают):

  | Код | Название (новое) | Бронза | Серебро | Золото | Что считается |
  |---|---|---|---|---|---|
  | `races_5` | Гонщик | 5 | 15 | 30 | разные гонки «в зачёте» (как сейчас) |
  | `routes_5` | Путешественник | 5 | 15 | 30 | разные маршруты `passed` (как сейчас) |
  | `rides_10` | Завсегдатай | 10 | 25 | 50 | прошедшие кофе-райды (условия R8, как сейчас) |

  Остальные 6 кодов — без уровней (`level: null`). Бронза = прежнее условие, поэтому уже выданные достижения
  остаются бронзой без миграции данных.
- **L2 — объект и дата** — факт, которым достигнут текущий уровень (5-я / 15-я / 30-я гонка по дате; для маршрутов —
  маршрут по дате его первого заезда, как в v1).
- **L3 — новый уровень вспыхивает.** Выдача хранит текущий уровень и наибольший показанный (`seenLevel`). `seen` в
  ответе = показан текущий уровень. Повышение уровня → `seen: false` → вспышка «Новый уровень». Первая сверка — тихо
  на любом уровне (A3). Понижение (факты пропали, A4) — молча, ниже бронзы — отзыв, как в v1. Возврат на уже
  показанный уровень повторно не вспыхивает.
- **L4 — прогресс.** `GET /v1/achievements` отдаёт ещё `progress`: по каждому из трёх счётных кодов, где золото не
  достигнуто и счёт ≥ 1, — следующий уровень, текущий счёт и порог (`{ code, level, current, target }`). Только
  своё; в публичном профиле прогресса нет.
- **L5 — профиль.** Под блоком «Достижения» — «Следующие цели»: строки «Гонщик · Серебро», полоса прогресса, «7 из
  15». Прогресса нет — блока нет. Блок показывается и без единого достижения (райдер с 2 гонками видит «2 из 5»).
- **L6 — значок и экран.** На значке счётного — число = порог текущего уровня (5/15/30) и метка уровня («Бронза» /
  «Серебро» / «Золото») на экране, во вспышке и в a11y-подписи; новых цветов нет — только роли темы (уровень не
  кодируется одним цветом). Условие на экране — для текущего уровня («Финиш в зачёте 15 разных гонок»). Вспышка
  повышения — заголовок «Новый уровень».
- **L7 — публично и карточка.** Публичный профиль — уровень у гоночного `races_5`. Карточка для сторис
  (`/achievements/story/<code>`) — число на значке и подпись — по текущему уровню; кэш карточки различает уровни.

## 3. Scope

### API (`apps/api`, `packages/contracts`, `packages/api-client`)

1. Политика: таблица уровней (`ACHIEVEMENT_LEVELS` — пороги), правила счётных кодов отдают уровень; расчёт
   прогресса — чистая функция над теми же отсортированными фактами.
2. Выдача: поля `level` (1–3 | null) и `seenLevel`; сверка: повышение/понижение уровня — обновление (`refresh`),
   `seen` = `seenAt != null && seenLevel >= level` (старые документы без полей — уровень 1 / null, без бэкфилла).
   `POST seen` ставит `seenLevel = level` (атомарно, одной условной операцией).
3. Контракты: `Achievement.level` — `tolerantEnum(['bronze','silver','gold']).nullable()` (старые сборки поле
   игнорируют), `AchievementList.progress` (массив, `default([])` для чтения), `PublicRiderAchievement.level`.
4. Публичный список — с уровнем. Порт `ACHIEVEMENTS_FOR_SHARING` — уровень; рендер карточки — порог уровня на
   значке и метка; ключ кэша/версия рендера учитывает уровень.
5. Миграция — только если нужна (индексы не меняются); номер — свериться с develop.

### Приложение (`apps/app`, `packages/i18n`)

1. Каталог: уровни у трёх кодов (пороги — из ответа/таблицы), новые названия, условие по уровню, метка уровня.
2. Значок: число по уровню; экран достижения и вспышка — метка уровня, «Новый уровень» при `level > bronze`
   (неизвестный уровень — как без уровня).
3. Блок «Следующие цели» в `/profile` (L5) — полосы прогресса на токенах темы, a11y («Гонщик, серебро: 7 из 15»).
4. i18n ru (+ en, если в проекте есть en-ключи достижений).

## 4. Out of Scope

- Уровни у «Подиума», «Победы» и прочих разовых; «закрытые» (не начатые, счёт 0) цели.
- Сезонные достижения (PR S), push и ручная выдача в панели (PR P).
- Новые цвета «металлов» в дизайн-токенах.

## 5. Architecture Context

Architecture Review (architect, 2026-10-30) — **Status: CONCERNS** (блокеров нет; RC-L3, RC-L4, RC-L5 — обязательные
правки реализации, RC-L1/RC-L2 — на подтверждение человеку, по умолчанию — рекомендация).

- **Модель не меняется** (ADR-0020): выдача — проекция фактов, сверка при `GET /v1/achievements`, один документ на
  `(userId, code)`, каждая запись — одна условная операция без транзакций, маркер первой сверки — после выдач. Уровень —
  ещё одно поле проекции, как `object`/`factAt`; `seenLevel` — второе поле «показано», как `seenAt`.
- **Сервер — источник истины уровня и прогресса** (AGENTS §4: серверный авторитет): клиент не присылает ни уровня, ни
  счёта; `POST seen` по-прежнему несёт только коды, уровень берётся из документа в той же атомарной операции.
- **Пороги — одна таблица на монорепо** (RC-L1): `ACHIEVEMENT_LEVEL_TARGETS` в `packages/contracts` — её читают политика
  API, рендер карточки (`sharing`, число на значке) и каталог приложения (число на значке, условие). Копий порогов в
  `apps/api/src/modules/sharing/achievement-card.icons.ts` и `apps/app/.../achievement-catalog.ts` нет.
- **Хранение — числовой ранг 1–3** (`level`, `seenLevel` в `achievement_grants`): нужен для `$lt`/`$max` в
  update pipeline. Наружу (ответы, порт `ACHIEVEMENTS_FOR_SHARING`) — строка `bronze | silver | gold`; перевод — одна
  функция `levelName(rank)` в `achievements.policy.ts`.
- **Нормализация старых документов на чтении, без бэкфилла:** отсутствующее/`null` поле `level` ≡ 1, `seenLevel` ≡ 1.
  Для разовых кодов ранг всегда «1» — формула `seen` одна для всех кодов (7.3).
- **Ни миграции, ни очередей, ни outbox, ни append-only/аудита.** Индексы не меняются (последняя миграция —
  `0041_panel_invitations`; новой нет), `achievement_grants` — не append-only (ADR-0020), журнал панели не задействован.
  BullMQ задействован только косвенно: существующая задача `achievement-card.render` (ключ — хэш входов, NX-постановка)
  получает новый хэш через входы карточки — кода очереди не трогаем.
- **Совместимость.** Старые сборки: ответ только расширяется (`z.object` отбрасывает незнакомые `level`/`progress`) —
  строже не становится; поведенческое следствие — RC-L6. Новая сборка со старым API (web раньше API): `level` —
  `.nullable().default(null)`, `progress` — `.default([])` → поведение v1.
- **Гонки.** Параллельные GET при повышении уровня: все планируют `refresh`, запись — идемпотентный `$set` одного
  документа, дублей нет (уникальный индекс не затрагивается). Устаревший план может временно записать меньший уровень;
  `seenLevel` монотонен (`$max`), поэтому повторной вспышки нет — следующая сверка вернёт уровень «тихо» (int-тест,
  негативное доказательство — 7.8).

## 5.1 Placement & Reuse Gate

| Что | Где | Почему / reuse |
|---|---|---|
| `ACHIEVEMENT_LEVELS`, `ACHIEVEMENT_LEVEL_TARGETS`, `AchievementLevel`, `LeveledAchievementCode`, `AchievementProgress` | `packages/contracts/src/achievements/achievement.schema.ts` (+ экспорт `src/index.ts`) | ≥ 3 потребителя (api policy, sharing, app); новый пакет не нужен |
| Правила уровней, прогресс, `isSeen`, `levelName`, план сверки | `apps/api/src/modules/achievements/achievements.policy.ts` | чистые функции рядом с `ACHIEVEMENT_RULES`; второй сортировки фактов нет — `sortFacts` один раз |
| Факты + прогресс одним чтением | `achievement-facts.reader.ts` (`evaluate`) | общий для `sync` и порта карточки; порты владельцев не меняются |
| Поля `level`, `seenLevel` | `achievements.collection.ts`, `achievements.repository.ts` | единственный писатель — репозиторий |
| Уровень в ответах | `achievements.service.ts` (`sync`, `publicList`) | явный список полей (security) |
| Уровень в порту карточки | `achievements-for-sharing.port.ts` / `achievements-for-sharing.ts` | `sharing` коллекций не читает |
| Число на значке, метка, ключ кэша | `sharing/achievement-card.{icons,inputs,texts,render}.ts`, `sharing.policy.ts` (`renderVersion`) | `story-card.cache.ts` **не меняется**: ключи Redis — производные от хэша входов |
| Каталог (пороги из contracts, условие по уровню, метка) | `apps/app/src/features/achievements/achievement-catalog.ts` | без копии порогов |
| Значок с уровнем | `achievement-badge.tsx` (проп `level`) | — |
| Вспышка «Новый уровень», ключ сессии `code:level` | `achievement-flash-screen.tsx`, `achievement-catalog.ts` (`flashQueue`), `flash-session.ts` | RC-L4 |
| Блок «Следующие цели» | новый `apps/app/src/features/achievements/achievement-progress-block.tsx`, встраивание — `features/profile/own-profile-screen.tsx` | данные — тот же `useAchievements()` (ключ `['achievements']`), второго запроса нет |
| Полоса прогресса | новый `apps/app/src/components/progress-bar.tsx`, переиспользовать в `features/devices/upload-progress.tsx` | RC-L9: второй потребитель; в `@rkarakulov/ui` компонента нет — follow-up в базу app-foundation |
| Строки | `packages/i18n/src/ru.ts` | en-словаря в проекте нет |

**Запрещённые дубли:** вторая таблица порогов (api/app/sharing); второй расчёт счёта для прогресса (только длины
`Sorted.races/routes/rides` из `sortFacts`); свой предикат «в зачёте» (только `isRankedRow`); ручная полоса прогресса
второй раз (только `components/progress-bar.tsx`); чтение `achievement_grants` из `sharing`.

## 6. Relevant Files

API / контракты:
- `packages/contracts/src/achievements/achievement.schema.ts`, `.test.ts`; `packages/contracts/src/index.ts`;
  `packages/contracts/src/common.ts` (`tolerantEnum` — образец, не менять).
- `packages/api-client/src/index.ts` (`listAchievements`, `getRiderAchievements` — сигнатуры не меняются, схемы
  подтягиваются), `packages/api-client/src/achievements.test.ts` (ответ без `level`/`progress` разбирается).
- `apps/api/src/modules/achievements/achievements.policy.ts`, `.policy.test.ts`, `achievement-facts.reader.ts`,
  `achievements.collection.ts`, `achievements.repository.ts`, `achievements.service.ts`,
  `achievements-for-sharing.port.ts`, `achievements-for-sharing.ts`, `achievements.int.test.ts`, `index.ts`.
- `apps/api/src/modules/sharing/achievement-card.icons.ts`, `achievement-card.inputs.ts`, `achievement-card.texts.ts`,
  `achievement-card.render.ts`, `achievement-card.render.test.ts`, `achievement-card.int.test.ts`, `sharing.policy.ts`,
  `story-card.inputs.test.ts` (мок `renderVersion` `3 as 2` → под новую версию). Читать: `story-card.cache.ts`,
  `story-card.processor.ts` (сверка «устарело» по хэшу) — без правок.
- `apps/api/test/achievements.ts` (хелперы `raceAt`, `seedRouteRide`, `pastRide`; при необходимости — `racesAt(n)`).
- Образец pipeline-update: `apps/api/src/modules/notifications/notifications.repository.ts:209`.

Приложение:
- `apps/app/src/features/achievements/achievement-catalog.ts`, `.test.ts`, `achievement-badge.tsx`,
  `achievement-card.tsx`, `.test.tsx`, `achievement-flash-screen.tsx`, `achievement-flash-host.tsx`, `flash-session.ts`,
  `achievements-block.tsx`, `queries.ts`, новый `achievement-progress-block.tsx` (+ тест);
  `apps/app/src/features/profile/own-profile-screen.tsx`; новый `apps/app/src/components/progress-bar.tsx`;
  `apps/app/src/features/devices/upload-progress.tsx`.
- `packages/i18n/src/ru.ts` (блок `achievements.*`, ~стр. 754–788).

Документы: `docs/product/profile.md` (A1–A8, «Где в продукте», стр. ~229 Out of Scope), `docs/adr/0020-…`,
`.claude/rules/pokatim-{backend,db,contracts,security,app}.md` (разделы «Достижения»).

## 7. Implementation Notes

### 7.1 Контракты

```ts
/** Уровни счётных достижений — только в конец. */
export const ACHIEVEMENT_LEVELS = ['bronze', 'silver', 'gold'] as const;
export type AchievementLevel = (typeof ACHIEVEMENT_LEVELS)[number];

/** Пороги уровней (L1): индекс = ранг − 1. Выпущенные пороги не меняются; новый уровень — только в конец. */
export const ACHIEVEMENT_LEVEL_TARGETS = {
  races_5: [5, 15, 30],
  routes_5: [5, 15, 30],
  rides_10: [10, 25, 50],
} as const satisfies Partial<Record<AchievementCode, readonly [number, number, number]>>;
export type LeveledAchievementCode = keyof typeof ACHIEVEMENT_LEVEL_TARGETS;
export const isLeveledCode = (code: AchievementCode): code is LeveledAchievementCode => code in ACHIEVEMENT_LEVEL_TARGETS;

const AchievementFields = {
  code: tolerantEnum(ACHIEVEMENT_CODES),
  object: AchievementObject,
  factDate: LocalDate,
  /** уровень счётного; разовые — null; старый API без поля — null (= v1, бронза у счётных) */
  level: tolerantEnum(ACHIEVEMENT_LEVELS).nullable().default(null),
};

/** Прогресс к следующему уровню (L4) — только свой список. */
export const AchievementProgress = z.object({
  code: tolerantEnum(ACHIEVEMENT_CODES),
  level: tolerantEnum(ACHIEVEMENT_LEVELS),
  current: z.number().int().nonnegative(),
  target: z.number().int().positive(),
});
export const AchievementList = z.object({
  items: z.array(Achievement),
  progress: z.array(AchievementProgress).default([]),
});
```

- `PublicRiderAchievement` получает `level` через общие `AchievementFields`; `progress` в публичной схеме **нет**.
- `MarkAchievementsSeenRequest` **не меняется** (RC-L5): строгий запрос, старые сборки шлют то же.
- Тип вывода `AchievementList` (сервер) — `level` и `progress` обязательны: компилятор заставит сервис их заполнить.
- Комментарий каталога (`ACHIEVEMENT_CODES`, «уровней нет») — обновить.

### 7.2 Политика (`achievements.policy.ts`)

```ts
export type LevelRank = 1 | 2 | 3;
export interface Earned { object: AchievementObjectRef; factAt: Date; title: string | null; level: LevelRank | null }
export interface ProgressItem { code: LeveledAchievementCode; level: LevelRank; current: number; target: number }
export interface Evaluation { earned: Map<AchievementCode, Earned>; progress: ProgressItem[] }

export const levelName = (rank: LevelRank): AchievementLevel => ACHIEVEMENT_LEVELS[rank - 1]!;
export function evaluateAchievements(facts: AchievementFacts): Evaluation;      // sortFacts один раз
export function earnedAchievements(facts: AchievementFacts): Map<AchievementCode, Earned>; // = evaluate(...).earned
export function raceAchievements(rows: readonly RiderProtocolRow[]): Map<AchievementCode, Earned>; // без изменений сигнатуры
export function isSeen(grant: Pick<StoredGrant, 'seenAt' | 'seenLevel'>, level: LevelRank | null): boolean;
//   = grant.seenAt !== null && (grant.seenLevel ?? 1) >= (level ?? 1)
export const storedRank = (grant: Pick<StoredGrant, 'level'>): LevelRank => grant.level ?? 1;
```

- Источник фактов счётного кода — одна таблица `LEVELED_FACTS = { races_5: (s) => s.races, routes_5: (s) => s.routes,
  rides_10: (s) => s.rides } satisfies Record<LeveledAchievementCode, (s: Sorted) => readonly unknown[]>` — её читают и
  правило, и прогресс (без второго счёта). Правило: наибольший ранг `r`, где `list.length >= targets[r-1]`; объект и
  дата — `list[targets[r-1] - 1]` (L2), `level: r`. Ниже бронзы — `null` (нет выдачи).
- Разовые правила возвращают `level: null`. `ACHIEVEMENT_RULES` остаётся исчерпывающим (`satisfies Record<AchievementCode, …>`).
- Прогресс: для каждого `LeveledAchievementCode` в порядке каталога: `current = list.length`; `current === 0` → нет строки;
  `current >= targets[2]` → нет строки; иначе следующий ранг = первый `r` с `targets[r-1] > current`, `target = targets[r-1]`.
- `raceAchievements` даёт уровень гоночного `races_5` (публичный список, L7).
- Удалить константы `RACES_GOAL`/`ROUTES_GOAL`/`RIDES_GOAL` — пороги только из contracts.

### 7.3 Выдача и сверка

`StoredGrant` += `level?: LevelRank | null`, `seenLevel?: LevelRank | null` (необязательные — документы v1).

```ts
export type ReconcileStep =
  | { type: 'insert'; code: AchievementCode; earned: Earned; seen: boolean }   // seen ⇒ seenAt = now, seenLevel = earned.level
  | { type: 'restore'; code: AchievementCode; earned: Earned }
  | { type: 'refresh'; code: AchievementCode; earned: Earned }
  | { type: 'revoke'; code: AchievementCode };
```

- `refresh` — если `!sameFact(grant, fact) || storedRank(grant) !== (fact.level ?? 1)`. Повышение уровня всегда меняет
  объект (другой индекс в списке разных объектов), но проверка ранга нужна для документа v1 на бронзе (совпадает — плана нет).
- Вставка: `level: earned.level`, `seenAt: first ? now : null`, `seenLevel: first ? earned.level : null` (первая сверка
  тихо на любом уровне, L3/A3). Можно оставить `seenAt: Date | null` в шаге, как сейчас, — главное, чтобы `seenLevel`
  писался вместе с ним.
- `restoreOrRefresh`: `$set` += `level: earned.level`; `seenAt`, `seenLevel`, `grantedAt` не трогаются (возврат на
  показанный уровень не вспыхивает; на более высокий — вспыхивает).
- `revoke` — без изменений (ниже бронзы — отзыв, `level`/`seenLevel` остаются для возврата).
- Ответ `sync`: `level: item.level === null ? null : levelName(item.level)` из **фактов этого запроса** (как `object`
  и `factDate`); `seen: isSeen(перечитанная выдача, item.level)` — сравнивается с уровнем, который показываем, а не с
  сохранённым (устаревший параллельный план мог записать меньший). `progress` — из той же `Evaluation`, наружу —
  `{ code, level: levelName(level), current, target }`.
- Лог `achievements.sync` — добавить счётчик `refreshed` (без кодов и уровней) — по желанию, не обязательно.

### 7.4 `POST seen` — атомарно, одной условной операцией (update pipeline)

```ts
await this.c.grants.updateMany(
  {
    userId, code: { $in: [...codes] }, revokedAt: null,
    $expr: { $or: [
      { $eq: [{ $ifNull: ['$seenAt', null] }, null] },
      { $lt: [{ $ifNull: ['$seenLevel', 1] }, { $ifNull: ['$level', 1] }] },
    ] },
  },
  [{ $set: {
    seenAt: { $ifNull: ['$seenAt', now] },
    seenLevel: { $max: [{ $ifNull: ['$seenLevel', 1] }, { $ifNull: ['$level', 1] }] },
    updatedAt: now,
  } }],
);
```

- Каждый документ — атомарно: `seenLevel` берётся из `level` того же документа в момент записи (не из GET клиента).
- `$max` — `seenLevel` монотонен: после понижения (A4) и устаревшего плана повторной вспышки нет.
- Повтор — 0 изменённых (фильтр не совпадает). Разовые коды: `seenLevel` станет 1 — эквивалентно `null`.
- Окно «повышение между GET и POST seen» (п. 8) — принимается (RC-L5).

### 7.5 Совместимость документов v1

- Без бэкфилла и миграции: `level`/`seenLevel` отсутствуют → 1/1; `seen` v1-бронзы = `seenAt != null` (AC3).
- Первая сверка после деплоя у райдера с ≥ 15 гонками и выдачей v1: `refresh` до серебра/золота → `seen: false` →
  **одна** вспышка «Новый уровень» на текущем уровне (не каскад) — RC-L2.
- `listOf` — проекция `+ level: 1, seenLevel: 1`; `StoredGrantDoc` — `+ 'level' | 'seenLevel'` (опциональные в
  `AchievementGrantDoc`).

### 7.6 Карточка сторис (`sharing`)

- Порт: `AchievementCardFacts` += `level: AchievementLevel | null` (из `Earned` фактов, как остальное; выдача — по-прежнему
  только «не отозвана»).
- `achievement-card.icons.ts`: убрать статический `count`; число — `badgeCount(code, level)` = `ACHIEVEMENT_LEVEL_TARGETS[code][rank-1]`
  для счётных (уровень `null` у счётного не бывает — защита: бронза), `undefined` для разовых.
- `achievementCardHash`: в канонический массив — `facts.level` **явно** (после `facts.code`). Объект и дата и так
  меняются при повышении, но явный уровень защищает от совпадения (и делает намерение проверяемым тестом).
- `STORY_CARD_POLICY.renderVersion`: 2 → 3 — меняются строки (`achievements.*.title/condition`) и верстка
  (метка уровня); обновить мок в `story-card.inputs.test.ts`. Ключи Redis (`story-card:{token,png,pending,failed}`)
  остаются функциями хэша — `story-card.cache.ts` не меняется; задача `achievement-card.render` и сверка «устарело»
  в `story-card.processor.ts` работают по новому хэшу без правок. Смена версии перерисует и прочие сторис (кэш 24 ч) —
  допустимо.
- Тексты (RC-L7): `title` — новое название; `condition` — условие уровня (`{count}` = порог); метка уровня — в строке
  kicker: «Достижение · Серебро» (`achievementCard.kickerLevel` с `{level}`), у разовых — прежний kicker. Значок — число
  порога.

### 7.7 Приложение

- Каталог: `count` в `CatalogEntry` → `leveled: boolean` (или вычислять `isLeveledCode`). Функции:
  `displayLevel(code, level): AchievementLevel | null` — счётный + `null` (старый API) → `'bronze'`; `'unknown'` → `null`;
  разовый → `null`. `badgeCount(code, level)` — порог `displayLevel` из `ACHIEVEMENT_LEVEL_TARGETS`, у `unknown` — без
  числа. `achievementCondition(code, level)` — `t(entry.condition, { count })` (неизвестный уровень — порог бронзы).
  `levelLabel(level)` — `achievements.level.{bronze,silver,gold}`. `achievementA11y(item)` — с уровнем, если есть.
- `flashKey(item) = \`${item.code}:${item.level ?? ''}\`` — **ключ сессии вспышки** (`markShown`, `openPresented`,
  `hiddenCodes`, фильтр в `flashQueue`, `key` карточки) — RC-L4. `POST seen` — по коду, как было.
- Вспышка: kicker на текущей карточке — `achievements.flash.levelUp` («Новый уровень») при `level ∈ {silver, gold}`,
  иначе «Новое достижение»; заголовок документа — по первому элементу или общий (не критично).
- `queries.ts` `setSeen`: `{ ...list, items: … }` — **не терять `progress`** (RC-L3).
- `AchievementBadge({ code, level, size })`; `AchievementCard`/`Tile` передают `item.level`; на экране и во вспышке —
  метка уровня под названием (текст, роль `text.secondary`), цветом уровень не кодируется.
- `AchievementProgressBlock({ query })`: `knownProgress = progress.filter(code !== 'unknown' && level !== 'unknown')`;
  пусто, загрузка или ошибка — `null` (ошибку показывает `AchievementsBlock`, двух баннеров нет). Заголовок
  «Следующие цели» (`accessibilityRole="header"`), строка: «Гонщик · Серебро», `ProgressBar` (`current/target`,
  `accessibilityRole="progressbar"`, `accessibilityValue {min:0,max:target,now:current}`), «7 из 15»; a11y строки —
  `achievements.progress.a11y` «{title}, {level}: {current} из {target}». В `own-profile-screen.tsx` — сразу под
  `AchievementsBlock`, тот же `achievements` query.
- i18n ru (новые/изменённые): `achievements.races_5.title` «Гонщик», `routes_5` «Путешественник», `rides_10`
  «Завсегдатай»; условия с `{count}` («Финиш в зачёте {count} разных гонок», «Пройденные заезды по {count} разным
  маршрутам», «{count} прошедших кофе-райдов»); `achievements.level.{bronze,silver,gold}`; `achievements.flash.levelUp`;
  `achievements.a11yLevel`; `achievements.progress.{title,count,a11y}`; `achievementCard.kickerLevel`. Склонения для
  порогов 5/10/15/25/30/50 совпадают (род. мн.).

### 7.8 Test matrix

| Уровень | Что | AC |
|---|---|---|
| unit contracts | `level` default `null`, `'platinum'` → `'unknown'`; `progress` default `[]`; ответ v1 (без полей) разбирается; публичная схема без `progress`; `MarkAchievementsSeenRequest` не изменился | AC3, AC7 |
| unit policy | пороги 4/5, 14/15, 29/30 гонок; 14/15 маршрутов (повторы маршрута не считаются); 9/10, 24/25, 49/50 райдов; объект/дата — факт порога; разовые `level: null`; прогресс (0 → нет, 2 → bronze 2/5, 7 → silver 7/15, 30 → нет; порядок каталога); `isSeen` (v1 без полей, seenLevel < level, null-уровни); `reconcilePlan`: повышение/понижение → `refresh`, v1-бронза → пустой план, первая сверка → вставка просмотренной на серебре; `raceAchievements` с уровнем | AC1, AC3, AC4 |
| int achievements (реальная Mongo) | AC2-сценарий целиком (15 → silver seen; +15 → gold unseen; seen; DQ → silver seen; возврат → gold seen); документ v1 вставлен напрямую без полей → бронза, `seen` по `seenAt`; `progress` по трём кодам, публичный ответ — точный список ключей с `level`, без `progress`; точный список ключей своего ответа (+`level`, `progress`); `POST seen` повтор — 0 записей; параллельные GET ×5 при повышении — без 500 и дублей, `seen` согласован; **негатив:** устаревший `restoreOrRefresh` с меньшим уровнем после `seen` на большем → следующая сверка — `seen: true` (монотонность `seenLevel`) | AC2–AC5 |
| unit sharing | `achievementCardHash` различает уровни при равных прочих входах; `renderVersion` в хэше; тексты — название/условие уровня, kicker с меткой; render — число порога на значке | AC6 |
| int sharing | серебро → картинка A; +гонки → золото → статус `pending` (новый хэш), токен ≠ прежнего | AC6 |
| api-client | `listAchievements` разбирает ответ без `level`/`progress` и с ними | AC7 |
| app unit (jest/RTL) | каталог: `displayLevel` (null → bronze у счётных, unknown → нет), `badgeCount`, условие по уровню; `flashQueue`/`flash-session` по `code:level` — повышение в том же запуске вспыхивает, тот же уровень — нет; `setSeen` сохраняет `progress`; карточка/вспышка — метка и «Новый уровень»; `AchievementProgressBlock` — строки, `progressbar` a11y, нет прогресса/ошибка — `null`, показывается без достижений; ответ без `level`/`progress` не ломает блоки | AC7 |
| e2e web | не обязателен; смоук `/profile` существующий | — |

## 8. Risks / Assumptions / Open Questions

- Порт `results.publishedRows` ограничен 2000 строками — 30 гонок далеко ниже лимита.
- Гонка двух сверок при повышении уровня — как в v1: каждая запись условна, сходятся к одному состоянию.
- `POST seen` после повышения уровня между GET и отметкой отметит новый уровень показанным, не показав его —
  допустимо (окно — секунды), фиксируется в 8.1 при иной рекомендации архитектора.

## 8.1 Requirements Consistency (architect)

Решения L1–L7 не меняются. Уточнения реализации и пункты на подтверждение:

- **RC-L1 — где живут пороги (уточняет Scope API.1).** Scope кладёт `ACHIEVEMENT_LEVELS` в политику API, но пороги нужны
  ещё карточке (`sharing`) и приложению (число на значке, условие). Варианты: (a) таблица в `packages/contracts`
  (`ACHIEVEMENT_LEVEL_TARGETS`), читают все трое; (b) в политике API + копии в `achievement-card.icons.ts` и каталоге
  приложения (как сейчас `count`) — дубль, расхождение при правке; (c) сервер отдаёт `target` у каждого элемента — ещё
  поле контракта, а карточке и условию всё равно нужен порог. **Рекомендация: (a)**; выпущенные пороги не меняются
  (новый уровень — только в конец), иначе старые новые-сборки покажут не тот порог в условии.
- **RC-L2 — вспышка у действующих райдеров после деплоя.** Райдер с выдачей v1 и 15+ гонками при первом GET после
  деплоя получит одну вспышку «Новый уровень» (сразу на текущем уровне, не каскадом). L3 «первая сверка — тихо»
  относится к первой сверке райдера, а не к первой после деплоя; ADR-0020 уже принимает вспышку нового кода у
  сверившихся. Варианты: (a) принять — это и есть анонс уровней; (b) маркер «уровни сверены» (`achievement_syncs.levelsSyncAt`)
  и тихое повышение при первой сверке после деплоя — ещё поле и ветка плана; (c) тихо только для `level ≥ 3`.
  **Рекомендация: (a)**, зафиксировать в ADR-0020 (дополнение) и `profile.md`.
- **RC-L3 — оптимистичная пометка стирает `progress` (баг при реализации).** `useMarkAchievementsSeen.setSeen` пересобирает
  кэш как `{ items }` — после вспышки блок «Следующие цели» исчезнет до перезапроса. Обязательно `{ ...list, items }` +
  тест.
- **RC-L4 — сессия вспышки по коду глушит повышение в том же запуске (баг при реализации).** `flash-session` хранит
  `shown`/`presented` по коду: бронза, показанная в этом запуске, скроет серебро до перезапуска. Варианты: (a) ключ
  `code:level` везде в `flash-session`/`flashQueue`; (b) сброс `shown` по коду при смене уровня в ответе — хрупко.
  **Рекомендация: (a).**
- **RC-L5 — окно `POST seen` после повышения (п. 8 Risks).** Варианты: (a) принять — уровень берётся из документа в
  атомарной операции, окно — секунды, один пользователь; (b) необязательное `levels` в запросе и условие
  `level <= присланный` — меняет строгую схему запроса и логику ради редкого случая. **Рекомендация: (a)**, запрос не
  меняется.
- **RC-L6 — старые сборки после повышения.** Сборка без уровней получит `seen: false` у того же кода и покажет
  «Новое достижение: Пять гонок» (старые название/условие, объект — 15-я гонка), затем пометит — `seenLevel` встанет на
  текущий. Ответ строже не стал; отличить старую сборку сервер не может (версии клиента в запросе нет). **Рекомендация:
  принять** (раз на повышение; обновление сборки снимает).
- **RC-L7 — «подпись» карточки (L7) недоопределена.** Варианты: (a) метка уровня в kicker «Достижение · Серебро», название
  — новое, условие — по уровню; (b) отдельная строка метки под названием — новая вёрстка и токены `storyCard`;
  (c) метка в названии «Гонщик · Серебро». **Рекомендация: (a)** — без новых токенов; `renderVersion` поднять в любом случае
  (меняются строки).
- **RC-L8 — неизвестный уровень и `null` у счётного в приложении.** `null` (старый API) у счётного = бронза (сервер v1
  выдавал только бронзу) — метка «Бронза», число 5/10; `'unknown'` — без метки и числа, условие бронзы, вспышка —
  «Новое достижение». Это уточнение Scope app.2 («неизвестный уровень — как без уровня»).
- **RC-L9 — полоса прогресса — второй потребитель.** Ручная полоса уже есть в `features/devices/upload-progress.tsx`, в
  `@rkarakulov/ui` компонента нет. Варианты: (a) вынести `apps/app/src/components/progress-bar.tsx` и перевести на него
  `upload-progress` + follow-up `ProgressBar` в базу app-foundation; (b) скопировать разметку в блок — дубль; (c) сразу в
  базу — релиз базы блокирует PR. **Рекомендация: (a).**
- **RC-L10 — `seen` сравнивается с уровнем ответа, а не сохранённым.** Ответ берёт `level` из фактов запроса; `seen` =
  `isSeen(выдача, level ответа)`. Иначе устаревший параллельный план (меньший `level` в документе) дал бы `seen: true`
  у неувиденного золота.
- **Миграция** — не нужна (поля необязательные, индексы прежние; последний номер — `0041`). **Append-only / аудит** —
  не задействованы. **Новых кодов ошибок, эндпоинтов, лимитов** — нет.

## 8.2 Решения и отклонения при реализации

- **RC-L2, RC-L6 — приняты пользователем** (2026-10-30): записаны в ADR-0020 («Дополнение: уровни») и
  `docs/product/profile.md` (L3). RC-L1, RC-L3…RC-L10 — по рекомендации архитектора (вариант (a) / принять).
- `ReconcileStep.insert` оставлен с `seenAt: Date | null` (7.3 это допускает); `seenLevel` вставки выводится в
  `insertGrant` из `seenAt` (`seenAt ? earned.level : null`) — отдельного параметра `seenLevel` нет.
- `AchievementFactsReader.earned` заменён на `evaluate` (`Evaluation`: `earned` + `progress`); порт карточки берёт
  `.earned` — одна сортировка фактов на чтение.
- Лог `achievements.sync` получил счётчик `refreshed` (7.3, по желанию).
- Число на значке карточки — `badgeCount`/`achievementBadgeIcon` в `achievement-card.icons.ts`; таблица иконок хранит
  только глиф.
- `AchievementProgressBlock` скрыт, когда нет данных (загрузка, ошибка первой загрузки); при ошибке **обновления** с
  прежними данными прогресс остаётся виден (баннер — только у блока «Достижения», двух баннеров нет).
- a11y строки прогресса: видимые подписи («Гонщик · Серебро», «7 из 15») скрыты от диктора, подпись
  «Гонщик, серебро: 7 из 15» и `accessibilityValue` — у полосы `progressbar` (один элемент для диктора).
  `ProgressBar` получил `accessible` (иначе `progressbar` не находится по роли); `upload-progress` переведён на него.
- `flash-session`: `hiddenCodes` переименован в `hiddenKeys` (ключи `code:level`).
- Тестовые моки приложения (`listAchievements`, фикстуры `Achievement`) дополнены `level: null` / `progress: []` —
  тип вывода схемы теперь их требует (поведение моков прежнее).

## 8.3 Security checklist (зона `apps/api/src/modules/achievements/**` — `pokatim-security.md`)

- [ ] Новых эндпоинтов нет; `AuthGuard`, `no-store`, лимиты и `userId` в каждом фильтре — без изменений.
- [ ] Наружу — явный список полей: свой элемент `code, object{kind,id,title}, factDate, level, seen`; список —
      `items, progress`; публичный — `code, object, factDate, level` (без `progress`, `seen`); int-тест держит ключи.
- [ ] `progress` — только свой (`GET /v1/achievements`); в публичном ответе и карточке — нет.
- [ ] Клиент не влияет на уровень: `POST seen` — только коды, уровень — из документа в атомарной операции.
- [ ] Логи — `uid` и счётчики, без кодов, уровней, названий.
- [ ] Карточка: на картинке — порог и метка уровня (публичная информация по L7), без id объектов.

## 9. Acceptance Criteria

- AC1. Юнит: пороги уровней — 4/5, 14/15, 29/30 гонок; 14/15 маршрутов; 24/25, 49/50 райдов; объект и дата — факт
  порога; разовые — `level: null`.
- AC2. Int: первая сверка райдера с 15 гонками — серебро, `seen: true`; +15 гонок → золото, `seen: false`;
  `POST seen` → `seen: true`; DQ одной гонки → серебро, `seen: true` (без вспышки); возврат → золото, `seen: true`.
- AC3. Старая выдача без `level`/`seenLevel` (документ v1) читается как бронза, просмотренная — если `seenAt` был.
- AC4. `progress`: счёт и следующий порог по каждому коду; золото — нет строки; счёт 0 — нет строки; публичный
  ответ без прогресса.
- AC5. Параллельные GET при повышении уровня — без дублей и 500 (int).
- AC6. Публичный профиль — уровень `races_5`; карточка сторис — порог уровня, разный кэш для разных уровней.
- AC7. Приложение: значок/экран/вспышка с меткой уровня; «Новый уровень» во вспышке повышения; блок «Следующие цели»
  с полосами и a11y; нет прогресса — блока нет; старые ответы без `level`/`progress` не ломают экран.
- AC8. `pnpm check` зелёный; документация: `docs/product/profile.md` (L1–L7, «Где в продукте»), ADR-0020 —
  дополнение про уровни.

## 10. Documentation Impact

- `docs/product/profile.md` — L1–L7 (новые названия, пороги, «Следующие цели»), «Где в продукте — достижения»; из
  списка Out of Scope (~стр. 229) убрать «уровни» и «прогресс» (остаются push, «закрытые» цели, сезонные, ручная выдача).
- `docs/adr/0020-achievements-reconcile-on-read.md` — дополнение «Уровни»: уровень — поле проекции, `seenLevel`
  монотонен, атомарный `POST seen` pipeline-ом, нормализация v1 без бэкфилла, вспышка повышения у сверившихся (RC-L2).
- `.claude/rules/pokatim-contracts.md` — `ACHIEVEMENT_LEVELS`, `ACHIEVEMENT_LEVEL_TARGETS`, `level` (`.nullable().default(null)`),
  `progress` (`.default([])`), публичная схема без `progress`.
- `.claude/rules/pokatim-backend.md` — `evaluateAchievements`, `isSeen`, `levelName`, `LEVELED_FACTS`, `refresh` по
  уровню, порт карточки с `level`, хэш карточки с уровнем, `renderVersion`.
- `.claude/rules/pokatim-db.md` — поля `level`/`seenLevel` (необязательные, ≡ 1), pipeline `markSeen`.
- `.claude/rules/pokatim-security.md` — список полей (`level`, `progress`).
- `.claude/rules/pokatim-app.md` — ключ сессии вспышки `code:level`, значок с уровнем, «Новый уровень»,
  `AchievementProgressBlock`, `components/progress-bar.tsx`; иконка/число — зеркало в `achievement-card.icons.ts` теперь
  через contracts.
- Follow-up issue: `ProgressBar` в `@rkarakulov/ui` (app-foundation).

## 11. Implementation Context

ENTRY POINTS: `GET /v1/achievements` (`AchievementsController.list` → `AchievementsService.sync`), `POST /v1/achievements/seen`,
`GET /v1/riders/:publicId/achievements`, `GET /v1/achievements/:code/story-card` (`AchievementCardService` →
`AchievementCardInputs.resolve`), app `/profile`, `/achievements/flash`, `/achievements/<code>`, `/riders/<id>`.

FILES TO MODIFY / READ / TYPES — разделы 5.1, 6, 7. OUT OF SCOPE — раздел 4, плюс: схема запроса `seen`, миграции,
`story-card.cache.ts`, очередь `story-card`, en-словарь.

Порядок TDD (один PR, коммиты по шагам; `pnpm check` зелёный в конце):

1. **Contracts** — тесты `achievement.schema.test.ts` (7.8) → `ACHIEVEMENT_LEVELS`, `ACHIEVEMENT_LEVEL_TARGETS`,
   `isLeveledCode`, `level`, `AchievementProgress`, `progress`; экспорт `index.ts`; api-client тест совместимости.
2. **Policy** — красные тесты `achievements.policy.test.ts` (пороги, объект, прогресс, `isSeen`, план с уровнями,
   `raceAchievements`) → `LEVELED_FACTS`, правила с рангом, `evaluateAchievements`, `isSeen`, `levelName`, `reconcilePlan`.
3. **Collection/Repository** — поля, проекция `listOf`, `insertGrant(…, seenLevel)`, `restoreOrRefresh` с `level`,
   `markSeen` pipeline (7.4).
4. **Reader/Service** — `AchievementFactsReader.evaluate`; `sync`: уровень и `seen` по уровню ответа, `progress`;
   `publicList` с уровнем. Int-тесты `achievements.int.test.ts` (AC2–AC5, документ v1, ключи, негатив
   монотонности) — сначала красные.
5. **Sharing** — порт `level`; `badgeCount` из contracts; хэш с уровнем; тексты (kicker с меткой, условие с `{count}`);
   `renderVersion` 2 → 3 и мок в `story-card.inputs.test.ts`; unit + int (AC6).
6. **i18n** — ключи 7.7 (новые названия попадут и в карточку сервера).
7. **App каталог/сессия** — тесты `achievement-catalog.test.ts` (`displayLevel`, `badgeCount`, условие, `flashKey`,
   `flashQueue` по уровню) → каталог, `flash-session` по ключу, `setSeen` с `progress` (тест).
8. **App UI** — `AchievementBadge` с `level`, карточка/вспышка (метка, «Новый уровень», a11y), `components/progress-bar.tsx`
   (+ перевод `upload-progress`), `AchievementProgressBlock` + тест, встраивание в `own-profile-screen.tsx`.
9. **Документы** — раздел 10; `pnpm check`.

## 12. Outcome

Реализовано по разделам 7 и 11 (шаги 1–9), RC — как в 8.2.

- **Контракты:** `ACHIEVEMENT_LEVELS`, `ACHIEVEMENT_LEVEL_TARGETS`, `LeveledAchievementCode`, `isLeveledCode`,
  `Achievement.level` / `PublicRiderAchievement.level` (`nullable().default(null)`), `AchievementProgress`,
  `AchievementList.progress` (`default([])`); запрос `seen` не менялся.
- **API:** политика — `LEVELED_FACTS`, правила с рангом, `evaluateAchievements` (прогресс), `levelName`, `isSeen`,
  `storedRank`, `refresh` по рангу; репозиторий — `level`/`seenLevel`, `markSeen` update pipeline (`$max`);
  сервис — `level`, `seen` по уровню ответа (RC-L10), `progress`; публичный список и порт карточки — с уровнем.
  Миграции нет.
- **Карточка сторис:** число на значке и условие — порог уровня, kicker «Достижение · Серебро», уровень в хэше,
  `renderVersion` 2 → 3.
- **Приложение:** каталог (`displayLevel`, `badgeCount`, условие по уровню, `levelLabel`, `isLevelUp`, `flashKey`),
  сессия вспышки по `code:level` (RC-L4), `setSeen` сохраняет `progress` (RC-L3), значок/экран/вспышка с меткой и
  «Новый уровень», блок «Следующие цели», общий `components/progress-bar.tsx`.
- **i18n:** новые названия, условия с `{count}`, `achievements.level.*`, `flash.levelUp`, `a11yLevel`,
  `progress.*`, `achievementCard.kickerLevel`.
- **Документы:** `docs/product/profile.md` (L1–L7, «Где в продукте», Out of Scope), ADR-0020 «Дополнение: уровни»,
  `.claude/rules/pokatim-{contracts,backend,db,security,app}.md`.
- **Тесты:** contracts (уровни, `progress`, v1-ответ), api-client (с полями и без), policy (пороги 4/5…49/50, объект,
  прогресс, `isSeen`, план), int achievements (AC2 целиком, v1-документ, прогресс и ключи, публичный ответ, `POST
  seen` повтор, параллельные GET ×5, негатив монотонности), sharing unit/int (AC6), app (каталог, `flash-session`,
  `setSeen`, карточка, вспышка, блок прогресса, `ProgressBar`, профиль).
- **Follow-up:** `ProgressBar` в `@rkarakulov/ui` (app-foundation).

### Фиксы ревью pass 1 (оркестратор)

- Codex HIGH (§4.12): «Следующие цели» при первой загрузке — заголовок и скелетон строки; ошибка/офлайн без данных —
  блока нет (баннер у «Достижений»). Тест загрузки добавлен.
- Claude LOW-1: обратное окно `seenLevel` записано в ADR-0020; LOW-2: A1 в `profile.md` ссылается на уровни L1.
- Claude LOW-3: follow-up `ProgressBar` в `@rkarakulov/ui` — в Outcome, issue не заводится (вне репозитория).
