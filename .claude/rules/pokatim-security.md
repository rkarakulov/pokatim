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
  - "packages/tracks/src/{gpx,kml,xml,format}.ts"
  - "apps/api/src/modules/routes/**"
  - "apps/api/src/raw-body.ts"
  - "apps/api/src/upload-slots.ts"
  - "apps/api/src/parse-thread.ts"
  - "apps/api/src/modules/rides/**"
  - "apps/app/src/features/rides/**"
  - "apps/app/src/features/auth/return-path*"
  - "apps/api/src/modules/results/**"
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
- Удаление аккаунта (когда появится) в **той же транзакции** под `lockUser` отзывает все сессии пользователя:
  ротация проверяет удалённость пользователя чтением до атомарного `findOneAndUpdate`, окно гонки закрывает
  только этот инвариант (ADR-0007, R3).
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
- Защита от перебора e-mail: нейтральные ответы регистрации, повтора письма и удаления аккаунта.
- Неподтверждённый аккаунт не получает полноценных токенов (AD-28) — спорный момент с V-09, решать в task.md.
- Файлы пользователей — под непредсказуемыми ключами (`randomToken`), наружу не выдаются (ADR-0011: порт
  `TrackFileStore`, на dev — том, S3 и подписанные URL — до прода/при выдаче).
- Парсеры FIT/GPX/KML работают в worker (`worker_threads`) с лимитами по памяти и времени; формат — по сигнатуре,
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
- **Принятый риск — тот же домен `/admin/`** (C3): XSS web приложения может действовать от имени открытой в том же
  браузере сессии панели. Обязательно **до прода**: 2FA (TOTP) для `admin` и строгий CSP web приложения; CSP панели —
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

## Протокол (race-results-05)

- Права: `results.manage` (исключение, возврат, перепроверка, публикация) — admin и organizer (свои гонки через
  видимость `races`); `results.revise` (DQ, отмена DQ, пересчёт после публикации) — только admin; moderator — чтение.
  Каждый эндпоинт — `PanelGuard` + `RequirePermission`; попытка или участник другой гонки — 404.
- Тело — `strictObject` с `ActionReason` (3–500); лимит мутаций `results-panel-user` 60/ч на сотрудника.
- Причина исключения, DQ и пересчёта — только панели и append-only журналу (`panel_audit`, `race_recalculations`),
  райдеру не уходит; логи — без причины и без `userId` райдера.

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
  по сигнатуре (не GPX/KML, в т. ч. `<!DOCTYPE` до корня и FIT — `415 ROUTE_FORMAT_UNSUPPORTED`; UI панели выбирает
  `.gpx,.kml`); разбор — только worker через `runParseThread` (отказ на `<!DOCTYPE`/`<!ENTITY`, подсчёт элементов и
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
  max-age=60`; видимость — одна точка `RoutesRepository.findPublished` (не опубликованный, снятый, не готовый,
  неизвестный — один `404 NOT_FOUND`, включая карту и гонки маршрута). Ответы — явный список полей: без
  `ownerUserId`, `sha256`, статуса, `failure`, `attempts` и линии сверки (int-тест на ключи). Снятый маршрут может
  быть виден до минуты из кэша (RC-13).
- Очищенный GPX каталога (routes-03): `GET /v1/routes/:id/gpx` — только маршрут каталога (`findPublished`, иначе
  один `404 NOT_FOUND`), `PublicReadGuard` + отдельный IP-лимит `route-gpx` 30/мин (`IpRateLimitGuard` +
  `@IpRateLimit`, `consumeIpLimit` в `src/public-read.guard.ts`; 429 + `Retry-After`), `public, max-age=60`. Файл
  посчитан worker'ом (`routeGpx`: только `trkpt lat lon` и `ele` точек линии сверки — без `time`, датчиков,
  `name`/`desc`, `metadata`, `extensions` исходника); API GPX не разбирает. Заголовки файла — только у 200:
  `application/gpx+xml; charset=utf-8`, `Content-Disposition: attachment` с ASCII-fallback и `filename*` RFC 5987
  (`gpxFileName`: без `\p{Cc}`/`\p{Cf}` — bidi-подмена расширения, без `\/:*?"<>|`, ≤ 80 кодовых точек),
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
  (`detectRouteFormat`: GPX/KML, `<!DOCTYPE` до корня → 415); квота 100 своих маршрутов — `409 ROUTE_QUOTA_EXCEEDED`
  (мягкая, после дедупа). KML — те же защиты, что GPX (`xml.ts`: отказ на `<!DOCTYPE`/`<!ENTITY`, подсчёт элементов и
  `gx:coord` до дерева, `XMLValidator`, обрыв кортежей `coordinates`), разбор — только `runParseThread` в worker.
- Наружу — `MyRoute` явным списком полей (без `origin`, `ownerUserId`, `sha256`, `attempts`, `catalog`, линии сверки);
  карта — только линия показа своего готового маршрута. Логи — `routeId`, `userId`, коды; без названий, имён файлов и
  координат. Действия райдера не пишутся в журнал панели (`PanelAudit`).

## Приём тела загрузок (upload-limits-kml-panel)

- Заезды (`/v1/tracks/uploads`) и «мои маршруты» (`/v1/routes/mine`): слот приёма `src/upload-slots.ts` — не больше
  4 приёмов на процесс API и **1 на пользователя** (второй одновременный — `429 RATE_LIMITED`, `retryAfterSec: 5`, до
  чтения тела); слот освобождается в `finally` обработчика при любом исходе (успех, 4xx, таймаут, обрыв). Слоты — в
  памяти процесса (Redis-слоты между процессами — нет).
- `readLimited` (все три загрузки, включая панель): тишина между порциями тела дольше 30 с или всё тело дольше 180 с —
  `408 VALIDATION_FAILED` `{ fields: [{ path: 'body', code: 'INVALID' }] }`; остаток тела сливается без хранения,
  ответ — `Connection: close`. Таймауты — `DEFAULT_BODY_TIMEOUTS` (`raw-body.ts`), в политиках модулей —
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
- Возврат гостя после входа — только путь из allowlist `^/(rides|races|calendar)/<uuid>$`
  (`features/auth/return-path-allowlist.ts`), не адрес; шаринг — только собственный web-origin.
- Жалоба (05b) — `POST /v1/rides/:id/reports` под `AuthGuard`, лимит `rides-report` 20/сут по `uid`, одна на
  (райд, пользователь) — уникальный индекс; организатор — 409; скрытый чужому — 404. Логи — id райда, `uid` и код
  причины, без комментария.
- Модерация — `/v1/admin/rides*` только `PanelGuard` + `@RequirePermission('rides.moderate')` на классе (admin,
  moderator); причина действия — `ActionReason` в журнал `PanelAudit.append` в транзакции действия. Наружу — без
  `reporterUserId`, e-mail и id организатора (подпись — `organizerName`); комментарий жалобы видит только команда.
- Скрытый райд (`hidden`) — 404 всем, кроме организатора (`visibleTo` политики — первой проверкой после чтения, до
  идемпотентных веток «Я иду»/«Не иду»).
