# Карточка сторис для сезонных достижений

Уровень: task2/3 (API sharing, контракт запроса, приложение). Follow-up `docs/tasks/2026-10-31-achievements-seasonal`
(S7: «карточка сторис сезонных — не в этом PR»).

## 1. Title

«Поделиться» у сезонных достижений («Чемпион сезона», «Призёр сезона», «Сезон в зачёте») — карточка для сторис.

## 2. Goal

Сезонное достижение — самое ценное; райдер может отправить его в сторис так же, как остальные.

### Решения C1–C5 (автор — сессия follow-up, 2026-10-31)

- **C1 — где.** На экране сезонного достижения и во вспышке — «Поделиться» (как у остальных) рядом с «К сезону».
- **C2 — адрес.** Экран `/achievements/story/<code>?season=<id>`; API — тот же `GET /v1/achievements/:code/story-card`
  с `?seasonId=<uuid>` (обязателен для сезонного кода, запрещён для остальных — 400). Старые сборки сезонных кодов
  не знают — их не затрагивает.
- **C3 — содержимое.** Как у карточки достижения: kicker «Достижение», значок (иконки сезонных кодов — те же, что в
  каталоге приложения), название и условие, объект «Сезон «<название>»», дата факта (последний день сезона), имя —
  по согласию (`RIDER_NAMES`). Без мест, очков и таблицы.
- **C4 — право.** Только своё полученное: сезонная выдача не отозвана и заработана по актуальному `final`-итогу или
  выдана вручную (как список `GET /v1/achievements`); иначе 409 (как сейчас).
- **C5 — кэш.** Сезон входит в хэш входов; `renderVersion` поднимается, только если меняется разметка общих карточек.

## 4. Out of Scope

- Карточка в публичном профиле; OG сезонного достижения.

## 5. Architecture Context (architect, 2026-10-31)

Architecture Review — achievement-season-story-card. **Status: CONCERNS** (блокеров нет; RC-1 меняет правило графа
модулей, RC-2 — осознанное расхождение со списком; рекомендации ниже приняты как дефолт, если человек не решит иначе).

### 5.A Поток (без новых модулей, очередей и коллекций)

`GET /v1/achievements/:code/story-card?template=…&seasonId=…` → `AchievementCardController` (pipe новой query-схемы)
→ `AchievementCardService.status`: **сверка «код ↔ seasonId» до лимита** (400) → `CardRequests.consumeRead` →
`AchievementCardInputs.resolve(userId, ref, template)` → порт `ACHIEVEMENTS_FOR_SHARING.cardFacts(userId, ref)` (`null` —
409 `STORY_CARD_UNAVAILABLE`) → тот же `CardRequests.status` (задача `achievement-card.render`, `jobId`
`achievement-card-<hash>`) → worker `StoryCardProcessor.buildAchievementCard` перечитывает входы с тем же `ref`, сверяет
хэш → `achievementCardTree` (разметка не меняется).

### 5.B Порт `ACHIEVEMENTS_FOR_SHARING` — адрес достижения вместо голого кода

```ts
// achievements-for-sharing.port.ts
/** Адрес карточки: несезонный — код; сезонный — код и сезон (S3: одна выдача на сезон). */
export type AchievementCardRef =
  | { code: FactAchievementCode; seasonId: null }
  | { code: SeasonalAchievementCode; seasonId: string };

export interface AchievementCardFacts {
  code: AchievementCode;                 // было FactAchievementCode
  object: { kind: AchievementObjectKind; id: string; title: string }; // сезон — { kind: 'season', id: seasonId, title }
  factDate: string;                      // сезонное — minskToday(grant.factAt) (последний день сезона)
  level: AchievementLevel | null;        // сезонное — всегда null
}

export interface AchievementsForSharing {
  cardFacts(userId: string, ref: AchievementCardRef): Promise<AchievementCardFacts | null>;
}
```

