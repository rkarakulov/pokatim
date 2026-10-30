# 1. Title

Свои OG-картинки профиля райдера и таблицы сезона + тёмный вариант шаблона OG (следующий слайс og-images, ADR-0018).

# 2. Goal

Ссылка на сезон (`/seasons/<id>`) и профиль райдера (`/riders/<publicId>`) в мессенджере разворачивается в превью со
своей картинкой 1200×630, а не с общей бренд-картинкой. У шаблона OG появляется тёмная схема («Ночь»): соревновательные
виды (гонка, сезон, райдер) рисуются тёмными, остальные — светлыми («Линия»), схема вида задаётся одной таблицей.

Источники: `docs/tasks/2026-10-29-og-images/task.md` (§4 Out of Scope: «своя картинка профиля и сезона», «тёмный
шаблон OG»), ADR-0018 (дополнение og-images), `docs/tasks/2026-10-28-rider-profile` (D-B2: имя, клуб и фото не попадают
в мету), PR #131 (`useShareImage`). Код сверен по `origin/develop` @ `167f4d7f`.

# 3. Scope

Уровень **task3** (контракт видов OG, новые порты `races`/`riders`, `og.sync`, SSR двух страниц). Один PR в `develop`.
Story-карточка маршрута — следующий PR (отдельный task.md).

## 3.1 Решения (автономный режим, [ASSUMPTION] — поправимы одной строкой)

- **S1. Новые виды** `season` и `rider` — в конец `OG_CARD_KINDS` (`race, ride, route, calendar, season, rider`).
  `id`: `season` — `Uuid`; `rider` — `RiderPublicId` (не Uuid). `OgCardParams` — проверка `id` по виду; `images`
  контроллер — так же (сейчас `idPipe = Uuid`).
- **S2. Сезон.** Метка «Сезон», название, факты: даты сезона (Минск, с годом, `localRange`) и «N гонок» (только
  опубликованные гонки сезона; 0 — строки нет). Без лидеров и имён. Картинка есть у любого
  сезона, который отдаёт `GET /v1/seasons/:id` (все сезоны публичны); неизвестный — `404`. Без линии (текст во всю
  ширину). Пререндер `og.sync` — да (сезонов десятки): порт `races` `seasonOgFacts(id)` и `seasonOgChanged(after,
  limit)` по `(updatedAt, _id)`; «живой» — `endsOn ≥ сегодня − 30 д` (Минск), прочие — самолечением.
- **S3. Райдер (приватность, D-B2).** На картинке **нет** имени, клуба, фото и `publicId`: метка «Райдер», заголовок
  «Профиль райдера» (`riders.title`), факты — публичная статистика профиля: «N гонок · M подиумов», «Лучшее место: K»
  (нет — строки нет; 0 гонок — «Пока без гонок»). Картинка есть, только пока профиль публичен (имя + согласие —
  `ProfilesForRiders.findPublic`); иначе `404` (как страница). Без пререндера: в `og.sync` не участвует (статистика
  меняется публикацией протоколов, `updatedAt` профиля её не отражает) — рендер самолечением при первом запросе
  (SSR/`useShareImage`); TTL — `pngShortTtlSec`. Хэш — вид, версия, тема, схема, `publicId`, статистика.
- **S4. Тёмная схема.** `OG_CARD_POLICY.scheme: Record<OgCardKindOrBrand, 'light' | 'dark'>` = `race, season, rider` —
  `dark`; `ride, route, calendar, brand` — `light`. Цвета — `storyCardColors(theme.schemes[scheme])` (как `night` у
  сторис); схема входит в хэш. Токены `ogCard` (размеры) общие; если на тёмной плитке линии нужен свой цвет — из
  `storyCardColors` схемы, без новых литералов. `renderVersion` → 3 (все хэши меняются, `og.sync` — полный проход).
- **S5. SSR (app).** `/seasons/[id]` и `/riders/[id]` — `pageOgImage`-аналог для своих видов: страница найдена и
  версия есть — своя картинка; иначе — бренд (как сейчас); «не найдено» — без картинки. Alt: «Сезон «{name}»»,
  райдер — «Профиль райдера — Покатим» (без имени). У райдера по-прежнему без `og:url`, `noindex`, без ПДн в тексте.
