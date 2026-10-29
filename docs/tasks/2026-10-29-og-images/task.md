# 1. Title

OG-картинки 1200×630 для публичных SSR-страниц: превью ссылки в Telegram, VK, WhatsApp, Facebook (ADR-0018, следующий
слайс рендера карточек).

# 2. Goal

Ссылка на гонку, кофе-райд, маршрут каталога или старт календаря, отправленная через «Поделиться», разворачивается в
мессенджере в превью с картинкой: вид объекта, название, факты, линия маршрута, бренд — в цветах активной темы.
Остальные публичные страницы (лендинг `/welcome`, таблица сезона, профиль райдера, вход, регистрация) получают общую
бренд-картинку. Сейчас `og:image` нет нигде (решения Q14/Q17 откладывали картинку «до блока шеринга»).

Источники: ADR-0018 (satori + resvg в worker, кэш Redis, темы), `docs/tasks/2026-10-28-story-cards`,
`docs/tasks/2026-10-28-ride-invite-card`, `apps/app/src/lib/page-metadata.ts`. Код сверен по `origin/develop` @
`6fe3a767`.

# 3. Scope

Уровень **task3** (новые публичные эндпоинты, порты в 4 модулях, расписание worker, SSR всех публичных страниц,
безопасность анонимной выдачи). Один PR в `develop`.

## 3.1 Решения (человек выбрал варианты 2026-10-29)

- **D1. Страницы.** Своя картинка: `race` (`/races/[id]`), `ride` (`/rides/[id]`), `route` (`/routes/[id]`),
  `calendar` (`/calendar/[id]`). Бренд-картинка `brand`: `/welcome` и `/`, `/seasons/[id]`, `/riders/[id]`,
  `/sign-in`, `/register`, `/status`. Профиль райдера и таблица сезона со своими картинками — следующий слайс.
- **D2. Единый шаблон 1200×630** (светлая схема активной темы, гарнитуры темы — как `line` у сторис). Слева: метка
  вида («Гонка», «Кофе-райд», «Маршрут», «Старт»), название (≤ 3 строк, кегль ступенями по длине), 1–2 строки фактов,
  внизу бренд «Покатим». Справа — плитка с линией маршрута, если линия публичная; нет линии — текст во всю ширину.
  Бренд-картинка — название, слоган `app.tagline`, бренд.
  Факты: гонка — окно дат (Минск) и дистанция, класс; райд — дата, день недели и время, «Старт: место», дистанция и
  темп; маршрут — дистанция, набор высоты, город, «Кольцо»; старт календаря — даты, город, дистанции.
- **D3. Пререндер, а не рендер по запросу.** Рендер — только worker (очередь `story-card`, задача `og-card.render`).
  Расписание `og.sync` (каждую минуту + при старте worker, по образцу `standings.sync`, DV-1 — без outbox) проходит
  объекты, изменившиеся с прошлого прогона (`updatedAt` > курсора вида в Redis), и рендерит недостающие картинки;
  смена активной темы или `OG_CARD_POLICY.renderVersion` — полный проход (курсоры сбрасываются). Пачка ограничена,
  остаток — следующим прогоном. HTTP-обработчик картинку не рендерит и не ждёт: нет PNG — бренд-картинка и постановка
  рендера (самолечение после TTL).
- **D4. Версия в URL (`?v=` по смыслу).** Адрес картинки — `<WEB_ORIGIN>/v1/og/images/<kind>/<id>/<v>.png`, `v` — первые
  16 hex sha256 входов карточки (вид, `renderVersion`, тема, публичные поля, ссылка на публичную линию). Правка → новая
  `v` → новый URL, Facebook/VK при перескрейпе берут новую картинку; Telegram обновляет кэш превью через @WebpageBot.
  SSR узнаёт `v` из **отдельного** публичного эндпоинта `GET /v1/og/cards/<kind>/<id>` → `{ version }`, а не из
  DTO страниц: иначе 4 модуля-владельца зависели бы от `sharing` (на `sharing` не ссылается никто, ADR-0018).
  Запрос SSR идёт через `fetchPublicForSsr` (кэш процесса 60 с), параллельно с данными страницы.
- **D5. Выдача PNG** `GET /v1/og/images/:kind/:id/:file` — без входа, IP-лимит `og-image`. Каждый запрос заново
  читает публичные факты (дешёвые чтения через порты) и считает текущую `v`:
  - объект не публичный (скрыт, черновик, отменён, снят с каталога, неизвестен) → `404` JSON, картинки нет;
  - `v` из URL ≠ текущей → `302` на URL текущей `v` (`Cache-Control: public, max-age=300`);
  - PNG текущей `v` есть → `200 image/png`, `Cache-Control: public, max-age=86400`;
  - PNG нет → бренд-PNG `200` с `Cache-Control: no-store` + постановка рендера (NX по хэшу).
  Бренд: `GET /v1/og/cards/brand/site` и `/v1/og/images/brand/site/<v>.png` — тот же поток, факты — тема и тексты.
- **D6. Хранение.** Redis: `og:png:<hash>` — PNG, TTL 30 дней (не капабилити: адрес публичный по смыслу);
  `og:pending:<hash>` — NX постановки; `og:cursor:<kind>` и `og:sweep` (тема + `renderVersion`). MongoDB не трогаем.
- **D7. Приватность.** Картинка — только поля публичной страницы. Райд: без организатора, участников, описания;
  линия — только маршрута, который **сейчас** в каталоге (`RideRoutes.catalogLine`); `private` — никогда. Маршрут:
  только `IN_CATALOG`, без автора. Гонка: только `published` (отменённая — бренд, без своей), линия — показываемая
  геометрия маршрута гонки (`ROUTE_GEOMETRY.displayGeometry`, как на странице). Старт календаря: только `published`.
  Райд: только `published` (отменённый и скрытый — без своей картинки; скрытый/неизвестный — `404`, как страница).
  Скрытые и непубличные: SSR не отдаёт `og:image` (ветки `notFound`), выдача PNG — `404`.
- **D8. SSR (app).** `publicPageMetadata({ …, image })`: `openGraph.images = [{ url, width: 1200, height: 630, alt,
  type: 'image/png' }]`, `twitter: { card: 'summary_large_image' }`. URL — только из `WEB_ORIGIN` (env сервера), как
  `og:url`. `cards`-ответ `unavailable`/`notFound` → бренд для «нашлось», ничего — для «не найдено» страницы.
  Бренд-версию SSR получает так же (`/v1/og/cards/brand/site`, кэш 60 с); недоступна — без `og:image`.
- **D9. Порты владельцев** (через их `index.ts`, реализация в `*CoreModule`):
  `ogFacts(id)` → публичные факты карточки или `null` и `ogChanged(since, limit)` → `{ id, updatedAt }[]` по
  `updatedAt` для `races`, `rides` (расширить `RIDES_FOR_SHARING`), `routes`, `calendar`. Линии: гонка —
  `ROUTE_GEOMETRY`, маршрут — линия показа каталога, райд — `RideRoutes.catalogLine`.
- **R-A1 (решение человека 2026-10-29): вариант A.** PNG в Redis — TTL 7 суток со скользящим продлением при выдаче
  `200` (`GETEX … EX`); пререндер `og.sync` — только «живые» объекты (`ogPrerenderable`: райд — `startsAt ≥ now − 14 д`,
  гонка — `windowEndsAt ≥ now − 30 д`, старт — `(endsOn ?? startsOn) ≥ сегодня − 14 д` по Минску, маршрут каталога —
  все), остальные — самолечением при первом запросе; `OG_CARD_POLICY.maxPngBytes` = 300 КБ. Уточняет D6 (TTL 30 дней →
  7 дней с продлением).

