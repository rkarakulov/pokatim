# Findings — routes-05-panel-map — pass 1 — reviewer: claude
base: origin/develop   commits: origin/develop..14e441c (1 commit; working tree clean)
verdict: APPROVE

Проверено самостоятельно (Node 24):
- `packages/route-view`: vitest 9 файлов / 40 тестов — зелёные; `tsc --noEmit` — чисто.
- `apps/admin`: vitest 31 / 263 — зелёные; `tsc --noEmit` — чисто.
- `apps/app`: `jest maps routes` — 137 наборов / 1207 тестов зелёные; `tsc --noEmit` — чисто.
- `pnpm arch:check` (dependency-cruiser) — 0 нарушений; `pnpm lint` — чисто.
- `vite build` панели (ADMIN_BASE=/admin/): `maplibre-gl-*.js` (1,1 МБ), `maplibre-gl-*.css` (71 КБ),
  `maplibre-gl-worker-*.mjs` — отдельные ассеты; в первом чанке `index-*.js` кода MapLibre нет (только ссылки на
  чанки), RC-13 выполнен.
- int API и `pnpm e2e:admin` не запускались (нужны Mongo/Redis/Mailpit) — NOT VERIFIED мной; тесты прочитаны.

Перенос в `@pokatim/route-view`: все удалённые модули приложения (`corridor-style`, `map-camera`, `scrub-line`,
`scrub-store`, `map-view-store`, `route-geometry`, `attribution.web`, `map-locale.web`, `map-wheel.web`,
`profile-path`, `profile-style`, числа `format.ts`/`scrub.ts`) переехали без изменения логики (сверено построчно:
`profileTickValues`, `scrubValues`, `scrubStep`, `routePaceKmh`, `routeDurationMin`, `guardWheelZoom`; `profilePoints`
в старом `profile-path.ts` и так был реэкспортом `@pokatim/tracks`). Удалённые тесты перенесены (`*.test.ts` пакета,
`use-scrub.test.ts` + `stores.test.ts`, `scrubStep` — в `profile.test.ts`), ожидания тестов приложения не менялись;
реэкспорт-шимов нет. Пакет без React/RN (React-хук `useScrub` остался в приложении). `interactiveMapOptions` в
приложении даёт те же опции, что раньше были литералом (`attributionControl: false` переопределяется после spread).

API: `view()` — `panelGeometry` с проекцией `{ line, profile }`, `elevationOf` общий с публичной карточкой; права и
видимость не тронуты; int-тесты ключей, `processing` автора и 404 райдерского маршрута есть. Контракт —
`nullable().default(null)` с тестом на все три входа. Безопасность: CSP расширена минимально (`connect-src` одного
origin, `worker-src 'self' blob:`, `img-src blob:`; `script-src 'self'` без изменений) и охраняется `csp.test.ts`;
ссылка новой вкладки — `rel="noopener noreferrer"` (тест в `RaceEditor.corridor.test.tsx`); env стиля — публичный
URL, секретов нет; `turbo.json` env, Dockerfile ARG и build-arg deploy согласованы.

### [MEDIUM] После «Обновить» опрос `processing` больше не ограничен `ROUTE_POLL_MAX_MS`
- **file:** apps/admin/src/features/routes/RouteScreen.tsx
- **location:** 36–47 (`pollExpired`, `refetchInterval`, эффект таймера с зависимостью `[processing]`), 412–415 (`onRefresh`)
- **problem:** таймер 5 мин ставится эффектом, который перезапускается только при смене `processing`. «Обновить»
  делает `setPollExpired(false)` и `refetch()`; если маршрут всё ещё `processing`, `processing` не меняется
  (`true → true`), эффект не перезапускается, нового таймера нет, а `refetchInterval` снова возвращает
  `ROUTE_POLL_MS` — страница опрашивает API каждые 2 с бессрочно.
- **why_it_matters:** нарушает RC-10 / `pokatim-web.md` («опрос `ROUTE_POLL_MS` не дольше `ROUTE_POLL_MAX_MS`, затем
  „проверьте позже“ с „Обновить“»): зависший маршрут в открытой вкладке даёт бесконечную нагрузку и больше никогда не
  показывает «проверьте позже».
- **evidence:** `useEffect(() => { if (!processing) return; const timer = setTimeout(() => setPollExpired(true),
  ROUTE_POLL_MAX_MS); … }, [processing]);` и `onRefresh={() => { setPollExpired(false); void route.refetch(); }}`.
  Тест `RouteScreen.test.tsx:148–186` после «Обновить» сразу отдаёт `ready`, ветку «всё ещё processing» не покрывает.
- **recommended_fix:** перезапускать таймер при каждом новом окне опроса — например, эпоха опроса в состоянии
  (`pollEpoch`, увеличивается в `onRefresh`) в зависимостях эффекта, или эффект по `[processing, pollExpired]` с
  условием `processing && !pollExpired`. Тест: истекло → «Обновить» → маршрут всё ещё `processing` → через
  `ROUTE_POLL_MAX_MS` снова «проверьте позже», и после этого запросов нет.

