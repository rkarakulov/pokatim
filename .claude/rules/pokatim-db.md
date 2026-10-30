---
paths:
  - "apps/api/src/db/**"
  - "**/*.collection.ts"
  - "**/*.repository.ts"
---

# pokatim — данные (дополняет `db.md`)

БД — MongoDB 8.0, replica set (ADR-0007). Общие правила драйвера, миграций и индексов — `db.md`; здесь — домен.

## Сериализация аккаунта и транзакции (R1)

- Транзакция, меняющая документы аккаунта (пользователь, ссылки, токен регистрации, сессии, согласия), **первой**
  операцией вызывает `lockUser`/`lockUserCredentials` (`$inc: { version: 1 }` документа `users`): две такие
  транзакции одного аккаунта конфликтуют, `MongoTransactions.run` повторяет проигравшую на свежем снимке. Запись в
  документы аккаунта в транзакции без `lockUser` — **HIGH** в ревью (write skew: условие по другому документу без
  записи в него MongoDB не защищает).
  Исключения (без `lockUser`, с комментарием в репозитории): **создание нового аккаунта** — документа `users` ещё нет,
  гонку одного адреса ловит уникальный индекс `users_email_unique` (конфликт записи или `11000` → `EMAIL_TAKEN`);
  транзакция, **первая операция которой — сама запись в тот же документ `users`** (`findOneAndDelete` очистки
  неподтверждённых с условиями в фильтре): она конфликтует так же, как `$inc version`.
- Вне транзакций — только атомарные операции над **одним** документом (`findOneAndUpdate`/`updateOne` с условием):
  ротация и отзыв по токену, захват отправки письма. Условие «по другому документу» — либо в транзакции под
  `lockUser`, либо принятая гонка с комментарием в репозитории (R6: лишнее письмо по мёртвой ссылке).
- Колбэк транзакции может выполниться повторно: внутри — только операции с `session`, без логов, очередей, Redis,
  HTTP; argon2 — до транзакции, лог и ответ — после `run`. Исключения (комментарий в коде о последствиях повтора):
  `takeResendAllowance` регистрации (R12) и суточная квота подачи маршрута на публикацию (`MyRoutePublicationService.
  submit`, routes-06: квота после записи — повтор колбэка может списать её дважды, принято). Новых — не добавлять без
  записи здесь.

## Документы

- Поля — camelCase, `_id` — строка UUID v7 (`uuidv7()` базы до вставки), время — `Date` из `CLOCK`. Nullable-поля
  пишутся явным `null`: фильтр `{ x: null }` и частичный индекс `{ x: { $eq: null } }` совпадают; чтение терпит
  отсутствие поля (`?? null`).
- Интерфейсы документов и имена коллекций — `modules/<context>/*.collection.ts`; единственный писатель коллекций
  модуля — его репозиторий. CHECK и FK нет: допустимые значения держат типы и int-тесты (R5), `$jsonSchema` не
  используем (второй источник схемы).
- Каскад удаления — явный, в той же транзакции (очистка неподтверждённых удаляет согласия, ссылки, токен
  регистрации и сессии аккаунта).
- Pipeline-обновление (`[{ $set: … }]`): значения — только через `{ $literal: … }` — строка, начинающаяся с `$`, в
  pipeline — путь поля.
- Удаление аккаунта (ADR-0015) — не каскад результатов: заявки, попытки, протоколы и споры остаются с псевдонимным
  `userId`, строка таблиц — «Участник» (A3: документ `profiles` удаляется). Данные модулей стирают **порты стирания**
  модулей-владельцев из worker `account` (см. «Удаление аккаунта» ниже).
- Персональные и биометрические данные (пульс, мощность, FTP, вес) — в отдельных полях/коллекциях, чтобы их было
  просто анонимизировать и не выдавать лишнего.
- Append-only на уровне данных: аудит, история споров (`dispute_events`), пересчёты, модерация — без update/delete
  в коде. `disputes` — проекция состояния, переходы только из `open` (см. «Споры»).
- Профиль райдера — `profiles` модуля `profile` (`_id` = id пользователя, ПДн отдельно от `users`): опрос и шаг
  устройств — одна атомарная операция над одним документом вне транзакции (`updateOne … upsert`); `PATCH
  /v1/profile` (profile-02) — транзакция: чтение прежнего флага и запись **того же** документа, затем событие
  согласия — параллельный `PATCH` конфликтует по документу и повторяется на свежем снимке; без `lockUser` (документы
  аккаунта не меняются); гонка первых upsert — `isDuplicateKey(error, '_id_')` и один повтор всей транзакции.
  Удаление аккаунта — `ProfileErasure.erase` (`deleteOne` `profiles`, идемпотентно; поздний `PUT`/`PATCH`, прошедший
  `AuthGuard` до отзыва сессий, может его воскресить — убирает повторный проход очистки).
- `profiles.themeId?` (user-theme, ADR-0021) — личная тема из закрытого списка `APP_THEME_IDS`; нет поля / `null` —
  `classic`. Без миграции и индекса; пишет только `PUT /v1/profile/theme` (`ProfileRepository.setTheme` — pipeline-upsert
  с `KEEP_PROFILE_FIELDS`, вне транзакции, гонка первых upsert — один повтор на `_id_`); другие upsert'ы профиля поле не
  трогают. Не ПДн, стирается вместе с документом.
- Профиль хранит публичное имя и согласие на его показ (`publicName`, `showNameInResults`; profile-rider-name,
  `docs/product/profile.md`): поля необязательные, чтение `?? null` / `?? false`, миграции нет. Удаление документа
  анонимизирует строки таблиц результатов. Снимок протокола (`race_protocol_rows`) имени не хранит: таблица читает
  его из профиля при каждом запросе через порт `RIDER_NAMES`, согласие — в фильтре запроса.
- Журнал согласий `profile_consent_events` (profile-02, миграция `0019_profile_consents`, индекс `{ userId, at }`) —
  append-only: только `insertOne` в `ProfileRepository` (сторож `profile.repository.test.ts`), событие — только при
  фактической смене `showNameInResults`, в транзакции `PATCH`; версия текста и время — сервер; имени нет. **Удаление
  аккаунта журнал не удаляет** (доказательство согласия, только псевдонимный `userId`; правомерность — проверить
  юристом до прода, `docs/product/profile.md`).
- Сброс имени модератором (profile-02) — транзакция: **первой** — условная запись профиля (`publicName` — строка),
  затем `PanelAudit.append` без имени; имени нет — без записи. Согласие и журнал согласий не трогаются.
