---
paths:
  - "packages/contracts/**"
  - "packages/api-client/**"
---

# pokatim — контракты (дополняет `contracts.md`)

- Структура pokatim: `src/<context>/<entity>.schema.ts` (например, `src/auth/registration.schema.ts`), публичный
  экспорт — `src/index.ts`.
- Кластеры, места, правдоподобие результата — бизнес-правила сервера: в схемах запросов их нет, клиент их
  не присылает.
- Коды ошибок pokatim добавляются в конец `defineErrorCodes` / `defineFieldErrorCodes` (`common.ts`): установленные
  приложения знают прежний состав.
- Enum-ы в **ответах приложения** (класс, покрытие, фаза, причина, дисциплина) — `tolerantEnum(values)` (`common.ts`):
  незнакомое значение — `'unknown'`, UI приложения показывает нейтральный вариант. Запросы и ответы панели — строгий
  `z.enum`. Значения справочников — только в конец. Массив кодов в ответе, где фиктивное `'unknown'` не нужно
  (ответы опроса в `ProfileView`), — неизвестные коды отбрасываются (`transform`), запрос остаётся строгим.
- Время платформы — только `src/time.ts`: `LocalDate`, `LocalTime`, `YearMonth`, `UtcMinute`, `minskWallTimeToUtc`,
  `utcToMinskWallTime`, `minskDayStartUtc`, `minskToday`, `addLocalDays`. Перевод «по месту» (`+3 ч`,
  `new Date(local)`) — нет.
- Массив фильтра в query — `queryArray(item, max)` (одна строка → массив, длина ограничена).
- Маршруты и коридор (ADR-0012 Proposed): `src/routes/route.schema.ts` — только панель, строгие `z.enum`
  (`ROUTE_STATUSES`, `ROUTE_FAILURE_CODES`), без sha256, исходника и линии сверки. `RaceInput.corridor` —
  `CorridorInput` (`strictObject`, `routeId` — `Uuid`, `widthM` 20–200 шагом 5) или `null`; `distanceKm` с коридором
  не обязательна (правило сервера). `RaceDetail.corridor` — `{ widthM } | null`, **`.optional()`** (новая сборка со
  старым API — как без коридора); `PanelRace.corridor` обязателен (панель деплоится с API).
- Карта коридора (maps-01, ADR-0014): `src/races/race-route.schema.ts` — `RaceRouteMap` (`line` `[lon, lat][]` 2–1000
  точек, `start`, `finish`, `bounds` `[west, south, east, north]`, `widthM`), `z.object` как прочие ответы; «ровно 5
  ключей» держат сервис и int-тест. Клиент — `getRaceRoute(id)`; новая сборка со старым API — 404, блок карты скрыт.
- Каталог маршрутов (routes-01): `src/routes/route-catalog.schema.ts` — `ROUTE_DISTANCE_BUCKETS` (только в конец),
  `CatalogRouteQuery` (`queryArray` города/корзины/покрытия, лишние ключи — 400), `CatalogRouteCard`/`Detail`
  (справочники — `tolerantEnum`), `CatalogRoutePage`, `CatalogRouteCities` (незнакомые коды отбрасываются),
  `RouteMapGeometry` (как `RaceRouteMap` без `widthM`; `race-route.schema.ts` не меняется — совместимость держит тест
  типов), `CatalogRouteRacesQuery`. Панель — `PublishRouteInput` (`city`, `surfaces: SurfaceList`), обязательное
  `PanelRouteSummary.catalog` (`null` | `{ city, surfaces, publishedAt }`); код `ROUTE_INVALID_STATE` (409). `PanelRoute.elevation`
  (routes-05) — `CatalogRouteElevation.nullable().default(null)` (решение A4: старый ответ без поля — `null`); собирает
  `elevationOf` API (общая с карточкой каталога).
- Мои маршруты (routes-02): `src/routes/route.schema.ts` — `ROUTE_ORIGINS` (`platform`, `rider`; только в конец),
  `ROUTE_FILE_EXTENSIONS` (`gpx`, `kml`, `kmz`, `tcx` = пакет `@pokatim/tracks`; `CatalogRouteDetail.exportFormats` —
  незнакомые коды отбрасываются, дефолт `[]`), `UploadRouteQuery` — общий для панели и
  `POST /v1/routes/mine`; `src/routes/my-route.schema.ts` — ответы приложения `MyRoute` (`status`, `failure` —
  `tolerantEnum`; без `origin`, владельца, sha256, попыток, каталога и линий), `MyRoutePage`, `MyRouteQuery`
  (`strictObject`, limit ≤ 50), `RenameRouteInput` (`RouteTitle` 3–120), `MY_ROUTE_MAX_COUNT` (100); карта —
  `RouteMapGeometry`. Код `ROUTE_QUOTA_EXCEEDED` (409) — в конце `ErrorCode`.
