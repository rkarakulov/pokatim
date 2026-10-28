# Архитектура pokatim

Текущее состояние системы. Решения и их обоснование — в [`../adr/`](../adr/README.md).

## Контейнеры

```
app (Expo)    ─┐
admin (Vite)  ─┼─ HTTPS ─ Caddy ─ api (NestJS) ─┬─ MongoDB 8.0 (replica set, ADR-0007)
web (app, SSR)─┘                                ├─ Redis (BullMQ, rate-limit)
                                                ├─ том trackfiles (исходники заездов на dev; S3 — до прода)
                                                ├─ Open Wearables (агрегатор устройств, ADR-0011)
                                                └─ S3 (треки, фото, карточки, бэкапы)
                         worker (NestJS, BullMQ) ─ те же MongoDB / Redis / S3; ffmpeg, Skia
```

Одна VPS, Docker Compose (`infra/`). Kubernetes, CDN, поиск, push, WebSocket — вне MVP.

## Модули API (`apps/api/src/modules/`)

identity · profile · panel · routes · rides · calendar · races · results · disputes · seasons ·
gamification · sharing · notifications · moderation · media

Есть: `identity`, `profile`, `panel` (доступ к панели «Протокол», ADR-0009), `races` (сезоны и гонки по коридору,
ADR-0010), `calendar` (календарь стартов), `tracks` (загрузки и активности, разбор в worker) и `devices` (Garmin/Wahoo
через агрегатор Open Wearables) — ADR-0011; `routes` (маршруты команды платформы — эталон коридора гонки, ADR-0012
Proposed; `races → routes` только через порт `RouteCatalog`) и `rides` (кофе-райды, ADR-0013 Proposed: зависит
только от `identity`). CLI сервера — `apps/api/src/cli` (`dist/cli/panel.js grant-admin`).
Proposed; `races → routes` только через порт `RouteCatalog`); `results` (заявки и попытки гонок, race-results-03:
порты `RaceRegistry`, `RouteGeometry`, `ActivitySource`); `route-rides` (заезд по маршруту вне гонки, route-rides-01:
порты `RouteRideRoutes`, `ActivitySource`; `account → route-rides` — порт стирания). CLI сервера — `apps/api/src/cli` (`dist/cli/panel.js
grant-admin`).

Межмодульные вызовы — через `index.ts` модуля; события — outbox → BullMQ.

## Ключевые потоки

- **Заезд:** файл (v1 — одна попытка с прогрессом, ADR-0011) или поток агрегатора → хранилище исходников (порт;
  том на dev, S3 — до прода) → задача разбора трека → проверка коридора (`packages/tracks` в worker;
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
  `/v1/seasons/:id/races`, `/v1/calendar`, `/v1/calendar/cities`, `/v1/calendar/months`, `/v1/calendar/:id`): без входа, только опубликованное и отменённое (сезоны — все),
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
- SSR-данные публичных экранов — только `src/lib/public-ssr.ts`: `Uuid` до запроса, таймаут 2 с, результат
  `found` / `notFound` (404 — мета с `noindex`) / `unavailable` (сбой — нейтральная мета без `robots`, не 500), кэш
  процесса по пути 60 с (найденное ≤ 500, 404 — отдельный пул ≤ 100) — один запрос на `loader` + `generateMetadata`. Все
  гости делят IP-лимит `public-read` web-сервера; доверенный IP клиента от web-сервера — follow-up (R5в).

### Календарь стартов в приложении (блок 04)

```
вкладка «Календарь» ─► GET /v1/calendar?discipline&city&month&cursor ─► герой + «Все старты» по месяцам
                    ─► GET /v1/calendar/months, GET /v1/calendar/cities ─► чипы «Дата», «Город»
/calendar/<id>      ─► GET /v1/calendar/:id      (SSR: loader + generateMetadata через public-ssr.ts)
```

- Ответы старта несут `phase` (`upcoming | ongoing | finished`) — сервер по `CLOCK` и датам Минска
  (`calendar.policy.ts`, `calendarPhase`); «Старт прошёл» / «Идёт сейчас» на карточке — только по ней (SSR = гидрация).
  `GET /v1/calendar/months` — агрегация `CalendarRepository.months` (тот же `$match`, что `cities`; ≤ 24); `months` и
  `cities` объявлены до `:id`.