- Профиль райдера (rider-profile, миграция `0033_rider_profile`): `profiles.club` (2–60 после zod), `avatarId` (`_id`
  аватара), `publicId` (`randomToken`) — необязательные, чтение `?? null`. `publicId` создаётся **один раз** вторым
  этапом pipeline `updatePublicName` (`$ifNull` + «имя — строка и согласие»; кандидат-токен — сервис до транзакции) и
  не меняется (отзыв согласия и сброс имени его не трогают); наружу — только при имени и согласии. Индекс
  `profiles_public_id_unique` — `unique` + `partialFilterExpression: { publicId: { $type: 'string' } }` (не `sparse`:
  `null` в индекс не попадает). Бэкфилл миграции — профили с именем и согласием.
- Аватары — `profile_avatars` (ADR-0019): `{ _id: randomToken, userId, bytes: Binary JPEG 512×512, contentType,
  width, height, bytesLength, createdAt }`, индекс `profile_avatars_user_idx` `{ userId }`; единственный писатель —
  `ProfileAvatarRepository` (сторож `profile.repository.test.ts`). Замена — транзакция: чтение профиля → вставка →
  `setAvatar` (upsert) → удаление прежнего (один документ на пользователя); удаление — `clearAvatar` (`returnDocument:
  'before'`) → удаление прежнего. Стирание аккаунта — `deleteAllOf(userId)` до документа профиля.
- Жалобы на профиль (profile-moderation, миграция `0034_profile_reports`) — `profile_reports`: `{ _id: uuidv7,
  targetUserId, reporterUserId, reason, comment, createdAt, resolvedAt, resolution: 'actioned' | 'dismissed' | null,
  resolvedBy }` (`resolved*` — явный `null`). Единственный писатель — `ProfileReportsRepository` (сторож
  `profile-reports.repository.test.ts`): `insertOne`; переход — только закрытие открытых `updateMany({ targetUserId,
  resolvedAt: null })`; единственное удаление — `deleteForTarget` (жалобы **на** удалённого, `ProfileErasure` первым
  шагом); жалобы удалённого жалобщика остаются. Индексы: `profile_reports_open_unique` `{ targetUserId, reporterUserId }`
  — `unique` + `partialFilterExpression: { resolvedAt: { $eq: null } }` (одна открытая; закрытая выходит из индекса —
  повторная жалоба вставляется; запрос «есть открытая» обязан содержать `resolvedAt: null`), `profile_reports_target_idx`
  `{ targetUserId, _id: -1 }` (карточка, закрытие, `topReasons`, стирание).
- `profiles.{openReportCount, reportRevision, lastReportAt}` (profile-moderation) — необязательные (`?? 0` / `?? null`),
  без бэкфилла, наружу (`ProfileView`, публичный профиль) не выходят, pipeline-upsert'ы их не трогают. Очередь панели —
  частичный индекс `profiles_report_queue_idx` `{ lastReportAt: -1, _id: -1 }` по `openReportCount: { $gt: 0 }`: запрос
  обязан содержать условие и `hint`. **Порядок записи — профиль первым:** жалоба (`recordReport`: `$inc
  openReportCount, reportRevision`, `$max lastReportAt`, фильтр публичности и «не свой», `updatedAt` не трогается) →
  вставка жалобы; сбросы фото/клуба/имени — условная запись профиля (`openReportCount: 0`) → побочное → `closeOpen` →
  журнал; «Отклонить» — `clearReports` по `reportRevision` и `openReportCount > 0` (без `updatedAt`) → `closeOpen` →
  журнал. Параллельные транзакции конфликтуют по документу профиля — `openReportCount` = числу открытых жалоб.
- Перевыпуск id фото (profile-moderation, RC-A2 (b), ADR-0019 п. 6) — в транзакции `PATCH /v1/profile` и сброса
  имени, после записи профиля, при переходе «публичен → нет» (флаг до/после из той же транзакции): копия документа
  `profile_avatars` под новым `randomToken` (выдан до транзакции) → `replaceAvatarId` (условие — прежний id) →
  удаление старого.

## Геометрия (R11, Q3)

- В MongoDB — GeoJSON (`Point`, `LineString`, `Polygon`, `Multi*`, WGS84) с индексом `2dsphere` (создаётся миграцией):
  «рядом», bbox, `$geoWithin`, `$geoIntersects`, `$near`/`$geoNear`. Хранится упрощённая геометрия маршрута и точки
  старта; сырые точки трека — исходник в хранилище (`TrackFileStore`: том на dev, S3 — до прода, ADR-0011).
- Буфера, расстояния точка↔линия, длины, упрощения, привязки к маршруту, кластеризации и починки геометрий в
  MongoDB нет — это чистые функции `packages/tracks` в worker (тесты на фикстурах). `2dsphere` отвергает невалидную
  геометрию при вставке — валидировать до записи.
- Сверка с коридором — `matchCorridor` (`@pokatim/tracks/parse`), только worker; в БД — её итог и версия
  алгоритма (`engineVersion`) в попытке, не точки и не индекс маршрута.

## Треки и устройства (ADR-0011)

- `track_uploads`, `activities`, `activity_tracks`, `activity_meta` — единственный писатель `TracksRepository`.
  Транзакция, вставляющая или удаляющая активность, **первой** операцией вызывает `lockUserActivities`
  (`$inc version` документа `activity_meta._id = userId`): «в группе дублей одна основная» — условие по другим
  документам. Без замка — **HIGH** в ревью (отрицательное доказательство — `track-uploads.int.test.ts`).
- Уникальности дедупа: `(userId, sha256)` — тот же файл, `(source, sourceRef)` — тот же объект провайдера,
  `device_imports (provider, aggWorkoutId)` — та же тренировка агрегатора; удалённая загрузка провайдера оставляет
  надгробие `device_imports.status = 'deleted'` (следующий pull её не вернёт) и маркер `track_source_refs`
  (`deleted`) в транзакции удаления — приём того же `(source, sourceRef)` пишет тот же документ (`live`) и получает
  `TrackSourceDeletedError`.
- Биометрия не хранится: ряды пульса/мощности — только в исходнике, в `activities` — флаги `hasHeartRate`/`hasPower`
  (приоритет дублей), наружу не выходят. Исходник — `TrackFileStore` (ключ `randomToken`), не GridFS.
- `device_audit` — append-only (только `insertOne`, тест-сторож), без идентификаторов агрегатора.
- **Удаление аккаунта** — `DeviceErasure.erase` (до шага треков): каждое живое подключение под замком pull →
  `disconnecting` + журнал `disconnected` (`account_deleted`) → отзыв в OW (общий `DeviceRevocation`; `not_found` —
  успех) → `revoked` (`revokedReason: 'account_deleted'`, неудача — `revokeFailed` + `revoke_failed`); затем
  `deleteMany({ userId })` тикетов, импортов, подключений и `device_accounts` (индексы `userId` — миграция 0023),
  `device_audit` хранится (A9). Затем `TrackErasure.erase`: все загрузки тем же каскадом, что удаление владельцем
  (`TrackUploadsService.remove`: активность, линия, файл, outbox `activity-removed`), затем `track_source_refs` и
  `activity_meta` пользователя. Пользователя OW удаляет владелец вручную (runbook `account-deletion.md`).