- Публикация маршрутов райдеров (routes-06): `src/routes/route-publication.schema.ts` — `ROUTE_PUBLICATION_STATUSES`,
  `ROUTE_REJECTION_REASONS`, `ROUTE_STATE_REASONS` (`details` у `409 ROUTE_INVALID_STATE`, `RouteStateDetails`),
  `ROUTE_PUBLICATION_LIMITS` (`409 ROUTE_PUBLICATION_LIMIT`, `RoutePublicationLimitDetails`), заявка
  `SubmitRoutePublicationInput` (`strictObject`), ответ `MyRoutePublication` (`tolerantEnum`); `MyRoute.publication`
  (`.nullable().default(null)`), `canPublish` и `submissionsExhausted` (`.default(false)`). `src/routes/route-report.schema.ts` —
  `ROUTE_REPORT_REASONS`, `CreateRouteReportRequest`, `CatalogRouteViewer`. `src/routes/route-moderation.schema.ts` —
  панель, строгие `z.enum`, без имени автора; «Отклонить жалобы» — `reportRevision` карточки (не время). Каталог: `CatalogRouteCard.author` (`{ kind: 'team' } | { kind: 'rider',
  name }`, `.default({ kind: 'team' })`), `CatalogRouteQuery.author` (`queryArray`). Право `routes.moderate`, пять
  действий журнала `route.submission_*`/`route.rider_*`, деталь `rejectionReason`, код `ROUTE_PUBLICATION_LIMIT` — в
  конце списков. api-client: `submitMyRoutePublication`, `unpublishMyRoute`, `getCatalogRouteViewer`,
  `reportCatalogRoute`, `listCatalogRoutes({ author })`; панель — `listRiderRoutes`, `getRiderRoute`,
  `approveRiderRoute`, `rejectRiderRoute`, `hideRiderRoute`, `restoreRiderRoute`, `dismissRiderRouteReports`.
- Свой трек (maps-02): `src/results/results.schema.ts` — `MyAttemptTrack` (`attemptId`, `line` — `LonLat` 2–1000,
  `segment: TrackMapRun | null`, `offRuns` ≤ 100, `marks` — `tolerantEnum(ATTEMPT_TRACK_MARKS)`: незнакомое клиент
  трактует как `unavailable`); позиции — дробные индексы вершин `{ from, to }`. Клиент — `getMyAttemptTrack`.
- Кофе-райды (ADR-0013 Proposed): `src/rides/ride.schema.ts` (запросы — `strictObject`, строгие `z.enum`; ответы —
  `tolerantEnum` фазы, роли, города и причины; города ленты — незнакомые коды отбрасываются), `src/geo/city.schema.ts`
  (`CITY_CODES` — единственный справочник городов). Справочники (`RIDE_STATUSES`, `RIDE_PHASES`,
  `RIDE_CANCEL_REASONS`, `RIDE_VIEWER_ROLES`, `CITY_CODES`) — только в конец. `version` — только в
  `RideDetailForOrganizer`.
  Маршрут и «Рядом» (05c): `RideRoute` (`id`, `title`, `distanceM`, `elevationGainM`, `access` — `tolerantEnum
  (RIDE_ROUTE_ACCESS)`), `route`/`start` в `RideSummary` (`.nullable().default(null)`); `routeId` — `Uuid.nullable()`:
  в `RideFields` с `.default(null)` (старые сборки не шлют), в `UpdateRideRequest` **только `.optional()`** (default
  под `.partial()` снял бы маршрут у правки старой сборки), в `CreateRideForm` — обязательный; `near=<lat>,<lon>` →
  `[lon, lat]` с округлением до 0,01° и `radiusKm` 5–100 (`RIDE_NEAR_RADIUS_KM`, без `near` — 400) в `RideListQuery` и
  `RideMapQuery`; `RideMap` (`items` ≤ `RIDE_MAP_MAX_POINTS`, `withoutStart` `.default(0)`); `CITY_CENTERS`
  (`geo/city.schema.ts`, `Record<CityCode, [lon, lat]>`); код поля `RIDE_ROUTE_UNAVAILABLE` — в конце
  `FieldErrorCode` (`RIDE_ROUTE_FIELD_ERROR_CODES`). api-client — `listRides({ near, radiusKm })`, `listRideMap`.
