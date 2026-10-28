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
  `ROUTE_FILE_EXTENSIONS` (`gpx`, `kml` = пакет `@pokatim/tracks`), `UploadRouteQuery` — общий для панели и
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
- Согласие на показ имени (profile-02): `PUBLIC_NAME_CONSENT_VERSION` (`src/profile/profile.schema.ts`) — версия
  текста `profile.show.label` + `profile.show.hint` (i18n). Сменили формулировку — **подняли версию** (дата), иначе
  журнал согласий ссылается на чужой текст. Версию в событие пишет сервер. Сброс имени —
  `src/profile/profile-admin.schema.ts` (`ResetRiderNameRequest` с `ActionReason`, `RiderNameResetResult`).
- Треки и устройства (ADR-0011): `src/tracks/track-upload.schema.ts`, `src/devices/device.schema.ts` — статусы,
  причины, источники, провайдеры, проблемы подключения в ответах — `tolerantEnum`; путь `:provider` и запросы —
  строгие; формат `stream` — только сервер. Ответы без идентификаторов агрегатора, ключей хранилища, координат и
  биометрии.
- Тема приложения (app-themes): `src/appearance/appearance.schema.ts` — `APP_THEME_IDS` — единственный источник id
  тем для API и панели (только в конец; порядок = порядок карточек панели); реестр `appThemes` в
  `@pokatim/design-tokens` объявляет тот же состав и порядок, от контрактов не зависит (сторож равенства — в D2).
  `DEFAULT_APP_THEME_ID`, ответ приложения `AppAppearance` (`themeId` — `tolerantEnum`, ровно один ключ), панели
  `PanelAppearance` (строгий enum, `version`, `updatedAt` nullable), запрос `UpdateAppearanceRequest`
  (`strictObject`). Право `appearance.manage`, действие журнала `appearance.theme_changed`, вид объекта `platform`,
  детали `themeFrom`/`themeTo`. api-client — `getAppearance` (публичный и панели), `updateAppearance` (`PUT`).
- Удаление аккаунта (ADR-0015): `src/account/account-deletion.schema.ts` — `DeleteAccountRequest` (`strictObject`,
  `password: SignInPassword`), ответ `204`. Коды — `PASSWORD_INCORRECT` (403, не 401: клиент не уходит в refresh) и
  `ACCOUNT_PANEL_MEMBER` (409) в конце `ErrorCode`; `AUDIT_ACTIONS` + `account.deleted` (admin i18n
  `admin.audit.action.account.deleted`). api-client — `deleteAccount(accessToken, body)`.
- Уведомления (ADR-0017): `src/notifications/notification.schema.ts` — `kind`/`group` в ответах — `tolerantEnum`,
  цель — белый список (`NotificationTarget`), незнакомая в ответе — `{ type: 'unknown' }`; запросы (`NotificationSettings`
  с `startHour ≠ endHour`, `RegisterPushToken`, `RevokePushToken`, `NotificationListQuery`) — `strictObject`. api-client —
  8 методов `/v1/notifications*`.
- Карточка для сторис (story-cards, ADR-0018): `src/sharing/story-card.schema.ts` — `STORY_CARD_TEMPLATES`
  (`line | night`, только в конец), запрос `StoryCardQuery` (`strictObject`), ответ `StoryCardStatus` —
  `discriminatedUnion` `pending | ready (token) | failed` (незнакомый статус — ошибка разбора), `StoryCardToken`
  (22 символа base64url). `MyRaceEntry.actions.canShareStory` — `.default(false)` (старый сервер — кнопки нет). Код
  `STORY_CARD_UNAVAILABLE` (409) в конце `ErrorCode`. api-client — `getStoryCard`, `storyCardImageUrl(token)` (адрес
  без запроса: сервер свой публичный origin не знает).
- Заезд по маршруту (route-rides-01): `src/route-rides/route-ride.schema.ts` — `ROUTE_RIDE_STATUSES` (только в конец),
  `ROUTE_RIDE_MAX_PER_ROUTE` (100), `ROUTE_RIDE_CANDIDATES_MAX` (30); запрос `RouteRideRequest` (ровно одно поле
  `activityId | uploadId`, `strictObject`); ответы `RouteRidePage`, `RouteRideCandidates`, `RouteRideDetail`,
  `RouteRideTrack` — `tolerantEnum`, причины и провалы — `ATTEMPT_REJECTIONS`/`ATTEMPT_FAILURES`, разметка —
  `TrackMapRun`/`ATTEMPT_TRACK_MARKS` (импорт, не копии); дельты — знаковые целые. Коды `ROUTE_RIDE_NOT_READY`,
  `ROUTE_RIDE_UPLOAD_FAILED`, `ROUTE_RIDE_QUOTA_EXCEEDED` (409) — в конце `ErrorCode`. api-client — `listRouteRides`,
  `listRouteRideCandidates`, `checkRouteRide`, `getRouteRide`, `getRouteRideTrack` (явный access-токен).