## Панель «Протокол» (ADR-0009)

- `panel_members` — `_id` = id пользователя (роль — данные `panel`, не поле `users`); единственный писатель —
  `PanelRepository`. Транзакция, меняющая члена команды, первой операцией вызывает `lockMember` (`$inc version`); если
  меняется набор активных администраторов — ещё раньше `lockAdmins` (`$inc version` документа `panel_meta.admins`):
  «последний админ» — условие по другим документам, без общего документа-замка — write skew. Документы identity в
  транзакциях панели не пишутся.
- `panel_audit` — append-only: только `insertOne` через `PanelAudit.append(tx, …)` в транзакции действия (тест-сторож
  `panel.repository.test.ts`); без e-mail, IP, UA. Роль MongoDB без `update`/`remove` — follow-up.
- `panel_sessions` — токен только sha256; истечение проверяет сервер по `CLOCK`, TTL-индекс — уборка.
- 2FA панели (ADR-0024, `0040_panel_totp`): `panel_totp` (`_id` = userId, `secretEnc`, `lastUsedStep`, HMAC кодов
  восстановления, `epoch`), `panel_sign_in_challenges` и `panel_trusted_devices` (sha256 токена unique, TTL по
  `expiresAt` + сутки; срок проверяет сервер по `CLOCK`). Писатель — `PanelRepository`; принятие шага, гашение кода (фильтр — с `epoch`)
  и вызова — условными обновлениями, попытка кода — `$inc attempts` до проверки; вход по устройству — `$inc version`
  устройства в транзакции сессии (сериализация со сбросом); вход без фактора и активация 2FA — первой операцией
  `lockMember`; каждая мутация 2FA — через `PanelTotpGuard.recheck` (замок аккаунта через порт
  `IdentityAccounts.lockAccountState` и штамп, живость сессии, `lockMember` и роль из-под замка); погашение вызова — с `expiresAt > now`; сброс 2FA — одной транзакцией с отзывом сессий.
- **Удаление аккаунта** члену команды с активной ролью запрещено (A11, `409 ACCOUNT_PANEL_MEMBER`, порт
  `PanelMembership.hasActiveRole`) — снимать нечего. Гонка «проверка ↔ выдача роли» принята (R7): гард панели
  удалённому отказывает, «Сотрудники» показывают «Удалённый участник». Журнал — `account.deleted` (actor — сам райдер,
  subject `rider`).

## Маршруты и коридор (ADR-0012 Proposed, race-results-01)

- `routes`, `route_geometries`, `route_sources` — единственный писатель `RoutesRepository`. Переход статуса — только
  из `processing` (условие в фильтре: повтор задачи после `ready`/`failed` — no-op); геометрия пишется один раз вместе
  с переходом в `ready` в одной транзакции. Готовый маршрут **не меняется** (ни линия, ни длина): правка маршрута —
  новый маршрут. Маршрут **платформы** не удаляется — поэтому чтение «маршрут готов» в транзакции гонки — без замка.
- `routes.origin`: `'platform' | 'rider'` (routes-02), неизменно. У маршрута райдера меняются `title` (`renameOwn`,
  один `findOneAndUpdate`; в `pending`/`approved` — нет, условие в фильтре), поля обработки (worker) и публикация
  (routes-06, ниже); удаляет автор — `RouteDeletion.deleteOwn` в `MongoTransactions.run`: `routes` (фильтр `{ _id,
  ownerUserId, origin: 'rider' }`) → `route_geometries` → `route_sources` → `route_exports` → жалобы
  (`RouteReportsRepository.deleteForRoute`), без журнала и outbox; конфликт с `markReady` — write conflict по документу
  `routes` → повтор.
  Удалён во время обработки — worker `skipped` (захват `null`; исходника и маршрута нет). **Порты гонок и панель —
  только `origin: 'platform'` в фильтре** (`findReady`, `findPublished`, `routesByIds`, `listVisible`); публичный каталог
  — только условие `IN_CATALOG` (платформа или `publication.status: 'approved'`, routes-06); «мои» — только методы
  `*Own` с `{ ownerUserId, origin: 'rider' }`. Запрос каталога — `hint('routes_catalog_idx')` (`origin` в фильтре делает
  кандидатом `routes_list_idx`).
- Публикация маршрута райдера (routes-06): поле `routes.publication` (`RoutePublicationDoc`: `status` `pending |
  approved | rejected | hidden | withdrawn`, город, покрытие, `showAuthorName`, `submissionCount` ≤ 3, даты,
  `rejection`, `openReportCount`/`lastReportAt`, `reportRevision` (`$inc` каждой жалобой — маркер «Отклонить жалобы»,
  `lastReportAt` — только порядок очереди), `version`); нет поля — «не подавался» (`?? null`, бэкфилла нет).
  **`catalog` маршрута райдера заполнен ⇔ `publication.status = 'approved'`** — одна запись с переходом (одобрение и
  «Вернуть» пишут, отклонение, скрытие, отзыв и снятие — снимают). Каждый переход — одна условная запись документа
  `routes` (`publicationTransition` в `routes.policy.ts`; модерация — `publication.version` в фильтре, `+1` кроме жалобы
  и «Отклонить жалобы»; переименование автором при заявке — тоже `+1`); подача — pipeline (`$mergeObjects`, значения — `$literal`, счётчики и жалобы — от прежних,
  `submissionCount < 3` в фильтре). Действия автора — без журнала; подача — транзакция «запись `routes` → суточная
  квота» (проигравшая параллельная подача квоту не тратит, 429 откатывает запись); действия модератора — транзакция:
  **первой** — запись `routes`, затем `route_reports.closeOpen`, `PanelAudit.append`, outbox. Лимит «≤ 3 на проверке» —
  `countDocuments` до записи, **принятая гонка** (8.1 RC-7, комментарий в репозитории).
- Жалобы на маршруты райдеров — `route_reports` (routes-06), единственный писатель `RouteReportsRepository`: вставка,
  закрытие открытых (`resolvedAt: null` → дата, как `ride_reports`) и **единственное удаление** — `deleteForRoute` в
  транзакции удаления маршрута (U6, 8.1 RC-5); жалобы удалённого жалобщика хранятся. Сторож —
  `route-reports.repository.test.ts`. Жалоба — транзакция, **первой** — `recordRouteReport` (`$inc openReportCount` и
  `reportRevision`, `$max lastReportAt`, условия в фильтре): гонка с «Скрыть» — write conflict (отрицательное доказательство — гонка в
  `route-reports.int.test.ts`). Миграция `0029_routes_publication` (expand-only): `route_reports_route_reporter_unique`,
  `route_reports_route_idx`; частичные индексы очередей `routes_publication_pending_idx` (`publication.status:
  'pending'`), `routes_publication_reports_idx` (`publication.openReportCount > 0`), `routes_publication_hidden_idx`
  (`publication.status: 'hidden'`) — запрос очереди содержит условие индекса и `hint`.