## 3.2 Слои

- `packages/contracts`: `OgCardKind`, `OgCardMeta` (`{ version }`), схемы параметров.
- `packages/design-tokens`: токены `ogCard` (размер, поля, кегли, плитка линии).
- `packages/i18n`: `ogCard.*` (метки видов, строки фактов, alt).
- `apps/api`: `sharing` — `OgCardController` (cards + images), `OgCardInputs` (+ хэш), тексты, разметка `ogCardTree`,
  рендер `renderOgCard` (обобщить `renderCardSvg`/PNG по размеру), ветка `og-card.render` процессора, `OgCardCache`,
  `OgSync` (+ расписание, очередь `og-sync`), `OG_CARD_POLICY`; порты в `races`, `rides`, `routes`, `calendar`.
- `apps/app`: `lib/page-metadata.ts` (+ image), `lib/og-image.ts` (адрес и SSR-чтение версии), `generateMetadata`
  страниц из D1.

# 4. Out of Scope

- Своя картинка профиля райдера и таблицы сезона (имена/аватар по согласию) — следующий слайс.
- Тёмный шаблон OG, фото организатора, локализация кроме ru.
- CDN перед `/v1/og/images` (Caddy отдаёт напрямую; заголовки кэша готовы под CDN).
- Изменение сторис и приглашения (их `renderVersion` не меняется).

# 5. Architecture Context

## Architecture Review — og-images
Status: **CONCERNS** (блокеров нет; один [ARCH-RISK] по памяти Redis — §8 R-A1, нужен ответ человека до шага 6;
до ответа coder берёт рекомендованный вариант A — это параметры `OG_CARD_POLICY`, меняются одной правкой).

Сверено по коду `feature/og-images` (= `origin/develop` @ `6fe3a767`):

- **Предикаты видимости.** `RacesRepository.findPublic` (races.repository.ts:333) — `published | cancelled`; для OG
  нужна только `published` (D7) → новый метод. `RidesRepository.findPublic` (rides.repository.ts:206,
  `VISIBLE_STATUSES` :126) — `published | cancelled`, проекция `PUBLIC_PROJECTION` без организатора → OG: тот же
  `findPublic` + `status === 'published'`. Маршрут — `IN_CATALOG` (routes.repository.ts:96) через `findInCatalog`
  (:295) + `inCatalog`-гард как в `RoutesPublicService.published`. Календарь — `findPublished`
  (calendar.repository.ts:109, `status: 'published'`) — как есть.
- **`updatedAt`.** Ставят все переходы видимости: гонка — publish/cancel (races.service.ts:328,354); райд — правка,
  отмена, `hide`/`restore` модерации (rides.repository.ts:574,598), join/leave тоже (:231,:250 — лишнее чтение
  фактов в `og.sync`, рендера не будет: хэш не меняется); маршрут — publish/unpublish каталога
  (routes.repository.ts:361,371), модерация/отзыв (:519,:539); календарь — правка/снятие/возврат
  (calendar.service.ts:134–167). **Не** ставится `updatedAt` райда, когда его маршрут уходит из каталога или входит в
  него (это запись в `routes`). Приватность от этого не зависит: выдача PNG на каждом запросе пересчитывает текущую
  `v` (в хэше — `routeId` только если маршрут сейчас `public`), PNG ищется по **текущему** хэшу, старый PNG с линией
  по URL недостижим (старая `v` → 302 на новую). Цена — пререндера нет, первый запрос получает бренд и ставит рендер
  (§8 R-A3). Скрытие/снятие `og.sync` замечать не обязан — его задача только пререндер.
- **Индексы по `updatedAt`.** У `races`, `rides`, `routes`, `calendar_starts` их нет (есть только у
  `track_uploads`, `race_attempts`, `push_tokens`). `og.sync` ежеминутно делает 4 keyset-запроса
  `(updatedAt, _id) > курсора` с сортировкой → без индекса — COLLSCAN + сортировка в памяти. Нужна expand-only
  миграция `0037_og_sync_indexes` (`{ status: 1, updatedAt: 1, _id: 1 }` на 4 коллекции) — D6 «MongoDB не трогаем»
  касается хранения картинок, индекс — техническое дополнение (§8 R-A2).
- **`WEB_ORIGIN`.** Только env web-сервера (`infra/deploy/docker-compose.yml:219`, prod `:36`), читается в
  `page-metadata.ts` (`process.env.WEB_ORIGIN`). Caddy проксирует `/v1/*` того же хоста в api — адрес
  `<WEB_ORIGIN>/v1/og/images/...` рабочий. API свой origin не знает (ADR-0018) → `Location` редиректа —
  абсолютный путь `/v1/og/images/...` без хоста.
- **`useId` в SSR.** Задача не добавляет компонентов — только `generateMetadata`; `useId` есть в
  `*.web.tsx` карт/кропа (не затрагиваются). Риска гидрации нет.
- **Рендер только в worker.** HTTP читает факты, считает хэш, читает Redis, ставит задачу — без satori/resvg.
  `og.sync` — тоже без рендера: только ставит задачи `og-card.render` в очередь `story-card`.
- **Redis** dev-стенда: `maxmemory 192mb`, `noeviction` (infra/deploy/docker-compose.yml:119–122) — OOM ломает
  очереди и лимиты всего API. PNG на 30 дней по всем публичным объектам × смены темы — §8 R-A1.

## 5.1 Placement & Reuse Gate

### Placement

- `apps/api/src/modules/sharing` — всё OG: входы/хэш, тексты, разметка, рендер, кэш, сервис и контроллер, `og.sync`
  (+ расписание), ветка процессора. Новых модулей нет; `sharing` не импортирует никто (как было).
- Новые рёбра: `sharing → races` (`RacesCoreModule`), `sharing → routes` (`RoutesCoreModule`, явно, а не через
  реэкспорт `RidesCoreModule`), `sharing → calendar` (`CalendarCoreModule`) — только `index.ts`. Циклов нет: ни один
  из модулей не зависит от `sharing`.
- Порты — в модулях-владельцах, реализации в их `*CoreModule` (D9): `races` (`RACES_FOR_SHARING`, новый), `rides`
  (`RIDES_FOR_SHARING`, расширение), `routes` (`ROUTES_FOR_SHARING`, новый), `calendar` (`CALENDAR_FOR_SHARING`,
  новый). Линия гонки — `ROUTE_GEOMETRY.displayGeometry` из `sharing` (порт уже есть, кэш в процессе; готовый маршрут
  коридора неизменен), линия маршрута — `ROUTES_FOR_SHARING.ogLine` (делегирует `RideRoutesService.catalogLine`),
  линия райда — существующий `RIDES_FOR_SHARING.inviteLine`.
- `src/changed-since.ts` (композиция, как `page-cursor.ts`): фильтр keyset «после `(at, id)`» и сортировка — одна
  реализация для 4 репозиториев.
- Очередь `og-sync` — `src/queues.ts`; процессор и расписание — `SharingWorkerModule` (`WorkerModule` уже его
  импортирует).
- Миграция `apps/api/src/db/migrations/0037_og_sync_indexes.ts`.
- `packages/contracts` (схемы), `packages/design-tokens` (`ogCard`), `packages/i18n` (`ogCard.*` + перенос
  `formatDistances`) — уже ≥2 потребителя (api + app).
- `apps/app/src/lib/og-image.ts` (новый), `page-metadata.ts`, `generateMetadata` страниц D1.
- Новых пакетов нет. Ничего не уходит в app-foundation: OG-рендер — доменный (темы, тексты pokatim).

