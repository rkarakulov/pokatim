# Findings — social-p7-home — pass 1 — reviewer: claude
base: origin/develop   commits: eee8286c..4c0d3311 (feature/social-p7-home, без merge-коммита develop)
verdict: APPROVE

Проверено (evidence): таргетные тесты на изолированной БД (`pokatim_social_p7_review_test`, Redis db 8) —
`social-home*`, `social-notices*`, `identity/active-day*`, `social-ride-ask*`, `notification-intake.test.ts`,
`rides-join-source*`: 8 файлов, 91 тест, зелёные. `pnpm arch:check` — без нарушений (2547 модулей).
`registerQueue` для `social-*` — один, в `social/social.module.ts:118`; `app.module.ts`, `worker.module.ts`,
`outbox-routes.ts` не тронуты. Полный `pnpm check`, e2e и ручная проверка на устройствах — NOT VERIFIED (по условию
задачи не запускались).

По измерениям без находок: outbox `social.*` пишется в той же `transactions.run`, что и действие (реакция, `addManual`,
`linkInvite`, захват `askedAt`); payload — только id; повтор задачи защищён уникальным `(sourceEventId, userId)` и
окнами P1 (тест «повтор задачи — без дублей»). `already_linked` события не пишет. K11: гонка двух первых `addManual`
даёт `WriteConflict`, повтор `withTransaction` видит `before.removedAt === null` и не уведомляет второй раз;
`{ manualNoticeAt: null }` совпадает и с отсутствующим полем. «Свои идут»: записавшийся — по `seq`, непубличный — без
черновика, аудитория — взаимная, минус организатор и участники; большая аудитория — `planFanout`. `GET social/home`:
`AuthGuard`, `no-store`, лимит первым, «свои» — только из `listOf` (публичные с согласием `showNameInResults`, не
убранные), райды — только при взаимной связи (RC-P7-1a), `userId` в ответ не попадает (явные поля
`homeRiderOf`). Активный день: не бросает, ожидание ограничено 200 мс, `props: { day }`, лог без uid; панель и
публичные ручки не задеты. Миграция `0050_social_home` — только `createIndex`, идемпотентна, номер идёт после
последней в develop (`0049`). Контракт терпимый (незнакомые строки отбрасываются, `deltaSec.default(null)`).
Клиент: слот, источники `social_home` / `notification` (приложение и SW), ошибка/404/пусто — секции нет, i18n — в
`packages/i18n`. Исключение §4.12 (нет скелетона) — явное решение RC-P7-17, записано в `pokatim-app.md` и `home.md`.
Documentation Sync §10 — ADR-0027, `social.md`, `home.md`, все пять `.claude/rules/pokatim-*.md` обновлены.

### [MEDIUM] a11y-подпись строки результата подставляет весь текст строки вместо времени
- **file:** apps/app/src/features/social/social-home-section.tsx
- **location:** `SocialResultRow`, ~стр. 63–80 (`time: title`)
- **problem:** `title = resultText(row)` — это уже «Андрей К. · 1:59:40»; он идёт в `{time}` ключа
  `social.home.a11yResult` («{name}, {race}: место {place}, время {time}»).
- **why_it_matters:** скринридер читает «Андрей К., Гран-при: место 1, время Андрей К. · 1:59:40» — имя дважды, лишний
  разделитель. Подписи a11y — требование AC9 / §3.2 спеки; тест экрана подпись не проверяет, поэтому ошибка прошла.
- **evidence:** `const title = resultText(row);` … `t('social.home.a11yResult', { name: row.rider.name, race: row.race.title, place, time: title })`
- **recommended_fix:** передавать `time: formatElapsed(row.elapsedSec)`; добавить в `home-social.test.tsx` проверку
  `getByRole('link', { name: … })` с точной подписью.