Хелпер сборки ref (одна функция для HTTP и worker, `achievements/index.ts` или рядом с портом):
`cardRef(code: AchievementCode, seasonId: string | null): AchievementCardRef | null` — `null` при несоответствии
(сезонный без сезона / несезонный с сезоном). Сервис по `null` отвечает 400; worker — `skipped` (не бывает: задачу ставил
тот же сервис).

Реализация `AchievementsSharing.cardFacts`, ветка сезонного (несезонная — без изменений):

1. `repository.listSeasonalOf(userId)` → выдача `code + seasonId`, `revokedAt === null`; нет — `null`.
2. `standings.outcomesOf(userId, [seasonId], clock.now())` (порт `RIDER_SEASON_STANDINGS`, **напрямую**, без мягкого
   `seasonOutcomes` — RC-5) → исход этого сезона; нет (сезон не завершён/удалён) — `null`.
3. Ручная выдача (`override.decision === 'granted'`, как `manuallyGranted` в `achievements.service.ts`) — годна при любом
   статусе исхода. Иначе — только `status === 'final'` **и** `seasonalAchievements([outcome]).earned.has(seasonalKey(ref))`;
   `pending` без ручной — `null` (C4, AC1; RC-2).
4. Ответ: `{ code, object: { kind: 'season', id: seasonId, title: outcome.title }, factDate: minskToday(grant.factAt),
   level: null }` — та же форма и дата, что `seasonalAchievement(...)` списка `GET /v1/achievements`.

Предикат «ручная выдача видима» (`manuallyGranted`) сейчас локален в `achievements.service.ts` — вынести в
`achievements.policy.ts` и импортировать в обоих местах (запрет третьей копии).

### 5.C Хэш, кэш, `renderVersion` (C5)

`achievementCardHash` **не меняется**: канонический массив уже содержит `facts.code`, `facts.object.kind`,
`facts.object.id` (= `seasonId`), `objectTitle` (= название сезона) и `facts.factDate` — два сезона дают разные хэши,
переименование сезона — новый хэш. Явный `seasonId` в массив **не добавлять**: это сменило бы хэши всех существующих
карточек (лишний перерендер). `STORY_CARD_POLICY.renderVersion` остаётся `3`: разметка, токены и строки общих карточек не
меняются; новые глифы и `{count}` «Сезона в зачёте» затрагивают только новые (сезонные) входы. Ключи Redis, TTL, лимиты —
без изменений.

Задача очереди: `AchievementCardJob` += `seasonId: Uuid.nullable().default(null)` (задачи старого API в очереди на момент
выкладки без поля → `null`, несезонные — как раньше). Лог worker — `achievement <code> <template>` без `seasonId`
(как сейчас: код, шаблон, итог).

### 5.D Значок и тексты

- `achievement-card.icons.ts`: `ACHIEVEMENT_BADGE_ICONS` — `satisfies Record<AchievementCode, …>` (было
  `FactAchievementCode`), сезонные — зеркало `ACHIEVEMENT_CATALOG` приложения: `season_regular` → `calendar_month`
  `0xebcc` (`calendar` в `components/icon.tsx`; кодовая точка проверена по `expo-symbols/build/android/symbols.json`),
  `season_podium` → `military_tech` `0xea3f`, `season_champion` → `emoji_events` `0xea23`. `achievementBadgeIcon(code:
  AchievementCode, …)`; `badgeCount` для сезонных — `undefined` (не leveled) — без числа на значке.
- `achievement-card.texts.ts`: kicker «Достижение» (level `null`); объект — уже существующая строка
  `achievements.object.season` («Сезон «…»»); **условие `season_regular` — с `{ count: SEASON_REGULAR_MIN_RACES }`**
  из контрактов (как `achievementCondition` приложения), иначе на картинке будет сырой `{count}` (RC-3). Мест, очков,
  таблицы нет — порт их и не отдаёт.
- `AchievementCardInputs.publicTitle`: `season` идёт веткой «не маршрут» — название из фактов (сезоны публичны).

