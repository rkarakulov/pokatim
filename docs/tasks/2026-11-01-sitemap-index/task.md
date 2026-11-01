# task.md — sitemap index гостевого веба (sitemap-index)

Уровень: task2. Follow-up из `docs/tasks/2026-10-29-landing-seo/task.md` (§12 Open follow-ups).

## 1. Title

`sitemap.xml` — sitemap index; дочерние карты по виду и странице, все публичные объекты без потери свежих.

## 2. Goal

Сейчас карта — один `urlset`, до 10 000 объектов на вид по `(updatedAt, _id)` ↑: при росте свежие объекты выпадают.
Карта должна перечислять **все** публичные гонки, сезоны, маршруты каталога и старты календаря, в пределах протокола
sitemaps.org (≤ 50 000 URL и ≤ 50 МБ на файл).

## 3. Scope

- **Форма URL** (решение, ревью pass 1 HIGH): `/sitemap.xml` без query — `<sitemapindex>`; дочерние карты — **в корне
  сайта**, тот же маршрут `sitemap.xml+api.ts` с query: `/sitemap.xml?kind=static` (лендинг `/welcome`) и
  `/sitemap.xml?kind=<kind>&page=<n>` (`kind` из `SITEMAP_KINDS`, `n` с 1). Протокол sitemaps.org («Sitemap file
  location»): карта перечисляет только URL ниже своего каталога, поэтому подкаталог `/sitemap/…` для `/races/…`
  недействителен. Плоские `sitemap-<kind>-<n>.xml` в корне потребовали бы корневой динамический сегмент (Expo Router 58:
  динамический — только **весь** сегмент `[name]`), query — без него. Неверный query (чужой вид, номер, лишний или
  повторный параметр) — `404` без запроса к API; `&` в `loc` индекса — `&amp;`.
- **Ключ страниц — `_id` ↑** (uuidv7, стабилен: правка объекта не переносит его между страницами, новые — в конец).
  Не `(updatedAt, _id)`: при правке объект «уезжал» бы в конец и страницы плыли.
- **API**: `GET /v1/sitemap` — индекс `{ pages: [{ kind, page, updatedAt }] }` (`updatedAt` — `lastmod` дочерней
  карты, см. ниже); `GET /v1/sitemap/:kind/:page` — `{ items: [{ id, updatedAt }] }`, страница вне индекса —
  `404`, неверный вид/номер — `400`. Публичное чтение (`PublicReadGuard`), `Cache-Control` как у прочих.
- **Сервис**: индекс — полный keyset-проход по `_id` (покрывающий индекс, проекция `_id, updatedAt`), в памяти только
  границы страниц (`after`, `last`, число строк, max `updatedAt`) — O(страниц). Страница `n` — `(after, last]` с
  верхней границей в запросе (без чтения за `last`, потолок `fileUrlMax`); последняя — затем новые после `last`, пока
  страница не больше `pageSize` (свои строки не вытесняются). Поколение индекса (границы + мемо страниц, не больше
  `pageMemoMax`) живёт `memoMs`; страницы истекают вместе с ним (ревью pass 1 MEDIUM, Codex). Сбой не запоминается.
- **`lastmod` страницы** (решение, ревью pass 1 MEDIUM, Claude): максимум `updatedAt` строк; если состав страницы
  (`after`, `last`, число строк) изменился относительно прошлого поколения — момент сборки индекса (публикация старого
  черновика, снятие, сдвиг границ последующих страниц). Не границы по времени из префикса uuidv7: при них снятие
  объекта тоже не меняет `lastmod` страницы, а деление переполненных диапазонов усложняет схему. Цена — первое поколение
  процесса (после рестарта) прошлого не знает и отдаёт максимум `updatedAt`.
- **Порты владельцев**: `sitemapRange({ after, until }, limit)` в `RacesForSharing` (гонки), `sitemapSeasonsRange`
  (вместо `sitemapSeasons()`), `RoutesForSharing`, `CalendarForSharing`; репозитории — `sitemapCursor` (по нему же
  int-тест плана).
- **Индексы**: `0051_sitemap_indexes` — `{ status: 1, _id: 1, updatedAt: 1 }` на `races`, `routes`,
  `calendar_starts` (сезоны — по `_id_`). План без `SORT` — int-тест.
- **App**: `seo.ts` — `sitemapIndexXml`, `sitemapPageXml`, `staticSitemapXml`; `parseSitemapQuery`, `sitemapHref`; один маршрут
  `sitemap.xml+api.ts`. Чтение — `fetchPublicForSsr` (кэш 60 с, таймаут 2 с),
  API недоступен — `503` + `Retry-After`, нет `WEB_ORIGIN` — `404`.

## 4. Out of Scope

Отдельный таймаут SSR-чтения для карты (индекс теперь — только границы страниц, страница ≤ 10 000 строк по
покрывающему индексу); stale-while-revalidate мемо; `lastmod` сезонов (таблица сезона меняется с результатами).

## 8.1 Риски

- Деплой API и web не атомарен: старый web на новом API (или наоборот) — `503` до выката второго, краулер повторит.
- Удаление/снятие объекта сдвигает границы только внутри окна мемо; потерь нет (страница `n` — по границам индекса).
- `lastmod` после рестарта API: первое поколение не видит сдвигов, случившихся до рестарта, — до следующей смены
  состава страница отдаёт максимум `updatedAt` (один процесс API на окружение; мемо — в процессе).