- Участие и результаты (race-results-03): `src/results/results.schema.ts` — ответы приложения и публичная таблица,
  `tolerantEnum`; `ATTEMPT_REJECTIONS` = коды движка (`CORRIDOR_REJECTIONS`) + `implausible`, совпадение держит
  сторож в `apps/api`; публичная строка — `entryId`, место, ничья, время сегмента (без `userId`, активности, времени
  суток, координат) и `riderName` — только при согласии райдера (profile-rider-name), `.nullable().default(null)`.
  `riderNo` строки таблицы и финишёров (name-consent-prompt, N7) — номер заявки в гонке, `int().positive()
  .nullable().default(null)`, не `null` только без имени.
  `ProfileView.publicName` / `showNameInResults` — новые поля ответа с `.default` (`null` / `false`): новая сборка со
  старым API разбирает ответ. `src/results/results-admin.schema.ts` — панель, строгие `z.enum`;
  `PanelStandingRow.riderName` / `PanelRaceAttempt.riderName` — обязательные `nullable` (панель деплоится с API).
- Уровни и группы (race-results-07): `ENTRY_TIERS`, `GROUP_SCHEMES`, `RIDER_GENDERS`, `RESULT_GROUP_KEYS` (пол ×
  возраст), `ATTEMPT_FLAG_CODES`, `RESULT_UNRANKED_REASONS`, `RACE_RESULT_STATUSES` + `finisher`,
  `DISPUTE_FILE_BLOCKS` + `not_ranked` — только в конец. Запрос заявки `RaceEntryRequest` (`strictObject` `{ tier?,
  groupKey? }`, пусто — допустимо); ответы приложения — `.default` для старого сервера: `MyRaceEntry.groupScheme`,
  `entry.tier/groupKey`, `result.unranked`, `verified { profileReady, ownGroup, groupOptions }`, `actions.canUpgrade`;
  `RaceResultsPage.groups`/`finishers`; `RaceFinishersPage`. **`group` в запросе таблицы клиент шлёт, только если
  прошлый ответ дал непустой `groups`** (RC-11: старый сервер ответит 400). Анкета —
  `src/profile/verified-profile.schema.ts` (`UpdateVerifiedProfileRequest`, `VerifiedProfileView`,
  `VERIFIED_PROFILE_CONSENT_VERSION` — версия текста `profile.verified.consent`, поднимать при смене), панель —
  `PanelVerifiedDemographics`, `UpdateVerifiedDemographicsRequest`, `VerifiedDemographicsResult`; флаги панели —
  `PanelAttemptFlag`, `AttemptSensors`, `PanelRaceStandingsQuery`. Коды `VERIFIED_PROFILE_REQUIRED`,
  `RACE_TIER_LOCKED` (409), `RESULT_GROUP_NOT_ALLOWED` (422), `VERIFIED_DEMOGRAPHICS_LOCKED` (409); право
  `profiles.verified_edit`, действие `profile.verified_demographics_changed`. api-client — `enterRace(token, raceId,
  body)`, `getRaceResults(raceId, { group })`, `getRaceFinishers`, `getVerifiedProfile`/`updateVerifiedProfile`;
  панель — `getRaceStandings(raceId, params)`, `getVerifiedDemographics`/`updateVerifiedDemographics` (`PATCH`).
- Рейтинг сезона (race-results-08): `src/standings/standings.schema.ts` — `STANDING_OUTCOMES`, `STANDINGS_SYNC_STATES`
  (только в конец), `STANDINGS_PAGE_SIZE`/`MAX`; ответы приложения `SeasonStandingsSummary`, `SeasonStandingsTable`,
  `MySeasonStandings` — `tolerantEnum` класса, группы и итога, без `userId`; запрос `SeasonStandingsTableQuery`
  (`strictObject`: `bikeClass`, `group` обязательны, `limit`, `cursor` — курсор по `order` строки); панель
  `PanelSeasonStandingsSummary` (`formulaVersion`, `sync`) и `PanelSeasonStandingsTable` (`userId` nullable) — строгие.
  Имена `PanelRaceStandings*` заняты «Участниками» гонки (07). api-client — `getSeasonStandings`,
  `getSeasonStandingsTable`, `getMySeasonStandings(token, id)`; панель — `getSeasonStandings`,
  `getSeasonStandingsTable`.