- Исходник GPX — в `route_sources` (BSON Binary ≤ 5 МиБ), **не** в `TrackFileStore`: уборка `tracks-maintenance`
  удаляет файлы без документа `track_uploads` и стёрла бы маршрут. Наружу исходник, sha256 и линия сверки не выходят.
- Дедуп загрузки — `routes_owner_origin_sha_unique { ownerUserId, origin, sha256 }` (`0021_routes_rider`: создаёт его и
  `routes_owner_origin_idx { ownerUserId, origin, _id: -1 }` — список и квота «моих», затем удаляет
  `routes_owner_sha_unique` — подтверждено человеком, HG-1); гонка двух одинаковых — `isDuplicateKey` → существующий. Тот же файл после `failed` или зависшей (> 15 мин) обработки — `RoutesRepository.requeue` (условие по
  статусу и `updatedAt`) + новое событие outbox в одной транзакции: сбой окружения не закрывает файл навсегда.
- `races.corridor = { routeId, widthM, distanceM } | null` — пишет только `RacesRepository`; `distanceM` — снимок
  длины маршрута, `distanceKm` гонки с коридором — из него. Документы до `0013_routes` поля не имеют — чтение
  `?? null` (миграция ставит `null`).
- Каталог (routes-01): `routes.catalog = { city, surfaces, publishedAt } | null` — изменяемые метаданные готового
  маршрута (на коридоры не влияют); пишут только `RoutesRepository.setCatalog`/`clearCatalog` (условие `status:
  'ready', origin: 'platform'` в фильтре). Повторная публикация после снятия — новый `publishedAt`, правка города и
  покрытия — прежний. Действие панели — транзакция «чтение маршрута → `updateOne` того же документа →
  `PanelAudit.append`», колбэк без логов (повторяется). Миграция `0020_routes_catalog` (expand-only): частичный
  `routes_catalog_idx { 'catalog.publishedAt': -1, _id: -1 }` (запрос каталога обязан содержать
  `'catalog.publishedAt': { $type: 'date' }`), `races_route_idx { 'corridor.routeId': 1, windowStartsAt: -1, _id: -1 }`,
  бэкфилл `catalog: null`; чтение — `?? null`. Город, покрытие, дистанция — остаточный фильтр по скану индекса без
  `SORT`.
- Производные данные маршрута (routes-03): «готовый маршрут не меняется» — про линии и длину; производные исходника
  — `route_geometries.profile` (`[distanceM, elevationM][]` ≤ 300 | `null` — нет высот), `derivedVersion`,
  `derivedFailure { version, code, at }` и коллекция `route_exports { _id: routeId, gpx: Binary, sizeBytes,
  derivedVersion }` (очищенный GPX, ≤ ~1,2 МБ) — пишут только `RoutesRepository.markReady` (разбор) и `recordDerived`
  (бэкфилл), обе — с экспортом в одной транзакции: есть `derivedVersion` ⇒ есть экспорт (`gpxAvailable` без чтения
  `route_exports`). Пересчёт — только регламент `routes-maintenance` по росту `ROUTE_DERIVED_VERSION`
  (`@pokatim/tracks/parse`); детерминированный отказ разбора — метка `derivedFailure` этой версии (не берётся до роста
  версии), сбой окружения — без метки. Документы до `0022_routes_derived` полей не имеют — чтение `?? null`, выборка
  бэкфилла — `$exists: false` или `$lt` версии по `route_geometries_derived_idx { derivedVersion: 1 }` (IXSCAN, int-тест).
  Миграция `0022_routes_derived` (expand-only): коллекция `route_exports` и индекс; данные досчитывает регламент.
- **Удаление аккаунта** — `RouteErasure.erase`: все `routes` `origin: 'rider'` автора (`ownIds`) —
  `RouteDeletion.deleteOwn` по каждому в своей транзакции (с `route_geometries`/`route_sources`/`route_exports`,
  публикацией и жалобами на маршрут); маршруты платформы и жалобы удалённого на чужие маршруты — остаются.

## Заявки и попытки (race-results-03)

- `race_entries`, `race_attempts` — единственный писатель `ResultsRepository`. Транзакция, меняющая попытки заявки,
  её запросы, лучший результат, сводку или статус, **первой** операцией вызывает `lockEntry` (`$inc version`
  заявки). Без замка — **HIGH** в ревью (отрицательное доказательство — запрос по загрузке ↔ `activity-ready`).
- Заявка — транзакция с `RaceRegistry.admitEntry` первой операцией: **настоящая запись** в документ гонки каждой
  заявкой — `lockedAt ??= now` и `entryAdmissions + 1` (pipeline `$ifNull` + `$literal`), без `version` гонки. Только
  `$ifNull` после первой заявки ничего не меняет — вторая заявка не конфликтовала бы с отменой гонки (отрицательное
  доказательство в `results-entries.int.test.ts`). `races.lockedAt`/`entryAdmissions` пишет только `RacesRepository`.
- Группу дублей в гонке представляет сильнейший (по приоритету основной) член, принятый сервером до `closesAt + 24 ч`
  (A5, `raceRepresentative`): поздний дубль не снимает прежнюю попытку, не создаёт новую и не лишает попытки
  своевременный файл при отставании приёма; снимает попытку только удаление заезда. `tracks.activity-removed` несёт
  основную оставшейся группы (и при удалении дубля) — приём пересобирает группу.
- Вердикт пишет только своя ревизия: `checkRevision` в фильтре захвата (`queued|checking`) и записи (`checking`);
  поздний повтор — no-op.
- Лучший результат и сводка — поля заявки (`best`, `summary`), пересчёт `refreshEntry` в той же транзакции (без
  изменений — без записи); места — при чтении по группе (`race_entries_ranked_idx`, race-results-07), страница и
  счётчики — в одной snapshot-сессии.
- `race_attempts.trackMap` (maps-02) — разметка трека для карты участника: `{ linePoints, segment: [from, to],
  offRuns: [from, to][] ≤ 100 }`, позиции на линии `activity_tracks` (дробные индексы, кратны 0,001), **без координат
  и времени**. Пишет `recordCheck` вместе с вердиктом; новая попытка, перепостановка и перепроверка — `null`; провал,
  `implausible`, нет сегмента или линии — `null`. Документы до maps-02 поля не имеют — чтение `?? null`, бэкфилла и
  миграции нет (разметка появится при перепроверке).

