# Findings — maps-01-route-corridor — pass 1 — reviewer: claude

base: origin/develop   commits: origin/develop..9a55432 (3a573fd … ef666b5, merge 9a55432); working tree чистый
verdict: REQUEST CHANGES (HIGH-1)

## Pass 1

Проверено самостоятельно: `tsc --noEmit` apps/app и apps/api — 0 ошибок; jest app
(`race-route-map.test.tsx`, `features/maps/*`, `scripts/copy-map-worker.test.ts`) — 5 suites / 19 tests зелёные;
vitest contracts `race-route.schema.test.ts` (2) и api-client `races.test.ts` (9) зелёные. API int
(`races-corridor.int.test.ts`, реальная MongoDB) — NOT VERIFIED (доступ к локальным Mongo/Redis в сессии ревью
закрыт); полный `pnpm check` — NOT VERIFIED (опираюсь на §12 task.md).

Сверено и замечаний нет: выражение ширины коридора (`interpolate exponential 2` между опорами 0 и 22 даёт ровно
`w0 · 2^z`, т. е. 2·widthM/mpp(lat, z) на любом зуме); состав публичного ответа (явный объект из 5 полей, видимость
через общий `publicRace` = `findPublic` published/cancelled, нет коридора/не `ready` → тот же `404 NOT_FOUND`,
`Uuid` pipe, `PublicReadGuard` на классе, `PUBLIC_READ_CACHE_CONTROL`); порт `RouteGeometry.displayGeometry` через
`modules/routes/index.ts`, проекция `{ line: 1 }` без `matchLine`, отдельный LRU; маршруты после `ready` неизменяемы
(мутаций, кроме разбора, нет) — кэш процесса корректен; API v11 MapLibre RN (`Map`/`Camera.initialViewState`/
`GeoJSONSource`/`Layer` с `paint`/`layout`, `onDidFailLoadingMap`, флаги жестов) — сверено по типам 11.5.0 в
node_modules; ленивая загрузка native — пакет зовёт `getEnforcing` для `MLRNCameraModule`/`MLRNMapViewModule`/… на
импорте, все модули ставит один config plugin, проверки двух достаточно; статических импортов пакета нет
(только `import type`); web — `import()` после монтирования, отмена до резолва, `remove()` в cleanup, пересоздание
по `styleUrl`/теме; гидрация — `useMounted()` (server snapshot `false`) → SSR и первый клиентский рендер дают
скелетон одинаковой пропорции, `useTheme` web тоже берёт серверный снимок `light`; воркер `maplibre-gl-worker.mjs`
6.16.0 самодостаточен (нет внешних импортов, `maplibre-gl-shared.mjs` пустой), создаётся как module worker, в
precache не попадает (имя без хеша), `?v=` гасит кэш `no-cache` статики; Dockerfile/deploy-dev (необязательные
ARG, многострочные `build-args`, turbo `build:web` с `env: EXPO_PUBLIC_*`, `cache: false`); CSP web-сервера не
ограничивает `connect-src`/`worker-src`.

### [HIGH] Ошибка повторного запроса геометрии прячет уже показанную карту
- **file:** apps/app/src/features/races/race-route-map.tsx
- **location:** строка 31 (`if (mounted && (styleUrl === null || route.isError)) return null;`)
- **problem:** в TanStack Query v5 неудачный refetch при имеющихся данных даёт `status: 'error'` / `isError: true`
  с сохранённым `data`. Условие схлопывает блок по одному `isError`, не глядя на `route.data`.
- **why_it_matters:** AGENTS.md §4.12 — «ошибка обновления при уже показанных данных — данные остаются». Триггер
  реальный: `staleTime` 60 с + `refetchOnWindowFocus`/refetch при повторном монтировании (возврат на карточку,
  возврат во вкладку/приложение); 5xx/таймаут после `shouldRetry` → карта, которую пользователь уже видел, исчезает
  вместе со сдвигом вёрстки. По review_contract нарушение §4.12 — HIGH.
- **evidence:** `const route = useRaceRoute(...)` (стр. 28) → `route.isError` (стр. 31) без проверки `route.data`;
  `createQueryClient` (`src/lib/query-client.ts`) не отключает refetch on focus; тест на ошибку обновления при
  показанной карте отсутствует (`src/__tests__/race-route-map.test.tsx` проверяет только 404 первой загрузки).
- **recommended_fix:** схлопывать только при ошибке без данных: `route.isError && !route.data`; при наличии `data`
  продолжать рендерить карту. Добавить кейс в `race-route-map.test.tsx`: успешная загрузка → refetch с ошибкой
  (`queryClient.refetchQueries` / invalidate) → `maplibre-Map` остаётся.

### [MEDIUM] Карта не обновляется после правки коридора опубликованной гонки (ширина и маршрут)
- **file:** apps/app/src/features/races/queries.ts; apps/app/src/features/races/race-route-map.tsx
- **location:** `useRaceRoute` (ключ `['races','route',id]`); `race-route-map.tsx` стр. 41–47 (ширина в подписи — из
  `race.corridor`, на карте — из `route.data.widthM`); pull-to-refresh `race-detail.tsx` стр. 203–212 ключ не трогает
