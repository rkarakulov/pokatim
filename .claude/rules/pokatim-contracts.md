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
- Свой трек (maps-02): `src/results/results.schema.ts` — `MyAttemptTrack` (`attemptId`, `line` — `LonLat` 2–1000,
  `segment: TrackMapRun | null`, `offRuns` ≤ 100, `marks` — `tolerantEnum(ATTEMPT_TRACK_MARKS)`: незнакомое клиент
  трактует как `unavailable`); позиции — дробные индексы вершин `{ from, to }`. Клиент — `getMyAttemptTrack`.
- Кофе-райды (ADR-0013 Proposed): `src/rides/ride.schema.ts` (запросы — `strictObject`, строгие `z.enum`; ответы —
  `tolerantEnum` фазы, роли, города и причины; города ленты — незнакомые коды отбрасываются), `src/geo/city.schema.ts`
  (`CITY_CODES` — единственный справочник городов). Справочники (`RIDE_STATUSES`, `RIDE_PHASES`,
  `RIDE_CANCEL_REASONS`, `RIDE_VIEWER_ROLES`, `CITY_CODES`) — только в конец. `version` — только в
  `RideDetailForOrganizer`.
- Участие и результаты (race-results-03): `src/results/results.schema.ts` — ответы приложения и публичная таблица,
  `tolerantEnum`; `ATTEMPT_REJECTIONS` = коды движка (`CORRIDOR_REJECTIONS`) + `implausible`, совпадение держит
  сторож в `apps/api`; публичная строка — `entryId`, место, ничья, время сегмента (без `userId`, активности, времени
  суток, координат) и `riderName` — только при согласии райдера (profile-rider-name), `.nullable().default(null)`.
  `ProfileView.publicName` / `showNameInResults` — новые поля ответа с `.default` (`null` / `false`): новая сборка со
  старым API разбирает ответ. `src/results/results-admin.schema.ts` — панель, строгие `z.enum`;
  `PanelStandingRow.riderName` / `PanelRaceAttempt.riderName` — обязательные `nullable` (панель деплоится с API).
- Согласие на показ имени (profile-02): `PUBLIC_NAME_CONSENT_VERSION` (`src/profile/profile.schema.ts`) — версия
  текста `profile.show.label` + `profile.show.hint` (i18n). Сменили формулировку — **подняли версию** (дата), иначе
  журнал согласий ссылается на чужой текст. Версию в событие пишет сервер. Сброс имени —
  `src/profile/profile-admin.schema.ts` (`ResetRiderNameRequest` с `ActionReason`, `RiderNameResetResult`).
- Треки и устройства (ADR-0011): `src/tracks/track-upload.schema.ts`, `src/devices/device.schema.ts` — статусы,
  причины, источники, провайдеры, проблемы подключения в ответах — `tolerantEnum`; путь `:provider` и запросы —
  строгие; формат `stream` — только сервер. Ответы без идентификаторов агрегатора, ключей хранилища, координат и
  биометрии.
- Удаление аккаунта (ADR-0015): `src/account/account-deletion.schema.ts` — `DeleteAccountRequest` (`strictObject`,
  `password: SignInPassword`), ответ `204`. Коды — `PASSWORD_INCORRECT` (403, не 401: клиент не уходит в refresh) и
  `ACCOUNT_PANEL_MEMBER` (409) в конце `ErrorCode`; `AUDIT_ACTIONS` + `account.deleted` (admin i18n
  `admin.audit.action.account.deleted`). api-client — `deleteAccount(accessToken, body)`.