- История профиля (rider-profile): `race_entries.raceWindowStartsAt` — денормализация начала окна гонки (окно
  зафиксировано первой заявкой, V-12; пишет `EntriesService.enter`, бэкфилл — `0033`); индекс
  `race_entries_user_history_idx` `{ userId, status, raceWindowStartsAt: -1, _id: -1 }` — keyset истории своих заявок
  (`race_entries_user_idx` остаётся). Строки протокола райдера — `race_protocol_rows_user_idx` `{ userId, raceId,
  revision: -1 }` (статистика и публичная история; текущая ревизия — `currentRevisions`). Суммы заездов — агрегация
  `activities` по `activities_user_started_idx` без нового индекса (равенство с `null` индекс не покрывает).

## Уровни и группы зачёта (race-results-07)

- `race_entries.tier: 'verified' | 'start'` (до 07 — `null`, бэкфилл `0028`; чтение `?? 'verified'`), `groupKey` —
  `overall` (схема `overall`, START) или пол × возраст (Verified в `gender_age`); фиксируются заявкой (или повышением
  START → Verified `setEntryTier` под `lockEntryOf`), потом не меняются. `best.ranked` (место есть) и `best.flags`
  (флаги датчиков лучшей попытки, DV-9) пишет только `refreshEntry` по `rankRule(entry)`; чтение `?? true` / `?? []`.
- `races.groupScheme: 'overall' | 'gender_age' | null` — пишет только `RacesRepository.admitEntry` (первая заявка —
  `gender_age`; гонка с `lockedAt` без схемы — `overall`, RC-7), новые гонки — `null`.
- Места — частичный `race_entries_ranked_idx` (`tier: 'verified'`, `best.ranked: true`, ключ с `groupKey`), финишёры —
  `race_entries_finishers_idx` (`best.ranked: false`); старый `race_entries_ranking_idx` удалён `0028` (решение автора).
  Строки протокола — `groupKey`, `flags` (снимок на ревизию); ревизии до 07 без полей — `overall`/`[]`, индекс
  `race_protocol_rows_group_idx (raceId, revision, groupKey, order)`, `order` сквозной.
- Попытка: `sensors { hr, power, source } | null`, `flags` (только `HR_*`, целые проценты), `flagsVersion` — пишет
  worker с вердиктом, перепостановка сбрасывает; значений пульса и мощности нет. `source: 'declared'` — импорт
  Garmin/Wahoo (поток агрегатора без рядов, ADR-0011): каналы — признаки тренировки, `flags: []`; нет поля — `samples`. `SPEED_CLUSTER_HIGH` не хранится в попытке —
  считается при чтении панели и в ревизии протокола.
- Анкета Verified — `rider_verified_profiles` (`_id` = userId; пол, год, вес, рост, FTP, согласие с версией,
  `demographicsLockedAt`, `version`), единственный писатель `VerifiedProfileRepository` (сторож
  `profile.repository.test.ts`). Первая Verified-заявка **пишет** документ анкеты в своей транзакции (`lockForEntry`:
  `demographicsLockedAt ??= now`, `version + 1`); `PUT` райдера — одна операция с условием «не зафиксировано или те же
  пол и год» в фильтре (отрицательные доказательства — `verified-profile-locks.int.test.ts`). Панель — транзакция:
  условная запись анкеты первой, затем `PanelAudit` (имена полей без значений). Удаление аккаунта —
  `ProfileErasure` удаляет анкету.

## Протокол (race-results-05)

- Транзакции действий панели над результатами (исключение, возврат, публикация, перепроверка, DQ, отмена DQ,
  «Применить пересчёт») **первой** операцией вызывают `RaceRegistry.lockResults` (`$inc resultsVersion` документа
  гонки, без `version`/`updatedAt`; черновик — `null` → 404). Без замка — **HIGH** (отрицательное доказательство —
  исключение ↔ публикация, `results-protocol.int.test.ts`).
- `race_attempt_reviews`, `race_protocol_rows`, `race_recalculations` — только `insertOne`/`insertMany` в
  `ResultsRepository` (сторож `results.repository.test.ts`). Ревизия — новый набор строк целиком; журнал ревизий —
  `race_recalculations` (уникальный частичный `(raceId, revision)`), текущая — максимальный номер журнала, не строк.
- D-19: отмена гонки — фильтр `protocolPublishedAt: null` в переходе `cancel` (второй рубеж после конфликта записи
  с замком); `protocolPublishedAt`/`resultsVersion` пишет только `RacesRepository` (порт `RaceRegistry`).
- Порядок «запуск ↔ публикация ↔ применение» и «устаревший вердикт» — по `at`/`checkedAt` из `CLOCK`, не по `_id`
  (`uuidv7` не монотонен внутри миллисекунды).

## Рейтинг сезона (race-results-08)

- `season_standings` (заголовок снимка, `_id` = seasonId: `formulaVersion`, `sourceVersion`, `fingerprint`,
  `computedAt`, гонки и таблицы) и `season_standing_rows` (строка таблицы: `seasonId`, `bikeClass`, `groupKey`,
  `order`, `userId`, место, очки, ячейки по гонкам) — **производная проекция** протоколов, не append-only. Единственный
  писатель — `StandingsRepository`. Снимок сезона заменяется целиком одной транзакцией: **первая** операция —
  `claimSeason` (условный upsert заголовка: `formulaVersion` меньше или та же формула и `sourceVersion` меньше), затем
  `deleteMany` + `insertMany` строк. Сохранённый не старше — upsert вставляет тот же `_id` → `isDuplicateKey(_id_)` →
  `stale`, откат (RC-5; отрицательное доказательство — `standings-locks.int.test.ts`).
- `sourceVersion` = Σ текущих ревизий гонок сезона с протоколом — монотонна: набор гонок с протоколом и ревизии только
  растут (сезон, класс, окно и название гонки в фазе `final` не меняются, RC-1).
- Чтение — снимок в одной snapshot-сессии; `races`/`race_protocol_rows` из `standings` не читаются (порты
  `SeasonRaces`, `ResultsForStandings`).
- Миграция `0030_standings` (expand-only): коллекции, `season_standing_rows_order_unique` `(seasonId, bikeClass,
  groupKey, order)`, `season_standing_rows_user_idx` `(seasonId, userId)`, частичный `races_protocol_idx` `(seasonId,
  windowEndsAt, _id)` при `protocolPublishedAt: { $type: 'date' }` — запрос порта `protocolRaces` содержит ровно это
  условие (RC-4). Бэкфилла нет: первый прогон регламента строит снимки.

## Споры (race-results-06)

- `disputes`, `dispute_events` — единственный писатель `DisputesRepository` (модуль `disputes`). `dispute_events` —
  только `insertOne`, без свободного текста (описание, ответ и заметка — только в документе спора). `disputes` —
  проекция: `insertOne` и `updateOne` с фильтром `status: 'open'` (ответ — ещё `response: null`), без
  delete/replace/`updateMany`/`findOneAndUpdate`/`bulkWrite`. Сторож — `disputes.repository.test.ts`.
