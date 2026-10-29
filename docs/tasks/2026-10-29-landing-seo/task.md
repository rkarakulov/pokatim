# task.md — SEO гостевого веба: robots.txt, sitemap.xml, OG лендинга (landing-seo)

Уровень: task2. Follow-up из `docs/tasks/2026-10-29-guest-landing/pr.md` и «Вне scope» `docs/product/landing.md`.

## 1. Title

`robots.txt` и `sitemap.xml` гостевого веба; OG-картинка лендинга `/welcome`.

## 2. Goal

Поисковики видят публичные страницы Покатим (лендинг, гонки, сезоны, старты календаря, маршруты каталога) и не тратят
обход на служебные и закрытые экраны. Превью ссылки на `/welcome` — карточка бренда.

## 3. Scope

- **S1. `GET /robots.txt`** — Expo API-маршрут `apps/app/src/app/robots.txt+api.ts` (паттерн
  `manifest.webmanifest+api.ts`). `User-agent: *`, `Allow: /`; `Disallow` — экраны только для вошедших, онбординг и
  настройка аккаунта, ссылки с токеном (`/auth/`, `/devices/return`), билеты `/tickets/`, `/admin/`, витрина
  `/ui-kit`. `/v1/` **не** закрыт (ревью pass 1, MEDIUM): Googlebot при рендере соблюдает robots и для fetch —
  публичные экраны догружают данные из API (гонки и таблица сезона), картинки превью — тоже `/v1/og/images/`. Карточки с `noindex` в мета (`/riders/<id>`, `/rides/<id>`) **не** закрываются: краулер должен
  увидеть `noindex`. `Sitemap: <WEB_ORIGIN>/sitemap.xml` — только при заданном `WEB_ORIGIN`.
- **S2. `GET /v1/sitemap`** (API, модуль `sharing`, без входа, `PublicReadGuard`, `Cache-Control: public,
  max-age=60`) → `SitemapEntries { items: [{ kind, id, updatedAt }] }`, `kind ∈ race | season | route | calendar`.
  Источник — порты владельцев `*_FOR_SHARING`: `ogChanged` гонок (опубликованные), маршрутов (каталог), стартов
  календаря (опубликованные) — постранично до лимита вида; сезоны — новый метод порта `RacesForSharing.sitemapSeasons()`
  (все сезоны публичны). Мемо в процессе API на 10 мин (сканы не чаще, даже при прямых запросах).
- **S3. `GET /sitemap.xml`** — Expo API-маршрут `apps/app/src/app/sitemap.xml+api.ts`: `/welcome` + записи API →
  `<urlset>` с абсолютными URL от `WEB_ORIGIN` и `lastmod` (кроме сезонов: таблица меняется с результатами, дата
  сезона её не отражает). Чтение — `fetchPublicForSsr` (кэш процесса 60 с). Нет `WEB_ORIGIN` — `404`; API недоступен —
  `503` + `Retry-After` (краулер повторит, не выкинет URL); успех — `Cache-Control: public, max-age=600`.
- **S4. OG `/welcome`** — уже сделано в og-images (PR #115): `landingMetadata` даёт бренд-картинку (`OG_BRAND`,
  шаблон «Классика»), `og:url` `/welcome`, `twitter:card`. Тесты есть (`public-metadata.test.ts`, «страницы-бренды»).
  В этой задаче — без изменений, только проверка.

## 4. Out of Scope

- Профили райдеров в sitemap: страница всегда `noindex` (D-B2, согласия на индексацию нет) — в sitemap не идут.
  Кофе-райды — тоже `noindex` (UGC, Q7).
- Индексируемость dev-стенда (nginx dev отдаёт `X-Robots-Tag: noindex, nofollow` — остаётся).
- Sitemap index (> 50 000 URL), своя OG-картинка сезона.

## 5. Architecture Context

- contracts: `packages/contracts/src/sharing/sitemap.schema.ts` — `SITEMAP_KINDS`, `SitemapEntry`, `SitemapEntries`.
- api: `sharing` — `SitemapController`, `SitemapService`; порт `races` расширен `sitemapSeasons()`. Миграций нет
  (индексы `{status, updatedAt, _id}` — из 0037; сезоны — десятки документов).
- app: `lib/seo.ts` (чистые `robotsTxt`, `sitemapXml`, `SEO_DISALLOW`), два API-маршрута.
- Очередей и outbox нет.

## 5.1 Placement & Reuse Gate

- Reuse: `OgCardInputs.changed` (порты `ogChanged`), `PublicReadGuard`/`PUBLIC_READ_CACHE_CONTROL`, `CLOCK`,
  `fetchPublicForSsr`, `ogOrigin()` (`WEB_ORIGIN`), паттерн API-маршрута manifest.
- Дубли запрещены: свои запросы `sharing` к чужим коллекциям — нет, только порты через `index.ts`.
- Контроллер тонкий, сбор и мемо — в `SitemapService`.

## 6. Relevant Files

- `apps/app/src/app/manifest.webmanifest+api.ts` — образец API-маршрута.
- `apps/app/src/lib/public-ssr.ts`, `apps/app/src/lib/og-image.ts` — SSR-чтение API и `WEB_ORIGIN`.
- `apps/app/src/app/_layout.tsx` — какие экраны под гардом входа (основа списка `Disallow`).
- `apps/api/src/modules/sharing/og-card.inputs.ts`, `og-card.controller.ts`, `sharing.module.ts`.
- `apps/api/src/modules/races/races-for-sharing{.port,}.ts`, `races.repository.ts`.
- `apps/api/test/og.ts`, `test/standings.ts` (`seedSeason`) — фикстуры.

