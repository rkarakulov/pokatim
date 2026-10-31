---
paths:
  - "apps/api/src/modules/identity/**"
  - "apps/api/src/modules/media/**"
  - "apps/app/src/features/auth/**"
  - "apps/api/src/modules/panel/**"
  - "apps/api/src/modules/races/**"
  - "apps/api/src/modules/calendar/**"
  - "apps/api/src/public-read.guard.ts"
  - "apps/api/src/cli/**"
  - "apps/admin/src/session/**"
  - "apps/api/src/modules/tracks/**"
  - "apps/api/src/modules/devices/**"
  - "apps/app/src/features/devices/**"
  - "packages/tracks/src/parse*"
  - "packages/tracks/src/{gpx,kml,kmz,tcx,xml,format}.ts"
  - "apps/api/src/modules/routes/**"
  - "apps/api/src/raw-body.ts"
  - "apps/api/src/upload-slots.ts"
  - "apps/api/src/parse-thread.ts"
  - "apps/api/src/modules/rides/**"
  - "apps/app/src/features/rides/**"
  - "apps/app/src/features/auth/return-path*"
  - "apps/app/server/**"
  - "apps/app/src/app/+html.tsx"
  - "apps/app/src/features/web-security/**"
  - "patches/**"
  - "apps/api/src/modules/results/**"
  - "apps/api/src/modules/achievements/**"
---

# pokatim — зоны безопасности (дополняет `security.md`)

Эти пути — зона `security.md`, но его `paths:` (шаблон) их не покрывают: **прочитай `.claude/rules/security.md`
целиком** перед правкой. Security checklist (AuthN/AuthZ · входные данные · данные наружу · злоупотребления · секреты и
логи · аудит) обязателен в task.md; reviewer без него ставит REQUEST CHANGES.

- Пароли — argon2id. Токены — короткоживущий access + ротируемый refresh (хешем); инвалидация всех сессий при сбросе пароля.
- Ссылки verify/reset/delete — одноразовые, с TTL; открытие ссылки ничего не меняет, действие — POST по кнопке.
- Сессия в вебе (ADR-0003 п. 4): refresh — только в cookie `HttpOnly; Secure; SameSite=Strict` с узким `Path`
  (`SESSION_COOKIE` из contracts), без `Domain`, в теле ответа web его нет; access — только в памяти (не
  `localStorage`/`sessionStorage`); cookie-эндпоинты защищены CSRF (Fetch Metadata + Origin,
  `enableCsrfProtection`), CORS с credentials — только для `CORS_ORIGINS`. Native — refresh в теле, SecureStore.
- IP-лимиты — по `rateLimitKeyForIp` (IPv6 — сеть /64). Вход: счётчики IP → e-mail+IP → e-mail по очереди до первого
  отказа (отказанная попытка дальше не списывается).
- Вход по паролю (ADR-0005): лимиты попыток (`RateLimiter` базы, ключи — HMAC e-mail/IP) проверяются до argon2;
  неверный пароль, неизвестный и удалённый адрес — один `401 INVALID_CREDENTIALS` с одинаковым телом, для
  неизвестного адреса verify идёт по хешу-пустышке (выравнивание времени); 429 — одинаково для любых адресов; без
  «осталось N попыток». Сессия выдаётся только через `SessionService.issue`.
- Ротация refresh: предыдущий токен — только в окне повтора (60 с); позже — reuse detection, отзыв сессии
  (`revokedReason`); отказы refresh — один и тот же 401. Логи отзыва/блокировки — только `sid` и причина.
- Удаление аккаунта (ADR-0015) в **той же транзакции** под `lockUserCredentials` отзывает все сессии пользователя
  (`account_deleted`): ротация проверяет удалённость пользователя чтением до атомарного `findOneAndUpdate`, окно гонки
  закрывает только этот инвариант (ADR-0007, R3).
- `POST /v1/account/delete` — только `AuthGuard`, пользователь — `@CurrentUser()`; тело `strictObject` `{ password }`
  (лимит длины входа). Порядок: лимит `account-delete:<uid>` 5/ч (`429`) → активная роль панели — `409
  ACCOUNT_PANEL_MEMBER` (A11, до пароля) → пароль через `CredentialsCheck.verify` (общие счётчики `signin-*`, A2):
  неверный — `403 PASSWORD_INCORRECT` (не 401 — клиент не уходит в refresh) → транзакция: сверка хеша под замком
  (сброс пароля между проверкой и транзакцией — `401`), отзыв сессий, гашение ссылок verify/reset и токена
  регистрации. Ответ `204`, `no-store`, web — `SessionCookie.clear`. Повтор после удаления — 401; двойное нажатие —
  одно событие. Маркер стёртого e-mail — HMAC `EMAIL_TOKEN_SECRET` (ротация снимает блок D-07, runbook), наружу не
  выходит. Логи — `uid`, исход, счётчики; без e-mail. Письмо «Аккаунт удалён» — без ссылок и имени.
- Сброс пароля (ADR-0006): запрос — один ответ для любого адреса, лимиты IP → e-mail (HMAC-ключи) до БД, 429
  одинаков для любых адресов; письмо — только существующему аккаунту. Активна одна ссылка (новая заменяет прежние),
  TTL 1 ч; argon2 — только после проверки ссылки. Смена пароля отзывает **все** сессии (`password_reset`), гасит
  токен регистрации и сессию не выдаёт (вход — заново). Вход сверяет хеш пароля под `lockUserCredentials` (`$inc version`
  в транзакции: проверивший старый пароль до коммита сброса или пока сброс «в процессе» — 401). Пути с токеном в web (`/auth/*`) — `Referrer-Policy: no-referrer`. Лог — `uid` и
  число отозванных сессий.