- Индексы (`0018_disputes`): уникальный `(raceId, complainantUserId, targetEntryId)` — один спор на пару, и после
  отзыва (E11000 → `already_filed`); `(targetEntryId, status)` — D-39; `(raceId, status, filedAt, _id)` — чек-лист,
  D-19, список по гонке; `(status, filedAt, _id)`, `(filedAt, _id)` — списки панели; история —
  `(disputeId, at, _id)`.
- Замки: подача — `RaceRegistry.lockResults` гонки, затем `ResultsForDisputes.lockEntry` цели (конфликт с
  публикацией, отменой гонки, отменой участия и попыткой цели); решение — те же замки и `disqualify` в той же
  транзакции. Отзыв и ответ — без замков результатов (атомарный переход из `open`).
- `race_entries.disqualified { at, disputeId } | null` — проекция «DQ по спору до публикации»: читается только при
  `protocolPublishedAt === null` (`rankedFilter`, статус `dq`, право подачи, `entryActions`). Протокол и
  «Применить пересчёт» берут DQ из журнала `race_recalculations` (`revision: null`, `reason: 'dispute:<id>'`), базу —
  из `protocolBaseEntries` (активные с `best`, включая DQ). После публикации поле не читается и не меняется.
- `races.disputeFilingClosedAt` — момент отсечки D-44, фиксирует `RacesService.update` при переносе плановой даты
  после наступления срока; пишет только `RacesRepository`. Срок приёма — `disputeFilingClosedAt ??
  protocolPlannedAt − 24 ч`.
- `disputes` не читает `race_entries`/`races` (только порты `ResultsForDisputes`, `RaceRegistry`); `results`/`races`
  не читают `disputes` (только гейты `ResultDisputeGate`, `RaceCancelGate`).

## Сезоны, гонки, календарь (ADR-0010)

- Транзакция, создающая или меняющая даты сезона, публикующая гонку или меняющая конец окна опубликованной гонки,
  **первой записью** вызывает `RacesRepository.lockSchedule` (`$inc version` документа `race_meta.schedule`):
  «сезоны не пересекаются» и «гонка внутри сезона» — условия по другим документам. Без замка — **HIGH** в ревью.
- Изменение сезона, гонки, записи календаря — `findOneAndUpdate({ _id, version, status })` с ожидаемой `version` из
  запроса (`$inc version`); нет совпадения — `409 CONFLICT`.
- Черновик гонки — без `seasonId` (сезон фиксируется при публикации); фаза не хранится — считается по `CLOCK`.
- Сезон хранит даты Минска (`startsOn`, `endsOn`) и границы-моменты (`startsAt`, `endsBefore`) — запросы только по
  моментам. `calendar_starts.cityKey` — город в нижнем регистре (фильтр и список городов), без регулярных выражений.
- Публичные гонки сезона (`GET /v1/seasons/:id/races`) — индекс `races_season_public_idx { seasonId, windowEndsAt,
  _id }` (`0009`, курсор без `SORT`, int-тест по `system.profile`); старый `races_season_idx` остаётся (снятие — с
  человеком).
- Пререндер OG-картинок (`og.sync`, og-images): `{ status, updatedAt, _id }` на `races`, `rides`, `routes`,
  `calendar_starts` (`0037_og_sync_indexes`, expand-only). Выборка «изменилось после» — только `changedForOg`
  репозиториев (`changed-since.ts`: keyset `(updatedAt, _id)` + сортировка); каждая запись, меняющая публичное поле,
  обязана ставить `updatedAt`.

## Кофе-райды (блок 05, ADR-0013 Proposed)

- `rides` — единственный писатель `RidesRepository`; участники — встроенный массив `participants` (≤ 100, организатор —
  первый) + `goingCount` той же операцией. **Участие — одна атомарная операция над документом райда** (`findOneAndUpdate`
  с лимитом `$expr`, статусом, временем и членством в фильтре), без замков и чтения-проверки; с ADR-0017 — в
  транзакции с outbox-событием (`MongoTransactions`), условие в фильтре по-прежнему обязательно; правка лимита — условие
  `goingCount ≤ limit` в фильтре той же операции. Убрать условие из фильтра — **HIGH** (отрицательное доказательство —
  `rides-participation.int.test.ts`).
- `version` меняют правки организатора (правка, отмена) и модерация «Скрыть»/«Вернуть» (05b); участие и «Отклонить
  жалобы» её не трогают.
- Правка — pipeline-обновление (значения — только `$literal`); `rescheduledAt` — `$cond` по `goingCount` документа в
  момент записи, а не по прочитанному заранее (первый участник мог записаться между чтением и правкой).
- Квоты будущих райдов (5) и отметок (20) — `countDocuments` до операции: условие по другим документам — принятая
  гонка (превышение на единицу), комментарий в репозитории.
- Проекции: публичное чтение без `organizerUserId`, `participants`, `version`; зритель — `participants: { $elemMatch:
  { userId } }` (проекция включающая — остальные поля перечислены явно).
- **Удаление аккаунта** — `RideErasure.erase` (пакетные `updateMany` с условиями в фильтре, повтор безопасен):
  будущие `published` свои — `cancelled` (`organizer_unavailable`) по одному райду в транзакции с событием
  `rides.ride-cancelled` (ADR-0017); скрытые будущие свои из `published` —
  `hiddenFromStatus: 'cancelled'` (статус `hidden` не меняется, F6); «Не иду» в чужих будущих `published`/`hidden`
  (`$pull` + `$inc goingCount −1`); `organizerName: null` во всех своих райдах (A6). Прошедшие чужие — без изменений;
  жалобы (`ride_reports`) хранятся (A6).
- Жалобы (05b): `ride_reports` — единственный писатель `RideReportsRepository`; **исключение из append-only
  модерации**: содержание жалобы неизменно, единственный переход — закрытие `resolvedAt: null → дата` (`updateMany`
  с `resolvedAt: null` в фильтре, `$set` только `resolvedAt/resolution/resolvedBy`), удалений нет; решения и причины —
  в append-only `panel_audit`. Сторож — `ride-reports.repository.test.ts`.
- Поля модерации райда — `hiddenAt`, `hiddenFromStatus`, `openReportCount`, `lastReportAt` (миграция
  `0017_ride_reports`, чтение терпит отсутствие). **Жалоба и действия модерации — транзакции, первой записью пишут
  документ райда** (`recordReport` / `hide` / `restore` / `clearReports` с условием в фильтре), затем `ride_reports` и
  журнал: две транзакции одного райда конфликтуют по нему, `openReportCount` = числу открытых жалоб. Убрать запись
  райда первой — **HIGH** (отрицательное доказательство — гонка в `ride-reports.int.test.ts`).