### Reuse points / запрещённые дубли

- Рендер: `box`, `node`, `text`, `trackSvg`, типы `StoryCardNode`/`StoryCardTrack` (`story-card.render.ts`),
  `storyCardTrack(line, view)` (`story-card.png.ts`), `storyCardFonts(theme)`, `storyCardColors(scheme.light)`.
  **Не** переиспользовать `page()` и `titleText()` — они зашиты на 1080×1920 и токены `storyCard`; у OG — свои узлы
  на токенах `ogCard`.
- `renderCardSvg`/`renderStoryCardPng` — обобщить параметром размера с умолчанием `storyCard.size` (сторис и
  приглашение байт-в-байт прежние, их `renderVersion` не трогаем).
- Процессор: один `StoryCardProcessor` на очередь `story-card` (второй `@Processor` той же очереди получал бы чужие
  задачи); общий `run()` с «приёмником» исхода вместо прямых вызовов `StoryCardCache`.
- Факты райда — тип `RideInviteFacts` (те же поля, без организатора); линия — `inviteLine`.
- Тексты: `@pokatim/i18n` — `minskDateTime`, `formatLocalRange`/`heroDateText` (окно гонки), `format.range`,
  `format.dateTime`, `date.weekday.*`, `domain.bikeClass.*`, `domain.city.*`, `rideInvite.start`,
  `storyCard.brand`, `app.tagline`; `formatDistances` **перенести** из `apps/app/src/lib/minsk-format.ts` в
  `packages/i18n/src/format.ts` (app — реэкспорт), а не копировать в API.
- Гарды: `IpRateLimitGuard` + `@IpRateLimit` (`src/public-read.guard.ts`); заголовки после чтения — образец
  `story-card-image.controller.ts`; 302 — образец `devices-callback.controller.ts` (`reply.status().header().send()`).
- Расписание — копия схемы `standings-sync.processor.ts` (`upsertJobScheduler` + разовая boot-задача с `jobId`).
- SSR: `fetchPublicForSsr` + `publicPath` (кэш 60 с, Uuid до запроса); своих fetch/кэшей в app нет.
- Запрещено: читать коллекции `races/rides/routes/calendar_starts` из `sharing`; копия предиката видимости в
  `sharing`; второй рендер-конвейер; клиентский (app) расчёт `v`; хэш/версия в DTO страниц (D4).

# 6. Relevant Files

- `apps/api/src/modules/sharing/*` — конвейер карточек, `CardRequests`, `StoryCardCache`, процессор, `renderCardSvg`.
- `apps/api/src/modules/standings/standings-sync.processor.ts` — образец расписания + boot-задачи.
- `apps/api/src/public-read.guard.ts` — `PublicReadGuard`, `IpRateLimitGuard`.
- Порты: `rides/rides-for-sharing.port.ts`, `routes/ride-routes.port.ts`, `routes/route-geometry.port.ts`;
  предикаты видимости: `races.repository.ts:333`, `rides.repository.ts:126,206`, `routes.repository.ts:96,295`,
  `calendar.repository.ts:109`.
- App: `src/lib/page-metadata.ts`, `src/lib/public-ssr.ts`, `src/app/{races,rides,routes,calendar,seasons,riders}/[id].tsx`,
  `src/features/landing/metadata.ts`, `src/__tests__/public-metadata.test.ts`, `src/__tests__/route-metadata.test.ts`,
  `src/app-routes-manifest.server.test.ts`.

# 7. Implementation Notes

## Implementation Context (architect → coder)

### ENTRY POINTS

- HTTP: `OgCardController` (`@Controller('og')`, `SharingModule`):
  `GET og/cards/brand/site`, `GET og/cards/:kind/:id`, `GET og/images/brand/site/:file`,
  `GET og/images/:kind/:id/:file` — статические `brand/site` объявлены **до** параметрических.
- Worker: `StoryCardProcessor` (очередь `story-card`, задача `og-card.render`), `OgSyncProcessor` (очередь `og-sync`,
  задача `sync`), `OgSchedules` (`onApplicationBootstrap`).
- App: `generateMetadata` страниц D1.

### Контракты — `packages/contracts/src/sharing/og-card.schema.ts` (+ экспорт в `src/index.ts`)

```ts
export const OG_CARD_KINDS = ['race', 'ride', 'route', 'calendar'] as const; // только в конец
export const OgCardKind = z.enum(OG_CARD_KINDS, { error: fieldError('INVALID') });
export const OG_BRAND = { kind: 'brand', id: 'site' } as const;
export const OgCardVersion = z.string().regex(/^[0-9a-f]{16}$/);
export const OgCardMeta = z.object({ version: OgCardVersion });          // ответ cards
export const OgCardParams = z.strictObject({ kind: OgCardKind, id: Uuid }); // pipe параметров
export const OgImageFile = z.string().regex(/^[0-9a-f]{16}\.png$/);
export const OG_CARD_SIZE = { width: 1200, height: 630 } as const;
```
api-client не трогаем (клиент `cards` не вызывает; SSR — `fetchPublicForSsr` со схемой `OgCardMeta`).

### Токены — `packages/design-tokens/src/og-card.ts` (+ экспорт)

`ogCard = { size: {1200, 630}, insetX, insetY, columnGap, rule, titleMaxLines: 3, trackMaxPoints: 500,
tile: { width, height, padding, stroke, startDot, startRing }, text: { kicker, title, titleMid, titleLong, fact,
brand } satisfies Record<string, StoryCardText> }` + `OG_CARD_TITLE_STEPS = { mid: <симв.>, long: <симв.> }`.
Прототипа OG нет → все значения `[ASSUMPTION]` (масштаб от `storyCard`), утверждаются превью (шаг 7). Тест токенов:
`insetX*2 + columnGap + tile.width < size.width`, `tile.height ≤ size.height − 2*insetY`, высота 3 строк
`title.lineHeight` + факты + бренд ≤ высоты кадра. Комментарий: «изменил — подними `OG_CARD_POLICY.renderVersion`».

### i18n — `packages/i18n/src/ru.ts`

`ogCard.kicker.race` «Гонка», `ogCard.kicker.ride` «Кофе-райд», `ogCard.kicker.route` «Маршрут»,
`ogCard.kicker.calendar` «Старт», `ogCard.loop` «Кольцо», `ogCard.elevation` «набор {value} м», `ogCard.pace`
«темп {range} км/ч», `ogCard.facts` «{head} · {next}» (склейка), `ogCard.alt.race|ride|route|calendar`
«Гонка «{title}»»…, `ogCard.alt.brand` «Покатим — {tagline}». Переиспользовать существующие (`storyCard.brand`,
`rideInvite.start`, `format.*`, `domain.*`, `date.weekday.*`). `formatDistances` → `packages/i18n/src/format.ts`
(+ `km` хелпер), `apps/app/src/lib/minsk-format.ts` — реэкспорт (тесты app зелёные без правок).

### Порты владельцев

Общий хелпер `apps/api/src/changed-since.ts`:
```ts
export interface ChangedCursor { at: Date; id: string }
export interface ChangedRow { id: string; updatedAt: Date }
export function changedAfter(after: ChangedCursor | null): Filter<{ _id: string; updatedAt: Date }>; // $or keyset
export const CHANGED_SORT = { updatedAt: 1, _id: 1 } as const;
```
Каждый порт — в своём `*.port.ts`, реэкспорт в `index.ts`, провайдер `useExisting` в `*CoreModule`:

| Модуль | Порт / реализация | `ogFacts(id)` → `null`, если не… | `ogChanged(after, limit)` фильтр | Линия |
|---|---|---|---|---|
| races | `RACES_FOR_SHARING` / `RacesForSharingService` (`races-for-sharing.ts`) | `status: 'published'` → `RaceOgFacts { raceId, title, windowStartsAt, windowEndsAt, distanceKm, bikeClass, routeId: corridor?.routeId ?? null }` | `status: 'published'` | `ROUTE_GEOMETRY.displayGeometry(routeId)` в worker (`sharing`) |
| rides | `RIDES_FOR_SHARING` (+2 метода) / `RidesForSharingService` | `findPublic` + `status === 'published'` (любая фаза; скрытый/отменённый/нет — `null`, **не** 404) → `RideInviteFacts` (`routeId` — только `visible([id], null)` → `public`) | `status: 'published'` | `inviteLine(routeId)` (есть) |
| routes | `ROUTES_FOR_SHARING` / `RoutesForSharingService` (`routes-for-sharing.ts`) | `findInCatalog` + `distanceM !== null && catalog` → `RouteOgFacts { routeId, title, distanceM, elevationGainM, isLoop, city }` (без `origin`/автора) | `status: 'ready'` + `IN_CATALOG` | `ogLine(id)` → `RideRoutesService.catalogLine(id)` |
| calendar | `CALENDAR_FOR_SHARING` / `CalendarForSharingService` (`calendar-for-sharing.ts`) | `findPublished` → `CalendarOgFacts { startId, title, startsOn, endsOn, city, distancesKm }` | `status: 'published'` | нет |

Репозитории: новые методы `changedForOg(after, limit)` (проекция `{ _id: 1, updatedAt: 1 }`, `CHANGED_SORT`,
`limit`), у races — `findPublished(id)`. `ogChanged` возвращает `ChangedRow[]` (тип порта объявляет сам модуль
структурно — `sharing` их не экспортирует владельцам).

### `sharing` — файлы

| Файл | Что |
|---|---|
| `sharing.policy.ts` | + `OG_CARD_POLICY = { renderVersion: 1, pngTtlSec, pendingTtlSec: 120, failedHoldSec: 600, maxPngBytes: 2_000_000, cardsIpLimit: {300, 60}, imageIpLimit: {300, 60}, syncScanLimit: 200, syncRenderLimit: 60, jobPriority: 10, jobAttempts: 2, jobBackoffMs: 2_000, prerenderWindow: {…} }` (§8 R-A1) + чистая `ogPrerenderable(kind, facts, now)` |
| `og-card.inputs.ts` | `OgCardInput = { kind, themeId, facts }` (union по `kind`, `brand` — без фактов); `ogCardHash(input)` — sha256 hex `JSON.stringify(['og', kind, renderVersion, themeId, ...поля D2 по виду, lineRef])`, `lineRef`: race — `routeId`, ride — `routeId` (`null`, если не `public`), route — `routeId`, calendar — `null`; `ogCardVersion(hash) = hash.slice(0, 16)`. `OgCardInputs.resolve(kind, id)` / `resolveBrand()` → `{ input, hash, version } \| null` (порт + `APP_APPEARANCE.activeThemeId()`) — одна реализация для HTTP, `og.sync` и worker |
| `og-card.texts.ts` | `ogCardTexts(input)` → `{ kicker, title, facts: string[] (1–2 строки), brand }`; `ogBrandTexts()` → `{ title: app.name, tagline, brand }`. Только поля фактов — организатора/автора в типах нет |
| `og-card.render.ts` | чистые `ogCardTree(renderInput)` (корень 1200×630, `flexDirection: 'row'`: колонка текста + плитка линии `ogCard.tile`; нет трека — колонка во всю ширину) и `ogBrandTree`; `ogTitleToken(title)` — ступени по `OG_CARD_TITLE_STEPS`, `lineClamp: ogCard.titleMaxLines` |
| `og-card.png.ts` | `ogCardRenderInput(input, line)` (светлая схема темы, `storyCardColors`, `storyCardTrack(line, ogTileView())`), `renderOgCard(input, line)` / `renderOgBrand(input)` → `renderCardSvg(tree, fonts, ogCard.size)` → `renderCardPng(svg, { width: ogCard.size.width, maxBytes: OG_CARD_POLICY.maxPngBytes })` |
| `story-card.png.ts` | `renderCardSvg(tree, fonts, size = storyCard.size)`; новая `renderCardPng(svg, { width, maxBytes })`; `renderStoryCardPng(svg)` = `renderCardPng(svg, { width: storyCard.size.width, maxBytes: STORY_CARD_POLICY.maxPngBytes })` — вызовы сторис/приглашения не меняются |
| `og-card.cache.ts` | `OG_CARD_RENDER_JOB = 'og-card.render'`, `OgCardJob = z.object({ kind: z.enum([...OG_CARD_KINDS, 'brand']), id: z.string(), hash: z.string().regex(/^[0-9a-f]{64}$/) })`; ключи `og:png:<hash64>` (EX `pngTtlSec`), `og:pending:<hash64>` (NX EX `pendingTtlSec`), `og:cursor:<kind>` (JSON `{ at: ISO, id }`, без TTL), `og:sweep` (`<themeId>:<renderVersion>`). Методы: `png(hash)`, `hasPng(hash)`, `claim`, `release`, `storeReady(hash, png)` (MULTI: SET png EX + DEL pending), `holdFailed(hash)` (SET pending EX `failedHoldSec` — троттлинг самолечения после финального провала), `cursor/setCursor/resetCursors`, `sweep/setSweep` |
| `og-card.queue.ts` | `OgCardQueue.enqueue(kind, id, hash)`: `claim` NX → `queue.add(OG_CARD_RENDER_JOB, { kind, id, hash }, { jobId: 'og-card-' + hash, priority: jobPriority, attempts, backoff exponential, removeOnComplete: true, removeOnFail: true })`; сбой `add` — `release` и throw. Один код для HTTP и `og.sync` |
| `og-card.service.ts` | `meta(kind, id)` / `brandMeta()` → `{ version }` или 404; `image(kind, id, fileV)` → `{ type: 'png', png }` \| `{ type: 'redirect', version }` \| `{ type: 'fallback', png: Buffer \| null }`; непубличный — `domainError('NOT_FOUND', 404)` |
| `og-card.controller.ts` | см. ниже |
| `og-sync.ts` | `OgSync.run(now)` → `OgSyncRun { reset, brand, scanned: Record<kind, n>, enqueued, failedKinds }` |
| `og-sync.processor.ts` | `OG_SYNC_JOB = 'sync'`, `OG_SCHEDULES = [{ id: 'og.sync', repeat: { pattern: '* * * * *', tz: 'Europe/Minsk' }, job: { name: OG_SYNC_JOB } }]`, `OG_SYNC_BOOT_JOB_ID = 'og.sync.boot'`; `OgSyncProcessor` (`@Processor(QUEUE.ogSync)`, незнакомое имя — ошибка), `OgSchedules` — дословно по `standings-sync.processor.ts` |
| `story-card.processor.ts` | диспетчер **по `job.name`** (таблица имя → схема → метод; убрать `'raceId' in data`), новая `buildOgCard(job, options)`; `run()` получает приёмник `{ release, storeReady, storeFailed }` (сторис/приглашение — `StoryCardCache`, OG — `OgCardCache` с `storeFailed = holdFailed`) |
| `sharing.module.ts` | `SharingModule`: + `RacesCoreModule`, `RoutesCoreModule`, `CalendarCoreModule`; контроллер `OgCardController`; провайдеры `OgCardInputs`, `OgCardCache`, `OgCardQueue`, `OgCardService`. `SharingWorkerModule`: + те же 3 модуля, `BullModule.registerQueue({ name: QUEUE.ogSync })`, провайдеры `OgCardInputs`, `OgCardCache`, `OgCardQueue`, `OgSync`, `OgSyncProcessor`, `OgSchedules` |
| `src/queues.ts` | `ogSync: 'og-sync'` с комментарием (регламент пререндера OG, DV-1, без outbox, `concurrency` по умолчанию 1) |
| `apps/api/scripts/story-card-preview.ts` | + превью OG 4 видов (с линией/без, длинное название) и бренда — для утверждения токенов |