### 5.E Граф модулей (RC-1)

`AchievementsReadModule` += `StandingsCoreModule` (порт `RIDER_SEASON_STANDINGS` для `cardFacts`). Циклов нет:
`StandingsCoreModule` → `RacesCoreModule`, `ResultsCoreModule` (оба уже у `sharing`), о `achievements`/`sharing` не знает;
очередей и процессоров в нём нет (они в `StandingsWorkerModule`), Nest-модули — синглтоны, лишних экземпляров нет.
`sharing` по-прежнему импортирует только `AchievementsReadModule` и `standings` напрямую не получает. Правило
`pokatim-backend.md` («`AchievementsReadModule` и `sharing` его не получают») — переписать.

### 5.F Приложение

- Каталог: `SEASON.storyCard: true` (C1). Старые сборки сезонных кнопок не показывают (`storyCard: false` у них) — без
  изменений для них.
- `features/achievements/story/achievement-story.ts`: `achievementStoryPath(code, seasonId: string | null)` →
  `/achievements/story/<code>` | `…?season=<encodeURIComponent(id)>`; `achievementStoryKey(code, seasonId, template)` →
  `['achievements','story',code,seasonId,template]` (сезон в ключе — иначе карточки двух сезонов делят кэш);
  `achievementStorySource(code, seasonId)` → `api.getAchievementCard(token, code, seasonId ? { template, seasonId } :
  { template })`. Дубль `achievementPath` в этом файле удалить — «К достижению» через `achievementPath(code, seasonId)`
  каталога (RC-9).
- `app/achievements/story/[code].tsx`: читает `season` (как `[code].tsx`) → `AchievementStoryScreen code season`.
- `AchievementStoryScreen`: сезонный код — нужен валидный `Uuid.safeParse(season)`, иначе «Карточки нет» без запроса;
  несезонный — `season` игнорируется (запрос без `seasonId`, RC-8); заголовок превью/шеринга — название кода (как
  сейчас); `DetailHeader.fallback` и «К достижению» — `achievementPath(code, seasonId)`.
- `achievement-screen.tsx` / `achievement-flash-screen.tsx`: «Поделиться» → `achievementStoryPath(item.code,
  seasonOf(item))`; порядок кнопок — «Поделиться», затем «К сезону» (C1).

## 5.1 Placement & Reuse Gate

| Что | Где | Reuse / запрет дублей |
|---|---|---|
| Query-схема | `packages/contracts/src/sharing/story-card.schema.ts` — `AchievementStoryCardQuery` | `StoryCardTemplate`, `Uuid` (`contracts-core`); общий `StoryCardQuery` **не расширять** (он у гонки/райда/маршрута — `seasonId` там стал бы допустимым) |
| Сверка код ↔ сезон | `achievements` (`cardRef`, рядом с портом) | `isSeasonalCode` контрактов; ошибка — образец `fieldFailure` (`rides.service.ts`): `VALIDATION_FAILED` + `fields` |
| Право на карточку | `AchievementsSharing.cardFacts` | `listSeasonalOf`, `RIDER_SEASON_STANDINGS.outcomesOf`, `seasonalAchievements`, `seasonalKey`, `manuallyGranted` (вынести в policy) — без второго расчёта мест |
| Хэш/кэш/очередь | `sharing` | `achievementCardHash`, `CardRequests`, `StoryCardCache`, `achievement-card.render` — без изменений, кроме `seasonId` в задаче |
| Значок | `achievement-card.icons.ts` | зеркало `ACHIEVEMENT_CATALOG`; шрифт `symbolsFont` уже содержит глифы |
| Тексты | `achievement-card.texts.ts` | строки `achievements.*` i18n (новых строк нет), `SEASON_REGULAR_MIN_RACES` |
| api-client | `getAchievementCard(token, code, query: AchievementStoryCardQuery)` | `queryString` |
| Приложение | `features/achievements/story/*`, каталог | `achievementPath`/`seasonOf` каталога, `CardPanel`, `card-status` |