- Авторизованные эндпоинты (ADR-0008): только `AuthGuard` identity (через `modules/identity/index.ts`) — access JWT
  (`AccessTokenVerifier`: HS256, `iss`/`aud`, `exp` по `CLOCK`, `sub`/`sid` — UUID) **и** живая сессия `sid` того же
  `sub`, пользователь не удалён; вторая проверка JWT вне `AccessTokenVerifier` — нет. Пользователь — только
  `@CurrentUser()` из access, не из тела/пути; любой отказ — один `401 UNAUTHORIZED` без лога. Клиент: Bearer —
  только явным параметром методов api-client, требующих входа (без глобального `getAccessToken`); вызовы — через
  `withAccessToken` (`features/auth/authorized.ts`), refresh — только `refreshAccess` под замком сессии.

- Персональные и биометрические данные (пульс, мощность, FTP, вес) — не в ответах и публичных ссылках, не в логах.
- Защита от перебора e-mail: нейтральные ответы регистрации и повтора письма; удаление аккаунта — за входом, e-mail
  не принимает.
- Неподтверждённый аккаунт не получает полноценных токенов (AD-28) — спорный момент с V-09, решать в task.md.
- Файлы пользователей — под непредсказуемыми ключами (`randomToken`), наружу не выдаются (ADR-0011: порт
  `TrackFileStore`, на dev — том, S3 и подписанные URL — до прода/при выдаче). Исключение — перекодированный аватар
  (ADR-0019, раздел «Профиль райдера и аватары»).
- Парсеры FIT/GPX/KML/KMZ/TCX работают в worker (`worker_threads`) с лимитами по памяти и времени; формат — по сигнатуре,
  не по расширению; XML — отказ при `<!DOCTYPE`/`<!ENTITY` до разбора, без сущностей (XXE).
- Устройства (ADR-0011): подключение активирует только `complete` владельца одноразового тикета (sha256 в БД,
  TTL 30 мин) под `AuthGuard`; callback без входа ничего не меняет; `returnUrl` — только allowlist
  `DEVICE_RETURN_URLS` (`exp://` — не в production); вебхук агрегатора — подпись Svix (`timingSafeEqual`, окно 5 мин),
  без секрета — 404; ключ и секрет агрегатора — только env; в агрегатор — только `external_user_id = pokatim:<id>`
  (без ПДн). Ответы — без `aggUserId`, `aggWorkoutId`, `storageKey`, sha256, тикетов, координат, биометрии.

- Панель «Протокол» (ADR-0009): вход — только паролем через порт identity `PanelCredentials` (та же
  `CredentialsCheck`: общие счётчики `signin-*`, пустышка, один 401); второго входа по паролю в `panel` нет, коллекции
  identity `panel` не читает (только `IdentityAccounts`). Сессия панели — непрозрачный токен в cookie
  `PANEL_SESSION_COOKIE` (`Path=/v1/admin`, `HttpOnly; Secure; SameSite=Strict`, без `Domain`), в БД — sha256; access
  JWT и refresh приложения `PanelGuard` не принимает.
- `PanelGuard` на каждом запросе: сессия → аккаунт активен → **штамп учётных данных** совпадает → член `active` →
  права роли (карта — только сервер). Маршрут `/v1/admin/*` без `PanelGuard` или явного `@Public()` — тест красный.
  Снятие роли отзывает сессии панели в той же транзакции; себя менять нельзя; последнего админа убрать нельзя
  (`lockAdmins`). Логи — `uid`, `sid`, причина; CLI не печатает e-mail.
- 2FA панели (ADR-0024): секрет TOTP — только AES-256-GCM подключом `PANEL_TOTP_KEY` (env, HKDF) с AAD
  `panel-totp:<userId>`, коды восстановления — только HMAC другим подключом, токены вызова и устройства — только sha256; без ключа — `503 TOTP_UNAVAILABLE`
  (fail closed; нечитаемый секрет — тоже 503). Сессия — только после второго фактора по живому вызову (5 мин, ≤ 5
  попыток с атомарным резервом до проверки, гашение в транзакции сессии, штамп совпадает); повтор кода закрыт
  `lastUsedStep`, код старой эпохи 2FA не принимается; вход по устройству перепроверяется в транзакции сессии; лимиты `panel-totp-ip` → `panel-totp-user` на
  каждую попытку. Неверный, повторённый и погашенный код — один `400 TOTP_INVALID_CODE`. Секрет и otpauth отдаются
  только при подключении. Cookie устройства `Path=/v1/admin/session` пропускает только код, гаснет со штампом и эпохой.
  Сброс — `members.manage`, не себе, с причиной, отзывает сессии цели; CLI `reset-totp` не печатает e-mail. Логи —
  `uid` и причина, без кодов и секретов.
- Приглашения панели (ADR-0026): токен — `HMAC(EMAIL_TOKEN_SECRET, "panel-invitation:" + id)`, в БД — только sha256,
  принятие сверяет хеш с выводом из текущего секрета (`timingSafeEqual`; ротация гасит выданные ссылки), ссылка —
  `invite#token=…` (фрагмент не уходит на сервер и в Referer). `accept` — IP-лимит, нежилое приглашение — `410
  PANEL_INVITATION_INVALID` до argon2, затем общие счётчики `signin-*`, роль — только аккаунту с тем же e-mail (иначе
  `409 PANEL_INVITATION_EMAIL_MISMATCH`), удалённый аккаунт и смена пароля ловятся замком аккаунта и штампом в
  транзакции. E-mail приглашённого — не в журнале, outbox и логах; в письмах о роли нет причины.
- **Принятый риск — тот же домен `/admin/`** (C3): XSS web приложения может действовать от имени открытой в том же
  браузере сессии панели. Обязательно **до прода**: включить `PANEL_TOTP_ENFORCED` (ADR-0024); строгий CSP web приложения — есть (ADR-0025); CSP панели —
  `infra/docker/admin-nginx.conf` (менять только вместе со смоуком `pnpm e2e:admin`, он отдаёт тот же заголовок).