### Контроллер (заголовки — после чтения, как `story-card-image.controller.ts`)

- `cards`: `@UseGuards(IpRateLimitGuard) @IpRateLimit('og-card', cardsIpLimit)` — свой бакет, а не
  `public-read`: SSR ходит с одного IP web-сервера, иначе OG съедает бюджет данных страниц. Параметры —
  `OgCardParams` через pipe контракта (кривые — 400). Ответ `{ version }`,
  `@Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)` допустим (успех и ошибка — JSON).
- `images`: `@UseGuards(IpRateLimitGuard) @IpRateLimit('og-image', imageIpLimit)`; `file` — `OgImageFile` (400);
  `@Res()` Fastify-reply: `png` → 200 `image/png`, `public, max-age=86400`; `redirect` → 302,
  `Location: /v1/og/images/<kind>/<id>/<v>.png`, `public, max-age=300`, пустое тело; `fallback` с PNG → 200
  `image/png`, `no-store` (сервис уже поставил рендер своего хэша); бренд-PNG тоже нет → 404 JSON `no-store`
  (+ рендер бренда поставлен). Всем PNG: `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline; filename="pokatim.png"`.
  Непубличный — `throw domainError('NOT_FOUND', 404)` до любых заголовков (фильтр ошибок отдаёт JSON).
- Лог (только `og.sync` и процессор): вид, id, итог, байты, мс — без названия/места.

### `og.sync` — алгоритм (`OgSync.run`)

1. `sweep = themeId + ':' + OG_CARD_POLICY.renderVersion`; `og:sweep` ≠ — `resetCursors()` (DEL 4 ключей), затем
   `setSweep` (падение между — повторный сброс, безвредно). `reset: true` в итоге.
2. Бренд: `resolveBrand()` → `!hasPng` → `OgCardQueue.enqueue` (считается в лимит).
3. Для каждого вида (race, ride, route, calendar), пока `enqueued < syncRenderLimit`:
   `rows = port.ogChanged(cursor, syncScanLimit)`; по строке: `resolve(kind, id)` → `null` или
   `!ogPrerenderable(…)` или `hasPng(hash)` — пропуск; иначе `enqueue` (NX занят — тоже пропуск); `last = row`.
   Лимит рендеров исчерпан — выйти **до** обработки строки (курсор = последняя обработанная). В конце вида —
   `setCursor(kind, last)`. Ошибка вида — лог `og.sync_failed kind=<k>`, курсор этого вида не двигается, остальные
   идут; после прохода при сбоях — throw (failed-набор BullMQ, следующий прогон повторит — как `standings`).
4. Рендер — не здесь: задачи `og-card.render` с `priority` ниже задач сторис/приглашения (у тех приоритета нет;
   в BullMQ задачи без приоритета берутся раньше приоритетных — **сверить через context7** при реализации).

### Процессор `buildOgCard`

`resolve(kind, id)` (бренд — `resolveBrand`) → `null` или `hash !== job.hash` → `skipped` + `release`. Линия:
race — `routeId ? ROUTE_GEOMETRY.displayGeometry(routeId)?.line : null`; ride — `routeId ? inviteLine(routeId)`;
route — `ROUTES_FOR_SHARING.ogLine(id)`; calendar/brand — `null`. → `renderOgCard` → `storeReady`. Ошибка — ретрай;
последняя попытка — `holdFailed` + лог `og <kind> <id>: failed (<Error.name>)` (детали сообщения — нет:
`'name-only'`).

### App

- `src/lib/page-metadata.ts`: `PublicPageMetadata.image?: { url: string; alt: string }` →
  `openGraph.images: [{ url, width: OG_CARD_SIZE.width, height: OG_CARD_SIZE.height, alt, type: 'image/png' }]`,
  `twitter: { card: 'summary_large_image' }`. Нет `image` — вывод прежний (существующие `toEqual` не меняются).
- `src/lib/og-image.ts` (новый):
  - `ogOrigin()` — `WEB_ORIGIN` без хвостового `/`; нет — **никаких** OG-запросов и картинки.
  - `ogCardForSsr(kind, id)` → `fetchPublicForSsr(publicPath('/v1/og/cards/' + kind, id), OgCardMeta)`
    (невалидный id — `notFound` без запроса).
  - `brandCardForSsr()` → `fetchPublicForSsr('/v1/og/cards/brand/site', OgCardMeta)`.
  - `ogImageUrl(kind, id, version)` → `${origin}/v1/og/images/${kind}/${encodeURIComponent(id)}/${version}.png`.
  - `pageOgImage({ kind, id, page, card, alt })`: `page.notFound` → `undefined`; `page.found` и `card.found` — своя;
    иначе (`card` notFound/unavailable или `page` unavailable) — бренд (`brandCardForSsr`, лениво — запрос только
    в этой ветке); бренд недоступен — `undefined`.
  - `brandOgImage()` — для страниц-брендов.
- Страницы: `races|rides|routes|calendar/[id].tsx` — `const [page, card] = await Promise.all([xForSsr(params),
  ogOrigin() ? ogCardForSsr(kind, params.id) : skip])` (параллельно; `loader` не трогать — он читает тот же кэш
  страницы). `seasons/[id]`, `riders/[id]` — бренд при `found`/`unavailable`, нет — при `notFound`.
  `features/landing/metadata.ts` (`/welcome`, `/`), `sign-in`, `register`, `status.tsx` (перевести на
  `publicPageMetadata({ path: '/status' })` — вывод тот же) — `brandOgImage()`; `generateMetadata` становятся
  `async`. Не трогать: `forgot-password`, `auth/*/[token]` (без `og:url` по смыслу), `+not-found`, `routes/mine/[id]`.
- Alt: `t('ogCard.alt.<kind>', { title })` из данных страницы; бренд — `ogCard.alt.brand`.

### FILES TO READ

`sharing/*` (весь модуль), `standings/standings-sync.processor.ts` + `standings-schedules.test.ts`,
`devices/devices-callback.controller.ts`, `public-read.guard.ts`, `page-cursor.ts`, `rides/rides-for-sharing.ts`,
`routes/ride-routes.ts`, `routes/routes-public.service.ts`, `races/races-public.service.ts:81–180`,
`db/migrations/0036_overview_indexes.ts` + `migrations.int.test.ts`, `apps/app/src/lib/public-ssr.ts`,
`apps/app/src/__tests__/{public,route}-metadata.test.ts`, `packages/design-tokens/src/story-card.ts`.

### OUT OF SCOPE

Тёмный OG, свои картинки профиля/сезона, CDN, `api-client`, изменение сторис/приглашения и их `renderVersion`,
хранение в MongoDB, outbox-события.

### Порядок реализации (TDD, каждый шаг — красный тест → код → зелёный)

1. **Контракты, токены, i18n:** `og-card.schema.test.ts` (кривые kind/id/file, версия 16 hex); тест токенов
   (геометрия влезает); перенос `formatDistances` в i18n + `format.test.ts`; ключи `ogCard.*`.
