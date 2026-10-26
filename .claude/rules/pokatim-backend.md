---
paths:
  - "apps/api/**"
---

# pokatim — backend (дополняет `backend.md`)

Доменные правила pokatim поверх общего правила шаблона. Процесс — скил `app-dev-kit:backend-nest`.

## Модули и reuse

- Контексты `src/modules/<context>/`: identity, profile, routes, rides, calendar, races, results, disputes,
  seasons, gamification, sharing, notifications, moderation, media (по мере появления).
  Есть: `identity` (учётка, сессии, `AuthGuard`), `profile` (онбординг: опрос, коллекция `profiles`; `GET /v1/profile` — ответы опроса своего
  пользователя для Главной, `no-store`, документа нет — `[]`; авторизация —
  `AuthGuard` через `modules/identity/index.ts`, коллекции identity не читает), `panel` (доступ к панели «Протокол»:
  члены команды и роли, сессии панели, журнал; identity — только порт `PanelCredentials`/`IdentityAccounts`),
  `races` (сезоны и гонки по коридору — одна граница, ADR-0010: определение сезона живёт здесь, отдельного модуля
  `seasons` нет), `calendar` (календарь стартов, с гонками не связан), `tracks` (загрузки, разбор, активности —
  ADR-0011), `devices` (Garmin/Wahoo через агрегатор Open Wearables) и `routes` (маршруты команды платформы —
  эталон коридора гонки, ADR-0012 Proposed).
- `routes` о гонках не знает и зависит только от `panel`; `races → routes` — только порт `RouteCatalog`
  (`modules/routes/index.ts`, `RoutesCoreModule`): готовый маршрут по id в транзакции правки гонки и названия
  маршрутов списка. Записи `routes`/`route_*` из `races` (и наоборот) — нет. Линию сверки для слайса 02 даст
  отдельный порт.
- Общий код загрузок в `src/`: `raw-body.ts` (`readLimited` — тело `application/octet-stream` после гарда и лимита,
  обрыв на лимите — `413` с кодом модуля и `Connection: close`) и `parse-thread.ts` (`runParseThread` — функция
  `@pokatim/tracks/parse` из белого списка `PARSE_FUNCTIONS` в `worker_threads`, `DEFAULT_PARSE_LIMITS` 160/32 МБ,
  30 с; таймаут — `timeout`, OOM — `unreadable`, сбой загрузчика — исключение и ретрай). Свой поток разбора в модуле —
  нет.
- `tracks` об агрегаторе не знает (источник — enum + непрозрачный `sourceRef`, поле `via`); `devices` пишет в
  `tracks` только через порт `TrackIngest` (`modules/tracks/index.ts`). Разбор FIT/GPX/потока — только
  `@pokatim/tracks/parse` в worker (`worker_threads` с лимитами), в HTTP-обработчике — только сигнатура формата.
- REST агрегатора — только адаптер за портом `WearablesAggregator` (`open-wearables.aggregator.ts`): адрес и ключ —
  env, без редиректов, таймаут и лимит байт, zod-ответы. Pull — основной путь, вебхук OW — только сигнал (данные из
  тела не используются); импорт — только для `active` подключений. Ключ OW и секрет вебхука — только env.
- Доменный модуль панели пишет журнал `PanelAudit.append(tx, { action, subject: { kind, id, label }, details })` —
  `label` — название на момент действия; имена сотрудников — порт `PanelDirectory` (не `panel_members`).
- Публичное чтение (`/v1/races`, `/v1/seasons` — список, `current`, `:id`, `:id/races`; `/v1/calendar`) — отдельные
  контроллеры без гарда панели; статический маршрут (`seasons/current`) объявляется до параметрического
  (`seasons/:id`), иначе он уйдёт в pipe `Uuid` (400). Только опубликованное, без владельца и служебных полей,
  `@Header('Cache-Control', PUBLIC_READ_CACHE_CONTROL)`, `PublicReadGuard` (IP-лимит `public-read`), курсор —
  `src/page-cursor.ts`. Мутаций без гарда нет. Календарь: `calendar/cities` и `calendar/months` объявлены до
  `calendar/:id`; фаза старта — `calendarPhase` (`calendar.policy.ts`) по `minskToday(CLOCK.now())`.
- Новые эндпоинты панели (`/v1/admin/*`, модули следующих слайсов) — `@UseGuards(PanelGuard)` +
  `@RequirePermission(...)` + `@CurrentPanelUser()`; чувствительное действие пишет `PanelAudit.append(tx, …)` в
  транзакции действия. Всё — из `modules/panel/index.ts`; новое право — в конец `PERMISSIONS` контракта и в
  `ROLE_PERMISSIONS`.
- Код, нужный ≥2 приложениям (разбор трека для pre-check в приложении и на сервере), — в `packages/tracks`
  (`@pokatim/tracks`): парсинг GPX/TCX/FIT/KML и геометрия; дубли разбора в модулях запрещены.

## Авторитет сервера и история

- Результаты, места, кластеры считает только сервер; входящие от клиента значения времени игнорируются.
- Append-only (только INSERT): споры, исключения треков, пересчёты, модерация, решения организатора.

## Очереди (worker)

- Брокер — BullMQ на Redis; RabbitMQ не используем (переход — только через ADR; outbox оставляет к нему путь).
- Тяжёлая работа — только в worker: разбор трека, геопересчёт (коридор), рендер Skia/ffmpeg, OG-картинки,
  бейджи, уведомления, пересчёт сезона. HTTP-обработчик ставит задачу.
- Лимиты времени и памяти — для разбора файлов и рендеринга (Skia, ffmpeg).
- Финальный провал задачи — dead-letter → видимое действие в панели организатора, а не тишина.

## Данные и логи

- Логи — без биометрии (пульс, мощность, FTP, вес) и e-mail.
- Время — UTC в БД, Europe/Minsk — только на отображении (AGENTS.md §4.7).
- Геометрия (ADR-0007, R11): GeoJSON + `2dsphere` в MongoDB для «рядом»/bbox; коридор, длина, прогресс по маршруту,
  правдоподобие — функции `packages/tracks` в worker (`pokatim-db.md`). Геозапросы проверяются интеграционными
  тестами на реальном MongoDB, моки БД для геозапросов запрещены.
- `results` (race-results-03): заявки и попытки; другие модули — только порты через `index.ts`: `RaceRegistry`
  (`races`: гонка, окно, `admitEntry` — фиксация V-12 в транзакции заявки, видимость в панели), `RouteGeometry`
  (`routes`: линия сверки и рамка, кэш в процессе), `ActivitySource` (`tracks`: группа дублей, свои активности и
  загрузки, исходник для worker). События `tracks.activity-ready/-removed` — свои типы подписчика: outbox базы
  отправляет тип в одну очередь. Сверка — `runParseThread('analyzeAttempt')` в worker; потоки разбора на процесс
  ограничены семафором `PARSE_THREADS_MAX` (`src/parse-thread.ts`).
- Сверка заезда с коридором гонки — `matchCorridor` / `analyzeAttempt` из `@pokatim/tracks/parse` (ADR-0012 п. 5):
  только worker (`worker_threads`), по исходнику без прореживания; `engineVersion` пишется в попытку, смена версии
  не пересчитывает результаты молча. Лёгкий вход `@pokatim/tracks` движок не экспортирует.
- Анонимизация при удалении аккаунта — «Удалённый участник» (см. `pokatim-db.md`).

## Красные флаги pokatim

Клиентское время в расчёте результата · UPDATE/DELETE аудита и споров · биометрия или e-mail в логах ·
разбор трека или рендер в HTTP-обработчике.