- Профиль райдера (rider-profile): `src/profile/profile.schema.ts` — `RiderClub` (2–60, общий конструктор
  `riderLine` с `RiderPublicName`), `ProfileView.club`/`avatar`/`publicId` (`.nullable().default(null)`),
  `UpdateProfileRequest.club`; `src/profile/rider-avatar.schema.ts` — пределы `AVATAR_*`, `AvatarId`/`RiderPublicId`
  (43 символа base64url), `AvatarCropQuery` (`{}` или все три доли `x, y, size`); `src/profile/rider-profile.schema.ts`
  — `RiderHistoryQuery` (limit 1–20, по умолчанию 10), `RiderStats`, `RiderRaceHistoryPage`, `RiderRideHistoryPage`
  (`RIDER_RIDE_ROLES`), `PublicRiderProfile` (без `userId`, км, набора), `PublicRiderRacePage`; статусы, группы и
  роли в ответах — `tolerantEnum`. Коды `AVATAR_FORMAT_UNSUPPORTED` (415), `AVATAR_TOO_LARGE` (413),
  `AVATAR_INVALID` (422) — в конце `ErrorCode`. api-client — `uploadAvatar(token, body, crop?)`,
  `avatarUploadRequest`, `deleteAvatar`, `avatarUrl`, `getProfileStats`, `listProfileRaces`, `listProfileRides`,
  `getRider`, `listRiderRaces`.
- Модерация профиля (profile-moderation): `src/profile/profile-report.schema.ts` — `PROFILE_REPORT_REASONS` (только в
  конец; подписи `domain.profileReportReason.*`), `CreateProfileReportRequest` (`strictObject`, комментарий —
  `optionalText(500, MULTI_LINE)`), `RiderProfileViewer` (`z.object`, будущие поля — `.default`),
  `PROFILE_STATE_REASONS` / `ProfileStateDetails` (`tolerantEnum`, `details` у `409 PROFILE_INVALID_STATE`:
  `own_profile` (RC-P1) и `avatar_blocked` с `until` — `z.iso.datetime().nullable().default(null)`, у прочих `null`;
  новые причины — только в конец); `src/profile/profile-moderation.schema.ts` — панель, строгие `z.enum`: очередь
  (`RiderProfileModerationQuery` limit ≤ 50, `reason?: ProfileReportReason` — одна причина; строка с `name` по Q2 и
  `openReasons` `.default([])`), карточка (жалобы ≤ 100 без автора, `reportRevision`, `avatarUploadBlockedUntil`,
  `avatarResetCount` — с `.default`), `RiderProfileResetRequest`/`RiderProfileResetResult` — алиасы схем сброса имени (не копии),
  `DismissRiderProfileReportsRequest` (`reportRevision`; устаревшая — базовый `409 CONFLICT`),
  `RiderProfileReportsDismissResult`, `UnblockRiderAvatarRequest` (алиас) / `RiderAvatarUnblockResult`. Код
  `PROFILE_INVALID_STATE` и действия журнала `profile.avatar_reset`, `profile.club_reset`, `profile.reports_dismissed`,
  `profile.avatar_unblocked` — в конце списков; `AuditEntry.details.avatarBlockedUntil` — необязательная дата ISO.
  `ProfileView.avatarUploadBlockedUntil` — `.nullable().default(null)`. api-client: `getRiderViewer`, `reportRider`;
  панель — `listRiderProfiles({ reason })`, `getRiderProfile`, `resetRiderAvatar`, `resetRiderClub`,
  `dismissRiderProfileReports`, `unblockRiderAvatar`, `riderAvatarUrl`.
- Согласие на показ имени (profile-02): `PUBLIC_NAME_CONSENT_VERSION` (`src/profile/profile.schema.ts`) — версия
  текста `profile.show.label` + `profile.show.hint` (i18n). Сменили формулировку — **подняли версию** (дата), иначе
  журнал согласий ссылается на чужой текст. Версию в событие пишет сервер. Шит согласия приложения (name-consent-prompt) показывает те же ключи —
  одна версия на оба места. `riderLine` запрещает и заглушку «Райдер», «Райдер #N», «Райдер №N» (N8). Сброс имени —
  `src/profile/profile-admin.schema.ts` (`ResetRiderNameRequest` с `ActionReason`, `RiderNameResetResult`).
- Треки и устройства (ADR-0011): `src/tracks/track-upload.schema.ts`, `src/devices/device.schema.ts` — статусы,
  причины, источники, провайдеры, проблемы подключения в ответах — `tolerantEnum`; путь `:provider` и запросы —
  строгие; формат `stream` — только сервер. Ответы без идентификаторов агрегатора, ключей хранилища, координат и
  биометрии.
