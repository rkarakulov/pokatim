# Архитектура pokatim

Текущее состояние системы. Решения и их обоснование — в [`../adr/`](../adr/README.md).

## Контейнеры

```
app (Expo)    ─┐
admin (Vite)  ─┼─ HTTPS ─ Caddy ─ api (NestJS) ─┬─ MongoDB 8.0 (replica set, ADR-0007)
web (app, SSR)─┘                                ├─ Redis (BullMQ, rate-limit)
                                                └─ S3 (треки, фото, карточки, бэкапы)
                         worker (NestJS, BullMQ) ─ те же MongoDB / Redis / S3; ffmpeg, Skia
```

Одна VPS, Docker Compose (`infra/`). Kubernetes, CDN, поиск, push, WebSocket — вне MVP.

## Модули API (`apps/api/src/modules/`)

identity · profile · panel · routes · rides · calendar · races · results · disputes · seasons ·
gamification · sharing · notifications · moderation · media

Есть: `identity`, `profile`, `panel` (доступ к панели «Протокол», ADR-0009), `races` (сезоны и гонки по коридору,
ADR-0010), `calendar` (календарь стартов). CLI сервера — `apps/api/src/cli` (`dist/cli/panel.js grant-admin`).

Межмодульные вызовы — через `index.ts` модуля; события — outbox → BullMQ.

## Ключевые потоки

- **Заезд:** файл (resumable upload) → S3 → задача разбора трека → проверка коридора (`packages/tracks` в worker;
  «рядом»/bbox — `2dsphere` MongoDB, ADR-0007) →
  результат, кластер, флаги правдоподобия → пересчёт мест → уведомление in-app.
- **Протокол:** чек-лист публикации → публикация → финальные результаты → пересчёт сезона.
- **Спор:** подача → ответы обвиняемого (append-only) → решение → DQ / отклонение → пересчёт.
- **Шеринг:** запрос карточки → задача рендера (Skia / ffmpeg) → S3 → публичная ссылка → публичный экран приложения (web: SSR + OG).

### Регистрация и подтверждение e-mail (модуль `identity`, ADR-0002)

```
app ─ POST /v1/auth/register ─► api: users + user_consents + ссылка + registration_token + outbox
                                          (одна транзакция; Redis: пауза повтора 60 с, лимит по IP)
worker: outbox-публикатор ─► очередь identity-email ─► захват отправки (sendClaimedAt, 60 с)
        ─► SMTP (dev — Mailpit) ─► sentAt; доставка at-least-once, дубль — с той же ссылкой
ссылка …auth/verify/<token> ─ GET (только чтение) ─ POST confirm ─► emailVerifiedAt
app ─ POST /v1/auth/registration/poll ─► pending | verified + сессия (обмен один раз)
worker: identity-maintenance, 03:00 Europe/Minsk ─► удаление неподтверждённых старше 7 дней
```

- Токен ссылки — HMAC от id ссылки (`EMAIL_TOKEN_SECRET`), в БД только sha256; ретрай письма — та же ссылка.
- Повтор письма (`resend`): пауза 60 с и ≤ 10 за сутки (Redis, атомарно через Lua); новая ссылка
  отменяет прежние и продлевает токен регистрации.
- Мутации аккаунта сериализуются `lockUser` — `$inc: { version: 1 }` документа `users` первой операцией
  транзакции: вторая транзакция того же аккаунта получает конфликт записи и повторяется на свежем снимке
  (ADR-0007, R1). Сроки сравниваются с `CLOCK` приложения. Истёкшие сессии, ссылки и токены регистрации
  удаляет TTL-индекс через 30 дней после `expiresAt` (только уборка).
- Ошибки — единый `ApiError` из contracts (глобальный фильтр), в ответах и логах нет запросов БД, стеков,
  e-mail и токенов.

### Сессия: native и web (модуль `identity`, ADR-0003 п. 4, ADR-0005)