Нового пакета, коллекции, миграции, очереди, события нет. Кандидатов в app-foundation нет.

## 6. Relevant Files

API: `apps/api/src/modules/achievements/{achievements-for-sharing.port.ts, achievements-for-sharing.ts,
achievements.policy.ts, achievements.service.ts (manuallyGranted → policy), achievements.module.ts, index.ts}`,
`apps/api/src/modules/sharing/{achievement-card.controller.ts, achievement-card.service.ts, achievement-card.inputs.ts,
achievement-card.icons.ts, achievement-card.texts.ts, story-card.cache.ts (AchievementCardJob), story-card.processor.ts
(buildAchievementCard)}`; тесты — `achievement-card.int.test.ts`, `achievement-card.render.test.ts`,
`story-card.processor.test.ts`.
Контракты/клиент: `packages/contracts/src/sharing/story-card.schema.ts` (+ `.test.ts`), `packages/api-client/src/index.ts`
(`getAchievementCard`), `packages/api-client/src/sharing.test.ts`.
Приложение: `apps/app/src/features/achievements/{achievement-catalog.ts, achievement-catalog.test.ts, achievement-screen.tsx,
achievement-flash-screen.tsx, story/achievement-story.ts, story/achievement-story-screen.tsx}`,
`apps/app/src/app/achievements/story/[code].tsx`, `apps/app/e2e/web.spec.ts` (список «без сессии»).
Читать (не менять): `achievements-reconciler.ts` (`seasonOutcomes`), `standings/rider-season-standings.port.ts`,
`achievements-panel.service.ts` (factAt ручной сезонной), `features/sharing/card-status.ts`, `card-panel.tsx`.

## 7. Implementation Notes

### 7.1 Контракты (обратная совместимость)

```ts
/** `GET /v1/achievements/:code/story-card` — query: `seasonId` обязателен у сезонного кода и запрещён у остальных
 *  (сверка с кодом пути — сервер, 400 `VALIDATION_FAILED`); лишние ключи — 400. Старые сборки шлют только `template`. */
export const AchievementStoryCardQuery = z.strictObject({
  template: StoryCardTemplate,
  seasonId: Uuid.optional(),
});
export type AchievementStoryCardQuery = z.infer<typeof AchievementStoryCardQuery>;
```

Ответ (`StoryCardStatus`) и коды ошибок не меняются. Старые сборки: несезонные запросы валидны как раньше; сезонных
запросов у них нет. Новая сборка web + старый API (окно выкладки) — сезонный запрос получит 400 (strict) → экран
«Не удалось загрузить» с повтором; dev выкатывает API и web вместе, мобильные сборки — позже (RC-11).

### 7.2 Ошибки 400 (C2)

`seasonId` невалидный UUID — pipe (`fields: [{ path: 'seasonId', code: 'INVALID' }]`). Сезонный код без `seasonId` —
`fields: [{ path: 'seasonId', code: 'REQUIRED' }]`; несезонный с `seasonId` — `fields: [{ path: 'seasonId', code:
'INVALID' }]`. Проверка — до `consumeRead` (как валидация pipe, лимит не тратится). Валидный, но незнакомый/чужой
`seasonId` — 409 (выдачи нет), без различия «нет сезона / не ваш» (без утечки).

### 7.3 Данные, очереди, события

Миграций, индексов, коллекций нет: читаются `achievement_season_grants` (`listSeasonalOf` по `userId` — существующий
уникальный индекс `(userId, code, seasonId)`) и снимок через порт. Очередь `story-card` и задача `achievement-card.render`
— те же; идемпотентность — `jobId achievement-card-<hash>` + `pending:<hash>` NX; ретраи и финальный провал
(`failed:<hash>`, «сообщается один раз») — как у остальных. Outbox не нужен.

### 7.4 Security checklist (зона «Карточки для сторис», `pokatim-security.md`) — нужен: да