- **problem:** решение «геометрия неизменна — pull-to-refresh не перезапрашивает» верно для маршрута, но не для пары
  гонка→маршрут: `corridorEditable` (`races.policy.ts` стр. 159–163) разрешает менять `corridor` (и `routeId`, и
  `widthM`) у опубликованной гонки в фазе `upcoming`. После правки и pull-to-refresh строка «±N м» и a11y-подпись
  показывают новую ширину, а карта — старые линию и ширину коридора до следующего refetch (stale 60 с + фокус/монтирование).
- **why_it_matters:** расхождение текста и карты на одной карточке; карта коридора — то, по чему райдер планирует
  заезд. Ключ кэша не зависит от входа, который меняет ответ.
- **evidence:** `queryKey: ['races', 'route', id]`; ответ сервиса берёт `widthM` и `routeId` из текущей гонки
  (`races-public.service.ts` `route()`); int-тест «коридор снят правкой» подтверждает правку опубликованной гонки.
- **recommended_fix:** включить в ключ то, что известно из карточки (`corridor.widthM`) и/или добавить `routeRefetch`
  в `refetchers` pull-to-refresh, когда коридор есть; ширину коридора на карте рисовать из `race.corridor.widthM`
  (единый источник с текстом). Смену `routeId` клиент не видит — достаточно refetch по pull-to-refresh.

### [LOW] `accessible`-обёртка прячет кнопку атрибуции от скринридера
- **file:** apps/app/src/features/maps/route-map-frame.tsx
- **location:** стр. 26–31 (`accessible`, `accessibilityRole="image"` вокруг карты)
- **problem:** на iOS `accessible` делает потомков недоступными для VoiceOver, на web RNW даёт `role="img"` —
  дочерние кнопки/ссылки атрибуции (`attributionControl`, кнопка атрибуции native) для AT презентационные. RC-6
  специально оставил атрибуцию нажимаемой, но для пользователей скринридера она недоступна.
- **why_it_matters:** ADR-0014 п. 3 (атрибуция) + доступность; несущественно для функции.
- **evidence:** `<View testID="route-map" accessible accessibilityRole="image" …>{children}…`
- **recommended_fix:** вынести подпись-альтернативу в отдельный `accessible` слой (`StyleSheet.absoluteFill`,
  `pointerEvents="none"`) рядом с картой, а не оборачивать ею карту; либо принять и записать в §8.2.

### [LOW] ADR-0014 расходится с фактом сборки: `maplibre-gl` в серверном бандле, CSS глобально, чанк в precache
- **file:** docs/adr/0014-maps-and-tiles.md
- **location:** «Решение» п. 5 («в серверный бандл и первый чанк не попадает»), «Последствия» («отдельным чанком
  только на карточке гонки»)
- **problem:** §12 task.md фиксирует: серверный бандл Metro содержит код `maplibre-gl` (не исполняется), CSS
  подключён `<link>` на всех страницах, хешированный чанк ~1,1 МБ попадает в precache SW (RC-8) — т. е. скачивается
  при установке PWA всем.
- **why_it_matters:** Documentation Sync (раздел 10) — ADR читают следующие слайсы карт как источник истины.
- **recommended_fix:** уточнить п. 5 («не исполняется на сервере») и «Последствия» (CSS глобально, precache — RC-8,
  follow-up).

### [LOW] Native: GeoJSON и спецификации слоёв пересобираются на каждый рендер
- **file:** apps/app/src/features/maps/route-map.tsx
- **location:** стр. 65–66 (`data={routeFeatures(map)}`, `routeLayers(theme, …)` в JSX)
- **problem:** `GeoJSONSource` v11 делает `JSON.stringify(data)` (≈ 25–40 КБ для 1000 точек) и передаёт строку в
  нативный prop на каждом рендере карточки (тик часов, обновления запросов карточки).
- **why_it_matters:** лишняя работа JS-потока/моста на скролле карточки; корректность не страдает.
- **recommended_fix:** `useMemo` по `map` и `[theme, map.widthM, map.bounds]`.

### [LOW] Ошибка стиля native не сбрасывается при смене темы; без повтора
- **file:** apps/app/src/features/maps/route-map.tsx
- **location:** `const [failed, setFailed] = useState(false)` / `onDidFailLoadingMap`
- **problem:** web сбрасывает `failed` при пересоздании (`setFailed(false)` в эффекте), native — нет: после сбоя
  светлого стиля сообщение висит и при успешной загрузке тёмного. Повтора у сообщения нет (§4.12 «с повтором») —
  отклонение заложено в §3 спецификации, но не записано в §8.2.
- **recommended_fix:** сбрасывать `failed` при смене `styleUrl` (ключ `key={styleUrl}` на `RouteMap` или эффект);
  записать «сообщение без повтора» в §8.2 как принятое отклонение от §4.12.

## Итог pass 1

CRITICAL: 0 · HIGH: 1 · MEDIUM: 1 · LOW: 4. Блокер — HIGH «ошибка повторного запроса прячет карту»
(`race-route-map.tsx:31`). Безопасность публичного ответа, видимость гонки, границы модулей, кэш, гидрация SSR,
ленивая загрузка native, ширина коридора и CI/инфра — без замечаний.