- Доменные модули панели (`races`, `calendar`): каждый `/v1/admin/*` — `PanelGuard` + `@RequirePermission` (тест
  `src/admin-routes.test.ts` обходит контроллеры всех модулей); владение гонкой — в сервисе по правам сессии (без
  `races.manage_any` чужая — `404`, не 403); `ownerUserId`, статус, фаза, сезон — только сервер. Публичное чтение —
  только опубликованное, без владельца, имён сотрудников и `version`; IP-лимит `public-read`.

## Участие и результаты (race-results-03)

- Приложение — `AuthGuard`, пользователь — из access; заявка своя по `(raceId, userId)`; загрузка и активность —
  порт `ActivitySource` с `userId` вызывающего, чужое и неизвестное — один `404`. Статусы, вердикты, время, места,
  `lockedAt`, `origin` — только сервер; клиент присылает id и намерение. Лимиты `results-entry-user` 20/ч,
  `results-attempt-user` 30/ч; ≤ 30 попыток и запросов на заявку.
- Публичная таблица — `PublicReadGuard`, только опубликованные гонки, строки без `userId`; имя
  (`riderName`) — только при `showNameInResults` через порт `RIDER_NAMES`, согласие — в фильтре запроса
  (profile-rider-name), иначе `null` («Участник»); панель («Участники», «Попытки», ответы исключения и возврата) — тот
  же порт, тоже только с согласием (profile-02). Панель — `PanelGuard` +
  `races.read`, видимость гонки — как в `races` (чужая гонка организатора — 404); наружу — `userId` и id попыток,
  без e-mail, координат и биометрии. Логи — id, статусы, коды.
- Свой трек попытки (maps-02): `GET /v1/races/:raceId/entry/attempts/:attemptId/track` — `AuthGuard`, `no-store`,
  оба id — `Uuid`; только владельцу: попытка этой гонки, `userId` из access, видна в «моём участии» (без скрытых
  auto и снятых), линия — своей активности (`userId` в фильтре порта). Чужая, скрытая, другой гонки, неизвестная,
  без линии — один `404 NOT_FOUND`. Наружу — линия показа и позиции разметки, без id активности, времени точек и
  датчиков; чужие треки не отдаются. Клиент — только клиентский запрос (не SSR), кэш очищается при выходе.

## Сброс имени райдера (profile-02)

- `/v1/admin/profiles/*` — `PanelGuard` + `@RequirePermission('profiles.moderate')` на классе (admin, moderator);
  `userId` пути — `Uuid`, тело — `strictObject` с `ActionReason`. Журнал `profile.name_reset` — объект `rider`
  (`Участник ·<id>`), причина; ни сброшенного имени, ни `targetUserId`. Лог после коммита — только id сотрудника и
  исход, без имени, причины и `userId` райдера. Причина может содержать имя (D11) — предупреждение в окне сброса.

## Анкета Verified и флаги (race-results-07)

- `GET|PUT /v1/profile/verified` — `AuthGuard`, только своя анкета, `no-store`; лимит `profile-verified-update:<uid>`
  30/ч; тело — `strictObject` с пределами (вес 30–200, рост 120–220, FTP 50–600, год 1920…текущий−18,
  `consent: true`). Вес, рост и FTP — только владельцу. Значения анкеты не пишутся в логи, outbox и журнал (int-тест
  логгера); в лог — `uid` и исход.
- Панель: `GET|PATCH /v1/admin/profiles/:userId/verified-demographics` — `PanelGuard` + `profiles.verified_edit`
  (только admin), наружу — пол, год и фиксация (без веса, роста, FTP); правка — с `ActionReason`, журнал
  `profile.verified_demographics_changed` (subject `rider`, `changedFields` без значений); лог — id сотрудника и исход.
- Флаги «Требует внимания» и датчики попытки — только ответы панели (`results.*`/`races.read`); публичная таблица,
  финишёры и «моё участие» их не содержат (int-тест ключей). Метрики — проценты и отношения, без пульса и мощности.
- Группу, уровень-правило, место и флаги считает сервер; клиент присылает намерение (`tier`, `groupKey`).

## Протокол (race-results-05)

- Права: `results.manage` (исключение, возврат, перепроверка, публикация) — admin и organizer (свои гонки через
  видимость `races`); `results.revise` (DQ, отмена DQ, пересчёт после публикации) — только admin; moderator — чтение.
  Каждый эндпоинт — `PanelGuard` + `RequirePermission`; попытка или участник другой гонки — 404.
- Тело — `strictObject` с `ActionReason` (3–500); лимит мутаций `results-panel-user` 60/ч на сотрудника.
- Причина исключения, DQ и пересчёта — только панели и append-only журналу (`panel_audit`, `race_recalculations`),
  райдеру не уходит; логи — без причины и без `userId` райдера.

## Рейтинг сезона (race-results-08)

- Публично (`GET /v1/seasons/:id/standings`, `/table`) — `PublicReadGuard`, `public, max-age=60`, строки без
  `userId` (ключи держит `standings-read.int.test.ts`), имя — только с согласием (`RIDER_NAMES.publicNames`);
  неизвестный сезон — 404 до разбора курсора, курсор чужого сезона — 400.
- `GET /v1/seasons/:id/standings/me` — `AuthGuard`, пользователь из access, `no-store`, только свои строки.
- Панель (`/v1/admin/seasons/:id/standings*`) — `PanelGuard` + `races.read`; `userId` строки — только сотруднику,
  видящему все гонки (`SeasonRaces.seesAllRaces`, не `ownScope`): организатору — `null` (сезон сквозной по гонкам
  разных организаторов, RC-8). Логи регламента — id сезона, число таблиц и строк, длительность; без имён и `userId`.