```
вход:   POST /v1/auth/session/sign-in { email, password, sessionTransport? }
        ─► лимиты (Redis: e-mail+IP 5, e-mail 20, IP 50 за 15 мин) ─► 429 до argon2
        ─► argon2 verify (неизвестный/удалённый адрес — по пустышке) ─► 401 INVALID_CREDENTIALS
        ─► не подтверждён: verificationRequired + новый токен регистрации ─► «Подтвердите e-mail»
        ─► подтверждён: SessionService.issue ─► сессия по транспорту (web: прежняя cookie → superseded)
native: poll / sign-in / refresh ─ тело { refreshToken } ─► Session в теле ─► SecureStore
web:    poll / sign-in { sessionTransport: 'cookie' } ─► CookieSession в теле (без refresh)
        + Set-Cookie __Secure-pokatim_rt (HttpOnly; Secure; SameSite=Strict; Path=/v1/auth/session)
web, загрузка страницы: POST /v1/auth/session/refresh (cookie, Web Lock между вкладками)
        ─► ротация ─► новый access в память | 401 → не вошли
        | 429 / сеть / 5xx → повтор, затем «не удалось» с кнопкой повтора (не выход)
native, запуск: сессия из SecureStore сразу (офлайн — в аккаунте) ─► фоновая ротация по телу
        ─► новый refresh в SecureStore | 401 → выход, экран «Вход» | сеть (1 повтор) / 429 / 5xx → остаёмся
выход: POST /v1/auth/session/sign-out (текущий или предыдущий refresh) ─► revokedAt, signed_out, 204,
        cookie сброшена; приложение очищает кеш запросов и регистрацию, гард ведёт на «Вход»
```

- Ротация — один `findOneAndUpdate` с pipeline-обновлением (жива, не отозвана; текущий refresh или предыдущий в
  окне 60 с; пользователь не удалён — чтением до ротации): предыдущим становится текущий хеш документа, срок —
  30 дней от ротации, не дальше 180 от входа. Из параллельных refresh одним токеном проходят ровно два (текущим и повтором в окне). Предыдущий вне окна —
  reuse detection: сессия отозвана (`reuse_detected`, лог только с `sid`), ответ — тот же 401. Лимит refresh —
  60/мин на IP (Redis).
- HTTP API (`apps/api/src/http-app.ts`): CSRF — `enableCsrfProtection` (Fetch Metadata + `Origin`), доверенные
  origin-ы и CORS с credentials — `CORS_ORIGINS` (dev: web на другом порту); прод — один origin за Caddy, список пуст.
- App: развилки файлами — `features/auth/session-persistence(.web).ts`, `secure-storage(.web).ts`,
  `lib/api-platform(.web).ts`; гарды допускают «сессия неизвестна» — SSR отдаёт HTML, вкладки — скелетон.
  Web: вход, refresh, poll регистрации и выход — под одним Web Lock (`session-lock.web.ts`): операции, меняющие
  cookie, не перекрываются между вкладками; API на 401 без предъявленной cookie её не сбрасывает. Native — замок в
  памяти процесса (`session-lock.ts`): выход во время фоновой ротации ждёт её и отзывает уже новый refresh.
- **Авторизованные запросы (ADR-0008):** `AuthGuard` identity — access JWT (`AccessTokenVerifier`: HS256, iss/aud,
  exp по `CLOCK`) **и** живая сессия `sid` того же `sub` + пользователь не удалён (два чтения по `_id`); любой отказ —
  один `401 UNAUTHORIZED`. Другие модули подключают гард через `modules/identity/index.ts`, пользователь —
  `@CurrentUser()`. App: Bearer — только явным параметром методов, требующих входа; `withAccessToken`
  (`features/auth/authorized.ts`) обновляет access за 60 с до истечения и после 401 (один refresh + один повтор,
  single-flight под замком сессии), refresh 401 — локальный выход.

### Онбординг после входа (модули `profile` и `identity`, слайс 4)

```
вход (автовход V-09 / пароль) ─► гард: онбординг неизвестен ─► скелетон оболочки
опрос: кеш pokatim.onboarding (сессия) ─► есть: пройден (сервер не спрашиваем, офлайн-старт native)
        └─ нет: GET /v1/profile/onboarding (Bearer) ─► { surveyCompleted } ─► true: кеш, дальше
                                                     └─ ошибка: «Нет соединения» / «Не удалось загрузить» + повтор
        «Что вас привело?» ─ PUT /v1/profile/onboarding/survey { reasons } ─► profiles (upsert по _id = userId)
геопозиция: флаг устройства pokatim.locationPrompt или решение ОС/браузера ─► пропуск
        └─ не определено: «Покажем, что рядом» ─ «Разрешить» (системный запрос) / «Не сейчас» ─► флаг ─► Главная
выход: кеш опроса стёрт (флаг геопозиции — устройства, остаётся)
```

