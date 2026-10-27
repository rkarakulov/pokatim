# routes-06 — публикация своих маршрутов в каталог с модерацией (UGC)

Уровень: task3. Ветка `feature/routes-06-ugc` от `origin/develop`. Связано: `docs/product/routes.md` (каталог D1–D4,
«Мои маршруты» M1–M4), `docs/tasks/2026-10-27-routes-02-my-routes/task.md` (изоляция `origin`, RC-2),
`docs/tasks/2026-10-27-app-05b-rides-moderation/task.md` (образец жалоб и модерации), `docs/product/account.md` (A7),
`docs/product/admin-panel.md` (права), `docs/product/profile.md` (публичное имя).

## 1. Title

Райдер подаёт свой готовый маршрут в каталог. Модератор одобряет или отклоняет его с причиной в панели «Протокол».
Одобренный маршрут виден в каталоге с бейджем «От райдера». На него можно пожаловаться; модератор может его скрыть.

## 2. Goal

Сейчас каталог состоит только из маршрутов команды, а маршруты райдеров (routes-02) приватны. Райдеры знают хорошие
местные маршруты. Слайс даёт им путь в каталог под премодерацией: в каталог не попадает непроверенная линия (старт и
финиш часто у дома), мусор и оскорбительные названия.

## 2.1 Продуктовые решения (human gate, пользователь, 2026-10-27)

| # | Вопрос | Решение |
|---|---|---|
| U1 | Модерация | **премодерация**: заявка → очередь → одобрение → каталог |
| U2 | Кто модерирует | новое право `routes.moderate` — admin и moderator (organizer — нет); своя очередь в модуле `routes` |
| U3 | Что видно в каталоге | бейдж «От райдера» всегда; имя автора — только если при подаче отмечено «Подписать моим именем»: текущее публичное имя из профиля (нет имени — только бейдж) |
| U4 | Фильтр | группа «Автор»: «Команда» / «Райдеры» (ИЛИ внутри, И между группами, как остальные) |
| U5 | Причины | два справочника. Отклонение: опасный маршрут, непроезжий или неточный, дубль, неподходящее название, не велосипедный маршрут, другое; комментарий автору ≤ 500. Жалоба: опасный, непроезжий, частная или закрытая территория, оскорбительное название, спам, другое; комментарий ≤ 500 |
| U6 | Удаление маршрута / аккаунта | маршрут удаляется отовсюду насовсем (A7 без изменений); в окне удаления опубликованного — предупреждение «Маршрут исчезнет из каталога». Снять с публикации автор может и без удаления |
| U7 | Маршрут райдера в гонке | **нет**: коридор — только маршрут команды (`origin: 'platform'`) |
| U8 | Лимиты | ≤ 3 заявок на рассмотрении одновременно; ≤ 10 подач в сутки; один маршрут — не больше 3 подач; жалобы — ≤ 20 в сутки, одна от райдера на маршрут |
| U9 | «Поделиться», OG | одобренный маршрут — обычная карточка `/routes/<id>`: «Поделиться», «Скачать GPX», SSR, OG без ПДн (имени автора в OG нет); в «Моих» у опубликованного — «Открыть в каталоге» |

### Допущения оркестратора (`[ASSUMPTION]`, в docs/product/routes.md)

- **A1 — состояния публикации** маршрута райдера: нет → `pending` (на проверке) → `approved` (в каталоге) |
  `rejected` (с причиной); `approved` → `hidden` (скрыт модератором) → `approved` («Вернуть»). Автор может отозвать
  заявку (`pending` → нет) и снять с публикации (`approved` → нет). `hidden` для автора терминален: снова подать нельзя
  (только удалить); переименование в `hidden` разрешено (маршрут не публичен).
- **A2 — заявка:** только готовый маршрут (`ready`); город старта (справочник) и покрытие (как в панели D2),
  галочка «Подписать моим именем», предупреждение «Линия, старт и финиш станут видны всем». Модератор при одобрении
  может поправить город и покрытие.
- **A3 — название заморожено** в `pending` и `approved` («Сначала снимите с публикации»); геометрия неизменна и так.
- **A4 — жалобы** — только на маршруты райдеров в каталоге (маршруты команды публикует сама команда). Автор на свой
  не жалуется. Жалоба — вошедшему; гость кнопки не видит. Одна жалоба от райдера на маршрут навсегда (повтор — успех
  без второй записи).
- **A5 — модерация:** очередь «На проверке» (старые сверху), «Жалобы» (маршруты с открытыми жалобами, новые
  сверху), «Скрытые». Действия с записью в журнал панели: одобрить, отклонить с причиной, скрыть с причиной
  (открытые жалобы закрываются), вернуть, отклонить жалобы. Автоскрытия по числу жалоб нет.
- **A6 — уведомления:** решение по заявке (одобрено / отклонено) — событие outbox для модуля уведомлений; пока
  модуля нет, автор видит статус в «Моих».
- **A7 — кэш:** публичная карточка кэшируется до 60 с — скрытый или снятый маршрут может быть виден до минуты (как
  RC-13 каталога).

## 3. Scope

- **contracts (`routes`):** статус публикации, причины отклонения и жалобы (`tolerantEnum` в ответах приложения),
  заявка (`city`, `surfaces`, `showAuthorName`), `MyRoute.publication`, автор в карточке каталога
  (`author: { kind: 'team' } | { kind: 'rider', name: string | null }`), фильтр `author` в `CatalogRouteQuery`,
  жалоба (`reason`, `comment`), viewer-ответ карточки (`canReport`, `reported`), схемы панели очереди модерации
  и действий; право `routes.moderate`.
- **api (`routes`):**
  - данные: публикация маршрута райдера (поле `RouteDoc.publication` или отдельная коллекция — решает architect),
    коллекция жалоб на маршруты, индексы очередей; миграция expand-only;
  - приложение: подать заявку, отозвать / снять с публикации, статус в «Моих» (в списке и карточке); жалоба и
    viewer-состояние карточки; каталог включает одобренные маршруты райдеров (бейдж, имя по U3), фильтр «Автор»;
    публичная карта/GPX/карточка одобренного маршрута райдера — без кэша геометрии портов;
  - панель: очередь модерации (три списка), карточка заявки с картой и профилем (переиспользовать данные routes-05
    `PanelRoute`), действия с причиной и журналом панели, право `routes.moderate`;
  - outbox: событие «решение по заявке» (approved / rejected, только id маршрута и автора);
  - удаление маршрута и аккаунта: каскад удаляет и публикацию, и жалобы на маршрут; жалобы удалённого райдера —
    как у `ride_reports` в PR #62;
  - лимиты U8 (RateLimiter + счётчики).
- **api-client:** методы приложения и панели.
- **admin:** раздел «Маршруты райдеров» (право `routes.moderate`): вкладки «На проверке / Жалобы / Скрытые»,
  страница заявки — карта и профиль из routes-05, цифры, город/покрытие (правка при одобрении), автор `Райдер ·{id}`
  (без ПДн), жалобы (без автора жалобы), действия с причиной, обработка конфликтов (заявку уже решили — обновить).
- **app:** в «Моих» — «Опубликовать» (экран заявки: город, покрытие, галочка имени, предупреждение), статус заявки
  в списке и карточке (на проверке / в каталоге / отклонён: причина и комментарий / скрыт модератором), «Отозвать
  заявку», «Снять с публикации», «Открыть в каталоге»; предупреждение при удалении опубликованного; в каталоге —
  бейдж «От райдера» и имя; фильтр «Автор»; на карточке маршрута райдера — «Пожаловаться» (экран: причина,
  комментарий) и «Вы пожаловались на этот маршрут». UI минимальный, на компонентах и токенах дизайн-системы.
- **i18n:** новые ключи, существующие не менять.
- **docs:** `docs/product/routes.md`, `docs/product/admin-panel.md` (право), `pokatim-security.md` при необходимости.

## 4. Out of Scope

- Постмодерация, автоскрытие по жалобам, жалобы на маршруты команды.
- Перевод маршрута райдера в маршрут команды, маршрут райдера в гонке (U7).
- Правка геометрии и обрезка концов перед публикацией.
- Push/e-mail уведомления — только событие outbox (A6); потребитель — модуль уведомлений.
- Рейтинги, лайки, комментарии, профиль автора.

## 5. Architecture Context

Заполняет architect (§11). Инварианты, которые нельзя нарушить:
- фильтры `origin: 'platform'` портов гонок (`findReady`, `routesByIds`, `RouteCatalog`, `RouteGeometry`, кэши) и
  списка панели «Маршруты» **не меняются**;
- в каталог (список, города, карточка, карта, GPX, «Гонки на маршруте») маршрут райдера попадает **только** в
  состоянии `approved`; «Мои» остаются приватными для всех прочих состояний;
- кэш геометрии `RoutesCatalogService` не хранит маршруты райдера (их можно удалить).

### Решение architect (2026-10-27)

**Модель — встроенное поле `RouteDoc.publication`, а не отдельная коллекция.** Причины: все переходы — атомарная
запись одного документа `routes` (`findOneAndUpdate` с состоянием и `publication.version` в фильтре); каскад удаления
маршрута удаляет и публикацию; каталог переиспользует существующие `routes.catalog` и частичный индекс
`routes_catalog_idx` без второго запроса; конкурирующие действия автора, модератора и жалобы конфликтуют по одному
документу (как `rides` в 05b).

- `routes.catalog` у маршрута райдера заполнен **тогда и только тогда, когда** `publication.status = 'approved'`
  (пишут одной операцией одобрение и «Вернуть»; снимают — скрытие, отзыв автора, снятие с публикации). Прежний
  инвариант routes-02 «у маршрута райдера `catalog` всегда `null`» заменяется этим.
- Граница приватности остаётся в `RoutesRepository` (одно место):
  - `CATALOG_PUBLISHED = { 'catalog.publishedAt': { $type: 'date' } }` — условие частичного индекса;
  - `IN_CATALOG = { ...CATALOG_PUBLISHED, $or: [{ origin: 'platform' }, { origin: 'rider', 'publication.status':
    'approved' }] }` — **единственное** условие публичного каталога (список, города, карточка, карта, GPX) — защита в
    глубину: маршрут райдера без `approved` не пройдёт, даже если `catalog` записан по ошибке;
  - `findPublished` (порт `RouteCatalog.inCatalog`, «Гонки на маршруте»), `findReady`, `routesByIds`, `listVisible`,
    `RoutesCatalogService` (оба LRU-кэша) — **без изменений** (`origin: 'platform'`);
  - новый `findInCatalog(id)` = `{ _id, status: 'ready', ...IN_CATALOG }` — для `RoutesPublicService.get|gpx|map`.
- Публичная карта: `RoutesPublicService.map` — маршрут команды через порт `ROUTE_GEOMETRY` (кэш), маршрут райдера —
  `displayGeometryOf(route, repository.displayLine(id))` без кэша (как `MyRoutesService.map`). GPX и профиль — уже без
  кэша (`exportGpx`, `derivedOf`).