- [ ] `AuthGuard`, `userId` только из access; в пути код, в query сезон — выдача ищется по `(userId, code, seasonId)`:
      чужое недостижимо; чужой/несуществующий сезон — тот же 409, что «не получено».
- [ ] Право — только сервер (`cardFacts`): не отозвана; авто — по `final`-исходу; ручная — по документу; `pending` без
      ручной — 409. Клиентский флаг `storyCard` права не даёт.
- [ ] На картинке: каталог, «Сезон «<название>»» (публичные данные), дата последнего дня сезона, имя — только
      `RIDER_NAMES`; без мест, очков, таблицы, id сезона и выдачи.
- [ ] `strictObject` query: лишние ключи — 400; `seasonId` — `Uuid`.
- [ ] Ответ — только `StoryCardStatus`; `no-store`.
- [ ] Логи HTTP/worker — код, шаблон, итог; без `userId`, `seasonId`, названия, токена; причина провала — только тип.
- [ ] Лимиты — общие `story-card-read`/`story-card-render`/IP `story-card-image`; PNG ≤ 2 МБ, токен — как раньше.
- [ ] Сбой порта сезонов — не 409 (не маскировать под «нет права»), а ошибка/ретрай (RC-5).

### 7.5 Test matrix

| Уровень | Что |
|---|---|
| unit contracts (`story-card.schema.test.ts`) | `AchievementStoryCardQuery`: `{template}`, `{template, seasonId}` валидны; кривой UUID, лишний ключ, без шаблона — нет; `StoryCardQuery` по-прежнему отвергает `seasonId` |
| unit achievements (policy/port) | `cardRef`: сезонный+сезон, несезонный без — ref; два несоответствия — `null`; `manuallyGranted` вынесен без изменения поведения (существующие тесты зелёные) |
| unit sharing (`achievement-card.render.test.ts`) | `ACHIEVEMENT_BADGE_ICONS` полна по `ACHIEVEMENT_CODES` (снять `continue` для сезонных в тесте глифов — все глифы рисуются шрифтом); тексты сезонного: kicker «Достижение», `season_regular` — «… 3 …» без `{count}`, объект «Сезон «…»», дата; на дереве — без id сезона; хэш различает два сезона и переименование сезона; хэш несезонного входа **равен** значению до правки (фиксированный ожидаемый hex или снимок — сторож RC-7) |
| unit worker (`story-card.processor.test.ts`) | `AchievementCardJob` без `seasonId` парсится в `null`; сезонная задача передаёт ref в `resolve` |
| int API (реальная Mongo/Redis, `achievement-card.int.test.ts`) | сезонный `final` своё → pending → ready → PNG; повтор — тот же токен; другой сезон — другая задача/токен; без `seasonId` у сезонного — 400 `REQUIRED`; `seasonId` у `race_win` — 400; кривой UUID — 400; лимит при 400 не тратится; чужой сезон (выдача у другого) — 409; не полученное — 409; отозванное сверкой — 409; ручной отзыв — 409; ручная выдача (в т. ч. при `pending`) — карточка; авто + сезон стал `pending` (протокол без пересчёта) — 409; worker: выдачу отозвали между постановкой и рендером — `skipped`; сбой порта сезонов — не 409 |
| unit api-client (`sharing.test.ts`) | URL с `?template=night&seasonId=<uuid>`; без сезона — как раньше |
| unit app (`achievement-catalog.test.ts`, новый `story/achievement-story.test.ts`) | сезонные `storyCard: true`; `achievementStoryPath` с/без сезона (encode); ключ содержит сезон; источник шлёт `seasonId` только для сезонного |
| e2e web (`web.spec.ts`) | `/achievements/story/season_champion?season=<uuid>` без сессии — гард входа, HTML без данных |

## 8.1 Requirements Consistency (architect)