## Споры (race-results-06)

- D-51: в ответах приложения цель (`against`) видит категорию, статус, срок, свой ответ и исход — без заявителя и
  описания; заявитель (`filed`) — свой спор без ответа участника; публично — ничего. Состав ответов — явный список
  полей. Спор, где пользователь не заявитель и не цель, и действие не своей стороны (отзыв от цели, ответ от
  заявителя) — один `404 DISPUTE_NOT_FOUND`.
- Права: `disputes.read` (список, разбор), `disputes.decide` (решение) — admin и moderator; organizer — нет
  (`[ASSUMPTION]` R1; если права появятся — видимость через `findForPanel`). Каждый эндпоинт — `PanelGuard` +
  `RequirePermission`. В панели заявитель и участник — `entryId`/`userId`, без e-mail.
- Вход: `strictObject`, описание 0–2000 и ответ 3–2000 без управляющих символов, заметка 0–1000, шаблон — из карты
  исхода; право подачи, сроки (D-44, D-25), DQ и анонимность считает сервер. Злоупотребления: один спор на пару
  (заявитель, цель), ≤ 3 открытых на заявителя в гонке, лимиты `disputes-user` 20/ч и `disputes-panel-user` 60/ч.
- Логи и события outbox — без описания, ответа, заметки и `userId` райдеров (только id и коды); `dispute_events` —
  без свободного текста. Журнал `panel_audit` (`disputes.decided`) пишет в `reason` заметку, а без неё — код шаблона.
  Шаблонная причина видна участникам, внутренняя заметка — только команде. Биометрия — только ряды 06b (ниже).
- Ряды пульса и мощности (06b): только `GET /v1/admin/disputes/:id/series` (`PanelGuard` + `disputes.read`,
  `no-store`), только оспоренный результат; клиент шлёт id спора, что строить — сервер. Ряды — прореженные (≤ 400
  ячеек), без координат и времени точек; хранятся только в Redis с TTL (15 мин, ключ — id попытки и ревизия), в
  MongoDB, outbox, job data и логах значений нет. Просмотр — журнал `disputes.series_viewed`; постановка задачи —
  лимит `dispute-series-user` 30/ч. Панель запрашивает ряды по кнопке, `gcTime: 0`.

## Загрузка маршрутов (race-results-01)

- `POST /v1/admin/routes` — `PanelGuard` + `races.manage`, лимит 20/ч на сотрудника до чтения тела; тело — только
  `application/octet-stream` (`readLimited`, обрыв на 5 МиБ — `413 ROUTE_TOO_LARGE` + `Connection: close`); формат —
  по сигнатуре (не GPX/KML/KMZ/TCX, в т. ч. `<!DOCTYPE` до корня и FIT — `415 ROUTE_FORMAT_UNSUPPORTED`; UI панели выбирает
  `.gpx,.kml,.kmz,.tcx`); разбор — только worker через `runParseThread` (отказ на `<!DOCTYPE`/`<!ENTITY`, подсчёт элементов и
  `rtept` до дерева, `XMLValidator`). Слотов приёма у панели нет (сотрудники), таймаут тела — общий (ниже).
- Чтение — `races.read`; чужой необработанный маршрут — 404. Публично в карточке `GET /v1/races/:id` — только
  `corridor.widthM`: `routeId` и координаты не выходят. Логи — `routeId`, код отказа, id сотрудника; без названий
  файлов и координат.
- Исключение — карта коридора (maps-01, ADR-0014): `GET /v1/races/:id/route` (`PublicReadGuard`, `public,
  max-age=60`) отдаёт **линию показа** (≤ 1000 точек), старт, финиш, рамку и `widthM` — только опубликованной или
  отменённой гонки с коридором и готовым маршрутом (иначе один `404 NOT_FOUND`, как у карточки). Состав ответа —
  явный список полей: без `routeId`, названия маршрута, линии сверки, sha256, статуса и владельца (int-тест на
  ключи). Маршрут опубликованной гонки и так нужно проехать — линия показа публична; линия сверки — нет. Тайлы — по
  публичным URL стиля из env (`EXPO_PUBLIC_MAP_STYLE_*`, ключ провайдера — частью URL, сейчас без ключа).
- Исключение — каталог маршрутов команды (routes-01, `docs/product/routes.md`): **линия показа, старт и финиш
  маршрута, опубликованного в каталоге**, публичны (`GET /v1/routes/:id/map`). Публикует сотрудник осознанно: `POST
  /v1/admin/routes/:id/publish|unpublish` — `PanelGuard` + `races.manage`, только `ready` (иначе `409
  ROUTE_INVALID_STATE`), журнал панели без координат; окно публикации показывает линию и предупреждение (RC-11).
  Публичное чтение (`GET /v1/routes`, `/cities`, `/:id`, `/:id/map`, `/:id/races`) — `PublicReadGuard`, `public,
  max-age=60`; видимость — одна точка `RoutesRepository.findInCatalog` (условие `IN_CATALOG`; с routes-06 — и
  одобренные маршруты райдеров, раздел ниже; не опубликованный, снятый, не готовый, неизвестный — один `404
  NOT_FOUND`, включая карту). `findPublished` — только порт гонок `RouteCatalog.inCatalog` («Гонки на маршруте»,
  маршруты команды). Ответы — явный список полей: без
  `ownerUserId`, `sha256`, статуса, `failure`, `attempts` и линии сверки (int-тест на ключи). Снятый маршрут может
  быть виден до минуты из кэша (RC-13).