### [MEDIUM] `ownerIdsOf(viewerId)` на каждый запрос Главной читает все входящие связи без предела
- **file:** apps/api/src/modules/social/connections.repository.ts, apps/api/src/modules/social/social-home.service.ts
- **location:** `ownerIdsOf` (~стр. 254–259); `homeOf` — `new Set(await this.repository.ownerIdsOf(viewerId))`
- **problem:** для взаимности нужны только владельцы из ≤ 500 «своих» зрителя, а запрос
  `find({ otherId: viewer, removedAt: null })` без `limit` поднимает все входящие связи (у популярного организатора —
  тысячи) на каждый `GET social/home` (60/мин на пользователя, refetch при фокусе). Спека §11.3 предусматривала
  `ownerIdsOf(otherId, limit?)`.
- **why_it_matters:** нагрузка на чтение и память растёт с популярностью зрителя, а не с размером ответа (≤ 3 строки);
  остальные запросы Главной ограничены (`homeConnectionsMax`, `$in` ≤ 500).
- **evidence:** `.find({ otherId, removedAt: null }, { projection: { _id: 0, ownerId: 1 } }).toArray()` — без `limit`.
- **recommended_fix:** для Главной — ограниченный запрос `{ ownerId: { $in: friendIds }, otherId: viewerId, removedAt: null }`
  (`owner_other_unique`, ≤ 500 id), то есть «кто из моих своих держит связь ко мне»; `ownerIdsOf` без предела оставить
  только аудитории «Свои идут», где фан-аут и так режется пачками.

### [LOW] Снимок протокола читается параллельными операциями в одной snapshot-сессии
- **file:** apps/api/src/modules/results/results-read.service.ts
- **location:** `recentPublicRows`, `withSnapshot` → `Promise.all(races.map(… protocolRevision(race.id, session)))`
- **problem:** у snapshot-сессии время снимка (`atClusterTime`) задаёт ответ первой операции. Если до 20 чтений
  `protocolRevision` уходят одновременно, ни одно не несёт `atClusterTime`, и ревизии со строками могут прочитаться в
  разные моменты.
- **why_it_matters:** если ревизию переопубликовали прямо во время запроса, Главная может ненадолго показать строку
  прошлой ревизии (например, ещё не DQ). Влияние небольшое (≤ 3 строки, `no-store`), но гарантия «одного снимка» из
  комментария не держится. Ещё это 20 запросов на каждую загрузку Главной.
- **evidence:** `await Promise.all(races.map(async (race) => [race.id, await this.protocolRevision(race.id, session)] as const))`
- **recommended_fix:** читать ревизии последовательно или одним запросом по `raceId $in` в сессии; первым — одно
  чтение, которое задаёт время снимка.

### [LOW] Доказательства `explain` неполные, а запрос маршрутов в тесте не тот, что в репозитории
- **file:** apps/api/src/modules/social/social-home.int.test.ts
- **location:** `describe('индексы запросов портов (RC-P7-16)')`
- **problem:** §7 спеки: «каждый новый запрос — с отрицательным доказательством `explain`». Нет `explain` для
  `rider_connections` (`ownerIdsOf` → `rider_connections_other_idx`, `otherIdsAmong` / `isConnected` →
  `owner_other_unique`). Запросы в тесте написаны вручную, а не взяты из репозиториев. Для маршрутов фильтр другой
  (`'catalog.publishedAt': { $type: 'date', $gte }`, `ownerUserId $in`, без `status`/`IN_CATALOG`/`origin`/
  `showAuthorName`), хотя комментарий говорит «тем же запросом, что `recentRiderCatalog`».
- **why_it_matters:** если запрос в репозитории изменится (поле, `hint`), тест его не заметит; для маршрутов
  проверяется другой план.
- **evidence:** тест `routesDb(h).routes.find({ 'catalog.publishedAt': { $type: 'date', $gte: since }, ownerUserId: { $in: ids } })`
  против `recentRiderCatalog` — `$and: [{ status: 'ready', ...IN_CATALOG }, { origin: 'rider', … }]`.