- Модуль `profile` — коллекция `profiles` (`_id` = id пользователя; ответы опроса, `surveyCompletedAt`, `updatedAt`),
  единственный писатель — `ProfileRepository`; запись — одна атомарная операция над одним документом вне транзакции,
  гонка двух первых upsert (duplicate key на `_id`) — один повтор. Онбординг наружу — только `{ surveyCompleted }`;
  ответы — `GET /v1/profile` для порядка Главной (блок 02); оба `no-store`.
  Сервер опрос не навязывает: другие эндпоинты ответа не требуют.
- Шаги — группа `(setup)` (`/survey`, `/location`) вне `(onboarding)` и `(tabs)`; координаты не читаются и не
  хранятся (`location-permission(.web).ts`); `expo-location` — только native. Шаг геопозиции выключается флагом
  `LOCATION_STEP_ENABLED` (release-чеклист — `docs/runbooks/deploy.md`).

### Сброс пароля (модуль `identity`, ADR-0006)

```
app «Забыли пароль?» ─ POST /v1/auth/password-reset { email }
        ─► лимиты (Redis, HMAC: IP 20/ч, затем e-mail — пауза 60 с, 5/сутки) ─► 429 до БД
        ─► один ответ { resendAvailableInSec } для любого адреса; аккаунт есть (и не удалён) —
           прежние ссылки superseded + password_reset_tokens (TTL 1 ч) + outbox (одна транзакция)
worker: очередь identity-email ─► захват отправки ─► письмо «Восстановление пароля» (…auth/reset/<token>)
ссылка …auth/reset/<token> ─ GET (только чтение: valid | expired | used | 404)
        ─ POST confirm { token, password } ─► ссылка проверена до argon2 ─► под lockUser: новый хеш, ссылка used,
          все сессии отозваны (password_reset), токен регистрации погашен, e-mail подтверждён, outbox
        ─► passwordChanged + e-mail (сессии нет) ─► «Пароль изменён» → «Вход» с e-mail
worker: очередь identity-email ─► письмо «Пароль изменён» (время по Минску, без ссылки с токеном)
```

- Очередь `identity-email` — один процессор-диспетчер по `job.name` (подтверждение, ссылка сброса, «Пароль изменён»):
  BullMQ раздаёт задачи очереди любому процессору. Захват отправки — общий для коллекций ссылок.
- Вход сверяет хеш пароля под `lockUserCredentials`: проверивший старый пароль до коммита сброса или пока сброс «в
  процессе» сессию не получает; ротация, закоммиченная между снимком сброса и отзывом сессий, вызывает конфликт
  записи — сброс повторяется и отзывает и её.
- App: запросы сброса — вне Web Lock сессии (cookie не трогают); после смены пароля сессия этого устройства —
  локальный выход (`useSignOut`); web-сервер отдаёт `Referrer-Policy: no-referrer` на `/auth/*`.

### Панель «Протокол» (модуль `panel`, `apps/admin`, ADR-0009)

- **Данные:** `panel_members` (`_id` = id пользователя: роль, статус, имя в панели), `panel_sessions` (токен — sha256,
  штамп учётных данных, простой 2 ч, абсолют 12 ч), `panel_audit` (append-only, только `PanelAudit.append` в
  транзакции действия), `panel_meta.admins` (замок набора активных администраторов). Миграция `0005_panel`.
- **Порт identity:** `PanelCredentials.verify` (та же `CredentialsCheck`, что вход приложения: общие лимиты,
  пустышка, один 401; неподтверждённому — токен регистрации) и `IdentityAccounts` (`accountState` со штампом
  `HMAC(EMAIL_TOKEN_SECRET, "credentials:" + passwordHash)`, `findVerifiedByEmail`, `emailsOf`). Identity о `panel`
  не знает.
- **Вход:** `POST /v1/admin/session/sign-in` → пароль → член команды `active` (иначе `403 PANEL_ACCESS_DENIED`) →
  сессия + запись `panel.signed_in` одной транзакцией → cookie `__Secure-pokatim_admin_sid`
  (`HttpOnly; Secure; SameSite=Strict; Path=/v1/admin`) → прежняя cookie браузера отзывается.
- **`PanelGuard` на каждом `/v1/admin/*`:** сессия жива → аккаунт активен и штамп совпадает → член `active` → права
  роли (`ROLE_PERMISSIONS`: admin — всё; moderator — `audit.read`, `races.read`; organizer — `races.read`,
  `races.manage`) → `request.panel`;
  `@RequirePermission` — 403; любой отказ сессии — один 401 и сброс cookie; `Cache-Control: no-store`. Маршрут без
  гарда или явного `@Public()` ловит тест. Access JWT и refresh приложения не принимаются.