- Очищенный экспорт каталога (routes-03, routes-formats): `GET /v1/routes/:id/{gpx,kml,tcx}` — только маршрут каталога (`findInCatalog`, иначе
  один `404 NOT_FOUND`), `PublicReadGuard` + отдельный IP-лимит `route-gpx` 30/мин — один бюджет на все форматы (`ROUTE_POLICY.exportIpLimit`) (`IpRateLimitGuard` +
  `@IpRateLimit`, `consumeIpLimit` в `src/public-read.guard.ts`; 429 + `Retry-After`), `public, max-age=60`. Файл
  посчитан worker'ом (`routeGpx`: только `trkpt lat lon` и `ele` точек линии сверки — без `time`, датчиков,
  `name`/`desc`, `metadata`, `extensions` исходника; `routeKml` — одна `LineString`; `routeTcx` — курс `Name=Pokatim` с
  условным временем; в файлах только числа); API экспорт не разбирает (route-exports-gzip: хранится gzip —
  отдаётся с `Content-Encoding: gzip` или распаковывается `gunzip` с `maxOutputLength` = `exportMaxBytes`, лог сбоя —
  без текста ошибки). KML/TCX нет у экспорта `derivedVersion` 1 — 404. Заголовки файла — только у 200:
  `ROUTE_EXPORT_CONTENT_TYPES` (`application/gpx+xml`, KML, TCX), `Content-Disposition: attachment` с ASCII-fallback и `filename*` RFC 5987
  (`routeFileName`/`routeContentDisposition`: без `\p{Cc}`/`\p{Cf}` — bidi-подмена расширения, без `\/:*?"<>|`, ≤ 80 кодовых точек),
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`. Раскрывает то же, что
  линия на карте, плюс высоты. Логи бэкфилла — `routeId` и код, без названия и координат.

## Маршруты райдера (routes-02)

- Личный маршрут райдера (`origin: 'rider'`) — приватные данные автора: `/v1/routes/mine*` (загрузка, список,
  карточка, карта, `rename`, `delete`) — только `AuthGuard`, `no-store`, пользователь — `@CurrentUser()`; id — `Uuid`.
  Видимость — фильтр `{ ownerUserId, origin: 'rider' }` в `RoutesRepository`; чужой, маршрут платформы и неизвестный —
  один `404 NOT_FOUND` (без различия). Панель, каталог, публичные ручки и порты `RouteCatalog`/`RouteGeometry` (коридор,
  сверка, карта гонки, LRU-кэш) читают только `origin: 'platform'` — отрицательные int-тесты на каждую точку.
- Загрузка: лимиты `routes-upload-rider:<uid>` 20/ч и `routes-upload-ip:<hmac>` 60/ч и слот приёма (4 на процесс,
  1 на райдера, `UploadSlots`) — **до** чтения тела; тело — `application/octet-stream` (`readLimited`, 5 МиБ → 413 + `Connection: close`); формат — по сигнатуре
  (`detectRouteFormat`: GPX/KML/TCX по корню, KMZ — любой zip `PK\x03\x04`, разбор архива — worker; `<!DOCTYPE` до
  корня → 415); квота 100 своих маршрутов — `409 ROUTE_QUOTA_EXCEEDED`
  (мягкая, после дедупа). KML — те же защиты, что GPX (`xml.ts`: отказ на `<!DOCTYPE`/`<!ENTITY`, подсчёт элементов и
  `gx:coord` до дерева, `XMLValidator`, обрыв кортежей `coordinates`); TCX — те же защиты, подсчёт `Trackpoint`; предел
  элементов маршрута — `ROUTE_XML_MAX_ELEMENTS` (1 млн). KMZ (`kmz.ts`, `node:zlib`): EOCD с проверкой длины
  комментария, только stored/deflate, CRC, zip64/шифрование → `unreadable`, распаковка ≤ 16 МиБ (`maxOutputLength`),
  на диск не пишется; разбор — только `runParseThread` в worker.
- Наружу — `MyRoute` явным списком полей (без `origin`, `ownerUserId`, `sha256`, `attempts`, `catalog`, линии сверки;
  routes-06: `publication` — без счётчиков подач и жалоб и `version`; `canPublish` и `submissionsExhausted` считает
  сервер);
  карта — только линия показа своего готового маршрута. Логи — `routeId`, `userId`, коды; без названий, имён файлов и
  координат. Действия райдера не пишутся в журнал панели (`PanelAudit`).

## Маршруты райдера в каталоге (routes-06)

- Публикация — только премодерация: автор подаёт (`POST /v1/routes/mine/:id/publish`, свой готовый маршрут, `AuthGuard`,
  иначе один `404`), публично маршрут виден **только** в `approved` (условие `IN_CATALOG` в `RoutesRepository`:
  список, города, карточка, карта, GPX; защита в глубину — подставленный `catalog` без `approved` не виден, int-тест
  N1). Порты гонок, панель «Маршруты», `routesByIds` и LRU-кэши — только `platform` (N3).
- Модерация — `PanelGuard` + `routes.moderate` (admin, moderator) на классе `RoutesModerationController`; заявка видна
  модератору только в `pending | approved | rejected | hidden` (отозванная — `404`: автор забрал согласие на показ
  линии). Ответы панели — автор только `authorUserId`, без имени (N8) и без автора жалобы.
- Имя автора в каталоге — только при галочке заявки и заданном `publicName` (U3, RC-2); в OG и панели имени нет.
  Карточка маршрута райдера в приложении — `robots: noindex` (UGC, как райды; 8.1 RC-6).
- Жалобы — вошедшему не-автору, на маршрут райдера в каталоге; одна на маршрут (уникальный индекс, повтор — успех без
  записи). Лимиты: подачи 10/сут, ≤ 3 на проверке, ≤ 3 подачи маршрута (`409 ROUTE_PUBLICATION_LIMIT`), жалобы 20/сут.
- Логи — id маршрута, пользователя, действие, код причины; без названий, комментариев и имён. Событие outbox — только
  id и решение.

## Приём тела загрузок (upload-limits-kml-panel)

- Заезды (`/v1/tracks/uploads`) и «мои маршруты» (`/v1/routes/mine`): слот приёма `src/upload-slots.ts` — не больше
  4 приёмов на процесс API и **1 на пользователя** (второй одновременный — `429 RATE_LIMITED`, `retryAfterSec: 5`, до
  чтения тела); слот освобождается в `finally` обработчика при любом исходе (успех, 4xx, таймаут, обрыв). Слоты — в
  памяти процесса (Redis-слоты между процессами — нет).
- `readLimited` (все загрузки: заезды, мои маршруты, маршруты панели, аватар, PDF материалов): тишина между порциями тела дольше 30 с или всё тело дольше 180 с —
  `408 VALIDATION_FAILED` `{ fields: [{ path: 'body', code: 'INVALID' }] }`; остаток тела сливается без хранения,
  ответ — `Connection: close`. Закрытие после отказа — lingering close (`lingerOnClose`): FIN после ответа, приём
  сливается до конца тела, FIN клиента или `LINGER_MS` (5 с), затем `destroy` (иначе хвост тела давал RST, и клиент
  получал обрыв вместо 413/408). Таймауты — `DEFAULT_BODY_TIMEOUTS` (`raw-body.ts`), в политиках модулей —
  `bodyTimeouts`.

## Кофе-райды (блок 05, ADR-0013 Proposed)

- UGC: публичная карточка `GET /v1/rides/:id` — всегда `robots: noindex`; OG и мета — название, дата, город, км, темп
  (без описания и подписи организатора); описание — текст (`Text selectable`, без разметки и автоссылок).
- Все мутации, лента, города и `me` — `AuthGuard`; пользователь — только `@CurrentUser()`. Владение — фильтр
  `organizerUserId` в той же атомарной операции; чужой райд для правки/отмены — 404 (не 403).
- Ответы без `organizerUserId`, id участников и `version` (кроме организатору в `me`/мутациях); роль зрителя — по
  `$elemMatch` своего id. Подпись организатора — только введённая им самим (`organizerName`), данные аккаунта не
  читаются.
- Лимиты частоты по `uid`: `rides-create` 10/сут, `rides-manage` 30/ч, `rides-rsvp` 60/ч; квоты 5 будущих райдов и
  20 отметок (принятая гонка на единицу). Логи — id райда и `uid`, без названий, мест и описаний.
- Возврат гостя после входа — только путь из allowlist `^/(rides|races|calendar)/<uuid>$` и точный
  `/settings/account/delete` (экран удаления, адрес для Google Play)
  (`features/auth/return-path-allowlist.ts`), не адрес; шаринг — только собственный web-origin.
- Жалоба (05b) — `POST /v1/rides/:id/reports` под `AuthGuard`, лимит `rides-report` 20/сут по `uid`, одна на
  (райд, пользователь) — уникальный индекс; организатор — 409; скрытый чужому — 404. Логи — id райда, `uid` и код
  причины, без комментария.
- Модерация — `/v1/admin/rides*` только `PanelGuard` + `@RequirePermission('rides.moderate')` на классе (admin,
  moderator); причина действия — `ActionReason` в журнал `PanelAudit.append` в транзакции действия. Наружу — без
  `reporterUserId`, e-mail и id организатора (подпись — `organizerName`); комментарий жалобы видит только команда.
- Скрытый райд (`hidden`) — 404 всем, кроме организатора (`visibleTo` политики — первой проверкой после чтения, до
  идемпотентных веток «Я иду»/«Не иду»).
- Маршрут райда (05c): прикрепить — маршрут каталога или свой готовый (`ownRider` в фильтре); остальное — один `400
  RIDE_ROUTE_UNAVAILABLE` без оракула существования. `route`/`start` наружу — только маршрут, видимый зрителю сейчас
  (порт `RideRoutes` без кэша; `private` — только организатору, двойная проверка); `geo`/`startPrecise` не выходят.
  Порт `RideRoutes` — в перечне точек, которые не кэшируют маршрут райдера. «Рядом»: `near` округляется сервером до
  0,01°, не хранится и не логируется; лимит `rides-near` 60/мин (лента с `near`, карта ленты).

## Заезд по маршруту (route-rides-01)

- `/v1/routes/:routeId/rides*` — только `AuthGuard`, `no-store`, пользователь — `@CurrentUser()`, id — `Uuid`; только
  свои заезды (`userId` в каждом фильтре) и свои активности/загрузки (порт `ActivitySource`, чужое — `404`).
- Видимость маршрута (каталог или свой готовый) — порт `RouteRideRoutes` без кэша на **каждой** ручке и в worker перед
  чтением линии сверки (RC-9); не виден — один `404 NOT_FOUND`. `RouteRideRoutes` — в перечне точек, которые не
  кэшируют маршрут райдера.
- Наружу — явный список полей (int-тест ключей): без `userId`, id активности (кроме кандидатов — свои), `sha256`,
  `trackMap`, `engineVersion`, датчиков и координат; линия — только своя в `/track`. Сравнение — только со своими
  заездами (R2).
- Злоупотребления: лимит `route-rides-user:<uid>` 30/ч (считает и 404), квота 100 заездов на маршрут (мягкая, RC-11),
  кандидаты ≤ 30. Логи — id заезда, маршрута, пользователя, статусы и коды; без названий и координат.

## Профиль райдера и аватары (rider-profile, ADR-0019)

- Свои эндпоинты (`/v1/profile/avatar`, `…/avatar/delete`, `/v1/profile/{stats,races,rides}`) — `AuthGuard`,
  `no-store`, пользователь — `@CurrentUser()`.
- Аватар: тело — только `application/octet-stream` ≤ 10 МиБ (`readLimited`, 413 + `Connection: close`); формат — по
  сигнатуре (JPEG/PNG/WebP) и совпадению с декодером; JPEG/WebP ≤ 100 Мп, PNG ≤ 25 Мп, `failOn: 'error'`, таймаут; вывод — только
  перекодированный JPEG без метаданных (EXIF/GPS стираются, исходник не хранится). Лимиты: 20 загрузок/ч, слот чтения 4 на
  процесс и 1 на пользователя (отказ слота квоту не списывает), обработка — 1 на процесс (ожидание ≤ 5 с), тело — тишина 10 с, всё 60 с. Курсор публичной
  истории — только id гонки (без времени заезда). Отдача `GET /v1/avatars/:id` — `PublicReadGuard`, ключ — `randomToken`, `nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, `immutable` только у 200. Согласие на отдаче не
  проверяется; RC-A2 закрыт вариантом (b) (profile-moderation): переход «публичен → нет» перевыпускает id фото — старый
  URL 404 на сервере (кэш браузеров с `immutable` — принятый риск).