- Очереди — частичные индексы `rides_report_queue_idx` (`openReportCount > 0`, запрос обязан содержать это условие)
  и `rides_hidden_queue_idx` (`status: 'hidden'`); публичное чтение и лента — `status ∈ {published, cancelled}`.
- Маршрут и точка «Рядом» (05c, миграция `0031_rides_geo`: бэкфилл `routeId: null`, `geo` — центр города,
  `startPrecise: false`; индекс `rides_geo_feed_idx` `{ geo: '2dsphere', startsAt: 1 }`): `routeId` — только ссылка
  (название, длина, старт — порт `RideRoutes` на каждом чтении, снимка нет); `geo` пишут создание и правка
  (`rideStartOf`: маршрут виден публично — его старт и `startPrecise: true`, иначе `CITY_CENTERS[cityCode]`).
  Правка пересчитывает точку при смене маршрута или города и при прикреплённом маршруте с `startPrecise: false`
  (RC-3); перенос (`changesStart`) — и смена точной точки на другую точную (RC-4). «Рядом» — условие в `$and` ленты
  (не `$near`: курсор по времени), кандидаты только по публичным данным: `$or` [`cityCode` ∈ городов, чей центр в
  круге (без требования `geo`/`startPrecise` — документы старого API); `startPrecise: true` + `routeId` ∈
  `RideRoutes.publicStartsWithin` (маршруты каталога со стартом в круге, `$geoWithin $centerSphere` по
  `routes_start_2dsphere`, ≤ 500) + `geo` в круге]. Сохранённая `geo` райда на снятом маршруте в выбор не входит —
  курсор после пачек не оракул. Окончательная точка — `ridePointNow` сервиса (старт маршрута каталога сейчас или
  центр города). `geo`/`startPrecise` наружу не уходят
  (`PUBLIC_PROJECTION`). Стирание — `resetStartsForRoutes`: точные точки райдов любых организаторов на маршрутах
  удалённого → центр города (одна pipeline-операция, `version` не меняется, повтор — no-op); висячие `routeId`
  (маршрут удалён раньше) — `precisePage` пачками по `_id` + порт `existing`.

## Заезды по маршруту (route-rides-01)

- `route_rides` — единственный писатель `RouteRidesRepository`; миграция `0032_route_rides` (expand-only): уникальный
  `route_rides_user_route_activity_unique { userId, routeId, activityId }` (дедуп параллельного POST группы; префикс —
  список, квота и стирание). `activityId` — основная группы на момент POST, `activity` — снимок сводки,
  `corridorWidthM` — ширина на момент создания (RC-15).
- Итог пишет только своя ревизия: `claim` (`checkRevision`, `queued|checking` в фильтре), `record` (`checking` в
  фильтре), без транзакции; `requeue` — `$inc checkRevision` только из `failed` или зависшего статуса прежней ревизии
  (условие в фильтре) + outbox в транзакции. `trackMap` — позиции на линии `activity_tracks`, без координат;
  датчиков, флагов и диагностики нет.
- Сироты (RC-1, RC-8): удалённая активность и недоступный маршрут — заезды не видны (фильтр на чтении по
  `ActivitySource.liveActivities` и `RouteRideRoutes`); заезды с удалёнными активностями удаляются в транзакции
  следующего нового заезда по маршруту. Не append-only.

## Достижения (achievements, ADR-0020 Proposed)

- `achievement_grants` и `achievement_syncs` — единственный писатель `AchievementsRepository`; миграция
  `0035_achievements` (expand-only, без бэкфилла): уникальный `achievement_grants_user_code_unique { userId, code }`
  (одна выдача на код; дубль параллельной сверки — `isDuplicateKey`; префикс — список, «показано», стирание).
  `achievement_syncs { _id: userId, firstSyncAt }` — маркер первой сверки (upsert `$setOnInsert`, дубль `_id_` — не
  ошибка), пишется **после** выдач первой сверки.
- Выдача — проекция фактов, не append-only: отзыв — `revokedAt` (документ остаётся, чтобы вернувшийся факт сохранил
  `seenAt`), объект и `factAt` переписываются сверкой; `seenAt`/`grantedAt` пишут только вставка и «показано».
  Названия объектов не хранятся. Каждая запись — одна условная операция по `{ userId, code, … }` без транзакции.

## Билеты (event-tickets, ADR-0023)

- `event_ticketing` (`_id = "<kind>:<eventId>"`), `event_registrations`, `tickets` — единственный писатель
  `TicketsRepository`; миграция `0038_tickets` (expand-only): `tickets_code_unique`, `tickets_qr_hash_unique`,
  `tickets_registration_unique`, `tickets_user_idx { userId, createdAt: -1 }`, `tickets_event_idx { kind, eventId, _id }`
  (сверка и участники с курсором), частичный `event_registrations_active_unique { eventId, userId }`
  (`status: 'active'`), `event_registrations_user_idx`, `event_ticketing_enabled_idx { kind, enabled, startsAt }`
  (регламент берёт гонки со стартом позже `now − 61 сут`: окно гонки ≤ 60 суток, очный старт внутри него).
- Настройки — замена по `version` (вставка при `version: 0`, дубль `_id_` — 409); `registeredCount` пишут только
  `reserveSeat`/`releaseSeat` (без `version`) — первой операцией транзакции регистрации и отмены. Календарь:
  `startsAt/endsAt/place` в настройках — `null` (вычисляются из старта, RC-T2).
- Билет: `status` `active | checked_in | cancelled` (`event_cancelled` не хранится); переходы — условием статуса в
  фильтре (`markCheckedIn` — только из `active`); QR — только `qrHash`; `email` — захват письма (`pending → sending →
  sent | skipped | failed`). Не append-only (проекция заявок), журнал отметок — `panel_audit`.
- `calendar_starts.admissionLock` — счётчик-замок (`lockForAdmission`, без `version`): пишут транзакции регистрации,
  отмены регистрации и check-in `tickets` через порт `CALENDAR_EVENTS`; наружу не выходит.
- Удаление аккаунта — `TicketErasure`: активные регистрации → `cancelled` (с билетом и местом, транзакция на
  регистрацию), активные билеты гонок → `cancelled`; документы псевдонимные.
- Напоминания (PR D) — без миграции и новых индексов (чтение `?? []`): `event_ticketing.reminders[]`
  (`{ id, offsetHours, text, armedAt }`, пишет `PUT` настроек с `version`) и `reminderDispatches[]` (`{ reminderId,
  dueAt, dispatchId, at, count }`, пишет только регламент условным `$push` без смены `version` — захват отправки);
  `tickets.remindersSent[]` (`{ reminderId, dispatchId, at }`, `$push` с `$ne reminderId` — один раз на билет и
  правило). Шаг стирания не нужен: метки псевдонимны, как билет.