2. **Хелпер и порты владельцев:** `changed-since` (unit); по модулю — int-тест порта на реальной MongoDB
   (`ogFacts`: опубликованный/черновик/отменённый/скрытый/вне каталога/неизвестный; `ogChanged`: порядок
   `(updatedAt, _id)`, курсор с равными `updatedAt`, `limit`, только публичные) → реализация + провайдер в
   `*CoreModule`; миграция `0037_og_sync_indexes` (+ `migrations.int.test.ts`).
3. **Входы и чистый рендер:** `og-card.inputs.test.ts` (хэш/версия), `og-card.texts.test.ts`,
   `og-card.render.test.ts`; обобщение `story-card.png.ts` — существующие `story-card.png.test.ts` и
   `ride-invite.render.test.ts` без правок зелёные; `og-card.png.test.ts` (реальный satori+resvg: 1200×630, байты
   ≤ предела).
4. **Кэш и очередь:** `og-card.cache`/`og-card.queue` — int на реальном Redis (NX, TTL, jobId, priority).
5. **Процессор:** `story-card.processor.test.ts` (диспетчер по имени) → `buildOgCard` int.
6. **HTTP:** `og-card.int.test.ts` (AC1, AC2, AC4) → сервис и контроллер, регистрация в `SharingModule`.
7. **`og.sync`:** `og-sync.processor.test.ts` (расписание) + `og-sync.int.test.ts` (AC3) → `OgSync`, `queues.ts`,
   `SharingWorkerModule`; превью-скрипт и PNG-превью человеку (утвердить токены `[ASSUMPTION]`).
8. **App:** `og-image.test.ts` → `page-metadata.ts` → страницы; правка `public-metadata`/`route-metadata` тестов
   (fetch-мок по URL).
9. Документация (§10), `TURBO_CONCURRENCY=1 pnpm check`, dev-проверка AC6 (`curl -A TelegramBot`,
   `facebookexternalhit`, картинка без входа), в `pr.md` — миграция 0037, новая очередь, замер размера PNG и оценка
   памяти Redis.

# 8. Risks / Assumptions / Open Questions

- [ASSUMPTION] Отменённые гонка и райд — бренд-картинка, без своей (страница видна, но звать некуда).
- [ASSUMPTION] Прошедшие гонки и райды — своя картинка остаётся (ссылки на результаты гонки шарят и после).
- [ASSUMPTION → решено, вариант A R-A1] TTL PNG 7 дней с продлением при выдаче; давно не запрашиваемый объект после
  TTL получает картинку при первом запросе (бренд → рендер), что приемлемо: краулер увидит бренд один раз.
- Риск: краулер сначала берёт HTML, потом картинку — до первого прогона `og.sync` (≤ 1 мин после публикации) отдаётся
  бренд. Принято: шарят обычно не в первую минуту.
- Риск: параллельная сессия «Тема пользователя» меняет SSR тем — картинка берёт глобальную активную тему
  (`APP_APPEARANCE`), не тему зрителя.
- Риск: анонимная постановка рендера — ограничена NX по хэшу и числом публичных объектов; плюс IP-лимит.

### Риски и Requirements Consistency (architect, 2026-10-29)

- **[ARCH-RISK] R-A1. Память Redis (D3 + D6). Решено человеком 2026-10-29: вариант A** (см. §3.1). Redis dev — `maxmemory 192mb`, `noeviction`: переполнение — OOM на
  запись у очередей BullMQ, лимитов и сессий всего API. D6 хранит PNG 30 дней, D3 при смене темы/`renderVersion`
  пререндерит **все** публичные объекты, включая прошедшие райды и старты; PNG старой темы недостижимы, но живут до
  TTL. Оценка (замерить на шаге 3): ~50–150 КБ × (гонки + райды + маршруты + старты) × число смен темы за 30 дней.
  Варианты:
  - **A (рекомендую, дефолт coder):** TTL PNG 7 дней со скользящим продлением при выдаче 200 (`GETEX … EX`);
    пререндер (`og.sync`) — только «живые» объекты (`ogPrerenderable`: райд — `startsAt ≥ now − 14 д`, гонка —
    `windowEndsAt ≥ now − 30 д`, старт — `(endsOn ?? startsOn) ≥ сегодня − 14 д`, маршрут каталога — все),
    остальные — самолечением при первом запросе (бренд один раз); `OG_CARD_POLICY.maxPngBytes` 300 КБ.
  - B: оставить 30 дней и полный проход, поднять `maxmemory` Redis (инфраструктура — решение человека).
  - C: PNG в MongoDB (`og_cards` с TTL-индексом) — меняет D6, нужна миграция.
- R-A2. Индексов по `updatedAt` у 4 коллекций нет → `0037_og_sync_indexes` (`{ status: 1, updatedAt: 1, _id: 1 }`,
  expand-only, идемпотентна); до её применения `og.sync` работает, но сканом. В `pr.md` — шаг деплоя.
- R-A3. Маршрут райда вошёл в каталог/вышел из него — `updatedAt` райда не меняется, `og.sync` его не пререндерит;
  `v` меняется (сразу на SSR и выдаче), первый запрос — бренд + рендер. Приватность не страдает (PNG ищется по
  текущему хэшу). Принять.
- R-A4. Keyset-курсор по `(updatedAt, _id)`: транзакция, закоммиченная позже прогона с более ранним `updatedAt`,
  пропускается — догоняет самолечение. Принять (окно — длительность транзакции, секунды).
- R-A5. `200 … public, max-age=86400` у PNG: после скрытия райда/снятия маршрута копия может жить в кэшах краулеров и
  браузеров до суток (как у сторис, ADR-0018). Новые запросы — `404` сразу.
- R-A6. Очередь `story-card` общая, `concurrency: 1`: массовый пререндер не должен задерживать опрос сторис (30 с) —
  OG-задачи с `priority` (задачи сторис — без приоритета, берутся раньше) + `syncRenderLimit` на прогон.
- R-A7. Недоопределённость D8: страница `unavailable` (API лёг) — ставим бренд (объект, возможно, есть; данные не
  раскрываются). `/status` не использует `publicPageMetadata` — перевести на него (вывод тот же).
- R-A8. AGENTS §4.11: значения токенов — из прототипов; прототипа OG нет → токены `ogCard` `[ASSUMPTION]`,
  утверждение — PNG-превью человеку (шаг 7), до мержа.
- R-A9. Отменённая гонка/райд: страница видна (`findPublic` включает `cancelled`), `cards` → `404`, SSR — бренд
  (согласуется с [ASSUMPTION] выше). Скрытый райд: страница `404` → без `og:image`.

## 8.1 Test matrix

Unit — vitest/jest без IO; int — реальные MongoDB (replica set) и Redis стенда `@rkarakulov/test-kit/mongo`,
своя БД/номер Redis на агента.