- Ключи: `['calendar','list',{…},'pages']` (префикс общий с Главной), `['calendar','months']`,
  `['calendar','cities']`, `['calendar','detail',id]`. `/calendar/:id` — корневой маршрут вне гардов; вкладка
  `/calendar` — под гардом.
- Внешняя ссылка организатора — только `src/lib/open-external-url(.web).ts` после `RegistrationUrl.safeParse`:
  native — `Linking.openURL` (системный браузер), web — `window.open(url, '_blank', 'noopener,noreferrer')`.

### Кофе-райды (модуль `rides`, блок 05, ADR-0013 Proposed)

```
вкладка «Райды» / Главная ─► GET /v1/rides?city&cursor&limit (AuthGuard, no-store) ─► герой + строки по дням, роль зрителя
                          ─► GET /v1/rides/cities (AuthGuard)                       ─► чипы «Город»
/rides/<id> (вне гардов)  ─► GET /v1/rides/:id (публично, public-read, 60 с; SSR: loader + generateMetadata, noindex)
                          ─► GET /v1/rides/:id/me (вошедшим: роль и права, организатору — version)
«Я иду» / «Не иду»        ─► POST /v1/rides/:id/join|leave — одна findOneAndUpdate (лимит, статус, время в фильтре)
форма / отмена            ─► POST /v1/rides, POST /v1/rides/:id (version), POST /v1/rides/:id/cancel (причина)
```

- Одна коллекция `rides` (миграция `0014_rides`): участники — встроенный массив + `goingCount`; все инварианты участия
  и правки лимита — условие в фильтре одной атомарной операции (без транзакций). Квоты будущих райдов (5) и отметок
  (20) — `countDocuments` до операции, принятая гонка на единицу; основной барьер — лимиты частоты Redis.
- Фаза (`upcoming | past | cancelled`) и права зрителя (`viewer`) — только сервер (`rides.policy.ts`); клиент — показ.
- Приложение: `features/rides/*`, `components/{ride-list-row,ride-going-action}.tsx`, шаринг — `lib/share-link(.web).ts`,
  возврат гостя после входа — `features/auth/return-path(.web).ts` (allowlist путей карточек); мутации — ответ в кеш
  `me`, затем инвалидация `['rides']`. Outbox-событий и аудита в 05a нет.

### Треки и устройства (модули `tracks`, `devices`, ADR-0011)

- **Ручная загрузка:** `POST /v1/tracks/uploads` (`AuthGuard`, `application/octet-stream` — сырой поток, читается
  после гарда с обрывом на 16 МиБ) → формат по сигнатуре (`@pokatim/tracks` `detectTrackFormat`) → sha256 → тот же
  файл — `200` с прежней загрузкой → квота → файл (`TrackFileStore`, временное имя → `rename`) → транзакция
  { `track_uploads` `queued` + outbox `tracks.upload-received` } → `202`. Приложение опрашивает
  `GET …/uploads/:id` (3 с), пока статус не финальный.
- **Разбор (`track-processing`, worker, параллелизм 1):** захват по статусу → исходник → `analyzeTrack`
  (`@pokatim/tracks/parse`) в `worker_threads` (160 МБ, 30 с, `terminate`) → транзакция { `lockUserActivities` →
  `activities` + `activity_tracks` (упрощённая `LineString`, `2dsphere`) → группа дублей (±180 с, ±5 %, основная —
  мощность > пульс > файл > Garmin > Wahoo > раньше) → `ready`/`duplicate` } или `failed: <код>`.
- **Устройства:** порт `WearablesAggregator`, адаптер `OpenWearablesAggregator` — единственное место REST OW (ключ —
  env). `connect` → пользователь OW `pokatim:<userId>` (Redis-замок) → тикет (sha256 в БД, 30 мин) → ссылка OW →
  провайдер → callback OW → `GET /v1/devices/callback?t=` (без входа, только 302) → приложение `POST …/complete`
  под входом: владелец тикета → подключение `active`; чужой → отзыв в OW. Pull каждые 15 мин и «Синхронизировать
  сейчас» → велотренировки провайдера → `/timeseries` без децимации → `TrackIngest.ingestProviderStream` (поток
  `pokatim.stream.v1` — тот же разбор). Вебхук Svix — только сигнал «забрать», без секрета — 404.
- **Очереди:** `track-processing`, `tracks-maintenance` (уборка ежечасно), `devices-sync` (pull, история, отзыв,
  надгробия импортов удалённых загрузок по `tracks.upload-deleted`), `devices-maintenance` (расписание pull, уборка
  неподтверждённых, сверка).