- **Сотрудники:** выдача роли существующему подтверждённому пользователю по e-mail, смена и снятие с причиной (снятие
  отзывает сессии панели в той же транзакции); `lockAdmins` → `lockMember` — нельзя оставить панель без
  администратора; себе — нельзя. Первый и аварийный администратор — CLI.
- **`apps/admin`:** TanStack Router (`basepath` из `BASE_URL`: `/admin/` на стенде и в проде), «кто я» — TanStack
  Query (`me`), гард `beforeLoad`; глобальные 401 («Сессия истекла» с возвратом, `next` только внутри панели) и 403
  («Нет доступа к разделу»); `Can`/`useCan` — только отображение; навигация — `src/navigation.ts`; компоненты —
  `src/ui` (кандидаты в `admin-kit`, F6). Прод и стенд — `/admin/` того же домена, nginx образа `admin` — строгий CSP.

### Сезоны, гонки, календарь (модули `races`, `calendar`, ADR-0010)

- **Данные:** `seasons` (даты Минска + границы-моменты `startsAt`/`endsBefore`), `races` (статус, окно и протокол —
  моменты UTC, `seasonId` только у опубликованной), `race_meta.schedule` (замок расписания), `calendar_starts`
  (`cityKey` для фильтра и списка городов). Миграции `0006_panel_audit_subject`, `0007_races`, `0008_calendar`,
  `0009_races_season_public_idx` (гонки сезона публично).
- **Панель** (`/v1/admin/{seasons,races,calendar}` под `PanelGuard` + права): правки по ожидаемой `version`
  (устарело — 409); создание и изменение дат сезона, публикация гонки и смена конца окна опубликованной — под
  `lockSchedule`; фаза и `editable` — сервер по `CLOCK`; организатор — только свои гонки (чужая — 404); каждое
  изменение — `PanelAudit.append` с `subject` в транзакции действия; имена сотрудников — порт `PanelDirectory`.
- **Публичное чтение** (`/v1/races`, `/v1/races/:id`, `/v1/seasons`, `/v1/seasons/current`, `/v1/seasons/:id`,
  `/v1/seasons/:id/races`, `/v1/calendar`): без входа, только опубликованное и отменённое (сезоны — все),
  курсор — base64url `{ k, id }` через zod (`src/page-cursor.ts`), `Cache-Control: public, max-age=60`, IP-лимит
  `public-read` (`src/public-read.guard.ts`). Enum-ы ответов — `tolerantEnum` (`'unknown'` у старых сборок).
- **`apps/admin`:** «Гонки» (фильтры в URL, форма одной колонкой с метками Europe/Minsk и вычисляемым сезоном,
  зафиксированные поля по `editable`), «Сезоны» (таблица и форма справа), «Календарь»; ввод времени —
  `DateTimeField` (настенное время Минска → `minskWallTimeToUtc`).

### Главная приложения (блок 02)

```
Главная (вошедший) ─► GET /v1/races?scope=current&limit=1   (публично, max-age=60) ─► герой «Гонки»
                   ─► GET /v1/calendar?limit=1              (публично, from — сервер) ─► герой «Календарь стартов»
                   ─► GET /v1/profile (Bearer, no-store) ─► { rideReasons } ─► порядок разделов на клиенте
```

- Разделы — отдельные запросы к публичным list-эндпоинтам доменов (ключи `['races','list',…]`,
  `['calendar','list',…]` — общие с вкладками); агрегата `/v1/home` и BFF нет: сбой одного раздела — ошибка в его
  слоте. Порядок — чистая функция `orderHomeSections` по ответам опроса (`features/home/sections.ts`).
- `GET /v1/profile` (модуль `profile`, `AuthGuard`): ответы опроса своего пользователя; неизвестные коды клиент
  отбрасывает (`ProfileView`). После ответа на опрос `['profile']` инвалидируется.
- Обновление: pull-to-refresh (native) перезапрашивает разделы и профиль; `refetchOnWindowFocus` + `staleTime` 60 с,
  на native — `focusManager` ↔ `AppState` (`src/lib/focus-manager(.web).ts`). Polling нет.

### Гонки и сезон в приложении (блок 03)