- «Гонки на маршруте» (`GET /v1/routes/:id/races`, модуль `races`) для маршрута райдера — `404` (порт не меняется,
  U7: гонок по нему нет); приложение для `author.kind = 'rider'` этот запрос не делает (8.1 RC-1).
- Имя автора — порт `profile` `RIDER_NAMES.attributionNames(userIds)` (новый метод: `publicName` — строка, **без**
  условия `showNameInResults`; согласие — `publication.showAuthorName`), читается на каждом запросе каталога
  (не снимок): смена/сброс имени модератором видны в течение кэша 60 с. `RoutesModule` импортирует
  `ProfileCoreModule` (цикла нет: `profile` не зависит от `routes`).
- Жалобы — коллекция `route_reports` (образец `ride_reports`), единственный писатель `RouteReportsRepository`;
  счётчики очереди — в `publication` (`openReportCount`, `lastReportAt`).
- Действия автора (подать, отозвать/снять) — одна атомарная запись `routes` без транзакции, без журнала панели
  (правило routes-02: действия райдера в `PanelAudit` не пишутся). Действия модератора — `MongoTransactions.run`:
  **первой** — условная запись `routes` (по `publication.version`), затем `route_reports.closeOpen` (скрыть/отклонить
  жалобы), `PanelAudit.append`, outbox (одобрить/отклонить). Жалоба — транзакция: первой — запись `routes`
  (`$inc openReportCount`, `$max lastReportAt`), затем вставка жалобы (гонка «жалоба ↔ скрыть» — write conflict).
- Outbox `routes.publication-decided` — **без маршрута в очередь** (как `disputes.*`, `results.protocol-published`):
  публикатор базы берёт только типы из `routes` (`type: { $in }`), событие остаётся `publishedAt: null`, ошибок и задач
  нет. Защита от «залпа» старых решений при подключении модуля уведомлений — `decidedAt` в payload + правило в
  `pokatim-backend.md` (8.1 RC-3).

## 5.1 Placement & Reuse Gate

- Reuse: образец 05b (`ride_reports`, `rides-moderation.*`, причины, журнал панели, конфликт «пришла новая
  жалоба»); `RateLimiter`; справочник городов и покрытий routes-01; `PanelRoute`/страница маршрута панели routes-05
  (карта, профиль, SVG-превью); порт имён `profile` (новый метод — только через `modules/profile/index.ts`);
  app: `route-list-card`, экраны «Моих», `route-map`, экран жалобы на райд как образец.
- Запрещено: дублировать каталожный запрос для райдеров отдельной веткой без условия `IN_CATALOG`; читать маршруты
  райдера в портах гонок; копировать компоненты карты/профиля панели.
- Тонкие контроллеры; чужой модуль — только через `index.ts`.

Решение architect по placement:
- Всё серверное — в модуле `routes` (своя очередь модерации, U2): новый пакет не нужен (потребитель контрактов —
  api, app, admin уже через `@pokatim/contracts`). Чужие модули — только `profile/index.ts` (`RIDER_NAMES`),
  `panel/index.ts`, `identity/index.ts`. `races`, `results`, `account` не меняют импортов (`account` уже вызывает
  `RouteErasure`).
- Панель: страница заявки переиспользует блок «карта + цифры + профиль» routes-05 — вынести `ReadyRoute` из
  `RouteScreen.tsx` в `features/routes/RouteReadyView.tsx` (тип пропсов — `Pick<PanelRoute, …>` + `surfaces`),
  `RouteLine` — сузить тип пропса до `Pick<PanelRoute, 'title' | 'distanceM' | 'elevationGainM' | 'isLoop' |
  'line'>`. Копий карты/профиля нет.
- Приложение: экран заявки и жалобы — по образцу `features/rides/ride-report.tsx`; бейдж и фильтр — в существующих
  `route-list-card.tsx`, `filters.ts`, `route-feed.tsx`. Общего UI-компонента в app-foundation не требуется
  (бейдж — существующий `Chip`/`Tag` дизайн-системы; если нужного варианта нет — стоп, задача в app-foundation).

## 6. Relevant Files

API (`apps/api/src`):
- `modules/routes/routes.repository.ts` — граница приватности (`PLATFORM`, `ownRider`, `IN_CATALOG`), каталог,
  `renameOwn`, `deleteOwn`, `ownIds`.
- `modules/routes/routes.collection.ts` — `RouteDoc`, `RouteCatalogDoc`.
- `modules/routes/route-catalog.ts` — `RoutesCatalogService` (порты, LRU-кэши), `displayGeometryOf`.
- `modules/routes/routes-public.service.ts`, `routes-public.controller.ts` — публичный каталог.
- `modules/routes/my-routes.service.ts`, `routes-mine.controller.ts` — «Мои» (`toMyRoute`, `rename`, `delete`).
- `modules/routes/routes-catalog-admin.service.ts`, `routes-admin.controller.ts`, `routes.service.ts` (`visible`,
  `view`) — панель маршрутов команды (не менять поведение).
- `modules/routes/route-erasure.ts` — стирание аккаунта; `routes.events.ts` — события; `routes.policy.ts` — лимиты;
  `routes.module.ts` — порядок контроллеров (`RoutesMineController` первым).
- `modules/rides/{ride-reports.service,ride-reports.repository,ride-reports.collection,rides-moderation.service,
  rides-moderation.controller}.ts` — образец жалоб/модерации; `ride-reports.repository.test.ts` — сторож писателя.
- `modules/profile/{rider-names.port,rider-names,profile.repository,profile.module,index}.ts` — порт имён.
- `modules/panel/{permissions.ts,index.ts}` — права, `PanelGuard`, `PanelAudit`.
- `modules/races/races-public.controller.ts` — `GET /v1/routes/:id/races` (не меняется, проверить 404 для райдера).
- `modules/account/account-erasure.int.test.ts` — расширить; `worker.module.ts` — маршруты outbox (не добавлять).
- `db/migrations/{0020_routes_catalog,0017_ride_reports,index}.ts`, `admin-routes.test.ts`, `error-messages.ts`.

Контракты: `packages/contracts/src/routes/{route.schema,my-route.schema,route-catalog.schema}.ts`,
`rides/{ride-report,ride-moderation}.schema.ts` (образец), `admin/{permissions,audit}.schema.ts`, `common.ts`
(`ErrorCode`, `tolerantEnum`), `index.ts`. Клиент: `packages/api-client/src/{index,admin}.ts`. Строки:
`packages/i18n/src/ru.ts`.

Admin: `apps/admin/src/{navigation.ts,router.tsx}`, `features/routes/{RouteScreen,RoutePreview,ElevationProfile,
RoutesScreen,route-detail-format}.tsx`, `features/rides-moderation/*` (образец вкладок, диалогов, конфликтов).

App: `apps/app/src/app/{(tabs)/routes.tsx,routes/[id].tsx,routes/mine/[id].tsx,rides/report/[id].tsx,_layout.tsx}`,
`features/routes/{route-detail,route-feed,my-route-detail,my-route-feed,queries,my-routes-queries,filters,format,
error-messages}.ts(x)`, `components/route-list-card.tsx`, `features/rides/ride-report.tsx` (образец),
`__tests__/{routes,route-detail,my-routes,ride-report,route-metadata,app-routes}.*`.

## 7. Implementation Notes

- TDD; негативные int-тесты обязательны (§9).
- Тесты — изолированно: `MONGO_URL_TEST` на 127.0.0.1:27117 со своей БД, `REDIS_URL_TEST=redis://127.0.0.1:6479/<N>`,
  `TURBO_CONCURRENCY=1 pnpm check`.

## 8. Risks / Assumptions / Open Questions

- ПДн: линия старта/финиша у дома — премодерация + предупреждение (U1, A2). Имя автора — только по галочке (U3).
- Публичный кэш 60 с (A7).
- Гонка счётчика «≤ 3 на рассмотрении» при параллельных подачах — architect решает, нужна ли строгость.

## 8.1 Requirements Consistency (заполняет architect)

BLOCKERS нет. Находки (решения architect; U1–U9 и A1–A7 не пересматриваются):

- **RC-1 «Гонки на маршруте» у маршрута райдера.** Порт `RouteCatalog.inCatalog` — в списке неизменных (§5), он видит
  только `platform`, значит `GET /v1/routes/:id/races` для одобренного маршрута райдера ответит `404`.
  Варианты: (а) порт не трогать, приложение не запрашивает гонки при `author.kind = 'rider'` (по U7 их и нет);
  (б) расширить `inCatalog` на `approved` — пустой список, но меняется порт гонок; (в) отдельный метод для races.
  **Рекомендация — (а)**: инвариант цел, старое приложение на 404 блок просто скрывает (`RouteRaces` → `null`).
- **RC-2 Согласие на имя.** Профиль называет поле «Как вас показывать в результатах», согласие `showNameInResults`
  журналируется (`profile_consent_events`). U3 берёт `publicName` без этого согласия, согласие — галочка заявки.
  Варианты: (а) согласие хранится в `publication.showAuthorName` + `submittedAt` (доказательство — сама заявка;
  удаляется вместе с маршрутом), журнал не нужен; (б) писать событие в `profile_consent_events` — запись `routes` в
  коллекцию `profile`, нарушение границ; (в) требовать ещё и `showNameInResults` — противоречит U3.
  **Рекомендация — (а)**. Подпись поля в профиле («…в результатах») — follow-up текста, не в этом слайсе.
- **RC-3 Событие outbox без маршрута.** Издатель базы (`MongoOutboxPublisher.publishBatch`) выбирает `publishedAt:
  null, type ∈ маршрутов` по `outbox_unpublished_idx { createdAt }`: событие без маршрута не публикуется и не падает,
  но (1) лежит вечно и сканируется каждым проходом (как уже `disputes.*`, `results.*`), (2) при подключении модуля
  уведомлений весь хвост уйдёт залпом — авторы получат уведомления о давних решениях. Варианты: (а) событие без
  маршрута + `decidedAt` в payload + правило для слайса уведомлений «перед добавлением маршрута — миграция,
  помечающая хвост `publishedAt`, или потребитель пропускает события старше 7 дней»; (б) не писать событие до модуля
  уведомлений — расходится с A6 и AC 2/3; (в) маршрут в очередь `route-processing` с no-op обработчиком — «на вырост»
  и лишний код. **Рекомендация — (а)**; правило — в `pokatim-backend.md`.
- **RC-4 Жалобы после снятия/повторной подачи.** A5 не говорит, что с открытыми жалобами, если автор снял маршрут.
  Решение: снятие/отзыв жалобы не закрывают (закрывают только «Скрыть» и «Отклонить жалобы»); очередь «Жалобы» — только
  `publication.status = 'approved'` (остаточный фильтр); на странице заявки модератор видит прежние жалобы; после
  нового одобрения маршрут с открытыми жалобами снова в очереди. Удаление маршрута удаляет жалобы (U6).