- uuidv7 api-kit случаен внутри миллисекунды: вставка внутрь диапазона возможна — страница `(after, last]` вырастет
  на единицы (потолок `fileUrlMax`), без потерь; поэтому границы — пара `after/last`, а не `after + limit`.

## 8.2 Deviations from spec

- Номер миграции: `0050` занят `0050_social_home` (develop) — миграция `0051_sitemap_indexes`.
- Форма URL (ревью pass 1, HIGH): было `/sitemap/static.xml` и `/sitemap/<kind>/<n>.xml` — вне области перечисляемых
  URL; стало `/sitemap.xml?kind=…` в корне.

## 8.3 Security checklist

- AuthN: оба эндпоинта публичны, только опубликованное (фильтры портов), без ПДн (id и дата).
- Ввод: `kind` — enum, `page` — `^[1-9]\d{0,5}$`; в app — та же проверка query до запроса (без инъекции пути).
- Злоупотребления: IP-лимит `public-read`, мемо индекса и страниц; номер вне индекса — `404` без чтения БД.

## 9. Acceptance Criteria

- AC1: `/sitemap.xml` — `<sitemapindex>` с `?kind=static` и всеми страницами API, абсолютные `loc` в корне (`&amp;`),
  `lastmod` (кроме сезонов); пусто — только `?kind=static`. `404` без `WEB_ORIGIN`, `503` + `Retry-After` при недоступном API.
- AC2: `/sitemap.xml?kind=<kind>&page=<n>` — `urlset` объектов страницы с `lastmod` (кроме сезонов), экранирование XML; неверный
  вид/номер — `404` без запроса; страница вне индекса API — `404`; API недоступен — `503`.
- AC3: `GET /v1/sitemap` — страницы видов по `pageSize`, объекты не теряются и не дублируются при > `pageSize` (int на
  малом `pageSize`), свежие попадают; непубличные — нет; `Cache-Control: public, max-age=60`.
- AC4: `GET /v1/sitemap/:kind/:page` — объекты страницы по `_id` ↑; вне индекса — `404`; неверные параметры — `400`.
- AC5: мемо: в окне — без чтения БД, после — заново; страница истекает с поколением индекса; сбой не запоминается.
- AC5a: `lastmod` страницы меняется при смене её состава (публикация, снятие, сдвиг границ).
- AC6: план keyset-запроса — `IXSCAN` по `*_sitemap_idx`, без `SORT`; миграция последняя, идемпотентна.
- AC7: `robots.txt` — по-прежнему `Sitemap: <origin>/sitemap.xml`; сторож маршрутов зелёный.

## 10. Documentation

`docs/product/landing.md` (Web и SEO, Вне scope), `.claude/rules/pokatim-app.md` (маршруты карты),
`.claude/rules/pokatim-backend.md` (эндпоинты и ключ страниц).

## 11. Implementation Context

contracts `sharing/sitemap.schema.ts`; api `sharing/{sitemap.*,sharing.policy.ts}`, порты и репозитории
`races|routes|calendar`, `changed-since.ts`, `db/migrations/0051_sitemap_indexes.ts`; app `lib/seo.ts`,
`app/sitemap.xml+api.ts`. Тесты: `sitemap.schema.test.ts`, `sitemap.service.test.ts`,
`sitemap.int.test.ts`, `races-for-sharing.int.test.ts`, `migrations.int.test.ts`, `sitemap-indexes.int.test.ts`, `seo-routes.test.ts`, e2e
`web.spec.ts` (смоук).

## 12. Outcome

- **Changes:** contracts — `SitemapIndex`, `SitemapPage`, `SitemapPageParams` (вместо `SitemapEntries`); api —
  `SitemapService` (поколение индекса: границы страниц, мемо страниц, `lastmod` по смене состава),
  `GET /v1/sitemap/:kind/:page`, `SITEMAP_POLICY` (`pageSize`, `fileUrlMax`, `pageMemoMax`), `sitemapRange` портов
  races/routes/calendar, `sitemapSeasonsRange` (вместо `sitemapSeasons()`), `sitemapCursor` репозиториев,
  `IdRange`/`idWithin`/`ID_SORT`/`changedRows`, миграция `0051_sitemap_indexes`; app — `seo.ts` (`sitemapIndexXml`,
  `staticSitemapXml`, `sitemapPageXml`, `parseSitemapQuery`, `sitemapHref`), `lib/sitemap-route.ts`, маршрут
  `sitemap.xml+api.ts`; e2e-смоук.
- **Docs:** `docs/product/landing.md`, `.claude/rules/pokatim-app.md`, `.claude/rules/pokatim-backend.md`.
- **Ревью pass 1** (`findings-codex.md`, `findings-claude.md`) — REQUEST CHANGES, исправлено: HIGH — дочерние карты в
  корень (`?kind=…`); MEDIUM — мемо страниц внутри поколения индекса; MEDIUM — `lastmod` по смене состава; LOW —
  последняя страница не вытесняет свои строки, верхняя граница `until` в запросе, тест плана — через `sitemapCursor`.
  LOW (stale-while-revalidate) — follow-up.
- **Проверки:** см. отчёт коммита фиксов; полный `pnpm check` не запускался (по указанию); e2e Playwright — NOT VERIFIED.
- **Open follow-ups:** stale-while-revalidate поколения индекса (полный проход при истёкшем мемо блокирует индекс и
  страницы; таймаут SSR 2 с на очень больших объёмах).