- **RC-1 (конфликт с правилом графа модулей).** `pokatim-backend.md`: «`AchievementsReadModule` и `sharing` его
  [`StandingsCoreModule`] не получают» — а `cardFacts` (в `AchievementsReadModule`) без порта сезонов не проверит C4 и не
  возьмёт название. Варианты: (A) `AchievementsReadModule` += `StandingsCoreModule`; (B) отдельный тонкий модуль
  `RiderSeasonStandingsModule` только с портом; (C) перенести реализацию порта в `AchievementsSyncModule` и импортировать
  его в `sharing`. **Рекомендация — A**: циклов нет, тяжёлых провайдеров (очередей) в ядре нет, B — лишняя сущность,
  C тянет в `sharing` сверку и outbox. Правило переписать в этом PR.
- **RC-2 (C4 строже списка).** Список `GET /v1/achievements` показывает авто-выдачу в сезоне `pending` (не мерцает), а
  C4/AC1 требуют 409 — в окне «ревизия протокола → пересчёт снимка» кнопка «Поделиться» видна, а экран карточки
  скажет «Карточки нет». Варианты: (A) принять (окно — минуты до пересчёта; картинка уходит наружу — не делиться
  возможно устаревшим местом); (B) разрешить `pending` как список (последовательно, но рискует опубликовать
  отзываемое); (C) отдавать в `Achievement` флаг «можно поделиться» (контракт, старые сборки — лишнее поле). **Рекомендация
  — A** (решение C4 оставить, отметить в `profile.md`).
- **RC-3 (ловушка текста).** Серверный `achievementCardTexts` подставляет `{count}` только счётным; у `season_regular`
  условие с `{count}` — без правки на картинке будет «{count}». Передавать `SEASON_REGULAR_MIN_RACES`; смена константы —
  подъём `renderVersion` (комментарий у константы в `sharing.policy.ts`/icons).
- **RC-4 (недоопределено: форма 400).** C2 говорит «400», не уточняя код. Рекомендация — `VALIDATION_FAILED` с
  `fields: [{ path: 'seasonId', code: 'REQUIRED' | 'INVALID' }]` (образец `rides.service.ts`), без нового кода ошибки.
- **RC-5 (недоопределено: сбой порта сезонов).** Список глотает сбой (`seasonOutcomes` → `[]`), но для карточки это дало
  бы 409 «Карточки нет» — ложный ответ о праве. Рекомендация — звать порт напрямую: HTTP — 500 (приложение: «Не удалось
  загрузить» с повтором), worker — ретрай задачи.
- **RC-6 (нагрузка).** `outcomesOf` (снимок + `StandingsSource.load` для отпечатка) зовётся на каждый опрос статуса
  (≤ 30 за 30 с) и в worker. Принять для v1: ограничено `story-card-read` 120/мин и опросом ≤ 30 с; если станет заметно —
  отдельный узкий метод порта на один сезон (follow-up, не в этом PR).
- **RC-7 (C5 уже выполнено хэшем).** `object.id` (= `seasonId`) и название сезона уже в каноне `achievementCardHash`;
  явный `seasonId` и подъём `renderVersion` не нужны и вредны (перерендер всех карточек). Сторож — тест неизменности хэша
  несезонного входа.
- **RC-8 (недоопределено: `?season` у несезонного в приложении).** Рекомендация — игнорировать (ссылки устойчивы, API
  не получит запрещённый параметр); сезонный без/с кривым `season` — «Карточки нет» без запроса.
- **RC-9 (дубль).** `achievementPath` есть и в `story/achievement-story.ts` (без сезона), и в каталоге (с сезоном) —
  оставить только каталожный.
- **RC-10 (дата факта).** Брать `grant.factAt` (как список): у авто и ручной (`endsBefore − 1 мс`, панель) — последний
  день сезона по Минску; не пересчитывать из `outcome.endsBefore`.
- **RC-11 (порядок выкладки).** Новый web + старый API → сезонная карточка 400 до выкладки API; на dev выкатываются
  вместе — принять.

