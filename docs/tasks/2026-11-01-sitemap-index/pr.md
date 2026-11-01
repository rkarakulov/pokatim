## Что

Sitemap index гостевого веба (task: `docs/tasks/2026-11-01-sitemap-index/task.md`, follow-up landing-seo):

- `/sitemap.xml` — `<sitemapindex>`; дочерние карты в корне (область URL по sitemaps.org): `/sitemap.xml?kind=static`
  (`/welcome`) и `/sitemap.xml?kind=<вид>&page=<n>`, ≤ 10 000 URL на страницу (потолок протокола 50 000). Неверный
  вид/номер/лишний параметр — 404 без запроса к API.
- API `GET /v1/sitemap` (страницы видов с `lastmod`) и `/v1/sitemap/:kind/:page` (`{ id, updatedAt }`),
  `PublicReadGuard`. Страницы — по `_id` с границами `(after, last]`: правка не переносит объект, новые — в конец,
  вставка внутрь диапазона (uuidv7 в одной мс) не теряется. Полнота — все публичные объекты, а не первые 10 000.
- `lastmod` страницы — max `updatedAt` строк; сдвиг состава относительно прошлого поколения индекса — момент сборки.
  Мемо страниц — внутри поколения индекса (10 мин).
- Миграция `0051_sitemap_indexes` (expand-only): `(status, _id, updatedAt)` на `races`, `routes`, `calendar_starts`;
  план — `IXSCAN` без `SORT`.

## Риски

- API и web деплоятся не атомарно: в окне выката `sitemap.xml` может отдать 503 (краулер повторит).
- Прошлое поколение индекса — в памяти процесса: после рестарта `lastmod` может откатиться (URL не теряются).
- Follow-up: stale-while-revalidate полного прохода индекса на больших объёмах (таймаут SSR 2 с).

## Проверки

- Ревью: Codex pass 1 — REQUEST CHANGES (HIGH: карты вне области URL; MEDIUM: мемо) и Claude pass 1 — REQUEST CHANGES
  (тот же HIGH, MEDIUM `lastmod`, 4 LOW) → исправлено; Claude pass 2 — APPROVE (2 LOW приняты: `lastmod` после
  рестарта, посторонний query → 404). Codex pass 2 недоступен.
- api unit 16, api int 66, jest 15, typecheck/eslint/format/arch — зелёные. Полный `pnpm check` — в CI.
- NOT VERIFIED: Playwright e2e и живой Expo-сервер с query-маршрутом.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