- **recommended_fix:** вынести фильтры в экспортируемые функции репозиториев (или звать `explain` через тот же курсор),
  добавить планы для `rider_connections`.

### [LOW] Новый код вставлен между JSDoc и его объявлением — комментарии оторвались
- **file:** apps/api/src/modules/races/races.repository.ts; apps/api/src/modules/results/results-read.service.ts
- **location:** `races.repository.ts` ~229 (`/** Гонки по id … */` теперь над `protocolsPublishedSince`, а не над
  `findRaces`); `results-read.service.ts` ~67–71 (JSDoc `defaultGroup` теперь над `RECENT_PROTOCOL_RACES`)
- **problem:** два JSDoc идут подряд; IDE и читатель привязывают описание не к тому символу.
- **why_it_matters:** документация в коде вводит в заблуждение (`findRaces` и `defaultGroup` остались без описания).
- **evidence:** `/** Гонки по id (`_id` — индекс); незнакомые id — без документа. */` сразу перед `/** Опубликованные гонки с протоколом …`.
- **recommended_fix:** перенести новые объявления выше или ниже, чтобы каждый JSDoc стоял над своим символом.

### [LOW] `accessibilityLabel` на `View` без `accessible` у строк райда и маршрута
- **file:** apps/app/src/features/social/social-home-section.tsx
- **location:** `SocialRideRow` (`testID="social-home-ride"`), `SocialRouteRow` (`testID="social-home-route"`)
- **problem:** у `View` без `accessible` подпись на iOS не озвучивается. Если включить `accessible`, станут
  недоступны вложенные кнопка «Я иду» и карточка. Сейчас подписи `a11yRide` / `a11yRoute` не работают на native, а на
  web дают дубль.
- **why_it_matters:** a11y-подписи из §3.2 есть в i18n, но на iOS фактически не читаются.
- **evidence:** `<View testID="social-home-ride" accessibilityLabel={t('social.home.a11yRide', …)}>` — без `accessible`.
- **recommended_fix:** подпись повесить на нажимаемые элементы (`RideListRow` / `RouteListCard`, если принимают
  `accessibilityLabel`) или на текст кикера/стопки; с `View` убрать.

### [LOW] RC-P7-1 (взаимность для райдов) ещё ждёт продуктового ответа
- **file:** docs/product/social.md; docs/tasks/2026-11-01-social-p7-home/task.md §8.1, §12
- **location:** K7, K10 «Свои идут» — пометка `[ASSUMPTION]`
- **problem:** поведение (райды и push «Свои идут» — только при взаимной связи) записано в продуктовый документ до
  ответа автора.
- **why_it_matters:** вариант (a) — безопасный по приватности (как K6), но меняет охват K7/K10. Если автор выберет (b),
  понадобятся правка кода и доков.
- **evidence:** §12: «RC-P7-1 реализован вариантом (a) — ждёт ответа автора».
- **recommended_fix:** до merge получить ответ пользователя и снять `[ASSUMPTION]` или отметить решение в PR.

Итог: CRITICAL — 0, HIGH — 0, MEDIUM — 2, LOW — 5. Вердикт — APPROVE.

## Исправлено после прохода 1

- MEDIUM a11y строки результата — в `{time}` передаётся `formatElapsed(row.elapsedSec)`; точная подпись проверяется в
  `home-social.test.tsx`.
- MEDIUM входящие связи без предела — `ConnectionsRepository.ownersAmong(viewerId, friendIds)` (`owner_other_unique`,
  пачки `bulkBatch`) вместо `ownerIdsOf` в `SocialHomeService`; `ownerIdsOf` остаётся только аудитории «Свои идут».
- LOW оторванные JSDoc (`races.repository.ts`, `results-read.service.ts`) — возвращены к своим функциям.
- Остальные LOW (snapshot-ревизии, `explain` для связей, a11y-подписи на `View` iOS) — follow-up, поведение не
  ломают.