- Тема приложения (app-themes): `src/appearance/appearance.schema.ts` — `APP_THEME_IDS` — единственный источник id
  тем для API и панели (только в конец; порядок = порядок карточек панели); реестр `appThemes` в
  `@pokatim/design-tokens` объявляет тот же состав и порядок, от контрактов не зависит (сторож равенства — в D2).
  `DEFAULT_APP_THEME_ID`, ответ приложения `AppAppearance` (`themeId` — `tolerantEnum`, устарел: сервер всегда отдаёт
  `classic` для сборок до user-theme, удаление — только новой версией эндпоинта; `decor` — `tolerantEnum`), панели
  `PanelAppearance` (только `decor`, `version`, `updatedAt` nullable), запрос `UpdateAppearanceRequest`
  (`strictObject({ decor, version })`, `themeId` — ошибка). Право `appearance.manage`, действия журнала
  `appearance.decor_changed` и (история) `appearance.theme_changed`, вид объекта `platform`. api-client —
  `getAppearance` (публичный и панели), `updateAppearance` (`PUT`).
- Личная тема (user-theme, ADR-0021): `ProfileView.themeId` — `tolerantEnum(APP_THEME_IDS).default('classic')` (старый
  сервер без поля — «Классика»), запрос `UpdateProfileThemeRequest` (`strictObject({ themeId: AppThemeId })`);
  api-client — `setProfileTheme` (`PUT /v1/profile/theme`, ответ `ProfileView`).
- Удаление аккаунта (ADR-0015): `src/account/account-deletion.schema.ts` — `DeleteAccountRequest` (`strictObject`,
  `password: SignInPassword`), ответ `204`. Коды — `PASSWORD_INCORRECT` (403, не 401: клиент не уходит в refresh) и
  `ACCOUNT_PANEL_MEMBER` (409) в конце `ErrorCode`; `AUDIT_ACTIONS` + `account.deleted` (admin i18n
  `admin.audit.action.account.deleted`). api-client — `deleteAccount(accessToken, body)`.
- Уведомления (ADR-0017): `src/notifications/notification.schema.ts` — `kind`/`group` в ответах — `tolerantEnum`,
  цель — белый список (`NotificationTarget`; `profile-edit` без id — свой профиль), незнакомая в ответе —
  `{ type: 'unknown' }`; новые `kind` и цели — только в конец; запросы (`NotificationSettings`
  с `startHour ≠ endHour`, `RegisterPushToken`, `RevokePushToken`, `NotificationListQuery`) — `strictObject`. api-client —
  8 методов `/v1/notifications*`. PR D event-tickets — в конец списков: группа `events`, kind `event_reminder`, цель
  `{ type: 'ticket', code: TicketCodeCanonical }`; группа «Мероприятия» — отдельные схемы подресурса
  `EventNotificationSettingsView` / `UpdateEventNotificationSettings` (`strictObject`), `DEFAULT_EVENT_NOTIFICATION_SETTINGS`
  — `NotificationSettings` не расширяется (строгий разбор ответа у старых сборок, RC-D1); api-client —
  `getEventNotificationSettings`, `updateEventNotificationSettings`. Группа `routes` — в конце `NOTIFICATION_GROUPS`
  (старые сборки — `unknown`); подресурс «Маршруты» — `RouteNotificationSettingsView` (`{ push }`, терпит ключи),
  `UpdateRouteNotificationSettings` (`strictObject({ push })`), `DEFAULT_ROUTE_NOTIFICATION_SETTINGS`; api-client —
  `getRouteNotificationSettings`, `updateRouteNotificationSettings`. achievements-push — в конец: группа
  `achievements`, kind `achievement_granted`, цель `{ type: 'achievement', code: AchievementCode, seasonId?: Uuid }`
  (строгий код — незнакомый у старой сборки → `unknown`); подресурс «Достижения» —
  `AchievementNotificationSettingsView`, `UpdateAchievementNotificationSettings`,
  `DEFAULT_ACHIEVEMENT_NOTIFICATION_SETTINGS` (`{ push: true }`); api-client — `getAchievementNotificationSettings`,
  `updateAchievementNotificationSettings`. social-p1 — в конец: группа `social`, шесть видов `social_riders_going`,
  `social_thanks`, `social_added`, `social_respect`, `social_invite_registered`, `social_ride_ask`, цель
  `{ type: 'rider', publicId: RiderPublicId }` (битый токен у старой сборки → `unknown`); подресурс «Свои» —
  `SocialNotificationSettingsView`, `UpdateSocialNotificationSettings`, `DEFAULT_SOCIAL_NOTIFICATION_SETTINGS`
  (`{ push: true }`); api-client — `getSocialNotificationSettings`, `updateSocialNotificationSettings`.