- **S6. «Поделиться»** на экранах сезона/профиля, если кнопка есть, — `useShareImage(kind, id)` (PR #131). Нет кнопки
  — не добавляем (вне scope).

- **Выбор по RC-1…RC-3 (§5, 2026-10-30): все — вариант (a).** RC-1: `publicId` — только в URL `og:image` райдера
  (мету видит лишь открывший страницу по тому же `publicId`; после отзыва согласия — `404`), тест «мета без
  `publicId`» переписать на «без имени/клуба/фото, `publicId` только в URL картинки». RC-2: сезон — без курсора, каждый
  прогон `og.sync` смотрит все живые сезоны (`liveSeasonIds`). RC-3: «N гонок» райдера — по `finishes`.
- **Правила `.claude/rules/*` не трогаем** (нужно OK пользователя) — правки `pokatim-backend.md`/`pokatim-security.md`
  из §10 — follow-up в `pr.md`.

## 3.2 Слои

- `packages/contracts`: `OG_CARD_KINDS` + `season`, `rider`; `OgCardParams` с id по виду.
- `packages/i18n`: `ogCard.kicker.{season,rider}`, `ogCard.alt.{season,rider}`, строки фактов.
- `apps/api`: порты `races` (сезон) и `riders` (публичная статистика, новый `RIDERS_FOR_SHARING`); `OgCardInputs`
  (+ виды, хэш со схемой), `og-card.texts`, `og-card.png` (схема), `OgCardController` (id по виду), `og-sync`
  (+ `season`), `ogPrerenderable` (+ season, rider=false), `OG_CARD_POLICY.scheme`, `renderVersion`;
  `scripts/story-card-preview.ts` — превью новых видов и тёмной схемы.
- `apps/app`: `lib/og-image.ts`, `app/seasons/[id].tsx`, `app/riders/[id].tsx`; `api-client` `getOgCard` — виды.
- `docs/product/`: `races-and-seasons.md`, `profile.md` (OG), ADR-0018 — дополнение.

# 4. Out of Scope

Story-карточка маршрута (следующий PR), имя/фото райдера на OG, лидеры сезона на OG, CDN, локализация кроме ru,
изменение сторис/приглашения/достижения и их `renderVersion`, новые кнопки «Поделиться».

# 5. Architecture Context

## Architecture Review — og-rider-season-dark (architect, 2026-10-30, код @ `167f4d7f`)

Status: **CONCERNS** (блокеров нет; три правки решений — RC-1…RC-3 ниже, рекомендованы варианты (a); RC-1 трогает
инвариант D-B2 — оркестратор фиксирует выбор в §3.1 до запуска coder).

- Сверено кодом: `OG_CARD_POLICY.renderVersion` сейчас **2** (не 1) → 3 — верно. Тема OG — `OG_THEME_ID =
  DEFAULT_APP_THEME_ID` («Классика», не `APP_APPEARANCE`); схема `dark` есть у всех тем (`AppThemeDef.schemes`).
  Образец выбора схемы уже есть: `ride-invite.png.ts`/`achievement-card.png.ts` (`theme.schemes.light|dark`).
- `ProfilesForRiders` в коде нет: порт профиля — `RIDER_PROFILES` / `RiderProfileDirectory.findPublic(publicId)`
  (`profile/rider-profiles.port.ts`), сводка — `riders.policy.summarize(rows, finishes)`.
- Кнопок «Поделиться» на `features/riders/*` и `features/races/season-detail.tsx` нет → S6 в этом PR — no-op.

## 5.1 Placement & Reuse Gate

### Placement

| Что | Где | Слой |
|---|---|---|
| id по виду, виды | `packages/contracts/src/sharing/og-card.schema.ts` | контракт (общий для api и app) |
| факты сезона | `apps/api/src/modules/races` — расширение порта `RACES_FOR_SHARING` (сезоны — коллекция `races`-модуля) | port + repository |
| факты райдера | `apps/api/src/modules/riders` — **новый** `RidersCoreModule` + порт `RIDERS_FOR_SHARING` | port (композиция `RIDER_PROFILES` + `RIDER_RESULTS` + `summarize`) |
| виды, схема, хэш, рендер, `og.sync` | `apps/api/src/modules/sharing/*` | inputs / texts / png / service / controller / job |
| SSR | `apps/app/src/lib/og-image.ts`, `app/{seasons,riders}/[id].tsx` | web SSR |

Новых пакетов нет (потребитель таблицы id по виду — api и app, но это контракт → `@pokatim/contracts`). Кандидатов в
базу app-foundation нет (OG — доменный код проекта).

**Направление зависимостей (проверено `.dependency-cruiser.cjs`):** правила — `no-circular` (учитывает и type-only
импорты: `tsPreCompilationDeps: true`) и `api-module-public-api-only` (только `modules/<m>/index.ts`). Новое ребро
`sharing → riders`: `riders → profile, results, tracks, identity`; ни один из них не импортирует `sharing`/`riders` →
цикла нет. Правило проекта «`riders` не импортирует никто, кроме `AppModule`» (`pokatim-backend.md` §Профиль райдера,
комментарий `RidersModule`) — **меняется**: + `sharing` через `RidersCoreModule` (как `achievements` →
`AchievementsReadModule`). Альтернатива «`sharing` сам зовёт `RIDER_PROFILES` + `RIDER_RESULTS`» — **запрещена**:
второй расчёт сводки (дубль `summarize`, расхождение со страницей).

Внутри `sharing`: `sharing.policy.ts` **не должен** импортировать `og-card.inputs.ts` (тот импортирует policy →
`no-circular` по type-import). Тип ключа таблицы схем — `OgCardKind | typeof OG_BRAND.kind` из контрактов; тип
`OgCardKindOrBrand` перенести в `sharing.policy.ts` (inputs — реэкспорт/импорт оттуда).

### Reuse points / запрещённые дубли

- Сводка райдера — только `summarize` (`riders.policy.ts`); строки — `RIDER_RESULTS.publishedRows/publishedFinishes`.
- Публичность профиля — только `RIDER_PROFILES.findPublic` (условие в фильтре порта); копий условия нет.
- Сезон — `RacesRepository.findSeason`; число гонок — новый `countPublishedInSeason(seasonId)` рядом с
  `countSeasonRaces` (индекс `races_season_idx` `{ seasonId, windowEndsAt }` покрывает префикс; миграций нет).
- Даты — `localRange` (`og-card.texts.ts`), склейка — `join`, множественное число — plural-объекты `@pokatim/i18n`
  (как `standings.*` с `few/many`); `riders.title` — существующий ключ.
- Цвета — `storyCardColors(theme.schemes[scheme])`; новых литералов/токенов цвета нет.
- Постановка/кэш/выдача — `OgCardQueue`, `OgCardCache`, `OgCardService.serve` без изменений логики.
- App — `publicPath(prefix, id, '', schema)` уже принимает схему id; схема id по виду — из контракта (одна таблица).

### Contracts & compatibility

- `OG_CARD_KINDS = ['race','ride','route','calendar','season','rider']` (в конец). Новое:
  `export const OG_CARD_ID = { race: Uuid, ride: Uuid, route: Uuid, calendar: Uuid, season: Uuid, rider: RiderPublicId }
  as const satisfies Record<OgCardKind, z.ZodType<string>>` (импорт `RiderPublicId` из `../profile/rider-avatar.schema.ts`
  — внутри пакета, deep-import правило не задевает).
- `OgCardParams = z.strictObject({ kind: OgCardKind, id: z.string() }).superRefine(({ kind, id }, ctx) => …
  OG_CARD_ID[kind].safeParse(id) … addIssue({ path: ['id'], code: 'custom', message: 'INVALID' }))` — тип остаётся
  `{ kind; id: string }` (контроллер/сервис без правок типов). `discriminatedUnion` — допустимая альтернатива, но
  меняет вывод типа и ошибку неизвестного вида; формат issue для `FieldErrorCode` — сверить через context7 (zod 4).
- Новый `OgImageParams` — то же + `file: OgImageFile` (для `images/:kind/:id/:file` одним pipe).
- `api-client.getOgCard/ogImageUrl` — тип `OgCardKind` расширяется сам, правок кода нет. Старые версии приложения
  новых видов не запрашивают — совместимо. `OgCardMeta`/`OgImageFile` не меняются.

### Data & migrations

Миграций и новых индексов нет. Сезонов — десятки (полный просмотр `seasons` без индекса допустим; `migrations.int.test`
фиксирует индексы `seasons` — новый индекс сломал бы его без нужды). Redis: новые ключи только по существующим шаблонам
(`og:png|pending|obj:<kind>:<id>`); `og:obj:rider:<publicId>` — содержит `publicId` (как путь страницы), TTL 7 сут.

### Jobs & events

- Очереди прежние (`story-card` — `og-card.render`; `og-sync` — `sync`). `OgCardJob.kind` расширяется сам
  (`z.enum([...OG_CARD_KINDS,'brand'])`). Идемпотентность — NX по хэшу + `jobId og-card-<hash>` (без изменений).
- `og.sync`: **season — без курсора, полный просмотр живых сезонов каждый прогон** (RC-2); rider — не участвует.
  Финальный провал рендера — `holdFailed` (как есть), видно — бренд-PNG `no-store`. Outbox не нужен (DV-1).

### Security (checklist нужен: **да**)

Зона `pokatim-security.md` (публичные ручки без входа, ПДн профиля, Redis/логи). Чек-лист coder в §8.3 по образцу
og-images + пункты: (1) факты райдера — тип `RiderOgFacts` без имени/клуба/фото/`userId` (структурная гарантия);
(2) 404 до чтения PNG при непубличном профиле (`OgCardService.image` уже так); один 404 для «нет согласия» и
«неизвестный» (оракул не шире `GET /v1/riders/:publicId`; `publicId` — 256 бит, перебор неосуществим, хотя бакет
`og-card` — отдельный); (3) **логи без `publicId`**: `StoryCardProcessor.buildOgCard` `label()` и
`OgCardService.enqueue` warn пишут `og ${kind} ${id}` — для `rider` писать `og rider <hash.slice(0,8)>` (как правило
achievements/profile-moderation «без `publicId`»); `og.sync` райдеров не видит; (4) мета райдера — RC-1.

### Requirements Consistency

- **RC-1 [CONCERN, D-B2] `publicId` попадает в мету `/riders/<id>` через `og:image`.** Сейчас мета райдера не содержит
  `publicId` вовсе — это держит тест `public-metadata.test.ts` (`expect(text).not.toContain(PUBLIC_ID)`), а S5/AC5
  требуют `og:image = …/og/images/rider/<publicId>/<v>.png`. Новых получателей нет (мету отдают только тому, кто уже
  открыл страницу по тому же `publicId`), картинка без ПДн и после отзыва согласия URL → `404`; но URL картинки
  дополнительно хранят серверы мессенджеров.
  (a) **принять**: `publicId` только в `openGraph.images[0].url`/`twitter`, тест переписать на «нет в
  title/description/`og:url`, нет имени/клуба» + явная проверка URL — рекомендация (минимум кода, D-B2 про ПДн
  соблюдён); (b) отказаться от своей картинки райдера (бренд как сейчас) — `rider` уходит из scope;
  (c) непрозрачный OG-ключ (sha256(publicId) + обратное отображение в Redis/профиле) — сложность и новое хранилище
  ради нулевого выигрыша. Выбор фиксирует оркестратор/человек строкой в S5.
- **RC-2 [CONCERN] S2/AC4: курсор `og:cursor:season` по `seasons.updatedAt` не ловит смену «N гонок».**
  `updatedAt` сезона меняет только `SeasonsService.update`; публикация/отмена гонки сезона его не трогает → после
  каждой новой гонки версия меняется, а `og.sync` её не видит — первый краулер получает бренд (ровно частый случай).
  (a) **без курсора**: каждый прогон — все живые сезоны (`endsOn ≥ minskToday(now − 30 д)`, единицы штук):
  `resolve` → `hasPng` → `enqueue`; порт `liveSeasonIds(sinceLocalDate)` вместо `seasonOgChanged` — рекомендация
  (стоимость — 1 запрос + 1–3 `findSeason`+`count` в минуту); (b) курсор + в цикле гонок досылать сезон
  изменившейся гонки — не ловит отмену (`ogChanged` гонок — только `published`), сложнее; (c) оставить S2 и принять
  самолечение. Правка: S2 «пререндер — полный просмотр живых сезонов каждый прогон, без курсора»; AC4 «`og.sync`
  пререндерит живые сезоны (без курсора), райдеров — нет».
- **RC-3 [CONCERN] S3 «N гонок» = `summary.races` («В зачёте») расходится со страницей.** Профиль показывает и
  «В зачёте», и «Финиши»; райдер только с финишами без места (START, «без пульса») получит «Пока без гонок», хотя на
  странице «Финиши: 3». (a) **«N гонок» = `finishes`**, «M подиумов», «Лучшее место: K»; 0 финишей — «Пока без
  гонок» — рекомендация; (b) подписи как на странице: «В зачёте: N · Подиумы: M»; (c) оставить S3.
- Прочее: «N гонок» сезона — только `published` (страница сезона показывает и отменённые) — согласуется с «отменённая —
  без своей картинки»; оставить, отметить в доке. Смена таблицы `scheme` без `renderVersion` меняет хэши, но не
  запускает полный проход (`og:sweep` = тема:версия) — правило в комментарии: «изменил `scheme` — подними
  `renderVersion`».

### Test matrix

См. §8.1 (дополнено архитектором: новые и **ломающиеся существующие** тесты).

### Implementation Context

#### ENTRY POINTS

`OgCardController` (`GET og/cards/:kind/:id`, `GET og/images/:kind/:id/:file`); `OgSync.run` (worker);
`StoryCardProcessor.buildOgCard`; `generateMetadata` в `apps/app/src/app/{seasons,riders}/[id].tsx`;
`apps/api/scripts/story-card-preview.ts`.

#### FILES TO MODIFY — по слоям

**contracts** — `packages/contracts/src/sharing/og-card.schema.ts` (+ `src/index.ts` экспорт `OG_CARD_ID`,
`OgImageParams`): см. «Contracts & compatibility». Doc-комментарий: виды «гонка, райд, маршрут, старт, сезон, райдер».

**i18n** — `packages/i18n/src/ru.ts`: `ogCard.kicker.season` «Сезон», `ogCard.kicker.rider` «Райдер»,
`ogCard.alt.season` «Сезон «{title}»», `ogCard.alt.rider` «Профиль райдера — Покатим» (без параметров),
`ogCard.seasonRaces` plural `{count} гонка/гонки/гонок`, `ogCard.riderRaces` plural (то же), `ogCard.riderPodiums`
plural `{count} подиум/подиума/подиумов`, `ogCard.bestPlace` «Лучшее место: {place}», `ogCard.noRaces` «Пока без гонок».
Заголовок райдера — существующий `riders.title`. Строки `ogCard.*` изменились → `renderVersion` (S4 уже).

**races** (порт, без новых модулей):
```ts
// races-for-sharing.port.ts
export interface SeasonOgFacts { seasonId: string; title: string /* = name */; startsOn: string; endsOn: string;
  /** опубликованные гонки сезона (без черновиков и отменённых) */ raceCount: number }
interface RacesForSharing { …; seasonOgFacts(seasonId: string): Promise<SeasonOgFacts | null>;
  /** id сезонов с `endsOn ≥ sinceLocalDate` (живые; RC-2a) */ liveSeasonIds(sinceLocalDate: string): Promise<string[]> }
// races.repository.ts
countPublishedInSeason(seasonId: string): Promise<number>   // { seasonId, status: 'published' }
liveSeasons(sinceLocalDate: string): Promise<{ _id: string }[]> // { endsOn: { $gte } }, проекция _id, сортировка _id
```
`index.ts` — экспорт `type SeasonOgFacts`. `title` вместо `name` — чтобы общий `ogCardTexts`/`ogCardAlt` брал
`facts.title` (как у остальных фактов). (Если RC-2 = (b)/(c) — `seasonOgChanged(after, limit)` по `changedAfter` +
`CHANGED_SORT` на `seasons`, без индекса.)

**riders** (новое):
- `riders-for-sharing.port.ts`: `export const RIDERS_FOR_SHARING = Symbol('RIDERS_FOR_SHARING');
  export interface RiderOgFacts { publicId: string; races: number /* RC-3a: finishes */; podiums: number;
  bestPlace: number | null }; export interface RidersForSharing { /** только публичный профиль (имя + согласие),
  иначе null */ ogFacts(publicId: string): Promise<RiderOgFacts | null> }`. Ни имени, ни клуба, ни фото, ни `userId`.
- `riders-for-sharing.ts`: `RidersForSharingService` — `RIDER_PROFILES.findPublic` → `null` | `publishedRows` +
  `publishedFinishes` → `summarize` (тот же расчёт, что `RidersService.publicProfile`).
- `riders.module.ts`: `RidersCoreModule { imports: [ProfileCoreModule, ResultsCoreModule], providers:
  [RidersForSharingService, { provide: RIDERS_FOR_SHARING, useExisting: RidersForSharingService }], exports:
  [RIDERS_FOR_SHARING] }`; `RidersModule` не меняется. Комментарий модуля: «`RidersCoreModule` импортирует `sharing`».
- `index.ts`: `RidersCoreModule`, `RIDERS_FOR_SHARING`, `type RidersForSharing`, `type RiderOgFacts`.

**sharing**:
| Файл | Что |
|---|---|
| `sharing.policy.ts` | `export type OgScheme = 'light' \| 'dark'`; `export type OgCardKindOrBrand = OgCardKind \| typeof OG_BRAND.kind` (перенос); `OG_CARD_POLICY.renderVersion: 3`, `scheme: { race:'dark', ride:'light', route:'light', calendar:'light', season:'dark', rider:'dark', brand:'light' } satisfies Record<OgCardKindOrBrand, OgScheme>`, `prerenderWindow.seasonDays: 30`; `export const OG_SYNC_KINDS = ['race','ride','route','calendar','season'] as const satisfies readonly OgCardKind[]`, `OG_CURSOR_KINDS = ['race','ride','route','calendar'] as const` (RC-2a); `OgPrerenderFacts` + `{ kind:'season'; facts:{ endsOn: string } } \| { kind:'rider' }`; `ogPrerenderable`: season — `endsOn >= minskToday(since(seasonDays))`, rider — `false` |
| `og-card.inputs.ts` | каждый вариант `OgCardInput` + `scheme: OgScheme`; варианты `{ kind:'season'; …; facts: SeasonOgFacts }`, `{ kind:'rider'; …; facts: RiderOgFacts }`; `resolve`/`resolveBrand` ставят `scheme: OG_CARD_POLICY.scheme[kind]` (`resolved()` прежний); типы `OgSyncKind`, `OgCursorKind` — из `OG_SYNC_KINDS`/`OG_CURSOR_KINDS`; `ogCardHash`: `['og', kind, renderVersion, themeId, scheme, ...canonicalFacts]`; `canonicalFacts` season — `[seasonId, title, startsOn, endsOn, raceCount, null]`, rider — `[publicId, races, podiums, bestPlace, null]`; конструктор + `@Inject(RIDERS_FOR_SHARING)`; `resolve` + 2 ветки; `changed(kind: OgCursorKind, …)` — порты 4 видов (season — отдельно `liveSeasonIds`) |
| `og-card.texts.ts` | `factsOf` season — `[localRange(startsOn, endsOn), raceCount > 0 ? t('ogCard.seasonRaces',{count}) : '']`; rider — `races === 0 ? [t('ogCard.noRaces')] : [join([races, podiums>0 ? podiums : null]), bestPlace ? t('ogCard.bestPlace',{place}) : '']`; `ogCardTexts.title`: rider — `t('riders.title')`, иначе `facts.title`; `ogCardAlt` rider — `t('ogCard.alt.rider')` |
| `og-card.png.ts` | `colorsOf(input) = storyCardColors(themeOf(input).schemes[input.scheme])` в `ogCardRenderInput` и `ogBrandRenderInput`; `ogCardRenderInput` сигнатура прежняя |
| `og-card.render.ts` | без изменений (линии у season/rider нет → колонка во всю ширину) |
| `og-card.cache.ts` | `cursorKey(kind: OgCursorKind)`; `resetCursors` — `OG_CURSOR_KINDS` (если RC-2 ≠ a — `OG_SYNC_KINDS`) |
| `og-sync.ts` | `scanned: Record<OgSyncKind, number>`; цикл курсоров — `OG_CURSOR_KINDS`; затем шаг сезонов: `inputs.liveSeasonIds(minskToday(now − seasonDays))` → по id `prerender('season', id, now)` с тем же лимитом `syncRenderLimit` (`scanned.season`), сбой — `failedKinds.push('season')`; rider — нигде |
| `og-card.controller.ts` | `images`: `@Param(new ZodValidationPipe(OgImageParams, FieldErrorCode)) params: OgImageParams` вместо `kindPipe`/`idPipe`(`Uuid`); `cards` — прежний `paramsPipe` (новая схема); `imagePath` для `302` — `encodeURIComponent(id)` (publicId — base64url, но единообразно) |
| `og-card.service.ts` | `enqueue` warn: id для `rider` не логировать (`ogLogId(kind, id, hash)`) |
| `story-card.processor.ts` | `ogLine`: `case 'season': case 'rider': return null`; `label()` — без `publicId` для `rider` |
| `sharing.module.ts` | `SharingModule` и `SharingWorkerModule`: + `RidersCoreModule`; doc-комментарий портов |
| `apps/api/test/og-fixtures.ts`, `test/og.ts` | фикстуры `season`/`rider` (+`scheme`), `seedSeason(h, {...})` |
| `scripts/story-card-preview.ts` | кейсы `og-season`, `og-season-empty` (0 гонок), `og-rider`, `og-rider-new` (0 гонок), тёмная гонка с линией и длинным названием; `scheme` берётся из фикстуры |

**app**:
- `lib/og-image.ts`: `ogCardForSsr(kind, id)` → `publicPath('/v1/og/cards/' + kind, id, '', OG_CARD_ID[kind])`;
  `pageOgImage({ kind, id, alt, page, card })` — `page: PublicSsrResult<unknown>`, `id`/`alt` передаёт страница
  (сезон — `name`, райдер — без данных страницы); вызовы `races|rides|routes|calendar/[id].tsx` обновить
  (`id: page.data.id`, `alt: t('ogCard.alt.<kind>', { title })`) или оставить старую сигнатуру обёрткой — на выбор
  coder, без дубля логики «своя → бренд».
- `app/seasons/[id].tsx`: `Promise.all([seasonForSsr(params), ogCardIfOrigin('season', params.id)])`; alt
  `t('ogCard.alt.season', { title: season.name })`; not found — без картинки.
- `app/riders/[id].tsx`: то же с `'rider'`; alt `t('ogCard.alt.rider')`; `noindex`, без `og:url`, title/description
  нейтральные (как сейчас).

#### FILES TO READ

`sharing/{og-card.*,og-sync*.ts,sharing.policy.ts,story-card.processor.ts}`, `ride-invite.png.ts` (выбор схемы),
`riders/{riders.service.ts,riders.policy.ts,riders.module.ts}`, `profile/rider-profiles.port.ts`,
`results/rider-results.port.ts`, `races/{races-for-sharing*.ts,races.repository.ts:86–163,races-public.service.ts:108–145}`,
`achievements/*module.ts` (образец `*ReadModule` для чужого импорта), `apps/app/src/lib/{og-image.ts,public-ssr.ts}`,
`apps/app/src/__tests__/public-metadata.test.ts:470–520, 600–760`, `docs/adr/0018-story-cards.md:96–`.

#### TYPES & SCHEMAS

`OG_CARD_KINDS`, `OG_CARD_ID`, `OgCardParams`, `OgImageParams` (contracts); `SeasonOgFacts`, `RiderOgFacts`,
`RidersForSharing`, `OgScheme`, `OgCardKindOrBrand`, `OG_SYNC_KINDS`/`OG_CURSOR_KINDS`, `OgPrerenderFacts`.

#### TESTS

См. §8.1. Ломаются существующие (обновить, не удалять смысл):
`og-card.schema.test.ts` (`OgCardKind.safeParse('season')` → теперь успех; заменить на `'brand'`/`'x'`),
`og-card.int.test.ts:119` (`/og/cards/season/<uuid гонки>` ждёт 400 → станет 404; кривой вид — `/og/cards/team/…`),
`og-sync.processor.test.ts:43` (`scanned` + `season`), `og-sync.int.test.ts` (`scanned`, курсоры), фикстуры
`og-fixtures.ts` (`satisfies Record<OgCardInput['kind'],…>` потребует `season`, `rider`, `scheme`),
`og-card.render.test.ts`/`og-card.png.test.ts` (входы с `scheme`), `story-card.processor.test.ts` (если строит
`OgCardInput`), `public-metadata.test.ts` (сезон и райдер больше не «страницы-бренды»: тест «страницы-бренды» —
убрать их; тест райдера `not.toContain(PUBLIC_ID)` — по RC-1), `og-image.test.ts` (сигнатура `pageOgImage`).
Захардкоженных хэшей/версий в тестах нет (только regex 16/64 hex) — бамп `renderVersion` их не ломает;
тест «смена renderVersion меняет хэш» мутирует policy — работает.

#### OUT OF SCOPE

Story-карточка маршрута, имя/фото/клуб на OG, лидеры сезона, sitemap (сезоны там уже есть, райдеров нет и не будет),
кнопки «Поделиться», `STORY_CARD_POLICY.renderVersion`, новые индексы/миграции, outbox.

#### Порядок (TDD)

1. contracts (`OG_CARD_ID`, params) → 2. i18n → 3. порт `races` (int, реальная MongoDB: факты, count только
`published`, `liveSeasonIds` граница 30 д по Минску) → 4. `RidersCoreModule` + порт (int: публичный/без согласия/без
имени/неизвестный → `null`; статистика = `GET /v1/riders/:id`.stats) → 5. policy/inputs/texts/png (unit) →
6. controller/service (int AC1, AC2) → 7. `og.sync` (int AC4) → 8. app (AC5) → 9. превью PNG (≤ 300 КБ, обе схемы) →
10. документы (§10), `TURBO_CONCURRENCY=1 pnpm check`.


# 8. Acceptance Criteria

- AC1. `GET /v1/og/cards/season/<id>` → `{ version }`; `GET /v1/og/images/season/<id>/<v>.png` — PNG (после рендера),
  старая `v` — `302`, неизвестный сезон — `404`.
- AC2. `GET /v1/og/cards/rider/<publicId>` → `{ version }` только для публичного профиля; без согласия/имени и
  неизвестный — `404`; на картинке и в alt нет имени, клуба, фото; `rider/<uuid-не-publicId>` — `400`/`404`.
- AC3. Гонка, сезон, райдер рисуются тёмной схемой темы, остальные — светлой; схема в хэше; `renderVersion` = 3.
- AC4. `og.sync` пререндерит живые сезоны (без курсора, полный просмотр каждый прогон — RC-2a), райдеров — нет.
- AC5. SSR: `/seasons/<id>` и `/riders/<publicId>` — `og:image` со своим видом и версией; нет версии — бренд; не найдено
  — без картинки; у райдера мета без ПДн, `noindex`, без `og:url`.
- AC6. `pnpm check` зелёный; превью (`preview:story-cards`) — PNG новых видов и тёмной схемы ≤ 300 КБ.

# 8.1 Test matrix (минимум)

| Слой | Файл | Что |
|---|---|---|
| unit contracts | `og-card.schema.test.ts` | новые виды; `rider` + publicId ок, `season` + не Uuid — ошибка |
| unit api | `og-card.inputs.test.ts` | хэш меняется со схемой и статистикой; райдер без имени в фактах |
| unit api | `og-card.texts.test.ts` | тексты сезона/райдера, «Пока без гонок», без лучшего места |
| unit api | `og-card.render.test.ts` / `og-card.png.test.ts` | тёмная схема → цвета `schemes.dark` |
| unit api | `sharing.policy.test.ts` | `ogPrerenderable` season/rider; `scheme` |
| int api | `og-card.int.test.ts` | AC1, AC2 (404 без согласия, 400 на кривой id) |
| int api | `og-sync.int.test.ts` | AC4 |
| int api | порты `races`/`riders` | факты сезона (только опубликованные гонки), статистика райдера |
| unit app | `__tests__/public-metadata.test.ts` | AC5 |

**Дополнение архитектора (2026-10-30):**

| Слой | Файл | Что |
|---|---|---|
| unit contracts | `og-card.schema.test.ts` | `OG_CARD_ID`: `rider` + Uuid → ошибка, `season` + publicId → ошибка; `OgImageParams` (+`file`, лишний ключ — ошибка); правка старого `safeParse('season')` |
| unit api | `sharing.policy.test.ts` | `scheme` покрывает все виды + `brand` (`satisfies`), `ogPrerenderable` season граница `endsOn = today − 30 д` (Минск), rider — всегда `false` |
| unit api | `og-card.inputs.test.ts` | хэш: та же фактура, `scheme` light↔dark → разный; rider `races/podiums/bestPlace` → разный; `canonicalFacts` rider не содержит строк, кроме `publicId` |
| unit api | `og-card.png.test.ts` | race/season/rider → `background = schemes.dark.surface.default`, ride/route/calendar/brand → light; реальный satori+resvg тёмной карточки ≤ `maxPngBytes` |
| int api | `og-card.int.test.ts` | `rider/<uuid>` → 400 (`RiderPublicId`), `season/<publicId>` → 400, `/og/images/rider/<publicId>/<v>.png` отзыв согласия → 404 JSON до чтения PNG; правка строки 119 |
| int api | `races-for-sharing.int.test.ts` | `seasonOgFacts` (черновик/отменённая не в `raceCount`, неизвестный — `null`), `liveSeasonIds` |
| int api | `riders/riders-for-sharing.int.test.ts` (новый) | публичный → факты = `stats` публичного профиля; без согласия/без имени/неизвестный → `null`; ключи объекта — только `publicId, races, podiums, bestPlace` |
| int api | `og-sync.int.test.ts` | сезон без PNG ставится каждый прогон до готовности; публикация гонки сезона → новая версия ставится следующим прогоном (RC-2a); профиль райдера в БД → `enqueued` не растёт |
| unit api | `story-card.processor.test.ts` | `og-card.render` season/rider → `no line`; лог без `publicId` |
| unit app | `og-image.test.ts` | `ogCardForSsr('rider', '../x')` — без запроса; `pageOgImage` с `id`/`alt` |
| unit app | `public-metadata.test.ts` | сезон/райдер: своя картинка, версии нет — бренд, 404 — без картинки; райдер — `noindex`, без `og:url`, имени/клуба (RC-1) |
| build | `pnpm depcruise` (в `pnpm check`) | нет цикла `sharing ↔ riders` и `sharing.policy ↔ og-card.inputs` |

# 9. Риски

- Публикация протокола меняет статистику → новая версия райдера → первый запрос после — бренд-PNG (рендер в очереди).
- Отзыв согласия: старый PNG в Redis недостижим (hash от фактов, ответ `404` до чтения PNG); у мессенджеров превью
  уже закэшировано — на нём нет ПДн (S3).

# 10. Documentation Impact

- `docs/adr/0018-story-cards.md`, дополнение og-images: сезон и профиль райдера — свои картинки (убрать из списка
  бренд-страниц); строка «Шаблон один, светлая схема» → таблица схем `OG_CARD_POLICY.scheme` (race/season/rider —
  тёмная); порты + `RIDERS_FOR_SHARING`, `seasonOgFacts`; `og.sync` — сезоны полным просмотром живых (RC-2), райдеры —
  только самолечение, `pngShortTtlSec`; приватность райдера (нет имени/клуба/фото, `publicId` только в URL — RC-1).
- `docs/product/races-and-seasons.md` (экран сезона): OG-картинка — метка «Сезон», название, даты, «N гонок» (только
  опубликованные).
- `docs/product/profile.md` (строка 142): мета нейтральная, `noindex`, OG-картинка «Профиль райдера» со статистикой без
  ПДн; нет согласия — без картинки.
- `.claude/rules/pokatim-backend.md`: §Профиль райдера — «`riders` импортирует `AppModule` и `sharing`
  (`RidersCoreModule`, порт `RIDERS_FOR_SHARING`)»; §Карточки/OG — виды, `scheme`, `og:cursor:<kind>` только 4 видов,
  сезоны без курсора.
- `.claude/rules/pokatim-security.md` §Карточки: OG райдера — только при `findPublic`, без ПДн, логи без `publicId`.
- `.claude/rules/pokatim-contracts.md` (если перечисляет OG-схемы): `OG_CARD_ID`, `OgImageParams`.

# 12. Outcome

Реализовано по §3.1 (RC-1…RC-3 — вариант (a)), §5, §8.

- **contracts**: `OG_CARD_KINDS` + `season`, `rider`; `OG_CARD_ID` (райдер — `RiderPublicId`, остальные — Uuid);
  `OgCardParams` — id по виду (`superRefine`, ошибка поля `id` с кодом `INVALID`); новый `OgImageParams`.
- **i18n**: `ogCard.kicker.{season,rider}`, `ogCard.alt.{season,rider}`, plural
  `ogCard.{seasonRaces,riderRaces,riderPodiums}`, `ogCard.bestPlace`, `ogCard.noRaces`.
- **races**: порт `RACES_FOR_SHARING` + `seasonOgFacts`, `liveSeasonIds`; репозиторий `countPublishedInSeason`,
  `liveSeasons`.
- **riders**: `RidersCoreModule` + порт `RIDERS_FOR_SHARING` (`RidersForSharingService`: `findPublic` → `summarize`;
  `races` = `finishes`, RC-3a); тип фактов без имени, клуба, фото, `userId`.
- **sharing**: `OG_CARD_POLICY.scheme`, `renderVersion` 3, `seasonDays` 30, `OG_SYNC_KINDS`/`OG_CURSOR_KINDS`,
  `OgCardKindOrBrand`/`OgScheme` — в `sharing.policy.ts`; `OgCardInput.scheme`, хэш со схемой, виды season/rider;
  тексты/alt; цвета — `storyCardColors(theme.schemes[scheme])`; `images` — `OgImageParams`, `302` —
  `encodeURIComponent(id)`; `og.sync` — курсоры 4 видов + полный просмотр живых сезонов (RC-2a), райдеры — нет; логи
  райдера — `ogLogId` (8 hex хэша вместо `publicId`).
- **app**: `ogCardForSsr` — схема id по виду; `ownOgImage` (общая логика «своя → бренд»; `pageOgImage` — обёртка для
  страниц с названием); `/seasons/[id]`, `/riders/[id]` — своя картинка; `brandOgImageFor` удалён (вызывающих нет).
- **Тестовые хелперы**: `seedOgSeason` (`test/og.ts`); `seedFinisher` перенесён из `riders.int.test.ts` в
  `test/standings.ts` (общий с новым `riders-for-sharing.int.test.ts`).
- **Превью**: `og-season`, `og-season-empty`, `og-season-long`, `og-rider`, `og-rider-new`, `og-rider-noplace`; гонки —
  тёмные из фикстуры; все PNG 20–50 КБ (≤ 300 КБ).
- **Документы**: ADR-0018 (дополнение), `docs/product/races-and-seasons.md`, `docs/product/profile.md`.
  `.claude/rules/*` не тронуты — follow-up (§10: `pokatim-backend.md`, `pokatim-security.md`) в `pr.md`.
- **S6**: кнопок «Поделиться» на экранах сезона и профиля нет — no-op.
- AC4 в формулировке «курсор `og:cursor:season`» заменён решением RC-2a (§3.1): сезоны — без курсора.

Проверки: `pnpm check` (`TURBO_CONCURRENCY=1`, изолированные Mongo/Redis) — format, lint, depcruise, typecheck
зелёные; api: 13 из 2147 упали по таймауту 20 с в 5 посторонних файлах (disputes, results-disputes,
rides-participation, routes-derived, panel-races) — отдельный перезапуск 48/48 (флаки под нагрузкой). app: в первом
прогоне 4 suite упали по таймауту 5 с (`season.test.tsx` и др.), повторный полный прогон — без FAIL,
`season.test.tsx` отдельно — 18/18. admin — 461/461.

Отклонение: БД тестов — `pokatim_sharing_test` вместо `pokatim_sharing` (стенд `@rkarakulov/test-kit` требует `*_test`).