| Слой | Файл | Проверяет |
|---|---|---|
| unit contracts | `packages/contracts/src/sharing/og-card.schema.test.ts` | `OgCardKind` без `brand`; `OgCardParams` — не Uuid/лишний ключ → ошибка; `OgImageFile` — только `^[0-9a-f]{16}\.png$` (`..`, верхний регистр, 15/17 hex, `.jpg` — нет); `OgCardMeta` |
| unit tokens | `packages/design-tokens/src/og-card.test.ts` | геометрия влезает в 1200×630; ступени заголовка убывают |
| unit i18n | `packages/i18n/src/format.test.ts` | перенесённый `formatDistances` (1, 2, 3 значения, пусто) |
| unit api | `changed-since.test.ts` | фильтр keyset: `null` → `{}`; равные `updatedAt` — по `_id` |
| unit api | `og-card.inputs.test.ts` | хэш детерминирован; меняется от темы, `renderVersion`, каждого поля D2, `routeId`/`null`; **не** зависит от полей вне карточки; `version` = 16 первых hex; разные виды с одинаковыми полями — разные хэши |
| unit api | `og-card.texts.test.ts` | 4 вида: метка, 1–2 строки фактов (окно гонки по Минску через полночь UTC, класс; райд — дата, день недели, время, «Старт: …», дистанция, темп/диапазон; маршрут — км, набор (нет набора — без него), город, «Кольцо» только при петле; старт — даты/один день, город, дистанции); бренд — `app.name`, `app.tagline` |
| unit api | `og-card.render.test.ts` | дерево: с треком — две колонки, без — одна во всю ширину; ступень кегля по длине; `lineClamp` 3; бренд внизу; JSON дерева не содержит имя организатора/автора из фикстуры (AC4) |
| unit api | `og-card.png.test.ts` | реальный satori+resvg: PNG, IHDR 1200×630, байты ≤ `maxPngBytes`; вывести размер (для оценки R-A1) |
| unit api | `story-card.png.test.ts`, `ride-invite.render.test.ts` | **без правок** зелёные — сторис/приглашение 1080×1920 не изменились |
| unit api | `story-card.processor.test.ts` | диспетчер по имени: `og-card.render` → `buildOgCard`; чужая схема — `skipped`; незнакомое имя — ошибка |
| unit api | `og-sync.processor.test.ts` | `upsertJobScheduler('og.sync', {'* * * * *', Europe/Minsk}, {name:'sync'})` + boot `jobId: 'og.sync.boot'`; процессор — незнакомое имя → ошибка |
| unit api | `sharing.policy.test.ts` | `ogPrerenderable` — границы окна по видам (вариант A) |
| int api | `races/…`, `rides/…`, `routes/…`, `calendar/…-for-sharing.int.test.ts` | `ogFacts`: публичный → факты без организатора/автора; черновик, отменённый, скрытый, вне каталога (маршрут райдера `pending`, снятый), неизвестный → `null`; райд с `private`-маршрутом → `routeId: null`; маршрут снят с каталога → `routeId: null` (AC4). `ogChanged`: порядок, курсор на равных `updatedAt`, `limit`, непубличные не попадают |
| int api | `og-card.int.test.ts` (HTTP, Fastify) | **AC1**: 4 вида + бренд → `200 {version}`; непубличные → 404; кривые kind/id → 400. **AC2**: нет PNG → бренд 200 `image/png` `no-store` + задача `og-card-<hash>` с `priority` в очереди, повтор — без второй (NX); нет и бренда → 404 JSON; старая `v` → 302 `Location: /v1/og/images/<kind>/<id>/<v>.png`, `public, max-age=300`; PNG есть → 200, `public, max-age=86400`, `nosniff`, CSP; кривой `file` → 400; скрыли райд → 404 JSON (не PNG). **AC4**: райд с `private`-маршрутом и снятым маршрутом — `v` равна версии без линии; смена каталога меняет `v` → 302. IP-лимиты `og-card`/`og-image` → 429. В ответах нет `organizer*`/автора |
| int api | `og-card.processor.int.test.ts` (или в `og-card.int`) | `buildOgCard`: готово → `og:png:<hash>` с TTL ≈ политики, pending снят; хэш устарел/объект скрыт → `skipped`, PNG не пишется; последняя попытка с ошибкой → `failed`, pending удержан `failedHoldSec`; райд с `private`-маршрутом — `inviteLine` не вызывается (spy) |
| int api | `og-sync.int.test.ts` | **AC3**: новый опубликованный объект → задача без HTTP, курсор сдвинут; второй прогон — пусто; правка названия → новая задача; PNG уже есть → пропуск; черновик/скрытый — нет; `syncRenderLimit` — курсор на последнем обработанном, остаток — следующим прогоном; смена темы (порт `appearance`) или подменённый `og:sweep` → курсоры сброшены, полный проход; сбой одного вида — остальные прошли, задача падает |
| int api | `db/migrations/migrations.int.test.ts` | `0037_og_sync_indexes` последняя, 4 индекса, повторный `up` идемпотентен |
| unit app | `apps/app/src/lib/og-image.test.ts` | без `WEB_ORIGIN` — ни запросов, ни картинки; невалидный id — без запроса; страница найдена + `cards` найдено → своя `<origin>/v1/og/images/<kind>/<id>/<v>.png`; `cards` 404/недоступно → бренд; страница 404 → нет; бренд недоступен → нет; кэш 60 с — один запрос `cards` на `loader`+мету |
| unit app | `__tests__/public-metadata.test.ts`, `route-metadata.test.ts` | **AC5**: fetch-мок по URL; гонка/райд/старт/маршрут — `openGraph.images[0]` = `{ url абсолютный WEB_ORIGIN, width 1200, height 630, alt, type 'image/png' }`, `twitter.card = 'summary_large_image'`; не найдено — без `images`; сезон, райдер, `/welcome`, `/`, вход, регистрация, `/status` — бренд; прежние ожидания без `WEB_ORIGIN` — без изменений |
| e2e web | `apps/app/e2e/web.spec.ts` | желательно, под `E2E_API=1`: `/welcome` — `<meta property="og:image" content="${BASE_URL}/v1/og/images/brand/site/<16hex>.png">` и `twitter:card` (картинку не запрашивать: worker в смоуке не гарантирован). Без API — новых проверок нет. Обязательной e2e нет: SSR-мета покрыта unit app, выдача — int api |
| manual dev | AC6 | `curl -A TelegramBot` / `facebookexternalhit` по 4 видам и `/welcome` — `og:image`; картинка `200 image/png` без входа; скрытый райд — 404 |

## 8.2 Отклонения от плана (coder, 2026-10-29)

- **Тема картинки — «Классика» (`OG_THEME_ID = DEFAULT_APP_THEME_ID`), а не «активная тема» `APP_APPEARANCE`.** Код
  сверялся по `6fe3a767`; на `develop` @ `0ab5a08a` влит user-theme (ADR-0021): глобальной активной темы больше нет
  (`appearance` — только декор, `GET /v1/appearance` отдаёт `classic` константой), гость — «Классика». OG видят гости и
  краулеры → тема гостя. Тема по-прежнему входит в хэш и в отметку `og:sweep`, поэтому смена `OG_THEME_ID` — одна
  правка с полным проходом. Вопрос оркестратору: подтвердить (альтернатива — тема создателя объекта; у гонок и стартов
  создателя-райдера нет).
- `ogCard.tile.startDot/startRing` не заведены: точка старта линии — общий `trackSvg` сторис (`storyCard.line`).
- Область контента OG — вложенный блок `size − 2 × inset`, а не `padding` корня: у satori `padding` прибавляется к
  `width` (первое превью вылезало за кадр).
- Фикстуры OG-тестов и превью — `apps/api/test/og-fixtures.ts`, сиды гонок/стартов — `apps/api/test/og.ts`.
- `/status` переведён на `publicPageMetadata` (вывод прежний) — как и предполагал план.

## 8.3 Security checklist

- **AuthN/AuthZ:** эндпоинты публичные; видимость — предикаты владельца в порту (`ogFacts` → `null` для непубличного).
- **Входные данные:** `kind` — enum, `id` — `Uuid` (бренд — литерал `site`), `file` — `^[0-9a-f]{16}\.png$`.
- **Данные наружу:** только публичные поля страницы; без организатора, автора, описания, ПДн, `private`-линии.
- **Злоупотребления:** IP-лимиты, NX по хэшу, пачка `og.sync` ограничена, PNG ≤ 2 МБ.
- **Кэш:** `public` только у PNG текущей версии; бренд-заглушка — `no-store`; 404 — JSON без кэша картинки.
- **Логи:** вид, id, итог, байты, мс — без названий и мест.