- Web Push (ADR-0022): там же — `WebPushEndpoint` (https ≤ 2048, хост — push-сервис из белого списка
  `isWebPushEndpoint`: FCM, Mozilla, WNS, Apple; адрес вызывает сервер — SSRF), `RegisterWebPushSubscription`
  (`strictObject`: endpoint + `keys.p256dh` 65 байт `B…`/`keys.auth` 16 байт base64url, без `expirationTime`),
  `RevokeWebPushSubscription`, ответ `WebPushConfig` (`publicKey` или `null`). `PUSH_PLATFORMS` не меняется (Expo).
  api-client — `getWebPushConfig`, `registerWebPushSubscription`, `revokeWebPushSubscription`.
- Карточка для сторис (story-cards, ADR-0018): `src/sharing/story-card.schema.ts` — `STORY_CARD_TEMPLATES`
  (`line | night`, только в конец), запрос `StoryCardQuery` (`strictObject`; гонка, райд, маршрут — не расширять),
  `AchievementStoryCardQuery` (`template` + `seasonId?: Uuid`, `strictObject`; сверка с кодом — сервер), ответ `StoryCardStatus` —
  `discriminatedUnion` `pending | ready (token) | failed` (незнакомый статус — ошибка разбора), `StoryCardToken`
  (22 символа base64url). `MyRaceEntry.actions.canShareStory` — `.default(false)` (старый сервер — кнопки нет). Код
  `STORY_CARD_UNAVAILABLE` (409) в конце `ErrorCode`. api-client — `getStoryCard`, `getAchievementCard(token, code, AchievementStoryCardQuery)`,
  `storyCardImageUrl(token)` (адрес
  без запроса: сервер свой публичный origin не знает).
- Заезд по маршруту (route-rides-01): `src/route-rides/route-ride.schema.ts` — `ROUTE_RIDE_STATUSES` (только в конец),
  `ROUTE_RIDE_MAX_PER_ROUTE` (100), `ROUTE_RIDE_CANDIDATES_MAX` (30); запрос `RouteRideRequest` (ровно одно поле
  `activityId | uploadId`, `strictObject`); ответы `RouteRidePage`, `RouteRideCandidates`, `RouteRideDetail`,
  `RouteRideTrack` — `tolerantEnum`, причины и провалы — `ATTEMPT_REJECTIONS`/`ATTEMPT_FAILURES`, разметка —
  `TrackMapRun`/`ATTEMPT_TRACK_MARKS` (импорт, не копии); дельты — знаковые целые. Коды `ROUTE_RIDE_NOT_READY`,
  `ROUTE_RIDE_UPLOAD_FAILED`, `ROUTE_RIDE_QUOTA_EXCEEDED` (409) — в конце `ErrorCode`. api-client — `listRouteRides`,
  `listRouteRideCandidates`, `checkRouteRide`, `getRouteRide`, `getRouteRideTrack` (явный access-токен).
  route-rides-03: `ROUTE_RIDE_ORIGINS` (`manual | auto`, только в конец); в `RouteRideDetail` аддитивно
  `activityId: Uuid.nullable().default(null)` и `origin: tolerantEnum(ROUTE_RIDE_ORIGINS).default('manual')` — новая
  сборка со старым API получает `null`/`manual`; `RouteRideRow` без `origin`.
  route-rides-04 (таблица «Другие»): `ROUTE_RIDE_LEADERBOARD_DEFAULT`/`MAX` (10/100), запрос
  `RouteRideLeaderboardQuery` (`strictObject`, `limit` — `coerce`, без курсора), ответ `RouteRideLeaderboard` (`rows`
  ≤ 100, `total`, `me` — `RouteRideLeaderboardMe` или `null`, `shared`); строка `RouteRideLeaderboardRow` — `place`,
  `elapsedSec`, `rideDate: LocalDate` (без времени суток), `riderName` + `...RiderRowLink` и `rideId` —
  `.nullable().default(null)`. Профиль: `ROUTE_RIDES_CONSENT_VERSION` (версия текста согласия — поднимать при смене),
  `ProfileView.showRouteRides` (`.default(false)`), `UpdateProfileRequest.showRouteRides` (`optional`, в условии
  `REQUIRED`; старый API — 400, поэтому приложение — после выката API). api-client — `getRouteRideLeaderboard(token,
  routeId, { limit })`.