```
вкладка «Гонки» ─► GET /v1/races?scope=current&bikeClass&month&cursor  ─► герой + «Скоро»
                ─► GET /v1/races?scope=past…   (после исчерпания current) ─► «Завершённые»
                ─► GET /v1/seasons/current, GET /v1/seasons             ─► кнопка сезона (pickSeason)
/races/<id>     ─► GET /v1/races/:id            (SSR: loader + generateMetadata через public-ssr.ts)
/seasons/<id>   ─► GET /v1/seasons/:id, /v1/seasons/:id/races, /v1/seasons
```

- Ключи: `['races','list',{…},'pages']` (`useInfiniteQuery`; префикс общий с Главной), `['races','detail',id]`,
  `['seasons','detail'|'races'|'list'|'current',…]`.
- `/races/:id` и `/seasons/:id` — корневые маршруты вне гардов (гость и вошедший); вкладка `/races` — под гардом.
- SSR-данные публичных экранов — только `src/lib/public-ssr.ts`: `Uuid` до запроса, таймаут 2 с, любая ошибка —
  `null` (не 500), кэш процесса по пути 60 с (≤ 500 записей) — один запрос на `loader` + `generateMetadata`. Все
  гости делят IP-лимит `public-read` web-сервера; доверенный IP клиента от web-сервера — follow-up (R5в).

### Web (SSR, PWA)

`apps/app` собирается `expo export --platform web` (`web.output: 'server'`) и обслуживается `apps/app/server`
(Express + `expo-server`) за Caddy: HTML каждого маршрута — с сервера, OG — `generateMetadata`, данные — API
после гидрации (`loader` — только посев). PWA — manifest-маршрут из темы бренда, service worker — только статика.

## Outbox и очереди

- Модуль пишет событие через `MongoOutboxWriter.append(session, …)` в той же транзакции, что и данные; в payload —
  только id.
- Публикатор (`MongoOutboxPublisherModule` из `@rkarakulov/api-kit/mongo`, только worker) раз в ~1 с захватывает
  пачку (lease `claimId`/`claimedUntil`), ставит задачу `queue.add(type, { outboxEventId }, { jobId: id })` и отмечает
  `publishedAt`.
  Маршруты тип → очередь задаёт composition root (`worker.module.ts`); инфраструктура базы о модулях не знает.
- Задачи идемпотентны: повторная публикация не дублирует задачу (тот же `jobId`), обработчик
  перечитывает состояние из БД. Очистка опубликованных событий outbox — отдельная задача (позже).

## Дизайн-система (`packages/design-tokens`)

Источник — CSS прототипов (19 экранов, визуальный слой «Ателье»).

- **Бренд** (`brand.ts`, единственное место палитры): палитра прототипов (внутри файла, не экспортируется),
  шрифты (Playfair Display + Inter) и роли `text.*`, `surface.*`, `border.*`, `action.*`, `status.*`,
  `map.*`, `surfaceBar.*`, `control.*`, `surface.skeleton` для тем `light` (Jersey Aura), `dark` (Night Ride),
  `panel` (веб-панель «Протокол»: светлая семантика + `nav.*` тёмной навигации).
- **Структурные токены** — из базы `@rkarakulov/design-tokens`: `space`, `inset`, `size`, `stroke`, `radius`
  (квадратная эстетика: скругление только у тумблера), `motion` (пульс скелетона 1.2 с), плотность веб-панели
  (`density.compact`).
- **Типографика** (база): шкала `.t-*` прототипов; вес связан с ролью шрифта на уровне типов.
- **Контраст** (`contrast.ts`): пары ролей каждой темы проверяются тестом по WCAG (текст 4.5, UI 3).

| Клиент | Как подключает |
|---|---|
| app | `configureDesignSystem` (`src/theme/design-system.ts`); `useTheme()` → семантика; `textStyle(name)`; компоненты `@rkarakulov/ui`; данные — `AsyncContent` + `Skeleton*`; витрина `/ui-kit` = `UiKit` базы (dev) |
| admin | `installDesignSystem()` → `designSystemCss({ theme: 'panel' })` в `<head>`; классы `.t-*`, `.skeleton`; шрифты `src/fonts.ts` |

Шрифты на вебе — самохостинг `@fontsource/*` (без внешних CDN). Состояния данных — AGENTS.md §4.12.

Примитивы в приложениях не используются; hex-цвета в TSX/CSS приложений запрещены.

Раздел дополняется по мере реализации; устаревшая схема хуже отсутствующей.