## 7. Implementation Notes

- Лимит вида — `SITEMAP_KIND_LIMIT = 10_000` (страница скана 1 000): итог < 50 000 URL одного файла.
- `lastmod` — дата `YYYY-MM-DD` (UTC) — достаточно для поисковиков.
- XML экранируется (`&<>"'`), хотя id — Uuid по контракту, а origin — env.
- Сторож robots: тест обходит `src/app/**`, переводит файл в путь и требует, чтобы каждый маршрут был либо в списке
  публичных, либо закрыт `Disallow` — новый экран не забудут классифицировать.

## 8. Risks / Assumptions / Open Questions

- Таймаут `fetchPublicForSsr` 2 с — на реальных объёмах (сотни объектов) ответ мал. Рост до десятков тысяч —
  follow-up (свой таймаут или sitemap index).
- Скан идёт по `updatedAt` по возрастанию: при > 10 000 объектов вида в карту попадут старые, свежие выпадут —
  известное ограничение, решается вместе с sitemap index.
- Мемо 10 мин на процесс: новая гонка попадёт в sitemap с задержкой до ~11 мин — для поисковика несущественно.

## 8.1 Requirements Consistency

- **Недоопределено → решено:** «профили райдеров — только с публичным профилем/согласием». Согласия на индексацию
  нет, страница всегда `noindex` (D-B2) → в sitemap не включаем; `robots.txt` их не закрывает (иначе `noindex` не
  виден).
- **Недоопределено → решено:** вкладки `/races`, `/calendar`, `/routes`, `/` для гостя уводят на `/welcome` (гард) —
  в sitemap только `/welcome`; `/` (мета = мета лендинга, `og:url` `/welcome`) не дублируем.

## 8.2 Deviations from spec

- OG-картинка лендинга не меняется: уже есть с PR #115 (S4).

## 8.3 Security checklist

- AuthN: `/v1/sitemap` публичный, только опубликованное (порты фильтруют), без ПДн (id и дата изменения).
- Злоупотребления: IP-лимит `public-read`, мемо 10 мин — повторные запросы БД не сканируют.
- Данные наружу: `robots.txt` перечисляет только префиксы маршрутов, без токенов. Секретов нет.

## 9. Acceptance Criteria

- AC1: `/robots.txt` — `text/plain`, `Allow: /`, закрыты служебные префиксы, `/v1/` открыт, `Sitemap` с
  `WEB_ORIGIN`; без `WEB_ORIGIN` — без строки `Sitemap`.
- AC2: каждый маршрут `src/app` либо публичный (список в тесте), либо закрыт `Disallow`; `/riders/<id>`,
  `/rides/<id>`, `/races/<id>`, `/seasons/<id>`, `/calendar/<id>`, `/routes/<id>`, `/welcome` — не закрыты.
- AC3: `/v1/sitemap` — опубликованные гонки, сезоны, маршруты каталога, опубликованные старты; черновик и отменённая
  гонка, маршрут не в каталоге, неопубликованный старт, райды — нет. `Cache-Control: public, max-age=60`.
- AC4: повторный запрос в окне мемо БД не читает; после окна — читает.
- AC5: `/sitemap.xml` — валидный `urlset` с `/welcome` и URL всех записей, `lastmod` (кроме сезонов); `404` без
  `WEB_ORIGIN`; `503` + `Retry-After` при недоступном API.
- AC6: `pnpm check` зелёный.

## 10. Documentation Impact

- `docs/product/landing.md` — раздел «Web и SEO»: robots и sitemap; убрать их из «Вне scope».
- `.claude/rules/pokatim-app.md` — новый публичный/служебный экран → классифицировать в `SEO_DISALLOW`.

## 11. Implementation Context

ENTRY POINTS: `apps/app/src/app/{robots.txt,sitemap.xml}+api.ts`, `GET /v1/sitemap`.
FILES TO MODIFY: contracts `sharing/*`, `index.ts`; api `sharing/{sitemap.*,sharing.module.ts}`,
`races/races-for-sharing{.port,}.ts` (существующий `listSeasons` репозитория); app `lib/seo.ts`, два API-маршрута.
TESTS: `packages/contracts/src/sharing/sitemap.schema.test.ts`, `apps/api/src/modules/sharing/sitemap.{service,int}.test.ts`,
`apps/api/src/modules/races/races-for-sharing.int.test.ts`, `apps/app/src/__tests__/seo-routes.test.ts`, смоук
`e2e/web.spec.ts`.

## 12. Outcome

- **Changes:** contracts — `SitemapEntries`; api — `GET /v1/sitemap` (`SitemapController`, `SitemapService` с мемо),
  `RacesForSharing.sitemapSeasons()`, `SITEMAP_POLICY`; app — `lib/seo.ts`, `robots.txt+api.ts`, `sitemap.xml+api.ts`.
- **Docs updated:** `docs/product/landing.md`, `.claude/rules/pokatim-app.md`.
- **Tests:** unit/int по списку выше; `pnpm check` — в `pr.md`.
- **Ревью:** Codex pass 1 — APPROVE без находок; Claude pass 1 — APPROVE, MEDIUM (`Disallow: /v1/`) и 3 LOW
  исправлены (`findings.md`).
- **Open follow-ups:** sitemap index и свежие объекты при > 10 000 на вид; таймаут SSR-чтения карты на больших
  объёмах.