- Достижения (achievements, ADR-0020): `src/achievements/achievement.schema.ts` — `ACHIEVEMENT_CODES` (каталог, **только в
  конец**), `ACHIEVEMENT_OBJECT_KINDS` (`race | route | ride | season`), запрос `AchievementCode` (строгий `z.enum`) и
  `MarkAchievementsSeenRequest` (`strictObject`, без повторов → `INVALID`); ответы `Achievement`
  / `AchievementList` (`code`, `object.kind` — `tolerantEnum`; `factDate` — `LocalDate`, без времени суток, RC-7) и
  `PublicRiderAchievement(List)` (без `seen`). RC-8: незнакомый код в старой сборке — `'unknown'`; приложение такие
  элементы отбрасывает (пометить `seen` их нельзя). Уровни (achievements-levels): `ACHIEVEMENT_LEVELS`
  (`bronze | silver | gold`, только в конец), `ACHIEVEMENT_LEVEL_TARGETS` (пороги трёх счётных кодов — одна таблица
  для API, карточки и приложения; выпущенные не меняются, новый уровень — в конец), `LeveledAchievementCode`,
  `isLeveledCode`; `level` — `tolerantEnum(...).nullable().default(null)` (старый API без поля → `null`),
  `AchievementList.progress` — `AchievementProgress[]` с `.default([])`; в публичной схеме `progress` нет;
  Новых кодов ошибок нет. Сезонные (achievements-seasonal): коды `season_regular`, `season_podium`,
  `season_champion` — в конец каталога в этом порядке (RC-S4), `SEASONAL_ACHIEVEMENT_CODES`, `SeasonalAchievementCode`,
  `isSeasonalCode`, `SEASON_REGULAR_MIN_RACES` (3 — одна константа для API и приложения), вид объекта `season` (в конец
  `ACHIEVEMENT_OBJECT_KINDS`); нового поля в `Achievement` нет — сезон адресуется `object.id`. `MarkAchievementsSeenRequest`
  — `strictObject { codes?, seasonal? }` (`.default([])`, хотя бы один адрес — иначе `REQUIRED` на `codes`; `seasonal` —
  `SeasonalAchievementRef[]` ≤ `SEASONAL_SEEN_MAX` (30), без повторов `(code, seasonId)`); `{ codes }` старых сборок
  валиден. api-client — `listAchievements(token)`, `markAchievementsSeen(token, codes, seasonal = [])` (204; `seasonal`
  уходит только непустым — старый API ответил бы 400), `getRiderAchievements(publicId)` (публичный).
  Панель (achievements-panel): `ACHIEVEMENT_OBJECT_KIND_BY_CODE` (`satisfies Record<AchievementCode,
  AchievementObjectKind>` — одна карта «код → вид» для API и панели), `src/achievements/achievement-admin.schema.ts` —
  строгие `GrantRiderAchievementRequest` (`level` только у счётного → `INVALID` на `level`),
  `RevokeRiderAchievementRequest` / `ClearRiderAchievementOverrideRequest` (`seasonId` ⇔ сезонный код → `REQUIRED` /
  `INVALID`), `ClearRiderAchievementOverrideResult`, `RiderAchievementsAdmin` (`RIDER_ACHIEVEMENT_ADMIN_STATUSES`,
  `byFacts`), `AchievementInvalidStateDetails`; право `achievements.manage`, действия `achievement.granted_manually` /
  `revoked_manually` / `override_cleared`, детали `achievementCode`, `objectKind`, `objectId`, `achievementLevel`, код
  `ACHIEVEMENT_INVALID_STATE` (409) — в конце списков. Ответы приложения не меняются. api-client панели —
  `getRiderAchievements(userId)`, `grantRiderAchievement`, `revokeRiderAchievement` (204),
  `clearRiderAchievementOverride`.
