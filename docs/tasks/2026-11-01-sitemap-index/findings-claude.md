# Findings — sitemap-index — pass 1 — reviewer: claude
base: origin/develop (merge-base)   commits: 3649ed58
verdict: REQUEST CHANGES

Блокер: HIGH-1 (дочерние карты лежат в подкаталоге `/sitemap/…`, а перечисляют URL вне его).

Проверено, замечаний нет: полнота и отсутствие дублей между страницами (границы `(after, last]`, фильтр
`id <= last`, `_id` — строки hex без collation у коллекции, порядок JS = порядок MongoDB); вставки uuidv7 внутрь
диапазона (страница растёт до `fileUrlMax`); фильтры публичности совпадают с прежним `changedForOg` (гонки —
`published`, маршруты — `ready` + `IN_CATALOG`, старты — `published`); ответ API — только `id`/`updatedAt`; вход —
zod-enum и `^[1-9]\d{0,5}$` в API и в app (без инъекции пути); `404` вне индекса без чтения коллекции; миграция —
expand-only, `createIndex` с тем же именем и ключом идемпотентен, номер 0051 после `0050_social_home`, int-тест
повторного `up`; экранирование XML в `loc`, `lastmod` из провалидированной даты; robots — `Sitemap:
<origin>/sitemap.xml`, ни один префикс `SEO_DISALLOW` не закрывает `/sitemap/`; сторож маршрутов смотрит только
`.tsx`, новые `+api.ts` его не задевают; nginx отдаёт `/` в web целиком; мемо — сбой не запоминается, вытеснение
безопасно для запросов в полёте. Неатомарный деплой (старый web на новом API и наоборот) даёт `503`/`404` — этот риск
принят в §8.1. Тесты и `pnpm check` не запускал (по указанию); e2e — NOT VERIFIED.

### [HIGH] Дочерние карты в `/sitemap/<kind>/` перечисляют URL вне своего каталога — по протоколу они недействительны
- **file:** apps/app/src/lib/seo.ts
- **location:** 102 (`STATIC_SITEMAP_PATH = '/sitemap/static.xml'`), 105 (`sitemapPagePath` → `/sitemap/${kind}/${page}.xml`); маршруты `apps/app/src/app/sitemap/static.xml+api.ts`, `apps/app/src/app/sitemap/[kind]/[page]+api.ts`
- **problem:** `/sitemap/race/1.xml` содержит `<loc>https://…/races/<id></loc>`, а `/sitemap/static.xml` — `/welcome`.
  Протокол sitemaps.org (раздел «Sitemap file location») прямо это запрещает: «The location of a Sitemap file determines
  the set of URLs that can be included in that Sitemap. A Sitemap file located at http://example.com/catalog/sitemap.xml
  can include any URLs starting with http://example.com/catalog/ but can not include URLs starting with
  http://example.com/images/». Google в «Build and submit a sitemap» пишет так же: «a sitemap affects only
  descendants of the parent directory». Обход через robots.txt снимает ограничение только для карты, которая указана в
  `robots.txt`, то есть для индекса `/sitemap.xml`; на дочерние карты он не распространяется.
- **why_it_matters:** Цель задачи (§2: «перечислять **все** публичные …») может не выполниться. Строгий парсер
  (sitemaps.org, многие краулеры, возможно Яндекс — важен для BY/RU-аудитории) отбросит все URL дочерних карт как
  находящиеся вне их каталога. Тогда индекс есть, а реальных URL в нём ноль, и это хуже прежнего одного `urlset`.
  Насколько строго это применяют Google и Яндекс сегодня — NOT VERIFIED: нет доступа к сети и к Search Console.
  Сайт, подтверждённый в GSC, Google может обработать и так, но на это поведение нельзя опираться.
- **evidence:** `sitemapPagePath = (kind, page) => \`/sitemap/${kind}/${page}.xml\``; `sitemapPageXml` строит
  `${origin}${PAGE_PREFIX[kind]}/…` с `PAGE_PREFIX.race = '/races'`. Тест `seo-routes.test.ts` («объекты страницы
  API») закрепляет именно такую пару: путь `/sitemap/race/2.xml` и `loc` `/races/<id>`.
- **recommended_fix:** Положить дочерние карты в корень. Простой вариант без ограничений Expo Router — тот же
  `src/app/sitemap.xml+api.ts` с query: `/sitemap.xml?kind=race&page=1` возвращает `urlset`, а без параметров — индекс.
  `loc` в индексе уже экранируется (`&` → `&amp;`), разбор — тот же `parseSitemapPagePath` по `searchParams`, а
  `static.xml` превращается в `?kind=static`. Ещё вариант — плоские корневые файлы `sitemap-<kind>-<n>.xml`, если
  удастся обойтись без catch-all корневого сегмента. Обновить §3 task.md, rules `pokatim-app.md`, `landing.md`,
  тесты и e2e.

### [MEDIUM] `lastmod` страницы не меняется, когда сдвиг границ меняет её состав
- **file:** apps/api/src/modules/sharing/sitemap.service.ts
- **location:** `scanBounds` 98–122 (граница по счёту `count === pageSize`, строка 110), `updatedAt` страницы = максимум строк
- **problem:** Границы пересчитываются на каждой сборке индекса по счёту объектов. Когда публикуют старый черновик
  (его `_id` из времени создания, то есть не «в конец»), снимают или удаляют объект на странице `k`, сдвигаются составы
  **всех** страниц после `k`: на каждой границе объект переезжает на соседнюю страницу. `lastmod` соседних страниц
  при этом не меняется, потому что максимум `updatedAt` переехавших объектов обычно не новее прежнего.
  Утверждение §3/§8.1 «правка объекта не переносит его между страницами» верно только для правки. На публикации и
  снятии оно не держится.
