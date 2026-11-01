# task.md — sitemap index гостевого веба (sitemap-index)

Уровень: task2. Follow-up из `docs/tasks/2026-10-29-landing-seo/task.md` (§12 Open follow-ups).

## 1. Title

`sitemap.xml` — sitemap index; дочерние карты по виду и странице, все публичные объекты без потери свежих.

## 2. Goal

Сейчас карта — один `urlset`, до 10 000 объектов на вид по `(updatedAt, _id)` ↑: при росте свежие объекты выпадают.
Карта должна перечислять **все** публичные гонки, сезоны, маршруты каталога и старты календаря, в пределах протокола
sitemaps.org (≤ 50 000 URL и ≤ 50 МБ на файл).

## 3. Scope

- **Форма URL** (решение): `/sitemap.xml` — `<sitemapindex>`; дочерние — `/sitemap/static.xml` (лендинг `/welcome`) и
  `/sitemap/<kind>/<n>.xml` (`kind` из `SITEMAP_KINDS`, `n` с 1). Expo Router (58, `@expo/router-server`
  `getNamedParametrizedRoute`, `expo-router` `matchDynamicName`): динамический сегмент — только **весь** сегмент
  `[name]`; `[page].xml+api.ts` стал бы статическим сегментом `[page].xml`. Поэтому маршрут
  `src/app/sitemap/[kind]/[page]+api.ts`, сегмент `page` = `<n>.xml` разбирается в обработчике (иное — `404`).
  Статический `sitemap/static.xml+api.ts` — другой глубины, не конфликтует.
- **Ключ страниц — `_id` ↑** (uuidv7, стабилен: правка объекта не переносит его между страницами, новые — в конец).
  Не `(updatedAt, _id)`: при правке объект «уезжал» бы в конец и страницы плыли.
- **API**: `GET /v1/sitemap` — индекс `{ pages: [{ kind, page, updatedAt }] }` (`updatedAt` — максимум по странице,
  `lastmod` дочерней карты); `GET /v1/sitemap/:kind/:page` — `{ items: [{ id, updatedAt }] }`, страница вне индекса —
  `404`, неверный вид/номер — `400`. Публичное чтение (`PublicReadGuard`), `Cache-Control` как у прочих.
- **Сервис**: индекс — полный keyset-проход по `_id` (покрывающий индекс, проекция `_id, updatedAt`), в памяти только
  границы страниц (`after`, `last`, max `updatedAt`) — O(страниц), мемо `memoMs`. Страница `n` — keyset
  `(after, last]`; последняя — `(after, ∞)` не больше `pageSize` (новые объекты после индекса — до следующего окна).
  Мемо страниц — то же окно, не больше `pageMemoMax` записей. Сбой не запоминается.
- **Порты владельцев**: `sitemapAfter(afterId, limit)` в `RacesForSharing` (гонки), `sitemapSeasonsAfter` (вместо
  `sitemapSeasons()`), `RoutesForSharing`, `CalendarForSharing`.
- **Индексы**: `0051_sitemap_indexes` — `{ status: 1, _id: 1, updatedAt: 1 }` на `races`, `routes`,
  `calendar_starts` (сезоны — по `_id_`). План без `SORT` — int-тест.
- **App**: `seo.ts` — `sitemapIndexXml`, `sitemapPageXml`, `staticSitemapXml`; маршруты `sitemap.xml+api.ts` (индекс),
  `sitemap/static.xml+api.ts`, `sitemap/[kind]/[page]+api.ts`. Чтение — `fetchPublicForSsr` (кэш 60 с, таймаут 2 с),
  API недоступен — `503` + `Retry-After`, нет `WEB_ORIGIN` — `404`.

## 4. Out of Scope

Отдельный таймаут SSR-чтения для карты (индекс теперь — только границы страниц, страница ≤ 10 000 строк по
покрывающему индексу); stale-while-revalidate мемо; `lastmod` сезонов (таблица сезона меняется с результатами).

## 8.1 Риски

- Деплой API и web не атомарен: старый web на новом API (или наоборот) — `503` до выката второго, краулер повторит.
- Удаление/снятие объекта сдвигает границы только внутри окна мемо; потерь нет (страница `n` — по границам индекса).
- uuidv7 api-kit случаен внутри миллисекунды: вставка внутрь диапазона возможна — страница `(after, last]` вырастет
  на единицы (потолок `fileUrlMax`), без потерь; поэтому границы — пара `after/last`, а не `after + limit`.

## 8.2 Deviations from spec