- **RC-5 Удаление жалоб vs append-only.** `ride_reports` — «удалений нет». U6 требует удалить жалобы вместе с
  маршрутом. Решения модерации остаются в append-only `panel_audit` (с `label` = название на момент действия — как
  у райдов, A9). Решение: `route_reports` — то же исключение, что `ride_reports`, плюс единственное удаление —
  `deleteForRoute` в транзакции удаления маршрута (сторож-тест писателя). Жалобы **удалённого жалобщика** хранятся
  (как `ride_reports`, PR #62).
- **RC-6 Индексация UGC.** `pokatim-security.md`: UGC-карточка райда — всегда `robots: noindex`. U9 говорит «обычная
  карточка, SSR, OG», про индексацию не говорит. Варианты: (а) маршрут райдера — `noindex` (OG и SSR остаются);
  (б) индексировать как маршрут команды. **Рекомендация — (а)** (единое правило UGC; название — текст райдера).
- **RC-7 Гонка лимита «≤ 3 на проверке».** Счёт `countDocuments` до записи — условие по другим документам. Строгость
  потребовала бы документ-замок райдера в чужом модуле. Решение: принятая гонка (превышение не больше числа
  параллельных запросов, их режет лимит 10/сут), комментарий в репозитории — как квоты `rides`.
- **RC-8 Что считается «подачей» для лимитов U8.** Решение: 10/сут и 3 на маршрут считают **успешные** подачи; лимит
  частоты `routes-publication-submit:<uid>` списывается после проверок состояния, прямо перед записью (отказ 409 квоту
  не тратит). «3 подачи на маршрут» — `publication.submissionCount` (не сбрасывается отзывом и снятием).
- **RC-9 Смена галочки имени после одобрения** — только «Снять с публикации» и новая подача (тратит подачу). v1 —
  принимаем; отдельное действие «подпись» — follow-up.
- **RC-10 Видимость заявки модератору.** Модератор видит маршрут райдера только в `pending | approved | rejected |
  hidden`; никогда не подававшийся и отозванный/снятый (`withdrawn`) — `404` (автор не дал или забрал согласие на показ
  линии). Действие по отозванной за время просмотра заявке — `404` → в панели «Заявку уже изменили — обновите
  страницу».
- **RC-11 Старые версии приложения.** Видят маршруты райдеров в каталоге без бейджа и без «Пожаловаться»;
  переименование `pending`/`approved` получают как общую ошибку (409); удаление опубликованного — без предупреждения.
  Данные и права не страдают — принимаем (новые поля ответа — с `default`, старые клиенты их отбрасывают).
- **RC-12 Главная.** Герой «последний опубликованный маршрут» — запрос каталога: им может стать маршрут райдера.
  Бейджа на Главной в scope нет — принимаем как есть (follow-up по прототипу при необходимости).

## 8.2 Deviations from spec

Этап A (coder, 2026-10-27):
- **Правки вне зоны этапа A ради typecheck контрактов:** `packages/i18n/src/ru.ts` — пять ключей
  `admin.audit.action.route.submission_approved|submission_rejected|rider_hidden|rider_restored|rider_reports_dismissed`
  (`AuditScreen` панели строит ключ из `AUDIT_ACTIONS`); фикстуры тестов приложения (7 файлов `apps/app/src/**/*.test.*`) —
  поля `author: { kind: 'team' }` и `publication: null`, `canPublish: false` (выходные типы схем стали обязательными).
  Поведение приложения и панели не менялось; прочие ключи i18n — этапы B и C.
- `publication.version` первой подачи — `0` (дальше `+1` на каждый переход, включая повторную подачу и отзыв).
- 409 `ROUTE_INVALID_STATE` действий **панели** — без `details` (как routes-01); `details.reason` — у действий автора и
  жалобы. «Отклонить жалобы» без открытых жалоб — 409 `ROUTE_INVALID_STATE` (§11).
- Гонка «одобрение ↔ отзыв»: оба запроса могут закончиться успехом последовательно (одобрение, затем снятие) — тест
  проверяет согласованный исход (`withdrawn`, `catalog: null`, журнал одобрения только при 200), а не «ровно один 200».
- N3 — в `routes-admin.int.test.ts` (список в обоих режимах, `GET :id`, `publish`/`unpublish` панели, порты);
  `routes-catalog-admin.int.test.ts` не менялся.
- Текст сообщения `ROUTE_INVALID_STATE` в `error-messages.ts` («Маршрут ещё не готов») не менялся — клиенты различают по
  `details.reason`.

Этап B (coder, 2026-10-27):
- `ConflictBanner` (`src/ui`) — необязательные `title`/`message` (по умолчанию прежний текст): раздел показывает
  «Заявку уже изменили — обновите страницу». Конфликтом считаются 409 `CONFLICT`, 409 `ROUTE_INVALID_STATE` и 404
  действия (RC-10: автор отозвал за время просмотра).
- `RouteCatalogDialog.tsx` экспортирует `CITY_OPTIONS`/`SURFACE_OPTIONS` — окно «Одобрить» берёт тот же справочник.
- Журнал: префикс подписей полей `route` → `admin.riderRoutes.field.*` («Город старта», «Покрытие»); заодно
  `route.catalog_updated` routes-01 показывает подписи вместо «другое поле».
- Пункт навигации — последним в группе `bottom` (после «Оформления приложения», §11 «в конец массива»).

Этап C (coder, 2026-10-27):
- Город старта в заявке — `CityPicker` формы райда (`features/rides/ride-form.tsx`): экспортирован, добавлен
  необязательный `label` (по умолчанию прежний «Город»). Своей копии выбора города нет.
- Форма заявки и жалобы — `useState` + `safeParse` схемы контракта (`SubmitRoutePublicationInput`,
  `CreateRouteReportRequest`), как образец `ride-report.tsx`, без react-hook-form.
- Фильтр «Автор» — состояние экрана, как остальные группы каталога (в URL фильтры каталога не попадают, routes-01 D3).
- После подачи, отзыва, снятия и удаления — ответ в кеш «Моих» и инвалидация всех `['routes', …]`, кроме
  `['routes','mine']` (каталог, города, карточка, `me`).
- Новые i18n-ключи сверх списка §11: `routes.publication.{title,pendingHint,withdrawConfirm,unpublishConfirm,cancel,
  actionFailed,rejectedComment}`, `routes.publish.{hint,unavailable,back,rateLimited}`,
  `routes.report.{action,failed,rateLimited}`. Прочий отказ публикации — текст `auth.error.unknown` под заголовком.
- Экран жалобы показывает название из публичной карточки (`['routes','detail',id]`), право — из `me`; 404 любого — «Маршрут
  недоступен».

Фиксы ревью pass 1 (coder, 2026-10-27; решения оркестратора по findings.md / findings-codex.md):
- **Маркер «Отклонить жалобы» — `publication.reportRevision`** вместо `lastReportAt` (§11, таблица эндпоинтов,
  `DismissRiderRouteReportsRequest`): тело `{ version, reason, reportRevision }`, карточка панели отдаёт
  `reportRevision`. Поле `lastReportAt` в ответах осталось (порядок очереди и показ). Замена поля запроса панели без
  новой версии эндпоинта: панель деплоится с API, routes-06 ещё не выпущен (клиентов со старым телом нет).
  Отдельная ревизия, а не `$inc publication.version`: иначе новая жалоба давала бы 409 на «Скрыть» по увиденной версии.
- **Переименование автором при заявке — `publication.version + 1`** (§11: «жалоба и „Отклонить жалобы“ `version` не
  меняют» — rename теперь меняет): «Вернуть» по карточке со старым названием — 409 `CONFLICT`.
- **Подача — транзакция** «условная запись `routes` → суточная квота» (§11/RC-8: было «без транзакции, квота перед
  записью»). `RateLimiter` базы не умеет вернуть единицу или проверить без списания, поэтому квота списывается после
  записи в той же транзакции: проигравшая параллельная подача (write conflict → повтор → фильтр не проходит) до квоты
  не доходит, 429 откатывает запись. Остаточный риск — повтор колбэка `withTransaction` на транзиентной ошибке коммита
  после списания (двойное списание одной подачи) или нетранзиентный сбой коммита — принят как редкий.
- **`MyRoute.submissionsExhausted`** (`z.boolean().default(false)`, считает сервер: `submissionCount ≥ 3`) — признак
  для пояснения «использованы все 3 подачи» у отозванного/снятого маршрута (`publication: null`). Вывод из
  `publication === null && !canPublish` отвергнут: старый API без `canPublish` (дефолт `false`) показал бы пояснение
  у всех готовых маршрутов — это сторожит тест «canPublish false (старый API)». Текст — существующий
  `routes.publication.noSubmissionsLeft` (новых ключей нет).

Фиксы ревью pass 2 (coder, 2026-10-27; findings-2.md / findings-codex-2.md):
- **Пояснение «использованы все 3 подачи»** — только у `rejected` без `canPublish` (у отклонённого «Опубликовать»
  недоступна только из-за лимита) и у `publication: null` с `submissionsExhausted`. У `pending`/`approved`/`hidden`
  пояснения нет: «Опубликовать» там недоступна из-за статуса, а не лимита (вариант (а) находки).
- **Redis-квота подачи в транзакции** — второе разрешённое исключение правила «в колбэке транзакции — только `session`»
  (`pokatim-db.md`), с комментарием в `submit()` о двойном списании при повторе колбэка.

## 8.3 Security checklist

Затронуто: AuthZ (свой маршрут, право `routes.moderate`), данные наружу (публичный маршрут райдера, имя), злоупотребления
(лимиты U8), аудит (журнал панели). Заполняет coder.

- [x] AuthZ: «мои» — `AuthGuard` + фильтр `{ ownerUserId, origin: 'rider' }`, чужой/команды/неизвестный — один 404 (N2);
  панель — `PanelGuard` + `@RequirePermission('routes.moderate')` на классе (N4: 401/403 на 7 путей, `admin-routes.test.ts`);
  жалоба/`me` — `AuthGuard`.
- [x] Публичная видимость — только `IN_CATALOG` (отрицательное доказательство: без условия `approved` N1 красный).
- [x] Порты гонок, панель «Маршруты», `routesByIds`, LRU-кэши — без изменений (N3); карта маршрута райдера — без кэша.
- [x] Наружу — явные списки полей (int-тесты ключей): без `ownerUserId`, `origin`, `version`, счётчиков; имя автора —
  только по галочке и `publicName` (N8); в панели имени нет.
- [x] Лимиты U8 (N5), идемпотентная жалоба (уникальный индекс, параллельные дубли).
- [x] Журнал панели — пять действий в транзакции с записью маршрута (откат при сбое журнала — тест); outbox — только id.
- [x] Логи — id, действие, код причины; без названий, комментариев, имён (тест лога жалобы).


## 9. Acceptance Criteria

Функциональные:
1. Райдер подаёт свой готовый маршрут; он в «Моих» со статусом «На проверке» и в очереди панели; в каталоге его нет.
2. Модератор одобряет — маршрут в каталоге (список, город в чипах, карточка, карта, GPX, OG) с бейджем «От райдера»
   и именем по U3; автор видит «В каталоге» и «Открыть в каталоге». Событие outbox «одобрено».
3. Модератор отклоняет с причиной и комментарием — автор видит причину; маршрута в каталоге нет; событие «отклонено».
   Повторная подача отклонённого — до 3 подач на маршрут.
4. Автор отзывает заявку и снимает с публикации — маршрут уходит из очереди/каталога.
5. Жалоба на маршрут райдера в каталоге — в очереди «Жалобы»; «Скрыть» убирает из каталога и закрывает жалобы,
   «Вернуть» возвращает, «Отклонить жалобы» — маршрут не меняется. Все действия — в журнале панели.
6. Фильтр «Автор» работает с остальными фильтрами и курсором.
7. Удаление маршрута и аккаунта убирает маршрут из каталога, очереди и жалоб.

Негативные (int-тесты):
- N1 маршрут в `pending`, `rejected`, `hidden`, без заявки — не виден в списке каталога, городах, карточке, карте, GPX,
  «Гонках на маршруте» (один 404).
- N2 чужой маршрут не подать, не отозвать, не снять (404); маршрут команды через API приложения не подать.
- N3 маршрут райдера (в т. ч. одобренный) не выбирается коридором гонки (`findReady`/`RouteCatalog`) и не появляется
  в списке «Маршруты» панели и в `routesByIds`.
- N4 без `routes.moderate` (organizer, races.manage) — 403 на очередь и действия; без входа — 401.
- N5 лимиты U8: 4-я заявка на рассмотрении, 11-я подача за сутки, 4-я подача маршрута, 21-я жалоба — отказ;
  повторная жалоба — успех без второй записи; жалоба на свой маршрут и на маршрут команды — отказ.
- N6 название в `pending`/`approved` не переименовать.
- N7 решение по уже решённой заявке / «Отклонить жалобы» после новой жалобы — конфликт.
- N8 имя автора не попадает в каталог без галочки и без публичного имени; в панели и OG — нет имени.

Технические: `TURBO_CONCURRENCY=1 pnpm check` зелёный; миграция expand-only; изоляция и права — тестами.

## 10. Documentation Impact

`docs/product/routes.md` (раздел «Публикация своих маршрутов», убрать строку из «позже»), `docs/product/admin-panel.md`
(право `routes.moderate`), `docs/product/account.md` (A7 — публикация и жалобы), правила `.claude/rules/pokatim-*.md`
по необходимости.

Architect (дополнительно): `.claude/rules/pokatim-db.md` — «Маршруты и коридор»: `RouteDoc.publication`, инвариант
«`catalog` у маршрута райдера ⇔ `approved`», `IN_CATALOG`, `route_reports` (исключение append-only + `deleteForRoute`),
индексы `0029_routes_publication`; `.claude/rules/pokatim-backend.md` — `RoutesViewerController`,
`RoutesModerationController`, порядок контроллеров, `RIDER_NAMES.attributionNames`, событие
`routes.publication-decided` без маршрута и правило «хвост до модуля уведомлений» (8.1 RC-3);
`.claude/rules/pokatim-security.md` — «Маршруты райдера»: публикация, жалобы, права `routes.moderate`, `noindex`
(RC-6), логи без названий/комментариев/имён; `docs/product/profile.md` — имя автора маршрута по галочке заявки (RC-2).

## 11. Implementation Context (заполняет architect)

Architecture Review — routes-06-ugc · **Status: APPROVED** (находки 8.1 решены architect, BLOCKERS нет).

### ENTRY POINTS

| Метод и путь | Контроллер → сервис | Гард / право | Ответ | Ошибки |
|---|---|---|---|---|
| `POST /v1/routes/mine/:id/publish` (тело `SubmitRoutePublicationInput`) | `RoutesMineController.publish` → `MyRoutePublicationService.submit` | `AuthGuard`, `no-store` | 200 `MyRoute` | 404 чужой/команды/нет; 409 `ROUTE_INVALID_STATE {reason: not_ready \| in_review \| published \| hidden}`; 409 `ROUTE_PUBLICATION_LIMIT {limit: route_submissions \| pending, max: 3}`; 429 `RATE_LIMITED` (`routes-publication-submit:<uid>` 10/сут) |
| `POST /v1/routes/mine/:id/unpublish` | `RoutesMineController.unpublish` → `MyRoutePublicationService.withdraw` | `AuthGuard`, `no-store` | 200 `MyRoute` (из `pending`/`approved` → `withdrawn`; нет заявки, `withdrawn`, `rejected` — 200 без записи) | 404; 409 `ROUTE_INVALID_STATE {reason: hidden}` |
| `POST /v1/routes/mine/:id/rename` (есть) | + условие в фильтре `renameOwn` | как было | `MyRoute` | + 409 `ROUTE_INVALID_STATE {reason: in_review \| published}` (N6) |
| `GET /v1/routes/mine`, `/:id` (есть) | `toMyRoute` + `publication`, `canPublish` | как было | `MyRoute` | — |
| `GET /v1/routes?…&author=team&author=rider` (есть) | `RoutesPublicService.list` + `author` | `PublicReadGuard`, `public, max-age=60` | `CatalogRoutePage` (+`author`) | 400 лишние/неверные значения |
| `GET /v1/routes/cities`, `/:id`, `/:id/map`, `/:id/gpx` (есть) | `findInCatalog`; карта райдера — без кэша | как было | + `author` в карточке | 404 не `approved` (N1) |
| `GET /v1/routes/:id/me` | `RoutesViewerController.me` → `RouteReportsService.viewer` | `AuthGuard`, `no-store` | 200 `CatalogRouteViewer {canReport, reported}` | 404 не в каталоге |
| `POST /v1/routes/:id/reports` (тело `CreateRouteReportRequest`) | `RoutesViewerController.report` → `RouteReportsService.report` | `AuthGuard`, `no-store`, `@HttpCode(200)` | 200 `CatalogRouteViewer` (`reported: true`; повтор — тот же успех) | 404 не в каталоге; 409 `ROUTE_INVALID_STATE {reason: own_route \| team_route}`; 429 (`routes-report:<uid>` 20/сут) |
| `GET /v1/admin/rider-routes?state=pending\|reported\|hidden&cursor&limit` | `RoutesModerationController.list` → `RoutesModerationService.list` | `PanelGuard` + `@RequirePermission('routes.moderate')` на классе | `RiderRouteModerationPage` | 401/403 (N4) |
| `GET /v1/admin/rider-routes/:id` | `.get` | то же | `RiderRouteModerationDetail` | 404 (никогда не подавался, `withdrawn`, команды, нет) |
| `POST /v1/admin/rider-routes/:id/approve` `{version, city, surfaces}` | `.approve` | то же | `RiderRouteModerationDetail` | 404; 409 `CONFLICT` (версия); 409 `ROUTE_INVALID_STATE` (не `pending`) |
| `POST …/:id/reject` `{version, reason: RouteRejectionReason, comment?}` | `.reject` | то же | то же | то же |
| `POST …/:id/hide` `{version, reason: ActionReason}` | `.hide` (закрывает открытые жалобы `hidden`) | то же | то же | не `approved` — 409 `ROUTE_INVALID_STATE` |
| `POST …/:id/restore` `{version, reason: ActionReason}` | `.restore` | то же | то же | не `hidden` — 409 |
| `POST …/:id/dismiss-reports` `{version, reason: ActionReason, lastReportAt}` | `.dismiss` | то же | то же | новая жалоба / версия — 409 `CONFLICT` (N7); нет открытых — 409 `ROUTE_INVALID_STATE` |

Порядок контроллеров в `RoutesModule.controllers`: `RoutesMineController`, `RoutesViewerController`,
`RoutesAdminController`, `RoutesModerationController`, `RoutesPublicController`. `RoutesViewerController` —
`@Controller('routes')` + `@UseGuards(AuthGuard)` с путями `:id/me`, `:id/reports` (id — `Uuid` pipe).
`src/admin-routes.test.ts` обязан найти `PanelGuard`+право у нового контроллера.

Порядок проверок:
- `submit`: `findOwn` (404) → `status = 'ready'` (409 `not_ready`) → состояние (`pending` → `in_review`,
  `approved` → `published`, `hidden` → `hidden`) → `submissionCount < 3` → `countPendingOwn(uid) < 3` (принятая гонка,
  8.1 RC-7) → `RateLimiter.consume('routes-publication-submit:<uid>', {limit: 10, windowSec: 86400})` →
  `RoutesRepository.submitPublication` (атомарно, все условия в фильтре) → `null` — перечитать и вернуть точную ошибку.
- `report`: лимит `routes-report:<uid>` 20/сут (как `rides-report`) → `findInCatalog` (404) → `origin = 'platform'` →
  409 `team_route` → `ownerUserId = uid` → 409 `own_route` → `exists` → идемпотентный успех → транзакция
  (`recordRouteReport` первой, затем `insert`; `isDuplicateKey('route_reports_route_reporter_unique')` → успех).
- Модерация: в транзакции `findForModeration(id, tx)` (404) → `publication.version !== body.version` → 409 `CONFLICT` →
  `dismiss`: `lastReportAt` ≠ увиденному → 409 `CONFLICT` → переход (`publicationTransition`, чистая функция) → 409
  `ROUTE_INVALID_STATE` → условная запись `routes` (первой; `null` → 409 `CONFLICT`) → `RouteReportsRepository.closeOpen`
  (hide → `hidden`, dismiss → `dismissed`) → `PanelAudit.append` → outbox (approve/reject). Лог после коммита:
  `route <id> <action> by <panelUid>`, без названия, комментария и `userId` автора.

Журнал панели (`subject: { kind: 'route', id, label: title }`, `actor` — сотрудник, `target` — нет):
`route.submission_approved` (`details.changedFields` — `city`/`surfaces`, если модератор поправил),
`route.submission_rejected` (`reason` — комментарий автору или `null`, `details.rejectionReason` — код),
`route.rider_hidden` (`reason`, `details.reportCount`), `route.rider_restored` (`reason`),
`route.rider_reports_dismissed` (`reason`, `details.reportCount`).

Outbox: `routes.publication-decided` `{ routeId, authorUserId, decision: 'approved' | 'rejected', decidedAt }` —
в `routes.events.ts`, **не** в `routesOutboxRoutes` (8.1 RC-3). Нет текста, причин, названия и имени.

### TYPES & SCHEMAS (contracts first, `packages/contracts/src/routes/`)

- **Новый `route-publication.schema.ts`:**
  `ROUTE_PUBLICATION_STATUSES = ['pending', 'approved', 'rejected', 'hidden']` (наружу; внутреннее `withdrawn` → в
  ответе `publication: null`); `ROUTE_REJECTION_REASONS = ['dangerous', 'impassable', 'duplicate', 'bad_title',
  'not_cycling', 'other']` (только в конец); `ROUTE_PUBLICATION_COMMENT_MAX = 500`; `ROUTE_PUBLICATION_MAX_PENDING = 3`,
  `ROUTE_PUBLICATION_MAX_SUBMISSIONS = 3`; `SubmitRoutePublicationInput = strictObject({ city: CityCode, surfaces:
  SurfaceList, showAuthorName: z.boolean() })`; `MyRoutePublication = { status: tolerantEnum(STATUSES), city:
  tolerantEnum(CITY_CODES), surfaces: tolerantEnum(SURFACES)[], showAuthorName, submittedAt, decidedAt: nullable,
  rejection: { reason: tolerantEnum(REJECTION_REASONS), comment: string | null } | null }`;
  `ROUTE_STATE_REASONS = ['not_ready', 'in_review', 'published', 'hidden', 'own_route', 'team_route']`,
  `RouteStateDetails = { reason: tolerantEnum(ROUTE_STATE_REASONS) }` (`details` у `409 ROUTE_INVALID_STATE`; панель
  routes-01 шлёт без `details` — схема `optional`); `ROUTE_PUBLICATION_LIMITS = ['pending', 'route_submissions']`,
  `RoutePublicationLimitDetails = { limit: tolerantEnum(...), max: int }`.
- **Новый `route-report.schema.ts`:** `ROUTE_REPORT_REASONS = ['dangerous', 'impassable', 'private_area',
  'offensive_title', 'spam', 'other']`; `CreateRouteReportRequest = strictObject({ reason, comment:
  optionalText(500, MULTI_LINE).optional() })`; `CatalogRouteViewer = { canReport: boolean, reported: boolean }`.
- **Новый `route-moderation.schema.ts`** (панель — строгие `z.enum`): `RIDER_ROUTE_MODERATION_STATES = ['pending',
  'reported', 'hidden']`; `RiderRouteModerationQuery = strictObject({ ...PageQuery.shape, state: default('pending'),
  cursor, limit 1..50 default 20 })`; `RiderRouteModerationRow = { id, title, authorUserId, status, city, surfaces,
  distanceM, submittedAt, openReportCount, topReason: RouteReportReason | null, lastReportAt, hiddenAt }`;
  `RiderRouteModerationReport = { id, reason, comment, createdAt, resolution: 'hidden' | 'dismissed' | null,
  resolvedAt }` (без автора жалобы); `RiderRouteModerationDetail = { id, title, authorUserId, showAuthorName, status,
  city, surfaces, submittedAt, submissionCount, decidedAt, approvedAt, rejection, hiddenAt, openReportCount,
  lastReportAt, version, distanceM, elevationGainM, isLoop, line (≤1000), elevation: CatalogRouteElevation | null,
  reports (≤100) }` — **без имени автора** (N8); `ApproveRiderRouteRequest = { version, city, surfaces }`,
  `RejectRiderRouteRequest = { version, reason: RouteRejectionReason, comment?: optionalText(500) }`,
  `HideRiderRouteRequest`/`RestoreRiderRouteRequest = { version, reason: ActionReason }`,
  `DismissRiderRouteReportsRequest = { version, reason: ActionReason, lastReportAt }`.
- **`my-route.schema.ts`:** `MyRoute` + `publication: MyRoutePublication.nullable().default(null)`, `canPublish:
  z.boolean().default(false)` (сервер: `ready`, нет заявки/`withdrawn`/`rejected`, `submissionCount < 3`).
- **`route-catalog.schema.ts`:** `ROUTE_AUTHOR_KINDS = ['team', 'rider']`; `CatalogRouteAuthor = discriminatedUnion
  ('kind', [{ kind: 'team' }, { kind: 'rider', name: string | null }])`; `CatalogRouteCard.author:
  CatalogRouteAuthor.default({ kind: 'team' })` (новый клиент против старого API); `CatalogRouteQuery.author:
  queryArray(RouteAuthorKind, 2).optional()`.
- **`admin/permissions.schema.ts`:** `'routes.moderate'` — в конец `PERMISSIONS`. **`admin/audit.schema.ts`:** пять
  действий выше — в конец `AUDIT_ACTIONS`; `details.rejectionReason: RouteRejectionReason.optional()`.
- **`common.ts`:** `'ROUTE_PUBLICATION_LIMIT'` — в конец `ErrorCode`. `index.ts` — экспорт новых схем.
- **api-client** (`index.ts`): `submitMyRoutePublication(token, id, body)`, `unpublishMyRoute(token, id)`,
  `getCatalogRouteViewer(token, id)`, `reportCatalogRoute(token, id, body)`, `listCatalogRoutes` — параметр `author`.
  `admin.ts`: `listRiderRoutes(params)`, `getRiderRoute(id)`, `approveRiderRoute`, `rejectRiderRoute`, `hideRiderRoute`,
  `restoreRiderRoute`, `dismissRiderRouteReports`.

### Данные, миграция, индексы

`RouteDoc.publication?: RoutePublicationDoc | null` (чтение `?? null`, бэкфилла нет):

```ts
interface RoutePublicationDoc {
  status: 'pending' | 'approved' | 'rejected' | 'hidden' | 'withdrawn';
  city: CityCode; surfaces: Surface[]; showAuthorName: boolean;
  submittedAt: Date; submissionCount: number;        // ≤ 3, отзыв/снятие не сбрасывают
  decidedAt: Date | null; approvedAt: Date | null;    // approvedAt = catalog.publishedAt (Вернуть — прежняя дата)
  rejection: { reason: RouteRejectionReason; comment: string | null } | null;
  hiddenAt: Date | null;
  openReportCount: number; lastReportAt: Date | null; // очередь «Жалобы»; переживают отзыв и новую подачу (RC-4)
  version: number;                                    // +1 при каждом переходе (кроме жалобы и dismiss — как rides)
}
```

Переходы (`publicationTransition(status, action)` в `routes.policy.ts`; запись — `RoutesRepository`, фильтр
`{ _id, origin: 'rider', status: 'ready', 'publication.status': <из>, 'publication.version': v }`):
- `submitPublication` (автор, + `ownerUserId`): нет/`withdrawn`/`rejected` → `pending`; **pipeline-update** (поле
  `publication` может быть `null` — `$set` по вложенному пути упадёт): значения — `$literal`, счётчики —
  `$add: [{ $ifNull: ['$publication.submissionCount', 0] }, 1]`, `openReportCount`/`lastReportAt` — `$ifNull` прежних;
  `submissionCount < 3` — в фильтре.
- `withdrawPublication` (автор): `pending | approved` → `withdrawn`, `catalog: null`.
- `approvePublication`: `pending` → `approved`, `city/surfaces` модератора, `decidedAt = approvedAt = now`,
  `catalog = { city, surfaces, publishedAt: now }`.
- `rejectPublication`: `pending` → `rejected`, `rejection`, `decidedAt`.
- `hidePublication`: `approved` → `hidden`, `hiddenAt`, `catalog: null`, `openReportCount: 0`.
- `restorePublication`: `hidden` → `approved`, `hiddenAt: null`, `catalog = { city, surfaces, publishedAt: approvedAt }`.
- `clearRouteReports` (dismiss): `approved`, `openReportCount > 0`, `lastReportAt = seen` → `openReportCount: 0`.
- `recordRouteReport` (жалоба): `origin: 'rider'`, `approved`, `ownerUserId: { $ne: uid }` → `$inc openReportCount`,
  `$max lastReportAt`.
- `renameOwn`: + `'publication.status': { $nin: ['pending', 'approved'] }` в фильтре; `null` → перечитать: нет — 404,
  иначе 409 (N6).
- `listCatalog`: `{ status: 'ready', ...IN_CATALOG }` + `author` → `origin: { $in }` (`team`→`platform`,
  `rider`→`rider`); `hint('routes_catalog_idx')` остаётся. `catalogCities` — с `IN_CATALOG`.
- Новые чтения: `findInCatalog(id)`, `countPendingOwn(uid)` (`routes_owner_origin_idx` + остаток),
  `findForModeration(id, tx?)` (`origin: 'rider'`, `publication.status ∈ {pending, approved, rejected, hidden}`),
  `listPublicationQueue(state, after, limit)` (запрос обязан содержать условие частичного индекса).

`route_reports` (`route-reports.collection.ts`, писатель — `RouteReportsRepository`):
`{ _id, routeId, reporterUserId, reason, comment: string | null, createdAt, resolvedAt, resolution: 'hidden' |
'dismissed' | null, resolvedBy: string | null }`; методы `insert`, `exists`, `closeOpen`, `latest(≤100)`,
`topReasons`, `deleteForRoute(tx, routeId)` (единственное удаление, RC-5).

Удаление: новый `RouteDeletion.deleteOwn(tx, uid, id)` (`route-deletion.ts`) = `RoutesRepository.deleteOwn` →
при `true` `RouteReportsRepository.deleteForRoute`; его вызывают `MyRoutesService.delete` и `RouteErasure.erase`
(вместо прямого `repository.deleteOwn`).

**Миграция `apps/api/src/db/migrations/0029_routes_publication.ts`** (`id: '0029_routes_publication'`, expand-only,
без транзакции, идемпотентна, в конец `migrations/index.ts`): `ensureCollection('route_reports')`; индексы
- `route_reports`: `route_reports_route_reporter_unique { routeId: 1, reporterUserId: 1 }` unique;
  `route_reports_route_idx { routeId: 1, _id: -1 }`;
- `routes`: `routes_publication_pending_idx { 'publication.submittedAt': 1, _id: 1 }` partial
  `{ 'publication.status': 'pending' }`; `routes_publication_reports_idx { 'publication.lastReportAt': -1, _id: -1 }`
  partial `{ 'publication.openReportCount': { $gt: 0 } }`; `routes_publication_hidden_idx { 'publication.hiddenAt':
  -1, _id: -1 }` partial `{ 'publication.status': 'hidden' }`.
Бэкфилла нет (`publication` отсутствует ⇒ `null`). Порядок деплоя: миграция → API → панель/приложение.

`ROUTE_POLICY` (+): `publicationSubmitLimit: { limit: 10, windowSec: 86400 }`, `reportLimit: { limit: 20, windowSec:
86400 }`, `maxPendingPublications`/`maxSubmissionsPerRoute` — из контрактов (3/3).

### FILES TO CREATE

- contracts: `routes/route-publication.schema.ts`, `routes/route-report.schema.ts`, `routes/route-moderation.schema.ts`
  (+ `*.schema.test.ts` к каждому).
- api `modules/routes/`: `my-route-publication.service.ts`, `route-reports.collection.ts`, `route-reports.repository.ts`,
  `route-reports.service.ts`, `routes-viewer.controller.ts`, `routes-moderation.controller.ts`,
  `routes-moderation.service.ts`, `route-deletion.ts`; тесты (ниже). `db/migrations/0029_routes_publication.ts`.
- admin `features/rider-routes/`: `RiderRoutesScreen.tsx` (вкладки «На проверке / Жалобы / Скрытые», `?tab=`),
  `RiderRouteScreen.tsx` (страница заявки), `RiderRouteDecisionDialogs.tsx` (одобрить с правкой города/покрытия,
  отклонить с причиной и комментарием, скрыть/вернуть/отклонить жалобы с `ActionReason`), `rider-routes-query.ts`,
  `rider-routes-format.ts` (+ тесты); `features/routes/RouteReadyView.tsx` (вынесенный `ReadyRoute`).
- app: `src/app/routes/mine/publish/[id].tsx` → `features/routes/my-route-publish.tsx` (`MyRoutePublishScreen`:
  город — чипы справочника, покрытие, галочка «Подписать моим именем», предупреждение, «Отправить на проверку»);
  `src/app/routes/report/[id].tsx` → `features/routes/route-report.tsx` (`RouteReportScreen`, образец
  `ride-report.tsx`); `features/routes/my-route-publication.tsx` (блок статуса и действий в карточке «Моего»).

### FILES TO MODIFY

- contracts: `routes/my-route.schema.ts`, `routes/route-catalog.schema.ts`, `admin/permissions.schema.ts`,
  `admin/audit.schema.ts`, `common.ts`, `index.ts` (+ их тесты).
- api: `routes.collection.ts` (`RoutePublicationDoc`), `routes.repository.ts` (§ выше), `routes-public.service.ts`
  (`findInCatalog`, `author`, карта райдера без кэша, имена через `RIDER_NAMES.attributionNames` одним вызовом на
  страницу — только `approved` с `showAuthorName`), `routes-public.controller.ts` (без изменений путей),
  `my-routes.service.ts` (`toMyRoute` + `publication`/`canPublish`, `rename` → 409, `delete` → `RouteDeletion`),
  `routes-mine.controller.ts` (`publish`, `unpublish`), `route-erasure.ts` (`RouteDeletion`), `routes.events.ts`
  (событие без маршрута), `routes.policy.ts` (`publicationTransition`, лимиты), `routes.module.ts` (контроллеры,
  провайдеры, `ProfileCoreModule`), `profile/rider-names.port.ts` + `rider-names.ts` + `profile.repository.ts`
  (`attributionNames` / `findAttributionNames`), `panel/permissions.ts` (`routes.moderate` → moderator),
  `error-messages.ts` (`ROUTE_PUBLICATION_LIMIT`), `db/migrations/index.ts`.
  **Не трогать:** `route-catalog.ts`, `findReady`/`findPublished`/`routesByIds`/`listVisible`/`setCatalog`/
  `clearCatalog`, `routes.service.ts`, `routes-catalog-admin.service.ts`, `routes-admin.controller.ts`, модуль `races`,
  `worker.module.ts`.
- api-client: `index.ts`, `admin.ts` (+ тесты).
- i18n `ru.ts` — только новые ключи (существующие не менять):
  `routes.author.rider` («От райдера»), `routes.author.by` («От райдера · {name}»), `routes.filter.author`,
  `routes.filter.author.team|rider`; `routes.publication.status.pending|approved|rejected|hidden`,
  `routes.publication.publish|withdraw|unpublish|openInCatalog|rejectedTitle|hiddenHint|renameFrozen|deleteWarning|
  noSubmissionsLeft`; `routes.publish.title|city|surfaces|showName|showNameHint|warning|submit|failed`;
  `routes.report.title|reason|comment|hint|submit|sent|back|unavailable|reported`;
  `domain.routeRejectionReason.*`, `domain.routeReportReason.*`; `routes.mine.error.ROUTE_PUBLICATION_LIMIT.pending|
  route_submissions`, `routes.mine.error.ROUTE_INVALID_STATE.<reason>`; `admin.nav.riderRoutes` («Маршруты
  райдеров»), `admin.riderRoutes.*` (заголовки, вкладки, колонки, `author` «Райдер ·{id}», действия, диалоги, пустые
  состояния, `conflict` «Заявку уже изменили — обновите страницу»), `admin.audit.action.route.submission_approved|
  submission_rejected|rider_hidden|rider_restored|rider_reports_dismissed`, `admin.audit.details.rejectionReason`.
- admin: `navigation.ts` (`{ to: '/rider-routes', labelKey: 'admin.nav.riderRoutes', permission: 'routes.moderate',
  group: 'bottom' }` — в конец массива), `router.tsx` (`rider-routes`, `rider-routes/$routeId` под
  `RequirePermission`), `features/routes/RouteScreen.tsx` (использует `RouteReadyView`), `features/routes/
  RoutePreview.tsx` (тип пропса `RouteLine`), журнал — подписи действий.
- app: `src/app/_layout.tsx` (`routes/mine/publish/[id]`, `routes/report/[id]` — в `Stack.Protected` рядом с
  `rides/report/[id]`), `src/app/routes/[id].tsx` (`generateMetadata`: `robots: 'noindex'` для `author.kind =
  'rider'`, имени в OG нет), `features/routes/route-detail.tsx` (бейдж/имя, `useCatalogRouteRaces` только для `team`,
  «Пожаловаться» / «Вы пожаловались» по `useCatalogRouteViewer` — только вошедшему, клиентский запрос, не SSR),
  `features/routes/{queries,my-routes-queries,filters,route-feed,my-route-detail,my-route-feed,error-messages,
  format}.ts(x)`, `components/route-list-card.tsx` (бейдж в `RouteListCard`, статус публикации в `MyRouteListCard`),
  `__tests__/app-routes.ts`. После мутаций — инвалидация `myRoutesKeys.*` и `['routes']` (каталог).

### FILES TO READ (coder)

`AGENTS.md` §4; `.claude/rules/{pokatim-backend,pokatim-db,pokatim-security,pokatim-contracts,pokatim-app,
pokatim-web,pokatim-tests,db,tests}.md`; код из §6; `docs/tasks/2026-10-27-app-05b-rides-moderation/task.md`
(8.1 D1–D7); `docs/tasks/2026-10-27-routes-02-my-routes/task.md` (RC-2); `docs/adr/0015-account-deletion.md`;
`node_modules/@rkarakulov/api-kit/dist/mongo/outbox/outbox.publisher.js` (RC-3).

### TESTS

API int (реальный MongoDB/Redis, изолированные БД):
- `routes-publication.int.test.ts` — подача → `MyRoute.publication.pending`, нет в каталоге (AC1); отзыв, снятие
  (AC4); повторная подача отклонённого (AC3); **N2** чужой/команды/неизвестный — один 404 на publish/unpublish;
  **N5** 4-я на проверке → 409 `pending`, 4-я подача маршрута → 409 `route_submissions`, 11-я успешная за сутки → 429
  (3+3+3+1 через отзывы), отказ 409 квоту не тратит; **N6** rename в `pending`/`approved` → 409, в `hidden`/`rejected`
  → 200; не `ready` → 409 `not_ready`; `hidden` → publish 409; ответы — явный список полей (без `ownerUserId`,
  `catalog`, `version`, `submissionCount`).
- `routes-moderation.int.test.ts` — очереди (`pending` старые сверху, `reported` новые сверху и только `approved`,
  `hidden`), курсоры; approve с правкой города → каталог, город в чипах, `changedFields` в журнале; reject → причина
  автору; hide закрывает жалобы, restore — прежний `publishedAt`; dismiss; журнал на каждое действие; outbox
  `routes.publication-decided` на approve/reject с ключами ровно `{routeId, authorUserId, decision, decidedAt}`, без
  записи в очередь (`publishedAt: null` после `publishBatch`); **N4** organizer/`races.manage` → 403 на все 7 путей,
  без сессии → 401; **N7** повторное решение → 409 (`CONFLICT` по версии / `ROUTE_INVALID_STATE`), dismiss после новой
  жалобы → 409; гонка approve ↔ withdraw автора (параллельно) — ровно один исход; 404 для `withdrawn`/никогда не
  подававшегося; **N8** ответы панели без имени автора.
- `route-reports.int.test.ts` — жалоба → очередь «Жалобы» (AC5); повтор — 200 без второй записи; параллельные дубли;
  свой → 409 `own_route`; команды → 409 `team_route`; не `approved` → 404; 21-я за сутки → 429 (**N5**); `me`:
  `canReport/reported`; гонка «жалоба ↔ скрыть» (параллельно) — `openReportCount` = числу открытых; логи без
  комментария.
- `routes-public.int.test.ts` (расширить) — **N1**: `pending`, `rejected`, `hidden`, `withdrawn`, без заявки — нет в
  списке, `cities`, `/:id`, `/map`, `/gpx`, `/:id/races` (404); `approved` — есть с `author.kind = 'rider'`, карта/GPX
  отдаются, `/:id/races` → 404 (RC-1); фильтр `author` × город × дистанция × покрытие × курсор (AC6), `explain` —
  `routes_catalog_idx`; **N8** имя: без галочки — `null`, с галочкой без `publicName` — `null`, с галочкой и именем
  — имя (при `showNameInResults: false`); ключи ответа — явный список (без `ownerUserId`); карта райдера не попадает
  в `displayCache` (после удаления маршрута `/map` → 404 сразу, не из LRU).
- `routes-admin.int.test.ts` / `routes-catalog-admin.int.test.ts` (расширить) — **N3**: одобренный маршрут райдера
  не в `GET /v1/admin/routes` (оба режима), `GET /v1/admin/routes/:id` → 404, publish/unpublish панели → 404;
  `RouteCatalog.findReady`, `summaries`, `inCatalog`, `RouteGeometry.matchGeometry|displayGeometry` → `null`/пусто.
- `routes-mine.int.test.ts` (расширить) — удаление `approved`-маршрута с жалобами: нет в каталоге, очереди, 0
  `route_reports` (AC7).
- `account/account-erasure.int.test.ts` (расширить) — автор с `approved`/`pending` маршрутами и жалобами на них:
  после стирания — нет маршрутов и их жалоб; жалобы удалённого **жалобщика** на чужие маршруты — остаются.
- `db/migrations/migrations.int.test.ts` — индексы `0025` (имена, `partialFilterExpression`, unique).
- `src/admin-routes.test.ts` — проходит с новым контроллером.

API unit: `routes.policy.test.ts` (`publicationTransition` — все пары статус × действие), `route-reports.repository
.test.ts` (сторож: только `insertOne`, `updateMany` с `resolvedAt: null`, `deleteMany({ routeId })`),
`profile.repository` / `rider-names` — `attributionNames` без согласия, пустой вход без запроса.

Contracts/api-client: схемы (strictObject, лимиты 500, `tolerantEnum` неизвестных кодов, дефолты `author`,
`publication`, `canPublish`), `PERMISSIONS`/`AUDIT_ACTIONS` — новые в конце; методы клиента (пути, тела, zod ответа).

Admin (vitest + Testing Library): `RiderRoutesScreen.test.tsx` (вкладки, скелетон, пусто, ошибка, 403),
`RiderRouteScreen.test.tsx` (карта/профиль из `RouteReadyView`, `Райдер ·{id}`, жалобы без автора, диалоги, 409 →
«Обновите страницу», 404), `RouteScreen.test.tsx` (регрессия после выноса), навигация скрыта без `routes.moderate`.

App (jest + RNTL): `my-routes.test.tsx` (статусы в списке и карточке, «Опубликовать» по `canPublish`, «Отозвать»,
«Снять», «Открыть в каталоге», предупреждение удаления, переименование заморожено), `my-route-publish.test.tsx`
(форма, предупреждение, ошибки лимитов), `route-report.test.tsx`, `routes.test.tsx` (фильтр «Автор», сброс),
`route-list-card.test.tsx` (бейдж, имя), `route-detail.test.tsx` (бейдж, гонки не запрашиваются для `rider`,
«Пожаловаться» только вошедшему не-автору, «Вы пожаловались»), `route-metadata.test.ts` (OG без имени, `noindex`
для райдера).

### Порядок реализации и этапы

**Этап A — contracts + api + api-client** (один PR-коммит набором, `pnpm check` зелёный):
1. contracts (схемы + тесты) → 2. миграция `0025` + тест → 3. `routes.collection.ts`, `routes.policy.ts`
(`publicationTransition`, unit) → 4. репозиторий (переходы, `IN_CATALOG`, `findInCatalog`, очереди) +
`route-reports.*` + `RouteDeletion` → 5. профиль: `attributionNames` → 6. `MyRoutePublicationService` + контроллер «моих»
(int N2/N5/N6) → 7. публичный каталог (`author`, фильтр, карта райдера; int N1/N8) → 8. жалобы + `me` → 9. модерация
+ журнал + outbox (int N4/N7) → 10. N3 и стирание аккаунта → 11. api-client → 12. правила `pokatim-*.md`.

**Этап B — admin:** вынос `RouteReadyView` (регрессия routes-05) → query/format → список с вкладками → страница
заявки и диалоги → навигация/роутер → журнал → тесты.

**Этап C — app:** i18n → queries/мутации → статус и действия в «Моих» → экран заявки → бейдж и фильтр каталога →
карточка (бейдж, имя, гонки, жалоба, `me`) → экран жалобы → мета/`noindex` → `_layout`/`app-routes` → тесты
(iOS/Android/web — без `Platform.OS` в экранах, скелетоны по §4.12).

### OUT OF SCOPE (подтверждено)

Модуль уведомлений и маршрут события в очередь; смена галочки имени без новой подачи (RC-9); бейдж на Главной
(RC-12); правка подписи поля имени в профиле (RC-2); лимит частоты действий модератора (как в 05b — нет).

## 12. Outcome (заполняет coder)

### Этап A — contracts + api + api-client (coder, 2026-10-27)

**Сделано**
- contracts: `routes/route-publication.schema.ts`, `route-report.schema.ts`, `route-moderation.schema.ts` (+ тесты);
  `MyRoute.publication`/`canPublish`, `CatalogRouteCard.author` (дефолт `team`), `CatalogRouteQuery.author`; право
  `routes.moderate`, пять действий журнала и `details.rejectionReason`, код `ROUTE_PUBLICATION_LIMIT` — в конце списков.
- api: миграция `0029_routes_publication`; `RouteDoc.publication` + `publicationTransition`/`canPublish`
  (`routes.policy.ts`); `RoutesRepository` — `IN_CATALOG` (платформа | `approved`), `findInCatalog`, переходы публикации,
  `recordRouteReport`, очереди с `hint`; `findPublished`/`findReady`/`routesByIds`/`listVisible`/`route-catalog.ts` — без
  изменения поведения; `route_reports` (`RouteReportsRepository`, сторож), `RouteDeletion` (автор и `RouteErasure`);
  `MyRoutePublicationService` (`publish`/`unpublish`), заморозка названия; `RoutesViewerController` + `RouteReportsService`;
  `RoutesModerationController` + `RoutesModerationService` (транзакция: маршрут → жалобы → журнал → outbox
  `routes.publication-decided` без маршрута); публичный каталог — автор, фильтр, карта райдера без кэша; порт
  `RIDER_NAMES.attributionNames`; `routes.moderate` → moderator.
- api-client: `submitMyRoutePublication`, `unpublishMyRoute`, `getCatalogRouteViewer`, `reportCatalogRoute`,
  `listCatalogRoutes({ author })`; панель — `listRiderRoutes`, `getRiderRoute`, `approveRiderRoute`, `rejectRiderRoute`,
  `hideRiderRoute`, `restoreRiderRoute`, `dismissRiderRouteReports`.
- правила и доки: `.claude/rules/pokatim-{db,backend,security,contracts}.md` (в т. ч. правило «хвост» RC-3),
  `docs/product/{admin-panel,account,profile}.md`.

**Тесты (новые/расширенные):** unit — `routes.policy.test.ts` (все пары статус × действие, `canPublish`, лимиты),
`route-reports.repository.test.ts` (сторож), `rider-names.test.ts`, права панели; int — `routes-publication`
(AC1, AC3, AC4, N2, N5, N6), `routes-moderation` (AC2, AC3, AC5, N4, N7, N8, outbox без публикации, гонка approve ↔
withdraw, откат), `route-reports` (AC5, N5, `me`, гонки «жалоба ↔ скрыть»), `routes-public` (N1, N8, автор × фильтры ×
курсор + IXSCAN, карта без кэша), `routes-admin` (N3), `routes-mine` (AC7), `account-erasure` (AC7), миграции `0025`.

**Отрицательные доказательства (временная правка, откачена):**
- `recordRouteReport` без условий `publication.status: 'approved'` + `catalog` → гонка «удерживаемое скрытие ↔ жалоба»:
  `AssertionError: expected 200 to be 404`.
- `IN_CATALOG` без `'publication.status': 'approved'` → N1: `expected [ …(6) ] to deeply equal [ Array(1) ]`.

**Проверки:** `MONGO_URL_TEST=…/pokatim_routes06_test REDIS_URL_TEST=…/13 TURBO_CONCURRENCY=1 pnpm check` → `EXIT=0`:
prettier — «All matched files use Prettier code style!»; eslint — 0; depcruise — «no dependency violations found»;
typecheck — `Tasks: 9 successful, 9 total`; test — `Tasks: 15 successful, 15 total` (contracts 273, api-client 96,
api 1169 / 116 файлов, admin 282, app 1208 / 137 сьютов).

**Отклонения** — §8.2. **Риск:** один прогон `route-reports.int.test.ts` упал по таймауту хука `beforeEach` (60 с,
общий MongoDB под нагрузкой других агентов), повтор — зелёный.

### Этап B — admin (coder, 2026-10-27)

**Сделано**
- `features/routes/RouteReadyView.tsx` — вынесенный `ReadyRoute` (карта со скраббингом, цифры, профиль); тип пропса —
  `Pick<PanelRoute, title|distanceM|elevationGainM|isLoop|line|elevation>` + `surfaces`; `RouteScreen` использует его,
  `RouteLine` сужен до `Pick<PanelRoute, …>`. Копий карты/профиля нет.
- `features/rider-routes/`: `RiderRoutesScreen` (вкладки «На проверке / Жалобы / Скрытые», `?tab=`, курсор,
  колонки: маршрут + город, `Райдер ·id`, длина, подана / жалобы с главной причиной / скрыт, статус),
  `RiderRouteScreen` (сводка заявки без имени автора, подпись «Имя из профиля автора» / «Только «От райдера»», город,
  покрытие, подачи `n из 3`, отклонение с комментарием, `RouteReadyView`, жалобы без автора; действия по статусу),
  `RiderRouteDecisionDialogs` (одобрить — город/покрытие RHF+zod из контракта; отклонить — справочник `RadioGroup` +
  комментарий ≤ 500; скрыть/вернуть/отклонить жалобы — `ReasonDialog`, dismiss шлёт `lastReportAt`),
  `rider-routes-query.ts`, `rider-routes-format.ts`. После действия — ответ в кэш, инвалидация очереди и журнала.
- `navigation.ts`, `router.tsx` (`rider-routes`, `rider-routes/$routeId` под `RequirePermission routes.moderate`);
  журнал — `details.rejectionReason` словами, подписи полей маршрута; `test/app.tsx` — `routes.moderate` у admin и
  moderator (как на сервере).
- i18n (`packages/i18n/src/ru.ts`, только новые ключи): `admin.nav.riderRoutes`, `admin.riderRoutes.*`,
  `admin.audit.details.rejectionReason`, `domain.routeRejectionReason.*`, `domain.routeReportReason.*`.
- правило `.claude/rules/pokatim-web.md` — раздел «Маршруты райдеров».

**Тесты:** `RiderRoutesScreen.test.tsx` (вкладки и URL, колонки, пусто, скелетон, ошибка, 403, organizer — нет пункта
и «Нет доступа» без запроса на список и карточку), `RiderRouteScreen.test.tsx` (`RouteReadyView` — линия, цифры,
слайдер профиля; `Райдер ·id`; одобрение с правкой города/покрытия; отклонение — причина обязательна, комментарий
≤ 500; скрыть/вернуть/отклонить жалобы с `version`/`lastReportAt`; 409 `CONFLICT`, 409 `ROUTE_INVALID_STATE`, 404 —
баннер и перечитывание; прочая ошибка — в окне; 404/ошибка/скелетон), `AppLayout.test.tsx` (пункт у admin и
moderator, organizer → `/rider-routes` «Нет доступа»), `AuditScreen.test.tsx` (причина отклонения, поля),
`RouteScreen.test.tsx` — регрессия после выноса без изменений.

**Отрицательное доказательство (откачено):** `isStaleRiderRoute` без 404 → тест «404 (автор отозвал заявку)» красный.


**Проверки:** `MONGO_URL_TEST=…/pokatim_routes06_test REDIS_URL_TEST=…/13 TURBO_CONCURRENCY=1 pnpm check` → `EXIT=0`:
prettier — «All matched files use Prettier code style!»; eslint — 0; depcruise — «no dependency violations found»;
typecheck — `Tasks: 9 successful, 9 total`; test — `Tasks: 15 successful, 15 total` (admin 301 / 35 файлов, api 1169,
contracts 273, api-client 96). `pnpm --filter @pokatim/admin build` отдельно не запускался (typecheck и тесты — в
`check`).

### Этап C — приложение (coder, 2026-10-27)

**Сделано**
- Каталог: бейдж «От райдера» / «От райдера · Имя» (`routeAuthorLabel`, `Pill` рамки `RouteListCard` и шторки
  карточки); фильтр «Автор: Команда / Райдеры» (`AUTHOR_CHIPS`, `author` в ключе и запросе ленты, «Сбросить фильтры»).
- Карточка маршрута райдера: «Гонки на маршруте» не запрашиваются (RC-1); `['routes','viewer',id]` — только вошедшему,
  только клиент; «Пожаловаться» → `routes/report/[id]` по `canReport`, «Вы пожаловались на этот маршрут» по
  `reported`; мета — `robots: noindex` (RC-6), OG без имени автора.
- «Мои»: статус заявки бейджем в списке; блок «Публикация в каталоге» карточки (`my-route-publication.tsx`): «На
  проверке» + «Отозвать заявку», «В каталоге» + «Открыть в каталоге» и «Снять с публикации» (с подтверждением),
  «Отклонён» — причина `domain.routeRejectionReason.*` и комментарий, «Скрыт модератором» — пояснение; «Опубликовать» —
  по `canPublish`; переименование заморожено в `pending`/`approved` (409 — текстом по `details.reason`); удаление
  `approved` — «Маршрут исчезнет из каталога».
- Экран заявки `routes/mine/publish/[id]` (`my-route-publish.tsx`): предупреждение, город старта, покрытие, «Подписать
  моим именем», «Отправить на проверку»; отказы — `routePublicationErrorMessage` (лимиты U8 с `max`, состояние, 429,
  сеть). Экран жалобы `routes/report/[id]` (`route-report.tsx`). Оба — в `Stack.Protected` и `app-routes.ts`.
- i18n — только новые ключи; правило `.claude/rules/pokatim-app.md` — пункт «Публикация своих маршрутов».

**Тесты:** `my-route-publication.test.tsx` (24: статусы и действия, подтверждения, 409 `hidden`/`in_review`, удаление
опубликованного, форма заявки, 6 отказов, `canPublish: false`, 404, невалидный id, гость → вход),
`route-report.test.tsx` (12: форма, ≤ 500, отказы own/team/429/сеть/404, `reported`, `canReport: false`, гость →
вход), `route-detail.test.tsx` (+5: бейдж, гонки не запрашиваются для райдера, гость — без `me` и «Пожаловаться»,
команда — без бейджа и `me`, свой — без кнопки), `routes.test.tsx` (+2: бейдж/имя, фильтр «Автор» × покрытие, сброс),
`route-list-card.test.tsx` (+6), `route-metadata.test.ts` (+2: `noindex` райдера, OG без имени), `format.test.ts`,
`filters.test.ts`.

**Отрицательное доказательство (откачено):** гонки запрашиваются при любом `author` → 2 теста «routes-06» в
`route-detail.test.tsx` красные (`listRaces` вызван).

**Проверки:** `MONGO_URL_TEST=…/pokatim_routes06_test REDIS_URL_TEST=…/13 TURBO_CONCURRENCY=1 pnpm check` → `EXIT=0`:
prettier — «All matched files use Prettier code style!»; eslint — 0; depcruise — «no dependency violations found»;
typecheck — `Tasks: 9 successful, 9 total`; test — `Tasks: 15 successful, 15 total` (app 1260 / 139 сьютов, admin 301,
api 116 файлов). NOT VERIFIED: ручная проверка на симуляторе и в браузере (`build:web` + `start:web`) — не делалась;
новые экраны за входом, шаг Playwright-смоука не добавлялся.

### Фиксы ревью pass 1 (coder, 2026-10-27)

Все находки pass 1 (findings.md — Claude, findings-codex.md — Codex) проверены по коду и подтверждены; оспоренных нет.
Решения по контракту — §8.2 «Фиксы ревью pass 1».

1. **[HIGH] Перечитывание карточки заявки в панели** (`RiderRouteScreen.tsx`). Подтверждено: `refetch()` не бросает,
   TanStack Query оставляет `data`, ветка ошибок была только при `!route.data`, `reload` снимал баннер безусловно.
   Исправлено: 403 при любой загрузке — `NoAccessScreen`; 404 при показанной заявке — «Заявка не найдена» без линии и
   действий (та же ветка, что при первой загрузке); прочая ошибка — `Banner` «Не удалось обновить данные» с «Повторить»
   поверх последних данных; конфликт снимается только при `result.isSuccess`. Тесты (`RiderRouteScreen.test.tsx`, кеш
   заполнен, затем ошибка «Обновить»): 404 → «Заявка не найдена», нет «Одобрить» и линии; 500 → баннер, конфликт и
   заголовок остаются, «Повторить» с успехом снимает оба баннера; 403 → «Нет доступа к разделу». До фикса — 3 красных.
2. **[HIGH/MEDIUM] «Отклонить жалобы» и невиденная жалоба.** Подтверждено (`$max lastReportAt`, `version` не меняется).
   Исправлено: `recordRouteReport` — `$inc publication.reportRevision`; `clearRouteReports` — `reportRevision` в
   фильтре; сервис — сверка до перехода (409 `CONFLICT`); подача переносит ревизию (`$ifNull`). Контракт, api-client
   (тест), панель (`ReasonDecisionDialog` шлёт `reportRevision`; «Отклонить жалобы» — при `openReportCount > 0`).
   Тест `routes-moderation.int.test.ts` — `it.each` новой жалобы: позже, в ту же миллисекунду, задержанная с более
   ранним временем → 409, обе жалобы открыты, журнала нет. **Отрицательное доказательство (откачено):** без сверки
   ревизии в сервисе и фильтре — все 3 случая красные.
3. **[MEDIUM] Rename в `hidden` без смены версии.** Подтверждено. Исправлено: `renameOwn` — pipeline-обновление,
   `publication.version + 1` при объекте `publication` (`null` не трогается). Тест «„Вернуть“ после переименования
   скрытого автором — 409, вне каталога; по новой версии — 200». **Отрицательное доказательство (откачено):** `+0` вместо
   `+1` → «expected 200 to be 409».
4. **[MEDIUM] Квота при параллельных подачах.** Подтверждено. Исправлено: транзакция «запись → квота» (§8.2). Тест
   `routes-publication.int.test.ts` «параллельные подачи одного маршрута»: ворота на `countPendingOwn` пропускают
   4 запроса через проверки состояния одновременно → `[200, 409, 409, 409]`, `submissionCount: 1`; потрачено 7 из 10 —
   ещё 3 успешные подачи, 11-я — 429. До фикса — красный (проигравшие списали квоту).
5. **[LOW] Блок «Публикация» молча исчезает после 3 подач.** Подтверждено. Исправлено: `MyRoute.submissionsExhausted`
   (сервер), блок показывает `routes.publication.noSubmissionsLeft` при `!canPublish && (submissionsExhausted ||
   rejected)`. Тесты: контракт (дефолт `false`, строгий boolean), int (`submissionsExhausted` после 3-й подачи —
   отклонённый и отозванный; `false` у свежего), приложение «отозван или снят после 3-й подачи — пояснение, без
   „Опубликовать“» (до фикса красный); «canPublish false (старый API)» остался зелёным.
6. **[LOW] Документация.** `pokatim-security.md` — видимость каталога и GPX через `findInCatalog` (`IN_CATALOG`),
   `findPublished` — только порт гонок; `pokatim-app.md` — ключ ленты routes-01 с `author`, пояснение исчерпанных
   подач; `pokatim-web.md` — `reportRevision`, ошибки перечитывания; `pokatim-db.md`, `pokatim-backend.md`,
   `pokatim-contracts.md` — `reportRevision`, rename `+1`, транзакция подачи, `submissionsExhausted`.

Попутно замечено, не исправлялось (вне находок): `RideModerationScreen.tsx` (05b) — тот же шаблон `reload` без проверки
результата `refetch`.

Попутно — фикстуры `MyRoute` с `submissionsExhausted: false` в тестах приложения (`my-routes.test.tsx`,
`route-list-card.test.tsx`, `my-route-format.test.ts`) и api-client (выходной тип схемы стал обязательным).

**Проверки:** `MONGO_URL_TEST=…/pokatim_routes06_test REDIS_URL_TEST=…/13 TURBO_CONCURRENCY=1 pnpm check` → `EXIT 0`:
prettier — «All matched files use Prettier code style!»; eslint — 0; depcruise — «no dependency violations found»;
typecheck — `Tasks: 9 successful, 9 total`; test — `Tasks: 15 successful, 15 total` (api 1173 / 116 файлов, admin 304,
contracts 273, api-client 96, app 1261 / 139 сьютов). NOT VERIFIED: ручная проверка панели и приложения в браузере и
на симуляторе.

### Фиксы ревью pass 2 (coder, 2026-10-27)

Находки проверены по коду — все четыре подтверждены.

1. **[HIGH] `RouteReportAction` молча скрывал «Пожаловаться» при загрузке и ошибке `me`.** Исправлено: блок — `AsyncContent`
   (скелетон строки, «Не удалось загрузить» / «Нет соединения» с «Повторить», баннер «Данные могли устареть» поверх
   действия). Гостю и маршруту команды запрос выключен — в тело шторки передаётся `viewer: null`, блока нет (иначе
   выключенный запрос `isPending` дал бы вечный скелетон). Тесты `route-detail.test.tsx`: первая загрузка — скелетон;
   500 без данных — ошибка, повтор возвращает «Пожаловаться»; ошибка pull-to-refresh — действие остаётся, баннер.
   До фикса — все три красные. Гость и маршрут команды — прежние тесты зелёные.
2. **[HIGH] Экран жалобы без состояний запроса карточки.** Исправлено: название — свой `AsyncContent` (скелетон
   `titleSm`, ошибка с повтором, баннер при ошибке обновления), форма показывается по `me` независимо. Тесты
   `route-report.test.tsx`: «me успешен, карточка 500 → повтор восстанавливает название», первая загрузка — скелетон
   названия. До фикса — красные.
3. **[LOW] Исключение R12 для квоты подачи.** Комментарий в `MyRoutePublicationService.submit()` по образцу
   `registration.service.ts`; `pokatim-db.md` — перечень исключений (регистрация R12 и квота подачи маршрута). §8.2.
4. **[LOW] Пояснение об исчерпанных подачах у `pending`/`approved`/`hidden`.** Исправлено (вариант (а), §8.2):
   `exhausted = !canPublish && (rejected || (publication === null && submissionsExhausted))`. Тест `it.each` по трём
   статусам с `submissionsExhausted: true` — без пояснения (до фикса — 3 красных); прежние тесты `publication: null` и
   «Отклонён без подач» зелёные. `pokatim-app.md` обновлён.


**Проверки:** `MONGO_URL_TEST=…/pokatim_routes06_test REDIS_URL_TEST=…/13 TURBO_CONCURRENCY=1 pnpm check` → `EXIT 0`:
prettier — «All matched files use Prettier code style!»; depcruise — «no dependency violations found»; typecheck —
`Tasks: 9 successful, 9 total`; test — `Tasks: 15 successful, 15 total` (api 116 файлов, admin 35, app 1269 тестов).
Первый прогон упал на `bottom-sheet.test.tsx` (routes-04d, «шторку схватили посреди снапа» — тайминг под нагрузкой; файл
не менялся): отдельно 3/3 зелёный, повторный полный прогон зелёный. NOT VERIFIED: ручная проверка на симуляторе и в браузере.