- Публичный профиль `GET /v1/riders/:publicId` и `/races` — `PublicReadGuard`, `public, max-age=60`; доступ — по
  непредсказуемому `publicId` (не `userId`) и только при имени и согласии (условие в фильтре порта), иначе 404. Ответ —
  явный список полей: без `userId`, км, набора и райдов (ключи держит `riders.int.test.ts`); история — только
  опубликованные протоколы.
- Клуб — те же запреты `\p{Cc}`/`\p{Cf}` и служебных подписей, что у имени. Логи — `uid`, размер, формат и исход;
  без имени, клуба, байтов и сообщений libvips. Смена фото и клуба самим райдером не журналируется.

## Достижения (achievements, ADR-0020 Proposed)

- `GET /v1/achievements`, `POST /v1/achievements/seen` — `AuthGuard` на классе, `no-store`, пользователь — только
  `@CurrentUser()`, `userId` в каждом фильтре репозитория; тело `seen` — `strictObject`, строгий `z.enum`, 1–9 без
  повторов (400 `VALIDATION_FAILED`); чужие, отозванные и незнакомые коды — без записи и без ошибки. Лимиты
  `achievements-read:<uid>` 60/мин, `achievements-seen:<uid>` 120/ч (429). GET пишет ≤ 9 документов на пользователя.
