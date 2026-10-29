## SEO гостевого веба: robots.txt, sitemap.xml, OG лендинга (landing-seo)

Follow-up гостевого лендинга (`docs/tasks/2026-10-29-guest-landing/pr.md`). Задача — `task.md` (task2).

### Что изменено

- **`GET /robots.txt`** — Expo API-маршрут `apps/app/src/app/robots.txt+api.ts`, правила — `src/lib/seo.ts`:
  - `Allow: /`; закрыты экраны только для вошедших, онбординг, ссылки с токеном (`/auth/`, `/devices`), билеты
    `/tickets/`, `/admin/`, `/ui-kit`;
  - `/v1/` открыт: Googlebot при рендере соблюдает robots и для fetch — публичные экраны догружают данные из API;
  - профили райдеров и кофе-райды не закрыты — у них `noindex` в мета, краулер должен его увидеть;
  - `Sitemap: <WEB_ORIGIN>/sitemap.xml` — только при заданном `WEB_ORIGIN`.
- **`GET /sitemap.xml`** — `apps/app/src/app/sitemap.xml+api.ts`: `/welcome` + объекты `GET /v1/sitemap`,
  абсолютные URL от `WEB_ORIGIN`, `lastmod` (у сезона нет). Нет `WEB_ORIGIN` — `404`; API недоступен — `503` +
  `Retry-After`; успех — `public, max-age=600`.
- **`GET /v1/sitemap`** (API, `sharing`, без входа, IP-лимит `public-read`, кэш 60 с) → `SitemapEntries`:
  опубликованные гонки, маршруты каталога, опубликованные старты (порты владельцев `ogChanged`, постранично, до
  10 000 на вид) и сезоны (новый `RacesForSharing.sitemapSeasons()`). Мемо процесса 10 мин; одновременные запросы
  делят один сбор. Райдов и профилей нет (`noindex`).
- **OG `/welcome`** — бренд-карточка «Покатим» уже есть с og-images (PR #115); без изменений.
- Сторож `__tests__/seo-routes.test.ts`: каждый экран `src/app` либо публичный, либо закрыт `Disallow`.
- Документы: `docs/product/landing.md`, `.claude/rules/pokatim-app.md`.

### Миграции, env, конфиги

Нет. Используется существующий `WEB_ORIGIN` web-сервера. На dev nginx по-прежнему отдаёт `X-Robots-Tag: noindex`.

### Проверки

- `TURBO_CONCURRENCY=1 pnpm check` (изолированные Mongo/Redis) — см. комментарий/CI.
- Тесты: contracts `sitemap.schema.test.ts`; api `sitemap.service.test.ts`, `sitemap.int.test.ts`,
  `races-for-sharing.int.test.ts`; app `seo-routes.test.ts`; смоук `e2e/web.spec.ts` (robots/sitemap).
- Ревью: Codex pass 1 — APPROVE без находок; Claude pass 1 — APPROVE, MEDIUM и LOW исправлены (`findings.md`).
- `NOT VERIFIED`: dev вживую (`curl /robots.txt`, `/sitemap.xml`) — после деплоя.

### Follow-ups

- Sitemap index и порядок «свежие первыми» при > 10 000 объектов вида; таймаут SSR-чтения карты на больших объёмах.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