## 8.2 Отклонения при реализации (coder)

- **D1 — `cardRef` в файле порта.** `cardRef` и `AchievementCardRef` — в `achievements-for-sharing.port.ts` (экспорт
  через `index.ts`), тест — `achievements-for-sharing.port.test.ts`; в `achievements.policy.ts` — только
  `manuallyGranted` (тип порта импортирует `FactAchievementCode` из политики — обратного импорта нет).
- **D2 — превью карточек.** `scripts/story-card-preview.ts` падал на `achievements.level.undefined`: у прежних кейсов
  достижения не было `level` (скрипт вне `tsc`). Добавлены `level` и три сезонных кейса.
- **D3 — `FactAchievementCode` из `index.ts` убран.** Единственный внешний потребитель (`achievement-card.icons.ts`)
  перешёл на `AchievementCode`.

## 9. Acceptance Criteria

- AC1. API: сезонный код + свой полученный сезон → карточка (статус/токен как у остальных); без `seasonId` или с
  `seasonId` у несезонного — 400; чужой/неполученный/отозванный/`pending` без ручной выдачи — 409; ручная сезонная —
  карточка.
- AC2. Рендер: название сезона и дата на картинке; иконки трёх сезонных кодов; хэш различает сезоны.
- AC3. Приложение: «Поделиться» у сезонного на экране и во вспышке → `/achievements/story/<code>?season=<id>`;
  экран карточки работает с `?season`; прежние несезонные — без изменений.
- AC4. `pnpm check` зелёный; документы — `profile.md` (S7 → C1–C5), ADR-0018 (если затронут), `.claude/rules`.

## 10. Documentation Impact

- `docs/product/profile.md`: S7 — «Поделиться» у сезонных есть (ссылка на C1–C5 этой задачи); RC-2 (в `pending` без
  ручной — «Карточки нет»).
- `docs/adr/0018-story-cards.md`: дополнение к «карточка достижения» — `seasonId` (обязателен/запрещён, 400), право по C4,
  хэш без изменений (RC-7), `renderVersion` не поднят.
- `docs/adr/0020-achievements-reconcile-on-read.md` («Дополнение: сезонные»): карточка у сезонных есть; `cardFacts` —
  порт сезонов напрямую.
- `.claude/rules/pokatim-backend.md`: граф модулей (`AchievementsReadModule` += `StandingsCoreModule`, RC-1); «Сезонные …
  Карточка: сезонный код → `cardFacts` `null`» → новое правило; «Карточка достижения» — `AchievementCardRef`,
  `seasonId` в задаче, иконки `Record<AchievementCode, …>`.
- `.claude/rules/pokatim-security.md` («Карточка достижения»): сезонный код — по `(userId, code, seasonId)`, `pending`
  без ручной — 409, логи без `seasonId`.
- `.claude/rules/pokatim-contracts.md`: `AchievementStoryCardQuery` рядом с `StoryCardQuery`.
- `.claude/rules/pokatim-app.md`: ключ `['achievements','story',code,seasonId,template]`, `?season`, сезонные
  `storyCard: true`.

## 11. Implementation Context

- **ENTRY POINTS:** `AchievementCardController.status`, `StoryCardProcessor.buildAchievementCard`,
  `AchievementStoryScreen`, кнопки «Поделиться» в `achievement-screen.tsx` / `achievement-flash-screen.tsx`.
- **FILES TO MODIFY:** см. §6.
- **FILES TO READ:** `achievements.service.ts` (`visibleSeasonal`, `seasonalAchievement`, `manuallyGranted`),
  `achievements.policy.ts` (`seasonalAchievements`, `seasonalKey`), `rider-season-standings.port.ts`,
  `features/sharing/card-status.ts`, `rides.service.ts` (`fieldFailure`).
- **TYPES & SCHEMAS:** `AchievementStoryCardQuery`, `AchievementCardRef`, `AchievementCardFacts.code: AchievementCode`,
  `AchievementCardJob.seasonId`, `ACHIEVEMENT_BADGE_ICONS: Record<AchievementCode, …>`.