- Публично `GET /v1/riders/:publicId/achievements` — `PublicReadGuard`, `public, max-age=60`, `RiderPublicId` pipe;
  только при имени и согласии (`RIDER_PROFILES.findPublic`), иначе один 404; без записи. Только `race_*` — маршруты и
  райды личные (A7).
- Наружу — явный список полей (ключи держит `achievements.int.test.ts`): `code`, `object { kind, id, title }`,
  `factDate` (день по Минску, без времени суток — RC-7), `level`, свой — ещё `seen`; свой список — `items` и
  `progress` (`{ code, level, current, target }`, только свой — в публичном ответе и на карточке нет); без `userId`,
  id выдачи, `grantedAt`, `revokedAt`, `seenLevel`. Клиент на уровень не влияет: `POST seen` — только коды, уровень —
  из документа в атомарной операции. Названия маршрутов — только видимых райдеру (RC-4). Логи — `uid`, флаг `first` и счётчики; без кодов
  объектов, названий, уровней и `publicId`.

## Модерация профиля (profile-moderation)

- Жалобы `riders/:publicId/{me,reports}` — `AuthGuard` + `@CurrentUser()`, `no-store`, `RiderPublicId` pipe (400 на
  мусор), тело `strictObject` (причина — enum, комментарий — `optionalText(500, MULTI_LINE)`). Злоупотребления: лимит
  `profile-report:<uid>` 20/сут (до проверок — 404 тоже тратит квоту), одна открытая жалоба на профиль, повтор не
  пишет. Оракулы: непубличный и неизвестный `publicId` — один 404; `own_profile` раскрывает только «это вы».
- Панель `admin/rider-profiles/*` — `PanelGuard` + `profiles.moderate` на классе (сторож `admin-routes.test.ts`),
  `:userId` — `Uuid`, причина — `ActionReason`. Ответы — имя только при согласии (Q2), клуб и фото — всегда (S-2,
  модератору), жалобы без `reporterUserId`/`resolvedBy`; счётчики жалоб не выходят в `ProfileView` и публичный профиль.
- Журнал и логи — подпись `Участник ·<id>`, причина модератора и `details.reportCount`; без имени, клуба, id фото,
  комментариев и `userId` цели в логах (D14). Причина — свободный текст (D11): предупреждение в диалоге панели.
- Сброс фото удаляет документ `profile_avatars` (URL — 404); стирание аккаунта удаляет жалобы **на** пользователя.
- Запрет загрузки фото (profile-moderation-followups) — проверка в `admit` до слота, лимита и тела (байты не читаются,
  квота не списывается) и повторно по документу профиля в транзакции замены; все отказы `admit` (запрет, слот, лимит)
  — с `Connection: close`. «Снять запрет» — `profiles.moderate` + причина, журнал. Событие `profile.field-reset` и
  текст уведомления — без причины модератора и сброшенного значения; в логах — без даты запрета.

## Уведомления и push (ADR-0017)

- `/v1/notifications*` — только `AuthGuard`, все выборки и мутации с `userId` сессии в фильтре; чужое уведомление —
  404, снятие чужого токена — 204 без эффекта (ответ одинаковый). Лимиты мутаций и регистрации токенов — по `uid`;
  токенов на пользователя ≤ 10.
- Push-токен — строгий формат `ExpoPushToken[…]`, в логи не попадает (в логах — id документа). Снятие: выход
  (приложение — до отзыва сессии), `DeviceNotRegistered`, удаление аккаунта — в транзакции удаления. Токен привязан
  к сессии регистрации: push — только на токены живых сессий, токены мёртвых (выход, сброс пароля, reuse) снимаются
  при доставке.