- Билеты (event-tickets, ADR-0023): `src/tickets/ticket.schema.ts` — `TICKET_EVENT_KINDS`, `TICKET_STATUSES`
  (`event_cancelled` вычисляет сервер), `EVENT_REGISTRATION_CLOSED_REASONS` — только в конец; `TicketCode` (ввод:
  `normalizeTicketCode` — верхний регистр, без `-`, `I/L→1`, `O→0`; показ — `formatTicketCode`), `TicketQrPayload`
  (`PKT1.<43>`); ответы приложения (`MyTicketRef`, `MyTickets`, `TicketView`, `CalendarRegistrationState`,
  `EventTicketingPublic` — `discriminatedUnion` по `enabled`) — `tolerantEnum`; запрос `CalendarRegistrationRequest`
  (`strictObject`). `src/tickets/ticketing-admin.schema.ts` — панель, строгие `z.enum`: `AdminEventParams`,
  `EventTicketingSettings`, `EventTicketingUpdate` (`strictObject`, правила по `kind` — сервер), `CheckInRequest`
  (ровно одно поле `qr | code`), `CHECK_IN_OUTCOMES`, `CheckInView`, `EventTicketsQuery`/`Page` (курсор — `_id`),
  `TicketingInvalidStateDetails`. Коды `EVENT_FULL`, `EVENT_REGISTRATION_CLOSED`, `TICKETING_INVALID_STATE` (409),
  право `tickets.checkin`, действия `tickets.settings_updated`/`tickets.checked_in`, деталь `ticketCode` — в конце
  списков. `src/tickets/materials.schema.ts` (PR C) — `EVENT_MATERIAL_TYPES` (только в конец; приложение —
  `tolerantEnum`), `materialContentIssues` (RC-C5 — одно правило для формы, схемы и сервера), `EventMaterial`/`List`,
  `EventMaterialAdmin`/`EventMaterialsAdmin`, `EventMaterialInput` (`superRefine`), `UpdateEventMaterialRequest`,
  `EventMaterialUploadQuery`, `ReorderEventMaterialsRequest`, `EventMaterialFileId`; `TicketView.materials` —
  необязательное; коды `MATERIAL_FILE_UNSUPPORTED` (415), `MATERIAL_FILE_TOO_LARGE` (413), причины
  `materials_limit`/`files_limit`, действия `tickets.material_*` — в конце. Wallet (E) — будущее поле `TicketView`. api-client — `getRaceTicket`,
  `getCalendarRegistration`, `registerForCalendar`, `cancelCalendarRegistration`, `listTickets`, `getTicket`,
  `getEventTicketing` (публичный); панель — `getEventTicketing`, `updateEventTicketing` (`PUT`), `listEventTickets`,
  `lookupTicket`, `checkInTicket`; материалы — приложение `getEventMaterials`, `eventFileUrl`; панель
  `listEventMaterials`, `createEventMaterial`, `uploadEventMaterial` (octet-stream), `updateEventMaterial` (`PATCH`),
  `deleteEventMaterial` (`POST …/delete`), `reorderEventMaterials` (`PUT …/order`), `eventFileUrl`. Напоминания
  (PR D): `EventTicketingUpdate.reminders?` — `EventReminderInput[]` ≤ 3 (`strictObject`: `id?` — правка своего,
  `offsetHours` 1–168, `text` 1–500; нет поля — правила не меняются), ответ `EventTicketingSettings.reminders` —
  `EventReminder` (`sendAt`, `sentAt`, `sentCount`, `late`).
- «Свои» (ADR-0027): `src/social/social.schema.ts` — `CONNECTION_SOURCES`, `REACTION_KINDS`, `REACTION_TARGET_TYPES`,
  `ATTENDANCE_VIA`, `RIDE_JOIN_SOURCES`, `SOCIAL_BLOCK_REASONS` (только в конец; в ответах P2–P7 — `tolerantEnum`),
  `SocialActionBlockedDetails` (`409 SOCIAL_ACTION_BLOCKED`, код — в конце `ErrorCode`). Справочник продуктовых
  событий — не здесь (журнал наружу не уходит, RC-11): `apps/api/src/modules/product-events/product-events.types.ts`.
  `ERASURE_STEPS` — в порядке исполнения (`…, 'tickets', 'social', 'product-events', 'notifications', 'identity'`).
- Фото организатора райда (ride-photo, ADR-0028): `src/rides/ride.schema.ts` — `RIDE_PHOTO_MAX_BYTES` (10 МиБ),
  `RIDE_PHOTO_MAX_EDGE_PX` (1600), `RIDE_PHOTO_MIN_SHORT_PX` (400), `RidePhotoId` (= `OpaqueToken` из
  `auth/verification.schema.ts`), `RidePhotoRef` (`{ id }`), `RideSummary.photo` (`.nullable().default(null)` — старый
  сервер), `ImageInvalidDetails` (`reason: tolerantEnum(['too_small', 'unreadable'])`); `src/rides/ride-moderation.schema.ts`
  — `ModerationRideDetail.photo` (`.nullable().default(null)`), `ResetRidePhotoRequest` (`strictObject { photoId,
  reason: ActionReason }`). Коды `IMAGE_FORMAT_UNSUPPORTED` (415), `IMAGE_TOO_LARGE` (413), `IMAGE_INVALID` (422) — в
  конце `ErrorCode`, для всех новых видов фото (аватар — `AVATAR_*`); действие журнала `ride.photo_reset` — в конце
  `AUDIT_ACTIONS`. api-client — `uploadRidePhoto(token, id, body)`, `ridePhotoUploadRequest`, `deleteRidePhoto`,
  `ridePhotoUrl`; admin — `resetRidePhoto(id, body)`, `ridePhotoUrl`.