- **TESTS:** §7.5.
- **OUT OF SCOPE:** публичная карточка/OG сезонного достижения; новый метод порта сезонов (RC-6); изменения разметки
  карточки и `renderVersion`.

Порядок TDD (один PR):

1. Контракты: тест `AchievementStoryCardQuery` → схема; api-client тест URL → `getAchievementCard(query)`.
2. `achievements`: тесты `cardRef` и вынесенного `manuallyGranted` → реализация; int-тесты `cardFacts`-веток через HTTP
   (п. 4) пишутся красными сразу после.
3. `sharing` unit: тест полноты иконок/глифов, текстов сезонного (`{count}`), хэша (различие сезонов + неизменность
   несезонного) → icons, texts, inputs (`resolve(userId, ref, template)`).
4. Порт + модуль: `AchievementsReadModule` += `StandingsCoreModule`; `cardFacts` сезонная ветка → зелёные int
   (`final`, ручная, `pending`, отзыв, чужой сезон, сбой порта).
5. Сервис/контроллер: 400-проверки до лимита; `AchievementCardJob.seasonId` + процессор → int «pending → ready», worker
   `skipped`.
6. Приложение: тесты `achievement-story.ts` и каталога → пути/ключ/источник, экран карточки (`season`), кнопки экрана и
   вспышки; e2e-адрес в `web.spec.ts`.
7. Документы и правила (§10); `pnpm check`; превью `pnpm --filter @pokatim/api preview:story-cards` — глянуть три
   сезонных значка в обоих шаблонах.

## 12. Outcome

Реализовано одним PR (2026-10-31):

- **Контракты / api-client:** `AchievementStoryCardQuery` (`template` + `seasonId?: Uuid`, `strictObject`);
  `getAchievementCard(token, code, AchievementStoryCardQuery)`. `StoryCardQuery` не тронут.
- **achievements:** `AchievementCardRef` + `cardRef` (порт), `cardFacts(userId, ref)` с сезонной веткой (выдача
  `listSeasonalOf`, исход — `RIDER_SEASON_STANDINGS.outcomesOf` напрямую; ручная — при любом исходе, иначе `final` и
  заработано), `manuallyGranted` → `achievements.policy.ts`; `AchievementsReadModule` += `StandingsCoreModule` (RC-1).
- **sharing:** 400 `seasonId:REQUIRED|INVALID` до `consumeRead`; `AchievementCardInputs.resolve(userId, ref, template)`;
  `AchievementCardJob.seasonId` (`Uuid.nullable().default(null)`), worker — тот же `cardRef`; иконки
  `Record<AchievementCode, …>` (+3 сезонных глифа); условие «Сезона в зачёте» с `SEASON_REGULAR_MIN_RACES`. Хэш и
  `renderVersion` (3) без изменений — сторож: фиксированный hex несезонного входа.
- **Приложение:** сезонные `storyCard: true`; «Поделиться» на экране и во вспышке → `achievementStoryPath(code,
  seasonOf(item))`; ключ `['achievements','story',code,seasonId,template]`; экран карточки читает `?season`; дубль
  `achievementPath` удалён (RC-9); e2e-адрес с `?season`.
- **Документы:** `profile.md` (S7, RC-2), ADR-0018, ADR-0020, `.claude/rules/pokatim-{backend,security,contracts,app}.md`.
- **Проверки:** `pnpm check` — format, lint, arch, typecheck зелёные; тесты: первый прогон упал на
  `document-title.web.test.tsx` (вне зоны, тайминг 16 с), отдельно — зелёный; повторный `pnpm test` — 15/15 задач,
  api 225 файлов / 2552 теста, app 267 наборов / 2559 тестов. Превью — три сезонных значка в обоих шаблонах.
- Отклонения — 8.2 (D1–D3). e2e web локально не запускался.