- Исходящий HTTP — только `EXPO_PUSH_API_URL` (в production — `exp.host`), таймаут, лимит тела, без редиректов;
  `EXPO_ACCESS_TOKEN` — только env и заголовок. Тексты push и писем — без чужих ПДн (N12); цель — тип и id из белого
  списка, приложение адресов из push не принимает.

## Карточки для сторис (story-cards, ADR-0018)

- Статус карточки — только вошедшему (`AuthGuard`, `userId` из access), только своя заявка `(raceId, userId)`; чужая
  гонка без заявки — 409 без утечки. Права — один предикат `storyCardEligible` (`actions.canShareStory` и 409).
- PNG по капабилити-токену (`randomBytes(16)`, base64url, regex до Redis; кривое имя и неизвестный — один 404 JSON),
  без входа, TTL 24 ч, `private, max-age=86400, immutable`, `nosniff`, `CSP: default-src 'none'; sandbox`,
  `Referrer-Policy: no-referrer`. Токен в пути попадает в access-лог nginx dev — принято (ADR-0018, как
  `auth/verify/<token>`).
- Содержимое картинки — публичные данные таблицы; имя — только через `RIDER_NAMES` (согласие); линия — только отрезок
  между воротами (`sliceLine` по `trackMap.segment`) или линия маршрута; без e-mail, `userId`, времени суток заезда.
- Лимиты: `story-card-read:<uid>` 120/мин, `story-card-render:<uid>` 30/ч (только при захвате ключа постановки),
  IP `story-card-image` 120/мин; PNG ≤ 2 МБ. Логи worker — заявка, шаблон, итог, байты, мс (без `userId`, имени,
  токена).
- Приглашение кофе-райда (`GET /v1/rides/:rideId/invite-card`): `AuthGuard`, скрытый — 404 и организатору, не
  будущий — 409; на картинке — только публичные поля райда (как `GET /v1/rides/:id`, без описания, подписи
  организатора, участников); линия — только маршрута в каталоге (`RideRoutes.catalogLine`), `private` — никогда.
  Лимиты — общие с карточками сторис; логи — id райда, шаблон, итог (без `userId`, названия, места, токена).
- Карточка достижения (`GET /v1/achievements/:code/story-card`): `AuthGuard`, в пути только код (чужое недостижимо),
  не получено/отозвано — 409; на картинке — каталог, название гонки или райда, маршрут — только из каталога (свой
  приватный — без строки объекта), дата факта, имя через `RIDER_NAMES`; без id объектов. Логи — код, шаблон, итог;
  причина провала — только тип ошибки.
- Карточка маршрута (`GET /v1/routes/:routeId/story-card`): `AuthGuard`, только маршрут в каталоге (`IN_CATALOG`),
  остальное — один 404; на картинке — поля `RouteOgFacts` (без автора), линия — `catalogLine`. Логи — без `userId`,
  названия, токена; причина провала — только тип ошибки.
- OG райдера (`/v1/og/{cards,images}/rider/<publicId>`): только публичный профиль (`findPublic` — имя + согласие),
  иначе 404 до чтения PNG; на картинке и в alt — без имени, клуба, фото и `publicId`; `publicId` — только в URL
  `og:image`. Логи OG — префикс хэша (`ogLogId`), не `publicId`.

## Материалы событий (event-tickets PR C, ADR-0023 п. 10)

- PDF организатора — исключение из «подписанных URL», как аватары: `GET /v1/event-files/:id` без входа по
  `randomToken`, тип — только по сигнатуре `%PDF-` (≤ 10 МиБ, `readLimited`, 413 + `Connection: close`, лимит загрузок
  до тела), ответ — `application/pdf`, `Content-Disposition: attachment` (ASCII-заглушка + `filename*` UTF-8, имя без
  `/\"` и управляющих), `default-src 'none'; sandbox`, `nosniff`, `Referrer-Policy: no-referrer`, `immutable` только у
  200; кривой и неизвестный id — один 404. Ссылки материалов — https без учётных данных (`RegistrationUrl`).
- Панель: `Permissions-Policy` (`camera=(self)`, остальное выключено) — в каждом `location` `admin-nginx.conf` и в
  `vite preview`; сторож — `apps/admin/src/csp.test.ts`.

## CSP web приложения (ADR-0025)

- Политика — `contentSecurityPolicy` в `apps/app/server/web-server.ts`, nonce — на каждый ответ, в рендер — заголовком
  запроса `x-pokatim-csp-nonce` (входящий вырезается). `script-src 'self' 'nonce-…'`: без `unsafe-inline`,
  `unsafe-eval`, `strict-dynamic`; стили — `'unsafe-inline'` (RN-web), nonce в `style-src` не добавлять.
- Новый inline-скрипт — только в `+html.tsx` с `nonce={cspNonce()}`; `dangerouslySetInnerHTML` — только константы и
  `JSON.stringify` значений из закрытых списков. Не дописывать nonce постобработкой HTML.
- Новый внешний источник (API, картинки, карты) — в `contentSecurityPolicy` и тест; провайдер карт — `MAP_ORIGINS`.
- Патч `@expo/router-server` (`patches/`) — переносить при обновлении Expo; сторож — `web-server.test.ts`.
- Без `unsafe-eval`: zod в web — `jitless` (`features/web-security/zod-jitless.web.ts`, первый импорт `theme/design-system.ts`);
  новая библиотека с `eval`/`new Function` — нарушение, смоук «строгий CSP … без нарушений» падает.
- `EXPO_PUBLIC_API_URL` web-контейнера (runtime, CSP) = build-arg сборки (бандл): разойдутся — CSP заблокирует API.