# 9. Acceptance Criteria

- AC1. `GET /v1/og/cards/<kind>/<id>`: публичный объект → `200 { version }` (16 hex); непубличный/неизвестный →
  `404`; кривые параметры → `400`. Бренд → `200`.
- AC2. `GET /v1/og/images/...`: текущая версия и PNG есть → `200 image/png` 1200×630; старая `v` → `302` на текущую;
  нет PNG → бренд-PNG `no-store` и задача `og-card.render`; непубличный → `404`.
- AC3. `og.sync`: новый/изменённый публичный объект получает PNG без внешнего запроса; смена темы или
  `renderVersion` → полный проход; скрытие/снятие → `404` на картинку.
- AC4. Приватность: райд с `private`-маршрутом и маршрутом, снятым с каталога, — без линии; отменённые/черновики — без
  своей картинки; в разметке нет организатора и автора.
- AC5. SSR: страницы D1 отдают `og:image` (абсолютный, `WEB_ORIGIN`), `og:image:width/height`, `twitter:card`;
  не найдено — без `og:image`; бренд — на страницах-брендах.
- AC6. `TURBO_CONCURRENCY=1 pnpm check` зелёный; на dev `curl -A TelegramBot` и `facebookexternalhit` видят
  `og:image`, картинка отдаётся без входа.

# 10. Documentation Impact

ADR-0018 — дополнение «OG-картинки»; `.claude/rules/onbike-*`/`pokatim-*` с разделом sharing — эндпоинты и правило
`renderVersion`; `docs/product/` — решения D1–D4 (закрывают отложенные Q14/Q17).

Дополнительно (architect): `.claude/rules/pokatim-backend.md` — раздел «Карточки» (OG: эндпоинты, порты
`*_FOR_SHARING` владельцев, очередь `og-sync`, ключи `og:*`, правило «изменил разметку/тексты/токены `ogCard` —
подними `OG_CARD_POLICY.renderVersion`»); `.claude/rules/pokatim-db.md` — индексы `0037_og_sync_indexes`;
`.claude/rules/pokatim-app.md` — `og-image.ts` и правило `og:image` публичных страниц; `docs/runbooks` — превью
OG (`preview:story-cards`); `pr.md` — миграция 0037, новая очередь, замер PNG и оценка памяти Redis (R-A1).

# 11. Review

# 12. Outcome (заполняет coder)

### Changes

- `packages/contracts`: `sharing/og-card.schema.ts` — `OG_CARD_KINDS`/`OgCardKind`, `OG_BRAND`, `OgCardVersion`,
  `OgCardMeta`, `OgCardParams`, `OgImageFile`, `OG_CARD_SIZE`.
- `packages/design-tokens`: `og-card.ts` — `ogCard` (1200×630, поля 72/64, плитка 440×502, кегли) и
  `OG_CARD_TITLE_STEPS` (34/60 символов).
- `packages/i18n`: `ogCard.*` (метки, «Кольцо», набор, темп, склейка, alt); `formatDistances` и `formatKm` перенесены
  в `format.ts` (app — реэкспорт из `minsk-format.ts`).
- `apps/api`: `changed-since.ts` (keyset `(updatedAt, _id)`); порты `RACES_FOR_SHARING`, `ROUTES_FOR_SHARING`,
  `CALENDAR_FOR_SHARING` (новые), `RIDES_FOR_SHARING.ogFacts/ogChanged` (+ `changedForOg` в 4 репозиториях,
  `RacesRepository.findPublished`); миграция `0037_og_sync_indexes`; `sharing`: `OG_CARD_POLICY` (вариант A) +
  `ogPrerenderable`, `og-card.{inputs,texts,render,png,cache,queue,service,controller}.ts`, `og-sync.ts`,
  `og-sync.processor.ts` (очередь `og-sync`), `StoryCardProcessor` — диспетчер по имени задачи и `buildOgCard`,
  `renderCardSvg(size)`/`renderCardPng` (сторис и приглашение — прежние байты, их `renderVersion` не тронут);
  превью `preview:story-cards <каталог> [og]`.
- `apps/app`: `lib/og-image.ts`, `publicPageMetadata({ image })` (`og:image` 1200×630 + `twitter:card`); своя
  картинка — `races|rides|routes|calendar/[id]` (версия параллельно с данными); бренд — `/welcome`, `/`, `sign-in`,
  `register`, `status` (переведён на `publicPageMetadata`), `seasons/[id]`, `riders/[id]`.
- Документация: ADR-0018 (дополнение «OG-картинки»), `.claude/rules/pokatim-{backend,db,app}.md`,
  `docs/product/races-and-seasons.md` (Q14/Q17), `docs/runbooks/local-dev.md` (превью и worker).

### Tests

- unit: `og-card.schema.test.ts`, `design-tokens/og-card.test.ts`, `i18n/format.test.ts` (`formatDistances`),
  `changed-since.test.ts`, `sharing.policy.test.ts`, `og-card.{inputs,texts,render,png}.test.ts` (PNG 1200×630, замер
  20–50 КБ), `story-card.processor.test.ts` (+ OG-ветка), `og-sync.processor.test.ts`; `story-card.png.test.ts` и
  `ride-invite.render.test.ts` — без правок, зелёные.
- int (MongoDB replica set + Redis): `{races,rides,routes,calendar}/*-for-sharing.int.test.ts`,
  `og-card.int.test.ts` (AC1, AC2, AC4, процессор, IP-лимиты, продление TTL), `og-sync.int.test.ts` (AC3),
  `migrations.int.test.ts` (`0037`).
- app (jest): `lib/og-image.test.ts`, `__tests__/public-metadata.test.ts` и `route-metadata.test.ts` (fetch-мок по
  URL, AC5; прежние ожидания без `WEB_ORIGIN` не менялись).
- Превью PNG (11 вариантов: гонка с линией/длинная/анонс, райд без линии/длинный/с линией, маршрут, длинный маршрут,
  старт, длинный старт, бренд) просмотрены: текст не обрезан и не вылезает, линия в плитке.

### Checks

- `TURBO_CONCURRENCY=1 pnpm check` (изолированные `MONGO_URL_TEST=…/pokatim_og_test`, Redis на своём порту) —
  **зелёный**: `Tasks: 15 successful, 15 total`; api 177 файлов, app 217 наборов / 2030 тестов, admin 38. Первый прогон
  упал на таймауте 20 с чужого `results-revisions.int.test.ts` (load average ~15, модуль не тронут) — точечный
  повтор зелёный, повторный полный прогон — зелёный.

### Open follow-ups

- Подтвердить тему OG «Классика» (§8.2) — до мержа.
- Утверждение токенов `ogCard` `[ASSUMPTION]` по превью — человек (R-A8).
- AC6 на dev (`curl -A TelegramBot` / `facebookexternalhit`) — после деплоя; e2e `web.spec.ts` под `E2E_API=1` не
  добавлялся (необязательный).
- `pr.md`: миграция `0037_og_sync_indexes` — шаг деплоя; новая очередь `og-sync`; замер PNG 20–50 КБ → память Redis
  ≈ 50 КБ × («живые» объекты + запрошенные за 7 сут.), × 2 на неделю после смены `renderVersion` (1000 объектов ≈
  50 МБ — оценка сверху).
- Своя картинка профиля райдера и сезона, тёмный шаблон — следующий слайс.