### [MEDIUM] Воркер `.mjs` под nginx стенда: MIME-тип не проверен (NOT VERIFIED)
- **file:** infra/docker/admin-nginx.conf
- **location:** `location /admin/assets/` (нет `types` для `mjs`); apps/admin/src/features/maps/load-maplibre.ts:2,30
- **problem:** воркер собирается в `/admin/assets/maplibre-gl-worker-*.mjs`, а MapLibre 6.16 создаёт его как
  module worker (`new Worker(url, { type: 'module' })`, проверено в `dist/maplibre-gl.mjs`). Для module-скриптов
  браузер требует JavaScript MIME (строгая проверка, плюс `X-Content-Type-Options: nosniff`). Если `mime.types`
  образа `nginx-unprivileged:1.29-alpine` не знает `mjs`, файл уйдёт как `application/octet-stream`, воркер не
  загрузится, карта на стенде не появится. e2e и ручной прогон coder шли через `vite preview`, который отдаёт `.mjs`
  правильно, — стенд это не покрывает. Я не смог проверить: Docker daemon не запущен.
- **why_it_matters:** если MIME неверный, AC1/AC2 (карта на странице и в превью) на стенде не выполняются, хотя CI
  зелёный.
- **evidence:** `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'` → `setWorkerUrl(workerUrl)`;
  артефакт сборки `assets/maplibre-gl-worker-CMkqA50c.mjs`; в `admin-nginx.conf` нет `types { … mjs; }`.
- **recommended_fix:** проверить `docker run --rm <NGINX_IMAGE> grep mjs /etc/nginx/mime.types`; если `mjs` там нет —
  добавить в `location /admin/assets/` `types { application/javascript js mjs; }` (или `include mime.types` с
  дополнением) и проверить `Content-Type` воркера на стенде (шаг ручной проверки в pr.md).

### [LOW] Ветка карты (чанк, воркер, CSP) не проходит в CI-смоуке
- **file:** apps/admin/e2e/races.spec.ts
- **location:** 121–155
- **problem:** CI собирает панель без `VITE_MAP_STYLE_LIGHT`, поэтому смоук идёт по `LinePreview`. Загрузка
  async-чанка MapLibre, воркер под `worker-src` и `connect-src` в CI не проверяются. Рекомендованный в матрице
  §11 шаг со стабом стиля через `page.route` не добавлен (в §12 честно помечен как NOT VERIFIED).
- **why_it_matters:** если поломается CSP или загрузчик/воркер (например, при смене версии `maplibre-gl` или правке
  nginx), это не заметит ни один автоматический прогон: дефект станет виден только на стенде.
- **recommended_fix:** follow-up или в этом PR: сборка смоука с `VITE_MAP_STYLE_LIGHT=${ORIGIN}/admin/__e2e__/map-style.json`
  и `page.route` с пустым стилем `{version:8,sources:{},layers:[]}`, проверка: нет ошибок консоли/CSP, появились
  кнопки «Приблизить»/«Отдалить».

Без замечаний: границы пакета и dependency-cruiser; поведение приложения после переноса; контракт и совместимость
(поле только в ответе панели, есть default); права, видимость и проекция API; слушатели (wheel guard, `matchMedia`,
`document pointerdown`, события карты снимаются при `remove()`/cleanup); `geometry` мемоизирована по `route.line`
(структурное разделение TanStack Query, поэтому карта не пересоздаётся при опросе и после публикации); состояния
экрана (скелетон, 403, 404, ошибка с повтором, баннер при данных, `failed`, без `elevation`); a11y slider; i18n;
Documentation Sync §10 (ADR-0014, AGENTS.md §2, pokatim-web/app/contracts, local-dev, product docs) — выполнен.

## Фиксы после pass 1 (coder)

- **M1 — исправлено.** `RouteScreen.tsx`: таймер окна опроса — эффект по `[processing, pollExpired]` с условием
  `processing && !pollExpired`; «Обновить» сбрасывает `pollExpired` → новое окно со своим таймером
  `ROUTE_POLL_MAX_MS`. Тест (`RouteScreen.test.tsx`, processing): истекло → «Обновить» → всё ещё `processing` →
  через 5 мин снова «Обрабатывается — проверьте позже», дальше запросов нет; затем «Обновить» → готов. До фикса тест
  красный (нет «проверьте позже» во втором окне), после — зелёный.
- **M2 — исправлено (конфиг), стенд NOT VERIFIED.** `admin-nginx.conf`: `location ~ ^/admin/assets/.+\.mjs$` —
  `types { }` + `default_type application/javascript`, тот же набор заголовков (CSP, nosniff, кэш). Сторож —
  `apps/admin/src/csp.test.ts` (блок `.mjs`: тип, CSP, nosniff). Локально nginx/Docker нет — `Content-Type` воркера
  на стенде проверить вручную (pr.md).
- **LOW — добавлено.** Смоук собирает панель с `VITE_MAP_STYLE_LIGHT=${PANEL_URL}__e2e__/map-style.json`
  (`e2e/project.ts`, `MAP_STYLE_URL`), `context.route` отдаёт пустой стиль `{version:8,sources:{},layers:[]}` — без
  сети. `races.spec.ts`: превью в поле коридора и страница маршрута — карта («Карта маршрута «…»»), кнопки камеры
  («Приблизить», «Показать маршрут целиком» — видны только без ошибки до `load`), ошибок консоли/CSP нет.
  `pnpm e2e:admin` локально (Mailpit из brew, Mongo :27117, Redis db 13, Chrome) — 2/2 passed.
- Документы: `pokatim-web.md` (смоук со стилем-заглушкой, MIME `.mjs`), ADR-0014 (риски), task.md §12.
- `TURBO_CONCURRENCY=1 pnpm check` (Node 24, Mongo `pokatim_routes05_test`, Redis db 12) — EXIT 0, 15/15 задач,
  admin 31 файл тестов.