### Маршрут и коридор гонки (модули `routes`, `races`, ADR-0012 Proposed, race-results-01)

- **Маршрут:** панель → `POST /v1/admin/routes?title=` (`PanelGuard` + `races.manage`, лимит 20/ч на сотрудника,
  `application/octet-stream` — `src/raw-body.ts`, обрыв на 5 МиБ) → GPX по сигнатуре → sha256 (тот же файл того же
  сотрудника — `200`) → транзакция { `routes` `processing` + `route_sources` (исходник в БД) + журнал `route.created` +
  outbox `routes.route-received` } → `202`. Панель опрашивает `GET …/routes/:id` (2 с), пока `processing`.
- **Разбор (`route-processing`, worker, параллелизм 1):** захват по статусу `processing` → исходник из `route_sources`
  → `analyzeRoute` (`@pokatim/tracks/parse`) через `src/parse-thread.ts` (`worker_threads`, 160 МБ, 30 с) →
  транзакция { `route_geometries` (линия показа ≤ 1000, сверки ≤ 20 000 точек) + `routes` `ready` } или
  `failed: <код>`; сбой окружения — ретрай, последняя попытка — `failed: unreadable`. Готовый маршрут не меняется.
- **Коридор:** `races.corridor = { routeId, widthM, distanceM }`; создание и правка гонки проверяют маршрут через
  `RouteCatalog.findReady` в своей транзакции (`ROUTE_NOT_READY`), дистанция — длина маршрута. Публично —
  `GET /v1/races/:id` → `corridor: { widthM }` без маршрута и координат.

### Участие в гонке (модуль `results`, ADR-0012 Proposed, race-results-03)

- **Заявка:** `POST /v1/races/:raceId/entry` (`AuthGuard`, лимит 20/ч) → транзакция { `RaceRegistry.admitEntry`
  (запись `races.lockedAt ??= now` и `entryAdmissions + 1`, V-12) → `race_entries` → outbox `results.entry-created` }
  → `201`. Отмена —
  `…/entry/withdraw` под `lockEntry` (замок участника — `$inc version` заявки).
- **Попытки:** `tracks.activity-ready/-removed` (outbox `tracks`) и `results.entry-created` → очередь
  `results-intake` (параллелизм 2) → `syncGroup` под `lockEntry` (группа дублей сейчас, предфильтр по окну, рамке,
  времени приёма) → `race_attempts` `queued` + outbox `results.attempt-check-requested`. Явные — `POST
  /v1/races/:raceId/attempts { activityId | uploadId }` (запрос по загрузке ждёт `activity-ready`).
- **Проверка:** `attempt-check` (параллелизм 1) → исходник (`ActivitySource.readSource`) → `analyzeAttempt` через
  `runParseThread` (семафор: один поток разбора на процесс) → вердикт своей ревизией → `best`/`summary` заявки.
  `results-maintenance` (каждые 10 мин) перепоставляет зависшие.
- **Чтение:** `GET /v1/races/:raceId/entry` (своё, `no-store`), `GET /v1/races/:raceId/results` (публично, кэш 60 с,
  места при чтении в snapshot-сессии), панель — `GET /v1/admin/races/:raceId/{results,attempts}` (`races.read`).

### Заезд по маршруту (модуль `route-rides`, route-rides-01)

- **Проверить:** `POST /v1/routes/:routeId/rides { activityId | uploadId }` (`AuthGuard`, лимит 30/ч) → видимость
  маршрута (`RouteRideRoutes.rideable`, каталог или свой готовый, без кэша) → основная активность группы
  (`ActivitySource`) → существующий заезд группы (тот же; `failed`/зависший — новая ревизия) или транзакция
  { удаление сирот → `route_rides` `queued` → outbox `route-rides.check-requested` } → `201`/`200`.
- **Сверка:** очередь `route-ride-check` (параллелизм 1) → `RouteRideRoutes.matchGeometry` (видимость снова) →
  исходник и линия показа (`ActivitySource`) → `analyzeAttempt` в `runParseThread` (±50 м, окно — время заезда ± 1 мин)
  → итог своей ревизией одной записью.
- **Чтение:** список, кандидаты, заезд, `/track` — только свои, `no-store`; заезды фильтруются по живым активностям
  (`ActivitySource.liveActivities`), сравнение и «зависшие» — при чтении (`route-rides.policy.ts`).

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