- Номер миграции: `0050` занят `0050_social_home` (develop) — миграция `0051_sitemap_indexes`.

## 8.3 Security checklist

- AuthN: оба эндпоинта публичны, только опубликованное (фильтры портов), без ПДн (id и дата).
- Ввод: `kind` — enum, `page` — `^[1-9]\d{0,5}$`; в app — та же проверка до запроса (без инъекции пути).
- Злоупотребления: IP-лимит `public-read`, мемо индекса и страниц; номер вне индекса — `404` без чтения БД.

## 9. Acceptance Criteria

- AC1: `/sitemap.xml` — `<sitemapindex>` с `static.xml` и всеми страницами API, абсолютные `loc`, `lastmod` (кроме
  сезонов); пусто — только `static.xml`. `404` без `WEB_ORIGIN`, `503` + `Retry-After` при недоступном API.
- AC2: `/sitemap/<kind>/<n>.xml` — `urlset` объектов страницы с `lastmod` (кроме сезонов), экранирование XML; неверный
  вид/номер — `404` без запроса; страница вне индекса API — `404`; API недоступен — `503`.
- AC3: `GET /v1/sitemap` — страницы видов по `pageSize`, объекты не теряются и не дублируются при > `pageSize` (int на
  малом `pageSize`), свежие попадают; непубличные — нет; `Cache-Control: public, max-age=60`.
- AC4: `GET /v1/sitemap/:kind/:page` — объекты страницы по `_id` ↑; вне индекса — `404`; неверные параметры — `400`.
- AC5: мемо: в окне — без чтения БД, после — заново; сбой не запоминается.
- AC6: план keyset-запроса — `IXSCAN` по `*_sitemap_idx`, без `SORT`; миграция последняя, идемпотентна.
- AC7: `robots.txt` — по-прежнему `Sitemap: <origin>/sitemap.xml`; сторож маршрутов зелёный.

## 10. Documentation

`docs/product/landing.md` (Web и SEO, Вне scope), `.claude/rules/pokatim-app.md` (маршруты карты),
`.claude/rules/pokatim-backend.md` (эндпоинты и ключ страниц).

## 11. Implementation Context

contracts `sharing/sitemap.schema.ts`; api `sharing/{sitemap.*,sharing.policy.ts}`, порты и репозитории
`races|routes|calendar`, `changed-since.ts`, `db/migrations/0051_sitemap_indexes.ts`; app `lib/seo.ts`,
`app/sitemap.xml+api.ts`, `app/sitemap/**`. Тесты: `sitemap.schema.test.ts`, `sitemap.service.test.ts`,
`sitemap.int.test.ts`, `races-for-sharing.int.test.ts`, `migrations.int.test.ts`, `seo-routes.test.ts`, e2e
`web.spec.ts` (смоук).

## 12. Outcome

- **Changes:** contracts — `SitemapIndex`, `SitemapPage`, `SitemapPageParams` (вместо `SitemapEntries`); api —
  `SitemapService` (границы страниц, мемо индекса и страниц), `GET /v1/sitemap/:kind/:page`, `SITEMAP_POLICY`
  (`pageSize`, `fileUrlMax`, `pageMemoMax`), `sitemapAfter` портов races/routes/calendar, `sitemapSeasonsAfter`
  (вместо `sitemapSeasons()`), `idAfter`/`ID_SORT`, миграция `0051_sitemap_indexes`; app — `seo.ts`
  (`sitemapIndexXml`, `staticSitemapXml`, `sitemapPageXml`, `parseSitemapPagePath`), `lib/sitemap-route.ts`,
  маршруты `sitemap.xml+api.ts`, `sitemap/static.xml+api.ts`, `sitemap/[kind]/[page]+api.ts`; e2e-смоук.
- **Docs:** `docs/product/landing.md`, `.claude/rules/pokatim-app.md`, `.claude/rules/pokatim-backend.md`.
- **Проверки:** contracts vitest `sitemap.schema` 7/7; api unit `sitemap.service` 10/10; int `sitemap`,
  `races-for-sharing`, `migrations` — 66/66 (план keyset — `IXSCAN *_sitemap_idx` без `SORT`, гонки/старты без
  `FETCH`); jest `seo-routes` 15/15; eslint изменённых — чисто; typecheck api/app/contracts — ок; `format:check`,
  `arch:check` — ок. Полный `pnpm check` не запускался (по указанию); e2e Playwright — NOT VERIFIED.
- **Open follow-ups:** отдельный таймаут SSR-чтения индекса на очень больших объёмах (полный проход видов при
  истёкшем мемо) или stale-while-revalidate.