- Материалы (PR C) — `event_materials` (`file: { id, name, size } | null` — денормализация, список без байтов) и
  `event_material_files` (`_id` = `randomToken`, `bytes` — Binary ≤ 10 МиБ); писатель — `MaterialsRepository`;
  миграция `0039_event_materials`: уникальный `event_materials_event_order_unique { kind, eventId, order }`
  (одна позиция — один материал; перестановка — через временные отрицательные позиции). Лимиты 20/10 — под замком
  `event_material_locks` (`_id = "<kind>:<eventId>"`, `lockEvent` — upsert `$inc version` первой операцией
  добавления, перестановки и удаления; уникальный порядок лимиты не защищает — перестановка уплотняет позиции).
  Файлы — только чтение по `_id`. ПДн нет (`updatedBy`/`createdBy` — сотрудники) — шага стирания нет.

## Удаление аккаунта (ADR-0015, `docs/product/account.md`)

- `users`: `deletedAt` — в транзакции удаления под `lockUserCredentials` (с отзывом всех сессий `account_deleted`,
  гашением ссылок и токена регистрации). Фоновая очистка: письмо «Аккаунт удалён» (`deletionEmailClaimedAt` — захват,
  `deletionEmailSentAt` — факт), затем одной атомарной записью `email` → маркер `erased:<HMAC(EMAIL_TOKEN_SECRET,
  'deleted-email:'+email)>`, `birthDate: null`, `passwordHash: null`, `erasedAt`; повторный проход — `erasureSweptAt`.
  Поля необязательные (`?? null`); `passwordHash: null` — «учётных данных нет» (вход, порт панели — как неизвестный).
  `users_email_unique` не меняется: регистрация ищет адрес и маркер (`findUserForRegistration`, D-07).
- Порядок шагов worker (`account-deletion`): профиль → райды → «Мои маршруты» → устройства → заезды → заезды по
  маршрутам (`RouteRideErasure`, `deleteMany({ userId })`) → достижения (`AchievementErasure`: выдачи
  `deleteMany({ userId })` + маркер `deleteOne({ _id })`) → билеты (`TicketErasure`: регистрации и билеты →
  `cancelled`) → уведомления → identity. Push-токены (`push_tokens`) снимаются раньше — в транзакции удаления (`PushTokens.revokeAllOf`). Каждый
  шаг — порт модуля-владельца, идемпотентен; живой аккаунт (`deletedAt: null`) не трогается. Повторный проход через
  15 мин и регламент `account.erasure-resume` (частичный `users_erasure_pending_idx { deletedAt: 1 }`, partial
  `deletedAt: { $type: 'date' }, erasureSweptAt: { $eq: null }`).
- Миграция `0023_account_deletion` (expand-only): `device_connections_user_idx`, `device_imports_user_idx`,
  `device_link_tickets_user_idx` (`{ userId: 1 }`), `users_erasure_pending_idx`.
- Настройки платформы (app-themes): коллекция `platform_settings` — документы-синглтоны по `_id`; `appearance`
  (`decor?` — halloween-decor, нет поля — `none`, `version`, `updatedAt`; `themeId?` — legacy до user-theme, не
  читается и не пишется, новые документы его не имеют, без миграции) — единственный писатель `AppearanceRepository`,
  нет документа — без декора, `version: 0` (seed нет; первая смена — `insertOne`, дубликат `_id` → 409). Кто менял — только `panel_audit` (без
  `userId` в документе: порт стирания не нужен). Миграция `0024_platform_settings` — только `ensureCollection`.
- Append-only журналы (`user_consents`, `profile_consent_events`, `panel_audit`, `device_audit`, `dispute_events`,
  `race_recalculations`, `race_protocol_rows`) не меняются (A9); `race_entries`, споры и протоколы — остаются.
- Рейтинг сезона (race-results-08): **порт стирания не нужен** — снимок `season_standing_rows` — проекция
  `race_protocol_rows` (A9: протоколы с псевдонимным `userId` остаются), без имён, e-mail и биометрии; имя читается
  при каждом запросе через `RIDER_NAMES` — удалённый становится «Участник». Стирание снимка разошлось бы с
  протоколом, а следующий пересчёт вернул бы строки (RC-6).
- Новый модуль с данными пользователя обязан дать порт стирания и шаг в `AccountErasureService`.

## Уведомления (ADR-0017, `docs/product/notifications.md`)

- Единственный писатель — `NotificationsRepository`; миграция `0025_notifications` (expand-only): `notifications`
  (TTL 90 дней по `expireAt`; `notifications_event_user_unique { sourceEventId, userId }`, частичный
  `notifications_collapse_unique { userId, collapseKey }`, список `{ userId, createdAt: -1, _id: -1 }`, частичные
  индексы непрочитанных и сроков доставки push/e-mail), `notification_settings` (`_id` = `userId`; нет документа —
  умолчания; `push.events`/`email.events` (PR D) — без миграции, нет поля — включено; запись — `$set` по путям, не
  `replaceOne`), `push_tokens` (`token` уникален, ≤ 10 на пользователя; Web Push — `platform: 'web'`, `token` = endpoint, ключи — `webPush`, ADR-0022), `push_tickets` (TTL 24 ч; `userId` владельца —
  стирание аккаунта по нему, индекс `push_tickets_user_idx` из `0027_push_tickets_user`). Чтения сами проверяют
  `expireAt > now` (TTL — только уборка). Токены при доставке снимаются по снимку `{ _id, userId, sessionId }`, не по
  одному `_id`. Регистрация переписывает токен только сессией не старше записанной (`sessionId $lte`, uuidv7 входа):
  поздняя регистрация прежней сессии устройства после выхода — без записи (`token_stale`).
- Схлопывание (N7) — по порядковому номеру события в объекте, не по `sourceEventId` (uuidv7 внутри миллисекунды не
  упорядочен): райд — `seq` payload (`rides.noticeSeq` после записи: `+1` в `join` и `update`, нет поля — `0`, без
  миграции), маршрут — `decidedAt` события. Уведомление хранит `collapseSeq`, замена — только при `collapseSeq <`
  номера события (документ без поля и событие без номера — прежнее условие `sourceEventId $lt`); повтор задачи несёт тот же номер — без изменений, даже если объект с тех пор
  изменился. Новое схлопываемое событие райда — запись с `$inc noticeSeq` и `seq` в payload.
- Доставка — состояние в документе уведомления (`push`/`email`: захват `claimId`/`claimedUntil`, `sent`, `skipped`,
  `limited`, `failed`); захват — условием состояния в фильтре. Убрать условие — дубль push/письма (**HIGH**).
- `race_attempts.lastVisibleVerdict` (`0026_attempt_last_verdict`, бэкфилл `counted|rejected`) — прежний видимый
  вердикт: `requeueAttempt` его не сбрасывает; событие вердикта — только при смене.