- **why_it_matters:** Краулер не перечитывает страницу, у которой не изменился `lastmod`, и теряет из виду объекты,
  переехавшие через границу. Кроме того, Google учитывает `lastmod`, только если тот «consistently and verifiably
  accurate», а систематически неточный `lastmod` он может перестать учитывать для всего сайта.
- **evidence:** `if (count === SITEMAP_POLICY.pageSize) { pages.push({ after: pageAfter, last: row.id, updatedAt: maxAt }); … }`.
  Набор публичных объектов — фильтр по `status`, а `_id` черновика назначается при создании.
- **recommended_fix:** Сделать границы детерминированными, независимыми от числа объектов. Например, страница —
  диапазон времени в префиксе uuidv7 (`uuidv7Floor` уже есть в `changed-since.ts`); слишком полный диапазон можно
  делить. Тогда публикация или снятие меняют только свою страницу. Если оставлять границы по счёту, `lastmod`
  страницы надо поднимать до времени сборки индекса при смене её `after/last` относительно прошлого индекса
  (требует состояния), либо не отдавать `lastmod` у страниц индекса. Зафиксировать решение в §8.1.

### [LOW] Последняя страница ограничена `pageSize` и при полном индексе может временно терять объекты из своих границ
- **file:** apps/api/src/modules/sharing/sitemap.service.ts
- **location:** `read`, 125 (`const cap = final ? SITEMAP_POLICY.pageSize : SITEMAP_POLICY.fileUrlMax`)
- **problem:** Возьмём последнюю страницу, которая при сборке индекса заполнена ровно на `pageSize`. Если до конца окна
  мемо в её диапазон `(after, last]` попадёт объект (вставка uuidv7 в ту же миллисекунду или публикация недавнего
  черновика), чтение `(after, ∞)` с лимитом `pageSize` вытеснит хвостовые объекты, которые в индексе были. До
  следующей сборки они не попадут ни на одну страницу. Это расходится с §8.1 «без потерь» для вставок внутрь
  диапазона.
- **why_it_matters:** Потеря временная (до одного `memoMs`) и самоизлечивается, поэтому LOW.
- **evidence:** для `final` фильтра `row.id <= bounds.last` нет, и цикл останавливается на `cap = pageSize`.
- **recommended_fix:** Для последней страницы читать `(after, last]` с потолком `fileUrlMax`, а затем добирать новые
  `> last` до `pageSize`, то есть `cap = max(pageSize, в_границах)`.

### [LOW] Проход по ограниченной странице читает за `last` и запрос не ограничен сверху
- **file:** apps/api/src/modules/sharing/sitemap.service.ts
- **location:** `read`, 130–135
- **problem:** Порты принимают только `afterId`, поэтому последний чанк страницы читает до `scanPage` строк дальше
  `last`, а потом отбрасывает их фильтром. На каждой ограниченной странице это лишний keyset-чанк.
- **why_it_matters:** Лишняя нагрузка невелика (≤ `scanPage` ключей покрывающего индекса), поэтому только LOW.
- **evidence:** `const rows = await this.sources[kind](after, limit); const inPage = final ? rows : rows.filter((row) => row.id <= bounds.last);`
- **recommended_fix:** Добавить в `sitemapAfter` необязательную верхнюю границу `untilId` (`$lte`), это тот же индекс.
  Либо оставить как есть и описать в комментарии.

### [LOW] Тест плана повторяет запрос вручную и не вызывает репозиторий
- **file:** apps/api/src/modules/sharing/sitemap.int.test.ts
- **location:** describe «план keyset карты сайта», `winning` 149–151 и `inCatalog` в тесте маршрутов
- **problem:** `explain` строится по фильтру, переписанному в тесте (`status`, `catalog.publishedAt`, `$or` по
  `origin`), а не по `RoutesRepository.sitemapAfter`/`IN_CATALOG`. Если фильтр каталога или проекция в репозитории
  изменится, тест плана останется зелёным.
- **why_it_matters:** AC6 («план keyset-запроса — IXSCAN без SORT») проверяется на копии запроса, а не на нём самом.
- **evidence:** `routesDb(h).routes.find({ $and: [inCatalog, after] }, { projection })` при `IN_CATALOG` в
  `routes.repository.ts:117`.
- **recommended_fix:** Снимать план с настоящего запроса. Можно вынести фильтр `sitemapAfter` в экспортируемый
  билдер репозитория или проверять через профайлер/`explain` на курсоре, который вернул репозиторий.

### [LOW] Полный проход индекса при истёкшем мемо блокирует и запрос индекса, и запросы страниц (таймаут SSR 2 с)
- **file:** apps/api/src/modules/sharing/sitemap.service.ts
- **location:** `page` 74–83 → `bounds()` 91–96
- **problem:** `page()` сначала ждёт `bounds()`. После `memoMs` первый запрос и индекса, и **любой** страницы ждёт
  полный проход всех четырёх видов (N/`scanPage` последовательных запросов на вид). Если проход дольше 2 с
  (`TIMEOUT_MS` в `public-ssr.ts`), web отдаёт `503` и на индекс, и на страницы. Промис в мемо сохраняется, так что
  следующий запрос его получит, но краулер повторит только через `Retry-After: 300`.
- **why_it_matters:** На текущих объёмах это не проблема, и сам риск вынесен в Out of Scope / Open follow-ups. Отмечаю
  как LOW, чтобы follow-up не потерялся: страницы зависят от свежести индекса, а не только от своего мемо.
- **evidence:** `const pages = (await this.bounds())[kind];`
- **recommended_fix:** В рамках уже записанного follow-up — stale-while-revalidate для `boundsMemo`: отдавать прежние
  границы и обновлять их в фоне.
